import axios from 'axios'
import type { AlertEmailItem, AlertEntry, AnalyzeResponse, DayTradeAlertEvent, PortfolioPosition, StrategyMode, UserDataState, WatchlistItem } from '../types'
import { API_OPERATION_BY_ID, type ApiOperationId, type ApiSchemas } from './generated/openapi-types'

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

export function generatedApiPath(
  operationId: ApiOperationId,
  pathParams: Record<string, string | number> = {},
): string {
  const operation = API_OPERATION_BY_ID[operationId]
  let path: string = operation.path
  if (!path.startsWith('/api/')) {
    throw new Error(`Generated operation ${operationId} is outside the /api client base path`)
  }
  path = path.slice('/api'.length)
  for (const [key, rawValue] of Object.entries(pathParams)) {
    path = path.replace(`{${key}}`, encodeURIComponent(String(rawValue)))
  }
  return path
}

const VAULT_OPERATION_IDS = {
  metricDefinitions: 'metric_definitions_api_v1_metric_definitions_get',
  calculationRunTypes: 'calculation_run_types_api_v1_calculation_run_types_get',
  createCalculationRun: 'create_calculation_run_v1_api_v1_calculation_runs_post',
  calculationRuns: 'calculation_runs_api_v1_calculation_runs_get',
  calculationRun: 'calculation_run_api_v1_calculation_runs__run_id__get',
  calculationSnapshot: 'calculation_snapshot_api_v1_calculation_snapshots__snapshot_id__get',
  calculationSnapshotIntegrity: 'calculation_snapshot_integrity_api_v1_calculation_snapshots__snapshot_id__integrity_get',
  calculationSnapshotAuditLog: 'calculation_snapshot_audit_log_api_v1_calculation_snapshots__snapshot_id__audit_log_get',
} as const satisfies Record<string, ApiOperationId>

const CLIENT_OPERATION_IDS = {
  authLogin: 'auth_login_api_auth_login_post',
  authRegister: 'auth_register_api_auth_register_post',
  authGoogle: 'auth_google_api_auth_google_post',
  authActivate: 'auth_activate_api_auth_activate_get',
  authForgotPassword: 'auth_forgot_password_api_auth_forgot_password_post',
  authResetPassword: 'auth_reset_password_api_auth_reset_password_post',
  analyze: 'analyze_api_analyze_post',
  optionChainLiquidity: 'option_chain_liquidity_api_option_chain__ticker__get',
  dayTradeScan: 'day_trade_scan_api_day_trade_post',
  dayTradeWorkspace: 'day_trade_workspace_api_day_trade_workspace_get',
  carryTradeScan: 'carry_trade_scan_api_carry_trade_post',
  tradeDashboardStory: 'trade_dashboard_story_api_trade_dashboard_story_post',
  swingTradeScan: 'swing_trade_scan_api_swing_trade_post',
  investmentThesisStarter: 'investment_thesis_starter_api_investment_thesis_starter__ticker__get',
  activeTrades: 'active_trades_list_api_trades_active_get',
  activeTradeEnter: 'active_trade_enter_api_trades_enter_post',
  activeTradeExit: 'active_trade_exit_api_api_trades__trade_id__exit_post',
  exitSignals: 'exit_signals_api_exit_signals_get',
  acknowledgeExitSignal: 'acknowledge_exit_signal_api_exit_signals_acknowledge_post',
  dayTradeAlerts: 'list_day_trade_alerts_api_api_day_trade_alerts__email__get',
  userData: 'get_user_data_api_user_data__email__get',
  saveUserData: 'save_user_data_api_user_data__email__put',
  dashboardTickers: 'api_get_dashboard_tickers_api_dashboard_tickers_get',
  saveDashboardTickers: 'api_save_dashboard_tickers_api_dashboard_tickers_post',
  unifiedAnalyze: 'unified_analyze_api_v2_analyze__ticker__get',
  unifiedAnalyzePublic: 'unified_analyze_public_api_v2_analyze__ticker__public_get',
  clearCache: 'clear_all_caches_api_cache_clear_post',
  getUserAccent: 'get_user_accent_api_user_accent_get',
  setUserAccent: 'set_user_accent_api_user_accent_put',
  sendTestEmail: 'send_test_email_api_test_email_post',
  emailStatus: 'email_status_api_email_status_get',
  alertCenter: 'list_alerts_center_api_alerts_get',
  alertScan: 'scan_alerts_center_api_alerts_scan_post',
  deskWatchlist: 'get_watchlist_api_desk_watchlist_get',
  deskAddWatchlist: 'add_to_watchlist_api_desk_watchlist_post',
  deskRemoveWatchlist: 'remove_from_watchlist_api_desk_watchlist__ticker__delete',
  deskAnalysis: 'get_analysis_api_desk_analysis__ticker__get',
  deskTrades: 'list_trades_api_desk_trades_get',
  deskOpenTrades: 'list_open_trades_api_desk_trades_open_get',
  deskTradeStats: 'get_trade_stats_api_desk_trades_stats_get',
  deskCreateTrade: 'create_trade_api_desk_trades_post',
  deskUpdateTrade: 'update_trade_api_desk_trades__trade_id__patch',
  deskDeleteTrade: 'delete_trade_api_desk_trades__trade_id__delete',
  deskAlerts: 'list_alerts_api_desk_alerts_get',
  deskAlertHistory: 'alert_history_api_desk_alerts_history_get',
  deskAlertCount: 'alert_count_api_desk_alerts_count_get',
  deskCreateAlert: 'create_alert_api_desk_alerts_post',
  deskDeleteAlert: 'delete_alert_api_desk_alerts__alert_id__delete',
  deskFireAlert: 'fire_alert_api_desk_alerts__alert_id__fire_patch',
  sendAlertEmail: 'send_alert_api_send_alert_post',
  backtest: 'backtest_strategy_api_backtest_post',
  journalSave: 'journal_save_api_journal_save_post',
  journalList: 'journal_list_api_journal__email__get',
  journalRefresh: 'journal_refresh_api_journal_refresh__email__post',
  journalClose: 'journal_close_api_journal__email___entry_id__close_patch',
  journalNotes: 'journal_notes_api_journal__email___entry_id__notes_patch',
  journalUpdate: 'journal_update_api_journal__email___entry_id__update_patch',
  journalDelete: 'journal_delete_api_journal__email___entry_id__delete',
  eodJournalSave: 'eod_journal_save_snapshot_api_eod_journal__email__snapshot_post',
  eodJournalDates: 'eod_journal_dates_api_eod_journal__email__dates_get',
  eodJournalSnapshot: 'eod_journal_get_snapshot_api_eod_journal__email__snapshot__mode___date_key___ticker__get',
  tradeIdeas: 'list_trade_ideas_api_trade_ideas__email__get',
  tradeIdeaCreate: 'create_trade_idea_api_trade_ideas__email__post',
  tradeIdeaUpdate: 'patch_trade_idea_api_trade_ideas__email___idea_id__patch',
  tradeIdeaDelete: 'delete_trade_idea_endpoint_api_trade_ideas__email___idea_id__delete',
  tradingStatus: 'trading_status_api_trading_status_get',
  tradingPositions: 'trading_positions_api_trading_positions_get',
  tradingOrders: 'trading_orders_api_trading_orders_get',
  tradingExecute: 'trading_execute_api_trading_execute_post',
  tradingCancel: 'trading_cancel_api_trading_cancel_post',
  tradingClose: 'trading_close_position_api_trading_close_post',
} as const satisfies Record<string, ApiOperationId>

