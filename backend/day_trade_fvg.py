"""Fair Value Gap (FVG) Smart-Money-Concepts engine for the Day Trade session chart.

Detects, from a session's OHLC bars:
  • Fair Value Gaps (bullish & bearish 3-candle imbalances), each with its midline
    (consequent encroachment) and mitigation state, drawn as boxes extended N bars.
  • Change of Character (CHoCH) — the first structural break that flips trend.
  • Order Blocks — the last opposing candle before a displacement leg.

…and assembles the requested strategy: after the FIRST CHoCH, enter at the midline
of the fair value gap created by the displacement, stop beyond the gap, and target
the nearest opposing order block in the trade direction.

Pure module (list of bar dicts in, JSON-safe dict out) so the rules are unit-tested
without market data. The workspace layer adapts live chart bars into it.
"""

from __future__ import annotations

from typing import Any

DEFAULT_EXTEND_BARS = 20
DEFAULT_PIVOT_LOOKBACK = 2


def _f(x: Any) -> float | None:
    try:
        v = float(x)
        return v if v == v else None
    except (TypeError, ValueError):
        return None


def _norm_bars(bars: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Normalize heterogeneous bar dicts (t/o/h/l/c or time/open/…) into a clean list."""
    out: list[dict[str, Any]] = []
    for i, b in enumerate(bars or []):
        if not isinstance(b, dict):
            continue
        o = _f(b.get("o") if b.get("o") is not None else b.get("open"))
        h = _f(b.get("h") if b.get("h") is not None else b.get("high"))
        low = _f(b.get("l") if b.get("l") is not None else b.get("low"))
        c = _f(b.get("c") if b.get("c") is not None else b.get("close"))
        t = b.get("t") or b.get("time") or b.get("timestamp")
        if None in (o, h, low, c):
            continue
        out.append({"i": len(out), "t": str(t) if t is not None else str(i), "o": o, "h": h, "l": low, "c": c})
    return out


# ── Fair Value Gaps ───────────────────────────────────────────────────────────
def detect_fvgs(bars: list[dict[str, Any]], extend_bars: int = DEFAULT_EXTEND_BARS) -> list[dict[str, Any]]:
    """3-candle imbalances. Bullish: bar[i-2].high < bar[i].low. Bearish: bar[i-2].low > bar[i].high."""
    n = len(bars)
    last_i = n - 1
    fvgs: list[dict[str, Any]] = []
    for i in range(2, n):
        a, c = bars[i - 2], bars[i]
        if a["h"] < c["l"]:
            bottom, top = a["h"], c["l"]
            kind = "bullish"
        elif a["l"] > c["h"]:
            bottom, top = c["h"], a["l"]
            kind = "bearish"
        else:
            continue
        mid = round((top + bottom) / 2.0, 4)
        # Mitigation: bullish gap is filled when a later low trades down to its bottom;
        # bearish gap when a later high trades up to its top. Midline touch = entry trigger.
        mitigated_index: int | None = None
        mid_touch_index: int | None = None
        for j in range(i + 1, n):
            bj = bars[j]
            if kind == "bullish":
                if mid_touch_index is None and bj["l"] <= mid:
                    mid_touch_index = j
                if bj["l"] <= bottom:
                    mitigated_index = j
                    break
            else:
                if mid_touch_index is None and bj["h"] >= mid:
                    mid_touch_index = j
                if bj["h"] >= top:
                    mitigated_index = j
                    break
        end_index = min(i + extend_bars, last_i)
        if mitigated_index is not None:
            end_index = min(end_index, mitigated_index)
        fvgs.append({
            "type": kind,
            "top": round(top, 4),
            "bottom": round(bottom, 4),
            "mid": mid,
            "startIndex": i,
            "startTime": bars[i]["t"],
            "endIndex": end_index,
            "endTime": bars[end_index]["t"],
            "extendsPastData": bool(i + extend_bars > last_i and mitigated_index is None),
            "mitigated": mitigated_index is not None,
            "mitigatedIndex": mitigated_index,
            "midTouchIndex": mid_touch_index,
        })
    return fvgs


# ── Swing pivots + structure + Change of Character ───────────────────────────
def _swing_pivots(bars: list[dict[str, Any]], lookback: int) -> list[dict[str, Any]]:
    n = len(bars)
    pivots: list[dict[str, Any]] = []
    for i in range(lookback, n - lookback):
        window = bars[i - lookback:i + lookback + 1]
        hi, lo = bars[i]["h"], bars[i]["l"]
        if hi == max(b["h"] for b in window) and all(bars[i]["h"] >= b["h"] for b in window):
            pivots.append({"index": i, "price": hi, "kind": "H", "time": bars[i]["t"]})
        if lo == min(b["l"] for b in window) and all(bars[i]["l"] <= b["l"] for b in window):
            pivots.append({"index": i, "price": lo, "kind": "L", "time": bars[i]["t"]})
    pivots.sort(key=lambda p: p["index"])
    return pivots


def detect_choch(bars: list[dict[str, Any]], lookback: int = DEFAULT_PIVOT_LOOKBACK) -> list[dict[str, Any]]:
    """Change-of-Character events: a close beyond the most recent confirmed opposing swing
    that flips the prevailing trend. The first such event is flagged ``isFirst``."""
    pivots = _swing_pivots(bars, lookback)
    if not pivots:
        return []
    events: list[dict[str, Any]] = []
    trend: str | None = None
    last_high: dict[str, Any] | None = None
    last_low: dict[str, Any] | None = None
    pi = 0
    for bar in bars:
        # Confirm any pivots up to (and including lookback bars before) this bar.
        while pi < len(pivots) and pivots[pi]["index"] + lookback <= bar["i"]:
            p = pivots[pi]
            if p["kind"] == "H":
                last_high = p
            else:
                last_low = p
            pi += 1
        if last_high is not None and trend != "bullish" and bar["c"] > last_high["price"]:
            events.append({"index": bar["i"], "time": bar["t"], "price": round(last_high["price"], 4), "direction": "bullish"})
            trend = "bullish"
        elif last_low is not None and trend != "bearish" and bar["c"] < last_low["price"]:
            events.append({"index": bar["i"], "time": bar["t"], "price": round(last_low["price"], 4), "direction": "bearish"})
            trend = "bearish"
    for k, e in enumerate(events):
        e["isFirst"] = (k == 0)
    return events


# ── Order Blocks ─────────────────────────────────────────────────────────────
def detect_order_blocks(bars: list[dict[str, Any]], choch: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The last opposing candle before each displacement that produced a CHoCH.
    Bullish OB = last down candle before an up-break; bearish OB = last up candle
    before a down-break."""
    blocks: list[dict[str, Any]] = []
    for e in choch:
        idx = e["index"]
        want_down = e["direction"] == "bullish"  # bullish OB is the last bearish candle
        ob = None
        for j in range(idx, -1, -1):
            b = bars[j]
            is_down = b["c"] < b["o"]
            if want_down and is_down:
                ob = b
                break
            if not want_down and not is_down:
                ob = b
                break
        if ob is None:
            continue
        blocks.append({
            "type": "bullish" if want_down else "bearish",
            "top": round(ob["h"], 4),
            "bottom": round(ob["l"], 4),
            "index": ob["i"],
            "time": ob["t"],
        })
    return blocks


# ── Strategy assembly ────────────────────────────────────────────────────────
def build_strategy(
    bars: list[dict[str, Any]],
    fvgs: list[dict[str, Any]],
    choch: list[dict[str, Any]],
    order_blocks: list[dict[str, Any]],
) -> dict[str, Any]:
    """Enter at the midline of the FVG created by a change of character's displacement;
    stop beyond the gap; target the nearest opposing order block in the trend direction.

    Uses the most recent CHoCH that still has an actionable (preferably unmitigated) FVG
    on its displacement leg — the live setup — rather than the session's stale first break."""
    if not choch or not bars:
        return {"valid": False, "reason": "No change of character detected yet."}
    chosen: dict[str, Any] | None = None
    fvg: dict[str, Any] | None = None
    for e in reversed(choch):
        same = [f for f in fvgs if f["type"] == e["direction"] and f["startIndex"] >= e["index"] - 1]
        fresh = [f for f in same if not f["mitigated"]]
        pick = fresh or same
        if pick:
            chosen, fvg = e, pick[0]
            break
    if chosen is None or fvg is None:
        return {"valid": False, "reason": "Change of character found, but no fair value gap has formed on the displacement yet.", "direction": choch[-1]["direction"], "choch": choch[-1]}
    first = chosen
    direction = first["direction"]
    entry = fvg["mid"]
    last_price = bars[-1]["c"]

    if direction == "bullish":
        stop = round(fvg["bottom"], 4)
        obs = sorted(
            [b for b in order_blocks if b["type"] == "bearish" and b["bottom"] > entry],
            key=lambda b: b["bottom"],
        )
        target = obs[0]["bottom"] if obs else None
        target_ob = obs[0] if obs else None
    else:
        stop = round(fvg["top"], 4)
        obs = sorted(
            [b for b in order_blocks if b["type"] == "bullish" and b["top"] < entry],
            key=lambda b: b["top"], reverse=True,
        )
        target = obs[0]["top"] if obs else None
        target_ob = obs[0] if obs else None

    risk = abs(entry - stop)
    reward = abs(target - entry) if target is not None else None
    rr = round(reward / risk, 2) if (reward is not None and risk > 0) else None

    if fvg.get("mitigated"):
        status = "invalidated" if (
            (direction == "bullish" and last_price < fvg["bottom"])
            or (direction == "bearish" and last_price > fvg["top"])
        ) else "in_trade"
    elif fvg.get("midTouchIndex") is not None:
        status = "entry_triggered"
    else:
        status = "armed"

    return {
        "valid": True,
        "direction": direction,
        "entry": entry,
        "stop": stop,
        "target": round(target, 4) if target is not None else None,
        "riskReward": rr,
        "status": status,
        "reason": (
            f"{direction.title()} CHoCH at {first['price']}. Enter at the {fvg['type']} FVG midline {entry}; "
            f"stop {stop}; " + (f"target the opposing order block at {round(target, 4)}." if target is not None else "no opposing order block found for a target yet.")
        ),
        "choch": first,
        "fvg": fvg,
        "orderBlock": target_ob,
    }


def compute_fvg_strategy(
    bars: list[dict[str, Any]],
    extend_bars: int = DEFAULT_EXTEND_BARS,
    pivot_lookback: int = DEFAULT_PIVOT_LOOKBACK,
) -> dict[str, Any]:
    """Full FVG/CHoCH/order-block engine + strategy signal for a session's bars."""
    norm = _norm_bars(bars)
    if len(norm) < 3:
        return {"extendBars": extend_bars, "fvgs": [], "choch": [], "orderBlocks": [], "strategy": {"valid": False, "reason": "Not enough bars to detect fair value gaps."}}
    fvgs = detect_fvgs(norm, extend_bars)
    choch = detect_choch(norm, pivot_lookback)
    order_blocks = detect_order_blocks(norm, choch)
    strategy = build_strategy(norm, fvgs, choch, order_blocks)
    return {
        "extendBars": extend_bars,
        "fvgs": fvgs,
        "choch": choch,
        "orderBlocks": order_blocks,
        "strategy": strategy,
    }
