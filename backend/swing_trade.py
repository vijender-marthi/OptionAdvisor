"""
Swing-trade signal engine using Yahoo Finance daily candles.
Targets multi-day holds (overnight to ~5 sessions).
Not execution advice — educational / research scoring only.

Decision Quality Layer (Phase 1)
─────────────────────────────────
Separates *bias* (bull/bear score) from *entry quality*, *risk level*,
and the final trader action.  Uses only indicators available from daily
candles — optional Yahoo `impliedVolatility` + earnings calendar for playbook hints.

Market context (SPY + QQQ bias) is fetched via bar_cache (TTL-managed).
All yfinance calls are routed through bar_cache — no direct yf usage.
"""
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import date, datetime
import math
from typing import Any, Dict, Literal, Optional, Tuple

import pandas as pd
# yfinance is NOT imported here — all data goes through bar_cache

import bar_cache
from analysis import build_hv_series, compute_hv, compute_iv_rank
from services.market_structure_service import classify_structure
from services.pivot_detection_service import detect_confirmed_pivots

log = logging.getLogger(__name__)

from verdict import Verdict
from verdict_resolver import resolve_verdict

Bias    = Optional[Literal["long", "short"]]

# A 3-5 day swing opened inside this window can run directly into an earnings
# print. The engine may describe a calendar review, but must not authorize a
# new directional premium trade until the post-event structure is known.
EARNINGS_DIRECTIONAL_BLACKOUT_DAYS = 7

# ── Scoring constants ─────────────────────────────────────────────────
MA_FAST          = 20
MA_SLOW          = 50
RSI_PERIOD       = 14
MACD_FAST        = 12
MACD_SLOW        = 26
MACD_SIGNAL      = 9
MOMENTUM_DAYS    = 5       # short-term price momentum window
MIN_BARS         = 60      # need ~3 months of daily history for MA50

# Verdict thresholds (existing scoring engine — unchanged)
GO_THRESHOLD     = 5.5
MARGIN_GO        = 3.0
STRONG_THRESHOLD = 8.0
STRONG_DIFF      = 4.0

# Vetoes
VIX_NO_GO        = 35.0
VIX_CAUTION      = 25.0

# RSI extremes → cap STRONG GO and downgrade verdict + decision layer
# RSI_OVERBOUGHT / RSI_OVERSOLD are the HARD caps used consistently in both
# the verdict layer (caps STRONG GO → WATCH) and the decision layer
# (flags as is_extended → score penalty + WAIT_PULLBACK entry quality).
# RSI_OB_WARN / RSI_OS_WARN are kept as SOFTER thresholds for confirmation
# messages only — they must be <= RSI_OVERBOUGHT / >= RSI_OVERSOLD.
RSI_OVERBOUGHT   = 73.0   # unified hard cap (verdict + decision layers)
RSI_OVERSOLD     = 27.0   # unified hard cap (verdict + decision layers)

# Decision layer: extension thresholds
EXT_5D_WARN      = 8.0    # 5-day move (%) that flags extended
EXT_5D_HARD      = 12.0   # 5-day move (%) that triggers AVOID_CHASE
EXT_MA20_WARN    = 8.0    # % distance from MA20 that flags extended
RSI_OB_WARN      = RSI_OVERBOUGHT   # kept for backward compat — same as hard cap
RSI_OS_WARN      = RSI_OVERSOLD     # kept for backward compat — same as hard cap
GAP_HARD         = 3.0    # today's gap % triggering LATE_ENTRY

# Market ETFs — classified as context tickers, not normal stock picks
_MARKET_ETFS: frozenset[str] = frozenset({"SPY", "QQQ", "IWM", "DIA"})

# ── Module-level market-context cache ─────────────────────────────────
# During market hours SPY/QQQ can move meaningfully in minutes, so use a
# tighter TTL (60s) to avoid stale context biasing back-to-back scans.
# Off-hours the context is stable — 5 minutes is fine.
_MKT_CACHE: dict[str, Any] = {}
_MKT_CACHE_TTL_MARKET = 60    # seconds during RTH
_MKT_CACHE_TTL_OFF    = 300   # seconds off-hours

# ── Per-ticker swing scan result cache ────────────────────────────────
_SWING_SCAN_TTL_MARKET = 90    # seconds during market hours
_SWING_SCAN_TTL_OFF    = 600   # seconds off hours
_swing_scan_cache: Dict[str, Tuple[float, "SwingTradeScan"]] = {}
_swing_scan_lock = threading.Lock()


def clear_scan_cache() -> int:
    """Wipe the swing-trade scan result cache. Returns number of entries cleared."""
    with _swing_scan_lock:
        n = len(_swing_scan_cache)
        _swing_scan_cache.clear()
    return n


def _swing_scan_ttl() -> int:
    from zoneinfo import ZoneInfo as _ZI
    dt = datetime.fromtimestamp(time.time(), tz=_ZI("America/New_York"))
    if dt.weekday() >= 5:
        return _SWING_SCAN_TTL_OFF
    minutes = dt.hour * 60 + dt.minute
    in_market = 9 * 60 + 30 <= minutes < 16 * 60
    return _SWING_SCAN_TTL_MARKET if in_market else _SWING_SCAN_TTL_OFF


# ── Dataclass ─────────────────────────────────────────────────────────

@dataclass
class SwingTradeScan:
    # ── Core scoring (existing fields, unchanged) ─────────────────────
    ticker:       str
    company_name: str
    verdict:      str
    bias:         Bias
    bull_score:   float
    bear_score:   float
    reasons:      list[str]
    metrics:      dict[str, Any]
    # ── Decision Quality Layer ─────────────────────────────────────────
    raw_score:               float             = 0.0
    swing_bias:              str               = "NEUTRAL"
    entry_quality:           str               = "NO_CLEAN_ENTRY"
    risk_level:              str               = "MEDIUM"
    final_action:            str               = "NO_TRADE"
    trade_quality_score:     float             = 0.0
    decision_label:          str               = "NO_TRADE_WAIT"
    decision_message:        str               = ""
    risk_flags:              list[str]         = field(default_factory=list)
    confirmation_needed:     list[str]         = field(default_factory=list)
    suggested_expiry_window: str               = "No trade"
    suggested_strategy:      str               = "NO_TRADE"
    avoid_reason:            Optional[str]     = None
    playbook_hint:           str               = ""
    expected_holding_period:  str               = ""
    recommended_contract_duration: str          = ""
    professional_decision:    dict[str, Any]    = field(default_factory=dict)


# ── Technical helpers ─────────────────────────────────────────────────

def _rsi(close: pd.Series, period: int = RSI_PERIOD) -> pd.Series:
    delta = close.diff()
    gain  = delta.clip(lower=0.0)
    loss  = (-delta).clip(lower=0.0)
    avg_g = gain.ewm(com=period - 1, adjust=False).mean()
    avg_l = loss.ewm(com=period - 1, adjust=False).mean()
    rs    = avg_g / avg_l.replace(0, 1e-10)
    return 100.0 - 100.0 / (1.0 + rs)


