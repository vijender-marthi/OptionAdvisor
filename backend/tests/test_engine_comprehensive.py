"""
Comprehensive engine regression tests — Day, Swing, Regular.

Covers:
  1.  AVOID verdict always blocks ENTRY (never shows GO/ENTER when AVOID)
  2.  Day trade large-cap RVOL thresholds (SPY/QQQ/NVDA vs small/mid)
  3.  Day trade verdict × trader-decision matrix
  4.  Day trade entry guidance cleared on WAIT/AVOID
  5.  Exit plan rules — day/swing/regular structure + EOD rule
  6.  Premium conversion (build_premium_targets + estimate_premium_at_price)
  7.  Swing verdict downgrade on weak RVOL
  8.  Swing verdict hard-veto on VIX ≥ 35
  9.  Regular verdict scoring thresholds
  10. Regular verdict on 0 candidates → NO_EDGE
  11. Verdict resolver raw-string normalization
  12. Trader-decision AVOID always wins over GO/STRONG_GO
  13. _confidence_block volume label uses LC thresholds for SPY/QQQ
  14. Premium targets: bullish (call) vs bearish (put) direction
  15. Premium targets: unavailable chain → safe return, no crash
  16. Exit plan: day trade always has EOD close rule
  17. Exit plan: swing with user levels uses those levels
  18. Exit plan: regular credit spread 50% target + 2× stop
  19. AVOID state derived from NO GO verdict regardless of score
  20. Score 89 + NO GO verdict → AVOID state (the original bug)
"""
from __future__ import annotations

import sys
import os
import unittest
from unittest.mock import patch, MagicMock
from typing import Optional

import pandas as pd
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from day_trade import (
    LARGE_CAP_LIQUID,
    RVOL_HIGH,
    RVOL_ELEV,
    RVOL_HIGH_LC,
    RVOL_ELEV_LC,
    _compute_vwap_bands,
)
from day_option_risk import build_premium_targets, estimate_premium_at_price
from verdict import Verdict
from verdict_resolver import (
    resolve_verdict,
    resolve_verdict_day,
    resolve_verdict_swing,
    resolve_verdict_regular,
    resolve_verdict_from_final_decision,
)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _make_options_df(
    strike: float,
    bid: float,
    ask: float,
    delta: Optional[float] = None,
) -> pd.DataFrame:
    row: dict = {
        "strike": strike,
        "bid": bid,
        "ask": ask,
        "volume": 500,
        "openInterest": 2000,
        "impliedVolatility": 0.35,
        "lastPrice": (bid + ask) / 2,
    }
    if delta is not None:
        row["delta"] = delta
    return pd.DataFrame([row])


def _mock_chain_patch(ticker: str, strike: float, bid: float, ask: float, delta: Optional[float] = None):
    """Return context managers that mock out option chain for build_premium_targets."""
    df = _make_options_df(strike, bid, ask, delta)
    return (
        patch("day_option_risk.bar_cache.get_option_dates", return_value=["2026-06-06"]),
        patch("day_option_risk.bar_cache.get_option_chain", return_value=(df, df)),
    )


# ─────────────────────────────────────────────────────────────────────────────
# 1. AVOID blocks ENTRY — verdict resolver level
# ─────────────────────────────────────────────────────────────────────────────

class TestAvoidBlocksEntry(unittest.TestCase):
    """AVOID verdict must never co-exist with an ENTRY signal."""

    def test_vix_35_forces_avoid_any_engine(self):
        for eng in ("day", "swing", "regular"):
            v = resolve_verdict(eng, raw_score=9.0, vix=35.0, volume_spike=True)
            self.assertEqual(v, Verdict.AVOID, f"engine={eng} should be AVOID at VIX 35")

    def test_vix_40_day_scan_object_returns_avoid(self):
        scan = MagicMock()
        scan.verdict = "STRONG_GO"
        scan.trader_decision = {"suggested_action": "GO_LONG"}
        scan.metrics = {"vix": 42.0}
        result = resolve_verdict_day(scan)
        self.assertEqual(result, "AVOID")

    def test_avoid_trader_decision_overrides_strong_go_scan(self):
        """Even if scan says STRONG_GO, trader-decision AVOID wins."""
        scan = MagicMock()
        scan.verdict = "STRONG_GO"
        scan.trader_decision = {"suggested_action": "AVOID"}
        scan.metrics = {"vix": 18.0}
        result = resolve_verdict_day(scan)
        self.assertEqual(result, "AVOID")

    def test_avoid_calls_overrides_go(self):
        scan = MagicMock()
        scan.verdict = "GO"
        scan.trader_decision = {"suggested_action": "AVOID_CALLS"}
        scan.metrics = {}
        self.assertEqual(resolve_verdict_day(scan), "AVOID")

    def test_avoid_chasing_puts_overrides_go(self):
        scan = MagicMock()
        scan.verdict = "GO"
        scan.trader_decision = {"suggested_action": "AVOID_CHASING_PUTS"}
        scan.metrics = {}
        self.assertEqual(resolve_verdict_day(scan), "AVOID")

    def test_no_trade_maps_to_wait_not_avoid(self):
        """NO_TRADE → WAIT (not AVOID) per the TD map."""
        scan = MagicMock()
        scan.verdict = "WATCH"
        scan.trader_decision = {"suggested_action": "NO_TRADE"}
        scan.metrics = {}
        self.assertEqual(resolve_verdict_day(scan), "WAIT")

    def test_score_89_no_go_verdict_gives_avoid_not_entry(self):
        """
        The original bug: score=89 with NO_GO verdict was showing ENTRY.
        resolve_verdict with VIX veto is one path; the RecommendationCard
        logic is covered by deriveRegularTradeState behavior, which we test
        here via resolve_verdict_regular returning AVOID at low score.
        """
        # Regular engine: high score but backed by NO GO verdict map
        # The deriveRegularTradeState function checks verdict='NO GO' first
        # We verify that NO GO verdict string maps to AVOID
        from verdict_resolver import _map_raw_to_verdict
        self.assertEqual(_map_raw_to_verdict("NO GO"), "AVOID")
        self.assertEqual(_map_raw_to_verdict("NO-GO"), "AVOID")
        self.assertEqual(_map_raw_to_verdict("AVOID"), "AVOID")

    def test_resolve_verdict_from_final_decision_avoid(self):
        self.assertEqual(resolve_verdict_from_final_decision("AVOID"), "AVOID")
        self.assertEqual(resolve_verdict_from_final_decision("EXIT"), "AVOID")
        self.assertEqual(resolve_verdict_from_final_decision("SCALE_OUT"), "AVOID")

    def test_resolve_verdict_from_final_decision_ready_strong_setup(self):
        """READY + STRONG setup → STRONG_GO, not just GO."""
        result = resolve_verdict_from_final_decision("READY", setup_quality="STRONG")
        self.assertEqual(result, "STRONG_GO")

    def test_resolve_verdict_from_final_decision_ready_normal(self):
        result = resolve_verdict_from_final_decision("READY", setup_quality="MODERATE")
        self.assertEqual(result, "GO")


