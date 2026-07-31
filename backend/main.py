"""
main.py — FastAPI Backend
==========================
Run: uvicorn main:app --reload --port 9000
"""

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd
import numpy as np
from math import erf, log, sqrt
from dataclasses import asdict
import smtplib
import os
import json
import logging
import threading
import time
from collections import defaultdict
import html
import urllib.error
import urllib.request
from typing import Any, Optional
from urllib.parse import quote, urlparse
from datetime import datetime, time as dt_time, timedelta, timezone
from zoneinfo import ZoneInfo
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr
from pathlib import Path
from dotenv import load_dotenv
from pydantic import BaseModel, Field

ENV_PATH = Path(__file__).with_name(".env")
load_dotenv(ENV_PATH)

# From-address fallback for SendGrid and SMTP (envelope + headers).
# Override per deployment with OPTION_ADVISOR_DEFAULT_FROM_EMAIL or explicit SMTP_* / SENDGRID_FROM_*.
DEFAULT_MAIL_FROM = os.getenv("OPTION_ADVISOR_DEFAULT_FROM_EMAIL", "adminzetayuai@gmail.com").strip()

from models import (
    AnalyzeRequest, AnalyzeResponse, RecommendationOut, OptionLegOut,
    OptionRowOut, OptionChainLiquidityResponse, PricePoint, SignalsOut, ScoreBreakdown, QuoteQualitySummary, KeyLevelOut, OptionsFlowOut,
    UserDataRequest, UserDataResponse, AlertEmailRequest, AlertItem,
    TestEmailRequest, BacktestRequest,
    DayTradeRequest, DayTradeResponse, CarryTradeRequest, CarryTradeResponse, TradeDashboardStoryRequest,
    SwingTradeRequest, SwingTradeResponse,
    ActiveTradeEnterRequest, ActiveTradeEnterResponse, ActiveTradeOut, ActiveTradeListResponse,
)
import bar_cache
from bar_cache import get_history as _bc_hist, get_info as _bc_info
from bar_cache import get_option_dates as _bc_opt_dates, get_option_chain as _bc_chain
from analysis import build_hv_series, compute_iv_rank, generate_signals
from day_trade import run_day_trade_scan, underlying_intraday_snapshot_for_active_trade, clear_scan_cache as _clear_day_scan_cache
from carry_trade import run_carry_trade_scan, carry_analysis_to_dict
from trade_structure import build_trade_dashboard_story
from services.market_structure_service import classify_structure as _classify_market_structure
from services.pivot_detection_service import detect_confirmed_pivots as _detect_confirmed_pivots
from ai_coach import get_ai_coach
from swing_trade import (
    run_swing_trade_scan,
    clear_scan_cache as _clear_swing_scan_cache,
    build_swing_chart_timeframe_series,
    build_swing_market_structure,
)
from unified_analysis import serialize_day_trade, serialize_swing_trade, serialize_regular_trade
from quote_cache import get_quotes as _get_quotes
from active_trade_decision import build_active_trade_decision
from engine import run_engine, MIN_CREDIT_PCT_OF_WIDTH, TARGET_SHORT_DELTA_CREDIT, DTE_CREDIT_MIN, DTE_CREDIT_MAX
from day_trade_workspace import (
    build_day_trade_workspace_response,
    build_day_trade_workspace_unavailable_response,
)
from day_trade_workspace_models import DayTradeWorkspaceResponse as DayTradeWorkspaceResponseModel
from auth_routes import auth_router, ensure_same_user, require_access_email
import exit_monitor
from command_center_router import command_center_router, api_envelope, _normalize_my_tickers_list, _seed_default_my_tickers
from decision_resolver import resolve_trade_decision
from calculation_vault import (
    CALCULATION_ROUTER_VERSION,
    CURRENT_FORMULA_PACK_VERSION,
    CURRENT_METRIC_DEFINITIONS_VERSION,
    DAY_TRADE_WORKSPACE_ENGINE_VERSION,
    TRADE_WORKSHEET_ENGINE_VERSION,
    create_failed_calculation_run,
    create_calculation_snapshot,
    day_trade_workspace_metric_definitions,
    list_metric_definitions,
    list_supported_calculation_run_types,
    trade_worksheet_metric_definitions,
)
from storage import (
    alert_center_active_counts_by_ticker,
    alert_center_create,
    add_user_alert,
    add_day_trade_alert_event,
    DAY_TRADE_ALERT_RETENTION_MS,
    get_dashboard_tickers,
    get_day_trade_watchlist_last,
    get_user_state,
    init_db,
    list_day_trade_alert_events,
    list_user_states,
    normalize_email,
    save_dashboard_tickers,
    save_user_state,
    update_user_alert_email,
    upsert_day_trade_watchlist_last,
    fetch_iv_atm_history_strict_before,
    upsert_iv_atm_snapshot,
    insert_active_trade,
    list_active_trades_open_opened_today_et,
    get_active_trade,
    exit_active_trade,
    get_ticker_state_last,
    get_eod_journal_snapshot,
    list_eod_journal_snapshots,
    upsert_ticker_state_last,
    list_eod_journal_dates,
    upsert_eod_journal_snapshot,
)
from score_normalizer import normalize_day_score, normalize_regular_score, normalize_swing_score

# ── SMTP config from environment (optional — email skipped if absent) ─────────
def _smtp_config() -> dict:
    # Reload local .env on each send/test so local credential edits are testable
    # without restarting uvicorn. Existing systemd EnvironmentFile values remain.
    load_dotenv(ENV_PATH, override=True)
    host = os.getenv("SMTP_HOST", "smtp.gmail.com").strip()
    raw_password = os.getenv("SMTP_PASSWORD", "").strip()
    password = raw_password.replace(" ", "")
    if "gmail.com" in host.lower():
        password = password.replace("-", "")
    user = os.getenv("SMTP_USER", "").strip()
    from_explicit = os.getenv("SMTP_FROM", "").strip()
    from_addr = from_explicit or user or DEFAULT_MAIL_FROM
    return {
        "host": host,
        "port": int(os.getenv("SMTP_PORT", "587")),
        "user": user,
        "password": password,
        "from_addr": from_addr,
        "missing": [
            key for key, value in {
                "SMTP_USER": user,
                "SMTP_PASSWORD": password,
            }.items()
            if not value
        ],
    }


# ── SendGrid (Twilio) — Web API v3 — preferred when SENDGRID_API_KEY + from are set ──
def _sendgrid_config() -> dict:
    load_dotenv(ENV_PATH, override=True)
    api_key = os.getenv("SENDGRID_API_KEY", "").strip()
    from_email = (
        os.getenv("SENDGRID_FROM_EMAIL", "").strip()
        or os.getenv("SMTP_FROM", "").strip()
        or os.getenv("SMTP_USER", "").strip()
        or DEFAULT_MAIL_FROM
    )
    from_name = os.getenv("SENDGRID_FROM_NAME", "OptionAdvisor").strip() or "OptionAdvisor"
    missing: list[str] = []
    if not api_key:
        missing.append("SENDGRID_API_KEY")
    if not from_email:
        missing.append("SENDGRID_FROM_EMAIL (no fallback; set SENDGRID_FROM_EMAIL or SMTP_FROM/SMTP_USER or DEFAULT_MAIL_FROM)")
    return {
        "api_key": api_key,
        "from_email": from_email,
        "from_name": from_name,
        "missing": missing,
    }


def _email_provider() -> str:
    """'sendgrid' if API + from are set; else 'smtp' if SMTP complete; else 'none'."""
    if len(_sendgrid_config()["missing"]) == 0:
        return "sendgrid"
    if len(_smtp_config()["missing"]) == 0:
        return "smtp"
    return "none"


def _send_html_via_sendgrid(to_email: str, to_name: str | None, subject: str, html: str) -> None:
    sg = _sendgrid_config()
    if sg["missing"]:
        raise ValueError(f"SendGrid incomplete: {', '.join(sg['missing'])}")
    to_addr = to_email.strip()
    to: dict[str, str] = {"email": to_addr}
    if to_name and (nm := to_name.strip()):
        to["name"] = nm
    payload = {
        "personalizations": [{"to": [to]}],
        "from": {"email": sg["from_email"], "name": sg["from_name"]},
        "subject": subject,
        "content": [{"type": "text/html", "value": html}],
    }
    raw = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        "https://api.sendgrid.com/v3/mail/send",
        data=raw,
        method="POST",
        headers={
            "Authorization": f"Bearer {sg['api_key']}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            code = getattr(resp, "status", None) or resp.getcode()
            if code not in (200, 202):
                body = resp.read().decode("utf-8", errors="replace")
                raise RuntimeError(f"SendGrid unexpected status {code}: {body}")
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace") or str(e.reason)
        raise RuntimeError(f"SendGrid HTTP {e.code}: {detail}") from e


def _send_html_via_smtp(to_email: str, to_name: str | None, subject: str, html: str) -> None:
    smtp = _smtp_config()
    if smtp["missing"]:
        raise ValueError(f"SMTP incomplete: {', '.join(smtp['missing'])}")
    display_name = (to_name or "").strip()
    recipient = formataddr((display_name, to_email)) if display_name else to_email
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = smtp["from_addr"]
    msg["To"] = recipient
    msg.attach(MIMEText(html, "html"))
    with smtplib.SMTP(smtp["host"], smtp["port"], timeout=25) as server:
        server.ehlo()
        server.starttls()
        server.login(smtp["user"], smtp["password"])
        server.sendmail(smtp["from_addr"], to_email, msg.as_string())


def _deliver_html_email(to_email: str, to_name: str | None, subject: str, html: str) -> str:
    """
    Send one HTML email using SendGrid (if configured) or SMTP.
    Returns the provider label used ('sendgrid' or 'smtp').
    """
    provider = _email_provider()
    if provider == "none":
        sg_m = _sendgrid_config()["missing"]
        sm_m = _smtp_config()["missing"]
        raise ValueError(
            "No email provider configured. SendGrid needs: "
            + (", ".join(sg_m) if sg_m else "(complete)")
            + ". SMTP needs: "
            + (", ".join(sm_m) if sm_m else "(complete)")
        )
    if provider == "sendgrid":
        _send_html_via_sendgrid(to_email, to_name, subject, html)
        return "sendgrid"
    _send_html_via_smtp(to_email, to_name, subject, html)
    return "smtp"


USER_ALERT_EMAIL_DISABLED_MESSAGE = "Email alerts are turned off in your account settings."


def _user_wants_trade_alert_emails(user_state: dict) -> bool:
    raw = user_state.get("alert_email_enabled")
    if raw is None:
        return True
    if isinstance(raw, bool):
        return raw
    try:
        return bool(int(raw))
    except (TypeError, ValueError):
        return True


ALERT_SCAN_INTERVAL_SECONDS = int(os.getenv("ALERT_SCAN_INTERVAL_SECONDS", "300"))  # 5-min default for day trade
ALERT_SCAN_START_DELAY_SECONDS = int(os.getenv("ALERT_SCAN_START_DELAY_SECONDS", "20"))
ALERT_SCAN_MARKET_HOURS_ONLY = os.getenv("ALERT_SCAN_MARKET_HOURS_ONLY", "true").lower() != "false"

# Day trade alert window (PST/PDT): 5:00 AM – 1:00 PM.  Next day starts at 5 AM.
_DAY_TRADE_ALERT_START_HOUR_PT = 5   # 5:00 AM PT
_DAY_TRADE_ALERT_END_HOUR_PT   = 13  # 1:00 PM PT

# Swing trade alert window (PST/PDT): 6:00 AM – 2:00 PM, every 2 hours.
_SWING_TRADE_ALERT_START_HOUR_PT   = 6     # 6:00 AM PT
_SWING_TRADE_ALERT_END_HOUR_PT     = 14    # 2:00 PM PT
SWING_ALERT_SCAN_INTERVAL_SECONDS  = int(os.getenv("SWING_ALERT_SCAN_INTERVAL_SECONDS", "7200"))
ALERT_ANALYSIS_CACHE_TTL_SECONDS = int(os.getenv("ALERT_ANALYSIS_CACHE_TTL_SECONDS", str(ALERT_SCAN_INTERVAL_SECONDS)))
ALERT_SCAN_WEEKS_OUT = 4
# Strategy Finder / email deeplink ?weeks= must match frontend MULTI_WEEK_TARGETS
FINDER_VALID_WEEKS_OUT = frozenset({0, 1, 2, 4, 6})
ALERT_SCAN_SPREAD_WIDTH = 5

# User-facing analyze endpoint cache TTL:
#   90 seconds during market hours (fast refresh for live trading)
#   10 minutes outside market hours (pre/post market data changes slowly)
ANALYZE_CACHE_TTL_MARKET_HOURS   = int(os.getenv("ANALYZE_CACHE_TTL_MARKET_HOURS",   "90"))
ANALYZE_CACHE_TTL_OFF_HOURS      = int(os.getenv("ANALYZE_CACHE_TTL_OFF_HOURS",      "600"))
SIGNAL_FEED_CACHE_TTL_SECONDS    = int(os.getenv("SIGNAL_FEED_CACHE_TTL_SECONDS",    "900"))  # 15 minutes
DAY_TRADE_QUOTE_WARM_INTERVAL_SECONDS = int(os.getenv("DAY_TRADE_QUOTE_WARM_INTERVAL_SECONDS", "300"))
DAY_TRADE_QUOTE_WARM_START_DELAY_SECONDS = int(os.getenv("DAY_TRADE_QUOTE_WARM_START_DELAY_SECONDS", "30"))
DAY_TRADE_QUOTE_BATCH_SIZE = int(os.getenv("DAY_TRADE_QUOTE_BATCH_SIZE", "5"))
DAY_TRADE_QUOTE_WARM_MARKET_HOURS_ONLY = os.getenv("DAY_TRADE_QUOTE_WARM_MARKET_HOURS_ONLY", "true").lower() != "false"

# Separate in-memory cache for user-facing /api/analyze requests
analyze_user_cache: dict[str, tuple[float, "AnalyzeResponse"]] = {}
analyze_user_cache_lock = threading.Lock()

analysis_cache_lock = threading.Lock()
analysis_cache: dict[str, tuple[float, AnalyzeResponse]] = {}

signal_feed_cache_lock = threading.Lock()
signal_feed_cache: dict[str, tuple[float, tuple[Any, ...], list[dict[str, Any]], dict[str, Any]]] = {}

# Tracks whether we logged the background-link warning (see `_option_advisor_public_base`).
_background_email_default_link_logged = False

app = FastAPI(title="Strategy Finder API", version="2.0")
init_db()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        o.strip()
        for o in os.getenv(
            "OPTION_ADVISOR_CORS_ORIGINS",
            "http://localhost:4200,http://localhost:3000",
        ).split(",")
        if o.strip()
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api/auth")
app.include_router(command_center_router, prefix="/api")

from tradedesk_routes import desk_router
app.include_router(desk_router, prefix="/api")


def safe_float(val, default=0.0) -> float:
    try:
        if val is None or (isinstance(val, float) and np.isnan(val)):
            return default
        return float(val)
    except:
        return default


def safe_int(val, default=0) -> int:
    try:
        if val is None or (isinstance(val, float) and np.isnan(val)):
            return default
        return int(val)
    except:
        return default


def format_market_cap(mc: float) -> str:
    if mc >= 1e12:
        return f"${mc/1e12:.2f}T"
    elif mc >= 1e9:
        return f"${mc/1e9:.1f}B"
    elif mc >= 1e6:
        return f"${mc/1e6:.0f}M"
    return "N/A"


def normal_cdf(value: float) -> float:
    return 0.5 * (1.0 + erf(value / sqrt(2.0)))


def estimate_delta(row: pd.Series, current_price: float, expiry: str, option_type: str) -> float | None:
    raw_delta = row.get("delta", None)
    if raw_delta is not None and not pd.isna(raw_delta):
        return round(safe_float(raw_delta), 3)

    strike = safe_float(row.get("strike", 0))
    iv = safe_float(row.get("impliedVolatility", 0))
    if current_price <= 0 or strike <= 0 or iv <= 0:
        return None

    try:
        expiry_date = pd.to_datetime(expiry).to_pydatetime()
        dte = max((expiry_date - pd.Timestamp.today().to_pydatetime()).days, 1)
        years = max(dte / 365.0, 1 / 365.0)
        d1 = (log(current_price / strike) + 0.5 * iv * iv * years) / (iv * sqrt(years))
        call_delta = normal_cdf(d1)
        delta = call_delta if option_type == "CALL" else call_delta - 1
        return round(delta, 3)
    except Exception:
        return None


def chain_to_output(df: pd.DataFrame, current_price: float, expiry: str, option_type: str) -> list[OptionRowOut]:
    from engine import validate_option_quote
    rows = []
    for _, row in df.iterrows():
        iv_raw = safe_float(row.get("impliedVolatility", 0))
        quality, quality_reason = validate_option_quote(row, current_price, option_type)
        rows.append(OptionRowOut(
            strike=safe_float(row["strike"]),
            last_price=safe_float(row.get("lastPrice", 0)),
            bid=safe_float(row.get("bid", 0)),
            ask=safe_float(row.get("ask", 0)),
            volume=safe_int(row.get("volume", 0)),
            open_interest=safe_int(row.get("openInterest", 0)),
            implied_volatility=f"{round(iv_raw * 100, 1)}%",
            delta=estimate_delta(row, current_price, expiry, option_type),
            data_quality=quality,
            data_quality_reason=quality_reason,
        ))
    return rows


def _compute_quote_quality_summary(
    calls_chain: list[OptionRowOut],
    puts_chain: list[OptionRowOut],
    underlying_live: bool,
) -> QuoteQualitySummary:
    """Roll up per-strike Yahoo quote flags into user-facing stale/incomplete messaging."""
    from collections import Counter

    rows = list(calls_chain) + list(puts_chain)
    n = len(rows)
    underlying_src = "live" if underlying_live else "previous_close"
    banner_lines: list[str] = []
    show = False

    if not underlying_live:
        show = True
        banner_lines.append(
            "Underlying price is from the last daily close — Yahoo did not return a live quote; "
            "option marks vs spot may be wrong until data refreshes."
        )

    if n == 0:
        return QuoteQualitySummary(
            chain_rows_total=0,
            underlying_quote_source=underlying_src,
            banner_show=show,
            banner_lines=banner_lines,
        )

    qualities = Counter(((getattr(r, "data_quality", None) or "OK").strip().upper()) for r in rows)
    ok_n = qualities.get("OK", 0)
    stale_n = qualities.get("STALE", 0)
    unreliable_n = qualities.get("UNRELIABLE", 0)
    model_n = qualities.get("MODEL", 0)
    non_ok = stale_n + unreliable_n + model_n
    pct_non_ok = round(100.0 * non_ok / n, 1)

    if unreliable_n > 0:
        show = True
        banner_lines.append(
            f"{unreliable_n} option quote(s) failed sanity checks (mid below intrinsic) — "
            "likely stale Yahoo data. Refresh or verify with your broker."
        )

    stale_thresh = max(8, int(0.2 * n))
    if stale_n >= stale_thresh:
        show = True
        banner_lines.append(
            f"{stale_n} of {n} strikes show bid and ask at zero — using last trade only (often stale)."
        )
    elif stale_n >= 5:
        show = True
        banner_lines.append(
            f"{stale_n} strikes use last-price-only quotes (bid/ask missing); treat mids as approximate."
        )

    model_thresh = max(5, int(0.12 * n))
    if model_n >= model_thresh:
        show = True
        banner_lines.append(
            f"{model_n} strikes used model-derived mids because Yahoo bid/ask looked inconsistent with IV."
        )

    return QuoteQualitySummary(
        chain_rows_total=n,
        ok_rows=ok_n,
        stale_rows=stale_n,
        unreliable_rows=unreliable_n,
        model_rows=model_n,
        pct_non_ok=pct_non_ok,
        underlying_quote_source=underlying_src,
        banner_show=show,
        banner_lines=banner_lines,
    )


@app.get("/")
def root():
    return {"status": "ok", "message": "Strategy Finder API v2.0"}


def _is_market_hours_now() -> bool:
    if not ALERT_SCAN_MARKET_HOURS_ONLY:
        return True
    now = datetime.now(ZoneInfo("America/New_York"))
    if now.weekday() >= 5:
        return False
    return (now.hour > 9 or (now.hour == 9 and now.minute >= 30)) and now.hour < 16


def _is_day_trade_alert_window_pt() -> bool:
    """True between 5:00 AM and 1:00 PM PT on weekdays (day trade alert window)."""
    now = datetime.now(ZoneInfo("America/Los_Angeles"))
    if now.weekday() >= 5:
        return False
    return _DAY_TRADE_ALERT_START_HOUR_PT <= now.hour < _DAY_TRADE_ALERT_END_HOUR_PT


def _is_swing_trade_alert_window_pt() -> bool:
    """True between 6:00 AM and 2:00 PM PT on weekdays (swing trade alert window)."""
    now = datetime.now(ZoneInfo("America/Los_Angeles"))
    if now.weekday() >= 5:
        return False
    return _SWING_TRADE_ALERT_START_HOUR_PT <= now.hour < _SWING_TRADE_ALERT_END_HOUR_PT


def _normalize_public_origin(url: str) -> str:
    """Return usable http(s) origin with no trailing slash, or '' if invalid."""
    u = (url or "").strip().rstrip("/")
    if not u or not (u.startswith("http://") or u.startswith("https://")):
        return ""
    return u


def _spa_origin_from_request(request: Request) -> str | None:
    """Derive SPA base from browser Origin / Referer (for /api/send-alert from the user's site)."""
    origin = (
        request.headers.get("origin")
        or request.headers.get("Origin")
        or ""
    ).strip()
    if origin:
        norm = _normalize_public_origin(origin)
        if norm:
            return norm
    ref = (request.headers.get("referer") or request.headers.get("Referer") or "").strip()
    if ref:
        try:
            p = urlparse(ref)
            if p.scheme in ("http", "https") and p.netloc:
                return _normalize_public_origin(f"{p.scheme}://{p.netloc}")
        except Exception:
            return None
    return None


def _option_advisor_public_base(request: Request | None = None) -> str:
    """
    Base URL embedded in Strategy Finder GO-alert links (and hash links elsewhere).

    1. ``OPTION_ADVISOR_PUBLIC_URL`` when set — canonical SPA URL; use in production so **background**
       scanner/day-trade emails (no HTTP request) are not stuck on the localhost default.
    2. Else, if ``request`` is set (e.g. ``POST /api/send-alert`` from the browser): ``Origin``,
       then ``Referer``.
    3. Else ``OPTION_ADVISOR_EMAIL_LINK_BASE`` when set — optional fallback when (1) is unset and
       there is no request (scanner loop only); does not override the browser Origin for API calls.
    4. Else ``http://localhost:4200`` (dev default).

    Failure mode: on a production droplet with SMTP/SendGrid set but ``OPTION_ADVISOR_PUBLIC_URL``
    (and ``OPTION_ADVISOR_EMAIL_LINK_BASE``) unset, **emails still send** but in-app links point at
    localhost until env is fixed.
    """
    env_raw = os.getenv("OPTION_ADVISOR_PUBLIC_URL", "").strip()
    env = _normalize_public_origin(env_raw)
    if env:
        return env
    if request is not None:
        from_req = _spa_origin_from_request(request)
        if from_req:
            return from_req
    email_only = _normalize_public_origin(os.getenv("OPTION_ADVISOR_EMAIL_LINK_BASE", "").strip())
    if email_only:
        return email_only
    if request is None:
        global _background_email_default_link_logged
        if not _background_email_default_link_logged:
            _background_email_default_link_logged = True
            print(
                "[email-links] OPTION_ADVISOR_PUBLIC_URL and OPTION_ADVISOR_EMAIL_LINK_BASE are unset; "
                "background alert emails will use http://localhost:4200 in links. "
                "Set OPTION_ADVISOR_PUBLIC_URL on production (see DEPLOY_DIGITALOCEAN.md).",
                flush=True,
            )
    return "http://localhost:4200"


def _finder_deeplink_for_alert(a: AlertItem, *, public_base: str) -> str:
    """Query-string link: Strategy Finder with ticker, scan weeks, optional chain expiry."""
    base = public_base.strip().rstrip("/")
    ticker = a.ticker.strip().upper()
    w = int(a.weeks_out) if getattr(a, "weeks_out", None) is not None else 4
    if w not in FINDER_VALID_WEEKS_OUT:
        w = 4
    exp_raw = (a.expiry or "").strip()
    exp = exp_raw[:10] if len(exp_raw) >= 10 else ""
    if len(exp) != 10 or exp[4] != "-" or exp[7] != "-":
        exp = ""
    q = f"ticker={quote(ticker, safe='')}&weeks={w}"
    if exp:
        q += f"&expiry={quote(exp, safe='')}"
    return f"{base}/?{q}"


def _get_15_min_window(ts_ms: int) -> str:
    dt = datetime.fromtimestamp(ts_ms / 1000, ZoneInfo("America/Los_Angeles"))
    bucket_start = (dt.minute // 15) * 15
    end_hour = dt.hour + 1 if bucket_start + 15 == 60 else dt.hour
    end_min = 0 if bucket_start + 15 == 60 else bucket_start + 15

    def fmt(hour: int, minute: int) -> str:
        ampm = "PM" if hour >= 12 else "AM"
        h12 = hour % 12 or 12
        return f"{h12}:{minute:02d} {ampm}"

    return f"{fmt(dt.hour, bucket_start)} – {fmt(end_hour, end_min)} PT"


def _build_alert_html(
    email: str,
    alerts: list,
    user_name: str | None = None,
    *,
    public_base: str,
) -> str:
    """Render HTML for GO-trade alerts: high-contrast light default; dark when client prefers dark."""
    display_name = (user_name or "").strip() or email
    rows_html = ""
    for a in alerts:
        app_url = _finder_deeplink_for_alert(a, public_base=public_base)
        tick_safe = html.escape(a.ticker.strip().upper())
        strat_safe = html.escape(a.strategy)
        bias_safe = html.escape(a.bias)
        exp_safe = html.escape(f"{a.expiry} ({a.dte}d)")
        pop_pct = f"{round(a.pop * 100)}%"
        ev_str = f"${round(a.ev * 100, 0):+.0f}"  # per contract
        profit = f"${round(a.max_profit * 100, 0):.0f}"
        loss = f"${round(a.max_loss * 100, 0):.0f}"
        credit = f"${round(a.net_credit * 100, 2):.2f}" if a.net_credit > 0 else f"-${round(abs(a.net_credit) * 100, 2):.2f}"
        bias_color = "#15803d" if "bull" in a.bias.lower() else "#b91c1c" if "bear" in a.bias.lower() else "#b45309"
        ev_cls = "oa-ev-pos" if a.ev > 0 else "oa-ev-neg"
        rows_html += f"""
        <tr class="oa-tr">
          <td class="oa-td oa-tick"><a class="oa-app-link" href="{html.escape(app_url, quote=True)}">{tick_safe}</a></td>
          <td class="oa-td oa-strat"><a class="oa-app-link oa-app-link-subtle" href="{html.escape(app_url, quote=True)}">{strat_safe}</a></td>
          <td class="oa-td oa-bias" style="color:{bias_color} !important;">{bias_safe}</td>
          <td class="oa-td oa-muted">{exp_safe}</td>
          <td class="oa-td oa-pos">{profit}</td>
          <td class="oa-td oa-neg">{loss}</td>
          <td class="oa-td oa-num">{credit}</td>
          <td class="oa-td oa-num">{pop_pct}</td>
          <td class="oa-td oa-num {ev_cls}">{ev_str}</td>
          <td class="oa-td" style="text-align:center;"><a class="oa-app-link" href="{html.escape(app_url, quote=True)}"><span class="oa-go">✅ GO · Open</span></a></td>
        </tr>"""

    window_label = alerts[0].time_window if alerts else ""
    count = len(alerts)
    plural = "trade" if count == 1 else "trades"

    # Light theme = default (readable in Gmail/Apple light). Dark via prefers-color-scheme where supported.
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <style>
    body {{ margin: 0; padding: 0; -webkit-font-smoothing: antialiased; }}
    .oa-root {{
      background: #f1f5f9 !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }}
    .oa-shell {{
      max-width: 780px; margin: 24px auto; border-radius: 16px; overflow: hidden;
      background: #ffffff !important;
      border: 1px solid #cbd5e1 !important;
      box-shadow: 0 4px 24px rgba(15, 23, 42, 0.06);
    }}
    .oa-body-pad {{ padding: 24px 28px; }}
    .oa-intro {{ color: #334155 !important; font-size: 13px; margin: 0 0 20px; line-height: 1.55; }}
    .oa-intro strong {{ color: #0f172a !important; }}
    .oa-accent {{ color: #5b21b6 !important; }}
    .oa-table-wrap {{
      overflow-x: auto; border-radius: 12px; border: 1px solid #e2e8f0 !important;
      background: #f8fafc !important;
    }}
    table.oa-table {{ width: 100%; border-collapse: collapse; font-size: 13px; }}
    .oa-th-row th {{
      padding: 10px 12px; text-align: left; font-weight: 600; text-transform: uppercase;
      font-size: 11px; letter-spacing: 0.06em; background: #e2e8f0 !important; color: #475569 !important;
    }}
    .oa-td {{ padding: 10px 12px; border-bottom: 1px solid #e2e8f0 !important; }}
    .oa-tr:last-child .oa-td {{ border-bottom: none !important; }}
    .oa-tick {{ font-weight: 700; color: #0f172a !important; }}
    .oa-strat {{ font-weight: 600; color: #5b21b6 !important; }}
    .oa-muted {{ color: #475569 !important; }}
    .oa-pos {{ color: #15803d !important; font-family: ui-monospace, monospace; }}
    .oa-neg {{ color: #b91c1c !important; font-family: ui-monospace, monospace; }}
    .oa-num {{ color: #0f172a !important; font-family: ui-monospace, monospace; }}
    .oa-ev-pos {{ color: #15803d !important; }}
    .oa-ev-neg {{ color: #b91c1c !important; }}
    .oa-go {{
      display: inline-block; background: #dcfce7 !important; color: #166534 !important;
      padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 700;
    }}
    a.oa-app-link {{
      color: inherit !important;
      text-decoration: underline;
      text-underline-offset: 2px;
    }}
    a.oa-app-link:hover {{ opacity: 0.88; }}
    a.oa-app-link-subtle {{ font-weight: 600; }}
    .oa-disclaimer {{ color: #64748b !important; font-size: 11px; margin: 20px 0 0; line-height: 1.6; }}
    .oa-footer {{
      background: #f1f5f9 !important; padding: 14px 28px;
      border-top: 1px solid #e2e8f0 !important;
    }}
    .oa-footer span {{ color: #64748b !important; font-size: 11px; }}

    @media (prefers-color-scheme: dark) {{
      .oa-root {{ background: #0f0f17 !important; }}
      .oa-shell {{
        background: #1a1a2e !important;
        border-color: #2d2d3a !important;
        box-shadow: none;
      }}
      .oa-intro {{ color: #94a3b8 !important; }}
      .oa-intro strong {{ color: #e2e8f0 !important; }}
      .oa-accent {{ color: #c4b5fd !important; }}
      .oa-table-wrap {{ border-color: #2d2d3a !important; background: #14141f !important; }}
      .oa-th-row th {{ background: #252538 !important; color: #94a3b8 !important; }}
      .oa-td {{ border-bottom-color: #2d2d3a !important; }}
      .oa-tick {{ color: #f1f5f9 !important; }}
      .oa-strat {{ color: #c4b5fd !important; }}
      .oa-muted {{ color: #94a3b8 !important; }}
      .oa-num {{ color: #e2e8f0 !important; }}
      .oa-pos {{ color: #4ade80 !important; }}
      .oa-neg {{ color: #f87171 !important; }}
      .oa-ev-pos {{ color: #4ade80 !important; }}
      .oa-ev-neg {{ color: #f87171 !important; }}
      .oa-go {{ background: #166534 !important; color: #bbf7d0 !important; }}
      a.oa-app-link .oa-go {{ text-decoration: none; }}
      .oa-disclaimer {{ color: #94a3b8 !important; }}
      .oa-footer {{ background: #12121e !important; border-top-color: #2d2d3a !important; }}
      .oa-footer span {{ color: #94a3b8 !important; }}
    }}
  </style>
</head>
<body class="oa-root">
  <div class="oa-shell">
    <div style="background:linear-gradient(135deg,#4c1d95,#312e81);padding:24px 28px;">
      <div style="display:flex;align-items:center;gap:12px;">
        <div style="width:36px;height:36px;background:#7c3aed;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;">📈</div>
        <div>
          <div style="font-size:18px;font-weight:800;color:#fff;">OptionAdvisor — GO Trade Alert</div>
          <div style="font-size:13px;color:#e9d5ff;margin-top:2px;">{count} new {plural} passed all checklist criteria · {html.escape(window_label)}</div>
        </div>
      </div>
    </div>

    <div class="oa-body-pad">
      <p class="oa-intro">
        Hi <strong>{html.escape(display_name)}</strong>, the systematic engine found
        <strong>{count} GO {plural}</strong> across your watchlist
        in the <strong class="oa-accent">{html.escape(window_label)}</strong> scan window.
        These passed all 10 pre-trade checks — no hard fails, no soft fails.
        <br><br>
        <strong>Tip:</strong> tap the <strong>ticker</strong>, <strong>strategy</strong>, or <strong>✅ GO · Open</strong> on a row to open
        <strong>Strategy Finder</strong> in your browser (stay signed in for one-tap access). The symbol and expiry from the alert are applied automatically.
      </p>

      <div class="oa-table-wrap">
        <table class="oa-table" role="presentation">
          <thead>
            <tr class="oa-th-row">
              <th>Ticker</th>
              <th>Strategy</th>
              <th>Bias</th>
              <th>Expiry</th>
              <th>Max Profit</th>
              <th>Max Loss</th>
              <th>Credit</th>
              <th>PoP</th>
              <th>EV/cont.</th>
              <th style="text-align:center;">Open</th>
            </tr>
          </thead>
          <tbody>{rows_html}
          </tbody>
        </table>
      </div>

      <p class="oa-disclaimer">
        ⚠️ This is a systematic screen, not investment advice. Always verify the trade in the app before placing an order.
        Options trading involves substantial risk of loss.
      </p>
    </div>

    <div class="oa-footer" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
      <span>OptionAdvisor Systematic Engine v2</span>
      <span>Alerts sent to {html.escape(display_name)} &lt;{html.escape(email)}&gt;</span>
      <span style="flex-basis:100%;">Opened from: {html.escape(public_base)}</span>
    </div>
  </div>
</body>
</html>"""


@app.post("/api/send-alert")
def send_alert(
    http_request: Request,
    req: AlertEmailRequest,
    auth_email: str = Depends(require_access_email),
):
    ensure_same_user(auth_email, req.email)
    if not _user_wants_trade_alert_emails(get_user_state(req.email)):
        return {"sent": False, "message": USER_ALERT_EMAIL_DISABLED_MESSAGE}
    return _send_alert_email(req.email, req.alerts, req.user_name, request=http_request)


def _send_alert_email(
    email: str,
    alerts: list,
    user_name: str | None = None,
    *,
    request: Request | None = None,
) -> dict:
    if not alerts:
        return {"sent": False, "message": "No alerts to send"}

    try:
        public_base = _option_advisor_public_base(request=request)
        html_body = _build_alert_html(email, alerts, user_name, public_base=public_base)
        count = len(alerts)
        plural = "trade" if count == 1 else "trades"
        subject = f"🟢 OptionAdvisor: {count} GO {plural} detected — {alerts[0].time_window}"
        used = _deliver_html_email(email, user_name, subject, html_body)
        return {"sent": True, "message": f"Alert email sent to {email} ({used})"}

    except Exception as e:
        # Don't crash the app — email is optional
        print(f"[alert-email] send failed: {e}", flush=True)
        return {"sent": False, "message": f"Email failed: {str(e)}"}


def _day_trade_app_anchor_links(public_base: str | None = None) -> tuple[str, str, str]:
    """Hash links into the SPA: watchlist, alerts feed, intraday scanner (tickers chosen in UI)."""
    base = (public_base if public_base is not None else _option_advisor_public_base()).strip().rstrip("/")
    return (
        f"{base}/#day-trade-watchlist",
        f"{base}/#day-trade-alerts",
        f"{base}/#day-trade",
    )


def _norm_day_trade_verdict(v: object) -> str:
    return str(v or "").strip().upper()


def _build_day_trade_escalation_html(
    email: str,
    user_name: str | None,
    items: list[dict],
    *,
    public_base: str,
) -> str:
    display_name = (user_name or "").strip() or email
    wl_url, alerts_url, engine_url = _day_trade_app_anchor_links(public_base)
    rows_html = ""
    for it in items:
        raw_t = str(it.get("ticker", "")).strip().upper()
        tick = html.escape(raw_t)
        prev_v = html.escape(_norm_day_trade_verdict(it.get("previousVerdict")))
        verdict = html.escape(_norm_day_trade_verdict(it.get("verdict")))
        bias = html.escape(str(it.get("bias") or "—"))
        bull = html.escape(str(it.get("bullScore")))
        bear = html.escape(str(it.get("bearScore")))
        sess = html.escape(str(it.get("sessionDate") or ""))
        reasons = it.get("reasons") or []
        snippet = html.escape("; ".join(str(r) for r in reasons[:3])[:400])
        open_scan = f"{engine_url}?ticker={quote(raw_t, safe='')}"
        rows_html += f"""
        <tr class="oa-tr">
          <td class="oa-td oa-tick"><a class="oa-app-link" href="{html.escape(open_scan)}">{tick}</a></td>
          <td class="oa-td">{prev_v} → <strong>{verdict}</strong></td>
          <td class="oa-td">{bias}</td>
          <td class="oa-td oa-num">{bull} / {bear}</td>
          <td class="oa-td oa-muted">{sess}</td>
          <td class="oa-td oa-muted" style="font-size:12px;">{snippet}</td>
        </tr>"""

    count = len(items)
    plural = "symbol" if count == 1 else "symbols"
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="color-scheme" content="light dark">
  <style>
    body {{ margin: 0; padding: 0; -webkit-font-smoothing: antialiased;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }}
    .oa-root {{ background: #f1f5f9 !important; }}
    .oa-shell {{
      max-width: 720px; margin: 24px auto; border-radius: 16px; overflow: hidden;
      background: #ffffff !important; border: 1px solid #cbd5e1 !important;
      box-shadow: 0 4px 24px rgba(15, 23, 42, 0.06);
    }}
    .oa-body-pad {{ padding: 24px 28px; }}
    .oa-intro {{ color: #334155 !important; font-size: 14px; line-height: 1.55; margin: 0 0 16px; }}
    .oa-links {{ margin: 0 0 20px; font-size: 14px; line-height: 1.7; }}
    .oa-links a {{ color: #5b21b6 !important; font-weight: 600; }}
    .oa-table-wrap {{
      overflow-x: auto; border-radius: 12px; border: 1px solid #e2e8f0 !important;
      background: #f8fafc !important;
    }}
    table.oa-table {{ width: 100%; border-collapse: collapse; font-size: 13px; }}
    .oa-th-row th {{
      padding: 10px 12px; text-align: left; font-weight: 600; text-transform: uppercase;
      font-size: 11px; letter-spacing: 0.06em; background: #e2e8f0 !important; color: #475569 !important;
    }}
    .oa-td {{ padding: 10px 12px; border-bottom: 1px solid #e2e8f0 !important; vertical-align: top; }}
    .oa-tr:last-child .oa-td {{ border-bottom: none !important; }}
    .oa-tick {{ font-weight: 700; color: #0f172a !important; }}
    .oa-muted {{ color: #475569 !important; }}
    .oa-num {{ font-family: ui-monospace, monospace; color: #0f172a !important; }}
    a.oa-app-link {{ color: inherit !important; text-decoration: underline; text-underline-offset: 2px; }}
    .oa-disclaimer {{ color: #64748b !important; font-size: 11px; margin: 20px 0 0; line-height: 1.6; }}
    .oa-footer {{
      background: #f1f5f9 !important; padding: 14px 28px; border-top: 1px solid #e2e8f0 !important;
      font-size: 11px; color: #64748b !important;
    }}
  </style>
</head>
<body class="oa-root">
  <div class="oa-shell">
    <div style="background:linear-gradient(135deg,#0f766e,#134e4a);padding:22px 28px;">
      <div style="font-size:18px;font-weight:800;color:#fff;">OptionAdvisor — Day trade watchlist</div>
      <div style="font-size:13px;color:#ccfbf1;margin-top:4px;">{count} {plural} moved WATCH → GO / STRONG GO</div>
    </div>
    <div class="oa-body-pad">
      <p class="oa-intro">
        Hi <strong>{html.escape(display_name)}</strong>, your saved day-trade watchlist showed a higher conviction
        reading on {count} {plural} (scanner runs about every 15 minutes during the alert window).
      </p>
      <p class="oa-links">
        <a href="{html.escape(wl_url)}">Open day trade watchlist</a><br>
        <a href="{html.escape(alerts_url)}">Open day trade alerts</a><br>
        <a href="{html.escape(engine_url)}">Open day trade scanner</a>
      </p>
      <div class="oa-table-wrap">
        <table class="oa-table" role="presentation">
          <thead>
            <tr class="oa-th-row">
              <th>Ticker</th><th>Change</th><th>Bias</th><th>Bull / Bear</th><th>Session</th><th>Notes</th>
            </tr>
          </thead>
          <tbody>{rows_html}
          </tbody>
        </table>
      </div>
      <p class="oa-disclaimer">
        Educational / research screen only — not investment advice. Verify in the app before acting.
      </p>
    </div>
    <div class="oa-footer">Sent to {html.escape(display_name)} &lt;{html.escape(email)}&gt;<br>
      Opened from: {html.escape(public_base)}
    </div>
  </div>
</body>
</html>"""


def _send_day_trade_escalation_email(email: str, user_name: str | None, items: list[dict]) -> dict:
    if not items:
        return {"sent": False, "message": "No day-trade escalations to send"}
    try:
        link_base = _option_advisor_public_base()
        html_body = _build_day_trade_escalation_html(email, user_name, items, public_base=link_base)
        n = len(items)
        subject = f"⚡ OptionAdvisor: {n} day-trade WATCH→GO signal{'s' if n != 1 else ''}"
        used = _deliver_html_email(email, user_name, subject, html_body)
        return {"sent": True, "message": f"Day-trade alert email sent to {email} ({used})"}
    except Exception as e:
        print(f"[day-trade-alert-email] send failed: {e}", flush=True)
        return {"sent": False, "message": f"Email failed: {str(e)}"}


def _detect_day_trade_level_alert(
    t: str, r: Any, session_date: str
) -> tuple[str, str, str]:
    """Return (level_key, title, body) if price is testing a key OR/VWAP level, else ('','','')."""
    m: dict = dict(r.metrics or {})
    or_high = float(m.get("or_high") or 0)
    or_low = float(m.get("or_low") or 0)
    or_state = str(m.get("or_state") or "inside").lower()
    or_historical = str(m.get("or_historical") or "contained").lower()
    last_price = float(m.get("last_price") or 0)
    vwap = float(m.get("vwap") or 0)
    rvol = float(m.get("rvol") or 1.0)

    if not last_price:
        return "", "", ""

    LEVEL_BAND = 0.4  # within 0.4% counts as "testing the level"

    # ORL retest from below after breakdown — short re-entry signal
    if (
        or_historical == "broke_down"
        and or_state == "below"
        and or_low > 0
        and 0 <= (or_low - last_price) / or_low * 100 <= LEVEL_BAND
    ):
        key = f"orl_retest_{session_date}"
        title = f"⚡ {t} — OR Low Retest (Short Re-entry)"
        body = (
            f"Price ${last_price:.2f} testing ORL ${or_low:.2f} from below after breakdown. "
            f"Watch for rejection candle — potential short re-entry."
        )
        return key, title, body

    # ORH retest from above after breakout — long re-entry signal
    if (
        or_historical == "broke_up"
        and or_state == "above"
        and or_high > 0
        and 0 <= (last_price - or_high) / or_high * 100 <= LEVEL_BAND
    ):
        key = f"orh_retest_{session_date}"
        title = f"⚡ {t} — OR High Retest (Long Re-entry)"
        body = (
            f"Price ${last_price:.2f} retesting ORH ${or_high:.2f} from above after breakout. "
            f"Watch for hold and continuation — potential long re-entry."
        )
        return key, title, body

    # VWAP test with elevated volume — inflection point signal
    if vwap > 0 and abs(last_price - vwap) / vwap * 100 <= 0.2 and rvol >= 1.2:
        direction = "from below" if last_price >= vwap else "from above"
        key = f"vwap_test_{session_date}"
        title = f"⚡ {t} — VWAP Test (Vol {rvol:.1f}×)"
        body = (
            f"Price ${last_price:.2f} testing VWAP ${vwap:.2f} {direction} with RVOL {rvol:.1f}×. "
            f"Watch for hold or rejection at this pivot."
        )
        return key, title, body

    return "", "", ""


def _scan_user_day_trade_watchlist(user_state: dict) -> None:
    email = user_state.get("email", "").strip().lower()
    if not email or user_state.get("role") != "admin":
        return
    symbols = user_state.get("day_trade_watchlist") or []
    if not symbols:
        return

    user_name = email.split("@")[0] or email
    escalations: list[dict] = []

    # Build set of watchlist tickers (used later to avoid double-scanning active trades)
    watchlist_tickers: set[str] = set()

    for ti, ticker in enumerate(symbols):
        if ti:
            time.sleep(0.6)
        t = str(ticker).strip().upper()
        if not t:
            continue
        watchlist_tickers.add(t)
        try:
            r = run_day_trade_scan(t)
        except Exception as exc:
            print(f"[day-trade-scan] {email} {t} failed: {exc}", flush=True)
            continue

        session_date = str((r.metrics or {}).get("session_date") or "").strip()[:10]
        now_verdict = _norm_day_trade_verdict(r.verdict)
        prev_row = get_day_trade_watchlist_last(email, t)
        prev_level_key = (prev_row or {}).get("level_alert_key", "") if prev_row else ""

        # --- Level-retest alert detection ---
        new_level_key, level_title, level_body = _detect_day_trade_level_alert(t, r, session_date)
        carry_level_key = new_level_key if new_level_key else prev_level_key

        if not prev_row:
            upsert_day_trade_watchlist_last(email, t, now_verdict, session_date, carry_level_key, eg_state)
            continue

        prev_session = (prev_row.get("session_date") or "").strip()[:10]
        prev_verdict = _norm_day_trade_verdict(prev_row.get("verdict"))

        if prev_session and session_date and prev_session != session_date:
            # New session — reset level key
            upsert_day_trade_watchlist_last(email, t, now_verdict, session_date, "", "")
            continue

        if prev_verdict in {"WATCH"} and now_verdict in {"GO", "STRONG GO", "STRONG_GO"}:
            now_ms = int(time.time() * 1000)
            alert_id = f"dt-{t}-{now_ms}"
            escalations.append(
                {
                    "id": alert_id,
                    "alertType": "ENTER_NOW",
                    "ticker": r.ticker,
                    "companyName": r.company_name,
                    "previousVerdict": prev_verdict,
                    "verdict": now_verdict,
                    "sessionDate": session_date,
                    "bias": r.bias,
                    "bullScore": r.bull_score,
                    "bearScore": r.bear_score,
                    "reasons": list(r.reasons)[:12],
                    "metrics": r.metrics,
                    "summary": "ENTRY CONDITIONS MET",
                    "decisionMsg": "ENTRY CONDITIONS MET — enter only if price and risk still match the chart.",
                    "detectedAt": now_ms,
                }
            )

        # Track state for lifecycle/de-dupe only. State-change alerts are noise;
        # only explicit entry/target/exit events notify.
        eg_state = str(getattr(r.entry_guidance, "state", "") or "")
        now_state_num = _day_trade_active_state(eg_state)
        upsert_ticker_state_last(email, t, "DAY", now_state_num, eg_state, session_date)

        upsert_day_trade_watchlist_last(email, t, now_verdict, session_date, carry_level_key)

    # --- Scan active-trade tickers for level alerts (not in main watchlist) ---
    try:
        active_rows = list_active_trades_open_opened_today_et(email)
        active_tickers = sorted({str(r["ticker"]).upper() for r in active_rows if r.get("ticker")})
        for ti, t in enumerate(active_tickers):
            if t in watchlist_tickers:
                continue  # already scanned above
            if ti:
                time.sleep(0.6)
            try:
                r = run_day_trade_scan(t)
            except Exception as exc:
                print(f"[day-trade-scan/active] {email} {t} failed: {exc}", flush=True)
                continue

            session_date = str((r.metrics or {}).get("session_date") or "").strip()[:10]
            now_verdict = _norm_day_trade_verdict(r.verdict)
            prev_row = get_day_trade_watchlist_last(email, t)
            prev_level_key = (prev_row or {}).get("level_alert_key", "") if prev_row else ""

            new_level_key, level_title, level_body = _detect_day_trade_level_alert(t, r, session_date)

            # New session resets level key
            prev_session = (prev_row.get("session_date") or "").strip()[:10] if prev_row else ""
            if prev_session and session_date and prev_session != session_date:
                upsert_day_trade_watchlist_last(email, t, now_verdict, session_date, "", "")
                continue

        carry_level_key = new_level_key if new_level_key else prev_level_key
        eg_state = str(getattr(r.entry_guidance, "state", "") or "")
        upsert_day_trade_watchlist_last(email, t, now_verdict, session_date, carry_level_key, eg_state)
    except Exception as exc:
        print(f"[day-trade-scan/active] {email} active-trades scan failed: {exc}", flush=True)

    if not escalations:
        return

    # Only email verdict escalations that are GO / STRONG GO; all others go to app-only
    _GO_VERDICTS = {"GO", "STRONG GO", "STRONG_GO"}
    email_escalations = [
        e for e in escalations
        if _is_actionable_day_alert(e) and _norm_day_trade_verdict(e.get("verdict")) in _GO_VERDICTS
    ]

    if email_escalations and _user_wants_trade_alert_emails(user_state):
        result = _send_day_trade_escalation_email(email, user_name, email_escalations)
    else:
        result = {"sent": False, "message": USER_ALERT_EMAIL_DISABLED_MESSAGE if not email_escalations else "No GO/STRONG GO verdicts — app alert only"}
    message = str(result.get("message", ""))
    sent = bool(result.get("sent"))
    for row in escalations:
        row["emailSent"] = sent and (row in email_escalations)
        row["emailMessage"] = message
        add_day_trade_alert_event(email, row)


@app.post("/api/test-email")
def send_test_email(req: TestEmailRequest):
    """
    Send a test message to verify SendGrid or SMTP from the OptionAdvisor backend.
    """
    email = req.email.strip()
    if not email:
        raise HTTPException(status_code=400, detail="Email is required")
    if not _user_wants_trade_alert_emails(get_user_state(email)):
        return {"sent": False, "message": USER_ALERT_EMAIL_DISABLED_MESSAGE}

    try:
        subject = "OptionAdvisor email test"
        html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <style>
    body {{ margin: 0; padding: 24px; -webkit-font-smoothing: antialiased;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f1f5f9; line-height: 1.55; }}
    .oa-test-card {{
      max-width: 560px; margin: 0 auto; padding: 24px 28px; border-radius: 16px;
      background: #ffffff; border: 1px solid #e2e8f0;
      box-shadow: 0 4px 24px rgba(15, 23, 42, 0.06); }}
    .oa-test-h2 {{ color: #0f172a; font-size: 20px; margin: 0 0 12px; }}
    .oa-test-p {{ color: #334155; font-size: 14px; margin: 0 0 12px; }}
    .oa-test-meta {{ color: #64748b; font-size: 12px; margin: 16px 0 0; }}
    @media (prefers-color-scheme: dark) {{
      body {{ background: #0f0f17; }}
      .oa-test-card {{ background: #1a1a2e; border-color: #2d2d3a; box-shadow: none; }}
      .oa-test-h2 {{ color: #f1f5f9; }}
      .oa-test-p {{ color: #94a3b8; }}
      .oa-test-meta {{ color: #94a3b8; }}
    }}
  </style>
</head>
<body>
  <div class="oa-test-card">
    <h2 class="oa-test-h2">OptionAdvisor email test</h2>
    <p class="oa-test-p">This confirms your email provider (SendGrid or SMTP) can send from the OptionAdvisor backend.</p>
    <p class="oa-test-meta">Sent to {email}</p>
  </div>
</body>
</html>"""
        used = _deliver_html_email(email, req.user_name, subject, html)
        return {"sent": True, "message": f"Test email sent to {email} ({used})"}
    except Exception as e:
        print(f"[test-email] send failed: {e}", flush=True)
        return {"sent": False, "message": f"Email failed: {str(e)}"}


@app.get("/api/email-status")
def email_status():
    provider = _email_provider()
    smtp = _smtp_config()
    sg = _sendgrid_config()
    return {
        "configured": provider != "none",
        "provider": provider,
        "missing": [] if provider != "none" else [*sg["missing"], *smtp["missing"]],
        "host": smtp["host"],
        "port": smtp["port"],
        "from": sg["from_email"] if provider == "sendgrid" else (smtp["from_addr"] if smtp["from_addr"] else ""),
        "fromName": sg["from_name"] if provider == "sendgrid" else "",
        "envFile": str(ENV_PATH),
        "envFileExists": ENV_PATH.exists(),
    }


def _mask_admin_only_trade_watchlists(state: dict) -> dict:
    """Hide day/swing trade watchlists from non-admins (stored fields are admin-only surfaces)."""
    if state.get("role") == "admin":
        return state
    out = dict(state)
    out["day_trade_watchlist"] = []
    out["swing_trade_watchlist"] = []
    return out


@app.get("/api/user-data/{email}", response_model=UserDataResponse)
def get_user_data(email: str, auth_email: str = Depends(require_access_email)):
    ensure_same_user(auth_email, email)
    return _mask_admin_only_trade_watchlists(get_user_state(email))


@app.put("/api/user-data/{email}", response_model=UserDataResponse)
def save_user_data(email: str, payload: UserDataRequest, auth_email: str = Depends(require_access_email)):
    ensure_same_user(auth_email, email)
    normalized_email = email.strip().lower()
    if not normalized_email:
        raise HTTPException(status_code=400, detail="Email is required")
    eff = get_user_state(normalized_email)
    role = eff.get("role")
    dt_wl = payload.day_trade_watchlist if role == "admin" else None
    sw_wl = payload.swing_trade_watchlist if role == "admin" else None
    try:
        # Portfolio is intentionally preserved from the existing DB state and
        # NEVER taken from this request's payload. Every portfolio mutation goes
        # through a dedicated endpoint:
        #   POST /portfolio/add, /portfolio/update, /portfolio/close, /portfolio/remove
        # Those are the only paths that write portfolio to the DB.
        # Accepting payload.portfolio here caused a race: a debounced bulk save
        # carrying a stale client snapshot would silently overwrite positions a
        # dedicated call had just added (making new positions disappear) or
        # re-add positions a dedicated call had just removed/closed.
        current_portfolio = eff.get("portfolio") or []
        saved = save_user_state(
            normalized_email,
            payload.watchlist,
            current_portfolio,
            advisory_terms_version=payload.advisory_terms_version,
            advisory_accepted_at=payload.advisory_accepted_at,
            day_trade_watchlist=dt_wl,
            swing_trade_watchlist=sw_wl,
            alert_email_enabled=payload.alert_email_enabled,
        )
        return _mask_admin_only_trade_watchlists(saved)
    except ValueError as e:
        msg = str(e)
        if msg.startswith("watchlist_limit:"):
            lim = msg.split(":", 1)[1]
            raise HTTPException(
                status_code=400,
                detail=f"Watchlist cannot exceed {lim} symbols for your account.",
            ) from None
        raise


def _analyze_ticker(
    ticker: str,
    weeks_out: int = 4,
    spread_width: int | None = None,
    strategy_mode: str = "all",
    chain_expiry: str | None = None,
    force_refresh: bool = False,
) -> AnalyzeResponse:
    ticker = ticker.upper().strip()

    try:
        hist = _bc_hist(ticker, period="1y", force_refresh=False)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch data: {str(e)}")

    if hist is None or hist.empty:
        raise HTTPException(status_code=404, detail=f"No data found for ticker '{ticker}'")

    if len(hist) < 60:
        raise HTTPException(status_code=400, detail=f"Insufficient history for '{ticker}' (need at least 60 days)")

    # Options chain
    try:
        opt_dates = _bc_opt_dates(ticker, force_refresh=force_refresh)
    except Exception:
        opt_dates = ()

    if not opt_dates:
        raise HTTPException(status_code=404, detail=f"No options available for '{ticker}'")

    from engine import pick_expiry_by_dte as _pick_expiry

    if chain_expiry:
        ce = chain_expiry.strip()[:10]
        if ce in opt_dates:
            target_expiry = ce
        else:
            raise HTTPException(
                status_code=404,
                detail=f"No option chain for '{ticker}' on expiry {ce} (listed: {len(opt_dates)} expiries)",
            )
        exp_dt = datetime.strptime(target_expiry, "%Y-%m-%d").date()
        today = datetime.now().date()
        dte_chain = max(0, (exp_dt - today).days)
        weeks_for_engine = max(2, min(8, max(2, round(dte_chain / 7)))) if dte_chain > 0 else 2
    else:
        weeks_for_engine = weeks_out
        # Select the expiry that matches the user's weeks_out target — the same DTE
        # window the engine uses internally so chain pricing, Greeks, and recommendations
        # all refer to the same expiry.  Mirror the engine's pick_expiry_by_dte math:
        #   target_dte = weeks_out * 7,  window = ±10 days
        target_dte = weeks_out * 7
        dte_lo = max(21, target_dte - 10)
        dte_hi = target_dte + 10
        target_expiry = _pick_expiry(list(opt_dates), dte_lo, dte_hi)
        if target_expiry is None:
            # Fallback: pick the nearest available expiry beyond dte_lo
            target_expiry = next(
                (d for d in opt_dates if (datetime.strptime(d, "%Y-%m-%d") - datetime.today()).days >= dte_lo - 3),
                opt_dates[min(2, len(opt_dates) - 1)]
            )

    try:
        calls_raw, puts_raw = _bc_chain(ticker, target_expiry, force_refresh=force_refresh)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch options chain: {str(e)}")

    # Info
    try:
        info = _bc_info(ticker, force_refresh=force_refresh)
        company_name = info.get("longName", ticker)
        sector = info.get("sector", "N/A")
        market_cap = format_market_cap(float(info.get("marketCap", 0) or 0))
    except:
        info = {}
        company_name = ticker
        sector = "N/A"
        market_cap = "N/A"

    # Current price: prefer live regularMarketPrice from info over yesterday's hist close.
    # hist["Close"].iloc[-1] is always the *previous session's* close — if the stock has
    # moved significantly pre/intraday, using it causes the intrinsic value check to
    # incorrectly flag live ITM options as stale (or miss stale OTM quotes).
    hist_close = float(hist["Close"].iloc[-1])
    live_price = safe_float(
        info.get("currentPrice") or info.get("regularMarketPrice") or 0
    )
    price_approx = live_price if live_price > 0 else hist_close

    # Extended-hours price (pre-market or after-hours)
    pre_price  = safe_float(info.get("preMarketPrice")  or 0)
    post_price = safe_float(info.get("postMarketPrice") or 0)
    # Only one will be non-zero at a given time; post-market takes precedence
    _ext_price = post_price if post_price > 0 else pre_price
    _ext_type  = "post" if post_price > 0 else ("pre" if pre_price > 0 else "")
    _ref_price = price_approx if price_approx > 0 else hist_close
    _ext_change     = round(_ext_price - _ref_price, 2)     if _ext_price > 0 else 0.0
    _ext_change_pct = round((_ext_change / _ref_price) * 100, 2) if _ref_price > 0 and _ext_price > 0 else 0.0
    calls_f = calls_raw[
        (calls_raw["strike"] >= price_approx * 0.75) &
        (calls_raw["strike"] <= price_approx * 1.30)
    ].copy()
    puts_f = puts_raw[
        (puts_raw["strike"] >= price_approx * 0.75) &
        (puts_raw["strike"] <= price_approx * 1.30)
    ].copy()

    # Generate signals (broker IV Rank uses stored ATM IV history when ≥20 sessions exist)
    session_et = datetime.now(ZoneInfo("America/New_York")).date().isoformat()
    iv_hist_past = fetch_iv_atm_history_strict_before(ticker, session_et, limit=380)
    try:
        signals = generate_signals(
            hist,
            calls_f,
            puts_f,
            reference_price=price_approx,
            implied_iv_history=iv_hist_past,
        )
        upsert_iv_atm_snapshot(ticker, session_et, signals.current_iv)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Signal generation failed: {str(e)}")

    # Calendar spreads need a multi-expiry chain with an 'expiration' column so
    # _build_calendar_spread can split front vs back leg rows.  We always tag the
    # front-leg chain and, when calendars are in scope, fetch and append the back leg.
    calls_engine = calls_f.copy()
    puts_engine  = puts_f.copy()
    calls_engine["expiration"] = target_expiry
    puts_engine["expiration"]  = target_expiry

    if strategy_mode in ("all", "calendar_only"):
        try:
            from engine import pick_expiry_by_dte as _pick_exp_cal
            front_dte_cal = max(0, (datetime.strptime(target_expiry, "%Y-%m-%d").date() - datetime.now().date()).days)
            back_exp = _pick_exp_cal(list(opt_dates), front_dte_cal + 21, front_dte_cal + 60)
            if back_exp and back_exp != target_expiry:
                c_back_raw, p_back_raw = _bc_chain(ticker, back_exp)
                c_back = c_back_raw[
                    (c_back_raw["strike"] >= price_approx * 0.75) &
                    (c_back_raw["strike"] <= price_approx * 1.30)
                ].copy()
                p_back = p_back_raw[
                    (p_back_raw["strike"] >= price_approx * 0.75) &
                    (p_back_raw["strike"] <= price_approx * 1.30)
                ].copy()
                c_back["expiration"] = back_exp
                p_back["expiration"] = back_exp
                calls_engine = pd.concat([calls_engine, c_back], ignore_index=True)
                puts_engine  = pd.concat([puts_engine,  p_back], ignore_index=True)
        except Exception:
            pass  # back-leg fetch failure: calendars won't build but other strategies still work

    # Run engine
    try:
        trades = run_engine(signals, calls_engine, puts_engine, list(opt_dates),
                            spread_width_override=spread_width,
                            weeks_out=weeks_for_engine,
                            strategy_mode=strategy_mode)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Trade engine failed: {str(e)}")

    # Build recommendations output
    recs_out = []
    for rank, trade in enumerate(trades, 1):
        legs_out = [
            OptionLegOut(
                action=leg.action,
                option_type=leg.option_type,
                strike=leg.strike,
                expiry=leg.expiry,
                delta=leg.delta,
                mid_price=leg.mid_price,
                bid=leg.bid,
                ask=leg.ask,
                iv=leg.iv,
                oi=leg.oi,
                volume=leg.volume,
                bid_ask_spread_pct=leg.bid_ask_spread_pct,
                data_quality=leg.data_quality,
                data_quality_reason=leg.data_quality_reason,
            )
            for leg in trade.legs
        ]
        # Compute authoritative status
        _score = trade.total_score
        _status = "GO" if (_score >= 75 and trade.passes_rr_filter and trade.passes_liquidity_filter) else \
                  "CAUTION" if _score >= 55 else \
                  "WAIT" if _score >= 40 else "AVOID"

        recs_out.append(RecommendationOut(
            rank=rank,
            strategy=trade.strategy,
            status=_status,
            bias=trade.bias,
            legs=legs_out,
            expiry=trade.expiry,
            dte=trade.dte,
            net_credit=round(trade.net_credit, 2),
            spread_width=round(trade.spread_width, 2),
            max_profit=round(trade.max_profit, 2),
            max_loss=round(trade.max_loss, 2),
            risk_reward_ratio=round(trade.risk_reward_ratio, 2),
            credit_pct_of_width=round(trade.credit_pct_of_width, 1),
            breakeven_lower=round(trade.breakeven_lower, 2),
            breakeven_upper=round(trade.breakeven_upper, 2),
            short_leg_delta=round(trade.short_leg_delta, 3),
            prob_of_profit=round(trade.prob_of_profit, 3),
            prob_of_max_loss=round(trade.prob_of_max_loss, 3),
            expected_value=round(trade.expected_value, 4),
            passes_rr_filter=trade.passes_rr_filter,
            passes_liquidity_filter=trade.passes_liquidity_filter,
            passes_credit_filter=trade.passes_credit_filter,
            scores=ScoreBreakdown(
                signal_score=trade.signal_score,
                structure_score=trade.structure_score,
                liquidity_score=trade.liquidity_score,
                iv_fit_score=trade.iv_fit_score,
                total_score=trade.total_score,
            ),
            rationale=trade.rationale,
            exit_plan=trade.exit_plan,
            warnings=trade.warnings,
            kelly_fraction=round(trade.kelly_fraction, 4),
            half_kelly_fraction=round(trade.half_kelly_fraction, 4),
            edge_ratio=round(trade.edge_ratio, 4),
        ))

    # Signals output
    signals_out = SignalsOut(
        current_price=signals.current_price,
        prev_close=signals.prev_close,
        price_change=signals.price_change,
        price_change_pct=signals.price_change_pct,
        trend=signals.trend,
        trend_strength=signals.trend_strength,
        ma20=signals.ma20, ma50=signals.ma50, ma200=signals.ma200,
        above_ma20=signals.above_ma20,
        above_ma50=signals.above_ma50,
        above_ma200=signals.above_ma200,
        ma50_slope=signals.ma50_slope,
        ma200_slope=signals.ma200_slope,
        rsi=signals.rsi, rsi_signal=signals.rsi_signal,
        macd=signals.macd,
        macd_signal_line=signals.macd_signal_line,
        macd_histogram=signals.macd_histogram,
        macd_crossover=signals.macd_crossover,
        current_iv=signals.current_iv, hv_20=signals.hv_20, hv_60=signals.hv_60,
        iv_rank=signals.iv_rank, iv_percentile=signals.iv_percentile,
        iv_vs_hv=signals.iv_vs_hv, iv_environment=signals.iv_environment,
        put_call_ratio=signals.put_call_ratio, pcr_signal=signals.pcr_signal,
        iv_skew=signals.iv_skew, skew_signal=signals.skew_signal,
        directional_bias=signals.directional_bias,
        bias_confidence=signals.bias_confidence,
        volatility_regime=signals.volatility_regime,
        ext_market_price=_ext_price,
        ext_market_change=_ext_change,
        ext_market_change_pct=_ext_change_pct,
        ext_market_type=_ext_type,
    )

    # Price history
    price_history_out = [
        PricePoint(
            date=p["date"],
            open=p["open"],
            high=p["high"],
            low=p["low"],
            close=p["close"],
            ma20=p["ma20"],
            ma50=p["ma50"],
            ma200=p["ma200"],
        )
        for p in signals.price_history
    ]
    recent_price_history = price_history_out[-20:]
    recent_lows = [point.low for point in recent_price_history if point.low > 0]
    recent_highs = [point.high for point in recent_price_history if point.high > 0]
    key_levels = [
        KeyLevelOut(
            label="Current Price",
            price=round(signals.current_price, 2),
            kind="current",
            reason="Latest underlying price used by the options engine.",
        ),
        KeyLevelOut(
            label="20D Support",
            price=round(min(recent_lows), 2) if recent_lows else round(signals.ma20, 2),
            kind="support",
            reason="Lowest daily low in the last 20 sessions.",
        ),
        KeyLevelOut(
            label="20D Resistance",
            price=round(max(recent_highs), 2) if recent_highs else round(signals.ma20, 2),
            kind="resistance",
            reason="Highest daily high in the last 20 sessions.",
        ),
        KeyLevelOut(
            label="MA 20",
            price=round(signals.ma20, 2),
            kind="moving_average",
            reason="20-session moving average from the regular analysis engine.",
        ),
        KeyLevelOut(
            label="MA 50",
            price=round(signals.ma50, 2),
            kind="moving_average",
            reason="50-session moving average from the regular analysis engine.",
        ),
        KeyLevelOut(
            label="MA 200",
            price=round(signals.ma200, 2),
            kind="moving_average",
            reason="200-session moving average from the regular analysis engine.",
        ),
    ]

    # Full strikes for this expiry (sorted). The old ±10% NTM slice + head(20) omitted typical
    # Bull/Bear vertical short legs — Portfolio MTM couldn't find mids past ~110% of spot.
    calls_export = calls_raw.sort_values("strike", ascending=True)
    puts_export = puts_raw.sort_values("strike", ascending=True)

    calls_chain_out = chain_to_output(calls_export, price_approx, target_expiry, "CALL")
    puts_chain_out = chain_to_output(puts_export, price_approx, target_expiry, "PUT")
    quote_quality_summary = _compute_quote_quality_summary(
        calls_chain_out,
        puts_chain_out,
        live_price > 0,
    )
    call_volume = sum(max(0, int(row.volume or 0)) for row in calls_chain_out)
    put_volume = sum(max(0, int(row.volume or 0)) for row in puts_chain_out)
    call_open_interest = sum(max(0, int(row.open_interest or 0)) for row in calls_chain_out)
    put_open_interest = sum(max(0, int(row.open_interest or 0)) for row in puts_chain_out)
    volume_put_call_ratio = round(put_volume / call_volume, 2) if call_volume else None
    open_interest_put_call_ratio = round(put_open_interest / call_open_interest, 2) if call_open_interest else None
    flow_sentiment = (
        "Put-heavy" if volume_put_call_ratio is not None and volume_put_call_ratio > 1.15 else
        "Call-heavy" if volume_put_call_ratio is not None and volume_put_call_ratio < 0.85 else
        "Balanced"
    )
    options_flow = OptionsFlowOut(
        callVolume=call_volume,
        putVolume=put_volume,
        callOpenInterest=call_open_interest,
        putOpenInterest=put_open_interest,
        volumePutCallRatio=volume_put_call_ratio,
        openInterestPutCallRatio=open_interest_put_call_ratio,
        ivRank=round(signals.iv_rank, 1),
        ivSkew=round(signals.iv_skew, 2),
        sentiment=flow_sentiment,
        summary=(
            f"{flow_sentiment} activity across the analyzed option chain. "
            f"Volume put/call ratio is {volume_put_call_ratio:.2f}."
            if volume_put_call_ratio is not None
            else "Options volume is insufficient to establish a put/call flow ratio."
        ),
    )
    resolved = resolve_trade_decision(
        {
            "engine_type": "regular",
            "signals": signals_out,
            "recommendations": recs_out,
        }
    )

    return AnalyzeResponse(
        ticker=ticker,
        company_name=company_name,
        sector=sector,
        market_cap=market_cap,
        signals=signals_out,
        recommendations=recs_out,
        calls_chain=calls_chain_out,
        puts_chain=puts_chain_out,
        price_history=price_history_out,
        filters_applied={
            "chain_expiry": target_expiry,
            "min_credit_pct_of_width": MIN_CREDIT_PCT_OF_WIDTH,
            "short_delta_range": list(TARGET_SHORT_DELTA_CREDIT),
            "target_dte": (
                f"fixed {target_expiry} (~{max(0, (datetime.strptime(target_expiry, '%Y-%m-%d').date() - datetime.now().date()).days)}d)"
                if chain_expiry
                else f"{weeks_out}w ({weeks_out * 7}d ±7)"
            ),
            "max_bid_ask_spread_pct": 15,
            "min_open_interest": 50,
            "spread_width": spread_width if spread_width else "auto",
            "strategy_mode": strategy_mode,
        },
        quote_quality_summary=quote_quality_summary,
        key_levels=key_levels,
        options_flow=options_flow,
        market_bias=resolved.market_bias,
        setup_quality=resolved.setup_quality,
        verdict=str(resolved.verdict or "WAIT"),
        confidence=resolved.confidence,
        reason=resolved.reason,
        supporting_factors=resolved.supporting_factors,
        missing_confirmations=resolved.missing_confirmations,
        risk_state=resolved.risk_state,
        explanation=dict(resolved.explanation or {}),
        risk_reason=resolved.risk_reason or "",
        display_confidence=int(resolved.display_confidence or 0),
        execution_fields=list(resolved.execution_fields or []),
    )


def _cache_key(
    ticker: str,
    weeks_out: int,
    spread_width: int | None,
    strategy_mode: str,
    chain_expiry: str | None = None,
) -> str:
    width_key = "auto" if spread_width is None else str(spread_width)
    ce = (chain_expiry or "").strip()[:10]
    return f"{ticker.upper().strip()}|{weeks_out}|{width_key}|{strategy_mode}|{ce}"


def _get_analysis_with_cache(
    ticker: str,
    weeks_out: int = 4,
    spread_width: int | None = None,
    strategy_mode: str = "all",
    force_refresh: bool = False,
) -> AnalyzeResponse:
    key = _cache_key(ticker, weeks_out, spread_width, strategy_mode)
    now = time.time()

    if not force_refresh:
        with analysis_cache_lock:
            cached = analysis_cache.get(key)
            if cached and now - cached[0] < ALERT_ANALYSIS_CACHE_TTL_SECONDS:
                return cached[1]

    data = _analyze_ticker(
        ticker,
        weeks_out=weeks_out,
        spread_width=spread_width,
        strategy_mode=strategy_mode,
    )
    with analysis_cache_lock:
        analysis_cache[key] = (time.time(), data)
    return data


def _user_analyze_ttl() -> int:
    """Return the appropriate cache TTL for user-facing requests based on market hours."""
    now = datetime.now(ZoneInfo("America/Los_Angeles"))
    if now.weekday() >= 5:
        return ANALYZE_CACHE_TTL_OFF_HOURS
    minutes = now.hour * 60 + now.minute
    # Market hours: 6:30 AM – 1:00 PM PT (regular) + pre-market from 4 AM
    in_market = 4 * 60 <= minutes < 13 * 60
    return ANALYZE_CACHE_TTL_MARKET_HOURS if in_market else ANALYZE_CACHE_TTL_OFF_HOURS


def _signal_feed_source_items(state: dict[str, Any]) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}

    def ensure_item(ticker: str, *, source: str, notes: str | None = None, added_at: str | None = None) -> None:
        t = str(ticker or "").strip().upper()
        if not t:
            return
        item = merged.get(t)
        if item is None:
            item = {
                "ticker": t,
                "id": f"wlx-{t}",
                "notes": (notes or "").strip() or None,
                "added_at": added_at or "",
                "sources": [],
            }
            merged[t] = item
        if source not in item["sources"]:
            item["sources"].append(source)
        if not item.get("notes") and notes and notes.strip():
            item["notes"] = notes.strip()
        if not item.get("added_at") and added_at:
            item["added_at"] = added_at

    for mt in _normalize_my_tickers_list(state.get("my_tickers") or []):
        sym = str(mt.get("symbol", "") or "").strip().upper()
        if not sym:
            continue
        if mt.get("is_active") is False:
            continue
        types = mt.get("trade_types") or ["regular"]
        company = str(mt.get("company_name", "") or "")
        for src in types:
            ensure_item(sym, source=src, notes=company)

    for sym in (state.get("day_trade_watchlist") or []):
        ensure_item(str(sym or ""), source="day")

    for sym in (state.get("swing_trade_watchlist") or []):
        ensure_item(str(sym or ""), source="swing")

    for raw in (state.get("watchlist") or []):
        if isinstance(raw, str):
            ensure_item(raw, source="regular")
        elif isinstance(raw, dict):
            ensure_item(
                str(raw.get("ticker") or raw.get("symbol") or ""),
                source="regular",
                notes=str(raw.get("notes") or raw.get("company_name") or raw.get("companyName") or ""),
                added_at=str(raw.get("addedAt") or raw.get("added_at") or ""),
            )

    return sorted(merged.values(), key=lambda x: (str(x.get("ticker") or "")))


def _day_trade_quote_batch_size() -> int:
    try:
        return max(1, min(25, int(DAY_TRADE_QUOTE_BATCH_SIZE)))
    except (TypeError, ValueError):
        return 5


def _unique_tickers_in_order(tickers: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for ticker in tickers:
        symbol = str(ticker or "").strip().upper()
        if not symbol or symbol in seen:
            continue
        seen.add(symbol)
        result.append(symbol)
    return result


def _get_quotes_in_day_trade_batches(
    tickers: list[str],
    *,
    force_refresh: bool,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """
    Warm or read quote cache in small sequential batches.

    Passing a whole saved ticker universe into quote_cache can fan out one
    Yahoo .info request per missed ticker.  Day Trade pages only need cache
    freshness, so we cap each pass to deterministic five-symbol batches by
    default and merge the same quote_cache metadata shape expected downstream.
    """
    clean = _unique_tickers_in_order(tickers)
    batch_size = _day_trade_quote_batch_size()
    batches = [clean[i:i + batch_size] for i in range(0, len(clean), batch_size)]
    merged_quotes: dict[str, Any] = {}
    meta: dict[str, Any] = {
        "used_cache": False,
        "cache_hits": 0,
        "cache_misses": 0,
        "force_refresh": force_refresh,
        "oldest_cache_age_seconds": 0.0,
        "source": "day_trade_quote_batch:none",
        "ttl_seconds": None,
        "batch_size": batch_size,
        "batch_count": len(batches),
        "ticker_count": len(clean),
    }
    sources: set[str] = set()

    for batch in batches:
        batch_quotes, batch_meta = _get_quotes(batch, force_refresh=force_refresh)
        merged_quotes.update(batch_quotes or {})
        meta["cache_hits"] += int(batch_meta.get("cache_hits", 0) or 0)
        meta["cache_misses"] += int(batch_meta.get("cache_misses", 0) or 0)
        meta["oldest_cache_age_seconds"] = max(
            float(meta.get("oldest_cache_age_seconds", 0.0) or 0.0),
            float(batch_meta.get("oldest_cache_age_seconds", 0.0) or 0.0),
        )
        if batch_meta.get("ttl_seconds") is not None:
            meta["ttl_seconds"] = batch_meta.get("ttl_seconds")
        if batch_meta.get("used_cache"):
            meta["used_cache"] = True
        source = str(batch_meta.get("source") or "").strip()
        if source:
            sources.add(source)

    if sources:
        meta["source"] = "day_trade_quote_batch:" + ",".join(sorted(sources))
    meta["oldest_cache_age_seconds"] = round(float(meta["oldest_cache_age_seconds"] or 0.0), 1)
    return merged_quotes, meta


def _day_trade_tickers_from_user_state(state: dict[str, Any]) -> list[str]:
    return _unique_tickers_in_order(
        [
            str(item.get("ticker") or "").strip().upper()
            for item in _signal_feed_source_items(state)
            if "day" in {str(src or "").strip().lower() for src in (item.get("sources") or [])}
        ]
    )


def _all_day_trade_tickers_for_cache_warm() -> list[str]:
    tickers: list[str] = []
    try:
        user_states = list_user_states()
    except Exception as exc:
        logging.getLogger(__name__).warning("DAY_TRADE_QUOTE_WARM_LOAD_USERS_FAILED error=%s", exc)
        return []

    for state in user_states:
        tickers.extend(_day_trade_tickers_from_user_state(state))
    return _unique_tickers_in_order(tickers)


def _signal_feed_decision_payload(decision: Any, *, label: str, raw_signal: str = "", reason: str = "") -> dict[str, Any]:
    reason_text = str(reason or "")
    if decision is None:
        final_decision = "WATCH"
    else:
        resolved = str(decision.verdict or "").upper()
        if resolved in {"EXIT", "SCALE_OUT", "MANAGE"}:
            final_decision = "MANAGE"
        elif resolved in {"AVOID", "NO_EDGE"}:
            final_decision = "AVOID"
        elif resolved in {"STRONG_GO", "GO", "READY"}:
            final_decision = "READY"
        elif "extended" in reason_text.lower():
            final_decision = "EXTENDED"
        else:
            final_decision = "WATCH"

    if decision is None:
        return {
            "engine": label,
            "market_bias": "NEUTRAL",
            "setup_quality": "WEAK",
            "final_decision": final_decision,
            "confidence": 0,
            "reason": reason_text or f"{label.title()} evaluation unavailable.",
            "supporting_factors": [],
            "missing_confirmations": [],
            "risk_state": "MEDIUM",
            "raw_signal": raw_signal,
            "explanation": {},
            "risk_reason": "",
            "display_confidence": 0,
            "execution_fields": [],
            "raw_engine_score": 0.0,
            "normalized_score": 0,
            "normalized_state": "",
            "confidence_band": "LOW",
            "execution_bias": "NO_CLEAN_ENTRY",
            "risk_band": "MEDIUM",
            "normalized_reason": "",
            "engine_score_breakdown": {},
        }
    return {
        "engine": label,
        "market_bias": decision.market_bias,
        "setup_quality": decision.setup_quality,
        "final_decision": final_decision,
        "confidence": decision.confidence,
        "reason": decision.reason or reason_text,
        "supporting_factors": list(decision.supporting_factors or []),
        "missing_confirmations": list(decision.missing_confirmations or []),
        "risk_state": decision.risk_state,
        "raw_signal": raw_signal,
        "explanation": dict(getattr(decision, "explanation", {}) or {}),
        "risk_reason": getattr(decision, "risk_reason", "") or "",
        "display_confidence": int(getattr(decision, "display_confidence", 0) or 0),
        "execution_fields": list(getattr(decision, "execution_fields", []) or []),
        "raw_engine_score": 0.0,
        "normalized_score": 0,
        "normalized_state": "",
        "confidence_band": "LOW",
        "execution_bias": "NO_CLEAN_ENTRY",
        "risk_band": "MEDIUM",
        "normalized_reason": "",
        "engine_score_breakdown": {},
    }


def _signal_feed_agreement_state(
    *,
    ticker: str,
    decisions: list[str],
    setup_qualities: list[str],
    reasons: list[str],
    in_portfolio: bool,
) -> tuple[str, str]:
    normalized = [str(x or "").upper() for x in decisions if str(x or "").strip()]
    unique = set(normalized)
    joined_reasons = " ".join(str(x or "").lower() for x in reasons)
    if in_portfolio:
        return "MANAGE", f"{ticker} is already in positions. Keep the watchlist row in manage mode."
    if "EXIT" in unique or "MANAGE" in unique:
        return "MANAGE", f"{ticker} has an active risk-management condition."
    if "AVOID" in unique and ("READY" in unique or "WATCH" in unique or "WAIT" in unique):
        return "CONFLICT", f"{ticker} has conflicting engine decisions."
    if "extended" in joined_reasons or any(str(x).upper() == "WEAK" for x in setup_qualities if x):
        if "WATCH" in unique or "WAIT" in unique:
            return "EXTENDED", f"{ticker} has trend interest, but at least one engine sees extension or weak confirmation."
    if unique and unique.issubset({"AVOID", "NO_EDGE"}):
        return "AVOID", f"{ticker} does not have enough aligned edge right now."
    if "READY" in unique and not ({"AVOID", "NO_EDGE"} & unique):
        return "READY", f"{ticker} has aligned setups across the active engines."
    if "WATCH" in unique or "WAIT" in unique:
        return "WATCH", f"{ticker} has potential, but still needs confirmation before entry."
    return "WATCH", f"{ticker} needs more confirmation before it graduates to a ready state."


def _signal_feed_agreement_badge(
    *,
    decisions: list[str],
    reasons: list[str],
    in_portfolio: bool,
) -> str:
    normalized = [str(x or "").upper() for x in decisions if str(x or "").strip()]
    unique = set(normalized)
    joined_reasons = " ".join(str(x or "").lower() for x in reasons)
    ready_count = sum(1 for value in normalized if value == "READY")
    watch_count = sum(1 for value in normalized if value in {"WATCH", "WAIT"})

    if in_portfolio or "EXIT" in unique or "MANAGE" in unique:
        return "MANAGE"
    if "AVOID" in unique and ({"READY", "WATCH", "WAIT", "EXTENDED"} & unique):
        return "CONFLICT"
    if "CONFLICT" in unique:
        return "CONFLICT"
    if "EXTENDED" in unique or "extended" in joined_reasons:
        return "EXTENDED"
    if unique and unique.issubset({"AVOID", "NO_EDGE"}):
        return "NO_EDGE"
    if ready_count >= 2 and not ({"AVOID", "NO_EDGE"} & unique):
        return "STRONG_AGREEMENT"
    if ready_count >= 1 or watch_count >= 1:
        return "PARTIAL_AGREEMENT"
    return "NO_EDGE"


def _signal_feed_sort_key(row: dict[str, Any], sort_by: str) -> tuple[Any, ...]:
    metrics = row.get("metrics") or {}
    if sort_by == "price_change":
        return (float(row.get("price_change_pct") or 0.0), str(row.get("ticker") or ""))
    if sort_by == "rsi":
        return (float(row.get("rsi") or 0.0), str(row.get("ticker") or ""))
    if sort_by == "relative_strength":
        return (float(row.get("relative_strength") or 0.0), str(row.get("ticker") or ""))
    if sort_by == "trend_score":
        return (float(metrics.get("trend_score") or 0.0), str(row.get("ticker") or ""))
    if sort_by == "volume":
        return (float(metrics.get("volume_ratio") or 0.0), str(row.get("ticker") or ""))
    if sort_by == "bull_bear":
        bull = float(metrics.get("bull_score") or 0.0)
        bear = float(metrics.get("bear_score") or 0.0)
        return (abs(bull - bear), str(row.get("ticker") or ""))
    if sort_by == "iv_rank":
        return (float(metrics.get("iv_rank") or 0.0), str(row.get("ticker") or ""))
    if sort_by == "normalized_score":
        day_score = int(row.get("day", {}).get("normalized_score") or 0)
        swing_score = int(row.get("swing", {}).get("normalized_score") or 0)
        regular_score = int(row.get("regular", {}).get("normalized_score") or 0)
        return (max(day_score, swing_score, regular_score), str(row.get("ticker") or ""))
    if sort_by == "engine_agreement":
        rank = {"READY": 5, "WATCH": 4, "EXTENDED": 3, "MANAGE": 2, "CONFLICT": 1, "AVOID": 0}
        return (rank.get(str(row.get("agreement_state") or "").upper(), -1), str(row.get("ticker") or ""))
    if sort_by == "trend":
        rank = {"STRONG_UPTREND": 5, "UPTREND": 4, "BULLISH": 3, "NEUTRAL": 2, "BEARISH": 1, "DOWNTREND": 0}
        return (rank.get(str(row.get("trend") or "").upper(), 2), str(row.get("ticker") or ""))
    return (str(row.get("ticker") or ""),)


def _signal_feed_ai_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    total = len(rows)
    ready = sum(1 for row in rows if str(row.get("agreement_state", "")).upper() == "READY")
    watch = sum(1 for row in rows if str(row.get("agreement_state", "")).upper() == "WATCH")
    extended = sum(1 for row in rows if str(row.get("agreement_state", "")).upper() == "EXTENDED")
    conflict = sum(1 for row in rows if str(row.get("agreement_state", "")).upper() == "CONFLICT")
    avoid = sum(1 for row in rows if str(row.get("agreement_state", "")).upper() == "AVOID")

    if ready > 0:
        best_focus = "Press the names where at least two engines are aligned and the final agreement is READY."
    elif conflict > 0:
        best_focus = "Let the conflict rows breathe. Trend and execution are disagreeing more than usual."
    else:
        best_focus = "Stay patient. Most names are still in WATCH or EXTENDED mode."

    headline = f"{ready} ready, {watch} watch, {conflict} conflict, {avoid} avoid"
    if total == 0:
        headline = "No watchlist items yet"
        best_focus = "Add tickers to start the unified evaluation pipeline."

    message = (
        "Unified SignalFeed separates market bias from actual execution readiness. "
        "A bullish backdrop only becomes actionable when setup quality and agreement line up."
    )
    if extended > 0:
        message += f" {extended} ticker{'s are' if extended != 1 else ' is'} extended and should be treated as confirmation-only."

    return {
        "headline": headline,
        "message": message,
        "best_focus": best_focus,
        "counts": {
            "total": total,
            "ready": ready,
            "watch": watch,
            "extended": extended,
            "conflict": conflict,
            "avoid": avoid,
        },
    }


def _signal_feed_market_context_label(day_metrics: dict[str, Any], swing_metrics: dict[str, Any]) -> str:
    swing_label = str(swing_metrics.get("market_context") or "").strip().upper()
    if swing_label:
        return swing_label
    spy_bias = str(day_metrics.get("spy_bias") or "").strip().upper()
    qqq_bias = str(day_metrics.get("qqq_bias") or "").strip().upper()
    if spy_bias and qqq_bias and spy_bias == qqq_bias:
        if "BULL" in spy_bias:
            return "MARKET_SUPPORTIVE"
        if "BEAR" in spy_bias:
            return "MARKET_WEAK"
    return "MARKET_MIXED"


def _signal_feed_morning_trend_scan(day_metrics: dict[str, Any], fallback_change_pct: float = 0.0) -> dict[str, Any]:
    """
    Morning trend classifier for the 6:45 AM PT scan. Uses existing day-trade
    session metrics only: session change, RVOL, and consecutive 1m candle
    direction. A ticker is TRENDING only when all three gates pass.
    """
    def _num(value: Any, default: float = 0.0) -> float:
        try:
            n = float(value)
            return n if np.isfinite(n) else default
        except Exception:
            return default

    session_change_pct = _num(day_metrics.get("session_change_pct"), fallback_change_pct)
    volume_vs_average = _num(
        day_metrics.get("rvol")
        or day_metrics.get("volume_ratio")
        or day_metrics.get("relative_volume"),
        0.0,
    )
    chart_bars = day_metrics.get("chart_bars") or []
    direction = "FLAT"
    consecutive = 0
    if isinstance(chart_bars, list) and chart_bars:
        for raw in reversed(chart_bars):
            if not isinstance(raw, dict):
                continue
            o = _num(raw.get("o") or raw.get("open"), 0.0)
            c = _num(raw.get("c") or raw.get("close"), 0.0)
            if o <= 0 or c <= 0 or abs(c - o) < 1e-9:
                break
            bar_dir = "UP" if c > o else "DOWN"
            if direction == "FLAT":
                direction = bar_dir
                consecutive = 1
            elif bar_dir == direction:
                consecutive += 1
            else:
                break

    if direction == "FLAT":
        direction = "UP" if session_change_pct > 0 else "DOWN" if session_change_pct < 0 else "FLAT"

    direction_aligned = (
        (session_change_pct > 0 and direction == "UP")
        or (session_change_pct < 0 and direction == "DOWN")
    )
    directional_consistency = direction_aligned and consecutive >= 5
    trending = (
        abs(session_change_pct) > 4.0
        and volume_vs_average > 1.5
        and directional_consistency
    )
    missing: list[str] = []
    if abs(session_change_pct) <= 4.0:
        missing.append("session move must exceed +/-4%")
    if volume_vs_average <= 1.5:
        missing.append("volume must exceed 1.5x average")
    if not directional_consistency:
        missing.append("needs 5+ same-direction 1m candles aligned with the move")

    return {
        "scan_time": "6:45 AM PT",
        "status": "TRENDING" if trending else "NOT_TRENDING",
        "trending": trending,
        "direction": "BULLISH" if session_change_pct > 0 else "BEARISH" if session_change_pct < 0 else "NEUTRAL",
        "session_change_pct": round(session_change_pct, 2),
        "volume_vs_average": round(volume_vs_average, 2),
        "consecutive_same_direction_candles": int(consecutive),
        "candle_direction": direction,
        "directional_consistency": directional_consistency,
        "missing": missing,
    }


def _signal_feed_market_structure(day_metrics: dict[str, Any]) -> dict[str, Any]:
    """
    Build the scanner's single source of truth for HH/HL/LH/LL.

    The frontend renders this object directly so the structure label, chart,
    story, and verdict copy cannot drift into contradictory states.
    """
    bars = day_metrics.get("chart_bars") or []
    highs: list[float] = []
    lows: list[float] = []

    if isinstance(bars, list):
        for raw in bars:
            if not isinstance(raw, dict):
                continue
            try:
                high = float(raw.get("h") if raw.get("h") is not None else raw.get("high"))
                low = float(raw.get("l") if raw.get("l") is not None else raw.get("low"))
            except Exception:
                continue
            if np.isfinite(high) and np.isfinite(low) and high > 0 and low > 0:
                highs.append(high)
                lows.append(low)

    if len(highs) < 5 or len(highs) != len(lows):
        return _classify_market_structure([])

    return _classify_market_structure(_detect_confirmed_pivots(highs, lows, left=2, right=2))


def _signal_feed_quote_day_metrics(quote: Any | None, *, error_reason: str = "") -> dict[str, Any]:
    """Minimal day-trade metrics from quote stream when 1m bars are not ready."""
    if quote is None:
        return {}
    try:
        volume = float(getattr(quote, "volume", 0) or 0)
        avg_volume = float(getattr(quote, "avg_volume", 0) or 0)
        rvol = round(volume / avg_volume, 2) if avg_volume > 0 else None
    except Exception:
        rvol = None
    price = float(getattr(quote, "price", 0.0) or 0.0)
    change_pct = float(getattr(quote, "change_percent", 0.0) or 0.0)
    return {
        "live_stream_available": bool(price > 0),
        "live_stream_source": getattr(quote, "source", "quote_cache"),
        "live_stream_price": round(price, 4) if price else None,
        "last_price": round(price, 4) if price else None,
        "change_pct": round(change_pct, 2),
        "session_change_pct": round(change_pct, 2),
        "rvol": rvol,
        "volume_ratio": rvol,
        "volume": int(getattr(quote, "volume", 0) or 0),
        "avg_volume": int(getattr(quote, "avg_volume", 0) or 0),
        "or_high": None,
        "or_low": None,
        "vwap": None,
        "vwap_position": "unknown",
        "price_structure": "LIVE_STREAM",
        "bar_data_stale": True,
        "bar_data_warning": error_reason or "Intraday 1m bars are not ready yet; scanner is showing live quote stream data.",
        "scanner_data_mode": "LIVE_QUOTE_ONLY",
        "chart_bars": [],
    }


def _signal_feed_source_signature(
    source_items: list[dict[str, Any]],
    portfolio_tickers: set[str],
) -> tuple[Any, ...]:
    """Stable signature for cache invalidation when the feed universe changes."""
    item_sig = tuple(
        sorted(
            (
                str(item.get("id") or ""),
                str(item.get("ticker") or "").strip().upper(),
                tuple(sorted(str(src or "").strip().lower() for src in (item.get("sources") or []))),
                str(item.get("added_at") or ""),
            )
            for item in source_items
            if str(item.get("ticker") or "").strip()
        )
    )
    return (item_sig, tuple(sorted(portfolio_tickers)))


def _signal_feed_response_from_rows(
    rows_in: list[dict[str, Any]],
    *,
    search: str | None,
    sort_by: str,
    sort_dir: str,
    page: int,
    page_size: int,
    cache_meta: dict[str, Any],
    elapsed_ms: int,
):
    rows = [dict(row) for row in rows_in]
    query = (search or "").strip().upper()
    if query:
        rows = [
            row for row in rows
            if query in str(row.get("ticker", "")).upper()
            or query in str(row.get("company_name", "")).upper()
        ]

    sort_key = sort_by.strip().lower()
    reverse = sort_dir.strip().lower() != "asc"
    rows.sort(key=lambda row: _signal_feed_sort_key(row, sort_key), reverse=reverse)

    total = len(rows)
    page = max(1, int(page))
    page_size = max(10, min(100, int(page_size)))
    start = (page - 1) * page_size
    end = start + page_size
    paged_rows = rows[start:end]

    return api_envelope(
        {
            "summary": {
                "total": total,
                "ready": sum(1 for row in rows if row["agreement_state"] == "READY"),
                "watch": sum(1 for row in rows if row["agreement_state"] == "WATCH"),
                "extended": sum(1 for row in rows if row["agreement_state"] == "EXTENDED"),
                "avoid": sum(1 for row in rows if row["agreement_state"] == "AVOID"),
                "conflict": sum(1 for row in rows if row["agreement_state"] == "CONFLICT"),
                "manage": sum(1 for row in rows if row["agreement_state"] == "MANAGE"),
                "alerts": sum(int(row.get("alerts_count") or 0) for row in rows),
                "trending_today": sum(1 for row in rows if row.get("trending_today")),
                "auto_added_day_watch": int(cache_meta.get("auto_added_day_watch", 0) or 0),
                "strong_bullish": sum(
                    1
                    for row in rows
                    if "STRONG_BULLISH" in {
                        str(row.get("day", {}).get("market_bias") or "").upper(),
                        str(row.get("swing", {}).get("market_bias") or "").upper(),
                        str(row.get("regular", {}).get("market_bias") or "").upper(),
                    }
                    or str(row.get("trend") or "").upper() == "STRONG_UPTREND"
                ),
                "strong_bearish": sum(
                    1
                    for row in rows
                    if "STRONG_BEARISH" in {
                        str(row.get("day", {}).get("market_bias") or "").upper(),
                        str(row.get("swing", {}).get("market_bias") or "").upper(),
                        str(row.get("regular", {}).get("market_bias") or "").upper(),
                    }
                    or str(row.get("trend") or "").upper() == "STRONG_DOWNTREND"
                ),
            },
            "ai_summary": _signal_feed_ai_summary(rows),
            "pagination": {
                "page": page,
                "page_size": page_size,
                "total": total,
                "total_pages": max(1, (total + page_size - 1) // page_size),
            },
            "sort": {"sort_by": sort_key, "sort_dir": "desc" if reverse else "asc"},
            "cache": {
                "used_cache": bool(cache_meta.get("used_cache", False)),
                "cache_hits": int(cache_meta.get("cache_hits", 0) or 0),
                "cache_misses": int(cache_meta.get("cache_misses", 0) or 0),
                "force_refresh": bool(cache_meta.get("force_refresh", False)),
                "oldest_cache_age_seconds": float(cache_meta.get("oldest_cache_age_seconds", 0.0) or 0.0),
                "source": str(cache_meta.get("source", "unknown") or "unknown"),
                "elapsed_ms": elapsed_ms,
                "payload_cache_age_seconds": float(cache_meta.get("payload_cache_age_seconds", 0.0) or 0.0),
                "ttl_seconds": SIGNAL_FEED_CACHE_TTL_SECONDS,
            },
            "rows": paged_rows,
        },
        stale=False,
    )


class SignalFeedAlertCreateBody(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=12)
    agreement_state: str = "WATCH"
    message: str = ""
    recommended_action: str = ""


@app.post("/api/analyze", response_model=AnalyzeResponse)
def analyze(req: AnalyzeRequest):
    """
    User-facing analyze endpoint. Uses a short TTL cache (90s during market hours)
    so the chain and signals are always close to real-time. The alert scanner uses
    a separate longer-TTL cache (_get_analysis_with_cache) so the two don't interfere.
    """
    ce = (req.chain_expiry or "").strip()[:10] or None
    key = _cache_key(req.ticker, req.weeks_out, req.spread_width, req.strategy_mode, ce)
    now = time.time()
    ttl = _user_analyze_ttl()

    with analyze_user_cache_lock:
        cached = analyze_user_cache.get(key)
        if cached and now - cached[0] < ttl:
            return cached[1]

    data = _analyze_ticker(
        req.ticker,
        weeks_out=req.weeks_out,
        spread_width=req.spread_width,
        strategy_mode=req.strategy_mode,
        chain_expiry=ce,
        force_refresh=False,
    )
    with analyze_user_cache_lock:
        analyze_user_cache[key] = (time.time(), data)
    return data


@app.get("/api/v2/analyze/{ticker}")
async def unified_analyze(
    ticker: str,
    trade_type: str = "day",
    weeks_out: int = 4,
    spread_width: Optional[int] = 5,
    strategy_mode: str = "all",
    force_refresh: bool = False,
    auth_email: str = Depends(require_access_email),
):
    """
    Unified analysis endpoint returning a consistent response shape for day, swing, and regular trades.
    trade_type: 'day' | 'swing' | 'regular'
    """
    ticker = ticker.upper().strip()

    if trade_type == "day":
        try:
            scan = run_day_trade_scan(ticker, force_refresh=force_refresh)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from None
        except RuntimeError as e:
            raise HTTPException(status_code=502, detail=str(e)) from None
        return serialize_day_trade(scan)

    if trade_type == "swing":
        try:
            scan = run_swing_trade_scan(ticker, force_refresh=force_refresh)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from None
        except RuntimeError as e:
            raise HTTPException(status_code=502, detail=str(e)) from None
        return serialize_swing_trade(scan)

    # regular — mirror _analyze_ticker logic
    try:
        hist = _bc_hist(ticker, period="1y", force_refresh=force_refresh)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch data: {str(e)}")

    if hist is None or hist.empty:
        raise HTTPException(status_code=404, detail=f"No data found for ticker '{ticker}'")

    if len(hist) < 60:
        raise HTTPException(status_code=400, detail=f"Insufficient history for '{ticker}' (need at least 60 days)")

    try:
        opt_dates = _bc_opt_dates(ticker, force_refresh=force_refresh)
    except Exception:
        opt_dates = ()

    if not opt_dates:
        raise HTTPException(status_code=404, detail=f"No options available for '{ticker}'")

    from engine import pick_expiry_by_dte as _pick_expiry

    weeks_for_engine = weeks_out
    target_dte = weeks_out * 7
    dte_lo = max(21, target_dte - 10)
    dte_hi = target_dte + 10
    target_expiry = _pick_expiry(list(opt_dates), dte_lo, dte_hi)
    if target_expiry is None:
        target_expiry = next(
            (d for d in opt_dates if (datetime.strptime(d, "%Y-%m-%d") - datetime.today()).days >= dte_lo - 3),
            opt_dates[min(2, len(opt_dates) - 1)]
        )

    try:
        calls_raw, puts_raw = _bc_chain(ticker, target_expiry, force_refresh=force_refresh)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch options chain: {str(e)}")

    try:
        info = _bc_info(ticker, force_refresh=force_refresh)
        company_name = info.get("longName", ticker)
    except Exception:
        info = {}
        company_name = ticker

    hist_close = float(hist["Close"].iloc[-1])
    live_price = safe_float(info.get("currentPrice") or info.get("regularMarketPrice") or 0)
    price_approx = live_price if live_price > 0 else hist_close

    calls_f = calls_raw[
        (calls_raw["strike"] >= price_approx * 0.75) &
        (calls_raw["strike"] <= price_approx * 1.30)
    ].copy()
    puts_f = puts_raw[
        (puts_raw["strike"] >= price_approx * 0.75) &
        (puts_raw["strike"] <= price_approx * 1.30)
    ].copy()

    session_et = datetime.now(ZoneInfo("America/New_York")).date().isoformat()
    iv_hist_past = fetch_iv_atm_history_strict_before(ticker, session_et, limit=380)
    try:
        signals = generate_signals(
            hist,
            calls_f,
            puts_f,
            reference_price=price_approx,
            implied_iv_history=iv_hist_past,
        )
        upsert_iv_atm_snapshot(ticker, session_et, signals.current_iv)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Signal generation failed: {str(e)}")

    calls_engine_v2 = calls_f.copy()
    puts_engine_v2  = puts_f.copy()
    calls_engine_v2["expiration"] = target_expiry
    puts_engine_v2["expiration"]  = target_expiry

    if strategy_mode in ("all", "calendar_only"):
        try:
            from engine import pick_expiry_by_dte as _pick_exp_cal_v2
            _front_dte = max(0, (datetime.strptime(target_expiry, "%Y-%m-%d").date() - datetime.now().date()).days)
            _back_exp = _pick_exp_cal_v2(list(opt_dates), _front_dte + 21, _front_dte + 60)
            if _back_exp and _back_exp != target_expiry:
                _cb, _pb = _bc_chain(ticker, _back_exp, force_refresh=force_refresh)
                _cb = _cb[(_cb["strike"] >= price_approx * 0.75) & (_cb["strike"] <= price_approx * 1.30)].copy()
                _pb = _pb[(_pb["strike"] >= price_approx * 0.75) & (_pb["strike"] <= price_approx * 1.30)].copy()
                _cb["expiration"] = _back_exp
                _pb["expiration"] = _back_exp
                calls_engine_v2 = pd.concat([calls_engine_v2, _cb], ignore_index=True)
                puts_engine_v2  = pd.concat([puts_engine_v2,  _pb], ignore_index=True)
        except Exception:
            pass

    try:
        trades = run_engine(
            signals, calls_engine_v2, puts_engine_v2, list(opt_dates),
            spread_width_override=spread_width,
            weeks_out=weeks_for_engine,
            strategy_mode=strategy_mode,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Trade engine failed: {str(e)}")

    return serialize_regular_trade(ticker, company_name, price_approx, trades, signals)


@app.get("/api/v2/analyze/{ticker}/public")
async def unified_analyze_public(
    ticker: str,
    weeks_out: int = 4,
    spread_width: Optional[int] = 5,
    strategy_mode: str = "all",
):
    """
    Public (unauthenticated) regular-trade analysis endpoint — used by the landing page.
    Returns the same structure as /api/v2/analyze/{ticker} with trade_type=regular but
    requires no auth token.  Rate-limited by the shared bar_cache TTL.
    """
    ticker = ticker.upper().strip()

    try:
        hist = _bc_hist(ticker, period="1y", force_refresh=False)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch data: {str(e)}")

    if hist is None or hist.empty:
        raise HTTPException(status_code=404, detail=f"No data found for ticker '{ticker}'")

    if len(hist) < 60:
        raise HTTPException(status_code=400, detail=f"Insufficient history for '{ticker}' (need at least 60 days)")

    try:
        opt_dates = _bc_opt_dates(ticker)
    except Exception:
        opt_dates = ()

    if not opt_dates:
        raise HTTPException(status_code=404, detail=f"No options available for '{ticker}'")

    from engine import pick_expiry_by_dte as _pick_expiry

    target_dte = weeks_out * 7
    dte_lo = max(21, target_dte - 10)
    dte_hi = target_dte + 10
    target_expiry = _pick_expiry(list(opt_dates), dte_lo, dte_hi)
    if target_expiry is None:
        target_expiry = next(
            (d for d in opt_dates if (datetime.strptime(d, "%Y-%m-%d") - datetime.today()).days >= dte_lo - 3),
            opt_dates[min(2, len(opt_dates) - 1)]
        )

    try:
        calls_raw, puts_raw = _bc_chain(ticker, target_expiry)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch options chain: {str(e)}")

    try:
        info = _bc_info(ticker)
        company_name = info.get("longName", ticker)
    except Exception:
        info = {}
        company_name = ticker

    hist_close = float(hist["Close"].iloc[-1])
    live_price = safe_float(info.get("currentPrice") or info.get("regularMarketPrice") or 0)
    price_approx = live_price if live_price > 0 else hist_close

    calls_f = calls_raw[
        (calls_raw["strike"] >= price_approx * 0.75) &
        (calls_raw["strike"] <= price_approx * 1.30)
    ].copy()
    puts_f = puts_raw[
        (puts_raw["strike"] >= price_approx * 0.75) &
        (puts_raw["strike"] <= price_approx * 1.30)
    ].copy()

    session_et = datetime.now(ZoneInfo("America/New_York")).date().isoformat()
    iv_hist_past = fetch_iv_atm_history_strict_before(ticker, session_et, limit=380)
    try:
        signals = generate_signals(
            hist, calls_f, puts_f,
            reference_price=price_approx,
            implied_iv_history=iv_hist_past,
        )
        upsert_iv_atm_snapshot(ticker, session_et, signals.current_iv)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Signal generation failed: {str(e)}")

    try:
        trades = run_engine(
            signals, calls_f, puts_f, list(opt_dates),
            spread_width_override=spread_width,
            weeks_out=weeks_out,
            strategy_mode=strategy_mode,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Trade engine failed: {str(e)}")

    return serialize_regular_trade(ticker, company_name, price_approx, trades, signals)


@app.get("/api/signal-feed")
def get_signal_feed(
    auth_email: str = Depends(require_access_email),
    search: str | None = None,
    source: str | None = None,
    sort_by: str = "engine_agreement",
    sort_dir: str = "desc",
    page: int = 1,
    page_size: int = 25,
    refresh: bool = False,
):
    import time as _time
    _t0 = _time.time()

    email = normalize_email(auth_email)
    if refresh:
        with signal_feed_cache_lock:
            for key in [k for k in signal_feed_cache if k.startswith(f"{email}:")]:
                signal_feed_cache.pop(key, None)
    state = get_user_state(email)
    if not state.get("my_tickers"):
        _seed_default_my_tickers(email)
        state = get_user_state(email)
    source_items = _signal_feed_source_items(state)
    if not source_items:
        _seed_default_my_tickers(email)
        state = get_user_state(email)
        source_items = _signal_feed_source_items(state)
    source_filter = str(source or "").strip().lower()
    if source_filter in {"day", "swing", "regular"}:
        source_items = [
            item for item in source_items
            if source_filter in {str(src or "").strip().lower() for src in (item.get("sources") or [])}
        ]
    portfolio_tickers = {
        str(item.get("ticker", "")).strip().upper()
        for item in (state.get("portfolio") or [])
        if isinstance(item, dict) and str(item.get("status", "open")).lower() == "open"
    }
    source_signature = _signal_feed_source_signature(source_items, portfolio_tickers)
    cache_key = f"{email}:{source_filter if source_filter in {'day', 'swing', 'regular'} else 'all'}"
    now = _time.time()
    if not refresh:
        with signal_feed_cache_lock:
            cached = signal_feed_cache.get(cache_key)
        if cached:
            cached_at, cached_signature, cached_rows, cached_meta = cached
            cache_age = now - cached_at
            if cached_signature == source_signature and cache_age < SIGNAL_FEED_CACHE_TTL_SECONDS:
                _elapsed_ms = round((_time.time() - _t0) * 1000)
                meta = {
                    **cached_meta,
                    "used_cache": True,
                    "force_refresh": False,
                    "payload_cache_age_seconds": round(cache_age, 1),
                    "source": "signal_feed_payload_cache",
                }
                logging.getLogger(__name__).info(
                    "WATCHLISTX_LOAD_CACHE_HIT ticker_count=%d elapsed_ms=%d age=%.1f ttl=%d",
                    len(cached_rows),
                    _elapsed_ms,
                    cache_age,
                    SIGNAL_FEED_CACHE_TTL_SECONDS,
                )
                return _signal_feed_response_from_rows(
                    cached_rows,
                    search=search,
                    sort_by=sort_by,
                    sort_dir=sort_dir,
                    page=page,
                    page_size=page_size,
                    cache_meta=meta,
                    elapsed_ms=_elapsed_ms,
                )

    # Bulk-prefetch quotes into the shared cache before the engine loop.
    # This fills the quote cache so engine calls that read from it find a
    # warm entry and do not independently re-fetch the same ticker.
    all_tickers = [
        str(item.get("ticker") or "").strip().upper()
        for item in source_items
        if item.get("ticker")
    ]
    _prefetched_quotes, _cache_meta = _get_quotes_in_day_trade_batches(all_tickers, force_refresh=refresh)
    alert_counts = alert_center_active_counts_by_ticker(email, all_tickers)
    _existing_day_watch = [
        str(sym or "").strip().upper()
        for sym in (state.get("day_trade_watchlist") or [])
        if str(sym or "").strip()
    ]
    _auto_day_watch_additions: list[str] = []

    rows: list[dict[str, Any]] = []
    for item in source_items:
        ticker = str(item.get("ticker") or "").strip().upper()
        if not ticker:
            continue

        regular_data: AnalyzeResponse | None = None
        regular_decision = None
        day_decision = None
        swing_decision = None
        regular_reason = ""
        day_reason = ""
        swing_reason = ""
        regular_raw = ""
        day_raw = ""
        swing_raw = ""
        day_metrics: dict[str, Any] = {}
        swing_metrics: dict[str, Any] = {}
        day_scan = None
        swing_scan = None

        try:
            regular_data = _get_analysis_with_cache(ticker, weeks_out=4, spread_width=None, strategy_mode="all", force_refresh=refresh)
            regular_decision = resolve_trade_decision(
                {"engine_type": "regular", "signals": regular_data.signals, "recommendations": regular_data.recommendations}
            )
            regular_reason = regular_data.reason
            # Use score-based verdict matching the serializer (unified_analysis.py)
            score = regular_data.recommendations[0].total_score if regular_data.recommendations else 0
            if score >= 70:
                regular_raw = "STRONG GO" if score >= 85 else "GO"
            elif score >= 50:
                regular_raw = "WATCH"
            else:
                regular_raw = "WAIT"
        except Exception as exc:  # noqa: BLE001
            regular_reason = f"Regular evaluation unavailable: {exc}"

        try:
            day_scan = run_day_trade_scan(ticker, force_refresh=refresh)
            day_decision = resolve_trade_decision(
                {
                    "engine_type": "day",
                    "ticker": day_scan.ticker,
                    "verdict": day_scan.verdict,
                    "bias": day_scan.bias,
                    "reasons": day_scan.reasons,
                    "metrics": day_scan.metrics,
                    "trader_decision": day_scan.trader_decision,
                }
            )
            day_metrics = dict(day_scan.metrics or {})
            day_reason = day_decision.reason
            day_raw = day_scan.verdict
        except Exception as exc:  # noqa: BLE001
            day_reason = f"Day evaluation unavailable: {exc}"

        try:
            swing_scan = run_swing_trade_scan(ticker, force_refresh=refresh)
            swing_decision = resolve_trade_decision(
                {
                    "engine_type": "swing",
                    "ticker": swing_scan.ticker,
                    "verdict": swing_scan.verdict,
                    "bias": swing_scan.bias,
                    "reasons": swing_scan.reasons,
                    "metrics": swing_scan.metrics,
                    "swing_bias": swing_scan.swing_bias,
                    "entry_quality": swing_scan.entry_quality,
                    "risk_level": swing_scan.risk_level,
                    "final_action": swing_scan.final_action,
                    "trade_quality_score": swing_scan.trade_quality_score,
                    "decision_message": swing_scan.decision_message,
                    "confirmation_needed": swing_scan.confirmation_needed,
                    "avoid_reason": swing_scan.avoid_reason,
                }
            )
            swing_metrics = dict(swing_scan.metrics or {})
            swing_reason = swing_decision.reason
            swing_raw = swing_scan.verdict
        except Exception as exc:  # noqa: BLE001
            swing_reason = f"Swing evaluation unavailable: {exc}"

        price = float(getattr(regular_data.signals, "current_price", 0.0) or 0.0) if regular_data else 0.0
        day_change = float(getattr(regular_data.signals, "price_change", 0.0) or 0.0) if regular_data else 0.0
        change_pct = float(getattr(regular_data.signals, "price_change_pct", 0.0) or 0.0) if regular_data else 0.0
        trend = str(getattr(regular_data.signals, "trend", "NEUTRAL") or "NEUTRAL") if regular_data else "NEUTRAL"
        rsi = float(getattr(regular_data.signals, "rsi", 0.0) or 0.0) if regular_data else 0.0
        relative_strength = float(day_metrics.get("rs_vs_qqq_pct") or 0.0)
        sector = str(getattr(regular_data, "sector", "") or "").strip() if regular_data else ""
        iv_rank = float(getattr(regular_data.signals, "iv_rank", 0.0) or 0.0) if regular_data else 0.0

        # Enrich price from quote cache if regular engine returned 0
        _q = _prefetched_quotes.get(ticker)
        if _q and not price and _q.price:
            price = _q.price
            change_pct = _q.change_percent
            day_change = getattr(_q, "change", day_change) or day_change
        if not day_metrics and _q:
            day_metrics = _signal_feed_quote_day_metrics(_q, error_reason=day_reason)
            if day_reason:
                day_reason = f"Live quote stream active; intraday bars pending. {day_reason}"
        _row_cache_age = round(_q.cache_age_seconds, 1) if _q else 0.0
        _row_quote_source = _q.source if _q else "unavailable"
        regular_payload = _signal_feed_decision_payload(regular_decision, label="regular", raw_signal=regular_raw, reason=regular_reason)
        day_payload = _signal_feed_decision_payload(day_decision, label="day", raw_signal=day_raw, reason=day_reason)
        swing_payload = _signal_feed_decision_payload(swing_decision, label="swing", raw_signal=swing_raw, reason=swing_reason)

        # ── Last-state tracking for all three engines ─────────────────────────
        # State changes are advisory lifecycle data only. They must not notify;
        # actionable alerts are limited to entry conditions, target hits, exits.
        today = datetime.today().strftime('%Y-%m-%d')
        for eng, action in [("DAY", day_raw), ("SWING", swing_raw), ("REGULAR", regular_raw)]:
            if action:
                upsert_ticker_state_last(email, ticker, eng, 0, action, today)

        # ── Attach day-trade option risk context ───────────────────────────────
        if day_scan is not None:
            day_payload["option_risk_context"] = day_scan.option_risk_context

        # ── Apply cross-engine score normalization ──────────────────────────────
        if day_scan is not None and day_decision is not None:
            day_payload.update(normalize_day_score(
                bull_score=day_scan.bull_score,
                bear_score=day_scan.bear_score,
                verdict=str(day_scan.verdict or ""),
                metrics=day_metrics,
                decision_confidence=int(day_decision.confidence or 0),
                decision_risk_state=str(day_decision.risk_state or "MEDIUM"),
                entry_guidance=day_scan.entry_guidance,
                reasons=day_scan.reasons,
            ))
        if swing_scan is not None and swing_decision is not None:
            swing_payload.update(normalize_swing_score(
                trade_quality_score=swing_scan.trade_quality_score,
                verdict=str(swing_scan.verdict or ""),
                final_action=str(swing_scan.final_action or ""),
                entry_quality=str(swing_scan.entry_quality or ""),
                risk_level=str(swing_scan.risk_level or "MEDIUM"),
                swing_bias=str(swing_scan.swing_bias or ""),
                decision_confidence=int(swing_decision.confidence or 0),
                decision_risk_state=str(swing_decision.risk_state or "MEDIUM"),
                metrics=swing_scan.metrics,
                bull_score=swing_scan.bull_score,
                bear_score=swing_scan.bear_score,
                reasons=swing_scan.reasons,
            ))
        if regular_decision is not None:
            top_rec = regular_data.recommendations[0] if regular_data and regular_data.recommendations else None
            regular_payload.update(normalize_regular_score(
                top_candidate={
                    "scores": {"total_score": getattr(top_rec, "total_score", 0) or 0} if top_rec else {},
                    "expected_value": getattr(top_rec, "expected_value", 0) if top_rec else 0,
                    "edge_ratio": getattr(top_rec, "edge_ratio", 0) if top_rec else 0,
                    "dte": getattr(top_rec, "dte", 0) if top_rec else 0,
                    "passes_liquidity_filter": getattr(top_rec, "passes_liquidity_filter", False) if top_rec else False,
                    "passes_rr_filter": getattr(top_rec, "passes_rr_filter", False) if top_rec else False,
                } if top_rec else None,
                signals={"bias_confidence": getattr(regular_data.signals, "bias_confidence", 0) if regular_data else 0,
                         "iv_rank": getattr(regular_data.signals, "iv_rank", 0) if regular_data else 0,
                         "iv_environment": getattr(regular_data.signals, "iv_environment", "") if regular_data else "",
                         } if regular_data else None,
                decision_confidence=int(regular_decision.confidence or 0),
                decision_risk_state=str(regular_decision.risk_state or "MEDIUM"),
                decision_reason=regular_reason,
            ))

        agreement_state, agreement_reason = _signal_feed_agreement_state(
            ticker=ticker,
            decisions=[
                day_payload["final_decision"],
                swing_payload["final_decision"],
                regular_payload["final_decision"],
            ],
            setup_qualities=[
                day_payload["setup_quality"],
                swing_payload["setup_quality"],
                regular_payload["setup_quality"],
            ],
            reasons=[
                day_payload["reason"],
                swing_payload["reason"],
                regular_payload["reason"],
            ],
            in_portfolio=ticker in portfolio_tickers,
        )
        agreement_badge = _signal_feed_agreement_badge(
            decisions=[
                day_payload["final_decision"],
                swing_payload["final_decision"],
                regular_payload["final_decision"],
            ],
            reasons=[
                day_payload["reason"],
                swing_payload["reason"],
                regular_payload["reason"],
            ],
            in_portfolio=ticker in portfolio_tickers,
        )
        dominant_bull = float(
            getattr(swing_scan, "bull_score", 0.0) if swing_scan is not None else getattr(day_scan, "bull_score", 0.0)
        )
        dominant_bear = float(
            getattr(swing_scan, "bear_score", 0.0) if swing_scan is not None else getattr(day_scan, "bear_score", 0.0)
        )
        trend_score = float(
            getattr(swing_scan, "trade_quality_score", 0.0)
            if swing_scan is not None and getattr(swing_scan, "trade_quality_score", None) is not None
            else swing_payload.get("confidence") or regular_payload.get("confidence") or 0.0
        )
        morning_scan = _signal_feed_morning_trend_scan(day_metrics, fallback_change_pct=change_pct)
        market_structure = _signal_feed_market_structure(day_metrics)
        if morning_scan.get("trending") and ticker not in _existing_day_watch and ticker not in _auto_day_watch_additions:
            _auto_day_watch_additions.append(ticker)
        row_metrics = {
            "rsi": round(rsi, 2),
            "relative_strength": round(relative_strength, 2),
            "volume_ratio": morning_scan.get("volume_vs_average"),
            "iv_rank": round(iv_rank, 2) if iv_rank else None,
            "bull_score": round(dominant_bull, 2) if dominant_bull else None,
            "bear_score": round(dominant_bear, 2) if dominant_bear else None,
            "trend_score": round(trend_score, 2) if trend_score else None,
            "market_context": _signal_feed_market_context_label(day_metrics, swing_metrics),
            "morning_session_change_pct": morning_scan.get("session_change_pct"),
            "morning_volume_vs_average": morning_scan.get("volume_vs_average"),
            "morning_consecutive_candles": morning_scan.get("consecutive_same_direction_candles"),
            "morning_candle_direction": morning_scan.get("candle_direction"),
            "morning_directional_consistency": morning_scan.get("directional_consistency"),
            "morning_trending": morning_scan.get("trending"),
            "or_high": day_metrics.get("or_high"),
            "or_low": day_metrics.get("or_low"),
            "vwap": day_metrics.get("vwap"),
            "market_structure": market_structure,
        }

        chart_points = []
        if regular_data:
            chart_points = [{"date": point.date, "close": point.close} for point in regular_data.price_history[-30:]]

        row = {
            "id": item.get("id") or f"wlx-{ticker}",
            "ticker": ticker,
            "company_name": getattr(regular_data, "company_name", ticker) if regular_data else ticker,
            "sector": sector or "N/A",
            "price": round(price, 2) if price else 0.0,
            "price_change": round(day_change, 2),
            "price_change_pct": round(change_pct, 2),
            "trend": trend,
            "rsi": round(rsi, 2),
            "relative_strength": round(relative_strength, 2),
            "day_decision": day_payload["final_decision"],
            "swing_decision": swing_payload["final_decision"],
            "regular_decision": regular_payload["final_decision"],
            "agreement_state": agreement_state,
            "agreement_badge": agreement_badge,
            "agreement_reason": agreement_reason,
            "trending_today": bool(morning_scan.get("trending")),
            "morning_scan": morning_scan,
            "alerts_count": int(alert_counts.get(ticker, 0)),
            "sources": item.get("sources") or [],
            "notes": item.get("notes"),
            "added_at": item.get("added_at") or "",
            "cache_age_seconds": _row_cache_age,
            "quote_source": _row_quote_source,
            "metrics": row_metrics,
            "ai_summary": (
                f"Day is {day_payload['final_decision']}, Swing is {swing_payload['final_decision']}, "
                f"Regular is {regular_payload['final_decision']}. {agreement_reason}"
            ),
            "chart_points": chart_points,
            "day": {**day_payload, "metrics": day_metrics},
            "swing": {
                **swing_payload,
                "metrics": swing_metrics,
                "expected_holding_period": getattr(swing_scan, "expected_holding_period", "") or "",
                "recommended_contract_duration": getattr(swing_scan, "recommended_contract_duration", "") or "",
            },
            "regular": {
                **regular_payload,
                "strategy": regular_data.recommendations[0].strategy if regular_data and regular_data.recommendations else "",
                "bias": regular_data.recommendations[0].bias if regular_data and regular_data.recommendations else "",
            },
            "actions": {
                "analyze_url": f"/?ticker={ticker}",
                "chart_url": f"/?ticker={ticker}",
                "positions_url": f"/positions?tab=open&add=manual&ticker={ticker}",
                "alerts_url": f"/alerts?ticker={ticker}",
            },
        }
        rows.append(row)

    if _auto_day_watch_additions:
        save_user_state(
            email,
            state.get("watchlist") or [],
            state.get("portfolio") or [],
            day_trade_watchlist=_existing_day_watch + _auto_day_watch_additions,
            swing_trade_watchlist=state.get("swing_trade_watchlist") or [],
            alert_email_enabled=bool(state.get("alert_email_enabled", True)),
            my_tickers=state.get("my_tickers") or [],
        )

    _elapsed_ms = round((_time.time() - _t0) * 1000)
    fresh_meta = {
        "used_cache": False,
        "cache_hits": _cache_meta.get("cache_hits", 0),
        "cache_misses": _cache_meta.get("cache_misses", 0),
        "force_refresh": refresh,
        "oldest_cache_age_seconds": _cache_meta.get("oldest_cache_age_seconds", 0.0),
        "source": _cache_meta.get("source", "unknown"),
        "payload_cache_age_seconds": 0.0,
        "auto_added_day_watch": len(_auto_day_watch_additions),
    }
    with signal_feed_cache_lock:
        signal_feed_cache[cache_key] = (_time.time(), source_signature, rows, fresh_meta)
    logging.getLogger(__name__).info(
        "WATCHLISTX_LOAD ticker_count=%d cache_hits=%d cache_misses=%d "
        "yahoo_fetch_count=%d elapsed_ms=%d force_refresh=%s payload_cached=true ttl=%d",
        len(all_tickers),
        _cache_meta.get("cache_hits", 0),
        _cache_meta.get("cache_misses", 0),
        _cache_meta.get("cache_misses", 0),  # each miss = one Yahoo batch call
        _elapsed_ms,
        refresh,
        SIGNAL_FEED_CACHE_TTL_SECONDS,
    )

    return _signal_feed_response_from_rows(
        rows,
        search=search,
        sort_by=sort_by,
        sort_dir=sort_dir,
        page=page,
        page_size=page_size,
        cache_meta=fresh_meta,
        elapsed_ms=_elapsed_ms,
    )


@app.post("/api/signal-feed/refresh")
def refresh_signal_feed(
    auth_email: str = Depends(require_access_email),
):
    """
    Force-refresh the SignalFeed quote cache and engine scan caches for the
    user's current watchlist tickers.  Returns the same payload as GET
    /api/signal-feed?refresh=true but via an explicit POST so the frontend
    can distinguish intentional refreshes from page loads.
    """
    import time as _time
    _t0 = _time.time()

    email = normalize_email(auth_email)
    state = get_user_state(email)
    source_items = _signal_feed_source_items(state)
    if not source_items:
        _seed_default_my_tickers(email)
        state = get_user_state(email)
        source_items = _signal_feed_source_items(state)
    all_tickers = [
        str(item.get("ticker") or "").strip().upper()
        for item in source_items
        if item.get("ticker")
    ]
    # Warm the quote cache first so downstream engine calls find entries
    _prefetched_quotes, _cache_meta = _get_quotes_in_day_trade_batches(all_tickers, force_refresh=True)

    logging.getLogger(__name__).info(
        "WATCHLISTX_REFRESH ticker_count=%d quote_batch_count=%d yahoo_fetch_count=%d elapsed_ms=%d",
        len(all_tickers),
        _cache_meta.get("batch_count", 0),
        _cache_meta.get("cache_misses", 0),
        round((_time.time() - _t0) * 1000),
    )

    return api_envelope(
        {
            "ok": True,
            "refreshed_tickers": all_tickers,
            "cache": {
                "cache_hits": _cache_meta.get("cache_hits", 0),
                "cache_misses": _cache_meta.get("cache_misses", 0),
                "batch_size": _cache_meta.get("batch_size", _day_trade_quote_batch_size()),
                "batch_count": _cache_meta.get("batch_count", 0),
                "force_refresh": True,
                "oldest_cache_age_seconds": _cache_meta.get("oldest_cache_age_seconds", 0.0),
                "source": _cache_meta.get("source", "yahoo_live"),
                "elapsed_ms": round((_time.time() - _t0) * 1000),
            },
        }
    )


@app.post("/api/cache/clear")
def clear_all_caches(
    auth_email: str = Depends(require_access_email),
):
    """
    Forcefully wipe all in-memory data caches and re-fetch fresh data from
    Yahoo Finance on the next request.

    Clears:
      • bar_cache    — OHLCV bars, .info, option chain, calendar (yfinance)
      • quote_cache  — live ticker quotes used by Signal Feed
      • analysis_cache / analyze_user_cache — engine analysis results
      • day_trade._scan_cache   — day trade scan results
      • swing_trade._scan_cache — swing trade scan results
    """
    import bar_cache as _bc
    import quote_cache as _qc

    bc_cleared = len(_bc._store)
    qc_cleared = len(_qc._store)
    _bc.invalidate_all()
    _qc.invalidate_all()

    with analysis_cache_lock:
        ac_cleared = len(analysis_cache)
        analysis_cache.clear()

    with analyze_user_cache_lock:
        auc_cleared = len(analyze_user_cache)
        analyze_user_cache.clear()
    with signal_feed_cache_lock:
        sf_cleared = len(signal_feed_cache)
        signal_feed_cache.clear()

    dt_cleared = _clear_day_scan_cache()
    sw_cleared = _clear_swing_scan_cache()

    total = bc_cleared + qc_cleared + ac_cleared + auc_cleared + sf_cleared + dt_cleared + sw_cleared
    logging.getLogger(__name__).info(
        "CACHE_CLEAR bar=%d quote=%d analysis=%d analyze_user=%d signal_feed=%d day_scan=%d swing_scan=%d total=%d",
        bc_cleared, qc_cleared, ac_cleared, auc_cleared, sf_cleared, dt_cleared, sw_cleared, total,
    )

    return api_envelope({
        "ok": True,
        "cleared": {
            "bar_cache":          bc_cleared,
            "quote_cache":        qc_cleared,
            "analysis_cache":     ac_cleared,
            "analyze_user_cache": auc_cleared,
            "signal_feed_cache":   sf_cleared,
            "day_scan_cache":     dt_cleared,
            "swing_scan_cache":   sw_cleared,
        },
        "total_entries_cleared": total,
    })


@app.post("/api/signal-feed/alerts")
def create_signal_feed_alert(
    body: SignalFeedAlertCreateBody,
    auth_email: str = Depends(require_access_email),
):
    email = normalize_email(auth_email)
    ticker = body.ticker.strip().upper()
    state = str(body.agreement_state or "WATCH").strip().upper()
    severity = "CRITICAL" if state in {"AVOID", "CONFLICT"} else "WARNING" if state in {"WATCH", "EXTENDED", "MANAGE"} else "INFO"
    signal = "AVOID" if state in {"AVOID", "CONFLICT"} else "WATCH" if state in {"WATCH", "EXTENDED"} else "EXIT" if state == "MANAGE" else "GO"
    title = body.message.strip() or f"{ticker} watchlist follow-up"
    recommended_action = body.recommended_action.strip() or "Review the unified watchlist row before acting."
    alert_id = alert_center_create(
        email,
        alert_group="regular_trade",
        severity=severity,
        engine="REGULAR",
        signal=signal,
        title=title,
        body=recommended_action,
        meta={
            "ticker": ticker,
            "alert_type": "WATCHLISTX_MANUAL",
            "engine_type": "REGULAR",
            "recommended_action": recommended_action,
            "reason": title,
        },
    )
    return api_envelope({"ok": True, "id": alert_id})


@app.post("/api/day-trade", response_model=DayTradeResponse)
def day_trade_scan(
    req: DayTradeRequest,
    auth_email: str = Depends(require_access_email),
):
    """
    Intraday prototype: 1m RTH, VWAP / OR / momentum / volume + RS vs QQQ session + confidence block;
    verdicts: STRONG GO, GO, WATCH (weak volume), NO-GO, WAIT.
    """
    try:
        r = run_day_trade_scan(req.ticker, force_refresh=req.force_refresh)
        resolved = resolve_trade_decision(
            {
                "engine_type": "day",
                "ticker": r.ticker,
                "verdict": r.verdict,
                "bias": r.bias,
                "reasons": r.reasons,
                "metrics": r.metrics,
                "trader_decision": r.trader_decision,
            }
        )
        # Build AI coaching summary from the resolved scan + decision fields
        _scan_dict_for_coach = {
            "ticker":             r.ticker,
            "bias":               r.bias,
            "verdict":            r.verdict,
            "confidence":         resolved.confidence,
            "display_confidence": int(resolved.display_confidence or 0),
            "metrics":            dict(r.metrics or {}),
            "entry_guidance":     dict(r.entry_guidance or {}),
        }
        try:
            ai_coach_result = get_ai_coach(
                _scan_dict_for_coach,
                risk_state=resolved.risk_state or "MEDIUM",
            )
        except Exception as _coach_exc:  # noqa: BLE001
            log.warning("AI coach error for %s: %s", r.ticker, _coach_exc)
            ai_coach_result = {}

        timeframe_state = dict((r.metrics or {}).get("timeframe_state") or {})
        layered_decision = dict((r.metrics or {}).get("layered_decision") or {})
        timeframe_final = str(timeframe_state.get("final_decision") or (r.metrics or {}).get("timeframe_final_decision") or "").upper()
        final_decision = timeframe_final or str(resolved.verdict or "WAIT").upper()
        if timeframe_final in {"NO_TRADE", "TRACK_ONLY", "WAIT_ENTRY", "DO_NOT_CHASE", "GO", "OPENING_RANGE", "WAIT_PULLBACK", "NO_EDGE", "EXECUTE", "READY"}:
            # The explicit 15m→5m→1m hierarchy is the authoritative day-trade
            # execution gate. Keep the resolver fields for context, but expose
            # the gated decision as final_decision.
            final_decision = timeframe_final

        return DayTradeResponse(
            ticker=r.ticker,
            company_name=r.company_name,
            verdict=r.verdict,
            bias=r.bias,
            bull_score=r.bull_score,
            bear_score=r.bear_score,
            reasons=r.reasons,
            metrics=r.metrics,
            trader_decision=r.trader_decision,
            market_bias=resolved.market_bias,
            setup_quality=resolved.setup_quality,
            final_decision=final_decision,
            confidence=resolved.confidence,
            reason=resolved.reason,
            supporting_factors=resolved.supporting_factors,
            missing_confirmations=resolved.missing_confirmations,
            risk_state=resolved.risk_state,
            explanation=dict(resolved.explanation or {}),
            risk_reason=resolved.risk_reason or "",
            display_confidence=int(resolved.display_confidence or 0),
            execution_fields=list(resolved.execution_fields or []),
            entry_guidance=dict(r.entry_guidance or {}),
            timeframe_state=timeframe_state,
            layered_decision=layered_decision,
            option_risk_context=dict(r.option_risk_context or {}),
            ai_coach=ai_coach_result,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e)) from None


@app.get("/api/day-trade/workspace", response_model=DayTradeWorkspaceResponseModel)
def day_trade_workspace(
    symbol: str = Query(..., min_length=1),
    sessionDate: Optional[str] = Query(default=None),
    interval: str = Query(default="1m", regex="^(1m|5m|15m|1h)$"),
    force_refresh: bool = Query(default=False),
    auth_email: str = Depends(require_access_email),
):
    """Page-ready Day Trade workspace model.

    This endpoint is the backend-owned presentation contract for the V2 Day
    Trade workspace. It wraps existing Day Trade calculations; it does not add
    strategy rules.
    """
    session_date_value = sessionDate if isinstance(sessionDate, str) and sessionDate.strip() else None
    try:
        return _build_day_trade_workspace_payload(
            symbol=symbol,
            session_date=session_date_value,
            interval=interval,
            force_refresh=force_refresh,
        )
    except Exception as exc:
        logging.getLogger(__name__).warning(
            "DAY_TRADE_WORKSPACE_UNAVAILABLE symbol=%s interval=%s sessionDate=%s error=%s",
            symbol,
            interval,
            session_date_value,
            exc,
        )
        return build_day_trade_workspace_unavailable_response(
            symbol=symbol,
            session_date=session_date_value,
            interval=interval,
            reason=f"Unable to build Day Trade workspace: {exc}",
        )


@app.get("/api/position-trade/session-chart")
def position_trade_session_chart(
    symbol: str = Query(..., min_length=1),
    force_refresh: bool = Query(default=False, alias="force_refresh"),
) -> dict[str, Any]:
    """Return the Position Trading chart in the Swing Trade timeframe model."""
    ticker = symbol.strip().upper()
    if not ticker:
        raise HTTPException(status_code=400, detail="symbol is required")
    try:
        raw = bar_cache.get_history(ticker, period="2y", interval="1d", auto_adjust=True, force_refresh=force_refresh)
        if raw is None or raw.empty or "Close" not in raw.columns:
            raise ValueError("No daily price history returned for the position chart.")
        raw = raw.sort_index().dropna(subset=["Close"])
        try:
            info = bar_cache.get_info(ticker, force_refresh=force_refresh)
        except Exception:
            info = {}
        last_close = float(raw["Close"].iloc[-1])
        previous_close = float(raw["Close"].iloc[-2]) if len(raw) > 1 else None
        change_amount = last_close - previous_close if previous_close else None
        change_percent = (change_amount / previous_close * 100.0) if previous_close and change_amount is not None else None
        return {
            "schemaVersion": "position-swing-chart.v1",
            "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "symbol": {
                "ticker": ticker,
                "companyName": str(info.get("longName") or info.get("shortName") or ticker),
                "price": round(last_close, 4),
                "changeAmount": round(change_amount, 4) if change_amount is not None else None,
                "changePercent": round(change_percent, 4) if change_percent is not None else None,
            },
            "chartSeriesByTimeframe": {
                timeframe: build_swing_chart_timeframe_series(raw, timeframe)
                for timeframe in ("Daily", "Weekly", "Monthly")
            },
            "marketStructure": build_swing_market_structure(raw),
        }
    except Exception as exc:
        log.warning("POSITION_SESSION_CHART_UNAVAILABLE symbol=%s error=%s", ticker, exc)
        raise HTTPException(status_code=502, detail=f"Position session chart unavailable for {ticker}: {exc}") from exc


def _build_day_trade_workspace_payload(
    *,
    symbol: str,
    session_date: str | None = None,
    interval: str = "1m",
    force_refresh: bool = False,
) -> dict[str, Any]:
    ticker = symbol.strip().upper()
    session_date_value = session_date if isinstance(session_date, str) and session_date.strip() else None
    interval_value = interval if isinstance(interval, str) and interval in {"1m", "5m", "15m", "1h"} else "1m"
    r = run_day_trade_scan(ticker, force_refresh=force_refresh)
    resolved_obj = resolve_trade_decision(
        {
            "engine_type": "day",
            "ticker": r.ticker,
            "verdict": r.verdict,
            "bias": r.bias,
            "reasons": r.reasons,
            "metrics": r.metrics,
            "trader_decision": r.trader_decision,
        }
    )
    timeframe_state = dict((r.metrics or {}).get("timeframe_state") or {})
    timeframe_final = str(timeframe_state.get("final_decision") or (r.metrics or {}).get("timeframe_final_decision") or "").upper()
    final_decision = timeframe_final or str(resolved_obj.verdict or "WAIT").upper()
    resolved = {
        "verdict": str(resolved_obj.verdict or "WAIT").upper(),
        "final_decision": final_decision,
        "market_bias": resolved_obj.market_bias,
        "headline": final_decision.replace("_", " ").title(),
        "reason": resolved_obj.reason,
        "supporting_factors": list(resolved_obj.supporting_factors or []),
        "missing_confirmations": list(resolved_obj.missing_confirmations or []),
        "risk_state": resolved_obj.risk_state,
        "confidence": resolved_obj.confidence,
        "display_confidence": int(resolved_obj.display_confidence or 0),
    }
    return build_day_trade_workspace_response(
        scan=r,
        resolved=resolved,
        session_date=session_date_value,
        interval=interval_value,
    )


class TradeCheckRequest(BaseModel):
    message: str
    ticker: str | None = None  # override ticker if parsed from message

class TradeCheckResult(BaseModel):
    overall: str
    overall_msg: str
    checks: list[dict]
    ticker: str
    option_type: str
    strike: float
    dte: int
    contracts: int
    last_price: float
    verdict: str
    confidence: int
    parse_error: str = ""
    parse_notes: list[str] = []

def _parse_trade_intent(message: str, default_ticker: str | None = None) -> dict:
    """Extract ticker/type/strike/DTE/contracts from natural language."""
    import re
    msg = message.strip()
    upper = msg.upper()

    # Ticker: explicit 1-5 letter cap word, skip common words
    skip = {"DTE", "CALL", "PUT", "THE", "NOW", "FOR", "BUY", "SELL", "SHOULD", "I", "TRADE", "STRIKE", "PRICE", "CONTRACT", "CONTRACTS", "A"}
    ticker = default_ticker or ""
    m = re.search(r'\b([A-Z]{1,5})\b', upper)
    while m:
        candidate = m.group(1)
        if candidate not in skip:
            ticker = candidate
            break
        m = re.search(r'\b([A-Z]{1,5})\b', upper, m.end())

    # Option type
    option_type = "call"
    if re.search(r'\bput\b', msg, re.I):
        option_type = "put"
    elif re.search(r'\bcall\b', msg, re.I):
        option_type = "call"

    parse_notes: list[str] = []

    # DTE: number before/after "dte", plus common plain-English windows.
    dte = 0
    m = re.search(r'(\d+)\s*dte', msg, re.I)
    if not m:
        m = re.search(r'dte\s*(\d+)', msg, re.I)
    if m:
        dte = int(m.group(1))
    elif re.search(r'\bnext\s+week\b|\bweekly\b|\bweek\s*out\b', msg, re.I):
        dte = 7
        parse_notes.append("No numeric DTE found; interpreted 'next week' as 7 DTE.")
    elif re.search(r'\btomorrow\b', msg, re.I):
        dte = 1
        parse_notes.append("No numeric DTE found; interpreted 'tomorrow' as 1 DTE.")
    elif re.search(r'\btoday\b|\b0\s*dte\b', msg, re.I):
        dte = 0
        parse_notes.append("No numeric DTE found; interpreted 'today' as 0 DTE.")
    elif re.search(r'\bswing\b', msg, re.I):
        dte = 14
        parse_notes.append("No numeric DTE found; interpreted 'swing' as 14 DTE.")

    # Strike: number near "strike" or adjacent to call/put keyword
    strike = 0.0
    m = re.search(r'(\d+(?:\.\d+)?)\s*(?:strike|call|put)', msg, re.I)
    if not m:
        m = re.search(r'(?:strike|call|put)\s*(?:price\s*)?(\d+(?:\.\d+)?)', msg, re.I)
    if m:
        strike = float(m.group(1))

    # Contracts
    contracts = 1
    m = re.search(r'(\d+)\s*contracts?', msg, re.I)
    if m:
        contracts = int(m.group(1))

    return {"ticker": ticker, "option_type": option_type, "strike": strike, "dte": dte, "contracts": contracts, "parse_notes": parse_notes}


def _infer_atm_strike(last_price: float, option_type: str) -> float:
    """Use a sane listed-strike approximation when the user asks for CALL/PUT without a strike."""
    import math
    if last_price <= 0:
        return 0.0
    step = 1.0 if last_price < 50 else 2.5 if last_price < 250 else 5.0
    if option_type.lower() == "call":
        return math.ceil((last_price - 1e-9) / step) * step
    return math.floor((last_price + 1e-9) / step) * step


def _evaluate_trade(ticker: str, option_type: str, strike: float, dte: int, contracts: int, r, parse_notes: list[str] | None = None) -> dict:
    """Rule-based option trade evaluation against day-trade scan result."""
    m = r.metrics or {}
    verdict    = r.verdict or "WAIT"
    bias       = (r.bias or "").lower()
    confidence = int(getattr(r, "confidence", 0) or 0)

    last_price    = float(m.get("last_price") or m.get("regular_market_price") or 0)
    vwap          = float(m.get("vwap") or 0)
    vwap_position = str(m.get("vwap_position") or "")
    or_high       = float(m.get("or_high") or 0)
    or_low        = float(m.get("or_low") or 0)
    or_breakout   = str(m.get("or_breakout") or "")
    rvol          = float(m.get("rvol") or 0)
    momentum_pct  = float(m.get("momentum_pct") or 0)
    atr14         = float(m.get("atr14") or 0)
    vix           = float(m.get("vix") or 0)
    spy_chg       = float(m.get("spy_change_pct") or 0)
    qqq_chg       = float(m.get("qqq_change_pct") or 0)
    session_phase = str(m.get("session_phase") or "")
    put_call_ratio= m.get("put_call_ratio")
    price_struct  = str(m.get("price_structure") or "")

    parse_notes = list(parse_notes or [])
    if strike <= 0 and last_price > 0:
        strike = _infer_atm_strike(last_price, option_type)
        parse_notes.append(f"No strike found; used nearest ATM strike ${strike:g} from last price ${last_price:.2f}.")

    is_call = option_type.lower() == "call"
    checks: list[dict] = []
    hard_fails = 0

    def chk(passed, label: str, msg: str):
        nonlocal hard_fails
        if passed is False:
            hard_fails += 1
        checks.append({"pass": passed, "label": label, "msg": msg})

    for note in parse_notes:
        chk(None, "Parsed Trade", note)

    timeframe_state = m.get("timeframe_state") if isinstance(m.get("timeframe_state"), dict) else {}
    timeframe_final = str((timeframe_state or {}).get("final_decision") or "").upper()
    if timeframe_final:
        if timeframe_final == "GO":
            chk(True, "Timeframe Gate", "15m setup, 5m confirmation, and 1m execution gate are aligned.")
        elif timeframe_final == "TRACK_ONLY":
            chk(False, "Timeframe Gate", "15m setup exists, but 5m confirmation is still pending. Track only; do not buy now.")
        elif timeframe_final == "WAIT_ENTRY":
            chk(False, "Timeframe Gate", "5m confirmation is present, but the 1m entry is not ready. Wait for execution.")
        elif timeframe_final == "DO_NOT_CHASE":
            chk(False, "Timeframe Gate", "Price is extended from VWAP/OR levels. Do not chase this option now.")
        elif timeframe_final == "NO_TRADE":
            chk(False, "Timeframe Gate", "15m/5m hierarchy blocks this trade right now.")
        else:
            chk(None, "Timeframe Gate", f"Backend timeframe decision: {timeframe_final}.")

    # ── 1. Engine verdict vs direction ──────────────────────────────────────
    go_verdicts = {"STRONG GO", "GO"}
    if verdict in go_verdicts and ((is_call and bias == "long") or (not is_call and bias == "short")):
        chk(True,  "Verdict", f"{verdict} with {bias} bias — engine aligns with your direction")
    elif verdict in go_verdicts:
        chk(False, "Verdict", f"{verdict} but bias is {bias or 'unknown'} — engine favors the opposite side. {'Put' if is_call else 'Call'} would align, not {'Call' if is_call else 'Put'}")
    else:
        chk(False, "Verdict", f"{verdict} — engine does not confirm a trade right now. Wait for GO or STRONG GO")

    # ── 2. VWAP position ────────────────────────────────────────────────────
    if is_call and vwap_position == "above":
        chk(True, "VWAP", f"Price ${last_price:.2f} above VWAP ${vwap:.2f} — bullish VWAP structure for calls")
    elif not is_call and vwap_position == "below":
        chk(True, "VWAP", f"Price ${last_price:.2f} below VWAP ${vwap:.2f} — bearish VWAP structure for puts")
    else:
        need = "above" if is_call else "below"
        chk(False, "VWAP", f"Price ${last_price:.2f} is {vwap_position} VWAP ${vwap:.2f} — {'calls' if is_call else 'puts'} need price {need} VWAP. Gap: {abs(last_price - vwap):.2f}")

    # ── 3. Opening range confirmation ────────────────────────────────────────
    if is_call and or_breakout == "above":
        chk(True, "Opening Range", f"Confirmed breakout above OR High ${or_high:.2f} — bull structure locked in")
    elif not is_call and or_breakout == "below":
        chk(True, "Opening Range", f"Confirmed breakdown below OR Low ${or_low:.2f} — bear structure locked in")
    else:
        level = f"OR High ${or_high:.2f}" if is_call else f"OR Low ${or_low:.2f}"
        chk(None, "Opening Range", f"No confirmed OR {'breakout' if is_call else 'breakdown'} yet — watching {level}")

    # ── 4. Volume ───────────────────────────────────────────────────────────
    if rvol >= 1.2:
        chk(True, "Volume", f"RVOL {rvol:.1f}x — strong above-average volume confirms momentum")
    elif rvol >= 0.85:
        chk(None, "Volume", f"RVOL {rvol:.1f}x — average volume, prefer ≥ 1.2x for high-conviction entry")
    else:
        chk(False, "Volume", f"RVOL {rvol:.1f}x — low volume. Moves on thin volume frequently reverse")

    # ── 5. Momentum ─────────────────────────────────────────────────────────
    if is_call and momentum_pct > 0.2:
        chk(True, "Momentum", f"+{momentum_pct:.2f}% recent momentum — price is moving in your direction")
    elif not is_call and momentum_pct < -0.2:
        chk(True, "Momentum", f"{momentum_pct:.2f}% recent momentum — price is moving in your direction")
    else:
        chk(None, "Momentum", f"{momentum_pct:+.2f}% recent momentum — no strong directional push yet")

    # ── 6. Strike moneyness ─────────────────────────────────────────────────
    if last_price > 0 and strike > 0:
        pct_otm = ((strike - last_price) / last_price * 100) if is_call else ((last_price - strike) / last_price * 100)
        dollars_to_profit = abs(strike - last_price)
        if pct_otm < -1:
            chk(True, "Strike", f"${strike} is {abs(pct_otm):.1f}% ITM (price ${last_price:.2f}) — positive delta working for you from entry")
        elif pct_otm <= 1:
            chk(True, "Strike", f"${strike} is near ATM (price ${last_price:.2f}, {pct_otm:.1f}% OTM) — high delta, responsive to price moves")
        elif pct_otm <= 3:
            chk(None, "Strike", f"${strike} is {pct_otm:.1f}% OTM — needs ${dollars_to_profit:.2f} move to reach breakeven at expiry. Feasible for day-trade if momentum is strong")
        else:
            chk(False, "Strike", f"${strike} is {pct_otm:.1f}% OTM (${dollars_to_profit:.2f} away at ${last_price:.2f}) — deep OTM. Probability of profit is low unless a large move occurs today")

    # ── 7. DTE risk ─────────────────────────────────────────────────────────
    if dte <= 0:
        chk(False, "DTE", "0 DTE — expiring today. Gamma is maximum, any reversal = total loss. Avoid unless scalping with tight stops and strong GO conviction")
    elif dte <= 3:
        chk(False, "DTE", f"{dte} DTE — extreme gamma risk. Premium decays by the hour. Only viable with STRONG GO + price already moving your way")
    elif dte <= 7:
        if verdict == "STRONG GO":
            chk(None, "DTE", f"{dte} DTE — high gamma risk, but STRONG GO verdict provides minimum justification. Manage tightly: stop at VWAP break")
        else:
            chk(False, "DTE", f"{dte} DTE with {verdict} verdict — too short for this setup quality. Short DTE needs STRONG GO minimum. Prefer 7–14 DTE instead")
    elif dte <= 14:
        chk(None, "DTE", f"{dte} DTE — moderate gamma risk, acceptable window for day/swing trade options")
    else:
        chk(True, "DTE", f"{dte} DTE — comfortable time buffer, reduced theta pressure")

    # ── 8. Session timing ───────────────────────────────────────────────────
    if session_phase in ("EOD_CLOSING",):
        chk(False, "Session", f"Market is closing ({session_phase}). Entering a short-DTE option in the last 30 min risks max loss or holding overnight")
    elif session_phase in ("LUNCH_DOLDRUMS",):
        chk(None, "Session", "Lunch session — low conviction, drifting price action. Wait for 1:30–2:00 PM ET reactivation before entering")
    elif session_phase in ("MORNING_PRIME", "OPEN_MOMENTUM"):
        chk(True, "Session", f"Prime trading window ({session_phase}) — best time for momentum plays")
    else:
        chk(None, "Session", f"Session: {session_phase or 'unknown'}")

    # ── 9. Market context ────────────────────────────────────────────────────
    if vix > 35:
        chk(False, "VIX", f"VIX {vix:.1f} — extreme fear. Options are very expensive (high IV premium). You risk buying at peak volatility")
    elif vix > 25:
        chk(None, "VIX", f"VIX {vix:.1f} — elevated. Option premiums inflated. Size down or use spreads")
    else:
        chk(True, "VIX", f"VIX {vix:.1f} — normal, option premiums are fair")

    broad_chg = qqq_chg
    if is_call and qqq_chg < -2.0:
        chk(False, "Market", f"QQQ down {qqq_chg:.1f}%, SPY {spy_chg:+.1f}% — buying calls into a falling market. Need extra conviction to fight the tape")
    elif not is_call and qqq_chg > 2.0:
        chk(False, "Market", f"QQQ up {qqq_chg:.1f}%, SPY {spy_chg:+.1f}% — buying puts into a rising market. Strong headwind")
    else:
        direction = "supporting" if (is_call and qqq_chg > 0) or (not is_call and qqq_chg < 0) else "neutral"
        chk(True if direction == "supporting" else None, "Market", f"QQQ {qqq_chg:+.1f}%, SPY {spy_chg:+.1f}% — market is {direction} for your direction")

    # ── 10. Confidence ──────────────────────────────────────────────────────
    if confidence >= 70:
        chk(True, "Confidence", f"Engine confidence {confidence}% — strong signal, higher edge")
    elif confidence >= 50:
        chk(None, "Confidence", f"Engine confidence {confidence}% — moderate. Tighten stops, reduce size")
    else:
        chk(False, "Confidence", f"Engine confidence {confidence}% — low signal quality. Wait for cleaner setup")

    # ── Put/Call ratio insight (no hard fail, just context) ─────────────────
    if put_call_ratio is not None:
        if is_call and put_call_ratio > 1.5:
            chk(None, "Options Flow", f"Put/Call ratio {put_call_ratio:.2f} — market leaning bearish in options flow. Calls are contrarian here")
        elif not is_call and put_call_ratio < 0.5:
            chk(None, "Options Flow", f"Put/Call ratio {put_call_ratio:.2f} — market leaning bullish in options flow. Puts are contrarian here")
        else:
            chk(True, "Options Flow", f"Put/Call ratio {put_call_ratio:.2f} — options flow aligns with your direction")

    # ── ATR risk sizing context ──────────────────────────────────────────────
    if atr14 > 0:
        daily_move = atr14
        chk(None, "Risk/Size", f"ATR14 ${atr14:.2f} — expect ±${daily_move:.2f}/day typical range. {contracts} contract(s) = ~${daily_move * 100 * contracts:.0f} exposure to a full-ATR move")

    # ── Overall ─────────────────────────────────────────────────────────────
    warn_count = sum(1 for c in checks if c["pass"] is None)
    pass_count = sum(1 for c in checks if c["pass"] is True)
    total = len(checks)

    if hard_fails == 0 and pass_count >= total * 0.6:
        overall, overall_msg = "TRADE", f"{pass_count}/{total} checks passed — setup is favorable. Manage risk: stop at VWAP break."
    elif hard_fails <= 1 and pass_count > warn_count:
        overall, overall_msg = "CAUTION", f"{hard_fails} critical issue — setup is marginal. Reduce size or wait for the failing check to resolve before entering."
    else:
        overall, overall_msg = "NO TRADE", f"{hard_fails} critical issue(s) block this trade. Wait for a cleaner setup."

    return {
        "overall": overall,
        "overall_msg": overall_msg,
        "checks": checks,
        "ticker": ticker,
        "option_type": option_type,
        "strike": strike,
        "dte": dte,
        "contracts": contracts,
        "last_price": last_price,
        "verdict": verdict,
        "confidence": confidence,
        "parse_error": "",
        "parse_notes": parse_notes,
    }


@app.post("/api/carry-trade", response_model=CarryTradeResponse)
def carry_trade_scan(
    req: CarryTradeRequest,
    auth_email: str = Depends(require_access_email),
):
    """
    Independent overnight continuation engine.
    Evaluates whether an options position should be carried into the next open.
    """
    try:
        result = run_carry_trade_scan(req.ticker, force_refresh=req.force_refresh)
        return CarryTradeResponse(**carry_analysis_to_dict(result))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Carry trade scan failed: {e}")


@app.post("/api/trade-dashboard/story")
def trade_dashboard_story(
    req: TradeDashboardStoryRequest,
    auth_email: str = Depends(require_access_email),
):
    try:
        return build_trade_dashboard_story(req.ticker, force_refresh=req.force_refresh)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Trade dashboard story failed: {e}")


@app.post("/api/day-trade/check")
def day_trade_check(
    req: TradeCheckRequest,
    auth_email: str = Depends(require_access_email),
):
    """
    Rule-based option trade evaluator. Parses the user's natural-language message
    (ticker, call/put, strike, DTE, contracts), runs the day-trade scan, and applies
    deterministic rules to return a pass/warn/fail checklist — no AI/LLM involved.
    """
    parsed = _parse_trade_intent(req.message, req.ticker)
    ticker    = parsed["ticker"]
    option_type = parsed["option_type"]
    strike    = parsed["strike"]
    dte       = parsed["dte"]
    contracts = parsed["contracts"]
    parse_notes = parsed.get("parse_notes") or []

    if not ticker:
        return {"overall": "ERROR", "overall_msg": "Could not identify a ticker. Example: 'Should I buy AMD 368 call, 5 DTE, 1 contract?'",
                "checks": [], "ticker": "", "option_type": option_type, "strike": strike,
                "dte": dte, "contracts": contracts, "last_price": 0, "verdict": "", "confidence": 0, "parse_error": "no_ticker", "parse_notes": parse_notes}

    if dte == 0:
        return {"overall": "ERROR", "overall_msg": f"Could not find DTE. Example: '{ticker} {strike or 'ATM'} {option_type} 5 DTE 1 contract', or say 'next week'.",
                "checks": [], "ticker": ticker, "option_type": option_type, "strike": strike,
                "dte": 0, "contracts": contracts, "last_price": 0, "verdict": "", "confidence": 0, "parse_error": "no_dte", "parse_notes": parse_notes}

    try:
        r = run_day_trade_scan(ticker)
    except Exception as e:
        return {"overall": "ERROR", "overall_msg": f"Could not fetch data for {ticker}: {e}",
                "checks": [], "ticker": ticker, "option_type": option_type, "strike": strike,
                "dte": dte, "contracts": contracts, "last_price": 0, "verdict": "", "confidence": 0, "parse_error": "scan_error", "parse_notes": parse_notes}

    return _evaluate_trade(ticker, option_type, strike, dte, contracts, r, parse_notes=parse_notes)


@app.post("/api/swing-trade", response_model=SwingTradeResponse)
def swing_trade_scan(
    req: SwingTradeRequest,
    auth_email: str = Depends(require_access_email),
):
    """
    Swing-trade prototype: daily candles, MA20/MA50 trend, RSI(14), MACD(12/26/9),
    5-day momentum, volume participation, SPY market context, VIX gate.
    Verdicts: STRONG GO, GO, WATCH, WAIT, NO-GO with long/short bias.
    """
    try:
        r = run_swing_trade_scan(req.ticker, force_refresh=req.force_refresh)
        resolved = resolve_trade_decision(
            {
                "engine_type": "swing",
                "ticker": r.ticker,
                "verdict": r.verdict,
                "bias": r.bias,
                "reasons": r.reasons,
                "metrics": r.metrics,
                "swing_bias": r.swing_bias,
                "entry_quality": r.entry_quality,
                "risk_level": r.risk_level,
                "final_action": r.final_action,
                "trade_quality_score": r.trade_quality_score,
                "decision_message": r.decision_message,
                "confirmation_needed": r.confirmation_needed,
                "avoid_reason": r.avoid_reason,
            }
        )
        return SwingTradeResponse(
            ticker=r.ticker,
            company_name=r.company_name,
            verdict=r.verdict,
            bias=r.bias,
            bull_score=r.bull_score,
            bear_score=r.bear_score,
            reasons=r.reasons,
            metrics=r.metrics,
            swing_bias=r.swing_bias,
            entry_quality=r.entry_quality,
            risk_level=r.risk_level,
            final_action=r.final_action,
            trade_quality_score=r.trade_quality_score,
            decision_label=r.decision_label,
            decision_message=r.decision_message,
            risk_flags=r.risk_flags,
            confirmation_needed=r.confirmation_needed,
            suggested_expiry_window=r.suggested_expiry_window,
            suggested_strategy=r.suggested_strategy,
            avoid_reason=r.avoid_reason,
            playbook_hint=r.playbook_hint,
            market_bias=resolved.market_bias,
            setup_quality=resolved.setup_quality,
            confidence=resolved.confidence,
            reason=resolved.reason,
            supporting_factors=resolved.supporting_factors,
            missing_confirmations=resolved.missing_confirmations,
            risk_state=resolved.risk_state,
            expected_holding_period=str(getattr(r, "expected_holding_period", "") or ""),
            recommended_contract_duration=str(getattr(r, "recommended_contract_duration", "") or ""),
            explanation=dict(resolved.explanation or {}),
            professional_decision=dict(getattr(r, "professional_decision", {}) or {}),
            risk_reason=resolved.risk_reason or "",
            display_confidence=int(resolved.display_confidence or 0),
            execution_fields=list(resolved.execution_fields or []),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e)) from None


def _format_market_cap(value: Any) -> str:
    try:
        n = float(value)
    except Exception:
        return "Unknown"
    if n >= 1_000_000_000_000:
        return f"${n / 1_000_000_000_000:.1f}T"
    if n >= 1_000_000_000:
        return f"${n / 1_000_000_000:.1f}B"
    if n >= 1_000_000:
        return f"${n / 1_000_000:.1f}M"
    return f"${n:,.0f}"


def _investment_theme(name: str, sector: str, industry: str) -> str:
    hay = f"{name} {sector} {industry}".lower()
    if any(k in hay for k in ("semiconductor", "chip", "ai", "accelerator")):
        return "AI / Semiconductors"
    if any(k in hay for k in ("software", "cloud", "internet", "platform")):
        return "Cloud / Software"
    if any(k in hay for k in ("cyber", "security")):
        return "Cybersecurity"
    if any(k in hay for k in ("health", "biotech", "pharma", "medical")):
        return "Healthcare"
    if any(k in hay for k in ("energy", "oil", "gas", "solar")):
        return "Energy"
    if any(k in hay for k in ("financial", "bank", "insurance", "asset")):
        return "Financials"
    return sector or "Long-term compounder"


@app.get("/api/investment-thesis/starter/{ticker}")
def investment_thesis_starter(
    ticker: str,
    auth_email: str = Depends(require_access_email),
):
    """
    Backend-generated starter research packet for Investment Thesis.
    This is not a trading recommendation; it creates a long-term research
    starting point from existing market/profile data and backend swing metrics.
    """
    t = ticker.strip().upper()
    if not t or len(t) > 12:
        raise HTTPException(status_code=400, detail="Enter a valid ticker.")

    try:
        scan = run_swing_trade_scan(t)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Unable to load market data for {t}: {exc}") from None

    try:
        info = _bc_info(t) or {}
    except Exception:
        info = {}

    metrics = scan.metrics or {}
    price = float(metrics.get("last_price") or 0)
    if price <= 0:
        raise HTTPException(status_code=502, detail=f"No current price available for {t}.")

    company_name = str(info.get("longName") or info.get("shortName") or scan.company_name or t)
    sector = str(info.get("sector") or "Unknown")
    industry = str(info.get("industry") or "")
    theme = _investment_theme(company_name, sector, industry)
    daily_change_pct = float(info.get("regularMarketChangePercent") or 0)
    dividend_yield = float(info.get("dividendYield") or 0)
    if dividend_yield and dividend_yield < 1:
        dividend_yield *= 100

    ma20 = float(metrics.get("ma20") or price)
    ma50 = float(metrics.get("ma50") or price)
    rsi = float(metrics.get("rsi") or 50)
    macd = float(metrics.get("macd") or 0)
    macd_signal = float(metrics.get("macd_signal") or 0)
    valuation_score = 5 if abs(float(metrics.get("dist_ma20_pct") or 0)) > 8 else 6
    growth_score = 8 if theme in {"AI / Semiconductors", "Cloud / Software", "Cybersecurity"} else 7
    ai_score = 9 if "AI" in theme else 6
    conviction = int(round((8 + 7 + 7 + growth_score + ai_score + valuation_score + 7 + 7) / 8 * 10))
    target_price = round(price * (1.18 if valuation_score <= 5 else 1.25), 2)
    excellent = round(min(price * 0.82, ma20 * 0.92), 2)
    very_good_low = excellent
    very_good_high = round(min(price * 0.92, ma20 * 0.98), 2)
    fair_low = round(min(price * 0.93, ma20 * 0.99), 2)
    fair_high = round(price * 1.06, 2)

    swing_signal = "Bullish" if scan.bias == "long" else "Bearish" if scan.bias == "short" else "Neutral"
    macd_note = (
        "MACD is above Signal; momentum is constructive."
        if macd > macd_signal else
        "MACD remains below Signal; wait for momentum repair before adding aggressively."
    )
    rsi_note = (
        "RSI is extended; avoid chasing new long-term allocation immediately."
        if rsi >= 70 else
        "RSI is weak; use staged entries only after business evidence and price stabilization."
        if rsi <= 40 else
        "RSI is neutral; entry discipline matters more than momentum."
    )
    how_to_invest = (
        "Start with a small research allocation only inside the defined buy zone, then add after quarterly evidence confirms revenue, margins, and guidance. "
        "Avoid building a full position at once; use staged accumulation and cap exposure at the target allocation."
    )

    thesis_markdown = f"""# {company_name} ({t}) investment thesis

## Business context
{company_name} is being evaluated as a long-term idea in the {theme} theme. The current price is ${price:.2f}; MA20 is ${ma20:.2f} and MA50 is ${ma50:.2f}.

## How to invest
{how_to_invest}

## Current technical context
- Swing signal context: {swing_signal}
- RSI: {rsi:.1f}. {rsi_note}
- MACD: {macd:.2f}, Signal: {macd_signal:.2f}. {macd_note}

## What to verify before adding size
- Revenue growth and margin trend
- Competitive position and moat durability
- Valuation versus expected growth
- Balance sheet strength
- Management execution over the next quarterly review

## What would change my mind
- Growth decelerates without margin improvement
- Competitive pressure weakens pricing power
- Valuation requires unrealistic execution
- Management misses guidance repeatedly
"""

    return {
        "ticker": t,
        "company_name": company_name,
        "current_price": round(price, 2),
        "daily_change_pct": round(daily_change_pct, 2),
        "sector": sector,
        "industry": industry,
        "market_cap": _format_market_cap(info.get("marketCap")),
        "next_earnings": str(metrics.get("earnings_calendar_days_until") or ""),
        "theme": theme,
        "ai_exposure": "AI" in theme,
        "dividend": dividend_yield > 0,
        "dividend_yield_pct": round(dividend_yield, 2),
        "rating": 4 if conviction >= 70 else 3,
        "conviction_score": conviction,
        "target_price": target_price,
        "buy_zone": f"${very_good_low:.2f} - ${very_good_high:.2f}",
        "thesis_markdown": thesis_markdown,
        "summary": (
            f"{company_name} is a {theme} research candidate. Starter conviction is {conviction}/100. "
            f"The preferred approach is staged accumulation near ${very_good_low:.2f}-${very_good_high:.2f}, "
            f"not an immediate full-size purchase."
        ),
        "quality": {
            "businessQuality": 8,
            "management": 7,
            "moat": 7,
            "growth": growth_score,
            "aiOpportunity": ai_score,
            "valuation": valuation_score,
            "financialHealth": 7,
            "execution": 7,
        },
        "buy_zones": [
            {"label": "Excellent", "price": f"Below ${excellent:.2f}", "reason": "Best margin of safety versus current trend and target estimate.", "allocation": "Add 30% of planned position"},
            {"label": "Very Good", "price": f"${very_good_low:.2f} - ${very_good_high:.2f}", "reason": "Preferred starter or add zone for staged accumulation.", "allocation": "Add 20%"},
            {"label": "Good", "price": f"${fair_low:.2f} - ${fair_high:.2f}", "reason": "Acceptable only if quarterly evidence is improving.", "allocation": "Small add"},
            {"label": "Expensive", "price": f"Above ${round(price * 1.12, 2):.2f}", "reason": "Do not chase. Wait for pullback or stronger evidence.", "allocation": "No add"},
        ],
        "accumulation_steps": [
            f"Start with 25% of intended size inside ${very_good_low:.2f}-${very_good_high:.2f}.",
            f"Add another 25% below ${excellent:.2f} if thesis evidence remains intact.",
            "Increase only after the next quarterly review confirms growth, margins, and guidance.",
            "Never exceed the max allocation without updating the thesis first.",
        ],
        "catalysts": [
            {"title": "Next earnings review", "description": "Check revenue growth, margins, guidance, AI/product progress, and management execution.", "impact": "Neutral"},
            {"title": "Valuation reset / pullback", "description": "Watch whether price enters the preferred buy zone with thesis intact.", "impact": "Positive"},
        ],
        "risks": [
            {"title": "Valuation risk", "severity": "Medium", "probability": "Medium", "notes": "Long-term returns depend heavily on entry price discipline."},
            {"title": "Execution risk", "severity": "Medium", "probability": "Medium", "notes": "Track whether management delivers against growth and margin expectations."},
            {"title": "Momentum/technical risk", "severity": "Medium", "probability": "Medium", "notes": f"{rsi_note} {macd_note}"},
        ],
        "trading_signals": {"dayTrade": "Neutral", "swingTrade": swing_signal},
        "how_to_invest": how_to_invest,
    }


def _require_admin_intraday_surfaces(auth_email: str) -> None:
    if get_user_state(normalize_email(auth_email)).get("role") != "admin":
        raise HTTPException(
            status_code=403,
            detail="Day Trading features require administrator access.",
        )


def _market_context_from_day_trade_metrics(m: dict) -> dict:
    return {
        "spy_change_pct": m.get("spy_change_pct"),
        "qqq_change_pct": m.get("qqq_change_pct"),
        "spy_session_change_pct": m.get("spy_session_change_pct"),
        "qqq_session_change_pct": m.get("qqq_session_change_pct"),
        "vix": m.get("vix"),
    }


def _active_trade_out_from_row(
    row: dict,
    decision: dict,
    metrics: dict,
    intraday_error: str | None,
) -> ActiveTradeOut:
    ex = row.get("expiry") if row.get("expiry") else row.get("option_expiry")
    return ActiveTradeOut(
        id=row["id"],
        ticker=row["ticker"],
        side=row["side"],
        entry_price=float(row["entry_price"]),
        entry_underlying_px=row.get("entry_underlying_px"),
        contracts=row.get("contracts"),
        strike=row.get("strike"),
        expiry=str(ex).strip()[:10] if ex else None,
        notes=str(row.get("notes") or ""),
        opened_at_ms=int(row["opened_at_ms"]),
        exited_at_ms=row.get("exited_at_ms"),
        trade_type=str(row.get("trade_type") or "day"),
        decision=decision,
        metrics=metrics,
        intraday_error=intraday_error,
    )


@app.post("/api/trades/enter", response_model=ActiveTradeEnterResponse)
def active_trade_enter(
    req: ActiveTradeEnterRequest,
    auth_email: str = Depends(require_access_email),
):
    """Record an option day-trade position for intraday monitoring (copy-only guidance)."""
    _require_admin_intraday_surfaces(auth_email)
    email = normalize_email(auth_email)
    try:
        row = insert_active_trade(
            email,
            ticker=req.ticker,
            side=req.side,
            entry_price=req.entry_price,
            entry_underlying_px=req.entry_underlying_px,
            contracts=req.contracts,
            strike=req.strike,
            option_expiry=req.expiry,
            notes=req.notes,
            trade_type=req.trade_type,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None
    ex_out = row.get("expiry") if row.get("expiry") else row.get("option_expiry")
    return ActiveTradeEnterResponse(
        id=row["id"],
        ticker=row["ticker"],
        side=row["side"],
        entry_price=row["entry_price"],
        entry_underlying_px=row.get("entry_underlying_px"),
        contracts=row.get("contracts"),
        strike=row.get("strike"),
        expiry=str(ex_out).strip()[:10] if ex_out else None,
        notes=str(row.get("notes") or ""),
        opened_at_ms=int(row["opened_at_ms"]),
    )


@app.get("/api/exit-signals")
def exit_signals(auth_email: str = Depends(require_access_email)):
    """
    Live exit signals for the authenticated user's held positions
    (open active_trades opened today + day/swing portfolio positions). Client polls
    this to drive the exit modal; the background scanner uses the same engine for alerts.
    Acknowledged signals (via POST /api/exit-signals/acknowledge) are excluded.
    """
    _require_admin_intraday_surfaces(auth_email)
    email = normalize_email(auth_email)
    try:
        sigs = exit_monitor.scan_exit_signals_for_user(email)
    except Exception as e:  # noqa: BLE001
        log.warning("exit_signals scan error for %s: %s", email, e)
        sigs = []
    # Filter out acknowledged signals for today
    _today = datetime.now(ZoneInfo("America/New_York")).date().isoformat()
    sigs = [s for s in sigs if (email, s.ticker, s.code, _today) not in _ACKED_EXIT_SIGNALS]
    return {"signals": [s.to_dict() for s in sigs], "count": len(sigs)}


# In-memory acknowledged exit signals: (email, ticker, code, session_date).
# Persists for the process lifetime; cleared on restart (acceptable — fresh scan
# will re-fire if the condition still holds, which is the correct safety behavior).
_ACKED_EXIT_SIGNALS: set[tuple[str, str, str, str]] = set()


class ExitSignalAckBody(BaseModel):
    ticker: str
    code: str


@app.post("/api/exit-signals/acknowledge")
def acknowledge_exit_signal(body: ExitSignalAckBody, auth_email: str = Depends(require_access_email)):
    """Acknowledge an exit signal so it stops reappearing in the modal for today."""
    email = normalize_email(auth_email)
    _today = datetime.now(ZoneInfo("America/New_York")).date().isoformat()
    _ACKED_EXIT_SIGNALS.add((email, body.ticker.upper().strip(), body.code.strip(), _today))
    return {"ok": True}


@app.get("/api/trades/active", response_model=ActiveTradeListResponse)
def active_trades_list(
    auth_email: str = Depends(require_access_email),
):
    """
    Open active trades opened on the current US (America/New_York) calendar date, each with embedded
    latest decision. Prior-calendar-day opens are excluded (``included_opened_before_today`` is false).

    One Yahoo intraday fetch per unique ticker per request (server-side cache in-handler).
    """
    _require_admin_intraday_surfaces(auth_email)
    email = normalize_email(auth_email)
    rows = list_active_trades_open_opened_today_et(email)
    per_sym: dict[str, dict] = {}
    per_err: dict[str, str] = {}
    for sym in sorted({r["ticker"] for r in rows}):
        try:
            per_sym[sym] = underlying_intraday_snapshot_for_active_trade(sym)
        except (ValueError, RuntimeError) as e:
            per_err[sym] = str(e)
        except Exception as e:  # noqa: BLE001 — surface upstream Yahoo failures
            per_err[sym] = str(e) or type(e).__name__
    out: list[ActiveTradeOut] = []
    for row in rows:
        sym = row["ticker"]
        if sym in per_sym:
            snap = per_sym[sym]
            met = snap["metrics"]
            dec = build_active_trade_decision(
                row,
                _market_context_from_day_trade_metrics(met),
                snap["intraday_flat"],
            )
            out.append(_active_trade_out_from_row(row, dec, met, None))
            continue
        stub_intraday = {
            "underlying_last": None,
            "last_price": None,
            "vwap": None,
            "or_high": None,
            "or_low": None,
        }
        dec = build_active_trade_decision(row, {}, stub_intraday)
        out.append(_active_trade_out_from_row(row, dec, {}, per_err.get(sym)))
    return ActiveTradeListResponse(trades=out, included_opened_before_today=False)


@app.get("/api/trades/{trade_id}/decision", response_model=ActiveTradeOut)
def active_trade_decision_one(
    trade_id: str,
    auth_email: str = Depends(require_access_email),
):
    _require_admin_intraday_surfaces(auth_email)
    email = normalize_email(auth_email)
    row = get_active_trade(email, trade_id)
    if not row or row.get("exited_at_ms") is not None:
        raise HTTPException(status_code=404, detail="Active trade not found")
    sym = row["ticker"]
    try:
        snap = underlying_intraday_snapshot_for_active_trade(sym)
        met = snap["metrics"]
        dec = build_active_trade_decision(
            row,
            _market_context_from_day_trade_metrics(met),
            snap["intraday_flat"],
        )
        return _active_trade_out_from_row(row, dec, met, None)
    except (ValueError, RuntimeError) as e:
        stub_intraday = {
            "underlying_last": None,
            "last_price": None,
            "vwap": None,
            "or_high": None,
            "or_low": None,
        }
        dec = build_active_trade_decision(row, {}, stub_intraday)
        return _active_trade_out_from_row(row, dec, {}, str(e))
    except Exception as e:  # noqa: BLE001
        stub_intraday = {
            "underlying_last": None,
            "last_price": None,
            "vwap": None,
            "or_high": None,
            "or_low": None,
        }
        dec = build_active_trade_decision(row, {}, stub_intraday)
        return _active_trade_out_from_row(row, dec, {}, str(e) or type(e).__name__)


@app.post("/api/trades/{trade_id}/exit")
def active_trade_exit_api(
    trade_id: str,
    auth_email: str = Depends(require_access_email),
):
    _require_admin_intraday_surfaces(auth_email)
    email = normalize_email(auth_email)
    # Get the ticker before exiting so we can clean up alerts
    row = get_active_trade(email, trade_id)
    ok = exit_active_trade(email, trade_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Active trade not found or already exited")
    # Auto-resolve EXIT_SIGNAL alerts for this ticker
    if row:
        try:
            from storage import alert_center_resolve_by_ticker
            alert_center_resolve_by_ticker(email, str(row.get("ticker") or ""))
        except Exception:  # noqa: BLE001
            pass
    return {"ok": True}


def _backend_verdict_is_go(rec: RecommendationOut, sig: SignalsOut) -> bool:
    hard_fails = 0
    soft_fails = 0
    warnings = 0
    has_thin_edge = False

    def add(status: str, hard: bool = False) -> None:
        nonlocal hard_fails, soft_fails, warnings
        if status == "warn":
            warnings += 1
        elif status == "fail" and hard:
            hard_fails += 1
        elif status == "fail":
            soft_fails += 1

    is_credit = rec.net_credit > 0
    is_income_sell = rec.strategy in {"Covered Call", "Covered Put", "Short Put", "Short Call"}
    bias = rec.bias.upper()
    is_bullish = "BULLISH" in bias
    is_bearish = "BEARISH" in bias
    is_neutral = not is_bullish and not is_bearish

    # IV regime.
    if is_credit:
        add("pass" if sig.iv_rank >= 45 else "warn" if sig.iv_rank >= 20 else "fail")
    else:
        add("pass" if sig.iv_rank <= 40 else "warn" if sig.iv_rank <= 60 else "fail")

    # Bias/range conviction.
    conf = sig.bias_confidence * 100
    if is_neutral and is_credit:
        slope_flat = abs(sig.ma50_slope) < 0.002
        rsi_mid = 38 <= sig.rsi <= 62
        add("pass" if slope_flat and rsi_mid else "warn" if slope_flat or rsi_mid else "fail")
    elif is_credit:
        add("pass" if conf >= 40 else "warn" if conf >= 25 else "fail")
    else:
        add("pass" if conf >= 55 else "warn" if conf >= 35 else "fail")

    # Trend alignment.
    if is_bullish:
        if is_credit:
            add("pass" if sig.above_ma50 else "warn" if sig.ma50_slope > 0 else "fail")
        else:
            add("pass" if sig.above_ma50 and sig.ma50_slope > 0 else "warn" if sig.above_ma50 or sig.ma50_slope > 0 else "fail")
    elif is_bearish:
        if is_credit:
            add("pass" if not sig.above_ma50 else "warn" if sig.ma50_slope < 0 else "fail")
        else:
            add("pass" if not sig.above_ma50 and sig.ma50_slope < 0 else "warn" if not sig.above_ma50 or sig.ma50_slope < 0 else "fail")
    else:
        add("pass" if abs(sig.ma50_slope) < 0.002 else "warn")

    # RSI.
    if is_credit:
        if is_bullish:
            add("fail" if sig.rsi < 28 else "warn" if sig.rsi < 38 else "pass")
        elif is_bearish:
            add("fail" if sig.rsi > 72 else "warn" if sig.rsi > 62 else "pass")
        else:
            add("warn" if sig.rsi > 70 or sig.rsi < 30 else "pass")
    else:
        if is_bullish and sig.rsi > 75:
            add("fail")
        elif is_bullish and sig.rsi > 68:
            add("warn")
        elif is_bearish and sig.rsi < 25:
            add("fail")
        elif is_bearish and sig.rsi < 32:
            add("warn")
        elif is_neutral and (sig.rsi > 68 or sig.rsi < 32):
            add("warn")
        else:
            add("pass")

    # MACD.
    hist = sig.macd_histogram
    if is_credit:
        if is_bullish:
            add("warn" if hist < -0.5 and sig.macd < sig.macd_signal_line else "pass")
        elif is_bearish:
            add("warn" if hist > 0.5 and sig.macd > sig.macd_signal_line else "pass")
        else:
            add("warn" if abs(hist) > 0.5 else "pass")
    else:
        if is_bullish:
            add("pass" if hist > 0 and sig.macd > sig.macd_signal_line else "warn" if hist > 0 or sig.macd > sig.macd_signal_line else "fail")
        elif is_bearish:
            add("pass" if hist < 0 and sig.macd < sig.macd_signal_line else "warn" if hist < 0 or sig.macd < sig.macd_signal_line else "fail")
        else:
            add("pass" if abs(hist) < 0.5 else "warn")

    # DTE.
    if is_credit:
        add("pass" if 21 <= rec.dte <= 50 else "warn" if 14 <= rec.dte < 21 or 50 < rec.dte <= 65 else "fail", hard=rec.dte < 14)
    else:
        add("pass" if 21 <= rec.dte <= 70 else "warn" if rec.dte >= 14 else "fail", hard=rec.dte < 14)

    # Liquidity and structure.
    add("pass" if rec.passes_liquidity_filter else "fail", hard=not rec.passes_liquidity_filter)
    if is_income_sell:
        add("pass" if rec.passes_credit_filter else "fail")
        yield_pct = rec.credit_pct_of_width
        add("pass" if yield_pct >= 1.0 else "warn" if yield_pct >= 0.60 else "fail")
    elif is_credit:
        add("pass" if rec.passes_rr_filter and rec.passes_credit_filter else "warn" if rec.passes_rr_filter or rec.passes_credit_filter else "fail")
    else:
        add("pass" if rec.passes_rr_filter else "warn")

    # Expected value / probability.
    if not is_income_sell:
        edge_ratio = getattr(rec, "edge_ratio", 0.0) or 0.0
        if rec.expected_value <= 0:
            add("fail", hard=True)
        elif edge_ratio < 0.05:
            has_thin_edge = True
            add("warn")
        else:
            add("pass" if rec.expected_value > 0.04 else "warn")

    if is_credit:
        pass_threshold = 0.65 if is_income_sell else 0.62
        warn_threshold = 0.55 if is_income_sell else 0.52
        add("pass" if rec.prob_of_profit >= pass_threshold else "warn" if rec.prob_of_profit >= warn_threshold else "fail")
    else:
        add("pass" if rec.prob_of_profit >= 0.45 else "warn" if rec.prob_of_profit >= 0.35 else "fail")

    return hard_fails == 0 and soft_fails == 0 and not has_thin_edge and warnings < 5


def _alert_item_from_dict(alert: dict) -> AlertItem:
    return AlertItem(
        ticker=alert["ticker"],
        company_name=alert["companyName"],
        strategy=alert["strategy"],
        bias=alert["bias"],
        expiry=alert["expiry"],
        dte=alert["dte"],
        weeks_out=alert["weeksOut"],
        score=alert["score"],
        max_profit=alert["maxProfit"],
        max_loss=alert["maxLoss"],
        net_credit=alert["netCredit"],
        pop=alert["pop"],
        ev=alert["ev"],
        time_window=alert["timeWindow"],
    )


def _scan_user_watchlist_for_alerts(user_state: dict) -> None:
    email = user_state.get("email", "").strip().lower()
    if not email:
        return

    user_name = email.split("@")[0] or email
    tickers = []
    for item in user_state.get("watchlist", []):
        ticker = str(item.get("ticker", "")).strip().upper()
        if ticker and ticker not in tickers:
            tickers.append(ticker)

    new_alert_items: list[AlertItem] = []
    new_alert_ids: list[str] = []

    for ticker in tickers:
        try:
            # Alert scans only run for tickers saved in the user's watchlist.
            # Reuse fresh backend analysis data; if absent/stale, this refreshes
            # Yahoo/options data once and stores the result for the scan window.
            data = _get_analysis_with_cache(
                ticker,
                weeks_out=ALERT_SCAN_WEEKS_OUT,
                spread_width=ALERT_SCAN_SPREAD_WIDTH,
                strategy_mode="all",
            )
        except Exception as exc:
            print(f"[alert-scan] {email} {ticker} failed: {exc}", flush=True)
            continue

        now_ms = int(time.time() * 1000)
        time_window = _get_15_min_window(now_ms)
        for rec in data.recommendations:
            if not _backend_verdict_is_go(rec, data.signals):
                continue

            alert_id = f"{ticker}-{rec.strategy}-{rec.expiry}"
            alert = {
                "id": alert_id,
                "ticker": ticker,
                "companyName": data.company_name,
                "strategy": rec.strategy,
                "bias": rec.bias,
                "expiry": rec.expiry,
                "dte": rec.dte,
                "weeksOut": ALERT_SCAN_WEEKS_OUT,
                "score": rec.scores.total_score,
                "maxProfit": rec.max_profit,
                "maxLoss": rec.max_loss,
                "netCredit": rec.net_credit,
                "pop": rec.prob_of_profit,
                "ev": rec.expected_value,
                "detectedAt": now_ms,
                "timeWindow": time_window,
                "emailSent": False,
                "dismissed": False,
            }

            inserted = add_user_alert(email, alert, email_sent=False)
            if not inserted:
                continue

            new_alert_ids.append(alert_id)
            new_alert_items.append(_alert_item_from_dict(alert))

            alert_center_create(
                email,
                alert_group="regular_trade",
                severity="INFO",
                engine="REGULAR",
                signal="GO",
                title=f"{ticker} {rec.strategy} alert is active.",
                body=f"Score {rec.scores.total_score} \u00b7 {rec.bias} \u00b7 Expiry {rec.expiry} \u00b7 PoP {rec.prob_of_profit * 100:.0f}%" if rec.prob_of_profit else f"Score {rec.scores.total_score} \u00b7 {rec.bias} \u00b7 Expiry {rec.expiry}",
                meta={
                    "ticker": ticker,
                    "alert_type": "REGULAR_TRADE",
                    "engine_type": "REGULAR",
                    "recommended_action": f"Open Strategy Finder to review the {rec.strategy} setup.",
                    "reason": rec.rationale or "Regular trade alert from scanner.",
                },
                alert_id=alert_id,
            )

    if not new_alert_items:
        return

    wants_email = _user_wants_trade_alert_emails(user_state)
    alerts_by_window: dict[str, list[AlertItem]] = defaultdict(list)
    alert_ids_by_window: dict[str, list[str]] = defaultdict(list)
    for alert_id, alert_item in zip(new_alert_ids, new_alert_items):
        alerts_by_window[alert_item.time_window].append(alert_item)
        alert_ids_by_window[alert_item.time_window].append(alert_id)

    for time_window, alert_items in alerts_by_window.items():
        if wants_email:
            result = _send_alert_email(email, alert_items, user_name)
        else:
            result = {"sent": False, "message": USER_ALERT_EMAIL_DISABLED_MESSAGE}
        message = str(result.get("message", ""))
        sent = bool(result.get("sent"))
        for alert_id in alert_ids_by_window[time_window]:
            update_user_alert_email(email, alert_id, sent, message)


def _day_trade_active_state(eg_state: str) -> int:
    s = str(eg_state or "").upper().strip()
    if s == "EOD_CLOSING":
        return 4
    if s in {"ENTRY_ACTIVE", "ENTRY_RETEST", "ENTRY_PULLBACK"}:
        return 3
    if s in {"WAIT_FOR_VOLUME", "VWAP_TEST", "WAIT_BOUNCE_LEVEL"}:
        return 2
    return 1


def _swing_active_state(final_action: str) -> int:
    fa = str(final_action or "").upper().strip()
    if fa == "EXIT":
        return 4
    if fa in {"READY", "STRONG_GO", "GO", "GO_SMALL", "TRADE"}:
        return 3
    if fa in {"WAIT", "WAIT_PULLBACK", "WAIT_BREAKOUT", "WAIT_FOR_BREAKDOWN", "AVOID_CHASE"}:
        return 2
    return 1


# Weak-breakout detection: fire if IN-PLAY for this long without extending past ORH/ORL
_WEAK_BREAKOUT_WAIT_MS    = 1_800_000  # 30 min = 2 scan cycles
_WEAK_BREAKOUT_EXTEND_PCT = 0.003      # price must move ≥0.3% past ORH (long) or ORL (short)

# Narrow OR filter: warn on ENTRY→IN-PLAY when opening range is compressed
# OR width % = (ORH - ORL) / ORL × 100
# TSLA today: $4/$400 = 1.0% → flagged   MU: $40/$660 = 6.1% → clean
_NARROW_OR_ALERT_PCT      = 1.5        # below this → low follow-through risk, caution on entry

_STATE_LABEL = {1: "SETUP", 2: "ENTRY", 3: "IN-PLAY", 4: "EXIT"}
_STATE_DIRECTION = {
    (1, 2): "advancing",
    (2, 3): "ENTRY CONFIRMED",
    (3, 4): "EXIT triggered",
    (3, 2): "breakout failed",
    (2, 1): "setup invalidated",
    (4, 1): "reset to setup",
    (4, 2): "reset to entry",
    (1, 3): "jumped to IN-PLAY",
    (1, 4): "immediate exit",
}


def _build_price_snapshot_summary(
    ticker: str,
    verdict: str,
    bias: str,
    *,
    price: object,
    vwap: object,
    orh: object,
    orl: object,
    stop: object,
    target: object,
    alert_type: str,
) -> str:
    """
    Build a rich one-line summary with price snapshot at detection time.
    This is the text that appears in the alert inbox and email — it must be
    actionable when read 5-10 minutes after firing.
    """
    def _p(v: object) -> str:
        try:
            return f"${float(v):.2f}" if v is not None else ""  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return ""

    px  = _p(price)
    vw  = _p(vwap)
    orh_ = _p(orh)
    st  = _p(stop)
    tg  = _p(target)

    direction = "LONG" if bias == "long" else "SHORT" if bias == "short" else ""
    verdict_label = verdict.replace("_", " ")

    parts: list[str] = []
    if px:
        parts.append(f"Price {px}")
    if vw:
        parts.append(f"VWAP {vw}")
    if orh_:
        parts.append(f"ORH {orh_}")
    if st:
        parts.append(f"Stop {st}")
    if tg:
        parts.append(f"Target {tg}")

    levels = " · ".join(parts)

    if alert_type == "ENTER_NOW":
        return (
            f"{ticker} {verdict_label} — Entry window OPEN · {direction}"
            + (f" · {levels}" if levels else "")
            + " · Act within 1-2 candles or wait for next setup."
        )
    else:
        return (
            f"{ticker} {verdict_label} — Setup confirmed · {direction}"
            + (f" · {levels}" if levels else "")
            + " · Check extension before entering."
        )


_ACTIONABLE_DAY_ALERT_TYPES = {"ENTER_NOW", "TARGET_REACHED", "EXIT_SIGNAL"}
_ACTIONABLE_DAY_ALERT_PHRASES = {
    "ENTER_NOW": "ENTRY CONDITIONS MET",
    "TARGET_REACHED": "Target hit",
    "EXIT_SIGNAL": "EXIT IMMEDIATELY",
}


def _day_alert_phrase(alert_type: object) -> str:
    return _ACTIONABLE_DAY_ALERT_PHRASES.get(str(alert_type or "").upper().strip(), "")


def _is_actionable_day_alert(item: dict[str, Any]) -> bool:
    """Only three day-trade events are allowed to notify/surface as alerts."""
    alert_type = str(item.get("alertType") or item.get("alert_type") or "").upper().strip()
    if alert_type in _ACTIONABLE_DAY_ALERT_TYPES:
        return True
    combined = " ".join(str(item.get(k) or "") for k in ("title", "summary", "decisionMsg", "body", "recommended_action"))
    return any(phrase in combined for phrase in _ACTIONABLE_DAY_ALERT_PHRASES.values())


# In-memory de-dup for exit-signal alerts: (email, ticker, code, session_date).
# Reset on restart — re-alerting a critical exit after a restart is acceptable.
_EXIT_ALERTED: set[tuple[str, str, str, str]] = set()


def _scan_exit_signals_for_state(user_state: dict) -> None:
    """Run the exit engine for a user's held day positions and raise app alerts
    for CRITICAL exits (VWAP break, stop hit, OR break, EOD). De-duped per
    (ticker, code) per session day. Client also polls /api/exit-signals."""
    email = normalize_email(user_state.get("email") or "")
    if not email:
        return
    sigs = exit_monitor.scan_exit_signals_for_user(email)
    if not sigs:
        return
    session_date = datetime.now(ZoneInfo("America/New_York")).date().isoformat()
    for s in sigs:
        if s.severity != "critical":
            continue
        key = (email, s.ticker, s.code, session_date)
        if key in _EXIT_ALERTED:
            continue
        if key in _ACKED_EXIT_SIGNALS:
            continue
        _EXIT_ALERTED.add(key)
        try:
            alert_center_create(
                email,
                alert_group="day-trade",
                severity="CRITICAL",
                engine="DAY",
                signal="EXIT_SIGNAL",
                title=f"EXIT IMMEDIATELY — {s.ticker}",
                body=s.recommended_action if "EXIT IMMEDIATELY" in str(s.recommended_action) else f"EXIT IMMEDIATELY — {s.recommended_action}",
                meta={
                    "ticker": s.ticker, "alertType": "EXIT_SIGNAL", "code": s.code,
                    "currentPrice": s.current_price, "pnlEstimate": s.pnl_estimate,
                    "severity": s.severity,
                },
            )
        except Exception as exc:  # noqa: BLE001
            print(f"[exit-scan] alert create failed for {email}/{s.ticker}: {exc}", flush=True)


def _scan_my_tickers_for_state_alerts(user_state: dict) -> None:
    email = user_state.get("email", "").strip().lower()
    if not email:
        return

    # my_tickers uses "symbol" key; support both for safety
    raw_tickers = user_state.get("my_tickers") or []
    if not raw_tickers:
        return

    user_name = email.split("@")[0] or email
    session_date_today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    day_escalations: list[dict] = []

    for ti, mt_item in enumerate(raw_tickers):
        if isinstance(mt_item, dict):
            ticker = str(mt_item.get("symbol") or mt_item.get("ticker") or "").strip().upper()
        else:
            ticker = str(mt_item).strip().upper()
        if not ticker:
            continue
        if ti:
            time.sleep(0.8)

        # ── Day Trade state scan ──────────────────────────────────────
        try:
            dr = run_day_trade_scan(ticker)
            eg = dr.entry_guidance if isinstance(dr.entry_guidance, dict) else {}
            eg_state = str(eg.get("state") or "")
            now_state = _day_trade_active_state(eg_state)

            # Correct action: entry_guidance.action is "GO"/"WATCH" etc;
            # trader_decision.suggested_action is the human-readable directive
            eg_action    = str(eg.get("action") or "").upper().strip()
            td_action    = str((dr.trader_decision or {}).get("suggested_action") or eg_action).upper().strip()
            now_action   = td_action or eg_action or eg_state

            sd = str((dr.metrics or {}).get("session_date") or session_date_today)[:10]
            m  = dr.metrics or {}
            bias_raw   = str(getattr(dr, "bias", "") or "").lower()
            bias_label = "BULLISH / LONG" if bias_raw == "long" else "BEARISH / SHORT" if bias_raw == "short" else bias_raw.upper()

            now_ms = int(time.time() * 1000)
            prev   = get_ticker_state_last(email, ticker, "DAY")

            ew        = dr.entry_window
            now_ew_status = (ew.status if ew else "WAIT")

            if prev is None:
                inplay_since = now_ms if now_state == 3 else 0
                upsert_ticker_state_last(
                    email, ticker, "DAY", now_state, now_action, sd,
                    target_hit=0, inplay_since_ms=inplay_since, weak_breakout_alerted=0,
                    entry_window_status=now_ew_status, entry_window_alerted=0,
                )
            else:
                prev_state  = int(prev.get("state_num") or 1)
                prev_sd     = (prev.get("session_date") or "")[:10]

                if prev_sd and sd and prev_sd != sd:
                    # New session — reset all flags without alerting
                    inplay_since = now_ms if now_state == 3 else 0
                    upsert_ticker_state_last(
                        email, ticker, "DAY", now_state, now_action, sd,
                        target_hit=0, inplay_since_ms=inplay_since, weak_breakout_alerted=0,
                        entry_window_status=now_ew_status, entry_window_alerted=0,
                    )
                else:
                    state_changed = prev_state != now_state

                    # Flags reset on any state transition; carry forward only while state holds
                    if state_changed or now_state != 3:
                        carry_target      = 0
                        carry_weak_bo     = 0
                        inplay_since      = now_ms if now_state == 3 else 0
                    else:
                        carry_target      = int(prev.get("target_hit") or 0)
                        carry_weak_bo     = int(prev.get("weak_breakout_alerted") or 0)
                        inplay_since      = int(prev.get("inplay_since_ms") or now_ms)
                    # enter_now_alerted resets whenever state changes (new setup = new alert allowed)
                    carry_enter_now   = 0 if state_changed else int(prev.get("enter_now_alerted") or 0)

                    prev_ew_status    = prev.get("entry_window_status") or "WAIT"
                    carry_ew_alerted  = 0 if state_changed else int(prev.get("entry_window_alerted") or 0)

                    # Pullback Reset fires at most once per session — carry across state changes
                    carry_pullback    = int(prev.get("pullback_reset_alerted") or 0)

                    last_price_val = eg.get("current_price") or m.get("last_price")
                    orh_val        = eg.get("opening_range_high") or m.get("or_high")
                    orl_val        = eg.get("opening_range_low")  or m.get("or_low")

                    # ── State-change alert (only 1→2: Setup→Entry, only when GO/STRONG GO) ──
                    # ── ENTER NOW alert (State 2 + volume confirmed) ─────
                    enter_now_to_store = carry_enter_now
                    verdict_str = str(dr.verdict or "").upper().strip()
                    enter_now_confirmed = now_state == 2 and verdict_str in ("GO", "STRONG_GO", "STRONG GO")
                    if enter_now_confirmed and not carry_enter_now:
                        enter_now_to_store = 1
                        direction_lbl = "LONG · CALL" if bias_raw == "long" else "SHORT · PUT"
                        _vwap_en  = eg.get("vwap") or m.get("vwap")
                        _stop_en  = eg.get("risk_below")
                        _tgt_en   = eg.get("scalp_target")
                        _en_summary = _build_price_snapshot_summary(
                            ticker, verdict_str, bias_raw,
                            price=last_price_val, vwap=_vwap_en,
                            orh=orh_val, orl=orl_val,
                            stop=_stop_en, target=_tgt_en,
                            alert_type="ENTER_NOW",
                        )
                        day_escalations.append({
                            "id":           f"dt-enternow-{ticker}-{now_ms}",
                            "alertType":    "ENTER_NOW",
                            "ticker":       ticker,
                            "companyName":  getattr(dr, "company_name", None) or ticker,
                            "engine":       "DAY",
                            "nowState":     now_state,
                            "nowLabel":     _STATE_LABEL.get(now_state, str(now_state)),
                            "direction":    direction_lbl,
                            "action":       now_action,
                            "egAction":     eg_action,
                            "bias":         bias_label,
                            "sessionDate":  sd,
                            "currentPrice": last_price_val,
                            "vwap":         _vwap_en,
                            "orh":          orh_val,
                            "orl":          orl_val,
                            "breakoutLevel": eg.get("breakout_level"),
                            "scalp_target": _tgt_en,
                            "riskBelow":    _stop_en,
                            "summary":      f"ENTRY CONDITIONS MET — {_en_summary}",
                            "decisionMsg":  f"ENTRY CONDITIONS MET — {eg.get('summary') or eg.get('action') or 'enter'}",
                            "narrowOrCaution": False,
                            "orWidthPct":   None,
                        })

                    # ── Take-profit alert ─────────────────────────────────
                    target_to_store  = carry_target
                    scalp_target_val = eg.get("scalp_target")
                    if now_state == 3 and not carry_target and scalp_target_val is not None and last_price_val is not None:
                        try:
                            lp = float(last_price_val)
                            st = float(scalp_target_val)
                            target_reached = (bias_raw == "long" and lp >= st) or (bias_raw == "short" and lp <= st)
                        except (TypeError, ValueError):
                            target_reached = False
                        if target_reached:
                            target_to_store = 1
                            direction_word  = "above" if bias_raw == "long" else "below"
                            day_escalations.append({
                                "id":           f"dt-target-{ticker}-{now_ms}",
                                "alertType":    "TARGET_REACHED",
                                "ticker":       ticker,
                                "companyName":  getattr(dr, "company_name", None) or ticker,
                                "engine":       "DAY",
                                "nowState":     now_state,
                                "nowLabel":     _STATE_LABEL.get(now_state, str(now_state)),
                                "bias":         bias_label,
                                "sessionDate":  sd,
                                "currentPrice": last_price_val,
                                "scalp_target": scalp_target_val,
                                "vwap":         eg.get("vwap") or m.get("vwap"),
                                "orh":          orh_val,
                                "orl":          orl_val,
                                "riskBelow":    eg.get("risk_below"),
                                "summary":      f"Price ${lp:.2f} reached scalp target ${st:.2f} — consider taking profit or trailing your stop.",
                                "decisionMsg":  f"Target hit {direction_word} ${st:.2f}. Exit now or move stop to breakeven to protect gains.",
                            })

                    # ── Weak-breakout alert ───────────────────────────────
                    # Fires once if IN-PLAY for ≥30 min without extending ≥0.3% past ORH (long) / ORL (short)
                    weak_bo_to_store = carry_weak_bo
                    if (now_state == 3 and not carry_weak_bo
                            and inplay_since > 0 and last_price_val is not None):
                        elapsed_ms = now_ms - inplay_since
                        if elapsed_ms >= _WEAK_BREAKOUT_WAIT_MS and orh_val is not None:
                            try:
                                lp   = float(last_price_val)
                                orh  = float(orh_val)
                                orl  = float(orl_val) if orl_val is not None else None
                                or_width_pct = round((orh - orl) / orl * 100, 2) if orl else None
                                if bias_raw == "long":
                                    extended = lp >= orh * (1 + _WEAK_BREAKOUT_EXTEND_PCT)
                                elif bias_raw == "short" and orl is not None:
                                    extended = lp <= orl * (1 - _WEAK_BREAKOUT_EXTEND_PCT)
                                else:
                                    extended = True
                            except (TypeError, ValueError):
                                extended = True
                            if not extended:
                                weak_bo_to_store = 1
                                narrow_or = or_width_pct is not None and or_width_pct < 0.5
                                narrow_note = f" Narrow OR ({or_width_pct:.2f}%) — low follow-through is common." if narrow_or else ""
                                stop_level  = f"${orh:.2f}" if bias_raw == "long" else (f"${orl:.2f}" if orl else "entry level")
                                day_escalations.append({
                                    "id":           f"dt-weakbo-{ticker}-{now_ms}",
                                    "alertType":    "WEAK_BREAKOUT",
                                    "ticker":       ticker,
                                    "companyName":  getattr(dr, "company_name", None) or ticker,
                                    "engine":       "DAY",
                                    "nowState":     now_state,
                                    "nowLabel":     _STATE_LABEL.get(now_state, str(now_state)),
                                    "bias":         bias_label,
                                    "sessionDate":  sd,
                                    "currentPrice": last_price_val,
                                    "orh":          orh_val,
                                    "orl":          orl_val,
                                    "vwap":         eg.get("vwap") or m.get("vwap"),
                                    "scalp_target": scalp_target_val,
                                    "riskBelow":    eg.get("risk_below"),
                                    "orWidthPct":   or_width_pct,
                                    "elapsedMin":   round(elapsed_ms / 60_000),
                                    "summary":      f"IN-PLAY for {round(elapsed_ms / 60_000)} min with no extension past {stop_level}.{narrow_note} Exit or set tight stop at {stop_level}.",
                                    "decisionMsg":  f"Price ${lp:.2f} has not cleared {stop_level} + 0.3% threshold. Momentum is stalling — protect capital now.",
                                })

                    # ── Entry window CLOSING alert ────────────────────────
                    ew_alerted_to_store = carry_ew_alerted
                    scan_verdict_ew = _norm_day_trade_verdict(dr.verdict)
                    ew_was_open   = prev_ew_status == "OPEN"
                    ew_now_narrow = now_ew_status in ("CLOSING", "CLOSED")
                    if (ew_was_open and ew_now_narrow and not carry_ew_alerted
                            and scan_verdict_ew in {"GO", "STRONG GO", "STRONG_GO"}):
                        ew_alerted_to_store = 1
                        _ew_reason = ew.reason if ew else "Entry window is closing."
                        _ew_price  = last_price_val
                        day_escalations.append({
                            "id":           f"dt-ewclose-{ticker}-{now_ms}",
                            "alertType":    "WINDOW_CLOSING",
                            "ticker":       ticker,
                            "companyName":  getattr(dr, "company_name", None) or ticker,
                            "engine":       "DAY",
                            "nowState":     now_state,
                            "nowLabel":     _STATE_LABEL.get(now_state, str(now_state)),
                            "bias":         bias_label,
                            "sessionDate":  sd,
                            "currentPrice": _ew_price,
                            "vwap":         eg.get("vwap") or m.get("vwap"),
                            "orh":          orh_val,
                            "orl":          orl_val,
                            "scalp_target": eg.get("scalp_target"),
                            "riskBelow":    eg.get("risk_below"),
                            "pullbackTarget": ew.pullback_target if ew else None,
                            "rrRatio":      ew.rr_ratio if ew else None,
                            "summary":      _ew_reason,
                            "decisionMsg":  f"Window moving to {now_ew_status}. {_ew_reason}",
                        })

                    # ── Pullback Reset — DOUBLE GREEN reclaim alert ───────
                    # Fires once per session when the engine detects a high-confidence
                    # double-green VWAP reclaim (VWAP_DEFENSE_CONTINUATION setup).
                    pullback_to_store = carry_pullback
                    pb = m.get("pullback_entry") if isinstance(m, dict) else None
                    if (isinstance(pb, dict) and pb.get("detected")
                            and str(pb.get("reclaim_pattern") or "").upper() == "DOUBLE_GREEN"
                            and not carry_pullback):
                        pullback_to_store = 1
                        _pb_price = pb.get("entry_price") or last_price_val
                        _pb_vwap  = pb.get("vwap") or eg.get("vwap") or m.get("vwap")
                        _pb_dir   = str(pb.get("direction") or "").upper()  # CALL / PUT
                        _pb_side  = "LONG · CALL" if _pb_dir == "CALL" else "SHORT · PUT" if _pb_dir == "PUT" else bias_label
                        _pb_reason = pb.get("reason") or "Double Green reclaim at VWAP — fresh continuation entry setting up."
                        day_escalations.append({
                            "id":           f"dt-pullback-{ticker}-{now_ms}",
                            "alertType":    "PULLBACK_RESET",
                            "ticker":       ticker,
                            "companyName":  getattr(dr, "company_name", None) or ticker,
                            "engine":       "DAY",
                            "nowState":     now_state,
                            "nowLabel":     _STATE_LABEL.get(now_state, str(now_state)),
                            "direction":    _pb_side,
                            "bias":         bias_label,
                            "sessionDate":  sd,
                            "currentPrice": _pb_price,
                            "vwap":         _pb_vwap,
                            "orh":          orh_val,
                            "orl":          orl_val,
                            "scalp_target": pb.get("target_1"),
                            "riskBelow":    pb.get("stop"),
                            "rrRatio":      pb.get("rr_t1"),
                            "summary":      f"E4 Pullback Reset — {_pb_reason}",
                            "decisionMsg":  f"E4 double-green VWAP reclaim ({_pb_side}). Confirm the setup on the chart before entering.",
                        })

                    upsert_ticker_state_last(
                        email, ticker, "DAY", now_state, now_action, sd,
                        target_hit=target_to_store,
                        inplay_since_ms=inplay_since,
                        weak_breakout_alerted=weak_bo_to_store,
                        enter_now_alerted=enter_now_to_store,
                        entry_window_status=now_ew_status,
                        entry_window_alerted=ew_alerted_to_store,
                        pullback_reset_alerted=pullback_to_store,
                    )
        except Exception as exc:
            print(f"[state-scan] DAY {email} {ticker} failed: {exc}", flush=True)

    day_escalations = [it for it in day_escalations if _is_actionable_day_alert(it)]

    if not day_escalations:
        return

    # Mirror only actionable escalations to the in-app alert center.
    public_base = _option_advisor_public_base()
    for it in day_escalations:
        try:
            _px = it.get("currentPrice")
            _px_str = f" @ ${float(_px):.2f}" if _px is not None else ""
            _phrase = _day_alert_phrase(it.get("alertType"))
            _title = f"⚡ {it.get('ticker', '')}{_px_str} — {_phrase or it.get('summary') or it.get('alertType', '')}"
            alert_center_create(
                email,
                alert_group="day-trade",
                severity="CRITICAL" if it.get("alertType") in ("ENTER_NOW", "EXIT_SIGNAL") else "WARNING",
                engine="DAY",
                signal=it.get("alertType", ""),
                title=_title,
                body=it.get("decisionMsg") or "",
                meta={"ticker": it.get("ticker"), "alertType": it.get("alertType"), "sessionDate": it.get("sessionDate"),
                      "currentPrice": it.get("currentPrice"), "vwap": it.get("vwap"), "orh": it.get("orh")},
            )
        except Exception:
            pass

    # Email/notify only for the three actionable phrases.
    email_items = [
        it for it in day_escalations
        if _is_actionable_day_alert(it)
    ]

    if not email_items or not _user_wants_trade_alert_emails(user_state):
        return

    try:
        tickers_str = ", ".join(sorted({it["ticker"] for it in email_items}))
        count = len(email_items)
        subject = f"⚡ OptionAdvisor: {count} day-trade GO signal{'s' if count != 1 else ''} — {tickers_str}"
        html_body = _build_state_transition_email_html(email, user_name, email_items, public_base=public_base)
        _deliver_html_email(email, user_name, subject, html_body)
        print(f"[state-scan] emailed {len(email_items)} GO alert(s) to {email}", flush=True)
    except Exception as exc:
        print(f"[state-scan] email failed for {email}: {exc}", flush=True)


def _fmt_price(v: object) -> str:
    try:
        return f"${float(v):.2f}" if v is not None else "—"  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return "—"


def _build_state_transition_email_html(
    email: str,
    user_name: str | None,
    items: list[dict],
    *,
    public_base: str,
) -> str:
    display_name = (user_name or "").strip() or email
    base = public_base.rstrip("/")
    signal_feed_url = f"{base}/signal-feed"
    day_trade_url   = f"{base}/day-trade"

    cards_html = ""
    for it in items:
        ticker      = html.escape(str(it.get("ticker", "")).upper())
        company     = html.escape(str(it.get("companyName") or ticker))
        bias        = html.escape(str(it.get("bias", "")))
        summary     = html.escape(str(it.get("summary", "")))
        dec_msg     = html.escape(str(it.get("decisionMsg", "")))
        session     = html.escape(str(it.get("sessionDate", "")))
        alert_type  = str(it.get("alertType") or "STATE_CHANGE")
        ticker_url  = html.escape(f"{day_trade_url}?ticker={it.get('ticker', '').upper()}")

        price = _fmt_price(it.get("currentPrice"))
        vwap  = _fmt_price(it.get("vwap"))
        orh   = _fmt_price(it.get("orh"))
        orl   = _fmt_price(it.get("orl"))
        tgt   = _fmt_price(it.get("scalp_target"))
        risk  = _fmt_price(it.get("riskBelow"))

        bias_color = "#166534" if "BULL" in bias.upper() or "LONG" in bias.upper() else \
                     "#991b1b" if "BEAR" in bias.upper() or "SHORT" in bias.upper() else "#64748b"

        summary_row = f'<p style="margin:8px 0 0;font-size:12px;color:#374151;">{summary}</p>' if summary else ""
        dec_row     = f'<p style="margin:6px 0 0;font-size:11px;color:#64748b;font-style:italic;">{dec_msg}</p>' if dec_msg else ""

        if alert_type == "TARGET_REACHED":
            # ── Take-profit card (gold) ───────────────────────────────
            level_pairs = [("Price", price), ("Target", tgt), ("VWAP", vwap), ("Risk Below", risk)]
            levels_html = ""
            for lbl, val in level_pairs:
                if val and val != "—":
                    highlight = "color:#92400e;font-weight:900;" if lbl == "Target" else "color:#1e293b;"
                    levels_html += f'<span style="margin-right:14px;white-space:nowrap;"><span style="color:#94a3b8;font-size:10px;">{html.escape(lbl)}</span> <span style="font-family:monospace;font-weight:700;font-size:12px;{highlight}">{val}</span></span>'

            cards_html += f"""
<div style="margin-bottom:16px;border-radius:10px;overflow:hidden;border:2px solid #f59e0b;">
  <div style="background:linear-gradient(90deg,#78350f,#92400e);padding:10px 14px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
    <div>
      <a href="{ticker_url}" style="color:#ffffff;font-family:monospace;font-size:16px;font-weight:800;text-decoration:none;">{ticker}</a>
      <span style="color:rgba(255,255,255,0.75);font-size:12px;margin-left:8px;">{company}</span>
    </div>
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
      <span style="background:rgba(255,255,255,0.15);color:#ffffff;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;">DAY TRADE</span>
      <span style="background:#fef9c3;color:#78350f;padding:3px 12px;border-radius:4px;font-size:11px;font-weight:900;">💰 TAKE PROFIT</span>
    </div>
  </div>
  <div style="background:#fffbeb;padding:12px 14px;">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
      <span style="font-size:12px;font-weight:700;color:{bias_color};">{bias}</span>
      <span style="color:#cbd5e1;">|</span>
      <span style="font-size:12px;font-weight:700;color:#92400e;">Target reached</span>
      <span style="color:#cbd5e1;">|</span>
      <span style="font-size:10px;color:#94a3b8;">{session}</span>
    </div>
    <div style="background:#fef3c7;border-radius:6px;padding:8px 10px;flex-wrap:wrap;border:1px solid #fde68a;">
      {levels_html}
    </div>
    {summary_row}
    {dec_row}
  </div>
</div>"""
        elif alert_type == "WEAK_BREAKOUT":
            # ── Weak-breakout warning card (orange) ───────────────────
            orh_fmt    = _fmt_price(it.get("orh"))
            orl_fmt    = _fmt_price(it.get("orl"))
            elapsed    = it.get("elapsedMin", 30)
            or_w       = it.get("orWidthPct")
            or_w_str   = f"{or_w:.2f}%" if or_w is not None else "—"
            narrow_badge = '<span style="background:#fef3c7;color:#92400e;padding:2px 6px;border-radius:3px;font-size:9px;font-weight:700;margin-left:6px;">NARROW OR</span>' if (or_w is not None and or_w < 0.5) else ""

            level_pairs = [("Price", price), ("ORH", orh_fmt), ("ORL", orl_fmt), ("VWAP", vwap), ("OR Width", or_w_str)]
            levels_html = ""
            for lbl, val in level_pairs:
                if val and val != "—":
                    highlight = "color:#c2410c;font-weight:900;" if lbl == "ORH" and bias.upper().find("BULL") >= 0 else \
                                "color:#c2410c;font-weight:900;" if lbl == "ORL" and bias.upper().find("BEAR") >= 0 else "color:#1e293b;"
                    levels_html += f'<span style="margin-right:14px;white-space:nowrap;"><span style="color:#94a3b8;font-size:10px;">{html.escape(lbl)}</span> <span style="font-family:monospace;font-weight:700;font-size:12px;{highlight}">{val}</span></span>'

            cards_html += f"""
<div style="margin-bottom:16px;border-radius:10px;overflow:hidden;border:2px solid #f97316;">
  <div style="background:linear-gradient(90deg,#7c2d12,#c2410c);padding:10px 14px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
    <div>
      <a href="{ticker_url}" style="color:#ffffff;font-family:monospace;font-size:16px;font-weight:800;text-decoration:none;">{ticker}</a>
      <span style="color:rgba(255,255,255,0.75);font-size:12px;margin-left:8px;">{company}</span>
    </div>
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
      <span style="background:rgba(255,255,255,0.15);color:#ffffff;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;">DAY TRADE</span>
      <span style="background:#ffedd5;color:#7c2d12;padding:3px 12px;border-radius:4px;font-size:11px;font-weight:900;">⚠ STALLING {elapsed}min</span>
      {narrow_badge}
    </div>
  </div>
  <div style="background:#fff7ed;padding:12px 14px;">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
      <span style="font-size:12px;font-weight:700;color:{bias_color};">{bias}</span>
      <span style="color:#cbd5e1;">|</span>
      <span style="font-size:12px;font-weight:700;color:#c2410c;">No follow-through</span>
      <span style="color:#cbd5e1;">|</span>
      <span style="font-size:10px;color:#94a3b8;">{session}</span>
    </div>
    <div style="background:#ffedd5;border-radius:6px;padding:8px 10px;flex-wrap:wrap;border:1px solid #fed7aa;">
      {levels_html}
    </div>
    {summary_row}
    {dec_row}
  </div>
</div>"""

        else:
            # ── State-change card (existing style) ────────────────────
            prev_label        = html.escape(str(it.get("prevLabel", "")))
            now_label         = html.escape(str(it.get("nowLabel", "")))
            direction         = html.escape(str(it.get("direction", "")))
            eg_action         = html.escape(str(it.get("egAction") or it.get("action", "")))
            dec_msg2          = html.escape(str(it.get("decisionMsg", "")))
            brk               = _fmt_price(it.get("breakoutLevel"))
            narrow_or_caution = bool(it.get("narrowOrCaution", False))
            or_width_pct      = it.get("orWidthPct")

            now_state = it.get("nowState", 1)
            is_inplay = now_state == 3
            is_exit   = now_state == 4
            is_entry  = now_state == 2

            hdr_bg   = "#166534" if is_inplay else "#991b1b" if is_exit else "#92400e" if is_entry else "#1e3a5f"
            badge_bg = "#dcfce7" if is_inplay else "#fee2e2" if is_exit else "#fef3c7" if is_entry else "#e0e7ff"
            badge_fg = "#166534" if is_inplay else "#991b1b" if is_exit else "#92400e" if is_entry else "#3730a3"

            level_pairs = [
                ("Price", price), ("VWAP", vwap), ("ORH", orh), ("ORL", orl),
                ("Breakout", brk), ("Target", tgt), ("Risk Below", risk),
            ]
            levels_html = ""
            for lbl, val in level_pairs:
                if val and val != "—":
                    levels_html += f'<span style="margin-right:14px;white-space:nowrap;"><span style="color:#94a3b8;font-size:10px;">{html.escape(lbl)}</span> <span style="font-family:monospace;font-weight:700;font-size:12px;color:#1e293b;">{val}</span></span>'

            dec_row2 = f'<p style="margin:6px 0 0;font-size:11px;color:#64748b;font-style:italic;">{dec_msg2}</p>' if dec_msg2 else ""

            # Gap 3 — narrow OR caution strip (only on IN-PLAY entry alerts)
            narrow_or_strip = ""
            if narrow_or_caution and is_inplay and or_width_pct is not None:
                narrow_or_strip = (
                    f'<div style="margin-top:10px;background:#fef3c7;border:1px solid #fde68a;'
                    f'border-radius:6px;padding:9px 12px;display:flex;align-items:flex-start;gap:8px;">'
                    f'<span style="font-size:15px;line-height:1;">⚠️</span>'
                    f'<div>'
                    f'<span style="font-size:11px;font-weight:800;color:#92400e;">'
                    f'NARROW OR ({or_width_pct:.2f}%) — Reduced conviction entry</span>'
                    f'<p style="margin:4px 0 0;font-size:11px;color:#78350f;line-height:1.4;">'
                    f'Opening range is compressed (&lt;{_NARROW_OR_ALERT_PCT}%). '
                    f'Low-energy breakouts often stall within 1–2 bars of ORH. '
                    f'<strong>Half-size or skip.</strong> '
                    f'Require price to hold &gt;0.5% past ORH for 2+ bars before adding size.</p>'
                    f'</div></div>'
                )

            cards_html += f"""
<div style="margin-bottom:16px;border-radius:10px;overflow:hidden;border:{'2px solid #f59e0b' if narrow_or_caution and is_inplay else '1px solid #e2e8f0'};">
  <div style="background:{hdr_bg};padding:10px 14px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
    <div>
      <a href="{ticker_url}" style="color:#ffffff;font-family:monospace;font-size:16px;font-weight:800;text-decoration:none;">{ticker}</a>
      <span style="color:rgba(255,255,255,0.7);font-size:12px;margin-left:8px;">{company}</span>
    </div>
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
      <span style="background:rgba(255,255,255,0.15);color:#ffffff;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;">DAY TRADE</span>
      <span style="color:rgba(255,255,255,0.7);font-size:11px;">{prev_label} →</span>
      <span style="background:{badge_bg};color:{badge_fg};padding:3px 10px;border-radius:4px;font-size:11px;font-weight:800;">{now_label}</span>
      {'<span style="background:#fef3c7;color:#92400e;padding:2px 7px;border-radius:4px;font-size:9px;font-weight:800;">NARROW OR</span>' if narrow_or_caution and is_inplay else ''}
    </div>
  </div>
  <div style="background:#ffffff;padding:12px 14px;">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
      <span style="font-size:12px;font-weight:700;color:{bias_color};">{bias}</span>
      <span style="color:#cbd5e1;">|</span>
      <span style="font-size:12px;font-weight:600;color:#7c3aed;">{direction}</span>
      <span style="color:#cbd5e1;">|</span>
      <span style="font-size:11px;color:#64748b;">Signal: <strong>{eg_action}</strong></span>
      <span style="color:#cbd5e1;">|</span>
      <span style="font-size:10px;color:#94a3b8;">{session}</span>
    </div>
    <div style="background:#f8fafc;border-radius:6px;padding:8px 10px;flex-wrap:wrap;">
      {levels_html}
    </div>
    {narrow_or_strip}
    {summary_row}
    {dec_row2}
  </div>
</div>"""

    has_target  = any(it.get("alertType") == "TARGET_REACHED" for it in items)
    has_weak_bo = any(it.get("alertType") == "WEAK_BREAKOUT"  for it in items)
    has_state   = any(it.get("alertType") == "STATE_CHANGE"   for it in items)
    if has_target and not has_state and not has_weak_bo:
        email_title = "Take-Profit Target Hit"
        intro_text  = f"Hi <strong>{html.escape(display_name)}</strong>, a scalp target was reached for a ticker in your <strong>My Tickers</strong> list — consider taking profit or trailing your stop:"
    elif has_weak_bo and not has_state and not has_target:
        email_title = "Breakout Stalling — Act Now"
        intro_text  = f"Hi <strong>{html.escape(display_name)}</strong>, a breakout in your <strong>My Tickers</strong> list has not extended after 30 min — exit or set a tight stop:"
    elif has_target or has_weak_bo:
        email_title = "Day Trade Alert"
        intro_text  = f"Hi <strong>{html.escape(display_name)}</strong>, the following tickers in your <strong>My Tickers</strong> list had day-trade activity:"
    else:
        email_title = "State Change Alert"
        intro_text  = f"Hi <strong>{html.escape(display_name)}</strong>, the following tickers in your <strong>My Tickers</strong> list changed day-trade state:"

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:20px 12px;">
    <div style="background:linear-gradient(135deg,#1e1b4b,#312e81);padding:18px 22px;border-radius:12px 12px 0 0;">
      <div style="color:#e0e7ff;font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:4px;">OptionAdvisor · Day Trade</div>
      <div style="color:#ffffff;font-size:18px;font-weight:800;">{html.escape(email_title)}</div>
      <div style="color:rgba(255,255,255,0.6);font-size:12px;margin-top:2px;">Scanned every 15 min during market hours</div>
    </div>
    <div style="background:#ffffff;border:1px solid #e2e8f0;border-top:none;padding:18px 16px;">
      <p style="color:#374151;font-size:13px;margin:0 0 16px 0;">{intro_text}</p>
      {cards_html}
      <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap;">
        <a href="{html.escape(day_trade_url)}" style="background:#7c3aed;color:#ffffff;padding:9px 18px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:700;">Open Day Trade</a>
        <a href="{html.escape(signal_feed_url)}" style="background:#0f172a;color:#ffffff;padding:9px 18px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;">Signal Feed</a>
      </div>
    </div>
    <div style="padding:10px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;">
      <p style="color:#94a3b8;font-size:10px;margin:0;">Alerts fire on state transitions for My Tickers · Day trade engine scans every 15 min during market hours. Prices are intraday snapshots — verify live before acting.</p>
    </div>
  </div>
</body>
</html>"""


@app.get("/api/day-trade-alerts/{email}")
def list_day_trade_alerts_api(email: str, auth_email: str = Depends(require_access_email)):
    ensure_same_user(auth_email, email)
    normalized = normalize_email(auth_email)
    if get_user_state(normalized).get("role") != "admin":
        raise HTTPException(
            status_code=403,
            detail="Day Trade Alerts require administrator access.",
        )
    now_ms = int(time.time() * 1000)
    return {
        "email": email.strip().lower(),
        "alerts": list_day_trade_alert_events(email, DAY_TRADE_ALERT_RETENTION_MS, now_ms),
    }


# ── BACKTESTING ───────────────────────────────────────────────────────────────


def _run_backtest_endpoint(request: BacktestRequest):
    """Walk-forward backtest using Black-Scholes synthetic option pricing."""
    from backtest import run_backtest
    ticker = request.ticker.strip().upper()
    if not ticker:
        raise HTTPException(status_code=400, detail="ticker is required")
    result = run_backtest(
        ticker=ticker,
        start_date=request.start_date,
        end_date=request.end_date,
        strategy_mode=request.strategy_mode,
        weeks_out=request.weeks_out,
        spread_width=request.spread_width,
    )
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


class TradeWorksheetSelectedRow(BaseModel):
    strike: float | None = None
    bid: float | None = None
    ask: float | None = None
    mid: float | None = None
    spread: float | None = None
    spread_pct: float | None = None
    volume: int | None = None
    open_interest: int | None = None
    iv: float | None = None
    in_the_money: bool | None = None
    is_atm: bool | None = None


class TradeWorksheetEvaluateRequest(BaseModel):
    ticker: str = ""
    direction: str = "Bullish"
    strategy: str = "Long Call"
    strike: float = 0.0
    shortStrike: float = 0.0
    longStrike: float = 0.0
    shortPutStrike: float = 0.0
    longPutStrike: float = 0.0
    shortCallStrike: float = 0.0
    longCallStrike: float = 0.0
    expiration: str = ""
    sellExpiration: str = ""
    buyExpiration: str = ""
    premium: float = 0.0
    contracts: int = 1
    stockPrice: float = 0.0
    targetPrice: float = 0.0
    expectedHoldDays: int = 5
    buyingPower: float = 0.0
    ivRank: float = 0.0
    ivPercentile: float = 0.0
    historicalVolatility: float = 45.0
    selectedRow: TradeWorksheetSelectedRow | None = None
    selectedLegRows: dict[str, TradeWorksheetSelectedRow] | None = None
    priceMove: float = 5.0
    ivMove: float = 0.0
    daysPassed: int = 3


class DayTradeDisplayValue(BaseModel):
    raw: float | str | None = None
    display: str
    tone: str | None = None
    helpText: str | None = None


class DayTradeDisplayStatus(BaseModel):
    code: str
    label: str
    tone: str
    iconKey: str | None = None
    description: str | None = None


class DayTradeWorkspaceAction(BaseModel):
    id: str
    type: str
    label: str
    enabled: bool
    disabledReason: str | None = None
    payload: dict[str, str | int | float | bool | None] | None = None


class DayTradeSymbolView(BaseModel):
    ticker: str
    companyName: str | None = None
    price: DayTradeDisplayValue
    change: DayTradeDisplayValue


class DayTradeSessionView(BaseModel):
    mode: str
    status: DayTradeDisplayStatus
    sessionDate: str
    displayDate: str
    marketTimeZone: str
    isExecutionAllowed: bool
    reviewCopy: str | None = None


class DayTradeDecisionView(BaseModel):
    context: DayTradeDisplayStatus
    permission: DayTradeDisplayStatus
    headline: str
    reason: str
    nextCondition: str | None = None
    setupName: str | None = None
    primaryAction: DayTradeWorkspaceAction
    secondaryActions: list[DayTradeWorkspaceAction] = Field(default_factory=list)


class DayTradeTriggerRequirementView(BaseModel):
    id: str
    label: str
    displayValue: str | None = None
    result: str
    tone: str


class DayTradeTriggerView(BaseModel):
    status: DayTradeDisplayStatus
    summary: str
    requirements: list[DayTradeTriggerRequirementView] = Field(default_factory=list)


class DayTradeRiskPlanView(BaseModel):
    entry: DayTradeDisplayValue
    stop: DayTradeDisplayValue
    target1: DayTradeDisplayValue
    target2: DayTradeDisplayValue
    positionSize: DayTradeDisplayValue
    riskReward: DayTradeDisplayValue


class DayTradeEvidenceItemView(BaseModel):
    id: str
    label: str
    detail: str | None = None
    result: str
    tone: str
    order: int
    ruleId: str | None = None
    observedAt: str | None = None


class DayTradeSelectedContractView(BaseModel):
    expiration: DayTradeDisplayValue
    dte: DayTradeDisplayValue
    strike: DayTradeDisplayValue
    optionType: DayTradeDisplayValue
    bid: DayTradeDisplayValue
    ask: DayTradeDisplayValue
    midpoint: DayTradeDisplayValue
    spread: DayTradeDisplayValue
    spreadPercent: DayTradeDisplayValue
    liquidity: DayTradeDisplayStatus
    roundTrip: DayTradeDisplayValue


class DayTradeChartCandleView(BaseModel):
    time: str
    open: float
    high: float
    low: float
    close: float
    volume: float


class DayTradeChartLevelView(BaseModel):
    id: str
    kind: str
    price: float
    label: str
    tone: str
    lineStyleToken: str
    active: bool
    visibleByDefault: bool
    affectsTradeFocusScale: bool
    priority: int
    offscreenLabel: str | None = None


class DayTradeChartEventView(BaseModel):
    id: str
    timestamp: str
    eventType: str
    title: str
    detail: str | None = None
    tone: str
    visibleByDefault: bool
    priority: int
    price: float | None = None


class DayTradeChartDefaultsView(BaseModel):
    interval: str
    visibleRange: str
    initialVisibleBars: int
    initialBarSpacing: int
    minBarSpacing: int
    maxBarSpacing: int
    rightOffsetBars: int
    scaleMode: str
    followLive: bool
    visibleOverlayIds: list[str] = Field(default_factory=list)


class DayTradeChartTradeFocusView(BaseModel):
    scalePaddingPercent: float
    levelIdsAllowedToAffectScale: list[str] = Field(default_factory=list)


class DayTradeChartView(BaseModel):
    candles: list[DayTradeChartCandleView] = Field(default_factory=list)
    levels: list[DayTradeChartLevelView] = Field(default_factory=list)
    events: list[DayTradeChartEventView] = Field(default_factory=list)
    defaults: DayTradeChartDefaultsView
    tradeFocus: DayTradeChartTradeFocusView | None = None


class DayTradeWorkspaceResponse(BaseModel):
    schemaVersion: str
    generatedAt: str
    symbol: DayTradeSymbolView
    session: DayTradeSessionView
    decision: DayTradeDecisionView
    trigger: DayTradeTriggerView
    riskPlan: DayTradeRiskPlanView
    evidence: list[DayTradeEvidenceItemView] = Field(default_factory=list)
    selectedContract: DayTradeSelectedContractView | None = None
    chart: DayTradeChartView
    tabs: dict[str, Any] = Field(default_factory=dict)
    provenance: dict[str, Any] | None = None


class MetricDefinitionOut(BaseModel):
    metricId: str
    label: str
    category: str
    unit: str
    formulaId: str
    formulaVersion: str
    shortDescription: str
    longDescription: str
    inputsUsed: list[str] = Field(default_factory=list)
    displayRules: dict[str, Any] = Field(default_factory=dict)


class MetricDefinitionsResponse(BaseModel):
    formulaPackVersion: str
    metricDefinitionsVersion: str
    metrics: list[MetricDefinitionOut] = Field(default_factory=list)


class CalculationRunResponse(BaseModel):
    run_id: str
    run_type: str
    status: str
    engine_version: str
    formula_pack_version: str
    owner_email: str = ""
    input_hash: str
    output_hash: str
    snapshot_id: str | None = None
    input: dict[str, Any] = Field(default_factory=dict)
    error: str = ""
    created_at_ms: int
    completed_at_ms: int | None = None


class CalculationSnapshotResponse(BaseModel):
    snapshot_id: str
    run_id: str
    run_type: str
    engine_version: str
    formula_pack_version: str
    metric_definitions_version: str
    owner_email: str = ""
    input_hash: str
    output_hash: str
    input: dict[str, Any] = Field(default_factory=dict)
    output: dict[str, Any] = Field(default_factory=dict)
    metric_definitions: list[dict[str, Any]] = Field(default_factory=list)
    created_at_ms: int
    frozen_at_ms: int


class CalculationSnapshotIntegrityResponse(BaseModel):
    snapshot_id: str
    run_id: str
    verified: bool
    input_hash_matches: bool
    output_hash_matches: bool
    run_hash_matches: bool
    stored_input_hash: str
    computed_input_hash: str
    stored_output_hash: str
    computed_output_hash: str
    mismatches: list[str] = Field(default_factory=list)
    verified_at_ms: int


class CalculationSnapshotAuditEventResponse(BaseModel):
    audit_id: str
    snapshot_id: str
    event_type: str
    event: dict[str, Any] = Field(default_factory=dict)
    created_at_ms: int


class CalculationSnapshotAuditLogResponse(BaseModel):
    snapshot_id: str
    events: list[CalculationSnapshotAuditEventResponse] = Field(default_factory=list)
    count: int = 0


class CalculationRunCreateRequest(BaseModel):
    runType: str
    input: dict[str, Any] = Field(default_factory=dict)


class CalculationRunCreateResponse(BaseModel):
    run: CalculationRunResponse
    snapshot: CalculationSnapshotResponse
    result: dict[str, Any] = Field(default_factory=dict)


class CalculationRunsListResponse(BaseModel):
    runs: list[CalculationRunResponse] = Field(default_factory=list)
    count: int = 0


class CalculationRunTypeResponse(BaseModel):
    runType: str
    label: str
    description: str
    engineVersion: str
    formulaPackVersion: str
    metricDefinitionsVersion: str
    snapshotSupported: bool
    status: str


class CalculationRunTypesResponse(BaseModel):
    routerVersion: str
    runTypes: list[CalculationRunTypeResponse] = Field(default_factory=list)
    count: int = 0


_WORKSHEET_STRATEGIES = {
    "Long Call", "Long Put", "Bull Call Spread", "Bull Put Spread",
    "Bear Put Spread", "Bear Call Spread", "Calendar Spread",
    "Diagonal Spread", "Iron Condor", "Covered Call", "Cash Secured Put", "Shares",
}


def _tw_clamp(n: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, n))


def _tw_days_to_expiry(expiration: str) -> int:
    if not expiration:
        return 0
    try:
        exp_dt = datetime.strptime(expiration[:10], "%Y-%m-%d").date()
        return max(0, (exp_dt - datetime.now().date()).days)
    except Exception:
        return 0


def _tw_is_calendar_like(strategy: str) -> bool:
    return strategy in {"Calendar Spread", "Diagonal Spread"}


def _tw_is_credit_spread(strategy: str) -> bool:
    return strategy in {"Bull Put Spread", "Bear Call Spread"}


def _tw_uses_put_chain(direction: str, strategy: str) -> bool:
    if "Put" in strategy or strategy == "Cash Secured Put":
        return True
    if "Call" in strategy or strategy == "Covered Call":
        return False
    return direction == "Bearish"


def _tw_leg_mid(row: TradeWorksheetSelectedRow | None) -> float:
    if not row:
        return 0.0
    mid = safe_float(row.mid)
    if mid > 0:
        return mid
    bid = safe_float(row.bid)
    ask = safe_float(row.ask)
    if bid > 0 and ask > 0:
        return (bid + ask) / 2.0
    return 0.0


def _tw_net_premium(req: TradeWorksheetEvaluateRequest) -> float:
    """Signed net premium per share. Positive = net credit, negative = net debit."""
    legs = req.selectedLegRows or {}
    strategy = req.strategy
    if strategy in {"Long Call", "Long Put"}:
        p = _tw_leg_mid(legs.get("long") or req.selectedRow)
        return -p if p > 0 else -abs(safe_float(req.premium))
    if strategy == "Bull Call Spread":
        debit = _tw_leg_mid(legs.get("long")) - _tw_leg_mid(legs.get("short"))
        return -debit if debit > 0 else -abs(safe_float(req.premium))
    if strategy == "Bear Put Spread":
        debit = _tw_leg_mid(legs.get("long")) - _tw_leg_mid(legs.get("short"))
        return -debit if debit > 0 else -abs(safe_float(req.premium))
    if strategy == "Bull Put Spread":
        credit = _tw_leg_mid(legs.get("short")) - _tw_leg_mid(legs.get("long"))
        return credit if credit > 0 else abs(safe_float(req.premium))
    if strategy == "Bear Call Spread":
        credit = _tw_leg_mid(legs.get("short")) - _tw_leg_mid(legs.get("long"))
        return credit if credit > 0 else abs(safe_float(req.premium))
    if strategy in {"Calendar Spread", "Diagonal Spread"}:
        debit = _tw_leg_mid(legs.get("buy")) - _tw_leg_mid(legs.get("sell"))
        return -debit if debit > 0 else -abs(safe_float(req.premium))
    if strategy == "Iron Condor":
        credit = (
            _tw_leg_mid(legs.get("shortPut")) + _tw_leg_mid(legs.get("shortCall"))
            - _tw_leg_mid(legs.get("longPut")) - _tw_leg_mid(legs.get("longCall"))
        )
        return credit if credit > 0 else abs(safe_float(req.premium))
    if strategy == "Covered Call":
        p = _tw_leg_mid(legs.get("short") or req.selectedRow)
        return p if p > 0 else abs(safe_float(req.premium))
    if strategy == "Cash Secured Put":
        p = _tw_leg_mid(legs.get("short") or req.selectedRow)
        return p if p > 0 else abs(safe_float(req.premium))
    return safe_float(req.premium)


def _tw_abs_premium(req: TradeWorksheetEvaluateRequest) -> float:
    return abs(_tw_net_premium(req))


def _tw_primary_row(req: TradeWorksheetEvaluateRequest) -> TradeWorksheetSelectedRow | None:
    legs = req.selectedLegRows or {}
    for key in ("long", "short", "buy", "sell", "shortPut", "shortCall", "longPut", "longCall"):
        if legs.get(key):
            return legs[key]
    return req.selectedRow


def _tw_premium_type(req: TradeWorksheetEvaluateRequest) -> str:
    if req.strategy == "Shares":
        return "none"
    return "credit" if _tw_net_premium(req) > 0 else "debit"


def _tw_front_expiry(req: TradeWorksheetEvaluateRequest) -> str:
    return (req.sellExpiration or req.expiration) if _tw_is_calendar_like(req.strategy) else req.expiration


def _tw_back_expiry(req: TradeWorksheetEvaluateRequest) -> str:
    return (req.buyExpiration or req.expiration) if _tw_is_calendar_like(req.strategy) else req.expiration


def _tw_primary_strike(req: TradeWorksheetEvaluateRequest) -> float:
    strategy = req.strategy
    if strategy in {"Bull Put Spread", "Bear Call Spread"}:
        return safe_float(req.shortStrike or req.strike)
    if strategy in {"Bull Call Spread", "Bear Put Spread"}:
        return safe_float(req.longStrike or req.strike)
    if _tw_is_calendar_like(strategy):
        return safe_float(req.shortStrike or req.strike)
    if strategy == "Iron Condor":
        return safe_float(req.shortCallStrike if req.direction == "Bearish" else req.shortPutStrike)
    return safe_float(req.strike)


def _tw_spread_width(req: TradeWorksheetEvaluateRequest) -> float:
    strategy = req.strategy
    if strategy in {"Bull Call Spread", "Bear Call Spread"}:
        return abs(safe_float(req.longStrike or req.strike) - safe_float(req.shortStrike or req.strike))
    if strategy in {"Bear Put Spread", "Bull Put Spread"}:
        return abs(safe_float(req.shortStrike or req.strike) - safe_float(req.longStrike or req.strike))
    if strategy == "Iron Condor":
        return max(
            abs(safe_float(req.shortPutStrike) - safe_float(req.longPutStrike)),
            abs(safe_float(req.longCallStrike) - safe_float(req.shortCallStrike)),
        )
    return 0.0


def _tw_cost(req: TradeWorksheetEvaluateRequest) -> float:
    contracts = max(1, safe_int(req.contracts))
    if req.strategy == "Shares":
        return safe_float(req.stockPrice) * contracts
    net_premium = _tw_net_premium(req)
    return max(0.0, -net_premium) * 100.0 * contracts


def _tw_max_risk(req: TradeWorksheetEvaluateRequest) -> float:
    contracts = max(1, safe_int(req.contracts))
    if req.strategy == "Shares":
        return safe_float(req.stockPrice) * contracts
    if req.strategy == "Iron Condor" or _tw_is_credit_spread(req.strategy):
        return max(0.0, _tw_spread_width(req) - _tw_abs_premium(req)) * 100.0 * contracts
    if req.strategy == "Cash Secured Put":
        return max(0.0, safe_float(req.strike) - _tw_abs_premium(req)) * 100.0 * contracts
    if req.strategy == "Covered Call":
        return safe_float(req.stockPrice) * 100.0 * contracts
    return _tw_cost(req)


def _tw_breakeven(req: TradeWorksheetEvaluateRequest) -> float | None:
    premium = _tw_abs_premium(req)
    if req.strategy == "Shares":
        return safe_float(req.stockPrice)
    if req.strategy == "Bull Call Spread":
        return safe_float(req.longStrike) + premium
    if req.strategy == "Bear Put Spread":
        return safe_float(req.longStrike) - premium
    if req.strategy == "Bull Put Spread":
        return safe_float(req.shortStrike) - premium
    if req.strategy == "Bear Call Spread":
        return safe_float(req.shortStrike) + premium
    if req.strategy == "Iron Condor":
        return None
    strike = _tw_primary_strike(req)
    return strike - premium if _tw_uses_put_chain(req.direction, req.strategy) else strike + premium


def _tw_parse_date(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, (list, tuple, set)):
        for item in value:
            parsed = _tw_parse_date(item)
            if parsed:
                return parsed
        return None
    if isinstance(value, dict):
        for key in ("raw", "fmt", "date", "startdatetime"):
            parsed = _tw_parse_date(value.get(key))
            if parsed:
                return parsed
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, (int, float)) and value > 0:
        try:
            return datetime.fromtimestamp(float(value), tz=timezone.utc)
        except Exception:
            return None
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        if text.isdigit():
            return _tw_parse_date(float(text))
        for fmt in ("%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%b %d, %Y", "%B %d, %Y"):
            try:
                return datetime.strptime(text[:19] if fmt == "%Y-%m-%d %H:%M:%S" else text[:10] if fmt == "%Y-%m-%d" else text, fmt)
            except Exception:
                pass
        try:
            return datetime.fromisoformat(text.replace("Z", "+00:00"))
        except Exception:
            return None
    return None


def _tw_earnings_info(ticker: str, front_expiry: str) -> dict[str, Any]:
    event_dt: datetime | None = None
    try:
        info = _bc_info(ticker.upper().strip())
    except Exception:
        info = {}
    for key in (
        "earningsTimestamp",
        "earningsDate",
        "nextEarningsDate",
        "earningsTimestampStart",
        "earningsTimestampEnd",
    ):
        event_dt = _tw_parse_date(info.get(key))
        if event_dt:
            break

    if not event_dt:
        return {
            "date": None,
            "daysUntil": None,
            "beforeExpiration": False,
            "risk": "Unknown",
            "message": "Earnings date not found in market data.",
        }

    today = datetime.now(timezone.utc).date()
    event_date = event_dt.date()
    days_until = (event_date - today).days
    front_dte = _tw_days_to_expiry(front_expiry)
    before_expiration = 0 <= days_until <= front_dte if front_dte >= 0 else False
    if before_expiration:
        risk = "High"
        message = "Earnings occur before this expiration; IV crush and gap risk must be intentional."
    elif 0 <= days_until <= front_dte + 7:
        risk = "Medium"
        message = "Earnings are near the selected expiration; pricing and exit timing need extra caution."
    elif 0 <= days_until <= 14:
        risk = "Medium"
        message = "Earnings are approaching; avoid holding through the event unless that is the plan."
    else:
        risk = "Low"
        message = "No near-term earnings event conflicts with this expiration."
    return {
        "date": event_date.isoformat(),
        "daysUntil": days_until,
        "beforeExpiration": before_expiration,
        "risk": risk,
        "message": message,
    }


def _tw_norm_cdf(x: float) -> float:
    return 0.5 * (1.0 + erf(x / sqrt(2.0)))


def _tw_greeks(req: TradeWorksheetEvaluateRequest) -> dict[str, float]:
    s = max(0.01, safe_float(req.stockPrice))
    k = max(0.01, _tw_primary_strike(req))
    dte = max(1, _tw_days_to_expiry(_tw_front_expiry(req)))
    t_years = dte / 365.0
    selected_row = _tw_primary_row(req)
    row_iv = safe_float(selected_row.iv if selected_row else 0.0)
    hv = safe_float(req.historicalVolatility or 45.0)
    iv = max(0.05, (row_iv if 0 < row_iv < 300 else hv) / 100.0)
    d1 = (log(s / k) + (0.5 * iv * iv) * t_years) / (iv * sqrt(t_years))
    d2 = d1 - iv * sqrt(t_years)
    call_delta = _tw_norm_cdf(d1)
    delta = call_delta - 1 if _tw_uses_put_chain(req.direction, req.strategy) else call_delta
    gamma = np.exp(-d1 * d1 / 2) / (s * iv * sqrt(2 * np.pi * t_years))
    vega = s * sqrt(t_years) * np.exp(-d1 * d1 / 2) / sqrt(2 * np.pi) / 100
    theta = -(s * np.exp(-d1 * d1 / 2) * iv) / (2 * sqrt(2 * np.pi * t_years)) / 365
    pop = _tw_norm_cdf(-d2) if _tw_uses_put_chain(req.direction, req.strategy) else _tw_norm_cdf(d2)
    return {
        "delta": round(float(delta), 4),
        "gamma": round(float(gamma), 6),
        "theta": round(float(theta), 4),
        "vega": round(float(vega), 4),
        "iv": round(float(iv), 4),
        "probabilityItm": round(_tw_clamp(float(pop) * 100), 1),
        "probabilityOtm": round(_tw_clamp((1 - float(pop)) * 100), 1),
    }


def _tw_payoff(req: TradeWorksheetEvaluateRequest, price: float) -> float:
    c = max(1, safe_int(req.contracts))
    net_premium = _tw_net_premium(req)
    debit_paid = max(0.0, -net_premium) * 100 * c
    credit_received = max(0.0, net_premium) * 100 * c
    strategy = req.strategy
    if strategy == "Shares":
        return (price - safe_float(req.stockPrice)) * c
    if strategy == "Bear Put Spread":
        return min(_tw_spread_width(req), max(0, safe_float(req.longStrike) - price)) * 100 * c - debit_paid
    if strategy == "Bull Call Spread":
        return min(_tw_spread_width(req), max(0, price - safe_float(req.longStrike))) * 100 * c - debit_paid
    if strategy == "Bull Put Spread":
        return credit_received - min(_tw_spread_width(req), max(0, safe_float(req.shortStrike) - price)) * 100 * c
    if strategy == "Bear Call Spread":
        return credit_received - min(_tw_spread_width(req), max(0, price - safe_float(req.shortStrike))) * 100 * c
    if strategy == "Long Put" or (_tw_is_calendar_like(strategy) and _tw_uses_put_chain(req.direction, strategy)):
        return max(0, _tw_primary_strike(req) - price) * 100 * c - debit_paid
    if strategy == "Cash Secured Put":
        return credit_received - max(0, _tw_primary_strike(req) - price) * 100 * c
    if strategy == "Covered Call":
        stock_pnl = (price - safe_float(req.stockPrice)) * 100 * c
        call_loss = max(0, price - _tw_primary_strike(req)) * 100 * c
        return stock_pnl + credit_received - call_loss
    if strategy == "Iron Condor":
        put_loss = max(0, safe_float(req.shortPutStrike) - price) * 100 * c
        call_loss = max(0, price - safe_float(req.shortCallStrike)) * 100 * c
        return credit_received - min(_tw_spread_width(req) * 100 * c, max(put_loss, call_loss))
    return max(0, price - _tw_primary_strike(req)) * 100 * c - debit_paid


def _tw_payoff_at(req: TradeWorksheetEvaluateRequest, price: float, t_years: float, sigma: float, r: float = 0.045) -> float:
    """P&L at underlying `price` with `t_years` remaining to expiration, option legs
    priced via Black-Scholes. At t_years<=0 the BS value collapses to intrinsic, so this
    matches `_tw_payoff` at expiration (validated in tests)."""
    from backtest import bs_price
    c = max(1, safe_int(req.contracts))
    net_premium = _tw_net_premium(req)
    debit_paid = max(0.0, -net_premium) * 100 * c
    credit_received = max(0.0, net_premium) * 100 * c
    strategy = req.strategy
    width = _tw_spread_width(req)
    S = max(0.01, float(price))
    T = max(0.0, float(t_years))
    sig = max(0.01, float(sigma))

    def _bs(strike: float, opt: str) -> float:
        return bs_price(S, max(0.01, float(strike)), T, r, sig, opt)

    if strategy == "Shares":
        return (price - safe_float(req.stockPrice)) * c
    if strategy == "Bear Put Spread":
        long_k = safe_float(req.longStrike)
        return (_bs(long_k, "PUT") - _bs(long_k - width, "PUT")) * 100 * c - debit_paid
    if strategy == "Bull Call Spread":
        long_k = safe_float(req.longStrike)
        return (_bs(long_k, "CALL") - _bs(long_k + width, "CALL")) * 100 * c - debit_paid
    if strategy == "Bull Put Spread":
        short_k = safe_float(req.shortStrike)
        return credit_received - (_bs(short_k, "PUT") - _bs(short_k - width, "PUT")) * 100 * c
    if strategy == "Bear Call Spread":
        short_k = safe_float(req.shortStrike)
        return credit_received - (_bs(short_k, "CALL") - _bs(short_k + width, "CALL")) * 100 * c
    if strategy == "Long Put" or (_tw_is_calendar_like(strategy) and _tw_uses_put_chain(req.direction, strategy)):
        return _bs(_tw_primary_strike(req), "PUT") * 100 * c - debit_paid
    if strategy == "Cash Secured Put":
        return credit_received - _bs(_tw_primary_strike(req), "PUT") * 100 * c
    if strategy == "Covered Call":
        stock_pnl = (price - safe_float(req.stockPrice)) * 100 * c
        return stock_pnl + credit_received - _bs(_tw_primary_strike(req), "CALL") * 100 * c
    if strategy == "Iron Condor":
        put_spread = _bs(safe_float(req.shortPutStrike), "PUT") - _bs(safe_float(req.shortPutStrike) - width, "PUT")
        call_spread = _bs(safe_float(req.shortCallStrike), "CALL") - _bs(safe_float(req.shortCallStrike) + width, "CALL")
        return credit_received - (put_spread + call_spread) * 100 * c
    return _bs(_tw_primary_strike(req), "CALL") * 100 * c - debit_paid


def _tw_payoff_matrix(req: TradeWorksheetEvaluateRequest, sigma: float, front_dte: int) -> dict[str, Any]:
    """Dated price x time P&L matrix (OptionStrat-style). Rows = underlying prices,
    columns = calendar dates from today through expiration, each cell BS-priced."""
    base = max(0.01, safe_float(req.stockPrice))
    prices = [round(base * (1 + i / 100), 2) for i in range(-30, 31, 3)]
    n_cols = 6
    dte = max(0, int(front_dte))
    # Anchor column dates to the expiration date (deterministic) rather than
    # wall-clock now(); date = expiry - daysRemaining. Falls back to now()+elapsed
    # only if the expiration can't be parsed.
    expiry_date = None
    try:
        expiry_date = datetime.strptime(str(_tw_front_expiry(req))[:10], "%Y-%m-%d")
    except (ValueError, TypeError):
        expiry_date = None
    today = datetime.now()
    columns: list[dict[str, Any]] = []
    seen_elapsed: set[int] = set()
    for j in range(n_cols):
        elapsed = round(dte * j / (n_cols - 1)) if dte > 0 and n_cols > 1 else 0
        if elapsed in seen_elapsed:
            continue
        seen_elapsed.add(elapsed)
        remaining = max(0, dte - elapsed)
        col_date = (expiry_date - timedelta(days=int(remaining))) if expiry_date else (today + timedelta(days=int(elapsed)))
        columns.append({
            "daysElapsed": int(elapsed),
            "daysRemaining": int(remaining),
            "date": col_date.strftime("%b %d"),
            "isExpiration": remaining <= 0,
        })
    grid = [
        [round(_tw_payoff_at(req, price, col["daysRemaining"] / 365.0, sigma)) for col in columns]
        for price in prices
    ]
    return {"prices": prices, "columns": columns, "grid": grid}


def _tw_score(req: TradeWorksheetEvaluateRequest, greeks: dict[str, float], earnings: dict[str, Any] | None = None) -> dict[str, float]:
    dte = _tw_days_to_expiry(_tw_front_expiry(req))
    row = _tw_primary_row(req)
    liquidity = _tw_clamp(100 - safe_float(row.spread_pct if row else 12) * 4 + min(20, safe_float(row.open_interest if row else 0) / 100)) if row else 55
    time_score = 90 if 8 <= dte <= 45 else 35 if dte < 5 else 75 if dte <= 90 else 60
    option_pricing = _tw_clamp(100 - safe_float(req.ivRank) * 0.45 - safe_float(row.spread_pct if row else 12) * 2)
    probability = _tw_clamp(safe_float(greeks["probabilityItm"]) + (20 if abs(safe_float(greeks["delta"])) >= 0.45 else 0))
    be = _tw_breakeven(req)
    denom = max(0.01, abs(safe_float(req.stockPrice) - safe_float(be or req.stockPrice)))
    rr = abs((safe_float(req.targetPrice) - safe_float(req.stockPrice)) / denom)
    risk_reward = _tw_clamp(rr * 35)
    volatility = _tw_clamp(100 - max(0, safe_float(req.ivRank) - 40))
    trend = 70 if req.direction == "Neutral" else 85 if ((safe_float(req.targetPrice) > safe_float(req.stockPrice) and req.direction == "Bullish") or (safe_float(req.targetPrice) < safe_float(req.stockPrice) and req.direction == "Bearish")) else 45
    market = 78
    earnings_risk = (earnings or {}).get("risk")
    if earnings_risk == "High":
        option_pricing = _tw_clamp(option_pricing - 12)
        volatility = _tw_clamp(volatility - 12)
        time_score = _tw_clamp(time_score - 8)
    elif earnings_risk == "Medium":
        option_pricing = _tw_clamp(option_pricing - 6)
        volatility = _tw_clamp(volatility - 5)
        time_score = _tw_clamp(time_score - 3)
    total = round((trend + option_pricing + time_score + liquidity + probability + risk_reward + volatility + market) / 8)
    return {
        "total": total,
        "trend": round(trend),
        "optionPricing": round(option_pricing),
        "time": round(time_score),
        "liquidity": round(liquidity),
        "probability": round(probability),
        "riskReward": round(risk_reward),
        "volatility": round(volatility),
        "market": round(market),
    }


def _tw_score_label(score: float) -> str:
    return "STRONG BUY" if score >= 90 else "BUY" if score >= 78 else "ACCEPTABLE" if score >= 65 else "WAIT" if score >= 50 else "DO NOT BUY"


@app.post("/api/trade-worksheet/evaluate")
def trade_worksheet_evaluate(request: TradeWorksheetEvaluateRequest, auth_email: str = Depends(require_access_email)):
    req = request
    req.strategy = req.strategy if req.strategy in _WORKSHEET_STRATEGIES else "Long Call"
    greeks = _tw_greeks(req)
    front_expiry = _tw_front_expiry(req)
    earnings = _tw_earnings_info(req.ticker, front_expiry)
    score = _tw_score(req, greeks, earnings)
    cost = _tw_cost(req)
    max_risk = _tw_max_risk(req)
    capital_required = max_risk if req.strategy == "Iron Condor" or _tw_is_credit_spread(req.strategy) or req.strategy == "Cash Secured Put" else cost
    be = _tw_breakeven(req)
    net_premium = _tw_net_premium(req)
    abs_premium = _tw_abs_premium(req)
    front_dte = _tw_days_to_expiry(front_expiry)
    back_dte = _tw_days_to_expiry(_tw_back_expiry(req))
    sim_price = safe_float(req.stockPrice) * (1 + safe_float(req.priceMove) / 100)
    estimated_value = max(0.01, abs_premium + (sim_price - safe_float(req.stockPrice)) * safe_float(greeks["delta"]) + safe_float(req.ivMove) / 100 * safe_float(greeks["vega"]) * 100 + safe_float(greeks["theta"]) * safe_int(req.daysPassed))
    estimated_profit = ((abs_premium - estimated_value) if net_premium > 0 else (estimated_value - abs_premium)) * 100 * max(1, safe_int(req.contracts))
    scenario_basis = max(1.0, capital_required or cost or max_risk)
    expected_value = (safe_float(score["probability"]) / 100) * max(1, _tw_payoff(req, safe_float(req.targetPrice))) - (1 - safe_float(score["probability"]) / 100) * scenario_basis
    def _scenario_mark(price: float, days: int, iv_move: float = 0.0) -> float:
        return max(
            0.01,
            abs_premium
            + (price - safe_float(req.stockPrice)) * safe_float(greeks["delta"])
            + iv_move / 100 * safe_float(greeks["vega"]) * 100
            + safe_float(greeks["theta"]) * days,
        )

    def _scenario_pnl(mark: float) -> float:
        return ((abs_premium - mark) if net_premium > 0 else (mark - abs_premium)) * 100 * max(1, safe_int(req.contracts))

    time_days = sorted(set([0, 1, 3, 5, 10, 15, 20, max(0, min(front_dte, safe_int(req.expectedHoldDays))), max(0, front_dte)]))
    time_buckets = [
        {
            "day": day,
            "flatPnl": round(_scenario_pnl(_scenario_mark(safe_float(req.stockPrice), day)), 2),
            "targetPnl": round(_scenario_pnl(_scenario_mark(safe_float(req.targetPrice), day)), 2),
            "scenarioPnl": round(_scenario_pnl(_scenario_mark(sim_price, day, safe_float(req.ivMove))), 2),
        }
        for day in time_days
        if day <= max(front_dte, safe_int(req.expectedHoldDays), safe_int(req.daysPassed), 1)
    ]
    comparisons = []
    debit = cost
    credit = max(80, abs_premium * 60)
    for row in [
        {"strategy": "Long Put" if req.direction == "Bearish" else "Long Call", "capital": debit, "maxLoss": debit, "maxProfit": None, "pop": score["probability"], "theta": "Negative", "score": score["total"] - (6 if abs_premium > 6 else 0)},
        {"strategy": "Bear Put Spread" if req.direction == "Bearish" else "Bull Call Spread", "capital": max(100, debit * 0.55), "maxLoss": max(100, debit * 0.55), "maxProfit": max(150, debit * 1.2), "pop": score["probability"] + 8, "theta": "Lower drag", "score": score["total"] + 6},
        {"strategy": "Calendar Spread", "capital": max(120, debit * 0.45), "maxLoss": max(120, debit * 0.45), "maxProfit": None, "pop": score["probability"] + 4, "theta": "Positive near short leg", "score": score["total"] + (5 if safe_float(req.ivRank) >= 50 else -2)},
        {"strategy": "Bear Call Spread" if req.direction == "Bearish" else "Bull Put Spread", "capital": max(400, debit * 1.4), "maxLoss": max(300, debit), "maxProfit": credit, "pop": score["probability"] + 12, "theta": "Positive", "score": score["total"] + (8 if safe_float(req.ivRank) >= 45 else -4)},
        {"strategy": "Shares", "capital": safe_float(req.stockPrice) * 100, "maxLoss": safe_float(req.stockPrice) * 100, "maxProfit": None, "pop": 50, "theta": "None", "score": score["total"] - 8},
    ]:
        row["score"] = round(_tw_clamp(safe_float(row["score"])))
        row["pop"] = round(_tw_clamp(safe_float(row["pop"])))
        comparisons.append(row)
    comparisons.sort(key=lambda r: r["score"], reverse=True)
    pros = [
        "Trend aligns with selected direction" if score["trend"] >= 75 else None,
        "Liquidity is acceptable for entry and exit" if score["liquidity"] >= 70 else None,
        "Expiration gives the thesis enough time" if score["time"] >= 75 else None,
        "Reward/risk is reasonable" if score["riskReward"] >= 65 else None,
        "Premium is not severely inflated by IV" if safe_float(req.ivRank) <= 55 else None,
        "Earnings timing does not conflict with this expiration" if earnings["risk"] == "Low" else None,
    ]
    cons = [
        "Bid/ask spread or open interest is weak" if score["liquidity"] < 70 else None,
        "Premium is expensive due to elevated IV" if safe_float(req.ivRank) > 60 else None,
        "Expiration is short; theta and gamma risk are high" if front_dte < 7 else None,
        "Earnings occur before expiration; IV crush and gap risk are elevated" if earnings["risk"] == "High" else None,
        "Earnings are close to this expiration window" if earnings["risk"] == "Medium" else None,
        "Reward/risk is not attractive enough" if score["riskReward"] < 55 else None,
        "Target requires a large move" if abs(safe_float(req.targetPrice) / max(1, safe_float(req.stockPrice)) - 1) > 0.12 else None,
    ]
    base = max(1, safe_float(req.stockPrice))
    payoff = [{"price": round(base * (1 + i / 100), 2), "pnl": round(_tw_payoff(req, base * (1 + i / 100)))} for i in range(-30, 31, 2)]
    payoff_matrix = _tw_payoff_matrix(req, safe_float(greeks["iv"]) or 0.3, front_dte)
    response = {
        "summary": {
            "ticker": req.ticker.upper().strip(),
            "strategy": req.strategy,
            "primaryStrike": round(_tw_primary_strike(req), 2),
            "frontExpiration": _tw_front_expiry(req),
            "backExpiration": _tw_back_expiry(req),
            "frontDte": front_dte,
            "backDte": back_dte,
            "netPremium": round(net_premium, 2),
            "netPremiumType": _tw_premium_type(req),
            "cost": round(cost, 2),
            "maxRisk": round(max_risk, 2),
            "breakeven": None if be is None else round(be, 2),
            "breakevenLow": round(safe_float(req.shortPutStrike) - abs_premium, 2) if req.strategy == "Iron Condor" else None,
            "breakevenHigh": round(safe_float(req.shortCallStrike) + abs_premium, 2) if req.strategy == "Iron Condor" else None,
            "capitalRequired": round(capital_required, 2),
            "thetaPerDay": round(safe_float(greeks["theta"]) * 100 * max(1, safe_int(req.contracts)), 2),
            "delta": greeks["delta"],
            "ivRank": round(safe_float(req.ivRank), 1),
            "probability": score["probability"],
            "probabilityItm": greeks["probabilityItm"],
            "riskLevel": "Medium" if score["total"] >= 82 else "High" if score["total"] >= 65 else "Extreme",
            "timeStopDays": max(1, min(safe_int(req.expectedHoldDays), front_dte - 2)),
            "successRequirement": "inside the short strike range" if req.strategy == "Iron Condor" else f"{round(((safe_float(be or req.stockPrice) / max(1, safe_float(req.stockPrice))) - 1) * 100, 1):+g}% toward breakeven",
            "earningsDate": earnings["date"],
            "earningsDaysUntil": earnings["daysUntil"],
            "earningsBeforeExpiration": earnings["beforeExpiration"],
            "earningsRisk": earnings["risk"],
            "earningsMessage": earnings["message"],
        },
        "greeks": greeks,
        "score": {**score, "label": _tw_score_label(score["total"])},
        "payoff": payoff,
        "payoffMatrix": payoff_matrix,
        "scenario": {
            "estimatedValue": round(estimated_value, 2),
            "estimatedProfit": round(estimated_profit, 2),
            "estimatedRoi": round((estimated_profit / scenario_basis * 100) if scenario_basis > 0 else 0, 1),
            "expectedValue": round(expected_value, 2),
            "expectedReturn": round((expected_value / scenario_basis) * 100, 1),
            "expectedDrawdown": round(scenario_basis * 0.3, 2),
            "priceBuckets": [
                {"label": "-10%", "value": round(_tw_payoff(req, safe_float(req.stockPrice) * 0.9), 2)},
                {"label": "-5%", "value": round(_tw_payoff(req, safe_float(req.stockPrice) * 0.95), 2)},
                {"label": "Flat", "value": round(_tw_payoff(req, safe_float(req.stockPrice)), 2)},
                {"label": "+5%", "value": round(_tw_payoff(req, safe_float(req.stockPrice) * 1.05), 2)},
                {"label": "+10%", "value": round(_tw_payoff(req, safe_float(req.stockPrice) * 1.1), 2)},
            ],
            "timeBuckets": time_buckets,
        },
        "comparisons": comparisons,
        "bestStrategy": comparisons[0] if comparisons else None,
        "pros": [p for p in pros if p],
        "cons": [c for c in cons if c],
        "coach": [
            "Premium is expensive. Consider a debit spread or wait for IV to cool." if safe_float(req.ivRank) > 60 else "Premium is not unusually expensive relative to IV inputs.",
            "Expiration is too short for most non-scalp trades. Consider adding another week." if front_dte < 7 else "Expiration gives enough time for the expected hold.",
            "Earnings are inside this expiration window. Prefer defined-risk structures or avoid holding through the event unless intentional." if earnings["risk"] == "High" else earnings["message"],
            "Current strike is far OTM. One strike ITM may improve probability." if abs(safe_float(greeks["delta"])) < 0.35 else "Delta is reasonable for directional exposure.",
            f"{comparisons[0]['strategy']} may express this thesis more efficiently than the selected structure." if comparisons and comparisons[0]["strategy"] != req.strategy else "Selected strategy is competitive against alternatives.",
        ],
    }
    metric_definitions = trade_worksheet_metric_definitions()
    response["metricDefinitions"] = {
        "formulaPackVersion": CURRENT_FORMULA_PACK_VERSION,
        "metricDefinitionsVersion": CURRENT_METRIC_DEFINITIONS_VERSION,
        "metrics": metric_definitions,
    }
    input_payload = req.model_dump(mode="json") if hasattr(req, "model_dump") else req.dict()
    snapshot = create_calculation_snapshot(
        run_type="trade_worksheet",
        input_payload=input_payload,
        output_payload=response,
        engine_version=TRADE_WORKSHEET_ENGINE_VERSION,
        owner_email=auth_email,
        formula_pack_version=CURRENT_FORMULA_PACK_VERSION,
        metric_definitions=metric_definitions,
    )
    response["calculationSnapshot"] = {
        "runId": snapshot["run_id"],
        "snapshotId": snapshot["snapshot_id"],
        "engineVersion": snapshot["engine_version"],
        "formulaPackVersion": snapshot["formula_pack_version"],
        "metricDefinitionsVersion": snapshot["metric_definitions_version"],
        "inputHash": snapshot["input_hash"],
        "outputHash": snapshot["output_hash"],
        "frozenAtMs": snapshot["frozen_at_ms"],
    }
    return response


@app.get("/api/option-chain/{ticker}", response_model=OptionChainLiquidityResponse)
def option_chain_liquidity(
    ticker: str,
    expiry: Optional[str] = Query(default=None),
    force_refresh: bool = Query(default=False),
    auth_email: str = Depends(require_access_email),
):
    """
    Return option chain rows for the liquidity checker page.
    Expiry defaults to the nearest available date; pass ?expiry=YYYY-MM-DD to select.
    """
    t = ticker.upper().strip()
    if not t:
        raise HTTPException(status_code=400, detail="Ticker required")

    opt_dates = _bc_opt_dates(t, force_refresh=force_refresh)
    if not opt_dates and not force_refresh:
        opt_dates = _bc_opt_dates(t, force_refresh=True)
    if not opt_dates:
        raise HTTPException(status_code=404, detail=f"No options data for {t}")

    # Current price
    current_price = 0.0
    price_source = "yahoo_info"
    try:
        quotes, _quote_meta = _get_quotes([t], force_refresh=force_refresh)
        quote = quotes.get(t)
        if quote and quote.price > 0:
            current_price = float(quote.price)
            price_source = quote.source
    except Exception:
        pass
    try:
        info = _bc_info(t, force_refresh=force_refresh)
        if current_price <= 0:
            current_price = float(
                info.get("currentPrice") or info.get("regularMarketPrice") or
                info.get("previousClose") or 0
            )
    except Exception:
        pass

    # Select expiry
    exp = (expiry or "").strip()[:10]
    target_expiry = exp if exp in opt_dates else opt_dates[0]

    chain_errors: list[str] = []
    calls_df = pd.DataFrame()
    puts_df = pd.DataFrame()
    candidate_expiries = [target_expiry] + [d for d in opt_dates[:8] if d != target_expiry]
    for idx, candidate in enumerate(candidate_expiries):
        try:
            calls_df, puts_df = _bc_chain(t, candidate, force_refresh=force_refresh or idx > 0)
            if (calls_df is not None and not calls_df.empty) or (puts_df is not None and not puts_df.empty):
                target_expiry = candidate
                break
        except Exception as e:
            chain_errors.append(f"{candidate}: {e}")
    else:
        if not force_refresh:
            for candidate in candidate_expiries[:4]:
                try:
                    calls_df, puts_df = _bc_chain(t, candidate, force_refresh=True)
                    if (calls_df is not None and not calls_df.empty) or (puts_df is not None and not puts_df.empty):
                        target_expiry = candidate
                        break
                except Exception as e:
                    chain_errors.append(f"{candidate}: {e}")

    if (calls_df is None or calls_df.empty) and (puts_df is None or puts_df.empty):
        detail = f"No option chain rows for {t}"
        if chain_errors:
            detail += f" ({'; '.join(chain_errors[:2])})"
        raise HTTPException(status_code=404, detail=detail)

    def _process(df: pd.DataFrame) -> list:
        if df is None or df.empty:
            return []
        rows = []
        for _, row in df.iterrows():
            strike = safe_float(row.get("strike", 0))
            if strike <= 0:
                continue
            bid  = safe_float(row.get("bid", 0))
            ask  = safe_float(row.get("ask", 0))
            last = safe_float(row.get("lastPrice", 0))
            vol  = safe_int(row.get("volume", 0))
            oi   = safe_int(row.get("openInterest", 0))
            iv   = safe_float(row.get("impliedVolatility", 0))
            itm  = bool(row.get("inTheMoney", False))

            if bid > 0 and ask > 0:
                mid    = (bid + ask) / 2.0
                spread = ask - bid
            elif last > 0:
                mid    = last
                spread = last * 0.05
                bid    = round(last * 0.975, 2)
                ask    = round(last * 1.025, 2)
            else:
                continue

            spread_pct = (spread / mid * 100) if mid > 0 else 999.0
            rows.append({
                "strike":       round(strike, 2),
                "bid":          round(bid, 2),
                "ask":          round(ask, 2),
                "mid":          round(mid, 2),
                "spread":       round(spread, 2),
                "spread_pct":   round(spread_pct, 1),
                "volume":       vol,
                "open_interest": oi,
                "iv":           round(iv * 100, 1),
                "in_the_money": itm,
                "is_atm":       False,
            })

        # Mark the single ATM strike
        if rows and current_price > 0:
            atm = min(rows, key=lambda r: abs(r["strike"] - current_price))
            atm["is_atm"] = True

        return rows

    # DTE for selected expiry
    dte_val: Optional[int] = None
    try:
        from datetime import date as _date
        exp_dt  = datetime.strptime(target_expiry, "%Y-%m-%d").date()
        dte_val = max(0, (exp_dt - _date.today()).days)
    except Exception:
        pass

    calls_rows = _process(calls_df)
    puts_rows = _process(puts_df)
    chain_ivs = [r["iv"] for r in calls_rows + puts_rows if safe_float(r.get("iv", 0)) > 0]
    current_iv = round(float(pd.Series(chain_ivs).median()), 2) if chain_ivs else None
    historical_volatility = None
    iv_rank = None
    iv_percentile = None
    try:
        hist = bar_cache.get_history(t, period="1y", interval="1d", auto_adjust=True, force_refresh=force_refresh)
        if hist is not None and not hist.empty and "Close" in hist:
            close = hist["Close"].dropna()
            if len(close) >= 25:
                hv_series = build_hv_series(close, window=20)
                hv_clean = hv_series.dropna()
                if not hv_clean.empty:
                    historical_volatility = round(float(hv_clean.iloc[-1]), 2)
                    iv_ref = current_iv if current_iv is not None else historical_volatility
                    if iv_ref is not None:
                        iv_rank = round(float(compute_iv_rank(hv_clean, iv_ref)), 2)
                        iv_percentile = round(float((hv_clean <= iv_ref).mean() * 100.0), 2)
    except Exception:
        pass

    return {
        "ticker":          t,
        "current_price":   round(current_price, 2),
        "price_source":    price_source,
        "price_fetched_at": datetime.now(timezone.utc).isoformat(),
        "expiries":        list(opt_dates[:12]),
        "selected_expiry": target_expiry,
        "dte":             dte_val,
        "iv_rank":         iv_rank,
        "iv_percentile":   iv_percentile,
        "historical_volatility": historical_volatility,
        "current_iv":      current_iv,
        "calls":           calls_rows,
        "puts":            puts_rows,
    }


@app.get("/api/v1/metric-definitions", response_model=MetricDefinitionsResponse)
def metric_definitions(auth_email: str = Depends(require_access_email)):
    return {
        "formulaPackVersion": CURRENT_FORMULA_PACK_VERSION,
        "metricDefinitionsVersion": CURRENT_METRIC_DEFINITIONS_VERSION,
        "metrics": list_metric_definitions(),
    }


@app.get("/api/v1/calculation-run-types", response_model=CalculationRunTypesResponse)
def calculation_run_types(auth_email: str = Depends(require_access_email)):
    run_types = list_supported_calculation_run_types()
    return {"routerVersion": CALCULATION_ROUTER_VERSION, "runTypes": run_types, "count": len(run_types)}


@app.post("/api/v1/calculation-runs", response_model=CalculationRunCreateResponse)
def create_calculation_run_v1(request: CalculationRunCreateRequest, auth_email: str = Depends(require_access_email)):
    run_type = request.runType.strip().lower()
    if run_type not in {"trade_worksheet", "day_trade_workspace"}:
        detail = f"Unsupported calculation run type: {request.runType}"
        create_failed_calculation_run(
            run_type=run_type or "unknown",
            input_payload=request.input,
            error=detail,
            engine_version=CALCULATION_ROUTER_VERSION,
            owner_email=auth_email,
        )
        raise HTTPException(status_code=400, detail=detail)

    if run_type == "day_trade_workspace":
        input_payload = dict(request.input or {})
        symbol = str(input_payload.get("symbol") or input_payload.get("ticker") or "").strip().upper()
        interval = str(input_payload.get("interval") or "1m").strip()
        session_date = input_payload.get("sessionDate") or input_payload.get("session_date")
        force_refresh = bool(input_payload.get("forceRefresh") or input_payload.get("force_refresh") or False)
        if not symbol:
            detail = "Invalid day_trade_workspace input: symbol is required"
            create_failed_calculation_run(
                run_type="day_trade_workspace",
                input_payload=input_payload,
                error=detail,
                engine_version=DAY_TRADE_WORKSPACE_ENGINE_VERSION,
                owner_email=auth_email,
            )
            raise HTTPException(status_code=422, detail=detail)
        if interval not in {"1m", "5m", "15m", "1h"}:
            detail = "Invalid day_trade_workspace input: interval must be 1m, 5m, 15m, or 1h"
            create_failed_calculation_run(
                run_type="day_trade_workspace",
                input_payload=input_payload,
                error=detail,
                engine_version=DAY_TRADE_WORKSPACE_ENGINE_VERSION,
                owner_email=auth_email,
            )
            raise HTTPException(status_code=422, detail=detail)
        try:
            result = _build_day_trade_workspace_payload(
                symbol=symbol,
                session_date=str(session_date).strip() if session_date else None,
                interval=interval,
                force_refresh=force_refresh,
            )
        except Exception as exc:
            detail = f"Unable to build Day Trade workspace: {exc}"
            create_failed_calculation_run(
                run_type="day_trade_workspace",
                input_payload=input_payload,
                error=detail,
                engine_version=DAY_TRADE_WORKSPACE_ENGINE_VERSION,
                owner_email=auth_email,
            )
            raise HTTPException(status_code=502, detail=detail) from exc

        metric_definitions = day_trade_workspace_metric_definitions()
        snapshot = create_calculation_snapshot(
            run_type="day_trade_workspace",
            input_payload={
                "symbol": symbol,
                "sessionDate": str(session_date).strip() if session_date else None,
                "interval": interval,
                "forceRefresh": force_refresh,
            },
            output_payload=result,
            engine_version=DAY_TRADE_WORKSPACE_ENGINE_VERSION,
            owner_email=auth_email,
            formula_pack_version=CURRENT_FORMULA_PACK_VERSION,
            metric_definitions=metric_definitions,
        )
        result = {
            **result,
            "calculationSnapshot": {
                "runId": snapshot["run_id"],
                "snapshotId": snapshot["snapshot_id"],
                "engineVersion": snapshot["engine_version"],
                "formulaPackVersion": snapshot["formula_pack_version"],
                "metricDefinitionsVersion": snapshot["metric_definitions_version"],
                "inputHash": snapshot["input_hash"],
                "outputHash": snapshot["output_hash"],
                "frozenAtMs": snapshot["frozen_at_ms"],
            },
        }
        run = snapshot
        from calculation_vault import get_calculation_run, get_calculation_snapshot

        run_row = get_calculation_run(snapshot["run_id"], owner_email=auth_email)
        snapshot_row = get_calculation_snapshot(snapshot["snapshot_id"], owner_email=auth_email)
        if run_row is None or snapshot_row is None:
            raise HTTPException(status_code=500, detail="Calculation snapshot was not created")
        return {"run": run_row, "snapshot": snapshot_row, "result": result}

    try:
        worksheet_request = TradeWorksheetEvaluateRequest(**request.input)
    except Exception as exc:
        detail = f"Invalid trade worksheet input: {exc}"
        create_failed_calculation_run(
            run_type="trade_worksheet",
            input_payload=request.input,
            error=detail,
            engine_version=TRADE_WORKSHEET_ENGINE_VERSION,
            owner_email=auth_email,
        )
        raise HTTPException(status_code=422, detail=detail) from exc

    result = trade_worksheet_evaluate(worksheet_request, auth_email=auth_email)
    snapshot_meta = result.get("calculationSnapshot") or {}
    run_id = str(snapshot_meta.get("runId") or "")
    snapshot_id = str(snapshot_meta.get("snapshotId") or "")
    from calculation_vault import get_calculation_run, get_calculation_snapshot

    run = get_calculation_run(run_id, owner_email=auth_email) if run_id else None
    snapshot = get_calculation_snapshot(snapshot_id, owner_email=auth_email) if snapshot_id else None
    if run is None or snapshot is None:
        raise HTTPException(status_code=500, detail="Calculation snapshot was not created")
    return {"run": run, "snapshot": snapshot, "result": result}


@app.get("/api/v1/calculation-runs", response_model=CalculationRunsListResponse)
def calculation_runs(
    status: Optional[str] = Query(default=None),
    run_type: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    auth_email: str = Depends(require_access_email),
):
    from calculation_vault import list_calculation_runs

    status_value = status if isinstance(status, str) and status.strip() else None
    run_type_value = run_type if isinstance(run_type, str) and run_type.strip() else None
    limit_value = limit if isinstance(limit, int) else 50
    runs = list_calculation_runs(
        owner_email=auth_email,
        status=status_value,
        run_type=run_type_value,
        limit=limit_value,
    )
    return {"runs": runs, "count": len(runs)}


@app.get("/api/v1/calculation-runs/{run_id}", response_model=CalculationRunResponse)
def calculation_run(run_id: str, auth_email: str = Depends(require_access_email)):
    from calculation_vault import get_calculation_run

    row = get_calculation_run(run_id, owner_email=auth_email)
    if row is None:
        raise HTTPException(status_code=404, detail="Calculation run not found")
    return row


@app.get("/api/v1/calculation-snapshots/{snapshot_id}", response_model=CalculationSnapshotResponse)
def calculation_snapshot(snapshot_id: str, auth_email: str = Depends(require_access_email)):
    from calculation_vault import get_calculation_snapshot

    row = get_calculation_snapshot(snapshot_id, owner_email=auth_email)
    if row is None:
        raise HTTPException(status_code=404, detail="Calculation snapshot not found")
    return row


@app.get("/api/v1/calculation-snapshots/{snapshot_id}/integrity", response_model=CalculationSnapshotIntegrityResponse)
def calculation_snapshot_integrity(snapshot_id: str, auth_email: str = Depends(require_access_email)):
    from calculation_vault import verify_calculation_snapshot

    row = verify_calculation_snapshot(snapshot_id, owner_email=auth_email)
    if row is None:
        raise HTTPException(status_code=404, detail="Calculation snapshot not found")
    return row


@app.get("/api/v1/calculation-snapshots/{snapshot_id}/audit-log", response_model=CalculationSnapshotAuditLogResponse)
def calculation_snapshot_audit_log(snapshot_id: str, auth_email: str = Depends(require_access_email)):
    from calculation_vault import list_calculation_snapshot_audit_log

    rows = list_calculation_snapshot_audit_log(snapshot_id, owner_email=auth_email)
    if rows is None:
        raise HTTPException(status_code=404, detail="Calculation snapshot not found")
    return {"snapshot_id": snapshot_id, "events": rows, "count": len(rows)}


@app.post("/api/backtest")
def backtest_strategy(request: BacktestRequest):
    return _run_backtest_endpoint(request)


# Alias for nginx configs that strip the /api prefix (proxy_pass .../ without /api).
@app.post("/backtest")
def backtest_strategy_proxy_alias(request: BacktestRequest):
    return _run_backtest_endpoint(request)


# ── Historical 1m bars for day trade backtest playback ────────────────────
from bar_cache import get_history

@app.get("/api/history-bars")
def get_history_bars(
    ticker: str = Query(..., min_length=1),
    date: str = Query(..., regex=r"^\d{4}-\d{2}-\d{2}$"),
    auth_email: str = Depends(require_access_email),
):
    """Return 1-minute OHLCV bars for a ticker on a single date."""
    import pandas as pd
    from datetime import datetime, timezone
    t = ticker.strip().upper()
    df = get_history(t, interval="1m", start=date, end=date)
    if df is None or df.empty:
        raise HTTPException(status_code=404, detail=f"No data for {t} on {date}")
    # Ensure tz-aware index
    if df.index.tz is None:
        df.index = df.index.tz_localize("America/New_York")
    df.index = df.index.tz_convert("UTC")
    bars = []
    for ts, row in df.iterrows():
        bars.append({
            "t": pd.Timestamp(ts).isoformat(),
            "o": round(float(row["Open"]), 4),
            "h": round(float(row["High"]), 4),
            "l": round(float(row["Low"]), 4),
            "c": round(float(row["Close"]), 4),
            "v": round(float(row["Volume"]), 4),
        })
    return {"ticker": t, "date": date, "bars": bars}


class JournalHistoryScenarioCheck(BaseModel):
    entry: Optional[float] = None
    stop: Optional[float] = None
    t1: Optional[float] = None
    t2: Optional[float] = None
    prob: Optional[float] = None


class JournalHistoryMorningRow(BaseModel):
    id: str = ""
    date: Optional[str] = None
    mode: str = "day"
    ticker: str
    bias: Optional[str] = None
    close: Optional[float] = None
    bull: Optional[JournalHistoryScenarioCheck] = None
    bear: Optional[JournalHistoryScenarioCheck] = None


class JournalHistoryMorningRequest(BaseModel):
    rows: list[JournalHistoryMorningRow] = Field(default_factory=list)
    evaluation_date: Optional[str] = None


_JOURNAL_PT_ZONE = ZoneInfo("America/Los_Angeles")
_JOURNAL_MORNING_CUTOFFS = (("07:00", dt_time(7, 0)), ("07:30", dt_time(7, 30)))


def _journal_number(value: Any) -> Optional[float]:
    try:
        if value is None:
            return None
        n = float(value)
        if not np.isfinite(n) or n <= 0:
            return None
        return n
    except Exception:
        return None


def _journal_round(value: Any, digits: int = 2) -> Optional[float]:
    try:
        n = float(value)
        if not np.isfinite(n):
            return None
        return round(n, digits)
    except Exception:
        return None


def _journal_prepare_intraday(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame()
    out = df.copy()
    if out.index.tz is None:
        out.index = out.index.tz_localize("America/New_York")
    out.index = out.index.tz_convert(_JOURNAL_PT_ZONE)
    out = out.sort_index()
    required = {"Open", "High", "Low", "Close"}
    if not required.issubset(set(map(str, out.columns))):
        return pd.DataFrame()
    return out.dropna(subset=["Open", "High", "Low", "Close"])


def _journal_fetch_eval_bars(ticker: str, evaluation_date: str) -> pd.DataFrame:
    start = evaluation_date
    end = (datetime.strptime(evaluation_date, "%Y-%m-%d").date() + timedelta(days=1)).isoformat()
    return _journal_prepare_intraday(get_history(ticker, interval="1m", start=start, end=end))


def _journal_bars_until_cutoff(df: pd.DataFrame, evaluation_date: str, cutoff: dt_time) -> pd.DataFrame:
    if df.empty:
        return pd.DataFrame()
    start = datetime.combine(datetime.strptime(evaluation_date, "%Y-%m-%d").date(), dt_time(6, 30), _JOURNAL_PT_ZONE)
    end = datetime.combine(datetime.strptime(evaluation_date, "%Y-%m-%d").date(), cutoff, _JOURNAL_PT_ZONE)
    return df[(df.index >= start) & (df.index <= end)]


def _journal_outcome_label(status: str) -> str:
    return {
        "T2_HIT": "T2 hit",
        "T1_HIT": "T1 hit",
        "TRIGGERED_OPEN": "Triggered, open",
        "NOT_TRIGGERED": "Not triggered",
        "STOPPED": "Stopped",
        "MISSING_PLAN": "Missing plan",
        "NO_INTRADAY_DATA": "No bars",
    }.get(status, status.replace("_", " ").title())


def _journal_evaluate_plan(bars: pd.DataFrame, scenario: Optional[JournalHistoryScenarioCheck], side: str) -> dict:
    plan = scenario.model_dump() if scenario is not None and hasattr(scenario, "model_dump") else (
        scenario.dict() if scenario is not None else {}
    )
    entry = _journal_number(plan.get("entry"))
    stop = _journal_number(plan.get("stop"))
    t1 = _journal_number(plan.get("t1"))
    t2 = _journal_number(plan.get("t2"))
    if entry is None or stop is None or t1 is None:
        return {"status": "MISSING_PLAN", "display": _journal_outcome_label("MISSING_PLAN"), "triggered": False}
    if bars.empty:
        return {"status": "NO_INTRADAY_DATA", "display": _journal_outcome_label("NO_INTRADAY_DATA"), "triggered": False}

    triggered = False
    trigger_time = None
    status = "NOT_TRIGGERED"
    status_time = None
    last_close = _journal_round(bars.iloc[-1]["Close"])

    for ts, row in bars.iterrows():
        high = float(row["High"])
        low = float(row["Low"])
        if not triggered:
            if side == "bull" and high >= entry:
                triggered = True
                trigger_time = ts
            elif side == "bear" and low <= entry:
                triggered = True
                trigger_time = ts
            else:
                continue

        # Conservative same-bar ordering: risk is counted before reward.
        if side == "bull":
            if low <= stop:
                status, status_time = "STOPPED", ts
                break
            if t2 is not None and high >= t2:
                status, status_time = "T2_HIT", ts
                break
            if high >= t1 and status != "T1_HIT":
                status, status_time = "T1_HIT", ts
        else:
            if high >= stop:
                status, status_time = "STOPPED", ts
                break
            if t2 is not None and low <= t2:
                status, status_time = "T2_HIT", ts
                break
            if low <= t1 and status != "T1_HIT":
                status, status_time = "T1_HIT", ts

    if triggered and status == "NOT_TRIGGERED":
        status = "TRIGGERED_OPEN"
    move_pct = None
    if last_close is not None:
        raw_move = (last_close - entry) / entry * 100
        move_pct = raw_move if side == "bull" else -raw_move
    return {
        "status": status,
        "display": _journal_outcome_label(status),
        "triggered": triggered,
        "trigger_time": trigger_time.isoformat() if trigger_time is not None else None,
        "status_time": status_time.isoformat() if status_time is not None else None,
        "entry": _journal_round(entry),
        "stop": _journal_round(stop),
        "t1": _journal_round(t1),
        "t2": _journal_round(t2),
        "probability": _journal_round(plan.get("prob"), 0),
        "move_from_entry_pct": _journal_round(move_pct, 2),
    }


def _journal_best_takeaway(bull: dict, bear: dict) -> dict:
    rank = {
        "T2_HIT": 5,
        "T1_HIT": 4,
        "TRIGGERED_OPEN": 3,
        "NOT_TRIGGERED": 2,
        "MISSING_PLAN": 1,
        "NO_INTRADAY_DATA": 1,
        "STOPPED": 0,
    }
    bull_rank = rank.get(bull.get("status"), 0)
    bear_rank = rank.get(bear.get("status"), 0)
    if bull.get("status") == "NO_INTRADAY_DATA" or bear.get("status") == "NO_INTRADAY_DATA":
        return {"side": "none", "label": "No morning bars available yet.", "tone": "neutral"}
    if bull_rank == bear_rank and bull.get("status") == "NOT_TRIGGERED":
        return {"side": "flat", "label": "No entry before this cutoff. Patience worked.", "tone": "neutral"}
    if bull_rank > bear_rank:
        return {"side": "bull", "label": f"Bull plan led: {bull.get('display')}.", "tone": "bull"}
    if bear_rank > bull_rank:
        return {"side": "bear", "label": f"Bear plan led: {bear.get('display')}.", "tone": "bear"}
    return {"side": "mixed", "label": "Mixed result. Wait for cleaner confirmation.", "tone": "neutral"}


def _journal_history_probs(bias: str) -> dict[str, int]:
    b = str(bias or "").strip().lower()
    if b in {"bull", "bullish", "long"}:
        return {"bull": 50, "bear": 20, "flat": 30}
    if b in {"bear", "bearish", "short"}:
        return {"bull": 20, "bear": 50, "flat": 30}
    return {"bull": 30, "bear": 30, "flat": 40}


def _journal_float_optional(value: Any) -> Optional[float]:
    try:
        if value is None:
            return None
        n = float(value)
        if not np.isfinite(n):
            return None
        return round(n, 4)
    except Exception:
        return None


def _build_day_trade_next_day_history_record(scan: Any, *, date_key: str, generated_at_ms: int) -> dict[str, Any]:
    ticker = str(getattr(scan, "ticker", "") or "").strip().upper()
    metrics = getattr(scan, "metrics", {}) or {}
    bias_raw = str(getattr(scan, "bias", "") or "").strip().lower()
    bias = "bull" if bias_raw in {"long", "bull", "bullish"} else "bear" if bias_raw in {"short", "bear", "bearish"} else "neutral"

    close = _journal_float_optional(metrics.get("last_price") or metrics.get("current_price") or metrics.get("close"))
    or_high = _journal_float_optional(metrics.get("or_high") or metrics.get("opening_range_high"))
    or_low = _journal_float_optional(metrics.get("or_low") or metrics.get("opening_range_low"))
    vwap = _journal_float_optional(metrics.get("vwap"))
    or_mid = _journal_float_optional(metrics.get("or_mid"))
    if or_mid is None and or_high is not None and or_low is not None:
        or_mid = round((or_high + or_low) / 2.0, 4)

    p = _journal_history_probs(bias)
    pad_high = max((or_high or 0) * 0.0005, 0.05) if or_high else 0.05
    pad_low = max((or_low or 0) * 0.0005, 0.05) if or_low else 0.05
    bull_entry = round((or_high or close or 0) + pad_high, 4) if (or_high or close) else None
    bull_stop = or_mid
    bear_entry = round((or_low or close or 0) - pad_low, 4) if (or_low or close) else None
    bear_stop = or_mid
    bull_r = (bull_entry - bull_stop) if bull_entry is not None and bull_stop is not None else None
    bear_r = (bear_stop - bear_entry) if bear_entry is not None and bear_stop is not None else None

    record = {
        "id": f"day|{date_key}|{ticker}",
        "date": date_key,
        "mode": "day",
        "ticker": ticker,
        "bias": bias,
        "close": close,
        "levels": {"orHigh": or_high, "orLow": or_low, "orMid": or_mid, "vwap": vwap},
        "bull": {
            "entry": bull_entry,
            "stop": bull_stop,
            "t1": round(bull_entry + bull_r, 4) if bull_entry is not None and bull_r is not None else None,
            "t2": round(bull_entry + 2 * bull_r, 4) if bull_entry is not None and bull_r is not None else None,
            "rr": "1 : 2",
            "prob": p["bull"],
        },
        "bear": {
            "entry": bear_entry,
            "stop": bear_stop,
            "t1": round(bear_entry - bear_r, 4) if bear_entry is not None and bear_r is not None else None,
            "t2": round(bear_entry - 2 * bear_r, 4) if bear_entry is not None and bear_r is not None else None,
            "rr": "1 : 2",
            "prob": p["bear"],
        },
        "flat": {"prob": p["flat"]},
        "savedAt": generated_at_ms,
        "source": "auto_eod",
    }
    return {
        "kind": "next_day_plan",
        "schema_version": 1,
        "generated_by": "day_trade_eod_history_job",
        "generated_at_ms": generated_at_ms,
        "record": record,
        "engine": {
            "verdict": str(getattr(scan, "verdict", "") or ""),
            "final_decision": str(getattr(scan, "final_decision", "") or ""),
            "bull_score": _journal_float_optional(getattr(scan, "bull_score", None)),
            "bear_score": _journal_float_optional(getattr(scan, "bear_score", None)),
            "session_date": str(metrics.get("session_date") or date_key)[:10],
        },
    }


def _save_day_trade_next_day_history_for_state(user_state: dict[str, Any], *, force_refresh: bool = False) -> dict[str, Any]:
    email = normalize_email(str(user_state.get("email") or ""))
    if not email:
        return {"email": "", "saved": 0, "failed": 0, "tickers": []}
    tickers = _day_trade_tickers_from_user_state(user_state)
    if not tickers:
        return {"email": email, "saved": 0, "failed": 0, "tickers": []}

    now_pt = datetime.now(ZoneInfo("America/Los_Angeles"))
    date_key = now_pt.date().isoformat()
    generated_at_ms = int(time.time() * 1000)
    saved = 0
    failed = 0
    saved_tickers: list[str] = []
    for idx, ticker in enumerate(tickers):
        if idx:
            time.sleep(0.4)
        try:
            scan = run_day_trade_scan(ticker, force_refresh=force_refresh)
            snapshot = _build_day_trade_next_day_history_record(scan, date_key=date_key, generated_at_ms=generated_at_ms)
            record = snapshot.get("record") or {}
            if not record.get("ticker"):
                raise ValueError("Missing ticker in generated record")
            upsert_eod_journal_snapshot(
                email,
                "day",
                date_key,
                str(record["ticker"]),
                snapshot,
                notes={"auto": True, "description": "Auto-generated after market close for tomorrow's day-trade plan."},
                checks={},
            )
            saved += 1
            saved_tickers.append(str(record["ticker"]))
        except Exception as exc:
            failed += 1
            print(f"[day-eod-history] {email} {ticker} failed: {exc}", flush=True)
    return {"email": email, "saved": saved, "failed": failed, "tickers": saved_tickers}


@app.post("/api/journal/history-morning-check")
def journal_history_morning_check(
    request: JournalHistoryMorningRequest,
    auth_email: str = Depends(require_access_email),
):
    """Compare saved journal history plans with today's 7:00 and 7:30 AM PT price path."""
    eval_date = request.evaluation_date or datetime.now(_JOURNAL_PT_ZONE).date().isoformat()
    try:
        datetime.strptime(eval_date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="evaluation_date must be YYYY-MM-DD")

    rows = request.rows[:80]
    tickers = sorted({r.ticker.strip().upper() for r in rows if r.ticker and r.ticker.strip()})[:40]
    bars_by_ticker = {ticker: _journal_fetch_eval_bars(ticker, eval_date) for ticker in tickers}

    out_rows = []
    for row in rows:
        ticker = row.ticker.strip().upper()
        df = bars_by_ticker.get(ticker, pd.DataFrame())
        snapshots = []
        for label, cutoff in _JOURNAL_MORNING_CUTOFFS:
            sample = _journal_bars_until_cutoff(df, eval_date, cutoff)
            price = _journal_round(sample.iloc[-1]["Close"]) if not sample.empty else None
            price_time = sample.index[-1].isoformat() if not sample.empty else None
            bull = _journal_evaluate_plan(sample, row.bull, "bull")
            bear = _journal_evaluate_plan(sample, row.bear, "bear")
            snapshots.append({
                "time": label,
                "price": price,
                "price_time": price_time,
                "bull": bull,
                "bear": bear,
                "takeaway": _journal_best_takeaway(bull, bear),
            })
        out_rows.append({
            "id": row.id,
            "saved_date": row.date,
            "mode": row.mode,
            "ticker": ticker,
            "saved_bias": row.bias or "",
            "saved_close": _journal_round(row.close),
            "evaluation_date": eval_date,
            "snapshots": snapshots,
        })

    return {
        "evaluation_date": eval_date,
        "timezone": "America/Los_Angeles",
        "cutoffs": [label for label, _ in _JOURNAL_MORNING_CUTOFFS],
        "row_count": len(out_rows),
        "rows": out_rows,
    }


@app.get("/api/journal/history-log")
def journal_history_log(
    mode: str = "day",
    limit: int = Query(300, ge=1, le=1000),
    auth_email: str = Depends(require_access_email),
):
    """Return backend-generated Journal Tool history rows for the authenticated user."""
    m = mode.strip().lower()
    rows = list_eod_journal_snapshots(
        normalize_email(auth_email),
        m,
        limit=limit,
        kind="next_day_plan",
    )
    records = []
    for row in rows:
        snapshot = row.get("snapshot") or {}
        record = snapshot.get("record") if isinstance(snapshot, dict) else None
        if isinstance(record, dict):
            records.append(record)
    return {"mode": m, "rows": records, "count": len(records)}


@app.post("/api/journal/history-log/auto-generate")
def journal_history_log_auto_generate(auth_email: str = Depends(require_access_email)):
    """Generate today's next-day day-trade history rows for the authenticated user's day tickers."""
    state = get_user_state(normalize_email(auth_email))
    result = _save_day_trade_next_day_history_for_state(state, force_refresh=True)
    return {"ok": True, "result": result}


# ── TRADE JOURNAL ──────────────────────────────────────────────────────────────

from storage import (
    init_journal_db, save_journal_entry, get_journal_entries,
    get_journal_entry, update_journal_entry, delete_journal_entry,
    init_trade_ideas_db, save_trade_idea, get_trade_ideas,
    update_trade_idea, delete_trade_idea,
)
from pydantic import BaseModel as _BM

init_journal_db()
init_trade_ideas_db()

from storage import init_tradedesk_db as _init_tradedesk_db
_init_tradedesk_db()


class JournalSaveRequest(_BM):
    ticker: str
    company_name: str = ""
    strategy: str
    bias: str = ""
    legs: list[dict] = []
    expiry: str
    entry_date: str
    dte_at_entry: int = 0
    net_credit: float = 0.0
    max_profit: float = 0.0
    max_loss: float = 0.0
    underlying_entry: float = 0.0
    prob_of_profit: float = 0.0
    expected_value: float = 0.0
    total_score: int = 0
    notes: str = ""
    trade_type: str = "regular"
    engine_signal: str = ""
    engine_state: int = 0


class JournalCloseRequest(_BM):
    exit_reason: str = "MANUAL"
    notes: str = ""


class JournalNotesRequest(_BM):
    notes: str


class JournalUpdateRequest(_BM):
    strategy: Optional[str] = None
    bias: Optional[str] = None
    underlying_entry: Optional[float] = None
    expiry: Optional[str] = None
    entry_date: Optional[str] = None
    net_credit: Optional[float] = None
    max_profit: Optional[float] = None
    max_loss: Optional[float] = None
    prob_of_profit: Optional[float] = None
    expected_value: Optional[float] = None
    total_score: Optional[int] = None
    company_name: Optional[str] = None
    notes: Optional[str] = None
    trade_type: Optional[str] = None
    engine_signal: Optional[str] = None
    engine_state: Optional[int] = None
    legs: Optional[list[dict]] = None


class EodJournalSnapshotRequest(_BM):
    mode: str = "swing"
    date: str
    ticker: str
    snapshot: dict[str, Any] = {}
    notes: dict[str, Any] = {}
    checks: dict[str, Any] = {}


def _earnings_date_for_ticker(ticker: str, asof: datetime) -> tuple[Optional[str], Optional[int]]:
    try:
        cal = bar_cache.get_calendar(ticker)
        if not isinstance(cal, dict):
            return None, None
        raw = cal.get("Earnings Date") or cal.get("Earnings Timestamp")
        if isinstance(raw, (list, tuple)):
            raw = raw[0] if raw else None
        if raw is None:
            return None, None
        if isinstance(raw, pd.Timestamp):
            ed = raw.date()
        elif isinstance(raw, datetime):
            ed = raw.date()
        elif hasattr(raw, "date") and callable(raw.date):
            ed = raw.date()
        else:
            ed = pd.Timestamp(raw).date()
        days = (ed - asof.date()).days
        if days < 0:
            return ed.isoformat(), None
        return ed.isoformat(), int(days)
    except Exception:
        return None, None


def _enrich_swing_eod_snapshot(ticker: str, snapshot: dict[str, Any]) -> dict[str, Any]:
    """Enforce evening swing-list gates before saving the EOD snapshot."""
    out = dict(snapshot or {})
    analysis = out.get("analysis") if isinstance(out.get("analysis"), dict) else out
    if not isinstance(analysis, dict):
        return out

    t = ticker.strip().upper()

    def _f(value: object) -> Optional[float]:
        try:
            if value is None:
                return None
            v = float(value)
            return v if np.isfinite(v) else None
        except (TypeError, ValueError):
            return None

    hist = _bc_hist(t, period="3mo", interval="1d", auto_adjust=True)
    close = _f(analysis.get("close"))
    prev_close = _f(analysis.get("prevClose"))
    ma20 = _f(analysis.get("ma20"))
    ma20_slope = str(analysis.get("ma20Slope") or "").lower().strip()

    if hist is not None and not hist.empty and "Close" in hist:
        closes = pd.to_numeric(hist["Close"], errors="coerce").dropna()
        if len(closes) >= 20:
            ma20_series = closes.rolling(20).mean().dropna()
            if close is None:
                close = float(closes.iloc[-1])
            if prev_close is None and len(closes) >= 2:
                prev_close = float(closes.iloc[-2])
            if ma20 is None and not ma20_series.empty:
                ma20 = float(ma20_series.iloc[-1])
            if not ma20_slope and len(ma20_series) >= 6:
                ma20_slope = "rising" if float(ma20_series.iloc[-1]) > float(ma20_series.iloc[-6]) else "falling"

    if ma20_slope not in {"rising", "falling"}:
        ma20_slope = "rising" if (close or 0) >= (ma20 or close or 0) else "falling"

    dist_ma20 = ((close - ma20) / ma20 * 100.0) if close is not None and ma20 not in (None, 0) else None
    prior_move = ((close - prev_close) / prev_close * 100.0) if close is not None and prev_close not in (None, 0) else None

    original_bias = str(analysis.get("bias") or "neutral").lower().strip()
    gated_bias = original_bias
    gate_reasons: list[str] = []
    directional_expired = False
    calendar_spreads_only = False

    earnings_date, earnings_days = _earnings_date_for_ticker(t, datetime.now(ZoneInfo("America/New_York")))
    bias_expiry_date = None
    if earnings_date:
        try:
            bias_expiry_date = (pd.Timestamp(earnings_date) - pd.Timedelta(days=7)).date().isoformat()
        except Exception:
            bias_expiry_date = None

    if earnings_days is not None and earnings_days <= 7:
        gated_bias = "EXPIRED"
        directional_expired = True
        calendar_spreads_only = True
        gate_reasons.append("Within 7 days of earnings — directional bias expired; calendar spreads only.")
    elif prior_move is not None and prior_move <= -8:
        gated_bias = "NEUTRAL_BOUNCE"
        gate_reasons.append("Prior day move <= -8% — never save fresh BEAR; wait for bounce confirmation.")
    elif prior_move is not None and prior_move >= 8:
        gated_bias = "NEUTRAL_FADE"
        gate_reasons.append("Prior day move >= +8% — never save fresh BULL; wait for fade/retest.")
    elif dist_ma20 is not None and abs(dist_ma20) > 8:
        gated_bias = "NO_ENTRY"
        gate_reasons.append("|% from MA20| > 8% — extended; wait for mean reversion.")
    elif original_bias == "bear" and not (close is not None and ma20 is not None and close < ma20 and ma20_slope == "falling"):
        gated_bias = "neutral"
        gate_reasons.append("BEAR requires price below MA20 and MA20 falling.")
    elif original_bias == "bull" and not (close is not None and ma20 is not None and close > ma20 and ma20_slope == "rising"):
        gated_bias = "neutral"
        gate_reasons.append("BULL requires price above MA20 and MA20 rising.")

    flip_conditions: list[str]
    if gated_bias in {"neutral", "NEUTRAL_BOUNCE", "NEUTRAL_FADE", "NO_ENTRY", "EXPIRED"}:
        bull_level = ma20 if ma20 is not None else close
        bear_level = ma20 if ma20 is not None else close
        flip_conditions = [
            f"Daily close > ${bull_level:.2f} with MA20 rising -> BULL" if bull_level else "Daily close above MA20 with MA20 rising -> BULL",
            f"Daily close < ${bear_level:.2f} with MA20 falling -> BEAR" if bear_level else "Daily close below MA20 with MA20 falling -> BEAR",
        ]
    elif gated_bias == "bull":
        flip_conditions = ["Intraday close below entry and MA20 -> delete or flip to WAIT same day."]
    elif gated_bias == "bear":
        flip_conditions = ["Intraday close above entry and MA20 -> delete or flip to WAIT same day."]
    else:
        flip_conditions = ["Wait for daily close to resolve against MA20 slope."]

    morning_confirmation = {
        "time": "6:45 AM PT",
        "mandatory": True,
        "rules": [
            "Refresh ORH/ORL/VWAP from today's first 15m; never carry prior day levels.",
            "VWAP vs OR Mid must agree with evening bias, else flip to WAIT.",
            "Entry only on trigger candle at level: 5m rejection/reclaim + volume.",
            "Entry requires 70+ on 5-condition checklist.",
            "One trade per trigger window: 6:45-7:15 AM PT primary.",
        ],
    }

    analysis.update({
        "biasOriginal": original_bias,
        "bias": gated_bias,
        "biasGateReasons": gate_reasons,
        "ma20DistancePct": round(dist_ma20, 2) if dist_ma20 is not None else None,
        "ma20Slope": ma20_slope,
        "priorDayMovePct": round(prior_move, 2) if prior_move is not None else None,
        "earningsDate": earnings_date,
        "earningsDaysRemaining": earnings_days,
        "biasExpiryDate": bias_expiry_date,
        "directionalBiasExpired": directional_expired,
        "calendarSpreadsOnly": calendar_spreads_only,
        "morningConfirmation": morning_confirmation,
        "flipConditions": flip_conditions,
        "entryChecklistRequiredScore": 70,
        "primaryTriggerWindow": "6:45-7:15 AM PT",
    })

    if isinstance(out.get("analysis"), dict):
        out["analysis"] = analysis
    else:
        out = analysis
    return out


@app.post("/api/eod-journal/{email}/snapshot")
def eod_journal_save_snapshot(
    email: str,
    req: EodJournalSnapshotRequest,
    auth_email: str = Depends(require_access_email),
):
    """Persist one EOD journal snapshot for user/date/ticker."""
    ensure_same_user(auth_email, email)
    snapshot = req.snapshot
    if req.mode.strip().lower() == "swing":
        snapshot = _enrich_swing_eod_snapshot(req.ticker, req.snapshot)
    try:
        row = upsert_eod_journal_snapshot(
            email,
            req.mode,
            req.date,
            req.ticker,
            snapshot,
            req.notes,
            req.checks,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "entry": row}


@app.get("/api/eod-journal/{email}/dates")
def eod_journal_dates(
    email: str,
    mode: str = "swing",
    limit: int = Query(60, ge=1, le=365),
    auth_email: str = Depends(require_access_email),
):
    """List saved EOD journal dates for the current user and mode."""
    ensure_same_user(auth_email, email)
    return {"dates": list_eod_journal_dates(email, mode, limit)}


@app.get("/api/eod-journal/{email}/snapshot/{mode}/{date_key}/{ticker}")
def eod_journal_get_snapshot(
    email: str,
    mode: str,
    date_key: str,
    ticker: str,
    auth_email: str = Depends(require_access_email),
):
    """Return a saved EOD journal snapshot."""
    ensure_same_user(auth_email, email)
    row = get_eod_journal_snapshot(email, mode, date_key, ticker)
    if not row:
        raise HTTPException(status_code=404, detail="EOD journal snapshot not found")
    return row


def _compute_mtm_pnl(legs: list[dict], S: float, T_years: float) -> float:
    """
    Mark-to-market P&L per share using Black-Scholes.
    Uses each leg's stored IV (as decimal, e.g. 0.30 = 30%) for pricing.
    Falls back to HV-20 proxy if IV is missing/zero.
    """
    from backtest import bs_price, RISK_FREE_RATE
    pnl = 0.0
    for leg in legs:
        strike = float(leg.get("strike", 0))
        if strike <= 0:
            # No valid strike — cannot price with BS; skip this leg (contributes 0 P&L)
            continue
        iv = float(leg.get("iv", 0) or 0)
        if iv <= 0.005:
            iv = 0.25  # fallback
        entry_p    = float(leg.get("mid_price", 0))
        opt_type   = str(leg.get("option_type", "CALL")).upper()
        action     = str(leg.get("action", "BUY")).upper()
        current_p  = bs_price(S, strike, max(T_years, 0.0), RISK_FREE_RATE, iv, opt_type)
        if action == "SELL":
            pnl += entry_p - current_p
        else:
            pnl += current_p - entry_p
    return pnl


def _refresh_entry(entry: dict) -> dict:
    """Fetch current price and recompute P&L for one journal entry. Mutates entry."""
    import time
    today = pd.Timestamp.today().normalize()
    expiry_dt = pd.Timestamp(entry["expiry"])
    ticker_str = entry["ticker"]

    try:
        if today > expiry_dt:
            # Expired: compute intrinsic P&L from closing price on/after expiry date
            # Date-range fetches bypass bar_cache (unbounded key space) — still direct
            hist = _bc_hist(
                ticker_str,
                start=entry["expiry"],
                end=(expiry_dt + pd.Timedelta(days=5)).strftime("%Y-%m-%d"),
                auto_adjust=True,
            )
            if not hist.empty:
                S_exit = float(hist["Close"].iloc[0])
                pnl = _compute_mtm_pnl(entry["legs"], S_exit, 0.0)
                pnl_dollar = round(pnl * 100, 2)
                outcome = "WIN" if pnl > 0.005 else ("LOSS" if pnl < -0.005 else "BREAKEVEN")
                update_journal_entry(
                    entry["email"], entry["id"],
                    status="EXPIRED",
                    exit_date=hist.index[0].strftime("%Y-%m-%d"),
                    underlying_exit=round(S_exit, 2),
                    realized_pnl=round(pnl, 4),
                    exit_reason="EXPIRY",
                    outcome=outcome,
                    current_price=round(S_exit, 2),
                    current_pnl=round(pnl_dollar, 2),
                    last_refreshed=int(time.time() * 1000),
                )
                entry.update(
                    status="EXPIRED", exit_date=hist.index[0].strftime("%Y-%m-%d"),
                    underlying_exit=round(S_exit, 2), realized_pnl=round(pnl, 4),
                    exit_reason="EXPIRY", outcome=outcome,
                    current_price=round(S_exit, 2), current_pnl=round(pnl_dollar, 2),
                )
        else:
            # Still open: mark-to-market
            info = _bc_info(ticker_str)
            S = safe_float(info.get("currentPrice") or info.get("regularMarketPrice") or 0)
            if S <= 0:
                hist = _bc_hist(ticker_str, period="5d", auto_adjust=True)
                S = float(hist["Close"].iloc[-1]) if not hist.empty else 0.0
            if S > 0:
                dte_remain = (expiry_dt - today).days
                T_years = max(dte_remain / 365.0, 0.0)
                pnl = _compute_mtm_pnl(entry["legs"], S, T_years)
                pnl_dollar = round(pnl * 100, 2)
                update_journal_entry(
                    entry["email"], entry["id"],
                    current_price=round(S, 2),
                    current_pnl=round(pnl_dollar, 2),
                    last_refreshed=int(time.time() * 1000),
                )
                entry.update(current_price=round(S, 2), current_pnl=round(pnl_dollar, 2))
    except Exception:
        pass

    return entry


@app.post("/api/journal/save")
def journal_save(email: str, req: JournalSaveRequest, auth_email: str = Depends(require_access_email)):
    """Save a recommendation to the trade journal."""
    ensure_same_user(auth_email, email)
    normalized = email.strip().lower()
    import datetime
    entry_dict = req.dict()
    entry_dict.setdefault("entry_date", datetime.date.today().isoformat())
    # Set current_price to entry price so it shows immediately (refreshed on demand)
    if not entry_dict.get("current_price") and entry_dict.get("underlying_entry"):
        entry_dict["current_price"] = entry_dict["underlying_entry"]
    entry_id = save_journal_entry(normalized, entry_dict)
    return {"id": entry_id, "ok": True}


@app.get("/api/journal/{email}")
def journal_list(email: str, auth_email: str = Depends(require_access_email), status: str = ""):
    """List all journal entries for a user (optionally filtered by status)."""
    ensure_same_user(auth_email, email)
    normalized = email.strip().lower()
    entries = get_journal_entries(normalized, status or None)
    # Inject email for _refresh_entry
    for e in entries:
        e["email"] = normalized
    # Auto-refresh prices for all entries (open and closed) so the journal
    # always shows the latest market value regardless of status.
    for e in entries:
        current_px = e.get("current_price") or 0
        if current_px <= 0:
            from storage import update_journal_entry
            try:
                info = bar_cache.get_info(e["ticker"])
                px = safe_float(info.get("currentPrice") or info.get("regularMarketPrice") or 0)
                if px > 0:
                    update_journal_entry(normalized, e["id"], current_price=round(px, 2))
                    e["current_price"] = round(px, 2)
            except Exception:
                pass
    return {"entries": entries}


@app.post("/api/journal/refresh/{email}")
def journal_refresh(email: str, auth_email: str = Depends(require_access_email)):
    """Recompute current P&L for all OPEN entries; settle EXPIRED ones."""
    ensure_same_user(auth_email, email)
    normalized = email.strip().lower()
    entries = get_journal_entries(normalized, status="OPEN")
    for e in entries:
        e["email"] = normalized
        _refresh_entry(e)
    # Return all entries (now updated)
    all_entries = get_journal_entries(normalized)
    for e in all_entries:
        e["email"] = normalized
    return {"entries": all_entries}


@app.patch("/api/journal/{email}/{entry_id}/close")
def journal_close(email: str, entry_id: str, req: JournalCloseRequest, auth_email: str = Depends(require_access_email)):
    """Manually close a journal trade (user marks it as closed)."""
    ensure_same_user(auth_email, email)
    import time
    import datetime
    normalized = email.strip().lower()
    entry = get_journal_entry(normalized, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    entry["email"] = normalized
    _refresh_entry(entry)  # get current price first
    S_exit = entry.get("current_price", 0.0)
    pnl_ps = _compute_mtm_pnl(entry["legs"], S_exit, 0.0) if S_exit > 0 else 0.0
    outcome = "WIN" if pnl_ps > 0.005 else ("LOSS" if pnl_ps < -0.005 else "BREAKEVEN")
    notes = req.notes or entry.get("notes", "")
    update_journal_entry(
        normalized, entry_id,
        status="CLOSED",
        exit_date=datetime.date.today().isoformat(),
        underlying_exit=round(S_exit, 2),
        realized_pnl=round(pnl_ps, 4),
        exit_reason=req.exit_reason,
        outcome=outcome,
        current_pnl=round(pnl_ps * 100, 2),
        notes=notes,
        last_refreshed=int(time.time() * 1000),
    )
    return {"ok": True, "outcome": outcome, "realized_pnl": round(pnl_ps * 100, 2)}


@app.patch("/api/journal/{email}/{entry_id}/notes")
def journal_notes(email: str, entry_id: str, req: JournalNotesRequest, auth_email: str = Depends(require_access_email)):
    """Update notes on a journal entry."""
    ensure_same_user(auth_email, email)
    normalized = email.strip().lower()
    update_journal_entry(normalized, entry_id, notes=req.notes)
    return {"ok": True}


@app.patch("/api/journal/{email}/{entry_id}/update")
def journal_update(email: str, entry_id: str, req: JournalUpdateRequest, auth_email: str = Depends(require_access_email)):
    """Update editable fields on a journal entry (strategy, bias, entry price, etc.)."""
    ensure_same_user(auth_email, email)
    normalized = email.strip().lower()
    fields = {k: v for k, v in req.dict(exclude_none=True).items()}
    if not fields:
        return {"ok": True}
    update_journal_entry(normalized, entry_id, **fields)
    return {"ok": True}


@app.delete("/api/journal/{email}/{entry_id}")
def journal_delete(email: str, entry_id: str, auth_email: str = Depends(require_access_email)):
    """Delete a journal entry."""
    ensure_same_user(auth_email, email)
    normalized = email.strip().lower()
    deleted = delete_journal_entry(normalized, entry_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Journal entry not found")
    return {"ok": True}


# ── TRADE IDEAS ────────────────────────────────────────────────

class TradeIdeaCreateRequest(_BM):
    ticker: str
    engine: str = "SWING"
    direction: str = "LONG"
    structure: str = ""
    reason: str = ""
    status: str = "WATCHING"
    entry_price: float = 0
    target_price: float = 0
    stop_price: float = 0
    engine_signal: str = ""
    engine_state: int = 1
    notes: str = ""


class TradeIdeaUpdateRequest(_BM):
    status: Optional[str] = None
    engine: Optional[str] = None
    direction: Optional[str] = None
    structure: Optional[str] = None
    reason: Optional[str] = None
    entry_price: Optional[float] = None
    target_price: Optional[float] = None
    stop_price: Optional[float] = None
    engine_signal: Optional[str] = None
    engine_state: Optional[int] = None
    notes: Optional[str] = None


@app.get("/api/trade-ideas/{email}")
def list_trade_ideas(email: str, auth_email: str = Depends(require_access_email)):
    ensure_same_user(auth_email, email)
    return {"ideas": get_trade_ideas(email.strip().lower())}


@app.post("/api/trade-ideas/{email}")
def create_trade_idea(email: str, req: TradeIdeaCreateRequest, auth_email: str = Depends(require_access_email)):
    ensure_same_user(auth_email, email)
    idea_id = save_trade_idea(email.strip().lower(), req.dict())
    return {"ok": True, "id": idea_id}


@app.patch("/api/trade-ideas/{email}/{idea_id}")
def patch_trade_idea(email: str, idea_id: str, req: TradeIdeaUpdateRequest, auth_email: str = Depends(require_access_email)):
    ensure_same_user(auth_email, email)
    fields = {k: v for k, v in req.dict().items() if v is not None}
    update_trade_idea(email.strip().lower(), idea_id, **fields)
    return {"ok": True}


@app.delete("/api/trade-ideas/{email}/{idea_id}")
def delete_trade_idea_endpoint(email: str, idea_id: str, auth_email: str = Depends(require_access_email)):
    ensure_same_user(auth_email, email)
    delete_trade_idea(email.strip().lower(), idea_id)
    return {"ok": True}


# ═══════════════════════════════════════════════════════════════
# ALPACA PAPER TRADING  (admin-only)
# ═══════════════════════════════════════════════════════════════

from alpaca_trader import (
    is_configured as alpaca_is_configured,
    get_account as alpaca_get_account,
    get_positions as alpaca_get_positions,
    get_orders as alpaca_get_orders,
    execute_recommendation as alpaca_execute,
    cancel_order as alpaca_cancel_order,
    close_position as alpaca_close_position,
)
from storage import normalize_email as _norm_email


class TradingExecuteRequest(_BM):
    """Execute a recommendation as a paper trade via Alpaca."""
    email: str          # caller's email — must resolve to admin role
    ticker: str
    strategy: str
    legs: list[dict]    # list of {action, option_type, strike, expiry, ...}
    contracts: int = 1


class TradingCloseRequest(_BM):
    email: str          # must be admin
    symbol: str         # OCC symbol or underlying ticker


class TradingCancelRequest(_BM):
    email: str
    order_id: str


def _require_admin(email: str) -> None:
    """Raise 403 if the email does not resolve to the admin role."""
    normalized = _norm_email(email)
    if not normalized:
        raise HTTPException(status_code=403, detail="Admin access required for paper trading")
    # Role comes from SQLite user_state.role (admin is DB-only; see storage.effective_user_role)
    role = get_user_state(normalized).get("role", "user")
    if role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required for paper trading")


@app.get("/api/trading/status")
def trading_status(email: str, auth_email: str = Depends(require_access_email)):
    """Check if Alpaca is configured and return account summary."""
    ensure_same_user(auth_email, email)
    _require_admin(email)
    configured = alpaca_is_configured()
    if not configured:
        return {
            "configured": False,
            "message": "Add ALPACA_API_KEY and ALPACA_SECRET_KEY to your .env file to enable paper trading.",
        }
    account = alpaca_get_account()
    # Keys are set but Alpaca returned an error (wrong keys, live keys on paper URL, network, etc.)
    if isinstance(account, dict) and account.get("error"):
        return {
            "configured": True,
            "alpaca_error": account["error"],
        }
    return {"configured": True, "account": account}


@app.get("/api/trading/positions")
def trading_positions(email: str, auth_email: str = Depends(require_access_email)):
    """Return all open Alpaca paper positions (admin only)."""
    ensure_same_user(auth_email, email)
    _require_admin(email)
    if not alpaca_is_configured():
        raise HTTPException(status_code=503, detail="Alpaca not configured")
    positions = alpaca_get_positions()
    if positions and isinstance(positions[0], dict) and positions[0].get("error"):
        raise HTTPException(status_code=502, detail=positions[0]["error"])
    return {"positions": positions}


@app.get("/api/trading/orders")
def trading_orders(email: str, auth_email: str = Depends(require_access_email), status: str = "all"):
    """Return recent Alpaca orders (admin only). status: open | closed | all"""
    ensure_same_user(auth_email, email)
    _require_admin(email)
    if not alpaca_is_configured():
        raise HTTPException(status_code=503, detail="Alpaca not configured")
    orders = alpaca_get_orders(status)
    if orders and isinstance(orders[0], dict) and orders[0].get("error"):
        raise HTTPException(status_code=502, detail=orders[0]["error"])
    return {"orders": orders}


@app.post("/api/trading/execute")
def trading_execute(req: TradingExecuteRequest, auth_email: str = Depends(require_access_email)):
    """Place a multi-leg paper trade on Alpaca from an engine recommendation."""
    ensure_same_user(auth_email, req.email)
    _require_admin(req.email)
    if not alpaca_is_configured():
        raise HTTPException(status_code=503, detail="Alpaca not configured. Add ALPACA_API_KEY + ALPACA_SECRET_KEY to .env")
    if not req.legs:
        raise HTTPException(status_code=400, detail="No legs provided")
    result = alpaca_execute(
        ticker    = req.ticker.strip().upper(),
        strategy  = req.strategy,
        legs      = req.legs,
        contracts = max(1, req.contracts),
    )
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@app.post("/api/trading/cancel")
def trading_cancel(req: TradingCancelRequest, auth_email: str = Depends(require_access_email)):
    """Cancel an open Alpaca order by order ID."""
    ensure_same_user(auth_email, req.email)
    _require_admin(req.email)
    if not alpaca_is_configured():
        raise HTTPException(status_code=503, detail="Alpaca not configured")
    result = alpaca_cancel_order(req.order_id)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@app.post("/api/trading/close")
def trading_close_position(req: TradingCloseRequest, auth_email: str = Depends(require_access_email)):
    """Liquidate an open paper position by OCC symbol."""
    ensure_same_user(auth_email, req.email)
    _require_admin(req.email)
    if not alpaca_is_configured():
        raise HTTPException(status_code=503, detail="Alpaca not configured")
    result = alpaca_close_position(req.symbol)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


# ─── Admin endpoints ─────────────────────────────────────────────────────

@app.get("/api/health")
def health_check():
    import subprocess, os
    _ver = None
    try:
        _ver = subprocess.check_output(
            ["git", "describe", "--tags", "--abbrev=0"],
            cwd=os.path.dirname(__file__), stderr=subprocess.DEVNULL, timeout=2
        ).decode().strip()
    except Exception:
        pass
    return {"ok": True, "status": "healthy", "version": _ver or "unknown"}


@app.get("/api/admin/db-check")
def admin_db_check(auth_email: str = Depends(require_access_email)):
    _require_admin(auth_email)
    try:
        from storage import _connect
        with _connect() as conn:
            conn.execute("SELECT 1").fetchone()
        return {"ok": True, "message": "Database connection OK"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.post("/api/admin/flush-cache")
def admin_flush_cache(auth_email: str = Depends(require_access_email)):
    _require_admin(auth_email)
    try:
        import bar_cache
        bar_cache.invalidate_all()
        return {"ok": True, "message": "Cache flushed"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.post("/api/admin/set-role")
def admin_set_role(payload: dict, auth_email: str = Depends(require_access_email)):
    """Set a user's role in the database. Admin only."""
    _require_admin(auth_email)
    target_email = str(payload.get("email", "")).strip().lower()
    role = str(payload.get("role", "")).strip().lower()
    valid_roles = {"admin", "super_user", "day", "swing", "finance", "user"}
    if not target_email:
        raise HTTPException(status_code=400, detail="email is required")
    if role not in valid_roles:
        raise HTTPException(status_code=400, detail=f"role must be one of: {', '.join(sorted(valid_roles))}")
    from storage import _connect, normalize_email as _ne
    n = _ne(target_email)
    with _connect() as conn:
        conn.execute(
            "UPDATE user_state SET role = ? WHERE email = ?",
            (role, n),
        )
        rows = conn.execute("SELECT role FROM user_state WHERE email = ?", (n,)).fetchone()
    if rows is None:
        raise HTTPException(status_code=404, detail=f"No account found for {target_email}")
    return {"ok": True, "email": n, "role": rows[0]}


# ─── User accent preference ───────────────────────────────────────────────

@app.get("/api/user/accent")
def get_user_accent(auth_email: str = Depends(require_access_email)):
    """Get the user's selected accent color."""
    state = get_user_state(normalize_email(auth_email))
    return {"accent": state.get("theme_accent", "blue")}


@app.put("/api/user/accent")
def set_user_accent(auth_email: str = Depends(require_access_email), body: dict = None):
    """Save the user's selected accent color."""
    email = auth_email.strip().lower()
    accent = str(body.get("accent", "blue"))
    from storage import _connect, normalize_email
    with _connect() as conn:
        conn.execute(
            "UPDATE user_state SET theme_accent = ? WHERE email = ?",
            (accent, normalize_email(email)),
        )
    return {"ok": True, "accent": accent}


@app.get("/api/dashboard-tickers")
def api_get_dashboard_tickers(auth_email: str = Depends(require_access_email)):
    """Get dashboard tickers (day + swing) for the current user."""
    return get_dashboard_tickers(auth_email)


@app.post("/api/dashboard-tickers")
def api_save_dashboard_tickers(body: dict, auth_email: str = Depends(require_access_email)):
    """Save dashboard tickers (day + swing) for the current user."""
    day = [s.upper().strip() for s in body.get("day", []) if isinstance(s, str) and s.strip()]
    swing = [s.upper().strip() for s in body.get("swing", []) if isinstance(s, str) and s.strip()]
    return save_dashboard_tickers(auth_email, day, swing)


# ─── Swing trade alert scanner ────────────────────────────────────────────────

_SWING_GO_VERDICTS = {"GO", "STRONG GO", "STRONG_GO", "STRONG GO"}
_SWING_STATE_LABEL = {1: "SETUP", 2: "WATCH", 3: "READY", 4: "EXIT"}


def _scan_my_tickers_for_swing_alerts(user_state: dict) -> None:
    """
    Scan all my_tickers for swing trade state transitions.
    Email is sent only when verdict transitions to GO / STRONG GO.
    All other changes go to the in-app alert center only.
    """
    email = user_state.get("email", "").strip().lower()
    if not email:
        return

    raw_tickers = user_state.get("my_tickers") or []
    if not raw_tickers:
        return

    user_name = email.split("@")[0] or email
    session_date_today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    swing_escalations: list[dict] = []

    for ti, mt_item in enumerate(raw_tickers):
        if isinstance(mt_item, dict):
            ticker = str(mt_item.get("symbol") or mt_item.get("ticker") or "").strip().upper()
        else:
            ticker = str(mt_item).strip().upper()
        if not ticker:
            continue
        if ti:
            time.sleep(0.8)

        try:
            sr = run_swing_trade_scan(ticker)
        except Exception as exc:
            print(f"[swing-alert] {email} {ticker} failed: {exc}", flush=True)
            continue

        try:
            final_action = str(getattr(sr, "final_action", "") or "").upper().strip()
            verdict      = str(getattr(sr, "verdict", "") or "").upper().strip()
            bias_raw     = str(getattr(sr, "bias", "") or "").lower()
            bias_label   = "BULLISH / LONG" if bias_raw == "long" else "BEARISH / SHORT" if bias_raw == "short" else bias_raw.upper()
            now_state    = _swing_active_state(final_action)
            m            = dict(getattr(sr, "metrics", None) or {})
            sd           = str(m.get("session_date") or session_date_today)[:10]
            now_ms       = int(time.time() * 1000)

            prev = get_ticker_state_last(email, ticker, "SWING")

            if prev is None:
                upsert_ticker_state_last(email, ticker, "SWING", now_state, final_action, sd)
                continue

            prev_state  = int(prev.get("state_num") or 1)
            prev_sd     = (prev.get("session_date") or "")[:10]

            # New trading day — reset without alerting
            if prev_sd and sd and prev_sd != sd:
                upsert_ticker_state_last(email, ticker, "SWING", now_state, final_action, sd)
                continue

            if prev_state == now_state:
                upsert_ticker_state_last(email, ticker, "SWING", now_state, final_action, sd)
                continue

            # State-change alerts are intentionally ignored. Swing state is
            # persisted only for lifecycle tracking/de-dupe.
            upsert_ticker_state_last(email, ticker, "SWING", now_state, final_action, sd)

        except Exception as exc:
            print(f"[swing-alert] state-scan {email} {ticker} failed: {exc}", flush=True)

    if not swing_escalations or not _user_wants_trade_alert_emails(user_state):
        return

    try:
        public_base = _option_advisor_public_base()
        tickers_str = ", ".join(sorted({it["ticker"] for it in swing_escalations}))
        count       = len(swing_escalations)
        subject     = f"⚡ OptionAdvisor: {count} swing-trade GO signal{'s' if count != 1 else ''} — {tickers_str}"
        html_body   = _build_swing_alert_email_html(email, user_name, swing_escalations, public_base=public_base)
        _deliver_html_email(email, user_name, subject, html_body)
        print(f"[swing-alert] emailed {count} GO swing alert(s) to {email}", flush=True)
    except Exception as exc:
        print(f"[swing-alert] email failed for {email}: {exc}", flush=True)


def _build_swing_alert_email_html(
    email: str,
    user_name: str | None,
    items: list[dict],
    *,
    public_base: str,
) -> str:
    display_name = (user_name or "").strip() or email
    base         = public_base.rstrip("/")
    swing_url    = f"{base}/swing-trade"

    cards_html = ""
    for it in items:
        ticker    = html.escape(str(it.get("ticker", "")).upper())
        company   = html.escape(str(it.get("companyName") or ticker))
        direction = html.escape(str(it.get("direction", "")))
        bias      = html.escape(str(it.get("bias", "")))
        summary   = html.escape(str(it.get("summary", "")))
        verdict   = html.escape(str(it.get("verdict", "")))
        session   = html.escape(str(it.get("sessionDate", "")))
        ticker_url = html.escape(f"{swing_url}?ticker={it.get('ticker', '').upper()}")

        price      = _fmt_price(it.get("currentPrice"))
        support    = _fmt_price(it.get("support"))
        resistance = _fmt_price(it.get("resistance"))
        stop_loss  = _fmt_price(it.get("stopLoss"))
        score_val  = it.get("score")
        score_str  = f"{int(score_val)}" if score_val is not None else "—"

        bias_color = "#166534" if "BULL" in bias.upper() or "LONG" in bias.upper() else \
                     "#991b1b" if "BEAR" in bias.upper() or "SHORT" in bias.upper() else "#64748b"

        level_pairs = [("Price", price), ("Support", support), ("Resistance", resistance), ("Stop", stop_loss)]
        levels_html = ""
        for lbl, val in level_pairs:
            if val and val != "—":
                levels_html += (
                    f'<span style="margin-right:14px;white-space:nowrap;">'
                    f'<span style="color:#94a3b8;font-size:10px;">{html.escape(lbl)}</span> '
                    f'<span style="font-family:monospace;font-weight:700;font-size:12px;color:#1e293b;">{val}</span>'
                    f'</span>'
                )

        summary_row = f'<p style="margin:8px 0 0;font-size:12px;color:#374151;">{summary}</p>' if summary else ""

        cards_html += f"""
<div style="margin-bottom:16px;border-radius:10px;overflow:hidden;border:2px solid #22c55e;">
  <div style="background:linear-gradient(90deg,#14532d,#166534);padding:10px 14px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
    <div>
      <a href="{ticker_url}" style="color:#ffffff;font-family:monospace;font-size:16px;font-weight:800;text-decoration:none;">{ticker}</a>
      <span style="color:rgba(255,255,255,0.75);font-size:12px;margin-left:8px;">{company}</span>
    </div>
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
      <span style="background:rgba(255,255,255,0.15);color:#ffffff;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;">SWING TRADE</span>
      <span style="background:#dcfce7;color:#14532d;padding:3px 12px;border-radius:4px;font-size:11px;font-weight:900;">⚡ {verdict}</span>
    </div>
  </div>
  <div style="background:#f0fdf4;padding:12px 14px;">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
      <span style="font-size:12px;font-weight:700;color:{bias_color};">{bias}</span>
      <span style="color:#cbd5e1;">|</span>
      <span style="font-size:12px;font-weight:700;color:#166534;">{direction}</span>
      <span style="color:#cbd5e1;">|</span>
      <span style="font-size:11px;color:#64748b;">Score {score_str}</span>
      <span style="color:#cbd5e1;">|</span>
      <span style="font-size:10px;color:#94a3b8;">{session}</span>
    </div>
    <div style="background:#dcfce7;border-radius:6px;padding:8px 10px;flex-wrap:wrap;border:1px solid #bbf7d0;">
      {levels_html}
    </div>
    {summary_row}
  </div>
</div>"""

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="color-scheme" content="light dark">
  <style>
    body {{ margin:0; padding:24px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
           background:#f1f5f9; line-height:1.55; -webkit-font-smoothing:antialiased; }}
  </style>
</head>
<body>
  <div style="max-width:620px;margin:0 auto;">
    <div style="background:#14532d;border-radius:12px 12px 0 0;padding:18px 24px;">
      <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:800;">⚡ Swing Trade GO Signal</h1>
      <p style="margin:4px 0 0;color:rgba(255,255,255,0.75);font-size:13px;">Hi {html.escape(display_name)} — a swing trade opportunity is ready to review.</p>
    </div>
    <div style="background:#ffffff;border-radius:0 0 12px 12px;padding:20px 24px;border:1px solid #e2e8f0;border-top:none;">
      {cards_html}
      <p style="margin:16px 0 0;font-size:11px;color:#94a3b8;border-top:1px solid #f1f5f9;padding-top:12px;">
        Prices may be delayed. Review in OptionAdvisor before entering any trade.
        <a href="{html.escape(swing_url)}" style="color:#166534;">Open Swing Trade Engine →</a>
      </p>
    </div>
  </div>
</body>
</html>"""


# ─── Day trade alert batch runner ─────────────────────────────────────────────

def _run_day_trade_alert_batch() -> None:
    """Run one pass of day-trade alert scanning for all users with my_tickers."""
    if not _is_day_trade_alert_window_pt():
        print("[day-alert-batch] outside alert window (5 AM – 1 PM PT) — skipping", flush=True)
        return
    try:
        users = list_user_states()
    except Exception as exc:
        print(f"[day-alert-batch] failed to load users: {exc}", flush=True)
        return
    for user_state in users:
        role = (user_state.get("role") or "").lower()
        if role not in ("day", "admin", "super_user"):
            continue
        try:
            _scan_my_tickers_for_state_alerts(user_state)
        except Exception as exc:
            print(f"[day-alert-batch] scan failed for {user_state.get('email')}: {exc}", flush=True)
        try:
            _scan_exit_signals_for_state(user_state)
        except Exception as exc:
            print(f"[exit-scan] failed for {user_state.get('email')}: {exc}", flush=True)


def _day_alert_batch_loop() -> None:
    """Daemon thread: run day-trade alert batch every ALERT_SCAN_INTERVAL_SECONDS."""
    time.sleep(ALERT_SCAN_START_DELAY_SECONDS)
    while True:
        try:
            _run_day_trade_alert_batch()
        except Exception as exc:
            print(f"[day-alert-batch] unhandled error: {exc}", flush=True)
        time.sleep(ALERT_SCAN_INTERVAL_SECONDS)


_batch_thread = threading.Thread(target=_day_alert_batch_loop, daemon=True, name="day-alert-batch")
_batch_thread.start()
print(f"[day-alert-batch] background scanner started (interval={ALERT_SCAN_INTERVAL_SECONDS}s, window=5AM–1PM PT)", flush=True)


# ─── Swing trade alert batch runner ───────────────────────────────────────────

def _run_swing_trade_alert_batch() -> None:
    """Run one pass of swing-trade alert scanning for all users with my_tickers."""
    if not _is_swing_trade_alert_window_pt():
        print("[swing-alert-batch] outside alert window (6 AM – 2 PM PT) — skipping", flush=True)
        return
    try:
        users = list_user_states()
    except Exception as exc:
        print(f"[swing-alert-batch] failed to load users: {exc}", flush=True)
        return
    for user_state in users:
        role = (user_state.get("role") or "").lower()
        if role not in ("swing", "admin", "super_user"):
            continue
        try:
            _scan_my_tickers_for_swing_alerts(user_state)
        except Exception as exc:
            print(f"[swing-alert-batch] scan failed for {user_state.get('email')}: {exc}", flush=True)


def _swing_alert_batch_loop() -> None:
    """Daemon thread: run swing-trade alert batch every SWING_ALERT_SCAN_INTERVAL_SECONDS."""
    time.sleep(ALERT_SCAN_START_DELAY_SECONDS + 5)  # stagger start slightly from day batch
    while True:
        try:
            _run_swing_trade_alert_batch()
        except Exception as exc:
            print(f"[swing-alert-batch] unhandled error: {exc}", flush=True)
        time.sleep(SWING_ALERT_SCAN_INTERVAL_SECONDS)


_swing_batch_thread = threading.Thread(target=_swing_alert_batch_loop, daemon=True, name="swing-alert-batch")
_swing_batch_thread.start()
print(f"[swing-alert-batch] background scanner started (interval={SWING_ALERT_SCAN_INTERVAL_SECONDS}s, window=6AM–2PM PT)", flush=True)


# ─── Day trade EOD Journal History auto-generator ────────────────────────────

DAY_TRADE_EOD_HISTORY_INTERVAL_SECONDS = int(os.getenv("DAY_TRADE_EOD_HISTORY_INTERVAL_SECONDS", "900"))
DAY_TRADE_EOD_HISTORY_START_DELAY_SECONDS = int(os.getenv("DAY_TRADE_EOD_HISTORY_START_DELAY_SECONDS", "180"))
_day_trade_eod_history_last_run_date = ""


def _is_day_trade_eod_history_window_pt() -> bool:
    now = datetime.now(ZoneInfo("America/Los_Angeles"))
    if now.weekday() >= 5:
        return False
    return now.hour >= 16


def _run_day_trade_eod_history_batch() -> None:
    """Generate next-day History Log entries once per PT date after the 4 PM close."""
    global _day_trade_eod_history_last_run_date
    now_pt = datetime.now(ZoneInfo("America/Los_Angeles"))
    date_key = now_pt.date().isoformat()
    if not _is_day_trade_eod_history_window_pt():
        print("[day-eod-history] outside EOD window (after 4 PM PT weekdays) — skipping", flush=True)
        return
    if _day_trade_eod_history_last_run_date == date_key:
        return

    try:
        users = list_user_states()
    except Exception as exc:
        print(f"[day-eod-history] failed to load users: {exc}", flush=True)
        return

    total_saved = 0
    total_failed = 0
    for user_state in users:
        role = (user_state.get("role") or "").lower()
        if role not in ("day", "admin", "super_user"):
            continue
        result = _save_day_trade_next_day_history_for_state(user_state, force_refresh=True)
        total_saved += int(result.get("saved") or 0)
        total_failed += int(result.get("failed") or 0)

    _day_trade_eod_history_last_run_date = date_key
    print(
        f"[day-eod-history] generated next-day history for {date_key}: saved={total_saved} failed={total_failed}",
        flush=True,
    )


def _day_trade_eod_history_loop() -> None:
    time.sleep(DAY_TRADE_EOD_HISTORY_START_DELAY_SECONDS)
    while True:
        try:
            _run_day_trade_eod_history_batch()
        except Exception as exc:
            print(f"[day-eod-history] unhandled error: {exc}", flush=True)
        time.sleep(DAY_TRADE_EOD_HISTORY_INTERVAL_SECONDS)


_day_trade_eod_history_thread = threading.Thread(
    target=_day_trade_eod_history_loop,
    daemon=True,
    name="day-trade-eod-history",
)
_day_trade_eod_history_thread.start()
print(
    f"[day-eod-history] background generator started "
    f"(interval={DAY_TRADE_EOD_HISTORY_INTERVAL_SECONDS}s, window=after 4 PM PT weekdays)",
    flush=True,
)


# ─── Day trade quote cache warmer ────────────────────────────────────────────

def _is_day_trade_quote_warm_window_pt() -> bool:
    if not DAY_TRADE_QUOTE_WARM_MARKET_HOURS_ONLY:
        return True
    return _is_day_trade_alert_window_pt()


def _run_day_trade_quote_cache_warm() -> None:
    """Warm quote_cache for saved Day Trade tickers in small Yahoo-safe batches."""
    if not _is_day_trade_quote_warm_window_pt():
        print("[day-quote-warm] outside day trade window (5 AM – 1 PM PT) — skipping", flush=True)
        return

    started = time.time()
    tickers = _all_day_trade_tickers_for_cache_warm()
    if not tickers:
        print("[day-quote-warm] no saved day trade tickers found", flush=True)
        return

    _quotes, meta = _get_quotes_in_day_trade_batches(tickers, force_refresh=False)
    logging.getLogger(__name__).info(
        "DAY_TRADE_QUOTE_WARM ticker_count=%d batch_size=%d batch_count=%d cache_hits=%d cache_misses=%d elapsed_ms=%d",
        len(tickers),
        meta.get("batch_size", _day_trade_quote_batch_size()),
        meta.get("batch_count", 0),
        meta.get("cache_hits", 0),
        meta.get("cache_misses", 0),
        round((time.time() - started) * 1000),
    )


def _day_trade_quote_cache_warm_loop() -> None:
    """Daemon thread: refresh Day Trade quote cache every five minutes by default."""
    time.sleep(DAY_TRADE_QUOTE_WARM_START_DELAY_SECONDS)
    while True:
        try:
            _run_day_trade_quote_cache_warm()
        except Exception as exc:
            print(f"[day-quote-warm] unhandled error: {exc}", flush=True)
        time.sleep(DAY_TRADE_QUOTE_WARM_INTERVAL_SECONDS)


_day_trade_quote_warm_thread = threading.Thread(
    target=_day_trade_quote_cache_warm_loop,
    daemon=True,
    name="day-trade-quote-warm",
)
_day_trade_quote_warm_thread.start()
print(
    f"[day-quote-warm] background quote warmer started "
    f"(interval={DAY_TRADE_QUOTE_WARM_INTERVAL_SECONDS}s, batch_size={_day_trade_quote_batch_size()})",
    flush=True,
)
