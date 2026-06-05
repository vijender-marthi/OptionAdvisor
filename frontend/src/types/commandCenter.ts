/** Unified API envelope for Trade Command Center surfaces. */
export interface ApiEnvelope<T> {
  data: T
  error: { code: string; message: string } | null
  stale: boolean
  fetched_at: string
}

export interface UnifiedAlert {
  id: string
  ticker: string
  alert_type: string
  engine_type: 'DAY' | 'SWING' | 'REGULAR' | 'PORTFOLIO' | 'MARKET'
  severity: 'INFO' | 'WARNING' | 'CRITICAL'
  signal: 'GO' | 'WATCH' | 'WAIT' | 'SKIP' | 'AVOID' | 'EXIT' | 'SCALE_OUT'
  message: string
  reason: string
  recommended_action: string
  related_trade_id?: string | null
  related_watchlist_id?: string | null
  status: 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED'
  created_at: string
  updated_at?: string | null
}

export interface AlertCenterSummary {
  total: number
  active: number
  critical: number
  warning: number
  info: number
  profit_protection?: number
  trade_entry?: number
}

export interface AlertCenterSections {
  day_trade: UnifiedAlert[]
  swing_trade: UnifiedAlert[]
  regular_trade: UnifiedAlert[]
  portfolio: UnifiedAlert[]
  market: UnifiedAlert[]
}

export interface AlertCenterSummaryResponse {
  active_count: number
  items: UnifiedAlert[]
  by_engine: {
    day: number
    swing: number
    regular: number
    portfolio: number
    general: number
  }
  by_severity: {
    critical: number
    warning: number
    info: number
  }
  rules_count: number
}

export interface AlertCenterPayload {
  summary: AlertCenterSummary
  sections: AlertCenterSections
  alerts: UnifiedAlert[]
}

export interface TradeCommandCenterEngine {
  engine_type: string
  timeframe: string
  best_use_case: string
  signal: string
  signal_count: number
  top_recommendation?: {
    ticker?: string
    reason?: string
    risk_warning?: string
  }
  risk_level: string
  summary: string
  market_bias: string
  setup_quality: string
  execution_readiness?: string
  final_decision: string
  confidence: number
  reason: string
  supporting_factors: string[]
  missing_confirmations: string[]
  risk_state: string
  signal_quality?: string
  execution_timing?: string
  risk_category?: string
  explanation: Record<string, string>
  risk_reason: string
  display_confidence: number
  execution_fields: Array<{ label: string; value: string }>
  /** Cross-engine score normalisation fields */
  raw_engine_score?: number
  normalized_score?: number
  normalized_state?: string
  confidence_band?: string
  execution_bias?: string
  risk_band?: string
  normalized_reason?: string
  option_risk_context?: {
    theta_risk: string
    gamma_risk: string
    iv_risk: string
    liquidity_risk: string
    suggested_contract_window: string
    option_execution_warning: string
  }
  engine_score_breakdown?: Record<string, unknown>
}

export interface TccSubIndicator {
  label: string
  value: string
  tone: 'bullish' | 'bearish' | 'warning' | 'neutral'
}

export interface TccSections {
  top_by_engine: { day: TccRec | null; swing: TccRec | null; regular: TccRec | null }
  ready_now: TccRec[]
  high_conf_watch: TccRec[]
  low_signals: TccRec[]
  conf_threshold: number
}

/** Enriched recommendation as returned inside tcc_sections (all presentation fields pre-computed). */
export type TccRec = TradeCommandCenterRecommendation & {
  verdict: 'STRONG_GO' | 'GO' | 'WATCH' | 'WAIT' | 'AVOID' | 'NO_EDGE'
  verdict_label: string
  verdict_tone: 'bullish' | 'bearish' | 'warning' | 'neutral' | 'neutral'
  verdict_rank: number
  sub_indicators: TccSubIndicator[]
  detail_route_key: 'day' | 'swing' | 'regular'
}

