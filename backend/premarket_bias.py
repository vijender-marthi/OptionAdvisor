"""
Pre-Market Bias Engine (Feature 1).

Runs before 6:30 AM PT. Scores five conditions to produce BULLISH / NEUTRAL / BEARISH
with 1-5 confidence. Designed to be called from /premarket-bias endpoint.

Scoring (+1 bull | -1 bear | 0 neutral per condition):
  [1] QQQ premarket %    > +0.3% = +1 | < -0.3% = -1
  [2] SPY premarket %    > +0.3% = +1 | < -0.3% = -1
  [3] Prev day close pos — top 25% range = +1 | bottom 25% = -1
  [4] AVGO + NVDA avg premarket > +0.5% = +1 | < -0.5% = -1
  [5] MU + SNDK avg premarket   > +0.5% = +1 | < -0.5% = -1

Interpretation:
  +4 … +5 = BULLISH HIGH CONFIDENCE
  +2 … +3 = BULLISH LOW CONFIDENCE
       0–1 = NEUTRAL
  -2 … -3 = BEARISH LOW CONFIDENCE
  -4 … -5 = BEARISH HIGH CONFIDENCE
"""
from __future__ import annotations

import math
import time
from datetime import datetime
from typing import Any, Optional
from zoneinfo import ZoneInfo

import bar_cache
import backup_data

PT = ZoneInfo("America/Los_Angeles")

_PREMARKET_CACHE: dict[str, tuple[float, dict]] = {}
_CACHE_TTL = 60  # seconds — matches spec's 60-second auto-refresh


def _cached(result: dict) -> dict:
    _PREMARKET_CACHE["bias"] = (time.time(), result)
    return result


def _from_cache() -> Optional[dict]:
    entry = _PREMARKET_CACHE.get("bias")
    if entry and time.time() - entry[0] < _CACHE_TTL:
        return entry[1]
    return None


# ---------------------------------------------------------------------------
# Data helpers
# ---------------------------------------------------------------------------

def _premarket_pct(ticker: str) -> Optional[float]:
    """
    % change from previous close.

    Priority order:
      1. preMarketPrice          — real pre-market quote (available 4–9:30 AM ET)
      2. regularMarketChangePercent — today's live session % (yfinance direct field)
      3. currentPrice / regularMarketPrice vs previousClose — computed session %
      4. api.massive.com snapshot fallback
    """
    try:
        info = bar_cache.get_info(ticker)

        # 1. True pre-market price
        pre   = info.get("preMarketPrice")
        close = info.get("previousClose") or info.get("regularMarketPreviousClose")
        if pre and close and float(close) > 0:
            return round((float(pre) / float(close) - 1.0) * 100.0, 3)

        # 2. Yahoo provides today's session % change directly
        rmc = info.get("regularMarketChangePercent")
        if rmc is not None:
            try:
                val = float(rmc)
                if -50 < val < 50:   # sanity-guard against corrupt values
                    return round(val, 3)
            except (TypeError, ValueError):
                pass

        # 3. Compute from current price vs prev close
        current = (info.get("currentPrice")
                   or info.get("regularMarketPrice")
                   or info.get("postMarketPrice"))
        if current and close and float(close) > 0:
            return round((float(current) / float(close) - 1.0) * 100.0, 3)
    except Exception:
        pass

    # 4. Fallback: api.massive.com
    return backup_data.get_premarket_pct(ticker)


def _prev_close_range_position(ticker: str) -> Optional[float]:
    """
    Position of yesterday's close within the day's H-L range (0.0–1.0).
    Tries Yahoo Finance first; falls back to api.massive.com snapshot.
    """
    # Yahoo Finance
    try:
        h = bar_cache.get_history(ticker, period="5d", interval="1d", auto_adjust=True)
        if h is not None and len(h) >= 2:
            yesterday = h.iloc[-2]
            hi  = float(yesterday["High"])
            lo  = float(yesterday["Low"])
            cl  = float(yesterday["Close"])
            rng = hi - lo
            if rng > 0:
                return round((cl - lo) / rng, 4)
    except Exception:
        pass
    # Fallback: api.massive.com
    return backup_data.get_prev_close_range_position(ticker)


def _avg_premarket(*tickers: str) -> Optional[float]:
    """Average premarket % change across tickers (ignores unavailable symbols)."""
    vals = [v for t in tickers if (v := _premarket_pct(t)) is not None]
    if not vals:
        return None
    return round(sum(vals) / len(vals), 3)


