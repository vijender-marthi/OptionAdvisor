import { useState, useMemo, useRef } from 'react'
import {
  FlaskConical, Play, RefreshCw, ChevronDown, ChevronUp,
  TrendingUp, TrendingDown, Activity, BarChart3, AlertTriangle,
  CheckCircle2, XCircle, MinusCircle, Info, MonitorPlay,
} from 'lucide-react'
import { runBacktest } from '../api/client'
import type { BacktestResult, BacktestTrade, BacktestEquityPoint } from '../types'
import { MULTI_WEEK_TARGETS } from '../data/stockUniverse'
import IntradayReplay from '../components/IntradayReplay'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt$(n: number, decimals = 0): string {
  const abs = Math.abs(n)
  const str = abs.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  return (n < 0 ? '−$' : '$') + str
}

function fmtPct(n: number, decimals = 1): string {
  return (n >= 0 ? '+' : '') + n.toFixed(decimals) + '%'
}

const EXIT_LABELS: Record<string, string> = {
  PROFIT_TARGET: '50% Profit',
  STOP_LOSS:     'Stop Loss',
  '21DTE':       '21 DTE',
  '5DTE':        '5 DTE',
  EXPIRY:        'Expiry',
  NO_DATA:       'No Data',
}

const STRATEGY_COLORS: Record<string, string> = {
  'Bull Put Spread':  '#10b981',
  'Bear Call Spread': '#f43f5e',
  'Iron Condor':      '#8b5cf6',
  'Bull Call Spread': '#06b6d4',
  'Bear Put Spread':  '#f97316',
  'Long Straddle':    '#a855f7',
  'Long Call':        '#22c55e',
  'Long Put':         '#ef4444',
  'Short Put':        '#eab308',
  'Covered Call':     '#64748b',
}

function strategyColor(s: string): string {
  return STRATEGY_COLORS[s] ?? '#6b7280'
}

// ─── Equity Curve SVG ────────────────────────────────────────────────────────

