"""
backtest.py — Strategy Backtesting Engine
==========================================
Simulates historical option strategy performance using:
  - yfinance daily OHLCV for underlying prices
  - Black-Scholes pricing with rolling HV-20 as IV proxy (+15% premium)
  - Walk-forward analysis (every 5 trading days)

Supported strategies (all use-cases):
  Credit:  Bull Put Spread, Bear Call Spread, Iron Condor
  Debit:   Bull Call Spread, Bear Put Spread, Long Straddle, Long Call, Long Put
  Naked:   Short Put, Covered Call

Exit rules:
  Credit: close at 50% profit | 200% of max-profit loss | 21 DTE | expiry
  Debit:  close at 100% gain  | 50% of debit loss       |  5 DTE | expiry
"""

import numpy as np
import pandas as pd
from math import log, sqrt, exp, erf
from dataclasses import dataclass, field
from typing import Optional
import warnings

import bar_cache

warnings.filterwarnings("ignore")


# ─────────────────────────────────────────────────────────────
# CONSTANTS
# ─────────────────────────────────────────────────────────────
RISK_FREE_RATE        = 0.05   # 5% annual risk-free rate
TARGET_DELTA_CREDIT   = 0.30   # short-leg delta target for credit spreads
TARGET_DELTA_DEBIT    = 0.40   # long-leg delta target for debit spreads
TARGET_DELTA_CONDOR   = 0.15   # iron condor short legs

CREDIT_PROFIT_TARGET  = 0.50   # close credit at 50% of max profit
CREDIT_STOP_MULT      = 2.00   # stop credit at 2× max profit (in loss)
CREDIT_TIME_EXIT_DTE  = 21     # time-based exit for credit trades
DEBIT_PROFIT_TARGET   = 1.00   # close debit at 100% gain on premium paid
DEBIT_STOP_PCT        = 0.50   # stop debit at 50% loss of premium
DEBIT_TIME_EXIT_DTE   = 5      # time-based exit for debit trades

SCAN_EVERY_N_DAYS     = 5      # re-analyze every 5 trading days (weekly)
MIN_HIST_DAYS         = 220    # minimum trading-day history required
IV_PREMIUM_FACTOR     = 1.15   # HV × 1.15 = IV proxy (implied > realized)
CONTRACTS             = 1      # all P&L stated per 1 contract (100 shares)


# ─────────────────────────────────────────────────────────────
# BLACK-SCHOLES ENGINE
# ─────────────────────────────────────────────────────────────

def _norm_cdf(x: float) -> float:
    return 0.5 * (1.0 + erf(x / sqrt(2.0)))


def bs_price(S: float, K: float, T: float, r: float, sigma: float,
             option_type: str) -> float:
    """Standard Black-Scholes price. Returns intrinsic when T ≤ 0."""
    ot = option_type.upper()
    if T <= 0 or sigma <= 0:
        return max(S - K, 0.0) if ot == 'CALL' else max(K - S, 0.0)
    try:
        d1 = (log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * sqrt(T))
        d2 = d1 - sigma * sqrt(T)
    except (ValueError, ZeroDivisionError):
        return 0.0
    if ot == 'CALL':
        return max(S * _norm_cdf(d1) - K * exp(-r * T) * _norm_cdf(d2), 0.0)
    return max(K * exp(-r * T) * _norm_cdf(-d2) - S * _norm_cdf(-d1), 0.0)


def bs_delta(S: float, K: float, T: float, r: float, sigma: float,
             option_type: str) -> float:
    """Black-Scholes delta (calls: 0→1; puts: −1→0)."""
    ot = option_type.upper()
    if T <= 0:
        if ot == 'CALL':
            return 1.0 if S > K else 0.0
        return -1.0 if S < K else 0.0
    try:
        d1 = (log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * sqrt(T))
    except (ValueError, ZeroDivisionError):
        return 0.0
    return _norm_cdf(d1) if ot == 'CALL' else _norm_cdf(d1) - 1.0


def round_to_strike(price: float, S: float) -> float:
    """Round to nearest standard option-strike increment."""
    if S < 25:
        return round(price * 2) / 2      # $0.50
    elif S < 100:
        return round(price)              # $1.00
    elif S < 500:
        return round(price / 2.5) * 2.5 # $2.50
    elif S < 1000:
        return round(price / 5) * 5     # $5.00
    return round(price / 10) * 10       # $10.00


