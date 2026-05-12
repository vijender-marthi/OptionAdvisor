from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any, Optional

import bar_cache


def _float_or(x: Any, default: float = 0.0) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return default


def _get_underlying_data(ticker: str) -> dict[str, Any]:
    try:
        h = bar_cache.get_history(ticker, period="3mo", interval="1d", auto_adjust=True)
        if h is None or h.empty:
            return {}
        c = h["Close"].dropna()
        if len(c) < 5:
            return {}
        current = float(c.iloc[-1])
        ma20 = float(c.tail(20).mean())
        ma50 = float(c.tail(50).mean()) if len(c) >= 50 else ma20
        max_3mo = float(c.max())
        min_3mo = float(c.min())
        gains = c.diff()
        avg_gain = gains.clip(lower=0).tail(14).mean()
        avg_loss = (-gains.clip(upper=0)).tail(14).mean()
        rsi = 50.0
        if avg_loss > 0:
            rs = avg_gain / avg_loss
            rsi = 100.0 - (100.0 / (1.0 + rs))
        rsi_val = float(rsi.iloc[-1]) if hasattr(rsi, "iloc") else float(rsi) if isinstance(rsi, (int, float)) else 50.0

        mom_5d = (float(c.iloc[-1]) / float(c.iloc[-6]) - 1) * 100 if len(c) >= 6 else 0.0
        mom_10d = (float(c.iloc[-1]) / float(c.iloc[-11]) - 1) * 100 if len(c) >= 11 else 0.0
        top_5 = c.tail(5)
        mom_streak_count = 0
        for i in range(len(top_5) - 1, 0, -1):
            if float(top_5.iloc[i]) > float(top_5.iloc[i - 1]):
                mom_streak_count += 1
            else:
                break

        return {
            "current_price": current,
            "ma20": ma20,
            "ma50": ma50,
            "max_3mo": max_3mo,
            "min_3mo": min_3mo,
            "rsi": round(rsi_val, 1),
            "mom_5d": round(mom_5d, 2),
            "mom_10d": round(mom_10d, 2),
            "mom_streak_count": mom_streak_count,
            "bar_count": len(c),
        }
    except Exception:
        return {}


def _extension_risk(ext_pct: float) -> str:
    if abs(ext_pct) > 15:
        return "HIGH"
    if abs(ext_pct) > 8:
        return "MODERATE"
    return "LOW"


def _theta_risk(dte: float) -> str:
    if dte <= 3:
        return "CRITICAL"
    if dte <= 7:
        return "HIGH"
    if dte <= 14:
        return "MODERATE"
    return "LOW"


def _rsi_risk(rsi: float) -> str:
    if rsi > 80:
        return "HIGH"
    if rsi > 70:
        return "MODERATE"
    if rsi < 30:
        return "HIGH"
    if rsi < 40:
        return "MODERATE"
    return "LOW"


def _momentum_quality(mom_5d: float, mom_10d: float, streak: int) -> str:
    if mom_5d > 3 and mom_10d > 5 and streak >= 3:
        return "STRONG"
    if mom_5d > 1 and mom_10d > 2:
        return "MODERATE"
    if mom_5d < -1 or mom_10d < -2:
        return "DEGRADING"
    return "WEAKENING"


def _strategy_family(strategy: str) -> str:
    s = strategy.lower()
    if "call" in s and "spread" not in s and "condor" not in s:
        return "LONG_CALL"
    if "put" in s and "spread" not in s and "condor" not in s:
        return "LONG_PUT"
    if "call" in s and "spread" in s:
        return "BULL_CALL_SPREAD"
    if "put" in s and "spread" in s:
        return "BEAR_PUT_SPREAD"
    if "covered" in s:
        return "COVERED_CALL"
    if "iron" in s or "condor" in s:
        return "IRON_CONDOR"
    if "spread" in s:
        return "CREDIT_SPREAD"
    return "LONG_CALL"


