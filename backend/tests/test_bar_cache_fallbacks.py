import unittest
from unittest.mock import patch

import pandas as pd

import bar_cache


def _bars(index=None) -> pd.DataFrame:
    idx = index or pd.DatetimeIndex(["2026-07-10 09:30:00-04:00"])
    return pd.DataFrame(
        {
            "Open": [100.0],
            "High": [101.0],
            "Low": [99.0],
            "Close": [100.5],
            "Volume": [1200],
        },
        index=idx,
    )


class BarCacheFallbackTests(unittest.TestCase):
    def setUp(self) -> None:
        bar_cache.invalidate_all()

    def test_period_history_uses_yahoo_download_when_ticker_history_is_empty(self) -> None:
        with patch("bar_cache.yf.Ticker") as ticker_cls, patch("bar_cache.yf.download", return_value=_bars()) as download:
            ticker_cls.return_value.history.return_value = pd.DataFrame()

            df = bar_cache.get_history("AAPL", period="5d", interval="1m", force_refresh=True)

        self.assertFalse(df.empty)
        self.assertEqual(float(df["Close"].iloc[-1]), 100.5)
        download.assert_called_once()
        self.assertEqual(download.call_args.kwargs["period"], "5d")
        self.assertEqual(download.call_args.kwargs["interval"], "1m")

    def test_same_day_date_range_uses_exclusive_end_for_yahoo(self) -> None:
        with patch("bar_cache.yf.Ticker") as ticker_cls:
            ticker_cls.return_value.history.return_value = _bars()

            df = bar_cache.get_history(
                "MSFT",
                interval="1m",
                start="2026-07-10",
                end="2026-07-10",
                force_refresh=True,
            )

        self.assertFalse(df.empty)
        ticker_cls.return_value.history.assert_called_once()
        self.assertEqual(ticker_cls.return_value.history.call_args.kwargs["end"], "2026-07-11")

    def test_date_range_uses_backup_feed_after_yahoo_fallbacks_are_empty(self) -> None:
        backup_rows = [{"t": 1783704600000, "o": 100, "h": 101, "l": 99, "c": 100.5, "v": 1200}]
        with patch("bar_cache.yf.Ticker") as ticker_cls, \
             patch("bar_cache.yf.download", return_value=pd.DataFrame()), \
             patch("bar_cache.backup_data.get_1min_bars", return_value=backup_rows) as backup:
            ticker_cls.return_value.history.return_value = pd.DataFrame()

            df = bar_cache.get_history(
                "NVDA",
                interval="1m",
                start="2026-07-10",
                end="2026-07-10",
                force_refresh=True,
            )

        self.assertFalse(df.empty)
        self.assertEqual(float(df["Close"].iloc[-1]), 100.5)
        backup.assert_called_once()


if __name__ == "__main__":
    unittest.main()
