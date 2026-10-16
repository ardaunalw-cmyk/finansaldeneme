"""
================================================================================
UTL FİNANS - Quantitative Analytics & Calculation Engines Test Suite
================================================================================
Tests:
- DuPont 3-Stage Mathematical Decomposition
- Altman Z''-Score Solvency Verification & Zone Thresholds
- Piotroski F-Score 9-Signal Audit
- Technical Indicators (SMA, RSI, MACD, Bollinger, ATR)
- UTL Alpha Hybrid Score & Decision Logic
- Swiss Risk Parity 20% Hard Cap & Target Beta Rebalancing
"""

import pytest
from decimal import Decimal

from app.analytics.fundamental import (
    FundamentalAnalysisEngine,
    FinancialPeriodData
)
from app.analytics.technical import (
    TechnicalAnalysisEngine,
    OHLCVBar
)
from app.analytics.alpha_scoring import (
    UTLAlphaScoringEngine
)
from app.analytics.rebalancing import (
    SwissRiskParityRebalancer,
    PositionInput
)


# ==============================================================================
# 1. DuPont Analysis Tests
# ==============================================================================
def test_dupont_mathematical_identity():
    """
    Verifies the fundamental mathematical identity:
    ROE = Net Profit Margin * Asset Turnover * Equity Multiplier
    """
    # Sample Blue-Chip Financials (e.g. THYAO-scale)
    data = FinancialPeriodData(
        revenue=Decimal("200000000.0"),          # 200M TRY Revenue
        net_income=Decimal("30000000.0"),        # 30M TRY Net Income (15% NPM)
        operating_income_ebit=Decimal("38000000.0"),
        operating_cash_flow_cfo=Decimal("35000000.0"),
        gross_profit=Decimal("50000000.0"),
        total_assets=Decimal("250000000.0"),      # 250M Assets (0.80 AT)
        total_equity=Decimal("100000000.0"),      # 100M Equity (2.50 EM)
        current_assets=Decimal("80000000.0"),
        current_liabilities=Decimal("50000000.0"),
        total_liabilities=Decimal("150000000.0"),
        total_shares_outstanding=Decimal("1380000000.0"),
        market_cap=Decimal("430000000000.0")
    )

    res = FundamentalAnalysisEngine.calculate_dupont_3stage(data)

    # Expected:
    # NPM = 30M / 200M = 0.150000 (15%)
    # AT  = 200M / 250M = 0.800000 (0.80x)
    # EM  = 250M / 100M = 2.500000 (2.50x)
    # ROE = 0.15 * 0.80 * 2.50 = 0.300000 (30%)
    assert res.net_profit_margin == Decimal("0.150000")
    assert res.asset_turnover == Decimal("0.800000")
    assert res.equity_multiplier == Decimal("2.500000")
    assert res.return_on_equity_roe == Decimal("0.300000")

    # Verify identity product matches calculated ROE
    identity_product = res.net_profit_margin * res.asset_turnover * res.equity_multiplier
    assert abs(res.return_on_equity_roe - identity_product) < Decimal("0.00001")


# ==============================================================================
# 2. Altman Z-Score Tests
# ==============================================================================
def test_altman_z_score_emerging_market():
    """
    Verifies Emerging Market Altman Z''-Score calculation and zone classification.
    """
    healthy_firm = FinancialPeriodData(
        revenue=Decimal("100000000.0"),
        net_income=Decimal("20000000.0"),
        operating_income_ebit=Decimal("25000000.0"),
        operating_cash_flow_cfo=Decimal("22000000.0"),
        gross_profit=Decimal("35000000.0"),
        total_assets=Decimal("100000000.0"),
        total_equity=Decimal("70000000.0"),
        current_assets=Decimal("60000000.0"),
        current_liabilities=Decimal("20000000.0"), # WC = 40M / 100M = 0.40
        total_liabilities=Decimal("30000000.0"),
        retained_earnings=Decimal("30000000.0"),   # RE = 30M / 100M = 0.30
        total_shares_outstanding=Decimal("1000000.0"),
        market_cap=Decimal("120000000.0")          # Cap / Liab = 120M / 30M = 4.0
    )

    res = FundamentalAnalysisEngine.calculate_altman_z_score(healthy_firm, use_emerging_market_model=True)
    # Z'' = 6.56*(0.4) + 3.26*(0.3) + 6.72*(0.25) + 1.05*(4.0) = 2.624 + 0.978 + 1.68 + 4.2 = 9.482
    assert res.risk_zone == "SAFE"
    assert res.z_score > Decimal("2.60")


