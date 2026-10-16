"""
================================================================================
UTL FİNANS - API v1 Master Router
================================================================================
"""

from fastapi import APIRouter
from app.api.v1.market import router as market_router
from app.api.v1.news import router as news_router
from app.api.v1.macro import router as macro_router

api_v1_router = APIRouter(prefix="/api/v1")

api_v1_router.include_router(market_router)
api_v1_router.include_router(news_router)
api_v1_router.include_router(macro_router)
