"""Backend-owned Day Trade workspace view model assembly.

This module is a presentation contract adapter: it reuses the existing
DayTradeScan output and converts it into a page-ready workspace model. It does
not add strategy rules or alter the trading engine.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from day_trade_trap_detection import build_trap_detection_from_metrics, build_unavailable_trap_detection


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


def _display_signed_money(value: Any) -> dict[str, Any]:
    n = _num(value)
    if n is None:
        return {"raw": None, "display": "—", "tone": "neutral"}
    tone = "positive" if n > 0 else "danger" if n < 0 else "neutral"
    sign = "+" if n > 0 else ""
    return {"raw": round(n, 4), "display": f"{sign}${n:,.2f}", "tone": tone}


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


def _display_ratio(value: float | None) -> dict[str, Any]:
    if value is None:
        return {"raw": None, "display": "—"}
    return {"raw": round(value, 4), "display": f"{value:.2f} : 1"}


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
    minutes = 60 if interval == "1h" else 15 if interval == "15m" else 5 if interval == "5m" else 1
    minute = (value.minute // minutes) * minutes
    return value.replace(minute=minute, second=0, microsecond=0)


def _interval_chart_bars(chart_bars: list[Any], interval: str) -> list[dict[str, Any]]:
    """Shape backend chart bars to the requested interval.

    VWAP remains the canonical cumulative value from the final source bar in
    each bucket. It is never averaged from lower-timeframe VWAP points.
    """
    if interval not in {"5m", "15m", "1h"}:
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
        # Seed pivots have no prior same-type pivot to compare against, so they
        # are labelled neutrally ("H"/"L") rather than asserting a "higher"/"lower"
        # relationship that cannot exist yet. HH/HL/LH/LL/EQH/EQL only apply once a
        # prior confirmed high/low exists.
        is_seed = False
        if ptype == "HIGH":
            if previous_high is None:
                label = "H"
                is_seed = True
            else:
                diff = price - previous_high
                label = "HH" if diff > tolerance else "LH" if diff < -tolerance else "EQH"
            previous_high = price
        else:
            if previous_low is None:
                label = "L"
                is_seed = True
            else:
                diff = price - previous_low
                label = "HL" if diff > tolerance else "LL" if diff < -tolerance else "EQL"
            previous_low = price
        explanation = (
            f"First confirmed backend 5-minute swing {ptype.lower()} — no prior confirmed {ptype.lower()} to compare against yet."
            if is_seed
            else f"Confirmed backend 5-minute swing {ptype.lower()} compared against the prior confirmed {ptype.lower()}."
        )
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
            "explanation": explanation,
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
    is_high = current.get("pivotType") == "HIGH"
    if trend == "BULLISH":
        # Uptrend: after a high expect a higher-low pullback; after a low expect a higher high.
        return "PULLBACK_HIGHER_LOW" if is_high else "CONTINUATION_HIGHER_HIGH"
    if trend == "BEARISH":
        # Downtrend: after a high expect a lower-low continuation; after a low expect a lower-high bounce.
        return "CONTINUATION_LOWER_LOW" if is_high else "BOUNCE_LOWER_HIGH"
    return "UNCONFIRMED"


def _provisional_pivot(
    bars: list[dict[str, Any]],
    confirmed: list[dict[str, Any]],
    settings: dict[str, Any],
    tolerance: float,
) -> dict[str, Any] | None:
    """Return the developing (not-yet-confirmed) pivot on the trailing edge.

    A confirmed pivot needs ``rightBars`` bars to its right, so a fresh reversal
    leg (e.g. a sell-off right after a peak HH) has no confirmed label yet and
    would otherwise show nothing on the chart. We surface that developing swing
    as a PROVISIONAL pivot — clearly marked as unconfirmed — computed only from
    bars *beyond* the last confirmed pivot's confirmation window, so the normal
    trailing confirmation bars never spuriously produce one.
    """
    if not confirmed or not bars:
        return None
    last = confirmed[-1]
    try:
        last_index = int(last.get("_index", -1))
    except (TypeError, ValueError):
        return None
    right_bars = int(settings["rightBars"])
    start = last_index + right_bars + 1
    tail = bars[start:] if 0 <= last_index else []
    if not tail:
        return None
    minimum_move = float(settings["minimumMove"])
    last_price = float(last["price"])
    developing_low = str(last.get("pivotType")) == "HIGH"

    ext_val: float | None = None
    ext_offset = 0
    for offset, bar in enumerate(tail):
        value = _num(bar.get("l", bar.get("low"))) if developing_low else _num(bar.get("h", bar.get("high")))
        if value is None:
            continue
        if ext_val is None or (value < ext_val if developing_low else value > ext_val):
            ext_val = value
            ext_offset = offset
    if ext_val is None or abs(ext_val - last_price) < minimum_move:
        return None

    ptype = "LOW" if developing_low else "HIGH"
    prior = [float(p["price"]) for p in confirmed if str(p.get("pivotType")) == ptype]
    prev = prior[-1] if prior else None
    if prev is None:
        label = "L" if developing_low else "H"
    else:
        diff = ext_val - prev
        if developing_low:
            label = "HL" if diff > tolerance else "LL" if diff < -tolerance else "EQL"
        else:
            label = "HH" if diff > tolerance else "LH" if diff < -tolerance else "EQH"

    index = start + ext_offset
    ts = str(bars[index].get("t") or bars[index].get("time") or "")
    return {
        "id": f"structure-{ptype.lower()}-provisional-{index}",
        "timestamp": ts,
        "label": label,
        "classification": label,
        "pivotType": ptype,
        "type": ptype,
        "price": round(float(ext_val), 4),
        "sourceTimeframe": "5m",
        "timeframe": "5m",
        "confirmed": False,
        "status": "PROVISIONAL",
        "provisional": True,
        "latest": True,
        "explanation": (
            f"Developing {ptype.lower()} forming since the last confirmed pivot — not yet confirmed "
            f"(needs up to {right_bars} more completed 5-minute bars to its right)."
        ),
    }


def _market_structure(chart_bars: list[Any], metrics: dict[str, Any]) -> dict[str, Any]:
    bars = _five_minute_bars_for_structure(chart_bars)
    settings = _structure_settings(bars, metrics)
    candidates = _candidate_pivots(bars, settings)
    normalized = _normalize_pivots(candidates, float(settings["minimumMove"]))
    confirmed_pivots = _classify_pivots(normalized, float(settings["comparisonTolerance"]))[-15:]
    # Trend / sequence / current pivot are derived from CONFIRMED pivots only, so a
    # not-yet-confirmed reversal never flips the trend prematurely.
    trend, structure, display, derived_confidence = _trend_from_pivots(confirmed_pivots)

    sequence = [str(item["label"]) for item in confirmed_pivots[-8:]]
    current_pivot = confirmed_pivots[-1] if confirmed_pivots else None
    current_label = str(current_pivot["label"]) if current_pivot else None

    invalidation: float | None = None
    if trend == "BULLISH":
        lows = [float(item["price"]) for item in confirmed_pivots if item.get("pivotType") == "LOW" and item.get("label") == "HL"]
        invalidation = lows[-1] if lows else _num(metrics.get("or_low"))
    elif trend == "BEARISH":
        highs = [float(item["price"]) for item in confirmed_pivots if item.get("pivotType") == "HIGH" and item.get("label") == "LH"]
        invalidation = highs[-1] if highs else _num(metrics.get("or_high"))

    # Developing trailing pivot (unconfirmed) so the chart reflects a fresh reversal leg.
    provisional = _provisional_pivot(bars, confirmed_pivots, settings, float(settings["comparisonTolerance"]))

    # Live invalidation breach: price has already traded through the last confirmed
    # structural stop even though a new pivot has not confirmed yet (the "lag" case).
    last_price = _num(metrics.get("last_price"))
    invalidation_breached = bool(
        invalidation is not None and last_price is not None and (
            (trend == "BULLISH" and last_price < invalidation)
            or (trend == "BEARISH" and last_price > invalidation)
        )
    )

    render_pivots: list[dict[str, Any]] = []
    for item in confirmed_pivots:
        clean = {k: v for k, v in item.items() if k != "_index"}
        clean["latest"] = False
        render_pivots.append(clean)
    if provisional is not None:
        render_pivots.append(provisional)
    if render_pivots:
        render_pivots[-1]["latest"] = True

    current_detail = {k: v for k, v in current_pivot.items() if k != "_index"} if current_pivot else None

    strength = _num(metrics.get("confidence"))
    confidence = derived_confidence if strength is None else min(1.0, max(0.0, float(strength) / 100.0))

    expected_next = _expected_next_pivot(trend, current_pivot)
    if invalidation_breached:
        expected_next = "REVERSAL_PENDING"

    return {
        "id": "market-structure-5m",
        "timeframe": "5m",
        "trend": trend,
        "structure": structure,
        "display": display,
        "confidence": round(confidence, 2),
        "sequence": sequence,
        "currentPivot": current_label,
        "currentPivotDetail": current_detail,
        "expectedNext": expected_next,
        "expectedNextPivot": expected_next,
        "provisionalPivot": provisional,
        "invalidationBreached": invalidation_breached,
        "invalidationLevel": round(invalidation, 4) if invalidation is not None else None,
        "invalidation": (
            {
                "price": round(invalidation, 4),
                "basedOn": "LAST_CONFIRMED_HL" if trend == "BULLISH" else "LAST_CONFIRMED_LH",
                "breached": invalidation_breached,
            }
            if invalidation is not None else None
        ),
        "structureStrength": round(strength, 2) if strength is not None else None,
        "sourceTimeframe": "5m",
        "pivots": render_pivots,
        "settings": settings,
        "visibleByDefault": True,
        "showZigZagByDefault": True,
        "explanation": "Day Trade structure uses backend-confirmed 5-minute pivots; the trailing developing pivot is shown provisionally until it confirms.",
    }


def _format_market_time(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.strftime("%-I:%M %p") if hasattr(value, "strftime") else None


def _setup_trigger_time(metrics: dict[str, Any], chart_bars: list[Any]) -> datetime | None:
    for key in ("trigger_time", "triggered_at", "entry_time", "breakout_time"):
        parsed = _parse_bar_time(metrics.get(key))
        if parsed is not None:
            return parsed
    if _truthy(metrics.get("trigger_fired")):
        for bar in chart_bars:
            if isinstance(bar, dict):
                parsed = _parse_bar_time(bar.get("time") or bar.get("t"))
                if parsed is not None:
                    return parsed
    return None


def _latest_bar_time(chart_bars: list[Any]) -> datetime | None:
    for bar in reversed(chart_bars):
        if isinstance(bar, dict):
            parsed = _parse_bar_time(bar.get("time") or bar.get("t"))
            if parsed is not None:
                return parsed
    return None


def _reward_risk(entry: Any, stop: Any, target1: Any, target2: Any) -> dict[str, Any]:
    entry_n = _num(entry)
    stop_n = _num(stop)
    target_n = _num(target2)
    target_used = "target2"
    if target_n is None:
        target_n = _num(target1)
        target_used = "target1"
    risk = abs(entry_n - stop_n) if entry_n is not None and stop_n is not None else None
    reward = abs(target_n - entry_n) if entry_n is not None and target_n is not None else None
    ratio = reward / risk if risk is not None and risk > 1e-9 and reward is not None else None
    return {
        "risk": _display_money(risk),
        "reward": _display_money(reward),
        "ratio": round(ratio, 4) if ratio is not None else None,
        "display": f"{ratio:.2f} : 1" if ratio is not None else "—",
        "targetUsed": target_used if target_n is not None else None,
    }


def _trend_health(market_structure: dict[str, Any], metrics: dict[str, Any], last_price: float | None, vwap: float | None) -> dict[str, Any]:
    sequence = [str(item) for item in market_structure.get("sequence", [])]
    trend = str(market_structure.get("trend") or "").upper()
    confidence = _num(market_structure.get("confidence")) or 0.0
    if confidence <= 1:
        confidence *= 100
    structure_score = confidence
    if trend == "BULLISH" and {"HH", "HL"}.issubset(set(sequence[-4:])):
        structure_score = max(structure_score, 82)
    elif trend == "BEARISH" and {"LH", "LL"}.issubset(set(sequence[-4:])):
        structure_score = max(structure_score, 82)
    elif trend == "TRANSITION":
        structure_score = min(max(structure_score, 48), 68)

    vwap_score = 50.0
    if last_price is not None and vwap is not None and vwap > 0:
        above_vwap = last_price >= vwap
        vwap_score = 82 if (trend == "BULLISH" and above_vwap) or (trend == "BEARISH" and not above_vwap) else 38
        distance = abs(last_price - vwap) / vwap * 100
        if distance > 1.5:
            vwap_score -= min(20, (distance - 1.5) * 5)

    volume_ratio = _num(metrics.get("volume_ratio") or metrics.get("relative_volume") or metrics.get("rvol"))
    volume_score = 55.0 if volume_ratio is None else max(20.0, min(100.0, 45.0 + volume_ratio * 25.0))
    momentum_score = _num(metrics.get("momentum_score") or metrics.get("trend_strength") or metrics.get("confidence"))
    momentum_score = max(20.0, min(100.0, momentum_score if momentum_score is not None else structure_score))
    pullback_depth_score = vwap_score
    score = round(max(0.0, min(100.0, structure_score * 0.35 + vwap_score * 0.2 + momentum_score * 0.2 + volume_score * 0.15 + pullback_depth_score * 0.1)), 1)
    label = "Excellent trend" if score >= 96 else "Healthy" if score >= 80 else "Weakening" if score >= 60 else "Transition" if score >= 40 else "Trend failure"
    return {
        "score": score,
        "label": label,
        "explanation": f"{label}: structure, VWAP respect, momentum, volume, and pullback depth score {score:.0f}/100.",
        "inputs": {
            "structure": round(structure_score, 1),
            "vwapRespect": round(vwap_score, 1),
            "momentum": round(momentum_score, 1),
            "volume": round(volume_score, 1),
            "pullbackDepth": round(pullback_depth_score, 1),
        },
    }


def _current_state(market_structure: dict[str, Any], trend_health: dict[str, Any], last_price: float | None, vwap: float | None, metrics: dict[str, Any]) -> dict[str, Any]:
    trend = str(market_structure.get("trend") or "").upper()
    score = float(trend_health.get("score") or 0)
    extended = False
    if last_price is not None and vwap is not None and vwap > 0:
        extended = abs(last_price - vwap) / vwap * 100 >= 1.5
    if trend == "BULLISH":
        state = "Strong Bullish" if score >= 80 and not extended else "Bullish"
    elif trend == "BEARISH":
        state = "Strong Bearish" if score >= 80 and not extended else "Bearish"
    elif trend == "TRANSITION":
        state = "Transition"
    else:
        state = "Neutral"
    if extended and state.startswith("Strong "):
        state = state.replace("Strong ", "")
    return {
        "state": state,
        "score": round(score, 1),
        "explanation": str(metrics.get("current_state_explanation") or f"{state} from structure, VWAP position, trend quality, momentum, and volume."),
    }


def _expected_structure(market_structure: dict[str, Any], trend_health: dict[str, Any]) -> dict[str, Any]:
    sequence = [str(item) for item in market_structure.get("sequence", [])][-5:]
    trend = str(market_structure.get("trend") or "").upper()
    expected_next = str(market_structure.get("expectedNextPivot") or "UNKNOWN")
    health = float(trend_health.get("score") or 50)
    if trend == "BULLISH":
        primary = "HL" if "LOW" in expected_next or "PULLBACK" in expected_next else "HH"
        options = [
            {"label": f"{primary} Hold", "probability": round(min(78, max(45, health * 0.72)), 1)},
            {"label": "Sideways", "probability": round(20 if health >= 70 else 30, 1)},
            {"label": "LH", "probability": round(100 - min(78, max(45, health * 0.72)) - (20 if health >= 70 else 30), 1)},
        ]
    elif trend == "BEARISH":
        primary = "LH" if "HIGH" in expected_next or "BOUNCE" in expected_next else "LL"
        options = [
            {"label": f"{primary} Hold", "probability": round(min(78, max(45, health * 0.72)), 1)},
            {"label": "Sideways", "probability": round(20 if health >= 70 else 30, 1)},
            {"label": "HL", "probability": round(100 - min(78, max(45, health * 0.72)) - (20 if health >= 70 else 30), 1)},
        ]
    else:
        options = [
            {"label": "Sideways", "probability": 45.0},
            {"label": "HL Hold", "probability": 30.0},
            {"label": "LL", "probability": 25.0},
        ]
    return {
        "current": sequence,
        "expected": [item for item in options if item["probability"] > 0],
        "explanation": "Expected next pivot is backend-derived from trend strength, VWAP, structure, volume, ATR, and distance from levels.",
    }


def _next_opportunity(current_state: dict[str, Any], market_structure: dict[str, Any], metrics: dict[str, Any], reward_risk: dict[str, Any], setup_expired: bool) -> dict[str, Any]:
    state = str(current_state.get("state") or "")
    vwap = _num(metrics.get("vwap"))
    or_high = _num(metrics.get("or_high"))
    or_low = _num(metrics.get("or_low"))
    probability = max(35.0, min(82.0, float(current_state.get("score") or 50) * 0.75))
    if "Bullish" in state:
        name = "Higher Low Pullback" if setup_expired else "Continuation Pullback"
        trigger = f"Support near VWAP {_display_money(vwap)['display']}" if vwap is not None else "Confirm higher low above VWAP"
        explanation = "Trend remains bullish, but the next trade should come from a fresh higher-low or VWAP pullback rather than the old breakout."
    elif "Bearish" in state:
        name = "Lower High Rejection" if setup_expired else "Continuation Breakdown"
        trigger = f"Reject near VWAP {_display_money(vwap)['display']}" if vwap is not None else "Confirm lower high below VWAP"
        explanation = "Trend is bearish; wait for a fresh lower-high or breakdown trigger."
    elif or_high is not None or or_low is not None:
        name = "Range Breakout"
        trigger = f"Break above ORH {_display_money(or_high)['display']}" if or_high is not None else f"Break below ORL {_display_money(or_low)['display']}"
        explanation = "Market is in transition; wait for a fresh range break with reward/risk support."
        probability *= 0.8
    else:
        name = "Fresh Confirmation"
        trigger = "Wait for backend confirmation"
        explanation = "No clean forward setup is active yet."
        probability = 40.0
    if reward_risk.get("ratio") is not None and float(reward_risk["ratio"]) < 1:
        probability = min(probability, 55.0)
        explanation += " Reward/risk is currently poor."
    return {
        "nextOpportunity": name,
        "trigger": trigger,
        "explanation": explanation,
        "probability": round(probability, 1),
    }


def _setup_lifecycle(metrics: dict[str, Any], risk_levels: dict[str, Any], chart_bars: list[Any]) -> tuple[dict[str, Any], bool]:
    setup_type = str(metrics.get("trigger_setup") or metrics.get("opening_playbook") or "No completed setup")
    trigger_time = _setup_trigger_time(metrics, chart_bars)
    latest_time = _latest_bar_time(chart_bars)
    valid_until = trigger_time + timedelta(minutes=35) if trigger_time is not None else None
    triggered = _truthy(metrics.get("trigger_fired"))
    expired = bool(triggered and valid_until is not None and latest_time is not None and latest_time > valid_until)
    status = "Completed" if expired else "Triggered" if triggered else "Pending"
    entry = _num(risk_levels.get("entry")) or _num(metrics.get("trigger_price"))
    last = _num(metrics.get("last_price"))
    direction = str(risk_levels.get("direction") or "neutral")
    gain = None
    if entry is not None and entry > 0 and last is not None and triggered:
        raw_gain = ((last - entry) / entry) * 100
        gain = raw_gain if direction != "bearish" else -raw_gain
    return {
        "setupType": setup_type,
        "triggerTime": _format_market_time(trigger_time),
        "triggerPrice": round(entry, 4) if entry is not None else None,
        "status": status,
        "result": "Current gain" if gain is not None and gain >= 0 else "Current loss" if gain is not None else None,
        "validFrom": _format_market_time(trigger_time),
        "validUntil": _format_market_time(valid_until),
        "currentGainPct": round(gain, 2) if gain is not None else None,
    }, expired


def _current_action(permission: dict[str, Any], current_state: dict[str, Any], reward_risk: dict[str, Any], setup_expired: bool, metrics: dict[str, Any]) -> dict[str, Any]:
    active_position = _truthy(metrics.get("active_position_requires_management"))
    ratio = _num(reward_risk.get("ratio"))
    state = str(current_state.get("state") or "")
    if active_position:
        action = "HOLD"
        reason = "Position is already open; manage the active trade."
        recommendation = "HOLD"
    elif setup_expired:
        action = "WAIT"
        reason = "Earlier setup entry window has expired."
        recommendation = "WAIT FOR NEXT SETUP"
    elif permission.get("code") == "ready" and ratio is not None and ratio >= 1.2:
        action = "GO SHORT" if "Bearish" in state else "GO LONG"
        reason = "Current market state and reward/risk support a fresh entry."
        recommendation = action
    elif permission.get("code") == "manage":
        action = "HOLD"
        reason = permission.get("description") or "Manage active position."
        recommendation = "HOLD"
    elif permission.get("code") == "complete":
        action = "WAIT"
        reason = permission.get("description") or "Trade lifecycle is complete."
        recommendation = "WAIT FOR NEXT SETUP"
    elif "Bearish" in state and permission.get("code") == "ready":
        action = "GO SHORT"
        reason = "Bearish structure confirmed by backend."
        recommendation = "GO SHORT"
    else:
        action = "WAIT"
        blockers = []
        if ratio is not None and ratio < 1.2:
            blockers.append("poor reward/risk")
        blockers.append(permission.get("description") or "fresh trigger is not confirmed")
        reason = "Trend still active, but " + ", ".join(blockers)
        recommendation = "WAIT FOR NEXT SETUP"
    confidence = float(current_state.get("score") or 50)
    if action == "WAIT":
        confidence = max(50.0, min(confidence, 75.0))
    return {
        "action": action,
        "reason": str(reason),
        "recommendation": recommendation,
        "confidence": round(confidence, 1),
    }


def _decision_engine(
    *,
    metrics: dict[str, Any],
    resolved: dict[str, Any],
    risk_levels: dict[str, Any],
    market_structure: dict[str, Any],
    permission: dict[str, Any],
    chart_bars: list[Any],
    reason: str,
) -> dict[str, Any]:
    setup, setup_expired = _setup_lifecycle(metrics, risk_levels, chart_bars)
    reward_risk = _reward_risk(risk_levels.get("entry"), risk_levels.get("stop"), risk_levels.get("t1"), risk_levels.get("t2"))
    last_price = _num(metrics.get("last_price"))
    vwap = _num(metrics.get("vwap"))
    trend_health = _trend_health(market_structure, metrics, last_price, vwap)
    current_state = _current_state(market_structure, trend_health, last_price, vwap, metrics)
    current_action = _current_action(permission, current_state, reward_risk, setup_expired, metrics)
    expected_structure = _expected_structure(market_structure, trend_health)
    next_opportunity = _next_opportunity(current_state, market_structure, metrics, reward_risk, setup_expired)
    reasoning = [
        f"Setup lifecycle: {setup['setupType']} is {setup['status']}.",
        f"Current state: {current_state['state']} from 5m structure and VWAP.",
        f"Current action: {current_action['recommendation']}.",
        f"Reward/Risk: {reward_risk['display']} using {reward_risk.get('targetUsed') or 'no target'}.",
        f"Trend Health: {trend_health['score']:.0f}/100 {trend_health['label']}.",
    ]
    if resolved.get("missing_confirmations"):
        reasoning.append("Missing confirmation: " + ", ".join(str(x) for x in _as_list(resolved.get("missing_confirmations"))[:3]))
    return {
        "setup": setup,
        "currentState": current_state,
        "currentAction": current_action,
        "nextOpportunity": next_opportunity,
        "expectedStructure": expected_structure,
        "trendHealth": trend_health,
        "rewardRisk": reward_risk,
        "explanation": str(reason),
        "confidence": current_action["confidence"],
        "reasoning": reasoning,
    }


def _metric(
    *,
    value: Any,
    display: str | None = None,
    formula: str | None = None,
    inputs: list[str] | None = None,
    reason: str | None = None,
    timestamp: str | None = None,
    confidence: float | None = None,
    source: str = "day_trade_workspace",
) -> dict[str, Any]:
    return {
        "value": value,
        "display": str(display if display is not None else value if value not in (None, "") else "—"),
        "formula": formula,
        "inputs": inputs or [],
        "reason": reason,
        "timestamp": timestamp,
        "confidence": round(float(confidence), 1) if confidence is not None else None,
        "source": source,
    }


def _bias_from_structure(market_structure: dict[str, Any], metrics: dict[str, Any], risk_levels: dict[str, Any]) -> str:
    direction = str(risk_levels.get("direction") or "").lower()
    if direction == "bullish":
        return "Bullish"
    if direction == "bearish":
        return "Bearish"
    trend = str(market_structure.get("trend") or metrics.get("market_bias") or "").upper()
    if "BULL" in trend:
        return "Bullish"
    if "BEAR" in trend:
        return "Bearish"
    return "Neutral"


def _market_context_label(metrics: dict[str, Any], resolved: dict[str, Any]) -> str:
    raw = str(_first_present(resolved.get("market_bias"), metrics.get("market_bias"), metrics.get("market_context"), "Neutral")).upper()
    if "BULL" in raw or raw in {"LONG", "SUPPORTIVE", "MARKET_SUPPORTIVE"}:
        return "Bullish"
    if "BEAR" in raw or raw in {"SHORT", "WEAK", "MARKET_WEAK"}:
        return "Bearish"
    return "Neutral"


def _setup_name(metrics: dict[str, Any]) -> str:
    raw = str(metrics.get("trigger_setup") or metrics.get("opening_playbook") or "No Active Setup").replace("_", " ").strip()
    return raw.title() if raw else "No Active Setup"


def _entry_timing_label(metrics: dict[str, Any], reward_risk: dict[str, Any], current_action: dict[str, Any]) -> str:
    raw = str(_first_present(metrics.get("entry_quality"), metrics.get("entry_recommendation_state"), current_action.get("recommendation"), "")).upper()
    ratio = _num(reward_risk.get("ratio"))
    if "CHASE" in raw or "AVOID" in raw or current_action.get("action") == "WAIT" and ratio is not None and ratio < 0.8:
        return "Do Not Chase"
    if "LATE" in raw:
        return "Late"
    if "EXTEND" in raw:
        return "Extended"
    if "GOOD" in raw or "GO" in raw:
        return "Good"
    if "PERFECT" in raw or "A+" in raw:
        return "Perfect"
    return "Good" if ratio is not None and ratio >= 1.2 else "Do Not Chase"


def _entry_grade(score: float, timing: str) -> str:
    if timing in {"Do Not Chase", "Too Late"}:
        return "C"
    if score >= 90:
        return "A+"
    if score >= 78:
        return "A"
    if score >= 62:
        return "B"
    return "C"


def _factor(label: str, detail: str, confidence: float | None = None, source: str = "day_trade_workspace") -> dict[str, Any]:
    return _metric(value=label, display=label, reason=detail, confidence=confidence, source=source)


def _professional_factors(metrics: dict[str, Any], market_structure: dict[str, Any], risk_levels: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    positive: list[dict[str, Any]] = []
    negative: list[dict[str, Any]] = []
    neutral: list[dict[str, Any]] = []
    last = _num(metrics.get("last_price"))
    vwap = _num(metrics.get("vwap"))
    or_high = _num(metrics.get("or_high"))
    or_low = _num(metrics.get("or_low"))
    bias = _bias_from_structure(market_structure, metrics, risk_levels)
    sequence = [str(item) for item in market_structure.get("sequence", [])]
    confidence = _num(market_structure.get("confidence"))
    conf_pct = confidence * 100 if confidence is not None and confidence <= 1 else confidence

    if last is not None and vwap is not None:
        above = last >= vwap
        aligned = (bias == "Bullish" and above) or (bias == "Bearish" and not above)
        item = _factor("Above VWAP" if above else "Below VWAP", f"Last price {_display_money(last)['display']} versus VWAP {_display_money(vwap)['display']}.", conf_pct)
        (positive if aligned else negative).append(item)
        distance = abs(last - vwap) / vwap * 100 if vwap else 0
        if distance >= 1.5:
            negative.append(_factor("Extended from VWAP", f"Price is {distance:.1f}% from VWAP; the engine should not chase.", conf_pct))

    if or_high is not None and last is not None and bias == "Bullish":
        (positive if last >= or_high else neutral).append(_factor("ORH accepted" if last >= or_high else "ORH not reclaimed", f"ORH is {_display_money(or_high)['display']}.", conf_pct))
    if or_low is not None and last is not None and bias == "Bearish":
        (positive if last <= or_low else neutral).append(_factor("ORL accepted" if last <= or_low else "ORL not lost", f"ORL is {_display_money(or_low)['display']}.", conf_pct))

    if bias == "Bullish" and {"HH", "HL"}.intersection(sequence):
        positive.append(_factor("HH/HL structure", "Backend-confirmed bullish pivot sequence supports the stock bias.", conf_pct))
    elif bias == "Bearish" and {"LH", "LL"}.intersection(sequence):
        positive.append(_factor("LH/LL structure", "Backend-confirmed bearish pivot sequence supports the stock bias.", conf_pct))
    elif sequence:
        neutral.append(_factor("Mixed structure", f"Recent sequence: {' -> '.join(sequence[-5:])}.", conf_pct))

    volume_ratio = _num(metrics.get("volume_ratio") or metrics.get("relative_volume") or metrics.get("rvol"))
    if volume_ratio is not None:
        if volume_ratio >= 1.3:
            positive.append(_factor("Strong volume", f"Relative volume is {volume_ratio:.2f}x.", min(100, 45 + volume_ratio * 25)))
        else:
            neutral.append(_factor("Volume not decisive", f"Relative volume is {volume_ratio:.2f}x.", min(100, 45 + volume_ratio * 25)))

    if not positive:
        neutral.append(_factor("Waiting for confirmation", "Backend does not have enough positive factors for an entry.", 50))
    return positive[:6], negative[:6], neutral[:6]


def _professional_timeline(setup: dict[str, Any], risk_levels: dict[str, Any], metrics: dict[str, Any]) -> list[dict[str, Any]]:
    trigger_time = setup.get("triggerTime")
    entry = _num(risk_levels.get("entry"))
    return [
        {"id": "opening-range", "label": "Opening Range", "phase": "Opening Range", "timestamp": None, "price": None, "status": "completed", "reason": "ORH/ORL are calculated by the backend."},
        {"id": "trigger", "label": "Trigger", "phase": "Triggered", "timestamp": trigger_time, "price": entry, "status": "completed" if trigger_time else "pending", "reason": str(metrics.get("trigger_requirement") or "Waiting for trigger confirmation.")},
        {"id": "confirmation", "label": "Confirmation", "phase": "Confirmed", "timestamp": trigger_time, "price": entry, "status": "completed" if _truthy(metrics.get("trigger_fired")) else "pending", "reason": "Backend trigger confirmation state."},
        {"id": "retest", "label": "Retest", "phase": "Retest", "timestamp": None, "price": _num(metrics.get("vwap")), "status": "pending", "reason": "Next pullback/retest reference."},
        {"id": "continuation", "label": "Continuation", "phase": "Continuation", "timestamp": None, "price": None, "status": "pending", "reason": "Continuation requires fresh structure confirmation."},
        {"id": "target1", "label": "Target1", "phase": "Target1", "timestamp": None, "price": _num(risk_levels.get("t1")), "status": "pending", "reason": "First backend target."},
        {"id": "target2", "label": "Target2", "phase": "Target2", "timestamp": None, "price": _num(risk_levels.get("t2")), "status": "pending", "reason": "Second backend target."},
        {"id": "exhaustion", "label": "Exhaustion", "phase": "Exhausted", "timestamp": None, "price": None, "status": "pending", "reason": "Exhaustion appears when extension/risk rules block chasing."},
    ]


def _professional_decision(
    *,
    metrics: dict[str, Any],
    resolved: dict[str, Any],
    risk_levels: dict[str, Any],
    market_structure: dict[str, Any],
    decision_engine: dict[str, Any],
    permission: dict[str, Any],
    generated_at: str,
) -> dict[str, Any]:
    setup = decision_engine["setup"]
    reward_risk = decision_engine["rewardRisk"]
    current_action = decision_engine["currentAction"]
    trend_health = decision_engine["trendHealth"]
    next_opportunity = decision_engine["nextOpportunity"]
    scores = trend_health.get("inputs") or {}
    market_context = _market_context_label(metrics, resolved)
    stock_bias = _bias_from_structure(market_structure, metrics, risk_levels)
    entry_score = min(100.0, max(0.0, float(current_action.get("confidence") or decision_engine.get("confidence") or 50)))
    overall_score = min(100.0, max(0.0, float(decision_engine.get("confidence") or entry_score)))
    timing = _entry_timing_label(metrics, reward_risk, current_action)
    grade = _entry_grade(overall_score, timing)
    positive, negative, neutral = _professional_factors(metrics, market_structure, risk_levels)
    last = _num(metrics.get("last_price"))
    entry = _num(risk_levels.get("entry"))
    stop = _num(risk_levels.get("stop"))
    target = _num(risk_levels.get("t2")) or _num(risk_levels.get("t1"))
    risk = abs(entry - stop) if entry is not None and stop is not None else None
    reward_remaining = abs(target - last) if target is not None and last is not None else None
    risk_remaining = abs(last - stop) if stop is not None and last is not None else None
    vwap = _num(metrics.get("vwap"))
    invalidation = market_structure.get("invalidationLevel") or risk_levels.get("invalidation")
    next_name = str(next_opportunity.get("nextOpportunity") or "No Trade")
    if stock_bias == "Bullish" and "Lower High" in next_name:
        next_name = "Bullish Pullback"
    if stock_bias == "Bearish" and "Higher Low" in next_name:
        next_name = "Bearish Pullback"
    action_label = str(current_action.get("action") or permission.get("label") or "WAIT").replace("GO LONG", "WAIT").replace("GO SHORT", "WAIT")

    bullish_changes = [
        _metric(value="VWAP Reclaim", display="VWAP Reclaim", reason="Price reclaims and holds VWAP.", timestamp=generated_at, source="day_trade_workspace"),
        _metric(value="Breakout", display="Breakout", reason="Price breaks the next backend resistance with confirmation.", timestamp=generated_at, source="day_trade_workspace"),
    ]
    bearish_changes = [
        _metric(value="VWAP Reject", display="VWAP Reject", reason="Price rejects VWAP and forms bearish continuation.", timestamp=generated_at, source="day_trade_workspace"),
        _metric(value="Breakdown", display="Breakdown", reason="Price loses backend support or ORL.", timestamp=generated_at, source="day_trade_workspace"),
    ]
    invalidation_changes = [
        _metric(value="Invalidation", display=f"Lost {_display_money(invalidation)['display']}", reason="Setup invalidates if structural stop or VWAP thesis level is lost.", timestamp=generated_at, source="day_trade_workspace"),
    ]

    coach_lines = [
        f"What happened: {stock_bias} stock bias with {setup['setupType']} in {setup['status']} phase.",
        f"Why: " + "; ".join(item["display"] for item in positive[:3]),
        f"What to watch: {next_name} near {next_opportunity.get('trigger') or 'backend reference'}.",
        f"What invalidates: lose {_display_money(invalidation)['display']} or backend structure flips.",
        f"Next setup: wait for {next_name}; do not chase extended entries.",
    ][:6]

    return {
        "hierarchy": {
            "marketContext": _metric(value=market_context, display=market_context, formula="SPY/QQQ/sector/VIX/breadth context where available", inputs=["market_bias", "market_context"], reason="Broad market state affects confidence.", timestamp=generated_at, confidence=overall_score),
            "stockBias": _metric(value=stock_bias, display=stock_bias, formula="5m structure + VWAP + OR + relative strength", inputs=["market_structure", "vwap", "opening_range"], reason=market_structure.get("explanation"), timestamp=generated_at, confidence=overall_score),
            "setup": _metric(value=setup["setupType"], display=str(setup["setupType"]).replace("_", " ").title(), formula="Backend trigger setup classifier", inputs=["trigger_setup", "opening_playbook"], reason="Setup type is independent from action and phase.", timestamp=generated_at, confidence=overall_score),
            "currentPhase": _metric(value=setup["status"], display=str(setup["status"]), formula="Universal setup lifecycle", inputs=["trigger_time", "latest_bar"], reason="Phase is derived from trigger timing and lifecycle state.", timestamp=generated_at, confidence=overall_score),
            "nextOpportunity": _metric(value=next_name, display=next_name, formula="Current phase + structure + VWAP + reward/risk", inputs=["current_state", "vwap", "reward_risk"], reason=next_opportunity.get("explanation"), timestamp=generated_at, confidence=next_opportunity.get("probability")),
            "originalEntry": _metric(value=entry, display="Completed" if setup.get("triggerTime") else "Pending", formula="Trigger entry state", inputs=["triggerTime", "entry"], reason="Shows whether the original entry window already happened.", timestamp=generated_at, confidence=overall_score),
            "currentAction": _metric(value=action_label, display=action_label, formula="Permission + reward/risk + lifecycle", inputs=["permission", "rewardRisk", "setupLifecycle"], reason=current_action.get("reason"), timestamp=generated_at, confidence=current_action.get("confidence")),
        },
        "why": {
            "positiveFactors": positive,
            "negativeFactors": negative,
            "neutralFactors": neutral,
        },
        "changesDecision": {
            "bullish": bullish_changes,
            "bearish": bearish_changes,
            "invalidation": invalidation_changes,
        },
        "confidence": {
            "biasConfidence": _metric(value=overall_score, display=f"{overall_score:.0f}%", formula="Structure + VWAP + market alignment", inputs=["trendHealth", "marketContext"], reason="Confidence in directional bias.", timestamp=generated_at, confidence=overall_score),
            "tradeConfidence": _metric(value=current_action.get("confidence"), display=f"{float(current_action.get('confidence') or 0):.0f}%", formula="Action confidence from backend decision engine", inputs=["currentAction"], reason=current_action.get("reason"), timestamp=generated_at, confidence=current_action.get("confidence")),
            "entryQuality": _metric(value=grade, display=grade, formula="Trade score mapped to A+/A/B/C", inputs=["overallTradeScore", "entryTiming"], reason="Letter grade replaces high/medium/low wording.", timestamp=generated_at, confidence=overall_score),
            "entryTiming": _metric(value=timing, display=timing, formula="Entry timing guardrail", inputs=["rewardRisk", "extension", "currentAction"], reason="Engine should not recommend chasing.", timestamp=generated_at, confidence=entry_score),
        },
        "scores": {
            "trendScore": _metric(value=scores.get("momentum"), display=f"{float(scores.get('momentum') or 0):.0f}", formula="Backend trend/momentum score", inputs=["trend_strength", "confidence"], timestamp=generated_at, confidence=scores.get("momentum")),
            "structureScore": _metric(value=scores.get("structure"), display=f"{float(scores.get('structure') or 0):.0f}", formula="Backend pivot structure score", inputs=["HH", "HL", "LH", "LL"], timestamp=generated_at, confidence=scores.get("structure")),
            "momentumScore": _metric(value=scores.get("momentum"), display=f"{float(scores.get('momentum') or 0):.0f}", formula="Backend momentum score", inputs=["momentum_score", "trend_strength"], timestamp=generated_at, confidence=scores.get("momentum")),
            "volumeScore": _metric(value=scores.get("volume"), display=f"{float(scores.get('volume') or 0):.0f}", formula="Backend relative volume score", inputs=["volume_ratio", "rvol"], timestamp=generated_at, confidence=scores.get("volume")),
            "marketScore": _metric(value=overall_score, display=f"{overall_score:.0f}", formula="Market context contribution", inputs=["SPY", "QQQ", "sector", "VIX", "breadth"], reason="Uses available market context fields.", timestamp=generated_at, confidence=overall_score),
            "entryScore": _metric(value=entry_score, display=f"{entry_score:.0f}", formula="Entry confidence score", inputs=["currentAction", "rewardRisk"], timestamp=generated_at, confidence=entry_score),
            "overallTradeScore": _metric(value=overall_score, display=f"{overall_score:.0f}", formula="Weighted backend decision score", inputs=["trend", "structure", "momentum", "volume", "market", "entry"], timestamp=generated_at, confidence=overall_score),
        },
        "risk": {
            "entry": _metric(value=entry, display=_display_money(entry)["display"], formula="Backend structural entry", inputs=["ORH", "ORL", "entry_guidance"], timestamp=generated_at, confidence=overall_score),
            "stop": _metric(value=stop, display=_display_money(stop)["display"], formula="Backend structural invalidation", inputs=["VWAP", "OR mid", "structure"], timestamp=generated_at, confidence=overall_score),
            "risk": _metric(value=risk, display=_display_money(risk)["display"], formula="abs(entry - stop)", inputs=["entry", "stop"], timestamp=generated_at, confidence=overall_score),
            "target": _metric(value=target, display=_display_money(target)["display"], formula="Backend target used for R:R", inputs=["target1", "target2"], timestamp=generated_at, confidence=overall_score),
            "riskReward": _metric(value=reward_risk.get("ratio"), display=reward_risk.get("display"), formula="reward / risk", inputs=["entry", "stop", "target"], timestamp=generated_at, confidence=overall_score),
            "rewardRemaining": _metric(value=reward_remaining, display=_display_money(reward_remaining)["display"], formula="abs(target - last)", inputs=["target", "last_price"], timestamp=generated_at, confidence=overall_score),
            "riskRemaining": _metric(value=risk_remaining, display=_display_money(risk_remaining)["display"], formula="abs(last - stop)", inputs=["last_price", "stop"], timestamp=generated_at, confidence=overall_score),
            "tradeQuality": _metric(value=grade, display=grade, formula="Entry grade + R:R + confidence", inputs=["entryQuality", "riskReward", "tradeConfidence"], timestamp=generated_at, confidence=overall_score),
        },
        "marketContext": {
            "spy": _metric(value=metrics.get("spy_trend"), display=str(metrics.get("spy_trend") or "Unavailable"), formula="Market context feed", inputs=["SPY"], timestamp=generated_at, confidence=None),
            "qqq": _metric(value=metrics.get("qqq_trend"), display=str(metrics.get("qqq_trend") or "Unavailable"), formula="Market context feed", inputs=["QQQ"], timestamp=generated_at, confidence=None),
            "sector": _metric(value=metrics.get("sector_trend"), display=str(metrics.get("sector_trend") or "Unavailable"), formula="Sector ETF context", inputs=["sector"], timestamp=generated_at, confidence=None),
            "vix": _metric(value=metrics.get("vix"), display=str(metrics.get("vix") or "Unavailable"), formula="VIX context", inputs=["VIX"], timestamp=generated_at, confidence=None),
            "breadth": _metric(value=metrics.get("breadth"), display=str(metrics.get("breadth") or "Unavailable"), formula="Market breadth context", inputs=["breadth"], timestamp=generated_at, confidence=None),
            "relativeStrength": _metric(value=metrics.get("relative_strength"), display=str(metrics.get("relative_strength") or "Unavailable"), formula="Ticker versus market context", inputs=["relative_strength"], timestamp=generated_at, confidence=None),
        },
        "timeline": _professional_timeline(setup, risk_levels, metrics),
        "aiCoach": {"lines": coach_lines},
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


def _day_trade_risk_levels(
    metrics: dict[str, Any],
    entry_guidance: dict[str, Any],
    resolved: dict[str, Any],
    final_decision: str,
) -> dict[str, Any]:
    """Direction-aware structural trade levels for the opening-range Day Trade model.

    Entry is the breakout/breakdown trigger (ORH/ORL) rather than the live price,
    and the stop is the structural invalidation (VWAP reclaim, else OR Mid) rather
    than the far opening-range extreme — keeping risk/reward sane. Explicit upstream
    entry_guidance.entry_price is honoured when present.
    """
    or_high = _num(metrics.get("or_high"))
    or_low = _num(metrics.get("or_low"))
    vwap = _num(metrics.get("vwap"))
    last = _num(metrics.get("last_price"))
    or_mid = (or_high + or_low) / 2.0 if (or_high is not None and or_low is not None) else None
    rng = (or_high - or_low) if (or_high is not None and or_low is not None and or_high >= or_low) else None

    fd = str(final_decision or "").upper()
    bias = str(resolved.get("market_bias") or metrics.get("market_bias") or "").upper()
    setup = str(metrics.get("trigger_setup") or metrics.get("opening_playbook") or "").upper()
    bearish = any(t in fd for t in ("PUT", "SHORT")) or "BEAR" in bias or "ORL" in setup or "BREAKDOWN" in setup
    bullish = any(t in fd for t in ("CALL", "LONG")) or "BULL" in bias or "ORH" in setup or "BREAKOUT" in setup
    if bullish and bearish:
        bearish = bullish = False
    if not bullish and not bearish and last is not None and vwap is not None:
        bearish = last < vwap
        bullish = not bearish

    struct_entry = struct_stop = struct_t1 = struct_t2 = None
    if bearish and or_low is not None:
        struct_entry = or_low
        struct_stop = or_mid if or_mid is not None else or_high
        if vwap is not None and struct_stop is not None and struct_entry < vwap < struct_stop:
            struct_stop = vwap  # VWAP reclaim is the tighter, thesis-aligned invalidation
        if rng is not None:
            struct_t1 = or_low - 0.5 * rng
            struct_t2 = or_low - rng
    elif bullish and or_high is not None:
        struct_entry = or_high
        struct_stop = or_mid if or_mid is not None else or_low
        if vwap is not None and struct_stop is not None and struct_stop < vwap < struct_entry:
            struct_stop = vwap
        if rng is not None:
            struct_t1 = or_high + 0.5 * rng
            struct_t2 = or_high + rng

    entry = _num(entry_guidance.get("entry_price")) or struct_entry or _num(entry_guidance.get("current_price")) or last
    stop = struct_stop if struct_stop is not None else (_num(entry_guidance.get("stop_price")) or _num(entry_guidance.get("risk_below")))

    def _directional_target(value: float | None, fallback: float | None) -> float | None:
        # A valid target must sit beyond entry in the trade direction; a degenerate
        # upstream target (equal to or on the wrong side of entry) is rejected in
        # favour of the structural target so reward/R:R never collapses to zero.
        if value is not None and entry is not None:
            if (bearish and value < entry - 1e-6) or (bullish and value > entry + 1e-6):
                return value
        return fallback

    t1 = _directional_target(_num(entry_guidance.get("scalp_target")) or _num(entry_guidance.get("target_1")), struct_t1)
    t2 = _directional_target(_num(entry_guidance.get("target_2")), struct_t2)

    rr: float | None = None
    if entry is not None and stop is not None and t1 is not None:
        risk = abs(entry - stop)
        if risk > 1e-9:
            rr = round(abs(t1 - entry) / risk, 2)

    return {
        "entry": round(entry, 4) if entry is not None else None,
        "stop": round(stop, 4) if stop is not None else None,
        "t1": round(t1, 4) if t1 is not None else None,
        "t2": round(t2, 4) if t2 is not None else None,
        "invalidation": round(stop, 4) if stop is not None else None,
        "direction": "bearish" if bearish else "bullish" if bullish else "neutral",
        "rr": rr,
    }


def _chart_levels(metrics: dict[str, Any], entry_guidance: dict[str, Any], risk_levels: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    risk_levels = risk_levels or {}
    entry_val = risk_levels.get("entry") if risk_levels.get("entry") is not None else (entry_guidance.get("entry_price") or entry_guidance.get("current_price") or metrics.get("last_price"))
    stop_val = risk_levels.get("stop") if risk_levels.get("stop") is not None else (entry_guidance.get("stop_price") or entry_guidance.get("risk_below"))
    levels = [
        _level("entry", "entry", entry_val, "Entry", "positive", 10),
        _level("stop", "stop", stop_val, "Stop", "danger", 20),
        _level("target1", "target", risk_levels.get("t1") if risk_levels.get("t1") is not None else (entry_guidance.get("scalp_target") or entry_guidance.get("target_1")), "T1", "positive", 30),
        _level("target2", "target", risk_levels.get("t2") if risk_levels.get("t2") is not None else entry_guidance.get("target_2"), "T2", "positive", 40),
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
    generated_at = _now_iso()
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
    risk_levels = _day_trade_risk_levels(metrics, entry_guidance, resolved, final_decision)
    entry = risk_levels.get("entry")
    stop = risk_levels.get("stop")
    target1 = risk_levels.get("t1")
    target2 = risk_levels.get("t2")
    raw_chart_bars = _as_list(metrics.get("chart_bars"))
    market_structure = _market_structure(raw_chart_bars, metrics)
    five_minute_bars = _five_minute_bars_for_structure(raw_chart_bars)
    trap_detection = build_trap_detection_from_metrics(
        ticker=symbol,
        metrics=metrics,
        five_minute_bars=five_minute_bars,
        market_structure=market_structure,
    )
    chart_bars = _interval_chart_bars(raw_chart_bars, interval)
    candles = _chart_candles(chart_bars)
    vwap_overlay = _vwap_overlay(chart_bars, metrics, session_date)
    levels = _chart_levels(metrics, entry_guidance, risk_levels)
    events: list[dict[str, Any]] = []
    scale_level_ids = [level["id"] for level in levels if level.get("affectsTradeFocusScale")]
    reason = str(resolved.get("reason") or trader_decision.get("decision_message") or (getattr(scan, "reasons", []) or [""])[0] or "Backend workspace assembled from the current Day Trade scan.")
    next_condition = str(metrics.get("trigger_requirement") or entry_guidance.get("next_action") or trader_decision.get("next_condition") or reason)
    context_label = str(metrics.get("market_bias") or resolved.get("market_bias") or getattr(scan, "bias", None) or "Neutral").replace("_", " ").title()
    decision_engine = _decision_engine(
        metrics=metrics,
        resolved=resolved,
        risk_levels=risk_levels,
        market_structure=market_structure,
        permission=permission,
        chart_bars=raw_chart_bars,
        reason=reason,
    )
    professional_decision = _professional_decision(
        metrics=metrics,
        resolved=resolved,
        risk_levels=risk_levels,
        market_structure=market_structure,
        decision_engine=decision_engine,
        permission=permission,
        generated_at=generated_at,
    )

    trigger_view = {
        "status": _status("triggered" if metrics.get("trigger_fired") else "pending", "Triggered" if metrics.get("trigger_fired") else "Pending", "positive" if metrics.get("trigger_fired") else "warning"),
        "summary": str(metrics.get("trigger_requirement") or "Backend trigger requirement is pending."),
        "requirements": _requirements(metrics),
    }
    computed_rr = decision_engine["rewardRisk"]["display"]
    risk_plan = {
        "entry": _display_money(entry),
        "stop": _display_money(stop),
        "target1": _display_money(target1),
        "target2": _display_money(target2),
        "invalidation": _display_money(risk_levels.get("invalidation")),
        "positionSize": _display_text(option_risk.get("recommended_contracts") or "1 contract max"),
        "riskReward": _display_ratio(_num(decision_engine["rewardRisk"].get("ratio"))) if computed_rr != "—" else _display_text("—"),
    }
    last_price = _num(metrics.get("last_price"))
    previous_close = _num(metrics.get("prev_close"))
    day_change_amount = last_price - previous_close if last_price is not None and previous_close is not None else None

    return {
        "schemaVersion": DAY_TRADE_WORKSPACE_SCHEMA_VERSION,
        "generatedAt": generated_at,
        "symbol": {
            "ticker": symbol,
            "companyName": str(getattr(scan, "company_name", "") or symbol),
            "price": _display_money(metrics.get("last_price")),
            "changeAmount": _display_signed_money(day_change_amount),
            "change": _display_percent(_first_present(metrics.get("change_pct"), metrics.get("session_change_pct"))),
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
        "decisionEngine": decision_engine,
        "professionalDecision": professional_decision,
        "evidence": _evidence(scan, resolved, metrics),
        "selectedContract": None,
        "trapDetection": trap_detection,
        "chart": {
            "candles": candles,
            "levels": levels,
            "events": events,
            "vwapOverlay": vwap_overlay,
            "marketStructure": market_structure,
            "defaults": {
                "interval": interval if interval in {"1m", "5m", "15m", "1h"} else "1m",
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


def build_position_session_chart_response(
    *,
    symbol: str,
    company_name: str | None,
    chart_bars: list[Any],
    interval: str = "5m",
) -> dict[str, Any]:
    """Build a backend-owned Position Trading session chart DTO."""
    generated_at = _now_iso()
    interval_value = interval if interval in {"1m", "5m", "15m", "1h"} else "5m"
    last_bar = chart_bars[-1] if chart_bars and isinstance(chart_bars[-1], dict) else {}
    last_price = _num(last_bar.get("c", last_bar.get("close")))
    metrics = {
        "last_price": last_price,
        "vwap": _num(last_bar.get("vwap")),
        "session_date": str(last_bar.get("sessionDate") or date.today().isoformat()),
        "confidence": None,
    }
    market_structure = _market_structure(chart_bars, metrics)
    interval_bars = _interval_chart_bars(chart_bars, interval_value)
    candles = _chart_candles(interval_bars)
    vwap_overlay = _vwap_overlay(interval_bars, metrics, None)
    visible_ids = []
    if vwap_overlay.get("visibleByDefault"):
        visible_ids.append(vwap_overlay["id"])
    if market_structure.get("visibleByDefault"):
        visible_ids.append(market_structure["id"])

    return {
        "schemaVersion": DAY_TRADE_WORKSPACE_SCHEMA_VERSION,
        "generatedAt": generated_at,
        "symbol": {
            "ticker": symbol.upper(),
            "companyName": company_name or symbol.upper(),
            "price": _display_money(last_price),
            "changeAmount": _display_signed_money(None),
            "change": _display_percent(None),
        },
        "session": {
            "mode": "position_review",
            "status": _status("SEVEN_DAY", "7 Day Session Chart", "info"),
            "sessionDate": str(metrics["session_date"]),
            "displayDate": "Last 7 trading days",
            "marketTimeZone": "America/New_York",
            "isExecutionAllowed": False,
            "reviewCopy": "Position Trading chart view. Trade decisions remain owned by the Position Trading engine.",
        },
        "chart": {
            "candles": candles,
            "levels": [],
            "events": [],
            "vwapOverlay": vwap_overlay,
            "marketStructure": market_structure,
            "defaults": {
                "interval": interval_value,
                "visibleRange": "1h",
                "initialVisibleBars": 84,
                "initialBarSpacing": 10,
                "minBarSpacing": 3,
                "maxBarSpacing": 20,
                "rightOffsetBars": 6,
                "scaleMode": "trade_focus",
                "followLive": True,
                "visibleOverlayIds": visible_ids,
            },
            "tradeFocus": {
                "scalePaddingPercent": 8,
                "levelIdsAllowedToAffectScale": [],
            },
        },
        "structureSummary": {
            "trend": market_structure.get("trend"),
            "display": market_structure.get("display"),
            "sequence": market_structure.get("sequence", []),
            "expectedNext": market_structure.get("expectedNext"),
            "confidence": market_structure.get("confidence"),
            "invalidationLevel": market_structure.get("invalidationLevel"),
            "explanation": market_structure.get("explanation"),
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
            "changeAmount": _display_signed_money(None),
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
        "trapDetection": build_unavailable_trap_detection(clean_reason),
        "chart": {
            "candles": [],
            "levels": levels,
            "events": events,
            "vwapOverlay": vwap_overlay,
            "marketStructure": None,
            "defaults": {
                "interval": interval if interval in {"1m", "5m", "15m", "1h"} else "1m",
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
