"""
================================================================================
UTL FİNANS - Financial Precision & Numeric Standards
================================================================================
Critical Module: Prevents floating-point drift, IEEE-754 inaccuracy, and decimal
rounding errors across all financial computations (prices, quantities, cash,
ratios, weights, and returns).
"""

from decimal import Decimal, ROUND_HALF_EVEN, ROUND_HALF_UP, getcontext
from typing import Annotated, Any, Union
from sqlalchemy import Numeric, TypeDecorator
from pydantic import PlainSerializer, BeforeValidator

# Set enterprise global decimal context (38 decimal digits precision)
getcontext().prec = 38
getcontext().rounding = ROUND_HALF_EVEN

# ==============================================================================
# Database Column Type Definitions (PostgreSQL Numeric Specifications)
# ==============================================================================
# 1. Price Precision: Micro-ticks, kuruş/sub-cent precision (e.g., 148.525000 TRY)
PRICE_PRECISION = Numeric(precision=18, scale=6)

# 2. Quantity Precision: Fractional shares, crypto units, stock splits (e.g., 1250.00000000 units)
QUANTITY_PRECISION = Numeric(precision=24, scale=8)

# 3. Monetary Amount / Value: Portfolios, total trades, cash balances (e.g., 10,540,250.1250 TRY)
MONEY_PRECISION = Numeric(precision=24, scale=4)

# 4. Ratios / Percentages / Returns / Volatilities: (e.g., 0.124550 -> 12.4550%)
RATIO_PRECISION = Numeric(precision=12, scale=6)

# 5. High-Precision Macroeconomic & Quant Weights: (e.g., Sharpe, Beta, VaR)
QUANT_PRECISION = Numeric(precision=20, scale=10)


# ==============================================================================
# Safe Decimal TypeDecorator for SQLAlchemy
# ==============================================================================
class SafeFinancialDecimal(TypeDecorator):
    """
    SQLAlchemy TypeDecorator that strictly enforces Python Decimal instantiation
    from PostgreSQL NUMERIC columns, never letting floats contaminate the ORM layer.
    """
    impl = Numeric
    cache_ok = True

    def __init__(self, precision: int = 24, scale: int = 4, *args: Any, **kwargs: Any) -> None:
        super().__init__(precision=precision, scale=scale, *args, **kwargs)
        self.scale = scale

    def process_bind_param(self, value: Any, dialect: Any) -> Union[Decimal, None]:
        if value is None:
            return None
        if isinstance(value, float):
            # Strict financial safeguard: Prevent float literal poisoning
            return Decimal(str(value)).quantize(Decimal(10) ** -self.scale, rounding=ROUND_HALF_EVEN)
        return Decimal(value).quantize(Decimal(10) ** -self.scale, rounding=ROUND_HALF_EVEN)

    def process_result_value(self, value: Any, dialect: Any) -> Union[Decimal, None]:
        if value is None:
            return None
        return Decimal(str(value))


# Specific instantiated ORM column types
SqlPrice = SafeFinancialDecimal(precision=18, scale=6)
SqlQuantity = SafeFinancialDecimal(precision=24, scale=8)
SqlMoney = SafeFinancialDecimal(precision=24, scale=4)
SqlRatio = SafeFinancialDecimal(precision=12, scale=6)


# ==============================================================================
# Precision Sanitizers & Rounding Functions
# ==============================================================================
def sanitize_decimal(val: Union[int, str, float, Decimal], scale: int = 4, rounding: str = ROUND_HALF_EVEN) -> Decimal:
    """
    Safely convert any numeric input into an exact Decimal quantised to the required scale.
    Avoids float binary representation issues by converting through string representation.
    """
    if val is None:
        return Decimal("0.0")
    if isinstance(val, float):
        d = Decimal(str(val))
    else:
        d = Decimal(val)
    return d.quantize(Decimal(10) ** -scale, rounding=rounding)


def round_price(val: Union[Decimal, float, str]) -> Decimal:
    """Standardizes asset price to 6 decimal places."""
    return sanitize_decimal(val, scale=6, rounding=ROUND_HALF_EVEN)


def round_quantity(val: Union[Decimal, float, str]) -> Decimal:
    """Standardizes holding quantity to 8 decimal places."""
    return sanitize_decimal(val, scale=8, rounding=ROUND_HALF_EVEN)


def round_money(val: Union[Decimal, float, str]) -> Decimal:
    """Standardizes cash/portfolio values to 4 decimal places."""
    return sanitize_decimal(val, scale=4, rounding=ROUND_HALF_EVEN)


def round_ratio(val: Union[Decimal, float, str]) -> Decimal:
    """Standardizes ratios/percentages to 6 decimal places."""
    return sanitize_decimal(val, scale=6, rounding=ROUND_HALF_EVEN)


# ==============================================================================
# Pydantic v2 Custom Validated Decimal Types
# ==============================================================================
def _validate_decimal_price(v: Any) -> Decimal:
    return round_price(v)

def _validate_decimal_qty(v: Any) -> Decimal:
    return round_quantity(v)

def _validate_decimal_money(v: Any) -> Decimal:
    return round_money(v)

def _validate_decimal_ratio(v: Any) -> Decimal:
    return round_ratio(v)

# Serializer that keeps strings in JSON responses to avoid Javascript Number truncation
def _serialize_decimal(v: Decimal) -> str:
    return f"{v:f}"

PydanticPrice = Annotated[Decimal, BeforeValidator(_validate_decimal_price), PlainSerializer(_serialize_decimal)]
PydanticQuantity = Annotated[Decimal, BeforeValidator(_validate_decimal_qty), PlainSerializer(_serialize_decimal)]
PydanticMoney = Annotated[Decimal, BeforeValidator(_validate_decimal_money), PlainSerializer(_serialize_decimal)]
PydanticRatio = Annotated[Decimal, BeforeValidator(_validate_decimal_ratio), PlainSerializer(_serialize_decimal)]

