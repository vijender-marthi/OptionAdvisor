import axios from 'axios'
import { api, generatedApiPath } from './client'
import type { ApiOperationId, ApiSchemas } from './generated/openapi-types'
import type { AlertCenterPayload, AlertCenterSummaryResponse, ApiEnvelope, TradeCommandCenterPayload, SignalFeedPayload } from '../types/commandCenter'
import type { PortfolioPosition } from '../types'

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'

const COMMAND_CENTER_OPERATION_IDS = {
  tradeCommandCenter: 'get_trade_command_center_api_trade_command_center_get',
  alertCenter: 'list_alerts_center_api_alerts_get',
  alertSummary: 'list_alerts_summary_api_alerts_summary_get',
  acknowledgeAlert: 'post_alert_acknowledge_api_alerts__alert_id__acknowledge_post',
  resolveAlert: 'post_alert_resolve_api_alerts__alert_id__resolve_post',
  clearAlerts: 'post_alerts_clear_api_alerts_clear_post',
  noteAlert: 'post_alert_note_api_alerts__alert_id__note_post',
  marketPosition: 'get_market_position_api_market_position_get',
  portfolioAdd: 'post_portfolio_add_api_portfolio_add_post',
  portfolioUpdate: 'post_portfolio_update_api_portfolio_update_post',
  portfolioRemove: 'post_portfolio_remove_api_portfolio_remove_post',
  portfolioClose: 'post_portfolio_close_api_portfolio_close_post',
  stockTargets: 'get_stock_targets_api_stock_targets_get',
  positionsCenter: 'get_positions_center_api_positions_center_get',
  signalFeed: 'get_signal_feed_api_signal_feed_get',
  signalFeedRefresh: 'refresh_signal_feed_api_signal_feed_refresh_post',
  signalFeedAlert: 'create_signal_feed_alert_api_signal_feed_alerts_post',
  watchlistAdd: 'post_watchlist_add_api_watchlist_add_post',
  watchlistRemove: 'post_watchlist_remove_api_watchlist_remove_post',
  searchTickers: 'search_tickers_api_search_tickers_get',
  myTickers: 'get_my_tickers_api_my_tickers_get',
  myTickerAdd: 'post_my_ticker_api_my_tickers_post',
  myTickerUpdate: 'patch_my_ticker_api_my_tickers__symbol__patch',
  myTickerDelete: 'delete_my_ticker_api_my_tickers__symbol__delete',
  myTickerTypeDelete: 'delete_my_ticker_type_api_my_tickers__symbol__type__trade_type__delete',
  myTickersReorder: 'put_my_tickers_reorder_api_my_tickers_reorder_put',
  premarketBias: 'get_premarket_bias_api_premarket_bias_get',
  earlyEntryTrigger: 'get_early_entry_trigger_api_early_entry_trigger_get',
  trackMode: 'get_track_mode_api_track_mode_get',
  trackModeAdd: 'post_track_mode_add_api_track_mode_add_post',
  trackModeRemove: 'post_track_mode_remove_api_track_mode_remove_post',
} as const satisfies Record<string, ApiOperationId>

