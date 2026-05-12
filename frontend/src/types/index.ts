export interface OptionLeg {
  action: 'BUY' | 'SELL'
  option_type: 'CALL' | 'PUT'
  strike: number
  expiry: string
  delta: number
  mid_price: number
  bid: number
  ask: number
  iv: number
  oi: number
  volume: number
  bid_ask_spread_pct: number
  data_quality?: string        // "OK" | "MODEL" | "STALE" | "UNRELIABLE"
  data_quality_reason?: string
}

export interface ScoreBreakdown {
  signal_score: number
  structure_score: number
  liquidity_score: number
  iv_fit_score: number
  total_score: number
}

export interface Recommendation {
  rank: number
  strategy: string
  bias: string
  legs: OptionLeg[]
  expiry: string
  dte: number
  net_credit: number
  spread_width: number
  max_profit: number
  max_loss: number
  risk_reward_ratio: number
  credit_pct_of_width: number
  breakeven_lower: number
  breakeven_upper: number
  short_leg_delta: number
  prob_of_profit: number
  prob_of_max_loss: number
  expected_value: number
  passes_rr_filter: boolean
  passes_liquidity_filter: boolean
  passes_credit_filter: boolean
  scores: ScoreBreakdown
  rationale: string
  exit_plan: string
  warnings: string[]
  // Kelly Criterion position sizing
  kelly_fraction: number       // raw Kelly % as decimal (e.g. 0.125 = 12.5%)
  half_kelly_fraction: number  // recommended: Kelly × 0.5, capped at 20%
  edge_ratio: number           // EV / max_loss — edge quality measure
}

export interface Signals {
  current_price: number
  prev_close: number
  price_change: number
  price_change_pct: number
  trend: string
  trend_strength: string
  ma20: number
  ma50: number
  ma200: number
  above_ma20: boolean
  above_ma50: boolean
  above_ma200: boolean
  ma50_slope: number
  ma200_slope: number
  rsi: number
  rsi_signal: string
  macd: number
  macd_signal_line: number
  macd_histogram: number
  macd_crossover: string
  current_iv: number
  hv_20: number
  hv_60: number
  iv_rank: number
  iv_percentile: number
  iv_vs_hv: number
  iv_environment: string
  put_call_ratio: number
  pcr_signal: string
  iv_skew: number
  skew_signal: string
  directional_bias: string
  bias_confidence: number
  volatility_regime: string

  // Extended-hours (pre-market / after-hours) — absent or 0 when market is regular
  ext_market_price?: number       // e.g. 187.45
  ext_market_change?: number      // vs regular close, e.g. +1.23
  ext_market_change_pct?: number  // e.g. +0.66
  ext_market_type?: string        // "pre" | "post" | ""
}

export interface ResolvedTradeDecision {
  market_bias: string
  setup_quality: string
  execution_readiness: string
  final_decision: string
  confidence: number
  reason: string
  supporting_factors: string[]
  missing_confirmations: string[]
  risk_state: string
  signal_quality: string
  execution_timing: string
  risk_category: string
  explanation: Record<string, string>
  risk_reason: string
  display_confidence: number
  execution_fields: Array<{ label: string; value: string }>
}

export interface OptionRow {
  strike: number
  last_price: number
  bid: number
  ask: number
  volume: number
  open_interest: number
  implied_volatility: string
  delta?: number
  data_quality?: string        // "OK" | "MODEL" | "STALE" | "UNRELIABLE"
  data_quality_reason?: string
}

export interface PricePoint {
  date: string
  open: number
  high: number
  low: number
  close: number
  ma20: number
  ma50: number
  ma200: number
}

// ─── Strategy mode ──────────────────────────────────────────

export type StrategyMode = 'all' | 'long_only' | 'credit_only' | 'short_or_covered' | 'straddle_only'

// ─── Ticker cache ───────────────────────────────────────────

export const CACHE_TTL_MS = 15 * 60 * 1000   // 15 minutes

export interface TickerCacheEntry {
  ticker: string
  data: AnalyzeResponse
  timestamp: number          // Date.now() when stored
  weeksOut: number
  spreadWidth: number | null
  strategyMode: StrategyMode
  /** When set, primary `data` was loaded for this exact chain expiry (YYYY-MM-DD). */
  chainExpiry?: string | null
  /** Exact expiry snapshots from Portfolio auto-fetch / refresh (YYYY-MM-DD → analyze response). */
  portfolioByExpiry?: Record<string, AnalyzeResponse>
  /** When each `portfolioByExpiry` snapshot was stored (for TTL / staleness). */
  portfolioByExpiryFetchedAt?: Record<string, number>
  // Multi-week scan: keyed by weeksOut (MULTI_WEEK_TARGETS) → full response for that expiry window
  multiWeekData?: Record<number, AnalyzeResponse>
  multiWeekTimestamp?: number    // when the multi-week sweep was last run
}

