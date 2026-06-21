"""
Tests for exit_monitor: gathering held positions from both sources and scanning.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import exit_monitor
import storage


class TestHeldPositions(unittest.TestCase):
    def setUp(self):
        self._orig_active_today = storage.list_active_trades_open_opened_today_et
        self._orig_state = storage.get_user_state

    def tearDown(self):
        storage.list_active_trades_open_opened_today_et = self._orig_active_today
        storage.get_user_state = self._orig_state

    def test_active_trade_call_is_long_put_is_short(self):
        storage.list_active_trades_open_opened_today_et = lambda e: [
            {"ticker": "ARM", "side": "CALL", "entry_price": 2.0, "entry_underlying_px": 100.0,
             "contracts": 2, "opened_at_ms": 1_700_000_000_000, "stop": 98.0},
            {"ticker": "MRVL", "side": "PUT", "entry_price": 7.0, "entry_underlying_px": 318.0,
             "contracts": 1, "opened_at_ms": 1_700_000_000_000},
        ]
        storage.get_user_state = lambda e: {"portfolio": []}
        held = exit_monitor.held_positions_for_user("a@b.com")
        self.assertEqual(len(held), 2)
        arm = next(h for h in held if h.ticker == "ARM")
        mrvl = next(h for h in held if h.ticker == "MRVL")
        self.assertEqual(arm.direction, "long")
        self.assertEqual(arm.entry_price, 100.0)
        self.assertEqual(arm.stop_price, 98.0)
        self.assertEqual(mrvl.direction, "short")
        self.assertEqual(mrvl.entry_price, 318.0)

    def test_portfolio_only_open_day_positions(self):
        storage.list_active_trades_open_opened_today_et = lambda e: []
        storage.get_user_state = lambda e: {"portfolio": [
            {"ticker": "AMD", "status": "open", "source": "day", "bias": "bullish",
             "strategy": "Long Call", "entryPrice": 150.0, "stopLoss": 147.0, "contracts": 3},
            {"ticker": "NVDA", "status": "open", "source": "swing", "bias": "bullish", "entryPrice": 120.0},
            {"ticker": "TSLA", "status": "closed", "source": "day", "bias": "bearish", "entryPrice": 250.0},
            {"ticker": "INTC", "status": "open", "source": "day", "bias": "bearish",
             "strategy": "Long Put", "entryPrice": 40.0, "stopLoss": 41.0},
        ]}
        held = exit_monitor.held_positions_for_user("a@b.com")
        tickers = {h.ticker for h in held}
        self.assertEqual(tickers, {"AMD", "INTC", "NVDA"})  # closed excluded; swing now included
        amd = next(h for h in held if h.ticker == "AMD")
        intc = next(h for h in held if h.ticker == "INTC")
        nvda = next(h for h in held if h.ticker == "NVDA")
        self.assertEqual(amd.direction, "long")
        self.assertEqual(intc.direction, "short")
        self.assertEqual(amd.stop_price, 147.0)
        self.assertEqual(amd.position_type, "day")
        self.assertEqual(nvda.position_type, "swing")

    def test_scan_fires_vwap_break_for_held_long(self):
        storage.list_active_trades_open_opened_today_et = lambda e: [
            {"ticker": "MRVL", "side": "CALL", "entry_price": 2.0, "entry_underlying_px": 100.0,
             "contracts": 1, "opened_at_ms": 1_700_000_000_000, "stop": 96.0},
        ]
        storage.get_user_state = lambda e: {"portfolio": []}

        def fake_snapshot(tk):
            return {"metrics": {"last_price": 99.0, "vwap": 99.6, "or_high": 101, "or_low": 98,
                                "candles_5m_tail": [{"close": 99.4}, {"close": 99.1}]}}

        sigs = exit_monitor.scan_exit_signals_for_user("a@b.com", snapshot_fn=fake_snapshot)
        codes = {s.code for s in sigs}
        self.assertIn("VWAP_BREAK", codes)
        self.assertTrue(any(s.severity == "critical" for s in sigs))

    def test_scan_empty_when_no_positions(self):
        storage.list_active_trades_open_opened_today_et = lambda e: []
        storage.get_user_state = lambda e: {"portfolio": []}
        self.assertEqual(exit_monitor.scan_exit_signals_for_user("a@b.com", snapshot_fn=lambda t: {}), [])

    def test_snapshot_failure_skips_ticker(self):
        storage.list_active_trades_open_opened_today_et = lambda e: [
            {"ticker": "BAD", "side": "CALL", "entry_price": 1.0, "entry_underlying_px": 10.0,
             "contracts": 1, "opened_at_ms": 1_700_000_000_000},
        ]
        storage.get_user_state = lambda e: {"portfolio": []}

        def boom(tk):
            raise RuntimeError("no data")

        self.assertEqual(exit_monitor.scan_exit_signals_for_user("a@b.com", snapshot_fn=boom), [])


if __name__ == "__main__":
    unittest.main()
