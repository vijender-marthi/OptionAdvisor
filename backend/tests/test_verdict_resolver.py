"""
Tests for verdict.py and verdict_resolver.py.

Covers all four resolver functions and the key priority rules:
  - VIX extreme override
  - trader_decision DQL layer override (day)
  - STRONG GO / setup_quality upgrade (swing)
  - Score thresholds (regular)
  - final_decision mapping (command center / decision_resolver integration)
"""
import types
import unittest

from verdict import VERDICT_RANK, verdict_label, verdict_rank, verdict_tone
from verdict_resolver import (
    _map_raw_to_verdict,
    resolve_verdict_day,
    resolve_verdict_from_final_decision,
    resolve_verdict_regular,
    resolve_verdict_swing,
)


# ---------------------------------------------------------------------------
# Helpers — build minimal scan-like objects
# ---------------------------------------------------------------------------

def _day_scan(verdict: str, vix: float = 18.0, suggested_action: str = "") -> object:
    scan = types.SimpleNamespace()
    scan.verdict = verdict
    scan.metrics = {"vix": vix}
    scan.trader_decision = {"suggested_action": suggested_action} if suggested_action else {}
    return scan


def _swing_scan(verdict: str, vix: float = 18.0, setup_quality: str = "") -> object:
    scan = types.SimpleNamespace()
    scan.verdict = verdict
    scan.metrics = {"vix": vix, "setup_quality": setup_quality}
    return scan


# ---------------------------------------------------------------------------
# verdict.py — enum helpers
# ---------------------------------------------------------------------------

class TestVerdictHelpers(unittest.TestCase):

    def test_labels_all_present(self) -> None:
        for v in ("STRONG_GO", "GO", "WATCH", "WAIT", "AVOID", "NO_EDGE"):
            self.assertNotEqual(verdict_label(v), v, f"No label for {v}")

    def test_rank_ordering(self) -> None:
        self.assertGreater(verdict_rank("STRONG_GO"), verdict_rank("GO"))
        self.assertGreater(verdict_rank("GO"), verdict_rank("WATCH"))
        self.assertGreater(verdict_rank("WATCH"), verdict_rank("WAIT"))
        self.assertGreater(verdict_rank("WAIT"), verdict_rank("AVOID"))
        self.assertGreater(verdict_rank("AVOID"), verdict_rank("NO_EDGE"))

    def test_tone_bullish(self) -> None:
        self.assertEqual(verdict_tone("STRONG_GO"), "bullish")
        self.assertEqual(verdict_tone("GO"), "bullish")

    def test_tone_bearish(self) -> None:
        self.assertEqual(verdict_tone("AVOID"), "bearish")

    def test_unknown_tone_neutral(self) -> None:
        self.assertEqual(verdict_tone("GARBAGE"), "neutral")


# ---------------------------------------------------------------------------
# _map_raw_to_verdict — legacy string normalisation
# ---------------------------------------------------------------------------

class TestMapRawToVerdict(unittest.TestCase):

    def test_strong_go_with_space(self) -> None:
        self.assertEqual(_map_raw_to_verdict("STRONG GO"), "STRONG_GO")

    def test_ready_maps_to_go(self) -> None:
        self.assertEqual(_map_raw_to_verdict("READY"), "GO")

    def test_enter_maps_to_go(self) -> None:
        self.assertEqual(_map_raw_to_verdict("ENTER"), "GO")

    def test_no_go_hyphen_maps_to_avoid(self) -> None:
        self.assertEqual(_map_raw_to_verdict("NO-GO"), "AVOID")

    def test_extended_maps_to_watch(self) -> None:
        self.assertEqual(_map_raw_to_verdict("EXTENDED"), "WATCH")

    def test_empty_maps_to_no_edge(self) -> None:
        self.assertEqual(_map_raw_to_verdict(""), "NO_EDGE")

    def test_garbage_maps_to_no_edge(self) -> None:
        self.assertEqual(_map_raw_to_verdict("XYZZY"), "NO_EDGE")


