"""
models.py — Pydantic request/response models for FastAPI
"""
from pydantic import BaseModel, Field
from typing import Any, Optional


class AnalyzeRequest(BaseModel):
    ticker: str
    weeks_out: int = 4
    spread_width: Optional[int] = None   # 5, 10, or None (auto)
    strategy_mode: str = 'all'           # 'all' | 'long_only' | 'credit_only' | 'short_or_covered' | 'straddle_only'
    # When set (YYYY-MM-DD), load that listed expiry's chain instead of pick_expiry_by_dte(weeks_out).
    # Used by Portfolio so MTM matches the position's expiry without visiting the ticker page first.
    chain_expiry: Optional[str] = None


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
    user_name: Optional[str] = None
    alerts: list[AlertItem]


class TestEmailRequest(BaseModel):
    email: str
    user_name: Optional[str] = None


class AlertDismissRequest(BaseModel):
    email: str
    alert_id: str


class AlertClearRequest(BaseModel):
    email: str


class UserDataRequest(BaseModel):
    watchlist: list[dict[str, Any]]
    portfolio: list[dict[str, Any]]
    advisory_terms_version: Optional[str] = None
    advisory_accepted_at: Optional[str] = None


class UserDataResponse(BaseModel):
    email: str
    """Effective role: admin | user | finance (stored in SQLite; finance env list optional)."""
    role: str = "user"
    watchlist: list[dict[str, Any]]
    portfolio: list[dict[str, Any]]
    advisory_terms_version: Optional[str] = None
    advisory_accepted_at: Optional[str] = None
    """Max watchlist length for this account (OPTION_ADVISOR_WATCHLIST_MAX_USER / _ADMIN)."""
    watchlist_max: int = 15


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
    data_quality: str = "OK"          # "OK" | "MODEL" | "STALE" | "UNRELIABLE"
    data_quality_reason: str = ""


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

    # Kelly Criterion position sizing
    kelly_fraction:      float = 0.0   # raw Kelly % as fraction of capital
    half_kelly_fraction: float = 0.0   # Half-Kelly (recommended), capped at 20%
    edge_ratio:          float = 0.0   # EV / max_loss — diagnostic edge quality


class OptionRowOut(BaseModel):
    strike: float
    last_price: float
    bid: float
    ask: float
    volume: int
    open_interest: int
    implied_volatility: str
    delta: Optional[float] = None
    data_quality: str = "OK"          # "OK" | "MODEL" | "STALE" | "UNRELIABLE"
    data_quality_reason: str = ""


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

    # Extended-hours price (pre-market or after-hours); 0.0 when not available
    ext_market_price: float = 0.0       # the extended-hours quote
    ext_market_change: float = 0.0      # vs regular-session close
    ext_market_change_pct: float = 0.0  # % vs regular-session close
    ext_market_type: str = ""           # "pre" | "post" | ""


class QuoteQualitySummary(BaseModel):
    """Aggregated Yahoo/options quote health for the analyzed chain window."""

    chain_rows_total: int = 0
    ok_rows: int = 0
    stale_rows: int = 0
    unreliable_rows: int = 0
    model_rows: int = 0
    pct_non_ok: float = 0.0
    underlying_quote_source: str = "live"  # live | previous_close
    banner_show: bool = False
    banner_lines: list[str] = []


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
    quote_quality_summary: QuoteQualitySummary = Field(default_factory=QuoteQualitySummary)


class BacktestRequest(BaseModel):
    ticker: str
    start_date: str
    end_date: str
    strategy_mode: str = 'all'
    weeks_out: int = 4
    spread_width: Optional[float] = None
