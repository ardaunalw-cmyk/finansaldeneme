"""
================================================================================
UTL FİNANS - Quantitative Technical Analysis & Indicator Engine
================================================================================
High-performance quantitative indicator suite:
- Simple Moving Averages (SMA 20, 50, 200) & Golden/Death Cross detection
- Relative Strength Index (RSI 14) with Wilder's smoothing
- Moving Average Convergence Divergence (MACD 12, 26, 9)
- Bollinger Bands (20, 2.0 std dev) & Bandwidth
- Average True Range (ATR 14) Volatility Indicator
"""

from decimal import Decimal
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field

from app.core.precision import round_price, round_ratio


class OHLCVBar(BaseModel):
    timestamp: str
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: Decimal


class IndicatorScorecard(BaseModel):
    current_price: Decimal
    sma_20: Optional[Decimal] = None
    sma_50: Optional[Decimal] = None
    sma_200: Optional[Decimal] = None
    rsi_14: Optional[Decimal] = None
    macd_line: Optional[Decimal] = None
    macd_signal: Optional[Decimal] = None
    macd_histogram: Optional[Decimal] = None
    bollinger_upper: Optional[Decimal] = None
    bollinger_middle: Optional[Decimal] = None
    bollinger_lower: Optional[Decimal] = None
    bollinger_percent_b: Optional[Decimal] = None
    atr_14: Optional[Decimal] = None

    # Trend & Cross Signals
    is_golden_cross: bool = False
    is_death_cross: bool = False
    rsi_signal: str = "NEUTRAL" # OVERSOLD, OVERBOUGHT, NEUTRAL
    macd_signal_state: str = "NEUTRAL" # BULLISH_CROSSOVER, BEARISH_CROSSOVER, NEUTRAL
    overall_technical_bias: str = "NEUTRAL" # STRONG_BULLISH, BULLISH, NEUTRAL, BEARISH, STRONG_BEARISH


