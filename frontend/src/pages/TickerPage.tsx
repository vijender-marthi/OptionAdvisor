import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate as useRouterNavigate } from 'react-router-dom'
import {
  Search, X, Plus, ChevronDown, ChevronRight, ChevronLeft, ChevronUp,
  Layers, AlertTriangle, Star, Check, RefreshCw, TrendingUp, TrendingDown,
  BarChart2, BookOpen, ArrowUpRight, Zap, Bell, Briefcase, Filter,
  Activity, Clock, DollarSign, Sparkles, Info, HelpCircle, Maximize2,
  Minimize2, ZoomIn, ZoomOut, RotateCcw, Focus, SlidersHorizontal,
  Eye, EyeOff,
} from 'lucide-react'
import { analyzeOptions, fetchPositionSessionChart } from '../api/client'
import type { PositionSessionChartResponse } from '../api/client'
import type { AnalyzeResponse, Recommendation, Signals, StrategyMode } from '../types'
import { useApp } from '../contexts/AppContext'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { getTradeWorksheetRoute } from '../routing/routes'
import type { MyTickerEntry } from '../api/commandCenter'
import {
  STRATEGY_OPTIONS, TIME_HORIZON_OPTIONS, BIAS_OPTIONS, REC_STATE_OPTIONS,
  DEFAULT_FILTERS,
} from '../types/positionTrading'
import type {
  FilterState, CenterTab, RecListTab, SidebarTab, ChartInterval,
  RecommendationState,
} from '../types/positionTrading'

import DayTradeWorkspaceChart from '../components/DayTradeWorkspaceChart'
import OptionProfitCalculator from '../components/OptionProfitCalculator'

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

