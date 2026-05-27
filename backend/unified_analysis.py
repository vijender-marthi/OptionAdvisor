"""
Unified analysis serializer.
Wraps day_trade, swing_trade, and engine into one consistent response shape.
"""
from __future__ import annotations
from typing import Any, Optional
import logging

from verdict import Verdict

log = logging.getLogger(__name__)

# ── Verdict presentation ─────────────────────────────────────────────────────
# All color/label/score derivation for the verdict card lives here.
# Frontend renders these fields directly — no derivation on the UI.

_VERDICT_STATUS: dict[str, str] = {
    "STRONG_GO": "STRONG GO",
    "GO":        "GO",
    "enter":     "GO",
    "WATCH":     "WATCH",
    "watch":     "WATCH",
    "WAIT":      "WAIT",
    "wait":      "WAIT",
    "AVOID":     "AVOID",
    "avoid":     "AVOID",
    "NO_EDGE":   "NO EDGE",
}

_VERDICT_COLOR: dict[str, str] = {
    "STRONG_GO": "#00A86B",
    "GO":        "#00A86B",
    "enter":     "#00A86B",
    "WATCH":     "#D4A017",
    "watch":     "#D4A017",
    "WAIT":      "#D4A017",
    "wait":      "#D4A017",
    "AVOID":     "#D0312D",
    "avoid":     "#D0312D",
    "NO_EDGE":   "#6B7280",
}


def _signal_quality(conditions: list[dict]) -> dict:
    """Compute signal quality score from conditions list."""
    if not conditions:
        return {"score": 0, "label": "No data", "color": "#6B7280"}
    pass_c = sum(1 for c in conditions if c.get("type") == "pass")
    warn_c = sum(1 for c in conditions if c.get("type") == "warn")
    total  = len(conditions)
    weighted = (pass_c * 2 + warn_c * 0.5) / (total * 2) * 10
    score = round(weighted * 10) / 10
    if score >= 7:
        return {"score": score, "label": "Strong",   "color": "#00A86B"}
    if score >= 4:
        return {"score": score, "label": "Moderate", "color": "#D4A017"}
    return {"score": score, "label": "Weak", "color": "#6B7280"}


def verdict_presentation(verdict: str, conditions: list[dict]) -> dict:
    """
    Pre-compute all display fields for the verdict card.
    Returns a dict that the frontend renders directly.
    """
    status_text  = _VERDICT_STATUS.get(verdict, verdict.upper())
    status_color = _VERDICT_COLOR.get(verdict, "#6B7280")
    sq = _signal_quality(conditions)

    pass_c = sum(1 for c in conditions if c.get("type") == "pass")
    warn_c = sum(1 for c in conditions if c.get("type") == "warn")
    fail_c = sum(1 for c in conditions if c.get("type") == "fail")
    total  = len(conditions)
    bar_pct = round(pass_c / total * 100) if total else 0
    bar_color = "#00A86B" if bar_pct >= 70 else "#D4A017" if bar_pct >= 40 else "#D0312D"

    return {
        "status_text":     status_text,
        "status_color":    status_color,
        "signal_quality":  sq,
        "setup_bar_pct":   bar_pct,
        "setup_bar_color": bar_color,
        "pass_count":      pass_c,
        "warn_count":      warn_c,
        "fail_count":      fail_c,
    }


_SA_VERDICT_OVERRIDE = {
    "WATCH_LONG_ONLY":        "WATCH",
    "WATCH_PUT_BREAKDOWN":    "WATCH",
    "WAIT_FOR_CONFIRMATION":  "WAIT",
    "NO_TRADE":               "WAIT",
    "AVOID_CALLS":            "AVOID",
    "AVOID_CHASING_PUTS":     "AVOID",
}

def _day_verdict(scan) -> str:
    td = scan.trader_decision or {}
    suggested = td.get("suggested_action", "") if isinstance(td, dict) else ""
    if suggested in _SA_VERDICT_OVERRIDE:
        return _SA_VERDICT_OVERRIDE[suggested]
    raw = scan.verdict or ""
    return Verdict.from_raw(raw).value

def normalize_verdict(raw: str) -> str:
    return Verdict.from_raw(raw).value


def _fmt_price(price: Optional[float]) -> str:
    if price is None:
        return "—"
    try:
        return f"${price:,.2f}"
    except (TypeError, ValueError):
        return "—"


