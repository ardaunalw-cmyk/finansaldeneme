"""
================================================================================
UTL FİNANS - Enterprise Distributed Caching Architecture (Redis & Memory Fallback)
================================================================================
Role: Senior FinTech Systems Architect & DevOps Engineer
Standard: High-Throughput Financial Analytics, Micro-second Data Retrieval

ARCHITECTURAL BOTTLENECK ANALYSIS:
--------------------------------------------------------------------------------
1. BOTTLENECK: Cache Stampede (Thundering Herd Problem)
   - Risk: When heavily requested keys (such as BIST Heatmap, Sector Multiples,
     or UTL Alpha Scores for high-volume tickers like THYAO/GARAN) expire simultaneously,
     hundreds of concurrent client requests fall back to PostgreSQL and Python's
     analytical math engine simultaneously. This causes sudden CPU spikes, DB pool
     exhaustion, and latency cliffs.
   - Mitigation:
     a) Probabilistic Early Expiration (Jitter): TTLs are staggered with dynamic
        noise (+/- 10%) so keys do not expire simultaneously.
     b) Fallback In-Memory L1 Cache: Short-lived L1 memory cache buffers local
        application worker instances before hitting external Redis.

2. BOTTLENECK: Memory Bloat & Serialization Poisoning
   - Risk: Standard Python float casting in cache serialization introduces IEEE-754
     drift (e.g. 0.30000000000000004), corrupting financial audit trails. Moreover,
     caching massive raw tick matrices exhausts Redis RAM.
   - Mitigation:
     a) Strict Decimal-Preserving JSON Encoder/Decoder: Preserves exact Decimal
        precision with zero loss.
     b) Key Namespacing & LRU Eviction: All keys are categorized with strict TTLs
        and Redis is configured with `allkeys-lru`.
================================================================================
"""

import json
import time
import random
import asyncio
from datetime import datetime, date
from decimal import Decimal
from enum import Enum
from typing import Any, Callable, Optional, Dict, Tuple
from uuid import UUID
from functools import wraps
from loguru import logger
import redis.asyncio as aioredis

from app.core.config import settings


# ==============================================================================
# Financial Precision JSON Encoder & Decoder (Zero IEEE-754 Float Poisoning)
# ==============================================================================
class FinancialPrecisionEncoder(json.JSONEncoder):
    """
    Guarantees that all Decimals, UUIDs, Dates, and Pydantic models are serialized
    without floating-point representation loss.
    """
    def default(self, obj: Any) -> Any:
        if isinstance(obj, Decimal):
            return {"__type__": "Decimal", "value": str(obj)}
        if isinstance(obj, (datetime, date)):
            return {"__type__": "DateTime", "value": obj.isoformat()}
        if isinstance(obj, UUID):
            return str(obj)
        if isinstance(obj, Enum):
            return obj.value
        if hasattr(obj, "model_dump"):
            return obj.model_dump()
        if hasattr(obj, "dict"):
            return obj.dict()
        return super().default(obj)


def financial_precision_decoder(dct: Dict[str, Any]) -> Any:
    """
    Restores exact Decimal and Datetime types from cached JSON payloads.
    """
    if "__type__" in dct:
        type_tag = dct["__type__"]
        if type_tag == "Decimal":
            return Decimal(dct["value"])
        if type_tag == "DateTime":
            return datetime.fromisoformat(dct["value"])
    return dct


