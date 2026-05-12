"""Unit tests for cross-engine score normalizer (deterministic, no network)."""
from __future__ import annotations

import unittest

from score_normalizer import (
    normalize_day_score,
    normalize_regular_score,
    normalize_swing_score,
    normalized_state_rank,
)


class TestDayNormalizer(unittest.TestCase):
    def test_strong_go_maps_to_go(self) -> None:
        r = normalize_day_score(
            bull_score=8.5,
            bear_score=2.0,
            verdict="STRONG GO",
            metrics={"vix": 15},
            decision_confidence=85,
            decision_risk_state="LOW",
            entry_guidance={"should_enter_now": "YES"},
            reasons=["Strong momentum above VWAP."],
        )
        self.assertAlmostEqual(r["raw_engine_score"], 8.5)
        self.assertEqual(r["normalized_score"], 94)
        self.assertEqual(r["normalized_state"], "GO")
        self.assertEqual(r["confidence_band"], "VERY_HIGH")
        self.assertEqual(r["execution_bias"], "ENTER_NOW")
        self.assertEqual(r["risk_band"], "LOW")
        self.assertIn("Normalized score", r["normalized_reason"])
        self.assertIn("bull_score", r["engine_score_breakdown"])

    def test_go_maps_to_ready(self) -> None:
        r = normalize_day_score(
            bull_score=6.0,
            bear_score=2.0,
            verdict="GO",
            metrics={"vix": 15},
            decision_confidence=70,
            decision_risk_state="LOW",
            entry_guidance={},
            reasons=[],
        )
        self.assertAlmostEqual(r["raw_engine_score"], 6.0)
        self.assertEqual(r["normalized_score"], 75)
        self.assertEqual(r["normalized_state"], "READY")
        self.assertEqual(r["confidence_band"], "HIGH")

    def test_watch_verdict(self) -> None:
        r = normalize_day_score(
            bull_score=3.5,
            bear_score=3.0,
            verdict="WATCH",
            metrics={"vix": 22},
            decision_confidence=45,
            decision_risk_state="MEDIUM",
            entry_guidance={},
        )
        self.assertEqual(r["normalized_state"], "WATCH")
        self.assertEqual(r["confidence_band"], "MEDIUM")
        self.assertEqual(r["risk_band"], "MEDIUM")

    def test_wait_verdict(self) -> None:
        r = normalize_day_score(
            bull_score=2.0,
            bear_score=4.0,
            verdict="WAIT",
            metrics={"vix": 18},
            decision_confidence=20,
            decision_risk_state="MEDIUM",
            entry_guidance={},
        )
        self.assertEqual(r["normalized_state"], "WAIT")
        self.assertEqual(r["confidence_band"], "LOW")

    def test_no_go_verdict(self) -> None:
        r = normalize_day_score(
            bull_score=1.0,
            bear_score=8.0,
            verdict="NO-GO",
            metrics={"vix": 18},
            decision_confidence=5,
            decision_risk_state="HIGH",
            entry_guidance={},
        )
        self.assertEqual(r["normalized_state"], "NO-GO")
        self.assertEqual(r["risk_band"], "HIGH")

    def test_vix_40_overrides_to_avoid(self) -> None:
        r = normalize_day_score(
            bull_score=7.0,
            bear_score=2.0,
            verdict="GO",
            metrics={"vix": 42},
            decision_confidence=70,
            decision_risk_state="MEDIUM",
            entry_guidance={},
        )
        self.assertEqual(r["normalized_state"], "AVOID")
        self.assertEqual(r["risk_band"], "HIGH")

    def test_vix_30_downgrades_go_to_watch(self) -> None:
        r = normalize_day_score(
            bull_score=7.0,
            bear_score=2.0,
            verdict="STRONG GO",
            metrics={"vix": 32},
            decision_confidence=80,
            decision_risk_state="MEDIUM",
            entry_guidance={},
        )
        self.assertEqual(r["normalized_state"], "WATCH")
        self.assertEqual(r["risk_band"], "HIGH")

    def test_execution_bias_wait_for_confirmation(self) -> None:
        r = normalize_day_score(
            bull_score=6.0,
            bear_score=3.0,
            verdict="GO",
            metrics={"vix": 18},
            decision_confidence=60,
            decision_risk_state="MEDIUM",
            entry_guidance={"should_enter_now": "CONDITIONAL", "state": "WAIT_FOR_VWAP_HOLD"},
        )
        self.assertEqual(r["execution_bias"], "WAIT_FOR_CONFIRMATION")

    def test_execution_bias_pullback(self) -> None:
        r = normalize_day_score(
            bull_score=6.0,
            bear_score=3.0,
            verdict="GO",
            metrics={"vix": 18},
            decision_confidence=60,
            decision_risk_state="MEDIUM",
            entry_guidance={"state": "WAIT_FOR_PULLBACK"},
        )
        self.assertEqual(r["execution_bias"], "WAIT_FOR_PULLBACK")

    def test_execution_bias_avoid_chase(self) -> None:
        r = normalize_day_score(
            bull_score=2.0,
            bear_score=6.0,
            verdict="NO-GO",
            metrics={"vix": 18},
            decision_confidence=10,
            decision_risk_state="HIGH",
            entry_guidance={},
        )
        self.assertEqual(r["execution_bias"], "AVOID_CHASE")

    def test_no_clean_entry_default(self) -> None:
        r = normalize_day_score(
            bull_score=3.0,
            bear_score=3.0,
            verdict="WATCH",
            metrics={"vix": 15},
            decision_confidence=30,
            decision_risk_state="MEDIUM",
            entry_guidance={},
        )
        self.assertEqual(r["execution_bias"], "NO_CLEAN_ENTRY")

    def test_breakdown_preserves_raw_scores(self) -> None:
        r = normalize_day_score(
            bull_score=7.25,
            bear_score=3.10,
            verdict="STRONG GO",
            metrics={"vix": 15},
            decision_confidence=80,
            decision_risk_state="LOW",
        )
        bd = r["engine_score_breakdown"]
        self.assertAlmostEqual(bd["bull_score"], 7.25)
        self.assertAlmostEqual(bd["bear_score"], 3.10)
        self.assertEqual(bd["verdict"], "STRONG GO")


