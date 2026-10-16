"""
================================================================================
UTL FİNANS - Fundamental Analysis & Corporate Solvency Engine
================================================================================
Implements institutional fundamental frameworks:
- DuPont Analysis (3-Stage Return on Equity Decomposition)
- Altman Z-Score (Solvency & Bankruptcy Risk for Emerging Markets / BIST)
- Piotroski F-Score (9-Point Fundamental Quality & Health Score)
"""

from decimal import Decimal, ROUND_HALF_EVEN
from typing import Dict, Any, Optional
from pydantic import BaseModel, Field

from app.core.precision import (
    round_ratio,
    round_price,
    round_money,
    sanitize_decimal
)


# ==============================================================================
# Financial Data Input Models
# ==============================================================================
class FinancialPeriodData(BaseModel):
    """Raw financial statement metrics for a fiscal year / quarter."""
    revenue: Decimal = Field(..., description="Net Satışlar / Toplam Hasılat")
    net_income: Decimal = Field(..., description="Dönem Net Kârı / Zararı")
    operating_income_ebit: Decimal = Field(..., description="Faaliyet Kârı (EBIT)")
    operating_cash_flow_cfo: Decimal = Field(..., description="İşletme Faaliyetlerinden Net Nakit Akışları")
    gross_profit: Decimal = Field(..., description="Brüt Kâr")

    total_assets: Decimal = Field(..., description="Toplam Varlıklar / Aktif Toplamı")
    total_equity: Decimal = Field(..., description="Toplam Özkaynaklar")
    current_assets: Decimal = Field(..., description="Dönen Varlıklar")
    current_liabilities: Decimal = Field(..., description="Kısa Vadeli Yükümlülükler")
    total_liabilities: Decimal = Field(..., description="Toplam Borçlar / Yükümlülükler")
    long_term_debt: Decimal = Field(Decimal("0.0"), description="Uzun Vadeli Finansal Borçlar")
    retained_earnings: Decimal = Field(Decimal("0.0"), description="Geçmiş Yıllar Kârları / Dağıtılmamış Kârlar")
    total_shares_outstanding: Decimal = Field(..., description="Ödenmiş Sermaye / Dolaşımdaki Hisse Adedi")
    market_cap: Decimal = Field(..., description="Piyasa Değeri (Market Cap)")


class DuPontAnalysisResult(BaseModel):
    return_on_equity_roe: Decimal = Field(..., description="Özkaynak Kârlılığı (ROE)")
    net_profit_margin: Decimal = Field(..., description="Net Kâr Marjı (Net Income / Revenue)")
    asset_turnover: Decimal = Field(..., description="Aktif Devir Hızı (Revenue / Total Assets)")
    equity_multiplier: Decimal = Field(..., description="Finansal Kaldıraç Çarpanı (Total Assets / Equity)")
    assessment: str = Field(..., description="Kalite ve sürdürülebilirlik değerlendirmesi")


class AltmanZScoreResult(BaseModel):
    z_score: Decimal
    model_type: str = Field(..., description="Emerging Market / Non-Manufacturing Z''-Score")
    risk_zone: str = Field(..., description="SAFE (Güvenli), GREY (Gri Bölge), DISTRESS (İflas Riski)")
    bankruptcy_probability: str
    x1_working_capital_to_assets: Decimal
    x2_retained_earnings_to_assets: Decimal
    x3_ebit_to_assets: Decimal
    x4_equity_to_liabilities: Decimal
    description: str


class PiotroskiFScoreResult(BaseModel):
    f_score: int = Field(..., ge=0, le=9, description="0 ile 9 arasında F-Skoru")
    financial_strength: str = Field(..., description="STRONG (8-9), MODERATE (5-7), WEAK (0-4)")
    profitability_points: int = Field(..., ge=0, le=4)
    leverage_liquidity_points: int = Field(..., ge=0, le=3)
    operating_efficiency_points: int = Field(..., ge=0, le=2)
    score_breakdown: Dict[str, bool]


