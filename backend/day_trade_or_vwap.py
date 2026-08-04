"""OR/VWAP multi-signal directional framework for Day Trade.

Three independent tests, each answering a different question and scored +1 / 0 / -1,
summed into a conviction score in [-3, +3]:

  1. Price vs today's VWAP        — who controls the session right now?
  2. Today's VWAP vs prev VWAP    — has fair value migrated up or down?
  3. Price vs Opening Range hi/lo — has the initial balance broken?

Sizing follows |score|: 3 = full, 2 = half, <=1 = NO TRADE (conflict = no edge).

Two modifiers refine it:
  A. VWAP slope — a today's-VWAP above prev-VWAP but sloping *down* is decaying value,
     not bullish. If the 30-minute slope contradicts Test 2's sign, Test 2 is downgraded
     to 0 (this is what separates a real trade from a fade).
  B. OR Mid — a tiebreaker lean only, never a fourth point (it is correlated with Tests
     1 and 3 and would double-count).

Timing gates and disable conditions guard against scoring when the inputs are
statistically meaningless (OR not yet formed, post-earnings stale prev-VWAP, gaps,
closing-auction distortion). The score is deliberately invalid before 9:45 ET.

This module is intentionally pure (plain scalars in, dict out) so the rules can be
unit-tested without market data. The workspace layer adapts live metrics into it.
"""

from __future__ import annotations

from typing import Any

# ── Dead-bands ────────────────────────────────────────────────────────────────
# Test 1: within this % of VWAP is "at VWAP" (score 0) — not a hold or a rejection.
VWAP_BAND_PCT = 0.05
# Test 2: today's VWAP within this % of prev VWAP is "unchanged" (score 0).
PREV_VWAP_BAND_PCT = 0.05

# ── Timing gates (minutes from the 9:30 ET open) ─────────────────────────────
OR_LOCK_MIN = 15          # 9:45 ET — ORH/ORL fixed; first valid score
STABILIZE_MIN = 30        # 10:00 ET — VWAP has stabilized; high-quality window opens
NO_NEW_ENTRY_MIN = 60     # 10:30 ET — score valid for management only, no new entries
AUCTION_DISTORT_MIN = 375 # 15:45 ET — closing-auction flow distorts VWAP; ignore

# ── Disable conditions (abs gap % vs prior close) ────────────────────────────
GAP_STALE_PVWAP_PCT = 3.0 # prev VWAP is a stale reference → Test 2 voids to 0
GAP_SKIP_PCT = 5.0        # skip the ticker entirely
OR_TOO_WIDE_MULT = 2.0    # OR wider than this × the 20-day avg → Test 3 gives false precision

# Adjusted-score → plain-language read (see the 8-state table in the spec).
_READS = {
    3: "Trend day up — cleanest long.",
    2: "Bullish — waiting on the breakout.",
    1: "Breakout against declining value — suspect.",
    0: "No trade — signals conflict, no edge.",
    -1: "Breakdown against rising value — suspect.",
    -2: "Bearish — waiting on the breakdown.",
    -3: "Trend day down — cleanest short.",
}


def _sign(value: float, band: float = 0.0) -> int:
    if value > band:
        return 1
    if value < -band:
        return -1
    return 0


def _num(x: Any) -> float | None:
    try:
        if x is None:
            return None
        f = float(x)
        return f if f == f else None  # reject NaN
    except (TypeError, ValueError):
        return None


def _timing_state(minutes_since_open: float | None) -> tuple[str, str, bool, bool]:
    """Return (state, label, valid, allows_new_entry) for the current session minute."""
    if minutes_since_open is None:
        return ("unknown", "Session time unknown — treat score as provisional.", True, True)
    m = minutes_since_open
    if m < OR_LOCK_MIN:
        return ("or_forming", "Opening range still forming — no valid score before 9:45 ET.", False, False)
    if m >= AUCTION_DISTORT_MIN:
        return ("auction", "Closing-auction flow distorts VWAP after 15:45 ET — ignore.", False, False)
    if m < STABILIZE_MIN:
        return ("early", "OR locked; VWAP still stabilizing (9:45–10:00 ET).", True, True)
    if m < NO_NEW_ENTRY_MIN:
        return ("prime", "Highest-quality signal window (10:00–10:30 ET).", True, True)
    return ("management", "Valid for management only — no new entries after 10:30 ET.", True, False)


