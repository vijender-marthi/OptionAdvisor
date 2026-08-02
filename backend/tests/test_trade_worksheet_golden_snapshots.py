import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import storage


class TradeWorksheetGoldenSnapshotTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.old_db_path = storage.DB_PATH
        storage.DB_PATH = Path(self.tmp.name) / "worksheet-golden.sqlite3"
        storage.init_db()

    def tearDown(self) -> None:
        storage.DB_PATH = self.old_db_path
        self.tmp.cleanup()

    def _run_golden(self, payload: dict) -> dict:
        import main

        earnings = {
            "date": None,
            "daysUntil": None,
            "beforeExpiration": False,
            "risk": "Low",
            "message": "No near-term earnings event conflicts with this expiration.",
        }
        request = main.CalculationRunCreateRequest(runType="trade_worksheet", input=payload)
        with (
            patch.object(main, "_tw_earnings_info", return_value=earnings),
            patch.object(main, "_tw_days_to_expiry", return_value=43),
        ):
            return main.create_calculation_run_v1(request, auth_email="golden@example.com")

    def test_long_call_golden_snapshot(self) -> None:
        result = self._run_golden(
            {
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
                "selectedRow": {
                    "strike": 150,
                    "bid": 4.9,
                    "ask": 5.1,
                    "mid": 5,
                    "spread_pct": 4,
                    "volume": 1000,
                    "open_interest": 5000,
                    "iv": 30,
                },
            }
        )

        output = result["result"]
        summary = output["summary"]
        self.assertEqual(summary["ticker"], "AAPL")
        self.assertEqual(summary["strategy"], "Long Call")
        self.assertEqual(summary["frontDte"], 43)
        self.assertEqual(summary["netPremium"], -5.0)
        self.assertEqual(summary["cost"], 500.0)
        self.assertEqual(summary["maxRisk"], 500.0)
        self.assertEqual(summary["breakeven"], 155.0)
        self.assertEqual(summary["thetaPerDay"], -6.66)
        self.assertEqual(summary["delta"], 0.3906)
        self.assertEqual(summary["probability"], 35)
        self.assertEqual(output["score"]["total"], 75)
        self.assertEqual(output["score"]["label"], "ACCEPTABLE")
        self.assertEqual(output["bestStrategy"]["strategy"], "Bull Call Spread")
        self.assertEqual(result["snapshot"]["output_hash"], "65e46eba5c1b353b1d1b6cc31682cb858dbc1a1a661470b5685692746453e9a5")

    def test_bear_put_spread_golden_snapshot(self) -> None:
        result = self._run_golden(
            {
                "ticker": "MSFT",
                "direction": "Bearish",
                "strategy": "Bear Put Spread",
                "strike": 420,
                "longStrike": 420,
                "shortStrike": 410,
                "expiration": "2026-08-21",
                "premium": 4,
                "contracts": 2,
                "stockPrice": 425,
                "targetPrice": 405,
                "expectedHoldDays": 7,
                "buyingPower": 50000,
                "ivRank": 55,
                "ivPercentile": 60,
                "historicalVolatility": 35,
                "priceMove": -5,
                "ivMove": 0,
                "daysPassed": 3,
                "selectedLegRows": {
                    "long": {
                        "strike": 420,
                        "bid": 7.8,
                        "ask": 8.2,
                        "mid": 8,
                        "spread_pct": 5,
                        "volume": 1200,
                        "open_interest": 3000,
                        "iv": 35,
                    },
                    "short": {
                        "strike": 410,
                        "bid": 3.8,
                        "ask": 4.2,
                        "mid": 4,
                        "spread_pct": 6,
                        "volume": 900,
                        "open_interest": 2500,
                        "iv": 36,
                    },
                },
            }
        )

        output = result["result"]
        summary = output["summary"]
        self.assertEqual(summary["ticker"], "MSFT")
        self.assertEqual(summary["strategy"], "Bear Put Spread")
        self.assertEqual(summary["frontDte"], 43)
        self.assertEqual(summary["netPremium"], -4.0)
        self.assertEqual(summary["cost"], 800.0)
        self.assertEqual(summary["maxRisk"], 800.0)
        self.assertEqual(summary["breakeven"], 416.0)
        self.assertEqual(summary["thetaPerDay"], -46.78)
        self.assertEqual(summary["delta"], -0.437)
        self.assertEqual(summary["probability"], 48)
        self.assertEqual(output["score"]["total"], 79)
        self.assertEqual(output["score"]["label"], "BUY")
        self.assertEqual(output["bestStrategy"]["strategy"], "Bear Call Spread")
        self.assertEqual(result["snapshot"]["output_hash"], "6916dc2d01efe4f452c0fd34608318bebe50487a94f29d40a6d74ae6f86b6fec")


if __name__ == "__main__":
    unittest.main()