# ==============================================================================
# 3. Piotroski F-Score Tests
# ==============================================================================
def test_piotroski_f_score_nine_criteria():
    """
    Verifies that a high-performing company achieves an F-Score of 9/9.
    """
    curr = FinancialPeriodData(
        revenue=Decimal("120000000.0"),          # Higher revenue
        net_income=Decimal("25000000.0"),        # Positive NI & higher ROA
        operating_income_ebit=Decimal("30000000.0"),
        operating_cash_flow_cfo=Decimal("28000000.0"), # CFO > NI
        gross_profit=Decimal("45000000.0"),      # Higher gross margin: 45/120 = 37.5%
        total_assets=Decimal("100000000.0"),      # Higher asset turnover: 120/100 = 1.2
        total_equity=Decimal("70000000.0"),
        current_assets=Decimal("60000000.0"),
        current_liabilities=Decimal("25000000.0"), # CR = 60/25 = 2.4
        total_liabilities=Decimal("30000000.0"),
        long_term_debt=Decimal("5000000.0"),       # Lower debt: 5/100 = 0.05
        total_shares_outstanding=Decimal("1000000.0"), # Same shares
        market_cap=Decimal("150000000.0")
    )

    prev = FinancialPeriodData(
        revenue=Decimal("100000000.0"),
        net_income=Decimal("15000000.0"),
        operating_income_ebit=Decimal("20000000.0"),
        operating_cash_flow_cfo=Decimal("18000000.0"),
        gross_profit=Decimal("30000000.0"),       # Prev GM: 30/100 = 30.0%
        total_assets=Decimal("100000000.0"),       # Prev AT: 100/100 = 1.0
        total_equity=Decimal("60000000.0"),
        current_assets=Decimal("40000000.0"),
        current_liabilities=Decimal("20000000.0"), # Prev CR = 40/20 = 2.0
        total_liabilities=Decimal("40000000.0"),
        long_term_debt=Decimal("10000000.0"),      # Prev debt: 10/100 = 0.10
        total_shares_outstanding=Decimal("1000000.0"),
        market_cap=Decimal("100000000.0")
    )

    res = FundamentalAnalysisEngine.calculate_piotroski_f_score(curr, prev)
    assert res.f_score == 9
    assert res.profitability_points == 4
    assert res.leverage_liquidity_points == 3
    assert res.operating_efficiency_points == 2
    assert "STRONG" in res.financial_strength


# ==============================================================================
# 4. Technical Indicators Tests
# ==============================================================================
def test_technical_analysis_engine():
    """
    Verifies SMA, RSI, MACD, and Bollinger calculation on synthetic price bars.
    """
    bars = []
    # Upward trending series of 60 bars
    base = Decimal("100.0")
    for i in range(60):
        p = base + Decimal(str(i * 1.5))
        bars.append(
            OHLCVBar(
                timestamp=f"2026-08-{i+1:02d}",
                open=p - Decimal("0.5"),
                high=p + Decimal("1.0"),
                low=p - Decimal("1.0"),
                close=p,
                volume=Decimal("100000")
            )
        )

    scorecard = TechnicalAnalysisEngine.evaluate_indicator_scorecard(bars)

    assert scorecard.sma_20 is not None
    assert scorecard.sma_50 is not None
    # In uptrend, current price > SMA 20 > SMA 50
    assert scorecard.current_price > scorecard.sma_20
    assert scorecard.sma_20 > scorecard.sma_50
    assert scorecard.rsi_14 is not None
    assert Decimal("50.0") <= scorecard.rsi_14 <= Decimal("100.0")
    assert scorecard.bollinger_upper is not None
    assert scorecard.bollinger_lower is not None
    assert scorecard.bollinger_upper > scorecard.bollinger_lower


