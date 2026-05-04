import unittest
from datetime import datetime, timedelta

import pandas as pd

from analysis import MarketSignals
from engine import run_engine


PRICE = 100.0


def _expiry(days_out: int = 28) -> str:
    return (datetime.today() + timedelta(days=days_out)).strftime("%Y-%m-%d")


def _option_row(strike: float, bid: float, ask: float, iv: float, delta: float) -> dict:
    return {
        "strike": strike,
        "bid": bid,
        "ask": ask,
        "lastPrice": round((bid + ask) / 2, 2),
        "impliedVolatility": iv,
        "openInterest": 1_000,
        "volume": 100,
        "delta": delta,
    }


def _calls_chain() -> pd.DataFrame:
    return pd.DataFrame([
        _option_row(85, 15.8, 16.2, 0.28, 0.86),
        _option_row(90, 11.8, 12.2, 0.28, 0.75),
        _option_row(95, 8.4, 8.6, 0.28, 0.62),
        _option_row(100, 5.9, 6.1, 0.28, 0.50),
        _option_row(105, 3.9, 4.1, 0.28, 0.42),
        _option_row(110, 2.4, 2.6, 0.28, 0.25),
        _option_row(115, 0.9, 1.1, 0.28, 0.16),
        _option_row(120, 0.55, 0.65, 0.28, 0.10),
    ])


def _debit_calls_chain() -> pd.DataFrame:
    return pd.DataFrame([
        _option_row(85, 15.8, 16.2, 0.28, 0.86),
        _option_row(90, 11.8, 12.2, 0.28, 0.75),
        _option_row(95, 6.8, 7.2, 0.28, 0.62),
        _option_row(100, 1.9, 2.1, 0.28, 0.50),
        _option_row(105, 0.9, 1.1, 0.28, 0.42),
        _option_row(110, 0.4, 0.6, 0.28, 0.25),
        _option_row(115, 0.15, 0.25, 0.28, 0.16),
    ])


def _puts_chain() -> pd.DataFrame:
    return pd.DataFrame([
        _option_row(80, 0.55, 0.65, 0.30, -0.10),
        _option_row(85, 0.9, 1.1, 0.30, -0.16),
        _option_row(90, 2.4, 2.6, 0.30, -0.25),
        _option_row(95, 3.9, 4.1, 0.30, -0.42),
        _option_row(100, 5.9, 6.1, 0.30, -0.50),
        _option_row(105, 8.4, 8.6, 0.30, -0.62),
        _option_row(110, 11.8, 12.2, 0.30, -0.75),
        _option_row(115, 15.8, 16.2, 0.30, -0.86),
    ])


def _debit_puts_chain() -> pd.DataFrame:
    return pd.DataFrame([
        _option_row(80, 0.15, 0.25, 0.30, -0.10),
        _option_row(85, 0.4, 0.6, 0.30, -0.16),
        _option_row(90, 0.9, 1.1, 0.30, -0.25),
        _option_row(95, 1.9, 2.1, 0.30, -0.42),
        _option_row(100, 1.9, 2.1, 0.30, -0.50),
        _option_row(105, 6.8, 7.2, 0.30, -0.62),
        _option_row(110, 11.8, 12.2, 0.30, -0.75),
    ])


def _signals(
    *,
    bias: str,
    confidence: int,
    iv_rank: float,
    iv_vs_hv: float,
    volatility_regime: str,
) -> MarketSignals:
    return MarketSignals(
        current_price=PRICE,
        prev_close=99.0,
        price_change=1.0,
        price_change_pct=1.0,
        trend=bias,
        trend_strength="Moderate",
        ma20=99.0,
        ma50=98.0,
        ma200=95.0,
        above_ma20=True,
        above_ma50=True,
        above_ma200=True,
        ma50_slope=1.2,
        ma200_slope=0.6,
        rsi=52.0,
        rsi_signal="Neutral",
        macd=0.4,
        macd_signal_line=0.2,
        macd_histogram=0.2,
        macd_crossover="Bullish" if "Bullish" in bias else "Bearish" if "Bearish" in bias else "None",
        current_iv=28.0,
        hv_20=22.0,
        hv_60=24.0,
        iv_rank=iv_rank,
        iv_percentile=iv_rank,
        iv_vs_hv=iv_vs_hv,
        iv_environment="Elevated" if iv_rank >= 50 else "Low",
        put_call_ratio=0.9,
        pcr_signal="Neutral",
        iv_skew=2.0,
        skew_signal="Normal",
        directional_bias=bias,
        bias_confidence=confidence,
        volatility_regime=volatility_regime,
    )


