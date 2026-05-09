"""
Trader Decision State layer for day-trade interpretation (education / decision support).

Derives categorical guidance from tape context (SPY/QQQ), session % change, VWAP,
and bull/bear scores — without replacing numeric scores.
"""
from __future__ import annotations

from typing import Any, Literal, Optional

MarketState = Literal["MARKET_SUPPORTIVE", "MARKET_WEAK", "MARKET_MIXED"]
RelativeStrength = Literal["STRONG", "NEUTRAL", "WEAK"]
TraderState = Literal[
    "STRONG_RELATIVE_STRENGTH",
    "RELATIVE_STRENGTH_LONG_WATCH",
    "LONG_CONFIRMATION_WATCH",
    "AVOID_CALLS",
    "WEAK_BREAKDOWN_WATCH",
    "VERY_WEAK_EXTENDED",
    "NEUTRAL_WEAK",
    "NO_TRADE_WAIT",
    "BROAD_MARKET_WEAK",
    "BROAD_MARKET_SUPPORTIVE",
    "BROAD_MARKET_MIXED",
]
CallBias = Literal["GO", "WATCH_LONG", "WAIT_CONFIRMATION", "AVOID"]
PutBias = Literal["GO", "WATCH_BREAKDOWN", "WAIT_FOR_FRESH_BREAKDOWN", "AVOID"]
SuggestedAction = Literal[
    "WATCH_LONG_ONLY",
    "WATCH_PUT_BREAKDOWN",
    "AVOID_CALLS",
    "AVOID_CHASING_PUTS",
    "NO_TRADE",
    "WAIT_FOR_CONFIRMATION",
]


def _market_state(spy_pct: Optional[float], qqq_pct: Optional[float]) -> MarketState:
    if spy_pct is None or qqq_pct is None:
        return "MARKET_MIXED"
    if spy_pct < 0 and qqq_pct < 0:
        return "MARKET_WEAK"
    if spy_pct > 0 and qqq_pct > 0:
        return "MARKET_SUPPORTIVE"
    return "MARKET_MIXED"


def _market_guidance(ms: MarketState) -> str:
    if ms == "MARKET_WEAK":
        return "Avoid random calls. Only consider longs in stocks showing strong relative strength."
    if ms == "MARKET_SUPPORTIVE":
        return "Long setups are allowed, but still require stock confirmation."
    return "Be selective. Avoid weak stocks. Prefer relative strength names."


def _relative_strength_label(
    stock_pct: Optional[float], qqq_session_pct: Optional[float]
) -> RelativeStrength:
    if stock_pct is None or qqq_session_pct is None:
        return "NEUTRAL"
    diff = stock_pct - qqq_session_pct
    if diff >= 1.0:
        return "STRONG"
    if diff <= -1.0:
        return "WEAK"
    return "NEUTRAL"


def _risk_warning(vix: Optional[float], market_state: MarketState) -> str:
    parts: list[str] = []
    if vix is not None and vix >= 30:
        parts.append("Elevated VIX — wider swings; size down and use clear invalidation.")
    if market_state == "MARKET_WEAK":
        parts.append("Broad tape soft — favor confirmation over anticipation.")
    if not parts:
        return "Not execution advice — confirm price action and your plan before risk."
    return " ".join(parts)


