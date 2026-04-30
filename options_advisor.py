"""
Options Trade Advisor
=====================
A systematic options trade recommendation engine built with Streamlit + yfinance.

Run with:  streamlit run options_advisor.py
"""

import streamlit as st
import yfinance as yf
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import warnings
warnings.filterwarnings("ignore")

# ─────────────────────────────────────────────
# PAGE CONFIG
# ─────────────────────────────────────────────
st.set_page_config(
    page_title="Options Trade Advisor",
    page_icon="📊",
    layout="wide",
)

st.markdown("""
<style>
.big-metric { font-size: 2rem; font-weight: 700; }
.card { background: #1e1e2e; border-radius: 12px; padding: 1.2rem 1.5rem; margin-bottom: 1rem; border-left: 5px solid #7c3aed; }
.bullish { border-left-color: #22c55e !important; }
.bearish { border-left-color: #ef4444 !important; }
.neutral { border-left-color: #f59e0b !important; }
.tag { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 0.75rem; font-weight: 600; margin-right: 4px; }
.tag-sell { background: #ef4444; color: white; }
.tag-buy { background: #22c55e; color: white; }
.tag-neutral { background: #f59e0b; color: black; }
.section-title { font-size: 1.3rem; font-weight: 700; margin: 1.5rem 0 0.8rem 0; color: #a78bfa; }
</style>
""", unsafe_allow_html=True)


# ─────────────────────────────────────────────
# HELPER FUNCTIONS
# ─────────────────────────────────────────────

def compute_rsi(series: pd.Series, period: int = 14) -> float:
    delta = series.diff()
    gain = delta.clip(lower=0).rolling(period).mean()
    loss = (-delta.clip(upper=0)).rolling(period).mean()
    rs = gain / loss
    rsi = 100 - (100 / (1 + rs))
    return round(float(rsi.iloc[-1]), 1)


def compute_iv_rank(hist: pd.DataFrame, current_iv: float) -> float:
    """IV Rank: where current IV sits within 52-week IV range (approx from HV)."""
    returns = hist["Close"].pct_change().dropna()
    rolling_hv = returns.rolling(21).std() * np.sqrt(252) * 100
    low_52 = rolling_hv.min()
    high_52 = rolling_hv.max()
    if high_52 == low_52:
        return 50.0
    rank = (current_iv - low_52) / (high_52 - low_52) * 100
    return round(float(np.clip(rank, 0, 100)), 1)


def get_trend(hist: pd.DataFrame) -> tuple[str, float, float]:
    close = hist["Close"]
    ma50 = float(close.rolling(50).mean().iloc[-1])
    ma200 = float(close.rolling(200).mean().iloc[-1])
    current = float(close.iloc[-1])

    if current > ma50 > ma200:
        trend = "Bullish"
    elif current < ma50 < ma200:
        trend = "Bearish"
    elif current > ma50:
        trend = "Mildly Bullish"
    elif current < ma50:
        trend = "Mildly Bearish"
    else:
        trend = "Neutral"
    return trend, ma50, ma200


def pick_expiry(options_dates: list[str], weeks_out: int = 4) -> str:
    """Pick expiry closest to `weeks_out` weeks from today."""
    target = datetime.today() + timedelta(weeks=weeks_out)
    dates = [datetime.strptime(d, "%Y-%m-%d") for d in options_dates]
    best = min(dates, key=lambda d: abs((d - target).days))
    return best.strftime("%Y-%m-%d")


def get_atm_strike(chain_df: pd.DataFrame, price: float, direction: str = "call") -> float:
    strikes = chain_df["strike"].values
    return float(strikes[np.argmin(np.abs(strikes - price))])


def compute_iv_from_chain(calls: pd.DataFrame, puts: pd.DataFrame) -> float:
    """Approximate current IV as median IV of near-the-money options."""
    combined = pd.concat([calls, puts])
    iv_vals = combined["impliedVolatility"].replace(0, np.nan).dropna()
    if iv_vals.empty:
        return 30.0
    return round(float(iv_vals.median() * 100), 1)


def put_call_ratio(calls: pd.DataFrame, puts: pd.DataFrame) -> float:
    call_vol = calls["volume"].fillna(0).sum()
    put_vol = puts["volume"].fillna(0).sum()
    if call_vol == 0:
        return 1.0
    return round(put_vol / call_vol, 2)


