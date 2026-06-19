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
  vwap_upper1?: number
  vwap_lower1?: number
  vwap_upper2?: number
  vwap_lower2?: number
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
  /** Entry gate validation — enriched with per-entry R/R */
  entry_gate?: {
    valid: boolean
    trigger_price: number
    trigger_condition: string
    rvol_required: number
    candle_required: 'rejection' | 'bounce' | 'breakout' | 'none'
    // per-entry fields
    risk_reward?: number
    risk_reward_t2?: number
    target?: number
    target_2?: number
    stop?: number
    verdict?: string
    extended_reason?: string
    sigma_distance?: number | null
  }
  /** Trade levels with per-entry R/R */
  trade?: {
    direction: 'PUT' | 'CALL' | 'NONE'
    entry_price: number
    target?: number
    target_2?: number
    stop: number
    risk_reward: number
    risk_reward_t2?: number
    r_r_valid: boolean
    verdict?: string
    extended_reason?: string
    sigma_distance?: number | null
  }
  /** Per-entry R/R for OR breakout level (E3) */
  or_breakout_rr?: {
    verdict?: string
    risk_reward?: number
    risk_reward_t2?: number
    target?: number
    target_2?: number
    stop?: number
    sigma_distance?: number | null
  }
  /** Per-entry R/R for VWAP retest (E4 pending) */
  vwap_retest_rr?: {
    verdict?: string
    risk_reward?: number
    risk_reward_t2?: number
    target?: number
    target_2?: number
    stop?: number
    sigma_distance?: number | null
  }
  /** Pullback Reset — dynamic E4 when extended price returns to VWAP */
  pullback_entry?: {
    detected?: boolean
    setup_type?: string
    direction?: string
    label?: string
    entry_price?: number
    stop?: number
    target_1?: number
    target_2?: number
    rr_t1?: number
    vwap?: number
    bar_index?: number
    bar_timestamp?: string
    reclaim_pattern?: string
    confidence?: string
    recommended_size_pct?: number
    reason?: string
  } | null
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
  /** True when the setup fired earlier but price has extended beyond a valid entry window. */
  is_chasing?: boolean
}

export interface OptionChainRow {
  strike: number
  bid: number
  ask: number
  mid: number
  spread: number
  spread_pct: number
  volume: number
  open_interest: number
  iv: number
  in_the_money: boolean
  is_atm: boolean
}

export interface OptionChainLiquidityResponse {
  ticker: string
  current_price: number
  expiries: string[]
  selected_expiry: string
  dte: number | null
  calls: OptionChainRow[]
  puts: OptionChainRow[]
}

export const fetchOptionChainLiquidity = async (
  ticker: string,
  expiry?: string,
): Promise<OptionChainLiquidityResponse> => {
  const params = expiry ? { expiry } : {}
  const { data } = await api.get<OptionChainLiquidityResponse>(`/option-chain/${encodeURIComponent(ticker.trim().toUpperCase())}`, { params })
  return data
}

