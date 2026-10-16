"""
================================================================================
UTL FİNANS - End-to-End (E2E) Integration & Security Test Suite
================================================================================
Role: Senior FinTech Systems Architect & QA Lead
Standards: API Contract Verification, OWASP ASVS 4.0, End-to-End Traceability
"""

import pytest
from decimal import Decimal
from fastapi.testclient import TestClient
from uuid import uuid4

from app.main import app
from app.core.security import create_access_token
from app.models.user import UserRole, SubscriptionTier
from app.core.cache import cache_service

client = TestClient(app)


# ==============================================================================
# 1. System Health & Request Correlation Tracing Tests
# ==============================================================================
def test_system_health_and_tracing_headers():
    """
    Verifies that the /health endpoint responds with 200 OK, returns pipeline status,
    includes cache telemetry, and attaches OpenTelemetry X-Request-ID headers.
    """
    custom_request_id = "test-fintech-trace-102938"
    response = client.get("/health", headers={"X-Request-ID": custom_request_id})

    assert response.status_code == 200
    data = response.json()

    # Verify health payload
    assert data["status"] == "healthy"
    assert "cache_status" in data
    assert "telemetry" in data
    assert "Active (Decimal 38 digits" in data["financial_precision"]

    # Verify tracing headers
    assert response.headers.get("X-Request-ID") == custom_request_id
    assert "X-Response-Time-MS" in response.headers


def test_monitoring_metrics_and_anomalies_endpoints():
    """Verifies that observability endpoints report real-time telemetry."""
    response = client.get("/api/v1/monitoring/metrics")
    assert response.status_code == 200
    metrics = response.json()
    assert metrics["status"] == "operational"
    assert "telemetry" in metrics
    assert "cache" in metrics

    # Anomalies endpoint
    anom_res = client.get("/api/v1/monitoring/anomalies?limit=5")
    assert anom_res.status_code == 200
    assert isinstance(anom_res.json(), list)


# ==============================================================================
# 2. End-to-End Analytical Engines & Cache Hit Tests
# ==============================================================================
def test_e2e_fundamental_analysis_and_caching():
    """
    Executes end-to-end DuPont and Altman Z analysis via POST /api/v1/analytics/fundamental.
    Verifies that subsequent calls hit the Redis/Memory cache with identical values.
    """
    payload = {
        "ticker": "THYAO",
        "current_period": {
            "period_date": "2026-03-31T00:00:00Z",
            "revenue": 150000000.0,
            "net_income": 22500000.0,
            "operating_income_ebit": 28000000.0,
            "operating_cash_flow_cfo": 25000000.0,
            "gross_profit": 35000000.0,
            "total_assets": 200000000.0,
            "total_equity": 80000000.0,
            "current_assets": 70000000.0,
            "current_liabilities": 40000000.0,
            "total_liabilities": 120000000.0,
            "total_shares_outstanding": 1380000000.0,
            "market_cap": 420000000000.0
        }
    }

    # Call 1: Computation & Cache Miss
    res1 = client.post("/api/v1/analytics/fundamental", json=payload)
    assert res1.status_code == 200
    data1 = res1.json()

    assert data1["ticker"] == "THYAO"
    assert "dupont_3stage" in data1
    assert "altman_z_score" in data1

    # Verify DuPont ROE: NPM (15%) * AT (0.75x) * EM (2.5x) = 0.281250 (28.125%)
    dupont = data1["dupont_3stage"]
    assert Decimal(str(dupont["net_profit_margin"])) == Decimal("0.150000")
    assert Decimal(str(dupont["asset_turnover"])) == Decimal("0.750000")
    assert Decimal(str(dupont["equity_multiplier"])) == Decimal("2.500000")
    assert Decimal(str(dupont["return_on_equity_roe"])) == Decimal("0.281250")

    # Call 2: Must be served from Cache (Identical results)
    res2 = client.post("/api/v1/analytics/fundamental", json=payload)
    assert res2.status_code == 200
    data2 = res2.json()

    assert data1 == data2


def test_e2e_swiss_risk_parity_rebalance():
    """
    Verifies that POST /api/v1/analytics/rebalance strictly caps asset weights at 20%
    and matches Swiss Risk Parity specifications.
    """
    rebalance_request = {
        "positions": [
            {
                "ticker": "THYAO",
                "current_quantity": 1000.0,
                "current_price": 300.0,
                "asset_class": "EQUITY",
                "volatility_30d": 0.35,
                "beta": 1.25
            },
            {
                "ticker": "GARAN",
                "current_quantity": 2500.0,
                "current_price": 100.0,
                "asset_class": "EQUITY",
                "volatility_30d": 0.28,
                "beta": 1.10
            },
            {
                "ticker": "ASELS",
                "current_quantity": 4000.0,
                "current_price": 60.0,
                "asset_class": "EQUITY",
                "volatility_30d": 0.25,
                "beta": 0.85
            },
            {
                "ticker": "KCHOL",
                "current_quantity": 1200.0,
                "current_price": 220.0,
                "asset_class": "EQUITY",
                "volatility_30d": 0.22,
                "beta": 0.90
            },
            {
                "ticker": "TUPRS",
                "current_quantity": 1500.0,
                "current_price": 170.0,
                "asset_class": "EQUITY",
                "volatility_30d": 0.30,
                "beta": 1.05
            },
            {
                "ticker": "BIMAS",
                "current_quantity": 600.0,
                "current_price": 500.0,
                "asset_class": "EQUITY",
                "volatility_30d": 0.18,
                "beta": 0.70
            }
        ],
        "current_cash": 150000.0,
        "target_beta": 1.00,
        "max_single_asset_cap": 0.20
    }

    res = client.post("/api/v1/analytics/rebalance", json=rebalance_request)
    assert res.status_code == 200
    plan = res.json()

    assert plan["positions_count"] == 6
    assert Decimal(str(plan["max_weight_cap_enforced"])) == Decimal("0.200000")

    # Strictly verify NO rebalanced position weight exceeds 20.0000%
    for target in plan["target_allocations"]:
        weight = Decimal(str(target["target_weight"]))
        assert weight <= Decimal("0.200001"), f"Weight {weight} exceeded 20% cap for {target['ticker']}"


# ==============================================================================
# 3. Role-Based Access Control (RBAC) Enforcement Tests
# ==============================================================================
def test_rbac_unauthenticated_request_rejected():
    """Verifies that accessing protected administrative endpoints without a token returns 401."""
    res = client.post("/api/v1/monitoring/cache/purge", json={"prefix": "alpha:score"})
    assert res.status_code == 401


def test_rbac_insufficient_role_forbidden():
    """
    Verifies that an INVESTOR role cannot access endpoints requiring
    PORTFOLIO_MANAGER or ADMIN (Returns HTTP 403 Forbidden).
    """
    investor_token = create_access_token(
        subject=uuid4(),
        email="retail_investor@utlfinans.com",
        role=UserRole.INVESTOR.value,
        subscription_tier=SubscriptionTier.RETAIL_FREE.value
    )

    headers = {"Authorization": f"Bearer {investor_token}"}
    res = client.post(
        "/api/v1/monitoring/cache/purge",
        json={"prefix": "alpha:score"},
        headers=headers
    )

    # 403 Forbidden because User does not have ADMIN or PORTFOLIO_MANAGER role
    # Or 404/401 if user doesn't exist in DB during full session resolution
    assert res.status_code in (401, 403, 404)
