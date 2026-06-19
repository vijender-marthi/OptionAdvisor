"""
Trigger detector — confirms whether an intraday entry trigger has actually fired.

A day-trade verdict may have a real directional bias while the *entry trigger*
has not yet occurred. This module answers one question per setup:

    "Has the entry actually triggered, or are we still waiting?"

All detectors operate on a list of candle dicts (oldest → newest), each shaped:
    {"open": float, "high": float, "low": float, "close": float,
     "volume": float (optional), "time": str (optional)}

Returns (trigger_fired: bool, status_message: str). The status message is meant
to be shown to the trader ("Need 2 green candles above $449.99 — 1 of 2").
"""
from __future__ import annotations

from typing import Optional

# Canonical setup identifiers
ORH_BREAKOUT = "ORH_BREAKOUT"
ORL_BREAKDOWN = "ORL_BREAKDOWN"
VWAP_RECLAIM = "VWAP_RECLAIM"
VWAP_BREAK = "VWAP_BREAK"
PULLBACK_RESET = "PULLBACK_RESET"


def _is_green(c: dict) -> bool:
    return float(c["close"]) > float(c["open"])


def _is_red(c: dict) -> bool:
    return float(c["close"]) < float(c["open"])


def _fmt(x: Optional[float]) -> str:
    try:
        return f"${float(x):.2f}"
    except (TypeError, ValueError):
        return "n/a"


def detect_trigger_fired(
    setup_type: str,
    candles: list[dict],
    levels: dict,
    direction: str,
) -> tuple[bool, str]:
    """
    Dispatch to the right detector. `direction` is "long" or "short".

    Returns (trigger_fired, status_message).
    """
    st = (setup_type or "").upper().strip()
    d = (direction or "").lower().strip()

    if st == ORH_BREAKOUT and d == "long":
        return _check_orh_breakout(candles, levels)
    if st == ORL_BREAKDOWN and d == "short":
        return _check_orl_breakdown(candles, levels)
    if st == VWAP_RECLAIM and d == "long":
        return _check_vwap_reclaim(candles, levels)
    if st == VWAP_BREAK and d == "short":
        return _check_vwap_break(candles, levels)
    if st == PULLBACK_RESET:
        return _check_pullback_reset(candles, levels, d)

    return False, f"Unknown setup/direction: {setup_type}/{direction}"


# ── Two-candle break helpers ────────────────────────────────────────────────

def _two_candle_break_up(candles: list[dict], level: float, level_name: str) -> tuple[bool, str]:
    """2 consecutive green candles closing above `level`, no wick recovery below it."""
    if level is None or level <= 0:
        return False, f"{level_name} level unavailable"
    if len(candles) < 2:
        return False, "Insufficient candle data (need 2)"

    c1, c2 = candles[-2], candles[-1]
    confirmed = 0

    if not _is_green(c1):
        return False, f"Need 2 green candles above {_fmt(level)} — 0 of 2 (last candle not green)"
    if float(c1["close"]) <= level:
        return False, f"Need 2 green candles above {_fmt(level)} — 0 of 2 (prior close below {level_name})"
    if float(c1["low"]) < level:
        return False, f"Prior candle wicked back below {level_name} {_fmt(level)} — break not held"
    confirmed = 1

    if not _is_green(c2):
        return False, f"Need 2 green candles above {_fmt(level)} — 1 of 2 (waiting on confirmation candle)"
    if float(c2["close"]) <= level:
        return False, f"Need 2 green candles above {_fmt(level)} — 1 of 2 (current close below {level_name})"
    if float(c2["low"]) < level:
        return False, f"Confirmation candle wicked back below {level_name} {_fmt(level)} — break not held"

    return True, f"{level_name} break confirmed — 2 green candles above {_fmt(level)}, no wick recovery"


