import { useState, useMemo, useEffect } from 'react'
import {
  ShieldCheck, TrendingUp, RefreshCw, AlertTriangle, XCircle,
  CheckCircle2, ChevronRight, Clock, BarChart2, Layers,
} from 'lucide-react'
import { useApp } from '../contexts/AppContext'
import { buildChecklist, deriveVerdict } from '../components/PreTradeChecklist'
import type { Verdict } from '../components/PreTradeChecklist'
import type { Recommendation, AnalyzeResponse } from '../types'
import { cacheAge } from '../types'
import { TICKER_CATEGORY_MAP, CATEGORY_BADGE, MULTI_WEEK_TARGETS } from '../data/stockUniverse'

// ─── DTE bucket ──────────────────────────────────────────────────────────────
function dteBucket(dte: number): string {
  if (dte <= 16)  return '2w'
  if (dte <= 23)  return '3w'
  if (dte <= 32)  return '4w'
  if (dte <= 46)  return '6w'
  return '8w+'
}

// ─── Verdict style ───────────────────────────────────────────────────────────
type VerdictOrNone = Verdict | 'NONE'

const VERDICT_CFG: Record<VerdictOrNone, {
  border: string; bg: string; text: string; badge: string; icon: React.ReactNode; label: string
}> = {
  'GO':      { border: 'border-l-emerald-600', bg: '', text: 'text-emerald-400', badge: 'bg-emerald-900/60 border-emerald-700 text-emerald-300', icon: <CheckCircle2 size={12} />, label: 'Ready to Trade' },
  'CAUTION': { border: 'border-l-amber-500',   bg: '', text: 'text-amber-400',   badge: 'bg-amber-900/60 border-amber-700 text-amber-300',       icon: <AlertTriangle size={12} />, label: 'Proceed with Caution' },
  'NO GO':   { border: 'border-l-red-700',     bg: '', text: 'text-red-400',     badge: 'bg-red-900/60 border-red-800 text-red-300',             icon: <XCircle size={12} />, label: 'Do Not Trade' },
  'NONE':    { border: 'border-l-gray-700',    bg: '', text: 'text-gray-500',    badge: 'bg-gray-800 border-gray-700 text-gray-500',             icon: <Clock size={12} />, label: 'Not Analyzed' },
}

