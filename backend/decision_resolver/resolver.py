from __future__ import annotations

from typing import Any, Mapping

from .decision_models import ResolvedTradeDecision


def _get(mapping: Mapping[str, Any] | Any, key: str, default: Any = None) -> Any:
    if isinstance(mapping, Mapping):
        return mapping.get(key, default)
    return getattr(mapping, key, default)


def _to_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, Mapping):
        return dict(value)
    if hasattr(value, "model_dump"):
        return value.model_dump()
    if hasattr(value, "dict"):
        return value.dict()
    return {}


def _as_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(x).strip() for x in value if str(x).strip()]
    if isinstance(value, tuple):
        return [str(x).strip() for x in value if str(x).strip()]
    if value in (None, ""):
        return []
    return [str(value).strip()]


def _clamp_confidence(value: int | float) -> int:
    try:
        n = int(round(float(value)))
    except (TypeError, ValueError):
        return 0
    return max(0, min(100, n))


def _market_bias_from_text(*values: Any) -> str:
    joined = " ".join(str(v or "").upper() for v in values)
    if "STRONG_BULLISH" in joined or "BULLISH" in joined or "SUPPORTIVE" in joined:
        return "BULLISH"
    if "STRONG_BEARISH" in joined or "BEARISH" in joined or "WEAK" in joined or "RISK_OFF" in joined:
        return "BEARISH"
    if "MIXED" in joined:
        return "MIXED"
    return "NEUTRAL"


def _risk_state_from_text(*values: Any) -> str:
    joined = " ".join(str(v or "").upper() for v in values)
    if "VERY_HIGH" in joined or "EXTREME" in joined:
        return "EXTREME"
    if "HIGH" in joined or "AVOID" in joined:
        return "HIGH"
    if "LOW" in joined:
        return "LOW"
    return "MEDIUM"


def _humanize_confirmation(item: str) -> str:
    raw = str(item or "").strip()
    if not raw:
        return ""
    lowered = raw.lower()
    if "break intraday high" in lowered or "breakout" in lowered:
        return "Breakout confirmation"
    if "above vwap" in lowered or "vwap hold" in lowered:
        return "VWAP hold"
    if "volume" in lowered:
        return "Volume confirmation"
    if "pullback" in lowered:
        return "Controlled pullback hold"
    if "break day low" in lowered or "lower-low" in lowered or "failed bounce" in lowered:
        return "Fresh breakdown confirmation"
    return raw[:1].upper() + raw[1:]


def _pick_reason(
    *,
    explicit_reason: str | None = None,
    message: str | None = None,
    missing_confirmations: list[str] | None = None,
    fallback: str,
) -> str:
    if explicit_reason:
        text = explicit_reason.strip()
        if text:
            return text
    if message:
        text = message.strip()
        if text:
            return text
    confirmations = [x for x in (missing_confirmations or []) if x]
    if confirmations:
        first = confirmations[0].lower()
        if "breakout" in first or "intraday high" in first:
            return "No breakout confirmation yet."
        if "vwap" in first:
            return "Price still needs to prove itself around VWAP."
        if "breakdown" in first or "day low" in first:
            return "Breakdown confirmation is still missing."
        return f"Still waiting on {confirmations[0].lower()}."
    return fallback


