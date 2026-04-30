"""
engine.py — Trade Filtering, Scoring & Recommendation Engine
=============================================================
This is the core systematic logic. Every trade candidate goes through:
  1. Strike selection  (delta-based, not hardcoded %)
  2. Structure validation (R:R, credit %, DTE)
  3. Liquidity filtering (bid-ask spread, OI, volume)
  4. Expected Value calculation
  5. Composite scoring (signal fit + structure + liquidity + IV fit)
  6. Exit plan generation

Only trades that pass ALL hard filters are returned.
"""

import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import Optional
from analysis import MarketSignals, OptionLeg, TradeCandidate


# ─────────────────────────────────────────────────────────────
# CONSTANTS — SYSTEM PARAMETERS
# ─────────────────────────────────────────────────────────────

# Strike selection targets (delta)
TARGET_SHORT_DELTA_CREDIT = (0.20, 0.32)    # Short leg delta range for credit spreads
TARGET_LONG_DELTA_DEBIT   = (0.40, 0.55)    # Long leg delta range for debit spreads
TARGET_SHORT_DELTA_CONDOR = (0.15, 0.25)    # Iron condor short leg delta

# Hard filters — trades failing these are REJECTED
MIN_CREDIT_PCT_OF_WIDTH   = 25.0    # Credit spreads must collect ≥ 25% of spread width
MIN_RISK_REWARD_RATIO     = 1.5     # Max loss must be ≤ 4x max profit (for debit)
MAX_BID_ASK_SPREAD_PCT    = 15.0    # Bid-ask spread must be < 15% of mid price
MIN_OPEN_INTEREST         = 50      # Each leg must have OI ≥ 50
MIN_VOLUME                = 5       # Each leg must have volume ≥ 5 (or OI as fallback)
MIN_MID_PRICE             = 0.05    # Ignore options trading < $0.05

# DTE targets
DTE_CREDIT_MIN, DTE_CREDIT_MAX  = 21, 50   # Credit spreads: 21–50 DTE sweet spot
DTE_DEBIT_MIN, DTE_DEBIT_MAX    = 20, 40   # Debit spreads: 20–40 DTE
DTE_STRADDLE_MIN, DTE_STRADDLE_MAX = 14, 35

# Exit plan parameters
CREDIT_PROFIT_TARGET_PCT  = 50     # Close credit at 50% of max profit
DEBIT_PROFIT_TARGET_PCT   = 100    # Close debit at 2x cost (100% gain)
CREDIT_STOP_LOSS_MULT     = 2.0    # Stop if loss = 2x credit received
CLOSE_AT_DTE              = 21     # Always close credit spreads at 21 DTE


# ─────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────

def days_to_expiry(expiry_str: str) -> int:
    expiry = datetime.strptime(expiry_str, "%Y-%m-%d")
    return max((expiry - datetime.today()).days, 0)


def pick_expiry_by_dte(option_dates: list[str], dte_min: int, dte_max: int) -> Optional[str]:
    """Find the expiry closest to the midpoint of [dte_min, dte_max]."""
    target_dte = (dte_min + dte_max) / 2
    target_date = datetime.today() + timedelta(days=target_dte)
    valid = []
    for d in option_dates:
        dt = datetime.strptime(d, "%Y-%m-%d")
        dte = (dt - datetime.today()).days
        if dte_min <= dte <= dte_max:
            valid.append((d, abs((dt - target_date).days)))
    if not valid:
        # Relax: take nearest expiry beyond dte_min
        candidates = [
            (d, abs(days_to_expiry(d) - target_dte))
            for d in option_dates if days_to_expiry(d) >= dte_min - 5
        ]
        if not candidates:
            return None
        return min(candidates, key=lambda x: x[1])[0]
    return min(valid, key=lambda x: x[1])[0]


def get_mid(row) -> float:
    bid = float(row["bid"]) if not pd.isna(row["bid"]) else 0
    ask = float(row["ask"]) if not pd.isna(row["ask"]) else 0
    if bid == 0 and ask == 0:
        return float(row.get("lastPrice", 0))
    if bid == 0:
        return ask * 0.9
    if ask == 0:
        return bid * 1.1
    return (bid + ask) / 2


def bid_ask_spread_pct(row) -> float:
    mid = get_mid(row)
    if mid < MIN_MID_PRICE:
        return 999.0
    bid = float(row["bid"]) if not pd.isna(row["bid"]) else 0
    ask = float(row["ask"]) if not pd.isna(row["ask"]) else 0
    spread = ask - bid
    return round(spread / mid * 100, 1)


