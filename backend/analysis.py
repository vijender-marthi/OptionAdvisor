"""
analysis.py — Signal Generation Layer
======================================
Computes all market signals needed to drive the trade recommendation engine.
No hardcoded strike %s here — everything is derived from data.
"""

import numpy as np
import pandas as pd
from dataclasses import dataclass, field
from typing import Optional
import warnings
warnings.filterwarnings("ignore")


# ─────────────────────────────────────────────────────────────
# DATA CLASSES
# ─────────────────────────────────────────────────────────────

@dataclass
class MarketSignals:
    # Price
    current_price: float
    prev_close: float
    price_change: float
    price_change_pct: float

    # Trend
    trend: str              # Bullish / Bearish / Neutral / Mildly Bullish / Mildly Bearish
    trend_strength: str     # Strong / Moderate / Weak
    ma20: float
    ma50: float
    ma200: float
    above_ma20: bool
    above_ma50: bool
    above_ma200: bool
    ma50_slope: float       # % change in MA50 over last 10 days (positive = rising)
    ma200_slope: float

    # Momentum
    rsi: float              # 14-period RSI
    rsi_signal: str         # Overbought / Oversold / Neutral / Mildly Overbought / Mildly Oversold
    macd: float
    macd_signal_line: float
    macd_histogram: float
    macd_crossover: str     # Bullish / Bearish / None

    # Volatility
    current_iv: float       # Median ATM IV from options chain (%)
    hv_20: float            # 20-day historical (realized) volatility (%)
    hv_60: float            # 60-day historical volatility (%)
    iv_rank: float          # 0–100: where IV sits in 52-week range
    iv_percentile: float    # % of days in past year where IV was lower
    iv_vs_hv: float         # current_iv - hv_20 (positive = IV premium, good to sell)
    iv_environment: str     # High / Elevated / Moderate / Low / Very Low

    # Sentiment
    put_call_ratio: float
    pcr_signal: str         # Bearish / Neutral / Bullish
    iv_skew: float          # Put IV - Call IV at same OTM% (positive = put skew = fear)
    skew_signal: str        # High Fear / Normal / Low Fear

    # Composite
    directional_bias: str   # Bullish / Bearish / Neutral
    bias_confidence: int    # 0–100
    volatility_regime: str  # Sell Premium / Buy Premium / Neutral

    # Raw history for charts
    price_history: list = field(default_factory=list)


@dataclass
class OptionLeg:
    action: str         # BUY or SELL
    option_type: str    # CALL or PUT
    strike: float
    expiry: str
    delta: float
    mid_price: float
    bid: float
    ask: float
    iv: float
    oi: int
    volume: int
    bid_ask_spread_pct: float   # (ask - bid) / mid * 100
    data_quality: str = "OK"    # "OK" | "MODEL" | "STALE" | "UNRELIABLE"
    data_quality_reason: str = ""


@dataclass
class TradeCandidate:
    strategy: str
    bias: str
    legs: list[OptionLeg]
    expiry: str
    dte: int

    # Raw financials
    net_credit: float       # positive = credit received, negative = debit paid
    spread_width: float     # for spreads: width between strikes
    max_profit: float       # per share
    max_loss: float         # per share (absolute value)

    # Risk metrics
    risk_reward_ratio: float        # max_loss / max_profit (lower is better for buyers)
    credit_pct_of_width: float      # for credit spreads: net_credit / spread_width * 100
    breakeven_lower: float
    breakeven_upper: float

    # Probability metrics
    short_leg_delta: float          # delta of the short strike (credit) or long strike (debit)
    prob_of_profit: float           # 1 - short_leg_delta for credit; approximated for debit
    prob_of_max_loss: float         # estimated

    # Expected Value
    expected_value: float           # (PoP * max_profit) - (PoL * max_loss) per share

    # Quality flags
    passes_rr_filter: bool          # R:R acceptable?
    passes_liquidity_filter: bool   # Bid-ask spread OK? OI sufficient?
    passes_credit_filter: bool      # Credit ≥ 25% of width (for credit spreads)?

    # Scoring
    signal_score: int       # 0–40: how well signals align with strategy
    structure_score: int    # 0–30: quality of trade structure (R:R, EV, delta)
    liquidity_score: int    # 0–20: how liquid the options are
    iv_fit_score: int       # 0–10: how well IV environment fits strategy
    total_score: int        # 0–100

    rationale: str
    exit_plan: str
    warnings: list[str] = field(default_factory=list)