def _resolve_day_trade(engine_analysis: Mapping[str, Any]) -> ResolvedTradeDecision:
    verdict = str(_get(engine_analysis, "verdict", "")).upper()
    bias = str(_get(engine_analysis, "bias", "") or "").lower()
    metrics = _to_dict(_get(engine_analysis, "metrics", {}))
    trader_decision = _to_dict(_get(engine_analysis, "trader_decision", {}))
    confidence_block = _to_dict(metrics.get("confidence"))
    missing = [_humanize_confirmation(x) for x in _as_list(trader_decision.get("confirmation_needed"))]
    missing = [x for x in missing if x]

    market_bias = _market_bias_from_text(
        trader_decision.get("market_state"),
        "BULLISH" if bias == "long" else "BEARISH" if bias == "short" else "",
    )
    if market_bias == "NEUTRAL" and bias == "long":
        market_bias = "BULLISH"
    elif market_bias == "NEUTRAL" and bias == "short":
        market_bias = "BEARISH"

    breakout_quality = str(confidence_block.get("breakout_quality", "")).upper()
    volume_confirmation = str(confidence_block.get("volume_confirmation", "")).upper()
    trend_strength = str(confidence_block.get("trend_strength", "")).upper()
    risk_state = _risk_state_from_text(confidence_block.get("risk"), metrics.get("vix"))

    if verdict == "NO-GO":
        setup_quality = "POOR"
    elif verdict == "WAIT":
        setup_quality = "WEAK"
    elif breakout_quality == "GOOD" and volume_confirmation == "STRONG" and trend_strength == "HIGH":
        setup_quality = "STRONG"
    elif breakout_quality == "GOOD" or trend_strength in {"HIGH", "MEDIUM"}:
        setup_quality = "GOOD"
    elif verdict == "WATCH":
        setup_quality = "FAIR"
    else:
        setup_quality = "WEAK"

    suggested_action = str(trader_decision.get("suggested_action", "")).upper()
    if verdict == "NO-GO":
        execution = "AVOID"
        final_decision = "AVOID"
    elif verdict == "WAIT":
        execution = "WAIT"
        final_decision = "WAIT"
    elif suggested_action in {"AVOID_CALLS", "AVOID_CHASING_PUTS"}:
        execution = "AVOID"
        final_decision = "AVOID"
    elif verdict in {"STRONG GO", "GO"} and breakout_quality == "GOOD" and volume_confirmation == "STRONG":
        execution = "READY"
        final_decision = "READY"
    elif verdict == "WATCH":
        execution = "WATCH"
        final_decision = "WATCH"
    else:
        execution = "WAIT"
        final_decision = "WAIT"

    confidence = 0
    confidence += 28 if trend_strength == "HIGH" else 18 if trend_strength == "MEDIUM" else 8
    confidence += 26 if breakout_quality == "GOOD" else 14 if breakout_quality == "FAIR" else 6
    confidence += 18 if volume_confirmation == "STRONG" else 8
    confidence += 16 if market_bias in {"BULLISH", "BEARISH"} else 10 if market_bias == "MIXED" else 6
    confidence += 10 if risk_state == "LOW" else 6 if risk_state == "MEDIUM" else 2

    reasons = _as_list(_get(engine_analysis, "reasons"))
    supporting = reasons[:4]

    return ResolvedTradeDecision(
        market_bias=market_bias,
        setup_quality=setup_quality,
        execution_readiness=execution,
        final_decision=final_decision,
        confidence=_clamp_confidence(confidence),
        reason=_pick_reason(
            explicit_reason=None,
            message=str(trader_decision.get("decision_message", "") or ""),
            missing_confirmations=missing,
            fallback="No clean intraday trigger yet.",
        ),
        supporting_factors=supporting,
        missing_confirmations=missing,
        risk_state=risk_state,
    )


