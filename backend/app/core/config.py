"""
================================================================================
UTL FİNANS - Application Configuration
================================================================================
"""

from typing import List
from pydantic_settings import BaseSettings
from pydantic import Field, AnyHttpUrl


class Settings(BaseSettings):
    PROJECT_NAME: str = "UTL FİNANS - Sovereign Intelligence & Core Engine"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"
    ENVIRONMENT: str = Field(default="development")

    # PostgreSQL Connection Strings
    DATABASE_URL: str = Field(
        default="postgresql+asyncpg://utl_admin:UtlFinansSecure2026!@localhost:5432/utl_finans_db",
        description="Async PostgreSQL connection string"
    )
    SYNC_DATABASE_URL: str = Field(
        default="postgresql+psycopg2://utl_admin:UtlFinansSecure2026!@localhost:5432/utl_finans_db",
        description="Sync PostgreSQL connection string for Alembic migrations"
    )

    # Database Pool Tuning (Optimized for High-Throughput Financial Feeds)
    DB_POOL_SIZE: int = 25
    DB_MAX_OVERFLOW: int = 15
    DB_POOL_TIMEOUT: int = 30
    DB_POOL_RECYCLE: int = 1800

    # Redis Cache & Market Pub/Sub
    REDIS_URL: str = Field(default="redis://localhost:6379/0")

    # Security & Tokens
    SECRET_KEY: str = Field(default="utl_super_secret_sovereign_intelligence_2026_key")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days
    ALGORITHM: str = "HS256"

    # CORS Configuration
    BACKEND_CORS_ORIGINS: List[str] = [
        "http://localhost",
        "http://localhost:3000",
        "http://localhost:8000",
        "http://localhost:8080",
        "http://127.0.0.1:8080"
    ]

    class Config:
        case_sensitive = True
        env_file = ".env"
        extra = "ignore"


settings = Settings()
