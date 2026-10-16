"""
================================================================================
UTL FİNANS - ORM Models Registry & Discovery
================================================================================
"""

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin
from app.models.user import (
    User,
    CorporateProfile,
    PortfolioLimit,
    SubscriptionTier,
    UserRole
)
from app.models.asset import (
    Asset,
    SectorTag,
    AssetClass,
    MarketExchange,
    asset_sector_association
)
from app.models.portfolio import (
    Portfolio,
    PortfolioPosition,
    Transaction,
    TransactionType,
    CostBasisMethod
)

__all__ = [
    "Base",
    "TimestampMixin",
    "UUIDMixin",
    "User",
    "CorporateProfile",
    "PortfolioLimit",
    "SubscriptionTier",
    "UserRole",
    "Asset",
    "SectorTag",
    "AssetClass",
    "MarketExchange",
    "asset_sector_association",
    "Portfolio",
    "PortfolioPosition",
    "Transaction",
    "TransactionType",
    "CostBasisMethod"
]