def _strategies_for(
    signals: MarketSignals,
    strategy_mode: str,
    *,
    calls: pd.DataFrame | None = None,
    puts: pd.DataFrame | None = None,
) -> set[str]:
    trades = run_engine(
        signals,
        calls if calls is not None else _calls_chain(),
        puts if puts is not None else _puts_chain(),
        [_expiry()],
        spread_width_override=5,
        weeks_out=4,
        strategy_mode=strategy_mode,
    )
    return {trade.strategy for trade in trades}


class TradeEngineStrategyCoverageTest(unittest.TestCase):
    def test_long_only_bullish_builds_long_call_and_bull_call_spread(self):
        strategies = _strategies_for(
            _signals(
                bias="Bullish",
                confidence=75,
                iv_rank=20,
                iv_vs_hv=-4,
                volatility_regime="Buy Premium",
            ),
            "long_only",
            calls=_debit_calls_chain(),
            puts=_debit_puts_chain(),
        )

        self.assertIn("Long Call", strategies)
        self.assertIn("Bull Call Spread", strategies)

    def test_long_only_bearish_builds_long_put_and_bear_put_spread(self):
        strategies = _strategies_for(
            _signals(
                bias="Bearish",
                confidence=75,
                iv_rank=20,
                iv_vs_hv=-4,
                volatility_regime="Buy Premium",
            ),
            "long_only",
            calls=_debit_calls_chain(),
            puts=_debit_puts_chain(),
        )

        self.assertIn("Long Put", strategies)
        self.assertIn("Bear Put Spread", strategies)

    def test_long_only_neutral_builds_long_straddle(self):
        strategies = _strategies_for(
            _signals(
                bias="Neutral",
                confidence=0,
                iv_rank=20,
                iv_vs_hv=-4,
                volatility_regime="Buy Premium",
            ),
            "long_only",
            calls=_debit_calls_chain(),
            puts=_debit_puts_chain(),
        )

        self.assertIn("Long Straddle", strategies)

    def test_credit_only_neutral_builds_all_defined_risk_credit_trades(self):
        strategies = _strategies_for(
            _signals(
                bias="Neutral",
                confidence=0,
                iv_rank=70,
                iv_vs_hv=8,
                volatility_regime="Sell Premium",
            ),
            "credit_only",
        )

        self.assertIn("Bull Put Spread", strategies)
        self.assertIn("Bear Call Spread", strategies)
        self.assertIn("Iron Condor", strategies)

    def test_short_or_covered_neutral_builds_bullish_income_trades(self):
        strategies = _strategies_for(
            _signals(
                bias="Neutral",
                confidence=0,
                iv_rank=70,
                iv_vs_hv=8,
                volatility_regime="Sell Premium",
            ),
            "short_or_covered",
        )

        self.assertIn("Covered Call", strategies)
        self.assertIn("Covered Put", strategies)
        self.assertIn("Short Put", strategies)

    def test_short_or_covered_bearish_builds_short_call(self):
        strategies = _strategies_for(
            _signals(
                bias="Bearish",
                confidence=75,
                iv_rank=70,
                iv_vs_hv=8,
                volatility_regime="Sell Premium",
            ),
            "short_or_covered",
        )

        self.assertIn("Short Call", strategies)


if __name__ == "__main__":
    unittest.main()
