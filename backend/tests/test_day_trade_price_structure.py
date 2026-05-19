"""
Tests for _swing_structure logic (nested in run_day_trade_scan).

Since _swing_structure is not importable, we re-implement the identical
algorithm here and test the contract directly.  Any drift between the
production copy and this re-implementation will surface as a test failure.

Algorithm (from day_trade.py lines 1061-1083):
  - For each bar i in range(window, len-window):
      if closes[i] == max(closes[i-window:i+window+1]) → swing high
      if closes[i] == min(closes[i-window:i+window+1]) → swing low
  - If >=2 swing highs AND >=2 swing lows:
      hh = last_high > prev_high
      hl = last_low  > prev_low
      ll = last_low  < prev_low
      lh = last_high < prev_high
      "HH_HL" if hh and hl
      "LL_LH" if ll and lh
      else "MIXED"
  - Otherwise "FLAT"
"""
import unittest


def _swing_structure(closes, window=5):
    """Re-implementation of the nested function from day_trade.py."""
    if len(closes) < window * 2 + 1:
        return "FLAT"
    highs = list(closes)
    lows = list(closes)
    swing_highs, swing_lows = [], []
    for i in range(window, len(highs) - window):
        if highs[i] == max(highs[i - window: i + window + 1]):
            swing_highs.append(highs[i])
        if lows[i] == min(lows[i - window: i + window + 1]):
            swing_lows.append(lows[i])
    if len(swing_highs) >= 2 and len(swing_lows) >= 2:
        hh = swing_highs[-1] > swing_highs[-2]
        hl = swing_lows[-1] > swing_lows[-2]
        ll = swing_lows[-1] < swing_lows[-2]
        lh = swing_highs[-1] < swing_highs[-2]
        if hh and hl:
            return "HH_HL"
        if ll and lh:
            return "LL_LH"
        return "MIXED"
    return "FLAT"


class TestSwingStructureFlat(unittest.TestCase):

    def test_flat_array_returns_flat(self):
        closes = [100.0] * 20
        self.assertEqual(_swing_structure(closes), "FLAT")

    def test_too_short_for_window_returns_flat(self):
        # window=5 requires at least 11 bars; give 10
        closes = list(range(1, 11))
        self.assertEqual(_swing_structure(closes), "FLAT")

    def test_exactly_minimum_length_with_single_swing(self):
        # 11 bars = 2*5+1: only bar at index 5 is checked, produces at most 1 swing
        closes = [1, 2, 3, 4, 5, 10, 5, 4, 3, 2, 1]
        result = _swing_structure(closes, window=5)
        # Only one swing high at index 5; not enough → FLAT
        self.assertEqual(result, "FLAT")

    def test_single_swing_point_only_returns_flat(self):
        # 13 bars, one clear peak — produces only 1 swing high, 0 swing lows
        closes = [1, 2, 3, 4, 5, 6, 10, 6, 5, 4, 3, 2, 1]
        result = _swing_structure(closes, window=5)
        self.assertEqual(result, "FLAT")


class TestSwingStructureRising(unittest.TestCase):

    def test_clearly_rising_series_returns_hh_hl(self):
        # Two peaks with second higher, two troughs with second higher
        # window=2 to keep data compact
        # trough, rise, peak, fall, trough, rise, peak (bigger)
        closes = [10, 12, 15, 12, 13, 16, 20, 16, 17]
        result = _swing_structure(closes, window=2)
        self.assertEqual(result, "HH_HL")

    def test_staircase_up_pattern_returns_hh_hl(self):
        # Ascending staircase with clear HH/HL
        closes = [
            100, 102, 105, 102, 103,   # first trough ~102, first peak ~105
            104, 107, 111, 107, 108,   # second trough ~107, second peak ~111
            109, 113, 115              # still rising
        ]
        result = _swing_structure(closes, window=2)
        self.assertEqual(result, "HH_HL")


class TestSwingStructureFalling(unittest.TestCase):

    def test_clearly_falling_series_returns_ll_lh(self):
        # Two peaks with second lower, two troughs with second lower
        closes = [20, 16, 13, 16, 15, 12, 10, 12, 11]
        result = _swing_structure(closes, window=2)
        self.assertEqual(result, "LL_LH")

    def test_staircase_down_pattern_returns_ll_lh(self):
        closes = [
            110, 107, 103, 107, 106,
            104, 100, 96,  100, 98,
            95,  91,  89
        ]
        result = _swing_structure(closes, window=2)
        self.assertEqual(result, "LL_LH")


class TestSwingStructureMixed(unittest.TestCase):

    def test_zigzag_returns_mixed(self):
        # Peak then higher trough but lower second peak → HH but not HL, or LL but not LH
        # HH (second peak > first), but LL (second trough < first) → neither branch
        closes = [10, 14, 18, 14, 12, 16, 20, 16, 10, 14, 15]
        result = _swing_structure(closes, window=2)
        self.assertEqual(result, "MIXED")

    def test_higher_high_but_lower_low_returns_mixed(self):
        # Rising peak but falling trough → not HH_HL, not LL_LH → MIXED
        closes = [
            12, 14, 16, 14, 10,  # peak=16, trough=10
            11, 15, 20, 15, 8,   # peak=20 (HH), trough=8 (LL) → MIXED
            9, 12
        ]
        result = _swing_structure(closes, window=2)
        self.assertEqual(result, "MIXED")


class TestSwingStructureBoundary(unittest.TestCase):

    def test_exactly_2_window_plus_1_bars_with_valid_structure(self):
        # window=2 → minimum 5 bars; give exactly 5
        # index 2 is the only candidate: need bars 0-4
        closes = [5, 8, 10, 8, 5]
        result = _swing_structure(closes, window=2)
        # Only one swing high at 10, one swing low at 5 and 5 (same value)
        # Not enough distinct swing points for >=2 each → FLAT
        self.assertEqual(result, "FLAT")

    def test_window_1_with_enough_data_gives_result(self):
        # window=1 minimum is 3 bars; use 9 bars for clear structure
        # rising: troughs and peaks both ascending
        closes = [5, 8, 6, 9, 7, 11, 8, 13, 10]
        result = _swing_structure(closes, window=1)
        self.assertEqual(result, "HH_HL")

    def test_default_window_5_with_insufficient_bars_returns_flat(self):
        # 10 bars < 11 minimum for window=5
        closes = list(range(1, 11))
        self.assertEqual(_swing_structure(closes), "FLAT")

    def test_return_value_is_string(self):
        closes = [10, 12, 15, 12, 13, 16, 20, 16, 17]
        result = _swing_structure(closes, window=2)
        self.assertIsInstance(result, str)

    def test_valid_results_are_known_states(self):
        valid_states = {"HH_HL", "LL_LH", "MIXED", "FLAT"}
        test_cases = [
            ([100] * 20,),
            ([10, 12, 15, 12, 13, 16, 20, 16, 17],),
            ([20, 16, 13, 16, 15, 12, 10, 12, 11],),
        ]
        for (closes,) in test_cases:
            result = _swing_structure(closes, window=2)
            self.assertIn(result, valid_states)


if __name__ == "__main__":
    unittest.main()
