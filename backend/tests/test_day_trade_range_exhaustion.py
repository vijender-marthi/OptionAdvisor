"""
Tests for the daily range exhaustion logic (inline in run_day_trade_scan)
and entry R/R ratio math (also inline).

Since both are inline (not standalone functions), we replicate the exact
algorithm here and test the mathematical contract.

Range exhaustion (day_trade.py lines ~1756-1775):
  _range_span = session_high - session_low
  if _range_span > 0:
      if bias == "long":
          _daily_range_used_pct = round((last - session_low) / _range_span * 100, 1)
      else:
          _daily_range_used_pct = round((session_high - last) / _range_span * 100, 1)
  else:
      _daily_range_used_pct = 0.0
  _daily_range_used_pct = max(0.0, min(100.0, _daily_range_used_pct))

  if _daily_range_used_pct >= 80: phase = "EXHAUSTED"
  elif _daily_range_used_pct >= 65: phase = "LATE"
  elif _daily_range_used_pct >= 40: phase = "MID"
  else: phase = "EARLY"

Entry R/R (day_trade.py lines ~1799-1802):
  _reward = abs(_eg_scalp - _eg_price)
  _risk   = abs(_eg_price - _eg_risk)
  entry_rr_ratio = round(_reward / _risk, 2) if _risk > 0 else None
"""
import unittest


def compute_daily_range(session_high, session_low, last, bias):
    """Replicate the inline daily range exhaustion logic from day_trade.py."""
    _range_span = session_high - session_low
    if _range_span > 0:
        if bias == "long":
            _daily_range_used_pct = round((last - session_low) / _range_span * 100, 1)
        else:
            _daily_range_used_pct = round((session_high - last) / _range_span * 100, 1)
    else:
        _daily_range_used_pct = 0.0
    _daily_range_used_pct = max(0.0, min(100.0, _daily_range_used_pct))

    if _daily_range_used_pct >= 80:
        _daily_range_phase = "EXHAUSTED"
    elif _daily_range_used_pct >= 65:
        _daily_range_phase = "LATE"
    elif _daily_range_used_pct >= 40:
        _daily_range_phase = "MID"
    else:
        _daily_range_phase = "EARLY"

    return _daily_range_used_pct, _daily_range_phase


def compute_entry_rr(scalp_target, current_price, risk_below):
    """Replicate the inline entry R/R math from day_trade.py."""
    _reward = abs(scalp_target - current_price)
    _risk = abs(current_price - risk_below)
    return round(_reward / _risk, 2) if _risk > 0 else None


class TestLongBiasDailyRange(unittest.TestCase):

    def setUp(self):
        self.low = 100.0
        self.high = 200.0

    def test_long_bias_at_session_low_returns_zero_pct_early(self):
        pct, phase = compute_daily_range(self.high, self.low, self.low, "long")
        self.assertAlmostEqual(pct, 0.0, places=1)
        self.assertEqual(phase, "EARLY")

    def test_long_bias_at_session_high_returns_100_pct_exhausted(self):
        pct, phase = compute_daily_range(self.high, self.low, self.high, "long")
        self.assertAlmostEqual(pct, 100.0, places=1)
        self.assertEqual(phase, "EXHAUSTED")

    def test_long_bias_at_88_pct_of_range_returns_exhausted(self):
        last = self.low + 0.88 * (self.high - self.low)
        pct, phase = compute_daily_range(self.high, self.low, last, "long")
        self.assertAlmostEqual(pct, 88.0, places=1)
        self.assertEqual(phase, "EXHAUSTED")

    def test_long_bias_at_70_pct_of_range_returns_late(self):
        last = self.low + 0.70 * (self.high - self.low)
        pct, phase = compute_daily_range(self.high, self.low, last, "long")
        self.assertAlmostEqual(pct, 70.0, places=1)
        self.assertEqual(phase, "LATE")

    def test_long_bias_at_50_pct_of_range_returns_mid(self):
        last = self.low + 0.50 * (self.high - self.low)
        pct, phase = compute_daily_range(self.high, self.low, last, "long")
        self.assertAlmostEqual(pct, 50.0, places=1)
        self.assertEqual(phase, "MID")

    def test_long_bias_at_20_pct_of_range_returns_early(self):
        last = self.low + 0.20 * (self.high - self.low)
        pct, phase = compute_daily_range(self.high, self.low, last, "long")
        self.assertAlmostEqual(pct, 20.0, places=1)
        self.assertEqual(phase, "EARLY")

    def test_long_bias_boundary_exactly_80_pct_returns_exhausted(self):
        last = self.low + 0.80 * (self.high - self.low)
        pct, phase = compute_daily_range(self.high, self.low, last, "long")
        self.assertAlmostEqual(pct, 80.0, places=1)
        self.assertEqual(phase, "EXHAUSTED")

    def test_long_bias_boundary_exactly_65_pct_returns_late(self):
        last = self.low + 0.65 * (self.high - self.low)
        pct, phase = compute_daily_range(self.high, self.low, last, "long")
        self.assertAlmostEqual(pct, 65.0, places=1)
        self.assertEqual(phase, "LATE")

    def test_long_bias_boundary_exactly_40_pct_returns_mid(self):
        last = self.low + 0.40 * (self.high - self.low)
        pct, phase = compute_daily_range(self.high, self.low, last, "long")
        self.assertAlmostEqual(pct, 40.0, places=1)
        self.assertEqual(phase, "MID")


