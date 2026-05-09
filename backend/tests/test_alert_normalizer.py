import unittest

from alerts.alert_normalizer import (
    normalize_day_trade_alert,
    normalize_portfolio_alert,
    normalize_regular_trade_alert,
    normalize_swing_trade_alert,
)


class AlertNormalizerTests(unittest.TestCase):
    def test_portfolio_scale_out_alert(self) -> None:
        alert = normalize_portfolio_alert(
            {
                "id": "trade-tsla-1",
                "ticker": "TSLA",
                "pnlPct": 100,
                "status": "open",
                "created_at": "2026-05-08T16:00:00+00:00",
            }
        )
        self.assertIsNotNone(alert)
        assert alert is not None
        self.assertEqual(alert.engine_type, "PORTFOLIO")
        self.assertEqual(alert.alert_type, "SCALE_OUT")
        self.assertEqual(alert.severity, "WARNING")
        self.assertEqual(alert.signal, "SCALE_OUT")
        self.assertEqual(alert.recommended_action, "Sell 50%, keep runner")

    def test_swing_watch_alert(self) -> None:
        alert = normalize_swing_trade_alert(
            {
                "ticker": "NVDA",
                "alert_type": "SWING_GO",
                "severity": "INFO",
                "signal": "WATCH",
                "message": "NVDA remains in a healthy swing uptrend.",
                "reason": "Trend structure is still intact.",
                "recommended_action": "Let run while trend holds",
                "created_at": "2026-05-08T16:00:00+00:00",
            }
        )
        self.assertIsNotNone(alert)
        assert alert is not None
        self.assertEqual(alert.engine_type, "SWING")
        self.assertEqual(alert.alert_type, "SWING_GO")
        self.assertEqual(alert.severity, "INFO")
        self.assertEqual(alert.signal, "WATCH")

    def test_regular_high_iv_warning(self) -> None:
        alert = normalize_regular_trade_alert(
            {
                "ticker": "AVGO",
                "signal": "SKIP",
                "message": "AVGO trend is bullish, but option IV is elevated.",
                "reason": "High IV makes a simple long call expensive.",
                "recommended_action": "Use smaller size, longer expiry, or debit spread. Avoid oversized long calls.",
                "created_at": "2026-05-08T16:00:00+00:00",
            }
        )
        self.assertIsNotNone(alert)
        assert alert is not None
        self.assertEqual(alert.alert_type, "HIGH_IV_WARNING")
        self.assertEqual(alert.engine_type, "REGULAR")
        self.assertEqual(alert.severity, "WARNING")

    def test_day_trade_vwap_lost_alert(self) -> None:
        alert = normalize_day_trade_alert(
            {
                "ticker": "AMD",
                "message": "AMD lost VWAP after the opening push.",
                "reasons": ["VWAP lost", "momentum faded"],
                "created_at": "2026-05-08T16:00:00+00:00",
            }
        )
        self.assertIsNotNone(alert)
        assert alert is not None
        self.assertEqual(alert.engine_type, "DAY")
        self.assertEqual(alert.alert_type, "VWAP_LOST")
        self.assertEqual(alert.severity, "CRITICAL")
        self.assertEqual(alert.signal, "EXIT")


if __name__ == "__main__":
    unittest.main()