function EquityCurve({ points }: { points: BacktestEquityPoint[] }) {
  if (points.length === 0) return null

  const W = 800, H = 260
  const PAD = { top: 20, right: 20, bottom: 36, left: 68 }
  const IW = W - PAD.left - PAD.right
  const IH = H - PAD.top - PAD.bottom

  const pnls  = points.map(p => p.cumulative_pnl)
  const minPnl = Math.min(0, ...pnls)
  const maxPnl = Math.max(0, ...pnls)
  const range  = maxPnl - minPnl || 1

  const xOf = (i: number) => PAD.left + (i / Math.max(points.length - 1, 1)) * IW
  const yOf = (v: number) => PAD.top + IH - ((v - minPnl) / range) * IH
  const y0   = yOf(0)

  // Build polyline
  const pts = points.map((p, i) => `${xOf(i)},${yOf(p.cumulative_pnl)}`).join(' ')

  // Y-axis labels (5 ticks)
  const yTicks = Array.from({ length: 5 }, (_, i) => {
    const val = minPnl + (range / 4) * i
    return { val, y: yOf(val) }
  })

  // X-axis labels — pick ~6 evenly spaced dates
  const xStep = Math.max(1, Math.floor(points.length / 6))
  const xTicks = points
    .filter((_, i) => i % xStep === 0 || i === points.length - 1)
    .map((p, i, arr) => ({
      label: p.date.slice(0, 7),  // YYYY-MM
      x: xOf(points.indexOf(p)),
    }))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full backtest-equity-chart" style={{ maxHeight: 260 }}>
      {/* Zero line */}
      <line x1={PAD.left} y1={y0} x2={W - PAD.right} y2={y0}
            className="backtest-equity-grid" strokeWidth={1} strokeDasharray="4 3" />

      {/* Shaded area under curve */}
      <defs>
        <linearGradient id="bg-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#10b981" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
        </linearGradient>
        <clipPath id="above-zero">
          <rect x={PAD.left} y={PAD.top} width={IW} height={y0 - PAD.top} />
        </clipPath>
        <clipPath id="below-zero">
          <rect x={PAD.left} y={y0} width={IW} height={H - PAD.bottom - y0} />
        </clipPath>
      </defs>

      {/* Area fill above zero */}
      <polygon
        points={`${PAD.left},${y0} ${pts} ${W - PAD.right},${y0}`}
        fill="url(#bg-grad)" clipPath="url(#above-zero)" />

      {/* Area fill below zero */}
      <polygon
        points={`${PAD.left},${y0} ${pts} ${W - PAD.right},${y0}`}
        fill="#ef4444" fillOpacity="0.08" clipPath="url(#below-zero)" />

      {/* Main line */}
      <polyline points={pts} fill="none" stroke="#10b981" strokeWidth={2} strokeLinejoin="round" />

      {/* Trade dots */}
      {points.map((p, i) => {
        const clr = p.trade_pnl > 0 ? '#10b981' : p.trade_pnl < 0 ? '#ef4444' : '#6b7280'
        return (
          <circle key={i} cx={xOf(i)} cy={yOf(p.cumulative_pnl)} r={3}
                  fill={clr} className="backtest-equity-dot-ring" strokeWidth={1} />
        )
      })}

      {/* Y-axis ticks */}
      {yTicks.map(({ val, y }, i) => (
        <g key={i}>
          <line x1={PAD.left - 4} y1={y} x2={PAD.left} y2={y} className="backtest-equity-tick" strokeWidth={1} />
          <text x={PAD.left - 8} y={y + 4} textAnchor="end" fontSize={9} className="backtest-equity-label">
            {fmt$(val)}
          </text>
        </g>
      ))}

      {/* X-axis ticks */}
      {xTicks.map(({ label, x }, i) => (
        <g key={i}>
          <line x1={x} y1={H - PAD.bottom} x2={x} y2={H - PAD.bottom + 4} className="backtest-equity-tick" strokeWidth={1} />
          <text x={x} y={H - PAD.bottom + 14} textAnchor="middle" fontSize={9} className="backtest-equity-label">
            {label}
          </text>
        </g>
      ))}

      {/* Axes */}
      <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={H - PAD.bottom}
            className="backtest-equity-axis" strokeWidth={1} />
      <line x1={PAD.left} y1={H - PAD.bottom} x2={W - PAD.right} y2={H - PAD.bottom}
            className="backtest-equity-axis" strokeWidth={1} />
    </svg>
  )
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, color = 'text-white', icon,
}: {
  label: string; value: string; sub?: string
  color?: string; icon: React.ReactNode
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 sm:p-4 flex flex-col gap-1 min-h-[4.5rem] sm:min-h-0">
      <div className="flex items-center gap-1.5 text-gray-500 text-[11px] sm:text-xs font-medium">
        {icon}
        {label}
      </div>
      <div className={`text-base sm:text-xl font-bold ${color} break-words`}>{value}</div>
      {sub && <div className="text-xs text-gray-500">{sub}</div>}
    </div>
  )
}

// ─── Trade Row ────────────────────────────────────────────────────────────────