def find_strike_by_delta(S: float, target_delta_abs: float, T: float,
                         sigma: float, option_type: str) -> float:
    """Binary-search the strike giving approximately |target_delta|."""
    r = RISK_FREE_RATE
    ot = option_type.upper()
    if ot == 'CALL':
        lo, hi = S * 0.5, S * 2.5
        for _ in range(64):
            mid = (lo + hi) / 2
            d = bs_delta(S, mid, T, r, sigma, 'CALL')
            if d > target_delta_abs:
                lo = mid   # too ITM → need higher K
            else:
                hi = mid
    else:  # PUT: |delta| increases as K increases (toward ATM)
        lo, hi = S * 0.3, S * 1.05
        for _ in range(64):
            mid = (lo + hi) / 2
            d = abs(bs_delta(S, mid, T, r, sigma, 'PUT'))
            if d > target_delta_abs:
                hi = mid   # too ITM → need lower K
            else:
                lo = mid
    return round_to_strike((lo + hi) / 2, S)


def auto_spread_width(S: float) -> float:
    """Default spread width calibrated to stock price."""
    if S < 25:   return 2.5
    if S < 100:  return 5.0
    if S < 300:  return 10.0
    if S < 1000: return 20.0
    return 50.0


# ─────────────────────────────────────────────────────────────
# SIGNAL COMPUTATION (price-history only; no live options chain)
# ─────────────────────────────────────────────────────────────

def _rsi(series: pd.Series, period: int = 14) -> float:
    delta = series.diff()
    gain  = delta.clip(lower=0).rolling(period).mean()
    loss  = (-delta.clip(upper=0)).rolling(period).mean()
    rs    = gain / (loss + 1e-10)
    return float((100 - 100 / (1 + rs)).iloc[-1])


def _hv(series: pd.Series, period: int) -> float:
    returns = series.pct_change().dropna()
    val = float(returns.rolling(period).std().iloc[-1]) * sqrt(252) * 100
    return max(val, 1.0)


def _iv_rank(hv_series: pd.Series, current_hv: float) -> float:
    lo, hi = float(hv_series.min()), float(hv_series.max())
    if hi <= lo:
        return 50.0
    return float(np.clip((current_hv - lo) / (hi - lo) * 100, 0, 100))


def compute_signals(hist: pd.DataFrame) -> dict:
    """
    Derive all signals needed for strategy selection from price history.
    Returns an empty dict when there is insufficient data.
    """
    close = hist["Close"].astype(float)
    if len(close) < MIN_HIST_DAYS:
        return {}

    S = float(close.iloc[-1])

    # Moving averages
    ma20  = float(close.rolling(20).mean().iloc[-1])
    ma50  = float(close.rolling(50).mean().iloc[-1])
    ma200 = float(close.rolling(200).mean().iloc[-1])

    # MA50 slope (10-day % change)
    ma50_series = close.rolling(50).mean()
    ma50_10d    = float(ma50_series.iloc[-11]) if len(ma50_series) > 10 else ma50
    ma50_slope  = (ma50 - ma50_10d) / ma50_10d * 100 if ma50_10d > 0 else 0.0

    # Momentum
    rsi = _rsi(close)
    ema12     = close.ewm(span=12, adjust=False).mean()
    ema26     = close.ewm(span=26, adjust=False).mean()
    macd_line = ema12 - ema26
    sig_line  = macd_line.ewm(span=9, adjust=False).mean()
    macd_hist = float((macd_line - sig_line).iloc[-1])

    # Volatility
    hv20 = _hv(close, 20)
    hv60 = _hv(close, 60)
    iv_proxy = min(hv20 * IV_PREMIUM_FACTOR, 200.0)

    # IV rank (based on rolling HV-20 over the past year)
    daily_hv20 = close.pct_change().dropna().rolling(20).std() * sqrt(252) * 100
    iv_rank    = _iv_rank(daily_hv20.dropna().tail(252), hv20)

    # Directional bias
    above_ma50  = S > ma50
    above_ma200 = S > ma200
    if above_ma50 and above_ma200 and ma50_slope > 0.1:
        bias, conf = 'Bullish', min(90, 70 + int(abs(ma50_slope) * 3))
    elif not above_ma50 and not above_ma200 and ma50_slope < -0.1:
        bias, conf = 'Bearish', min(90, 70 + int(abs(ma50_slope) * 3))
    elif above_ma50:
        bias, conf = 'Bullish', 50
    elif not above_ma50:
        bias, conf = 'Bearish', 50
    else:
        bias, conf = 'Neutral', 40

    # RSI adjustments
    if rsi > 70 and bias == 'Bullish':   conf = max(30, conf - 20)
    if rsi > 70 and bias == 'Bearish':   conf = min(80, conf + 10)
    if rsi < 30 and bias == 'Bearish':   conf = max(30, conf - 20)
    if rsi < 30 and bias == 'Bullish':   conf = min(80, conf + 10)

    # MACD confirmation
    if macd_hist > 0 and bias == 'Bullish': conf = min(90, conf + 10)
    if macd_hist < 0 and bias == 'Bearish': conf = min(90, conf + 10)

    # Volatility regime
    if iv_rank > 60:   vol_regime = 'Sell Premium'
    elif iv_rank < 30: vol_regime = 'Buy Premium'
    else:              vol_regime = 'Neutral'

    # IV environment label
    if hv20 > 40:   iv_env = 'High'
    elif hv20 > 25: iv_env = 'Elevated'
    elif hv20 > 15: iv_env = 'Moderate'
    elif hv20 > 8:  iv_env = 'Low'
    else:           iv_env = 'Very Low'

    return {
        'price': S,
        'ma20': ma20, 'ma50': ma50, 'ma200': ma200,
        'above_ma50': above_ma50, 'above_ma200': above_ma200,
        'ma50_slope': ma50_slope,
        'rsi': rsi, 'macd_hist': macd_hist,
        'hv20': hv20, 'hv60': hv60,
        'iv_proxy': iv_proxy,
        'iv_rank': iv_rank,
        'directional_bias': bias,
        'bias_confidence': conf,
        'volatility_regime': vol_regime,
        'iv_environment': iv_env,
    }


