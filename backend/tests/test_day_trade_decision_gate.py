"""Regression tests for the day-trade decision coherence gate.

Covers acceptance-criteria items #3 (ordering), #4 (R:R), #8 (badge/blockers
agreement), #9 (phase vs confidence), #10 (entry timing), #12 (earnings block),
and #13 (EOD review). Replays the concrete broken snapshots the spec observed
(PLTR/SNDK/GOOGL/AAPL, 2026-08-03..07).
"""

import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from day_trade_decision_gate import (  # noqa: E402
    DISARMED,
    INVALID,
    EOD_REVIEW,
    LIVE,
    MIN_RR_T1,
    REJECTED,
    VALID,
    GateInput,
    apply_gate,
    entry_timing,
    is_rth,
    reconcile_badge,
    reward_risk_t1,
    validate_ordering,
)


def _rth(hour: int, minute: int = 0) -> datetime:
    """A weekday RTH-or-not timestamp (2026-08-07 is a Friday)."""
    return datetime(2026, 8, 7, hour, minute)


# --- #3 ordering ------------------------------------------------------------

def test_ordering_long_valid():
    assert validate_ordering("LONG", 100.0, 99.0, 101.0, 102.0) is True


def test_ordering_long_target_below_entry_is_invalid():
    # Observed PLTR-style: long with T1 below entry.
    assert validate_ordering("LONG", 168.81, 167.0, 167.62, 170.0) is False


def test_ordering_short_valid():
    assert validate_ordering("SHORT", 100.0, 101.0, 99.0, 98.0) is True


def test_gate_marks_out_of_order_long_invalid_and_suppresses():
    res = apply_gate(
        GateInput(
            direction="Bullish",
            entry=168.81,
            stop=167.0,
            t1=167.62,  # below entry -> violation
            t2=170.0,
            trade_score=80,
            confidence=0.8,
            generated_at_et=_rth(10, 0),
        )
    )
    assert res.emit_state == INVALID
    assert res.suppress_levels is True
    assert res.phase_override == INVALID


# --- #4 reward:risk ---------------------------------------------------------

def test_rr_below_minimum_is_rejected_and_suppressed():
    # Observed SNDK 2026-08-04: entry 1420.48, stop 1506.60, T1 1402.90 (SHORT).
    rr = reward_risk_t1(1420.48, 1506.60, 1402.90)
    assert rr is not None and rr < MIN_RR_T1  # ~0.20
    res = apply_gate(
        GateInput(
            direction="Bearish",
            entry=1420.48,
            stop=1506.60,
            t1=1402.90,
            t2=1380.0,
            trade_score=70,
            confidence=0.7,
            generated_at_et=_rth(10, 0),
        )
    )
    assert res.emit_state == REJECTED
    assert res.suppress_levels is True
    assert any("R:R" in b for b in res.blockers)


def test_rr_at_minimum_passes():
    res = apply_gate(
        GateInput(
            direction="Bullish",
            entry=100.0,
            stop=99.0,
            t1=101.5,  # rr = 1.5 exactly
            t2=103.0,
            trade_score=80,
            confidence=0.8,
            generated_at_et=_rth(10, 0),
        )
    )
    assert res.emit_state == VALID
    assert res.suppress_levels is False


# --- #8 badge / blockers agreement -----------------------------------------

def test_badge_blocked_iff_blockers_present():
    assert reconcile_badge([]) == "OK"
    assert reconcile_badge(["  "]) == "OK"
    assert reconcile_badge(["ATR>120%"]) == "BLOCKED"


def test_gate_badge_agrees_with_canonical_blockers():
    # Blockers empty + clean setup -> badge OK.
    clean = apply_gate(
        GateInput(
            direction="Bullish", entry=100, stop=99, t1=101.5, t2=103,
            trade_score=80, confidence=0.8, generated_at_et=_rth(10),
        )
    )
    assert clean.badge == ("BLOCKED" if clean.blockers else "OK")
    # A rejected setup pushes a blocker -> badge must flip to BLOCKED.
    rejected = apply_gate(
        GateInput(
            direction="Bullish", entry=100, stop=99, t1=100.2, t2=100.5,
            trade_score=80, confidence=0.8, generated_at_et=_rth(10),
        )
    )
    assert rejected.blockers  # non-empty
    assert rejected.badge == "BLOCKED"


