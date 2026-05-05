import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import storage


class WatchlistLimitTests(unittest.TestCase):
    _ENV = {"OPTION_ADVISOR_WATCHLIST_MAX_USER": "3", "OPTION_ADVISOR_WATCHLIST_MAX_ADMIN": "5"}

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.old_db_path = storage.DB_PATH
        storage.DB_PATH = Path(self.tmp.name) / "wl.sqlite3"
        patcher = patch.dict(os.environ, self._ENV, clear=False)
        patcher.start()
        self.addCleanup(patcher.stop)
        storage.init_db()

    def tearDown(self) -> None:
        storage.DB_PATH = self.old_db_path
        self.tmp.cleanup()

    def test_get_user_state_includes_watchlist_max(self) -> None:
        state = storage.get_user_state("newuser@example.com")
        self.assertEqual(state["watchlist_max"], 3)
        self.assertEqual(state["role"], "user")

    def test_regular_user_save_rejects_over_limit(self) -> None:
        wl = [{"ticker": f"T{i}", "addedAt": "2026-01-01"} for i in range(4)]
        with self.assertRaises(ValueError) as ctx:
            storage.save_user_state("u@example.com", wl, [])
        self.assertIn("watchlist_limit:3", str(ctx.exception))

    def test_admin_uses_higher_cap(self) -> None:
        storage.save_user_state("admin@example.com", [], [])
        with storage._connect() as conn:
            conn.execute(
                "UPDATE user_state SET role = 'admin' WHERE email = ?",
                ("admin@example.com",),
            )
        state = storage.get_user_state("admin@example.com")
        self.assertEqual(state["role"], "admin")
        self.assertEqual(state["watchlist_max"], 5)
        wl = [{"ticker": f"A{i}", "addedAt": "2026-01-01"} for i in range(5)]
        storage.save_user_state("admin@example.com", wl, [])
        stored = storage.get_user_state("admin@example.com")
        self.assertEqual(len(stored["watchlist"]), 5)


if __name__ == "__main__":
    unittest.main()
