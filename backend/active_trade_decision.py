"""
Deterministic intraday guidance for **active** day-trade option positions (education / copy-only).

Uses **underlying** spot fields aligned with the day-trade engine (VWAP, opening range, session %,
volume spike, RS vs QQQ) — not option mid — so levels match the 1m RTH tape.

State → action (display) mapping
--------------------------------
- HOLD_BREAKOUT           → "Hold"
- HOLD_BREAKDOWN          → "Hold"
- HOLD_CONFIRMATION       → "Hold"
- WAITING_FOR_BREAKOUT    → "Wait" (messages still describe breakout vs breakdown by side)
- WEAKENING               → "Consider exit / trim"
- EXIT_WEAKNESS           → "Consider exit / trim"
- NO_ACTION               → "No action"
"""
from __future__ import annotations

import math
from datetime import date, datetime
from typing import Any, Literal, Optional

Side = Literal["CALL", "PUT"]
State = Literal[
    "HOLD_BREAKOUT",
    "HOLD_BREAKDOWN",
    "HOLD_CONFIRMATION",
    "WAITING_FOR_BREAKOUT",
    "WEAKENING",
    "EXIT_WEAKNESS",
    "NO_ACTION",
]
BadgeTone = Literal["green", "orange", "red", "gray"]


def _f(x: Any) -> Optional[float]:
    if x is None:
        return None
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(v) else v


def _b(x: Any) -> bool:
    return bool(x)


def _side(x: Any) -> Side:
    s = str(x or "").strip().upper()
    return "PUT" if s == "PUT" else "CALL"


def _dte(expiry: Any) -> Optional[int]:
    """Days to expiry from today. Returns None if unparseable."""
    if expiry is None:
        return None
    try:
        exp = expiry if isinstance(expiry, date) else datetime.strptime(str(expiry)[:10], "%Y-%m-%d").date()
        return max(0, (exp - date.today()).days)
    except (ValueError, TypeError):
        return None


def _market_stress(spy: Optional[float], qqq: Optional[float], vix: Optional[float]) -> bool:
    if vix is not None and vix >= 32:
        return True
    if spy is not None and spy <= -1.5:
        return True
    if qqq is not None and qqq <= -1.5:
        return True
    return False