def _vix_label(vix: Optional[float]) -> str:
    if vix is None:
        return "Unknown"
    if vix < 15:
        return "Low"
    if vix < 20:
        return "Contained"
    if vix < 25:
        return "Elevated"
    if vix < 30:
        return "High"
    return "Extreme"


def _regime_label(spy_chg: Optional[float], qqq_chg: Optional[float]) -> str:
    if spy_chg is None:
        return "NEUTRAL MARKET"
    if spy_chg > 0.5 and (qqq_chg is None or qqq_chg > 0):
        return "BULLISH MARKET"
    if spy_chg < -0.5 and (qqq_chg is None or qqq_chg < 0):
        return "BEARISH MARKET"
    return "NEUTRAL MARKET"


def _risk_level(verdict: str, metrics: dict) -> str:
    vix = metrics.get("vix", 0) or 0
    if vix > 30:
        return "HIGH"
    v = verdict.upper()
    if v in ("NO-GO", "WAIT"):
        return "HIGH"
    return "MEDIUM"


def _entry_description(entry_price: Optional[float], guidance: dict, verdict: str) -> str:
    if not entry_price:
        return "Wait for setup"
    desc = guidance.get("entry_description", "")
    if desc:
        return desc
    return f"${entry_price:,.2f}"


def _stop_description(metrics: dict, trade_type: str) -> str:
    if trade_type == "day":
        or_low = metrics.get("or_low")
        if or_low:
            return f"OR Low ${or_low:,.2f}"
        return "OR Low"
    if trade_type == "swing":
        ma20 = metrics.get("ma20")
        if ma20:
            return f"Below MA20 ${ma20:,.2f}"
        return "MA20 breakdown"
    return "Stop level"


def _shorten_reasons(reasons: list, verdict: str, max_conditions: int = 6) -> list:
    if not reasons:
        return []
    SKIP_LABELS = {'GO', 'STRONG GO', 'NO-GO', 'NO GO', 'WAIT', 'WATCH', 'AVOID', 'STRONG_GO'}
    result = []
    for reason in reasons[:max_conditions]:
        short = str(reason).split("—")[0].split(":")[0].split("(")[0].strip()
        if short.upper() in SKIP_LABELS:
            continue
        words = short.split()
        if len(words) > 5:
            short = " ".join(words[:5])
        lower = str(reason).lower()
        if any(w in lower for w in ['avoid', 'no-go', 'fail', 'weak', 'below', 'negative', 'conflict', 'not ', 'no ']):
            chip_type = "fail"
        elif any(w in lower for w in ['wait', 'watch', 'caution', 'extended', 'slow', 'check', 'elevated', 'short-bias', 'short bias', 'bearish', 'momentum -', 'inside opening']):
            chip_type = "warn"
        else:
            chip_type = "pass"
        if short:
            result.append({"label": short, "type": chip_type})
    return result


def _regular_conditions(top_rec, signals) -> list:
    conditions = []
    try:
        trend = getattr(signals, 'trend_label', None) or getattr(signals, 'trend', None)
        if trend:
            conditions.append({
                "label": f"Trend {trend}",
                "type": "pass" if "bull" in str(trend).lower() else "warn"
            })
        iv_rank = getattr(signals, 'iv_rank', None)
        if iv_rank is not None:
            conditions.append({
                "label": f"IV Rank {iv_rank:.0f}%",
                "type": "pass" if 40 <= iv_rank <= 70 else "warn"
            })
        pop = getattr(top_rec, 'prob_of_profit', None)
        if pop:
            pop_pct = pop * 100
            conditions.append({
                "label": f"PoP {pop_pct:.0f}%",
                "type": "pass" if pop_pct >= 60 else "warn"
            })
        ev = getattr(top_rec, 'expected_value', None)
        if ev and ev > 0:
            conditions.append({"label": "Positive EV", "type": "pass"})
        warnings = getattr(top_rec, 'warnings', None) or []
        if warnings:
            conditions.append({
                "label": str(warnings[0]).split(".")[0][:30],
                "type": "warn"
            })
    except Exception:
        pass
    return conditions[:6]

