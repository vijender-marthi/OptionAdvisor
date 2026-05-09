from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Iterable, Optional

from .alert_models import Alert


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _as_upper(raw: Any) -> str:
    return str(raw or "").strip().upper()


def _ticker(raw: Any) -> str:
    return str(raw or "").strip().upper()


def _float(raw: Any) -> Optional[float]:
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    return value


def _created_at(raw: Any) -> str:
    if isinstance(raw, str) and raw.strip():
        return raw
    if isinstance(raw, (int, float)):
        return datetime.fromtimestamp(float(raw) / 1000.0, tz=timezone.utc).isoformat()
    return _now_iso()


def _first_non_empty(*values: Any, fallback: str = "") -> str:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return fallback


def _build_alert(
    *,
    ticker: str,
    alert_type: str,
    engine_type: str,
    severity: str,
    signal: str,
    message: str,
    reason: str,
    recommended_action: str,
    related_trade_id: Optional[str] = None,
    related_watchlist_id: Optional[str] = None,
    status: str = "ACTIVE",
    created_at: Any = None,
    updated_at: Any = None,
    alert_id: Optional[str] = None,
) -> Alert:
    created = _created_at(created_at)
    updated = _created_at(updated_at) if updated_at else None
    aid = alert_id or f"alert-{uuid.uuid4().hex[:12]}"
    return Alert(
        id=aid,
        ticker=_ticker(ticker),
        alert_type=_as_upper(alert_type),
        engine_type=_as_upper(engine_type),
        severity=_as_upper(severity),
        signal=_as_upper(signal),
        message=message.strip(),
        reason=reason.strip(),
        recommended_action=recommended_action.strip(),
        related_trade_id=str(related_trade_id).strip() if related_trade_id else None,
        related_watchlist_id=str(related_watchlist_id).strip() if related_watchlist_id else None,
        status=_as_upper(status or "ACTIVE"),
        created_at=created,
        updated_at=updated,
    )


def _already_normalized(item: Any) -> Optional[Alert]:
    if isinstance(item, Alert):
        return item
    if not isinstance(item, dict):
        return None
    expected = {
        "id",
        "ticker",
        "alert_type",
        "engine_type",
        "severity",
        "signal",
        "message",
        "reason",
        "recommended_action",
        "status",
        "created_at",
    }
    if expected.issubset(set(item.keys())):
        return _build_alert(
            ticker=item.get("ticker"),
            alert_type=item.get("alert_type"),
            engine_type=item.get("engine_type"),
            severity=item.get("severity"),
            signal=item.get("signal"),
            message=item.get("message"),
            reason=item.get("reason"),
            recommended_action=item.get("recommended_action"),
            related_trade_id=item.get("related_trade_id"),
            related_watchlist_id=item.get("related_watchlist_id"),
            status=item.get("status") or "ACTIVE",
            created_at=item.get("created_at"),
            updated_at=item.get("updated_at"),
            alert_id=str(item.get("id") or ""),
        )
    return None