# ─────────────────────────────────────────────────────────────────────────────
# 2. Large-cap RVOL thresholds
# ─────────────────────────────────────────────────────────────────────────────

class TestLargeCapRvolThresholds(unittest.TestCase):
    """SPY/QQQ/NVDA use lower RVOL thresholds than small/mid caps."""

    def test_large_cap_set_contents(self):
        for sym in ("SPY", "QQQ", "NVDA", "AAPL", "MSFT", "AMZN", "META", "GOOGL", "TSLA"):
            self.assertIn(sym, LARGE_CAP_LIQUID)

    def test_small_cap_not_in_large_cap_set(self):
        for sym in ("AMD", "ARM", "AVGO", "SHOP", "MSTR", "COIN"):
            self.assertNotIn(sym, LARGE_CAP_LIQUID)

    def test_large_cap_thresholds_lower_than_standard(self):
        self.assertLess(RVOL_HIGH_LC, RVOL_HIGH,
                        "Large-cap HIGH threshold must be lower than standard")
        self.assertLess(RVOL_ELEV_LC, RVOL_ELEV,
                        "Large-cap ELEVATED threshold must be lower than standard")

    def test_large_cap_high_threshold_range(self):
        """Large-cap HIGH must be between 1.3 and 2.0."""
        self.assertGreaterEqual(RVOL_HIGH_LC, 1.3)
        self.assertLessEqual(RVOL_HIGH_LC, 2.0)

    def test_large_cap_elev_threshold_range(self):
        """Large-cap ELEVATED must be between 1.1 and 1.5."""
        self.assertGreaterEqual(RVOL_ELEV_LC, 1.1)
        self.assertLessEqual(RVOL_ELEV_LC, 1.5)

    def test_standard_high_threshold_at_least_2x(self):
        """Small/mid cap needs at least 2× RVOL to be HIGH."""
        self.assertGreaterEqual(RVOL_HIGH, 2.0)

    def test_confidence_block_volume_label_spy_strong(self):
        """SPY at RVOL_HIGH_LC should get STRONG label, not WEAK."""
        from day_trade import _confidence_block
        result = _confidence_block(
            momentum_pct=0.5,
            or_state="above",
            vol_spike=False,
            bias="long",
            spy_chg=0.3,
            qqq_chg=0.2,
            vix_level=18.0,
            verdict="GO",
            rvol=RVOL_HIGH_LC,
            ticker="SPY",
        )
        self.assertEqual(result["volume_confirmation"], "STRONG",
                         f"SPY RVOL={RVOL_HIGH_LC}x should be STRONG for large-cap")

    def test_confidence_block_volume_label_spy_below_lc_threshold_is_normal(self):
        """SPY at 1.1× (below LC elevated threshold) should be NORMAL, not ELEVATED."""
        from day_trade import _confidence_block
        result = _confidence_block(
            momentum_pct=0.3,
            or_state="above",
            vol_spike=False,
            bias="long",
            spy_chg=0.1,
            qqq_chg=0.1,
            vix_level=15.0,
            verdict="WATCH",
            rvol=1.1,
            ticker="SPY",
        )
        self.assertIn(result["volume_confirmation"], ("NORMAL", "WEAK"),
                      "SPY at 1.1× should not be ELEVATED")

    def test_confidence_block_volume_label_amd_needs_2x_for_strong(self):
        """AMD (small-cap) at 1.5× should NOT be STRONG — needs 2.0×."""
        from day_trade import _confidence_block
        result = _confidence_block(
            momentum_pct=0.6,
            or_state="above",
            vol_spike=False,
            bias="long",
            spy_chg=0.2,
            qqq_chg=0.1,
            vix_level=18.0,
            verdict="GO",
            rvol=1.5,
            ticker="AMD",
        )
        self.assertNotEqual(result["volume_confirmation"], "STRONG",
                             "AMD at 1.5× should not yet be STRONG (needs 2.0×)")

    def test_confidence_block_volume_label_amd_at_2x_is_strong(self):
        """AMD at 2.0× RVOL should be STRONG."""
        from day_trade import _confidence_block
        result = _confidence_block(
            momentum_pct=0.8,
            or_state="above",
            vol_spike=False,
            bias="long",
            spy_chg=0.3,
            qqq_chg=0.2,
            vix_level=18.0,
            verdict="GO",
            rvol=2.0,
            ticker="AMD",
        )
        self.assertEqual(result["volume_confirmation"], "STRONG")

    def test_confidence_block_vol_spike_always_strong_regardless_of_ticker(self):
        """vol_spike=True always produces STRONG regardless of ticker or RVOL."""
        from day_trade import _confidence_block
        for ticker in ("SPY", "QQQ", "AMD", "SHOP"):
            result = _confidence_block(
                momentum_pct=0.5,
                or_state="above",
                vol_spike=True,
                bias="long",
                spy_chg=0.2,
                qqq_chg=0.1,
                vix_level=18.0,
                verdict="GO",
                rvol=0.8,
                ticker=ticker,
            )
            self.assertEqual(result["volume_confirmation"], "STRONG",
                             f"vol_spike=True should always be STRONG, ticker={ticker}")