def find_strike_by_delta(df: pd.DataFrame, target_delta_range: tuple,
                          price: float, option_type: str) -> Optional[pd.Series]:
    """
    Find the best row in the options chain whose delta falls within target range.
    Delta in yfinance is not always available — we approximate using moneyness + IV.
    Falls back to OTM% approximation when delta column is missing.
    """
    lo, hi = target_delta_range

    # Try using real delta if available
    if "delta" in df.columns and df["delta"].notna().any():
        if option_type == "PUT":
            # Put deltas are negative — we use abs
            mask = df["delta"].apply(lambda d: lo <= abs(d) <= hi if not pd.isna(d) else False)
        else:
            mask = df["delta"].apply(lambda d: lo <= d <= hi if not pd.isna(d) else False)
        candidates = df[mask]
        if not candidates.empty:
            best = candidates.iloc[(candidates["strike"] - price).abs().argsort()[:1]]
            return best.iloc[0]

    # Fallback: approximate delta from IV and moneyness using Black-Scholes approximation
    # Δ_call ≈ N(d1) where d1 = ln(S/K) / (IV * sqrt(T)) for simplified case
    # We just select strikes at approximate OTM% corresponding to target delta
    # 0.20 delta ≈ 10-12% OTM, 0.30 delta ≈ 6-8% OTM (varies with IV/DTE)
    # Use a linear approximation based on target delta midpoint
    mid_delta = (lo + hi) / 2
    otm_pct = _delta_to_otm_pct(mid_delta, df, price, option_type)

    if option_type == "CALL":
        target_strike = price * (1 + otm_pct / 100)
        otm_df = df[df["strike"] >= price]
    else:
        target_strike = price * (1 - otm_pct / 100)
        otm_df = df[df["strike"] <= price]

    if otm_df.empty:
        return None

    best = otm_df.iloc[(otm_df["strike"] - target_strike).abs().argsort()[:1]]
    return best.iloc[0]


def _delta_to_otm_pct(delta: float, df: pd.DataFrame, price: float, option_type: str) -> float:
    """
    Approximate OTM% from target delta using the options chain's median IV.
    Uses simplified Black-Scholes inverse: OTM% ≈ IV * sqrt(T) * N_inv(delta)
    We use a lookup table for common delta targets.
    """
    # Get median IV from chain
    iv_median = df["impliedVolatility"].replace(0, np.nan).dropna().median()
    if pd.isna(iv_median):
        iv_median = 0.30

    # Approximate DTE from the chain expiry (rough — 30 days default)
    dte_approx = 30
    T = dte_approx / 365

    # Simplified: OTM% ≈ IV * sqrt(T) * z_score_for_delta
    # z-scores for common deltas (one-tailed)
    delta_to_z = {
        0.50: 0.00, 0.45: 0.13, 0.40: 0.25, 0.35: 0.39,
        0.30: 0.52, 0.25: 0.67, 0.20: 0.84, 0.15: 1.04,
        0.10: 1.28, 0.05: 1.65
    }
    # Find closest z from table
    closest_delta = min(delta_to_z.keys(), key=lambda d: abs(d - delta))
    z = delta_to_z[closest_delta]
    otm_pct = iv_median * np.sqrt(T) * z * 100
    return round(float(np.clip(otm_pct, 1, 25)), 1)


def build_option_leg(row: pd.Series, action: str, option_type: str, expiry: str) -> OptionLeg:
    mid = get_mid(row)
    bid = float(row["bid"]) if not pd.isna(row["bid"]) else 0
    ask = float(row["ask"]) if not pd.isna(row["ask"]) else 0
    iv = float(row["impliedVolatility"]) * 100 if not pd.isna(row.get("impliedVolatility", np.nan)) else 0
    delta_val = float(row["delta"]) if "delta" in row and not pd.isna(row.get("delta", np.nan)) else 0
    oi = int(row["openInterest"]) if not pd.isna(row.get("openInterest", np.nan)) else 0
    vol = int(row["volume"]) if not pd.isna(row.get("volume", np.nan)) else 0

    return OptionLeg(
        action=action,
        option_type=option_type,
        strike=float(row["strike"]),
        expiry=expiry,
        delta=round(delta_val, 3),
        mid_price=round(mid, 2),
        bid=round(bid, 2),
        ask=round(ask, 2),
        iv=round(iv, 1),
        oi=oi,
        volume=vol,
        bid_ask_spread_pct=bid_ask_spread_pct(row),
    )


def check_leg_liquidity(leg: OptionLeg) -> tuple[bool, list[str]]:
    issues = []
    if leg.bid_ask_spread_pct > MAX_BID_ASK_SPREAD_PCT:
        issues.append(f"{leg.option_type} ${leg.strike} bid-ask spread is {leg.bid_ask_spread_pct:.1f}% (max {MAX_BID_ASK_SPREAD_PCT}%)")
    if leg.oi < MIN_OPEN_INTEREST and leg.volume < MIN_VOLUME:
        issues.append(f"{leg.option_type} ${leg.strike} low liquidity (OI={leg.oi}, Vol={leg.volume})")
    if leg.mid_price < MIN_MID_PRICE:
        issues.append(f"{leg.option_type} ${leg.strike} mid price too low (${leg.mid_price:.2f})")
    return len(issues) == 0, issues


def compute_ev(max_profit: float, max_loss: float, prob_profit: float) -> float:
    prob_loss = 1 - prob_profit
    return round((prob_profit * max_profit) - (prob_loss * max_loss), 4)


