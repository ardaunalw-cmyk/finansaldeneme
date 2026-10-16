"""
================================================================================
UTL FİNANS - Portfolio, Asset Allocation, Transactions & Cost Basis Engine
================================================================================
"""

import enum
import uuid
from datetime import datetime, timezone
from typing import Optional, List, TYPE_CHECKING
from sqlalchemy import (
    String,
    Boolean,
    Enum as SqlEnum,
    ForeignKey,
    DateTime,
    Index,
    Text,
    CheckConstraint
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
from app.models.base import UUIDMixin, TimestampMixin
from app.core.precision import (
    SqlPrice,
    SqlQuantity,
    SqlMoney,
    SqlRatio
)

if TYPE_CHECKING:
    from app.models.user import User
    from app.models.asset import Asset


class CostBasisMethod(str, enum.Enum):
    """Institutional Inventory Accounting Methods for Position Cost Basis."""
    WAC = "WAC"                           # Weighted Average Cost (Ağırlıklı Ortalama Maliyet - SPK & IFRS Standard)
    FIFO = "FIFO"                         # First In, First Out
    LIFO = "LIFO"                         # Last In, First Out


class TransactionType(str, enum.Enum):
    """Ledger Transaction Classifications."""
    BUY = "BUY"                           # Alış (Increases position, reduces cash)
    SELL = "SELL"                         # Satış (Reduces position, increases cash, generates realized P&L)
    DIVIDEND_CASH = "DIVIDEND_CASH"       # Nakit Temettü Girişi
    DIVIDEND_REINVEST = "DIVIDEND_REINVEST" # Temettü İle Hisse Alımı (DRIP)
    STOCK_SPLIT = "STOCK_SPLIT"           # Bedelsiz Bölünme / Hisse Artışı
    RIGHTS_ISSUE = "RIGHTS_ISSUE"         # Bedelli Sermaye Artırımı
    CASH_DEPOSIT = "CASH_DEPOSIT"         # Portföye Nakit Girişi
    CASH_WITHDRAWAL = "CASH_WITHDRAWAL"   # Portföyden Nakit Çıkışı
    FEE = "FEE"                           # Saklama / Yönetim / Borsa Komisyonu


class Portfolio(Base, UUIDMixin, TimestampMixin):
    """
    Core Portfolio container holding client cash, benchmark tracking,
    and aggregate valuation metrics.
    """
    __tablename__ = "portfolios"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    name: Mapped[str] = mapped_column(String(100), nullable=False) # e.g. "BIST Temettü Stratejisi"
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    base_currency: Mapped[str] = mapped_column(String(3), default="TRY", nullable=False)
    benchmark_ticker: Mapped[str] = mapped_column(String(20), default="XU100", nullable=False) # BIST 100 benchmark
    
    # Cost basis methodology configured for this portfolio
    cost_basis_method: Mapped[CostBasisMethod] = mapped_column(
        SqlEnum(CostBasisMethod, name="cost_basis_method_enum"),
        default=CostBasisMethod.WAC,
        nullable=False
    )

    # High-Precision Cash Ledger & Valuations (Stored as exact Decimals)
    cash_balance: Mapped[SqlMoney] = mapped_column(SqlMoney, default=0.0000, nullable=False)
    invested_capital: Mapped[SqlMoney] = mapped_column(SqlMoney, default=0.0000, nullable=False)
    total_market_value: Mapped[SqlMoney] = mapped_column(SqlMoney, default=0.0000, nullable=False)
    cumulative_realized_pnl: Mapped[SqlMoney] = mapped_column(SqlMoney, default=0.0000, nullable=False)

    # State flags
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Target allocation strategy rules (e.g. {"EQUITY": 0.70, "FIXED_INCOME": 0.20, "CASH": 0.10})
    strategy_allocation_rules: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="portfolios")
    positions: Mapped[List["PortfolioPosition"]] = relationship(
        "PortfolioPosition",
        back_populates="portfolio",
        cascade="all, delete-orphan"
    )
    transactions: Mapped[List["Transaction"]] = relationship(
        "Transaction",
        back_populates="portfolio",
        cascade="all, delete-orphan",
        order_by="Transaction.trade_date.desc()"
    )

    __table_args__ = (
        Index("idx_user_portfolios", "user_id", "is_archived"),
    )


