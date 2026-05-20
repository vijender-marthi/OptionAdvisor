"""
Unit tests for the Swing Trade Decision Quality Layer.

Tests run build_swing_trade_decision() directly — no yfinance calls needed.
All Phase 2 fields default to None unless explicitly set per test.
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from swing_trade import build_swing_trade_decision, _compute_swing_bias


# ─── _compute_swing_bias ─────────────────────────────────────────────

def test_swing_bias_strong_bullish():
    assert _compute_swing_bias(8.5, 1.5) == "STRONG_BULLISH"

def test_swing_bias_bullish():
    assert _compute_swing_bias(6.5, 2.5) == "BULLISH"

def test_swing_bias_bearish():
    assert _compute_swing_bias(2.5, 6.5) == "BEARISH"

def test_swing_bias_strong_bearish():
    assert _compute_swing_bias(1.0, 9.0) == "STRONG_BEARISH"

def test_swing_bias_neutral_tight():
    assert _compute_swing_bias(4.5, 4.5) == "NEUTRAL"

def test_swing_bias_neutral_mixed():
    # Bull is 6 but bear is 4 — doesn't meet bear <= 3 threshold
    assert _compute_swing_bias(6.0, 4.0) == "NEUTRAL"


# ─── Market ETF special case ─────────────────────────────────────────

def test_spy_classified_as_market_context_only():
    d = build_swing_trade_decision(
        "SPY", bull_score=8.0, bear_score=1.0, market_context="MARKET_SUPPORTIVE",
        rsi_val=62.0, dist_ma20_pct=2.0, mom_5d_pct=1.5, vol_ratio=1.1,
    )
    assert d["decision_label"] == "MARKET_CONFIRMATION_ONLY"
    assert d["entry_quality"]  == "MARKET_CONFIRMATION_ONLY"
    assert d["final_action"]   == "WATCH_CALL"
    assert d["swing_bias"]     == "STRONG_BULLISH"

def test_qqq_bearish_classified_as_market_context_only():
    d = build_swing_trade_decision(
        "QQQ", bull_score=1.0, bear_score=8.5, market_context="MARKET_WEAK",
        rsi_val=38.0, dist_ma20_pct=-3.0, mom_5d_pct=-2.0,
    )
    assert d["decision_label"] == "MARKET_CONFIRMATION_ONLY"
    assert d["final_action"]   == "WATCH_PUT"

def test_iwm_neutral_market_etf_no_trade():
    d = build_swing_trade_decision(
        "IWM", bull_score=4.0, bear_score=4.5, market_context="MARKET_MIXED",
    )
    assert d["decision_label"] == "MARKET_CONFIRMATION_ONLY"
    assert d["final_action"]   == "NO_TRADE"


# ─── QUALITY_LONG / STRONG_GO ────────────────────────────────────────

def test_quality_long_strong_go():
    """High quality score + low risk + good entry → STRONG_GO."""
    d = build_swing_trade_decision(
        "NVDA", bull_score=8.0, bear_score=1.5,
        market_context="MARKET_SUPPORTIVE",
        rsi_val=62.0, dist_ma20_pct=2.5, mom_5d_pct=2.0,
        vol_ratio=1.8, vol_label="bull_expanding",
    )
    assert d["final_action"]       == "STRONG_GO"
    assert d["entry_quality"]      == "GOOD_ENTRY"
    assert d["decision_label"]     == "QUALITY_LONG"
    assert d["trade_quality_score"] >= 8.0
    assert d["risk_level"]         in ("LOW", "MEDIUM")

def test_quality_long_watch_call_debit_spread():
    """Good but not stellar quality → WATCH_CALL_OR_DEBIT_SPREAD.
    bull=6.5 + MARKET_SUPPORTIVE +1.0 = 7.5  →  stays below 8.0 STRONG_GO threshold.
    """
    d = build_swing_trade_decision(
        "MSFT", bull_score=6.5, bear_score=2.0,
        market_context="MARKET_SUPPORTIVE",
        rsi_val=60.0, dist_ma20_pct=3.0, mom_5d_pct=2.0,
        vol_ratio=1.1, vol_label="mixed",
    )
    assert d["final_action"]   == "WATCH_CALL_OR_DEBIT_SPREAD"
    assert d["entry_quality"]  == "GOOD_ENTRY"
    assert d["decision_label"] == "QUALITY_LONG"


# ─── Extended entry (BULLISH_BUT_EXTENDED) ───────────────────────────

def test_strong_bullish_but_5d_extended_wait_pullback():
    """Bull score high but 5-day move > 8% → WAIT_PULLBACK."""
    d = build_swing_trade_decision(
        "SNDK", bull_score=9.5, bear_score=0.5,
        market_context="MARKET_SUPPORTIVE",
        rsi_val=71.0, dist_ma20_pct=9.0, mom_5d_pct=9.5,
        vol_ratio=2.0, vol_label="bull_expanding",
    )
    assert d["final_action"]   == "WAIT_PULLBACK"
    assert d["entry_quality"]  == "WAIT_PULLBACK"
    assert d["decision_label"] == "BULLISH_BUT_EXTENDED"
    # Extension penalty -2.0 is real: without it the uncapped score would be 10.0
    # (9.5 + 1.0 mkt + 1.0 vol), but extension brings it to 9.5 < 10.0.
    assert d["trade_quality_score"] < 10.0

def test_very_extended_avoid_chase():
    """5-day move > 12% → AVOID_CHASE, LATE_ENTRY."""
    d = build_swing_trade_decision(
        "WDC", bull_score=10.0, bear_score=0.0,
        market_context="MARKET_SUPPORTIVE",
        rsi_val=78.0, dist_ma20_pct=13.0, mom_5d_pct=14.0,
        vol_ratio=2.5, vol_label="bull_expanding",
    )
    assert d["final_action"]   == "AVOID_CHASE"
    assert d["entry_quality"]  == "LATE_ENTRY"
    assert d["decision_label"] == "BULLISH_BUT_EXTENDED"
    assert d["avoid_reason"] is not None
    assert "14.0%" in d["avoid_reason"] or "14" in d["avoid_reason"]

def test_overbought_rsi_triggers_wait_pullback():
    """RSI > 72 with otherwise clean setup → WAIT_PULLBACK."""
    d = build_swing_trade_decision(
        "ARM", bull_score=7.5, bear_score=1.5,
        market_context="MARKET_SUPPORTIVE",
        rsi_val=74.0, dist_ma20_pct=4.0, mom_5d_pct=4.0,
        vol_ratio=1.2, vol_label="bull_expanding",
    )
    assert d["final_action"]   == "WAIT_PULLBACK"
    assert d["decision_label"] == "BULLISH_BUT_EXTENDED"
    # confirmation should mention RSI
    assert any("RSI" in c for c in d["confirmation_needed"])


# ─── Earnings risk ────────────────────────────────────────────────────

def test_earnings_imminent_avoid_naked_calls():
    """earnings_within_days <= 2 → AVOID_NAKED_CALLS regardless of score."""
    d = build_swing_trade_decision(
        "AAPL", bull_score=8.0, bear_score=1.5,
        market_context="MARKET_SUPPORTIVE",
        rsi_val=60.0, dist_ma20_pct=2.0, mom_5d_pct=2.0,
        earnings_within_days=1,
    )
    assert d["final_action"]   == "AVOID_NAKED_CALLS"
    assert d["risk_level"]     == "VERY_HIGH"
    assert d["decision_label"] == "BULLISH_BUT_EARNINGS_RISK"
    assert "EARNINGS_IMMINENT" in d["risk_flags"]
    assert d["avoid_reason"] is not None

def test_earnings_soon_penalises_score():
    """earnings_within_days = 4 → risk HIGH, score penalised, flag set."""
    d_no_earn = build_swing_trade_decision(
        "TSLA", bull_score=7.0, bear_score=2.0,
        market_context="MARKET_SUPPORTIVE",
        rsi_val=60.0, dist_ma20_pct=2.0, mom_5d_pct=2.0,
    )
    d_earn = build_swing_trade_decision(
        "TSLA", bull_score=7.0, bear_score=2.0,
        market_context="MARKET_SUPPORTIVE",
        rsi_val=60.0, dist_ma20_pct=2.0, mom_5d_pct=2.0,
        earnings_within_days=4,
    )
    assert "EARNINGS_SOON" in d_earn["risk_flags"]
    assert d_earn["trade_quality_score"] < d_no_earn["trade_quality_score"]
    assert d_earn["risk_level"] in ("HIGH", "VERY_HIGH")


# ─── IV risk → debit spread preferred ────────────────────────────────

def test_high_iv_prefers_credit_spread():
    """iv_rank >= 70 → PUT_CREDIT_SPREAD (bull put), not debit spread or naked long."""
    d = build_swing_trade_decision(
        "NVDA", bull_score=8.0, bear_score=1.5,
        market_context="MARKET_SUPPORTIVE",
        rsi_val=62.0, dist_ma20_pct=2.0, mom_5d_pct=2.0,
        iv_rank=75.0,
    )
    assert d["suggested_strategy"] == "PUT_CREDIT_SPREAD", \
        f"iv_rank=75 bullish should be PUT_CREDIT_SPREAD, got {d['suggested_strategy']}"
    assert "IV_HIGH" in d["risk_flags"]

def test_very_high_iv_risk_upgraded():
    """iv_rank >= 85 → risk_level at least HIGH and PUT_CREDIT_SPREAD."""
    d = build_swing_trade_decision(
        "NVDA", bull_score=8.0, bear_score=1.5,
        market_context="MARKET_SUPPORTIVE",
        rsi_val=62.0, dist_ma20_pct=2.0, mom_5d_pct=2.0,
        iv_rank=88.0,
    )
    assert "IV_VERY_HIGH" in d["risk_flags"]
    assert d["risk_level"] in ("HIGH", "VERY_HIGH")
    assert d["suggested_strategy"] == "PUT_CREDIT_SPREAD", \
        f"iv_rank=88 bullish should be PUT_CREDIT_SPREAD, got {d['suggested_strategy']}"

def test_low_iv_good_entry_allows_long_call():
    """iv_rank is None (Phase 1 default) + strong setup → LONG_CALL allowed."""
    d = build_swing_trade_decision(
        "NVDA", bull_score=9.0, bear_score=1.0,
        market_context="MARKET_SUPPORTIVE",
        rsi_val=62.0, dist_ma20_pct=2.0, mom_5d_pct=2.0,
        vol_ratio=2.0, vol_label="bull_expanding",
        iv_rank=None,
    )
    assert d["final_action"]      == "STRONG_GO"
    assert d["suggested_strategy"] == "LONG_CALL"

def test_strong_go_moderate_iv_suggests_long_call():
    """Regression: STRONG_GO + iv_rank=50 must return LONG_CALL, not CALL_DEBIT_SPREAD.
    The old bug placed iv_rank>=50 check before the STRONG_GO check, making
    LONG_CALL unreachable for any ticker with moderate IV (most of the market).
    """
    d = build_swing_trade_decision(
        "MU", bull_score=9.0, bear_score=1.0,
        market_context="MARKET_SUPPORTIVE",
        rsi_val=60.0, dist_ma20_pct=1.5, mom_5d_pct=2.0,
        vol_ratio=1.8, vol_label="bull_expanding",
        iv_rank=50.0,
    )
    assert d["final_action"]       == "STRONG_GO", f"expected STRONG_GO, got {d['final_action']}"
    assert d["suggested_strategy"] == "LONG_CALL", \
        f"STRONG_GO + iv_rank=50 should be LONG_CALL, got {d['suggested_strategy']}"

def test_strong_go_iv_60_suggests_spread():
    """STRONG_GO + iv_rank=60 → CALL_DEBIT_SPREAD (IV crosses the spread threshold)."""
    d = build_swing_trade_decision(
        "MU", bull_score=9.0, bear_score=1.0,
        market_context="MARKET_SUPPORTIVE",
        rsi_val=60.0, dist_ma20_pct=1.5, mom_5d_pct=2.0,
        vol_ratio=1.8, vol_label="bull_expanding",
        iv_rank=60.0,
    )
    assert d["suggested_strategy"] == "CALL_DEBIT_SPREAD", \
        f"STRONG_GO + iv_rank=60 should be CALL_DEBIT_SPREAD, got {d['suggested_strategy']}"


# ─── Credit spread selection ──────────────────────────────────────────

def test_very_high_iv_bullish_suggests_put_credit_spread():
    """iv_rank >= 70, non-STRONG_GO bullish setup → PUT_CREDIT_SPREAD (Bull Put)."""
    d = build_swing_trade_decision(
        "NVDA", bull_score=7.5, bear_score=2.0,
        market_context="MARKET_SUPPORTIVE",
        rsi_val=58.0, dist_ma20_pct=2.5, mom_5d_pct=1.5,
        iv_rank=75.0,
    )
    assert d["suggested_strategy"] == "PUT_CREDIT_SPREAD", \
        f"iv_rank=75, bullish should be PUT_CREDIT_SPREAD, got {d['suggested_strategy']}"

def test_very_high_iv_bearish_suggests_call_credit_spread():
    """iv_rank >= 70, bearish setup → CALL_CREDIT_SPREAD (Bear Call)."""
    d = build_swing_trade_decision(
        "NVDA", bull_score=2.0, bear_score=8.0,
        market_context="MARKET_WEAK",
        rsi_val=42.0, dist_ma20_pct=-2.5, mom_5d_pct=-2.0,
        iv_rank=72.0,
    )
    assert d["suggested_strategy"] == "CALL_CREDIT_SPREAD", \
        f"iv_rank=72, bearish should be CALL_CREDIT_SPREAD, got {d['suggested_strategy']}"

def test_strong_go_iv_75_suggests_put_credit_spread():
    """STRONG_GO + iv_rank >= 75 → PUT_CREDIT_SPREAD even on best setup."""
    d = build_swing_trade_decision(
        "MU", bull_score=9.0, bear_score=1.0,
        market_context="MARKET_SUPPORTIVE",
        rsi_val=60.0, dist_ma20_pct=1.5, mom_5d_pct=2.0,
        vol_ratio=1.8, vol_label="bull_expanding",
        iv_rank=78.0,
    )
    assert d["suggested_strategy"] == "PUT_CREDIT_SPREAD", \
        f"STRONG_GO + iv_rank=78 should be PUT_CREDIT_SPREAD, got {d['suggested_strategy']}"

def test_earnings_very_high_iv_suggests_credit_spread():
    """Earnings imminent + iv_rank >= 70 → credit spread over debit spread."""
    d = build_swing_trade_decision(
        "AAPL", bull_score=8.0, bear_score=1.5,
        market_context="MARKET_SUPPORTIVE",
        rsi_val=60.0, dist_ma20_pct=1.5, mom_5d_pct=1.5,
        earnings_within_days=2, iv_rank=74.0,
    )
    assert d["suggested_strategy"] == "PUT_CREDIT_SPREAD", \
        f"Earnings + iv_rank=74 bullish should be PUT_CREDIT_SPREAD, got {d['suggested_strategy']}"

def test_moderate_iv_still_debit_spread():
    """iv_rank=55 (elevated but < 70) + non-STRONG_GO → CALL_DEBIT_SPREAD, not credit spread."""
    d = build_swing_trade_decision(
        "TSLA", bull_score=6.0, bear_score=2.5,  # lower score → not STRONG_GO
        market_context="MARKET_SUPPORTIVE",
        rsi_val=58.0, dist_ma20_pct=2.0, mom_5d_pct=1.5,
        iv_rank=55.0,
    )
    assert d["suggested_strategy"] == "CALL_DEBIT_SPREAD", \
        f"iv_rank=55 non-STRONG_GO should be CALL_DEBIT_SPREAD (not credit), got {d['suggested_strategy']}"


# ─── Low liquidity → NO_TRADE ────────────────────────────────────────

def test_low_liquidity_rejects_trade():
    """option_liquidity_score < 4 → NO_TRADE regardless of score."""
    d = build_swing_trade_decision(
        "THINSTOCK", bull_score=9.0, bear_score=1.0,
        market_context="MARKET_SUPPORTIVE",
        rsi_val=65.0, dist_ma20_pct=2.0, mom_5d_pct=3.0,
        option_liquidity_score=2.0,
    )
    assert d["final_action"]   == "NO_TRADE"
    assert d["entry_quality"]  == "BAD_ENTRY"
    assert d["decision_label"] == "NO_TRADE_WAIT"
    assert "LOW_OPTION_LIQUIDITY" in d["risk_flags"]
    assert d["avoid_reason"] is not None


# ─── Market context impact ────────────────────────────────────────────

def test_weak_market_penalises_bullish_score():
    """MARKET_WEAK reduces trade_quality_score for bullish setups."""
    d_sup = build_swing_trade_decision(
        "AMD", bull_score=7.0, bear_score=2.0,
        market_context="MARKET_SUPPORTIVE",
        rsi_val=60.0, dist_ma20_pct=2.0, mom_5d_pct=2.0,
    )
    d_wk = build_swing_trade_decision(
        "AMD", bull_score=7.0, bear_score=2.0,
        market_context="MARKET_WEAK",
        rsi_val=60.0, dist_ma20_pct=2.0, mom_5d_pct=2.0,
    )
    assert d_wk["trade_quality_score"] < d_sup["trade_quality_score"]

def test_weak_market_does_not_penalise_bearish_setup():
    """MARKET_WEAK should NOT penalise bearish setups (it supports bears)."""
    d_sup = build_swing_trade_decision(
        "XYZ", bull_score=1.5, bear_score=8.0,
        market_context="MARKET_SUPPORTIVE",
        rsi_val=40.0, dist_ma20_pct=-3.0, mom_5d_pct=-2.5,
    )
    d_wk = build_swing_trade_decision(
        "XYZ", bull_score=1.5, bear_score=8.0,
        market_context="MARKET_WEAK",
        rsi_val=40.0, dist_ma20_pct=-3.0, mom_5d_pct=-2.5,
    )
    # Weak market should HELP bears — score should be higher (or equal) vs supportive
    assert d_wk["trade_quality_score"] >= d_sup["trade_quality_score"]

def test_market_mixed_adds_confirmation():
    """MARKET_MIXED market → confirmation_needed includes SPY/QQQ note."""
    d = build_swing_trade_decision(
        "MU", bull_score=7.5, bear_score=2.0,
        market_context="MARKET_MIXED",
        rsi_val=60.0, dist_ma20_pct=2.0, mom_5d_pct=2.0,
    )
    assert any("SPY" in c or "QQQ" in c for c in d["confirmation_needed"])


# ─── Near resistance ─────────────────────────────────────────────────

def test_near_resistance_triggers_wait_breakout():
    d = build_swing_trade_decision(
        "GOOG", bull_score=7.0, bear_score=2.0,
        market_context="MARKET_SUPPORTIVE",
        rsi_val=60.0, dist_ma20_pct=3.0, mom_5d_pct=2.0,
        near_resistance=True,
    )
    assert d["final_action"]  in ("WAIT_BREAKOUT",)
    assert d["entry_quality"] == "WAIT_BREAKOUT_CONFIRMATION"
    assert any("resistance" in c.lower() for c in d["confirmation_needed"])


# ─── VIX gate ────────────────────────────────────────────────────────

def test_vix_no_go_forces_no_trade():
    """VIX >= VIX_NO_GO (35) → hard NO_TRADE, matching scoring engine's NO-GO verdict."""
    d = build_swing_trade_decision(
        "SPX", bull_score=8.0, bear_score=1.5,
        market_context="MARKET_MIXED",
        rsi_val=58.0, dist_ma20_pct=2.0, mom_5d_pct=2.0,
        vix_level=38.0,
    )
    assert d["final_action"]   == "NO_TRADE"
    assert d["decision_label"] == "NO_TRADE_WAIT"
    assert d["risk_level"]     == "VERY_HIGH"
    assert d["avoid_reason"]   is not None
    assert "VIX_EXTREME"  in d["risk_flags"]
    assert "VIX_ELEVATED" in d["risk_flags"]

