"""
Early Entry Trigger Engine (Feature 2).

Runs 7:00–7:30 AM PT on 1-minute candles. Auto-refresh every 30 s.

NOTE: Yahoo Finance 1m bars have a ~30-minute lag at session open.
The first reliable bars are available from 7:00 AM PT (10:00 AM ET),
not 6:30 AM PT (9:30 AM ET) as originally designed.

Three conditions must ALL align before an entry signal fires:

  Condition A — First 5-min candle (7:00–7:05 AM PT / 10:00–10:05 AM ET)
    Green AND move > +0.15% → bullish
    Red   AND move > -0.15% → bearish
    < 0.15% either way      → neutral (no trade)

  Condition B — VWAP position at 7:05 AM PT (10:05 AM ET)
    price > VWAP → bullish
    price < VWAP → bearish

  Condition C — 2 consecutive 1M candles post 7:05 AM PT
    2 green → bullish confirmation
    2 red   → bearish confirmation
    mixed   → no confirmation

Entry signal:
  All 3 bull → CALL entry on next candle open
  All 3 bear → PUT entry on next candle open
  Mixed      → "WAIT — signals not aligned"
  No trigger by 7:30 AM PT → "No setup today. Protect capital."

R/R gate (ATR-based from Feature 4 formulas):
  R/R < 1.5 → "R/R insufficient. Skip setup."
"""
from __future__ import annotations

import math
import time
from datetime import datetime, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

import bar_cache

PT  = ZoneInfo("America/Los_Angeles")

# 30-second per-ticker cache (spec: refresh every 30 s)
_CACHE: dict[str, tuple[float, dict]] = {}
_TTL = 30


def _atr14(ticker: str) -> Optional[float]:
    """14-day average true range from daily bars."""
    try:
        h = bar_cache.get_history(ticker, period="30d", interval="1d", auto_adjust=True)
        if h is None or len(h) < 14:
            return None
        tr = (h["High"] - h["Low"]).tail(14)
        return round(float(tr.mean()), 4)
    except Exception:
        return None


def _rr_and_levels(
    direction: str,
    entry: float,
    atr: float,
) -> dict[str, Any]:
    """ATR-based stop / T1 / T2 per Feature 4 specification."""
    if direction == "CALL":
        stop = round(entry - atr * 0.5, 2)
        t1   = round(entry + atr * 1.0, 2)
        t2   = round(entry + atr * 2.0, 2)
    else:  # PUT
        stop = round(entry + atr * 0.5, 2)
        t1   = round(entry - atr * 1.0, 2)
        t2   = round(entry - atr * 2.0, 2)
    risk   = abs(entry - stop)
    reward = abs(t1 - entry)
    rr     = round(reward / risk, 2) if risk > 0 else 0.0
    return {"stop": stop, "target_1": t1, "target_2": t2, "rr_ratio": rr}