def _resolve_swing_trade(engine_analysis: Mapping[str, Any]) -> ResolvedTradeDecision:
    swing_bias = str(_get(engine_analysis, "swing_bias", "") or "")
    entry_quality = str(_get(engine_analysis, "entry_quality", "") or "")
    final_action = str(_get(engine_analysis, "final_action", "") or "")
    trade_quality_score = float(_get(engine_analysis, "trade_quality_score", 0.0) or 0.0)
    risk_level = str(_get(engine_analysis, "risk_level", "") or "")
    decision_message = str(_get(engine_analysis, "decision_message", "") or "")
    avoid_reason = str(_get(engine_analysis, "avoid_reason", "") or "")
    missing = [_humanize_confirmation(x) for x in _as_list(_get(engine_analysis, "confirmation_needed"))]
    missing = [x for x in missing if x]
    reasons = _as_list(_get(engine_analysis, "reasons"))

    market_bias = _market_bias_from_text(
        swing_bias,
        _to_dict(_get(engine_analysis, "metrics", {})).get("spy_bias"),
        _to_dict(_get(engine_analysis, "metrics", {})).get("qqq_bias"),
    )
    risk_state = _risk_state_from_text(risk_level)

    entry_upper = entry_quality.upper()
    if trade_quality_score >= 8.5 and "GOOD" in entry_upper:
        setup_quality = "STRONG"
    elif trade_quality_score >= 7 or "GOOD" in entry_upper:
        setup_quality = "GOOD"
    elif trade_quality_score >= 5 or "WAIT" in entry_upper:
        setup_quality = "FAIR"
    elif "NO_CLEAN_ENTRY" in entry_upper:
        setup_quality = "WEAK"
    else:
        setup_quality = "POOR"

    action_upper = final_action.upper()
    if action_upper in {"STRONG_GO", "QUALITY_LONG"}:
        execution = "READY"
        final_decision = "READY"
    elif action_upper in {"WATCH_CALL_OR_DEBIT_SPREAD", "WATCH_CALL", "WATCH_PUT", "GO_SMALL"}:
        execution = "WATCH"
        final_decision = "WATCH"
    elif action_upper.startswith("WAIT") or action_upper in {"MARKET_CONFIRMATION_ONLY", "NO_TRADE_WAIT"}:
        execution = "WAIT"
        final_decision = "WAIT"
    elif action_upper.startswith("AVOID") or action_upper == "NO_TRADE":
        execution = "AVOID" if market_bias != "NEUTRAL" else "NO_EDGE"
        final_decision = execution
    else:
        execution = "WAIT"
        final_decision = "WAIT"

    if final_decision == "READY" and risk_state in {"HIGH", "EXTREME"}:
        final_decision = "WATCH"
        execution = "WATCH"

    return ResolvedTradeDecision(
        market_bias=market_bias,
        setup_quality=setup_quality,
        execution_readiness=execution,
        final_decision=final_decision,
        confidence=_clamp_confidence((trade_quality_score / 10.0) * 100.0),
        reason=_pick_reason(
            explicit_reason=avoid_reason or None,
            message=decision_message,
            missing_confirmations=missing,
            fallback="Trend exists, but the entry still needs work.",
        ),
        supporting_factors=reasons[:4],
        missing_confirmations=missing,
        risk_state=risk_state,
    )


