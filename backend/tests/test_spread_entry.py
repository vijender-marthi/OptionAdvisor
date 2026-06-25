"""
Tests for _suggest_spread_entry() from swing_trade.py.

Function signature:
    _suggest_spread_entry(
        ticker: str,
        strategy: str,
        exec_levels: dict,
        recommended_contract_duration: str,
    ) -> Optional[dict]

The function calls bar_cache.get_option_dates() and bar_cache.get_option_chain().
These are mocked via unittest.mock.patch.

Return shape (success case):
    {
        "strategy": str,
        "long_leg": str,
        "short_leg": str or None,
        "long_strike": float,
        "short_strike": float or None,
        "expiry": str,
        "est_debit": float,
        "width": float or None,
        "max_gain": float or None,
        "max_loss": float,
        "breakeven": float,
        "entry_note": str,
    }
"""
import unittest
from unittest.mock import patch
from datetime import datetime, timedelta

import pandas as pd

from swing_trade import _suggest_spread_entry


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _future_date(days_out):
    return (datetime.now() + timedelta(days=days_out)).strftime("%Y-%m-%d")


def _make_call_chain():
    return pd.DataFrame({
        "strike": [100.0, 105.0, 110.0, 115.0, 120.0],
        "bid":    [5.0,   3.5,   2.0,   1.0,   0.5],
        "ask":    [5.5,   4.0,   2.5,   1.3,   0.7],
    })


def _make_put_chain():
    return pd.DataFrame({
        "strike": [80.0, 85.0, 90.0, 95.0, 100.0],
        "bid":    [0.5,  1.0,  2.0,  3.5,  5.0],
        "ask":    [0.7,  1.3,  2.5,  4.0,  5.5],
    })


# ---------------------------------------------------------------------------
# Scenarios that should return None
# ---------------------------------------------------------------------------

class TestUnsupportedStrategiesReturnNone(unittest.TestCase):

    def test_iron_condor_returns_none(self):
        levels = {"breakout": 103.0, "target1": 112.0, "stop": 97.0}
        result = _suggest_spread_entry("AAPL", "IRON_CONDOR", levels, "30-45")
        self.assertIsNone(result)

    def test_empty_strategy_returns_none(self):
        levels = {"breakout": 103.0, "target1": 112.0, "stop": 97.0}
        result = _suggest_spread_entry("AAPL", "", levels, "30-45")
        self.assertIsNone(result)

    def test_unknown_strategy_returns_none(self):
        levels = {"breakout": 103.0, "target1": 112.0, "stop": 97.0}
        result = _suggest_spread_entry("AAPL", "SHORT_STRADDLE", levels, "30-45")
        self.assertIsNone(result)


class TestMissingExecLevelsReturnNone(unittest.TestCase):

    def test_missing_breakout_returns_none(self):
        levels = {"target1": 112.0, "stop": 97.0}
        result = _suggest_spread_entry("AAPL", "CALL_DEBIT_SPREAD", levels, "30-45")
        self.assertIsNone(result)

    def test_missing_target1_returns_none(self):
        levels = {"breakout": 103.0, "stop": 97.0}
        result = _suggest_spread_entry("AAPL", "CALL_DEBIT_SPREAD", levels, "30-45")
        self.assertIsNone(result)

    def test_empty_exec_levels_returns_none(self):
        result = _suggest_spread_entry("AAPL", "CALL_DEBIT_SPREAD", {}, "30-45")
        self.assertIsNone(result)


