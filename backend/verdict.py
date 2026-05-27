"""
verdict.py — Single source of truth for trade verdicts.

All three trading engines (day, swing, regular) produce one of these six values.
Nothing else. The command center always shows this verdict and nothing else.
Detail pages may show sub-categories from the engine, but the verdict is this.
"""
from __future__ import annotations

from typing import Literal

Verdict = Literal["STRONG_GO", "GO", "WATCH", "WAIT", "AVOID", "NO_EDGE"]

# Display labels shown in the UI
VERDICT_LABELS: dict[str, str] = {
    "STRONG_GO": "Strong Go",
    "GO":        "Go",
    "WATCH":     "Watch",
    "WAIT":      "Wait",
    "AVOID":     "Avoid",
    "NO_EDGE":   "No Edge",
}

# Semantic tone used by the frontend for coloring
VERDICT_TONE: dict[str, str] = {
    "STRONG_GO": "bullish",
    "GO":        "bullish",
    "WATCH":     "watch",
    "WAIT":      "wait",
    "AVOID":     "bearish",
    "NO_EDGE":   "neutral",
}

# Rank: higher = more actionable (used for tiebreaking / sorting)
VERDICT_RANK: dict[str, int] = {
    "STRONG_GO": 5,
    "GO":        4,
    "WATCH":     3,
    "WAIT":      2,
    "AVOID":     1,
    "NO_EDGE":   0,
}


def verdict_label(v: str) -> str:
    return VERDICT_LABELS.get(str(v).upper(), str(v))


def verdict_tone(v: str) -> str:
    return VERDICT_TONE.get(str(v).upper(), "neutral")


def verdict_rank(v: str) -> int:
    return VERDICT_RANK.get(str(v).upper(), -1)