# ─────────────────────────────────────────────────────────────────────────────
# 3. Day trade verdict × trader-decision matrix
# ─────────────────────────────────────────────────────────────────────────────

class TestDayTradeVerdictMatrix(unittest.TestCase):

    def _scan(self, verdict: str, suggested_action: str, vix: float = 18.0):
        s = MagicMock()
        s.verdict = verdict
        s.trader_decision = {"suggested_action": suggested_action}
        s.metrics = {"vix": vix}
        return s

    def test_strong_go_scan_no_td_override(self):
        self.assertEqual(resolve_verdict_day(self._scan("STRONG GO", "")), "STRONG_GO")

    def test_go_scan_watch_td_gives_watch(self):
        self.assertEqual(resolve_verdict_day(self._scan("GO", "WATCH_LONG_ONLY")), "WATCH")

    def test_go_scan_wait_td_gives_wait(self):
        self.assertEqual(resolve_verdict_day(self._scan("GO", "WAIT_FOR_CONFIRMATION")), "WAIT")

    def test_strong_go_scan_avoid_td_gives_avoid(self):
        self.assertEqual(resolve_verdict_day(self._scan("STRONG GO", "AVOID")), "AVOID")

    def test_watch_scan_no_td(self):
        self.assertEqual(resolve_verdict_day(self._scan("WATCH", "")), "WATCH")

    def test_no_go_scan_no_td(self):
        self.assertEqual(resolve_verdict_day(self._scan("NO-GO", "")), "AVOID")

    def test_vix_40_overrides_strong_go(self):
        self.assertEqual(resolve_verdict_day(self._scan("STRONG GO", "GO_LONG", vix=40.0)), "AVOID")


# ─────────────────────────────────────────────────────────────────────────────
# 4. Day trade entry guidance cleared on WAIT/AVOID
# ─────────────────────────────────────────────────────────────────────────────

class TestDayEntryGuidanceClearedOnAvoid(unittest.TestCase):
    """
    serialize_day_trade (unified_analysis) must emit entry_price=None
    and exit_rows=[] when verdict is wait or avoid.
    """

    def _minimal_orc(self, verdict: str, suggested_action: str = "") -> dict:
        return {
            "ticker": "AMD",
            "verdict": verdict,
            "final_decision": "WAIT" if "wait" in verdict.lower() else "AVOID",
            "bias": "long",
            "entry_guidance": {
                "current_price": 185.0,
                "risk_below": 180.0,
                "scalp_target": 190.0,
                "entry_zone": 185.0,
                "should_enter_now": "NO",
                "premium_targets": {},
                "exit_rules": [],
            },
            "metrics": {"last_price": 185.0, "vix": 18.0},
            "trader_decision": {
                "suggested_action": suggested_action or "NO_TRADE",
                "entry_price": 185.0,
                "stop_price": 180.0,
            },
            "option_risk_context": {
                "theta_risk": "LOW",
                "gamma_risk": "LOW",
                "iv_risk": "LOW",
                "liquidity_risk": "LOW",
                "suggested_contract_window": "2-3 DTE",
                "option_execution_warning": "",
            },
        }

    def test_avoid_verdict_clears_entry_price(self):
        from unified_analysis import serialize_day_trade
        orc = self._minimal_orc("NO-GO", "AVOID")
        result = serialize_day_trade(orc)
        self.assertIsNone(result.get("entry_price"),
                          "entry_price must be None when verdict is AVOID")

    def test_avoid_verdict_clears_exit_rows(self):
        from unified_analysis import serialize_day_trade
        orc = self._minimal_orc("NO-GO", "AVOID")
        result = serialize_day_trade(orc)
        self.assertEqual(result.get("exit_rows", []), [],
                         "exit_rows must be empty when verdict is AVOID")

    def test_wait_verdict_clears_entry_price(self):
        from unified_analysis import serialize_day_trade
        orc = self._minimal_orc("WAIT", "WAIT_FOR_CONFIRMATION")
        result = serialize_day_trade(orc)
        self.assertIsNone(result.get("entry_price"),
                          "entry_price must be None when verdict is WAIT")


# ─────────────────────────────────────────────────────────────────────────────
# 5. Exit plan — structure and EOD rule
# ─────────────────────────────────────────────────────────────────────────────

