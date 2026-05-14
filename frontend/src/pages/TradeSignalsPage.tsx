import { useState, useMemo, useEffect, useCallback } from 'react'
import {
  ShieldCheck, RefreshCw, AlertTriangle, XCircle,
  CheckCircle2, Clock, BarChart2, Layers,
  CalendarDays, Loader2, FilterX, Info, ExternalLink,
  TrendingUp, DollarSign, AlertCircle,
} from 'lucide-react'
import { useApp } from '../contexts/AppContext'
import { buildChecklist, deriveVerdict } from '../components/PreTradeChecklist'
import type { Verdict } from '../components/PreTradeChecklist'
import type { Recommendation, AnalyzeResponse } from '../types'
import { cacheAge } from '../types'
import { TICKER_CATEGORY_MAP, CATEGORY_BADGE, MULTI_WEEK_TARGETS } from '../data/stockUniverse'
import { fetchMyTickers } from '../api/commandCenter'
import type { MyTickerEntry } from '../api/commandCenter'

// ─── Verdict config ──────────────────────────────────────────────────────────
type VerdictOrNone = Verdict | 'NONE'

const VERDICT_CFG: Record<VerdictOrNone, {
  text: string; badge: string; icon: React.ReactNode; label: string
}> = {
  'GO':      { text: 'text-emerald-400', badge: 'bg-emerald-900/60 border-emerald-700 text-emerald-300', icon: <CheckCircle2 size={12} />, label: 'Ready to Trade' },
  'CAUTION': { text: 'text-amber-400',   badge: 'bg-amber-900/60 border-amber-700 text-amber-300',       icon: <AlertTriangle size={12} />, label: 'Proceed with Caution' },
  'NO GO':   { text: 'text-red-400',     badge: 'bg-red-900/60 border-red-800 text-red-300',             icon: <XCircle size={12} />, label: 'Do Not Trade' },
  'NONE':    { text: 'text-gray-500',    badge: 'bg-gray-800 border-gray-700 text-gray-500',             icon: <Clock size={12} />, label: 'Not Analyzed' },
}

function VerdictPill({ v, onOpenFinder }: { v: VerdictOrNone; onOpenFinder?: () => void }) {
  const c = VERDICT_CFG[v]
  const inner = <>{c.icon} {v === 'NONE' ? 'N/A' : v}</>
  const cls = `inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${c.badge}`
  if (onOpenFinder && (v === 'GO' || v === 'CAUTION')) {
    return (
      <button type="button" onClick={e => { e.stopPropagation(); onOpenFinder() }}
        className={`${cls} cursor-pointer hover:brightness-110 transition-[filter] focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/80`}
        title="Open in Strategy Finder">
        {inner}
      </button>
    )
  }
  return <span className={cls}>{inner}</span>
}

function bestVerdict(vs: Verdict[]): VerdictOrNone {
  if (vs.includes('GO'))      return 'GO'
  if (vs.includes('CAUTION')) return 'CAUTION'
  if (vs.includes('NO GO'))   return 'NO GO'
  return 'NONE'
}

// ─── Week bucket ─────────────────────────────────────────────────────────────
interface WeekBucket {
  weeksOut: number
  label: string
  dte: number
  expiry: string
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

  const primaryRecs = entry.data.recommendations.map(rec => ({
    rec,
    verdict: deriveVerdict(buildChecklist(rec, entry.data.signals)),
  }))
  if (primaryRecs.length > 0) {
    buckets.push({
      weeksOut: entry.weeksOut,
      label: `${entry.weeksOut}w`,
      dte: primaryRecs[0].rec.dte,
      expiry: primaryRecs[0].rec.expiry,
      recommendations: primaryRecs,
      bestVerdict: bestVerdict(primaryRecs.map(r => r.verdict)),
    })
  }

  if (entry.multiWeekData) {
    for (const [wStr, data] of Object.entries(entry.multiWeekData)) {
      const w = Number(wStr)
      const recs = (data as AnalyzeResponse).recommendations
      if (recs.length === 0) continue
      if (buckets.some(b => b.weeksOut === w)) continue
      const withVerdicts = recs.map(rec => ({
        rec,
        verdict: deriveVerdict(buildChecklist(rec, (data as AnalyzeResponse).signals)),
      }))
      buckets.push({
        weeksOut: w,
        label: `${w}w`,
        dte: recs[0].dte,
        expiry: recs[0].expiry,
        recommendations: withVerdicts,
        bestVerdict: bestVerdict(withVerdicts.map(r => r.verdict)),
      })
    }
  }

