import type { SwingTradeScanResult } from '../api/client'

export interface SwingTradeEnginePageState {
  ticker: string
  result: SwingTradeScanResult | null
  error: string | null
  loading: boolean
  glossaryOpen: boolean
}

export const INITIAL_SWING_TRADE_ENGINE_PAGE: SwingTradeEnginePageState = {
  ticker: '',
  result: null,
  error: null,
  loading: false,
  glossaryOpen: false,
}

/** Row state for the multi-ticker Swing Trade Watchlist UI (cached in AppContext across routes). */
export type SwingTradeWatchlistRowState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; result: SwingTradeScanResult }
  | { status: 'err'; message: string }

export interface SwingTradeWatchlistPageState {
  addInput: string
  expanded: Record<string, boolean>
  rows: Record<string, SwingTradeWatchlistRowState>
  rowBusy: Record<string, boolean>
  bulkLoading: boolean
}

export const INITIAL_SWING_TRADE_WATCHLIST_PAGE: SwingTradeWatchlistPageState = {
  addInput: '',
  expanded: {},
  rows: {},
  rowBusy: {},
  bulkLoading: false,
}
