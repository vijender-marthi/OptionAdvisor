"""
verdict_resolver.py — Single function that resolves a unified Verdict.

Priority rules (applied in order, first match wins):

  1. VIX extreme (>40) or explicit AVOID signal           → AVOID
  2. STRONG GO day verdict + supportive market            → STRONG_GO
  3. GO / READY / enter signal + market not weak          → GO
  4. WATCH / partial setup / needs confirmation           → WATCH
  5. WAIT / setup exists but timing is wrong              → WAIT
  6. NO-GO / avoid / very weak setup                      → AVOID
  7. Default (no clear edge, missing data)                → NO_EDGE

This module is the ONLY place that produces a Verdict.
All engines call resolve_verdict_*() instead of computing their own verdict strings.
"""
from __future__ import annotations

from typing import Any

from verdict import Verdict


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _up(v: Any) -> str:
    return str(v or "").upper().strip()


# ---------------------------------------------------------------------------
# Day trade resolver
# ---------------------------------------------------------------------------

def resolve_verdict_day(scan: Any) -> Verdict:
    """
    Resolves a unified Verdict from a DayTradeScan object.

    Priority:
      1. VIX extreme → AVOID
      2. trader_decision.suggested_action (DQL layer has more context than raw verdict)
      3. raw scan.verdict
    """
    m = getattr(scan, "metrics", {}) or {}
    td = getattr(scan, "trader_decision", {}) or {}
    raw_verdict = _up(getattr(scan, "verdict", ""))
    suggested   = _up(td.get("suggested_action", ""))

    # Rule 1: extreme VIX
    vix = m.get("vix") or 0
    try:
        vix = float(vix)
    except (TypeError, ValueError):
        vix = 0
    if vix >= 40:
        return "AVOID"

    # Rule 2-6: trader_decision takes priority over raw verdict
    _TD_MAP: dict[str, Verdict] = {
        "WATCH_LONG_ONLY":       "WATCH",
        "WATCH_PUT_BREAKDOWN":   "WATCH",
        "WAIT_FOR_CONFIRMATION": "WAIT",
        "NO_TRADE":              "WAIT",
        "AVOID_CALLS":           "AVOID",
        "AVOID_CHASING_PUTS":    "AVOID",
    }
    if suggested in _TD_MAP:
        verdict = _TD_MAP[suggested]
        # Upgrade WATCH → STRONG_GO only when raw scan says STRONG GO
        # (trader_decision may not downgrade a STRONG GO if it gave no explicit action)
        if raw_verdict == "STRONG GO" and verdict not in ("AVOID", "WAIT"):
            return "STRONG_GO"
        return verdict

    # Rule 3: raw scan verdict
    return _map_raw_to_verdict(raw_verdict)


def _map_raw_to_verdict(raw: str) -> Verdict:
    v = _up(raw)
    if v == "STRONG GO":
        return "STRONG_GO"
    if v in ("GO", "READY", "ENTER", "TRADE"):
        return "GO"
    if v == "WATCH":
        return "WATCH"
    if v == "WAIT":
        return "WAIT"
    if v in ("NO-GO", "NO GO", "AVOID", "NO_TRADE", "AVOID_CALLS", "AVOID_CHASING_PUTS"):
        return "AVOID"
    if v in ("EXTENDED",):
        # Extended price: can still be watched but risky — treat as WATCH
        return "WATCH"
    return "NO_EDGE"


# ---------------------------------------------------------------------------
# Swing trade resolver
# ---------------------------------------------------------------------------

def resolve_verdict_swing(scan: Any) -> Verdict:
    """
    Resolves a unified Verdict from a swing trade scan object.
    """
    raw_verdict = _up(getattr(scan, "verdict", ""))
    m = getattr(scan, "metrics", {}) or {}

    # VIX extreme
    vix = m.get("vix") or 0
    try:
        vix = float(vix)
    except (TypeError, ValueError):
        vix = 0
    if vix >= 40:
        return "AVOID"

    # Check for explicit STRONG GO / strong setup
    setup_quality = _up(m.get("setup_quality") or m.get("quality") or "")
    if raw_verdict in ("STRONG GO", "STRONG_GO") or (raw_verdict == "GO" and setup_quality == "STRONG"):
        return "STRONG_GO"

    return _map_raw_to_verdict(raw_verdict)


# ---------------------------------------------------------------------------
# Regular trade resolver
# ---------------------------------------------------------------------------

def resolve_verdict_regular(total_score: float, candidates_count: int = 0) -> Verdict:
    """
    Resolves a unified Verdict from a regular (options strategy) trade score.
    """
    if candidates_count == 0:
        return "NO_EDGE"
    if total_score >= 80:
        return "STRONG_GO"
    if total_score >= 60:
        return "GO"
    if total_score >= 45:
        return "WATCH"
    if total_score >= 30:
        return "WAIT"
    return "AVOID"


# ---------------------------------------------------------------------------
# Generic resolver from a final_decision string (used by command center /
# decision_resolver output)
# ---------------------------------------------------------------------------

def resolve_verdict_from_final_decision(
    final_decision: str,
    setup_quality: str = "",
    risk_state: str = "",
) -> Verdict:
    """
    Maps decision_resolver's final_decision + quality/risk to a unified Verdict.
    Used when re-serializing ResolvedTradeDecision for the command center.
    """
    fd  = _up(final_decision)
    sq  = _up(setup_quality)
    rs  = _up(risk_state)

    # Extreme risk always overrides
    if rs in ("EXTREME", "HIGH") and fd not in ("READY", "TRADE"):
        if fd in ("AVOID", "NO_EDGE"):
            return "AVOID"

    if fd in ("READY", "TRADE"):
        if sq == "STRONG":
            return "STRONG_GO"
        return "GO"
    if fd == "WATCH":
        return "WATCH"
    if fd == "WAIT":
        return "WAIT"
    if fd in ("AVOID", "EXIT", "SCALE_OUT"):
        return "AVOID"
    if fd in ("MANAGE",):
        return "WATCH"  # active position management = watch
    if fd == "NO_EDGE":
        return "NO_EDGE"

    return "NO_EDGE"