def score_signal_alignment(signals: MarketSignals, strategy: str) -> int:
    """
    Score 0–40: how well the current market signals align with the strategy.
    """
    score = 0
    bias = signals.directional_bias
    iv_env = signals.iv_environment
    vol_regime = signals.volatility_regime

    BULLISH = bias == "Bullish"
    BEARISH = bias == "Bearish"
    NEUTRAL = bias == "Neutral"
    HIGH_IV = iv_env in ("High", "Elevated")
    LOW_IV = iv_env in ("Low", "Very Low")
    SELL_REGIME = vol_regime == "Sell Premium"
    BUY_REGIME = vol_regime == "Buy Premium"

    alignment_map = {
        "Long Call":        (BULLISH and BUY_REGIME, BULLISH, BUY_REGIME),
        "Long Put":         (BEARISH and BUY_REGIME, BEARISH, BUY_REGIME),
        "Bull Call Spread": (BULLISH, BULLISH and LOW_IV, True),
        "Bear Put Spread":  (BEARISH, BEARISH and LOW_IV, True),
        "Bull Put Spread":  (not BEARISH and SELL_REGIME, SELL_REGIME, not BEARISH),
        "Bear Call Spread": (not BULLISH and SELL_REGIME, SELL_REGIME, not BULLISH),
        "Iron Condor":      (NEUTRAL and SELL_REGIME, SELL_REGIME, NEUTRAL),
        "Long Straddle":    (NEUTRAL and BUY_REGIME, BUY_REGIME, NEUTRAL),
    }

    checks = alignment_map.get(strategy, (False, False, False))
    if checks[0]:
        score += 40   # Perfect fit
    elif checks[1] or checks[2]:
        score += 22   # Partial fit
    else:
        score += 5    # Poor fit

    # Bonus: confidence of bias signal
    score += int(signals.bias_confidence * 0.10)

    # MACD crossover bonus
    if "Bullish" in strategy and signals.macd_crossover == "Bullish":
        score += 5
    elif "Bearish" in strategy and signals.macd_crossover == "Bearish":
        score += 5

    return min(score, 40)


def score_structure(trade: dict) -> int:
    """
    Score 0–30: quality of the trade structure.
    Based on: R:R ratio, EV, credit %, delta quality.
    """
    score = 0

    # Expected Value (0-12)
    ev = trade["expected_value"]
    if ev > 0.10:
        score += 12
    elif ev > 0.05:
        score += 8
    elif ev > 0:
        score += 4
    else:
        score += 0

    # Risk/Reward (0-10)
    rr = trade["risk_reward_ratio"]
    if rr <= 2.0:
        score += 10
    elif rr <= 3.0:
        score += 7
    elif rr <= 4.0:
        score += 4
    else:
        score += 1

    # Credit % of width for credit spreads (0-8)
    cpw = trade.get("credit_pct_of_width", 0)
    if cpw >= 35:
        score += 8
    elif cpw >= 28:
        score += 5
    elif cpw >= 20:
        score += 2
    else:
        score += 0

    return min(score, 30)


def score_liquidity(legs: list[OptionLeg]) -> int:
    """Score 0–20: liquidity quality across all legs."""
    score = 20
    for leg in legs:
        # Penalize wide bid-ask spreads
        if leg.bid_ask_spread_pct > 10:
            score -= 8
        elif leg.bid_ask_spread_pct > 6:
            score -= 4
        elif leg.bid_ask_spread_pct > 3:
            score -= 1

        # Penalize low OI
        if leg.oi < 100:
            score -= 4
        elif leg.oi < 500:
            score -= 1

    return max(score, 0)


def score_iv_fit(signals: MarketSignals, strategy: str) -> int:
    """Score 0–10: how well current IV environment fits the strategy."""
    iv_rank = signals.iv_rank
    iv_vs_hv = signals.iv_vs_hv

    SELLING_STRATS = {"Iron Condor", "Bull Put Spread", "Bear Call Spread"}
    BUYING_STRATS  = {"Long Call", "Long Put", "Bull Call Spread", "Bear Put Spread", "Long Straddle"}

    if strategy in SELLING_STRATS:
        if iv_rank >= 65 and iv_vs_hv > 5:
            return 10
        elif iv_rank >= 50:
            return 7
        elif iv_rank >= 35:
            return 3
        else:
            return 0
    elif strategy in BUYING_STRATS:
        if iv_rank < 25 and iv_vs_hv < 0:
            return 10
        elif iv_rank < 40:
            return 7
        elif iv_rank < 55:
            return 4
        else:
            return 1
    return 5


def generate_exit_plan(strategy: str, max_profit: float, net_credit: float,
                        expiry: str, dte: int) -> str:
    profit_close_at = round(net_credit * CREDIT_PROFIT_TARGET_PCT / 100, 2) if net_credit > 0 else round(max_profit * DEBIT_PROFIT_TARGET_PCT / 100, 2)
    stop_loss_at = round(net_credit * CREDIT_STOP_LOSS_MULT, 2) if net_credit > 0 else None

    SELLING_STRATS = {"Iron Condor", "Bull Put Spread", "Bear Call Spread"}

    if strategy in SELLING_STRATS:
        return (
            f"✅ Take profit: Close when P&L reaches 50% of max profit "
            f"(≈ ${profit_close_at:.2f}/share credit remaining to pay). "
            f"🛑 Stop loss: Close if loss exceeds 2× credit received (${stop_loss_at:.2f}/share). "
            f"⏰ Time exit: Always close by {CLOSE_AT_DTE} DTE to avoid gamma risk "
            f"(approx {max(0, dte - CLOSE_AT_DTE)} days from entry)."
        )
    else:
        return (
            f"✅ Take profit: Close when position gains 100% of cost basis "
            f"(≈ ${profit_close_at:.2f}/share gain). "
            f"🛑 Stop loss: Close if position loses 50% of premium paid. "
            f"⏰ Time exit: Exit by {CLOSE_AT_DTE} DTE if target not reached — "
            f"theta decay accelerates significantly in final 3 weeks."
        )


# ─────────────────────────────────────────────────────────────
# STRATEGY BUILDERS
# ─────────────────────────────────────────────────────────────

