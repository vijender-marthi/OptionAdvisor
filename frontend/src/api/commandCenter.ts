import { api } from './client'
import type { AlertCenterPayload, AlertCenterSummaryResponse, ApiEnvelope, TradeCommandCenterPayload, SignalFeedPayload } from '../types/commandCenter'

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'

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
  const { data } = await api.get<unknown>('/trade-command-center', {
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
  const { data } = await api.get<ApiEnvelope<AlertCenterPayload>>('/alerts', {
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
  const { data } = await api.get<ApiEnvelope<AlertCenterSummaryResponse>>('/alerts/summary')
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
  const { data } = await api.post<ApiEnvelope<{ ok: boolean }>>(`/alerts/${encodeURIComponent(id)}/acknowledge`)
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
  const { data } = await api.post<ApiEnvelope<{ ok: boolean }>>(`/alerts/${encodeURIComponent(id)}/resolve`)
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
  const { data } = await api.post<ApiEnvelope<{ ok: boolean }>>(`/alerts/${encodeURIComponent(id)}/note`, { text })
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
  const { data } = await api.get<ApiEnvelope<MarketPositionData | null>>('/market-position')
  return data
}

export async function addPortfolioPosition(payload: {
  position: Record<string, unknown>
}): Promise<ApiEnvelope<{ ok: boolean; portfolio: Array<Record<string, unknown>> }>> {
  const { data } = await api.post<ApiEnvelope<{ ok: boolean; portfolio: Array<Record<string, unknown>> }>>('/portfolio/add', payload)
  return data
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
}

export async function fetchStockTargets(
  ticker: string,
  entryPrice?: number,
): Promise<StockTargetData> {
  const params = new URLSearchParams({ ticker })
  if (entryPrice && entryPrice > 0) params.set('entry_price', String(entryPrice))
  const { data } = await api.get<ApiEnvelope<StockTargetData>>(`/stock-targets?${params}`)
  if (!data.data) throw new Error('No data returned')
  return data.data
}

export async function updatePortfolioPositionApi(payload: {
  id: string
  data: Record<string, unknown>
}): Promise<ApiEnvelope<{ ok: boolean; portfolio: Array<Record<string, unknown>> }>> {
  const { data } = await api.post<ApiEnvelope<{ ok: boolean; portfolio: Array<Record<string, unknown>> }>>('/portfolio/update', payload)
  return data
}

export async function closePortfolioPosition(payload: {
  id: string
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
  const { data } = await api.post<ApiEnvelope<{ ok: boolean; portfolio: Array<Record<string, unknown>> }>>('/portfolio/close', payload)
  return data
}

export async function fetchPositionsCenter(): Promise<ApiEnvelope<Record<string, unknown>>> {
  if (USE_MOCK) {
    return normalizeCommandCenterEnvelope({})
  }
  const { data } = await api.get<unknown>('/positions-center')
  return normalizeCommandCenterEnvelope(data)
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
  const { data } = await api.get<ApiEnvelope<SignalFeedPayload>>('/signal-feed', {
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
  return data
}

/** Explicit cache-refresh — only called when user clicks Refresh button */
export async function refreshSignalFeed(): Promise<ApiEnvelope<{
  ok: boolean
  refreshed_tickers: string[]
  cache: { cache_hits: number; cache_misses: number; elapsed_ms: number }
}>> {
  const { data } = await api.post('/signal-feed/refresh')
  return data
}

export async function createSignalFeedAlert(payload: {
  ticker: string
  agreement_state: string
  message?: string
  recommended_action?: string
}): Promise<ApiEnvelope<{ ok: boolean; id: string }>> {
  const { data } = await api.post<ApiEnvelope<{ ok: boolean; id: string }>>('/signal-feed/alerts', payload)
  return data
}

export async function addWatchlistTicker(payload: {
  ticker: string
  notes?: string
  source?: string
  watch_reason?: string
  desired_entry?: number | null
}): Promise<ApiEnvelope<{ ok: boolean; watchlist: Array<Record<string, unknown>>; duplicate?: boolean }>> {
  const { data } = await api.post<ApiEnvelope<{ ok: boolean; watchlist: Array<Record<string, unknown>>; duplicate?: boolean }>>('/watchlist/add', payload)
  return data
}

export async function removeWatchlistTicker(payload: {
  ticker: string
}): Promise<ApiEnvelope<{ ok: boolean; watchlist: Array<Record<string, unknown>> }>> {
  const { data } = await api.post<ApiEnvelope<{ ok: boolean; watchlist: Array<Record<string, unknown>> }>>('/watchlist/remove', payload)
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
  const { data } = await api.get<ApiEnvelope<{ results: SearchTickerResult[] }>>('/search-tickers', { params: { q } })
  return data
}

export async function fetchMyTickers(): Promise<ApiEnvelope<{ tickers: MyTickerEntry[] }>> {
  const { data } = await api.get<ApiEnvelope<{ tickers: MyTickerEntry[] }>>('/my-tickers')
  return data
}

export async function addMyTicker(payload: {
  symbol: string
  company_name?: string
  trade_types: string[]
}): Promise<ApiEnvelope<{ ok: boolean; tickers: MyTickerEntry[] }>> {
  const { data } = await api.post<ApiEnvelope<{ ok: boolean; tickers: MyTickerEntry[] }>>('/my-tickers', payload)
  return data
}

export async function updateMyTicker(symbol: string, payload: {
  trade_types: string[]
}): Promise<ApiEnvelope<{ ok: boolean; tickers: MyTickerEntry[] }>> {
  const { data } = await api.patch<ApiEnvelope<{ ok: boolean; tickers: MyTickerEntry[] }>>(`/my-tickers/${encodeURIComponent(symbol)}`, payload)
  return data
}

export async function removeMyTicker(symbol: string): Promise<ApiEnvelope<{ ok: boolean; tickers: MyTickerEntry[] }>> {
  const { data } = await api.delete<ApiEnvelope<{ ok: boolean; tickers: MyTickerEntry[] }>>(`/my-tickers/${encodeURIComponent(symbol)}`)
  return data
}

export async function removeMyTickerType(symbol: string, tradeType: string): Promise<ApiEnvelope<{ ok: boolean; tickers: MyTickerEntry[] }>> {
  const { data } = await api.delete<ApiEnvelope<{ ok: boolean; tickers: MyTickerEntry[] }>>(`/my-tickers/${encodeURIComponent(symbol)}/type/${encodeURIComponent(tradeType)}`)
  return data
}

export async function reorderMyTickers(symbols: string[]): Promise<ApiEnvelope<{ ok: boolean; tickers: MyTickerEntry[] }>> {
  const { data } = await api.put<ApiEnvelope<{ ok: boolean; tickers: MyTickerEntry[] }>>('/my-tickers/reorder', { symbols })
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
  const { data } = await api.get<ApiEnvelope<PremarketBiasData>>(`/premarket-bias${params}`)
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
  const { data } = await api.get<ApiEnvelope<EarlyEntryResult>>(`/early-entry-trigger?${params}`)
  if (!data.data) throw new Error('No early entry data')
  return data.data
}