class TestSwingNormalizer(unittest.TestCase):
    def test_high_quality_go(self) -> None:
        r = normalize_swing_score(
            trade_quality_score=9.0,
            verdict="STRONG GO",
            final_action="STRONG_GO",
            entry_quality="GOOD_ENTRY",
            risk_level="LOW",
            swing_bias="STRONG_BULLISH",
            decision_confidence=85,
            decision_risk_state="LOW",
            metrics={"vix": 15},
            bull_score=8.5,
            bear_score=1.5,
            reasons=["Strong trend quality."],
        )
        self.assertAlmostEqual(r["raw_engine_score"], 9.0)
        self.assertEqual(r["normalized_score"], 92)
        self.assertEqual(r["normalized_state"], "GO")
        self.assertEqual(r["confidence_band"], "VERY_HIGH")
        self.assertEqual(r["execution_bias"], "ENTER_NOW")
        self.assertEqual(r["risk_band"], "LOW")
        self.assertIn("bull_score", r["engine_score_breakdown"])

    def test_ready_state(self) -> None:
        r = normalize_swing_score(
            trade_quality_score=7.0,
            verdict="GO",
            final_action="WATCH_CALL_OR_DEBIT_SPREAD",
            entry_quality="GOOD_ENTRY",
            risk_level="MEDIUM",
            swing_bias="BULLISH",
            decision_confidence=65,
            decision_risk_state="MEDIUM",
        )
        self.assertEqual(r["normalized_state"], "READY")
        self.assertEqual(r["execution_bias"], "WAIT_FOR_CONFIRMATION")

    def test_watch_state(self) -> None:
        r = normalize_swing_score(
            trade_quality_score=5.5,
            verdict="WATCH",
            final_action="WATCH_CALL_OR_DEBIT_SPREAD",
            entry_quality="CAUTION_ENTRY",
            risk_level="MEDIUM",
            swing_bias="BULLISH",
            decision_confidence=45,
            decision_risk_state="MEDIUM",
        )
        self.assertEqual(r["normalized_state"], "WATCH")
        self.assertEqual(r["execution_bias"], "WAIT_FOR_CONFIRMATION")

    def test_wait_pullback(self) -> None:
        r = normalize_swing_score(
            trade_quality_score=6.0,
            verdict="GO",
            final_action="WAIT_PULLBACK",
            entry_quality="WAIT_PULLBACK",
            risk_level="MEDIUM",
            swing_bias="BULLISH",
            decision_confidence=50,
            decision_risk_state="MEDIUM",
        )
        self.assertEqual(r["execution_bias"], "WAIT_FOR_PULLBACK")
        self.assertEqual(r["normalized_state"], "WATCH")

    def test_avoid_state(self) -> None:
        r = normalize_swing_score(
            trade_quality_score=2.0,
            verdict="WATCH",
            final_action="AVOID_CHASE",
            entry_quality="BAD_ENTRY",
            risk_level="HIGH",
            swing_bias="NEUTRAL",
            decision_confidence=10,
            decision_risk_state="HIGH",
        )
        self.assertEqual(r["execution_bias"], "AVOID_CHASE")
        self.assertEqual(r["risk_band"], "HIGH")

    def test_vix_35_overrides_to_avoid(self) -> None:
        r = normalize_swing_score(
            trade_quality_score=9.0,
            verdict="STRONG GO",
            final_action="STRONG_GO",
            entry_quality="GOOD_ENTRY",
            risk_level="LOW",
            swing_bias="STRONG_BULLISH",
            decision_confidence=85,
            decision_risk_state="LOW",
            metrics={"vix": 38},
        )
        self.assertEqual(r["normalized_state"], "AVOID")
        self.assertEqual(r["risk_band"], "HIGH")

    def test_vix_25_downgrades(self) -> None:
        r = normalize_swing_score(
            trade_quality_score=9.0,
            verdict="STRONG GO",
            final_action="STRONG_GO",
            entry_quality="GOOD_ENTRY",
            risk_level="LOW",
            swing_bias="STRONG_BULLISH",
            decision_confidence=85,
            decision_risk_state="LOW",
            metrics={"vix": 28},
        )
        self.assertEqual(r["normalized_state"], "WATCH")  # downgraded from GO

    def test_no_go_low_score(self) -> None:
        r = normalize_swing_score(
            trade_quality_score=1.5,
            verdict="WATCH",
            final_action="NO_TRADE",
            entry_quality="NO_CLEAN_ENTRY",
            risk_level="HIGH",
            swing_bias="NEUTRAL",
            decision_confidence=0,
            decision_risk_state="HIGH",
        )
        self.assertEqual(r["normalized_state"], "AVOID")

    def test_breakdown_preserves_raw_scores(self) -> None:
        r = normalize_swing_score(
            trade_quality_score=8.3,
            verdict="GO",
            final_action="QUALITY_LONG",
            entry_quality="GOOD_ENTRY",
            risk_level="MEDIUM",
            swing_bias="BULLISH",
            decision_confidence=70,
            decision_risk_state="MEDIUM",
            bull_score=7.0,
            bear_score=2.0,
        )
        bd = r["engine_score_breakdown"]
        self.assertAlmostEqual(bd["trade_quality_score"], 8.3)
        self.assertAlmostEqual(bd["bull_score"], 7.0)
        self.assertAlmostEqual(bd["bear_score"], 2.0)


