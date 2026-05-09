import { api } from './client'
import type { AlertCenterPayload, ApiEnvelope, TradeCommandCenterPayload, WatchlistXPayload } from '../types/commandCenter'

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
  severity?: string
  status?: string
  ticker?: string
  active_only?: boolean
}): Promise<ApiEnvelope<AlertCenterPayload>> {
  if (USE_MOCK) {
    const { alertCenterEnvelopeMock } = await import('../mocks/alert-center.mock')
    return alertCenterEnvelopeMock
  }
  const { data } = await api.get<ApiEnvelope<AlertCenterPayload>>('/alerts', {
    params: {
      engine_type: opts.engine_type,
      severity: opts.severity,
      status: opts.status,
      ticker: opts.ticker,
      active_only: opts.active_only,
    },
  })
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

export async function fetchPositionsCenter(): Promise<ApiEnvelope<Record<string, unknown>>> {
  if (USE_MOCK) {
    return normalizeCommandCenterEnvelope({})
  }
  const { data } = await api.get<unknown>('/positions-center')
  return normalizeCommandCenterEnvelope(data)
}

export async function fetchWatchlistX(params: {
  search?: string
  source?: string
  sort_by?: string
  sort_dir?: 'asc' | 'desc'
  page?: number
  page_size?: number
  /** Pass true only when user explicitly clicks Refresh — not on normal page load */
  refresh?: boolean
}): Promise<ApiEnvelope<WatchlistXPayload>> {
  const { data } = await api.get<ApiEnvelope<WatchlistXPayload>>('/watchlistx', {
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
export async function refreshWatchlistX(): Promise<ApiEnvelope<{
  ok: boolean
  refreshed_tickers: string[]
  cache: { cache_hits: number; cache_misses: number; elapsed_ms: number }
}>> {
  const { data } = await api.post('/watchlistx/refresh')
  return data
}

export async function createWatchlistXAlert(payload: {
  ticker: string
  agreement_state: string
  message?: string
  recommended_action?: string
}): Promise<ApiEnvelope<{ ok: boolean; id: string }>> {
  const { data } = await api.post<ApiEnvelope<{ ok: boolean; id: string }>>('/watchlistx/alerts', payload)
  return data
}

export async function addWatchlistTicker(payload: {
  ticker: string
  notes?: string
}): Promise<ApiEnvelope<{ ok: boolean; watchlist: Array<Record<string, unknown>> }>> {
  const { data } = await api.post<ApiEnvelope<{ ok: boolean; watchlist: Array<Record<string, unknown>> }>>('/watchlist/add', payload)
  return data
}

export async function removeWatchlistTicker(payload: {
  ticker: string
}): Promise<ApiEnvelope<{ ok: boolean; watchlist: Array<Record<string, unknown>> }>> {
  const { data } = await api.post<ApiEnvelope<{ ok: boolean; watchlist: Array<Record<string, unknown>> }>>('/watchlist/remove', payload)
  return data
}
