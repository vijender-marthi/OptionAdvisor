import type { DayTradeScanResult } from '../api/client'

/** Row state for the multi-ticker Day Trade Watchlist UI (cached in AppContext across routes). */
export type DayTradeWatchlistRowState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; result: DayTradeScanResult }
  | { status: 'err'; message: string }

export interface DayTradeEnginePageState {
  ticker: string
  result: DayTradeScanResult | null
  error: string | null
  loading: boolean
  glossaryOpen: boolean
}

export interface DayTradeWatchlistPageState {
  addInput: string
  expanded: Record<string, boolean>
  rows: Record<string, DayTradeWatchlistRowState>
  rowBusy: Record<string, boolean>
  bulkLoading: boolean
}

export const INITIAL_DAY_TRADE_ENGINE_PAGE: DayTradeEnginePageState = {
  ticker: '',
  result: null,
  error: null,
  loading: false,
  glossaryOpen: false,
}

export const INITIAL_DAY_TRADE_WATCHLIST_PAGE: DayTradeWatchlistPageState = {
  addInput: '',
  expanded: {},
  rows: {},
  rowBusy: {},
  bulkLoading: false,
}