function TradeRow({ t, expanded, onToggle }: {
  t: BacktestTrade; expanded: boolean; onToggle: () => void
}) {
  const win  = t.outcome === 'WIN'
  const loss = t.outcome === 'LOSS'

  return (
    <>
      <tr
        className="border-b border-gray-800/60 hover:bg-gray-800/30 cursor-pointer text-sm"
        onClick={onToggle}
      >
        <td className="px-2 py-2 sm:px-3 sm:py-2.5 text-gray-400 whitespace-nowrap text-xs sm:text-sm">{t.entry_date}</td>
        <td className="px-2 py-2 sm:px-3 sm:py-2.5 text-gray-400 whitespace-nowrap text-xs sm:text-sm">{t.exit_date}</td>
        <td className="px-2 py-2 sm:px-3 sm:py-2.5 max-w-[8rem] sm:max-w-none">
          <span
            className="px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-semibold line-clamp-2 sm:line-clamp-none"
            style={{
              background: strategyColor(t.strategy) + '22',
              color:      strategyColor(t.strategy),
              border:     `1px solid ${strategyColor(t.strategy)}44`,
            }}
          >
            {t.strategy}
          </span>
        </td>
        <td className="px-2 py-2 sm:px-3 sm:py-2.5 text-gray-400 text-[10px] sm:text-xs">{t.dte_at_entry}d</td>
        <td className="px-2 py-2 sm:px-3 sm:py-2.5 text-gray-300 text-xs sm:text-sm">${t.underlying_entry.toFixed(2)}</td>
        <td className="px-2 py-2 sm:px-3 sm:py-2.5 text-gray-300 text-xs sm:text-sm">${t.underlying_exit.toFixed(2)}</td>
        <td className={`px-2 py-2 sm:px-3 sm:py-2.5 font-semibold text-xs sm:text-sm ${win ? 'text-emerald-400' : loss ? 'text-red-400' : 'text-gray-400'}`}>
          {fmt$(t.pnl_dollar)}
        </td>
        <td className="px-2 py-2 sm:px-3 sm:py-2.5 text-gray-500 text-[10px] sm:text-xs whitespace-nowrap">
          {EXIT_LABELS[t.exit_reason] ?? t.exit_reason}
        </td>
        <td className="px-2 py-2 sm:px-3 sm:py-2.5">
          {win  && <span className="inline-flex items-center gap-1 text-[10px] sm:text-xs text-emerald-400"><CheckCircle2 size={12} /> Win</span>}
          {loss && <span className="inline-flex items-center gap-1 text-[10px] sm:text-xs text-red-400"><XCircle size={12} /> Loss</span>}
          {!win && !loss && <span className="inline-flex items-center gap-1 text-[10px] sm:text-xs text-gray-500"><MinusCircle size={12} /> Even</span>}
        </td>
        <td className="px-2 py-2 sm:px-3 sm:py-2.5 text-gray-600">
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-gray-800/60 bg-gray-900/40">
          <td colSpan={10} className="px-3 py-3 sm:px-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs mb-3">
              <div>
                <div className="text-gray-500 mb-0.5">Bias / Confidence</div>
                <div className="text-gray-300">{t.directional_bias} · {t.bias_confidence}%</div>
              </div>
              <div>
                <div className="text-gray-500 mb-0.5">IV Rank</div>
                <div className="text-gray-300">{t.iv_rank.toFixed(0)}</div>
              </div>
              <div>
                <div className="text-gray-500 mb-0.5">Vol Regime</div>
                <div className="text-gray-300">{t.volatility_regime}</div>
              </div>
              <div>
                <div className="text-gray-500 mb-0.5">IV Environment</div>
                <div className="text-gray-300">{t.iv_environment}</div>
              </div>
              <div>
                <div className="text-gray-500 mb-0.5">Max Profit</div>
                <div className="text-emerald-400">{fmt$(t.max_profit * 100, 2)}</div>
              </div>
              <div>
                <div className="text-gray-500 mb-0.5">Max Loss</div>
                <div className="text-red-400">{fmt$(t.max_loss * 100, 2)}</div>
              </div>
              <div>
                <div className="text-gray-500 mb-0.5">P&L % of Max</div>
                <div className={t.pnl_pct_of_max >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                  {t.pnl_pct_of_max.toFixed(1)}%
                </div>
              </div>
              <div>
                <div className="text-gray-500 mb-0.5">Credit / Debit</div>
                <div className="text-gray-300">{t.is_credit ? 'Credit' : 'Debit'}</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {t.legs.map((leg, i) => (
                <div key={i} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs">
                  <span className={leg.action === 'BUY' ? 'text-emerald-400' : 'text-red-400'}>
                    {leg.action}
                  </span>
                  <span className="text-gray-300 ml-1.5">
                    ${leg.strike} {leg.option_type}
                  </span>
                  <span className="text-gray-500 ml-1.5">
                    @ ${leg.entry_price.toFixed(2)} · Δ{leg.delta.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const WEEK_OPTS = [...MULTI_WEEK_TARGETS]
const WIDTH_OPTS: { label: string; value: number | null }[] = [
  { label: 'Auto', value: null },
  { label: '$5',   value: 5 },
  { label: '$10',  value: 10 },
  { label: '$20',  value: 20 },
  { label: '$50',  value: 50 },
]
const MODE_OPTS = [
  { label: 'All Strategies', value: 'all' },
  { label: 'Credit Only',    value: 'credit_only' },
  { label: 'Long Only',      value: 'long_only' },
  { label: 'Short/Covered',  value: 'short_or_covered' },
]
const RANGE_PRESETS = [
  { label: '1Y', months: 12 },
  { label: '2Y', months: 24 },
  { label: '3Y', months: 36 },
]

function toDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

type BTab = 'options' | 'replay'

export default function BacktestPage() {
  const [btab, setBtab] = useState<BTab>('options')
  const today = new Date()

  // Controls
  const [ticker,    setTicker]    = useState('SPY')
  const [startDate, setStartDate] = useState(toDate(new Date(today.getFullYear() - 2, today.getMonth(), today.getDate())))
  const [endDate,   setEndDate]   = useState(toDate(today))
  const [mode,      setMode]      = useState('all')
  const [weeksOut,  setWeeksOut]  = useState(4)
  const [width,     setWidth]     = useState<number | null>(null)

  // State
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [result,    setResult]    = useState<BacktestResult | null>(null)

  // Trade table
  const [stratFilter, setStratFilter] = useState('All')
  const [outcomeFilter, setOutcomeFilter] = useState('All')
  const [sortCol,  setSortCol]    = useState<string>('entry_date')
  const [sortAsc,  setSortAsc]    = useState(true)
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set())

  // Ref for scrolling to results
  const resultsRef = useRef<HTMLDivElement>(null)

  function applyPreset(months: number) {
    const start = new Date(today)
    start.setMonth(start.getMonth() - months)
    setStartDate(toDate(start))
    setEndDate(toDate(today))
  }

  async function handleRun() {
    const t = ticker.trim().toUpperCase()
    if (!t) return
    setLoading(true)
    setError(null)
    setResult(null)
    setExpandedRows(new Set())
    try {
      const data = await runBacktest({
        ticker: t,
        start_date: startDate,
        end_date: endDate,
        strategy_mode: mode,
        weeks_out: weeksOut,
        spread_width: width,
      })
      setResult(data)
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
    } catch (e: any) {
      const msg = e?.response?.data?.detail ?? e?.message ?? 'Backtest failed'
      setError(typeof msg === 'string' ? msg : JSON.stringify(msg))
    } finally {
      setLoading(false)
    }
  }

  function toggleSort(col: string) {
    if (sortCol === col) setSortAsc(a => !a)
    else { setSortCol(col); setSortAsc(true) }
  }

  const filteredTrades = useMemo(() => {
    if (!result) return []
    let trades = result.trades
    if (stratFilter !== 'All')   trades = trades.filter(t => t.strategy === stratFilter)
    if (outcomeFilter !== 'All') trades = trades.filter(t => t.outcome  === outcomeFilter)
    return [...trades].sort((a, b) => {
      const va = (a as any)[sortCol] ?? ''
      const vb = (b as any)[sortCol] ?? ''
      return sortAsc
        ? (va < vb ? -1 : va > vb ? 1 : 0)
        : (va > vb ? -1 : va < vb ? 1 : 0)
    })
  }, [result, stratFilter, outcomeFilter, sortCol, sortAsc])

  const strategies = result ? Object.keys(result.by_strategy) : []

  function SortTh({ col, label }: { col: string; label: string }) {
    return (
      <th
        className="px-2 py-2 sm:px-3 sm:py-2.5 text-left text-[10px] sm:text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-gray-300 whitespace-nowrap"
        onClick={() => toggleSort(col)}
      >
        {label}
        {sortCol === col && (
          <span className="ml-1">{sortAsc ? '↑' : '↓'}</span>
        )}
      </th>
    )
  }

  return (
    <div className="backtest-page min-h-screen p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-4 sm:space-y-5">

        {/* ── Header ─────────────────────────────────────────── */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-600/20 border border-violet-700 flex items-center justify-center shrink-0">
              <FlaskConical size={20} className="text-violet-400" />
            </div>
            <div className="min-w-0">
              <h1 className="tcc-hero-title text-2xl font-bold tracking-tight text-heading">Backtest Lab</h1>
              <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
                Options simulation · Intraday replay
              </p>
            </div>
          </div>
        </div>

        {/* ── Tab switcher ───────────────────────────────────── */}
        <div className="flex gap-2">
          {([
            { id: 'options' as BTab, label: 'Options Sim', icon: <FlaskConical size={13} /> },
            { id: 'replay'  as BTab, label: 'Intraday Replay', icon: <MonitorPlay size={13} /> },
          ]).map(tab => (
            <button
              key={tab.id}
              onClick={() => setBtab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                btab === tab.id
                  ? 'bg-violet-600/20 border-violet-600 text-violet-300'
                  : 'bg-gray-900 border-gray-800 text-gray-500 hover:border-gray-700 hover:text-gray-300'
              }`}
            >
              {tab.icon}{tab.label}
            </button>
          ))}
        </div>

        {/* ── Intraday Replay tab ────────────────────────────── */}
        {btab === 'replay' && <IntradayReplay />}

        {/* ── Options Sim tab ────────────────────────────────── */}
        {btab === 'options' && <>

        {/* ── Controls ───────────────────────────────────────── */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 sm:p-5 space-y-4">

          {/* Row 1: Ticker + Date Range */}
          <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
            {/* Ticker */}
            <div className="flex flex-col gap-1.5 w-full sm:w-auto">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Ticker</label>
              <input
                type="text"
                value={ticker}
                onChange={e => setTicker(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && handleRun()}
                placeholder="SPY"
                className="w-full max-w-[10rem] sm:max-w-none sm:w-28 px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm font-mono uppercase focus:outline-none focus:border-violet-500"
              />
            </div>

            {/* Date range presets */}
            <div className="flex flex-col gap-1.5 min-w-0 flex-1 sm:flex-initial">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Preset</label>
              <div className="mobile-tab-scroll flex gap-1 -mx-1 px-1 overflow-x-auto pb-0.5">
                {RANGE_PRESETS.map(p => (
                  <button
                    key={p.label}
                    onClick={() => applyPreset(p.months)}
                    className="shrink-0 px-3 py-2.5 rounded-lg text-sm font-semibold bg-gray-800 border border-gray-700 text-gray-300 hover:border-violet-600 hover:text-violet-300 transition-colors"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Start date */}
            <div className="flex flex-col gap-1.5 w-full sm:w-auto sm:min-w-[10.5rem]">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">From</label>
              <input
                type="date"
                value={startDate}
                max={endDate}
                onChange={e => setStartDate(e.target.value)}
                className="w-full min-w-0 px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-200 text-sm focus:outline-none focus:border-violet-500"
              />
            </div>

            {/* End date */}
            <div className="flex flex-col gap-1.5 w-full sm:w-auto sm:min-w-[10.5rem]">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">To</label>
              <input
                type="date"
                value={endDate}
                min={startDate}
                max={toDate(today)}
                onChange={e => setEndDate(e.target.value)}
                className="w-full min-w-0 px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-200 text-sm focus:outline-none focus:border-violet-500"
              />
            </div>
          </div>

          {/* Row 2: Strategy params + Run */}
          <div className="flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-end">
            {/* Strategy mode */}
            <div className="flex flex-col gap-1.5 min-w-0 flex-1">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Strategy Mode</label>
              <div className="mobile-tab-scroll flex flex-nowrap overflow-x-auto gap-1 -mx-1 px-1 pb-0.5">
                {MODE_OPTS.map(o => (
                  <button
                    key={o.value}
                    onClick={() => setMode(o.value)}
                    className={`shrink-0 px-2.5 sm:px-3 py-2 rounded-lg text-[11px] sm:text-xs font-semibold border transition-colors ${
                      mode === o.value
                        ? 'bg-violet-600/20 border-violet-600 text-violet-300'
                        : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Weeks out */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">DTE Target</label>
              <div className="mobile-tab-scroll flex gap-1 overflow-x-auto pb-0.5 -mx-1 px-1">
                {WEEK_OPTS.map(w => (
                  <button
                    key={w}
                    onClick={() => setWeeksOut(w)}
                    className={`shrink-0 min-w-[2.5rem] px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                      weeksOut === w
                        ? 'bg-violet-600/20 border-violet-600 text-violet-300'
                        : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
                    }`}
                  >
                    {w}w
                  </button>
                ))}
              </div>
            </div>

            {/* Spread width */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Spread Width</label>
              <div className="mobile-tab-scroll flex gap-1 overflow-x-auto pb-0.5 -mx-1 px-1">
                {WIDTH_OPTS.map(o => (
                  <button
                    key={String(o.value)}
                    onClick={() => setWidth(o.value)}
                    className={`shrink-0 px-2.5 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                      width === o.value
                        ? 'bg-violet-600/20 border-violet-600 text-violet-300'
                        : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Run button */}
            <button
              onClick={handleRun}
              disabled={loading}
              className="w-full lg:w-auto lg:shrink-0 px-6 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors min-h-[44px]"
            >
              {loading
                ? <><RefreshCw size={15} className="animate-spin" /> Running…</>
                : <><Play size={15} /> Run Backtest</>}
            </button>
          </div>

          {/* Info strip */}
          <div className="flex items-start gap-2 text-xs text-gray-600 bg-gray-800/40 rounded-lg px-3 py-2">
            <Info size={12} className="mt-0.5 shrink-0 text-gray-600" />
            <span>
              Prices are synthetic — options valued via Black-Scholes using HV-20 × 1.15 as IV proxy.
              Credit exits at 50% profit or 2× loss or 21 DTE. Debit exits at 100% gain or 50% loss or 5 DTE.
              Backtesting uses 1 contract (100 shares) per trade signal.
            </span>
          </div>
        </div>

        {/* ── Error ──────────────────────────────────────────── */}
        {error && (
          <div className="bg-red-950/40 border border-red-800 rounded-xl p-4 flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-400 shrink-0 mt-0.5" />
            <div>
              <div className="text-red-300 font-semibold text-sm mb-0.5">Backtest Error</div>
              <div className="text-red-400 text-xs">{error}</div>
            </div>
          </div>
        )}

        {/* ── Results ────────────────────────────────────────── */}
        {result && (
          <div ref={resultsRef} className="space-y-5">

            {/* Summary header */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="text-xs sm:text-sm text-gray-400 min-w-0 break-words">
                <span className="text-white font-semibold">{result.ticker}</span>
                {' · '}{result.start_date} → {result.end_date}
                {' · '}{result.total_trades} trades across{' '}
                {Object.keys(result.by_strategy).length} strategy types
              </div>
              <button
                type="button"
                onClick={handleRun}
                disabled={loading}
                aria-label={loading ? 'Re-running backtest' : 'Re-run backtest with same settings'}
                title={loading ? 'Running…' : 'Re-run backtest'}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-gray-400 bg-gray-800 border border-gray-700 hover:text-white hover:border-gray-500 transition-colors disabled:opacity-50"
              >
                <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>

            {/* ── Stat Cards ───────────────────────────────────── */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
              <StatCard
                label="Win Rate"
                value={`${result.win_rate.toFixed(1)}%`}
                sub={`${result.winning_trades}W / ${result.losing_trades}L`}
                color={result.win_rate >= 50 ? 'text-emerald-400' : 'text-red-400'}
                icon={<Activity size={11} />}
              />
              <StatCard
                label="Total P&L"
                value={fmt$(result.total_pnl)}
                color={result.total_pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}
                icon={result.total_pnl >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
              />
              <StatCard
                label="Avg / Trade"
                value={fmt$(result.avg_pnl_per_trade)}
                sub={`W: ${fmt$(result.avg_pnl_winners)} · L: ${fmt$(result.avg_pnl_losers)}`}
                color={result.avg_pnl_per_trade >= 0 ? 'text-emerald-400' : 'text-red-400'}
                icon={<BarChart3 size={11} />}
              />
              <StatCard
                label="Sharpe Ratio"
                value={result.sharpe_ratio.toFixed(2)}
                color={result.sharpe_ratio >= 1 ? 'text-emerald-400' : result.sharpe_ratio >= 0 ? 'text-amber-400' : 'text-red-400'}
                icon={<Activity size={11} />}
              />
              <StatCard
                label="Max Drawdown"
                value={fmt$(result.max_drawdown)}
                color="text-red-400"
                icon={<TrendingDown size={11} />}
              />
              <StatCard
                label="Profit Factor"
                value={result.profit_factor >= 99 ? '∞' : result.profit_factor.toFixed(2)}
                sub="Gross Win / Gross Loss"
                color={result.profit_factor >= 1.5 ? 'text-emerald-400' : result.profit_factor >= 1 ? 'text-amber-400' : 'text-red-400'}
                icon={<BarChart3 size={11} />}
              />
            </div>

            {/* ── Equity Curve + By-Strategy ───────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

              {/* Equity curve */}
              <div className="lg:col-span-3 bg-gray-900 border border-gray-800 rounded-2xl p-4 sm:p-5 min-w-0">
                <div className="text-sm font-semibold text-gray-300 mb-3">Cumulative P&L</div>
                <EquityCurve points={result.equity_curve} />
                <div className="flex gap-4 mt-3 flex-wrap">
                  <div className="flex items-center gap-1.5 text-xs text-gray-500">
                    <span className="w-3 h-0.5 bg-emerald-500 inline-block rounded" /> Equity curve
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-gray-500">
                    <span className="w-2 h-2 bg-emerald-500 rounded-full inline-block" /> Win
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-gray-500">
                    <span className="w-2 h-2 bg-red-500 rounded-full inline-block" /> Loss
                  </div>
                </div>
              </div>

              {/* By-strategy breakdown */}
              <div className="lg:col-span-2 bg-gray-900 border border-gray-800 rounded-2xl p-4 sm:p-5 min-w-0">
                <div className="text-sm font-semibold text-gray-300 mb-3">By Strategy</div>
                <div className="space-y-2">
                  {strategies.length === 0 && (
                    <div className="text-xs text-gray-600">No trades generated.</div>
                  )}
                  {strategies.map(s => {
                    const st = result.by_strategy[s]
                    return (
                      <div key={s} className="bg-gray-800/60 border border-gray-700/60 rounded-xl px-3 py-2.5">
                        <div className="flex items-center justify-between mb-1.5">
                          <span
                            className="text-xs font-semibold"
                            style={{ color: strategyColor(s) }}
                          >
                            {s}
                          </span>
                          <span className={`text-xs font-bold ${st.total_pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {fmt$(st.total_pnl)}
                          </span>
                        </div>
                        <div className="flex justify-between text-xs text-gray-500">
                          <span>{st.count} trades · {st.win_rate}% win</span>
                          <span>{fmt$(st.avg_pnl)} avg</span>
                        </div>
                        {/* Win-rate bar */}
                        <div className="mt-1.5 h-1 bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${st.win_rate}%`,
                              background: strategyColor(s),
                            }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* ── Trade Log ────────────────────────────────────── */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
              <div className="px-3 py-3 sm:px-5 sm:py-4 border-b border-gray-800 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm font-semibold text-gray-300 min-w-0">
                  Trade Log
                  <span className="ml-0 sm:ml-2 mt-1 sm:mt-0 block sm:inline text-xs font-normal text-gray-600">
                    {filteredTrades.length} of {result.trades.length} trades
                  </span>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center w-full sm:w-auto">
                  {/* Strategy filter */}
                  <select
                    value={stratFilter}
                    onChange={e => setStratFilter(e.target.value)}
                    className="w-full sm:w-auto min-w-0 max-w-full sm:max-w-[14rem] px-2.5 py-2 rounded-lg bg-gray-800 border border-gray-700 text-xs text-gray-300 focus:outline-none focus:border-violet-500"
                  >
                    <option value="All">All strategies</option>
                    {strategies.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  {/* Outcome filter */}
                  <div className="flex gap-1 shrink-0">
                    {['All', 'WIN', 'LOSS'].map(o => (
                      <button
                        key={o}
                        onClick={() => setOutcomeFilter(o)}
                        className={`px-2.5 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                          outcomeFilter === o
                            ? o === 'WIN'  ? 'bg-emerald-900/40 border-emerald-700 text-emerald-300'
                            : o === 'LOSS' ? 'bg-red-900/40 border-red-800 text-red-300'
                                           : 'bg-violet-600/20 border-violet-600 text-violet-300'
                            : 'bg-gray-800 border-gray-700 text-gray-500 hover:border-gray-600'
                        }`}
                      >
                        {o === 'All' ? 'All' : o === 'WIN' ? '✓ Win' : '✗ Loss'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto touch-pan-x">
                <table className="w-full text-sm min-w-[640px]">
                  <thead>
                    <tr className="border-b border-gray-800 bg-gray-900">
                      <SortTh col="entry_date" label="Entry" />
                      <SortTh col="exit_date"  label="Exit" />
                      <SortTh col="strategy"   label="Strategy" />
                      <SortTh col="dte_at_entry" label="DTE" />
                      <SortTh col="underlying_entry" label="Entry $" />
                      <SortTh col="underlying_exit"  label="Exit $" />
                      <SortTh col="pnl_dollar" label="P&L" />
                      <th className="px-2 py-2 sm:px-3 sm:py-2.5 text-left text-[10px] sm:text-xs font-semibold text-gray-500 uppercase tracking-wide">Exit Reason</th>
                      <th className="px-2 py-2 sm:px-3 sm:py-2.5 text-left text-[10px] sm:text-xs font-semibold text-gray-500 uppercase tracking-wide">Outcome</th>
                      <th className="px-2 py-2 sm:px-3 sm:py-2.5 w-6" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTrades.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="px-4 py-8 text-center text-sm text-gray-600">
                          No trades match the current filters.
                        </td>
                      </tr>
                    ) : (
                      filteredTrades.map((t, i) => (
                        <TradeRow
                          key={i}
                          t={t}
                          expanded={expandedRows.has(i)}
                          onToggle={() => {
                            setExpandedRows(prev => {
                              const next = new Set(prev)
                              next.has(i) ? next.delete(i) : next.add(i)
                              return next
                            })
                          }}
                        />
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Methodology note */}
            <div className="flex items-start gap-2 text-xs text-gray-700 px-1">
              <Info size={12} className="mt-0.5 shrink-0" />
              <span>
                This backtest uses synthetic option pricing (Black-Scholes with HV-20 × 1.15 as IV proxy).
                Results are indicative — actual trading results may differ due to liquidity, real IV levels,
                slippage, and early assignment risk. Past performance is not indicative of future results.
              </span>
            </div>

          </div>
        )}

        {/* Empty state before first run */}
        {!result && !loading && !error && (
          <div className="bg-gray-900/50 border border-gray-800/60 rounded-2xl p-8 sm:p-12 text-center max-w-lg mx-auto">
            <FlaskConical size={40} className="text-violet-700 mx-auto mb-4" />
            <div className="text-gray-400 font-semibold mb-1">Ready to test</div>
            <div className="text-gray-600 text-sm">
              Configure the controls above and press <strong className="text-gray-400">Run Backtest</strong>.
              <br />Simulation typically takes 5–30 seconds depending on date range.
            </div>
          </div>
        )}

        </>}

      </div>
    </div>
  )
}
