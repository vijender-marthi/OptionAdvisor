"""
Scenario replay — encodes this week's success metrics from the spec as assertions
against the REAL verdict/trigger/exit code paths.

These replay the *scenarios* (entry discipline + VWAP-break exits), not the exact
historical ticks (1m history requires the live feed). They verify:

  1. MRVL Tuesday entry urge → TRIGGER_PENDING, not GO (trigger not confirmed)
  2. After the trigger actually fires → GO
  3. MRVL Tuesday VWAP reclaim against the held short → CRITICAL EXIT SIGNAL
  4. ARM Thursday VWAP break against the held long → CRITICAL EXIT SIGNAL
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from verdict import Verdict
from verdict_resolver import resolve_verdict
import trigger_detector as td
from exit_signal_engine import ExitSignalEngine, HeldPosition


def _green(o, c, lo=None, hi=None):
    return {"open": o, "close": c, "low": lo if lo is not None else min(o, c), "high": hi if hi is not None else max(o, c)}


def _red(o, c, lo=None, hi=None):
    return {"open": o, "close": c, "low": lo if lo is not None else min(o, c), "high": hi if hi is not None else max(o, c)}


class TestEntryDiscipline(unittest.TestCase):
    """Metric 1 & 2: TRIGGER_PENDING during the entry urge, GO only after trigger."""

    def test_mrvl_entry_urge_is_trigger_pending_not_go(self):
        # Strong score / bias present, but the ORH-reclaim trigger has only 1 of 2 candles.
        candles = [_red(318.5, 317.9), _green(318.1, 318.6, lo=318.05)]  # only the last is green
        fired, msg = td.detect_trigger_fired(td.ORH_BREAKOUT, candles, {"orh": 318.0}, "long")
        self.assertFalse(fired, "trigger must NOT be considered fired on a single candle")

        verdict = resolve_verdict("day", raw_score=7.5, or_breakout="above", trigger_fired=fired)
        self.assertEqual(verdict, Verdict.TRIGGER_PENDING)
        self.assertNotIn(verdict, (Verdict.GO, Verdict.STRONG_GO))

    def test_go_only_after_trigger_confirms(self):
        candles = [_green(318.1, 318.6, lo=318.05), _green(318.7, 319.2, lo=318.6)]  # 2 green, no wick back
        fired, _ = td.detect_trigger_fired(td.ORH_BREAKOUT, candles, {"orh": 318.0}, "long")
        self.assertTrue(fired)
        self.assertEqual(resolve_verdict("day", raw_score=7.5, or_breakout="above", trigger_fired=fired), Verdict.GO)


class TestExitSignals(unittest.TestCase):
    """Metric 3 & 4: a held position breaking VWAP fires a CRITICAL exit."""

    def setUp(self):
        self.eng = ExitSignalEngine()

    def test_mrvl_short_vwap_reclaim_fires_exit(self):
        # Trader short MRVL via puts; price reclaims VWAP against the short → exit.
        pos = HeldPosition("MRVL", "short", entry_price=318.0, stop_price=322.0)
        data = {"MRVL": {"price": 320.5, "vwap": 319.5,
                         "candles_5m": [{"close": 319.8}, {"close": 320.5}]}}
        sigs = self.eng.check_positions([pos], data)
        crit = [s for s in sigs if s.severity == "critical"]
        self.assertTrue(crit, "expected a critical exit on VWAP reclaim against the short")
        self.assertIn("VWAP_BREAK", {s.code for s in crit})

    def test_arm_long_vwap_break_fires_exit(self):
        # Trader long ARM; price loses VWAP → exit.
        pos = HeldPosition("ARM", "long", entry_price=145.0, stop_price=142.0)
        data = {"ARM": {"price": 143.2, "vwap": 144.0,
                        "candles_5m": [{"close": 143.7}, {"close": 143.2}]}}
        sigs = self.eng.check_positions([pos], data)
        crit = [s for s in sigs if s.severity == "critical"]
        self.assertTrue(crit, "expected a critical exit on VWAP break against the long")
        self.assertIn("VWAP_BREAK", {s.code for s in crit})

    def test_healthy_held_position_no_exit(self):
        # Control: a position holding above VWAP must NOT fire an exit.
        pos = HeldPosition("AMD", "long", entry_price=150.0, stop_price=147.0)
        data = {"AMD": {"price": 153.0, "vwap": 151.0,
                        "candles_5m": [{"close": 152.5}, {"close": 153.0}]}}
        crit = [s for s in self.eng.check_positions([pos], data) if s.severity == "critical"]
        self.assertEqual(crit, [])


if __name__ == "__main__":
    unittest.main()