# ─────────────────────────────────────────────
# RECOMMENDATION ENGINE
# ─────────────────────────────────────────────

def build_recommendations(
    ticker: str,
    price: float,
    trend: str,
    rsi: float,
    iv_rank: float,
    current_iv: float,
    pcr: float,
    calls: pd.DataFrame,
    puts: pd.DataFrame,
    expiry: str,
    expiry_30: str,
    expiry_60: str,
) -> list[dict]:
    recs = []

    bullish = "Bullish" in trend
    bearish = "Bearish" in trend
    neutral = not bullish and not bearish
    high_iv = iv_rank >= 50
    low_iv = iv_rank < 50
    overbought = rsi >= 70
    oversold = rsi <= 30

    def nearest_strike(df, target, offset=0):
        strikes = df["strike"].values
        base = strikes[np.argmin(np.abs(strikes - target))]
        arr = np.sort(strikes)
        idx = np.where(arr == base)[0]
        if len(idx) == 0:
            return base
        new_idx = int(np.clip(idx[0] + offset, 0, len(arr) - 1))
        return float(arr[new_idx])

    def option_price(df, strike):
        row = df[df["strike"] == strike]
        if row.empty:
            return None
        mid = (row["bid"].values[0] + row["ask"].values[0]) / 2
        return round(float(mid), 2)

    # ── 1. LONG CALL ──────────────────────────────────────────────────────────
    if (bullish or oversold) and low_iv:
        strike = nearest_strike(calls, price * 1.02)
        prem = option_price(calls, strike) or round(price * 0.03, 2)
        be = round(strike + prem, 2)
        recs.append({
            "strategy": "Long Call",
            "bias": "Bullish",
            "iv_env": "Low IV",
            "legs": [{"action": "BUY", "type": "CALL", "strike": strike, "expiry": expiry_30}],
            "max_profit": "Unlimited",
            "max_loss": f"${prem:.2f} per share (${prem*100:.0f} per contract)",
            "breakeven": f"${be:.2f}",
            "prob_profit": f"~{max(35, 55 - int(iv_rank/5))}%",
            "rationale": (
                f"The stock is trending {trend.lower()} with RSI at {rsi} "
                f"({'oversold — potential bounce' if oversold else 'showing momentum'}). "
                f"IV rank is low ({iv_rank:.0f}%), making buying options relatively cheap. "
                f"A long call at ${strike} gives you upside exposure for just ${prem:.2f}/share."
            ),
            "score": 85 if bullish else 70,
        })

    # ── 2. LONG PUT ──────────────────────────────────────────────────────────
    if (bearish or overbought) and low_iv:
        strike = nearest_strike(puts, price * 0.98)
        prem = option_price(puts, strike) or round(price * 0.03, 2)
        be = round(strike - prem, 2)
        recs.append({
            "strategy": "Long Put",
            "bias": "Bearish",
            "iv_env": "Low IV",
            "legs": [{"action": "BUY", "type": "PUT", "strike": strike, "expiry": expiry_30}],
            "max_profit": f"Up to ${(strike - prem)*100:.0f} per contract",
            "max_loss": f"${prem:.2f} per share (${prem*100:.0f} per contract)",
            "breakeven": f"${be:.2f}",
            "prob_profit": f"~{max(35, 55 - int(iv_rank/5))}%",
            "rationale": (
                f"The stock is in a {trend.lower()} trend and RSI is at {rsi} "
                f"({'overbought — possible reversal' if overbought else 'showing weakness'}). "
                f"Low IV ({iv_rank:.0f}%) means puts are inexpensive. "
                f"A long put at ${strike} profits if the stock falls below ${be:.2f}."
            ),
            "score": 85 if bearish else 70,
        })

    # ── 3. BULL CALL SPREAD ────────────────────────────────────────────────
    if bullish:
        buy_strike = nearest_strike(calls, price * 1.01)
        sell_strike = nearest_strike(calls, price * 1.06, offset=2)
        buy_prem = option_price(calls, buy_strike) or round(price * 0.035, 2)
        sell_prem = option_price(calls, sell_strike) or round(price * 0.015, 2)
        net_debit = round(buy_prem - sell_prem, 2)
        spread_width = round(sell_strike - buy_strike, 2)
        max_profit = round((spread_width - net_debit) * 100, 0)
        be = round(buy_strike + net_debit, 2)
        recs.append({
            "strategy": "Bull Call Spread",
            "bias": "Bullish",
            "iv_env": "Any IV",
            "legs": [
                {"action": "BUY", "type": "CALL", "strike": buy_strike, "expiry": expiry_30},
                {"action": "SELL", "type": "CALL", "strike": sell_strike, "expiry": expiry_30},
            ],
            "max_profit": f"${max_profit:.0f} per contract",
            "max_loss": f"${net_debit*100:.0f} per contract",
            "breakeven": f"${be:.2f}",
            "prob_profit": f"~{45 + int((1 - iv_rank/100)*15):.0f}%",
            "rationale": (
                f"A defined-risk bullish play. You buy a call at ${buy_strike} and sell one at "
                f"${sell_strike}, capping both risk and reward. Net cost is just ${net_debit:.2f}/share. "
                f"Ideal when you're bullish but want to reduce premium outlay. "
                f"Max profit if stock closes above ${sell_strike} at expiry."
            ),
            "score": 80,
        })

    # ── 4. BEAR PUT SPREAD ─────────────────────────────────────────────────
    if bearish:
        buy_strike = nearest_strike(puts, price * 0.99)
        sell_strike = nearest_strike(puts, price * 0.94, offset=-2)
        buy_prem = option_price(puts, buy_strike) or round(price * 0.035, 2)
        sell_prem = option_price(puts, sell_strike) or round(price * 0.015, 2)
        net_debit = round(buy_prem - sell_prem, 2)
        spread_width = round(buy_strike - sell_strike, 2)
        max_profit = round((spread_width - net_debit) * 100, 0)
        be = round(buy_strike - net_debit, 2)
        recs.append({
            "strategy": "Bear Put Spread",
            "bias": "Bearish",
            "iv_env": "Any IV",
            "legs": [
                {"action": "BUY", "type": "PUT", "strike": buy_strike, "expiry": expiry_30},
                {"action": "SELL", "type": "PUT", "strike": sell_strike, "expiry": expiry_30},
            ],
            "max_profit": f"${max_profit:.0f} per contract",
            "max_loss": f"${net_debit*100:.0f} per contract",
            "breakeven": f"${be:.2f}",
            "prob_profit": f"~{45 + int((1 - iv_rank/100)*15):.0f}%",
            "rationale": (
                f"Defined-risk bearish play. Buy a put at ${buy_strike}, sell one at ${sell_strike}. "
                f"Max profit if stock closes below ${sell_strike} at expiry. "
                f"Costs only ${net_debit:.2f}/share — much cheaper than a naked put."
            ),
            "score": 80,
        })

    # ── 5. IRON CONDOR ─────────────────────────────────────────────────────
    if high_iv and not overbought and not oversold:
        put_sell = nearest_strike(puts, price * 0.95)
        put_buy = nearest_strike(puts, price * 0.90, offset=-1)
        call_sell = nearest_strike(calls, price * 1.05)
        call_buy = nearest_strike(calls, price * 1.10, offset=1)

        ps_prem = option_price(puts, put_sell) or round(price * 0.02, 2)
        pb_prem = option_price(puts, put_buy) or round(price * 0.01, 2)
        cs_prem = option_price(calls, call_sell) or round(price * 0.02, 2)
        cb_prem = option_price(calls, call_buy) or round(price * 0.01, 2)

        net_credit = round((ps_prem - pb_prem + cs_prem - cb_prem), 2)
        wing_width = round(put_sell - put_buy, 2)
        max_loss = round((wing_width - net_credit) * 100, 0)

        recs.append({
            "strategy": "Iron Condor",
            "bias": "Neutral",
            "iv_env": "High IV",
            "legs": [
                {"action": "SELL", "type": "PUT", "strike": put_sell, "expiry": expiry_30},
                {"action": "BUY", "type": "PUT", "strike": put_buy, "expiry": expiry_30},
                {"action": "SELL", "type": "CALL", "strike": call_sell, "expiry": expiry_30},
                {"action": "BUY", "type": "CALL", "strike": call_buy, "expiry": expiry_30},
            ],
            "max_profit": f"${net_credit*100:.0f} per contract (credit received)",
            "max_loss": f"${max_loss:.0f} per contract",
            "breakeven": f"${put_sell - net_credit:.2f} – ${call_sell + net_credit:.2f}",
            "prob_profit": f"~{55 + int(iv_rank/10):.0f}%",
            "rationale": (
                f"High IV environment (IV rank: {iv_rank:.0f}%) is ideal for selling premium. "
                f"This iron condor profits as long as {ticker} stays between ${put_sell} and ${call_sell}. "
                f"You collect ${net_credit:.2f}/share upfront. IV crush after any catalyst will also boost your P&L."
            ),
            "score": 88 if iv_rank >= 65 else 75,
        })

    # ── 6. BULL PUT SPREAD (Credit) ────────────────────────────────────────
    if (bullish or neutral) and high_iv:
        sell_strike = nearest_strike(puts, price * 0.96)
        buy_strike = nearest_strike(puts, price * 0.91, offset=-1)
        sell_prem = option_price(puts, sell_strike) or round(price * 0.025, 2)
        buy_prem = option_price(puts, buy_strike) or round(price * 0.01, 2)
        net_credit = round(sell_prem - buy_prem, 2)
        spread_width = round(sell_strike - buy_strike, 2)
        max_loss = round((spread_width - net_credit) * 100, 0)
        be = round(sell_strike - net_credit, 2)
        recs.append({
            "strategy": "Bull Put Spread",
            "bias": "Bullish / Neutral",
            "iv_env": "High IV",
            "legs": [
                {"action": "SELL", "type": "PUT", "strike": sell_strike, "expiry": expiry_30},
                {"action": "BUY", "type": "PUT", "strike": buy_strike, "expiry": expiry_30},
            ],
            "max_profit": f"${net_credit*100:.0f} per contract (credit received)",
            "max_loss": f"${max_loss:.0f} per contract",
            "breakeven": f"${be:.2f}",
            "prob_profit": f"~{60 + int(iv_rank/15):.0f}%",
            "rationale": (
                f"High IV ({iv_rank:.0f}%) makes selling puts attractive. You collect ${net_credit:.2f}/share "
                f"as long as {ticker} stays above ${sell_strike}. Defined risk — max loss is capped at ${max_loss:.0f}. "
                f"Good fit given the {'bullish' if bullish else 'neutral'} trend."
            ),
            "score": 82 if high_iv else 65,
        })

    # ── 7. BEAR CALL SPREAD (Credit) ──────────────────────────────────────
    if (bearish or neutral) and high_iv:
        sell_strike = nearest_strike(calls, price * 1.04)
        buy_strike = nearest_strike(calls, price * 1.09, offset=1)
        sell_prem = option_price(calls, sell_strike) or round(price * 0.025, 2)
        buy_prem = option_price(calls, buy_strike) or round(price * 0.01, 2)
        net_credit = round(sell_prem - buy_prem, 2)
        spread_width = round(buy_strike - sell_strike, 2)
        max_loss = round((spread_width - net_credit) * 100, 0)
        be = round(sell_strike + net_credit, 2)
        recs.append({
            "strategy": "Bear Call Spread",
            "bias": "Bearish / Neutral",
            "iv_env": "High IV",
            "legs": [
                {"action": "SELL", "type": "CALL", "strike": sell_strike, "expiry": expiry_30},
                {"action": "BUY", "type": "CALL", "strike": buy_strike, "expiry": expiry_30},
            ],
            "max_profit": f"${net_credit*100:.0f} per contract (credit received)",
            "max_loss": f"${max_loss:.0f} per contract",
            "breakeven": f"${be:.2f}",
            "prob_profit": f"~{60 + int(iv_rank/15):.0f}%",
            "rationale": (
                f"Selling a call spread at high IV levels ({iv_rank:.0f}%). "
                f"You collect ${net_credit:.2f}/share and keep it if {ticker} stays below ${sell_strike}. "
                f"Bearish bias with capped risk — max loss is ${max_loss:.0f} per contract."
            ),
            "score": 82 if high_iv else 65,
        })

    # ── 8. LONG STRADDLE ──────────────────────────────────────────────────
    if low_iv and not bullish and not bearish:
        strike = nearest_strike(calls, price)
        call_prem = option_price(calls, strike) or round(price * 0.03, 2)
        put_prem = option_price(puts, strike) or round(price * 0.03, 2)
        total_cost = round(call_prem + put_prem, 2)
        recs.append({
            "strategy": "Long Straddle",
            "bias": "Neutral (Expecting Big Move)",
            "iv_env": "Low IV",
            "legs": [
                {"action": "BUY", "type": "CALL", "strike": strike, "expiry": expiry_30},
                {"action": "BUY", "type": "PUT", "strike": strike, "expiry": expiry_30},
            ],
            "max_profit": "Unlimited (either direction)",
            "max_loss": f"${total_cost*100:.0f} per contract",
            "breakeven": f"${strike - total_cost:.2f} – ${strike + total_cost:.2f}",
            "prob_profit": "~40–45%",
            "rationale": (
                f"IV rank is low ({iv_rank:.0f}%) — options are cheap. A straddle buys both a call and put at ${strike}, "
                f"so you profit from a large move in either direction. Good before earnings, FDA decisions, or other catalysts. "
                f"You need the stock to move more than ${total_cost:.2f} from current price to profit."
            ),
            "score": 72,
        })

    # Sort by score descending
    recs.sort(key=lambda x: x["score"], reverse=True)
    return recs


