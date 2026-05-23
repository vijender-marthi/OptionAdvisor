import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell, Plus, RefreshCw } from 'lucide-react'
import { deskApi } from '../api/client'
import type {
  DeskWatchlistItem, DeskTradeLog, DeskTradeStats, DeskAlert,
  DeskTradeCreate, DeskTradeUpdate, DeskAlertCreate,
  DayTradeScanResult, SwingTradeScanResult,
} from '../api/client'
import { fetchMarketPosition } from '../api/commandCenter'
import LeftPanel from '../components/desk/LeftPanel'
import VerdictTab from '../components/desk/VerdictTab'
import JournalTab from '../components/desk/JournalTab'
import AlertsTab from '../components/desk/AlertsTab'
import LogTradeDrawer from '../components/desk/LogTradeDrawer'
import SetAlertDrawer from '../components/desk/SetAlertDrawer'

type Analysis = (DayTradeScanResult & SwingTradeScanResult & { trade_type: string }) | null
type Tab = 'verdict' | 'journal' | 'alerts'
type DrawerState =
  | { type: 'log-new' }
  | { type: 'log-close'; trade: DeskTradeLog }
  | { type: 'alert' }
  | null

function etClock(): string {
  return new Date().toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }) + ' ET'
}

export default function TradeDeskPage() {
  // Core state
  const [selectedTicker, setSelectedTicker] = useState('')
  const [tradeType, setTradeType] = useState<'day' | 'swing' | 'regular'>('day')
  const [analysis, setAnalysis] = useState<Analysis>(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisRefreshing, setAnalysisRefreshing] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('verdict')

  // Data
  const [watchlist, setWatchlist] = useState<DeskWatchlistItem[]>([])
  const [trades, setTrades] = useState<DeskTradeLog[]>([])
  const [tradeStats, setTradeStats] = useState<DeskTradeStats>({
    total: 0, wins: 0, losses: 0, open_count: 0,
    win_rate: 0, avg_rr: 0, followed_plan_pct: 0,
  })
  const [alerts, setAlerts] = useState<DeskAlert[]>([])
  const [alertHistory, setAlertHistory] = useState<DeskAlert[]>([])
  const [alertCount, setAlertCount] = useState(0)
  const [drawer, setDrawer] = useState<DrawerState>(null)

  // Topbar market
  const [clock, setClock] = useState(etClock)
  const [marketLabel, setMarketLabel] = useState<string | null>(null)
  const [marketTone, setMarketTone] = useState<'green' | 'red' | 'orange' | 'gray' | string>('gray')

  // Watchlist signal cache (verdict per ticker:type)
  const [verdicts, setVerdicts] = useState<Record<string, string>>({})

  // Refs to avoid stale closures in intervals
  const tickerRef = useRef(selectedTicker)
  tickerRef.current = selectedTicker
  const tradeTypeRef = useRef(tradeType)
  tradeTypeRef.current = tradeType

  // ── Data fetchers ──────────────────────────────────────────────────────────

  const fetchWatchlist = useCallback(async () => {
    try {
      const data = await deskApi.getWatchlist()
      setWatchlist(data)
    } catch { /* ignore */ }
  }, [])

  const fetchTrades = useCallback(async () => {
    try {
      const [all, stats] = await Promise.all([
        deskApi.getTrades(),
        deskApi.getTradeStats(30),
      ])
      setTrades(all)
      setTradeStats(stats)
    } catch { /* ignore */ }
  }, [])

  const fetchAlerts = useCallback(async () => {
    try {
      const [active, history, count] = await Promise.all([
        deskApi.getAlerts(true),
        deskApi.getAlertHistory(),
        deskApi.getAlertCount(),
      ])
      setAlerts(active)
      setAlertHistory(history)
      setAlertCount(count)
    } catch { /* ignore */ }
  }, [])

  const fetchAnalysis = useCallback(async (ticker: string, type?: string) => {
    const t = ticker.trim().toUpperCase()
    const tt = type || tradeTypeRef.current
    if (!t) return
    setAnalysis(prev => prev ? (setAnalysisRefreshing(true), prev) : (setAnalysisLoading(true), null))
    try {
      const data = await deskApi.getAnalysis(t, tt)
      setAnalysis(data)
      setVerdicts(prev => ({ ...prev, [`${t}:${tt}`]: data.verdict }))
    } catch { /* ignore */ } finally {
      setAnalysisLoading(false)
      setAnalysisRefreshing(false)
    }
  }, [])

  // ── Mount effects ──────────────────────────────────────────────────────────

  useEffect(() => {
    fetchWatchlist()
    fetchTrades()
    fetchAlerts()

    // Market position for topbar
    fetchMarketPosition().then(res => {
      if (res.data) {
        setMarketLabel(res.data.signal_label)
        setMarketTone(res.data.signal_tone)
      }
    }).catch(() => {})

    // Clock tick
    const clockId = setInterval(() => setClock(etClock()), 30_000)

    // 60s poll
    const pollId = setInterval(() => {
      fetchWatchlist()
      fetchAlerts()
    }, 60_000)

    return () => {
      clearInterval(clockId)
      clearInterval(pollId)
    }
  }, [fetchWatchlist, fetchAlerts])

  // Auto-load first watchlist item on mount
  useEffect(() => {
    if (watchlist.length > 0 && !selectedTicker) {
      const first = watchlist[0]
      setSelectedTicker(first.ticker)
      setTradeType(first.trade_type as 'day' | 'swing' | 'regular')
      void fetchAnalysis(first.ticker, first.trade_type)
    }
  }, [watchlist]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleLoadTicker = useCallback((ticker: string) => {
    const t = ticker.trim().toUpperCase()
    if (!t) return
    setSelectedTicker(t)
    setActiveTab('verdict')
    void fetchAnalysis(t, tradeTypeRef.current)
  }, [fetchAnalysis])

  const handleTradeTypeChange = useCallback((tt: 'day' | 'swing' | 'regular') => {
    setTradeType(tt)
    if (tickerRef.current) {
      void fetchAnalysis(tickerRef.current, tt)
    }
  }, [fetchAnalysis])

  const handleAddToWatchlist = useCallback(async () => {
    if (!selectedTicker) return
    try {
      await deskApi.addToWatchlist(selectedTicker, tradeType)
      await fetchWatchlist()
    } catch { /* ignore */ }
  }, [selectedTicker, tradeType, fetchWatchlist])

  const handleRemoveFromWatchlist = useCallback(async (ticker: string) => {
    try {
      await deskApi.removeFromWatchlist(ticker, tradeType)
      await fetchWatchlist()
    } catch { /* ignore */ }
  }, [tradeType, fetchWatchlist])

  const handleLogTrade = useCallback(async (data: DeskTradeCreate) => {
    await deskApi.createTrade(data)
    await fetchTrades()
    setDrawer(null)
    setActiveTab('journal')
  }, [fetchTrades])

  const handleCloseTrade = useCallback(async (trade: DeskTradeLog, data: DeskTradeUpdate) => {
    await deskApi.updateTrade(trade.id, data)
    await fetchTrades()
    setDrawer(null)
  }, [fetchTrades])

  const handleDeleteTrade = useCallback(async (id: string) => {
    await deskApi.deleteTrade(id)
    await fetchTrades()
  }, [fetchTrades])

  const handleCreateAlert = useCallback(async (data: DeskAlertCreate) => {
    await deskApi.createAlert(data)
    await fetchAlerts()
    setDrawer(null)
    setActiveTab('alerts')
  }, [fetchAlerts])

  const handleDeleteAlert = useCallback(async (id: string) => {
    await deskApi.deleteAlert(id)
    await fetchAlerts()
  }, [fetchAlerts])

  // ── Derived ────────────────────────────────────────────────────────────────

  const openTradeForCurrent = trades.find(
    t => t.ticker === selectedTicker && !t.exit_time
  ) || null

  const openTradeSet = new Set<string>(trades.filter(t => !t.exit_time).map(t => t.ticker))
  const alertTickerSet = new Set<string>(alerts.map(a => a.ticker))

  // Current analysis entry/target levels for log drawer
  const eg = analysis?.entry_guidance as Record<string, unknown> | undefined
  const plannedEntry = typeof eg?.breakout_level === 'number' ? eg.breakout_level : undefined
  const plannedT1 = typeof eg?.scalp_target === 'number' ? eg.scalp_target : undefined
  const plannedStop = typeof eg?.risk_below === 'number' ? eg.risk_below : undefined

  const toneClassMap: Record<string, string> = {
    green: 'text-emerald-400',
    red: 'text-rose-400',
    orange: 'text-amber-400',
    gray: 'text-gray-500',
  }
  const toneClass = toneClassMap[marketTone] ?? 'text-gray-500'

  const priceNum = analysis
    ? (analysis.metrics as Record<string, unknown>)?.last_price as number | undefined
    : undefined
  const changePct = analysis
    ? (analysis.metrics as Record<string, unknown>)?.price_change_pct as number | undefined
    : undefined

  const tabLabel: Record<Tab, string> = {
    verdict: 'Verdict',
    journal: 'Journal',
    alerts: `Alerts${alertCount > 0 ? ` ${alertCount}` : ''}`,
  }

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-white overflow-hidden">
      {/* Topbar */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-white/[0.07] bg-slate-900/80 shrink-0 gap-4">
        {/* Left: brand */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="h-7 w-7 rounded-lg bg-violet-600 flex items-center justify-center text-white font-bold text-xs">OA</div>
          <span className="font-bold text-sm text-white hidden sm:block">TradeDesk</span>
        </div>

        {/* Center: market strip */}
        <div className="flex items-center gap-4 text-xs overflow-x-auto">
          {marketLabel && (
            <span className={`font-semibold whitespace-nowrap ${toneClass}`}>{marketLabel}</span>
          )}
        </div>

        {/* Right: alert bell + clock */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            className="relative text-gray-500 hover:text-gray-300 transition-colors"
            onClick={() => setActiveTab('alerts')}
            aria-label="Alerts"
          >
            <Bell size={16} />
            {alertCount > 0 && (
              <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">
                {alertCount > 9 ? '9+' : alertCount}
              </span>
            )}
          </button>
          <span className="text-[11px] text-gray-600 whitespace-nowrap">{clock}</span>
        </div>
      </header>

      {/* Body: left panel + right panel */}
      <div className="flex flex-1 min-h-0">
        {/* Left: 300px */}
        <div className="w-[300px] shrink-0 flex flex-col min-h-0">
          <LeftPanel
            watchlist={watchlist}
            selectedTicker={selectedTicker}
            tradeType={tradeType}
            onLoadTicker={handleLoadTicker}
            onRemove={handleRemoveFromWatchlist}
            openTradeSet={openTradeSet}
            alertTickerSet={alertTickerSet}
            verdicts={verdicts}
          />
        </div>

        {/* Right: rest */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          {/* Ticker header */}
          {selectedTicker && (
            <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-white/[0.07] bg-slate-900/60 shrink-0">
              <span className="font-mono font-bold text-lg text-white">{selectedTicker}</span>
              {analysis?.company_name && (
                <span className="text-sm text-gray-400">{analysis.company_name}</span>
              )}
              {priceNum != null && (
                <span className="font-mono text-sm text-gray-300">${priceNum.toFixed(2)}</span>
              )}
              {changePct != null && (
                <span className={`text-xs font-semibold ${changePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
                </span>
              )}
              {/* Trade type badge */}
              <div className="flex items-center gap-1 ml-auto">
                {(['day', 'swing', 'regular'] as const).map(tt => (
                  <button
                    key={tt}
                    type="button"
                    onClick={() => handleTradeTypeChange(tt)}
                    className={`text-[11px] px-2.5 py-1 rounded-lg font-semibold border transition-colors capitalize ${
                      tradeType === tt
                        ? 'bg-violet-600 border-violet-500 text-white'
                        : 'bg-slate-800/50 border-white/[0.07] text-gray-500 hover:border-white/[0.14]'
                    }`}
                  >
                    {tt}
                  </button>
                ))}
              </div>
              {/* Add to watchlist */}
              <button
                type="button"
                onClick={() => void handleAddToWatchlist()}
                className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] text-gray-400 hover:bg-white/[0.07] transition-colors shrink-0"
              >
                <Plus size={12} /> Watchlist
              </button>
              {/* Refresh */}
              <button
                type="button"
                onClick={() => void fetchAnalysis(selectedTicker, tradeType)}
                disabled={analysisLoading || analysisRefreshing}
                className="text-gray-600 hover:text-gray-300 disabled:opacity-40 transition-colors"
                aria-label="Refresh analysis"
              >
                <RefreshCw size={13} className={(analysisLoading || analysisRefreshing) ? 'animate-spin' : ''} />
              </button>
            </div>
          )}

          {/* Tab strip */}
          <div className="flex border-b border-white/[0.07] shrink-0 px-4 gap-1 bg-slate-900/40">
            {(['verdict', 'journal', 'alerts'] as Tab[]).map(tab => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`py-2.5 px-3 text-xs font-semibold border-b-2 transition-colors ${
                  activeTab === tab
                    ? 'border-violet-500 text-white'
                    : 'border-transparent text-gray-500 hover:text-gray-300'
                }`}
              >
                {tabLabel[tab]}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto p-4">
            {activeTab === 'verdict' && (
              <VerdictTab
                analysis={analysis}
                loading={analysisLoading}
                openTrade={openTradeForCurrent}
                onLogTrade={() => setDrawer(
                  openTradeForCurrent
                    ? { type: 'log-close', trade: openTradeForCurrent }
                    : { type: 'log-new' }
                )}
                onSetAlert={() => setDrawer({ type: 'alert' })}
                onRefresh={() => void fetchAnalysis(selectedTicker, tradeType)}
                refreshing={analysisRefreshing}
              />
            )}
            {activeTab === 'journal' && (
              <JournalTab
                trades={trades}
                stats={tradeStats}
                onClose={trade => setDrawer({ type: 'log-close', trade })}
                onDelete={id => void handleDeleteTrade(id)}
              />
            )}
            {activeTab === 'alerts' && (
              <AlertsTab
                alerts={alerts}
                history={alertHistory}
                onDelete={id => void handleDeleteAlert(id)}
              />
            )}
          </div>
        </div>
      </div>

      {/* Drawers */}
      {drawer?.type === 'log-new' && selectedTicker && (
        <LogTradeDrawer
          mode="new"
          ticker={selectedTicker}
          tradeType={tradeType}
          signalGiven={analysis?.final_decision || ''}
          confidence={analysis?.confidence}
          plannedEntry={plannedEntry}
          plannedT1={plannedT1}
          plannedStop={plannedStop}
          structure={analysis?.structure || ''}
          onClose={() => setDrawer(null)}
          onSubmit={handleLogTrade}
        />
      )}
      {drawer?.type === 'log-close' && (
        <LogTradeDrawer
          mode="close"
          trade={drawer.trade}
          onClose={() => setDrawer(null)}
          onSubmit={data => handleCloseTrade(drawer.trade, data)}
        />
      )}
      {drawer?.type === 'alert' && selectedTicker && (
        <SetAlertDrawer
          ticker={selectedTicker}
          tradeType={tradeType}
          onClose={() => setDrawer(null)}
          onSubmit={handleCreateAlert}
        />
      )}
    </div>
  )
}
