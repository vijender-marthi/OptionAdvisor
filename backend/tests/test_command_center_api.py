import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient

import storage

_tmp = tempfile.TemporaryDirectory()
storage.DB_PATH = Path(_tmp.name) / "ccc_command_center_test.sqlite3"
storage.init_db()

from auth_routes import require_access_email  # noqa: E402
from command_center_router import api_envelope  # noqa: E402
import main as main_module  # noqa: E402
from main import app  # noqa: E402


class CommandCenterApiTests(unittest.TestCase):
    def setUp(self) -> None:
        app.dependency_overrides[require_access_email] = lambda: "ccc_user@example.com"
        self.client = TestClient(app)

    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    def test_api_envelope_shape(self) -> None:
        env = api_envelope({"x": 1}, stale=True)
        self.assertIn("data", env)
        self.assertIn("error", env)
        self.assertIn("stale", env)
        self.assertIn("fetched_at", env)
        self.assertTrue(env["stale"])
        self.assertIsNone(env["error"])

    def test_trade_command_center_happy_path(self) -> None:
        r = self.client.get("/api/trade-command-center")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertIsNone(body.get("error"))
        data = body["data"]
        self.assertIn("market_summary", data)
        self.assertIn("engines", data)
        self.assertIn("recommendations", data)
        self.assertIn("conflicts", data)
        self.assertIn("alerts_summary", data)
        self.assertIn("recent_activity", data)
        self.assertIn("charts", data)
        self.assertIn("confidence_score", data["market_summary"])
        self.assertIn("final_decision", data["engines"][0])
        self.assertIn("execution_readiness", data["engines"][0])
        self.assertIn("final_decision", data["recommendations"][0])
        self.assertIn(data["recommendations"][0]["final_decision"], {"READY", "WATCH", "WAIT", "AVOID", "NO_EDGE"})

    def test_alerts_list_normalized_envelope(self) -> None:
        r = self.client.get("/api/alerts")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertIsNone(body["error"])
        d = body["data"]
        self.assertIn("summary", d)
        self.assertIn("sections", d)
        self.assertIn("alerts", d)
        self.assertIn("day_trade", d["sections"])
        self.assertIn("swing_trade", d["sections"])
        self.assertIn("regular_trade", d["sections"])
        self.assertIn("portfolio", d["sections"])
        self.assertIn("market", d["sections"])
        self.assertGreaterEqual(d["summary"]["total"], 5)
        self.assertEqual(d["summary"]["active"], len([x for x in d["alerts"] if x["status"] == "ACTIVE"]))

    def test_positions_center_unifies_trade_watchlists(self) -> None:
        storage.save_user_state(
            "ccc_user@example.com",
            [{"ticker": "spy", "addedAt": "2026-04-01", "notes": "opt"}],
            [],
            day_trade_watchlist=["qqq", "iwm"],
            swing_trade_watchlist=["nvda"],
        )
        r = self.client.get("/api/positions-center")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertIsNone(body.get("error"))
        data = body["data"]
        wl = data["watchlist"]
        items = data["watchlist_items"]
        self.assertEqual(wl, items)
        pairs = {(str(x["ticker"]).upper(), x["engine_source"]) for x in wl}
        self.assertEqual(
            pairs,
            {("SPY", "Regular"), ("QQQ", "Day"), ("IWM", "Day"), ("NVDA", "Swing")},
        )
        self.assertEqual(data["summary"]["watchlist_count"], 4)

    def test_watchlistx_unifies_engine_rows_and_paginates(self) -> None:
        storage.save_user_state(
            "ccc_user@example.com",
            [{"ticker": "avgo", "addedAt": "2026-04-01", "notes": "regular note"}],
            [{"ticker": "TSLA", "status": "open"}],
            day_trade_watchlist=["nvda"],
            swing_trade_watchlist=["tsla"],
        )

        def fake_regular(_ticker: str, **_kwargs):
            return SimpleNamespace(
                company_name="Mock Co",
                reason="Trend is still healthy.",
                final_decision="READY",
                signals=SimpleNamespace(current_price=123.45, price_change_pct=2.1, trend="UPTREND", rsi=61.2),
                recommendations=[SimpleNamespace(strategy="Long Call", bias="Bullish")],
                price_history=[
                    SimpleNamespace(date="2026-05-01", close=118.0),
                    SimpleNamespace(date="2026-05-02", close=121.5),
                    SimpleNamespace(date="2026-05-05", close=123.45),
                ],
            )

        def fake_day_scan(ticker: str):
            return SimpleNamespace(
                ticker=ticker.upper(),
                verdict="GO",
                bias="long",
                reasons=["Above VWAP"],
                metrics={"rs_vs_qqq_pct": 1.7},
                trader_decision={"decision_message": "Good intraday structure."},
            )

        def fake_swing_scan(ticker: str):
            return SimpleNamespace(
                ticker=ticker.upper(),
                verdict="GO",
                bias="long",
                reasons=["Trend continuation"],
                metrics={},
                swing_bias="BULLISH",
                entry_quality="GOOD_ENTRY",
                risk_level="MEDIUM",
                final_action="QUALITY_LONG",
                trade_quality_score=8.3,
                decision_message="Trend continuation remains healthy.",
                confirmation_needed=[],
                avoid_reason=None,
            )

        def fake_resolve(payload: dict):
            engine = str(payload.get("engine_type", "")).lower()
            if engine == "day":
                return SimpleNamespace(
                    market_bias="BULLISH",
                    setup_quality="GOOD",
                    execution_readiness="READY",
                    final_decision="READY",
                    confidence=78,
                    reason="Day setup is aligned.",
                    supporting_factors=["VWAP held"],
                    missing_confirmations=[],
                    risk_state="LOW",
                )
            if engine == "swing":
                return SimpleNamespace(
                    market_bias="BULLISH",
                    setup_quality="GOOD",
                    execution_readiness="WATCH",
                    final_decision="WATCH",
                    confidence=72,
                    reason="Swing setup is constructive.",
                    supporting_factors=["Trend intact"],
                    missing_confirmations=["Wait for close strength"],
                    risk_state="MEDIUM",
                )
            return SimpleNamespace(
                market_bias="BULLISH",
                setup_quality="GOOD",
                execution_readiness="READY",
                final_decision="READY",
                confidence=75,
                reason="Regular setup is ready.",
                supporting_factors=["Liquid chain"],
                missing_confirmations=[],
                risk_state="MEDIUM",
            )

        with (
            patch.object(main_module, "_get_analysis_with_cache", side_effect=fake_regular),
            patch.object(main_module, "run_day_trade_scan", side_effect=fake_day_scan),
            patch.object(main_module, "run_swing_trade_scan", side_effect=fake_swing_scan),
            patch.object(main_module, "resolve_trade_decision", side_effect=fake_resolve),
        ):
            r = self.client.get("/api/watchlistx", params={"page_size": 2, "source": "day"})

        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertIsNone(body["error"])
        data = body["data"]
        self.assertIn("summary", data)
        self.assertIn("rows", data)
        self.assertIn("ai_summary", data)
        self.assertIn("pagination", data)
        self.assertEqual(data["pagination"]["page_size"], 10)
        self.assertEqual(data["pagination"]["total"], 1)
        row = data["rows"][0]
        self.assertEqual(row["ticker"], "NVDA")
        self.assertEqual(row["day_decision"], "READY")
        self.assertEqual(row["swing_decision"], "WATCH")
        self.assertEqual(row["regular_decision"], "READY")
        self.assertEqual(row["agreement_state"], "READY")
        self.assertEqual(row["sources"], ["day"])
        self.assertIn("analyze_url", row["actions"])


if __name__ == "__main__":
    unittest.main()