# ─────────────────────────────────────────────────────────────
# TRADE DATA STRUCTURES
# ─────────────────────────────────────────────────────────────

@dataclass
class SimLeg:
    action:      str    # 'BUY' | 'SELL'
    option_type: str    # 'CALL' | 'PUT'
    strike:      float
    entry_price: float  # BS premium at entry
    delta:       float


@dataclass
class SimTrade:
    # Identity
    strategy:     str
    bias:         str
    is_credit:    bool

    # Timing
    entry_date:   str
    expiry_date:  str
    dte_at_entry: int

    # Financials at entry
    underlying_entry: float
    legs:             list   # list[SimLeg]
    entry_net:        float  # + = credit received, − = debit paid
    max_profit:       float  # per share
    max_loss:         float  # per share (positive number)

    # Signal context
    iv_proxy:         float
    iv_rank:          float
    directional_bias: str
    bias_confidence:  int
    volatility_regime: str
    iv_environment:   str

    # Exit (filled by simulate_trade_exit)
    exit_date:       str   = ''
    exit_reason:     str   = ''
    underlying_exit: float = 0.0
    pnl_per_share:   float = 0.0
    pnl_dollar:      float = 0.0
    pnl_pct_of_max:  float = 0.0
    outcome:         str   = ''   # 'WIN' | 'LOSS' | 'BREAKEVEN'


# ─────────────────────────────────────────────────────────────
# STRATEGY BUILDERS
# ─────────────────────────────────────────────────────────────

def _credit_spread(S, T, sigma, short_type, short_delta, long_delta, width):
    """Return (legs, net_credit, max_profit, max_loss) or None if not viable."""
    r = RISK_FREE_RATE
    ot = short_type.upper()

    short_K = find_strike_by_delta(S, short_delta, T, sigma, ot)
    if ot == 'PUT':
        long_K = short_K - width
    else:
        long_K = short_K + width

    short_p = bs_price(S, short_K, T, r, sigma, ot)
    long_p  = bs_price(S, long_K,  T, r, sigma, ot)

    net = short_p - long_p
    if net < 0.05:
        return None
    max_profit = net
    max_loss   = width - net
    if max_loss <= 0 or net / width < 0.20:
        return None

    legs = [
        SimLeg('SELL', ot, short_K, short_p, bs_delta(S, short_K, T, r, sigma, ot)),
        SimLeg('BUY',  ot, long_K,  long_p,  bs_delta(S, long_K,  T, r, sigma, ot)),
    ]
    return legs, net, max_profit, max_loss


def _debit_spread(S, T, sigma, long_type, long_delta, width):
    """Return (legs, net_debit_neg, max_profit, max_loss) or None if not viable."""
    r  = RISK_FREE_RATE
    ot = long_type.upper()

    long_K = find_strike_by_delta(S, long_delta, T, sigma, ot)
    if ot == 'CALL':
        short_K = long_K + width
    else:
        short_K = long_K - width

    long_p  = bs_price(S, long_K,  T, r, sigma, ot)
    short_p = bs_price(S, short_K, T, r, sigma, ot)

    net_debit = long_p - short_p
    if net_debit < 0.05:
        return None
    max_profit = width - net_debit
    max_loss   = net_debit
    if max_profit <= 0:
        return None

    legs = [
        SimLeg('BUY',  ot, long_K,  long_p,  bs_delta(S, long_K,  T, r, sigma, ot)),
        SimLeg('SELL', ot, short_K, short_p, bs_delta(S, short_K, T, r, sigma, ot)),
    ]
    return legs, -net_debit, max_profit, max_loss


