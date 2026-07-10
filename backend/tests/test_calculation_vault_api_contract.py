import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

import calculation_vault
import storage


class CalculationVaultApiContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.old_db_path = storage.DB_PATH
        storage.DB_PATH = Path(self.tmp.name) / "vault-api.sqlite3"
        storage.init_db()

    def tearDown(self) -> None:
        storage.DB_PATH = self.old_db_path
        self.tmp.cleanup()

    def test_metric_definition_endpoint_contract(self) -> None:
        import main

        result = main.metric_definitions(auth_email="vault@example.com")
        self.assertEqual(result["formulaPackVersion"], calculation_vault.CURRENT_FORMULA_PACK_VERSION)
        self.assertEqual(result["metricDefinitionsVersion"], calculation_vault.CURRENT_METRIC_DEFINITIONS_VERSION)
        self.assertTrue(result["metrics"])
        first = result["metrics"][0]
        self.assertIn("metricId", first)
        self.assertIn("formulaVersion", first)
        self.assertIn("shortDescription", first)

    def test_calculation_run_types_endpoint_contract(self) -> None:
        import main

        result = main.calculation_run_types(auth_email="vault@example.com")
        self.assertEqual(result["routerVersion"], calculation_vault.CALCULATION_ROUTER_VERSION)
        self.assertEqual(result["count"], 2)
        by_type = {row["runType"]: row for row in result["runTypes"]}
        self.assertIn("trade_worksheet", by_type)
        self.assertIn("day_trade_workspace", by_type)
        self.assertEqual(by_type["trade_worksheet"]["engineVersion"], calculation_vault.TRADE_WORKSHEET_ENGINE_VERSION)
        self.assertEqual(by_type["day_trade_workspace"]["engineVersion"], calculation_vault.DAY_TRADE_WORKSPACE_ENGINE_VERSION)
        self.assertEqual(by_type["trade_worksheet"]["metricDefinitionsVersion"], calculation_vault.CURRENT_METRIC_DEFINITIONS_VERSION)
        self.assertTrue(by_type["trade_worksheet"]["snapshotSupported"])
        self.assertTrue(by_type["day_trade_workspace"]["snapshotSupported"])

    def test_vault_endpoints_are_exposed_in_openapi_contract(self) -> None:
        import main

        schema = main.app.openapi()
        paths = schema["paths"]
        expected_routes = {
            ("get", "/api/v1/metric-definitions"): "MetricDefinitionsResponse",
            ("get", "/api/v1/calculation-run-types"): "CalculationRunTypesResponse",
            ("post", "/api/v1/calculation-runs"): "CalculationRunCreateResponse",
            ("get", "/api/v1/calculation-runs"): "CalculationRunsListResponse",
            ("get", "/api/v1/calculation-runs/{run_id}"): "CalculationRunResponse",
            ("get", "/api/v1/calculation-snapshots/{snapshot_id}"): "CalculationSnapshotResponse",
            ("get", "/api/v1/calculation-snapshots/{snapshot_id}/integrity"): "CalculationSnapshotIntegrityResponse",
            ("get", "/api/v1/calculation-snapshots/{snapshot_id}/audit-log"): "CalculationSnapshotAuditLogResponse",
        }
        for (method, path), response_model in expected_routes.items():
            self.assertIn(path, paths)
            self.assertIn(method, paths[path])
            response = paths[path][method]["responses"]["200"]["content"]["application/json"]["schema"]
            self.assertEqual(response["$ref"], f"#/components/schemas/{response_model}")

        post_request = paths["/api/v1/calculation-runs"]["post"]["requestBody"]["content"]["application/json"]["schema"]
        self.assertEqual(post_request["$ref"], "#/components/schemas/CalculationRunCreateRequest")

        schemas = schema["components"]["schemas"]
        for model_name in {
            "CalculationRunCreateRequest",
            "CalculationRunCreateResponse",
            "CalculationRunResponse",
            "CalculationRunsListResponse",
            "CalculationRunTypesResponse",
            "CalculationSnapshotResponse",
            "CalculationSnapshotIntegrityResponse",
            "CalculationSnapshotAuditLogResponse",
            "MetricDefinitionsResponse",
        }:
            self.assertIn(model_name, schemas)

    def test_calculation_run_and_snapshot_endpoint_contracts(self) -> None:
        import main

        snapshot = calculation_vault.create_calculation_snapshot(
            run_type="trade_worksheet",
            input_payload={"ticker": "MSFT"},
            output_payload={"summary": {"ticker": "MSFT"}, "score": {"total": 81}},
            engine_version="contract-test-engine",
            owner_email="vault@example.com",
        )

        run_result = main.calculation_run(snapshot["run_id"], auth_email="vault@example.com")
        self.assertEqual(run_result["run_id"], snapshot["run_id"])
        self.assertEqual(run_result["snapshot_id"], snapshot["snapshot_id"])
        self.assertEqual(run_result["status"], "COMPLETED")
        self.assertEqual(run_result["input"], {"ticker": "MSFT"})

        snapshot_result = main.calculation_snapshot(snapshot["snapshot_id"], auth_email="vault@example.com")
        self.assertEqual(snapshot_result["snapshot_id"], snapshot["snapshot_id"])
        self.assertEqual(snapshot_result["run_id"], snapshot["run_id"])
        self.assertEqual(snapshot_result["output"]["summary"]["ticker"], "MSFT")
        self.assertTrue(snapshot_result["metric_definitions"])

        integrity_result = main.calculation_snapshot_integrity(snapshot["snapshot_id"], auth_email="vault@example.com")
        self.assertEqual(integrity_result["snapshot_id"], snapshot["snapshot_id"])
        self.assertTrue(integrity_result["verified"])
        self.assertTrue(integrity_result["input_hash_matches"])
        self.assertTrue(integrity_result["output_hash_matches"])
        self.assertTrue(integrity_result["run_hash_matches"])

        audit_result = main.calculation_snapshot_audit_log(snapshot["snapshot_id"], auth_email="vault@example.com")
        self.assertEqual(audit_result["snapshot_id"], snapshot["snapshot_id"])
        self.assertEqual(audit_result["count"], 1)
        self.assertEqual(audit_result["events"][0]["event_type"], "SNAPSHOT_FROZEN")
        self.assertEqual(audit_result["events"][0]["event"]["runId"], snapshot["run_id"])

        with self.assertRaises(HTTPException) as run_ctx:
            main.calculation_run(snapshot["run_id"], auth_email="intruder@example.com")
        self.assertEqual(run_ctx.exception.status_code, 404)

        with self.assertRaises(HTTPException) as snapshot_ctx:
            main.calculation_snapshot(snapshot["snapshot_id"], auth_email="intruder@example.com")
        self.assertEqual(snapshot_ctx.exception.status_code, 404)

        with self.assertRaises(HTTPException) as integrity_ctx:
            main.calculation_snapshot_integrity(snapshot["snapshot_id"], auth_email="intruder@example.com")
        self.assertEqual(integrity_ctx.exception.status_code, 404)

        with self.assertRaises(HTTPException) as audit_ctx:
            main.calculation_snapshot_audit_log(snapshot["snapshot_id"], auth_email="intruder@example.com")
        self.assertEqual(audit_ctx.exception.status_code, 404)

    def test_missing_run_and_snapshot_return_404(self) -> None:
        import main

        with self.assertRaises(HTTPException) as run_ctx:
            main.calculation_run("missing-run", auth_email="vault@example.com")
        self.assertEqual(run_ctx.exception.status_code, 404)

        with self.assertRaises(HTTPException) as snapshot_ctx:
            main.calculation_snapshot("missing-snapshot", auth_email="vault@example.com")
        self.assertEqual(snapshot_ctx.exception.status_code, 404)

        with self.assertRaises(HTTPException) as integrity_ctx:
            main.calculation_snapshot_integrity("missing-snapshot", auth_email="vault@example.com")
        self.assertEqual(integrity_ctx.exception.status_code, 404)

        with self.assertRaises(HTTPException) as audit_ctx:
            main.calculation_snapshot_audit_log("missing-snapshot", auth_email="vault@example.com")
        self.assertEqual(audit_ctx.exception.status_code, 404)

    def test_calculation_runs_list_is_owner_scoped_and_filterable(self) -> None:
        import main

        first = calculation_vault.create_calculation_snapshot(
            run_type="trade_worksheet",
            input_payload={"ticker": "AAPL"},
            output_payload={"summary": {"ticker": "AAPL"}},
            engine_version="contract-test-engine",
            owner_email="vault@example.com",
        )
        second = calculation_vault.create_failed_calculation_run(
            run_type="trade_worksheet",
            input_payload={"ticker": "MSFT"},
            error="Invalid trade worksheet input: test",
            engine_version="contract-test-engine",
            owner_email="vault@example.com",
        )
        calculation_vault.create_calculation_snapshot(
            run_type="trade_worksheet",
            input_payload={"ticker": "TSLA"},
            output_payload={"summary": {"ticker": "TSLA"}},
            engine_version="contract-test-engine",
            owner_email="other@example.com",
        )

        all_runs = main.calculation_runs(auth_email="vault@example.com")
        ids = {row["run_id"] for row in all_runs["runs"]}
        self.assertEqual(all_runs["count"], 2)
        self.assertEqual(ids, {first["run_id"], second["run_id"]})

        failed_runs = main.calculation_runs(status="FAILED", auth_email="vault@example.com")
        self.assertEqual(failed_runs["count"], 1)
        self.assertEqual(failed_runs["runs"][0]["run_id"], second["run_id"])
        self.assertEqual(failed_runs["runs"][0]["status"], "FAILED")

        worksheet_runs = main.calculation_runs(run_type="trade_worksheet", limit=1, auth_email="vault@example.com")
        self.assertEqual(worksheet_runs["count"], 1)
        self.assertEqual(worksheet_runs["runs"][0]["run_type"], "trade_worksheet")

    def test_create_calculation_run_delegates_trade_worksheet(self) -> None:
        import main

        payload = {
            "ticker": "AAPL",
            "direction": "Bullish",
            "strategy": "Long Call",
            "strike": 150,
            "expiration": "2026-08-21",
            "premium": 5,
            "contracts": 1,
            "stockPrice": 145,
            "targetPrice": 155,
            "expectedHoldDays": 5,
            "buyingPower": 25000,
            "ivRank": 35,
            "ivPercentile": 40,
            "historicalVolatility": 30,
            "priceMove": 5,
            "ivMove": 0,
            "daysPassed": 3,
        }
        earnings = {
            "date": None,
            "daysUntil": None,
            "beforeExpiration": False,
            "risk": "Low",
            "message": "No near-term earnings event conflicts with this expiration.",
        }
        request = main.CalculationRunCreateRequest(runType="trade_worksheet", input=payload)
        with patch.object(main, "_tw_earnings_info", return_value=earnings):
            result = main.create_calculation_run_v1(request, auth_email="vault@example.com")

        self.assertEqual(result["run"]["run_type"], "trade_worksheet")
        self.assertEqual(result["run"]["owner_email"], "vault@example.com")
        self.assertEqual(result["snapshot"]["snapshot_id"], result["run"]["snapshot_id"])
        self.assertEqual(result["snapshot"]["owner_email"], "vault@example.com")
        self.assertEqual(result["result"]["summary"]["ticker"], "AAPL")
        self.assertEqual(result["result"]["calculationSnapshot"]["runId"], result["run"]["run_id"])

    def test_create_calculation_run_delegates_day_trade_workspace_snapshot(self) -> None:
        import main

        scan = SimpleNamespace(
            ticker="AAPL",
            company_name="Apple Inc.",
            verdict="READY",
            bias="long",
            reasons=["Backend confirmed VWAP-supported setup."],
            metrics={
                "session_date": "2026-07-09",
                "market_state": "REGULAR",
                "session_phase": "Morning",
                "market_bias": "bullish",
                "last_price": 312.25,
                "change_pct": 1.2,
                "trigger_setup": "ORH Breakout",
                "trigger_fired": True,
                "trigger_requirement": "5m close above 312.00",
                "or_high": 312.0,
                "or_low": 308.0,
                "vwap": 310.5,
                "data_quality_status": "OK",
                "chart_bars": [
                    {"t": "2026-07-09T09:30:00-04:00", "o": 309.0, "h": 310.0, "l": 308.5, "c": 309.5, "v": 1000, "vwap": 309.3333},
                    {"t": "2026-07-09T09:31:00-04:00", "o": 309.5, "h": 312.5, "l": 309.2, "c": 312.25, "v": 1500, "vwap": 310.4167},
                ],
                "timeframe_state": {"final_decision": "READY"},
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
        request = main.CalculationRunCreateRequest(
            runType="day_trade_workspace",
            input={"symbol": "aapl", "sessionDate": "2026-07-09", "interval": "5m"},
        )
        with patch.object(main, "run_day_trade_scan", return_value=scan) as scan_mock:
            with patch.object(main, "resolve_trade_decision", return_value=resolved):
                result = main.create_calculation_run_v1(request, auth_email="vault@example.com")

        scan_mock.assert_called_once()
        self.assertEqual(result["run"]["run_type"], "day_trade_workspace")
        self.assertEqual(result["run"]["engine_version"], calculation_vault.DAY_TRADE_WORKSPACE_ENGINE_VERSION)
        self.assertEqual(result["snapshot"]["run_type"], "day_trade_workspace")
        self.assertEqual(result["snapshot"]["owner_email"], "vault@example.com")
        self.assertEqual(result["result"]["symbol"]["ticker"], "AAPL")
        self.assertEqual(result["result"]["chart"]["defaults"]["interval"], "5m")
        self.assertEqual(result["result"]["calculationSnapshot"]["runId"], result["run"]["run_id"])
        self.assertEqual(result["snapshot"]["output"]["symbol"]["ticker"], "AAPL")
        self.assertEqual(result["snapshot"]["input"]["symbol"], "AAPL")

    def test_create_calculation_run_records_failed_day_trade_workspace_input(self) -> None:
        import main

        request = main.CalculationRunCreateRequest(runType="day_trade_workspace", input={"interval": "1m"})
        with self.assertRaises(HTTPException) as ctx:
            main.create_calculation_run_v1(request, auth_email="vault@example.com")
        self.assertEqual(ctx.exception.status_code, 422)
        failed = calculation_vault.list_calculation_runs(owner_email="vault@example.com", status="FAILED")
        self.assertEqual(len(failed), 1)
        self.assertEqual(failed[0]["run_type"], "day_trade_workspace")
        self.assertEqual(failed[0]["engine_version"], calculation_vault.DAY_TRADE_WORKSPACE_ENGINE_VERSION)
        self.assertIn("symbol is required", failed[0]["error"])

    def test_create_calculation_run_rejects_unsupported_type(self) -> None:
        import main

        request = main.CalculationRunCreateRequest(runType="unknown", input={})
        with self.assertRaises(HTTPException) as ctx:
            main.create_calculation_run_v1(request, auth_email="vault@example.com")
        self.assertEqual(ctx.exception.status_code, 400)
        failed = calculation_vault.list_calculation_runs(owner_email="vault@example.com", status="FAILED")
        self.assertEqual(len(failed), 1)
        self.assertEqual(failed[0]["run_type"], "unknown")
        self.assertEqual(failed[0]["status"], "FAILED")
        self.assertEqual(failed[0]["snapshot_id"], None)
        self.assertIn("Unsupported calculation run type", failed[0]["error"])
        self.assertEqual(failed[0]["owner_email"], "vault@example.com")
        self.assertEqual(failed[0]["engine_version"], calculation_vault.CALCULATION_ROUTER_VERSION)

    def test_create_calculation_run_records_failed_invalid_input(self) -> None:
        import main

        request = main.CalculationRunCreateRequest(runType="trade_worksheet", input={"contracts": "not-a-number"})
        with self.assertRaises(HTTPException) as ctx:
            main.create_calculation_run_v1(request, auth_email="vault@example.com")
        self.assertEqual(ctx.exception.status_code, 422)
        failed = calculation_vault.list_calculation_runs(owner_email="vault@example.com", status="FAILED")
        self.assertEqual(len(failed), 1)
        self.assertEqual(failed[0]["run_type"], "trade_worksheet")
        self.assertEqual(failed[0]["status"], "FAILED")
        self.assertEqual(failed[0]["input"], {"contracts": "not-a-number"})
        self.assertIn("Invalid trade worksheet input", failed[0]["error"])
        self.assertEqual(failed[0]["engine_version"], calculation_vault.TRADE_WORKSHEET_ENGINE_VERSION)
        self.assertEqual(
            calculation_vault.list_calculation_runs(owner_email="other@example.com", status="FAILED"),
            [],
        )


if __name__ == "__main__":
    unittest.main()