class TestRegularNormalizer(unittest.TestCase):
    def test_high_score_go(self) -> None:
        r = normalize_regular_score(
            top_candidate={
                "scores": {"total_score": 82, "signal_score": 35, "structure_score": 25,
                           "liquidity_score": 15, "iv_fit_score": 7},
                "expected_value": 0.15,
                "edge_ratio": 0.12,
                "dte": 35,
                "passes_liquidity_filter": True,
                "passes_rr_filter": True,
            },
            signals={"bias_confidence": 80, "iv_rank": 45, "iv_environment": "NORMAL"},
            decision_confidence=75,
            decision_risk_state="LOW",
            decision_reason="Good option structure.",
        )
        self.assertAlmostEqual(r["raw_engine_score"], 82.0)
        self.assertEqual(r["normalized_score"], 82)
        self.assertEqual(r["normalized_state"], "GO")
        self.assertEqual(r["confidence_band"], "VERY_HIGH")
        self.assertEqual(r["execution_bias"], "ENTER_NOW")
        self.assertEqual(r["risk_band"], "LOW")
        self.assertIn("signal_score", r["engine_score_breakdown"])

    def test_ready_state(self) -> None:
        r = normalize_regular_score(
            top_candidate={
                "scores": {"total_score": 62, "signal_score": 28},
                "expected_value": 0.08,
                "edge_ratio": 0.06,
                "dte": 28,
                "passes_liquidity_filter": True,
                "passes_rr_filter": True,
            },
            signals={},
            decision_confidence=60,
            decision_risk_state="MEDIUM",
        )
        self.assertEqual(r["normalized_state"], "READY")

    def test_watch_state(self) -> None:
        r = normalize_regular_score(
            top_candidate={
                "scores": {"total_score": 35},
                "expected_value": 0.04,
                "edge_ratio": 0.02,
                "dte": 21,
                "passes_liquidity_filter": True,
                "passes_rr_filter": True,
            },
            signals={},
            decision_confidence=35,
            decision_risk_state="MEDIUM",
        )
        self.assertEqual(r["normalized_state"], "WATCH")
        self.assertEqual(r["confidence_band"], "MEDIUM")

    def test_wait_state(self) -> None:
        r = normalize_regular_score(
            top_candidate={
                "scores": {"total_score": 20},
                "expected_value": 0.03,
                "edge_ratio": 0.01,
                "dte": 5,
                "passes_liquidity_filter": True,
                "passes_rr_filter": True,
            },
            signals={"bias_confidence": 15},
            decision_confidence=18,
            decision_risk_state="MEDIUM",
        )
        self.assertEqual(r["normalized_state"], "WAIT")
        self.assertEqual(r["execution_bias"], "WAIT_FOR_CONFIRMATION")

    def test_no_go_ev_zero(self) -> None:
        r = normalize_regular_score(
            top_candidate={
                "scores": {"total_score": 75},
                "expected_value": 0.0,
                "edge_ratio": 0.0,
                "dte": 21,
                "passes_liquidity_filter": True,
                "passes_rr_filter": True,
            },
            signals={},
            decision_confidence=0,
            decision_risk_state="HIGH",
        )
        self.assertEqual(r["normalized_state"], "NO-GO")

    def test_no_go_no_candidate(self) -> None:
        r = normalize_regular_score(
            top_candidate=None,
            signals=None,
            decision_confidence=0,
            decision_risk_state="MEDIUM",
        )
        self.assertEqual(r["normalized_state"], "NO-GO")
        self.assertEqual(r["normalized_score"], 0)
        self.assertEqual(r["execution_bias"], "NO_CLEAN_ENTRY")

    def test_high_iv_risk(self) -> None:
        r = normalize_regular_score(
            top_candidate={
                "scores": {"total_score": 55},
                "expected_value": 0.06,
                "edge_ratio": 0.04,
                "dte": 30,
                "passes_liquidity_filter": True,
                "passes_rr_filter": True,
            },
            signals={"bias_confidence": 50, "iv_rank": 75, "iv_environment": "HIGH"},
            decision_confidence=50,
            decision_risk_state="MEDIUM",
        )
        self.assertEqual(r["risk_band"], "HIGH")

    def test_avoid_chase_liq_fail(self) -> None:
        r = normalize_regular_score(
            top_candidate={
                "scores": {"total_score": 65},
                "expected_value": 0.10,
                "edge_ratio": 0.08,
                "dte": 35,
                "passes_liquidity_filter": False,
                "passes_rr_filter": True,
            },
            signals={},
            decision_confidence=60,
            decision_risk_state="MEDIUM",
        )
        self.assertEqual(r["execution_bias"], "AVOID_CHASE")

    def test_breakdown_preserves_sub_scores(self) -> None:
        r = normalize_regular_score(
            top_candidate={
                "scores": {"total_score": 72, "signal_score": 30, "structure_score": 22,
                           "liquidity_score": 14, "iv_fit_score": 6},
                "expected_value": 0.12,
                "edge_ratio": 0.09,
                "dte": 35,
                "passes_liquidity_filter": True,
                "passes_rr_filter": True,
            },
            signals={},
            decision_confidence=70,
            decision_risk_state="LOW",
        )
        bd = r["engine_score_breakdown"]
        self.assertAlmostEqual(bd["total_score"], 72.0)
        self.assertEqual(bd["signal_score"], 30)
        self.assertEqual(bd["structure_score"], 22)
        self.assertEqual(bd["liquidity_score"], 14)
        self.assertEqual(bd["iv_fit_score"], 6)
        self.assertAlmostEqual(bd["expected_value"], 0.12)
        self.assertAlmostEqual(bd["edge_ratio"], 0.09)


class TestNormalizedStateRank(unittest.TestCase):
    def test_rank_ordering(self) -> None:
        self.assertGreater(normalized_state_rank("GO"), normalized_state_rank("READY"))
        self.assertGreater(normalized_state_rank("READY"), normalized_state_rank("WATCH"))
        self.assertGreater(normalized_state_rank("WATCH"), normalized_state_rank("WAIT"))
        self.assertGreater(normalized_state_rank("WAIT"), normalized_state_rank("EXTENDED"))
        self.assertGreater(normalized_state_rank("EXTENDED"), normalized_state_rank("AVOID"))
        self.assertGreater(normalized_state_rank("AVOID"), normalized_state_rank("NO-GO"))

    def test_unknown_state_defaults_to_lowest(self) -> None:
        self.assertEqual(normalized_state_rank("BOGUS"), -1)
        self.assertEqual(normalized_state_rank(""), -1)


if __name__ == "__main__":
    unittest.main()
