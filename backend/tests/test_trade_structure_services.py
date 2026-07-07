import unittest

from services.bias_change_service import bias_change_conditions
from services.invalidation_service import invalidation_for_bias
from services.market_phase_service import classify_market_phase
from services.market_structure_service import classify_structure
from services.pivot_detection_service import Pivot, detect_confirmed_pivots, label_pivots


class TradeStructureServiceTests(unittest.TestCase):
    def test_hh_hl_detection(self):
        pivots = label_pivots([
            Pivot("H", 1, 10),
            Pivot("L", 2, 8),
            Pivot("H", 3, 12),
            Pivot("L", 4, 9),
            Pivot("H", 5, 14),
            Pivot("L", 6, 11),
        ])
        result = classify_structure(pivots)
        self.assertEqual(result["state"], "Bull Trend")
        self.assertEqual(result["sequence"], ["HH", "HL", "HH", "HL"])

    def test_lh_ll_detection(self):
        pivots = label_pivots([
            Pivot("H", 1, 14),
            Pivot("L", 2, 11),
            Pivot("H", 3, 12),
            Pivot("L", 4, 9),
            Pivot("H", 5, 10),
            Pivot("L", 6, 7),
        ])
        result = classify_structure(pivots)
        self.assertEqual(result["state"], "Bear Trend")
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
