"""
Trade Command Center API — live engine aggregation + alert-center persistence.

The /trade-command-center endpoint now calls trade_aggregator.build_command_center_payload()
which runs day_trade / swing_trade / regular engine for every ticker on the user's watchlist
(with a 90-second in-process cache during market hours) and aggregates the resolver outputs
into engine cards, recommendations, conflicts, and charts.

The old _trade_command_center_stub() has been quarantined at the bottom of this file for
reference but is no longer called by any endpoint.
"""
from __future__ import annotations

import logging
import math
import time
import uuid
from datetime import date, datetime, timezone, timedelta
from typing import Any, Optional

log = logging.getLogger(__name__)

import pandas as pd

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from alerts.alert_service import build_alert_center_payload
from auth_routes import require_access_email
import bar_cache
import yfinance as yf
from storage import (
    alert_center_acknowledge,
    alert_center_active_count,
    alert_center_append_note,
    alert_center_critical_count,
    alert_center_list,
    alert_center_resolve,
    alert_center_resolve_all,
    alert_center_resolve_by_ticker,
    ensure_demo_alert_center_rows,
    get_alert_center_summary,
    get_journal_entries,
    get_user_state,
    LEGACY_USER_ALERT_RETENTION_MS,
    normalize_email,
    prune_alert_center_items,
    save_journal_entry,
    save_user_state,
    sync_user_alerts_to_alert_center,
    track_mode_add,
    track_mode_list,
    track_mode_remove,
    update_journal_entry,
)
from trade_aggregator import build_command_center_payload
from position_analyzer import analyze_active_position
from stock_decision_engine import analyze_stock_position

command_center_router = APIRouter(tags=["command-center"])


