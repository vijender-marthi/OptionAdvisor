import unittest

from decision_resolver import resolve_trade_decision


class DecisionResolverTests(unittest.TestCase):
    def test_day_trade_bullish_but_not_ready_stays_wait(self) -> None:
        decision = resolve_trade_decision(
            {
                "engine_type": "day",
                "ticker": "NVDA",
                "verdict": "WATCH",
                "bias": "long",
                "reasons": ["Above VWAP", "Volume still light"],
                "metrics": {
                    "vix": 18.5,
                    "confidence": {
                        "trend_strength": "HIGH",
                        "breakout_quality": "WEAK",
                        "volume_confirmation": "WEAK",
                        "market_alignment": "STRONG",
                        "risk": "LOW",
                    },
                },
                "trader_decision": {
                    "market_state": "MARKET_SUPPORTIVE",
                    "decision_message": "Long candidate structure, but confirmation is still needed.",
                    "confirmation_needed": ["break intraday high", "volume expansion"],
                },
            }
        )
        self.assertEqual(decision.market_bias, "BULLISH")
        self.assertEqual(decision.execution_readiness, "WATCH")
        self.assertEqual(decision.final_decision, "WATCH")
        self.assertIn("Breakout confirmation", decision.missing_confirmations)

    def test_swing_trade_quality_long_maps_to_ready(self) -> None:
        decision = resolve_trade_decision(
            {
                "engine_type": "swing",
                "ticker": "TSLA",
                "swing_bias": "BULLISH",
                "entry_quality": "GOOD_ENTRY",
                "risk_level": "MEDIUM",
                "final_action": "QUALITY_LONG",
                "trade_quality_score": 8.4,
                "decision_message": "Trend continuation remains healthy.",
                "confirmation_needed": [],
                "reasons": ["MA20 and MA50 are rising", "Relative strength is improving"],
            }
        )
        self.assertEqual(decision.final_decision, "READY")
        self.assertEqual(decision.setup_quality, "GOOD")
        self.assertEqual(decision.market_bias, "BULLISH")

    def test_regular_trade_high_iv_maps_to_avoid(self) -> None:
        decision = resolve_trade_decision(
            {
                "engine_type": "regular",
                "signals": {
                    "directional_bias": "Bullish",
                    "trend": "uptrend",
                    "iv_rank": 72,
                    "bias_confidence": 0.71,
                    "iv_environment": "elevated",
                    "volatility_regime": "high",
                },
                "recommendations": [
                    {
                        "strategy": "Long Call",
                        "bias": "Bullish",
                        "net_credit": -4.25,
                        "expected_value": 0.18,
                        "edge_ratio": 0.07,
                        "dte": 28,
                        "passes_liquidity_filter": True,
                        "passes_rr_filter": True,
                        "warnings": ["IV is rich for a simple long premium buy."],
                        "scores": {"total_score": 24},
                    }
                ],
            }
        )
        self.assertEqual(decision.market_bias, "BULLISH")
        self.assertEqual(decision.final_decision, "AVOID")
        self.assertEqual(decision.execution_readiness, "AVOID")
        self.assertIn("iv", decision.reason.lower())


if __name__ == "__main__":
    unittest.main()
