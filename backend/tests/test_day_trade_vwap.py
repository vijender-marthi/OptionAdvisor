"""Regression: VWAP must stay finite when Yahoo 1m bars include many zero-volume rows."""
from __future__ import annotations

import math
import unittest

import numpy as np
import pandas as pd

from day_trade import ET, _compute_vwap


class TestDayTradeVwap(unittest.TestCase):
    def test_vwap_finite_with_leading_zero_volume_bars(self) -> None:
        ix = pd.date_range("2025-01-02 09:30", periods=40, freq="1min", tz=ET)
        vol = np.array([0] * 15 + [500] * 25, dtype=float)
        df = pd.DataFrame(
            {
                "High": np.linspace(100, 101, 40),
                "Low": np.linspace(99, 100, 40),
                "Close": np.linspace(99.5, 100.5, 40),
                "Volume": vol,
            },
            index=ix,
        )
        v = _compute_vwap(df)
        self.assertFalse(v.isna().any())
        self.assertTrue(math.isfinite(float(v.iloc[-1])))

    def test_vwap_fallback_when_entire_session_zero_volume_uses_typical_path(self) -> None:
        ix = pd.date_range("2025-01-02 09:30", periods=30, freq="1min", tz=ET)
        df = pd.DataFrame(
            {
                "High": np.full(30, 100.25),
                "Low": np.full(30, 99.75),
                "Close": np.full(30, 100.0),
                "Volume": np.zeros(30),
            },
            index=ix,
        )
        v = _compute_vwap(df)
        self.assertFalse(v.isna().any())
        self.assertTrue(math.isfinite(float(v.iloc[-1])))


if __name__ == "__main__":
    unittest.main()
