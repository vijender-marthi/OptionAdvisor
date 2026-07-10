import unittest

from day_trade import build_day_decision_table_row


class DayDecisionTableTests(unittest.TestCase):
    def test_call_requires_no_blockers_bull_vwap_above_hhhl_spy_bull(self):
        row = build_day_decision_table_row(
            ticker="AAPL",
            price=112,
            change_pct=2.1,
            or_high=110,
            or_low=100,
            vwap=105.3,
            rvol=1.2,
            atr_used_pct=65,
            spy_session_pct=0.4,
            structure_5m="HH/HL",
        )
        self.assertEqual(row["vwap_bias"], "bull")
        self.assertEqual(row["loc"], "above ORH")
        self.assertEqual(row["verdict"], "CALL")
        self.assertEqual(row["levels"]["entry"], 110)
        self.assertEqual(row["levels"]["stop"], 105)
        self.assertEqual(row["lifecycle"], "TRIGGERED")
        self.assertEqual(row["trade_lifecycle"]["label"], "CALL TRIGGERED")
        self.assertIn("CALL TRIGGERED", row["notification"])
        self.assertNotIn("armed", row["notification"].lower())

    def test_put_requires_no_blockers_bear_vwap_below_lhll_spy_bear(self):
        row = build_day_decision_table_row(
            ticker="TSLA",
            price=98,
            change_pct=-2.4,
            or_high=110,
            or_low=100,
            vwap=104.7,
            rvol=1.1,
            atr_used_pct=70,
            spy_session_pct=-0.3,
            structure_5m="LH/LL",
        )
        self.assertEqual(row["vwap_bias"], "bear")
        self.assertEqual(row["loc"], "below ORL")
        self.assertEqual(row["verdict"], "PUT")
        self.assertEqual(row["levels"]["entry"], 100)
        self.assertEqual(row["levels"]["stop"], 105)

    def test_any_blocker_forces_wait_and_lists_clear_condition(self):
        row = build_day_decision_table_row(
            ticker="MRVL",
            price=126,
            change_pct=6.0,
            or_high=110,
            or_low=100,
            vwap=106,
            rvol=0.6,
            atr_used_pct=125,
            spy_session_pct=0.5,
            structure_5m="HH/HL",
        )
        self.assertEqual(row["verdict"], "WAIT")
        self.assertIn("ATR > 120%", row["blockers"])
        self.assertIn("RVOL < 0.7x", row["blockers"])
        self.assertIn("EXTENDED", row["blockers"])
        self.assertTrue(row["arm_trigger"].startswith("Clear blockers"))

    def test_inside_bull_bias_arms_call_trigger(self):
        row = build_day_decision_table_row(
            ticker="GOOG",
            price=106,
            change_pct=0.5,
            or_high=110,
            or_low=100,
            vwap=106,
            rvol=1.0,
            atr_used_pct=40,
            spy_session_pct=0.2,
            structure_5m="HH/HL",
        )
        self.assertEqual(row["verdict"], "WAIT")
        self.assertEqual(row["loc"], "inside")
        self.assertEqual(row["lifecycle"], "ARMED")
        self.assertEqual(row["trade_lifecycle"]["label"], "CALL ARMED")
        self.assertIn("5m close above", row["arm_trigger"])


if __name__ == "__main__":
    unittest.main()
