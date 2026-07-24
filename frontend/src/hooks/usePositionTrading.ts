import { useState, useEffect, useCallback, useRef } from 'react'
import { analyzeOptions, fetchPositionSessionChart } from '../api/client'
import type { PositionSwingChartResponse } from '../api/client'
import { fetchMyTickers, type MyTickerEntry } from '../api/commandCenter'
import type { AnalyzeResponse, StrategyMode } from '../types'
import { useApp } from '../contexts/AppContext'
import type {
  PositionTradingViewState,
  FilterState,
  CenterTab,
  RecListTab,
  SidebarTab,
  SortField,
  DEFAULT_FILTERS,
} from '../types/positionTrading'

const DEFAULT_WEEKS = 4
const DEFAULT_MODE: StrategyMode = 'all'

function createInitialState(): PositionTradingViewState {
  return {
    tickers: [],
    tickersLoading: false,
    tickersError: null,
    selectedSymbol: '',
    analysis: null,
    analysisLoading: false,
    analysisError: null,
    selectedRecommendationId: null,
    detailLoading: false,
    sidebarTab: 'my-tickers',
    centerTab: 'overview',
    recListTab: 'list',
    filters: {
      strategy: 'all',
      timeHorizon: 'all',
      bias: 'all',
      recState: 'all',
      activeOnly: true,
    },
    sortField: 'symbol',
    sortAsc: true,
    searchQuery: '',
    showAllRecs: false,
    lastWeeks: DEFAULT_WEEKS,
    lastWidth: null,
    lastMode: DEFAULT_MODE,
  }
}

export function usePositionTrading() {
  const { tickerCache, getCached, setCached, isMarketHours } = useApp()
  const [state, setState] = useState<PositionTradingViewState>(createInitialState)
  const [positionChart, setPositionChart] = useState<PositionSwingChartResponse | null>(null)
  const [positionChartLoading, setPositionChartLoading] = useState(false)
  const [positionChartError, setPositionChartError] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const update = useCallback((partial: Partial<PositionTradingViewState>) => {
    setState(prev => ({ ...prev, ...partial }))
  }, [])

  // Load my tickers
  const loadTickers = useCallback(async () => {
    update({ tickersLoading: true, tickersError: null })
    try {
      const result = await fetchMyTickers()
      if (!mountedRef.current) return
      const tickers = result.data?.tickers ?? []
      update({ tickers, tickersLoading: false })
    } catch (err) {
      if (!mountedRef.current) return
      update({
        tickersLoading: false,
        tickersError: err instanceof Error ? err.message : 'Failed to load tickers',
      })
    }
  }, [update])

  useEffect(() => {
    void loadTickers()
  }, [loadTickers])

  // Select ticker → load analysis
  const selectSymbol = useCallback((symbol: string) => {
    update({
      selectedSymbol: symbol,
      selectedRecommendationId: null,
      analysisLoading: true,
      analysisError: null,
      centerTab: 'overview',
    })
  }, [update])

  useEffect(() => {
    if (!state.selectedSymbol) return

    const symbol = state.selectedSymbol
    let cancelled = false

    const run = async () => {
      update({ analysisLoading: true })
      try {
        const result = await analyzeOptions(symbol, state.lastWeeks, state.lastWidth, state.lastMode, null)
        if (cancelled || !mountedRef.current) return
        update({ analysis: result, analysisLoading: false })

        // Auto-select preferred recommendation
        const preferred = result.recommendations.find(r => {
          const verdict = deriveRecommendationState(r)
          return verdict === 'GO'
        }) ?? result.recommendations[0] ?? null

        update({ selectedRecommendationId: preferred?.rank ?? null })
      } catch (err) {
        if (cancelled || !mountedRef.current) return
        update({
          analysisLoading: false,
          analysisError: err instanceof Error ? err.message : 'Analysis failed',
        })
      }
    }

    void run()
    return () => { cancelled = true }
  }, [state.selectedSymbol, state.lastWeeks, state.lastWidth, state.lastMode, update])

  // Load position chart
  useEffect(() => {
    if (!state.selectedSymbol) {
      setPositionChart(null)
      setPositionChartError('')
      return
    }

    let cancelled = false
    const load = async () => {
      setPositionChartLoading(true)
      setPositionChartError('')
      try {
        const response = await fetchPositionSessionChart({
          symbol: state.selectedSymbol,
          forceRefresh: false,
        })
        if (!cancelled) {
          setPositionChart(response)
          setPositionChartLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          setPositionChart(null)
          setPositionChartError(err instanceof Error ? err.message : 'Chart load failed')
          setPositionChartLoading(false)
        }
      }
    }
    void load()
    return () => { cancelled = true }
  }, [state.selectedSymbol])

  const refreshAnalysis = useCallback(async () => {
    if (!state.selectedSymbol) return
    update({ analysisLoading: true, analysisError: null })
    try {
      const result = await analyzeOptions(state.selectedSymbol, state.lastWeeks ?? DEFAULT_WEEKS, state.lastWidth, state.lastMode, null)
      if (!mountedRef.current) return
      update({ analysis: result, analysisLoading: false })
      const preferred = result.recommendations.find(r => deriveRecommendationState(r) === 'GO') ?? result.recommendations[0] ?? null
      update({ selectedRecommendationId: preferred?.rank ?? null })
    } catch (err) {
      if (!mountedRef.current) return
      update({
        analysisLoading: false,
        analysisError: err instanceof Error ? err.message : 'Refresh failed',
      })
    }
  }, [state.selectedSymbol, state.lastWidth, state.lastMode, update])

  return {
    state,
    positionChart,
    positionChartLoading,
    positionChartError,
    loadTickers,
    selectSymbol,
    refreshAnalysis,
    update,
  }
}

function deriveRecommendationState(rec: { scores?: { total_score?: number }; prob_of_profit?: number; passes_rr_filter?: boolean; passes_liquidity_filter?: boolean }): 'GO' | 'WAIT' | 'CAUTION' | 'AVOID' {
  const score = rec.scores?.total_score ?? 0
  if (score >= 75 && rec.passes_rr_filter && rec.passes_liquidity_filter) return 'GO'
  if (score >= 55) return 'CAUTION'
  if (score >= 40) return 'WAIT'
  return 'AVOID'
}