export function isCacheFresh(entry: TickerCacheEntry): boolean {
  return Date.now() - entry.timestamp < CACHE_TTL_MS
}

export function cacheAge(entry: TickerCacheEntry): number {
  return Math.floor((Date.now() - entry.timestamp) / 60_000)   // minutes
}

// ─── App-level state types ──────────────────────────────────

export type Page =
  | 'ticker'
  | 'trade-command-center'
  | 'ai-coach'
  | 'positions'
  | 'alert-center'
  | 'watchlist'
  | 'portfolio'
  | 'help'
  | 'ai-stocks'
  | 'q-radar'
  | 'trade-signals'
  | 'settings'
  | 'login'
  | 'backtest'
  | 'journal'
  | 'auto-trade'
  | 'day-trade'
  | 'day-trade-watchlist'
  | 'day-trade-alerts'
  | 'active-trades'
  | 'swing-trade'
  | 'swing-trade-watchlist'
  | 'forgot-password'
  | 'reset-password'
  | 'trading-glossary'
  | 'activate'
  | 'my-tickers'

export type UserRole = 'admin' | 'user' | 'finance'

// ─── Alert system ───────────────────────────────────────────

export interface AlertEntry {
  id: string                 // dedup key: ticker-strategy-expiry
  ticker: string
  companyName: string
  strategy: string
  bias: string
  expiry: string
  dte: number
  weeksOut: number
  score: number
  maxProfit: number          // per-share
  maxLoss: number            // per-share
  netCredit: number          // per-share (negative = debit)
  pop: number                // probability of profit 0-1
  ev: number                 // expected value per share
  detectedAt: number         // Date.now() timestamp
  timeWindow: string         // e.g. "9:30 AM – 9:45 AM PST"
  emailSent: boolean
  emailMessage?: string
  dismissed: boolean
}

export interface AlertEmailItem {
  ticker: string
  company_name: string
  strategy: string
  bias: string
  expiry: string
  dte: number
  weeks_out: number
  score: number
  max_profit: number
  max_loss: number
  net_credit: number
  pop: number
  ev: number
  time_window: string
}

export interface User {
  name: string
  email: string
  /** Resolved from backend /api/user-data (SQLite user_state.role). */
  role: UserRole
  avatar?: string
}

export interface WatchlistItem {
  ticker: string
  addedAt: string          // ISO date string
  notes?: string
  lastPrice?: number
  companyName?: string
  sector?: string
}

export interface PortfolioPosition {
  id: string               // uuid-ish
  ticker: string
  companyName: string
  strategy: string
  bias: string
  legs: OptionLeg[]
  expiry: string
  dte: number
  net_credit: number
  spread_width: number
  max_profit: number
  max_loss: number
  prob_of_profit: number
  expected_value: number
  scores_total: number
  contracts: number        // number of contracts (1 contract = 100 shares)
  breakeven_lower: number
  breakeven_upper: number
  addedAt: string          // ISO date string
  entryPrice: number       // stock price when added
  status: 'open' | 'closed'
  source?: 'recommendation' | 'manual' | 'day' | 'swing' | 'regular'  // how it was added / trade style
  pnlPct?: number          // user-entered close P&L %
  exitDate?: string        // ISO date string when closed
  notes?: string           // free-form notes (e.g. "mistaken entry")

  // Kelly Criterion snapshot at time of entry
  kelly_fraction?: number        // raw Kelly % at entry (e.g. 0.051 = 5.1%)
  half_kelly_fraction?: number   // half-Kelly recommendation at entry
  edge_ratio?: number            // EV / max_loss at entry
  capital_at_risk?: number       // contracts × max_loss × 100 (actual $ at risk)
  account_size_at_entry?: number // account size when position was added

  // Close details
  exit_price?: number           // exit price per share/contract
  exit_debit_credit?: number    // exit debit/credit per share
  realized_pnl?: number         // realized P&L in $
  realized_pnl_percent?: number // realized P&L %
  exit_reason?: string          // reason for exit
  close_notes?: string          // close-specific notes
  pnl_overridden?: boolean      // whether P&L was manually overridden
  pnl_override_reason?: string  // why P&L was overridden
}

export const EXIT_REASON_OPTIONS = [
  'Profit target hit',
  'Stop loss',
  'Expiry risk',
  'Manual exit',
  'Trimmed risk',
  'Strategy invalidated',
  'Assignment risk',
  'Other',
] as const

export type ExitReason = typeof EXIT_REASON_OPTIONS[number]

/** Close an open portfolio line fully or partially. */
export interface ClosePositionPayload {
  contractsToClose: number
  exit_price?: number
  exit_debit_credit?: number
  close_date?: string       // ISO date string, defaults to now
  realized_pnl?: number
  realized_pnl_percent?: number
  exit_reason?: string
  close_notes?: string
  pnl_overridden?: boolean
  pnl_override_reason?: string
}

