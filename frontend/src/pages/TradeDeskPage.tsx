import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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

const C = {
  bgPage:    '#0A0C10',
  bgPanel:   '#111318',
  bgCard:    '#181C23',
  border:    '#1E2330',
  borderSub: '#252C3A',
  muted:     '#5A6478',
  accent:    '#4A7CFF',
  green:     '#00E5A0',
  red:       '#FF4D6D',
  amber:     '#F5A623',
  purple:    '#6B7FD4',
}

function etClock(): string {
  const t = new Date().toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  const h = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false })
  const hNum = parseInt(h)
  const session = hNum < 9 ? 'Pre-Market' : hNum < 12 ? 'Morning' : hNum < 14 ? 'Midday' : hNum < 16 ? 'Afternoon' : 'After-Hours'
  return `${t} ET · ${session}`
}

export default function TradeDeskPage() {
  const navigate = useNavigate()

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
  const [marketData, setMarketData] = useState<{
    spy?: number; spyChg?: number
    qqq?: number; qqqChg?: number
    vix?: number
    regime?: string
  }>({})

  // Watchlist signal cache
  const [verdicts, setVerdicts] = useState<Record<string, string>>({})

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

  const loadMarketData = useCallback(async () => {
    try {
      const res = await fetchMarketPosition()
      if (res.data) {
        setMarketData({
          spy: res.data.spy_price,
          regime: res.data.position_signal,
        })
      }
    } catch { /* ignore */ }
  }, [])

  // ── Mount effects ──────────────────────────────────────────────────────────

  useEffect(() => {
    fetchWatchlist()
    fetchTrades()
    fetchAlerts()
    loadMarketData()

    const clockId = setInterval(() => setClock(etClock()), 30_000)
    const pollId = setInterval(() => {
      fetchWatchlist()
      fetchAlerts()
      loadMarketData()
    }, 60_000)

    return () => {
      clearInterval(clockId)
      clearInterval(pollId)
    }
  }, [fetchWatchlist, fetchAlerts, loadMarketData])

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

  const eg = analysis?.entry_guidance as Record<string, unknown> | undefined
  const plannedEntry = typeof eg?.breakout_level === 'number' ? eg.breakout_level : undefined
  const plannedT1 = typeof eg?.scalp_target === 'number' ? eg.scalp_target : undefined
  const plannedStop = typeof eg?.risk_below === 'number' ? eg.risk_below : undefined

  const priceNum = analysis
    ? (analysis.metrics as Record<string, unknown>)?.last_price as number | undefined
    : undefined
  const changePct = analysis
    ? (analysis.metrics as Record<string, unknown>)?.price_change_pct as number | undefined
    : undefined

  // Market regime label
  const regimeBadge = marketData.regime
    ? marketData.regime.replace(/_/g, ' ')
    : 'NEUTRAL MARKET'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: C.bgPage, color: '#fff', overflow: 'hidden', fontFamily: 'sans-serif' }}>
      {/* ── TOPBAR ── */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        height: 44, padding: '0 16px',
        background: C.bgPage, borderBottom: `1px solid ${C.border}`,
        flexShrink: 0, gap: 12,
      }}>
        {/* Left: logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, flexShrink: 0 }}>
          <span style={{ fontWeight: 700, fontSize: '0.95rem', color: '#fff' }}>Option</span>
          <span style={{ fontWeight: 700, fontSize: '0.95rem', color: C.green }}>Advisor</span>
        </div>

        {/* Center: market strip */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontFamily: 'monospace', fontSize: '0.72rem', overflow: 'hidden', flex: 1, justifyContent: 'center' }}>
          {/* Pulsing green dot */}
          <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: C.green, boxShadow: `0 0 6px ${C.green}`, flexShrink: 0 }} />
          {marketData.spy && (
            <span style={{ color: '#fff', whiteSpace: 'nowrap' }}>
              SPY <span style={{ fontWeight: 700 }}>${marketData.spy.toFixed(2)}</span>
              {marketData.spyChg !== undefined && (
                <span style={{ color: marketData.spyChg >= 0 ? C.green : C.red, marginLeft: 4 }}>
                  {marketData.spyChg >= 0 ? '+' : ''}{marketData.spyChg.toFixed(2)}%
                </span>
              )}
            </span>
          )}
          {!marketData.spy && (
            <span style={{ color: C.muted }}>SPY — &nbsp; QQQ —</span>
          )}
          {/* Regime badge */}
          <span style={{
            border: `1px solid ${C.amber}`, color: C.amber,
            background: 'rgba(245,166,35,0.08)',
            borderRadius: 4, padding: '1px 7px', fontSize: '0.68rem', fontWeight: 700,
            letterSpacing: '0.04em', whiteSpace: 'nowrap',
          }}>
            {regimeBadge}
          </span>
        </div>

        {/* Right: clock */}
        <div style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: C.muted, flexShrink: 0 }}>
          {clock}
        </div>
      </header>

      {/* ── BODY ── */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Left panel */}
        <div style={{ width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <LeftPanel
            watchlist={watchlist}
            selectedTicker={selectedTicker}
            tradeType={tradeType}
            tradeTypeValue={tradeType}
            onLoadTicker={handleLoadTicker}
            onRemove={handleRemoveFromWatchlist}
            onTradeTypeChange={handleTradeTypeChange}
            openTradeSet={openTradeSet}
            alertTickerSet={alertTickerSet}
            verdicts={verdicts}
          />
        </div>

        {/* Right panel */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
          {/* Ticker header */}
          {selectedTicker && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '0 24px', height: 52,
              borderBottom: `1px solid ${C.border}`,
              background: C.bgPanel, flexShrink: 0, flexWrap: 'wrap',
            }}>
              <span style={{ fontFamily: 'monospace', fontWeight: 900, fontSize: '1.5rem', color: '#fff' }}>
                {selectedTicker}
              </span>
              {analysis?.company_name && (
                <span style={{ fontSize: '0.85rem', color: C.muted }}>{analysis.company_name}</span>
              )}
              {priceNum != null && (
                <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '1.2rem', color: '#fff' }}>
                  ${priceNum.toFixed(2)}
                </span>
              )}
              {changePct != null && (
                <span style={{
                  background: changePct >= 0 ? 'rgba(0,229,160,0.12)' : 'rgba(255,77,109,0.12)',
                  color: changePct >= 0 ? C.green : C.red,
                  borderRadius: 6, padding: '2px 8px', fontSize: '0.78rem', fontWeight: 700, fontFamily: 'monospace',
                }}>
                  {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
                </span>
              )}
              {/* Trade type badge */}
              <span style={{
                background: 'rgba(74,124,255,0.15)', color: C.accent,
                border: `1px solid ${C.accent}`, borderRadius: 6,
                padding: '2px 10px', fontSize: '0.72rem', fontWeight: 700,
                letterSpacing: '0.04em', textTransform: 'uppercase', marginLeft: 'auto',
              }}>
                {tradeType}
              </span>
              {/* Watchlist add */}
              <button
                type="button"
                onClick={() => void handleAddToWatchlist()}
                style={{
                  background: 'transparent', border: `1px solid ${C.borderSub}`,
                  color: C.muted, borderRadius: 6, padding: '3px 10px',
                  fontSize: '0.72rem', cursor: 'pointer',
                }}
              >
                + Watchlist
              </button>
              {/* Refresh */}
              <button
                type="button"
                onClick={() => void fetchAnalysis(selectedTicker, tradeType)}
                disabled={analysisLoading || analysisRefreshing}
                style={{
                  background: 'transparent', border: 'none',
                  color: analysisLoading || analysisRefreshing ? C.muted : '#fff',
                  cursor: 'pointer', fontSize: '0.8rem', padding: '2px 4px',
                }}
                aria-label="Refresh"
              >
                {analysisLoading || analysisRefreshing ? '⟳' : '↺'}
              </button>
            </div>
          )}

          {/* Tab strip */}
          <div style={{
            display: 'flex', borderBottom: `1px solid ${C.border}`,
            background: C.bgPanel, flexShrink: 0, padding: '0 24px',
          }}>
            {(['verdict', 'journal', 'alerts'] as Tab[]).map(tab => {
              const label = tab === 'alerts'
                ? `Alerts${alertCount > 0 ? '' : ''}`
                : tab.charAt(0).toUpperCase() + tab.slice(1)
              const active = activeTab === tab
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  style={{
                    background: 'transparent', border: 'none', borderBottom: active ? `2px solid ${C.accent}` : '2px solid transparent',
                    color: active ? '#fff' : C.muted, padding: '10px 16px 9px',
                    fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', position: 'relative',
                  }}
                >
                  {label}
                  {tab === 'alerts' && alertCount > 0 && (
                    <span style={{
                      background: C.red, color: '#fff', borderRadius: 10,
                      fontSize: '0.62rem', fontWeight: 700, padding: '1px 5px',
                      marginLeft: 5, verticalAlign: 'middle',
                    }}>
                      {alertCount}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
            {activeTab === 'verdict' && (
              <VerdictTab
                analysis={analysis}
                loading={analysisLoading}
                openTrade={openTradeForCurrent}
                tradeType={tradeType}
                onLogTrade={() => setDrawer(
                  openTradeForCurrent
                    ? { type: 'log-close', trade: openTradeForCurrent }
                    : { type: 'log-new' }
                )}
                onSetAlert={() => setDrawer({ type: 'alert' })}
                onRefresh={() => void fetchAnalysis(selectedTicker, tradeType)}
                refreshing={analysisRefreshing}
                onNavigateFullAnalysis={() => {
                  if (tradeType === 'swing') navigate('/swing-trade')
                  else navigate('/day-trade')
                }}
                ticker={selectedTicker}
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
          structure={(analysis as unknown as Record<string, unknown>)?.structure as string || ''}
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
