"""
Tests for trigger-aware verdicts, trigger_detector, and the exit signal engine.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from verdict import Verdict
from verdict_resolver import resolve_verdict
import trigger_detector as td
from day_trade import build_timeframe_state
from exit_signal_engine import ExitSignalEngine, HeldPosition


def _green(o, c, lo=None, hi=None):
    return {"open": o, "close": c, "low": lo if lo is not None else min(o, c), "high": hi if hi is not None else max(o, c)}


def _red(o, c, lo=None, hi=None):
    return {"open": o, "close": c, "low": lo if lo is not None else min(o, c), "high": hi if hi is not None else max(o, c)}


# ── Fix 2: trigger-aware resolve_verdict ────────────────────────────────────
class TestTriggerAwareVerdict(unittest.TestCase):
    def test_day_go_score_without_trigger_is_pending(self):
        v = resolve_verdict("day", raw_score=7.0, or_breakout="above", trigger_fired=False)
        self.assertEqual(v, Verdict.TRIGGER_PENDING)

    def test_day_go_score_with_trigger_is_go(self):
        v = resolve_verdict("day", raw_score=7.0, or_breakout="above", trigger_fired=True)
        self.assertEqual(v, Verdict.GO)

    def test_day_strong_go_requires_trigger(self):
        self.assertEqual(
            resolve_verdict("day", raw_score=9.0, volume_spike=True, or_breakout="above", trigger_fired=False),
            Verdict.TRIGGER_PENDING,
        )
        self.assertEqual(
            resolve_verdict("day", raw_score=9.0, volume_spike=True, or_breakout="above", trigger_fired=True),
            Verdict.STRONG_GO,
        )

    def test_day_watch_band_not_gated(self):
        # 4.5 <= score < 6 → WATCH regardless of trigger
        self.assertEqual(resolve_verdict("day", raw_score=5.0, trigger_fired=False), Verdict.WATCH)

    def test_swing_go_not_trigger_gated(self):
        # Swing never uses candle triggers — must still GO without trigger_fired
        self.assertEqual(resolve_verdict("swing", raw_score=7.0, trigger_fired=False), Verdict.GO)

    def test_regular_go_not_trigger_gated(self):
        self.assertEqual(resolve_verdict("regular", raw_score=7.0, trigger_fired=False), Verdict.GO)

    def test_vix_veto_beats_pending(self):
        self.assertEqual(resolve_verdict("day", raw_score=9.0, vix=40.0, trigger_fired=False), Verdict.AVOID)


# ── Fix 3: trigger_detector ─────────────────────────────────────────────────
class TestTriggerDetector(unittest.TestCase):
    def test_orh_breakout_two_green_fires(self):
        candles = [_green(98, 99), _green(100.1, 100.5, lo=100.05), _green(100.6, 101.0, lo=100.5)]
        fired, msg = td.detect_trigger_fired(td.ORH_BREAKOUT, candles, {"orh": 100.0}, "long")
        self.assertTrue(fired, msg)

    def test_orh_breakout_one_green_pending(self):
        candles = [_red(101, 100.6), _green(100.6, 101.0, lo=100.5)]
        fired, msg = td.detect_trigger_fired(td.ORH_BREAKOUT, candles, {"orh": 100.0}, "long")
        self.assertFalse(fired)
        self.assertIn("0 of 2", msg)

    def test_orh_breakout_wick_recovery_blocks(self):
        # second candle wicks back below ORH → not held
        candles = [_green(100.1, 100.5, lo=100.05), _green(100.6, 101.0, lo=99.8)]
        fired, msg = td.detect_trigger_fired(td.ORH_BREAKOUT, candles, {"orh": 100.0}, "long")
        self.assertFalse(fired)
        self.assertIn("wick", msg.lower())

    def test_orl_breakdown_two_red_fires(self):
        candles = [_red(100.0, 99.5, hi=99.95), _red(99.4, 99.0, hi=99.45)]
        fired, msg = td.detect_trigger_fired(td.ORL_BREAKDOWN, candles, {"orl": 100.0}, "short")
        self.assertTrue(fired, msg)

    def test_orl_breakdown_wick_recovery_blocks(self):
        candles = [_red(100.0, 99.5, hi=99.95), _red(99.4, 99.0, hi=100.3)]
        fired, _ = td.detect_trigger_fired(td.ORL_BREAKDOWN, candles, {"orl": 100.0}, "short")
        self.assertFalse(fired)

    def test_vwap_reclaim_long(self):
        candles = [_green(50.0, 50.4, lo=50.05), _green(50.5, 50.9, lo=50.4)]
        fired, _ = td.detect_trigger_fired(td.VWAP_RECLAIM, candles, {"vwap": 50.0}, "long")
        self.assertTrue(fired)

    def test_vwap_break_short(self):
        candles = [_red(50.0, 49.6, hi=49.95), _red(49.5, 49.1, hi=49.55)]
        fired, _ = td.detect_trigger_fired(td.VWAP_BREAK, candles, {"vwap": 50.0}, "short")
        self.assertTrue(fired)

    def test_pullback_reset_long_double_green(self):
        candles = [_green(50.0, 50.4, lo=50.05), _green(50.5, 50.9, lo=50.4)]
        fired, msg = td.detect_trigger_fired(td.PULLBACK_RESET, candles, {"vwap": 50.0}, "long")
        self.assertTrue(fired, msg)

    def test_setup_for_context(self):
        self.assertEqual(td.setup_for_context("long", "above", "above"), td.ORH_BREAKOUT)
        self.assertEqual(td.setup_for_context("long", "inside", "below"), td.VWAP_RECLAIM)
        self.assertEqual(td.setup_for_context("short", "below", "below"), td.ORL_BREAKDOWN)
        self.assertEqual(td.setup_for_context("short", "inside", "above"), td.VWAP_BREAK)
        self.assertIsNone(td.setup_for_context(None, "inside", "above"))

    def test_insufficient_data(self):
        fired, msg = td.detect_trigger_fired(td.ORH_BREAKOUT, [_green(100.1, 100.5)], {"orh": 100.0}, "long")
        self.assertFalse(fired)


# ── Explicit multi-timeframe day-trade hierarchy ─────────────────────────────
class TestDayTradeTimeframeState(unittest.TestCase):
    def _state(self, **overrides):
        base = {
            "bias": "long",
            "soft_edge": True,
            "or_state": "above",
            "or_historical": "broke_up",
            "or_high": 100.0,
            "or_low": 98.0,
            "vwap": 99.0,
            "trigger_setup": td.ORH_BREAKOUT,
            "trigger_fired": False,
            "trigger_requirement": "Need 2 green candles above $100.00",
            "candles_5m": [_green(100.1, 100.4, lo=100.05), _red(100.4, 100.2, lo=100.1)],
            "volume_spike": True,
            "entry_guidance": {"should_enter_now": "NO", "summary": "Waiting", "action": "Wait"},
            "is_chasing": False,
            "edge_state": "DEVELOPING",
        }
        base.update(overrides)
        return build_timeframe_state(**base)

    def test_15m_setup_but_5m_pending_is_track_only(self):
        state = self._state()
        self.assertEqual(state["setup_15m"]["status"], "SETUP_ACTIVE")
        self.assertEqual(state["confirmation_5m"]["status"], "PENDING")
        self.assertEqual(state["final_decision"], "TRACK_ONLY")

    def test_5m_failed_is_no_trade(self):
        state = self._state(
            candles_5m=[_red(100.5, 100.1, hi=100.6), _red(100.1, 99.8, hi=100.2)],
            trigger_requirement="5m candles failed",
        )
        self.assertEqual(state["confirmation_5m"]["status"], "FAILED")
        self.assertEqual(state["final_decision"], "NO_TRADE")

    def test_5m_confirmed_but_1m_chase_is_do_not_chase(self):
        state = self._state(
            trigger_fired=True,
            trigger_requirement="ORH break confirmed",
            candles_5m=[_green(100.1, 100.5, lo=100.05), _green(100.5, 101.0, lo=100.4)],
            entry_guidance={"should_enter_now": "YES", "action": "Enter"},
            is_chasing=True,
            edge_state="LATE",
            chase_reason="Price extended from ORH",
        )
        self.assertEqual(state["confirmation_5m"]["status"], "CONFIRMED")
        self.assertEqual(state["execution_1m"]["status"], "DO_NOT_CHASE")
        self.assertEqual(state["final_decision"], "DO_NOT_CHASE")

    def test_all_aligned_is_go(self):
        state = self._state(
            trigger_fired=True,
            trigger_requirement="ORH break confirmed",
            candles_5m=[_green(100.1, 100.5, lo=100.05), _green(100.5, 101.0, lo=100.4)],
            entry_guidance={"should_enter_now": "YES", "action": "Execute with stop"},
        )
        self.assertEqual(state["execution_1m"]["status"], "READY")
        self.assertEqual(state["final_decision"], "GO")


# ── Fix 4: exit signal engine ───────────────────────────────────────────────
class TestExitSignalEngine(unittest.TestCase):
    def setUp(self):
        self.eng = ExitSignalEngine()

    def test_long_vwap_break_critical(self):
        pos = HeldPosition("MRVL", "long", entry_price=100.0, stop_price=98.0)
        data = {"MRVL": {"price": 99.0, "vwap": 99.5,
                         "candles_5m": [{"close": 99.3}, {"close": 99.1}]}}
        sigs = self.eng.check_positions([pos], data)
        codes = {s.code for s in sigs}
        self.assertIn("VWAP_BREAK", codes)
        self.assertTrue(any(s.severity == "critical" for s in sigs))

    def test_open_day_position_with_vwap_failure_is_exit_now(self):
        pos = HeldPosition("MRVL", "long", entry_price=100.0, stop_price=98.0, position_type="day")
        data = {"MRVL": {"price": 99.0, "vwap": 99.5,
                         "candles_5m": [{"close": 99.3}, {"close": 99.1}]}}
        sigs = self.eng.check_positions([pos], data)
        vwap = next(s for s in sigs if s.code == "VWAP_BREAK")
        self.assertEqual(vwap.severity, "critical")
        self.assertIn("EXIT IMMEDIATELY", vwap.recommended_action)

    def test_long_stop_hit_critical(self):
        pos = HeldPosition("ARM", "long", entry_price=100.0, stop_price=98.0)
        data = {"ARM": {"price": 97.5, "vwap": 99.0, "candles_5m": [{"close": 99.2}, {"close": 99.1}]}}
        sigs = self.eng.check_positions([pos], data)
        self.assertIn("STOP_HIT", {s.code for s in sigs})

    def test_long_no_signal_when_healthy(self):
        pos = HeldPosition("AMD", "long", entry_price=100.0, stop_price=98.0, target_price=110.0)
        data = {"AMD": {"price": 102.0, "vwap": 100.5,
                        "candles_5m": [{"close": 101.5}, {"close": 102.0}]}}
        sigs = self.eng.check_positions([pos], data)
        self.assertEqual([s for s in sigs if s.severity == "critical"], [])

    def test_long_approaching_vwap_warning(self):
        pos = HeldPosition("NVDA", "long", entry_price=100.0, stop_price=98.0)
        data = {"NVDA": {"price": 100.3, "vwap": 100.0,
                         "candles_5m": [{"close": 100.6}, {"close": 100.3}]}}
        sigs = self.eng.check_positions([pos], data)
        self.assertIn("APPROACH_VWAP", {s.code for s in sigs})

    def test_short_vwap_reclaim_critical(self):
        pos = HeldPosition("MRVL", "short", entry_price=100.0, stop_price=102.0)
        data = {"MRVL": {"price": 101.0, "vwap": 100.5,
                         "candles_5m": [{"close": 100.7}, {"close": 101.0}]}}
        sigs = self.eng.check_positions([pos], data)
        self.assertIn("VWAP_BREAK", {s.code for s in sigs})

    def test_short_stop_hit(self):
        pos = HeldPosition("MRVL", "short", entry_price=100.0, stop_price=102.0)
        data = {"MRVL": {"price": 102.5, "vwap": 101.0, "candles_5m": [{"close": 101.0}, {"close": 101.5}]}}
        sigs = self.eng.check_positions([pos], data)
        self.assertIn("STOP_HIT", {s.code for s in sigs})

    def test_pnl_estimate_from_premium(self):
        pos = HeldPosition("ARM", "long", entry_price=100.0, entry_premium=2.0, stop_price=98.0, contracts=3)
        data = {"ARM": {"price": 97.0, "vwap": 99.0, "premium": 1.2,
                        "candles_5m": [{"close": 98.5}, {"close": 98.0}]}}
        sigs = self.eng.check_positions([pos], data)
        stop = next(s for s in sigs if s.code == "STOP_HIT")
        self.assertAlmostEqual(stop.pnl_estimate, (1.2 - 2.0) * 100 * 3, places=2)

    def test_day_option_premium_loss_critical(self):
        pos = HeldPosition("ARM", "long", entry_price=100.0, entry_premium=2.0, contracts=1)
        data = {"ARM": {"price": 99.0, "vwap": 98.0, "premium": 1.35,
                        "candles_5m": [{"close": 99.2}, {"close": 99.0}]}}
        sigs = self.eng.check_positions([pos], data)
        self.assertIn("PREMIUM_LOSS", {s.code for s in sigs})

    def test_eod_time_stop_warning(self):
        pos = HeldPosition("AMD", "long", entry_price=100.0, stop_price=98.0)
        data = {"AMD": {"price": 101.0, "vwap": 100.0, "minutes_to_close": 10,
                        "candles_5m": [{"close": 100.8}, {"close": 101.0}]}}
        sigs = self.eng.check_positions([pos], data)
        self.assertIn("TIME_STOP", {s.code for s in sigs})

    def test_missing_market_data_skipped(self):
        pos = HeldPosition("XYZ", "long", entry_price=100.0, stop_price=98.0)
        self.assertEqual(self.eng.check_positions([pos], {}), [])


if __name__ == "__main__":
    unittest.main()
