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
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from dotenv import load_dotenv

load_dotenv()

from models import (
    AnalyzeRequest, AnalyzeResponse, RecommendationOut, OptionLegOut,
    OptionRowOut, PricePoint, SignalsOut, ScoreBreakdown,
    UserDataRequest, UserDataResponse, AlertEmailRequest,
)
from analysis import generate_signals
from engine import run_engine, MIN_CREDIT_PCT_OF_WIDTH, TARGET_SHORT_DELTA_CREDIT, DTE_CREDIT_MIN, DTE_CREDIT_MAX
from storage import get_user_state, init_db, save_user_state

# ── SMTP config from environment (optional — email silently skipped if absent) ─
SMTP_HOST     = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT     = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER     = os.getenv("SMTP_USER", "")      # your Gmail address
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")  # Gmail App Password
SMTP_FROM     = os.getenv("SMTP_FROM", SMTP_USER)

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
    rows = []
    for _, row in df.iterrows():
        iv_raw = safe_float(row.get("impliedVolatility", 0))
        rows.append(OptionRowOut(
            strike=safe_float(row["strike"]),
            last_price=safe_float(row.get("lastPrice", 0)),
            bid=safe_float(row.get("bid", 0)),
            ask=safe_float(row.get("ask", 0)),
            volume=safe_int(row.get("volume", 0)),
            open_interest=safe_int(row.get("openInterest", 0)),
            implied_volatility=f"{round(iv_raw * 100, 1)}%",
            delta=estimate_delta(row, current_price, expiry, option_type),
        ))
    return rows


@app.get("/")
def root():
    return {"status": "ok", "message": "Options Trade Advisor API v2.0"}


def _build_alert_html(email: str, alerts: list) -> str:
    """Render a clean HTML email for GO-trade alerts."""
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
        The systematic engine found <strong style="color:#e2e8f0;">{count} GO {plural}</strong> across your watchlist
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
      <span style="color:#334155;font-size:11px;">Alerts sent to {email}</span>
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
    if not SMTP_USER or not SMTP_PASSWORD:
        return {"sent": False, "message": "SMTP not configured — alert shown in app only"}

    if not req.alerts:
        return {"sent": False, "message": "No alerts to send"}

    try:
        html_body = _build_alert_html(req.email, req.alerts)
        count = len(req.alerts)
        plural = "trade" if count == 1 else "trades"

        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"🟢 OptionAdvisor: {count} GO {plural} detected — {req.alerts[0].time_window}"
        msg["From"]    = SMTP_FROM
        msg["To"]      = req.email
        msg.attach(MIMEText(html_body, "html"))

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.ehlo()
            server.starttls()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.sendmail(SMTP_FROM, req.email, msg.as_string())

        return {"sent": True, "message": f"Alert email sent to {req.email}"}

    except Exception as e:
        # Don't crash the app — email is optional
        print(f"[alert-email] send failed: {e}")
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


@app.post("/api/analyze", response_model=AnalyzeResponse)
def analyze(req: AnalyzeRequest):
    ticker = req.ticker.upper().strip()

    try:
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

    # Use first available near-term expiry for chain analysis
    target_expiry = opt_dates[min(2, len(opt_dates) - 1)]
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
        company_name = ticker
        sector = "N/A"
        market_cap = "N/A"

    # Filter to tradeable range
    price_approx = float(hist["Close"].iloc[-1])
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
                            spread_width_override=req.spread_width,
                            weeks_out=req.weeks_out,
                            strategy_mode=req.strategy_mode)
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
            "min_credit_pct_of_width": MIN_CREDIT_PCT_OF_WIDTH,
            "short_delta_range": list(TARGET_SHORT_DELTA_CREDIT),
            "target_dte": f"{req.weeks_out}w ({req.weeks_out * 7}d ±7)",
            "max_bid_ask_spread_pct": 15,
            "min_open_interest": 50,
            "spread_width": req.spread_width if req.spread_width else "auto",
            "strategy_mode": req.strategy_mode,
        }
    )
