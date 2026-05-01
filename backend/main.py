"""
main.py — FastAPI Backend
==========================
Run: uvicorn main:app --reload --port 9000
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import yfinance as yf
import pandas as pd
import numpy as np
from math import erf, log, sqrt
from dataclasses import asdict
import smtplib
import os
import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr
from dotenv import load_dotenv

load_dotenv()

from models import (
    AnalyzeRequest, AnalyzeResponse, RecommendationOut, OptionLegOut,
    OptionRowOut, PricePoint, SignalsOut, ScoreBreakdown,
    UserDataRequest, UserDataResponse, AlertEmailRequest, AlertItem,
    AlertDismissRequest, AlertClearRequest,
)
from analysis import generate_signals
from engine import run_engine, MIN_CREDIT_PCT_OF_WIDTH, TARGET_SHORT_DELTA_CREDIT, DTE_CREDIT_MIN, DTE_CREDIT_MAX
from storage import (
    add_user_alert, clear_user_alerts, dismiss_user_alert, get_user_alerts,
    get_user_state, init_db, list_user_states, save_user_state,
    update_user_alert_email,
)

# ── SMTP config from environment (optional — email silently skipped if absent) ─
SMTP_HOST     = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT     = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER     = os.getenv("SMTP_USER", "")      # your Gmail address
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")  # Gmail App Password
SMTP_FROM     = os.getenv("SMTP_FROM", SMTP_USER)
ALERT_RETENTION_MS = 24 * 60 * 60 * 1000
ALERT_SCAN_INTERVAL_SECONDS = int(os.getenv("ALERT_SCAN_INTERVAL_SECONDS", "900"))
ALERT_SCAN_START_DELAY_SECONDS = int(os.getenv("ALERT_SCAN_START_DELAY_SECONDS", "20"))
ALERT_SCAN_MARKET_HOURS_ONLY = os.getenv("ALERT_SCAN_MARKET_HOURS_ONLY", "true").lower() != "false"
ALERT_ANALYSIS_CACHE_TTL_SECONDS = int(os.getenv("ALERT_ANALYSIS_CACHE_TTL_SECONDS", str(ALERT_SCAN_INTERVAL_SECONDS)))

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

app = FastAPI(title="Options Trade Advisor API", version="2.0")
init_db()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4200", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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


@app.get("/")
def root():
    return {"status": "ok", "message": "Options Trade Advisor API v2.0"}


def _is_market_hours_now() -> bool:
    if not ALERT_SCAN_MARKET_HOURS_ONLY:
        return True
    now = datetime.now(ZoneInfo("America/Los_Angeles"))
    if now.weekday() >= 5:
        return False
    minutes = now.hour * 60 + now.minute
    return 6 * 60 <= minutes < 16 * 60


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


def _build_alert_html(email: str, alerts: list, user_name: str | None = None) -> str:
    """Render a clean HTML email for GO-trade alerts."""
    display_name = (user_name or "").strip() or email
    rows_html = ""
    for a in alerts:
        pop_pct  = f"{round(a.pop * 100)}%"
        ev_str   = f"${round(a.ev * 100, 0):+.0f}"  # per contract
        profit   = f"${round(a.max_profit * 100, 0):.0f}"
        loss     = f"${round(a.max_loss * 100, 0):.0f}"
        credit   = f"${round(a.net_credit * 100, 2):.2f}" if a.net_credit > 0 else f"-${round(abs(a.net_credit) * 100, 2):.2f}"
        bias_color = "#22c55e" if "bull" in a.bias.lower() else "#ef4444" if "bear" in a.bias.lower() else "#f59e0b"
        rows_html += f"""
        <tr style="border-bottom:1px solid #2d2d3a;">
          <td style="padding:10px 12px;font-weight:700;color:#e2e8f0;">{a.ticker}</td>
          <td style="padding:10px 12px;color:#a78bfa;font-weight:600;">{a.strategy}</td>
          <td style="padding:10px 12px;color:{bias_color};">{a.bias}</td>
          <td style="padding:10px 12px;color:#94a3b8;">{a.expiry} ({a.dte}d)</td>
          <td style="padding:10px 12px;color:#4ade80;font-family:monospace;">{profit}</td>
          <td style="padding:10px 12px;color:#f87171;font-family:monospace;">{loss}</td>
          <td style="padding:10px 12px;color:#e2e8f0;font-family:monospace;">{credit}</td>
          <td style="padding:10px 12px;color:#e2e8f0;font-family:monospace;">{pop_pct}</td>
          <td style="padding:10px 12px;color:{'#4ade80' if a.ev > 0 else '#f87171'};font-family:monospace;">{ev_str}</td>
          <td style="padding:10px 12px;text-align:center;">
            <span style="background:#166534;color:#4ade80;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700;">✅ GO</span>
          </td>
        </tr>"""

    window_label = alerts[0].time_window if alerts else ""
    count = len(alerts)
    plural = "trade" if count == 1 else "trades"

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0f0f17;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:780px;margin:32px auto;background:#1a1a2e;border-radius:16px;overflow:hidden;border:1px solid #2d2d3a;">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#4c1d95,#312e81);padding:24px 28px;">
      <div style="display:flex;align-items:center;gap:12px;">
        <div style="width:36px;height:36px;background:#7c3aed;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;">📈</div>
        <div>
          <div style="font-size:18px;font-weight:800;color:#fff;">OptionAdvisor — GO Trade Alert</div>
          <div style="font-size:13px;color:#c4b5fd;margin-top:2px;">{count} new {plural} passed all checklist criteria · {window_label}</div>
        </div>
      </div>
    </div>

    <!-- Body -->
    <div style="padding:24px 28px;">
      <p style="color:#94a3b8;font-size:13px;margin:0 0 20px;">
        Hi <strong style="color:#e2e8f0;">{display_name}</strong>, the systematic engine found
        <strong style="color:#e2e8f0;">{count} GO {plural}</strong> across your watchlist
        in the <strong style="color:#a78bfa;">{window_label}</strong> scan window.
        These passed all 10 pre-trade checks — no hard fails, no soft fails.
      </p>

      <!-- Table -->
      <div style="overflow-x:auto;border-radius:12px;border:1px solid #2d2d3a;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="background:#252538;text-align:left;">
              <th style="padding:10px 12px;color:#64748b;font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:.06em;">Ticker</th>
              <th style="padding:10px 12px;color:#64748b;font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:.06em;">Strategy</th>
              <th style="padding:10px 12px;color:#64748b;font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:.06em;">Bias</th>
              <th style="padding:10px 12px;color:#64748b;font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:.06em;">Expiry</th>
              <th style="padding:10px 12px;color:#64748b;font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:.06em;">Max Profit</th>
              <th style="padding:10px 12px;color:#64748b;font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:.06em;">Max Loss</th>
              <th style="padding:10px 12px;color:#64748b;font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:.06em;">Credit</th>
              <th style="padding:10px 12px;color:#64748b;font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:.06em;">PoP</th>
              <th style="padding:10px 12px;color:#64748b;font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:.06em;">EV/cont.</th>
              <th style="padding:10px 12px;color:#64748b;font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:.06em;">Verdict</th>
            </tr>
          </thead>
          <tbody>{rows_html}
          </tbody>
        </table>
      </div>

      <!-- Disclaimer -->
      <p style="color:#475569;font-size:11px;margin:20px 0 0;line-height:1.6;">
        ⚠️ This is a systematic screen, not investment advice. Always verify the trade in the app before placing an order.
        Options trading involves substantial risk of loss.
      </p>
    </div>

    <!-- Footer -->
    <div style="background:#12121e;padding:14px 28px;display:flex;justify-content:space-between;align-items:center;">
      <span style="color:#334155;font-size:11px;">OptionAdvisor Systematic Engine v2</span>
      <span style="color:#334155;font-size:11px;">Alerts sent to {display_name} &lt;{email}&gt;</span>
    </div>
  </div>
</body>
</html>"""


