import tempfile
import unittest
from pathlib import Path

import storage


class AdvisoryAckTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.old_db_path = storage.DB_PATH
        storage.DB_PATH = Path(self.tmp.name) / "adv.sqlite3"
        storage.init_db()

    def tearDown(self) -> None:
        storage.DB_PATH = self.old_db_path
        self.tmp.cleanup()

    def test_save_preserves_advisory_when_not_sent(self) -> None:
        storage.save_user_state(
            "user@example.com",
            [{"ticker": "AAPL", "addedAt": "2026-01-01"}],
            [],
            advisory_terms_version="1",
            advisory_accepted_at="2026-05-04T12:00:00Z",
        )
        storage.save_user_state(
            "user@example.com",
            [{"ticker": "AAPL", "addedAt": "2026-01-01"}, {"ticker": "MSFT", "addedAt": "2026-01-02"}],
            [],
        )
        state = storage.get_user_state("user@example.com")
        self.assertEqual(state["advisory_terms_version"], "1")
        self.assertEqual(state["advisory_accepted_at"], "2026-05-04T12:00:00Z")
        self.assertEqual(len(state["watchlist"]), 2)

    def test_save_updates_advisory_when_provided(self) -> None:
        storage.save_user_state("u2@example.com", [], [])
        storage.save_user_state(
            "u2@example.com",
            [],
            [],
            advisory_terms_version="2",
            advisory_accepted_at="2026-06-01T00:00:00Z",
        )
        state = storage.get_user_state("u2@example.com")
        self.assertEqual(state["advisory_terms_version"], "2")
        self.assertEqual(state["advisory_accepted_at"], "2026-06-01T00:00:00Z")

    def test_save_preserves_alert_email_when_not_sent(self) -> None:
        storage.save_user_state(
            "ae@example.com",
            [{"ticker": "AAPL", "addedAt": "2026-01-01"}],
            [],
            alert_email_enabled=False,
        )
        storage.save_user_state(
            "ae@example.com",
            [{"ticker": "AAPL", "addedAt": "2026-01-01"}, {"ticker": "MSFT", "addedAt": "2026-01-02"}],
            [],
        )
        state = storage.get_user_state("ae@example.com")
        self.assertFalse(state["alert_email_enabled"])


if __name__ == "__main__":
    unittest.main()
