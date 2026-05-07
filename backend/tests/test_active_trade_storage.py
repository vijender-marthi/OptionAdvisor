import os
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo

import storage

_ET = ZoneInfo("America/New_York")


class ActiveTradeStorageTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.old_db_path = storage.DB_PATH
        storage.DB_PATH = Path(self.tmp.name) / "at.sqlite3"
        patcher = patch.dict(os.environ, {}, clear=False)
        patcher.start()
        self.addCleanup(patcher.stop)
        storage.init_db()

    def tearDown(self) -> None:
        storage.DB_PATH = self.old_db_path
        self.tmp.cleanup()

    def test_insert_stores_strike_and_expiry(self) -> None:
        row = storage.insert_active_trade(
            "trader@example.com",
            ticker="spy",
            side="CALL",
            entry_price=2.5,
            entry_underlying_px=580.0,
            contracts=1,
            strike=575.0,
            option_expiry="2026-06-20",
            notes="paper",
        )
        self.assertEqual(row["ticker"], "SPY")
        self.assertEqual(row["strike"], 575.0)
        self.assertEqual(row.get("expiry"), "2026-06-20")
        loaded = storage.get_active_trade("trader@example.com", row["id"])
        assert loaded is not None
        self.assertEqual(loaded["strike"], 575.0)
        self.assertEqual(loaded.get("expiry"), "2026-06-20")

    def test_expiry_validation(self) -> None:
        with self.assertRaises(ValueError) as ctx:
            storage.insert_active_trade(
                "u@example.com",
                ticker="QQQ",
                side="PUT",
                entry_price=1.0,
                option_expiry="06-20-2026",
            )
        self.assertIn("YYYY-MM-DD", str(ctx.exception))

    def test_list_open_opened_today_et_filters_prior_calendar_day(self) -> None:
        email = "u@example.com"
        ref = int(datetime(2026, 5, 7, 12, 0, 0, tzinfo=_ET).timestamp() * 1000)
        y_ts = datetime(2026, 5, 6, 15, 0, 0, tzinfo=_ET).timestamp()
        t_ts = datetime(2026, 5, 7, 9, 30, 0, tzinfo=_ET).timestamp()
        with patch("storage.time.time", return_value=y_ts):
            yesterday = storage.insert_active_trade(
                email,
                ticker="AAA",
                side="CALL",
                entry_price=1.0,
            )
        with patch("storage.time.time", return_value=t_ts):
            today = storage.insert_active_trade(
                email,
                ticker="BBB",
                side="PUT",
                entry_price=1.0,
            )
        filtered = storage.list_active_trades_open_opened_today_et(email, ref_epoch_ms=ref)
        tickers = {r["ticker"] for r in filtered}
        self.assertEqual(tickers, {"BBB"})
        self.assertEqual(len(filtered), 1)
        self.assertEqual(filtered[0]["id"], today["id"])
        open_all = storage.list_active_trades_open(email)
        self.assertEqual(len(open_all), 2)
        self.assertIn(yesterday["id"], {r["id"] for r in open_all})

    def test_list_open_opened_today_et_empty_when_all_prior_day(self) -> None:
        email = "prior@example.com"
        ref = int(datetime(2026, 5, 7, 16, 0, 0, tzinfo=_ET).timestamp() * 1000)
        y_ts = datetime(2026, 5, 6, 10, 0, 0, tzinfo=_ET).timestamp()
        with patch("storage.time.time", return_value=y_ts):
            storage.insert_active_trade(email, ticker="QQQ", side="CALL", entry_price=1.0)
        self.assertEqual(storage.list_active_trades_open_opened_today_et(email, ref_epoch_ms=ref), [])


if __name__ == "__main__":
    unittest.main()
