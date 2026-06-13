import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowDown, ArrowLeft, ArrowUpRight, BarChart2, Bell, ChevronDown, ChevronRight,
  Clock, Flame, Loader2, RefreshCw, Search, ShieldAlert, X, Zap,
  PlusCircle, Activity, Check, Gauge,
} from 'lucide-react'
import { analyzeDayTrade, analyzeV2, deskApi, enterActiveTrade, saveToJournal } from '../api/client'
import type { DeskAlertCreate, UnifiedAnalysis } from '../api/client'
import type { DayTradeAlertEvent } from '../types'
import { fetchMyTickers, type MyTickerEntry } from '../api/commandCenter'
import SetAlertDrawer from '../components/desk/SetAlertDrawer'
import UnifiedVerdictCard from '../components/UnifiedVerdictCard'
import DayTradeIntradayChart, { parseChartBars, aggregate5mBars, type ChartEntryPoint, type ZoneAnnotation } from '../components/DayTradeIntradayChart'
import DayTradeAlertOverlay from '../components/DayTradeAlertOverlay'
import DayTradeWalkthrough from '../components/DayTradeWalkthrough'
import OptionsEntryCheck from '../components/OptionsEntryCheck'
import OvernightRunnerCard from '../components/OvernightRunnerCard'
import { MarketTimeGateBanner } from '../components/MarketTimeGate'
import EntryWindowBanner from '../components/EntryWindowBanner'
import TrendDayBanner from '../components/TrendDayBanner'
import { useApp } from '../contexts/AppContext'
import { ROUTES } from '../routing/routes'
import { getActionButtonClass } from '../utils/semanticTrading'

/* ── PCRatioStrip ─────────────────────────────────────────────────────── */

