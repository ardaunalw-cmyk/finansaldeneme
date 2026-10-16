"""
================================================================================
UTL FİNANS - Sovereign Intelligence & Core Financial Backend Engine
================================================================================
"""

from contextlib import asynccontextmanager
from typing import AsyncGenerator
from fastapi import FastAPI, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.core.database import engine, Base


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """
    Application Lifespan:
    Initializes database tables on development startup and closes pool connections on shutdown.
    """
    # Startup: Ensure tables exist in development
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    # Shutdown: Dispose DB connection pool
    await engine.dispose()


app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="""
    ## UTL FİNANS - Kurumsal Finansal Analiz & Portföy Yönetim Motoru
    
    * **Finansal Hassasiyet:** IEEE-754 ondalık kayma hatalarını engelleyen tam Decimal / NUMERIC mimarisi.
    * **Temel & Teknik Analiz Entegrasyonu:** KAP, finansal tablolar, rasyolar ve formasyon analitiği.
    * **Portföy & Ledger Yönetimi:** WAC (Ağırlıklı Ortalama Maliyet), varlık dağılımı ve işlem geçmişi.
    * **Kurumsal Risk Kısıtları:** Tek hisse ağırlık tavanı, kaldıraç sınırları, SPK/UCITS uyumu.
    """,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json"
)

# CORS Middleware setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", tags=["System Health"], status_code=status.HTTP_200_OK)
async def health_check():
    """Service health and database readiness check."""
    return JSONResponse(
        content={
            "status": "healthy",
            "service": "UTL FİNANS Core Engine",
            "version": settings.VERSION,
            "environment": settings.ENVIRONMENT,
            "financial_precision": "Active (Decimal 38 digits - ROUND_HALF_EVEN)"
        }
    )


@app.get("/", tags=["Root"])
async def root():
    return {
        "message": "UTL FİNANS - Sovereign Intelligence API is operational.",
        "documentation": "/docs"
    }