def _resolve_regular_trade(engine_analysis: Mapping[str, Any]) -> ResolvedTradeDecision:
    signals = _get(engine_analysis, "signals")
    sig = _to_dict(signals)
    recommendations = _get(engine_analysis, "recommendations", []) or []
    rec = recommendations[0] if recommendations else None
    rec_map = _to_dict(rec)

    market_bias = _market_bias_from_text(sig.get("directional_bias"), sig.get("trend"))
    if sig.get("directional_bias") is None and str(sig.get("trend", "")).lower() == "sideways":
        market_bias = "NEUTRAL"

    if not rec_map:
        return ResolvedTradeDecision(
            market_bias=market_bias,
            setup_quality="WEAK",
            execution_readiness="NO_EDGE",
            final_decision="NO_EDGE",
            confidence=20,
            reason="No option structure passed the current filters.",
            supporting_factors=[],
            missing_confirmations=["A higher-quality options structure"],
            risk_state=_risk_state_from_text(sig.get("iv_environment"), sig.get("volatility_regime")),
        )

    iv_rank = float(sig.get("iv_rank", 0.0) or 0.0)
    expected_value = float(rec_map.get("expected_value", 0.0) or 0.0)
    edge_ratio = float(rec_map.get("edge_ratio", 0.0) or 0.0)
    total_score = float(_to_dict(rec_map.get("scores")).get("total_score", 0.0) or 0.0)
    dte = int(rec_map.get("dte", 0) or 0)
    passes_liquidity = bool(rec_map.get("passes_liquidity_filter"))
    passes_rr = bool(rec_map.get("passes_rr_filter"))
    warnings = _as_list(rec_map.get("warnings"))
    is_debit = float(rec_map.get("net_credit", 0.0) or 0.0) <= 0
    high_iv_warning = is_debit and iv_rank >= 60
    risk_state = _risk_state_from_text(
        "EXTREME" if iv_rank >= 85 else "HIGH" if iv_rank >= 70 else "MEDIUM",
        sig.get("iv_environment"),
        sig.get("volatility_regime"),
    )

    if total_score >= 26 and edge_ratio >= 0.08:
        setup_quality = "STRONG"
    elif total_score >= 20 and edge_ratio >= 0.05:
        setup_quality = "GOOD"
    elif total_score >= 14 and expected_value > 0:
        setup_quality = "FAIR"
    elif expected_value > 0:
        setup_quality = "WEAK"
    else:
        setup_quality = "POOR"

    missing: list[str] = []
    if not passes_liquidity:
        missing.append("Cleaner liquidity")
    if dte and dte < 14:
        missing.append("More time to expiry")
    if high_iv_warning:
        missing.append("Cheaper implied volatility")
    if not passes_rr:
        missing.append("Better reward-to-risk structure")
    if edge_ratio < 0.05:
        missing.append("Stronger expected edge")

    if high_iv_warning:
        execution = "AVOID"
        final_decision = "AVOID"
        reason = "Option IV is elevated for this directional buy."
    elif not passes_liquidity:
        execution = "AVOID"
        final_decision = "AVOID"
        reason = "Liquidity is too thin for a clean options entry."
    elif expected_value <= 0:
        execution = "NO_EDGE"
        final_decision = "NO_EDGE"
        reason = "Expected value is not favorable yet."
    elif dte and dte < 14:
        execution = "WAIT"
        final_decision = "WAIT"
        reason = "The setup needs more time to expiry."
    elif setup_quality in {"STRONG", "GOOD"} and edge_ratio >= 0.05 and passes_rr:
        execution = "READY"
        final_decision = "READY"
        reason = "Structure, edge, and trend are aligned for a defined-risk trade."
    else:
        execution = "WAIT"
        final_decision = "WAIT"
        reason = "Bias exists, but pricing or structure still needs improvement."

    supporting = [f"{rec_map.get('strategy', 'Strategy')} · {rec_map.get('bias', 'Bias')}"]
    supporting.extend(warnings[:3])

    bias_conf = float(sig.get("bias_confidence", 0.0) or 0.0)
    bias_conf_pct = bias_conf * 100.0 if bias_conf <= 1.0 else bias_conf
    confidence = (total_score / 30.0) * 70.0 + min(30.0, max(0.0, bias_conf_pct * 0.3))

    return ResolvedTradeDecision(
        market_bias=market_bias,
        setup_quality=setup_quality,
        execution_readiness=execution,
        final_decision=final_decision,
        confidence=_clamp_confidence(confidence),
        reason=reason,
        supporting_factors=supporting,
        missing_confirmations=missing,
        risk_state=risk_state,
    )


def resolve_trade_decision(engine_analysis: Mapping[str, Any] | Any) -> ResolvedTradeDecision:
    data = _to_dict(engine_analysis)
    if not data and isinstance(engine_analysis, Mapping):
        data = dict(engine_analysis)
    engine_type = str(data.get("engine_type", "")).strip().lower()
    if engine_type == "day" or "trader_decision" in data:
        return _resolve_day_trade(data)
    if engine_type == "swing" or "swing_bias" in data or "final_action" in data:
        return _resolve_swing_trade(data)
    return _resolve_regular_trade(data)
