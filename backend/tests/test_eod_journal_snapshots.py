import tempfile
import unittest
from pathlib import Path

import storage


class EodJournalSnapshotStorageTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.old_db_path = storage.DB_PATH
        storage.DB_PATH = Path(self.tmp.name) / "eod.sqlite3"
        storage.init_db()

    def tearDown(self) -> None:
        storage.DB_PATH = self.old_db_path
        self.tmp.cleanup()

    def test_upsert_get_and_list_dates(self) -> None:
        saved = storage.upsert_eod_journal_snapshot(
            "Trader@Example.com",
            "swing",
            "2026-06-24",
            "nvda",
            {"analysis": {"ticker": "NVDA"}, "sectors": [{"etf": "XLK"}]},
            {"NVDA": {"observations": "Held MA20"}},
            {"1": True},
        )
        self.assertEqual(saved["email"], "trader@example.com")
        self.assertEqual(saved["ticker"], "NVDA")

        row = storage.get_eod_journal_snapshot("trader@example.com", "swing", "2026-06-24", "NVDA")
        self.assertIsNotNone(row)
        assert row is not None
        self.assertEqual(row["snapshot"]["analysis"]["ticker"], "NVDA")
        self.assertEqual(row["notes"]["NVDA"]["observations"], "Held MA20")
        self.assertEqual(row["checks"]["1"], True)
        self.assertEqual(storage.list_eod_journal_dates("trader@example.com", "swing"), ["2026-06-24"])

    def test_upsert_replaces_existing_snapshot(self) -> None:
        storage.upsert_eod_journal_snapshot("a@b.com", "day", "2026-06-25", "MRVL", {"analysis": {"close": 10}})
        storage.upsert_eod_journal_snapshot("a@b.com", "day", "2026-06-25", "MRVL", {"analysis": {"close": 11}})

        dates = storage.list_eod_journal_dates("a@b.com", "day")
        self.assertEqual(dates, ["2026-06-25"])
        row = storage.get_eod_journal_snapshot("a@b.com", "day", "2026-06-25", "MRVL")
        self.assertIsNotNone(row)
        assert row is not None
        self.assertEqual(row["snapshot"]["analysis"]["close"], 11)


if __name__ == "__main__":
    unittest.main()