@app.post("/api/send-alert")
def send_alert(req: AlertEmailRequest):
    """
    Send a GO-trade alert email.
    Silently skips if SMTP is not configured — frontend alert page still works.
    """
    return _send_alert_email(req.email, req.alerts, req.user_name)


def _send_alert_email(email: str, alerts: list, user_name: str | None = None) -> dict:
    if not SMTP_USER or not SMTP_PASSWORD:
        return {"sent": False, "message": "SMTP not configured — alert shown in app only"}

    if not alerts:
        return {"sent": False, "message": "No alerts to send"}

    try:
        html_body = _build_alert_html(email, alerts, user_name)
        count = len(alerts)
        plural = "trade" if count == 1 else "trades"
        display_name = (user_name or "").strip()
        recipient = formataddr((display_name, email)) if display_name else email

        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"🟢 OptionAdvisor: {count} GO {plural} detected — {alerts[0].time_window}"
        msg["From"]    = SMTP_FROM
        msg["To"]      = recipient
        msg.attach(MIMEText(html_body, "html"))

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=25) as server:
            server.ehlo()
            server.starttls()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.sendmail(SMTP_FROM, email, msg.as_string())

        return {"sent": True, "message": f"Alert email sent to {email}"}

    except Exception as e:
        # Don't crash the app — email is optional
        print(f"[alert-email] send failed: {e}", flush=True)
        return {"sent": False, "message": f"Email failed: {str(e)}"}


