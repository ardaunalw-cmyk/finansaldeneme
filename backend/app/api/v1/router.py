"""
================================================================================
UTL FİNANS - API v1 Master Router
================================================================================
"""

from fastapi import APIRouter
from app.api.v1.auth import router as auth_router
from app.api.v1.market import router as market_router
from app.api.v1.news import router as news_router
from app.api.v1.macro import router as macro_router
from app.api.v1.analytics import router as analytics_router
from app.api.v1.monitoring import router as monitoring_router

api_v1_router = APIRouter(prefix="/api/v1")

api_v1_router.include_router(auth_router)
api_v1_router.include_router(market_router)
api_v1_router.include_router(news_router)
api_v1_router.include_router(macro_router)
api_v1_router.include_router(analytics_router)
api_v1_router.include_router(monitoring_router)


