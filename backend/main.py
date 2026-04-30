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
from dataclasses import asdict

from models import (
    AnalyzeRequest, AnalyzeResponse, RecommendationOut, OptionLegOut,
    OptionRowOut, PricePoint, SignalsOut, ScoreBreakdown,
    UserDataRequest, UserDataResponse,
)
from analysis import generate_signals
from engine import run_engine, MIN_CREDIT_PCT_OF_WIDTH, TARGET_SHORT_DELTA_CREDIT, DTE_CREDIT_MIN, DTE_CREDIT_MAX
from storage import get_user_state, init_db, save_user_state

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


def chain_to_output(df: pd.DataFrame) -> list[OptionRowOut]:
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
            delta=safe_float(row.get("delta", None)) if "delta" in row else None,
        ))
    return rows


@app.get("/")
def root():
    return {"status": "ok", "message": "Options Trade Advisor API v2.0"}


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
        calls_chain=chain_to_output(ntm_calls),
        puts_chain=chain_to_output(ntm_puts),
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