  return buckets.sort((a, b) => a.dte - b.dte)
}

function bestRecForFinder(bucket: WeekBucket): Recommendation | null {
  if (bucket.recommendations.length === 0) return null
  const prefer = bucket.recommendations.filter(r => r.verdict === 'GO' || r.verdict === 'CAUTION')
  const pool = prefer.length > 0 ? prefer : bucket.recommendations
  return [...pool].sort((a, b) => b.rec.scores.total_score - a.rec.scores.total_score)[0]!.rec
}

// ─── Tier label ───────────────────────────────────────────────────────────────
const TIER_COLORS: Record<number, string> = {
  3: 'text-sky-400 bg-sky-900/30 border-sky-800',
  4: 'text-violet-400 bg-violet-900/30 border-violet-800',
  5: 'text-teal-400 bg-teal-900/30 border-teal-800',
  6: 'text-amber-400 bg-amber-900/30 border-amber-800',
}

function TierBadge({ weeksOut }: { weeksOut: number }) {
  const cls = TIER_COLORS[weeksOut] ?? 'text-gray-400 bg-gray-800 border-gray-700'
  return (
    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${cls}`}>
      {weeksOut}W
    </span>
  )
}

// ─── Kelly badge ─────────────────────────────────────────────────────────────
function KellyBadge({ halfKelly }: { halfKelly: number }) {
  const pct = halfKelly * 100
  if (pct <= 0) return null
  const color = pct > 15 ? 'text-red-400 bg-red-900/20 border-red-800'
    : pct > 8 ? 'text-amber-400 bg-amber-900/20 border-amber-800'
    : 'text-emerald-400 bg-emerald-900/20 border-emerald-800'
  return (
    <span className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded border shrink-0 ${color}`}
      title={`Half-Kelly: deploy ${pct.toFixed(1)}% of capital on this trade`}>
      K {pct.toFixed(1)}%
    </span>
  )
}

// ─── Earnings warning ────────────────────────────────────────────────────────
function EarningsWarning({ daysUntil, dte }: { daysUntil: number; dte: number }) {
  if (daysUntil <= 0 || daysUntil > dte) return null
  const urgent = daysUntil <= 14
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${
      urgent
        ? 'text-red-400 bg-red-900/20 border-red-800'
        : 'text-amber-400 bg-amber-900/20 border-amber-800'
    }`} title={`Earnings in ~${daysUntil} days — within this trade's DTE window`}>
      <AlertCircle size={10} />
      EPS {daysUntil}d
    </span>
  )
}

