import tempfile
import unittest
from pathlib import Path

import storage


class WatchlistLimitTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.old_db_path = storage.DB_PATH
        storage.DB_PATH = Path(self.tmp.name) / "wl.sqlite3"
        storage.init_db()

    def tearDown(self) -> None:
        storage.DB_PATH = self.old_db_path
        self.tmp.cleanup()

    def test_get_user_state_includes_watchlist_max(self) -> None:
        state = storage.get_user_state("newuser@example.com")
        self.assertEqual(state["watchlist_max"], 9999)
        self.assertEqual(state["role"], "user")

    def test_regular_user_can_save_large_watchlist(self) -> None:
        wl = [{"ticker": f"T{i}", "addedAt": "2026-01-01"} for i in range(125)]
        saved = storage.save_user_state("u@example.com", wl, [])
        self.assertEqual(len(saved["watchlist"]), 125)

    def test_admin_uses_same_unified_cap(self) -> None:
        storage.save_user_state("admin@example.com", [], [])
        with storage._connect() as conn:
            conn.execute(
                "UPDATE user_state SET role = 'admin' WHERE email = ?",
                ("admin@example.com",),
            )
        state = storage.get_user_state("admin@example.com")
        self.assertEqual(state["role"], "admin")
        self.assertEqual(state["watchlist_max"], 9999)
        wl = [{"ticker": f"A{i}", "addedAt": "2026-01-01"} for i in range(150)]
        storage.save_user_state("admin@example.com", wl, [])
        stored = storage.get_user_state("admin@example.com")
        self.assertEqual(len(stored["watchlist"]), 150)


if __name__ == "__main__":
    unittest.main()
