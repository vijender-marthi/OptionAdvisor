"""Regression coverage for day-trade market-data quality gates."""
from __future__ import annotations

import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd

from day_trade import (
    ET,
    _compute_vwap,
    _ensure_et_index,
    _last_session_rth,
    _merge_historical_live_candles,
    _opening_range_window,
    _validate_session_candles,
    run_day_trade_scan,
)


def _bars(start: str = "2026-07-08 09:30", periods: int = 60, tz=ET) -> pd.DataFrame:
    ix = pd.date_range(start, periods=periods, freq="1min", tz=tz)
    base = np.linspace(100.0, 102.0, periods)
    return pd.DataFrame(
        {
            "Open": base,
            "High": base + 0.25,
            "Low": base - 0.25,
            "Close": base + 0.05,
            "Volume": np.full(periods, 1_000.0),
        },
        index=ix,
    )


class TestDayTradeDataQuality(unittest.TestCase):
    def test_naive_regular_market_timestamps_are_localized_as_et(self) -> None:
        df = _bars(tz=None)
        out = _ensure_et_index(df)
        self.assertEqual(str(out.index.tz), "America/New_York")
        self.assertEqual(out.index[0].hour, 9)
        self.assertEqual(out.index[0].minute, 30)

    def test_utc_timestamps_convert_to_regular_market_open_et(self) -> None:
        df = _bars(start="2026-07-08 13:30", tz="UTC")
        out = _ensure_et_index(df)
        self.assertEqual(out.index[0].hour, 9)
        self.assertEqual(out.index[0].minute, 30)

    def test_naive_utc_like_timestamps_convert_to_regular_market_open_et(self) -> None:
        df = _bars(start="2026-07-08 13:30", periods=390, tz=None)
        out = _ensure_et_index(df)
        self.assertEqual(out.index[0].hour, 9)
        self.assertEqual(out.index[0].minute, 30)

    def test_opening_range_uses_exact_first_15_market_minutes(self) -> None:
        df = _bars(periods=30)
        df = df.drop(df.index[5])
        or_seg, start, end, locked, missing = _opening_range_window(df)
        self.assertEqual(start.hour, 9)
        self.assertEqual(end.hour, 9)
        self.assertEqual(end.minute, 45)
        self.assertTrue(locked)
        self.assertEqual(missing, 1)
        self.assertEqual(len(or_seg), 14)
        self.assertLess(or_seg.index[-1], end)

    def test_no_premarket_leakage_into_last_rth_session(self) -> None:
        pre = _bars(start="2026-07-08 08:00", periods=20)
        rth = _bars(start="2026-07-08 09:30", periods=20)
        session, session_date = _last_session_rth(pd.concat([pre, rth]))
        self.assertEqual(session_date, "2026-07-08")
        self.assertEqual(session.index[0].hour, 9)
        self.assertEqual(session.index[0].minute, 30)
        self.assertTrue((session.index.hour >= 9).all())

    def test_validation_rejects_duplicate_timestamps(self) -> None:
        df = _bars(periods=20)
        dupe = pd.concat([df, df.iloc[[0]]]).sort_index()
        ok, reason, details = _validate_session_candles(dupe)
        self.assertFalse(ok)
        self.assertIn("Duplicate", reason or "")
        self.assertEqual(details["duplicate_timestamps"], 1)

    def test_validation_rejects_negative_volume(self) -> None:
        df = _bars(periods=20)
        df.iloc[3, df.columns.get_loc("Volume")] = -10
        ok, reason, _ = _validate_session_candles(df)
        self.assertFalse(ok)
        self.assertIn("Negative", reason or "")

    def test_validation_rejects_invalid_ohlc(self) -> None:
        df = _bars(periods=20)
        df.iloc[4, df.columns.get_loc("High")] = 90
        ok, reason, _ = _validate_session_candles(df)
        self.assertFalse(ok)
        self.assertIn("high", reason or "")

    def test_vwap_resets_daily_when_last_session_selected(self) -> None:
        day1 = _bars(start="2026-07-07 09:30", periods=20)
        day2 = _bars(start="2026-07-08 09:30", periods=20)
        day2[["Open", "High", "Low", "Close"]] += 50
        session, _ = _last_session_rth(pd.concat([day1, day2]))
        vwap = _compute_vwap(session)
        first_typical = (session["High"].iloc[0] + session["Low"].iloc[0] + session["Close"].iloc[0]) / 3.0
        self.assertAlmostEqual(float(vwap.iloc[0]), float(first_typical), places=6)

    def test_historical_live_merge_overlap_keeps_live_update(self) -> None:
        hist = _bars(periods=5)
        live = hist.iloc[-2:].copy()
        live.iloc[0, live.columns.get_loc("Close")] = 111.0
        merged, forming = _merge_historical_live_candles(hist, live)
        self.assertIsNone(forming)
        self.assertEqual(len(merged), 5)
        self.assertEqual(float(merged.loc[live.index[0], "Close"]), 111.0)

    def test_partial_live_candle_is_separated(self) -> None:
        hist = _bars(periods=5)
        live = _bars(start="2026-07-08 09:35", periods=1)
        now = pd.Timestamp("2026-07-08 09:35:20", tz=ET)
        merged, forming = _merge_historical_live_candles(hist, live, now_et=now)
        self.assertIsNotNone(forming)
        self.assertEqual(len(merged), 5)

    def test_missing_minute_gap_is_allowed_but_logged(self) -> None:
        df = _bars(periods=30).drop(_bars(periods=30).index[10])
        ok, reason, details = _validate_session_candles(df)
        self.assertTrue(ok, reason)
        self.assertEqual(details["opening_range_missing_minutes"], 1)

    def test_stale_intraday_bars_return_data_error_not_trade_verdict(self) -> None:
        df = _bars(start="2026-07-08 09:30", periods=30)
        info = {"longName": "Test Inc", "regularMarketPrice": 125.0}
        with patch("day_trade.bar_cache.get_info", return_value=info), \
             patch("day_trade.bar_cache.get_history", return_value=df), \
             patch("day_trade.bar_cache.was_stale", return_value=True):
            scan = run_day_trade_scan("TEST", force_refresh=True)
        self.assertEqual(scan.verdict, "DATA ERROR")
        self.assertTrue(
            "stale" in scan.metrics["data_quality_error"].lower()
            or "last known" in scan.metrics["data_quality_error"].lower()
        )


if __name__ == "__main__":
    unittest.main()
