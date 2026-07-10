import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import calculation_vault
import storage


class TradeWorksheetVaultTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.old_db_path = storage.DB_PATH
        storage.DB_PATH = Path(self.tmp.name) / "worksheet-vault.sqlite3"
        storage.init_db()

    def tearDown(self) -> None:
        storage.DB_PATH = self.old_db_path
        self.tmp.cleanup()

    def test_trade_worksheet_evaluation_creates_frozen_snapshot(self) -> None:
        import main

        request = main.TradeWorksheetEvaluateRequest(
            ticker="AAPL",
            direction="Bullish",
            strategy="Long Call",
            strike=150,
            expiration="2026-08-21",
            premium=5,
            contracts=1,
            stockPrice=145,
            targetPrice=155,
            expectedHoldDays=5,
            buyingPower=25000,
            ivRank=35,
            ivPercentile=40,
            historicalVolatility=30,
            selectedRow=main.TradeWorksheetSelectedRow(
                strike=150,
                bid=4.9,
                ask=5.1,
                mid=5,
                spread_pct=4,
                volume=1000,
                open_interest=5000,
                iv=30,
            ),
        )

        earnings = {
            "date": None,
            "daysUntil": None,
            "beforeExpiration": False,
            "risk": "Low",
            "message": "No near-term earnings event conflicts with this expiration.",
        }
        with patch.object(main, "_tw_earnings_info", return_value=earnings):
            result = main.trade_worksheet_evaluate(request, auth_email="vault@example.com")

        metadata = result.get("calculationSnapshot")
        self.assertIsNotNone(metadata)
        assert metadata is not None
        self.assertEqual(metadata["engineVersion"], "trade-worksheet-engine-2026.07")
        self.assertEqual(metadata["formulaPackVersion"], calculation_vault.CURRENT_FORMULA_PACK_VERSION)

        snapshot = calculation_vault.get_calculation_snapshot(metadata["snapshotId"])
        self.assertIsNotNone(snapshot)
        assert snapshot is not None
        self.assertEqual(snapshot["run_id"], metadata["runId"])
        self.assertEqual(snapshot["owner_email"], "vault@example.com")
        self.assertEqual(snapshot["input"]["ticker"], "AAPL")
        self.assertEqual(snapshot["output"]["summary"]["ticker"], "AAPL")
        self.assertIn("score", snapshot["output"])
        self.assertIn("metricDefinitions", snapshot["output"])
        self.assertNotIn("calculationSnapshot", snapshot["output"])
        self.assertEqual(metadata["outputHash"], calculation_vault.sha256_json(snapshot["output"]))
        output_metric_ids = {
            metric["metricId"]
            for metric in snapshot["output"]["metricDefinitions"]["metrics"]
        }
        stored_metric_ids = {metric["metricId"] for metric in snapshot["metric_definitions"]}
        self.assertIn("trade_quality_score", output_metric_ids)
        self.assertIn("capital_required", output_metric_ids)
        self.assertEqual(output_metric_ids, stored_metric_ids)


if __name__ == "__main__":
    unittest.main()
