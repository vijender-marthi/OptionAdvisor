"""
Unit tests for _vwap_hold_state() and related is_chasing integration.

Covers:
  Long bias: CONFIRMED, TESTING, FAILED, NOT_TESTED
  Short bias: CONFIRMED, FAILED
  Integration: vwap_hold_state=TESTING  → build_day_entry_guidance state == VWAP_TEST
  Integration: vwap_hold_state=FAILED   → build_day_entry_guidance state == VWAP_HOLD_FAILED
  is_chasing: correctly set in metrics when price is at +2σ
"""
from __future__ import annotations

import unittest

import numpy as np
import pandas as pd

from day_trade import ET, _vwap_hold_state, build_day_entry_guidance


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_session(
    closes: list[float],
    lows: list[float] | None = None,
    highs: list[float] | None = None,
    volumes: list[float] | None = None,
    vwap_val: float = 100.0,
) -> tuple[pd.DataFrame, pd.Series]:
    """Build a minimal session DataFrame and matching vwap_series."""
    n = len(closes)
    if lows is None:
        lows = [c - 0.10 for c in closes]
    if highs is None:
        highs = [c + 0.10 for c in closes]
    if volumes is None:
        volumes = [100_000.0] * n

    idx = pd.date_range("2026-05-28 09:30", periods=n, freq="1min", tz=ET)
    session = pd.DataFrame(
        {
            "Open":   closes,
            "High":   highs,
            "Low":    lows,
            "Close":  closes,
            "Volume": volumes,
        },
        index=idx,
    )
    vwap = pd.Series([float(vwap_val)] * n, index=idx)
    return session, vwap


def _make_entry_metrics(
    vwap_hold_state: str = "NOT_TESTED",
    vwap_position: str = "at",
    or_breakout: str = "above",
    volume_spike: bool = False,
) -> dict:
    return {
        "last_price": 100.0,
        "vwap": 100.0,
        "or_high": 101.0,
        "or_low": 98.0,
        "or_breakout": or_breakout,
        "or_retest": False,
        "or_historical": "contained",
        "volume_spike": volume_spike,
        "vwap_position": vwap_position,
        "momentum_pct": 0.1,
        "bounce_scenario": "",
        "session_phase": "MID_MORNING",
        "session_high": 100.0,
        "session_low": 100.0,
        "vwap_hold_state": vwap_hold_state,
    }


def _make_trader_decision() -> dict:
    return {"confirmation_needed": [], "label": "NEUTRAL"}


# ---------------------------------------------------------------------------
# _vwap_hold_state — Long bias
# ---------------------------------------------------------------------------

class TestVwapHoldStateLong(unittest.TestCase):

    def test_long_confirmed_green_close_after_vwap_touch(self):
        """Last bar closes above VWAP; prior bar touched VWAP (low <= vwap + tol)."""
        vwap_val = 100.0
        tol = vwap_val * 0.0015  # ~0.15
        # bar -2: low touches VWAP, closes at vwap - tiny (in testing zone)
        # bar -1: closes clearly above VWAP
        closes  = [100.0, 99.99, vwap_val - tol * 0.5, vwap_val + 0.25]
        lows    = [99.8, 99.7, vwap_val - 0.05, vwap_val + 0.05]
        highs   = [100.2, 100.1, vwap_val + 0.30, vwap_val + 0.50]
        session, vwap = _make_session(closes, lows=lows, highs=highs, vwap_val=vwap_val)
        result = _vwap_hold_state(session, vwap, "long", lookback=4)
        self.assertEqual(result, "CONFIRMED")

    def test_long_testing_last_close_within_band(self):
        """Last close is within ±0.15% of VWAP → TESTING."""
        vwap_val = 100.0
        tol = vwap_val * 0.0015
        # Price touched VWAP (low near it) and last close is right at VWAP
        closes = [100.5, 100.3, 100.1, vwap_val + tol * 0.5]
        lows   = [100.0, 99.9, vwap_val - 0.05, vwap_val - 0.02]
        highs  = [100.7, 100.5, 100.3, vwap_val + 0.20]
        session, vwap = _make_session(closes, lows=lows, highs=highs, vwap_val=vwap_val)
        result = _vwap_hold_state(session, vwap, "long", lookback=4)
        self.assertEqual(result, "TESTING")

    def test_long_failed_two_consecutive_closes_below_vwap(self):
        """2+ consecutive closes clearly below VWAP → FAILED."""
        vwap_val = 100.0
        tol = vwap_val * 0.0015
        # Last two bars close 0.5 below VWAP (well outside tolerance)
        closes = [100.5, 100.3, vwap_val - 0.5, vwap_val - 0.5]
        lows   = [100.0, 99.9, vwap_val - 0.8, vwap_val - 0.8]
        highs  = [100.7, 100.5, vwap_val - 0.1, vwap_val - 0.1]
        session, vwap = _make_session(closes, lows=lows, highs=highs, vwap_val=vwap_val)
        result = _vwap_hold_state(session, vwap, "long", lookback=4)
        self.assertEqual(result, "FAILED")

    def test_long_not_tested_price_never_near_vwap(self):
        """Price stayed far above VWAP — low never touched VWAP zone → NOT_TESTED."""
        vwap_val = 100.0
        # Price well above VWAP; lows stay > vwap + 1.0
        closes = [101.5, 101.6, 101.7, 101.8]
        lows   = [101.2, 101.3, 101.4, 101.5]
        highs  = [101.9, 102.0, 102.1, 102.2]
        session, vwap = _make_session(closes, lows=lows, highs=highs, vwap_val=vwap_val)
        result = _vwap_hold_state(session, vwap, "long", lookback=4)
        self.assertEqual(result, "NOT_TESTED")