# ─────────────────────────────────────────────────────────────
# SIGNAL COMPUTATION
# ─────────────────────────────────────────────────────────────

def compute_rsi(series: pd.Series, period: int = 14) -> float:
    delta = series.diff()
    gain = delta.clip(lower=0).rolling(period).mean()
    loss = (-delta.clip(upper=0)).rolling(period).mean()
    rs = gain / (loss + 1e-10)
    rsi = 100 - (100 / (1 + rs))
    return round(float(rsi.iloc[-1]), 1)


def compute_macd(series: pd.Series):
    ema12 = series.ewm(span=12, adjust=False).mean()
    ema26 = series.ewm(span=26, adjust=False).mean()
    macd_line = ema12 - ema26
    signal_line = macd_line.ewm(span=9, adjust=False).mean()
    histogram = macd_line - signal_line
    macd_val = float(macd_line.iloc[-1])
    signal_val = float(signal_line.iloc[-1])
    hist_val = float(histogram.iloc[-1])
    prev_hist = float(histogram.iloc[-2]) if len(histogram) > 1 else hist_val

    if hist_val > 0 and prev_hist <= 0:
        crossover = "Bullish"
    elif hist_val < 0 and prev_hist >= 0:
        crossover = "Bearish"
    else:
        crossover = "None"

    return round(macd_val, 4), round(signal_val, 4), round(hist_val, 4), crossover


def compute_hv(series: pd.Series, period: int) -> float:
    returns = series.pct_change().dropna()
    hv = returns.rolling(period).std().iloc[-1] * np.sqrt(252) * 100
    return round(float(hv), 1)


def compute_iv_rank(series: pd.Series, current_iv: float) -> float:
    """IV Rank: position of current IV within 52-week HV range."""
    low = float(series.min())
    high = float(series.max())
    if high == low:
        return 50.0
    rank = (current_iv - low) / (high - low) * 100
    return round(float(np.clip(rank, 0, 100)), 1)


def compute_iv_percentile(series: pd.Series, current_iv: float) -> float:
    """IV Percentile: % of days in past year where IV was lower than today."""
    pct = (series < current_iv).mean() * 100
    return round(float(pct), 1)


def compute_iv_from_chain(calls: pd.DataFrame, puts: pd.DataFrame, price: float) -> float:
    """Median IV of near-the-money options (within 5% of price)."""
    ntm_calls = calls[abs(calls["strike"] - price) / price <= 0.05]
    ntm_puts = puts[abs(puts["strike"] - price) / price <= 0.05]
    combined = pd.concat([ntm_calls, ntm_puts])
    iv_vals = combined["impliedVolatility"].replace(0, np.nan).dropna()
    if iv_vals.empty:
        # fallback: all NTM options within 10%
        ntm_calls = calls[abs(calls["strike"] - price) / price <= 0.10]
        ntm_puts = puts[abs(puts["strike"] - price) / price <= 0.10]
        combined = pd.concat([ntm_calls, ntm_puts])
        iv_vals = combined["impliedVolatility"].replace(0, np.nan).dropna()
    if iv_vals.empty:
        return 30.0
    return round(float(iv_vals.median() * 100), 1)


def compute_skew(calls: pd.DataFrame, puts: pd.DataFrame, price: float) -> float:
    """
    IV skew: average IV of 10% OTM puts minus average IV of 10% OTM calls.
    Positive = put skew (fear), negative = call skew (greed).
    """
    otm_put_target = price * 0.90
    otm_call_target = price * 1.10

    put_iv = puts.iloc[(puts["strike"] - otm_put_target).abs().argsort()[:3]]["impliedVolatility"].mean()
    call_iv = calls.iloc[(calls["strike"] - otm_call_target).abs().argsort()[:3]]["impliedVolatility"].mean()

    skew = (put_iv - call_iv) * 100
    return round(float(skew), 2)


def compute_put_call_ratio(calls: pd.DataFrame, puts: pd.DataFrame) -> float:
    call_vol = calls["volume"].fillna(0).sum()
    put_vol = puts["volume"].fillna(0).sum()
    if call_vol == 0:
        return 1.0
    return round(float(put_vol / call_vol), 2)


