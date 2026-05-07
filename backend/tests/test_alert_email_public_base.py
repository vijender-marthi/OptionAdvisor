"""Resolver for SPA URL inside GO alert emails (OPTION_ADVISOR_PUBLIC_URL vs Origin fallback)."""
from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from starlette.datastructures import Headers


class _FakeStarletteRequest:
    __slots__ = ("headers",)

    def __init__(self, headers: Headers) -> None:
        self.headers = headers


class PublicBaseForAlertEmailTests(unittest.TestCase):
    def test_env_override_wins_when_set(self) -> None:
        import main

        req = _FakeStarletteRequest(Headers({"origin": "http://localhost:9999"}))
        with patch.dict(os.environ, {"OPTION_ADVISOR_PUBLIC_URL": "https://prod.optionadvisor.example"}):
            self.assertEqual(main._option_advisor_public_base(None), "https://prod.optionadvisor.example")
            self.assertEqual(main._option_advisor_public_base(req), "https://prod.optionadvisor.example")

    def test_origin_fallback_when_env_empty(self) -> None:
        import main

        req = _FakeStarletteRequest(Headers({"origin": "http://localhost:5173"}))
        with patch.dict(os.environ, {"OPTION_ADVISOR_PUBLIC_URL": "", "OPTION_ADVISOR_EMAIL_LINK_BASE": ""}):
            self.assertEqual(main._option_advisor_public_base(None), "http://localhost:4200")
            self.assertEqual(main._option_advisor_public_base(req), "http://localhost:5173")

    def test_email_link_base_used_when_no_request_and_public_unset(self) -> None:
        import main

        with patch.dict(
            os.environ,
            {
                "OPTION_ADVISOR_PUBLIC_URL": "",
                "OPTION_ADVISOR_EMAIL_LINK_BASE": "https://links.prod.example/",
            },
        ):
            self.assertEqual(main._option_advisor_public_base(None), "https://links.prod.example")

    def test_origin_wins_over_email_link_base_when_public_unset(self) -> None:
        import main

        req = _FakeStarletteRequest(Headers({"origin": "http://localhost:5173"}))
        with patch.dict(
            os.environ,
            {
                "OPTION_ADVISOR_PUBLIC_URL": "",
                "OPTION_ADVISOR_EMAIL_LINK_BASE": "https://links.prod.example",
            },
        ):
            self.assertEqual(main._option_advisor_public_base(req), "http://localhost:5173")

    def test_public_url_wins_over_email_link_base(self) -> None:
        import main

        with patch.dict(
            os.environ,
            {
                "OPTION_ADVISOR_PUBLIC_URL": "https://canonical.example",
                "OPTION_ADVISOR_EMAIL_LINK_BASE": "https://links.prod.example",
            },
        ):
            self.assertEqual(main._option_advisor_public_base(None), "https://canonical.example")

    def test_referer_fallback_when_no_origin(self) -> None:
        import main

        req = _FakeStarletteRequest(
            Headers({"referer": "https://trade.example/strategy?page=1"}),
        )
        with patch.dict(os.environ, {"OPTION_ADVISOR_PUBLIC_URL": ""}):
            self.assertEqual(main._option_advisor_public_base(req), "https://trade.example")


if __name__ == "__main__":
    unittest.main()