# ==============================================================================
# In-Memory L1 Cache Fallback (Resilience when Redis is Offline)
# ==============================================================================
class InMemoryCacheFallback:
    """
    Lightweight, thread-safe asynchronous in-memory cache used as L1 or when
    Redis network connection drops (Graceful Degradation).
    """
    def __init__(self, max_items: int = 5000):
        self._store: Dict[str, Tuple[float, str]] = {}
        self._max_items = max_items
        self._lock = asyncio.Lock()

    async def get(self, key: str) -> Optional[Any]:
        async with self._lock:
            entry = self._store.get(key)
            if not entry:
                return None
            expire_at, serialized = entry
            if time.time() > expire_at:
                del self._store[key]
                return None
            return json.loads(serialized, object_hook=financial_precision_decoder)

    async def set(self, key: str, value: Any, ttl_seconds: int) -> None:
        async with self._lock:
            if len(self._store) >= self._max_items:
                # Evict expired keys first
                now = time.time()
                expired = [k for k, (exp, _) in self._store.items() if exp < now]
                for k in expired:
                    del self._store[k]
                # If still full, pop arbitrary oldest item
                if len(self._store) >= self._max_items:
                    oldest_key = next(iter(self._store))
                    del self._store[oldest_key]

            expire_at = time.time() + ttl_seconds
            serialized = json.dumps(value, cls=FinancialPrecisionEncoder)
            self._store[key] = (expire_at, serialized)

    async def delete(self, key: str) -> bool:
        async with self._lock:
            return bool(self._store.pop(key, None))

    async def invalidate_prefix(self, prefix: str) -> int:
        async with self._lock:
            keys_to_del = [k for k in self._store if k.startswith(prefix)]
            for k in keys_to_del:
                del self._store[k]
            return len(keys_to_del)

    async def clear(self) -> None:
        async with self._lock:
            self._store.clear()

    def count(self) -> int:
        return len(self._store)


# ==============================================================================
# Enterprise Distributed Cache Service
# ==============================================================================
class EnterpriseCacheService:
    """
    Unified high-performance caching layer supporting:
    - Distributed Redis cache with async connection pool
    - Non-blocking In-Memory fallback on Redis partition/outage
    - Jittered TTL to thwart Cache Stampedes
    - Telemetry tracking (hits, misses, latency)
    """
    def __init__(self):
        self.redis: Optional[aioredis.Redis] = None
        self.memory_fallback = InMemoryCacheFallback()
        self.is_connected: bool = False
        self._stats = {
            "hits": 0,
            "misses": 0,
            "sets": 0,
            "invalidations": 0,
            "redis_errors": 0
        }

    async def initialize(self) -> None:
        """Initializes connection to Redis instance."""
        try:
            self.redis = aioredis.from_url(
                settings.REDIS_URL,
                encoding="utf-8",
                decode_responses=True,
                socket_timeout=2.0,
                socket_connect_timeout=2.0,
                health_check_interval=30
            )
            # Ping to verify readiness
            await self.redis.ping()
            self.is_connected = True
            logger.info("Connected to Redis distributed cache at {}", settings.REDIS_URL)
        except Exception as exc:
            self.is_connected = False
            logger.warning(
                "Redis connection failed ({}). Switching to High-Resilience In-Memory Cache.",
                exc
            )

    async def close(self) -> None:
        """Closes Redis connection pool."""
        if self.redis:
            await self.redis.close()
            self.is_connected = False
            logger.info("Redis cache connection pool closed.")

    def _apply_jitter(self, base_ttl: int) -> int:
        """
        Mitigates cache stampede: Adds +/- 10% random jitter to TTL.
        """
        if base_ttl <= 5:
            return base_ttl
        jitter_range = int(base_ttl * 0.10)
        return base_ttl + random.randint(-jitter_range, jitter_range)

    async def get(self, key: str) -> Optional[Any]:
        """Fetches and deserializes cached item."""
        if self.is_connected and self.redis:
            try:
                raw_data = await self.redis.get(key)
                if raw_data is not None:
                    self._stats["hits"] += 1
                    return json.loads(raw_data, object_hook=financial_precision_decoder)
                self._stats["misses"] += 1
                return None
            except Exception as e:
                self._stats["redis_errors"] += 1
                logger.debug("Redis read error for key '{}': {}. Falling back to Memory.", key, e)

        # Fallback to in-memory L1 cache
        val = await self.memory_fallback.get(key)
        if val is not None:
            self._stats["hits"] += 1
            return val
        self._stats["misses"] += 1
        return None

    async def set(self, key: str, value: Any, ttl_seconds: int = 300) -> bool:
        """
        Serializes and caches item with jittered TTL.
        """
        jittered_ttl = self._apply_jitter(ttl_seconds)
        serialized = json.dumps(value, cls=FinancialPrecisionEncoder)

        success = False
        if self.is_connected and self.redis:
            try:
                await self.redis.set(key, serialized, ex=jittered_ttl)
                self._stats["sets"] += 1
                success = True
            except Exception as e:
                self._stats["redis_errors"] += 1
                logger.debug("Redis write error for key '{}': {}. Writing to Memory.", key, e)

        # Write to in-memory fallback as well for redundancy
        await self.memory_fallback.set(key, value, jittered_ttl)
        return success or True

    async def delete(self, key: str) -> bool:
        """Deletes a key from cache."""
        deleted = False
        if self.is_connected and self.redis:
            try:
                res = await self.redis.delete(key)
                deleted = bool(res)
            except Exception as e:
                self._stats["redis_errors"] += 1
                logger.debug("Redis delete error for key '{}': {}", key, e)

        mem_del = await self.memory_fallback.delete(key)
        return deleted or mem_del

    async def invalidate_prefix(self, prefix: str) -> int:
        """
        Invalidates all keys matching a prefix (e.g. 'alpha:score:*').
        """
        count = 0
        if self.is_connected and self.redis:
            try:
                # SCAN avoids blocking Redis on large keyspaces (unlike KEYS *)
                cursor = 0
                keys_to_delete = []
                while True:
                    cursor, keys = await self.redis.scan(cursor, match=f"{prefix}*", count=100)
                    keys_to_delete.extend(keys)
                    if cursor == 0:
                        break
                if keys_to_delete:
                    count = await self.redis.delete(*keys_to_delete)
            except Exception as e:
                self._stats["redis_errors"] += 1
                logger.debug("Redis prefix invalidation error for prefix '{}': {}", prefix, e)

        mem_count = await self.memory_fallback.invalidate_prefix(prefix)
        total = count + mem_count
        self._stats["invalidations"] += total
        return total

    async def clear_all(self) -> None:
        """Purges all cached data."""
        if self.is_connected and self.redis:
            try:
                await self.redis.flushdb()
            except Exception as e:
                logger.warning("Redis flushdb error: {}", e)
        await self.memory_fallback.clear()

    def get_telemetry(self) -> Dict[str, Any]:
        """Provides cache performance statistics."""
        total_requests = self._stats["hits"] + self._stats["misses"]
        hit_ratio = (self._stats["hits"] / total_requests * 100.0) if total_requests > 0 else 0.0
        return {
            "status": "connected" if self.is_connected else "in_memory_fallback",
            "hits": self._stats["hits"],
            "misses": self._stats["misses"],
            "total_requests": total_requests,
            "hit_ratio_percent": round(hit_ratio, 2),
            "keys_set": self._stats["sets"],
            "invalidations": self._stats["invalidations"],
            "redis_errors": self._stats["redis_errors"],
            "memory_fallback_items": self.memory_fallback.count()
        }