# ---------------------------------------------------------------------------
# resolve_verdict_day
# ---------------------------------------------------------------------------

class TestResolveVerdictDay(unittest.TestCase):

    def test_vix_extreme_always_avoid(self) -> None:
        # Even a STRONG GO scan is overridden when VIX >= 40
        scan = _day_scan("STRONG GO", vix=42.0)
        self.assertEqual(resolve_verdict_day(scan), "AVOID")

    def test_vix_just_below_threshold_not_overridden(self) -> None:
        scan = _day_scan("GO", vix=39.9)
        self.assertEqual(resolve_verdict_day(scan), "GO")

    def test_trader_decision_watch_long_only(self) -> None:
        scan = _day_scan("GO", suggested_action="WATCH_LONG_ONLY")
        self.assertEqual(resolve_verdict_day(scan), "WATCH")

    def test_trader_decision_wait_for_confirmation(self) -> None:
        scan = _day_scan("GO", suggested_action="WAIT_FOR_CONFIRMATION")
        self.assertEqual(resolve_verdict_day(scan), "WAIT")

    def test_trader_decision_no_trade(self) -> None:
        scan = _day_scan("WATCH", suggested_action="NO_TRADE")
        self.assertEqual(resolve_verdict_day(scan), "WAIT")

    def test_trader_decision_avoid_calls(self) -> None:
        scan = _day_scan("WATCH", suggested_action="AVOID_CALLS")
        self.assertEqual(resolve_verdict_day(scan), "AVOID")

    def test_strong_go_raw_upgrades_trader_watch(self) -> None:
        # Raw verdict is STRONG GO but trader said WATCH → should upgrade back to STRONG_GO
        scan = _day_scan("STRONG GO", suggested_action="WATCH_LONG_ONLY")
        self.assertEqual(resolve_verdict_day(scan), "STRONG_GO")

    def test_strong_go_raw_does_not_upgrade_past_avoid(self) -> None:
        # trader said AVOID, raw said STRONG GO — AVOID wins
        scan = _day_scan("STRONG GO", suggested_action="AVOID_CALLS")
        self.assertEqual(resolve_verdict_day(scan), "AVOID")

    def test_raw_go_fallback(self) -> None:
        scan = _day_scan("GO")
        self.assertEqual(resolve_verdict_day(scan), "GO")

    def test_raw_no_go_fallback(self) -> None:
        scan = _day_scan("NO-GO")
        self.assertEqual(resolve_verdict_day(scan), "AVOID")

    def test_missing_metrics_no_crash(self) -> None:
        scan = types.SimpleNamespace(verdict="GO", metrics=None, trader_decision={})
        result = resolve_verdict_day(scan)
        self.assertIn(result, ("GO", "WATCH", "WAIT", "AVOID", "NO_EDGE", "STRONG_GO"))


# ---------------------------------------------------------------------------
# resolve_verdict_swing
# ---------------------------------------------------------------------------

class TestResolveVerdictSwing(unittest.TestCase):

    def test_vix_extreme_avoid(self) -> None:
        scan = _swing_scan("GO", vix=41.0)
        self.assertEqual(resolve_verdict_swing(scan), "AVOID")

    def test_strong_go_with_space_upgrades(self) -> None:
        scan = _swing_scan("STRONG GO")
        self.assertEqual(resolve_verdict_swing(scan), "STRONG_GO")

    def test_go_with_strong_setup_upgrades(self) -> None:
        scan = _swing_scan("GO", setup_quality="STRONG")
        self.assertEqual(resolve_verdict_swing(scan), "STRONG_GO")

    def test_go_without_strong_setup_stays_go(self) -> None:
        scan = _swing_scan("GO", setup_quality="MODERATE")
        self.assertEqual(resolve_verdict_swing(scan), "GO")

    def test_watch_maps_correctly(self) -> None:
        scan = _swing_scan("WATCH")
        self.assertEqual(resolve_verdict_swing(scan), "WATCH")

    def test_avoid_maps_correctly(self) -> None:
        scan = _swing_scan("AVOID")
        self.assertEqual(resolve_verdict_swing(scan), "AVOID")

    def test_empty_verdict_no_edge(self) -> None:
        scan = _swing_scan("")
        self.assertEqual(resolve_verdict_swing(scan), "NO_EDGE")