// ─── Rec row ─────────────────────────────────────────────────────────────────
function RecRow({
  rec, verdict, ticker, weeksOut, openInFinder, earningsWithinDays,
}: {
  rec: Recommendation
  verdict: Verdict
  ticker: string
  weeksOut: number
  openInFinder: (ticker: string, weeksOut: number, rec: Recommendation) => void
  earningsWithinDays?: number | null
}) {
  const isCredit = rec.net_credit > 0
  const biasClass = rec.bias.toUpperCase().includes('BULLISH')
    ? 'bg-green-900/30 text-green-400 border-green-800'
    : rec.bias.toUpperCase().includes('BEARISH')
    ? 'bg-red-900/30 text-red-400 border-red-800'
    : 'bg-amber-900/30 text-amber-400 border-amber-800'
  const canFinder = verdict === 'GO' || verdict === 'CAUTION'
  const maxLoss = rec.max_loss > 0 ? rec.max_loss : null
  const maxProfit = rec.max_profit > 0 ? rec.max_profit : null
  const rr = rec.risk_reward_ratio > 0 ? rec.risk_reward_ratio : null

  return (
    <div className="py-2 border-b border-gray-800/50 last:border-0">
      {/* Row 1: verdict, strategy, bias, tier, DTE */}
      <div className="flex items-center gap-2 flex-wrap">
        <VerdictPill v={verdict} onOpenFinder={canFinder ? () => openInFinder(ticker, weeksOut, rec) : undefined} />
        <span className="text-xs font-semibold text-gray-200 min-w-0">{rec.strategy}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium shrink-0 ${biasClass}`}>
          {rec.bias.includes('Bullish') ? '↑' : rec.bias.includes('Bearish') ? '↓' : '↔'} {rec.bias}
        </span>
        {rec.time_horizon_tier && (
          <span className="text-[9px] font-mono text-gray-500 shrink-0">{rec.time_horizon_tier}</span>
        )}
        <span className="text-[10px] text-gray-600 font-mono shrink-0">{rec.dte}d</span>
        {earningsWithinDays != null && (
          <EarningsWarning daysUntil={earningsWithinDays} dte={rec.dte} />
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-[10px] font-mono text-gray-500">{(rec.prob_of_profit * 100).toFixed(0)}% PoP</span>
          <span className="text-[10px] font-mono text-gray-600" title="Signal-aligned score (0–100) from the engine; verdict layered on via Pre-Trade Checklist">{rec.scores.total_score}<span className="text-gray-700">/100</span></span>
          <KellyBadge halfKelly={rec.half_kelly_fraction ?? 0} />
          {canFinder && (
            <button type="button" onClick={() => openInFinder(ticker, weeksOut, rec)}
              className="inline-flex items-center gap-0.5 shrink-0 text-[10px] font-semibold text-violet-400 hover:text-violet-300
                         border border-violet-700/60 rounded-lg px-1.5 py-0.5 bg-violet-600/10 hover:bg-violet-600/20 transition-colors"
              title="Open in Strategy Finder">
              <ExternalLink size={11} aria-hidden /> Finder
            </button>
          )}
        </div>
      </div>
      {/* Row 2: max profit / max loss / R:R */}
      {(maxProfit != null || maxLoss != null) && (
        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
          {maxProfit != null && (
            <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-mono">
              <TrendingUp size={10} /> Max profit ${(maxProfit * 100).toFixed(0)}/contract
            </span>
          )}
          {maxLoss != null && (
            <span className="flex items-center gap-1 text-[10px] text-red-400 font-mono">
              <DollarSign size={10} /> Max loss ${(maxLoss * 100).toFixed(0)}/contract
            </span>
          )}
          {rr != null && (
            <span className="text-[10px] text-gray-500 font-mono">R:R {rr.toFixed(1)}×</span>
          )}
          {isCredit && (
            <span className="text-[10px] font-mono text-emerald-500">${(rec.net_credit * 100).toFixed(0)} credit</span>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Week tier grid ───────────────────────────────────────────────────────────
function WeekTierGrid({ buckets, hasFetched }: { buckets: WeekBucket[]; hasFetched: boolean }) {
  const coveredWeeks = new Set(buckets.map(b => b.weeksOut))
  return (
    <div className="flex items-center gap-1.5">
      {MULTI_WEEK_TARGETS.map(w => {
        const bucket = buckets.find(b => b.weeksOut === w)
        const has = coveredWeeks.has(w)
        const vcfg = has && bucket ? VERDICT_CFG[bucket.bestVerdict] : null
        const dotColor = has
          ? bucket?.bestVerdict === 'GO' ? 'bg-emerald-500'
          : bucket?.bestVerdict === 'CAUTION' ? 'bg-amber-500'
          : bucket?.bestVerdict === 'NO GO' ? 'bg-red-500'
          : 'bg-gray-500'
          : 'bg-gray-700'
        return (
          <div key={w} className="flex flex-col items-center gap-0.5"
            title={has ? `${w}w: ${bucket?.bestVerdict ?? 'analyzed'}` : `${w}w: not fetched`}>
            <div className={`w-2.5 h-2.5 rounded-full ${dotColor}`} />
            <span className={`text-[8px] font-mono font-bold ${vcfg ? vcfg.text : 'text-gray-600'}`}>{w}w</span>
          </div>
        )
      })}
      {!hasFetched && (
        <span className="text-[9px] text-gray-600 ml-0.5">← fetch all</span>
      )}
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
  bestGoKelly: number
  earningsWithinDays: number | null
}

function TickerCard({ result, onAnalyze, onFetchAllWeeks, fetching, accountSize, openInFinder }: {
  result: TickerResult
  onAnalyze: () => void
  onFetchAllWeeks: () => void
  fetching: boolean
  accountSize: number
  openInFinder: (ticker: string, weeksOut: number, rec: Recommendation) => void
}) {
  const [expandedWeek, setExpandedWeek] = useState<number | null>(result.buckets[0]?.dte ?? null)
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

  // Top-score GO rec for Kelly display
  const topGoRec = result.buckets
    .flatMap(b => b.recommendations)
    .filter(r => r.verdict === 'GO')
    .sort((a, b) => b.rec.scores.total_score - a.rec.scores.total_score)[0]

  // Earnings warning: show if any bucket has earnings within DTE
  const earningsAlert = result.earningsWithinDays != null && result.earningsWithinDays > 0
  const earningsInAnyBucket = result.buckets.some(b =>
    result.earningsWithinDays != null && result.earningsWithinDays <= b.dte
  )

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
      {/* Earnings warning banner */}
      {earningsAlert && earningsInAnyBucket && (
        <div className={`flex items-center gap-2 px-4 py-1.5 text-[11px] font-semibold ${
          (result.earningsWithinDays ?? 99) <= 14
            ? 'bg-red-950/60 border-b border-red-900 text-red-400'
            : 'bg-amber-950/50 border-b border-amber-900 text-amber-400'
        }`}>
          <AlertCircle size={13} className="shrink-0" />
          Earnings in ~{result.earningsWithinDays} days — falls within one or more trade windows. IV crush risk after report.
        </div>
      )}

      {/* Main card row */}
      <div className="p-3 grid grid-cols-1 xl:grid-cols-[minmax(200px,1fr)_minmax(300px,1.4fr)_auto] gap-3 items-start">

        {/* Left: ticker + price */}
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
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            {goCount  > 0 && <span className="text-[10px] font-bold bg-emerald-900/50 text-emerald-400 border border-emerald-800 px-1.5 py-0.5 rounded-full">{goCount} GO</span>}
            {cauCount > 0 && <span className="text-[10px] font-bold bg-amber-900/50 text-amber-400 border border-amber-800 px-1.5 py-0.5 rounded-full">{cauCount} CAUTION</span>}
            {noCount  > 0 && <span className="text-[10px] font-bold bg-red-900/50 text-red-400 border border-red-800 px-1.5 py-0.5 rounded-full">{noCount} NO GO</span>}
            <span className="text-[10px] text-gray-600 flex items-center gap-1"><Clock size={9} />{result.ageMin}m ago</span>
          </div>
        </div>

        {/* Center: week tier selector */}
        <div className="min-w-0 space-y-2">
          <WeekTierGrid buckets={result.buckets} hasFetched={result.hasFetchedAllWeeks} />
          {result.buckets.length > 0 && (
            <div className="flex gap-1.5 flex-wrap">
              {result.buckets.map(b => {
                const active = expandedWeek === b.dte
                const vcfg = VERDICT_CFG[b.bestVerdict]
                return (
                  <button key={b.dte} type="button"
                    onClick={() => setExpandedWeek(active ? null : b.dte)}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold border transition-all ${
                      active ? `${vcfg.badge} border-opacity-80` : 'bg-gray-800 border-gray-700 text-gray-500 hover:border-gray-600 hover:text-gray-300'
                    }`}
                  >
                    <TierBadge weeksOut={b.weeksOut} />
                    <span>{formatExpiryDate(b.expiry)}</span>
                    <span className="font-mono text-gray-500">{b.dte}d</span>
                    {b.bestVerdict === 'GO' ? <CheckCircle2 size={10} className={active ? 'text-emerald-300' : 'text-emerald-600'} />
                      : b.bestVerdict === 'CAUTION' ? <AlertTriangle size={10} className={active ? 'text-amber-300' : 'text-amber-600'} />
                      : b.bestVerdict === 'NO GO' ? <XCircle size={10} className={active ? 'text-red-300' : 'text-red-600'} />
                      : <Clock size={10} className="text-gray-600" />
                    }
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Right: Kelly + actions */}
        <div className="flex flex-col items-start xl:items-end gap-2">
          {result.bestGoKelly > 0 && (() => {
            const pct = result.bestGoKelly * 100
            const dollars = Math.round(accountSize * result.bestGoKelly)
            const color = pct > 15 ? 'text-red-400 bg-red-900/20 border-red-800'
              : pct > 8 ? 'text-amber-400 bg-amber-900/20 border-amber-800'
              : 'text-emerald-400 bg-emerald-900/20 border-emerald-800'
            return (
              <span className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded border ${color}`}
                title={`Deploy ~$${dollars.toLocaleString()} (${pct.toFixed(1)}% of $${accountSize.toLocaleString()}) on top GO trade`}>
                K {pct.toFixed(1)}%
              </span>
            )
          })()}
          {topGoRec && (
            <div className="text-right hidden xl:block">
              <div className="text-[9px] text-gray-600">top GO</div>
              <div className="text-[10px] font-semibold text-emerald-400 truncate max-w-[120px]">
                {topGoRec.rec.strategy}
              </div>
              <div className="text-[9px] text-gray-600 font-mono">
                {topGoRec.rec.scores.total_score}/100 · {(topGoRec.rec.prob_of_profit * 100).toFixed(0)}% PoP
              </div>
            </div>
          )}
          <div className="flex items-center gap-1">
            <button type="button" onClick={onFetchAllWeeks} disabled={fetching}
              title={fetching ? 'Fetching…' : 'Fetch 3w–6w windows'}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-700 bg-gray-800
                         text-gray-400 transition-colors hover:border-violet-600 hover:bg-gray-700 hover:text-violet-300 disabled:opacity-50">
              {fetching ? <Loader2 size={16} className="animate-spin text-violet-400" /> : <Layers size={16} />}
            </button>
            <button type="button" onClick={onAnalyze} title="Re-analyze"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-700 bg-gray-800
                         text-gray-400 transition-colors hover:bg-gray-700 hover:text-gray-200">
              <BarChart2 size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Expanded week recommendations */}
      {result.buckets.length > 0 && (
        <div className="px-3 pb-2">
          {result.buckets.map(b =>
            b.dte === expandedWeek ? (
              <div key={b.dte}>
                {b.recommendations.length === 0 && (
                  <div className="text-xs text-gray-600 py-2">No trades passed filters for this window.</div>
                )}
                {b.recommendations.map((r, i) => (
                  <RecRow
                    key={i}
                    rec={r.rec}
                    verdict={r.verdict}
                    ticker={result.ticker}
                    weeksOut={b.weeksOut}
                    openInFinder={openInFinder}
                    earningsWithinDays={result.earningsWithinDays}
                  />
                ))}
              </div>
            ) : null
          )}
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
    <div className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-gray-400 font-mono">{ticker}</span>
          {aiCat && catBadge && (
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${catBadge}`}>{aiCat}</span>
          )}
        </div>
        {companyName && <div className="text-xs text-gray-600 mt-0.5">{companyName}</div>}
        <div className="text-[10px] text-gray-700 mt-1">Not yet analyzed — click analyze to see 3-6 week trade signals</div>
      </div>
      <button type="button" onClick={onAnalyze} title="Analyze"
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-violet-700 bg-violet-600/20
                   text-violet-400 transition-colors hover:bg-violet-600/30 hover:text-violet-300">
        <BarChart2 size={16} />
      </button>
    </div>
  )
}

