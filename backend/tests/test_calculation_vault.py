import sqlite3
import tempfile
import unittest
from pathlib import Path

import calculation_vault
import storage


class CalculationVaultTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.old_db_path = storage.DB_PATH
        storage.DB_PATH = Path(self.tmp.name) / "vault.sqlite3"
        storage.init_db()

    def tearDown(self) -> None:
        storage.DB_PATH = self.old_db_path
        self.tmp.cleanup()

    def test_canonical_hash_is_stable_for_key_order(self) -> None:
        left = {"ticker": "AAPL", "inputs": {"dte": 14, "strategy": "Long Call"}}
        right = {"inputs": {"strategy": "Long Call", "dte": 14}, "ticker": "AAPL"}
        self.assertEqual(calculation_vault.sha256_json(left), calculation_vault.sha256_json(right))

    def test_completed_snapshot_is_inserted_with_hashes_and_versions(self) -> None:
        snap = calculation_vault.create_calculation_snapshot(
            run_type="trade_worksheet",
            input_payload={"ticker": "AAPL", "strategy": "Long Call"},
            output_payload={"score": 82, "verdict": "WAIT"},
            engine_version="worksheet-engine-test",
        )

        self.assertEqual(snap["run_type"], "trade_worksheet")
        self.assertEqual(snap["engine_version"], "worksheet-engine-test")
        self.assertEqual(snap["formula_pack_version"], calculation_vault.CURRENT_FORMULA_PACK_VERSION)
        self.assertEqual(snap["input"], {"ticker": "AAPL", "strategy": "Long Call"})
        self.assertEqual(snap["output"], {"score": 82, "verdict": "WAIT"})
        self.assertTrue(snap["input_hash"])
        self.assertTrue(snap["output_hash"])
        self.assertGreater(int(snap["frozen_at_ms"]), 0)

        run = calculation_vault.get_calculation_run(snap["run_id"])
        self.assertIsNotNone(run)
        assert run is not None
        self.assertEqual(run["snapshot_id"], snap["snapshot_id"])
        self.assertEqual(run["status"], "COMPLETED")

    def test_snapshot_rows_are_immutable(self) -> None:
        snap = calculation_vault.create_calculation_snapshot(
            run_type="day_trade",
            input_payload={"ticker": "MRVL"},
            output_payload={"finalDecision": "WATCH"},
            engine_version="day-engine-test",
        )

        with storage._connect() as conn:
            with self.assertRaises(sqlite3.IntegrityError):
                conn.execute(
                    "UPDATE calculation_snapshots SET output_json = ? WHERE snapshot_id = ?",
                    ('{"changed":true}', snap["snapshot_id"]),
                )
            with self.assertRaises(sqlite3.IntegrityError):
                conn.execute(
                    "DELETE FROM calculation_snapshots WHERE snapshot_id = ?",
                    (snap["snapshot_id"],),
                )

        loaded = calculation_vault.get_calculation_snapshot(snap["snapshot_id"])
        self.assertIsNotNone(loaded)
        assert loaded is not None
        self.assertEqual(loaded["output"], {"finalDecision": "WATCH"})

    def test_snapshot_immutability_triggers_are_schema_contract(self) -> None:
        expected = {
            "calculation_snapshots_no_update",
            "calculation_snapshots_no_delete",
        }
        expected_audit = {
            "calculation_snapshot_audit_log_no_update",
            "calculation_snapshot_audit_log_no_delete",
        }
        with storage._connect() as conn:
            rows = conn.execute(
                """
                SELECT name
                FROM sqlite_master
                WHERE type = 'trigger' AND tbl_name = 'calculation_snapshots'
                """
            ).fetchall()
            self.assertTrue(expected.issubset({row["name"] for row in rows}))
            audit_rows = conn.execute(
                """
                SELECT name
                FROM sqlite_master
                WHERE type = 'trigger' AND tbl_name = 'calculation_snapshot_audit_log'
                """
            ).fetchall()
            self.assertTrue(expected_audit.issubset({row["name"] for row in audit_rows}))

            conn.execute("DROP TRIGGER calculation_snapshots_no_update")
            conn.execute("DROP TRIGGER calculation_snapshots_no_delete")
            conn.execute("DROP TRIGGER calculation_snapshot_audit_log_no_update")
            conn.execute("DROP TRIGGER calculation_snapshot_audit_log_no_delete")
            calculation_vault.ensure_calculation_vault_schema(conn)
            rows = conn.execute(
                """
                SELECT name
                FROM sqlite_master
                WHERE type = 'trigger' AND tbl_name = 'calculation_snapshots'
                """
            ).fetchall()
            self.assertTrue(expected.issubset({row["name"] for row in rows}))
            audit_rows = conn.execute(
                """
                SELECT name
                FROM sqlite_master
                WHERE type = 'trigger' AND tbl_name = 'calculation_snapshot_audit_log'
                """
            ).fetchall()
            self.assertTrue(expected_audit.issubset({row["name"] for row in audit_rows}))

    def test_snapshot_audit_log_rows_are_append_only(self) -> None:
        snap = calculation_vault.create_calculation_snapshot(
            run_type="trade_worksheet",
            input_payload={"ticker": "AAPL"},
            output_payload={"summary": {"ticker": "AAPL"}},
            engine_version="worksheet-engine-test",
            owner_email="owner@example.com",
        )
        events = calculation_vault.list_calculation_snapshot_audit_log(snap["snapshot_id"], owner_email="owner@example.com")
        self.assertIsNotNone(events)
        assert events is not None
        audit_id = events[0]["audit_id"]

        with storage._connect() as conn:
            with self.assertRaises(sqlite3.IntegrityError):
                conn.execute(
                    "UPDATE calculation_snapshot_audit_log SET event_type = ? WHERE audit_id = ?",
                    ("CHANGED", audit_id),
                )
            with self.assertRaises(sqlite3.IntegrityError):
                conn.execute(
                    "DELETE FROM calculation_snapshot_audit_log WHERE audit_id = ?",
                    (audit_id,),
                )

        loaded = calculation_vault.list_calculation_snapshot_audit_log(snap["snapshot_id"], owner_email="owner@example.com")
        self.assertIsNotNone(loaded)
        assert loaded is not None
        self.assertEqual(len(loaded), 1)
        self.assertEqual(loaded[0]["event_type"], "SNAPSHOT_FROZEN")

    def test_legacy_snapshot_schema_migration_preserves_insert_only_snapshots(self) -> None:
        with sqlite3.connect(":memory:") as conn:
            conn.row_factory = sqlite3.Row
            conn.execute(
                """
                CREATE TABLE calculation_runs (
                    run_id TEXT PRIMARY KEY,
                    run_type TEXT NOT NULL,
                    status TEXT NOT NULL,
                    engine_version TEXT NOT NULL,
                    formula_pack_version TEXT NOT NULL,
                    input_hash TEXT NOT NULL,
                    output_hash TEXT NOT NULL DEFAULT '',
                    snapshot_id TEXT,
                    input_json TEXT NOT NULL,
                    error TEXT NOT NULL DEFAULT '',
                    created_at_ms INTEGER NOT NULL,
                    completed_at_ms INTEGER
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE calculation_snapshots (
                    snapshot_id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL,
                    run_type TEXT NOT NULL,
                    engine_version TEXT NOT NULL,
                    formula_pack_version TEXT NOT NULL,
                    metric_definitions_version TEXT NOT NULL,
                    input_hash TEXT NOT NULL,
                    output_hash TEXT NOT NULL,
                    input_json TEXT NOT NULL,
                    output_json TEXT NOT NULL,
                    metric_definitions_json TEXT NOT NULL DEFAULT '[]',
                    created_at_ms INTEGER NOT NULL,
                    frozen_at_ms INTEGER NOT NULL,
                    UNIQUE(run_id)
                )
                """
            )

            calculation_vault.ensure_calculation_vault_schema(conn)
            run_columns = {row["name"] for row in conn.execute("PRAGMA table_info(calculation_runs)").fetchall()}
            snapshot_columns = {row["name"] for row in conn.execute("PRAGMA table_info(calculation_snapshots)").fetchall()}
            self.assertIn("owner_email", run_columns)
            self.assertIn("owner_email", snapshot_columns)

            conn.execute(
                """
                INSERT INTO calculation_runs (
                    run_id, run_type, status, engine_version, formula_pack_version,
                    owner_email, input_hash, output_hash, snapshot_id, input_json,
                    created_at_ms, completed_at_ms
                ) VALUES (
                    'run-1', 'trade_worksheet', 'COMPLETED', 'engine-test', 'formula-test',
                    'owner@example.com', 'input-hash', 'output-hash', 'snapshot-1', '{}',
                    1, 1
                )
                """
            )
            conn.execute(
                """
                INSERT INTO calculation_snapshots (
                    snapshot_id, run_id, run_type, engine_version, formula_pack_version,
                    metric_definitions_version, owner_email, input_hash, output_hash,
                    input_json, output_json, metric_definitions_json, created_at_ms, frozen_at_ms
                ) VALUES (
                    'snapshot-1', 'run-1', 'trade_worksheet', 'engine-test', 'formula-test',
                    'metric-test', 'owner@example.com', 'input-hash', 'output-hash',
                    '{}', '{"score":82}', '[]', 1, 1
                )
                """
            )

            with self.assertRaises(sqlite3.IntegrityError):
                conn.execute(
                    "UPDATE calculation_snapshots SET output_json = ? WHERE snapshot_id = ?",
                    ('{"score":1}', "snapshot-1"),
                )
            with self.assertRaises(sqlite3.IntegrityError):
                conn.execute(
                    "DELETE FROM calculation_snapshots WHERE snapshot_id = ?",
                    ("snapshot-1",),
                )

    def test_metric_definitions_are_seeded(self) -> None:
        definitions = calculation_vault.list_metric_definitions()
        ids = {d["metricId"] for d in definitions}
        self.assertIn("trade_quality_score", ids)
        self.assertIn("max_profit", ids)
        self.assertTrue(all(d.get("formulaVersion") for d in definitions))
        self.assertTrue(all(d.get("shortDescription") for d in definitions))

    def test_owner_scoped_reads_filter_runs_and_snapshots(self) -> None:
        snap = calculation_vault.create_calculation_snapshot(
            run_type="trade_worksheet",
            input_payload={"ticker": "AAPL"},
            output_payload={"score": 82},
            engine_version="worksheet-engine-test",
            owner_email="Owner@Example.com",
        )

        self.assertEqual(snap["owner_email"], "owner@example.com")
        self.assertIsNotNone(calculation_vault.get_calculation_run(snap["run_id"], owner_email="owner@example.com"))
        self.assertIsNotNone(calculation_vault.get_calculation_snapshot(snap["snapshot_id"], owner_email="owner@example.com"))
        self.assertIsNone(calculation_vault.get_calculation_run(snap["run_id"], owner_email="other@example.com"))
        self.assertIsNone(calculation_vault.get_calculation_snapshot(snap["snapshot_id"], owner_email="other@example.com"))

    def test_trade_worksheet_metric_definitions_are_resolved_in_contract_order(self) -> None:
        definitions = calculation_vault.trade_worksheet_metric_definitions()
        ids = [d["metricId"] for d in definitions]
        self.assertEqual(ids[0], "trade_quality_score")
        self.assertIn("capital_required", ids)
        self.assertIn("theta_per_day", ids)
        self.assertIn("iv_rank", ids)
        self.assertTrue(all(d["formulaVersion"] == calculation_vault.CURRENT_FORMULA_PACK_VERSION for d in definitions))

    def test_supported_calculation_run_types_are_explicit(self) -> None:
        run_types = calculation_vault.list_supported_calculation_run_types()
        self.assertEqual(len(run_types), 1)
        self.assertEqual(run_types[0]["runType"], "trade_worksheet")
        self.assertEqual(run_types[0]["engineVersion"], calculation_vault.TRADE_WORKSHEET_ENGINE_VERSION)
        self.assertEqual(run_types[0]["formulaPackVersion"], calculation_vault.CURRENT_FORMULA_PACK_VERSION)
        self.assertTrue(run_types[0]["snapshotSupported"])
        self.assertEqual(run_types[0]["status"], "active")

    def test_snapshot_integrity_verification_passes_for_frozen_snapshot(self) -> None:
        snap = calculation_vault.create_calculation_snapshot(
            run_type="trade_worksheet",
            input_payload={"ticker": "AAPL"},
            output_payload={"summary": {"ticker": "AAPL"}, "score": {"total": 82}},
            engine_version="worksheet-engine-test",
            owner_email="owner@example.com",
        )

        integrity = calculation_vault.verify_calculation_snapshot(snap["snapshot_id"], owner_email="owner@example.com")
        self.assertIsNotNone(integrity)
        assert integrity is not None
        self.assertTrue(integrity["verified"])
        self.assertTrue(integrity["input_hash_matches"])
        self.assertTrue(integrity["output_hash_matches"])
        self.assertTrue(integrity["run_hash_matches"])
        self.assertEqual(integrity["mismatches"], [])

    def test_snapshot_integrity_verification_detects_bad_inserted_hash(self) -> None:
        created = calculation_vault.now_ms()
        input_payload = {"ticker": "MSFT"}
        output_payload = {"summary": {"ticker": "MSFT"}}
        input_hash = calculation_vault.sha256_json(input_payload)
        output_hash = "bad-output-hash"
        with storage._connect() as conn:
            calculation_vault.ensure_calculation_vault_schema(conn)
            conn.execute(
                """
                INSERT INTO calculation_runs (
                    run_id, run_type, status, engine_version, formula_pack_version,
                    owner_email, input_hash, output_hash, snapshot_id, input_json,
                    created_at_ms, completed_at_ms
                ) VALUES (?, ?, 'COMPLETED', ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "run-bad",
                    "trade_worksheet",
                    "worksheet-engine-test",
                    calculation_vault.CURRENT_FORMULA_PACK_VERSION,
                    "owner@example.com",
                    input_hash,
                    output_hash,
                    "snapshot-bad",
                    calculation_vault.canonical_json(input_payload),
                    created,
                    created,
                ),
            )
            conn.execute(
                """
                INSERT INTO calculation_snapshots (
                    snapshot_id, run_id, run_type, engine_version, formula_pack_version,
                    metric_definitions_version, owner_email, input_hash, output_hash,
                    input_json, output_json, metric_definitions_json,
                    created_at_ms, frozen_at_ms
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "snapshot-bad",
                    "run-bad",
                    "trade_worksheet",
                    "worksheet-engine-test",
                    calculation_vault.CURRENT_FORMULA_PACK_VERSION,
                    calculation_vault.CURRENT_METRIC_DEFINITIONS_VERSION,
                    "owner@example.com",
                    input_hash,
                    output_hash,
                    calculation_vault.canonical_json(input_payload),
                    calculation_vault.canonical_json(output_payload),
                    "[]",
                    created,
                    created,
                ),
            )

        integrity = calculation_vault.verify_calculation_snapshot("snapshot-bad", owner_email="owner@example.com")
        self.assertIsNotNone(integrity)
        assert integrity is not None
        self.assertFalse(integrity["verified"])
        self.assertTrue(integrity["input_hash_matches"])
        self.assertFalse(integrity["output_hash_matches"])
        self.assertIn("output_hash", integrity["mismatches"])

    def test_snapshot_audit_log_lists_frozen_event(self) -> None:
        snap = calculation_vault.create_calculation_snapshot(
            run_type="trade_worksheet",
            input_payload={"ticker": "AAPL"},
            output_payload={"summary": {"ticker": "AAPL"}},
            engine_version="worksheet-engine-test",
            owner_email="owner@example.com",
        )

        events = calculation_vault.list_calculation_snapshot_audit_log(snap["snapshot_id"], owner_email="owner@example.com")
        self.assertIsNotNone(events)
        assert events is not None
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["snapshot_id"], snap["snapshot_id"])
        self.assertEqual(events[0]["event_type"], "SNAPSHOT_FROZEN")
        self.assertEqual(events[0]["event"]["runId"], snap["run_id"])
        self.assertEqual(events[0]["event"]["inputHash"], snap["input_hash"])
        self.assertEqual(events[0]["event"]["outputHash"], snap["output_hash"])
        self.assertIsNone(calculation_vault.list_calculation_snapshot_audit_log(snap["snapshot_id"], owner_email="other@example.com"))


if __name__ == "__main__":
    unittest.main()
