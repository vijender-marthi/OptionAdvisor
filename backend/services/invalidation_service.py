from __future__ import annotations

from .pivot_detection_service import Pivot


def invalidation_for_bias(bias: str, pivots: list[Pivot], vwap: float | None) -> dict:
    highs = [p for p in pivots if p.kind == "H"]
    lows = [p for p in pivots if p.kind == "L"]
    b = bias.lower()
    if "bear" in b or "short" in b:
        level = highs[-1].price if highs else vwap
        return {
            "level": level,
            "rules": ["Break above last LH", "Reclaim VWAP and hold for two 5m candles", "SPY/QQQ reclaim VWAP", "Volume flips bullish"],
        }
    if "bull" in b or "long" in b:
        level = lows[-1].price if lows else vwap
        return {
            "level": level,
            "rules": ["Break below last HL", "Lose VWAP", "Failed breakout", "Relative strength turns negative"],
        }
    return {"level": vwap, "rules": ["Wait for confirmed HH/HL or LH/LL before defining invalidation."]}
