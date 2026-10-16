"""
================================================================================
UTL FİNANS - UTL Alpha Scoring & Hybrid Quantitative Recommendation Algorithm
================================================================================
Synthesizes Fundamental (60% weight) and Technical (40% weight) signals into a single
institutional score (0.0 to 10.0) with actionable decision logic (GÜÇLÜ AL / AL / TUT / SAT / GÜÇLÜ SAT).
"""

from decimal import Decimal
from typing import Dict, Any, List
from pydantic import BaseModel, Field

from app.core.precision import round_ratio, round_price
from app.analytics.fundamental import DuPontAnalysisResult, AltmanZScoreResult, PiotroskiFScoreResult
from app.analytics.technical import IndicatorScorecard


class UTLAlphaScoreResult(BaseModel):
    ticker: str
    alpha_score: Decimal = Field(..., ge=0, le=10, description="0.0 ile 10.0 arasında nihai UTL Alpha Skoru")
    recommendation: str = Field(..., description="GÜÇLÜ AL, AL, TUT, SAT, GÜÇLÜ SAT")
    fundamental_score: Decimal = Field(..., ge=0, le=10, description="Temel Analiz Alt Skoru (%60 Ağırlık)")
    technical_score: Decimal = Field(..., ge=0, le=10, description="Teknik Analiz Alt Skoru (%40 Ağırlık)")
    risk_level: str = Field(..., description="DÜŞÜK, ORTA, YÜKSEK, KRİTİK")
    key_drivers: List[str]
    rationale_summary: str


