from __future__ import annotations

from typing import Any

import pandas as pd

import bar_cache
from services.bias_change_service import bias_change_conditions
from services.invalidation_service import invalidation_for_bias
from services.market_phase_service import classify_market_phase
from services.market_structure_service import classify_structure
from services.pivot_detection_service import detect_confirmed_pivots, label_pivots
from services.verdict_explanation_service import trade_quality_score


def _num(value: Any, default: float = 0.0) -> float:
    try:
        n = float(value)
        return n if pd.notna(n) else default
    except Exception:
        return default


def _vwap(df: pd.DataFrame) -> float | None:
    if df.empty:
        return None
    typical = (df["High"].astype(float) + df["Low"].astype(float) + df["Close"].astype(float)) / 3.0
    volume = df["Volume"].astype(float).clip(lower=0)
    denom = volume.sum()
    if denom <= 0:
        return None
    return _num((typical * volume).sum() / denom)


def build_trade_dashboard_story(ticker: str, force_refresh: bool = False) -> dict[str, Any]:
    symbol = ticker.upper().strip()
    bars = bar_cache.get_history(symbol, period="5d", interval="5m", auto_adjust=True, force_refresh=force_refresh).dropna().tail(96)
    info = bar_cache.get_info(symbol, force_refresh=force_refresh) or {}
    if bars.empty or len(bars) < 12:
        return {
            "ticker": symbol,
            "company_name": str(info.get("shortName") or info.get("longName") or ""),
            "market_story": "Market data is unavailable or incomplete.",
            "market_phase": {"phase": "Transition", "confidence": "Low", "reason": "Not enough completed candles."},
            "structure_map": {"state": "Mixed", "sequence": [], "display": "No confirmed pivots", "pivots": []},
            "opportunity_verdict": {"verdict": "Do Not Trade", "score": 0, "main_reason": "Bad or missing data", "main_blocker": "Market data unavailable"},
            "execution_plan": {"message": "No entry now. Wait for fresh data."},
            "invalidation": {"level": None, "rules": ["No stop level possible"]},
            "bias_change": {"neutral_if": ["Fresh data loads"], "opposite_if": []},
            "position_guidance": {"action": "No open-position context", "reason": "Position integration pending."},
        }

    close = bars["Close"].astype(float)
    highs = bars["High"].astype(float)
    lows = bars["Low"].astype(float)
    price = _num(close.iloc[-1])
    vwap = _vwap(bars)
    momentum = _num(close.iloc[-1] - close.iloc[-6]) if len(close) >= 6 else 0.0
    volume_ratio = _num(bars["Volume"].tail(6).mean()) / max(_num(bars["Volume"].mean()), 1.0)

    pivots = label_pivots(detect_confirmed_pivots(highs, lows, left=2, right=2))
    recent_pivots = pivots[-6:]
    structure = classify_structure(recent_pivots)
    phase = classify_market_phase(structure["state"], price=price, vwap=vwap, momentum=momentum, volume_ratio=volume_ratio)
    bias = structure["bias"]
    invalidation = invalidation_for_bias(bias, recent_pivots, vwap)
    change = bias_change_conditions(bias, recent_pivots, vwap)

    structure_score = 25 if structure["bias"] in {"bullish", "bearish"} else 12
    vwap_score = 20 if (bias == "bullish" and vwap and price > vwap) or (bias == "bearish" and vwap and price < vwap) else 10
    volume_score = 15 if volume_ratio >= 1.3 else 9 if volume_ratio >= 0.8 else 5
    rr_score = 12 if invalidation.get("level") else 0
    market_score = 7
    rs_score = 10
    quality = trade_quality_score(
        structure=structure_score,
        vwap_trend=vwap_score,
        relative_strength=rs_score,
        volume=volume_score,
        risk_reward=rr_score,
        market_alignment=market_score,
    )

    if quality["score"] < 65:
        execution = "No entry now. Wait for a confirmed pivot break or VWAP reclaim/rejection."
    elif bias == "bearish":
        execution = "Wait for rejection near the last LH or break below the last LL with volume."
    elif bias == "bullish":
        execution = "Wait for pullback into the last HL or break above the last HH with volume."
    else:
        execution = "No entry now. Structure is mixed."

    market_story = (
        f"{structure.get('story') or 'Confirmed pivots do not form a clean directional structure yet.'} "
        f"Price {'above' if vwap and price > vwap else 'below' if vwap and price < vwap else 'near'} VWAP. "
        f"Momentum is {'positive' if momentum > 0 else 'negative' if momentum < 0 else 'flat'}."
    )
    main_blocker = "None" if quality["score"] >= 65 else "Trade quality below valid setup threshold"

    return {
        "ticker": symbol,
        "company_name": str(info.get("shortName") or info.get("longName") or ""),
        "market_story": market_story,
        "market_phase": phase,
        "structure_map": structure,
        "opportunity_verdict": {
            "verdict": quality["verdict"],
            "score": quality["score"],
            "breakdown": quality["breakdown"],
            "bias": bias,
            "confidence": "High" if quality["score"] >= 80 else "Medium" if quality["score"] >= 65 else "Low",
            "main_reason": phase["reason"],
            "main_blocker": main_blocker,
        },
        "execution_plan": {
            "trade_type": "Scalp / Day Trade / Carry / Swing based on hold time",
            "message": execution,
            "dte": "Scalp/Day: 5-10 DTE; Carry: 7-14 DTE; Swing: 14-45 DTE",
            "position_size": "Use smaller size for 65-79 score; normal size only above 80.",
        },
        "invalidation": invalidation,
        "bias_change": change,
        "position_guidance": {
            "action": "Hold / Exit / Reduce based on current open position",
            "reason": "If already in position, thesis remains valid only while invalidation rules hold.",
            "next_review": "Next completed 5m candle",
        },
        "metrics": {
            "price": round(price, 2),
            "vwap": round(vwap, 2) if vwap is not None else None,
            "momentum": round(momentum, 3),
            "volume_ratio": round(volume_ratio, 2),
        },
    }
