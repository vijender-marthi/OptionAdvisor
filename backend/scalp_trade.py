from __future__ import annotations

import math
from typing import Any, Optional

import pandas as pd

from rule_enforcer import direction_state_from_bias, gate_trade_action, option_side_from_strategy


def build_scalp_context(
    session: pd.DataFrame,
    vwap_ser: pd.Series,
    vwap_upper1_ser: pd.Series,
    vwap_lower1_ser: pd.Series,
    vwap_upper2_ser: pd.Series,
    vwap_lower2_ser: pd.Series,
) -> dict[str, Any]:
    """Build the existing scalp study/output as an independent intraday engine.

    This preserves the current EMA/Stoch/volume behavior exactly; the architectural
    fix is ownership separation, not strategy modification.
    """
    close_ser = session["Close"].astype(float)
    high_ser = session["High"].astype(float)
    low_ser = session["Low"].astype(float)
    ema20_ser = close_ser.ewm(span=20, adjust=False).mean()
    ema50_ser = close_ser.ewm(span=50, adjust=False).mean()
    ema150_ser = close_ser.ewm(span=150, adjust=False).mean()
    stoch_low5 = low_ser.rolling(5, min_periods=1).min()
    stoch_high5 = high_ser.rolling(5, min_periods=1).max()
    stoch_range5 = (stoch_high5 - stoch_low5).replace(0, math.nan)
    stoch5_ser = ((close_ser - stoch_low5) / stoch_range5 * 100.0).fillna(50.0).clip(0.0, 100.0)
    trend_confirm_ser = (ema50_ser > ema150_ser).astype(float) * 100.0

    chart_bars: list[dict[str, Any]] = []
    for i in range(len(session)):
        row = session.iloc[i]
        ts = session.index[i]
        t_iso = pd.Timestamp(ts).isoformat()
        vw_i = float(vwap_ser.iloc[i])
        chart_bars.append(
            {
                "t": t_iso,
                "o": round(float(row["Open"]), 4),
                "h": round(float(row["High"]), 4),
                "l": round(float(row["Low"]), 4),
                "c": round(float(row["Close"]), 4),
                "v": round(float(row["Volume"]), 4),
                "vwap": round(vw_i, 4),
                "vwap_upper1": round(float(vwap_upper1_ser.iloc[i]), 4),
                "vwap_lower1": round(float(vwap_lower1_ser.iloc[i]), 4),
                "vwap_upper2": round(float(vwap_upper2_ser.iloc[i]), 4),
                "vwap_lower2": round(float(vwap_lower2_ser.iloc[i]), 4),
                "ema50": round(float(ema50_ser.iloc[i]), 4),
                "ema150": round(float(ema150_ser.iloc[i]), 4),
                "stoch5": round(float(stoch5_ser.iloc[i]), 2),
                "trend_confirmation": round(float(trend_confirm_ser.iloc[i]), 2),
            }
        )

    avg_vol20_ser = session["Volume"].astype(float).rolling(20, min_periods=1).mean()
    scalp_bias = "long" if float(ema50_ser.iloc[-1]) >= float(ema150_ser.iloc[-1]) else "short"
    scalp_entry_idx: Optional[int] = None
    for i in range(max(1, len(session) - 45), len(session)):
        prev_stoch = float(stoch5_ser.iloc[i - 1])
        curr_stoch = float(stoch5_ser.iloc[i])
        close_i = float(close_ser.iloc[i])
        ema50_i = float(ema50_ser.iloc[i])
        ema150_i = float(ema150_ser.iloc[i])
        vol_i = float(session["Volume"].iloc[i])
        avg_vol_i = max(1.0, float(avg_vol20_ser.iloc[i]))
        if scalp_bias == "long":
            trend_ok = ema50_i > ema150_i and close_i >= ema50_i
            stoch_trigger = prev_stoch <= 20.0 and curr_stoch > 20.0
            continuation_trigger = curr_stoch >= 50.0 and close_i > ema50_i and vol_i >= avg_vol_i
            if trend_ok and (stoch_trigger or continuation_trigger):
                scalp_entry_idx = i
        else:
            trend_ok = ema50_i < ema150_i and close_i <= ema50_i
            stoch_trigger = prev_stoch >= 80.0 and curr_stoch < 80.0
            continuation_trigger = curr_stoch <= 50.0 and close_i < ema50_i and vol_i >= avg_vol_i
            if trend_ok and (stoch_trigger or continuation_trigger):
                scalp_entry_idx = i

    if scalp_entry_idx is not None:
        entry_bar = session.iloc[scalp_entry_idx]
        entry_price = float(entry_bar["Close"])
        lookback_lo = max(0, scalp_entry_idx - 5)
        if scalp_bias == "long":
            stop_level = min(float(session["Low"].iloc[lookback_lo:scalp_entry_idx + 1].min()), float(ema50_ser.iloc[scalp_entry_idx])) * 0.999
            risk = max(entry_price - stop_level, entry_price * 0.002)
            target_1 = entry_price + risk * 1.5
            target_2 = entry_price + risk * 2.5
            requirement = "EMA50 above EMA150, price holding EMA50, momentum trigger confirmed, volume at/above 20-bar average."
        else:
            stop_level = max(float(session["High"].iloc[lookback_lo:scalp_entry_idx + 1].max()), float(ema50_ser.iloc[scalp_entry_idx])) * 1.001
            risk = max(stop_level - entry_price, entry_price * 0.002)
            target_1 = entry_price - risk * 1.5
            target_2 = entry_price - risk * 2.5
            requirement = "EMA50 below EMA150, price rejecting EMA50, momentum trigger confirmed, volume at/above 20-bar average."
        scalp_status = "ENTRY_READY" if scalp_entry_idx >= len(session) - 3 else "TRACK_PULLBACK"
        scalp_next = "Enter on a 1m pullback that holds EMA50; skip if price closes through the stop."
    else:
        entry_price = float(close_ser.iloc[-1])
        if scalp_bias == "long":
            stop_level = float(ema50_ser.iloc[-1]) * 0.998
            target_1 = entry_price + max(entry_price - stop_level, entry_price * 0.002) * 1.5
            target_2 = entry_price + max(entry_price - stop_level, entry_price * 0.002) * 2.5
            requirement = "Need EMA50 above EMA150, price above EMA50, momentum trigger, and volume confirmation."
        else:
            stop_level = float(ema50_ser.iloc[-1]) * 1.002
            target_1 = entry_price - max(stop_level - entry_price, entry_price * 0.002) * 1.5
            target_2 = entry_price - max(stop_level - entry_price, entry_price * 0.002) * 2.5
            requirement = "Need EMA50 below EMA150, price below EMA50, momentum rollover, and volume confirmation."
        scalp_status = "WAIT_TRIGGER"
        scalp_next = "Wait for the next clean 1m stochastic trigger with price respecting EMA50."

    scalp_entry_time = pd.Timestamp(session.index[scalp_entry_idx]).isoformat() if scalp_entry_idx is not None else None

    latest_close = float(close_ser.iloc[-1])
    latest_ema20 = float(ema20_ser.iloc[-1])
    latest_ema50 = float(ema50_ser.iloc[-1])
    latest_ema150 = float(ema150_ser.iloc[-1])
    latest_stoch = float(stoch5_ser.iloc[-1])
    latest_vol_ratio = float(session["Volume"].iloc[-1]) / max(1.0, float(avg_vol20_ser.iloc[-1]))
    trend_confirmed = bool(latest_ema50 > latest_ema150 if scalp_bias == "long" else latest_ema50 < latest_ema150)
    price_respects_ema50 = bool(latest_close >= latest_ema50 if scalp_bias == "long" else latest_close <= latest_ema50)
    stoch_timing_ok = bool(latest_stoch >= 50.0 if scalp_bias == "long" else latest_stoch <= 50.0)
    volume_confirmed = latest_vol_ratio >= 1.0
    ema50_dist_pct = abs(latest_close / latest_ema50 - 1.0) * 100.0 if latest_ema50 > 0 else 0.0
    if ema50_dist_pct >= 1.0:
        extension_state = "EXTREME"
    elif ema50_dist_pct >= 0.55:
        extension_state = "EXTENDED"
    else:
        extension_state = "NORMAL"

    risk_per_share = abs(entry_price - stop_level)
    rr_t1 = abs(target_1 - entry_price) / risk_per_share if risk_per_share > 0 else 0.0
    blockers: list[dict[str, Any]] = [
        {"label": "EMA trend aligned", "status": "PASS" if trend_confirmed else "FAIL"},
        {"label": "Price respects EMA50", "status": "PASS" if price_respects_ema50 else "FAIL"},
        {"label": "Momentum timing", "status": "PASS" if stoch_timing_ok else "PENDING"},
        {"label": "Volume confirmed", "status": "PASS" if volume_confirmed else "PENDING"},
        {"label": f"EMA50 extension {ema50_dist_pct:.2f}%", "status": "PASS" if extension_state == "NORMAL" else "WARN"},
    ]
    trade_quality = 0
    trade_quality += 25 if trend_confirmed else 0
    trade_quality += 15 if price_respects_ema50 else 0
    trade_quality += 20 if stoch_timing_ok else 8
    trade_quality += 20 if volume_confirmed else 8
    trade_quality += 20 if extension_state == "NORMAL" else 10 if extension_state == "EXTENDED" else 0
    trade_quality = max(0, min(100, trade_quality))
    quality_grade = "A+" if trade_quality >= 90 else "A" if trade_quality >= 80 else "B" if trade_quality >= 70 else "C" if trade_quality >= 55 else "SKIP"

    if extension_state == "EXTREME":
        scalp_action = "DO_NOT_CHASE"
        scalp_reason = "Price is too far from EMA50 for a professional scalp entry."
    elif not trend_confirmed or not price_respects_ema50:
        scalp_action = "NO_TRADE"
        scalp_reason = "Scalp trend structure is not aligned."
    elif not volume_confirmed or not stoch_timing_ok:
        scalp_action = "WAIT"
        scalp_reason = "Timing or volume confirmation is not complete."
    elif scalp_status == "ENTRY_READY":
        scalp_action = "GO"
        scalp_reason = "Trend, timing, and volume are aligned without extension."
    else:
        scalp_action = "TRACK"
        scalp_reason = "Setup is valid, but current entry is no longer fresh."
    scalp_gate = gate_trade_action(
        final_action=scalp_action,
        direction_state=direction_state_from_bias(scalp_bias),
        trade_side=option_side_from_strategy(None, scalp_bias),
        volume_required=True,
        volume_confirmed=volume_confirmed,
        extension_state=extension_state,
    )
    if scalp_gate["blocked"]:
        scalp_action = str(scalp_gate["final_action"])
        scalp_reason = scalp_gate["required_next_condition"]
    momentum_label = "STRONG" if stoch_timing_ok and volume_confirmed else "BUILDING" if stoch_timing_ok or volume_confirmed else "WEAK"
    price_label = "CONFIRMED" if price_respects_ema50 else "NOT CONFIRMED"
    status_label = (
        "BUY PULLBACKS" if scalp_bias == "long" and scalp_action in ("GO", "TRACK")
        else "SELL BOUNCES" if scalp_bias == "short" and scalp_action in ("GO", "TRACK")
        else scalp_action.replace("_", " ")
    )

    return {
        "chart_bars": chart_bars,
        "latest_ema20": latest_ema20,
        "latest_ema50": latest_ema50,
        "latest_ema150": latest_ema150,
        "latest_stoch": latest_stoch,
        "latest_vol_ratio": latest_vol_ratio,
        "scalp_trading": {
            "action": scalp_action,
            "reason": scalp_reason,
            "bias": scalp_gate["bias"],
            "blocker": scalp_gate["blocker"],
            "final_action": scalp_gate["final_action"],
            "required_next_condition": scalp_gate["required_next_condition"],
            "momentum_label": momentum_label,
            "price_label": price_label,
            "status_label": status_label,
            "trade_quality": trade_quality,
            "quality_grade": quality_grade,
            "status": scalp_status,
            "direction": scalp_bias,
            "entry_price": round(entry_price, 4),
            "entry_time": scalp_entry_time,
            "stop_level": round(stop_level, 4),
            "target_1": round(target_1, 4),
            "target_2": round(target_2, 4),
            "risk_per_share": round(risk_per_share, 4),
            "risk_reward_t1": round(rr_t1, 2),
            "ema50": round(latest_ema50, 4),
            "ema20": round(latest_ema20, 4),
            "ema150": round(latest_ema150, 4),
            "stoch5": round(latest_stoch, 2),
            "volume_ratio_20": round(latest_vol_ratio, 2),
            "trend_confirmed": trend_confirmed,
            "volume_confirmed": volume_confirmed,
            "extension_state": extension_state,
            "extension_from_ema50_pct": round(ema50_dist_pct, 2),
            "recommended_dte": "5-10 DTE",
            "blockers": blockers,
            "logic_note": "Scalp logic is isolated from Day Trade; current rules use EMA trend, momentum timing, and volume.",
            "trigger_requirement": requirement,
            "next_action": scalp_next,
        },
    }