/** Accept both `{ data, error, stale, fetched_at }` and a raw inner payload from proxies / older builds. */
function normalizeCommandCenterEnvelope(raw: unknown): ApiEnvelope<Record<string, unknown>> {
  if (raw && typeof raw === 'object' && raw !== null && 'data' in raw && 'fetched_at' in raw) {
    return raw as ApiEnvelope<Record<string, unknown>>
  }
  return {
    data: (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>,
    error: null,
    stale: false,
    fetched_at: new Date().toISOString(),
  }
}

export async function fetchTradeCommandCenter(params: {
  engine?: string
  signal?: string
  direction?: string
  risk?: string
}): Promise<ApiEnvelope<TradeCommandCenterPayload>> {
  if (USE_MOCK) {
    const { tradeCommandCenterEnvelopeMock } = await import('../mocks/trade-command-center.mock')
    return tradeCommandCenterEnvelopeMock
  }
  const { data } = await api.get<unknown>(generatedApiPath(COMMAND_CENTER_OPERATION_IDS.tradeCommandCenter), {
    params: {
      engine: params.engine || undefined,
      signal: params.signal || undefined,
      direction: params.direction || undefined,
      risk: params.risk || undefined,
    },
  })
  return normalizeCommandCenterEnvelope(data) as unknown as ApiEnvelope<TradeCommandCenterPayload>
}

export async function fetchAlertCenterPage(opts: {
  engine_type?: string
  alert_type?: string
  severity?: string
  status?: string
  ticker?: string
  active_only?: boolean
  today_only?: boolean
}): Promise<ApiEnvelope<AlertCenterPayload>> {
  if (USE_MOCK) {
    const { alertCenterEnvelopeMock } = await import('../mocks/alert-center.mock')
    return alertCenterEnvelopeMock
  }
  const { data } = await api.get<ApiEnvelope<AlertCenterPayload>>(generatedApiPath(COMMAND_CENTER_OPERATION_IDS.alertCenter), {
    params: {
      engine_type: opts.engine_type,
      alert_type: opts.alert_type,
      severity: opts.severity,
      status: opts.status,
      ticker: opts.ticker,
      active_only: opts.active_only,
      today_only: opts.today_only,
    },
  })
  return data
}

export async function fetchAlertCenterSummary(): Promise<ApiEnvelope<AlertCenterSummaryResponse>> {
  if (USE_MOCK) {
    return {
      data: {
        active_count: 0,
        items: [],
        by_engine: { day: 0, swing: 0, regular: 0, portfolio: 0, general: 0 },
        by_severity: { critical: 0, warning: 0, info: 0 },
        rules_count: 0,
      },
      error: null,
      stale: false,
      fetched_at: new Date().toISOString(),
    }
  }
  const { data } = await api.get<ApiEnvelope<AlertCenterSummaryResponse>>(generatedApiPath(COMMAND_CENTER_OPERATION_IDS.alertSummary))
  return data
}

export async function acknowledgeAlert(id: string): Promise<ApiEnvelope<{ ok: boolean }>> {
  if (USE_MOCK) {
    return {
      data: { ok: true },
      error: null,
      stale: false,
      fetched_at: new Date().toISOString(),
    }
  }
  const { data } = await api.post<ApiEnvelope<{ ok: boolean }>>(
    generatedApiPath(COMMAND_CENTER_OPERATION_IDS.acknowledgeAlert, { alert_id: id }),
  )
  return data
}

export async function resolveAlert(id: string): Promise<ApiEnvelope<{ ok: boolean }>> {
  if (USE_MOCK) {
    return {
      data: { ok: true },
      error: null,
      stale: false,
      fetched_at: new Date().toISOString(),
    }
  }
  const { data } = await api.post<ApiEnvelope<{ ok: boolean }>>(
    generatedApiPath(COMMAND_CENTER_OPERATION_IDS.resolveAlert, { alert_id: id }),
  )
  return data
}

export async function clearAllAlerts(): Promise<ApiEnvelope<{ ok: boolean; cleared: number }>> {
  if (USE_MOCK) {
    return {
      data: { ok: true, cleared: 0 },
      error: null,
      stale: false,
      fetched_at: new Date().toISOString(),
    }
  }
  const { data } = await api.post<ApiEnvelope<{ ok: boolean; cleared: number }>>(
    generatedApiPath(COMMAND_CENTER_OPERATION_IDS.clearAlerts),
  )
  return data
}

export async function noteAlert(id: string, text: string): Promise<ApiEnvelope<{ ok: boolean }>> {
  if (USE_MOCK) {
    return {
      data: { ok: true },
      error: null,
      stale: false,
      fetched_at: new Date().toISOString(),
    }
  }
  const body: ApiSchemas['AlertNoteBody'] = { text }
  const { data } = await api.post<ApiEnvelope<{ ok: boolean }>>(
    generatedApiPath(COMMAND_CENTER_OPERATION_IDS.noteAlert, { alert_id: id }),
    body,
  )
  return data
}

export interface MarketPositionData {
  spy_price: number
  spy_change_pct?: number | null
  qqq_price?: number | null
  qqq_change_pct?: number | null
  vix?: number | null
  vix_label?: string | null
  ma200: number
  dist_200ma_pct: number
  high_52w: number
  drawdown_pct: number
  position_signal: string
  signal_label: string
  signal_tone: 'green' | 'red' | 'orange' | 'gray'
  bars_used_ma200: number
}

export async function fetchMarketPosition(): Promise<ApiEnvelope<MarketPositionData | null>> {
  if (USE_MOCK) {
    return {
      data: {
        spy_price: 521.45,
        ma200: 478.20,
        dist_200ma_pct: 9.0,
        high_52w: 565.16,
        drawdown_pct: 7.7,
        position_signal: 'NEUTRAL',
        signal_label: 'Normal range — hold steady',
        signal_tone: 'gray',
        bars_used_ma200: 200,
      },
      error: null,
      stale: false,
      fetched_at: new Date().toISOString(),
    }
  }
  const { data } = await api.get<ApiEnvelope<MarketPositionData | null>>(generatedApiPath(COMMAND_CENTER_OPERATION_IDS.marketPosition))
  return data
}

export async function addPortfolioPosition(payload: {
  position: Record<string, unknown>
}): Promise<ApiEnvelope<{ ok: boolean; portfolio: Array<Record<string, unknown>> }>> {
  const body: ApiSchemas['PortfolioAddBody'] = payload
  const { data } = await api.post<ApiEnvelope<{ ok: boolean; portfolio: Array<Record<string, unknown>> }>>(
    generatedApiPath(COMMAND_CENTER_OPERATION_IDS.portfolioAdd),
    body,
  )
  return data
}

export interface ParsedBrokerContractPositionResponse {
  ok: boolean
  position: Omit<PortfolioPosition, 'id' | 'addedAt' | 'status'>
  form: {
    ticker?: string
    tradeSource?: 'day' | 'swing' | 'regular'
    strategy?: string
    expiry?: string
    backExpiry?: string
    contractCount?: string
    entryStockPrice?: string
    legStrikes?: string[]
    legPremiums?: string[]
    notes?: string
  }
  parsed: Record<string, unknown>
}

export async function parseBrokerContractPosition(payload: {
  text: string
  trade_source?: 'day' | 'swing' | 'regular' | 'manual'
}): Promise<ApiEnvelope<ParsedBrokerContractPositionResponse>> {
  try {
    const { data } = await api.post<ApiEnvelope<ParsedBrokerContractPositionResponse>>('/portfolio/parse-contract', payload)
    return data
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const detail = err.response?.data?.detail
      if (typeof detail === 'string') throw new Error(detail)
    }
    throw err
  }
}