export type AuthLoginResponse = ApiSchemas['AuthSessionResponse']
export type AuthRegisterResponse = ApiSchemas['AuthRegisterResponse']
export type AuthActivateResponse = ApiSchemas['AuthActivateResponse']
export type AuthForgotPasswordResponse = ApiSchemas['AuthForgotPasswordResponse']
export type AuthResetPasswordResponse = ApiSchemas['AuthResetPasswordResponse']

export const authLogin = async (email: string, password: string): Promise<AuthLoginResponse> => {
  const body: ApiSchemas['LoginRequest'] = { email, password }
  const { data } = await api.post<AuthLoginResponse>(generatedApiPath(CLIENT_OPERATION_IDS.authLogin), body)
  return data
}

export const authRegister = async (payload: {
  email: string
  password: string
  name?: string
}): Promise<AuthRegisterResponse> => {
  const body: ApiSchemas['RegisterRequest'] = payload
  const { data } = await api.post<AuthRegisterResponse>(generatedApiPath(CLIENT_OPERATION_IDS.authRegister), body)
  return data
}

export const authGoogle = async (credential: string): Promise<AuthLoginResponse> => {
  const body: ApiSchemas['GoogleAuthRequest'] = { credential }
  const { data } = await api.post<AuthLoginResponse>(generatedApiPath(CLIENT_OPERATION_IDS.authGoogle), body)
  return data
}

export const authActivate = async (
  token: string,
): Promise<AuthActivateResponse> => {
  const { data } = await api.get<AuthActivateResponse>(generatedApiPath(CLIENT_OPERATION_IDS.authActivate), { params: { token } })
  return data
}

export const authForgotPassword = async (
  email: string,
): Promise<AuthForgotPasswordResponse> => {
  const body: ApiSchemas['ForgotPasswordRequest'] = { email }
  const { data } = await api.post<AuthForgotPasswordResponse>(generatedApiPath(CLIENT_OPERATION_IDS.authForgotPassword), body)
  return data
}

export const authResetPassword = async (
  token: string,
  password: string,
): Promise<AuthResetPasswordResponse> => {
  const body: ApiSchemas['ResetPasswordRequest'] = { token, password }
  const { data } = await api.post<AuthResetPasswordResponse>(generatedApiPath(CLIENT_OPERATION_IDS.authResetPassword), body)
  return data
}

export const analyzeOptions = async (
  ticker: string,
  weeksOut: number,
  spreadWidth?: number | null,
  strategyMode: StrategyMode = 'all',
  chainExpiry?: string | null,
): Promise<AnalyzeResponse> => {
  const payload: ApiSchemas['AnalyzeRequest'] = {
    ticker,
    weeks_out: weeksOut,
    spread_width: spreadWidth ?? null,
    strategy_mode: strategyMode,
    ...(chainExpiry?.trim() ? { chain_expiry: chainExpiry.trim().slice(0, 10) } : {}),
  }
  const { data } = await api.post<AnalyzeResponse>(generatedApiPath(CLIENT_OPERATION_IDS.analyze), payload)
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
  ema50?: number
  ema150?: number
  stoch5?: number
  trend_confirmation?: number
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
  timeframe_state?: {
    setup_15m?: {
      status: string
      direction: string | null
      reason: string
      next_action: string
      key_levels: Record<string, number | null>
    }
    confirmation_5m?: {
      status: string
      direction: string | null
      trigger_requirement: string
      trigger_fired: boolean
      candle_checks: Array<Record<string, unknown>>
      volume_confirmed: boolean
      reason: string
      next_action: string
    }
    execution_1m?: {
      status: string
      entry_zone?: string | number | null
      stop_level?: number | null
      chase_warning?: string
      reason: string
      next_action: string
    }
    final_decision?: string
    bias?: string
    blocker?: string
    final_action?: string
    required_next_condition?: string
  }
  layered_decision?: Record<string, unknown>
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
    layered_decision?: Record<string, unknown>
    orh_breakout_lifecycle?: {
      state?: string
      signal?: string | null
      signal_label?: string | null
      action?: string
      status_message?: string
      reason?: string
      invalidates?: string
      stop_level?: number | null
      t1?: number | null
      t2?: number | null
      risk_reward?: number | null
      safe?: boolean
      why_safe_or_unsafe?: string
      candles_since_failure?: number | null
      cooldown_active?: boolean
      confirmed_at?: string | null
    }
    signal_explanation?: {
      signal?: string | null
      label?: string | null
      why_triggered?: string
      why_safe_or_unsafe?: string
      invalidates?: string
      stop_level?: number | null
      target_1?: number | null
      target_2?: number | null
      risk_reward?: number | null
    }
    exit_rules?: Array<{ trigger: string; price: number; action: string; note: string }>
  }
  /** Lightweight options execution context — warning-only, not a strategy builder. */
  option_risk_context?: DayOptionRiskContext
  /** Structured AI coaching summary — Anthropic / OpenAI / deterministic fallback. */
  ai_coach?: AiCoachResult
  /** True when the setup fired earlier but price has extended beyond a valid entry window. */
  is_chasing?: boolean
}