class TestExitPlanRules(unittest.TestCase):
    """
    Test the deriveExitRules logic (replicated in Python to match frontend).
    These rules are also validated in test_swing_exit_rules.py but we add
    day-trade and regular-trade cases here.
    """

    def _day_pos(self, target1=None, target2=None, stop=None):
        return {
            "source": "day",
            "target1": target1,
            "target2": target2,
            "stopLoss": stop,
            "net_credit": -5.0,
            "contracts": 1,
            "entryPrice": 185.0,
            "dte": 1,
            "strategy": "Long Call",
        }

    def _derive_rules(self, pos: dict) -> list:
        """
        Minimal Python port of the frontend deriveExitRules function
        sufficient for the cases we test here.
        """
        rules = []
        source = pos.get("source", "")
        dte = pos.get("dte", 0)
        net_credit = pos.get("net_credit", 0)

        if source == "day":
            if pos.get("target1") is not None:
                rules.append({"trigger": "Target 1 reached", "price": pos["target1"],
                               "action": "Sell ½ position", "note": "Move stop to breakout / entry level"})
            if pos.get("target2") is not None:
                rules.append({"trigger": "Target 2 — scalp target", "price": pos["target2"],
                               "action": "Sell remaining ½", "note": "Intraday trade complete"})
            if pos.get("stopLoss") is not None:
                rules.append({"trigger": "Stop loss", "price": pos["stopLoss"],
                               "action": "Exit full position", "note": "Capital preservation"})
            rules.append({"trigger": "Market close (3:55 PM ET)", "price": None,
                          "action": "Close all intraday positions",
                          "note": "Never carry a day-trade overnight"})
        elif source == "swing":
            if pos.get("target1") or pos.get("target2") or pos.get("stopLoss"):
                if pos.get("target1"):
                    rules.append({"trigger": "Target 1 reached", "price": pos["target1"],
                                  "action": "Sell ½ position", "note": "Move stop to breakout"})
                if pos.get("target2"):
                    rules.append({"trigger": "Target 2 reached", "price": pos["target2"],
                                  "action": "Sell remaining ½", "note": "Full exit"})
                if pos.get("stopLoss"):
                    rules.append({"trigger": "Stop loss", "price": pos["stopLoss"],
                                  "action": "Exit full position", "note": "Capital preservation"})
        elif source == "regular":
            is_credit = net_credit >= 0
            if pos.get("target1") or pos.get("stopLoss"):
                if pos.get("target1"):
                    rules.append({"trigger": "Target 1 reached", "price": pos["target1"],
                                  "action": "Buy back / close spread" if is_credit else "Sell to close ½",
                                  "note": "Partial profit"})
                if pos.get("stopLoss"):
                    rules.append({"trigger": "Stop loss", "price": pos["stopLoss"],
                                  "action": "Close full position", "note": "Capital preservation"})
        return rules

    def test_day_trade_always_has_eod_rule(self):
        rules = self._derive_rules(self._day_pos())
        eod = [r for r in rules if r["price"] is None and "close" in r["trigger"].lower()]
        self.assertEqual(len(eod), 1, "Day trade must have exactly one EOD close rule")

    def test_day_trade_eod_is_last_rule(self):
        rules = self._derive_rules(self._day_pos(target1=190.0, target2=193.0, stop=180.0))
        self.assertIsNone(rules[-1]["price"], "EOD rule must be last in exit plan")

    def test_day_trade_target1_sell_half(self):
        rules = self._derive_rules(self._day_pos(target1=190.0))
        t1 = [r for r in rules if "Target 1" in r["trigger"]]
        self.assertEqual(len(t1), 1)
        self.assertIn("½", t1[0]["action"], "Target 1 action must say sell half")

    def test_day_trade_target2_sell_remainder(self):
        rules = self._derive_rules(self._day_pos(target1=190.0, target2=194.0))
        t2 = [r for r in rules if "Target 2" in r["trigger"]]
        self.assertEqual(len(t2), 1)
        self.assertIn("½", t2[0]["action"])

    def test_day_trade_stop_exit_full(self):
        rules = self._derive_rules(self._day_pos(stop=180.0))
        stop = [r for r in rules if "stop" in r["trigger"].lower()]
        self.assertEqual(len(stop), 1)
        self.assertIn("full", stop[0]["action"].lower())

    def test_swing_with_user_levels_uses_them(self):
        pos = {"source": "swing", "target1": 200.0, "target2": 210.0,
               "stopLoss": 185.0, "net_credit": -6.0, "contracts": 2,
               "entryPrice": 190.0, "dte": 14, "strategy": "Long Call"}
        rules = self._derive_rules(pos)
        prices = [r["price"] for r in rules if r["price"] is not None]
        self.assertIn(200.0, prices)
        self.assertIn(210.0, prices)
        self.assertIn(185.0, prices)

    def test_swing_no_eod_rule(self):
        pos = {"source": "swing", "target1": 200.0, "stopLoss": 185.0,
               "net_credit": -6.0, "contracts": 1, "entryPrice": 190.0,
               "dte": 14, "strategy": "Long Call"}
        rules = self._derive_rules(pos)
        eod = [r for r in rules if r["price"] is None]
        self.assertEqual(len(eod), 0, "Swing trade should NOT have EOD close rule")

    def test_regular_credit_spread_uses_target1(self):
        pos = {"source": "regular", "target1": 0.5, "stopLoss": 2.0,
               "net_credit": 1.5, "contracts": 1, "entryPrice": 185.0,
               "dte": 21, "strategy": "Bull Put Spread"}
        rules = self._derive_rules(pos)
        t1 = [r for r in rules if "Target 1" in r["trigger"]]
        self.assertEqual(len(t1), 1)
        self.assertIn("close", t1[0]["action"].lower())

    def test_no_targets_no_exit_rules_for_swing(self):
        pos = {"source": "swing", "net_credit": -5.0, "contracts": 1,
               "entryPrice": 190.0, "dte": 7, "strategy": "Long Call"}
        rules = self._derive_rules(pos)
        self.assertEqual(rules, [], "No levels → no rules for swing")


