import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import storage


def _scan(final_decision: str = "READY"):
    return SimpleNamespace(
        ticker="AAPL",
        company_name="Apple Inc.",
        verdict=final_decision,
        bias="long",
        bull_score=7.2,
        bear_score=2.1,
        reasons=["Price reclaimed ORH with VWAP support.", "Volume is acceptable."],
        metrics={
            "session_date": "2026-07-09",
            "market_state": "REGULAR",
            "session_phase": "Morning",
            "market_bias": "bullish",
            "last_price": 312.25,
            "change_pct": 1.2,
            "trigger_setup": "ORH Breakout",
            "trigger_fired": final_decision in {"READY", "GO", "EXECUTE"},
            "trigger_requirement": "5m close above 312.00",
            "or_high": 312.0,
            "or_low": 308.0,
            "vwap": 310.5,
            "data_quality_status": "OK",
            "chart_bars": [
                {"t": "2026-07-09T09:30:00-04:00", "o": 309.0, "h": 310.0, "l": 308.5, "c": 309.5, "v": 1000, "vwap": 309.3333},
                {"t": "2026-07-09T09:31:00-04:00", "o": 309.5, "h": 312.5, "l": 309.2, "c": 312.25, "v": 1500, "vwap": 310.4167},
            ],
            "timeframe_state": {"final_decision": final_decision},
        },
        trader_decision={"decision_message": "Backend says setup is ready."},
        entry_guidance={
            "entry_price": 312.0,
            "risk_below": 309.5,
            "scalp_target": 314.0,
            "target_2": 316.0,
            "rr_ratio": "1.6:1",
        },
        option_risk_context={"recommended_contracts": "1 contract"},
    )


def _resolved(final_decision: str = "READY"):
    return {
        "verdict": final_decision,
        "final_decision": final_decision,
        "market_bias": "BULLISH",
        "headline": "Ready",
        "reason": "Backend confirmed trigger.",
        "missing_confirmations": [],
    }


def _workspace(final_decision: str = "READY", *, metric_overrides=None, resolved_overrides=None, entry_overrides=None, interval: str = "1m"):
    from day_trade_workspace import build_day_trade_workspace_response

    scan = _scan(final_decision)
    scan.metrics.update(metric_overrides or {})
    scan.entry_guidance.update(entry_overrides or {})
    resolved = _resolved(final_decision)
    resolved.update(resolved_overrides or {})
    return build_day_trade_workspace_response(scan=scan, resolved=resolved, interval=interval)


class DayTradeWorkspaceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.old_db_path = storage.DB_PATH
        storage.DB_PATH = Path(self.tmp.name) / "day-workspace.sqlite3"
        storage.init_db()

    def tearDown(self) -> None:
        storage.DB_PATH = self.old_db_path
        self.tmp.cleanup()

    def test_assembler_returns_page_ready_ready_workspace(self) -> None:
        from day_trade_workspace import build_day_trade_workspace_response

        workspace = build_day_trade_workspace_response(scan=_scan("READY"), resolved=_resolved("READY"), interval="1m")

        self.assertEqual(workspace["schemaVersion"], "day-trade-workspace.v1")
        self.assertEqual(workspace["symbol"]["ticker"], "AAPL")
        self.assertEqual(workspace["session"]["mode"], "live")
        self.assertEqual(workspace["decision"]["permission"]["code"], "ready")
        self.assertTrue(workspace["decision"]["primaryAction"]["enabled"])
        self.assertEqual(workspace["decision"]["primaryAction"]["type"], "open_trade_ticket")
        self.assertEqual(workspace["riskPlan"]["entry"]["display"], "$312.00")
        self.assertEqual(len(workspace["chart"]["candles"]), 2)
        self.assertEqual(workspace["chart"]["vwapOverlay"]["id"], "session-vwap")
        self.assertEqual(len(workspace["chart"]["vwapOverlay"]["points"]), 2)
        self.assertEqual(workspace["chart"]["vwapOverlay"]["latestValue"], 310.4167)
        self.assertIn("session-vwap", workspace["chart"]["defaults"]["visibleOverlayIds"])
        self.assertIn("entry", workspace["chart"]["tradeFocus"]["levelIdsAllowedToAffectScale"])
        self.assertNotIn("vwap", workspace["chart"]["tradeFocus"]["levelIdsAllowedToAffectScale"])
        self.assertFalse(workspace["chart"]["vwapOverlay"]["affectsTradeFocusScale"])
        self.assertEqual(workspace["tabs"]["plan"]["title"], "Plan")
        self.assertTrue(workspace["tabs"]["plan"]["items"])
        self.assertEqual(workspace["tabs"]["options"]["title"], "Options")
        self.assertTrue(workspace["tabs"]["alerts"]["items"])

    def test_assembler_review_mode_disables_live_execution(self) -> None:
        from day_trade_workspace import build_day_trade_workspace_response

        workspace = build_day_trade_workspace_response(
            scan=_scan("READY"),
            resolved=_resolved("READY"),
            session_date="2026-07-08",
            interval="1m",
        )

        self.assertEqual(workspace["session"]["mode"], "review")
        self.assertFalse(workspace["session"]["isExecutionAllowed"])
        self.assertEqual(workspace["decision"]["permission"]["code"], "complete")
        self.assertNotEqual(workspace["decision"]["primaryAction"]["type"], "open_trade_ticket")

    def test_state_precedence_active_position_overrides_ready(self) -> None:
        workspace = _workspace(
            "READY",
            metric_overrides={"active_position_requires_management": True},
        )

        self.assertEqual(workspace["decision"]["permission"]["code"], "manage")
        self.assertEqual(workspace["decision"]["primaryAction"]["type"], "manage_position")
        self.assertTrue(workspace["decision"]["primaryAction"]["enabled"])
        self.assertFalse(workspace["session"]["isExecutionAllowed"])

    def test_state_precedence_risk_halt_blocks_ready_action(self) -> None:
        workspace = _workspace(
            "READY",
            resolved_overrides={"risk_halt": "Market halt active"},
        )

        self.assertEqual(workspace["decision"]["permission"]["code"], "blocked")
        self.assertEqual(workspace["decision"]["permission"]["description"], "Market halt active")
        self.assertFalse(workspace["decision"]["primaryAction"]["enabled"])
        self.assertNotEqual(workspace["decision"]["primaryAction"]["type"], "open_trade_ticket")
        self.assertFalse(workspace["session"]["isExecutionAllowed"])

    def test_state_precedence_wait_does_not_enable_execution(self) -> None:
        workspace = _workspace("WAIT_ENTRY")

        self.assertEqual(workspace["decision"]["permission"]["code"], "wait")
        self.assertFalse(workspace["decision"]["primaryAction"]["enabled"])
        self.assertFalse(workspace["session"]["isExecutionAllowed"])

    def test_route_wraps_existing_day_trade_scan(self) -> None:
        import main

        resolved = SimpleNamespace(
            verdict="READY",
            market_bias="BULLISH",
            reason="Backend confirmed trigger.",
            supporting_factors=[],
            missing_confirmations=[],
            risk_state="LOW",
            confidence=88,
            display_confidence=88,
        )
        with patch.object(main, "run_day_trade_scan", return_value=_scan("READY")) as scan_mock:
            with patch.object(main, "resolve_trade_decision", return_value=resolved):
                workspace = main.day_trade_workspace(symbol="aapl", interval="1m", auth_email="vault@example.com")

        scan_mock.assert_called_once()
        self.assertEqual(workspace["symbol"]["ticker"], "AAPL")
        self.assertEqual(workspace["decision"]["permission"]["code"], "ready")
        self.assertEqual(workspace["chart"]["defaults"]["interval"], "1m")

    def test_route_returns_page_ready_unavailable_workspace_on_data_failure(self) -> None:
        import main

        with patch.object(main, "run_day_trade_scan", side_effect=ValueError("Not enough 1-minute data")):
            workspace = main.day_trade_workspace(symbol="aapl", interval="1m", auth_email="vault@example.com")

        self.assertEqual(workspace["schemaVersion"], "day-trade-workspace.v1")
        self.assertEqual(workspace["symbol"]["ticker"], "AAPL")
        self.assertEqual(workspace["decision"]["permission"]["code"], "blocked")
        self.assertEqual(workspace["decision"]["permission"]["label"], "Data Unavailable")
        self.assertFalse(workspace["decision"]["primaryAction"]["enabled"])
        self.assertFalse(workspace["session"]["isExecutionAllowed"])
        self.assertEqual(workspace["chart"]["candles"], [])
        self.assertEqual(workspace["chart"]["vwapOverlay"]["id"], "session-vwap")
        self.assertEqual(workspace["chart"]["vwapOverlay"]["points"], [])

    def test_workspace_response_model_accepts_assembler_contract(self) -> None:
        from day_trade_workspace import build_day_trade_workspace_response
        from day_trade_workspace_models import DayTradeWorkspaceResponse

        workspace = build_day_trade_workspace_response(scan=_scan("READY"), resolved=_resolved("READY"), interval="1m")
        parsed = DayTradeWorkspaceResponse(**workspace)
        self.assertEqual(parsed.schemaVersion, "day-trade-workspace.v1")
        self.assertEqual(parsed.symbol.ticker, "AAPL")
        self.assertEqual(parsed.decision.permission.code, "ready")
        self.assertEqual(parsed.chart.defaults.interval, "1m")
        self.assertIsNotNone(parsed.chart.vwapOverlay)
        self.assertEqual(parsed.chart.vwapOverlay.points[0].value, 309.3333)

    def test_vwap_overlay_uses_backend_bar_values_and_marks_gaps(self) -> None:
        workspace = _workspace(
            "READY",
            metric_overrides={
                "chart_bars": [
                    {"t": "2026-07-09T09:30:00-04:00", "o": 100, "h": 101, "l": 99, "c": 100.5, "v": 1000, "vwap": 100.1667},
                    {"t": "2026-07-09T09:31:00-04:00", "o": 100.5, "h": 102, "l": 100, "c": 101.5, "v": 0, "vwap": None},
                    {"t": "2026-07-09T09:32:00-04:00", "o": 101.5, "h": 103, "l": 101, "c": 102.5, "v": 1200, "vwap": 101.4091},
                ],
                "vwap": 101.4091,
            },
        )

        overlay = workspace["chart"]["vwapOverlay"]
        self.assertEqual([point["value"] for point in overlay["points"]], [100.1667, None, 101.4091])
        self.assertEqual(overlay["points"][1]["quality"], "unavailable")
        self.assertEqual(overlay["points"][-1]["state"], "forming")
        self.assertEqual(overlay["latestValue"], 101.4091)

    def test_interval_chart_uses_bucket_close_vwap_not_average(self) -> None:
        bars = [
            {"t": "2026-07-09T09:30:00-04:00", "o": 100, "h": 101, "l": 99, "c": 100.5, "v": 1000, "vwap": 100.1667},
            {"t": "2026-07-09T09:31:00-04:00", "o": 100.5, "h": 102, "l": 100, "c": 101.5, "v": 900, "vwap": 100.8123},
            {"t": "2026-07-09T09:34:00-04:00", "o": 101.5, "h": 104, "l": 101, "c": 103.5, "v": 1200, "vwap": 102.25},
            {"t": "2026-07-09T09:35:00-04:00", "o": 103.5, "h": 105, "l": 103, "c": 104.5, "v": 1500, "vwap": 102.9833},
        ]
        workspace = _workspace("READY", metric_overrides={"chart_bars": bars, "vwap": 102.9833}, interval="5m")

        candles = workspace["chart"]["candles"]
        overlay = workspace["chart"]["vwapOverlay"]
        self.assertEqual(workspace["chart"]["defaults"]["interval"], "5m")
        self.assertEqual(len(candles), 2)
        self.assertEqual(candles[0]["time"], "2026-07-09T09:30:00-04:00")
        self.assertEqual(candles[0]["open"], 100.0)
        self.assertEqual(candles[0]["high"], 104.0)
        self.assertEqual(candles[0]["low"], 99.0)
        self.assertEqual(candles[0]["close"], 103.5)
        self.assertEqual(candles[0]["volume"], 3100.0)
        self.assertEqual(overlay["points"][0]["value"], 102.25)
        self.assertEqual(overlay["points"][0]["sourceTimestampUtc"], "2026-07-09T09:34:00-04:00")
        self.assertNotEqual(overlay["points"][0]["value"], round((100.1667 + 100.8123 + 102.25) / 3.0, 4))

    def test_fifteen_minute_interval_preserves_cumulative_vwap_alignment(self) -> None:
        bars = [
            {"t": "2026-07-09T09:30:00-04:00", "o": 100, "h": 101, "l": 99, "c": 100.5, "v": 1000, "vwap": 100.1667},
            {"t": "2026-07-09T09:44:00-04:00", "o": 100.5, "h": 104, "l": 100, "c": 103.5, "v": 1200, "vwap": 102.25},
            {"t": "2026-07-09T09:45:00-04:00", "o": 103.5, "h": 105, "l": 103, "c": 104.5, "v": 1500, "vwap": 102.9833},
        ]
        workspace = _workspace("READY", metric_overrides={"chart_bars": bars, "vwap": 102.9833}, interval="15m")

        candles = workspace["chart"]["candles"]
        overlay = workspace["chart"]["vwapOverlay"]
        self.assertEqual(workspace["chart"]["defaults"]["interval"], "15m")
        self.assertEqual([candle["time"] for candle in candles], ["2026-07-09T09:30:00-04:00", "2026-07-09T09:45:00-04:00"])
        self.assertEqual([point["value"] for point in overlay["points"]], [102.25, 102.9833])
        self.assertEqual(overlay["latestAsOfUtc"], "2026-07-09T09:45:00-04:00")

    def test_workspace_endpoint_is_exposed_in_openapi_contract(self) -> None:
        import main

        schema = main.app.openapi()
        route = schema["paths"]["/api/day-trade/workspace"]["get"]
        response = route["responses"]["200"]["content"]["application/json"]["schema"]
        self.assertEqual(response["$ref"], "#/components/schemas/DayTradeWorkspaceResponse")
        self.assertIn("DayTradeWorkspaceResponse", schema["components"]["schemas"])
        self.assertIn("DayTradeChartView", schema["components"]["schemas"])
        self.assertIn("DayTradeDecisionView", schema["components"]["schemas"])


if __name__ == "__main__":
    unittest.main()
