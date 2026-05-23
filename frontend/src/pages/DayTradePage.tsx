import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowDown, ArrowLeft, ArrowUpRight, BarChart2, Bell, ChevronDown, ChevronRight,
  Clock, Flame, Loader2, RefreshCw, Search, ShieldAlert, X, Zap,
} from 'lucide-react'
import { analyzeDayTrade, enterActiveTrade } from '../api/client'
import { fetchMyTickers } from '../api/commandCenter'
import DayTradeEnginePanel from '../components/DayTradeEnginePanel'
import { MarketTimeGateBanner } from '../components/MarketTimeGate'
import { useApp } from '../contexts/AppContext'
import { ROUTES } from '../routing/routes'
import { getActionButtonClass } from '../utils/semanticTrading'

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
  } = useApp()
  const [searchParams] = useSearchParams()
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
  const [portfolioEntryPrice, setPortfolioEntryPrice] = useState('')
  const [portfolioExpiry, setPortfolioExpiry] = useState('')
  const [portfolioNotes, setPortfolioNotes] = useState('')
  const [portfolioErr, setPortfolioErr] = useState<string | null>(null)
  const [portfolioSubmitting, setPortfolioSubmitting] = useState(false)
  const [portfolioDfltDte, setPortfolioDfltDte] = useState(7)
  const [portfolioBias, setPortfolioBias] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'success' | 'info'; message: string } | null>(null)
  const [side, setSide] = useState<'CALL' | 'PUT'>('CALL')
  const [tradeMode, setTradeMode] = useState<'day' | 'swing'>('day')
  const [entryPrice, setEntryPrice] = useState('')
  const [contracts, setContracts] = useState('')
  const [strikeInput, setStrikeInput] = useState('')
  const [expiryInput, setExpiryInput] = useState('')
  const [notes, setNotes] = useState('')
  const [enterSubmitting, setEnterSubmitting] = useState(false)
  const [enterErr, setEnterErr] = useState<string | null>(null)
  const autoRunRef = useRef(false)
  const [myTickers, setMyTickers] = useState<string[]>([])
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)

  useEffect(() => {
    fetchMyTickers().then(res => {
      const symbols = (res.data?.tickers ?? [])
        .filter(t => (t.trade_types || []).includes('day'))
        .map(t => t.symbol).filter(Boolean).slice(0, 10)
      setMyTickers(symbols)
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

  // Track last processed URL ticker to avoid reacting to searchParams identity
  const processedUrlTickerRef = useRef<string | null>(null)
  const urlTickerRaw = searchParams.get('ticker')
  const urlTicker = urlTickerRaw?.trim().toUpperCase() ?? null

  useEffect(() => {
    if (!urlTicker || urlTicker.length > 12) return
    if (urlTicker === processedUrlTickerRef.current) return
    processedUrlTickerRef.current = urlTicker
    if (ticker.trim().toUpperCase() !== urlTicker) {
      setUi(cur => ({ ...cur, ticker: urlTicker }))
    }
    autoRunRef.current = true
  }, [urlTicker, ticker, setUi])

  useEffect(() => {
    if (!autoRunRef.current || !ticker.trim()) return
    const urlT = searchParams.get('ticker')?.trim().toUpperCase()
    if (urlT && urlT !== ticker.trim().toUpperCase()) return
    autoRunRef.current = false
    runScan()
  }, [ticker, runScan, searchParams])

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
    setPortfolioContracts('1')
    setPortfolioEntryPrice(eg?.entry_zone ? String(eg.entry_zone) : lastU > 0 ? String(lastU) : '')
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
    let ep = 0
    if (portfolioEntryPrice.trim()) {
      ep = parseFloat(portfolioEntryPrice)
      if (!Number.isFinite(ep) || ep < 0) {
        setPortfolioErr('Entry price must be a positive number.')
        return
      }
    }
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
    addManualPosition({
      ticker: result.ticker,
      companyName: result.company_name ?? result.ticker,
      strategy,
      bias: direction,
      legs: [],
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
      entryPrice: lastU,
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

  return (
    <div className="day-trade-page min-h-screen p-4 md:p-6 text-primary">
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
          <section className="rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900 p-4 sm:p-5">
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Ticker</label>
            <div className="flex flex-col sm:flex-row lg:flex-col gap-2">
              <input
                className="flex-1 min-w-0 rounded-lg border border-slate-200 dark:border-white/[0.08] bg-slate-50 dark:bg-slate-800/50 px-4 py-3 font-mono text-lg uppercase outline-none placeholder:text-muted focus:border-violet-500"
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
            <p className="text-[11px] text-gray-500 mt-2">
              Uses Yahoo 1-minute RTH data for the most recent session, session VWAP, first 15m opening range, short-horizon momentum, volume vs average, plus SPY/QQQ daily change and VIX.
            </p>
            {myTickers.length > 0 && (
              <div className="flex gap-2 mt-3 flex-wrap">
                <span className="text-xs text-gray-500 self-center">Quick:</span>
                {myTickers.map((t: string) => (
                  <a key={t} href={`/day-trade?ticker=${encodeURIComponent(t)}`}
                    onClick={(e) => { e.preventDefault(); setUi(cur => ({ ...cur, ticker: t })); runScan(t) }}
                    className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors font-mono inline-block cursor-pointer"
                  >
                    {t}
                  </a>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Right: Content */}
        <div className="flex-1 min-w-0 space-y-4">

        {/* Header */}
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-600/20 border border-orange-700 text-orange-400">
                <Zap size={18} />
              </div>
              <h1 className="tcc-hero-title text-2xl font-bold tracking-tight text-heading sm:text-3xl">Day Trade Engine</h1>
              <span className="rounded-full border border-semantic-info-border bg-semantic-info-bg px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-semantic-info">Intraday</span>
            </div>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-gray-400">Intraday scanner — 1m bars, VWAP, opening range, momentum, volume, and SPY/VIX context.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {searchParams.get('from') && (
              <button
                type="button"
                onClick={() => routerNavigate(searchParams.get('from')!)}
                className={`${getActionButtonClass('surface')} gap-2 rounded-full px-3 py-2 text-sm`}
              >
                <ArrowLeft size={16} /> Back
              </button>
            )}
            <button
              type="button"
              onClick={() => void runScan()}
              disabled={loading || refreshing}
              className={`${getActionButtonClass('surface')} gap-2 rounded-full px-3 py-2 text-sm`}
            >
              <RefreshCw size={16} className={refreshing || loading ? 'animate-spin' : ''} /> {refreshing ? 'Refreshing…' : loading ? 'Scanning…' : 'Refresh'}
            </button>
            {lastRefreshed && (
              <span className="text-[10px] text-gray-500 whitespace-nowrap">
                Updated {lastRefreshed.toLocaleTimeString()}
              </span>
            )}
          </div>
        </header>

        <MarketTimeGateBanner tradeType="day" />

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

      {result && (
        <>
          <DayTradeEnginePanel
            result={result}
            existingPositions={existingPositions}
            onRefresh={() => void runScan()}
            refreshing={refreshing || loading}
            onAddToPortfolio={openPortfolioModal}
            onViewPositions={() => routerNavigate(ROUTES.positions)}
            onRequestEnterActiveTrade={canAccessPage('active-trades') ? openEnterModal : undefined}
            onOpenStrategyFinder={() => routerNavigate(`${ROUTES.strategyFinder}?ticker=${encodeURIComponent(result.ticker)}`)}
            onOpenCommandCenter={() => routerNavigate(`${ROUTES.tradeCommandCenter}?ticker=${encodeURIComponent(result.ticker)}`)}
            onCreateAlert={() => setAlertOpen(true)}
            onAddToWatchlist={handleAddToWatchlist}
          />
        </>
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
              <div>
                <label className="text-xs text-gray-500 font-semibold uppercase tracking-wide">Option premium paid (optional)</label>
                <input
                  className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white font-mono"
                  inputMode="decimal"
                  placeholder="e.g. 2.45"
                  value={portfolioEntryPrice}
                  onChange={e => setPortfolioEntryPrice(e.target.value)}
                />
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
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal>
          <div className="w-full max-w-md rounded-2xl border border-gray-700 bg-gray-900 shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
              <div className="text-base font-bold text-white">Create Day Alert</div>
              <button
                type="button"
                onClick={() => setAlertOpen(false)}
                className="text-gray-500 hover:text-gray-300 p-1"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <div className="rounded-lg bg-gray-800/40 border border-gray-700/50 px-3 py-2.5 space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Ticker</span>
                  <span className="text-gray-200 font-bold">{result.ticker}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Engine</span>
                  <span className="text-gray-200 font-bold">Day Trade</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Alert Focus</span>
                  <span className="text-amber-300 font-bold">{(result.execution_readiness || result.execution_timing || result.final_decision).replace(/_/g, ' ')}</span>
                </div>
                <div className="pt-1 text-xs text-gray-300 leading-relaxed">
                  {result.entry_guidance?.action || result.reason || 'Use alerts to catch the next valid VWAP hold, breakout, or intraday risk shift.'}
                </div>
              </div>
              <p className="text-xs text-gray-500">
                Open Alert Center to create a ticker alert with this intraday setup in mind.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => routerNavigate(`${ROUTES.alerts}?ticker=${encodeURIComponent(result.ticker)}`)}
                  className="flex-1 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold py-2.5 text-sm transition-colors"
                >
                  Open Alert Center
                </button>
                <button
                  type="button"
                  onClick={() => setAlertOpen(false)}
                  className="flex-1 rounded-xl border border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 font-semibold py-2.5 text-sm transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>{/* end right content */}
    </div>{/* end flex container */}
  </div>
  )
}