def check_early_entry_trigger(
    ticker: str,
    force_refresh: bool = False,
) -> dict[str, Any]:
    """
    Evaluate all three early-entry conditions for *ticker*.

    Returns a structured dict with status:
      "WAIT"      — one or more conditions pending / not aligned
      "NO_SETUP"  — first candle move < threshold → protect capital
      "SKIP"      — all conditions met but R/R < 1.5
      "ENTRY"     — all conditions met and R/R ≥ 1.5 → show trade card
      "TIMEOUT"   — 7:00 AM PT passed with no trigger
      "NO_DATA"   — bars unavailable
    """
    t = ticker.upper().strip()
    cache_key = t
    if not force_refresh:
        entry = _CACHE.get(cache_key)
        if entry and time.time() - entry[0] < _TTL:
            return entry[1]

    now_pt = datetime.now(PT)

    # ── Fetch 1M premarket bars ──────────────────────────────────────
    try:
        raw = bar_cache.get_history(t, period="1d", interval="1m", auto_adjust=True)
    except Exception:
        raw = None

    if raw is None or raw.empty:
        return {"status": "NO_DATA", "ticker": t,
                "message": "1-minute bars not available."}

    # Convert to PT
    df = raw.copy()
    if df.index.tz is None:
        df.index = df.index.tz_localize("UTC").tz_convert(PT)
    else:
        df.index = df.index.tz_convert(PT)

    today = now_pt.date()

    # Filter today's session window (7:00–7:30 AM PT = 10:00–10:30 AM ET)
    # Yahoo Finance 1m bars have a ~30-min lag at session open, so
    # the first reliable data is from 7:00 AM PT (10:00 AM ET).
    pm = df[
        (df.index.normalize().date == today)   # type: ignore[attr-defined]
        & (df.index.hour == 7)
        & (df.index.minute < 30)
    ]

    # Timeout: past 7:30 AM PT with no prior signal
    if (now_pt.hour > 7 or (now_pt.hour == 7 and now_pt.minute >= 30)) and pm.empty:
        result = {
            "status": "TIMEOUT", "ticker": t,
            "message": "No setup today. Protect capital.",
            "computed_at": now_pt.isoformat(timespec="seconds"),
        }
        _CACHE[cache_key] = (time.time(), result)
        return result

    if pm.empty:
        result = {
            "status": "WAIT", "ticker": t,
            "message": "Waiting for 7:00 AM PT data (Yahoo 30-min lag).",
            "computed_at": now_pt.isoformat(timespec="seconds"),
        }
        _CACHE[cache_key] = (time.time(), result)
        return result

    # ── Condition A: first 5-min candle (7:00–7:04 AM PT) ────────────
    first5 = pm[pm.index.minute < 5]
    if first5.empty:
        result = {
            "status": "WAIT", "ticker": t,
            "message": "Waiting for 7:00 AM PT first candle.",
            "computed_at": now_pt.isoformat(timespec="seconds"),
        }
        _CACHE[cache_key] = (time.time(), result)
        return result

    a_open  = float(first5["Open"].iloc[0])
    a_close = float(first5["Close"].iloc[-1])
    a_move  = round((a_close / a_open - 1.0) * 100.0, 3) if a_open > 0 else 0.0
    a_green = a_close > a_open

    if abs(a_move) < 0.15:
        result = {
            "status": "NO_SETUP", "ticker": t,
            "message": "No setup today. Protect capital.",
            "reason": f"First 5-min move {a_move:+.2f}% — below ±0.15% threshold.",
            "condition_a": "neutral", "condition_a_detail": f"{a_move:+.2f}% (inside threshold)",
            "computed_at": now_pt.isoformat(timespec="seconds"),
        }
        _CACHE[cache_key] = (time.time(), result)
        return result

    cond_a      = "bull" if a_green else "bear"
    cond_a_detail = f"{a_move:+.2f}% ({'green' if a_green else 'red'} candle)"

    # ── Condition B: VWAP at 7:05 AM PT ─────────────────────────────
    at705 = pm[pm.index.minute <= 5]
    if at705.empty:
        result = {
            "status": "WAIT", "ticker": t,
            "message": "Waiting for 7:05 AM PT VWAP check.",
            "condition_a": cond_a, "condition_a_detail": cond_a_detail,
            "computed_at": now_pt.isoformat(timespec="seconds"),
        }
        _CACHE[cache_key] = (time.time(), result)
        return result

    tp    = (at705["High"] + at705["Low"] + at705["Close"]) / 3.0
    vol   = at705["Volume"].astype(float).clip(lower=0)
    cum_v = float(vol.sum())
    vwap_val = float((tp * vol).sum() / cum_v) if cum_v > 0 else float(at705["Close"].iloc[-1])
    last_705 = float(at705["Close"].iloc[-1])

    cond_b = "bull" if last_705 > vwap_val else "bear"
    cond_b_detail = (
        f"Price ${last_705:.2f} {'>' if cond_b=='bull' else '<'} VWAP ${vwap_val:.2f}"
    )

    # ── Condition C: 2 consecutive 1M candles after 7:05 AM PT ───────
    post705 = pm[pm.index.minute > 5]

    if len(post705) < 2:
        result = {
            "status": "WAIT", "ticker": t,
            "message": "WAIT — waiting for 2 confirmation candles.",
            "condition_a": cond_a, "condition_a_detail": cond_a_detail,
            "condition_b": cond_b, "condition_b_detail": cond_b_detail,
            "condition_c": "pending", "condition_c_detail": f"{len(post705)}/2 candles seen",
            "vwap": round(vwap_val, 2),
            "computed_at": now_pt.isoformat(timespec="seconds"),
        }
        _CACHE[cache_key] = (time.time(), result)
        return result

    last2 = post705.iloc[-2:]
    c1_green = float(last2["Close"].iloc[0]) > float(last2["Open"].iloc[0])
    c2_green = float(last2["Close"].iloc[1]) > float(last2["Open"].iloc[1])

    if c1_green and c2_green:
        cond_c, cond_c_detail = "bull", "2 consecutive green 1M candles"
    elif (not c1_green) and (not c2_green):
        cond_c, cond_c_detail = "bear", "2 consecutive red 1M candles"
    else:
        result = {
            "status": "WAIT", "ticker": t,
            "message": "WAIT — signals not aligned.",
            "condition_a": cond_a, "condition_a_detail": cond_a_detail,
            "condition_b": cond_b, "condition_b_detail": cond_b_detail,
            "condition_c": "mixed", "condition_c_detail": "Mixed candles — no confirmation",
            "vwap": round(vwap_val, 2),
            "computed_at": now_pt.isoformat(timespec="seconds"),
        }
        _CACHE[cache_key] = (time.time(), result)
        return result

    # All 3 must agree
    all_bull = cond_a == "bull" and cond_b == "bull" and cond_c == "bull"
    all_bear = cond_a == "bear" and cond_b == "bear" and cond_c == "bear"

    if not all_bull and not all_bear:
        result = {
            "status": "WAIT", "ticker": t,
            "message": "WAIT — signals not aligned.",
            "condition_a": cond_a, "condition_a_detail": cond_a_detail,
            "condition_b": cond_b, "condition_b_detail": cond_b_detail,
            "condition_c": cond_c, "condition_c_detail": cond_c_detail,
            "vwap": round(vwap_val, 2),
            "computed_at": now_pt.isoformat(timespec="seconds"),
        }
        _CACHE[cache_key] = (time.time(), result)
        return result

    direction    = "CALL" if all_bull else "PUT"
    entry_price  = round(float(post705["Close"].iloc[-1]), 2)
    atr          = _atr14(t)

    base: dict[str, Any] = {
        "ticker":           t,
        "direction":        direction,
        "entry":            entry_price,
        "vwap":             round(vwap_val, 2),
        "condition_a":      cond_a, "condition_a_detail": cond_a_detail,
        "condition_b":      cond_b, "condition_b_detail": cond_b_detail,
        "condition_c":      cond_c, "condition_c_detail": cond_c_detail,
        "atr14":            atr,
        "trigger":          "Early Entry Trigger — 7:00 AM Window",
        "computed_at":      now_pt.isoformat(timespec="seconds"),
    }

    if atr is None or atr <= 0:
        result = {**base, "status": "ENTRY",
                  "message": f"ALL 3 ALIGNED — Enter {direction}. (ATR unavailable — compute stops manually.)",
                  "stop": None, "target_1": None, "target_2": None, "rr_ratio": None}
        _CACHE[cache_key] = (time.time(), result)
        return result

    levels = _rr_and_levels(direction, entry_price, atr)

    if levels["rr_ratio"] < 1.5:
        result = {**base, **levels, "status": "SKIP",
                  "message": f"R/R insufficient ({levels['rr_ratio']:.1f}x). Skip setup."}
        _CACHE[cache_key] = (time.time(), result)
        return result

    result = {
        **base, **levels,
        "status":  "ENTRY",
        "message": f"ALL 3 ALIGNED — Enter {direction} on next candle open",
    }
    _CACHE[cache_key] = (time.time(), result)
    return result