function fmtOptionsVol(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`
  return String(v)
}

function PCRatioStrip({
  pcRatio,
  totalOptionsVol,
  bias,
  isDark,
}: {
  pcRatio: number | null
  totalOptionsVol: number | null
  bias: string | null
  isDark: boolean
}) {
  const [tip, setTip] = useState(false)

  const borderB = isDark ? '0.5px solid rgba(255,255,255,0.08)' : '0.5px solid rgba(0,0,0,0.08)'

  if (pcRatio == null) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 44, padding: '0 4px', borderBottom: borderB, marginBottom: 12 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#444', flexShrink: 0 }} />
        <span style={{ fontSize: 10, color: '#888780', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Put/Call</span>
        <span style={{ fontSize: 14, color: '#444', fontFamily: 'monospace' }}>—</span>
        <span style={{ fontSize: 11, color: '#555' }}>No data</span>
      </div>
    )
  }

  let arrow: string, reading: string, dotColor: string, ratioColor: string
  if (pcRatio >= 1.20) {
    arrow = '▼'; reading = 'Bearish lean'; dotColor = '#E24B4A'; ratioColor = '#e07070'
  } else if (pcRatio >= 1.00) {
    arrow = '▼'; reading = 'Mild bearish'; dotColor = '#E87B3A'; ratioColor = '#e8a06a'
  } else if (pcRatio >= 0.80) {
    arrow = '→'; reading = 'Neutral'; dotColor = '#888780'; ratioColor = '#888780'
  } else if (pcRatio >= 0.60) {
    arrow = '▲'; reading = 'Mild bullish'; dotColor = '#E87B3A'; ratioColor = '#e8a06a'
  } else {
    arrow = '▲'; reading = 'Bullish lean'; dotColor = '#639922'; ratioColor = '#a3cc6a'
  }

  const isNeutral = pcRatio >= 0.80 && pcRatio < 1.00
  const biasUp = (bias ?? '').toUpperCase()
  const biasIsShort = biasUp === 'SHORT'
  const aligned = !isNeutral && ((biasIsShort && pcRatio >= 1.00) || (!biasIsShort && pcRatio <= 0.80))
  const conflict = !isNeutral && !aligned

  let badgeBg: string, badgeColor: string, alignLabel: string
  if (isNeutral) {
    badgeBg = 'rgba(136,135,128,0.15)'; badgeColor = '#888780'
    alignLabel = '— Neutral · no confirmation'
  } else if (aligned) {
    badgeBg = 'rgba(99,153,34,0.20)'; badgeColor = '#a3cc6a'
    alignLabel = `✓ Aligns with ${biasUp}`
  } else {
    badgeBg = 'rgba(226,75,74,0.20)'; badgeColor = '#e07070'
    alignLabel = `✗ Conflicts with ${biasUp} — size down`
  }

  return (
    <div
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px', height: 44, marginBottom: 12, position: 'relative', borderBottom: borderB, cursor: 'default' }}
      onMouseEnter={() => setTip(true)}
      onMouseLeave={() => setTip(false)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
        <span style={{ fontSize: 10, color: '#888780', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Put/Call</span>
        <span style={{ fontSize: 16, fontWeight: 500, color: ratioColor, fontFamily: 'monospace' }}>{pcRatio.toFixed(2)}</span>
        <span style={{ color: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)', fontSize: 14 }}>|</span>
        <span style={{ fontSize: 12, color: ratioColor }}>{arrow} {reading}</span>
        {bias && (
          <span style={{ fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 4, background: badgeBg, color: badgeColor, whiteSpace: 'nowrap' }}>
            {alignLabel}
          </span>
        )}
      </div>
      {totalOptionsVol != null && (
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 10, color: '#888780' }}>Total Vol</div>
          <div style={{ fontSize: 13, color: '#c2c0b6', fontFamily: 'monospace' }}>{fmtOptionsVol(totalOptionsVol)}</div>
        </div>
      )}
      {tip && (
        <div style={{ position: 'absolute', top: 48, left: 0, background: 'rgba(30,30,30,0.95)', border: '0.5px solid rgba(255,255,255,0.12)', borderRadius: 6, padding: '8px 12px', fontSize: 11, color: '#c2c0b6', maxWidth: 280, zIndex: 10, pointerEvents: 'none', lineHeight: 1.6 }}>
          P/C ratio above 1.0 = more puts traded than calls. Confirms bearish sentiment from prior session. Use as pre-market bias check — not a timing signal.
        </div>
      )}
    </div>
  )
}

function axiosDetail(e: unknown): string {
  const d = (e as { response?: { data?: { detail?: string } }; message?: string })?.response?.data?.detail
  if (typeof d === 'string') return d
  return (e as Error)?.message ?? 'Request failed'
}

export default function DayTradePage() {
  const {
    dayTradeEngineUI: ui,
    setDayTradeEngineUI: setUi,
    canAccessPage,
    navigate,
    addToWatchlist,
    isWatched,
    addManualPosition,
    portfolio,
    theme,
    user,
  } = useApp()

  const isDark = theme !== 'light'
  const dt = {
    bg:      isDark ? '#111318' : '#FFFFFF',
    bgDeep:  isDark ? '#181C23' : '#F8F9FB',
    border:  isDark ? '#1E2330' : '#E5E7EB',
    text:    isDark ? '#E8EBF0' : '#111827',
    muted:   isDark ? '#5A6478' : '#6B7280',
    green:   isDark ? '#00E5A0' : '#00A86B',
    red:     isDark ? '#FF4D6D' : '#DC2626',
    amber:   isDark ? '#F5A623' : '#D97706',
    accent:  '#4A7CFF',
    violet:  '#6B7FD4',
  }
  const [searchParams, setSearchParams] = useSearchParams()
  const routerNavigate = useNavigate()
  const { ticker, loading, refreshing, error, result, glossaryOpen } = ui

  const existingPositions = useMemo(
    () => portfolio.filter(p => p.ticker.toUpperCase() === result?.ticker?.toUpperCase() && p.status === 'open'),
    [portfolio, result?.ticker]
  )

  const [enterOpen, setEnterOpen] = useState(false)
  const [alertOpen, setAlertOpen] = useState(false)
  const [portfolioOpen, setPortfolioOpen] = useState(false)
  const [portfolioContracts, setPortfolioContracts] = useState('')
  const [portfolioStockPrice, setPortfolioStockPrice] = useState('')
  const [portfolioStrike, setPortfolioStrike] = useState('')
  const [portfolioEntryPrice, setPortfolioEntryPrice] = useState('1.00')
  const [portfolioExpiry, setPortfolioExpiry] = useState('')
  const [portfolioNotes, setPortfolioNotes] = useState('')
  const [portfolioErr, setPortfolioErr] = useState<string | null>(null)
  const [portfolioSubmitting, setPortfolioSubmitting] = useState(false)
  const [portfolioDfltDte, setPortfolioDfltDte] = useState(7)
  const [portfolioBias, setPortfolioBias] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'success' | 'info'; message: string } | null>(null)
  const [savedToJournal, setSavedToJournal] = useState(false)
  const [side, setSide] = useState<'CALL' | 'PUT'>('CALL')
  const [tradeMode, setTradeMode] = useState<'day' | 'swing'>('day')
  const [entryPrice, setEntryPrice] = useState('')
  const [contracts, setContracts] = useState('')
  const [strikeInput, setStrikeInput] = useState('')
  const [expiryInput, setExpiryInput] = useState('')
  const [notes, setNotes] = useState('')
  const [enterSubmitting, setEnterSubmitting] = useState(false)
  const [enterErr, setEnterErr] = useState<string | null>(null)
  const [myTickers, setMyTickers] = useState<string[]>([])
  const [myTickerFull, setMyTickerFull] = useState<MyTickerEntry[]>([])
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)
  const [unified, setUnified] = useState<UnifiedAnalysis | null>(null)
  const [ocKey, setOcKey]     = useState(0)
  const [scanCount, setScanCount] = useState(0)
  const [sessionState, setSessionState] = useState<'forming' | 'watch' | 'entry' | 'hold' | 'reentry' | 'exhausted'>('watch')
  const [chartInterval, setChartInterval] = useState<'1m' | '5m'>('1m')
  const prevScannedTickerRef = useRef('')

  useEffect(() => {
    fetchMyTickers().then(res => {
      const entries = (res.data?.tickers ?? [])
        .filter(t => (t.trade_types || []).includes('day'))
      setMyTickerFull(entries)
      setMyTickers(entries.map(t => t.symbol).filter(Boolean).slice(0, 10))
    }).catch(() => {})
  }, [])

  // Stable ref to read latest ticker without it being a useCallback dep
  const tickerRef = useRef(ticker)
  tickerRef.current = ticker

  const runScan = useCallback(async (overrideTicker?: string) => {
    const sym = (overrideTicker || tickerRef.current).trim().toUpperCase()
    if (!sym || sym.length > 12) {
      setUi(cur => ({ ...cur, error: 'Enter a valid ticker symbol.' }))
      return
    }
    // Write ticker to URL so sharing, refresh, and other tabs/browsers pick it up
    setSearchParams(prev => { const p = new URLSearchParams(prev); p.set('ticker', sym); return p }, { replace: true })
    // If a result already exists this is a background refresh — keep the stale
    // result visible so the panel doesn't collapse and rebuild during the fetch.
    setUi(cur => cur.result
      ? { ...cur, refreshing: true, error: null }
      : { ...cur, loading: true, error: null, result: null }
    )
    try {
      const data = await analyzeDayTrade(sym)
      setUi(cur => ({
        ...cur,
        loading: false,
        refreshing: false,
        ticker: data.ticker,
        result: data,
      }))
      setOcKey(k => k + 1)
      setScanCount(c => c + 1)
      try {
        const v2res = await analyzeV2(sym, 'day')
        setUnified(v2res.data)
      } catch { /* non-fatal */ }
      setLastRefreshed(new Date())
      } catch (e) {
      setUi(cur => ({
        ...cur,
        loading: false,
        refreshing: false,
        error: axiosDetail(e),
      }))
    }
  }, [setUi]) // stable — no ticker dependency

  // Reload on mount: use URL ticker, or default to SPY if none
  const didMountRef = useRef(false)
  const runScanRef = useRef(runScan)
  useEffect(() => { runScanRef.current = runScan }, [runScan])
  useEffect(() => {
    if (didMountRef.current) return
    didMountRef.current = true
    const urlT = searchParams.get('ticker')?.trim().toUpperCase()
    const sym = urlT && urlT.length <= 12 ? urlT : ticker.trim().toUpperCase() || 'SPY'
    if (sym !== ticker.trim().toUpperCase()) {
      setUi(cur => ({ ...cur, ticker: sym }))
    }
    runScan(sym)
  }, []) // eslint-disable-line

  // Re-scan when URL ticker changes (navigation from TCC, or another tab/browser pushes a new URL)
  // Guard: only fire when the URL ticker differs from the currently loaded result to avoid
  // an infinite loop with the setSearchParams call inside runScan.
  useEffect(() => {
    const t = searchParams.get('ticker')?.trim().toUpperCase()
    if (!t || t.length > 12 || !didMountRef.current) return
    const loaded = ui.result?.ticker?.toUpperCase()
    if (t !== loaded) {
      setUi(cur => ({ ...cur, ticker: t }))
      runScanRef.current(t)
    }
  // runScan intentionally excluded — use ref to avoid resetting ticker on each keystroke
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, setUi])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 2800)
    return () => clearTimeout(t)
  }, [notice])

  // Auto-refresh every 60 seconds when a result is loaded
  useEffect(() => {
    if (!result) return
    const id = setInterval(() => void runScan(), 60_000)
    return () => clearInterval(id)
  }, [result, runScan])

  const openEnterModal = useCallback(() => {
    if (!result) return
    const b = result.bias
    setSide(b === 'short' ? 'PUT' : 'CALL')
    setEntryPrice('')
    setContracts('')
    setStrikeInput('')
    setExpiryInput('')
    setNotes('')
    setEnterErr(null)
    setEnterOpen(true)
  }, [result])

  const handleAddToWatchlist = useCallback(() => {
    if (!result) return
    const already = isWatched(result.ticker)
    const ok = addToWatchlist({
      ticker: result.ticker,
      companyName: result.company_name || undefined,
      lastPrice: typeof result.metrics?.last_price === 'number' ? result.metrics.last_price : undefined,
      notes: `Day Trade · ${result.final_decision} · ${result.execution_readiness || result.execution_timing || 'WAIT'}`,
    })
    if (!ok) {
      setNotice({ tone: 'info', message: 'Unable to add this ticker to Signal Feed.' })
      return
    }
    setNotice({
      tone: already ? 'info' : 'success',
      message: already ? `${result.ticker} is already on Signal Feed.` : `${result.ticker} added to Signal Feed.`,
    })
  }, [addToWatchlist, isWatched, result])

  const handleSaveToJournal = useCallback(async () => {
    if (!result || !user?.email) return
    const eg = result.entry_guidance as Record<string, unknown> | undefined
    const lastPrice = typeof result.metrics?.last_price === 'number' ? result.metrics.last_price : 0
    const egState = typeof (eg?.state) === 'number' ? (eg.state as number) : 0
    const scalp = typeof eg?.scalp_target === 'number' ? (eg.scalp_target as number) : 0
    const stop = typeof eg?.risk_below === 'number' ? (eg.risk_below as number) : 0
    const maxProfit = scalp > lastPrice && lastPrice > 0 ? (scalp - lastPrice) / lastPrice : 0
    const maxLoss   = stop > 0 && lastPrice > stop ? (lastPrice - stop) / lastPrice : 0
    const verdict   = result.verdict ?? result.final_decision ?? ''
    const notes     = [
      verdict ? `Signal: ${verdict}` : '',
      scalp   ? `Target: $${scalp.toFixed(2)}` : '',
      stop    ? `Stop: $${stop.toFixed(2)}` : '',
      (result.metrics as Record<string, unknown>)?.entry_rr_ratio
        ? `R/R: ${(result.metrics as Record<string, unknown>).entry_rr_ratio}` : '',
    ].filter(Boolean).join(' · ')
    try {
      await saveToJournal(user.email, {
        ticker:           result.ticker,
        company_name:     result.company_name || '',
        strategy:         result.bias === 'short' ? 'Long Put' : 'Long Call',
        trade_type:       'day',
        bias:             result.bias === 'long' ? 'Bullish' : result.bias === 'short' ? 'Bearish' : 'Neutral',
        legs:             [],
        expiry:           new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
        entry_date:       new Date().toISOString().split('T')[0],
        dte_at_entry:     7,
        net_credit:       0,
        max_profit:       maxProfit,
        max_loss:         maxLoss,
        underlying_entry: lastPrice,
        prob_of_profit:   0,
        expected_value:   0,
        total_score:      result.confidence ?? 0,
        engine_signal:    verdict,
        engine_state:     egState,
        notes,
      })
      setSavedToJournal(true)
      setTimeout(() => setSavedToJournal(false), 4000)
    } catch { /* non-fatal */ }
  }, [result, user?.email])

  const handleCreateAlert = useCallback(async (data: DeskAlertCreate) => {
    await deskApi.createAlert(data)
    setAlertOpen(false)
  }, [])

  const openPortfolioModal = useCallback(() => {
    if (!result) return
    const eg = result.entry_guidance as Record<string, unknown> | null | undefined
    const m = result.metrics as Record<string, unknown>
    const lastU = typeof m.last_price === 'number' ? m.last_price : 0
    const bias = result.bias ?? 'neutral'
    // Next Friday as default expiry
    const nextFri = new Date()
    nextFri.setDate(nextFri.getDate() + ((5 + 7 - nextFri.getDay()) % 7 || 7))
    const dfltExpiry = nextFri.toISOString().slice(0, 10)
    const dfltDte = Math.ceil((nextFri.getTime() - Date.now()) / 86400000)
    const pt = eg?.premium_targets as Record<string, unknown> | undefined
    const atmPremium = pt?.atm_premium != null && typeof pt.atm_premium === 'number' ? pt.atm_premium : null
    setPortfolioContracts('1')
    setPortfolioStockPrice(lastU > 0 ? lastU.toFixed(2) : '')
    setPortfolioStrike(lastU > 0 ? lastU.toFixed(2) : '')
    setPortfolioEntryPrice(atmPremium != null && atmPremium > 0 ? atmPremium.toFixed(2) : '1.00')
    setPortfolioExpiry(dfltExpiry)
    setPortfolioNotes('')
    setPortfolioErr(null)
    // Store defaults for submit
    setPortfolioDfltDte(dfltDte)
    setPortfolioBias(bias)
    setPortfolioOpen(true)
  }, [result])

  const submitPortfolio = useCallback(() => {
    if (!result) return
    const c = parseInt(portfolioContracts, 10)
    if (!Number.isFinite(c) || c <= 0) {
      setPortfolioErr('Contracts must be a positive whole number.')
      return
    }
    let ep = 1.00
    if (portfolioEntryPrice.trim()) {
      ep = parseFloat(portfolioEntryPrice)
      if (!Number.isFinite(ep) || ep < 0) {
        setPortfolioErr('Premium paid must be a positive number.')
        return
      }
    }
    const strikeVal = parseFloat(portfolioStrike)
    const stockPriceVal = parseFloat(portfolioStockPrice)
    let expiryOut = ''
    if (portfolioExpiry.trim()) {
      const ex = portfolioExpiry.trim().slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ex)) {
        setPortfolioErr('Expiry must be YYYY-MM-DD.')
        return
      }
      expiryOut = ex
    }
    const lastU = typeof result.metrics?.last_price === 'number' ? result.metrics.last_price as number : 0
    const bias = portfolioBias || result.bias || 'neutral'
    const direction = bias === 'short' ? 'Bearish' : 'Bullish'
    const strategy = bias === 'short' ? 'Long Put' : 'Long Call'
    const dteVal = expiryOut
      ? Math.max(1, Math.ceil((new Date(expiryOut + 'T00:00:00').getTime() - Date.now()) / 86400000))
      : portfolioDfltDte || 1
    setPortfolioSubmitting(true)
    const isPut = bias === 'short'
    addManualPosition({
      ticker: result.ticker,
      companyName: result.company_name ?? result.ticker,
      strategy,
      bias: direction,
      legs: [{
        action: 'BUY' as const,
        option_type: isPut ? 'PUT' as const : 'CALL' as const,
        strike: Number.isFinite(strikeVal) && strikeVal > 0 ? strikeVal : 0,
        expiry: expiryOut,
        mid_price: ep,
        delta: 0,
        bid: 0,
        ask: 0,
        iv: 0,
        oi: 0,
        volume: 0,
        bid_ask_spread_pct: 0,
      }],
      expiry: expiryOut || (() => {
        const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10)
      })(),
      dte: dteVal,
      net_credit: ep > 0 ? -ep : 0,
      spread_width: 0,
      max_profit: 0,
      max_loss: ep > 0 ? ep : 0,
      prob_of_profit: 0,
      expected_value: 0,
      scores_total: 0,
      contracts: c,
      breakeven_lower: 0,
      breakeven_upper: 0,
      entryPrice: Number.isFinite(stockPriceVal) && stockPriceVal > 0 ? stockPriceVal : lastU,
      target1: result.entry_guidance?.scalp_target ?? undefined,
      stopLoss: result.entry_guidance?.risk_below ?? undefined,
      source: 'day',
      notes: portfolioNotes.trim() || undefined,
    })
    setPortfolioSubmitting(false)
    setPortfolioOpen(false)
    setNotice({ tone: 'success', message: `${result.ticker} day trade added to Positions Center.` })
    navigate('positions')
  }, [result, portfolioContracts, portfolioEntryPrice, portfolioExpiry, portfolioNotes, portfolioDfltDte, portfolioBias, addManualPosition, navigate])

  const submitEnter = useCallback(async () => {
    if (!result) return
    const ep = parseFloat(entryPrice)
    if (!Number.isFinite(ep) || ep <= 0) {
      setEnterErr('Enter a valid option premium (entry price).')
      return
    }
    const lastU = typeof result.metrics?.last_price === 'number' ? result.metrics.last_price as number : undefined
    let c: number | undefined
    if (contracts.trim()) {
      const n = parseFloat(contracts)
      if (!Number.isFinite(n) || n <= 0) {
        setEnterErr('Contracts must be a positive number.')
        return
      }
      c = n
    }
    let strikeOut: number | undefined
    if (strikeInput.trim()) {
      const sk = parseFloat(strikeInput)
      if (!Number.isFinite(sk) || sk <= 0) {
        setEnterErr('Strike must be a positive number.')
        return
      }
      strikeOut = sk
    }
    let expiryOut: string | undefined
    if (expiryInput.trim()) {
      const ex = expiryInput.trim().slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ex)) {
        setEnterErr('Expiry must be YYYY-MM-DD.')
        return
      }
      expiryOut = ex
    }
    setEnterSubmitting(true)
    setEnterErr(null)
    try {
      await enterActiveTrade({
        ticker: result.ticker,
        side,
        entry_price: ep,
        entry_underlying_px: lastU,
        contracts: c,
        strike: strikeOut,
        expiry: expiryOut,
        notes: notes.trim() || undefined,
        trade_type: tradeMode,
      })
      setEnterOpen(false)
      navigate('active-trades')
    } catch (e) {
      setEnterErr(axiosDetail(e))
    } finally {
      setEnterSubmitting(false)
    }
  }, [result, entryPrice, side, contracts, strikeInput, expiryInput, notes, navigate])

  const [searchOpen, setSearchOpen] = useState(false)

  // ── Trend day detection ────────────────────────────────────────────────────
  const trendDayData = useMemo(() => {
    if (!result) return null
    const m        = result.metrics as Record<string, unknown>
    const spyMove  = typeof m.spy_change_pct === 'number' && isFinite(m.spy_change_pct as number) ? m.spy_change_pct as number : null
    const vixLevel = typeof m.vix            === 'number' && isFinite(m.vix as number)            ? m.vix as number            : null
    const qqqMove  = typeof m.qqq_change_pct === 'number' && isFinite(m.qqq_change_pct as number) ? m.qqq_change_pct as number : null
    if (spyMove == null || vixLevel == null || qqqMove == null) return null
    const isShort = result.bias === 'short'
    const movingWith = myTickerFull.filter(t => {
      const chg = t.price_change_pct
      if (chg == null) return false
      return isShort ? chg <= -1.5 : chg >= 1.5
    }).length
    const isBear = spyMove < -0.8 && vixLevel > 19  && movingWith >= 3 && qqqMove < 0
    const isBull = spyMove > 0.8  && vixLevel < 18  && movingWith >= 3 && qqqMove > 0
    if (!isBear && !isBull) return null
    return {
      direction: isBear ? 'BEAR' as const : 'BULL' as const,
      spyMove, vixLevel, tickerCount: movingWith,
    }
  }, [result, myTickerFull])

  // ── Session state machine ──────────────────────────────────────────────────
  useEffect(() => {
    if (!result) return
    const m = result.metrics as Record<string, unknown>
    const bars = parseChartBars(m.chart_bars)
    const orN = typeof m.or_minutes === 'number' ? m.or_minutes as number : 15
    const tickerChanged = result.ticker !== prevScannedTickerRef.current
    prevScannedTickerRef.current = result.ticker
    if (!bars || bars.length === 0) return
    if (bars.length < orN) { setSessionState('forming'); return }
    const verdict = result.verdict ?? result.final_decision ?? 'WAIT'
    const isGoLocal = /^(STRONG.?GO|GO)$/i.test(verdict)
    const sienLocal = String((result.entry_guidance as Record<string,unknown>)?.should_enter_now ?? '').toUpperCase()
    const rrRaw        = typeof m.entry_rr_ratio === 'number' && isFinite(m.entry_rr_ratio as number) ? m.entry_rr_ratio as number : null
    const confLocal    = typeof result.confidence === 'number' ? result.confidence : 0
    const extFlagLocal = (m.edge_remaining === 'EXHAUSTED' || m.edge_remaining === 'LATE') || !!m.is_chasing
    const rtxtLocal    = [result.reason ?? '', ...(Array.isArray(result.reasons) ? result.reasons : [])].join(' ').toLowerCase()
    const z2GoLocal    = isGoLocal && sienLocal === 'YES' && confLocal > 80
      && (rrRaw === null || rrRaw >= 1.5)
      && !extFlagLocal
      && !rtxtLocal.includes('wait')
      && !rtxtLocal.includes('no clean edge')
      && !rtxtLocal.includes('confirmation')
    const exhaustedLocal = !trendDayData && bars.length > 210
    setSessionState(prev => {
      if (!tickerChanged && prev === 'hold') return 'hold'
      if (exhaustedLocal) return 'exhausted'
      if (z2GoLocal) return 'entry'
      return 'watch'
    })
  }, [scanCount]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleBannerEntered = useCallback(() => {
    setSessionState('hold')
  }, [])

  const handleBannerExpire = useCallback(() => {
    setSessionState(prev => prev === 'entry' ? 'watch' : prev)
  }, [])

  return (
    <div className="day-trade-page min-h-screen p-4 md:p-6" style={{ maxWidth: '100vw', overflowX: 'clip', background: isDark ? '#0A0C10' : '#F3F4F6', color: dt.text }}>
      <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 items-start">
        {/* Mobile/tablet search toggle */}
        <button
          type="button"
          onClick={() => setSearchOpen(p => !p)}
          className="lg:hidden w-full flex items-center gap-2 rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900 px-4 py-3 text-sm font-semibold text-secondary"
        >
          <Search size={16} />
          {searchOpen ? 'Hide search' : 'Show search'}
        </button>

        {/* Left: Search panel */}
        <div className={`${searchOpen ? 'block' : 'hidden'} lg:block w-full lg:w-80 shrink-0 lg:sticky lg:top-6 space-y-4`}>
          {/* Header moved to left side */}
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-600/20 border border-orange-700 text-orange-400">
                  <Zap size={16} />
                </div>
                <h1 className="text-sm font-bold tracking-tight text-heading">Day Trade</h1>
                <span className="rounded-full border border-semantic-info-border bg-semantic-info-bg px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-semantic-info">Intraday</span>
              </div>
              <p className="mt-1 text-[11px] leading-snug text-gray-400">Intraday scanner — 1m bars, VWAP, opening range, momentum, volume, and SPY/VIX context.</p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {searchParams.get('from') && (
                <button
                  type="button"
                  onClick={() => routerNavigate(searchParams.get('from')!)}
                  className="rounded-full border border-slate-200 dark:border-white/[0.07] px-2 py-1 text-[10px] text-secondary"
                >
                  <ArrowLeft size={12} /> Back
                </button>
              )}
              <button
                type="button"
                onClick={() => void runScan()}
                disabled={loading || refreshing}
                className="rounded-full border border-gray-700 px-2.5 py-1 text-[10px] font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50"
              >
                <RefreshCw size={12} className={refreshing || loading ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>

          <MarketTimeGateBanner tradeType="day" />

          {lastRefreshed && (
            <div className="text-[10px] font-mono" style={{ color: dt.muted }}>
              Updated {lastRefreshed.toLocaleTimeString()}
            </div>
          )}

          <section className="rounded-xl p-4 sm:p-5" style={{ background: dt.bg, border: `1px solid ${dt.border}` }}>
            <div className="flex flex-col sm:flex-row lg:flex-col gap-2">
              <input
                className="flex-1 min-w-0 rounded-lg px-4 py-3 font-mono text-lg uppercase outline-none"
                style={{ background: dt.bgDeep, border: `1px solid ${dt.border}`, color: dt.text }}
                placeholder="SPY, NVDA, …"
                value={ticker}
                onChange={e => setUi(cur => ({ ...cur, ticker: e.target.value.toUpperCase() }))}
                onKeyDown={e => e.key === 'Enter' && runScan()}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => runScan()}
                disabled={loading || refreshing}
                className="inline-flex items-center justify-center gap-2 shrink-0 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold px-5 py-3 min-h-[48px] transition-colors"
              >
                {loading ? <Loader2 className="animate-spin" size={18} /> : <Search size={18} />}
                Analyze
              </button>
            </div>
            <p className="text-[11px] mt-2" style={{ color: dt.muted }}>
              Uses Yahoo 1-minute RTH data for the most recent session, session VWAP, first 15m opening range, short-horizon momentum, volume vs average, plus SPY/QQQ daily change and VIX.
            </p>
            {myTickers.length > 0 && (
              <div className="flex gap-2 mt-3 flex-wrap">
                <span className="text-xs self-center" style={{ color: dt.muted }}>Quick:</span>
                {myTickers.map((t: string) => (
                  <a key={t} href={`/day-trade?ticker=${encodeURIComponent(t)}`}
                    onClick={(e) => { e.preventDefault(); setUi(cur => ({ ...cur, ticker: t })); runScan(t) }}
                    className="text-xs px-2 py-1 rounded-lg transition-colors font-mono inline-block cursor-pointer"
                    style={{ background: dt.bgDeep, color: dt.text, border: `1px solid ${dt.border}` }}
                  >
                    {t}
                  </a>
                ))}
              </div>
            )}
          </section>

          {/* Already in Position */}
          {existingPositions.length > 0 && (
            <div className="rounded-xl border border-amber-600/40 bg-amber-950/30 px-3 py-3 space-y-2">
              <div className="flex items-center gap-2">
                <Check size={14} className="text-amber-400 shrink-0" />
                <span className="text-xs font-bold text-amber-300 uppercase tracking-wide">Already in Position</span>
                {(() => {
                  const lp = existingPositions[existingPositions.length - 1]
                  return lp?.source && (
                    <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                      lp.source === 'day'   ? 'border-orange-600/40 bg-orange-900/30 text-orange-300' :
                      lp.source === 'swing' ? 'border-blue-600/40 bg-blue-900/30 text-blue-300' :
                                             'border-gray-600/40 bg-gray-800/50 text-gray-400'
                    }`}>{lp.source}</span>
                  )
                })()}
              </div>
              {(() => {
                const lp = existingPositions[existingPositions.length - 1]
                if (!lp) return null
                return (
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-amber-200/80">
                    {lp.strategy && <span><span className="text-amber-400/60">Strategy</span> {lp.strategy}</span>}
                    {lp.contracts > 0 && <span><span className="text-amber-400/60">Contracts</span> {lp.contracts}</span>}
                    {lp.entryPrice > 0 && <span><span className="text-amber-400/60">Entry px</span> ${lp.entryPrice.toFixed(2)}</span>}
                    {lp.addedAt && <span><span className="text-amber-400/60">Added</span> {lp.addedAt.slice(0, 10)}</span>}
                  </div>
                )
              })()}
              <p className="text-[10px] text-amber-200/70 leading-snug">
                Follow your exit rules — manage this position rather than adding again without a clear plan.
              </p>
            </div>
          )}

          {/* Action buttons */}
          {result && (
          <div className="flex flex-wrap items-center gap-2">
            {existingPositions.length > 0 ? (
              <button
                type="button"
                onClick={() => routerNavigate(ROUTES.positions)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-600/50 bg-amber-900/30 text-amber-300 hover:bg-amber-900/50 px-3.5 py-2 text-xs font-bold transition-colors"
              >
                <BarChart2 size={14} />
                View Positions
              </button>
            ) : (
            <button
              type="button"
              onClick={openPortfolioModal}
              className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white px-3.5 py-2 text-xs font-bold transition-colors"
            >
              <PlusCircle size={14} />
              Add to Portfolio
            </button>
            )}
            {canAccessPage('active-trades') && (
              <button
                type="button"
                onClick={openEnterModal}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-700 hover:bg-gray-800 text-gray-300 px-3 py-2 text-[11px] font-semibold transition-colors"
              >
                <Activity size={14} />
                Track Intraday
              </button>
            )}
            <button
              type="button"
              onClick={() => setAlertOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-700/50 hover:bg-rose-900/30 text-rose-300 px-3.5 py-2 text-xs font-bold transition-colors"
            >
              <Bell size={14} />
              Add Alert
            </button>
            <button
              type="button"
              onClick={() => {
                const sym = result.ticker.toUpperCase()
                try {
                  const existing: string[] = JSON.parse(localStorage.getItem('oa_dashboard_tickers_day') ?? '[]')
                  if (!existing.includes(sym) && existing.length < 8) {
                    localStorage.setItem('oa_dashboard_tickers_day', JSON.stringify([...existing, sym]))
                  }
                } catch { /* ignore quota */ }
                routerNavigate(ROUTES.dayTradeDashboard)
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-orange-700/50 hover:bg-orange-900/30 text-orange-300 px-3 py-2 text-[11px] font-semibold transition-colors"
            >
              <Gauge size={13} />
              Add to Dashboard
            </button>
            <button
              type="button"
              onClick={() => routerNavigate(`${ROUTES.strategyFinder}?ticker=${encodeURIComponent(result.ticker)}`)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-violet-700/50 hover:bg-violet-900/30 text-violet-300 px-3 py-2 text-[11px] font-semibold transition-colors"
            >
              <BarChart2 size={13} />
              Position Trading
            </button>
            <button
              type="button"
              onClick={() => void handleSaveToJournal()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-700/50 hover:bg-emerald-900/30 text-emerald-300 px-3 py-2 text-[11px] font-semibold transition-colors"
            >
              {savedToJournal ? <Check size={14} /> : <Activity size={14} />}
              {savedToJournal ? 'Saved' : 'Save to Journal'}
            </button>
          </div>
          )}

        </div>

        {/* Right: Content */}
        <div className="flex-1 min-w-0 space-y-4" style={{ maxWidth: '100%' }}>

        {error && (
        <div className="rounded-xl border border-rose-700/40 bg-rose-950/20 px-4 py-3 text-sm text-rose-200 flex gap-2">
          <ShieldAlert className="shrink-0 mt-0.5" size={16} />
          {error}
        </div>
      )}

      {notice && (
        <div className={`rounded-xl px-4 py-3 text-sm flex gap-2 ${
          notice.tone === 'success'
            ? 'border border-emerald-700/40 bg-emerald-950/20 text-emerald-200'
            : 'border border-sky-700/40 bg-sky-950/20 text-sky-200'
        }`}>
          <ShieldAlert className="shrink-0 mt-0.5" size={16} />
          {notice.message}
        </div>
      )}

      {unified && (
        <div className="day-trade-unified">
          {/* Ticker header bar */}
          <div className="dt-card" style={{ background: dt.bg, border: `1px solid ${dt.border}`, borderRadius: 14, padding: '14px 18px', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px 16px', minWidth: 0, maxWidth: '100%' }}>
              {/* Price row */}
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 10px', flex: '1 1 200px', minWidth: 0 }}>
                <span className="dt-primary" style={{ fontSize: '1.3rem', fontWeight: 700, fontFamily: 'monospace', color: dt.text }}>{unified.ticker}</span>
                {unified.company && <span className="dt-muted" style={{ fontSize: '0.78rem', color: dt.muted }}>{unified.company}</span>}
                <span className="dt-primary" style={{ fontSize: '1.1rem', fontWeight: 700, fontFamily: 'monospace', color: dt.text }}>${unified.price.toFixed(2)}</span>
                {unified.change_pct != null && (
                  <span style={{ fontSize: '0.82rem', fontWeight: 600, color: unified.change_pct >= 0 ? dt.green : dt.red }}>
                    {unified.change_pct >= 0 ? '▲' : '▼'} ${Math.abs(unified.price * unified.change_pct / (100 + unified.change_pct)).toFixed(2)} ({Math.abs(unified.change_pct).toFixed(2)}%)
                  </span>
                )}
                {(() => {
                  const m = result?.metrics as Record<string, unknown> | undefined
                  const extPrice = m?.ext_market_price as number | undefined
                  if (!extPrice) return null
                  const extChg = m?.ext_market_change as number | undefined
                  const extChgPct = m?.ext_market_change_pct as number | undefined
                  const extType = m?.ext_market_type as string | undefined
                  return (
                    <>
                      <span style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '1px 6px', borderRadius: 20, border: `1px solid ${dt.violet}`, color: dt.violet, background: 'rgba(107,127,212,0.08)' }}>{extType === 'pre' ? 'Pre' : 'AH'}</span>
                      <span className="dt-primary" style={{ fontSize: '0.82rem', fontWeight: 700, fontFamily: 'monospace', color: dt.text }}>${extPrice.toFixed(2)}</span>
                      {extChg != null && (
                        <span style={{ fontSize: '0.72rem', fontWeight: 600, color: extChg >= 0 ? dt.green : dt.red }}>
                          {extChg >= 0 ? '▲' : '▼'}{Math.abs(extChg).toFixed(2)} ({(extChgPct ?? 0) >= 0 ? '+' : ''}{(extChgPct ?? 0).toFixed(2)}%)
                        </span>
                      )}
                    </>
                  )
                })()}
              </div>
              {/* Bias + session meta */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '0.6rem', color: dt.muted }}>Bias</div>
                  <div style={{ fontSize: '0.78rem', fontWeight: 700, color: result?.bias === 'long' ? dt.green : result?.bias === 'short' ? dt.red : dt.muted }}>{result?.bias ? result.bias.charAt(0).toUpperCase() + result.bias.slice(1) : '—'}</div>
                  <div style={{ fontSize: '0.6rem', color: dt.muted }}>{result?.market_bias || '—'}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {unified.session && (
                    <span style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 20, border: `1px solid rgba(107,127,212,0.5)`, color: dt.violet, background: 'rgba(107,127,212,0.08)' }}>
                      {unified.session}
                    </span>
                  )}
                  {(() => {
                    const raw = result as unknown as Record<string, unknown> | undefined
                    const eg = raw?.entry_guidance as Record<string, unknown> | undefined
                    const vwap = eg?.vwap
                    const orh = eg?.opening_range_high
                    const orl = eg?.opening_range_low
                    const m = raw?.metrics as Record<string, unknown> | undefined
                    const vu1 = m?.vwap_upper1 as number | undefined
                    const vl1 = m?.vwap_lower1 as number | undefined
                    const vu2 = m?.vwap_upper2 as number | undefined
                    const vl2 = m?.vwap_lower2 as number | undefined
                    const vctx = m?.vwap_volatility_context as string | undefined
                    const vstd = m?.vwap_std_dev as number | undefined
                    if (!vwap && !orh && !vu1) return null
                    return (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: '0.65rem', color: dt.muted, fontFamily: 'monospace' }}>
                        {vwap != null && <span>VWAP <span style={{ color: dt.text }}>${(vwap as number).toFixed(2)}</span></span>}
                        {vu1 != null && <span style={{ color: 'rgba(56,189,248,0.7)' }}>+1σ <span style={{ color: dt.text }}>${vu1.toFixed(2)}</span></span>}
                        {vl1 != null && <span style={{ color: 'rgba(56,189,248,0.7)' }}>-1σ <span style={{ color: dt.text }}>${vl1.toFixed(2)}</span></span>}
                        {vu2 != null && <span style={{ color: 'rgba(56,189,248,0.35)' }}>+2σ <span style={{ color: dt.text }}>${vu2.toFixed(2)}</span></span>}
                        {vl2 != null && <span style={{ color: 'rgba(56,189,248,0.35)' }}>-2σ <span style={{ color: dt.text }}>${vl2.toFixed(2)}</span></span>}
                        {vctx != null && vstd != null && (
                          <span style={{
                            color: vctx === 'NARROW' ? '#D4A017' : vctx === 'WIDE' ? '#D0312D' : '#6B7280',
                            fontSize: '0.6rem', fontStyle: 'italic',
                          }}>σ ${vstd.toFixed(2)} ({vctx})</span>
                        )}
                        {orh != null && <span>ORH <span style={{ color: dt.text }}>${(orh as number).toFixed(2)}</span></span>}
                        {orl != null && <span>ORL <span style={{ color: dt.text }}>${(orl as number).toFixed(2)}</span></span>}
                      </div>
                    )
                  })()}
                </div>
              </div>
            </div>
          </div>

          <UnifiedVerdictCard analysis={unified} />

          {/* Entry Plan / Risk Profile */}
          <div className="dt-card" style={{ background: dt.bg, border: `1px solid ${dt.border}`, borderRadius: 14, padding: '14px 16px', marginBottom: 12 }}>
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
              {/* Entry Plan */}
              <div>
                <div className="dt-muted" style={{ fontSize: '0.68rem', fontWeight: 700, color: dt.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>Entry Plan</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: `1px solid ${dt.border}` }}>
                  <span className="dt-muted" style={{ color: dt.muted, fontSize: '0.82rem' }}>Entry</span>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, color: unified.entry_price ? dt.green : dt.amber, fontSize: '0.82rem' }}>{unified.entry_price ? `$${unified.entry_price.toFixed(2)}` : '—'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: `1px solid ${dt.border}` }}>
                  <span className="dt-muted" style={{ color: dt.muted, fontSize: '0.82rem' }}>Structure</span>
                  <span className="dt-primary" style={{ fontFamily: 'monospace', color: dt.text, fontSize: '0.82rem' }}>{unified.structure || '—'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0' }}>
                  <span className="dt-muted" style={{ color: dt.muted, fontSize: '0.82rem' }}>Stop Loss</span>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, color: unified.stop_price ? dt.red : dt.muted, fontSize: '0.82rem' }}>{unified.stop_price ? `$${unified.stop_price.toFixed(2)}` : '—'}</span>
                </div>
              </div>
              {/* Risk Profile */}
              <div>
                <div className="dt-muted" style={{ fontSize: '0.68rem', fontWeight: 700, color: dt.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>Risk Profile</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: `1px solid ${dt.border}` }}>
                  <span className="dt-muted" style={{ color: dt.muted, fontSize: '0.82rem' }}>R/R Ratio</span>
                  <span className="dt-muted" style={{ fontFamily: 'monospace', color: dt.muted, fontSize: '0.82rem' }}>{unified.rr_ratio || '—'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: `1px solid ${dt.border}` }}>
                  <span className="dt-muted" style={{ color: dt.muted, fontSize: '0.82rem' }}>Risk Level</span>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, color: unified.risk_level === 'LOW' ? dt.green : unified.risk_level === 'MEDIUM' ? dt.amber : dt.red, fontSize: '0.82rem' }}>{unified.risk_level || '—'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0' }}>
                  <span className="dt-muted" style={{ color: dt.muted, fontSize: '0.82rem' }}>RVOL</span>
                  <span className="dt-muted" style={{ fontFamily: 'monospace', fontWeight: 700, color: dt.muted, fontSize: '0.82rem' }}>{unified.rvol || '—'}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Exit Plan */}
          {(() => {
          const eg = result?.entry_guidance as Record<string, unknown> | undefined
          const scalpTarget = eg?.scalp_target as number | undefined
          const scalpTarget2 = eg?.scalp_target_2 as number | undefined
          const exitRows = [...(unified.exit_rows || [])]
          if (scalpTarget != null && !exitRows.some(r => r.type === 't1')) {
            exitRows.push({ when: 'Target 1 — sell ½', price: `$${scalpTarget.toFixed(2)}`, action: 'Sell ½ position', type: 't1' })
          }
          if (scalpTarget2 != null && !exitRows.some(r => r.type === 't2')) {
            exitRows.push({ when: 'Target 2 — full exit', price: `$${scalpTarget2.toFixed(2)}`, action: 'Sell remaining ½', type: 't2' })
          }
          return (
          <div className="dt-card" style={{ background: dt.bg, border: `1px solid ${dt.border}`, borderRadius: 14, padding: '14px 16px', marginBottom: 12 }}>
            <div className="dt-muted" style={{ fontSize: '0.68rem', fontWeight: 700, color: dt.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>Exit Plan — Pre-Committed</div>
            {exitRows.length > 0 ? (
              <>
                {/* Desktop table */}
                <div className="hidden sm:block" style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                    <thead>
                      <tr>
                        {['WHEN', 'PRICE', 'ACTION'].map(h => (
                          <th key={h} style={{ textAlign: 'left', color: dt.muted, fontWeight: 600, paddingBottom: 8, fontSize: '0.68rem', letterSpacing: '0.06em', borderBottom: `1px solid ${dt.border}` }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {exitRows.map((row, i) => {
                        const isStop = row.type === 'stop'
                        const isT2 = row.type === 't2'
                        const isT1 = row.type === 't1'
                        const isTime = row.type === 'time'
                        const rowTone = isStop ? dt.red : isT2 ? dt.amber : isT1 ? dt.green : dt.text
                        const priceCls = isStop ? dt.red : isT2 ? dt.amber : isT1 ? dt.green : dt.muted
                        return (
                          <tr key={i} style={{ borderBottom: `1px solid ${dt.border}` }}>
                            <td style={{ paddingTop: 8, paddingBottom: 8, color: dt.muted, fontFamily: 'monospace', fontSize: '0.75rem' }}>{row.when}</td>
                            <td style={{ paddingTop: 8, paddingBottom: 8, fontFamily: 'monospace', fontWeight: 700, color: priceCls }}>{row.price}</td>
                            <td style={{ paddingTop: 8, paddingBottom: 8, color: isStop ? dt.red : isT1 || isT2 ? dt.green : dt.muted, fontSize: '0.75rem', fontWeight: isStop ? 500 : 400 }}>{row.action}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {/* Mobile card list */}
                <div className="sm:hidden space-y-2">
                  {exitRows.map((row, i) => {
                    const isStop = row.type === 'stop'
                    const isT2 = row.type === 't2'
                    const isT1 = row.type === 't1'
                    const rowTone = isStop ? dt.red : isT2 ? dt.amber : isT1 ? dt.green : dt.text
                    const priceCls = isStop ? dt.red : isT2 ? dt.amber : isT1 ? dt.green : dt.muted
                    return (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', borderRadius: 8, border: `1px solid ${dt.border}`, background: dt.bgDeep }}>
                        <div>
                          <div style={{ fontSize: '0.72rem', fontFamily: 'monospace', color: dt.muted, fontWeight: 600 }}>{row.when}</div>
                          <div style={{ fontSize: '0.68rem', color: isStop ? dt.red : isT1 || isT2 ? dt.green : dt.muted, marginTop: 2 }}>{row.action}</div>
                        </div>
                        <span style={{ fontFamily: 'monospace', fontWeight: 700, color: priceCls, fontSize: '0.88rem' }}>{row.price}</span>
                      </div>
                    )
                  })}
                </div>
              </>
            ) : (
              <div style={{ color: dt.muted, textAlign: 'center', padding: '8px 0', fontSize: '0.8rem' }}>Run full analysis for detailed exit levels</div>
            )}
          </div>
          )})()}

        </div>
      )}


      {/* Trend day banner */}
      {result && trendDayData && (() => {
        const m = result.metrics as Record<string, unknown>
        const chartBarsForAtr = parseChartBars(m.chart_bars)
        const atrUsedPct = (() => {
          const drUp = typeof m.daily_range_used_pct === 'number' ? m.daily_range_used_pct as number : null
          if (drUp != null) return drUp
          if (!chartBarsForAtr || chartBarsForAtr.length === 0) return null
          const h = Math.max(...chartBarsForAtr.map(b => b.h))
          const l = Math.min(...chartBarsForAtr.map(b => b.l))
          const atr = typeof m.atr14 === 'number' ? m.atr14 as number
            : typeof m.atr === 'number' ? m.atr as number : null
          return atr && atr > 0 ? ((h - l) / atr) * 100 : null
        })()
        return (
          <TrendDayBanner
            direction={trendDayData.direction}
            spyMove={trendDayData.spyMove}
            vixLevel={trendDayData.vixLevel}
            tickerCount={trendDayData.tickerCount}
            atrUsedPct={atrUsedPct}
            isDark={isDark}
          />
        )
      })()}

      {/* Options entry check */}
      {result && (() => {
        const m       = result.metrics as Record<string, unknown>
        const eg      = result.entry_guidance
        const verdict = result.verdict ?? result.final_decision ?? 'WAIT'
        const isGo    = /^(STRONG.?GO|GO)$/i.test(verdict)
        const isWatch = /WATCH/i.test(verdict)
        const isShort = result.bias === 'short'
        const chartBars = parseChartBars(m.chart_bars)
        const orHigh  = typeof m.or_high === 'number' ? m.or_high as number : undefined
        const orLow   = typeof m.or_low  === 'number' ? m.or_low  as number : undefined
        const mVwap   = typeof m.vwap === 'number' && isFinite(m.vwap) ? m.vwap as number : null
        const mRvol   = typeof m.rvol === 'number' && isFinite(m.rvol as number) ? m.rvol as number : null
        const lastPrice = typeof m.last_price === 'number' ? m.last_price as number : 0

        const sienOec    = String((eg as Record<string,unknown>)?.should_enter_now ?? '').toUpperCase()
        const rrOec      = typeof m.entry_rr_ratio === 'number' && isFinite(m.entry_rr_ratio as number) ? m.entry_rr_ratio as number : null
        const confOec    = typeof result.confidence === 'number' ? result.confidence : 0
        const extFlagOec = (m.edge_remaining === 'EXHAUSTED' || m.edge_remaining === 'LATE') || !!m.is_chasing
        const rtxtOec    = [result.reason ?? '', ...(Array.isArray(result.reasons) ? result.reasons : [])].join(' ').toLowerCase()
        const showGO     = isGo && sienOec === 'YES' && confOec > 80
          && (rrOec === null || rrOec >= 1.5)
          && !extFlagOec
          && !rtxtOec.includes('wait')
          && !rtxtOec.includes('no clean edge')
          && !rtxtOec.includes('confirmation')

        const chartTrigger: 'GO' | 'WAIT' | 'WATCHING' | 'HOLD' =
          sessionState === 'hold' ? 'HOLD' :
          sessionState === 'entry' ? 'GO' :
          sessionState === 'exhausted' ? 'WAIT' :
          showGO ? 'GO' : isWatch ? 'WATCHING' : 'WAIT'
        const direction: 'SHORT' | 'LONG' = isShort ? 'SHORT' : 'LONG'
        const stopPrice = (() => {
          const rb = typeof eg?.risk_below === 'number' ? eg.risk_below as number : null
          if (rb && rb > 0) return rb
          return isShort ? (orHigh ?? lastPrice) : (orLow ?? lastPrice)
        })()

        const pcRatio = typeof m.put_call_ratio === 'number' ? m.put_call_ratio as number : null
        const pcAlignment: 'aligned' | 'conflict' | 'neutral' =
          pcRatio == null ? 'neutral'
          : pcRatio > 1.1 ? (isShort ? 'aligned' : 'conflict')
          : pcRatio < 0.9 ? (isShort ? 'conflict' : 'aligned')
          : 'neutral'

        let flipCondition = ''
        if (!isGo && chartBars) {
          const curPrice = chartBars[chartBars.length - 1]?.c ?? 0
          if (trendDayData && chartBars.length > 210) {
            // Trend day overrides the exhausted verdict
            flipCondition = `⚡ Trend day · Extension rules suspended · SPY ${trendDayData.spyMove >= 0 ? '+' : ''}${trendDayData.spyMove.toFixed(2)}% · VIX ${trendDayData.vixLevel.toFixed(1)} · ${trendDayData.tickerCount} tickers confirm · Entry valid · Widen stop by 50% · Target: next sigma band`
          } else if (chartBars.length > 210) {
            flipCondition = "Move is exhausted. Next valid setup is tomorrow's open."
          } else if (mRvol != null && mRvol < 0.75) {
            const ref = isShort ? orLow ?? 0 : orHigh ?? 0
            flipCondition = `Next breakdown candle volume exceeds 1.5× prior 5-candle average near $${ref.toFixed(2)}.`
          } else if (mVwap && Math.abs(curPrice - mVwap) / mVwap > 0.015) {
            const pullback = isShort ? mVwap * 1.005 : mVwap * 0.995
            flipCondition = `Price pulls back to $${pullback.toFixed(2)} before continuing ${isShort ? 'down' : 'up'}.`
          } else {
            const breakLevel = isShort ? orLow ?? 0 : orHigh ?? 0
            flipCondition = `Two consecutive ${isShort ? 'red' : 'green'} candles closing ${isShort ? 'below' : 'above'} $${breakLevel.toFixed(2)} with no wick recovery.`
          }
        }

        // Widen stop 0.5% on trend day (more room for volatility)
        const trendAdjStop = trendDayData
          ? (isShort ? stopPrice * 1.005 : stopPrice * 0.995)
          : stopPrice

        return (
          <OptionsEntryCheck
            key={ocKey}
            ticker={result.ticker}
            direction={direction}
            stopPrice={trendAdjStop}
            chartTrigger={chartTrigger}
            flipCondition={flipCondition}
            pcAlignment={pcAlignment}
            initialPrice={lastPrice}
            isDark={isDark}
          />
        )
      })()}

      {/* Overnight Runner — shown when T1 is hit and position is in hold */}
      {result && result.metrics && sessionState === 'hold' && (() => {
        const m = result.metrics as Record<string, unknown>
        const eg = result.entry_guidance
        const chartBars = parseChartBars(m.chart_bars)
        const lastPrice = typeof m.last_price === 'number' ? m.last_price as number : 0
        const vwap = typeof m.vwap === 'number' && isFinite(m.vwap) ? m.vwap as number : 0
        const orh = typeof m.or_high === 'number' ? m.or_high as number : 0
        const orl = typeof m.or_low === 'number' ? m.or_low as number : 0
        const rvol = typeof m.rvol === 'number' && isFinite(m.rvol as number) ? m.rvol as number : 0
        const isShort = result.bias === 'short'
        const t1 = typeof eg?.scalp_target === 'number' && isFinite(eg.scalp_target) ? eg.scalp_target as number : null
        const t1Hit = t1 !== null && (isShort ? lastPrice <= t1 : lastPrice >= t1)
        const spyChg = typeof m.spy_change_pct === 'number' ? m.spy_change_pct as number : 0
        const qqqChg = typeof m.qqq_change_pct === 'number' ? m.qqq_change_pct as number : 0
        // Convert SPY/QQQ change to trend score (7% = 100, proportional)
        const spyScore = Math.min(100, Math.max(0, Math.round((spyChg + 2) / 4 * 100)))
        const qqqScore = Math.min(100, Math.max(0, Math.round((qqqChg + 2) / 4 * 100)))
        const intradayHighs = chartBars ? chartBars.map(b => b.h) : [lastPrice]
        const regime = spyChg > 0.5 && qqqChg > 0.5 ? 'BULLISH' : spyChg < -0.5 && qqqChg < -0.5 ? 'BEARISH' : 'NEUTRAL'
        if (!t1Hit) return null
        return (
          <div className="mb-3">
            <OvernightRunnerCard
              ticker={result.ticker}
              currentPrice={lastPrice}
              vwap={vwap}
              orh={orh}
              orl={orl}
              intradayHighs={intradayHighs}
              volumeToday={Math.round(rvol * 1000)}
              avgVolume20d={1000}
              spyTrendScore={spyScore}
              qqqTrendScore={qqqScore}
              tickerTrendScore={Math.round((spyScore + qqqScore) / 2)}
              t1Hit={t1Hit}
              t2Hit={false}
              marketRegime={regime}
            />
          </div>
        )
      })()}

      {/* Intraday chart */}
      {result && result.metrics && (() => {
        const m = result.metrics as Record<string, unknown>
        const chartBars = parseChartBars(m.chart_bars)
        const orHigh = m.or_high as number | undefined
        const orLow = m.or_low as number | undefined
        const orMin = m.or_minutes as number | undefined
        const sessionDate = String(m.session_date ?? '')
        if (!chartBars || orHigh == null || orLow == null) return null

        const eg = result.entry_guidance
        const ac = result.ai_coach
        const isShort = result.bias === 'short'
        const mVwap = typeof m.vwap === 'number' && isFinite(m.vwap) ? m.vwap : null
        const stopFallback = isShort ? orHigh : orLow
        const pageEntryPoints: ChartEntryPoint[] = []
        const direction = isShort ? 'short' : 'long' as const

        const addEntry = (
          price: number | null | undefined,
          trigger: string,
          stop?: number,
          rr?: number,
          pending?: boolean,
          verdict?: string,
          exitPrice?: number,
        ) => {
          if (!price || !isFinite(price) || price <= 0) return
          pageEntryPoints.push({ label: `E${pageEntryPoints.length + 1}`, price, trigger, stop, direction, exitPrice, rr, pending, verdict })
        }

        // E1 — AI coach entry gate (confluence zone trigger)
        const eg1 = ac?.entry_gate as Record<string, unknown> | undefined
        const eg1Verdict  = eg1?.verdict as string | undefined
        const eg1IsNT     = eg1Verdict === 'NO_TRADE'
        const eg1Trigger  = eg1IsNT
          ? `⚠ EXTENDED — ${(eg1?.extended_reason as string) || 'entry past session T1'}`
          : ((eg1?.trigger_condition as string) ?? 'Gate trigger')
        addEntry(
          eg1?.trigger_price as number | undefined,
          eg1Trigger,
          eg1IsNT ? undefined : (eg1?.stop as number | undefined) ?? stopFallback,
          eg1IsNT ? 0 : (eg1?.risk_reward as number | undefined),
          false,
          eg1Verdict,
          eg1IsNT ? undefined : (eg1?.target as number | undefined),
        )

        // E2 — AI coach trade (current price analysis)
        const tr = ac?.trade as Record<string, unknown> | undefined
        const trVerdict = tr?.verdict as string | undefined
        const trIsNT    = trVerdict === 'NO_TRADE'
        const trRr      = tr?.risk_reward as number | undefined
        const trTrigger = trIsNT
          ? `⚠ EXTENDED — ${(tr?.extended_reason as string) || 'entry past session T1'}`
          : (tr ? `AI Coach · ${tr.direction} (R/R ${(trRr ?? 0).toFixed(1)}×)` : 'AI Coach')
        addEntry(
          tr?.entry_price as number | undefined,
          trTrigger,
          trIsNT ? undefined : (tr?.stop as number | undefined) ?? stopFallback,
          trIsNT ? 0 : trRr,
          false,
          trVerdict,
          trIsNT ? undefined : (tr?.target as number | undefined),
        )

        // E3 — OR breakout level
        const orEntryPx  = (eg?.breakout_level ?? (isShort ? orLow : orHigh)) as number | undefined
        const orRr       = ac?.or_breakout_rr as Record<string, unknown> | undefined
        const orVerdict  = orRr?.verdict as string | undefined
        const orIsNT     = orVerdict === 'NO_TRADE'
        addEntry(
          orEntryPx,
          isShort ? 'OR low breakout' : 'OR high breakout',
          orIsNT ? undefined : (isShort ? orHigh : orLow),
          orIsNT ? 0 : (orRr?.risk_reward as number | undefined),
          false,
          orVerdict,
          orIsNT ? undefined : (orRr?.target as number | undefined),
        )

        // E4 — Pullback Reset (active if detected) or VWAP retest (pending / conditional)
        const pb = ac?.pullback_entry
        if (pb?.detected && pb.entry_price && isFinite(pb.entry_price)) {
          const pbPrice = pb.entry_price
          if (!seen.has(pbPrice)) {
            seen.add(pbPrice)
            pageEntryPoints.push({
              label:     `E${pageEntryPoints.length + 1}`,
              price:     pbPrice,
              trigger:   `⚡ Pullback Reset — ${pb.reason ?? 'VWAP reclaim confirmed'}`,
              stop:      pb.stop,
              direction,
              exitPrice: pb.target_1,
              rr:        pb.rr_t1,
              pending:   false,
              verdict:   'VALID',
              color:     '#f59e0b',  // amber — dynamic pullback entry
            })
          }
        } else {
          const vRr      = ac?.vwap_retest_rr as Record<string, unknown> | undefined
          const vVerdict = vRr?.verdict as string | undefined
          addEntry(
            (eg?.vwap ?? mVwap) as number | null,
            'VWAP re-test',
            (eg?.risk_below as number | undefined) ?? stopFallback,
            vRr?.risk_reward as number | undefined,
            true,
            vVerdict,
            vRr?.target as number | undefined,
          )
        }

        // ── Build zone annotations ──────────────────────────────────────────
        const verdict = result.verdict ?? result.final_decision ?? 'WAIT'
        const isGo = /^(STRONG.?GO|GO)$/i.test(verdict)
        const isWatch = /WATCH/i.test(verdict)
        const isWait = !isGo && !isWatch
        const biasLabel = isShort ? 'SHORT' : 'LONG'
        const verdictColor = isGo ? '#34d399' : isWatch ? '#38bdf8' : '#6b7280'
        const orN = orMin ?? 15
        const t1 = typeof eg?.scalp_target === 'number' && isFinite(eg.scalp_target) ? eg.scalp_target as number : null
        const egRaw = eg as Record<string, unknown> | undefined
        const t2 = typeof egRaw?.scalp_target_2 === 'number' && isFinite(egRaw.scalp_target_2 as number) ? egRaw.scalp_target_2 as number : null
        const sien = String((eg as Record<string,unknown>)?.should_enter_now ?? '').toUpperCase()
        const entryReadiness = sien === 'YES' ? 'Execute within 1–2 candles.' : sien === 'CONDITIONAL' ? 'Wait for trigger candle confirmation.' : 'No confirmed trigger yet — monitor closely.'

        const triggerConfirmed = sien === 'YES'
        const rrRatio = typeof m.entry_rr_ratio === 'number' && isFinite(m.entry_rr_ratio as number)
          ? m.entry_rr_ratio as number : null
        const conf       = typeof result.confidence === 'number' ? result.confidence : 0
        const extFlagged = (m.edge_remaining === 'EXHAUSTED' || m.edge_remaining === 'LATE') || !!m.is_chasing
        const reasonTxt  = [result.reason ?? '', ...(Array.isArray(result.reasons) ? result.reasons : [])].join(' ').toLowerCase()
        // z2* = display values used only for Zone 2's card badge and colours
        const z2ShowGO  = isGo && triggerConfirmed && conf > 80
          && (rrRatio === null || rrRatio >= 1.5)
          && !extFlagged
          && !reasonTxt.includes('wait')
          && !reasonTxt.includes('no clean edge')
          && !reasonTxt.includes('confirmation')
        const z2IsGo    = z2ShowGO
        const z2IsAmber = !z2ShowGO && conf > 80   // setup present, conditions not fully met
        const z2IsWatch = !z2IsGo && !z2IsAmber && (isWatch || isGo)
        const z2Verdict   = z2IsGo ? verdict : (z2IsAmber || isGo ? 'WATCH' : verdict)
        const z2BadgeText = sessionState === 'hold' ? 'MANAGING' : sessionState === 'exhausted' ? 'EXHAUSTED' : z2Verdict
        const z2VColor    = z2IsGo ? '#34d399' : z2IsAmber ? '#E87B3A' : z2IsWatch ? '#38bdf8' : '#6b7280'

        // Theme-adaptive card helpers
        const cBg  = (d: string, l: string) => isDark ? d : l
        const cBdr = (d: string, l: string) => isDark ? d : l
        const cTxt = (d: string, l: string) => isDark ? d : l

        const dayZones: ZoneAnnotation[] = []

        // Zone 1 — Opening Range
        dayZones.push({
          key: 'opening-range',
          from: 0,
          to: Math.min(orN - 1, chartBars.length - 1),
          fill: 'rgba(251,191,36,0.06)',
          label: 'Opening Range',
          sublabel: `First ${orN}m`,
          markerColor: '#F59E0B',
          cardBg:     cBg('rgba(20,14,4,0.88)',       'rgba(255,251,235,0.97)'),
          cardBorder: cBdr('#78350F',                  '#D97706'),
          textColor:  cTxt('#FCD34D',                  '#92400E'),
          badgeText: `${orN}m`,
          badgeBg: isDark ? 'rgba(245,158,11,0.14)' : 'rgba(245,158,11,0.22)',
          detail: `The first ${orN} minutes establish the opening range (ORH $${orHigh.toFixed(2)} / ORL $${orLow.toFixed(2)}). Wait for a confirmed break with volume expansion before entering.`,
        })

        // ── Flip-to-GO condition (WAIT only) ────────────────────────────────
        let flipCondition: string | undefined
        if (isWait) {
          const lastBar = chartBars[chartBars.length - 1]
          const curPrice = lastBar?.c ?? 0
          const mRvol = typeof m.rvol === 'number' && isFinite(m.rvol as number) ? m.rvol as number : null

          if (trendDayData && chartBars.length > 210) {
            // TREND DAY — extension rules suspended even in a late session
            flipCondition = `⚡ Trend day · Extension rules suspended · SPY ${trendDayData.spyMove >= 0 ? '+' : ''}${trendDayData.spyMove.toFixed(2)}% · VIX ${trendDayData.vixLevel.toFixed(1)} · ${trendDayData.tickerCount} tickers confirm · Entry valid · Widen stop by 50% · Target: next sigma band`
          } else if (chartBars.length > 210) {
            // CONDITION E — late / exhausted session
            flipCondition = 'Do not enter. Move is exhausted. Next valid setup is tomorrow\'s open.'
          } else if (mRvol != null && mRvol < 0.75) {
            // CONDITION A — low relative volume
            const refLevel = isShort ? orLow : orHigh
            flipCondition = `Next breakdown candle volume exceeds 1.5× the prior 5-candle average near $${refLevel.toFixed(2)}. Watch the volume bar, not the price.`
          } else if (mVwap != null && mVwap > 0 && Math.abs(curPrice - mVwap) / mVwap > 0.015) {
            // CONDITION B — price extended from VWAP
            const pullback = isShort ? mVwap * 1.005 : mVwap * 0.995
            flipCondition = `Price pulls back to $${pullback.toFixed(2)} before continuing ${isShort ? 'down' : 'up'} — do not chase ${isShort ? 'below' : 'above'} $${curPrice.toFixed(2)}.`
          } else if (chartBars.length >= 4 && mVwap != null && mVwap > 0) {
            // CONDITION D — bouncing toward VWAP
            const recent4 = chartBars.slice(-4)
            const bouncing = isShort
              ? recent4[recent4.length - 1].c > recent4[0].c && curPrice < mVwap
              : recent4[recent4.length - 1].c < recent4[0].c && curPrice > mVwap
            if (bouncing) {
              flipCondition = `Bounce fails below $${mVwap.toFixed(2)}. Wait for the first ${isShort ? 'red' : 'green'} candle after the bounce stalls — that is the entry.`
            }
          }

          if (!flipCondition) {
            // CONDITION C — default: no confirmed break yet
            const breakLevel = isShort ? orLow : orHigh
            flipCondition = `Two consecutive ${isShort ? 'red' : 'green'} candles closing ${isShort ? 'below' : 'above'} $${breakLevel.toFixed(2)} with no wick recovery — that is your entry, not before.`
          }
        }

        // Zone 2 — Entry window (post-OR, up to 45 bars)
        if (orN < chartBars.length) {
          dayZones.push({
            key: 'entry',
            from: orN,
            to: Math.min(orN + 44, chartBars.length - 1),
            fill: z2IsGo ? 'rgba(52,211,153,0.07)' : z2IsAmber ? 'rgba(232,123,58,0.07)' : z2IsWatch ? 'rgba(56,189,248,0.07)' : 'rgba(107,114,128,0.04)',
            label: z2BadgeText,
            sublabel: `${biasLabel} · post-OR`,
            markerColor: z2VColor,
            cardBg:     cBg(
              z2IsGo ? 'rgba(2,12,8,0.92)'      : z2IsAmber ? 'rgba(18,10,2,0.92)'     : z2IsWatch ? 'rgba(2,8,18,0.92)'      : 'rgba(10,10,12,0.92)',
              z2IsGo ? 'rgba(240,253,244,0.97)' : z2IsAmber ? 'rgba(255,251,235,0.97)' : z2IsWatch ? 'rgba(240,249,255,0.97)' : 'rgba(249,250,251,0.97)',
            ),
            cardBorder: cBdr(
              z2IsGo ? '#065F46' : z2IsAmber ? '#78350F' : z2IsWatch ? '#0C4A6E' : '#374151',
              z2IsGo ? '#059669' : z2IsAmber ? '#D97706' : z2IsWatch ? '#0284C7' : '#9CA3AF',
            ),
            textColor:  cTxt(z2VColor, z2IsGo ? '#065F46' : z2IsAmber ? '#92400E' : z2IsWatch ? '#0369A1' : '#374151'),
            badgeText: z2BadgeText,
            badgeBg: isDark
              ? (z2IsGo ? 'rgba(52,211,153,0.12)' : z2IsAmber ? 'rgba(232,123,58,0.12)'  : z2IsWatch ? 'rgba(56,189,248,0.12)'  : 'rgba(107,114,128,0.08)')
              : (z2IsGo ? 'rgba(52,211,153,0.18)' : z2IsAmber ? 'rgba(232,123,58,0.18)'  : z2IsWatch ? 'rgba(56,189,248,0.18)'  : 'rgba(107,114,128,0.14)'),
            price: t1 ? `T1 $${t1.toFixed(2)} · ${biasLabel}` : biasLabel,
            detail: `${z2IsGo ? 'Entry window active' : z2IsAmber ? 'Setup present · conditions not met · wait for trigger' : z2IsWatch ? 'Setup developing' : `Verdict is ${z2Verdict} — no entry yet`}. ${biasLabel} bias confirmed. ${entryReadiness}${t1 ? ` First target T1: $${t1.toFixed(2)}.` : ''}`,
            flipCondition,
          })
        }

        // Zone 3 — Hold / Monitor (after entry window)
        const holdFrom = orN + 45
        if (holdFrom < chartBars.length) {
          dayZones.push({
            key: 'monitor',
            from: holdFrom,
            to: chartBars.length - 1,
            fill: 'rgba(99,102,241,0.04)',
            label: 'Hold / Monitor',
            sublabel: t1 ? `T1 $${t1.toFixed(2)}` : 'Manage position',
            markerColor: '#818CF8',
            cardBg:     cBg('rgba(4,4,18,0.92)',       'rgba(245,243,255,0.97)'),
            cardBorder: cBdr('#312E81',                 '#7C3AED'),
            textColor:  cTxt('#A5B4FC',                 '#4C1D95'),
            badgeText: 'MANAGE',
            badgeBg: isDark ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.16)',
            price: t1 ? `T1 $${t1.toFixed(2)}${t2 ? ` · T2 $${t2.toFixed(2)}` : ''}` : undefined,
            detail: t1
              ? `Manage your ${biasLabel} position. Take ½ off at T1 $${t1.toFixed(2)}${t2 ? `, trail the rest to T2 $${t2.toFixed(2)}` : ''}. Move stop to breakeven once T1 is hit.`
              : `Manage your position. Hold your pre-planned stop. Exit at your target or stop — no early exits on noise.`,
          })

          // ── Re-entry detection (Hold/Monitor zone only) ─────────────────────
          const holdBars = chartBars.slice(holdFrom)
          // Re-entries target T2 first (original extended target); fall back to T1
          const reTarget = t2 ?? t1
          const reBlue = {
            fill:       'rgba(59,130,246,0.07)',
            markerColor:'#60a5fa',
            cardBg:     cBg('rgba(2,8,22,0.92)',       'rgba(239,246,255,0.97)'),
            cardBorder: cBdr('#1e40af',                 '#3b82f6'),
            textColor:  cTxt('#93c5fd',                 '#1d4ed8'),
            badgeText:  'RE-ENTRY',
            badgeBg:    isDark ? 'rgba(59,130,246,0.12)' : 'rgba(59,130,246,0.18)',
          }
          const candle = isShort ? 'red' : 'green'

          // Trend day overrides exhaustion — re-entries stay open all session
          const isExhausted = !trendDayData && (chartBars.length > 210 || !!(flipCondition?.includes('exhausted')))

          if (!isExhausted) {
            // Shared throttle — all three types draw from one pool (max 3 / session)
            let reEntryCount      = 0
            let lastReEntryAbsIdx = -999   // absolute bar index of the last fired card
            let lastReEntryPrice  = 0      // close price at the last fired card

            // Returns true only when all quality gates pass.
            const canFire = (absIdx: number, closePx: number, rr: number | null): boolean =>
              reEntryCount < 3
              && (absIdx - lastReEntryAbsIdx) >= 20              // Fix 1: 20-bar cooldown
              && (lastReEntryPrice <= 0 || Math.abs(closePx - lastReEntryPrice) / lastReEntryPrice >= 0.005)  // Fix 2: 0.5% price movement
              && rr != null && rr >= 1.5                         // Fix 4: R/R gate

            const markFired = (absIdx: number, closePx: number) => {
              reEntryCount++
              lastReEntryAbsIdx = absIdx
              lastReEntryPrice  = closePx
            }

            // ── A: VWAP pullback ─────────────────────────────────────────────
            // Price must pull to within 0.3% of VWAP (tighter than before),
            // confirmed by the prior candle closing in the trade direction.
            {
              let rAextended  = false
              let rAinPullback = false
              for (let i = 1; i < holdBars.length; i++) {
                const bar  = holdBars[i]!
                const prev = holdBars[i - 1]!
                const vwap = bar.vwap
                if (vwap <= 0) continue
                const distPct  = (bar.c - vwap) / vwap
                const extended = isShort ? distPct < -0.005 : distPct > 0.005
                const nearVwap = Math.abs(distPct) <= 0.003      // Fix 4: tightened 0.5→0.3%
                if (extended) { rAextended = true; rAinPullback = false }
                if (rAextended && nearVwap && !rAinPullback) {
                  rAinPullback = true
                  const absIdx = holdFrom + i
                  const stopA  = isShort ? vwap * 1.005 : vwap * 0.995
                  const invalidated = holdBars.slice(i + 1).some(b => isShort ? b.h > stopA : b.l < stopA)
                  // Fix 4: prior candle must close in trade direction
                  const prevConfirms = isShort ? prev.c < prev.o : prev.c > prev.o
                  if (!invalidated && prevConfirms) {
                    const rrA = reTarget != null ? Math.abs(reTarget - vwap) / Math.abs(vwap - stopA) : null
                    if (canFire(absIdx, bar.c, rrA)) {
                      markFired(absIdx, bar.c)
                      dayZones.push({
                        key: `reentry-a-${absIdx}`,
                        from: Math.max(absIdx - 1, holdFrom),
                        to:   Math.min(absIdx + 3, chartBars.length - 1),
                        ...reBlue,
                        label:    'RE-ENTRY',
                        sublabel: 'A — VWAP pullback',
                        price:    `VWAP $${vwap.toFixed(2)}${rrA != null ? ` · R/R ${rrA.toFixed(1)}×` : ''}`,
                        detail:   `Re-entry window · Price testing VWAP $${vwap.toFixed(2)} · Stop ${isShort ? 'above' : 'below'} VWAP $${stopA.toFixed(2)}`,
                        reentryTrigger: `First ${candle} candle off VWAP $${vwap.toFixed(2)}${rrA != null ? ` · R/R ${rrA.toFixed(1)}×` : ''}`,
                      })
                    }
                  }
                }
              }
            }

            // ── B: OR level retest ───────────────────────────────────────────
            {
              const retestLevel = isShort ? orLow : orHigh
              const stopB = isShort ? retestLevel * 1.003 : retestLevel * 0.997
              const hadBreakout = chartBars.slice(0, holdFrom).some(b =>
                isShort ? b.c < retestLevel * 0.997 : b.c > retestLevel * 1.003
              )
              if (hadBreakout) {
                let rBaway    = false
                let rBinRetest = false
                for (let i = 1; i < holdBars.length; i++) {
                  const bar  = holdBars[i]!
                  const prev = holdBars[i - 1]!
                  const dist = Math.abs(bar.c - retestLevel) / retestLevel
                  const nearLevel     = dist <= 0.003
                  const awayFromLevel = dist > 0.003
                  if (awayFromLevel) { rBaway = true; rBinRetest = false }
                  if (rBaway && nearLevel && !rBinRetest) {
                    rBinRetest = true
                    const absIdx      = holdFrom + i
                    const invalidated = holdBars.slice(i + 1).some(b => isShort ? b.h > stopB : b.l < stopB)
                    const prevConfirms = isShort ? prev.c < prev.o : prev.c > prev.o
                    if (!invalidated && prevConfirms) {
                      const rrB = reTarget != null ? Math.abs(reTarget - retestLevel) / Math.abs(retestLevel - stopB) : null
                      if (canFire(absIdx, bar.c, rrB)) {
                        markFired(absIdx, bar.c)
                        const orLabel      = isShort ? 'OR low' : 'OR high'
                        const supportLabel = isShort ? 'resistance' : 'support'
                        dayZones.push({
                          key: `reentry-b-${absIdx}`,
                          from: Math.max(absIdx - 1, holdFrom),
                          to:   Math.min(absIdx + 3, chartBars.length - 1),
                          ...reBlue,
                          label:    'RE-ENTRY',
                          sublabel: `B — ${orLabel} retest`,
                          price:    `${orLabel} $${retestLevel.toFixed(2)}${rrB != null ? ` · R/R ${rrB.toFixed(1)}×` : ''}`,
                          detail:   `Re-entry window · ${orLabel} $${retestLevel.toFixed(2)} acting as ${supportLabel} · Hold confirmed · Enter · Stop ${isShort ? 'above' : 'below'} $${stopB.toFixed(2)}`,
                          reentryTrigger: `${candle.charAt(0).toUpperCase() + candle.slice(1)} candle holding ${isShort ? 'below' : 'above'} $${retestLevel.toFixed(2)}${rrB != null ? ` · R/R ${rrB.toFixed(1)}×` : ''}`,
                        })
                      }
                    }
                  }
                }
              }
            }

            // ── C: Higher low ────────────────────────────────────────────────
            // Confirmation candle = the bar after the swing low (the first bounce bar)
            {
              const swingLows: Array<{ absIdx: number; low: number }> = []
              for (let i = 1; i < holdBars.length - 1; i++) {
                const p = holdBars[i - 1]!, c = holdBars[i]!, n = holdBars[i + 1]!
                if (c.l <= p.l && c.l <= n.l) swingLows.push({ absIdx: holdFrom + i, low: c.l })
              }
              for (let j = 1; j < swingLows.length; j++) {
                const prevSL = swingLows[j - 1]!
                const cur    = swingLows[j]!
                if (cur.low > prevSL.low) {
                  const localI   = cur.absIdx - holdFrom
                  const nextBar  = holdBars[localI + 1]   // first bounce bar
                  if (!nextBar) continue
                  // Fix 4: confirmation bar must close in trade direction
                  const nextConfirms = isShort ? nextBar.c < nextBar.o : nextBar.c > nextBar.o
                  if (!nextConfirms) continue
                  const stopC      = isShort ? cur.low * 1.003 : cur.low * 0.997
                  const afterI     = localI + 1
                  const invalidated = holdBars.slice(afterI).some(b => isShort ? b.h > cur.low : b.l < cur.low)
                  if (!invalidated) {
                    const entryApprox = nextBar.c
                    const rrC = reTarget != null ? Math.abs(reTarget - entryApprox) / Math.abs(entryApprox - stopC) : null
                    const absIdx = cur.absIdx + 1  // fire at the confirmation bar
                    if (canFire(absIdx, entryApprox, rrC)) {
                      markFired(absIdx, entryApprox)
                      dayZones.push({
                        key: `reentry-c-${absIdx}`,
                        from: Math.max(absIdx - 1, holdFrom),
                        to:   Math.min(absIdx + 3, chartBars.length - 1),
                        ...reBlue,
                        label:    'RE-ENTRY',
                        sublabel: 'C — Higher low',
                        price:    `Higher low $${cur.low.toFixed(2)}${rrC != null ? ` · R/R ${rrC.toFixed(1)}×` : ''}`,
                        detail:   `Re-entry window · Higher low at $${cur.low.toFixed(2)} · Trend intact · Next ${candle} candle is entry · Stop ${isShort ? 'above' : 'below'} $${stopC.toFixed(2)}`,
                        reentryTrigger: `First ${candle} candle off higher low $${cur.low.toFixed(2)}${rrC != null ? ` · R/R ${rrC.toFixed(1)}×` : ''}`,
                      })
                    }
                  }
                }
              }
            }
          } // end !isExhausted
        }

        const displayBars = chartInterval === '5m' ? aggregate5mBars(chartBars) : chartBars
        const displayOrMinutes = chartInterval === '5m' ? Math.max(1, Math.ceil(orN / 5)) : orN

        return (
          <div className="dt-card" style={{ background: dt.bg, border: `1px solid ${dt.border}`, borderRadius: 14, padding: '14px 16px', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div className="dt-muted" style={{ fontSize: '0.68rem', fontWeight: 700, color: dt.muted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Session Chart · OR &amp; VWAP</div>
              <div style={{ display: 'flex', gap: 4 }}>
                {(['1m', '5m'] as const).map(iv => (
                  <button key={iv} onClick={() => setChartInterval(iv)} style={{ padding: '2px 10px', borderRadius: 20, fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer', border: `1px solid ${chartInterval === iv ? dt.green : dt.border}`, background: chartInterval === iv ? (isDark ? '#064e3b' : '#d1fae5') : 'transparent', color: chartInterval === iv ? dt.green : dt.muted, transition: 'all 0.15s' }}>{iv}</button>
                ))}
              </div>
            </div>
            <PCRatioStrip
              pcRatio={typeof m.put_call_ratio === 'number' ? m.put_call_ratio as number : null}
              totalOptionsVol={typeof m.total_options_vol === 'number' ? m.total_options_vol as number : null}
              bias={result.bias ?? null}
              isDark={isDark}
            />
            <EntryWindowBanner
              key={result.ticker}
              active={sessionState === 'entry' || (!!trendDayData && sessionState !== 'hold' && sessionState !== 'exhausted')}
              ticker={result.ticker}
              direction={isShort ? 'PUT' : 'CALL'}
              entryPrice={pageEntryPoints[0]?.price ?? null}
              stopPrice={(() => {
                const base = (eg?.risk_below as number | undefined) ?? stopFallback
                return trendDayData ? (isShort ? base * 1.005 : base * 0.995) : base
              })()}
              t1={t1}
              t2={t2}
              allSession={!!trendDayData}
              onEntered={handleBannerEntered}
              onExpire={handleBannerExpire}
            />
            <DayTradeIntradayChart bars={displayBars} orHigh={orHigh} orLow={orLow} orMinutes={displayOrMinutes} sessionDate={sessionDate} entryPoints={pageEntryPoints.length > 0 ? pageEntryPoints : undefined} zones={dayZones} isDark={isDark} />
          </div>
        )
      })()}

      {/* AI Coach Walkthrough */}
      {result && (() => {
        const raw = result as unknown as Record<string, unknown> | undefined
        const m = raw?.metrics as Record<string, unknown> | undefined
        const marketBias = (result.market_bias || '').toLowerCase().replace(/_/g, ' ')
        const vwapDist = m?.vwap_dist_pct as number | undefined
        const volSpike = !!m?.volume_spike
        const orBreakout = String(m?.or_breakout ?? '').toUpperCase()
        const isShortWalk = result.bias === 'short'
        const optionRisk = result.option_risk_context
        const exec = String(result.entry_guidance?.should_enter_now || '').toUpperCase()

        const steps: string[] = []
        steps.push(marketBias ? `Market is ${marketBias}.` : 'Market context is mixed.')
        steps.push(
          isShortWalk
            ? vwapDist != null && vwapDist <= 0
              ? 'Price is below VWAP — bearish intraday structure is confirmed.'
              : 'Price is still above VWAP, so the short structure is not yet confirmed.'
            : vwapDist != null && vwapDist >= 0
              ? 'Price is holding above VWAP, so intraday structure is constructive.'
              : 'Price is not holding above VWAP yet, so structure is still fragile.'
        )
        steps.push(
          orBreakout === 'ABOVE'
            ? isShortWalk
              ? 'Price broke above the opening range — watch for a rejection back inside before shorting.'
              : 'The breakout is present, but it still needs continuation quality.'
            : orBreakout === 'BELOW'
              ? isShortWalk
                ? 'Breakdown is confirmed below ORL — follow-through volume seals the entry.'
                : 'Breakdown pressure exists below the opening range.'
              : isShortWalk
                ? 'Price is still inside the opening range — wait for a breakdown below ORL.'
                : 'Opening-range confirmation is still missing.'
        )
        steps.push(
          volSpike
            ? 'Volume is confirming the move, so execution quality improves.'
            : 'Volume is not expanding yet, so the safer entry comes after confirmation.'
        )
        if (optionRisk?.option_execution_warning) {
          steps.push(optionRisk.option_execution_warning)
        }
        steps.push(
          exec === 'YES'
            ? 'Execution is allowed now, but intraday risk still requires a tight invalidation.'
            : exec === 'CONDITIONAL'
              ? 'Entry is conditional, so wait for the trigger candle before committing size.'
              : 'Execution is not ready yet, so patience is the trade.'
        )

        return (
          <div className="dt-card" style={{ background: dt.bgDeep, border: `1px solid ${dt.border}`, borderRadius: 14, padding: '14px 16px', marginBottom: 12 }}>
            <div className="dt-muted" style={{ fontSize: '0.68rem', fontWeight: 700, color: dt.accent, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>AI Coach Walkthrough</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {steps.map((step, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, fontSize: '12px', color: dt.muted, lineHeight: 1.5 }}>
                  <span style={{ fontSize: '10px', fontWeight: 700, color: dt.accent, fontFamily: 'monospace', flexShrink: 0, width: 16, textAlign: 'right' }}>{i + 1}</span>
                  {step}
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* Alert Overlay Chart + Collapsible Alert List */}
      {result && result.metrics && (() => {
        const m = result.metrics as Record<string, unknown>
        const chartBars2 = parseChartBars(m.chart_bars)
        const orHigh2 = m.or_high as number | undefined
        const orLow2  = m.or_low  as number | undefined
        const orMin2  = m.or_minutes as number | undefined
        if (!chartBars2 || orHigh2 == null || orLow2 == null) return null

        // Build a synthetic alert from the current scan so the marker always shows,
        // even when the ticker is not on the user's day-trade watchlist.
        const actionableVerdicts = ['STRONG_GO', 'GO', 'WATCH'] as const
        const lastBar = chartBars2[chartBars2.length - 1]
        const scanAlert: DayTradeAlertEvent | null =
          lastBar && (actionableVerdicts as readonly string[]).includes(result.verdict)
            ? {
                id: `scan-${result.ticker}-${lastBar.t}`,
                ticker: result.ticker,
                companyName: result.company_name,
                previousVerdict: '',
                verdict: result.verdict,
                bias: result.bias,
                bullScore: result.bull_score,
                bearScore: result.bear_score,
                reasons: result.reasons ?? [],
                metrics: result.metrics,
                detectedAt: new Date(lastBar.t).getTime(),
                emailSent: false,
              }
            : null

        return (
          <DayTradeAlertOverlay
            bars={chartBars2}
            orHigh={orHigh2}
            orLow={orLow2}
            orMinutes={orMin2 ?? 15}
            ticker={result.ticker}
            scanAlerts={scanAlert ? [scanAlert] : []}
          />
        )
      })()}

      {/* Step-by-step walkthrough */}
      {result && (
        <DayTradeWalkthrough result={result} />
      )}

      {/* Flow reference */}
      <details className="group rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900 overflow-hidden">
        <summary className="flex cursor-pointer items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-secondary hover:bg-surface-muted/30">
          <span className="flex items-center gap-2">
            <BarChart2 size={16} className="text-violet-400" />
            What this prototype does
          </span>
          <ChevronDown size={16} className="text-muted transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t border-slate-100 dark:border-white/[0.05] px-4 pb-4 space-y-3 text-xs text-gray-500 pt-3">
          <p>
            Pulls <span className="text-secondary">1-minute</span> regular-session candles, builds session{' '}
            <span className="text-secondary">VWAP</span>,{' '}
            <span className="text-secondary">opening range</span> (first 15 minutes), checks price vs range and VWAP, short lookback{' '}
            <span className="text-secondary">momentum</span>, and a simple <span className="text-secondary">volume spike</span> flag.
            Blends in <span className="text-secondary">SPY / QQQ</span> one-day change and <span className="text-secondary">VIX</span> as risk context.
          </p>
          <p className="text-amber-200/70 border border-amber-800/40 bg-amber-950/20 rounded-lg px-3 py-2">
            <Flame size={12} className="inline mr-1" />
            Educational only — not financial advice. Intraday data can be delayed; verify prices with your broker.
          </p>
          <ul className="space-y-2">
            <li className="flex gap-2"><Clock size={14} className="shrink-0 text-muted" /> Most recent trading day in the feed is analyzed if today has no session yet.</li>
            <li className="flex gap-2"><ArrowDown size={14} className="shrink-0 text-muted" /> <span className="text-tertiary">Market bias</span> tells you whether the tape is supportive. <span className="text-tertiary">Execution readiness</span> tells you whether the trigger is actually there.</li>
            <li className="flex gap-2"><ArrowDown size={14} className="shrink-0 text-muted" /> The page now resolves everything into <span className="text-tertiary">READY / WAIT / WATCH / AVOID</span> so a bullish tape does not get mistaken for an immediate entry.</li>
            <li className="flex gap-2"><Zap size={14} className="shrink-0 text-orange-400" /> <span><span className="text-tertiary">Trend day detection</span> fires when SPY moves {'>'} 0.8%, VIX confirms, and 3+ watchlist tickers move in the same direction. Extension rules are suspended and the entry window stays open all session. See Help → Day Trade Engine for full detection thresholds.</span></li>
          </ul>
        </div>
      </details>

      {portfolioOpen && result && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal>
          <div className="w-full max-w-md rounded-2xl border border-gray-700 bg-gray-900 shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
              <div className="text-base font-bold text-white">Add to Positions Center</div>
              <button
                type="button"
                onClick={() => setPortfolioOpen(false)}
                className="text-gray-500 hover:text-gray-300 p-1"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <div className="rounded-lg bg-gray-800/40 border border-gray-700/50 px-3 py-2.5 flex items-center gap-3">
                <span className="font-mono font-bold text-white text-base">{result.ticker}</span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${result.bias === 'short' ? 'bg-rose-900/60 text-rose-300' : 'bg-emerald-900/60 text-emerald-300'}`}>
                  {result.bias === 'short' ? 'BEARISH' : 'BULLISH'}
                </span>
                <span className="text-xs text-gray-500 ml-auto">{result.final_decision}</span>
              </div>
              <div>
                <label className="text-xs text-gray-500 font-semibold uppercase tracking-wide">Contracts</label>
                <input
                  className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white font-mono"
                  inputMode="numeric"
                  placeholder="1"
                  value={portfolioContracts}
                  onChange={e => setPortfolioContracts(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 font-semibold uppercase tracking-wide">Stock price</label>
                  <input
                    className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white font-mono"
                    inputMode="decimal"
                    placeholder="e.g. 185.00"
                    value={portfolioStockPrice}
                    onChange={e => setPortfolioStockPrice(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-semibold uppercase tracking-wide">Strike price</label>
                  <input
                    className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white font-mono"
                    inputMode="decimal"
                    placeholder="e.g. 185.00"
                    value={portfolioStrike}
                    onChange={e => setPortfolioStrike(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 font-semibold uppercase tracking-wide">Premium paid (per share)</label>
                {/* Estimated premium targets from delta conversion */}
                {(() => {
                  const pt = (result?.entry_guidance as Record<string, unknown> | null | undefined)?.premium_targets as Record<string, unknown> | undefined
                  if (!pt) return null
                  const _n = (k: string) => typeof pt[k] === 'number' ? pt[k] as number : null
                  const items = [
                    { label: 'Stop', val: _n('stop_premium'), cls: 'text-rose-400 border-rose-800/60 bg-rose-950/30' },
                    { label: 'T1',   val: _n('t1_premium'),   cls: 'text-emerald-400 border-emerald-800/60 bg-emerald-950/30' },
                    { label: 'T2',   val: _n('t2_premium'),   cls: 'text-emerald-300 border-emerald-700/60 bg-emerald-950/20' },
                  ].filter(i => i.val != null)
                  if (items.length === 0) return null
                  return (
                    <div className="mt-1 mb-2 flex flex-wrap gap-1.5">
                      {_n('atm_premium') != null && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full border border-violet-700/60 bg-violet-950/30 text-violet-300 font-mono">
                          ATM ${(_n('atm_premium') as number).toFixed(2)}
                        </span>
                      )}
                      {items.map(i => (
                        <button
                          key={i.label}
                          type="button"
                          onClick={() => setPortfolioEntryPrice(String(i.val))}
                          className={`text-[10px] px-2 py-0.5 rounded-full border font-mono font-semibold cursor-pointer hover:opacity-80 ${i.cls}`}
                          title={`Use ${i.label} premium`}
                        >
                          {i.label} ${(i.val as number).toFixed(2)}
                        </button>
                      ))}
                      {pt.source === 'atm_approx' && (
                        <span className="text-[10px] text-gray-600">δ≈0.5 est.</span>
                      )}
                      {_n('delta_used') != null && pt.source === 'chain' && (
                        <span className="text-[10px] text-gray-600">δ={_n('delta_used')}</span>
                      )}
                    </div>
                  )
                })()}
                <input
                  className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white font-mono"
                  inputMode="decimal"
                  placeholder="e.g. 2.45"
                  value={portfolioEntryPrice}
                  onChange={e => setPortfolioEntryPrice(e.target.value)}
                />
                <p className="mt-1 text-[10px] text-gray-600">Cost per share · 1 contract = 100 shares · click a pill to use estimated value</p>
              </div>
              <div>
                <label className="text-xs text-gray-500 font-semibold uppercase tracking-wide">Expiry (optional, YYYY-MM-DD)</label>
                <input
                  className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white font-mono"
                  placeholder="2026-05-16"
                  value={portfolioExpiry}
                  onChange={e => setPortfolioExpiry(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 font-semibold uppercase tracking-wide">Notes (optional)</label>
                <textarea
                  className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm min-h-[60px]"
                  placeholder="Plan / context"
                  value={portfolioNotes}
                  onChange={e => setPortfolioNotes(e.target.value)}
                />
              </div>
              {portfolioErr && (
                <div className="text-rose-300 text-xs">{portfolioErr}</div>
              )}
              <button
                type="button"
                onClick={submitPortfolio}
                disabled={portfolioSubmitting}
                className="w-full rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold py-2.5"
              >
                Save to Positions Center
              </button>
            </div>
          </div>
        </div>
      )}

      {enterOpen && result && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal>
          <div className="w-full max-w-md rounded-2xl border border-gray-700 bg-gray-900 shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
              <div className="text-base font-bold text-white">Day Trade Active</div>
              <button
                type="button"
                onClick={() => setEnterOpen(false)}
                className="text-gray-500 hover:text-gray-300 p-1"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-4 space-y-3 text-sm">
              {/* Day / Swing toggle — most important decision */}
              <div>
                <label className="text-xs text-gray-500 font-semibold uppercase tracking-wide">Trade type</label>
                <div className="flex gap-2 mt-1">
                  {(['day', 'swing'] as const).map(mode => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setTradeMode(mode)}
                      className={`flex-1 rounded-xl py-2.5 font-bold text-sm border transition-colors ${
                        tradeMode === mode
                          ? mode === 'day'
                            ? 'bg-orange-600 border-orange-500 text-white'
                            : 'bg-sky-600 border-sky-500 text-white'
                          : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
                      }`}
                    >
                      {mode === 'day' ? '⚡ Day Trade' : '📈 Swing Trade'}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-gray-500 leading-relaxed">
                  {tradeMode === 'day'
                    ? 'Intraday only — guidance uses VWAP, OR, and volume. Close by 3:45 PM ET regardless of P&L.'
                    : 'Multi-day hold — guidance uses DTE and swing thesis. Ignore intraday noise.'}
                </p>
                {/* DTE conflict warning */}
                {tradeMode === 'day' && expiryInput.trim() && (() => {
                  const d = new Date(expiryInput.trim() + 'T00:00:00')
                  const dte = Math.ceil((d.getTime() - Date.now()) / 86400000)
                  return Number.isFinite(dte) && dte > 3
                    ? (
                      <div className="mt-1.5 rounded-lg border border-amber-700/50 bg-amber-950/30 px-2.5 py-2 text-[11px] text-amber-300">
                        ⚠️ This expiry has <strong>{dte} DTE</strong> — that's a multi-day position. Consider switching to <strong>Swing Trade</strong> so the tool holds through intraday dips and uses DTE-aware exit rules.
                      </div>
                    )
                    : null
                })()}
              </div>
              <div>
                <label className="text-xs text-gray-500 font-semibold uppercase tracking-wide">Side</label>
                <div className="flex gap-2 mt-1">
                  {(['CALL', 'PUT'] as const).map(s => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSide(s)}
                      className={`flex-1 rounded-xl py-2 font-semibold border transition-colors ${
                        side === s
                          ? 'bg-violet-600 border-violet-500 text-white'
                          : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 font-semibold uppercase tracking-wide">Option entry (premium)</label>
                <input
                  className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white font-mono"
                  inputMode="decimal"
                  placeholder="e.g. 2.45"
                  value={entryPrice}
                  onChange={e => setEntryPrice(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 font-semibold uppercase tracking-wide">Contracts (optional)</label>
                <input
                  className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white font-mono"
                  inputMode="decimal"
                  placeholder="1"
                  value={contracts}
                  onChange={e => setContracts(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 font-semibold uppercase tracking-wide">Strike (optional)</label>
                <input
                  className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white font-mono"
                  inputMode="decimal"
                  placeholder="e.g. 575"
                  value={strikeInput}
                  onChange={e => setStrikeInput(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 font-semibold uppercase tracking-wide">
                  Expiry (optional, YYYY-MM-DD)
                </label>
                <input
                  className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white font-mono"
                  placeholder="2026-06-20"
                  value={expiryInput}
                  onChange={e => setExpiryInput(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 font-semibold uppercase tracking-wide">Notes (optional)</label>
                <textarea
                  className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm min-h-[72px]"
                  placeholder="Plan / context"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                />
              </div>
              {enterErr && (
                <div className="text-rose-300 text-xs">{enterErr}</div>
              )}
              <button
                type="button"
                onClick={() => void submitEnter()}
                disabled={enterSubmitting}
                className="w-full rounded-xl bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white font-semibold py-2.5"
              >
                {enterSubmitting ? <Loader2 className="inline animate-spin" size={16} /> : null} Save &amp; open Day Trade Active
              </button>
            </div>
          </div>
        </div>
      )}

      {alertOpen && result && (
        <SetAlertDrawer
          ticker={result.ticker}
          tradeType="day"
          onClose={() => setAlertOpen(false)}
          onSubmit={handleCreateAlert}
        />
      )}
      </div>{/* end right content */}
    </div>{/* end flex container */}
  </div>
  )
}