export interface StockTargetData {
  ticker:               string
  current_price:        number
  ma20:                 number
  ma50:                 number
  rsi:                  number
  mom_5d:               number
  suggested_target1:    number
  suggested_target2:    number
  suggested_stop_loss:  number
  // ── Additive: 9 EMA early-momentum signal (daily chart) ──
  ema9?:                number | null
  ema9_slope?:          'up' | 'flat' | 'down' | null
  price_vs_ema9?:       'above' | 'at' | 'below' | null
  // ── Additive: Fibonacci swing high / low (daily chart) ──
  fib_swing_high?:      number | null
  fib_swing_high_date?: string | null
  fib_swing_low?:       number | null
  fib_swing_low_date?:  string | null
  fib_direction?:       'up' | 'down' | null
  fib_retracement_levels?: Array<{ level: string; ratio: number; price: number }> | null
  fib_extension_levels?: Array<{ level: string; ratio: number; price: number }> | null
  fib_current_zone?: string | null
  fib_classification?: string | null
  fib_nearest_confluence?: string | null
  fib_structural_invalidation?: number | null
}

export async function fetchStockTargets(
  ticker: string,
  entryPrice?: number,
  fibLookback?: number,
): Promise<StockTargetData> {
  const params = new URLSearchParams({ ticker })
  if (entryPrice && entryPrice > 0) params.set('entry_price', String(entryPrice))
  if (fibLookback && fibLookback > 0) params.set('fib_lookback', String(fibLookback))
  const { data } = await api.get<ApiEnvelope<StockTargetData>>(`${generatedApiPath(COMMAND_CENTER_OPERATION_IDS.stockTargets)}?${params}`)
  if (!data.data) throw new Error('No data returned')
  return data.data
}

export async function updatePortfolioPositionApi(payload: {
  id: string
  data: Record<string, unknown>
}): Promise<ApiEnvelope<{ ok: boolean; portfolio: Array<Record<string, unknown>> }>> {
  const body: ApiSchemas['PortfolioUpdateBody'] = payload
  const { data } = await api.post<ApiEnvelope<{ ok: boolean; portfolio: Array<Record<string, unknown>> }>>(
    generatedApiPath(COMMAND_CENTER_OPERATION_IDS.portfolioUpdate),
    body,
  )
  return data
}