# ==============================================================================
# Fundamental Analysis Calculation Engine
# ==============================================================================
class FundamentalAnalysisEngine:
    """
    Quantitative fundamental analysis suite.
    Evaluates business quality, solvency margins, and accounting reliability.
    """

    @classmethod
    def calculate_dupont_3stage(cls, data: FinancialPeriodData) -> DuPontAnalysisResult:
        """
        Calculates 3-Stage DuPont ROE Decomposition:
        ROE = Net Profit Margin * Asset Turnover * Equity Multiplier
        """
        revenue = max(data.revenue, Decimal("1.0"))
        total_assets = max(data.total_assets, Decimal("1.0"))
        total_equity = data.total_equity if abs(data.total_equity) > Decimal("1.0") else Decimal("1.0")

        # 1. Net Profit Margin = Net Income / Revenue
        npm = round_ratio(data.net_income / revenue)

        # 2. Asset Turnover = Revenue / Total Assets
        at = round_ratio(revenue / total_assets)

        # 3. Equity Multiplier = Total Assets / Total Equity
        em = round_ratio(total_assets / total_equity)

        # Mathematical ROE = NPM * AT * EM
        roe = round_ratio(npm * at * em)

        # Quality assessment
        if npm > Decimal("0.15") and at > Decimal("0.80"):
            assessment = "Yüksek kâr marjı ve verimli aktif kullanımı kaynaklı yüksek kaliteli ROE."
        elif em > Decimal("3.50"):
            assessment = "ROE yüksek ancak ağırlıklı olarak yüksek finansal kaldıraçtan (borçlanmadan) besleniyor; risk izlenmeli."
        elif roe > Decimal("0.25"):
            assessment = "Sağlıklı sermaye getirisi ve dengeli operasyonel kârlılık."
        else:
            assessment = "Ilımlı veya düşük sermaye kârlılığı; marj baskısı veya düşük kapasite devir hızı."

        return DuPontAnalysisResult(
            return_on_equity_roe=roe,
            net_profit_margin=npm,
            asset_turnover=at,
            equity_multiplier=em,
            assessment=assessment
        )

    @classmethod
    def calculate_altman_z_score(
        cls,
        data: FinancialPeriodData,
        use_emerging_market_model: bool = True
    ) -> AltmanZScoreResult:
        """
        Altman Z-Score Calculation.
        For Borsa İstanbul and emerging markets, Altman's Z''-Score (EM-Score) is the gold standard:
        Z'' = 6.56*X1 + 3.26*X2 + 6.72*X3 + 1.05*X4
        Where:
        X1 = Net Working Capital / Total Assets
        X2 = Retained Earnings / Total Assets
        X3 = Operating Income (EBIT) / Total Assets
        X4 = Market Value of Equity / Total Liabilities
        """
        assets = max(data.total_assets, Decimal("1.0"))
        liabilities = max(data.total_liabilities, Decimal("1.0"))

        working_capital = data.current_assets - data.current_liabilities

        x1 = round_ratio(working_capital / assets)
        x2 = round_ratio(data.retained_earnings / assets)
        x3 = round_ratio(data.operating_income_ebit / assets)
        x4 = round_ratio(data.market_cap / liabilities)

        if use_emerging_market_model:
            # Emerging Markets 4-factor Z''-Score
            model_name = "Altman Z''-Score (Emerging Markets / BIST)"
            z_val = round_price(
                (Decimal("6.56") * x1) +
                (Decimal("3.26") * x2) +
                (Decimal("6.72") * x3) +
                (Decimal("1.05") * x4)
            )

            # Emerging Market Thresholds:
            # Z'' > 2.60: Safe Zone
            # 1.10 <= Z'' <= 2.60: Grey Zone
            # Z'' < 1.10: Distress Zone
            if z_val > Decimal("2.60"):
                risk_zone = "SAFE"
                prob = "İhmal Edilebilir İflas Riski (< %5)"
                desc = "Şirketin likidite ve sermaye yapısı kuvvetli; finansal stres veya iflas riski bulunmuyor."
            elif z_val >= Decimal("1.10"):
                risk_zone = "GREY"
                prob = "Orta Düzey Finansal Stres (%5 - %20)"
                desc = "Gri bölge: Borçluluk ve dönen varlık rasyoları yakından takip edilmeli."
            else:
                risk_zone = "DISTRESS"
                prob = "Yüksek Finansal Stres / İflas Riski (> %50)"
                desc = "Kritik uyarı: Şirketin işletme sermayesi veya operasyonel kârlılığı borç yükünü karşılamada yetersiz."
        else:
            # Standard Manufacturing 5-Factor Model
            sales = max(data.revenue, Decimal("1.0"))
            x5 = round_ratio(sales / assets)
            model_name = "Altman Z-Score (Original Manufacturing)"
            z_val = round_price(
                (Decimal("1.20") * x1) +
                (Decimal("1.40") * x2) +
                (Decimal("3.30") * x3) +
                (Decimal("0.60") * x4) +
                (Decimal("0.999") * x5)
            )
            if z_val > Decimal("2.99"):
                risk_zone = "SAFE"
                prob = "Düşük Risk"
                desc = "Güvenli Bölge."
            elif z_val >= Decimal("1.81"):
                risk_zone = "GREY"
                prob = "Orta Risk"
                desc = "Gri Bölge."
            else:
                risk_zone = "DISTRESS"
                prob = "Yüksek Risk"
                desc = "Finansal Sıkıntı Bölgesi."

        return AltmanZScoreResult(
            z_score=z_val,
            model_type=model_name,
            risk_zone=risk_zone,
            bankruptcy_probability=prob,
            x1_working_capital_to_assets=x1,
            x2_retained_earnings_to_assets=x2,
            x3_ebit_to_assets=x3,
            x4_equity_to_liabilities=x4,
            description=desc
        )

    @classmethod
    def calculate_piotroski_f_score(
        cls,
        current: FinancialPeriodData,
        previous: FinancialPeriodData
    ) -> PiotroskiFScoreResult:
        """
        Piotroski F-Score (0 to 9 integer scale).
        Evaluates 9 binary signals across Profitability, Leverage/Liquidity, and Operating Efficiency.
        """
        breakdown: Dict[str, bool] = {}

        # -------------------------------------------------------------
        # Part 1: Profitability Signals (Max 4 Points)
        # -------------------------------------------------------------
        # 1. Positive Net Income
        breakdown["positive_net_income"] = current.net_income > Decimal("0.0")

        # 2. Positive Operating Cash Flow
        breakdown["positive_operating_cf"] = current.operating_cash_flow_cfo > Decimal("0.0")

        # 3. Higher Return on Assets (ROA) than previous period
        curr_roa = current.net_income / max(current.total_assets, Decimal("1.0"))
        prev_roa = previous.net_income / max(previous.total_assets, Decimal("1.0"))
        breakdown["increasing_roa"] = curr_roa > prev_roa

        # 4. Cash Flow Quality: CFO > Net Income (Accrual Quality)
        breakdown["cf_greater_than_ni"] = current.operating_cash_flow_cfo > current.net_income

        profitability_pts = sum(
            1 for k in ["positive_net_income", "positive_operating_cf", "increasing_roa", "cf_greater_than_ni"]
            if breakdown[k]
        )

        # -------------------------------------------------------------
        # Part 2: Leverage, Liquidity & Solvency Signals (Max 3 Points)
        # -------------------------------------------------------------
        # 5. Lower Long-Term Debt to Total Assets ratio (Deleveraging)
        curr_ltd_ratio = current.long_term_debt / max(current.total_assets, Decimal("1.0"))
        prev_ltd_ratio = previous.long_term_debt / max(previous.total_assets, Decimal("1.0"))
        breakdown["debt_reduction"] = curr_ltd_ratio <= prev_ltd_ratio

        # 6. Higher Current Ratio (Increasing Liquidity)
        curr_cr = current.current_assets / max(current.current_liabilities, Decimal("1.0"))
        prev_cr = previous.current_assets / max(previous.current_liabilities, Decimal("1.0"))
        breakdown["increasing_current_ratio"] = curr_cr > prev_cr

        # 7. No Share Dilution (Shares outstanding <= previous period)
        breakdown["no_dilution"] = current.total_shares_outstanding <= previous.total_shares_outstanding

        leverage_pts = sum(
            1 for k in ["debt_reduction", "increasing_current_ratio", "no_dilution"]
            if breakdown[k]
        )

        # -------------------------------------------------------------
        # Part 3: Operating Efficiency Signals (Max 2 Points)
        # -------------------------------------------------------------
        # 8. Higher Gross Margin than previous year
        curr_gm = current.gross_profit / max(current.revenue, Decimal("1.0"))
        prev_gm = previous.gross_profit / max(previous.revenue, Decimal("1.0"))
        breakdown["increasing_gross_margin"] = curr_gm > prev_gm

        # 9. Higher Asset Turnover than previous year
        curr_at = current.revenue / max(current.total_assets, Decimal("1.0"))
        prev_at = previous.revenue / max(previous.total_assets, Decimal("1.0"))
        breakdown["increasing_asset_turnover"] = curr_at > prev_at

        efficiency_pts = sum(
            1 for k in ["increasing_gross_margin", "increasing_asset_turnover"]
            if breakdown[k]
        )

        total_f_score = profitability_pts + leverage_pts + efficiency_pts

        if total_f_score >= 8:
            strength = "STRONG (Üst Düzey Kurumsal Sağlık & Temel Büyüme)"
        elif total_f_score >= 5:
            strength = "MODERATE (Dengeli / İstikrarlı Temel Performans)"
        else:
            strength = "WEAK (Zayıf Temel Rasyolar / Riskli Finansal Yapı)"

        return PiotroskiFScoreResult(
            f_score=total_f_score,
            financial_strength=strength,
            profitability_points=profitability_pts,
            leverage_liquidity_points=leverage_pts,
            operating_efficiency_points=efficiency_pts,
            score_breakdown=breakdown
        )