def build_trades(signals: dict, analysis_date: pd.Timestamp,
                 expiry_date: pd.Timestamp, strategy_mode: str,
                 spread_width_override: Optional[float]) -> list:
    """
    Build all SimTrade candidates for one analysis date.
    Returns a list[SimTrade] (may be empty).
    """
    if not signals:
        return []

    S        = signals['price']
    r        = RISK_FREE_RATE
    sigma    = signals['iv_proxy'] / 100.0
    dte      = max((expiry_date - analysis_date).days, 1)
    T        = dte / 365.0
    bias     = signals['directional_bias']
    conf     = signals['bias_confidence']
    vol_reg  = signals['volatility_regime']
    iv_rank  = signals['iv_rank']
    width    = spread_width_override if spread_width_override else auto_spread_width(S)

    entry_str  = analysis_date.strftime('%Y-%m-%d')
    expiry_str = expiry_date.strftime('%Y-%m-%d')

    BUILD_LONG    = strategy_mode in ('all', 'long_only')
    BUILD_CREDIT  = strategy_mode in ('all', 'credit_only')
    BUILD_NAKED   = strategy_mode in ('all', 'short_or_covered')

    common = dict(
        entry_date=entry_str, expiry_date=expiry_str, dte_at_entry=dte,
        underlying_entry=S,
        iv_proxy=signals['iv_proxy'], iv_rank=iv_rank,
        directional_bias=bias, bias_confidence=conf,
        volatility_regime=vol_reg, iv_environment=signals['iv_environment'],
    )

    trades = []

    # ── CREDIT SPREADS ─────────────────────────────────────────
    if BUILD_CREDIT and dte >= 14:

        # Bull Put Spread (bullish or neutral + sell-premium vol regime)
        # Must match engine: requires SELL_REGIME (vol_regime == "Sell Premium")
        if bias in ('Bullish', 'Neutral') and vol_reg == 'Sell Premium':
            res = _credit_spread(S, T, sigma, 'PUT', TARGET_DELTA_CREDIT, 0.25, width)
            if res:
                legs, net, mp, ml = res
                trades.append(SimTrade(
                    strategy='Bull Put Spread', bias='Bullish', is_credit=True,
                    legs=legs, entry_net=net, max_profit=mp, max_loss=ml, **common))

        # Bear Call Spread (bearish or neutral + sell-premium vol regime)
        # Must match engine: requires SELL_REGIME
        if bias in ('Bearish', 'Neutral') and vol_reg == 'Sell Premium':
            res = _credit_spread(S, T, sigma, 'CALL', TARGET_DELTA_CREDIT, 0.25, width)
            if res:
                legs, net, mp, ml = res
                trades.append(SimTrade(
                    strategy='Bear Call Spread', bias='Bearish', is_credit=True,
                    legs=legs, entry_net=net, max_profit=mp, max_loss=ml, **common))

        # Iron Condor (neutral bias + sell-premium regime + iv_rank ≥ 50)
        # Engine: NEUTRAL and SELL_REGIME; credit filter ≥ 25% of width
        if bias == 'Neutral' and vol_reg == 'Sell Premium' and iv_rank >= 50 and dte >= 21:
            put_short  = find_strike_by_delta(S, TARGET_DELTA_CONDOR, T, sigma, 'PUT')
            put_long   = put_short - width
            call_short = find_strike_by_delta(S, TARGET_DELTA_CONDOR, T, sigma, 'CALL')
            call_long  = call_short + width

            ps_p = bs_price(S, put_short,  T, r, sigma, 'PUT')
            pl_p = bs_price(S, put_long,   T, r, sigma, 'PUT')
            cs_p = bs_price(S, call_short, T, r, sigma, 'CALL')
            cl_p = bs_price(S, call_long,  T, r, sigma, 'CALL')

            net = (ps_p - pl_p) + (cs_p - cl_p)
            if net >= 0.05:
                ml = width - net
                if ml > 0 and net / width >= 0.25:   # matches engine MIN_CREDIT_PCT_OF_WIDTH = 25%
                    legs = [
                        SimLeg('SELL', 'PUT',  put_short,  ps_p, bs_delta(S, put_short,  T, r, sigma, 'PUT')),
                        SimLeg('BUY',  'PUT',  put_long,   pl_p, bs_delta(S, put_long,   T, r, sigma, 'PUT')),
                        SimLeg('SELL', 'CALL', call_short, cs_p, bs_delta(S, call_short, T, r, sigma, 'CALL')),
                        SimLeg('BUY',  'CALL', call_long,  cl_p, bs_delta(S, call_long,  T, r, sigma, 'CALL')),
                    ]
                    trades.append(SimTrade(
                        strategy='Iron Condor', bias='Neutral', is_credit=True,
                        legs=legs, entry_net=net, max_profit=net, max_loss=ml, **common))

    # ── DEBIT SPREADS ──────────────────────────────────────────
    if BUILD_LONG:

        # Bull Call Spread
        if bias == 'Bullish' and conf >= 55:
            res = _debit_spread(S, T, sigma, 'CALL', TARGET_DELTA_DEBIT, width)
            if res:
                legs, net, mp, ml = res
                trades.append(SimTrade(
                    strategy='Bull Call Spread', bias='Bullish', is_credit=False,
                    legs=legs, entry_net=net, max_profit=mp, max_loss=ml, **common))

        # Bear Put Spread
        if bias == 'Bearish' and conf >= 55:
            res = _debit_spread(S, T, sigma, 'PUT', TARGET_DELTA_DEBIT, width)
            if res:
                legs, net, mp, ml = res
                trades.append(SimTrade(
                    strategy='Bear Put Spread', bias='Bearish', is_credit=False,
                    legs=legs, entry_net=net, max_profit=mp, max_loss=ml, **common))

        # Long Straddle (neutral bias + buy-premium vol regime)
        # Must match engine: NEUTRAL and BUY_REGIME — not for directional days
        if bias == 'Neutral' and vol_reg == 'Buy Premium' and dte >= 21:
            atm_k    = round_to_strike(S, S)
            call_p   = bs_price(S, atm_k, T, r, sigma, 'CALL')
            put_p    = bs_price(S, atm_k, T, r, sigma, 'PUT')
            net_deb  = call_p + put_p
            if net_deb >= 0.10:
                legs = [
                    SimLeg('BUY', 'CALL', atm_k, call_p, bs_delta(S, atm_k, T, r, sigma, 'CALL')),
                    SimLeg('BUY', 'PUT',  atm_k, put_p,  bs_delta(S, atm_k, T, r, sigma, 'PUT')),
                ]
                # max profit is theoretical (unlimited); use 3× debit as proxy for EV calc
                trades.append(SimTrade(
                    strategy='Long Straddle', bias='Neutral', is_credit=False,
                    legs=legs, entry_net=-net_deb,
                    max_profit=net_deb * 3, max_loss=net_deb, **common))

        # Long Call (strong bullish)
        if bias == 'Bullish' and conf >= 65 and vol_reg != 'Sell Premium':
            k     = find_strike_by_delta(S, TARGET_DELTA_DEBIT, T, sigma, 'CALL')
            price = bs_price(S, k, T, r, sigma, 'CALL')
            if price >= 0.10:
                legs = [SimLeg('BUY', 'CALL', k, price, bs_delta(S, k, T, r, sigma, 'CALL'))]
                trades.append(SimTrade(
                    strategy='Long Call', bias='Bullish', is_credit=False,
                    legs=legs, entry_net=-price,
                    max_profit=price * 3, max_loss=price, **common))

        # Long Put (strong bearish)
        if bias == 'Bearish' and conf >= 65 and vol_reg != 'Sell Premium':
            k     = find_strike_by_delta(S, TARGET_DELTA_DEBIT, T, sigma, 'PUT')
            price = bs_price(S, k, T, r, sigma, 'PUT')
            if price >= 0.10:
                legs = [SimLeg('BUY', 'PUT', k, price, bs_delta(S, k, T, r, sigma, 'PUT'))]
                trades.append(SimTrade(
                    strategy='Long Put', bias='Bearish', is_credit=False,
                    legs=legs, entry_net=-price,
                    max_profit=price * 3, max_loss=price, **common))

    # ── NAKED / COVERED ────────────────────────────────────────
    if BUILD_NAKED and dte >= 14:

        # Short Put (bullish + sell-premium regime)
        # Must match engine: not BEARISH and SELL_REGIME
        if bias == 'Bullish' and vol_reg == 'Sell Premium':
            k     = find_strike_by_delta(S, TARGET_DELTA_CREDIT, T, sigma, 'PUT')
            price = bs_price(S, k, T, r, sigma, 'PUT')
            if price >= 0.10:
                legs = [SimLeg('SELL', 'PUT', k, price, bs_delta(S, k, T, r, sigma, 'PUT'))]
                trades.append(SimTrade(
                    strategy='Short Put', bias='Bullish', is_credit=True,
                    legs=legs, entry_net=price, max_profit=price,
                    max_loss=k - price, **common))

        # Covered Call (neutral/bullish + sell-premium regime)
        # Must match engine: not BEARISH and SELL_REGIME
        if bias in ('Bullish', 'Neutral') and vol_reg == 'Sell Premium':
            k     = find_strike_by_delta(S, TARGET_DELTA_CREDIT, T, sigma, 'CALL')
            price = bs_price(S, k, T, r, sigma, 'CALL')
            if price >= 0.10:
                legs = [SimLeg('SELL', 'CALL', k, price, bs_delta(S, k, T, r, sigma, 'CALL'))]
                trades.append(SimTrade(
                    strategy='Covered Call', bias='Neutral', is_credit=True,
                    legs=legs, entry_net=price,
                    max_profit=price + max(k - S, 0), max_loss=S, **common))

    return trades