export const analyzeDayTrade = async (ticker: string, forceRefresh = false): Promise<DayTradeScanResult> => {
  const { data } = await api.post<DayTradeScanResult>('/day-trade', { ticker: ticker.trim(), force_refresh: forceRefresh })
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
  /** Execution-level fields for swing trades */
  entry_guidance?: {
    state: string
    summary: string
    action: string
    avoid: string
    pending_confirmations: string[]
    current_price?: number
    vwap?: number
    price_vs_vwap_pct?: number
    breakout_level?: number
    pullback_zone?: string
    risk_below?: number
    scalp_target?: number
    exit_rules?: Array<{ trigger: string; price: number; action: string; note: string }>
  }
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

export interface ExitSignal {
  ticker: string
  severity: 'critical' | 'warning' | 'info'
  reason: string
  recommended_action: string
  current_price: number
  current_premium: number
  pnl_estimate: number
  code: string
}

export const fetchExitSignals = async (): Promise<ExitSignal[]> => {
  const { data } = await api.get<{ signals: ExitSignal[]; count: number }>('/exit-signals')
  return data.signals ?? []
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

export interface DashboardTickers {
  day: string[]
  swing: string[]
}

export const getDashboardTickers = async (): Promise<DashboardTickers> => {
  const { data } = await api.get<DashboardTickers>('/dashboard-tickers')
  return { day: data.day ?? [], swing: data.swing ?? [] }
}

export const saveDashboardTickers = async (payload: DashboardTickers): Promise<void> => {
  await api.post('/dashboard-tickers', { day: payload.day, swing: payload.swing })
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
  const { data } = await api.get<{ data: { alerts: AlertEntry[] } }>('/alerts')
  return data.data?.alerts ?? []
}

export const scanBackendAlerts = async (email: string): Promise<AlertEntry[]> => {
  const { data } = await api.post<{ data: { alerts: AlertEntry[] } }>('/alerts/scan')
  return data.data?.alerts ?? []
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

// ─── Unified Analysis v2 ─────────────────────────────────────────────────────

export interface UnifiedAnalysis {
  ticker: string
  company: string
  trade_type: 'day' | 'swing' | 'regular'
  price: number
  change_pct: number | null
  verdict: 'STRONG_GO' | 'GO' | 'WATCH' | 'WAIT' | 'AVOID' | 'NO_EDGE'
  verdict_raw: string
  confidence: number
  reason: string
  conditions: Array<{ label: string; type: 'pass' | 'warn' | 'fail' }>
  entry_price: number | null
  entry_description: string
  stop_price: number | null
  stop_description: string
  structure: string
  exit_rows: Array<{
    when: string
    price: string
    action: string
    note?: string
    type: 'none' | 't1' | 't2' | 'stop' | 'time'
  }>
  rr_ratio: string | null
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH'
  rvol: string | null
  coach: string
  spread_entry?: {
    strategy: string
    long_leg: string
    short_leg: string
    long_strike: number
    short_strike: number
    expiry: string
    est_debit: number
    max_gain: number
    max_loss: number
    breakeven: number
    entry_note?: string
  } | null
  spy_price: number | null
  spy_change_pct: number | null
  qqq_price: number | null
  qqq_change_pct: number | null
  vix: number | null
  vix_label: string
  regime: string
  session: string
  psychology: { message: string } | null
  risk_profile: Array<{ type: string; severity: string; message: string }>
  verdict_presentation: {
    status_text: string
    status_color: string
    signal_quality: { score: number; label: string; color: string }
    setup_bar_pct: number
    setup_bar_color: string
    pass_count: number
    warn_count: number
    fail_count: number
  }
  regular_recommendations: Array<{
    rank: number
    strategy: string
    bias: string
    score: number
    max_profit: number
    max_loss: number
    prob_of_profit: number
    expected_value: number
    expiry: string
    dte: number
    legs: Array<{
      action: string
      option_type: string
      strike: number
      expiry: string
      mid_price: number
      delta?: number
      iv?: number
    }>
    exit_plan: any
    warnings: string[]
    rationale: string
    net_credit?: number
    risk_reward_ratio?: number
    passes_rr_filter?: boolean
    passes_liquidity_filter?: boolean
    passes_credit_filter?: boolean
    spread_width?: number
    scores?: {
      total_score: number
      signal_score: number
      structure_score: number
      liquidity_score: number
      iv_fit_score: number
    }
  }>
}

export const analyzeV2 = (
  ticker: string,
  tradeType: 'day' | 'swing' | 'regular',
  options?: {
    weeksOut?: number
    spreadWidth?: number
    strategyMode?: string
  }
) => api.get<UnifiedAnalysis>(
  `/v2/analyze/${encodeURIComponent(ticker)}`,
  {
    params: {
      trade_type: tradeType,
      weeks_out: options?.weeksOut ?? 4,
      spread_width: options?.spreadWidth ?? 5,
      strategy_mode: options?.strategyMode ?? 'all',
    }
  }
)

export const analyzePublic = (
  ticker: string,
  options?: { weeksOut?: number; strategyMode?: string }
) => api.get<UnifiedAnalysis>(
  `/v2/analyze/${encodeURIComponent(ticker)}/public`,
  {
    params: {
      weeks_out: options?.weeksOut ?? 4,
      strategy_mode: options?.strategyMode ?? 'all',
    }
  }
)

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

function _stubVp(verdict: string): UnifiedAnalysis['verdict_presentation'] {
  const color = (verdict === 'enter' || verdict === 'GO' || verdict === 'STRONG_GO') ? '#00A86B'
    : (verdict === 'avoid' || verdict === 'AVOID') ? '#D0312D' : '#D4A017'
  return {
    status_text: verdict.toUpperCase(),
    status_color: color,
    signal_quality: { score: 0, label: 'N/A', color: '#6B7280' },
    setup_bar_pct: 0,
    setup_bar_color: '#6B7280',
    pass_count: 0,
    warn_count: 0,
    fail_count: 0,
  }
}

export function deriveUnifiedFromDayResult(
  result: any
): UnifiedAnalysis {
  const td = result.trader_decision || {}
  const eg = result.entry_guidance || {}
  const m = result.metrics || {}

  // Derive unified verdict: prefer backend verdict field, then infer from suggested_action
  const actionToVerdict: Record<string, string> = {
    'WATCH_LONG_ONLY':       'WATCH',
    'WATCH_PUT_BREAKDOWN':   'WATCH',
    'WAIT_FOR_CONFIRMATION': 'WAIT',
    'NO_TRADE':              'WAIT',
    'AVOID_CALLS':           'AVOID',
    'AVOID_CHASING_PUTS':    'AVOID',
  }

  const rawVerdict = (result.verdict ?? '').toString().toUpperCase().replace(/ /g, '_').replace(/-/g, '_')
  const verdict: UnifiedAnalysis['verdict'] =
    (rawVerdict === 'STRONG_GO' || rawVerdict === 'GO' || rawVerdict === 'WATCH' || rawVerdict === 'WAIT' || rawVerdict === 'AVOID' || rawVerdict === 'NO_EDGE')
      ? rawVerdict as UnifiedAnalysis['verdict']
      : (actionToVerdict[td.suggested_action] as UnifiedAnalysis['verdict'])
        ?? (rawVerdict === 'STRONG_GO' ? 'STRONG_GO' : rawVerdict === 'GO' ? 'GO' : 'WAIT')

  // Extract confidence from dict
  const conf = m.confidence
  const confidence = typeof conf === 'number'
    ? conf
    : conf && typeof conf === 'object'
      ? (() => {
          const labelMap: Record<string,number> = {
            HIGH: 3, STRONG: 3, GOOD: 2,
            MODERATE: 2, NEUTRAL: 2,
            MIXED: 1, MEDIUM: 2, LOW: 1,
            WEAK: 0, POOR: 0,
          }
          const riskMap: Record<string,number> = {
            LOW: 3, MEDIUM: 2, HIGH: 0
          }
          let total = 0
          let max = 0
          for (const [k, v] of
            Object.entries(conf as Record<string,string>)) {
            max += 3
            total += k === 'risk'
              ? (riskMap[String(v).toUpperCase()] ?? 1)
              : (labelMap[String(v).toUpperCase()] ?? 1)
          }
          return max > 0
            ? Math.round(total / max * 100)
            : 0
        })()
      : 0

  const reasons: string[] =
    result.reasons || []

  const conditions = reasons
    .slice(0, 6)
    .map((r: string) => {
      const short = r.split('—')[0]
        .split(':')[0]
        .split('(')[0]
        .trim()
        .split(' ')
        .slice(0, 5)
        .join(' ')
      const lower = r.toLowerCase()
      const type: 'fail' | 'warn' | 'pass' =
        lower.includes('avoid') ||
        lower.includes('weak') ||
        lower.includes('below') ||
        lower.includes('fail')
          ? 'fail'
        : lower.includes('wait') ||
          lower.includes('watch') ||
          lower.includes('caution')
          ? 'warn'
          : 'pass'
      return { label: short, type }
    })
    .filter(c => c.label)

  return {
    ticker: result.ticker,
    company: result.company_name,
    trade_type: 'day',
    price: m.last_price ?? 0,
    change_pct: m.session_change_pct,
    verdict,
    verdict_raw: rawVerdict,
    confidence,
    reason: td.decision_message
      || reasons[0] || '',
    conditions,
    entry_price: eg.entry_price
      || eg.current_price || null,
    entry_description: eg.entry_description
      || '',
    stop_price: eg.stop_price
      || eg.risk_below || null,
    stop_description: m.or_low
      ? `OR Low $${m.or_low}` : '',
    structure: result.option_risk_context
      ?.structure_hint || 'CALL · 1-2 DTE',
    exit_rows: [],
    rr_ratio: m.entry_rr_ratio
      ? `${m.entry_rr_ratio}:1` : null,
    risk_level: 'MEDIUM',
    rvol: m.rvol ? `${m.rvol}x` : null,
    coach: td.decision_message || '',
    spy_price: null,
    spy_change_pct: m.spy_change_pct,
    qqq_price: null,
    qqq_change_pct: m.qqq_change_pct,
    vix: m.vix,
    vix_label: m.vix < 15 ? 'Low'
      : m.vix < 20 ? 'Contained'
      : m.vix < 25 ? 'Elevated' : 'High',
    regime: 'NEUTRAL MARKET',
    session: m.session_phase || '',
    psychology: m.psychology || null,
    risk_profile: m.risk_profile || [],
    regular_recommendations: [],
    verdict_presentation: _stubVp(verdict),
  }
}

export function deriveUnifiedFromSwingResult(
  result: any
): UnifiedAnalysis {
  const m = result.metrics || {}
  const exec = m.exec_levels || {}

  const swingRawVerdict = (result.verdict ?? '').toString().toUpperCase().replace(/ /g, '_').replace(/-/g, '_')
  const swingVerdictMap: Record<string, UnifiedAnalysis['verdict']> = {
    'STRONG_GO': 'STRONG_GO',
    'GO':        'GO',
    'WATCH':     'WATCH',
    'WAIT':      'WAIT',
    'NO_GO':     'AVOID',
    'AVOID':     'AVOID',
  }

  const verdict: UnifiedAnalysis['verdict'] = swingVerdictMap[swingRawVerdict] ?? 'WAIT'

  const conf = m.confidence
  // same confidence extraction as above

  return {
    ticker: result.ticker,
    company: result.company_name,
    trade_type: 'swing',
    price: m.last_price ?? 0,
    change_pct: m.momentum_5d_pct,
    verdict,
    verdict_raw: swingRawVerdict,
    confidence: 0, // compute same way
    reason: result.decision_message || '',
    conditions: (result.reasons || [])
      .slice(0, 6)
      .map((r: string) => ({
        label: r.split('—')[0]
          .split(':')[0].trim()
          .split(' ').slice(0,5).join(' '),
        type: 'pass' as const
      })),
    entry_price: exec.entry ?? null,
    entry_description:
      exec.entry_description || '',
    stop_price: exec.stop ?? null,
    stop_description: m.ma20
      ? `MA20 $${m.ma20}` : '',
    structure: result.suggested_strategy
      || 'See analysis',
    exit_rows: [],
    rr_ratio: null,
    risk_level: result.risk_level
      || 'MEDIUM',
    rvol: null,
    coach: result.playbook_hint
      || result.decision_message || '',
    spy_price: null,
    spy_change_pct: null,
    qqq_price: null,
    qqq_change_pct: null,
    vix: m.vix,
    vix_label: 'Contained',
    regime: m.market_context || 'NEUTRAL',
    session: 'swing',
    psychology: m.psychology || null,
    risk_profile: m.risk_profile || [],
    regular_recommendations: [],
    verdict_presentation: _stubVp(verdict),
  }
}