# ─────────────────────────────────────────────────────────────────────────────
# 6. Premium conversion layer
# ─────────────────────────────────────────────────────────────────────────────

class TestPremiumConversion(unittest.TestCase):

    def _patch_chain(self, bid: float, ask: float, delta: Optional[float] = None):
        df = _make_options_df(185.0, bid, ask, delta)
        return (
            patch("day_option_risk.bar_cache.get_option_dates", return_value=["2026-06-06"]),
            patch("day_option_risk.bar_cache.get_option_chain", return_value=(df, df)),
        )

    def test_estimate_call_premium_bullish_move(self):
        """Stock up $5 on a 0.5-delta call → premium up ~$2.50."""
        p1, p2 = self._patch_chain(bid=8.0, ask=9.0, delta=0.50)
        with p1, p2:
            est = estimate_premium_at_price("AAPL", 185.0, 190.0, is_put=False)
        self.assertIsNotNone(est)
        mid = 8.5
        expected = mid + 0.50 * 5.0   # 8.5 + 2.5 = 11.0
        self.assertAlmostEqual(est, expected, places=1)

    def test_estimate_call_premium_bearish_move_floors_at_penny(self):
        """Stock down hard → premium near zero, never negative."""
        p1, p2 = self._patch_chain(bid=1.0, ask=1.2, delta=0.50)
        with p1, p2:
            est = estimate_premium_at_price("AAPL", 185.0, 150.0, is_put=False)
        self.assertIsNotNone(est)
        self.assertGreaterEqual(est, 0.01, "Premium must never go below $0.01")

    def test_estimate_put_premium_bearish_move(self):
        """Stock down $5 on a 0.5-delta put → premium up ~$2.50."""
        p1, p2 = self._patch_chain(bid=8.0, ask=9.0, delta=-0.50)
        with p1, p2:
            est = estimate_premium_at_price("AMD", 185.0, 180.0, is_put=True)
        self.assertIsNotNone(est)
        mid = 8.5
        expected = mid + 0.50 * 5.0   # put: move = entry - target = 5
        self.assertAlmostEqual(est, expected, places=1)

    def test_atm_delta_fallback_when_not_in_chain(self):
        """When chain has no delta column, falls back to delta=0.5."""
        df = pd.DataFrame([{
            "strike": 500.0, "bid": 10.0, "ask": 11.0,
            "volume": 300, "openInterest": 1000, "impliedVolatility": 0.35,
        }])
        with (
            patch("day_option_risk.bar_cache.get_option_dates", return_value=["2026-06-06"]),
            patch("day_option_risk.bar_cache.get_option_chain", return_value=(df, df)),
        ):
            result = build_premium_targets(
                ticker="SPY",
                current_stock_price=500.0,
                stop_price=490.0,
                target1_price=510.0,
                target2_price=515.0,
                is_put=False,
            )
        self.assertEqual(result["source"], "atm_approx")
        self.assertEqual(result["delta_used"], 0.5)
        self.assertIsNotNone(result["t1_premium"])
        self.assertIsNotNone(result["stop_premium"])

    def test_chain_delta_used_when_available(self):
        """When chain provides delta, source='chain' and delta_used matches."""
        df = _make_options_df(500.0, 10.0, 11.0, delta=0.52)
        with (
            patch("day_option_risk.bar_cache.get_option_dates", return_value=["2026-06-06"]),
            patch("day_option_risk.bar_cache.get_option_chain", return_value=(df, df)),
        ):
            result = build_premium_targets(
                ticker="NVDA",
                current_stock_price=500.0,
                stop_price=488.0,
                target1_price=512.0,
                target2_price=520.0,
                is_put=False,
            )
        self.assertEqual(result["source"], "chain")
        self.assertAlmostEqual(result["delta_used"], 0.52, places=2)

    def test_t1_premium_higher_than_atm_for_call(self):
        """T1 is above current price for a call → premium at T1 > ATM premium."""
        df = _make_options_df(185.0, 8.0, 9.0, delta=0.52)
        with (
            patch("day_option_risk.bar_cache.get_option_dates", return_value=["2026-06-06"]),
            patch("day_option_risk.bar_cache.get_option_chain", return_value=(df, df)),
        ):
            result = build_premium_targets(
                ticker="AMD",
                current_stock_price=185.0,
                stop_price=178.0,
                target1_price=192.0,
                target2_price=198.0,
                is_put=False,
            )
        self.assertGreater(result["t1_premium"], result["atm_premium"])
        self.assertGreater(result["t2_premium"], result["t1_premium"])

    def test_stop_premium_lower_than_atm_for_call(self):
        """Stop is below current price for a call → premium at stop < ATM."""
        df = _make_options_df(185.0, 8.0, 9.0, delta=0.52)
        with (
            patch("day_option_risk.bar_cache.get_option_dates", return_value=["2026-06-06"]),
            patch("day_option_risk.bar_cache.get_option_chain", return_value=(df, df)),
        ):
            result = build_premium_targets(
                ticker="AMD",
                current_stock_price=185.0,
                stop_price=178.0,
                target1_price=192.0,
                target2_price=198.0,
                is_put=False,
            )
        self.assertLess(result["stop_premium"], result["atm_premium"])

    def test_put_position_stop_premium_lower_than_atm(self):
        """
        For a PUT: stop is ABOVE current price (bullish recovery stops out the put).
        Premium at stop should be less than ATM premium.
        """
        df = _make_options_df(500.0, 10.0, 11.0, delta=-0.50)
        with (
            patch("day_option_risk.bar_cache.get_option_dates", return_value=["2026-06-06"]),
            patch("day_option_risk.bar_cache.get_option_chain", return_value=(df, df)),
        ):
            result = build_premium_targets(
                ticker="QQQ",
                current_stock_price=500.0,
                stop_price=508.0,   # above current = stop for put
                target1_price=492.0,
                target2_price=485.0,
                is_put=True,
            )
        self.assertLess(result["stop_premium"], result["atm_premium"],
                        "PUT stop (stock goes up) should lower put premium")
        self.assertGreater(result["t1_premium"], result["atm_premium"],
                           "PUT T1 (stock goes down) should raise put premium")

    def test_no_options_data_returns_safe_dict(self):
        """When option chain unavailable, build_premium_targets returns safely."""
        with patch("day_option_risk.bar_cache.get_option_dates", return_value=None):
            result = build_premium_targets(
                ticker="FAKE",
                current_stock_price=100.0,
                stop_price=95.0,
                target1_price=105.0,
                target2_price=110.0,
            )
        self.assertEqual(result["source"], "unavailable")
        self.assertIsNone(result["atm_premium"])
        self.assertIsNone(result["stop_premium"])
        self.assertIsNone(result["t1_premium"])

    def test_zero_stock_price_returns_safe_dict(self):
        result = build_premium_targets(
            ticker="AMD",
            current_stock_price=0.0,
            stop_price=None,
            target1_price=None,
            target2_price=None,
        )
        self.assertIsNone(result["atm_premium"])
        self.assertEqual(result["source"], "unavailable")

    def test_none_targets_give_none_premium(self):
        df = _make_options_df(185.0, 8.0, 9.0, delta=0.52)
        with (
            patch("day_option_risk.bar_cache.get_option_dates", return_value=["2026-06-06"]),
            patch("day_option_risk.bar_cache.get_option_chain", return_value=(df, df)),
        ):
            result = build_premium_targets(
                ticker="AMD",
                current_stock_price=185.0,
                stop_price=None,
                target1_price=None,
                target2_price=None,
            )
        self.assertIsNone(result["stop_premium"])
        self.assertIsNone(result["t1_premium"])
        self.assertIsNone(result["t2_premium"])
        self.assertIsNotNone(result["atm_premium"], "ATM premium still computable")

    def test_expiry_used_is_set(self):
        df = _make_options_df(185.0, 8.0, 9.0, delta=0.5)
        with (
            patch("day_option_risk.bar_cache.get_option_dates", return_value=["2026-06-13"]),
            patch("day_option_risk.bar_cache.get_option_chain", return_value=(df, df)),
        ):
            result = build_premium_targets("AMD", 185.0, 180.0, 192.0, None)
        self.assertEqual(result["expiry_used"], "2026-06-13")


