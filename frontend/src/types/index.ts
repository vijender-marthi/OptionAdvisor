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
}

export interface PricePoint {
  date: string
  close: number
  ma20: number
  ma50: number
  ma200: number
}

// ─── Strategy mode ──────────────────────────────────────────

export type StrategyMode = 'all' | 'long_only' | 'credit_only'

// ─── Ticker cache ───────────────────────────────────────────

export const CACHE_TTL_MS = 15 * 60 * 1000   // 15 minutes

export interface TickerCacheEntry {
  ticker: string
  data: AnalyzeResponse
  timestamp: number          // Date.now() when stored
  weeksOut: number
  spreadWidth: number | null
  strategyMode: StrategyMode
  // Multi-week scan: keyed by weeksOut (2,3,4,6,8) → full response for that expiry window
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

export type Page = 'ticker' | 'watchlist' | 'portfolio' | 'help' | 'ai-stocks' | 'trade-signals' | 'alerts' | 'settings' | 'login'

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
  pnlPct?: number          // user-entered close P&L %
  exitDate?: string        // ISO date string when closed
  notes?: string
}

export interface UserDataState {
  email: string
  watchlist: WatchlistItem[]
  portfolio: PortfolioPosition[]
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
}