export type DayTradeSemanticTone = ApiSchemas['DayTradeDisplayStatus']['tone']
export type DayTradeWorkspaceDisplayValue = ApiSchemas['DayTradeDisplayValue']
export type DayTradeWorkspaceStatus = ApiSchemas['DayTradeDisplayStatus']
export type DayTradeWorkspaceAction = ApiSchemas['DayTradeWorkspaceAction']

type DayTradeWorkspaceChart = Omit<
  ApiSchemas['DayTradeChartView'],
  'candles' | 'defaults' | 'events' | 'levels' | 'marketStructure' | 'tradeFocus' | 'vwapOverlay'
> & {
  candles: ApiSchemas['DayTradeChartCandleView'][]
  levels: ApiSchemas['DayTradeChartLevelView'][]
  events: ApiSchemas['DayTradeChartEventView'][]
  marketStructure?: {
    id: string
    trend: string
    structure: string
    display: string
    sequence: string[]
    currentPivot?: string | null
    expectedNextPivot?: string | null
    invalidationLevel?: number | null
    structureStrength?: number | null
    sourceTimeframe: string
    pivots: Array<{
      id: string
      timestamp: string
      label: string
      classification?: string | null
      pivotType: string
      type?: string | null
      price: number
      sourceTimeframe: string
      timeframe?: string | null
      confirmed: boolean
      status?: string | null
      latest?: boolean
      explanation?: string | null
    }>
    timeframe?: string | null
    confidence?: number | null
    currentPivotDetail?: unknown
    expectedNext?: string | null
    invalidation?: unknown
    settings?: Record<string, unknown> | null
    visibleByDefault: boolean
    showZigZagByDefault: boolean
    explanation?: string | null
  } | null
  vwapOverlay?: (Omit<ApiSchemas['DayTradeVwapOverlayView'], 'points'> & {
    points: ApiSchemas['DayTradeVwapPointView'][]
  }) | null
  defaults: Omit<ApiSchemas['DayTradeChartDefaultsView'], 'visibleOverlayIds'> & {
    visibleOverlayIds: string[]
  }
  tradeFocus?: (Omit<ApiSchemas['DayTradeChartTradeFocusView'], 'levelIdsAllowedToAffectScale'> & {
    levelIdsAllowedToAffectScale: string[]
  }) | null
}

type DayTradeWorkspaceDecision = Omit<ApiSchemas['DayTradeDecisionView'], 'secondaryActions'> & {
  secondaryActions: DayTradeWorkspaceAction[]
}

type DayTradeWorkspaceTrigger = Omit<ApiSchemas['DayTradeTriggerView'], 'requirements'> & {
  requirements: ApiSchemas['DayTradeTriggerRequirementView'][]
}

export type DayTradeWorkspaceResponse = Omit<
  ApiSchemas['DayTradeWorkspaceResponse'],
  'chart' | 'decision' | 'evidence' | 'tabs' | 'trigger'
> & {
  decision: DayTradeWorkspaceDecision
  trigger: DayTradeWorkspaceTrigger
  evidence: ApiSchemas['DayTradeEvidenceItemView'][]
  chart: DayTradeWorkspaceChart
  tabs: Record<string, unknown>
}

export interface DayTradeWorkspaceQuery {
  symbol: string
  sessionDate?: string | null
  interval?: '1m' | '5m' | '15m'
  forceRefresh?: boolean
}

const DAY_TRADE_WORKSPACE_SCHEMA_VERSION = 'day-trade-workspace.v1'

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function readPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((cur, part) => {
    if (!isPlainRecord(cur)) return undefined
    return cur[part]
  }, value)
}

function requireWorkspaceString(value: unknown, path: string, missing: string[]): void {
  if (typeof readPath(value, path) !== 'string') missing.push(path)
}

function requireWorkspaceBoolean(value: unknown, path: string, missing: string[]): void {
  if (typeof readPath(value, path) !== 'boolean') missing.push(path)
}

function requireWorkspaceArray(value: unknown, path: string, missing: string[]): void {
  if (!Array.isArray(readPath(value, path))) missing.push(path)
}

function requireWorkspaceRecord(value: unknown, path: string, missing: string[]): void {
  if (!isPlainRecord(readPath(value, path))) missing.push(path)
}

function validateDayTradeWorkspaceResponse(value: unknown): asserts value is DayTradeWorkspaceResponse {
  const missing: string[] = []
  requireWorkspaceString(value, 'schemaVersion', missing)
  if (isPlainRecord(value) && value.schemaVersion !== DAY_TRADE_WORKSPACE_SCHEMA_VERSION) {
    throw new Error(`Unsupported Day Trade workspace schema: ${String(value.schemaVersion || 'missing')}`)
  }
  requireWorkspaceString(value, 'generatedAt', missing)
  requireWorkspaceString(value, 'symbol.ticker', missing)
  requireWorkspaceString(value, 'symbol.price.display', missing)
  requireWorkspaceString(value, 'symbol.change.display', missing)
  requireWorkspaceString(value, 'session.mode', missing)
  requireWorkspaceString(value, 'session.status.label', missing)
  requireWorkspaceString(value, 'session.status.tone', missing)
  requireWorkspaceString(value, 'session.sessionDate', missing)
  requireWorkspaceString(value, 'session.displayDate', missing)
  requireWorkspaceString(value, 'session.marketTimeZone', missing)
  requireWorkspaceBoolean(value, 'session.isExecutionAllowed', missing)
  requireWorkspaceString(value, 'decision.context.label', missing)
  requireWorkspaceString(value, 'decision.permission.code', missing)
  requireWorkspaceString(value, 'decision.permission.label', missing)
  requireWorkspaceString(value, 'decision.headline', missing)
  requireWorkspaceString(value, 'decision.reason', missing)
  requireWorkspaceString(value, 'decision.primaryAction.label', missing)
  requireWorkspaceBoolean(value, 'decision.primaryAction.enabled', missing)
  requireWorkspaceArray(value, 'decision.secondaryActions', missing)
  requireWorkspaceString(value, 'trigger.status.label', missing)
  requireWorkspaceString(value, 'trigger.summary', missing)
  requireWorkspaceArray(value, 'trigger.requirements', missing)
  requireWorkspaceString(value, 'riskPlan.entry.display', missing)
  requireWorkspaceString(value, 'riskPlan.stop.display', missing)
  requireWorkspaceString(value, 'riskPlan.target1.display', missing)
  requireWorkspaceString(value, 'riskPlan.target2.display', missing)
  requireWorkspaceString(value, 'riskPlan.positionSize.display', missing)
  requireWorkspaceString(value, 'riskPlan.riskReward.display', missing)
  requireWorkspaceArray(value, 'evidence', missing)
  requireWorkspaceArray(value, 'chart.candles', missing)
  requireWorkspaceArray(value, 'chart.levels', missing)
  requireWorkspaceArray(value, 'chart.events', missing)
  const vwapOverlay = readPath(value, 'chart.vwapOverlay')
  if (vwapOverlay !== null && vwapOverlay !== undefined) {
    requireWorkspaceRecord(value, 'chart.vwapOverlay', missing)
    requireWorkspaceString(value, 'chart.vwapOverlay.id', missing)
    requireWorkspaceString(value, 'chart.vwapOverlay.label', missing)
    requireWorkspaceArray(value, 'chart.vwapOverlay.points', missing)
  }
  requireWorkspaceString(value, 'chart.defaults.interval', missing)
  requireWorkspaceString(value, 'chart.defaults.visibleRange', missing)
  requireWorkspaceString(value, 'chart.defaults.scaleMode', missing)
  requireWorkspaceArray(value, 'chart.defaults.visibleOverlayIds', missing)
  requireWorkspaceRecord(value, 'tabs', missing)
  if (missing.length) {
    throw new Error(`Invalid Day Trade workspace response. Missing: ${missing.join(', ')}`)
  }
}

