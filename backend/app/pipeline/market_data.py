"""
================================================================================
UTL FİNANS - Real-Time Market Data Engine & WebSocket Broadcaster
================================================================================
Multi-asset streaming engine:
- Borsa İstanbul (BIST 30 / BIST 100)
- Foreign Exchange (USD/TRY, EUR/TRY, GBP/TRY)
- Commodities (Gram Altın XAU/TRY, Brent Petrol, Gümüş XAG/TRY)
- WebSocket Connection Manager with resilient high-frequency dispatch
"""

import asyncio
import json
import logging
import random
from datetime import datetime, timezone
from decimal import Decimal
from typing import Dict, List, Set, Any, Optional

from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.core.precision import round_price, round_ratio, round_quantity, round_money
from app.models.market_data import MarketPriceSnapshot, MarketInstrumentType
from app.pipeline.resilience import CircuitBreaker, AsyncRateLimiter, retry_with_backoff

logger = logging.getLogger("utl_finans.market_data")

# Circuit breaker specifically tuned for external market data provider
market_data_circuit_breaker = CircuitBreaker(
    name="MarketDataFeed",
    failure_threshold=4,
    recovery_timeout_seconds=15.0,
    half_open_max_trials=2
)

# Outbound rate limiter: 20 requests per second with burst of 40
market_data_rate_limiter = AsyncRateLimiter(rate_per_second=20.0, burst_capacity=40)


# ==============================================================================
# WebSocket Connection & Subscription Manager
# ==============================================================================
class MarketWebSocketManager:
    """
    High-concurrency WebSocket client manager.
    Supports granular symbol subscriptions (e.g. client only wants THYAO and USD/TRY).
    """

    def __init__(self):
        # Maps symbol -> set of active WebSockets
        self.symbol_subscribers: Dict[str, Set[WebSocket]] = {}
        # All active connections
        self.active_connections: Set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self.active_connections.add(websocket)
        logger.info(f"WebSocket client connected. Total active: {len(self.active_connections)}")

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self._lock:
            if websocket in self.active_connections:
                self.active_connections.remove(websocket)
            for symbol, subs in list(self.symbol_subscribers.items()):
                subs.discard(websocket)
                if not subs:
                    self.symbol_subscribers.pop(symbol, None)
        logger.info(f"WebSocket client disconnected. Total active: {len(self.active_connections)}")

    async def subscribe(self, websocket: WebSocket, symbols: List[str]) -> None:
        """Subscribe client to specific financial instruments."""
        async with self._lock:
            for sym in symbols:
                clean_sym = sym.upper().strip()
                if clean_sym not in self.symbol_subscribers:
                    self.symbol_subscribers[clean_sym] = set()
                self.symbol_subscribers[clean_sym].add(websocket)
        logger.debug(f"Client subscribed to symbols: {symbols}")

    async def broadcast_tick(self, tick_data: Dict[str, Any]) -> None:
        """
        Dispatches tick update to all subscribed clients.
        If a client subscribed to '*', they receive all market ticks.
        """
        symbol = tick_data.get("symbol", "").upper()
        payload = json.dumps(tick_data)

        async with self._lock:
            targeted_clients = set(self.symbol_subscribers.get(symbol, set()))
            wildcard_clients = set(self.symbol_subscribers.get("*", set()))
            recipients = targeted_clients.union(wildcard_clients)

        if not recipients:
            return

        dead_connections = set()
        for ws in recipients:
            try:
                await ws.send_text(payload)
            except Exception:
                dead_connections.add(ws)

        if dead_connections:
            for dead_ws in dead_connections:
                await self.disconnect(dead_ws)


ws_market_manager = MarketWebSocketManager()