export async function removePortfolioPosition(payload: {
  id: string
}): Promise<ApiEnvelope<{ ok: boolean; portfolio: Array<Record<string, unknown>> }>> {
  const body: ApiSchemas['PortfolioRemoveBody'] = payload
  const { data } = await api.post<ApiEnvelope<{ ok: boolean; portfolio: Array<Record<string, unknown>> }>>(
    generatedApiPath(COMMAND_CENTER_OPERATION_IDS.portfolioRemove),
    body,
  )
  return data
}

export async function closePortfolioPosition(payload: {
  id: string
  contractsToClose?: number
  realized_pnl?: number
  realized_pnl_percent?: number
  exit_price?: number
  exit_debit_credit?: number
  close_date?: string
  exit_reason?: string
  close_notes?: string
  pnl_overridden?: boolean
  pnl_override_reason?: string
}): Promise<ApiEnvelope<{ ok: boolean; portfolio: Array<Record<string, unknown>> }>> {
  const body: ApiSchemas['PortfolioCloseBody'] = payload
  const { data } = await api.post<ApiEnvelope<{ ok: boolean; portfolio: Array<Record<string, unknown>> }>>(
    generatedApiPath(COMMAND_CENTER_OPERATION_IDS.portfolioClose),
    body,
  )
  return data
}

export async function fetchPositionsCenter(): Promise<ApiEnvelope<Record<string, unknown>>> {
  if (USE_MOCK) {
    return normalizeCommandCenterEnvelope({})
  }
  const { data } = await api.get<unknown>(generatedApiPath(COMMAND_CENTER_OPERATION_IDS.positionsCenter))
  return normalizeCommandCenterEnvelope(data)
}

// Retrospective performance analytics + process coaching over the realized book.
// Raw path (baseURL is /api) so it needs no generated-manifest entry.
export async function fetchPositionsPerformance(): Promise<{
  performance: Record<string, unknown>
  coaching: Record<string, unknown>
  edge?: Record<string, unknown>
}> {
  if (USE_MOCK) {
    return { performance: {}, coaching: {}, edge: {} }
  }
  const { data } = await api.get<unknown>('/positions-center/performance')
  const env = normalizeCommandCenterEnvelope(data)
  return env.data as unknown as { performance: Record<string, unknown>; coaching: Record<string, unknown>; edge?: Record<string, unknown> }
}

export async function fetchSignalFeed(params: {
  search?: string
  source?: string
  sort_by?: string
  sort_dir?: 'asc' | 'desc'
  page?: number
  page_size?: number
  /** Pass true only when user explicitly clicks Refresh — not on normal page load */
  refresh?: boolean
}): Promise<ApiEnvelope<SignalFeedPayload>> {
  const { data } = await api.get<unknown>(generatedApiPath(COMMAND_CENTER_OPERATION_IDS.signalFeed), {
    params: {
      search: params.search || undefined,
      source: params.source || undefined,
      sort_by: params.sort_by || undefined,
      sort_dir: params.sort_dir || undefined,
      page: params.page || undefined,
      page_size: params.page_size || undefined,
      refresh: params.refresh ? true : undefined,
    },
  })
  return normalizeCommandCenterEnvelope(data) as unknown as ApiEnvelope<SignalFeedPayload>
}

/** Explicit cache-refresh — only called when user clicks Refresh button */
export async function refreshSignalFeed(): Promise<ApiEnvelope<{
  ok: boolean
  refreshed_tickers: string[]
  cache: { cache_hits: number; cache_misses: number; elapsed_ms: number }
}>> {
  const { data } = await api.post<unknown>(generatedApiPath(COMMAND_CENTER_OPERATION_IDS.signalFeedRefresh))
  return normalizeCommandCenterEnvelope(data) as unknown as ApiEnvelope<{
    ok: boolean
    refreshed_tickers: string[]
    cache: { cache_hits: number; cache_misses: number; elapsed_ms: number }
  }>
}

export async function createSignalFeedAlert(payload: {
  ticker: string
  agreement_state: string
  message?: string
  recommended_action?: string
}): Promise<ApiEnvelope<{ ok: boolean; id: string }>> {
  const body: ApiSchemas['SignalFeedAlertCreateBody'] = payload
  const { data } = await api.post<ApiEnvelope<{ ok: boolean; id: string }>>(
    generatedApiPath(COMMAND_CENTER_OPERATION_IDS.signalFeedAlert),
    body,
  )
  return data
}