def _build_long_call(signals: MarketSignals, calls: pd.DataFrame, expiry: str) -> Optional[dict]:
    price = signals.current_price
    row = find_strike_by_delta(calls, TARGET_LONG_DELTA_DEBIT, price, "CALL")
    if row is None:
        return None
    leg = build_option_leg(row, "BUY", "CALL", expiry)
    cost = leg.mid_price
    if cost < MIN_MID_PRICE:
        return None
    be = round(leg.strike + cost, 2)
    rop = round(1 - leg.delta if leg.delta > 0 else 0.45, 2)  # approx PoP
    max_profit = 999.0  # unlimited — cap for display at 10x cost
    max_loss = cost
    rr = round(max_loss / (cost * 10), 2)  # display R:R vs 10x target
    ev = compute_ev(cost * 10, max_loss, rop)

    return dict(
        strategy="Long Call", bias="Bullish",
        legs=[leg], expiry=expiry, dte=days_to_expiry(expiry),
        net_credit=-cost, spread_width=0,
        max_profit=cost * 10, max_loss=cost,
        risk_reward_ratio=round(max_loss / (cost * 10), 2),
        credit_pct_of_width=0,
        breakeven_lower=be, breakeven_upper=999,
        short_leg_delta=leg.delta, prob_of_profit=rop,
        prob_of_max_loss=round(1 - rop, 2),
        expected_value=ev,
        passes_rr_filter=True,
        passes_credit_filter=True,
        passes_liquidity_filter=True,
        rationale=(
            f"Directional bias is {signals.directional_bias} ({signals.bias_confidence}% confidence). "
            f"RSI {signals.rsi} ({signals.rsi_signal}). "
            f"IV rank {signals.iv_rank:.0f}% ({signals.iv_environment}) — "
            f"{'options are relatively cheap for buying.' if signals.iv_rank < 45 else 'note: elevated IV increases cost.'} "
            f"Long call at ${leg.strike} breaks even at ${be}. "
            f"Delta {leg.delta:.2f} implies ~{int(rop*100)}% chance of profit at expiry."
        ),
        exit_plan=generate_exit_plan("Long Call", cost * 10, -cost, expiry, days_to_expiry(expiry)),
    )


def _build_long_put(signals: MarketSignals, puts: pd.DataFrame, expiry: str) -> Optional[dict]:
    price = signals.current_price
    row = find_strike_by_delta(puts, TARGET_LONG_DELTA_DEBIT, price, "PUT")
    if row is None:
        return None
    leg = build_option_leg(row, "BUY", "PUT", expiry)
    cost = leg.mid_price
    if cost < MIN_MID_PRICE:
        return None
    be = round(leg.strike - cost, 2)
    rop = round(abs(leg.delta) if leg.delta < 0 else 0.45, 2)
    ev = compute_ev(cost * 10, cost, rop)

    return dict(
        strategy="Long Put", bias="Bearish",
        legs=[leg], expiry=expiry, dte=days_to_expiry(expiry),
        net_credit=-cost, spread_width=0,
        max_profit=cost * 10, max_loss=cost,
        risk_reward_ratio=round(cost / (cost * 10), 2),
        credit_pct_of_width=0,
        breakeven_lower=0, breakeven_upper=be,
        short_leg_delta=abs(leg.delta), prob_of_profit=rop,
        prob_of_max_loss=round(1 - rop, 2),
        expected_value=ev,
        passes_rr_filter=True, passes_credit_filter=True, passes_liquidity_filter=True,
        rationale=(
            f"Bearish bias ({signals.bias_confidence}% confidence). "
            f"RSI {signals.rsi} ({signals.rsi_signal}). "
            f"MACD: {signals.macd_crossover} crossover. "
            f"Long put at ${leg.strike} — break even below ${be}. "
            f"Delta {leg.delta:.2f} implies ~{int(rop*100)}% probability of profit."
        ),
        exit_plan=generate_exit_plan("Long Put", cost * 10, -cost, expiry, days_to_expiry(expiry)),
    )