# ─────────────────────────────────────────────
# UI RENDERING
# ─────────────────────────────────────────────

def render_bias_tag(bias: str) -> str:
    if "Bullish" in bias:
        return '<span class="tag tag-buy">↑ BULLISH</span>'
    elif "Bearish" in bias:
        return '<span class="tag tag-sell">↓ BEARISH</span>'
    else:
        return '<span class="tag tag-neutral">↔ NEUTRAL</span>'


def render_recommendation(rec: dict, rank: int):
    bias_class = "bullish" if "Bullish" in rec["bias"] else ("bearish" if "Bearish" in rec["bias"] else "neutral")

    legs_html = ""
    for leg in rec["legs"]:
        color = "#22c55e" if leg["action"] == "BUY" else "#ef4444"
        legs_html += (
            f'<span style="color:{color}; font-weight:700;">{leg["action"]}</span> '
            f'{leg["type"]} ${leg["strike"]:.1f} exp {leg["expiry"]}&nbsp;&nbsp; '
        )

    st.markdown(f"""
<div class="card {bias_class}">
  <div style="display:flex; justify-content:space-between; align-items:center;">
    <span style="font-size:1.15rem; font-weight:700;">#{rank} &nbsp; {rec["strategy"]}</span>
    <span style="font-size:0.85rem; color:#aaa;">{rec["iv_env"]} &nbsp;|&nbsp; Score: {rec["score"]}/100</span>
  </div>
  <div style="margin:0.4rem 0 0.6rem 0;">
    {render_bias_tag(rec["bias"])}
  </div>
  <div style="font-family: monospace; font-size:0.95rem; margin-bottom:0.8rem; color:#e2e8f0;">
    {legs_html}
  </div>
  <div style="display:grid; grid-template-columns:1fr 1fr 1fr 1fr; gap:0.5rem; margin-bottom:0.8rem;">
    <div><div style="color:#888;font-size:0.75rem;">MAX PROFIT</div><div style="font-weight:600; color:#22c55e;">{rec["max_profit"]}</div></div>
    <div><div style="color:#888;font-size:0.75rem;">MAX LOSS</div><div style="font-weight:600; color:#ef4444;">{rec["max_loss"]}</div></div>
    <div><div style="color:#888;font-size:0.75rem;">BREAKEVEN</div><div style="font-weight:600;">{rec["breakeven"]}</div></div>
    <div><div style="color:#888;font-size:0.75rem;">PROB OF PROFIT</div><div style="font-weight:600; color:#a78bfa;">{rec["prob_profit"]}</div></div>
  </div>
  <div style="background:#0f0f1a; border-radius:8px; padding:0.7rem 1rem; font-size:0.9rem; color:#cbd5e1;">
    💡 {rec["rationale"]}
  </div>
</div>
""", unsafe_allow_html=True)


