"""
Tests for the weekly range exhaustion logic (inline in swing_trade.py
after `reasons = prefix + body`, lines ~2320-2342).

Since the logic is inline (not a standalone function), we replicate the
exact algorithm and test its mathematical contract.

Algorithm (swing_trade.py lines ~2325-2342):
  _week_span = _week_high - _week_low
  if _week_span > 0:
      if bias == "long":
          _weekly_range_used_pct = round((last - _week_low) / _week_span * 100, 1)
      elif bias == "short":
          _weekly_range_used_pct = round((_week_high - last) / _week_span * 100, 1)
      else:  # neutral / None
          _weekly_range_used_pct = round(
              abs(last - (_week_low + _week_span / 2)) / (_week_span / 2) * 50, 1
          )
      _weekly_range_used_pct = max(0.0, min(100.0, _weekly_range_used_pct))
  else:
      _weekly_range_used_pct = 0.0

  if _weekly_range_used_pct >= 70: phase = "EXTENDED"
  elif _weekly_range_used_pct >= 50: phase = "LATE"
  elif _weekly_range_used_pct >= 30: phase = "MID"
  else: phase = "EARLY"
"""
import unittest


def compute_weekly_range(week_high, week_low, last, bias):
    """Replicate the inline weekly range exhaustion logic from swing_trade.py."""
    _week_span = week_high - week_low
    if _week_span > 0:
        if bias == "long":
            _weekly_range_used_pct = round((last - week_low) / _week_span * 100, 1)
        elif bias == "short":
            _weekly_range_used_pct = round((week_high - last) / _week_span * 100, 1)
        else:
            _weekly_range_used_pct = round(
                abs(last - (week_low + _week_span / 2)) / (_week_span / 2) * 50, 1
            )
        _weekly_range_used_pct = max(0.0, min(100.0, _weekly_range_used_pct))
    else:
        _weekly_range_used_pct = 0.0

    if _weekly_range_used_pct >= 70:
        _weekly_range_phase = "EXTENDED"
    elif _weekly_range_used_pct >= 50:
        _weekly_range_phase = "LATE"
    elif _weekly_range_used_pct >= 30:
        _weekly_range_phase = "MID"
    else:
        _weekly_range_phase = "EARLY"

    return _weekly_range_used_pct, _weekly_range_phase


class TestLongBiasWeeklyRange(unittest.TestCase):

    def setUp(self):
        self.low = 100.0
        self.high = 200.0

    def test_long_at_week_low_returns_zero_pct_early(self):
        pct, phase = compute_weekly_range(self.high, self.low, self.low, "long")
        self.assertAlmostEqual(pct, 0.0, places=1)
        self.assertEqual(phase, "EARLY")

    def test_long_at_week_high_returns_100_pct_extended(self):
        pct, phase = compute_weekly_range(self.high, self.low, self.high, "long")
        self.assertAlmostEqual(pct, 100.0, places=1)
        self.assertEqual(phase, "EXTENDED")

    def test_long_at_70_pct_boundary_returns_extended(self):
        last = self.low + 0.70 * (self.high - self.low)
        pct, phase = compute_weekly_range(self.high, self.low, last, "long")
        self.assertAlmostEqual(pct, 70.0, places=1)
        self.assertEqual(phase, "EXTENDED")

    def test_long_at_50_pct_boundary_returns_late(self):
        last = self.low + 0.50 * (self.high - self.low)
        pct, phase = compute_weekly_range(self.high, self.low, last, "long")
        self.assertAlmostEqual(pct, 50.0, places=1)
        self.assertEqual(phase, "LATE")

    def test_long_at_30_pct_boundary_returns_mid(self):
        last = self.low + 0.30 * (self.high - self.low)
        pct, phase = compute_weekly_range(self.high, self.low, last, "long")
        self.assertAlmostEqual(pct, 30.0, places=1)
        self.assertEqual(phase, "MID")

    def test_long_at_20_pct_returns_early(self):
        last = self.low + 0.20 * (self.high - self.low)
        pct, phase = compute_weekly_range(self.high, self.low, last, "long")
        self.assertAlmostEqual(pct, 20.0, places=1)
        self.assertEqual(phase, "EARLY")

    def test_long_at_80_pct_returns_extended(self):
        last = self.low + 0.80 * (self.high - self.low)
        pct, phase = compute_weekly_range(self.high, self.low, last, "long")
        self.assertAlmostEqual(pct, 80.0, places=1)
        self.assertEqual(phase, "EXTENDED")

    def test_long_at_60_pct_returns_late(self):
        last = self.low + 0.60 * (self.high - self.low)
        pct, phase = compute_weekly_range(self.high, self.low, last, "long")
        self.assertAlmostEqual(pct, 60.0, places=1)
        self.assertEqual(phase, "LATE")

    def test_long_at_40_pct_returns_mid(self):
        last = self.low + 0.40 * (self.high - self.low)
        pct, phase = compute_weekly_range(self.high, self.low, last, "long")
        self.assertAlmostEqual(pct, 40.0, places=1)
        self.assertEqual(phase, "MID")