class TestShortBiasDailyRange(unittest.TestCase):

    def setUp(self):
        self.low = 100.0
        self.high = 200.0

    def test_short_bias_at_session_high_returns_zero_pct_early(self):
        pct, phase = compute_daily_range(self.high, self.low, self.high, "short")
        self.assertAlmostEqual(pct, 0.0, places=1)
        self.assertEqual(phase, "EARLY")

    def test_short_bias_at_session_low_returns_100_pct_exhausted(self):
        pct, phase = compute_daily_range(self.high, self.low, self.low, "short")
        self.assertAlmostEqual(pct, 100.0, places=1)
        self.assertEqual(phase, "EXHAUSTED")

    def test_short_bias_at_85_pct_from_high_returns_exhausted(self):
        # 85% from high means last = high - 0.85*(high-low)
        last = self.high - 0.85 * (self.high - self.low)
        pct, phase = compute_daily_range(self.high, self.low, last, "short")
        self.assertAlmostEqual(pct, 85.0, places=1)
        self.assertEqual(phase, "EXHAUSTED")

    def test_short_bias_at_70_pct_from_high_returns_late(self):
        last = self.high - 0.70 * (self.high - self.low)
        pct, phase = compute_daily_range(self.high, self.low, last, "short")
        self.assertAlmostEqual(pct, 70.0, places=1)
        self.assertEqual(phase, "LATE")

    def test_short_bias_at_50_pct_from_high_returns_mid(self):
        last = self.high - 0.50 * (self.high - self.low)
        pct, phase = compute_daily_range(self.high, self.low, last, "short")
        self.assertAlmostEqual(pct, 50.0, places=1)
        self.assertEqual(phase, "MID")

    def test_short_bias_at_20_pct_from_high_returns_early(self):
        last = self.high - 0.20 * (self.high - self.low)
        pct, phase = compute_daily_range(self.high, self.low, last, "short")
        self.assertAlmostEqual(pct, 20.0, places=1)
        self.assertEqual(phase, "EARLY")


class TestZeroRangeDailyRange(unittest.TestCase):

    def test_zero_range_span_long_returns_zero_early(self):
        pct, phase = compute_daily_range(150.0, 150.0, 150.0, "long")
        self.assertAlmostEqual(pct, 0.0, places=1)
        self.assertEqual(phase, "EARLY")

    def test_zero_range_span_short_returns_zero_early(self):
        pct, phase = compute_daily_range(150.0, 150.0, 150.0, "short")
        self.assertAlmostEqual(pct, 0.0, places=1)
        self.assertEqual(phase, "EARLY")

    def test_pct_clamped_to_100_when_above(self):
        # last above high (shouldn't happen in real data, but clamp must hold)
        pct, phase = compute_daily_range(200.0, 100.0, 250.0, "long")
        self.assertAlmostEqual(pct, 100.0, places=1)
        self.assertEqual(phase, "EXHAUSTED")

    def test_pct_clamped_to_0_when_below(self):
        # last below low (shouldn't happen, clamp must hold)
        pct, phase = compute_daily_range(200.0, 100.0, 50.0, "long")
        self.assertAlmostEqual(pct, 0.0, places=1)
        self.assertEqual(phase, "EARLY")


class TestEntryRRRatio(unittest.TestCase):

    def test_reward_2_risk_1_returns_2_0(self):
        result = compute_entry_rr(scalp_target=102.0, current_price=100.0, risk_below=99.0)
        self.assertAlmostEqual(result, 2.0, places=2)

    def test_reward_1_5_risk_1_0_returns_1_5(self):
        result = compute_entry_rr(scalp_target=101.5, current_price=100.0, risk_below=99.0)
        self.assertAlmostEqual(result, 1.5, places=2)

    def test_zero_risk_returns_none(self):
        result = compute_entry_rr(scalp_target=102.0, current_price=100.0, risk_below=100.0)
        self.assertIsNone(result)

    def test_zero_reward_returns_0_0(self):
        result = compute_entry_rr(scalp_target=100.0, current_price=100.0, risk_below=99.0)
        self.assertAlmostEqual(result, 0.0, places=2)

    def test_reward_0_5_risk_1_0_returns_0_5(self):
        result = compute_entry_rr(scalp_target=100.5, current_price=100.0, risk_below=99.0)
        self.assertAlmostEqual(result, 0.5, places=2)

    def test_short_direction_reward_2_risk_1_returns_2_0(self):
        # For short: scalp_target < current_price, risk_below > current_price
        result = compute_entry_rr(scalp_target=98.0, current_price=100.0, risk_below=101.0)
        self.assertAlmostEqual(result, 2.0, places=2)

    def test_result_is_rounded_to_2_decimal_places(self):
        # 1.0 / 3.0 = 0.3333… → rounds to 0.33
        result = compute_entry_rr(scalp_target=101.0, current_price=100.0, risk_below=97.0)
        # reward=1, risk=3 → 0.33
        self.assertAlmostEqual(result, 0.33, places=2)


if __name__ == "__main__":
    unittest.main()