def compute_or_vwap_framework(
    *,
    price: float | None,
    today_vwap: float | None,
    prev_vwap: float | None,
    or_high: float | None,
    or_low: float | None,
    vwap_slope_pct: float | None = 0.0,
    gap_pct: float | None = None,
    minutes_since_open: float | None = None,
    post_earnings: bool = False,
    or_range_avg20: float | None = None,
) -> dict[str, Any]:
    """Score the OR/VWAP framework for one ticker at one point in the session.

    All prices are underlying dollars. ``gap_pct`` is signed % vs prior close;
    ``vwap_slope_pct`` is the signed % change of today's VWAP over the trailing
    ~30 minutes (only its sign is used). Returns a JSON-safe dict describing the
    three tests, modifiers, raw and slope-adjusted scores, direction, sizing, the
    plain-language read, timing state, any disable reason, and per-session log row.
    """
    price = _num(price)
    today_vwap = _num(today_vwap)
    prev_vwap = _num(prev_vwap)
    or_high = _num(or_high)
    or_low = _num(or_low)
    slope = _num(vwap_slope_pct) or 0.0
    gap = _num(gap_pct)
    abs_gap = abs(gap) if gap is not None else None
    or_range = (or_high - or_low) if (or_high is not None and or_low is not None) else None
    or_mid = ((or_high + or_low) / 2.0) if (or_high is not None and or_low is not None) else None

    timing_state, timing_label, timing_valid, allows_new_entry = _timing_state(minutes_since_open)

    warnings: list[str] = []

    # ── Hard invalid / disabled states ───────────────────────────────────────
    if price is None or today_vwap is None or or_high is None or or_low is None:
        return _result(
            valid=False,
            reason="Waiting for the opening range and today's VWAP to load.",
            timing_state=timing_state, timing_label=timing_label,
            components=_components(price, today_vwap, prev_vwap, or_high, or_low, or_mid, or_range, slope, gap),
        )
    if not timing_valid:
        return _result(
            valid=False, reason=timing_label,
            timing_state=timing_state, timing_label=timing_label,
            components=_components(price, today_vwap, prev_vwap, or_high, or_low, or_mid, or_range, slope, gap),
        )
    if abs_gap is not None and abs_gap > GAP_SKIP_PCT:
        return _result(
            valid=False, disabled=True,
            reason=f"Gap {gap:+.1f}% vs prior close exceeds {GAP_SKIP_PCT:.0f}% — skip this ticker.",
            timing_state=timing_state, timing_label=timing_label,
            components=_components(price, today_vwap, prev_vwap, or_high, or_low, or_mid, or_range, slope, gap),
        )

    # ── Test 1: price vs today's VWAP — who controls the session now? ─────────
    t1 = _sign((price - today_vwap) / today_vwap * 100.0, VWAP_BAND_PCT)

    # ── Test 2: today's VWAP vs prev VWAP — has fair value migrated? ─────────
    t2_void_reason: str | None = None
    if prev_vwap is None or prev_vwap <= 0:
        t2 = 0
        t2_void_reason = "No prior-session VWAP available."
    elif post_earnings:
        t2 = 0
        t2_void_reason = "Post-earnings — prev VWAP was priced on different information."
    elif abs_gap is not None and abs_gap > GAP_STALE_PVWAP_PCT:
        t2 = 0
        t2_void_reason = f"Gap {gap:+.1f}% — prev VWAP is a stale reference."
    else:
        t2 = _sign((today_vwap - prev_vwap) / prev_vwap * 100.0, PREV_VWAP_BAND_PCT)

    # ── Test 3: price vs Opening Range — has the initial balance broken? ─────
    or_too_wide = bool(or_range_avg20 and or_range is not None and or_range > OR_TOO_WIDE_MULT * or_range_avg20)
    if or_too_wide:
        t3 = 0
        warnings.append("Opening range is unusually wide (>2× the 20-day average) — Test 3 suppressed.")
    elif price > or_high:
        t3 = 1
    elif price < or_low:
        t3 = -1
    else:
        t3 = 0

    raw_score = t1 + t2 + t3

    # ── Modifier A: VWAP slope. If slope contradicts Test 2, downgrade to 0. ──
    slope_sign = _sign(slope)
    slope_downgraded = bool(t2 != 0 and slope_sign != 0 and slope_sign != _sign(t2))
    t2_adj = 0 if slope_downgraded else t2
    if slope_downgraded:
        warnings.append("VWAP slope contradicts the value-migration read — Test 2 downgraded to 0 (decaying value).")

    score = t1 + t2_adj + t3

    # ── Modifier B: OR Mid — tiebreaker lean only, not a point. ──────────────
    or_mid_lean = _sign(price - or_mid) if or_mid is not None else 0

    conviction, sizing = _conviction(score)
    direction = "BULL" if score > 0 else "BEAR" if score < 0 else "NONE"
    suspect = abs(raw_score) == 1 or abs(score) == 1

    return _result(
        valid=True,
        timing_state=timing_state, timing_label=timing_label, allows_new_entry=allows_new_entry,
        components=_components(price, today_vwap, prev_vwap, or_high, or_low, or_mid, or_range, slope, gap),
        tests={
            "priceVsVwap": {"value": t1, "label": _t1_label(t1), "detail": f"{_money(price)} vs VWAP {_money(today_vwap)}"},
            "vwapVsPrevVwap": {"value": t2, "label": _t2_label(t2, t2_void_reason), "detail": f"VWAP {_money(today_vwap)} vs prev {_money(prev_vwap)}", "void": t2_void_reason},
            "priceVsOpeningRange": {"value": t3, "label": _t3_label(t3, or_too_wide), "detail": f"{_money(price)} vs ORH {_money(or_high)} / ORL {_money(or_low)}"},
        },
        modifiers={
            "vwapSlopePct": round(slope, 3),
            "slopeDowngradedTest2": slope_downgraded,
            "orMidLean": or_mid_lean,
            "orMid": round(or_mid, 4) if or_mid is not None else None,
        },
        raw_score=raw_score,
        score=score,
        direction=direction,
        conviction=conviction,
        sizing=sizing,
        suspect=suspect,
        read=_READS.get(score, "No trade — signals conflict, no edge."),
        warnings=warnings,
    )