@app.get("/api/user-data/{email}", response_model=UserDataResponse)
def get_user_data(email: str):
    return get_user_state(email)


@app.put("/api/user-data/{email}", response_model=UserDataResponse)
def save_user_data(email: str, payload: UserDataRequest):
    normalized_email = email.strip().lower()
    if not normalized_email:
        raise HTTPException(status_code=400, detail="Email is required")
    return save_user_state(normalized_email, payload.watchlist, payload.portfolio)


def _analyze_ticker(
    ticker: str,
    weeks_out: int = 4,
    spread_width: int | None = None,
    strategy_mode: str = "all",
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

    # Select the expiry that matches the user's weeks_out target — the same DTE
    # window the engine uses internally so chain pricing, Greeks, and recommendations
    # all refer to the same expiry.  Mirror the engine's pick_expiry_by_dte math:
    #   target_dte = weeks_out * 7,  window = ±7 days
    from engine import pick_expiry_by_dte as _pick_expiry
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
    calls_f = calls_raw[
        (calls_raw["strike"] >= price_approx * 0.75) &
        (calls_raw["strike"] <= price_approx * 1.30)
    ].copy()
    puts_f = puts_raw[
        (puts_raw["strike"] >= price_approx * 0.75) &
        (puts_raw["strike"] <= price_approx * 1.30)
    ].copy()

    # Generate signals
    try:
        signals = generate_signals(hist, calls_f, puts_f)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Signal generation failed: {str(e)}")

    # Run engine
    try:
        trades = run_engine(signals, calls_f, puts_f, list(opt_dates),
                            spread_width_override=spread_width,
                            weeks_out=weeks_out,
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
    )

    # Price history
    price_history_out = [
        PricePoint(
            date=p["date"], close=p["close"],
            ma20=p["ma20"], ma50=p["ma50"], ma200=p["ma200"]
        )
        for p in signals.price_history
    ]

    # NTM chain for display
    ntm_calls = calls_f[
        (calls_f["strike"] >= price_approx * 0.90) &
        (calls_f["strike"] <= price_approx * 1.10)
    ].head(20)
    ntm_puts = puts_f[
        (puts_f["strike"] >= price_approx * 0.90) &
        (puts_f["strike"] <= price_approx * 1.10)
    ].head(20)

    return AnalyzeResponse(
        ticker=ticker,
        company_name=company_name,
        sector=sector,
        market_cap=market_cap,
        signals=signals_out,
        recommendations=recs_out,
        calls_chain=chain_to_output(ntm_calls, price_approx, target_expiry, "CALL"),
        puts_chain=chain_to_output(ntm_puts, price_approx, target_expiry, "PUT"),
        price_history=price_history_out,
        filters_applied={
            "chain_expiry": target_expiry,
            "min_credit_pct_of_width": MIN_CREDIT_PCT_OF_WIDTH,
            "short_delta_range": list(TARGET_SHORT_DELTA_CREDIT),
            "target_dte": f"{weeks_out}w ({weeks_out * 7}d ±7)",
            "max_bid_ask_spread_pct": 15,
            "min_open_interest": 50,
            "spread_width": spread_width if spread_width else "auto",
            "strategy_mode": strategy_mode,
        }
    )


def _cache_key(ticker: str, weeks_out: int, spread_width: int | None, strategy_mode: str) -> str:
    width_key = "auto" if spread_width is None else str(spread_width)
    return f"{ticker.upper().strip()}|{weeks_out}|{width_key}|{strategy_mode}"


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
    key = _cache_key(req.ticker, req.weeks_out, req.spread_width, req.strategy_mode)
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
    )
    with analyze_user_cache_lock:
        analyze_user_cache[key] = (time.time(), data)
    return data