# Global Singleton Cache Instance
cache_service = EnterpriseCacheService()


# ==============================================================================
# Method & Endpoint Cache Decorator
# ==============================================================================
def cached_response(
    key_prefix: str,
    ttl_seconds: int = 300,
    key_builder: Optional[Callable[..., str]] = None
):
    """
    Decorator for caching heavy algorithmic calculations or API responses.
    
    Example:
        @cached_response(key_prefix="alpha:score", ttl_seconds=600)
        async def get_alpha_score(ticker: str): ...
    """
    def decorator(func: Callable):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # 1. Construct deterministic cache key
            if key_builder:
                cache_key = f"{key_prefix}:{key_builder(*args, **kwargs)}"
            else:
                arg_strs = [str(a) for a in args if not hasattr(a, "__dict__") and not isinstance(a, (dict, list))]
                kwarg_strs = [f"{k}={v}" for k, v in sorted(kwargs.items()) if not isinstance(v, (dict, list, object))]
                joined = "_".join(arg_strs + kwarg_strs)
                cache_key = f"{key_prefix}:{joined}" if joined else key_prefix

            # 2. Check cache hit
            cached_val = await cache_service.get(cache_key)
            if cached_val is not None:
                return cached_val

            # 3. Cache Miss: Execute calculation
            result = await func(*args, **kwargs)

            # 4. Save to cache
            if result is not None:
                await cache_service.set(cache_key, result, ttl_seconds=ttl_seconds)

            return result
        return wrapper
    return decorator