def test_vix_caution_elevated_but_allows_trade():
    """VIX 28-34 → risk HIGH (VIX_ELEVATED) but trade still permitted."""
    d = build_swing_trade_decision(
        "AAPL", bull_score=8.0, bear_score=1.5,
        market_context="MARKET_SUPPORTIVE",
        rsi_val=60.0, dist_ma20_pct=2.0, mom_5d_pct=2.0,
        vix_level=30.0,
    )
    assert d["final_action"]   != "NO_TRADE"
    assert d["risk_level"]     in ("HIGH", "VERY_HIGH")
    assert "VIX_ELEVATED" in d["risk_flags"]


# ─── Neutral / weak setups ───────────────────────────────────────────

def test_neutral_swing_bias_returns_weak_setup():
    d = build_swing_trade_decision(
        "MEME", bull_score=4.0, bear_score=4.0,
        market_context="MARKET_MIXED",
        rsi_val=50.0, dist_ma20_pct=0.0, mom_5d_pct=0.0,
    )
    assert d["decision_label"] in ("WEAK_SETUP", "NO_TRADE_WAIT")
    assert d["final_action"]   == "NO_TRADE"

def test_low_score_no_trade():
    """Score too low even with bullish bias → NO_TRADE."""
    d = build_swing_trade_decision(
        "WEAK", bull_score=4.5, bear_score=1.5,
        market_context="MARKET_WEAK",   # penalty applied
        rsi_val=55.0, dist_ma20_pct=1.0, mom_5d_pct=1.0,
    )
    # With MARKET_WEAK penalty of -2, effective base = 4.5 - 2 = 2.5 → NO_TRADE
    assert d["final_action"] == "NO_TRADE"


