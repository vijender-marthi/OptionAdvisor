from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Literal


PivotKind = Literal["H", "L"]


@dataclass(frozen=True)
class Pivot:
    kind: PivotKind
    index: int
    price: float
    label: str | None = None


def detect_confirmed_pivots(
    highs: Iterable[float],
    lows: Iterable[float],
    *,
    left: int = 2,
    right: int = 2,
) -> list[Pivot]:
    """
    Detect completed swing pivots only.

    The final `right` bars are never eligible, so the current live candle cannot
    become HH/HL/LH/LL before price turns.
    """
    h = [float(x) for x in highs]
    l = [float(x) for x in lows]
    if len(h) != len(l):
        raise ValueError("highs and lows must have the same length")
    if left < 1 or right < 1:
        raise ValueError("left/right must be positive")
    pivots: list[Pivot] = []
    end = len(h) - right
    for i in range(left, end):
        high_window = h[i - left : i + right + 1]
        low_window = l[i - left : i + right + 1]
        if h[i] == max(high_window) and high_window.count(h[i]) == 1:
            pivots.append(Pivot(kind="H", index=i, price=h[i]))
        if l[i] == min(low_window) and low_window.count(l[i]) == 1:
            pivots.append(Pivot(kind="L", index=i, price=l[i]))
    return sorted(pivots, key=lambda p: p.index)


def label_pivots(pivots: list[Pivot]) -> list[Pivot]:
    last_high: float | None = None
    last_low: float | None = None
    labeled: list[Pivot] = []
    for pivot in pivots:
        if pivot.kind == "H":
            label = "HH" if last_high is not None and pivot.price > last_high else "LH" if last_high is not None else "H"
            last_high = pivot.price
        else:
            label = "HL" if last_low is not None and pivot.price > last_low else "LL" if last_low is not None else "L"
            last_low = pivot.price
        labeled.append(Pivot(kind=pivot.kind, index=pivot.index, price=pivot.price, label=label))
    return labeled
