from __future__ import annotations

from typing import Any, Mapping


def _get(d: Mapping[str, Any] | Any, key: str, default: Any = None) -> Any:
    if isinstance(d, Mapping):
        return d.get(key, default)
    return getattr(d, key, default) if hasattr(d, key) else default


def _fmt(n: float | None, dp: int = 2) -> str:
    if n is None:
        return "—"
    return f"${n:.{dp}f}"


def _pct(n: float | None) -> str:
    if n is None:
        return "—"
    return f"{n:.1f}%"


# ---------------------------------------------------------------------------
# Strategy-specific explanation builders
# ---------------------------------------------------------------------------

def _explain_bull_call_spread(rec: dict, sig: dict) -> dict:
    cost = _get(rec, "net_credit", 0)
    be = _get(rec, "breakeven_lower", 0)
    mp = _get(rec, "max_profit", 0)
    ml = _get(rec, "max_loss", 0)
    dte = _get(rec, "dte", 0)
    return {
        "summary": (
            f"Bullish directional setup with defined risk. "
            f"The debit spread reduces premium cost versus a naked long call "
            f"while keeping upside exposure. Best if price continues moderately higher before expiry. "
            f"Net debit {_fmt(cost)} · Breakeven {_fmt(be)} · Max profit {_fmt(mp)} · Max loss {_fmt(ml)}."
        ),
        "recommended_action": "Enter only if trend and volume remain supportive. Avoid chasing if ticker is extended.",
        "why_this_trade": f"Bull Call Spread at {_fmt(be)} breakeven, {dte} DTE. Defined risk with capped upside.",
        "main_risk": "Upside must happen before theta decay reduces spread value.",
        "management_note": f"Close at 21 DTE or 50% max profit. Stop if price closes below long strike + premium.",
    }


def _explain_bear_put_spread(rec: dict, sig: dict) -> dict:
    cost = _get(rec, "net_credit", 0)
    be = _get(rec, "breakeven_upper", 0)
    mp = _get(rec, "max_profit", 0)
    ml = _get(rec, "max_loss", 0)
    dte = _get(rec, "dte", 0)
    return {
        "summary": (
            f"Bearish directional setup with defined risk. "
            f"The debit spread lowers cost versus a naked long put "
            f"while targeting controlled downside movement. "
            f"Net debit {_fmt(cost)} · Breakeven {_fmt(be)} · Max profit {_fmt(mp)} · Max loss {_fmt(ml)}."
        ),
        "recommended_action": "Enter on confirmed breakdown. Avoid if market context is risk-on.",
        "why_this_trade": f"Bear Put Spread at {_fmt(be)} breakeven, {dte} DTE. Defined-risk bearish play.",
        "main_risk": "Needs continued downside momentum before expiry.",
        "management_note": f"Exit early if stock finds support above breakeven.",
    }


def _explain_covered_call(rec: dict, sig: dict) -> dict:
    premium = _get(rec, "net_credit", 0)
    be = _get(rec, "breakeven_lower", 0)
    mp = _get(rec, "max_profit", 0)
    ml = _get(rec, "max_loss", 0)
    price = _get(sig, "current_price", 0)
    yield_pct = (premium / price * 100) if price and premium > 0 else 0
    return {
        "summary": (
            f"Income strategy backed by stock ownership. "
            f"Premium of {_fmt(premium)}/share ({yield_pct:.1f}% yield) is attractive, "
            f"but upside is capped near the short call strike. "
            f"Best when outlook is neutral to mildly bullish and you are comfortable selling shares if assigned."
        ),
        "recommended_action": "Use only if assignment is acceptable. Consider farther OTM strikes if you want more upside room.",
        "why_this_trade": f"Covered Call collecting {_fmt(premium)} premium ({yield_pct:.1f}% yield) — income on held shares.",
        "main_risk": "Stock may rally through the short strike and shares can be called away.",
        "management_note": "Roll the call forward if challenged early. Let shares go if deep ITM at expiry.",
    }


def _explain_covered_put(rec: dict, sig: dict) -> dict:
    premium = _get(rec, "net_credit", 0)
    be = _get(rec, "breakeven_lower", 0)
    return {
        "summary": (
            f"Premium-selling strategy for neutral to bullish outlook. "
            f"Cash is reserved to cover assignment at the short put strike. "
            f"Best when you are comfortable buying shares near the strike if assigned."
        ),
        "recommended_action": "Deploy only when cash reserve is available and assignment at strike is acceptable.",
        "why_this_trade": f"Cash-secured put collecting {_fmt(premium)} premium — income with assignment readiness.",
        "main_risk": "Stock may fall through the strike and assignment risk increases.",
        "management_note": "Roll down if challenged early to avoid deep ITM assignment.",
    }


