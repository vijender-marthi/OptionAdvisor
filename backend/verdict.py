"""
Unified verdict system for the trading bot.

All engines produce one of these verdicts. No more conflicting dimension
systems (signal_quality vs execution_timing vs final_decision).
A single verdict that means what it says.
"""
from __future__ import annotations

from enum import Enum
from typing import Optional


class Verdict(str, Enum):
    STRONG_GO = "STRONG_GO"
    GO = "GO"
    TRIGGER_PENDING = "TRIGGER_PENDING"  # bias confirmed, entry trigger not yet fired
    WATCH = "WATCH"
    WAIT = "WAIT"
    AVOID = "AVOID"
    NO_EDGE = "NO_EDGE"

    @classmethod
    def from_raw(cls, raw: Optional[str], default: str = "WAIT") -> "Verdict":
        """Normalize any raw verdict string to a canonical Verdict."""
        if not raw:
            return cls(default)
        v = raw.strip().upper().replace("-", "_").replace(" ", "_")

        # Map old scan engine values
        if v in ("STRONG_GO", "STRONG GO"):
            return cls.STRONG_GO
        if v in ("GO",):
            return cls.GO
        if v in ("TRIGGER_PENDING", "PENDING", "WAITING_FOR_TRIGGER"):
            return cls.TRIGGER_PENDING
        if v in ("WATCH",):
            return cls.WATCH
        if v in ("WAIT", "NO_TRADE_WAIT"):
            return cls.WAIT
        if v in ("AVOID", "NO_GO", "NO-GO", "NO GO", "NO_TRADE", "AVOID_NAKED_CALLS",
                 "AVOID_CALLS", "AVOID_CHASING_PUTS", "AVOID_CHASE"):
            return cls.AVOID
        if v in ("NO_EDGE",):
            return cls.NO_EDGE

        # Map resolver final_decision values
        if v in ("READY", "TRADE", "ENTER"):
            return cls.GO
        if v == "NO_EDGE":
            return cls.NO_EDGE

        return cls(default)

    @property
    def is_go(self) -> bool:
        return self in (Verdict.STRONG_GO, Verdict.GO)

    @property
    def is_watch(self) -> bool:
        return self == Verdict.WATCH

    @property
    def is_pending(self) -> bool:
        return self == Verdict.TRIGGER_PENDING

    @property
    def is_wait(self) -> bool:
        return self == Verdict.WAIT

    @property
    def is_avoid(self) -> bool:
        return self in (Verdict.AVOID, Verdict.NO_EDGE)

    @property
    def is_actionable(self) -> bool:
        return self.is_go


VERDICT_LABELS = {
    Verdict.STRONG_GO: "Strong Go",
    Verdict.GO: "Go",
    Verdict.TRIGGER_PENDING: "Waiting for Trigger",
    Verdict.WATCH: "Watch",
    Verdict.WAIT: "Wait",
    Verdict.AVOID: "Avoid",
    Verdict.NO_EDGE: "No Edge",
}

VERDICT_COLORS = {
    Verdict.STRONG_GO: "#00A86B",
    Verdict.GO: "#00A86B",
    Verdict.TRIGGER_PENDING: "#D4A017",  # same amber as WAIT — not actionable yet
    Verdict.WATCH: "#D4A017",
    Verdict.WAIT: "#D4A017",
    Verdict.AVOID: "#D0312D",
    Verdict.NO_EDGE: "#6B7280",
}

VERDICT_TONE: dict[str, str] = {
    "STRONG_GO":       "bullish",
    "GO":              "bullish",
    "TRIGGER_PENDING": "warning",
    "WATCH":           "warning",
    "WAIT":            "neutral",
    "AVOID":           "bearish",
    "NO_EDGE":         "neutral",
}

# Ranks are floats so TRIGGER_PENDING can sit between WAIT (2) and WATCH (3).
VERDICT_RANK: dict[str, float] = {
    "STRONG_GO":       5,
    "GO":              4,
    "WATCH":           3,
    "TRIGGER_PENDING": 2.5,
    "WAIT":            2,
    "AVOID":           1,
    "NO_EDGE":         0,
}


def verdict_label(v: str) -> str:
    key = str(v).upper().replace(" ", "_")
    return VERDICT_LABELS.get(key) or VERDICT_LABELS.get(Verdict(key) if key in Verdict._value2member_map_ else key, str(v))  # type: ignore[arg-type]


def verdict_tone(v: str) -> str:
    return VERDICT_TONE.get(str(v).upper().replace(" ", "_"), "neutral")


def verdict_rank(v: str) -> float:
    return VERDICT_RANK.get(str(v).upper().replace(" ", "_"), -1)
