"""
================================================================================
UTL FİNANS - Resilient Infrastructure & Fault Tolerance Core
================================================================================
Enterprise patterns for mission-critical FinTech APIs:
- Circuit Breaker State Machine (CLOSED, OPEN, HALF_OPEN)
- Token Bucket Rate Limiter
- Async Exponential Backoff with Jitter Retry Mechanism
"""

import asyncio
import enum
import time
import random
import logging
from typing import Callable, Any, Optional, TypeVar, Tuple
from functools import wraps

logger = logging.getLogger("utl_finans.resilience")

T = TypeVar("T")


# ==============================================================================
# 1. Circuit Breaker Pattern
# ==============================================================================
class CircuitState(str, enum.Enum):
    CLOSED = "CLOSED"       # Normal operation: all requests pass through
    OPEN = "OPEN"           # Tripped: fast fail immediately without calling external service
    HALF_OPEN = "HALF_OPEN" # Canary state: trial requests to test service recovery


class CircuitBreakerOpenException(Exception):
    """Raised when request is rejected because Circuit Breaker is in OPEN state."""
    pass


class CircuitBreaker:
    """
    Enterprise Circuit Breaker to prevent cascading failures when external financial
    APIs (KAP, BIST feed, FX providers, Central Bank) experience outages or latency spikes.
    """

    def __init__(
        self,
        name: str,
        failure_threshold: int = 5,
        recovery_timeout_seconds: float = 30.0,
        half_open_max_trials: int = 3
    ):
        self.name = name
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout_seconds
        self.half_open_max_trials = half_open_max_trials

        self.state = CircuitState.CLOSED
        self.failure_count = 0
        self.success_count = 0
        self.last_state_change = time.time()
        self._lock = asyncio.Lock()

    async def can_execute(self) -> bool:
        """Determines if a request is allowed based on circuit state and timeouts."""
        async with self._lock:
            now = time.time()
            if self.state == CircuitState.CLOSED:
                return True

            if self.state == CircuitState.OPEN:
                # Check if recovery timeout has elapsed to transition into HALF_OPEN
                if now - self.last_state_change >= self.recovery_timeout:
                    logger.warning(f"CircuitBreaker [{self.name}]: Recovery timeout elapsed. Transitioning OPEN -> HALF_OPEN")
                    self.state = CircuitState.HALF_OPEN
                    self.success_count = 0
                    self.failure_count = 0
                    self.last_state_change = now
                    return True
                return False

            if self.state == CircuitState.HALF_OPEN:
                return True

            return False

    async def record_success(self) -> None:
        """Registers a successful upstream response."""
        async with self._lock:
            if self.state == CircuitState.HALF_OPEN:
                self.success_count += 1
                if self.success_count >= self.half_open_max_trials:
                    logger.info(f"CircuitBreaker [{self.name}]: Canary trials succeeded. Transitioning HALF_OPEN -> CLOSED")
                    self.state = CircuitState.CLOSED
                    self.failure_count = 0
                    self.success_count = 0
                    self.last_state_change = time.time()
            elif self.state == CircuitState.CLOSED:
                self.failure_count = 0

    async def record_failure(self, error: Exception) -> None:
        """Registers an upstream error and evaluates tripping threshold."""
        async with self._lock:
            self.failure_count += 1
            now = time.time()
            logger.error(f"CircuitBreaker [{self.name}]: Upstream failure recorded ({self.failure_count}/{self.failure_threshold}): {error}")

            if self.state == CircuitState.HALF_OPEN:
                logger.critical(f"CircuitBreaker [{self.name}]: Trial failed in HALF_OPEN. Tripping back to OPEN")
                self.state = CircuitState.OPEN
                self.last_state_change = now
            elif self.state == CircuitState.CLOSED and self.failure_count >= self.failure_threshold:
                logger.critical(f"CircuitBreaker [{self.name}]: Failure threshold breached ({self.failure_count}). Tripping CLOSED -> OPEN")
                self.state = CircuitState.OPEN
                self.last_state_change = now

    async def execute(self, func: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
        """Wraps async callable with circuit protection."""
        if not await self.can_execute():
            raise CircuitBreakerOpenException(
                f"CircuitBreaker [{self.name}] is OPEN. External service call rejected to preserve platform stability."
            )

        try:
            result = await func(*args, **kwargs)
            await self.record_success()
            return result
        except Exception as e:
            await self.record_failure(e)
            raise


# ==============================================================================
# 2. Token Bucket Rate Limiter
# ==============================================================================
class AsyncRateLimiter:
    """
    High-performance Token Bucket Rate Limiter.
    Ensures outgoing requests conform to upstream provider limits (e.g., 5 requests/sec).
    """

    def __init__(self, rate_per_second: float, burst_capacity: int = 10):
        self.rate = rate_per_second
        self.capacity = float(burst_capacity)
        self.tokens = float(burst_capacity)
        self.last_updated = time.time()
        self._lock = asyncio.Lock()

    async def acquire(self, tokens: int = 1) -> None:
        """Asynchronously waits until sufficient tokens are available."""
        while True:
            async with self._lock:
                now = time.time()
                elapsed = now - self.last_updated
                self.last_updated = now

                # Refill tokens based on elapsed time
                self.tokens = min(self.capacity, self.tokens + elapsed * self.rate)

                if self.tokens >= tokens:
                    self.tokens -= tokens
                    return

                # Calculate sleep duration needed to replenish required tokens
                missing_tokens = tokens - self.tokens
                wait_time = missing_tokens / self.rate

            await asyncio.sleep(max(wait_time, 0.01))


# ==============================================================================
# 3. Retry Mechanism with Exponential Backoff & Jitter
# ==============================================================================
def retry_with_backoff(
    max_retries: int = 3,
    base_delay_seconds: float = 0.5,
    max_delay_seconds: float = 10.0,
    backoff_multiplier: float = 2.0,
    jitter: bool = True,
    retryable_exceptions: Tuple[type, ...] = (Exception,)
) -> Callable:
    """
    Decorator for async methods providing institutional-grade retry logic with
    exponential backoff and Full Jitter to avoid the 'Thundering Herd' problem.
    """
    def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        @wraps(func)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            delay = base_delay_seconds
            attempt = 0

            while True:
                attempt += 1
                try:
                    return await func(*args, **kwargs)
                except retryable_exceptions as e:
                    if attempt > max_retries:
                        logger.error(f"Function [{func.__name__}] failed after {max_retries} attempts. Final error: {e}")
                        raise

                    # Calculate sleep with optional randomized jitter
                    sleep_time = min(delay, max_delay_seconds)
                    if jitter:
                        sleep_time = random.uniform(0.5 * sleep_time, 1.5 * sleep_time)

                    logger.warning(
                        f"Retry attempt {attempt}/{max_retries} for [{func.__name__}] after exception: {e}. "
                        f"Backing off for {sleep_time:.2f}s..."
                    )
                    await asyncio.sleep(sleep_time)
                    delay *= backoff_multiplier

        return wrapper
    return decorator