# ─────────────────────────────────────────────────────────────
# P&L CALCULATION
# ─────────────────────────────────────────────────────────────

def position_pnl(trade: SimTrade, S_exit: float, T_exit: float) -> float:
    """
    Realized P&L per share at a given exit price and time.
    For each leg: SELL legs profit when price falls; BUY legs profit when price rises.
    """
    r     = RISK_FREE_RATE
    sigma = trade.iv_proxy / 100.0
    pnl   = 0.0
    for leg in trade.legs:
        exit_price = bs_price(S_exit, leg.strike, T_exit, r, sigma, leg.option_type)
        if leg.action == 'SELL':
            pnl += leg.entry_price - exit_price   # profit when option cheapens
        else:
            pnl += exit_price - leg.entry_price   # profit when option appreciates
    return pnl


# ─────────────────────────────────────────────────────────────
# TRADE EXIT SIMULATION
# ─────────────────────────────────────────────────────────────

def simulate_exit(trade: SimTrade, hist: pd.DataFrame) -> SimTrade:
    """
    Walk forward day-by-day from entry to expiry applying exit rules.
    Mutates and returns the SimTrade with exit fields populated.
    """
    expiry_dt = pd.Timestamp(trade.expiry_date)
    entry_dt  = pd.Timestamp(trade.entry_date)

    future = hist.index[(hist.index > entry_dt) & (hist.index <= expiry_dt)]

    if len(future) == 0:
        trade.exit_date   = trade.entry_date
        trade.exit_reason = 'NO_DATA'
        trade.outcome     = 'BREAKEVEN'
        return trade

    if trade.is_credit:
        profit_target = trade.max_profit * CREDIT_PROFIT_TARGET
        stop_loss     = -(trade.max_profit * CREDIT_STOP_MULT)
        time_exit_dte = CREDIT_TIME_EXIT_DTE
    else:
        profit_target = trade.max_loss * DEBIT_PROFIT_TARGET
        stop_loss     = -(trade.max_loss * DEBIT_STOP_PCT)
        time_exit_dte = DEBIT_TIME_EXIT_DTE

    for dt in future:
        S_exit      = float(hist.loc[dt, 'Close'])
        dte_remain  = (expiry_dt - dt).days
        T_exit      = max(dte_remain / 365.0, 0.0)
        is_last_day = (dt == future[-1])

        pnl         = position_pnl(trade, S_exit, T_exit)
        exit_reason = None

        if pnl >= profit_target:
            exit_reason = 'PROFIT_TARGET'
        elif pnl <= stop_loss:
            exit_reason = 'STOP_LOSS'
        elif dte_remain <= time_exit_dte:
            exit_reason = f'{time_exit_dte}DTE'
        elif is_last_day:
            exit_reason = 'EXPIRY'
            pnl = position_pnl(trade, S_exit, 0.0)

        if exit_reason:
            trade.exit_date       = dt.strftime('%Y-%m-%d')
            trade.exit_reason     = exit_reason
            trade.underlying_exit = round(S_exit, 2)
            trade.pnl_per_share   = round(pnl, 4)
            trade.pnl_dollar      = round(pnl * 100 * CONTRACTS, 2)
            ref = trade.max_profit if trade.max_profit > 0 else 1.0
            trade.pnl_pct_of_max  = round(pnl / ref * 100, 1)
            if pnl > 0.005:
                trade.outcome = 'WIN'
            elif pnl < -0.005:
                trade.outcome = 'LOSS'
            else:
                trade.outcome = 'BREAKEVEN'
            return trade

    # Fallback (shouldn't normally be reached)
    S_exit            = float(hist.loc[future[-1], 'Close'])
    pnl               = position_pnl(trade, S_exit, 0.0)
    trade.exit_date   = future[-1].strftime('%Y-%m-%d')
    trade.exit_reason = 'EXPIRY'
    trade.underlying_exit = round(S_exit, 2)
    trade.pnl_per_share   = round(pnl, 4)
    trade.pnl_dollar      = round(pnl * 100 * CONTRACTS, 2)
    trade.outcome = 'WIN' if pnl > 0.005 else ('LOSS' if pnl < -0.005 else 'BREAKEVEN')
    return trade