class PortfolioPosition(Base, UUIDMixin, TimestampMixin):
    """
    Asset Allocation & Current Holding state for an asset within a portfolio.
    Maintains exact weighted average cost basis and real-time unrealized P&L.
    """
    __tablename__ = "portfolio_positions"

    portfolio_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("portfolios.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    asset_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("assets.id", ondelete="RESTRICT"),
        nullable=False,
        index=True
    )

    # Exact Quantity (Supports fractional shares or large corporate share counts)
    quantity: Mapped[SqlQuantity] = mapped_column(SqlQuantity, default=0.00000000, nullable=False)

    # Cost Basis (WAC - Weighted Average Cost per share)
    average_cost_basis: Mapped[SqlPrice] = mapped_column(SqlPrice, default=0.000000, nullable=False)
    total_cost_basis: Mapped[SqlMoney] = mapped_column(SqlMoney, default=0.0000, nullable=False)

    # Mark-to-Market Valuation Snapshot
    last_evaluated_price: Mapped[SqlPrice] = mapped_column(SqlPrice, default=0.000000, nullable=False)
    market_value: Mapped[SqlMoney] = mapped_column(SqlMoney, default=0.0000, nullable=False)
    
    # Real-Time Performance
    unrealized_pnl: Mapped[SqlMoney] = mapped_column(SqlMoney, default=0.0000, nullable=False)
    unrealized_pnl_percent: Mapped[SqlRatio] = mapped_column(SqlRatio, default=0.000000, nullable=False)
    cumulative_realized_pnl: Mapped[SqlMoney] = mapped_column(SqlMoney, default=0.0000, nullable=False)

    # Asset Allocation Weights
    current_weight: Mapped[SqlRatio] = mapped_column(SqlRatio, default=0.000000, nullable=False) # e.g. 0.152400 (15.24%)
    target_weight: Mapped[SqlRatio] = mapped_column(SqlRatio, default=0.000000, nullable=False)  # e.g. 0.150000 (15.00%)

    # Relationships
    portfolio: Mapped[Portfolio] = relationship("Portfolio", back_populates="positions")
    asset: Mapped["Asset"] = relationship("Asset", back_populates="positions")

    __table_args__ = (
        Index("idx_portfolio_asset_unique", "portfolio_id", "asset_id", unique=True),
        CheckConstraint("quantity >= 0", name="chk_position_qty_non_negative"),
    )


class Transaction(Base, UUIDMixin, TimestampMixin):
    """
    Immutable Financial Audit Ledger.
    Records every trade execution, cash movement, split, and dividend event
    with strict monetary precision and settlement dates.
    """
    __tablename__ = "transactions"

    portfolio_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("portfolios.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    asset_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("assets.id", ondelete="RESTRICT"),
        nullable=True,
        index=True
    )

    # Transaction Category
    transaction_type: Mapped[TransactionType] = mapped_column(
        SqlEnum(TransactionType, name="transaction_type_enum"),
        nullable=False,
        index=True
    )

    # Execution Units & Pricing
    quantity: Mapped[SqlQuantity] = mapped_column(SqlQuantity, default=0.00000000, nullable=False)
    unit_price: Mapped[SqlPrice] = mapped_column(SqlPrice, default=0.000000, nullable=False)

    # Financial Settlement Components
    gross_amount: Mapped[SqlMoney] = mapped_column(SqlMoney, nullable=False) # quantity * unit_price
    commission_fee: Mapped[SqlMoney] = mapped_column(SqlMoney, default=0.0000, nullable=False) # Brokerage commission
    tax_withholding: Mapped[SqlMoney] = mapped_column(SqlMoney, default=0.0000, nullable=False) # Borsa / Stopaj vergisi
    net_amount: Mapped[SqlMoney] = mapped_column(SqlMoney, nullable=False) # Cash impact on portfolio

    # Cost Basis & Realized Gains Snapshot (Generated on SELL)
    cost_basis_at_execution: Mapped[Optional[SqlPrice]] = mapped_column(SqlPrice, nullable=True)
    realized_pnl: Mapped[Optional[SqlMoney]] = mapped_column(SqlMoney, nullable=True)

    # Timestamps & Regulatory Settlement
    trade_date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True
    )
    settlement_date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        index=True
    ) # T+2 settlement for BIST Equities

    # Audit & External Execution IDs
    broker_execution_id: Mapped[Optional[str]] = mapped_column(String(100), unique=True, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Relationships
    portfolio: Mapped[Portfolio] = relationship("Portfolio", back_populates="transactions")
    asset: Mapped[Optional["Asset"]] = relationship("Asset", back_populates="transactions")

    __table_args__ = (
        Index("idx_portfolio_trade_history", "portfolio_id", "trade_date"),
        Index("idx_asset_trade_history", "asset_id", "trade_date"),
    )

