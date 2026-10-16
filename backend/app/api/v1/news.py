"""
================================================================================
UTL FİNANS - News Feed & KAP Disclosures Endpoints
================================================================================
"""

from typing import List, Optional
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.news import NewsDisclosure, NewsSource, DisclosureCategory
from app.schemas.pipeline_schemas import NewsDisclosureResponse
from app.pipeline.news_kap import kap_worker

router = APIRouter(prefix="/news", tags=["KAP Disclosures & Financial News"])


@router.get("/disclosures", response_model=List[NewsDisclosureResponse])
async def list_disclosures(
    ticker: Optional[str] = Query(None, description="Filter by stock ticker like THYAO"),
    category: Optional[DisclosureCategory] = None,
    source: Optional[NewsSource] = None,
    is_price_sensitive: Optional[bool] = None,
    limit: int = Query(50, ge=1, le=200),
    session: AsyncSession = Depends(get_db)
):
    """
    Query real-time KAP disclosures and news articles with NLP tagging.
    """
    stmt = select(NewsDisclosure).order_by(NewsDisclosure.published_at.desc()).limit(limit)

    if ticker:
        clean_ticker = ticker.upper().strip()
        stmt = stmt.where(NewsDisclosure.related_ticker == clean_ticker)
    if category:
        stmt = stmt.where(NewsDisclosure.category == category)
    if source:
        stmt = stmt.where(NewsDisclosure.source == source)
    if is_price_sensitive is not None:
        stmt = stmt.where(NewsDisclosure.is_price_sensitive == is_price_sensitive)

    result = await session.execute(stmt)
    records = result.scalars().all()

    # If database is fresh, run initial ingestion
    if not records:
        await kap_worker.process_and_save_disclosures(session)
        result = await session.execute(stmt)
        records = result.scalars().all()

    return records


@router.get("/tickers/{ticker}", response_model=List[NewsDisclosureResponse])
async def get_ticker_disclosures(
    ticker: str,
    limit: int = Query(20, ge=1, le=100),
    session: AsyncSession = Depends(get_db)
):
    """Get all official KAP disclosures and bulletins for a specific company."""
    clean_ticker = ticker.upper().strip()
    stmt = select(NewsDisclosure).where(
        NewsDisclosure.related_ticker == clean_ticker
    ).order_by(NewsDisclosure.published_at.desc()).limit(limit)

    result = await session.execute(stmt)
    records = result.scalars().all()

    if not records:
        await kap_worker.process_and_save_disclosures(session)
        result = await session.execute(stmt)
        records = result.scalars().all()

    return records


@router.post("/sync", status_code=status.HTTP_200_OK)
async def trigger_news_sync(session: AsyncSession = Depends(get_db)):
    """Manually triggers background ingestion worker cycle."""
    count = await kap_worker.process_and_save_disclosures(session)
    return {
        "status": "success",
        "new_disclosures_ingested": count,
        "message": f"KAP news feed synchronized successfully. {count} new entries processed."
    }
