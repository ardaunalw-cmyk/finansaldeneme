"""
================================================================================
UTL FİNANS - Macroeconomic Indicators & Central Bank Data Entities
================================================================================
"""

import enum
import uuid
from datetime import datetime, date, timezone
from typing import Optional
from sqlalchemy import String, Date, DateTime, Index
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base
from app.models.base import UUIDMixin, TimestampMixin
from app.core.precision import SafeFinancialDecimal


# High-precision numeric column for interest rates, inflation %, CDS basis points
SqlMacroValue = SafeFinancialDecimal(precision=18, scale=6)


class MacroIndicatorKey(str, enum.Enum):
    TCMB_POLICY_RATE = "TCMB_POLICY_RATE"             # TCMB 1 Hafta Repo Faizi (%)
    TURKEY_5Y_CDS = "TURKEY_5Y_CDS"                   # Türkiye 5 Yıllık CDS Primi (bps)
    TUFE_ANNUAL_CPI = "TUFE_ANNUAL_CPI"               # Yıllık TÜFE Enflasyonu (%)
    TUFE_MONTHLY_CPI = "TUFE_MONTHLY_CPI"             # Aylık TÜFE Enflasyonu (%)
    TCMB_12M_EXPECTATION = "TCMB_12M_EXPECTATION"     # Piyasa Katılımcıları 12 Ay Sonrası TÜFE Beklentisi (%)
    TR_2Y_BOND_YIELD = "TR_2Y_BOND_YIELD"             # 2 Yıllık Gösterge Tahvil Faizi (%)
    TR_10Y_BOND_YIELD = "TR_10Y_BOND_YIELD"           # 10 Yıllık Gösterge Tahvil Faizi (%)
    TCMB_NET_RESERVES = "TCMB_NET_RESERVES"           # TCMB Net Uluslararası Rezervler (Milyar USD)
    CURRENT_ACCOUNT_DEFICIT = "CURRENT_ACCOUNT_DEFICIT" # Cari İşlemler Dengesi (Milyar USD)


class MacroIndicator(Base, UUIDMixin, TimestampMixin):
    """
    Time-series record of macroeconomic benchmarks.
    Used by the quantitative asset allocation engine to discount cash flows
    and compute dynamic risk-free hurdle rates.
    """
    __tablename__ = "macro_indicators"

    indicator_key: Mapped[str] = mapped_column(String(50), index=True, nullable=False) # Enum string
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    value: Mapped[SqlMacroValue] = mapped_column(SqlMacroValue, nullable=False)
    unit: Mapped[str] = mapped_column(String(20), default="PERCENT", nullable=False) # PERCENT, BPS, BILLION_USD
    frequency: Mapped[str] = mapped_column(String(20), default="MONTHLY", nullable=False) # DAILY, WEEKLY, MONTHLY
    
    # Official Source
    source: Mapped[str] = mapped_column(String(100), default="TCMB", nullable=False) # TCMB, TUIK, BLOOMBERG, TREASURY
    
    # Observation & Reporting Dates
    observation_date: Mapped[date] = mapped_column(Date, nullable=False, index=True) # The period the data belongs to
    published_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True
    )

    previous_value: Mapped[Optional[SqlMacroValue]] = mapped_column(SqlMacroValue, nullable=True)
    change_from_previous: Mapped[Optional[SqlMacroValue]] = mapped_column(SqlMacroValue, nullable=True)

    metadata_json: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)

    __table_args__ = (
        Index("idx_macro_key_date", "indicator_key", "observation_date", unique=True),
        Index("idx_macro_published", "published_at"),
    )
