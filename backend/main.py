"""
main.py — FastAPI Backend
==========================
Run: uvicorn main:app --reload --port 9000
"""

from fastapi import Depends, FastAPI, HTTPException, Request
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
from datetime import datetime, timezone
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
    OptionRowOut, PricePoint, SignalsOut, ScoreBreakdown, QuoteQualitySummary,
    UserDataRequest, UserDataResponse, AlertEmailRequest, AlertItem,
    AlertDismissRequest, AlertClearRequest, TestEmailRequest, BacktestRequest,
    DayTradeRequest, DayTradeResponse,
    SwingTradeRequest, SwingTradeResponse,
    ActiveTradeEnterRequest, ActiveTradeEnterResponse, ActiveTradeOut, ActiveTradeListResponse,
)
import bar_cache
from bar_cache import get_history as _bc_hist, get_info as _bc_info
from bar_cache import get_option_dates as _bc_opt_dates, get_option_chain as _bc_chain
from analysis import generate_signals
from day_trade import run_day_trade_scan, underlying_intraday_snapshot_for_active_trade, clear_scan_cache as _clear_day_scan_cache
from ai_coach import get_ai_coach
from swing_trade import run_swing_trade_scan, clear_scan_cache as _clear_swing_scan_cache
from quote_cache import get_quotes as _get_quotes
from active_trade_decision import build_active_trade_decision
from engine import run_engine, MIN_CREDIT_PCT_OF_WIDTH, TARGET_SHORT_DELTA_CREDIT, DTE_CREDIT_MIN, DTE_CREDIT_MAX
from auth_routes import auth_router, ensure_same_user, require_access_email
from command_center_router import command_center_router, api_envelope, _seed_default_my_tickers
from decision_resolver import resolve_trade_decision
from storage import (
    alert_center_active_counts_by_ticker,
    alert_center_create,
    add_user_alert,
    add_day_trade_alert_event,
    clear_user_alerts,
    dismiss_user_alert,
    DAY_TRADE_ALERT_RETENTION_MS,
    get_day_trade_watchlist_last,
    get_user_alerts,
    get_user_state,
    init_db,
    list_day_trade_alert_events,
    list_user_states,
    normalize_email,
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
    upsert_ticker_state_last,
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


ALERT_RETENTION_MS = 24 * 60 * 60 * 1000
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


ALERT_SCAN_INTERVAL_SECONDS = int(os.getenv("ALERT_SCAN_INTERVAL_SECONDS", "900"))
ALERT_SCAN_START_DELAY_SECONDS = int(os.getenv("ALERT_SCAN_START_DELAY_SECONDS", "20"))
ALERT_SCAN_MARKET_HOURS_ONLY = os.getenv("ALERT_SCAN_MARKET_HOURS_ONLY", "true").lower() != "false"
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

# Separate in-memory cache for user-facing /api/analyze requests
analyze_user_cache: dict[str, tuple[float, "AnalyzeResponse"]] = {}
analyze_user_cache_lock = threading.Lock()

analysis_cache_lock = threading.Lock()
analysis_cache: dict[str, tuple[float, AnalyzeResponse]] = {}

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
        if new_level_key and new_level_key != prev_level_key:
            alert_center_create(
                email,
                alert_group="day-trade",
                severity="WARNING",
                engine="DAY_TRADE",
                signal="LEVEL_RETEST",
                title=level_title,
                body=level_body,
                meta={"ticker": t, "level_key": new_level_key},
            )
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

        if prev_verdict == "WATCH" and now_verdict in {"GO", "STRONG GO"}:
            now_ms = int(time.time() * 1000)
            alert_id = f"dt-{t}-{now_ms}"
            escalations.append(
                {
                    "id": alert_id,
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
                    "detectedAt": now_ms,
                }
            )

        # --- State transition alert (Day Trade — only Setup→Entry) ---
        eg_state = str(getattr(r.entry_guidance, "state", "") or "")
        now_state_num = _day_trade_active_state(eg_state)
        prev_state_row = get_ticker_state_last(email, t, "DAY")
        prev_state_num = int((prev_state_row or {}).get("state_num") or 1)
        prev_action = (prev_state_row or {}).get("action", "") if prev_state_row else ""
        if eg_state and (prev_state_num, now_state_num) == (1, 2) and prev_state_row is not None:
            direction = _STATE_DIRECTION.get(
                (prev_state_num, now_state_num),
                f"{_STATE_LABEL.get(prev_state_num, str(prev_state_num))} → {_STATE_LABEL.get(now_state_num, str(now_state_num))}"
            )
            now_ms_sc = int(time.time() * 1000)
            eg_dict = r.entry_guidance if isinstance(r.entry_guidance, dict) else {}
            alert_center_create(
                email,
                alert_group="day-trade",
                severity="INFO",
                engine="DAY_TRADE",
                signal="STATE_CHANGE",
                title=f"⚡ {t} — Day Trade: {_STATE_LABEL.get(now_state_num, eg_state)}",
                body=f"Day Trade state changed: {_STATE_LABEL.get(prev_state_num, prev_action)} → {_STATE_LABEL.get(now_state_num, eg_state)} ({eg_state})",
                meta={"ticker": t, "state": eg_state, "state_num": now_state_num, "prev_state": prev_action, "prev_state_num": prev_state_num},
            )
            escalations.append({
                "id":           f"dt-state-{t}-{now_ms_sc}",
                "alertType":    "STATE_CHANGE",
                "ticker":       t,
                "companyName":  getattr(r, "company_name", None) or t,
                "engine":       "DAY",
                "prevState":    prev_state_num,
                "prevLabel":    _STATE_LABEL.get(prev_state_num, str(prev_state_num)),
                "nowState":     now_state_num,
                "nowLabel":     _STATE_LABEL.get(now_state_num, str(now_state_num)),
                "direction":    direction,
                "action":       eg_state,
                "egAction":     str(eg_dict.get("action") or ""),
                "bias":         str(getattr(r, "bias", "") or "").upper(),
                "sessionDate":  session_date,
                "currentPrice": eg_dict.get("current_price") or (r.metrics or {}).get("last_price"),
                "vwap":         eg_dict.get("vwap") or (r.metrics or {}).get("vwap"),
                "orh":          eg_dict.get("opening_range_high") or (r.metrics or {}).get("or_high"),
                "orl":          eg_dict.get("opening_range_low") or (r.metrics or {}).get("or_low"),
                "breakoutLevel": eg_dict.get("breakout_level"),
                "scalp_target": eg_dict.get("scalp_target"),
                "riskBelow":    eg_dict.get("risk_below"),
                "summary":      eg_dict.get("summary") or eg_dict.get("action") or "",
                "decisionMsg":  str((getattr(r, "trader_decision", None) or {}).get("decision_message") or ""),
                "narrowOrCaution": False,
                "orWidthPct":   None,
            })
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

            if new_level_key and new_level_key != prev_level_key:
                alert_center_create(
                    email,
                    alert_group="day-trade",
                    severity="WARNING",
                    engine="DAY_TRADE",
                    signal="LEVEL_RETEST",
                    title=level_title,
                    body=level_body,
                    meta={"ticker": t, "level_key": new_level_key, "source": "active_trade"},
                )
        carry_level_key = new_level_key if new_level_key else prev_level_key
        eg_state = str(getattr(r.entry_guidance, "state", "") or "")
        upsert_day_trade_watchlist_last(email, t, now_verdict, session_date, carry_level_key, eg_state)
    except Exception as exc:
        print(f"[day-trade-scan/active] {email} active-trades scan failed: {exc}", flush=True)

    if not escalations:
        return

    if _user_wants_trade_alert_emails(user_state):
        result = _send_day_trade_escalation_email(email, user_name, escalations)
    else:
        result = {"sent": False, "message": USER_ALERT_EMAIL_DISABLED_MESSAGE}
    message = str(result.get("message", ""))
    sent = bool(result.get("sent"))
    for row in escalations:
        row["emailSent"] = sent
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
        saved = save_user_state(
            normalized_email,
            payload.watchlist,
            payload.portfolio,
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
        opt_dates = _bc_opt_dates(ticker)
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
        calls_raw, puts_raw = _bc_chain(ticker, target_expiry)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch options chain: {str(e)}")

    # Info
    try:
        info = _bc_info(ticker)
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

    # Run engine
    try:
        trades = run_engine(signals, calls_f, puts_f, list(opt_dates),
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
        recs_out.append(RecommendationOut(
            rank=rank,
            strategy=trade.strategy,
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
        market_bias=resolved.market_bias,
        setup_quality=resolved.setup_quality,
        execution_readiness=resolved.execution_readiness,
        final_decision=resolved.final_decision,
        confidence=resolved.confidence,
        reason=resolved.reason,
        supporting_factors=resolved.supporting_factors,
        missing_confirmations=resolved.missing_confirmations,
        risk_state=resolved.risk_state,
        signal_quality=resolved.signal_quality or "",
        execution_timing=resolved.execution_timing or "",
        risk_category=resolved.risk_category or "",
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

    for mt in state.get("my_tickers") or []:
        sym = str(mt.get("symbol", "") or "").strip().upper()
        if not sym:
            continue
        types = mt.get("trade_types") or ["regular"]
        company = str(mt.get("company_name", "") or "")
        for src in types:
            ensure_item(sym, source=src, notes=company)

    return sorted(merged.values(), key=lambda x: (str(x.get("ticker") or "")))


def _signal_feed_decision_payload(decision: Any, *, label: str, raw_signal: str = "", reason: str = "") -> dict[str, Any]:
    reason_text = str(reason or "")
    if decision is None:
        final_decision = "WATCH"
    else:
        resolved = str(decision.final_decision or "").upper()
        if resolved in {"EXIT", "SCALE_OUT", "MANAGE"}:
            final_decision = "MANAGE"
        elif resolved in {"AVOID", "NO_EDGE"}:
            final_decision = "AVOID"
        elif resolved == "READY":
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
            "execution_readiness": "WAIT",
            "final_decision": final_decision,
            "confidence": 0,
            "reason": reason_text or f"{label.title()} evaluation unavailable.",
            "supporting_factors": [],
            "missing_confirmations": [],
            "risk_state": "MEDIUM",
            "raw_signal": raw_signal,
            "signal_quality": "",
            "execution_timing": "",
            "risk_category": "",
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
        "execution_readiness": decision.execution_readiness,
        "final_decision": final_decision,
        "confidence": decision.confidence,
        "reason": decision.reason or reason_text,
        "supporting_factors": list(decision.supporting_factors or []),
        "missing_confirmations": list(decision.missing_confirmations or []),
        "risk_state": decision.risk_state,
        "raw_signal": raw_signal,
        "signal_quality": getattr(decision, "signal_quality", "") or "",
        "execution_timing": getattr(decision, "execution_timing", "") or "",
        "risk_category": getattr(decision, "risk_category", "") or "",
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
    )
    with analyze_user_cache_lock:
        analyze_user_cache[key] = (time.time(), data)
    return data


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
    state = get_user_state(email)
    if not state.get("my_tickers"):
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

    # Bulk-prefetch quotes into the shared cache before the engine loop.
    # This fills the quote cache so engine calls that read from it find a
    # warm entry and do not independently re-fetch the same ticker.
    all_tickers = [
        str(item.get("ticker") or "").strip().upper()
        for item in source_items
        if item.get("ticker")
    ]
    _prefetched_quotes, _cache_meta = _get_quotes(all_tickers, force_refresh=refresh)
    alert_counts = alert_center_active_counts_by_ticker(email, all_tickers)

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
            regular_raw = regular_data.final_decision
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
            swing_raw = swing_scan.final_action
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
        _row_cache_age = round(_q.cache_age_seconds, 1) if _q else 0.0
        _row_quote_source = _q.source if _q else "unavailable"
        regular_payload = _signal_feed_decision_payload(regular_decision, label="regular", raw_signal=regular_raw, reason=regular_reason)
        day_payload = _signal_feed_decision_payload(day_decision, label="day", raw_signal=day_raw, reason=day_reason)
        swing_payload = _signal_feed_decision_payload(swing_decision, label="swing", raw_signal=swing_raw, reason=swing_reason)

        # ── State change detection for all three engines ──────────────────────
        today = datetime.today().strftime('%Y-%m-%d')
        for eng, action in [("DAY", day_raw), ("SWING", swing_raw), ("REGULAR", regular_raw)]:
            if action:
                prev = get_ticker_state_last(email, ticker, eng)
                prev_action = (prev or {}).get("action", "")
                if action and action != prev_action:
                    alert_center_create(
                        email,
                        alert_group=eng.lower(),
                        severity="INFO",
                        engine=eng,
                        signal="STATE_CHANGE",
                        title=f"⚡ {ticker} — {eng.title()} state: {action}",
                        body=f"State changed from '{prev_action}' to '{action}'.",
                        meta={"ticker": ticker, "state": action, "prev_state": prev_action},
                    )
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
        row_metrics = {
            "rsi": round(rsi, 2),
            "relative_strength": round(relative_strength, 2),
            "volume_ratio": round(float(swing_metrics.get("volume_ratio") or 0.0), 2) if swing_metrics.get("volume_ratio") is not None else None,
            "iv_rank": round(iv_rank, 2) if iv_rank else None,
            "bull_score": round(dominant_bull, 2) if dominant_bull else None,
            "bear_score": round(dominant_bear, 2) if dominant_bear else None,
            "trend_score": round(trend_score, 2) if trend_score else None,
            "market_context": _signal_feed_market_context_label(day_metrics, swing_metrics),
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

    _elapsed_ms = round((_time.time() - _t0) * 1000)
    logging.getLogger(__name__).info(
        "WATCHLISTX_LOAD ticker_count=%d cache_hits=%d cache_misses=%d "
        "yahoo_fetch_count=%d elapsed_ms=%d force_refresh=%s",
        len(all_tickers),
        _cache_meta.get("cache_hits", 0),
        _cache_meta.get("cache_misses", 0),
        _cache_meta.get("cache_misses", 0),  # each miss = one Yahoo batch call
        _elapsed_ms,
        refresh,
    )

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
                "used_cache": _cache_meta.get("used_cache", False),
                "cache_hits": _cache_meta.get("cache_hits", 0),
                "cache_misses": _cache_meta.get("cache_misses", 0),
                "force_refresh": refresh,
                "oldest_cache_age_seconds": _cache_meta.get("oldest_cache_age_seconds", 0.0),
                "source": _cache_meta.get("source", "unknown"),
                "elapsed_ms": _elapsed_ms,
            },
            "rows": paged_rows,
        },
        stale=False,
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
    all_tickers = [
        str(item.get("ticker") or "").strip().upper()
        for item in source_items
        if item.get("ticker")
    ]
    # Warm the quote cache first so downstream engine calls find entries
    _prefetched_quotes, _cache_meta = _get_quotes(all_tickers, force_refresh=True)

    logging.getLogger(__name__).info(
        "WATCHLISTX_REFRESH ticker_count=%d yahoo_fetch_count=%d elapsed_ms=%d",
        len(all_tickers),
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

    dt_cleared = _clear_day_scan_cache()
    sw_cleared = _clear_swing_scan_cache()

    total = bc_cleared + qc_cleared + ac_cleared + auc_cleared + dt_cleared + sw_cleared
    logging.getLogger(__name__).info(
        "CACHE_CLEAR bar=%d quote=%d analysis=%d analyze_user=%d day_scan=%d swing_scan=%d total=%d",
        bc_cleared, qc_cleared, ac_cleared, auc_cleared, dt_cleared, sw_cleared, total,
    )

    return api_envelope({
        "ok": True,
        "cleared": {
            "bar_cache":          bc_cleared,
            "quote_cache":        qc_cleared,
            "analysis_cache":     ac_cleared,
            "analyze_user_cache": auc_cleared,
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
        r = run_day_trade_scan(req.ticker)
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
            execution_readiness=resolved.execution_readiness,
            final_decision=resolved.final_decision,
            confidence=resolved.confidence,
            reason=resolved.reason,
            supporting_factors=resolved.supporting_factors,
            missing_confirmations=resolved.missing_confirmations,
            risk_state=resolved.risk_state,
            signal_quality=resolved.signal_quality or "",
            execution_timing=resolved.execution_timing or "",
            risk_category=resolved.risk_category or "",
            explanation=dict(resolved.explanation or {}),
            risk_reason=resolved.risk_reason or "",
            display_confidence=int(resolved.display_confidence or 0),
            execution_fields=list(resolved.execution_fields or []),
            entry_guidance=dict(r.entry_guidance or {}),
            option_risk_context=dict(r.option_risk_context or {}),
            ai_coach=ai_coach_result,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e)) from None


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
        r = run_swing_trade_scan(req.ticker)
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
            execution_readiness=resolved.execution_readiness,
            final_decision=resolved.final_decision,
            confidence=resolved.confidence,
            reason=resolved.reason,
            supporting_factors=resolved.supporting_factors,
            missing_confirmations=resolved.missing_confirmations,
            risk_state=resolved.risk_state,
            signal_quality=resolved.signal_quality or "",
            execution_timing=resolved.execution_timing or "",
            risk_category=resolved.risk_category or "",
            expected_holding_period=str(getattr(r, "expected_holding_period", "") or ""),
            recommended_contract_duration=str(getattr(r, "recommended_contract_duration", "") or ""),
            explanation=dict(resolved.explanation or {}),
            risk_reason=resolved.risk_reason or "",
            display_confidence=int(resolved.display_confidence or 0),
            execution_fields=list(resolved.execution_fields or []),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e)) from None


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
    ok = exit_active_trade(email, trade_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Active trade not found or already exited")
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
    if fa in {"READY", "STRONG_GO", "GO_SMALL", "TRADE"}:
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


def _scan_my_tickers_for_state_alerts(user_state: dict) -> None:
    email = user_state.get("email", "").strip().lower()
    if not email:
        return

    # my_tickers uses "symbol" key; support both for safety
    raw_tickers = user_state.get("my_tickers") or []
    if not raw_tickers:
        return

    if not user_state.get("alert_email_enabled", True):
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

            if prev is None:
                inplay_since = now_ms if now_state == 3 else 0
                upsert_ticker_state_last(
                    email, ticker, "DAY", now_state, now_action, sd,
                    target_hit=0, inplay_since_ms=inplay_since, weak_breakout_alerted=0,
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

                    last_price_val = eg.get("current_price") or m.get("last_price")
                    orh_val        = eg.get("opening_range_high") or m.get("or_high")
                    orl_val        = eg.get("opening_range_low")  or m.get("or_low")

                    # ── State-change alert (only 1→2: Setup→Entry) ──
                    if state_changed and (prev_state, now_state) == (1, 2):
                        direction = _STATE_DIRECTION.get(
                            (prev_state, now_state),
                            f"{_STATE_LABEL.get(prev_state, str(prev_state))} → {_STATE_LABEL.get(now_state, str(now_state))}"
                        )

                        # Gap 3 — narrow OR filter: flag compressed opening ranges on IN-PLAY entry
                        narrow_or_caution = False
                        or_width_pct_val  = None
                        if now_state == 3 and orh_val is not None and orl_val is not None:
                            try:
                                _orh = float(orh_val)
                                _orl = float(orl_val)
                                if _orl > 0:
                                    or_width_pct_val  = round((_orh - _orl) / _orl * 100, 2)
                                    narrow_or_caution = or_width_pct_val < _NARROW_OR_ALERT_PCT
                            except (TypeError, ValueError):
                                pass

                        day_escalations.append({
                            "id":             f"dt-state-{ticker}-{now_ms}",
                            "alertType":      "STATE_CHANGE",
                            "ticker":         ticker,
                            "companyName":    getattr(dr, "company_name", None) or ticker,
                            "engine":         "DAY",
                            "prevState":      prev_state,
                            "prevLabel":      _STATE_LABEL.get(prev_state, str(prev_state)),
                            "nowState":       now_state,
                            "nowLabel":       _STATE_LABEL.get(now_state, str(now_state)),
                            "direction":      direction,
                            "action":         now_action,
                            "egAction":       eg_action,
                            "bias":           bias_label,
                            "sessionDate":    sd,
                            "currentPrice":   last_price_val,
                            "vwap":           eg.get("vwap") or m.get("vwap"),
                            "orh":            orh_val,
                            "orl":            orl_val,
                            "breakoutLevel":  eg.get("breakout_level"),
                            "scalp_target":   eg.get("scalp_target"),
                            "riskBelow":      eg.get("risk_below"),
                            "summary":        eg.get("summary") or eg.get("action") or "",
                            "decisionMsg":    str((dr.trader_decision or {}).get("decision_message") or ""),
                            "narrowOrCaution":narrow_or_caution,
                            "orWidthPct":     or_width_pct_val,
                        })

                    # ── ENTER NOW alert (State 2 + volume confirmed) ─────
                    enter_now_to_store = carry_enter_now
                    exec_timing = str(dr.execution_timing or "").upper().strip()
                    enter_now_confirmed = now_state == 2 and ("ENTER" in exec_timing)
                    if enter_now_confirmed and not carry_enter_now:
                        enter_now_to_store = 1
                        direction_lbl = "LONG · CALL" if bias_raw == "long" else "SHORT · PUT"
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
                            "vwap":         eg.get("vwap") or m.get("vwap"),
                            "orh":          orh_val,
                            "orl":          orl_val,
                            "breakoutLevel": eg.get("breakout_level"),
                            "scalp_target": eg.get("scalp_target"),
                            "riskBelow":    eg.get("risk_below"),
                            "summary":      f"Volume confirmed — entry window open. Action: Ready · Execution: Enter Now.",
                            "decisionMsg":  eg.get("summary") or eg.get("action") or "",
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

                    upsert_ticker_state_last(
                        email, ticker, "DAY", now_state, now_action, sd,
                        target_hit=target_to_store,
                        inplay_since_ms=inplay_since,
                        weak_breakout_alerted=weak_bo_to_store,
                        enter_now_alerted=enter_now_to_store,
                    )
        except Exception as exc:
            print(f"[state-scan] DAY {email} {ticker} failed: {exc}", flush=True)

    if not day_escalations:
        return

    public_base = _option_advisor_public_base()
    try:
        tickers_str    = ", ".join(sorted({it["ticker"] for it in day_escalations}))
        target_items   = [it for it in day_escalations if it.get("alertType") == "TARGET_REACHED"]
        weak_bo_items  = [it for it in day_escalations if it.get("alertType") == "WEAK_BREAKOUT"]
        state_items    = [it for it in day_escalations if it.get("alertType") == "STATE_CHANGE"]
        if target_items and not state_items and not weak_bo_items:
            subject = f"💰 OptionAdvisor: Take-profit target hit — {tickers_str}"
        elif weak_bo_items and not state_items and not target_items:
            subject = f"⚠️ OptionAdvisor: Breakout stalling — {tickers_str}"
        elif target_items or weak_bo_items:
            subject = f"⚡ OptionAdvisor: Day trade alert — {tickers_str}"
        else:
            count = len(state_items)
            subject = f"⚡ OptionAdvisor: {count} day-trade state change{'s' if count != 1 else ''} — {tickers_str}"
        html_body = _build_state_transition_email_html(email, user_name, day_escalations, public_base=public_base)
        _deliver_html_email(email, user_name, subject, html_body)
        print(f"[state-scan] sent {len(day_escalations)} DAY alert(s) to {email}", flush=True)
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


def _alert_scan_loop() -> None:
    time.sleep(ALERT_SCAN_START_DELAY_SECONDS)
    cycle = 0
    while True:
        try:
            if _is_market_hours_now():
                users = list_user_states()
                for idx, user_state in enumerate(users):
                    if idx:
                        time.sleep(2)
                    _scan_user_watchlist_for_alerts(user_state)
                    time.sleep(2)
                    _scan_user_day_trade_watchlist(user_state)
                    time.sleep(2)
                    # My Tickers state alerts: day every cycle (15 min),
                    # swing every 2nd cycle (~30 min) to avoid over-scanning.
                    _scan_my_tickers_for_state_alerts(user_state)
        except Exception as exc:
            print(f"[alert-scan] sweep failed: {exc}", flush=True)
        cycle += 1
        time.sleep(ALERT_SCAN_INTERVAL_SECONDS)


@app.on_event("startup")
def start_alert_scanner() -> None:
    thread = threading.Thread(target=_alert_scan_loop, name="alert-scan-loop", daemon=True)
    thread.start()


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


@app.get("/api/alerts/{email}")
def list_alerts(email: str, auth_email: str = Depends(require_access_email)):
    ensure_same_user(auth_email, email)
    return {
        "email": email.strip().lower(),
        "alerts": get_user_alerts(email, ALERT_RETENTION_MS, int(time.time() * 1000)),
    }


@app.post("/api/alerts/dismiss")
def dismiss_alert(req: AlertDismissRequest, auth_email: str = Depends(require_access_email)):
    ensure_same_user(auth_email, req.email)
    dismiss_user_alert(req.email, req.alert_id)
    return {"ok": True}


@app.post("/api/alerts/clear")
def clear_alerts(req: AlertClearRequest, auth_email: str = Depends(require_access_email)):
    ensure_same_user(auth_email, req.email)
    clear_user_alerts(req.email)
    return {"ok": True}


@app.post("/api/alerts/scan/{email}")
def scan_alerts_now(email: str, auth_email: str = Depends(require_access_email)):
    ensure_same_user(auth_email, email)
    _scan_user_watchlist_for_alerts(get_user_state(email))
    return {
        "email": email.strip().lower(),
        "alerts": get_user_alerts(email, ALERT_RETENTION_MS, int(time.time() * 1000)),
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


@app.post("/api/backtest")
def backtest_strategy(request: BacktestRequest):
    return _run_backtest_endpoint(request)


# Alias for nginx configs that strip the /api prefix (proxy_pass .../ without /api).
@app.post("/backtest")
def backtest_strategy_proxy_alias(request: BacktestRequest):
    return _run_backtest_endpoint(request)


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


def _compute_mtm_pnl(legs: list[dict], S: float, T_years: float) -> float:
    """
    Mark-to-market P&L per share using Black-Scholes.
    Uses each leg's stored IV (as decimal, e.g. 0.30 = 30%) for pricing.
    Falls back to HV-20 proxy if IV is missing/zero.
    """
    from backtest import bs_price, RISK_FREE_RATE
    pnl = 0.0
    for leg in legs:
        iv = float(leg.get("iv", 0) or 0)
        if iv <= 0.005:
            iv = 0.25  # fallback
        strike     = float(leg.get("strike", 0))
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
    # Auto-refresh OPEN entries that have stale (zero) current_price
    for e in entries:
        if e.get("status") == "OPEN" and not e.get("current_price"):
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
    delete_journal_entry(normalized, entry_id)
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


# ─── User accent preference ───────────────────────────────────────────────

@app.get("/api/user/accent")
def get_user_accent(auth_email: str = Depends(require_access_email)):
    """Get the user's selected accent color."""
    state = get_user_state(normalize_email(auth_email))
    return {"accent": state.get("theme_accent", "blue")}


@app.put("/api/user/accent")
def set_user_accent(auth_email: str = Depends(require_access_email), body: dict = None):
    """Save the user's selected accent color."""
    email = normalize_email(auth_email)
    accent = str(body.get("accent", "blue"))
    save_user_state(email, theme_accent=accent)
    return {"ok": True, "accent": accent}