function VerdictPill({ v }: { v: VerdictOrNone }) {
  const c = VERDICT_CFG[v]
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${c.badge}`}>
      {c.icon} {v === 'NONE' ? 'N/A' : v}
    </span>
  )
}

function bestVerdict(vs: Verdict[]): VerdictOrNone {
  if (vs.includes('GO'))      return 'GO'
  if (vs.includes('CAUTION')) return 'CAUTION'
  if (vs.includes('NO GO'))   return 'NO GO'
  return 'NONE'
}

// ─── Per-week bucket ─────────────────────────────────────────────────────────
interface WeekBucket {
  weeksOut: number       // 2 | 3 | 4 | 6 | 8
  label: string          // '2w' | '3w' etc.
  dte: number            // actual DTE of the expiry found
  expiry: string         // option expiration / strike date
  recommendations: { rec: Recommendation; verdict: Verdict }[]
  bestVerdict: VerdictOrNone
}

function formatExpiryDate(expiry: string): string {
  const date = new Date(`${expiry}T00:00:00`)
  if (Number.isNaN(date.getTime())) return expiry
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function collectWeekBuckets(entry: import('../types').TickerCacheEntry): WeekBucket[] {
  const buckets: WeekBucket[] = []

  // Primary cache entry
  const primaryRecs = entry.data.recommendations.map(rec => ({
    rec,
    verdict: deriveVerdict(buildChecklist(rec, entry.data.signals)),
  }))
  if (primaryRecs.length > 0) {
    const dte = primaryRecs[0].rec.dte
    buckets.push({
      weeksOut: entry.weeksOut,
      label: dteBucket(dte),
      dte,
      expiry: primaryRecs[0].rec.expiry,
      recommendations: primaryRecs,
      bestVerdict: bestVerdict(primaryRecs.map(r => r.verdict)),
    })
  }

  // Multi-week entries
  if (entry.multiWeekData) {
    for (const [wStr, data] of Object.entries(entry.multiWeekData)) {
      const w = Number(wStr)
      // Skip if same DTE as primary (avoid duplicate)
      const recs = (data as AnalyzeResponse).recommendations
      if (recs.length === 0) continue
      const dte = recs[0].dte
      if (buckets.some(b => Math.abs(b.dte - dte) <= 3)) continue  // deduplicate ±3 DTE
      const withVerdicts = recs.map(rec => ({
        rec,
        verdict: deriveVerdict(buildChecklist(rec, (data as AnalyzeResponse).signals)),
      }))
      buckets.push({
        weeksOut: w,
        label: dteBucket(dte),
        dte,
        expiry: recs[0].expiry,
        recommendations: withVerdicts,
        bestVerdict: bestVerdict(withVerdicts.map(r => r.verdict)),
      })
    }
  }

  // Sort by DTE ascending (shortest first)
  return buckets.sort((a, b) => a.dte - b.dte)
}

// ─── Week coverage dots ───────────────────────────────────────────────────────
function WeekCoverageDots({ buckets, hasFetched }: { buckets: WeekBucket[]; hasFetched: boolean }) {
  const covered = new Set(buckets.map(b => b.label))
  return (
    <div className="flex items-center gap-1">
      {MULTI_WEEK_TARGETS.map(w => {
        const label = `${w}w`
        const bucket = buckets.find(b => b.label === label)
        const has = covered.has(label)
        const color = has
          ? bucket?.bestVerdict === 'GO' ? 'bg-emerald-500'
          : bucket?.bestVerdict === 'CAUTION' ? 'bg-amber-500'
          : bucket?.bestVerdict === 'NO GO' ? 'bg-red-500'
          : 'bg-gray-500'
          : 'bg-gray-700'
        return (
          <div key={w} className="flex flex-col items-center gap-0.5">
            <div className={`w-2.5 h-2.5 rounded-full ${color}`} title={has ? `${label}: ${bucket?.bestVerdict}` : `${label}: not fetched`} />
            <span className="text-[8px] text-gray-600 font-mono">{label}</span>
          </div>
        )
      })}
      {!hasFetched && (
        <span className="text-[9px] text-gray-600 ml-1">← click Fetch All Weeks</span>
      )}
    </div>
  )
}

// ─── Rec row ─────────────────────────────────────────────────────────────────
function RecRow({ rec, verdict }: { rec: Recommendation; verdict: Verdict }) {
  const isCredit = rec.net_credit > 0
  const biasClass = rec.bias.toUpperCase().includes('BULLISH')
    ? 'bg-green-900/30 text-green-400 border-green-800'
    : rec.bias.toUpperCase().includes('BEARISH')
    ? 'bg-red-900/30 text-red-400 border-red-800'
    : 'bg-amber-900/30 text-amber-400 border-amber-800'
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-gray-800/50 last:border-0 flex-wrap">
      <VerdictPill v={verdict} />
      <span className="text-xs font-semibold text-gray-200 min-w-0">{rec.strategy}</span>
      <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium shrink-0 ${biasClass}`}>
        {rec.bias.includes('Bullish') ? '↑' : rec.bias.includes('Bearish') ? '↓' : '↔'} {rec.bias}
      </span>
      <span className="text-[10px] text-gray-600 font-mono shrink-0">{rec.dte}d</span>
      <span className="ml-auto text-[10px] font-mono text-gray-500">{(rec.prob_of_profit * 100).toFixed(0)}% PoP</span>
      {isCredit && <span className="text-[10px] font-mono text-emerald-500">${(rec.net_credit * 100).toFixed(0)} cr</span>}
      <span className="text-[10px] font-mono text-gray-600">{rec.scores.total_score}/100</span>
    </div>
  )
}

