import { SlidersHorizontal } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { deskApi, fetchPositionScanner, fetchPositionWorkspace } from '../api/client'
import PositionDetailRail from '../components/position/PositionDetailRail'
import PositionScannerRail, { positionFiltersToQuery, type PositionFilters } from '../components/position/PositionScannerRail'
import PositionTutorialDrawer from '../components/position/PositionTutorialDrawer'
import PositionWorkspaceMain from '../components/position/PositionWorkspaceMain'
import SetAlertDrawer from '../components/desk/SetAlertDrawer'
import { useApp } from '../contexts/AppContext'
import { formatTickerTitle, useDocumentTitle } from '../hooks/useDocumentTitle'
import type { PositionScannerData, PositionWorkspaceData } from '../types/positionWorkspace'

const DEFAULT_FILTERS: PositionFilters = {
  weeksOut: 4,
  strategyTypes: ['Long Call', 'Bull Call Spread', 'Bear Put Spread', 'Covered Call'],
  riskProfile: 'balanced',
  ivRank: 40,
  pop: 55,
  expectedReturn: 250,
  dte: 32,
  minConfidence: 80,
}

function errorMessage(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: unknown } }; message?: unknown })?.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    const messages = detail
      .map(item => typeof item === 'string'
        ? item
        : typeof item === 'object' && item !== null && 'msg' in item
          ? String((item as { msg?: unknown }).msg || '')
          : '')
      .filter(Boolean)
    if (messages.length) return messages.join('; ')
  }
  const message = (error as { message?: unknown })?.message
  return typeof message === 'string' && message ? message : fallback
}

function positionApiError(error: unknown): string | null {
  if (!error) return null
  if (typeof error === 'string') return error
  if (typeof error === 'object' && 'message' in error) return String((error as { message?: unknown }).message || '')
  return 'Unavailable'
}

