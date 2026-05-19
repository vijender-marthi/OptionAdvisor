"""
Tests for engine.py — the main options trade engine.

Tests cover:
 - compute_ev():  expected value calculation
 - compute_kelly_metrics(): kelly cap at 20%, never exceeds HALF_KELLY_CAP
 - expected_stock_move(): realistic move from IV/DTE
 - run_engine(): returns TradeCandidate list with required attributes,
                 long_only mode only returns long strategies,
                 returns empty list when expiry cannot be found
"""
import unittest
from datetime import datetime, timedelta
from dataclasses import dataclass, field
from typing import Optional
import pandas as pd

from engine import (
    compute_ev,
    compute_kelly_metrics,
    expected_stock_move,
    run_engine,
    HALF_KELLY_CAP,
    pick_expiry_by_dte,
    days_to_expiry,
)
from analysis import MarketSignals, TradeCandidate


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _future_date(days_out: int) -> str:
    return (datetime.now() + timedelta(days=days_out)).strftime("%Y-%m-%d")


def _make_signals(
    directional_bias="Bullish",
    bias_confidence=70,
    current_price=100.0,
    iv_rank=30.0,
    current_iv=25.0,
    hv_20=20.0,
    hv_60=22.0,
    rsi=55.0,
) -> MarketSignals:
    return MarketSignals(
        current_price=current_price,
        prev_close=current_price - 1.0,
        price_change=1.0,
        price_change_pct=1.0,
        trend=directional_bias,
        trend_strength="Moderate",
        ma20=current_price * 0.97,
        ma50=current_price * 0.95,
        ma200=current_price * 0.90,
        above_ma20=True,
        above_ma50=True,
        above_ma200=True,
        ma50_slope=0.5,
        ma200_slope=0.3,
        rsi=rsi,
        rsi_signal="Neutral",
        macd=0.5,
        macd_signal_line=0.3,
        macd_histogram=0.2,
        macd_crossover="Bullish",
        current_iv=current_iv,
        hv_20=hv_20,
        hv_60=hv_60,
        iv_rank=iv_rank,
        iv_percentile=iv_rank,
        iv_vs_hv=current_iv - hv_20,
        iv_environment="Low" if iv_rank < 50 else "High",
        put_call_ratio=1.0,
        pcr_signal="Neutral",
        iv_skew=0.0,
        skew_signal="Normal",
        directional_bias=directional_bias,
        bias_confidence=bias_confidence,
        volatility_regime="Buy Premium" if iv_rank < 50 else "Sell Premium",
    )


def _make_option_chain(
    price: float = 100.0,
    strikes_below: int = 5,
    strikes_above: int = 5,
    iv: float = 0.25,
    oi: int = 500,
    vol: int = 200,
    expiry: str = None,
):
    """Generate a realistic option chain DataFrame near the given price."""
    if expiry is None:
        expiry = _future_date(30)
    step = price * 0.025  # 2.5% steps
    base = round(price / step) * step
    strikes = [base + (i - strikes_below) * step for i in range(strikes_below + strikes_above + 1)]

    rows = []
    for k in strikes:
        moneyness = (k - price) / price
        # Simple Black-Scholes-like bid/ask approximation
        intrinsic_call = max(price - k, 0.0)
        time_val = price * iv * 0.15
        call_mid = round(max(intrinsic_call + time_val * max(1 - abs(moneyness) * 3, 0.05), 0.05), 2)
        intrinsic_put = max(k - price, 0.0)
        put_mid = round(max(intrinsic_put + time_val * max(1 - abs(moneyness) * 3, 0.05), 0.05), 2)
        rows.append({
            "strike": k,
            "call_bid": round(call_mid * 0.9, 2),
            "call_ask": round(call_mid * 1.1, 2),
            "put_bid": round(put_mid * 0.9, 2),
            "put_ask": round(put_mid * 1.1, 2),
            "impliedVolatility": iv,
            "openInterest": oi,
            "volume": vol,
            "expiration": expiry,
        })
    df = pd.DataFrame(rows)

    calls = df[["strike", "impliedVolatility", "openInterest", "volume", "expiration"]].copy()
    calls["bid"] = df["call_bid"]
    calls["ask"] = df["call_ask"]
    calls["lastPrice"] = (df["call_bid"] + df["call_ask"]) / 2

    puts = df[["strike", "impliedVolatility", "openInterest", "volume", "expiration"]].copy()
    puts["bid"] = df["put_bid"]
    puts["ask"] = df["put_ask"]
    puts["lastPrice"] = (df["put_bid"] + df["put_ask"]) / 2

    return calls, puts


