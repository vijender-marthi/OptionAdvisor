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
    day_trade_watchlist: Optional[list[str]] = None
    """When omitted, existing SQLite value is preserved (see save_user_state)."""
    swing_trade_watchlist: Optional[list[str]] = None
    """When omitted, existing SQLite value is preserved (see save_user_state)."""
    alert_email_enabled: Optional[bool] = None


class UserDataResponse(BaseModel):
    email: str
    """Effective role: admin | super_user | day | swing | user | finance (stored in SQLite; finance env list optional)."""
    role: str = "user"
    watchlist: list[dict[str, Any]]
    portfolio: list[dict[str, Any]]
    advisory_terms_version: Optional[str] = None
    advisory_accepted_at: Optional[str] = None
    """Symbols scanned every 15m for day-trade WATCH→GO escalations (admin-only feature)."""
    day_trade_watchlist: list[str] = Field(default_factory=list)
    """Saved swing-trade symbols (admin-only UI; max 20; no backend alert scan)."""
    swing_trade_watchlist: list[str] = Field(default_factory=list)
    """Max watchlist length for this account (OPTION_ADVISOR_WATCHLIST_MAX_USER / _ADMIN)."""
    watchlist_max: int = 15
    """GO / day-trade alert emails (backend scanner and /api/send-alert)."""
    alert_email_enabled: bool = True


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
    open: float
    high: float
    low: float
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
    market_bias: str = "NEUTRAL"
    setup_quality: str = "WEAK"
    verdict: str = "WAIT"
    confidence: int = 0
    reason: str = ""
    supporting_factors: list[str] = Field(default_factory=list)
    missing_confirmations: list[str] = Field(default_factory=list)
    risk_state: str = "MEDIUM"
    explanation: dict = Field(default_factory=dict)
    risk_reason: str = ""
    display_confidence: int = 0
    execution_fields: list[dict] = Field(default_factory=list)


class BacktestRequest(BaseModel):
    ticker: str
    start_date: str
    end_date: str
    strategy_mode: str = 'all'
    weeks_out: int = 4
    spread_width: Optional[float] = None


class DayTradeRequest(BaseModel):
    ticker: str
    force_refresh: bool = False


class DayTradeResponse(BaseModel):
    ticker: str
    company_name: str = ""
    verdict: str  # STRONG GO | GO | WATCH | NO-GO | WAIT
    bias: Optional[str] = None  # long | short
    bull_score: float
    bear_score: float
    reasons: list[str]
    metrics: dict
    trader_decision: dict = Field(default_factory=dict)
    market_bias: str = "NEUTRAL"
    setup_quality: str = "WEAK"
    confidence: int = 0
    reason: str = ""
    supporting_factors: list[str] = Field(default_factory=list)
    missing_confirmations: list[str] = Field(default_factory=list)
    risk_state: str = "MEDIUM"
    explanation: dict = Field(default_factory=dict)
    risk_reason: str = ""
    display_confidence: int = 0
    execution_fields: list[dict] = Field(default_factory=list)
    entry_guidance: dict = Field(default_factory=dict)
    option_risk_context: dict = Field(default_factory=dict)
    # Structured AI coaching summary (Anthropic / OpenAI / deterministic fallback)
    ai_coach: dict = Field(default_factory=dict)


class SwingTradeRequest(BaseModel):
    ticker: str


class SwingTradeResponse(BaseModel):
    ticker: str
    company_name: str = ""
    verdict: str       # STRONG GO | GO | WATCH | NO-GO | WAIT  (v1 scoring engine)
    bias: Optional[str] = None   # long | short
    bull_score: float
    bear_score: float
    reasons: list[str]
    metrics: dict
    # ── Decision Quality Layer (Phase 1) ──────────────────────────────
    swing_bias:              str           = "NEUTRAL"
    entry_quality:           str           = "NO_CLEAN_ENTRY"
    risk_level:              str           = "MEDIUM"
    final_action:            str           = "NO_TRADE"
    trade_quality_score:     float         = 0.0
    decision_label:          str           = "NO_TRADE_WAIT"
    decision_message:        str           = ""
    risk_flags:              list[str]     = Field(default_factory=list)
    confirmation_needed:     list[str]     = Field(default_factory=list)
    suggested_expiry_window: str           = "No trade"
    suggested_strategy:      str           = "NO_TRADE"
    avoid_reason:            Optional[str] = None
    playbook_hint:           str           = ""
    market_bias:             str           = "NEUTRAL"
    setup_quality:           str           = "WEAK"
    confidence:              int           = 0
    reason:                  str           = ""
    supporting_factors:      list[str]     = Field(default_factory=list)
    missing_confirmations:   list[str]     = Field(default_factory=list)
    risk_state:              str           = "MEDIUM"
    expected_holding_period: str           = ""
    recommended_contract_duration: str     = ""
    explanation: dict = Field(default_factory=dict)
    risk_reason: str = ""
    display_confidence: int = 0
    execution_fields: list[dict] = Field(default_factory=list)
    entry_guidance: dict = Field(default_factory=dict)


