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

export const deleteJournalEntry = async (email: string, id: string): Promise<void> => {
  await api.delete(`/journal/${encodeURIComponent(email)}/${id}`)
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