def normalize_day_trade_alert(engine_result: dict[str, Any]) -> Optional[Alert]:
    normalized = _already_normalized(engine_result)
    if normalized is not None:
        return normalized

    ticker = _ticker(engine_result.get("ticker"))
    if not ticker:
        return None
    verdict = _as_upper(engine_result.get("signal") or engine_result.get("verdict") or engine_result.get("decision"))
    reasons = engine_result.get("reasons")
    reason_text = " ".join(str(x).strip() for x in reasons if str(x).strip()) if isinstance(reasons, list) else ""
    explicit_type = _as_upper(engine_result.get("alert_type"))
    combined = " ".join(
        part for part in [
            explicit_type,
            verdict,
            str(engine_result.get("message") or ""),
            reason_text,
            str(engine_result.get("trader_decision") or ""),
        ] if part
    ).upper()

    alert_type = "DAY_WAIT"
    severity = "INFO"
    signal = "WAIT"
    action = "Wait for confirmation before taking a new intraday entry."
    if explicit_type in {"DAY_GO", "DAY_WAIT", "DAY_AVOID", "VWAP_LOST", "OR_BREAKOUT", "OR_FAILED", "MOMENTUM_FADE"}:
        alert_type = explicit_type
        severity = _as_upper(engine_result.get("severity") or severity)
        signal = _as_upper(engine_result.get("signal") or signal)
    elif "VWAP" in combined and any(token in combined for token in ("LOST", "LOSS", "REJECT", "FAILED")):
        alert_type = "VWAP_LOST"
        severity = "CRITICAL" if any(token in combined for token in ("EXIT", "LOST", "FAILED")) else "WARNING"
        signal = "EXIT" if severity == "CRITICAL" else "WAIT"
        action = "Exit failed longs or stand aside until price reclaims VWAP with volume."
    elif "OR FAILED" in combined or "OPENING RANGE FAILED" in combined:
        alert_type = "OR_FAILED"
        severity = "CRITICAL"
        signal = "EXIT"
        action = "Avoid fresh breakout entries and cut failed opening-range exposure."
    elif "OR BREAKOUT" in combined or "OPENING RANGE BREAKOUT" in combined:
        alert_type = "OR_BREAKOUT"
        severity = "INFO"
        signal = "GO"
        action = "Use the opening-range breakout only if volume and breadth stay supportive."
    elif "MOMENTUM FADE" in combined or "FADE" in combined:
        alert_type = "MOMENTUM_FADE"
        severity = "WARNING"
        signal = "WAIT"
        action = "Wait for momentum to rebuild before pressing size."
    elif verdict in ("AVOID", "NO-GO", "NOGO", "SKIP"):
        alert_type = "DAY_AVOID"
        severity = "CRITICAL"
        signal = "AVOID"
        action = "Do not force an intraday trade while the setup is invalid."
    elif verdict in ("GO", "STRONG GO"):
        alert_type = "DAY_GO"
        severity = "WARNING" if "RISK" in combined or "VOLAT" in combined else "INFO"
        signal = "GO"
        action = "Take entries only near the planned zone and keep intraday risk tight."

    message = _first_non_empty(
        engine_result.get("message"),
        engine_result.get("decision_message"),
        engine_result.get("trader_decision"),
        fallback=f"{ticker} day-trade setup update.",
    )
    reason = _first_non_empty(reason_text, str(engine_result.get("reason") or ""), fallback=message)
    return _build_alert(
        alert_id=engine_result.get("id"),
        ticker=ticker,
        alert_type=alert_type,
        engine_type="DAY",
        severity=severity,
        signal=signal,
        message=message,
        reason=reason,
        recommended_action=_first_non_empty(engine_result.get("recommended_action"), fallback=action),
        related_watchlist_id=engine_result.get("related_watchlist_id"),
        status=engine_result.get("status") or "ACTIVE",
        created_at=engine_result.get("created_at") or engine_result.get("detectedAt"),
        updated_at=engine_result.get("updated_at"),
    )