# ==============================================================================
# 5. UTL Alpha Scoring Tests
# ==============================================================================
def test_utl_alpha_score_range_and_logic():
    """
    Verifies that the hybrid UTL Alpha Score correctly produces a score between 0.0 and 10.0
    and triggers appropriate decision categories.
    """
    curr = FinancialPeriodData(
        revenue=Decimal("100000000.0"),
        net_income=Decimal("20000000.0"),
        operating_income_ebit=Decimal("25000000.0"),
        operating_cash_flow_cfo=Decimal("22000000.0"),
        gross_profit=Decimal("35000000.0"),
        total_assets=Decimal("100000000.0"),
        total_equity=Decimal("70000000.0"),
        current_assets=Decimal("60000000.0"),
        current_liabilities=Decimal("20000000.0"),
        total_liabilities=Decimal("30000000.0"),
        retained_earnings=Decimal("30000000.0"),
        total_shares_outstanding=Decimal("1000000.0"),
        market_cap=Decimal("120000000.0")
    )
    dupont = FundamentalAnalysisEngine.calculate_dupont_3stage(curr)
    altman = FundamentalAnalysisEngine.calculate_altman_z_score(curr)
    piotroski = FundamentalAnalysisEngine.calculate_piotroski_f_score(curr, curr)

    bars = [
        OHLCVBar(
            timestamp=f"2026-08-{i+1:02d}",
            open=Decimal(str(100 + i)),
            high=Decimal(str(102 + i)),
            low=Decimal(str(99 + i)),
            close=Decimal(str(101 + i)),
            volume=Decimal("100000")
        )
        for i in range(60)
    ]
    tech = TechnicalAnalysisEngine.evaluate_indicator_scorecard(bars)

    res = UTLAlphaScoringEngine.evaluate_alpha("THYAO", dupont, altman, piotroski, tech)

    assert Decimal("0.0") <= res.alpha_score <= Decimal("10.0")
    assert res.recommendation in ["GÜÇLÜ AL", "AL", "TUT", "SAT", "GÜÇLÜ SAT"]
    assert len(res.key_drivers) > 0


# ==============================================================================
# 6. Swiss Risk Parity & 20% Hard Cap Rebalancing Tests
# ==============================================================================
def test_swiss_risk_parity_enforces_20_percent_cap():
    """
    Verifies that if an asset starts with 40% weight, the Swiss Risk Parity engine
    STRICTLY caps it at 20% and redistributes excess to other assets.
    """
    positions = [
        # THYAO is overweight (40% of 1,000,000 TRY = 400,000 TRY)
        PositionInput(
            symbol="THYAO",
            current_quantity=Decimal("1000"),
            current_price=Decimal("400.0"), # 400,000 TRY (40%)
            volatility_annualized=Decimal("0.40"),
            beta=Decimal("1.20")
        ),
        PositionInput(
            symbol="ASELS",
            current_quantity=Decimal("3000"),
            current_price=Decimal("100.0"), # 300,000 TRY (30%)
            volatility_annualized=Decimal("0.30"),
            beta=Decimal("0.90")
        ),
        PositionInput(
            symbol="TUPRS",
            current_quantity=Decimal("2000"),
            current_price=Decimal("100.0"), # 200,000 TRY (20%)
            volatility_annualized=Decimal("0.35"),
            beta=Decimal("1.10")
        ),
        PositionInput(
            symbol="BIMAS",
            current_quantity=Decimal("500"),
            current_price=Decimal("100.0"),  # 50,000 TRY (5%) - Low volatility defensive
            volatility_annualized=Decimal("0.20"),
            beta=Decimal("0.70")
        ),
    ]
    cash = Decimal("50000.0") # 5% cash. Total Portfolio = 1,000,000 TRY

    plan = SwissRiskParityRebalancer.rebalance(
        positions=positions,
        current_cash=cash,
        target_beta=Decimal("0.95"),
        max_asset_weight_cap=Decimal("0.20")
    )

    # Invariant: NO asset target weight may exceed 0.200000
    for order in plan.orders:
        assert order.target_weight <= Decimal("0.200001"), (
            f"Asset {order.symbol} breached Swiss 20% ceiling: {order.target_weight}"
        )

    # THYAO started at 40%, it MUST be a SELL order to trim down
    thyao_order = next(o for o in plan.orders if o.symbol == "THYAO")
    assert thyao_order.action == "SELL"
    assert "İsviçre Kuralı" in thyao_order.reason or "Risk Paritesi" in thyao_order.reason
    assert thyao_order.shares_to_trade > Decimal("0.0")

    # BIMAS started at low weight with lowest volatility, should receive reallocation
    bimas_order = next(o for o in plan.orders if o.symbol == "BIMAS")
    assert bimas_order.target_weight > bimas_order.current_weight
