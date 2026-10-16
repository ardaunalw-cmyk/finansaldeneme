"""
================================================================================
UTL FİNANS - Market Data, News & Macro Pydantic Schemas
================================================================================
"""

import uuid
from datetime import datetime, date
from decimal import Decimal
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from app.models.market_data import MarketInstrumentType
from app.models.news import NewsSource, DisclosureCategory
from app.core.precision import (
    PydanticPrice,
    PydanticQuantity,
    PydanticMoney,
    PydanticRatio
)


# ==============================================================================
# Market Data Schemas
# ==============================================================================
class MarketPriceResponse(BaseModel):
    symbol: str
    name: str
    instrument_type: MarketInstrumentType
    currency: str
    current_price: PydanticPrice
    open_price: PydanticPrice
    high_price: PydanticPrice
    low_price: PydanticPrice
    change_amount: PydanticPrice
    change_percent: PydanticRatio
    volume_shares: PydanticQuantity
    volume_nominal_try: PydanticMoney
    tick_timestamp: datetime
    is_market_open: bool

    class Config:
        from_attributes = True


class WebSocketSubscriptionRequest(BaseModel):
    action: str = Field("subscribe", description="subscribe or unsubscribe")
    symbols: List[str] = Field(..., description="List of symbols like ['THYAO', 'USD/TRY', 'XAU/TRY'] or ['*']")


# ==============================================================================
# News & KAP Schemas
# ==============================================================================
class NewsDisclosureResponse(BaseModel):
    id: uuid.UUID
    external_id: Optional[str] = None
    source: NewsSource
    category: DisclosureCategory
    title: str
    summary: Optional[str] = None
    body: Optional[str] = None
    source_url: Optional[str] = None
    related_ticker: Optional[str] = None
    related_tickers_all: List[str] = []
    company_name: Optional[str] = None
    is_price_sensitive: bool
    sentiment_score: PydanticRatio
    sentiment_label: str
    published_at: datetime

    class Config:
        from_attributes = True


# ==============================================================================
# Macroeconomic Indicator Schemas
# ==============================================================================
class MacroIndicatorResponse(BaseModel):
    id: uuid.UUID
    indicator_key: str
    name: str
    value: PydanticPrice
    unit: str
    frequency: str
    source: str
    observation_date: date
    published_at: datetime
    previous_value: Optional[PydanticPrice] = None
    change_from_previous: Optional[PydanticPrice] = None
    metadata_json: Dict[str, Any] = {}

    class Config:
        from_attributes = True

