import { useEffect, useState, useCallback, useRef } from 'react'
import { RefreshCw, TrendingUp, TrendingDown, Minus, AlertTriangle, ChevronDown } from 'lucide-react'
import { fetchMyTickers } from '../api/commandCenter'
import { analyzeV2 } from '../api/client'
import type { UnifiedAnalysis } from '../api/client'
import type { MyTickerEntry } from '../api/commandCenter'
import { useApp } from '../contexts/AppContext'

// ─── Types ────────────────────────────────────────────────────────────────────

type ScanState = 'idle' | 'loading' | 'done' | 'error'

interface TickerResult {
  entry: MyTickerEntry
  day:   UnifiedAnalysis | null
  swing: UnifiedAnalysis | null
  state: ScanState
}

interface MarketContext {
  spyPct:   number | null
  vix:      number | null
  vixLabel: string
  regime:   string
  session:  string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VERDICT_ORDER: Record<string, number> = {
  STRONG_GO: 0, GO: 1, WATCH: 2, WAIT: 3, AVOID: 4, NO_EDGE: 5,
}

function verdictLabel(v: string | undefined | null): string {
  if (!v) return '—'
  return v.replace('_', ' ')
}

function verdictChipClass(v: string | undefined | null): string {
  switch (v) {
    case 'STRONG_GO': return 'bg-emerald-900/50 text-emerald-300 border-emerald-700/50'
    case 'GO':        return 'bg-green-900/40 text-green-300 border-green-700/40'
    case 'WATCH':     return 'bg-amber-900/40 text-amber-300 border-amber-700/40'
    case 'WAIT':      return 'bg-gray-800/60 text-gray-400 border-gray-600/50'
    case 'AVOID':     return 'bg-red-900/40 text-red-400 border-red-700/40'
    default:          return 'bg-gray-800/40 text-gray-500 border-gray-700/30'
  }
}

function strengthPct(pct: number | null | undefined): number {
  if (pct == null) return 0
  // Map ±5% to 0–100 bar width
  return Math.min(100, Math.max(0, ((pct + 5) / 10) * 100))
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

function bestVerdict(r: TickerResult): string | null {
  const candidates = [r.day?.verdict, r.swing?.verdict].filter(Boolean) as string[]
  if (!candidates.length) return null
  return candidates.sort((a, b) => (VERDICT_ORDER[a] ?? 9) - (VERDICT_ORDER[b] ?? 9))[0] ?? null
}

// ─── Signal breakdown panel ───────────────────────────────────────────────────

function sigClass(type: 'pass' | 'warn' | 'fail'): string {
  switch (type) {
    case 'pass': return 'bg-emerald-950/50 border-emerald-800/50 text-emerald-300'
    case 'warn': return 'bg-amber-950/50 border-amber-800/50 text-amber-300'
    case 'fail': return 'bg-red-950/50 border-red-800/50 text-red-400'
  }
}

function SignalPanel({ result }: { result: TickerResult }) {
  const { entry, day, swing } = result
  const analysis = day ?? swing
  const pct = entry.price_change_pct

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
      {/* Header */}
      <div className="flex items-baseline gap-2 mb-3">
        <span className="font-mono font-bold text-white text-lg">{entry.symbol}</span>
        <span className="text-gray-400 text-xs truncate max-w-[160px]">{entry.company_name}</span>
        {entry.last_price != null && (
          <span className="ml-auto font-mono text-sm text-white">${entry.last_price.toFixed(2)}</span>
        )}
        {pct != null && (
          <span className={`text-xs font-mono font-semibold ${pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {fmtPct(pct)}
          </span>
        )}
      </div>

      {/* Verdict row */}
      <div className="flex gap-2 mb-4">
        {[
          { label: 'Day trade', v: day?.verdict },
          { label: 'Swing trade', v: swing?.verdict },
        ].map(({ label, v }) => (
          <div
            key={label}
            className={`flex-1 rounded-lg border px-3 py-2 text-center ${v ? verdictChipClass(v) : 'bg-gray-800/40 border-gray-700/30 text-gray-600'}`}
          >
            <div className="text-[10px] opacity-70 mb-0.5">{label}</div>
            <div className="text-sm font-bold">{verdictLabel(v)}</div>
          </div>
        ))}
      </div>

      {/* Conditions grid */}
      {analysis?.conditions && analysis.conditions.length > 0 ? (
        <>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-2">
            Signal breakdown
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {analysis.conditions.slice(0, 8).map((c, i) => (
              <div key={i} className={`rounded-md border px-2.5 py-1.5 text-[11px] ${sigClass(c.type)}`}>
                <div className="opacity-60 mb-0.5 text-[10px]">{c.label}</div>
                <div className="font-semibold">
                  {c.type === 'pass' ? '✓ Pass' : c.type === 'warn' ? '⚠ Watch' : '✕ Fail'}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="text-xs text-gray-500 text-center py-3">No signal data — scan to populate</div>
      )}

      {/* Key metrics */}
      {analysis && (
        <div className="mt-3 pt-3 border-t border-gray-800 grid grid-cols-2 gap-2 text-[11px]">
          {analysis.rvol && (
            <div>
              <span className="text-gray-500">RVOL</span>
              <span className="ml-1.5 font-mono font-semibold text-white">{analysis.rvol}</span>
            </div>
          )}
          {analysis.rr_ratio && (
            <div>
              <span className="text-gray-500">R/R</span>
              <span className="ml-1.5 font-mono font-semibold text-white">{analysis.rr_ratio}</span>
            </div>
          )}
          {analysis.entry_price != null && (
            <div>
              <span className="text-gray-500">Entry</span>
              <span className="ml-1.5 font-mono font-semibold text-emerald-300">${analysis.entry_price.toFixed(2)}</span>
            </div>
          )}
          {analysis.stop_price != null && (
            <div>
              <span className="text-gray-500">Stop</span>
              <span className="ml-1.5 font-mono font-semibold text-red-400">${analysis.stop_price.toFixed(2)}</span>
            </div>
          )}
        </div>
      )}

      {/* Coach note */}
      {analysis?.coach && (
        <div className="mt-3 pt-3 border-t border-gray-800 text-[11px] text-gray-400 leading-relaxed">
          {analysis.coach}
        </div>
      )}
    </div>
  )
}

// ─── Decision matrix (static) ─────────────────────────────────────────────────

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

// ─── Market snapshot bar ──────────────────────────────────────────────────────

function MarketSnapshotBar({ ctx }: { ctx: MarketContext | null }) {
  if (!ctx) return null
  const { spyPct, vix, vixLabel, regime } = ctx
  const spyUp = spyPct != null && spyPct >= 0

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
      {[
        {
          label: 'SPY',
          val: spyPct != null ? fmtPct(spyPct) : '—',
          sub: spyUp ? 'Broad market bias: bull' : 'Broad market bias: bear',
          color: spyUp ? 'text-emerald-400' : 'text-red-400',
        },
        {
          label: 'VIX',
          val: vix != null ? vix.toFixed(1) : '—',
          sub: vixLabel || 'Volatility index',
          color: vix != null && vix > 25 ? 'text-red-400' : vix != null && vix > 18 ? 'text-amber-400' : 'text-emerald-400',
        },
        {
          label: 'Regime',
          val: regime || '—',
          sub: 'Market environment',
          color: 'text-gray-200',
        },
        {
          label: 'Session',
          val: ctx.session || '—',
          sub: 'Trading session',
          color: 'text-gray-200',
        },
      ].map(({ label, val, sub, color }) => (
        <div key={label} className="rounded-lg bg-gray-900/60 border border-gray-800 px-3 py-2.5">
          <div className="text-[11px] text-gray-500 mb-0.5">{label}</div>
          <div className={`text-lg font-bold font-mono ${color}`}>{val}</div>
          <div className="text-[10px] text-gray-600 mt-0.5">{sub}</div>
        </div>
      ))}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function TickerScannerPage() {
  const { user } = useApp()
  const [tickers, setTickers] = useState<MyTickerEntry[]>([])
  const [results, setResults] = useState<Map<string, TickerResult>>(new Map())
  const [selected, setSelected] = useState<string | null>(null)
  const [scanState, setScanState] = useState<'idle' | 'running' | 'done'>('idle')
  const [mktCtx, setMktCtx] = useState<MarketContext | null>(null)
  const [loadError, setLoadError] = useState('')
  const abortRef = useRef(false)

  const scan = useCallback(async (list: MyTickerEntry[]) => {
    if (!list.length) return
    abortRef.current = false
    setScanState('running')
    setResults(new Map(list.map(e => [e.symbol, { entry: e, day: null, swing: null, state: 'loading' }])))

    let firstResult: UnifiedAnalysis | null = null
    let firstSym: string | null = null

    for (const entry of list) {
      if (abortRef.current) break
      const sym = entry.symbol
      try {
        const [dayRes, swingRes] = await Promise.allSettled([
          analyzeV2(sym, 'day'),
          analyzeV2(sym, 'swing'),
        ])
        const day   = dayRes.status   === 'fulfilled' ? dayRes.value.data   : null
        const swing = swingRes.status === 'fulfilled' ? swingRes.value.data : null

        if (!firstResult) { firstResult = day ?? swing; firstSym = sym }

        setResults(prev => {
          const next = new Map(prev)
          next.set(sym, { entry, day, swing, state: 'done' })
          return next
        })

        if (firstResult) {
          setMktCtx(prev => prev ?? {
            spyPct:   firstResult!.spy_change_pct,
            vix:      firstResult!.vix,
            vixLabel: firstResult!.vix_label ?? '',
            regime:   firstResult!.regime ?? '',
            session:  firstResult!.session ?? '',
          })
        }
      } catch {
        setResults(prev => {
          const next = new Map(prev)
          const existing = next.get(sym)!
          next.set(sym, { ...existing, state: 'error' })
          return next
        })
      }
    }

    setScanState('done')
    if (firstSym) setSelected(s => s ?? firstSym)
  }, [])  // stable — only uses setters and analyzeV2

  // Fetch tickers on mount then immediately scan
  useEffect(() => {
    fetchMyTickers()
      .then(res => {
        const list = res.data?.tickers ?? []
        setTickers(list)
        scan(list)
      })
      .catch(() => setLoadError('Failed to load your tickers.'))
  }, [scan])

  // Sort: by best verdict then by price change desc
  const sortedResults = [...results.values()].sort((a, b) => {
    const va = VERDICT_ORDER[bestVerdict(a) ?? 'NO_EDGE'] ?? 9
    const vb = VERDICT_ORDER[bestVerdict(b) ?? 'NO_EDGE'] ?? 9
    if (va !== vb) return va - vb
    return (b.entry.price_change_pct ?? 0) - (a.entry.price_change_pct ?? 0)
  })

  const selectedResult = selected ? results.get(selected) ?? null : null

  if (user?.role !== 'admin' && user?.role !== 'super_user') {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-gray-500">
        Admin access required.
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Page header */}
      <div className="flex items-center justify-between mb-5 pb-4 border-b border-gray-800">
        <div>
          <h1 className="text-xl font-semibold text-white">
            Ticker Scanner <span className="text-sm font-normal text-gray-500">— day vs swing verdict</span>
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {tickers.length} tickers from your list · admin only
          </p>
        </div>
        <div className="flex items-center gap-3">
          {scanState === 'running' && (
            <span className="text-xs text-amber-400 font-medium animate-pulse">Scanning…</span>
          )}
          {scanState === 'done' && (
            <span className="text-xs text-emerald-400 font-medium">Scan complete</span>
          )}
          <button
            onClick={() => scan(tickers)}
            disabled={scanState === 'running' || !tickers.length}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
          >
            <RefreshCw size={14} className={scanState === 'running' ? 'animate-spin' : ''} />
            {scanState === 'idle' ? 'Run Scan' : scanState === 'running' ? 'Scanning…' : 'Re-scan'}
          </button>
        </div>
      </div>

      {loadError && (
        <div className="mb-4 p-3 rounded-lg bg-red-900/30 border border-red-700/40 text-red-300 text-sm flex items-center gap-2">
          <AlertTriangle size={14} /> {loadError}
        </div>
      )}

      {/* Market snapshot */}
      <MarketSnapshotBar ctx={mktCtx} />

      {tickers.length === 0 && !loadError ? (
        <div className="text-center py-12 text-gray-500 text-sm">
          No tickers in your list yet. Add some in My Tickers first.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4 items-start">
          {/* ── Left: Watchlist table ── */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/40 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-800 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Watchlist — relative strength
              </span>
              <span className="text-[10px] text-gray-600">sorted by verdict · momentum</span>
            </div>

            <div className="divide-y divide-gray-800/60">
              {sortedResults.map(r => {
                const { entry } = r
                const pct = entry.price_change_pct
                const isUp = pct != null && pct >= 0
                const barW = strengthPct(pct)
                const best = bestVerdict(r)
                const isSelected = selected === entry.symbol

                return (
                  <div key={entry.symbol}>
                    {/* ── Row ── */}
                    <button
                      type="button"
                      onClick={() => setSelected(isSelected ? null : entry.symbol)}
                      className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors ${
                        isSelected ? 'bg-violet-900/20 border-l-2 border-violet-500' : 'hover:bg-gray-800/40 border-l-2 border-transparent'
                      }`}
                    >
                      {/* Symbol */}
                      <span className="font-mono font-semibold text-white min-w-[52px] text-sm">{entry.symbol}</span>

                      {/* Strength bar */}
                      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${isUp ? 'bg-emerald-500' : 'bg-red-500'}`}
                          style={{ width: `${barW}%` }}
                        />
                      </div>

                      {/* Pct change */}
                      <span className={`font-mono text-xs font-semibold min-w-[54px] text-right ${
                        pct == null ? 'text-gray-600' : isUp ? 'text-emerald-400' : 'text-red-400'
                      }`}>
                        {pct == null ? (
                          r.state === 'loading' ? (
                            <span className="inline-block w-4 h-1.5 bg-gray-700 rounded animate-pulse" />
                          ) : '—'
                        ) : fmtPct(pct)}
                      </span>

                      {/* Direction icon */}
                      <span className="text-gray-600">
                        {pct == null ? <Minus size={12} /> : isUp ? <TrendingUp size={12} className="text-emerald-500" /> : <TrendingDown size={12} className="text-red-500" />}
                      </span>

                      {/* Verdict chip */}
                      {r.state === 'loading' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full border border-gray-700/40 bg-gray-800/40 text-[10px] text-gray-600 min-w-[64px] justify-center">
                          <span className="inline-block w-1.5 h-1.5 rounded-full bg-gray-600 animate-pulse mr-1" />
                          scanning
                        </span>
                      ) : best ? (
                        <span className={`inline-flex px-2 py-0.5 rounded-full border text-[10px] font-semibold min-w-[64px] justify-center ${verdictChipClass(best)}`}>
                          {verdictLabel(best)}
                        </span>
                      ) : (
                        <span className="inline-flex px-2 py-0.5 rounded-full border border-gray-700/30 bg-gray-800/30 text-[10px] text-gray-600 min-w-[64px] justify-center">
                          {r.state === 'error' ? 'Error' : '—'}
                        </span>
                      )}

                      {/* Trade type badges — desktop only */}
                      <div className="hidden lg:flex gap-1 min-w-[80px] justify-end">
                        {entry.trade_types.map(t => {
                          const href =
                            t === 'day'     ? `/day-trade?ticker=${entry.symbol}`
                            : t === 'swing'   ? `/swing-trade?ticker=${entry.symbol}`
                            : t === 'regular' ? `/position-trading?ticker=${entry.symbol}`
                            : null
                          const cls = `px-1.5 py-0.5 rounded text-[9px] font-semibold transition-opacity ${
                            t === 'day'     ? 'bg-blue-900/40 text-blue-300 hover:bg-blue-800/60'
                            : t === 'swing'   ? 'bg-green-900/40 text-green-300 hover:bg-green-800/60'
                            : t === 'regular' ? 'bg-violet-900/40 text-violet-300 hover:bg-violet-800/60'
                            : 'bg-gray-800/50 text-gray-500'
                          }`
                          return href ? (
                            <a key={t} href={href} target="_blank" rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()} className={cls}
                              title={`Open ${entry.symbol} in ${t} trade page`}>
                              {t} ↗
                            </a>
                          ) : (
                            <span key={t} className={cls}>{t}</span>
                          )
                        })}
                      </div>

                      {/* Expand chevron — mobile/tablet only */}
                      <ChevronDown
                        size={14}
                        className={`lg:hidden text-gray-500 transition-transform shrink-0 ${isSelected ? 'rotate-180' : ''}`}
                      />
                    </button>

                    {/* ── Inline detail panel — mobile/tablet only ── */}
                    {isSelected && (
                      <div className="lg:hidden px-3 pb-3">
                        <SignalPanel result={r} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── Right: Signal breakdown panel — desktop only ── */}
          <div className="hidden lg:block">
            {selectedResult ? (
              <SignalPanel result={selectedResult} />
            ) : (
              <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-6 text-center text-sm text-gray-500">
                Click a ticker to see its signal breakdown
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Decision matrix ── */}
      <div className="mt-6">
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
      <div className="mt-4 rounded-xl border-l-4 border-l-gray-600 border border-gray-800 bg-gray-900/40 p-5 space-y-3">
        <h3 className="text-sm font-semibold text-white mb-1">What traders actually do — honest breakdown</h3>
        {[
          { icon: '▶', color: 'text-blue-400',   text: <><strong className="text-white">Day traders</strong> scan for high RVOL (3×+), wide ATR with room remaining, price above VWAP, and clean 5-min higher-high / higher-low structure. Large caps (NVDA, TSLA) are preferred — they respect levels and have tight spreads.</> },
          { icon: '▶', color: 'text-green-400',  text: <><strong className="text-white">Swing traders</strong> ignore intraday noise entirely. They want price above the 21 EMA on the daily, weekly trend intact, and a 3:1+ R/R to the next resistance. They check earnings dates and sector rotation. RVOL is noise to them.</> },
          { icon: '⚠', color: 'text-amber-400',  text: <><strong className="text-white">The actual problem:</strong> Most traders use one watchlist for both styles and lose on both. A ticker squeezing intraday is usually the worst swing entry — the move is extended.</> },
          { icon: '✕', color: 'text-red-400',    text: <><strong className="text-white">Skip both styles when:</strong> Stock in confirmed downtrend, earnings within 2 weeks (swing), spread wider than 0.1% (day), market context is red, or you have no defined catalyst.</> },
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
