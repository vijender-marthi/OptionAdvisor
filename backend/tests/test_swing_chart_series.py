"""Unit tests for swing trade chart payload serialization (no Yahoo calls)."""
from __future__ import annotations

import os
import sys
import unittest

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from analysis import build_hv_series
from swing_trade import build_swing_chart_series, build_swing_chart_timeframe_series, _rsi, _sma, MA_FAST, MA_SLOW

SWING_CHART_MAX_POINTS = 130


class SwingChartSeriesTests(unittest.TestCase):
    def test_caps_length(self) -> None:
        n = 200
        idx = pd.date_range("2024-01-01", periods=n, freq="B")
        close = pd.Series(np.linspace(100.0, 130.0, n), index=idx)
        ma20 = _sma(close, MA_FAST)
        ma50 = _sma(close, MA_SLOW)
        rsi = _rsi(close)
        raw = pd.DataFrame({"Close": close}, index=idx)
        hv = build_hv_series(raw, 20)
        out = build_swing_chart_series(
            close, ma20, ma50, rsi, hv, max_points=SWING_CHART_MAX_POINTS
        )
        self.assertEqual(out["count"], SWING_CHART_MAX_POINTS)
        self.assertEqual(len(out["points"]), SWING_CHART_MAX_POINTS)
        last = out["points"][-1]
        self.assertEqual(last["d"], str(idx[-1].date()))
        self.assertEqual(last["c"], round(float(close.iloc[-1]), 4))
        self.assertEqual(last["rsi"], round(float(rsi.iloc[-1]), 2))
        self.assertIsNotNone(last["ma20"])
        self.assertIsNotNone(last["ma50"])

    def test_reindexes_hv_to_close(self) -> None:
        n = 80
        idx = pd.date_range("2024-06-01", periods=n, freq="B")
        rng = np.random.default_rng(0)
        close = pd.Series(100.0 + np.cumsum(rng.normal(0, 0.5, n)), index=idx)
        ma20 = _sma(close, MA_FAST)
        ma50 = _sma(close, MA_SLOW)
        rsi = _rsi(close)
        raw = pd.DataFrame({"Close": close}, index=idx)
        hv = build_hv_series(raw, 20)
        out_all = build_swing_chart_series(close, ma20, ma50, rsi, hv, max_points=80)
        self.assertIsNone(out_all["points"][0]["hv20"])
        out = build_swing_chart_series(close, ma20, ma50, rsi, hv, max_points=60)
        self.assertEqual(out["count"], 60)
        self.assertIsNotNone(out["points"][-1]["hv20"])

    def test_aggregates_backend_weekly_and_monthly_timeframes(self) -> None:
        idx = pd.date_range("2024-01-01", periods=320, freq="B")
        raw = pd.DataFrame({
            "Close": np.linspace(100.0, 160.0, len(idx)),
            "Volume": np.full(len(idx), 1_000_000.0),
        }, index=idx)

        weekly = build_swing_chart_timeframe_series(raw, "Weekly")
        monthly = build_swing_chart_timeframe_series(raw, "Monthly")

        self.assertEqual(weekly["timeframe"], "Weekly")
        self.assertEqual(monthly["timeframe"], "Monthly")
        self.assertGreater(weekly["count"], monthly["count"])
        self.assertEqual(weekly["points"][-1]["c"], 160.0)
        self.assertEqual(monthly["points"][-1]["c"], 160.0)


if __name__ == "__main__":
    unittest.main()
