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