class UTLAlphaScoringEngine:
    """
    Multi-factor quantitative decision engine.
    Normalizes divergent fundamental and technical metrics onto a calibrated 0-10 scale.
    """

    @classmethod
    def evaluate_alpha(
        cls,
        ticker: str,
        dupont: DuPontAnalysisResult,
        altman: AltmanZScoreResult,
        piotroski: PiotroskiFScoreResult,
        tech: IndicatorScorecard,
        fundamental_weight: Decimal = Decimal("0.60"),
        technical_weight: Decimal = Decimal("0.40")
    ) -> UTLAlphaScoreResult:
        """
        Calculates the hybrid UTL Alpha Score.
        """
        drivers: List[str] = []

        # ======================================================================
        # 1. Fundamental Component Score (0.0 to 10.0)
        # ======================================================================
        # Sub-factor A: Piotroski F-Score (Contributes up to 4.0 points)
        # F-score is 0-9; (f_score / 9) * 4.0
        piotroski_points = (Decimal(str(piotroski.f_score)) / Decimal("9.0")) * Decimal("4.0")
        if piotroski.f_score >= 8:
            drivers.append(f"Piotroski F-Skoru mükemmel ({piotroski.f_score}/9): Operasyonel verimlilik ve kârlılık üst düzey.")
        elif piotroski.f_score <= 4:
            drivers.append(f"Piotroski F-Skoru zayıf ({piotroski.f_score}/9): Bilanço kalitesinde bozulma sinyali.")

        # Sub-factor B: Altman Z-Score Solvency (Contributes up to 3.0 points)
        if altman.risk_zone == "SAFE":
            altman_points = Decimal("3.0")
            drivers.append(f"Altman Z''-Skoru güvenli bölgede ({altman.z_score:f}): İflas riski ihmal edilebilir.")
        elif altman.risk_zone == "GREY":
            altman_points = Decimal("1.75")
            drivers.append(f"Altman Z''-Skoru gri bölgede ({altman.z_score:f}): Borç çevirme dinamikleri izlenmeli.")
        else:
            altman_points = Decimal("0.5")
            drivers.append(f"Altman Z''-Skoru stres bölgesinde ({altman.z_score:f}): Yüksek finansal kırılganlık.")

        # Sub-factor C: DuPont ROE Quality (Contributes up to 3.0 points)
        roe = dupont.return_on_equity_roe
        npm = dupont.net_profit_margin
        em = dupont.equity_multiplier

        if roe >= Decimal("0.30") and em <= Decimal("3.0"):
            dupont_points = Decimal("3.0")
            drivers.append(f"DuPont ROE çok kuvvetli (%{roe * 100:.2f}) ve organik kâr marjından (%{npm * 100:.2f}) besleniyor.")
        elif roe >= Decimal("0.18"):
            dupont_points = Decimal("2.25")
        elif roe >= Decimal("0.10"):
            dupont_points = Decimal("1.50")
        else:
            dupont_points = Decimal("0.75")
            drivers.append(f"DuPont ROE düşük (%{roe * 100:.2f}): Sermaye getirisi piyasa enflasyonunun altında.")

        fundamental_raw = piotroski_points + altman_points + dupont_points
        fundamental_score = round_price(min(max(fundamental_raw, Decimal("0.0")), Decimal("10.0")))

        # ======================================================================
        # 2. Technical Component Score (0.0 to 10.0)
        # ======================================================================
        # Sub-factor A: Moving Average Alignment & Trend (Up to 4.0 points)
        trend_pts = Decimal("2.0") # Start neutral
        if tech.sma_200 and tech.current_price > tech.sma_200:
            trend_pts += Decimal("1.0")
            drivers.append("Fiyat 200 günlük kurumsal hareketli ortalamanın (SMA 200) üzerinde; ana boğa trendi korunuyor.")
        elif tech.sma_200 and tech.current_price < tech.sma_200:
            trend_pts -= Decimal("1.0")
            drivers.append("Fiyat 200 günlük ortalamanın altında; uzun vadeli ayı baskısı mevcut.")

        if tech.is_golden_cross:
            trend_pts += Decimal("1.0")
            drivers.append("Golden Cross (50 günlük SMA > 200 günlük SMA) aktif boğa formasyonu.")
        elif tech.is_death_cross:
            trend_pts -= Decimal("1.0")
            drivers.append("Death Cross (50 günlük SMA < 200 günlük SMA) trend zayıflığı.")

        trend_score = min(max(trend_pts, Decimal("0.0")), Decimal("4.0"))

        # Sub-factor B: Momentum & RSI (Up to 3.0 points)
        if tech.rsi_14:
            if Decimal("45.0") <= tech.rsi_14 <= Decimal("65.0"):
                rsi_pts = Decimal("3.0") # Healthy expansion
            elif tech.rsi_14 < Decimal("30.0"):
                rsi_pts = Decimal("2.5") # Oversold value buy
                drivers.append("RSI aşırı satım bölgesinde (< 30); güçlü tepki alımı potansiyeli.")
            elif tech.rsi_14 > Decimal("75.0"):
                rsi_pts = Decimal("1.0") # Overextended
                drivers.append("RSI aşırı alım bölgesinde (> 75); kâr realizasyonu riski.")
            else:
                rsi_pts = Decimal("2.0")
        else:
            rsi_pts = Decimal("2.0")

        # Sub-factor C: MACD & Bollinger Position (Up to 3.0 points)
        osc_pts = Decimal("1.5")
        if tech.macd_signal_state == "BULLISH_CROSSOVER":
            osc_pts += Decimal("1.0")
            drivers.append("MACD histogramı pozitif bölgede; alım momentumu güçleniyor.")
        elif tech.macd_signal_state == "BEARISH_CROSSOVER":
            osc_pts -= Decimal("1.0")

        if tech.bollinger_percent_b:
            if Decimal("0.20") <= tech.bollinger_percent_b <= Decimal("0.80"):
                osc_pts += Decimal("0.5")
            elif tech.bollinger_percent_b < Decimal("0.10"):
                osc_pts += Decimal("0.5") # Lower band bounce

        osc_score = min(max(osc_pts, Decimal("0.0")), Decimal("3.0"))

        technical_raw = trend_score + rsi_pts + osc_score
        technical_score = round_price(min(max(technical_raw, Decimal("0.0")), Decimal("10.0")))

        # ======================================================================
        # 3. Hybrid Synthesis & Threshold Decision
        # ======================================================================
        final_alpha = round_price((fundamental_score * fundamental_weight) + (technical_score * technical_weight))

        # Institutional Decision Matrix:
        if final_alpha >= Decimal("8.00"):
            rec = "GÜÇLÜ AL"
            risk = "DÜŞÜK"
            summary = f"{ticker} hem bilanço kalitesi (Piotroski/Altman) hem de teknik trend momentumu açısından üst ligde. Kurumsal alım için güçlü aday."
        elif final_alpha >= Decimal("6.50"):
            rec = "AL"
            risk = "ORTA"
            summary = f"{ticker} sağlıklı temel rasyolara ve olumlu teknik yapıya sahip. Kademeli alım stratejisine uygun."
        elif final_alpha >= Decimal("4.50"):
            rec = "TUT"
            risk = "ORTA"
            summary = f"{ticker} dengeli ancak yön arayışında. Mevcut pozisyonlar korunabilir; yeni giriş için teknik kırılım beklenmeli."
        elif final_alpha >= Decimal("3.00"):
            rec = "SAT"
            risk = "YÜKSEK"
            summary = f"{ticker} temel marjlarda zayıflama veya teknik trendde bozulma gösteriyor. Pozisyon azaltılması tavsiye edilir."
        else:
            rec = "GÜÇLÜ SAT"
            risk = "KRİTİK"
            summary = f"{ticker} yüksek finansal stres ve teknik ayı baskısı altında. Portföy güvenliği için çıkış önerilir."

        return UTLAlphaScoreResult(
            ticker=ticker.upper(),
            alpha_score=final_alpha,
            recommendation=rec,
            fundamental_score=fundamental_score,
            technical_score=technical_score,
            risk_level=risk,
            key_drivers=drivers,
            rationale_summary=summary
        )
