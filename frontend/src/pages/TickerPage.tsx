import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate as useRouterNavigate, useSearchParams } from 'react-router-dom'
import {
  Search, X, Plus, ChevronDown, ChevronRight, ChevronLeft, ChevronUp,
  Layers, AlertTriangle, Star, Check, RefreshCw, TrendingUp, TrendingDown,
  BookOpen, ArrowUpRight, Zap, Bell, Briefcase, Filter,
  Menu,
  DollarSign, Sparkles, Info, HelpCircle, Maximize2,
  Minimize2, ZoomIn, ZoomOut, RotateCcw, Focus, SlidersHorizontal,
  Eye, EyeOff,
} from 'lucide-react'
import { analyzeOptions, fetchPositionSessionChart } from '../api/client'
import type { PositionSwingChartResponse } from '../api/client'
import type { AnalyzeResponse, Recommendation, Signals, StrategyMode } from '../types'
import { useApp } from '../contexts/AppContext'
import AICoachWidget from '../components/AICoachWidget'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { getTradeWorksheetRoute, ROUTES } from '../routing/routes'
import { fetchMyTickers, type MyTickerEntry } from '../api/commandCenter'
import {
  STRATEGY_OPTIONS, TIME_HORIZON_OPTIONS, BIAS_OPTIONS,
  DEFAULT_FILTERS,
} from '../types/positionTrading'
import type {
  FilterState,
  RecommendationState,
} from '../types/positionTrading'

import OptionProfitCalculator from '../components/OptionProfitCalculator'
import PositionSwingChart from '../components/PositionSwingChart'

// Apply the sidebar "Scan Filters" to the recommendation list. Strategy/bias use a
// normalized contains-match so e.g. the "Calendar Spread" filter also matches a
// "Call Calendar Spread" recommendation. 'all' passes everything through.
function filterRecommendations(recs: Recommendation[], filters: FilterState): Recommendation[] {
  const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z]/g, '')
  const strat = filters.strategy && filters.strategy !== 'all' ? norm(filters.strategy) : ''
  const bias = filters.bias && filters.bias !== 'all' ? norm(filters.bias) : ''
  if (!strat && !bias) return recs
  return recs.filter(rec => {
    if (strat) {
      const rs = norm(rec.strategy)
      if (rs && !rs.includes(strat) && !strat.includes(rs)) return false
    }
    if (bias) {
      const rb = norm(rec.bias)
      if (rb && !rb.includes(bias) && !bias.includes(rb)) return false
    }
    return true
  })
}

const stateStatus = (rec: { status?: string }): RecommendationState =>
  (['GO', 'WAIT', 'CAUTION', 'AVOID'] as RecommendationState[]).includes(rec.status as RecommendationState)
    ? rec.status as RecommendationState
    : 'WAIT'

const fmtUsd = (v: number | null | undefined, fallback = '—') =>
  v != null && Number.isFinite(v) ? `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : fallback

const fmtPct = (v: number | null | undefined, fallback = '—') =>
  v != null && Number.isFinite(v) ? `${(v * 100).toFixed(0)}%` : fallback

const fmtPctRaw = (v: number | null | undefined, fallback = '—') =>
  v != null && Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : fallback

const fmtChange = (v: number | null | undefined) =>
  v != null && Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}` : '—'

const fmtLarge = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return '—'
  if (Math.abs(v) >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}K`
  return v.toLocaleString()
}

const stateColor = (state: RecommendationState): string => {
  switch (state) {
    case 'GO': return 'text-semantic-bullish'
    case 'CAUTION': return 'text-semantic-warning'
    case 'WAIT': return 'text-amber-400'
    case 'AVOID': return 'text-semantic-bearish'
  }
}

const stateBg = (state: RecommendationState): string => {
  switch (state) {
    case 'GO': return 'bg-semantic-bullish-bg'
    case 'CAUTION': return 'bg-semantic-warning-bg'
    case 'WAIT': return 'bg-amber-900/20'
    case 'AVOID': return 'bg-semantic-bearish-bg'
  }
}

const stateBorder = (state: RecommendationState): string => {
  switch (state) {
    case 'GO': return 'border-semantic-bullish-border'
    case 'CAUTION': return 'border-semantic-warning-border'
    case 'WAIT': return 'border-amber-700/40'
    case 'AVOID': return 'border-semantic-bearish-border'
  }
}

const biasColor = (bias: string): string => {
  const b = (bias || '').toUpperCase()
  if (b.includes('BULL')) return 'text-semantic-bullish'
  if (b.includes('BEAR')) return 'text-semantic-bearish'
  return 'text-semantic-warning'
}

const biasBg = (bias: string): string => {
  const b = (bias || '').toUpperCase()
  if (b.includes('BULL')) return 'bg-semantic-bullish-bg'
  if (b.includes('BEAR')) return 'bg-semantic-bearish-bg'
  return 'bg-semantic-warning-bg'
}

function analyzeErrorDetail(e: unknown): string {
  return (
    (e as { response?: { data?: { detail?: string } }; message?: string })
      ?.response?.data?.detail ??
    (e as { message?: string })?.message ??
    'Something went wrong'
  )
}

function isRegularPositionTicker(ticker: MyTickerEntry): boolean {
  return ticker.is_active !== false && (ticker.trade_types ?? []).includes('regular')
}

// ─── Skeleton loader ─────────────────────────────────────────────────────────

function SkeletonBar({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-surface-muted ${className}`} />
}

function TickerListSkeleton() {
  return (
    <div className="space-y-2 p-3">
      {[1, 2, 3, 4, 5, 6].map(i => (
        <div key={i} className="flex items-center gap-3 rounded-lg border border-border p-3">
          <div className="flex-1 space-y-1.5">
            <SkeletonBar className="h-4 w-16" />
            <SkeletonBar className="h-3 w-24" />
          </div>
          <div className="text-right space-y-1.5">
            <SkeletonBar className="h-4 w-14" />
            <SkeletonBar className="h-3 w-10" />
          </div>
        </div>
      ))}
    </div>
  )
}

function SummaryBarSkeleton() {
  return (
    <div className="flex items-center gap-4 p-4">
      <SkeletonBar className="h-7 w-20" />
      <SkeletonBar className="h-4 w-32" />
      <SkeletonBar className="h-6 w-16" />
      <SkeletonBar className="h-4 w-24" />
      <div className="ml-auto flex gap-3">
        <SkeletonBar className="h-8 w-16" />
        <SkeletonBar className="h-8 w-16" />
        <SkeletonBar className="h-8 w-16" />
      </div>
    </div>
  )
}

function RecListSkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2, 3].map(i => (
        <div key={i} className="flex items-center gap-4 rounded-lg border border-border p-3">
          <SkeletonBar className="h-4 w-6" />
          <SkeletonBar className="h-4 w-32 flex-1" />
          <SkeletonBar className="h-4 w-16" />
          <SkeletonBar className="h-4 w-16" />
          <SkeletonBar className="h-4 w-16" />
          <SkeletonBar className="h-6 w-14 rounded-full" />
        </div>
      ))}
    </div>
  )
}

function DetailPanelSkeleton() {
  return (
    <div className="space-y-4 p-4">
      <SkeletonBar className="h-6 w-40" />
      <SkeletonBar className="h-4 w-full" />
      <SkeletonBar className="h-4 w-3/4" />
      <div className="grid grid-cols-2 gap-3">
        {[1, 2, 3, 4, 5, 6].map(i => (
          <div key={i} className="space-y-1">
            <SkeletonBar className="h-3 w-12" />
            <SkeletonBar className="h-4 w-20" />
          </div>
        ))}
      </div>
      <SkeletonBar className="h-32 w-full" />
    </div>
  )
}

// ─── Left sidebar ────────────────────────────────────────────────────────────