def compute_trend(hist: pd.DataFrame) -> tuple:
    close = hist["Close"]
    current = float(close.iloc[-1])
    ma20 = float(close.rolling(20).mean().iloc[-1])
    ma50 = float(close.rolling(50).mean().iloc[-1])
    ma200 = float(close.rolling(200).mean().iloc[-1])

    ma50_10d_ago = float(close.rolling(50).mean().iloc[-11]) if len(close) > 60 else ma50
    ma200_10d_ago = float(close.rolling(200).mean().iloc[-11]) if len(close) > 210 else ma200
    ma50_slope = round((ma50 - ma50_10d_ago) / ma50_10d_ago * 100, 3)
    ma200_slope = round((ma200 - ma200_10d_ago) / ma200_10d_ago * 100, 3)

    above_ma20 = current > ma20
    above_ma50 = current > ma50
    above_ma200 = current > ma200

    # Trend classification
    if current > ma50 > ma200 and ma50_slope > 0:
        trend = "Bullish"
        strength = "Strong"
    elif current > ma50 > ma200:
        trend = "Bullish"
        strength = "Moderate"
    elif current > ma50 and current > ma200:
        trend = "Mildly Bullish"
        strength = "Moderate"
    elif current > ma50:
        trend = "Mildly Bullish"
        strength = "Weak"
    elif current < ma50 < ma200 and ma50_slope < 0:
        trend = "Bearish"
        strength = "Strong"
    elif current < ma50 < ma200:
        trend = "Bearish"
        strength = "Moderate"
    elif current < ma50 and current < ma200:
        trend = "Mildly Bearish"
        strength = "Moderate"
    elif current < ma50:
        trend = "Mildly Bearish"
        strength = "Weak"
    else:
        trend = "Neutral"
        strength = "Weak"

    return trend, strength, round(ma20, 2), round(ma50, 2), round(ma200, 2), \
           above_ma20, above_ma50, above_ma200, ma50_slope, ma200_slope


def classify_rsi(rsi: float) -> str:
    if rsi >= 75:
        return "Overbought"
    elif rsi >= 65:
        return "Mildly Overbought"
    elif rsi <= 25:
        return "Oversold"
    elif rsi <= 35:
        return "Mildly Oversold"
    else:
        return "Neutral"


def classify_iv_environment(iv_rank: float, iv_vs_hv: float) -> str:
    if iv_rank >= 70 and iv_vs_hv > 5:
        return "High"
    elif iv_rank >= 50:
        return "Elevated"
    elif iv_rank >= 35:
        return "Moderate"
    elif iv_rank >= 20:
        return "Low"
    else:
        return "Very Low"


def compute_directional_bias(
    trend: str, rsi: float, macd_crossover: str, pcr: float
) -> tuple[str, int]:
    """
    Combine multiple signals into a directional bias with confidence score.
    Returns (bias, confidence 0-100)
    """
    bull_score = 0
    bear_score = 0

    # Trend (weight: 40)
    trend_weights = {
        "Bullish": (40, 0), "Mildly Bullish": (25, 0),
        "Bearish": (0, 40), "Mildly Bearish": (0, 25),
        "Neutral": (0, 0)
    }
    b, br = trend_weights.get(trend, (0, 0))
    bull_score += b
    bear_score += br

    # RSI (weight: 25)
    if rsi <= 30:
        bull_score += 25       # oversold → bullish reversal signal
    elif rsi <= 45:
        bull_score += 10
    elif rsi >= 70:
        bear_score += 25       # overbought → bearish reversal signal
    elif rsi >= 55:
        bear_score += 10

    # MACD crossover (weight: 20)
    if macd_crossover == "Bullish":
        bull_score += 20
    elif macd_crossover == "Bearish":
        bear_score += 20

    # PCR (weight: 15) — contrarian: high PCR = bearish sentiment = bullish signal
    if pcr > 1.3:
        bull_score += 15       # too many puts = contrarian bullish
    elif pcr > 1.1:
        bull_score += 7
    elif pcr < 0.7:
        bear_score += 15       # too many calls = contrarian bearish
    elif pcr < 0.9:
        bear_score += 7

    total = bull_score + bear_score
    if total == 0:
        return "Neutral", 0

    if bull_score > bear_score:
        confidence = int((bull_score - bear_score) / 100 * 100)
        confidence = min(confidence + 20, 95)
        return "Bullish", confidence
    elif bear_score > bull_score:
        confidence = int((bear_score - bull_score) / 100 * 100)
        confidence = min(confidence + 20, 95)
        return "Bearish", confidence
    else:
        return "Neutral", 0


