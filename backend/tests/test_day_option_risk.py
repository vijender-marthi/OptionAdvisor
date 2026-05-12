import unittest
from unittest.mock import patch

import pandas as pd

from day_option_risk import build_day_option_risk_context


class DayOptionRiskTests(unittest.TestCase):
    def test_returns_no_options_context_when_ticker_is_not_optionable(self) -> None:
        ctx = build_day_option_risk_context("SPY", {"optionable": False})
        self.assertEqual(ctx["theta_risk"], "NONE")
        self.assertEqual(ctx["gamma_risk"], "NONE")
        self.assertEqual(ctx["suggested_contract_window"], "N/A")
        self.assertIn("No options traded", ctx["option_execution_warning"])

    def test_flags_0dte_high_iv_and_thin_liquidity(self) -> None:
        info = {
            "optionable": True,
            "regularMarketPrice": 501.2,
            "impliedVolatility": 0.88,
        }
        calls_df = pd.DataFrame([{
            "strike": 500.0,
            "bid": 1.0,
            "ask": 1.3,
            "volume": 4,
            "openInterest": 20,
            "impliedVolatility": 0.92,
        }])

        with (
            patch("day_option_risk._today_str", return_value="2026-05-11"),
            patch("day_option_risk.bar_cache.get_option_dates", return_value=["2026-05-11"]),
            patch("day_option_risk.bar_cache.get_option_chain", return_value=(calls_df, None)),
            patch("day_option_risk._storage.fetch_iv_atm_history_strict_before", return_value=[22.0 + (i % 8) for i in range(40)]),
        ):
            ctx = build_day_option_risk_context("NVDA", info)

        self.assertEqual(ctx["theta_risk"], "HIGH")
        self.assertEqual(ctx["gamma_risk"], "HIGH")
        self.assertEqual(ctx["iv_risk"], "HIGH")
        self.assertEqual(ctx["liquidity_risk"], "HIGH")
        self.assertEqual(ctx["suggested_contract_window"], "0DTE")
        self.assertIn("Use smaller size and confirm VWAP hold.", ctx["option_execution_warning"])

    def test_prefers_short_dated_window_without_forcing_0dte(self) -> None:
        info = {"optionable": True, "regularMarketPrice": 209.6}
        calls_df = pd.DataFrame([{
            "strike": 210.0,
            "bid": 2.45,
            "ask": 2.55,
            "volume": 145,
            "openInterest": 620,
            "impliedVolatility": 0.34,
        }])

        with (
            patch("day_option_risk._today_str", return_value="2026-05-11"),
            patch("day_option_risk.bar_cache.get_option_dates", return_value=["2026-05-12"]),
            patch("day_option_risk.bar_cache.get_option_chain", return_value=(calls_df, None)),
            patch("day_option_risk._storage.fetch_iv_atm_history_strict_before", return_value=[28.0 + (i % 6) for i in range(40)]),
        ):
            ctx = build_day_option_risk_context("AAPL", info)

        self.assertEqual(ctx["theta_risk"], "MEDIUM")
        self.assertEqual(ctx["gamma_risk"], "MEDIUM")
        self.assertEqual(ctx["liquidity_risk"], "LOW")
        self.assertEqual(ctx["suggested_contract_window"], "1-2 DTE")


if __name__ == "__main__":
    unittest.main()