# ---------------------------------------------------------------------------
# compute_ev tests
# ---------------------------------------------------------------------------

class TestComputeEV(unittest.TestCase):

    def test_positive_ev_when_prob_high_and_profit_large(self):
        ev = compute_ev(max_profit=2.0, max_loss=1.0, prob_profit=0.70)
        self.assertGreater(ev, 0.0)

    def test_negative_ev_when_prob_low_and_loss_large(self):
        ev = compute_ev(max_profit=1.0, max_loss=5.0, prob_profit=0.20)
        self.assertLess(ev, 0.0)

    def test_zero_ev_at_breakeven(self):
        # prob=0.5, profit=loss → EV = 0
        ev = compute_ev(max_profit=1.0, max_loss=1.0, prob_profit=0.50)
        self.assertAlmostEqual(ev, 0.0, places=4)

    def test_ev_formula_manual_check(self):
        # EV = 0.6 * 2.0 - 0.4 * 1.0 = 1.2 - 0.4 = 0.8
        ev = compute_ev(max_profit=2.0, max_loss=1.0, prob_profit=0.60)
        self.assertAlmostEqual(ev, 0.8, places=4)

    def test_prob_clamped_above_1(self):
        # prob > 1.0 should be clamped — EV should equal the normal max
        ev_clamped = compute_ev(max_profit=1.0, max_loss=1.0, prob_profit=1.5)
        ev_normal = compute_ev(max_profit=1.0, max_loss=1.0, prob_profit=1.0)
        self.assertAlmostEqual(ev_clamped, ev_normal, places=4)

    def test_prob_clamped_below_0(self):
        ev_clamped = compute_ev(max_profit=1.0, max_loss=1.0, prob_profit=-0.5)
        ev_normal = compute_ev(max_profit=1.0, max_loss=1.0, prob_profit=0.0)
        self.assertAlmostEqual(ev_clamped, ev_normal, places=4)

    def test_ev_returns_float(self):
        ev = compute_ev(max_profit=2.0, max_loss=1.0, prob_profit=0.6)
        self.assertIsInstance(ev, float)


# ---------------------------------------------------------------------------
# compute_kelly_metrics tests
# ---------------------------------------------------------------------------

class TestComputeKellyMetrics(unittest.TestCase):

    def test_half_kelly_never_exceeds_cap(self):
        """Key invariant: half_kelly_fraction <= HALF_KELLY_CAP (0.20)."""
        test_cases = [
            (10.0, 1.0),    # enormous edge
            (5.0, 1.0),
            (2.0, 1.0),
            (1.0, 1.0),
            (0.5, 1.0),
            (0.1, 1.0),
        ]
        for ev, max_loss in test_cases:
            _, half_kelly, _ = compute_kelly_metrics(ev, max_loss)
            self.assertLessEqual(
                half_kelly, HALF_KELLY_CAP,
                msg=f"half_kelly={half_kelly} exceeds cap={HALF_KELLY_CAP} for EV={ev}, loss={max_loss}"
            )

    def test_zero_max_loss_returns_zeros(self):
        kf, hkf, er = compute_kelly_metrics(1.0, 0.0)
        self.assertAlmostEqual(kf, 0.0, places=4)
        self.assertAlmostEqual(hkf, 0.0, places=4)
        self.assertAlmostEqual(er, 0.0, places=4)

    def test_negative_max_loss_returns_zeros(self):
        kf, hkf, er = compute_kelly_metrics(1.0, -1.0)
        self.assertAlmostEqual(kf, 0.0, places=4)
        self.assertAlmostEqual(hkf, 0.0, places=4)
        self.assertAlmostEqual(er, 0.0, places=4)

    def test_negative_ev_returns_zero_kelly(self):
        kf, hkf, er = compute_kelly_metrics(-0.5, 1.0)
        self.assertAlmostEqual(kf, 0.0, places=4)
        self.assertAlmostEqual(hkf, 0.0, places=4)

    def test_edge_ratio_equals_ev_over_max_loss(self):
        _, _, er = compute_kelly_metrics(0.5, 2.0)
        self.assertAlmostEqual(er, 0.25, places=4)

    def test_half_kelly_is_half_of_capped_kelly(self):
        kf, hkf, _ = compute_kelly_metrics(0.10, 1.0)
        # kelly=0.1, half=0.05; neither hits cap
        self.assertAlmostEqual(hkf, kf * 0.5, places=4)

    def test_returns_three_element_tuple(self):
        result = compute_kelly_metrics(1.0, 2.0)
        self.assertEqual(len(result), 3)

    def test_half_kelly_cap_is_0_20(self):
        self.assertAlmostEqual(HALF_KELLY_CAP, 0.20, places=4)


