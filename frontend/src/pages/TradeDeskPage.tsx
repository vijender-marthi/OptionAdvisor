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

// ── Timezone options ───────────────────────────────────────────────────────
const TIMEZONE_OPTIONS = [
  { label: 'ET', tz: 'America/New_York' },
  { label: 'CT', tz: 'America/Chicago' },
  { label: 'MT', tz: 'America/Denver' },
  { label: 'PT', tz: 'America/Los_Angeles' },
]

function getSessionColor(session: string): string {
  switch (session) {
    case 'Opening':     return '#00E5A0'
    case 'Power Hour':  return '#00E5A0'
    case 'Morning':     return '#F5A623'
    case 'Closing':     return '#F5A623'
    case 'Midday':      return '#5A6478'
    case 'Pre-Market':  return '#6B7FD4'
    case 'After-Hours': return '#6B7FD4'
    case 'Closed':      return '#3A4255'
    default:            return '#5A6478'
  }
}

function etClock(tz: string): { time: string; session: string } {
  const t = new Date().toLocaleTimeString('en-US', {
    timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true,
  })
  const h = new Date().toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false })
  const hNum = parseInt(h)
  const session =
    hNum < 4  ? 'Closed' :
    hNum < 9  ? 'Pre-Market' :
    hNum < 10 ? 'Opening' :
    hNum < 12 ? 'Morning' :
    hNum < 14 ? 'Midday' :
    hNum < 15 ? 'Power Hour' :
    hNum < 16 ? 'Closing' :
    hNum < 20 ? 'After-Hours' :
                'Closed'
  const tzLabel = TIMEZONE_OPTIONS.find(o => o.tz === tz)?.label || 'ET'
  return { time: `${t} ${tzLabel}`, session }
}