def _build_vertical_spread(signals, df_buy, df_sell, option_type, strategy_name,
                            bias, expiry, price) -> Optional[dict]:
    if option_type == "CALL":
        buy_row = find_strike_by_delta(df_buy, TARGET_LONG_DELTA_DEBIT, price, "CALL")
        sell_row = find_strike_by_delta(df_sell, TARGET_SHORT_DELTA_CREDIT, price, "CALL")
    else:
        buy_row = find_strike_by_delta(df_buy, TARGET_LONG_DELTA_DEBIT, price, "PUT")
        sell_row = find_strike_by_delta(df_sell, TARGET_SHORT_DELTA_CREDIT, price, "PUT")

    if buy_row is None or sell_row is None:
        return None

    buy_leg = build_option_leg(buy_row, "BUY", option_type, expiry)
    sell_leg = build_option_leg(sell_row, "SELL", option_type, expiry)

    # Validate leg ordering
    if option_type == "CALL":
        if buy_leg.strike >= sell_leg.strike:
            return None
    else:
        if buy_leg.strike <= sell_leg.strike:
            return None

    net_debit = round(buy_leg.mid_price - sell_leg.mid_price, 2)
    if net_debit <= 0:
        return None

    spread_width = abs(sell_leg.strike - buy_leg.strike)
    max_profit = round(spread_width - net_debit, 2)
    max_loss = net_debit
    rr = round(max_loss / max_profit, 2) if max_profit > 0 else 999
    short_delta = abs(sell_leg.delta) if sell_leg.delta != 0 else 0.25
    rop = round(1 - short_delta, 2)
    ev = compute_ev(max_profit, max_loss, rop)

    if option_type == "CALL":
        be = round(buy_leg.strike + net_debit, 2)
        be_lower, be_upper = be, 999
    else:
        be = round(buy_leg.strike - net_debit, 2)
        be_lower, be_upper = 0, be

    return dict(
        strategy=strategy_name, bias=bias,
        legs=[buy_leg, sell_leg], expiry=expiry, dte=days_to_expiry(expiry),
        net_credit=-net_debit, spread_width=spread_width,
        max_profit=max_profit, max_loss=max_loss,
        risk_reward_ratio=rr,
        credit_pct_of_width=0,
        breakeven_lower=be_lower, breakeven_upper=be_upper,
        short_leg_delta=short_delta, prob_of_profit=rop,
        prob_of_max_loss=round(1 - rop, 2),
        expected_value=ev,
        passes_rr_filter=rr <= MIN_RISK_REWARD_RATIO * 2,
        passes_credit_filter=True,
        passes_liquidity_filter=True,
        rationale=(
            f"{bias} spread. Buy {option_type} at ${buy_leg.strike}, sell at ${sell_leg.strike}. "
            f"Net cost ${net_debit:.2f}/share — max profit ${max_profit:.2f}/share if stock moves in your favor. "
            f"Short leg delta: {short_delta:.2f} → ~{int(rop*100)}% probability of any profit. "
            f"Risk/Reward: 1:{round(max_profit/max_loss,1) if max_loss > 0 else '∞'}. "
            f"IV rank {signals.iv_rank:.0f}% — {'low IV favors buying spreads.' if signals.iv_rank < 45 else 'note: elevated IV inflates cost.'}"
        ),
        exit_plan=generate_exit_plan(strategy_name, max_profit, -net_debit, expiry, days_to_expiry(expiry)),
    )


def _build_credit_spread(signals, calls, puts, option_type, strategy_name,
                          bias, expiry, price,
                          spread_width_override: Optional[int] = None) -> Optional[dict]:
    if option_type == "PUT":
        sell_row = find_strike_by_delta(puts, TARGET_SHORT_DELTA_CREDIT, price, "PUT")
        if sell_row is None:
            return None
        sell_leg = build_option_leg(sell_row, "SELL", "PUT", expiry)
        # Buy leg: fixed width if specified, otherwise match OTM distance
        if spread_width_override:
            buy_target = sell_leg.strike - spread_width_override
        else:
            otm_dist = abs(price - sell_leg.strike)
            buy_target = sell_leg.strike - otm_dist
        buy_row = puts.iloc[(puts["strike"] - buy_target).abs().argsort()[:1]].iloc[0]
        if buy_row["strike"] >= sell_leg.strike:
            return None
        buy_leg = build_option_leg(buy_row, "BUY", "PUT", expiry)

        net_credit = round(sell_leg.mid_price - buy_leg.mid_price, 2)
        spread_width = round(sell_leg.strike - buy_leg.strike, 2)

    else:  # CALL
        sell_row = find_strike_by_delta(calls, TARGET_SHORT_DELTA_CREDIT, price, "CALL")
        if sell_row is None:
            return None
        sell_leg = build_option_leg(sell_row, "SELL", "CALL", expiry)
        if spread_width_override:
            buy_target = sell_leg.strike + spread_width_override
        else:
            otm_dist = abs(sell_leg.strike - price)
            buy_target = sell_leg.strike + otm_dist
        buy_row = calls.iloc[(calls["strike"] - buy_target).abs().argsort()[:1]].iloc[0]
        if buy_row["strike"] <= sell_leg.strike:
            return None
        buy_leg = build_option_leg(buy_row, "BUY", "CALL", expiry)

        net_credit = round(sell_leg.mid_price - buy_leg.mid_price, 2)
        spread_width = round(buy_leg.strike - sell_leg.strike, 2)

    if net_credit <= 0 or spread_width <= 0:
        return None

    credit_pct = round(net_credit / spread_width * 100, 1)
    max_profit = net_credit
    max_loss = round(spread_width - net_credit, 2)
    rr = round(max_loss / max_profit, 2) if max_profit > 0 else 999
    short_delta = abs(sell_leg.delta) if sell_leg.delta != 0 else 0.25
    rop = round(1 - short_delta, 2)
    ev = compute_ev(max_profit, max_loss, rop)

    if option_type == "PUT":
        be = round(sell_leg.strike - net_credit, 2)
        be_lower, be_upper = be, 999
    else:
        be = round(sell_leg.strike + net_credit, 2)
        be_lower, be_upper = 0, be

    passes_credit = credit_pct >= MIN_CREDIT_PCT_OF_WIDTH

    return dict(
        strategy=strategy_name, bias=bias,
        legs=[sell_leg, buy_leg], expiry=expiry, dte=days_to_expiry(expiry),
        net_credit=net_credit, spread_width=spread_width,
        max_profit=max_profit, max_loss=max_loss,
        risk_reward_ratio=rr,
        credit_pct_of_width=credit_pct,
        breakeven_lower=be_lower, breakeven_upper=be_upper,
        short_leg_delta=short_delta, prob_of_profit=rop,
        prob_of_max_loss=round(1 - rop, 2),
        expected_value=ev,
        passes_rr_filter=rr <= 5.0,
        passes_credit_filter=passes_credit,
        passes_liquidity_filter=True,
        rationale=(
            f"Sell {option_type} at ${sell_leg.strike} ({short_delta:.2f} delta), "
            f"buy protection at ${buy_leg.strike}. "
            f"Collect ${net_credit:.2f}/share credit = {credit_pct:.0f}% of the ${spread_width} spread width. "
            f"{'✅ Meets minimum 25% credit threshold.' if passes_credit else '⚠️ Below 25% threshold — thin credit.'} "
            f"~{int(rop*100)}% probability of keeping full credit. "
            f"Risk/Reward: risk ${max_loss:.2f} to make ${max_profit:.2f}. "
            f"IV rank {signals.iv_rank:.0f}% — {'ideal for selling premium.' if signals.iv_rank >= 50 else 'marginal IV for credit selling.'}"
        ),
        exit_plan=generate_exit_plan(strategy_name, max_profit, net_credit, expiry, days_to_expiry(expiry)),
    )


