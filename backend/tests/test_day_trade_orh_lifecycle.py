import unittest

import pandas as pd

from day_trade import OR_MINUTES, _build_orh_breakout_lifecycle


def _session(post_bars):
    rows = []
    idx = pd.date_range("2026-06-26 09:30", periods=OR_MINUTES + len(post_bars), freq="1min", tz="America/New_York")
    for _ in range(OR_MINUTES):
        rows.append({"Open": 99.0, "High": 100.0, "Low": 98.0, "Close": 99.2, "Volume": 1000})
    rows.extend(post_bars)
    return pd.DataFrame(rows, index=idx)


def _bar(o, h, l, c, v=1600):
    return {"Open": o, "High": h, "Low": l, "Close": c, "Volume": v}


def _life(post_bars):
    session = _session(post_bars)
    vwap = pd.Series([99.0] * len(session), index=session.index)
    return _build_orh_breakout_lifecycle(
        session,
        or_high=100.0,
        or_low=98.0,
        vwap_ser=vwap,
        avg_vol=1000.0,
        bias="long",
        rvol=1.2,
        vwap_upper1=102.0,
        vwap_upper2=104.0,
        session_minutes_elapsed=OR_MINUTES + len(post_bars),
    )


class TestOrhBreakoutLifecycle(unittest.TestCase):
    def test_wick_touch_waits_for_close_confirmation(self):
        state = _life([_bar(99.8, 100.2, 99.6, 99.95)])
        self.assertEqual(state["state"], "WATCHING_BREAKOUT")
        self.assertEqual(state["action"], "WAIT")
        self.assertIsNone(state["signal"])
        self.assertIn("waiting for candle close", state["status_message"])

    def test_first_close_above_orh_waits_for_next_candle(self):
        state = _life([_bar(99.9, 100.4, 99.8, 100.2)])
        self.assertEqual(state["state"], "BREAKOUT_CONFIRMED")
        self.assertEqual(state["action"], "WAIT")
        self.assertIsNone(state["signal"])
        self.assertIn("need hold/continuation", state["status_message"])

    def test_second_confirmation_candle_emits_e2(self):
        state = _life([
            _bar(99.9, 100.4, 99.8, 100.2),
            _bar(100.2, 100.7, 100.1, 100.55),
        ])
        self.assertEqual(state["signal"], "E2")
        self.assertEqual(state["signal_label"], "ORH Breakout")
        self.assertEqual(state["action"], "GO_LONG")

    def test_failed_breakout_requires_reset_before_reentry(self):
        state = _life([
            _bar(99.9, 100.4, 99.8, 100.2),
            _bar(100.2, 100.7, 100.1, 100.55),
            _bar(100.5, 100.6, 99.7, 99.8),
            _bar(99.8, 99.9, 99.2, 99.4),
            _bar(99.4, 99.8, 99.1, 99.6),
            _bar(99.6, 99.9, 99.3, 99.7),
        ])
        self.assertEqual(state["state"], "READY_FOR_REENTRY")
        self.assertEqual(state["action"], "WATCH")
        self.assertIsNone(state["signal"])

    def test_reclaim_after_reset_emits_e2r(self):
        state = _life([
            _bar(99.9, 100.4, 99.8, 100.2),
            _bar(100.2, 100.7, 100.1, 100.55),
            _bar(100.5, 100.6, 99.7, 99.8),
            _bar(99.8, 99.9, 99.2, 99.4),
            _bar(99.4, 99.8, 99.1, 99.6),
            _bar(99.6, 99.9, 99.3, 99.7),
            _bar(99.7, 100.3, 99.55, 100.15),
            _bar(100.15, 100.65, 100.05, 100.5),
        ])
        self.assertEqual(state["state"], "REENTRY_CONFIRMED")
        self.assertEqual(state["signal"], "E2R")
        self.assertEqual(state["signal_label"], "ORH Re-breakout")
        self.assertEqual(state["action"], "GO_LONG")


if __name__ == "__main__":
    unittest.main()
