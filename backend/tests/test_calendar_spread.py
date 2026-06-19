"""
Tests for the calendar (horizontal) spread builder in engine.py.
"""
import os
import sys
import unittest
from datetime import date, timedelta

import pandas as pd

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import engine
from analysis import MarketSignals


def _future(days: int) -> str:
    return (date.today() + timedelta(days=days)).isoformat()


def _chain(spot=100.0):
    """Two-expiry ATM-centered call chain; longer expiry priced higher (more time value)."""
    front, back = _future(14), _future(45)
    rows = []
    for exp, base in ((front, 2.0), (back, 3.6)):  # back mid > front mid
        for k in (95, 100, 105):
            # widen price slightly for ATM
            mid = base if k == 100 else base * 0.6
            rows.append({
                "strike": float(k), "expiration": exp,
                "bid": mid - 0.05, "ask": mid + 0.05, "lastPrice": mid,
                "impliedVolatility": 0.30, "openInterest": 500, "volume": 200,
            })
    return pd.DataFrame(rows), front, back


def _signals(iv_rank=30.0):
    # Build a minimal MarketSignals; only attributes the builder reads need to be valid.
    try:
        return MarketSignals(iv_rank=iv_rank, iv_environment="Low IV")  # type: ignore[call-arg]
    except TypeError:
        s = MarketSignals.__new__(MarketSignals)
        s.iv_rank = iv_rank
        s.iv_environment = "Low IV"
        return s


class TestBSPrice(unittest.TestCase):
    def test_atm_call_positive(self):
        p = engine._bs_price(100, 100, 30 / 365, 0.30, "CALL")
        self.assertGreater(p, 0)

    def test_zero_time_zero(self):
        self.assertEqual(engine._bs_price(100, 100, 0, 0.30, "CALL"), 0.0)


class TestCalendarBuilder(unittest.TestCase):
    def test_builds_valid_calendar(self):
        chain, front, back = _chain(100.0)
        t = engine._build_calendar_spread(_signals(), chain, front, back, 100.0, "CALL")
        self.assertIsNotNone(t, "calendar should build from a valid two-expiry chain")
        self.assertEqual(t["strategy"], "Call Calendar Spread")
        self.assertEqual(t["bias"], "Neutral")
        self.assertLess(t["net_credit"], 0, "calendar is a net debit (net_credit negative)")
        self.assertGreater(t["max_profit"], 0)
        self.assertEqual(len(t["legs"]), 2)
        # legs span two distinct expiries
        self.assertNotEqual(t["legs"][0].expiry, t["legs"][1].expiry)

    def test_breakevens_bracket_strike(self):
        chain, front, back = _chain(100.0)
        t = engine._build_calendar_spread(_signals(), chain, front, back, 100.0, "CALL")
        self.assertLessEqual(t["breakeven_lower"], 100.0)
        self.assertGreaterEqual(t["breakeven_upper"], 100.0)

    def test_pop_in_range(self):
        chain, front, back = _chain(100.0)
        t = engine._build_calendar_spread(_signals(), chain, front, back, 100.0, "CALL")
        self.assertGreaterEqual(t["prob_of_profit"], 0.0)
        self.assertLessEqual(t["prob_of_profit"], 1.0)

    def test_rejects_when_back_not_later_than_front(self):
        # Swap so the "back" expiry is earlier than the front → invalid calendar.
        chain, front, back = _chain(100.0)
        t = engine._build_calendar_spread(_signals(), chain, back, front, 100.0, "CALL")
        self.assertIsNone(t)

    def test_rejects_missing_expiration_column(self):
        chain, front, back = _chain(100.0)
        t = engine._build_calendar_spread(_signals(), chain.drop(columns=["expiration"]), front, back, 100.0, "CALL")
        self.assertIsNone(t)


if __name__ == "__main__":
    unittest.main()