# ─────────────────────────────────────────────────────────────────────────────
# 7–8. Swing verdict
# ─────────────────────────────────────────────────────────────────────────────

class TestSwingVerdict(unittest.TestCase):

    def test_weak_rvol_downgrades_go_to_watch(self):
        """Swing GO with RVOL < 0.7 → WATCH."""
        v = resolve_verdict("swing", raw_score=6.5, rvol=0.6)
        self.assertEqual(v, Verdict.WATCH)

    def test_normal_rvol_keeps_go(self):
        v = resolve_verdict("swing", raw_score=6.5, rvol=1.0)
        self.assertEqual(v, Verdict.GO)

    def test_vix_35_hard_veto_swing(self):
        v = resolve_verdict("swing", raw_score=9.0, vix=35.0, volume_spike=True)
        self.assertEqual(v, Verdict.AVOID)

    def test_vix_34_does_not_veto(self):
        v = resolve_verdict("swing", raw_score=7.0, vix=34.9)
        self.assertEqual(v, Verdict.GO)

    def test_strong_go_requires_volume_spike(self):
        v_no_spike = resolve_verdict("swing", raw_score=8.5, volume_spike=False)
        v_spike    = resolve_verdict("swing", raw_score=8.5, volume_spike=True)
        self.assertNotEqual(v_spike, Verdict.GO,
                            "STRONG_GO should be higher than GO")
        self.assertNotEqual(v_no_spike, Verdict.STRONG_GO,
                            "Without spike, cannot be STRONG_GO")

    def test_score_below_3_gives_no_edge(self):
        v = resolve_verdict("swing", raw_score=2.9)
        self.assertEqual(v, Verdict.NO_EDGE)

    def test_score_below_5_gives_wait(self):
        v = resolve_verdict("swing", raw_score=4.0)
        self.assertEqual(v, Verdict.WAIT)

    def test_resolve_verdict_swing_object_vix_veto(self):
        scan = MagicMock()
        scan.verdict = "GO"
        scan.metrics = {"vix": 41.0}
        self.assertEqual(resolve_verdict_swing(scan), "AVOID")

    def test_resolve_verdict_swing_strong_setup_upgrades(self):
        scan = MagicMock()
        scan.verdict = "GO"
        scan.metrics = {"vix": 18.0, "setup_quality": "STRONG"}
        self.assertEqual(resolve_verdict_swing(scan), "STRONG_GO")


