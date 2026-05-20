"""
Intraday day-trade signal prototype using Yahoo 1m bars + market context.
Not execution advice — research / educational scoring.

All Yahoo Finance data is routed through bar_cache — no direct yf calls.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
import math
import threading
import time

log = logging.getLogger(__name__)

from typing import Any, Dict, Literal, Optional, Tuple

import numpy as np
import pandas as pd
from zoneinfo import ZoneInfo

import bar_cache
from day_option_risk import build_day_option_risk_context
from trader_decision import build_trader_decision

ET = ZoneInfo("America/New_York")

# ---------------------------------------------------------------------------
# Per-ticker scan result cache (bar_cache handles bar-level caching)
# ---------------------------------------------------------------------------
_SCAN_CACHE_TTL_MARKET = 60   # per-ticker scan result during market hours
_SCAN_CACHE_TTL_OFF    = 600  # per-ticker scan result off hours

_scan_cache: Dict[str, Tuple[float, "DayTradeScan"]] = {}
_scan_lock  = threading.Lock()


def clear_scan_cache() -> int:
    """Wipe the day-trade scan result cache. Returns number of entries cleared."""
    with _scan_lock:
        n = len(_scan_cache)
        _scan_cache.clear()
    return n


def _scan_cache_ttl() -> int:
    from datetime import datetime as _dt
    from zoneinfo import ZoneInfo as _ZI
    dt = _dt.fromtimestamp(time.time(), tz=_ZI("America/New_York"))
    if dt.weekday() >= 5:
        return _SCAN_CACHE_TTL_OFF
    minutes = dt.hour * 60 + dt.minute
    in_market = 9 * 60 + 30 <= minutes < 16 * 60
    return _SCAN_CACHE_TTL_MARKET if in_market else _SCAN_CACHE_TTL_OFF

Verdict = Literal["STRONG GO", "GO", "WATCH", "NO-GO", "WAIT"]
Bias = Optional[Literal["long", "short"]]

OR_MINUTES = 15  # opening range = first 15 × 1m bars of RTH
MIN_BARS = 25
# Need a directional edge vs the other side — slightly relaxed vs original 5 / 3
# now that RS and market context contribute more asymmetrically.
GO_THRESHOLD = 4.5
MARGIN_GO = 2.75
STRONG_BULL = 7.0
STRONG_DIFF = 4.0
VIX_NO_GO = 40.0
VIX_CAUTION = 30.0
# Last bar vs typical mid-session liquidity (excluding OR burst and excluding last bar).
VOL_SPIKE_MIN_STEADY = 5
VOL_SPIKE_RATIO = 1.55
# VWAP band: distance within this % of price is "at VWAP" — not a confirmed hold or rejection.
# Scores inside the band are distance-proportional (0–1.0) rather than the full 2.0 bonus.
VWAP_BAND_PCT = 0.15
# OR width thresholds (or_high - or_low) / or_low × 100
OR_NARROW_PCT  = 0.40   # below → coiling; breakout bonus amplified
OR_WIDE_PCT    = 1.50   # above → chaotic open; caution flag
# Pre-market gap thresholds (abs % vs prior close)
GAP_SIGNIFICANT_PCT = 1.0   # gap ≥ 1% triggers directional score
GAP_FILL_PROXIMITY  = 0.20  # within 0.20% of prior close = gap filling
# RVOL: cumulative session volume vs expected (time-adjusted average daily volume)
RVOL_HIGH  = 2.5
RVOL_ELEV  = 1.5
# Macro VWAP slope window (bars) — longer than the micro 15-bar window
VWAP_MACRO_BARS = 60
# Session time buckets (minutes from 9:30 open)
SESSION_OPENING_END   =  30   # 9:30–10:00
SESSION_MID_AM_END    = 120   # 10:00–11:30
SESSION_MIDDAY_END    = 330   # 11:30–15:00
SESSION_POWER_HOUR    = 330   # 15:00–15:50 ET
SESSION_EOD_CLOSING   = 380   # 15:50–16:00 ET (last 10 minutes — exit only)


@dataclass
class DayTradeScan:
    ticker: str
    company_name: str
    verdict: Verdict
    bias: Bias
    bull_score: float
    bear_score: float
    reasons: list[str]
    metrics: dict[str, Any]
    trader_decision: dict[str, Any]
    entry_guidance: dict[str, Any]
    option_risk_context: dict[str, Any]


def _ensure_et_index(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or df.empty:
        return df
    out = df.copy()
    idx = out.index
    if idx.tz is None:
        out.index = idx.tz_localize("UTC").tz_convert(ET)
    else:
        out.index = idx.tz_convert(ET)
    return out


def _last_session_rth(df_et: pd.DataFrame) -> tuple[pd.DataFrame, str]:
    """Most recent calendar day in data with RTH 9:30–16:00 ET bars."""
    if df_et.empty:
        return df_et, ""
    df_et = df_et.sort_index()
    rth = df_et.between_time("09:30", "15:59")
    if rth.empty:
        return rth, ""
    days = rth.index.normalize().unique().sort_values()
    last_day = days[-1]
    day_mask = rth.index.normalize() == last_day
    session = rth.loc[day_mask]
    session_date = str(last_day.date())
    return session, session_date


def _rth_session_on_date(df_et: pd.DataFrame, session_date: str) -> pd.DataFrame:
    """RTH bars for a specific calendar date string (YYYY-MM-DD), ET."""
    rth = df_et.between_time("09:30", "15:59")
    if rth.empty:
        return rth
    day = pd.Timestamp(session_date).tz_localize(ET).normalize()
    sub = rth.loc[rth.index.normalize() == day]
    return sub.sort_index()


def _intraday_session_return_pct(session: pd.DataFrame) -> Optional[float]:
    if session is None or session.empty or len(session) < 2:
        return None
    try:
        o = float(session["Open"].iloc[0]) if "Open" in session.columns else float(session["Close"].iloc[0])
        c = float(session["Close"].iloc[-1])
        if o <= 0:
            return None
        return round((c / o - 1.0) * 100.0, 3)
    except Exception:
        return None


def _compute_vwap(session: pd.DataFrame) -> pd.Series:
    """Session VWAP — zero-volume bars contribute 0 to cumulative sums."""
    h, l, c = session["High"], session["Low"], session["Close"]
    v = session["Volume"].astype(float).clip(lower=0)
    tp = (h + l + c) / 3.0
    cum_tp_v = (tp * v).cumsum()
    cum_v = v.cumsum()
    with np.errstate(divide="ignore", invalid="ignore"):
        numer = cum_tp_v.to_numpy(dtype=float)
        denom = cum_v.to_numpy(dtype=float)
        raw = np.where(denom > 0, numer / denom, np.nan)
    out = pd.Series(raw, index=session.index, dtype=float)
    out = out.replace([np.inf, -np.inf], np.nan)
    out = out.bfill().ffill()
    if out.isna().all() or len(out) == 0:
        return tp.astype(float)
    return out


def _finite_price(x: float, fallback: float) -> float:
    if not isinstance(x, (int, float)):
        return fallback
    if not math.isfinite(float(x)):
        return fallback
    return float(x)


def _info_opt_float(info: dict[str, Any], key: str) -> Optional[float]:
    """Safely coerce yfinance ``info`` field to finite float."""
    raw = info.get(key)
    if raw is None:
        return None
    try:
        x = float(raw)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


def _spy_daily_trend(force_refresh: bool = False) -> dict:
    """SPY daily trend context: pct_change, rsi, ma50_slope."""
    ctx: dict = {"pct": None, "rsi": None, "ma50_slope": None}
    try:
        h = bar_cache.get_history("SPY", period="4mo", interval="1d", force_refresh=force_refresh)
        if h is None or len(h) < 60:
            return ctx
        close = h["Close"].astype(float).sort_index()
        last_c = float(close.iloc[-1])
        prev_c = float(close.iloc[-2]) if len(close) > 1 else last_c
        ctx["pct"] = round((last_c / prev_c - 1.0) * 100, 3) if prev_c > 0 else 0.0
        delta = close.diff()
        gain = delta.clip(lower=0.0)
        loss = (-delta).clip(lower=0.0)
        avg_g = gain.ewm(com=13, adjust=False).mean()
        avg_l = loss.ewm(com=13, adjust=False).mean()
        rs = avg_g / avg_l.replace(0, 1e-10)
        rsi_ser = 100.0 - 100.0 / (1.0 + rs)
        ctx["rsi"] = round(float(rsi_ser.iloc[-1]), 1)
        ma50 = close.rolling(50).mean()
        ma50_now = float(ma50.iloc[-1])
        ma50_10ago = float(ma50.iloc[-11]) if len(ma50) >= 11 else ma50_now
        ctx["ma50_slope"] = round((ma50_now - ma50_10ago) / ma50_10ago * 100, 4) if ma50_10ago > 0 else 0.0
    except Exception:
        pass
    return ctx


def _index_change_pct(sym: str, force_refresh: bool = False) -> Optional[float]:
    """Session-to-session % change for an index ticker, via bar_cache."""
    try:
        h = bar_cache.get_history(sym, period="5d", interval="1d", force_refresh=force_refresh)
        if h is None or len(h) < 2:
            return None
        a = float(h["Close"].iloc[-2])
        b = float(h["Close"].iloc[-1])
        if a <= 0:
            return None
        return round((b / a - 1.0) * 100, 3)
    except Exception:
        return None


def _vix_last(force_refresh: bool = False) -> Optional[float]:
    """Latest VIX close, via bar_cache."""
    try:
        h = bar_cache.get_history("^VIX", period="5d", interval="1d", force_refresh=force_refresh)
        if h is None or h.empty:
            return None
        return round(float(h["Close"].iloc[-1]), 2)
    except Exception:
        return None


def _qqq_session_for_date(session_date: str, force_refresh: bool = False) -> pd.DataFrame:
    """QQQ 1m RTH bars for session_date, via bar_cache."""
    try:
        raw = bar_cache.get_history("QQQ", period="5d", interval="1m", auto_adjust=True,
                                    force_refresh=force_refresh)
        if raw is None or raw.empty:
            return pd.DataFrame()
        df_et = _ensure_et_index(raw)
        return _rth_session_on_date(df_et, session_date)
    except Exception:
        return pd.DataFrame()


def _index_session_for_date(sym: str, session_date: str, force_refresh: bool = False) -> pd.DataFrame:
    """1m RTH bars for index *sym* on session_date, via bar_cache."""
    try:
        raw = bar_cache.get_history(sym, period="5d", interval="1m", auto_adjust=True,
                                    force_refresh=force_refresh)
        if raw is None or raw.empty:
            return pd.DataFrame()
        df_et = _ensure_et_index(raw)
        return _rth_session_on_date(df_et, session_date)
    except Exception:
        return pd.DataFrame()


def _rs_vs_qqq_pct(stock_session: pd.DataFrame, qqq_session: pd.DataFrame) -> Optional[float]:
    a = _intraday_session_return_pct(stock_session)
    b = _intraday_session_return_pct(qqq_session)
    if a is None or b is None:
        return None
    return round(a - b, 3)


def _rs_label(sym: str, rs: float) -> str:
    s = sym.upper()
    if rs >= 0.25:
        return f"{s} outperforming QQQ by +{rs:.2f}% (session RTH vs QQQ session)."
    if rs <= -0.25:
        return f"{s} lagging QQQ by {rs:.2f}% (session RTH vs QQQ session)."
    return f"{s} vs QQQ: {rs:+.2f}% (within noise band)."


def _confidence_block(
    *,
    momentum_pct: float,
    or_state: str,
    vol_spike: bool,
    bias: Bias,
    spy_chg: Optional[float],
    qqq_chg: Optional[float],
    vix_level: Optional[float],
    verdict: str,
    rvol: Optional[float] = None,
) -> dict[str, str]:
    # Trend strength
    m = abs(momentum_pct)
    if m >= 0.20:
        trend_strength = "HIGH"
    elif m >= 0.07:
        trend_strength = "MEDIUM"
    else:
        trend_strength = "LOW"

    # Breakout quality — OR state with volume confirmation
    if or_state in ("above", "below"):
        breakout_quality = "GOOD" if vol_spike else "MODERATE"
    else:
        breakout_quality = "WEAK"

    # 4-tier volume label.
    # vol_spike (last bar ≥ 1.55× median) is the strongest local signal.
    # RVOL (cumulative session vs time-adjusted average) fills the middle tiers
    # so that 1.1–1.4× participation shows ELEVATED rather than WEAK.
    if vol_spike or (rvol is not None and rvol >= 2.0):
        volume_confirmation = "STRONG"
    elif rvol is not None and rvol >= 1.25:
        volume_confirmation = "ELEVATED"
    elif rvol is not None and rvol >= 0.75:
        volume_confirmation = "NORMAL"
    else:
        volume_confirmation = "WEAK"

    # Market alignment vs directional bias
    # Thresholds: ≥0.3% both indexes = genuinely supportive tape;
    # ≤-0.4% either = meaningfully headwind.
    market_alignment = "MEDIUM"
    if bias == "long":
        if spy_chg is not None and qqq_chg is not None:
            if spy_chg >= 0.3 and qqq_chg >= 0.3:
                market_alignment = "STRONG"
            elif spy_chg <= -0.4 or qqq_chg <= -0.4:
                market_alignment = "WEAK"
            else:
                market_alignment = "MEDIUM"
        elif spy_chg is not None and spy_chg >= 0.3:
            market_alignment = "STRONG"
    elif bias == "short":
        if spy_chg is not None and qqq_chg is not None:
            if spy_chg <= -0.3 and qqq_chg <= -0.3:
                market_alignment = "STRONG"
            elif spy_chg >= 0.4 or qqq_chg >= 0.4:
                market_alignment = "WEAK"
            else:
                market_alignment = "MEDIUM"
        elif spy_chg is not None and spy_chg <= -0.3:
            market_alignment = "STRONG"

    # Risk
    if vix_level is not None and vix_level >= 32:
        risk = "HIGH"
    elif verdict == "NO-GO":
        risk = "HIGH"
    elif verdict == "WATCH" or volume_confirmation == "WEAK":
        risk = "MEDIUM"
    elif vix_level is not None and vix_level >= 22:
        risk = "MEDIUM"
    else:
        risk = "LOW"

    return {
        "trend_strength": trend_strength,
        "breakout_quality": breakout_quality,
        "volume_confirmation": volume_confirmation,
        "market_alignment": market_alignment,
        "risk": risk,
    }


def _build_day_exit_rules(
    bias: str,
    vwap: Optional[float],
    breakout_level: Optional[float],
    scalp_target: Optional[float],
    risk_below: Optional[float],
    state: str,
    session_phase: str = "",
) -> list[dict]:
    """
    Price-specific intraday exit rules ordered by priority.
    All prices reference levels already shown in the execution map.
    """
    if not bias or bias not in ("long", "short"):
        return []

    rules: list[dict] = []

    if bias == "long":
        # Target 1 = VWAP (first profit milestone, already in position)
        if vwap is not None:
            rules.append({
                "trigger": "Target 1 — VWAP",
                "price":   round(vwap, 2),
                "action":  "Sell ½ position",
                "note":    f"Move stop to breakout level"
                            + (f" (${breakout_level:.2f})" if breakout_level else ""),
            })
        # Target 2 = scalp target (final intraday exit)
        if scalp_target is not None:
            rules.append({
                "trigger": "Target 2 — scalp target",
                "price":   scalp_target,
                "action":  "Sell remaining ½",
                "note":    "Intraday trade complete — flat before close",
            })
        # VWAP loss guard
        if vwap is not None:
            vwap_stop = round(vwap * 0.998, 2)
            rules.append({
                "trigger": "Price loses VWAP",
                "price":   vwap_stop,
                "action":  "Exit full position",
                "note":    "Intraday structure failed — do not hold through VWAP loss",
            })
        # Hard stop
        if risk_below is not None:
            rules.append({
                "trigger": "Stop loss — OR Low",
                "price":   round(risk_below, 2),
                "action":  "Exit full position",
                "note":    "Opening Range violated — accept the loss",
            })

    else:  # short
        if vwap is not None:
            rules.append({
                "trigger": "Target 1 — VWAP",
                "price":   round(vwap, 2),
                "action":  "Cover ½ position",
                "note":    f"Move stop to breakdown level"
                            + (f" (${breakout_level:.2f})" if breakout_level else ""),
            })
        if scalp_target is not None:
            rules.append({
                "trigger": "Target 2 — scalp target",
                "price":   scalp_target,
                "action":  "Cover remaining ½",
                "note":    "Intraday trade complete — flat before close",
            })
        if vwap is not None:
            vwap_stop = round(vwap * 1.002, 2)
            rules.append({
                "trigger": "Price reclaims VWAP",
                "price":   vwap_stop,
                "action":  "Exit full position",
                "note":    "Bearish structure failed — exit immediately",
            })
        if risk_below is not None:
            rules.append({
                "trigger": "Stop loss — OR High",
                "price":   round(risk_below, 2),
                "action":  "Exit full position",
                "note":    "Opening Range violated to the upside — accept the loss",
            })

    # Universal end-of-day rule — urgency increases in final phases
    if session_phase == "EOD_CLOSING":
        eod_time = "NOW — close before 4:00 PM ET"
        eod_note = "You are in the last 10 minutes — exit immediately, do not wait for a better price"
    elif session_phase == "POWER_HOUR":
        eod_time = "3:50 PM ET"
        eod_note = "Power hour entry — exit by 3:50 PM to avoid close-of-day slippage"
    else:
        eod_time = "3:55 PM ET"
        eod_note = "Never carry a day-trade position overnight"
    rules.append({
        "trigger": f"Market close ({eod_time})",
        "price":   0.0,
        "action":  "Close all intraday positions",
        "note":    eod_note,
    })

    return rules


def build_day_entry_guidance(metrics: dict, trader_decision: dict, bias: Optional[str]) -> dict:
    last_price = metrics.get("last_price")
    vwap = metrics.get("vwap")
    or_high = metrics.get("or_high")
    or_low = metrics.get("or_low")
    or_breakout  = metrics.get("or_breakout", "inside")
    or_historical = metrics.get("or_historical", "contained")
    volume_spike = bool(metrics.get("volume_spike", False))
    momentum_pct = metrics.get("momentum_pct", 0)
    bidir = str(bias or "").lower()

    confirmations = list(trader_decision.get("confirmation_needed") or [])
    or_retest = bool(metrics.get("or_retest", False))

    # Use band-aware VWAP position from metrics (already computed in run_day_trade_scan).
    vwap_pos = str(metrics.get("vwap_position") or "").lower()
    # Fallback: derive from vwap_dist_pct if position not in metrics yet.
    if vwap_pos not in ("above", "at", "below"):
        _d = float(metrics.get("vwap_dist_pct") or 0.0)
        vwap_pos = "above" if _d > VWAP_BAND_PCT else "below" if _d < -VWAP_BAND_PCT else "at"

    state = "MONITORING"
    summary = "Entry conditions are being monitored."
    action = "Review the setup before entry."
    avoid = "Standard risk management applies."

    # Bounce-scenario tier — read from metrics (computed in scoring phase)
    bounce_scenario = str(metrics.get("bounce_scenario") or "")

    if bidir == "long":
        if vwap_pos == "below":
            state = "WAIT_FOR_VWAP_HOLD"
            summary = "Strong setup, but entry should wait for VWAP hold."
            action = "Wait for price to reclaim VWAP and hold above it for confirmation."
            avoid = "Avoid entering while price is below VWAP."
        elif vwap_pos == "at":
            state = "VWAP_TEST"
            summary = "Price is testing VWAP from above \u2014 hold not yet confirmed."
            action = f"Wait for price to push through the VWAP band (\u00b1{VWAP_BAND_PCT}%) with sustained volume before entry."
            avoid = "Avoid entering at VWAP \u2014 a rejection here turns the setup bearish quickly."
        elif or_breakout == "inside":
            state = "WAIT_FOR_BREAKOUT"
            summary = "Price is inside the opening range \u2014 waiting for breakout."
            action = "Enter only after price breaks above Opening Range High with volume confirmation."
            avoid = "Do not enter while price is inside the opening range."
        elif or_retest and not volume_spike:
            state = "ENTRY_RETEST"
            summary = "OR re-test hold \u2014 price pulled back to the breakout level and is holding. High-quality continuation entry."
            action = "Enter on the re-test hold; stop just below ORH."
            avoid = "Do not enter if price closes back inside the opening range."
        elif not volume_spike and or_historical != "broke_up":
            # Volume gate: only block entry if the OR has NEVER been broken with volume.
            # If or_historical == "broke_up", the breakout already occurred and volume
            # confirmed it at some earlier bar \u2014 do not revert to WAIT_FOR_VOLUME just
            # because the current bar is quiet (end-of-day volume dry-up is normal).
            state = "WAIT_FOR_VOLUME"
            summary = "Breakout detected but volume confirmation is pending."
            action = "Wait for volume spike to confirm the breakout before entry."
            avoid = "Avoid chasing a low-volume breakout."
        else:
            state = "ENTRY_ACTIVE"
            summary = "Entry window is active. Price is above VWAP, breakout is confirmed, and momentum is supported."
            action = "Entry conditions met. Consider scaling in with defined stop."
            avoid = ""
    elif bidir == "short":
        if vwap_pos == "above":
            state = "WAIT_FOR_VWAP_BREAK"
            summary = "Bearish setup, but entry should wait for VWAP breakdown."
            action = "Wait for price to break below VWAP and hold under it for confirmation."
            avoid = "Avoid entering while price is above VWAP."
        elif vwap_pos == "at":
            state = "VWAP_TEST"
            summary = "Price is testing VWAP from below \u2014 rejection not yet confirmed."
            action = f"Wait for price to fail the VWAP band (\u00b1{VWAP_BAND_PCT}%) and roll over with volume before entry."
            avoid = "Avoid shorting at VWAP \u2014 a hold here could accelerate a squeeze."
        elif or_breakout == "inside":
            state = "WAIT_FOR_BREAKDOWN"
            summary = "Price is inside the opening range \u2014 waiting for breakdown."
            action = "Enter only after price breaks below Opening Range Low with volume confirmation."
            avoid = "Do not enter while price is inside the opening range."
        elif bounce_scenario == "no_mans_land":
            state = "WAIT_BOUNCE_LEVEL"
            summary = (
                f"Price churning between VWAP (${vwap:.2f}) and ORL (${or_low:.2f}) \u2014 "
                "no clean rejection level. Wait."
            )
            action = (
                f"Wait for price to reach and reject either VWAP (${vwap:.2f}) or ORL (${or_low:.2f}). "
                "No entry in no-man's land."
            )
            avoid = "Do not short in the middle \u2014 both VWAP and ORL are too far for a clean stop."
        elif bounce_scenario == "vwap_test":
            state = "VWAP_TEST"
            summary = (
                f"Bouncing into VWAP (${vwap:.2f}) \u2014 rejection not yet confirmed. "
                "Volume needed to validate the fade."
            )
            action = "Wait for a volume spike as price fails the VWAP band before entering PUT."
            avoid = f"Avoid shorting until VWAP rejection is confirmed with volume."
        elif not volume_spike and or_historical != "broke_down":
            # Same one-time gate logic as long side — do not revert to WAIT_FOR_VOLUME
            # once the OR breakdown has already been confirmed at an earlier bar.
            state = "WAIT_FOR_VOLUME"
            summary = "Breakdown detected but volume confirmation is pending."
            action = "Wait for volume spike to confirm the breakdown before entry."
            avoid = "Avoid chasing a low-volume breakdown."
        else:
            state = "ENTRY_ACTIVE"
            if bounce_scenario == "vwap_rejection":
                summary = (
                    f"VWAP rejection confirmed (${vwap:.2f}) \u2014 sellers stepped in before ORL. "
                    f"Valid PUT entry. Target ORL ${or_low:.2f}."
                )
                action = (
                    f"Enter PUT near ${last_price:.2f}. Stop just above VWAP ${vwap:.2f} "
                    f"(+0.2%). Target ORL ${or_low:.2f}."
                )
                avoid = (
                    f"If price reclaims VWAP (${vwap:.2f}) and holds for 1 bar \u2014 rejection failed; exit immediately."
                )
            elif bounce_scenario == "orl_rejection_retest":
                summary = (
                    f"ORL rejection confirmed (${or_low:.2f}) \u2014 strongest PUT re-entry. "
                    "Bigger target below day low."
                )
                action = (
                    f"Enter PUT near ORL ${or_low:.2f}. Stop just above ${or_low:.2f} (+0.2%). "
                    f"Target: extension below day low."
                )
                avoid = (
                    f"If price reclaims ORL (${or_low:.2f}) \u2014 setup invalidated; cut the position."
                )
            else:
                summary = "Entry window is active. Price is below VWAP, breakdown is confirmed, and momentum is supported."
                action = "Entry conditions met. Consider scaling in with defined stop."
                avoid = ""

    # State machine confirmed all entry gates — clear aspirational confirmations from trader_decision
    if state in ("ENTRY_ACTIVE", "ENTRY_RETEST"):
        confirmations = []

    session_phase = str(metrics.get("session_phase") or "")

    # EOD closing (last 10 min): hard block — no new entries regardless of setup quality.
    if session_phase == "EOD_CLOSING":
        state   = "EOD_CLOSING"
        summary = "Last 10 minutes — exit only. No new entries after 3:50 PM ET."
        action  = "Close all open positions before 4:00 PM. Do not enter new trades."
        avoid   = "Spreads widen, reversals accelerate, and there is no time to manage a bad fill."
    # Power hour: annotate but don't block — scoring already penalised; add EOD note.
    elif session_phase == "POWER_HOUR" and state in ("ENTRY_ACTIVE", "ENTRY_RETEST"):
        avoid = "Power hour entry — must exit by 3:50 PM ET. No overnight holds."

    scalp_target = None
    if last_price is not None:
        if bidir == "long":
            if bounce_scenario == "vwap_rejection_long" and vwap is not None:
                scalp_target = round(or_high, 2) if or_high else round(last_price * 1.015, 2)
            else:
                scalp_target = round(last_price * 1.015, 2)
        elif bidir == "short":
            if bounce_scenario == "vwap_rejection" and or_low is not None:
                scalp_target = round(or_low, 2)   # target: ORL from VWAP rejection
            elif bounce_scenario == "orl_rejection_retest" and or_low is not None:
                scalp_target = round(or_low * 0.985, 2)  # target: below ORL after ORL rejection
            else:
                scalp_target = round(last_price * 0.985, 2)

    pullback_zone = ""
    if vwap is not None and last_price is not None:
        lo, hi = min(vwap, last_price), max(vwap, last_price)
        pullback_zone = f"{lo:.2f}\u2013{hi:.2f}"

    # Stops \u2014 bounce scenarios use tight level-specific stops rather than full OR range
    risk_below = None
    if bidir == "long":
        if bounce_scenario == "vwap_rejection_long" and vwap is not None:
            risk_below = round(vwap * 0.998, 2)   # stop just below VWAP support
        else:
            risk_below = or_low
    elif bidir == "short":
        if bounce_scenario == "vwap_rejection" and vwap is not None:
            risk_below = round(vwap * 1.002, 2)   # stop just above VWAP rejection
        elif bounce_scenario == "orl_rejection_retest" and or_low is not None:
            risk_below = round(or_low * 1.002, 2) # stop just above ORL rejection
        else:
            risk_below = or_high

    # ── Derived execution guidance ────────────────────────────────────
    abs_mom = abs(momentum_pct) if momentum_pct else 0.0
    vwap_dist = metrics.get("vwap_dist_pct", 0.0)
    vwap_dist_abs = abs(vwap_dist) if vwap_dist else 0.0

    # Market phase
    if or_breakout != "inside" and volume_spike and abs_mom > 0.15:
        day_market_phase = "MOMENTUM_EXPANSION"
    elif or_breakout != "inside" and volume_spike:
        day_market_phase = "OPENING_RANGE_BREAKOUT"
    elif or_breakout != "inside" and not volume_spike:
        day_market_phase = "LOW_VOLUME_BREAKOUT"
    elif or_breakout == "inside":
        day_market_phase = "CONSOLIDATION"
    elif vwap_dist_abs > 0.5 and bidir == "long" and vwap_dist < 0:
        day_market_phase = "VWAP_RECLAIM_ATTEMPT"
    elif vwap_dist_abs > 0.5 and bidir == "short" and vwap_dist > 0:
        day_market_phase = "VWAP_RECLAIM_ATTEMPT"
    else:
        day_market_phase = "RANGE_BOUND"

    # Pullback probability
    pullback_score = 0
    pullback_reasons: list[str] = []
    if vwap_dist_abs > 0.3:
        pullback_score += 6
        pullback_reasons.append(f"price {vwap_dist_abs:.1f}% from VWAP")
    if abs_mom > 0.15:
        pullback_score += 7
        pullback_reasons.append("strong momentum suggests pullback risk")
    elif abs_mom > 0.08:
        pullback_score += 4
        pullback_reasons.append("elevated momentum")
    if not volume_spike:
        pullback_score += 3
    if state in ("WAIT_FOR_VWAP_HOLD", "WAIT_FOR_VWAP_BREAK"):
        pullback_score += 5
    elif state == "VWAP_TEST":
        pullback_score += 2

    if pullback_score >= 8:
        pullback_prob = "HIGH"
    elif pullback_score >= 5:
        pullback_prob = "MODERATE"
    else:
        pullback_prob = "LOW"

    # Should enter now
    if state in ("ENTRY_ACTIVE", "ENTRY_RETEST"):
        should_now = "YES"
    elif state in ("WAIT_FOR_VOLUME", "VWAP_TEST"):
        should_now = "CONDITIONAL"
    elif state == "WAIT_BOUNCE_LEVEL":
        should_now = "NO"
    else:
        should_now = "NO"

    # Execution personality
    exec_suitable: list[str] = []
    exec_not_ideal: list[str] = []
    if state == "ENTRY_RETEST":
        exec_suitable = ["pullback traders", "OR re-test specialists"]
        exec_not_ideal = ["breakout chasers", "momentum-only entries"]
    elif state == "ENTRY_ACTIVE" and volume_spike:
        exec_suitable = ["momentum scalpers", "breakout day traders"]
        exec_not_ideal = ["late-session momentum chasers", "conservative entries"]
    elif state == "ENTRY_ACTIVE":
        exec_suitable = ["active day traders"]
        exec_not_ideal = ["conservative entries"]
    elif state in ("WAIT_FOR_VOLUME",):
        exec_suitable = ["patient breakout traders"]
        exec_not_ideal = ["aggressive momentum entries"]
    elif state in ("WAIT_FOR_BREAKOUT", "WAIT_FOR_BREAKDOWN"):
        exec_suitable = ["range-breakout traders"]
        exec_not_ideal = ["scalpers", "momentum chasers"]
    elif state in ("WAIT_FOR_VWAP_HOLD", "WAIT_FOR_VWAP_BREAK"):
        exec_suitable = ["VWAP-reclaim traders"]
        exec_not_ideal = ["aggressive entries before VWAP confirmation"]
    else:
        exec_suitable = ["patient day traders"]
        exec_not_ideal = ["momentum entries"]

    # Entry decision sections
    direction_word = "bullish" if bidir == "long" else "bearish"
    if state == "ENTRY_RETEST":
        or_level = or_high if bidir == "long" else or_low
        conservative = f"Enter on the pullback to OR level ({(or_level or 0):.2f} if available) with volume hold confirmation."
        aggressive = f"Scale in now — re-test hold is active. Stop just below {(or_level or 0):.2f}." if or_level else "Scale in with stop below breakout level."
        best_setup = f"OR re-test hold — {direction_word} continuation with tight stop at breakout level."
    elif state == "ENTRY_ACTIVE":
        if bidir == "short":
            if bounce_scenario == "vwap_rejection" and vwap is not None and or_low is not None:
                conservative = (
                    f"Enter near current price (${last_price:.2f}). "
                    f"Stop just above VWAP ${vwap:.2f}. Smaller size — target is ORL ${or_low:.2f}."
                )
                aggressive = (
                    f"Scale in now at VWAP rejection (${vwap:.2f}). "
                    f"Full stop above VWAP. Target ORL ${or_low:.2f} then reassess."
                )
                best_setup = (
                    f"VWAP rejection PUT — sellers denied the bounce. "
                    f"Entry ${last_price:.2f}, stop above ${vwap:.2f}, target ORL ${or_low:.2f}."
                )
            elif bounce_scenario == "orl_rejection_retest" and or_low is not None:
                conservative = (
                    f"Enter near ORL (${or_low:.2f}) with 1-bar rejection confirmation. "
                    f"Stop just above ${or_low:.2f}. Target: new session low."
                )
                aggressive = (
                    f"Fade the ORL rejection now (${or_low:.2f}). "
                    f"Stop just above ORL. Target extension below day low."
                )
                best_setup = (
                    f"ORL retest rejection PUT — highest conviction re-entry. "
                    f"Entry near ${or_low:.2f}, tight stop, bigger target below day low."
                )
            elif vwap is not None and last_price is not None:
                conservative = f"Wait for a bounce into VWAP zone ({pullback_zone}) to fade into the short."
                aggressive = f"Continuation below ORL ({or_low:.2f}) with expanding volume." if or_low else "Continuation on breakdown momentum with expanding volume."
                best_setup = f"Bearish continuation with defined stop above recent swing high."
            else:
                conservative = "Wait for a bounce to resistance with volume rejection confirmation."
                aggressive = "Continuation on breakdown momentum follow-through with expanding volume."
                best_setup = "Bearish continuation with defined stop above recent swing high."
        else:
            if vwap is not None and last_price is not None:
                conservative = f"Wait for pullback into VWAP zone ({pullback_zone}) with volume confirmation."
            else:
                conservative = "Wait for pullback to support with volume confirmation."
            if or_high is not None:
                aggressive = f"Continuation above ORH ({or_high:.2f}) with expanding volume."
            else:
                aggressive = "Continuation on momentum follow-through with expanding volume."
            best_setup = f"{direction_word.capitalize()} continuation with defined stop below recent swing low."
    elif state in ("WAIT_FOR_VOLUME",):
        if bidir == "short":
            conservative = "Wait for volume spike to confirm the breakdown before entering."
            aggressive = "Not recommended — wait for volume to confirm directional conviction."
            best_setup = f"Breakdown below ORL ({or_low:.2f} if available) with volume spike confirmation." if or_low else "Breakdown below ORL with volume spike confirmation."
        else:
            conservative = "Wait for volume spike to confirm the breakout before entering."
            aggressive = "Not recommended — wait for volume confirmation."
            best_setup = f"Breakout above ORH ({or_high:.2f} if available) with volume spike confirmation." if or_high else "Breakout above ORH with volume spike confirmation."
    elif "VWAP" in state:
        if vwap is not None:
            if bidir == "short":
                conservative = f"Wait for price to break and hold below VWAP ({vwap:.2f})."
                aggressive = "Only below VWAP with volume expansion for short entries."
                best_setup = f"VWAP rejection with {direction_word} continuation below {vwap:.2f}."
            else:
                conservative = f"Wait for price to reclaim and hold VWAP ({vwap:.2f})."
                aggressive = "Only above VWAP with volume expansion for long entries."
                best_setup = f"Pullback to VWAP with {direction_word} continuation setup."
        else:
            conservative = "Wait for price to confirm VWAP interaction."
            aggressive = "Not recommended until VWAP direction is clear."
            best_setup = "No clear setup yet — monitor for VWAP interaction."
    else:
        if bidir == "short":
            conservative = "Wait for opening range breakdown or VWAP failure."
            aggressive = "Not recommended at current levels."
            best_setup = "No clear short setup yet."
        else:
            conservative = "Wait for opening range breakout or VWAP hold."
            aggressive = "Not recommended at current levels."
            best_setup = "No clear day trade setup yet."

    # Contextual alerts
    day_alerts: list[dict[str, str]] = []
    if state in ("ENTRY_ACTIVE", "ENTRY_RETEST") and or_high is not None:
        day_alerts.append({
            "type": "CONTINUATION_WATCH",
            "message": f"{direction_word.capitalize()} continuation above ORH ({or_high:.2f}) with volume",
            "condition": "Expanding volume on breakout above ORH",
        })
    if vwap is not None and state in ("WAIT_FOR_VWAP_HOLD", "WAIT_FOR_VWAP_BREAK"):
        side = "reclaim" if bidir == "long" else "break below"
        day_alerts.append({
            "type": "VWAP_WATCH",
            "message": f"Price {side} VWAP ({vwap:.2f}) with volume confirmation",
            "condition": "Price crosses VWAP with expanding volume",
        })
    if vwap is not None and state == "VWAP_TEST":
        hold_or_fail = "hold above" if bidir == "long" else "fail below"
        day_alerts.append({
            "type": "VWAP_TEST",
            "message": f"Price testing VWAP ({vwap:.2f}) — watch for {hold_or_fail} with volume",
            "condition": f"Price moves >{VWAP_BAND_PCT}% {'above' if bidir == 'long' else 'below'} VWAP with volume confirmation",
        })
    if not volume_spike and or_breakout != "inside":
        day_alerts.append({
            "type": "VOLUME_WATCH",
            "message": "Volume spike needed to confirm directional move",
            "condition": "Volume exceeds mid-session baseline",
        })

    # When price historically broke out but has since retraced inside OR, flag it.
    failed_breakout = (
        or_historical == "broke_up"   and or_breakout == "inside" and bidir == "long"  or
        or_historical == "broke_down" and or_breakout == "inside" and bidir == "short"
    )

    return {
        "state": state,
        "summary": summary,
        "action": action,
        "avoid": avoid,
        "failed_breakout_warning": (
            "Price broke out of the Opening Range earlier this session but has since retraced inside. "
            "Treat any re-entry with extra caution — failed breakout risk is elevated."
            if failed_breakout else None
        ),
        "pending_confirmations": confirmations,
        "current_price": last_price,
        "vwap": vwap,
        "price_vs_vwap_pct": metrics.get("vwap_dist_pct"),
        "opening_range_high": or_high,
        "opening_range_low": or_low,
        "breakout_level": or_high if bidir == "long" else or_low,
        "pullback_zone": pullback_zone,
        "risk_below": risk_below,
        "scalp_target": scalp_target,
        "exit_rules": _build_day_exit_rules(
            bias=bidir,
            vwap=vwap,
            breakout_level=or_high if bidir == "long" else or_low,
            scalp_target=scalp_target,
            risk_below=risk_below,
            state=state,
            session_phase=session_phase,
        ),
        # New execution guidance fields
        "day_market_phase": day_market_phase,
        "pullback_probability": pullback_prob,
        "should_enter_now": should_now,
        "execution_personality": {
            "suitable_for": exec_suitable,
            "not_ideal_for": exec_not_ideal,
        },
        "entry_decision": {
            "conservative": conservative,
            "aggressive": aggressive,
            "best_setup": best_setup,
        },
        "contextual_alerts": day_alerts,
    }


def run_day_trade_scan(ticker: str, force_refresh: bool = False,
                       daily_trend_context: Optional[Dict[str, str]] = None) -> DayTradeScan:
    """
    Run intraday day-trade scan for *ticker*.

    Parameters
    ----------
    ticker        : equity symbol (case-insensitive)
    force_refresh : bypass per-ticker scan cache and shared index caches
    daily_trend_context : optional dict from swing scan with "bias" and "verdict"
    """
    t = ticker.upper().strip()
    if not t or len(t) > 12:
        raise ValueError("Invalid ticker")

    # --- per-ticker scan result cache (bypass when daily context provided) ---
    if not force_refresh and daily_trend_context is None:
        with _scan_lock:
            entry = _scan_cache.get(t)
            if entry and time.time() - entry[0] < _scan_cache_ttl():
                return entry[1]

    # _fr is a local alias so the force_refresh flag is available at the call
    # sites below without needing a module-level sentinel (which would be
    # unsafe under concurrent requests).
    _fr = force_refresh

    body: list[str] = []

    try:
        info = bar_cache.get_info(t, force_refresh=_fr)
        company = (info.get("longName") or info.get("shortName") or t)[:120]
    except Exception:
        company = t
        info = {}

    try:
        raw = bar_cache.get_history(t, period="5d", interval="1m", auto_adjust=True,
                                    force_refresh=_fr)
    except Exception as e:
        raise RuntimeError(f"Intraday fetch failed: {e}") from e

    if raw is None or raw.empty or len(raw) < MIN_BARS:
        raise ValueError(f"Not enough 1-minute data for '{t}' (need a liquid US session with intraday history).")

    df_et = _ensure_et_index(raw)
    session, session_date = _last_session_rth(df_et)

    if session.empty or len(session) < MIN_BARS:
        raise ValueError(
            f"Insufficient regular-session 1m bars for '{t}' on {session_date or 'last session'} "
            "(market may be closed or symbol illiquid)."
        )

    last = float(session["Close"].iloc[-1])
    vol_ser = session["Volume"].astype(float)

    # ── Bar freshness check ───────────────────────────────────────────
    # Yahoo's 1m bar endpoint sometimes lags badly for specific tickers
    # (bars stop updating while the quote stream continues). Detect this
    # by comparing the last bar's timestamp to wall-clock time. When bars
    # are stale during market hours, override `last` with regularMarketPrice
    # from the info dict (which is a quote snapshot, not a bar) so the price
    # shown is current even if OHLCV analysis is based on lagged bars.
    _now_et = pd.Timestamp.now(tz=ET)
    _last_bar_ts: pd.Timestamp | None = None
    _bar_age_minutes: int = 0
    _bar_data_stale: bool = False
    _stale_msg: str | None = None
    try:
        _last_bar_ts = session.index[-1]
        if _last_bar_ts.tzinfo is None:
            _last_bar_ts = _last_bar_ts.tz_localize(ET)
        _bar_age_minutes = max(0, int((_now_et - _last_bar_ts).total_seconds() / 60))
    except Exception:
        _bar_age_minutes = 0

    # Stale = last bar > 5 min old AND we are inside regular market hours.
    _in_rth = (
        (_now_et.hour > 9 or (_now_et.hour == 9 and _now_et.minute >= 30))
        and _now_et.hour < 16
        and _now_et.weekday() < 5
    )
    if _in_rth and _bar_age_minutes > 5:
        _bar_data_stale = True
        # Try to use regularMarketPrice as a fresher last price.
        _rmp = info.get("regularMarketPrice")
        if _rmp and float(_rmp) > 0:
            last = float(_rmp)
        _stale_msg = (
            f"1-minute bar data for {t} is {_bar_age_minutes} min old "
            f"(last bar: {_last_bar_ts.strftime('%H:%M') if _last_bar_ts else 'unknown'} ET). "
            "Yahoo Finance is delayed for this ticker — price updated from quote feed; "
            "VWAP, OR, and momentum are based on lagged bars."
        )

    # Yahoo throttle / fetch error — bar_cache served stale data from a prior successful fetch.
    if bar_cache.was_stale(t) and not _bar_data_stale:
        _bar_data_stale = True
        _stale_msg = (
            f"Yahoo Finance returned no data for {t} — showing last known values. "
            "This usually means a temporary rate-limit or network error. Data will refresh automatically."
        )

    vwap_ser = _compute_vwap(session)
    raw_vwap = vwap_ser.iloc[-1]
    try:
        vwap_candidate = float(raw_vwap)
    except (TypeError, ValueError):
        vwap_candidate = float("nan")
    vwap_last = _finite_price(vwap_candidate, last)
    # Track whether VWAP fell back to last (meaning real VWAP was not computable).
    _vwap_is_real = math.isfinite(vwap_candidate) and vwap_candidate > 0

    n_or = min(OR_MINUTES, len(session))
    or_seg = session.iloc[:n_or]
    or_high = float(or_seg["High"].max())
    or_low  = float(or_seg["Low"].min())

    # Range extremes — used for range-span math later; kept separate from OR break logic.
    session_high = float(session["High"].max())
    session_low  = float(session["Low"].min())

    # VWAP slope — micro (15 bars) used in scoring; macro (60 bars) for trend direction.
    vwap_slope_bars = min(15, len(vwap_ser))
    if vwap_slope_bars >= 5 and _vwap_is_real:
        vwap_tail = vwap_ser.iloc[-vwap_slope_bars:].values.astype(float)
        x = np.arange(vwap_slope_bars, dtype=float)
        slope = np.polyfit(x, vwap_tail, 1)[0]
        vwap_slope_pct = round(slope / vwap_last * 100, 6)
    else:
        vwap_slope_pct = None

    macro_slope_bars = min(VWAP_MACRO_BARS, len(vwap_ser))
    if macro_slope_bars >= 20 and _vwap_is_real:
        macro_tail = vwap_ser.iloc[-macro_slope_bars:].values.astype(float)
        xm = np.arange(macro_slope_bars, dtype=float)
        macro_slope = np.polyfit(xm, macro_tail, 1)[0]
        vwap_macro_slope_pct = round(macro_slope / vwap_last * 100, 6)
    else:
        vwap_macro_slope_pct = None

    # Adaptive momentum window: early session uses shorter window to avoid open-to-now noise.
    n_bars = len(session)
    if n_bars < 60:
        mom_bars = min(15, n_bars - 1)
    elif n_bars < 180:
        mom_bars = min(30, n_bars - 1)
    else:
        mom_bars = min(45, n_bars - 1)
    c0 = float(session["Close"].iloc[-mom_bars]) if mom_bars > 0 else last
    momentum_pct = round((last / c0 - 1.0) * 100, 3) if c0 > 0 else 0.0

    # Session time phase: minutes elapsed since 9:30 open, based on last bar timestamp.
    try:
        last_ts = session.index[-1]
        open_dt = last_ts.replace(hour=9, minute=30, second=0, microsecond=0)
        session_minutes_elapsed = int((last_ts - open_dt).total_seconds() / 60)
    except Exception:
        session_minutes_elapsed = n_bars  # fallback: treat bar count as minutes
    session_minutes_elapsed = max(0, session_minutes_elapsed)

    if session_minutes_elapsed < SESSION_OPENING_END:
        session_phase = "OPENING"
    elif session_minutes_elapsed < SESSION_MID_AM_END:
        session_phase = "MID_MORNING"
    elif session_minutes_elapsed < SESSION_MIDDAY_END:
        session_phase = "MIDDAY"
    elif session_minutes_elapsed < SESSION_EOD_CLOSING:
        session_phase = "POWER_HOUR"
    else:
        session_phase = "EOD_CLOSING"

    # OR width — narrow coiling vs wide chaotic open.
    or_width_pct = round((or_high - or_low) / or_low * 100, 3) if or_low > 0 else 0.0
    if or_width_pct < OR_NARROW_PCT:
        or_width_label = "NARROW"
    elif or_width_pct > OR_WIDE_PCT:
        or_width_label = "WIDE"
    else:
        or_width_label = "NORMAL"

    # Pre-market gap vs prior close.
    prior_close = info.get("previousClose") or info.get("regularMarketPreviousClose")
    pre_mkt_p   = info.get("preMarketPrice")
    gap_pct: Optional[float] = None
    gap_fill_risk = False
    if prior_close and float(prior_close) > 0:
        open_price = float(session["Open"].iloc[0])
        gap_pct = round((open_price / float(prior_close) - 1.0) * 100, 3)
        # Gap fill: price has retraced back near prior close.
        gap_fill_risk = abs(last / float(prior_close) - 1.0) * 100 < GAP_FILL_PROXIMITY and abs(gap_pct) >= GAP_SIGNIFICANT_PCT

    # Volume spike baseline: use median (more robust than mean against mid-session bursts).
    # Computed BEFORE rvol so the synthetic fallback can use avg_vol.
    or_vol = vol_ser.iloc[:OR_MINUTES]
    steady_vol = vol_ser.iloc[OR_MINUTES:-1]
    tail_mid = (
        vol_ser.iloc[max(OR_MINUTES, len(vol_ser) // 3) :-1]
        if len(vol_ser) > OR_MINUTES + VOL_SPIKE_MIN_STEADY + 2
        else steady_vol
    )
    if len(steady_vol) >= VOL_SPIKE_MIN_STEADY:
        avg_vol = float(np.median(steady_vol.values))
    elif len(tail_mid) >= VOL_SPIKE_MIN_STEADY:
        avg_vol = float(np.median(tail_mid.values))
    elif len(or_vol) >= 5:
        avg_vol = float(np.median(or_vol.values))
    else:
        avg_vol = float(vol_ser.iloc[:-1].mean()) if len(vol_ser) > 1 else 0.0

    # OR historical breakout — requires a post-OR bar that CLOSES beyond the OR level
    # AND prints a volume spike on that same bar.  A wick or low-volume poke does not
    # qualify: the flag stays False until real participation confirms the move.
    # Fallback to price-only when avg_vol is unavailable (zero-volume edge case).
    _post_or = session.iloc[n_or:]
    if avg_vol > 0 and len(_post_or) > 0:
        _close     = _post_or["Close"].astype(float)
        _vol       = _post_or["Volume"].astype(float)
        _vol_thresh = VOL_SPIKE_RATIO * avg_vol
        or_was_broken_up   = bool(((_close > or_high) & (_vol >= _vol_thresh)).any())
        or_was_broken_down = bool(((_close < or_low)  & (_vol >= _vol_thresh)).any())
    else:
        or_was_broken_up   = session_high > or_high
        or_was_broken_down = session_low  < or_low

    # RVOL — cumulative session volume vs time-adjusted average daily volume.
    # Primary: info-based (averageVolume from Yahoo quote gives the full historical daily avg).
    # Fallback: bar-based synthetic — compares cumulative session volume to the expected
    # volume at the current session pace (median mid-session bar × elapsed minutes).
    # This ensures RVOL is never None just because Yahoo omits averageVolume from info.
    avg_daily_vol = info.get("averageVolume") or info.get("averageDailyVolume10Day")
    rvol: Optional[float] = None
    cumulative_vol = float(vol_ser.sum())
    if avg_daily_vol and float(avg_daily_vol) > 0 and session_minutes_elapsed > 0:
        # Info-based: most accurate — calibrated against the stock's own history.
        expected_vol = float(avg_daily_vol) * (session_minutes_elapsed / 390.0)
        if expected_vol > 0:
            rvol = round(cumulative_vol / expected_vol, 2)
    if rvol is None and avg_vol > 0 and session_minutes_elapsed > 0:
        # Bar-based synthetic: cumulative vs (median bar × elapsed minutes).
        # Slightly high-biased because cumulative includes OR burst; calibrated
        # against the same session so it self-corrects intraday.
        synthetic_expected = avg_vol * session_minutes_elapsed
        rvol = round(cumulative_vol / synthetic_expected, 2)

    # HH/HL (bull) / LL/LH (bear) structure over recent 5-bar swing points.
    def _swing_structure(closes: np.ndarray, window: int = 5) -> str:
        """Return 'HH_HL', 'LL_LH', 'MIXED', or 'FLAT' for recent price structure."""
        if len(closes) < window * 2 + 1:
            return "FLAT"
        highs = list(closes)
        lows  = list(closes)
        swing_highs, swing_lows = [], []
        for i in range(window, len(highs) - window):
            if highs[i] == max(highs[i - window: i + window + 1]):
                swing_highs.append(highs[i])
            if lows[i] == min(lows[i - window: i + window + 1]):
                swing_lows.append(lows[i])
        if len(swing_highs) >= 2 and len(swing_lows) >= 2:
            hh = swing_highs[-1] > swing_highs[-2]
            hl = swing_lows[-1]  > swing_lows[-2]
            ll = swing_lows[-1]  < swing_lows[-2]
            lh = swing_highs[-1] < swing_highs[-2]
            if hh and hl:
                return "HH_HL"
            if ll and lh:
                return "LL_LH"
            return "MIXED"
        return "FLAT"

    close_arr = session["Close"].values.astype(float)
    price_structure = _swing_structure(close_arr)

    # Current price position vs OR bounds (need or_state before secondary breakout check).
    if last > or_high:
        or_state = "above"
    elif last < or_low:
        or_state = "below"
    else:
        or_state = "inside"
    # Historical OR breakout flag: did price REACH outside the OR at any point,
    # even if it has since retraced back inside?
    if or_was_broken_up:
        or_historical = "broke_up"
    elif or_was_broken_down:
        or_historical = "broke_down"
    else:
        or_historical = "contained"

    # Secondary breakout detection: OR was broken earlier but price retraced, then broke again.
    _or_break_count_up   = 0
    _or_break_count_down = 0
    _in_break_up   = False
    _in_break_down = False
    for i in range(len(session)):
        c = float(session["Close"].iloc[i])
        if c > or_high and not _in_break_up:
            _in_break_up = True
            _or_break_count_up += 1
        elif c <= or_high:
            _in_break_up = False
        if c < or_low and not _in_break_down:
            _in_break_down = True
            _or_break_count_down += 1
        elif c >= or_low:
            _in_break_down = False
    secondary_breakout_up   = _or_break_count_up   >= 2 and or_state == "above"
    secondary_breakout_down = _or_break_count_down >= 2 and or_state == "below"

    v_last = float(vol_ser.iloc[-1])
    vol_spike = avg_vol > 0 and v_last >= VOL_SPIKE_RATIO * avg_vol

    # Guard: vwap_last is always finite (falls back to last), but track unreliability.
    vwap_dist_pct = round((last / vwap_last - 1.0) * 100, 3) if (math.isfinite(vwap_last) and vwap_last > 0) else 0.0
    # Three-zone VWAP position: outside ±VWAP_BAND_PCT = confirmed, inside = testing.
    if not _vwap_is_real:
        vwap_position = "unknown"
    elif vwap_dist_pct > VWAP_BAND_PCT:
        vwap_position = "above"
    elif vwap_dist_pct < -VWAP_BAND_PCT:
        vwap_position = "below"
    else:
        vwap_position = "at"

    bull = 0.0
    bear = 0.0

    if not _vwap_is_real:
        body.append("VWAP could not be computed (zero-volume session) — VWAP signals suppressed.")
    elif vwap_position == "at":
        # Inside band: no confirmed hold or rejection yet — partial, distance-proportional score.
        # Score ramps from 0.0 (right at VWAP) to 1.0 (at band edge), capped there.
        band_score = round(abs(vwap_dist_pct) / VWAP_BAND_PCT, 2)
        if vwap_dist_pct >= 0:
            bull += band_score
            body.append(
                f"Price testing VWAP from above ({vwap_dist_pct:+.2f}%) — within ±{VWAP_BAND_PCT}% band; "
                "hold not yet confirmed."
            )
        else:
            bear += band_score
            body.append(
                f"Price testing VWAP from below ({vwap_dist_pct:+.2f}%) — within ±{VWAP_BAND_PCT}% band; "
                "rejection not yet confirmed."
            )
    elif vwap_position == "above":
        base_vwap = 2.0
        if vwap_slope_pct is not None:
            if vwap_slope_pct > 0.001:
                base_vwap += 0.5
                body.append(f"Price above VWAP ({vwap_dist_pct:+.2f}%) with VWAP rising (+{vwap_slope_pct:.4f}%/bar) — confluence.")
            elif vwap_slope_pct < -0.001:
                base_vwap -= 0.5
                body.append(f"Price above VWAP ({vwap_dist_pct:+.2f}%) but VWAP declining ({vwap_slope_pct:.4f}%/bar) — divergence.")
            else:
                body.append(f"Price above VWAP ({vwap_dist_pct:+.2f}%) with flat VWAP.")
        else:
            body.append(f"Price above VWAP ({vwap_dist_pct:+.2f}%).")
        bull += base_vwap
    else:  # below
        base_vwap = 2.0
        if vwap_slope_pct is not None:
            if vwap_slope_pct < -0.001:
                base_vwap += 0.5
                body.append(f"Price below VWAP ({vwap_dist_pct:+.2f}%) with VWAP declining ({vwap_slope_pct:.4f}%/bar) — confluence.")
            elif vwap_slope_pct > 0.001:
                base_vwap -= 0.5
                body.append(f"Price below VWAP ({vwap_dist_pct:+.2f}%) but VWAP rising (+{vwap_slope_pct:.4f}%/bar) — divergence.")
            else:
                body.append(f"Price below VWAP ({vwap_dist_pct:+.2f}%) with flat VWAP.")
        else:
            body.append(f"Price below VWAP ({vwap_dist_pct:+.2f}%).")
        bear += base_vwap

    or_weight = 3.0 if vol_spike else 1.0
    if or_state == "above":
        bull += or_weight
        if vol_spike:
            body.append("Above opening-range high with volume confirmation (bullish breakout).")
        else:
            body.append("Above opening-range high — no volume confirmation; treat with caution.")
    elif or_state == "below":
        bear += or_weight
        if vol_spike:
            body.append("Below opening-range low with volume confirmation (bearish breakdown).")
        else:
            body.append("Below opening-range low — no volume confirmation; treat with caution.")
    else:
        body.append("Inside opening range (range-bound).")

    if momentum_pct > 0.12:
        bull += 1.5
        body.append(f"Short-horizon momentum +{momentum_pct:.2f}%.")
    elif momentum_pct < -0.12:
        bear += 1.5
        body.append(f"Short-horizon momentum {momentum_pct:.2f}%.")

    if vol_spike:
        if bull >= bear:
            bull += 1.5
            body.append("Volume spike confirms directional lean.")
        else:
            bear += 1.5
            body.append("Volume spike confirms directional lean.")
    else:
        body.append(
            "No volume spike vs mid-session baseline — expansion not strongly confirmed; "
            "lower conviction, higher reversal risk (e.g. gaps, headline risk)."
        )

    spy_chg   = _index_change_pct("SPY", force_refresh=_fr)
    qqq_chg   = _index_change_pct("QQQ", force_refresh=_fr)
    vix_level = _vix_last(force_refresh=_fr)

    qqq_sess = _qqq_session_for_date(session_date, force_refresh=_fr)
    spy_sess = _index_session_for_date("SPY", session_date, force_refresh=_fr)
    qqq_session_pct = _intraday_session_return_pct(qqq_sess)
    spy_session_pct = _intraday_session_return_pct(spy_sess)
    rs_vs_qqq_pct = _rs_vs_qqq_pct(session, qqq_sess)

    # RS vs QQQ — scored bidirectionally; also logged as a reason.
    # SPY/QQQ divergence guard: positive RS while BOTH indexes are down > 0.5%
    # intraday may signal a short-squeeze / isolated move rather than genuine strength.
    _both_indexes_down  = (spy_session_pct is not None and spy_session_pct <= -0.5) and \
                          (qqq_session_pct is not None and qqq_session_pct <= -0.5)
    _both_indexes_up    = (spy_session_pct is not None and spy_session_pct >= 0.5) and \
                          (qqq_session_pct is not None and qqq_session_pct >= 0.5)

    if rs_vs_qqq_pct is not None:
        body.append(_rs_label(t, rs_vs_qqq_pct))
        if rs_vs_qqq_pct >= 0.5:
            if _both_indexes_down:
                # Stock outperforming a falling market — cap the RS bonus (squeeze risk).
                bull += 0.5
                body.append(
                    f"RS vs QQQ +{rs_vs_qqq_pct:.2f}% BUT both SPY and QQQ are down intraday "
                    "— possible short-squeeze; RS bonus halved."
                )
            else:
                bull += 1.0
                body.append(f"Strong RS vs QQQ (+{rs_vs_qqq_pct:.2f}%) adds bullish weight.")
        elif rs_vs_qqq_pct <= -0.5:
            if _both_indexes_up:
                # Stock lagging a rising market — cap the RS penalty (sector rotation risk).
                bear += 0.5
                body.append(
                    f"RS vs QQQ {rs_vs_qqq_pct:.2f}% BUT both SPY and QQQ are up intraday "
                    "— possible sector rotation; RS penalty halved."
                )
            else:
                bear += 1.0
                body.append(f"Weak RS vs QQQ ({rs_vs_qqq_pct:.2f}%) adds bearish weight.")

    _spy_daily = _spy_daily_trend(force_refresh=_fr)
    _spy_rsi_ok = _spy_daily.get("rsi") is not None and 40 <= _spy_daily["rsi"] <= 70
    _spy_rsi_extreme = _spy_daily.get("rsi") is not None and _spy_daily["rsi"] > 75
    _spy_ma50_up = _spy_daily.get("ma50_slope", 0) or 0 > 0

    if spy_chg is not None and qqq_chg is not None:
        body.append(f"SPY {spy_chg:+.2f}% · QQQ {qqq_chg:+.2f}%.")
        if spy_chg >= 0.25 and qqq_chg >= 0.25:
            if _spy_ma50_up and _spy_rsi_ok:
                bull += 1.0
            elif _spy_rsi_extreme:
                body.append("SPY daily RSI overbought — rally may be exhausted.")
            else:
                bull += 0.5
        elif spy_chg <= -0.25 and qqq_chg <= -0.25:
            bear += 0.5
    else:
        if spy_chg is not None:
            body.append(f"SPY session-to-session ≈ {spy_chg:+.2f}%.")
            if spy_chg >= 0.25 and _spy_ma50_up and _spy_rsi_ok:
                bull += 1.0
            elif spy_chg <= -0.25:
                bear += 0.5
            elif spy_chg >= 0.25:
                bull += 0.5
        if qqq_chg is not None:
            body.append(f"QQQ session-to-session ≈ {qqq_chg:+.2f}%.")

    if vix_level is not None:
        body.append(f"VIX ≈ {vix_level:.1f}.")
        if vix_level >= VIX_CAUTION:
            bull -= 0.5
            bear -= 0.5
            body.append("Elevated VIX — wider swings; size down.")
            # Clamp: directional scores must not go below zero — a negative score
            # has no meaning and would inflate the diff calculation.
            bull = max(0.0, bull)
            bear = max(0.0, bear)

    # ── #8 RVOL ──────────────────────────────────────────────────────────────
    if rvol is not None:
        if rvol >= RVOL_HIGH:
            if bull >= bear:
                bull += 1.0
            else:
                bear += 1.0
            body.append(f"RVOL {rvol:.1f}× expected — unusually high participation; conviction elevated.")
        elif rvol >= RVOL_ELEV:
            if bull >= bear:
                bull += 0.5
            else:
                bear += 0.5
            body.append(f"RVOL {rvol:.1f}× expected — above-average volume for this time of day.")
        else:
            body.append(f"RVOL {rvol:.1f}× expected — volume tracking below average; lower conviction.")

    # ── #6 Pre-market gap ────────────────────────────────────────────────────
    if gap_pct is not None and abs(gap_pct) >= GAP_SIGNIFICANT_PCT:
        if gap_fill_risk:
            body.append(
                f"{'Gap up' if gap_pct > 0 else 'Gap down'} {gap_pct:+.2f}% at open but price has retraced near prior close "
                f"(${prior_close:.2f}) — gap fill in progress; avoid chasing."
            )
            if gap_pct > 0:
                bull -= 0.5
            elif gap_pct < 0:
                bear -= 0.5
        else:
            if gap_pct > 0:
                bull += 0.5
                body.append(f"Gap up {gap_pct:+.2f}% from prior close — bullish pre-market context.")
            else:
                bear += 0.5
                body.append(f"Gap down {gap_pct:.2f}% from prior close — bearish pre-market context.")

    # ── #7 OR width ──────────────────────────────────────────────────────────
    if or_width_label == "NARROW":
        body.append(
            f"Tight OR ({or_width_pct:.2f}% range) — coiling setup; breakout, if it comes, is likely sharp."
        )
        # Amplify OR breakout bonus for coiling setups (the or_weight bonus already applied above,
        # so we add an incremental bonus here only if price is already outside the OR).
        if or_state != "inside":
            if bull >= bear:
                bull += 0.5
            else:
                bear += 0.5
    elif or_width_label == "WIDE":
        body.append(
            f"Wide OR ({or_width_pct:.2f}% range) — chaotic open; breakout levels are loose, risk is elevated."
        )
        bull = max(0.0, bull - 0.25)
        bear = max(0.0, bear - 0.25)

    # ── #10 Time-of-day ──────────────────────────────────────────────────────
    if session_phase == "EOD_CLOSING":
        body.append("Last 10 minutes (≥15:50 ET) — no new entries. Exit existing positions only.")
        bull = max(0.0, bull - 1.0)
        bear = max(0.0, bear - 1.0)
    elif session_phase == "POWER_HOUR":
        body.append("Power hour (15:00–15:50 ET) — entries carry mandatory EOD exit risk; size down.")
        bull = max(0.0, bull - 0.5)
        bear = max(0.0, bear - 0.5)
    elif session_phase == "MIDDAY":
        body.append("Midday session — lower liquidity window; breakout follow-through less reliable.")
        bull = max(0.0, bull - 0.25)
        bear = max(0.0, bear - 0.25)
    elif session_phase == "OPENING":
        body.append("Opening range still forming — setup quality will improve once OR is established.")

    # ── #9 Macro VWAP slope ──────────────────────────────────────────────────
    if vwap_macro_slope_pct is not None:
        _macro_bias = "long" if bull >= bear else "short"
        if vwap_macro_slope_pct > 0.0005 and _macro_bias == "long":
            bull += 0.5
            body.append(f"Macro VWAP slope rising ({vwap_macro_slope_pct:+.5f}%/bar over {VWAP_MACRO_BARS} bars) — structural trend aligns with long bias.")
        elif vwap_macro_slope_pct < -0.0005 and _macro_bias == "short":
            bear += 0.5
            body.append(f"Macro VWAP slope declining ({vwap_macro_slope_pct:+.5f}%/bar over {VWAP_MACRO_BARS} bars) — structural trend aligns with short bias.")
        elif vwap_macro_slope_pct > 0.0005 and _macro_bias == "short":
            bear = max(0.0, bear - 0.5)
            body.append(f"Macro VWAP slope rising ({vwap_macro_slope_pct:+.5f}%/bar) AGAINST short bias — structural caution.")
        elif vwap_macro_slope_pct < -0.0005 and _macro_bias == "long":
            bull = max(0.0, bull - 0.5)
            body.append(f"Macro VWAP slope declining ({vwap_macro_slope_pct:+.5f}%/bar) AGAINST long bias — structural caution.")

    # ── #4 HH/HL or LL/LH price structure ───────────────────────────────────
    if price_structure == "HH_HL":
        bull += 0.75
        body.append("Intraday price structure: higher highs and higher lows — confirmed uptrend.")
    elif price_structure == "LL_LH":
        bear += 0.75
        body.append("Intraday price structure: lower lows and lower highs — confirmed downtrend.")
    elif price_structure == "MIXED":
        body.append("Intraday price structure: mixed swing highs/lows — no clear directional trend.")

    # ── #12 Secondary breakout ───────────────────────────────────────────────
    if secondary_breakout_up and vol_spike:
        bull += 1.0
        body.append(
            f"Secondary breakout above ORH ({or_high:.2f}) — price broke out, retraced, and is breaking again. "
            "Higher-conviction entry than the first attempt."
        )
    elif secondary_breakout_down and vol_spike:
        bear += 1.0
        body.append(
            f"Secondary breakdown below ORL ({or_low:.2f}) — price broke down, retraced, and is breaking again. "
            "Higher-conviction entry than the first attempt."
        )

    # ── #3 OR re-test quality ────────────────────────────────────────────────
    # Price cleared ORH/ORL earlier, pulled back near that level, holding without a reversal.
    _orh_retest_long  = (
        or_historical == "broke_up"
        and or_state == "above"
        and 0 < (last - or_high) / or_high * 100 <= 0.3
        and not vol_spike
    )
    _orl_retest_short = (
        or_historical == "broke_down"
        and or_state == "below"
        and 0 < (or_low - last) / or_low * 100 <= 0.3
        and not vol_spike
    )
    if _orh_retest_long:
        bull += 1.0
        body.append(
            f"Pullback to ORH re-test ({or_high:.2f}) — price holding above breakout level after a confirmed break; "
            "classic continuation setup."
        )
    elif _orl_retest_short:
        bear += 1.0
        body.append(
            f"Pullback to ORL re-test ({or_low:.2f}) — price holding below breakdown level; "
            "continuation short setup."
        )

    # ── #3b Bounce-rejection tier (after ORL breakdown) ─────────────────────
    # After a breakdown, price may bounce toward resistance. WHERE the bounce gets
    # rejected determines entry quality:
    #   "vwap_rejection"       — bounce capped at VWAP (sellers stepped in early).
    #                            Valid PUT entry; entry near VWAP, stop above VWAP.
    #                            Sellers so aggressive they won't let price reach ORL —
    #                            actually MORE bearish than an ORL retest.
    #   "orl_rejection_retest" — bounce reached ORL from below, now being rejected.
    #                            Strongest PUT re-entry; entry near ORL, bigger target.
    #   "no_mans_land"         — price churning between VWAP and ORL, no clean level.
    #                            Wait — no rejection confirmation yet.
    #   (long-side mirror: orh_rejection and vwap_rejection_long handled symmetrically)
    _bounce_scenario: str = ""
    if or_historical == "broke_down" and or_state == "below" and or_low > 0 and vwap_last > 0:
        _pct_below_orl  = (or_low  - last) / or_low   * 100   # >0 means below ORL
        _pct_from_vwap  = (last - vwap_last) / vwap_last * 100 # <0 means below VWAP
        # Near VWAP from below, still a healthy distance from ORL
        if abs(_pct_from_vwap) <= 0.45 and _pct_below_orl > 0.55:
            if vol_spike:
                _bounce_scenario = "vwap_rejection"
                bear += 1.2   # strong signal — early rejection = heavy selling pressure
                body.append(
                    f"VWAP rejection short ({vwap_last:.2f}) — bounce capped before reaching ORL. "
                    f"Sellers stepped in at VWAP; stops above ${vwap_last:.2f}."
                )
            else:
                _bounce_scenario = "vwap_test"  # testing, not yet confirmed
                body.append(
                    f"Bouncing into VWAP ({vwap_last:.2f}) — rejection not confirmed. "
                    "Wait for volume to confirm the fade."
                )
        # Near ORL from below — existing _orl_retest_short covers holding; add vol-confirmed rejection
        elif 0 < _pct_below_orl <= 0.55 and _pct_from_vwap < -0.3:
            if vol_spike:
                _bounce_scenario = "orl_rejection_retest"
                bear += 0.8   # already scored by _orl_retest_short path, smaller add here
                body.append(
                    f"ORL rejection confirmed ({or_low:.2f}) — volume spike at resistance. "
                    "Highest-conviction PUT re-entry."
                )
            else:
                _bounce_scenario = "orl_rejection_retest"  # use same bucket, no extra score
        # Price between VWAP and ORL with no clean level nearby
        elif _pct_below_orl > 0.55 and _pct_from_vwap < -0.45:
            _bounce_scenario = "no_mans_land"
            body.append(
                f"Price between VWAP (${vwap_last:.2f}) and ORL (${or_low:.2f}) — no clean rejection level. "
                "Wait for a test of either level before considering entry."
            )

    # Mirror for long-side bounce scenarios after ORH breakout
    elif or_historical == "broke_up" and or_state == "above" and or_high > 0 and vwap_last > 0:
        _pct_above_orh  = (last - or_high)  / or_high   * 100
        _pct_from_vwap  = (last - vwap_last) / vwap_last * 100
        if abs(_pct_from_vwap) <= 0.45 and _pct_above_orh > 0.55:
            if vol_spike:
                _bounce_scenario = "vwap_rejection_long"
                bull += 1.2
                body.append(
                    f"VWAP support hold ({vwap_last:.2f}) after ORH breakout — pullback absorbed at VWAP. "
                    f"Stops below ${vwap_last:.2f}."
                )
        elif _pct_above_orh > 0.55 and _pct_from_vwap > 0.45:
            _bounce_scenario = "no_mans_land_long"

    # Daily trend context from swing scan (optional adjustment)
    bias: Bias = None
    if daily_trend_context is not None:
        _swing_bias = daily_trend_context.get("bias", "").lower()
        _swing_verdict = str(daily_trend_context.get("verdict", "") or "").upper()
        if _swing_verdict in ("STRONG GO", "GO") and _swing_bias:
            if _swing_bias == bias:
                body.append(
                    f"Daily (swing) trend aligns: {_swing_bias.upper()}. "
                    f"Swing verdict is {_swing_verdict}."
                )
                if bias == "long":
                    bull += 0.5
                elif bias == "short":
                    bear += 0.5
            elif bias is not None and bias != _swing_bias:
                body.append(
                    f"CAUTION — daily (swing) trend CONFLICTS with intraday bias. "
                    f"Swing signals {_swing_bias.upper()} ({_swing_verdict})."
                )
                if bias == "long":
                    bull -= 0.5
                elif bias == "short":
                    bear -= 0.5
        elif _swing_verdict in ("NO-GO",) and bias:
            body.append("Swing engine says NO-GO — daily trend does not support any position.")
            if bias == "long":
                bull -= 0.5
            elif bias == "short":
                bear -= 0.5

    bull = max(0.0, min(100.0, bull))
    bear = max(0.0, min(100.0, bear))

    diff = bull - bear
    verdict: Verdict = "WAIT"
    soft_edge = max(bull, bear) >= GO_THRESHOLD and abs(diff) >= MARGIN_GO
    long_edge = soft_edge and diff > 0
    short_edge = soft_edge and diff < 0

    # Counter-trend NO-GO veto — checks both SPY and QQQ so a strong QQQ move
    # against the bias (e.g. tech rip vs bearish setup) is also caught.
    _mkt_strongly_down = (spy_chg is not None and spy_chg <= -1.2) or \
                         (qqq_chg is not None and qqq_chg <= -1.2)
    _mkt_strongly_up   = (spy_chg is not None and spy_chg >= 1.2) or \
                         (qqq_chg is not None and qqq_chg >= 1.2)

    # Vetoes → NO-GO
    if vix_level is not None and vix_level >= VIX_NO_GO:
        verdict = "NO-GO"
        prefix = [
            f"VIX very high ({vix_level:.0f}) — avoid new day-trade risk.",
        ]
    elif diff > 0 and _mkt_strongly_down:
        chg_str = f"SPY {spy_chg:+.2f}%" if spy_chg is not None else f"QQQ {qqq_chg:+.2f}%"
        verdict = "NO-GO"
        prefix = [f"Strong negative broad market ({chg_str}) vs bullish stock tilt."]
    elif diff < 0 and _mkt_strongly_up:
        chg_str = f"SPY {spy_chg:+.2f}%" if spy_chg is not None else f"QQQ {qqq_chg:+.2f}%"
        verdict = "NO-GO"
        prefix = [f"Strong positive broad market ({chg_str}) vs bearish stock tilt."]
    elif (
        # Compound NO-GO: long bias signalled but entry trigger never fired.
        # CALL entry requires an ORH break — if OR is still intact all session,
        # RVOL is weak (no institutional participation), and the market is leaning
        # against the bias, the setup is a false positive. Flag it rather than
        # letting it show as "Bullish GO/WATCH" with an unreachable entry condition.
        diff > 0
        and or_historical == "contained"          # ORH never broken today
        and (rvol is not None and rvol < 0.75)    # < 75 % of expected volume
        and spy_chg is not None and spy_chg <= -0.25
        and qqq_chg is not None and qqq_chg <= -0.25
    ):
        _rvol_str = f"RVOL {rvol:.1f}×" if rvol is not None else "low RVOL"
        _mkt_str  = f"SPY {spy_chg:+.2f}% / QQQ {qqq_chg:+.2f}%"
        verdict = "NO-GO"
        prefix = [
            f"NO-GO — CALL entry condition not met all session: ORH never broken "
            f"(price contained inside opening range), {_rvol_str} "
            f"(no institutional participation), market leaning bearish ({_mkt_str}). "
            "Bullish bias exists on VWAP position alone but the actual trigger has not fired — "
            "do not anticipate the breakout.",
        ]
    elif (
        # Mirror: short bias but ORL never broken + weak RVOL + bullish market.
        diff < 0
        and or_historical == "contained"
        and (rvol is not None and rvol < 0.75)
        and spy_chg is not None and spy_chg >= 0.25
        and qqq_chg is not None and qqq_chg >= 0.25
    ):
        _rvol_str = f"RVOL {rvol:.1f}×" if rvol is not None else "low RVOL"
        _mkt_str  = f"SPY {spy_chg:+.2f}% / QQQ {qqq_chg:+.2f}%"
        verdict = "NO-GO"
        prefix = [
            f"NO-GO — PUT entry condition not met all session: ORL never broken "
            f"(price contained inside opening range), {_rvol_str} "
            f"(no institutional participation), market leaning bullish ({_mkt_str}). "
            "Bearish bias exists on VWAP position alone but the actual trigger has not fired — "
            "do not anticipate the breakdown.",
        ]
    elif not soft_edge:
        verdict = "WAIT"
        prefix = ["No clear intraday edge — scores too close or too low."]
    elif long_edge:
        bias = "long"
        if not vol_spike:
            verdict = "WATCH"
            prefix = [
                "WATCH — volume confirmation WEAK: breakout not aggressively expanding yet; "
                "stand aside or wait for a thrust / higher conviction bar.",
                "Long-bias tape — but fragile follow-through risk until volume confirms.",
            ]
        else:
            strong_ok = bull >= STRONG_BULL and abs(diff) >= STRONG_DIFF
            if rs_vs_qqq_pct is not None and rs_vs_qqq_pct < -0.4:
                strong_ok = False
            if strong_ok:
                verdict = "STRONG GO"
                prefix = [
                    "STRONG GO — strong setup: trend + opening-range logic + volume expansion; "
                    "favor planned size with defined stops.",
                    "Long-bias context (stock long, long calls, short puts).",
                ]
            else:
                verdict = "GO"
                prefix = [
                    "GO — medium setup: edge vs VWAP / range with volume present; manage gap and reversal risk.",
                    "Long-bias context (stock long, long calls, short puts).",
                ]
    elif short_edge:
        bias = "short"
        if not vol_spike:
            verdict = "WATCH"
            prefix = [
                "WATCH — volume confirmation WEAK: breakdown / continuation not aggressively confirmed; "
                "avoid forcing size.",
                "Short-bias tape — higher trap risk without volume expansion.",
            ]
        else:
            strong_ok = bear >= STRONG_BULL and abs(diff) >= STRONG_DIFF
            if rs_vs_qqq_pct is not None and rs_vs_qqq_pct > 0.4:
                strong_ok = False
            if strong_ok:
                verdict = "STRONG GO"
                prefix = [
                    "STRONG GO — strong setup: bearish stack + volume confirmation; use defined risk.",
                    "Short-bias context (stock short, long puts, short calls).",
                ]
            else:
                verdict = "GO"
                prefix = [
                    "GO — medium setup: edge with volume; watch sharp bounces.",
                    "Short-bias context (stock short, long puts, short calls).",
                ]
    else:
        verdict = "WAIT"
        prefix = ["No clear intraday edge — scores too close or too low."]

    conf = _confidence_block(
        momentum_pct=momentum_pct,
        or_state=or_state,
        vol_spike=vol_spike,
        bias=bias,
        spy_chg=spy_chg,
        qqq_chg=qqq_chg,
        vix_level=vix_level,
        verdict=verdict,
        rvol=rvol,
    )

    reasons = prefix + body

    chart_bars: list[dict[str, Any]] = []
    for i in range(len(session)):
        row = session.iloc[i]
        ts = session.index[i]
        t_iso = pd.Timestamp(ts).isoformat()
        vw_i = float(vwap_ser.iloc[i])
        chart_bars.append(
            {
                "t": t_iso,
                "o": round(float(row["Open"]), 6),
                "h": round(float(row["High"]), 6),
                "l": round(float(row["Low"]), 6),
                "c": round(float(row["Close"]), 6),
                "v": round(float(row["Volume"]), 2),
                "vwap": round(vw_i, 6),
            }
        )

    session_change_pct = _intraday_session_return_pct(session)
    post_m_p = _info_opt_float(info, "postMarketPrice")
    post_m_chg = _info_opt_float(info, "postMarketChangePercent")
    pre_m_p = _info_opt_float(info, "preMarketPrice")
    pre_m_chg = _info_opt_float(info, "preMarketChangePercent")
    reg_m_p = _info_opt_float(info, "regularMarketPrice")
    reg_m_chg = _info_opt_float(info, "regularMarketChangePercent")
    market_state_raw = info.get("marketState")
    market_state = str(market_state_raw).strip().upper() if market_state_raw else ""

    metrics = {
        "session_date": session_date,
        "bars_used": len(session),
        "last_price": round(last, 4),
        "session_change_pct": session_change_pct,
        "post_market_price": post_m_p,
        "post_market_change_pct": post_m_chg,
        "pre_market_price": pre_m_p,
        "pre_market_change_pct": pre_m_chg,
        "regular_market_price": reg_m_p,
        "regular_market_change_pct": reg_m_chg,
        "market_state": market_state,
        "vwap": round(vwap_last, 4),
        "vwap_dist_pct": vwap_dist_pct,
        "vwap_position": vwap_position,
        "vwap_slope_pct": vwap_slope_pct,
        "vwap_macro_slope_pct": vwap_macro_slope_pct,
        "or_high": round(or_high, 4),
        "or_low": round(or_low, 4),
        "or_breakout": or_state,
        "or_historical": or_historical,
        "or_minutes": OR_MINUTES,
        "or_width_pct": or_width_pct,
        "or_width_label": or_width_label,
        "vwap_reliable": _vwap_is_real,
        "momentum_pct": momentum_pct,
        "momentum_bars": mom_bars,
        "volume_spike": vol_spike,
        "rvol": rvol,
        "gap_pct": gap_pct,
        "gap_fill_risk": gap_fill_risk,
        "session_phase": session_phase,
        "session_minutes_elapsed": session_minutes_elapsed,
        "bar_data_age_minutes": _bar_age_minutes,
        "bar_data_stale": _bar_data_stale,
        "bar_data_warning": _stale_msg,
        "price_structure": price_structure,
        "secondary_breakout": secondary_breakout_up or secondary_breakout_down,
        "or_retest": _orh_retest_long or _orl_retest_short,
        "bounce_scenario": _bounce_scenario,
        "spy_change_pct": spy_chg,
        "qqq_change_pct": qqq_chg,
        "spy_session_change_pct": spy_session_pct,
        "qqq_session_change_pct": qqq_session_pct,
        "vix": vix_level,
        "rs_vs_qqq_pct": rs_vs_qqq_pct,
        "rs_vs_qqq_label": _rs_label(t, rs_vs_qqq_pct) if rs_vs_qqq_pct is not None else None,
        "confidence": conf,
        "chart_bars": chart_bars,
        "session_high": round(session_high, 4),
        "session_low": round(session_low, 4),
    }

    # ── Daily range exhaustion analysis ───────────────────────────────
    # Correct formula: (today's H-L range) / (14-day ATR)
    # Tells you what fraction of the *typical* daily range has been consumed.
    # The old formula — (last - low) / (high - low) — just measured whether
    # price was near the session high, which is always ~100% on up-trending
    # days and gives false EXHAUSTED readings (e.g. AVGO: 97% old vs 58% ATR).
    _range_span = session_high - session_low
    _atr14: float = 0.0
    try:
        _daily_bars = bar_cache.get_history(t, period="20d", interval="1d",
                                            force_refresh=_fr)
        if _daily_bars is not None and len(_daily_bars) >= 5:
            _tr_series = (_daily_bars["High"] - _daily_bars["Low"])
            _atr14 = float(_tr_series.rolling(min(14, len(_tr_series))).mean().iloc[-1])
    except Exception:
        _atr14 = 0.0

    if _atr14 > 0 and _range_span >= 0:
        # Primary: fraction of historical ATR consumed today
        _daily_range_used_pct = round(_range_span / _atr14 * 100, 1)
    elif _range_span > 0:
        # Fallback (no daily history): use intraday-only ratio, direction-aware
        if bias == "long":
            _daily_range_used_pct = round((last - session_low) / _range_span * 100, 1)
        else:
            _daily_range_used_pct = round((session_high - last) / _range_span * 100, 1)
    else:
        _daily_range_used_pct = 0.0
    _daily_range_used_pct = max(0.0, min(150.0, _daily_range_used_pct))  # allow >100% on high-ATR days

    # Thresholds based on ATR fraction:
    #   ≥100% = full ATR consumed (rare extended day) → EXHAUSTED
    #   ≥ 80% = 80–99% of ATR used                   → EXHAUSTED
    #   ≥ 60% = 60–79% of ATR used                   → LATE
    #   ≥ 35% = 35–59% of ATR used                   → MID
    #   < 35% = early-session, range still wide open  → EARLY
    if _daily_range_used_pct >= 80:
        _daily_range_phase = "EXHAUSTED"
    elif _daily_range_used_pct >= 60:
        _daily_range_phase = "LATE"
    elif _daily_range_used_pct >= 35:
        _daily_range_phase = "MID"
    else:
        _daily_range_phase = "EARLY"

    metrics["daily_range_used_pct"] = _daily_range_used_pct
    metrics["daily_range_phase"]    = _daily_range_phase
    metrics["atr14"]                = round(_atr14, 2) if _atr14 > 0 else None

    trader_decision = build_trader_decision(
        ticker=t,
        stock_session_pct=session_change_pct,
        above_vwap=last > vwap_last,
        bull_score=round(bull, 2),
        bear_score=round(bear, 2),
        spy_session_pct=spy_session_pct,
        qqq_session_pct=qqq_session_pct,
        spy_daily_pct=spy_chg,
        qqq_daily_pct=qqq_chg,
        vix=vix_level,
    )

    entry_guidance = build_day_entry_guidance(metrics, trader_decision, bias)

    # ── Entry R/R ratio ───────────────────────────────────────────────
    _eg_scalp   = entry_guidance.get("scalp_target")
    _eg_risk    = entry_guidance.get("risk_below")
    _eg_price   = entry_guidance.get("current_price") or last
    if _eg_scalp and _eg_risk and _eg_price:
        _reward = abs(_eg_scalp - _eg_price)
        _risk   = abs(_eg_price - _eg_risk)
        metrics["entry_rr_ratio"] = round(_reward / _risk, 2) if _risk > 0 else None
    else:
        metrics["entry_rr_ratio"] = None

    # Range warning — fires when daily move is nearly exhausted vs 14-day ATR
    _atr_ctx = f" (14-day ATR ${_atr14:.2f})" if _atr14 > 0 else ""
    if _daily_range_phase == "EXHAUSTED":
        metrics["range_warning"] = (
            f"Daily range {_daily_range_used_pct:.0f}% of ATR consumed{_atr_ctx} — the typical daily move is nearly complete. "
            f"Entering now chases the tail. Wait for a pullback before reassessing."
        )
    elif _daily_range_phase == "LATE":
        metrics["range_warning"] = (
            f"Daily range {_daily_range_used_pct:.0f}% of ATR consumed{_atr_ctx} — late-stage entry. "
            f"Reward shrinks as range nears exhaustion. Require tighter confirmation."
        )
    else:
        metrics["range_warning"] = None

    option_risk_context = build_day_option_risk_context(t, info)

    scan = DayTradeScan(
        ticker=t,
        company_name=company,
        verdict=verdict,
        bias=bias,
        bull_score=round(bull, 2),
        bear_score=round(bear, 2),
        reasons=reasons,
        metrics=metrics,
        trader_decision=trader_decision,
        entry_guidance=entry_guidance,
        option_risk_context=option_risk_context,
    )
    # Validate scan invariants before caching
    _issues: list[str] = []
    if scan.bull_score < 0 or scan.bear_score < 0:
        _issues.append(f"negative score: bull={scan.bull_score} bear={scan.bear_score}")
    if scan.verdict not in ("STRONG GO", "GO", "WATCH", "WAIT", "NO-GO"):
        _issues.append(f"unexpected verdict={scan.verdict}")
    if _issues:
        log.error("DayTradeScan invariant violation for %s: %s", t, _issues)
    elif daily_trend_context is None:
        # Only cache when no external context was injected — a contextualized
        # scan is specific to that context snapshot and must not overwrite
        # the canonical (context-free) cache entry.
        with _scan_lock:
            _scan_cache[t] = (time.time(), scan)
    return scan


def underlying_intraday_snapshot_for_active_trade(ticker: str) -> dict[str, Any]:
    """
    Reuse the full Yahoo 1m RTH path from run_day_trade_scan; flatten metrics for active-trade
    decision input (underlying spot, VWAP, OR, volume spike, RS vs QQQ).
    """
    scan = run_day_trade_scan(ticker)
    m = scan.metrics
    return {
        "ticker": scan.ticker,
        "company_name": scan.company_name,
        "metrics": m,
        "intraday_flat": {
            "underlying_last": m.get("last_price"),
            "last_price": m.get("last_price"),
            "session_change_pct": m.get("session_change_pct"),
            "vwap": m.get("vwap"),
            "or_high": m.get("or_high"),
            "or_low": m.get("or_low"),
            "or_breakout": m.get("or_breakout"),
            "momentum_pct": m.get("momentum_pct"),
            "volume_spike": m.get("volume_spike"),
            "rs_vs_qqq_pct": m.get("rs_vs_qqq_pct"),
        },
    }
