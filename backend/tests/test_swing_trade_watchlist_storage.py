import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import storage


class SwingTradeWatchlistStorageTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.old_db_path = storage.DB_PATH
        storage.DB_PATH = Path(self.tmp.name) / "swing_wl.sqlite3"
        patcher = patch.dict(os.environ, {}, clear=False)
        patcher.start()
        self.addCleanup(patcher.stop)
        storage.init_db()

    def tearDown(self) -> None:
        storage.DB_PATH = self.old_db_path
        self.tmp.cleanup()

    def test_swing_watchlist_roundtrip_and_cap(self) -> None:
        storage.save_user_state(
            "sw@example.com",
            [],
            [],
            swing_trade_watchlist=["nvda", "aapl", "nvda"],
        )
        state = storage.get_user_state("sw@example.com")
        self.assertEqual(state["swing_trade_watchlist"], ["NVDA", "AAPL"])

        many = [f"T{i}" for i in range(20)]
        storage.save_user_state("sw@example.com", [], [], swing_trade_watchlist=many)
        state2 = storage.get_user_state("sw@example.com")
        self.assertEqual(len(state2["swing_trade_watchlist"]), 10)
        self.assertEqual(state2["swing_trade_watchlist"][0], "T0")


if __name__ == "__main__":
    unittest.main()