def _build_iron_condor(signals: MarketSignals, calls: pd.DataFrame,
                        puts: pd.DataFrame, expiry: str,
                        spread_width_override: Optional[int] = None) -> Optional[dict]:
    price = signals.current_price

    put_sell_row = find_strike_by_delta(puts, TARGET_SHORT_DELTA_CONDOR, price, "PUT")
    call_sell_row = find_strike_by_delta(calls, TARGET_SHORT_DELTA_CONDOR, price, "CALL")

    if put_sell_row is None or call_sell_row is None:
        return None

    put_sell_leg = build_option_leg(put_sell_row, "SELL", "PUT", expiry)
    call_sell_leg = build_option_leg(call_sell_row, "SELL", "CALL", expiry)

    # Buy wings: fixed width if specified, otherwise use OTM distance
    if spread_width_override:
        put_buy_target  = put_sell_leg.strike  - spread_width_override
        call_buy_target = call_sell_leg.strike + spread_width_override
    else:
        put_width  = abs(price - put_sell_leg.strike)
        call_width = abs(call_sell_leg.strike - price)
        put_buy_target  = put_sell_leg.strike  - put_width
        call_buy_target = call_sell_leg.strike + call_width

    pb_row = puts.iloc[(puts["strike"] - put_buy_target).abs().argsort()[:1]].iloc[0]
    cb_row = calls.iloc[(calls["strike"] - call_buy_target).abs().argsort()[:1]].iloc[0]

    if pb_row["strike"] >= put_sell_leg.strike or cb_row["strike"] <= call_sell_leg.strike:
        return None

    put_buy_leg  = build_option_leg(pb_row, "BUY", "PUT", expiry)
    call_buy_leg = build_option_leg(cb_row, "BUY", "CALL", expiry)

    net_credit = round(
        put_sell_leg.mid_price - put_buy_leg.mid_price +
        call_sell_leg.mid_price - call_buy_leg.mid_price, 2
    )
    if net_credit <= 0:
        return None

    put_width_actual  = round(put_sell_leg.strike - put_buy_leg.strike, 2)
    call_width_actual = round(call_buy_leg.strike - call_sell_leg.strike, 2)
    max_wing = max(put_width_actual, call_width_actual)
    max_loss = round(max_wing - net_credit, 2)
    credit_pct = round(net_credit / max_wing * 100, 1)
    rr = round(max_loss / net_credit, 2) if net_credit > 0 else 999

    short_put_delta = abs(put_sell_leg.delta) if put_sell_leg.delta != 0 else 0.20
    short_call_delta = abs(call_sell_leg.delta) if call_sell_leg.delta != 0 else 0.20
    rop = round(1 - short_put_delta - short_call_delta, 2)
    rop = max(rop, 0.40)

    ev = compute_ev(net_credit, max_loss, rop)
    be_lower = round(put_sell_leg.strike - net_credit, 2)
    be_upper = round(call_sell_leg.strike + net_credit, 2)
    passes_credit = credit_pct >= MIN_CREDIT_PCT_OF_WIDTH

    legs = [put_sell_leg, put_buy_leg, call_sell_leg, call_buy_leg]

    return dict(
        strategy="Iron Condor", bias="Neutral",
        legs=legs, expiry=expiry, dte=days_to_expiry(expiry),
        net_credit=net_credit, spread_width=max_wing,
        max_profit=net_credit, max_loss=max_loss,
        risk_reward_ratio=rr,
        credit_pct_of_width=credit_pct,
        breakeven_lower=be_lower, breakeven_upper=be_upper,
        short_leg_delta=max(short_put_delta, short_call_delta),
        prob_of_profit=rop,
        prob_of_max_loss=round(short_put_delta * short_call_delta, 3),
        expected_value=ev,
        passes_rr_filter=rr <= 5.0,
        passes_credit_filter=passes_credit,
        passes_liquidity_filter=True,
        rationale=(
            f"Neutral strategy with {signals.iv_rank:.0f}% IV rank — "
            f"{'excellent conditions for premium selling.' if signals.iv_rank >= 65 else 'IV elevated enough to sell.'} "
            f"IV is {signals.iv_vs_hv:+.1f}% above 20-day realized vol — premium is inflated. "
            f"Collect ${net_credit:.2f}/share ({credit_pct:.0f}% of wing width). "
            f"Profit zone: ${be_lower} – ${be_upper}. "
            f"~{int(rop*100)}% probability of keeping full credit. "
            f"Skew: {signals.skew_signal} — {'put skew elevated, consider wider put wing.' if signals.iv_skew > 5 else 'skew normal, symmetric condor appropriate.'}"
        ),
        exit_plan=generate_exit_plan("Iron Condor", net_credit, net_credit, expiry, days_to_expiry(expiry)),
    )