# ─────────────────────────────────────────────────────────────
# MAIN ENTRY POINT
# ─────────────────────────────────────────────────────────────

def run_backtest(
    ticker: str,
    start_date: str,
    end_date: str,
    strategy_mode: str = 'all',
    weeks_out: int = 4,
    spread_width: Optional[float] = None,
) -> dict:
    """
    Run a walk-forward backtest for one ticker over a date range.

    Returns a dict with:
      ticker, start_date, end_date, strategy_mode, weeks_out,
      total_trades, winning_trades, losing_trades, win_rate,
      total_pnl, avg_pnl_per_trade, avg_pnl_winners, avg_pnl_losers,
      profit_factor, max_drawdown, sharpe_ratio,
      by_strategy, equity_curve, trades
    """
    # Download price history with 400-day lookback for signal computation
    lookback = (pd.Timestamp(start_date) - pd.Timedelta(days=420)).strftime('%Y-%m-%d')
    try:
        hist_raw = bar_cache.get_history(ticker, start=lookback, end=end_date, auto_adjust=True)
        if hist_raw is None or hist_raw.empty:
            raise ValueError("empty result")
    except Exception as e:
        return {'error': f'Failed to download data for {ticker}: {e}'}

    if hist_raw.empty or len(hist_raw) < MIN_HIST_DAYS:
        return {'error': f'Insufficient price history for {ticker}. Need {MIN_HIST_DAYS}+ trading days.'}

    # Normalize index to tz-naive dates for reliable slicing
    hist = hist_raw.copy()
    hist.index = pd.to_datetime(hist.index).tz_localize(None)

    test_start = pd.Timestamp(start_date)
    test_end   = pd.Timestamp(end_date)
    test_days  = hist.index[(hist.index >= test_start) & (hist.index <= test_end)]

    if len(test_days) == 0:
        return {'error': f'No trading data in range {start_date} – {end_date}'}

    target_dte  = weeks_out * 7
    all_trades: list[SimTrade] = []

    # Walk forward
    for i in range(0, len(test_days), SCAN_EVERY_N_DAYS):
        analysis_date = test_days[i]

        hist_window = hist[hist.index <= analysis_date]
        if len(hist_window) < MIN_HIST_DAYS:
            continue

        signals = compute_signals(hist_window)
        if not signals:
            continue

        # Find the nearest trading day to analysis_date + target_dte
        future_days = hist.index[hist.index > analysis_date]
        if len(future_days) == 0:
            continue
        target_expiry = analysis_date + pd.Timedelta(days=target_dte)
        diffs = np.abs((future_days - target_expiry).days.values
                       if hasattr((future_days - target_expiry), 'days')
                       else np.array([(d - target_expiry).days for d in future_days]))
        expiry_date = future_days[int(np.argmin(np.abs(diffs)))]

        candidates = build_trades(signals, analysis_date, expiry_date,
                                  strategy_mode, spread_width)

        for trade in candidates:
            completed = simulate_exit(trade, hist)
            if completed.exit_reason not in ('NO_DATA', ''):
                all_trades.append(completed)

    return _summarize(ticker, start_date, end_date, strategy_mode, weeks_out, all_trades)


