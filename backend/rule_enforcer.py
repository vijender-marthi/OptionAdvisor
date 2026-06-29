"""Shared hard gates for existing trading rules.

This module does not create indicators. It only converts existing advisory
states (bias, DTE, volume confirmation, extension, overnight checklist) into
one conservative final action.
"""
from __future__ import annotations

from typing import Any, Optional

GO_LIKE = {"GO", "STRONG_GO", "READY", "TRADE", "ENTER", "ENTRY_READY"}


def normalize_direction_state(value: Optional[str]) -> str:
    v = str(value or "").strip().upper().replace(" ", "_").replace("-", "_")
    if v in {"CALL_ONLY", "CALLS_ONLY", "LONG_ONLY", "BULLISH", "LONG"}:
        return "CALL_ONLY"
    if v in {"PUT_ONLY", "PUTS_ONLY", "SHORT_ONLY", "BEARISH", "SHORT"}:
        return "PUT_ONLY"
    return "NEUTRAL"


def direction_state_from_bias(bias: Optional[str]) -> str:
    return normalize_direction_state(bias)


def option_side_from_strategy(strategy: Optional[str], bias: Optional[str] = None) -> str:
    s = str(strategy or "").upper().replace(" ", "_")
    if "PUT" in s:
        return "PUT"
    if "CALL" in s:
        return "CALL"
    b = normalize_direction_state(bias)
    if b == "PUT_ONLY":
        return "PUT"
    if b == "CALL_ONLY":
        return "CALL"
    return "NEUTRAL"


def gate_trade_action(
    *,
    final_action: str,
    direction_state: Optional[str] = None,
    trade_side: Optional[str] = None,
    dte: Optional[int] = None,
    min_dte: Optional[int] = None,
    is_open_position: bool = False,
    volume_required: bool = False,
    volume_confirmed: Optional[bool] = None,
    extension_state: Optional[str] = None,
    overnight_allowed: Optional[bool] = None,
    overnight_required: bool = False,
) -> dict[str, Any]:
    """Return final action metadata after existing rules are hard-enforced."""
    original = str(final_action or "WAIT").upper().replace(" ", "_").replace("-", "_")
    direction = normalize_direction_state(direction_state)
    side = str(trade_side or "").upper()
    blocker = ""
    action = original
    required_next = ""

    if overnight_required and overnight_allowed is False:
        blocker = "OVERNIGHT_CHECKLIST_FAILED"
        action = "EXIT_NOW"
        required_next = "Close the day trade. Overnight conversion is blocked until every overnight checklist item passes."
    elif min_dte is not None and dte is not None and dte < min_dte:
        blocker = "BLOCKED_BY_DTE"
        action = "EXIT_NOW" if is_open_position else "BLOCKED_BY_DTE"
        required_next = f"Use an expiration with at least {min_dte} DTE."
    elif direction == "PUT_ONLY" and side == "CALL":
        blocker = "BLOCKED_BY_DIRECTION"
        action = "BLOCKED_BY_DIRECTION"
        required_next = "Only PUT setups are allowed while direction is PUT_ONLY."
    elif direction == "CALL_ONLY" and side == "PUT":
        blocker = "BLOCKED_BY_DIRECTION"
        action = "BLOCKED_BY_DIRECTION"
        required_next = "Only CALL setups are allowed while direction is CALL_ONLY."
    elif str(extension_state or "").upper().replace(" ", "_") in {
        "EXTENDED", "VERY_EXTENDED", "EXTREME", "LATE", "EXHAUSTED", "DO_NOT_CHASE",
        "EXTENDED_DECLINE", "EXTENDED_ADVANCE",
    }:
        blocker = "DO_NOT_CHASE"
        action = "DO_NOT_CHASE"
        required_next = "Wait for pullback, reset, or a fresh confirmation trigger."
    elif volume_required and volume_confirmed is False:
        blocker = "BLOCKED_BY_VOLUME"
        action = "WAIT"
        required_next = "Wait for volume confirmation before marking this setup confirmed."

    if blocker:
        return {
            "original_action": original,
            "final_action": action,
            "blocker": blocker,
            "blocked": True,
            "bias": direction,
            "trade_side": side or "NEUTRAL",
            "required_next_condition": required_next,
        }

    return {
        "original_action": original,
        "final_action": original,
        "blocker": "",
        "blocked": False,
        "bias": direction,
        "trade_side": side or "NEUTRAL",
        "required_next_condition": "Follow the current entry/exit plan.",
    }
