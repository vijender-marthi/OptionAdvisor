import { ArrowDownRight, ArrowUpRight, Filter, RefreshCw, Search, X } from 'lucide-react'
import { useState } from 'react'
import type { PositionScannerData, PositionScannerRow } from '../../types/positionWorkspace'
import { AvailabilityBadge, Skeleton, display, percent } from './shared'

export type PositionFilters = {
  weeksOut: 2 | 4 | 6 | 8
  strategyTypes: string[]
  riskProfile: 'conservative' | 'balanced' | 'aggressive'
  ivRank: number
  pop: number
  expectedReturn: number
  dte: number
  minConfidence: number
}

const holdingPeriods: Array<{ value: PositionFilters['weeksOut']; label: string; detail: string }> = [
  { value: 2, label: '1–2 Weeks', detail: '7–14 DTE' },
  { value: 4, label: '3–4 Weeks', detail: '15–28 DTE' },
  { value: 6, label: '5–6 Weeks', detail: '29–42 DTE' },
  { value: 8, label: '7–8 Weeks', detail: '43–56 DTE' },
]

const strategies = ['Long Call', 'Bull Call Spread', 'Bear Put Spread', 'Covered Call', 'Calendar Spread', 'Iron Condor', 'Diagonal', 'Iron Butterfly']
const riskProfiles: PositionFilters['riskProfile'][] = ['conservative', 'balanced', 'aggressive']

function scannerMode(filters: PositionFilters): string {
  return filters.strategyTypes.length === 0 || filters.strategyTypes.length === strategies.length
    ? 'all'
    : filters.strategyTypes.join(',')
}

export function positionFiltersToQuery(filters: PositionFilters) {
  return {
    weeks_out: filters.weeksOut,
    strategy_mode: scannerMode(filters),
    risk_profile: filters.riskProfile,
    iv_rank_min: filters.ivRank,
    pop_min: filters.pop,
    expected_return_min: filters.expectedReturn,
    dte_max: filters.dte,
    min_confidence: filters.minConfidence,
  }
}

function Slider({ label, value, suffix, min, max, onChange }: { label: string; value: number; suffix?: string; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <label className="grid gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-white/[0.07] dark:bg-slate-950/70">
      <div className="flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-wider text-secondary">
        <span>{label}</span>
        <span className="font-mono text-primary">{value}{suffix ?? ''}</span>
      </div>
      <input type="range" min={min} max={max} value={value} onChange={event => onChange(Number(event.target.value))} className="accent-violet-500" />
    </label>
  )
}