export interface UserDataState {
  email: string
  role: UserRole
  watchlist: WatchlistItem[]
  portfolio: PortfolioPosition[]
  /** Server-persisted acknowledgment of the options-advisory disclaimer (see AppContext). */
  advisory_terms_version?: string | null
  advisory_accepted_at?: string | null
  /** Max watchlist symbols for this account (role + OPTION_ADVISOR_WATCHLIST_MAX_*). */
  watchlist_max?: number
  /** Admin day-trade alert scan list (max 10); persisted in SQLite. */
  day_trade_watchlist?: string[]
  /** Admin swing-trade watchlist (max 20); persisted in SQLite. */
  swing_trade_watchlist?: string[]
  /** When false, backend skips GO / day-trade notification emails for this account. */
  alert_email_enabled?: boolean
}

/** One stored WATCH→GO / WATCH→STRONG GO escalation (see /api/day-trade-alerts). */
export interface DayTradeAlertEvent {
  id: string
  ticker: string
  companyName?: string
  previousVerdict: string
  verdict: string
  sessionDate?: string
  bias?: string | null
  bullScore: number
  bearScore: number
  reasons: string[]
  metrics?: Record<string, unknown>
  detectedAt: number
  emailSent: boolean
  emailMessage?: string
}

export interface QuoteQualitySummary {
  chain_rows_total: number
  ok_rows: number
  stale_rows: number
  unreliable_rows: number
  model_rows: number
  pct_non_ok: number
  underlying_quote_source: 'live' | 'previous_close'
  banner_show: boolean
  banner_lines: string[]
}

export interface AnalyzeResponse {
  ticker: string
  company_name: string
  sector: string
  market_cap: string
  signals: Signals
  recommendations: Recommendation[]
  calls_chain: OptionRow[]
  puts_chain: OptionRow[]
  price_history: PricePoint[]
  filters_applied: Record<string, unknown>
  quote_quality_summary?: QuoteQualitySummary
  market_bias: string
  setup_quality: string
  execution_readiness: string
  final_decision: string
  confidence: number
  reason: string
  supporting_factors: string[]
  missing_confirmations: string[]
  risk_state: string
  signal_quality: string
  execution_timing: string
  risk_category: string
  explanation: Record<string, string>
  risk_reason: string
  display_confidence: number
  execution_fields: Array<{ label: string; value: string }>
}

// ─── Backtesting ────────────────────────────────────────────

export interface BacktestLeg {
  action: string
  option_type: string
  strike: number
  entry_price: number
  delta: number
}

export interface BacktestTrade {
  strategy: string
  bias: string
  is_credit: boolean
  entry_date: string
  exit_date: string
  exit_reason: string
  expiry_date: string
  dte_at_entry: number
  underlying_entry: number
  underlying_exit: number
  entry_net: number
  max_profit: number
  max_loss: number
  pnl_per_share: number
  pnl_dollar: number
  pnl_pct_of_max: number
  outcome: string
  directional_bias: string
  bias_confidence: number
  iv_rank: number
  volatility_regime: string
  iv_environment: string
  legs: BacktestLeg[]
}

export interface BacktestStrategyStats {
  count: number
  wins: number
  losses: number
  total_pnl: number
  win_rate: number
  avg_pnl: number
}

export interface BacktestEquityPoint {
  date: string
  cumulative_pnl: number
  trade_pnl: number
  strategy: string
}

export interface BacktestResult {
  ticker: string
  start_date: string
  end_date: string
  strategy_mode: string
  weeks_out: number
  total_trades: number
  winning_trades: number
  losing_trades: number
  win_rate: number
  total_pnl: number
  avg_pnl_per_trade: number
  avg_pnl_winners: number
  avg_pnl_losers: number
  profit_factor: number
  max_drawdown: number
  sharpe_ratio: number
  by_strategy: Record<string, BacktestStrategyStats>
  equity_curve: BacktestEquityPoint[]
  trades: BacktestTrade[]
}

// ─── Trade Journal ───────────────────────────────────────────

export interface JournalEntry {
  id: string
  email: string
  ticker: string
  company_name: string
  strategy: string
  bias: string
  legs: OptionLeg[]
  expiry: string
  entry_date: string
  dte_at_entry: number
  net_credit: number
  max_profit: number
  max_loss: number
  underlying_entry: number
  prob_of_profit: number
  expected_value: number
  total_score: number
  status: 'OPEN' | 'CLOSED' | 'EXPIRED'
  exit_date: string
  underlying_exit: number
  realized_pnl: number
  exit_reason: string
  outcome: string
  current_price: number
  current_pnl: number
  last_refreshed: number
  notes: string
  created_at: number
}
