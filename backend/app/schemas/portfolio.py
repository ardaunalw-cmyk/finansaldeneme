"""
================================================================================
UTL FİNANS - Portfolio, Position & Transaction Pydantic v2 Schemas
================================================================================
"""

import uuid
from decimal import Decimal
from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from app.models.portfolio import CostBasisMethod, TransactionType
from app.core.precision import (
    PydanticPrice,
    PydanticQuantity,
    PydanticMoney,
    PydanticRatio
)
from app.schemas.asset import AssetResponse


class TransactionCreate(BaseModel):
    asset_id: Optional[uuid.UUID] = None
    transaction_type: TransactionType
    quantity: PydanticQuantity = Decimal("0.0")
    unit_price: PydanticPrice = Decimal("0.0")
    commission_fee: PydanticMoney = Decimal("0.0")
    tax_withholding: PydanticMoney = Decimal("0.0")
    trade_date: Optional[datetime] = None
    notes: Optional[str] = None


class TransactionResponse(BaseModel):
    id: uuid.UUID
    portfolio_id: uuid.UUID
    asset_id: Optional[uuid.UUID]
    transaction_type: TransactionType
    quantity: PydanticQuantity
    unit_price: PydanticPrice
    gross_amount: PydanticMoney
    commission_fee: PydanticMoney
    tax_withholding: PydanticMoney
    net_amount: PydanticMoney
    cost_basis_at_execution: Optional[PydanticPrice]
    realized_pnl: Optional[PydanticMoney]
    trade_date: datetime
    settlement_date: datetime
    notes: Optional[str]

    class Config:
        from_attributes = True


class PortfolioPositionResponse(BaseModel):
    id: uuid.UUID
    portfolio_id: uuid.UUID
    asset_id: uuid.UUID
    asset: Optional[AssetResponse] = None
    quantity: PydanticQuantity
    average_cost_basis: PydanticPrice
    total_cost_basis: PydanticMoney
    last_evaluated_price: PydanticPrice
    market_value: PydanticMoney
    unrealized_pnl: PydanticMoney
    unrealized_pnl_percent: PydanticRatio
    cumulative_realized_pnl: PydanticMoney
    current_weight: PydanticRatio
    target_weight: PydanticRatio

    class Config:
        from_attributes = True


class PortfolioCreate(BaseModel):
    name: str = Field(..., max_length=100)
    description: Optional[str] = None
    base_currency: str = "TRY"
    benchmark_ticker: str = "XU100"
    cost_basis_method: CostBasisMethod = CostBasisMethod.WAC
    initial_cash_deposit: PydanticMoney = Decimal("0.0")
    strategy_allocation_rules: Dict[str, Any] = Field(default_factory=dict)


class PortfolioResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    name: str
    description: Optional[str]
    base_currency: str
    benchmark_ticker: str
    cost_basis_method: CostBasisMethod
    cash_balance: PydanticMoney
    invested_capital: PydanticMoney
    total_market_value: PydanticMoney
    cumulative_realized_pnl: PydanticMoney
    is_default: bool
    is_archived: bool
    strategy_allocation_rules: Dict[str, Any]
    positions: List[PortfolioPositionResponse] = []
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