export type OptionChainRow = ApiSchemas['OptionChainLiquidityRow']
export type OptionChainLiquidityResponse = ApiSchemas['OptionChainLiquidityResponse']

export const fetchOptionChainLiquidity = async (
  ticker: string,
  expiry?: string,
  forceRefresh = false,
): Promise<OptionChainLiquidityResponse> => {
  const params = { ...(expiry ? { expiry } : {}), ...(forceRefresh ? { force_refresh: true } : {}) }
  const { data } = await api.get<OptionChainLiquidityResponse>(
    generatedApiPath(CLIENT_OPERATION_IDS.optionChainLiquidity, { ticker: ticker.trim().toUpperCase() }),
    { params },
  )
  return data
}

export type TradeWorksheetSelectedRow = ApiSchemas['TradeWorksheetSelectedRow']
export type TradeWorksheetEvaluateRequest =
  Omit<ApiSchemas['TradeWorksheetEvaluateRequest'], 'selectedRow' | 'selectedLegRows'> & {
    selectedRow?: OptionChainRow | null
    selectedLegRows?: Record<string, OptionChainRow | null> | null
  }
export type MetricDefinition = ApiSchemas['MetricDefinitionOut'] & {
  inputsUsed: string[]
  displayRules: Record<string, unknown>
}
export type MetricDefinitionsResponse =
  Omit<ApiSchemas['MetricDefinitionsResponse'], 'metrics'> & { metrics: MetricDefinition[] }

export interface CalculationSnapshotMetadata {
  runId: string
  snapshotId: string
  engineVersion: string
  formulaPackVersion: string
  metricDefinitionsVersion: string
  inputHash: string
  outputHash: string
  frozenAtMs: number
}

export type CalculationRun = ApiSchemas['CalculationRunResponse']
export type CalculationSnapshot =
  Omit<ApiSchemas['CalculationSnapshotResponse'], 'input' | 'metric_definitions' | 'output'> & {
    input: Record<string, unknown>
    metric_definitions: MetricDefinition[]
    output: Record<string, unknown>
  }
export type CalculationSnapshotIntegrity =
  Omit<ApiSchemas['CalculationSnapshotIntegrityResponse'], 'mismatches'> & { mismatches: string[] }
export type CalculationSnapshotAuditEvent =
  ApiSchemas['CalculationSnapshotAuditEventResponse'] & { event: Record<string, unknown> }
export type CalculationSnapshotAuditLog =
  Omit<ApiSchemas['CalculationSnapshotAuditLogResponse'], 'count' | 'events'> & {
    events: CalculationSnapshotAuditEvent[]
    count: number
  }
export type CalculationRunCreateRequest = ApiSchemas['CalculationRunCreateRequest']

type GeneratedCalculationRunCreateResponse = ApiSchemas['CalculationRunCreateResponse']
export type CalculationRunCreateResponse<T = Record<string, unknown>> =
  Omit<GeneratedCalculationRunCreateResponse, 'result'> & { result: T }

export type CalculationRunsListResponse =
  Omit<ApiSchemas['CalculationRunsListResponse'], 'count' | 'runs'> & {
    runs: CalculationRun[]
    count: number
  }
export type CalculationRunType = ApiSchemas['CalculationRunTypeResponse']
export type CalculationRunTypesResponse =
  Omit<ApiSchemas['CalculationRunTypesResponse'], 'count' | 'runTypes'> & {
    runTypes: CalculationRunType[]
    count: number
  }

export interface TradeWorksheetEvaluation {
  summary: {
    ticker: string
    strategy: string
    primaryStrike: number
    frontExpiration: string
    backExpiration: string
    frontDte: number
    backDte: number
    netPremium: number
    netPremiumType: 'debit' | 'credit' | 'none' | string
    cost: number
    maxRisk: number
    breakeven: number | null
    breakevenLow: number | null
    breakevenHigh: number | null
    capitalRequired: number
    thetaPerDay: number
    delta: number
    ivRank: number
    probability: number
    probabilityItm: number
    riskLevel: string
    timeStopDays: number
    successRequirement: string
    earningsDate: string | null
    earningsDaysUntil: number | null
    earningsBeforeExpiration: boolean
    earningsRisk: string
    earningsMessage: string
  }
  greeks: {
    delta: number
    gamma: number
    theta: number
    vega: number
    iv: number
    probabilityItm: number
    probabilityOtm: number
  }
  score: {
    total: number
    trend: number
    optionPricing: number
    time: number
    liquidity: number
    probability: number
    riskReward: number
    volatility: number
    market: number
    label: string
  }
  payoff: Array<{ price: number; pnl: number }>
  scenario: {
    estimatedValue: number
    estimatedProfit: number
    estimatedRoi: number
    expectedValue: number
    expectedReturn: number
    expectedDrawdown: number
    priceBuckets: Array<{ label: string; value: number }>
    timeBuckets: Array<{ day: number; flatPnl: number; targetPnl: number; scenarioPnl: number }>
  }
  comparisons: Array<{ strategy: string; capital: number; maxLoss: number; maxProfit: number | null; pop: number; theta: string; score: number }>
  bestStrategy: { strategy: string; capital: number; maxLoss: number; maxProfit: number | null; pop: number; theta: string; score: number } | null
  pros: string[]
  cons: string[]
  coach: string[]
  metricDefinitions?: MetricDefinitionsResponse
  calculationSnapshot?: CalculationSnapshotMetadata
}