// ─── Main page ───────────────────────────────────────────────────────────────
type Filter = 'All' | 'GO' | 'CAUTION' | 'NO GO' | 'Not Analyzed'
type WeekFilter = 'All' | number

export default function TradeSignalsPage() {
  const { tickerCache, requestAnalysis, refreshTicker,
          refreshingTickers, fetchAllWeeks, fetchingAllWeeks, accountSize } = useApp()
  const [myTickers, setMyTickers] = useState<MyTickerEntry[]>([])
  const [filter, setFilter] = useState<Filter>('All')
  const [selectedWeek, setSelectedWeek] = useState<WeekFilter>('All')
  const [refreshingAll, setRefreshingAll] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)

  useEffect(() => {
    fetchMyTickers().then(res => setMyTickers(res.data?.tickers || [])).catch(() => {})
  }, [])

  const openSignalInFinder = useCallback((ticker: string, weeksOut: number, rec: Recommendation) => {
    requestAnalysis(ticker.trim().toUpperCase(), {
      weeksOut,
      spreadWidth: 5,
      strategyMode: 'all',
      chainExpiry: rec.expiry.trim().slice(0, 10),
      force: false,
      focusStrategy: rec.strategy,
      focusExpiry: rec.expiry,
    })
  }, [requestAnalysis])

  const results = useMemo((): TickerResult[] => {
    return myTickers
      .map(mt => {
        const sym = mt.symbol
        const entry = tickerCache[sym]
        if (!entry) return null
        const buckets = collectWeekBuckets(entry)
        const allVerdicts = buckets.flatMap(b => b.recommendations.map(r => r.verdict))
        const goRecs = buckets
          .flatMap(b => b.recommendations)
          .filter(r => r.verdict === 'GO')
          .sort((a, b) => b.rec.scores.total_score - a.rec.scores.total_score)
        const bestGoKelly = goRecs[0]?.rec.half_kelly_fraction ?? 0

        // Earnings: pull from swing metrics if present (earnings_calendar_days_until)
        const swingMeta = (entry.data as any)?.swing_metrics
        const earningsWithinDays: number | null =
          typeof swingMeta?.earnings_calendar_days_until === 'number'
            ? swingMeta.earnings_calendar_days_until
            : null

        return {
          ticker: sym,
          companyName: entry.data.company_name,
          sector: entry.data.sector,
          currentPrice: entry.data.signals.current_price,
          priceChangePct: entry.data.signals.price_change_pct,
          ageMin: cacheAge(entry),
          buckets,
          topVerdict: bestVerdict(allVerdicts),
          hasFetchedAllWeeks: !!entry.multiWeekData,
          bestGoKelly,
          earningsWithinDays,
        } satisfies TickerResult
      })
      .filter((r): r is TickerResult => r !== null)
      .sort((a, b) => {
        const order: Record<VerdictOrNone, number> = { 'GO': 0, 'CAUTION': 1, 'NO GO': 2, 'NONE': 3 }
        return order[a.topVerdict] - order[b.topVerdict]
      })
  }, [myTickers, tickerCache])

  const unanalyzed = myTickers.filter(mt => !tickerCache[mt.symbol])

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
        const buckets = result.buckets.filter(b => b.weeksOut === selectedWeek)
        if (buckets.length === 0) return null
        return {
          ...result,
          buckets,
          topVerdict: bestVerdict(buckets.flatMap(b => b.recommendations.map(r => r.verdict))),
        } satisfies TickerResult
      })
      .filter((r): r is TickerResult => r !== null)
  }, [results, selectedWeek])

  const goCount   = weekFilteredResults.filter(r => r.topVerdict === 'GO').length
  const cauCount  = weekFilteredResults.filter(r => r.topVerdict === 'CAUTION').length
  const nogoCount = weekFilteredResults.filter(r => r.topVerdict === 'NO GO').length
  const allGoTrades = weekFilteredResults.reduce((n, r) =>
    n + r.buckets.reduce((m, b) => m + b.recommendations.filter(x => x.verdict === 'GO').length, 0), 0)
  const weeksTotal = weekFilteredResults.reduce((n, r) => n + r.buckets.length, 0)

  const totalKellyPct = weekFilteredResults.filter(r => r.bestGoKelly > 0)
    .reduce((s, r) => s + r.bestGoKelly * 100, 0)
  const totalCapitalDollars = Math.round(accountSize * (totalKellyPct / 100))
  const kellyColor = totalKellyPct > 80 ? 'text-red-400' : totalKellyPct > 50 ? 'text-amber-400' : 'text-emerald-400'

  const earningsWarningCount = weekFilteredResults.filter(
    r => r.earningsWithinDays != null && r.earningsWithinDays > 0 &&
         r.buckets.some(b => (r.earningsWithinDays ?? 99) <= b.dte)
  ).length

  const filtered =
    filter === 'All'          ? weekFilteredResults :
    filter === 'Not Analyzed' ? [] :
    weekFilteredResults.filter(r => r.topVerdict === filter)

  const handleRefreshAll = async () => {
    setRefreshingAll(true)
    for (const mt of myTickers) {
      if (!tickerCache[mt.symbol]) continue
      if (selectedWeek === 'All') await refreshTicker(mt.symbol)
      await fetchAllWeeks(mt.symbol)
    }
    setRefreshingAll(false)
  }

  return (
    <div className="min-h-screen p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-4">

        {/* Header */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5 mb-1">
                <div className="w-9 h-9 rounded-xl bg-emerald-600/20 border border-emerald-700 flex items-center justify-center">
                  <ShieldCheck size={18} className="text-emerald-400" />
                </div>
                <div>
                  <h1 className="tcc-hero-title text-2xl font-bold tracking-tight text-heading">Strategy Trades</h1>
                  <p className="text-[11px] text-gray-500 mt-0.5">Options signals · 3-week to 6-week holds · 21–42 DTE window</p>
                </div>
                <button type="button" onClick={() => setInfoOpen(o => !o)}
                  className="rounded-lg p-1 text-gray-500 hover:bg-gray-800 hover:text-gray-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/80"
                  title="How this page works">
                  <Info size={18} />
                </button>
              </div>
              {infoOpen && (
                <p className="text-sm text-gray-500 max-w-xl mt-2 leading-relaxed">
                  Strategy Trades surfaces options setups (credit spreads, debit spreads, covered calls, iron condors)
                  targeting 3-week to 6-week holds (21–42 DTE). Each ticker card shows up to four expiry windows
                  (3w / 4w / 5w / 6w). Verdict (GO / CAUTION / NO GO) comes from the Pre-Trade Checklist layered
                  on the engine's signal-aligned score (0–100). Max profit, max loss, and R:R are shown per trade.
                  Kelly % is Half-Kelly position sizing — the fraction of your account to deploy on one trade.
                  Earnings banners flag when a report falls within the trade window (IV crush risk).
                </p>
              )}
            </div>

            {/* Stat tiles */}
            <div className="flex items-center gap-2 flex-wrap justify-start lg:justify-end">
              <div className="bg-emerald-950/60 border border-emerald-800 rounded-xl px-3 py-2 text-center min-w-[52px]">
                <div className="text-xl font-bold text-emerald-400 font-mono">{goCount}</div>
                <div className="text-[10px] text-gray-500">Ready</div>
              </div>
              <div className="bg-amber-950/50 border border-amber-800 rounded-xl px-3 py-2 text-center min-w-[52px]">
                <div className="text-xl font-bold text-amber-400 font-mono">{cauCount}</div>
                <div className="text-[10px] text-gray-500">Caution</div>
              </div>
              <div className="bg-red-950/40 border border-red-900 rounded-xl px-3 py-2 text-center min-w-[52px]">
                <div className="text-xl font-bold text-red-400 font-mono">{nogoCount}</div>
                <div className="text-[10px] text-gray-500">No Go</div>
              </div>
              <div className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-center min-w-[52px]">
                <div className="text-xl font-bold text-white font-mono">{allGoTrades}</div>
                <div className="text-[10px] text-gray-500">GO Trades</div>
              </div>
              <div className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-center min-w-[52px]">
                <div className="text-xl font-bold text-violet-400 font-mono">{weeksTotal}</div>
                <div className="text-[10px] text-gray-500">Windows</div>
              </div>
              {totalKellyPct > 0 && (
                <div className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-center min-w-[68px]"
                  title={`Deploy ~$${totalCapitalDollars.toLocaleString()} across ${goCount} GO tickers (Half-Kelly sum)`}>
                  <div className={`text-xl font-bold font-mono ${kellyColor}`}>{totalKellyPct.toFixed(0)}%</div>
                  <div className="text-[10px] text-gray-500">Capital (K)</div>
                </div>
              )}
              {earningsWarningCount > 0 && (
                <div className="bg-amber-950/40 border border-amber-900 rounded-xl px-3 py-2 text-center min-w-[52px]"
                  title={`${earningsWarningCount} ticker(s) have earnings within the trade window`}>
                  <div className="text-xl font-bold text-amber-400 font-mono">{earningsWarningCount}</div>
                  <div className="text-[10px] text-gray-500">EPS Risk</div>
                </div>
              )}
              <button type="button" onClick={handleRefreshAll} disabled={refreshingAll}
                title="Refresh trades (3w–6w scans)"
                className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 px-2.5 bg-gray-800 hover:bg-gray-700
                           border border-gray-700 text-gray-400 rounded-xl transition-colors disabled:opacity-50">
                <RefreshCw size={15} className={refreshingAll ? 'animate-spin' : ''} />
                <span className="text-[11px] font-semibold hidden sm:inline">Refresh</span>
              </button>
            </div>
          </div>
        </div>

        {/* Controls row */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex items-center min-w-[200px]">
              <CalendarDays size={15} className="pointer-events-none absolute left-3 text-gray-500" />
              <select value={selectedWeek}
                onChange={e => setSelectedWeek(e.target.value === 'All' ? 'All' : Number(e.target.value))}
                className="w-full rounded-xl border border-gray-700 bg-gray-800 pl-9 pr-3 py-2 text-sm font-semibold text-gray-200
                           outline-none transition-colors focus:border-violet-500 appearance-none cursor-pointer">
                <option value="All">All windows ({results.length})</option>
                {weekOptions.map(opt => (
                  <option key={opt.weeksOut} value={opt.weeksOut}>
                    {opt.weeksOut}-week · {opt.weeksOut * 7}d  ({opt.count} trades)
                  </option>
                ))}
              </select>
            </div>
            <button type="button" onClick={handleRefreshAll} disabled={refreshingAll || results.length === 0}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-violet-700
                         bg-violet-600/20 px-3 text-violet-300 transition-colors hover:bg-violet-600/30 hover:text-violet-200 disabled:opacity-50">
              <RefreshCw size={16} className={refreshingAll ? 'animate-spin' : ''} />
              <span className="text-xs font-semibold">Fetch All Weeks</span>
            </button>
            {selectedWeek !== 'All' && (
              <button type="button" onClick={() => setSelectedWeek('All')}
                className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-gray-700
                           bg-gray-800 px-3 text-violet-400 hover:bg-gray-700 transition-colors">
                <FilterX size={16} />
                <span className="text-xs font-semibold hidden sm:inline">Clear</span>
              </button>
            )}
          </div>
          {/* Week tier legend */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-gray-600 font-semibold uppercase tracking-wider">Tiers:</span>
            {MULTI_WEEK_TARGETS.map(w => <TierBadge key={w} weeksOut={w} />)}
          </div>
        </div>

        {/* Filter pills */}
        <div className="flex gap-2 flex-wrap">
          {(['All', 'GO', 'CAUTION', 'NO GO', 'Not Analyzed'] as Filter[]).map(f => {
            const count = f === 'All' ? weekFilteredResults.length + (selectedWeek === 'All' ? unanalyzed.length : 0)
              : f === 'GO' ? goCount : f === 'CAUTION' ? cauCount : f === 'NO GO' ? nogoCount
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

        {/* Empty state */}
        {myTickers.length === 0 && (
          <div className="text-center py-20 text-gray-500">
            <ShieldCheck size={40} className="mx-auto mb-3 opacity-20" />
            <div className="font-semibold text-gray-400">No tickers in My Tickers yet</div>
            <div className="text-xs mt-1">Add tickers via My Tickers to start seeing 3-6 week strategy signals.</div>
          </div>
        )}

        {/* Ticker cards */}
        {filter !== 'Not Analyzed' && (
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
                accountSize={accountSize}
                openInFinder={openSignalInFinder}
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
            {unanalyzed.map(mt => (
              <UnanalyzedCard key={mt.symbol} ticker={mt.symbol} companyName={mt.company_name}
                onAnalyze={() => requestAnalysis(mt.symbol)} />
            ))}
          </div>
        )}

        {weekFilteredResults.length > 0 && (
          <div className="text-xs text-gray-700 text-center py-1 border-t border-gray-800/50">
            {weeksTotal} DTE windows · {allGoTrades} GO trades · 3w–6w (21–42 DTE) window · cache refreshes every 15 min
          </div>
        )}
      </div>
    </div>
  )
}
