"""ATM IV snapshots for broker-style IV Rank + analysis helpers."""

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import analysis
import storage


class IvAtmSnapshotTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.old_db_path = storage.DB_PATH
        storage.DB_PATH = Path(self.tmp.name) / "iv.sqlite3"
        patcher = patch.dict(os.environ, {}, clear=False)
        patcher.start()
        self.addCleanup(patcher.stop)
        storage.init_db()

    def tearDown(self) -> None:
        storage.DB_PATH = self.old_db_path
        self.tmp.cleanup()

    def test_upsert_and_fetch_before_date(self) -> None:
        storage.upsert_iv_atm_snapshot("SPY", "2026-01-01", 22.5)
        storage.upsert_iv_atm_snapshot("SPY", "2026-01-02", 24.0)
        hist = storage.fetch_iv_atm_history_strict_before("SPY", "2026-01-03", limit=380)
        self.assertEqual(len(hist), 2)
        self.assertCountEqual(hist, [22.5, 24.0])

    def test_same_day_updates_iv(self) -> None:
        storage.upsert_iv_atm_snapshot("QQQ", "2026-05-01", 30.0)
        storage.upsert_iv_atm_snapshot("QQQ", "2026-05-01", 31.5)
        hist = storage.fetch_iv_atm_history_strict_before("QQQ", "2026-05-02", limit=380)
        self.assertEqual(hist, [31.5])


class IvRankImpliedHistoryTests(unittest.TestCase):
    def test_short_history_returns_none(self) -> None:
        self.assertIsNone(analysis.compute_iv_rank_implied_history([], 35.0))
        self.assertIsNone(analysis.compute_iv_rank_implied_history([25.0, 26.0], 35.0))

    def test_rank_in_band(self) -> None:
        base = [18.0 + (i % 12) * 0.8 for i in range(25)]
        r = analysis.compute_iv_rank_implied_history(base, 22.0)
        self.assertIsNotNone(r)
        assert r is not None
        self.assertGreaterEqual(r, 0.0)
        self.assertLessEqual(r, 100.0)


if __name__ == "__main__":
    unittest.main()
