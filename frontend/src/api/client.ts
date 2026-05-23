import axios from 'axios'
import type { AlertEmailItem, AlertEntry, AnalyzeResponse, DayTradeAlertEvent, PortfolioPosition, StrategyMode, UserDataState, WatchlistItem } from '../types'

export const api = axios.create({ baseURL: '/api' })

export const OA_ACCESS_TOKEN_KEY = 'oa_access_token'

export function getAccessToken(): string | null {
  try {
    return localStorage.getItem(OA_ACCESS_TOKEN_KEY)
  } catch {
    return null
  }
}

export function setAccessToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(OA_ACCESS_TOKEN_KEY, token)
    else localStorage.removeItem(OA_ACCESS_TOKEN_KEY)
  } catch {
    /* ignore */
  }
}

api.interceptors.request.use(cfg => {
  const t = getAccessToken()
  if (t) {
    cfg.headers.Authorization = `Bearer ${t}`
  }
  return cfg
})

api.interceptors.response.use(
  r => r,
  err => {
    if (err.response?.status === 401) {
      const had = getAccessToken()
      setAccessToken(null)
      if (had) window.dispatchEvent(new CustomEvent('oa-auth-expired'))
    }
    return Promise.reject(err)
  },
)

export interface AuthLoginResponse {
  access_token: string
  token_type: string
  email: string
  name: string
  role: string
}

export const authLogin = async (email: string, password: string): Promise<AuthLoginResponse> => {
  const { data } = await api.post<AuthLoginResponse>('/auth/login', { email, password })
  return data
}

export const authRegister = async (payload: {
  email: string
  password: string
  name?: string
}): Promise<{ ok: boolean; needs_activation: boolean; message: string }> => {
  const { data } = await api.post('/auth/register', payload)
  return data
}

export const authGoogle = async (credential: string): Promise<AuthLoginResponse> => {
  const { data } = await api.post<AuthLoginResponse>('/auth/google', { credential })
  return data
}

export const authActivate = async (
  token: string,
): Promise<{ ok: boolean; email: string; message: string }> => {
  const { data } = await api.get('/auth/activate', { params: { token } })
  return data
}

export const authForgotPassword = async (
  email: string,
): Promise<{ ok: boolean; message: string; dev_reset_token?: string }> => {
  const { data } = await api.post('/auth/forgot-password', { email })
  return data
}

export const authResetPassword = async (
  token: string,
  password: string,
): Promise<{ ok: boolean; message: string }> => {
  const { data } = await api.post('/auth/reset-password', { token, password })
  return data
}

export const analyzeOptions = async (
  ticker: string,
  weeksOut: number,
  spreadWidth?: number | null,
  strategyMode: StrategyMode = 'all',
  chainExpiry?: string | null,
): Promise<AnalyzeResponse> => {
  const payload: Record<string, unknown> = {
    ticker,
    weeks_out: weeksOut,
    spread_width: spreadWidth ?? null,
    strategy_mode: strategyMode,
  }
  if (chainExpiry?.trim()) payload.chain_expiry = chainExpiry.trim().slice(0, 10)
  const { data } = await api.post<AnalyzeResponse>('/analyze', payload)
  return data
}

/** One 1m RTH bar for the day-trade session chart (see metrics.chart_bars). */
export interface DayTradeChartBar {
  t: string
  o: number
  h: number
  l: number
  c: number
  v: number
  vwap: number
}

export interface DayTraderDecision {
  ticker: string
  market_state: string
  market_guidance?: string
  relative_strength: string
  trader_state: string
  call_bias: string
  put_bias: string
  suggested_action: string
  decision_message: string
  risk_warning: string
  confirmation_needed: string[]
}

export interface DayOptionRiskContext {
  theta_risk: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE' | string
  gamma_risk: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE' | string
  iv_risk: 'HIGH' | 'MEDIUM' | 'LOW' | string
  liquidity_risk: 'HIGH' | 'MEDIUM' | 'LOW' | string
  suggested_contract_window: string
  option_execution_warning: string
}

