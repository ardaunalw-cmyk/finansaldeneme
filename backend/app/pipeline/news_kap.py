"""
================================================================================
UTL FİNANS - KAP Disclosures & News Feed Parsing Pipeline
================================================================================
Asynchronous Background Worker & Parser for:
- Kamuyu Aydınlatma Platformu (KAP) Official Disclosures
- Financial RSS Feeds & Market Bulletins
- Automated Ticker Tagging, Classification & Sentiment Extraction
"""

import asyncio
import logging
import re
from datetime import datetime, timezone
from decimal import Decimal
from typing import Dict, List, Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.models.news import NewsDisclosure, NewsSource, DisclosureCategory
from app.core.precision import round_ratio
from app.pipeline.resilience import CircuitBreaker, AsyncRateLimiter, retry_with_backoff

logger = logging.getLogger("utl_finans.news_kap")

kap_circuit_breaker = CircuitBreaker(
    name="KapNewsGateway",
    failure_threshold=5,
    recovery_timeout_seconds=20.0,
    half_open_max_trials=2
)

kap_rate_limiter = AsyncRateLimiter(rate_per_second=10.0, burst_capacity=25)


# ==============================================================================
# KAP & Financial Text Processing Engine
# ==============================================================================
class KapNewsParser:
    """
    Parses and categorizes raw disclosure titles and text.
    Extracts relevant BIST tickers, assigns disclosure categories, and computes sentiment.
    """

    KNOWN_TICKERS = {
        "THYAO": ["türk hava yolları", "thy", "thyao"],
        "ASELS": ["aselsan", "asels"],
        "GARAN": ["garanti", "garanti bbva", "garan"],
        "TUPRS": ["tüpraş", "tupras", "tuprs"],
        "KCHOL": ["koç holding", "koc holding", "kchol"],
        "AKBNK": ["akbank", "akbnk"],
        "EREGL": ["ereğli", "erdemir", "eregl"],
        "BIMAS": ["bim mağazalar", "bimas"],
        "SAHOL": ["sabancı holding", "sahol"],
        "SISE":  ["şişecam", "sisecam", "sise"],
        "ISCTR": ["iş bankası", "isbank", "isctr"],
        "YKBNK": ["yapı kredi", "ykbnk"]
    }

    CATEGORY_PATTERNS = [
        (re.compile(r"kar payı|temettü|kâr dağıtım", re.I), DisclosureCategory.TEMETTU),
        (re.compile(r"finansal rapor|faaliyet raporu|bilanço|gelir tablosu", re.I), DisclosureCategory.FINANSAL_RAPOR),
        (re.compile(r"sermaye artırım|bedelli|bedelsiz|tahsisli", re.I), DisclosureCategory.SERMAYE_ARTIRIMI),
        (re.compile(r"genel kurul|olağan genel|olağanüstü genel", re.I), DisclosureCategory.GENEL_KURUL),
        (re.compile(r"pay alım|pay satım|hisse geri alım|payların geri alınması", re.I), DisclosureCategory.PAY_ALIM_SATIM),
        (re.compile(r"derecelendirme|kredi notu|fitch|moody|sp", re.I), DisclosureCategory.DERECELENDIRME),
        (re.compile(r"enflasyon|tcmb|faiz kararı|cds|para politikası", re.I), DisclosureCategory.MAKRO_HABER),
    ]

    BULLISH_KEYWORDS = ["artış", "rekor", "yüksek kâr", "büyüme", "onaylandı", "geri alım", "yeni sipariş", "ihale", "olumlu", "temettü", "anlaşma"]
    BEARISH_KEYWORDS = ["zarar", "düşüş", "iptal", "ceza", "dava", "olumsuz", "soruşturma", "gecikme", "revize edildi", "küçülme"]

    @classmethod
    def extract_tickers(cls, text: str) -> List[str]:
        """Scans text for bracketed codes like [THYAO] or company keyword matches."""
        found = set()
        
        # 1. Regex check for bracketed or uppercase tickers: [THYAO] or THYAO.E
        bracketed = re.findall(r"\[([A-Z]{4,5})\]", text)
        for t in bracketed:
            if t in cls.KNOWN_TICKERS:
                found.add(t)

        # 2. Keyword scans
        lower_text = text.lower()
        for ticker, aliases in cls.KNOWN_TICKERS.items():
            for alias in aliases:
                if re.search(r"\b" + re.escape(alias) + r"\b", lower_text):
                    found.add(ticker)
                    break

        return sorted(list(found))

    @classmethod
    def detect_category(cls, title: str, summary: str = "") -> DisclosureCategory:
        """Classifies the disclosure into financial taxonomy."""
        combined = f"{title} {summary}"
        for pattern, cat in cls.CATEGORY_PATTERNS:
            if pattern.search(combined):
                return cat
        return DisclosureCategory.OZEL_DURUM

    @classmethod
    def analyze_sentiment(cls, text: str) -> (Decimal, str):
        """Rule-based financial sentiment scoring (-1.0 to +1.0)."""
        lower = text.lower()
        pos_hits = sum(1 for w in cls.BULLISH_KEYWORDS if w in lower)
        neg_hits = sum(1 for w in cls.BEARISH_KEYWORDS if w in lower)

        if pos_hits > neg_hits:
            score = Decimal(str(min(0.25 * (pos_hits - neg_hits), 1.0)))
            label = "BULLISH"
        elif neg_hits > pos_hits:
            score = Decimal(str(max(-0.25 * (neg_hits - pos_hits), -1.0)))
            label = "BEARISH"
        else:
            score = Decimal("0.000000")
            label = "NEUTRAL"

        return round_ratio(score), label


