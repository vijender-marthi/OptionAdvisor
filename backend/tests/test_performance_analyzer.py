"""Tests for performance_analyzer — rollups, metrics, breakdowns."""
import os
import sys
import unittest
from datetime import date

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from performance_analyzer import analyze_performance


def pos(ticker, strategy, entry, exit_, pnl, status="closed", source="broker_history_import",
        pct=None, capital=1000.0):
    d = {
        "ticker": ticker, "strategy": strategy, "status": status, "source": source,
        "addedAt": f"{entry}T00:00:00.000Z", "capital_at_risk": capital,
        "legs": [{"option_type": "CALL" if "Call" in strategy else "PUT"}],
    }
    if status == "closed":
        d.update({"exitDate": f"{exit_}T00:00:00.000Z", "realized_pnl": pnl,
                  "realized_pnl_percent": pct if pct is not None else round(pnl / capital * 100, 2)})
    return d


class TestPerformanceAnalyzer(unittest.TestCase):
    def setUp(self):
        self.book = [
            pos("TSLA", "Long Call", "2026-07-20", "2026-07-24", 300.0),
            pos("AAPL", "Long Put", "2026-07-24", "2026-07-24", -100.0),   # same-day
            pos("NVDA", "Bull Call Spread", "2026-07-13", "2026-07-17", 500.0),
            pos("MRVL", "Long Call", "2026-07-06", "2026-07-08", -900.0),  # overnight
            pos("GOOG", "Long Call", "2026-07-24", None, 0.0, status="open"),  # excluded
        ]
        self.r = analyze_performance(self.book, now=date(2026, 7, 27))

    def test_headline_metrics(self):
        s = self.r["summary"]
        self.assertEqual(s["n"], 4)                 # open excluded
        self.assertEqual(s["realized"], -200.0)     # 300-100+500-900
        self.assertEqual(s["wins"], 2)
        self.assertEqual(s["losses"], 2)
        self.assertEqual(s["win_rate"], 50.0)
        self.assertEqual(s["best"], 500.0)
        self.assertEqual(s["worst"], -900.0)

    def test_hold_breakdown_splits_same_day_vs_overnight(self):
        by_hold = {b["key"]: b for b in self.r["by_hold"]}
        self.assertEqual(by_hold["Same-day"]["realized"], -100.0)
        self.assertEqual(by_hold["Same-day"]["n"], 1)
        self.assertEqual(by_hold["Overnight / multi-day"]["n"], 3)

    def test_structure_breakdown(self):
        by_st = {b["key"]: b for b in self.r["by_structure"]}
        self.assertEqual(by_st["Vertical Spread"]["realized"], 500.0)
        self.assertEqual(by_st["Directional long"]["n"], 3)

    def test_equity_curve_and_drawdown(self):
        self.assertEqual(self.r["equity"][-1]["cum"], -200.0)
        self.assertLessEqual(self.r["summary"]["max_drawdown"], 0.0)

    def test_weekly_rollup_present(self):
        self.assertTrue(len(self.r["weekly"]) >= 1)
        self.assertIn("week_start", self.r["weekly"][0])

    def test_empty_book_is_safe(self):
        r = analyze_performance([], now=date(2026, 7, 27))
        self.assertEqual(r["summary"]["n"], 0)
        self.assertEqual(r["summary"]["profit_factor"], None)
        self.assertEqual(r["equity"], [])


if __name__ == "__main__":
    unittest.main()