def _explain_long_call(rec: dict, sig: dict) -> dict:
    cost = abs(_get(rec, "net_credit", 0))
    be = _get(rec, "breakeven_lower", 0)
    mp = _get(rec, "max_profit", 0)
    dte = _get(rec, "dte", 0)
    iv_rank = _get(sig, "iv_rank", 0)
    return {
        "summary": (
            f"Directional momentum trade. "
            f"Best when trend is strong, IV is reasonable (rank {iv_rank:.0f}%), "
            f"and breakout continuation is likely. "
            f"Premium {_fmt(cost)} · Breakeven {_fmt(be)} · DTE {dte}."
        ),
        "recommended_action": "Scale into strength with defined stops. Avoid if IV rank is elevated above 60.",
        "why_this_trade": f"Long Call {dte} DTE — bullish momentum play with unlimited upside potential.",
        "main_risk": "Premium can decay quickly if price stalls or IV contracts.",
        "management_note": f"Set stop at 50% premium loss. Close early if momentum stalls.",
    }


def _explain_long_put(rec: dict, sig: dict) -> dict:
    cost = abs(_get(rec, "net_credit", 0))
    be = _get(rec, "breakeven_upper", 0)
    mp = _get(rec, "max_profit", 0)
    dte = _get(rec, "dte", 0)
    iv_rank = _get(sig, "iv_rank", 0)
    return {
        "summary": (
            f"Bearish directional trade. "
            f"Best when trend is weakening, support breaks, and market context supports downside. "
            f"IV rank {iv_rank:.0f}% · Premium {_fmt(cost)} · Breakeven {_fmt(be)} · DTE {dte}."
        ),
        "recommended_action": "Enter on confirmed breakdown. Avoid if market is bid aggressively.",
        "why_this_trade": f"Long Put {dte} DTE — bearish momentum play with defined premium risk.",
        "main_risk": "Puts decay quickly if the stock stabilizes or rebounds.",
        "management_note": "Set tight stop. Close if price reclaims key support.",
    }


def _explain_bull_put_spread(rec: dict, sig: dict) -> dict:
    credit = _get(rec, "net_credit", 0)
    mp = _get(rec, "max_profit", 0)
    ml = _get(rec, "max_loss", 0)
    dte = _get(rec, "dte", 0)
    price = _get(sig, "current_price", 0)
    be = _get(rec, "breakeven_lower", 0)
    return {
        "summary": (
            f"Bullish-to-neutral income trade. "
            f"Credit of {_fmt(credit)} collected while price stays above the short put strike. "
            f"Best when support is strong and IV is elevated enough to pay fair credit. "
            f"Max profit {_fmt(mp)} · Max loss {_fmt(ml)} · Breakeven {_fmt(be)}."
        ),
        "recommended_action": "Enter with trend support. Consider rolling down if price approaches short strike.",
        "why_this_trade": f"Bull Put Spread collecting {_fmt(credit)} credit ({dte} DTE) — income with defined risk buffer.",
        "main_risk": "Short strike pressure increases if price breaks support.",
        "management_note": f"Close at 50% credit capture or before 10 DTE. Roll if tested early.",
    }


def _explain_bear_call_spread(rec: dict, sig: dict) -> dict:
    credit = _get(rec, "net_credit", 0)
    mp = _get(rec, "max_profit", 0)
    ml = _get(rec, "max_loss", 0)
    dte = _get(rec, "dte", 0)
    be = _get(rec, "breakeven_upper", 0)
    return {
        "summary": (
            f"Bearish-to-neutral income trade. "
            f"Credit of {_fmt(credit)} collected while price stays below the short call strike. "
            f"Best when resistance is strong and IV supports premium. "
            f"Max profit {_fmt(mp)} · Max loss {_fmt(ml)} · Breakeven {_fmt(be)}."
        ),
        "recommended_action": "Enter with resistance holding. Roll up if price challenges short strike.",
        "why_this_trade": f"Bear Call Spread collecting {_fmt(credit)} credit ({dte} DTE) — defined-risk bearish income.",
        "main_risk": "Short strike pressure increases if price breaks above resistance.",
        "management_note": f"Close at 50% credit capture. Roll up and out if challenged early.",
    }


