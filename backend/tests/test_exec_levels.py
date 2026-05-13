"""
Invariant tests for _compute_exec_levels in swing_trade.py.

Every valid trade setup must obey:
  Bull:  stop < breakout < target1 < target2
  Bear:  stop > breakout > target1 > target2
"""
import unittest
from swing_trade import _compute_exec_levels


class TestBullTargetsAboveBreakout(unittest.TestCase):

    def _run(self, last=400, ma20=390, mom=0.3):
        return _compute_exec_levels(last=last, ma20=ma20, mom_5d_pct=mom, bias="long")

    def test_low_momentum(self):
        levels = self._run(mom=0.3)
        self.assertGreater(levels["target1"], levels["breakout"])
        self.assertGreater(levels["target2"], levels["target1"])
        self.assertLess(levels["stop"], levels["breakout"])

    def test_moderate_momentum(self):
        levels = self._run(mom=1.0)
        self.assertGreater(levels["target1"], levels["breakout"])
        self.assertGreater(levels["target2"], levels["target1"])
        self.assertLess(levels["stop"], levels["breakout"])

    def test_high_momentum(self):
        levels = self._run(mom=1.5)
        self.assertGreater(levels["target1"], levels["breakout"])
        self.assertGreater(levels["target2"], levels["target1"])
        self.assertLess(levels["stop"], levels["breakout"])

    def test_very_high_momentum(self):
        levels = self._run(mom=3.0)
        self.assertGreater(levels["target1"], levels["breakout"])
        self.assertGreater(levels["target2"], levels["target1"])
        self.assertLess(levels["stop"], levels["breakout"])

    def test_crazy_momentum(self):
        levels = self._run(mom=8.0)
        self.assertGreater(levels["target1"], levels["breakout"])
        self.assertGreater(levels["target2"], levels["target1"])
        self.assertLess(levels["stop"], levels["breakout"])

    def test_negative_momentum_uses_floor(self):
        """Negative momentum should use the 2.5% floor."""
        levels = self._run(mom=-0.5)
        self.assertGreater(levels["target1"], levels["breakout"])
        self.assertGreater(levels["target2"], levels["target1"])


class TestBearTargetsBelowBreakout(unittest.TestCase):

    def _run(self, last=400, ma20=410, mom=-0.3):
        return _compute_exec_levels(last=last, ma20=ma20, mom_5d_pct=mom, bias="short")

    def test_low_momentum(self):
        levels = self._run(mom=-0.3)
        self.assertLess(levels["target1"], levels["breakout"])
        self.assertLess(levels["target2"], levels["target1"])
        self.assertGreater(levels["stop"], levels["breakout"])

    def test_moderate_momentum(self):
        levels = self._run(mom=-1.0)
        self.assertLess(levels["target1"], levels["breakout"])
        self.assertLess(levels["target2"], levels["target1"])
        self.assertGreater(levels["stop"], levels["breakout"])

    def test_high_momentum(self):
        levels = self._run(mom=-3.0)
        self.assertLess(levels["target1"], levels["breakout"])
        self.assertLess(levels["target2"], levels["target1"])
        self.assertGreater(levels["stop"], levels["breakout"])

    def test_positive_momentum_uses_floor(self):
        """Positive momentum on bear side should use the 2.5% floor."""
        levels = self._run(mom=0.5)
        self.assertLess(levels["target1"], levels["breakout"])
        self.assertLess(levels["target2"], levels["target1"])


class TestExecLevelsEdgeCases(unittest.TestCase):

    def test_neutral_bias_returns_empty(self):
        levels = _compute_exec_levels(last=400, ma20=390, mom_5d_pct=1.0, bias=None)
        self.assertEqual(levels, {})

    def test_zero_momentum_uses_floor(self):
        levels = _compute_exec_levels(last=400, ma20=390, mom_5d_pct=0.0, bias="long")
        self.assertGreater(levels["target1"], levels["breakout"])
        self.assertGreater(levels["target2"], levels["target1"])

    def test_avgo_example(self):
        """Verify the AVGO numbers that triggered the fix."""
        levels = _compute_exec_levels(last=417, ma20=390, mom_5d_pct=2.5, bias="long")
        self.assertAlmostEqual(levels["breakout"], 423.26, delta=0.1)
        self.assertAlmostEqual(levels["target1"], 428.55, delta=0.1)
        self.assertAlmostEqual(levels["target2"], 433.84, delta=0.1)


if __name__ == "__main__":
    unittest.main()