// ─── AI Coach types ────────────────────────────────────────────────────────────

export type AiCoachAction    = 'WATCH' | 'ENTER' | 'EXIT' | 'HOLD' | 'AVOID'
export type AiCoachSetupType = 'CALL' | 'PUT' | 'SPREAD' | 'NONE'
export type AiCoachBias      = 'bullish' | 'bearish' | 'neutral'
export type AiCoachRisk      = 'LOW' | 'MEDIUM' | 'HIGH'
export type AiCoachTreeAction = 'ENTER' | 'WAIT' | 'EXIT' | 'AVOID'

export interface AiCoachResult {
  ticker:     string
  timestamp:  string
  setup_type: AiCoachSetupType
  bias:       AiCoachBias
  confidence: number
  action:     AiCoachAction
  risk:       AiCoachRisk
  market_context: {
    spy_alignment:    boolean
    spy_note:         string
    volume_confirmed: boolean
    relative_strength: 'strong' | 'weak' | 'neutral'
  }
  summary:         string
  entry_condition: string
  invalidation:    string
  states: {
    setup:   { label: string; detail: string; key_levels: number[] }
    entry:   { label: string; trigger: string; price: number }
    in_play: { label: string; target: number; trail_level: number; add_condition: string }
    exit:    { label: string; stop_loss: number; exit_condition: string }
  }
  decision_tree: Array<{
    if:         string
    then:       string
    action:     AiCoachTreeAction
    confidence: 'high' | 'medium' | 'low'
  }>
  best_next_step: string
  options_note:   string
  /** Confluence zone detection */
  confluence?: {
    detected: boolean
    zone_price: number
    levels_converging: string[]
    strength: 'EXTREME' | 'STRONG' | 'NONE'
    zone_role: 'RESISTANCE' | 'SUPPORT' | 'CHOP' | 'NONE'
  }
  /** Entry gate validation */
  entry_gate?: {
    valid: boolean
    trigger_price: number
    trigger_condition: string
    rvol_required: number
    candle_required: 'rejection' | 'bounce' | 'breakout' | 'none'
  }
  /** Trade levels with R/R */
  trade?: {
    direction: 'PUT' | 'CALL' | 'NONE'
    entry_price: number
    target: number
    stop: number
    risk_reward: number
    r_r_valid: boolean
  }
  no_trade_reason?: string | null
  confluence_note?: string
  /** 'anthropic' | 'openai' | 'deterministic' — for debugging */
  _source?: string
}

/** Intraday day-trade scan — verdict tiers: STRONG GO, GO, WATCH, NO-GO, WAIT. */
export interface DayTradeScanResult {
  ticker: string
  company_name: string
  verdict: 'STRONG GO' | 'GO' | 'WATCH' | 'NO-GO' | 'WAIT'
  bias: 'long' | 'short' | null
  bull_score: number
  bear_score: number
  reasons: string[]
  /** Includes chart_bars (OHLCV + session VWAP per bar) for visualization. */
  metrics: Record<string, unknown>
  /** Structured trader interpretation — not a trade signal; confirmation-first framing. */
  trader_decision?: DayTraderDecision
  market_bias: string
  setup_quality: string
  execution_readiness: string
  final_decision: string
  confidence: number
  reason: string
  supporting_factors: string[]
  missing_confirmations: string[]
  risk_state: string
  /** Three-axis display: signal quality, execution timing, risk category */
  signal_quality?: string
  execution_timing?: string
  risk_category?: string
  /** Strategy-aware explanation */
  explanation?: Record<string, string>
  risk_reason?: string
  display_confidence?: number
  /** Execution-level fields (VWAP, breakout level, etc.) */
  execution_fields?: Array<{ label: string; value: string }>
  /** VWAP-based entry guidance with pending confirmations, breakout levels, and human-readable action text */
  entry_guidance?: {
    state: string
    summary: string
    action: string
    avoid: string
    pending_confirmations: string[]
    current_price?: number
    vwap?: number
    price_vs_vwap_pct?: number
    opening_range_high?: number
    opening_range_low?: number
    breakout_level?: number
    pullback_zone?: string
    risk_below?: number
    scalp_target?: number
    /** New execution guidance fields */
    day_market_phase?: string
    pullback_probability?: string
    should_enter_now?: string
    execution_personality?: {
      suitable_for: string[]
      not_ideal_for: string[]
    }
    entry_decision?: {
      conservative: string
      aggressive: string
      best_setup: string
    }
    contextual_alerts?: Array<{
      type: string
      message: string
      condition: string
    }>
    exit_rules?: Array<{ trigger: string; price: number; action: string; note: string }>
  }
  /** Lightweight options execution context — warning-only, not a strategy builder. */
  option_risk_context?: DayOptionRiskContext
  /** Structured AI coaching summary — Anthropic / OpenAI / deterministic fallback. */
  ai_coach?: AiCoachResult
}

