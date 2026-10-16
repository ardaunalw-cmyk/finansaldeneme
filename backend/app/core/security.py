"""
================================================================================
UTL FİNANS - Security & Cryptographic Engine (JWT & Password Hashing)
================================================================================
Role: Senior FinTech Systems Architect & Security Engineer
Standards: OWASP ASVS 4.0, NIST SP 800-63B, FIPS 140-2

ARCHITECTURAL BOTTLENECK ANALYSIS:
--------------------------------------------------------------------------------
1. BOTTLENECK: CPU Starvation from Bcrypt Key Stretching
   - Risk: Bcrypt uses a deliberately compute-intensive key derivation algorithm
     (work factor/cost = 12). Under high concurrent login loads or brute-force
     attacks, synchronous bcrypt calls saturate the Python GIL and event loop,
     causing latency spikes (>2000ms) for high-frequency market streaming endpoints.
   - Mitigation:
     a) Offload hashing to worker thread pools (async run_in_threadpool) so the
        asyncio event loop never blocks.
     b) Enforce strict IP/User token-bucket rate limiting on the `/auth/token` endpoint.
     c) Implement failed attempt lockouts to prevent password exhaustion attacks.

2. BOTTLENECK: Database Query Saturation from Stateless Token Verification
   - Risk: If every authenticated API request queries PostgreSQL to fetch the User
     record, a platform with 5,000 active WebSocket and REST connections will
     exhaust the database connection pool (Max 200).
   - Mitigation:
     a) Embed essential claims (User ID, Role, Subscription Tier) directly inside
        the signed JWT payload.
     b) Cache user authorization profiles in Redis with a 5-minute TTL to bypass DB.
     c) Maintain a fast Redis-backed token revocation blacklist for instant logout.
================================================================================
"""

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Union
from uuid import UUID
from jose import jwt, JWTError
from passlib.context import CryptContext
from pydantic import BaseModel
from loguru import logger

from app.core.config import settings
from app.core.cache import cache_service

# Bcrypt context with 12 rounds of hashing (OWASP FinTech Standard)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class TokenPayload(BaseModel):
    sub: str  # User UUID string
    email: str
    role: str
    subscription_tier: str
    exp: int
    iat: int
    token_type: str = "access"


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    role: str
    subscription_tier: str


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifies a plain password against the stored bcrypt hash."""
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """Generates a secure salted bcrypt hash for a user password."""
    return pwd_context.hash(password)


def create_access_token(
    subject: Union[str, UUID],
    email: str,
    role: str,
    subscription_tier: str,
    expires_delta: Optional[timedelta] = None
) -> str:
    """
    Creates a signed HMAC-SHA256 JWT access token with institutional claims.
    """
    now = datetime.now(timezone.utc)
    if expires_delta:
        expire = now + expires_delta
    else:
        expire = now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)

    to_encode: Dict[str, Any] = {
        "sub": str(subject),
        "email": email,
        "role": role,
        "subscription_tier": subscription_tier,
        "iat": int(now.timestamp()),
        "exp": int(expire.timestamp()),
        "token_type": "access"
    }

    encoded_jwt = jwt.encode(
        to_encode,
        settings.SECRET_KEY,
        algorithm=settings.ALGORITHM
    )
    return encoded_jwt


def create_refresh_token(
    subject: Union[str, UUID],
    expires_delta: Optional[timedelta] = None
) -> str:
    """
    Creates a long-lived JWT refresh token (default: 30 days).
    """
    now = datetime.now(timezone.utc)
    expire = now + (expires_delta or timedelta(days=30))

    to_encode: Dict[str, Any] = {
        "sub": str(subject),
        "iat": int(now.timestamp()),
        "exp": int(expire.timestamp()),
        "token_type": "refresh"
    }

    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_token(token: str) -> Optional[TokenPayload]:
    """
    Decodes and validates a JWT token signature and expiration.
    Returns None if signature is invalid or token has expired.
    """
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM]
        )
        return TokenPayload(**payload)
    except JWTError as e:
        logger.debug("JWT validation failed: {}", e)
        return None
    except Exception as e:
        logger.warning("Unexpected error decoding token: {}", e)
        return None


async def revoke_token(token: str, ttl_seconds: Optional[int] = None) -> bool:
    """
    Blacklists a revoked token in Redis to implement immediate logout.
    TTL matches the remaining life of the token so Redis auto-prunes expired keys.
    """
    payload = decode_token(token)
    if not payload:
        return False

    if ttl_seconds is None:
        remaining = payload.exp - int(datetime.now(timezone.utc).timestamp())
        ttl_seconds = max(remaining, 60)

    blacklist_key = f"jwt:revoked:{token}"
    return await cache_service.set(blacklist_key, {"revoked_at": datetime.now(timezone.utc).isoformat()}, ttl_seconds=ttl_seconds)


async def is_token_revoked(token: str) -> bool:
    """Checks if a given JWT token has been explicitly invalidated."""
    blacklist_key = f"jwt:revoked:{token}"
    revoked = await cache_service.get(blacklist_key)
    return revoked is not None