export const fetchMetricDefinitions = async (): Promise<MetricDefinitionsResponse> => {
  const { data } = await api.get<MetricDefinitionsResponse>(
    generatedApiPath(VAULT_OPERATION_IDS.metricDefinitions),
  )
  return data
}

export const fetchCalculationRunTypes = async (): Promise<CalculationRunTypesResponse> => {
  const { data } = await api.get<CalculationRunTypesResponse>(
    generatedApiPath(VAULT_OPERATION_IDS.calculationRunTypes),
  )
  return data
}

export const createCalculationRun = async <T = Record<string, unknown>>(
  payload: CalculationRunCreateRequest,
): Promise<CalculationRunCreateResponse<T>> => {
  const { data } = await api.post<CalculationRunCreateResponse<T>>(
    generatedApiPath(VAULT_OPERATION_IDS.createCalculationRun),
    payload,
  )
  return data
}

export const fetchCalculationRuns = async (params?: {
  status?: string
  run_type?: string
  limit?: number
}): Promise<CalculationRunsListResponse> => {
  const { data } = await api.get<CalculationRunsListResponse>(
    generatedApiPath(VAULT_OPERATION_IDS.calculationRuns),
    { params },
  )
  return data
}

export const fetchCalculationRun = async (runId: string): Promise<CalculationRun> => {
  const { data } = await api.get<CalculationRun>(
    generatedApiPath(VAULT_OPERATION_IDS.calculationRun, { run_id: runId }),
  )
  return data
}

export const fetchCalculationSnapshot = async (snapshotId: string): Promise<CalculationSnapshot> => {
  const { data } = await api.get<CalculationSnapshot>(
    generatedApiPath(VAULT_OPERATION_IDS.calculationSnapshot, { snapshot_id: snapshotId }),
  )
  return data
}

export const fetchCalculationSnapshotIntegrity = async (snapshotId: string): Promise<CalculationSnapshotIntegrity> => {
  const { data } = await api.get<CalculationSnapshotIntegrity>(
    generatedApiPath(VAULT_OPERATION_IDS.calculationSnapshotIntegrity, { snapshot_id: snapshotId }),
  )
  return data
}

export const fetchCalculationSnapshotAuditLog = async (snapshotId: string): Promise<CalculationSnapshotAuditLog> => {
  const { data } = await api.get<CalculationSnapshotAuditLog>(
    generatedApiPath(VAULT_OPERATION_IDS.calculationSnapshotAuditLog, { snapshot_id: snapshotId }),
  )
  return data
}

export const evaluateTradeWorksheet = async (
  payload: TradeWorksheetEvaluateRequest,
): Promise<TradeWorksheetEvaluation> => {
  const { data } = await api.post<CalculationRunCreateResponse<TradeWorksheetEvaluation>>(
    generatedApiPath(VAULT_OPERATION_IDS.createCalculationRun),
    {
      runType: 'trade_worksheet',
      input: { ...payload },
    },
  )
  return data.result
}

export const analyzeDayTrade = async (ticker: string, forceRefresh = false): Promise<DayTradeScanResult> => {
  const body: ApiSchemas['DayTradeRequest'] = { ticker: ticker.trim(), force_refresh: forceRefresh }
  const { data } = await api.post<DayTradeScanResult>(generatedApiPath(CLIENT_OPERATION_IDS.dayTradeScan), body)
  return data
}

export const fetchDayTradeWorkspace = async (query: DayTradeWorkspaceQuery): Promise<DayTradeWorkspaceResponse> => {
  const params = {
    symbol: query.symbol.trim().toUpperCase(),
    ...(query.sessionDate ? { sessionDate: query.sessionDate } : {}),
    ...(query.interval ? { interval: query.interval } : {}),
    ...(query.forceRefresh ? { force_refresh: true } : {}),
  }
  const { data } = await api.get<unknown>(generatedApiPath(CLIENT_OPERATION_IDS.dayTradeWorkspace), { params })
  validateDayTradeWorkspaceResponse(data)
  return data
}

export interface CarryTradeScanResult {
  ticker: string
  company_name: string
  active_window: boolean
  frozen: boolean
  verdict: 'High Probability Carry' | 'Acceptable Carry' | 'Neutral' | 'Wait' | 'Do Not Carry' | string
  bias: 'LONG CALL' | 'LONG PUT' | 'NO TRADE' | string
  carry_score: number
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | string
  entry_window: string
  expected_hold: string
  recommended_dte: string
  risk: string
  reasons: string[]
  blockers: string[]
  execution_plan: Record<string, unknown>
  exit_plan: Record<string, unknown>
  score_breakdown: Record<string, number>
  metrics: Record<string, unknown>
}

export const analyzeCarryTrade = async (ticker: string, forceRefresh = false): Promise<CarryTradeScanResult> => {
  const body: ApiSchemas['CarryTradeRequest'] = { ticker: ticker.trim(), force_refresh: forceRefresh }
  const { data } = await api.post<CarryTradeScanResult>(generatedApiPath(CLIENT_OPERATION_IDS.carryTradeScan), body)
  return data
}

export interface TradeDashboardStory {
  ticker: string
  company_name: string
  market_story: string
  market_phase: { phase: string; confidence: string; reason: string }
  structure_map: { state: string; sequence: string[]; display: string; pivots: Array<{ label: string; price: number; index: number; kind: string }> }
  opportunity_verdict: {
    verdict: string
    score: number
    breakdown: Record<string, number>
    bias: string
    confidence: string
    main_reason: string
    main_blocker: string
  }
  execution_plan: Record<string, unknown>
  invalidation: { level?: number | null; rules: string[] }
  bias_change: { neutral_if: string[]; opposite_if: string[]; vwap?: number | null }
  position_guidance: Record<string, unknown>
  metrics: Record<string, unknown>
}