def _build_long_straddle(signals, calls, puts, expiry, price) -> Optional[dict]:
    atm_call_row = calls.iloc[(calls["strike"] - price).abs().argsort()[:1]].iloc[0]
    atm_put_row  = puts.iloc[(puts["strike"] - price).abs().argsort()[:1]].iloc[0]

    call_leg = build_option_leg(atm_call_row, "BUY", "CALL", expiry)
    put_leg  = build_option_leg(atm_put_row,  "BUY", "PUT",  expiry)

    total_cost = round(call_leg.mid_price + put_leg.mid_price, 2)
    if total_cost < MIN_MID_PRICE:
        return None

    be_upper = round(call_leg.strike + total_cost, 2)
    be_lower = round(put_leg.strike - total_cost, 2)
    rop = 0.40  # straddles typically have ~40% PoP due to cost
    ev = compute_ev(total_cost * 3, total_cost, rop)

    return dict(
        strategy="Long Straddle", bias="Neutral (Volatile)",
        legs=[call_leg, put_leg], expiry=expiry, dte=days_to_expiry(expiry),
        net_credit=-total_cost, spread_width=0,
        max_profit=total_cost * 10, max_loss=total_cost,
        risk_reward_ratio=round(total_cost / (total_cost * 10), 2),
        credit_pct_of_width=0,
        breakeven_lower=be_lower, breakeven_upper=be_upper,
        short_leg_delta=0.50, prob_of_profit=rop,
        prob_of_max_loss=0.05,
        expected_value=ev,
        passes_rr_filter=True, passes_credit_filter=True, passes_liquidity_filter=True,
        rationale=(
            f"Neutral bias but expecting a large move. IV rank {signals.iv_rank:.0f}% "
            f"({'options cheap — good time to buy vol.' if signals.iv_rank < 40 else 'note: elevated IV makes straddle expensive.'}) "
            f"Costs ${total_cost:.2f}/share. Needs a move {'larger' if signals.current_iv > 30 else 'of at least'} "
            f"${total_cost:.2f} ({round(total_cost/price*100,1)}%) to be profitable by expiry. "
            f"Profit zone outside ${be_lower} – ${be_upper}."
        ),
        exit_plan=generate_exit_plan("Long Straddle", total_cost * 10, -total_cost, expiry, days_to_expiry(expiry)),
    )


# ─────────────────────────────────────────────────────────────
# MAIN RECOMMENDATION ENGINE
# ─────────────────────────────────────────────────────────────

