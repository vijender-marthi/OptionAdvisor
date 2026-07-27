"""Tests for coaching_engine — leak detection over the realized book."""
import os
import sys
import unittest
from datetime import date

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from coaching_engine import analyze_coaching
from tests.test_performance_analyzer import pos


class TestCoachingEngine(unittest.TestCase):
    def _codes(self, res):
        return {l["code"]: l for l in res["leaks"]}

    def test_overnight_and_oversized_leaks_detected(self):
        book = [
            # overnight AND oversized (big loss carried multi-day) — counted once in total
            pos("ARM", "Long Call", "2026-05-06", "2026-05-08", -2862.20, pct=-99.0),
            # a normal small overnight loser
            pos("MRVL", "Long Call", "2026-06-16", "2026-06-16", -200.0),  # same-day, not overnight
            pos("TSLA", "Long Call", "2026-07-16", "2026-07-22", -400.0),  # overnight loser
            pos("AAPL", "Long Call", "2026-07-20", "2026-07-24", 600.0),   # overnight winner
        ]
        res = analyze_coaching(book, now=date(2026, 7, 27))
        codes = self._codes(res)
        self.assertIn("OVERNIGHT_HELD_LOSS", codes)
        self.assertIn("OVERSIZED_LOSS", codes)
        # overnight losers: ARM + TSLA (MRVL is same-day, AAPL is a winner)
        self.assertEqual(codes["OVERNIGHT_HELD_LOSS"]["count"], 2)
        # oversized: only ARM
        self.assertEqual(codes["OVERSIZED_LOSS"]["count"], 1)

    def test_total_leak_cost_dedupes_overlap(self):
        # ARM is both overnight and oversized; it must be counted once, not twice.
        book = [pos("ARM", "Long Call", "2026-05-06", "2026-05-08", -2862.20, pct=-99.0)]
        res = analyze_coaching(book, now=date(2026, 7, 27))
        self.assertEqual(res["total_leak_cost"], -2862.20)

    def test_directional_long_drag_flagged_when_net_negative(self):
        book = [
            pos("TSLA", "Long Call", "2026-07-01", "2026-07-02", -500.0),
            pos("NVDA", "Long Put", "2026-07-01", "2026-07-02", -300.0),
        ]
        codes = self._codes(analyze_coaching(book, now=date(2026, 7, 27)))
        self.assertIn("DIRECTIONAL_LONG_DRAG", codes)
        self.assertEqual(codes["DIRECTIONAL_LONG_DRAG"]["cost"], -800.0)

    def test_clean_book_has_no_high_severity_leaks(self):
        book = [
            pos("AAPL", "Bull Call Spread", "2026-07-01", "2026-07-01", 400.0),
            pos("MSFT", "Short Put", "2026-07-02", "2026-07-02", 300.0),
        ]
        res = analyze_coaching(book, now=date(2026, 7, 27))
        self.assertEqual([l for l in res["leaks"] if l["severity"] == "high"], [])
        self.assertEqual(res["total_leak_cost"], 0.0)

    def test_empty_book_is_safe(self):
        res = analyze_coaching([], now=date(2026, 7, 27))
        self.assertEqual(res["leaks"], [])
        self.assertIn("weekly_digest", res)


if __name__ == "__main__":
    unittest.main()
