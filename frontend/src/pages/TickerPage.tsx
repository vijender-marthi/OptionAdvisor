import { useState, useEffect, useRef } from 'react'
import { Star, StarOff, RefreshCw, Database, Layers, CheckCircle2, AlertTriangle, XCircle, Clock } from 'lucide-react'
import { analyzeOptions } from '../api/client'
import type { AnalyzeResponse, StrategyMode, TickerCacheEntry } from '../types'
import { isCacheFresh, cacheAge } from '../types'
import TickerInput from '../components/TickerInput'
import MarketOverview from '../components/MarketOverview'
import SignalPanel from '../components/SignalPanel'
import RecommendationCard from '../components/RecommendationCard'
import OptionsChainTable from '../components/OptionsChainTable'
import PriceChart from '../components/PriceChart'
import OptionProfitCalculator from '../components/OptionProfitCalculator'
import { useApp } from '../contexts/AppContext'
import { buildChecklist, deriveVerdict } from '../components/PreTradeChecklist'
import type { Verdict } from '../components/PreTradeChecklist'
import { MULTI_WEEK_TARGETS } from '../data/stockUniverse'

// ─── Global week selector ─────────────────────────────────────────────────────

function bestVerdict(vs: Verdict[]): Verdict | null {
  if (vs.includes('GO'))      return 'GO'
  if (vs.includes('CAUTION')) return 'CAUTION'
  if (vs.includes('NO GO'))   return 'NO GO'
  return null
}

const VERDICT_DOT: Record<Verdict, string> = {
  'GO':      'bg-emerald-500',
  'CAUTION': 'bg-amber-500',
  'NO GO':   'bg-red-500',
}
const VERDICT_ICON: Record<Verdict, React.ReactNode> = {
  'GO':      <CheckCircle2 size={11} className="text-emerald-400" />,
  'CAUTION': <AlertTriangle size={11} className="text-amber-400" />,
  'NO GO':   <XCircle size={11} className="text-red-400" />,
}
const VERDICT_TEXT: Record<Verdict, string> = {
  'GO':      'text-emerald-400',
  'CAUTION': 'text-amber-400',
  'NO GO':   'text-red-400',
}

interface WeekSlot {
  weeksOut: number
  label: string
  dte: number | null
  verdict: Verdict | null
  recCount: number
  hasData: boolean
}

function buildWeekSlots(entry: TickerCacheEntry): WeekSlot[] {
  const slots = new Map<string, WeekSlot>()

  // Primary entry
  if (entry.data.recommendations.length > 0) {
    const dte = entry.data.recommendations[0].dte
    const label = `${entry.weeksOut}w`
    const verdicts = entry.data.recommendations.map(r =>
      deriveVerdict(buildChecklist(r, entry.data.signals))
    )
    slots.set(label, { weeksOut: entry.weeksOut, label, dte, verdict: bestVerdict(verdicts), recCount: verdicts.length, hasData: true })
  } else {
    slots.set(`${entry.weeksOut}w`, { weeksOut: entry.weeksOut, label: `${entry.weeksOut}w`, dte: null, verdict: null, recCount: 0, hasData: true })
  }

  // Multi-week entries
  if (entry.multiWeekData) {
    for (const [weeksOut, mdata] of Object.entries(entry.multiWeekData)) {
      const d = mdata as AnalyzeResponse
      const dte = d.recommendations[0]?.dte ?? null
      const label = `${weeksOut}w`
      if (slots.has(label)) continue  // don't overwrite primary for the same requested window
      const verdicts = d.recommendations.map(r => deriveVerdict(buildChecklist(r, d.signals)))
      slots.set(label, { weeksOut: Number(weeksOut), label, dte, verdict: bestVerdict(verdicts), recCount: verdicts.length, hasData: true })
    }
  }

  // Build ordered list for all 5 windows
  return MULTI_WEEK_TARGETS.map(w => {
    const label = `${w}w`
    return slots.get(label) ?? { weeksOut: w, label, dte: null, verdict: null, recCount: 0, hasData: false }
  })
}

