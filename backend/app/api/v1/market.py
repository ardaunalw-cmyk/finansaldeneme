"""
================================================================================
UTL FİNANS - Real-Time Market Data Endpoints & WebSocket Feed
================================================================================
"""

from typing import List, Optional
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, Query, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.market_data import MarketPriceSnapshot, MarketInstrumentType
from app.schemas.pipeline_schemas import MarketPriceResponse
from app.pipeline.market_data import ws_market_manager, market_engine

router = APIRouter(prefix="/market", tags=["Real-Time Market Data"])


@router.get("/quotes", response_model=List[MarketPriceResponse])
async def get_market_quotes(
    instrument_type: Optional[MarketInstrumentType] = None,
    session: AsyncSession = Depends(get_db)
):
    """
    Retrieve real-time price quotes for BIST 30, FX, and Commodities.
    """
    stmt = select(MarketPriceSnapshot).order_by(MarketPriceSnapshot.symbol)
    if instrument_type:
        stmt = stmt.where(MarketPriceSnapshot.instrument_type == instrument_type)

    result = await session.execute(stmt)
    records = result.scalars().all()

    # If empty, populate initial snapshot from seeds
    if not records:
        for sym in market_engine.SEEDS.keys():
            await market_engine.update_tick_and_broadcast(session, sym)
        result = await session.execute(stmt)
        records = result.scalars().all()

    return records


@router.get("/quotes/{symbol}", response_model=MarketPriceResponse)
async def get_single_quote(
    symbol: str,
    session: AsyncSession = Depends(get_db)
):
    """Get latest price tick for a specific symbol (e.g. THYAO, USD/TRY, XAU/TRY)."""
    clean_sym = symbol.upper().strip()
    stmt = select(MarketPriceSnapshot).where(MarketPriceSnapshot.symbol == clean_sym)
    result = await session.execute(stmt)
    record = result.scalar_one_or_none()

    if not record:
        if clean_sym in market_engine.SEEDS:
            await market_engine.update_tick_and_broadcast(session, clean_sym)
            result = await session.execute(stmt)
            record = result.scalar_one_or_none()

    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Symbol '{clean_sym}' not found in market registry.")

    return record


@router.websocket("/ws")
async def market_feed_websocket(websocket: WebSocket):
    """
    High-Frequency Real-Time Market Data WebSocket Stream.
    
    Protocol:
    - Send JSON: {"action": "subscribe", "symbols": ["THYAO", "USD/TRY", "XAU/TRY"]}
    - Send JSON: {"action": "subscribe", "symbols": ["*"]} for entire BIST/FX/Commodity firehose.
    """
    await ws_market_manager.connect(websocket)
    try:
        # Default subscribe to all symbols
        await ws_market_manager.subscribe(websocket, ["*"])
        while True:
            data = await websocket.receive_json()
            action = data.get("action")
            symbols = data.get("symbols", [])

            if action == "subscribe" and isinstance(symbols, list):
                await ws_market_manager.subscribe(websocket, symbols)
                await websocket.send_json({"status": "subscribed", "symbols": symbols})
            elif action == "ping":
                await websocket.send_json({"status": "pong"})
    except WebSocketDisconnect:
        await ws_market_manager.disconnect(websocket)
    except Exception:
        await ws_market_manager.disconnect(websocket)