function ChartSkeleton() {
  return (
    <div className="flex items-center justify-center rounded-xl border border-border bg-surface-card" style={{ height: 420 }}>
      <div className="text-center">
        <BarChart2 size={32} className="mx-auto text-text-tertiary" />
        <p className="mt-2 text-sm text-text-tertiary">Loading chart data…</p>
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
  sidebarTab,
  filters,
  onSelectSymbol,
  onSearchChange,
  onSidebarTabChange,
  onFilterChange,
  onRefreshTickers,
}: {
  tickers: MyTickerEntry[]
  tickersLoading: boolean
  tickersError: string | null
  selectedSymbol: string
  searchQuery: string
  sidebarTab: SidebarTab
  filters: FilterState
  onSelectSymbol: (symbol: string) => void
  onSearchChange: (query: string) => void
  onSidebarTabChange: (tab: SidebarTab) => void
  onFilterChange: (filters: FilterState) => void
  onRefreshTickers: () => void
}) {
  const filteredTickers = useMemo(() => {
    if (!searchQuery.trim()) return tickers
    const q = searchQuery.trim().toUpperCase()
    return tickers.filter(t =>
      t.symbol.toUpperCase().includes(q) ||
      (t.company_name || '').toUpperCase().includes(q),
    )
  }, [tickers, searchQuery])

  return (
    <div className="flex h-full flex-col border-r border-border bg-surface-card">
      {/* Tabs */}
      <div className="flex border-b border-border">
        {(['my-tickers', 'markets'] as SidebarTab[]).map(tab => (
          <button
            key={tab}
            type="button"
            onClick={() => onSidebarTabChange(tab)}
            className={`flex-1 px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider transition-colors ${
              sidebarTab === tab
                ? 'border-b-2 border-semantic-accent text-text-primary'
                : 'text-text-tertiary hover:text-text-secondary'
            }`}
          >
            {tab === 'my-tickers' ? 'My Tickers' : 'Markets'}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="border-b border-border p-3">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="Search tickers..."
            className="w-full rounded-lg border border-border bg-surface-canvas py-1.5 pl-8 pr-8 text-[12px] text-text-primary placeholder-text-tertiary outline-none focus:border-semantic-accent"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary"
            >
              <X size={14} />
            </button>
          )}
          <button
            type="button"
            onClick={onRefreshTickers}
            className="absolute right-8 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary"
            title="Refresh tickers"
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      {/* Quick filters */}
      <div className="border-b border-border p-3">
        <div className="mb-2 flex items-center gap-1.5">
          <Filter size={11} className="text-text-tertiary" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary">Filters</span>
        </div>
        <div className="space-y-1.5">
          <select
            value={filters.strategy}
            onChange={e => onFilterChange({ ...filters, strategy: e.target.value })}
            className="w-full rounded-md border border-border bg-surface-canvas px-2 py-1 text-[11px] text-text-primary outline-none"
          >
            {STRATEGY_OPTIONS.map(o => (
              <option key={o} value={o === 'All Strategies' ? 'all' : o}>{o}</option>
            ))}
          </select>
          <select
            value={filters.timeHorizon}
            onChange={e => onFilterChange({ ...filters, timeHorizon: e.target.value })}
            className="w-full rounded-md border border-border bg-surface-canvas px-2 py-1 text-[11px] text-text-primary outline-none"
          >
            {TIME_HORIZON_OPTIONS.map(o => (
              <option key={o} value={o === 'All Horizons' ? 'all' : o}>{o}</option>
            ))}
          </select>
          <select
            value={filters.bias}
            onChange={e => onFilterChange({ ...filters, bias: e.target.value })}
            className="w-full rounded-md border border-border bg-surface-canvas px-2 py-1 text-[11px] text-text-primary outline-none"
          >
            {BIAS_OPTIONS.map(o => (
              <option key={o} value={o === 'All Biases' ? 'all' : o}>{o}</option>
            ))}
          </select>
          <select
            value={filters.recState}
            onChange={e => onFilterChange({ ...filters, recState: e.target.value })}
            className="w-full rounded-md border border-border bg-surface-canvas px-2 py-1 text-[11px] text-text-primary outline-none"
          >
            {REC_STATE_OPTIONS.map(o => (
              <option key={o} value={o === 'All' ? 'all' : o}>{o}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-[11px] text-text-secondary">
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

      {/* Ticker list */}
      <div className="flex-1 overflow-y-auto">
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

      {/* Add ticker */}
      <div className="border-t border-border p-3">
        <button
          type="button"
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border-strong py-2 text-[11px] font-bold text-text-tertiary transition-colors hover:border-semantic-accent hover:text-semantic-accent"
        >
          <Plus size={14} />
          Add Ticker
        </button>
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
      <div ref={tableRef} className="overflow-x-auto rounded-xl border border-border" tabIndex={0} onKeyDown={handleKeyDown} role="listbox" aria-label="Recommendations list">
        <table className="w-full min-w-[700px]">
          <thead>
            <tr className="border-b border-border bg-surface-muted/30">
              {['#', 'Strategy', 'Bias', 'Confidence', 'EV', 'R:R', 'Expiry', 'DTE', 'State'].map(h => (
                <th key={h} className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-text-tertiary">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {display.map(rec => {
              const state = stateStatus(rec)
              const score = rec.scores?.total_score ?? 0
              const isCredit = (rec.net_credit ?? 0) > 0
              const ev = rec.expected_value ?? 0
              const rr = rec.risk_reward_ratio ?? 0
              const isSelected = selectedRank === rec.rank
              const firstLeg = rec.legs[0]
              const breakeven = rec.breakeven_lower
                ? fmtUsd(rec.breakeven_lower)
                : rec.breakeven_upper
                ? fmtUsd(rec.breakeven_upper)
                : '—'

              return (
                <tr
                  key={rec.rank}
                  onClick={() => onSelectRec(isSelected ? null : rec.rank)}
                  className={`cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-surface-muted/20 ${
                    isSelected ? 'bg-semantic-accent/5' : ''
                  } ${isSelected ? 'outline outline-1 outline-semantic-accent' : ''}`}
                >
                  <td className="px-3 py-2.5 font-mono text-[11px] text-text-tertiary">{rec.rank}</td>
                  <td className="px-3 py-2.5">
                    <div className="text-[12px] font-semibold text-text-primary">{rec.strategy}</div>
                    <div className="mt-0.5 flex gap-1.5">
                      {rec.legs.slice(0, 2).map((leg, i) => (
                        <span key={i} className={`font-mono text-[9px] ${leg.action === 'BUY' ? 'text-semantic-bullish' : 'text-semantic-bearish'}`}>
                          {leg.action === 'BUY' ? '+' : '–'}${(leg.strike ?? 0).toFixed(0)}{leg.option_type === 'CALL' ? 'C' : 'P'}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-block rounded-full px-1.5 py-0.5 text-[9px] font-bold ${biasBg(rec.bias)} ${biasColor(rec.bias)}`}>
                      {rec.bias}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <div className="h-1.5 w-12 overflow-hidden rounded-full bg-surface-muted">
                        <div
                          className={`h-full rounded-full ${
                            score >= 75 ? 'bg-semantic-bullish' : score >= 55 ? 'bg-semantic-warning' : 'bg-semantic-bearish'
                          }`}
                          style={{ width: `${Math.min(score, 100)}%` }}
                        />
                      </div>
                      <span className={`font-mono text-[11px] font-bold ${stateColor(state)}`}>{score}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[12px] font-bold text-text-primary">
                    {fmtUsd(ev * 100)}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[12px] font-bold text-text-primary">
                    {rr > 0 ? `1:${rr.toFixed(1)}` : '—'}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-text-secondary">
                    {rec.expiry.slice(5)}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-text-secondary">
                    {rec.dte}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-block rounded-full border px-2 py-0.5 text-[9px] font-bold ${stateBg(state)} ${stateColor(state)} ${stateBorder(state)}`}>
                      {state}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
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

// ─── Right Detail Panel ──────────────────────────────────────────────────────

function RightDetailPanel({
  analysis,
  selectedRank,
  onSelectRec,
  onClose,
}: {
  analysis: AnalyzeResponse | null
  selectedRank: number | null
  onSelectRec: (rank: number | null) => void
  onClose: () => void
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
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-bold text-text-primary">{rec.strategy}</span>
            <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold ${stateBg(state)} ${stateColor(state)} ${stateBorder(state)}`}>
              {state}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-text-tertiary">
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

      {/* Contract summary */}
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${biasBg(rec.bias)} ${biasColor(rec.bias)}`}>
            {rec.bias}
          </span>
          <span className="font-mono text-[12px] text-text-secondary">{rec.legs.map(l => `${l.action === 'BUY' ? '+' : '–'}${l.option_type} $${(l.strike ?? 0).toFixed(0)}`).join(' | ')}</span>
        </div>
        <div className="mt-1.5 font-mono text-[11px] text-text-tertiary">
          {rec.expiry} · {rec.dte} DTE
        </div>
      </div>

      {/* Key Rationale */}
      <div className="border-b border-border px-4 py-3">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-text-tertiary">Key Rationale</div>
        <div className="space-y-1.5">
          {[
            ...(rec.rationale ? rec.rationale.split(/[.!?]\s*/).filter(Boolean).slice(0, 4).map(r => ({ label: r.trim(), pass: true })) : []),
            ...(rec.warnings?.slice(0, 2).map(w => ({ label: w, pass: false })) ?? []),
          ].length > 0 ? (
            (rec.rationale ? rec.rationale.split(/[.!?]\s*/).filter(Boolean).slice(0, 4).map(r => ({ label: r.trim(), pass: true })) : []).concat(
              rec.warnings?.slice(0, 2).map(w => ({ label: w, pass: false })) ?? []
            ).map((item, i) => (
              <div key={i} className="flex items-start gap-2">
                {item.pass ? (
                  <Check size={12} className="mt-0.5 shrink-0 text-semantic-bullish" />
                ) : (
                  <AlertTriangle size={12} className="mt-0.5 shrink-0 text-semantic-warning" />
                )}
                <span className={`text-[11px] leading-snug ${item.pass ? 'text-text-secondary' : 'text-semantic-warning'}`}>
                  {item.label}
                </span>
              </div>
            ))
          ) : (
            <p className="text-[11px] italic text-text-tertiary">No detailed rationale available.</p>
          )}
        </div>
        {!!rec.warnings?.length && (
          <div className="mt-2 rounded-md border border-semantic-warning-border bg-semantic-warning-bg px-2 py-1.5">
            <p className="text-[10px] text-semantic-warning">{rec.warnings[0]}</p>
          </div>
        )}
      </div>

      {/* Trade Details */}
      <div className="border-b border-border px-4 py-3">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-text-tertiary">Trade Details</div>
        <div className="grid grid-cols-2 gap-2">
          <Metric label="Strike" value={firstLegStrike(rec)} />
          <Metric label={isCredit ? 'Credit' : 'Debit'} value={fmtUsd(Math.abs(rec.net_credit ?? 0))} />
          <Metric label="Expiry" value={rec.expiry.slice(5)} />
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
        <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-text-tertiary">Risk Profile</div>
        <OptionProfitCalculator
          recommendations={[rec]}
          currentPrice={analysis.signals.current_price}
        />
      </div>

      {/* Recent Performance */}
      <div className="border-b border-border px-4 py-3">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-text-tertiary">Recent Performance</div>
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
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'bullish' | 'bearish' | 'neutral' }) {
  return (
    <div className="rounded-md border border-border bg-surface-canvas px-2 py-1.5">
      <div className="text-[9px] text-text-tertiary">{label}</div>
      <div className={`font-mono text-[11px] font-bold ${
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
  return `${leg.action === 'BUY' ? '+' : '–'} $${(leg.strike ?? 0).toFixed(1)}`
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

  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('my-tickers')
  const [centerTab, setCenterTab] = useState<CenterTab>('overview')
  const [recListTab, setRecListTab] = useState<RecListTab>('list')
  const [chartInterval, setChartInterval] = useState<ChartInterval>('5m')
  const [searchQuery, setSearchQuery] = useState('')
  const [showAllRecs, setShowAllRecs] = useState(false)
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS)

  const [rightPanelOpen, setRightPanelOpen] = useState(true)
  const [rightPanelWidth, setRightPanelWidth] = useState(380)
  const [centerChartRatio, setCenterChartRatio] = useState(0.5)

  const rightPanelRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const centerChartRef = useRef<{ startX: number; startRatio: number } | null>(null)

  const handleRightPanelDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = rightPanelWidth
    rightPanelRef.current = { startX, startWidth }

    const handleMouseMove = (ev: MouseEvent) => {
      if (!rightPanelRef.current) return
      const delta = rightPanelRef.current.startX - ev.clientX
      const newWidth = Math.max(280, Math.min(600, rightPanelRef.current.startWidth + delta))
      setRightPanelWidth(newWidth)
    }
    const handleMouseUp = () => {
      rightPanelRef.current = null
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [rightPanelWidth])

  const handleCenterChartDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startRatio = centerChartRatio
    centerChartRef.current = { startX: startY, startRatio }

    const handleMouseMove = (ev: MouseEvent) => {
      if (!centerChartRef.current) return
      const container = (ev.target as HTMLElement).closest('[data-center-split]')
      if (!container) return
      const rect = container.getBoundingClientRect()
      const delta = ev.clientY - centerChartRef.current.startX
      const ratioDelta = delta / rect.height
      const newRatio = Math.max(0.25, Math.min(0.75, centerChartRef.current.startRatio + ratioDelta))
      setCenterChartRatio(newRatio)
    }
    const handleMouseUp = () => {
      centerChartRef.current = null
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [centerChartRatio])

  const [positionChart, setPositionChart] = useState<PositionSessionChartResponse | null>(null)
  const [positionChartLoading, setPositionChartLoading] = useState(false)
  const [positionChartError, setPositionChartError] = useState('')

  const didRun = useRef(false)
  const didRestoreLastAnalysis = useRef(false)

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
      const { fetchMyTickers } = await import('../api/commandCenter')
      const result = await fetchMyTickers()
      setTickers(result.data?.tickers ?? [])
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
      void handleAnalyze(pendingTicker, weeksOut, spreadWidth, strategyMode)
    }
  }, [pendingTicker, pendingAnalysisOptions, clearPendingTicker, handleAnalyze])

  useEffect(() => {
    if (!pendingTicker) didRun.current = false
  }, [pendingTicker])

  // ── Chart loading ────────────────────────────────────────────────────────

  const loadChart = useCallback(async (forceRefresh = false) => {
    if (!selectedSymbol) {
      setPositionChart(null)
      return
    }
    setPositionChartLoading(true)
    setPositionChartError('')
    try {
      const response = await fetchPositionSessionChart({
        symbol: selectedSymbol,
        interval: chartInterval,
        forceRefresh,
      })
      setPositionChart(response)
    } catch (err) {
      setPositionChartError(err instanceof Error ? err.message : 'Chart load failed')
      setPositionChart(null)
    } finally {
      setPositionChartLoading(false)
    }
  }, [selectedSymbol, chartInterval])

  useEffect(() => {
    if (!selectedSymbol) return
    void loadChart(false)
  }, [selectedSymbol, loadChart])

  // ── Selected recommendation ──────────────────────────────────────────────

  const currentRecs = analysis?.recommendations ?? []
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
    <div className="flex h-full min-h-0">
      {/* Left sidebar */}
      <div className="hidden w-[260px] shrink-0 border-r border-border lg:block">
        <LeftSidebar
          tickers={tickers}
          tickersLoading={tickersLoading}
          tickersError={tickersError}
          selectedSymbol={selectedSymbol}
          searchQuery={searchQuery}
          sidebarTab={sidebarTab}
          filters={filters}
          onSelectSymbol={symbol => void handleAnalyze(symbol)}
          onSearchChange={setSearchQuery}
          onSidebarTabChange={setSidebarTab}
          onFilterChange={setFilters}
          onRefreshTickers={() => void loadTickers()}
        />
      </div>

      {/* Center workspace */}
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        {/* Page header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-lg font-bold text-text-primary">Position Trading</h1>
              <p className="text-[11px] text-text-tertiary">AI-powered options recommendations with clear rationale and risk management.</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-card p-0.5">
            <button
              type="button"
              onClick={() => routerNavigate(preTradeRoute)}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] font-bold text-semantic-bullish transition-colors hover:bg-semantic-bullish-bg"
            >
              <ArrowUpRight size={13} />
              Pre-Trade Analysis
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] font-bold text-text-secondary transition-colors hover:bg-surface-muted"
            >
              <Briefcase size={13} />
              Active Positions
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] font-bold text-text-secondary transition-colors hover:bg-surface-muted"
            >
              <BookOpen size={13} />
              Strategy Guide
            </button>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-4 px-5 py-4 min-h-0">
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

          {/* Center tabs */}
          <div className="flex items-center gap-1 rounded-lg border border-border bg-surface-card p-0.5 shrink-0">
            {([
              { key: 'overview' as CenterTab, label: 'Overview' },
              { key: 'chart' as CenterTab, label: 'Chart' },
              { key: 'key-levels' as CenterTab, label: 'Key Levels' },
              { key: 'flow' as CenterTab, label: 'Flow' },
              { key: 'news' as CenterTab, label: 'News' },
            ]).map(tab => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setCenterTab(tab.key)}
                className={`flex-1 rounded-md px-3 py-1.5 text-[11px] font-bold transition-colors ${
                  centerTab === tab.key
                    ? 'bg-surface-muted text-text-primary'
                    : 'text-text-tertiary hover:text-text-secondary'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Overview content — recommendations top, chart bottom (50/50) */}
          {centerTab === 'overview' && (
            <div className="flex min-h-0 flex-1 flex-col gap-3" data-center-split>
              {/* Recommendations — top */}
              <div className="flex flex-col overflow-hidden" style={{ flex: centerChartRatio }}>
                <div className="mb-2 flex items-center justify-between shrink-0">
                  <span className="text-[13px] font-bold text-text-primary">Recommendations</span>
                  <div className="flex items-center gap-1 rounded-lg border border-border bg-surface-card p-0.5">
                    {([
                      { key: 'list' as RecListTab, label: 'List' },
                      { key: 'performance' as RecListTab, label: 'Performance' },
                      { key: 'history' as RecListTab, label: 'History' },
                    ]).map(tab => (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => setRecListTab(tab.key)}
                        className={`rounded-md px-2 py-0.5 text-[10px] font-bold transition-colors ${
                          recListTab === tab.key
                            ? 'bg-surface-muted text-text-primary'
                            : 'text-text-tertiary hover:text-text-secondary'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto">
                  {recListTab === 'list' && (
                    analysisLoading && !analysis ? (
                      <RecListSkeleton />
                    ) : analysis ? (
                      <RecommendationsTable
                        recommendations={analysis.recommendations}
                        signals={analysis.signals}
                        selectedRank={selectedRank}
                        showAll={showAllRecs}
                        onSelectRec={setSelectedRank}
                        onToggleShowAll={() => setShowAllRecs(p => !p)}
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-surface-card py-12">
                        <Search size={28} className="text-text-tertiary" />
                        <p className="mt-2 text-sm text-text-tertiary">Select a ticker to view recommendations.</p>
                      </div>
                    )
                  )}

                  {recListTab === 'performance' && (
                    <div className="rounded-xl border border-border bg-surface-card p-4">
                      {analysis ? (
                        <>
                          <div className="mb-3 flex items-center justify-between">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary">Strategy Performance</span>
                            <span className="text-[10px] text-text-tertiary">Powerd by backend</span>
                          </div>
                          <div className="grid grid-cols-4 gap-2">
                            <Metric label="Win Rate" value="—" />
                            <Metric label="Avg P&L" value="—" />
                            <Metric label="Median P&L" value="—" />
                            <Metric label="Avg Hold" value="—" />
                            <Metric label="Trades" value="—" />
                            <Metric label="Max DD" value="—" />
                            <Metric label="Best Trade" value="—" />
                            <Metric label="Worst Trade" value="—" />
                          </div>
                          <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-surface-canvas px-3 py-2">
                            <BarChart2 size={14} className="text-text-tertiary" />
                            <p className="text-[11px] text-text-tertiary">
                              Strategy-level performance metrics will appear here when the backend provides them.
                            </p>
                          </div>
                        </>
                      ) : (
                        <div className="flex flex-col items-center justify-center py-8">
                          <Activity size={28} className="text-text-tertiary" />
                          <p className="mt-2 text-sm text-text-tertiary">Select a ticker to view performance metrics.</p>
                        </div>
                      )}
                    </div>
                  )}

                  {recListTab === 'history' && (
                    <div className="rounded-xl border border-border bg-surface-card p-4">
                      {analysis ? (
                        <>
                          <div className="mb-3 flex items-center justify-between">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary">Recommendation History</span>
                            <span className="text-[10px] text-text-tertiary">Powerd by backend</span>
                          </div>
                          <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-surface-canvas py-8">
                            <Clock size={28} className="text-text-tertiary" />
                            <p className="mt-2 text-sm text-text-tertiary">Past recommendation decisions will appear here.</p>
                            <div className="mt-3 grid grid-cols-3 gap-x-6 gap-y-1 text-[11px] text-text-tertiary">
                              <span>Date & Time</span>
                              <span>Ticker · Strategy</span>
                              <span>State · Result</span>
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="flex flex-col items-center justify-center py-8">
                          <Clock size={28} className="text-text-tertiary" />
                          <p className="mt-2 text-sm text-text-tertiary">Select a ticker to view recommendation history.</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Divider */}
              <DraggableDivider horizontal onMouseDown={handleCenterChartDragStart} />

              {/* Chart — bottom */}
              <div className="flex flex-col overflow-hidden" style={{ flex: 1 - centerChartRatio }}>
                <div className="mb-2 flex items-center justify-between shrink-0">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary">Market Context</span>
                  <div className="flex items-center gap-1">
                    {(['1m', '5m', '15m', '1h'] as ChartInterval[]).map(iv => (
                      <button
                        key={iv}
                        type="button"
                        onClick={() => setChartInterval(iv)}
                        className={`rounded px-2 py-0.5 font-mono text-[10px] font-bold transition-colors ${
                          chartInterval === iv
                            ? 'bg-semantic-accent text-white'
                            : 'text-text-tertiary hover:text-text-primary'
                        }`}
                      >
                        {iv === '1m' ? '1m' : iv === '5m' ? '5m' : iv === '15m' ? '15m' : '1h'}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => void loadChart(true)}
                      className="rounded p-0.5 text-text-tertiary hover:text-text-primary"
                      title="Refresh chart"
                    >
                      <RefreshCw size={12} />
                    </button>
                  </div>
                </div>

                <div className="flex-1 min-h-0">
                  {analysisLoading && !positionChart && <ChartSkeleton />}
                  {positionChartError && (
                    <div className="rounded-xl border border-semantic-bearish-border bg-semantic-bearish-bg px-4 py-3">
                      <p className="text-xs text-semantic-bearish">{positionChartError}</p>
                      <button
                        type="button"
                        onClick={() => void loadChart(true)}
                        className="mt-1 text-xs text-semantic-accent hover:underline"
                      >
                        Retry
                      </button>
                    </div>
                  )}
                  {positionChart && (
                    <div className="overflow-hidden rounded-xl border border-border bg-surface-card h-full" style={{ minHeight: 200 }}>
                      <DayTradeWorkspaceChart
                        chart={positionChart.chart}
                        marketTimeZone={positionChart.session.marketTimeZone}
                        activeInterval={chartInterval as any}
                        onIntervalChange={(iv: any) => setChartInterval(iv as ChartInterval)}
                        rangeOptions={['1h', '2h', '7d']}
                      />
                    </div>
                  )}
                  {!analysisLoading && !positionChart && !positionChartError && (
                    <div className="flex items-center justify-center rounded-xl border border-border bg-surface-card h-full" style={{ minHeight: 200 }}>
                      <p className="text-sm text-text-tertiary">Select a ticker to view chart data.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Chart tab — full chart only */}
          {centerTab === 'chart' && (
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <div className="flex items-center justify-between shrink-0">
                <span className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary">Market Context</span>
                <div className="flex items-center gap-1">
                  {(['1m', '5m', '15m', '1h'] as ChartInterval[]).map(iv => (
                    <button
                      key={iv}
                      type="button"
                      onClick={() => setChartInterval(iv)}
                      className={`rounded px-2 py-0.5 font-mono text-[10px] font-bold transition-colors ${
                        chartInterval === iv
                          ? 'bg-semantic-accent text-white'
                          : 'text-text-tertiary hover:text-text-primary'
                      }`}
                    >
                      {iv === '1m' ? '1m' : iv === '5m' ? '5m' : iv === '15m' ? '15m' : '1h'}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => void loadChart(true)}
                    className="rounded p-0.5 text-text-tertiary hover:text-text-primary"
                    title="Refresh chart"
                  >
                    <RefreshCw size={12} />
                  </button>
                </div>
              </div>
              <div className="flex-1 min-h-0">
                {analysisLoading && !positionChart && <ChartSkeleton />}
                {positionChartError && (
                  <div className="rounded-xl border border-semantic-bearish-border bg-semantic-bearish-bg px-4 py-3">
                    <p className="text-xs text-semantic-bearish">{positionChartError}</p>
                    <button
                      type="button"
                      onClick={() => void loadChart(true)}
                      className="mt-1 text-xs text-semantic-accent hover:underline"
                    >
                      Retry
                    </button>
                  </div>
                )}
                {positionChart && (
                  <div className="overflow-hidden rounded-xl border border-border bg-surface-card h-full">
                    <DayTradeWorkspaceChart
                      chart={positionChart.chart}
                      marketTimeZone={positionChart.session.marketTimeZone}
                      activeInterval={chartInterval as any}
                      onIntervalChange={(iv: any) => setChartInterval(iv as ChartInterval)}
                      rangeOptions={['1h', '2h', '7d']}
                    />
                  </div>
                )}
                {!analysisLoading && !positionChart && !positionChartError && (
                  <div className="flex items-center justify-center rounded-xl border border-border bg-surface-card h-full">
                    <p className="text-sm text-text-tertiary">Select a ticker to view chart data.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Other tab placeholders */}
          {centerTab !== 'overview' && centerTab !== 'chart' && (
            <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-surface-card py-16">
              <BarChart2 size={32} className="text-text-tertiary" />
              <p className="mt-2 text-sm text-text-tertiary">
                {centerTab === 'key-levels' ? 'Key Levels & S/R — coming soon.' :
                 centerTab === 'flow' ? 'Options Flow — coming soon.' :
                 'News & Events — coming soon.'}
              </p>
            </div>
          )}
        </div>

        {/* Disclaimer */}
        <div className="border-t border-border px-5 py-2 text-center text-[9px] text-text-tertiary opacity-50">
          For educational purposes only. Not financial advice. Options trading involves significant risk of loss.
        </div>
      </div>

      {/* Right divider — desktop only */}
      <div className="hidden lg:block">
        <DraggableDivider onMouseDown={handleRightPanelDragStart} />
      </div>

      {/* Right detail panel — desktop */}
      <div className={`hidden shrink-0 border-l border-border bg-surface-card lg:block ${
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

      {/* Right detail panel — mobile drawer overlay */}
      {rightPanelOpen && selectedRank && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setRightPanelOpen(false)}
          />
          <div className="absolute right-0 top-0 h-full w-[85vw] max-w-[380px] border-l border-border bg-surface-card shadow-2xl overflow-y-auto">
            <div className="sticky top-0 flex items-center justify-between border-b border-border bg-surface-card px-4 py-3 z-10">
              <span className="text-[13px] font-bold text-text-primary">Trade Details</span>
              <button
                type="button"
                onClick={() => setRightPanelOpen(false)}
                className="rounded p-1 text-text-tertiary hover:text-text-primary"
              >
                <X size={16} />
              </button>
            </div>
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
      )}

      {/* Mobile FAB — show only when panel is closed and a rec is selected */}
      {selectedRank && !rightPanelOpen && (
        <button
          type="button"
          onClick={() => setRightPanelOpen(true)}
          className="fixed bottom-4 right-4 z-30 flex items-center gap-1.5 rounded-full bg-semantic-accent px-3 py-2 text-xs font-bold text-white shadow-lg lg:hidden"
        >
          <ChevronLeft size={14} />
          Details
        </button>
      )}
    </div>
  )
}