export const analyzeDayTrade = async (ticker: string): Promise<DayTradeScanResult> => {
  const { data } = await api.post<DayTradeScanResult>('/day-trade', { ticker: ticker.trim() })
  return data
}

/** Single daily point in `metrics.chart_series` from POST /api/swing-trade (bounded tail, ~6 months). */
export interface SwingTradeChartPoint {
  d: string
  c: number
  ma20?: number | null
  ma50?: number | null
  rsi?: number | null
  hv20?: number | null
}

export interface SwingTradeChartSeriesPayload {
  max_points: number
  count: number
  points: SwingTradeChartPoint[]
}

/** Daily swing-trade scan — verdict tiers: STRONG GO, GO, WATCH, NO-GO, WAIT. */
export interface SwingTradeScanResult {
  ticker: string
  company_name: string
  verdict: 'STRONG GO' | 'GO' | 'WATCH' | 'NO-GO' | 'WAIT'
  bias: 'long' | 'short' | null
  bull_score: number
  bear_score: number
  reasons: string[]
  /** Includes `chart_series` (daily close, MA20/MA50, RSI(14), HV20 %) for metric charts. */
  metrics: Record<string, unknown>
  // ── Decision Quality Layer ─────────────────────────────────────────
  swing_bias:              string
  entry_quality:           string
  risk_level:              string
  final_action:            string
  trade_quality_score:     number
  decision_label:          string
  decision_message:        string
  risk_flags:              string[]
  confirmation_needed:     string[]
  suggested_expiry_window: string
  suggested_strategy:      string
  avoid_reason:            string | null
  /** Short options-structure hint derived server-side (education only). */
  playbook_hint:           string
  market_bias:            string
  setup_quality:          string
  execution_readiness:    string
  final_decision:         string
  confidence:             number
  reason:                 string
  supporting_factors:     string[]
  missing_confirmations:  string[]
  risk_state:             string
  expected_holding_period:      string
  recommended_contract_duration: string
}

export const analyzeSwingTrade = async (ticker: string): Promise<SwingTradeScanResult> => {
  const { data } = await api.post<SwingTradeScanResult>('/swing-trade', { ticker: ticker.trim() })
  return data
}

/** Backend-computed intraday guidance for a saved day-trade option position (admin-only API). */
export interface ActiveTradeDecision {
  state: string
  action: string
  message: string
  badge_tone: 'green' | 'orange' | 'red' | 'gray'
  risk_warning: string
  confirmation_needed: string[]
  trend_direction?: string
  intraday_snapshot_note?: string
}

export interface ActiveTradeRow {
  id: string
  ticker: string
  side: 'CALL' | 'PUT'
  entry_price: number
  entry_underlying_px?: number | null
  contracts?: number | null
  strike?: number | null
  expiry?: string | null
  notes: string
  opened_at_ms: number
  exited_at_ms?: number | null
  trade_type: 'day' | 'swing'
  decision: ActiveTradeDecision | Record<string, unknown>
  metrics: Record<string, unknown>
  intraday_error?: string | null
}

export type ActiveTradeListResult = {
  trades: ActiveTradeRow[]
  included_opened_before_today: boolean
}