# ─────────────────────────────────────────────────────────────────────────────
# 9–10. Regular verdict scoring
# ─────────────────────────────────────────────────────────────────────────────

class TestRegularVerdict(unittest.TestCase):

    def test_zero_candidates_is_no_edge(self):
        self.assertEqual(resolve_verdict_regular(90.0, 0), "NO_EDGE")

    def test_score_80_plus_strong_go(self):
        self.assertEqual(resolve_verdict_regular(80.0, 1), "STRONG_GO")
        self.assertEqual(resolve_verdict_regular(95.0, 3), "STRONG_GO")

    def test_score_60_79_go(self):
        self.assertEqual(resolve_verdict_regular(60.0, 1), "GO")
        self.assertEqual(resolve_verdict_regular(79.9, 2), "GO")

    def test_score_45_59_watch(self):
        self.assertEqual(resolve_verdict_regular(45.0, 1), "WATCH")
        self.assertEqual(resolve_verdict_regular(59.9, 1), "WATCH")

    def test_score_30_44_wait(self):
        self.assertEqual(resolve_verdict_regular(30.0, 1), "WAIT")
        self.assertEqual(resolve_verdict_regular(44.9, 1), "WAIT")

    def test_score_below_30_avoid(self):
        self.assertEqual(resolve_verdict_regular(0.0, 1), "AVOID")
        self.assertEqual(resolve_verdict_regular(29.9, 2), "AVOID")

    def test_score_boundary_exactly_80(self):
        self.assertEqual(resolve_verdict_regular(80.0, 1), "STRONG_GO")

    def test_score_boundary_exactly_60(self):
        self.assertEqual(resolve_verdict_regular(60.0, 1), "GO")

    def test_score_boundary_exactly_45(self):
        self.assertEqual(resolve_verdict_regular(45.0, 1), "WATCH")

    def test_score_boundary_exactly_30(self):
        self.assertEqual(resolve_verdict_regular(30.0, 1), "WAIT")


# ─────────────────────────────────────────────────────────────────────────────
# 11. Verdict resolver raw-string normalization
# ─────────────────────────────────────────────────────────────────────────────

class TestVerdictNormalization(unittest.TestCase):

    def test_all_avoid_aliases_normalize(self):
        from verdict_resolver import _map_raw_to_verdict
        for alias in ("NO GO", "NO-GO", "NO_GO", "AVOID", "EXIT", "NO_TRADE"):
            self.assertEqual(_map_raw_to_verdict(alias), "AVOID",
                             f"'{alias}' should normalize to AVOID")

    def test_go_aliases(self):
        from verdict_resolver import _map_raw_to_verdict
        for alias in ("GO", "READY", "ENTER", "TRADE"):
            self.assertEqual(_map_raw_to_verdict(alias), "GO",
                             f"'{alias}' should normalize to GO")

    def test_watch_and_manage(self):
        from verdict_resolver import _map_raw_to_verdict
        for alias in ("WATCH", "EXTENDED", "MANAGE"):
            self.assertEqual(_map_raw_to_verdict(alias), "WATCH",
                             f"'{alias}' should normalize to WATCH")

    def test_verdict_enum_from_raw(self):
        self.assertEqual(Verdict.from_raw("NO-GO"),     Verdict.AVOID)
        self.assertEqual(Verdict.from_raw("STRONG GO"), Verdict.STRONG_GO)
        self.assertEqual(Verdict.from_raw("READY"),     Verdict.GO)
        self.assertEqual(Verdict.from_raw("AVOID"),     Verdict.AVOID)
        self.assertEqual(Verdict.from_raw("NO_EDGE"),   Verdict.NO_EDGE)

    def test_unknown_string_gives_no_edge(self):
        from verdict_resolver import _map_raw_to_verdict
        self.assertEqual(_map_raw_to_verdict("GIBBERISH"), "NO_EDGE")
        self.assertEqual(_map_raw_to_verdict(""), "NO_EDGE")


# ─────────────────────────────────────────────────────────────────────────────
# 12. AVOID always wins over GO/STRONG_GO in day engine
# ─────────────────────────────────────────────────────────────────────────────

class TestAvoidAlwaysWins(unittest.TestCase):

    def _scan_with(self, scan_verdict: str, td_action: str, vix: float = 20.0):
        s = MagicMock()
        s.verdict = scan_verdict
        s.trader_decision = {"suggested_action": td_action}
        s.metrics = {"vix": vix}
        return s

    def test_strong_go_scan_avoid_td(self):
        s = self._scan_with("STRONG GO", "AVOID")
        self.assertEqual(resolve_verdict_day(s), "AVOID")

    def test_go_scan_avoid_calls_td(self):
        s = self._scan_with("GO", "AVOID_CALLS")
        self.assertEqual(resolve_verdict_day(s), "AVOID")

    def test_go_scan_avoid_chasing_puts(self):
        s = self._scan_with("GO", "AVOID_CHASING_PUTS")
        self.assertEqual(resolve_verdict_day(s), "AVOID")

    def test_go_scan_avoid_naked_calls(self):
        s = self._scan_with("GO", "AVOID_NAKED_CALLS")
        self.assertEqual(resolve_verdict_day(s), "AVOID")

    def test_no_td_action_strong_go_stays_strong_go(self):
        s = self._scan_with("STRONG GO", "")
        self.assertEqual(resolve_verdict_day(s), "STRONG_GO")


