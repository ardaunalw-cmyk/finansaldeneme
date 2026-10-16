"""
================================================================================
UTL FİNANS - Macroeconomic Indicators & Central Bank Endpoints
================================================================================
"""

from typing import List, Optional
from fastapi import APIRouter, Depends, Query, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.macro import MacroIndicator, MacroIndicatorKey
from app.schemas.pipeline_schemas import MacroIndicatorResponse
from app.pipeline.macro import macro_engine

router = APIRouter(prefix="/macro", tags=["Macroeconomic Indicators & TCMB"])


@router.get("/indicators", response_model=List[MacroIndicatorResponse])
async def list_macro_indicators(
    source: Optional[str] = Query(None, description="TCMB, TUIK, BLOOMBERG"),
    session: AsyncSession = Depends(get_db)
):
    """
    Get latest macroeconomic indicators: Policy Rate, CDS Spread, CPI Inflation, Bond Yields.
    """
    stmt = select(MacroIndicator).order_by(MacroIndicator.indicator_key)
    if source:
        stmt = stmt.where(MacroIndicator.source == source.upper())

    result = await session.execute(stmt)
    records = result.scalars().all()

    # Initial sync if empty
    if not records:
        await macro_engine.sync_indicators(session)
        result = await session.execute(stmt)
        records = result.scalars().all()

    return records


@router.get("/indicators/{indicator_key}", response_model=List[MacroIndicatorResponse])
async def get_indicator_history(
    indicator_key: str,
    limit: int = Query(30, ge=1, le=120),
    session: AsyncSession = Depends(get_db)
):
    """Get time-series historical observations for an indicator."""
    clean_key = indicator_key.upper().strip()
    stmt = select(MacroIndicator).where(
        MacroIndicator.indicator_key == clean_key
    ).order_by(MacroIndicator.observation_date.desc()).limit(limit)

    result = await session.execute(stmt)
    records = result.scalars().all()

    if not records:
        await macro_engine.sync_indicators(session)
        result = await session.execute(stmt)
        records = result.scalars().all()

    if not records:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Indicator '{clean_key}' not found."
        )

    return records


@router.post("/sync", status_code=status.HTTP_200_OK)
async def trigger_macro_sync(session: AsyncSession = Depends(get_db)):
    """Manually triggers scheduled macroeconomic data sync."""
    count = await macro_engine.sync_indicators(session)
    return {
        "status": "success",
        "indicators_synced": count,
        "message": f"Macroeconomic data engine synchronized {count} indicators."
    }