class TestNoOptionDatesReturnNone(unittest.TestCase):

    @patch("swing_trade.bar_cache")
    def test_empty_option_dates_returns_none(self, mock_bc):
        mock_bc.get_option_dates.return_value = []
        levels = {"breakout": 103.0, "target1": 112.0, "stop": 97.0}
        result = _suggest_spread_entry("AAPL", "CALL_DEBIT_SPREAD", levels, "30-45")
        self.assertIsNone(result)

    @patch("swing_trade.bar_cache")
    def test_none_option_dates_returns_none(self, mock_bc):
        mock_bc.get_option_dates.return_value = None
        levels = {"breakout": 103.0, "target1": 112.0, "stop": 97.0}
        result = _suggest_spread_entry("AAPL", "CALL_DEBIT_SPREAD", levels, "30-45")
        self.assertIsNone(result)

    @patch("swing_trade.bar_cache")
    def test_only_expired_dates_returns_none(self, mock_bc):
        # All dates in the past (DTE < 7) → no valid expiry
        past = [(datetime.now() - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(1, 6)]
        mock_bc.get_option_dates.return_value = past
        levels = {"breakout": 103.0, "target1": 112.0, "stop": 97.0}
        result = _suggest_spread_entry("AAPL", "CALL_DEBIT_SPREAD", levels, "30-45")
        self.assertIsNone(result)

    @patch("swing_trade.bar_cache")
    def test_all_near_expiry_dates_under_7_dte_returns_none(self, mock_bc):
        # Within 6 days → filtered out (need dte >= 7)
        near = [_future_date(i) for i in range(1, 7)]
        mock_bc.get_option_dates.return_value = near
        levels = {"breakout": 103.0, "target1": 112.0, "stop": 97.0}
        result = _suggest_spread_entry("AAPL", "CALL_DEBIT_SPREAD", levels, "30-45")
        self.assertIsNone(result)


class TestEmptyChainReturnNone(unittest.TestCase):

    @patch("swing_trade.bar_cache")
    def test_empty_call_chain_returns_none(self, mock_bc):
        mock_bc.get_option_dates.return_value = [_future_date(30)]
        mock_bc.get_option_chain.return_value = (pd.DataFrame(), pd.DataFrame())
        levels = {"breakout": 103.0, "target1": 112.0, "stop": 97.0}
        result = _suggest_spread_entry("AAPL", "CALL_DEBIT_SPREAD", levels, "30-45")
        self.assertIsNone(result)

    @patch("swing_trade.bar_cache")
    def test_none_call_chain_returns_none(self, mock_bc):
        mock_bc.get_option_dates.return_value = [_future_date(30)]
        mock_bc.get_option_chain.return_value = (None, None)
        levels = {"breakout": 103.0, "target1": 112.0, "stop": 97.0}
        result = _suggest_spread_entry("AAPL", "CALL_DEBIT_SPREAD", levels, "30-45")
        self.assertIsNone(result)

    @patch("swing_trade.bar_cache")
    def test_chain_with_zero_ask_returns_none(self, mock_bc):
        """When the only available strike has ask=0, long_mid is None → return None."""
        mock_bc.get_option_dates.return_value = [_future_date(30)]
        chain = pd.DataFrame({
            "strike": [110.0],
            "bid":    [0.0],
            "ask":    [0.0],  # ask=0 → get_mid returns None
        })
        mock_bc.get_option_chain.return_value = (chain, chain)
        levels = {"breakout": 103.0, "target1": 112.0, "stop": 97.0}
        result = _suggest_spread_entry("AAPL", "CALL_DEBIT_SPREAD", levels, "30-45")
        self.assertIsNone(result)


# ---------------------------------------------------------------------------
# CALL_DEBIT_SPREAD success cases
# ---------------------------------------------------------------------------

class TestCallDebitSpreadSuccess(unittest.TestCase):

    def setUp(self):
        self.opt_dates = [
            _future_date(15),
            _future_date(30),
            _future_date(45),
            _future_date(60),
        ]
        self.call_chain = _make_call_chain()
        self.levels = {"breakout": 103.0, "target1": 112.0, "stop": 97.0}

    @patch("swing_trade.bar_cache")
    def test_call_debit_spread_returns_correct_strategy_name(self, mock_bc):
        mock_bc.get_option_dates.return_value = self.opt_dates
        mock_bc.get_option_chain.return_value = (self.call_chain, pd.DataFrame())
        result = _suggest_spread_entry("AAPL", "CALL_DEBIT_SPREAD", self.levels, "30-45")
        self.assertIsNotNone(result)
        self.assertEqual(result["strategy"], "CALL DEBIT SPREAD")

    @patch("swing_trade.bar_cache")
    def test_long_strike_at_or_above_breakout(self, mock_bc):
        mock_bc.get_option_dates.return_value = self.opt_dates
        mock_bc.get_option_chain.return_value = (self.call_chain, pd.DataFrame())
        result = _suggest_spread_entry("AAPL", "CALL_DEBIT_SPREAD", self.levels, "30-45")
        self.assertIsNotNone(result)
        self.assertGreaterEqual(result["long_strike"], self.levels["breakout"])

    @patch("swing_trade.bar_cache")
    def test_short_strike_at_or_below_target1(self, mock_bc):
        mock_bc.get_option_dates.return_value = self.opt_dates
        mock_bc.get_option_chain.return_value = (self.call_chain, pd.DataFrame())
        result = _suggest_spread_entry("AAPL", "CALL_DEBIT_SPREAD", self.levels, "30-45")
        self.assertIsNotNone(result)
        self.assertLess(result["long_strike"], result["short_strike"])

    @patch("swing_trade.bar_cache")
    def test_call_debit_spread_uses_next_short_strike_when_target_matches_long(self, mock_bc):
        mock_bc.get_option_dates.return_value = self.opt_dates
        mock_bc.get_option_chain.return_value = (self.call_chain, pd.DataFrame())
        levels = {"breakout": 103.0, "target1": 105.0, "stop": 97.0}
        result = _suggest_spread_entry("AAPL", "CALL_DEBIT_SPREAD", levels, "30-45")
        self.assertIsNotNone(result)
        self.assertEqual(result["long_strike"], 105.0)
        self.assertEqual(result["short_strike"], 110.0)
        self.assertLess(result["long_strike"], result["short_strike"])

    @patch("swing_trade.bar_cache")
    def test_est_debit_equals_long_mid_minus_short_mid(self, mock_bc):
        mock_bc.get_option_dates.return_value = self.opt_dates
        mock_bc.get_option_chain.return_value = (self.call_chain, pd.DataFrame())
        result = _suggest_spread_entry("AAPL", "CALL_DEBIT_SPREAD", self.levels, "30-45")
        self.assertIsNotNone(result)
        # breakeven = long_strike + est_debit
        expected_breakeven = round(result["long_strike"] + result["est_debit"], 2)
        self.assertAlmostEqual(result["breakeven"], expected_breakeven, places=2)

    @patch("swing_trade.bar_cache")
    def test_max_gain_equals_width_minus_debit_times_100(self, mock_bc):
        mock_bc.get_option_dates.return_value = self.opt_dates
        mock_bc.get_option_chain.return_value = (self.call_chain, pd.DataFrame())
        result = _suggest_spread_entry("AAPL", "CALL_DEBIT_SPREAD", self.levels, "30-45")
        self.assertIsNotNone(result)
        expected_max_gain = round((result["width"] - result["est_debit"]) * 100, 2)
        self.assertAlmostEqual(result["max_gain"], expected_max_gain, places=2)

    @patch("swing_trade.bar_cache")
    def test_max_loss_equals_debit_times_100(self, mock_bc):
        mock_bc.get_option_dates.return_value = self.opt_dates
        mock_bc.get_option_chain.return_value = (self.call_chain, pd.DataFrame())
        result = _suggest_spread_entry("AAPL", "CALL_DEBIT_SPREAD", self.levels, "30-45")
        self.assertIsNotNone(result)
        expected_max_loss = round(result["est_debit"] * 100, 2)
        self.assertAlmostEqual(result["max_loss"], expected_max_loss, places=2)

    @patch("swing_trade.bar_cache")
    def test_entry_note_contains_breakout_price(self, mock_bc):
        mock_bc.get_option_dates.return_value = self.opt_dates
        mock_bc.get_option_chain.return_value = (self.call_chain, pd.DataFrame())
        result = _suggest_spread_entry("AAPL", "CALL_DEBIT_SPREAD", self.levels, "30-45")
        self.assertIsNotNone(result)
        self.assertIn(str(self.levels["breakout"]), result["entry_note"])

    @patch("swing_trade.bar_cache")
    def test_result_has_all_required_keys(self, mock_bc):
        mock_bc.get_option_dates.return_value = self.opt_dates
        mock_bc.get_option_chain.return_value = (self.call_chain, pd.DataFrame())
        result = _suggest_spread_entry("AAPL", "CALL_DEBIT_SPREAD", self.levels, "30-45")
        self.assertIsNotNone(result)
        required_keys = [
            "strategy", "long_leg", "short_leg", "long_strike", "short_strike",
            "expiry", "est_debit", "width", "max_gain", "max_loss", "breakeven", "entry_note",
        ]
        for key in required_keys:
            self.assertIn(key, result)


# ---------------------------------------------------------------------------
# PUT_DEBIT_SPREAD success cases
# ---------------------------------------------------------------------------

class TestPutDebitSpreadSuccess(unittest.TestCase):

    def setUp(self):
        self.opt_dates = [_future_date(30), _future_date(45)]
        self.put_chain = _make_put_chain()
        self.levels = {"breakout": 92.0, "target1": 83.0, "stop": 97.0}

    @patch("swing_trade.bar_cache")
    def test_put_debit_spread_returns_correct_strategy_name(self, mock_bc):
        mock_bc.get_option_dates.return_value = self.opt_dates
        mock_bc.get_option_chain.return_value = (pd.DataFrame(), self.put_chain)
        result = _suggest_spread_entry("SPY", "PUT_DEBIT_SPREAD", self.levels, "30-45")
        self.assertIsNotNone(result)
        self.assertEqual(result["strategy"], "PUT DEBIT SPREAD")

    @patch("swing_trade.bar_cache")
    def test_put_long_strike_at_or_below_breakout(self, mock_bc):
        mock_bc.get_option_dates.return_value = self.opt_dates
        mock_bc.get_option_chain.return_value = (pd.DataFrame(), self.put_chain)
        result = _suggest_spread_entry("SPY", "PUT_DEBIT_SPREAD", self.levels, "30-45")
        self.assertIsNotNone(result)
        self.assertLessEqual(result["long_strike"], self.levels["breakout"])

    @patch("swing_trade.bar_cache")
    def test_put_long_strike_greater_than_short_strike(self, mock_bc):
        mock_bc.get_option_dates.return_value = self.opt_dates
        mock_bc.get_option_chain.return_value = (pd.DataFrame(), self.put_chain)
        result = _suggest_spread_entry("SPY", "PUT_DEBIT_SPREAD", self.levels, "30-45")
        self.assertIsNotNone(result)
        self.assertGreater(result["long_strike"], result["short_strike"])

    @patch("swing_trade.bar_cache")
    def test_put_debit_spread_uses_next_short_strike_when_target_matches_long(self, mock_bc):
        mock_bc.get_option_dates.return_value = self.opt_dates
        mock_bc.get_option_chain.return_value = (pd.DataFrame(), self.put_chain)
        levels = {"breakout": 92.0, "target1": 90.0, "stop": 97.0}
        result = _suggest_spread_entry("SPY", "PUT_DEBIT_SPREAD", levels, "30-45")
        self.assertIsNotNone(result)
        self.assertEqual(result["long_strike"], 90.0)
        self.assertEqual(result["short_strike"], 85.0)
        self.assertGreater(result["long_strike"], result["short_strike"])

    @patch("swing_trade.bar_cache")
    def test_put_breakeven_equals_long_strike_minus_debit(self, mock_bc):
        mock_bc.get_option_dates.return_value = self.opt_dates
        mock_bc.get_option_chain.return_value = (pd.DataFrame(), self.put_chain)
        result = _suggest_spread_entry("SPY", "PUT_DEBIT_SPREAD", self.levels, "30-45")
        self.assertIsNotNone(result)
        expected_be = round(result["long_strike"] - result["est_debit"], 2)
        self.assertAlmostEqual(result["breakeven"], expected_be, places=2)

    @patch("swing_trade.bar_cache")
    def test_put_entry_note_contains_breakout_price(self, mock_bc):
        mock_bc.get_option_dates.return_value = self.opt_dates
        mock_bc.get_option_chain.return_value = (pd.DataFrame(), self.put_chain)
        result = _suggest_spread_entry("SPY", "PUT_DEBIT_SPREAD", self.levels, "30-45")
        self.assertIsNotNone(result)
        self.assertIn(str(self.levels["breakout"]), result["entry_note"])


# ---------------------------------------------------------------------------
# LONG_CALL success cases
# ---------------------------------------------------------------------------

class TestLongCallSuccess(unittest.TestCase):

    def setUp(self):
        self.opt_dates = [_future_date(30), _future_date(45)]
        self.call_chain = _make_call_chain()
        self.levels = {"breakout": 103.0, "target1": 115.0, "stop": 97.0}

    @patch("swing_trade.bar_cache")
    def test_long_call_returns_correct_strategy_name(self, mock_bc):
        mock_bc.get_option_dates.return_value = self.opt_dates
        mock_bc.get_option_chain.return_value = (self.call_chain, pd.DataFrame())
        result = _suggest_spread_entry("AAPL", "LONG_CALL", self.levels, "30-45")
        self.assertIsNotNone(result)
        self.assertEqual(result["strategy"], "LONG CALL")

    @patch("swing_trade.bar_cache")
    def test_long_call_short_leg_is_none(self, mock_bc):
        mock_bc.get_option_dates.return_value = self.opt_dates
        mock_bc.get_option_chain.return_value = (self.call_chain, pd.DataFrame())
        result = _suggest_spread_entry("AAPL", "LONG_CALL", self.levels, "30-45")
        self.assertIsNotNone(result)
        self.assertIsNone(result["short_leg"])

    @patch("swing_trade.bar_cache")
    def test_long_call_breakeven_equals_strike_plus_debit(self, mock_bc):
        mock_bc.get_option_dates.return_value = self.opt_dates
        mock_bc.get_option_chain.return_value = (self.call_chain, pd.DataFrame())
        result = _suggest_spread_entry("AAPL", "LONG_CALL", self.levels, "30-45")
        self.assertIsNotNone(result)
        expected_be = round(result["long_strike"] + result["est_debit"], 2)
        self.assertAlmostEqual(result["breakeven"], expected_be, places=2)

    @patch("swing_trade.bar_cache")
    def test_long_call_max_gain_is_none(self, mock_bc):
        mock_bc.get_option_dates.return_value = self.opt_dates
        mock_bc.get_option_chain.return_value = (self.call_chain, pd.DataFrame())
        result = _suggest_spread_entry("AAPL", "LONG_CALL", self.levels, "30-45")
        self.assertIsNotNone(result)
        self.assertIsNone(result["max_gain"])


# ---------------------------------------------------------------------------
# DTE selection tests
# ---------------------------------------------------------------------------

class TestDTESelection(unittest.TestCase):

    def _run(self, opt_dates, duration, mock_bc):
        chain = _make_call_chain()
        mock_bc.get_option_dates.return_value = opt_dates
        mock_bc.get_option_chain.return_value = (chain, pd.DataFrame())
        levels = {"breakout": 103.0, "target1": 112.0, "stop": 97.0}
        return _suggest_spread_entry("AAPL", "CALL_DEBIT_SPREAD", levels, duration)

    @patch("swing_trade.bar_cache")
    def test_21_42_duration_picks_expiry_nearest_31_days(self, mock_bc):
        # target_dte = (21+42)//2 = 31; nearest should be the 30-day expiry
        opt_dates = [_future_date(15), _future_date(30), _future_date(60)]
        result = self._run(opt_dates, "21-42", mock_bc)
        self.assertIsNotNone(result)
        # 30-day expiry is closest to DTE=31
        expected_expiry = _future_date(30)
        self.assertEqual(result["expiry"], expected_expiry)

    @patch("swing_trade.bar_cache")
    def test_single_value_duration_uses_that_as_target_dte(self, mock_bc):
        # "14" → target_dte=14
        opt_dates = [_future_date(14), _future_date(30), _future_date(45)]
        result = self._run(opt_dates, "14", mock_bc)
        self.assertIsNotNone(result)
        # 14-day expiry is exact match
        expected_expiry = _future_date(14)
        self.assertEqual(result["expiry"], expected_expiry)

    @patch("swing_trade.bar_cache")
    def test_empty_duration_uses_default_dte_35(self, mock_bc):
        # default target_dte=35; nearest is 30 vs 45
        opt_dates = [_future_date(30), _future_date(45)]
        result = self._run(opt_dates, "", mock_bc)
        self.assertIsNotNone(result)
        # |30-35|=5, |45-35|=10 → 30-day is closer
        expected_expiry = _future_date(30)
        self.assertEqual(result["expiry"], expected_expiry)


if __name__ == "__main__":
    unittest.main()