def _explain_iron_condor(rec: dict, sig: dict) -> dict:
    credit = _get(rec, "net_credit", 0)
    mp = _get(rec, "max_profit", 0)
    ml = _get(rec, "max_loss", 0)
    dte = _get(rec, "dte", 0)
    be_l = _get(rec, "breakeven_lower", 0)
    be_u = _get(rec, "breakeven_upper", 0)
    return {
        "summary": (
            f"Neutral income strategy. "
            f"Best when price is expected to remain inside a range and IV is elevated enough to compensate for risk. "
            f"Credit {_fmt(credit)} · Breakevens {_fmt(be_l)}–{_fmt(be_u)} · Max loss {_fmt(ml)}."
        ),
        "recommended_action": "Enter when price is centered between short strikes and IV is elevated. Close at 50% credit capture.",
        "why_this_trade": f"Iron Condor {dte} DTE — range-bound income play collecting {_fmt(credit)}.",
        "main_risk": "Large directional move or volatility expansion can pressure one side of the condor.",
        "management_note": "Close the challenged wing if price approaches a short strike. Do not hold through events.",
    }


def _explain_long_straddle(rec: dict, sig: dict) -> dict:
    cost = abs(_get(rec, "net_credit", 0))
    mp = _get(rec, "max_profit", 0)
    dte = _get(rec, "dte", 0)
    return {
        "summary": (
            f"Volatility trade. "
            f"Best when a large move is expected but direction is uncertain. "
            f"Premium {_fmt(cost)} · DTE {dte} · Breakevens require a move beyond total premium."
        ),
        "recommended_action": "Only if an identifiable catalyst exists. Close early if IV collapses.",
        "why_this_trade": f"Long Straddle {dte} DTE — betting on volatility expansion, not direction.",
        "main_risk": "Both legs lose value if price stays range-bound or IV collapses.",
        "management_note": "Sell the profitable side early if a clear direction emerges. Close both if IV drops.",
    }


# ---------------------------------------------------------------------------
# Strategy dispatch table
# ---------------------------------------------------------------------------

_EXPLAINERS = {
    "Bull Call Spread":   _explain_bull_call_spread,
    "Bear Put Spread":    _explain_bear_put_spread,
    "Covered Call":       _explain_covered_call,
    "Covered Put":        _explain_covered_put,
    "Long Call":          _explain_long_call,
    "Long Put":           _explain_long_put,
    "Bull Put Spread":    _explain_bull_put_spread,
    "Bear Call Spread":   _explain_bear_call_spread,
    "Iron Condor":        _explain_iron_condor,
    "Long Straddle":      _explain_long_straddle,
}


def build_strategy_explanation(
    rec: Mapping[str, Any] | dict,
    signals: Mapping[str, Any] | dict | None = None,
) -> dict:
    """Return strategy-aware explanation dict with summary, recommended_action, why_this_trade, main_risk, management_note."""
    rec = dict(rec)
    sig = dict(signals) if signals else {}
    strategy = str(_get(rec, "strategy", "") or "")
    explainer = _EXPLAINERS.get(strategy)
    if explainer:
        return explainer(rec, sig)
    # Fallback for unknown strategies
    iv_rank = _get(sig, "iv_rank", 0)
    return {
        "summary": f"{strategy} setup with defined risk. IV rank {iv_rank:.0f}%.",
        "recommended_action": "Review the setup before entry.",
        "why_this_trade": f"{strategy} aligned with current market conditions.",
        "main_risk": "Standard options risk applies — review max loss before entry.",
        "management_note": "Close before 21 DTE or at 50% max profit.",
    }


# ---------------------------------------------------------------------------
# Strategy-aware risk label
# ---------------------------------------------------------------------------

