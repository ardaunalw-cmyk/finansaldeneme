"""
================================================================================
UTL FİNANS - Quantitative Financial Precision Engine (Cost Basis & Ledger)
================================================================================
Implements institutional accounting standards:
- Weighted Average Cost (WAC / Ağırlıklı Ortalama Maliyet)
- Zero Floating-Point Drift Ledger Accounting
- Realized & Unrealized P&L Computations
- Mark-to-Market Valuation
"""

from decimal import Decimal, ROUND_HALF_EVEN
from typing import Tuple, Optional
from datetime import datetime, timezone, timedelta
import uuid

from app.core.precision import (
    round_money,
    round_price,
    round_quantity,
    round_ratio,
    sanitize_decimal
)
from app.models.portfolio import (
    Portfolio,
    PortfolioPosition,
    Transaction,
    TransactionType
)


class FinancialCalculationError(Exception):
    """Raised when financial invariants or risk limits are violated."""
    pass


class PortfolioPrecisionEngine:
    """
    Mathematical execution engine operating strictly on Python Decimal primitives.
    Guarantees exact balancing of the dual-entry financial ledger without float errors.
    """

    @staticmethod
    def calculate_trade_amounts(
        quantity: Decimal,
        unit_price: Decimal,
        commission_rate: Decimal = Decimal("0.0015"), # 0.15% standard brokerage fee
        tax_rate: Decimal = Decimal("0.0000")        # 0.00% standard equity withholding
    ) -> Tuple[Decimal, Decimal, Decimal, Decimal]:
        """
        Calculates exact gross, fee, tax, and net amounts for an execution.
        Returns: (gross_amount, commission_fee, tax_withholding, net_amount)
        """
        qty = round_quantity(quantity)
        price = round_price(unit_price)

        gross = round_money(qty * price)
        commission = round_money(gross * commission_rate)
        tax = round_money(gross * tax_rate)

        return gross, commission, tax, (gross + commission + tax)

    @classmethod
    def process_buy_execution(
        cls,
        portfolio: Portfolio,
        position: Optional[PortfolioPosition],
        asset_id: uuid.UUID,
        quantity: Decimal,
        unit_price: Decimal,
        commission_fee: Decimal = Decimal("0.0000"),
        tax_withholding: Decimal = Decimal("0.0000"),
        trade_date: Optional[datetime] = None,
        notes: Optional[str] = None
    ) -> Tuple[Transaction, PortfolioPosition]:
        """
        Executes a BUY order:
        1. Deducts net trade cash from portfolio cash balance.
        2. Recalculates Weighted Average Cost (WAC) for the position.
        3. Creates audit-compliant Transaction entry.
        """
        qty = round_quantity(quantity)
        price = round_price(unit_price)
        fee = round_money(commission_fee)
        tax = round_money(tax_withholding)
        gross = round_money(qty * price)
        net_cash_outflow = round_money(gross + fee + tax)

        # Check cash solvency
        if portfolio.cash_balance < net_cash_outflow:
            raise FinancialCalculationError(
                f"Insufficient cash balance: Available {portfolio.cash_balance:f} TRY, Required {net_cash_outflow:f} TRY"
            )

        # 1. Update Portfolio Cash & Capital
        portfolio.cash_balance = round_money(portfolio.cash_balance - net_cash_outflow)
        portfolio.invested_capital = round_money(portfolio.invested_capital + net_cash_outflow)

        # 2. Update or Initialize Position
        if position is None:
            position = PortfolioPosition(
                portfolio_id=portfolio.id,
                asset_id=asset_id,
                quantity=Decimal("0.0"),
                average_cost_basis=Decimal("0.0"),
                total_cost_basis=Decimal("0.0"),
                last_evaluated_price=price,
                market_value=Decimal("0.0"),
                unrealized_pnl=Decimal("0.0"),
                unrealized_pnl_percent=Decimal("0.0"),
                cumulative_realized_pnl=Decimal("0.0"),
                current_weight=Decimal("0.0"),
                target_weight=Decimal("0.0")
            )

        prev_qty = position.quantity
        prev_cost_total = position.total_cost_basis

        # New weighted cost basis including fees
        new_qty = round_quantity(prev_qty + qty)
        added_cost = round_money(gross + fee) # Brokerage fee capitalized into cost basis
        new_total_cost = round_money(prev_cost_total + added_cost)
        new_avg_cost = round_price(new_total_cost / new_qty)

        position.quantity = new_qty
        position.total_cost_basis = new_total_cost
        position.average_cost_basis = new_avg_cost
        position.last_evaluated_price = price
        position.market_value = round_money(new_qty * price)
        position.unrealized_pnl = round_money(position.market_value - new_total_cost)
        position.unrealized_pnl_percent = round_ratio(position.unrealized_pnl / new_total_cost)

        # 3. Create Immutable Transaction Record
        now = datetime.now(timezone.utc)
        t_date = trade_date or now
        s_date = t_date + timedelta(days=2) # T+2 standard settlement

        tx = Transaction(
            portfolio_id=portfolio.id,
            asset_id=asset_id,
            transaction_type=TransactionType.BUY,
            quantity=qty,
            unit_price=price,
            gross_amount=gross,
            commission_fee=fee,
            tax_withholding=tax,
            net_amount=net_cash_outflow,
            cost_basis_at_execution=new_avg_cost,
            realized_pnl=Decimal("0.0000"),
            trade_date=t_date,
            settlement_date=s_date,
            notes=notes
        )

        return tx, position

    @classmethod
    def process_sell_execution(
        cls,
        portfolio: Portfolio,
        position: PortfolioPosition,
        quantity: Decimal,
        unit_price: Decimal,
        commission_fee: Decimal = Decimal("0.0000"),
        tax_withholding: Decimal = Decimal("0.0000"),
        trade_date: Optional[datetime] = None,
        notes: Optional[str] = None
    ) -> Tuple[Transaction, PortfolioPosition]:
        """
        Executes a SELL order:
        1. Verifies sufficient position holding.
        2. Computes exact Realized P&L against WAC cost basis.
        3. Adds net proceeds to cash balance.
        4. Updates position remaining quantity and cost basis.
        """
        sell_qty = round_quantity(quantity)
        price = round_price(unit_price)
        fee = round_money(commission_fee)
        tax = round_money(tax_withholding)

        if position.quantity < sell_qty:
            raise FinancialCalculationError(
                f"Insufficient position balance: Available {position.quantity:f}, Requested sell {sell_qty:f}"
            )

        gross = round_money(sell_qty * price)
        net_cash_inflow = round_money(gross - fee - tax)

        # Cost of goods sold (COGS)
        cost_basis_per_unit = position.average_cost_basis
        cost_of_sold_units = round_money(sell_qty * cost_basis_per_unit)

        # Realized P&L = Net Cash Inflow - Cost Basis of Sold Units
        trade_realized_pnl = round_money(net_cash_inflow - cost_of_sold_units)

        # 1. Update Portfolio Cash & Realized PnL
        portfolio.cash_balance = round_money(portfolio.cash_balance + net_cash_inflow)
        portfolio.cumulative_realized_pnl = round_money(portfolio.cumulative_realized_pnl + trade_realized_pnl)

        # 2. Update Position Remaining Holding
        remaining_qty = round_quantity(position.quantity - sell_qty)
        position.quantity = remaining_qty
        position.cumulative_realized_pnl = round_money(position.cumulative_realized_pnl + trade_realized_pnl)

        if remaining_qty > Decimal("0.0"):
            # Under WAC, average cost per unit remains unchanged on sale
            position.total_cost_basis = round_money(remaining_qty * cost_basis_per_unit)
            position.last_evaluated_price = price
            position.market_value = round_money(remaining_qty * price)
            position.unrealized_pnl = round_money(position.market_value - position.total_cost_basis)
            position.unrealized_pnl_percent = round_ratio(position.unrealized_pnl / position.total_cost_basis)
        else:
            # Position fully liquidated
            position.total_cost_basis = Decimal("0.0000")
            position.average_cost_basis = Decimal("0.000000")
            position.market_value = Decimal("0.0000")
            position.unrealized_pnl = Decimal("0.0000")
            position.unrealized_pnl_percent = Decimal("0.000000")
            position.current_weight = Decimal("0.000000")

        # 3. Create Transaction Record
        now = datetime.now(timezone.utc)
        t_date = trade_date or now
        s_date = t_date + timedelta(days=2)

        tx = Transaction(
            portfolio_id=portfolio.id,
            asset_id=position.asset_id,
            transaction_type=TransactionType.SELL,
            quantity=sell_qty,
            unit_price=price,
            gross_amount=gross,
            commission_fee=fee,
            tax_withholding=tax,
            net_amount=net_cash_inflow,
            cost_basis_at_execution=cost_basis_per_unit,
            realized_pnl=trade_realized_pnl,
            trade_date=t_date,
            settlement_date=s_date,
            notes=notes
        )

        return tx, position