# ---------------------------------------------------------------------------
# _vwap_hold_state — Short bias
# ---------------------------------------------------------------------------

class TestVwapHoldStateShort(unittest.TestCase):

    def test_short_confirmed_red_close_after_vwap_touch(self):
        """Last bar closes below VWAP; prior bar's high touched VWAP → CONFIRMED."""
        vwap_val = 100.0
        tol = vwap_val * 0.0015
        # bar -2: high touches VWAP (high >= vwap - tol)
        # bar -1: closes clearly below VWAP
        closes = [99.5, 99.6, vwap_val + tol * 0.5, vwap_val - 0.25]
        lows   = [99.2, 99.3, vwap_val - 0.05, vwap_val - 0.50]
        highs  = [99.8, 99.9, vwap_val + 0.05, vwap_val - 0.05]
        session, vwap = _make_session(closes, lows=lows, highs=highs, vwap_val=vwap_val)
        result = _vwap_hold_state(session, vwap, "short", lookback=4)
        self.assertEqual(result, "CONFIRMED")

    def test_short_failed_two_consecutive_closes_above_vwap(self):
        """2+ consecutive closes clearly above VWAP for short bias → FAILED."""
        vwap_val = 100.0
        closes = [99.5, 99.6, vwap_val + 0.5, vwap_val + 0.5]
        lows   = [99.2, 99.3, vwap_val + 0.2, vwap_val + 0.2]
        highs  = [99.8, 99.9, vwap_val + 0.8, vwap_val + 0.8]
        session, vwap = _make_session(closes, lows=lows, highs=highs, vwap_val=vwap_val)
        result = _vwap_hold_state(session, vwap, "short", lookback=4)
        self.assertEqual(result, "FAILED")


# ---------------------------------------------------------------------------
# Edge / boundary cases
# ---------------------------------------------------------------------------

class TestVwapHoldStateEdgeCases(unittest.TestCase):

    def test_returns_not_tested_for_empty_session(self):
        session = pd.DataFrame()
        vwap = pd.Series(dtype=float)
        result = _vwap_hold_state(session, vwap, "long")
        self.assertEqual(result, "NOT_TESTED")

    def test_returns_not_tested_when_fewer_than_two_bars(self):
        vwap_val = 100.0
        session, vwap = _make_session([100.2], vwap_val=vwap_val)
        result = _vwap_hold_state(session, vwap, "long")
        self.assertEqual(result, "NOT_TESTED")

    def test_returns_not_tested_when_vwap_series_is_none(self):
        session, _ = _make_session([100.0, 100.1, 100.2, 100.3])
        result = _vwap_hold_state(session, None, "long")
        self.assertEqual(result, "NOT_TESTED")


# ---------------------------------------------------------------------------
# Integration: vwap_hold_state → build_day_entry_guidance state
# ---------------------------------------------------------------------------