def _extract_confidence(conf) -> int:
    """
    Day trade confidence is a dict of
    qualitative labels, not a number.
    Convert labels to a 0-100 score.
    """
    if conf is None:
        return 0
    if isinstance(conf, (int, float)):
        return int(conf)
    if not isinstance(conf, dict):
        return 0

    # Label → point mapping
    # Current _extract_confidence maps:
    # 'HIGH', 'STRONG', 'GOOD' etc.
    # Swing uses:
    # 'MODERATE', 'NEUTRAL', 'MIXED', 'MEDIUM'

    label_scores = {
        'HIGH':     3,
        'STRONG':   3,
        'GOOD':     2,
        'MODERATE': 2,
        'NEUTRAL':  2,
        'MIXED':    1,
        'MEDIUM':   2,
        'LOW':      1,
        'WEAK':     0,
        'POOR':     0,
        'NONE':     0,
    }


    # Special case: 'risk' field —
    # LOW risk = good, HIGH risk = bad
    risk_scores = {
        'LOW':    3,
        'MEDIUM': 2,
        'HIGH':   0,
    }

    total = 0
    max_possible = len(conf) * 3

    for key, val in conf.items():
        v = str(val).upper().strip()
        if key.lower() == 'risk':
            total += risk_scores.get(v, 1)
        else:
            total += label_scores.get(v, 1)

    if max_possible == 0:
        return 0

    # Scale to 0-100
    return round((total / max_possible) * 100)