export const listActiveTrades = async (): Promise<ActiveTradeListResult> => {
  const { data } = await api.get<ActiveTradeListResult>('/trades/active')
  return {
    trades: data.trades ?? [],
    included_opened_before_today: Boolean(data.included_opened_before_today),
  }
}

export const enterActiveTrade = async (body: {
  ticker: string
  side: 'CALL' | 'PUT'
  entry_price: number
  entry_underlying_px?: number | null
  contracts?: number | null
  strike?: number | null
  expiry?: string | null
  notes?: string | null
  trade_type?: 'day' | 'swing'
}): Promise<{
  id: string
  ticker: string
  side: string
  entry_price: number
  opened_at_ms: number
  notes: string
  strike?: number | null
  expiry?: string | null
}> => {
  const { data } = await api.post('/trades/enter', body)
  return data
}

export const exitActiveTrade = async (tradeId: string): Promise<void> => {
  await api.post(`/trades/${encodeURIComponent(tradeId)}/exit`)
}

export const getDayTradeAlerts = async (email: string): Promise<DayTradeAlertEvent[]> => {
  const { data } = await api.get<{ email: string; alerts: DayTradeAlertEvent[] }>(
    `/day-trade-alerts/${encodeURIComponent(email)}`,
  )
  return data.alerts
}

export const getUserData = async (email: string): Promise<UserDataState> => {
  const { data } = await api.get<UserDataState>(`/user-data/${encodeURIComponent(email)}`)
  return data
}

export const sendAlertEmail = async (
  email: string,
  userName: string,
  alerts: AlertEntry[],
): Promise<{ sent: boolean; message: string }> => {
  const payload: AlertEmailItem[] = alerts.map(alert => ({
    ticker: alert.ticker,
    company_name: alert.companyName,
    strategy: alert.strategy,
    bias: alert.bias,
    expiry: alert.expiry,
    dte: alert.dte,
    weeks_out: alert.weeksOut,
    score: alert.score,
    max_profit: alert.maxProfit,
    max_loss: alert.maxLoss,
    net_credit: alert.netCredit,
    pop: alert.pop,
    ev: alert.ev,
    time_window: alert.timeWindow,
  }))
  const { data } = await api.post('/send-alert', { email, user_name: userName, alerts: payload })
  return data
}

export const clearAllCaches = async (): Promise<{
  ok: boolean
  total_entries_cleared: number
  cleared: {
    bar_cache: number
    quote_cache: number
    analysis_cache: number
    analyze_user_cache: number
    day_scan_cache: number
    swing_scan_cache: number
  }
}> => {
  const { data } = await api.post('/cache/clear')
  return data.data || data
}

export const getUserAccent = async (): Promise<string> => {
  const { data } = await api.get('/user/accent')
  return data.accent || 'emerald'
}

export const setUserAccent = async (accent: string): Promise<void> => {
  await api.put('/user/accent', { accent })
}

export const sendTestEmail = async (
  email: string,
  userName?: string,
): Promise<{ sent: boolean; message: string }> => {
  const { data } = await api.post('/test-email', { email, user_name: userName })
  return data
}

export const getEmailStatus = async (): Promise<{
  configured: boolean
  provider: 'sendgrid' | 'smtp' | 'none'
  missing: string[]
  host: string
  port: number
  from: string
  fromName?: string
  envFile: string
  envFileExists: boolean
}> => {
  const { data } = await api.get('/email-status')
  return data
}

export const getAlerts = async (email: string): Promise<AlertEntry[]> => {
  const { data } = await api.get<{ email: string; alerts: AlertEntry[] }>(`/alerts/${encodeURIComponent(email)}`)
  return data.alerts
}

export const scanBackendAlerts = async (email: string): Promise<AlertEntry[]> => {
  const { data } = await api.post<{ email: string; alerts: AlertEntry[] }>(`/alerts/scan/${encodeURIComponent(email)}`)
  return data.alerts
}

export const dismissBackendAlert = async (email: string, alertId: string): Promise<void> => {
  await api.post('/alerts/dismiss', { email, alert_id: alertId })
}

