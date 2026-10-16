"""
================================================================================
UTL FİNANS - Sovereign Intelligence & Core Financial Backend Engine
================================================================================
"""

import asyncio
from contextlib import asynccontextmanager
from typing import AsyncGenerator
from fastapi import FastAPI, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.core.database import engine, Base
import app.models  # noqa: Register all ORM models
from app.core.cache import cache_service
from app.core.logging_config import setup_enterprise_logging, RequestTracingMiddleware, telemetry_engine
from app.api.v1.router import api_v1_router
from app.pipeline.market_data import market_engine
from app.pipeline.news_kap import kap_worker
from app.pipeline.macro import macro_engine

# Initialize enterprise structured logging
setup_enterprise_logging()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """
    Application Lifespan:
    1. Initializes database tables on development startup.
    2. Connects to Redis distributed cache (with graceful in-memory fallback).
    3. Spawns high-frequency market streaming worker, KAP news worker, and macro scheduler.
    4. Gracefully terminates workers, flushes cache connections, and disposes database pool.
    """
    # 1. Startup: Ensure tables exist
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # 2. Connect Redis Cache
    await cache_service.initialize()

    # 3. Launch Background Pipeline Workers
    market_task = asyncio.create_task(market_engine.start_streaming_worker())
    news_task = asyncio.create_task(kap_worker.start_worker(poll_interval_seconds=45.0))
    macro_task = asyncio.create_task(macro_engine.start_scheduler(interval_hours=4.0))

    yield

    # 4. Shutdown: Stop workers gracefully
    market_engine.stop_streaming_worker()
    kap_worker.stop_worker()
    macro_engine.stop_scheduler()

    for task in [market_task, news_task, macro_task]:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    # 5. Close Cache & Dispose DB connection pool
    await cache_service.close()
    await engine.dispose()


app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,

    description="""
    ## UTL FİNANS - Kurumsal Finansal Analiz & Portföy Yönetim Motoru
    
    * **Finansal Hassasiyet:** IEEE-754 ondalık kayma hatalarını engelleyen tam Decimal / NUMERIC mimarisi.
    * **Gerçek Zamanlı Piyasa Akışı:** BIST 30/100, FX ve Emtia için yüksek frekanslı WebSocket & REST akışı.
    * **KAP Bildirim & NLP Hattı:** Otomatik hisse kodu eşleme, duygu analizi ve fiyat duyarlılığı etiketleme.
    * **Makroekonomik Göstergeler:** TCMB faiz, Türkiye 5Y CDS, TÜFE enflasyon ve gösterge tahvil serileri.
    * **Kurumsal Hata Dayanıklılığı:** Circuit Breaker, Token Bucket Rate Limiter ve Exponential Backoff.
    """,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json"
)

# Correlation Tracing & Performance Middleware
app.add_middleware(RequestTracingMiddleware)

# CORS Middleware setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount API v1 Master Router
app.include_router(api_v1_router)


@app.get("/health", tags=["System Health"], status_code=status.HTTP_200_OK)
async def health_check():
    """Service health, database readiness, and cache telemetry check."""
    return JSONResponse(
        content={
            "status": "healthy",
            "service": "UTL FİNANS Core Engine",
            "version": settings.VERSION,
            "environment": settings.ENVIRONMENT,
            "pipeline_status": {
                "market_streamer": market_engine.is_running,
                "kap_news_worker": kap_worker.is_running,
                "macro_scheduler": macro_engine.is_running
            },
            "cache_status": cache_service.get_telemetry(),
            "telemetry": telemetry_engine.get_telemetry_metrics(),
            "financial_precision": "Active (Decimal 38 digits - ROUND_HALF_EVEN)"
        }
    )



@app.get("/", tags=["Root"])
async def root():
    return {
        "message": "UTL FİNANS - Sovereign Intelligence API is operational.",
        "version": settings.VERSION,
        "documentation": "/docs",
        "websocket_feed": "/api/v1/market/ws"
    }