# ─────────────────────────────────────────────────────────────
# SUMMARY STATISTICS
# ─────────────────────────────────────────────────────────────

def _summarize(ticker, start_date, end_date, strategy_mode, weeks_out,
               trades: list) -> dict:

    if not trades:
        return {
            'ticker': ticker, 'start_date': start_date, 'end_date': end_date,
            'strategy_mode': strategy_mode, 'weeks_out': weeks_out,
            'total_trades': 0, 'winning_trades': 0, 'losing_trades': 0,
            'win_rate': 0.0, 'total_pnl': 0.0, 'avg_pnl_per_trade': 0.0,
            'avg_pnl_winners': 0.0, 'avg_pnl_losers': 0.0,
            'profit_factor': 0.0, 'max_drawdown': 0.0, 'sharpe_ratio': 0.0,
            'by_strategy': {}, 'equity_curve': [], 'trades': [],
        }

    # Sort by exit date for equity curve
    sorted_trades = sorted(trades, key=lambda t: t.exit_date)

    total    = len(sorted_trades)
    wins     = [t for t in sorted_trades if t.outcome == 'WIN']
    losses   = [t for t in sorted_trades if t.outcome == 'LOSS']
    pnls     = [t.pnl_dollar for t in sorted_trades]
    win_pnls = [t.pnl_dollar for t in wins]
    los_pnls = [t.pnl_dollar for t in losses]

    total_pnl   = sum(pnls)
    avg_pnl     = total_pnl / total if total else 0.0
    avg_win     = sum(win_pnls) / len(win_pnls) if win_pnls else 0.0
    avg_los     = sum(los_pnls) / len(los_pnls) if los_pnls else 0.0
    gross_win   = sum(win_pnls)
    gross_los   = abs(sum(los_pnls))
    pf          = gross_win / gross_los if gross_los > 0 else 99.0

    # Sharpe (annualized)
    if len(pnls) > 1 and float(np.std(pnls)) > 0:
        trades_per_year = 52.0 / max(weeks_out, 1)
        sharpe = (avg_pnl / float(np.std(pnls))) * sqrt(trades_per_year)
    else:
        sharpe = 0.0

    # Equity curve + max drawdown
    equity_curve = []
    cum_pnl, peak, max_dd = 0.0, 0.0, 0.0
    for t in sorted_trades:
        cum_pnl += t.pnl_dollar
        peak     = max(peak, cum_pnl)
        max_dd   = max(max_dd, peak - cum_pnl)
        equity_curve.append({
            'date':           t.exit_date,
            'cumulative_pnl': round(cum_pnl, 2),
            'trade_pnl':      round(t.pnl_dollar, 2),
            'strategy':       t.strategy,
        })

    # Per-strategy breakdown
    by_strategy: dict[str, dict] = {}
    for t in sorted_trades:
        s = by_strategy.setdefault(t.strategy, {
            'count': 0, 'wins': 0, 'losses': 0,
            'total_pnl': 0.0, 'win_rate': 0.0, 'avg_pnl': 0.0,
        })
        s['count']     += 1
        s['total_pnl'] += t.pnl_dollar
        if t.outcome == 'WIN':   s['wins']   += 1
        elif t.outcome == 'LOSS': s['losses'] += 1

    for s in by_strategy.values():
        s['win_rate']  = round(s['wins'] / s['count'] * 100, 1) if s['count'] else 0.0
        s['avg_pnl']   = round(s['total_pnl'] / s['count'], 2) if s['count'] else 0.0
        s['total_pnl'] = round(s['total_pnl'], 2)

    # Serialize trades
    def _leg(l: SimLeg) -> dict:
        return {
            'action': l.action, 'option_type': l.option_type,
            'strike': l.strike, 'entry_price': round(l.entry_price, 4),
            'delta': round(l.delta, 3),
        }

    def _trade(t: SimTrade) -> dict:
        return {
            'strategy':         t.strategy,
            'bias':             t.bias,
            'is_credit':        t.is_credit,
            'entry_date':       t.entry_date,
            'exit_date':        t.exit_date,
            'exit_reason':      t.exit_reason,
            'expiry_date':      t.expiry_date,
            'dte_at_entry':     t.dte_at_entry,
            'underlying_entry': round(t.underlying_entry, 2),
            'underlying_exit':  round(t.underlying_exit, 2),
            'entry_net':        round(t.entry_net, 4),
            'max_profit':       round(t.max_profit, 4),
            'max_loss':         round(t.max_loss, 4),
            'pnl_per_share':    round(t.pnl_per_share, 4),
            'pnl_dollar':       round(t.pnl_dollar, 2),
            'pnl_pct_of_max':   t.pnl_pct_of_max,
            'outcome':          t.outcome,
            'directional_bias': t.directional_bias,
            'bias_confidence':  t.bias_confidence,
            'iv_rank':          round(t.iv_rank, 1),
            'volatility_regime': t.volatility_regime,
            'iv_environment':   t.iv_environment,
            'legs':             [_leg(l) for l in t.legs],
        }

    return {
        'ticker':           ticker,
        'start_date':       start_date,
        'end_date':         end_date,
        'strategy_mode':    strategy_mode,
        'weeks_out':        weeks_out,
        'total_trades':     total,
        'winning_trades':   len(wins),
        'losing_trades':    len(losses),
        'win_rate':         round(len(wins) / total * 100, 1) if total else 0.0,
        'total_pnl':        round(total_pnl, 2),
        'avg_pnl_per_trade': round(avg_pnl, 2),
        'avg_pnl_winners':  round(avg_win, 2),
        'avg_pnl_losers':   round(avg_los, 2),
        'profit_factor':    round(min(pf, 99.0), 2),
        'max_drawdown':     round(max_dd, 2),
        'sharpe_ratio':     round(sharpe, 2),
        'by_strategy':      by_strategy,
        'equity_curve':     equity_curve,
        'trades':           [_trade(t) for t in sorted_trades],
    }
