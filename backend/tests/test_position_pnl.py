"""Unit tests for calculate_position_pnl and _sanitize_iv."""

import sys
import os
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from command_center_router import calculate_position_pnl, _sanitize_iv


class TestSanitizeIV(unittest.TestCase):
    def test_decimal_iv_passed_through(self):
        self.assertAlmostEqual(_sanitize_iv(0.52), 0.52)

    def test_percentage_iv_divided(self):
        self.assertAlmostEqual(_sanitize_iv(52.0), 0.52)

    def test_zero_iv_falls_back(self):
        iv = _sanitize_iv(0.0)
        self.assertAlmostEqual(iv, 0.50)

    def test_none_iv_falls_back(self):
        iv = _sanitize_iv(None)
        self.assertAlmostEqual(iv, 0.50)

    def test_string_iv_converted(self):
        self.assertAlmostEqual(_sanitize_iv("0.35"), 0.35)

    def test_barely_above_threshold(self):
        self.assertAlmostEqual(_sanitize_iv(0.005), 0.005)


class TestCalculatePositionPnl(unittest.TestCase):

    def test_avgo_long_call(self):
        """AVGO long call: entry 16.06, current 15.50, contracts 3."""
        pos = {
            "ticker": "AVGO", "strategy": "Long Call",
            "contracts": 3, "max_profit": 160.6, "max_loss": 16.06,
            "net_credit": -16.06, "expiry": "2026-05-22",
            "legs": [{
                "action": "BUY", "option_type": "CALL", "strike": 430,
                "mid_price": 16.06, "iv": 0, "expiry": "2026-05-22",
            }],
        }
        marks = {"CALL:430.0": (15.00, 16.00, 15.50)}
        r = calculate_position_pnl(pos, live_option_marks=marks, underlying_price=430.0)
        self.assertEqual(r["entry_premium_per_share"], 16.06)
        self.assertAlmostEqual(r["current_mark_per_share"], 15.50)
        self.assertEqual(r["contracts"], 3)
        self.assertEqual(r["multiplier"], 100)
        self.assertEqual(r["entry_cost_total"], 4818.0)
        self.assertEqual(r["current_value_total"], 4650.0)
        self.assertEqual(r["pnl"], -168.0)
        self.assertAlmostEqual(r["pnl_percent"], -3.49, delta=0.1)
        self.assertEqual(r["max_loss_total"], 4818.0)
        self.assertEqual(r["mark_source"], "live")
        self.assertEqual(r["max_profit_display"], "Unlimited")

    def test_long_call_winner(self):
        """Long call: entry 10, current 20, contracts 2 → +100%."""
        pos = {
            "ticker": "TEST", "strategy": "Long Call",
            "contracts": 2, "max_profit": 80.0, "max_loss": 10.0,
            "net_credit": -10.0, "expiry": "2026-06-19",
            "legs": [{
                "action": "BUY", "option_type": "CALL", "strike": 100,
                "mid_price": 10.0, "iv": 0, "expiry": "2026-06-19",
            }],
        }
        marks = {"CALL:100.0": (19.50, 20.50, 20.00)}
        r = calculate_position_pnl(pos, live_option_marks=marks, underlying_price=110.0)
        self.assertEqual(r["entry_cost_total"], 2000.0)
        self.assertEqual(r["current_value_total"], 4000.0)
        self.assertEqual(r["pnl"], 2000.0)
        self.assertAlmostEqual(r["pnl_percent"], 100.0, delta=0.1)

    def test_long_call_loser(self):
        """Long call: entry 10, current 5, contracts 2 → -50%."""
        pos = {
            "ticker": "TEST", "strategy": "Long Call",
            "contracts": 2, "max_profit": 80.0, "max_loss": 10.0,
            "net_credit": -10.0, "expiry": "2026-06-19",
            "legs": [{
                "action": "BUY", "option_type": "CALL", "strike": 100,
                "mid_price": 10.0, "iv": 0, "expiry": "2026-06-19",
            }],
        }
        marks = {"CALL:100.0": (4.50, 5.50, 5.00)}
        r = calculate_position_pnl(pos, live_option_marks=marks, underlying_price=90.0)
        self.assertEqual(r["pnl"], -1000.0)
        self.assertAlmostEqual(r["pnl_percent"], -50.0, delta=0.1)

    def test_debit_spread(self):
        """Bull Call Spread (debit): net debit 2.49, current spread 2.70, contracts 5."""
        pos = {
            "ticker": "TEST", "strategy": "Bull Call Spread",
            "contracts": 5, "max_profit": 2.51, "max_loss": 2.49,
            "net_credit": -2.49, "expiry": "2026-06-19",
            "legs": [
                {"action": "BUY", "option_type": "CALL", "strike": 150,
                 "mid_price": 3.99, "iv": 0, "expiry": "2026-06-19"},
                {"action": "SELL", "option_type": "CALL", "strike": 155,
                 "mid_price": 1.50, "iv": 0, "expiry": "2026-06-19"},
            ],
        }
        marks = {"CALL:150.0": (4.50, 4.90, 4.70), "CALL:155.0": (1.80, 2.20, 2.00)}
        r = calculate_position_pnl(pos, live_option_marks=marks, underlying_price=152.0)
        self.assertAlmostEqual(r["entry_premium_per_share"], 2.49)
        self.assertAlmostEqual(r["current_mark_per_share"], 2.70)
        self.assertEqual(r["entry_cost_total"], 1245.0)
        self.assertEqual(r["current_value_total"], 1350.0)
        self.assertEqual(r["pnl"], 105.0)
        self.assertAlmostEqual(r["pnl_percent"], 8.43, delta=0.1)

    def test_credit_spread(self):
        """Bear Call Spread (credit): net credit 1.20, current buyback 0.50, contracts 5."""
        pos = {
            "ticker": "TEST", "strategy": "Bear Call Spread",
            "contracts": 5, "max_profit": 1.20, "max_loss": 3.80,
            "net_credit": 1.20, "expiry": "2026-06-19",
            "legs": [
                {"action": "SELL", "option_type": "CALL", "strike": 150,
                 "mid_price": 2.50, "iv": 0, "expiry": "2026-06-19"},
                {"action": "BUY", "option_type": "CALL", "strike": 155,
                 "mid_price": 1.30, "iv": 0, "expiry": "2026-06-19"},
            ],
        }
        marks = {"CALL:150.0": (0.80, 1.20, 1.00), "CALL:155.0": (0.30, 0.70, 0.50)}
        r = calculate_position_pnl(pos, live_option_marks=marks, underlying_price=148.0)
        self.assertAlmostEqual(r["entry_premium_per_share"], -1.20)
        self.assertAlmostEqual(r["current_mark_per_share"], -0.50)
        self.assertEqual(r["entry_cost_total"], -600.0)
        self.assertEqual(r["current_value_total"], -250.0)
        self.assertEqual(r["pnl"], 350.0)
        self.assertAlmostEqual(r["pnl_percent"], 18.42, delta=0.1)

    def test_stock_position(self):
        """Stock: entry 100, current 110, contracts 50 → +500."""
        pos = {
            "ticker": "TEST", "strategy": "Stock",
            "contracts": 50, "entryPrice": 100.0,
        }
        r = calculate_position_pnl(pos, underlying_price=110.0)
        self.assertEqual(r["pnl"], 500.0)
        self.assertEqual(r["entry_cost_total"], 5000.0)
        self.assertEqual(r["current_value_total"], 5500.0)
        self.assertAlmostEqual(r["pnl_percent"], 10.0, delta=0.1)
        self.assertEqual(r["multiplier"], 1)

    def test_short_put(self):
        """Short Put (credit): entry credit 2.38, current mark 2.00, contracts 5."""
        pos = {
            "ticker": "TEST", "strategy": "Short Put",
            "contracts": 5, "max_profit": 2.38, "max_loss": 7.62,
            "net_credit": 2.38, "expiry": "2026-06-19",
            "legs": [{
                "action": "SELL", "option_type": "PUT", "strike": 100,
                "mid_price": 2.38, "iv": 0, "expiry": "2026-06-19",
            }],
        }
        marks = {"PUT:100.0": (1.80, 2.20, 2.00)}
        r = calculate_position_pnl(pos, live_option_marks=marks, underlying_price=102.0)
        self.assertAlmostEqual(r["entry_premium_per_share"], -2.38)
        self.assertAlmostEqual(r["current_mark_per_share"], -2.00)
        self.assertEqual(r["entry_cost_total"], -1190.0)
        self.assertEqual(r["current_value_total"], -1000.0)
        self.assertEqual(r["pnl"], 190.0)
        self.assertAlmostEqual(r["pnl_percent"], 4.99, delta=0.1)

    def test_long_call_no_live_marks_bs_fallback(self):
        """Long call without live marks uses BS fallback with sanitised IV.
        Entry 10, underlying 110, strike 100, IV=0 → uses 0.50 default IV."""
        pos = {
            "ticker": "TEST", "strategy": "Long Call",
            "contracts": 1, "max_profit": 80.0, "max_loss": 10.0,
            "net_credit": -10.0, "expiry": "2026-06-19",
            "legs": [{
                "action": "BUY", "option_type": "CALL", "strike": 100,
                "mid_price": 10.0, "iv": 0, "expiry": "2026-06-19",
            }],
        }
        r = calculate_position_pnl(pos, live_option_marks=None, underlying_price=110.0)
        self.assertEqual(r["mark_source"], "bs_theoretical")
        # BS should produce a positive price for ITM call
        self.assertGreater(r["current_mark_per_share"], 0.0)


if __name__ == "__main__":
    unittest.main()