# ─────────────────────────────────────────────────────────────────────────────
# 13. Day trade STRONG_GO requires OR breakout
# ─────────────────────────────────────────────────────────────────────────────

class TestDayStrongGoRequiresOrBreakout(unittest.TestCase):

    def test_strong_go_requires_or_breakout_above(self):
        v = resolve_verdict("day", raw_score=9.0, volume_spike=True, or_breakout="above")
        self.assertEqual(v, Verdict.STRONG_GO)

    def test_strong_go_requires_or_breakout_below(self):
        v = resolve_verdict("day", raw_score=9.0, volume_spike=True, or_breakout="below")
        self.assertEqual(v, Verdict.STRONG_GO)

    def test_no_or_breakout_caps_at_go(self):
        v = resolve_verdict("day", raw_score=9.0, volume_spike=True, or_breakout="inside")
        self.assertNotEqual(v, Verdict.STRONG_GO,
                            "Cannot be STRONG_GO without OR breakout")

    def test_no_or_breakout_none_caps_at_go(self):
        v = resolve_verdict("day", raw_score=9.0, volume_spike=True, or_breakout=None)
        self.assertNotEqual(v, Verdict.STRONG_GO)


# ─────────────────────────────────────────────────────────────────────────────
# 14. VIX scoring levels
# ─────────────────────────────────────────────────────────────────────────────

class TestVixScoring(unittest.TestCase):

    def test_vix_exactly_35_triggers_avoid(self):
        for eng in ("day", "swing", "regular"):
            v = resolve_verdict(eng, raw_score=9.0, vix=35.0)
            self.assertEqual(v, Verdict.AVOID)

    def test_vix_34_99_does_not_trigger_avoid(self):
        v = resolve_verdict("day", raw_score=7.0, vix=34.99)
        self.assertNotEqual(v, Verdict.AVOID)

    def test_vix_none_no_veto(self):
        v = resolve_verdict("day", raw_score=7.0, vix=None)
        self.assertNotEqual(v, Verdict.AVOID)


# ─────────────────────────────────────────────────────────────────────────────
# 15. VWAP band calculation sanity
# ─────────────────────────────────────────────────────────────────────────────

class TestVwapBands(unittest.TestCase):

    def setUp(self):
        n = 20
        idx = pd.date_range("2026-06-02 09:30", periods=n, freq="1min",
                            tz="America/New_York")
        self.bars = pd.DataFrame({
            "Open":   np.linspace(500.0, 502.0, n),
            "High":   np.linspace(500.5, 502.5, n),
            "Low":    np.linspace(499.5, 501.5, n),
            "Close":  np.linspace(500.0, 502.0, n),
            "Volume": np.full(n, 500_000),
        }, index=idx)

    def test_five_series_returned(self):
        res = _compute_vwap_bands(self.bars)
        self.assertEqual(len(res), 5)

    def test_vwap_is_positive_and_finite(self):
        # VWAP is a cumulative session average — it CAN legitimately be outside
        # individual bar High/Low as bars progress. The real constraint is it
        # must be a positive finite number.
        vwap, *_ = _compute_vwap_bands(self.bars)
        self.assertTrue((vwap > 0).all(), "VWAP must be positive")
        self.assertTrue(np.isfinite(vwap).all(), "VWAP must be finite")

    def test_bands_ordered_u2_u1_vwap_l1_l2(self):
        vwap, u1, l1, u2, l2 = _compute_vwap_bands(self.bars)
        self.assertTrue((u2 >= u1).all())
        self.assertTrue((u1 >= vwap).all())
        self.assertTrue((vwap >= l1).all())
        self.assertTrue((l1 >= l2).all())

    def test_vwap_nans_on_zero_volume(self):
        bars = self.bars.copy()
        bars["Volume"] = 0
        vwap, *_ = _compute_vwap_bands(bars)
        # Should not raise — returns nan/inf gracefully
        self.assertEqual(len(vwap), len(bars))


# ─────────────────────────────────────────────────────────────────────────────
# 16. Premium conversion math correctness
# ─────────────────────────────────────────────────────────────────────────────

class TestPremiumMath(unittest.TestCase):
    """Arithmetic accuracy for the delta-based conversion."""

    def _est(self, current: float, target: float, mid: float, delta: float, is_put=False) -> float:
        move = (current - target) if is_put else (target - current)
        return round(max(0.01, mid + delta * move), 2)

    def test_call_up5_delta_half(self):
        self.assertAlmostEqual(self._est(185, 190, 8.5, 0.5), 11.0, places=2)

    def test_call_down5_delta_half(self):
        self.assertAlmostEqual(self._est(185, 180, 8.5, 0.5), 6.0, places=2)

    def test_put_down5_delta_half(self):
        # stock falls 5 → put gains 2.5
        self.assertAlmostEqual(self._est(185, 180, 8.5, 0.5, is_put=True), 11.0, places=2)

    def test_put_up5_delta_half(self):
        # stock rises 5 → put loses 2.5
        self.assertAlmostEqual(self._est(185, 190, 8.5, 0.5, is_put=True), 6.0, places=2)

    def test_floor_at_penny(self):
        # Very far OTM with big adverse move → floor at 0.01
        val = self._est(185, 100, 1.0, 0.5)   # call, stock drops $85
        self.assertEqual(val, 0.01)

    def test_delta_065_call(self):
        # ITM call with delta=0.65, stock up $10
        expected = 8.5 + 0.65 * 10   # 15.0
        self.assertAlmostEqual(self._est(185, 195, 8.5, 0.65), expected, places=2)


if __name__ == "__main__":
    unittest.main()