# ==============================================================================
# KAP Background Worker & Task Processor
# ==============================================================================
class KapNewsWorker:
    """
    Background worker that ingests, parses, deduplicates, and commits KAP disclosures.
    """

    MOCK_DISCLOSURES = [
        {
            "external_id": "KAP-2026-90412",
            "source": NewsSource.KAP,
            "title": "[THYAO] Türk Hava Yolları A.O. - Yeni Uçak Alımı ve Filo Genişleme Anlaşması",
            "summary": "Şirketimiz Yönetim Kurulu tarafından 20 uçaklık ilave filo alım opsiyonunun kesin siparişe dönüştürülmesine ve anlaşmanın imzalanmasına karar verilmiştir.",
            "body": "Büyüme hedeflerimiz ve stratejik planlarımız doğrultusunda filomuzun gençleştirilmesi ve küresel pazar payımızın artırılması hedeflenmektedir.",
            "is_price_sensitive": True,
            "published_at": "2026-10-16T15:30:00Z"
        },
        {
            "external_id": "KAP-2026-90413",
            "source": NewsSource.KAP,
            "title": "[ASELS] Aselsan Elektronik San. ve Tic. A.Ş. - Yeni İş Sözleşmesi (Savunma Sanayii)",
            "summary": "Savunma Sanayii Başkanlığı ile Şirketimiz arasında radar ve elektro-optik sistemleri tedariki kapsamında 120 Milyon Dolar tutarında yeni sözleşme imzalanmıştır.",
            "body": "Teslimatların 2026-2028 yılları arasında tamamlanması planlanmaktadır.",
            "is_price_sensitive": True,
            "published_at": "2026-10-16T16:00:00Z"
        },
        {
            "external_id": "KAP-2026-90414",
            "source": NewsSource.KAP,
            "title": "[TUPRS] Tüpraş - Rafineri Duruş Programı ve Periyodik Bakım Açıklaması",
            "summary": "İzmir Rafinerisi ham petrol ünitesinde planlı bakım çalışmaları başlatılmış olup üretim hedeflerinde sapma beklenmemektedir.",
            "body": "Planlı duruş 14 gün sürecek olup mevcut stoklar piyasa talebini karşılamaya yeterlidir.",
            "is_price_sensitive": False,
            "published_at": "2026-10-16T16:45:00Z"
        },
        {
            "external_id": "KAP-2026-90415",
            "source": NewsSource.KAP,
            "title": "[KCHOL] Koç Holding A.Ş. - Pay Geri Alım İşlemleri Bildirimi",
            "summary": "Şirketimizce Borsa İstanbul'da 224.50 TL fiyattan 250.000 adet KCHOL payı geri alınmıştır.",
            "body": "Geri alım programı kapsamında toplam alınan pay miktarı sermayenin %0.45'ine ulaşmıştır.",
            "is_price_sensitive": True,
            "published_at": "2026-10-16T17:15:00Z"
        },
        {
            "external_id": "NEWS-2026-5012",
            "source": NewsSource.BLOOMBERGHT,
            "title": "TCMB Para Politikası Kurulu Toplantısı Öncesi Piyasa Beklentileri",
            "summary": "Ekonomistlerin medyan beklentisi politika faizinin %50 seviyesinde sabit tutulacağı yönünde şekillendi.",
            "body": "Dezenflasyon sürecinin güçlenmesi ve TL likidite sterilizasyon adımları takip ediliyor.",
            "is_price_sensitive": False,
            "published_at": "2026-10-16T17:45:00Z"
        }
    ]

    def __init__(self):
        self.is_running = False

    @retry_with_backoff(max_retries=3, base_delay_seconds=0.5)
    async def fetch_incoming_disclosures(self) -> List[Dict[str, Any]]:
        """Fetch raw disclosures through resilient gateway."""
        await kap_rate_limiter.acquire()

        async def _call():
            # In production, this issues an HTTP GET to KAP API or parses live RSS feeds
            return self.MOCK_DISCLOSURES

        return await kap_circuit_breaker.execute(_call)

    async def process_and_save_disclosures(self, session: AsyncSession) -> int:
        """Processes and commits disclosures with ticker tagging and sentiment analysis."""
        raw_items = await self.fetch_incoming_disclosures()
        saved_count = 0

        for item in raw_items:
            ext_id = item["external_id"]

            # Deduplication check
            stmt = select(NewsDisclosure).where(NewsDisclosure.external_id == ext_id)
            existing = (await session.execute(stmt)).scalar_one_or_none()
            if existing:
                continue

            # Parsing & NLP Tagging
            title = item["title"]
            summary = item.get("summary", "")
            full_text = f"{title} {summary}"

            tickers = KapNewsParser.extract_tickers(full_text)
            primary_ticker = tickers[0] if tickers else None
            category = KapNewsParser.detect_category(title, summary)
            sentiment_score, sentiment_label = KapNewsParser.analyze_sentiment(full_text)

            pub_at = datetime.fromisoformat(item["published_at"].replace("Z", "+00:00"))

            disclosure = NewsDisclosure(
                external_id=ext_id,
                source=item["source"],
                category=category,
                title=title,
                summary=summary,
                body=item.get("body", ""),
                source_url=item.get("source_url", f"https://www.kap.org.tr/tr/Bildirim/{ext_id}"),
                related_ticker=primary_ticker,
                related_tickers_all=tickers,
                company_name=title.split(" - ")[0].replace("[", "").replace("]", "") if " - " in title else None,
                is_price_sensitive=item.get("is_price_sensitive", False),
                sentiment_score=sentiment_score,
                sentiment_label=sentiment_label,
                published_at=pub_at,
                raw_metadata={"parsed_at": datetime.now(timezone.utc).isoformat()}
            )

            session.add(disclosure)
            saved_count += 1

        if saved_count > 0:
            await session.commit()
            logger.info(f"KAP News Worker ingested and committed {saved_count} new disclosures.")

        return saved_count

    async def start_worker(self, poll_interval_seconds: float = 60.0) -> None:
        """Runs periodic ingestion loop."""
        self.is_running = True
        logger.info("KAP Disclosures & News Background Worker started.")

        while self.is_running:
            try:
                async with AsyncSessionLocal() as session:
                    await self.process_and_save_disclosures(session)
                await asyncio.sleep(poll_interval_seconds)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in KAP News Worker cycle: {e}")
                await asyncio.sleep(10.0)

    def stop_worker(self) -> None:
        self.is_running = False
        logger.info("KAP Disclosures Worker stopped.")


kap_worker = KapNewsWorker()

