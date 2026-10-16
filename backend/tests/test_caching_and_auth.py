"""
================================================================================
UTL FİNANS - Security, Cryptography & Caching Unit Tests
================================================================================
Role: Senior FinTech Systems Architect & QA Lead
Standards: NIST SP 800-63B, OWASP ASVS, IEEE-754 Numeric Precision
"""

import time
import pytest
from decimal import Decimal
from datetime import timedelta
from uuid import uuid4

from app.core.security import (
    verify_password,
    get_password_hash,
    create_access_token,
    create_refresh_token,
    decode_token,
    revoke_token,
    is_token_revoked
)
from app.core.cache import (
    EnterpriseCacheService,
    InMemoryCacheFallback,
    financial_precision_decoder,
    FinancialPrecisionEncoder
)
import json


# ==============================================================================
# 1. Cryptographic Password Hashing Tests
# ==============================================================================
def test_bcrypt_password_hashing():
    """Verifies that bcrypt produces unique salted hashes and verifies accurately."""
    raw_password = "UtlFinansStrongPassword2026!#"
    hash1 = get_password_hash(raw_password)
    hash2 = get_password_hash(raw_password)

    # Salt uniqueness
    assert hash1 != hash2
    assert hash1.startswith("$2b$")

    # Verification
    assert verify_password(raw_password, hash1) is True
    assert verify_password(raw_password, hash2) is True
    assert verify_password("WrongPassword!", hash1) is False


# ==============================================================================
# 2. JWT Token Generation & Claims Verification Tests
# ==============================================================================
def test_jwt_access_and_refresh_tokens():
    """Verifies JWT token encoding, claims preservation, and role assertions."""
    user_id = uuid4()
    email = "quant.director@utlfinans.com"
    role = "PORTFOLIO_MANAGER"
    tier = "INSTITUTIONAL"

    token = create_access_token(
        subject=user_id,
        email=email,
        role=role,
        subscription_tier=tier,
        expires_delta=timedelta(minutes=15)
    )

    payload = decode_token(token)
    assert payload is not None
    assert payload.sub == str(user_id)
    assert payload.email == email
    assert payload.role == role
    assert payload.subscription_tier == tier
    assert payload.token_type == "access"


def test_jwt_token_expiration():
    """Verifies that expired tokens are cleanly rejected by the decoder."""
    user_id = uuid4()
    expired_token = create_access_token(
        subject=user_id,
        email="trader@bist.com",
        role="INVESTOR",
        subscription_tier="RETAIL_PRO",
        expires_delta=timedelta(seconds=-10)  # Expired 10 seconds ago
    )

    payload = decode_token(expired_token)
    assert payload is None


# ==============================================================================
# 3. Decimal Precision & Lossless Cache Serialization Tests
# ==============================================================================
def test_cache_decimal_precision_lossless():
    """
    CRITICAL FINANCIAL TEST:
    Verifies that Decimal values never get coerced to IEEE-754 floats during
    JSON serialization and deserialization, preventing 0.30000000000000004 drift.
    """
    original_data = {
        "ticker": "THYAO",
        "price": Decimal("312.750000"),
        "asset_weight": Decimal("0.198542"),
        "market_cap": Decimal("431595000000.0000"),
        "roe": Decimal("0.342150")
    }

    # Serialize using FinancialPrecisionEncoder
    serialized = json.dumps(original_data, cls=FinancialPrecisionEncoder)

    # Deserialize using financial_precision_decoder
    restored = json.loads(serialized, object_hook=financial_precision_decoder)

    assert isinstance(restored["price"], Decimal)
    assert isinstance(restored["asset_weight"], Decimal)
    assert isinstance(restored["market_cap"], Decimal)
    assert isinstance(restored["roe"], Decimal)

    assert restored["price"] == Decimal("312.750000")
    assert restored["asset_weight"] == Decimal("0.198542")
    assert restored["market_cap"] == Decimal("431595000000.0000")
    assert restored["roe"] == Decimal("0.342150")


# ==============================================================================
# 4. In-Memory Cache Fallback & TTL Tests
# ==============================================================================
@pytest.mark.asyncio
async def test_in_memory_cache_lifecycle():
    """Verifies memory fallback set, get, TTL expiration, and prefix invalidation."""
    mem_cache = InMemoryCacheFallback(max_items=100)

    # Set key with 2s TTL
    await mem_cache.set("bist:GARAN:price", {"price": Decimal("114.500000")}, ttl_seconds=2)
    val = await mem_cache.get("bist:GARAN:price")
    assert val is not None
    assert val["price"] == Decimal("114.500000")

    # Set key with short TTL
    await mem_cache.set("bist:THYAO:price", {"price": Decimal("315.000000")}, ttl_seconds=1)

    # Prefix invalidation
    await mem_cache.set("bist:AKBNK:price", {"price": Decimal("62.300000")}, ttl_seconds=60)
    invalidated_count = await mem_cache.invalidate_prefix("bist:")
    assert invalidated_count >= 2

    # Verify keys purged
    assert await mem_cache.get("bist:GARAN:price") is None
    assert await mem_cache.get("bist:AKBNK:price") is None


# ==============================================================================
# 5. Distributed Cache Service Telemetry & Revocation
# ==============================================================================
@pytest.mark.asyncio
async def test_cache_service_telemetry_and_revocation():
    """Verifies hit/miss telemetry tracking and token revocation blacklist."""
    cache = EnterpriseCacheService()

    # Read non-existent key -> Miss
    miss_val = await cache.get("non_existent_key_xyz")
    assert miss_val is None

    # Write key & read -> Hit
    await cache.set("test:telemetry:k1", {"status": "ok"}, ttl_seconds=60)
    hit_val = await cache.get("test:telemetry:k1")
    assert hit_val == {"status": "ok"}

    telemetry = cache.get_telemetry()
    assert telemetry["hits"] >= 1
    assert telemetry["misses"] >= 1
    assert telemetry["hit_ratio_percent"] > 0

    # Token Revocation Test
    test_token = create_access_token(
        subject=uuid4(),
        email="investor@client.com",
        role="INVESTOR",
        subscription_tier="RETAIL_FREE",
        expires_delta=timedelta(minutes=10)
    )

    assert await is_token_revoked(test_token) is False
    await revoke_token(test_token, ttl_seconds=60)
    assert await is_token_revoked(test_token) is True
