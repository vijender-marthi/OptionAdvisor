"""Backend-owned Day Trade workspace view model assembly.

This module is a presentation contract adapter: it reuses the existing
DayTradeScan output and converts it into a page-ready workspace model. It does
not add strategy rules or alter the trading engine.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any


DAY_TRADE_WORKSPACE_SCHEMA_VERSION = "day-trade-workspace.v1"


def _now_iso() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def _as_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    return {}


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _num(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _display_money(value: Any) -> dict[str, Any]:
    n = _num(value)
    if n is None:
        return {"raw": None, "display": "—"}
    return {"raw": round(n, 4), "display": f"${n:,.2f}"}


def _display_percent(value: Any) -> dict[str, Any]:
    n = _num(value)
    if n is None:
        return {"raw": None, "display": "—"}
    tone = "positive" if n > 0 else "danger" if n < 0 else "neutral"
    sign = "+" if n > 0 else ""
    return {"raw": round(n, 4), "display": f"{sign}{n:.2f}%", "tone": tone}


def _display_text(value: Any, fallback: str = "—") -> dict[str, Any]:
    text = str(value).strip() if value is not None else ""
    return {"raw": value if value is not None else None, "display": text or fallback}


def _tab_item(label: str, value: Any, tone: str = "neutral", detail: str | None = None) -> dict[str, Any]:
    if isinstance(value, dict) and "display" in value:
        display = str(value.get("display") or "—")
        raw = value.get("raw")
    else:
        raw = value if value is not None else None
        display = str(value).strip() if value not in (None, "") else "—"
    return {
        "label": label,
        "value": display,
        "raw": raw,
        "tone": tone,
        "detail": detail,
    }


def _status(code: str, label: str, tone: str, description: str = "") -> dict[str, Any]:
    return {"code": code, "label": label, "tone": tone, "description": description}


def _truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.strip().upper() in {"1", "TRUE", "YES", "Y", "ON", "ACTIVE", "HALT", "BLOCKED"}
    return bool(value)


def _first_present(*values: Any) -> Any:
    for value in values:
        if value not in (None, "", [], {}):
            return value
    return None


def _permission_from_state(
    *,
    final_decision: str,
    mode: str,
    metrics: dict[str, Any],
    resolved: dict[str, Any],
    entry_guidance: dict[str, Any],
) -> dict[str, Any]:
    final = (final_decision or "").strip().upper()
    if mode == "review":
        return _status("complete", "Review Only", "neutral", "Historical sessions cannot open live entries.")
    if _truthy(_first_present(resolved.get("active_position_requires_management"), metrics.get("active_position_requires_management"), entry_guidance.get("active_position_requires_management"))) or final in {"ACTIVE", "MANAGE"}:
        return _status("manage", "Manage", "managing", "An active position should be managed before considering a new entry.")
    if _truthy(_first_present(resolved.get("trade_complete"), metrics.get("trade_complete"), entry_guidance.get("trade_complete"))) or final in {"COMPLETE", "EXITED"}:
        return _status("complete", "Complete", "neutral", "The trade or session is complete.")
    blocker = _first_present(
        resolved.get("risk_halt"),
        resolved.get("blocked_reason"),
        metrics.get("risk_halt"),
        metrics.get("blocked_reason"),
        metrics.get("data_error"),
        entry_guidance.get("blocker"),
        entry_guidance.get("disabled_reason"),
    )
    if blocker or final in {"NO_TRADE", "NO-GO", "NO_GO", "AVOID", "BLOCKED", "DATA_ERROR", "DO_NOT_CHASE", "NO_EDGE"}:
        reason = str(blocker or "Backend rules do not permit a new entry.")
        return _status("blocked", "Blocked", "danger", reason)
    if final in {"GO", "READY", "EXECUTE", "STRONG GO"}:
        return _status("ready", "Ready", "positive", "Execution rules are satisfied by the backend.")
    if final in {"WAIT", "WATCH", "TRACK_ONLY", "WAIT_ENTRY", "OPENING_RANGE", "WAIT_PULLBACK"}:
        return _status("wait", "Wait", "warning", "Setup is not ready for execution.")
    return _status("blocked", "Blocked", "danger", "Backend rules do not permit a new entry.")


def _primary_action(permission: dict[str, Any], symbol: str, entry: Any) -> dict[str, Any]:
    code = permission.get("code")
    if code == "ready":
        return {
            "id": "open_trade_ticket",
            "type": "open_trade_ticket",
            "label": "Open Trade Ticket",
            "enabled": True,
            "payload": {"ticker": symbol, "entry": _num(entry)},
        }
    if code == "manage":
        return {
            "id": "manage_position",
            "type": "manage_position",
            "label": "Manage Position",
            "enabled": True,
            "payload": {"ticker": symbol},
        }
    if code == "complete":
        return {
            "id": "review_session",
            "type": "review_session",
            "label": "Review Session",
            "enabled": True,
            "payload": {"ticker": symbol},
        }
    return {
        "id": "create_trigger_alert",
        "type": "create_trigger_alert",
        "label": "Create Trigger Alert",
        "enabled": False,
        "disabledReason": permission.get("description") or "Entry is not currently allowed.",
        "payload": {"ticker": symbol},
    }


def _chart_candles(chart_bars: list[Any]) -> list[dict[str, Any]]:
    candles: list[dict[str, Any]] = []
    for bar in chart_bars:
        if not isinstance(bar, dict):
            continue
        time_value = bar.get("time") or bar.get("t")
        open_value = _num(bar.get("open", bar.get("o")))
        high_value = _num(bar.get("high", bar.get("h")))
        low_value = _num(bar.get("low", bar.get("l")))
        close_value = _num(bar.get("close", bar.get("c")))
        volume_value = _num(bar.get("volume", bar.get("v")))
        if not time_value or open_value is None or high_value is None or low_value is None or close_value is None:
            continue
        candles.append(
            {
                "time": str(time_value),
                "open": open_value,
                "high": high_value,
                "low": low_value,
                "close": close_value,
                "volume": volume_value or 0.0,
            }
        )
    return candles


def _parse_bar_time(value: Any) -> datetime | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def _bucket_start(value: datetime, interval: str) -> datetime:
    minutes = 15 if interval == "15m" else 5 if interval == "5m" else 1
    minute = (value.minute // minutes) * minutes
    return value.replace(minute=minute, second=0, microsecond=0)


def _interval_chart_bars(chart_bars: list[Any], interval: str) -> list[dict[str, Any]]:
    """Shape backend chart bars to the requested interval.

    VWAP remains the canonical cumulative value from the final source bar in
    each bucket. It is never averaged from lower-timeframe VWAP points.
    """
    if interval not in {"5m", "15m"}:
        return [bar for bar in chart_bars if isinstance(bar, dict)]

    buckets: list[dict[str, Any]] = []
    current_key: datetime | None = None
    current: dict[str, Any] | None = None

    for raw in chart_bars:
        if not isinstance(raw, dict):
            continue
        raw_time = raw.get("time") or raw.get("t")
        parsed = _parse_bar_time(raw_time)
        if parsed is None:
            continue
        key = _bucket_start(parsed, interval)
        open_value = _num(raw.get("open", raw.get("o")))
        high_value = _num(raw.get("high", raw.get("h")))
        low_value = _num(raw.get("low", raw.get("l")))
        close_value = _num(raw.get("close", raw.get("c")))
        volume_value = _num(raw.get("volume", raw.get("v"))) or 0.0
        if open_value is None or high_value is None or low_value is None or close_value is None:
            continue

        if current is None or current_key != key:
            if current is not None:
                buckets.append(current)
            current_key = key
            current = {
                "t": key.isoformat(),
                "o": round(open_value, 4),
                "h": round(high_value, 4),
                "l": round(low_value, 4),
                "c": round(close_value, 4),
                "v": round(volume_value, 4),
                "vwap": round(_num(raw.get("vwap")), 4) if _num(raw.get("vwap")) is not None else None,
                "vwap_source_time": str(raw_time),
            }
        else:
            current["h"] = round(max(float(current["h"]), high_value), 4)
            current["l"] = round(min(float(current["l"]), low_value), 4)
            current["c"] = round(close_value, 4)
            current["v"] = round(float(current["v"]) + volume_value, 4)
            vwap_value = _num(raw.get("vwap"))
            current["vwap"] = round(vwap_value, 4) if vwap_value is not None else None
            current["vwap_source_time"] = str(raw_time)

    if current is not None:
        buckets.append(current)
    return buckets


def _five_minute_bars_for_structure(chart_bars: list[Any]) -> list[dict[str, Any]]:
    """Build backend-owned 5m OHLC bars for chart structure presentation."""
    return _interval_chart_bars(chart_bars, "5m")


DAY_STRUCTURE_LEFT_BARS = 2
DAY_STRUCTURE_RIGHT_BARS = 2
DAY_STRUCTURE_MIN_MOVE_PCT = 0.0005
DAY_STRUCTURE_ATR_MULTIPLIER = 0.0
DAY_STRUCTURE_TICK_SIZE = 0.01
DAY_STRUCTURE_TOLERANCE_ATR_MULTIPLIER = 0.0


def _true_range(high: float, low: float, previous_close: float | None) -> float:
    if previous_close is None:
        return max(0.0, high - low)
    return max(high - low, abs(high - previous_close), abs(low - previous_close))


def _structure_settings(bars: list[dict[str, Any]], metrics: dict[str, Any]) -> dict[str, Any]:
    closes: list[float] = []
    ranges: list[float] = []
    prev_close: float | None = None
    for bar in bars[-14:]:
        high = _num(bar.get("h", bar.get("high")))
        low = _num(bar.get("l", bar.get("low")))
        close = _num(bar.get("c", bar.get("close")))
        if high is None or low is None:
            continue
        ranges.append(_true_range(high, low, prev_close))
        if close is not None:
            closes.append(close)
            prev_close = close
    atr = sum(ranges) / len(ranges) if ranges else 0.0
    reference_price = closes[-1] if closes else (_num(metrics.get("last_price")) or 0.0)
    pct_move = reference_price * DAY_STRUCTURE_MIN_MOVE_PCT if reference_price > 0 else 0.0
    configured_min = _num(metrics.get("day_structure_minimum_move"))
    configured_tolerance = _num(metrics.get("day_structure_comparison_tolerance"))
    minimum_move = configured_min if configured_min is not None else max(pct_move, atr * DAY_STRUCTURE_ATR_MULTIPLIER)
    comparison_tolerance = configured_tolerance if configured_tolerance is not None else max(
        DAY_STRUCTURE_TICK_SIZE,
        atr * DAY_STRUCTURE_TOLERANCE_ATR_MULTIPLIER,
    )
    return {
        "leftBars": DAY_STRUCTURE_LEFT_BARS,
        "rightBars": DAY_STRUCTURE_RIGHT_BARS,
        "comparisonTolerance": round(comparison_tolerance, 4),
        "minimumMove": round(minimum_move, 4),
        "atr14": round(atr, 4),
    }


def _candidate_pivots(bars: list[dict[str, Any]], settings: dict[str, Any]) -> list[dict[str, Any]]:
    left = int(settings["leftBars"])
    right = int(settings["rightBars"])
    candidates: list[dict[str, Any]] = []
    if len(bars) < left + right + 1:
        return candidates
    for index in range(left, len(bars) - right):
        bar = bars[index]
        high = _num(bar.get("h", bar.get("high")))
        low = _num(bar.get("l", bar.get("low")))
        if high is None or low is None:
            continue
        left_bars = bars[index - left:index]
        right_bars = bars[index + 1:index + right + 1]
        left_highs = [_num(b.get("h", b.get("high"))) for b in left_bars]
        right_highs = [_num(b.get("h", b.get("high"))) for b in right_bars]
        left_lows = [_num(b.get("l", b.get("low"))) for b in left_bars]
        right_lows = [_num(b.get("l", b.get("low"))) for b in right_bars]
        ts = str(bar.get("t") or bar.get("time") or "")
        if all(v is not None and high > v for v in [*left_highs, *right_highs]):
            candidates.append({"_index": index, "pivotType": "HIGH", "price": high, "timestamp": ts})
        if all(v is not None and low < v for v in [*left_lows, *right_lows]):
            candidates.append({"_index": index, "pivotType": "LOW", "price": low, "timestamp": ts})
    return sorted(candidates, key=lambda item: int(item["_index"]))


def _normalize_pivots(candidates: list[dict[str, Any]], minimum_move: float) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for candidate in candidates:
        if not normalized:
            normalized.append(candidate)
            continue
        last = normalized[-1]
        if candidate["pivotType"] == last["pivotType"]:
            if candidate["pivotType"] == "HIGH" and float(candidate["price"]) > float(last["price"]):
                normalized[-1] = candidate
            elif candidate["pivotType"] == "LOW" and float(candidate["price"]) < float(last["price"]):
                normalized[-1] = candidate
            continue
        if abs(float(candidate["price"]) - float(last["price"])) < minimum_move:
            continue
        normalized.append(candidate)
    return normalized


def _classify_pivots(pivots: list[dict[str, Any]], tolerance: float) -> list[dict[str, Any]]:
    previous_high: float | None = None
    previous_low: float | None = None
    out: list[dict[str, Any]] = []
    for item in pivots:
        price = float(item["price"])
        ptype = str(item["pivotType"])
        if ptype == "HIGH":
            if previous_high is None:
                label = "HH"
            else:
                diff = price - previous_high
                label = "HH" if diff > tolerance else "LH" if diff < -tolerance else "EQH"
            previous_high = price
        else:
            if previous_low is None:
                label = "HL"
            else:
                diff = price - previous_low
                label = "HL" if diff > tolerance else "LL" if diff < -tolerance else "EQL"
            previous_low = price
        out.append({
            "id": f"structure-{ptype.lower()}-{int(item['_index'])}",
            "timestamp": item["timestamp"],
            "label": label,
            "classification": label,
            "pivotType": ptype,
            "type": ptype,
            "price": round(price, 4),
            "sourceTimeframe": "5m",
            "timeframe": "5m",
            "confirmed": True,
            "status": "CONFIRMED",
            "latest": False,
            "explanation": f"Confirmed backend 5-minute swing {ptype.lower()} compared against the prior confirmed {ptype.lower()}.",
            "_index": int(item["_index"]),
        })
    return out


def _trend_from_pivots(pivots: list[dict[str, Any]]) -> tuple[str, str, str, float]:
    highs = [p for p in pivots if p["pivotType"] == "HIGH"]
    lows = [p for p in pivots if p["pivotType"] == "LOW"]
    if len(highs) < 2 or len(lows) < 2:
        return "UNCONFIRMED", "UNCONFIRMED", "Unconfirmed", 0.35
    high_label = highs[-1]["label"]
    low_label = lows[-1]["label"]
    if high_label == "HH" and low_label == "HL":
        return "BULLISH", "HH/HL", "HH -> HL", 0.82
    if high_label == "LH" and low_label == "LL":
        return "BEARISH", "LH/LL", "LL -> LH", 0.82
    if high_label in {"EQH"} and low_label in {"EQL"}:
        return "RANGE", "EQH/EQL", "Range", 0.58
    if high_label in {"EQH"} or low_label in {"EQL"}:
        return "RANGE", "RANGE", "Range", 0.55
    return "TRANSITION", f"{high_label}/{low_label}", "Transition", 0.62


def _expected_next_pivot(trend: str, current: dict[str, Any] | None) -> str:
    if current is None:
        return "UNKNOWN"
    if trend == "BULLISH":
        return "CONTINUATION_LOW" if current.get("pivotType") == "HIGH" else "CONTINUATION_HIGH"
    if trend == "BEARISH":
        return "CONTINUATION_LOW" if current.get("pivotType") == "HIGH" else "CONTINUATION_HIGH"
    return "UNCONFIRMED"


def _market_structure(chart_bars: list[Any], metrics: dict[str, Any]) -> dict[str, Any]:
    bars = _five_minute_bars_for_structure(chart_bars)
    settings = _structure_settings(bars, metrics)
    candidates = _candidate_pivots(bars, settings)
    normalized = _normalize_pivots(candidates, float(settings["minimumMove"]))
    pivots = _classify_pivots(normalized, float(settings["comparisonTolerance"]))[-15:]
    if pivots:
        pivots[-1]["latest"] = True
    trend, structure, display, derived_confidence = _trend_from_pivots(pivots)
    for item in pivots:
        item.pop("_index", None)

    sequence = [str(item["label"]) for item in pivots[-8:]]
    current_pivot = pivots[-1] if pivots else None
    current_label = str(current_pivot["label"]) if current_pivot else None
    invalidation: float | None = None
    if trend == "BULLISH":
        lows = [float(item["price"]) for item in pivots if item.get("pivotType") == "LOW" and item.get("label") == "HL"]
        invalidation = lows[-1] if lows else _num(metrics.get("or_low"))
    elif trend == "BEARISH":
        highs = [float(item["price"]) for item in pivots if item.get("pivotType") == "HIGH" and item.get("label") == "LH"]
        invalidation = highs[-1] if highs else _num(metrics.get("or_high"))

    strength = _num(metrics.get("confidence"))
    confidence = derived_confidence if strength is None else min(1.0, max(0.0, float(strength) / 100.0))
    return {
        "id": "market-structure-5m",
        "timeframe": "5m",
        "trend": trend,
        "structure": structure,
        "display": display,
        "confidence": round(confidence, 2),
        "sequence": sequence,
        "currentPivot": current_label,
        "currentPivotDetail": current_pivot,
        "expectedNext": _expected_next_pivot(trend, current_pivot),
        "expectedNextPivot": _expected_next_pivot(trend, current_pivot),
        "invalidationLevel": round(invalidation, 4) if invalidation is not None else None,
        "invalidation": (
            {
                "price": round(invalidation, 4),
                "basedOn": "LAST_CONFIRMED_HL" if trend == "BULLISH" else "LAST_CONFIRMED_LH",
            }
            if invalidation is not None else None
        ),
        "structureStrength": round(strength, 2) if strength is not None else None,
        "sourceTimeframe": "5m",
        "pivots": pivots,
        "settings": settings,
        "visibleByDefault": True,
        "showZigZagByDefault": True,
        "explanation": "Day Trade structure uses backend-confirmed 5-minute pivots; 1-minute candles remain execution-only.",
    }


def _vwap_overlay(chart_bars: list[Any], metrics: dict[str, Any], session_date: str | None) -> dict[str, Any]:
    points: list[dict[str, Any]] = []
    latest_value: float | None = None
    latest_as_of: str | None = None
    for index, bar in enumerate(chart_bars):
        if not isinstance(bar, dict):
            continue
        time_value = bar.get("time") or bar.get("t")
        if not time_value:
            continue
        vwap_value = _num(bar.get("vwap"))
        quality = "good" if vwap_value is not None else "unavailable"
        state = "forming" if index == len(chart_bars) - 1 else "closed"
        if vwap_value is not None:
            latest_value = round(vwap_value, 4)
            latest_as_of = str(bar.get("vwap_source_time") or time_value)
        points.append(
            {
                "barStartUtc": str(time_value),
                "value": round(vwap_value, 4) if vwap_value is not None else None,
                "sourceTimestampUtc": str(bar.get("vwap_source_time") or time_value),
                "state": state,
                "quality": quality,
            }
        )

    if latest_value is None:
        latest_value = _num(metrics.get("vwap"))
        if latest_value is not None:
            latest_value = round(latest_value, 4)

    return {
        "id": "session-vwap",
        "label": "VWAP",
        "sessionDate": str(metrics.get("session_date") or session_date or date.today().isoformat()),
        "exchangeTimeZone": "America/New_York",
        "anchorPolicy": "regular_session_open",
        "includesExtendedHours": False,
        "latestValue": latest_value,
        "latestAsOfUtc": latest_as_of,
        "visibleByDefault": True,
        "affectsTradeFocusScale": False,
        "points": points,
    }


def _level(level_id: str, kind: str, price: Any, label: str, tone: str, priority: int, active: bool = True, visible: bool = True, scale: bool = True) -> dict[str, Any] | None:
    n = _num(price)
    if n is None or n <= 0:
        return None
    return {
        "id": level_id,
        "kind": kind,
        "price": round(n, 4),
        "label": label,
        "tone": tone,
        "lineStyleToken": f"dayTrade.{kind}",
        "active": active,
        "visibleByDefault": visible,
        "affectsTradeFocusScale": scale,
        "priority": priority,
    }


def _chart_levels(metrics: dict[str, Any], entry_guidance: dict[str, Any]) -> list[dict[str, Any]]:
    levels = [
        _level("entry", "entry", entry_guidance.get("entry_price") or entry_guidance.get("current_price") or metrics.get("last_price"), "Entry", "positive", 10),
        _level("stop", "stop", entry_guidance.get("stop_price") or entry_guidance.get("risk_below"), "Stop", "danger", 20),
        _level("target1", "target", entry_guidance.get("scalp_target") or entry_guidance.get("target_1"), "T1", "positive", 30),
        _level("target2", "target", entry_guidance.get("target_2"), "T2", "positive", 40),
        _level("or_high", "or_high", metrics.get("or_high"), "ORH", "info", 60),
        _level("or_low", "or_low", metrics.get("or_low"), "ORL", "info", 70),
    ]
    or_high = _num(metrics.get("or_high"))
    or_low = _num(metrics.get("or_low"))
    if or_high is not None and or_low is not None and or_high >= or_low:
        levels.append(_level("or_mid", "or_mid", (or_high + or_low) / 2.0, "OR Mid", "neutral", 80, scale=False))
    return [item for item in levels if item is not None]


def _requirements(metrics: dict[str, Any]) -> list[dict[str, Any]]:
    trigger_fired = bool(metrics.get("trigger_fired"))
    requirement = str(metrics.get("trigger_requirement") or "Wait for backend trigger confirmation.")
    return [
        {
            "id": "trigger_confirmation",
            "label": requirement,
            "displayValue": "Triggered" if trigger_fired else "Pending",
            "result": "pass" if trigger_fired else "pending",
            "tone": "positive" if trigger_fired else "warning",
        }
    ]


def _evidence(scan: Any, resolved: dict[str, Any], metrics: dict[str, Any]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    order = 1
    for reason in _as_list(getattr(scan, "reasons", []))[:5]:
        items.append({"id": f"reason_{order}", "label": str(reason), "result": "pass", "tone": "info", "order": order})
        order += 1
    for missing in _as_list(resolved.get("missing_confirmations"))[:4]:
        items.append({"id": f"missing_{order}", "label": str(missing), "result": "pending", "tone": "warning", "order": order})
        order += 1
    if metrics.get("data_quality_status"):
        status = str(metrics.get("data_quality_status"))
        items.append({"id": "data_quality", "label": f"Data quality: {status}", "result": "pass" if status == "OK" else "fail", "tone": "positive" if status == "OK" else "danger", "order": order})
    return items


def _workspace_tabs(
    *,
    symbol: str,
    reason: str,
    next_condition: str,
    permission: dict[str, Any],
    trigger: dict[str, Any],
    risk_plan: dict[str, Any],
    option_risk: dict[str, Any],
    levels: list[dict[str, Any]],
    events: list[dict[str, Any]],
    mode: str,
) -> dict[str, Any]:
    return {
        "plan": {
            "title": "Plan",
            "summary": reason,
            "items": [
                _tab_item("Permission", permission.get("label"), permission.get("tone", "neutral"), permission.get("description")),
                _tab_item("Next Condition", next_condition, "warning" if permission.get("code") == "wait" else "neutral"),
                _tab_item("Trigger", trigger.get("summary"), trigger.get("status", {}).get("tone", "neutral")),
                _tab_item("Mode", mode.title(), "info"),
            ],
        },
        "options": {
            "title": "Options",
            "summary": "Backend-prepared option context for the current Day Trade workspace.",
            "items": [
                _tab_item("Recommended Size", risk_plan.get("positionSize"), "info"),
                _tab_item("Risk / Reward", risk_plan.get("riskReward"), "neutral"),
                _tab_item("Contracts", option_risk.get("recommended_contracts") or "1 contract max", "info"),
                _tab_item("Option Risk", option_risk.get("risk_level") or option_risk.get("risk") or "—", "warning"),
            ],
        },
        "events": {
            "title": "Events",
            "summary": "Backend-provided session events and chart markers.",
            "items": [
                _tab_item(event.get("title", "Event"), event.get("detail") or event.get("eventType") or event.get("timestamp"), event.get("tone", "neutral"))
                for event in events
            ] or [_tab_item("Events", "No backend events for this workspace.", "neutral")],
        },
        "alerts": {
            "title": "Alerts",
            "summary": "Create alerts from the backend-approved next condition and active levels.",
            "items": [
                _tab_item("Primary Alert", next_condition, "warning" if next_condition else "neutral"),
                *[
                    _tab_item(level.get("label", "Level"), f"${float(level.get('price', 0)):.2f}", level.get("tone", "neutral"))
                    for level in levels
                    if level.get("visibleByDefault")
                ][:5],
            ],
        },
        "position": {
            "title": "Position",
            "summary": "Position guidance is controlled by the backend workspace permission state.",
            "items": [
                _tab_item("Current State", permission.get("label"), permission.get("tone", "neutral"), permission.get("description")),
                _tab_item("Entry", risk_plan.get("entry"), "positive"),
                _tab_item("Stop", risk_plan.get("stop"), "danger"),
                _tab_item("Target 1", risk_plan.get("target1"), "positive"),
                _tab_item("Target 2", risk_plan.get("target2"), "positive"),
            ],
        },
        "journal": {
            "title": "Journal",
            "summary": "Save the backend workspace state and decision context to the trading journal.",
            "items": [
                _tab_item("Ticker", symbol, "info"),
                _tab_item("Decision", permission.get("label"), permission.get("tone", "neutral")),
                _tab_item("Reason", reason, "neutral"),
                _tab_item("Review Copy", "Historical review mode" if mode == "review" else "Live workspace snapshot", "neutral"),
            ],
        },
    }


def _workspace_mode(metrics: dict[str, Any], requested_session_date: str | None) -> str:
    session_date = str(metrics.get("session_date") or "")
    if requested_session_date and session_date and requested_session_date != session_date:
        return "review"
    if requested_session_date and not session_date:
        return "planning"
    return "live"


def build_day_trade_workspace_response(
    *,
    scan: Any,
    resolved: dict[str, Any],
    session_date: str | None = None,
    interval: str = "1m",
) -> dict[str, Any]:
    metrics = _as_dict(getattr(scan, "metrics", {}))
    entry_guidance = _as_dict(getattr(scan, "entry_guidance", {}))
    trader_decision = _as_dict(getattr(scan, "trader_decision", {}))
    option_risk = _as_dict(getattr(scan, "option_risk_context", {}))
    symbol = str(getattr(scan, "ticker", "") or "").upper()
    mode = _workspace_mode(metrics, session_date)
    final_decision = str(resolved.get("final_decision") or resolved.get("verdict") or getattr(scan, "verdict", "WAIT")).upper()
    permission = _permission_from_state(
        final_decision=final_decision,
        mode=mode,
        metrics=metrics,
        resolved=resolved,
        entry_guidance=entry_guidance,
    )
    entry = entry_guidance.get("entry_price") or entry_guidance.get("current_price") or metrics.get("last_price")
    stop = entry_guidance.get("stop_price") or entry_guidance.get("risk_below")
    target1 = entry_guidance.get("scalp_target") or entry_guidance.get("target_1")
    target2 = entry_guidance.get("target_2")
    raw_chart_bars = _as_list(metrics.get("chart_bars"))
    market_structure = _market_structure(raw_chart_bars, metrics)
    chart_bars = _interval_chart_bars(raw_chart_bars, interval)
    candles = _chart_candles(chart_bars)
    vwap_overlay = _vwap_overlay(chart_bars, metrics, session_date)
    levels = _chart_levels(metrics, entry_guidance)
    events: list[dict[str, Any]] = []
    scale_level_ids = [level["id"] for level in levels if level.get("affectsTradeFocusScale")]
    reason = str(resolved.get("reason") or trader_decision.get("decision_message") or (getattr(scan, "reasons", []) or [""])[0] or "Backend workspace assembled from the current Day Trade scan.")
    next_condition = str(metrics.get("trigger_requirement") or entry_guidance.get("next_action") or trader_decision.get("next_condition") or reason)
    context_label = str(metrics.get("market_bias") or resolved.get("market_bias") or getattr(scan, "bias", None) or "Neutral").replace("_", " ").title()

    trigger_view = {
        "status": _status("triggered" if metrics.get("trigger_fired") else "pending", "Triggered" if metrics.get("trigger_fired") else "Pending", "positive" if metrics.get("trigger_fired") else "warning"),
        "summary": str(metrics.get("trigger_requirement") or "Backend trigger requirement is pending."),
        "requirements": _requirements(metrics),
    }
    risk_plan = {
        "entry": _display_money(entry),
        "stop": _display_money(stop),
        "target1": _display_money(target1),
        "target2": _display_money(target2),
        "positionSize": _display_text(option_risk.get("recommended_contracts") or "1 contract max"),
        "riskReward": _display_text(entry_guidance.get("rr_ratio") or entry_guidance.get("risk_reward") or "—"),
    }

    return {
        "schemaVersion": DAY_TRADE_WORKSPACE_SCHEMA_VERSION,
        "generatedAt": _now_iso(),
        "symbol": {
            "ticker": symbol,
            "companyName": str(getattr(scan, "company_name", "") or symbol),
            "price": _display_money(metrics.get("last_price")),
            "change": _display_percent(metrics.get("change_pct") or metrics.get("session_change_pct")),
        },
        "session": {
            "mode": mode,
            "status": _status(str(metrics.get("market_state") or "UNKNOWN"), str(metrics.get("session_phase") or "Session"), "info"),
            "sessionDate": str(metrics.get("session_date") or session_date or date.today().isoformat()),
            "displayDate": str(metrics.get("session_date") or session_date or date.today().isoformat()),
            "marketTimeZone": "America/New_York",
            "isExecutionAllowed": mode == "live" and permission.get("code") == "ready",
            "reviewCopy": "Historical review mode. Live execution is disabled." if mode == "review" else None,
        },
        "decision": {
            "context": _status(str(resolved.get("market_bias") or "NEUTRAL"), context_label, "info", str(metrics.get("opening_playbook_reason") or "")),
            "permission": permission,
            "headline": str(resolved.get("headline") or final_decision.replace("_", " ").title()),
            "reason": reason,
            "nextCondition": next_condition,
            "setupName": str(metrics.get("trigger_setup") or metrics.get("opening_playbook") or ""),
            "primaryAction": _primary_action(permission, symbol, entry),
            "secondaryActions": [
                {"id": "save_review", "type": "save_review", "label": "Save Review", "enabled": True, "payload": {"ticker": symbol}},
                {"id": "create_alert", "type": "create_trigger_alert", "label": "Create Alert", "enabled": bool(next_condition), "payload": {"ticker": symbol}},
            ],
        },
        "trigger": trigger_view,
        "riskPlan": risk_plan,
        "evidence": _evidence(scan, resolved, metrics),
        "selectedContract": None,
        "chart": {
            "candles": candles,
            "levels": levels,
            "events": events,
            "vwapOverlay": vwap_overlay,
            "marketStructure": market_structure,
            "defaults": {
                "interval": interval if interval in {"1m", "5m", "15m"} else "1m",
                "visibleRange": "1h",
                "initialVisibleBars": 100,
                "initialBarSpacing": 10,
                "minBarSpacing": 3,
                "maxBarSpacing": 20,
                "rightOffsetBars": 6,
                "scaleMode": "trade_focus",
                "followLive": mode == "live",
                "visibleOverlayIds": [
                    *[level["id"] for level in levels if level.get("visibleByDefault")],
                    *([vwap_overlay["id"]] if vwap_overlay.get("visibleByDefault") else []),
                    *([market_structure["id"]] if market_structure.get("visibleByDefault") else []),
                ],
            },
            "tradeFocus": {
                "scalePaddingPercent": 8,
                "levelIdsAllowedToAffectScale": scale_level_ids,
            },
        },
        "tabs": _workspace_tabs(
            symbol=symbol,
            reason=reason,
            next_condition=next_condition,
            permission=permission,
            trigger=trigger_view,
            risk_plan=risk_plan,
            option_risk=option_risk,
            levels=levels,
            events=events,
            mode=mode,
        ),
        "provenance": {
            "ruleSetVersion": "day-trade-workspace-assembler-2026.07",
            "dataAsOf": metrics.get("data_debug_snapshot", {}).get("lastCandleTime") if isinstance(metrics.get("data_debug_snapshot"), dict) else None,
            "sourceIds": ["day_trade.run_day_trade_scan", "decision_resolver.resolve_trade_decision"],
        },
    }


def build_day_trade_workspace_unavailable_response(
    *,
    symbol: str,
    reason: str,
    session_date: str | None = None,
    interval: str = "1m",
) -> dict[str, Any]:
    """Return a safe page-ready workspace when source data is unavailable.

    Bad or missing market data must never become a hidden frontend failure or a
    trading recommendation. This fallback keeps the backend as the source of
    truth while making the problem explicit in the production UI.
    """
    ticker = str(symbol or "").strip().upper() or "UNKNOWN"
    clean_reason = str(reason or "").strip() or "Market data is unavailable."
    session_date_value = session_date or date.today().isoformat()
    permission = _status("blocked", "Data Unavailable", "danger", clean_reason)
    trigger_view = {
        "status": _status("data_unavailable", "Unavailable", "danger", clean_reason),
        "summary": "Signal generation is paused until backend market data is available.",
        "requirements": [
            {
                "id": "market_data_available",
                "label": "Backend market data available",
                "displayValue": "Unavailable",
                "result": "fail",
                "tone": "danger",
            }
        ],
    }
    risk_plan = {
        "entry": _display_money(None),
        "stop": _display_money(None),
        "target1": _display_money(None),
        "target2": _display_money(None),
        "positionSize": _display_text("No position"),
        "riskReward": _display_text("—"),
    }
    levels: list[dict[str, Any]] = []
    events = [
        {
            "id": "market_data_unavailable",
            "timestamp": _now_iso(),
            "eventType": "data_error",
            "title": "Market data unavailable",
            "detail": clean_reason,
            "tone": "danger",
            "visibleByDefault": True,
            "priority": 1,
        }
    ]
    vwap_overlay = {
        "id": "session-vwap",
        "label": "VWAP",
        "sessionDate": session_date_value,
        "exchangeTimeZone": "America/New_York",
        "anchorPolicy": "regular_session_open",
        "includesExtendedHours": False,
        "latestValue": None,
        "latestAsOfUtc": None,
        "visibleByDefault": True,
        "affectsTradeFocusScale": False,
        "points": [],
    }
    return {
        "schemaVersion": DAY_TRADE_WORKSPACE_SCHEMA_VERSION,
        "generatedAt": _now_iso(),
        "symbol": {
            "ticker": ticker,
            "companyName": ticker,
            "price": _display_money(None),
            "change": _display_percent(None),
        },
        "session": {
            "mode": "planning",
            "status": _status("DATA_UNAVAILABLE", "Data Unavailable", "danger", clean_reason),
            "sessionDate": session_date_value,
            "displayDate": session_date_value,
            "marketTimeZone": "America/New_York",
            "isExecutionAllowed": False,
            "reviewCopy": None,
        },
        "decision": {
            "context": _status("DATA_UNAVAILABLE", "Data Unavailable", "danger", clean_reason),
            "permission": permission,
            "headline": "Market data unavailable",
            "reason": clean_reason,
            "nextCondition": "Retry after the backend market-data source recovers or cached intraday data becomes available.",
            "setupName": "No trade",
            "primaryAction": {
                "id": "none",
                "type": "none",
                "label": "Unavailable",
                "enabled": False,
                "disabledReason": clean_reason,
                "payload": {"ticker": ticker},
            },
            "secondaryActions": [
                {"id": "save_review", "type": "save_review", "label": "Save Review", "enabled": True, "payload": {"ticker": ticker}},
            ],
        },
        "trigger": trigger_view,
        "riskPlan": risk_plan,
        "evidence": [
            {
                "id": "data_unavailable",
                "label": "Market data unavailable",
                "detail": clean_reason,
                "result": "fail",
                "tone": "danger",
                "order": 1,
                "ruleId": "day_trade_workspace.data_unavailable",
                "observedAt": _now_iso(),
            }
        ],
        "selectedContract": None,
        "chart": {
            "candles": [],
            "levels": levels,
            "events": events,
            "vwapOverlay": vwap_overlay,
            "marketStructure": None,
            "defaults": {
                "interval": interval if interval in {"1m", "5m", "15m"} else "1m",
                "visibleRange": "1h",
                "initialVisibleBars": 100,
                "initialBarSpacing": 10,
                "minBarSpacing": 3,
                "maxBarSpacing": 20,
                "rightOffsetBars": 6,
                "scaleMode": "trade_focus",
                "followLive": False,
                "visibleOverlayIds": ["session-vwap"],
            },
            "tradeFocus": {
                "scalePaddingPercent": 8,
                "levelIdsAllowedToAffectScale": [],
            },
        },
        "tabs": _workspace_tabs(
            symbol=ticker,
            reason=clean_reason,
            next_condition="Retry after backend data recovers.",
            permission=permission,
            trigger=trigger_view,
            risk_plan=risk_plan,
            option_risk={},
            levels=levels,
            events=events,
            mode="planning",
        ),
        "provenance": {
            "ruleSetVersion": "day-trade-workspace-assembler-2026.07",
            "dataAsOf": None,
            "sourceIds": ["day_trade_workspace.unavailable_fallback"],
        },
    }