function LeftSidebar({
  tickers,
  tickersLoading,
  tickersError,
  selectedSymbol,
  searchQuery,
  filters,
  onSelectSymbol,
  onSearchChange,
  onFilterChange,
  onRefreshTickers,
  onAddTicker,
  onClose,
  embedded = false,
}: {
  tickers: MyTickerEntry[]
  tickersLoading: boolean
  tickersError: string | null
  selectedSymbol: string
  searchQuery: string
  filters: FilterState
  onSelectSymbol: (symbol: string) => void
  onSearchChange: (query: string) => void
  onFilterChange: (filters: FilterState) => void
  onRefreshTickers: () => void
  onAddTicker: () => void
  onClose?: () => void
  embedded?: boolean
}) {
  const [tickerSearchError, setTickerSearchError] = useState('')
  // Filters collapse by default in the mobile/tablet drawer so the ticker list —
  // the primary thing you pick from — stays front-and-center. Expanded on desktop.
  const [filtersOpen, setFiltersOpen] = useState(!embedded)
  const activeFilterCount =
    (filters.strategy !== 'all' ? 1 : 0) +
    (filters.timeHorizon !== 'all' ? 1 : 0) +
    (filters.bias !== 'all' ? 1 : 0) +
    (filters.activeOnly ? 1 : 0)
  const filteredTickers = useMemo(() => {
    if (!searchQuery.trim()) return tickers
    const q = searchQuery.trim().toUpperCase()
    return tickers.filter(t =>
      t.symbol.toUpperCase().includes(q) ||
      (t.company_name || '').toUpperCase().includes(q),
    )
  }, [tickers, searchQuery])

  const submitTickerSearch = useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const query = searchQuery.trim().toUpperCase()
    if (!query) {
      setTickerSearchError('')
      return
    }
    const match = tickers.find(t => t.symbol.toUpperCase() === query) ?? filteredTickers[0]
    if (match) {
      setTickerSearchError('')
      onSelectSymbol(match.symbol)
      return
    }
    if (!/^[A-Z][A-Z0-9.\-]{0,11}$/.test(query)) {
      setTickerSearchError('Enter a valid ticker symbol, such as TSLA or NVDA.')
      return
    }
    setTickerSearchError('')
    onSelectSymbol(query)
  }, [filteredTickers, onSelectSymbol, searchQuery, tickers])

  return (
    <aside className={`${embedded ? 'h-full' : 'sticky top-3 h-[calc(100vh-1.5rem)]'} flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-white/[0.08] dark:bg-slate-950`}>
      <div className="mb-3 flex items-start justify-between">
        <div>
          {!embedded && <div className="text-[10px] font-black uppercase tracking-widest text-text-tertiary">Position Workstation</div>}
          <div className={`flex items-center gap-2 ${embedded ? '' : 'mt-1'}`}>
            <Briefcase size={16} className="text-violet-600 dark:text-violet-300" />
            <span className="text-lg font-black text-text-primary">Position Trading</span>
          </div>
          {!embedded && <div className="mt-1 text-[10px] leading-tight text-text-tertiary">Multi-week options strategies and risk review.</div>}
        </div>
        {onClose ? (
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-text-tertiary transition-colors hover:bg-surface-muted hover:text-text-primary" aria-label="Close navigation">
            <X size={17} />
          </button>
        ) : (
          <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-violet-700 dark:text-violet-200">My Tickers</span>
        )}
      </div>

      {/* Search — the way you find or analyze a ticker; always visible on top */}
      <section className="mb-2.5">
        <form className="relative" onSubmit={submitTickerSearch}>
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => {
              setTickerSearchError('')
              onSearchChange(e.target.value.toUpperCase())
            }}
            placeholder="Search or analyze a ticker, e.g. TSLA"
            className="w-full rounded-lg border border-border bg-surface-canvas py-2.5 pl-9 pr-16 text-[13px] text-text-primary placeholder-text-tertiary outline-none focus:border-semantic-accent"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setTickerSearchError('')
                onSearchChange('')
              }}
              className="absolute right-9 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary"
            >
              <X size={15} />
            </button>
          )}
          <button
            type="button"
            onClick={onRefreshTickers}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary"
            title="Refresh tickers"
          >
            <RefreshCw size={13} />
          </button>
        </form>
        <div className={`mt-1.5 text-[10px] ${tickerSearchError ? 'text-semantic-warning' : 'text-text-tertiary'}`}>
          {tickerSearchError || 'Press Enter to analyze any supported ticker.'}
        </div>
      </section>

      {/* Strategy & scan filters — collapsed by default in the drawer so the
          ticker list below stays the primary view on mobile/tablet. */}
      <section className="mb-2.5 rounded-xl border border-slate-200 bg-slate-50 dark:border-white/[0.07] dark:bg-slate-900/60">
        <button
          type="button"
          onClick={() => setFiltersOpen(open => !open)}
          className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
          aria-expanded={filtersOpen}
        >
          <span className="flex items-center gap-1.5">
            <Filter size={12} className="text-tertiary" />
            <span className="text-[10px] font-black uppercase tracking-widest text-text-tertiary">Strategy &amp; Filters</span>
            {activeFilterCount > 0 && (
              <span className="rounded-full bg-semantic-accent px-1.5 py-0.5 text-[9px] font-black leading-none text-white">{activeFilterCount}</span>
            )}
          </span>
          {filtersOpen ? <ChevronUp size={14} className="text-text-tertiary" /> : <ChevronDown size={14} className="text-text-tertiary" />}
        </button>
        {filtersOpen && (
          <div className="border-t border-slate-200 p-3 dark:border-white/[0.07]">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-text-tertiary">
              Strategy
              <select
                value={filters.strategy}
                onChange={e => onFilterChange({ ...filters, strategy: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-[11px] font-semibold text-text-primary outline-none dark:border-white/[0.08] dark:bg-slate-950"
              >
                {STRATEGY_OPTIONS.map(option => <option key={option} value={option === 'All Strategies' ? 'all' : option}>{option}</option>)}
              </select>
            </label>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <select
                value={filters.timeHorizon}
                onChange={e => onFilterChange({ ...filters, timeHorizon: e.target.value })}
                className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-[10px] font-semibold text-text-primary outline-none dark:border-white/[0.08] dark:bg-slate-950"
              >
                {TIME_HORIZON_OPTIONS.map(o => (
                  <option key={o} value={o === 'All Horizons' ? 'all' : o}>{o}</option>
                ))}
              </select>
              <select
                value={filters.bias}
                onChange={e => onFilterChange({ ...filters, bias: e.target.value })}
                className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-[10px] font-semibold text-text-primary outline-none dark:border-white/[0.08] dark:bg-slate-950"
              >
                {BIAS_OPTIONS.map(o => (
                  <option key={o} value={o === 'All Biases' ? 'all' : o}>{o}</option>
                ))}
              </select>
              <label className="col-span-2 flex items-center gap-2 text-[11px] text-text-secondary">
                <input
                  type="checkbox"
                  checked={filters.activeOnly}
                  onChange={e => onFilterChange({ ...filters, activeOnly: e.target.checked })}
                  className="rounded border-border"
                />
                Active Only
              </label>
            </div>
          </div>
        )}
      </section>

      {/* Ticker list */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-2 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-text-secondary">
            My Tickers
            {tickers.length > 0 && <span className="rounded-full bg-surface-muted px-1.5 py-0.5 text-[9px] font-black leading-none text-text-tertiary">{filteredTickers.length}</span>}
          </span>
          <button type="button" onClick={onAddTicker} className="text-[10px] font-bold text-violet-700 dark:text-violet-300">Manage</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
        {tickersLoading && tickers.length === 0 ? (
          <TickerListSkeleton />
        ) : tickersError ? (
          <div className="p-4 text-center">
            <AlertTriangle size={20} className="mx-auto text-semantic-bearish" />
            <p className="mt-1 text-xs text-semantic-bearish">{tickersError}</p>
            <button
              type="button"
              onClick={onRefreshTickers}
              className="mt-2 text-xs text-semantic-accent hover:underline"
            >
              Retry
            </button>
          </div>
        ) : filteredTickers.length === 0 ? (
          <div className="p-6 text-center">
            <Search size={24} className="mx-auto text-text-tertiary" />
            <p className="mt-2 text-xs text-text-tertiary">
              {searchQuery ? 'No matching tickers found.' : 'Your Position Trading list is empty. Add a ticker to begin.'}
            </p>
            {!searchQuery && (
              <button
                type="button"
                onClick={onAddTicker}
                className="mt-3 rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold text-semantic-accent hover:border-semantic-accent"
              >
                Add Regular Ticker
              </button>
            )}
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {filteredTickers.map(ticker => (
              <button
                key={ticker.symbol}
                type="button"
                onClick={() => onSelectSymbol(ticker.symbol)}
                className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  selectedSymbol === ticker.symbol
                    ? 'border-semantic-accent bg-semantic-accent/10'
                    : 'border-border bg-surface-canvas hover:border-border-strong'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`font-mono text-[13px] font-bold ${selectedSymbol === ticker.symbol ? 'text-semantic-accent' : 'text-text-primary'}`}>
                    {ticker.symbol}
                  </span>
                  {ticker.last_price != null && (
                    <span className="font-mono text-[12px] font-bold text-text-primary">
                      {fmtUsd(ticker.last_price)}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center justify-between">
                  <span className="truncate text-[10px] text-text-tertiary">
                    {ticker.company_name || ''}
                  </span>
                  {ticker.price_change_pct != null && (
                    <span className={`font-mono text-[10px] font-semibold ${
                      ticker.price_change_pct >= 0 ? 'text-semantic-bullish' : 'text-semantic-bearish'
                    }`}>
                      {ticker.price_change_pct >= 0 ? '+' : ''}{ticker.price_change_pct.toFixed(2)}%
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
        </div>
      </div>

      {/* Add ticker */}
      <div className="mt-3 shrink-0">
        <button
          type="button"
          onClick={onAddTicker}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border-strong py-2 text-[11px] font-bold text-text-tertiary transition-colors hover:border-semantic-accent hover:text-semantic-accent"
        >
          <Plus size={14} />
          Add Ticker
        </button>
      </div>
    </aside>
  )
}

const STRATEGY_GUIDE_ITEMS = [
  { name: 'Long Call', use: 'Bullish directional move with defined premium risk.', risk: 'Premium paid can be lost if price does not move higher before expiry.' },
  { name: 'Long Put', use: 'Bearish directional move with defined premium risk.', risk: 'Premium paid can be lost if price does not move lower before expiry.' },
  { name: 'Bull Call Spread', use: 'Bullish move with a lower debit and capped upside.', risk: 'Both profit and loss are limited by the two strikes.' },
  { name: 'Bear Put Spread', use: 'Bearish move with a lower debit and capped downside.', risk: 'Both profit and loss are limited by the two strikes.' },
  { name: 'Bull Put Spread', use: 'Bullish-to-neutral setup where premium is collected below price.', risk: 'Defined downside risk if the stock closes below the short put.' },
  { name: 'Bear Call Spread', use: 'Bearish-to-neutral setup where premium is collected above price.', risk: 'Defined upside risk if the stock closes above the short call.' },
  { name: 'Covered Call', use: 'Income strategy against shares already owned.', risk: 'Share upside is capped and the underlying can still decline.' },
  { name: 'Iron Condor', use: 'Range-bound setup when implied volatility is elevated.', risk: 'Defined risk when price moves beyond either short strike.' },
]

function StrategyGuideDialog({ strategy, onClose }: { strategy?: string | null; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Strategy guide">
      <div className="flex max-h-[min(760px,calc(100vh-2rem))] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-white/[0.08] dark:bg-slate-950">
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-violet-600 dark:text-violet-300">Position Trading</div>
            <h2 className="mt-1 text-lg font-bold text-text-primary">Strategy Guide</h2>
            <p className="mt-1 text-xs text-text-tertiary">A concise reference for the option structures shown in your recommendations.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-text-tertiary transition-colors hover:bg-surface-muted hover:text-text-primary" aria-label="Close strategy guide">
            <X size={18} />
          </button>
        </div>
        {strategy && (
          <div className="border-b border-violet-500/20 bg-violet-500/5 px-5 py-3 text-sm text-text-secondary">
            Selected recommendation: <span className="font-semibold text-text-primary">{strategy}</span>
          </div>
        )}
        <div className="min-h-0 overflow-y-auto p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            {STRATEGY_GUIDE_ITEMS.map(item => (
              <article key={item.name} className="rounded-lg border border-border bg-surface-canvas p-3">
                <h3 className="text-sm font-bold text-text-primary">{item.name}</h3>
                <p className="mt-2 text-xs leading-relaxed text-text-secondary">{item.use}</p>
                <p className="mt-2 border-t border-border pt-2 text-[11px] leading-relaxed text-text-tertiary">Risk: {item.risk}</p>
              </article>
            ))}
          </div>
        </div>
        <div className="flex justify-end border-t border-border px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-text-secondary transition-colors hover:bg-surface-muted">Close</button>
        </div>
      </div>
    </div>
  )
}

// ─── Ticker Summary Bar ──────────────────────────────────────────────────────

function TickerSummaryBar({ analysis }: { analysis: AnalyzeResponse }) {
  const s = analysis.signals
  const changePositive = (s.price_change ?? 0) >= 0
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-surface-card px-5 py-3">
      <div>
        <div className="font-mono text-lg font-bold text-text-primary">{analysis.ticker}</div>
        {analysis.company_name && (
          <div className="text-[10px] text-text-tertiary">{analysis.company_name}</div>
        )}
      </div>
      <div className="text-right">
        <div className="font-mono text-lg font-bold text-text-primary">
          {fmtUsd(s.current_price)}
        </div>
        {s.price_change != null && (
          <div className={`font-mono text-[11px] font-semibold ${changePositive ? 'text-semantic-bullish' : 'text-semantic-bearish'}`}>
            {changePositive ? '▲' : '▼'} {fmtChange(s.price_change)} ({fmtPctRaw(s.price_change_pct)})
          </div>
        )}
      </div>
      <div className="hidden items-center gap-4 text-[11px] sm:flex">
        {s.current_iv != null && (
          <div className="text-center">
            <div className="text-text-tertiary">IV</div>
            <div className="font-mono font-semibold text-text-primary">{fmtPct(s.current_iv / 100)}</div>
          </div>
        )}
        {s.iv_rank != null && (
          <div className="text-center">
            <div className="text-text-tertiary">IV Rank</div>
            <div className={`font-mono font-semibold ${s.iv_rank >= 50 ? 'text-semantic-warning' : 'text-text-primary'}`}>
              {s.iv_rank.toFixed(0)}%
            </div>
          </div>
        )}
        {s.put_call_ratio != null && (
          <div className="text-center">
            <div className="text-text-tertiary">P/C</div>
            <div className="font-mono font-semibold text-text-primary">{s.put_call_ratio.toFixed(2)}</div>
          </div>
        )}
      </div>
      <div className="ml-auto flex items-center gap-2">
        <div className="rounded-md border border-border px-2.5 py-1 text-center">
          <div className="text-[9px] text-text-tertiary">Bias</div>
          <div className={`text-[11px] font-bold ${biasColor(s.directional_bias || '')}`}>
            {s.directional_bias || '—'}
          </div>
        </div>
        {s.bias_confidence != null && (
          <div className="rounded-md border border-border px-2.5 py-1 text-center">
            <div className="text-[9px] text-text-tertiary">Confidence</div>
            <div className="font-mono text-[11px] font-bold text-text-primary">{s.bias_confidence.toFixed(0)}%</div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Recommendations Table ───────────────────────────────────────────────────

function RecommendationsTable({
  recommendations,
  signals,
  selectedRank,
  showAll,
  onSelectRec,
  onToggleShowAll,
}: {
  recommendations: Recommendation[]
  signals: Signals
  selectedRank: number | null
  showAll: boolean
  onSelectRec: (rank: number | null) => void
  onToggleShowAll: () => void
}) {
  const sorted = useMemo(() => {
    const go = recommendations.filter(r => stateStatus(r) === 'GO')
    const caution = recommendations.filter(r => stateStatus(r) === 'CAUTION')
    const wait = recommendations.filter(r => stateStatus(r) === 'WAIT')
    const avoid = recommendations.filter(r => stateStatus(r) === 'AVOID')
    return [...go, ...caution, ...wait, ...avoid]
  }, [recommendations])

  const display = showAll ? sorted : sorted.filter(r => stateStatus(r) !== 'AVOID')

  const tableRef = useRef<HTMLDivElement>(null)

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const focusedIdx = display.findIndex(r => r.rank === selectedRank)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = Math.min(focusedIdx + 1, display.length - 1)
      if (display[next]) onSelectRec(display[next].rank)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const prev = Math.max(focusedIdx - 1, 0)
      if (display[prev]) onSelectRec(display[prev].rank)
    } else if (e.key === 'Escape') {
      onSelectRec(null)
    }
  }, [display, selectedRank, onSelectRec])

  if (recommendations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-surface-card py-12">
        <AlertTriangle size={28} className="text-text-tertiary" />
        <p className="mt-2 text-sm text-text-tertiary">No valid position-trading setups available under the current filters.</p>
      </div>
    )
  }

  return (
    <div>
      <div ref={tableRef} className="space-y-2" tabIndex={0} onKeyDown={handleKeyDown} role="listbox" aria-label="Recommendations list">
        {display.map(rec => {
          const state = stateStatus(rec)
          const score = rec.scores?.total_score ?? 0
          const isCredit = (rec.net_credit ?? 0) > 0
          const ev = rec.expected_value ?? 0
          const rr = rec.risk_reward_ratio ?? 0
          const isSelected = selectedRank === rec.rank
          const firstLeg = rec.legs[0]

          return (
            <div
              key={rec.rank}
              onClick={() => onSelectRec(isSelected ? null : rec.rank)}
              className={`cursor-pointer rounded-xl border px-4 py-3.5 transition-colors ${
                isSelected
                  ? 'border-semantic-accent bg-semantic-accent/5 outline outline-1 outline-semantic-accent'
                  : 'border-border bg-surface-card hover:border-border-strong'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="w-5 shrink-0 font-mono text-[11px] text-text-tertiary">{rec.rank}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[15px] font-semibold text-text-primary">{rec.strategy}</span>
                    <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold ${stateBg(state)} ${stateColor(state)} ${stateBorder(state)}`}>
                      {state}
                    </span>
                    <span className={`ml-auto rounded-full px-1.5 py-0.5 text-[9px] font-bold ${biasBg(rec.bias)} ${biasColor(rec.bias)}`}>
                      {rec.bias}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-text-tertiary">
                    <span className="font-mono">{rec.expiry.slice(5)} · {rec.dte} DTE</span>
                    {rec.legs.slice(0, 2).map((leg, i) => (
                      <span key={i} className={`font-mono ${leg.action === 'BUY' ? 'text-semantic-bullish' : 'text-semantic-bearish'}`}>
                        {leg.action === 'BUY' ? 'Buy' : 'Sell'} ${fmtStrike(leg.strike)}{leg.option_type === 'CALL' ? 'C' : 'P'}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="hidden sm:flex items-center gap-4 shrink-0">
                  <div className="text-right">
                    <div className="text-[10px] text-text-tertiary">Score</div>
                    <div className="flex items-center gap-1.5 justify-end">
                      <div className="h-1.5 w-12 overflow-hidden rounded-full bg-surface-muted">
                        <div
                          className={`h-full rounded-full ${
                            score >= 75 ? 'bg-semantic-bullish' : score >= 55 ? 'bg-semantic-warning' : 'bg-semantic-bearish'
                          }`}
                          style={{ width: `${Math.min(score, 100)}%` }}
                        />
                      </div>
                      <span className={`font-mono text-[13px] font-bold ${stateColor(state)}`}>{score}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-text-tertiary">EV</div>
                    <div className="font-mono text-[14px] font-bold text-text-primary">{fmtUsd(ev * 100)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-text-tertiary">R:R</div>
                    <div className="font-mono text-[14px] font-bold text-text-primary">{rr > 0 ? `1:${rr.toFixed(1)}` : '—'}</div>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {sorted.some(r => stateStatus(r) === 'AVOID') && (
        <button
          type="button"
          onClick={onToggleShowAll}
          className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg border border-border bg-surface-card px-3 py-2 text-[11px] text-text-tertiary transition-colors hover:text-semantic-accent"
        >
          {showAll ? 'Hide ineligible recommendations' : `View all recommendations (${sorted.length} total)`}
        </button>
      )}
    </div>
  )
}

// ─── Strategy Tiles Grid ─────────────────────────────────────────────────────

function StrategyTilesGrid({
  recommendations,
  selectedRank,
  onSelectRec,
}: {
  recommendations: Recommendation[]
  selectedRank: number | null
  onSelectRec: (rank: number | null) => void
}) {
  const tiles = useMemo(() => {
    const map = new Map<string, Recommendation>()
    for (const r of recommendations) {
      const existing = map.get(r.strategy)
      if (!existing || r.rank < existing.rank) {
        map.set(r.strategy, r)
      }
    }
    return Array.from(map.values()).sort((a, b) => a.rank - b.rank)
  }, [recommendations])

  if (tiles.length === 0) {
    return (
      <div className="flex items-center justify-center h-full rounded-xl border border-border bg-surface-card">
        <p className="text-[11px] text-text-tertiary">No strategies available.</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-3 gap-1.5 auto-rows-auto">
      {tiles.map(rec => {
        const state = stateStatus(rec)
        const selected = rec.rank === selectedRank
        return (
          <button
            key={rec.strategy}
            type="button"
            onClick={() => onSelectRec(rec.rank)}
            className={`flex flex-col items-center justify-center rounded-xl border p-2 text-center transition-all ${
              selected
                ? 'border-semantic-accent bg-semantic-accent/10'
                : 'border-border bg-surface-card hover:border-border-strong'
            }`}
          >
            <span className="text-[9px] font-extrabold uppercase tracking-wider leading-tight text-text-primary">
              {rec.strategy}
            </span>
            <div className="mt-1 flex items-center gap-1">
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${
                state === 'GO' ? 'bg-semantic-bullish' :
                state === 'CAUTION' ? 'bg-semantic-warning' :
                state === 'WAIT' ? 'bg-amber-400' :
                'bg-semantic-bearish'
              }`} />
              <span className={`text-[9px] font-bold ${
                state === 'GO' ? 'text-semantic-bullish' :
                state === 'CAUTION' ? 'text-semantic-warning' :
                state === 'WAIT' ? 'text-amber-400' :
                'text-semantic-bearish'
              }`}>
                {state}
              </span>
            </div>
            <span className="mt-0.5 font-mono text-[11px] font-bold text-text-primary">
              {rec.scores.total_score}
            </span>
            <span className="text-[7px] uppercase tracking-wider text-text-tertiary">Score</span>
          </button>
        )
      })}
    </div>
  )
}

// ─── Right Detail Panel ──────────────────────────────────────────────────────

function OptionsFlowPanel({ analysis }: { analysis: AnalyzeResponse }) {
  const flow = analysis.options_flow
  if (!flow) {
    return (
      <div className="flex min-h-[280px] items-center justify-center px-6 text-center text-sm text-text-tertiary">
        Options flow is unavailable for this analysis.
      </div>
    )
  }

  const sentimentTone = flow.sentiment === 'Call-heavy'
    ? 'text-semantic-bullish'
    : flow.sentiment === 'Put-heavy'
      ? 'text-semantic-bearish'
      : 'text-semantic-warning'

  return (
    <div className="space-y-3 p-4">
      <div className="rounded-lg border border-border bg-surface-canvas p-3">
        <div className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary">Chain Sentiment</div>
        <div className={`mt-1 text-lg font-bold ${sentimentTone}`}>{flow.sentiment}</div>
        <p className="mt-1 text-[11px] leading-relaxed text-text-secondary">{flow.summary}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {[
          { label: 'Call Volume', value: fmtLarge(flow.callVolume), tone: 'text-semantic-bullish' },
          { label: 'Put Volume', value: fmtLarge(flow.putVolume), tone: 'text-semantic-bearish' },
          { label: 'Call Open Interest', value: fmtLarge(flow.callOpenInterest), tone: 'text-semantic-bullish' },
          { label: 'Put Open Interest', value: fmtLarge(flow.putOpenInterest), tone: 'text-semantic-bearish' },
          { label: 'Volume P/C', value: flow.volumePutCallRatio?.toFixed(2) ?? '—', tone: 'text-text-primary' },
          { label: 'OI P/C', value: flow.openInterestPutCallRatio?.toFixed(2) ?? '—', tone: 'text-text-primary' },
          { label: 'IV Rank', value: `${flow.ivRank.toFixed(0)}%`, tone: 'text-text-primary' },
          { label: 'IV Skew', value: flow.ivSkew.toFixed(2), tone: 'text-text-primary' },
        ].map(metric => (
          <div key={metric.label} className="rounded-lg border border-border bg-surface-canvas p-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary">{metric.label}</div>
            <div className={`mt-1 font-mono text-lg font-bold ${metric.tone}`}>{metric.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function KeyLevelsPanel({ analysis, selectedRank }: { analysis: AnalyzeResponse; selectedRank: number | null }) {
  const selectedRecommendation = analysis.recommendations.find(rec => rec.rank === selectedRank)
  const breakeven = selectedRecommendation?.breakeven_lower
    ? fmtUsd(selectedRecommendation.breakeven_lower)
    : selectedRecommendation?.breakeven_upper
      ? fmtUsd(selectedRecommendation.breakeven_upper)
      : '—'

  return (
    <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
      {(analysis.key_levels ?? []).map(level => (
        <div key={level.label} className="rounded-lg border border-border bg-surface-canvas p-3" title={level.reason}>
          <div className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary">{level.label}</div>
          <div className={`mt-1 font-mono text-lg font-bold ${
            level.kind === 'support' ? 'text-semantic-bullish' :
            level.kind === 'resistance' ? 'text-semantic-bearish' :
            'text-text-primary'
          }`}>{fmtUsd(level.price)}</div>
          <p className="mt-1 text-[11px] leading-relaxed text-text-secondary">{level.reason}</p>
        </div>
      ))}
      <div className="rounded-lg border border-border bg-surface-canvas p-3">
        <div className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary">Selected Trade Breakeven</div>
        <div className="mt-1 font-mono text-lg font-bold text-text-primary">{breakeven}</div>
        <p className="mt-1 text-[11px] leading-relaxed text-text-secondary">Reference point supplied by the selected strategy.</p>
      </div>
    </div>
  )
}

function RightDetailPanel({
  analysis,
  selectedRank,
  onSelectRec,
  onClose,
  inline = false,
}: {
  analysis: AnalyzeResponse | null
  selectedRank: number | null
  onSelectRec: (rank: number | null) => void
  onClose: () => void
  inline?: boolean
}) {
  const recs = analysis?.recommendations ?? []
  const selectedRec = recs.find(r => r.rank === selectedRank) ?? null
  const selectedIdx = selectedRec ? recs.indexOf(selectedRec) : -1
  const totalRecs = recs.length

  if (!analysis || !selectedRec) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <Info size={24} className="text-text-tertiary" />
        <p className="mt-3 text-sm text-text-tertiary">Select a recommendation to view trade details.</p>
      </div>
    )
  }

  const rec = selectedRec
  const state = stateStatus(rec)
  const isCredit = (rec.net_credit ?? 0) > 0
  const score = rec.scores?.total_score ?? 0
  const ev = rec.expected_value ?? 0
  const rr = rec.risk_reward_ratio ?? 0
  const breakeven = rec.breakeven_lower
    ? fmtUsd(rec.breakeven_lower)
    : rec.breakeven_upper
    ? fmtUsd(rec.breakeven_upper)
    : '—'

  return (
    <div className={`flex flex-col ${inline ? '' : 'h-full overflow-y-auto'}`}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[16px] font-bold text-text-primary">{rec.strategy}</span>
            <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-bold ${stateBg(state)} ${stateColor(state)} ${stateBorder(state)}`}>
              {state}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-text-tertiary">
            <span>{selectedIdx + 1} of {totalRecs}</span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => selectedIdx > 0 && onSelectRec(recs[selectedIdx - 1].rank)}
                disabled={selectedIdx <= 0}
                className="rounded p-0.5 text-text-tertiary hover:text-text-primary disabled:opacity-30"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                type="button"
                onClick={() => selectedIdx < totalRecs - 1 && onSelectRec(recs[selectedIdx + 1].rank)}
                disabled={selectedIdx >= totalRecs - 1}
                className="rounded p-0.5 text-text-tertiary hover:text-text-primary disabled:opacity-30"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
        <button type="button" onClick={onClose} className="rounded p-1 text-text-tertiary hover:text-text-primary">
          <X size={16} />
        </button>
      </div>

      {/* Legs */}
      <div className="border-b border-border px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary">Legs</div>
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${biasBg(rec.bias)} ${biasColor(rec.bias)}`}>{rec.bias}</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {rec.legs.map((leg, index) => (
            <div key={`${leg.action}-${leg.option_type}-${leg.strike}-${index}`} className={`flex items-center justify-between rounded-md border px-2.5 py-2 ${
              leg.action === 'BUY'
                ? 'border-semantic-bullish-border bg-semantic-bullish-bg'
                : 'border-semantic-bearish-border bg-semantic-bearish-bg'
            }`}>
              <div className="min-w-0">
                <span className={`block text-[11px] font-bold ${leg.action === 'BUY' ? 'text-semantic-bullish' : 'text-semantic-bearish'}`}>{leg.action === 'BUY' ? 'Buy to Open' : 'Sell to Open'}</span>
                <span className="block truncate font-mono text-[13px] font-bold text-text-primary">{leg.option_type} · Strike {fmtUsd(leg.strike)}</span>
              </div>
              <span className="ml-2 shrink-0 font-mono text-[11px] text-text-secondary">{leg.expiry || rec.expiry}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 font-mono text-[11px] text-text-tertiary">{rec.expiry} · {rec.dte} DTE</div>
      </div>

      {/* Key Rationale */}
      <div className="border-b border-border px-4 py-3">
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-text-tertiary">Key Rationale</div>
        {rec.rationale ? (
          <div className="rounded-lg border border-border bg-surface-canvas px-3 py-2.5">
            <div className="flex items-start gap-2">
              <Check size={14} className="mt-0.5 shrink-0 text-semantic-bullish" />
              <p className="text-[13px] leading-relaxed text-text-secondary">{rec.rationale}</p>
            </div>
          </div>
        ) : (
          <p className="text-[12px] italic text-text-tertiary">No detailed rationale available.</p>
        )}
        {!!rec.warnings?.length && (
          <div className="mt-2 flex items-start gap-2 rounded-lg border border-semantic-warning-border bg-semantic-warning-bg px-3 py-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-semantic-warning" />
            <p className="text-[12px] leading-relaxed text-semantic-warning">{rec.warnings[0]}</p>
          </div>
        )}
      </div>

      {/* Trade Details */}
      <div className="border-b border-border px-4 py-3">
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-text-tertiary">Trade Details</div>
        <div className="grid grid-cols-2 gap-2">
          <Metric label="Contract" value={firstLegContract(rec)} />
          <Metric label="Strike Price" value={firstLegStrike(rec)} />
          <Metric label={isCredit ? 'Credit' : 'Debit'} value={fmtUsd(Math.abs(rec.net_credit ?? 0))} />
          <Metric label="Expiry" value={formatExpiryDate(rec.expiry)} />
          <Metric label="DTE" value={String(rec.dte)} />
          <Metric label="Collateral" value={fmtUsd(rec.max_loss * 100)} />
          <Metric label="Breakeven" value={breakeven} />
          <Metric label="Max Profit" value={fmtUsd(rec.max_profit * 100)} tone="bullish" />
          <Metric label="Max Loss" value={fmtUsd(rec.max_loss * 100)} tone="bearish" />
          <Metric label="PoP" value={fmtPct(rec.prob_of_profit)} />
          <Metric label="Expected Value" value={fmtUsd(ev * 100)} />
          <Metric label="R:R" value={rr > 0 ? `1:${rr.toFixed(1)}` : '—'} />
          <Metric label="Delta" value={rec.short_leg_delta ? rec.short_leg_delta.toFixed(3) : '—'} />
          {rec.legs[0]?.iv != null && <Metric label="IV" value={fmtPct(rec.legs[0].iv / 100)} />}
          <Metric label="Open Interest" value={fmtLarge(rec.legs.reduce((s, l) => s + (l.oi || 0), 0))} />
          <Metric label="Volume" value={fmtLarge(rec.legs.reduce((s, l) => s + (l.volume || 0), 0))} />
        </div>
      </div>

      {/* Payoff Chart */}
      <div className="border-b border-border px-4 py-3">
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-text-tertiary">Risk Profile</div>
        <OptionProfitCalculator
          recommendations={[rec]}
          currentPrice={analysis.signals.current_price}
          showLegs={false}
        />
      </div>

      {/* Recent Performance */}
      <div className="border-b border-border px-4 py-3">
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-text-tertiary">Recent Performance</div>
        <div className="grid grid-cols-2 gap-2">
          <Metric label="Score" value={String(score)} />
          <Metric label="Confidence" value={fmtPct((score ?? 0) / 100)} />
        </div>
      </div>

      {/* Actions */}
      <div className="px-4 py-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg border border-semantic-accent bg-semantic-accent/10 px-3 py-1.5 text-[11px] font-bold text-semantic-accent transition-colors hover:bg-semantic-accent/20"
          >
            <ArrowUpRight size={14} />
            View Full Analysis
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-card px-3 py-1.5 text-[11px] font-bold text-text-secondary transition-colors hover:border-text-tertiary"
          >
            <Star size={14} />
            Add to Watchlist
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-card px-3 py-1.5 text-[11px] font-bold text-text-secondary transition-colors hover:border-text-tertiary"
          >
            <Bell size={14} />
            Create Alert
          </button>
        </div>
      </div>

      {/* AI Coach — per-recommendation suggestion */}
      <div className="px-4 pb-4">
        <AICoachWidget
          mode="recommendation"
          compact
          heading="AI Coach — This Recommendation"
          title={`${analysis.ticker} · ${rec.strategy}`}
          context={{
            ticker: analysis.ticker,
            price: analysis.signals?.current_price,
            bias: analysis.market_bias ?? analysis.signals?.trend,
            decision: analysis.final_decision,
            recommendation: {
              strategy: rec.strategy, rank: rec.rank, netCredit: rec.net_credit,
              maxProfit: rec.max_profit, maxLoss: rec.max_loss, breakeven,
              score, expectedValue: ev, riskReward: rr,
              probOfProfit: rec.prob_of_profit, dte: rec.dte, legs: rec.legs,
            },
          }}
        />
      </div>
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'bullish' | 'bearish' | 'neutral' }) {
  return (
    <div className="rounded-md border border-border bg-surface-canvas px-2 py-1.5">
      <div className="text-[10px] text-text-tertiary">{label}</div>
      <div className={`font-mono text-[13px] font-bold ${
        tone === 'bullish' ? 'text-semantic-bullish' :
        tone === 'bearish' ? 'text-semantic-bearish' :
        'text-text-primary'
      }`}>{value}</div>
    </div>
  )
}

function firstLegStrike(rec: Recommendation): string {
  const leg = rec.legs[0]
  if (!leg) return '—'
  return fmtUsd(leg.strike)
}

function firstLegContract(rec: Recommendation): string {
  const leg = rec.legs[0]
  if (!leg) return '—'
  return `${leg.action === 'SELL' ? 'Sell to Open' : 'Buy to Open'} ${leg.option_type === 'CALL' ? 'Call' : 'Put'}`
}

function fmtStrike(value: number | null | undefined): string {
  return value != null && Number.isFinite(value)
    ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : '—'
}

function formatExpiryDate(value: string): string {
  const date = new Date(`${value}T12:00:00`)
  if (Number.isNaN(date.getTime())) return value || '—'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// ─── Draggable Divider ────────────────────────────────────────────────────────

function DraggableDivider({
  onMouseDown,
  horizontal = false,
}: {
  onMouseDown: (e: React.MouseEvent) => void
  horizontal?: boolean
}) {
  return (
    <div
      onMouseDown={onMouseDown}
      className={`relative shrink-0 ${
        horizontal
          ? 'h-[6px] cursor-row-resize hover:bg-semantic-accent/20'
          : 'w-[6px] cursor-col-resize hover:bg-semantic-accent/20'
      } transition-colors`}
    >
      <div
        className={`absolute ${
          horizontal
            ? 'left-[15%] right-[15%] top-1/2 h-[2px] -translate-y-1/2'
            : 'top-[15%] bottom-[15%] left-1/2 w-[2px] -translate-x-1/2'
        } rounded-full bg-border-strong group-hover:bg-semantic-accent`}
      />
    </div>
  )
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function TickerPage() {
  const routerNavigate = useRouterNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const {
    theme, navigate,
    pendingTicker, pendingAnalysisOptions, clearPendingTicker,
    getCached, setCached, tickerCache,
  } = useApp()

  // ── State ────────────────────────────────────────────────────────────────

  const [tickers, setTickers] = useState<MyTickerEntry[]>([])
  const [tickersLoading, setTickersLoading] = useState(false)
  const [tickersError, setTickersError] = useState<string | null>(null)

  const [selectedSymbol, setSelectedSymbol] = useState('')
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)

  const [selectedRank, setSelectedRank] = useState<number | null>(null)

  const [searchQuery, setSearchQuery] = useState('')
  const [showAllRecs, setShowAllRecs] = useState(false)
  const [sidebarMobileOpen, setSidebarMobileOpen] = useState(false)
  const [strategyGuideOpen, setStrategyGuideOpen] = useState(false)
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS)
  const [centerTab, setCenterTab] = useState<'recommendations' | 'chart' | 'flow' | 'levels'>('recommendations')
  const [positionChart, setPositionChart] = useState<PositionSwingChartResponse | null>(null)
  const [positionChartLoading, setPositionChartLoading] = useState(false)
  const [positionChartError, setPositionChartError] = useState('')

  const [rightPanelOpen, setRightPanelOpen] = useState(true)
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  const [rightPanelRatio, setRightPanelRatio] = useState(() => {
    try {
      const savedRatio = Number(window.localStorage.getItem('position_trade_right_panel_ratio'))
      if (Number.isFinite(savedRatio) && savedRatio >= 0.2 && savedRatio <= 0.48) return savedRatio

      // Migrate the previous pixel preference into a viewport-relative width.
      const savedWidth = Number(window.localStorage.getItem('position_trade_right_panel_width'))
      if (Number.isFinite(savedWidth) && savedWidth >= 320) return savedWidth / window.innerWidth
    } catch { /* local storage unavailable */ }
    return 0.35
  })
  const maxRightPanelWidth = Math.min(760, Math.round(viewportWidth * 0.48))
  const rightPanelWidth = Math.max(320, Math.min(maxRightPanelWidth, Math.round(viewportWidth * rightPanelRatio)))

  const rightPanelRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const handleRightPanelDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = rightPanelWidth
    rightPanelRef.current = { startX, startWidth }

    const handleMouseMove = (ev: MouseEvent) => {
      if (!rightPanelRef.current) return
      const delta = rightPanelRef.current.startX - ev.clientX
      const maxWidth = Math.min(760, Math.round(window.innerWidth * 0.48))
      const newWidth = Math.max(320, Math.min(maxWidth, rightPanelRef.current.startWidth + delta))
      setRightPanelRatio(newWidth / window.innerWidth)
    }
    const handleMouseUp = () => {
      rightPanelRef.current = null
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [rightPanelWidth])

  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    try { window.localStorage.setItem('position_trade_right_panel_ratio', String(rightPanelRatio)) } catch { /* quota */ }
  }, [rightPanelRatio])

  const didRun = useRef(false)
  const didRestoreLastAnalysis = useRef(false)
  const didSelectDefaultTicker = useRef(false)

  const [lastWeeks, setLastWeeks] = useState(4)
  const [lastWidth, setLastWidth] = useState<number | null>(null)
  const [lastMode, setLastMode] = useState<StrategyMode>('all')
  const [lastChainExpiry, setLastChainExpiry] = useState<string | null>(null)

  useDocumentTitle(selectedSymbol ? `${selectedSymbol} — Position Trading` : 'Position Trading')

  // ── Load my tickers ──────────────────────────────────────────────────────

  const loadTickers = useCallback(async () => {
    setTickersLoading(true)
    setTickersError(null)
    try {
      const result = await fetchMyTickers()
      setTickers((result.data?.tickers ?? [])
        .filter(isRegularPositionTicker)
        .sort((a, b) => a.symbol.localeCompare(b.symbol)))
    } catch (e) {
      setTickersError(analyzeErrorDetail(e))
    } finally {
      setTickersLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadTickers()
  }, [loadTickers])

  // ── Analyze ──────────────────────────────────────────────────────────────

  const handleAnalyze = useCallback(async (
    ticker: string,
    weeksOut = 4,
    spreadWidth: number | null = null,
    strategyMode: StrategyMode = 'all',
    chainExpiry: string | null = null,
  ) => {
    const tickerUpper = ticker.trim().toUpperCase()
    if (!tickerUpper) return
    setSelectedSymbol(tickerUpper)
    setAnalysisLoading(true)
    setAnalysisError(null)
    setLastWeeks(weeksOut)
    setLastWidth(spreadWidth)
    setLastMode(strategyMode)

    try {
      const result = await analyzeOptions(tickerUpper, weeksOut, spreadWidth, strategyMode, chainExpiry)
      setAnalysis(result)
      setShowAllRecs(false)

      const goRec = result.recommendations.find(r => stateStatus(r) === 'GO')
      setSelectedRank(goRec?.rank ?? result.recommendations[0]?.rank ?? null)
      setRightPanelOpen(true)
    } catch (e) {
      setAnalysisError(analyzeErrorDetail(e))
      setAnalysis(null)
    } finally {
      setAnalysisLoading(false)
    }
  }, [])

  // ── Pending ticker from navigator ────────────────────────────────────────

  useEffect(() => {
    if (pendingTicker && !didRun.current) {
      didRun.current = true
      const weeksOut = pendingAnalysisOptions?.weeksOut ?? 4
      const spreadWidth = pendingAnalysisOptions?.spreadWidth ?? null
      const strategyMode = pendingAnalysisOptions?.strategyMode ?? 'all'
      clearPendingTicker()
      setSearchParams({ symbol: pendingTicker.trim().toUpperCase() })
      void handleAnalyze(pendingTicker, weeksOut, spreadWidth, strategyMode)
    }
  }, [pendingTicker, pendingAnalysisOptions, clearPendingTicker, handleAnalyze, setSearchParams])

  useEffect(() => {
    if (!pendingTicker) didRun.current = false
  }, [pendingTicker])

  useEffect(() => {
    const symbol = searchParams.get('symbol')?.trim().toUpperCase()
    if (!symbol || didRestoreLastAnalysis.current || pendingTicker) return
    didRestoreLastAnalysis.current = true
    void handleAnalyze(symbol)
  }, [handleAnalyze, pendingTicker, searchParams])

  useEffect(() => {
    if (searchParams.get('symbol') || pendingTicker || didSelectDefaultTicker.current || tickers.length === 0) return
    const firstTicker = tickers[0]?.symbol
    if (!firstTicker) return
    didSelectDefaultTicker.current = true
    didRestoreLastAnalysis.current = true
    setSearchParams({ symbol: firstTicker })
    void handleAnalyze(firstTicker)
  }, [handleAnalyze, pendingTicker, searchParams, setSearchParams, tickers])

  const loadPositionChart = useCallback(async (forceRefresh = false) => {
    if (!selectedSymbol) {
      setPositionChart(null)
      return
    }
    setPositionChartLoading(true)
    setPositionChartError('')
    try {
      const response = await fetchPositionSessionChart({
        symbol: selectedSymbol,
        forceRefresh,
      })
      setPositionChart(response)
    } catch (error) {
      setPositionChartError(error instanceof Error ? error.message : 'Chart load failed')
      setPositionChart(null)
    } finally {
      setPositionChartLoading(false)
    }
  }, [selectedSymbol])

  useEffect(() => {
    if (centerTab === 'chart' && selectedSymbol) void loadPositionChart()
  }, [centerTab, selectedSymbol, loadPositionChart])

  // ── Selected recommendation ──────────────────────────────────────────────

  const currentRecs = analysis?.recommendations ?? []
  const visibleRecs = useMemo(
    () => filterRecommendations(analysis?.recommendations ?? [], filters),
    [analysis, filters],
  )
  const currentSelectedRec = currentRecs.find(r => r.rank === selectedRank) ?? null

  // ── Derived ──────────────────────────────────────────────────────────────

  const preTradeRoute = useMemo(() => {
    const rawBias = currentSelectedRec?.bias || analysis?.signals?.directional_bias || ''
    const direction = /bear|put|short/i.test(rawBias) ? 'Bearish' : /bull|call|long/i.test(rawBias) ? 'Bullish' : null
    const strategy = currentSelectedRec?.strategy || (direction === 'Bearish' ? 'Long Put' : direction === 'Bullish' ? 'Long Call' : null)
    return getTradeWorksheetRoute({ ticker: selectedSymbol || analysis?.ticker || '', direction, strategy, source: 'regular' })
  }, [analysis, selectedSymbol, currentSelectedRec])

  const isResponsive = false // We'll handle responsive breakpoints with CSS

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-surface-page text-primary md:min-h-0 md:flex-1 md:overflow-hidden">
    <div className="flex min-h-screen w-full gap-1 md:h-full md:min-h-0">
      {/* Left sidebar */}
      <div className="hidden w-72 shrink-0 2xl:w-80 xl:block">
        <LeftSidebar
          tickers={tickers}
          tickersLoading={tickersLoading}
          tickersError={tickersError}
          selectedSymbol={selectedSymbol}
          searchQuery={searchQuery}
          filters={filters}
          onSelectSymbol={symbol => {
            setSearchParams({ symbol: symbol.trim().toUpperCase() })
            void handleAnalyze(symbol)
          }}
          onSearchChange={setSearchQuery}
          onFilterChange={setFilters}
          onRefreshTickers={() => void loadTickers()}
          onAddTicker={() => routerNavigate('/my-tickers')}
        />
      </div>

      {/* Center workspace */}
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-sm dark:border-white/[0.08] dark:bg-slate-950">
        {/* Page header */}
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-3 md:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarMobileOpen(true)}
              className="rounded-lg border border-border bg-surface-canvas p-2 text-text-secondary transition-colors hover:bg-surface-muted hover:text-text-primary xl:hidden"
              aria-label="Open navigation"
              title="Open navigation"
            >
              <Menu size={18} />
            </button>
            <div>
              <h1 className="text-lg font-bold text-text-primary">Position Trading</h1>
              <p className="hidden text-[11px] text-text-tertiary sm:block">AI-powered options recommendations with clear rationale and risk management.</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface-card p-0.5">
            <button
              type="button"
              onClick={() => routerNavigate(preTradeRoute)}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] font-bold text-semantic-bullish transition-colors hover:bg-semantic-bullish-bg"
            >
              <ArrowUpRight size={13} />
              <span className="hidden sm:inline">Pre-Trade Analysis</span>
            </button>
            <button
              type="button"
              onClick={() => routerNavigate(ROUTES.positions)}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] font-bold text-text-secondary transition-colors hover:bg-surface-muted"
            >
              <Briefcase size={13} />
              <span className="hidden lg:inline">Active Positions</span>
            </button>
            <button
              type="button"
              onClick={() => setStrategyGuideOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] font-bold text-text-secondary transition-colors hover:bg-surface-muted"
            >
              <BookOpen size={13} />
              <span className="hidden lg:inline">Strategy Guide</span>
            </button>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-3 px-3 py-3 min-h-0 md:px-4 md:py-4">
          {/* Summary bar */}
          <div className="shrink-0">
            {analysisLoading && !analysis && <SummaryBarSkeleton />}
            {analysisError && !analysis && (
              <div className="rounded-xl border border-semantic-bearish-border bg-semantic-bearish-bg px-4 py-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={16} className="text-semantic-bearish" />
                  <span className="text-sm font-semibold text-semantic-bearish">Analysis Failed</span>
                </div>
                <p className="mt-1 text-xs text-semantic-bearish">{analysisError}</p>
              </div>
            )}
            {analysis && <TickerSummaryBar analysis={analysis} />}
          </div>

          <div className="flex shrink-0 items-center gap-1 overflow-x-auto rounded-lg border border-border bg-surface-card p-0.5">
            {([
              { id: 'recommendations' as const, label: 'Recommendations' },
              { id: 'chart' as const, label: 'Session Chart' },
              { id: 'flow' as const, label: 'Options Flow' },
              { id: 'levels' as const, label: 'Key Levels' },
            ]).map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setCenterTab(tab.id)}
                className={`shrink-0 rounded-md px-3 py-1.5 text-[11px] font-bold transition-colors ${
                  centerTab === tab.id
                    ? 'bg-surface-muted text-text-primary'
                    : 'text-text-tertiary hover:text-text-secondary'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {centerTab === 'recommendations' && (
          <section className="flex min-h-0 flex-1 flex-col rounded-xl border border-border bg-surface-card">
            <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
              <div>
                <h2 className="text-sm font-bold text-text-primary">Recommendations</h2>
                <p className="mt-0.5 text-[11px] text-text-tertiary">
                  Select a strategy to inspect its trade structure and payoff
                  <span className="hidden xl:inline"> in the right frame.</span>
                  <span className="xl:hidden"> below the recommendations.</span>
                </p>
              </div>
              {analysis && (
                <span className="rounded-full border border-border bg-surface-canvas px-2 py-1 font-mono text-[10px] font-bold text-text-secondary">
                  {visibleRecs.length} ranked
                </span>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2 md:p-3">
              {analysisLoading && !analysis ? (
                <RecListSkeleton />
              ) : analysis ? (
                <RecommendationsTable
                  recommendations={visibleRecs}
                  signals={analysis.signals}
                  selectedRank={selectedRank}
                  showAll={showAllRecs}
                  onSelectRec={setSelectedRank}
                  onToggleShowAll={() => setShowAllRecs(p => !p)}
                />
              ) : (
                <div className="flex h-full min-h-[280px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface-canvas p-6 text-center">
                  <Search size={28} className="text-text-tertiary" />
                  <p className="mt-2 text-sm font-semibold text-text-secondary">Select a ticker to view recommendations.</p>
                  <p className="mt-1 text-xs text-text-tertiary">The selected strategy will open in the right frame.</p>
                </div>
              )}
            </div>
          </section>

          )}

          {centerTab === 'chart' && (
            <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface-card">
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                <div>
                  <h2 className="text-sm font-bold text-text-primary">Position Chart</h2>
                  <p className="mt-0.5 text-[11px] text-text-tertiary">Backend-supplied swing structure across daily, weekly, and monthly views.</p>
                </div>
                <button
                  type="button"
                  onClick={() => void loadPositionChart(true)}
                  className="rounded p-1 text-text-tertiary transition-colors hover:bg-surface-muted hover:text-text-primary"
                  title="Refresh position chart"
                  aria-label="Refresh position chart"
                >
                  <RefreshCw size={14} />
                </button>
              </div>
              <div className="min-h-[360px] flex-1 p-3">
                {positionChartLoading && !positionChart && (
                  <div className="flex h-full items-center justify-center text-sm text-text-tertiary">Loading session chart…</div>
                )}
                {positionChartError && (
                  <div className="rounded-lg border border-semantic-bearish-border bg-semantic-bearish-bg px-4 py-3">
                    <p className="text-xs text-semantic-bearish">{positionChartError}</p>
                    <button type="button" onClick={() => void loadPositionChart(true)} className="mt-2 text-xs font-semibold text-semantic-accent hover:underline">Retry</button>
                  </div>
                )}
                {positionChart && (
                  <div className="h-full overflow-hidden rounded-lg border border-border bg-surface-canvas">
                    <PositionSwingChart chart={positionChart} />
                  </div>
                )}
                {!positionChartLoading && !positionChart && !positionChartError && (
                  <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border text-sm text-text-tertiary">Select a ticker to view the session chart.</div>
                )}
              </div>
            </section>
          )}

          {centerTab === 'flow' && (
            <section className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border bg-surface-card">
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-bold text-text-primary">Options Flow</h2>
                <p className="mt-0.5 text-[11px] text-text-tertiary">Backend-aggregated chain volume, open interest, and volatility context.</p>
              </div>
              {analysis ? <OptionsFlowPanel analysis={analysis} /> : (
                <div className="flex min-h-[280px] items-center justify-center text-sm text-text-tertiary">Select a ticker to view options flow.</div>
              )}
            </section>
          )}

          {centerTab === 'levels' && (
            <section className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border bg-surface-card">
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-bold text-text-primary">Key Levels &amp; S/R</h2>
                <p className="mt-0.5 text-[11px] text-text-tertiary">Backend-provided support, resistance, trend references, and selected-trade breakeven.</p>
              </div>
              {analysis ? <KeyLevelsPanel analysis={analysis} selectedRank={selectedRank} /> : (
                <div className="flex min-h-[280px] items-center justify-center text-sm text-text-tertiary">Select a ticker to view key levels.</div>
              )}
            </section>
          )}

          {centerTab === 'recommendations' && selectedRank && (
            <section className="shrink-0 overflow-hidden rounded-xl border border-border bg-surface-card xl:hidden">
              <RightDetailPanel
                analysis={analysis}
                selectedRank={selectedRank}
                onSelectRec={setSelectedRank}
                onClose={() => setSelectedRank(null)}
                inline
              />
            </section>
          )}
        </div>

        {/* Disclaimer */}
        <div className="border-t border-border px-5 py-2 text-center text-[9px] text-text-tertiary opacity-50">
          For educational purposes only. Not financial advice. Options trading involves significant risk of loss.
        </div>
      </div>

      {/* Right divider — desktop only */}
      <div className="hidden xl:block">
        <DraggableDivider onMouseDown={handleRightPanelDragStart} />
      </div>

      {/* Right detail panel — desktop */}
      <div className={`hidden shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-white/[0.08] dark:bg-slate-950 xl:block ${
        rightPanelOpen ? '' : 'hidden'
      }`} style={{ width: rightPanelOpen ? rightPanelWidth : 0 }}>
        {analysisLoading && !analysis ? (
          <DetailPanelSkeleton />
        ) : (
          <RightDetailPanel
            analysis={analysis}
            selectedRank={selectedRank}
            onSelectRec={setSelectedRank}
            onClose={() => setRightPanelOpen(false)}
          />
        )}
      </div>

    </div>
    {sidebarMobileOpen && (
      <div className="fixed inset-0 z-50 xl:hidden">
        <button type="button" className="absolute inset-0 cursor-default bg-slate-950/45 backdrop-blur-[1px]" onClick={() => setSidebarMobileOpen(false)} aria-label="Close navigation" />
        <div className="absolute inset-y-0 left-0 w-80 max-w-[calc(100vw-2rem)] p-2">
          <LeftSidebar
            tickers={tickers}
            tickersLoading={tickersLoading}
            tickersError={tickersError}
            selectedSymbol={selectedSymbol}
            searchQuery={searchQuery}
            filters={filters}
            onSelectSymbol={symbol => {
              setSidebarMobileOpen(false)
              setSearchParams({ symbol: symbol.trim().toUpperCase() })
              void handleAnalyze(symbol)
            }}
            onSearchChange={setSearchQuery}
            onFilterChange={setFilters}
            onRefreshTickers={() => void loadTickers()}
            onAddTicker={() => routerNavigate('/my-tickers')}
            onClose={() => setSidebarMobileOpen(false)}
            embedded
          />
        </div>
      </div>
    )}
    {strategyGuideOpen && <StrategyGuideDialog strategy={currentSelectedRec?.strategy} onClose={() => setStrategyGuideOpen(false)} />}
    </div>
  )
}