def compute_risk_label(rec: Mapping[str, Any] | dict, signals: Mapping[str, Any] | dict | None = None) -> tuple[str, str]:
    """Return (risk_label, risk_reason) tuple with strategy-aware risk assessment."""
    rec = dict(rec)
    sig = dict(signals) if signals else {}
    strategy = str(_get(rec, "strategy", "") or "")
    iv_rank = float(_get(sig, "iv_rank", 0) or 0)
    dte = int(_get(rec, "dte", 0) or 0)
    passes_liquidity = bool(_get(rec, "passes_liquidity_filter", True))
    passes_rr = bool(_get(rec, "passes_rr_filter", True))
    price = float(_get(sig, "current_price", 0) or 0)
    net_credit = float(_get(rec, "net_credit", 0) or 0)
    edge_ratio = float(_get(rec, "edge_ratio", 0) or 0)
    trend = str(_get(sig, "trend", "") or "").lower()

    reasons: list[str] = []
    score = 0

    if strategy in ("Covered Call", "Covered Put"):
        # Stock-backed: lower risk baseline unless specific flags are present
        if not passes_liquidity:
            score += 2
            reasons.append("thin liquidity")
        if iv_rank >= 80:
            score += 3
            reasons.append("very high IV")
        elif iv_rank >= 60:
            score += 2
            reasons.append("elevated IV")
        if dte and dte < 14:
            score += 2
            reasons.append("short DTE")
        if dte and dte > 60:
            score += 1
            reasons.append("long DTE — more uncertainty")
        if not passes_rr:
            score += 1
            reasons.append("weak reward-to-risk")
        # Covered strategies: premium-based risk assessment
        premium_yield = (net_credit / price * 100) if price > 0 else 0
        if premium_yield < 0.5:
            score += 1
            reasons.append("low premium yield")
    elif strategy in ("Long Call", "Long Put"):
        # Directional premium buys: higher risk baseline
        score += 2
        reasons.append("premium decay risk")
        if iv_rank >= 60:
            score += 2
            reasons.append(f"IV elevated (rank {iv_rank:.0f}%)")
        if dte and dte < 14:
            score += 2
            reasons.append("short DTE — fast theta decay")
        if not passes_liquidity:
            score += 2
            reasons.append("poor liquidity")
        if not passes_rr:
            score += 1
            reasons.append("weak reward-to-risk")
        if "bear" in trend and strategy == "Long Call":
            score += 1
            reasons.append("counter-trend")
        if "bull" in trend and strategy == "Long Put":
            score += 1
            reasons.append("counter-trend")
    elif strategy in ("Bull Put Spread", "Bear Call Spread", "Iron Condor"):
        # Credit spreads: moderate baseline
        score += 1
        reasons.append("credit spread risk")
        if dte and dte < 10:
            score += 2
            reasons.append("short DTE — gamma risk")
        if not passes_liquidity:
            score += 1
            reasons.append("thin liquidity")
        credit_pct = float(_get(rec, "credit_pct_of_width", 0) or 0)
        if credit_pct < 10:
            score += 1
            reasons.append("small credit relative to width")
        if iv_rank < 30:
            score += 1
            reasons.append("low IV — thin premium")
        if edge_ratio < 0.05:
            score += 1
            reasons.append("marginal edge")
    elif strategy in ("Bull Call Spread", "Bear Put Spread"):
        # Debit spreads: moderate, tilted by IV
        if iv_rank >= 60:
            score += 2
            reasons.append(f"IV elevated (rank {iv_rank:.0f}%)")
        if dte and dte < 14:
            score += 2
            reasons.append("short DTE")
        if not passes_liquidity:
            score += 2
            reasons.append("poor liquidity")
        if edge_ratio < 0.05:
            score += 1
            reasons.append("marginal edge")
    elif strategy == "Long Straddle":
        score += 2
        reasons.append("long volatility — time decay")
        if iv_rank >= 70:
            score += 2
            reasons.append("expensive IV entry")
        if dte and dte < 14:
            score += 2
            reasons.append("very short DTE")
    else:
        # Fallback
        if iv_rank >= 70:
            score += 2
        if not passes_liquidity:
            score += 2
        if dte and dte < 10:
            score += 2

    # Common adjustments
    if dte and dte < 7:
        score += 1
        if "very short DTE" not in reasons and "short DTE" not in reasons:
            reasons.append("very short DTE — accelerated gamma")
    if edge_ratio <= 0:
        score += 2
        reasons.append("negative or zero edge")

    if score <= 2:
        label = "LOW"
    elif score <= 4:
        label = "MEDIUM"
    elif score <= 6:
        label = "HIGH"
    else:
        label = "EXTREME"

    risk_reason = "; ".join(reasons) if reasons else "Standard strategy risk."
    return label, risk_reason


# ---------------------------------------------------------------------------
# Confidence normalization
# ---------------------------------------------------------------------------

def normalize_confidence(
    raw_confidence: float,
    *,
    strategy: str = "",
    risk_label: str = "MEDIUM",
    passes_liquidity: bool = True,
    passes_rr: bool = True,
    trend_strong: bool = False,
    earnings_risk: bool = False,
    major_conflict: bool = False,
) -> int:
    """Compress raw confidence into a realistic 0–100 range.

    Rules:
    - 95-100 only if all critical checks pass (strong trend, liquidity OK, RR OK,
      no earnings risk, no major conflict, strategy-specific risk acceptable).
    - 85-94 strong setup.
    - 70-84 good.
    - 50-69 moderate.
    - Below 50 weak.
    """
    norm = float(raw_confidence)

    # Cap by risk label
    risk_caps = {"LOW": 100, "MEDIUM": 92, "HIGH": 84, "EXTREME": 78}
    norm = min(norm, risk_caps.get(risk_label.upper(), 100))

    # Penalty for missing checks
    if not passes_liquidity:
        norm = min(norm, 75)
    if not passes_rr:
        norm = min(norm, 70)
    if earnings_risk:
        norm = min(norm, 78)
    if major_conflict:
        norm = min(norm, 70)
    if not trend_strong:
        norm = min(norm, 88)

    # 95+ requires all checks
    if norm >= 95:
        all_ok = (
            passes_liquidity and passes_rr and trend_strong
            and not earnings_risk and not major_conflict
            and risk_label.upper() in ("LOW", "MEDIUM")
        )
        if not all_ok:
            norm = min(norm, 92)

    return max(0, min(100, round(norm)))


