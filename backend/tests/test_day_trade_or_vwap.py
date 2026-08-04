"""Unit tests for the OR/VWAP directional framework scoring rules."""

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from day_trade_or_vwap import compute_or_vwap_framework  # noqa: E402


def _score(**kw):
    base = dict(
        price=100.0, today_vwap=100.0, prev_vwap=100.0,
        or_high=101.0, or_low=99.0, vwap_slope_pct=0.0,
        gap_pct=0.0, minutes_since_open=40.0,
    )
    base.update(kw)
    return compute_or_vwap_framework(**base)


def test_aapl_worked_example_slope_flips_no_trade_into_half_short():
    # From the spec: price 305.17, VWAP 305.56, prev VWAP 303.63, broke ORL, VWAP declining.
    r = _score(
        price=305.17, today_vwap=305.56, prev_vwap=303.63,
        or_high=307.50, or_low=305.20, vwap_slope_pct=-0.10,
    )
    assert r["valid"] is True
    assert r["tests"]["priceVsVwap"]["value"] == -1
    assert r["tests"]["vwapVsPrevVwap"]["value"] == 1     # raw Test 2
    assert r["tests"]["priceVsOpeningRange"]["value"] == -1
    assert r["rawScore"] == -1                             # suspect / no-trade before the modifier
    assert r["modifiers"]["slopeDowngradedTest2"] is True
    assert r["score"] == -2                                # slope downgrade -> half-size short
    assert r["direction"] == "BEAR"
    assert r["sizing"] == "half"


def test_trend_day_up_full_long():
    r = _score(price=102.0, today_vwap=100.5, prev_vwap=100.0, or_high=101.0, or_low=99.0, vwap_slope_pct=0.2)
    assert r["score"] == 3
    assert r["direction"] == "BULL"
    assert r["sizing"] == "full"
    assert r["conviction"] == "HIGH"


def test_trend_day_down_full_short():
    r = _score(price=98.0, today_vwap=99.5, prev_vwap=100.0, or_high=101.0, or_low=99.0, vwap_slope_pct=-0.2)
    assert r["score"] == -3
    assert r["direction"] == "BEAR"
    assert r["sizing"] == "full"


def test_bullish_waiting_inside_or_is_half():
    # Above VWAP, value up, inside OR -> +2.
    r = _score(price=100.4, today_vwap=100.2, prev_vwap=100.0, or_high=101.0, or_low=99.0, vwap_slope_pct=0.1)
    assert r["tests"]["priceVsOpeningRange"]["value"] == 0
    assert r["score"] == 2
    assert r["sizing"] == "half"


def test_conflict_is_no_trade():
    # Above VWAP (+1), value migrated down (-1), inside OR (0) -> 0.
    r = _score(price=100.3, today_vwap=100.1, prev_vwap=100.5, or_high=101.0, or_low=99.0, vwap_slope_pct=0.0)
    assert r["score"] == 0
    assert r["sizing"] == "none"
    assert r["conviction"] == "NO_TRADE"


def test_inside_or_returns_zero_for_test3():
    r = _score(price=100.0, or_high=101.0, or_low=99.0)
    assert r["tests"]["priceVsOpeningRange"]["value"] == 0


def test_before_945_is_invalid():
    r = _score(minutes_since_open=10.0)
    assert r["valid"] is False
    assert "opening range" in r["invalidReason"].lower()


def test_after_1030_blocks_new_entries_but_stays_valid():
    r = _score(price=102.0, today_vwap=100.5, prev_vwap=100.0, vwap_slope_pct=0.2, minutes_since_open=120.0)
    assert r["valid"] is True
    assert r["timing"]["allowsNewEntry"] is False
    assert r["timing"]["state"] == "management"


def test_after_1545_auction_distortion_invalid():
    r = _score(minutes_since_open=400.0)
    assert r["valid"] is False
    assert "auction" in r["invalidReason"].lower()


def test_gap_over_5pct_skips_ticker():
    r = _score(gap_pct=6.0)
    assert r["valid"] is False
    assert r["disabled"] is True


def test_gap_over_3pct_voids_test2():
    r = _score(price=102.0, today_vwap=100.5, prev_vwap=100.0, or_high=101.0, or_low=99.0, gap_pct=3.5, vwap_slope_pct=0.2)
    assert r["tests"]["vwapVsPrevVwap"]["value"] == 0
    assert r["tests"]["vwapVsPrevVwap"]["void"]
    # +1 (price>VWAP) + 0 (voided) + 1 (broke ORH) = 2
    assert r["score"] == 2


def test_post_earnings_voids_test2():
    r = _score(prev_vwap=90.0, post_earnings=True)
    assert r["tests"]["vwapVsPrevVwap"]["value"] == 0
    assert "earnings" in (r["tests"]["vwapVsPrevVwap"]["void"] or "").lower()


def test_wide_opening_range_suppresses_test3():
    # OR range = 10 vs 20-day avg 2 -> >2x -> Test 3 suppressed.
    r = _score(price=112.0, or_high=110.0, or_low=100.0, today_vwap=105.0, prev_vwap=104.0, or_range_avg20=2.0, vwap_slope_pct=0.1)
    assert r["tests"]["priceVsOpeningRange"]["value"] == 0
    assert any("wide" in w.lower() for w in r["warnings"])


def test_slope_agreeing_does_not_downgrade():
    r = _score(price=102.0, today_vwap=100.5, prev_vwap=100.0, or_high=101.0, or_low=99.0, vwap_slope_pct=0.3)
    assert r["modifiers"]["slopeDowngradedTest2"] is False
    assert r["score"] == 3


def test_missing_inputs_are_invalid_not_crash():
    r = compute_or_vwap_framework(price=None, today_vwap=None, prev_vwap=None, or_high=None, or_low=None)
    assert r["valid"] is False
    assert r["score"] == 0
