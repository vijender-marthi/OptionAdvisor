import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

// ── Responsive breakpoints ─────────────────────────────────────────────────
function useWindowWidth() {
  const [w, setW] = useState(() => typeof window !== 'undefined' ? window.innerWidth : 1280)
  useEffect(() => {
    const fn = () => setW(window.innerWidth)
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])
  return w
}
// mobile < 640, tablet 640–1023, desktop ≥ 1024
import { deskApi, analyzeV2 } from '../api/client'
import type {
  DeskWatchlistItem, DeskTradeLog, DeskTradeStats, DeskAlert,
  DeskTradeCreate, DeskTradeUpdate, DeskAlertCreate,
  UnifiedAnalysis,
} from '../api/client'

import UnifiedVerdictCard from '../components/UnifiedVerdictCard'
import LeftPanel from '../components/desk/LeftPanel'
import JournalTab from '../components/desk/JournalTab'
import AlertsTab from '../components/desk/AlertsTab'
import LogTradeDrawer from '../components/desk/LogTradeDrawer'
import SetAlertDrawer from '../components/desk/SetAlertDrawer'

type Analysis = UnifiedAnalysis | null
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

export default function TradeDeskPage() {
  const navigate = useNavigate()
  const windowWidth = useWindowWidth()
  const isMobile = windowWidth < 640
  const isTablet = windowWidth >= 640 && windowWidth < 1024
  const isDesktop = windowWidth >= 1024

  // Left panel open/close (mobile/tablet toggle)
  const [panelOpen, setPanelOpen] = useState(false)
  // Drawer left offset = panel width when panel is visible inline
  const drawerLeft = isDesktop ? 300 : 0

  // Core state
  const [selectedTicker, setSelectedTicker] = useState('')
  const [tradeType, setTradeType] = useState<'day' | 'swing'>('day')
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

  const [marketData, setMarketData] = useState<{
    spy?: number; spyChg?: number
    qqq?: number; qqqChg?: number
    vix?: number; vixLabel?: string
    regime?: string; signalTone?: string
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
      setWatchlist(data.filter(i => i.trade_type !== 'regular'))
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
    const tt = (type || tradeTypeRef.current) as 'day' | 'swing'
    if (!t) return
    setAnalysis(prev => prev ? (setAnalysisRefreshing(true), prev) : (setAnalysisLoading(true), null))
    try {
      const res = await analyzeV2(t, tt)
      const data: UnifiedAnalysis = res.data
      setAnalysis(data)
      setVerdicts(prev => ({ ...prev, [`${t}:${tt}`]: data.verdict }))
      // Supplement market strip from analysis response
      setMarketData(prev => ({
        ...prev,
        ...(data.spy_change_pct != null ? { spyChg: data.spy_change_pct } : {}),
        ...(data.qqq_change_pct != null ? { qqqChg: data.qqq_change_pct } : {}),
        ...(data.vix != null ? { vix: data.vix, vixLabel: data.vix_label } : {}),
        ...(data.regime ? { regime: data.regime } : {}),
      }))
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

    const pollId = setInterval(() => {
      fetchWatchlist()
      fetchAlerts()
    }, 60_000)

    return () => {
      clearInterval(pollId)
    }
  }, [fetchWatchlist, fetchAlerts])

  useEffect(() => {
    if (watchlist.length > 0 && !selectedTicker) {
      const first = watchlist[0]
      setSelectedTicker(first.ticker)
      setTradeType((first.trade_type === 'swing' ? 'swing' : 'day') as 'day' | 'swing')
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

  const handleTradeTypeChange = useCallback((tt: 'day' | 'swing') => {
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

  const plannedEntry = analysis?.entry_price ?? undefined
  const plannedStop = analysis?.stop_price ?? undefined

  const priceNum = analysis?.price ?? undefined
  const changePct = analysis?.change_pct ?? undefined

  // Trade type badge label
  const tradeTypeBadgeLabel: Record<string, string> = {
    day:   'DAY TRADE · 1-2 DTE',
    swing: 'SWING TRADE · 15 DTE',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', background: C.bgPage, color: '#fff', fontFamily: 'sans-serif' }}>
      {/* ── TOPBAR (hamburger only — logo + market data in global MarketStrip) ── */}
      {!isDesktop && (
        <header style={{
          display: 'flex', alignItems: 'center', height: 44, padding: '0 12px',
          background: C.bgPage, borderBottom: `1px solid ${C.border}`,
          flexShrink: 0,
        }}>
          <button
            type="button"
            onClick={() => setPanelOpen(o => !o)}
            aria-label="Toggle panel"
            style={{
              background: 'transparent', border: `1px solid ${C.borderSub}`,
              color: C.muted, borderRadius: 6, padding: '4px 8px',
              fontSize: '1rem', cursor: 'pointer', lineHeight: 1,
            }}
          >
            ☰
          </button>
        </header>
      )}

      {/* ── BODY ── */}
      <div style={{ display: 'flex', flexDirection: isDesktop ? 'row' : 'column', flex: 1, minHeight: 0 }}>

        {/* Mobile/tablet search toggle */}
        {!isDesktop && (
          <div style={{ padding: '4px 12px', flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => setPanelOpen(p => !p)}
            style={{
              background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 10,
              color: C.muted, padding: '10px 16px', fontSize: '0.82rem', fontWeight: 600,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, width: '100%',
            }}
          >
            <span style={{ fontSize: '1rem' }}>☰</span>
            {panelOpen ? 'Hide search' : 'Show search'}
          </button>
          </div>
        )}

        {/* Mobile/tablet overlay backdrop */}
        {!isDesktop && panelOpen && (
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 40 }}
            onClick={() => setPanelOpen(false)}
          />
        )}

        {/* Left panel — always visible on desktop */}
        {isDesktop && (
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
        )}

        {/* Mobile/tablet left panel overlay */}
        {!isDesktop && panelOpen && (
          <div style={{
            position: 'fixed', top: 0, bottom: 0, left: 0, zIndex: 50, width: 300,
            display: 'flex', flexDirection: 'column',
          }}>
            <LeftPanel
              watchlist={watchlist}
              selectedTicker={selectedTicker}
              tradeType={tradeType}
              tradeTypeValue={tradeType}
              onLoadTicker={ticker => { handleLoadTicker(ticker); setPanelOpen(false) }}
              onRemove={handleRemoveFromWatchlist}
              onTradeTypeChange={handleTradeTypeChange}
              openTradeSet={openTradeSet}
              alertTickerSet={alertTickerSet}
              verdicts={verdicts}
            />
          </div>
        )}

        {/* Right panel */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
          {/* Ticker header (Day Trade style) */}
          {analysis && (
            <div style={{ background: C.bgPanel, borderBottom: `1px solid ${C.border}`, padding: '14px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: '1.3rem', fontWeight: 700, fontFamily: 'monospace', color: '#E8EBF0' }}>{analysis.ticker}</span>
                  {analysis.company && <span style={{ fontSize: '0.78rem', color: C.muted }}>{analysis.company}</span>}
                  <span style={{ fontSize: '1.1rem', fontWeight: 700, fontFamily: 'monospace', color: '#E8EBF0' }}>${analysis.price.toFixed(2)}</span>
                  {analysis.change_pct != null && (
                    <span style={{ fontSize: '0.82rem', fontWeight: 600, color: analysis.change_pct >= 0 ? C.green : C.red }}>
                      {analysis.change_pct >= 0 ? '▲' : '▼'} {Math.abs(analysis.change_pct).toFixed(2)}%
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {analysis.session && (
                    <span style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 20, border: `1px solid ${C.purple}40`, color: C.purple, background: 'rgba(107,127,212,0.08)' }}>
                      {analysis.session}
                    </span>
                  )}
                  <button type="button" onClick={() => void fetchAnalysis(selectedTicker, tradeType)} disabled={analysisLoading || analysisRefreshing}
                    style={{ background: 'transparent', border: 'none', color: analysisLoading || analysisRefreshing ? C.muted : '#fff', cursor: 'pointer', fontSize: '0.9rem', padding: '2px 4px' }}
                    aria-label="Refresh">
                    {analysisLoading || analysisRefreshing ? '⟳' : '↺'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Tab strip */}
          <div style={{
            display: 'flex', borderBottom: `1px solid ${C.border}`,
            background: C.bgPanel, flexShrink: 0,
            padding: isMobile ? '0 8px' : '0 24px',
          }}>
            {(['verdict', 'journal', 'alerts'] as Tab[]).map(tab => {
              const label = tab.charAt(0).toUpperCase() + tab.slice(1)
              const active = activeTab === tab
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  style={{
                    background: 'transparent', border: 'none',
                    borderBottom: active ? `2px solid ${C.accent}` : '2px solid transparent',
                    color: active ? '#fff' : C.muted,
                    padding: isMobile ? '9px 12px 8px' : '10px 16px 9px',
                    fontSize: isMobile ? '0.78rem' : '0.82rem',
                    fontWeight: 600, cursor: 'pointer', position: 'relative',
                  }}
                >
                  {label}
                  {tab === 'alerts' && alertCount > 0 && (
                    <span style={{
                      background: C.red, color: '#fff', borderRadius: 10,
                      fontSize: '0.58rem', fontWeight: 700, padding: '1px 5px',
                      marginLeft: 4, verticalAlign: 'middle',
                    }}>
                      {alertCount}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '12px' : '20px 24px' }}>
            {activeTab === 'verdict' && analysis && (
              <div>
                <UnifiedVerdictCard analysis={analysis} />
                {/* Entry Plan / Risk Profile */}
                <div style={{ background: C.bgPanel, border: `1px solid ${C.border}`, borderRadius: 14, padding: '14px 16px', marginBottom: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <div style={{ fontSize: '0.68rem', fontWeight: 700, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>Entry Plan</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: `1px solid ${C.border}` }}>
                        <span style={{ color: C.muted, fontSize: '0.82rem' }}>Entry</span>
                        <span style={{ fontFamily: 'monospace', fontWeight: 700, color: analysis.entry_price ? C.green : C.amber, fontSize: '0.82rem' }}>{analysis.entry_price ? `$${analysis.entry_price.toFixed(2)}` : '—'}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: `1px solid ${C.border}` }}>
                        <span style={{ color: C.muted, fontSize: '0.82rem' }}>Structure</span>
                        <span style={{ fontFamily: 'monospace', color: '#E8EBF0', fontSize: '0.82rem' }}>{analysis.structure || '—'}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0' }}>
                        <span style={{ color: C.muted, fontSize: '0.82rem' }}>Stop Loss</span>
                        <span style={{ fontFamily: 'monospace', fontWeight: 700, color: analysis.stop_price ? C.red : C.muted, fontSize: '0.82rem' }}>{analysis.stop_price ? `$${analysis.stop_price.toFixed(2)}` : '—'}</span>
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.68rem', fontWeight: 700, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>Risk Profile</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: `1px solid ${C.border}` }}>
                        <span style={{ color: C.muted, fontSize: '0.82rem' }}>R/R Ratio</span>
                        <span style={{ fontFamily: 'monospace', color: C.muted, fontSize: '0.82rem' }}>{analysis.rr_ratio || '—'}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: `1px solid ${C.border}` }}>
                        <span style={{ color: C.muted, fontSize: '0.82rem' }}>Risk Level</span>
                        <span style={{ fontFamily: 'monospace', fontWeight: 700, color: analysis.risk_level === 'LOW' ? C.green : analysis.risk_level === 'MEDIUM' ? C.amber : C.red, fontSize: '0.82rem' }}>{analysis.risk_level || '—'}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0' }}>
                        <span style={{ color: C.muted, fontSize: '0.82rem' }}>RVOL</span>
                        <span style={{ fontFamily: 'monospace', fontWeight: 700, color: C.muted, fontSize: '0.82rem' }}>{analysis.rvol || '—'}</span>
                      </div>
                    </div>
                  </div>
                </div>
                {/* Exit Plan */}
                <div style={{ background: C.bgPanel, border: `1px solid ${C.border}`, borderRadius: 14, padding: '14px 16px', marginBottom: 12 }}>
                  <div style={{ fontSize: '0.68rem', fontWeight: 700, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>Exit Plan — Pre-Committed</div>
                  {analysis.exit_rows.length > 0 ? (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                      <thead>
                        <tr>{['WHEN', 'PRICE', 'ACTION'].map(h => <th key={h} style={{ textAlign: 'left', color: C.muted, fontWeight: 600, paddingBottom: 8, fontSize: '0.68rem', letterSpacing: '0.06em', borderBottom: `1px solid ${C.border}` }}>{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {analysis.exit_rows.map((row, i) => {
                          const priceCls = row.type === 'stop' ? C.red : row.type === 't2' ? C.amber : row.type === 't1' ? C.green : C.muted
                          return (
                            <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                              <td style={{ paddingTop: 8, paddingBottom: 8, color: '#E8EBF0', fontFamily: 'monospace', fontSize: '0.75rem' }}>{row.when}</td>
                              <td style={{ paddingTop: 8, paddingBottom: 8, fontFamily: 'monospace', fontWeight: 700, color: priceCls }}>{row.price}</td>
                              <td style={{ paddingTop: 8, paddingBottom: 8, color: C.muted, fontSize: '0.75rem' }}>{row.action}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <div style={{ color: C.muted, textAlign: 'center', padding: '8px 0', fontSize: '0.8rem' }}>Run full analysis for detailed exit levels</div>
                  )}
                </div>
                {/* AI Coach */}
                {analysis.coach && (
                  <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px', display: 'flex', gap: 14, marginBottom: 12 }}>
                    <div style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0, background: 'rgba(74,124,255,0.12)', border: '1px solid rgba(74,124,255,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem' }}>🎯</div>
                    <div>
                      <div style={{ fontSize: '0.68rem', fontWeight: 700, color: C.accent, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>AI Coach</div>
                      <div style={{ color: C.muted, fontSize: '0.82rem', lineHeight: 1.6 }}>{analysis.coach}</div>
                    </div>
                  </div>
                )}

                {/* Links to full engine pages */}
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button type="button" onClick={() => navigate(`/${tradeType === 'day' ? 'day-trade' : 'swing-trade'}?ticker=${encodeURIComponent(analysis.ticker)}`)}
                    style={{ flex: 1, padding: '10px 0', borderRadius: 10, fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer', background: 'transparent', border: `1px solid ${C.borderSub}`, color: C.muted, textAlign: 'center' }}>
                    Open in {tradeType === 'day' ? 'Day Trade' : 'Swing Trade'} →
                  </button>
                </div>
              </div>
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
          signalGiven={analysis?.verdict || ''}
          confidence={analysis?.confidence}
          plannedEntry={plannedEntry}
          plannedStop={plannedStop}
          structure={analysis?.structure || ''}
          onClose={() => setDrawer(null)}
          onSubmit={handleLogTrade}
          drawerLeft={drawerLeft}
        />
      )}
      {drawer?.type === 'log-close' && (
        <LogTradeDrawer
          mode="close"
          trade={drawer.trade}
          onClose={() => setDrawer(null)}
          onSubmit={data => handleCloseTrade(drawer.trade, data)}
          drawerLeft={drawerLeft}
        />
      )}
      {drawer?.type === 'alert' && selectedTicker && (
        <SetAlertDrawer
          ticker={selectedTicker}
          tradeType={tradeType}
          onClose={() => setDrawer(null)}
          onSubmit={handleCreateAlert}
          drawerLeft={drawerLeft}
        />
      )}
    </div>
  )
}