# ─── Bearish setups ───────────────────────────────────────────────────

def test_bearish_quality_returns_watch_put():
    d = build_swing_trade_decision(
        "SHORT_CAND", bull_score=1.5, bear_score=8.0,
        market_context="MARKET_WEAK",
        rsi_val=40.0, dist_ma20_pct=-3.0, mom_5d_pct=-3.0,
        vol_ratio=1.8, vol_label="bear_expanding",
    )
    assert d["final_action"]  in ("WATCH_PUT", "STRONG_GO")
    assert d["swing_bias"]    in ("BEARISH", "STRONG_BEARISH")

def test_bearish_extended_oversold_triggers_wait():
    """RSI < 28 on a bearish setup → is_extended → WAIT_FOR_BREAKDOWN."""
    d = build_swing_trade_decision(
        "FALLING", bull_score=1.0, bear_score=9.0,
        market_context="MARKET_WEAK",
        rsi_val=24.0, dist_ma20_pct=-9.0, mom_5d_pct=-9.5,
        vol_ratio=2.0, vol_label="bear_expanding",
    )
    assert d["final_action"] in ("WAIT_FOR_BREAKDOWN", "WAIT_PULLBACK")
    assert d["entry_quality"] == "WAIT_PULLBACK"


# ─── Quality score bounds ────────────────────────────────────────────

def test_quality_score_never_exceeds_10():
    d = build_swing_trade_decision(
        "PERFECT", bull_score=11.0, bear_score=0.0,
        market_context="MARKET_SUPPORTIVE",
        rsi_val=65.0, dist_ma20_pct=1.0, mom_5d_pct=1.0,
        vol_ratio=3.0, vol_label="bull_expanding",
    )
    assert d["trade_quality_score"] <= 10.0

def test_quality_score_never_below_zero():
    d = build_swing_trade_decision(
        "TERRIBLE", bull_score=2.0, bear_score=1.5,
        market_context="MARKET_WEAK",
        rsi_val=55.0, dist_ma20_pct=2.0, mom_5d_pct=2.0,
        earnings_within_days=1,
        iv_rank=90.0,
        option_liquidity_score=1.0,
    )
    assert d["trade_quality_score"] >= 0.0


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