def analyze_active_position(
    position: dict[str, Any],
    pnl_data: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    ticker = str(position.get("ticker") or "").upper()
    strategy = str(position.get("strategy") or "")
    family = _strategy_family(strategy)
    bias = str(position.get("bias") or "").lower()

    dte = _float_or(position.get("dte"), 999)
    if dte <= 0:
        dte = 999
    entry_price = _float_or(position.get("entryPrice"), 0.0)
    contracts = max(1, _float_or(position.get("contracts"), 1.0))
    max_profit = _float_or(position.get("max_profit"), 0.0)
    max_loss = _float_or(position.get("max_loss"), 0.0)

    underlying = _get_underlying_data(ticker)
    current_price = underlying.get("current_price", entry_price)
    ma20 = underlying.get("ma20", current_price)
    rsi = _float_or(underlying.get("rsi"), 50.0)

    extension_pct = 0.0
    if ma20 > 0:
        extension_pct = round((current_price / ma20 - 1) * 100, 1)

    pnl_pct = 0.0
    pnl_dollar = 0.0
    if pnl_data:
        pnl_pct = _float_or(pnl_data.get("pnl_pct"), 0.0)
        pnl_dollar = _float_or(pnl_data.get("pnl"), 0.0)
    else:
        if max_loss > 0 and max_profit > 0:
            cap = max_loss * 100 * contracts
            if cap > 0:
                pnl_pct = round((pnl_dollar / cap) * 100, 1)

    pnl_abs = abs(pnl_pct) if pnl_pct else 0.0
    is_profit = pnl_pct > 0
    is_significant_profit = pnl_pct > 30
    is_large_profit = pnl_pct > 100

    mom_q = _momentum_quality(
        _float_or(underlying.get("mom_5d")),
        _float_or(underlying.get("mom_10d")),
        int(underlying.get("mom_streak_count", 0)),
    )

    ext_risk = _extension_risk(extension_pct)
    theta_risk_val = _theta_risk(dte)
    rsi_risk_val = _rsi_risk(rsi)

    score = 50
    trend_score = _float_or(underlying.get("mom_5d"), 0.0)
    if is_profit:
        score += int(min(pnl_abs * 0.15, 20))
    else:
        score -= int(min(pnl_abs * 0.2, 15))
    if mom_q == "STRONG":
        score += 15
    elif mom_q == "MODERATE":
        score += 5
    elif mom_q == "DEGRADING":
        score -= 10
    if dte > 30:
        score += 5
    elif dte < 7:
        score -= 15
    elif dte < 14:
        score -= 5
    if rsi < 30 or rsi > 80:
        score -= 10
    elif rsi < 40 or rsi > 70:
        score -= 5
    if abs(extension_pct) > 15:
        score -= 10
    elif abs(extension_pct) > 8:
        score -= 5
    score = max(0, min(100, score))

    if score >= 90:
        health_label = "STRONG_TREND"
    elif score >= 75:
        health_label = "HEALTHY"
    elif score >= 60:
        health_label = "CAUTION"
    elif score >= 40:
        health_label = "WEAKENING"
    else:
        health_label = "EXIT_WATCH"

    ai_state = "LET_RUN"
    state_label = "Let Run"
    next_action = "Hold current size and monitor."
    timeline_stage = "HOLD"

    if dte <= 3:
        ai_state = "EXIT_NOW"
        state_label = "Exit Now"
        next_action = f"Position expires in {int(dte)} day(s). Close or roll immediately."
        timeline_stage = "EXIT_SOON"
    elif dte <= 7:
        if is_profit:
            ai_state = "ROLL_SOON"
            state_label = "Roll Soon"
            next_action = "Consider rolling to next expiry to avoid gamma/theta acceleration."
            timeline_stage = "ROLL_WINDOW"
        else:
            ai_state = "REDUCE_RISK"
            state_label = "Reduce Risk"
            next_action = "Limited time remaining. Consider reducing size or exiting."
            timeline_stage = "EXIT_SOON"
    elif dte <= 14:
        if is_large_profit:
            ai_state = "PROTECT_GAINS"
            state_label = "Protect Gains"
            next_action = "Solid gains with approaching expiry. Protect profits and trail stops."
            timeline_stage = "PROFIT_PROTECTION"
        elif is_profit:
            ai_state = "TREND_CONTINUATION"
            state_label = "Continuation Active"
            next_action = "Trend still intact. Let run with defined risk."
            timeline_stage = "CONTINUATION"
        else:
            ai_state = "REDUCE_RISK"
            state_label = "Reduce Risk"
            next_action = "Losing position with limited time. Consider cutting losses."
            timeline_stage = "RISK_MANAGEMENT"
    elif is_large_profit:
        if ext_risk == "HIGH" or rsi > 75:
            ai_state = "SCALE_PROFITS"
            state_label = "Scale Profits"
            next_action = "Significant extension. Scale out 25-50% and let runner ride."
            timeline_stage = "PROFIT_PROTECTION"
        else:
            ai_state = "PROTECT_GAINS"
            state_label = "Protect Gains"
            next_action = "Strong profits. Trail stops higher, protect downside."
            timeline_stage = "PROFIT_PROTECTION"
    elif is_significant_profit:
        if mom_q == "STRONG" or mom_q == "MODERATE":
            ai_state = "LET_RUN"
            state_label = "Let Run"
            next_action = "Momentum supportive. Hold current position with trailing stop."
            timeline_stage = "CONTINUATION"
        else:
            ai_state = "SCALE_PROFITS"
            state_label = "Scale Profits"
            next_action = "Momentum slowing. Consider taking partial profits."
            timeline_stage = "REDUCE"
    elif is_profit:
        if mom_q == "STRONG":
            ai_state = "TREND_CONTINUATION"
            state_label = "Trend Continuation"
            next_action = "Modest gains with strong momentum. Let it develop."
            timeline_stage = "CONTINUATION"
        else:
            ai_state = "LET_RUN"
            state_label = "Let Run"
            next_action = "Early stage. Hold and monitor for confirmation."
            timeline_stage = "EARLY"
    else:
        if mom_q == "DEGRADING" or rsi < 35:
            ai_state = "EXIT_MOMENTUM"
            state_label = "Exit Momentum"
            next_action = "Momentum fading against the position. Consider reducing."
            timeline_stage = "EXIT_SOON"
        elif dte > 30:
            ai_state = "RELOAD_ZONE"
            state_label = "Reload Zone"
            next_action = "Losing but plenty of time. Wait for structure improvement."
            timeline_stage = "RISK_MANAGEMENT"
        else:
            ai_state = "REDUCE_RISK"
            state_label = "Reduce Risk"
            next_action = "Position not working. Reduce size or exit."
            timeline_stage = "RISK_MANAGEMENT"

    trend_risk = "LOW" if mom_q in ("STRONG", "MODERATE") else "HIGH" if mom_q == "DEGRADING" else "MODERATE"
    iv_risk = "LOW"
    liquidity_risk = "LOW"
    market_corr_risk = "MODERATE"

    if family == "LONG_CALL":
        if rsi > 75:
            iv_risk = "HIGH"
        elif rsi > 65:
            iv_risk = "MODERATE"
        theta_risk_val = _theta_risk(dte)
        if is_large_profit and ext_risk == "HIGH":
            trend_risk = "MODERATE"
        ai_summary = f"{ticker} long call {'profitable' if is_profit else 'in drawdown'}. "
        if is_large_profit:
            ai_summary += f"Position up {pnl_abs:.0f}%. Momentum {'supportive' if mom_q in ('STRONG','MODERATE') else 'slowing'}. "
            if ext_risk == "HIGH":
                ai_summary += "Extension elevated. Protect gains."
            else:
                ai_summary += "Let runner continue with protection."
        elif is_profit:
            ai_summary += f"Gaining ({pnl_abs:.0f}% return) with {mom_q.lower()} momentum. Hold while structure holds."
        else:
            ai_summary += f"Down {pnl_abs:.0f}%. "
            if dte > 14:
                ai_summary += "Time remaining to recover. Monitor for structure improvement."
            else:
                ai_summary += "Limited time remaining. Evaluate exit."
    elif family == "BULL_CALL_SPREAD":
        value_capture = 0.0
        if max_profit > 0:
            value_capture = min(100, round((pnl_dollar / (max_profit * 100 * contracts)) * 100, 1))
        else:
            value_capture = min(100, pnl_abs)

        theta_risk_val = "MODERATE" if dte < 21 else _theta_risk(dte)
        if value_capture > 70:
            ai_state = "SCALE_PROFITS"
            state_label = "Scale Profits"
            next_action = f"Spread {value_capture:.0f}% captured. Consider closing."
            timeline_stage = "PROFIT_PROTECTION"
        elif value_capture > 50 and mom_q != "STRONG":
            ai_state = "PROTECT_GAINS"
            state_label = "Protect Gains"
            next_action = f"Good value capture ({value_capture:.0f}%). Protect with trailing stop."
            timeline_stage = "PROFIT_PROTECTION"
        ai_summary = f"{ticker} bull call spread at {value_capture:.0f}% value capture. Capped upside limits acceleration participation."
        if ext_risk == "HIGH":
            ai_summary += " Extension elevated."
    elif family == "COVERED_CALL":
        ai_summary = f"{ticker} covered call. "
        if ext_risk == "HIGH":
            ai_summary += "Short call under pressure from extension. Consider rolling up/out."
            next_action = "Roll short call higher or further out to capture more premium."
            if ai_state in ("LET_RUN", "TREND_CONTINUATION"):
                ai_state = "ROLL_SOON"
                state_label = "Roll Soon"
                timeline_stage = "ROLL_WINDOW"
        else:
            ai_summary += "Range intact. Collecting premium."
    elif family == "IRON_CONDOR":
        width = _float_or(position.get("spread_width"), 0.0)
        theta_risk_val = "LOW" if dte > 21 else "MODERATE" if dte > 7 else "HIGH"
        short_wing_risk = "MODERATE"
        if extension_pct > 3:
            short_wing_risk = "HIGH"
        ai_summary = f"{ticker} iron condor. Range {'intact' if short_wing_risk == 'LOW' else 'under pressure'}."
        if short_wing_risk == "HIGH":
            next_action = "Short call wing at risk. Consider rolling untested side."
    elif family == "LONG_PUT":
        ai_summary = f"{ticker} long put."
        if is_profit:
            ai_summary += f" Downside working ({pnl_abs:.0f}% return). Protect profits."
        else:
            ai_summary += " Waiting for downside move."
    else:
        ai_summary = f"{ticker} {strategy}. P&L {pnl_pct:.0f}%."

    smart_alerts = []
    if ext_risk == "HIGH" and is_profit:
        smart_alerts.append({
            "type": "EXTENSION_RISK",
            "label": "Extension Risk",
            "message": f"{ticker} extended {extension_pct:.1f}% above MA20. Tighten stop.",
            "severity": "WARNING",
        })
    if rsi > 78 and is_profit:
        smart_alerts.append({
            "type": "RSI_OVERBOUGHT",
            "label": "RSI Overbought",
            "message": f"{ticker} RSI at {rsi:.0f}. Overbought in an existing profitable position. Protect aggressively.",
            "severity": "WARNING",
        })
    if dte <= 7:
        smart_alerts.append({
            "type": "EXPIRY_WARNING",
            "label": "Expiry Approaching",
            "message": f"{int(dte)} DTE. Theta decay accelerating. Close or roll soon.",
            "severity": "CRITICAL" if dte <= 3 else "WARNING",
        })
    if mom_q == "DEGRADING" and is_profit:
        smart_alerts.append({
            "type": "MOMENTUM_FADE",
            "label": "Momentum Fading",
            "message": f"{ticker} momentum weakening. Consider reducing exposure.",
            "severity": "WARNING",
        })
    if family == "BULL_CALL_SPREAD":
        val_cap = value_capture if max_profit > 0 else pnl_abs
        if val_cap > 70:
            smart_alerts.append({
                "type": "VALUE_CAPTURED",
                "label": "Value Captured",
                "message": f"Spread at {val_cap:.0f}% max value. Consider closing.",
                "severity": "INFO",
            })
    if family in ("LONG_CALL",) and dte <= 14:
        smart_alerts.append({
            "type": "THETA_RISK",
            "label": "Theta Risk",
            "message": f"{int(dte)} DTE. Theta accelerating. Monitor closely.",
            "severity": "WARNING",
        })
    if family == "COVERED_CALL" and ext_risk == "HIGH":
        smart_alerts.append({
            "type": "ASSIGNMENT_RISK",
            "label": "Assignment Risk",
            "message": f"{ticker} deep ITM short call. Consider rolling.",
            "severity": "WARNING",
        })

    empty_capture = None if family in ("LONG_CALL", "LONG_PUT") else round(value_capture, 1) if max_profit > 0 else None

    playbook: list[str] = []
    if family == "LONG_CALL":
        playbook = [
            "Trail stop below MA20",
            "Scale 25-50% above +100% return",
            "Protect aggressively if RSI > 78",
            "Reduce if QQQ weakens",
        ]
    elif family == "BULL_CALL_SPREAD":
        playbook = [
            "Consider closing at 60-80% max value",
            "Avoid holding through rapid theta decay",
            "Roll if breakout continues strongly",
        ]
    elif family == "COVERED_CALL":
        playbook = [
            "Roll short call if deep ITM",
            "Capture premium decay near expiry",
            "Consider buying back on sharp IV drop",
        ]
    elif family == "IRON_CONDOR":
        playbook = [
            "Close if short strike tested",
            "Roll untested wing for extra credit",
            "Take off at 50% max profit",
        ]
    elif family == "LONG_PUT":
        playbook = [
            "Trail above MA20 on downside",
            "Protect profits if RSI < 25",
            "Reduce if VIX drops sharply",
        ]
    else:
        playbook = [
            "Monitor risk/reward daily",
            "Set price alert at key level",
        ]

    management_actions: list[str] = []
    if ai_state in ("LET_RUN", "TREND_CONTINUATION"):
        management_actions = ["Hold runner", "Trail stop"]
    elif ai_state in ("PROTECT_GAINS", "SCALE_PROFITS"):
        management_actions = ["Scale 25%", "Tighten stop", "Set profit alert"]
    elif ai_state in ("REDUCE_RISK", "EXIT_MOMENTUM", "EXIT_NOW"):
        management_actions = ["Reduce exposure", "Set exit alert", "Cut losses"]
    elif ai_state == "ROLL_SOON":
        management_actions = ["Roll next week", "Extend expiry"]

    return {
        "ai_state": ai_state,
        "state_label": state_label,
        "health_score": score,
        "health_label": health_label,
        "pnl_pct": round(pnl_pct, 1),
        "momentum_quality": mom_q,
        "extension_pct": extension_pct,
        "extension_risk": ext_risk,
        "theta_risk": theta_risk_val,
        "iv_risk": iv_risk,
        "trend_risk": trend_risk,
        "rsi_risk": rsi_risk_val,
        "liquidity_risk": liquidity_risk,
        "market_correlation_risk": market_corr_risk,
        "dte": int(dte),
        "rsi": rsi,
        "current_price": current_price,
        "ma20": ma20,
        "value_capture_pct": empty_capture,
        "max_profit": max_profit,
        "max_loss": max_loss,
        "ai_summary": ai_summary,
        "next_best_action": next_action,
        "timeline_stage": timeline_stage,
        "smart_alerts": smart_alerts,
        "management_playbook": playbook,
        "management_actions": management_actions,
        "is_profitable": is_profit,
        "strategy_family": family,
    }