# ---------------------------------------------------------------------------
# Condition factories
# ---------------------------------------------------------------------------

def _score_pct(
    label: str,
    value: Optional[float],
    bull_thresh: float,
    bear_thresh: float,
) -> dict[str, Any]:
    if value is None:
        return {"label": label, "value": "—", "signal": "neutral", "score": 0}
    disp = f"{'+' if value >= 0 else ''}{value:.2f}%"
    if value > bull_thresh:
        return {"label": label, "value": disp, "signal": "bull", "score": 1}
    if value < bear_thresh:
        return {"label": label, "value": disp, "signal": "bear", "score": -1}
    return {"label": label, "value": disp, "signal": "neutral", "score": 0}


# ---------------------------------------------------------------------------
# Main engine
# ---------------------------------------------------------------------------

def build_premarket_bias(force_refresh: bool = False) -> dict[str, Any]:
    """
    Compute and return the pre-market bias payload.
    Uses a 60-second in-process cache; bypassed when force_refresh=True.
    """
    if not force_refresh:
        cached = _from_cache()
        if cached:
            return cached

    now_pt  = datetime.now(PT)
    is_friday = now_pt.weekday() == 4

    conditions: list[dict[str, Any]] = []
    total_score = 0

    # [1] QQQ premarket
    qqq_pct = _premarket_pct("QQQ")
    c1 = _score_pct("QQQ pre-market", qqq_pct, 0.3, -0.3)
    conditions.append(c1); total_score += c1["score"]

    # [2] SPY premarket
    spy_pct = _premarket_pct("SPY")
    c2 = _score_pct("SPY pre-market", spy_pct, 0.3, -0.3)
    conditions.append(c2); total_score += c2["score"]

    # [3] Prev day close position (QQQ as proxy)
    pos = _prev_close_range_position("QQQ")
    if pos is None:
        c3: dict[str, Any] = {"label": "Prev close vs range", "value": "—", "signal": "neutral", "score": 0}
    elif pos >= 0.75:
        c3 = {"label": "Prev close vs range", "value": f"Top {round((1-pos)*100):.0f}%", "signal": "bull", "score": 1}
    elif pos <= 0.25:
        c3 = {"label": "Prev close vs range", "value": f"Bottom {round(pos*100):.0f}%", "signal": "bear", "score": -1}
    else:
        c3 = {"label": "Prev close vs range", "value": f"Mid-range ({round(pos*100):.0f}%)", "signal": "neutral", "score": 0}
    conditions.append(c3); total_score += c3["score"]

    # [4] AVGO + NVDA avg premarket
    semi1 = _avg_premarket("AVGO", "NVDA")
    c4 = _score_pct("AVGO + NVDA avg", semi1, 0.5, -0.5)
    c4["label"] = "AVGO + NVDA avg"
    conditions.append(c4); total_score += c4["score"]

    # [5] MU + SNDK avg premarket (SNDK may be WDC/WDFC; fallback gracefully)
    semi2 = _avg_premarket("MU", "WDC")   # WDC = Western Digital (trades SNDK brand)
    c5 = _score_pct("MU + WDC avg", semi2, 0.5, -0.5)
    conditions.append(c5); total_score += c5["score"]

    # Interpret
    abs_score = abs(total_score)
    if total_score >= 4:
        bias, action, confidence = "BULLISH", "Favor CALLS", 5
    elif total_score >= 2:
        bias, action, confidence = "BULLISH", "Favor CALLS", total_score
    elif total_score <= -4:
        bias, action, confidence = "BEARISH", "Favor PUTS", 5
    elif total_score <= -2:
        bias, action, confidence = "BEARISH", "Favor PUTS", abs_score
    else:
        bias, action, confidence = "NEUTRAL", "Sit out", max(1, abs_score)

    result: dict[str, Any] = {
        "bias":            bias,
        "score":           total_score,
        "confidence":      confidence,
        "action":          action,
        "conditions":      conditions,
        "is_friday":       is_friday,
        "friday_warning":  "NO 0DTE TODAY — Use 3–4 DTE minimum" if is_friday else None,
        "computed_at":     now_pt.isoformat(timespec="seconds"),
        "cache_ttl_s":     _CACHE_TTL,
    }
    return _cached(result)
