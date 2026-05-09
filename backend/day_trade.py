"""
Intraday day-trade signal prototype using Yahoo 1m bars + market context.
Not execution advice — research / educational scoring.

All Yahoo Finance data is routed through bar_cache — no direct yf calls.
"""
from __future__ import annotations

from dataclasses import dataclass
import math
import threading
import time
from typing import Any, Dict, Literal, Optional, Tuple

import numpy as np
import pandas as pd
from zoneinfo import ZoneInfo

import bar_cache
from trader_decision import build_trader_decision

ET = ZoneInfo("America/New_York")

# ---------------------------------------------------------------------------
# Per-ticker scan result cache (bar_cache handles bar-level caching)
# ---------------------------------------------------------------------------
_SCAN_CACHE_TTL_MARKET = 90   # per-ticker scan result during market hours
_SCAN_CACHE_TTL_OFF    = 600  # per-ticker scan result off hours

_scan_cache: Dict[str, Tuple[float, "DayTradeScan"]] = {}
_scan_lock  = threading.Lock()


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
) -> dict[str, str]:
    # Trend strength
    m = abs(momentum_pct)
    if m >= 0.12:
        trend_strength = "HIGH"
    elif m >= 0.04:
        trend_strength = "MEDIUM"
    else:
        trend_strength = "LOW"

    # Breakout quality — or_state is always "above", "below", or "inside"
    if or_state in ("above", "below"):
        breakout_quality = "GOOD"
    else:
        breakout_quality = "WEAK"

    volume_confirmation = "STRONG" if vol_spike else "WEAK"

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
    elif verdict == "WATCH" or not vol_spike:
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


def run_day_trade_scan(ticker: str, force_refresh: bool = False) -> DayTradeScan:
    """
    Run intraday day-trade scan for *ticker*.

    Parameters
    ----------
    ticker        : equity symbol (case-insensitive)
    force_refresh : bypass per-ticker scan cache and shared index caches
    """
    t = ticker.upper().strip()
    if not t or len(t) > 12:
        raise ValueError("Invalid ticker")

    # --- per-ticker scan result cache ---
    if not force_refresh:
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

    vwap_ser = _compute_vwap(session)
    raw_vwap = vwap_ser.iloc[-1]
    try:
        vwap_candidate = float(raw_vwap)
    except (TypeError, ValueError):
        vwap_candidate = float("nan")
    vwap_last = _finite_price(vwap_candidate, last)

    n_or = min(OR_MINUTES, len(session))
    or_seg = session.iloc[:n_or]
    or_high = float(or_seg["High"].max())
    or_low = float(or_seg["Low"].min())

    mom_bars = min(11, len(session) - 1)
    c0 = float(session["Close"].iloc[-mom_bars])
    momentum_pct = round((last / c0 - 1.0) * 100, 3) if c0 > 0 else 0.0

    # Volume spike: compare the *last* bar to a "steady session" baseline.
    #
    # Basing this on ONLY the opening 15-minute mean caused almost no spikes near the close:
    # the open auction / first swings print far more volume than a normal minute, so
    # close rarely exceeded 1.6× that level → everything became WATCH with a plausible edge,
    # or WAIT when scores missed.
    #
    # We exclude (1) the OR window and (2) the final bar itself, then use the mean volume
    # of what remains — stable reference for typical mid/late-session bars.
    or_vol = vol_ser.iloc[:OR_MINUTES]
    steady_vol = vol_ser.iloc[OR_MINUTES:-1]
    tail_mid = (
        vol_ser.iloc[max(OR_MINUTES, len(vol_ser) // 3) :-1]
        if len(vol_ser) > OR_MINUTES + VOL_SPIKE_MIN_STEADY + 2
        else steady_vol
    )
    if len(steady_vol) >= VOL_SPIKE_MIN_STEADY:
        avg_vol = float(steady_vol.mean())
    elif len(tail_mid) >= VOL_SPIKE_MIN_STEADY:
        avg_vol = float(tail_mid.mean())
    elif len(or_vol) >= 5:
        avg_vol = float(or_vol.mean())
    else:
        avg_vol = float(vol_ser.iloc[:-1].mean()) if len(vol_ser) > 1 else 0.0

    v_last = float(vol_ser.iloc[-1])
    vol_spike = avg_vol > 0 and v_last >= VOL_SPIKE_RATIO * avg_vol

    vwap_dist_pct = round((last / vwap_last - 1.0) * 100, 3) if vwap_last > 0 else 0.0

    if last > or_high:
        or_state = "above"
    elif last < or_low:
        or_state = "below"
    else:
        or_state = "inside"

    bull = 0.0
    bear = 0.0

    if last > vwap_last:
        bull += 2.0
        body.append(f"Price above VWAP ({vwap_dist_pct:+.2f}%).")
    elif last < vwap_last:
        bear += 2.0
        body.append(f"Price below VWAP ({vwap_dist_pct:+.2f}%).")

    if or_state == "above":
        bull += 3.0
        body.append("Above opening-range high (bullish breakout).")
    elif or_state == "below":
        bear += 3.0
        body.append("Below opening-range low (bearish breakdown).")
    else:
        body.append("Inside opening range (range-bound).")

    if momentum_pct > 0.08:
        bull += 1.5
        body.append(f"Short-horizon momentum +{momentum_pct:.2f}%.")
    elif momentum_pct < -0.08:
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
    if rs_vs_qqq_pct is not None:
        body.append(_rs_label(t, rs_vs_qqq_pct))
        if rs_vs_qqq_pct >= 0.5:
            bull += 1.0
            body.append(f"Strong RS vs QQQ (+{rs_vs_qqq_pct:.2f}%) adds bullish weight.")
        elif rs_vs_qqq_pct <= -0.5:
            bear += 1.0
            body.append(f"Weak RS vs QQQ ({rs_vs_qqq_pct:.2f}%) adds bearish weight.")

    if spy_chg is not None:
        body.append(f"SPY session-to-session ≈ {spy_chg:+.2f}%.")
        if spy_chg >= 0.25:
            bull += 0.5
        elif spy_chg <= -0.25:
            bear += 0.5

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

    diff = bull - bear
    bias: Bias = None
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
        "or_high": round(or_high, 4),
        "or_low": round(or_low, 4),
        "or_breakout": or_state,
        "or_minutes": OR_MINUTES,
        "momentum_pct": momentum_pct,
        "volume_spike": vol_spike,
        "spy_change_pct": spy_chg,
        "qqq_change_pct": qqq_chg,
        "spy_session_change_pct": spy_session_pct,
        "qqq_session_change_pct": qqq_session_pct,
        "vix": vix_level,
        "rs_vs_qqq_pct": rs_vs_qqq_pct,
        "rs_vs_qqq_label": _rs_label(t, rs_vs_qqq_pct) if rs_vs_qqq_pct is not None else None,
        "confidence": conf,
        "chart_bars": chart_bars,
    }

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
    )
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