class TestShortBiasWeeklyRange(unittest.TestCase):

    def setUp(self):
        self.low = 100.0
        self.high = 200.0

    def test_short_at_week_high_returns_zero_pct_early(self):
        pct, phase = compute_weekly_range(self.high, self.low, self.high, "short")
        self.assertAlmostEqual(pct, 0.0, places=1)
        self.assertEqual(phase, "EARLY")

    def test_short_at_week_low_returns_100_pct_extended(self):
        pct, phase = compute_weekly_range(self.high, self.low, self.low, "short")
        self.assertAlmostEqual(pct, 100.0, places=1)
        self.assertEqual(phase, "EXTENDED")

    def test_short_at_75_pct_from_high_returns_extended(self):
        last = self.high - 0.75 * (self.high - self.low)
        pct, phase = compute_weekly_range(self.high, self.low, last, "short")
        self.assertAlmostEqual(pct, 75.0, places=1)
        self.assertEqual(phase, "EXTENDED")

    def test_short_at_55_pct_from_high_returns_late(self):
        last = self.high - 0.55 * (self.high - self.low)
        pct, phase = compute_weekly_range(self.high, self.low, last, "short")
        self.assertAlmostEqual(pct, 55.0, places=1)
        self.assertEqual(phase, "LATE")

    def test_short_at_35_pct_from_high_returns_mid(self):
        last = self.high - 0.35 * (self.high - self.low)
        pct, phase = compute_weekly_range(self.high, self.low, last, "short")
        self.assertAlmostEqual(pct, 35.0, places=1)
        self.assertEqual(phase, "MID")

    def test_short_at_15_pct_from_high_returns_early(self):
        last = self.high - 0.15 * (self.high - self.low)
        pct, phase = compute_weekly_range(self.high, self.low, last, "short")
        self.assertAlmostEqual(pct, 15.0, places=1)
        self.assertEqual(phase, "EARLY")


class TestNeutralBiasWeeklyRange(unittest.TestCase):

    def setUp(self):
        self.low = 100.0
        self.high = 200.0
        self.mid = 150.0  # midpoint

    def test_neutral_at_midpoint_returns_zero_pct_early(self):
        pct, phase = compute_weekly_range(self.high, self.low, self.mid, None)
        self.assertAlmostEqual(pct, 0.0, places=1)
        self.assertEqual(phase, "EARLY")

    def test_neutral_at_extreme_low_returns_50_pct_late(self):
        # abs(low - mid) / (span/2) * 50 = 50/50 * 50 = 50 → LATE
        pct, phase = compute_weekly_range(self.high, self.low, self.low, None)
        self.assertAlmostEqual(pct, 50.0, places=1)
        self.assertEqual(phase, "LATE")

    def test_neutral_at_extreme_high_returns_50_pct_late(self):
        pct, phase = compute_weekly_range(self.high, self.low, self.high, None)
        self.assertAlmostEqual(pct, 50.0, places=1)
        self.assertEqual(phase, "LATE")

    def test_neutral_bias_string_none_treated_same(self):
        pct_none, phase_none = compute_weekly_range(self.high, self.low, self.mid, None)
        # Any bias that's not "long" or "short" should go to neutral branch
        pct_other, phase_other = compute_weekly_range(self.high, self.low, self.mid, "neutral")
        self.assertAlmostEqual(pct_none, pct_other, places=1)
        self.assertEqual(phase_none, phase_other)


class TestZeroSpanWeeklyRange(unittest.TestCase):

    def test_zero_span_returns_zero_pct_early_long(self):
        pct, phase = compute_weekly_range(150.0, 150.0, 150.0, "long")
        self.assertAlmostEqual(pct, 0.0, places=1)
        self.assertEqual(phase, "EARLY")

    def test_zero_span_returns_zero_pct_early_short(self):
        pct, phase = compute_weekly_range(150.0, 150.0, 150.0, "short")
        self.assertAlmostEqual(pct, 0.0, places=1)
        self.assertEqual(phase, "EARLY")

    def test_zero_span_returns_zero_pct_early_neutral(self):
        pct, phase = compute_weekly_range(150.0, 150.0, 150.0, None)
        self.assertAlmostEqual(pct, 0.0, places=1)
        self.assertEqual(phase, "EARLY")

    def test_pct_clamped_at_100(self):
        # last above week_high for long → clamp to 100
        pct, phase = compute_weekly_range(200.0, 100.0, 250.0, "long")
        self.assertAlmostEqual(pct, 100.0, places=1)
        self.assertEqual(phase, "EXTENDED")

    def test_pct_clamped_at_0(self):
        # last below week_low for long → clamp to 0
        pct, phase = compute_weekly_range(200.0, 100.0, 50.0, "long")
        self.assertAlmostEqual(pct, 0.0, places=1)
        self.assertEqual(phase, "EARLY")


class TestWeeklyRangePhaseThresholds(unittest.TestCase):

    def test_boundary_exactly_70_returns_extended(self):
        # 70% → EXTENDED
        pct, phase = compute_weekly_range(100.0, 0.0, 70.0, "long")
        self.assertAlmostEqual(pct, 70.0, places=1)
        self.assertEqual(phase, "EXTENDED")

    def test_just_below_70_returns_late(self):
        pct, phase = compute_weekly_range(100.0, 0.0, 69.9, "long")
        self.assertEqual(phase, "LATE")

    def test_boundary_exactly_50_returns_late(self):
        pct, phase = compute_weekly_range(100.0, 0.0, 50.0, "long")
        self.assertAlmostEqual(pct, 50.0, places=1)
        self.assertEqual(phase, "LATE")

    def test_just_below_50_returns_mid(self):
        pct, phase = compute_weekly_range(100.0, 0.0, 49.9, "long")
        self.assertEqual(phase, "MID")

    def test_boundary_exactly_30_returns_mid(self):
        pct, phase = compute_weekly_range(100.0, 0.0, 30.0, "long")
        self.assertAlmostEqual(pct, 30.0, places=1)
        self.assertEqual(phase, "MID")

    def test_just_below_30_returns_early(self):
        pct, phase = compute_weekly_range(100.0, 0.0, 29.9, "long")
        self.assertEqual(phase, "EARLY")


if __name__ == "__main__":
    unittest.main()
