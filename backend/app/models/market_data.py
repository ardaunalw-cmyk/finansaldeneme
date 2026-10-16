"""
================================================================================
UTL FİNANS - Real-Time Market Data & Price Tick Entities
================================================================================
"""

import enum
import uuid
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import String, DateTime, Index, Boolean
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base
from app.models.base import UUIDMixin, TimestampMixin
from app.core.precision import SqlPrice, SqlQuantity, SqlMoney, SqlRatio


class MarketInstrumentType(str, enum.Enum):
    EQUITY = "EQUITY"           # BIST 30 / 100 Payları
    FX = "FX"                   # USD/TRY, EUR/TRY, GBP/TRY
    COMMODITY = "COMMODITY"     # XAU/TRY (Gram Altın), BRENT, XAG/TRY (Gümüş)
    INDEX = "INDEX"             # XU100, XU030, XBANK, XUSIN


class MarketPriceSnapshot(Base, UUIDMixin, TimestampMixin):
    """
    Real-time market price tick snapshot.
    Maintains the latest price, daily spread, volume, and percentage change.
    """
    __tablename__ = "market_price_snapshots"

    symbol: Mapped[str] = mapped_column(String(30), unique=True, index=True, nullable=False) # e.g. THYAO, USD/TRY, XAU/TRY
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    instrument_type: Mapped[MarketInstrumentType] = mapped_column(
        String(20),
        default=MarketInstrumentType.EQUITY,
        nullable=False,
        index=True
    )
    currency: Mapped[str] = mapped_column(String(3), default="TRY", nullable=False)

    # Real-Time Price & Tick Data (High Precision)
    current_price: Mapped[SqlPrice] = mapped_column(SqlPrice, nullable=False)
    open_price: Mapped[SqlPrice] = mapped_column(SqlPrice, nullable=False)
    high_price: Mapped[SqlPrice] = mapped_column(SqlPrice, nullable=False)
    low_price: Mapped[SqlPrice] = mapped_column(SqlPrice, nullable=False)
    close_price_previous: Mapped[SqlPrice] = mapped_column(SqlPrice, nullable=False)

    # Daily Performance
    change_amount: Mapped[SqlPrice] = mapped_column(SqlPrice, default=0.000000, nullable=False)
    change_percent: Mapped[SqlRatio] = mapped_column(SqlRatio, default=0.000000, nullable=False)

    # Volume & Microstructure
    volume_shares: Mapped[SqlQuantity] = mapped_column(SqlQuantity, default=0.00000000, nullable=False)
    volume_nominal_try: Mapped[SqlMoney] = mapped_column(SqlMoney, default=0.0000, nullable=False)

    # Order Book Top of Book
    best_bid: Mapped[Optional[SqlPrice]] = mapped_column(SqlPrice, nullable=True)
    best_ask: Mapped[Optional[SqlPrice]] = mapped_column(SqlPrice, nullable=True)

    # Timestamp of the tick
    tick_timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True
    )

    is_market_open: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    metadata_json: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)

    __table_args__ = (
        Index("idx_market_price_lookup", "symbol", "instrument_type"),
    )