export default function TickerPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { pendingTicker, clearPendingTicker, addToWatchlist, removeFromWatchlist, isWatched } = useApp()
  const [filters, setFilters] = useState<PositionFilters>(DEFAULT_FILTERS)
  const [scanner, setScanner] = useState<PositionScannerData | null>(null)
  const [scannerLoading, setScannerLoading] = useState(false)
  const [scannerError, setScannerError] = useState<string | null>(null)
  const [workspace, setWorkspace] = useState<PositionWorkspaceData | null>(null)
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [symbol, setSymbol] = useState(() => (searchParams.get('symbol') || searchParams.get('ticker') || pendingTicker || '').trim().toUpperCase())
  const [selectedStrategyId, setSelectedStrategyId] = useState<string | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const [alertOpen, setAlertOpen] = useState(false)

  useDocumentTitle(formatTickerTitle(symbol, 'Position Trading'))

  const loadScanner = useCallback(async () => {
    setScannerLoading(true)
    setScannerError(null)
    try {
      const response = await fetchPositionScanner(positionFiltersToQuery(filters))
      if (response.error) {
        setScannerError(positionApiError(response.error))
        setScanner(response.data)
      } else setScanner(response.data)
    } catch (error) {
      setScannerError(errorMessage(error, 'Unable to load position scanner.'))
    } finally { setScannerLoading(false) }
  }, [filters])

  const loadWorkspace = useCallback(async (nextSymbol: string) => {
    if (!nextSymbol) { setWorkspace(null); setWorkspaceError(null); return }
    setWorkspaceLoading(true)
    setWorkspaceError(null)
    try {
      const response = await fetchPositionWorkspace({ symbol: nextSymbol, ...positionFiltersToQuery(filters) })
      if (response.error) {
        setWorkspaceError(positionApiError(response.error))
        setWorkspace(response.data)
      } else setWorkspace(response.data)
    } catch (error) {
      setWorkspace(null)
      setWorkspaceError(errorMessage(error, 'Unable to load position workspace.'))
    } finally { setWorkspaceLoading(false) }
  }, [filters])

  useEffect(() => { void loadScanner() }, [loadScanner])
  useEffect(() => { if (symbol) void loadWorkspace(symbol) }, [loadWorkspace, symbol])
  useEffect(() => {
    if (!pendingTicker) return
    const next = pendingTicker.trim().toUpperCase()
    setSymbol(next)
    setSearchParams(previous => { const params = new URLSearchParams(previous); params.set('symbol', next); params.delete('ticker'); return params }, { replace: true })
    clearPendingTicker()
  }, [clearPendingTicker, pendingTicker, setSearchParams])
  useEffect(() => {
    const candidates = workspace?.strategies ?? []
    if (!candidates.some(candidate => candidate.id === selectedStrategyId)) setSelectedStrategyId(workspace?.selected_strategy_id ?? candidates[0]?.id ?? null)
  }, [selectedStrategyId, workspace])

  const selectedStrategy = useMemo(() => workspace?.strategies?.find(candidate => candidate.id === selectedStrategyId) ?? null, [selectedStrategyId, workspace?.strategies])
  const selectedCompany = workspace?.header?.company ?? scanner?.rows?.find(row => row.symbol === symbol)?.company ?? undefined
  const watched = workspace?.watchlist?.is_watched === true || isWatched(symbol)

  const selectSymbol = (nextSymbol: string) => {
    const normalized = nextSymbol.trim().toUpperCase()
    if (!normalized) return
    setSymbol(normalized)
    setSelectedStrategyId(null)
    setFiltersOpen(false)
    setSearchParams(previous => { const params = new URLSearchParams(previous); params.set('symbol', normalized); params.delete('ticker'); return params }, { replace: true })
  }

  const toggleWatchlist = () => {
    if (!symbol) return
    if (watched) { void removeFromWatchlist(symbol); return }
    addToWatchlist({ ticker: symbol, companyName: typeof selectedCompany === 'string' ? selectedCompany : undefined })
  }

  return (
    <div className="min-h-[calc(100dvh-4rem)] bg-surface-page">
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2 dark:border-white/[0.07] dark:bg-slate-900 xl:hidden">
        <span className="font-mono text-sm font-bold text-primary">{symbol || 'Position Trading'}</span>
        <button type="button" onClick={() => setFiltersOpen(true)} className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-200 px-2 text-xs font-semibold text-primary dark:border-white/[0.1]"><SlidersHorizontal size={15} />Filters</button>
      </div>
      {filtersOpen && <div className="fixed inset-0 z-[110] bg-black/40 xl:hidden"><div className="h-full w-[min(360px,90vw)] bg-white dark:bg-slate-950"><PositionScannerRail scanner={scanner} loading={scannerLoading} error={scannerError} filters={filters} onFiltersChange={setFilters} selectedSymbol={symbol} onSelectSymbol={selectSymbol} onRefresh={() => void loadScanner()} onClose={() => setFiltersOpen(false)} /></div></div>}
      <div className="grid min-h-[calc(100dvh-4rem)] lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)] xl:grid-cols-[minmax(250px,20fr)_minmax(0,55fr)_minmax(320px,25fr)]">
        <div className="hidden xl:block"><PositionScannerRail scanner={scanner} loading={scannerLoading} error={scannerError} filters={filters} onFiltersChange={setFilters} selectedSymbol={symbol} onSelectSymbol={selectSymbol} onRefresh={() => void loadScanner()} /></div>
        <PositionWorkspaceMain workspace={workspace} selectedStrategyId={selectedStrategyId} loading={workspaceLoading} error={workspaceError} onSelectStrategy={setSelectedStrategyId} onRefresh={() => void loadWorkspace(symbol)} onOpenTutorial={() => setTutorialOpen(true)} />
        <PositionDetailRail symbol={symbol} strategy={selectedStrategy} watched={watched} onOpenAlert={() => setAlertOpen(true)} onToggleWatchlist={toggleWatchlist} />
      </div>
      {tutorialOpen && <PositionTutorialDrawer tutorial={workspace?.tutorial} onClose={() => setTutorialOpen(false)} />}
      {alertOpen && symbol && <SetAlertDrawer ticker={symbol} tradeType="regular" onClose={() => setAlertOpen(false)} onSubmit={async body => { await deskApi.createAlert(body); setAlertOpen(false) }} />}
    </div>
  )
}
