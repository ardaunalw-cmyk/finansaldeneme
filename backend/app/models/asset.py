"""
================================================================================
UTL FİNANS - Asset / Stock & Sector Tagging Entity Models
================================================================================
"""

import enum
import uuid
from typing import Optional, List, TYPE_CHECKING
from sqlalchemy import (
    String,
    Boolean,
    Enum as SqlEnum,
    ForeignKey,
    Table,
    Column,
    Index,
    Text
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
from app.models.base import UUIDMixin, TimestampMixin
from app.core.precision import SqlPrice, SqlMoney

if TYPE_CHECKING:
    from app.models.portfolio import PortfolioPosition, Transaction


class AssetClass(str, enum.Enum):
    """Financial Asset Classification."""
    EQUITY = "EQUITY"                     # Common Stocks / Pay Senetleri
    ETF = "ETF"                           # Exchange-Traded Funds / BYF
    FIXED_INCOME = "FIXED_INCOME"         # Government/Corporate Bonds / Tahvil-Bono
    COMMODITY = "COMMODITY"               # Gold, Silver, Oil
    FX = "FX"                             # Currencies
    CRYPTO = "CRYPTO"                     # Digital Assets
    INDEX = "INDEX"                       # BIST100, S&P500


class MarketExchange(str, enum.Enum):
    """Trading Venues & Exchanges."""
    BIST = "BIST"                         # Borsa İstanbul
    NYSE = "NYSE"                         # New York Stock Exchange
    NASDAQ = "NASDAQ"                     # NASDAQ
    LSE = "LSE"                           # London Stock Exchange
    OTC = "OTC"                           # Over The Counter


# Many-to-Many Association Table between Assets and SectorTags
asset_sector_association = Table(
    "asset_sector_tags",
    Base.metadata,
    Column("asset_id", UUID(as_uuid=True), ForeignKey("assets.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", UUID(as_uuid=True), ForeignKey("sector_tags.id", ondelete="CASCADE"), primary_key=True),
    Index("idx_asset_tag_composite", "asset_id", "tag_id")
)


class SectorTag(Base, UUIDMixin, TimestampMixin):
    """
    Sovereign Sectoral & Theme Taxonomy.
    Categorizes stocks into clusters: e.g., 'Savunma Sanayii', 'Yapay Zeka',
    'BIST 30', 'Yesil Enerji', 'Temettu 25'.
    """
    __tablename__ = "sector_tags"

    name: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False)
    slug: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False)
    category: Mapped[str] = mapped_column(String(50), default="SECTOR", nullable=False) # SECTOR, THEME, INDEX_MEMBER
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    assets: Mapped[List["Asset"]] = relationship(
        "Asset",
        secondary=asset_sector_association,
        back_populates="sector_tags"
    )


class Asset(Base, UUIDMixin, TimestampMixin):
    """
    Core Asset / Stock entity representing tradable financial instruments.
    Integrated with KAP (Kamuyu Aydınlatma Platformu) and Global Ticker identifiers.
    """
    __tablename__ = "assets"

    # Identifiers
    ticker: Mapped[str] = mapped_column(String(20), unique=True, index=True, nullable=False) # e.g. THYAO, ASELS
    isin_code: Mapped[Optional[str]] = mapped_column(String(12), unique=True, index=True, nullable=True) # e.g. TRATHYAO91M5
    bloomberg_ticker: Mapped[Optional[str]] = mapped_column(String(30), unique=True, nullable=True) # e.g. THYAO:TI
    kap_mkk_oid: Mapped[Optional[str]] = mapped_column(String(50), index=True, nullable=True) # KAP MKK Organization ID

    # Company Profile
    name: Mapped[str] = mapped_column(String(255), index=True, nullable=False) # Türk Hava Yolları A.O.
    exchange: Mapped[MarketExchange] = mapped_column(
        SqlEnum(MarketExchange, name="market_exchange_enum"),
        default=MarketExchange.BIST,
        nullable=False,
        index=True
    )
    asset_class: Mapped[AssetClass] = mapped_column(
        SqlEnum(AssetClass, name="asset_class_enum"),
        default=AssetClass.EQUITY,
        nullable=False,
        index=True
    )
    currency: Mapped[str] = mapped_column(String(3), default="TRY", nullable=False) # ISO 4217

    # Taxonomy & Industry
    sector: Mapped[str] = mapped_column(String(100), index=True, nullable=False) # Ulaştırma
    industry: Mapped[str] = mapped_column(String(150), index=True, nullable=False) # Havayolları ve Yer Hizmetleri
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    website: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Trading Rules & Microstructure
    lot_size: Mapped[int] = mapped_column(default=1, nullable=False)
    tick_size: Mapped[SqlPrice] = mapped_column(SqlPrice, default=0.010000, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True, nullable=False)
    is_shortable: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Latest Cached Valuation Snapshot
    last_close_price: Mapped[Optional[SqlPrice]] = mapped_column(SqlPrice, nullable=True)
    market_cap: Mapped[Optional[SqlMoney]] = mapped_column(SqlMoney, nullable=True)

    # Extensible Financial Metadata (P/E, P/B, Dividend Yield, Beta, KAP data)
    financial_metadata: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)

    # Relationships
    sector_tags: Mapped[List[SectorTag]] = relationship(
        "SectorTag",
        secondary=asset_sector_association,
        back_populates="assets"
    )
    positions: Mapped[List["PortfolioPosition"]] = relationship(
        "PortfolioPosition",
        back_populates="asset"
    )
    transactions: Mapped[List["Transaction"]] = relationship(
        "Transaction",
        back_populates="asset"
    )

    __table_args__ = (
        Index("idx_asset_lookup", "ticker", "exchange", "is_active"),
    )