def serialize_day_trade(scan) -> dict:
    import logging
    log = logging.getLogger(__name__)

    # ADD THESE DEBUG LINES AT TOP:
    log.info("serialize_day_trade called")
    log.info("scan type: %s", type(scan))
    log.info("scan.verdict: %s",
             getattr(scan, 'verdict', 'MISSING'))
    log.info("scan.metrics keys: %s",
             list(getattr(scan, 'metrics', {}).keys())[:10])
    log.info("scan.entry_guidance: %s",
             getattr(scan, 'entry_guidance', 'MISSING'))
    log.info("scan.trader_decision keys: %s",
             list(getattr(scan, 'trader_decision', {}).keys()))

    try:
        m = scan.metrics or {}
        eg = scan.entry_guidance or {}
        td = scan.trader_decision or {}
        orc = scan.option_risk_context or {}

        entry_price = eg.get("entry_price") or eg.get("current_price") or m.get("last_price")
        stop_price = eg.get("stop_price") or eg.get("risk_below") or m.get("or_low")
        t1_price = eg.get("scalp_target") or eg.get("target_1")
        t2_price = eg.get("target_2")

        # Derive direction from trader_decision.suggested_action — this is
        # the authoritative source.  The stop/entry relationship is only a
        # last-resort fallback when suggested_action gives no clear signal,
        # because day_trade.py builds entry_guidance from scan bias which
        # can differ from what trader_decision ultimately recommends.
        _suggested = td.get("suggested_action", "")
        _PUT_ACTIONS  = {"WATCH_PUT_BREAKDOWN", "AVOID_CHASING_PUTS"}
        _CALL_ACTIONS = {"WATCH_LONG_ONLY", "AVOID_CALLS"}

        if _suggested in _PUT_ACTIONS:
            _is_put = True
        elif _suggested in _CALL_ACTIONS:
            _is_put = False
        else:
            # No explicit direction — infer from stop/entry relationship
            _is_put = bool(
                entry_price and stop_price
                and isinstance(stop_price, (int, float))
                and isinstance(entry_price, (int, float))
                and stop_price > entry_price
            )

        # Validate stop is on the correct side of entry.
        # day_trade.py sets risk_below = or_low for long, or_high for short.
        # When direction disagrees with the scan bias the stop will be on
        # the wrong side — correct it using the metric directly.
        if entry_price and stop_price:
            _stop_wrong_side = (
                (_is_put  and stop_price < entry_price) or
                (not _is_put and stop_price > entry_price)
            )
            if _stop_wrong_side:
                # Try the opposite OR level from raw metrics
                if _is_put:
                    stop_price = m.get("or_high") or None
                else:
                    stop_price = m.get("or_low") or None
                # If still wrong side, clear it — better to show "—" than bad data
                if stop_price and entry_price:
                    still_wrong = (
                        (_is_put  and stop_price < entry_price) or
                        (not _is_put and stop_price > entry_price)
                    )
                    if still_wrong:
                        stop_price = None

        _direction = "PUT" if _is_put else "CALL"

        structure = (
            orc.get("structure_hint")
            or orc.get("recommended_structure")
            or f"{_direction} · 1-2 DTE"
        )

        # For PUT trades the scalp_target is computed for the bullish leg —
        # a T1 above entry is a loss on a put, so skip it.
        # For CALL trades a T1 below entry is equally wrong.
        def _t1_valid(t1, entry, is_put):
            if t1 is None:
                return False
            if entry is None:
                return True  # no entry to compare, include it
            return t1 < entry if is_put else t1 > entry

        _stop_action = (
            "OR High violated — accept the loss"
            if _is_put else
            "OR Low violated — accept the loss"
        )

        exit_rows = []
        if _t1_valid(t1_price, entry_price, _is_put):
            exit_rows.append({"when": "Target 1", "price": _fmt_price(t1_price), "action": "Sell ½ · move stop to entry", "type": "t1"})
        if _t1_valid(t2_price, entry_price, _is_put):
            exit_rows.append({"when": "Target 2", "price": _fmt_price(t2_price), "action": "Sell remaining ½ · flat", "type": "t2"})
        if stop_price:
            exit_rows.append({"when": "Stop Loss", "price": _fmt_price(stop_price), "action": _stop_action, "type": "stop"})
        exit_rows.append({"when": "Time Stop", "price": "EOD", "action": "3:55 PM ET · Never carry overnight", "type": "time"})

        conditions = _shorten_reasons(scan.reasons or [], scan.verdict or "", max_conditions=6)

        # Only show R/R when there is a valid profit target in the exit plan.
        # The engine's entry_rr_ratio is computed from the scan bias which may
        # differ from the direction we resolved — recompute from actual levels.
        _has_target = any(r["type"] in ("t1", "t2") for r in exit_rows)
        if _has_target and entry_price and stop_price and t1_price:
            _risk  = abs(entry_price - stop_price)
            _reward = abs(t1_price - entry_price)
            rr_str = f"{_reward / _risk:.1f}:1" if _risk > 0 else None
        else:
            rr_str = None

        coach = td.get("decision_message", "") or td.get("market_guidance", "")

        rvol_val = m.get("rvol")
        rvol_str = f"{rvol_val:.1f}x" if rvol_val else None

        spy_chg = m.get("spy_change_pct")
        qqq_chg = m.get("qqq_change_pct")

        # Clear entry plan for non-actionable verdicts
        normalized = _day_verdict(scan)
        if normalized in ('AVOID', 'WAIT', 'NO_EDGE'):
            entry_price = None
            stop_price = None
            structure = ""
            exit_rows = []
            rr_str = None

        return {
            "ticker": scan.ticker,
            "company": getattr(scan, "company_name", scan.ticker),
            "trade_type": "day",
            "price": m.get("last_price") or 0,
            "change_pct": m.get("session_change_pct"),
            "verdict": _day_verdict(scan),
            "verdict_raw": _day_verdict(scan),
            "confidence": _extract_confidence(m.get("confidence")),
            "reason": td.get("decision_message") or (scan.reasons[0] if scan.reasons else ""),
            "conditions": conditions,
            "entry_price": entry_price,
            "entry_description": _entry_description(entry_price, eg, scan.verdict or ""),
            "stop_price": stop_price,
            "stop_description": _stop_description(m, "day"),
            "structure": structure,
            "exit_rows": exit_rows,
            "rr_ratio": rr_str,
            "risk_level": _risk_level(scan.verdict or "", m),
            "rvol": rvol_str,
            "coach": coach,
            "spy_price": None,
            "spy_change_pct": spy_chg,
            "qqq_price": None,
            "qqq_change_pct": qqq_chg,
            "vix": m.get("vix"),
            "vix_label": _vix_label(m.get("vix")),
            "regime": _regime_label(spy_chg, qqq_chg),
            "psychology": m.get("psychology") or None,
            "risk_profile": m.get("risk_profile") or [],
            "session": m.get("session_phase") or "",
            "regular_recommendations": [],
            "verdict_presentation": verdict_presentation(_day_verdict(scan), conditions),
        }
    except Exception as e:
        log.error("serialize_day_trade error for %s: %s", getattr(scan, 'ticker', '?'), e, exc_info=True)
        return _error_response(getattr(scan, 'ticker', ''), "day", str(e))


