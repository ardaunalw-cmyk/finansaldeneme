"""
================================================================================
UTL FİNANS - User, Corporate Profile & Portfolio Constraints Entity Models
================================================================================
"""

import enum
import uuid
from typing import Optional, List, TYPE_CHECKING
from sqlalchemy import (
    String,
    Boolean,
    Enum as SqlEnum,
    ForeignKey,
    Integer,
    CheckConstraint
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
from app.models.base import UUIDMixin, TimestampMixin
from app.core.precision import SqlMoney, SqlRatio

if TYPE_CHECKING:
    from app.models.portfolio import Portfolio


class SubscriptionTier(str, enum.Enum):
    """Institutional & Retail Tier segmentation."""
    RETAIL_FREE = "RETAIL_FREE"
    RETAIL_PRO = "RETAIL_PRO"
    CORPORATE = "CORPORATE"
    INSTITUTIONAL = "INSTITUTIONAL"


class UserRole(str, enum.Enum):
    """Role-based access control (RBAC)."""
    ADMIN = "ADMIN"
    PORTFOLIO_MANAGER = "PORTFOLIO_MANAGER"
    ANALYST = "ANALYST"
    INVESTOR = "INVESTOR"


class User(Base, UUIDMixin, TimestampMixin):
    """Core User entity with institutional access control."""
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(150), nullable=False)
    phone_number: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)

    # Status & RBAC
    role: Mapped[UserRole] = mapped_column(
        SqlEnum(UserRole, name="user_role_enum"),
        default=UserRole.INVESTOR,
        nullable=False
    )
    subscription_tier: Mapped[SubscriptionTier] = mapped_column(
        SqlEnum(SubscriptionTier, name="subscription_tier_enum"),
        default=SubscriptionTier.RETAIL_FREE,
        nullable=False,
        index=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_corporate: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # 1:1 Corporate Profile relationship (for institutional/corporate entities)
    corporate_profile: Mapped[Optional["CorporateProfile"]] = relationship(
        "CorporateProfile",
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan"
    )

    # 1:1 Mandate & Portfolio Constraints relationship
    portfolio_limits: Mapped[Optional["PortfolioLimit"]] = relationship(
        "PortfolioLimit",
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan"
    )

    # 1:N Portfolios owned by this user
    portfolios: Mapped[List["Portfolio"]] = relationship(
        "Portfolio",
        back_populates="user",
        cascade="all, delete-orphan"
    )


class CorporateProfile(Base, UUIDMixin, TimestampMixin):
    """
    Corporate & Institutional metadata for family offices, asset management firms,
    and enterprise clients (VKN, LEI Code, Trade Registry).
    """
    __tablename__ = "corporate_profiles"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
        index=True
    )

    company_name: Mapped[str] = mapped_column(String(255), nullable=False)
    tax_id_vkn: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    tax_office: Mapped[str] = mapped_column(String(100), nullable=False)
    trade_registry_no: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    
    # ISO 17442 Legal Entity Identifier (LEI) for MiFID II / EMIR compliance
    lei_code: Mapped[Optional[str]] = mapped_column(String(20), unique=True, nullable=True)
    
    country: Mapped[str] = mapped_column(String(3), default="TUR", nullable=False)
    registered_address: Mapped[str] = mapped_column(String(500), nullable=False)
    compliance_officer_name: Mapped[Optional[str]] = mapped_column(String(150), nullable=True)
    compliance_officer_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    is_regulated_entity: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    user: Mapped["User"] = relationship("User", back_populates="corporate_profile")


class PortfolioLimit(Base, UUIDMixin, TimestampMixin):
    """
    Mandate & Risk Constraints engine.
    Restricts maximum exposure, leverage, single asset allocation weights (e.g. 10/40 rule),
    and daily trading quotas.
    """
    __tablename__ = "portfolio_limits"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
        index=True
    )

    # Maximum portfolios user can manage
    max_portfolios: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    
    # Max allocation permitted in a single asset (e.g., 0.200000 = max 20% of portfolio)
    max_single_asset_weight: Mapped[SqlRatio] = mapped_column(
        SqlRatio,
        default=0.200000,
        nullable=False
    )
    
    # Max total leverage multiplier (1.000000 = no leverage, 2.000000 = 2x leverage)
    max_leverage_ratio: Mapped[SqlRatio] = mapped_column(
        SqlRatio,
        default=1.000000,
        nullable=False
    )
    
    # Daily maximum aggregate transaction volume (in base currency, e.g., 5,000,000 TRY)
    daily_trading_limit_amount: Mapped[SqlMoney] = mapped_column(
        SqlMoney,
        default=1000000.0000,
        nullable=False
    )

    # Allowed asset classes (e.g., ["EQUITY", "ETF", "FIXED_INCOME"])
    allowed_asset_classes: Mapped[list] = mapped_column(
        JSONB,
        default=["EQUITY", "ETF"],
        nullable=False
    )

    # Permitted actions
    short_selling_allowed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    margin_trading_allowed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    derivatives_allowed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    __table_args__ = (
        CheckConstraint('max_single_asset_weight > 0 AND max_single_asset_weight <= 1.0', name='chk_single_asset_weight'),
        CheckConstraint('max_leverage_ratio >= 1.0', name='chk_leverage_ratio'),
    )

    user: Mapped["User"] = relationship("User", back_populates="portfolio_limits")

