from __future__ import annotations

import logging
from typing import Any

from .pivot_detection_service import Pivot, label_pivots

log = logging.getLogger(__name__)


def _pivot_dict(pivot: Pivot) -> dict[str, Any]:
    return {
        "type": "HIGH" if pivot.kind == "H" else "LOW",
        "kind": pivot.kind,
        "label": pivot.label,
        "price": round(float(pivot.price), 2),
        "index": pivot.index,
        "confirmed": bool(getattr(pivot, "confirmed", True)),
    }


def _validate_classification(pivots: list[Pivot]) -> tuple[list[Pivot], list[dict[str, Any]], dict[str, float | None]]:
    previous_hh: float | None = None
    previous_hl: float | None = None
    previous_ll: float | None = None
    previous_high: float | None = None
    previous_low: float | None = None
    valid: list[Pivot] = []
    validations: list[dict[str, Any]] = []

    for pivot in label_pivots([p for p in pivots if getattr(p, "confirmed", True)]):
        label = pivot.label or pivot.kind
        ok = True
        reason = "initial pivot"
        corrected = label

        if pivot.kind == "H":
            if label == "HH":
                ok = previous_high is not None and pivot.price > previous_high
                reason = f"{pivot.price:.2f} > prior pivot high {previous_high:.2f}" if previous_high is not None else "missing prior high"
                if ok:
                    previous_hh = pivot.price
            elif label == "LH":
                ok = previous_high is not None and pivot.price <= previous_high
                reason = f"{pivot.price:.2f} <= prior pivot high {previous_high:.2f}" if previous_high is not None else "missing prior high"
            elif label == "H":
                previous_hh = previous_hh if previous_hh is not None else pivot.price
            previous_high = pivot.price

        if pivot.kind == "L":
            if label == "HL":
                ok = previous_low is not None and pivot.price > previous_low
                reason = f"{pivot.price:.2f} > prior pivot low {previous_low:.2f}" if previous_low is not None else "missing prior low"
                if ok:
                    previous_hl = pivot.price
            elif label == "LL":
                ok = previous_low is not None and pivot.price <= previous_low
                reason = f"{pivot.price:.2f} <= prior pivot low {previous_low:.2f}" if previous_low is not None else "missing prior low"
                if ok:
                    previous_ll = pivot.price
            elif label == "L":
                if previous_hl is None:
                    previous_hl = pivot.price
                if previous_ll is None:
                    previous_ll = pivot.price
            previous_low = pivot.price

        if not ok:
            log.warning("Invalid market-structure label %s at index %s price %.2f: %s", label, pivot.index, pivot.price, reason)
            corrected = pivot.kind

        final_pivot = Pivot(pivot.kind, pivot.index, pivot.price, corrected, getattr(pivot, "confirmed", True))
        valid.append(final_pivot)
        validations.append({
            "label": label,
            "corrected_label": corrected,
            "price": round(float(pivot.price), 2),
            "index": pivot.index,
            "valid": ok,
            "rule": reason,
        })

    anchors = {
        "previous_hh": previous_hh,
        "previous_hl": previous_hl,
        "previous_ll": previous_ll,
        "current_hh": next((p.price for p in reversed(valid) if p.label == "HH"), previous_hh),
        "current_hl": next((p.price for p in reversed(valid) if p.label == "HL"), previous_hl),
    }
    return valid, validations, anchors


def structure_sequence(pivots: list[Pivot], limit: int = 4) -> list[str]:
    validated, _, _ = _validate_classification(pivots)
    return [p.label or p.kind for p in validated if p.label in {"HH", "HL", "LH", "LL"}][-limit:]