export const clearBackendAlerts = async (email: string): Promise<void> => {
  await api.post('/alerts/clear', { email })
}

export const saveUserData = async (
  email: string,
  watchlist: WatchlistItem[],
  portfolio: PortfolioPosition[],
  advisory?: { advisoryTermsVersion: string; advisoryAcceptedAt: string },
  dayTradeWatchlist?: string[],
  swingTradeWatchlist?: string[],
  alertEmailEnabled?: boolean,
): Promise<UserDataState> => {
  const body: Record<string, unknown> = { watchlist, portfolio }
  if (advisory) {
    body.advisory_terms_version = advisory.advisoryTermsVersion
    body.advisory_accepted_at = advisory.advisoryAcceptedAt
  }
  if (dayTradeWatchlist !== undefined) {
    body.day_trade_watchlist = dayTradeWatchlist
  }
  if (swingTradeWatchlist !== undefined) {
    body.swing_trade_watchlist = swingTradeWatchlist
  }
  if (alertEmailEnabled !== undefined) {
    body.alert_email_enabled = alertEmailEnabled
  }
  const { data } = await api.put<UserDataState>(`/user-data/${encodeURIComponent(email)}`, body)
  return data
}

export const runBacktest = async (params: {
  ticker: string
  start_date: string
  end_date: string
  strategy_mode: string
  weeks_out: number
  spread_width: number | null
}): Promise<import('../types').BacktestResult> => {
  const { data } = await api.post('/backtest', params)
  return data
}

// ─── Trade Journal ─────────────────────────────────────────────────────────

export const saveToJournal = async (email: string, payload: {
  ticker: string; company_name: string; strategy: string; bias: string
  legs: object[]; expiry: string; entry_date: string; dte_at_entry: number
  net_credit: number; max_profit: number; max_loss: number
  underlying_entry: number; prob_of_profit: number; expected_value: number
  total_score: number; notes?: string
  trade_type?: string; engine_signal?: string; engine_state?: number
}): Promise<{ id: string }> => {
  const { data } = await api.post(`/journal/save?email=${encodeURIComponent(email)}`, payload)
  return data
}

export const getJournal = async (email: string, status = ''): Promise<{ entries: object[] }> => {
  const { data } = await api.get(`/journal/${encodeURIComponent(email)}`, { params: status ? { status } : {} })
  return data
}

export const refreshJournal = async (email: string): Promise<{ entries: object[] }> => {
  const { data } = await api.post(`/journal/refresh/${encodeURIComponent(email)}`)
  return data
}

export const closeJournalEntry = async (
  email: string, id: string, exit_reason = 'MANUAL', notes = ''
): Promise<{ outcome: string; realized_pnl: number }> => {
  const { data } = await api.patch(
    `/journal/${encodeURIComponent(email)}/${id}/close`,
    { exit_reason, notes }
  )
  return data
}

export const updateJournalNotes = async (email: string, id: string, notes: string): Promise<void> => {
  await api.patch(`/journal/${encodeURIComponent(email)}/${id}/notes`, { notes })
}

export const updateJournalEntry = async (
  email: string, id: string, fields: Record<string, unknown>
): Promise<void> => {
  await api.patch(`/journal/${encodeURIComponent(email)}/${id}/update`, fields)
}

export const deleteJournalEntry = async (email: string, id: string): Promise<void> => {
  await api.delete(`/journal/${encodeURIComponent(email)}/${id}`)
}

// ─── Trade Ideas ─────────────────────────────────────────────────────────────

import type { TradeIdea } from '../types'

export const getTradeIdeas = async (email: string): Promise<TradeIdea[]> => {
  const { data } = await api.get(`/trade-ideas/${encodeURIComponent(email)}`)
  return (data.ideas ?? []) as TradeIdea[]
}

export const createTradeIdea = async (
  email: string,
  idea: Omit<TradeIdea, 'id' | 'created_at' | 'updated_at'>,
): Promise<{ id: string }> => {
  const { data } = await api.post(`/trade-ideas/${encodeURIComponent(email)}`, idea)
  return data
}