function WeekSelector({ entry, selectedWeeksOut, onSelect, onFetch, fetching, loadingWeeks }: {
  entry: TickerCacheEntry
  selectedWeeksOut: number
  onSelect: (weeksOut: number) => void
  onFetch: () => void
  fetching: boolean
  loadingWeeks: Set<number>   // weeks currently being fetched individually
}) {
  const slots = buildWeekSlots(entry)
  const hasFetched = !!entry.multiWeekData
  const goCount = slots.filter(s => s.verdict === 'GO').length

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl px-3 sm:px-4 py-3">
      <div className="flex flex-col lg:flex-row lg:items-center gap-3 sm:gap-4">
      <div className="flex items-center gap-1.5 shrink-0">
        <Layers size={14} className="text-violet-400" />
        <span className="text-xs font-semibold text-gray-300">Week Filter</span>
        {goCount > 0 && (
          <span className="text-[10px] font-bold bg-emerald-900/50 text-emerald-400 border border-emerald-800 px-1.5 py-0.5 rounded-full ml-1">
            {goCount} GO
          </span>
        )}
      </div>

      <div className="flex lg:items-center gap-2 flex-1 overflow-x-auto lg:overflow-visible lg:flex-wrap mobile-week-scroll -mx-1 px-1">
        {slots.map(slot => {
          const active = selectedWeeksOut === slot.weeksOut
          const isLoading = loadingWeeks.has(slot.weeksOut)
          const dotColor = isLoading
            ? 'bg-violet-400 animate-pulse'
            : slot.verdict
            ? VERDICT_DOT[slot.verdict]
            : slot.hasData ? 'bg-gray-500' : 'bg-gray-600'
          return (
            <button
              key={slot.label}
              type="button"
              onClick={() => onSelect(slot.weeksOut)}
              disabled={isLoading}
              title={isLoading ? 'Loading…' : !slot.hasData ? 'Click to load this expiry window' : undefined}
              className={`min-w-[5.25rem] lg:min-w-0 flex flex-col items-center gap-0.5 rounded-xl border px-3 py-2 text-[10px] font-bold transition-all ${
                active
                  ? 'bg-violet-600/20 border-violet-500 text-violet-300'
                  : isLoading
                  ? 'bg-violet-900/10 border-violet-800 opacity-70 cursor-wait'
                  : slot.hasData
                  ? 'bg-gray-800/60 border-gray-700 hover:border-gray-500 hover:bg-gray-800 cursor-pointer'
                  : 'bg-gray-800/40 border-gray-700 hover:border-violet-700 hover:bg-gray-800 cursor-pointer'
              }`}
            >
              {/* dot + week label + actual DTE */}
              <div className="flex items-center gap-1">
                <div className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
                <span className={active ? 'text-violet-300' : 'text-gray-300'}>{slot.label}</span>
                {slot.dte !== null && (
                  <span className="text-gray-600 font-normal">· {slot.dte}d</span>
                )}
              </div>
              {/* verdict / status */}
              {isLoading ? (
                <span className="text-violet-400 mt-0.5">loading…</span>
              ) : slot.hasData ? (
                slot.verdict ? (
                  <div className={`flex items-center gap-0.5 mt-0.5 ${VERDICT_TEXT[slot.verdict]}`}>
                    {VERDICT_ICON[slot.verdict]}
                    {slot.verdict}
                  </div>
                ) : (
                  <span className="text-gray-600 mt-0.5">no trades</span>
                )
              ) : (
                <span className="text-gray-500 mt-0.5">tap to load</span>
              )}
              {/* trade count */}
              {slot.recCount > 0 && (
                <span className="text-gray-600 font-normal">{slot.recCount} trade{slot.recCount !== 1 ? 's' : ''}</span>
              )}
            </button>
          )
        })}
      </div>

      <button
        onClick={onFetch}
        disabled={fetching}
        className="w-full lg:w-auto justify-center flex items-center gap-1.5 px-3 py-2 lg:py-1.5 bg-gray-800 hover:bg-violet-600/20 border border-gray-700
                   hover:border-violet-600 text-gray-400 hover:text-violet-300 text-xs font-semibold rounded-xl
                   transition-colors disabled:opacity-50 shrink-0"
      >
        <Layers size={11} className={fetching ? 'animate-pulse text-violet-400' : ''} />
        {fetching ? 'Fetching all weeks…' : hasFetched ? 'Re-fetch All' : 'Load All Weeks'}
      </button>
      </div>
    </div>
  )
}

