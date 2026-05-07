"""Unit tests for swing-trade options playbook hints (no live Yahoo calls)."""

import unittest

from swing_trade import compute_playbook_hint


def _decision(**kwargs):
    base = {
        "swing_bias": "NEUTRAL",
        "entry_quality": "NO_CLEAN_ENTRY",
        "risk_level": "MEDIUM",
        "final_action": "NO_TRADE",
        "trade_quality_score": 4.0,
        "decision_label": "NO_TRADE_WAIT",
        "decision_message": "",
        "risk_flags": [],
        "confirmation_needed": [],
        "suggested_expiry_window": "No trade",
        "suggested_strategy": "NO_TRADE",
        "avoid_reason": None,
    }
    base.update(kwargs)
    return base


class PlaybookHintTests(unittest.TestCase):
    def test_bullish_good_entry_low_iv_long_call(self):
        d = _decision(
            swing_bias="BULLISH",
            entry_quality="GOOD_ENTRY",
            final_action="STRONG_GO",
            decision_label="QUALITY_LONG",
        )
        h = compute_playbook_hint(
            bias="long",
            verdict="STRONG GO",
            rsi_val=55.0,
            decision=d,
            iv_rank=40.0,
            implied_iv_pct=25.0,
            hv_20=30.0,
            earnings_days=None,
        )
        self.assertTrue(h.lower().startswith("long call"))

    def test_bullish_good_entry_high_iv_call_spread(self):
        d = _decision(
            swing_bias="BULLISH",
            entry_quality="GOOD_ENTRY",
            final_action="STRONG_GO",
            decision_label="QUALITY_LONG",
        )
        h = compute_playbook_hint(
            bias="long",
            verdict="GO",
            rsi_val=52.0,
            decision=d,
            iv_rank=55.0,
            implied_iv_pct=40.0,
            hv_20=22.0,
            earnings_days=None,
        )
        self.assertIn("call debit spread", h.lower())

    def test_bullish_extended_wait_pullback(self):
        d = _decision(
            swing_bias="BULLISH",
            entry_quality="WAIT_PULLBACK",
            final_action="WAIT_PULLBACK",
            decision_label="BULLISH_BUT_EXTENDED",
        )
        h = compute_playbook_hint(
            bias="long",
            verdict="WATCH",
            rsi_val=78.0,
            decision=d,
            iv_rank=None,
            implied_iv_pct=None,
            hv_20=None,
            earnings_days=None,
        )
        self.assertIn("pullback", h.lower())

    def test_bearish_good_entry_long_put(self):
        d = _decision(
            swing_bias="BEARISH",
            entry_quality="GOOD_ENTRY",
            final_action="WATCH_PUT",
            decision_label="QUALITY_LONG",
        )
        h = compute_playbook_hint(
            bias="short",
            verdict="GO",
            rsi_val=38.0,
            decision=d,
            iv_rank=30.0,
            implied_iv_pct=24.0,
            hv_20=28.0,
            earnings_days=None,
        )
        self.assertTrue(h.lower().startswith("long put"))

    def test_bearish_oversold_wait_bounce(self):
        d = _decision(
            swing_bias="BEARISH",
            entry_quality="WAIT_PULLBACK",
            final_action="WAIT_FOR_BREAKDOWN",
            decision_label="BULLISH_BUT_EXTENDED",
        )
        h = compute_playbook_hint(
            bias="short",
            verdict="WATCH",
            rsi_val=20.0,
            decision=d,
            iv_rank=None,
            implied_iv_pct=None,
            hv_20=None,
            earnings_days=None,
        )
        self.assertIn("bounce", h.lower())

    def test_earnings_layer_replaces_long_call_with_spread(self):
        d = _decision(
            swing_bias="BULLISH",
            entry_quality="GOOD_ENTRY",
            final_action="STRONG_GO",
            decision_label="QUALITY_LONG",
        )
        h = compute_playbook_hint(
            bias="long",
            verdict="STRONG GO",
            rsi_val=50.0,
            decision=d,
            iv_rank=30.0,
            implied_iv_pct=22.0,
            hv_20=25.0,
            earnings_days=4,
        )
        self.assertIn("call debit spread", h.lower())
        self.assertIn("earnings", h.lower())

    def test_no_trade_weak(self):
        d = _decision(
            swing_bias="NEUTRAL",
            entry_quality="NO_CLEAN_ENTRY",
            final_action="NO_TRADE",
            decision_label="WEAK_SETUP",
        )
        h = compute_playbook_hint(
            bias=None,
            verdict="WAIT",
            rsi_val=50.0,
            decision=d,
            iv_rank=None,
            implied_iv_pct=None,
            hv_20=None,
            earnings_days=None,
        )
        self.assertIn("no trade", h.lower())


if __name__ == "__main__":
    unittest.main()