def build_active_trade_decision(
    position_row: dict[str, Any],
    market_context: dict[str, Any],
    intraday_data: dict[str, Any],
) -> dict[str, Any]:
    """
    Build a deterministic state + UX payload for one active position.

    position_row: ticker, side (CALL|PUT), entry_price (option premium at entry), optional
      entry_underlying_px, opened_at_ms, id, strike, expiry
    market_context: spy_change_pct, qqq_change_pct, spy_session_change_pct, qqq_session_change_pct, vix
    intraday_data: underlying_last or last_price, session_change_pct, vwap, or_high, or_low,
      or_breakout (above|below|inside), momentum_pct, volume_spike, rs_vs_qqq_pct (optional)

    Returns keys: state, action, message, badge_tone, risk_warning, confirmation_needed (list[str]),
    trend_direction (str), intraday_snapshot_note (str; short clarification on price basis).
    """
    side = _side(position_row.get("side"))
    dte = _dte(position_row.get("expiry") or position_row.get("option_expiry"))
    strike = _f(position_row.get("strike"))

    spy_d = _f(market_context.get("spy_change_pct"))
    qqq_d = _f(market_context.get("qqq_change_pct"))
    vix = _f(market_context.get("vix"))

    last = _f(intraday_data.get("underlying_last"))
    if last is None:
        last = _f(intraday_data.get("last_price"))
    vwap = _f(intraday_data.get("vwap"))
    or_high = _f(intraday_data.get("or_high"))
    or_low = _f(intraday_data.get("or_low"))
    or_raw = str(intraday_data.get("or_breakout") or intraday_data.get("or_state") or "").strip().lower()
    if or_raw in ("above", "below", "inside"):
        or_state = or_raw
    else:
        or_state = "inside"
    mom = _f(intraday_data.get("momentum_pct"))
    if mom is None:
        mom = 0.0
    vol_spike = _b(intraday_data.get("volume_spike"))
    rs = _f(intraday_data.get("rs_vs_qqq_pct"))

    above_vwap = last is not None and vwap is not None and last > vwap
    below_vwap = last is not None and vwap is not None and last < vwap

    # Trend label from tape
    trend_direction = "flat"
    if last is not None and vwap is not None:
        dist = (last / vwap - 1.0) * 100.0 if vwap > 0 else 0.0
        if dist > 0.12:
            trend_direction = "up"
        elif dist < -0.12:
            trend_direction = "down"

    stress = _market_stress(spy_d, qqq_d, vix)
    risk_warning = (
        "VIX elevated and/or tape heavy — prioritize tight risk and clear invalidation. "
        if stress
        else "Not execution advice — confirm with your plan and live quotes before acting."
    )

    def finish(
        state: State,
        action: str,
        message: str,
        badge: BadgeTone,
        conf: list[str],
    ) -> dict[str, Any]:
        return {
            "state": state,
            "action": action,
            "message": message,
            "badge_tone": badge,
            "risk_warning": risk_warning,
            "confirmation_needed": conf,
            "trend_direction": trend_direction,
            "intraday_snapshot_note": "Underlying regular-session last vs session VWAP and opening range.",
        }

    # Missing core tape — surface neutral
    if last is None or vwap is None or or_high is None or or_low is None:
        return finish(
            "NO_ACTION",
            "No action",
            "Insufficient intraday snapshot — wait for a fresh underlying quote.",
            "gray",
            ["Need last price, VWAP, and opening range from the session feed."],
        )

    if side == "CALL":
        # Invalidation: breakdown below opening range (bearish vs long-delta thesis)
        # With meaningful DTE remaining (>5 days), a shallow breach of OR low is a warning,
        # not an immediate invalidation — give the trade room to recover to its strike.
        if or_state == "below" or last < or_low:
            orl_breach_pct = ((or_low - last) / or_low * 100) if or_low and or_low > 0 else 0.0
            # Moneyness: how far is underlying from strike (negative = OTM for CALL)
            otm_pct = ((last - strike) / strike * 100) if strike and strike > 0 else None
            has_time = dte is not None and dte > 5
            shallow_breach = orl_breach_pct < 1.0  # within 1% of OR low
            near_strike = otm_pct is not None and otm_pct > -8.0  # not deeply OTM

            if has_time and shallow_breach and near_strike:
                dte_note = f"{dte}d to expiry" if dte is not None else "time remaining"
                otm_note = (
                    f"${strike:.2f} strike is {abs(otm_pct):.1f}% away — manageable with {dte_note}."
                    if otm_pct is not None and otm_pct < 0
                    else f"${strike:.2f} strike — underlying is at/near strike with {dte_note}."
                    if otm_pct is not None
                    else f"Strike has {dte_note}."
                )
                return finish(
                    "WEAKENING",
                    "Consider exit / trim",
                    f"Price slipped below OR low — bullish thesis is under pressure but a shallow breach with time remaining warrants monitoring over an immediate exit. {otm_note}",
                    "orange",
                    [
                        "Trim to a core position rather than full exit if the breach is less than 1% below OR low.",
                        "A reclaim of OR low restores the setup — watch for a bounce with volume.",
                        "Exit fully if price loses another 1-2% from here or fails to reclaim OR low by midday.",
                    ],
                )
            else:
                depth_note = f" ({orl_breach_pct:.1f}% below OR low)" if orl_breach_pct > 0 else ""
                time_note = f" ({dte}d to expiry)" if dte is not None else ""
                return finish(
                    "EXIT_WEAKNESS",
                    "Consider exit / trim",
                    f"Price is below the opening range / range low{depth_note}{time_note} — bullish thesis is challenged.",
                    "red",
                    ["Review stop / spread: underlying broke the session opening structure to the downside."],
                )
        # Soft failure: lost VWAP with weak RS and negative momentum
        if below_vwap and mom < -0.1 and (rs is not None and rs < -0.35):
            return finish(
                "EXIT_WEAKNESS",
                "Consider exit / trim",
                "Below VWAP with lagging RS vs QQQ and negative tape momentum — downside risk dominates.",
                "red",
                ["If you still hold size, treat this as an invalidation unless price reclaims VWAP quickly."],
            )
        # Clear continuation
        if or_state == "above" and above_vwap:
            msg = (
                "Above opening-range high and VWAP — bullish structure intact for the session."
                + (" Volume expansion confirms." if vol_spike else " No volume spike yet — watch for thrust.")
            )
            return finish(
                "HOLD_BREAKOUT",
                "Hold",
                msg,
                "green",
                [] if vol_spike else ["Prefer a volume-confirmed hold; trim if thrust fails."],
            )
        # Inside range but constructive
        if or_state == "inside" and above_vwap and mom >= -0.05:
            call_conf = [
                "Wait for a clean break and hold above OR high for continuation.",
                "Avoid adding until volume expands on a breakout move.",
            ]
            if not vol_spike:
                call_conf.append("Volume confirmation still lacking — size accordingly.")
            return finish(
                "HOLD_CONFIRMATION",
                "Hold",
                "Constructive but inside the opening range — hold core only if VWAP holds.",
                "orange",
                call_conf,
            )
        # Inside tape, under VWAP but still above OR low — soft (before generic "wait")
        if or_state == "inside" and below_vwap:
            return finish(
                "WEAKENING",
                "Consider exit / trim",
                "Below VWAP while still inside the opening range — structure is softening.",
                "orange",
                ["Consider trimming; a reclaim above VWAP is needed to restore bullish control."],
            )
        # Still inside / below ORH — patience (VWAP not lost to trimming path above)
        if or_state == "inside" and last <= or_high:
            return finish(
                "WAITING_FOR_BREAKOUT",
                "Wait",
                "Inside the opening range — waiting for a decisive break above OR high with follow-through.",
                "orange",
                [
                    "Do not chase; require breakout + (ideally) volume.",
                    "If VWAP is lost before the break, downgrade conviction.",
                ],
            )
        # Above range hook but VWAP lost — trim zone
        if or_state == "above" and below_vwap:
            return finish(
                "WEAKENING",
                "Consider exit / trim",
                "Breakout is losing VWAP — momentum may be stalling; reduce risk into strength if offered.",
                "orange",
                ["Reclaim of VWAP would improve the picture; otherwise treat as failed follow-through."],
            )
        return finish(
            "NO_ACTION",
            "No action",
            "Call thesis — session structure vs VWAP/OR is ambiguous from the ruleset.",
            "gray",
            ["Reassess after clearer VWAP / opening-range alignment."],
        )

    # PUT
    if side == "PUT":
        if or_state == "above" or last > or_high:
            orh_breach_pct = ((last - or_high) / or_high * 100) if or_high and or_high > 0 else 0.0
            otm_pct = ((strike - last) / strike * 100) if strike and strike > 0 else None  # negative = OTM for PUT
            has_time = dte is not None and dte > 5
            shallow_breach = orh_breach_pct < 1.0
            near_strike = otm_pct is not None and otm_pct > -8.0

            if has_time and shallow_breach and near_strike:
                dte_note = f"{dte}d to expiry" if dte is not None else "time remaining"
                otm_note = (
                    f"${strike:.2f} strike is {abs(otm_pct):.1f}% away — manageable with {dte_note}."
                    if otm_pct is not None and otm_pct < 0
                    else f"${strike:.2f} strike — underlying is at/near strike with {dte_note}."
                    if otm_pct is not None
                    else f"Strike has {dte_note}."
                )
                return finish(
                    "WEAKENING",
                    "Consider exit / trim",
                    f"Price edged above OR high — bearish thesis is under pressure but a shallow breach with time remaining warrants monitoring. {otm_note}",
                    "orange",
                    [
                        "Trim to a core position rather than full exit if the breach is less than 1% above OR high.",
                        "A rejection back below OR high restores the setup — watch for a reversal with volume.",
                        "Exit fully if price extends another 1-2% above OR high or fails to roll by midday.",
                    ],
                )
            else:
                depth_note = f" ({orh_breach_pct:.1f}% above OR high)" if orh_breach_pct > 0 else ""
                time_note = f" ({dte}d to expiry)" if dte is not None else ""
                return finish(
                    "EXIT_WEAKNESS",
                    "Consider exit / trim",
                    f"Price is above the opening range high{depth_note}{time_note} — bearish thesis is challenged.",
                    "red",
                    ["Review risk: underlying reclaimed the opening structure to the upside."],
                )
        if above_vwap and mom > 0.08 and (rs is not None and rs > 0.35):
            return finish(
                "EXIT_WEAKNESS",
                "Consider exit / trim",
                "Reclaiming VWAP with positive momentum and strong RS — puts are swimming upstream.",
                "red",
                ["Treat as invalidation unless price rolls back below VWAP with momentum fading."],
            )
        if or_state == "below" and below_vwap:
            msg = "Below opening-range low and VWAP — bearish continuation structure."
            if vol_spike:
                msg += " Volume confirms the move."
            return finish(
                "HOLD_BREAKDOWN",
                "Hold",
                msg,
                "green",
                [] if vol_spike else ["Continuation strongest when volume expands on breakdowns."],
            )
        if or_state == "inside" and below_vwap and mom <= 0.02:
            return finish(
                "HOLD_CONFIRMATION",
                "Hold",
                "Soft tape under VWAP but inside the opening range — bearish bias needs a clean OR low break.",
                "orange",
                ["Prefer a breakdown print through OR low before adding.", "Watch for sharp VWAP rips."],
            )
        if or_state == "inside" and last >= or_low:
            return finish(
                "WAITING_FOR_BREAKOUT",
                "Wait",
                "Inside the opening range — waiting for a decisive break below OR low.",
                "orange",
                [
                    "Patience: confirmation on expansion + follow-through.",
                    f"If {trend_direction} accelerates above VWAP, stand down on new size.",
                ],
            )
        if or_state == "below" and above_vwap:
            return finish(
                "WEAKENING",
                "Consider exit / trim",
                "Breakdown is losing VWAP to the upside — bounce risk; reduce size into flush.",
                "orange",
                ["A failure back under VWAP restores conviction for continuation."],
            )
        return finish(
            "NO_ACTION",
            "No action",
            "Put thesis — session structure vs VWAP/OR is ambiguous from the ruleset.",
            "gray",
            ["Reassess after clearer failure at VWAP or a clean break under OR low."],
        )

    return finish(
        "NO_ACTION",
        "No action",
        "Side not recognized — no action.",
        "gray",
        [],
    )
