import tempfile
import time
import unittest
from pathlib import Path

import storage


class ActivationTokenTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.old_db_path = storage.DB_PATH
        storage.DB_PATH = Path(self.tmp.name) / "auth.sqlite3"
        storage.init_db()

    def tearDown(self) -> None:
        storage.DB_PATH = self.old_db_path
        self.tmp.cleanup()

    def test_activation_link_is_idempotent_until_expiry(self) -> None:
        expires_ms = int(time.time() * 1000) + 60_000
        storage.register_password_account(
            "NewUser@Example.com",
            "New User",
            "hashed-password",
            email_verified=False,
            activation_token="activation-token",
            activation_expires_ms=expires_ms,
        )

        self.assertEqual(storage.activate_with_token("activation-token"), "newuser@example.com")
        row = storage.get_user_auth_row("newuser@example.com")
        self.assertEqual(row["email_verified"], 1)
        self.assertEqual(row["activation_token"], "activation-token")

        self.assertEqual(storage.activate_with_token("activation-token"), "newuser@example.com")

    def test_expired_activation_link_still_fails(self) -> None:
        storage.register_password_account(
            "expired@example.com",
            "Expired User",
            "hashed-password",
            email_verified=False,
            activation_token="expired-token",
            activation_expires_ms=int(time.time() * 1000) - 1_000,
        )

        self.assertIsNone(storage.activate_with_token("expired-token"))


if __name__ == "__main__":
    unittest.main()
