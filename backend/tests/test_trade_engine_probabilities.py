import unittest
from datetime import datetime, timedelta
from math import erf, exp, log, sqrt

import pandas as pd

from analysis import MarketSignals
from engine import _build_credit_spread, _build_long_call


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


def _normal_cdf(value: float) -> float:
    return 0.5 * (1.0 + erf(value / sqrt(2.0)))


def _years_to_expiry(expiry: str) -> float:
    dte = max((datetime.strptime(expiry, "%Y-%m-%d") - datetime.today()).days, 1)
    return max(dte / 365.0, 1 / 365.0)


def _directional_drift(bias: str, confidence: int) -> float:
    confidence_fraction = confidence / 100.0
    if bias in ("Bullish", "Mildly Bullish"):
        return 0.12 * confidence_fraction
    if bias in ("Bearish", "Mildly Bearish"):
        return -0.12 * confidence_fraction
    return 0.05


def _prob_above(price: float, target: float, iv_pct: float, expiry: str, annual_drift: float) -> float:
    years = _years_to_expiry(expiry)
    sigma = iv_pct / 100.0
    d2 = (log(price / target) + (annual_drift - 0.5 * sigma ** 2) * years) / (sigma * sqrt(years))
    return _normal_cdf(d2)


def _expected_option_payoff(
    price: float,
    strike: float,
    iv_pct: float,
    expiry: str,
    option_type: str,
    annual_drift: float,
) -> float:
    years = _years_to_expiry(expiry)
    sigma = iv_pct / 100.0
    vol_sqrt_t = sigma * sqrt(years)
    d1 = (log(price / strike) + (annual_drift + 0.5 * sigma ** 2) * years) / vol_sqrt_t
    d2 = d1 - vol_sqrt_t
    if option_type == "CALL":
        return price * exp(annual_drift * years) * _normal_cdf(d1) - strike * _normal_cdf(d2)
    return strike * _normal_cdf(-d2) - price * exp(annual_drift * years) * _normal_cdf(-d1)


class TradeEngineProbabilityMathTest(unittest.TestCase):
    def test_long_call_pop_and_ev_use_breakeven_and_directional_drift(self):
        expiry = _expiry()
        signals = _signals(
            bias="Bullish",
            confidence=90,
            iv_rank=20,
            iv_vs_hv=-4,
            volatility_regime="Buy Premium",
        )
        trade = _build_long_call(signals, _calls_chain(), expiry)

        self.assertIsNotNone(trade)
        leg = trade["legs"][0]
        drift = _directional_drift(signals.directional_bias, signals.bias_confidence)
        breakeven = leg.strike + leg.mid_price

        expected_pop = round(_prob_above(PRICE, breakeven, leg.iv, expiry, drift), 4)
        expected_prob_max_loss = round(1.0 - _prob_above(PRICE, leg.strike, leg.iv, expiry, drift), 4)
        expected_ev = round(
            _expected_option_payoff(PRICE, leg.strike, leg.iv, expiry, "CALL", drift) - leg.mid_price,
            4,
        )
        risk_neutral_pop = round(_prob_above(PRICE, breakeven, leg.iv, expiry, 0.0), 4)

        self.assertAlmostEqual(trade["prob_of_profit"], expected_pop, places=4)
        self.assertAlmostEqual(trade["prob_of_max_loss"], expected_prob_max_loss, places=4)
        self.assertAlmostEqual(trade["expected_value"], expected_ev, places=4)
        self.assertGreater(trade["prob_of_profit"], risk_neutral_pop)

    def test_bull_put_spread_uses_full_payoff_distribution(self):
        expiry = _expiry()
        signals = _signals(
            bias="Bullish",
            confidence=80,
            iv_rank=70,
            iv_vs_hv=8,
            volatility_regime="Sell Premium",
        )
        trade = _build_credit_spread(
            signals,
            _calls_chain(),
            _puts_chain(),
            "PUT",
            "Bull Put Spread",
            "Bullish/Neutral",
            expiry,
            PRICE,
            spread_width_override=5,
        )

        self.assertIsNotNone(trade)
        sell_leg, buy_leg = trade["legs"]
        drift = _directional_drift(signals.directional_bias, signals.bias_confidence)
        avg_iv = (sell_leg.iv + buy_leg.iv) / 2
        breakeven = sell_leg.strike - trade["net_credit"]

        expected_pop = round(_prob_above(PRICE, breakeven, avg_iv, expiry, drift), 4)
        expected_prob_max_loss = round(
            1.0 - _prob_above(PRICE, buy_leg.strike, avg_iv, expiry, drift), 4
        )
        expected_ev = round(
            trade["net_credit"]
            - _expected_option_payoff(PRICE, sell_leg.strike, sell_leg.iv, expiry, "PUT", drift)
            + _expected_option_payoff(PRICE, buy_leg.strike, buy_leg.iv, expiry, "PUT", drift),
            4,
        )
        old_binary_pop = round(1.0 - abs(sell_leg.delta), 4)
        old_binary_ev = round(
            old_binary_pop * trade["max_profit"] - (1.0 - old_binary_pop) * trade["max_loss"],
            4,
        )

        self.assertAlmostEqual(trade["prob_of_profit"], expected_pop, places=4)
        self.assertAlmostEqual(trade["prob_of_max_loss"], expected_prob_max_loss, places=4)
        self.assertAlmostEqual(trade["expected_value"], expected_ev, places=4)
        self.assertGreater(trade["prob_of_profit"], old_binary_pop)
        self.assertNotAlmostEqual(trade["expected_value"], old_binary_ev, places=2)


if __name__ == "__main__":
    unittest.main()
