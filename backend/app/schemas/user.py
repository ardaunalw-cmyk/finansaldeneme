"""
================================================================================
UTL FİNANS - User & Corporate Pydantic v2 Schemas
================================================================================
"""

import uuid
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, EmailStr, Field
from app.models.user import SubscriptionTier, UserRole
from app.core.precision import PydanticMoney, PydanticRatio


class CorporateProfileCreate(BaseModel):
    company_name: str = Field(..., max_length=255)
    tax_id_vkn: str = Field(..., min_length=10, max_length=50)
    tax_office: str = Field(..., max_length=100)
    trade_registry_no: Optional[str] = None
    lei_code: Optional[str] = Field(None, min_length=20, max_length=20)
    country: str = "TUR"
    registered_address: str = Field(..., max_length=500)
    compliance_officer_name: Optional[str] = None
    compliance_officer_email: Optional[EmailStr] = None
    is_regulated_entity: bool = False


class CorporateProfileResponse(CorporateProfileCreate):
    id: uuid.UUID
    user_id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class PortfolioLimitUpdate(BaseModel):
    max_portfolios: Optional[int] = Field(None, ge=1, le=1000)
    max_single_asset_weight: Optional[PydanticRatio] = Field(None, ge=0.01, le=1.0)
    max_leverage_ratio: Optional[PydanticRatio] = Field(None, ge=1.0, le=10.0)
    daily_trading_limit_amount: Optional[PydanticMoney] = None
    allowed_asset_classes: Optional[List[str]] = None
    short_selling_allowed: Optional[bool] = None
    margin_trading_allowed: Optional[bool] = None


class PortfolioLimitResponse(BaseModel):
    id: uuid.UUID
    max_portfolios: int
    max_single_asset_weight: PydanticRatio
    max_leverage_ratio: PydanticRatio
    daily_trading_limit_amount: PydanticMoney
    allowed_asset_classes: List[str]
    short_selling_allowed: bool
    margin_trading_allowed: bool

    class Config:
        from_attributes = True


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8)
    full_name: str
    phone_number: Optional[str] = None
    subscription_tier: SubscriptionTier = SubscriptionTier.RETAIL_FREE
    is_corporate: bool = False
    corporate_profile: Optional[CorporateProfileCreate] = None


class UserResponse(BaseModel):
    id: uuid.UUID
    email: EmailStr
    full_name: str
    phone_number: Optional[str] = None
    role: UserRole
    subscription_tier: SubscriptionTier
    is_active: bool
    is_verified: bool
    is_corporate: bool
    corporate_profile: Optional[CorporateProfileResponse] = None
    portfolio_limits: Optional[PortfolioLimitResponse] = None
    created_at: datetime

    class Config:
        from_attributes = True

