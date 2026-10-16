"""
================================================================================
UTL FİNANS - Quantitative Analytics & Algorithmic Scoring Endpoints
================================================================================
"""

from typing import List, Optional
from decimal import Decimal
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.analytics.fundamental import (
    FundamentalAnalysisEngine,
    FinancialPeriodData,
    DuPontAnalysisResult,
    AltmanZScoreResult,
    PiotroskiFScoreResult
)
from app.analytics.technical import (
    TechnicalAnalysisEngine,
    OHLCVBar,
    IndicatorScorecard
)
from app.analytics.alpha_scoring import (
    UTLAlphaScoringEngine,
    UTLAlphaScoreResult
)
from app.analytics.rebalancing import (
    SwissRiskParityRebalancer,
    PositionInput,
    RebalancePlanResult
)

router = APIRouter(prefix="/analytics", tags=["Algorithmic Engine & Quantitative Analysis"])


# ==============================================================================
# 1. Fundamental Analysis Endpoint
# ==============================================================================
class FundamentalEvaluationRequest(BaseModel):
    ticker: str
    current_period: FinancialPeriodData
    previous_period: Optional[FinancialPeriodData] = None


class FundamentalEvaluationResponse(BaseModel):
    ticker: str
    dupont_3stage: DuPontAnalysisResult
    altman_z_score: AltmanZScoreResult
    piotroski_f_score: Optional[PiotroskiFScoreResult] = None


@router.post("/fundamental", response_model=FundamentalEvaluationResponse)
async def evaluate_fundamental_health(payload: FundamentalEvaluationRequest):
    """
    Computes DuPont ROE Decomposition, Altman Z''-Score, and Piotroski F-Score.
    """
    dupont = FundamentalAnalysisEngine.calculate_dupont_3stage(payload.current_period)
    altman = FundamentalAnalysisEngine.calculate_altman_z_score(payload.current_period, use_emerging_market_model=True)

    piotroski = None
    if payload.previous_period:
        piotroski = FundamentalAnalysisEngine.calculate_piotroski_f_score(
            current=payload.current_period,
            previous=payload.previous_period
        )

    return FundamentalEvaluationResponse(
        ticker=payload.ticker.upper(),
        dupont_3stage=dupont,
        altman_z_score=altman,
        piotroski_f_score=piotroski
    )


# ==============================================================================
# 2. Technical Analysis Endpoint
# ==============================================================================
class TechnicalEvaluationRequest(BaseModel):
    ticker: str
    bars: List[OHLCVBar]


@router.post("/technical", response_model=IndicatorScorecard)
async def evaluate_technical_indicators(payload: TechnicalEvaluationRequest):
    """
    Runs quantitative indicator suite (SMA 20/50/200, RSI 14, MACD, Bollinger Bands, ATR).
    """
    if len(payload.bars) < 20:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A minimum of 20 historical bars is required for moving averages and Bollinger Bands."
        )

    scorecard = TechnicalAnalysisEngine.evaluate_indicator_scorecard(payload.bars)
    return scorecard


# ==============================================================================
# 3. UTL Alpha Scoring Endpoint
# ==============================================================================
class AlphaScoreRequest(BaseModel):
    ticker: str
    current_financials: FinancialPeriodData
    previous_financials: FinancialPeriodData
    bars: List[OHLCVBar]
    fundamental_weight: Decimal = Decimal("0.60")
    technical_weight: Decimal = Decimal("0.40")


@router.post("/alpha-score", response_model=UTLAlphaScoreResult)
async def compute_utl_alpha_score(payload: AlphaScoreRequest):
    """
    Computes hybrid UTL Alpha Score (0-10) with institutional recommendation logic.
    """
    # 1. Fundamental Suite
    dupont = FundamentalAnalysisEngine.calculate_dupont_3stage(payload.current_financials)
    altman = FundamentalAnalysisEngine.calculate_altman_z_score(payload.current_financials, use_emerging_market_model=True)
    piotroski = FundamentalAnalysisEngine.calculate_piotroski_f_score(
        current=payload.current_financials,
        previous=payload.previous_financials
    )

    # 2. Technical Suite
    tech = TechnicalAnalysisEngine.evaluate_indicator_scorecard(payload.bars)

    # 3. Hybrid Synthesis
    alpha = UTLAlphaScoringEngine.evaluate_alpha(
        ticker=payload.ticker,
        dupont=dupont,
        altman=altman,
        piotroski=piotroski,
        tech=tech,
        fundamental_weight=payload.fundamental_weight,
        technical_weight=payload.technical_weight
    )

    return alpha


# ==============================================================================
# 4. Portfolio Rebalancing Endpoint (Swiss Risk Parity)
# ==============================================================================
class PortfolioRebalanceRequest(BaseModel):
    positions: List[PositionInput]
    current_cash: Decimal
    target_beta: Decimal = Decimal("1.00")
    max_single_asset_cap: Decimal = Decimal("0.20") # 20% Swiss Cap


@router.post("/rebalance", response_model=RebalancePlanResult)
async def execute_swiss_rebalance(payload: PortfolioRebalanceRequest):
    """
    Executes Swiss Risk Parity rebalance enforcing a strict 20% single-asset cap
    and Target Beta alignment.
    """
    result = SwissRiskParityRebalancer.rebalance(
        positions=payload.positions,
        current_cash=payload.current_cash,
        target_beta=payload.target_beta,
        max_asset_weight_cap=payload.max_single_asset_cap
    )
    return result