export const updateTradeIdea = async (
  email: string,
  id: string,
  fields: Partial<Omit<TradeIdea, 'id' | 'ticker' | 'created_at' | 'updated_at'>>,
): Promise<void> => {
  await api.patch(`/trade-ideas/${encodeURIComponent(email)}/${id}`, fields)
}

export const deleteTradeIdea = async (email: string, id: string): Promise<void> => {
  await api.delete(`/trade-ideas/${encodeURIComponent(email)}/${id}`)
}

// ─── Alpaca Paper Trading (admin only) ──────────────────────────────────────

export interface AlpacaAccount {
  status: string
  equity: number
  cash: number
  buying_power: number
  day_trade_count: number
  options_approved_level: number
  pattern_day_trader: boolean
  currency: string
}

export interface AlpacaPosition {
  symbol: string
  qty: number
  side: string
  avg_entry: number
  current_price: number
  market_value: number
  unrealized_pl: number
  unrealized_plpc: number
  asset_class: string
}

export interface AlpacaOrder {
  id: string
  client_order_id: string
  symbol: string
  status: string
  side: string
  qty: string
  filled_qty: string
  order_type: string
  filled_avg_price: string | null
  submitted_at: string
  filled_at: string | null
  legs: object[]
  strategy: string
}

export const getTradingStatus = async (email: string): Promise<{
  configured: boolean
  message?: string
  account?: AlpacaAccount
  /** Present when keys are set but Alpaca API returned an error (401, wrong endpoint, etc.) */
  alpaca_error?: string
}> => {
  const { data } = await api.get('/trading/status', { params: { email } })
  return data
}

export const getTradingPositions = async (email: string): Promise<AlpacaPosition[]> => {
  const { data } = await api.get('/trading/positions', { params: { email } })
  return data.positions ?? []
}

export const getTradingOrders = async (email: string, status = 'all'): Promise<AlpacaOrder[]> => {
  const { data } = await api.get('/trading/orders', { params: { email, status } })
  return data.orders ?? []
}

export const executeTrade = async (params: {
  email: string; ticker: string; strategy: string; legs: object[]; contracts: number
}): Promise<{ ok: boolean; order_id: string; status: string; symbol: string }> => {
  const { data } = await api.post('/trading/execute', params)
  return data
}

export const cancelTradingOrder = async (email: string, order_id: string): Promise<void> => {
  await api.post('/trading/cancel', { email, order_id })
}

export const closeTradingPosition = async (email: string, symbol: string): Promise<void> => {
  await api.post('/trading/close', { email, symbol })
}

// ─── TradeDesk API ────────────────────────────────────────────────────────────

export interface DeskWatchlistItem {
  id?: number
  ticker: string
  trade_type: string
  sort_order?: number
  added_at?: string
}

export interface DeskTradeLog {
  id: string
  user_id: string
  ticker: string
  trade_type: string
  signal_given: string
  confidence_score: number
  planned_entry?: number | null
  planned_t1?: number | null
  planned_t2?: number | null
  planned_stop?: number | null
  structure: string
  actual_entry?: number | null
  contracts: number
  entry_time?: string | null
  exit_price?: number | null
  exit_time?: string | null
  exit_reason: string
  followed_plan: string
  outcome: string
  pnl_estimate?: number | null
  notes: string
  logged_at: string
  updated_at: string
}

export interface DeskTradeStats {
  total: number
  wins: number
  losses: number
  open_count: number
  win_rate: number
  avg_rr: number
  followed_plan_pct: number
}

export interface DeskAlert {
  id: string
  user_id: string
  ticker: string
  trade_type: string
  alert_type: string
  threshold_value?: number | null
  target_signal: string
  notify_method: string
  expires: string
  is_active: number
  fired_at?: string | null
  fired_value?: number | null
  action_taken: string
  created_at: string
}

export interface DeskTradeCreate {
  ticker: string
  trade_type?: string
  signal_given?: string
  confidence_score?: number
  planned_entry?: number | null
  planned_t1?: number | null
  planned_t2?: number | null
  planned_stop?: number | null
  structure?: string
  actual_entry?: number | null
  contracts?: number
  entry_time?: string | null
  notes?: string
}