def _backend_verdict_is_go(rec: RecommendationOut, sig: SignalsOut) -> bool:
    hard_fails = 0
    soft_fails = 0
    warnings = 0

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
        add("pass" if rec.expected_value > 0.04 else "warn" if rec.expected_value > 0 else "fail", hard=rec.expected_value <= 0)

    if is_credit:
        pass_threshold = 0.65 if is_income_sell else 0.62
        warn_threshold = 0.55 if is_income_sell else 0.52
        add("pass" if rec.prob_of_profit >= pass_threshold else "warn" if rec.prob_of_profit >= warn_threshold else "fail")
    else:
        add("pass" if rec.prob_of_profit >= 0.45 else "warn" if rec.prob_of_profit >= 0.35 else "fail")

    return hard_fails == 0 and soft_fails == 0 and warnings < 5


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

    for ticker in tickers:
        try:
            # Alert scans only run for tickers saved in the user's watchlist.
            # Reuse fresh backend analysis data; if absent/stale, this refreshes
            # Yahoo/options data once and stores the result for the scan window.
            data = _get_analysis_with_cache(ticker, weeks_out=4, spread_width=5, strategy_mode="all")
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
                "weeksOut": round(rec.dte / 7),
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

            result = _send_alert_email(email, [_alert_item_from_dict(alert)], user_name)
            update_user_alert_email(email, alert_id, bool(result.get("sent")), str(result.get("message", "")))


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
        except Exception as exc:
            print(f"[alert-scan] sweep failed: {exc}", flush=True)
        time.sleep(ALERT_SCAN_INTERVAL_SECONDS)


@app.on_event("startup")
def start_alert_scanner() -> None:
    thread = threading.Thread(target=_alert_scan_loop, name="alert-scan-loop", daemon=True)
    thread.start()


@app.get("/api/alerts/{email}")
def list_alerts(email: str):
    return {
        "email": email.strip().lower(),
        "alerts": get_user_alerts(email, ALERT_RETENTION_MS, int(time.time() * 1000)),
    }


@app.post("/api/alerts/dismiss")
def dismiss_alert(req: AlertDismissRequest):
    dismiss_user_alert(req.email, req.alert_id)
    return {"ok": True}


@app.post("/api/alerts/clear")
def clear_alerts(req: AlertClearRequest):
    clear_user_alerts(req.email)
    return {"ok": True}


@app.post("/api/alerts/scan/{email}")
def scan_alerts_now(email: str):
    _scan_user_watchlist_for_alerts(get_user_state(email))
    return {
        "email": email.strip().lower(),
        "alerts": get_user_alerts(email, ALERT_RETENTION_MS, int(time.time() * 1000)),
    }
