import { Fragment, useEffect, useState, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  RefreshCw, TrendingUp, TrendingDown, ScanLine, ArrowUpRight, CheckCircle, XCircle, MinusCircle,
} from 'lucide-react'
import { fetchSignalFeed } from '../api/commandCenter'
import type { SignalFeedRow, SignalFeedMetrics } from '../types/commandCenter'
import { useApp } from '../contexts/AppContext'
import {
  getAgreementBadgeClass,
  getDecisionBadgeClass,
} from '../utils/semanticTrading'
import { getEngineRoute } from '../routing/routes'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

function fmtNum(n: number | null | undefined, d = 1): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toFixed(d)
}

function metricVal(m: SignalFeedMetrics | undefined, k: keyof SignalFeedMetrics): number | null {
  const v = m?.[k]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function rsBars(rs: number | null | undefined, pct: number): number {
  const val = rs ?? pct
  return Math.min(100, Math.max(0, ((val + 10) / 20) * 100))
}

function verdictBadgeClass(v: string): string { return getDecisionBadgeClass(v) }
function agreementClass(v: string): string { return getAgreementBadgeClass(v) }

function normalizeAgreement(row: SignalFeedRow): string {
  const raw = String(row.agreement_badge || '').trim().toUpperCase()
  if (raw) return raw
  const state = String(row.agreement_state || '').trim().toUpperCase()
  if (state === 'CONFLICT') return 'CONFLICT'
  if (state === 'EXTENDED') return 'EXTENDED'
  if (state === 'MANAGE') return 'MANAGE'
  if (state === 'AVOID') return 'NO_EDGE'
  return 'PARTIAL_AGREEMENT'
}

function dm(row: SignalFeedRow | null, key: string): unknown {
  if (!row) return undefined
  return (row.day.metrics as Record<string, unknown> | undefined)?.[key]
}
function sm(row: SignalFeedRow | null, key: string): unknown {
  if (!row) return undefined
  return (row.swing.metrics as Record<string, unknown> | undefined)?.[key]
}

const SCANNER_CACHE_KEY = 'oa_ticker_scanner_cache_v2'

interface ScannerCache {
  rows: SignalFeedRow[]
  fetchedAt: string | null
  cachedAt: number
}

function readScannerCache(): ScannerCache | null {
  try {
    const raw = localStorage.getItem(SCANNER_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ScannerCache>
    if (!Array.isArray(parsed.rows)) return null
    return {
      rows: parsed.rows as SignalFeedRow[],
      fetchedAt: typeof parsed.fetchedAt === 'string' ? parsed.fetchedAt : null,
      cachedAt: typeof parsed.cachedAt === 'number' ? parsed.cachedAt : 0,
    }
  } catch {
    return null
  }
}

function writeScannerCache(rows: SignalFeedRow[], fetchedAt: string | null) {
  try {
    localStorage.setItem(SCANNER_CACHE_KEY, JSON.stringify({ rows, fetchedAt, cachedAt: Date.now() }))
  } catch {
    /* localStorage quota or private mode */
  }
}

type MarketStructurePivot = NonNullable<NonNullable<SignalFeedMetrics['market_structure']>['pivots']>[number]
type MarketStructurePayload = NonNullable<SignalFeedMetrics['market_structure']>

function marketStructure(row: SignalFeedRow | null): MarketStructurePayload | null {
  if (!row) return null
  const fromRow = row.metrics?.market_structure
  if (fromRow && typeof fromRow === 'object') return fromRow
  const fromDay = (row.day.metrics as Record<string, unknown> | undefined)?.market_structure
  if (fromDay && typeof fromDay === 'object') return fromDay as MarketStructurePayload
  return null
}

function pivotLabel(pivot: MarketStructurePivot | null | undefined): string {
  const label = String(pivot?.label || '').trim().toUpperCase()
  return label || 'Developing Swing'
}

function pivotPrice(pivot: MarketStructurePivot | null | undefined): number | null {
  const price = Number(pivot?.price)
  return Number.isFinite(price) ? price : null
}

function structureBiasTone(structure: MarketStructurePayload | null): 'green' | 'red' | 'amber' | 'gray' {
  const bias = String(structure?.bias || '').toLowerCase()
  const state = String(structure?.state || '').toLowerCase()
  if (bias.includes('bull') || state.includes('bullish')) return 'green'
  if (bias.includes('bear') || state.includes('bearish')) return 'red'
  if (state.includes('broken') || state.includes('compression') || state.includes('transition') || state.includes('reversal')) return 'amber'
  return 'gray'
}

// ─── Market Snapshot cards ────────────────────────────────────────────────────

function MarketCard({ label, value, sub, tone }: {
  label: string; value: string; sub: string
  tone: 'green' | 'red' | 'amber' | 'gray'
}) {
  const color = tone === 'green' ? 'text-emerald-600 dark:text-emerald-400'
    : tone === 'red'   ? 'text-red-600 dark:text-red-400'
    : tone === 'amber' ? 'text-amber-600 dark:text-amber-400'
    : 'text-gray-700 dark:text-gray-200'
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/60 p-4 flex-1 min-w-[140px]">
      <div className="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-1">{label}</div>
      <div className={`text-2xl font-bold leading-tight ${color}`}>{value}</div>
      <div className="text-xs text-gray-500 dark:text-gray-500 mt-1 leading-snug">{sub}</div>
    </div>
  )
}

function spyTone(pct: number | null): 'green' | 'red' | 'gray' {
  if (pct == null) return 'gray'
  return pct > 0 ? 'green' : pct < 0 ? 'red' : 'gray'
}
function vixTone(v: number | null): 'green' | 'amber' | 'red' | 'gray' {
  if (v == null) return 'gray'
  if (v < 20) return 'green'
  if (v < 30) return 'amber'
  return 'red'
}
function vixSub(v: number | null): string {
  if (v == null) return '—'
  if (v < 15) return 'Very low — high conviction plays'
  if (v < 20) return 'Low — day plays viable'
  if (v < 25) return 'Moderate — be selective'
  if (v < 30) return 'Elevated — tighter stops'
  return 'High — reduce size'
}
function tickTone(t: number | null): 'green' | 'red' | 'gray' {
  if (t == null) return 'gray'
  return t > 0 ? 'green' : t < 0 ? 'red' : 'gray'
}
function tickSub(t: number | null): string {
  if (t == null) return '—'
  if (t > 600) return 'Intraday breadth: very positive'
  if (t > 200) return 'Intraday breadth: positive'
  if (t > -200) return 'Intraday breadth: neutral'
  if (t > -600) return 'Intraday breadth: negative'
  return 'Intraday breadth: very negative'
}
function pcTone(pc: number | null): 'green' | 'amber' | 'red' | 'gray' {
  if (pc == null) return 'gray'
  if (pc < 0.7) return 'green'
  if (pc < 0.9) return 'green'
  if (pc < 1.1) return 'amber'
  return 'red'
}
function pcSub(pc: number | null): string {
  if (pc == null) return '—'
  if (pc < 0.7) return 'Bullish sentiment'
  if (pc < 0.9) return 'Slightly bullish sentiment'
  if (pc < 1.0) return 'Neutral — balanced flow'
  if (pc < 1.2) return 'Slightly bearish sentiment'
  return 'Bearish — hedging elevated'
}

// ─── Signal Breakdown cell ────────────────────────────────────────────────────

function SigCell({ label, value, tone, wide }: {
  label: string; value: string; tone: 'green' | 'amber' | 'red' | 'gray' | 'blue'; wide?: boolean
}) {
  const bg = tone === 'green' ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/60'
    : tone === 'amber' ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/60'
    : tone === 'red'   ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800/60'
    : tone === 'blue'  ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700/60'
    : 'bg-gray-50 dark:bg-gray-800/40 border-gray-200 dark:border-gray-700/60'
  const valColor = tone === 'green' ? 'text-emerald-700 dark:text-emerald-400'
    : tone === 'amber' ? 'text-amber-700 dark:text-amber-400'
    : tone === 'red'   ? 'text-red-700 dark:text-red-400'
    : tone === 'blue'  ? 'text-blue-700 dark:text-blue-300'
    : 'text-gray-700 dark:text-gray-200'
  return (
    <div className={`rounded-xl border p-3 ${bg} ${wide ? 'col-span-2' : ''}`}>
      <div className="text-[10px] font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-0.5">{label}</div>
      <div className={`text-sm font-bold ${valColor}`}>{value}</div>
    </div>
  )
}

function outcomeBox(decision: string): { label: string; verdict: string; tone: 'blue' | 'green' | 'gray' | 'red'; icon: 'check' | 'x' | 'minus' } {
  const d = decision.toUpperCase()
  if (d === 'READY' || d === 'STRONG_GO' || d === 'GO') return { label: 'Strong ✓', verdict: d, tone: 'blue', icon: 'check' }
  if (d === 'WATCH') return { label: 'Watch', verdict: d, tone: 'green', icon: 'minus' }
  return { label: 'Avoid ×', verdict: d, tone: 'gray', icon: 'x' }
}

// ─── Signal Breakdown Panel ────────────────────────────────────────────────────

function SignalBreakdown({ row }: { row: SignalFeedRow }) {
  const navigate = useNavigate()
  const { requestAnalysis } = useApp()

  // Top-level SignalFeedMetrics (RSI, RS, IV, vol)
  const rvol       = metricVal(row.metrics, 'volume_ratio')
  const rsi        = metricVal(row.metrics, 'rsi')
  const ivRank     = metricVal(row.metrics, 'iv_rank')
  const rs         = metricVal(row.metrics, 'relative_strength')

  // day.metrics field names (from day_trade.py)
  const vwapPosition = dm(row, 'vwap_position')                  // "above" | "below" | "at" | "unknown"
  const atrUsed      = dm(row, 'daily_range_used_pct')           // 0–100 float
  const priceStruct  = dm(row, 'price_structure')                // "HH_HL" | "LL_LH" | "MIXED" | "FLAT"
  const rvolDay      = dm(row, 'rvol') ?? rvol                   // prefer day rvol, fall back to feed vol_ratio
  const vixVal       = dm(row, 'vix') ?? sm(row, 'vix')         // numeric

  // swing.metrics field names (from swing_trade.py)
  const spyBias      = sm(row, 'spy_bias') ?? dm(row, 'spy_bias')          // "bullish" | "bearish" | "neutral"
  const weeklyPhase  = sm(row, 'weekly_range_phase')                        // "early" | "mid" | "extended" | etc.
  const earnDays     = sm(row, 'earnings_calendar_days_until')              // integer days until earnings
  const marketCtx    = sm(row, 'market_context') ?? dm(row, 'market_context')

  // Derived display strings & tones
  const rvolNum  = rvolDay != null ? Number(rvolDay) : null
  const rvolStr  = rvolNum != null ? `${rvolNum.toFixed(1)}×` : '—'
  const rvolTone: 'green' | 'amber' | 'gray' = rvolNum == null ? 'gray' : rvolNum >= 2 ? 'green' : rvolNum >= 1.2 ? 'amber' : 'gray'

  const atrNum   = atrUsed != null ? Number(atrUsed) : null
  const atrStr   = atrNum  != null ? `${Math.round(atrNum)}%` : '—'
  const atrTone: 'green' | 'amber' | 'red' | 'gray' = atrNum == null ? 'gray' : atrNum <= 60 ? 'green' : atrNum <= 80 ? 'amber' : 'red'

  const vwapPos  = vwapPosition != null ? String(vwapPosition).toLowerCase() : null
  const vwapStr  = vwapPos == null ? '—' : vwapPos === 'above' ? 'Yes ↑' : vwapPos === 'below' ? 'No ↓' : 'At VWAP'
  const vwapTone: 'green' | 'red' | 'amber' | 'gray' = vwapPos == null ? 'gray' : vwapPos === 'above' ? 'green' : vwapPos === 'below' ? 'red' : 'amber'

  // price_structure: "HH_HL" = bullish, "LL_LH" = bearish, "MIXED"/"FLAT" = neutral
  const structStr  = priceStruct ? String(priceStruct).replace(/_/g, '/') : '—'
  const structLow  = structStr.toLowerCase()
  const structTone: 'green' | 'red' | 'gray' = structLow.includes('hh') ? 'green' : structLow.includes('ll') ? 'red' : 'gray'

  // spy_bias from swing metrics as daily trend proxy
  const spyBiasStr  = spyBias ? String(spyBias) : (marketCtx ? String(marketCtx) : '—')
  const spyBiasLow  = spyBiasStr.toLowerCase()
  const dailyTone: 'green' | 'amber' | 'gray' = spyBiasLow.includes('bull') ? 'green' : spyBiasLow.includes('bear') ? 'gray' : 'amber'

  // weekly_range_phase: "early" = room to run (green), "extended" = caution (amber/red)
  const weeklyStr  = weeklyPhase ? String(weeklyPhase) : '—'
  const weeklyLow  = weeklyStr.toLowerCase()
  const weeklyTone: 'green' | 'amber' | 'gray' = weeklyLow.includes('early') ? 'green' : weeklyLow.includes('extended') || weeklyLow.includes('late') ? 'gray' : 'amber'

  // Earnings: days until → human label
  const earnNum    = earnDays != null ? Number(earnDays) : null
  const earningsStr = earnNum == null ? '—' : earnNum <= 3 ? `In ${earnNum}d ⚠` : earnNum <= 7 ? `This week (${earnNum}d)` : earnNum <= 14 ? `Next week (${earnNum}d)` : `${earnNum}d away`
  const earningsTone: 'red' | 'amber' | 'green' | 'gray' = earnNum == null ? 'gray' : earnNum <= 7 ? 'red' : earnNum <= 14 ? 'amber' : 'green'

  // VIX
  const vixNum    = vixVal != null ? Number(vixVal) : null
  const vixStr    = vixNum != null ? vixNum.toFixed(1) : '—'
  const vixToneLocal: 'green' | 'amber' | 'red' | 'gray' = vixNum == null ? 'gray' : vixNum < 20 ? 'green' : vixNum < 30 ? 'amber' : 'red'

  const dayOut   = outcomeBox(row.day_decision)
  const swingOut = outcomeBox(row.swing_decision)

  const pct = row.price_change_pct
  const changeTone = pct > 0 ? 'text-emerald-500' : pct < 0 ? 'text-red-500' : 'text-gray-400'
  const agreement = normalizeAgreement(row)

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/60 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-gray-900 dark:text-white text-base">{row.ticker}</span>
            <span className="text-gray-500 dark:text-gray-400 text-xs truncate max-w-[160px]">{row.company_name}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="font-mono text-sm font-semibold text-gray-900 dark:text-gray-100">${row.price.toFixed(2)}</span>
            <span className={`text-xs font-semibold ${changeTone}`}>{fmtPct(pct)}</span>
            <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${agreementClass(agreement)}`}>
              {agreement.replace(/_/g, ' ')}
            </span>
          </div>
        </div>
        <div className="flex gap-1 shrink-0">
          {(['day', 'swing'] as const).map(eng => {
            const route = getEngineRoute(eng, row.ticker)
            return (
              <a
                key={eng}
                href={route}
                onClick={e => { e.preventDefault(); navigate(route) }}
                className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-violet-400 underline-offset-2 hover:underline transition-colors"
              >
                {eng === 'day' ? '⚡' : '📈'} {eng}
                <ArrowUpRight size={9} />
              </a>
            )
          })}
          <a
            href={getEngineRoute('regular', row.ticker)}
            onClick={e => { e.preventDefault(); requestAnalysis(row.ticker); navigate(getEngineRoute('regular', row.ticker)) }}
            className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-violet-400 hover:underline underline-offset-2 transition-colors"
          >
            🏛 options <ArrowUpRight size={9} />
          </a>
        </div>
      </div>

      {/* Signal Breakdown — 8 cells 2×4 */}
      <div className="p-3">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Signal Breakdown</div>
        <div className="grid grid-cols-2 gap-2">
          <SigCell label="Rel. vol (RVOL)"    value={rvolStr}   tone={rvolTone} />
          <SigCell label="ATR range used"     value={atrStr}    tone={atrTone} />
          <SigCell label="Above VWAP"         value={vwapStr}     tone={vwapTone} />
          <SigCell label="SPY bias"           value={spyBiasStr}  tone={dailyTone} />
          <SigCell label="5-min structure"    value={structStr}   tone={structTone} />
          <SigCell label="Weekly phase"       value={weeklyStr}   tone={weeklyTone} />
          <SigCell label="VIX"                value={vixStr}      tone={vixToneLocal} />
          <SigCell label="Earnings"           value={earningsStr} tone={earningsTone} />
        </div>

        {/* Extra chips row for RSI / IV / RS */}
        {(rsi != null || ivRank != null || rs != null) && (
          <div className="mt-2 flex gap-1.5 flex-wrap">
            {rsi != null && (
              <span className="rounded-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 px-2 py-0.5 text-[10px] font-semibold text-gray-600 dark:text-gray-400">
                RSI {fmtNum(rsi)}
              </span>
            )}
            {ivRank != null && (
              <span className="rounded-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 px-2 py-0.5 text-[10px] font-semibold text-gray-600 dark:text-gray-400">
                IV Rank {fmtNum(ivRank)}
              </span>
            )}
            {rs != null && (
              <span className="rounded-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 px-2 py-0.5 text-[10px] font-semibold text-gray-600 dark:text-gray-400">
                RS {fmtPct(rs)}
              </span>
            )}
          </div>
        )}

        {/* Day vs Swing outcome boxes */}
        <div className="grid grid-cols-2 gap-2 mt-3">
          {([
            { eng: 'Day trade',   out: dayOut,   dec: row.day_decision },
            { eng: 'Swing trade', out: swingOut, dec: row.swing_decision },
          ]).map(({ eng, out, dec }) => {
            const boxBg = out.tone === 'blue'  ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800/50'
              : out.tone === 'green' ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/50'
              : out.tone === 'red'   ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700/50'
              : 'bg-gray-50 dark:bg-gray-800/40 border-gray-200 dark:border-gray-700/50'
            const labelColor = out.tone === 'blue'  ? 'text-blue-700 dark:text-blue-300'
              : out.tone === 'green' ? 'text-emerald-700 dark:text-emerald-300'
              : out.tone === 'red'   ? 'text-red-700 dark:text-red-300'
              : 'text-gray-500 dark:text-gray-400'
            const Icon = out.icon === 'check' ? CheckCircle : out.icon === 'x' ? XCircle : MinusCircle
            return (
              <div key={eng} className={`rounded-xl border p-3 ${boxBg}`}>
                <div className="text-[10px] font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-1">{eng}</div>
                <div className={`flex items-center gap-1.5 text-sm font-bold ${labelColor}`}>
                  <Icon size={14} className={labelColor} />
                  {out.label}
                </div>
                <div className={`mt-0.5 text-[10px] ${verdictBadgeClass(dec)} inline-flex items-center rounded border px-1.5 py-0.5 font-bold uppercase tracking-wide`}>
                  {dec}
                </div>
              </div>
            )
          })}
        </div>

        {/* AI summary */}
        {row.ai_summary && (
          <p className="mt-3 text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed border-t border-gray-100 dark:border-gray-800 pt-2">
            ✦ {row.ai_summary}
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Decision matrix (educational, static) ────────────────────────────────────

const MATRIX_ROWS = [
  { signal: 'RVOL (3×+)',               day: ['Critical', 'yes'],    swing: ['Irrelevant', 'no'],    why: 'Day needs fuel. Swing entry on high RVOL = chasing.' },
  { signal: 'Above VWAP',               day: ['Required', 'yes'],    swing: ['Optional', 'maybe'],   why: 'VWAP is intraday reference. Means nothing on weekly chart.' },
  { signal: '5-min HH/HL structure',    day: ['Required', 'yes'],    swing: ['Ignore', 'no'],        why: 'Swing traders trade the daily/weekly candle, not minutes.' },
  { signal: 'Daily trend (EMA align)',  day: ['Helpful', 'maybe'],   swing: ['Critical', 'yes'],     why: 'Swing needs trend confirmation to hold days/weeks.' },
  { signal: 'Earnings date',            day: ['Watch', 'maybe'],     swing: ['Deal-breaker', 'no'],  why: 'Swing into earnings = gambling. Day trade can exploit the move.' },
  { signal: 'ATR (daily range left)',   day: ['Critical', 'yes'],    swing: ['Modest weight', 'maybe'], why: 'Day needs room to move. Swing ATR matters less per-session.' },
  { signal: 'Bid/ask spread',           day: ['Must be tight', 'yes'], swing: ['Less important', 'maybe'], why: 'Day trades in/out dozens of times. Spread eats P&L fast.' },
  { signal: 'Risk/reward to next level',day: ['2:1 minimum', 'maybe'], swing: ['3:1+ required', 'yes'], why: 'Swing takes on overnight risk so needs better reward ratio.' },
] as const

function matrixCellClass(cls: string): string {
  if (cls === 'yes')   return 'text-emerald-400 font-bold'
  if (cls === 'no')    return 'text-red-400 font-bold'
  return 'text-amber-400 font-semibold'
}

// ─── Best engine badge for watchlist row ──────────────────────────────────────

function EngineTag({ row }: { row: SignalFeedRow }) {
  const dayGo   = ['READY', 'GO', 'STRONG_GO', 'WATCH'].includes(row.day_decision.toUpperCase())
  const swingGo = ['READY', 'GO', 'STRONG_GO', 'WATCH'].includes(row.swing_decision.toUpperCase())
  if (dayGo && swingGo) return (
    <div className="flex gap-1">
      <span className="rounded border border-blue-500/40 bg-blue-50/60 dark:bg-blue-900/20 px-1.5 py-0.5 text-[9px] font-bold text-blue-600 dark:text-blue-400 uppercase">Day ✓</span>
      <span className="rounded border border-emerald-500/40 bg-emerald-50/60 dark:bg-emerald-900/20 px-1.5 py-0.5 text-[9px] font-bold text-emerald-600 dark:text-emerald-400 uppercase">Swing ✓</span>
    </div>
  )
  if (dayGo) return <span className="rounded border border-blue-500/40 bg-blue-50/60 dark:bg-blue-900/20 px-1.5 py-0.5 text-[9px] font-bold text-blue-600 dark:text-blue-400 uppercase">Day ✓</span>
  if (swingGo) return <span className="rounded border border-emerald-500/40 bg-emerald-50/60 dark:bg-emerald-900/20 px-1.5 py-0.5 text-[9px] font-bold text-emerald-600 dark:text-emerald-400 uppercase">Swing ✓</span>
  return <span className="rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 px-1.5 py-0.5 text-[9px] font-bold text-gray-500 uppercase">Skip</span>
}

function scannerSignalValues(row: SignalFeedRow) {
  const structure = marketStructure(row)
  const rvol = metricVal(row.metrics, 'volume_ratio')
  const rsi = metricVal(row.metrics, 'rsi')
  const ivRank = metricVal(row.metrics, 'iv_rank')
  const rs = metricVal(row.metrics, 'relative_strength')
  const vwapPosition = dm(row, 'vwap_position')
  const atrUsed = dm(row, 'daily_range_used_pct')
  const priceStruct = dm(row, 'price_structure')
  const rvolDay = dm(row, 'rvol') ?? rvol
  const vixVal = dm(row, 'vix') ?? sm(row, 'vix')
  const spyBias = sm(row, 'spy_bias') ?? dm(row, 'spy_bias')
  const weeklyPhase = sm(row, 'weekly_range_phase')
  const earnDays = sm(row, 'earnings_calendar_days_until')
  const marketCtx = sm(row, 'market_context') ?? dm(row, 'market_context')

  const rvolNum = rvolDay != null ? Number(rvolDay) : null
  const atrNum = atrUsed != null ? Number(atrUsed) : null
  const vwapPos = vwapPosition != null ? String(vwapPosition).toLowerCase() : null
  const structStr = structure?.display && structure.display !== 'No confirmed pivots'
    ? structure.display.replace(/->/g, '→')
    : priceStruct ? String(priceStruct).replace(/_/g, '/') : '—'
  const spyBiasStr = spyBias ? String(spyBias) : (marketCtx ? String(marketCtx) : '—')
  const weeklyStr = weeklyPhase ? String(weeklyPhase) : '—'
  const earnNum = earnDays != null ? Number(earnDays) : null
  const vixNum = vixVal != null ? Number(vixVal) : null

  return {
    rvolStr: rvolNum != null ? `${rvolNum.toFixed(1)}×` : '—',
    rvolTone: rvolNum == null ? 'gray' : rvolNum >= 2 ? 'green' : rvolNum >= 1.2 ? 'amber' : 'gray',
    atrStr: atrNum != null ? `${Math.round(atrNum)}%` : '—',
    atrTone: atrNum == null ? 'gray' : atrNum <= 60 ? 'green' : atrNum <= 80 ? 'amber' : 'red',
    vwapStr: vwapPos == null ? '—' : vwapPos === 'above' ? 'Yes ↑' : vwapPos === 'below' ? 'No ↓' : 'At VWAP',
    vwapTone: vwapPos == null ? 'gray' : vwapPos === 'above' ? 'green' : vwapPos === 'below' ? 'red' : 'amber',
    spyBiasStr,
    spyTone: String(spyBiasStr).toLowerCase().includes('bull') ? 'green' : String(spyBiasStr).toLowerCase().includes('bear') ? 'red' : 'amber',
    structStr,
    structTone: structure ? structureBiasTone(structure) : structStr.toLowerCase().includes('hh') ? 'green' : structStr.toLowerCase().includes('ll') ? 'red' : 'gray',
    weeklyStr,
    weeklyTone: weeklyStr.toLowerCase().includes('early') ? 'green' : weeklyStr.toLowerCase().includes('extended') || weeklyStr.toLowerCase().includes('late') ? 'amber' : 'gray',
    vixStr: vixNum != null ? vixNum.toFixed(1) : '—',
    vixTone: vixNum == null ? 'gray' : vixNum < 20 ? 'green' : vixNum < 30 ? 'amber' : 'red',
    earningsStr: earnNum == null ? '—' : earnNum <= 3 ? `In ${earnNum}d ⚠` : earnNum <= 7 ? `This week (${earnNum}d)` : earnNum <= 14 ? `Next week (${earnNum}d)` : `${earnNum}d away`,
    earningsTone: earnNum == null ? 'gray' : earnNum <= 7 ? 'red' : earnNum <= 14 ? 'amber' : 'green',
    rsiStr: rsi != null ? fmtNum(rsi) : '—',
    ivRankStr: ivRank != null ? fmtNum(ivRank) : '—',
    rsStr: rs != null ? fmtPct(rs) : '—',
  }
}

function toneTextClass(tone: string): string {
  if (tone === 'green') return 'text-emerald-600 dark:text-emerald-400'
  if (tone === 'red') return 'text-red-600 dark:text-red-400'
  if (tone === 'amber') return 'text-amber-600 dark:text-amber-400'
  if (tone === 'blue') return 'text-blue-600 dark:text-blue-400'
  return 'text-gray-600 dark:text-gray-400'
}

function ScannerTableCell({ label, value, tone = 'gray' }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="text-[9px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">{label}</div>
      <div className={`mt-0.5 font-semibold ${toneTextClass(tone)}`}>{value}</div>
    </div>
  )
}

function rowTone(row: SignalFeedRow): string {
  const agreement = normalizeAgreement(row)
  const day = row.day_decision.toUpperCase()
  const swing = row.swing_decision.toUpperCase()
  if (agreement === 'CONFLICT') return 'border-l-purple-500 bg-purple-50/70 dark:bg-purple-950/25 hover:bg-purple-50 dark:hover:bg-purple-950/35'
  if (day === 'READY' || day === 'GO' || day === 'STRONG_GO' || swing === 'READY' || swing === 'GO' || swing === 'STRONG_GO') {
    return 'border-l-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/25 hover:bg-emerald-50 dark:hover:bg-emerald-950/35'
  }
  if (day === 'WATCH' || swing === 'WATCH') return 'border-l-blue-500 bg-blue-50/70 dark:bg-blue-950/25 hover:bg-blue-50 dark:hover:bg-blue-950/35'
  if (agreement === 'EXTENDED' || day === 'WAIT' || swing === 'WAIT') return 'border-l-amber-500 bg-amber-50/70 dark:bg-amber-950/25 hover:bg-amber-50 dark:hover:bg-amber-950/35'
  return 'border-l-gray-400 bg-gray-50/70 dark:bg-gray-900/45 hover:bg-gray-100 dark:hover:bg-gray-800/60'
}

function structureLabel(row: SignalFeedRow): string {
  const structure = marketStructure(row)
  if (structure?.display) return structure.display.replace(/->/g, '→')
  const values = scannerSignalValues(row)
  const s = values.structStr
  if (s === 'HH/HL') return 'HH → HL'
  if (s === 'LL/LH' || s === 'LH/LL') return 'LL → LH'
  return 'Mixed'
}

function structureTransition(row: SignalFeedRow): string {
  const state = marketStructure(row)?.state
  if (state) return state
  const s = structureLabel(row)
  if (s === 'HH → HL') return 'Bullish continuation'
  if (s === 'LL → LH') return 'Bearish continuation'
  return 'Range / compression'
}

function scannerBlockers(row: SignalFeedRow): string[] {
  const values = scannerSignalValues(row)
  const blockers: string[] = []
  if (normalizeAgreement(row) === 'CONFLICT') blockers.push('Engine conflict')
  if (String(row.agreement_badge || '').toUpperCase() === 'EXTENDED') blockers.push('Extended')
  if (values.weeklyStr.toLowerCase().includes('extended')) blockers.push('Swing extended')
  if (values.atrTone === 'red') blockers.push('ATR consumed')
  if (values.rvolTone === 'gray') blockers.push('Low RVOL')
  if (row.day_decision.toUpperCase() === 'AVOID' && row.swing_decision.toUpperCase() === 'AVOID') blockers.push('No engine edge')
  return blockers.length ? blockers : ['Clear']
}

function scannerSummary(row: SignalFeedRow): string {
  const values = scannerSignalValues(row)
  const structure = marketStructure(row)
  const state = String(structure?.state || '').toLowerCase()
  const day = row.day_decision.toUpperCase()
  const swing = row.swing_decision.toUpperCase()
  const bullish = structure?.bias ? structure.bias === 'bullish' : values.structStr === 'HH/HL' || values.vwapTone === 'green'
  const bearish = structure?.bias ? structure.bias === 'bearish' : values.structStr === 'LL/LH' || values.structStr === 'LH/LL' || values.vwapTone === 'red'
  if (state.includes('bearish continuation')) return 'Bearish Breakdown'
  if (state.includes('bullish continuation')) return values.vwapTone === 'red' ? 'Bullish Structure, VWAP Weak' : 'Bullish Continuation'
  if (state.includes('bull trend broken') || state.includes('bear trend broken')) return 'Trend Transition'
  if (state.includes('compression') || state.includes('range')) return 'Trend Transition'
  if ((day === 'READY' || day === 'GO' || day === 'STRONG_GO') && (swing === 'READY' || swing === 'GO' || swing === 'STRONG_GO')) {
    return bullish ? 'Bullish Continuation' : bearish ? 'Bearish Breakdown' : 'Best Candidate'
  }
  if (day === 'WATCH' && (swing.includes('EXTENDED') || values.weeklyStr.toLowerCase().includes('extended'))) return 'Day Trade Only'
  if (day === 'WATCH') return bullish ? 'Wait for Pullback' : bearish ? 'Wait for Breakdown' : 'Trend Transition'
  if (swing === 'WATCH' || swing === 'READY') return 'Swing Setup Building'
  if (normalizeAgreement(row) === 'CONFLICT') return 'Trend Transition'
  return 'Do Not Trade'
}

function resolvedScannerNarrative(row: SignalFeedRow): { label: string; reason: string; story: string[]; needed: string[] } {
  const values = scannerSignalValues(row)
  const structure = marketStructure(row)
  const day = row.day_decision.toUpperCase()
  const swing = row.swing_decision.toUpperCase()
  const bullish = structure?.bias ? structure.bias === 'bullish' : values.structStr === 'HH/HL'
  const bearish = structure?.bias ? structure.bias === 'bearish' : values.structStr === 'LL/LH' || values.structStr === 'LH/LL'
  const extendedSwing = swing.includes('EXTENDED') || values.weeklyStr.toLowerCase().includes('extended')
  const label = scannerSummary(row)
  const direction = bullish ? 'bullish' : bearish ? 'bearish' : 'mixed'
  const structureWhy = structure?.story
    ? structure.story
    : bullish
      ? 'Higher highs and higher lows remain intact.'
      : bearish
        ? 'Lower highs and lower lows remain intact.'
        : 'Confirmed pivots are not aligned yet, so the chart is still in transition.'
  const vwapWhy = values.vwapTone === 'green'
    ? 'Price is holding above VWAP, which supports intraday long attempts.'
    : values.vwapTone === 'red'
      ? 'Price is staying below VWAP, which supports intraday short attempts.'
      : 'Price is near VWAP, so neither side has clean control.'
  let safeStructureWhy = structureWhy
  if (bearish && /bullish continuation|higher highs|buyers defended/i.test(safeStructureWhy)) {
    safeStructureWhy = 'Lower-high/lower-low structure is in control. Bullish continuation language is suppressed until pivots confirm a reversal.'
  }
  if (values.vwapTone === 'red' && /buyers defended/i.test(safeStructureWhy)) {
    safeStructureWhy = 'The pivot sequence is constructive, but price is below VWAP, so buyer defense is not confirmed.'
  }
  let reason = `${safeStructureWhy} ${vwapWhy}`
  if (extendedSwing) {
    reason += ' Swing entries are limited because the daily/weekly phase is late or extended.'
  } else if (swing === 'READY' || swing === 'WATCH') {
    reason += ' The swing engine still sees a developing multi-day setup.'
  } else {
    reason += ' The swing engine is not confirming a new multi-day entry right now.'
  }
  const conflictLine = `Intraday structure is ${direction}, while Swing is ${row.swing_decision}. ${label} is the cleanest interpretation.`
  const rawNeeded = row.day.missing_confirmations?.length
    ? row.day.missing_confirmations
    : row.swing.missing_confirmations?.length
      ? row.swing.missing_confirmations
      : values.vwapTone === 'gray'
        ? ['Hold clearly above or below VWAP', 'Confirm direction with a completed 5m candle']
        : ['Wait for the next completed 5m confirmation candle']
  const needed = Array.from(new Set(rawNeeded.map(item => String(item).trim()).filter(Boolean))).slice(0, 3)
  return {
    label,
    reason,
    story: [reason, conflictLine].filter(Boolean),
    needed,
  }
}

function invalidationText(row: SignalFeedRow): string {
  const values = scannerSignalValues(row)
  const structure = marketStructure(row)
  const pivots = structure?.pivots || []
  const lastHl = [...pivots].reverse().find(p => pivotLabel(p) === 'HL')
  const lastLh = [...pivots].reverse().find(p => pivotLabel(p) === 'LH')
  const hlPrice = pivotPrice(lastHl)
  const lhPrice = pivotPrice(lastLh)
  if (structure?.bias === 'bullish' && hlPrice != null) return `Break below ${hlPrice.toFixed(2)} invalidates the latest confirmed higher low.`
  if (structure?.bias === 'bearish' && lhPrice != null) return `Break above ${lhPrice.toFixed(2)} invalidates the latest confirmed lower high.`
  if (String(structure?.state || '').toLowerCase().includes('broken')) return 'Structure has already broken. Wait for a new confirmed pivot sequence before defining a fresh trade.'
  const orLow = dm(row, 'or_low')
  const orHigh = dm(row, 'or_high')
  const vwap = dm(row, 'vwap')
  if (values.structStr === 'HH/HL') {
    const level = typeof orLow === 'number' ? orLow : typeof vwap === 'number' ? vwap : null
    return level ? `Break below ${level.toFixed(2)} invalidates the bullish structure.` : 'Lose VWAP or break the last higher low.'
  }
  if (values.structStr === 'LL/LH' || values.structStr === 'LH/LL') {
    const level = typeof orHigh === 'number' ? orHigh : typeof vwap === 'number' ? vwap : null
    return level ? `Break above ${level.toFixed(2)} invalidates the bearish structure.` : 'Reclaim VWAP or break the last lower high.'
  }
  return 'Wait for confirmed HH/HL or LH/LL before defining a clean invalidation level.'
}

function StructureDiagram({ row }: { row: SignalFeedRow }) {
  const structure = marketStructure(row)
  const confirmedPivots = (structure?.pivots || []).filter(p => p.confirmed !== false && pivotPrice(p) != null).slice(-4)
  const tone = structureBiasTone(structure)
  const stroke = tone === 'red' ? '#ef4444' : tone === 'green' ? '#10b981' : tone === 'amber' ? '#f59e0b' : '#64748b'
  const prices = confirmedPivots.map(p => pivotPrice(p)).filter((price): price is number => price != null)
  const minPrice = prices.length ? Math.min(...prices) : row.price
  const maxPrice = prices.length ? Math.max(...prices) : row.price
  const range = Math.max(maxPrice - minPrice, 0.01)
  const points = confirmedPivots.length
    ? confirmedPivots.map((pivot, idx) => {
        const price = pivotPrice(pivot) ?? row.price
        const x = confirmedPivots.length === 1 ? 50 : 12 + (idx * (76 / (confirmedPivots.length - 1)))
        const y = 72 - ((price - minPrice) / range) * 48
        const label = idx === confirmedPivots.length - 1 ? `Current ${pivotLabel(pivot)}` : pivotLabel(pivot)
        return { label, x, y, price }
      })
    : [{ label: 'Developing Swing', x: 50, y: 48, price: row.price }]
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950/50">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">Market Structure</div>
          <div className="mt-1 text-lg font-black text-gray-900 dark:text-white">{structureLabel(row)}</div>
        </div>
        <div className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase ${tone === 'amber' ? 'border-amber-400/50 text-amber-600 dark:text-amber-300' : tone === 'red' ? 'border-red-400/50 text-red-600 dark:text-red-300' : tone === 'green' ? 'border-emerald-400/50 text-emerald-600 dark:text-emerald-300' : 'border-gray-400/50 text-gray-600 dark:text-gray-300'}`}>
          {structureTransition(row)}
        </div>
      </div>
      <svg viewBox="0 0 100 86" className="h-44 w-full">
        <polyline
          points={points.map(p => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke={stroke}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {points.map(p => (
          <g key={`${p.label}-${p.x}`}>
            <circle cx={p.x} cy={p.y} r="3.5" fill={stroke} />
            <text x={p.x} y={p.y - 7} textAnchor="middle" className="fill-gray-700 text-[6px] font-bold dark:fill-gray-200">{p.label}</text>
            {typeof p.price === 'number' && <text x={p.x} y={p.y + 11} textAnchor="middle" className="fill-gray-500 text-[5px] font-mono dark:fill-gray-400">{p.price.toFixed(2)}</text>}
          </g>
        ))}
      </svg>
      <div className="grid grid-cols-4 gap-2 text-center text-[10px]">
        {points.map((p, idx) => (
          <div key={`${p.label}-timeline-${idx}`} className="rounded-lg border border-gray-200 bg-gray-50 p-2 dark:border-gray-800 dark:bg-gray-900/70">
            <div className="font-black text-gray-900 dark:text-white">{p.label}</div>
            <div className="mt-0.5 font-mono text-gray-500">{typeof p.price === 'number' ? p.price.toFixed(2) : idx === points.length - 1 ? 'Current' : `Pivot ${idx + 1}`}</div>
          </div>
        ))}
      </div>
      {import.meta.env.DEV && structure?.debug && (
        <details className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-[10px] dark:border-gray-800 dark:bg-gray-900/70">
          <summary className="cursor-pointer font-black uppercase tracking-wide text-gray-500">Structure Debug</summary>
          <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap font-mono text-gray-600 dark:text-gray-300">
            {JSON.stringify({
              detected_pivots: structure.debug.detected_pivots,
              pivot_classification: structure.debug.pivot_classification,
              anchors: structure.debug.anchors,
              validation: structure.validation,
              structure: structure.debug.structure,
            }, null, 2)}
          </pre>
        </details>
      )}
    </div>
  )
}

function engineField(block: SignalFeedRow['day'], names: string[]): string {
  const fields = block.execution_fields || []
  const found = fields.find(f => names.some(name => f.label.toLowerCase().includes(name.toLowerCase())))
  return found?.value || '—'
}

function EngineDecisionCard({ title, block, tone }: { title: string; block: SignalFeedRow['day']; tone: 'blue' | 'emerald' }) {
  const accent = tone === 'blue' ? 'text-blue-600 dark:text-blue-300 border-blue-400/40 bg-blue-50 dark:bg-blue-950/25' : 'text-emerald-600 dark:text-emerald-300 border-emerald-400/40 bg-emerald-50 dark:bg-emerald-950/25'
  const entry = engineField(block, ['entry'])
  const stop = engineField(block, ['stop'])
  const t1 = engineField(block, ['target 1', 't1'])
  const t2 = engineField(block, ['target 2', 't2', 'holding'])
  const hasPlan = [entry, stop, t1, t2].some(v => v !== '—')
  const needs = block.missing_confirmations?.length
    ? Array.from(new Set(block.missing_confirmations.map(item => String(item).trim()).filter(Boolean))).slice(0, 3)
    : block.supporting_factors?.length && String(block.final_decision).toUpperCase().includes('READY')
      ? ['Entry available in the detail page']
      : ['Completed 5m confirmation candle', 'Volume confirmation', 'Hold the active VWAP side']
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950/50">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">{title}</div>
        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase ${accent}`}>{block.final_decision || block.verdict || '—'}</span>
      </div>
      {hasPlan ? (
        <div className="grid grid-cols-2 gap-3 text-xs">
          <ScannerTableCell label="Confidence" value={`${block.confidence ?? 0}%`} tone={block.confidence >= 70 ? 'green' : block.confidence >= 50 ? 'amber' : 'gray'} />
          <ScannerTableCell label="Risk" value={block.risk_state || '—'} tone={String(block.risk_state).toUpperCase().includes('HIGH') ? 'red' : 'gray'} />
          <ScannerTableCell label="Entry" value={entry} tone="green" />
          <ScannerTableCell label="Stop" value={stop} tone="red" />
          <ScannerTableCell label="Target 1" value={t1} tone="blue" />
          <ScannerTableCell label="Target 2" value={t2} tone="blue" />
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs dark:border-gray-800 dark:bg-gray-900/70">
          <div className="font-black uppercase tracking-wide text-gray-500">{String(block.final_decision).toUpperCase().includes('READY') ? 'Ready' : 'Need'}</div>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-gray-600 dark:text-gray-400">
            {needs.map(item => <li key={item}>{item}</li>)}
          </ul>
        </div>
      )}
      <p className="mt-3 border-t border-gray-100 pt-3 text-[11px] leading-relaxed text-gray-600 dark:border-gray-800 dark:text-gray-400">
        {block.reason || block.normalized_reason || 'No engine reason available.'}
      </p>
    </div>
  )
}

function SupportingMetric({ label, value, tone = 'gray' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900/70">
      <div className="text-[9px] font-black uppercase tracking-[0.12em] text-gray-400">{label}</div>
      <div className={`mt-1 font-mono text-sm font-black ${toneTextClass(tone)}`}>{value}</div>
    </div>
  )
}

function ScannerExpandedPanel({ row }: { row: SignalFeedRow }) {
  const navigate = useNavigate()
  const { requestAnalysis } = useApp()
  const values = scannerSignalValues(row)
  const blockers = scannerBlockers(row)
  const narrative = resolvedScannerNarrative(row)
  const overall = narrative.label
  const dayRoute = getEngineRoute('day', row.ticker)
  const swingRoute = getEngineRoute('swing', row.ticker)
  const optionsRoute = getEngineRoute('regular', row.ticker)
  const storyLines = narrative.story
  return (
    <div className="space-y-4 border-t border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950/80">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-lg font-black text-gray-900 dark:text-white">{row.ticker}</span>
            <span className="text-sm text-gray-500">{row.company_name}</span>
          </div>
          <div className="mt-1 text-sm font-semibold text-gray-700 dark:text-gray-300">{overall}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={dayRoute} onClick={e => { e.preventDefault(); navigate(dayRoute) }} className="rounded-lg border border-blue-400/40 px-3 py-2 text-xs font-black text-blue-600 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950/30">Day Trade <ArrowUpRight size={11} className="inline" /></a>
          <a href={swingRoute} onClick={e => { e.preventDefault(); navigate(swingRoute) }} className="rounded-lg border border-emerald-400/40 px-3 py-2 text-xs font-black text-emerald-600 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/30">Swing Trade <ArrowUpRight size={11} className="inline" /></a>
          <a href={optionsRoute} onClick={e => { e.preventDefault(); requestAnalysis(row.ticker); navigate(optionsRoute) }} className="rounded-lg border border-violet-400/40 px-3 py-2 text-xs font-black text-violet-600 hover:bg-violet-50 dark:text-violet-300 dark:hover:bg-violet-950/30">Options <ArrowUpRight size={11} className="inline" /></a>
          <a href={row.actions?.chart_url || dayRoute} target="_blank" rel="noreferrer" className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-black text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-900">Full Chart <ArrowUpRight size={11} className="inline" /></a>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        <StructureDiagram row={row} />
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950/50">
          <div className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">Market Story</div>
          <div className="mt-3 space-y-2 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
            {storyLines.map(line => <div key={line}>{line}</div>)}
          </div>
          <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs dark:border-gray-800 dark:bg-gray-900/60">
            <div className="font-black text-gray-900 dark:text-white">Trend Transition</div>
            <div className="mt-1 text-gray-600 dark:text-gray-400">{structureTransition(row)}</div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <EngineDecisionCard title="Day Trade" block={row.day} tone="blue" />
        <EngineDecisionCard title="Swing Trade" block={row.swing} tone="emerald" />
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950/50">
        <div className="mb-3 text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">Supporting Metrics</div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <SupportingMetric label="RVOL" value={values.rvolStr} tone={values.rvolTone} />
          <SupportingMetric label="ATR Used" value={values.atrStr} tone={values.atrTone} />
          <SupportingMetric label="VWAP" value={values.vwapStr} tone={values.vwapTone} />
          <SupportingMetric label="RSI" value={values.rsiStr} />
          <SupportingMetric label="IV Rank" value={values.ivRankStr} />
          <SupportingMetric label="Weekly Phase" value={values.weeklyStr.toUpperCase()} tone={values.weeklyTone} />
          <SupportingMetric label="Relative Strength" value={values.rsStr} />
          <SupportingMetric label="VIX" value={values.vixStr} tone={values.vixTone} />
          <SupportingMetric label="Earnings" value={values.earningsStr} tone={values.earningsTone} />
          <SupportingMetric label="Trend Score" value={fmtNum(metricVal(row.metrics, 'bull_score') ?? metricVal(row.metrics, 'bear_score'))} />
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950/50">
        <div className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">Final Verdict</div>
        <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_1fr_1.2fr]">
          <div>
            <div className="text-xs text-gray-500">Day</div>
            <div className="text-lg font-black text-blue-600 dark:text-blue-300">{row.day_decision}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">Swing</div>
            <div className="text-lg font-black text-emerald-600 dark:text-emerald-300">{row.swing_decision}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">Overall</div>
            <div className="text-lg font-black text-gray-900 dark:text-white">{overall}</div>
          </div>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900/60">
            <div className="text-[10px] font-black uppercase tracking-wide text-gray-400">Reason</div>
            <div className="mt-1 text-sm text-gray-700 dark:text-gray-300">{narrative.reason}</div>
          </div>
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900/50 dark:bg-red-950/20">
            <div className="text-[10px] font-black uppercase tracking-wide text-red-500">Invalidation</div>
            <div className="mt-1 text-sm font-semibold text-red-700 dark:text-red-300">{invalidationText(row)}</div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {blockers.map(blocker => (
            <span key={blocker} className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase ${blocker === 'Clear' ? 'border-emerald-400/40 text-emerald-600 dark:text-emerald-300' : 'border-amber-400/40 text-amber-700 dark:text-amber-300'}`}>{blocker}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function TickerScannerPage() {
  const navigate = useNavigate()
  const [cacheSeed] = useState(() => readScannerCache())
  const [rows, setRows] = useState<SignalFeedRow[]>(() => cacheSeed?.rows ?? [])
  const [loading, setLoading] = useState(() => !(cacheSeed?.rows?.length))
  const [refreshing, setRefreshing] = useState(false)
  const [showingCache, setShowingCache] = useState(() => Boolean(cacheSeed?.rows?.length))
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(() => cacheSeed?.rows?.[0]?.ticker ?? null)
  const [fetchedAt, setFetchedAt] = useState<string | null>(() => cacheSeed?.fetchedAt ?? null)

  const load = useCallback(async (forceRefresh = false) => {
    const hasRows = rows.length > 0
    if (hasRows) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const env = await fetchSignalFeed({ sort_by: 'relative_strength', sort_dir: 'desc', page: 1, page_size: 100, refresh: forceRefresh })
      const fetched = env.data?.rows ?? []
      setRows(fetched)
      setFetchedAt(env.fetched_at ?? null)
      setShowingCache(Boolean(env.stale))
      writeScannerCache(fetched, env.fetched_at ?? null)
      if (fetched.length > 0 && (!selected || !fetched.some(r => r.ticker === selected))) setSelected(fetched[0]!.ticker)
    } catch (err) {
      setError(hasRows
        ? `Live refresh failed. Showing cached scanner data. ${err instanceof Error ? err.message : ''}`.trim()
        : err instanceof Error ? err.message : 'Failed to load scanner data')
      if (hasRows) setShowingCache(true)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [rows.length, selected])

  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const sorted = useMemo(() => [...rows].sort((a, b) => {
    const rsA = metricVal(a.metrics, 'relative_strength') ?? a.price_change_pct
    const rsB = metricVal(b.metrics, 'relative_strength') ?? b.price_change_pct
    if (rsA !== rsB) return rsB - rsA
    return b.price_change_pct - a.price_change_pct
  }), [rows])

  // Market snapshot values from first row's day.metrics
  const snap = useMemo((): { spyPct: number | null; qqqPct: number | null; vix: number | null; breadth: string; bias: string; ctxStr: string } | null => {
    const r = rows[0]
    if (!r) return null
    const d  = r.day.metrics   as Record<string, unknown> | undefined
    const sw = r.swing.metrics as Record<string, unknown> | undefined
    const spyPct:  number | null = typeof d?.spy_change_pct === 'number' ? d.spy_change_pct as number : null
    const qqqPct:  number | null = typeof d?.qqq_change_pct === 'number' ? d.qqq_change_pct as number : null
    const vix:     number | null = typeof d?.vix  === 'number' ? d.vix  as number : typeof sw?.vix === 'number' ? sw.vix as number : null
    const ctxStr = String(r.metrics?.market_context ?? '')
    const strong = rows.filter(row => ['READY', 'GO', 'STRONG_GO', 'WATCH'].includes(row.day_decision.toUpperCase())).length
    const avoid = rows.filter(row => ['AVOID', 'NO_EDGE'].includes(row.day_decision.toUpperCase())).length
    const breadth = rows.length ? `${strong}/${rows.length} actionable` : '—'
    const bias = (spyPct ?? 0) > 0 && (qqqPct ?? 0) > 0 ? 'Bullish' : (spyPct ?? 0) < 0 && (qqqPct ?? 0) < 0 ? 'Bearish' : avoid > strong ? 'Defensive' : 'Mixed'
    return { spyPct, qqqPct, vix, breadth, bias, ctxStr }
  }, [rows])

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4 pb-4 border-b border-gray-200 dark:border-gray-800">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-violet-600/20 border border-violet-700 flex items-center justify-center shrink-0">
              <ScanLine size={18} className="text-violet-400" />
            </div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
              Ticker Scanner
            </h1>
          </div>
          <p className="text-xs text-gray-500 mt-1 ml-11">
            {rows.length} tickers · sorted by relative strength · {fetchedAt ? `updated ${new Date(fetchedAt).toLocaleTimeString()}` : 'loading…'}
            {showingCache ? ' · showing cache first' : ''}
            {refreshing ? ' · refreshing…' : ''}
          </p>
        </div>
        <button
          onClick={() => void load(true)}
          disabled={loading || refreshing}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
        >
          <RefreshCw size={14} className={loading || refreshing ? 'animate-spin' : ''} />
          {loading ? 'Loading…' : refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* ── Market Snapshot ── */}
      {snap && (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-2">Market Overview</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <MarketCard
              label="SPY"
              value={snap.spyPct != null ? fmtPct(snap.spyPct) : snap.ctxStr || '—'}
              sub={snap.spyPct != null ? (snap.spyPct > 0 ? 'Broad market bias: bull' : snap.spyPct < 0 ? 'Broad market bias: bear' : 'Broad market: flat') : `Market: ${snap.ctxStr || '—'}`}
              tone={snap.spyPct != null ? spyTone(snap.spyPct) : 'gray'}
            />
            <MarketCard
              label="QQQ"
              value={snap.qqqPct != null ? fmtPct(snap.qqqPct) : '—'}
              sub={snap.qqqPct != null ? (snap.qqqPct > 0 ? 'Growth tape: bull' : snap.qqqPct < 0 ? 'Growth tape: bear' : 'Growth tape: flat') : 'Growth tape unavailable'}
              tone={snap.qqqPct != null ? spyTone(snap.qqqPct) : 'gray'}
            />
            <MarketCard
              label="VIX"
              value={snap.vix != null ? fmtNum(snap.vix) : '—'}
              sub={vixSub(snap.vix)}
              tone={vixTone(snap.vix)}
            />
            <MarketCard label="Breadth" value={snap.breadth} sub="Scanner rows with day-trade interest" tone={snap.breadth.startsWith('0/') ? 'gray' : 'green'} />
            <MarketCard label="Overall Bias" value={snap.bias} sub="SPY/QQQ plus scanner breadth" tone={snap.bias === 'Bullish' ? 'green' : snap.bias === 'Bearish' || snap.bias === 'Defensive' ? 'red' : 'amber'} />
          </div>
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div className="rounded-xl border border-red-700/40 bg-red-900/20 px-4 py-3 text-sm text-red-300 flex items-center justify-between gap-3">
          {error}
          <button onClick={() => void load()} className="text-xs underline">Retry</button>
        </div>
      )}

      {/* ── Main grid ── */}
      {rows.length === 0 && !loading && !error ? (
        <div className="text-center py-16 text-gray-500 text-sm">
          No tickers in your Signal Feed yet. Add some in My Tickers first.
        </div>
      ) : (
        <div className="space-y-4">

          {/* ── Watchlist table ── */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Watchlist — relative strength
              </span>
              <span className="text-[10px] text-gray-400 uppercase tracking-wide">Sorted by intraday momentum</span>
            </div>

            {loading && rows.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-gray-500">
                <RefreshCw size={16} className="inline animate-spin mr-2" />Loading…
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1080px] border-collapse text-xs">
                  <thead className="bg-gray-50 dark:bg-gray-950/50 text-[10px] uppercase tracking-[0.08em] text-gray-500">
                    <tr>
                      <th className="px-3 py-2 text-left font-black">Ticker</th>
                      <th className="px-3 py-2 text-right font-black">Price</th>
                      <th className="px-3 py-2 text-left font-black">Relative Strength</th>
                      <th className="px-3 py-2 text-left font-black">5m Struct</th>
                      <th className="px-3 py-2 text-left font-black">Trend</th>
                      <th className="px-3 py-2 text-left font-black">Day</th>
                      <th className="px-3 py-2 text-left font-black">Swing</th>
                      <th className="px-3 py-2 text-left font-black">Blockers</th>
                      <th className="px-3 py-2 text-left font-black">Summary</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map(row => {
                      const pct = row.price_change_pct
                      const isUp = pct >= 0
                      const isSelected = selected === row.ticker
                      const values = scannerSignalValues(row)
                      const agreement = normalizeAgreement(row)
                      const dayOut = outcomeBox(row.day_decision)
                      const swingOut = outcomeBox(row.swing_decision)
                      const blockers = scannerBlockers(row)
                      return (
                        <Fragment key={row.ticker}>
                          <tr
                            onClick={() => setSelected(isSelected ? null : row.ticker)}
                            className={`cursor-pointer border-l-4 border-t border-gray-100 transition-colors dark:border-t-gray-800/70 ${rowTone(row)} ${isSelected ? 'ring-1 ring-inset ring-violet-400/40' : ''}`}
                          >
                            <td className="px-3 py-3 align-top">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-sm font-black text-gray-900 dark:text-white">{row.ticker}</span>
                                {isUp ? <TrendingUp size={13} className="text-emerald-500" /> : <TrendingDown size={13} className="text-red-500" />}
                              </div>
                              <div className="max-w-[160px] truncate text-[10px] text-gray-500">{row.company_name}</div>
                            </td>
                            <td className="px-3 py-3 text-right align-top">
                              <div className="font-mono font-bold text-gray-900 dark:text-gray-100">${row.price.toFixed(2)}</div>
                              <div className={`font-mono text-[11px] font-bold ${isUp ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{fmtPct(pct)}</div>
                            </td>
                            <td className="px-3 py-3 align-top">
                              <div className="font-mono font-black text-gray-900 dark:text-gray-100">{values.rsStr}</div>
                              <div className="mt-1 h-1.5 w-20 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
                                <div className={isUp ? 'h-full bg-emerald-500' : 'h-full bg-red-500'} style={{ width: `${rsBars(metricVal(row.metrics, 'relative_strength'), pct)}%` }} />
                              </div>
                            </td>
                            <td className={`px-3 py-3 align-top font-black ${toneTextClass(values.structTone)}`}>{values.structStr}</td>
                            <td className="px-3 py-3 align-top">
                              <div className={`font-bold ${toneTextClass(values.vwapTone)}`}>{values.vwapStr}</div>
                              <div className="text-[10px] text-gray-500">{values.weeklyStr.toUpperCase()}</div>
                            </td>
                            <td className="px-3 py-3 align-top">
                              <div className={`font-bold ${toneTextClass(dayOut.tone)}`}>{row.day_decision}</div>
                              <div className="text-[10px] text-gray-500">{row.day.confidence}%</div>
                            </td>
                            <td className="px-3 py-3 align-top">
                              <div className={`font-bold ${toneTextClass(swingOut.tone)}`}>{row.swing_decision}</div>
                              <div className="text-[10px] text-gray-500">{row.swing.confidence}%</div>
                            </td>
                            <td className="px-3 py-3 align-top">
                              <div className="flex max-w-[220px] flex-wrap gap-1">
                                {blockers.slice(0, 3).map(blocker => (
                                  <span key={blocker} className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${blocker === 'Clear' ? 'border-emerald-400/40 text-emerald-600 dark:text-emerald-300' : 'border-amber-400/40 text-amber-700 dark:text-amber-300'}`}>{blocker}</span>
                                ))}
                              </div>
                            </td>
                            <td className="px-3 py-3 align-top">
                              <div className="max-w-[280px] font-semibold leading-snug text-gray-800 dark:text-gray-200">{scannerSummary(row)}</div>
                              <div className="mt-1 text-[10px] text-gray-500">{agreement.replace(/_/g, ' ')}</div>
                            </td>
                          </tr>
                          {isSelected && (
                            <tr className="border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
                              <td colSpan={9} className="p-0">
                                <ScannerExpandedPanel row={row} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </div>
      )}

    </div>
  )
}
