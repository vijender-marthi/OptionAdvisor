import unittest
from unittest.mock import patch
from datetime import datetime, timedelta

import pandas as pd

from analysis import MarketSignals
from engine import (
    compute_bs_ev_credit_spread,
    compute_bs_ev_long,
    compute_ev,
    compute_kelly_metrics,
    run_engine,
)


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


def _long_calls_chain() -> pd.DataFrame:
    return pd.DataFrame([
        _option_row(85, 15.8, 16.2, 0.45, 0.86),
        _option_row(90, 11.8, 12.2, 0.45, 0.75),
        _option_row(95, 8.4, 8.6, 0.45, 0.62),
        _option_row(100, 2.9, 3.1, 0.45, 0.50),
        _option_row(105, 1.4, 1.6, 0.45, 0.42),
        _option_row(110, 0.45, 0.55, 0.45, 0.25),
        _option_row(115, 0.20, 0.30, 0.45, 0.16),
        _option_row(120, 0.10, 0.20, 0.45, 0.10),
    ])


def _long_puts_chain() -> pd.DataFrame:
    return pd.DataFrame([
        _option_row(80, 0.10, 0.20, 0.45, -0.10),
        _option_row(85, 0.20, 0.30, 0.45, -0.16),
        _option_row(90, 0.45, 0.55, 0.45, -0.25),
        _option_row(95, 1.4, 1.6, 0.45, -0.42),
        _option_row(100, 2.9, 3.1, 0.45, -0.50),
        _option_row(105, 8.4, 8.6, 0.45, -0.62),
        _option_row(110, 11.8, 12.2, 0.45, -0.75),
        _option_row(115, 15.8, 16.2, 0.45, -0.86),
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
    def test_compute_ev_clamps_probability_inputs(self):
        self.assertEqual(compute_ev(1.0, 3.0, 1.25), 1.0)
        self.assertEqual(compute_ev(1.0, 3.0, -0.25), -3.0)

    def test_kelly_metrics_use_half_kelly_with_twenty_percent_cap(self):
        kelly, half_kelly, edge = compute_kelly_metrics(0.20, 3.90)

        self.assertAlmostEqual(edge, 0.0513, places=4)
        self.assertAlmostEqual(kelly, 0.0513, places=4)
        self.assertAlmostEqual(half_kelly, 0.0256, places=4)

        self.assertEqual(compute_kelly_metrics(1.00, 1.00)[1], 0.20)

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
            calls=_long_calls_chain(),
            puts=_long_puts_chain(),
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
            calls=_long_calls_chain(),
            puts=_long_puts_chain(),
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
            calls=_long_calls_chain(),
            puts=_long_puts_chain(),
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

    def test_recommendations_have_positive_ev_and_kelly_metrics(self):
        trades = run_engine(
            _signals(
                bias="Neutral",
                confidence=0,
                iv_rank=70,
                iv_vs_hv=8,
                volatility_regime="Sell Premium",
            ),
            _calls_chain(),
            _puts_chain(),
            [_expiry()],
            spread_width_override=5,
            weeks_out=4,
            strategy_mode="credit_only",
        )

        self.assertGreater(len(trades), 0)
        for trade in trades:
            self.assertGreater(trade.expected_value, 0)
            self.assertAlmostEqual(trade.edge_ratio, trade.expected_value / trade.max_loss, places=4)
            self.assertAlmostEqual(trade.kelly_fraction, trade.edge_ratio, places=4)
            self.assertLessEqual(trade.half_kelly_fraction, 0.20)

    def test_long_call_uses_black_scholes_ev_not_capped_binary_ev(self):
        signals = _signals(
            bias="Bullish",
            confidence=75,
            iv_rank=20,
            iv_vs_hv=-4,
            volatility_regime="Buy Premium",
        )
        trades = run_engine(
            signals,
            _long_calls_chain(),
            _long_puts_chain(),
            [_expiry()],
            spread_width_override=5,
            weeks_out=4,
            strategy_mode="long_only",
        )

        long_call = next(trade for trade in trades if trade.strategy == "Long Call")
        leg = long_call.legs[0]
        bs_ev = compute_bs_ev_long(
            current_price=PRICE,
            strike=leg.strike,
            iv_pct=leg.iv,
            expiry=long_call.expiry,
            premium=leg.mid_price,
            option_type="CALL",
            directional_bias=signals.directional_bias,
            bias_confidence=signals.bias_confidence,
        )
        capped_binary_ev = compute_ev(leg.mid_price * 10, leg.mid_price, long_call.prob_of_profit)

        self.assertAlmostEqual(long_call.expected_value, bs_ev, places=4)
        self.assertNotEqual(long_call.expected_value, capped_binary_ev)

    def test_long_put_uses_black_scholes_ev_not_capped_binary_ev(self):
        signals = _signals(
            bias="Bearish",
            confidence=75,
            iv_rank=20,
            iv_vs_hv=-4,
            volatility_regime="Buy Premium",
        )
        trades = run_engine(
            signals,
            _long_calls_chain(),
            _long_puts_chain(),
            [_expiry()],
            spread_width_override=5,
            weeks_out=4,
            strategy_mode="long_only",
        )

        long_put = next(trade for trade in trades if trade.strategy == "Long Put")
        leg = long_put.legs[0]
        bs_ev = compute_bs_ev_long(
            current_price=PRICE,
            strike=leg.strike,
            iv_pct=leg.iv,
            expiry=long_put.expiry,
            premium=leg.mid_price,
            option_type="PUT",
            directional_bias=signals.directional_bias,
            bias_confidence=signals.bias_confidence,
        )
        capped_binary_ev = compute_ev(leg.mid_price * 10, leg.mid_price, long_put.prob_of_profit)

        self.assertAlmostEqual(long_put.expected_value, bs_ev, places=4)
        self.assertNotEqual(long_put.expected_value, capped_binary_ev)

    def test_long_straddle_uses_black_scholes_ev_for_each_leg(self):
        signals = _signals(
            bias="Neutral",
            confidence=0,
            iv_rank=20,
            iv_vs_hv=-4,
            volatility_regime="Buy Premium",
        )
        trades = run_engine(
            signals,
            _long_calls_chain(),
            _long_puts_chain(),
            [_expiry()],
            spread_width_override=5,
            weeks_out=4,
            strategy_mode="long_only",
        )

        straddle = next(trade for trade in trades if trade.strategy == "Long Straddle")
        call_leg, put_leg = straddle.legs
        avg_iv = round((call_leg.iv + put_leg.iv) / 2, 4)
        expected_ev = round(
            compute_bs_ev_long(
                current_price=PRICE,
                strike=call_leg.strike,
                iv_pct=avg_iv,
                expiry=straddle.expiry,
                premium=call_leg.mid_price,
                option_type="CALL",
                directional_bias=signals.directional_bias,
                bias_confidence=signals.bias_confidence,
            )
            + compute_bs_ev_long(
                current_price=PRICE,
                strike=put_leg.strike,
                iv_pct=avg_iv,
                expiry=straddle.expiry,
                premium=put_leg.mid_price,
                option_type="PUT",
                directional_bias=signals.directional_bias,
                bias_confidence=signals.bias_confidence,
            ),
            4,
        )
        capped_binary_ev = compute_ev(
            (call_leg.mid_price + put_leg.mid_price) * 3,
            call_leg.mid_price + put_leg.mid_price,
            straddle.prob_of_profit,
        )

        self.assertAlmostEqual(straddle.expected_value, expected_ev, places=4)
        self.assertNotEqual(straddle.expected_value, capped_binary_ev)

    def test_credit_spreads_use_bs_distributional_ev_income_trades_use_binary_ev(self):
        """
        Bull Put Spread and Bear Call Spread now use compute_bs_ev_credit_spread
        (full payoff distribution).  Iron Condor and naked/covered income trades
        still use the binary compute_ev shortcut.  Neither family should ever
        call compute_bs_ev_long (which is reserved for long uncapped strategies).
        """
        signals = _signals(
            bias="Neutral",
            confidence=0,
            iv_rank=70,
            iv_vs_hv=8,
            volatility_regime="Sell Premium",
        )
        calls = _calls_chain()
        puts = _puts_chain()
        expiry = _expiry()

        with patch("engine.compute_bs_ev_long") as bs_ev_long:
            credit_trades = run_engine(
                signals, calls, puts, [expiry],
                spread_width_override=5, weeks_out=4, strategy_mode="credit_only",
            )
            income_trades = run_engine(
                signals, calls, puts, [expiry],
                spread_width_override=5, weeks_out=4, strategy_mode="short_or_covered",
            )

        bs_ev_long.assert_not_called()

        VERTICAL_SPREADS = {"Bull Put Spread", "Bear Call Spread"}
        INCOME_STRATEGIES = {"Covered Call", "Covered Put", "Short Put", "Short Call"}

        for trade in [*credit_trades, *income_trades]:
            if trade.strategy in VERTICAL_SPREADS:
                # Distributional EV: net_credit minus the expected option payoffs
                leg_sell, leg_buy = trade.legs
                option_type = "PUT" if trade.strategy == "Bull Put Spread" else "CALL"
                expected_ev = compute_bs_ev_credit_spread(
                    current_price=PRICE,
                    short_strike=leg_sell.strike,
                    long_strike=leg_buy.strike,
                    short_iv_pct=leg_sell.iv,
                    long_iv_pct=leg_buy.iv,
                    expiry=trade.expiry,
                    net_credit=trade.net_credit,
                    option_type=option_type,
                    directional_bias=signals.directional_bias,
                    bias_confidence=signals.bias_confidence,
                )
                self.assertAlmostEqual(trade.expected_value, expected_ev, places=4,
                                       msg=f"{trade.strategy} EV mismatch")
            elif trade.strategy in INCOME_STRATEGIES:
                # Binary EV for naked/covered income trades
                expected_ev = compute_ev(
                    trade.net_credit,
                    round(trade.net_credit * 2, 4),
                    trade.prob_of_profit,
                )
                self.assertAlmostEqual(trade.expected_value, expected_ev, places=4,
                                       msg=f"{trade.strategy} EV mismatch")
            else:
                # Iron Condor: binary EV against its own max_loss
                expected_ev = compute_ev(trade.max_profit, trade.max_loss, trade.prob_of_profit)
                self.assertAlmostEqual(trade.expected_value, expected_ev, places=4,
                                       msg=f"{trade.strategy} EV mismatch")


if __name__ == "__main__":
    unittest.main()