def _macd(close: pd.Series) -> tuple[pd.Series, pd.Series, pd.Series]:
    """Returns (macd_line, signal_line, histogram)."""
    ema_fast  = close.ewm(span=MACD_FAST,   adjust=False).mean()
    ema_slow  = close.ewm(span=MACD_SLOW,   adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal    = macd_line.ewm(span=MACD_SIGNAL, adjust=False).mean()
    histogram = macd_line - signal
    return macd_line, signal, histogram


def _sma(close: pd.Series, window: int) -> pd.Series:
    return close.rolling(window=window, min_periods=window).mean()


def _volume_trend(
    df: pd.Series,
    vol: pd.Series,
    days: int = MOMENTUM_DAYS,
    long_window: int = 20,
) -> tuple[str, float]:
    """
    Classifies recent volume participation.
    Returns (label, ratio) where label is one of:
      'bull_expanding'  — up-days carry above-avg volume
      'bear_expanding'  — down-days carry above-avg volume
      'mixed'           — no dominant volume side
      'low'             — recent volume below average
    ratio = mean recent volume / mean 20-day volume.
    """
    if len(df) < long_window + days:
        return "low", 1.0

    recent     = df.iloc[-(days + 1):]
    recent_vol = vol.iloc[-(days + 1):]
    avg_vol    = float(vol.iloc[-(long_window + 1):-1].mean())
    if avg_vol <= 0:
        return "low", 1.0

    returns     = recent.diff().dropna()
    recent_vols = recent_vol.iloc[-days:]
    ratio       = float(recent_vols.mean()) / avg_vol

    up_vol   = recent_vols[returns > 0].mean() if (returns > 0).any() else 0.0
    down_vol = recent_vols[returns < 0].mean() if (returns < 0).any() else 0.0

    if up_vol > avg_vol * 1.2 and up_vol > down_vol:
        return "bull_expanding", ratio
    if down_vol > avg_vol * 1.2 and down_vol > up_vol:
        return "bear_expanding", ratio
    if ratio < 0.7:
        return "low", ratio
    return "mixed", ratio


def _vix_last(force_refresh: bool = False) -> Optional[float]:
    """Return VIX last close, via bar_cache (TTL managed there)."""
    try:
        h = bar_cache.get_history("^VIX", period="10d", interval="1d",
                                   force_refresh=force_refresh)
        if h is None or h.empty:
            return None
        return round(float(h["Close"].iloc[-1]), 2)
    except Exception:
        return None


# ── Decision Quality Layer helpers ────────────────────────────────────

def _compute_swing_bias(bull: float, bear: float) -> str:
    """Map raw scores to a named swing bias enum."""
    if bull >= 8.0 and bear <= 2.0:
        return "STRONG_BULLISH"
    if bull >= 6.0 and bear <= 3.0:
        return "BULLISH"
    if bear >= 8.0 and bull <= 2.0:
        return "STRONG_BEARISH"
    if bear >= 6.0 and bull <= 3.0:
        return "BEARISH"
    return "NEUTRAL"


def _base_risk_level(
    vix_level: Optional[float],
    is_bullish: bool,
    rsi_val: float,
    dist_ma20_pct: float,
    mom_5d_pct: float,
) -> str:
    """Baseline risk level from VIX and extension, before flag upgrades."""
    if vix_level is not None and vix_level >= VIX_NO_GO:
        return "VERY_HIGH"
    if vix_level is not None and vix_level >= VIX_CAUTION:
        return "HIGH"
    # Extension on the active side
    ext_long  = is_bullish  and (rsi_val > RSI_OVERBOUGHT or dist_ma20_pct > 12 or mom_5d_pct > 12)
    ext_short = not is_bullish and (rsi_val < RSI_OVERSOLD or dist_ma20_pct < -12 or mom_5d_pct < -12)
    if ext_long or ext_short:
        return "HIGH"
    if vix_level is not None and vix_level >= VIX_CAUTION * 0.8:
        return "MEDIUM"
    mod_long  = is_bullish  and (rsi_val > 68 or dist_ma20_pct > 5 or mom_5d_pct > 5)
    mod_short = not is_bullish and (rsi_val < 32 or dist_ma20_pct < -5 or mom_5d_pct < -5)
    if mod_long or mod_short:
        return "MEDIUM"
    return "LOW"


def _get_market_bias_raw(ticker: str) -> str:
    """
    Lightweight daily-candle bias for a single ticker.
    Computes only the indicators needed for bias; does NOT run the full scan.
    Used exclusively for market context (SPY, QQQ).
    """
    try:
        raw = bar_cache.get_history(ticker, period="4mo", interval="1d", auto_adjust=True)
        if raw is None or len(raw) < MIN_BARS:
            return "NEUTRAL"
        raw   = raw.sort_index().dropna(subset=["Close"])
        close = raw["Close"].astype(float)
        last  = float(close.iloc[-1])
        ma20  = float(_sma(close, MA_FAST).iloc[-1])
        ma50  = float(_sma(close, MA_SLOW).iloc[-1])
        rsi_v = float(_rsi(close).iloc[-1])
        ml, ms, _ = _macd(close)
        mom   = round((last / float(close.iloc[-MOMENTUM_DAYS]) - 1.0) * 100, 3) \
                if len(close) > MOMENTUM_DAYS and float(close.iloc[-MOMENTUM_DAYS]) > 0 else 0.0

        bull = bear = 0.0
        if last > ma20: bull += 2.0
        else:           bear += 2.0
        if ma20 > ma50: bull += 2.0
        else:           bear += 2.0
        if rsi_v >= 55:  bull += 1.5
        elif rsi_v <= 45: bear += 1.5
        if float(ml.iloc[-1]) > float(ms.iloc[-1]): bull += 2.0
        else:                                        bear += 2.0
        if mom >= 1.5:   bull += 1.0
        elif mom <= -1.5: bear += 1.0

        return _compute_swing_bias(bull, bear)
    except Exception:
        return "NEUTRAL"


def _get_market_context() -> tuple[str, str, str]:
    """
    Returns (spy_bias, qqq_bias, market_context_label).
    market_context_label: MARKET_SUPPORTIVE | MARKET_MIXED | MARKET_WEAK
    """
    spy_bias = _get_market_bias_raw("SPY")
    qqq_bias = _get_market_bias_raw("QQQ")

    bull_set = {"STRONG_BULLISH", "BULLISH"}
    bear_set = {"STRONG_BEARISH", "BEARISH"}

    if spy_bias in bull_set and qqq_bias in bull_set:
        ctx = "MARKET_SUPPORTIVE"
    elif spy_bias in bear_set and qqq_bias in bear_set:
        ctx = "MARKET_WEAK"
    else:
        ctx = "MARKET_MIXED"

    return spy_bias, qqq_bias, ctx


def _mkt_cache_ttl() -> float:
    """Return appropriate TTL: 60s during RTH, 300s off-hours."""
    from datetime import datetime as _dt
    from zoneinfo import ZoneInfo as _ZI
    dt = _dt.now(tz=_ZI("America/New_York"))
    if dt.weekday() >= 5:
        return _MKT_CACHE_TTL_OFF
    minutes = dt.hour * 60 + dt.minute
    in_market = 9 * 60 + 30 <= minutes < 16 * 60
    return _MKT_CACHE_TTL_MARKET if in_market else _MKT_CACHE_TTL_OFF


def _get_market_context_cached() -> tuple[str, str, str]:
    """TTL-adaptive cached wrapper around _get_market_context (60s RTH, 300s off-hours)."""
    now = time.monotonic()
    if _MKT_CACHE.get("ts", 0.0) + _mkt_cache_ttl() > now:
        return (
            _MKT_CACHE["spy_bias"],
            _MKT_CACHE["qqq_bias"],
            _MKT_CACHE["context"],
        )
    spy_bias, qqq_bias, ctx = _get_market_context()
    _MKT_CACHE.update({"ts": now, "spy_bias": spy_bias, "qqq_bias": qqq_bias, "context": ctx})
    return spy_bias, qqq_bias, ctx


def _build_decision_message(
    *,
    ticker:                      str,
    swing_bias:                  str,
    decision_label:              str,
    final_action:                str,
    entry_quality:               str,
    risk_level:                  str,
    trade_quality_score:         float,
    market_context:              str,
    mom_5d_pct:                  float,
    dist_ma20_pct:               float,
    rsi_val:                     float,
    suggested_strategy:          str,
    suggested_expiry_window:     str,
    earnings_within_days:        Optional[int],
    risk_flags:                  list[str],
    is_bullish:                  bool,
    expected_holding_period:     str = "",
    recommended_contract_duration: str = "",
) -> str:
    bias_str  = swing_bias.lower().replace("_", " ")
    strat_str = suggested_strategy.replace("_", " ").title()
    hold_str = f"Holding period: ~{expected_holding_period} (swing). " if expected_holding_period else ""
    contract_str = f"Contract: {recommended_contract_duration} DTE." if recommended_contract_duration else ""

    if decision_label == "MARKET_CONFIRMATION_ONLY":
        return (
            f"{ticker} is used as market context. "
            f"Market bias is {bias_str}. "
            "Trade the ETF only if the setup itself is clean with a defined entry trigger."
        )

    if decision_label == "QUALITY_LONG":
        mkt = "Market is supportive. " if market_context == "MARKET_SUPPORTIVE" else ""
        direction = "bullish" if is_bullish else "bearish"
        return (
            f"{ticker} has a clean {direction} setup (quality score {trade_quality_score}/10). "
            f"{mkt}Best structure: {strat_str}. {hold_str}{contract_str} "
            "Enter on pullback hold or breakout continuation with volume."
        )

    if decision_label == "BULLISH_WAIT_CONFIRMATION":
        direction = "bullish" if is_bullish else "bearish"
        return (
            f"{ticker} trend is {bias_str}, but confirmation is needed before entry. "
            f"Quality score {trade_quality_score}/10 — "
            "wait for a pullback to hold above a key level, or a breakout with volume."
        )

    if decision_label == "BULLISH_BUT_EXTENDED":
        details: list[str] = []
        if abs(mom_5d_pct) > 3:
            details.append(f"{mom_5d_pct:+.1f}% in 5 days")
        if abs(dist_ma20_pct) > 3:
            details.append(f"{dist_ma20_pct:+.1f}% from MA20")
        if (is_bullish and rsi_val > 70) or (not is_bullish and rsi_val < 30):
            details.append(f"RSI {rsi_val:.0f}")
        detail_str = (f" ({', '.join(details)})" if details else "")
        direction = "bullish" if is_bullish else "bearish"
        if final_action == "AVOID_CHASE":
            return (
                f"{ticker} trend is {bias_str}, but the entry is very late{detail_str}. "
                "The move has already happened. Avoid chasing — wait for a pullback or base to form."
            )
        return (
            f"{ticker} trend is {bias_str}, but entry is overextended{detail_str}. "
            "Wait for a pullback to MA20 or consolidation before considering entry."
        )

    if decision_label in ("BULLISH_BUT_EARNINGS_RISK", "EARNINGS_EVENT_WINDOW"):
        days_str = (
            f"in {earnings_within_days} day{'s' if (earnings_within_days or 0) != 1 else ''}"
            if earnings_within_days is not None else "very soon"
        )
        direction = "bullish" if is_bullish else "bearish"
        return (
            f"{ticker} has {direction} trend, but earnings are {days_str}. "
            "Do not open a new directional swing into the event; reassess after the print "
            "for a base and fresh confirmation. A calendar is a separate event-volatility review, not a directional entry."
        )

    if decision_label == "WEAK_SETUP":
        return (
            f"{ticker} signals are weak or mixed (quality score {trade_quality_score}/10). "
            "No tradable swing edge at current levels. Wait for a clearer setup."
        )

    if decision_label == "NO_TRADE_WAIT":
        if "LOW_OPTION_LIQUIDITY" in risk_flags:
            return f"{ticker} has poor option liquidity. Trade the stock directly or skip this ticker."
        if "VIX_EXTREME" in risk_flags:
            return (
                f"VIX is critically elevated — broad market volatility is extreme. "
                "Avoid all new swing positions until VIX drops below 35."
            )
        return (
            f"{ticker} lacks a clean swing setup (quality score {trade_quality_score}/10). "
            "Signals are insufficient or conflicting — wait for scores to improve."
        )

    # Generic fallback
    action_str = final_action.replace("_", " ")
    direction  = "bullish" if is_bullish else "bearish"
    return (
        f"{ticker} swing bias is {bias_str} with quality score {trade_quality_score}/10. "
        f"Recommended action: {action_str}."
    )


# ── Core decision builder ─────────────────────────────────────────────

def build_swing_trade_decision(
    ticker:         str,
    bull_score:     float,
    bear_score:     float,
    market_context: str,
    *,
    rsi_val:        float           = 50.0,
    dist_ma20_pct:  float           = 0.0,
    dist_ma50_pct:  float           = 0.0,
    mom_5d_pct:     float           = 0.0,
    vix_level:      Optional[float] = None,
    vol_ratio:      float           = 1.0,
    vol_label:      str             = "mixed",
    # Phase 2 — optional, skipped when None
    earnings_within_days:    Optional[int]   = None,
    iv_rank:                 Optional[float] = None,
    option_liquidity_score:  Optional[float] = None,
    near_resistance:         Optional[bool]  = None,
    gap_percent:             Optional[float] = None,
) -> dict[str, Any]:
    """
    Returns the full decision quality dict from daily-candle indicators.
    All Phase 2 fields default to None and are silently skipped when absent.
    """
    t = ticker.upper().strip()
    risk_flags:          list[str] = []
    confirmation_needed: list[str] = []
    avoid_reason: Optional[str]    = None

    # ── 1. Swing bias ──────────────────────────────────────────────────
    swing_bias   = _compute_swing_bias(bull_score, bear_score)
    is_bullish   = bull_score > bear_score

    # ── 2. Market ETF special case ─────────────────────────────────────
    if t in _MARKET_ETFS:
        base = bull_score if is_bullish else bear_score
        tqs  = round(min(10.0, max(0.0, base)), 1)
        rl   = _base_risk_level(vix_level, is_bullish, rsi_val, dist_ma20_pct, mom_5d_pct)
        if swing_bias in ("STRONG_BULLISH", "BULLISH"):
            fa    = "WATCH_CALL"
            strat = "CALL_DEBIT_SPREAD"
        elif swing_bias in ("STRONG_BEARISH", "BEARISH"):
            fa    = "WATCH_PUT"
            strat = "PUT_DEBIT_SPREAD"
        else:
            fa    = "NO_TRADE"
            strat = "NO_TRADE"

        msg = _build_decision_message(
            ticker=t, swing_bias=swing_bias,
            decision_label="MARKET_CONFIRMATION_ONLY",
            final_action=fa, entry_quality="MARKET_CONFIRMATION_ONLY",
            risk_level=rl, trade_quality_score=tqs,
            market_context=market_context,
            mom_5d_pct=mom_5d_pct, dist_ma20_pct=dist_ma20_pct, rsi_val=rsi_val,
            suggested_strategy=strat,
            suggested_expiry_window="4-6 weeks" if fa != "NO_TRADE" else "No trade",
            earnings_within_days=earnings_within_days,
            risk_flags=risk_flags, is_bullish=is_bullish,
        )
        guidance = _build_swing_execution_guidance(
            ticker=t, entry_quality="MARKET_CONFIRMATION_ONLY",
            final_action=fa, decision_label="MARKET_CONFIRMATION_ONLY",
            risk_level=rl, trade_quality_score=tqs,
            market_context=market_context, swing_bias=swing_bias,
            is_bullish=is_bullish, is_extended=False, is_very_extended=False,
            near_resistance=None, rsi_val=rsi_val,
            dist_ma20_pct=dist_ma20_pct, mom_5d_pct=mom_5d_pct,
            vix_level=vix_level, risk_flags=[], confirmation_needed=[], avoid_reason=None,
            suggested_strategy=strat, expected_holding_period="",
            recommended_contract_duration="",
        )
        return {
            "swing_bias": swing_bias,
            "entry_quality": "MARKET_CONFIRMATION_ONLY",
            "risk_level": rl,
            "final_action": fa,
            "trade_quality_score": tqs,
            "decision_label": "MARKET_CONFIRMATION_ONLY",
            "decision_message": msg,
            "risk_flags": [],
            "confirmation_needed": ["Confirm clean entry with volume before trading ETF directly."],
            "suggested_expiry_window": "4-6 weeks" if fa != "NO_TRADE" else "No trade",
            "suggested_strategy": strat,
            "avoid_reason": None,
            "entry_recommendation_state":   guidance["entry_recommendation_state"],
            "market_phase":                 guidance["market_phase"],
            "pullback_probability":         guidance["pullback_probability"],
            "pullback_probability_reason":  guidance["pullback_probability_reason"],
            "entry_quality_label":          guidance["entry_quality_label"],
            "trend_quality":                guidance["trend_quality"],
            "rr_quality":                   guidance["rr_quality"],
            "execution_personality":        guidance["execution_personality"],
            "should_enter_now":             guidance["should_enter_now"],
            "entry_decision":               guidance["entry_decision"],
            "contextual_alerts":            guidance["contextual_alerts"],
        }

    # ── 3. Collect risk flags (Phase 2 fields silently skipped if None) ─
    if earnings_within_days is not None:
        if earnings_within_days <= 2:
            risk_flags.append("EARNINGS_IMMINENT")
        elif earnings_within_days <= EARNINGS_DIRECTIONAL_BLACKOUT_DAYS:
            risk_flags.append("EARNINGS_SOON")

    if iv_rank is not None:
        if iv_rank >= 85:
            risk_flags.append("IV_VERY_HIGH")
        elif iv_rank >= 70:
            risk_flags.append("IV_HIGH")

    if option_liquidity_score is not None and option_liquidity_score < 4:
        risk_flags.append("LOW_OPTION_LIQUIDITY")

    if vix_level is not None and vix_level >= VIX_NO_GO:
        risk_flags.append("VIX_EXTREME")   # hard gate: matches scoring engine NO-GO
        risk_flags.append("VIX_ELEVATED")  # also flag caution
    elif vix_level is not None and vix_level >= 28:
        risk_flags.append("VIX_ELEVATED")

    # ── 4. Extension checks ────────────────────────────────────────────
    if is_bullish:
        is_very_extended = mom_5d_pct > EXT_5D_HARD
        is_extended = (
            not is_very_extended
            and (mom_5d_pct > EXT_5D_WARN or dist_ma20_pct > EXT_MA20_WARN or rsi_val > RSI_OB_WARN)
        )
    else:
        is_very_extended = mom_5d_pct < -EXT_5D_HARD
        is_extended = (
            not is_very_extended
            and (mom_5d_pct < -EXT_5D_WARN or dist_ma20_pct < -EXT_MA20_WARN or rsi_val < RSI_OS_WARN)
        )

    # ── 5. Baseline risk level then upgrade from flags ─────────────────
    risk_level = _base_risk_level(vix_level, is_bullish, rsi_val, dist_ma20_pct, mom_5d_pct)
    if "EARNINGS_IMMINENT" in risk_flags or "IV_VERY_HIGH" in risk_flags or "LOW_OPTION_LIQUIDITY" in risk_flags or "VIX_EXTREME" in risk_flags:
        risk_level = "VERY_HIGH"
    elif risk_level not in ("VERY_HIGH",) and (
        "EARNINGS_SOON" in risk_flags
        or "IV_HIGH" in risk_flags
        or is_very_extended
        or "VIX_ELEVATED" in risk_flags
    ):
        risk_level = "HIGH"

    # ── 6. Trade quality score ─────────────────────────────────────────
    base_score = bull_score if is_bullish else bear_score
    score      = base_score

    # Market context penalties / bonuses
    if is_bullish:
        if market_context == "MARKET_WEAK":       score -= 1.5
        if market_context == "MARKET_MIXED":      score -= 0.5
        if market_context == "MARKET_SUPPORTIVE": score += 1.0
    else:
        if market_context == "MARKET_SUPPORTIVE": score -= 1.5  # counter-trend
        if market_context == "MARKET_WEAK":       score += 1.0  # market supports bears
        if market_context == "MARKET_MIXED":      score -= 0.25

    # Extension penalties
    if is_very_extended:
        score -= 4.0
    elif is_extended:
        score -= 2.0

    # Phase 2 penalties (skipped when field is None)
    if "EARNINGS_IMMINENT" in risk_flags:
        score -= 4.0
    elif "EARNINGS_SOON" in risk_flags:
        score -= 2.0
    if iv_rank is not None:
        if iv_rank >= 85:   score -= 2.5
        elif iv_rank >= 70: score -= 1.5
    if "LOW_OPTION_LIQUIDITY" in risk_flags:
        score -= 4.0
    if near_resistance is True:
        score -= 1.5

    # Volume bonus
    bull_vol = is_bullish  and "bull" in vol_label
    bear_vol = not is_bullish and "bear" in vol_label
    if vol_ratio > 1.5 and (bull_vol or bear_vol):
        score += 1.0

    trade_quality_score = round(min(10.0, max(0.0, score)), 1)

    # ── 6b. DTE penalty — applied BEFORE the decision cascade so thresholds see the penalized score.
    # >15 DTE for a 5-day hold is too long; penalize proportionally.
    _pre_quality_est = "GOOD_ENTRY" if trade_quality_score >= 6.5 and risk_level in ("LOW", "MEDIUM") else "OTHER"
    _pre_dur = ""
    if risk_level in ("HIGH", "VERY_HIGH") or "EARNINGS_SOON" in risk_flags:
        _pre_dur = "14-21"
    elif trade_quality_score >= 7.0 and _pre_quality_est == "GOOD_ENTRY":
        _pre_dur = "7-14"
    else:
        _pre_dur = "10-21"
    _pre_parts = _pre_dur.replace("–", "-").split("-")
    _pre_nums = [int(p.strip()) for p in _pre_parts if p.strip().isdigit()]
    _pre_avg_dte = (sum(_pre_nums) // len(_pre_nums)) if _pre_nums else 0
    if _pre_avg_dte > 15:
        _penalty = round((_pre_avg_dte - 15) * 0.05, 2)
        trade_quality_score = max(0.0, trade_quality_score - _penalty)
        risk_flags.append(f"DTE_TOO_LONG({_pre_avg_dte}d)")

    # ── 7. Entry quality + decision label + final action ──────────────
    # Hard overrides evaluated in priority order
    if "LOW_OPTION_LIQUIDITY" in risk_flags:
        entry_quality  = "BAD_ENTRY"
        decision_label = "NO_TRADE_WAIT"
        final_action   = "NO_TRADE"
        avoid_reason   = "Option liquidity is poor. Cannot trade options on this ticker."

    elif "EARNINGS_IMMINENT" in risk_flags:
        entry_quality  = "BAD_ENTRY"
        decision_label = "BULLISH_BUT_EARNINGS_RISK"
        final_action   = "AVOID_NAKED_CALLS"
        avoid_reason   = (
            f"Earnings within {earnings_within_days} day(s) — "
            "IV crush risk is high after the report."
        )

    elif "EARNINGS_SOON" in risk_flags:
        entry_quality = "WAIT_EARNINGS"
        decision_label = "EARNINGS_EVENT_WINDOW"
        final_action = "WAIT_EARNINGS"
        avoid_reason = (
            f"Earnings are within {earnings_within_days} day(s), inside the "
            f"{EARNINGS_DIRECTIONAL_BLACKOUT_DAYS}-day directional swing blackout window."
        )

    elif "VIX_EXTREME" in risk_flags:
        # Hard gate: matches the scoring engine's NO-GO verdict for VIX >= 35.
        entry_quality  = "BAD_ENTRY"
        decision_label = "NO_TRADE_WAIT"
        final_action   = "NO_TRADE"
        vix_str        = f"{vix_level:.0f}" if vix_level is not None else "extreme"
        avoid_reason   = (
            f"VIX {vix_str} is critically elevated (≥{VIX_NO_GO:.0f}) — "
            "avoid new swing positions."
        )

    elif is_very_extended:
        entry_quality  = "LATE_ENTRY"
        decision_label = "BULLISH_BUT_EXTENDED"
        final_action   = "AVOID_CHASE"
        direction_str  = "upside" if is_bullish else "downside"
        avoid_reason   = (
            f"Move already happened: {mom_5d_pct:+.1f}% in 5 days ({direction_str}). "
            "Avoid chasing entries at current levels."
        )

    elif near_resistance is True:
        entry_quality  = "WAIT_BREAKOUT_CONFIRMATION"
        decision_label = "BULLISH_WAIT_CONFIRMATION"
        final_action   = "WAIT_BREAKOUT" if is_bullish else "WAIT_FOR_BREAKDOWN"
        confirmation_needed.append("Break above resistance with volume")
        confirmation_needed.append("Hold above breakout level for at least 1 session")

    elif is_extended:
        entry_quality  = "WAIT_PULLBACK"
        decision_label = "BULLISH_BUT_EXTENDED"
        final_action   = "WAIT_PULLBACK"
        if is_bullish and rsi_val > RSI_OB_WARN:
            confirmation_needed.append(f"RSI pullback below 70 (currently {rsi_val:.0f})")
        if is_bullish and mom_5d_pct > EXT_5D_WARN:
            confirmation_needed.append(f"5-day move of {mom_5d_pct:+.1f}% needs to consolidate")
        if is_bullish and dist_ma20_pct > EXT_MA20_WARN:
            confirmation_needed.append(
                f"Price is {dist_ma20_pct:.1f}% above MA20 — wait for pullback toward MA"
            )
        if not is_bullish and rsi_val < RSI_OS_WARN:
            confirmation_needed.append(f"RSI bounce above 30 (currently {rsi_val:.0f}) before shorting")
        if not is_bullish:
            confirmation_needed.append("Wait for a failed bounce into resistance or a fresh breakdown with volume")

    elif trade_quality_score >= 8.0 and risk_level in ("LOW", "MEDIUM"):
        entry_quality  = "GOOD_ENTRY"
        decision_label = "QUALITY_LONG"
        final_action   = "STRONG_GO"

    elif trade_quality_score >= 5.5:
        # Good, tradeable setup. Reserve STRONG_GO for A+ alignment, but do
        # not leave clean 5.5-7.9 quality setups stuck in WATCH forever.
        # CAUTION_ENTRY when risk is already flagged HIGH (IV, VIX, extension flags),
        # GOOD_ENTRY only when risk is LOW or MEDIUM.
        entry_quality  = "GOOD_ENTRY" if risk_level in ("LOW", "MEDIUM") else "CAUTION_ENTRY"
        decision_label = "QUALITY_LONG"
        final_action   = "GO" if risk_level in ("LOW", "MEDIUM") else "GO_SMALL"

    elif trade_quality_score >= 5.0:
        entry_quality  = "NO_CLEAN_ENTRY"
        decision_label = "BULLISH_WAIT_CONFIRMATION"
        final_action   = "WAIT_PULLBACK" if is_bullish else "WAIT_FOR_BREAKDOWN"
        confirmation_needed.append("Clearer entry trigger needed (pullback hold, base, or breakout)")

    elif swing_bias == "NEUTRAL":
        entry_quality  = "NO_CLEAN_ENTRY"
        decision_label = "WEAK_SETUP"
        final_action   = "NO_TRADE"

    else:
        entry_quality  = "BAD_ENTRY"
        decision_label = "NO_TRADE_WAIT"
        final_action   = "NO_TRADE"

    # ── 8. Market-context confirmation additions ───────────────────────
    if market_context == "MARKET_MIXED":
        confirmation_needed.append("SPY/QQQ confirm same direction before entry")
    elif market_context == "MARKET_WEAK" and is_bullish:
        confirmation_needed.append("Wait for broad market recovery before taking long calls")

    # ── 9. Suggested strategy ──────────────────────────────────────────
    # Strategy selection matrix (priority order matters):
    #
    #  IV rank   | Setup quality      | Direction | Strategy
    #  ──────────┼────────────────────┼───────────┼──────────────────────
    #  any       | AVOID_NAKED_CALLS  | bull/bear | credit spread (earnings)
    #  < 60      | STRONG_GO (≥7.0)   | bull      | LONG_CALL
    #  < 60      | STRONG_GO (≥7.0)   | bear      | LONG_PUT
    #  60–74     | STRONG_GO (≥7.0)   | bull/bear | debit spread
    #  ≥ 75      | STRONG_GO (≥7.0)   | bull      | PUT_CREDIT_SPREAD
    #  ≥ 75      | STRONG_GO (≥7.0)   | bear      | CALL_CREDIT_SPREAD
    #  ≥ 70      | any other          | bull      | PUT_CREDIT_SPREAD
    #  ≥ 70      | any other          | bear      | CALL_CREDIT_SPREAD
    #  50–69     | any non-STRONG_GO  | bull/bear | debit spread
    #  < 50      | score ≥ 5.5        | bull/bear | debit spread
    #
    # Rationale: credit spreads (sell premium) are preferred when IV is very
    # high because you capture IV crush + theta decay rather than fighting them.
    # Bull Put Spread (PUT_CREDIT_SPREAD) = bullish; Bear Call (CALL_CREDIT_SPREAD) = bearish.

    _iv_very_high = iv_rank is not None and iv_rank >= 70   # sell-premium territory
    _iv_high      = iv_rank is not None and iv_rank >= 60   # spread territory
    _iv_moderate  = iv_rank is not None and iv_rank >= 50   # still use spreads over longs

    if final_action == "WAIT_EARNINGS":
        # A calendar can be assessed separately for event-volatility structure,
        # but the scan must not manufacture a directional trade through earnings.
        suggested_strategy = "CALENDAR_REVIEW" if _iv_moderate else "NO_TRADE"
    elif final_action == "AVOID_NAKED_CALLS":
        # Earnings imminent — credit spreads preferred (sell expensive pre-earnings IV);
        # fall back to debit spreads if IV is not elevated
        if _iv_very_high:
            suggested_strategy = "PUT_CREDIT_SPREAD" if is_bullish else "CALL_CREDIT_SPREAD"
        else:
            suggested_strategy = "CALL_DEBIT_SPREAD" if is_bullish else "PUT_DEBIT_SPREAD"
    elif final_action == "NO_TRADE":
        suggested_strategy = "NO_TRADE"
    elif trade_quality_score >= 7.0 and final_action == "STRONG_GO":
        # Best setup quality — choose long vs spread vs credit based on IV level
        if iv_rank is not None and iv_rank >= 75:
            # Very high IV even on best setup → sell premium via credit spread
            suggested_strategy = "PUT_CREDIT_SPREAD" if is_bullish else "CALL_CREDIT_SPREAD"
        elif _iv_high:
            # Moderately elevated IV — debit spread caps cost
            suggested_strategy = "CALL_DEBIT_SPREAD" if is_bullish else "PUT_DEBIT_SPREAD"
        else:
            # IV reasonable for best setup → long directional
            suggested_strategy = "LONG_CALL" if is_bullish else "LONG_PUT"
    elif _iv_very_high:
        # High IV on non-STRONG_GO → always credit spread (sell the expensive premium)
        suggested_strategy = "PUT_CREDIT_SPREAD" if is_bullish else "CALL_CREDIT_SPREAD"
    elif _iv_moderate:
        # Elevated IV on moderate setup → debit spread
        suggested_strategy = "CALL_DEBIT_SPREAD" if is_bullish else "PUT_DEBIT_SPREAD"
    elif trade_quality_score >= 5.5:
        suggested_strategy = "CALL_DEBIT_SPREAD" if is_bullish else "PUT_DEBIT_SPREAD"
    elif final_action in ("WAIT_PULLBACK", "WAIT_FOR_BREAKDOWN", "WAIT_BREAKOUT", "WATCH_CALL_OR_DEBIT_SPREAD", "WATCH_PUT", "GO", "GO_SMALL"):
        suggested_strategy = "CALL_DEBIT_SPREAD" if is_bullish else "PUT_DEBIT_SPREAD"
    else:
        suggested_strategy = "NO_TRADE"

    # ── 10. Suggested expiry window ────────────────────────────────────
    if final_action == "WAIT_EARNINGS":
        suggested_expiry_window = "Post-earnings reassessment"
    elif suggested_strategy == "NO_TRADE" and final_action not in ("AVOID_NAKED_CALLS",):
        suggested_expiry_window = "No trade"
    elif risk_level in ("HIGH", "VERY_HIGH") or "EARNINGS_SOON" in risk_flags:
        suggested_expiry_window = "6-8 weeks"
    elif trade_quality_score >= 7.0 and entry_quality == "GOOD_ENTRY":
        suggested_expiry_window = "1-2 weeks"
    else:
        suggested_expiry_window = "2-3 weeks"

    # ── 11. Separate holding period from contract duration ──────────────
    # Holding period always stays ~3-5 trading days for swing (overnight holds).
    # Contract duration varies by risk/quality — never use the holding period
    # as the expiration length.
    expected_holding_period = "3-5 trading days"
    if final_action == "WAIT_EARNINGS":
        recommended_contract_duration = ""
    elif suggested_strategy == "NO_TRADE" and final_action not in ("AVOID_NAKED_CALLS",):
        recommended_contract_duration = ""
    elif risk_level in ("HIGH", "VERY_HIGH") or "EARNINGS_SOON" in risk_flags:
        recommended_contract_duration = "14-21"
    elif trade_quality_score >= 7.0 and entry_quality == "GOOD_ENTRY":
        recommended_contract_duration = "7-14"
    else:
        recommended_contract_duration = "10-21"

    # ── 11b. DTE penalty already applied pre-cascade (see §6b) ─────────

    # ── 12. Decision message ───────────────────────────────────────────
    decision_message = _build_decision_message(
        ticker=t,
        swing_bias=swing_bias,
        decision_label=decision_label,
        final_action=final_action,
        entry_quality=entry_quality,
        risk_level=risk_level,
        trade_quality_score=trade_quality_score,
        market_context=market_context,
        mom_5d_pct=mom_5d_pct,
        dist_ma20_pct=dist_ma20_pct,
        rsi_val=rsi_val,
        suggested_strategy=suggested_strategy,
        suggested_expiry_window=suggested_expiry_window,
        earnings_within_days=earnings_within_days,
        risk_flags=risk_flags,
        is_bullish=is_bullish,
        expected_holding_period=expected_holding_period,
        recommended_contract_duration=recommended_contract_duration,
    )

    execution_guidance = _build_swing_execution_guidance(
        ticker=t,
        entry_quality=entry_quality,
        final_action=final_action,
        decision_label=decision_label,
        risk_level=risk_level,
        trade_quality_score=trade_quality_score,
        market_context=market_context,
        swing_bias=swing_bias,
        is_bullish=is_bullish,
        is_extended=is_extended,
        is_very_extended=is_very_extended,
        near_resistance=near_resistance,
        rsi_val=rsi_val,
        dist_ma20_pct=dist_ma20_pct,
        mom_5d_pct=mom_5d_pct,
        vix_level=vix_level,
        risk_flags=risk_flags,
        confirmation_needed=confirmation_needed,
        avoid_reason=avoid_reason,
        suggested_strategy=suggested_strategy,
        expected_holding_period=expected_holding_period,
        recommended_contract_duration=recommended_contract_duration,
    )

    return {
        "swing_bias":                   swing_bias,
        "entry_quality":                entry_quality,
        "risk_level":                   risk_level,
        "final_action":                 final_action,
        "trade_quality_score":          trade_quality_score,
        "decision_label":               decision_label,
        "decision_message":             decision_message,
        "risk_flags":                   risk_flags,
        "confirmation_needed":          confirmation_needed,
        "suggested_expiry_window":      suggested_expiry_window,
        "suggested_strategy":           suggested_strategy,
        "avoid_reason":                 avoid_reason,
        "expected_holding_period":      expected_holding_period,
        "recommended_contract_duration": recommended_contract_duration,
        # Execution guidance
        "entry_recommendation_state":   execution_guidance["entry_recommendation_state"],
        "market_phase":                 execution_guidance["market_phase"],
        "pullback_probability":         execution_guidance["pullback_probability"],
        "pullback_probability_reason":  execution_guidance["pullback_probability_reason"],
        "entry_quality_label":          execution_guidance["entry_quality_label"],
        "trend_quality":                execution_guidance["trend_quality"],
        "rr_quality":                   execution_guidance["rr_quality"],
        "execution_personality":        execution_guidance["execution_personality"],
        "should_enter_now":             execution_guidance["should_enter_now"],
        "entry_decision":               execution_guidance["entry_decision"],
        "contextual_alerts":            execution_guidance["contextual_alerts"],
    }


# ── Execution guidance helpers ──────────────────────────────────────

EXT_LOW = 3.0
EXT_WARN = 8.0
EXT_HARD_PULL = 12.0

RSI_LOW = 45
RSI_MODERATE = 55
RSI_HIGH = 65

def _compute_entry_rec_state(
    *,
    entry_quality: str,
    final_action: str,
    is_bullish: bool,
    is_extended: bool,
    is_very_extended: bool,
    near_resistance: Optional[bool],
    rsi_val: float,
    dist_ma20_pct: float,
    mom_5d_pct: float,
    trade_quality_score: float,
    risk_level: str,
) -> str:
    if entry_quality in ("BAD_ENTRY", "NO_CLEAN_ENTRY") or final_action == "NO_TRADE":
        return "TREND_CONFIRMATION_PENDING"

    if final_action == "AVOID_CHASE" or is_very_extended:
        return "EXTENDED_CHASE_RISK"

    if entry_quality == "LATE_ENTRY":
        return "LATE_STAGE_CONTINUATION"

    if entry_quality == "WAIT_BREAKOUT_CONFIRMATION" or near_resistance is True:
        return "HIGH_RISK_BREAKOUT"

    if entry_quality == "WAIT_PULLBACK" or is_extended:
        return "PULLBACK_PREFERRED"

    if final_action == "AVOID_NAKED_CALLS":
        return "WAIT_FOR_CONSOLIDATION"

    if entry_quality == "GOOD_ENTRY" and trade_quality_score >= 8.0 and risk_level in ("LOW", "MEDIUM"):
        abs_mom = abs(mom_5d_pct)
        abs_dist = abs(dist_ma20_pct)
        if abs_dist < EXT_LOW and abs_mom < 3 and rsi_val < 60:
            return "IDEAL_PULLBACK_ENTRY"
        if abs_dist < EXT_LOW and abs_mom > 3:
            return "BREAKOUT_CONTINUATION"
        if abs_dist < EXT_WARN and abs_mom > 5:
            return "AGGRESSIVE_CONTINUATION"
        return "BREAKOUT_CONTINUATION"

    if entry_quality in ("GOOD_ENTRY", "CAUTION_ENTRY"):
        return "BREAKOUT_CONTINUATION"

    return "TREND_CONFIRMATION_PENDING"


def _compute_market_phase(
    *,
    entry_quality: str,
    final_action: str,
    is_bullish: bool,
    is_extended: bool,
    is_very_extended: bool,
    rsi_val: float,
    dist_ma20_pct: float,
    mom_5d_pct: float,
    trade_quality_score: float,
    market_context: str,
) -> str:
    if final_action == "NO_TRADE":
        if market_context in ("MARKET_WEAK", "MARKET_MIXED"):
            return "CONSOLIDATION"
        return "FAILED_BREAKOUT"

    if is_very_extended or mom_5d_pct > EXT_HARD_PULL:
        return "EXHAUSTION_RISK"

    if is_extended or entry_quality == "LATE_ENTRY":
        return "LATE_STAGE_CONTINUATION"

    if entry_quality == "WAIT_BREAKOUT_CONFIRMATION":
        return "CONSOLIDATION"

    if entry_quality == "GOOD_ENTRY" and trade_quality_score >= 8.0:
        abs_dist = abs(dist_ma20_pct)
        abs_mom = abs(mom_5d_pct)
        if abs_dist < 2 and abs_mom < 2:
            return "EARLY_BREAKOUT"
        if abs_dist < 4 and abs_mom < 5 and rsi_val < 65:
            return "CONFIRMED_BREAKOUT"
        if abs_mom > 5:
            return "MOMENTUM_EXPANSION"
        return "HEALTHY_CONTINUATION"

    if entry_quality in ("GOOD_ENTRY", "CAUTION_ENTRY"):
        abs_mom = abs(mom_5d_pct)
        if abs_mom > 5:
            return "MOMENTUM_EXPANSION"
        if abs_mom > 2:
            return "HEALTHY_CONTINUATION"
        return "CONFIRMED_BREAKOUT"

    return "CONSOLIDATION"


def _compute_pullback_probability(
    *,
    rsi_val: float,
    dist_ma20_pct: float,
    mom_5d_pct: float,
    is_extended: bool,
    is_very_extended: bool,
    entry_quality: str,
) -> tuple[str, str]:
    reasons: list[str] = []
    score = 0

    if is_very_extended:
        score += 9
        reasons.append("price extremely extended")
    elif is_extended:
        score += 7
        reasons.append("price extended above MA20")

    if rsi_val > 70:
        score += 8
        reasons.append("RSI overbought")
    elif rsi_val > 60:
        score += 4
        reasons.append("RSI elevated")

    abs_mom = abs(mom_5d_pct)
    if abs_mom > 10:
        score += 8
        reasons.append("strong 5d momentum suggests profit-taking")
    elif abs_mom > 5:
        score += 5
        reasons.append("moderate 5d momentum")

    if entry_quality == "LATE_ENTRY":
        score += 6
        reasons.append("late-stage move")
    elif entry_quality == "GOOD_ENTRY":
        score -= 3

    if reasons and score >= 7:
        return "HIGH", "; ".join(reasons[:2])
    if score >= 4:
        return "MODERATE", "; ".join(reasons[:2]) if reasons else "moderate extension"
    return "LOW", "no significant extension signals"


def _compute_rr_quality(
    *,
    risk_level: str,
    is_extended: bool,
    is_very_extended: bool,
    dist_ma20_pct: float,
    rsi_val: float,
    entry_quality: str,
) -> str:
    if is_very_extended or risk_level in ("HIGH", "VERY_HIGH"):
        return "WEAK"
    if is_extended or risk_level == "MEDIUM" or entry_quality == "CAUTION_ENTRY":
        return "MODERATE"
    if abs(dist_ma20_pct) < 3 and 40 <= rsi_val <= 65:
        return "STRONG"
    return "MODERATE"


def _compute_execution_personality(*, entry_rec_state: str, is_bullish: bool) -> dict[str, list[str]]:
    suitable: list[str] = []
    not_ideal: list[str] = []

    if entry_rec_state == "IDEAL_PULLBACK_ENTRY":
        suitable = ["pullback swing traders", "conservative breakout entries"]
        not_ideal = ["aggressive momentum chasers"]
    elif entry_rec_state == "BREAKOUT_CONTINUATION":
        suitable = ["momentum continuation traders", "breakout swing traders"]
        not_ideal = ["late-session momentum chasers"]
    elif entry_rec_state == "AGGRESSIVE_CONTINUATION":
        suitable = ["aggressive continuation traders"]
        not_ideal = ["conservative pullback traders", "risk-averse position traders"]
    elif entry_rec_state == "LATE_STAGE_CONTINUATION":
        suitable = ["active position managers"]
        not_ideal = ["new entry seekers", "conservative breakout entries"]
    elif entry_rec_state == "PULLBACK_PREFERRED":
        suitable = ["pullback swing traders", "mean-reversion scalpers"]
        not_ideal = ["aggressive continuation traders", "momentum chasers"]
    elif entry_rec_state == "EXTENDED_CHASE_RISK":
        suitable: list[str] = []
        not_ideal = ["all new entry seekers", "momentum chasers", "conservative traders"]
    elif entry_rec_state == "HIGH_RISK_BREAKOUT":
        suitable = ["aggressive breakout traders willing to accept false-break risk"]
        not_ideal = ["conservative entries", "pullback traders"]
    elif entry_rec_state == "WAIT_FOR_CONSOLIDATION":
        suitable = ["patient position traders"]
        not_ideal = ["aggressive entries", "momentum chasers"]
    else:
        suitable = ["patient breakout traders"]
        not_ideal = ["aggressive momentum entries"]

    return {"suitable_for": suitable, "not_ideal_for": not_ideal}


def _build_swing_execution_guidance(
    *,
    ticker: str,
    entry_quality: str,
    final_action: str,
    decision_label: str,
    risk_level: str,
    trade_quality_score: float,
    market_context: str,
    swing_bias: str,
    is_bullish: bool,
    is_extended: bool,
    is_very_extended: bool,
    near_resistance: Optional[bool],
    rsi_val: float,
    dist_ma20_pct: float,
    mom_5d_pct: float,
    vix_level: Optional[float],
    risk_flags: list[str],
    confirmation_needed: list[str],
    avoid_reason: Optional[str],
    suggested_strategy: str,
    expected_holding_period: str,
    recommended_contract_duration: str,
) -> dict[str, Any]:
    entry_rec_state = _compute_entry_rec_state(
        entry_quality=entry_quality,
        final_action=final_action,
        is_bullish=is_bullish,
        is_extended=is_extended,
        is_very_extended=is_very_extended,
        near_resistance=near_resistance,
        rsi_val=rsi_val,
        dist_ma20_pct=dist_ma20_pct,
        mom_5d_pct=mom_5d_pct,
        trade_quality_score=trade_quality_score,
        risk_level=risk_level,
    )

    market_phase = _compute_market_phase(
        entry_quality=entry_quality,
        final_action=final_action,
        is_bullish=is_bullish,
        is_extended=is_extended,
        is_very_extended=is_very_extended,
        rsi_val=rsi_val,
        dist_ma20_pct=dist_ma20_pct,
        mom_5d_pct=mom_5d_pct,
        trade_quality_score=trade_quality_score,
        market_context=market_context,
    )

    pullback_prob, pullback_reason = _compute_pullback_probability(
        rsi_val=rsi_val,
        dist_ma20_pct=dist_ma20_pct,
        mom_5d_pct=mom_5d_pct,
        is_extended=is_extended,
        is_very_extended=is_very_extended,
        entry_quality=entry_quality,
    )

    rr_quality = _compute_rr_quality(
        risk_level=risk_level,
        is_extended=is_extended,
        is_very_extended=is_very_extended,
        dist_ma20_pct=dist_ma20_pct,
        rsi_val=rsi_val,
        entry_quality=entry_quality,
    )

    exec_personality = _compute_execution_personality(entry_rec_state=entry_rec_state, is_bullish=is_bullish)

    # should_enter_now
    if final_action == "NO_TRADE" or entry_quality in ("BAD_ENTRY", "LATE_ENTRY") or final_action == "AVOID_CHASE":
        should_now = "NO"
    elif entry_quality == "GOOD_ENTRY" and trade_quality_score >= 8.0:
        should_now = "YES"
    elif entry_quality in ("GOOD_ENTRY", "CAUTION_ENTRY"):
        should_now = "YES"
    elif entry_quality in ("WAIT_PULLBACK", "WAIT_BREAKOUT_CONFIRMATION", "NO_CLEAN_ENTRY"):
        should_now = "CONDITIONAL"
    else:
        should_now = "NO"

    # WATCH final_action means the resolver hasn't confirmed the setup yet — cap at
    # CONDITIONAL so should_enter_now never says YES while the state machine says WATCH.
    _WATCH_ACTIONS = {"WATCH", "WATCH_CALL", "WATCH_PUT", "WATCH_CALL_OR_DEBIT_SPREAD"}
    if final_action in _WATCH_ACTIONS and should_now == "YES":
        should_now = "CONDITIONAL"

    # Entry decision sections
    direction_word = "bullish" if is_bullish else "bearish"
    can_enter = should_now in ("YES", "CONDITIONAL")
    conservative = ""
    aggressive = ""
    best_setup = ""

    if can_enter and not is_extended and not is_very_extended:
        conservative = f"Wait for pullback toward MA20 or {direction_word} consolidation hold."
        aggressive = f"Breakout above recent range with volume confirmation."
        best_setup = f"Pullback hold near MA20 support with {direction_word} continuation."
    elif can_enter and is_extended and not is_very_extended:
        conservative = f"Wait for pullback or short consolidation before entry. RSI at {rsi_val:.0f} suggests mean-reversion risk."
        aggressive = f"Continuation above nearest resistance with expanding volume."
        best_setup = f"Short pullback toward MA20 zone."
    elif should_now == "YES" and not is_extended:
        conservative = f"Pullback entry toward MA20 with volume confirmation."
        aggressive = f"Momentum continuation on {direction_word} follow-through."
        best_setup = f"Entry on {direction_word} confirmation with defined stop below recent swing low."
    else:
        conservative = "No trade — wait for clearer setup."
        aggressive = "Not recommended at current levels."
        best_setup = "No clear entry — monitor for structure improvement."

    contextual_alerts: list[dict[str, str]] = []
    if is_extended or is_very_extended:
        contextual_alerts.append({
            "type": "PULLBACK_MONITOR",
            "message": f"{ticker} pullback toward MA20 support zone",
            "condition": f"RSI cools below {RSI_HIGH:.0f} and price nears MA20",
        })
    if entry_quality in ("GOOD_ENTRY", "CAUTION_ENTRY") and not is_extended:
        contextual_alerts.append({
            "type": "BREAKOUT_CONFIRMATION",
            "message": f"{ticker} breakout above resistance with volume expansion",
            "condition": "Price breaks above recent high with >1.5× avg volume",
        })
    if rsi_val > 70:
        contextual_alerts.append({
            "type": "RSI_OVERBOUGHT",
            "message": f"{ticker} RSI exceeds 70 — continuation overheating",
            "condition": "Wait for RSI pullback below 65 before fresh entry",
        })

    return {
        "entry_recommendation_state": entry_rec_state,
        "market_phase": market_phase,
        "pullback_probability": pullback_prob,
        "pullback_probability_reason": pullback_reason,
        "trend_quality": market_phase,
        "entry_quality_label": "STRONG" if entry_quality == "GOOD_ENTRY" else "MODERATE" if entry_quality in ("CAUTION_ENTRY",) else "WEAK",
        "rr_quality": rr_quality,
        "execution_personality": exec_personality,
        "should_enter_now": should_now,
        "entry_decision": {
            "conservative": conservative,
            "aggressive": aggressive,
            "best_setup": best_setup,
        },
        "contextual_alerts": contextual_alerts,
    }


# ── Confidence block (metadata for the UI — kept from v1) ────────────

def _confidence_block(
    *,
    ma_aligned:   bool,
    rsi_val:      float,
    macd_aligned: bool,
    vol_label:    str,
    bias:         Bias,
    vix_level:    Optional[float],
    verdict:      str,
) -> dict[str, str]:

    if ma_aligned and macd_aligned:
        trend_quality = "STRONG"
    elif ma_aligned or macd_aligned:
        trend_quality = "MODERATE"
    else:
        trend_quality = "WEAK"

    if bias == "long":
        if 50 <= rsi_val <= 70:    momentum_health = "HEALTHY"
        elif rsi_val > RSI_OVERBOUGHT: momentum_health = "EXTENDED"
        elif rsi_val < 45:         momentum_health = "WEAK"
        else:                      momentum_health = "NEUTRAL"
    elif bias == "short":
        if 30 <= rsi_val <= 50:    momentum_health = "HEALTHY"
        elif rsi_val < RSI_OVERSOLD: momentum_health = "EXTENDED"
        elif rsi_val > 55:         momentum_health = "WEAK"
        else:                      momentum_health = "NEUTRAL"
    else:
        momentum_health = "NEUTRAL"

    volume_participation = "STRONG" if "expanding" in vol_label else (
        "WEAK" if vol_label == "low" else "MIXED"
    )

    if vix_level is not None and vix_level >= 28:
        risk = "HIGH"
    elif verdict in ("AVOID", "NO_EDGE"):
        risk = "HIGH"
    elif vix_level is not None and vix_level >= VIX_CAUTION:
        risk = "MEDIUM"
    elif verdict in ("WATCH", "WAIT"):
        risk = "MEDIUM"
    else:
        risk = "LOW"

    return {
        "trend_quality":        trend_quality,
        "momentum_health":      momentum_health,
        "volume_participation": volume_participation,
        "risk":                 risk,
    }


# ── Options playbook (education only; server-derived) ─────────────────

def _implied_iv_pct_from_info(info: dict[str, Any]) -> Optional[float]:
    """Yahoo `impliedVolatility` when present — returned as percent (e.g. 28.0)."""
    raw = info.get("impliedVolatility")
    if raw is None:
        return None
    try:
        x = float(raw)
    except (TypeError, ValueError):
        return None
    if x <= 0 or not math.isfinite(x):
        return None
    # yfinance commonly quotes annual IV as a fraction (0.28 → 28%)
    if x < 1.0:
        x *= 100.0
    return round(float(x), 2)


def _implied_iv_pct_from_chain(
    ticker: str,
    last_price: float,
    asof: date,
    force_refresh: bool = False,
) -> tuple[Optional[float], Optional[str]]:
    """Fallback IV estimate from near-ATM options when Yahoo quote info omits IV."""
    if last_price <= 0:
        return None, None
    try:
        dates = bar_cache.get_option_dates(ticker, force_refresh=force_refresh)
    except Exception:
        return None, None
    candidates: list[tuple[int, str]] = []
    for exp in dates:
        try:
            exp_d = datetime.strptime(str(exp)[:10], "%Y-%m-%d").date()
        except Exception:
            continue
        dte = (exp_d - asof).days
        if 21 <= dte <= 60:
            candidates.append((dte, str(exp)[:10]))
    if not candidates:
        for exp in dates:
            try:
                exp_d = datetime.strptime(str(exp)[:10], "%Y-%m-%d").date()
            except Exception:
                continue
            dte = (exp_d - asof).days
            if 7 <= dte <= 90:
                candidates.append((dte, str(exp)[:10]))
    if not candidates:
        return None, None
    _, expiry = sorted(candidates, key=lambda item: (abs(item[0] - 35), item[0]))[0]
    try:
        calls, puts = bar_cache.get_option_chain(ticker, expiry, force_refresh=force_refresh)
    except Exception:
        return None, None
    samples: list[float] = []
    for df in (calls, puts):
        if df is None or df.empty or "impliedVolatility" not in df.columns or "strike" not in df.columns:
            continue
        try:
            tmp = df.copy()
            tmp["strike_dist"] = (tmp["strike"].astype(float) - float(last_price)).abs()
            tmp = tmp.sort_values("strike_dist").head(8)
            for raw in tmp["impliedVolatility"].tolist():
                try:
                    iv = float(raw)
                except (TypeError, ValueError):
                    continue
                if not math.isfinite(iv) or iv <= 0:
                    continue
                if iv < 1.0:
                    iv *= 100.0
                if 1.0 <= iv <= 300.0:
                    samples.append(iv)
        except Exception:
            continue
    if not samples:
        return None, expiry
    return round(float(pd.Series(samples).median()), 2), expiry


def _consecutive_directional_candles(raw: pd.DataFrame, bearish: bool) -> int:
    count = 0
    for _, row in raw.tail(8).iloc[::-1].iterrows():
        try:
            o = float(row["Open"])
            c = float(row["Close"])
        except Exception:
            break
        if (bearish and c < o) or ((not bearish) and c > o):
            count += 1
        else:
            break
    return count


def _trend_entry_timing_layer(
    *,
    raw: pd.DataFrame,
    last: float,
    ma20: float,
    ma50: float,
    rsi_val: float,
    macd_val: float,
    sig_val: float,
    hv_20: Optional[float],
    vol_label: str,
    vol_ratio: float,
    market_context: str,
    bias: Bias,
    bull_score: float,
    bear_score: float,
) -> dict[str, Any]:
    """Separate trend direction quality from today's entry timing quality."""
    if bias == "short":
        direction = "BEARISH"
        is_bearish = True
    elif bias == "long":
        direction = "BULLISH"
        is_bearish = False
    else:
        direction = "BEARISH" if bear_score > bull_score else "BULLISH" if bull_score > bear_score else "NEUTRAL"
        is_bearish = direction == "BEARISH"

    if direction == "NEUTRAL" or ma20 <= 0 or ma50 <= 0 or last <= 0:
        return {
            "direction": "NEUTRAL",
            "trend_score": 35,
            "entry_quality_score": 25,
            "bounce_risk": "Low",
            "extension_score": 0.0,
            "extension_label": "Normal",
            "trend_stage": "No Trade Zone",
            "preferred_entry_trigger": ["Wait for price to resolve above or below MA20/MA50."],
            "trade_timing_verdict": "No clear trend. Wait.",
            "why": ["Signals are mixed; trend direction is not reliable."],
        }

    trend = 0.0
    why: list[str] = []
    if is_bearish:
        if last < ma20:
            trend += 15; why.append(f"Price below MA20 (${ma20:.2f}).")
        if last < ma50:
            trend += 15; why.append(f"Price below MA50 (${ma50:.2f}).")
        if ma20 < ma50:
            trend += 15; why.append("MA20 below MA50.")
        if rsi_val < 50:
            trend += 10; why.append(f"RSI {rsi_val:.1f} is below 50.")
        if macd_val < sig_val:
            trend += 15; why.append("MACD bearish.")
        highs = raw["High"].tail(8)
        lows = raw["Low"].tail(8)
        if len(highs) >= 5 and highs.iloc[-1] < highs.iloc[-3] and lows.iloc[-1] < lows.iloc[-3]:
            trend += 15; why.append("Lower highs / lower lows are forming.")
        if market_context == "MARKET_WEAK":
            trend += 15; why.append("QQQ/SPY context aligns bearish.")
        elif market_context == "MARKET_MIXED":
            trend += 7
        extension = max(0.0, (ma20 - last) / ma20 * 100.0)
    else:
        if last > ma20:
            trend += 15; why.append(f"Price above MA20 (${ma20:.2f}).")
        if last > ma50:
            trend += 15; why.append(f"Price above MA50 (${ma50:.2f}).")
        if ma20 > ma50:
            trend += 15; why.append("MA20 above MA50.")
        if rsi_val > 50:
            trend += 10; why.append(f"RSI {rsi_val:.1f} is above 50.")
        if macd_val > sig_val:
            trend += 15; why.append("MACD bullish.")
        highs = raw["High"].tail(8)
        lows = raw["Low"].tail(8)
        if len(highs) >= 5 and highs.iloc[-1] > highs.iloc[-3] and lows.iloc[-1] > lows.iloc[-3]:
            trend += 15; why.append("Higher highs / higher lows are forming.")
        if market_context == "MARKET_SUPPORTIVE":
            trend += 15; why.append("QQQ/SPY context aligns bullish.")
        elif market_context == "MARKET_MIXED":
            trend += 7
        extension = max(0.0, (last - ma20) / ma20 * 100.0)

    trend_score = int(round(max(0.0, min(100.0, trend))))
    if extension <= 2:
        extension_label = "Normal"
    elif extension <= 4:
        extension_label = "Slightly Extended"
    elif extension <= 6:
        extension_label = "Extended"
    else:
        extension_label = "Very Extended"

    aligned_volume = ("bear" in vol_label and is_bearish) or ("bull" in vol_label and not is_bearish)

    entry = 72.0
    if extension > 6:
        entry -= 24
    elif extension > 4:
        entry -= 12
    elif extension > 2:
        entry -= 6

    candle_run = _consecutive_directional_candles(raw, bearish=is_bearish)
    if candle_run >= 4:
        entry -= 8
    elif candle_run >= 3:
        entry -= 5

    prior_raw = raw.iloc[:-1] if len(raw) > 1 else raw
    support_window = prior_raw["Low"].tail(30)
    resistance_window = prior_raw["High"].tail(30)
    prior_support = float(support_window.min()) if len(support_window) else last
    prior_resistance = float(resistance_window.max()) if len(resistance_window) else last
    near_support = is_bearish and prior_support > 0 and abs(last - prior_support) / prior_support * 100 <= 2.0
    near_resistance = (not is_bearish) and prior_resistance > 0 and abs(prior_resistance - last) / prior_resistance * 100 <= 2.0
    if near_support or near_resistance:
        entry -= 4 if aligned_volume else 10

    if is_bearish:
        if rsi_val < 35:
            entry -= 18
        elif rsi_val < 42:
            entry -= 4
    else:
        if rsi_val > 70:
            entry -= 18
        elif rsi_val > 63:
            entry -= 4

    if hv_20 is not None:
        if hv_20 >= 55:
            entry -= 12
        elif hv_20 >= 40:
            entry -= 7

    if aligned_volume and vol_ratio >= 1.2:
        entry += 10
    if (is_bearish and market_context == "MARKET_WEAK") or ((not is_bearish) and market_context == "MARKET_SUPPORTIVE"):
        entry += 8
    elif market_context == "MARKET_MIXED":
        entry -= 4
    elif (is_bearish and market_context == "MARKET_SUPPORTIVE") or ((not is_bearish) and market_context == "MARKET_WEAK"):
        entry -= 8

    entry_quality_score = int(round(max(0.0, min(100.0, entry))))

    risk_points = 0
    if extension > 6: risk_points += 3
    elif extension > 4: risk_points += 1
    elif extension > 2: risk_points += 1
    if is_bearish:
        if rsi_val < 35: risk_points += 3
        elif rsi_val < 42: risk_points += 1
    else:
        if rsi_val > 70: risk_points += 3
        elif rsi_val > 63: risk_points += 1
    if candle_run >= 3: risk_points += 1
    if near_support or near_resistance: risk_points += 1 if aligned_volume else 2
    if hv_20 is not None and hv_20 >= 40: risk_points += 1
    if risk_points >= 8:
        bounce_risk = "Extreme"
    elif risk_points >= 5:
        bounce_risk = "High"
    elif risk_points >= 3:
        bounce_risk = "Medium-High"
    elif risk_points >= 2:
        bounce_risk = "Medium"
    else:
        bounce_risk = "Low"

    if trend_score < 55:
        trend_stage = "No Trade Zone"
    elif extension > 6 and ((is_bearish and rsi_val <= 42) or ((not is_bearish) and rsi_val >= 63)) and candle_run >= 2:
        trend_stage = "Extended Decline" if is_bearish else "Extended Advance"
    elif (is_bearish and last < ma20 and last < ma50 and 40 <= rsi_val <= 50 and aligned_volume) or ((not is_bearish) and last > ma20 and last > ma50 and 50 <= rsi_val <= 60 and aligned_volume):
        trend_stage = "Early Breakdown" if is_bearish else "Early Breakout"
    elif bounce_risk in ("High", "Extreme") and (near_support or near_resistance):
        trend_stage = "Reversal Risk"
    elif extension <= 4 and trend_score >= 70:
        trend_stage = "Trend Continuation"
    else:
        trend_stage = "Pullback to Resistance" if is_bearish else "Pullback to Support"

    if is_bearish:
        triggers = [
            f"Failed bounce into MA20 / MA50 resistance (${ma20:.2f}-${ma50:.2f}).",
            "Fresh breakdown below today's low with volume.",
        ]
        structure = "PUT Debit Spread"
    else:
        triggers = [
            f"Pullback hold near MA20 / MA50 support (${ma20:.2f}-${ma50:.2f}).",
            "Fresh breakout above today's high with volume.",
        ]
        structure = "CALL Debit Spread"

    if trend_score >= 75 and entry_quality_score >= 65 and bounce_risk not in ("High", "Extreme"):
        timing = f"{direction.title()} trend — {structure} ready."
    elif trend_score >= 75 and entry_quality_score >= 50:
        timing = f"{direction.title()} trend — wait for better entry."
    elif trend_score >= 75:
        timing = "Direction is right, but timing is late."
    else:
        timing = "Trend is not clean enough. Wait."

    if extension > 6:
        why.append(f"Price is {extension:.1f}% from MA20 — {extension_label.lower()}.")
    if hv_20 is not None and hv_20 >= 40:
        why.append(f"HV20 is elevated at {hv_20:.1f}%.")

    return {
        "direction": direction,
        "trend_score": trend_score,
        "entry_quality_score": entry_quality_score,
        "bounce_risk": bounce_risk,
        "extension_score": round(extension, 2),
        "extension_label": extension_label,
        "trend_stage": trend_stage,
        "preferred_entry_trigger": triggers,
        "trade_timing_verdict": timing,
        "why": why[:8],
    }


def _next_earnings_calendar_days(ticker: str, asof: date, force_refresh: bool = False) -> Optional[int]:
    """
    Calendar days from `asof` (last daily bar date) to the next scheduled earnings date
    from Yahoo's calendar, when available. None if unknown or date is in the past.

    Uses bar_cache.get_calendar — no direct yf call.
    """
    try:
        cal = bar_cache.get_calendar(ticker, force_refresh=force_refresh)
        if not isinstance(cal, dict):
            return None
        ed = cal.get("Earnings Date") or cal.get("Earnings Timestamp")
        if ed is None:
            return None
        if isinstance(ed, (list, tuple)) and len(ed) > 0:
            d0 = ed[0]
        else:
            d0 = ed
        if isinstance(d0, datetime):
            d0 = d0.date()
        elif hasattr(d0, "date") and callable(d0.date) and not isinstance(d0, date):
            d0 = d0.date()
        elif isinstance(d0, pd.Timestamp):
            d0 = d0.date()
        elif isinstance(d0, str):
            d0 = pd.Timestamp(d0).date()
        if not isinstance(d0, date):
            return None
        delta = (d0 - asof).days
        if delta < 0:
            return None
        return int(delta)
    except Exception:
        return None


def _finalize_playbook_earnings(hint: str, earnings_days: Optional[int]) -> str:
    """Block new directional swings inside the configured earnings event window."""
    if earnings_days is None or not (0 <= earnings_days <= EARNINGS_DIRECTIONAL_BLACKOUT_DAYS):
        return hint
    if earnings_days > 2:
        return (
            "Earnings event window — no new directional swing. Reassess after the print; "
            "calendar review only if the event-volatility structure is suitable."
        )
    lower = hint.lower()
    if lower.startswith("long call"):
        return "Call debit spread — earnings soon; avoid naked long premium."
    if lower.startswith("long put"):
        return "Put debit spread — earnings soon; avoid naked long premium."
    if "earnings soon" in lower or "avoid naked" in lower:
        return hint
    return hint + " · Earnings soon — avoid naked single-leg options; prefer defined-risk."


def compute_playbook_hint(
    *,
    bias: Bias,
    verdict: Verdict,
    rsi_val: float,
    decision: dict[str, Any],
    iv_rank: Optional[float],
    implied_iv_pct: Optional[float],
    hv_20: Optional[float],
    earnings_days: Optional[int],
) -> str:
    """
    Maps swing state to short strategy hints (rules 1–8). Not investment advice.
    Uses the same IV / earnings fields passed into build_swing_trade_decision.
    """
    sb: str = decision["swing_bias"]
    eq: str = decision["entry_quality"]
    fa: str = decision["final_action"]
    dl: str = decision["decision_label"]

    is_bullish = sb in ("STRONG_BULLISH", "BULLISH")
    is_bearish = sb in ("STRONG_BEARISH", "BEARISH")

    if iv_rank is not None:
        high_iv = iv_rank >= 50.0
        low_iv = iv_rank < 50.0
        iv_unknown = False
    elif implied_iv_pct is not None and hv_20 is not None:
        high_iv = implied_iv_pct > hv_20
        low_iv = implied_iv_pct <= hv_20
        iv_unknown = False
    else:
        high_iv = low_iv = False
        iv_unknown = True

    # Rule 1–2 / 4–5: IV split; unknown → long single-leg with disclosure
    _iv_rank_val   = iv_rank if iv_rank is not None else None
    _very_high_iv  = _iv_rank_val is not None and _iv_rank_val >= 70
    _high_iv_hint  = _iv_rank_val is not None and _iv_rank_val >= 50

    def _bullish_entry_hint() -> str:
        if iv_unknown:
            return (
                "Long call (7-14 DTE) — bullish with a clean entry; implied IV missing from feed — "
                "confirm IV vs HV on your platform."
            )
        if _very_high_iv:
            return (
                f"Bull put spread 7-14 DTE — bullish; IV rank {_iv_rank_val:.0f} is very high — "
                "sell premium rather than buy it; credit spread profits from IV crush + time decay."
            )
        if _high_iv_hint:
            return f"Call debit spread 7-14 DTE — bullish with a clean entry; IV elevated (rank {_iv_rank_val:.0f} ≥50)."
        return "Long call (7-14 DTE) — bullish with a clean entry; IV not elevated (rank <50 vs HV proxy, or IV at/below HV20)."

    def _bearish_entry_hint() -> str:
        if iv_unknown:
            return (
                "Long put (7-14 DTE) — bearish with a clean entry; implied IV missing from feed — "
                "confirm IV vs HV on your platform."
            )
        if _very_high_iv:
            return (
                f"Bear call spread 7-14 DTE — bearish; IV rank {_iv_rank_val:.0f} is very high — "
                "sell premium rather than buy it; credit spread profits from IV crush + time decay."
            )
        if _high_iv_hint:
            return f"Put debit spread 7-14 DTE — bearish with a clean entry; IV elevated (rank {_iv_rank_val:.0f} ≥50)."
        return "Long put (7-14 DTE) — bearish with a clean entry; IV not elevated (rank <50 vs HV proxy, or IV at/below HV20)."

    hint: str

    # Rule 7 first when hard avoid-naked path
    if fa == "AVOID_NAKED_CALLS":
        hint = (
            "Call debit spread — earnings extremely close; avoid naked long premium."
            if is_bullish
            else "Put debit spread — earnings extremely close; avoid naked long premium."
        )
        return _finalize_playbook_earnings(hint, earnings_days)

    if verdict == "NO_EDGE":
        hint = "No trade — insufficient edge."
        return _finalize_playbook_earnings(hint, earnings_days)

    if verdict == "AVOID":
        hint = "No trade — risk gate active (e.g. very high VIX, earnings imminent, or poor liquidity)."
        return _finalize_playbook_earnings(hint, earnings_days)

    # Rules 3 & 6 — align with scan verdict + RSI extension
    if bias == "long" and verdict == "WATCH" and rsi_val > RSI_OVERBOUGHT:
        hint = "Wait pullback — bullish but extended (overbought RSI)."
        return _finalize_playbook_earnings(hint, earnings_days)
    if bias == "short" and verdict == "WATCH" and rsi_val < RSI_OVERSOLD:
        hint = "Wait for failed bounce — bearish but oversold / extended lower."
        return _finalize_playbook_earnings(hint, earnings_days)

    if dl == "BULLISH_BUT_EXTENDED" and is_bullish:
        hint = "Wait pullback — bullish but extended."
        return _finalize_playbook_earnings(hint, earnings_days)
    if dl == "BULLISH_BUT_EXTENDED" and is_bearish:
        hint = "Wait for failed bounce — bearish but already extended lower."
        return _finalize_playbook_earnings(hint, earnings_days)

    if eq == "GOOD_ENTRY" and is_bullish:
        hint = _finalize_playbook_earnings(_bullish_entry_hint(), earnings_days)
        return hint
    if eq == "GOOD_ENTRY" and is_bearish:
        hint = _finalize_playbook_earnings(_bearish_entry_hint(), earnings_days)
        return hint

    if verdict in ("GO", "STRONG_GO") and is_bullish:
        return _finalize_playbook_earnings(_bullish_entry_hint(), earnings_days)
    if verdict in ("GO", "STRONG_GO") and is_bearish:
        return _finalize_playbook_earnings(_bearish_entry_hint(), earnings_days)

    if fa == "NO_TRADE" or dl in ("WEAK_SETUP", "NO_TRADE_WAIT"):
        hint = "No trade — no clean setup."
        return _finalize_playbook_earnings(hint, earnings_days)

    if verdict == "WAIT" or sb == "NEUTRAL":
        hint = "No trade — no clean setup."
        return _finalize_playbook_earnings(hint, earnings_days)

    hint = "No trade — no clean setup."
    return _finalize_playbook_earnings(hint, earnings_days)


# Bounded daily series for swing UI charts (roughly one trading year).
SWING_CHART_MAX_POINTS = 252


def build_swing_chart_series(
    close: pd.Series,
    ma20: pd.Series,
    ma50: pd.Series,
    rsi: pd.Series,
    hv20: pd.Series,
    volume: Optional[pd.Series] = None,
    open_: Optional[pd.Series] = None,
    high: Optional[pd.Series] = None,
    low: Optional[pd.Series] = None,
    *,
    max_points: int = SWING_CHART_MAX_POINTS,
) -> dict[str, Any]:
    """
    Align OHLC-derived metrics on the daily close index and return the last ``max_points``
    sessions for front-end Recharts.  ``hv20`` (from ``build_hv_series``) may use a shorter
    index — it is reindexed to ``close`` before sampling.
    """
    cap = max(20, min(int(max_points), 300))
    hv_a = hv20.reindex(close.index)
    vol_a = volume.reindex(close.index) if volume is not None else None
    open_a = open_.reindex(close.index) if open_ is not None else None
    high_a = high.reindex(close.index) if high is not None else None
    low_a = low.reindex(close.index) if low is not None else None
    n = len(close)
    lo = max(0, n - cap)

    def num_price(x: object) -> Optional[float]:
        try:
            v = float(x)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return None
        if not math.isfinite(v):
            return None
        return round(v, 4)

    def num_rsi_hv(x: object) -> Optional[float]:
        try:
            v = float(x)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return None
        if not math.isfinite(v):
            return None
        return round(v, 2)

    points: list[dict[str, Any]] = []
    for i in range(lo, n):
        ts = close.index[i]
        if hasattr(ts, "date"):
            d = str(ts.date())
        else:
            d = str(pd.Timestamp(ts).date())
        cval = num_price(close.iloc[i])
        if cval is None:
            continue
        points.append({
            "d": d,
            "c": cval,
            "o": num_price(open_a.iloc[i]) if open_a is not None else None,
            "h": num_price(high_a.iloc[i]) if high_a is not None else None,
            "l": num_price(low_a.iloc[i]) if low_a is not None else None,
            "ma20": num_price(ma20.iloc[i]),
            "ma50": num_price(ma50.iloc[i]),
            "rsi": num_rsi_hv(rsi.iloc[i]),
            "hv20": num_rsi_hv(hv_a.iloc[i]),
            "v": num_price(vol_a.iloc[i]) if vol_a is not None else None,
        })

    return {"max_points": cap, "count": len(points), "points": points}


def _swing_flag_pattern_overlay(points: list[dict[str, Any]], timeframe: str) -> dict[str, Any] | None:
    """Return one conservative Bull/Bear Flag display annotation from OHLC bars."""
    if timeframe not in {"Daily", "Weekly"} or len(points) < 8:
        return None
    bars = points[-8:]
    if any(not isinstance(bar.get("o"), (int, float)) or not isinstance(bar.get("h"), (int, float)) or not isinstance(bar.get("l"), (int, float)) for bar in bars):
        return None
    pole, flag, trigger = bars[:4], bars[4:7], bars[7]
    pole_move = float(pole[-1]["c"]) - float(pole[0]["o"])
    average_range = sum(float(bar["h"]) - float(bar["l"]) for bar in bars) / len(bars)
    if abs(pole_move) < max(average_range * 2.0, abs(float(pole[0]["o"])) * 0.015):
        return None
    bullish = pole_move > 0
    flag_high = max(float(bar["h"]) for bar in flag)
    flag_low = min(float(bar["l"]) for bar in flag)
    flag_height = flag_high - flag_low
    counter_trend = float(flag[-1]["c"]) <= float(flag[0]["c"]) if bullish else float(flag[-1]["c"]) >= float(flag[0]["c"])
    retrace = abs(float(flag[-1]["c"]) - float(pole[-1]["c"]))
    if not counter_trend or flag_height > abs(pole_move) * 0.72 or retrace > abs(pole_move) * 0.68:
        return None
    flag_volume = sum(float(bar.get("v") or 0) for bar in flag) / len(flag)
    volume_confirmed = float(trigger.get("v") or 0) >= flag_volume * 1.15 if flag_volume > 0 else False
    confirmed = float(trigger["c"]) > flag_high and volume_confirmed if bullish else float(trigger["c"]) < flag_low and volume_confirmed
    breakout = flag_high if bullish else flag_low
    return {
        "id": "continuation_pattern",
        "label": "Bull Flag" if bullish else "Bear Flag",
        "direction": "bullish" if bullish else "bearish",
        "status": "CONFIRMED" if confirmed else "FORMING",
        "confidence": 78 if confirmed else 58,
        "detail": "Breakout confirmed with volume." if confirmed else "Wait for a close beyond the flag rail with volume.",
        "breakout": round(breakout, 4),
        "stop": round(flag_low if bullish else flag_high, 4),
        "target": round(breakout + abs(pole_move) if bullish else breakout - abs(pole_move), 4),
        "segments": [
            {"role": "pole", "from": pole[0]["d"], "fromPrice": round(float(pole[0]["l"] if bullish else pole[0]["h"]), 4), "to": pole[-1]["d"], "toPrice": round(float(pole[-1]["h"] if bullish else pole[-1]["l"]), 4)},
            {"role": "flag_upper", "from": flag[0]["d"], "fromPrice": round(float(flag[0]["h"]), 4), "to": flag[-1]["d"], "toPrice": round(float(flag[-1]["h"]), 4)},
            {"role": "flag_lower", "from": flag[0]["d"], "fromPrice": round(float(flag[0]["l"]), 4), "to": flag[-1]["d"], "toPrice": round(float(flag[-1]["l"]), 4)},
        ],
    }


def build_swing_chart_timeframe_series(
    raw: pd.DataFrame,
    timeframe: str,
) -> dict[str, Any]:
    """Return a backend-owned chart payload for one Swing Trade timeframe."""
    if raw is None or raw.empty or "Close" not in raw.columns:
        return {"timeframe": timeframe, "max_points": 0, "count": 0, "points": []}

    frame = raw.sort_index().dropna(subset=["Close"])[[column for column in ("Open", "High", "Low", "Close", "Volume") if column in raw.columns]].copy()
    if timeframe == "Weekly":
        aggregations: dict[str, str] = {"Close": "last"}
        if "Open" in frame.columns:
            aggregations["Open"] = "first"
        if "High" in frame.columns:
            aggregations["High"] = "max"
        if "Low" in frame.columns:
            aggregations["Low"] = "min"
        if "Volume" in frame.columns:
            aggregations["Volume"] = "sum"
        frame = frame.resample("W-FRI").agg(aggregations).dropna(subset=["Close"])
        max_points = 104
    elif timeframe == "Monthly":
        aggregations = {"Close": "last"}
        if "Open" in frame.columns:
            aggregations["Open"] = "first"
        if "High" in frame.columns:
            aggregations["High"] = "max"
        if "Low" in frame.columns:
            aggregations["Low"] = "min"
        if "Volume" in frame.columns:
            aggregations["Volume"] = "sum"
        frame = frame.resample("ME").agg(aggregations).dropna(subset=["Close"])
        max_points = 60
    else:
        timeframe = "Daily"
        max_points = SWING_CHART_MAX_POINTS

    close = frame["Close"].astype(float)
    ma20 = _sma(close, MA_FAST)
    ma50 = _sma(close, MA_SLOW)
    rsi = _rsi(close)
    hv20 = build_hv_series(frame, 20)
    payload = build_swing_chart_series(
        close,
        ma20,
        ma50,
        rsi,
        hv20,
        frame["Volume"].astype(float) if "Volume" in frame.columns else None,
        frame["Open"].astype(float) if "Open" in frame.columns else None,
        frame["High"].astype(float) if "High" in frame.columns else None,
        frame["Low"].astype(float) if "Low" in frame.columns else None,
        max_points=max_points,
    )
    return {"timeframe": timeframe, **payload, "pattern_overlay": _swing_flag_pattern_overlay(payload["points"], timeframe)}


def build_swing_market_structure(raw: pd.DataFrame, *, max_pivots: int = 8) -> dict[str, Any]:
    """
    Backend-owned daily market-structure labels for the Swing chart.

    Uses confirmed pivots only; the final right-side candles are never labeled
    by detect_confirmed_pivots, so React does not infer HH/HL/LH/LL.
    """
    try:
      clean = raw.dropna(subset=["High", "Low"]).copy()
      if clean.empty or len(clean) < 10:
          return classify_structure([])
      pivots = detect_confirmed_pivots(clean["High"].astype(float), clean["Low"].astype(float), left=2, right=2)
      structure = classify_structure(pivots)

      def add_dates(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
          out: list[dict[str, Any]] = []
          for item in items:
              idx = item.get("index")
              dated = dict(item)
              if isinstance(idx, int) and 0 <= idx < len(clean.index):
                  ts = clean.index[idx]
                  dated["date"] = str(ts.date()) if hasattr(ts, "date") else str(pd.Timestamp(ts).date())
              out.append(dated)
          return out

      def provisional_trailing_pivot(items: list[dict[str, Any]]) -> dict[str, Any] | None:
          if not items:
              return None
          last = items[-1]
          last_index = last.get("index")
          last_kind = last.get("kind")
          if not isinstance(last_index, int) or last_index >= len(clean.index) - 1:
              return None
          next_kind = "L" if last_kind == "H" else "H"
          trailing = clean.iloc[last_index + 1:]
          if trailing.empty:
              return None
          if next_kind == "L":
              idx_label = trailing["Low"].astype(float).idxmin()
              price = float(trailing.loc[idx_label, "Low"])
          else:
              idx_label = trailing["High"].astype(float).idxmax()
              price = float(trailing.loc[idx_label, "High"])
          index = int(clean.index.get_loc(idx_label))
          previous_same = next((item for item in reversed(items) if item.get("kind") == next_kind and isinstance(item.get("price"), (int, float))), None)
          prior_price = float(previous_same["price"]) if previous_same else None
          tolerance = max(0.01, abs(prior_price or price) * 0.0015)
          if prior_price is None:
              label = f"{next_kind}?"
          elif abs(price - prior_price) <= tolerance:
              label = "EQL?" if next_kind == "L" else "EQH?"
          elif next_kind == "L":
              label = "HL?" if price > prior_price else "LL?"
          else:
              label = "HH?" if price > prior_price else "LH?"
          ts = clean.index[index]
          return {
              "type": "HIGH" if next_kind == "H" else "LOW",
              "kind": next_kind,
              "label": label,
              "price": round(price, 2),
              "index": index,
              "confirmed": False,
              "status": "PROVISIONAL",
              "date": str(ts.date()) if hasattr(ts, "date") else str(pd.Timestamp(ts).date()),
          }

      structure["pivots"] = add_dates(list(structure.get("pivots") or []))[-max_pivots:]
      chart_pivots = add_dates(list(structure.get("chart_pivots") or structure.get("all_pivots") or []))
      trailing_pivot = provisional_trailing_pivot(chart_pivots)
      if trailing_pivot and (not chart_pivots or trailing_pivot.get("index") != chart_pivots[-1].get("index")):
          chart_pivots.append(trailing_pivot)
      structure["chart_pivots"] = chart_pivots[-max_pivots:]
      structure["all_pivots"] = add_dates(list(structure.get("all_pivots") or []))[-max_pivots:]
      return structure
    except Exception as exc:
      log.warning("build_swing_market_structure failed: %s", exc)
      return classify_structure([])


def _prof_num(value: Any) -> float | None:
    try:
        if value is None:
            return None
        n = float(value)
        return n if math.isfinite(n) else None
    except (TypeError, ValueError):
        return None


def _prof_money(value: Any) -> str:
    n = _prof_num(value)
    return "—" if n is None else f"${n:,.2f}"


def _prof_metric(
    *,
    value: Any,
    display: str | None = None,
    formula: str | None = None,
    inputs: list[str] | None = None,
    reason: str | None = None,
    timestamp: str | None = None,
    confidence: float | None = None,
    source: str = "swing_trade",
) -> dict[str, Any]:
    return {
        "value": value,
        "display": str(display if display is not None else value if value not in (None, "") else "—"),
        "formula": formula,
        "inputs": inputs or [],
        "reason": reason,
        "timestamp": timestamp,
        "confidence": round(float(confidence), 1) if confidence is not None else None,
        "source": source,
    }


def _swing_entry_timing_label(entry_quality: str, final_action: str, metrics: dict[str, Any]) -> str:
    raw = f"{entry_quality} {final_action}".upper()
    if "AVOID" in raw or "CHASE" in raw or "BAD" in raw:
        return "Do Not Chase"
    if "LATE" in raw:
        return "Late"
    if "EXTEND" in raw:
        return "Extended"
    if "GOOD" in raw:
        return "Good"
    score = _prof_num(metrics.get("entry_quality_score"))
    if score is not None and score >= 80:
        return "Perfect"
    if score is not None and score >= 62:
        return "Good"
    return "Do Not Chase"


def _swing_grade(score: float, timing: str) -> str:
    if timing in {"Do Not Chase", "Too Late"}:
        return "C"
    if score >= 8.5:
        return "A+"
    if score >= 7.0:
        return "A"
    if score >= 5.0:
        return "B"
    return "C"


def _build_swing_professional_decision(
    *,
    ticker: str,
    decision: dict[str, Any],
    metrics: dict[str, Any],
    reasons: list[str],
    market_structure: dict[str, Any],
    exec_levels: dict[str, Any],
    playbook_hint: str,
) -> dict[str, Any]:
    generated_at = datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
    bias_raw = str(decision.get("swing_bias") or "").upper()
    stock_bias = "Bullish" if "BULL" in bias_raw or decision.get("swing_bias") == "BULLISH" else "Bearish" if "BEAR" in bias_raw or decision.get("swing_bias") == "BEARISH" else "Neutral"
    market_raw = str(decision.get("market_context") or metrics.get("market_context") or metrics.get("market_bias") or "Neutral").upper()
    market_context = "Bullish" if "SUPPORT" in market_raw or "BULL" in market_raw else "Bearish" if "WEAK" in market_raw or "BEAR" in market_raw else "Neutral"
    final_action = str(decision.get("final_action") or "NO_TRADE")
    risk_flags = [str(flag) for flag in list(decision.get("risk_flags") or [])]
    earnings_gate = "EARNINGS_IMMINENT" in risk_flags
    current_action = "WAIT FOR EARNINGS" if earnings_gate else "WAIT" if final_action in {"WAIT_PULLBACK", "WAIT_BREAKOUT", "WAIT_FOR_BREAKDOWN", "AVOID_CHASE", "NO_TRADE"} else final_action.replace("_", " ")
    setup = str(metrics.get("entry_recommendation_state") or decision.get("decision_label") or "Swing Setup").replace("_", " ").title()
    if earnings_gate:
        setup = "Earnings Risk - Confirmation Pending"
    phase = "Pending" if "WAIT" in final_action or final_action == "NO_TRADE" else "Confirmed" if final_action in {"GO", "GO_SMALL", "STRONG_GO"} else "Armed"
    next_opportunity = "Bullish Pullback" if stock_bias == "Bullish" else "Bearish Pullback" if stock_bias == "Bearish" else "No Trade"
    if earnings_gate:
        next_opportunity = "Post-Earnings Confirmation"
    if "BREAKOUT" in final_action:
        next_opportunity = "Breakout"
    if "BREAKDOWN" in final_action:
        next_opportunity = "Breakdown"
    timing = _swing_entry_timing_label(str(decision.get("entry_quality") or ""), final_action, metrics)
    score_10 = float(_prof_num(decision.get("trade_quality_score")) or 0.0)
    score_100 = min(100.0, max(0.0, score_10 * 10.0))
    entry_score = float(_prof_num(metrics.get("entry_quality_score")) or score_100)
    grade = _swing_grade(score_10, timing)
    entry = _prof_num(exec_levels.get("breakout") or exec_levels.get("entry"))
    stop = _prof_num(exec_levels.get("stop"))
    target1 = _prof_num(exec_levels.get("target1"))
    target2 = _prof_num(exec_levels.get("target2"))
    target = target2 or target1
    last = _prof_num(metrics.get("last_price"))
    risk = abs(entry - stop) if entry is not None and stop is not None else None
    reward = abs(target - entry) if entry is not None and target is not None else None
    rr = reward / risk if risk and reward is not None else None
    reward_remaining = abs(target - last) if target is not None and last is not None else None
    risk_remaining = abs(last - stop) if stop is not None and last is not None else None
    structure_display = str(market_structure.get("display") or market_structure.get("structure") or "")

    # A technical edge is evidence, not an entry approval when a hard risk gate is
    # active. Keep the evidence visible without presenting a contradictory GO.
    positive_reasons = [
        item for item in reasons
        if not (earnings_gate and item.upper().startswith(("GO", "STRONG GO")))
    ]
    positive = [_prof_metric(value=item, display=item, reason="Backend swing reason.", timestamp=generated_at, confidence=score_100) for item in positive_reasons[:5]]
    if structure_display:
        positive.append(_prof_metric(value="Structure", display=structure_display, reason="Backend-confirmed daily market structure.", timestamp=generated_at, confidence=score_100))
    risk_display = {
        "EARNINGS_IMMINENT": "Earnings imminent - wait for the event to pass before opening a directional swing.",
        "EARNINGS_SOON": "Earnings are close - reduce exposure and account for event-gap risk.",
    }
    negative = [
        _prof_metric(
            value=item,
            display=risk_display.get(item, "Contract duration exceeds the preferred swing window." if item.startswith("DTE_TOO_LONG") else item.replace("_", " ").title()),
            reason="Backend risk flag.",
            timestamp=generated_at,
            confidence=score_100,
        )
        for item in risk_flags[:5]
    ]
    neutral_reasons = list(decision.get("confirmation_needed") or [])
    if earnings_gate:
        neutral_reasons.insert(0, "Wait for post-earnings price acceptance before evaluating a new entry.")
    neutral = [_prof_metric(value=item, display=item, reason="Pending backend confirmation.", timestamp=generated_at, confidence=score_100) for item in neutral_reasons[:5]]

    bullish_changes = [
        _prof_metric(value="Breakout", display="Breakout", reason="Price breaks backend resistance with confirmation.", timestamp=generated_at),
        _prof_metric(value="Bullish Pullback", display="Bullish Pullback", reason="Pullback holds above MA20/VWAP equivalent support.", timestamp=generated_at),
    ]
    bearish_changes = [
        _prof_metric(value="Breakdown", display="Breakdown", reason="Price loses backend support.", timestamp=generated_at),
        _prof_metric(value="VWAP Reject", display="VWAP Reject", reason="Price rejects key mean/reference level.", timestamp=generated_at),
    ]
    if earnings_gate:
        bullish_changes = [_prof_metric(value="Post-Earnings Reclaim", display="Post-Earnings Reclaim", reason="After the report, price reclaims the backend trend level with confirmation.", timestamp=generated_at)]
        bearish_changes = [_prof_metric(value="Post-Earnings Breakdown", display="Post-Earnings Breakdown", reason="After the report, price loses backend support with confirmation.", timestamp=generated_at)]
    invalidation = [_prof_metric(value="Invalidation", display=f"Lost {_prof_money(stop)}", reason="Setup invalidates if backend stop/structure level is lost.", timestamp=generated_at)]
    coach_lines = [
        f"What happened: {ticker} has {stock_bias.lower()} swing bias and {setup}.",
        f"Why: " + (positive[0]["display"] if positive else str(decision.get("decision_message") or "Backend returned mixed evidence.")),
        f"What to watch: {next_opportunity} with confirmation.",
        f"What invalidates: lose {_prof_money(stop)} or structure flips.",
        f"Next setup: {next_opportunity}; do not chase extended entries.",
    ][:6]

    return {
        "hierarchy": {
            "marketContext": _prof_metric(value=market_context, display=market_context, formula="SPY/QQQ/sector/VIX/breadth context where available", inputs=["market_context"], reason="Broad market state affects swing confidence.", timestamp=generated_at, confidence=score_100),
            "stockBias": _prof_metric(value=stock_bias, display=stock_bias, formula="Daily structure + trend + momentum", inputs=["market_structure", "ma20", "ma50", "rsi"], reason=structure_display or "Backend swing bias.", timestamp=generated_at, confidence=score_100),
            "setup": _prof_metric(value=setup, display=setup, formula="Backend swing setup classifier", inputs=["decision_label", "entry_recommendation_state"], reason=decision.get("decision_message"), timestamp=generated_at, confidence=score_100),
            "currentPhase": _prof_metric(value=phase, display=phase, formula="Universal setup lifecycle", inputs=["final_action", "entry_quality"], reason="Phase is derived from backend action and entry quality.", timestamp=generated_at, confidence=score_100),
            "nextOpportunity": _prof_metric(value=next_opportunity, display=next_opportunity, formula="Action + bias + timing", inputs=["final_action", "swing_bias", "entry_quality"], reason=playbook_hint, timestamp=generated_at, confidence=score_100),
            "originalEntry": _prof_metric(value=phase, display="Completed" if phase in {"Confirmed", "Continuation"} else "Pending", formula="Swing phase state", inputs=["final_action"], reason="Original entry is complete only after backend confirmation.", timestamp=generated_at, confidence=score_100),
            "currentAction": _prof_metric(value=current_action, display=current_action, formula="Backend final action", inputs=["final_action"], reason=decision.get("decision_message"), timestamp=generated_at, confidence=score_100),
        },
        "why": {"positiveFactors": positive[:6], "negativeFactors": negative[:6], "neutralFactors": neutral[:6]},
        "changesDecision": {"bullish": bullish_changes, "bearish": bearish_changes, "invalidation": invalidation},
        "confidence": {
            "biasConfidence": _prof_metric(value=score_100, display=f"{score_100:.0f}%", formula="Swing trade quality score", inputs=["trade_quality_score"], timestamp=generated_at, confidence=score_100),
            "tradeConfidence": _prof_metric(value=score_100, display=f"{score_100:.0f}%", formula="Backend trade confidence", inputs=["trade_quality_score", "risk_level"], timestamp=generated_at, confidence=score_100),
            "entryQuality": _prof_metric(value=grade, display=grade, formula="Score mapped to A+/A/B/C", inputs=["trade_quality_score", "entry_quality"], reason="Letter grade replaces high/medium/low.", timestamp=generated_at, confidence=score_100),
            "entryTiming": _prof_metric(value=timing, display=timing, formula="Entry timing guardrail", inputs=["entry_quality", "final_action"], reason="Engine should not recommend chasing.", timestamp=generated_at, confidence=entry_score),
        },
        "scores": {
            "trendScore": _prof_metric(value=metrics.get("trend_score"), display=str(metrics.get("trend_score") or "—"), formula="Backend trend score", inputs=["trend_score"], timestamp=generated_at, confidence=_prof_num(metrics.get("trend_score"))),
            "structureScore": _prof_metric(value=metrics.get("structure_score"), display=str(metrics.get("structure_score") or "—"), formula="Backend structure score", inputs=["market_structure"], timestamp=generated_at, confidence=_prof_num(metrics.get("structure_score"))),
            "momentumScore": _prof_metric(value=metrics.get("momentum_score"), display=str(metrics.get("momentum_score") or "—"), formula="Backend momentum score", inputs=["momentum"], timestamp=generated_at, confidence=_prof_num(metrics.get("momentum_score"))),
            "volumeScore": _prof_metric(value=metrics.get("volume_score"), display=str(metrics.get("volume_score") or "—"), formula="Backend volume score", inputs=["volume"], timestamp=generated_at, confidence=_prof_num(metrics.get("volume_score"))),
            "marketScore": _prof_metric(value=score_100, display=f"{score_100:.0f}", formula="Market contribution", inputs=["market_context"], timestamp=generated_at, confidence=score_100),
            "entryScore": _prof_metric(value=entry_score, display=f"{entry_score:.0f}", formula="Backend entry score", inputs=["entry_quality_score"], timestamp=generated_at, confidence=entry_score),
            "overallTradeScore": _prof_metric(value=score_100, display=f"{score_100:.0f}", formula="Overall swing score", inputs=["trend", "structure", "momentum", "volume", "market", "entry"], timestamp=generated_at, confidence=score_100),
        },
        "risk": {
            "entry": _prof_metric(value=entry, display=_prof_money(entry), formula="Backend execution level", inputs=["exec_levels"], timestamp=generated_at, confidence=score_100),
            "stop": _prof_metric(value=stop, display=_prof_money(stop), formula="Backend stop level", inputs=["exec_levels"], timestamp=generated_at, confidence=score_100),
            "risk": _prof_metric(value=risk, display=_prof_money(risk), formula="abs(entry - stop)", inputs=["entry", "stop"], timestamp=generated_at, confidence=score_100),
            "target": _prof_metric(value=target, display=_prof_money(target), formula="Backend target level", inputs=["target1", "target2"], timestamp=generated_at, confidence=score_100),
            "riskReward": _prof_metric(value=rr, display="—" if rr is None else f"{rr:.2f} : 1", formula="reward / risk", inputs=["entry", "stop", "target"], timestamp=generated_at, confidence=score_100),
            "rewardRemaining": _prof_metric(value=reward_remaining, display=_prof_money(reward_remaining), formula="abs(target - last)", inputs=["target", "last_price"], timestamp=generated_at, confidence=score_100),
            "riskRemaining": _prof_metric(value=risk_remaining, display=_prof_money(risk_remaining), formula="abs(last - stop)", inputs=["last_price", "stop"], timestamp=generated_at, confidence=score_100),
            "tradeQuality": _prof_metric(value=grade, display=grade, formula="Entry grade + R:R + confidence", inputs=["entryQuality", "riskReward", "tradeConfidence"], timestamp=generated_at, confidence=score_100),
        },
        "marketContext": {
            "spy": _prof_metric(value=metrics.get("spy_trend"), display=str(metrics.get("spy_trend") or "Unavailable"), formula="Market context feed", inputs=["SPY"], timestamp=generated_at),
            "qqq": _prof_metric(value=metrics.get("qqq_trend"), display=str(metrics.get("qqq_trend") or "Unavailable"), formula="Market context feed", inputs=["QQQ"], timestamp=generated_at),
            "sector": _prof_metric(value=metrics.get("sector_trend"), display=str(metrics.get("sector_trend") or "Unavailable"), formula="Sector ETF context", inputs=["sector"], timestamp=generated_at),
            "vix": _prof_metric(value=metrics.get("vix"), display=str(metrics.get("vix") or "Unavailable"), formula="VIX context", inputs=["VIX"], timestamp=generated_at),
            "breadth": _prof_metric(value=metrics.get("breadth"), display=str(metrics.get("breadth") or "Unavailable"), formula="Market breadth context", inputs=["breadth"], timestamp=generated_at),
            "relativeStrength": _prof_metric(value=metrics.get("relative_strength"), display=str(metrics.get("relative_strength") or "Unavailable"), formula="Ticker versus market context", inputs=["relative_strength"], timestamp=generated_at),
        },
        "timeline": [
            {"id": "opening-range", "label": "Base", "phase": "Pending", "timestamp": None, "price": None, "status": "completed", "reason": "Daily base/trend context is loaded."},
            {"id": "trigger", "label": "Trigger", "phase": "Triggered", "timestamp": None, "price": entry, "status": "completed" if phase in {"Confirmed", "Continuation"} else "pending", "reason": str(decision.get("decision_message") or "")},
            {"id": "confirmation", "label": "Confirmation", "phase": "Confirmed", "timestamp": None, "price": entry, "status": "completed" if phase == "Confirmed" else "pending", "reason": "Backend final action confirmation."},
            {"id": "retest", "label": "Retest", "phase": "Retest", "timestamp": None, "price": None, "status": "pending", "reason": "Wait for pullback/retest if timing is not clean."},
            {"id": "continuation", "label": "Continuation", "phase": "Continuation", "timestamp": None, "price": None, "status": "pending", "reason": "Continuation requires fresh confirmation."},
            {"id": "target1", "label": "Target1", "phase": "Target1", "timestamp": None, "price": target1, "status": "pending", "reason": "First backend target."},
            {"id": "target2", "label": "Target2", "phase": "Target2", "timestamp": None, "price": target2, "status": "pending", "reason": "Second backend target."},
            {"id": "exhaustion", "label": "Exhaustion", "phase": "Exhausted", "timestamp": None, "price": None, "status": "pending", "reason": "Exhaustion appears when backend blocks chasing."},
        ],
        "aiCoach": {"lines": coach_lines},
    }


# ── Option liquidity helper ───────────────────────────────────────────

def _compute_option_liquidity_score(ticker: str, price: float) -> Optional[float]:
    """
    Compute option liquidity score (0-10) from near-the-money option chain data.

    Score components:
      - Bid-ask spread (0-4): lower = more liquid
      - Open interest    (0-3): higher = more liquid
      - Volume           (0-2): higher = more liquid
      - Strike density   (0-1): more strikes = better chain

    Returns None when option data is unavailable (ticker may not have
    exchange-traded options).  Score < 4 triggers LOW_OPTION_LIQUIDITY
    in the decision quality layer.
    """
    try:
        opt_dates = list(bar_cache.get_option_dates(ticker) or [])
        if not opt_dates:
            return None

        # Pick ~3-week expiry (21 DTE sweet spot, ±2 weeks) — matches playbook recommendation
        now = datetime.now()
        target_dte = 21
        best_expiry = None
        best_diff = 999
        for d in opt_dates:
            dt = datetime.strptime(d, "%Y-%m-%d")
            dte = (dt.date() - now.date()).days if hasattr(dt, "date") else (dt - now).days
            if 14 <= dte <= 60:
                diff = abs(dte - target_dte)
                if diff < best_diff:
                    best_diff = diff
                    best_expiry = d
        if best_expiry is None:
            best_expiry = opt_dates[min(2, len(opt_dates) - 1)]

        calls_raw, puts_raw = bar_cache.get_option_chain(ticker, best_expiry)
        if calls_raw is None or puts_raw is None:
            return None

        lo = price * 0.80
        hi = price * 1.20
        calls = calls_raw[(calls_raw["strike"] >= lo) & (calls_raw["strike"] <= hi)].copy()
        puts  = puts_raw[(puts_raw["strike"]  >= lo) & (puts_raw["strike"]  <= hi)].copy()
        if calls.empty and puts.empty:
            return None

        combined = pd.concat([calls, puts])
        spreads: list[float] = []
        ois: list[int] = []
        vols: list[int] = []

        for _, row in combined.iterrows():
            bid = float(row.get("bid", 0) or 0)
            ask = float(row.get("ask", 0) or 0)
            oi  = int(row.get("openInterest", 0) or 0)
            vol = int(row.get("volume", 0) or 0)
            if bid > 0 and ask > 0:
                mid = (bid + ask) / 2
                if mid > 0:
                    spreads.append((ask - bid) / mid * 100)
            ois.append(oi)
            vols.append(vol)

        if not spreads:
            return None

        avg_spread = sum(spreads) / len(spreads)
        max_oi     = max(ois)
        total_vol  = sum(vols)

        score = 0.0
        if avg_spread <= 5.0:       score += 4.0
        elif avg_spread <= 10.0:    score += 2.0
        elif avg_spread <= 15.0:    score += 1.0
        if max_oi >= 1000:          score += 3.0
        elif max_oi >= 500:         score += 2.0
        elif max_oi >= 100:         score += 1.0
        if total_vol >= 500:        score += 2.0
        elif total_vol >= 100:      score += 1.0
        if len(combined) >= 4:      score += 1.0

        return round(min(10.0, score), 1)
    except Exception:
        return None


def _suggest_spread_entry(
    ticker: str,
    strategy: str,
    exec_levels: dict,
    recommended_contract_duration: str,
) -> Optional[dict]:
    """
    Suggest concrete option legs for the recommended spread strategy.
    Returns a dict with long_strike, short_strike (if spread), expiry, estimated
    debit/credit, max_gain, max_loss, and breakeven — or None when chain is unavailable.
    """
    try:
        strat = strategy.upper()
        if strat not in ("CALL_DEBIT_SPREAD", "PUT_DEBIT_SPREAD", "LONG_CALL", "LONG_PUT"):
            return None

        brk   = exec_levels.get("breakout")
        t1    = exec_levels.get("target1")
        if brk is None or t1 is None:
            return None

        # Parse DTE range → target midpoint
        target_dte = 12
        if recommended_contract_duration:
            parts = recommended_contract_duration.replace("–", "-").split("-")
            nums = [int(p.strip()) for p in parts if p.strip().isdigit()]
            if len(nums) == 2:
                target_dte = (nums[0] + nums[1]) // 2
            elif len(nums) == 1:
                target_dte = nums[0]

        opt_dates = list(bar_cache.get_option_dates(ticker) or [])
        if not opt_dates:
            return None

        now = datetime.now()
        best_expiry = None
        best_diff = 999
        for d in opt_dates:
            dt = datetime.strptime(d, "%Y-%m-%d")
            dte = (dt.date() - now.date()).days
            if dte >= 7:
                diff = abs(dte - target_dte)
                if diff < best_diff:
                    best_diff = diff
                    best_expiry = d
        if best_expiry is None:
            return None

        calls_raw, puts_raw = bar_cache.get_option_chain(ticker, best_expiry)

        is_call = strat in ("CALL_DEBIT_SPREAD", "LONG_CALL")
        chain = calls_raw if is_call else puts_raw
        if chain is None or chain.empty:
            return None

        strikes = sorted(chain["strike"].unique().tolist())
        if not strikes:
            return None

        def nearest_at_or_above(level: float) -> Optional[float]:
            above = [s for s in strikes if s >= level]
            return above[0] if above else strikes[-1]

        def nearest_at_or_below(level: float) -> Optional[float]:
            below = [s for s in strikes if s <= level]
            return below[-1] if below else strikes[0]

        def next_strike_above(level: float) -> Optional[float]:
            above = [s for s in strikes if s > level]
            return above[0] if above else None

        def next_strike_below(level: float) -> Optional[float]:
            below = [s for s in strikes if s < level]
            return below[-1] if below else None

        def get_mid(strike: float) -> Optional[float]:
            row = chain[chain["strike"] == strike]
            if row.empty:
                return None
            bid = float(row.iloc[0].get("bid", 0) or 0)
            ask = float(row.iloc[0].get("ask", 0) or 0)
            if ask <= 0:
                return None
            return round((bid + ask) / 2, 2)

        if strat == "CALL_DEBIT_SPREAD":
            long_strike  = nearest_at_or_above(brk)
            short_strike = nearest_at_or_below(t1)
            if long_strike >= short_strike:
                short_strike = next_strike_above(long_strike)
            if short_strike is None or long_strike >= short_strike:
                return None
            long_mid  = get_mid(long_strike)
            short_mid = get_mid(short_strike)
            if long_mid is None:
                return None
            est_debit  = round(long_mid - (short_mid or 0), 2)
            width      = round(short_strike - long_strike, 2)
            max_gain   = round((width - est_debit) * 100, 2)
            max_loss   = round(est_debit * 100, 2)
            breakeven  = round(long_strike + est_debit, 2)
            return {
                "strategy":     "CALL DEBIT SPREAD",
                "long_leg":     f"Long ${long_strike:.0f}C",
                "short_leg":    f"Short ${short_strike:.0f}C",
                "long_strike":  long_strike,
                "short_strike": short_strike,
                "expiry":       best_expiry,
                "est_debit":    est_debit,
                "width":        width,
                "max_gain":     max_gain,
                "max_loss":     max_loss,
                "breakeven":    breakeven,
                "entry_note":   f"Enter on break & hold above ${brk:.2f}",
            }

        if strat == "PUT_DEBIT_SPREAD":
            long_strike  = nearest_at_or_below(brk)
            short_strike = nearest_at_or_above(t1)
            if long_strike <= short_strike:
                short_strike = next_strike_below(long_strike)
            if short_strike is None or long_strike <= short_strike:
                return None
            long_mid  = get_mid(long_strike)
            short_mid = get_mid(short_strike)
            if long_mid is None:
                return None
            est_debit  = round(long_mid - (short_mid or 0), 2)
            width      = round(long_strike - short_strike, 2)
            max_gain   = round((width - est_debit) * 100, 2)
            max_loss   = round(est_debit * 100, 2)
            breakeven  = round(long_strike - est_debit, 2)
            return {
                "strategy":     "PUT DEBIT SPREAD",
                "long_leg":     f"Long ${long_strike:.0f}P",
                "short_leg":    f"Short ${short_strike:.0f}P",
                "long_strike":  long_strike,
                "short_strike": short_strike,
                "expiry":       best_expiry,
                "est_debit":    est_debit,
                "width":        width,
                "max_gain":     max_gain,
                "max_loss":     max_loss,
                "breakeven":    breakeven,
                "entry_note":   f"Enter on break & hold below ${brk:.2f}",
            }

        if strat == "LONG_CALL":
            long_strike = nearest_at_or_above(brk)
            long_mid    = get_mid(long_strike)
            if long_mid is None:
                return None
            return {
                "strategy":    "LONG CALL",
                "long_leg":    f"Long ${long_strike:.0f}C",
                "short_leg":   None,
                "long_strike": long_strike,
                "short_strike": None,
                "expiry":      best_expiry,
                "est_debit":   long_mid,
                "width":       None,
                "max_gain":    None,
                "max_loss":    round(long_mid * 100, 2),
                "breakeven":   round(long_strike + long_mid, 2),
                "entry_note":  f"Enter on break & hold above ${brk:.2f}",
            }

        if strat == "LONG_PUT":
            long_strike = nearest_at_or_below(brk)
            long_mid    = get_mid(long_strike)
            if long_mid is None:
                return None
            return {
                "strategy":    "LONG PUT",
                "long_leg":    f"Long ${long_strike:.0f}P",
                "short_leg":   None,
                "long_strike": long_strike,
                "short_strike": None,
                "expiry":      best_expiry,
                "est_debit":   long_mid,
                "width":       None,
                "max_gain":    None,
                "max_loss":    round(long_mid * 100, 2),
                "breakeven":   round(long_strike - long_mid, 2),
                "entry_note":  f"Enter on break & hold below ${brk:.2f}",
            }

        return None
    except Exception:
        return None


# ── Scan validation ───────────────────────────────────────────────────

def _validate_swing_scan(scan: SwingTradeScan) -> list[str]:
    """
    Check scan invariants before caching.  Catches bugs that would
    produce contradictory or nonsensical results in prod.
    Returns a list of issue descriptions (empty = valid).
    """
    issues: list[str] = []
    if scan.verdict in ("GO", "STRONG_GO") and scan.entry_quality in ("BAD_ENTRY", "NO_CLEAN_ENTRY"):
        issues.append(f"verdict={scan.verdict} contradicts entry_quality={scan.entry_quality}")
    if scan.bull_score < 0 or scan.bear_score < 0:
        issues.append(f"negative score: bull={scan.bull_score} bear={scan.bear_score}")
    if not (0.0 <= scan.trade_quality_score <= 10.0):
        issues.append(f"trade_quality_score {scan.trade_quality_score} outside [0, 10]")
    if scan.bias not in ("long", "short", None):
        issues.append(f"unexpected bias={scan.bias}")
    if scan.verdict not in ("STRONG_GO", "GO", "WATCH", "WAIT", "AVOID", "NO_EDGE"):
        issues.append(f"unexpected verdict={scan.verdict}")
    return issues

# ── Execution levels ──────────────────────────────────────────────────

def _exec_levels_fallback(last: float) -> dict[str, Optional[float]]:
    return {
        "pullback_zone_lo": None,
        "pullback_zone_hi": None,
        "breakout": None,
        "target1":  None,
        "target2":  None,
        "stop":     None,
    }


def _compute_exec_levels(last: float, ma20: float, mom_5d_pct: float, bias: Optional[str]) -> dict[str, Optional[float]]:
    """
    Compute stop loss, pullback zone, breakout trigger, and targets.

    METHOD: MA20 Structural Distance (measured move).
    - The MA20 represents the "last anchor" — the average cost basis over the past month.
    - The measured move = distance price has already traveled from MA20.
    - T1 = current price + 50% of that measured move (price extends by half again).
    - T2 = current price + 100% of that measured move (price extends by the full move).
    - Stop = MA20 × 0.998 for long (just below the structural support).
             MA20 × 1.002 for short (just above the structural resistance).
    - Breakout trigger = last + small buffer (price confirmation level for new entries).

    Example (TSLA long, last=$430, MA20=$415):
        measured_move = 430 - 415 = $15
        T1 = 430 + 15 × 0.5 = $437.50
        T2 = 430 + 15 × 1.0 = $445.00
        Stop = 415 × 0.998 = $414.17
        Breakout = 430 × 1.005 = $432.15  (0.5% above current = confirmation)
    """
    if bias == "long":
        # Measured move: distance price has traveled above MA20
        measured_move = last - ma20 if last > ma20 else last * 0.02  # min 2% if price at/below MA20
        measured_move = max(measured_move, last * 0.01)  # floor: at least 1% of price
        brk  = round(last * 1.005, 2)    # 0.5% above current — breakout confirmation level
        t1   = round(last + measured_move * 0.5, 2)  # half measured move extension
        t2   = round(last + measured_move * 1.0, 2)  # full measured move extension
        stop = round(ma20 * 0.98, 2)                # 2% below MA20 — structural support with volatility buffer
        pb_lo = round(ma20 * 0.99, 2)
        pb_hi = round(ma20 * 1.01, 2)
        if not (t1 > last):
            log.warning("_compute_exec_levels: target1 %s <= last %s for long bias; returning defaults", t1, last)
            return _exec_levels_fallback(last)
        if not (t2 > t1):
            log.warning("_compute_exec_levels: target2 %s <= target1 %s for long bias; returning defaults", t2, t1)
            return _exec_levels_fallback(last)
        if not (stop < last):
            log.warning("_compute_exec_levels: stop %s >= last %s for long bias; returning defaults", stop, last)
            return _exec_levels_fallback(last)
        return {
            "pullback_zone_lo": pb_lo,
            "pullback_zone_hi": pb_hi,
            "breakout": brk,
            "target1":  t1,
            "target2":  t2,
            "stop":     stop,
        }
    if bias == "short":
        # Measured move: distance price has traveled below MA20
        measured_move = ma20 - last if last < ma20 else last * 0.02  # min 2% if price at/above MA20
        measured_move = max(measured_move, last * 0.01)  # floor: at least 1% of price
        brk  = round(last * 0.995, 2)    # 0.5% below current — breakdown confirmation level
        t1   = round(last - measured_move * 0.5, 2)  # half measured move extension
        t2   = round(last - measured_move * 1.0, 2)  # full measured move extension
        stop = round(ma20 * 1.02, 2)                # 2% above MA20 — structural resistance with volatility buffer
        pb_lo = round(ma20 * 0.99, 2)
        pb_hi = round(ma20 * 1.01, 2)
        if not (t1 < last):
            log.warning("_compute_exec_levels: target1 %s >= last %s for short bias; returning defaults", t1, last)
            return _exec_levels_fallback(last)
        if not (t2 < t1):
            log.warning("_compute_exec_levels: target2 %s >= target1 %s for short bias; returning defaults", t2, t1)
            return _exec_levels_fallback(last)
        if not (stop > last):
            log.warning("_compute_exec_levels: stop %s <= last %s for short bias; returning defaults", stop, last)
            return _exec_levels_fallback(last)
        return {
            "pullback_zone_lo": pb_lo,
            "pullback_zone_hi": pb_hi,
            "breakout": brk,
            "target1":  t1,
            "target2":  t2,
            "stop":     stop,
        }
    return {}


def _compute_exit_rules(
    exec_levels: dict,
    ma20: float,
    bias: Optional[str],
    entry_quality: str,
    risk_level: str,
) -> list[dict]:
    """
    Return a list of concrete, price-specific exit rules for the current setup.
    Each rule has: trigger, price (float), action, note.

    Rules are ordered by priority: partial profit → full profit → trailing guard →
    stop loss. All prices come from exec_levels so they are consistent with the
    execution map the trader sees.
    """
    if not exec_levels or bias not in ("long", "short"):
        return []

    t1   = exec_levels.get("target1")
    t2   = exec_levels.get("target2")
    brk  = exec_levels.get("breakout")
    stop = exec_levels.get("stop")

    if t1 is None or t2 is None or brk is None or stop is None:
        return []

    rules: list[dict] = []

    # Whether trader should be watching for entry or already positioned.
    # GOOD_ENTRY / CAUTION_ENTRY → position may already be open.
    # WAIT / BAD → not yet in.
    already_in = entry_quality in ("GOOD_ENTRY", "CAUTION_ENTRY")

    if bias == "long":
        entry_label = f"${brk:.2f}" if not already_in else "entry level"

        rules.append({
            "trigger": "Target 1 reached",
            "price":   t1,
            "action":  "Sell ½ position",
            "note":    f"Lock in partial profit, move stop to {entry_label} (breakeven)",
            "type":    "t1",
        })
        rules.append({
            "trigger": "Target 2 reached",
            "price":   t2,
            "action":  "Sell remaining ½",
            "note":    "Full exit — trade complete",
            "type":    "t2",
        })
        rules.append({
            "trigger": "Price closes below MA20",
            "price":   round(ma20, 2),
            "action":  "Exit full position",
            "note":    "Trend structure broken — do not hold through",
            "type":    "stop",
        })
        if risk_level in ("HIGH", "VERY_HIGH"):
            rules.append({
                "trigger": "Price stalls at Target 1 (no momentum)",
                "price":   t1,
                "action":  "Exit full position",
                "note":    "High-risk setup — take full profit at first target, don't reach for T2",
                "type":    "stop",
            })
        rules.append({
            "trigger": "Stop loss",
            "price":   stop,
            "action":  "Exit full position",
            "note":    "Capital preservation — accept the loss, protect the account",
            "type":    "stop",
        })

    else:  # short / bearish
        entry_label = f"${brk:.2f}" if not already_in else "entry level"

        rules.append({
            "trigger": "Target 1 reached",
            "price":   t1,
            "action":  "Cover ½ position",
            "note":    f"Lock in partial profit, move stop to {entry_label} (breakeven)",
            "type":    "t1",
        })
        rules.append({
            "trigger": "Target 2 reached",
            "price":   t2,
            "action":  "Cover remaining ½",
            "note":    "Full exit — trade complete",
            "type":    "t2",
        })
        rules.append({
            "trigger": "Price closes above MA20",
            "price":   round(ma20, 2),
            "action":  "Exit full position",
            "note":    "Bearish structure failed — exit immediately",
            "type":    "stop",
        })
        if risk_level in ("HIGH", "VERY_HIGH"):
            rules.append({
                "trigger": "Price stalls at Target 1 (no momentum)",
                "price":   t1,
                "action":  "Cover full position",
                "note":    "High-risk setup — take full profit at first target",
                "type":    "stop",
            })
        rules.append({
            "trigger": "Stop loss",
            "price":   stop,
            "action":  "Exit full position",
            "note":    "Capital preservation — accept the loss",
            "type":    "stop",
        })

    return rules


# ── Main scanner ──────────────────────────────────────────────────────

def run_swing_trade_scan(ticker: str, force_refresh: bool = False) -> SwingTradeScan:
    """
    Run swing-trade scan for *ticker*.

    Parameters
    ----------
    ticker        : equity symbol (case-insensitive)
    force_refresh : bypass per-ticker result cache and shared VIX cache
    """
    t = ticker.upper().strip()
    if not t or len(t) > 12:
        raise ValueError("Invalid ticker symbol.")

    # --- per-ticker scan result cache ---
    if not force_refresh:
        with _swing_scan_lock:
            entry = _swing_scan_cache.get(t)
            if entry and time.time() - entry[0] < _swing_scan_ttl():
                return entry[1]

    try:
        info = bar_cache.get_info(t, force_refresh=force_refresh)
        company = (info.get("longName") or info.get("shortName") or t)[:120]
    except Exception:
        info = {}
        company = t

    # Daily candles — via bar_cache
    try:
        raw = bar_cache.get_history(t, period="6mo", interval="1d", auto_adjust=True,
                                    force_refresh=force_refresh)
    except Exception as e:
        raise RuntimeError(f"Daily data fetch failed: {e}") from e

    if raw is None or raw.empty or len(raw) < MIN_BARS:
        raise ValueError(
            f"Not enough daily history for '{t}' "
            f"(need {MIN_BARS}+ sessions; got {len(raw) if raw is not None else 0})."
        )

    raw   = raw.sort_index().dropna(subset=["Close"])
    close = raw["Close"].astype(float)
    vol   = raw["Volume"].astype(float)

    # ── Indicators ────────────────────────────────────────────────────
    ma20_series = _sma(close, MA_FAST)
    ma50_series = _sma(close, MA_SLOW)
    ma20 = float(ma20_series.iloc[-1])
    ma50 = float(ma50_series.iloc[-1])
    last = float(close.iloc[-1])
    previous_close = float(close.iloc[-2]) if len(close) > 1 else None

    # ── Daily bar freshness check ─────────────────────────────────────
    # Yahoo's daily bar endpoint sometimes returns yesterday's close as the
    # last bar (no partial bar for today) — showing a stale price for swing
    # while day-trade and quote feeds show the current price. Detect this and
    # override `last` with regularMarketPrice from the info snapshot.
    _sw_price_stale: bool = False
    _sw_price_warning: Optional[str] = None
    try:
        from zoneinfo import ZoneInfo as _SWZI
        _today_et = pd.Timestamp.now(tz=_SWZI("America/New_York")).date()
        _last_bar_date = close.index[-1]
        if hasattr(_last_bar_date, "date"):
            _last_bar_date = _last_bar_date.date()
        elif hasattr(_last_bar_date, "to_pydatetime"):
            _last_bar_date = _last_bar_date.to_pydatetime().date()
        if _last_bar_date < _today_et:
            _rmp = info.get("regularMarketPrice")
            if _rmp and float(_rmp) > 0:
                _sw_price_stale = True
                previous_close = last
                last = float(_rmp)
                _sw_price_warning = (
                    f"Daily bar data for {t} ends {_last_bar_date} (yesterday). "
                    "Price updated from quote feed — indicators (MA, RSI, MACD) "
                    "reflect yesterday's close and will update after today's bar is available."
                )
    except Exception:
        pass

    # Guard: MA values must be finite and positive before any division.
    # Insufficient data or all-NaN close series would produce NaN here.
    if not (math.isfinite(ma20) and ma20 > 0):
        raise ValueError(
            f"MA20 is not finite for '{t}' — likely insufficient price history. "
            f"Got ma20={ma20!r}."
        )
    if not (math.isfinite(ma50) and ma50 > 0):
        raise ValueError(
            f"MA50 is not finite for '{t}' — likely insufficient price history. "
            f"Got ma50={ma50!r}."
        )

    rsi_ser = _rsi(close)
    rsi_val = float(rsi_ser.iloc[-1])

    macd_line, macd_sig, macd_hist = _macd(close)
    macd_val  = float(macd_line.iloc[-1])
    sig_val   = float(macd_sig.iloc[-1])
    hist_val  = float(macd_hist.iloc[-1])
    hist_prev = float(macd_hist.iloc[-2]) if len(macd_hist) > 1 else 0.0

    mom_pct = (
        round((last / float(close.iloc[-MOMENTUM_DAYS]) - 1.0) * 100, 3)
        if len(close) > MOMENTUM_DAYS and float(close.iloc[-MOMENTUM_DAYS]) > 0
        else 0.0
    )
    daily_change = round(last - previous_close, 4) if previous_close is not None else None
    daily_change_pct = (
        round((daily_change / previous_close) * 100, 3)
        if daily_change is not None and previous_close and previous_close > 0
        else None
    )

    vol_label, vol_ratio = _volume_trend(close, vol)
    vix_level            = _vix_last(force_refresh=force_refresh)
    session_date         = str(raw.index[-1].date()) if hasattr(raw.index[-1], "date") else str(raw.index[-1])

    # Distance metrics (MA guards above already ensured ma20/ma50 are finite and > 0)
    dist_ma20_pct = round((last / ma20 - 1.0) * 100, 2)
    dist_ma50_pct = round((last / ma50 - 1.0) * 100, 2)

    # Weekly range exhaustion — 5-session high/low window
    idx_last = raw.index[-1]
    asof_date = idx_last.date() if hasattr(idx_last, "date") else pd.Timestamp(idx_last).date()
    hv_20 = compute_hv(close, 20)
    hv_series = build_hv_series(raw, 20)
    # Chart history is intentionally separate from the six-month analysis window.
    # The engine still makes every decision from ``raw`` above; these are display
    # DTOs for the chart's Daily / Weekly / Monthly views.
    chart_raw = raw
    try:
        extended_history = bar_cache.get_history(
            t, period="2y", interval="1d", auto_adjust=True, force_refresh=force_refresh,
        )
        if extended_history is not None and not extended_history.empty:
            chart_raw = extended_history.sort_index().dropna(subset=["Close"])
    except Exception:
        pass
    chart_series_by_timeframe = {
        timeframe: build_swing_chart_timeframe_series(chart_raw, timeframe)
        for timeframe in ("Daily", "Weekly", "Monthly")
    }
    chart_series = chart_series_by_timeframe["Daily"]
    market_structure = build_swing_market_structure(raw)
    implied_iv_pct = _implied_iv_pct_from_info(info)
    implied_iv_source = "quote_info" if implied_iv_pct is not None else None
    implied_iv_expiry: Optional[str] = None
    if implied_iv_pct is None:
        implied_iv_pct, implied_iv_expiry = _implied_iv_pct_from_chain(
            t,
            last,
            asof_date,
            force_refresh=force_refresh,
        )
        if implied_iv_pct is not None:
            implied_iv_source = "option_chain_atm"
    iv_rank_opt: Optional[float] = None
    if implied_iv_pct is not None:
        iv_rank_opt = compute_iv_rank(hv_series, implied_iv_pct)
    earnings_within_days = _next_earnings_calendar_days(t, asof_date, force_refresh=force_refresh)

    # ── Market context (cached) ────────────────────────────────────────
    spy_bias, qqq_bias, market_context = _get_market_context_cached()

    # ── Scoring (unchanged from v1) ───────────────────────────────────
    body: list[str] = []
    bull = 0.0
    bear = 0.0

    # 1 · Price vs MA20 (±2 pts)
    if last > ma20:
        bull += 2.0
        body.append(f"Price above 20-day MA ({dist_ma20_pct:+.2f}% above ${ma20:.2f}).")
    else:
        bear += 2.0
        body.append(f"Price below 20-day MA ({dist_ma20_pct:+.2f}% below ${ma20:.2f}).")

    # 2 · MA trend structure (proportional to spread, detect convergence)
    ma_spread_pct = (ma20 - ma50) / ma50 * 100
    ma20_prev = float(ma20_series.iloc[-2]) if len(ma20_series) > 1 else ma20
    ma50_prev = float(ma50_series.iloc[-2]) if len(ma50_series) > 1 else ma50
    prev_spread = (ma20_prev - ma50_prev) / ma50_prev * 100
    if ma_spread_pct > 0:
        score = min(3.0, max(0.5, ma_spread_pct * 0.15))
        converging = prev_spread > ma_spread_pct * 1.05
        if converging:
            score *= 0.5
            body.append(f"MA20 > MA50 but converging (gap {ma_spread_pct:.1f}% from {prev_spread:.1f}%) — trend fading.")
        else:
            body.append(f"MA20 > MA50 by {ma_spread_pct:.1f}% — uptrend structure intact.")
        bull += score
    elif ma_spread_pct < 0:
        score = min(3.0, max(0.5, abs(ma_spread_pct) * 0.15))
        converging = abs(prev_spread) > abs(ma_spread_pct) * 1.05
        if converging:
            score *= 0.5
            body.append(f"MA20 < MA50 but converging (gap {abs(ma_spread_pct):.1f}% from {abs(prev_spread):.1f}%) — base forming.")
        else:
            body.append(f"MA20 < MA50 by {abs(ma_spread_pct):.1f}% — downtrend structure intact.")
        bear += score
    else:
        body.append(f"MA20 ≈ MA50 (both at ${ma20:.2f}) — flat structure; no trend alignment.")

    # 3 · RSI (±1.5 pts)
    rsi_note = f"RSI(14) = {rsi_val:.1f}"
    if rsi_val > RSI_OVERBOUGHT:
        body.append(f"{rsi_note} — overbought; limits STRONG GO for longs.")
    elif rsi_val < RSI_OVERSOLD:
        body.append(f"{rsi_note} — oversold; limits STRONG GO for shorts.")
    elif rsi_val >= 55:
        bull += 1.5
        body.append(f"{rsi_note} — bullish momentum zone.")
    elif rsi_val <= 45:
        bear += 1.5
        body.append(f"{rsi_note} — bearish momentum zone.")
    else:
        body.append(f"{rsi_note} — neutral range (45–55).")

    # 4 · MACD crossover / direction (±2 pts + ±0.5 histogram bonus)
    if macd_val > sig_val:
        bull += 2.0
        body.append(f"MACD ({macd_val:+.3f}) above signal ({sig_val:+.3f}) — bullish crossover.")
        if hist_val > 0 and hist_val > hist_prev:
            bull += 0.5
            body.append("MACD histogram expanding — bullish momentum accelerating.")
    else:
        bear += 2.0
        body.append(f"MACD ({macd_val:+.3f}) below signal ({sig_val:+.3f}) — bearish crossover.")
        if hist_val < hist_prev and hist_val < 0:
            bear += 0.5
            body.append("MACD histogram expanding negatively — bearish momentum accelerating.")

    # 5 · 5-day price momentum (±1 pt)
    if mom_pct >= 1.5:
        bull += 1.0
        body.append(f"5-day momentum +{mom_pct:.2f}% — short-term bullish thrust.")
    elif mom_pct <= -1.5:
        bear += 1.0
        body.append(f"5-day momentum {mom_pct:.2f}% — short-term bearish pressure.")
    else:
        body.append(f"5-day momentum {mom_pct:+.2f}% (within ±1.5% neutral band).")

    # 6 · Volume participation (±1.5 pts)
    if vol_label == "bull_expanding":
        bull += 1.5
        body.append(f"Volume expanding on up-days (ratio vs avg: {vol_ratio:.2f}×) — buyers active.")
    elif vol_label == "bear_expanding":
        bear += 1.5
        body.append(f"Volume expanding on down-days (ratio vs avg: {vol_ratio:.2f}×) — sellers active.")
    elif vol_label == "low":
        body.append(f"Below-average volume ({vol_ratio:.2f}× avg) — weak participation.")
    else:
        body.append(f"Mixed volume participation ({vol_ratio:.2f}× avg).")

    # 7 · Market context — SPY vs MA20 (±0.5 pts) + QQQ inline note
    if spy_bias in ("STRONG_BULLISH", "BULLISH"):
        bull += 0.5
        body.append(f"SPY is {spy_bias.lower().replace('_',' ')} — broad market uptrend.")
    elif spy_bias in ("STRONG_BEARISH", "BEARISH"):
        bear += 0.5
        body.append(f"SPY is {spy_bias.lower().replace('_',' ')} — broad market downtrend.")

    # 8 · VIX context (penalty + clamp)
    if vix_level is not None:
        body.append(f"VIX ≈ {vix_level:.1f}.")
        if vix_level >= VIX_CAUTION:
            bull -= 0.5
            bear -= 0.5
            body.append("Elevated VIX — wider overnight swings; size conservatively.")
            bull = max(0.0, bull)
            bear = max(0.0, bear)

    # ── Extension checks (aligned with decision layer) ─────────────────
    if bull > bear:
        _is_very_extended = mom_pct > EXT_5D_HARD
        _is_extended = not _is_very_extended and (mom_pct > EXT_5D_WARN or dist_ma20_pct > EXT_MA20_WARN or rsi_val > RSI_OB_WARN)
    elif bear > bull:
        _is_very_extended = mom_pct < -EXT_5D_HARD
        _is_extended = not _is_very_extended and (mom_pct < -EXT_5D_WARN or dist_ma20_pct < -EXT_MA20_WARN or rsi_val < RSI_OS_WARN)
    else:
        _is_very_extended = False
        _is_extended = False

    # ── Unified verdict via resolve_verdict ─────────────────────────────
    raw_score = max(bull, bear)
    verdict = resolve_verdict("swing", raw_score, vix=vix_level, rvol=vol_ratio, volume_spike=False).value
    _prefix_strong = False  # set True when prefix logic determines STRONG GO alignment

    # ── Bias + prefix (human-readable reasons, not verdict override) ────
    diff       = bull - bear
    bias: Bias = None
    soft_edge  = max(bull, bear) >= GO_THRESHOLD and abs(diff) >= MARGIN_GO
    long_edge  = soft_edge and diff > 0
    short_edge = soft_edge and diff < 0

    if vix_level is not None and vix_level >= VIX_NO_GO:
        prefix  = [f"VIX very high ({vix_level:.0f}) — avoid new multi-day swing exposure."]

    elif not soft_edge:
        prefix  = ["No clear swing edge — signals conflicting or scores insufficient."]

    elif long_edge:
        bias = "long"
        rsi_extended = rsi_val > RSI_OVERBOUGHT
        if _is_very_extended:
            prefix = [
                f"AVOID — {mom_pct:+.1f}% in 5d — very extended, avoid chase.",
                "Long-bias context (stock long, long calls, short puts).",
            ]
        elif rsi_extended or _is_extended:
            details = []
            if rsi_extended:
                details.append(f"RSI {rsi_val:.0f} is extended")
            if _is_extended:
                parts = []
                if mom_pct > EXT_5D_WARN:
                    parts.append(f"5d momentum {mom_pct:+.1f}%")
                if dist_ma20_pct > EXT_MA20_WARN:
                    parts.append(f"price {dist_ma20_pct:.1f}% above MA20")
                if rsi_val > RSI_OB_WARN and not rsi_extended:
                    parts.append(f"RSI {rsi_val:.0f}")
                details.append("; ".join(parts) + " — extended")
            prefix = [
                f"WATCH — setup is technically bullish but {'; '.join(details)}; "
                "wait for a pullback / consolidation before entry.",
                "Long-bias context (stock long, long calls, short puts).",
            ]
        else:
            strong_ok = bull >= STRONG_THRESHOLD and abs(diff) >= STRONG_DIFF
            if strong_ok:
                _prefix_strong = True
                prefix  = [
                    "STRONG GO — multiple daily signals aligning: trend structure, momentum, "
                    "and volume confirm the directional thesis.",
                    "Long-bias context (stock long, long calls, short puts).",
                ]
            else:
                prefix  = [
                    "GO — solid multi-day setup with edge; manage gap-risk and earnings "
                    "dates before sizing up.",
                    "Long-bias context (stock long, long calls, short puts).",
                ]

    elif short_edge:
        bias = "short"
        rsi_extended = rsi_val < RSI_OVERSOLD
        if _is_very_extended:
            prefix = [
                f"AVOID — {mom_pct:+.1f}% in 5d — very extended, avoid chase.",
                "Short-bias context (stock short, long puts, short calls).",
            ]
        elif rsi_extended or _is_extended:
            details = []
            if rsi_extended:
                details.append(f"RSI {rsi_val:.0f} is oversold")
            if _is_extended:
                parts = []
                if mom_pct < -EXT_5D_WARN:
                    parts.append(f"5d momentum {mom_pct:+.1f}%")
                if dist_ma20_pct < -EXT_MA20_WARN:
                    parts.append(f"price {dist_ma20_pct:.1f}% below MA20")
                if rsi_val < RSI_OS_WARN and not rsi_extended:
                    parts.append(f"RSI {rsi_val:.0f}")
                details.append("; ".join(parts) + " — extended")
            prefix = [
                f"WATCH — setup is technically bearish but {'; '.join(details)}; "
                "short squeeze risk elevated — wait for a bounce to fail.",
                "Short-bias context (stock short, long puts, short calls).",
            ]
        else:
            strong_ok = bear >= STRONG_THRESHOLD and abs(diff) >= STRONG_DIFF
            if strong_ok:
                _prefix_strong = True
                prefix  = [
                    "STRONG GO — bearish stack confirmed: trend, momentum, and volume "
                    "align for a multi-day move.",
                    "Short-bias context (stock short, long puts, short calls).",
                ]
            else:
                prefix  = [
                    "GO — bearish edge present; watch for sharp bounces and news catalysts.",
                    "Short-bias context (stock short, long puts, short calls).",
                ]

    else:
        prefix  = ["No clear swing edge — scores too close or too low."]

    # ── Verdict/prefix consistency — upgrade GO → STRONG_GO when prefix says STRONG GO ──
    if _prefix_strong and verdict == "GO":
        verdict = "STRONG_GO"

    # ── Confidence block (v1 metadata) ────────────────────────────────
    ma_aligned   = (ma20 > ma50) if (bias == "long" or (bias is None and bull > bear)) else (ma20 < ma50)
    macd_aligned = (macd_val > sig_val) if (bias == "long" or (bias is None and bull > bear)) else (macd_val < sig_val)

    conf = _confidence_block(
        ma_aligned=ma_aligned,
        rsi_val=rsi_val,
        macd_aligned=macd_aligned,
        vol_label=vol_label,
        bias=bias,
        vix_level=vix_level,
        verdict=verdict,
    )

    reasons = prefix + body

    # Weekly range exhaustion — uses final scored bias ("long"/"short"), not MA proxy
    _week_bars = min(5, len(raw))
    _week_high = float(raw["High"].iloc[-_week_bars:].max())
    _week_low  = float(raw["Low"].iloc[-_week_bars:].min())
    _week_span = _week_high - _week_low
    if _week_span > 0:
        if bias == "long":
            _weekly_range_used_pct = round((last - _week_low) / _week_span * 100, 1)
        elif bias == "short":
            _weekly_range_used_pct = round((_week_high - last) / _week_span * 100, 1)
        else:
            _weekly_range_used_pct = round(abs(last - (_week_low + _week_span / 2)) / (_week_span / 2) * 50, 1)
        _weekly_range_used_pct = max(0.0, min(100.0, _weekly_range_used_pct))
    else:
        _weekly_range_used_pct = 0.0
    if _weekly_range_used_pct >= 70:
        _weekly_range_phase = "EXTENDED"
    elif _weekly_range_used_pct >= 50:
        _weekly_range_phase = "LATE"
    elif _weekly_range_used_pct >= 30:
        _weekly_range_phase = "MID"
    else:
        _weekly_range_phase = "EARLY"

    timing_layer = _trend_entry_timing_layer(
        raw=raw,
        last=last,
        ma20=ma20,
        ma50=ma50,
        rsi_val=rsi_val,
        macd_val=macd_val,
        sig_val=sig_val,
        hv_20=hv_20,
        vol_label=vol_label,
        vol_ratio=vol_ratio,
        market_context=market_context,
        bias=bias,
        bull_score=round(bull, 2),
        bear_score=round(bear, 2),
    )

    metrics = {
        "session_date":    session_date,
        "bars_used":       len(raw),
        "last_price":      round(last, 4),
        "prev_close":      round(previous_close, 4) if previous_close is not None else None,
        "daily_change":   daily_change,
        "daily_change_pct": daily_change_pct,
        "price_stale":     _sw_price_stale,
        "price_warning":   _sw_price_warning,
        "ma20":            round(ma20, 4),
        "ma50":            round(ma50, 4),
        "dist_ma20_pct":   dist_ma20_pct,
        "dist_ma50_pct":   dist_ma50_pct,
        "rsi":             round(rsi_val, 2),
        "macd":            round(macd_val, 4),
        "macd_signal":     round(sig_val, 4),
        "macd_histogram":  round(hist_val, 4),
        "momentum_5d_pct": mom_pct,
        "volume_label":    vol_label,
        "volume_ratio":    round(vol_ratio, 2),
        "spy_bias":        spy_bias,
        "qqq_bias":        qqq_bias,
        "market_context":  market_context,
        "vix":             vix_level,
        "confidence":      conf,
        "hv_20":           hv_20,
        "implied_iv_pct":  implied_iv_pct,
        "implied_iv_source": implied_iv_source,
        "implied_iv_expiry": implied_iv_expiry,
        "iv_rank_hv_proxy": iv_rank_opt,
        "earnings_calendar_days_until": earnings_within_days,
        "chart_series": chart_series,
        "chart_series_by_timeframe": chart_series_by_timeframe,
        "market_structure": market_structure,
        "weekly_range_used_pct": _weekly_range_used_pct,
        "weekly_range_phase":    _weekly_range_phase,
        "trend_direction": timing_layer["direction"],
        "trend_score": timing_layer["trend_score"],
        "entry_quality_score": timing_layer["entry_quality_score"],
        "bounce_risk": timing_layer["bounce_risk"],
        "extension_score": timing_layer["extension_score"],
        "extension_label": timing_layer["extension_label"],
        "trend_stage": timing_layer["trend_stage"],
        "preferred_entry_trigger": timing_layer["preferred_entry_trigger"],
        "trade_timing_verdict": timing_layer["trade_timing_verdict"],
        "trend_entry_why": timing_layer["why"],
    }

    # ── Option liquidity score (activates LOW_OPTION_LIQUIDITY gate) ──
    option_liquidity_score = _compute_option_liquidity_score(t, last)

    # ── Decision Quality Layer ─────────────────────────────────────────
    decision = build_swing_trade_decision(
        ticker=t,
        bull_score=round(bull, 2),
        bear_score=round(bear, 2),
        market_context=market_context,
        rsi_val=rsi_val,
        dist_ma20_pct=dist_ma20_pct,
        dist_ma50_pct=dist_ma50_pct,
        mom_5d_pct=mom_pct,
        vix_level=vix_level,
        vol_ratio=vol_ratio,
        vol_label=vol_label,
        earnings_within_days=earnings_within_days,
        iv_rank=iv_rank_opt,
        option_liquidity_score=option_liquidity_score,
        near_resistance=None,
        gap_percent=None,
    )

    timing_trend_score = float(timing_layer.get("trend_score") or 0.0)
    timing_entry_score = float(timing_layer.get("entry_quality_score") or 0.0)
    timing_bounce_risk = str(timing_layer.get("bounce_risk") or "")
    timing_stage = str(timing_layer.get("trend_stage") or "")
    timing_is_late = (
        timing_entry_score < 50
        or timing_bounce_risk in ("High", "Extreme")
        or timing_stage in ("Extended Decline", "Extended Advance", "Reversal Risk")
        or (timing_entry_score < 60 and timing_stage in ("No Trade Zone",))
    )
    if (
        timing_trend_score >= 75
        and timing_is_late
        and decision["final_action"] in ("STRONG_GO", "GO", "GO_SMALL")
    ):
        decision["entry_quality"] = "LATE_ENTRY"
        decision["final_action"] = "WAIT_PULLBACK"
        decision["decision_label"] = "DIRECTION_VALID_TIMING_LATE"
        decision["confirmation_needed"] = list(dict.fromkeys(
            list(decision.get("confirmation_needed") or [])
            + list(timing_layer.get("preferred_entry_trigger") or [])
        ))
        decision["decision_message"] = (
            f"{t} direction is valid, but timing is late. "
            f"Trend score {int(timing_trend_score)}/100; entry quality {int(timing_entry_score)}/100; "
            f"bounce risk {timing_bounce_risk}. Wait for a better entry trigger."
        )
        decision["avoid_reason"] = "Direction is right, but current entry is extended or vulnerable to a bounce."
        decision["entry_recommendation_state"] = "PULLBACK_PREFERRED"
        decision["should_enter_now"] = "NO"
        decision["entry_quality_label"] = "Direction valid, timing late"
        decision["pullback_probability"] = "HIGH" if timing_bounce_risk in ("High", "Extreme") else "MODERATE"
        decision["pullback_probability_reason"] = str(timing_layer.get("trade_timing_verdict") or "")
        triggers = list(timing_layer.get("preferred_entry_trigger") or [])
        decision["entry_decision"] = {
            "conservative": triggers[0] if triggers else "Wait for a pullback/retest before entry.",
            "aggressive": triggers[1] if len(triggers) > 1 else "Enter only on fresh breakdown/breakout with volume.",
            "best_setup": triggers[0] if triggers else "Wait for cleaner entry timing.",
        }
        decision["contextual_alerts"] = list(decision.get("contextual_alerts") or []) + [{
            "type": "TIMING_LATE",
            "message": str(timing_layer.get("trade_timing_verdict") or "Direction valid, timing late."),
            "condition": triggers[0] if triggers else "Wait for a better entry trigger.",
        }]

    # Reconcile: if decision layer forces no-trade or wait (hard gate like option
    # liquidity, imminent earnings, or no clean entry trigger), scoring-only
    # "GO"/"STRONG GO" would contradict entry_quality="BAD_ENTRY"/"NO_CLEAN_ENTRY"
    # — clamp to "WATCH" so downstream consumers don't act on a conflicting GO signal.
    if (
        decision["entry_quality"] in ("BAD_ENTRY", "NO_CLEAN_ENTRY")
        and decision["final_action"] not in ("STRONG_GO", "GO", "GO_SMALL")
    ):
        if verdict not in ("NO-GO", "WAIT"):
            verdict = "WATCH"

    playbook_hint = compute_playbook_hint(
        bias=bias,
        verdict=verdict,
        rsi_val=rsi_val,
        decision=decision,
        iv_rank=iv_rank_opt,
        implied_iv_pct=implied_iv_pct,
        hv_20=hv_20,
        earnings_days=earnings_within_days,
    )
    metrics["playbook_hint"] = playbook_hint
    for guid_key in ("entry_recommendation_state", "market_phase", "pullback_probability",
                     "pullback_probability_reason", "entry_quality_label", "trend_quality",
                     "rr_quality", "execution_personality", "should_enter_now",
                     "entry_decision", "contextual_alerts"):
        if guid_key in decision:
            metrics[guid_key] = decision[guid_key]

    # Execution levels (backend-computed, replaces frontend computeExecLevels)
    exec_levels = _compute_exec_levels(
        last=last, ma20=ma20, mom_5d_pct=mom_pct, bias=bias,
    )
    metrics["exec_levels"] = exec_levels

    # Option spread entry suggestion (strikes, expiry, debit, breakeven)
    metrics["spread_entry"] = _suggest_spread_entry(
        ticker=t,
        strategy=decision["suggested_strategy"],
        exec_levels=exec_levels,
        recommended_contract_duration=decision.get("recommended_contract_duration", ""),
    )

    # Structured exit rules — price-specific, ordered by priority
    metrics["exit_rules"] = _compute_exit_rules(
        exec_levels=exec_levels,
        ma20=ma20,
        bias=bias,
        entry_quality=decision["entry_quality"],
        risk_level=decision["risk_level"],
    )
    professional_decision = _build_swing_professional_decision(
        ticker=t,
        decision=decision,
        metrics=metrics,
        reasons=reasons,
        market_structure=market_structure,
        exec_levels=exec_levels,
        playbook_hint=playbook_hint,
    )

    scan = SwingTradeScan(
        ticker=t,
        company_name=company,
        verdict=verdict,
        raw_score=round(raw_score, 2),
        bias=bias,
        bull_score=round(bull, 2),
        bear_score=round(bear, 2),
        reasons=reasons,
        metrics=metrics,
        # Decision quality fields
        swing_bias=decision["swing_bias"],
        entry_quality=decision["entry_quality"],
        risk_level=decision["risk_level"],
        final_action=decision["final_action"],
        trade_quality_score=decision["trade_quality_score"],
        decision_label=decision["decision_label"],
        decision_message=decision["decision_message"],
        risk_flags=decision["risk_flags"],
        confirmation_needed=decision["confirmation_needed"],
        suggested_expiry_window=decision["suggested_expiry_window"],
        suggested_strategy=decision["suggested_strategy"],
        avoid_reason=decision["avoid_reason"],
        playbook_hint=playbook_hint,
        expected_holding_period=decision.get("expected_holding_period", ""),
        recommended_contract_duration=decision.get("recommended_contract_duration", ""),
        professional_decision=professional_decision,
    )
    # Validate scan invariants before caching
    _issues = _validate_swing_scan(scan)
    if _issues:
        log.error("SwingTradeScan invariant violation for %s: %s", t, _issues)
    else:
        with _swing_scan_lock:
            _swing_scan_cache[t] = (time.time(), scan)
    return scan