class TestVwapHoldStateIntegration(unittest.TestCase):

    def setUp(self):
        self.td = _make_trader_decision()

    def test_vwap_hold_testing_produces_vwap_test_state(self):
        """When vwap_hold_state=TESTING and price is 'at' VWAP, guidance state = VWAP_TEST."""
        metrics = _make_entry_metrics(
            vwap_hold_state="TESTING",
            vwap_position="at",
        )
        result = build_day_entry_guidance(metrics, self.td, "long")
        self.assertEqual(result["state"], "VWAP_TEST")

    def test_vwap_hold_failed_produces_vwap_hold_failed_state_long(self):
        """When vwap_hold_state=FAILED for long, guidance state = VWAP_HOLD_FAILED."""
        metrics = _make_entry_metrics(
            vwap_hold_state="FAILED",
            vwap_position="at",
        )
        result = build_day_entry_guidance(metrics, self.td, "long")
        self.assertEqual(result["state"], "VWAP_HOLD_FAILED")

    def test_vwap_hold_failed_produces_vwap_hold_failed_state_short(self):
        """When vwap_hold_state=FAILED for short, guidance state = VWAP_HOLD_FAILED."""
        metrics = _make_entry_metrics(
            vwap_hold_state="FAILED",
            vwap_position="at",
            or_breakout="below",
        )
        result = build_day_entry_guidance(metrics, self.td, "short")
        self.assertEqual(result["state"], "VWAP_HOLD_FAILED")

    def test_vwap_hold_failed_state_has_non_empty_avoid(self):
        """VWAP_HOLD_FAILED state must communicate a stand-aside message."""
        metrics = _make_entry_metrics(vwap_hold_state="FAILED", vwap_position="at")
        result = build_day_entry_guidance(metrics, self.td, "long")
        self.assertGreater(len(result.get("avoid", "")), 0)

    def test_vwap_hold_failed_pending_confirmations_mention_vwap(self):
        """VWAP_HOLD_FAILED state should list a confirmation about reclaiming VWAP."""
        metrics = _make_entry_metrics(vwap_hold_state="FAILED", vwap_position="at")
        result = build_day_entry_guidance(metrics, self.td, "long")
        confirmations = result.get("pending_confirmations", [])
        self.assertTrue(
            any("vwap" in c.lower() or "VWAP" in c for c in confirmations),
            f"Expected VWAP mention in confirmations, got: {confirmations}",
        )

    def test_vwap_test_state_pending_confirmations_mention_vwap(self):
        """VWAP_TEST state should also list a VWAP confirmation."""
        metrics = _make_entry_metrics(vwap_hold_state="TESTING", vwap_position="at")
        result = build_day_entry_guidance(metrics, self.td, "long")
        confirmations = result.get("pending_confirmations", [])
        self.assertTrue(
            any("vwap" in c.lower() or "VWAP" in c for c in confirmations),
            f"Expected VWAP mention in confirmations, got: {confirmations}",
        )


# ---------------------------------------------------------------------------
# is_chasing surfaced in metrics
# ---------------------------------------------------------------------------

class TestIsChasingInMetrics(unittest.TestCase):
    """
    Verify that _is_chasing() logic correctly returns True when price is at +2σ.
    We test this via the public _is_chasing helper directly.
    """

    def test_is_chasing_true_when_price_at_upper2sigma(self):
        from day_trade import _is_chasing

        vwap = 100.0
        std = 0.50
        upper2 = vwap + 2 * std  # 101.0
        last_price = upper2 * 0.999  # just at the threshold

        is_chasing, reason = _is_chasing(
            last_price=last_price,
            vwap_upper1=vwap + std,
            vwap_lower1=vwap - std,
            vwap_upper2=upper2,
            vwap_lower2=vwap - 2 * std,
            vwap_std_dev=std,
            momentum_pct=0.2,
            rvol=1.0,
            daily_range_used_pct=50.0,
            or_state="above",
            or_historical="contained",
            session_minutes_elapsed=60,
            bias="long",
            price_structure="TRENDING",
        )
        self.assertTrue(is_chasing, f"Expected is_chasing=True, reason={reason}")

    def test_is_chasing_false_when_price_near_vwap(self):
        from day_trade import _is_chasing

        vwap = 100.0
        std = 0.50
        last_price = vwap + 0.10  # well within 1σ

        is_chasing, reason = _is_chasing(
            last_price=last_price,
            vwap_upper1=vwap + std,
            vwap_lower1=vwap - std,
            vwap_upper2=vwap + 2 * std,
            vwap_lower2=vwap - 2 * std,
            vwap_std_dev=std,
            momentum_pct=0.1,
            rvol=1.0,
            daily_range_used_pct=30.0,
            or_state="above",
            or_historical="contained",
            session_minutes_elapsed=60,
            bias="long",
            price_structure="TRENDING",
        )
        self.assertFalse(is_chasing, f"Expected is_chasing=False, reason={reason}")

    def test_is_chasing_true_when_price_at_lower2sigma_short(self):
        from day_trade import _is_chasing

        vwap = 100.0
        std = 0.50
        lower2 = vwap - 2 * std  # 99.0
        last_price = lower2 * 1.001  # just at the threshold

        is_chasing, reason = _is_chasing(
            last_price=last_price,
            vwap_upper1=vwap + std,
            vwap_lower1=vwap - std,
            vwap_upper2=vwap + 2 * std,
            vwap_lower2=lower2,
            vwap_std_dev=std,
            momentum_pct=-0.2,
            rvol=1.0,
            daily_range_used_pct=50.0,
            or_state="below",
            or_historical="contained",
            session_minutes_elapsed=60,
            bias="short",
            price_structure="TRENDING",
        )
        self.assertTrue(is_chasing, f"Expected is_chasing=True for short at -2σ, reason={reason}")


if __name__ == "__main__":
    unittest.main()
