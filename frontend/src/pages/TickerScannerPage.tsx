import { useEffect, useState, useCallback, useMemo } from 'react'
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
            const handleNav = () => { navigate(route) }
            return (
              <button key={eng} onClick={handleNav} className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-violet-400 underline-offset-2 hover:underline transition-colors">
                {eng === 'day' ? '⚡' : '📈'} {eng}
                <ArrowUpRight size={9} />
              </button>
            )
          })}
          <button onClick={() => { requestAnalysis(row.ticker); navigate(getEngineRoute('regular', row.ticker)) }} className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-violet-400 hover:underline underline-offset-2 transition-colors">
            🏛 options <ArrowUpRight size={9} />
          </button>
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

// ─── Main page ────────────────────────────────────────────────────────────────

export default function TickerScannerPage() {
  const [rows, setRows] = useState<SignalFeedRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const env = await fetchSignalFeed({ sort_by: 'relative_strength', sort_dir: 'desc', page: 1, page_size: 100 })
      const fetched = env.data?.rows ?? []
      setRows(fetched)
      setFetchedAt(env.fetched_at ?? null)
      if (fetched.length > 0 && !selected) setSelected(fetched[0]!.ticker)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load scanner data')
    } finally {
      setLoading(false)
    }
  }, [selected])

  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const sorted = useMemo(() => [...rows].sort((a, b) => {
    const rsA = metricVal(a.metrics, 'relative_strength') ?? a.price_change_pct
    const rsB = metricVal(b.metrics, 'relative_strength') ?? b.price_change_pct
    if (rsA !== rsB) return rsB - rsA
    return b.price_change_pct - a.price_change_pct
  }), [rows])

  const selectedRow = selected ? rows.find(r => r.ticker === selected) ?? null : null

  // Market snapshot values from first row's day.metrics
  const snap = useMemo((): { spyPct: number | null; vix: number | null; tickAvg: number | null; pcRatio: number | null; ctxStr: string } | null => {
    const r = rows[0]
    if (!r) return null
    const d  = r.day.metrics   as Record<string, unknown> | undefined
    const sw = r.swing.metrics as Record<string, unknown> | undefined
    const spyPct:  number | null = typeof d?.spy_change_pct === 'number' ? d.spy_change_pct as number : null
    const vix:     number | null = typeof d?.vix  === 'number' ? d.vix  as number : typeof sw?.vix === 'number' ? sw.vix as number : null
    const tickAvg: number | null = null  // not yet in signal feed metrics
    const pcRatio: number | null = null  // not yet in signal feed metrics
    const ctxStr = String(r.metrics?.market_context ?? '')
    return { spyPct, vix, tickAvg, pcRatio, ctxStr }
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
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {/* ── Market Snapshot ── */}
      {snap && (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-2">Market Snapshot</div>
          <div className="flex gap-3 flex-wrap">
            <MarketCard
              label="SPY"
              value={snap.spyPct != null ? fmtPct(snap.spyPct) : snap.ctxStr || '—'}
              sub={snap.spyPct != null ? (snap.spyPct > 0 ? 'Broad market bias: bull' : snap.spyPct < 0 ? 'Broad market bias: bear' : 'Broad market: flat') : `Market: ${snap.ctxStr || '—'}`}
              tone={snap.spyPct != null ? spyTone(snap.spyPct) : 'gray'}
            />
            <MarketCard
              label="VIX"
              value={snap.vix != null ? fmtNum(snap.vix) : '—'}
              sub={vixSub(snap.vix)}
              tone={vixTone(snap.vix)}
            />
            <MarketCard
              label="TICK avg"
              value={snap.tickAvg != null ? (snap.tickAvg > 0 ? `+${Math.round(snap.tickAvg)}` : String(Math.round(snap.tickAvg))) : 'N/A'}
              sub={snap.tickAvg != null ? tickSub(snap.tickAvg) : 'Not tracked in signal feed yet'}
              tone={tickTone(snap.tickAvg)}
            />
            <MarketCard
              label="Put/Call"
              value={snap.pcRatio != null ? snap.pcRatio.toFixed(2) : 'N/A'}
              sub={snap.pcRatio != null ? pcSub(snap.pcRatio) : 'Not tracked in signal feed yet'}
              tone={pcTone(snap.pcRatio)}
            />
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
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4 items-start">

          {/* ── Watchlist table ── */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
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
              <div className="divide-y divide-gray-100 dark:divide-gray-800/60">
                {sorted.map(row => {
                  const pct = row.price_change_pct
                  const isUp = pct >= 0
                  const rs = metricVal(row.metrics, 'relative_strength')
                  const barW = rsBars(rs, pct)
                  const isSelected = selected === row.ticker

                  return (
                    <button
                      key={row.ticker}
                      type="button"
                      onClick={() => setSelected(isSelected ? null : row.ticker)}
                      className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors ${
                        isSelected
                          ? 'bg-violet-50 dark:bg-violet-900/20 border-l-2 border-violet-500'
                          : 'hover:bg-gray-50 dark:hover:bg-gray-800/40 border-l-2 border-transparent'
                      }`}
                    >
                      {/* Symbol */}
                      <span className="font-mono font-bold text-gray-900 dark:text-white w-14 text-sm shrink-0">{row.ticker}</span>

                      {/* RS bar */}
                      <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${isUp ? 'bg-emerald-500' : 'bg-red-500'}`}
                          style={{ width: `${barW}%` }}
                        />
                      </div>

                      {/* % change */}
                      <span className={`font-mono text-xs font-bold w-16 text-right shrink-0 ${isUp ? 'text-emerald-500' : 'text-red-500'}`}>
                        {fmtPct(pct)}
                      </span>

                      {/* Direction icon */}
                      <span className="hidden sm:block shrink-0">
                        {isUp ? <TrendingUp size={13} className="text-emerald-500" /> : <TrendingDown size={13} className="text-red-500" />}
                      </span>

                      {/* Engine tag */}
                      <div className="hidden sm:flex shrink-0">
                        <EngineTag row={row} />
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* ── Signal breakdown panel — desktop ── */}
          <div className="hidden lg:block sticky top-4">
            {selectedRow ? (
              <SignalBreakdown row={selectedRow} />
            ) : (
              <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40 p-6 text-center text-sm text-gray-500">
                Click a ticker to see its signal breakdown
              </div>
            )}
          </div>

          {/* ── Signal breakdown — mobile (below selected row) ── */}
          {selectedRow && (
            <div className="lg:hidden">
              <SignalBreakdown row={selectedRow} />
            </div>
          )}
        </div>
      )}

      {/* ── Decision matrix (educational) ── */}
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-2">
          What actually matters — Day vs Swing
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900/80 border-b border-gray-200 dark:border-gray-800">
                <th className="px-4 py-2.5 text-left font-semibold text-gray-500 dark:text-gray-400">Signal</th>
                <th className="px-4 py-2.5 text-left font-semibold text-blue-600 dark:text-blue-400">Day trade</th>
                <th className="px-4 py-2.5 text-left font-semibold text-emerald-600 dark:text-emerald-400">Swing trade</th>
                <th className="px-4 py-2.5 text-left font-semibold text-gray-400 hidden md:table-cell">Why</th>
              </tr>
            </thead>
            <tbody>
              {MATRIX_ROWS.map(row => (
                <tr key={row.signal} className="border-b border-gray-100 dark:border-gray-800/60 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-900/30">
                  <td className="px-4 py-2 text-gray-700 dark:text-gray-300 font-medium">{row.signal}</td>
                  <td className={`px-4 py-2 ${matrixCellClass(row.day[1])}`}>{row.day[0]}</td>
                  <td className={`px-4 py-2 ${matrixCellClass(row.swing[1])}`}>{row.swing[0]}</td>
                  <td className="px-4 py-2 text-gray-500 hidden md:table-cell">{row.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  )
}