export interface TradeCommandCenterRecommendation {
  id: string
  ticker: string
  engine_type: string
  direction: string
  strategy: string
  signal: string
  /** Unified verdict — the only verdict field shown on cards. */
  verdict?: 'STRONG_GO' | 'GO' | 'WATCH' | 'WAIT' | 'AVOID' | 'NO_EDGE'
  entry_zone?: string
  target?: string
  stop_loss?: string
  expiry?: string
  reason?: string
  risk_level?: string
  action_label?: string
  recommended_action?: string
  market_bias: string
  setup_quality: string
  execution_readiness?: string
  final_decision: string
  confidence?: string | number
  supporting_factors?: string[]
  missing_confirmations?: string[]
  risk_state?: string
  signal_quality?: string
  execution_timing?: string
  risk_category?: string
  explanation?: Record<string, string>
  risk_reason?: string
  display_confidence?: number
  execution_fields?: Array<{ label: string; value: string }>
  /** Cross-engine score normalisation fields */
  raw_engine_score?: number
  normalized_score?: number
  normalized_state?: string
  confidence_band?: string
  execution_bias?: string
  risk_band?: string
  normalized_reason?: string
  option_risk_context?: {
    theta_risk: string
    gamma_risk: string
    iv_risk: string
    liquidity_risk: string
    suggested_contract_window: string
    option_execution_warning: string
  }
  engine_score_breakdown?: Record<string, unknown>
  /** Price data from yfinance (populated by command_center_router) */
  last_price?: number
  price_change?: number
  price_change_pct?: number
}

export interface TradeCommandCenterConflict {
  id: string
  ticker: string
  state: 'STRONG_AGREEMENT' | 'PARTIAL_AGREEMENT' | 'CONFLICTING_SIGNALS' | 'TREND_GO_RISKY_OPTIONS' | 'HIGH_IV_WARNING'
  summary: string
  resolution: string
  suggested_action: string
  signals: Array<{
    engine_type: string
    signal: string
    note?: string
  }>
}

export interface TradeCommandCenterAlertsSummary {
  active_alerts: number
  critical_alerts: number
  positions_requiring_exit: number
  near_expiry_trades: number
  high_iv_warnings: number
}

export interface TradeCommandCenterActivity {
  id: string
  ticker: string
  engine_type: string
  signal: string
  timestamp: string
  action_taken?: string
  message?: string
}

export interface TradeCommandCenterCharts {
  trend_strength?: Array<{ label: string; value: number; tone?: string }>
  engine_signal_distribution?: Array<{ engine: string; READY?: number; WATCH?: number; WAIT?: number; AVOID?: number; NO_EDGE?: number }>
  risk_distribution?: Array<{ label: string; value: number }>
  style_allocation?: Array<{ label: string; value: number }>
}

export interface OverallDecision {
  /** Unified verdict — single value from verdict_resolver. */
  verdict: 'STRONG_GO' | 'GO' | 'WATCH' | 'WAIT' | 'AVOID' | 'NO_EDGE'
  label: string
  confidence: number
  reason: string
  engines_agreeing: string[]
  engines_conflicting: string[]
}

export interface TradeCommandCenterPayload {
  market_summary: Record<string, unknown>
  engines: TradeCommandCenterEngine[]
  overall_decision?: OverallDecision
  recommendations: TradeCommandCenterRecommendation[]
  tcc_sections?: TccSections
  conflicts?: TradeCommandCenterConflict[]
  alerts_summary?: TradeCommandCenterAlertsSummary
  recent_activity?: TradeCommandCenterActivity[]
  charts?: TradeCommandCenterCharts
  filters?: Record<string, unknown>
}

export interface SignalFeedDecisionBlock {
  /** Unified verdict — the only verdict field shown on cards. */
  verdict?: 'STRONG_GO' | 'GO' | 'WATCH' | 'WAIT' | 'AVOID' | 'NO_EDGE'
  engine: 'day' | 'swing' | 'regular' | string
  market_bias: string
  setup_quality: string
  execution_readiness: string
  final_decision: 'READY' | 'WATCH' | 'EXTENDED' | 'AVOID' | 'CONFLICT' | 'MANAGE' | 'WAIT' | 'NO_EDGE' | string
  confidence: number
  reason: string
  supporting_factors: string[]
  missing_confirmations: string[]
  risk_state: string
  raw_signal?: string
  metrics?: Record<string, unknown>
  strategy?: string
  bias?: string
  signal_quality?: string
  execution_timing?: string
  risk_category?: string
  expected_holding_period?: string
  recommended_contract_duration?: string
  explanation?: Record<string, string>
  risk_reason?: string
  display_confidence?: number
  execution_fields?: Array<{ label: string; value: string }>
  /** Cross-engine score normalisation fields */
  raw_engine_score?: number
  normalized_score?: number
  normalized_state?: string
  confidence_band?: string
  execution_bias?: string
  risk_band?: string
  normalized_reason?: string
  engine_score_breakdown?: Record<string, unknown>
  option_risk_context?: {
    theta_risk: string
    gamma_risk: string
    iv_risk: string
    liquidity_risk: string
    suggested_contract_window: string
    option_execution_warning: string
  }
}