def serialize_swing_trade(scan) -> dict:
    try:
        m = scan.metrics or {}
        exec_levels = m.get("exec_levels") or {}
        exit_rules = m.get("exit_rules") or []

        entry_price = exec_levels.get("entry")
        stop_price = exec_levels.get("stop")
        t1_price = exec_levels.get("t1")
        t2_price = exec_levels.get("t2")

        spread = m.get("spread_entry") or {}
        structure = (
            spread.get("structure_label")
            or spread.get("strategy")
            or getattr(scan, "suggested_strategy", None)
            or "See analysis"
        )
        if spread.get("dte"):
            structure = f"{structure} · {spread['dte']} DTE"

        exit_rows = []
        for rule in exit_rules:
            exit_rows.append({
                "when": rule.get("trigger") or rule.get("when") or "",
                "price": _fmt_price(rule.get("price")),
                "action": rule.get("action") or "",
                "note": rule.get("note") or "",
                "type": rule.get("type") or "stop",
            })

        # After building exit_rows, add:
        if not exit_rows:
            # WAIT/AVOID verdict — no trade plan
            # Return empty list, frontend handles it
            pass  # already empty, that's correct

        # if not exit_rows:
        #     if t1_price:
        #         exit_rows.append({"when": "Target 1", "price": _fmt_price(t1_price), "action": "Sell ½ · trail rest", "type": "t1"})
        #     if t2_price:
        #         exit_rows.append({"when": "Target 2", "price": _fmt_price(t2_price), "action": "Full exit", "type": "t2"})
        #     if stop_price:
        #         exit_rows.append({"when": "Stop Loss", "price": _fmt_price(stop_price), "action": "MA20 violated — exit", "type": "stop"})
        #
        #     exit_rows.append({"when": "Time Stop", "price": "21 DTE", "action": "Close or roll — gamma risk", "type": "time"})
        #


        rr = exec_levels.get("rr_ratio")
        rr_str = f"{rr:.1f}:1" if rr else None

        conditions = _shorten_reasons(scan.reasons or [], scan.verdict or "", max_conditions=6)

        coach = getattr(scan, "playbook_hint", "") or getattr(scan, "decision_message", "") or ""

        # Use final_action (same source as the decision resolver and TCC) so the
        # verdict shown on this detail page matches the TCC card verdict.
        # scan.verdict is the raw score-based signal; final_action reflects
        # confirmation requirements, risk gating, and wait conditions.
        final_action = str(getattr(scan, "final_action", "") or "").upper()
        _ACTION_MAP: dict[str, str] = {
            "STRONG_GO":                 "STRONG_GO",
            "QUALITY_LONG":              "GO",
            "WATCH_CALL_OR_DEBIT_SPREAD": "WATCH",
            "WATCH_CALL":                "WATCH",
            "WATCH_PUT":                 "WATCH",
            "GO_SMALL":                  "WATCH",
        }
        if final_action in _ACTION_MAP:
            sw_verdict_val = _ACTION_MAP[final_action]
        elif final_action.startswith("WAIT") or final_action in ("MARKET_CONFIRMATION_ONLY", "NO_TRADE_WAIT"):
            sw_verdict_val = "WAIT"
        elif final_action.startswith("AVOID") or final_action == "NO_TRADE":
            sw_verdict_val = "AVOID"
        else:
            # Fallback to raw scan verdict when final_action is unknown/empty
            sw_verdict_val = normalize_verdict(scan.verdict or "")

        # Clear entry plan for non-actionable verdicts
        if sw_verdict_val in ('AVOID', 'WAIT', 'NO_EDGE'):
            entry_price = None
            stop_price = None
            structure = ""
            exit_rows = []

        return {
            "ticker": scan.ticker,
            "company": getattr(scan, "company_name", scan.ticker),
            "trade_type": "swing",
            "price": m.get("last_price") or 0,
            "change_pct": m.get("momentum_5d_pct"),
            "verdict": sw_verdict_val,
            "verdict_raw": Verdict.from_raw(scan.verdict or "").value,
            "confidence": _extract_confidence(m.get("confidence")),
            "reason": getattr(scan, "decision_message", "") or (scan.reasons[0] if scan.reasons else ""),
            "conditions": conditions,
            "entry_price": entry_price,
            "entry_description": exec_levels.get("entry_description") or _entry_description(entry_price, exec_levels, scan.verdict or ""),
            "stop_price": stop_price,
            "stop_description": _stop_description(m, "swing"),
            "structure": structure,
            "exit_rows": exit_rows,
            "rr_ratio": rr_str,
            "risk_level": getattr(scan, "risk_level", None) or "MEDIUM",
            "rvol": None,
            "coach": coach,
            "spread_entry": spread if isinstance(spread, dict) and spread.get("long_leg") else None,
            "spy_price": None,
            "spy_change_pct": None,
            "qqq_price": None,
            "qqq_change_pct": None,
            "vix": m.get("vix"),
            "vix_label": _vix_label(m.get("vix")),
            "regime": m.get("market_context") or "MIXED",
            "psychology": m.get("psychology") or None,
            "risk_profile": m.get("risk_profile") or [],
            "session": "swing",
            "regular_recommendations": [],
            "verdict_presentation": verdict_presentation(sw_verdict_val, conditions),
        }
    except Exception as e:
        log.error("serialize_swing_trade error for %s: %s", getattr(scan, 'ticker', '?'), e, exc_info=True)
        return _error_response(getattr(scan, 'ticker', ''), "swing", str(e))