class ActiveTradeEnterRequest(BaseModel):
    ticker: str
    side: str  # CALL | PUT
    entry_price: float
    entry_underlying_px: Optional[float] = None
    contracts: Optional[float] = None
    strike: Optional[float] = None
    expiry: Optional[str] = None  # YYYY-MM-DD; optional bookkeeping / future Greeks
    notes: Optional[str] = None
    trade_type: str = "day"  # "day" | "swing"


class ActiveTradeEnterResponse(BaseModel):
    id: str
    ticker: str
    side: str
    entry_price: float
    entry_underlying_px: Optional[float] = None
    contracts: Optional[float] = None
    strike: Optional[float] = None
    expiry: Optional[str] = None
    notes: str = ""
    opened_at_ms: int


class ActiveTradeOut(BaseModel):
    id: str
    ticker: str
    side: str
    entry_price: float
    entry_underlying_px: Optional[float] = None
    contracts: Optional[float] = None
    strike: Optional[float] = None
    expiry: Optional[str] = None
    notes: str = ""
    opened_at_ms: int
    exited_at_ms: Optional[int] = None
    trade_type: str = "day"
    decision: dict = Field(default_factory=dict)
    metrics: dict = Field(default_factory=dict)
    intraday_error: Optional[str] = None


class ActiveTradeListResponse(BaseModel):
    trades: list[ActiveTradeOut]
    included_opened_before_today: bool = Field(
        default=False,
        description="False when the list excludes non-exited trades opened before the current US (America/New_York) session calendar date.",
    )


# ─── TradeDesk models ─────────────────────────────────────────────────────────

class WatchlistItem(BaseModel):
    id: Optional[int] = None
    ticker: str
    trade_type: str = "day"
    sort_order: int = 0
    added_at: Optional[str] = None


class WatchlistAddRequest(BaseModel):
    ticker: str
    trade_type: str = "day"


class TradeLogCreate(BaseModel):
    ticker: str
    trade_type: str = "day"
    signal_given: str = ""
    confidence_score: float = 0
    planned_entry: Optional[float] = None
    planned_t1: Optional[float] = None
    planned_t2: Optional[float] = None
    planned_stop: Optional[float] = None
    structure: str = ""
    actual_entry: Optional[float] = None
    contracts: int = 1
    entry_time: Optional[str] = None
    notes: str = ""


class TradeLogUpdate(BaseModel):
    actual_entry: Optional[float] = None
    contracts: Optional[int] = None
    entry_time: Optional[str] = None
    exit_price: Optional[float] = None
    exit_time: Optional[str] = None
    exit_reason: Optional[str] = None
    followed_plan: Optional[str] = None
    outcome: Optional[str] = None
    pnl_estimate: Optional[float] = None
    notes: Optional[str] = None
    planned_entry: Optional[float] = None
    planned_t1: Optional[float] = None
    planned_t2: Optional[float] = None
    planned_stop: Optional[float] = None
    structure: Optional[str] = None


class TradeLogResponse(BaseModel):
    id: str
    user_id: str
    ticker: str
    trade_type: str
    signal_given: str
    confidence_score: float
    planned_entry: Optional[float]
    planned_t1: Optional[float]
    planned_t2: Optional[float]
    planned_stop: Optional[float]
    structure: str
    actual_entry: Optional[float]
    contracts: int
    entry_time: Optional[str]
    exit_price: Optional[float]
    exit_time: Optional[str]
    exit_reason: str
    followed_plan: str
    outcome: str
    pnl_estimate: Optional[float]
    notes: str
    logged_at: str
    updated_at: str


class AlertCreate(BaseModel):
    ticker: str
    trade_type: str = "day"
    alert_type: str  # RVOL, PRICE_CROSS, VWAP_RETEST, SIGNAL_ENTER
    threshold_value: Optional[float] = None
    target_signal: str = ""
    notify_method: str = "inapp"
    expires: str = "eod"


class AlertResponse(BaseModel):
    id: str
    user_id: str
    ticker: str
    trade_type: str
    alert_type: str
    threshold_value: Optional[float]
    target_signal: str
    notify_method: str
    expires: str
    is_active: int
    fired_at: Optional[str]
    fired_value: Optional[float]
    action_taken: str
    created_at: str


class TradeStatsResponse(BaseModel):
    total: int
    wins: int
    losses: int
    open_count: int
    win_rate: float
    avg_rr: float
    followed_plan_pct: float