# ── helpers ──────────────────────────────────────────────────────────────────
def _conviction(score: int) -> tuple[str, str]:
    a = abs(score)
    if a == 3:
        return "HIGH", "full"
    if a == 2:
        return "MODERATE", "half"
    return "NO_TRADE", "none"


def _components(price, today_vwap, prev_vwap, or_high, or_low, or_mid, or_range, slope, gap) -> dict[str, Any]:
    return {
        "price": _round(price),
        "todayVwap": _round(today_vwap),
        "prevVwap": _round(prev_vwap),
        "orHigh": _round(or_high),
        "orLow": _round(or_low),
        "orMid": _round(or_mid),
        "orRange": _round(or_range),
        "vwapSlopePct": round(slope, 3) if slope is not None else None,
        "gapPct": round(gap, 3) if gap is not None else None,
    }


def _result(
    *, valid: bool, timing_state: str, timing_label: str,
    components: dict[str, Any], reason: str | None = None, disabled: bool = False,
    allows_new_entry: bool = True, tests: dict[str, Any] | None = None,
    modifiers: dict[str, Any] | None = None, raw_score: int = 0, score: int = 0,
    direction: str = "NONE", conviction: str = "NO_TRADE", sizing: str = "none",
    suspect: bool = False, read: str | None = None, warnings: list[str] | None = None,
) -> dict[str, Any]:
    conviction_final, sizing_final = (conviction, sizing) if valid else ("NO_TRADE", "none")
    return {
        "valid": valid,
        "disabled": disabled,
        "invalidReason": reason,
        "timing": {"state": timing_state, "label": timing_label, "allowsNewEntry": bool(valid and allows_new_entry)},
        "components": components,
        "tests": tests or {},
        "modifiers": modifiers or {},
        "rawScore": raw_score,
        "score": score,
        "direction": direction if valid else "NONE",
        "conviction": conviction_final,
        "sizing": sizing_final,
        "suspect": suspect,
        "read": read if (valid and read) else (reason or "No valid score yet."),
        "warnings": warnings or [],
        "log": _log_row(components, tests, raw_score, score, direction if valid else "NONE", sizing_final, valid),
    }


def _log_row(components, tests, raw_score, score, direction, sizing, valid) -> dict[str, Any]:
    t = tests or {}
    return {
        "orHigh": components.get("orHigh"),
        "orLow": components.get("orLow"),
        "orMid": components.get("orMid"),
        "prevVwap": components.get("prevVwap"),
        "todayVwap": components.get("todayVwap"),
        "vwapSlopePct": components.get("vwapSlopePct"),
        "test1": (t.get("priceVsVwap") or {}).get("value"),
        "test2": (t.get("vwapVsPrevVwap") or {}).get("value"),
        "test3": (t.get("priceVsOpeningRange") or {}).get("value"),
        "rawScore": raw_score if valid else None,
        "adjustedScore": score if valid else None,
        "direction": direction,
        "sizing": sizing,
    }


def _t1_label(v: int) -> str:
    return {1: "Price above VWAP — buyers control", -1: "Price below VWAP — sellers control", 0: "Price at VWAP — balanced"}[v]


def _t2_label(v: int, void: str | None) -> str:
    if void:
        return f"Value migration void — {void}"
    return {1: "Value migrated up vs prior day", -1: "Value migrated down vs prior day", 0: "Value roughly unchanged"}[v]


def _t3_label(v: int, too_wide: bool) -> str:
    if too_wide:
        return "OR too wide to break meaningfully"
    return {1: "Broke above OR High", -1: "Broke below OR Low", 0: "Inside the opening range"}[v]


def _round(x: float | None) -> float | None:
    return round(x, 4) if isinstance(x, (int, float)) else None


def _money(x: float | None) -> str:
    return f"${x:,.2f}" if isinstance(x, (int, float)) else "—"
