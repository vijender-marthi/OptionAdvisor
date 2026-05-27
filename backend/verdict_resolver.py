"""
Single verdict resolver — ONE function that produces the final verdict
for any engine (day, swing, regular). No more scattered logic.
"""
from __future__ import annotations

from typing import Optional

from verdict import Verdict


def resolve_verdict(
    engine_type: str,
    raw_score: float,
    *,
    volume_spike: bool = False,
    vix: Optional[float] = None,
    rvol: Optional[float] = None,
    or_breakout: Optional[str] = None,
    price_structure: Optional[str] = None,
) -> Verdict:
    """
    ONE function that produces the final verdict for any engine.

    Rules in priority order:

    1. VIX >= 35 → AVOID (any engine)
    2. raw_score < 3.0 → NO_EDGE
    3. raw_score < 5.0 → WAIT
    4. raw_score >= 8.0 and volume_spike → STRONG_GO
    5. raw_score >= 6.0 → GO
    6. raw_score >= 4.5 → WATCH
    7. Otherwise → WAIT

    Swing-specific:
    - rvol < 0.7 → downgrade GO to WATCH
    - price_structure mismatch → downgrade one level

    Day-specific:
    - or_breakout not in ("above","below") → cannot be STRONG_GO
    """
    eng = engine_type.lower().strip()

    # Rule 1: VIX hard veto
    if vix is not None and vix >= 35:
        return Verdict.AVOID

    # Rule 2: No edge
    if raw_score < 3.0:
        return Verdict.NO_EDGE

    # Rule 3: Very weak
    if raw_score < 5.0:
        return Verdict.WAIT

    # Day-specific: cannot be STRONG_GO without OR breakout
    _can_be_strong = True
    if eng == "day" and or_breakout not in ("above", "below"):
        _can_be_strong = False

    # Rule 4: STRONG_GO
    if raw_score >= 8.0 and volume_spike and _can_be_strong:
        return Verdict.STRONG_GO

    # Rule 5: GO
    if raw_score >= 6.0:
        # Swing-specific: weak volume → downgrade GO to WATCH
        if eng == "swing" and rvol is not None and rvol < 0.7:
            return Verdict.WATCH
        return Verdict.GO

    # Rule 6: WATCH
    if raw_score >= 4.5:
        return Verdict.WATCH

    # Rule 7: WAIT
    return Verdict.WAIT


_RAW_MAP: dict[str, str] = {
    "STRONG_GO":   "STRONG_GO",
    "STRONG GO":   "STRONG_GO",
    "QUALITY_LONG": "GO",
    "READY":       "GO",
    "ENTER":       "GO",
    "TRADE":       "GO",
    "GO":          "GO",
    "WATCH":       "WATCH",
    "EXTENDED":    "WATCH",
    "MANAGE":      "WATCH",
    "WAIT":        "WAIT",
    "AVOID":       "AVOID",
    "NO_GO":       "AVOID",
    "NO-GO":       "AVOID",
    "NO GO":       "AVOID",
    "NO_TRADE":    "AVOID",
    "EXIT":        "AVOID",
    "SCALE_OUT":   "AVOID",
}


def _map_raw_to_verdict(raw: str) -> str:
    """Normalize any raw verdict/signal string to a canonical verdict string."""
    v = str(raw or "").strip().upper().replace("-", "_").replace(" ", "_")
    if v in _RAW_MAP:
        return _RAW_MAP[v]
    v2 = str(raw or "").strip().upper()
    if v2 in _RAW_MAP:
        return _RAW_MAP[v2]
    return "NO_EDGE"


# Trader-decision action → verdict mapping (day engine)
_TD_MAP: dict[str, str] = {
    "STRONG_GO":             "STRONG_GO",
    "GO_LONG":               "GO",
    "GO_SHORT":              "GO",
    "WATCH_LONG_ONLY":       "WATCH",
    "WATCH_SHORT_ONLY":      "WATCH",
    "WAIT_FOR_CONFIRMATION": "WAIT",
    "WAIT_FOR_SETUP":        "WAIT",
    "NO_TRADE":              "WAIT",
    "AVOID_CALLS":           "AVOID",
    "AVOID_PUTS":            "AVOID",
    "AVOID_NAKED_CALLS":     "AVOID",
    "AVOID_CHASING_PUTS":    "AVOID",
    "AVOID_CHASE":           "AVOID",
    "AVOID":                 "AVOID",
}


def resolve_verdict_day(scan: object) -> str:
    """Return canonical verdict string for a day-trade scan object."""
    metrics = getattr(scan, "metrics", None) or {}
    vix = metrics.get("vix") if isinstance(metrics, dict) else None
    if vix is not None and float(vix) >= 40:
        return "AVOID"

    raw = _map_raw_to_verdict(str(getattr(scan, "verdict", "") or ""))

    td = getattr(scan, "trader_decision", None) or {}
    if isinstance(td, dict):
        sa = str(td.get("suggested_action", "") or "").upper().replace(" ", "_")
    else:
        sa = str(getattr(td, "suggested_action", "") or "").upper().replace(" ", "_")

    td_verdict = _TD_MAP.get(sa)

    # Raw STRONG_GO overrides trader WATCH/WAIT but not AVOID
    if raw == "STRONG_GO" and td_verdict not in ("AVOID",):
        return "STRONG_GO"

    if td_verdict:
        return td_verdict

    return raw if raw != "NO_EDGE" else "WAIT"


def resolve_verdict_swing(scan: object) -> str:
    """Return canonical verdict string for a swing-trade scan object."""
    metrics = getattr(scan, "metrics", None) or {}
    vix = metrics.get("vix") if isinstance(metrics, dict) else None
    if vix is not None and float(vix) >= 40:
        return "AVOID"

    raw = _map_raw_to_verdict(str(getattr(scan, "verdict", "") or ""))

    # Strong setup upgrades GO → STRONG_GO
    sq = ""
    if isinstance(metrics, dict):
        sq = str(metrics.get("setup_quality", "") or "").upper()
    if raw == "GO" and "STRONG" in sq:
        return "STRONG_GO"

    return raw


def resolve_verdict_regular(total_score: float, candidates_count: int = 0) -> str:
    """Return canonical verdict for a regular/options engine score."""
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


def resolve_verdict_from_final_decision(
    final_decision: str,
    setup_quality: str = "",
    risk_state: str = "",
) -> str:
    """Map a resolver final_decision string to a canonical verdict string."""
    fd = str(final_decision or "").upper().replace(" ", "_").replace("-", "_")
    _FD_MAP: dict[str, str] = {
        "STRONG_GO": "STRONG_GO",
        "READY":     "GO",
        "TRADE":     "GO",
        "GO":        "GO",
        "WATCH":     "WATCH",
        "MANAGE":    "WATCH",
        "WAIT":      "WAIT",
        "AVOID":     "AVOID",
        "EXIT":      "AVOID",
        "SCALE_OUT": "AVOID",
        "NO_EDGE":   "NO_EDGE",
    }
    result = _FD_MAP.get(fd)
    if result is None:
        return "NO_EDGE"
    # READY + STRONG setup → upgrade to STRONG_GO
    if result == "GO" and "STRONG" in str(setup_quality or "").upper():
        return "STRONG_GO"
    return result