export default function TickerPage() {
  const {
    addToWatchlist, removeFromWatchlist, isWatched,
    pendingTicker, clearPendingTicker,
    getCached, setCached, tickerCache,
    fetchAllWeeks, fetchSingleWeek, fetchingAllWeeks, fetchingWeeks,
  } = useApp()

  const [data,          setData]          = useState<AnalyzeResponse | null>(null)
  const [loading,       setLoading]       = useState(false)
  const [error,         setError]         = useState<string | null>(null)
  const [activeTab,     setActiveTab]     = useState<'chart' | 'calculator' | 'chain'>('chart')
  const [fromCache,     setFromCache]     = useState<{ age: number; fresh: boolean } | null>(null)
  const [lastWeeks,     setLastWeeks]     = useState(4)
  const [lastWidth,     setLastWidth]     = useState<number | null>(5)
  const [lastMode,      setLastMode]      = useState<StrategyMode>('all')
  const [inputTicker,   setInputTicker]   = useState('')
  const [selectedWeeksOut, setSelectedWeeksOut] = useState(4)

  const didRun = useRef(false)

  // ── Core analysis function (always hits API) ──────────────────────────────
  const handleAnalyze = async (
    ticker: string,
    weeksOut = 4,
    spreadWidth: number | null = 5,
    strategyMode: StrategyMode = 'all',
  ) => {
    setInputTicker(ticker.trim().toUpperCase())
    setLoading(true)
    setError(null)
    setFromCache(null)
    setLastWeeks(weeksOut)
    setLastWidth(spreadWidth)
    setLastMode(strategyMode)
    setSelectedWeeksOut(weeksOut)
    try {
      const result = await analyzeOptions(ticker, weeksOut, spreadWidth, strategyMode)
      setData(result)
      setActiveTab('chart')
      setCached(ticker, result, weeksOut, spreadWidth, strategyMode)
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } }; message?: string })
          ?.response?.data?.detail ??
        (e as { message?: string })?.message ??
        'Something went wrong'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  // ── Serve from cache if fresh, otherwise fetch ───────────────────────────
  const handleAnalyzeWithCache = (
    ticker: string,
    weeksOut = 4,
    spreadWidth: number | null = 5,
    strategyMode: StrategyMode = 'all',
  ) => {
    setInputTicker(ticker.trim().toUpperCase())
    const cached = getCached(ticker)
    if (cached && isCacheFresh(cached) &&
        cached.weeksOut === weeksOut &&
        cached.spreadWidth === spreadWidth &&
        (cached.strategyMode ?? 'all') === strategyMode) {
      setData(cached.data)
      setActiveTab('chart')
      setFromCache({ age: cacheAge(cached), fresh: true })
      setError(null)
      setLastWeeks(weeksOut)
      setLastWidth(spreadWidth)
      setLastMode(strategyMode)
      setSelectedWeeksOut(weeksOut)
    } else {
      handleAnalyze(ticker, weeksOut, spreadWidth, strategyMode)
    }
  }

  // ── Auto-run when arriving from Watchlist ─────────────────────────────────
  useEffect(() => {
    if (pendingTicker && !didRun.current) {
      didRun.current = true
      setInputTicker(pendingTicker)
      clearPendingTicker()
      handleAnalyzeWithCache(pendingTicker, 4, 5, 'all')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingTicker])

  useEffect(() => {
    if (!pendingTicker) didRun.current = false
  }, [pendingTicker])

  // ── Watchlist toggle ──────────────────────────────────────────────────────
  const watched = data ? isWatched(data.ticker) : false

  const toggleWatchlist = () => {
    if (!data) return
    if (watched) {
      removeFromWatchlist(data.ticker)
    } else {
      addToWatchlist({
        ticker: data.ticker,
        companyName: data.company_name,
        sector: data.sector,
        lastPrice: data.signals.current_price,
      })
    }
  }

  // ── Manual refresh (bypass cache) ────────────────────────────────────────
  const handleRefresh = () => {
    if (data) handleAnalyze(data.ticker, lastWeeks, lastWidth, lastMode)
  }

  const cacheEntry = data ? tickerCache[data.ticker] : null
  const selectedData =
    !cacheEntry
      ? data
      : cacheEntry.weeksOut === selectedWeeksOut
      ? cacheEntry.data
      : cacheEntry.multiWeekData?.[selectedWeeksOut] ?? null
  const displayData = selectedData ?? data

  return (
    <div className="ticker-page min-h-screen p-3 sm:p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-4">

        <TickerInput onAnalyze={handleAnalyzeWithCache} loading={loading} initialTicker={inputTicker} />

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <svg className="animate-spin h-10 w-10 text-violet-500" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-gray-400 text-lg">Running systematic analysis…</span>
            <span className="text-gray-500 text-sm">Fetching options chain · Computing signals · Scoring trades</span>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="bg-red-900/20 border border-red-800 rounded-2xl p-5">
            <div className="text-red-400 font-semibold mb-1">⚠️ Analysis Failed</div>
            <div className="text-red-300 text-sm">{error}</div>
            <div className="text-gray-500 text-xs mt-2">
              Common issues: Invalid ticker · No options available · Market closed
            </div>
          </div>
        )}

        {/* Results */}
        {!loading && data && displayData && (
          <>
            {/* Header bar: cache badge + watchlist + refresh */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              {fromCache ? (
                <div className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border
                                bg-blue-900/20 border-blue-800 text-blue-400">
                  <Database size={12} />
                  {fromCache.fresh
                    ? `Cached · ${fromCache.age === 0 ? 'just now' : `${fromCache.age}m ago`}`
                    : 'Stale cache'}
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border
                                bg-emerald-900/20 border-emerald-800 text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
                  Live data
                </div>
              )}

              {/* Strategy mode badge */}
              {lastMode !== 'all' ? (
                <div className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border
                                bg-violet-900/20 border-violet-800 text-violet-400">
                  {lastMode === 'long_only'         ? '📈 Long Options Only'
                   : lastMode === 'credit_only'      ? '💰 Credit Spreads Only'
                   : lastMode === 'short_or_covered' ? '🎯 Short / Covered Only'
                   : '💰 Credit Spreads Only'}
                </div>
              ) : (
                /* In "All" mode + HIGH IV: show why Long Calls/Puts are suppressed */
                displayData.signals.iv_rank >= 50 && (
                  displayData.signals.directional_bias.toLowerCase().includes('bullish') ||
                  displayData.signals.directional_bias.toLowerCase().includes('bearish')
                ) && (
                  <div className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border
                                  bg-amber-900/20 border-amber-800/60 text-amber-400/90"
                    title="In All Strategies mode, naked Long Calls/Puts are suppressed when IV Rank ≥ 50 to prevent buying expensive premium that can be crushed post-catalyst. Switch to Long Options mode to override.">
                    ⚠️ IV Rank {displayData.signals.iv_rank.toFixed(0)}% — Long Call/Put suppressed
                    <span className="text-amber-600 ml-1">· use Long Options mode to unlock</span>
                  </div>
                )
              )}

              <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:justify-end">
                <button
                  onClick={handleRefresh}
                  className="justify-center flex items-center gap-1.5 px-3 py-2 sm:py-1.5 bg-gray-800 border border-gray-700
                             text-gray-400 hover:text-gray-200 hover:border-gray-600 text-xs rounded-xl transition-colors"
                >
                  <RefreshCw size={12} /> Refresh
                </button>
                <button
                  onClick={toggleWatchlist}
                  className={`justify-center flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border transition-all ${
                    watched
                      ? 'bg-amber-900/30 border-amber-700 text-amber-400 hover:bg-red-900/20 hover:border-red-700 hover:text-red-400'
                      : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-amber-600 hover:text-amber-400'
                  }`}
                >
                  {watched
                    ? <><StarOff size={14} /> Remove from Watchlist</>
                    : <><Star size={14} /> Add to Watchlist</>}
                </button>
              </div>
            </div>

            <MarketOverview
              ticker={displayData.ticker}
              companyName={displayData.company_name}
              sector={displayData.sector}
              marketCap={displayData.market_cap}
              signals={displayData.signals}
            />

            {/* Week selector — clicking any tab auto-fetches that week if not loaded */}
            {cacheEntry && (
              <WeekSelector
                entry={cacheEntry}
                selectedWeeksOut={selectedWeeksOut}
                onSelect={(w) => {
                  setSelectedWeeksOut(w)
                  // If this week has no data yet, fetch it on demand
                  const hasData = !!cacheEntry.multiWeekData?.[w] ||
                    cacheEntry.weeksOut === w
                  if (!hasData) fetchSingleWeek(data.ticker, w)
                }}
                onFetch={() => fetchAllWeeks(data.ticker)}
                fetching={fetchingAllWeeks.has(data.ticker)}
                loadingWeeks={fetchingWeeks.get(data.ticker) ?? new Set()}
              />
            )}

            <SignalPanel signals={displayData.signals} />

            {/* Recommendations */}
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <h2 className="text-base sm:text-lg font-bold text-violet-400">🎯 Trade Recommendations · {selectedWeeksOut}w</h2>
                <span className="w-fit text-xs text-gray-500 bg-gray-800 px-3 py-1 rounded-full border border-gray-700">
                  {selectedData?.recommendations.length ?? 0} trades passed all filters
                </span>
              </div>

              {!selectedData ? (
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 text-center">
                  <div className="text-gray-300 font-semibold mb-1">No {selectedWeeksOut}w scan loaded yet</div>
                  <div className="text-gray-500 text-sm mb-3">
                    Fetch all weeks to load this expiry window, then use the week tabs to compare trades.
                  </div>
                  <button
                    onClick={() => fetchAllWeeks(data.ticker)}
                    disabled={fetchingAllWeeks.has(data.ticker)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:bg-violet-800 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors"
                  >
                    <Layers size={14} className={fetchingAllWeeks.has(data.ticker) ? 'animate-pulse' : ''} />
                    {fetchingAllWeeks.has(data.ticker) ? 'Fetching all weeks…' : 'Fetch All Weeks'}
                  </button>
                </div>
              ) : selectedData.recommendations.length === 0 ? (
                <div className="bg-amber-900/20 border border-amber-800 rounded-2xl p-5 text-center">
                  <div className="text-amber-400 font-semibold mb-1">No trades passed all filters</div>
                  <div className="text-amber-300/70 text-sm">
                    Try a more liquid ticker (SPY, AAPL, TSLA, QQQ) or adjust the spread width / strategy mode.
                  </div>
                </div>
              ) : (
                selectedData.recommendations.map(rec => (
                  <RecommendationCard
                    key={rec.rank}
                    rec={rec}
                    ticker={selectedData.ticker}
                    companyName={selectedData.company_name}
                    currentPrice={selectedData.signals.current_price}
                    signals={selectedData.signals}
                    onFetchAllWeeks={() => fetchAllWeeks(data.ticker)}
                    fetchingAllWeeks={fetchingAllWeeks.has(data.ticker)}
                  />
                ))
              )}
            </div>

            {/* Chart / Calculator / Chain tabs */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
              <div className="flex border-b border-gray-800 overflow-x-auto mobile-tab-scroll">
                {(['chart', 'calculator', 'chain'] as const).map(t => (
                  <button key={t} onClick={() => setActiveTab(t)}
                    className={`min-w-[8.5rem] sm:min-w-0 sm:flex-1 px-3 py-3 text-xs sm:text-sm font-semibold capitalize transition-colors
                      ${activeTab === t ? 'text-white border-b-2 border-violet-500 bg-gray-800/40' : 'text-gray-400 hover:text-white'}`}>
                    {t === 'chart' ? '📉 Price Chart' : t === 'calculator' ? '📈 P&L Calculator' : '📋 Options Chain'}
                  </button>
                ))}
              </div>
              <div className="p-3 sm:p-4">
                {activeTab === 'chart' ? (
                  <PriceChart history={displayData.price_history} />
                ) : activeTab === 'calculator' ? (
                  <OptionProfitCalculator
                    recommendations={selectedData?.recommendations ?? []}
                    currentPrice={displayData.signals.current_price}
                  />
                ) : (
                  <OptionsChainTable
                    calls={displayData.calls_chain}
                    puts={displayData.puts_chain}
                    currentPrice={displayData.signals.current_price}
                    expiry={displayData.filters_applied?.chain_expiry as string | undefined}
                  />
                )}
              </div>
            </div>

            {/* Filters */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="text-xs font-semibold text-gray-400 mb-2">⚙️ Engine Filters Applied</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {Object.entries(displayData.filters_applied).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3 text-xs bg-gray-800 rounded-lg px-3 py-1.5">
                    <span className="text-gray-500">{k.replace(/_/g, ' ')}</span>
                    <span className="text-gray-300 font-mono text-right break-words">{Array.isArray(v) ? v.join('–') : String(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Empty state */}
        {!loading && !error && !data && (
          <div className="text-center py-16 space-y-3">
            <div className="text-6xl">📊</div>
            <div className="text-xl font-semibold text-gray-300">Systematic Options Analysis</div>
            <div className="text-gray-500 max-w-md mx-auto text-sm leading-relaxed">
              Enter any US stock ticker above. The engine fetches live options data,
              runs multi-signal analysis, and recommends specific trades with exact strikes,
              delta-based selection, R:R filtering, and expected value scoring.
            </div>
            <div className="flex justify-center gap-2 sm:gap-4 pt-2 text-xs text-gray-600 flex-wrap">
              <span>✓ Delta-based strike selection</span>
              <span>✓ R:R &amp; credit % filters</span>
              <span>✓ Expected Value scoring</span>
            </div>
          </div>
        )}

        <div className="text-center text-xs text-gray-600 py-2 border-t border-gray-800/50">
          ⚠️ For educational purposes only. Not financial advice. Options trading involves significant risk of loss.
        </div>
      </div>
    </div>
  )
}
