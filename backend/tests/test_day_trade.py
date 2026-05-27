"""
Unit tests for the day trade engine.
"""
from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

import numpy as np
import pandas as pd

from day_trade import (
    _compute_vwap_bands,
    _volume_profile,
    _finite_price,
    clear_scan_cache,
)


def _norm_verdict(raw: str) -> str:
    v = raw.upper().strip()
    if v in ("STRONG GO", "GO", "WATCH", "NO-GO", "WAIT"):
        return v
    if v == "NO GO":
        return "NO-GO"
    return "WAIT"


class TestVWAPBands(unittest.TestCase):
    """VWAP band calculation on a small sample."""

    def setUp(self) -> None:
        n = 10
        idx = pd.date_range("2026-05-26 09:30", periods=n, freq="1min", tz="America/New_York")
        self.session = pd.DataFrame({
            "Open":   np.linspace(100.0, 101.0, n),
            "High":   np.linspace(100.5, 101.5, n),
            "Low":    np.linspace(99.5, 100.5, n),
            "Close":  np.linspace(100.0, 101.0, n),
            "Volume": np.full(n, 100_000),
        }, index=idx)

    def test_returns_five_series(self) -> None:
        res = _compute_vwap_bands(self.session)
        self.assertEqual(len(res), 5)
        for s in res:
            self.assertIsInstance(s, pd.Series)
            self.assertEqual(len(s), len(self.session))

    def test_vwap_is_within_high_low(self) -> None:
        vwap, u1, l1, u2, l2 = _compute_vwap_bands(self.session)
        self.assertTrue((vwap >= self.session["Low"]).all())
        self.assertTrue((vwap <= self.session["High"]).all())

    def test_bands_are_ordered(self) -> None:
        vwap, u1, l1, u2, l2 = _compute_vwap_bands(self.session)
        self.assertTrue((u2 >= u1).all())
        self.assertTrue((u1 >= vwap).all())
        self.assertTrue((vwap >= l1).all())
        self.assertTrue((l1 >= l2).all())

    def test_zero_volume_fallback(self) -> None:
        zero = self.session.copy()
        zero["Volume"] = 0
        vwap, u1, l1, u2, l2 = _compute_vwap_bands(zero)
        self.assertFalse(vwap.isna().all())
        # With zero volume, VWAP falls back to typical price
        tp = (zero["High"] + zero["Low"] + zero["Close"]) / 3.0
        pd.testing.assert_series_equal(vwap, tp.astype(float))

    def test_missing_columns(self) -> None:
        empty = pd.DataFrame()
        with self.assertRaises(KeyError):
            _compute_vwap_bands(empty)


class TestVolumeProfile(unittest.TestCase):
    """Volume profile on synthetic data."""

    def test_returns_expected_keys(self) -> None:
        n = 20
        idx = pd.date_range("2026-05-26 09:30", periods=n, freq="1min", tz="America/New_York")
        session = pd.DataFrame({
            "Open":   np.linspace(100, 102, n),
            "High":   np.linspace(100.5, 102.5, n),
            "Low":    np.linspace(99.5, 101.5, n),
            "Close":  np.linspace(100, 102, n),
            "Volume": np.full(n, 100_000),
        }, index=idx)
        vp = _volume_profile(session)
        for key in ("poc", "delta_pct", "buying_vol", "selling_vol", "total_vol", "poc_position"):
            self.assertIn(key, vp)

    def test_empty_session(self) -> None:
        vp = _volume_profile(pd.DataFrame())
        self.assertIsNone(vp["poc"])


class TestFinitePrice(unittest.TestCase):
    """_finite_price helper."""

    def test_finite_returns_value(self) -> None:
        self.assertEqual(_finite_price(42.5, 0.0), 42.5)

    def test_nan_returns_fallback(self) -> None:
        self.assertEqual(_finite_price(float("nan"), 10.0), 10.0)

    def test_inf_returns_fallback(self) -> None:
        self.assertEqual(_finite_price(float("inf"), 10.0), 10.0)

    def test_none_returns_fallback(self) -> None:
        self.assertEqual(_finite_price(None, 10.0), 10.0)


class TestScanCache(unittest.TestCase):
    """Scan cache management."""

    def test_clear_cache(self) -> None:
        n = clear_scan_cache()
        self.assertIsInstance(n, int)
        self.assertGreaterEqual(n, 0)


if __name__ == "__main__":
    unittest.main()
