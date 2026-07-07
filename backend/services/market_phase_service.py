from __future__ import annotations


def classify_market_phase(
    structure_state: str,
    *,
    price: float,
    vwap: float | None,
    momentum: float,
    volume_ratio: float,
) -> dict:
    below_vwap = vwap is not None and price < vwap
    above_vwap = vwap is not None and price > vwap
    state = structure_state.lower()
    if "bull" in state and above_vwap and momentum >= 0:
        return {"phase": "Markup", "confidence": "High", "reason": "HH/HL structure, above VWAP, and positive momentum."}
    if "bear" in state and below_vwap and momentum <= 0:
        return {"phase": "Markdown", "confidence": "High", "reason": "LH/LL structure, below VWAP, and negative momentum."}
    if below_vwap and momentum > 0 and volume_ratio >= 1.0:
        return {"phase": "Accumulation", "confidence": "Medium", "reason": "Selling pressure is fading while price attempts to base below VWAP."}
    if above_vwap and momentum < 0 and volume_ratio >= 1.0:
        return {"phase": "Distribution", "confidence": "Medium", "reason": "Uptrend is weakening with elevated volume and failed continuation."}
    return {"phase": "Transition", "confidence": "Low", "reason": "Structure, VWAP, and momentum are not aligned enough for a clean phase."}