export interface SignalFeedMetrics {
  rsi?: number | null
  relative_strength?: number | null
  volume_ratio?: number | null
  iv_rank?: number | null
  bull_score?: number | null
  bear_score?: number | null
  trend_score?: number | null
  market_context?: string | null
}

export interface SignalFeedRow {
  id: string
  ticker: string
  company_name: string
  sector?: string
  price: number
  price_change?: number
  price_change_pct: number
  trend: string
  rsi: number
  relative_strength: number
  day_decision: string
  swing_decision: string
  regular_decision: string
  agreement_state: 'READY' | 'WATCH' | 'EXTENDED' | 'AVOID' | 'CONFLICT' | 'MANAGE' | string
  agreement_badge?: 'STRONG_AGREEMENT' | 'PARTIAL_AGREEMENT' | 'CONFLICT' | 'EXTENDED' | 'NO_EDGE' | 'MANAGE' | string
  agreement_reason: string
  alerts_count: number
  metrics?: SignalFeedMetrics
  sources: string[]
  notes?: string | null
  added_at?: string
  /** Seconds since this row's quote was fetched from Yahoo */
  cache_age_seconds?: number
  /** "yahoo_live" | "yahoo_cache" | "error" */
  quote_source?: string
  ai_summary: string
  chart_points: Array<{ date: string; close: number }>
  day: SignalFeedDecisionBlock
  swing: SignalFeedDecisionBlock
  regular: SignalFeedDecisionBlock
  actions: {
    analyze_url: string
    chart_url: string
    positions_url: string
    alerts_url: string
  }
}

export interface SignalFeedCacheMeta {
  used_cache: boolean
  cache_hits: number
  cache_misses: number
  force_refresh: boolean
  oldest_cache_age_seconds: number
  source: string
  elapsed_ms: number
}

export interface AiPositionAnalysis {
  ai_state: string
  state_label: string
  health_score: number
  health_label: string
  pnl_pct: number
  momentum_quality: string
  extension_pct: number
  extension_risk: string
  theta_risk: string
  iv_risk: string
  trend_risk: string
  rsi_risk: string
  liquidity_risk: string
  market_correlation_risk: string
  dte: number
  rsi: number
  current_price: number
  ma20: number
  value_capture_pct: number | null
  max_profit: number
  max_loss: number
  ai_summary: string
  next_best_action: string
  timeline_stage: string
  smart_alerts: Array<{
    type: string
    label: string
    message: string
    severity: string
  }>
  management_playbook: string[]
  management_actions: string[]
  is_profitable: boolean
  strategy_family: string
}

export interface StockPositionAnalysis {
  decision:           'HOLD' | 'WATCH' | 'TRIM' | 'SELL' | 'STOP_HIT'
  decision_label:     string
  reasoning:          string
  position_type:      'stock'
  // Pricing
  current_price:      number
  entry_price:        number
  shares:             number
  cost_basis:         number
  market_value:       number
  // P&L
  pnl_dollar:         number
  pnl_pct:            number
  day_pl_dollar:      number
  day_pl_pct:         number
  is_profitable:      boolean
  // Risk levels
  trailing_stop:      number
  stop_loss:          number
  trailing_stop_pct:  number
  high_water_mark:    number
  // Targets
  target1:            number
  target2:            number
  // Technicals
  ma20:               number
  ma50:               number
  rsi:                number
  mom_5d:             number
  // Distances
  price_vs_ma20_pct:  number
  price_vs_ma50_pct:  number
  dist_to_stop_pct:   number
  dist_to_t1_pct:     number
  dist_to_t2_pct:     number
  // Health
  health_score:       number
  health_label:       string
  // Actions
  smart_alerts:       Array<{ type: string; label: string; message: string; severity: string }>
  management_actions: string[]
}

export interface SignalFeedPayload {
  summary: {
    total: number
    ready: number
    watch: number
    extended: number
    avoid: number
    conflict: number
    manage: number
    alerts?: number
    strong_bullish?: number
    strong_bearish?: number
  }
  ai_summary: {
    headline: string
    message: string
    best_focus: string
    counts: Record<string, number>
  }
  pagination: {
    page: number
    page_size: number
    total: number
    total_pages: number
  }
  sort: {
    sort_by: string
    sort_dir: 'asc' | 'desc'
  }
  cache?: SignalFeedCacheMeta
  rows: SignalFeedRow[]
}
