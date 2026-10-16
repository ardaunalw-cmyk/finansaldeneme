"""
================================================================================
UTL FİNANS - Pipeline & Resilience Verification Test Suite
================================================================================
Tests:
- Circuit Breaker Tripping, Fast-Fail & Canary Recovery
- Token Bucket Rate Limiter
- Exponential Backoff Retry with Jitter
- KAP NLP Ticker Extraction, Classification & Sentiment Scoring
- Macroeconomic Indicator Model Invariants
"""

import asyncio
import pytest
from decimal import Decimal
from datetime import date

from app.pipeline.resilience import (
    CircuitBreaker,
    CircuitState,
    CircuitBreakerOpenException,
    AsyncRateLimiter,
    retry_with_backoff
)
from app.pipeline.news_kap import KapNewsParser
from app.models.news import DisclosureCategory
from app.pipeline.macro import MacroeconomicDataEngine


# ==============================================================================
# 1. Circuit Breaker Tests
# ==============================================================================
@pytest.mark.asyncio
async def test_circuit_breaker_tripping_and_recovery():
    """
    Verifies that:
    1. Circuit starts CLOSED.
    2. After 3 consecutive failures, it trips to OPEN.
    3. In OPEN state, calls fail fast immediately.
    4. After recovery timeout, it transitions to HALF_OPEN.
    5. After successful trials, it resets to CLOSED.
    """
    cb = CircuitBreaker(
        name="TestCircuit",
        failure_threshold=3,
        recovery_timeout_seconds=0.2, # Fast recovery for test
        half_open_max_trials=2
    )

    assert cb.state == CircuitState.CLOSED

    # Fail 1 & 2
    for _ in range(2):
        with pytest.raises(ValueError):
            async def failing_call():
                raise ValueError("Downstream timeout")
            await cb.execute(failing_call)
    assert cb.state == CircuitState.CLOSED

    # Fail 3: Should trip to OPEN
    with pytest.raises(ValueError):
        async def failing_call():
            raise ValueError("Downstream timeout")
        await cb.execute(failing_call)
    assert cb.state == CircuitState.OPEN

    # In OPEN state, call must fail fast with CircuitBreakerOpenException
    with pytest.raises(CircuitBreakerOpenException):
        async def any_call():
            return "Should not reach here"
        await cb.execute(any_call)

    # Wait for recovery timeout to transition to HALF_OPEN
    await asyncio.sleep(0.25)
    assert await cb.can_execute() is True
    assert cb.state == CircuitState.HALF_OPEN

    # Two successful trial executions should close the circuit
    async def healthy_call():
        return "SUCCESS"

    res1 = await cb.execute(healthy_call)
    assert res1 == "SUCCESS"
    assert cb.state == CircuitState.HALF_OPEN

    res2 = await cb.execute(healthy_call)
    assert res2 == "SUCCESS"
    assert cb.state == CircuitState.CLOSED


# ==============================================================================
# 2. Rate Limiter Tests
# ==============================================================================
@pytest.mark.asyncio
async def test_async_rate_limiter():
    """Verifies Token Bucket rate limiter regulates high frequency bursts."""
    limiter = AsyncRateLimiter(rate_per_second=20.0, burst_capacity=5)

    # Acquire burst capacity immediately
    start_time = asyncio.get_event_loop().time()
    for _ in range(5):
        await limiter.acquire(1)
    burst_elapsed = asyncio.get_event_loop().time() - start_time
    assert burst_elapsed < 0.1 # Burst is virtually instant

    # Acquiring additional tokens must throttle
    await limiter.acquire(2)
    throttle_elapsed = asyncio.get_event_loop().time() - start_time
    assert throttle_elapsed >= 0.09 # Rate throttled as expected


# ==============================================================================
# 3. Retry Mechanism Tests
# ==============================================================================
@pytest.mark.asyncio
async def test_retry_with_backoff():
    """Verifies exponential retry handles transient failures and succeeds."""
    call_count = 0

    @retry_with_backoff(max_retries=3, base_delay_seconds=0.05, jitter=False)
    async def transient_network_call():
        nonlocal call_count
        call_count += 1
        if call_count < 3:
            raise ConnectionResetError("Transient network blip")
        return "RECOVERED"

    result = await transient_network_call()
    assert result == "RECOVERED"
    assert call_count == 3


# ==============================================================================
# 4. KAP NLP Parser Tests
# ==============================================================================
def test_kap_nlp_ticker_and_category_extraction():
    """Tests Turkish financial NLP parsing for KAP disclosures."""
    # Test 1: Ticker in brackets + Dividends
    text1 = "[THYAO] Türk Hava Yolları A.O. - Kar Payı Dağıtım İşlemlerine İlişkin Yönetim Kurulu Kararı"
    tickers1 = KapNewsParser.extract_tickers(text1)
    category1 = KapNewsParser.detect_category(text1)
    sentiment1, label1 = KapNewsParser.analyze_sentiment(text1)

    assert "THYAO" in tickers1
    assert category1 == DisclosureCategory.TEMETTU
    assert label1 == "BULLISH" # 'kar payı' triggers positive sentiment

    # Test 2: Multiple companies + Contract (Savunma Sanayii)
    text2 = "Aselsan ile Savunma Sanayii Başkanlığı arasında 150 Milyon Dolar tutarında yeni sözleşme imzalanmıştır."
    tickers2 = KapNewsParser.extract_tickers(text2)
    category2 = KapNewsParser.detect_category(text2)
    sentiment2, label2 = KapNewsParser.analyze_sentiment(text2)

    assert "ASELS" in tickers2
    assert category2 == DisclosureCategory.OZEL_DURUM
    assert label2 == "BULLISH" # 'yeni sözleşme'

    # Test 3: Capital increase
    text3 = "[KCHOL] Koç Holding - Bedelsiz Sermaye Artırımı ve İhraç Belgesi"
    tickers3 = KapNewsParser.extract_tickers(text3)
    category3 = KapNewsParser.detect_category(text3)

    assert "KCHOL" in tickers3
    assert category3 == DisclosureCategory.SERMAYE_ARTIRIMI


# ==============================================================================
# 5. Macroeconomic Engine Tests
# ==============================================================================
@pytest.mark.asyncio
async def test_macroeconomic_benchmarks():
    """Verifies baseline macroeconomic data structure and Decimal values."""
    engine = MacroeconomicDataEngine()
    data = await engine.fetch_macro_data()

    assert len(data) >= 7
    keys = {d["key"] for d in data}
    assert "TCMB_POLICY_RATE" in keys
    assert "TURKEY_5Y_CDS" in keys
    assert "TUFE_ANNUAL_CPI" in keys

    # Verify policy rate is exact Decimal 50.000000
    policy_item = next(d for d in data if d["key"] == "TCMB_POLICY_RATE")
    assert policy_item["value"] == Decimal("50.000000")
    assert policy_item["unit"] == "PERCENT"