function OpportunityRow({ row, selectedSymbol, onSelect }: { row: PositionScannerRow; selectedSymbol: string; onSelect: (symbol: string) => void }) {
  const symbol = row.symbol || ''
  const active = symbol === selectedSymbol
  const bearish = String(row.bias || row.trend || '').toLowerCase().includes('bear')
  const Icon = bearish ? ArrowDownRight : ArrowUpRight
  return (
    <button
      type="button"
      disabled={!symbol}
      onClick={() => onSelect(symbol)}
      className={`w-full rounded-lg border px-3 py-2.5 text-left transition ${active ? 'border-violet-500 bg-violet-500/15 shadow-[0_0_0_1px_rgba(139,92,246,0.35)]' : 'border-slate-200 bg-white hover:border-violet-300 dark:border-white/[0.07] dark:bg-slate-950/60 dark:hover:border-violet-400/50'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon size={14} className={bearish ? 'text-red-400' : 'text-emerald-400'} />
            <span className="font-mono text-sm font-bold text-primary">{display(symbol)}</span>
            {row.data_quality && row.data_quality !== 'available' ? <AvailabilityBadge value={row.data_quality} /> : null}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-secondary">{display(row.company)}</div>
        </div>
        <div className="rounded-md bg-emerald-500/10 px-2 py-1 text-center">
          <div className="font-mono text-sm font-bold text-emerald-400">{display(row.position_score)}</div>
          <div className="text-[9px] uppercase tracking-wider text-emerald-300">Score</div>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-[1fr_auto_auto] gap-2 text-[10px] text-secondary">
        <span className="truncate text-violet-300">{display(row.recommendation)}</span>
        <span className="font-mono tabular-nums">POP {percent(row.pop)}</span>
        <span className="font-mono tabular-nums">{display(row.dte)} DTE</span>
      </div>
    </button>
  )
}

export default function PositionScannerRail({ scanner, loading, error, filters, onFiltersChange, selectedSymbol, onSelectSymbol, onRefresh, onClose }: {
  scanner: PositionScannerData | null
  loading: boolean
  error: string | null
  filters: PositionFilters
  onFiltersChange: (next: PositionFilters) => void
  selectedSymbol: string
  onSelectSymbol: (symbol: string) => void
  onRefresh: () => void
  onClose?: () => void
}) {
  const rows = scanner?.rows ?? []
  const [tickerInput, setTickerInput] = useState('')
  const toggleStrategy = (strategy: string) => {
    const exists = filters.strategyTypes.includes(strategy)
    onFiltersChange({ ...filters, strategyTypes: exists ? filters.strategyTypes.filter(item => item !== strategy) : [...filters.strategyTypes, strategy] })
  }
  const submitTicker = () => {
    const normalized = tickerInput.trim().toUpperCase()
    if (!/^[A-Z][A-Z0-9.\-]{0,11}$/.test(normalized)) return
    onSelectSymbol(normalized)
  }

  return (
    <aside className="flex min-h-0 flex-col border-r border-slate-200 bg-white dark:border-white/[0.07] dark:bg-slate-950 xl:h-[calc(100dvh-4rem)]">
      <div className="border-b border-slate-200 px-4 py-4 dark:border-white/[0.07]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-primary">Position Trading</h1>
            <p className="mt-1 text-xs leading-5 text-secondary">Find high-probability multi-week opportunities.</p>
          </div>
          {onClose ? <button type="button" title="Close filters" aria-label="Close filters" onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-secondary hover:bg-slate-100 dark:hover:bg-white/[0.06]"><X size={16} /></button> : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <section className="mb-4 rounded-xl border border-slate-200 bg-white p-3 dark:border-white/[0.07] dark:bg-slate-900">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-violet-300">Ticker Search</div>
          <form
            className="flex gap-2"
            onSubmit={event => {
              event.preventDefault()
              submitTicker()
            }}
          >
            <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 text-secondary dark:border-white/[0.08] dark:bg-slate-950">
              <Search size={14} />
              <input
                value={tickerInput}
                onChange={event => setTickerInput(event.target.value.toUpperCase())}
                placeholder="Enter ticker"
                autoCapitalize="characters"
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent font-mono text-sm font-semibold text-primary outline-none placeholder:font-sans placeholder:text-secondary"
              />
            </label>
            <button type="submit" className="rounded-md bg-violet-600 px-3 text-xs font-bold text-white hover:bg-violet-500">Search</button>
          </form>
          <p className="mt-2 text-[10px] leading-4 text-secondary">Search is limited to tickers saved in My Tickers with the Regular type.</p>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-3 dark:border-white/[0.07] dark:bg-slate-900">
          <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-violet-300"><Filter size={14} />Scan & Filter</div>
          <div className="grid gap-3">
            <div>
              <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-secondary">Holding Period</div>
              <div className="grid grid-cols-2 gap-1.5">
                {holdingPeriods.map(period => (
                  <button key={period.value} type="button" onClick={() => onFiltersChange({ ...filters, weeksOut: period.value })} className={`rounded-lg border px-2 py-2 text-left transition ${filters.weeksOut === period.value ? 'border-violet-500 bg-violet-600 text-white' : 'border-slate-200 text-primary hover:border-violet-300 dark:border-white/[0.08] dark:bg-slate-950'}`}>
                    <div className="text-[10px] font-bold">{period.label}</div>
                    <div className="mt-0.5 text-[9px] opacity-80">{period.detail}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-secondary"><span>Strategy Type</span><button type="button" onClick={() => onFiltersChange({ ...filters, strategyTypes: strategies })} className="text-violet-300">Select All</button></div>
              <div className="flex flex-wrap gap-1.5">
                {strategies.map(strategy => {
                  const selected = filters.strategyTypes.includes(strategy)
                  return <button key={strategy} type="button" onClick={() => toggleStrategy(strategy)} className={`rounded-md border px-2 py-1 text-[10px] font-semibold ${selected ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300' : 'border-slate-200 text-secondary dark:border-white/[0.08]'}`}>{strategy}</button>
                })}
              </div>
            </div>

            <div>
              <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-secondary">Risk Profile</div>
              <div className="grid grid-cols-3 gap-1.5">
                {riskProfiles.map(profile => <button key={profile} type="button" onClick={() => onFiltersChange({ ...filters, riskProfile: profile })} className={`rounded-md border px-2 py-2 text-[10px] font-bold capitalize ${filters.riskProfile === profile ? 'border-violet-500 bg-violet-600 text-white' : 'border-slate-200 text-primary dark:border-white/[0.08] dark:bg-slate-950'}`}>{profile}</button>)}
              </div>
            </div>

            <div className="grid gap-2">
              <Slider label="IV Rank" value={filters.ivRank} suffix="%" min={0} max={100} onChange={ivRank => onFiltersChange({ ...filters, ivRank })} />
              <Slider label="POP" value={filters.pop} suffix="%" min={0} max={100} onChange={pop => onFiltersChange({ ...filters, pop })} />
              <Slider label="Expected Return" value={filters.expectedReturn} min={0} max={1000} onChange={expectedReturn => onFiltersChange({ ...filters, expectedReturn })} />
              <Slider label="DTE" value={filters.dte} min={7} max={56} onChange={dte => onFiltersChange({ ...filters, dte })} />
              <Slider label="Min. Confidence" value={filters.minConfidence} suffix="%" min={0} max={100} onChange={minConfidence => onFiltersChange({ ...filters, minConfidence })} />
            </div>

            <button type="button" onClick={onRefresh} disabled={loading} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-violet-600 px-3 text-sm font-bold text-white hover:bg-violet-500 disabled:opacity-60">
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />Find Opportunities
            </button>
            <div className="text-center text-[10px] text-secondary">Last scan: {display(scanner?.last_scan_time)}</div>
          </div>
        </section>

        <section className="mt-4 rounded-xl border border-slate-200 bg-white p-2 dark:border-white/[0.07] dark:bg-slate-900">
          <div className="flex items-center justify-between px-2 py-2">
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-violet-300">Top Opportunities ({rows.length})</h2>
            <AvailabilityBadge value={scanner?.availability} />
          </div>
          {loading && !scanner ? <div className="grid gap-2 p-2">{[1, 2, 3, 4, 5].map(item => <Skeleton key={item} className="h-16" />)}</div> : null}
          {error ? <div className="m-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">{error}</div> : null}
          {!loading && rows.length === 0 ? <div className="p-4 text-sm text-secondary">No Results</div> : null}
          <div className="grid max-h-[28rem] gap-2 overflow-y-auto p-1">
            {rows.map(row => <OpportunityRow key={row.symbol || row.company} row={row} selectedSymbol={selectedSymbol} onSelect={onSelectSymbol} />)}
          </div>
        </section>
      </div>
    </aside>
  )
}
