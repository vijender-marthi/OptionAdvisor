import unittest
from datetime import datetime
from zoneinfo import ZoneInfo

import pandas as pd

from carry_trade import _closing_location_value, _intraday_structure, is_carry_window


class CarryTradeEngineTests(unittest.TestCase):
    def test_carry_window_active_and_frozen(self):
        pt = ZoneInfo("America/Los_Angeles")
        active, frozen, _ = is_carry_window(datetime(2026, 7, 7, 12, 30, tzinfo=pt))
        self.assertTrue(active)
        self.assertFalse(frozen)

        active, frozen, _ = is_carry_window(datetime(2026, 7, 7, 12, 55, tzinfo=pt))
        self.assertTrue(active)
        self.assertTrue(frozen)

        active, frozen, msg = is_carry_window(datetime(2026, 7, 7, 11, 30, tzinfo=pt))
        self.assertFalse(active)
        self.assertFalse(frozen)
        self.assertIn("final hour", msg)

    def test_clv_uses_full_session_range(self):
        bars = pd.DataFrame(
            {
                "High": [101, 103, 105],
                "Low": [99, 98, 100],
                "Close": [100, 102, 104],
            }
        )
        self.assertAlmostEqual(_closing_location_value(bars), (104 - 98) / (105 - 98), places=4)

    def test_intraday_structure_hh_hl(self):
        bars = pd.DataFrame(
            {
                "High": [100, 101, 102, 103, 104, 105, 106, 107],
                "Low": [98, 99, 100, 101, 102, 103, 104, 105],
                "Close": [99, 100, 101, 102, 103, 104, 105, 106],
            }
        )
        structure, reasons = _intraday_structure(bars)
        self.assertEqual(structure, "HH/HL")
        self.assertTrue(reasons)

    def test_intraday_structure_lh_ll(self):
        bars = pd.DataFrame(
            {
                "High": [107, 106, 105, 104, 103, 102, 101, 100],
                "Low": [105, 104, 103, 102, 101, 100, 99, 98],
                "Close": [106, 105, 104, 103, 102, 101, 100, 99],
            }
        )
        structure, reasons = _intraday_structure(bars)
        self.assertEqual(structure, "LH/LL")
        self.assertTrue(reasons)


if __name__ == "__main__":
    unittest.main()