# --- #9 phase vs confidence -------------------------------------------------

def test_low_confidence_disarms_and_suppresses():
    # Observed SNDK: Phase Armed @ Confidence 0%.
    res = apply_gate(
        GateInput(
            direction="Bearish", entry=1420, stop=1440, t1=1390, t2=1360,
            trade_score=60, confidence=0.0, generated_at_et=_rth(10),
        )
    )
    assert res.phase_override == DISARMED
    assert res.suppress_levels is True


def test_low_trade_score_disarms():
    res = apply_gate(
        GateInput(
            direction="Bullish", entry=100, stop=99, t1=102, t2=103,
            trade_score=19, confidence=0.6, generated_at_et=_rth(10),
        )
    )
    assert res.phase_override == DISARMED
    assert res.suppress_levels is True


def test_confidence_accepts_percent_scale():
    # 19 (percent) must be read as 0.19 fraction, i.e. below the 0.30 gate.
    res = apply_gate(
        GateInput(
            direction="Bullish", entry=100, stop=99, t1=102, t2=103,
            trade_score=80, confidence=19, generated_at_et=_rth(10),
        )
    )
    assert res.phase_override == DISARMED


# --- #10 entry timing -------------------------------------------------------

def test_timing_outside_window():
    # Observed AAPL: "Good" at 13:18 ET while window ends 10:30 ET.
    assert entry_timing(_rth(13, 18), [], None) == "Outside Window"


def test_timing_do_not_chase_on_extended_blocker():
    assert entry_timing(_rth(10, 0), ["ATR>120%", "EXTENDED"], None) == "Do Not Chase"


def test_timing_do_not_chase_on_extension_pct():
    assert entry_timing(_rth(10, 0), [], 0.01) == "Do Not Chase"


def test_timing_good_in_window_not_extended():
    assert entry_timing(_rth(10, 0), [], 0.0) == "Good"


# --- #12 earnings hard block ------------------------------------------------

def test_earnings_within_two_sessions_disarms():
    res = apply_gate(
        GateInput(
            direction="Bearish", entry=1420, stop=1440, t1=1390, t2=1360,
            trade_score=70, confidence=0.7, generated_at_et=_rth(10),
            sessions_until_earnings=1, earnings_date="2026-08-08",
        )
    )
    assert res.phase_override == DISARMED
    assert res.suppress_levels is True
    assert any(b.startswith("EARNINGS") for b in res.blockers)
    assert res.badge == "BLOCKED"


def test_earnings_far_out_does_not_block():
    res = apply_gate(
        GateInput(
            direction="Bullish", entry=100, stop=99, t1=102, t2=103,
            trade_score=80, confidence=0.8, generated_at_et=_rth(10),
            sessions_until_earnings=9, earnings_date="2026-08-20",
        )
    )
    assert res.emit_state == VALID
    assert not any(b.startswith("EARNINGS") for b in res.blockers)


# --- #13 EOD review ---------------------------------------------------------

def test_after_hours_is_eod_review_and_suppresses_action():
    # Observed: "Generated 5:58:59 PM PDT" with live WAIT/Good fields.
    res = apply_gate(
        GateInput(
            direction="Bullish", entry=100, stop=99, t1=102, t2=103,
            trade_score=80, confidence=0.8, generated_at_et=_rth(17, 58),
        )
    )
    assert res.mode == EOD_REVIEW
    assert res.suppress_action is True
    assert res.entry_timing is None


def test_rth_boundaries():
    assert is_rth(_rth(9, 30)) is True
    assert is_rth(_rth(16, 0)) is True
    assert is_rth(_rth(9, 29)) is False
    assert is_rth(_rth(16, 1)) is False
    # Weekend (2026-08-08 is a Saturday).
    assert is_rth(datetime(2026, 8, 8, 11, 0)) is False


def test_live_rth_has_timing():
    res = apply_gate(
        GateInput(
            direction="Bullish", entry=100, stop=99, t1=102, t2=103,
            trade_score=80, confidence=0.8, generated_at_et=_rth(10),
        )
    )
    assert res.mode == LIVE
    assert res.entry_timing == "Good"
