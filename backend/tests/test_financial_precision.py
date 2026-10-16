"""
================================================================================
UTL FİNANS - Unit & Precision Verification Tests
================================================================================
Demonstrates the critical danger of IEEE-754 floating-point errors in FinTech
and verifies that Decimal precision completely eliminates drift.
"""

from decimal import Decimal
import uuid
from app.core.precision import (
    round_money,
    round_price,
    round_quantity,
    round_ratio
)
from app.services.portfolio_engine import (
    PortfolioPrecisionEngine,
    FinancialCalculationError
)
from app.models.portfolio import Portfolio, CostBasisMethod, TransactionType


def test_floating_point_pitfall_vs_decimal():
    """
    Classic FinTech bug demonstration:
    0.1 + 0.2 in standard IEEE-754 binary floating point produces 0.30000000000000004.
    In Decimal, it evaluates to EXACTLY 0.30000000000000000000000000000000000000.
    """
    float_sum = 0.1 + 0.2
    assert float_sum != 0.3  # IEEE 754 fails exact equality!

    decimal_sum = Decimal("0.1") + Decimal("0.2")
    assert decimal_sum == Decimal("0.3")  # Decimal succeeds with zero drift!


def test_wac_cost_basis_lifecycle():
    """
    Simulates institutional trade execution:
    1. Initial deposit: 100,000 TRY
    2. Buy 100 shares @ 50.00 TRY (Gross: 5,000 TRY, Commission: 7.50 TRY)
    3. Buy 100 shares @ 70.00 TRY (Gross: 7,000 TRY, Commission: 10.50 TRY)
       Expected Total Shares: 200
       Expected Total Cost: 12,018.00 TRY
       Expected WAC: 60.090000 TRY / share
    4. Sell 50 shares @ 80.00 TRY (Gross: 4,000 TRY, Commission: 6.00 TRY)
       Cost of 50 shares: 50 * 60.090000 = 3,004.50 TRY
       Realized P&L: 3,994.00 - 3,004.50 = +989.50 TRY
       Remaining Shares: 150
       Remaining Avg Cost: EXACTLY 60.090000 TRY (Unchanged by sell under WAC)
    """
    portfolio_id = uuid.uuid4()
    asset_id = uuid.uuid4()

    portfolio = Portfolio(
        id=portfolio_id,
        user_id=uuid.uuid4(),
        name="Test Corporate Portfolio",
        base_currency="TRY",
        cash_balance=Decimal("100000.0000"),
        invested_capital=Decimal("0.0000"),
        total_market_value=Decimal("0.0000"),
        cumulative_realized_pnl=Decimal("0.0000"),
        cost_basis_method=CostBasisMethod.WAC
    )

    # Execution 1: Buy 100 shares @ 50.00 TRY, Fee: 7.50 TRY
    tx1, pos = PortfolioPrecisionEngine.process_buy_execution(
        portfolio=portfolio,
        position=None,
        asset_id=asset_id,
        quantity=Decimal("100"),
        unit_price=Decimal("50.00"),
        commission_fee=Decimal("7.50")
    )

    assert pos.quantity == Decimal("100.00000000")
    assert pos.total_cost_basis == Decimal("5007.5000")
    assert pos.average_cost_basis == Decimal("50.075000")
    assert portfolio.cash_balance == Decimal("94992.5000")

    # Execution 2: Buy 100 shares @ 70.00 TRY, Fee: 10.50 TRY
    tx2, pos = PortfolioPrecisionEngine.process_buy_execution(
        portfolio=portfolio,
        position=pos,
        asset_id=asset_id,
        quantity=Decimal("100"),
        unit_price=Decimal("70.00"),
        commission_fee=Decimal("10.50")
    )

    assert pos.quantity == Decimal("200.00000000")
    assert pos.total_cost_basis == Decimal("12018.0000")
    assert pos.average_cost_basis == Decimal("60.090000")

    # Execution 3: Sell 50 shares @ 80.00 TRY, Fee: 6.00 TRY
    tx3, pos = PortfolioPrecisionEngine.process_sell_execution(
        portfolio=portfolio,
        position=pos,
        quantity=Decimal("50"),
        unit_price=Decimal("80.00"),
        commission_fee=Decimal("6.00")
    )

    assert pos.quantity == Decimal("150.00000000")
    # In WAC, unit cost basis MUST remain untouched on sale!
    assert pos.average_cost_basis == Decimal("60.090000")
    assert pos.total_cost_basis == Decimal("9013.5000")
    assert tx3.realized_pnl == Decimal("989.5000")
    assert portfolio.cumulative_realized_pnl == Decimal("989.5000")
    assert portfolio.cash_balance == Decimal("98986.5000")