def build_trader_decision(
    *,
    ticker: str,
    stock_session_pct: Optional[float],
    above_vwap: bool,
    bull_score: float,
    bear_score: float,
    spy_session_pct: Optional[float],
    qqq_session_pct: Optional[float],
    spy_daily_pct: Optional[float],
    qqq_daily_pct: Optional[float],
    vix: Optional[float],
) -> dict[str, Any]:
    """
    Returns structured interpretation for one symbol (stock or index).

    Uses session RTH % for stock vs QQQ relative strength when available; falls back
    to daily SPY/QQQ % for market_state when session values are missing.
    """
    t = ticker.strip().upper()
    spy_mkt, qqq_mkt = spy_session_pct, qqq_session_pct
    if spy_mkt is None:
        spy_mkt = spy_daily_pct
    if qqq_mkt is None:
        qqq_mkt = qqq_daily_pct
    market_state = _market_state(spy_mkt, qqq_mkt)
    market_guidance = _market_guidance(market_state)
    # Use the same fallback QQQ value used for market_state so RS doesn't silently
    # return NEUTRAL whenever intraday session data is unavailable.
    rel = _relative_strength_label(stock_session_pct, qqq_mkt)

    # --- Broad market rows (SPY / QQQ as watchlist items) ---
    if t in ("SPY", "QQQ"):
        label = "Broad market (SPY)" if t == "SPY" else "Tech beta (QQQ)"
        if market_state == "MARKET_WEAK":
            ts: TraderState = "BROAD_MARKET_WEAK"
            msg = (
                f"{label} is weak. Reduce call confidence across the watchlist; "
                "only take longs in strong relative strength names."
            )
            cb: CallBias = "AVOID"
            pb: PutBias = "AVOID"
            sa: SuggestedAction = "AVOID_CALLS"
            conf = ["QQQ remains weak" if t == "SPY" else "SPY remains weak", "volume expansion"]
        elif market_state == "MARKET_SUPPORTIVE":
            ts = "BROAD_MARKET_SUPPORTIVE"
            msg = f"{label} is supportive. Longs allowed but still require per-stock confirmation."
            cb = "WAIT_CONFIRMATION"
            pb = "AVOID"
            sa = "WAIT_FOR_CONFIRMATION"
            conf = ["hold pullback", "break intraday high"]
        else:
            ts = "BROAD_MARKET_MIXED"
            msg = f"{label} is mixed. Be selective; avoid weak single names."
            cb = "WAIT_CONFIRMATION"
            pb = "AVOID"
            sa = "WAIT_FOR_CONFIRMATION"
            conf = ["tape alignment", "relative strength vs QQQ", "above VWAP"]
        return {
            "ticker": t,
            "market_state": market_state,
            "market_guidance": market_guidance,
            "relative_strength": "NEUTRAL",
            "trader_state": ts,
            "call_bias": cb,
            "put_bias": pb,
            "suggested_action": sa,
            "decision_message": msg,
            "risk_warning": _risk_warning(vix, market_state),
            "confirmation_needed": conf,
        }

    # --- Equity names ---
    sp = stock_session_pct
    if sp is None:
        return {
            "ticker": t,
            "market_state": market_state,
            "market_guidance": market_guidance,
            "relative_strength": rel,
            "trader_state": "NO_TRADE_WAIT",
            "call_bias": "WAIT_CONFIRMATION",
            "put_bias": "AVOID",
            "suggested_action": "NO_TRADE",
            "decision_message": "Session change unavailable — wait for a clean quote and refreshed scan.",
            "risk_warning": _risk_warning(vix, market_state),
            "confirmation_needed": ["session data"],
        }

    qqq_s = qqq_session_pct
    below_vwap = not above_vwap

    # Precedence-ordered classification
    trader_state: TraderState = "NO_TRADE_WAIT"
    decision_message = "No clean edge. Wait for VWAP, breakout, or breakdown confirmation."
    call_bias: CallBias = "WAIT_CONFIRMATION"
    put_bias: PutBias = "AVOID"
    suggested_action: SuggestedAction = "NO_TRADE"
    confirmation_needed: list[str] = ["above VWAP", "volume expansion"]

    if sp <= -4.0:
        trader_state = "VERY_WEAK_EXTENDED"
        decision_message = (
            f"{t} is very weak and already extended down. Avoid calls. "
            "Do not chase puts unless it breaks a new low after a weak bounce."
        )
        call_bias = "AVOID"
        put_bias = "WAIT_FOR_FRESH_BREAKDOWN"
        suggested_action = "AVOID_CHASING_PUTS"
        confirmation_needed = ["break day low", "failed bounce", "volume expansion"]
    elif sp > 0 and qqq_s is not None and qqq_s < 0:
        trader_state = "RELATIVE_STRENGTH_LONG_WATCH"
        decision_message = (
            f"{t} is green while QQQ session is red — relative strength. "
            "Watch long only if above VWAP and breaking resistance."
        )
        call_bias = "WATCH_LONG"
        put_bias = "AVOID"
        suggested_action = "WATCH_LONG_ONLY"
        confirmation_needed = ["above VWAP", "break intraday high", "QQQ remains weak"]
    elif sp <= -2.0 and below_vwap:
        trader_state = "WEAK_BREAKDOWN_WATCH"
        decision_message = (
            f"{t} is weak and below VWAP. Put candidate only on fresh breakdown, "
            "failed bounce, or lower-low confirmation — not on hope."
        )
        call_bias = "AVOID"
        put_bias = "WATCH_BREAKDOWN"
        suggested_action = "WATCH_PUT_BREAKDOWN"
        confirmation_needed = ["break day low", "failed bounce", "lower-low confirmation"]
    elif -1.0 <= sp <= 0.0:
        trader_state = "NEUTRAL_WEAK"
        decision_message = "Mild weakness. Not a strong long or put candidate — wait for a cleaner setup."
        call_bias = "WAIT_CONFIRMATION"
        put_bias = "AVOID"
        suggested_action = "NO_TRADE"
        confirmation_needed = ["break intraday high", "break day low", "volume expansion"]
    elif market_state == "MARKET_WEAK" and sp < 0:
        trader_state = "AVOID_CALLS"
        decision_message = "Market is weak and the stock is red. Avoid random calls."
        call_bias = "AVOID"
        put_bias = "AVOID"
        suggested_action = "AVOID_CALLS"
        confirmation_needed = ["failed bounce", "QQQ remains weak"]
    elif (
        sp > 0
        and above_vwap
        and rel == "STRONG"
        and bull_score >= 5.0
    ):
        trader_state = "STRONG_RELATIVE_STRENGTH"
        decision_message = (
            "Strong leader vs QQQ with constructive tape. Best long watchlist candidate — "
            "still avoid chasing extended candles; wait for pullback or hold."
        )
        call_bias = "WATCH_LONG"
        put_bias = "AVOID"
        suggested_action = "WATCH_LONG_ONLY"
        confirmation_needed = ["hold pullback", "VWAP hold", "volume expansion"]
    elif (
        market_state in ("MARKET_SUPPORTIVE", "MARKET_MIXED")
        and sp > 0
        and above_vwap
        and bull_score > bear_score
    ):
        trader_state = "LONG_CONFIRMATION_WATCH"
        decision_message = (
            "Long candidate structure. Entry only on VWAP hold, breakout continuation, "
            "or a controlled pullback — not on FOMO."
        )
        call_bias = "WATCH_LONG"
        put_bias = "AVOID"
        suggested_action = "WAIT_FOR_CONFIRMATION"
        confirmation_needed = ["above VWAP", "break intraday high", "hold pullback"]

    return {
        "ticker": t,
        "market_state": market_state,
        "market_guidance": market_guidance,
        "relative_strength": rel,
        "trader_state": trader_state,
        "call_bias": call_bias,
        "put_bias": put_bias,
        "suggested_action": suggested_action,
        "decision_message": decision_message,
        "risk_warning": _risk_warning(vix, market_state),
        "confirmation_needed": confirmation_needed,
    }