export const getTradeDashboardStory = async (ticker: string, forceRefresh = false): Promise<TradeDashboardStory> => {
  const body: ApiSchemas['TradeDashboardStoryRequest'] = { ticker: ticker.trim(), force_refresh: forceRefresh }
  const { data } = await api.post<TradeDashboardStory>(generatedApiPath(CLIENT_OPERATION_IDS.tradeDashboardStory), body)
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
  v?: number | null
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
  const body: ApiSchemas['SwingTradeRequest'] = { ticker: ticker.trim() }
  const { data } = await api.post<SwingTradeScanResult>(generatedApiPath(CLIENT_OPERATION_IDS.swingTradeScan), body)
  return data
}

export interface InvestmentThesisStarter {
  ticker: string
  company_name: string
  current_price: number
  daily_change_pct: number
  sector: string
  industry: string
  market_cap: string
  next_earnings: string
  theme: string
  ai_exposure: boolean
  dividend: boolean
  dividend_yield_pct: number
  rating: number
  conviction_score: number
  target_price: number
  buy_zone: string
  thesis_markdown: string
  summary: string
  quality: {
    businessQuality: number
    management: number
    moat: number
    growth: number
    aiOpportunity: number
    valuation: number
    financialHealth: number
    execution: number
  }
  buy_zones: Array<{ label: string; price: string; reason: string; allocation: string }>
  accumulation_steps: string[]
  catalysts: Array<{ title: string; description: string; impact: 'Positive' | 'Neutral' | 'Negative' }>
  risks: Array<{ title: string; severity: 'Low' | 'Medium' | 'High'; probability: 'Low' | 'Medium' | 'High'; notes: string }>
  trading_signals: { dayTrade: 'Bullish' | 'Neutral' | 'Bearish'; swingTrade: 'Bullish' | 'Neutral' | 'Bearish' }
  how_to_invest: string
}

export const generateInvestmentThesisStarter = async (ticker: string): Promise<InvestmentThesisStarter> => {
  const { data } = await api.get<InvestmentThesisStarter>(
    generatedApiPath(CLIENT_OPERATION_IDS.investmentThesisStarter, { ticker: ticker.trim().toUpperCase() }),
  )
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
  const { data } = await api.get<ActiveTradeListResult>(generatedApiPath(CLIENT_OPERATION_IDS.activeTrades))
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
  const { data } = await api.get<{ signals: ExitSignal[]; count: number }>(generatedApiPath(CLIENT_OPERATION_IDS.exitSignals))
  return data.signals ?? []
}

export const acknowledgeExitSignal = async (ticker: string, code: string): Promise<void> => {
  const body: ApiSchemas['ExitSignalAckBody'] = { ticker, code }
  await api.post(generatedApiPath(CLIENT_OPERATION_IDS.acknowledgeExitSignal), body)
}