def normalize_swing_trade_alert(engine_result: dict[str, Any]) -> Optional[Alert]:
    normalized = _already_normalized(engine_result)
    if normalized is not None:
        return normalized

    ticker = _ticker(engine_result.get("ticker"))
    if not ticker:
        return None
    action_hint = _as_upper(
        engine_result.get("final_action")
        or engine_result.get("decision_label")
        or engine_result.get("signal")
        or engine_result.get("verdict")
    )
    reasons = engine_result.get("reasons")
    reason_text = " ".join(str(x).strip() for x in reasons if str(x).strip()) if isinstance(reasons, list) else ""
    risk_flags = engine_result.get("risk_flags")
    risk_text = " ".join(str(x).strip() for x in risk_flags if str(x).strip()) if isinstance(risk_flags, list) else ""
    explicit_type = _as_upper(engine_result.get("alert_type"))
    combined = " ".join(
        part for part in [
            explicit_type,
            action_hint,
            reason_text,
            risk_text,
            str(engine_result.get("decision_message") or ""),
            str(engine_result.get("avoid_reason") or ""),
        ] if part
    ).upper()

    alert_type = "SWING_WATCH"
    severity = "INFO"
    signal = "WATCH"
    action = "Track trend quality and only add if the setup confirms cleanly."
    if explicit_type in {
        "SWING_GO",
        "SWING_WATCH",
        "SWING_AVOID",
        "BREAKOUT_CONFIRMED",
        "TREND_WEAKENING",
        "RELATIVE_STRENGTH",
        "LATE_DAY_STRENGTH",
    }:
        alert_type = explicit_type
        severity = _as_upper(engine_result.get("severity") or severity)
        signal = _as_upper(engine_result.get("signal") or signal)
    elif "TREND_WEAKENING" in combined or "WEAKENING" in combined:
        alert_type = "TREND_WEAKENING"
        severity = "WARNING"
        signal = "WATCH"
        action = "Let the position breathe, but tighten your invalidation if relative strength fades further."
    elif "BREAKOUT_CONFIRMED" in combined or "BREAKOUT" in combined:
        alert_type = "BREAKOUT_CONFIRMED"
        severity = "INFO"
        signal = "GO"
        action = "Let the breakout work while it holds above the trigger zone."
    elif "RELATIVE_STRENGTH" in combined:
        alert_type = "RELATIVE_STRENGTH"
        severity = "INFO"
        signal = "WATCH"
        action = "Favor names showing relative strength, but wait for a clean add point."
    elif "LATE_DAY_STRENGTH" in combined:
        alert_type = "LATE_DAY_STRENGTH"
        severity = "INFO"
        signal = "WATCH"
        action = "Monitor the close for follow-through before adding new swing risk."
    elif action_hint in ("AVOID", "SKIP", "NO-GO", "NOGO"):
        alert_type = "SWING_AVOID"
        severity = "CRITICAL" if "RISK" in combined or "FAIL" in combined else "WARNING"
        signal = "AVOID"
        action = "Avoid new swing exposure until the structure improves."
    elif action_hint in ("GO", "BUY", "ENTER"):
        alert_type = "SWING_GO"
        severity = "INFO"
        signal = "GO"
        action = "Take the swing only if the breakout or pullback trigger stays intact."

    message = _first_non_empty(
        engine_result.get("message"),
        engine_result.get("decision_message"),
        fallback=f"{ticker} swing-trade setup update.",
    )
    reason = _first_non_empty(reason_text, risk_text, str(engine_result.get("avoid_reason") or ""), fallback=message)
    return _build_alert(
        alert_id=engine_result.get("id"),
        ticker=ticker,
        alert_type=alert_type,
        engine_type="SWING",
        severity=severity,
        signal=engine_result.get("signal") or signal,
        message=message,
        reason=reason,
        recommended_action=_first_non_empty(engine_result.get("recommended_action"), engine_result.get("playbook_hint"), fallback=action),
        related_watchlist_id=engine_result.get("related_watchlist_id"),
        status=engine_result.get("status") or "ACTIVE",
        created_at=engine_result.get("created_at"),
        updated_at=engine_result.get("updated_at"),
    )


def normalize_regular_trade_alert(engine_result: dict[str, Any]) -> Optional[Alert]:
    normalized = _already_normalized(engine_result)
    if normalized is not None:
        return normalized

    ticker = _ticker(engine_result.get("ticker"))
    if not ticker:
        return None
    action_hint = _as_upper(engine_result.get("signal") or engine_result.get("verdict") or engine_result.get("decision"))
    explicit_type = _as_upper(engine_result.get("alert_type"))
    combined = " ".join(
        part for part in [
            explicit_type,
            action_hint,
            str(engine_result.get("message") or ""),
            str(engine_result.get("reason") or ""),
            str(engine_result.get("recommended_action") or ""),
        ] if part
    ).upper()

    alert_type = "REGULAR_WATCH"
    severity = "INFO"
    signal = "WATCH"
    action = "Keep the setup on watch and wait for a better entry or better pricing."
    if explicit_type in {
        "REGULAR_TRADE",
        "REGULAR_WATCH",
        "REGULAR_SKIP",
        "HIGH_IV_WARNING",
        "EARNINGS_RISK",
        "EXPIRY_RISK",
        "CREDIT_SPREAD_TARGET",
        "OPTION_PREMIUM_RISK",
    }:
        alert_type = explicit_type
        severity = _as_upper(engine_result.get("severity") or severity)
        signal = _as_upper(engine_result.get("signal") or signal)
    elif "HIGH_IV" in combined or ("IV" in combined and "HIGH" in combined):
        alert_type = "HIGH_IV_WARNING"
        severity = "WARNING"
        signal = "SKIP"
        action = "Use smaller size, longer expiry, or a debit spread. Avoid oversized long calls."
    elif "EARNINGS" in combined:
        alert_type = "EARNINGS_RISK"
        severity = "WARNING"
        signal = "WAIT"
        action = "Avoid opening fresh option premium right into earnings unless it is explicitly planned."
    elif "EXPIRY" in combined:
        alert_type = "EXPIRY_RISK"
        severity = "WARNING"
        signal = "WAIT"
        action = "Use more time or close the idea if expiry risk is too tight."
    elif "CREDIT_SPREAD_TARGET" in combined:
        alert_type = "CREDIT_SPREAD_TARGET"
        severity = "INFO"
        signal = "WATCH"
        action = "Monitor for the target fill and keep risk defined."
    elif "OPTION_PREMIUM_RISK" in combined:
        alert_type = "OPTION_PREMIUM_RISK"
        severity = "WARNING"
        signal = "SKIP"
        action = "Avoid overpaying for premium unless the setup has clear momentum and time."
    elif action_hint in ("TRADE", "GO", "ENTER"):
        alert_type = "REGULAR_TRADE"
        severity = "INFO"
        signal = "GO"
        action = "Trade only with defined risk and the planned structure."
    elif action_hint in ("SKIP", "AVOID", "NO-GO", "NOGO"):
        alert_type = "REGULAR_SKIP"
        severity = "WARNING"
        signal = "SKIP"
        action = "Skip the setup until pricing, volatility, or risk improves."

    message = _first_non_empty(engine_result.get("message"), fallback=f"{ticker} regular-trade setup update.")
    reason = _first_non_empty(str(engine_result.get("reason") or ""), fallback=message)
    return _build_alert(
        alert_id=engine_result.get("id"),
        ticker=ticker,
        alert_type=alert_type,
        engine_type="REGULAR",
        severity=severity,
        signal=engine_result.get("signal") or signal,
        message=message,
        reason=reason,
        recommended_action=_first_non_empty(engine_result.get("recommended_action"), fallback=action),
        related_watchlist_id=engine_result.get("related_watchlist_id"),
        status=engine_result.get("status") or "ACTIVE",
        created_at=engine_result.get("created_at"),
        updated_at=engine_result.get("updated_at"),
    )