export interface DeskTradeUpdate {
  actual_entry?: number | null
  contracts?: number
  entry_time?: string | null
  exit_price?: number | null
  exit_time?: string | null
  exit_reason?: string
  followed_plan?: string
  outcome?: string
  pnl_estimate?: number | null
  notes?: string
  planned_entry?: number | null
  planned_t1?: number | null
  planned_t2?: number | null
  planned_stop?: number | null
  structure?: string
}

export interface DeskAlertCreate {
  ticker: string
  trade_type?: string
  alert_type: string
  threshold_value?: number | null
  target_signal?: string
  notify_method?: string
  expires?: string
}

export const deskApi = {
  // Watchlist
  getWatchlist: async (): Promise<DeskWatchlistItem[]> => {
    const { data } = await api.get<DeskWatchlistItem[]>('/desk/watchlist')
    return data
  },
  addToWatchlist: async (ticker: string, trade_type = 'day'): Promise<DeskWatchlistItem> => {
    const { data } = await api.post<DeskWatchlistItem>('/desk/watchlist', { ticker, trade_type })
    return data
  },
  removeFromWatchlist: async (ticker: string, trade_type = 'day'): Promise<void> => {
    await api.delete(`/desk/watchlist/${encodeURIComponent(ticker)}`, { params: { trade_type } })
  },

  // Analysis
  getAnalysis: async (ticker: string, trade_type = 'day'): Promise<DayTradeScanResult & SwingTradeScanResult & { trade_type: string }> => {
    const { data } = await api.get(`/desk/analysis/${encodeURIComponent(ticker)}`, { params: { trade_type } })
    return data
  },

  // Trade Log
  getTrades: async (filters?: { trade_type?: string; outcome?: string; ticker?: string }): Promise<DeskTradeLog[]> => {
    const { data } = await api.get<DeskTradeLog[]>('/desk/trades', { params: filters })
    return data
  },
  getOpenTrades: async (): Promise<DeskTradeLog[]> => {
    const { data } = await api.get<DeskTradeLog[]>('/desk/trades/open')
    return data
  },
  getTradeStats: async (days = 30): Promise<DeskTradeStats> => {
    const { data } = await api.get<DeskTradeStats>('/desk/trades/stats', { params: { days } })
    return data
  },
  createTrade: async (body: DeskTradeCreate): Promise<DeskTradeLog> => {
    const { data } = await api.post<DeskTradeLog>('/desk/trades', body)
    return data
  },
  updateTrade: async (id: string, body: DeskTradeUpdate): Promise<DeskTradeLog> => {
    const { data } = await api.patch<DeskTradeLog>(`/desk/trades/${encodeURIComponent(id)}`, body)
    return data
  },
  deleteTrade: async (id: string): Promise<void> => {
    await api.delete(`/desk/trades/${encodeURIComponent(id)}`)
  },

  // Alerts
  getAlerts: async (active_only = true): Promise<DeskAlert[]> => {
    const { data } = await api.get<DeskAlert[]>('/desk/alerts', { params: { active_only } })
    return data
  },
  getAlertHistory: async (): Promise<DeskAlert[]> => {
    const { data } = await api.get<DeskAlert[]>('/desk/alerts/history')
    return data
  },
  getAlertCount: async (): Promise<number> => {
    const { data } = await api.get<{ count: number }>('/desk/alerts/count')
    return data.count
  },
  createAlert: async (body: DeskAlertCreate): Promise<DeskAlert> => {
    const { data } = await api.post<DeskAlert>('/desk/alerts', body)
    return data
  },
  deleteAlert: async (id: string): Promise<void> => {
    await api.delete(`/desk/alerts/${encodeURIComponent(id)}`)
  },
  fireAlert: async (id: string, fired_value?: number, action_taken = ''): Promise<void> => {
    await api.patch(`/desk/alerts/${encodeURIComponent(id)}/fire`, null, {
      params: { fired_value, action_taken },
    })
  },
}