# ---------------------------------------------------------------------------
# expected_stock_move tests
# ---------------------------------------------------------------------------

class TestExpectedStockMove(unittest.TestCase):

    def test_returns_positive_value_for_valid_inputs(self):
        move = expected_stock_move(price=100.0, iv_pct=25.0, dte=30)
        self.assertGreater(move, 0.0)

    def test_higher_iv_produces_larger_move(self):
        move_low_iv = expected_stock_move(price=100.0, iv_pct=15.0, dte=30)
        move_high_iv = expected_stock_move(price=100.0, iv_pct=50.0, dte=30)
        self.assertGreater(move_high_iv, move_low_iv)

    def test_longer_dte_produces_larger_move(self):
        move_short = expected_stock_move(price=100.0, iv_pct=25.0, dte=10)
        move_long = expected_stock_move(price=100.0, iv_pct=25.0, dte=60)
        self.assertGreater(move_long, move_short)

    def test_zero_iv_returns_fallback(self):
        move = expected_stock_move(price=100.0, iv_pct=0.0, dte=30)
        # Fallback is price * 0.05
        self.assertAlmostEqual(move, 5.0, places=2)

    def test_zero_price_returns_zero(self):
        move = expected_stock_move(price=0.0, iv_pct=25.0, dte=30)
        self.assertAlmostEqual(move, 0.0, places=2)

    def test_higher_price_produces_larger_absolute_move(self):
        move_cheap = expected_stock_move(price=10.0, iv_pct=25.0, dte=30)
        move_expensive = expected_stock_move(price=500.0, iv_pct=25.0, dte=30)
        self.assertGreater(move_expensive, move_cheap)


# ---------------------------------------------------------------------------
# pick_expiry_by_dte helper tests
# ---------------------------------------------------------------------------

class TestPickExpiryByDTE(unittest.TestCase):

    def test_picks_date_within_range(self):
        dates = [_future_date(10), _future_date(30), _future_date(50)]
        expiry = pick_expiry_by_dte(dates, 21, 42)
        self.assertEqual(expiry, _future_date(30))

    def test_returns_none_when_no_date_in_range(self):
        dates = [_future_date(3), _future_date(10)]
        expiry = pick_expiry_by_dte(dates, 21, 42)
        self.assertIsNone(expiry)

    def test_empty_list_returns_none(self):
        expiry = pick_expiry_by_dte([], 21, 42)
        self.assertIsNone(expiry)


# ---------------------------------------------------------------------------
# run_engine integration tests
# ---------------------------------------------------------------------------