export const enterActiveTrade = async (body: ApiSchemas['ActiveTradeEnterRequest'] & {
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
  const { data } = await api.post(generatedApiPath(CLIENT_OPERATION_IDS.activeTradeEnter), body)
  return data
}

export const exitActiveTrade = async (tradeId: string): Promise<void> => {
  await api.post(generatedApiPath(CLIENT_OPERATION_IDS.activeTradeExit, { trade_id: tradeId }))
}

export const getDayTradeAlerts = async (email: string): Promise<DayTradeAlertEvent[]> => {
  const { data } = await api.get<{ email: string; alerts: DayTradeAlertEvent[] }>(
    generatedApiPath(CLIENT_OPERATION_IDS.dayTradeAlerts, { email }),
  )
  return data.alerts
}

export const getUserData = async (email: string): Promise<UserDataState> => {
  const { data } = await api.get<UserDataState>(generatedApiPath(CLIENT_OPERATION_IDS.userData, { email }))
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
  const body: ApiSchemas['AlertEmailRequest'] = { email, user_name: userName, alerts: payload }
  const { data } = await api.post(generatedApiPath(CLIENT_OPERATION_IDS.sendAlertEmail), body)
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
  const { data } = await api.post(generatedApiPath(CLIENT_OPERATION_IDS.clearCache))
  return data.data || data
}

export const getUserAccent = async (): Promise<string> => {
  const { data } = await api.get(generatedApiPath(CLIENT_OPERATION_IDS.getUserAccent))
  return data.accent || 'emerald'
}

export const setUserAccent = async (accent: string): Promise<void> => {
  await api.put(generatedApiPath(CLIENT_OPERATION_IDS.setUserAccent), { accent })
}

export interface DashboardTickers {
  day: string[]
  swing: string[]
}

export const getDashboardTickers = async (): Promise<DashboardTickers> => {
  const { data } = await api.get<DashboardTickers>(generatedApiPath(CLIENT_OPERATION_IDS.dashboardTickers))
  return { day: data.day ?? [], swing: data.swing ?? [] }
}

export const saveDashboardTickers = async (payload: DashboardTickers): Promise<void> => {
  await api.post(generatedApiPath(CLIENT_OPERATION_IDS.saveDashboardTickers), { day: payload.day, swing: payload.swing })
}

export const sendTestEmail = async (
  email: string,
  userName?: string,
): Promise<{ sent: boolean; message: string }> => {
  const body: ApiSchemas['TestEmailRequest'] = { email, user_name: userName }
  const { data } = await api.post(generatedApiPath(CLIENT_OPERATION_IDS.sendTestEmail), body)
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
  const { data } = await api.get(generatedApiPath(CLIENT_OPERATION_IDS.emailStatus))
  return data
}

export const getAlerts = async (email: string): Promise<AlertEntry[]> => {
  const { data } = await api.get<{ data: { alerts: AlertEntry[] } }>(generatedApiPath(CLIENT_OPERATION_IDS.alertCenter))
  return data.data?.alerts ?? []
}

export const scanBackendAlerts = async (email: string): Promise<AlertEntry[]> => {
  const { data } = await api.post<{ data: { alerts: AlertEntry[] } }>(generatedApiPath(CLIENT_OPERATION_IDS.alertScan))
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
  const body: ApiSchemas['UserDataRequest'] = {
    watchlist: watchlist as unknown as Record<string, unknown>[],
    portfolio: portfolio as unknown as Record<string, unknown>[],
    ...(advisory ? {
      advisory_terms_version: advisory.advisoryTermsVersion,
      advisory_accepted_at: advisory.advisoryAcceptedAt,
    } : {}),
    ...(dayTradeWatchlist !== undefined ? { day_trade_watchlist: dayTradeWatchlist } : {}),
    ...(swingTradeWatchlist !== undefined ? { swing_trade_watchlist: swingTradeWatchlist } : {}),
    ...(alertEmailEnabled !== undefined ? { alert_email_enabled: alertEmailEnabled } : {}),
  }
  const { data } = await api.put<UserDataState>(generatedApiPath(CLIENT_OPERATION_IDS.saveUserData, { email }), body)
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
  const body: ApiSchemas['BacktestRequest'] = params
  const { data } = await api.post(generatedApiPath(CLIENT_OPERATION_IDS.backtest), body)
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
  const body: ApiSchemas['JournalSaveRequest'] = {
    ...payload,
    legs: payload.legs as Record<string, unknown>[],
  }
  const { data } = await api.post(generatedApiPath(CLIENT_OPERATION_IDS.journalSave), body, { params: { email } })
  return data
}

export const getJournal = async (email: string, status = ''): Promise<{ entries: object[] }> => {
  const { data } = await api.get(generatedApiPath(CLIENT_OPERATION_IDS.journalList, { email }), { params: status ? { status } : {} })
  return data
}

export const refreshJournal = async (email: string): Promise<{ entries: object[] }> => {
  const { data } = await api.post(generatedApiPath(CLIENT_OPERATION_IDS.journalRefresh, { email }))
  return data
}

export const closeJournalEntry = async (
  email: string, id: string, exit_reason = 'MANUAL', notes = ''
): Promise<{ outcome: string; realized_pnl: number }> => {
  const body: ApiSchemas['JournalCloseRequest'] = { exit_reason, notes }
  const { data } = await api.patch(
    generatedApiPath(CLIENT_OPERATION_IDS.journalClose, { email, entry_id: id }),
    body,
  )
  return data
}

export const updateJournalNotes = async (email: string, id: string, notes: string): Promise<void> => {
  const body: ApiSchemas['JournalNotesRequest'] = { notes }
  await api.patch(generatedApiPath(CLIENT_OPERATION_IDS.journalNotes, { email, entry_id: id }), body)
}

export const updateJournalEntry = async (
  email: string, id: string, fields: Record<string, unknown>
): Promise<void> => {
  await api.patch(generatedApiPath(CLIENT_OPERATION_IDS.journalUpdate, { email, entry_id: id }), fields as ApiSchemas['JournalUpdateRequest'])
}

export const deleteJournalEntry = async (email: string, id: string): Promise<void> => {
  await api.delete(generatedApiPath(CLIENT_OPERATION_IDS.journalDelete, { email, entry_id: id }))
}

// ─── EOD Journal Snapshots ─────────────────────────────────────────────────

export interface EodJournalSnapshotPayload {
  mode: 'day' | 'swing'
  date: string
  ticker: string
  snapshot: Record<string, unknown>
  notes?: Record<string, unknown>
  checks?: Record<string, unknown>
}

export interface EodJournalSnapshotResponse {
  mode: 'day' | 'swing'
  date: string
  ticker: string
  snapshot: Record<string, unknown>
  notes: Record<string, unknown>
  checks: Record<string, unknown>
  saved_at_ms: number
}

export const saveEodJournalSnapshot = async (
  email: string,
  payload: EodJournalSnapshotPayload,
): Promise<{ ok: boolean; entry: EodJournalSnapshotResponse }> => {
  const body: ApiSchemas['EodJournalSnapshotRequest'] = payload
  const { data } = await api.post(generatedApiPath(CLIENT_OPERATION_IDS.eodJournalSave, { email }), body)
  return data
}

export const getEodJournalDates = async (
  email: string,
  mode: 'day' | 'swing',
  limit = 60,
): Promise<{ dates: string[] }> => {
  const { data } = await api.get(generatedApiPath(CLIENT_OPERATION_IDS.eodJournalDates, { email }), { params: { mode, limit } })
  return data
}

export const getEodJournalSnapshot = async (
  email: string,
  mode: 'day' | 'swing',
  date: string,
  ticker: string,
): Promise<EodJournalSnapshotResponse> => {
  const { data } = await api.get(
    generatedApiPath(CLIENT_OPERATION_IDS.eodJournalSnapshot, { email, mode, date_key: date, ticker }),
  )
  return data
}

// ─── Unified Analysis v2 ─────────────────────────────────────────────────────

export interface UnifiedAnalysis {
  ticker: string
  company: string
  trade_type: 'day' | 'swing' | 'regular'
  price: number
  change_pct: number | null
  verdict: 'STRONG_GO' | 'GO' | 'TRIGGER_PENDING' | 'WATCH' | 'WAIT' | 'AVOID' | 'NO_EDGE'
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
    forceRefresh?: boolean
  }
) => api.get<UnifiedAnalysis>(
  generatedApiPath(CLIENT_OPERATION_IDS.unifiedAnalyze, { ticker }),
  {
    params: {
      trade_type: tradeType,
      weeks_out: options?.weeksOut ?? 4,
      spread_width: options?.spreadWidth ?? 5,
      strategy_mode: options?.strategyMode ?? 'all',
      force_refresh: options?.forceRefresh ?? false,
    }
  }
)

export const analyzePublic = (
  ticker: string,
  options?: { weeksOut?: number; strategyMode?: string }
) => api.get<UnifiedAnalysis>(
  generatedApiPath(CLIENT_OPERATION_IDS.unifiedAnalyzePublic, { ticker }),
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
  const { data } = await api.get(generatedApiPath(CLIENT_OPERATION_IDS.tradeIdeas, { email }))
  return (data.ideas ?? []) as TradeIdea[]
}

export const createTradeIdea = async (
  email: string,
  idea: Omit<TradeIdea, 'id' | 'created_at' | 'updated_at'>,
): Promise<{ id: string }> => {
  const body: ApiSchemas['TradeIdeaCreateRequest'] = idea
  const { data } = await api.post(generatedApiPath(CLIENT_OPERATION_IDS.tradeIdeaCreate, { email }), body)
  return data
}

export const updateTradeIdea = async (
  email: string,
  id: string,
  fields: Partial<Omit<TradeIdea, 'id' | 'ticker' | 'created_at' | 'updated_at'>>,
): Promise<void> => {
  await api.patch(generatedApiPath(CLIENT_OPERATION_IDS.tradeIdeaUpdate, { email, idea_id: id }), fields as ApiSchemas['TradeIdeaUpdateRequest'])
}

