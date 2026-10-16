"""
================================================================================
UTL FİNANS - News Feed & KAP Disclosures Entities
================================================================================
"""

import enum
import uuid
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import String, Text, DateTime, Index, Boolean
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base
from app.models.base import UUIDMixin, TimestampMixin
from app.core.precision import SqlRatio


class NewsSource(str, enum.Enum):
    KAP = "KAP"                               # Kamuyu Aydınlatma Platformu
    BLOOMBERGHT = "BLOOMBERGHT"               # Bloomberg HT Finans
    ANADOLU_AJANSI = "ANADOLU_AJANSI"         # AA Finans
    FOREKS = "FOREKS"                         # Foreks Haber
    REUTERS = "REUTERS"                       # Reuters Turkey


class DisclosureCategory(str, enum.Enum):
    OZEL_DURUM = "OZEL_DURUM"                 # Özel Durum Açıklaması (Genel)
    FINANSAL_RAPOR = "FINANSAL_RAPOR"         # Çeyreklik Bilanço ve Gelir Tablosu
    TEMETTU = "TEMETTU"                       # Kar Payı Dağıtım İşlemleri
    SERMAYE_ARTIRIMI = "SERMAYE_ARTIRIMI"     # Bedelli / Bedelsiz Sermaye Artırımı
    GENEL_KURUL = "GENEL_KURUL"               # Genel Kurul Toplantısı ve Kararları
    PAY_ALIM_SATIM = "PAY_ALIM_SATIM"         # Şirket / Ortak Pay Alım-Satım Bildirimi
    DERECELENDIRME = "DERECELENDIRME"         # Kredi ve Sürdürülebilirlik Notu
    MAKRO_HABER = "MAKRO_HABER"               # Faiz, Enflasyon, Politika Haberleri


class NewsDisclosure(Base, UUIDMixin, TimestampMixin):
    """
    KAP disclosure or parsed financial news article.
    Enriched with automated ticker extraction and AI sentiment analysis.
    """
    __tablename__ = "news_disclosures"

    external_id: Mapped[Optional[str]] = mapped_column(String(100), unique=True, index=True, nullable=True) # KAP notification ID
    source: Mapped[NewsSource] = mapped_column(
        String(30),
        default=NewsSource.KAP,
        nullable=False,
        index=True
    )
    category: Mapped[DisclosureCategory] = mapped_column(
        String(40),
        default=DisclosureCategory.OZEL_DURUM,
        nullable=False,
        index=True
    )

    # Content
    title: Mapped[str] = mapped_column(String(500), nullable=False, index=True)
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    body: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    source_url: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)

    # Entity Association
    related_ticker: Mapped[Optional[str]] = mapped_column(String(20), index=True, nullable=True) # e.g. THYAO, ASELS
    related_tickers_all: Mapped[list] = mapped_column(JSONB, default=list, nullable=False) # Multiple tickers: ["KCHOL", "TUPRS"]
    company_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Financial & AI Impact Flags
    is_price_sensitive: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    sentiment_score: Mapped[SqlRatio] = mapped_column(SqlRatio, default=0.000000, nullable=False) # -1.000000 (Bearish) to +1.000000 (Bullish)
    sentiment_label: Mapped[str] = mapped_column(String(20), default="NEUTRAL", nullable=False) # BULLISH, BEARISH, NEUTRAL

    # Publication Timestamps
    published_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True
    )

    raw_metadata: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)

    __table_args__ = (
        Index("idx_news_ticker_published", "related_ticker", "published_at"),
        Index("idx_news_category_source", "category", "source"),
    )