def normalize_portfolio_alert(position: dict[str, Any]) -> Optional[Alert]:
    normalized = _already_normalized(position)
    if normalized is not None:
        return normalized

    ticker = _ticker(position.get("ticker"))
    if not ticker:
        return None
    status = _as_upper(position.get("status") or "OPEN")
    if status == "CLOSED":
        return None

    pnl_pct = _float(position.get("pnlPct") or position.get("pnl_pct") or position.get("profit_pct"))
    dte = _float(position.get("dte"))
    trade_id = str(position.get("id") or "").strip() or None

    if pnl_pct is not None and pnl_pct <= -25:
        return _build_alert(
            alert_id=position.get("alert_id"),
            ticker=ticker,
            alert_type="STOP_LOSS_HIT",
            engine_type="PORTFOLIO",
            severity="CRITICAL",
            signal="EXIT",
            message=f"{ticker} is down {pnl_pct:.0f}% from the tracked entry.",
            reason="The open position has moved far enough against the plan that capital protection matters first.",
            recommended_action="Exit now or reduce risk immediately. Do not let a planned stop drift.",
            related_trade_id=trade_id,
            status=position.get("alert_status") or "ACTIVE",
            created_at=position.get("created_at"),
            updated_at=position.get("updated_at"),
        )
    if pnl_pct is not None and pnl_pct >= 100:
        return _build_alert(
            alert_id=position.get("alert_id"),
            ticker=ticker,
            alert_type="SCALE_OUT",
            engine_type="PORTFOLIO",
            severity="WARNING",
            signal="SCALE_OUT",
            message=f"{ticker} is up {pnl_pct:.0f}% and profits are worth protecting.",
            reason="The position has reached an oversized gain relative to normal swing targets.",
            recommended_action="Sell 50%, keep runner",
            related_trade_id=trade_id,
            status=position.get("alert_status") or "ACTIVE",
            created_at=position.get("created_at"),
            updated_at=position.get("updated_at"),
        )
    if pnl_pct is not None and pnl_pct >= 25:
        return _build_alert(
            alert_id=position.get("alert_id"),
            ticker=ticker,
            alert_type="PROTECT_PROFITS",
            engine_type="PORTFOLIO",
            severity="WARNING",
            signal="WATCH",
            message=f"{ticker} has open gains of {pnl_pct:.0f}%.",
            reason="The trade is working, but open profit is now meaningful enough to defend.",
            recommended_action="Protect profits with a tighter stop or a partial trim if momentum stalls.",
            related_trade_id=trade_id,
            status=position.get("alert_status") or "ACTIVE",
            created_at=position.get("created_at"),
            updated_at=position.get("updated_at"),
        )
    if dte is not None and dte <= 3:
        return _build_alert(
            alert_id=position.get("alert_id"),
            ticker=ticker,
            alert_type="NEAR_EXPIRY",
            engine_type="PORTFOLIO",
            severity="CRITICAL",
            signal="EXIT",
            message=f"{ticker} position expires in {int(dte)} day(s).",
            reason="Near-expiry positions can change rapidly and need an explicit exit or roll decision.",
            recommended_action="Close or roll now. Do not leave the position unmanaged into expiry.",
            related_trade_id=trade_id,
            status=position.get("alert_status") or "ACTIVE",
            created_at=position.get("created_at"),
            updated_at=position.get("updated_at"),
        )
    if dte is not None and dte <= 7:
        return _build_alert(
            alert_id=position.get("alert_id"),
            ticker=ticker,
            alert_type="NEAR_EXPIRY",
            engine_type="PORTFOLIO",
            severity="WARNING",
            signal="WATCH",
            message=f"{ticker} position expires in {int(dte)} day(s).",
            reason="Expiry is approaching, so the position needs an explicit exit or roll plan.",
            recommended_action="Review the position now and decide whether to close, trim, or roll.",
            related_trade_id=trade_id,
            status=position.get("alert_status") or "ACTIVE",
            created_at=position.get("created_at"),
            updated_at=position.get("updated_at"),
        )
    return None