# ---------------------------------------------------------------------------
# resolve_verdict_regular
# ---------------------------------------------------------------------------

class TestResolveVerdictRegular(unittest.TestCase):

    def test_no_candidates_no_edge(self) -> None:
        self.assertEqual(resolve_verdict_regular(95.0, candidates_count=0), "NO_EDGE")

    def test_score_80_strong_go(self) -> None:
        self.assertEqual(resolve_verdict_regular(80.0, candidates_count=3), "STRONG_GO")

    def test_score_79_go(self) -> None:
        self.assertEqual(resolve_verdict_regular(79.9, candidates_count=3), "GO")

    def test_score_60_go(self) -> None:
        self.assertEqual(resolve_verdict_regular(60.0, candidates_count=3), "GO")

    def test_score_59_watch(self) -> None:
        self.assertEqual(resolve_verdict_regular(59.9, candidates_count=3), "WATCH")

    def test_score_45_watch(self) -> None:
        self.assertEqual(resolve_verdict_regular(45.0, candidates_count=3), "WATCH")

    def test_score_44_wait(self) -> None:
        self.assertEqual(resolve_verdict_regular(44.9, candidates_count=3), "WAIT")

    def test_score_30_wait(self) -> None:
        self.assertEqual(resolve_verdict_regular(30.0, candidates_count=3), "WAIT")

    def test_score_29_avoid(self) -> None:
        self.assertEqual(resolve_verdict_regular(29.9, candidates_count=3), "AVOID")

    def test_score_0_avoid(self) -> None:
        self.assertEqual(resolve_verdict_regular(0.0, candidates_count=3), "AVOID")


# ---------------------------------------------------------------------------
# resolve_verdict_from_final_decision
# ---------------------------------------------------------------------------

class TestResolveVerdictFromFinalDecision(unittest.TestCase):

    def test_ready_strong_setup_strong_go(self) -> None:
        self.assertEqual(
            resolve_verdict_from_final_decision("READY", setup_quality="STRONG"),
            "STRONG_GO",
        )

    def test_ready_moderate_setup_go(self) -> None:
        self.assertEqual(
            resolve_verdict_from_final_decision("READY", setup_quality="MODERATE"),
            "GO",
        )

    def test_trade_maps_to_go(self) -> None:
        self.assertEqual(resolve_verdict_from_final_decision("TRADE"), "GO")

    def test_watch_maps_to_watch(self) -> None:
        self.assertEqual(resolve_verdict_from_final_decision("WATCH"), "WATCH")

    def test_wait_maps_to_wait(self) -> None:
        self.assertEqual(resolve_verdict_from_final_decision("WAIT"), "WAIT")

    def test_avoid_maps_to_avoid(self) -> None:
        self.assertEqual(resolve_verdict_from_final_decision("AVOID"), "AVOID")

    def test_exit_maps_to_avoid(self) -> None:
        self.assertEqual(resolve_verdict_from_final_decision("EXIT"), "AVOID")

    def test_manage_maps_to_watch(self) -> None:
        self.assertEqual(resolve_verdict_from_final_decision("MANAGE"), "WATCH")

    def test_no_edge_maps_to_no_edge(self) -> None:
        self.assertEqual(resolve_verdict_from_final_decision("NO_EDGE"), "NO_EDGE")

    def test_garbage_maps_to_no_edge(self) -> None:
        self.assertEqual(resolve_verdict_from_final_decision("BOGUS"), "NO_EDGE")

    def test_empty_maps_to_no_edge(self) -> None:
        self.assertEqual(resolve_verdict_from_final_decision(""), "NO_EDGE")


if __name__ == "__main__":
    unittest.main()