def serialize_regular_trade(ticker: str, company: str, price: float, candidates: list, signals: Any) -> dict:
    try:
        if not candidates:
            return {
                "ticker": ticker,
                "company": company,
                "trade_type": "regular",
                "price": price,
                "change_pct": None,
                "verdict": "wait",
                "verdict_raw": "NO_TRADES",
                "confidence": 0,
                "reason": "No trades passed all filters. Try a more liquid ticker or adjust strategy mode.",
                "conditions": [],
                "entry_price": None,
                "entry_description": "",
                "stop_price": None,
                "stop_description": "",
                "structure": "",
                "exit_rows": [],
                "rr_ratio": None,
                "risk_level": "HIGH",
                "rvol": None,
                "coach": "No qualifying setups found. Check IV rank, liquidity, and signal alignment.",
                "spy_price": None,
                "spy_change_pct": None,
                "qqq_price": None,
                "qqq_change_pct": None,
                "vix": getattr(signals, 'vix', None),
                "vix_label": _vix_label(getattr(signals, 'vix', None)),
                "regime": "NEUTRAL MARKET",
                "session": "regular",
                "regular_recommendations": [],
                "psychology": None,
                "risk_profile": [],
                "verdict_presentation": verdict_presentation("wait", []),
            }

        top = candidates[0]
        score = getattr(top, 'total_score', 0) or 0

        _v = "GO" if score >= 70 else "WATCH" if score >= 50 else "WAIT"
        verdict     = Verdict.from_raw(_v).value
        verdict_raw = Verdict.from_raw(_v).value

        confidence = min(int(score), 99)

        entry_price = None
        stop_price = None
        legs = getattr(top, 'legs', None) or []
        if legs:
            short_legs = [l for l in legs if isinstance(l, dict) and (l.get("action") == "sell" or l.get("position") == "short")]
            if not short_legs:
                short_legs = [l for l in legs if not isinstance(l, dict) and (getattr(l, 'action', '') == 'sell')]
            if short_legs:
                entry_price = short_legs[0].get("strike") if isinstance(short_legs[0], dict) else getattr(short_legs[0], 'strike', None)
            stop_price = getattr(top, 'breakeven_lower', None) or getattr(top, 'breakeven_upper', None)

        structure = f"{getattr(top, 'strategy', 'Options')} · {getattr(top, 'dte', '?')} DTE"

        exit_rows = []
        ep = getattr(top, 'exit_plan', None) or {}
        if isinstance(ep, dict):
            if ep.get("profit_target_pct"):
                exit_rows.append({"when": "Profit Target", "price": f"{ep['profit_target_pct']}% of max", "action": "Close position", "type": "t1"})
            if ep.get("stop_loss_trigger"):
                exit_rows.append({"when": "Stop Loss", "price": str(ep.get("stop_loss_trigger", "")), "action": "Close — loss limit hit", "type": "stop"})
            if ep.get("time_stop_dte"):
                exit_rows.append({"when": "Time Stop", "price": f"{ep['time_stop_dte']} DTE", "action": "Close or roll — gamma risk", "type": "time"})

        reason = getattr(top, 'rationale', '') or ''
        if not isinstance(reason, str):
            reason = str(reason)

        exit_rules = getattr(top, 'exit_rules', None) or []
        exit_rules_text = " ".join(str(r) for r in exit_rules[:2]) if exit_rules else ""
        coach = exit_rules_text or reason

        conditions = _regular_conditions(top, signals)

        recs = []
        for i, c in enumerate(candidates[:6]):
            c_legs = getattr(c, 'legs', None) or []
            recs.append({
                "rank": i + 1,
                "strategy": getattr(c, 'strategy', ''),
                "bias": getattr(c, 'bias', ''),
                "score": round(getattr(c, 'total_score', 0) or 0, 1),
                "max_profit": getattr(c, 'max_profit', 0) or 0,
                "max_loss": getattr(c, 'max_loss', 0) or 0,
                "prob_of_profit": getattr(c, 'prob_of_profit', 0) or 0,
                "expected_value": getattr(c, 'expected_value', 0) or 0,
                "expiry": getattr(c, 'expiry', ''),
                "dte": getattr(c, 'dte', 0) or 0,
                "legs": [
                    {
                        "action": l.get("action", "") if isinstance(l, dict) else getattr(l, 'action', ''),
                        "type": l.get("type", "") if isinstance(l, dict) else getattr(l, 'option_type', ''),
                        "strike": l.get("strike") if isinstance(l, dict) else getattr(l, 'strike', None),
                        "expiry": l.get("expiry", "") if isinstance(l, dict) else getattr(l, 'expiry', ''),
                        "delta": l.get("delta") if isinstance(l, dict) else getattr(l, 'delta', None),
                        "mid": l.get("mid") if isinstance(l, dict) else getattr(l, 'mid_price', None),
                    }
                    for l in c_legs
                ],
                "exit_plan": getattr(c, 'exit_plan', {}) or {},
                "warnings": getattr(c, 'warnings', []) or [],
                "rationale": getattr(c, 'rationale', '') or '',
            })

        rr_ratio = getattr(top, 'risk_reward_ratio', None)
        rr_str = f"{1/rr_ratio:.1f}:1" if rr_ratio and rr_ratio > 0 else None

        return {
            "ticker": ticker,
            "company": company,
            "trade_type": "regular",
            "price": price,
            "change_pct": None,
            "verdict": verdict,
            "verdict_raw": verdict_raw,
            "confidence": confidence,
            "reason": reason,
            "conditions": conditions,
            "entry_price": entry_price,
            "entry_description": f"{getattr(top, 'strategy', 'Options')} setup",
            "stop_price": stop_price,
            "stop_description": "Breakeven level",
            "structure": structure,
            "exit_rows": exit_rows,
            "rr_ratio": rr_str,
            "risk_level": "MEDIUM",
            "rvol": None,
            "coach": coach,
            "spy_price": None,
            "spy_change_pct": None,
            "qqq_price": None,
            "qqq_change_pct": None,
            "vix": getattr(signals, 'vix', None),
            "vix_label": _vix_label(getattr(signals, 'vix', None)),
            "regime": "NEUTRAL MARKET",
            "session": "regular",
            "regular_recommendations": recs,
            "psychology": None,
            "risk_profile": [],
            "verdict_presentation": verdict_presentation(verdict, conditions),
        }
    except Exception as e:
        log.error("serialize_regular_trade error for %s: %s", ticker, e, exc_info=True)
        return _error_response(ticker, "regular", str(e))


def _error_response(ticker: str, trade_type: str, error: str) -> dict:
    return {
        "ticker": ticker,
        "company": ticker,
        "trade_type": trade_type,
        "price": 0,
        "change_pct": None,
        "verdict": "wait",
        "verdict_raw": "ERROR",
        "confidence": 0,
        "reason": f"Analysis error: {error}",
        "conditions": [],
        "entry_price": None,
        "entry_description": "",
        "stop_price": None,
        "stop_description": "",
        "structure": "",
        "exit_rows": [],
        "rr_ratio": None,
        "risk_level": "HIGH",
        "rvol": None,
        "coach": "",
        "spy_price": None,
        "spy_change_pct": None,
        "qqq_price": None,
        "qqq_change_pct": None,
        "vix": None,
        "vix_label": "Unknown",
        "regime": "NEUTRAL MARKET",
        "session": trade_type,
        "regular_recommendations": [],
        "psychology": None,
        "risk_profile": [],
        "verdict_presentation": verdict_presentation("wait", []),
    }
