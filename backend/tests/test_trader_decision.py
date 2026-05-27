"""Unit tests for trader decision layer (deterministic, no network)."""
from __future__ import annotations

import unittest

from trader_decision import build_trader_decision


class TestTraderDecision(unittest.TestCase):
    def test_nvda_rs_long_watch_weak_qqq_session(self) -> None:
        r = build_trader_decision(
            ticker="NVDA",
            stock_session_pct=1.46,
            above_vwap=True,
            bull_score=6.0,
            bear_score=2.0,
            spy_session_pct=-0.63,
            qqq_session_pct=-0.57,
            spy_daily_pct=-0.63,
            qqq_daily_pct=-0.57,
            vix=18.0,
        )
        self.assertEqual(r["market_state"], "MARKET_WEAK")
        self.assertEqual(r["trader_state"], "RELATIVE_STRENGTH_LONG_WATCH")
        self.assertEqual(r["call_bias"], "WATCH_LONG")
        self.assertEqual(r["put_bias"], "AVOID")
        self.assertIn("QQQ", r["decision_message"])

    def test_amd_weak_breakdown_below_vwap(self) -> None:
        r = build_trader_decision(
            ticker="AMD",
            stock_session_pct=-3.64,
            above_vwap=False,
            bull_score=2.0,
            bear_score=5.0,
            spy_session_pct=-0.63,
            qqq_session_pct=-0.57,
            spy_daily_pct=-0.63,
            qqq_daily_pct=-0.57,
            vix=None,
        )
        self.assertEqual(r["trader_state"], "WEAK_BREAKDOWN_WATCH")
        self.assertEqual(r["put_bias"], "WATCH_BREAKDOWN")
        self.assertEqual(r["call_bias"], "AVOID")

    def test_arm_very_extended(self) -> None:
        r = build_trader_decision(
            ticker="ARM",
            stock_session_pct=-5.43,
            above_vwap=False,
            bull_score=1.0,
            bear_score=6.0,
            spy_session_pct=-0.63,
            qqq_session_pct=-0.57,
            spy_daily_pct=-0.63,
            qqq_daily_pct=-0.57,
            vix=None,
        )
        self.assertEqual(r["trader_state"], "VERY_WEAK_EXTENDED")

    def test_spy_broad_weak(self) -> None:
        r = build_trader_decision(
            ticker="SPY",
            stock_session_pct=-0.63,
            above_vwap=True,
            bull_score=0.0,
            bear_score=0.0,
            spy_session_pct=-0.63,
            qqq_session_pct=-0.57,
            spy_daily_pct=-0.63,
            qqq_daily_pct=-0.57,
            vix=20.0,
        )
        self.assertEqual(r["trader_state"], "BROAD_MARKET_WEAK")
        self.assertEqual(r["market_state"], "MARKET_WEAK")

    def test_neutral_weak_aapl(self) -> None:
        r = build_trader_decision(
            ticker="AAPL",
            stock_session_pct=-0.18,
            above_vwap=False,
            bull_score=3.0,
            bear_score=3.5,
            spy_session_pct=-0.63,
            qqq_session_pct=-0.57,
            spy_daily_pct=-0.63,
            qqq_daily_pct=-0.57,
            vix=None,
        )
        self.assertEqual(r["trader_state"], "NEUTRAL_WEAK")

    def test_very_extended_trumps_rs_long_pattern(self) -> None:
        """Deep red should not classify as RS long even if numeric edge cases occur."""
        r = build_trader_decision(
            ticker="XYZ",
            stock_session_pct=-4.5,
            above_vwap=False,
            bull_score=0.0,
            bear_score=1.0,
            spy_session_pct=-1.0,
            qqq_session_pct=-0.5,
            spy_daily_pct=-1.0,
            qqq_daily_pct=-0.5,
            vix=None,
        )
        self.assertEqual(r["trader_state"], "VERY_WEAK_EXTENDED")


if __name__ == "__main__":
    unittest.main()
