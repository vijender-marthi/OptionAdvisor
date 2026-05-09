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
  execution_readiness: string
  final_decision: string
  confidence: number
  reason: string
  supporting_factors: string[]
  missing_confirmations: string[]
  risk_state: string
}

export interface TradeCommandCenterRecommendation {
  id: string
  ticker: string
  engine_type: string
  direction: string
  strategy: string
  signal: string
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
  execution_readiness: string
  final_decision: string
  confidence?: string | number
  supporting_factors?: string[]
  missing_confirmations?: string[]
  risk_state?: string
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

export interface TradeCommandCenterPayload {
  market_summary: Record<string, unknown>
  engines: TradeCommandCenterEngine[]
  recommendations: TradeCommandCenterRecommendation[]
  conflicts?: TradeCommandCenterConflict[]
  alerts_summary?: TradeCommandCenterAlertsSummary
  recent_activity?: TradeCommandCenterActivity[]
  charts?: TradeCommandCenterCharts
  filters?: Record<string, unknown>
}

export interface WatchlistXDecisionBlock {
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
}

export interface WatchlistXMetrics {
  rsi?: number | null
  relative_strength?: number | null
  volume_ratio?: number | null
  iv_rank?: number | null
  bull_score?: number | null
  bear_score?: number | null
  trend_score?: number | null
  market_context?: string | null
}

export interface WatchlistXRow {
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
  metrics?: WatchlistXMetrics
  sources: string[]
  notes?: string | null
  added_at?: string
  /** Seconds since this row's quote was fetched from Yahoo */
  cache_age_seconds?: number
  /** "yahoo_live" | "yahoo_cache" | "error" */
  quote_source?: string
  ai_summary: string
  chart_points: Array<{ date: string; close: number }>
  day: WatchlistXDecisionBlock
  swing: WatchlistXDecisionBlock
  regular: WatchlistXDecisionBlock
  actions: {
    analyze_url: string
    chart_url: string
    positions_url: string
    alerts_url: string
  }
}

export interface WatchlistXCacheMeta {
  used_cache: boolean
  cache_hits: number
  cache_misses: number
  force_refresh: boolean
  oldest_cache_age_seconds: number
  source: string
  elapsed_ms: number
}

export interface WatchlistXPayload {
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
  cache?: WatchlistXCacheMeta
  rows: WatchlistXRow[]
}