# ==============================================================================
# Multi-Asset Real-Time Market Data Engine
# ==============================================================================
class MarketDataEngine:
    """
    Institutional Market Feed Engine.
    Collects live quotes, normalizes to Decimal precision, persists to database,
    and broadcasts to WebSocket subscribers.
    """

    # Baseline seed prices for BIST 30, FX and Commodities
    SEEDS = {
        # BIST 30 Leaders
        "THYAO": {"name": "Türk Hava Yolları", "type": MarketInstrumentType.EQUITY, "price": Decimal("314.50"), "currency": "TRY"},
        "ASELS": {"name": "Aselsan Elektronik", "type": MarketInstrumentType.EQUITY, "price": Decimal("64.20"), "currency": "TRY"},
        "GARAN": {"name": "Garanti BBVA", "type": MarketInstrumentType.EQUITY, "price": Decimal("118.40"), "currency": "TRY"},
        "TUPRS": {"name": "Tüpraş Rafinerileri", "type": MarketInstrumentType.EQUITY, "price": Decimal("167.30"), "currency": "TRY"},
        "KCHOL": {"name": "Koç Holding", "type": MarketInstrumentType.EQUITY, "price": Decimal("224.80"), "currency": "TRY"},
        "AKBNK": {"name": "Akbank T.A.Ş.", "type": MarketInstrumentType.EQUITY, "price": Decimal("62.50"), "currency": "TRY"},
        "EREGL": {"name": "Ereğli Demir Çelik", "type": MarketInstrumentType.EQUITY, "price": Decimal("52.80"), "currency": "TRY"},
        "BIMAS": {"name": "BİM Birleşik Mağazalar", "type": MarketInstrumentType.EQUITY, "price": Decimal("588.00"), "currency": "TRY"},
        "SAHOL": {"name": "Sabancı Holding", "type": MarketInstrumentType.EQUITY, "price": Decimal("98.15"), "currency": "TRY"},
        "SISE":  {"name": "Şişecam Fabrikaları", "type": MarketInstrumentType.EQUITY, "price": Decimal("46.30"), "currency": "TRY"},
        # FX Currency Pairs
        "USD/TRY": {"name": "ABD Doları / Türk Lirası", "type": MarketInstrumentType.FX, "price": Decimal("34.2540"), "currency": "TRY"},
        "EUR/TRY": {"name": "Euro / Türk Lirası", "type": MarketInstrumentType.FX, "price": Decimal("37.1850"), "currency": "TRY"},
        "GBP/TRY": {"name": "İngiliz Sterlini / Türk Lirası", "type": MarketInstrumentType.FX, "price": Decimal("44.5220"), "currency": "TRY"},
        # Commodities
        "XAU/TRY": {"name": "Gram Altın (24 Ayar)", "type": MarketInstrumentType.COMMODITY, "price": Decimal("2958.40"), "currency": "TRY"},
        "BRENT":   {"name": "Brent Ham Petrol (Varil)", "type": MarketInstrumentType.COMMODITY, "price": Decimal("74.85"), "currency": "USD"},
        "XAG/TRY": {"name": "Gram Gümüş", "type": MarketInstrumentType.COMMODITY, "price": Decimal("34.65"), "currency": "TRY"},
        # Benchmarks
        "XU100":   {"name": "BIST 100 Endeksi", "type": MarketInstrumentType.INDEX, "price": Decimal("9150.25"), "currency": "TRY"},
        "XU030":   {"name": "BIST 30 Endeksi", "type": MarketInstrumentType.INDEX, "price": Decimal("10080.40"), "currency": "TRY"},
    }

    def __init__(self):
        self.is_running = False
        self._current_cache: Dict[str, Dict[str, Any]] = {}

    @retry_with_backoff(max_retries=3, base_delay_seconds=0.2)
    async def fetch_external_quote(self, symbol: str) -> Dict[str, Any]:
        """
        Simulates resilient external quote retrieval.
        Protected by Circuit Breaker and Rate Limiter.
        """
        await market_data_rate_limiter.acquire()

        async def _call():
            seed = self.SEEDS.get(symbol.upper())
            if not seed:
                raise ValueError(f"Unknown market symbol: {symbol}")

            # Realistic micro-tick random walk (between -0.3% and +0.3%)
            drift = Decimal(str(random.uniform(-0.003, 0.003)))
            prev_price = self._current_cache.get(symbol, {}).get("price", seed["price"])
            new_price = round_price(prev_price * (Decimal("1.0") + drift))

            open_price = seed["price"]
            change_amt = round_price(new_price - open_price)
            change_pct = round_ratio(change_amt / open_price)

            return {
                "symbol": symbol.upper(),
                "name": seed["name"],
                "instrument_type": seed["type"].value,
                "currency": seed["currency"],
                "price": new_price,
                "change_amount": change_amt,
                "change_percent": change_pct,
                "high": round_price(max(new_price, open_price * Decimal("1.015"))),
                "low": round_price(min(new_price, open_price * Decimal("0.985"))),
                "volume_shares": round_quantity(Decimal(random.randint(50000, 1500000))),
                "volume_try": round_money(Decimal(random.randint(5000000, 120000000))),
                "timestamp": datetime.now(timezone.utc).isoformat()
            }

        return await market_data_circuit_breaker.execute(_call)

    async def update_tick_and_broadcast(self, session: AsyncSession, symbol: str) -> Dict[str, Any]:
        """Fetches quote, saves to database snapshot, and pushes to WebSocket."""
        quote = await self.fetch_external_quote(symbol)
        self._current_cache[symbol] = quote

        # Upsert into PostgreSQL MarketPriceSnapshot
        stmt = select(MarketPriceSnapshot).where(MarketPriceSnapshot.symbol == symbol)
        result = await session.execute(stmt)
        record = result.scalar_one_or_none()

        if record is None:
            record = MarketPriceSnapshot(
                symbol=quote["symbol"],
                name=quote["name"],
                instrument_type=quote["instrument_type"],
                currency=quote["currency"],
                current_price=quote["price"],
                open_price=quote["price"],
                high_price=quote["high"],
                low_price=quote["low"],
                close_price_previous=quote["price"],
                change_amount=quote["change_amount"],
                change_percent=quote["change_percent"],
                volume_shares=quote["volume_shares"],
                volume_nominal_try=quote["volume_try"],
                tick_timestamp=datetime.now(timezone.utc)
            )
            session.add(record)
        else:
            record.current_price = quote["price"]
            record.high_price = max(record.high_price, quote["price"])
            record.low_price = min(record.low_price, quote["price"])
            record.change_amount = quote["change_amount"]
            record.change_percent = quote["change_percent"]
            record.volume_shares = quote["volume_shares"]
            record.volume_nominal_try = quote["volume_try"]
            record.tick_timestamp = datetime.now(timezone.utc)

        await session.commit()

        # Format payload with stringified Decimals for JSON WebSocket broadcast
        broadcast_payload = {
            "type": "TICK",
            "symbol": quote["symbol"],
            "name": quote["name"],
            "instrument_type": quote["instrument_type"],
            "price": f"{quote['price']:f}",
            "change_amount": f"{quote['change_amount']:f}",
            "change_percent": f"{quote['change_percent']:f}",
            "high": f"{quote['high']:f}",
            "low": f"{quote['low']:f}",
            "currency": quote["currency"],
            "timestamp": quote["timestamp"]
        }

        await ws_market_manager.broadcast_tick(broadcast_payload)
        return broadcast_payload

    async def start_streaming_worker(self) -> None:
        """
        Background worker that continuously updates quotes across BIST, FX, and Commodities.
        """
        self.is_running = True
        logger.info("Real-Time Market Data Engine background worker started.")

        symbols = list(self.SEEDS.keys())

        while self.is_running:
            try:
                # Randomly pick 3-5 symbols every tick interval to simulate market activity
                active_batch = random.sample(symbols, k=random.randint(3, 5))
                async with AsyncSessionLocal() as session:
                    for sym in active_batch:
                        try:
                            await self.update_tick_and_broadcast(session, sym)
                        except Exception as e:
                            logger.error(f"Error streaming tick for {sym}: {e}")

                await asyncio.sleep(1.0) # 1-second cadence
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Unexpected error in market streaming worker: {e}")
                await asyncio.sleep(2.0)

    def stop_streaming_worker(self) -> None:
        self.is_running = False
        logger.info("Market Data streaming worker stopped.")


market_engine = MarketDataEngine()
