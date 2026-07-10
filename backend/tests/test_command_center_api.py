import tempfile
import time
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
import command_center_router as command_center_router_module  # noqa: E402
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
        storage.save_user_state(
            "ccc_user@example.com",
            [{"ticker": "SPY", "addedAt": "2026-05-01", "notes": ""}],
            [],
            day_trade_watchlist=["SPY"],
        )
        fake_payload = {
            "engines": [{
                "engine_type": "day",
                "timeframe": "same day",
                "best_use_case": "fast momentum",
                "signal": "READY",
                "signal_count": 1,
                "top_recommendation": {"ticker": "SPY", "reason": "Momentum aligned.", "risk_warning": "Manage intraday risk."},
                "risk_level": "medium",
                "summary": "Momentum aligned.",
                "market_bias": "BULLISH",
                "setup_quality": "GOOD",
                "final_decision": "GO",
                "confidence": 78,
                "reason": "Momentum aligned.",
                "supporting_factors": ["Above VWAP"],
                "missing_confirmations": [],
                "risk_state": "MEDIUM",
            }],
            "recommendations": [{
                "id": "day:SPY",
                "ticker": "SPY",
                "engine_type": "day",
                "direction": "call",
                "strategy": "Long Call",
                "signal": "GO",
                "market_bias": "BULLISH",
                "setup_quality": "GOOD",
                "final_decision": "GO",
                "confidence": 78,
                "reason": "Momentum aligned.",
                "supporting_factors": ["Above VWAP"],
                "missing_confirmations": [],
                "risk_state": "MEDIUM",
            }],
            "conflicts": [],
            "alerts_summary": {"active_alerts": 0, "critical_alerts": 0, "positions_requiring_exit": 0, "near_expiry_trades": 0, "high_iv_warnings": 0},
            "recent_activity": [],
            "charts": {"signal_distribution": []},
        }
        fake_market = {
            "market_mode": "Bullish trend",
            "best_style_today": "Swing",
            "spy_trend": "Bullish",
            "qqq_trend": "Bullish",
            "vix_risk": "LOW (15.2)",
            "risk_status": "Constructive",
            "confidence_score": 74,
            "ai_coach_summary": "SPY and QQQ supportive.",
        }
        with (
            patch.object(command_center_router_module, "build_command_center_payload", return_value=fake_payload),
            patch.object(command_center_router_module, "_fetch_live_market_summary", return_value=fake_market),
        ):
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
        self.assertIn("final_decision", data["recommendations"][0])
        self.assertIn(data["recommendations"][0]["final_decision"], {"STRONG_GO", "GO", "WATCH", "WAIT", "AVOID", "NO_EDGE"})

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

    def test_alerts_endpoint_syncs_legacy_user_alerts_into_alert_center(self) -> None:
        legacy_alert = {
            "id": "NVDA-Covered-Call-2026-06-19",
            "ticker": "NVDA",
            "companyName": "NVIDIA Corporation",
            "strategy": "Covered Call",
            "bias": "Neutral/Bullish",
            "expiry": "2026-06-19",
            "dte": 38,
            "weeksOut": 4,
            "score": 88,
            "maxProfit": 5.25,
            "maxLoss": 12.0,
            "netCredit": 1.05,
            "pop": 0.72,
            "ev": 0.84,
            "detectedAt": int(time.time() * 1000) - 60_000,
            "timeWindow": "10:00 AM – 10:15 AM PT",
            "emailSent": True,
            "dismissed": False,
        }
        storage.add_user_alert("ccc_user@example.com", legacy_alert, email_sent=True)

        r = self.client.get("/api/alerts", params={"active_only": True})
        self.assertEqual(r.status_code, 200)
        body = r.json()
        rows = body["data"]["alerts"]
        ids = {row["id"] for row in rows}
        self.assertIn("legacy-watchlist:NVDA-Covered-Call-2026-06-19", ids)
        synced = next(row for row in rows if row["id"] == "legacy-watchlist:NVDA-Covered-Call-2026-06-19")
        self.assertEqual(synced["ticker"], "NVDA")
        self.assertEqual(synced["engine_type"], "REGULAR")
        self.assertEqual(synced["signal"], "GO")
        self.assertEqual(synced["status"], "ACTIVE")

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

    def test_day_trade_endpoint_exposes_entry_guidance_and_option_risk_context(self) -> None:
        fake_scan = SimpleNamespace(
            ticker="NVDA",
            company_name="NVIDIA Corporation",
            verdict="GO",
            bias="long",
            bull_score=7.2,
            bear_score=2.1,
            reasons=["Above VWAP", "Opening range breakout confirmed"],
            metrics={"vix": 18.4, "momentum_pct": 1.1},
            trader_decision={"decision_message": "VWAP and momentum aligned."},
            entry_guidance={
                "state": "ENTRY_ACTIVE",
                "action": "Enter on confirmed VWAP hold above the opening range.",
                "pending_confirmations": [],
                "should_enter_now": "YES",
            },
            option_risk_context={
                "theta_risk": "HIGH",
                "gamma_risk": "HIGH",
                "iv_risk": "MEDIUM",
                "liquidity_risk": "LOW",
                "suggested_contract_window": "0DTE",
                "option_execution_warning": "Signal is strong, but 0DTE theta/gamma risk is high. Use smaller size and confirm VWAP hold.",
            },
        )
        fake_resolved = SimpleNamespace(
            market_bias="BULLISH",
            setup_quality="GOOD",
            verdict="GO",
            confidence=82,
            reason="Intraday structure is aligned.",
            supporting_factors=["Above VWAP"],
            missing_confirmations=[],
            risk_state="MEDIUM",
            explanation={"recommended_action": "Enter with confirmation"},
            risk_reason="0DTE options require tighter execution.",
            display_confidence=84,
            execution_fields=[{"label": "VWAP", "value": "$901.20"}],
        )

        with (
            patch.object(main_module, "run_day_trade_scan", return_value=fake_scan),
            patch.object(main_module, "resolve_trade_decision", return_value=fake_resolved),
        ):
            r = self.client.post("/api/day-trade", json={"ticker": "NVDA"})

        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["ticker"], "NVDA")
        self.assertEqual(body["entry_guidance"]["state"], "ENTRY_ACTIVE")
        self.assertEqual(body["option_risk_context"]["theta_risk"], "HIGH")
        self.assertEqual(body["option_risk_context"]["suggested_contract_window"], "0DTE")

    def test_signal_feed_unifies_engine_rows_and_paginates(self) -> None:
        storage.save_user_state(
            "ccc_user@example.com",
            [],
            [{"ticker": "TSLA", "status": "open"}],
            my_tickers=[
                {"symbol": "AVGO", "trade_types": ["regular"], "company_name": "Broadcom Inc.", "is_active": True, "added_date": "2026-04-01"},
                {"symbol": "NVDA", "trade_types": ["day", "swing"], "company_name": "NVIDIA Corp.", "is_active": True, "added_date": "2026-04-01"},
                {"symbol": "TSLA", "trade_types": ["swing"], "company_name": "Tesla Inc.", "is_active": True, "added_date": "2026-04-01"},
            ],
        )

        def fake_regular(_ticker: str, **_kwargs):
            return SimpleNamespace(
                company_name="Mock Co",
                reason="Trend is still healthy.",
                verdict="GO",
                signals=SimpleNamespace(current_price=123.45, price_change_pct=2.1, trend="UPTREND", rsi=61.2),
                recommendations=[SimpleNamespace(strategy="Long Call", bias="Bullish")],
                price_history=[
                    SimpleNamespace(date="2026-05-01", close=118.0),
                    SimpleNamespace(date="2026-05-02", close=121.5),
                    SimpleNamespace(date="2026-05-05", close=123.45),
                ],
            )

        def fake_day_scan(ticker: str, **kwargs):
            return SimpleNamespace(
                ticker=ticker.upper(),
                verdict="GO",
                bias="long",
                reasons=["Above VWAP"],
                metrics={"rs_vs_qqq_pct": 1.7},
                trader_decision={"decision_message": "Good intraday structure."},
                bull_score=6.0,
                bear_score=2.0,
                entry_guidance={"should_enter_now": "YES", "state": "ENTRY_ACTIVE"},
                option_risk_context={
                    "theta_risk": "HIGH",
                    "gamma_risk": "HIGH",
                    "iv_risk": "MEDIUM",
                    "liquidity_risk": "LOW",
                    "suggested_contract_window": "0DTE",
                    "option_execution_warning": "Signal is strong, but 0DTE gamma risk is high. Use smaller size and confirm VWAP hold.",
                },
            )

        def fake_swing_scan(ticker: str, **kwargs):
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
                bull_score=8.0,
                bear_score=1.5,
            )

        def fake_resolve(payload: dict):
            engine = str(payload.get("engine_type", "")).lower()
            if engine == "day":
                return SimpleNamespace(
                    market_bias="BULLISH",
                    setup_quality="GOOD",
                    verdict="GO",
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
                    verdict="WATCH",
                    confidence=72,
                    reason="Swing setup is constructive.",
                    supporting_factors=["Trend intact"],
                    missing_confirmations=["Wait for close strength"],
                    risk_state="MEDIUM",
                )
            return SimpleNamespace(
                market_bias="BULLISH",
                setup_quality="GOOD",
                verdict="GO",
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
            r = self.client.get("/api/signal-feed", params={"page_size": 2, "source": "day"})

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
        self.assertEqual(row["sources"], ["day", "swing"])
        self.assertEqual(row["day"]["option_risk_context"]["theta_risk"], "HIGH")
        self.assertIn("analyze_url", row["actions"])

    def test_signal_feed_accepts_legacy_my_ticker_shapes(self) -> None:
        storage.save_user_state(
            "ccc_user@example.com",
            [],
            [],
            my_tickers=[
                "AAPL",
                {"ticker": "MSFT", "categories": ["DAY_TRADE", "POSITION_TRADE"], "name": "Microsoft"},
                {"symbol": "NVDA", "trade_type": "SWING_TRADE", "company": "NVIDIA"},
                {"symbol": "ZZZ", "trade_types": ["DAY_TRADE"], "is_active": False},
            ],
        )

        def fake_regular(ticker: str, **_kwargs):
            return SimpleNamespace(
                company_name=f"{ticker.upper()} Co",
                reason="Fallback regular analysis.",
                signals=SimpleNamespace(current_price=123.45, price_change_pct=2.1, price_change=2.5, trend="UPTREND", rsi=61.2, iv_rank=30),
                recommendations=[SimpleNamespace(strategy="Long Call", bias="Bullish", total_score=75, expected_value=1, edge_ratio=1, dte=14, passes_liquidity_filter=True, passes_rr_filter=True)],
                price_history=[],
            )

        def fake_day_scan(ticker: str, **_kwargs):
            return SimpleNamespace(
                ticker=ticker.upper(),
                verdict="WATCH",
                bias="long",
                reasons=["Watch"],
                metrics={"rs_vs_qqq_pct": 0.5},
                trader_decision={},
                bull_score=5.0,
                bear_score=2.0,
                entry_guidance={},
                option_risk_context={},
            )

        def fake_swing_scan(ticker: str, **_kwargs):
            return SimpleNamespace(
                ticker=ticker.upper(),
                verdict="WATCH",
                bias="long",
                reasons=["Swing watch"],
                metrics={},
                swing_bias="BULLISH",
                entry_quality="WATCH",
                risk_level="MEDIUM",
                final_action="WATCH",
                trade_quality_score=6.0,
                decision_message="Watch",
                confirmation_needed=[],
                avoid_reason=None,
                bull_score=6.0,
                bear_score=2.0,
            )

        def fake_resolve(_payload: dict):
            return SimpleNamespace(
                market_bias="BULLISH",
                setup_quality="WATCH",
                verdict="WATCH",
                confidence=65,
                reason="Watch state.",
                supporting_factors=[],
                missing_confirmations=[],
                risk_state="MEDIUM",
            )

        with (
            patch.object(main_module, "_get_analysis_with_cache", side_effect=fake_regular),
            patch.object(main_module, "run_day_trade_scan", side_effect=fake_day_scan),
            patch.object(main_module, "run_swing_trade_scan", side_effect=fake_swing_scan),
            patch.object(main_module, "resolve_trade_decision", side_effect=fake_resolve),
        ):
            all_rows = self.client.get("/api/signal-feed", params={"page_size": 100}).json()["data"]["rows"]
            day_rows = self.client.get("/api/signal-feed", params={"source": "day", "page_size": 100}).json()["data"]["rows"]

        all_symbols = {row["ticker"] for row in all_rows}
        day_symbols = {row["ticker"] for row in day_rows}
        self.assertEqual(all_symbols, {"AAPL", "MSFT", "NVDA"})
        self.assertEqual(day_symbols, {"AAPL", "MSFT"})
        self.assertNotIn("ZZZ", all_symbols)
        by_symbol = {row["ticker"]: row for row in all_rows}
        self.assertEqual(set(by_symbol["AAPL"]["sources"]), {"day", "regular", "swing"})
        self.assertEqual(set(by_symbol["MSFT"]["sources"]), {"day", "regular"})
        self.assertEqual(by_symbol["NVDA"]["sources"], ["swing"])


if __name__ == "__main__":
    unittest.main()