# ---------------------------------------------------------------------------
# Execution fields builder
# ---------------------------------------------------------------------------

def build_execution_fields(rec: Mapping[str, Any] | dict, signals: Mapping[str, Any] | dict | None = None) -> list[dict]:
    """Return a list of {label, value} dicts describing key execution parameters."""
    rec = dict(rec)
    sig = dict(signals) if signals else {}
    strategy = str(_get(rec, "strategy", "") or "")
    fields: list[dict] = []

    net_credit = _get(rec, "net_credit", None)
    max_profit = _get(rec, "max_profit", None)
    max_loss = _get(rec, "max_loss", None)
    spread_width = _get(rec, "spread_width", None)
    dte = _get(rec, "dte", None)
    be_lower = _get(rec, "breakeven_lower", None)
    be_upper = _get(rec, "breakeven_upper", None)

    if strategy in ("Bull Call Spread", "Bear Put Spread"):
        fields.append({"label": "Net Debit", "value": _fmt(net_credit)})
        fields.append({"label": "Breakeven", "value": _fmt(be_lower)})
        if max_profit:
            fields.append({"label": "Max Profit", "value": _fmt(max_profit)})
        if max_loss:
            fields.append({"label": "Max Loss", "value": _fmt(max_loss)})
    elif strategy in ("Bull Put Spread", "Bear Call Spread"):
        fields.append({"label": "Net Credit", "value": _fmt(net_credit)})
        fields.append({"label": "Breakeven", "value": _fmt(be_lower if strategy == "Bull Put Spread" else be_upper)})
        if max_profit:
            fields.append({"label": "Max Profit", "value": _fmt(max_profit)})
        if max_loss:
            fields.append({"label": "Max Loss", "value": _fmt(max_loss)})
        if spread_width:
            credit_pct = (net_credit / spread_width * 100) if spread_width > 0 else 0
            fields.append({"label": "Yield %", "value": f"{credit_pct:.0f}%"})
    elif strategy == "Iron Condor":
        fields.append({"label": "Net Credit", "value": _fmt(net_credit)})
        fields.append({"label": "Range", "value": f"{_fmt(be_lower)}–{_fmt(be_upper)}"})
        if max_loss:
            fields.append({"label": "Max Loss", "value": _fmt(max_loss)})
    elif strategy == "Covered Call":
        price = _get(sig, "current_price", 0)
        premium = net_credit or 0
        yield_pct = (premium / price * 100) if price > 0 else 0
        fields.append({"label": "Premium", "value": _fmt(premium)})
        fields.append({"label": "Yield", "value": f"{yield_pct:.1f}%"})
        if be_lower:
            fields.append({"label": "Effective Cost", "value": _fmt(be_lower)})
    elif strategy == "Covered Put":
        fields.append({"label": "Premium", "value": _fmt(net_credit)})
        if be_lower:
            fields.append({"label": "Effective Buy", "value": _fmt(be_lower)})
    elif strategy in ("Long Call", "Long Put"):
        fields.append({"label": "Premium", "value": _fmt(abs(net_credit or 0))})
        fields.append({"label": "Breakeven", "value": _fmt(be_lower or be_upper)})
        if max_profit and max_profit < 9999:
            fields.append({"label": "Max Profit Est", "value": _fmt(max_profit)})
    elif strategy == "Long Straddle":
        fields.append({"label": "Total Premium", "value": _fmt(abs(net_credit or 0))})
        if be_lower and be_upper:
            fields.append({"label": "Range", "value": f"{_fmt(be_lower)}–{_fmt(be_upper)}"})
    else:
        # Generic fallback
        if net_credit:
            fields.append({"label": "Net", "value": _fmt(net_credit)})
        if max_profit:
            fields.append({"label": "Max Profit", "value": _fmt(max_profit)})
        if max_loss:
            fields.append({"label": "Max Loss", "value": _fmt(max_loss)})

    if dte:
        fields.append({"label": "DTE", "value": str(dte)})

    return fields