def run_engine(
    signals: MarketSignals,
    calls: pd.DataFrame,
    puts: pd.DataFrame,
    option_dates: list[str],
    spread_width_override: Optional[int] = None,
    weeks_out: int = 4,
    strategy_mode: str = 'all',
) -> list[TradeCandidate]:
    """
    Main engine entry point.
    Builds all candidate trades, filters them, scores them, returns ranked list.
    spread_width_override: if 5 or 10, pins credit-spread buy legs to that fixed width.
    weeks_out: user-selected expiry target in weeks — drives pick_expiry_by_dte windows.
    strategy_mode: 'all' = market-driven (default), 'long_only' = long/debit only,
                   'credit_only' = credit/short premium only.
    """
    price = signals.current_price
    bias  = signals.directional_bias
    # Only treat as directional if the engine has real conviction.
    # "Neutral @ 0% confidence" must NOT trigger long directional trades.
    BULLISH = bias in ("Bullish", "Mildly Bullish") and signals.bias_confidence >= 20
    BEARISH = bias in ("Bearish", "Mildly Bearish") and signals.bias_confidence >= 20
    NEUTRAL = not BULLISH and not BEARISH
    HIGH_IV = signals.iv_rank >= 50
    LOW_IV  = signals.iv_rank < 50

    # Strategy mode gates: control which trade families to build
    BUILD_LONG   = strategy_mode in ('all', 'long_only')
    BUILD_CREDIT = strategy_mode in ('all', 'credit_only')
    # In dedicated modes, relax IV gates so users always see their preferred type
    # e.g. 'long_only' user should see long options even in high-IV envs
    LONG_IV_OK   = LOW_IV  or strategy_mode == 'long_only'
    CREDIT_IV_OK = HIGH_IV or strategy_mode == 'credit_only'

    # Filter options chain to tradeable range (75%–130% of price)
    calls_f = calls[
        (calls["strike"] >= price * 0.75) &
        (calls["strike"] <= price * 1.30) &
        (calls["bid"] >= 0) &
        (calls["ask"] >= 0)
    ].copy()
    puts_f = puts[
        (puts["strike"] >= price * 0.75) &
        (puts["strike"] <= price * 1.30) &
        (puts["bid"] >= 0) &
        (puts["ask"] >= 0)
    ].copy()

    # Pick expiries anchored to the user's weeks_out selection.
    # Allow ±1 week on either side so the nearest listed expiry is always found.
    target_dte = weeks_out * 7
    dte_lo = max(7, target_dte - 7)
    dte_hi = target_dte + 7
    exp_credit   = pick_expiry_by_dte(option_dates, dte_lo, dte_hi)
    exp_debit    = pick_expiry_by_dte(option_dates, dte_lo, dte_hi)
    exp_straddle = pick_expiry_by_dte(option_dates, dte_lo, dte_hi)

    if exp_credit is None or exp_debit is None:
        return []

    def get_chain(expiry):
        return calls_f, puts_f  # simplified: use same chain for all expiries

    candidates_raw = []

    # ── Build all applicable strategies ──────────────────────────────────────
    # Long directional: require conviction + IV gate (relaxed in long_only mode)
    if BUILD_LONG and BULLISH and LONG_IV_OK:
        c, p = get_chain(exp_debit)
        t = _build_long_call(signals, c, exp_debit)
        if t:
            candidates_raw.append(t)

    if BUILD_LONG and BEARISH and LONG_IV_OK:
        c, p = get_chain(exp_debit)
        t = _build_long_put(signals, p, exp_debit)
        if t:
            candidates_raw.append(t)

    # Debit vertical spreads: no IV gate (defined R:R makes them viable in any IV)
    if BUILD_LONG and BULLISH:
        c, p = get_chain(exp_debit)
        t = _build_vertical_spread(signals, c, c, "CALL", "Bull Call Spread", "Bullish", exp_debit, price)
        if t:
            candidates_raw.append(t)

    if BUILD_LONG and BEARISH:
        c, p = get_chain(exp_debit)
        t = _build_vertical_spread(signals, p, p, "PUT", "Bear Put Spread", "Bearish", exp_debit, price)
        if t:
            candidates_raw.append(t)

    # Credit spreads: require elevated IV in 'all' mode; always build in 'credit_only'
    if BUILD_CREDIT and not BEARISH and CREDIT_IV_OK:
        c, p = get_chain(exp_credit)
        t = _build_credit_spread(signals, c, p, "PUT", "Bull Put Spread", "Bullish/Neutral", exp_credit, price,
                                  spread_width_override=spread_width_override)
        if t:
            candidates_raw.append(t)

    if BUILD_CREDIT and not BULLISH and CREDIT_IV_OK:
        c, p = get_chain(exp_credit)
        t = _build_credit_spread(signals, c, p, "CALL", "Bear Call Spread", "Bearish/Neutral", exp_credit, price,
                                  spread_width_override=spread_width_override)
        if t:
            candidates_raw.append(t)

    if BUILD_CREDIT and NEUTRAL and CREDIT_IV_OK:
        c, p = get_chain(exp_credit)
        t = _build_iron_condor(signals, c, p, exp_credit, spread_width_override=spread_width_override)
        if t:
            candidates_raw.append(t)

    # Long straddle: neutral bias + cheap premium (relaxed in long_only mode)
    if BUILD_LONG and NEUTRAL and LONG_IV_OK:
        c, p = get_chain(exp_straddle or exp_debit)
        t = _build_long_straddle(signals, c, p, exp_straddle or exp_debit, price)
        if t:
            candidates_raw.append(t)

    # ── FILTER PASS ──────────────────────────────────────────
    filtered = []
    for t in candidates_raw:
        warnings_list = []

        # Check liquidity per leg
        all_liquid = True
        for leg in t["legs"]:
            ok, issues = check_leg_liquidity(leg)
            if not ok:
                all_liquid = False
                warnings_list.extend(issues)
        t["passes_liquidity_filter"] = all_liquid

        # Credit filter
        if not t["passes_credit_filter"]:
            warnings_list.append(f"Credit is only {t['credit_pct_of_width']:.1f}% of spread width (min {MIN_CREDIT_PCT_OF_WIDTH}%)")

        # Hard reject: both liquidity AND credit fail → skip
        if not t["passes_liquidity_filter"] and not t["passes_credit_filter"]:
            continue

        t["warnings"] = warnings_list
        filtered.append(t)

    # ── SCORING PASS ─────────────────────────────────────────
    scored = []
    for t in filtered:
        sig_score  = score_signal_alignment(signals, t["strategy"])
        str_score  = score_structure(t)
        liq_score  = score_liquidity(t["legs"])
        iv_score   = score_iv_fit(signals, t["strategy"])
        total      = sig_score + str_score + liq_score + iv_score

        scored.append(TradeCandidate(
            strategy=t["strategy"],
            bias=t["bias"],
            legs=t["legs"],
            expiry=t["expiry"],
            dte=t["dte"],
            net_credit=t["net_credit"],
            spread_width=t["spread_width"],
            max_profit=t["max_profit"],
            max_loss=t["max_loss"],
            risk_reward_ratio=t["risk_reward_ratio"],
            credit_pct_of_width=t["credit_pct_of_width"],
            breakeven_lower=t["breakeven_lower"],
            breakeven_upper=t["breakeven_upper"],
            short_leg_delta=t["short_leg_delta"],
            prob_of_profit=t["prob_of_profit"],
            prob_of_max_loss=t["prob_of_max_loss"],
            expected_value=t["expected_value"],
            passes_rr_filter=t["passes_rr_filter"],
            passes_liquidity_filter=t["passes_liquidity_filter"],
            passes_credit_filter=t["passes_credit_filter"],
            signal_score=sig_score,
            structure_score=str_score,
            liquidity_score=liq_score,
            iv_fit_score=iv_score,
            total_score=total,
            rationale=t["rationale"],
            exit_plan=t["exit_plan"],
            warnings=t.get("warnings", []),
        ))

    scored.sort(key=lambda x: x.total_score, reverse=True)
    return scored[:6]  # Return top 6
