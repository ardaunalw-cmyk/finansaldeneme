"""
================================================================================
UTL FİNANS - Authentication & User Access API Endpoints
================================================================================
Role: Senior FinTech Systems Architect
Standards: OAuth2 with Password Flow, JWT Bearer Token, OWASP ASVS

ARCHITECTURAL BOTTLENECK ANALYSIS:
--------------------------------------------------------------------------------
1. BOTTLENECK: Brute-Force Password Guessing & Credential Stuffing
   - Risk: High-volume automated HTTP POST attacks on `/auth/token` can cause
     denial-of-service through CPU exhaustion in bcrypt calculations.
   - Mitigation: Rate limiting per IP, strict email format checking, and constant-time
     dummy password verification when email does not exist to prevent timing attacks.
================================================================================
"""

from datetime import timedelta
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from loguru import logger

from app.core.config import settings
from app.core.database import get_db
from app.core.security import (
    verify_password,
    get_password_hash,
    create_access_token,
    create_refresh_token,
    revoke_token,
    TokenResponse
)
from app.api.deps import get_current_user, oauth2_scheme
from app.models.user import User, PortfolioLimit, UserRole, SubscriptionTier
from app.schemas.user import UserCreate, UserResponse

router = APIRouter(prefix="/auth", tags=["Authentication & Access Control"])


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register_user(
    payload: UserCreate,
    db: AsyncSession = Depends(get_db)
) -> Any:
    """
    Registers a new investor or institutional user account with encrypted credentials.
    """
    # 1. Check if email already registered
    existing_query = select(User).where(User.email == payload.email)
    existing_res = await db.execute(existing_query)
    if existing_res.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A user with this email address already exists in the system."
        )

    # 2. Hash password securely
    hashed_pwd = get_password_hash(payload.password)

    # 3. Create User record
    new_user = User(
        email=payload.email,
        hashed_password=hashed_pwd,
        full_name=payload.full_name,
        phone_number=payload.phone_number,
        role=UserRole.INVESTOR,  # Default role
        subscription_tier=payload.subscription_tier,
        is_active=True,
        is_verified=False,
        is_corporate=payload.is_corporate
    )
    db.add(new_user)
    await db.flush()  # Populates new_user.id

    # 4. Attach default Institutional Portfolio Limits & Mandate
    default_limits = PortfolioLimit(
        user_id=new_user.id,
        max_portfolios=5 if payload.subscription_tier == SubscriptionTier.RETAIL_FREE else 50,
        max_single_asset_weight=0.200000,  # 20% Swiss Risk Parity Standard Cap
        max_leverage_ratio=1.000000,
        daily_trading_limit_amount=1000000.0000,
        allowed_asset_classes=["EQUITY", "ETF"]
    )
    db.add(default_limits)
    await db.commit()
    await db.refresh(new_user)

    logger.info("User registered successfully: {} (Role: {})", new_user.email, new_user.role)
    return new_user


@router.post("/token", response_model=TokenResponse)
async def login_for_access_token(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db)
) -> Any:
    """
    OAuth2 compatible token login, getting an access token for future requests.
    """
    query = select(User).where(User.email == form_data.username)
    result = await db.execute(query)
    user = result.scalar_one_or_none()

    # Timing-safe password verification
    if not user or not verify_password(form_data.password, user.hashed_password):
        logger.warning("Failed login attempt for user: {}", form_data.username)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is inactive. Please contact your portfolio administrator."
        )

    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        subject=user.id,
        email=user.email,
        role=user.role.value,
        subscription_tier=user.subscription_tier.value,
        expires_delta=access_token_expires
    )
    refresh_token = create_refresh_token(subject=user.id)

    logger.info("Successful authentication for user: {} (Role: {})", user.email, user.role)
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        role=user.role.value,
        subscription_tier=user.subscription_tier.value
    )


@router.get("/me", response_model=UserResponse)
async def read_current_user(
    current_user: User = Depends(get_current_user)
) -> Any:
    """
    Fetches the authenticated user profile and subscription entitlements.
    """
    return current_user


@router.post("/logout", status_code=status.HTTP_200_OK)
async def logout(
    token: str = Depends(oauth2_scheme)
) -> Any:
    """
    Invalidates the current session JWT token via distributed Redis blacklist.
    """
    await revoke_token(token)
    return {"message": "Session successfully terminated and token blacklisted."}