def normalize_market_alert(market_signal: dict[str, Any]) -> Optional[Alert]:
    normalized = _already_normalized(market_signal)
    if normalized is not None:
        return normalized

    raw_type = _as_upper(market_signal.get("alert_type"))
    symbol = _ticker(market_signal.get("ticker") or market_signal.get("symbol"))
    if not raw_type and not symbol:
        return None

    alert_type = raw_type or "MARKET_REVERSAL"
    severity = _as_upper(market_signal.get("severity") or "WARNING")
    signal = _as_upper(market_signal.get("signal") or "WAIT")
    if alert_type == "VIX_SPIKE":
        severity = "CRITICAL" if _float(market_signal.get("vix")) and float(market_signal["vix"]) >= 30 else "WARNING"
        signal = "AVOID" if severity == "CRITICAL" else "WAIT"
    elif alert_type in ("QQQ_TREND_SHIFT", "SPY_TREND_SHIFT", "SECTOR_ROTATION"):
        severity = "WARNING"
        signal = "WATCH"
    elif alert_type == "MARKET_REVERSAL":
        severity = "CRITICAL"
        signal = "AVOID"

    label = symbol or alert_type.replace("_", " ")
    message = _first_non_empty(market_signal.get("message"), fallback=f"{label} market condition changed.")
    reason = _first_non_empty(str(market_signal.get("reason") or ""), fallback=message)
    recommended = _first_non_empty(
        market_signal.get("recommended_action"),
        fallback="Reduce size, tighten risk, and wait for the tape to stabilize before adding exposure.",
    )
    return _build_alert(
        alert_id=market_signal.get("id"),
        ticker=symbol,
        alert_type=alert_type,
        engine_type="MARKET",
        severity=severity,
        signal=signal,
        message=message,
        reason=reason,
        recommended_action=recommended,
        status=market_signal.get("status") or "ACTIVE",
        created_at=market_signal.get("created_at"),
        updated_at=market_signal.get("updated_at"),
    )


def _as_items(raw: Any) -> list[dict[str, Any]]:
    if raw is None:
        return []
    if isinstance(raw, dict):
        return [raw]
    if isinstance(raw, Iterable) and not isinstance(raw, (str, bytes)):
        return [item for item in raw if isinstance(item, dict)]
    return []


def normalize_alerts(
    day_results: Any,
    swing_results: Any,
    regular_results: Any,
    portfolio_positions: Any,
    market_summary: Any,
) -> list[Alert]:
    alerts: list[Alert] = []
    for item in _as_items(day_results):
        alert = normalize_day_trade_alert(item)
        if alert is not None:
            alerts.append(alert)
    for item in _as_items(swing_results):
        alert = normalize_swing_trade_alert(item)
        if alert is not None:
            alerts.append(alert)
    for item in _as_items(regular_results):
        alert = normalize_regular_trade_alert(item)
        if alert is not None:
            alerts.append(alert)
    for item in _as_items(portfolio_positions):
        alert = normalize_portfolio_alert(item)
        if alert is not None:
            alerts.append(alert)
    for item in _as_items(market_summary):
        alert = normalize_market_alert(item)
        if alert is not None:
            alerts.append(alert)
    alerts.sort(key=lambda alert: alert.created_at, reverse=True)
    return alerts