export default function TradeDeskPage() {
  const navigate = useNavigate()
  const windowWidth = useWindowWidth()
  const isMobile = windowWidth < 640
  const isTablet = windowWidth >= 640 && windowWidth < 1024
  const isDesktop = windowWidth >= 1024

  // Left panel open/close (mobile: overlay, tablet: collapsible rail)
  const [panelOpen, setPanelOpen] = useState(false)
  // On desktop always show panel; on tablet/mobile controlled by panelOpen
  const showPanel = isDesktop || panelOpen
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

  // Timezone preference
  const [userTz, setUserTz] = useState(() => localStorage.getItem('desk_tz') || 'America/New_York')
  const [showTzPicker, setShowTzPicker] = useState(false)

  // Topbar market
  const [clock, setClock] = useState<{ time: string; session: string }>(() => etClock(userTz))
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
      const d = res.data as Record<string, unknown> | null
      if (d) {
        const vixNum = (d.vix ?? d.vix_price) as number | undefined
        setMarketData(prev => ({
          ...prev,
          spy:      (d.spy_price ?? d.spy) as number | undefined,
          spyChg:   (d.spy_change_pct ?? d.spy_chg ?? d.spyChg) as number | undefined,
          qqq:      (d.qqq_price ?? d.qqq) as number | undefined,
          qqqChg:   (d.qqq_change_pct ?? d.qqq_chg ?? d.qqqChg) as number | undefined,
          vix:      vixNum,
          vixLabel: (d.vix_label as string | undefined) ?? (
            vixNum == null ? undefined :
            vixNum < 15 ? 'Low' : vixNum < 20 ? 'Contained' : vixNum < 25 ? 'Elevated' : 'High'
          ),
          regime:     (d.signal_label ?? d.position_signal ?? d.regime) as string | undefined,
          signalTone: d.signal_tone as string | undefined,
        }))
      }
    } catch { /* ignore */ }
  }, [])

  // ── Mount effects ──────────────────────────────────────────────────────────

  useEffect(() => {
    fetchWatchlist()
    fetchTrades()
    fetchAlerts()
    loadMarketData()

    const clockId = setInterval(() => setClock(etClock(userTz)), 30_000)
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

  // Re-tick clock when timezone changes
  useEffect(() => { setClock(etClock(userTz)) }, [userTz])

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

  const handleTzChange = (tz: string) => {
    setUserTz(tz)
    localStorage.setItem('desk_tz', tz)
    setShowTzPicker(false)
    setClock(etClock(tz))
  }

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

  // Market regime badge color
  const regimeBadgeColor = (() => {
    const tone = marketData.signalTone
    if (tone === 'green') return C.green
    if (tone === 'red') return C.red
    return C.amber
  })()
  const regimeBadgeBg = (() => {
    const tone = marketData.signalTone
    if (tone === 'green') return 'rgba(0,229,160,0.08)'
    if (tone === 'red') return 'rgba(255,77,109,0.08)'
    return 'rgba(245,166,35,0.08)'
  })()
  const regimeBadgeLabel = marketData.regime || 'NEUTRAL MARKET'

  // Trade type badge label
  const tradeTypeBadgeLabel: Record<string, string> = {
    day:   'DAY TRADE · 1-2 DTE',
    swing: 'SWING TRADE · 15 DTE',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: C.bgPage, color: '#fff', overflow: 'hidden', fontFamily: 'sans-serif' }}>
      {/* ── TOPBAR ── */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        height: 44, padding: '0 12px',
        background: C.bgPage, borderBottom: `1px solid ${C.border}`,
        flexShrink: 0, gap: 8,
      }}>
        {/* Left: hamburger (mobile/tablet) + logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {!isDesktop && (
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
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
            <span style={{ fontWeight: 700, fontSize: '0.92rem', color: '#fff' }}>Option</span>
            <span style={{ fontWeight: 700, fontSize: '0.92rem', color: C.green }}>Advisor</span>
          </div>
        </div>

        {/* Center: market strip — condensed on mobile */}
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 10 : 20, fontFamily: 'monospace', fontSize: '0.72rem', overflow: 'hidden', flex: 1, justifyContent: 'center' }}>
          <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: C.green, boxShadow: `0 0 6px ${C.green}`, flexShrink: 0 }} />
          {/* SPY — always visible */}
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', color: C.muted }}>
            SPY
            {marketData.spy
              ? <><span style={{ color: '#fff', fontWeight: 700 }}>${marketData.spy.toFixed(2)}</span>{marketData.spyChg !== undefined && <span style={{ color: marketData.spyChg >= 0 ? C.green : C.red }}>{marketData.spyChg >= 0 ? '+' : ''}{marketData.spyChg.toFixed(2)}%</span>}</>
              : <span style={{ color: C.muted }}>—</span>
            }
          </span>
          {/* QQQ — hide on mobile */}
          {!isMobile && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', color: C.muted }}>
              QQQ
              {marketData.qqq
                ? <><span style={{ color: '#fff', fontWeight: 700 }}>${marketData.qqq.toFixed(2)}</span>{marketData.qqqChg !== undefined && <span style={{ color: marketData.qqqChg >= 0 ? C.green : C.red }}>{marketData.qqqChg >= 0 ? '+' : ''}{marketData.qqqChg.toFixed(2)}%</span>}</>
                : <span style={{ color: C.muted }}>—</span>
              }
            </span>
          )}
          {/* VIX — hide on mobile */}
          {!isMobile && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', color: C.muted }}>
              VIX
              {marketData.vix != null
                ? <>
                    <span style={{ color: '#fff', fontWeight: 700 }}>{marketData.vix.toFixed(1)}</span>
                    <span style={{ color: marketData.vix <= 20 ? C.green : marketData.vix <= 25 ? C.amber : C.red }}>
                      {marketData.vixLabel || (marketData.vix <= 20 ? 'Contained' : marketData.vix <= 25 ? 'Elevated' : 'High')}
                    </span>
                  </>
                : <span style={{ color: C.muted }}>—</span>
              }
            </span>
          )}
          {/* Regime badge */}
          <span style={{
            border: `1px solid ${regimeBadgeColor}`, color: regimeBadgeColor,
            background: regimeBadgeBg,
            borderRadius: 20, padding: '3px 10px', fontSize: isMobile ? '0.62rem' : '0.7rem', fontWeight: 700,
            letterSpacing: '0.04em', whiteSpace: 'nowrap', textTransform: 'uppercase',
          }}>
            {regimeBadgeLabel}
          </span>
        </div>

        {/* Right: clock with timezone picker */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => setShowTzPicker(p => !p)}
            title="Click to change timezone"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontFamily: 'monospace', fontSize: '0.68rem', padding: '2px 4px', borderRadius: 4,
              display: 'flex', alignItems: 'center', gap: 0, whiteSpace: 'nowrap',
            }}
          >
            <span style={{ color: C.muted }}>{clock.time}</span>
            {!isMobile && (
              <span style={{ color: getSessionColor(clock.session), marginLeft: 4, fontWeight: 600 }}>
                · {clock.session}
              </span>
            )}
          </button>

          {showTzPicker && (
            <>
              <div onClick={() => setShowTzPicker(false)} style={{ position: 'fixed', inset: 0, zIndex: 90 }} />
              <div style={{
                position: 'absolute', top: '100%', right: 0, zIndex: 91,
                background: '#111318', border: `1px solid #252C3A`,
                borderRadius: 10, padding: '10px 0', minWidth: 160,
                boxShadow: '0 8px 24px rgba(0,0,0,0.4)', marginTop: 6,
              }}>
                <div style={{ padding: '4px 14px 8px', fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#5A6478' }}>
                  Timezone
                </div>
                {TIMEZONE_OPTIONS.map(opt => (
                  <button
                    key={opt.tz}
                    type="button"
                    onClick={() => handleTzChange(opt.tz)}
                    onMouseEnter={e => { e.currentTarget.style.background = '#181C23' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                      padding: '8px 14px', background: 'transparent', border: 'none',
                      color: userTz === opt.tz ? '#fff' : '#5A6478',
                      fontSize: '0.78rem', cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                      background: userTz === opt.tz ? '#4A7CFF' : 'transparent',
                      border: `1px solid ${userTz === opt.tz ? '#4A7CFF' : '#252C3A'}`,
                    }} />
                    <span style={{ fontFamily: 'monospace', fontWeight: 700, marginRight: 4 }}>{opt.label}</span>
                    <span style={{ fontSize: '0.7rem', color: '#3A4255' }}>
                      {opt.tz.split('/').pop()?.replace(/_/g, ' ')}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </header>

      {/* ── BODY ── */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, position: 'relative' }}>

        {/* Mobile/tablet overlay backdrop */}
        {!isDesktop && showPanel && (
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 40 }}
            onClick={() => setPanelOpen(false)}
          />
        )}

        {/* Left panel */}
        {showPanel && (
          <div style={{
            width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0,
            // On mobile/tablet: fixed overlay sliding from left
            ...(isDesktop ? {} : {
              position: 'fixed', top: 44, bottom: 0, left: 0, zIndex: 50,
            }),
          }}>
            <LeftPanel
              watchlist={watchlist}
              selectedTicker={selectedTicker}
              tradeType={tradeType}
              tradeTypeValue={tradeType}
              onLoadTicker={ticker => { handleLoadTicker(ticker); if (!isDesktop) setPanelOpen(false) }}
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
          {/* Ticker header */}
          {selectedTicker && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: isMobile ? '8px 12px' : '0 24px',
              minHeight: isMobile ? 'auto' : 52,
              borderBottom: `1px solid ${C.border}`,
              background: C.bgPanel, flexShrink: 0, flexWrap: 'wrap',
            }}>
              <span style={{ fontFamily: 'monospace', fontWeight: 900, fontSize: isMobile ? '1.2rem' : '1.5rem', color: '#fff' }}>
                {selectedTicker}
              </span>
              {analysis?.company_name && !isMobile && (
                <span style={{ fontSize: '0.82rem', color: C.muted }}>{analysis.company_name}</span>
              )}
              {priceNum != null && (
                <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: isMobile ? '1rem' : '1.2rem', color: '#fff' }}>
                  ${priceNum.toFixed(2)}
                </span>
              )}
              {changePct != null && (
                <span style={{
                  background: changePct >= 0 ? 'rgba(0,229,160,0.12)' : 'rgba(255,77,109,0.12)',
                  color: changePct >= 0 ? C.green : C.red,
                  borderRadius: 6, padding: '2px 7px', fontSize: '0.75rem', fontWeight: 700, fontFamily: 'monospace',
                }}>
                  {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
                </span>
              )}
              {/* Trade type badge — hide on mobile */}
              {!isMobile && (
                <span style={{
                  border: `1px solid ${C.borderSub}`, color: C.muted,
                  background: 'transparent', borderRadius: 6,
                  padding: '4px 10px', fontSize: '0.6rem', fontWeight: 600,
                  letterSpacing: '0.05em', textTransform: 'uppercase',
                  fontFamily: 'monospace', marginLeft: 'auto', whiteSpace: 'nowrap',
                }}>
                  {tradeTypeBadgeLabel[tradeType] || tradeType.toUpperCase()}
                </span>
              )}
              {/* Watchlist add */}
              <button
                type="button"
                onClick={() => void handleAddToWatchlist()}
                style={{
                  background: 'transparent', border: `1px solid ${C.borderSub}`,
                  color: C.muted, borderRadius: 6, padding: '3px 8px',
                  fontSize: '0.7rem', cursor: 'pointer',
                  marginLeft: isMobile ? 'auto' : undefined,
                }}
              >
                + Watch
              </button>
              {/* Refresh */}
              <button
                type="button"
                onClick={() => void fetchAnalysis(selectedTicker, tradeType)}
                disabled={analysisLoading || analysisRefreshing}
                style={{
                  background: 'transparent', border: 'none',
                  color: analysisLoading || analysisRefreshing ? C.muted : '#fff',
                  cursor: 'pointer', fontSize: '0.9rem', padding: '2px 4px',
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
            {activeTab === 'verdict' && (
              <VerdictTab
                analysis={analysis}
                loading={analysisLoading}
                openTrade={openTradeForCurrent}
                tradeType={tradeType}
                compact={isMobile}
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