def _derive_state(seq: list[str]) -> tuple[str, str]:
    last = seq[-2:] if len(seq) >= 2 else seq
    last3 = seq[-3:] if len(seq) >= 3 else seq
    if last in (["HH", "LL"], ["HL", "LL"]):
        return "Bull Trend Broken", "neutral"
    if last in (["LL", "HH"], ["LH", "HH"]):
        return "Bear Trend Broken", "neutral"
    if last == ["HH", "HL"] or last == ["HL", "HH"] or last3 in (["HL", "HH", "HL"], ["HH", "HL", "HH"]):
        return "Bullish Continuation", "bullish"
    if last == ["LH", "LL"] or last == ["LL", "LH"] or last3 in (["LL", "LH", "LL"], ["LH", "LL", "LH"]):
        return "Bearish Continuation", "bearish"
    if last == ["HL", "LH"]:
        return "Compression", "neutral"
    if last in (["LH", "HL"], ["H", "L"], ["L", "H"]):
        return "Range", "neutral"
    if last and last[-1] in {"LL", "LH"}:
        return "Reversal Attempt", "neutral"
    return "Mixed", "neutral"


def _derive_state_from_pairs(classified: list[Pivot]) -> tuple[str, str]:
    highs = [p for p in classified if p.kind == "H" and p.label in {"HH", "LH"}]
    lows = [p for p in classified if p.kind == "L" and p.label in {"HL", "LL"}]
    high_labels = [p.label for p in highs[-2:]]
    low_labels = [p.label for p in lows[-2:]]
    latest_high = highs[-1].label if highs else None
    latest_low = lows[-1].label if lows else None

    if high_labels == ["HH", "HH"] and low_labels == ["HL", "HL"]:
        return "Bullish Continuation", "bullish"
    if high_labels == ["LH", "LH"] and low_labels == ["LL", "LL"]:
        return "Bearish Continuation", "bearish"
    if latest_low == "LL" and "HL" in low_labels:
        return "Bull Trend Broken", "neutral"
    if latest_high == "HH" and "LH" in high_labels:
        return "Bear Trend Broken", "neutral"
    if latest_high == "LH" and latest_low == "HL":
        return "Compression", "neutral"
    if latest_high == "HH" and latest_low == "LL":
        return "Range", "neutral"
    return _derive_state([p.label or p.kind for p in classified][-4:])


def _story(state: str, seq: list[str], pivots: list[Pivot]) -> str:
    last_low = next((p for p in reversed(pivots) if p.kind == "L"), None)
    previous_hl = None
    if last_low:
        lows_before = [p for p in pivots if p.kind == "L" and p.index < last_low.index and p.label == "HL"]
        previous_hl = lows_before[-1] if lows_before else None
    if state == "Bullish Continuation":
        defended = last_low and previous_hl and last_low.label == "HL" and last_low.price > previous_hl.price
        if defended:
            return "Higher highs and higher lows remain intact. Buyers defended support. Momentum remains bullish."
        return "Higher highs remain active. Waiting for the next confirmed higher low to validate support."
    if state == "Bull Trend Broken":
        return "The previous higher low failed. A lower low has formed. Bullish structure is broken and reversal risk is elevated."
    if state == "Bearish Continuation":
        return "Lower highs and lower lows remain intact. Sellers continue to control structure."
    if state == "Compression":
        return "A higher low and lower high are compressing price. Structure is transitioning and needs a breakout."
    if state == "Range":
        return "Confirmed pivots are overlapping. Price is range-bound rather than trending."
    if state == "Reversal Attempt":
        return "Structure is attempting to reverse, but confirmation is incomplete."
    return "Confirmed pivots do not form a clean directional structure yet."


def classify_structure(pivots: list[Pivot]) -> dict[str, Any]:
    validated, validations, anchors = _validate_classification(pivots)
    classified = [p for p in validated if p.label in {"HH", "HL", "LH", "LL"}]
    seq = [p.label or p.kind for p in classified][-4:]
    display = " -> ".join(seq) if seq else "No confirmed pivots"
    state, bias = _derive_state_from_pairs(classified)
    return {
        "state": state,
        "sequence": seq,
        "display": display,
        "bias": bias,
        "story": _story(state, seq, validated),
        "pivots": [_pivot_dict(p) for p in classified],
        "all_pivots": [_pivot_dict(p) for p in validated],
        "validation": validations,
        "debug": {
            "detected_pivots": [_pivot_dict(p) for p in pivots],
            "pivot_classification": [_pivot_dict(p) for p in validated],
            "anchors": {key: round(value, 2) if value is not None else None for key, value in anchors.items()},
            "structure": display,
        },
    }
