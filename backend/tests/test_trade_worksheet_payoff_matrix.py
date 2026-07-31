import unittest

import main


def _req(**overrides):
    base = {
        "ticker": "AAPL",
        "direction": "Bullish",
        "strategy": "Long Call",
        "strike": 150,
        "longStrike": 150,
        "shortStrike": 140,
        "shortPutStrike": 140,
        "shortCallStrike": 160,
        "expiration": "2026-08-21",
        "premium": 5,
        "contracts": 1,
        "stockPrice": 150,
        "targetPrice": 160,
        "expectedHoldDays": 5,
        "buyingPower": 25000,
        "ivRank": 35,
        "ivPercentile": 40,
        "historicalVolatility": 30,
        "priceMove": 5,
        "ivMove": 0,
        "daysPassed": 3,
    }
    base.update(overrides)
    return main.TradeWorksheetEvaluateRequest(**base)


class PayoffMatrixConsistencyTests(unittest.TestCase):
    """At expiration (t_years=0) the BS-priced payoff must collapse to the
    intrinsic `_tw_payoff` for every strategy."""

    STRATEGIES = [
        {"strategy": "Long Call", "direction": "Bullish"},
        {"strategy": "Long Put", "direction": "Bearish"},
        {"strategy": "Bull Call Spread", "direction": "Bullish"},
        {"strategy": "Bear Put Spread", "direction": "Bearish"},
        {"strategy": "Bull Put Spread", "direction": "Bullish"},
        {"strategy": "Bear Call Spread", "direction": "Bearish"},
        {"strategy": "Cash Secured Put", "direction": "Bullish"},
        {"strategy": "Covered Call", "direction": "Bullish"},
        {"strategy": "Iron Condor", "direction": "Neutral"},
        {"strategy": "Shares", "direction": "Bullish"},
    ]

    def test_expiration_column_matches_intrinsic(self):
        for spec in self.STRATEGIES:
            req = _req(**spec)
            for pct in range(-30, 31, 3):
                price = 150 * (1 + pct / 100)
                intrinsic = main._tw_payoff(req, price)
                bs_val = main._tw_payoff_at(req, price, 0.0, 0.30)
                self.assertAlmostEqual(
                    bs_val, intrinsic, delta=1.0,
                    msg=f"{spec['strategy']} @ {price:.2f}: bs={bs_val} intrinsic={intrinsic}",
                )

    def test_matrix_shape_and_expiration_column(self):
        req = _req(strategy="Long Call", direction="Bullish")
        matrix = main._tw_payoff_matrix(req, 0.30, front_dte=43)
        self.assertEqual(len(matrix["grid"]), len(matrix["prices"]))
        self.assertTrue(all(len(row) == len(matrix["columns"]) for row in matrix["grid"]))
        self.assertTrue(matrix["columns"][-1]["isExpiration"])
        # last column (expiration) equals rounded intrinsic
        for i, price in enumerate(matrix["prices"]):
            self.assertAlmostEqual(
                matrix["grid"][i][-1], round(main._tw_payoff(req, price)), delta=1.0,
            )
        # time value: for a long call with the stock above break-even region,
        # an earlier date (more time left) should be worth >= expiration value.
        self.assertGreaterEqual(matrix["grid"][0][0], matrix["grid"][0][-1] - 1)


if __name__ == "__main__":
    unittest.main()