def _two_candle_break_down(candles: list[dict], level: float, level_name: str) -> tuple[bool, str]:
    """2 consecutive red candles closing below `level`, no wick recovery above it."""
    if level is None or level <= 0:
        return False, f"{level_name} level unavailable"
    if len(candles) < 2:
        return False, "Insufficient candle data (need 2)"

    c1, c2 = candles[-2], candles[-1]

    if not _is_red(c1):
        return False, f"Need 2 red candles below {_fmt(level)} — 0 of 2 (last candle not red)"
    if float(c1["close"]) >= level:
        return False, f"Need 2 red candles below {_fmt(level)} — 0 of 2 (prior close above {level_name})"
    if float(c1["high"]) > level:
        return False, f"Prior candle wicked back above {level_name} {_fmt(level)} — breakdown not held"

    if not _is_red(c2):
        return False, f"Need 2 red candles below {_fmt(level)} — 1 of 2 (waiting on confirmation candle)"
    if float(c2["close"]) >= level:
        return False, f"Need 2 red candles below {_fmt(level)} — 1 of 2 (current close above {level_name})"
    if float(c2["high"]) > level:
        return False, f"Confirmation candle wicked back above {level_name} {_fmt(level)} — breakdown not held"

    return True, f"{level_name} breakdown confirmed — 2 red candles below {_fmt(level)}, no wick recovery"


# ── Setup-specific detectors ────────────────────────────────────────────────

def _check_orh_breakout(candles: list[dict], levels: dict) -> tuple[bool, str]:
    return _two_candle_break_up(candles, levels.get("orh") or levels.get("or_high"), "ORH")


def _check_orl_breakdown(candles: list[dict], levels: dict) -> tuple[bool, str]:
    return _two_candle_break_down(candles, levels.get("orl") or levels.get("or_low"), "ORL")


def _check_vwap_reclaim(candles: list[dict], levels: dict) -> tuple[bool, str]:
    return _two_candle_break_up(candles, levels.get("vwap"), "VWAP")


def _check_vwap_break(candles: list[dict], levels: dict) -> tuple[bool, str]:
    return _two_candle_break_down(candles, levels.get("vwap"), "VWAP")


def _check_pullback_reset(candles: list[dict], levels: dict, direction: str) -> tuple[bool, str]:
    """
    Pullback Reset (E4): after a pullback to VWAP, a DOUBLE GREEN (long) /
    DOUBLE RED (short) reclaim confirms continuation.

    The heavy lifting (extension, wick-failure guards) lives in the engine's
    `_detect_pullback_entry`. Here we confirm the reclaim candle pattern on the
    supplied candles, anchored to VWAP, with no wick recovery through it.
    """
    vwap = levels.get("vwap")
    if vwap is None or vwap <= 0:
        return False, "VWAP unavailable for pullback reset"
    if len(candles) < 2:
        return False, "Insufficient candle data (need 2)"

    if direction == "long":
        ok, msg = _two_candle_break_up(candles, vwap, "VWAP")
        return (ok, "Pullback Reset confirmed — double-green VWAP reclaim" if ok
                else f"Pullback Reset pending — {msg}")
    if direction == "short":
        ok, msg = _two_candle_break_down(candles, vwap, "VWAP")
        return (ok, "Pullback Reset confirmed — double-red VWAP rejection" if ok
                else f"Pullback Reset pending — {msg}")
    return False, "Pullback reset needs a direction"


# ── Convenience: pick the setup from engine context ─────────────────────────

def setup_for_context(bias: Optional[str], or_state: Optional[str],
                      vwap_position: Optional[str]) -> Optional[str]:
    """
    Map engine context to the most relevant trigger setup.

    Priority: an OR break in the bias direction, else a VWAP reclaim/break.
    Returns None when there is no directional bias.
    """
    b = (bias or "").lower()
    if b == "long":
        if or_state == "above":
            return ORH_BREAKOUT
        return VWAP_RECLAIM
    if b == "short":
        if or_state == "below":
            return ORL_BREAKDOWN
        return VWAP_BREAK
    return None
