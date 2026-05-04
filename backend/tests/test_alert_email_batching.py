import unittest
from types import SimpleNamespace
from unittest.mock import patch

import main
from models import RecommendationOut, ScoreBreakdown


def _recommendation(strategy: str, expiry: str) -> RecommendationOut:
    return RecommendationOut(
        rank=1,
        strategy=strategy,
        bias="Bullish",
        legs=[],
        expiry=expiry,
        dte=28,
        net_credit=1.25,
        spread_width=5.0,
        max_profit=1.25,
        max_loss=3.75,
        risk_reward_ratio=3.0,
        credit_pct_of_width=0.25,
        breakeven_lower=0.0,
        breakeven_upper=0.0,
        short_leg_delta=0.25,
        prob_of_profit=0.72,
        prob_of_max_loss=0.28,
        expected_value=0.18,
        passes_rr_filter=True,
        passes_liquidity_filter=True,
        passes_credit_filter=True,
        scores=ScoreBreakdown(
            signal_score=40,
            structure_score=30,
            liquidity_score=20,
            iv_fit_score=10,
            total_score=100,
        ),
        rationale="test",
        exit_plan="test",
        warnings=[],
    )


class AlertEmailBatchingTests(unittest.TestCase):
    def test_watchlist_scan_sends_one_email_for_multiple_new_alerts(self) -> None:
        data = SimpleNamespace(
            company_name="Example Co",
            signals=SimpleNamespace(),
            recommendations=[
                _recommendation("Bull Put Spread", "2026-06-19"),
                _recommendation("Cash-Secured Put", "2026-06-26"),
            ],
        )
        sent_batches: list[list[str]] = []
        updated_alert_ids: list[str] = []

        def fake_send(_email, alerts, _user_name=None):
            sent_batches.append([a.strategy for a in alerts])
            return {"sent": True, "message": "batched"}

        with patch.object(main, "_get_analysis_with_cache", return_value=data), \
             patch.object(main, "_backend_verdict_is_go", return_value=True), \
             patch.object(main, "add_user_alert", return_value=True), \
             patch.object(main, "_send_alert_email", side_effect=fake_send), \
             patch.object(main, "update_user_alert_email", side_effect=lambda _email, alert_id, *_args: updated_alert_ids.append(alert_id)):
            main._scan_user_watchlist_for_alerts({
                "email": "trader@example.com",
                "watchlist": [{"ticker": "AAPL"}],
            })

        self.assertEqual(sent_batches, [["Bull Put Spread", "Cash-Secured Put"]])
        self.assertEqual(updated_alert_ids, [
            "AAPL-Bull Put Spread-2026-06-19",
            "AAPL-Cash-Secured Put-2026-06-26",
        ])


if __name__ == "__main__":
    unittest.main()
