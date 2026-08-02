import tempfile
import unittest
from pathlib import Path

import storage
import user_ai_coach as uac
from fastapi import HTTPException


class UserAICoachTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old = storage.DB_PATH
        storage.DB_PATH = Path(self.tmp.name) / "coach.sqlite3"
        storage.init_db()
        uac._ensure_table()  # recreate the coach table in the temp DB
        self.email = "trader@example.com"

    def tearDown(self):
        storage.DB_PATH = self.old
        self.tmp.cleanup()

    def test_settings_roundtrip_never_returns_key(self):
        self.assertFalse(uac.get_ai_coach_settings(email=self.email)["configured"])

        uac.save_ai_coach_settings(
            uac.AICoachSettingsIn(provider="gemini", apiKey="secret-key-123456", model=None),
            email=self.email,
        )
        got = uac.get_ai_coach_settings(email=self.email)
        self.assertTrue(got["configured"])
        self.assertEqual(got["provider"], "gemini")
        self.assertEqual(got["model"], uac.DEFAULT_MODELS["gemini"])
        # the raw key must never be present in the settings payload
        self.assertNotIn("secret-key-123456", str(got))
        self.assertNotIn("api_key", got)

        uac.delete_ai_coach_settings(email=self.email)
        self.assertFalse(uac.get_ai_coach_settings(email=self.email)["configured"])

    def test_bad_provider_and_short_key_rejected(self):
        with self.assertRaises(HTTPException) as ctx:
            uac.save_ai_coach_settings(
                uac.AICoachSettingsIn(provider="grok", apiKey="x" * 20), email=self.email)
        self.assertEqual(ctx.exception.status_code, 400)
        with self.assertRaises(HTTPException) as ctx2:
            uac.save_ai_coach_settings(
                uac.AICoachSettingsIn(provider="claude", apiKey="short"), email=self.email)
        self.assertEqual(ctx2.exception.status_code, 400)

    def test_analyze_requires_config(self):
        with self.assertRaises(HTTPException) as ctx:
            uac.analyze(uac.AICoachAnalyzeIn(mode="positions_open", context={}), email=self.email)
        self.assertEqual(ctx.exception.status_code, 409)

    def test_analyze_uses_provider_and_returns_markdown(self):
        uac.save_ai_coach_settings(
            uac.AICoachSettingsIn(provider="openai", apiKey="secret-key-123456", model="gpt-5"),
            email=self.email,
        )
        captured = {}

        def fake_openai(api_key, model, prompt):
            captured["api_key"] = api_key
            captured["model"] = model
            captured["prompt"] = prompt
            return "**Takeaway.** Trim the oversized TSLA calls."

        orig = uac._CALLERS["openai"]
        uac._CALLERS["openai"] = fake_openai
        try:
            out = uac.analyze(
                uac.AICoachAnalyzeIn(
                    mode="positions_open", title="Open positions",
                    context=[{"ticker": "TSLA", "contracts": 4}],
                ),
                email=self.email,
            )
        finally:
            uac._CALLERS["openai"] = orig

        self.assertEqual(out["provider"], "openai")
        self.assertEqual(out["model"], "gpt-5")
        self.assertIn("TSLA", out["markdown"])
        self.assertEqual(captured["api_key"], "secret-key-123456")
        self.assertIn("OPEN positions", captured["prompt"])  # mode instruction present
        self.assertIn("TSLA", captured["prompt"])  # context serialized in


if __name__ == "__main__":
    unittest.main()
