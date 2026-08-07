"""Central coherence gate for the day-trade decision object.

Every emitted day-trade decision passes through :func:`apply_gate` right before
the workspace response is assembled. The gate enforces the invariants that are a
pure function of the already-computed decision fields, so no view-layer code has
to reconcile contradictions (spec: "fix at the source, not in the view layer").

Covered remediation items:

* **#3  level ordering** — LONG requires ``stop < entry < T1 < T2``; SHORT the
  mirror. A violation sets ``emit_state = INVALID`` and suppresses all levels.
* **#4  minimum reward:risk** — ``rr_t1 = |T1-entry| / |stop-entry|`` must be
  >= 1.5, otherwise ``emit_state = REJECTED`` and levels are suppressed.
* **#8  badge / blockers agreement** — one canonical blockers list is the ONLY
  input to the badge: ``badge == BLOCKED`` iff ``len(blockers) > 0``.
* **#9  phase vs confidence** — ``trade_score < 40`` or ``confidence < 0.30``
  forces ``phase = DISARMED`` and suppresses levels.
* **#10 entry timing** — derived from the clock + blockers, never setup quality.
* **#12 earnings hard block** — a confirmed report within 2 sessions appends an
  ``EARNINGS`` blocker and forces ``DISARMED``.
* **#13 EOD review mode** — when ``generated_at`` falls outside RTH the emit is
  a review snapshot: action/timing fields are suppressed.

The module is deliberately dependency-light (stdlib only) so it is trivially
unit-testable in isolation from the heavy workspace assembler.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, time
from typing import Any

# --- thresholds (single source of truth) -----------------------------------
MIN_RR_T1 = 1.5
MIN_TRADE_SCORE = 40.0          # 0..100 scale
MIN_CONFIDENCE = 0.30           # fraction, 0..1
EXTENSION_CHASE_PCT = 0.005     # 0.5% beyond reference => do not chase
EARNINGS_BLOCK_SESSIONS = 2

# Default intraday entry window closes one hour after the 09:30 ET open.
DEFAULT_WINDOW_END_ET = time(10, 30)
RTH_OPEN_ET = time(9, 30)
RTH_CLOSE_ET = time(16, 0)

LONG = "LONG"
SHORT = "SHORT"

# emit_state values
VALID = "VALID"
INVALID = "INVALID"
REJECTED = "REJECTED"
DISARMED = "DISARMED"

# mode values
LIVE = "LIVE"
EOD_REVIEW = "EOD_REVIEW"


def normalize_direction(value: Any) -> str | None:
    """Map any bias/direction spelling to ``LONG``/``SHORT`` (or ``None``)."""
    s = str(value or "").strip().upper()
    if s in {"LONG", "BUY", "BULL", "BULLISH", "UP"}:
        return LONG
    if s in {"SHORT", "SELL", "BEAR", "BEARISH", "DOWN"}:
        return SHORT
    return None


def _confidence_fraction(confidence: Any) -> float | None:
    """Accept confidence as a 0..1 fraction or a 0..100 percent; return 0..1."""
    if confidence is None:
        return None
    try:
        c = float(confidence)
    except (TypeError, ValueError):
        return None
    return c / 100.0 if c > 1.0 else c


def validate_ordering(
    direction: str | None,
    entry: float | None,
    stop: float | None,
    t1: float | None,
    t2: float | None,
) -> bool:
    """Return True when the level ladder is correctly ordered for *direction*.

    ``t2`` is optional; when present it must extend past ``t1`` in the trade
    direction. Callers should only treat ``False`` as a violation once
    :func:`has_levels` is satisfied.
    """
    if entry is None or stop is None or t1 is None:
        return False
    if direction == LONG:
        ok = stop < entry < t1
        if t2 is not None:
            ok = ok and t1 < t2
        return ok
    if direction == SHORT:
        ok = t1 < entry < stop
        if t2 is not None:
            ok = ok and t2 < t1
        return ok
    return False


def has_levels(entry: float | None, stop: float | None, t1: float | None) -> bool:
    return entry is not None and stop is not None and t1 is not None


def reward_risk_t1(
    entry: float | None, stop: float | None, t1: float | None
) -> float | None:
    """First-target reward:risk. ``None`` when the geometry is incomputable."""
    if entry is None or stop is None or t1 is None:
        return None
    risk = abs(entry - stop)
    if risk <= 1e-9:
        return None
    return abs(t1 - entry) / risk


def _as_time(value: datetime | time) -> time:
    return value.timetz().replace(tzinfo=None) if isinstance(value, datetime) else value


def entry_timing(
    clock: datetime | time,
    blockers: list[str],
    extension_pct: float | None,
    window_end: time = DEFAULT_WINDOW_END_ET,
) -> str:
    """Entry timing from the clock + blockers only (spec #10).

    Never reflects setup quality. Precedence: outside window > extended > good.
    """
    now = _as_time(clock)
    if now > window_end:
        return "Outside Window"
    upper = " ".join(str(b).upper() for b in blockers)
    if "EXTENDED" in upper:
        return "Do Not Chase"
    if extension_pct is not None and extension_pct > EXTENSION_CHASE_PCT:
        return "Do Not Chase"
    return "Good"


def is_rth(dt_et: datetime) -> bool:
    """True when *dt_et* (America/New_York wall clock) is a regular session."""
    if dt_et.weekday() >= 5:  # Sat/Sun
        return False
    t = dt_et.timetz().replace(tzinfo=None)
    return RTH_OPEN_ET <= t <= RTH_CLOSE_ET


def earnings_blocker(
    sessions_until_earnings: int | None, earnings_date: str | None
) -> str | None:
    """Return an ``EARNINGS <date>`` blocker when a report is within 2 sessions."""
    if sessions_until_earnings is None:
        return None
    if 0 <= sessions_until_earnings <= EARNINGS_BLOCK_SESSIONS:
        suffix = f" {earnings_date}" if earnings_date else ""
        return f"EARNINGS{suffix}"
    return None


def _dedupe(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for raw in items:
        s = str(raw).strip()
        if not s:
            continue
        key = s.upper()
        if key in seen:
            continue
        seen.add(key)
        out.append(s)
    return out


def reconcile_badge(blockers: list[str]) -> str:
    """Single source of truth for the BLOCKED badge (spec #8)."""
    return "BLOCKED" if any(str(b).strip() for b in blockers) else "OK"


@dataclass
class GateInput:
    direction: Any = None
    entry: float | None = None
    stop: float | None = None
    t1: float | None = None
    t2: float | None = None
    trade_score: float | None = None       # 0..100
    confidence: Any = None                  # 0..1 fraction or 0..100 percent
    blockers: list[str] = field(default_factory=list)
    generated_at_et: datetime | None = None
    extension_pct: float | None = None
    sessions_until_earnings: int | None = None
    earnings_date: str | None = None
    window_end_et: time = DEFAULT_WINDOW_END_ET


@dataclass
class GateResult:
    emit_state: str
    mode: str
    phase_override: str | None
    suppress_levels: bool
    suppress_action: bool
    rr_t1: float | None
    entry_timing: str | None
    blockers: list[str]
    badge: str
    reasons: list[str]


def apply_gate(gi: GateInput) -> GateResult:
    """Run every invariant and return the reconciled emit decision."""
    direction = normalize_direction(gi.direction)
    reasons: list[str] = []
    blockers = _dedupe(list(gi.blockers))

    # #12 earnings — hard block that also disarms.
    eb = earnings_blocker(gi.sessions_until_earnings, gi.earnings_date)
    if eb:
        blockers = _dedupe(blockers + [eb])

    levels_present = has_levels(gi.entry, gi.stop, gi.t1)
    rr = reward_risk_t1(gi.entry, gi.stop, gi.t1)

    emit_state = VALID
    suppress_levels = False

    # #3 ordering — a geometry violation is the most severe numeric defect.
    if levels_present and not validate_ordering(
        direction, gi.entry, gi.stop, gi.t1, gi.t2
    ):
        emit_state = INVALID
        suppress_levels = True
        reasons.append(
            f"Levels out of order for {direction or 'unknown direction'}"
        )
        blockers = _dedupe(blockers + ["INVALID LEVELS"])
    # #4 reward:risk — only meaningful when geometry is otherwise valid.
    elif levels_present and rr is not None and rr < MIN_RR_T1:
        emit_state = REJECTED
        suppress_levels = True
        reasons.append(f"R:R below minimum ({rr:.2f} < {MIN_RR_T1:.1f})")
        blockers = _dedupe(blockers + [f"R:R {rr:.2f} < {MIN_RR_T1:.1f}"])

    # #9 phase vs confidence — independent disarm, also suppresses levels.
    conf = _confidence_fraction(gi.confidence)
    disarmed = (
        gi.trade_score is not None and gi.trade_score < MIN_TRADE_SCORE
    ) or (conf is not None and conf < MIN_CONFIDENCE)
    if disarmed:
        suppress_levels = True
        if emit_state == VALID:
            emit_state = DISARMED
        reasons.append("Trade score/confidence below arm threshold")

    # #12 earnings forces disarm regardless of score.
    if eb:
        suppress_levels = True
        if emit_state == VALID:
            emit_state = DISARMED
        reasons.append(f"Earnings within {EARNINGS_BLOCK_SESSIONS} sessions")

    phase_override = emit_state if emit_state != VALID else None

    # #13 EOD review — suppress live action/timing outside RTH.
    mode = LIVE
    suppress_action = False
    timing: str | None = None
    if gi.generated_at_et is not None and not is_rth(gi.generated_at_et):
        mode = EOD_REVIEW
        suppress_action = True
    elif gi.generated_at_et is not None:
        # #10 live timing from the clock + blockers.
        timing = entry_timing(
            gi.generated_at_et, blockers, gi.extension_pct, gi.window_end_et
        )

    return GateResult(
        emit_state=emit_state,
        mode=mode,
        phase_override=phase_override,
        suppress_levels=suppress_levels,
        suppress_action=suppress_action,
        rr_t1=rr,
        entry_timing=timing,
        blockers=blockers,
        badge=reconcile_badge(blockers),
        reasons=reasons,
    )