def build_hv_series(hist: pd.DataFrame, period: int = 20) -> pd.Series:
    returns = hist["Close"].pct_change().dropna()
    return returns.rolling(period).std() * np.sqrt(252) * 100


def generate_signals(hist: pd.DataFrame, calls: pd.DataFrame, puts: pd.DataFrame) -> MarketSignals:
    """Master function — computes all signals from raw data."""
    close = hist["Close"]
    current_price = float(close.iloc[-1])
    prev_close = float(close.iloc[-2])
    price_change = round(current_price - prev_close, 2)
    price_change_pct = round(price_change / prev_close * 100, 2)

    # Trend
    trend, strength, ma20, ma50, ma200, above_ma20, above_ma50, above_ma200, \
        ma50_slope, ma200_slope = compute_trend(hist)

    # Momentum
    rsi = compute_rsi(close)
    rsi_signal = classify_rsi(rsi)
    macd, macd_sig, macd_hist, macd_cross = compute_macd(close)

    # Volatility
    hv_20 = compute_hv(close, 20)
    hv_60 = compute_hv(close, 60)
    current_iv = compute_iv_from_chain(calls, puts, current_price)
    hv_series = build_hv_series(hist, 20)
    iv_rank = compute_iv_rank(hv_series, current_iv)
    iv_percentile = compute_iv_percentile(hv_series, current_iv)
    iv_vs_hv = round(current_iv - hv_20, 1)
    iv_env = classify_iv_environment(iv_rank, iv_vs_hv)

    # Determine volatility regime
    if iv_rank >= 50 and iv_vs_hv > 0:
        vol_regime = "Sell Premium"
    elif iv_rank < 35 or iv_vs_hv < -5:
        vol_regime = "Buy Premium"
    else:
        vol_regime = "Neutral"

    # Sentiment
    pcr = compute_put_call_ratio(calls, puts)
    pcr_signal = "Bearish" if pcr > 1.2 else ("Bullish" if pcr < 0.8 else "Neutral")
    skew = compute_skew(calls, puts, current_price)
    skew_signal = "High Fear" if skew > 5 else ("Low Fear" if skew < -2 else "Normal")

    # Composite bias
    directional_bias, bias_confidence = compute_directional_bias(trend, rsi, macd_cross, pcr)

    # Price history for chart
    price_hist_df = hist[["Close"]].copy()
    price_hist_df["MA20"] = close.rolling(20).mean()
    price_hist_df["MA50"] = close.rolling(50).mean()
    price_hist_df["MA200"] = close.rolling(200).mean()
    price_hist_df = price_hist_df.dropna().tail(252)
    price_history = [
        {
            "date": str(idx.date()),
            "close": round(float(row["Close"]), 2),
            "ma20": round(float(row["MA20"]), 2),
            "ma50": round(float(row["MA50"]), 2),
            "ma200": round(float(row["MA200"]), 2),
        }
        for idx, row in price_hist_df.iterrows()
    ]

    return MarketSignals(
        current_price=round(current_price, 2),
        prev_close=round(prev_close, 2),
        price_change=price_change,
        price_change_pct=price_change_pct,
        trend=trend,
        trend_strength=strength,
        ma20=ma20, ma50=ma50, ma200=ma200,
        above_ma20=above_ma20, above_ma50=above_ma50, above_ma200=above_ma200,
        ma50_slope=ma50_slope, ma200_slope=ma200_slope,
        rsi=rsi, rsi_signal=rsi_signal,
        macd=macd, macd_signal_line=macd_sig,
        macd_histogram=macd_hist, macd_crossover=macd_cross,
        current_iv=current_iv, hv_20=hv_20, hv_60=hv_60,
        iv_rank=iv_rank, iv_percentile=iv_percentile,
        iv_vs_hv=iv_vs_hv, iv_environment=iv_env,
        put_call_ratio=pcr, pcr_signal=pcr_signal,
        iv_skew=skew, skew_signal=skew_signal,
        directional_bias=directional_bias, bias_confidence=bias_confidence,
        volatility_regime=vol_regime,
        price_history=price_history,
    )