class TestRunEngineReturnType(unittest.TestCase):

    def setUp(self):
        self.signals = _make_signals(directional_bias="Bullish", bias_confidence=70, iv_rank=30)
        expiry = _future_date(30)
        self.calls, self.puts = _make_option_chain(price=100.0, expiry=expiry)
        self.option_dates = [_future_date(30), _future_date(45)]

    def test_returns_list(self):
        result = run_engine(self.signals, self.calls, self.puts, self.option_dates)
        self.assertIsInstance(result, list)

    def test_returns_empty_list_when_no_valid_expiry(self):
        # No dates within any DTE window
        result = run_engine(self.signals, self.calls, self.puts, [])
        self.assertEqual(result, [])

    def test_each_candidate_is_trade_candidate_instance(self):
        result = run_engine(self.signals, self.calls, self.puts, self.option_dates)
        for tc in result:
            self.assertIsInstance(tc, TradeCandidate)

    def test_candidates_have_positive_expected_value(self):
        """After EV filter, all returned candidates must have EV > 0."""
        result = run_engine(self.signals, self.calls, self.puts, self.option_dates)
        for tc in result:
            self.assertGreater(tc.expected_value, 0.0,
                               msg=f"Negative EV for {tc.strategy}: {tc.expected_value}")

    def test_candidates_have_required_attributes(self):
        result = run_engine(self.signals, self.calls, self.puts, self.option_dates)
        for tc in result:
            self.assertIsInstance(tc.strategy, str)
            self.assertIsInstance(tc.max_profit, (int, float))
            self.assertIsInstance(tc.max_loss, (int, float))
            self.assertIsInstance(tc.expected_value, (int, float))
            self.assertIsInstance(tc.half_kelly_fraction, (int, float))
            self.assertIsInstance(tc.kelly_fraction, (int, float))

    def test_kelly_fraction_never_exceeds_cap(self):
        result = run_engine(self.signals, self.calls, self.puts, self.option_dates)
        for tc in result:
            self.assertLessEqual(
                tc.half_kelly_fraction, HALF_KELLY_CAP,
                msg=f"half_kelly_fraction={tc.half_kelly_fraction} exceeds cap for {tc.strategy}"
            )

    def test_results_sorted_by_total_score_descending(self):
        result = run_engine(self.signals, self.calls, self.puts, self.option_dates)
        if len(result) >= 2:
            for i in range(len(result) - 1):
                self.assertGreaterEqual(
                    result[i].total_score, result[i + 1].total_score,
                    msg="Results not sorted by total_score descending"
                )

    def test_max_6_results_returned(self):
        result = run_engine(self.signals, self.calls, self.puts, self.option_dates)
        self.assertLessEqual(len(result), 6)


class TestRunEngineLongOnlyMode(unittest.TestCase):

    def setUp(self):
        self.signals = _make_signals(directional_bias="Bullish", bias_confidence=70, iv_rank=30)
        expiry = _future_date(30)
        self.calls, self.puts = _make_option_chain(price=100.0, expiry=expiry)
        self.option_dates = [_future_date(30), _future_date(45)]

    def test_long_only_returns_only_debit_strategies(self):
        result = run_engine(
            self.signals, self.calls, self.puts, self.option_dates,
            strategy_mode="long_only"
        )
        credit_strategies = {
            "Bull Put Spread", "Bear Call Spread", "Iron Condor",
            "Short Put", "Short Call", "Covered Call", "Cash-Secured Put",
            "Covered Put",
        }
        for tc in result:
            self.assertNotIn(
                tc.strategy, credit_strategies,
                msg=f"long_only mode returned credit strategy: {tc.strategy}"
            )

    def test_long_only_no_credit_strategies(self):
        result = run_engine(
            self.signals, self.calls, self.puts, self.option_dates,
            strategy_mode="long_only"
        )
        credit_strategies = {
            "Bull Put Spread", "Bear Call Spread", "Iron Condor",
            "Short Put", "Short Call", "Covered Call", "Cash-Secured Put",
        }
        for tc in result:
            self.assertNotIn(
                tc.strategy, credit_strategies,
                msg=f"long_only mode returned credit strategy: {tc.strategy}"
            )


class TestRunEngineBearishMode(unittest.TestCase):

    def setUp(self):
        self.signals = _make_signals(
            directional_bias="Bearish", bias_confidence=70, iv_rank=30
        )
        expiry = _future_date(30)
        self.calls, self.puts = _make_option_chain(price=100.0, expiry=expiry)
        self.option_dates = [_future_date(30), _future_date(45)]

    def test_long_only_bearish_returns_list(self):
        result = run_engine(
            self.signals, self.calls, self.puts, self.option_dates,
            strategy_mode="long_only"
        )
        self.assertIsInstance(result, list)


if __name__ == "__main__":
    unittest.main()
