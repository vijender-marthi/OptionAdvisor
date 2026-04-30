"""
models.py — Pydantic request/response models for FastAPI
"""
from pydantic import BaseModel
from typing import Any, Optional


class AnalyzeRequest(BaseModel):
    ticker: str
    weeks_out: int = 4
    spread_width: Optional[int] = None   # 5, 10, or None (auto)
    strategy_mode: str = 'all'           # 'all' | 'long_only' | 'credit_only'


class AlertItem(BaseModel):
    """A single GO-trade alert to include in the email."""
    ticker: str
    company_name: str
    strategy: str
    bias: str
    expiry: str
    dte: int
    weeks_out: int
    score: int
    max_profit: float
    max_loss: float
    net_credit: float
    pop: float          # probability of profit 0-1
    ev: float           # expected value per share
    time_window: str    # "9:30 AM – 9:45 AM PST"


class AlertEmailRequest(BaseModel):
    email: str
    alerts: list[AlertItem]


class UserDataRequest(BaseModel):
    watchlist: list[dict[str, Any]]
    portfolio: list[dict[str, Any]]


class UserDataResponse(BaseModel):
    email: str
    watchlist: list[dict[str, Any]]
    portfolio: list[dict[str, Any]]


class OptionLegOut(BaseModel):
    action: str
    option_type: str
    strike: float
    expiry: str
    delta: float
    mid_price: float
    bid: float
    ask: float
    iv: float
    oi: int
    volume: int
    bid_ask_spread_pct: float


class ScoreBreakdown(BaseModel):
    signal_score: int
    structure_score: int
    liquidity_score: int
    iv_fit_score: int
    total_score: int


class RecommendationOut(BaseModel):
    rank: int
    strategy: str
    bias: str
    legs: list[OptionLegOut]
    expiry: str
    dte: int

    net_credit: float
    spread_width: float
    max_profit: float
    max_loss: float
    risk_reward_ratio: float
    credit_pct_of_width: float

    breakeven_lower: float
    breakeven_upper: float
    short_leg_delta: float
    prob_of_profit: float
    prob_of_max_loss: float
    expected_value: float

    passes_rr_filter: bool
    passes_liquidity_filter: bool
    passes_credit_filter: bool

    scores: ScoreBreakdown
    rationale: str
    exit_plan: str
    warnings: list[str]


class OptionRowOut(BaseModel):
    strike: float
    last_price: float
    bid: float
    ask: float
    volume: int
    open_interest: int
    implied_volatility: str
    delta: Optional[float] = None


class PricePoint(BaseModel):
    date: str
    close: float
    ma20: float
    ma50: float
    ma200: float


class SignalsOut(BaseModel):
    current_price: float
    prev_close: float
    price_change: float
    price_change_pct: float

    trend: str
    trend_strength: str
    ma20: float
    ma50: float
    ma200: float
    above_ma20: bool
    above_ma50: bool
    above_ma200: bool
    ma50_slope: float
    ma200_slope: float

    rsi: float
    rsi_signal: str
    macd: float
    macd_signal_line: float
    macd_histogram: float
    macd_crossover: str

    current_iv: float
    hv_20: float
    hv_60: float
    iv_rank: float
    iv_percentile: float
    iv_vs_hv: float
    iv_environment: str

    put_call_ratio: float
    pcr_signal: str
    iv_skew: float
    skew_signal: str

    directional_bias: str
    bias_confidence: int
    volatility_regime: str


class AnalyzeResponse(BaseModel):
    ticker: str
    company_name: str
    sector: str
    market_cap: str
    signals: SignalsOut
    recommendations: list[RecommendationOut]
    calls_chain: list[OptionRowOut]
    puts_chain: list[OptionRowOut]
    price_history: list[PricePoint]
    filters_applied: dict
