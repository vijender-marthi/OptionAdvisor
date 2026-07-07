from __future__ import annotations

from .pivot_detection_service import Pivot


def bias_change_conditions(current_bias: str, pivots: list[Pivot], vwap: float | None) -> dict:
    highs = [p for p in pivots if p.kind == "H"]
    lows = [p for p in pivots if p.kind == "L"]
    last_high = highs[-1].price if highs else None
    last_low = lows[-1].price if lows else None
    b = current_bias.lower()
    if "bear" in b or "short" in b:
        return {
            "neutral_if": [f"Price forms HL above {last_low:.2f}" if last_low else "Price forms a confirmed HL", f"Price breaks above {last_high:.2f}" if last_high else "Price breaks above prior bounce high"],
            "opposite_if": ["Price reclaims VWAP", "Price forms HL -> HH", "QQQ/SPY support the move"],
            "vwap": vwap,
        }
    if "bull" in b or "long" in b:
        return {
            "neutral_if": [f"Price forms LH below {last_high:.2f}" if last_high else "Price forms a confirmed LH", f"Price breaks below {last_low:.2f}" if last_low else "Price breaks below prior pullback low"],
            "opposite_if": ["Price loses VWAP", "Price forms LH -> LL", "QQQ/SPY reject the move"],
            "vwap": vwap,
        }
    return {"neutral_if": ["Structure remains mixed"], "opposite_if": ["Wait for a confirmed pivot sequence"], "vwap": vwap}