class TechnicalAnalysisEngine:
    """
    Mathematical indicator engine operating directly on high-precision numerical lists.
    Guarantees consistent indicator calculations matching Bloomberg / TradingView standards.
    """

    @staticmethod
    def calculate_sma(closes: List[Decimal], period: int) -> List[Optional[Decimal]]:
        """Calculates Simple Moving Average (SMA)."""
        result: List[Optional[Decimal]] = [None] * len(closes)
        if len(closes) < period:
            return result

        for i in range(period - 1, len(closes)):
            window = closes[i - period + 1 : i + 1]
            avg = sum(window) / Decimal(str(period))
            result[i] = round_price(avg)

        return result

    @staticmethod
    def calculate_ema(closes: List[Decimal], period: int) -> List[Optional[Decimal]]:
        """Calculates Exponential Moving Average (EMA)."""
        result: List[Optional[Decimal]] = [None] * len(closes)
        if len(closes) < period:
            return result

        multiplier = Decimal("2.0") / Decimal(str(period + 1))
        initial_sma = sum(closes[:period]) / Decimal(str(period))
        result[period - 1] = round_price(initial_sma)

        for i in range(period, len(closes)):
            prev_ema = result[i - 1]
            if prev_ema is not None:
                ema_val = ((closes[i] - prev_ema) * multiplier) + prev_ema
                result[i] = round_price(ema_val)

        return result

    @classmethod
    def calculate_rsi(cls, closes: List[Decimal], period: int = 14) -> List[Optional[Decimal]]:
        """
        Calculates Relative Strength Index (RSI) using Wilder's Smoothing.
        """
        result: List[Optional[Decimal]] = [None] * len(closes)
        if len(closes) <= period:
            return result

        changes = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
        gains = [max(c, Decimal("0.0")) for c in changes]
        losses = [max(-c, Decimal("0.0")) for c in changes]

        # Initial average gain and loss
        avg_gain = sum(gains[:period]) / Decimal(str(period))
        avg_loss = sum(losses[:period]) / Decimal(str(period))

        if avg_loss == Decimal("0.0"):
            result[period] = Decimal("100.000000")
        else:
            rs = avg_gain / avg_loss
            result[period] = round_price(Decimal("100.0") - (Decimal("100.0") / (Decimal("1.0") + rs)))

        # Wilder's Smoothing for subsequent periods
        for i in range(period + 1, len(closes)):
            gain = gains[i - 1]
            loss = losses[i - 1]

            avg_gain = ((avg_gain * Decimal(str(period - 1))) + gain) / Decimal(str(period))
            avg_loss = ((avg_loss * Decimal(str(period - 1))) + loss) / Decimal(str(period))

            if avg_loss == Decimal("0.0"):
                rsi = Decimal("100.000000")
            else:
                rs = avg_gain / avg_loss
                rsi = Decimal("100.0") - (Decimal("100.0") / (Decimal("1.0") + rs))

            result[i] = round_price(rsi)

        return result

    @classmethod
    def calculate_macd(
        cls,
        closes: List[Decimal],
        fast_period: int = 12,
        slow_period: int = 26,
        signal_period: int = 9
    ) -> Dict[str, List[Optional[Decimal]]]:
        """
        Calculates MACD Line, Signal Line and Histogram:
        MACD Line = EMA(12) - EMA(26)
        Signal Line = EMA(9) of MACD Line
        Histogram = MACD Line - Signal Line
        """
        n = len(closes)
        fast_ema = cls.calculate_ema(closes, fast_period)
        slow_ema = cls.calculate_ema(closes, slow_period)

        macd_line: List[Optional[Decimal]] = [None] * n
        for i in range(n):
            if fast_ema[i] is not None and slow_ema[i] is not None:
                macd_line[i] = round_price(fast_ema[i] - slow_ema[i])

        # Filter valid macd line values for signal line calculation
        valid_indices = [i for i, val in enumerate(macd_line) if val is not None]
        signal_line: List[Optional[Decimal]] = [None] * n
        histogram: List[Optional[Decimal]] = [None] * n

        if len(valid_indices) >= signal_period:
            valid_macd_values = [macd_line[i] for i in valid_indices] # type: ignore
            signal_sub = cls.calculate_ema(valid_macd_values, signal_period)

            for idx, orig_idx in enumerate(valid_indices):
                sig_val = signal_sub[idx]
                signal_line[orig_idx] = sig_val
                if macd_line[orig_idx] is not None and sig_val is not None:
                    histogram[orig_idx] = round_price(macd_line[orig_idx] - sig_val)

        return {
            "macd_line": macd_line,
            "signal_line": signal_line,
            "histogram": histogram
        }

    @classmethod
    def calculate_bollinger_bands(
        cls,
        closes: List[Decimal],
        period: int = 20,
        num_std: Decimal = Decimal("2.0")
    ) -> Dict[str, List[Optional[Decimal]]]:
        """
        Calculates Bollinger Bands (Middle, Upper, Lower, %B):
        Middle = SMA(20)
        Upper = SMA(20) + (2.0 * Standard Deviation)
        Lower = SMA(20) - (2.0 * Standard Deviation)
        """
        n = len(closes)
        middle = cls.calculate_sma(closes, period)
        upper: List[Optional[Decimal]] = [None] * n
        lower: List[Optional[Decimal]] = [None] * n
        percent_b: List[Optional[Decimal]] = [None] * n

        for i in range(period - 1, n):
            window = closes[i - period + 1 : i + 1]
            mean = middle[i]
            if mean is None:
                continue

            # Population / Sample variance
            variance = sum((x - mean) ** 2 for x in window) / Decimal(str(period))
            # Square root using Decimal float bridge for precision
            std_dev = Decimal(str(float(variance) ** 0.5))

            up = round_price(mean + (num_std * std_dev))
            low = round_price(mean - (num_std * std_dev))
            upper[i] = up
            lower[i] = low

            spread = up - low
            if spread > Decimal("0.0"):
                pb = round_ratio((closes[i] - low) / spread)
                percent_b[i] = pb

        return {
            "middle": middle,
            "upper": upper,
            "lower": lower,
            "percent_b": percent_b
        }

    @classmethod
    def calculate_atr(
        cls,
        highs: List[Decimal],
        lows: List[Decimal],
        closes: List[Decimal],
        period: int = 14
    ) -> List[Optional[Decimal]]:
        """Calculates Average True Range (ATR 14)."""
        n = len(closes)
        result: List[Optional[Decimal]] = [None] * n
        if n <= period:
            return result

        true_ranges: List[Decimal] = [highs[0] - lows[0]]
        for i in range(1, n):
            h_l = highs[i] - lows[i]
            h_cp = abs(highs[i] - closes[i - 1])
            l_cp = abs(lows[i] - closes[i - 1])
            tr = max(h_l, h_cp, l_cp)
            true_ranges.append(tr)

        # Initial ATR
        atr = sum(true_ranges[:period]) / Decimal(str(period))
        result[period - 1] = round_price(atr)

        for i in range(period, n):
            atr = ((atr * Decimal(str(period - 1))) + true_ranges[i]) / Decimal(str(period))
            result[i] = round_price(atr)

        return result

    @classmethod
    def evaluate_indicator_scorecard(cls, bars: List[OHLCVBar]) -> IndicatorScorecard:
        """
        Executes full quantitative technical scan on historical bars and evaluates current bias.
        """
        if not bars:
            raise ValueError("Bar series cannot be empty.")

        closes = [b.close for b in bars]
        highs = [b.high for b in bars]
        lows = [b.low for b in bars]
        last_price = closes[-1]

        # Calculate all indicators
        sma_20_series = cls.calculate_sma(closes, 20)
        sma_50_series = cls.calculate_sma(closes, 50)
        sma_200_series = cls.calculate_sma(closes, 200)

        rsi_series = cls.calculate_rsi(closes, 14)
        macd_res = cls.calculate_macd(closes, 12, 26, 9)
        bb_res = cls.calculate_bollinger_bands(closes, 20, Decimal("2.0"))
        atr_series = cls.calculate_atr(highs, lows, closes, 14)

        # Latest values
        latest_sma20 = sma_20_series[-1]
        latest_sma50 = sma_50_series[-1]
        latest_sma200 = sma_200_series[-1]

        latest_rsi = rsi_series[-1]
        latest_macd = macd_res["macd_line"][-1]
        latest_signal = macd_res["signal_line"][-1]
        latest_hist = macd_res["histogram"][-1]

        latest_bb_up = bb_res["upper"][-1]
        latest_bb_mid = bb_res["middle"][-1]
        latest_bb_low = bb_res["lower"][-1]
        latest_bb_pb = bb_res["percent_b"][-1]

        latest_atr = atr_series[-1]

        # Pattern / Signal evaluations
        is_golden = False
        is_death = False
        if latest_sma50 is not None and latest_sma200 is not None:
            is_golden = latest_sma50 > latest_sma200
            is_death = latest_sma50 < latest_sma200

        rsi_state = "NEUTRAL"
        if latest_rsi is not None:
            if latest_rsi >= Decimal("70.0"):
                rsi_state = "OVERBOUGHT"
            elif latest_rsi <= Decimal("30.0"):
                rsi_state = "OVERSOLD"

        macd_state = "NEUTRAL"
        if latest_hist is not None:
            if latest_hist > Decimal("0.0"):
                macd_state = "BULLISH_CROSSOVER"
            elif latest_hist < Decimal("0.0"):
                macd_state = "BEARISH_CROSSOVER"

        # Overall technical bias synthesis (Point system: -4 to +4)
        points = 0
        if latest_sma20 and last_price > latest_sma20:
            points += 1
        elif latest_sma20 and last_price < latest_sma20:
            points -= 1

        if is_golden:
            points += 1
        elif is_death:
            points -= 1

        if rsi_state == "OVERSOLD":
            points += 1 # Potential mean-reversion buy
        elif rsi_state == "OVERBOUGHT":
            points -= 1

        if macd_state == "BULLISH_CROSSOVER":
            points += 1
        elif macd_state == "BEARISH_CROSSOVER":
            points -= 1

        if points >= 3:
            bias = "STRONG_BULLISH"
        elif points >= 1:
            bias = "BULLISH"
        elif points <= -3:
            bias = "STRONG_BEARISH"
        elif points <= -1:
            bias = "BEARISH"
        else:
            bias = "NEUTRAL"

        return IndicatorScorecard(
            current_price=last_price,
            sma_20=latest_sma20,
            sma_50=latest_sma50,
            sma_200=latest_sma200,
            rsi_14=latest_rsi,
            macd_line=latest_macd,
            macd_signal=latest_signal,
            macd_histogram=latest_hist,
            bollinger_upper=latest_bb_up,
            bollinger_middle=latest_bb_mid,
            bollinger_lower=latest_bb_low,
            bollinger_percent_b=latest_bb_pb,
            atr_14=latest_atr,
            is_golden_cross=is_golden,
            is_death_cross=is_death,
            rsi_signal=rsi_state,
            macd_signal_state=macd_state,
            overall_technical_bias=bias
        )

