"""
Transition-based alert evaluation service.

Core rule: alerts fire on STATE TRANSITIONS, not conditions.
A condition alert says "RVOL is 3x." A transition alert says "RVOL just crossed 3x."
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Any, Optional
from zoneinfo import ZoneInfo

import storage

log = logging.getLogger(__name__)

ET = ZoneInfo("America/New_York")
PT = ZoneInfo("America/Los_Angeles")

# ── Cooldown periods ─────────────────────────────────────────────────────────
_COOLDOWN: dict[str, timedelta] = {
    "day":     timedelta(hours=4),
    "swing":   timedelta(hours=20),
    "regular": timedelta(days=3),
}

# ── Max fires per ticker per day (or week for regular) ───────────────────────
_MAX_DAILY: dict[str, int] = {
    "day":     3,
    "swing":   1,
    "regular": 1,   # checked against a rolling 7-day window in practice
}


# ── Market-hours helpers ─────────────────────────────────────────────────────

def _now_et() -> datetime:
    return datetime.now(ET)


def _is_market_hours(now: Optional[datetime] = None) -> bool:
    now = now or _now_et()
    if now.weekday() >= 5:
        return False
    t = now.time()
    from datetime import time
    return time(9, 30) <= t <= time(16, 0)


def _is_day_trade_window(now: Optional[datetime] = None) -> bool:
    """9:30–15:30 ET — no alerts in last 30 min of session."""
    now = now or _now_et()
    if now.weekday() >= 5:
        return False
    t = now.time()
    from datetime import time
    return time(9, 30) <= t <= time(15, 30)


def _is_midday_lull(now: Optional[datetime] = None) -> bool:
    """11:30–13:00 ET — optional mute period."""
    now = now or _now_et()
    t = now.time()
    from datetime import time
    return time(11, 30) <= t <= time(13, 0)


def _morning_window(now: Optional[datetime] = None) -> bool:
    """9:00–10:00 ET — swing/regular alerts fire here."""
    now = now or _now_et()
    if now.weekday() >= 5:
        return False
    t = now.time()
    from datetime import time
    return time(9, 0) <= t <= time(10, 0)


# ── Dedup / gating logic ─────────────────────────────────────────────────────

def should_fire_alert(alert: dict[str, Any], current_value: str, now: Optional[datetime] = None) -> bool:
    """
    Returns True only if the alert should fire for this evaluation cycle.

    Rules (in order):
      1. State unchanged — same as last fired value → no fire
      2. Cooldown period not elapsed since last fire
      3. Daily cap reached for this ticker+trade_type
      4. Market-hours gate for day-trade alerts
    """
    now = now or _now_et()
    trade_type = (alert.get("trade_type") or "day").lower()
    today = now.date().isoformat()

    # Rule 1: no transition — value same as when we last fired
    last_fired_value = alert.get("fired_value")
    if last_fired_value is not None and str(last_fired_value) == current_value:
        return False

    # Also gate on last_check_value to avoid re-firing after a check that
    # didn't fire (so we only fire once per actual state change).
    last_check = alert.get("last_check_value")
    if last_check is not None and last_check == current_value:
        return False

    # Rule 2: cooldown
    fired_at_str = alert.get("fired_at")
    if fired_at_str:
        try:
            fired_at = datetime.fromisoformat(fired_at_str)
            if fired_at.tzinfo is None:
                fired_at = fired_at.replace(tzinfo=ET)
            elapsed = now - fired_at
            cooldown = _COOLDOWN.get(trade_type, timedelta(hours=4))
            if elapsed < cooldown:
                return False
        except ValueError:
            pass

    # Rule 3: daily cap
    daily_fires = storage.desk_count_daily_fires(
        alert["user_id"], alert["ticker"], trade_type, today
    )
    if daily_fires >= _MAX_DAILY.get(trade_type, 1):
        return False

    # Rule 4: market-hours gate
    if trade_type == "day":
        if not _is_day_trade_window(now):
            return False
        # Non-verdict-change alerts muted during midday lull
        if _is_midday_lull(now) and alert.get("alert_type") != "VERDICT_CHANGE":
            return False
    else:
        # Swing / regular only fire in the morning review window
        if not _morning_window(now):
            return False

    return True


# ── Value extractors per alert type ─────────────────────────────────────────

def _extract_current_value(alert: dict[str, Any], scan_result: dict[str, Any]) -> Optional[tuple[str, float | None]]:
    """
    Returns (check_value_str, numeric_fired_value) for the alert type,
    or None if the signal cannot be read from scan_result.
    """
    atype = (alert.get("alert_type") or "").upper()
    metrics: dict[str, Any] = scan_result.get("metrics") or {}

    if atype == "RVOL":
        rvol = metrics.get("rvol")
        if rvol is None:
            return None
        threshold = alert.get("threshold_value") or 0
        crossed = "ABOVE" if float(rvol) >= float(threshold) else "BELOW"
        return crossed, float(rvol)

    if atype == "PRICE_CROSS":
        price = scan_result.get("price") or metrics.get("price")
        if price is None:
            return None
        threshold = alert.get("threshold_value") or 0
        side = "ABOVE" if float(price) >= float(threshold) else "BELOW"
        return side, float(price)

    if atype == "VWAP_RETEST":
        vwap = metrics.get("vwap")
        price = scan_result.get("price") or metrics.get("price")
        if vwap is None or price is None:
            return None
        rel = abs(float(price) - float(vwap)) / float(vwap)
        touching = "TOUCHING" if rel < 0.002 else "AWAY"
        return touching, float(price)

    if atype in ("VERDICT_CHANGE", "SIGNAL_ENTER"):
        verdict = (scan_result.get("final_decision") or "").upper()
        return verdict, None

    if atype == "OR_BREAK":
        orh = metrics.get("or_high")
        orl = metrics.get("or_low")
        price = scan_result.get("price") or metrics.get("price")
        if orh is None or price is None:
            return None
        if float(price) > float(orh):
            return "ABOVE_ORH", float(price)
        if orl is not None and float(price) < float(orl):
            return "BELOW_ORL", float(price)
        return "INSIDE_OR", float(price)

    if atype == "SCORE_CROSS":
        score = scan_result.get("score") or metrics.get("score")
        if score is None:
            return None
        threshold = alert.get("threshold_value") or 70
        side = "ABOVE" if float(score) >= float(threshold) else "BELOW"
        return side, float(score)

    if atype == "MA_PROXIMITY":
        ma20 = metrics.get("ma20")
        price = scan_result.get("price") or metrics.get("price")
        if ma20 is None or price is None:
            return None
        rel = abs(float(price) - float(ma20)) / float(ma20)
        near = "NEAR" if rel < 0.01 else "AWAY"
        return near, float(price)

    # EARNINGS_WARNING, DTE_STOP, PROFIT_TARGET — specialized; caller handles
    return None


# ── Alert message builder ────────────────────────────────────────────────────

def _build_message(alert: dict[str, Any], current_value: str, fired_value: Optional[float]) -> str:
    ticker = alert.get("ticker", "?").upper()
    atype = (alert.get("alert_type") or "").upper()
    trade_type = (alert.get("trade_type") or "day").lower()

    if atype == "RVOL":
        return f"{ticker} RVOL crossed {alert.get('threshold_value', '?')}× — now {fired_value:.1f}×" if fired_value else f"{ticker} RVOL threshold crossed"
    if atype == "PRICE_CROSS":
        lvl = alert.get("threshold_value", "?")
        return f"{ticker} crossed ${lvl} — now ${fired_value:.2f}" if fired_value else f"{ticker} price level crossed"
    if atype == "VWAP_RETEST" and current_value == "TOUCHING":
        return f"{ticker} is retesting VWAP — ${fired_value:.2f}" if fired_value else f"{ticker} VWAP retest"
    if atype in ("VERDICT_CHANGE", "SIGNAL_ENTER"):
        return f"{ticker} verdict changed → {current_value}"
    if atype == "OR_BREAK":
        if current_value == "ABOVE_ORH":
            return f"{ticker} broke above Opening Range High — ${fired_value:.2f}" if fired_value else f"{ticker} broke OR High"
        if current_value == "BELOW_ORL":
            return f"{ticker} broke below Opening Range Low — ${fired_value:.2f}" if fired_value else f"{ticker} broke OR Low"
    if atype == "SCORE_CROSS":
        thr = alert.get("threshold_value", 70)
        return f"{ticker} {trade_type} score crossed {thr} — now {fired_value:.0f}" if fired_value else f"{ticker} score threshold crossed"
    if atype == "MA_PROXIMITY":
        return f"{ticker} approaching MA20 — ${fired_value:.2f}" if fired_value else f"{ticker} near MA20"
    return f"{ticker} alert: {atype}"


# ── Main evaluation entry point ──────────────────────────────────────────────

def _severity_for_alert(alert: dict[str, Any], current_value: str) -> str:
    atype = (alert.get("alert_type") or "").upper()
    if atype in ("VERDICT_CHANGE", "SIGNAL_ENTER") and current_value in ("GO", "ENTER", "STRONG GO"):
        return "CRITICAL"
    if atype in ("OR_BREAK", "RVOL", "SCORE_CROSS"):
        return "WARNING"
    return "INFO"


def _engine_for_trade_type(trade_type: str) -> str:
    return {"day": "DAY_TRADE", "swing": "SWING_TRADE", "regular": "REGULAR_TRADE"}.get(trade_type.lower(), "GENERAL")


def evaluate_alert(alert: dict[str, Any], scan_result: dict[str, Any]) -> bool:
    """
    Evaluate one alert against a fresh scan result.
    Returns True if the alert fired.
    """
    extracted = _extract_current_value(alert, scan_result)
    if extracted is None:
        return False
    current_value, fired_value = extracted

    # Always record the check (even if we don't fire)
    storage.desk_record_check(alert["user_id"], alert["id"], current_value)

    if not should_fire_alert(alert, current_value):
        return False

    message = _build_message(alert, current_value, fired_value)
    trade_type = (alert.get("trade_type") or "day").lower()

    fired = storage.desk_fire_alert_transition(
        user_id=alert["user_id"],
        alert_id=alert["id"],
        fired_value=fired_value,
        check_value=current_value,
        action_taken=message,
    )
    if not fired:
        return False

    # Mirror into alert_center_items so the unified inbox shows it
    try:
        storage.alert_center_create(
            alert["user_id"],
            alert_group=f"{trade_type}-alert",
            severity=_severity_for_alert(alert, current_value),
            engine=_engine_for_trade_type(trade_type),
            signal=current_value,
            title=message,
            body=f"Alert rule fired for {alert.get('ticker', '?').upper()} · {alert.get('alert_type', '')}",
            meta={
                "desk_alert_id": alert["id"],
                "fired_value": fired_value,
                "alert_type": alert.get("alert_type"),
                "ticker": alert.get("ticker", "").upper(),
                "trade_type": trade_type,
            },
        )
    except Exception:
        log.exception("Failed to mirror alert %s into alert_center_items", alert.get("id"))

    log.info("Alert fired: %s / %s → %s", alert["ticker"], alert["alert_type"], current_value)
    return True


def evaluate_user_alerts(user_id: str, ticker: str, scan_result: dict[str, Any]) -> list[dict[str, Any]]:
    """
    Evaluate all active alerts for a user+ticker against a scan result.
    Returns the list of alerts that fired.
    """
    alerts = storage.desk_get_alerts(user_id, active_only=True)
    ticker_upper = ticker.upper()
    fired: list[dict[str, Any]] = []
    for alert in alerts:
        if alert.get("ticker", "").upper() != ticker_upper:
            continue
        try:
            if evaluate_alert(alert, scan_result):
                fired.append(alert)
        except Exception:
            log.exception("Error evaluating alert %s", alert.get("id"))
    return fired
