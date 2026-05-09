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

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from alerts.alert_service import build_alert_center_payload
from auth_routes import require_access_email
import bar_cache
from storage import (
    alert_center_acknowledge,
    alert_center_active_count,
    alert_center_append_note,
    alert_center_critical_count,
    alert_center_list,
    alert_center_resolve,
    ensure_demo_alert_center_rows,
    get_user_state,
    normalize_email,
    save_user_state,
)
from trade_aggregator import build_command_center_payload

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

    # ── Live engine aggregation ────────────────────────────────────────────────
    payload = build_command_center_payload(
        email=email,
        engine_filter=engine,
        signal_filter=signal,
        direction_filter=direction,
        risk_filter=risk,
    )

    # ── Live market summary overlay ────────────────────────────────────────────
    _stub_market_summary: dict[str, Any] = {
        "market_mode":      "—",
        "best_style_today": "—",
        "spy_trend":        "—",
        "qqq_trend":        "—",
        "vix_risk":         "—",
        "risk_status":      "—",
        "ai_coach_summary": "Market data unavailable — check connection.",
    }
    live_mkt = _fetch_live_market_summary()
    stale    = live_mkt is None   # True only when Yahoo Finance is unreachable
    payload["market_summary"] = {**_stub_market_summary, **(live_mkt or {})}

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
    severity: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    ticker: Optional[str] = Query(None),
    active_only: bool = Query(False),
):
    email = normalize_email(auth_email)
    ensure_demo_alert_center_rows(email)
    engine_filter = engine_type or engine
    items, total = alert_center_list(
        email,
        engine=engine_filter,
        severity=severity,
        status=status,
        ticker=ticker,
        active_only=active_only,
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


def _compute_positions_pnl(
    open_pos: list[dict],
    closed_pos: list[dict],
) -> dict[str, Any]:
    """
    Compute Total P&L and Day P&L from raw portfolio positions.

    Closed positions — realized P&L:
        dollar = (pnlPct / 100) × max_profit × 100 × contracts
        Matches PortfolioPage.tsx totalRealisedPnl formula exactly.

    Open positions — mark-to-market P&L (Black-Scholes):
        Fetches current & previous-day underlying price from Yahoo Finance.
        Uses stored leg IV/strike/mid_price with bs_price() from backtest.py.

    Day P&L = sum of (mtm_today − mtm_yesterday) × 100 × contracts across
              all open positions that have live price data.

    Returns dict with keys: total_pl, day_pl (either may be None).
    """
    SHARES = 100  # shares per contract (standard)

    # ── 1. Realized P&L from closed positions ─────────────────────────────
    realized_pnl   = 0.0
    realized_count = 0
    for p in closed_pos:
        pnl_pct    = p.get("pnlPct")
        if pnl_pct is None:
            continue
        max_profit = _float_or(p.get("max_profit"), 0.0)
        contracts  = max(1.0, _float_or(p.get("contracts"), 1.0))
        if max_profit <= 0:
            continue
        realized_pnl += (_float_or(pnl_pct, 0.0) / 100.0) * max_profit * SHARES * contracts
        realized_count += 1

    # ── 2. MTM P&L from open positions ────────────────────────────────────
    open_with_legs = [
        p for p in open_pos
        if isinstance(p, dict) and isinstance(p.get("legs"), list) and p.get("legs")
    ]

    per_position_pnl: dict[str, dict[str, float]] = {}
    for p in closed_pos:
        pid = str(p.get("id", ""))
        pp = p.get("pnlPct")
        if pid and pp is not None:
            mp = _float_or(p.get("max_profit"), 0.0)
            cc = max(1.0, _float_or(p.get("contracts"), 1.0))
            if mp > 0:
                dollar = (float(pp) / 100.0) * mp * SHARES * cc
                per_position_pnl[pid] = {"pnl": round(dollar, 2), "pnl_pct": float(pp)}

    if not open_with_legs:
        total_pl = round(realized_pnl, 2) if realized_count > 0 else None
        return {"total_pl": total_pl, "day_pl": None, "per_position": per_position_pnl}

    try:
        from datetime import datetime
        from backtest import bs_price, RISK_FREE_RATE  # type: ignore[import]

        # Fetch (current_close, prev_close) for each unique underlying ticker via bar_cache
        tickers = list({
            str(p.get("ticker", "")).upper()
            for p in open_with_legs
            if p.get("ticker")
        })
        price_map: dict[str, tuple[float, float]] = {}
        for sym in tickers:
            try:
                h = bar_cache.get_history(sym, period="5d", interval="1d", auto_adjust=True)
                if h is None or h.empty:
                    continue
                c = h["Close"].dropna()
                if len(c) < 2:
                    continue
                price_map[sym] = (float(c.iloc[-1]), float(c.iloc[-2]))
            except Exception:
                continue

        today       = datetime.today().date()
        mtm_total   = 0.0
        day_total   = 0.0
        has_mtm     = False

        for p in open_with_legs:
            sym = str(p.get("ticker", "")).upper()
            if sym not in price_map:
                continue

            S_now, S_prev = price_map[sym]

            try:
                expiry_date = datetime.strptime(str(p.get("expiry", ""))[:10], "%Y-%m-%d").date()
                T_years = max(0.0, (expiry_date - today).days / 365.0)
            except Exception:
                continue

            contracts = max(1.0, _float_or(p.get("contracts"), 1.0))
            legs      = p["legs"]

            def _mtm_pnl(S: float, *, _T: float = T_years, _legs: list = legs) -> float:
                pnl = 0.0
                for leg in _legs:
                    iv       = float(leg.get("iv") or 0.0)
                    if iv < 0.005:
                        iv = 0.25   # fallback HV proxy (matches main.py)
                    strike   = float(leg.get("strike") or 0.0)
                    entry_p  = float(leg.get("mid_price") or 0.0)
                    opt_type = str(leg.get("option_type") or "CALL").upper()
                    action   = str(leg.get("action") or "BUY").upper()
                    curr_p   = bs_price(S, strike, _T, RISK_FREE_RATE, iv, opt_type)
                    pnl += (entry_p - curr_p) if action == "SELL" else (curr_p - entry_p)
                return pnl

            pnl_now  = _mtm_pnl(S_now)
            pnl_prev = _mtm_pnl(S_prev)

            mtm_total += pnl_now  * SHARES * contracts
            day_total += (pnl_now - pnl_prev) * SHARES * contracts
            has_mtm    = True

            pid = str(p.get("id", ""))
            if pid:
                pnl_dollar = round(pnl_now * SHARES * contracts, 2)
                pct_ref = abs(_float_or(p.get("max_loss"), 0.0)) * SHARES * contracts
                pnl_pct = round((pnl_dollar / pct_ref) * 100, 2) if pct_ref > 0 else 0.0
                per_position_pnl[pid] = {"pnl": pnl_dollar, "pnl_pct": pnl_pct}

        total_pl = round(realized_pnl + mtm_total, 2) if (realized_count > 0 or has_mtm) else None
        day_pl   = round(day_total, 2) if has_mtm else None
        return {"total_pl": total_pl, "day_pl": day_pl, "per_position": per_position_pnl}

    except Exception:  # noqa: BLE001
        # Live price fetch failed — fall back to realized-only
        total_pl = round(realized_pnl, 2) if realized_count > 0 else None
        return {"total_pl": total_pl, "day_pl": None, "per_position": per_position_pnl}


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


def _portfolio_position_row(p: dict[str, Any], *, closed: bool) -> dict[str, Any]:
    contracts = _float_or(p.get("contracts"), 0.0)
    if contracts <= 0:
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
        "contracts": round(contracts, 4) if not closed else round(contracts, 4),
        "shares": None,
        "entry_price": entry,
        "current_price": None,
        "pnl_amount": None,
        "pnl_percent": None,
        "target": None,
        "stop_loss": None,
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
    for p in open_pos:
        if not isinstance(p, dict):
            continue
        t = str(p.get("ticker", "")).upper()
        strat = str(p.get("strategy", "")) or "Unknown"
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

    # Options vs stock position counts (mirrors frontend derivedOpt logic)
    options_pos_count = sum(
        1 for p in open_pos
        if isinstance(p, dict) and isinstance(p.get("legs"), list) and len(p["legs"]) > 0
    )
    stock_pos_count = max(0, len(open_pos) - options_pos_count)

    # P&L: realized (closed) + MTM (open via Black-Scholes + live yfinance prices)
    pnl_data = _compute_positions_pnl(open_pos, closed)

    summary = {
        "total_open_positions":   len(open_pos),
        "options_positions":      options_pos_count,
        "stock_positions":        stock_pos_count,
        "watchlist_count":        len(unified_wl),
        "watchlist_alerts":       alerts_n,
        "alert_center_count":     alerts_n,
        "critical_alerts":        critical_n,
        "total_capital_used":     round(options_cap, 2),
        "options_capital":        round(options_cap, 2),
        "stock_capital":          0.0,
        "total_pl":               pnl_data["total_pl"],
        "day_pl":                 pnl_data["day_pl"],
        "risk_status":            "elevated" if options_cap > 20000 else "normal",
        "alerts_count":           alerts_n,
        "open_risk_notional":     round(options_cap, 2),
        "closed_trades_count":    len(closed),
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
        "stock_exposure": 0.0,
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
    }


@command_center_router.get("/positions-center")
def get_positions_center(auth_email: str = Depends(require_access_email)):
    email = normalize_email(auth_email)
    state = get_user_state(email)
    ensure_demo_alert_center_rows(email)
    return api_envelope(_positions_center_payload(state, email=email), stale=False)


class WatchlistTickerBody(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=12)
    notes: Optional[str] = None


@command_center_router.post("/watchlist/add")
def post_watchlist_add(body: WatchlistTickerBody, auth_email: str = Depends(require_access_email)):
    email = normalize_email(auth_email)
    state = get_user_state(email)
    wl = list(state.get("watchlist") or [])
    t = body.ticker.strip().upper()
    if any(str(x.get("ticker", "")).upper() == t for x in wl if isinstance(x, dict)):
        return api_envelope({"ok": True, "watchlist": wl})
    wl.append(
        {
            "ticker": t,
            "addedAt": datetime.now(timezone.utc).date().isoformat(),
            **({"notes": body.notes.strip()} if body.notes and body.notes.strip() else {}),
        }
    )
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
    port.append(pos)
    saved = save_user_state(email, state.get("watchlist") or [], port)
    return api_envelope({"ok": True, "portfolio": saved.get("portfolio")})


class PortfolioCloseBody(BaseModel):
    id: str = Field(..., min_length=1)
    mistake_tag: Optional[str] = None
    pnl_pct: Optional[float] = None


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
        p["exitDate"] = datetime.now(timezone.utc).date().isoformat()
        if body.pnl_pct is not None:
            p["pnlPct"] = body.pnl_pct
        notes = str(p.get("notes") or "")
        if tag:
            p["notes"] = (notes + "\n" if notes else "") + f"[mistake_tag] {tag}"
        found = True
        break
    if not found:
        raise HTTPException(status_code=404, detail="Open position not found")
    saved = save_user_state(email, state.get("watchlist") or [], port)
    return api_envelope({"ok": True, "portfolio": saved.get("portfolio")})


class PortfolioNoteBody(BaseModel):
    id: str = Field(..., min_length=1)
    note: str = Field(..., min_length=1)


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