def api_envelope(
    data: Any,
    *,
    error: Optional[dict[str, str]] = None,
    stale: bool = False,
) -> dict[str, Any]:
    return {
        "data": data,
        "error": error,
        "stale": stale,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


# ── STUB REMOVED ─────────────────────────────────────────────────────────────
# _trade_command_center_stub() served hardcoded NVDA/TSLA/MSFT/AVGO data.
# Replaced by trade_aggregator.build_command_center_payload() below.
# See git history for the original body.
# ─────────────────────────────────────────────────────────────────────────────


def _fetch_live_market_summary() -> Optional[dict[str, Any]]:
    """
    Pull live SPY/QQQ bias + VIX from Yahoo Finance.

    Reuses swing_trade._get_market_context_cached() (5-min in-process LRU cache)
    so concurrent requests do not hammer Yahoo.
    Returns None on any failure — caller falls back to the stub summary.
    """
    try:
        from swing_trade import _get_market_context_cached  # type: ignore[import]

        spy_bias, qqq_bias, market_context = _get_market_context_cached()

        # VIX — via bar_cache
        vix_val: Optional[float] = None
        try:
            vh = bar_cache.get_history("^VIX", period="5d", interval="1d")
            if vh is not None and not vh.empty:
                vix_val = float(vh["Close"].dropna().iloc[-1])
        except Exception:
            pass

        def _fmt(bias: str) -> str:
            """STRONG_BULLISH → Strong Bullish"""
            return bias.replace("_", " ").title()

        # VIX risk label
        if vix_val is None:
            vix_risk, vix_str = "Unknown", "—"
        elif vix_val >= 35:
            vix_risk, vix_str = "Extreme", f"{vix_val:.1f}"
        elif vix_val >= 25:
            vix_risk, vix_str = "Elevated", f"{vix_val:.1f}"
        elif vix_val >= 20:
            vix_risk, vix_str = "Moderate", f"{vix_val:.1f}"
        else:
            vix_risk, vix_str = "Contained", f"{vix_val:.1f}"

        # Market mode + risk status
        if market_context == "MARKET_SUPPORTIVE":
            market_mode, risk_status = "Trending", "Low–Med"
        elif market_context == "MARKET_WEAK":
            market_mode, risk_status = "Risk-Off", "High"
        else:
            market_mode, risk_status = "Choppy", "Medium"

        # Upgrade risk status when VIX is elevated but tape isn't already bearish
        if vix_val is not None and vix_val >= 25 and market_context != "MARKET_WEAK":
            risk_status = "Elevated"

        # Confidence score
        if market_context == "MARKET_SUPPORTIVE" and (vix_val or 0.0) < 20:
            confidence_score = 82
        elif market_context == "MARKET_SUPPORTIVE":
            confidence_score = 68
        elif market_context == "MARKET_WEAK":
            confidence_score = 32
        else:
            confidence_score = 48

        # Best trade style today
        if market_context == "MARKET_SUPPORTIVE" and (vix_val or 0.0) < 25:
            best_style = "Swing"
        elif market_context == "MARKET_WEAK":
            best_style = "Day (puts only)"
        else:
            best_style = "Day (scalp)"

        # AI coach summary
        spy_lbl, qqq_lbl = _fmt(spy_bias), _fmt(qqq_bias)
        bull_set = {"STRONG_BULLISH", "BULLISH"}
        bear_set = {"STRONG_BEARISH", "BEARISH"}
        if spy_bias in bull_set and qqq_bias in bull_set:
            coach = (
                f"SPY {spy_lbl} + QQQ {qqq_lbl} — tape supports longs. "
                f"VIX {vix_str} ({vix_risk.lower()}). "
                "Favor breakout entries; keep stops tight."
            )
        elif spy_bias in bear_set and qqq_bias in bear_set:
            coach = (
                f"SPY {spy_lbl} + QQQ {qqq_lbl} — reduce call exposure. "
                f"VIX {vix_str} ({vix_risk.lower()}). "
                "Puts on confirmed breakdowns only."
            )
        else:
            coach = (
                f"Mixed tape: SPY {spy_lbl}, QQQ {qqq_lbl}. "
                "Be selective — only trade names with clear relative strength. "
                f"VIX {vix_str} ({vix_risk.lower()})."
            )

        return {
            "market_mode":      market_mode,
            "best_style_today": best_style,
            "spy_trend":        spy_lbl,
            "qqq_trend":        qqq_lbl,
            "vix_risk":         f"{vix_risk} ({vix_str})",
            "risk_status":      risk_status,
            "confidence_score": confidence_score,
            "ai_coach_summary": coach,
        }
    except Exception:  # noqa: BLE001
        return None


@command_center_router.get("/market-position")
def get_market_position(auth_email: str = Depends(require_access_email)):
    """
    SPY position vs 200-day MA and 52-week high — Portfolio Reserve Signal.

    Strategy rules (25% cash reserve):
      dist_200ma >= +10%  → HIGH_TERRITORY   — trim 25%, rebuild reserve
      drawdown  8–12%     → DIP_ZONE         — deploy reserve
      drawdown  > 12%     → DEEP_CORRECTION  — staged deploy
      dist_200ma < 0      → BELOW_200MA      — caution, reduce risk
      else                → NEUTRAL          — hold steady
    """
    try:
        normalize_email(auth_email)

        # ~14 months ≈ 300 trading days → enough buffer for a 200-bar MA
        hist = bar_cache.get_history("SPY", period="14mo")
        if hist.empty or len(hist) < 20:
            return api_envelope(None, error={"message": "SPY historical data unavailable"})

        closes = hist["Close"].dropna()
        if len(closes) < 20:
            return api_envelope(None, error={"message": "Insufficient SPY close data"})

        last_price = float(closes.iloc[-1])

        # 200-day MA (use however many bars are available, up to 200)
        n200 = min(200, len(closes))
        ma200 = float(closes.tail(n200).mean())
        dist_200ma_pct = (last_price / ma200 - 1.0) * 100.0

        # 52-week high from last 252 bars (close-based, conservative)
        n52w = min(252, len(closes))
        high_52w = float(closes.tail(n52w).max())
        drawdown_pct = (high_52w - last_price) / high_52w * 100.0

        # SPY change %
        spy_chg_pct = None
        try:
            spy_hist = bar_cache.get_history("SPY", period="5d", interval="1d")
            if spy_hist is not None and not spy_hist.empty:
                spy_closes = spy_hist["Close"].dropna()
                if len(spy_closes) >= 2:
                    spy_chg_pct = round((float(spy_closes.iloc[-1]) / float(spy_closes.iloc[-2]) - 1) * 100, 2)
        except Exception:
            pass

        # QQQ price + change
        qqq_price = None
        qqq_chg_pct = None
        try:
            qqq_hist = bar_cache.get_history("QQQ", period="5d", interval="1d")
            if qqq_hist is not None and not qqq_hist.empty:
                qqq_closes = qqq_hist["Close"].dropna()
                if len(qqq_closes) >= 1:
                    qqq_price = round(float(qqq_closes.iloc[-1]), 2)
                if len(qqq_closes) >= 2:
                    qqq_chg_pct = round((float(qqq_closes.iloc[-1]) / float(qqq_closes.iloc[-2]) - 1) * 100, 2)
        except Exception:
            pass

        # VIX level
        vix_level = None
        try:
            vh = bar_cache.get_history("^VIX", period="5d", interval="1d")
            if vh is not None and not vh.empty:
                vix_level = round(float(vh["Close"].dropna().iloc[-1]), 2)
        except Exception:
            pass

        vix_label = None
        if vix_level is not None:
            if vix_level < 15:
                vix_label = "Low"
            elif vix_level < 20:
                vix_label = "Contained"
            elif vix_level < 25:
                vix_label = "Elevated"
            else:
                vix_label = "High"

        # Strategy signal — 25% reserve rule
        if dist_200ma_pct >= 10.0:
            position_signal = "HIGH_TERRITORY"
            signal_label    = "High territory — consider trimming 25%"
            signal_tone     = "red"
        elif 8.0 <= drawdown_pct <= 12.0:
            position_signal = "DIP_ZONE"
            signal_label    = "Dip zone — deploy reserve"
            signal_tone     = "green"
        elif drawdown_pct > 12.0:
            position_signal = "DEEP_CORRECTION"
            signal_label    = "Deep correction — staged deploy"
            signal_tone     = "green"
        elif dist_200ma_pct < 0.0:
            position_signal = "BELOW_200MA"
            signal_label    = "Below 200-day MA — caution, reduce risk"
            signal_tone     = "orange"
        else:
            position_signal = "NEUTRAL"
            signal_label    = "Normal range — hold steady"
            signal_tone     = "gray"

        return api_envelope({
            "spy_price":       round(last_price, 2),
            "spy_change_pct":  spy_chg_pct,
            "qqq_price":       qqq_price,
            "qqq_change_pct":  qqq_chg_pct,
            "vix":             vix_level,
            "vix_label":       vix_label,
            "ma200":           round(ma200, 2),
            "dist_200ma_pct":  round(dist_200ma_pct, 1),
            "high_52w":        round(high_52w, 2),
            "drawdown_pct":    round(drawdown_pct, 1),
            "position_signal": position_signal,
            "signal_label":    signal_label,
            "signal_tone":     signal_tone,
            "bars_used_ma200": n200,
        })

    except Exception as exc:  # noqa: BLE001
        return api_envelope(None, error={"message": f"Market position unavailable: {exc}"})


@command_center_router.get("/trade-command-center")
def get_trade_command_center(
    auth_email: str = Depends(require_access_email),
    engine: Optional[str] = Query(None, description="All | day | swing | regular"),
    signal: Optional[str] = Query(None),
    direction: Optional[str] = Query(None, description="call | put | spread | stock"),
    risk: Optional[str] = Query(None, description="low | medium | high"),
):
    """
    Live Trade Command Center.

    Runs all three engines (day / swing / regular) for every ticker on the
    authenticated user's unified watchlist, passes each result through
    resolve_trade_decision(), and aggregates into engine cards, recommendations,
    conflicts, and signal-distribution charts.

    Results are cached per-ticker for 90 s during market hours (10 min off-hours).
    The market_summary section is sourced live from Yahoo Finance + SPY/QQQ bias;
    stale=True means the market summary fell back to a default — engine data is
    always live regardless of the stale flag.
    """
    email = normalize_email(auth_email)
    t0 = time.perf_counter()

    # ── Auto-seed default tickers on first TCC visit ──────────────────────────
    state = get_user_state(email)
    if not state.get("my_tickers"):
        _seed_default_my_tickers(email)

    # ── Live engine aggregation ────────────────────────────────────────────────
    t_eng = time.perf_counter()
    payload = build_command_center_payload(
        email=email,
        engine_filter=engine,
        signal_filter=signal,
        direction_filter=direction,
        risk_filter=risk,
    )
    ms_eng = int((time.perf_counter() - t_eng) * 1000)

    # ── Live market summary overlay ────────────────────────────────────────────
    _stub_market_summary: dict[str, Any] = {
        "market_mode":      "—",
        "best_style_today": "—",
        "spy_trend":        "—",
        "qqq_trend":        "—",
        "vix_risk":         "—",
        "risk_status":      "—",
        "confidence_score": 0,
        "ai_coach_summary": "Market data unavailable — check connection.",
    }
    t_mkt = time.perf_counter()
    live_mkt = _fetch_live_market_summary()
    ms_mkt = int((time.perf_counter() - t_mkt) * 1000)
    stale    = live_mkt is None   # True only when Yahoo Finance is unreachable
    payload["market_summary"] = {**_stub_market_summary, **(live_mkt or {})}

    ms_total = int((time.perf_counter() - t0) * 1000)
    ticker_count = len(payload.get("recommendations") or []) // 3 or 0
    log.info(
        "TRADE_COMMAND_CENTER_LOAD elapsed=%dms engine_agg=%dms market_summary=%dms "
        "stale=%s tickers_approx=%d",
        ms_total, ms_eng, ms_mkt, stale, ticker_count,
    )

    # ── Trend-strength chart from live market data ────────────────────────────
    if live_mkt and "charts" in payload:
        spy_bull = "bull" in str(live_mkt.get("spy_trend", "")).lower()
        qqq_bull = "bull" in str(live_mkt.get("qqq_trend", "")).lower()
        payload["charts"]["trend_strength"] = [
            {"label": "SPY", "value": 72 if spy_bull else 38, "tone": "bullish" if spy_bull else "bearish"},
            {"label": "QQQ", "value": 78 if qqq_bull else 35, "tone": "bullish" if qqq_bull else "bearish"},
        ]

    return api_envelope(payload, stale=stale)


@command_center_router.get("/alerts")
def list_alerts_center(
    auth_email: str = Depends(require_access_email),
    engine_type: Optional[str] = Query(None),
    engine: Optional[str] = Query(None),
    alert_type: Optional[str] = Query(None),
    severity: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    ticker: Optional[str] = Query(None),
    active_only: bool = Query(False),
    today_only: bool = Query(False),
):
    email = normalize_email(auth_email)
    ensure_demo_alert_center_rows(email)
    sync_user_alerts_to_alert_center(email, retention_ms=LEGACY_USER_ALERT_RETENTION_MS, now_ms=int(time.time() * 1000))
    prune_alert_center_items(email)
    engine_filter = engine_type or engine
    items, total = alert_center_list(
        email,
        engine=engine_filter,
        alert_type_filter=alert_type,
        severity=severity,
        status=status,
        ticker=ticker,
        active_only=active_only,
        today_only=today_only,
        page=1,
        page_size=250,
    )
    data = build_alert_center_payload(items)
    data["summary"]["total"] = total
    return api_envelope(data, stale=False)


@command_center_router.post("/alerts/scan")
def scan_alerts_center(
    auth_email: str = Depends(require_access_email),
):
    email = normalize_email(auth_email)
    ensure_demo_alert_center_rows(email)
    sync_user_alerts_to_alert_center(email, retention_ms=LEGACY_USER_ALERT_RETENTION_MS, now_ms=int(time.time() * 1000))
    prune_alert_center_items(email)
    items, total = alert_center_list(
        email,
        active_only=True,
        page=1,
        page_size=250,
    )
    data = build_alert_center_payload(items)
    data["summary"]["total"] = total
    return api_envelope(data, stale=False)


class AlertNoteBody(BaseModel):
    text: str = Field(..., min_length=1)


@command_center_router.post("/alerts/{alert_id}/acknowledge")
def post_alert_acknowledge(alert_id: str, auth_email: str = Depends(require_access_email)):
    ok = alert_center_acknowledge(normalize_email(auth_email), alert_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Alert not found or not active")
    return api_envelope({"ok": True})


@command_center_router.post("/alerts/{alert_id}/resolve")
def post_alert_resolve(alert_id: str, auth_email: str = Depends(require_access_email)):
    ok = alert_center_resolve(normalize_email(auth_email), alert_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Alert not found")
    return api_envelope({"ok": True})


@command_center_router.post("/alerts/clear")
def post_alerts_clear(auth_email: str = Depends(require_access_email)):
    """Clear all active/acknowledged alerts for the user (non-destructive —
    marks them RESOLVED, keeping history). Returns the number cleared."""
    cleared = alert_center_resolve_all(normalize_email(auth_email))
    return api_envelope({"ok": True, "cleared": cleared})


@command_center_router.post("/alerts/{alert_id}/note")
def post_alert_note(
    alert_id: str,
    body: AlertNoteBody,
    auth_email: str = Depends(require_access_email),
):
    ok = alert_center_append_note(normalize_email(auth_email), alert_id, body.text)
    if not ok:
        raise HTTPException(status_code=404, detail="Alert not found")
    return api_envelope({"ok": True})


@command_center_router.get("/alerts/summary")
def list_alerts_summary(
    auth_email: str = Depends(require_access_email),
):
    email = normalize_email(auth_email)
    return api_envelope(get_alert_center_summary(email))


def _engine_source_label(raw: str) -> str:
    m = (raw or "").strip().lower()
    if m == "day":
        return "Day"
    if m == "swing":
        return "Swing"
    return "Regular"


def _watch_reason_for_list(engine_key: str, template: Optional[dict[str, Any]]) -> str:
    if isinstance(template, dict):
        n = str(template.get("notes") or "").strip()
        if n:
            return n
    if engine_key == "day":
        return "Day trade watchlist"
    if engine_key == "swing":
        return "Swing trade watchlist"
    return "Strategy / options watchlist"


def _mistake_tag_from_notes(notes: str) -> Optional[str]:
    raw = (notes or "").strip()
    for line in raw.splitlines():
        ls = line.strip()
        if ls.lower().startswith("[mistake_tag]"):
            return ls.split("]", 1)[-1].strip() or None
    return None


def _sanitize_iv(iv_raw: Any, ticker: Optional[str] = None) -> float:
    """
    Convert stored IV to decimal form for Black-Scholes.

    Stored IV may be:
    - 0 (missing) → fallback to historical vol or 0.50
    - Percentage > 1 (e.g. 52.0 for 52%) → divide by 100
    - Decimal (e.g. 0.52 for 52%) → use as-is
    """
    try:
        iv = float(iv_raw) if iv_raw else 0.0
    except (TypeError, ValueError):
        iv = 0.0

    if iv > 1.0:
        iv = iv / 100.0

    if iv >= 0.005:
        return round(iv, 4)

    if ticker:
        try:
            h = bar_cache.get_history(ticker, period="3mo", interval="1d", auto_adjust=True)
            if h is not None and not h.empty:
                returns = h["Close"].pct_change().dropna()
                hv = returns.tail(20).std() * math.sqrt(252)
                if 0.005 < hv < 10.0:
                    return round(float(hv), 4)
        except Exception:
            pass

    return 0.50


def _fetch_live_option_marks(
    ticker: str, expiry: str
) -> dict[str, tuple[float, float, float]]:
    """
    Fetch live bid/ask/last for all strikes of a ticker+expiry.

    Returns dict keyed by ``OPTION_TYPE:STRIKE`` (e.g. ``CALL:430.0``)
    → ``(bid, ask, lastPrice)``.

    Falls back to empty dict on any failure.
    """
    try:
        tk = yf.Ticker(ticker)
        chain = tk.option_chain(expiry)
        result: dict[str, tuple[float, float, float]] = {}
        for _, row in chain.calls.iterrows():
            s = float(row["strike"])
            bid = float(row["bid"]) if not pd.isna(row.get("bid", 0)) else 0.0
            ask = float(row["ask"]) if not pd.isna(row.get("ask", 0)) else 0.0
            last = float(row["lastPrice"]) if not pd.isna(row.get("lastPrice", 0)) else 0.0
            result[f"CALL:{s}"] = (bid, ask, last)
        for _, row in chain.puts.iterrows():
            s = float(row["strike"])
            bid = float(row["bid"]) if not pd.isna(row.get("bid", 0)) else 0.0
            ask = float(row["ask"]) if not pd.isna(row.get("ask", 0)) else 0.0
            last = float(row["lastPrice"]) if not pd.isna(row.get("lastPrice", 0)) else 0.0
            result[f"PUT:{s}"] = (bid, ask, last)
        return result
    except Exception:
        return {}


def calculate_position_pnl(
    position: dict[str, Any],
    *,
    live_option_marks: Optional[dict[str, tuple[float, float, float]]] = None,
    underlying_price: Optional[float] = None,
) -> dict[str, Any]:
    """
    Centralized option/stock position P&L computation.

    Uses live option marks when available, Black-Scholes with sanitised IV as
    fallback, and entry price as final fallback (zero P&L, stale marker).

    All monetary values are **total position** except
    ``entry_premium_per_share`` and ``current_mark_per_share``
    which are per-share (× 100 × contracts for totals).

    Formula (applies to both long and short/credit):
        pnl = current_value_total - entry_cost_total

    For a **long** position both terms are positive and P&L is
    current − entry.  For a **short/credit** position both terms are
    negative and P&L is (‑current) − (‑entry) = entry − current,
    which is correct for a short where we received entry credit and
    would pay current to close.
    """
    contracts = max(1, int(_float_or(position.get("contracts"), 1)))
    SHARES = 100
    max_loss_ps = abs(_float_or(position.get("max_loss"), 0.0))
    max_profit_ps = abs(_float_or(position.get("max_profit"), 0.0))
    strategy = str(position.get("strategy", ""))
    ticker = str(position.get("ticker", "")).upper()

    legs = position.get("legs", [])
    if not legs:
        up = underlying_price or _float_or(position.get("entryPrice"), 0.0)
        entry_px = _float_or(position.get("entryPrice"), 0.0)
        if entry_px <= 0:
            return {
                "entry_premium_per_share": 0.0, "current_mark_per_share": 0.0,
                "contracts": contracts, "multiplier": 1,
                "entry_cost_total": 0.0, "current_value_total": 0.0,
                "pnl": 0.0, "pnl_percent": 0.0,
                "max_loss_total": 0.0, "max_profit_display": "—", "at_risk_total": 0.0,
                "mark_source": "stale",
            }
        entry_cost_total = entry_px * contracts
        current_value_total = up * contracts
        pnl = current_value_total - entry_cost_total
        pnl_pct = (pnl / entry_cost_total * 100) if entry_cost_total > 0 else 0.0
        return {
            "entry_premium_per_share": entry_px,
            "current_mark_per_share": up,
            "contracts": contracts, "multiplier": 1,
            "entry_cost_total": round(entry_cost_total, 2),
            "current_value_total": round(current_value_total, 2),
            "pnl": round(pnl, 2),
            "pnl_percent": round(pnl_pct, 2),
            "max_loss_total": round(entry_cost_total, 2),
            "max_profit_display": "Unlimited",
            "at_risk_total": round(entry_cost_total, 2),
            "mark_source": "live" if underlying_price else "stale",
        }

    entry_premium_ps = 0.0
    current_mark_ps = 0.0
    overall_mark_source = "stale"

    for leg in legs:
        action = str(leg.get("action", "BUY")).upper()
        entry_p = _float_or(leg.get("mid_price"), 0.0)
        leg_iv = leg.get("iv", 0)
        strike = float(leg.get("strike", 0))
        opt_type = str(leg.get("option_type", "CALL")).upper()

        curr_p: Optional[float] = None
        mark_source = "stale"

        if live_option_marks is not None:
            key = f"{opt_type}:{strike}"
            if key in live_option_marks:
                bid, ask, last = live_option_marks[key]
                if bid > 0 and ask > 0:
                    curr_p = (bid + ask) / 2
                    mark_source = "live"
                elif last > 0:
                    curr_p = last
                    mark_source = "live"

        if curr_p is None and underlying_price:
            try:
                from backtest import bs_price, RISK_FREE_RATE
                expiry = str(position.get("expiry", ""))
                today = datetime.today().date()
                try:
                    expiry_date = datetime.strptime(expiry[:10], "%Y-%m-%d").date()
                    T = max(0.0, (expiry_date - today).days / 365.0)
                except Exception:
                    T = 0.1
                iv = _sanitize_iv(leg_iv, ticker)
                bs_p = bs_price(underlying_price, strike, T, RISK_FREE_RATE, iv, opt_type)
                curr_p = round(bs_p, 2)
                mark_source = "bs_theoretical"
            except Exception:
                pass

        if curr_p is None:
            curr_p = entry_p

        if mark_source == "live":
            overall_mark_source = "live"
        elif mark_source == "bs_theoretical" and overall_mark_source not in ("live",):
            overall_mark_source = "bs_theoretical"

        if action == "SELL":
            entry_premium_ps -= entry_p
            current_mark_ps -= curr_p
        else:
            entry_premium_ps += entry_p
            current_mark_ps += curr_p

    entry_cost_total = entry_premium_ps * SHARES * contracts
    current_value_total = current_mark_ps * SHARES * contracts
    pnl = current_value_total - entry_cost_total

    max_loss_total = abs(max_loss_ps * SHARES * contracts)
    at_risk_total = max_loss_total if max_loss_total > 0 else abs(entry_cost_total)

    if max_loss_total > 0:
        pnl_pct = (pnl / max_loss_total) * 100
    elif entry_cost_total != 0:
        pnl_pct = (pnl / abs(entry_cost_total)) * 100
    else:
        pnl_pct = 0.0

    strategy_lower = strategy.lower()
    if "long call" == strategy_lower or strategy_lower in ("long call",):
        max_profit_display = "Unlimited"
    elif "covered" in strategy_lower or "short put" in strategy_lower:
        if underlying_price and legs:
            s = abs(float(legs[0].get("strike", 0)))
            est = (underlying_price - s) * SHARES * contracts if "call" in strategy_lower else (s - 0) * SHARES * contracts
            max_profit_display = f"${abs(est):,.0f} (est.)"
        else:
            max_profit_display = "Unlimited"
    elif max_profit_ps > 0:
        max_profit_display = f"${max_profit_ps * SHARES * contracts:,.2f}"
    else:
        max_profit_display = "—"

    return {
        "entry_premium_per_share": round(entry_premium_ps, 2),
        "current_mark_per_share": round(current_mark_ps, 2),
        "contracts": contracts,
        "multiplier": SHARES,
        "entry_cost_total": round(entry_cost_total, 2),
        "current_value_total": round(current_value_total, 2),
        "pnl": round(pnl, 2),
        "pnl_percent": round(pnl_pct, 2),
        "max_loss_total": round(max_loss_total, 2),
        "max_profit_display": max_profit_display,
        "at_risk_total": round(at_risk_total, 2),
        "mark_source": overall_mark_source,
    }


def _is_stock_position(p: dict) -> bool:
    """
    True when a portfolio position is a direct stock holding (not options).

    Primary: strategy == 'Stock'
    Fallback: no option legs AND a 'shares' field is present and > 0
    """
    strategy = str(p.get("strategy") or "").strip().lower()
    if strategy == "stock":
        return True
    legs = p.get("legs")
    if isinstance(legs, list) and len(legs) > 0:
        return False
    shares_raw = p.get("shares")
    if shares_raw is not None:
        try:
            return int(float(shares_raw)) > 0
        except (TypeError, ValueError):
            pass
    return False


def _cost_basis_ref_per_share(p: dict) -> float:
    """Cost-basis reference per share for P&L math.

    Debit strategies (net_credit < 0, e.g. Long Call/Put) use |net_credit|.
    Credit strategies use max_profit.
    Mirrors the frontend costBasisRefPerShare() helper.
    """
    net_credit = _float_or(p.get("net_credit"), 0.0)
    if net_credit < 0:
        return abs(net_credit)
    return _float_or(p.get("max_profit"), 0.0)


def _compute_positions_pnl(
    open_pos: list[dict],
    closed_pos: list[dict],
) -> dict[str, Any]:
    SHARES = 100

    # ── 1. Realized P&L from closed positions ─────────────────────────────
    realized_pnl = 0.0
    realized_count = 0
    today_closed_pnl = 0.0
    week_closed_pnl = 0.0
    today = datetime.now(timezone.utc).date()
    today_str = today.isoformat()
    monday = today - timedelta(days=today.weekday())  # this week's Monday
    total_cost_basis = 0.0
    for p in closed_pos:
        rp = p.get("realized_pnl")
        exit_date = str(p.get("exitDate") or "")[:10]
        if rp is not None:
            realized_pnl += _float_or(rp, 0.0)
            realized_count += 1
            if exit_date == today_str:
                today_closed_pnl += _float_or(rp, 0.0)
            if exit_date >= str(monday):
                week_closed_pnl += _float_or(rp, 0.0)
        else:
            pnl_pct = p.get("pnlPct")
            if pnl_pct is None:
                continue
            cost_ref = _cost_basis_ref_per_share(p)
            contracts = max(1.0, _float_or(p.get("contracts"), 1.0))
            if cost_ref <= 0:
                continue
            pnl_dollar = (_float_or(pnl_pct, 0.0) / 100.0) * cost_ref * SHARES * contracts
            realized_pnl += pnl_dollar
            realized_count += 1
            if exit_date == today_str:
                today_closed_pnl += pnl_dollar
            if exit_date >= str(monday):
                week_closed_pnl += pnl_dollar
        total_cost_basis += _float_or(p.get("entryPrice"), 0.0) * max(1, _float_or(p.get("contracts"), 1.0)) * SHARES

    per_position_pnl: dict[str, dict[str, float]] = {}
    for p in closed_pos:
        pid = str(p.get("id", ""))
        if not pid:
            continue
        rp = p.get("realized_pnl")
        rpp = p.get("realized_pnl_percent")
        if rp is not None:
            pnl_dollar = _float_or(rp, 0.0)
            pnl_pct_val = _float_or(rpp, 0.0) if rpp is not None else _float_or(p.get("pnlPct"), 0.0)
            per_position_pnl[pid] = {"pnl": round(pnl_dollar, 2), "pnl_pct": round(pnl_pct_val, 2)}
        else:
            pp = p.get("pnlPct")
            if pp is not None:
                cost_ref = _cost_basis_ref_per_share(p)
                cc = max(1.0, _float_or(p.get("contracts"), 1.0))
                if cost_ref > 0:
                    dollar = (float(pp) / 100.0) * cost_ref * SHARES * cc
                    per_position_pnl[pid] = {"pnl": round(dollar, 2), "pnl_pct": float(pp)}

    # Separate stock positions from options positions
    stock_open = [p for p in open_pos if isinstance(p, dict) and _is_stock_position(p)]
    open_with_legs = [
        p for p in open_pos
        if isinstance(p, dict) and not _is_stock_position(p)
        and isinstance(p.get("legs"), list) and p.get("legs")
    ]
    open_no_legs = [
        p for p in open_pos
        if isinstance(p, dict) and not _is_stock_position(p)
        and (not isinstance(p.get("legs"), list) or not p.get("legs"))
    ]

    all_open_for_pnl = open_with_legs + open_no_legs
    # all tickers for price fetch — options + stocks
    all_open_all_types = all_open_for_pnl + stock_open

    if not all_open_all_types:
        total_pl = round(realized_pnl, 2) if realized_count > 0 else 0.0
        return {"total_pl": total_pl, "day_pl": round(today_closed_pnl, 2), "day_pl_pct": round((today_closed_pnl / total_cost_basis * 100) if total_cost_basis > 0 else 0, 2), "week_pl": round(week_closed_pnl, 2), "week_pl_pct": round((week_closed_pnl / total_cost_basis * 100) if total_cost_basis > 0 else 0, 2), "per_position": per_position_pnl}

    # ── 2. Fetch underlying prices and live option marks for open positions ─
    try:
        tickers = list({
            str(p.get("ticker", "")).upper()
            for p in all_open_all_types
            if p.get("ticker")
        })
        price_map: dict[str, tuple[float, float, float]] = {}
        for sym in tickers:
            try:
                h = bar_cache.get_history(sym, period="5d", interval="1d", auto_adjust=True)
                if h is None or h.empty:
                    continue
                c = h["Close"].dropna()
                if len(c) < 2:
                    continue
                # (current_close, prev_close, monday_close)
                mon_idx = None
                for i in range(len(h)):
                    if h.index[i].weekday() == 0:
                        mon_idx = i
                        break
                mon_close = float(c.iloc[mon_idx]) if mon_idx is not None else float(c.iloc[-1])
                price_map[sym] = (float(c.iloc[-1]), float(c.iloc[-2]), mon_close)
            except Exception:
                continue

        expiry_groups: dict[tuple[str, str], list[dict]] = {}
        for p in open_with_legs:
            sym = str(p.get("ticker", "")).upper()
            exp = str(p.get("expiry", ""))[:10]
            if sym and exp:
                expiry_groups.setdefault((sym, exp), []).append(p)

        live_marks: dict[str, dict[str, tuple[float, float, float]]] = {}
        for (sym, exp), _ in expiry_groups.items():
            marks = _fetch_live_option_marks(sym, exp)
            if marks:
                live_marks[f"{sym}:{exp}"] = marks

        mtm_total = 0.0
        day_total = 0.0
        week_total = 0.0
        has_mtm = False

        for p in all_open_for_pnl:
            sym = str(p.get("ticker", "")).upper()
            if sym not in price_map:
                continue
            S_now, S_prev, S_mon = price_map[sym]
            has_legs = isinstance(p.get("legs"), list) and p.get("legs")

            if has_legs:
                exp_key = f"{sym}:{str(p.get('expiry', ''))[:10]}"
                pos_marks = live_marks.get(exp_key)
            else:
                pos_marks = None

            current_result = calculate_position_pnl(
                p,
                live_option_marks=pos_marks,
                underlying_price=S_now,
            )
            # Day P&L from BS only (avoids stale mark cross-contamination)
            bs_today = calculate_position_pnl(
                p, live_option_marks=None, underlying_price=S_now,
            )
            bs_yesterday = calculate_position_pnl(
                p, live_option_marks=None, underlying_price=S_prev,
            )
            pid = str(p.get("id", ""))
            if pid:
                per_position_pnl[pid] = {
                    "pnl": current_result["pnl"],
                    "pnl_pct": current_result["pnl_percent"],
                    "entry_premium_per_share": current_result.get("entry_premium_per_share"),
                    "current_mark_per_share": current_result.get("current_mark_per_share"),
                    "mark_source": current_result.get("mark_source", "stale"),
                }
            mtm_total += current_result["pnl"]
            day_total += bs_today["pnl"] - bs_yesterday["pnl"]
            # Weekly P&L: current BS value minus Monday BS value
            bs_monday = calculate_position_pnl(
                p, live_option_marks=None, underlying_price=S_mon,
            )
            week_total += bs_today["pnl"] - bs_monday["pnl"]
            has_mtm = True

        # ── Stock P&L (simple: price delta × shares) ──────────────────────────
        stock_mtm_total  = 0.0
        stock_day_total  = 0.0
        stock_week_total = 0.0
        for p in stock_open:
            sym = str(p.get("ticker", "")).upper()
            if sym not in price_map:
                continue
            S_now, S_prev, S_mon = price_map[sym]
            entry_px = _float_or(p.get("entryPrice") or p.get("entry_price"), 0.0)
            sh = max(1, int(_float_or(p.get("shares"), 1.0)))
            if entry_px <= 0:
                continue
            pnl   = round((S_now  - entry_px) * sh, 2)
            d_pnl = round((S_now  - S_prev)   * sh, 2)
            w_pnl = round((S_now  - S_mon)    * sh, 2)
            pid = str(p.get("id", ""))
            if pid:
                per_position_pnl[pid] = {
                    "pnl":                    pnl,
                    "pnl_pct":               round((pnl / (entry_px * sh)) * 100.0, 2) if entry_px * sh > 0 else 0.0,
                    "entry_premium_per_share": round(entry_px, 2),
                    "current_mark_per_share":  round(S_now, 2),
                    "mark_source":             "live",
                }
            stock_mtm_total  += pnl
            stock_day_total  += d_pnl
            stock_week_total += w_pnl
            has_mtm = True

        combined_mtm  = mtm_total  + stock_mtm_total
        combined_day  = day_total  + stock_day_total
        combined_week = week_total + stock_week_total

        total_pl    = round(realized_pnl + combined_mtm, 2) if (realized_count > 0 or has_mtm) else None
        day_pl      = round(combined_day  + today_closed_pnl, 2) if (has_mtm or today_closed_pnl != 0) else None
        day_pl_pct  = round(((combined_day + today_closed_pnl) / total_cost_basis * 100), 2) if (has_mtm or today_closed_pnl != 0) and total_cost_basis > 0 else None
        week_pl     = round(combined_week + week_closed_pnl, 2) if (has_mtm or week_closed_pnl != 0) else None
        week_pl_pct = round(((combined_week + week_closed_pnl) / total_cost_basis * 100), 2) if (has_mtm or week_closed_pnl != 0) and total_cost_basis > 0 else None

        # Separate per-type metrics for the Stocks tab summary banner
        options_day_pl  = round(day_total  + today_closed_pnl, 2) if (day_total  != 0 or today_closed_pnl != 0) else None
        options_week_pl = round(week_total + week_closed_pnl,  2) if (week_total != 0 or week_closed_pnl != 0) else None
        stocks_day_pl   = round(stock_day_total,  2) if stock_day_total  != 0 else None
        stocks_week_pl  = round(stock_week_total, 2) if stock_week_total != 0 else None
        stocks_unrealized_pl = round(stock_mtm_total, 2) if stock_open else None

        return {
            "total_pl": total_pl,
            "day_pl": day_pl, "day_pl_pct": day_pl_pct,
            "week_pl": week_pl, "week_pl_pct": week_pl_pct,
            "options_day_pl": options_day_pl, "options_week_pl": options_week_pl,
            "stocks_day_pl": stocks_day_pl, "stocks_week_pl": stocks_week_pl,
            "stocks_unrealized_pl": stocks_unrealized_pl,
            "per_position": per_position_pnl,
        }

    except Exception:  # noqa: BLE001
        total_pl = round(realized_pnl, 2) if realized_count > 0 else None
        return {
            "total_pl": total_pl, "day_pl": None, "day_pl_pct": None,
            "week_pl": None, "week_pl_pct": None,
            "options_day_pl": None, "options_week_pl": None,
            "stocks_day_pl": None, "stocks_week_pl": None,
            "stocks_unrealized_pl": None,
            "per_position": per_position_pnl,
        }


def _fetch_market_snapshot() -> dict[str, Any]:
    """
    Live market snapshot for the Positions Center KPI strip.

    Returns regime, VIX, SPY/QQQ daily % change, and a risk badge.
    Falls back to empty dict on any failure so the strip simply stays hidden.
    """
    try:
        def _daily_pct(ticker: str) -> Optional[float]:
            h = bar_cache.get_history(ticker, period="5d", interval="1d", auto_adjust=True)
            if h is None or h.empty:
                return None
            c = h["Close"].dropna()
            if len(c) < 2:
                return None
            return round((float(c.iloc[-1]) / float(c.iloc[-2]) - 1.0) * 100.0, 2)

        spy_chg = _daily_pct("SPY")
        qqq_chg = _daily_pct("QQQ")

        vix_val: Optional[float] = None
        try:
            vh = bar_cache.get_history("^VIX", period="5d", interval="1d")
            if vh is not None and not vh.empty:
                vix_val = float(vh["Close"].dropna().iloc[-1])
        except Exception:
            pass

        # Regime: both green = bullish, both red = bearish, else mixed
        if spy_chg is not None and qqq_chg is not None:
            if spy_chg > 0 and qqq_chg > 0:
                regime = "bullish"
            elif spy_chg < 0 and qqq_chg < 0:
                regime = "bearish"
            else:
                regime = "mixed"
        else:
            regime = "mixed"

        # VIX label
        if vix_val is None:
            vix_label = "—"
        elif vix_val >= 35:
            vix_label = "Extreme"
        elif vix_val >= 25:
            vix_label = "Elevated"
        elif vix_val >= 20:
            vix_label = "Moderate"
        else:
            vix_label = "Contained"

        # Risk badge
        if (vix_val is not None and vix_val >= 35) or regime == "bearish":
            risk_badge = "High"
        elif vix_val is not None and vix_val >= 25:
            risk_badge = "Elevated"
        elif regime == "bullish":
            risk_badge = "Low"
        else:
            risk_badge = "Medium"

        return {
            "regime":          regime,
            "vix":             round(vix_val, 1) if vix_val is not None else None,
            "vix_label":       vix_label,
            "spy_change_pct":  spy_chg,
            "qqq_change_pct":  qqq_chg,
            "risk_badge":      risk_badge,
        }
    except Exception:  # noqa: BLE001
        return {}


def _unified_positions_watchlist_rows(state: dict[str, Any]) -> list[dict[str, Any]]:
    """
    Merge persisted lists for the Positions Center watchlist tab:
      - watchlist: options/strategyAdvisor items ({ticker, addedAt?, ...})
      - day_trade_watchlist / swing_trade_watchlist: string tickers
    One row per (ticker, engine_source); engine_source is Day / Swing / Regular for the API.
    """
    rows: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()

    def push_row(
        ticker: str,
        engine_key: str,
        template: Optional[dict[str, Any]] = None,
    ) -> None:
        t = str(ticker).strip().upper()
        if not t or len(t) > 12:
            return
        key = (t, engine_key)
        if key in seen:
            return
        seen.add(key)
        label = _engine_source_label(engine_key)
        reason = _watch_reason_for_list(engine_key, template if isinstance(template, dict) else None)
        added = ""
        if isinstance(template, dict):
            added = str(template.get("addedAt") or "").strip()
        row = {
            "id": f"wl-{t}-{engine_key}",
            "ticker": t,
            "watch_reason": reason,
            "engine_source": label,
            "desired_entry": None,
            "current_price": None,
            "distance_to_entry": None,
            "signal": None,
            "alert_status": "none",
            "last_updated": added or "",
        }
        rows.append(row)

    raw_wl = state.get("watchlist") or []
    if isinstance(raw_wl, list):
        for item in raw_wl:
            if isinstance(item, str):
                push_row(item, "options", {"addedAt": "", "notes": ""})
            elif isinstance(item, dict):
                tick = str(item.get("ticker", "") or "").strip().upper()
                if not tick:
                    continue
                tpl = dict(item)
                tpl["ticker"] = tick
                push_row(tick, "options", tpl)

    dt = state.get("day_trade_watchlist") or []
    if isinstance(dt, list):
        for sym in dt:
            if isinstance(sym, str):
                push_row(sym, "day")

    sw = state.get("swing_trade_watchlist") or []
    if isinstance(sw, list):
        for sym in sw:
            if isinstance(sym, str):
                push_row(sym, "swing")

    return rows


def _float_or(x: Any, default: float = 0.0) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return default


# ── Sector + P&L aggregation helpers (Dashboard tab) ──────────────────────────

_TICKER_SECTOR_MAP: dict[str, str] | None = None

def _load_ticker_sector_map() -> dict[str, str]:
    global _TICKER_SECTOR_MAP
    if _TICKER_SECTOR_MAP is not None:
        return _TICKER_SECTOR_MAP
    import json as _json
    from pathlib import Path as _Path
    try:
        p = _Path(__file__).with_name("data") / "ticker_universe.json"
        data = _json.loads(p.read_text())
        _TICKER_SECTOR_MAP = {item["symbol"].upper(): item.get("sector", "Other") for item in data if item.get("symbol")}
    except Exception:
        _TICKER_SECTOR_MAP = {}
    return _TICKER_SECTOR_MAP


def _sector_for_ticker(ticker: str) -> str:
    sm = _load_ticker_sector_map()
    return sm.get(ticker.upper().strip(), "Other")


def _aggregate_pnl_by_sector(open_pos: list, closed: list, per_position_pnl: dict) -> list[dict]:
    """Aggregate realized + unrealized P&L by sector."""
    sector_data: dict[str, dict] = {}
    for p in closed:
        if not isinstance(p, dict):
            continue
        t = str(p.get("ticker", "")).upper()
        sec = _sector_for_ticker(t)
        rpn = _float_or(p.get("realized_pnl"), 0.0)
        entry = sector_data.setdefault(sec, {"sector": sec, "realized_pnl": 0.0, "unrealized_pnl": 0.0, "open_count": 0, "closed_count": 0, "capital": 0.0})
        entry["realized_pnl"] += rpn
        entry["closed_count"] += 1
    for p in open_pos:
        if not isinstance(p, dict):
            continue
        t = str(p.get("ticker", "")).upper()
        sec = _sector_for_ticker(t)
        pid = str(p.get("id", ""))
        upn = 0.0
        if pid and pid in per_position_pnl:
            upn = _float_or(per_position_pnl[pid].get("pnl"), 0.0)
        cx = _float_or(p.get("capital_at_risk"), 0.0)
        if cx <= 0 and p.get("max_loss") is not None:
            cx = abs(_float_or(p.get("max_loss"), 0.0)) * max(_float_or(p.get("contracts"), 1.0), 1.0) * 100.0
        if _is_stock_position(p):
            cx = _float_or(p.get("entryPrice"), 0.0) * max(_float_or(p.get("shares"), 1.0), 1.0)
        entry = sector_data.setdefault(sec, {"sector": sec, "realized_pnl": 0.0, "unrealized_pnl": 0.0, "open_count": 0, "closed_count": 0, "capital": 0.0})
        entry["unrealized_pnl"] += upn
        entry["open_count"] += 1
        entry["capital"] += cx
    out = []
    for sec, d in sector_data.items():
        out.append({
            "sector": sec,
            "realized_pnl": round(d["realized_pnl"], 2),
            "unrealized_pnl": round(d["unrealized_pnl"], 2),
            "total_pnl": round(d["realized_pnl"] + d["unrealized_pnl"], 2),
            "open_count": d["open_count"],
            "closed_count": d["closed_count"],
            "capital": round(d["capital"], 2),
        })
    out.sort(key=lambda x: x["total_pnl"], reverse=True)
    return out


def _aggregate_pnl_by_period(closed: list) -> list[dict]:
    """Aggregate realized P&L by time period (week buckets for last 8 weeks)."""
    from datetime import datetime, timedelta
    now = datetime.utcnow()
    buckets: dict[str, float] = {}
    for i in range(8, -1, -1):
        wk = now - timedelta(weeks=i)
        label = wk.strftime("W%U")
        buckets[label] = 0.0
    for p in closed:
        if not isinstance(p, dict):
            continue
        exit_date = p.get("exitDate") or p.get("exit_date")
        if not exit_date:
            continue
        try:
            ed = datetime.fromisoformat(str(exit_date).split("T")[0])
        except (TypeError, ValueError):
            continue
        rpn = _float_or(p.get("realized_pnl"), 0.0)
        label = ed.strftime("W%U")
        if label in buckets:
            buckets[label] += rpn
        else:
            buckets[label] = buckets.get(label, 0.0) + rpn
    return [{"label": k, "pnl": round(v, 2)} for k, v in buckets.items()]


def _aggregate_pnl_by_strategy(closed: list) -> list[dict]:
    """Aggregate realized P&L by strategy type."""
    strat_data: dict[str, dict] = {}
    for p in closed:
        if not isinstance(p, dict):
            continue
        strat = str(p.get("strategy", "")) or "Unknown"
        rpn = _float_or(p.get("realized_pnl"), 0.0)
        entry = strat_data.setdefault(strat, {"strategy": strat, "pnl": 0.0, "count": 0, "wins": 0})
        entry["pnl"] += rpn
        entry["count"] += 1
        if rpn > 0:
            entry["wins"] += 1
    out = []
    for strat, d in strat_data.items():
        out.append({
            "strategy": strat,
            "pnl": round(d["pnl"], 2),
            "count": d["count"],
            "wins": d["wins"],
            "win_rate": round(d["wins"] / d["count"] * 100, 1) if d["count"] > 0 else 0.0,
        })
    out.sort(key=lambda x: x["pnl"], reverse=True)
    return out


def _portfolio_position_row(p: dict[str, Any], *, closed: bool) -> dict[str, Any]:
    is_stock = _is_stock_position(p)
    contracts = _float_or(p.get("contracts"), 0.0)
    if not is_stock and contracts <= 0:
        contracts = 1.0
    entry = _float_or(p.get("entryPrice"), 0.0)
    cap = p.get("capital_at_risk")
    risk_status = "medium"
    if cap is not None:
        cx = _float_or(cap, 0.0)
        if cx >= 15000:
            risk_status = "high"
        elif cx <= 2500:
            risk_status = "low"
    strat = str(p.get("strategy") or "")
    engine_guess = "Regular"
    src = str(p.get("source") or "")
    if "day" in src.lower():
        engine_guess = "Day"
    elif "swing" in src.lower():
        engine_guess = "Swing"

    row = {
        "id": str(p.get("id") or ""),
        "ticker": str(p.get("ticker") or "").upper(),
        "strategy": strat,
        "engine_source": engine_guess,
        "entry_date": str(p.get("addedAt") or "")[:10],
        "expiry": str(p.get("expiry") or ""),
        "contracts": None if is_stock else round(contracts, 4),
        "shares": max(1, int(_float_or(p.get("shares"), 1.0))) if is_stock else None,
        "entry_price": entry,
        "current_price": None,
        "pnl_amount": None,
        "pnl_percent": None,
        "target": _float_or(p.get("target1"), 0.0) or None,
        "target2": _float_or(p.get("target2"), 0.0) or None,
        "stop_loss": _float_or(p.get("stopLoss") or p.get("stop_loss"), 0.0) or None,
        "trailing_stop_pct": _float_or(p.get("trailing_stop_pct"), 0.0) or None,
        "position_type": "stock" if is_stock else "options",
        "risk_status": risk_status,
        "recommended_action": "Review position" if not closed else "Closed",
    }
    if closed:
        row["exit_date"] = str(p.get("exitDate") or "")[:10]
        pp = p.get("pnlPct")
        if pp is not None:
            row["pnl_percent"] = _float_or(pp, 0.0)
        row["exit_reason"] = str(p.get("exit_reason") or "manual_close")
        notes = str(p.get("notes") or "")
        mt = _mistake_tag_from_notes(notes)
        row["mistake_tag"] = mt
        row["notes"] = notes

        rp = p.get("realized_pnl")
        if rp is not None:
            row["realized_pnl"] = _float_or(rp, 0.0)
        rpp = p.get("realized_pnl_percent")
        if rpp is not None:
            row["realized_pnl_percent"] = _float_or(rpp, 0.0)
        ep = p.get("exit_price")
        if ep is not None:
            row["exit_price"] = _float_or(ep, 0.0)
        ov = p.get("pnl_overridden")
        if ov is not None:
            row["pnl_overridden"] = bool(ov)
    return row


def _positions_center_payload(state: dict[str, Any], *, email: str) -> dict[str, Any]:
    unified_wl = _unified_positions_watchlist_rows(state)
    port = state.get("portfolio") or []
    open_pos = [p for p in port if isinstance(p, dict) and p.get("status") == "open"]
    closed = [p for p in port if isinstance(p, dict) and p.get("status") == "closed"]
    open_rows = [_portfolio_position_row(p, closed=False) for p in open_pos]
    closed_rows = [_portfolio_position_row(p, closed=True) for p in closed[:200]]

    exposure: dict[str, float] = {}
    capital_by_strategy: dict[str, float] = {}
    capital_by_engine: dict[str, float] = {}
    options_cap = 0.0
    stock_cap   = 0.0
    for p in open_pos:
        if not isinstance(p, dict):
            continue
        t = str(p.get("ticker", "")).upper()
        strat = str(p.get("strategy", "")) or "Unknown"
        if _is_stock_position(p):
            # Stock capital = entry_price × shares (no 100× multiplier)
            ep = _float_or(p.get("entryPrice"), 0.0)
            sh = max(1, int(_float_or(p.get("shares"), 1.0)))
            cap_v = ep * sh
            stock_cap += cap_v
        else:
            cx = p.get("capital_at_risk")
            cap_v = _float_or(cx, 0.0)
            if cap_v <= 0 and p.get("max_loss") is not None:
                ml = _float_or(p.get("max_loss"), 0.0)
                cc = _float_or(p.get("contracts"), 1.0)
                cap_v = abs(ml) * max(cc, 1.0) * 100.0
            options_cap += cap_v
        if t:
            exposure[t] = exposure.get(t, 0.0) + cap_v
        capital_by_strategy[strat] = capital_by_strategy.get(strat, 0.0) + cap_v
        eng = "Regular"
        if "day" in str(p.get("source", "")).lower():
            eng = "Day"
        elif "swing" in str(p.get("source", "")).lower():
            eng = "Swing"
        capital_by_engine[eng] = capital_by_engine.get(eng, 0.0) + cap_v

    bullish = 0.0
    bearish = 0.0
    for p in open_pos:
        if not isinstance(p, dict):
            continue
        b = str(p.get("bias") or "").lower()
        cx = _float_or(p.get("capital_at_risk"), 0.0)
        if cx <= 0 and p.get("max_loss") is not None:
            ml = _float_or(p.get("max_loss"), 0.0)
            cc = _float_or(p.get("contracts"), 1.0)
            cx = abs(ml) * max(cc, 1.0) * 100.0
        if "bear" in b or "put" in b:
            bearish += cx
        elif "bull" in b or "call" in b:
            bullish += cx
        else:
            bullish += cx * 0.5
            bearish += cx * 0.5

    risk_by_underlying = [{"name": k, "value": round(v, 2)} for k, v in sorted(exposure.items())]
    alerts_n   = alert_center_active_count(email)
    critical_n = alert_center_critical_count(email)

    # Options vs stock position counts
    stock_pos_count   = sum(1 for p in open_pos if isinstance(p, dict) and _is_stock_position(p))
    options_pos_count = max(0, len(open_pos) - stock_pos_count)

    # P&L: realized (closed) + MTM (open via Black-Scholes + live yfinance prices)
    pnl_data = _compute_positions_pnl(open_pos, closed)

    # AI position analysis — options only
    ai_analyses: dict[str, dict[str, Any]] = {}
    ppnl = pnl_data.get("per_position", {})
    for p in open_pos:
        if _is_stock_position(p):
            continue
        pid = str(p.get("id", ""))
        if not pid:
            continue
        position_pnl = ppnl.get(pid)
        try:
            ai_analyses[pid] = analyze_active_position(p, pnl_data=position_pnl)
        except Exception as exc:
            log.warning("AI analysis failed for position %s (%s): %s", pid, p.get("ticker", "?"), exc)
            ai_analyses[pid] = {
                "ai_state": "ANALYSIS_ERROR", "state_label": "Error",
                "health_score": 0, "health_label": "ERROR",
                "pnl_pct": 0.0, "momentum_quality": "UNKNOWN",
                "extension_pct": 0.0, "extension_risk": "UNKNOWN",
                "theta_risk": "UNKNOWN", "iv_risk": "UNKNOWN",
                "trend_risk": "UNKNOWN", "rsi_risk": "UNKNOWN",
                "liquidity_risk": "UNKNOWN", "market_correlation_risk": "UNKNOWN",
                "dte": 0, "rsi": 50.0, "current_price": 0.0, "ma20": 0.0,
                "value_capture_pct": None, "max_profit": 0.0, "max_loss": 0.0,
                "ai_summary": "AI analysis unavailable for this position.",
                "next_best_action": "Review position manually.",
                "timeline_stage": "UNKNOWN", "smart_alerts": [],
                "management_playbook": [], "management_actions": [],
                "is_profitable": False, "strategy_family": "UNKNOWN",
            }

    # Stock decision engine analysis
    stock_analyses: dict[str, dict[str, Any]] = {}
    for p in open_pos:
        if not _is_stock_position(p):
            continue
        pid = str(p.get("id", ""))
        if not pid:
            continue
        try:
            stock_analyses[pid] = analyze_stock_position(p, pnl_data=ppnl.get(pid))
        except Exception as exc:
            log.warning("Stock analysis failed for position %s (%s): %s", pid, p.get("ticker", "?"), exc)

    # Lazily persist high_water_mark updates (when a new high is hit since last save)
    port = list(state.get("portfolio") or [])
    portfolio_mutated = False
    for i, p in enumerate(port):
        if not isinstance(p, dict) or p.get("status") != "open":
            continue
        pid = str(p.get("id", ""))
        if not pid or pid not in stock_analyses:
            continue
        new_hwm = stock_analyses[pid].get("high_water_mark")
        old_hwm = _float_or(p.get("high_water_mark") or p.get("highWaterMark"), 0.0)
        if new_hwm and new_hwm > old_hwm + 0.001:
            port[i] = {**p, "high_water_mark": new_hwm}
            portfolio_mutated = True
    if portfolio_mutated:
        try:
            save_user_state(email, state.get("watchlist") or [], port)
        except Exception:
            pass

    total_capital = round(options_cap + stock_cap, 2)
    summary = {
        "total_open_positions":   len(open_pos),
        "options_positions":      options_pos_count,
        "stock_positions":        stock_pos_count,
        "watchlist_count":        len(unified_wl),
        "watchlist_alerts":       alerts_n,
        "alert_center_count":     alerts_n,
        "critical_alerts":        critical_n,
        "total_capital_used":     total_capital,
        "options_capital":        round(options_cap, 2),
        "stock_capital":          round(stock_cap, 2),
        "total_pl":               pnl_data["total_pl"],
        "day_pl":                 pnl_data["day_pl"],
        "day_pl_pct":             pnl_data.get("day_pl_pct"),
        "week_pl":                pnl_data.get("week_pl"),
        "week_pl_pct":            pnl_data.get("week_pl_pct"),
        "risk_status":            "elevated" if options_cap > 20000 else "normal",
        "alerts_count":           alerts_n,
        "open_risk_notional":     round(options_cap, 2),
        "closed_trades_count":    len(closed),
        # Separate per-type summaries for the Stocks tab
        "options": {
            "count":    options_pos_count,
            "capital":  round(options_cap, 2),
            "day_pl":   pnl_data.get("options_day_pl"),
            "week_pl":  pnl_data.get("options_week_pl"),
        },
        "stocks": {
            "count":           stock_pos_count,
            "cost_basis":      round(stock_cap, 2),
            "unrealized_pl":   pnl_data.get("stocks_unrealized_pl"),
            "day_pl":          pnl_data.get("stocks_day_pl"),
            "week_pl":         pnl_data.get("stocks_week_pl"),
        },
    }

    cap_strat = [{"label": k, "value": round(v, 2)} for k, v in sorted(capital_by_strategy.items())]
    cap_ticker = [{"ticker": k, "value": round(v, 2)} for k, v in sorted(exposure.items())]
    cap_eng = [{"engine": k, "value": round(v, 2)} for k, v in sorted(capital_by_engine.items())]

    pl_series = [
        {"label": "Open notional", "value": round(options_cap, 2)},
        {"label": "Positions", "value": len(open_pos)},
    ]

    near_expiry_count = 0
    for p in open_pos:
        if not isinstance(p, dict):
            continue
        dte_raw = p.get("dte")
        try:
            dte_v = int(float(dte_raw)) if dte_raw is not None else 999
        except (TypeError, ValueError):
            dte_v = 999
        if dte_v <= 7:
            near_expiry_count += 1

    risk = {
        "by_underlying": risk_by_underlying,
        "summary_bars": pl_series,
        "capital_by_strategy": cap_strat,
        "capital_by_ticker": cap_ticker,
        "capital_by_engine": cap_eng,
        "bullish_exposure": round(bullish, 2),
        "bearish_exposure": round(bearish, 2),
        "options_exposure": round(options_cap, 2),
        "stock_exposure":   round(stock_cap, 2),
        "expiry_risk": {
            "positions_within_7dte": near_expiry_count,
            "note": "Stub — wire full expiry ladder from backend.",
        },
        "concentration_risk": {
            "top_ticker_pct": round(
                (max(exposure.values()) / options_cap * 100.0) if exposure and options_cap > 0 else 0.0,
                1,
            ),
            "note": "Largest share of options capital.",
        },
        "theta_risk": {
            "note": "Theta estimates require live greeks — not computed here.",
        },
    }
    # ── Sector + P&L aggregations for Dashboard tab ──────────────────────
    sector_pnl = _aggregate_pnl_by_sector(open_pos, closed, pnl_data.get("per_position", {}))
    pnl_by_period = _aggregate_pnl_by_period(closed)
    pnl_by_strategy = _aggregate_pnl_by_strategy(closed)

    market_snapshot = _fetch_market_snapshot()

    return {
        "summary":               summary,
        "market_snapshot":       market_snapshot,
        "watchlist":             unified_wl,
        "watchlist_items":       unified_wl,
        "open_positions":        open_rows,
        "open_positions_detail": open_pos,
        "closed_trades":         closed_rows,
        "closed_trades_detail":  closed[:200],
        "risk":                  risk,
        "per_position_pnl":      pnl_data.get("per_position", {}),
        "ai_analyses":           ai_analyses,
        "stock_analyses":        stock_analyses,
        "sector_pnl":            sector_pnl,
        "pnl_by_period":         pnl_by_period,
        "pnl_by_strategy":       pnl_by_strategy,
    }


@command_center_router.get("/positions-center")
def get_positions_center(auth_email: str = Depends(require_access_email)):
    email = normalize_email(auth_email)
    state = get_user_state(email)
    ensure_demo_alert_center_rows(email)
    return api_envelope(_positions_center_payload(state, email=email), stale=False)


@command_center_router.get("/premarket-bias")
def get_premarket_bias(
    force_refresh: bool = Query(False),
    auth_email: str = Depends(require_access_email),
) -> dict[str, Any]:
    """Pre-market bias engine — 5-condition score → BULLISH/NEUTRAL/BEARISH."""
    from premarket_bias import build_premarket_bias
    return api_envelope(build_premarket_bias(force_refresh=force_refresh), stale=False)


@command_center_router.get("/early-entry-trigger")
def get_early_entry_trigger(
    ticker: str = Query("QQQ", min_length=1, max_length=12),
    force_refresh: bool = Query(False),
    auth_email: str = Depends(require_access_email),
) -> dict[str, Any]:
    """Early entry trigger engine — 3-condition 6:30–7:00 AM PT window."""
    from early_entry_trigger import check_early_entry_trigger
    return api_envelope(
        check_early_entry_trigger(ticker.strip().upper(), force_refresh=force_refresh),
        stale=False,
    )


@command_center_router.get("/stock-targets")
def get_stock_targets(
    ticker: str = Query(..., min_length=1, max_length=12),
    entry_price: Optional[float] = Query(None, gt=0),
    fib_lookback: int = Query(20, ge=5, le=120),
    auth_email: str = Depends(require_access_email),
) -> dict[str, Any]:
    """
    Return live MA context and MA-based target / stop suggestions for a stock ticker.
    Called by the Add Position form when the user clicks "Auto-Fill Targets".

    Additive swing-trade fields (9 EMA + Fibonacci swing high/low) are included
    for the EOD Journal pullback tooling; ``fib_lookback`` controls the swing window.
    """
    from stock_decision_engine import _get_ma_data, _calc_targets

    t = ticker.strip().upper()
    mkt = _get_ma_data(t, fib_lookback=fib_lookback)
    if not mkt or not mkt.get("current_price"):
        raise HTTPException(status_code=404, detail=f"No price data available for {t}.")

    current = float(mkt["current_price"])
    ma20 = float(mkt.get("ma20") or current)
    ma50 = float(mkt.get("ma50") or current)
    ep = float(entry_price) if entry_price else current
    t1, t2 = _calc_targets(ep, ma20, ma50, current)
    stop = round(ep * 0.92, 2)  # 8% hard-stop default

    return api_envelope({
        "ticker":             t,
        "current_price":      round(current, 4),
        "ma20":               round(ma20, 4),
        "ma50":               round(ma50, 4),
        "rsi":                mkt.get("rsi", 50.0),
        "mom_5d":             mkt.get("mom_5d", 0.0),
        "suggested_target1":  t1,
        "suggested_target2":  t2,
        "suggested_stop_loss": stop,
        # ── Additive: 9 EMA early-momentum signal ──
        "ema9":               mkt.get("ema9"),
        "ema9_slope":         mkt.get("ema9_slope"),
        "price_vs_ema9":      mkt.get("price_vs_ema9"),
        # ── Additive: Fibonacci swing high / low (daily) ──
        "fib_swing_high":      mkt.get("fib_swing_high"),
        "fib_swing_high_date": mkt.get("fib_swing_high_date"),
        "fib_swing_low":       mkt.get("fib_swing_low"),
        "fib_swing_low_date":  mkt.get("fib_swing_low_date"),
        "fib_direction":       mkt.get("fib_direction"),
    })


class WatchlistTickerBody(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=12)
    notes: Optional[str] = None
    source: Optional[str] = None
    watch_reason: Optional[str] = None
    desired_entry: Optional[float] = None


@command_center_router.post("/watchlist/add")
def post_watchlist_add(body: WatchlistTickerBody, auth_email: str = Depends(require_access_email)):
    email = normalize_email(auth_email)
    state = get_user_state(email)
    wl = list(state.get("watchlist") or [])
    t = body.ticker.strip().upper()
    if any(str(x.get("ticker", "")).upper() == t for x in wl if isinstance(x, dict)):
        return api_envelope({"ok": True, "watchlist": wl, "duplicate": True})
    item: dict[str, Any] = {
        "ticker": t,
        "addedAt": datetime.now(timezone.utc).date().isoformat(),
    }
    if body.notes and body.notes.strip():
        item["notes"] = body.notes.strip()
    if body.source:
        item["source"] = body.source.strip()
    if body.watch_reason and body.watch_reason.strip():
        item["watch_reason"] = body.watch_reason.strip()
    if body.desired_entry is not None:
        item["desired_entry"] = body.desired_entry
    wl.append(item)
    try:
        saved = save_user_state(email, wl, state.get("portfolio") or [])
    except ValueError as e:
        msg = str(e)
        if msg.startswith("watchlist_limit:"):
            lim = msg.split(":", 1)[1]
            raise HTTPException(
                status_code=400,
                detail=f"Watchlist cannot exceed {lim} symbols for your account.",
            ) from None
        raise
    return api_envelope({"ok": True, "watchlist": saved.get("watchlist")})


@command_center_router.post("/watchlist/remove")
def post_watchlist_remove(body: WatchlistTickerBody, auth_email: str = Depends(require_access_email)):
    email = normalize_email(auth_email)
    state = get_user_state(email)
    wl = list(state.get("watchlist") or [])
    t = body.ticker.strip().upper()
    wl = [x for x in wl if not (isinstance(x, dict) and str(x.get("ticker", "")).upper() == t)]
    saved = save_user_state(email, wl, state.get("portfolio") or [])
    return api_envelope({"ok": True, "watchlist": saved.get("watchlist")})


def _sync_position_to_journal(email: str, pos: dict[str, Any]) -> None:
    """Auto-create an OPEN journal entry for a new position (dedup by ticker+strategy+expiry)."""
    ticker = str(pos.get("ticker") or "").strip().upper()
    strategy = str(pos.get("strategy") or "")
    expiry = str(pos.get("expiry") or "")
    if not ticker or not strategy:
        return
    existing = get_journal_entries(email, status="OPEN")
    for e in existing:
        if (
            str(e.get("ticker", "")).upper() == ticker
            and e.get("strategy") == strategy
            and str(e.get("expiry", ""))[:10] == expiry[:10]
        ):
            return  # already tracked
    added_at = str(pos.get("addedAt") or "")
    entry_date = added_at[:10] if added_at else date.today().isoformat()
    try:
        from datetime import date as _date
        exp_d = _date.fromisoformat(expiry[:10]) if expiry else None
        dte = (exp_d - _date.today()).days if exp_d else 0
    except (ValueError, TypeError):
        dte = 0
    save_journal_entry(email, {
        "ticker": ticker,
        "company_name": str(pos.get("companyName") or ""),
        "strategy": strategy,
        "bias": str(pos.get("bias") or ""),
        "legs": pos.get("legs") or [],
        "expiry": expiry,
        "entry_date": entry_date,
        "dte_at_entry": max(0, dte),
        "net_credit": float(pos.get("net_credit") or 0),
        "max_profit": float(pos.get("max_profit") or 0),
        "max_loss": float(pos.get("max_loss") or 0),
        "underlying_entry": float(pos.get("entryPrice") or 0),
        "prob_of_profit": float(pos.get("prob_of_profit") or 0),
        "expected_value": float(pos.get("expected_value") or 0),
        "total_score": int(pos.get("scores_total") or 0),
        "notes": str(pos.get("notes") or ""),
    })


class PortfolioAddBody(BaseModel):
    position: dict[str, Any]


@command_center_router.post("/portfolio/add")
def post_portfolio_add(body: PortfolioAddBody, auth_email: str = Depends(require_access_email)):
    email = normalize_email(auth_email)
    state = get_user_state(email)
    port = list(state.get("portfolio") or [])
    pos = dict(body.position)
    pos.setdefault("id", str(uuid.uuid4()))
    pos.setdefault("status", "open")
    # Stock-specific field initialisation
    if _is_stock_position(pos):
        entry_px = _float_or(pos.get("entryPrice") or pos.get("entry_price"), 0.0)
        if not pos.get("high_water_mark") and entry_px > 0:
            pos["high_water_mark"] = entry_px
        if not pos.get("trailing_stop_pct"):
            pos["trailing_stop_pct"] = 0.08  # 8% default trailing stop
    port.append(pos)
    saved = save_user_state(email, state.get("watchlist") or [], port)
    try:
        _sync_position_to_journal(email, pos)
    except Exception:  # noqa: BLE001 — journal sync is best-effort
        log.warning("journal auto-sync failed for %s / %s", email, pos.get("ticker"))
    return api_envelope({"ok": True, "portfolio": saved.get("portfolio")})


class PortfolioUpdateBody(BaseModel):
    id: str = Field(..., min_length=1)
    data: dict = Field(...)


@command_center_router.post("/portfolio/update")
def post_portfolio_update(body: PortfolioUpdateBody, auth_email: str = Depends(require_access_email)):
    email = normalize_email(auth_email)
    state = get_user_state(email)
    port = list(state.get("portfolio") or [])
    found = False
    for i, p in enumerate(port):
        if not isinstance(p, dict) or str(p.get("id")) != body.id:
            continue
        immutable = {k: p[k] for k in ("id", "addedAt", "status") if k in p}
        port[i] = {**p, **body.data, **immutable}
        found = True
        break
    if not found:
        raise HTTPException(status_code=404, detail="Position not found")
    saved = save_user_state(email, state.get("watchlist") or [], port)
    return api_envelope({"ok": True, "portfolio": saved.get("portfolio")})


class PortfolioCloseBody(BaseModel):
    id: str = Field(..., min_length=1)
    mistake_tag: Optional[str] = None
    pnl_pct: Optional[float] = None
    exit_price: Optional[float] = None
    exit_debit_credit: Optional[float] = None
    close_date: Optional[str] = None
    realized_pnl: Optional[float] = None
    realized_pnl_percent: Optional[float] = None
    exit_reason: Optional[str] = None
    close_notes: Optional[str] = None
    pnl_overridden: Optional[bool] = None
    pnl_override_reason: Optional[str] = None


@command_center_router.post("/portfolio/close")
def post_portfolio_close(body: PortfolioCloseBody, auth_email: str = Depends(require_access_email)):
    email = normalize_email(auth_email)
    state = get_user_state(email)
    port = list(state.get("portfolio") or [])
    found = False
    tag = (body.mistake_tag or "").strip()
    for p in port:
        if not isinstance(p, dict):
            continue
        if str(p.get("id")) != body.id:
            continue
        if p.get("status") != "open":
            break
        p["status"] = "closed"
        p["exitDate"] = body.close_date or datetime.now(timezone.utc).date().isoformat()
        if body.pnl_pct is not None:
            p["pnlPct"] = body.pnl_pct
        if body.exit_price is not None:
            p["exit_price"] = body.exit_price
        if body.exit_debit_credit is not None:
            p["exit_debit_credit"] = body.exit_debit_credit
        if body.realized_pnl is not None:
            p["realized_pnl"] = body.realized_pnl
        if body.realized_pnl_percent is not None:
            p["realized_pnl_percent"] = body.realized_pnl_percent
        if body.exit_reason is not None:
            p["exit_reason"] = body.exit_reason
        if body.close_notes is not None:
            p["close_notes"] = body.close_notes
        if body.pnl_overridden is not None:
            p["pnl_overridden"] = body.pnl_overridden
        if body.pnl_override_reason is not None:
            p["pnl_override_reason"] = body.pnl_override_reason
        notes = str(p.get("notes") or "")
        if tag:
            p["notes"] = (notes + "\n" if notes else "") + f"[mistake_tag] {tag}"
        found = True
        closed_pos = p
        break
    if not found:
        raise HTTPException(status_code=404, detail="Open position not found")
    saved = save_user_state(email, state.get("watchlist") or [], port)
    # Sync close to Journal — find matching OPEN entry and close it
    try:
        ticker = str(closed_pos.get("ticker") or "").strip().upper()
        strategy = str(closed_pos.get("strategy") or "")
        expiry = str(closed_pos.get("expiry") or "")
        open_entries = get_journal_entries(email, status="OPEN")
        for je in open_entries:
            if (
                str(je.get("ticker", "")).upper() == ticker
                and je.get("strategy") == strategy
                and str(je.get("expiry", ""))[:10] == expiry[:10]
            ):
                exit_date = str(closed_pos.get("exitDate") or body.close_date or date.today().isoformat())
                update_journal_entry(
                    email,
                    je["id"],
                    status="CLOSED",
                    exit_date=exit_date,
                    underlying_exit=float(closed_pos.get("exit_price") or 0),
                    realized_pnl=float(closed_pos.get("realized_pnl") or 0),
                    exit_reason=str(body.exit_reason or "Manual exit"),
                    outcome="WIN" if float(closed_pos.get("realized_pnl") or 0) >= 0 else "LOSS",
                )
                break
    except Exception:  # noqa: BLE001
        log.warning("journal close-sync failed for %s / %s", email, closed_pos.get("ticker"))
    # Auto-resolve EXIT_SIGNAL alerts for this ticker
    try:
        alert_center_resolve_by_ticker(email, str(closed_pos.get("ticker") or ""))
    except Exception:  # noqa: BLE001
        pass
    return api_envelope({"ok": True, "portfolio": saved.get("portfolio")})


class PortfolioNoteBody(BaseModel):
    id: str = Field(..., min_length=1)
    note: str = Field(..., min_length=1)


class PortfolioRemoveBody(BaseModel):
    id: str = Field(..., min_length=1)


@command_center_router.post("/portfolio/remove")
def post_portfolio_remove(body: PortfolioRemoveBody, auth_email: str = Depends(require_access_email)):
    email = normalize_email(auth_email)
    state = get_user_state(email)
    port = list(state.get("portfolio") or [])
    found = False
    _removed_ticker = ""
    for p in port:
        if isinstance(p, dict) and str(p.get("id")) == body.id:
            _removed_ticker = str(p.get("ticker") or "")
            port.remove(p)
            found = True
            break
    if not found:
        raise HTTPException(status_code=404, detail="Position not found")
    saved = save_user_state(email, state.get("watchlist") or [], port)
    # Auto-resolve EXIT_SIGNAL alerts for this ticker
    if _removed_ticker:
        try:
            alert_center_resolve_by_ticker(email, _removed_ticker)
        except Exception:  # noqa: BLE001
            pass
    return api_envelope({"ok": True, "portfolio": saved.get("portfolio")})


@command_center_router.post("/portfolio/update-note")
def post_portfolio_update_note(body: PortfolioNoteBody, auth_email: str = Depends(require_access_email)):
    email = normalize_email(auth_email)
    state = get_user_state(email)
    port = list(state.get("portfolio") or [])
    found = False
    for p in port:
        if isinstance(p, dict) and str(p.get("id")) == body.id:
            p["notes"] = body.note
            found = True
            break
    if not found:
        raise HTTPException(status_code=404, detail="Position not found")
    saved = save_user_state(email, state.get("watchlist") or [], port)
    return api_envelope({"ok": True, "portfolio": saved.get("portfolio")})


# ── My Tickers CRUD ─────────────────────────────────────────────────────────────

class MyTickerBody(BaseModel):
    symbol: str = Field(..., min_length=1, max_length=12)
    company_name: str = ""
    trade_types: list[str] = Field(default_factory=list)


class MyTickerUpdateBody(BaseModel):
    trade_types: list[str] = Field(default_factory=list)


def _seed_default_my_tickers(email: str) -> list[dict[str, Any]]:
    defaults = [
        {
            "symbol": "SPY",
            "company_name": "SPDR S&P 500 ETF Trust",
            "added_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "trade_types": ["regular", "day", "swing"],
            "is_active": True,
        },
        {
            "symbol": "QQQ",
            "company_name": "Invesco QQQ Trust",
            "added_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "trade_types": ["regular", "day", "swing"],
            "is_active": True,
        },
    ]
    state = get_user_state(email)
    save_user_state(
        email,
        state.get("watchlist") or [],
        state.get("portfolio") or [],
        my_tickers=defaults,
    )
    return defaults


def _load_my_tickers(email: str) -> list[dict[str, Any]]:
    state = get_user_state(email)
    tickers = list(state.get("my_tickers") or [])
    if not tickers:
        tickers = _seed_default_my_tickers(email)
    return tickers


def _save_my_tickers(email: str, tickers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    state = get_user_state(email)
    save_user_state(
        email,
        state.get("watchlist") or [],
        state.get("portfolio") or [],
        my_tickers=tickers,
    )
    return _load_my_tickers(email)


@command_center_router.get("/my-tickers")
def get_my_tickers(auth_email: str = Depends(require_access_email)):
    email = normalize_email(auth_email)
    tickers = _load_my_tickers(email)

    today = date.today()
    for t in tickers:
        sym = str(t.get("symbol", "")).upper().strip()
        if not sym:
            continue

        # Earnings calendar
        try:
            cal = bar_cache.get_calendar(sym)
            if isinstance(cal, dict):
                ed = cal.get("Earnings Date") or cal.get("Earnings Timestamp")
                if ed is not None:
                    if isinstance(ed, (list, tuple)) and len(ed) > 0:
                        d0 = ed[0]
                    else:
                        d0 = ed
                    if isinstance(d0, datetime):
                        d0 = d0.date()
                    elif hasattr(d0, "date") and callable(d0.date) and not isinstance(d0, date):
                        d0 = d0.date()
                    elif isinstance(d0, pd.Timestamp):
                        d0 = d0.date()
                    elif isinstance(d0, str):
                        d0 = pd.Timestamp(d0).date()
                    if isinstance(d0, date):
                        t["next_earnings_date"] = d0.isoformat()
                        t["next_earnings_days"] = (d0 - today).days
                last_ed = cal.get("Last Earnings Date")
                if last_ed and isinstance(last_ed, str):
                    t["last_earnings_date"] = last_ed
        except Exception:
            pass

        # Current price + change
        try:
            tk = yf.Ticker(sym)
            info = tk.info if tk else {}
            if info:
                prev_close = info.get("regularMarketPreviousClose") or info.get("previousClose")
                current = info.get("currentPrice") or info.get("regularMarketPrice") or info.get("price") or info.get("ask") or info.get("bid")
                if current and isinstance(current, (int, float)) and current > 0:
                    t["last_price"] = round(float(current), 2)
                    if prev_close and isinstance(prev_close, (int, float)) and prev_close > 0:
                        chg = float(current) - float(prev_close)
                        chg_pct = (chg / float(prev_close)) * 100.0
                        t["price_change"] = round(chg, 2)
                        t["price_change_pct"] = round(chg_pct, 2)
                # Pre-market
                pre = info.get("preMarketPrice")
                if pre and isinstance(pre, (int, float)) and pre > 0:
                    t["pre_market_price"] = round(float(pre), 2)
                    pre_chg = info.get("preMarketChange")
                    if pre_chg and isinstance(pre_chg, (int, float)):
                        t["pre_market_change"] = round(float(pre_chg), 2)
                    pre_chg_pct = info.get("preMarketChangePercent")
                    if pre_chg_pct and isinstance(pre_chg_pct, (int, float)):
                        t["pre_market_change_pct"] = round(float(pre_chg_pct), 2)
                # Post-market (after-hours)
                post = info.get("postMarketPrice")
                if post and isinstance(post, (int, float)) and post > 0:
                    t["post_market_price"] = round(float(post), 2)
                    post_chg = info.get("postMarketChange")
                    if post_chg and isinstance(post_chg, (int, float)):
                        t["post_market_change"] = round(float(post_chg), 2)
                    post_chg_pct = info.get("postMarketChangePercent")
                    if post_chg_pct and isinstance(post_chg_pct, (int, float)):
                        t["post_market_change_pct"] = round(float(post_chg_pct), 2)
        except Exception:
            pass
    return api_envelope({"tickers": tickers})


@command_center_router.post("/my-tickers")
def post_my_ticker(body: MyTickerBody, auth_email: str = Depends(require_access_email)):
    email = normalize_email(auth_email)
    tickers = _load_my_tickers(email)
    symbol = body.symbol.strip().upper()

    existing = [t for t in tickers if str(t.get("symbol", "")).upper() == symbol]
    if existing:
        raise HTTPException(status_code=409, detail=f"{symbol} is already in My Tickers")

    entry: dict[str, Any] = {
        "symbol": symbol,
        "company_name": body.company_name.strip(),
        "added_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "trade_types": sorted(set(body.trade_types)),
        "is_active": True,
    }
    if not entry["trade_types"]:
        entry["trade_types"] = ["regular"]

    tickers.insert(0, entry)
    updated = _save_my_tickers(email, tickers)
    return api_envelope({"ok": True, "tickers": updated})


@command_center_router.patch("/my-tickers/{symbol}")
def patch_my_ticker(symbol: str, body: MyTickerUpdateBody, auth_email: str = Depends(require_access_email)):
    email = normalize_email(auth_email)
    tickers = _load_my_tickers(email)
    sym = symbol.strip().upper()
    new_types = sorted(set(body.trade_types))

    found = False
    for t in tickers:
        if str(t.get("symbol", "")).upper() == sym:
            t["trade_types"] = new_types if new_types else ["regular"]
            found = True
            break

    if not found:
        raise HTTPException(status_code=404, detail=f"{sym} not found in My Tickers")

    updated = _save_my_tickers(email, tickers)
    return api_envelope({"ok": True, "tickers": updated})


@command_center_router.delete("/my-tickers/{symbol}")
def delete_my_ticker(symbol: str, auth_email: str = Depends(require_access_email)):
    email = normalize_email(auth_email)
    tickers = _load_my_tickers(email)
    sym = symbol.strip().upper()
    filtered = [t for t in tickers if str(t.get("symbol", "")).upper() != sym]

    if len(filtered) == len(tickers):
        raise HTTPException(status_code=404, detail=f"{sym} not found in My Tickers")

    updated = _save_my_tickers(email, filtered)
    return api_envelope({"ok": True, "tickers": updated})


@command_center_router.get("/search-tickers")
def search_tickers(q: str = Query(..., min_length=1), auth_email: str = Depends(require_access_email)):
    qs = q.strip()
    if not qs:
        return api_envelope({"results": []})

    results: list[dict[str, str]] = []
    try:
        import yfinance as yf
        search = yf.Search(qs)
        for item in (search.quotes or []):
            qt = item.get("quoteType", "")
            if qt in ("EQUITY", "ETF"):
                results.append({
                    "symbol": item.get("symbol", ""),
                    "company": item.get("longname") or item.get("shortname", ""),
                    "sector": item.get("sector", "") or qt,
                })
    except Exception as exc:
        log.warning("search_tickers yf.Search(%r) failed: %s", qs, exc)

    return api_envelope({"results": results})


@command_center_router.delete("/my-tickers/{symbol}/type/{trade_type}")
def delete_my_ticker_type(symbol: str, trade_type: str, auth_email: str = Depends(require_access_email)):
    email = normalize_email(auth_email)
    tickers = _load_my_tickers(email)
    sym = symbol.strip().upper()
    ttype = trade_type.strip().lower()

    found = False
    for t in tickers:
        if str(t.get("symbol", "")).upper() == sym:
            types = t.get("trade_types") or []
            if ttype in types:
                types.remove(ttype)
                if types:
                    t["trade_types"] = types
                else:
                    tickers = [x for x in tickers if str(x.get("symbol", "")).upper() != sym]
            found = True
            break

    if not found:
        raise HTTPException(status_code=404, detail=f"{sym} not found in My Tickers")

    updated = _save_my_tickers(email, tickers)
    return api_envelope({"ok": True, "tickers": updated})


class MyTickersReorderBody(BaseModel):
    symbols: list[str]


@command_center_router.put("/my-tickers/reorder")
def put_my_tickers_reorder(body: MyTickersReorderBody, auth_email: str = Depends(require_access_email)):
    email = normalize_email(auth_email)
    tickers = _load_my_tickers(email)

    ordered: list[dict[str, Any]] = []
    seen: set[str] = set()
    for sym in body.symbols:
        key = sym.strip().upper()
        for t in tickers:
            if str(t.get("symbol", "")).upper() == key:
                ordered.append(t)
                seen.add(key)
                break

    for t in tickers:
        if str(t.get("symbol", "")).upper() not in seen:
            ordered.append(t)

    updated = _save_my_tickers(email, ordered)
    return api_envelope({"ok": True, "tickers": updated})


# ── Overnight Runner Decision Engine ─────────────────────────────────────────

class OvernightRunnerRequest(BaseModel):
    ticker: str = Field(..., min_length=1)
    current_price: float
    vwap: float
    orh: float
    orl: float
    intraday_highs: list[float] = Field(default_factory=list)
    volume_today: float = 0
    avg_volume_20d: float = 0
    spy_trend_score: float = 0
    qqq_trend_score: float = 0
    ticker_trend_score: float = 0
    t1_hit: bool = False
    t2_hit: bool = False
    market_regime: str = "NEUTRAL"


class OvernightRunnerResponse(BaseModel):
    runner_score: int
    verdict: str
    confidence: str
    conditions: dict
    recommended_stop: float | None = None
    recommended_size_pct: int | None = None


@command_center_router.post("/day-trade/overnight-runner", response_model=OvernightRunnerResponse)
def post_overnight_runner(body: OvernightRunnerRequest, auth_email: str = Depends(require_access_email)):
    score = 0
    conditions = {}

    # Condition 1: Price Above VWAP
    above_vwap = body.current_price > body.vwap
    if above_vwap:
        score += 25
        conditions["above_vwap"] = {"pass": True, "label": "Above VWAP", "points": 25}
    else:
        conditions["above_vwap"] = {"pass": False, "label": "Above VWAP", "points": 0}

    # Condition 2: Price Above ORH
    above_orh = body.current_price > body.orh
    if above_orh:
        score += 20
        conditions["above_orh"] = {"pass": True, "label": "Above ORH", "points": 20}
    else:
        conditions["above_orh"] = {"pass": False, "label": "Above ORH", "points": 0}

    # Condition 3: Higher High Structure (last 5 swing highs)
    hh_intact = False
    if len(body.intraday_highs) >= 3:
        last_5 = body.intraday_highs[-5:] if len(body.intraday_highs) >= 5 else body.intraday_highs
        hh_intact = all(last_5[i] > last_5[i + 1] for i in range(len(last_5) - 1))
    if hh_intact:
        score += 20
        conditions["hh_structure"] = {"pass": True, "label": "Higher Highs Intact", "points": 20}
    else:
        conditions["hh_structure"] = {"pass": False, "label": "Higher Highs Intact", "points": 0}

    # Condition 4: Volume Confirmation
    vol_ratio = body.volume_today / body.avg_volume_20d if body.avg_volume_20d > 0 else 0
    if vol_ratio > 1.20:
        score += 15
        conditions["volume"] = {"pass": True, "label": f"Volume {vol_ratio:.1f}x Average", "points": 15}
    elif vol_ratio > 1.00:
        score += 10
        conditions["volume"] = {"pass": True, "label": f"Volume {vol_ratio:.1f}x Average", "points": 10}
    else:
        conditions["volume"] = {"pass": False, "label": f"Volume {vol_ratio:.1f}x Average", "points": 0}

    # Condition 5: Market Alignment
    spy_strong = body.spy_trend_score >= 70
    qqq_strong = body.qqq_trend_score >= 70
    spy_good = body.spy_trend_score >= 60
    qqq_good = body.qqq_trend_score >= 60

    if spy_strong and qqq_strong:
        score += 20
        conditions["market_alignment"] = {"pass": True, "label": "SPY + QQQ Bullish", "points": 20}
    elif spy_good and qqq_good:
        score += 10
        conditions["market_alignment"] = {"pass": True, "label": "SPY + QQQ Neutral-Bullish", "points": 10}
    else:
        conditions["market_alignment"] = {"pass": False, "label": "SPY + QQQ Alignment Weak", "points": 0}

    score = min(score, 100)

    # Verdict
    if score >= 80:
        verdict = "KEEP 25% OVERNIGHT"
        confidence = "HIGH"
        recommended_size_pct = 25
    elif score >= 60:
        verdict = "OPTIONAL RUNNER"
        confidence = "MEDIUM"
        recommended_size_pct = 15
    else:
        verdict = "CLOSE ENTIRE POSITION"
        confidence = "LOW"
        recommended_size_pct = 0

    # Recommended stop
    stop = None
    if verdict != "CLOSE ENTIRE POSITION":
        # Use max of VWAP, previous swing low - not requiring recent lows data, use VWAP as floor
        stop = round(max(body.vwap, body.current_price * 0.97), 2)

    return OvernightRunnerResponse(
        runner_score=score,
        verdict=verdict,
        confidence=confidence,
        conditions=conditions,
        recommended_stop=stop,
        recommended_size_pct=recommended_size_pct,
    )


# ─── Track Mode (post-exit re-entry monitoring) ──────────────────────────────


class TrackModeAddBody(BaseModel):
    ticker: str
    notes: str = ""


class TrackModeRemoveBody(BaseModel):
    ticker: str


@command_center_router.get("/track-mode")
def get_track_mode(auth_email: str = Depends(require_access_email)):
    """List tracked tickers with current prices."""
    email = normalize_email(auth_email)
    items = track_mode_list(email)
    out = []
    for item in items:
        ticker = item["ticker"]
        price = None
        try:
            tk = yf.Ticker(ticker)
            fast = tk.fast_info
            price = round(float(fast.last_price), 2) if fast.last_price else None
        except Exception:
            pass
        out.append({
            "ticker": ticker,
            "current_price": price,
            "added_at_ms": item["added_at_ms"],
            "notes": item.get("notes", ""),
        })
    return {"tracked": out, "count": len(out)}


@command_center_router.post("/track-mode/add")
def post_track_mode_add(body: TrackModeAddBody, auth_email: str = Depends(require_access_email)):
    """Start tracking a ticker for post-exit re-entry monitoring."""
    email = normalize_email(auth_email)
    ok = track_mode_add(email, body.ticker.upper().strip(), body.notes)
    return {"ok": ok, "ticker": body.ticker.upper().strip()}


@command_center_router.post("/track-mode/remove")
def post_track_mode_remove(body: TrackModeRemoveBody, auth_email: str = Depends(require_access_email)):
    """Stop tracking a ticker."""
    email = normalize_email(auth_email)
    ok = track_mode_remove(email, body.ticker.upper().strip())
    return {"ok": ok, "ticker": body.ticker.upper().strip()}