// ─── Ticker card ─────────────────────────────────────────────────────────────
interface TickerResult {
  ticker: string
  companyName: string
  sector: string
  currentPrice: number
  priceChangePct: number
  ageMin: number
  buckets: WeekBucket[]
  topVerdict: VerdictOrNone
  hasFetchedAllWeeks: boolean
}

function TickerCard({ result, onAnalyze, onFetchAllWeeks, fetching }: {
  result: TickerResult
  onAnalyze: () => void
  onFetchAllWeeks: () => void
  fetching: boolean
}) {
  const [expandedWeek, setExpandedWeek] = useState<number | null>(result.buckets[0]?.dte ?? null)
  const cfg = VERDICT_CFG[result.topVerdict]
  const priceUp = result.priceChangePct >= 0
  const aiCat = TICKER_CATEGORY_MAP[result.ticker]
  const catBadge = aiCat ? CATEGORY_BADGE[aiCat] : 'bg-gray-800 text-gray-400 border-gray-700'

  const allRecs = result.buckets.flatMap(b => b.recommendations)
  const goCount  = allRecs.filter(r => r.verdict === 'GO').length
  const cauCount = allRecs.filter(r => r.verdict === 'CAUTION').length
  const noCount  = allRecs.filter(r => r.verdict === 'NO GO').length

  useEffect(() => {
    if (!result.buckets.some(b => b.dte === expandedWeek)) {
      setExpandedWeek(result.buckets[0]?.dte ?? null)
    }
  }, [expandedWeek, result.buckets])

  return (
    <div className={`bg-gray-900 border border-gray-800 border-l-4 ${cfg.border} rounded-2xl overflow-hidden`}>
      {/* Compact summary row */}
      <div className="p-3 grid grid-cols-1 xl:grid-cols-[minmax(220px,1.05fr)_minmax(320px,1.35fr)_auto] gap-3 items-start">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-bold text-white font-mono">{result.ticker}</span>
            <span className={`text-xs font-mono ${priceUp ? 'text-emerald-400' : 'text-red-400'}`}>
              ${result.currentPrice.toFixed(2)} {priceUp ? '▲' : '▼'}{Math.abs(result.priceChangePct).toFixed(2)}%
            </span>
            {aiCat && (
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${catBadge}`}>{aiCat}</span>
            )}
          </div>
          <div className="text-xs text-gray-500 mt-0.5 truncate">{result.companyName}</div>
          <div className="text-[10px] text-gray-600 mt-1 truncate">{result.sector}</div>
        </div>

        <div className="min-w-0 space-y-2">
          <WeekCoverageDots buckets={result.buckets} hasFetched={result.hasFetchedAllWeeks} />
          {result.buckets.length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            {result.buckets.map(b => {
              const active = expandedWeek === b.dte
              const vcfg = VERDICT_CFG[b.bestVerdict]
              return (
                <button
                  key={b.dte}
                  onClick={() => setExpandedWeek(active ? null : b.dte)}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold border transition-all ${
                    active
                      ? `${vcfg.badge} border-opacity-80`
                      : 'bg-gray-800 border-gray-700 text-gray-500 hover:border-gray-600 hover:text-gray-300'
                  }`}
                >
                  {formatExpiryDate(b.expiry)} · {b.dte}d
                  <span className={`ml-0.5 ${active ? '' : vcfg.text}`}>
                    {b.bestVerdict === 'GO' ? '✓' : b.bestVerdict === 'CAUTION' ? '⚠' : '✗'}
                  </span>
                </button>
              )
            })}
          </div>
          )}
        </div>

        <div className="flex flex-col items-start xl:items-end gap-2">
          <div className="flex items-center gap-1.5 flex-wrap xl:justify-end">
            {goCount  > 0 && <span className="text-[10px] font-bold bg-emerald-900/50 text-emerald-400 border border-emerald-800 px-1.5 py-0.5 rounded-full">{goCount} GO</span>}
            {cauCount > 0 && <span className="text-[10px] font-bold bg-amber-900/50 text-amber-400 border border-amber-800 px-1.5 py-0.5 rounded-full">{cauCount} CAUTION</span>}
            {noCount  > 0 && <span className="text-[10px] font-bold bg-red-900/50 text-red-400 border border-red-800 px-1.5 py-0.5 rounded-full">{noCount} NO GO</span>}
            <span className="text-[10px] text-gray-600 flex items-center gap-1"><Clock size={9} />{result.ageMin}m</span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap xl:justify-end">
            <button
              onClick={onFetchAllWeeks}
              disabled={fetching}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700
                         hover:border-violet-600 text-gray-400 hover:text-violet-300 text-xs font-semibold rounded-xl transition-colors disabled:opacity-50"
            >
              <Layers size={11} className={fetching ? 'animate-pulse' : ''} />
              {fetching ? 'Fetching…' : 'Fetch Weeks'}
            </button>
            <button
              onClick={onAnalyze}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700
                         text-gray-400 hover:text-gray-200 text-xs font-semibold rounded-xl transition-colors"
            >
              <TrendingUp size={11} /> Analyze <ChevronRight size={11} />
            </button>
          </div>
        </div>
      </div>

      {/* Active week's recommendations */}
      {result.buckets.length > 0 && (
        <div className="px-3 pb-2">
          {result.buckets.map(b => (
            b.dte === expandedWeek && (
              <div key={b.dte}>
                {b.recommendations.map((r, i) => (
                  <RecRow key={i} rec={r.rec} verdict={r.verdict} />
                ))}
                {b.recommendations.length === 0 && (
                  <div className="text-xs text-gray-600 py-2">No trades passed filters for this window.</div>
                )}
              </div>
            )
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Not-analyzed card ────────────────────────────────────────────────────────
function UnanalyzedCard({ ticker, companyName, onAnalyze }: {
  ticker: string; companyName?: string; onAnalyze: () => void
}) {
  const aiCat = TICKER_CATEGORY_MAP[ticker]
  const catBadge = aiCat ? CATEGORY_BADGE[aiCat] : undefined
  return (
    <div className="bg-gray-900 border border-gray-800 border-l-4 border-l-gray-700 rounded-2xl px-4 py-3
                    flex items-center justify-between gap-3">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-gray-400 font-mono">{ticker}</span>
          {aiCat && catBadge && (
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${catBadge}`}>{aiCat}</span>
          )}
        </div>
        {companyName && <div className="text-xs text-gray-600 mt-0.5">{companyName}</div>}
        <div className="text-[10px] text-gray-700 mt-1">Not yet analyzed — run analysis to see trade signals</div>
      </div>
      <button onClick={onAnalyze}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600/20 hover:bg-violet-600/30 border border-violet-700
                   text-violet-400 text-xs font-semibold rounded-xl transition-colors shrink-0">
        <TrendingUp size={11} /> Analyze <ChevronRight size={11} />
      </button>
    </div>
  )
}

// ─── Main page ───────────────────────────────────────────────────────────────

type Filter = 'All' | 'GO' | 'CAUTION' | 'NO GO' | 'Not Analyzed'
type WeekFilter = 'All' | number

export default function TradeSignalsPage() {
  const { watchlist, tickerCache, requestAnalysis, refreshTicker,
          refreshingTickers, fetchAllWeeks, fetchingAllWeeks } = useApp()
  const [filter, setFilter] = useState<Filter>('All')
  const [selectedWeek, setSelectedWeek] = useState<WeekFilter>('All')
  const [refreshingAll, setRefreshingAll] = useState(false)

  const results = useMemo((): TickerResult[] => {
    return watchlist
      .map(w => {
        const entry = tickerCache[w.ticker]
        if (!entry) return null
        const buckets = collectWeekBuckets(entry)
        const allVerdicts = buckets.flatMap(b => b.recommendations.map(r => r.verdict))
        return {
          ticker: w.ticker,
          companyName: entry.data.company_name,
          sector: entry.data.sector,
          currentPrice: entry.data.signals.current_price,
          priceChangePct: entry.data.signals.price_change_pct,
          ageMin: cacheAge(entry),
          buckets,
          topVerdict: bestVerdict(allVerdicts),
          hasFetchedAllWeeks: !!entry.multiWeekData,
        } satisfies TickerResult
      })
      .filter((r): r is TickerResult => r !== null)
      .sort((a, b) => {
        const order: Record<VerdictOrNone, number> = { 'GO': 0, 'CAUTION': 1, 'NO GO': 2, 'NONE': 3 }
        return order[a.topVerdict] - order[b.topVerdict]
      })
  }, [watchlist, tickerCache])

  const unanalyzed = watchlist.filter(w => !tickerCache[w.ticker])

  const weekOptions = useMemo(() => {
    const counts = new Map<number, number>()
    for (const result of results) {
      for (const bucket of result.buckets) {
        counts.set(bucket.weeksOut, (counts.get(bucket.weeksOut) ?? 0) + bucket.recommendations.length)
      }
    }
    return MULTI_WEEK_TARGETS.map(weeksOut => ({ weeksOut, count: counts.get(weeksOut) ?? 0 }))
  }, [results])

  const weekFilteredResults = useMemo(() => {
    if (selectedWeek === 'All') return results

    return results
      .map(result => {
        const buckets = result.buckets.filter(bucket => bucket.weeksOut === selectedWeek)
        if (buckets.length === 0) return null
        const allVerdicts = buckets.flatMap(b => b.recommendations.map(r => r.verdict))
        return {
          ...result,
          buckets,
          topVerdict: bestVerdict(allVerdicts),
        } satisfies TickerResult
      })
      .filter((result): result is TickerResult => result !== null)
  }, [results, selectedWeek])

  const goCount    = weekFilteredResults.filter(r => r.topVerdict === 'GO').length
  const cauCount   = weekFilteredResults.filter(r => r.topVerdict === 'CAUTION').length
  const nogoCount  = weekFilteredResults.filter(r => r.topVerdict === 'NO GO').length
  const allGoTrades = weekFilteredResults.reduce((n, r) =>
    n + r.buckets.reduce((m, b) => m + b.recommendations.filter(x => x.verdict === 'GO').length, 0), 0)
  const weeksTotal = weekFilteredResults.reduce((n, r) => n + r.buckets.length, 0)

  const filtered =
    filter === 'All'          ? weekFilteredResults :
    filter === 'Not Analyzed' ? [] :
    weekFilteredResults.filter(r => r.topVerdict === filter)

  const handleRefreshAll = async () => {
    setRefreshingAll(true)
    for (const w of watchlist) {
      if (!tickerCache[w.ticker]) continue
      if (selectedWeek === 'All') await refreshTicker(w.ticker)
      await fetchAllWeeks(w.ticker)
    }
    setRefreshingAll(false)
  }

  return (
    <div className="min-h-screen p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-4">

        {/* Header */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2.5 mb-1">
                <div className="w-9 h-9 rounded-xl bg-emerald-600/20 border border-emerald-700 flex items-center justify-center">
                  <ShieldCheck size={18} className="text-emerald-400" />
                </div>
                <h1 className="text-2xl font-bold text-white">Trade Signals</h1>
              </div>
              <p className="text-sm text-gray-500 max-w-xl">
                10-point pre-trade checklist across all watchlist tickers. Click <strong className="text-gray-300">Fetch All Weeks</strong> on any
                card to scan the 2w · 3w · 4w · 6w · 8w expiry windows — each window gets its own set of verdicts.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap justify-start lg:justify-end">
              <div className="bg-emerald-950/60 border border-emerald-800 rounded-xl px-3 py-2 text-center min-w-[56px]">
                <div className="text-xl font-bold text-emerald-400 font-mono">{goCount}</div>
                <div className="text-[10px] text-gray-500">Tickers Ready</div>
              </div>
              <div className="bg-amber-950/50 border border-amber-800 rounded-xl px-3 py-2 text-center min-w-[56px]">
                <div className="text-xl font-bold text-amber-400 font-mono">{cauCount}</div>
                <div className="text-[10px] text-gray-500">Caution</div>
              </div>
              <div className="bg-red-950/40 border border-red-900 rounded-xl px-3 py-2 text-center min-w-[56px]">
                <div className="text-xl font-bold text-red-400 font-mono">{nogoCount}</div>
                <div className="text-[10px] text-gray-500">No Go</div>
              </div>
              <div className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-center min-w-[56px]">
                <div className="text-xl font-bold text-white font-mono">{allGoTrades}</div>
                <div className="text-[10px] text-gray-500">GO Trades</div>
              </div>
              <div className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-center min-w-[56px]">
                <div className="text-xl font-bold text-violet-400 font-mono">{weeksTotal}</div>
                <div className="text-[10px] text-gray-500">DTE Windows</div>
              </div>
              <button onClick={handleRefreshAll} disabled={refreshingAll}
                className="flex items-center gap-1.5 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700
                           text-gray-400 text-xs font-semibold rounded-xl transition-colors disabled:opacity-50">
                <RefreshCw size={12} className={refreshingAll ? 'animate-spin' : ''} /> Refresh Trades
              </button>
            </div>
          </div>
          {/* How it works note */}
          <div className="mt-3 flex items-start gap-2 p-2.5 bg-gray-800/50 rounded-xl border border-gray-700">
            <Layers size={13} className="text-violet-400 mt-0.5 shrink-0" />
            <p className="text-[11px] text-gray-500 leading-relaxed">
              <span className="text-gray-300 font-semibold">How multi-week works:</span> Each ticker's initial analysis uses one expiry (the one closest to your selected weeks-out setting).
              Use the week dropdown to focus the page on one DTE window. Click <span className="text-violet-300 font-semibold">Refresh Trades</span> to fetch 2, 3, 4, 6, and 8 week scans for all analyzed tickers.
              Green = GO, Amber = CAUTION, Red = NO GO, Gray = not fetched.
            </p>
          </div>
        </div>

        {/* Controls */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-[240px]">
              <div className="text-xs font-semibold text-gray-300">Global DTE Window Filter</div>
              <div className="text-[11px] text-gray-600">
                Select a 2w to 8w window, then refresh trades to populate and show that range across all analyzed tickers.
              </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={selectedWeek}
              onChange={e => setSelectedWeek(e.target.value === 'All' ? 'All' : Number(e.target.value))}
              className="min-w-[180px] rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-sm font-semibold text-gray-200 outline-none transition-colors focus:border-violet-500"
            >
              <option value="All">All Windows ({results.length})</option>
              {weekOptions.map(option => (
                <option key={option.weeksOut} value={option.weeksOut}>
                  {option.weeksOut} weeks ({option.count} trades)
                </option>
              ))}
            </select>
            <button
              onClick={handleRefreshAll}
              disabled={refreshingAll || results.length === 0}
              className="inline-flex items-center gap-1.5 rounded-xl border border-violet-700 bg-violet-600/20 px-3 py-2 text-xs font-semibold text-violet-300 transition-colors hover:bg-violet-600/30 hover:text-violet-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw size={12} className={refreshingAll ? 'animate-spin' : ''} />
              {refreshingAll ? 'Refreshing trades…' : selectedWeek === 'All' ? 'Refresh All Trades' : `Refresh ${selectedWeek}w Trades`}
            </button>
            {selectedWeek !== 'All' && (
              <button
                onClick={() => setSelectedWeek('All')}
                className="text-xs font-semibold text-violet-400 hover:text-violet-300"
              >
                Clear window
              </button>
            )}
          </div>
        </div>

        {/* Filter pills */}
        <div className="flex gap-2 flex-wrap">
          {(['All', 'GO', 'CAUTION', 'NO GO', 'Not Analyzed'] as Filter[]).map(f => {
            const count = f === 'All'
                        ? weekFilteredResults.length + (selectedWeek === 'All' ? unanalyzed.length : 0)
                        : f === 'GO' ? goCount : f === 'CAUTION' ? cauCount
                        : f === 'NO GO' ? nogoCount
                        : selectedWeek === 'All' ? unanalyzed.length : 0
            const active = filter === f
            const styleMap: Record<Filter, string> = {
              'All': 'bg-violet-600 border-violet-500 text-white',
              'GO': 'bg-emerald-700 border-emerald-600 text-white',
              'CAUTION': 'bg-amber-700 border-amber-600 text-white',
              'NO GO': 'bg-red-700 border-red-600 text-white',
              'Not Analyzed': 'bg-gray-600 border-gray-500 text-white',
            }
            return (
              <button key={f} onClick={() => setFilter(f)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
                  active ? styleMap[f] : 'bg-gray-900 border-gray-800 text-gray-400 hover:border-gray-600 hover:text-gray-200'
                }`}>
                {f === 'GO' && <CheckCircle2 size={12} />}
                {f === 'CAUTION' && <AlertTriangle size={12} />}
                {f === 'NO GO' && <XCircle size={12} />}
                {f === 'Not Analyzed' && <Clock size={12} />}
                {f === 'All' && <BarChart2 size={12} />}
                {f}
                <span className={`font-mono ${active ? 'opacity-80' : 'text-gray-600'}`}>{count}</span>
              </button>
            )
          })}
        </div>

        {/* Empty states */}
        {watchlist.length === 0 && (
          <div className="text-center py-20 text-gray-500">
            <ShieldCheck size={40} className="mx-auto mb-3 opacity-20" />
            <div className="font-semibold text-gray-400">No tickers on your watchlist yet</div>
            <div className="text-xs mt-1">Add tickers via Watchlist or click Watch on any AI Radar card.</div>
          </div>
        )}

        {/* Analyzed ticker cards */}
        {(filter !== 'Not Analyzed') && (
          <div className="space-y-2.5">
            {filtered.length === 0 && results.length > 0 && (
              <div className="text-center py-8 text-gray-600 text-sm">
                No tickers match "{filter}" for {selectedWeek === 'All' ? 'all windows' : `${selectedWeek}w`}.
              </div>
            )}
            {filtered.map(result => (
              <TickerCard
                key={result.ticker}
                result={result}
                onAnalyze={() => requestAnalysis(result.ticker)}
                onFetchAllWeeks={() => fetchAllWeeks(result.ticker)}
                fetching={fetchingAllWeeks.has(result.ticker) || refreshingTickers.has(result.ticker)}
              />
            ))}
          </div>
        )}

        {/* Not analyzed */}
        {selectedWeek === 'All' && (filter === 'All' || filter === 'Not Analyzed') && unanalyzed.length > 0 && (
          <div className="space-y-2">
            {filter === 'All' && (
              <div className="text-xs text-gray-600 font-semibold uppercase tracking-wider px-1 pt-2">
                Not Yet Analyzed ({unanalyzed.length})
              </div>
            )}
            {unanalyzed.map(w => (
              <UnanalyzedCard key={w.ticker} ticker={w.ticker} companyName={w.companyName}
                onAnalyze={() => requestAnalysis(w.ticker)} />
            ))}
          </div>
        )}

        {weekFilteredResults.length > 0 && (
          <div className="text-xs text-gray-700 text-center py-1 border-t border-gray-800/50">
            {weeksTotal} DTE windows analyzed · {allGoTrades} ready trades found ·
            Cache refreshes every 15 min · Multi-week data persists until page refresh
          </div>
        )}
      </div>
    </div>
  )
}
