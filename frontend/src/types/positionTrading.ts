import type { AnalyzeResponse, Recommendation, StrategyMode } from './index'
import type { MyTickerEntry } from '../api/commandCenter'

export type CenterTab = 'overview' | 'chart' | 'key-levels' | 'flow' | 'news'
export type RecListTab = 'list' | 'performance' | 'history'
export type SidebarTab = 'my-tickers' | 'markets'
export type ChartInterval = '1m' | '5m' | '15m'
export type SortField = 'symbol' | 'price' | 'change' | 'confidence' | 'state'

export interface FilterState {
  strategy: string
  timeHorizon: string
  bias: string
  recState: string
  activeOnly: boolean
}

export const DEFAULT_FILTERS: FilterState = {
  strategy: 'all',
  timeHorizon: 'all',
  bias: 'all',
  recState: 'all',
  activeOnly: true,
}

export const STRATEGY_OPTIONS = [
  'All Strategies',
  'Covered Call',
  'Cash-Secured Put',
  'Bull Call Spread',
  'Bull Put Spread',
  'Bear Call Spread',
  'Bear Put Spread',
  'Long Call',
  'Long Put',
  'Calendar Spread',
  'Iron Condor',
] as const

export const TIME_HORIZON_OPTIONS = [
  'All Horizons',
  'Near-Term',
  'Swing',
  'Position',
  'Longer-Dated',
] as const

export const BIAS_OPTIONS = [
  'All Biases',
  'Bullish',
  'Neutral',
  'Bearish',
] as const

export const REC_STATE_OPTIONS = [
  'All',
  'GO',
  'WAIT',
  'CAUTION',
  'AVOID',
] as const

export type RecommendationState = 'GO' | 'WAIT' | 'CAUTION' | 'AVOID'
export type DecisionAction = 'GO' | 'WAIT' | 'AVOID' | 'MANAGE POSITION'

export interface PositionTradingViewState {
  tickers: MyTickerEntry[]
  tickersLoading: boolean
  tickersError: string | null

  selectedSymbol: string
  analysis: AnalyzeResponse | null
  analysisLoading: boolean
  analysisError: string | null

  selectedRecommendationId: number | null
  detailLoading: boolean

  sidebarTab: SidebarTab
  centerTab: CenterTab
  recListTab: RecListTab
  chartInterval: ChartInterval
  filters: FilterState
  sortField: SortField
  sortAsc: boolean
  searchQuery: string
  showAllRecs: boolean

  lastWeeks: number
  lastWidth: number | null
  lastMode: StrategyMode
}

export interface PositionTradingActions {
  setSelectedSymbol: (symbol: string) => void
  setSelectedRecommendationId: (rank: number | null) => void
  setSidebarTab: (tab: SidebarTab) => void
  setCenterTab: (tab: CenterTab) => void
  setRecListTab: (tab: RecListTab) => void
  setChartInterval: (interval: ChartInterval) => void
  setFilters: (filters: FilterState) => void
  setSortField: (field: SortField) => void
  setSortAsc: (asc: boolean) => void
  setSearchQuery: (query: string) => void
  setShowAllRecs: (show: boolean) => void
  refreshAnalysis: () => void
  refreshTickers: () => void
}
