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
        # POP is the breakeven probability (24), distinct from prob-ITM (35.2) (#7).
        self.assertEqual(summary["probability"], 24)
        self.assertEqual(summary["probabilityItm"], 35.2)
        self.assertEqual(summary["premiumCheck"]["status"], "ok")
        self.assertFalse(output["validation"]["blocked"])
        self.assertEqual(output["score"]["total"], 74)
        self.assertEqual(output["score"]["label"], "ACCEPTABLE")
        self.assertEqual(output["bestStrategy"]["strategy"], "Bull Call Spread")
        self.assertEqual(result["snapshot"]["output_hash"], "b3698a927173e80e71a325b065265f97c1dec9475d1ff2e093d86f6dfd6ece0f")

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
        # POP is the breakeven probability (45), distinct from prob-ITM (48.5) (#7).
        self.assertEqual(summary["probability"], 45)
        self.assertEqual(summary["probabilityItm"], 48.5)
        self.assertEqual(output["score"]["total"], 78)
        self.assertEqual(output["score"]["label"], "BUY")
        self.assertEqual(output["bestStrategy"]["strategy"], "Bear Call Spread")
        self.assertEqual(result["snapshot"]["output_hash"], "056b8a7f973a0024e476b8bac27697f13368852985e5716a238146338cc8d205")

    def test_direction_strategy_conflict_blocks_submission(self) -> None:
        # #5: Direction=Bullish + Long Put (bearish delta) -> blocked.
        result = self._run_golden(
            {
                "ticker": "MSFT",
                "direction": "Bullish",
                "strategy": "Long Put",
                "strike": 420,
                "expiration": "2026-08-21",
                "premium": 6,
                "contracts": 1,
                "stockPrice": 425,
                "targetPrice": 440,
                "historicalVolatility": 35,
                "ivRank": 40,
                "selectedRow": {"strike": 420, "bid": 5.9, "ask": 6.1, "mid": 6, "spread_pct": 4, "open_interest": 3000, "iv": 35},
            }
        )
        validation = result["result"]["validation"]
        self.assertTrue(validation["blocked"])
        self.assertTrue(any("Long Put" in e and "bearish" in e for e in validation["errors"]))

    def test_manual_premium_far_from_chain_mid_blocks(self) -> None:
        # #6: typed premium 11.80 vs chain mid 6.83 (+73%) -> blocked with both values.
        result = self._run_golden(
            {
                "ticker": "MSFT",
                "direction": "Bearish",
                "strategy": "Long Put",
                "strike": 420,
                "expiration": "2026-08-21",
                "premium": 11.80,
                "contracts": 1,
                "stockPrice": 425,
                "targetPrice": 405,
                "historicalVolatility": 35,
                "ivRank": 40,
                "selectedRow": {"strike": 420, "bid": 6.7, "ask": 6.96, "mid": 6.83, "spread_pct": 4, "open_interest": 3000, "iv": 35},
            }
        )
        output = result["result"]
        check = output["summary"]["premiumCheck"]
        self.assertEqual(check["status"], "blocked")
        self.assertEqual(check["typed"], 11.8)
        self.assertEqual(check["chainMid"], 6.83)
        self.assertTrue(output["validation"]["blocked"])
        self.assertTrue(any("chain mid" in e for e in output["validation"]["errors"]))

    def test_premium_defaults_to_chain_mid_when_blank(self) -> None:
        # #6: blank premium -> defaults to the chain mid, not blocked.
        result = self._run_golden(
            {
                "ticker": "AAPL",
                "direction": "Bullish",
                "strategy": "Long Call",
                "strike": 150,
                "expiration": "2026-08-21",
                "premium": 0,
                "contracts": 1,
                "stockPrice": 145,
                "targetPrice": 155,
                "historicalVolatility": 30,
                "ivRank": 35,
                "selectedRow": {"strike": 150, "bid": 4.9, "ask": 5.1, "mid": 5, "spread_pct": 4, "open_interest": 5000, "iv": 30},
            }
        )
        check = result["result"]["summary"]["premiumCheck"]
        self.assertEqual(check["status"], "default")
        self.assertEqual(check["typed"], 5.0)
        self.assertEqual(check["chainMid"], 5.0)
        self.assertFalse(result["result"]["validation"]["blocked"])


if __name__ == "__main__":
    unittest.main()