export const deleteTradeIdea = async (email: string, id: string): Promise<void> => {
  await api.delete(generatedApiPath(CLIENT_OPERATION_IDS.tradeIdeaDelete, { email, idea_id: id }))
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
  const { data } = await api.get(generatedApiPath(CLIENT_OPERATION_IDS.tradingStatus), { params: { email } })
  return data
}

export const getTradingPositions = async (email: string): Promise<AlpacaPosition[]> => {
  const { data } = await api.get(generatedApiPath(CLIENT_OPERATION_IDS.tradingPositions), { params: { email } })
  return data.positions ?? []
}

export const getTradingOrders = async (email: string, status = 'all'): Promise<AlpacaOrder[]> => {
  const { data } = await api.get(generatedApiPath(CLIENT_OPERATION_IDS.tradingOrders), { params: { email, status } })
  return data.orders ?? []
}

export const executeTrade = async (params: {
  email: string; ticker: string; strategy: string; legs: object[]; contracts: number
}): Promise<{ ok: boolean; order_id: string; status: string; symbol: string }> => {
  const body: ApiSchemas['TradingExecuteRequest'] = {
    ...params,
    legs: params.legs as Record<string, unknown>[],
  }
  const { data } = await api.post(generatedApiPath(CLIENT_OPERATION_IDS.tradingExecute), body)
  return data
}

export const cancelTradingOrder = async (email: string, order_id: string): Promise<void> => {
  const body: ApiSchemas['TradingCancelRequest'] = { email, order_id }
  await api.post(generatedApiPath(CLIENT_OPERATION_IDS.tradingCancel), body)
}

export const closeTradingPosition = async (email: string, symbol: string): Promise<void> => {
  const body: ApiSchemas['TradingCloseRequest'] = { email, symbol }
  await api.post(generatedApiPath(CLIENT_OPERATION_IDS.tradingClose), body)
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
    const { data } = await api.get<DeskWatchlistItem[]>(generatedApiPath(CLIENT_OPERATION_IDS.deskWatchlist))
    return data
  },
  addToWatchlist: async (ticker: string, trade_type = 'day'): Promise<DeskWatchlistItem> => {
    const body: ApiSchemas['WatchlistAddRequest'] = { ticker, trade_type }
    const { data } = await api.post<DeskWatchlistItem>(generatedApiPath(CLIENT_OPERATION_IDS.deskAddWatchlist), body)
    return data
  },
  removeFromWatchlist: async (ticker: string, trade_type = 'day'): Promise<void> => {
    await api.delete(generatedApiPath(CLIENT_OPERATION_IDS.deskRemoveWatchlist, { ticker }), { params: { trade_type } })
  },

  // Analysis
  getAnalysis: async (ticker: string, trade_type = 'day'): Promise<DayTradeScanResult & SwingTradeScanResult & { trade_type: string }> => {
    const { data } = await api.get(generatedApiPath(CLIENT_OPERATION_IDS.deskAnalysis, { ticker }), { params: { trade_type } })
    return data
  },

  // Trade Log
  getTrades: async (filters?: { trade_type?: string; outcome?: string; ticker?: string }): Promise<DeskTradeLog[]> => {
    const { data } = await api.get<DeskTradeLog[]>(generatedApiPath(CLIENT_OPERATION_IDS.deskTrades), { params: filters })
    return data
  },
  getOpenTrades: async (): Promise<DeskTradeLog[]> => {
    const { data } = await api.get<DeskTradeLog[]>(generatedApiPath(CLIENT_OPERATION_IDS.deskOpenTrades))
    return data
  },
  getTradeStats: async (days = 30): Promise<DeskTradeStats> => {
    const { data } = await api.get<DeskTradeStats>(generatedApiPath(CLIENT_OPERATION_IDS.deskTradeStats), { params: { days } })
    return data
  },
  createTrade: async (body: DeskTradeCreate): Promise<DeskTradeLog> => {
    const payload: ApiSchemas['TradeLogCreate'] = body
    const { data } = await api.post<DeskTradeLog>(generatedApiPath(CLIENT_OPERATION_IDS.deskCreateTrade), payload)
    return data
  },
  updateTrade: async (id: string, body: DeskTradeUpdate): Promise<DeskTradeLog> => {
    const payload: ApiSchemas['TradeLogUpdate'] = body
    const { data } = await api.patch<DeskTradeLog>(generatedApiPath(CLIENT_OPERATION_IDS.deskUpdateTrade, { trade_id: id }), payload)
    return data
  },
  deleteTrade: async (id: string): Promise<void> => {
    await api.delete(generatedApiPath(CLIENT_OPERATION_IDS.deskDeleteTrade, { trade_id: id }))
  },

  // Alerts
  getAlerts: async (active_only = true): Promise<DeskAlert[]> => {
    const { data } = await api.get<DeskAlert[]>(generatedApiPath(CLIENT_OPERATION_IDS.deskAlerts), { params: { active_only } })
    return data
  },
  getAlertHistory: async (): Promise<DeskAlert[]> => {
    const { data } = await api.get<DeskAlert[]>(generatedApiPath(CLIENT_OPERATION_IDS.deskAlertHistory))
    return data
  },
  getAlertCount: async (): Promise<number> => {
    const { data } = await api.get<{ count: number }>(generatedApiPath(CLIENT_OPERATION_IDS.deskAlertCount))
    return data.count
  },
  createAlert: async (body: DeskAlertCreate): Promise<DeskAlert> => {
    const payload: ApiSchemas['AlertCreate'] = body
    const { data } = await api.post<DeskAlert>(generatedApiPath(CLIENT_OPERATION_IDS.deskCreateAlert), payload)
    return data
  },
  deleteAlert: async (id: string): Promise<void> => {
    await api.delete(generatedApiPath(CLIENT_OPERATION_IDS.deskDeleteAlert, { alert_id: id }))
  },
  fireAlert: async (id: string, fired_value?: number, action_taken = ''): Promise<void> => {
    await api.patch(generatedApiPath(CLIENT_OPERATION_IDS.deskFireAlert, { alert_id: id }), null, {
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
    (rawVerdict === 'STRONG_GO' || rawVerdict === 'GO' || rawVerdict === 'TRIGGER_PENDING' || rawVerdict === 'WATCH' || rawVerdict === 'WAIT' || rawVerdict === 'AVOID' || rawVerdict === 'NO_EDGE')
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
