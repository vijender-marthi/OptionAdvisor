"""
tradedesk_routes.py — TradeDesk API
prefix: /desk
All routes require JWT auth via require_access_email.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Any, Optional

from auth_routes import require_access_email
from models import (
    WatchlistItem, WatchlistAddRequest,
    TradeLogCreate, TradeLogUpdate, TradeLogResponse,
    AlertCreate, AlertResponse, TradeStatsResponse,
    DayTradeResponse, SwingTradeResponse,
)
from storage import (
    desk_get_watchlist, desk_add_to_watchlist, desk_remove_from_watchlist,
    desk_create_trade, desk_update_trade, desk_get_trades, desk_get_open_trades,
    desk_delete_trade, desk_get_trade_stats,
    desk_create_alert, desk_get_alerts, desk_get_alert_history,
    desk_delete_alert, desk_fire_alert, desk_get_alert_count,
    normalize_email,
)
from day_trade import run_day_trade_scan
from swing_trade import run_swing_trade_scan
from decision_resolver import resolve_trade_decision
from ai_coach import get_ai_coach

import logging
log = logging.getLogger(__name__)

desk_router = APIRouter(prefix="/desk", tags=["tradedesk"])


# ── Watchlist ─────────────────────────────────────────────────────────────────

@desk_router.get("/watchlist")
def get_watchlist(auth_email: str = Depends(require_access_email)) -> list[dict[str, Any]]:
    return desk_get_watchlist(auth_email)


@desk_router.post("/watchlist")
def add_to_watchlist(
    body: WatchlistAddRequest,
    auth_email: str = Depends(require_access_email),
) -> dict[str, Any]:
    result = desk_add_to_watchlist(auth_email, body.ticker, body.trade_type)
    if not result:
        raise HTTPException(status_code=400, detail="Could not add ticker")
    return result


@desk_router.delete("/watchlist/{ticker}")
def remove_from_watchlist(
    ticker: str,
    trade_type: str = Query(default="day"),
    auth_email: str = Depends(require_access_email),
) -> dict[str, Any]:
    desk_remove_from_watchlist(auth_email, ticker, trade_type)
    return {"ok": True}


# ── Analysis ──────────────────────────────────────────────────────────────────

@desk_router.get("/analysis/{ticker}")
def get_analysis(
    ticker: str,
    trade_type: str = Query(default="day"),
    auth_email: str = Depends(require_access_email),
) -> dict[str, Any]:
    t = ticker.upper().strip()
    if not t or len(t) > 12:
        raise HTTPException(status_code=400, detail="Invalid ticker")
    tt = trade_type.lower().strip()

    try:
        if tt == "swing":
            r = run_swing_trade_scan(t)
            resolved = resolve_trade_decision({
                "engine_type": "swing",
                "ticker": r.ticker,
                "verdict": r.verdict,
                "bias": r.bias,
                "reasons": r.reasons,
                "metrics": r.metrics,
                "swing_bias": r.swing_bias,
                "entry_quality": r.entry_quality,
                "risk_level": r.risk_level,
            })
            _metrics = dict(r.metrics or {})
            _exec = dict(_metrics.get("exec_levels") or {})
            _last = _metrics.get("last_price")
            _exit_rules = list(_metrics.get("exit_rules") or [])
            _swing_eg = {
                "state": r.final_action or "",
                "action": r.decision_message or "",
                "summary": r.playbook_hint or "",
                "current_price": _last,
                "breakout_level": _exec.get("breakout"),
                "scalp_target": _exec.get("target1"),
                "scalp_target_2": _exec.get("target2"),
                "risk_below": _exec.get("stop"),
                "pullback_zone": _exec.get("pullbackZone"),
                "exit_rules": _exit_rules,
                "pending_confirmations": list(r.confirmation_needed or []),
            }
            _scan_dict = {
                "ticker": r.ticker,
                "bias": r.bias,
                "verdict": r.verdict,
                "confidence": resolved.confidence,
                "display_confidence": int(resolved.display_confidence or 0),
                "metrics": _metrics,
                "entry_guidance": _swing_eg,
            }
            try:
                ai_coach_result = get_ai_coach(_scan_dict, risk_state=resolved.risk_state or "MEDIUM")
            except Exception as exc:
                log.warning("AI coach error for %s: %s", t, exc)
                ai_coach_result = {}

            result = {
                "trade_type": "swing",
                "ticker": r.ticker,
                "company_name": r.company_name,
                "verdict": r.verdict,
                "bias": r.bias,
                "bull_score": r.bull_score,
                "bear_score": r.bear_score,
                "reasons": r.reasons,
                "metrics": _metrics,
                "swing_bias": r.swing_bias,
                "entry_quality": r.entry_quality,
                "risk_level": r.risk_level,
                "final_action": r.final_action,
                "trade_quality_score": r.trade_quality_score,
                "decision_label": r.decision_label,
                "decision_message": r.decision_message,
                "risk_flags": r.risk_flags,
                "confirmation_needed": r.confirmation_needed,
                "suggested_expiry_window": r.suggested_expiry_window,
                "suggested_strategy": r.suggested_strategy,
                "avoid_reason": r.avoid_reason,
                "playbook_hint": r.playbook_hint,
                "market_bias": resolved.market_bias,
                "setup_quality": resolved.setup_quality,
                "execution_readiness": resolved.execution_readiness,
                "final_decision": resolved.final_decision,
                "confidence": resolved.confidence,
                "reason": resolved.reason,
                "supporting_factors": resolved.supporting_factors,
                "missing_confirmations": resolved.missing_confirmations,
                "risk_state": resolved.risk_state,
                "signal_quality": resolved.signal_quality or "",
                "execution_timing": resolved.execution_timing or "",
                "risk_category": resolved.risk_category or "",
                "explanation": dict(resolved.explanation or {}),
                "risk_reason": resolved.risk_reason or "",
                "display_confidence": int(resolved.display_confidence or 0),
                "execution_fields": list(resolved.execution_fields or []),
                "entry_guidance": _swing_eg,
                "expected_holding_period": r.expected_holding_period,
                "recommended_contract_duration": r.recommended_contract_duration,
                "ai_coach": ai_coach_result,
            }
        else:
            # day (or regular — use day engine)
            r = run_day_trade_scan(t)
            resolved = resolve_trade_decision({
                "engine_type": "day",
                "ticker": r.ticker,
                "verdict": r.verdict,
                "bias": r.bias,
                "reasons": r.reasons,
                "metrics": r.metrics,
                "trader_decision": r.trader_decision,
            })
            _scan_dict = {
                "ticker": r.ticker,
                "bias": r.bias,
                "verdict": r.verdict,
                "confidence": resolved.confidence,
                "display_confidence": int(resolved.display_confidence or 0),
                "metrics": dict(r.metrics or {}),
                "entry_guidance": dict(r.entry_guidance or {}),
            }
            try:
                ai_coach_result = get_ai_coach(_scan_dict, risk_state=resolved.risk_state or "MEDIUM")
            except Exception as exc:
                log.warning("AI coach error for %s: %s", t, exc)
                ai_coach_result = {}
            result = {
                "trade_type": "day" if tt != "regular" else "regular",
                "ticker": r.ticker,
                "company_name": r.company_name,
                "verdict": r.verdict,
                "bias": r.bias,
                "bull_score": r.bull_score,
                "bear_score": r.bear_score,
                "reasons": r.reasons,
                "metrics": dict(r.metrics or {}),
                "trader_decision": dict(r.trader_decision or {}),
                "market_bias": resolved.market_bias,
                "setup_quality": resolved.setup_quality,
                "execution_readiness": resolved.execution_readiness,
                "final_decision": resolved.final_decision,
                "confidence": resolved.confidence,
                "reason": resolved.reason,
                "supporting_factors": resolved.supporting_factors,
                "missing_confirmations": resolved.missing_confirmations,
                "risk_state": resolved.risk_state,
                "signal_quality": resolved.signal_quality or "",
                "execution_timing": resolved.execution_timing or "",
                "risk_category": resolved.risk_category or "",
                "explanation": dict(resolved.explanation or {}),
                "risk_reason": resolved.risk_reason or "",
                "display_confidence": int(resolved.display_confidence or 0),
                "execution_fields": list(resolved.execution_fields or []),
                "entry_guidance": dict(r.entry_guidance or {}),
                "option_risk_context": dict(r.option_risk_context or {}),
                "ai_coach": ai_coach_result,
            }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e)) from None

    return result


# ── Trade Log ─────────────────────────────────────────────────────────────────

@desk_router.get("/trades")
def list_trades(
    trade_type: Optional[str] = Query(default=None),
    outcome: Optional[str] = Query(default=None),
    ticker: Optional[str] = Query(default=None),
    auth_email: str = Depends(require_access_email),
) -> list[dict[str, Any]]:
    filters: dict[str, Any] = {}
    if trade_type:
        filters["trade_type"] = trade_type
    if outcome:
        filters["outcome"] = outcome
    if ticker:
        filters["ticker"] = ticker
    return desk_get_trades(auth_email, filters)


@desk_router.get("/trades/open")
def list_open_trades(auth_email: str = Depends(require_access_email)) -> list[dict[str, Any]]:
    return desk_get_open_trades(auth_email)


@desk_router.get("/trades/stats")
def get_trade_stats(
    days: int = Query(default=30),
    auth_email: str = Depends(require_access_email),
) -> dict[str, Any]:
    return desk_get_trade_stats(auth_email, days=days)


@desk_router.post("/trades")
def create_trade(
    body: TradeLogCreate,
    auth_email: str = Depends(require_access_email),
) -> dict[str, Any]:
    return desk_create_trade(auth_email, body.model_dump())


@desk_router.patch("/trades/{trade_id}")
def update_trade(
    trade_id: str,
    body: TradeLogUpdate,
    auth_email: str = Depends(require_access_email),
) -> dict[str, Any]:
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    result = desk_update_trade(auth_email, trade_id, data)
    if result is None:
        raise HTTPException(status_code=404, detail="Trade not found")
    return result


@desk_router.delete("/trades/{trade_id}")
def delete_trade(
    trade_id: str,
    auth_email: str = Depends(require_access_email),
) -> dict[str, Any]:
    ok = desk_delete_trade(auth_email, trade_id)
    return {"ok": ok}


# ── Alerts ────────────────────────────────────────────────────────────────────

@desk_router.get("/alerts")
def list_alerts(
    active_only: bool = Query(default=True),
    auth_email: str = Depends(require_access_email),
) -> list[dict[str, Any]]:
    return desk_get_alerts(auth_email, active_only=active_only)


@desk_router.get("/alerts/history")
def alert_history(auth_email: str = Depends(require_access_email)) -> list[dict[str, Any]]:
    return desk_get_alert_history(auth_email)


@desk_router.get("/alerts/count")
def alert_count(auth_email: str = Depends(require_access_email)) -> dict[str, Any]:
    return {"count": desk_get_alert_count(auth_email)}


@desk_router.post("/alerts")
def create_alert(
    body: AlertCreate,
    auth_email: str = Depends(require_access_email),
) -> dict[str, Any]:
    return desk_create_alert(auth_email, body.model_dump())


@desk_router.patch("/alerts/{alert_id}")
def update_alert(
    alert_id: str,
    body: dict[str, Any],
    auth_email: str = Depends(require_access_email),
) -> dict[str, Any]:
    # Generic patch — only fire is a special action handled below
    result = desk_get_alert_count(auth_email)
    return {"ok": True, "count": result}


@desk_router.delete("/alerts/{alert_id}")
def delete_alert(
    alert_id: str,
    auth_email: str = Depends(require_access_email),
) -> dict[str, Any]:
    ok = desk_delete_alert(auth_email, alert_id)
    return {"ok": ok}


@desk_router.patch("/alerts/{alert_id}/fire")
def fire_alert(
    alert_id: str,
    fired_value: Optional[float] = Query(default=None),
    action_taken: str = Query(default=""),
    auth_email: str = Depends(require_access_email),
) -> dict[str, Any]:
    ok = desk_fire_alert(auth_email, alert_id, fired_value, action_taken)
    return {"ok": ok}
