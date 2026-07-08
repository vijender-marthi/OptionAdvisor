import unittest

from services.bias_change_service import bias_change_conditions
from services.invalidation_service import invalidation_for_bias
from services.market_phase_service import classify_market_phase
from services.market_structure_service import classify_structure
from services.pivot_detection_service import Pivot, detect_confirmed_pivots, label_pivots


class TradeStructureServiceTests(unittest.TestCase):
    def test_hh_hl_detection(self):
        pivots = [
            Pivot("H", 1, 10),
            Pivot("L", 2, 8),
            Pivot("H", 3, 12),
            Pivot("L", 4, 9),
            Pivot("H", 5, 14),
            Pivot("L", 6, 11),
        ]
        result = classify_structure(pivots)
        self.assertEqual(result["state"], "Bullish Continuation")
        self.assertEqual(result["sequence"], ["HH", "HL", "HH", "HL"])

    def test_lh_ll_detection(self):
        pivots = [
            Pivot("H", 1, 14),
            Pivot("L", 2, 11),
            Pivot("H", 3, 12),
            Pivot("L", 4, 9),
            Pivot("H", 5, 10),
            Pivot("L", 6, 7),
        ]
        result = classify_structure(pivots)
        self.assertEqual(result["state"], "Bearish Continuation")
        self.assertEqual(result["sequence"], ["LH", "LL", "LH", "LL"])

    def test_first_bounce_after_ll_is_not_hh(self):
        pivots = label_pivots([
            Pivot("H", 1, 14),
            Pivot("L", 2, 11),
            Pivot("H", 3, 12),
            Pivot("L", 4, 9),
            Pivot("H", 5, 11),
        ])
        self.assertEqual(pivots[-1].label, "LH")
        self.assertNotEqual(pivots[-1].label, "HH")

    def test_current_candle_not_labeled_as_pivot(self):
        highs = [10, 11, 12, 13, 20]
        lows = [9, 8, 7, 6, 5]
        pivots = detect_confirmed_pivots(highs, lows, left=1, right=1)
        self.assertTrue(all(p.index != 4 for p in pivots))

    def test_higher_low_must_be_above_prior_higher_low(self):
        pivots = [
            Pivot("L", 1, 413.50),
            Pivot("H", 2, 419.55),
            Pivot("L", 3, 408.46),
            Pivot("H", 4, 415.00),
            Pivot("L", 5, 402.90),
        ]
        result = classify_structure(pivots)
        labels = [p["label"] for p in result["all_pivots"]]
        self.assertIn("LL", labels)
        self.assertNotIn("HL", labels)
        self.assertEqual(result["all_pivots"][2]["label"], "LL")
        self.assertEqual(result["all_pivots"][-1]["label"], "LL")

    def test_hh_ll_breaks_bull_trend_not_higher_low(self):
        pivots = [
            Pivot("L", 1, 100),
            Pivot("H", 2, 110),
            Pivot("L", 3, 105),
            Pivot("H", 4, 115),
            Pivot("L", 5, 95),
        ]
        result = classify_structure(pivots)
        self.assertEqual(result["state"], "Bull Trend Broken")
        self.assertEqual(result["sequence"][-2:], ["HH", "LL"])

    def test_breaking_latest_higher_low_is_lower_low_even_above_baseline(self):
        pivots = [
            Pivot("L", 1, 100),
            Pivot("H", 2, 110),
            Pivot("L", 3, 105),
            Pivot("H", 4, 115),
            Pivot("L", 5, 103),
        ]
        result = classify_structure(pivots)
        self.assertEqual(result["all_pivots"][-1]["label"], "LL")
        self.assertEqual(result["state"], "Bull Trend Broken")

    def test_lower_high_compares_to_immediate_prior_high(self):
        pivots = [
            Pivot("H", 1, 100),
            Pivot("L", 2, 90),
            Pivot("H", 3, 110),
            Pivot("L", 4, 95),
            Pivot("H", 5, 105),
        ]
        result = classify_structure(pivots)
        self.assertEqual(result["all_pivots"][-1]["label"], "LH")
        self.assertNotEqual(result["all_pivots"][-1]["label"], "HH")

    def test_ll_lh_ll_bearish_continuation(self):
        pivots = [
            Pivot("H", 1, 110),
            Pivot("L", 2, 100),
            Pivot("H", 3, 95),
            Pivot("L", 4, 90),
        ]
        result = classify_structure(pivots)
        self.assertEqual(result["state"], "Bearish Continuation")
        self.assertEqual(result["sequence"], ["LH", "LL"])

    def test_markdown_classification(self):
        result = classify_market_phase("Bear Trend", price=99, vwap=100, momentum=-1, volume_ratio=1.2)
        self.assertEqual(result["phase"], "Markdown")

    def test_markup_classification(self):
        result = classify_market_phase("Bull Trend", price=101, vwap=100, momentum=1, volume_ratio=1.2)
        self.assertEqual(result["phase"], "Markup")

    def test_distribution_classification(self):
        result = classify_market_phase("Mixed", price=101, vwap=100, momentum=-1, volume_ratio=1.5)
        self.assertEqual(result["phase"], "Distribution")

    def test_accumulation_classification(self):
        result = classify_market_phase("Mixed", price=99, vwap=100, momentum=1, volume_ratio=1.5)
        self.assertEqual(result["phase"], "Accumulation")

    def test_invalidation_level_calculation(self):
        pivots = [Pivot("H", 3, 406.7, "LH"), Pivot("L", 4, 404.45, "LL")]
        result = invalidation_for_bias("bearish", pivots, 405.2)
        self.assertEqual(result["level"], 406.7)
        self.assertIn("Break above last LH", result["rules"])

    def test_bias_change_logic(self):
        pivots = [Pivot("H", 3, 406.7, "LH"), Pivot("L", 4, 404.45, "LL")]
        result = bias_change_conditions("bearish", pivots, 405.2)
        self.assertTrue(any("404.45" in item for item in result["neutral_if"]))
        self.assertIn("Price reclaims VWAP", result["opposite_if"])


if __name__ == "__main__":
    unittest.main()
