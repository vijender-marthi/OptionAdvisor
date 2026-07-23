"""Invariant tests for generic long-position target suggestions."""
import unittest

from stock_decision_engine import _calc_targets


class StockTargetTests(unittest.TestCase):
    def test_targets_never_point_back_below_current_long_price(self) -> None:
        target1, target2 = _calc_targets(
            entry_price=321.13,
            ma20=311.47,
            ma50=305.46,
            current_price=321.13,
        )
        self.assertGreater(target1, 321.13)
        self.assertGreater(target2, target1)