# ─────────────────────────────────────────────
# MAIN APP
# ─────────────────────────────────────────────

def main():
    st.title("📊 Options Trade Advisor")
    st.caption("Systematic options trade recommendations based on trend, RSI, and IV analysis.")

    col1, col2, col3 = st.columns([2, 1, 1])
    with col1:
        ticker = st.text_input("Enter Ticker Symbol", value="AAPL", placeholder="e.g. AAPL, TSLA, SPY").upper().strip()
    with col2:
        weeks_out = st.selectbox("Target Expiry", [2, 3, 4, 6, 8], index=2, format_func=lambda x: f"~{x} weeks out")
    with col3:
        st.write("")
        st.write("")
        analyze = st.button("🔍 Analyze", use_container_width=True, type="primary")

    if not analyze and "last_ticker" not in st.session_state:
        st.info("Enter a ticker symbol and click Analyze to get trade recommendations.")
        st.markdown("**How it works:**")
        st.markdown("""
- Fetches live price, options chain, and 1-year history from Yahoo Finance
- Computes **trend** (50/200-day MA), **RSI**, and **IV Rank**
- Recommends specific strategies with exact strikes, expiry, P&L, and plain-English rationale
- Strategies covered: Long Call/Put · Bull/Bear Spreads · Iron Condor · Bull Put / Bear Call Spread · Straddle
        """)
        return

    if analyze:
        st.session_state["last_ticker"] = ticker

    ticker = st.session_state.get("last_ticker", ticker)

    with st.spinner(f"Fetching data for {ticker}..."):
        try:
            stock = yf.Ticker(ticker)
            hist = stock.history(period="1y")

            if hist.empty:
                st.error(f"Could not find data for '{ticker}'. Check the ticker symbol.")
                return

            current_price = float(hist["Close"].iloc[-1])
            prev_close = float(hist["Close"].iloc[-2])
            price_change = current_price - prev_close
            price_change_pct = (price_change / prev_close) * 100

            # Technical indicators
            trend, ma50, ma200 = get_trend(hist)
            rsi = compute_rsi(hist["Close"])

            # Options data
            opt_dates = stock.options
            if not opt_dates:
                st.error(f"No options data available for {ticker}.")
                return

            expiry = pick_expiry(list(opt_dates), weeks_out)
            expiry_30 = pick_expiry(list(opt_dates), 4)
            expiry_60 = pick_expiry(list(opt_dates), 8)

            chain = stock.option_chain(expiry)
            calls = chain.calls.copy()
            puts = chain.puts.copy()

            # Filter to near-the-money strikes (80% – 120% of price)
            calls = calls[(calls["strike"] >= current_price * 0.80) & (calls["strike"] <= current_price * 1.20)]
            puts = puts[(puts["strike"] >= current_price * 0.80) & (puts["strike"] <= current_price * 1.20)]

            current_iv = compute_iv_from_chain(calls, puts)
            iv_rank = compute_iv_rank(hist, current_iv)
            pcr = put_call_ratio(calls, puts)

            # Info
            info = stock.info
            company_name = info.get("longName", ticker)
            sector = info.get("sector", "N/A")
            market_cap = info.get("marketCap", 0)
            market_cap_str = (
                f"${market_cap/1e12:.2f}T" if market_cap >= 1e12
                else f"${market_cap/1e9:.1f}B" if market_cap >= 1e9
                else f"${market_cap/1e6:.0f}M" if market_cap > 0
                else "N/A"
            )

        except Exception as e:
            st.error(f"Error fetching data: {e}")
            return

    # ── HEADER ─────────────────────────────────────────────────────────────
    st.markdown(f"## {company_name} &nbsp; <span style='color:#888;font-size:1rem;'>{ticker} · {sector} · {market_cap_str}</span>", unsafe_allow_html=True)

    chg_color = "#22c55e" if price_change >= 0 else "#ef4444"
    chg_arrow = "▲" if price_change >= 0 else "▼"
    st.markdown(
        f"<span class='big-metric'>${current_price:.2f}</span> "
        f"<span style='color:{chg_color}; font-size:1.2rem;'>{chg_arrow} {abs(price_change):.2f} ({price_change_pct:+.2f}%)</span>",
        unsafe_allow_html=True
    )

    st.markdown("---")

    # ── MARKET OVERVIEW ────────────────────────────────────────────────────
    st.markdown('<div class="section-title">📈 Market Overview</div>', unsafe_allow_html=True)

    c1, c2, c3, c4, c5, c6 = st.columns(6)

    trend_color = "#22c55e" if "Bullish" in trend else ("#ef4444" if "Bearish" in trend else "#f59e0b")
    rsi_color = "#ef4444" if rsi >= 70 else ("#22c55e" if rsi <= 30 else "#e2e8f0")
    iv_color = "#ef4444" if iv_rank >= 65 else ("#22c55e" if iv_rank < 35 else "#f59e0b")
    pcr_color = "#ef4444" if pcr > 1.2 else ("#22c55e" if pcr < 0.8 else "#e2e8f0")

    c1.metric("Trend", trend, delta=f"MA50: ${ma50:.1f}")
    c2.metric("RSI (14)", f"{rsi}", delta="Overbought" if rsi >= 70 else ("Oversold" if rsi <= 30 else "Normal"))
    c3.metric("IV Rank", f"{iv_rank:.0f}%", delta="High IV" if iv_rank >= 50 else "Low IV")
    c4.metric("Current IV", f"{current_iv:.1f}%")
    c5.metric("Put/Call Ratio", f"{pcr:.2f}", delta="Bearish sentiment" if pcr > 1.2 else ("Bullish sentiment" if pcr < 0.8 else "Neutral"))
    c6.metric("Expiry Used", expiry)

    # IV Rank interpretation
    if iv_rank >= 65:
        st.warning(f"⚡ **High IV Environment** (IV Rank: {iv_rank:.0f}%) — Premium selling strategies like Iron Condors and Credit Spreads are favored.")
    elif iv_rank < 35:
        st.success(f"💰 **Low IV Environment** (IV Rank: {iv_rank:.0f}%) — Premium buying strategies like Long Calls/Puts and Spreads are relatively cheap.")
    else:
        st.info(f"📊 **Moderate IV Environment** (IV Rank: {iv_rank:.0f}%) — Spreads offer a good balance of cost and risk.")

    st.markdown("---")

    # ── RECOMMENDATIONS ─────────────────────────────────────────────────────
    st.markdown('<div class="section-title">🎯 Trade Recommendations</div>', unsafe_allow_html=True)

    recs = build_recommendations(
        ticker, current_price, trend, rsi, iv_rank, current_iv, pcr,
        calls, puts, expiry, expiry_30, expiry_60
    )

    if not recs:
        st.warning("Not enough signal to generate confident recommendations. Try a different ticker.")
    else:
        st.caption(f"Showing top {min(len(recs), 5)} recommendations ranked by fit to current market conditions.")
        for i, rec in enumerate(recs[:5], 1):
            render_recommendation(rec, i)

    # ── OPTIONS CHAIN SNAPSHOT ──────────────────────────────────────────────
    with st.expander("📋 Options Chain Snapshot (NTM Strikes)"):
        tab1, tab2 = st.tabs(["Calls", "Puts"])
        cols_to_show = ["strike", "lastPrice", "bid", "ask", "volume", "openInterest", "impliedVolatility"]
        with tab1:
            display_calls = calls[cols_to_show].copy()
            display_calls["impliedVolatility"] = (display_calls["impliedVolatility"] * 100).round(1).astype(str) + "%"
            st.dataframe(display_calls.reset_index(drop=True), use_container_width=True)
        with tab2:
            display_puts = puts[cols_to_show].copy()
            display_puts["impliedVolatility"] = (display_puts["impliedVolatility"] * 100).round(1).astype(str) + "%"
            st.dataframe(display_puts.reset_index(drop=True), use_container_width=True)

    # ── PRICE CHART ─────────────────────────────────────────────────────────
    with st.expander("📉 Price Chart (1 Year)"):
        chart_data = hist[["Close"]].copy()
        chart_data["MA50"] = hist["Close"].rolling(50).mean()
        chart_data["MA200"] = hist["Close"].rolling(200).mean()
        st.line_chart(chart_data, use_container_width=True)

    # ── DISCLAIMER ──────────────────────────────────────────────────────────
    st.markdown("---")
    st.caption(
        "⚠️ **Disclaimer:** This tool is for educational and informational purposes only. "
        "It does not constitute financial advice. Options trading involves significant risk. "
        "Always do your own research and consult a financial advisor before trading."
    )


if __name__ == "__main__":
    main()
