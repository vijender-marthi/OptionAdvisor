import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from main import _infer_atm_strike, _parse_trade_intent


class TestDayTradeTradeCheck(unittest.TestCase):
    def test_next_week_call_without_strike_parses_to_actionable_intent(self):
        parsed = _parse_trade_intent("MRVL next week CALL. buy now? is it valid?")

        self.assertEqual(parsed["ticker"], "MRVL")
        self.assertEqual(parsed["option_type"], "call")
        self.assertEqual(parsed["dte"], 7)
        self.assertEqual(parsed["strike"], 0.0)
        self.assertEqual(parsed["contracts"], 1)
        self.assertTrue(any("next week" in note for note in parsed["parse_notes"]))

    def test_atm_strike_inference_uses_listed_step(self):
        self.assertEqual(_infer_atm_strike(83.21, "call"), 85.0)
        self.assertEqual(_infer_atm_strike(83.21, "put"), 82.5)
        self.assertEqual(_infer_atm_strike(18.72, "call"), 19.0)
        self.assertEqual(_infer_atm_strike(501.12, "call"), 505.0)


if __name__ == "__main__":
    unittest.main()
