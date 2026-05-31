import { useEffect, useState, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  RefreshCw, TrendingUp, TrendingDown, Minus, ChevronDown,
  ScanLine, Sparkles, ArrowUpRight,
} from 'lucide-react'
import { fetchSignalFeed } from '../api/commandCenter'
import type { SignalFeedRow, SignalFeedMetrics } from '../types/commandCenter'
import { useApp } from '../contexts/AppContext'
import {
  getAgreementBadgeClass,
  getDecisionBadgeClass,
  getMetricChipAppearance,
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

/** Map relative_strength (e.g. ±10%) or price_change_pct to a 0–100 bar width */
function rsBars(rs: number | null | undefined, pct: number): number {
  const val = rs ?? pct
  return Math.min(100, Math.max(0, ((val + 10) / 20) * 100))
}

function verdictBadgeClass(v: string): string {
  return getDecisionBadgeClass(v)
}

function agreementClass(v: string): string {
  return getAgreementBadgeClass(v)
}

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

function engineLabelClass(engine: string): string {
  if (engine === 'day') return 'text-emerald-700 dark:text-emerald-400'
  if (engine === 'swing') return 'text-sky-700 dark:text-sky-400'
  return 'text-violet-700 dark:text-violet-400'
}
function engineBorderClass(engine: string): string {
  if (engine === 'day') return 'border-emerald-500/30 bg-emerald-50/60 dark:bg-emerald-900/10'
  if (engine === 'swing') return 'border-sky-500/30 bg-sky-50/60 dark:bg-sky-900/10'
  return 'border-violet-500/20 bg-violet-50/40 dark:bg-violet-900/10'
}
function engineName(engine: string): string {
  if (engine === 'day') return '⚡ Day Trade'
  if (engine === 'swing') return '📈 Swing Trade'
  return '🏛 Regular'
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

function DetailPanel({ row }: { row: SignalFeedRow }) {
  const navigate = useNavigate()
  const { requestAnalysis } = useApp()
  const agreement = normalizeAgreement(row)
  const pct = row.price_change_pct
  const changeTone = pct > 0 ? 'text-emerald-400' : pct < 0 ? 'text-red-400' : 'text-gray-400'
  const rsVal = metricVal(row.metrics, 'relative_strength')
  const rsiVal = metricVal(row.metrics, 'rsi')
  const volVal = metricVal(row.metrics, 'volume_ratio')
  const ivVal  = metricVal(row.metrics, 'iv_rank')
  const rsiApp = getMetricChipAppearance('rsi', rsiVal)
  const rsApp  = getMetricChipAppearance('relative_strength', rsVal)
  const volApp = getMetricChipAppearance('volume_ratio', volVal)
  const ivApp  = getMetricChipAppearance('iv_rank', ivVal)

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono font-bold text-white text-lg">{row.ticker}</span>
            <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${agreementClass(agreement)}`}>
              {agreement.replace(/_/g, ' ')}
            </span>
          </div>
          <div className="text-gray-500 text-xs mt-0.5 truncate max-w-[220px]">{row.company_name}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-mono text-sm font-bold text-white">${row.price.toFixed(2)}</div>
          <div className={`text-xs font-semibold ${changeTone}`}>{fmtPct(pct)}</div>
        </div>
      </div>

      {/* Metrics row */}
      <div className="grid grid-cols-4 gap-1.5">
        {[
          { label: 'RSI', app: rsiApp, val: fmtNum(rsiVal) },
          { label: 'RS',  app: rsApp,  val: fmtPct(rsVal) },
          { label: 'Vol', app: volApp, val: fmtNum(volVal, 2) },
          { label: 'IV',  app: ivApp,  val: fmtNum(ivVal) },
        ].map(({ label, app, val }) => (
          <div key={label} className={`rounded-lg border px-2 py-1.5 text-center leading-none ${app.container}`}>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</div>
            <div className={`mt-0.5 text-xs font-semibold ${app.value}`}>{val}</div>
          </div>
        ))}
      </div>

      {/* Engine decision blocks */}
      <div className="space-y-1.5">
        {(['day', 'swing', 'regular'] as const).map(engine => {
          const block = row[engine]
          const route = getEngineRoute(engine, row.ticker)
          const handleNav = () => {
            if (engine === 'regular') requestAnalysis(row.ticker)
            navigate(route)
          }
          return (
            <div key={engine} className={`rounded-xl border px-3 py-2 ${engineBorderClass(engine)}`}>
              <div className="flex items-center justify-between gap-2 mb-1">
                <button onClick={handleNav} className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest hover:underline underline-offset-2 ${engineLabelClass(engine)}`}>
                  {engineName(engine)}
                  <ArrowUpRight size={10} className="opacity-60" />
                </button>
                <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${verdictBadgeClass(block.final_decision)}`}>
                  {block.final_decision}
                </span>
              </div>
              {block.reason ? (
                <p className="text-[11px] text-gray-400 leading-snug line-clamp-2">{block.reason}</p>
              ) : null}
              <div className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-gray-600">
                {block.expected_holding_period && <span>Hold: <span className="text-gray-400">{block.expected_holding_period}</span></span>}
                {block.signal_quality && <span>Quality: <span className="text-gray-400">{block.signal_quality}</span></span>}
              </div>
            </div>
          )
        })}
      </div>

      {/* AI summary */}
      {row.ai_summary && (
        <div className="flex items-start gap-1.5 text-[11px] text-gray-400 leading-relaxed">
          <Sparkles size={11} className="mt-0.5 shrink-0 text-violet-400" />
          <p>{row.ai_summary}</p>
        </div>
      )}
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
  { signal: 'Risk/reward to next level',day: ['2:1 minimum', 'maybe'], swing: ['3:1+ required', 'yes'],    why: 'Swing takes on overnight risk so needs better reward ratio.' },
] as const

function matrixCellClass(cls: string): string {
  if (cls === 'yes')   return 'text-emerald-400 font-bold'
  if (cls === 'no')    return 'text-red-400 font-bold'
  return 'text-amber-400 font-semibold'
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

  // Sort by relative strength desc, then price change desc
  const sorted = useMemo(() => [...rows].sort((a, b) => {
    const rsA = metricVal(a.metrics, 'relative_strength') ?? a.price_change_pct
    const rsB = metricVal(b.metrics, 'relative_strength') ?? b.price_change_pct
    if (rsA !== rsB) return rsB - rsA
    return b.price_change_pct - a.price_change_pct
  }), [rows])

  const selectedRow = selected ? rows.find(r => r.ticker === selected) ?? null : null

  // Market snapshot from first row
  const mktCtx = useMemo(() => {
    const r = rows[0]
    if (!r) return null
    const dayM = r.day.metrics as Record<string, unknown> | undefined
    return {
      marketContext: String(r.metrics?.market_context ?? 'MIXED'),
      spyBias: typeof dayM?.spy_bias === 'string' ? dayM.spy_bias : null,
      qqqBias: typeof dayM?.qqq_bias === 'string' ? dayM.qqq_bias : null,
    }
  }, [rows])

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4 pb-4 border-b border-gray-800">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-violet-600/20 border border-violet-700 flex items-center justify-center shrink-0">
              <ScanLine size={18} className="text-violet-400" />
            </div>
            <h1 className="text-xl font-semibold text-white">
              Ticker Scanner
              <span className="ml-2 text-sm font-normal text-gray-500">— compact table view</span>
            </h1>
          </div>
          <p className="text-xs text-gray-500 mt-1 ml-11">
            {rows.length} tickers · sorted by relative strength · {fetchedAt ? `updated ${new Date(fetchedAt).toLocaleTimeString()}` : 'loading…'}
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {/* ── Market context strip ── */}
      {mktCtx && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-800 bg-gray-900/50 px-4 py-2.5 text-xs">
          <span className="font-semibold text-gray-400 uppercase tracking-wide text-[10px]">Market</span>
          <span className="rounded-full border border-gray-700 bg-gray-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-300">
            {mktCtx.marketContext.replace(/_/g, ' ')}
          </span>
          {mktCtx.spyBias && <span className="text-gray-500">SPY <span className="text-gray-300 font-semibold">{mktCtx.spyBias}</span></span>}
          {mktCtx.qqqBias && <span className="text-gray-500">QQQ <span className="text-gray-300 font-semibold">{mktCtx.qqqBias}</span></span>}
          <span className="ml-auto text-gray-600">{rows.filter(r => r.agreement_state === 'READY').length} ready · {rows.filter(r => r.agreement_state === 'CONFLICT').length} conflict</span>
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div className="rounded-xl border border-red-700/40 bg-red-900/20 px-4 py-3 text-sm text-red-300 flex items-center justify-between gap-3">
          {error}
          <button onClick={() => void load()} className="text-xs underline">Retry</button>
        </div>
      )}

      {/* ── Main grid: table + detail ── */}
      {rows.length === 0 && !loading && !error ? (
        <div className="text-center py-16 text-gray-500 text-sm">
          No tickers in your Signal Feed yet. Add some in My Tickers first.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4 items-start">

          {/* ── Table ── */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/40 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-800 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Watchlist — relative strength
              </span>
              <span className="text-[10px] text-gray-600">Day · Swing · Regular</span>
            </div>

            {loading && rows.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-gray-500">
                <RefreshCw size={16} className="inline animate-spin mr-2" />Loading…
              </div>
            ) : (
              <div className="divide-y divide-gray-800/60">
                {sorted.map(row => {
                  const pct = row.price_change_pct
                  const isUp = pct >= 0
                  const rs = metricVal(row.metrics, 'relative_strength')
                  const barW = rsBars(rs, pct)
                  const agreement = normalizeAgreement(row)
                  const isSelected = selected === row.ticker

                  return (
                    <div key={row.ticker}>
                      <button
                        type="button"
                        onClick={() => setSelected(isSelected ? null : row.ticker)}
                        className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors ${
                          isSelected
                            ? 'bg-violet-900/20 border-l-2 border-violet-500'
                            : 'hover:bg-gray-800/40 border-l-2 border-transparent'
                        }`}
                      >
                        {/* Symbol */}
                        <span className="font-mono font-semibold text-white min-w-[52px] text-sm">{row.ticker}</span>

                        {/* Relative strength bar */}
                        <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${isUp ? 'bg-emerald-500' : 'bg-red-500'}`}
                            style={{ width: `${barW}%` }}
                          />
                        </div>

                        {/* Price change */}
                        <span className={`font-mono text-xs font-semibold min-w-[58px] text-right ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
                          {fmtPct(pct)}
                        </span>

                        {/* Direction icon */}
                        <span className="text-gray-600 hidden sm:block">
                          {isUp ? <TrendingUp size={12} className="text-emerald-500" /> : <TrendingDown size={12} className="text-red-500" />}
                        </span>

                        {/* Agreement badge */}
                        <span className={`hidden sm:inline-flex items-center rounded-md border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${agreementClass(agreement)}`}>
                          {agreement.replace(/_/g, ' ')}
                        </span>

                        {/* Three engine verdict pills */}
                        <div className="hidden lg:flex items-center gap-1">
                          {(['day', 'swing', 'regular'] as const).map(eng => {
                            const dec = eng === 'day' ? row.day_decision : eng === 'swing' ? row.swing_decision : row.regular_decision
                            return (
                              <span key={eng} className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase ${verdictBadgeClass(dec)}`}>
                                {dec}
                              </span>
                            )
                          })}
                        </div>

                        {/* RS value */}
                        <span className="hidden xl:block font-mono text-[10px] text-gray-500 min-w-[42px] text-right">
                          {rs != null ? `RS ${fmtPct(rs)}` : <Minus size={10} />}
                        </span>

                        <ChevronDown
                          size={14}
                          className={`lg:hidden text-gray-500 transition-transform shrink-0 ${isSelected ? 'rotate-180' : ''}`}
                        />
                      </button>

                      {/* Inline detail — mobile/tablet */}
                      {isSelected && (
                        <div className="lg:hidden px-3 pb-3">
                          <DetailPanel row={row} />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* ── Detail panel — desktop ── */}
          <div className="hidden lg:block sticky top-4">
            {selectedRow ? (
              <DetailPanel row={selectedRow} />
            ) : (
              <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-6 text-center text-sm text-gray-500">
                Click a ticker to see its signal breakdown
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Decision matrix (educational) ── */}
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-2">
          What actually matters — by style
        </div>
        <div className="rounded-xl border border-gray-800 overflow-hidden">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-900/80 border-b border-gray-800">
                <th className="px-4 py-2.5 text-left font-semibold text-gray-400">Signal</th>
                <th className="px-4 py-2.5 text-left font-semibold text-blue-400">Day trade</th>
                <th className="px-4 py-2.5 text-left font-semibold text-green-400">Swing trade</th>
                <th className="px-4 py-2.5 text-left font-semibold text-gray-400 hidden md:table-cell">Why</th>
              </tr>
            </thead>
            <tbody>
              {MATRIX_ROWS.map(row => (
                <tr key={row.signal} className="border-b border-gray-800/60 last:border-0 hover:bg-gray-900/30">
                  <td className="px-4 py-2 text-gray-300 font-medium">{row.signal}</td>
                  <td className={`px-4 py-2 ${matrixCellClass(row.day[1])}`}>{row.day[0]}</td>
                  <td className={`px-4 py-2 ${matrixCellClass(row.swing[1])}`}>{row.swing[0]}</td>
                  <td className="px-4 py-2 text-gray-500 hidden md:table-cell">{row.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Honest truths ── */}
      <div className="rounded-xl border-l-4 border-l-gray-600 border border-gray-800 bg-gray-900/40 p-5 space-y-3">
        <h3 className="text-sm font-semibold text-white mb-1">What traders actually do — honest breakdown</h3>
        {[
          { icon: '▶', color: 'text-blue-400',  text: <><strong className="text-white">Day traders</strong> scan for high RVOL (3×+), wide ATR with room remaining, price above VWAP, and clean 5-min higher-high / higher-low structure. Large caps (NVDA, TSLA) are preferred — they respect levels and have tight spreads.</> },
          { icon: '▶', color: 'text-green-400', text: <><strong className="text-white">Swing traders</strong> ignore intraday noise entirely. They want price above the 21 EMA on the daily, weekly trend intact, and a 3:1+ R/R to the next resistance. They check earnings dates and sector rotation. RVOL is noise to them.</> },
          { icon: '⚠', color: 'text-amber-400', text: <><strong className="text-white">The actual problem:</strong> Most traders use one watchlist for both styles and lose on both. A ticker squeezing intraday is usually the worst swing entry — the move is extended.</> },
          { icon: '✕', color: 'text-red-400',   text: <><strong className="text-white">Skip both styles when:</strong> Stock in confirmed downtrend, earnings within 2 weeks (swing), spread wider than 0.1% (day), market context is red, or you have no defined catalyst.</> },
        ].map(({ icon, color, text }, i) => (
          <div key={i} className="flex gap-3 text-xs text-gray-400 leading-relaxed">
            <span className={`${color} text-base flex-shrink-0 mt-0.5`}>{icon}</span>
            <span>{text}</span>
          </div>
        ))}
      </div>

    </div>
  )
}
