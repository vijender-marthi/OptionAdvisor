from __future__ import annotations

from .pivot_detection_service import Pivot


def structure_sequence(pivots: list[Pivot], limit: int = 4) -> list[str]:
    return [p.label or p.kind for p in pivots if p.label][-limit:]


def classify_structure(pivots: list[Pivot]) -> dict:
    seq = structure_sequence(pivots, 4)
    joined = " -> ".join(seq) if seq else "No confirmed pivots"
    if len(seq) >= 4 and seq[-4:] == ["HH", "HL", "HH", "HL"]:
        return {"state": "Bull Trend", "sequence": seq, "display": joined, "bias": "bullish"}
    if len(seq) >= 4 and seq[-4:] == ["LH", "LL", "LH", "LL"]:
        return {"state": "Bear Trend", "sequence": seq, "display": joined, "bias": "bearish"}
    if len(seq) >= 2 and seq[-2:] in (["HL", "HH"], ["LL", "LH"]):
        return {"state": "Transition", "sequence": seq, "display": joined, "bias": "neutral"}
    return {"state": "Mixed", "sequence": seq, "display": joined, "bias": "neutral"}