export async function addWatchlistTicker(payload: {
  ticker: string
  notes?: string
  source?: string
  watch_reason?: string
  desired_entry?: number | null
}): Promise<ApiEnvelope<{ ok: boolean; watchlist: Array<Record<string, unknown>>; duplicate?: boolean }>> {
  const body: ApiSchemas['WatchlistTickerBody'] = payload
  const { data } = await api.post<ApiEnvelope<{ ok: boolean; watchlist: Array<Record<string, unknown>>; duplicate?: boolean }>>(
    generatedApiPath(COMMAND_CENTER_OPERATION_IDS.watchlistAdd),
    body,
  )
  return data
}

export async function removeWatchlistTicker(payload: {
  ticker: string
}): Promise<ApiEnvelope<{ ok: boolean; watchlist: Array<Record<string, unknown>> }>> {
  const { data } = await api.post<ApiEnvelope<{ ok: boolean; watchlist: Array<Record<string, unknown>> }>>(
    generatedApiPath(COMMAND_CENTER_OPERATION_IDS.watchlistRemove),
    payload,
  )
  return data
}

// ── My Tickers ─────────────────────────────────────────────────────────────────

export interface MyTickerEntry {
  symbol: string
  company_name: string
  added_date: string
  trade_types: string[]
  is_active: boolean
  next_earnings_date?: string
  next_earnings_days?: number | null
  last_earnings_date?: string
  last_price?: number | null
  price_change?: number | null
  price_change_pct?: number | null
  pre_market_price?: number | null
  pre_market_change?: number | null
  pre_market_change_pct?: number | null
  post_market_price?: number | null
  post_market_change?: number | null
  post_market_change_pct?: number | null
}

export interface SearchTickerResult {
  symbol: string
  company: string
  sector: string
}

export async function searchTickers(q: string): Promise<ApiEnvelope<{ results: SearchTickerResult[] }>> {
  const { data } = await api.get<ApiEnvelope<{ results: SearchTickerResult[] }>>(
    generatedApiPath(COMMAND_CENTER_OPERATION_IDS.searchTickers),
    { params: { q } },
  )
  return data
}

export async function fetchMyTickers(): Promise<ApiEnvelope<{ tickers: MyTickerEntry[] }>> {
  const { data } = await api.get<ApiEnvelope<{ tickers: MyTickerEntry[] }>>(
    generatedApiPath(COMMAND_CENTER_OPERATION_IDS.myTickers),
  )
  return data
}

export async function addMyTicker(payload: {
  symbol: string
  company_name?: string
  trade_types: string[]
}): Promise<ApiEnvelope<{ ok: boolean; tickers: MyTickerEntry[] }>> {
  const body: ApiSchemas['MyTickerBody'] = payload
  const { data } = await api.post<ApiEnvelope<{ ok: boolean; tickers: MyTickerEntry[] }>>(
    generatedApiPath(COMMAND_CENTER_OPERATION_IDS.myTickerAdd),
    body,
  )
  return data
}

export async function updateMyTicker(symbol: string, payload: {
  trade_types: string[]
}): Promise<ApiEnvelope<{ ok: boolean; tickers: MyTickerEntry[] }>> {
  const body: ApiSchemas['MyTickerUpdateBody'] = payload
  const { data } = await api.patch<ApiEnvelope<{ ok: boolean; tickers: MyTickerEntry[] }>>(
    generatedApiPath(COMMAND_CENTER_OPERATION_IDS.myTickerUpdate, { symbol }),
    body,
  )
  return data
}

export async function removeMyTicker(symbol: string): Promise<ApiEnvelope<{ ok: boolean; tickers: MyTickerEntry[] }>> {
  const { data } = await api.delete<ApiEnvelope<{ ok: boolean; tickers: MyTickerEntry[] }>>(
    generatedApiPath(COMMAND_CENTER_OPERATION_IDS.myTickerDelete, { symbol }),
  )
  return data
}

