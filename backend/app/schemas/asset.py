"""
================================================================================
UTL FİNANS - Asset & Sector Tag Pydantic v2 Schemas
================================================================================
"""

import uuid
from decimal import Decimal
from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from app.models.asset import AssetClass, MarketExchange
from app.core.precision import PydanticPrice, PydanticMoney


class SectorTagBase(BaseModel):
    name: str = Field(..., max_length=100)
    slug: str = Field(..., max_length=100)
    category: str = "SECTOR"
    description: Optional[str] = None


class SectorTagResponse(SectorTagBase):
    id: uuid.UUID
    created_at: datetime

    class Config:
        from_attributes = True


class AssetCreate(BaseModel):
    ticker: str = Field(..., max_length=20)
    isin_code: Optional[str] = Field(None, max_length=12)
    bloomberg_ticker: Optional[str] = None
    kap_mkk_oid: Optional[str] = None
    name: str = Field(..., max_length=255)
    exchange: MarketExchange = MarketExchange.BIST
    asset_class: AssetClass = AssetClass.EQUITY
    currency: str = "TRY"
    sector: str
    industry: str
    description: Optional[str] = None
    website: Optional[str] = None
    lot_size: int = 1
    tick_size: PydanticPrice = Decimal("0.010000")
    is_active: bool = True
    last_close_price: Optional[PydanticPrice] = None
    market_cap: Optional[PydanticMoney] = None
    financial_metadata: Dict[str, Any] = Field(default_factory=dict)
    tag_ids: List[uuid.UUID] = Field(default_factory=list)


class AssetResponse(BaseModel):
    id: uuid.UUID
    ticker: str
    isin_code: Optional[str] = None
    bloomberg_ticker: Optional[str] = None
    kap_mkk_oid: Optional[str] = None
    name: str
    exchange: MarketExchange
    asset_class: AssetClass
    currency: str
    sector: str
    industry: str
    description: Optional[str] = None
    is_active: bool
    last_close_price: Optional[PydanticPrice] = None
    market_cap: Optional[PydanticMoney] = None
    financial_metadata: Dict[str, Any]
    sector_tags: List[SectorTagResponse] = []
    created_at: datetime

    class Config:
        from_attributes = True
