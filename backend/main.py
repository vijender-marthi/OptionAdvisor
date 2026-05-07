"""
main.py — FastAPI Backend
==========================
Run: uvicorn main:app --reload --port 9000
"""

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
import yfinance as yf
import pandas as pd
import numpy as np
from math import erf, log, sqrt
from dataclasses import asdict
import smtplib
import os
import json
import threading
import time
from collections import defaultdict
import html
import urllib.error
import urllib.request
from urllib.parse import quote, urlparse
from datetime import datetime
from zoneinfo import ZoneInfo
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr
from pathlib import Path
from dotenv import load_dotenv

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
from analysis import generate_signals
from day_trade import run_day_trade_scan, underlying_intraday_snapshot_for_active_trade
from swing_trade import run_swing_trade_scan
from active_trade_decision import build_active_trade_decision
from engine import run_engine, MIN_CREDIT_PCT_OF_WIDTH, TARGET_SHORT_DELTA_CREDIT, DTE_CREDIT_MIN, DTE_CREDIT_MAX
from auth_routes import auth_router, ensure_same_user, require_access_email
from storage import (
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
)

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
FINDER_VALID_WEEKS_OUT = frozenset({2, 3, 4, 6})
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
    now = datetime.now(ZoneInfo("America/Los_Angeles"))
    if now.weekday() >= 5:
        return False
    minutes = now.hour * 60 + now.minute
    return 6 * 60 <= minutes < 16 * 60


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


def _scan_user_day_trade_watchlist(user_state: dict) -> None:
    email = user_state.get("email", "").strip().lower()
    if not email or user_state.get("role") != "admin":
        return
    symbols = user_state.get("day_trade_watchlist") or []
    if not symbols:
        return

    user_name = email.split("@")[0] or email
    escalations: list[dict] = []

    for ti, ticker in enumerate(symbols):
        if ti:
            time.sleep(0.6)
        t = str(ticker).strip().upper()
        if not t:
            continue
        try:
            r = run_day_trade_scan(t)
        except Exception as exc:
            print(f"[day-trade-scan] {email} {t} failed: {exc}", flush=True)
            continue

        session_date = str((r.metrics or {}).get("session_date") or "").strip()[:10]
        now_verdict = _norm_day_trade_verdict(r.verdict)
        prev_row = get_day_trade_watchlist_last(email, t)

        if not prev_row:
            upsert_day_trade_watchlist_last(email, t, now_verdict, session_date)
            continue

        prev_session = (prev_row.get("session_date") or "").strip()[:10]
        prev_verdict = _norm_day_trade_verdict(prev_row.get("verdict"))

        if prev_session and session_date and prev_session != session_date:
            upsert_day_trade_watchlist_last(email, t, now_verdict, session_date)
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

        upsert_day_trade_watchlist_last(email, t, now_verdict, session_date)

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
        # yfinance's history() goes through cache_get() which is an in-process LRU cache.
        # Clearing it forces a fresh HTTP fetch so we never serve yesterday's close as today's price.
        try:
            from yfinance.data import YfData
            YfData.cache_get.cache_clear()
        except Exception:
            pass  # not critical — carry on if internals change in a future yfinance version

        stock = yf.Ticker(ticker)
        hist = stock.history(period="1y")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch data: {str(e)}")

    if hist is None or hist.empty:
        raise HTTPException(status_code=404, detail=f"No data found for ticker '{ticker}'")

    if len(hist) < 60:
        raise HTTPException(status_code=400, detail=f"Insufficient history for '{ticker}' (need at least 60 days)")

    # Options chain
    try:
        opt_dates = stock.options
    except:
        opt_dates = []

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
        #   target_dte = weeks_out * 7,  window = ±7 days
        target_dte = weeks_out * 7
        dte_lo = max(7, target_dte - 7)
        dte_hi = target_dte + 7
        target_expiry = _pick_expiry(list(opt_dates), dte_lo, dte_hi)
        if target_expiry is None:
            # Fallback: pick the nearest available expiry beyond dte_lo
            target_expiry = next(
                (d for d in opt_dates if (datetime.strptime(d, "%Y-%m-%d") - datetime.today()).days >= dte_lo - 3),
                opt_dates[min(2, len(opt_dates) - 1)]
            )

    try:
        chain = stock.option_chain(target_expiry)
        calls_raw = chain.calls.copy()
        puts_raw = chain.puts.copy()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch options chain: {str(e)}")

    # Info
    try:
        info = stock.info
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


def _require_admin_role(auth_email: str, detail: str) -> None:
    if get_user_state(normalize_email(auth_email)).get("role") != "admin":
        raise HTTPException(status_code=403, detail=detail)


@app.post("/api/day-trade", response_model=DayTradeResponse)
def day_trade_scan(
    req: DayTradeRequest,
    auth_email: str = Depends(require_access_email),
):
    """
    Intraday prototype: 1m RTH, VWAP / OR / momentum / volume + RS vs QQQ session + confidence block;
    verdicts: STRONG GO, GO, WATCH (weak volume), NO-GO, WAIT.
    Restricted to users with the administrator role.
    """
    _require_admin_role(auth_email, "Day Trading requires administrator access.")
    try:
        r = run_day_trade_scan(req.ticker)
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
    Restricted to users with the administrator role.
    """
    _require_admin_role(auth_email, "Swing Trade requires administrator access.")
    try:
        r = run_swing_trade_scan(req.ticker)
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


def _alert_scan_loop() -> None:
    time.sleep(ALERT_SCAN_START_DELAY_SECONDS)
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
        except Exception as exc:
            print(f"[alert-scan] sweep failed: {exc}", flush=True)
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
)
from pydantic import BaseModel as _BM

init_journal_db()


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


class JournalCloseRequest(_BM):
    exit_reason: str = "MANUAL"
    notes: str = ""


class JournalNotesRequest(_BM):
    notes: str


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
        tkr = yf.Ticker(ticker_str)

        if today > expiry_dt:
            # Expired: compute intrinsic P&L from closing price on/after expiry date
            hist = tkr.history(
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
            info = tkr.info
            S = safe_float(info.get("currentPrice") or info.get("regularMarketPrice") or 0)
            if S <= 0:
                hist = tkr.history(period="5d", auto_adjust=True)
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


@app.delete("/api/journal/{email}/{entry_id}")
def journal_delete(email: str, entry_id: str, auth_email: str = Depends(require_access_email)):
    """Delete a journal entry."""
    ensure_same_user(auth_email, email)
    normalized = email.strip().lower()
    delete_journal_entry(normalized, entry_id)
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