export async function removeMyTickerType(symbol: string, tradeType: string): Promise<ApiEnvelope<{ ok: boolean; tickers: MyTickerEntry[] }>> {
  const { data } = await api.delete<ApiEnvelope<{ ok: boolean; tickers: MyTickerEntry[] }>>(
    generatedApiPath(COMMAND_CENTER_OPERATION_IDS.myTickerTypeDelete, { symbol, trade_type: tradeType }),
  )
  return data
}

export async function reorderMyTickers(symbols: string[]): Promise<ApiEnvelope<{ ok: boolean; tickers: MyTickerEntry[] }>> {
  const body: ApiSchemas['MyTickersReorderBody'] = { symbols }
  const { data } = await api.put<ApiEnvelope<{ ok: boolean; tickers: MyTickerEntry[] }>>(
    generatedApiPath(COMMAND_CENTER_OPERATION_IDS.myTickersReorder),
    body,
  )
  return data
}

// ─── Pre-Market Bias (Feature 1) ─────────────────────────────────────────────

export interface PremarketCondition {
  label:  string
  value:  string
  signal: 'bull' | 'bear' | 'neutral'
  score:  number
}

export interface PremarketBiasData {
  bias:           'BULLISH' | 'NEUTRAL' | 'BEARISH'
  score:          number
  confidence:     number   // 1–5
  action:         string
  conditions:     PremarketCondition[]
  is_friday:      boolean
  friday_warning: string | null
  computed_at:    string
}

export async function fetchPremarketBias(
  forceRefresh = false,
): Promise<PremarketBiasData> {
  const params = forceRefresh ? '?force_refresh=true' : ''
  const { data } = await api.get<ApiEnvelope<PremarketBiasData>>(`${generatedApiPath(COMMAND_CENTER_OPERATION_IDS.premarketBias)}${params}`)
  if (!data.data) throw new Error('No premarket bias data')
  return data.data
}

// ─── Early Entry Trigger (Feature 2) ─────────────────────────────────────────

export interface EarlyEntryResult {
  status:              'WAIT' | 'NO_SETUP' | 'SKIP' | 'ENTRY' | 'TIMEOUT' | 'NO_DATA'
  ticker:              string
  message:             string
  direction?:          'CALL' | 'PUT'
  entry?:              number
  stop?:               number
  target_1?:           number
  target_2?:           number
  rr_ratio?:           number
  atr14?:              number
  vwap?:               number
  condition_a?:        'bull' | 'bear' | 'neutral' | 'pending'
  condition_a_detail?: string
  condition_b?:        'bull' | 'bear' | 'pending'
  condition_b_detail?: string
  condition_c?:        'bull' | 'bear' | 'mixed' | 'pending'
  condition_c_detail?: string
  trigger?:            string
  computed_at:         string
}

export async function fetchEarlyEntryTrigger(
  ticker = 'QQQ',
  forceRefresh = false,
): Promise<EarlyEntryResult> {
  const params = new URLSearchParams({ ticker })
  if (forceRefresh) params.set('force_refresh', 'true')
  const { data } = await api.get<ApiEnvelope<EarlyEntryResult>>(`${generatedApiPath(COMMAND_CENTER_OPERATION_IDS.earlyEntryTrigger)}?${params}`)
  if (!data.data) throw new Error('No early entry data')
  return data.data
}

export interface TrackModeItem {
  ticker: string
  current_price: number | null
  added_at_ms: number
  notes: string
}

export interface TrackModeListResponse {
  tracked: TrackModeItem[]
  count: number
}

export async function fetchTrackMode(): Promise<TrackModeListResponse> {
  const { data } = await api.get<TrackModeListResponse>(generatedApiPath(COMMAND_CENTER_OPERATION_IDS.trackMode))
  return { tracked: data.tracked ?? [], count: data.count ?? 0 }
}

export async function addTrackModeTicker(ticker: string, notes = ''): Promise<{ ok: boolean }> {
  const body: ApiSchemas['TrackModeAddBody'] = { ticker, notes }
  const { data } = await api.post<{ ok: boolean }>(
    generatedApiPath(COMMAND_CENTER_OPERATION_IDS.trackModeAdd),
    body,
  )
  return data
}

export async function removeTrackModeTicker(ticker: string): Promise<{ ok: boolean }> {
  const body: ApiSchemas['TrackModeRemoveBody'] = { ticker }
  const { data } = await api.post<{ ok: boolean }>(
    generatedApiPath(COMMAND_CENTER_OPERATION_IDS.trackModeRemove),
    body,
  )
  return data
}
