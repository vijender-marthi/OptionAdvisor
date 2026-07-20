import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowDown, ArrowLeft, ArrowUpRight, BarChart2, Bell, ChevronDown, ChevronLeft, ChevronRight,
  Clock, Flame, Layers, Loader2, MessageSquare, RefreshCw, Search, ShieldAlert, X, Zap,
  PlusCircle, Activity, Check, Gauge,
} from 'lucide-react'
import { analyzeDayTrade, analyzeV2, deskApi, enterActiveTrade, saveToJournal, deriveUnifiedFromDayResult } from '../api/client'
import type { DayTradeScanResult, DayTradeWorkspaceAction, DeskAlertCreate, UnifiedAnalysis } from '../api/client'
import type { DayTradeAlertEvent, TradeEntryState } from '../types'
import { fetchMyTickers, type MyTickerEntry } from '../api/commandCenter'
import SetAlertDrawer from '../components/desk/SetAlertDrawer'
import DayTradeIntradayChart, { parseChartBars, resampleBars, orMinutesForInterval, type ChartEntryPoint, type ZoneAnnotation, type ChartInterval } from '../components/DayTradeIntradayChart'
import DayTradeAlertOverlay from '../components/DayTradeAlertOverlay'
import DayTradeWalkthrough from '../components/DayTradeWalkthrough'
import OptionsEntryCheck from '../components/OptionsEntryCheck'
import { MarketTimeGateBanner } from '../components/MarketTimeGate'
import EntryWindowBanner from '../components/EntryWindowBanner'
import TrendDayBanner from '../components/TrendDayBanner'
import DayTradeStrategiesTab from '../components/DayTradeStrategiesTab'
import DayTradeChat from '../components/DayTradeChat'
import {
  SessionStatusBar,
  TradeDecisionHeader,
  TradeDecisionPanel,
  WorkspaceChartPreview,
  WorkspaceDetailTabs,
} from '../components/DayTradeWorkspaceShell'
import { useApp } from '../contexts/AppContext'
import { useDayTradeWorkspace } from '../hooks/useDayTradeWorkspace'
import { ROUTES, getTradeWorksheetRoute } from '../routing/routes'
import { getActionButtonClass } from '../utils/semanticTrading'

/* ── PCRatioStrip ─────────────────────────────────────────────────────── */

function fmtOptionsVol(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`
  return String(v)
}

type DayTradeTimeframeState = NonNullable<DayTradeScanResult['timeframe_state']>
type SidebarTickerGroupKey = 'day' | 'regular' | 'swing'
type SidebarTickerFilterKey = SidebarTickerGroupKey | 'all'

const SIDEBAR_TICKER_GROUPS: Array<{ key: SidebarTickerGroupKey; title: string; empty: string }> = [
  { key: 'day', title: 'Day Trade Tickers', empty: 'No Day Trade tickers saved. Add tickers from My Ticker List.' },
  { key: 'regular', title: 'Position Trading Tickers', empty: 'No Position Trading tickers saved. Add tickers from My Ticker List.' },
  { key: 'swing', title: 'Swing Trading Tickers', empty: 'No Swing Trading tickers saved. Add tickers from My Ticker List.' },
]

const DAY_TRADE_SIDEBAR_FILTERS: Array<{ key: SidebarTickerFilterKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'day', label: 'Day Trade' },
  { key: 'regular', label: 'Position' },
  { key: 'swing', label: 'Swing' },
]

function normalizeTickerGroup(value: string): SidebarTickerGroupKey | null {
  const v = String(value || '').trim().toUpperCase()
  if (v === 'DAY' || v === 'DAY_TRADE' || v === 'DAYTRADE') return 'day'
  if (v === 'REGULAR' || v === 'POSITION' || v === 'POSITION_TRADE' || v === 'POSITIONTRADING') return 'regular'
  if (v === 'SWING' || v === 'SWING_TRADE' || v === 'SWINGTRADE') return 'swing'
  return null
}

function tickerGroupsFor(item: MyTickerEntry): Set<SidebarTickerGroupKey> {
  const rawTypes = [
    ...(Array.isArray(item.trade_types) ? item.trade_types : []),
    ...(Array.isArray((item as any).categories) ? (item as any).categories : []),
  ]
  return new Set(rawTypes.map(normalizeTickerGroup).filter(Boolean) as SidebarTickerGroupKey[])
}

function sortSidebarTickers(items: MyTickerEntry[]): MyTickerEntry[] {
  return [...items].sort((a, b) => {
    const pa = Number((a as any).priority ?? Number.POSITIVE_INFINITY)
    const pb = Number((b as any).priority ?? Number.POSITIVE_INFINITY)
    if (pa !== pb) return pa - pb
    const aa = (a as any).isActive ?? a.is_active ?? true
    const bb = (b as any).isActive ?? b.is_active ?? true
    if (aa !== bb) return aa ? -1 : 1
    return a.symbol.localeCompare(b.symbol)
  })
}

function daySidebarMoney(value: unknown): string {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : null
  return n == null ? '—' : `$${n.toFixed(2)}`
}

function daySidebarPct(value: unknown): string {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : null
  if (n == null) return '—'
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

function DayTradeLeftSidebar({
  ticker,
  resultTicker,
  loading,
  width,
  groups,
  onTickerChange,
  onRun,
  onListScroll,
  initialListScrollTop,
  onManage,
  onScanner,
  onAlerts,
  onPositions,
  onJournal,
}: {
  ticker: string
  resultTicker: string
  loading: boolean
  width: number
  groups: Array<{ key: SidebarTickerGroupKey; title: string; empty: string; items: MyTickerEntry[] }>
  onTickerChange: (value: string) => void
  onRun: (ticker?: string) => void
  onListScroll: (scrollTop: number) => void
  initialListScrollTop: number
  onManage: () => void
  onScanner: () => void
  onAlerts: () => void
  onPositions: () => void
  onJournal: () => void
}) {
  const selectedTicker = resultTicker.trim().toUpperCase()
  const [activeFilter, setActiveFilter] = useState<SidebarTickerFilterKey>(() => {
    try {
      const saved = localStorage.getItem('day_trade_watchlist_filter') as SidebarTickerFilterKey | null
      return saved && DAY_TRADE_SIDEBAR_FILTERS.some(item => item.key === saved) ? saved : 'day'
    } catch {
      return 'day'
    }
  })
  const [watchlistSearchText, setWatchlistSearchText] = useState(() => {
    try {
      return localStorage.getItem('day_trade_watchlist_search') || ''
    } catch {
      return ''
    }
  })
  const listRef = useRef<HTMLDivElement | null>(null)
  const filteredTickers = useMemo(() => {
    const rows = new Map<string, { item: MyTickerEntry; groups: Set<SidebarTickerGroupKey> }>()
    groups.forEach(group => {
      if (activeFilter !== 'all' && group.key !== activeFilter) return
      group.items.forEach(item => {
        const sym = item.symbol.toUpperCase()
        const existing = rows.get(sym)
        if (existing) {
          existing.groups.add(group.key)
        } else {
          rows.set(sym, { item, groups: new Set([group.key]) })
        }
      })
    })
    const query = watchlistSearchText.trim().toUpperCase()
    return Array.from(rows.values()).filter(row => {
      if (!query) return true
      return row.item.symbol.toUpperCase().includes(query) || String(row.item.company_name || '').toUpperCase().includes(query)
    })
  }, [activeFilter, groups, watchlistSearchText])

  useEffect(() => {
    if (listRef.current && initialListScrollTop > 0) {
      listRef.current.scrollTop = initialListScrollTop
    }
  }, [initialListScrollTop])

  useEffect(() => {
    try { localStorage.setItem('day_trade_watchlist_filter', activeFilter) } catch { /* quota */ }
  }, [activeFilter])

  useEffect(() => {
    try { localStorage.setItem('day_trade_watchlist_search', watchlistSearchText) } catch { /* quota */ }
  }, [watchlistSearchText])

  return (
    <aside
      className="sticky top-3 flex h-[calc(100vh-1.5rem)] shrink-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-3 dark:border-white/[0.08] dark:bg-slate-950"
      style={{ width, minWidth: 240, maxWidth: 380 }}
    >
      <div className="mb-3 flex items-start justify-between">
        <div>
          <div className="text-[11px] font-black uppercase tracking-widest text-tertiary">Day Workstation</div>
          <div className="mt-1 flex items-center gap-2">
            <Activity size={16} className="text-violet-500" />
            <span className="text-lg font-black text-heading">Day Trade</span>
          </div>
        </div>
        <div className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-violet-700 dark:text-violet-200">
          My Tickers
        </div>
      </div>

      <section className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/[0.07] dark:bg-slate-900/60">
        <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-tertiary">Search My Tickers</div>
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-2 dark:border-white/[0.08] dark:bg-slate-950">
          <Search size={14} className="text-tertiary" />
          <input
            value={watchlistSearchText}
            onChange={event => setWatchlistSearchText(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-heading outline-none placeholder:text-tertiary"
            placeholder="Symbol or company"
            autoComplete="off"
            spellCheck={false}
            aria-label="Search My Tickers"
          />
          {watchlistSearchText && (
            <button
              type="button"
              onClick={() => setWatchlistSearchText('')}
              className="rounded-md p-1 text-tertiary hover:bg-slate-100 hover:text-heading dark:hover:bg-slate-900"
              aria-label="Clear ticker search"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/[0.07] dark:bg-slate-900/60">
        <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-tertiary">Analyze</div>
        <div className="flex gap-2">
          <input
            value={ticker}
            onChange={event => onTickerChange(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') onRun() }}
            className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm font-black uppercase text-heading outline-none focus:border-violet-500 dark:border-white/[0.08] dark:bg-slate-950"
            placeholder="AAPL"
            autoComplete="off"
            spellCheck={false}
            aria-label="Analyze ticker"
          />
          <button
            type="button"
            disabled={loading}
            onClick={() => onRun()}
            className="rounded-lg bg-violet-600 px-3 py-2 text-white hover:bg-violet-500 disabled:opacity-60"
            aria-label="Analyze ticker"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search size={16} />}
          </button>
        </div>
        {selectedTicker && (
          <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/[0.08] dark:bg-slate-950">
            <div className="font-mono text-xl font-black text-heading">{selectedTicker}</div>
            <div className="truncate text-xs text-secondary">Backend Day Trade workspace</div>
          </div>
        )}
      </section>

      <section className="mt-3 flex min-h-0 flex-1 flex-col">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[10px] font-black uppercase tracking-widest text-tertiary">My Tickers</div>
          <div className="flex items-center gap-2">
            <button type="button" className="text-[10px] font-bold text-violet-600 dark:text-violet-300" onClick={onManage}>
              Add Ticker
            </button>
            <button type="button" className="text-[10px] font-bold text-violet-600 dark:text-violet-300" onClick={onManage}>
              Manage
            </button>
          </div>
        </div>
        <div className="mb-2 grid grid-cols-2 gap-1.5">
          {DAY_TRADE_SIDEBAR_FILTERS.map(filter => (
            <button
              key={filter.key}
              type="button"
              onClick={() => setActiveFilter(filter.key)}
              className={`rounded-lg border px-2 py-1.5 text-[10px] font-black uppercase tracking-wide transition ${
                activeFilter === filter.key
                  ? 'border-violet-500 bg-violet-500/10 text-violet-700 dark:text-violet-200'
                  : 'border-slate-200 bg-white text-secondary hover:border-violet-300 dark:border-white/[0.08] dark:bg-slate-950'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <div
          ref={listRef}
          className="min-h-0 flex-1 space-y-2 overflow-auto"
          onScroll={event => onListScroll(event.currentTarget.scrollTop)}
        >
          {filteredTickers.length ? filteredTickers.map(({ item, groups: itemGroups }) => {
            const sym = item.symbol.toUpperCase()
            const selected = sym === selectedTicker
            return (
              <button
                key={sym}
                type="button"
                onClick={() => onRun(sym)}
                className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition ${
                  selected
                    ? 'border-violet-500 bg-violet-500/10'
                    : 'border-slate-200 bg-white hover:border-violet-300 dark:border-white/[0.08] dark:bg-slate-950'
                }`}
              >
                <span className="min-w-0">
                  <span className="block font-mono text-sm font-black text-heading">{sym}</span>
                  <span className="block truncate text-xs text-tertiary">{item.company_name}</span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    {Array.from(itemGroups).map(groupKey => (
                      <span key={groupKey} className="rounded-full border border-slate-200 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-tertiary dark:border-white/[0.08]">
                        {groupKey === 'regular' ? 'Position' : groupKey}
                      </span>
                    ))}
                  </span>
                </span>
                <span className="text-right">
                  <span className="block font-mono text-xs font-bold text-heading">{daySidebarMoney(item.last_price)}</span>
                  <span className={`block font-mono text-[11px] font-bold ${(item.price_change_pct ?? 0) >= 0 ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'}`}>
                    {daySidebarPct(item.price_change_pct)}
                  </span>
                </span>
              </button>
            )
          }) : (
            <div className="rounded-lg border border-slate-200 px-3 py-3 text-sm text-tertiary dark:border-white/[0.08]">
              No tickers match this filter.
            </div>
          )}
        </div>
      </section>

      <section className="mt-3 shrink-0">
        <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-tertiary">Quick Tickers</div>
        <div className="flex flex-wrap gap-1.5">
          {['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMD', 'META'].map(sym => (
            <button
              key={sym}
              type="button"
              onClick={() => onRun(sym)}
              className="rounded-full border border-slate-200 px-2 py-1 font-mono text-[11px] font-black text-secondary hover:border-violet-400 dark:border-white/[0.08]"
            >
              {sym}
            </button>
          ))}
        </div>
      </section>
      <section className="mt-3 grid shrink-0 gap-2">
        <button type="button" onClick={onScanner} className="rounded-lg border border-slate-200 px-3 py-2 text-left text-xs font-bold text-secondary hover:border-violet-400 dark:border-white/[0.08]">
          Ticker Scanner
        </button>
        <button type="button" onClick={onAlerts} className="rounded-lg border border-slate-200 px-3 py-2 text-left text-xs font-bold text-secondary hover:border-violet-400 dark:border-white/[0.08]">
          Alerts
        </button>
        <button type="button" onClick={onPositions} className="rounded-lg border border-slate-200 px-3 py-2 text-left text-xs font-bold text-secondary hover:border-violet-400 dark:border-white/[0.08]">
          Positions Center
        </button>
        <button type="button" onClick={onJournal} className="rounded-lg border border-slate-200 px-3 py-2 text-left text-xs font-bold text-secondary hover:border-violet-400 dark:border-white/[0.08]">
          Journal
        </button>
      </section>
    </aside>
  )
}

function dtLabel(value: unknown): string {
  if (value == null || value === '') return '—'
  return String(value).replace(/_/g, ' ')
}

function dtMaybePrice(value: unknown): string {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : null
  if (n == null) return typeof value === 'string' && value ? value : '—'
  return `$${n.toFixed(2)}`
}

function dtStatusStyle(status: unknown) {
  const s = String(status || '').toUpperCase()
  if (s === 'SETUP_ACTIVE' || s === 'CONFIRMED' || s === 'READY') {
    return { color: '#34d399', bg: 'rgba(52,211,153,0.12)', border: 'rgba(52,211,153,0.35)' }
  }
  if (s === 'PENDING' || s === 'WAIT_ENTRY' || s === 'DO_NOT_CHASE' || s === 'WAIT_PULLBACK' || s === 'OPENING_RANGE') {
    return { color: '#fbbf24', bg: 'rgba(251,191,36,0.12)', border: 'rgba(251,191,36,0.35)' }
  }
  if (s === 'NO_SETUP' || s === 'FAILED' || s === 'DISABLED' || s === 'BLOCKED' || s === 'NO_EDGE') {
    return { color: '#fb7185', bg: 'rgba(251,113,133,0.12)', border: 'rgba(251,113,133,0.35)' }
  }
  return { color: '#94a3b8', bg: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.25)' }
}

function dtDecisionStyle(decision: unknown) {
  const d = String(decision || '').toUpperCase()
  if (d === 'GO') return dtStatusStyle('READY')
  if (d === 'TRACK_ONLY' || d === 'WAIT_ENTRY' || d === 'DO_NOT_CHASE' || d === 'WAIT_PULLBACK' || d === 'OPENING_RANGE') return dtStatusStyle('PENDING')
  if (d === 'NO_EDGE') return dtStatusStyle('FAILED')
  if (d === 'NO_TRADE') return dtStatusStyle('FAILED')
  return dtStatusStyle(d)
}

function DayTradeTimeframeVerdictCards({
  timeframeState,
  layeredDecision,
  finalDecision,
  dt,
}: {
  timeframeState: DayTradeTimeframeState | null
  layeredDecision?: Record<string, unknown> | null
  finalDecision: string
  dt: DtTokens
}) {
  const layered = layeredDecision as Record<string, any> | null | undefined
  const layeredFinal = layered?.final_decision as Record<string, any> | undefined
  if (layered && layeredFinal) {
    const decisionStyle = dtDecisionStyle(layeredFinal.action || finalDecision)
    const layerCards = [
      { title: 'Market State', data: layered.market_state, status: layered.market_state?.label, score: layered.market_state?.confidence, reason: layered.market_state?.reason },
      { title: 'Market Structure', data: layered.market_structure, status: layered.market_structure?.label, score: layered.market_structure?.confidence, reason: layered.market_structure?.reason, extra: Array.isArray(layered.market_structure?.sequence) ? layered.market_structure.sequence.join(' → ') : '' },
      { title: 'Opportunity', data: layered.opportunity, status: layered.opportunity?.label, score: layered.opportunity?.confidence, reason: layered.opportunity?.expected_trigger, extra: Array.isArray(layered.opportunity?.missing_confirmations) && layered.opportunity.missing_confirmations.length ? `Missing: ${layered.opportunity.missing_confirmations[0]}` : '' },
      { title: 'Execution', data: layered.execution, status: layered.execution?.label, score: layered.execution?.confidence, reason: layered.execution?.reason, extra: Array.isArray(layered.execution?.missing_confirmations) && layered.execution.missing_confirmations.length ? layered.execution.missing_confirmations[0] : '' },
      { title: 'Risk', data: layered.risk, status: layered.risk?.label, score: layered.risk?.confidence, reason: Array.isArray(layered.risk?.notes) ? layered.risk.notes[0] : '', extra: layered.risk?.position_size ? `Size: ${layered.risk.position_size}` : '' },
    ]
    return (
      <div className="dt-card" style={{ background: dt.bg, border: `1px solid ${dt.border}`, borderRadius: 14, padding: '14px 16px', marginBottom: 12 }}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Layers size={15} style={{ color: dt.accent }} />
            <div>
              <div style={{ fontSize: '0.6rem', fontWeight: 800, color: dt.muted, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Layered Decision Architecture</div>
              <div style={{ fontSize: '0.72rem', color: dt.muted }}>Market State → Structure → Opportunity → Execution → Risk</div>
            </div>
          </div>
          <span className="font-mono" style={{ border: `1px solid ${decisionStyle.border}`, background: decisionStyle.bg, color: decisionStyle.color, borderRadius: 999, padding: '4px 10px', fontSize: '0.72rem', fontWeight: 900, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            {dtLabel(layeredFinal.action || finalDecision)} · {layeredFinal.confidence ?? '—'}%
          </span>
        </div>
        <div className="mb-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ['Trade Quality', layeredFinal.quality],
            ['Final Action', layeredFinal.action],
            ['Next Condition', layeredFinal.next_condition],
            ['Total Score', layeredFinal.confidence != null ? `${layeredFinal.confidence}/100` : '—'],
          ].map(([label, value]) => (
            <div key={label} style={{ background: dt.bgDeep, border: `1px solid ${dt.border}`, borderRadius: 9, padding: '8px 10px' }}>
              <div style={{ fontSize: '0.56rem', fontWeight: 900, color: dt.muted, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{label}</div>
              <div style={{ marginTop: 3, fontSize: '0.7rem', fontWeight: 800, color: dt.text, lineHeight: 1.35 }}>{dtLabel(value)}</div>
            </div>
          ))}
        </div>
        <div className="grid gap-2 lg:grid-cols-5">
          {layerCards.map(card => {
            const score = Number(card.score ?? 0)
            const statusStyle = dtStatusStyle(score >= 75 ? 'CONFIRMED' : score >= 60 ? 'PENDING' : 'FAILED')
            return (
              <div key={card.title} style={{ background: dt.bgDeep, border: `1px solid ${dt.border}`, borderRadius: 10, padding: 12 }}>
                <div className="flex items-center justify-between gap-2">
                  <div style={{ fontSize: '0.62rem', fontWeight: 800, color: dt.muted, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{card.title}</div>
                  <span style={{ border: `1px solid ${statusStyle.border}`, background: statusStyle.bg, color: statusStyle.color, borderRadius: 999, padding: '3px 7px', fontSize: '0.58rem', fontWeight: 800 }}>{score || '—'}%</span>
                </div>
                <div style={{ color: dt.text, fontSize: '0.74rem', fontWeight: 800, lineHeight: 1.35, marginTop: 8 }}>{dtLabel(card.status)}</div>
                {card.extra && <div style={{ color: dt.accent, fontSize: '0.66rem', lineHeight: 1.35, marginTop: 5 }}>{card.extra}</div>}
                <div style={{ color: dt.muted, fontSize: '0.66rem', lineHeight: 1.35, marginTop: 6 }}>{card.reason || '—'}</div>
              </div>
            )
          })}
        </div>
        {layeredFinal.explanation && (
          <div style={{ marginTop: 10, border: `1px solid ${dt.border}`, background: dt.bgDeep, color: dt.text, borderRadius: 10, padding: '8px 10px', fontSize: '0.72rem', lineHeight: 1.45 }}>
            {layeredFinal.explanation}
          </div>
        )}
      </div>
    )
  }

  if (!timeframeState) return null
  const decisionStyle = dtDecisionStyle(timeframeState.final_decision || finalDecision)
  const cards = [
    {
      title: '15m Setup',
      sub: 'Setup',
      state: timeframeState.setup_15m,
      status: timeframeState.setup_15m?.status,
      reason: timeframeState.setup_15m?.reason,
      next: timeframeState.setup_15m?.next_action,
      levels: timeframeState.setup_15m?.key_levels,
    },
    {
      title: '5m Confirmation',
      sub: 'Confirm',
      state: timeframeState.confirmation_5m,
      status: timeframeState.confirmation_5m?.status,
      reason: timeframeState.confirmation_5m?.reason,
      next: timeframeState.confirmation_5m?.next_action,
      levels: {
        trigger: timeframeState.confirmation_5m?.trigger_requirement,
        volume: timeframeState.confirmation_5m?.volume_confirmed ? 'Confirmed' : 'Not confirmed',
      },
    },
    {
      title: '1m Execution',
      sub: 'Execute only',
      state: timeframeState.execution_1m,
      status: timeframeState.execution_1m?.status,
      reason: timeframeState.execution_1m?.reason,
      next: timeframeState.execution_1m?.next_action,
      levels: {
        entry: timeframeState.execution_1m?.entry_zone,
        stop: timeframeState.execution_1m?.stop_level,
      },
    },
  ]

  return (
    <div className="dt-card" style={{ background: dt.bg, border: `1px solid ${dt.border}`, borderRadius: 14, padding: '14px 16px', marginBottom: 12 }}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Layers size={15} style={{ color: dt.accent }} />
          <div>
            <div style={{ fontSize: '0.6rem', fontWeight: 800, color: dt.muted, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Multi-Timeframe Verdict</div>
            <div style={{ fontSize: '0.72rem', color: dt.muted }}>15m setup → 5m confirmation → 1m execution only</div>
          </div>
        </div>
        <span
          className="font-mono"
          style={{
            border: `1px solid ${decisionStyle.border}`,
            background: decisionStyle.bg,
            color: decisionStyle.color,
            borderRadius: 999,
            padding: '4px 10px',
            fontSize: '0.72rem',
            fontWeight: 900,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}
        >
          {dtLabel(timeframeState.final_decision || finalDecision)}
        </span>
      </div>
      <div className="mb-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['Bias', timeframeState.bias],
          ['Blocker', timeframeState.blocker || 'None'],
          ['Final Action', timeframeState.final_action || timeframeState.final_decision || finalDecision],
          ['Required Next', timeframeState.required_next_condition],
        ].map(([label, value]) => (
          <div key={label} style={{ background: dt.bgDeep, border: `1px solid ${dt.border}`, borderRadius: 9, padding: '8px 10px' }}>
            <div style={{ fontSize: '0.56rem', fontWeight: 900, color: dt.muted, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{label}</div>
            <div style={{ marginTop: 3, fontSize: '0.7rem', fontWeight: 800, color: label === 'Blocker' && value !== 'None' ? dt.amber : dt.text, lineHeight: 1.35 }}>
              {dtLabel(value)}
            </div>
          </div>
        ))}
      </div>
      <div className="grid gap-2 lg:grid-cols-3">
        {cards.map(card => {
          const statusStyle = dtStatusStyle(card.status)
          return (
            <div key={card.title} style={{ background: dt.bgDeep, border: `1px solid ${dt.border}`, borderRadius: 10, padding: 12 }}>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div style={{ fontSize: '0.62rem', fontWeight: 800, color: dt.muted, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{card.title}</div>
                  <div style={{ fontSize: '0.68rem', color: dt.muted }}>{card.sub}</div>
                </div>
                <span style={{ border: `1px solid ${statusStyle.border}`, background: statusStyle.bg, color: statusStyle.color, borderRadius: 999, padding: '3px 7px', fontSize: '0.58rem', fontWeight: 800, textTransform: 'uppercase' }}>
                  {dtLabel(card.status)}
                </span>
              </div>
              <div style={{ color: dt.text, fontSize: '0.74rem', lineHeight: 1.45, marginTop: 9 }}>{card.reason || '—'}</div>
              <div style={{ color: dt.muted, fontSize: '0.68rem', lineHeight: 1.35, marginTop: 7 }}>{card.next || '—'}</div>
              {card.levels && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {Object.entries(card.levels).filter(([, value]) => value != null && value !== '').map(([key, value]) => (
                    <span key={key} style={{ border: `1px solid ${dt.border}`, background: 'rgba(0,0,0,0.12)', borderRadius: 999, padding: '2px 7px', fontSize: '0.62rem', color: dt.muted }}>
                      {dtLabel(key)} <span className="font-mono" style={{ color: dt.text }}>{dtMaybePrice(value)}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {timeframeState.confirmation_5m?.trigger_fired === false && (
        <div style={{ marginTop: 10, border: '1px solid rgba(251,191,36,0.30)', background: 'rgba(251,191,36,0.08)', color: '#fbbf24', borderRadius: 10, padding: '8px 10px', fontSize: '0.72rem', fontWeight: 700 }}>
          1m execution is disabled until the 5m confirmation fires.
        </div>
      )}
    </div>
  )
}

function PCRatioStrip({
  pcRatio,
  totalOptionsVol,
  bias,
  isDark,
}: {
  pcRatio: number | null
  totalOptionsVol: number | null
  bias: string | null
  isDark: boolean
}) {
  const [tip, setTip] = useState(false)

  const borderB = isDark ? '0.5px solid rgba(255,255,255,0.08)' : '0.5px solid rgba(0,0,0,0.08)'

  if (pcRatio == null) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 44, padding: '0 4px', borderBottom: borderB, marginBottom: 12 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#444', flexShrink: 0 }} />
        <span style={{ fontSize: 10, color: '#888780', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Put/Call</span>
        <span style={{ fontSize: 14, color: '#444', fontFamily: 'monospace' }}>—</span>
        <span style={{ fontSize: 11, color: '#555' }}>No data</span>
      </div>
    )
  }

  let arrow: string, reading: string, dotColor: string, ratioColor: string
  if (pcRatio >= 1.20) {
    arrow = '▼'; reading = 'Bearish lean'; dotColor = '#E24B4A'; ratioColor = '#e07070'
  } else if (pcRatio >= 1.00) {
    arrow = '▼'; reading = 'Mild bearish'; dotColor = '#E87B3A'; ratioColor = '#e8a06a'
  } else if (pcRatio >= 0.80) {
    arrow = '→'; reading = 'Neutral'; dotColor = '#888780'; ratioColor = '#888780'
  } else if (pcRatio >= 0.60) {
    arrow = '▲'; reading = 'Mild bullish'; dotColor = '#E87B3A'; ratioColor = '#e8a06a'
  } else {
    arrow = '▲'; reading = 'Bullish lean'; dotColor = '#639922'; ratioColor = '#a3cc6a'
  }

  const isNeutral = pcRatio >= 0.80 && pcRatio < 1.00
  const biasUp = (bias ?? '').toUpperCase()
  const biasIsShort = biasUp === 'SHORT'
  const aligned = !isNeutral && ((biasIsShort && pcRatio >= 1.00) || (!biasIsShort && pcRatio <= 0.80))
  const conflict = !isNeutral && !aligned

  let badgeBg: string, badgeColor: string, alignLabel: string
  if (isNeutral) {
    badgeBg = 'rgba(136,135,128,0.15)'; badgeColor = '#888780'
    alignLabel = '— Neutral · no confirmation'
  } else if (aligned) {
    badgeBg = 'rgba(99,153,34,0.20)'; badgeColor = '#a3cc6a'
    alignLabel = `✓ Aligns with ${biasUp}`
  } else {
    badgeBg = 'rgba(226,75,74,0.20)'; badgeColor = '#e07070'
    alignLabel = `✗ Conflicts with ${biasUp} — size down`
  }

  return (
    <div
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px', height: 44, marginBottom: 12, position: 'relative', borderBottom: borderB, cursor: 'default' }}
      onMouseEnter={() => setTip(true)}
      onMouseLeave={() => setTip(false)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
        <span style={{ fontSize: 10, color: '#888780', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Put/Call</span>
        <span style={{ fontSize: 16, fontWeight: 500, color: ratioColor, fontFamily: 'monospace' }}>{pcRatio.toFixed(2)}</span>
        <span style={{ color: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)', fontSize: 14 }}>|</span>
        <span style={{ fontSize: 12, color: ratioColor }}>{arrow} {reading}</span>
        {bias && (
          <span style={{ fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 4, background: badgeBg, color: badgeColor, whiteSpace: 'nowrap' }}>
            {alignLabel}
          </span>
        )}
      </div>
      {totalOptionsVol != null && (
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 10, color: '#888780' }}>Total Vol</div>
          <div style={{ fontSize: 13, color: '#c2c0b6', fontFamily: 'monospace' }}>{fmtOptionsVol(totalOptionsVol)}</div>
        </div>
      )}
      {tip && (
        <div style={{ position: 'absolute', top: 48, left: 0, background: 'rgba(30,30,30,0.95)', border: '0.5px solid rgba(255,255,255,0.12)', borderRadius: 6, padding: '8px 12px', fontSize: 11, color: '#c2c0b6', maxWidth: 280, zIndex: 10, pointerEvents: 'none', lineHeight: 1.6 }}>
          P/C ratio above 1.0 = more puts traded than calls. Confirms bearish sentiment from prior session. Use as pre-market bias check — not a timing signal.
        </div>
      )}
    </div>
  )
}

function axiosDetail(e: unknown): string {
  const d = (e as { response?: { data?: { detail?: string } }; message?: string })?.response?.data?.detail
  if (typeof d === 'string') return d
  return (e as Error)?.message ?? 'Request failed'
}

// ─── VWAP vs OR Mid ───────────────────────────────────────────────────────────
// Where session VWAP sits relative to the opening-range midpoint tells you which
// side controlled the auction. Rendered as a price ladder (Close/VWAP on the
// left, the OR structure on the right) plus a plain-language read of the lean.
interface DtTokens { bg: string; bgDeep: string; border: string; text: string; muted: string; green: string; red: string; amber: string; accent: string }

function VwapVsOrMidCard({
  close, vwap, orHigh, orLow, isDark, dt,
}: { close: number | null; vwap: number | null; orHigh?: number; orLow?: number; isDark: boolean; dt: DtTokens }) {
  if (vwap == null || orHigh == null || orLow == null) return null

  const orMid   = (orHigh + orLow) / 2
  const bullish = vwap >= orMid
  const blue    = isDark ? '#58a6ff' : '#2563eb'
  const headCol = bullish ? (isDark ? '#3fb950' : '#1a7f37') : (isDark ? '#ff6b81' : '#b91c1c')
  const railFill = bullish
    ? (isDark ? 'rgba(0,229,160,0.13)' : '#e7f4ec')
    : (isDark ? 'rgba(255,77,109,0.13)' : '#fdecec')

  const levels = [
    { key: 'Close',  price: close,  color: dt.text,  side: 'L' as const, strong: false, show: close != null && close > 0 },
    { key: 'VWAP',   price: vwap,   color: blue,     side: 'L' as const, strong: false, show: true },
    { key: 'ORH',    price: orHigh, color: dt.text,  side: 'R' as const, strong: false, show: true },
    { key: 'OR Mid', price: orMid,  color: dt.amber, side: 'R' as const, strong: true,  show: true },
    { key: 'ORL',    price: orLow,  color: dt.text,  side: 'R' as const, strong: false, show: true },
  ].filter(l => l.show && l.price != null) as { key: string; price: number; color: string; side: 'L' | 'R'; strong: boolean }[]

  const prices = levels.map(l => l.price)
  const hi = Math.max(...prices), lo = Math.min(...prices)
  const span = hi - lo || 1
  const top = hi + span * 0.14, bot = lo - span * 0.14
  const W = 300, H = 232, padY = 18, railX = 116, railW = 14
  const y = (p: number) => padY + ((top - p) / (top - bot)) * (H - padY * 2)
  const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace'

  const lean = `${bullish ? 'BULLISH' : 'BEARISH'} LEAN — VWAP ${bullish ? 'above' : 'below'} OR Mid`
  const closeLine = close != null && close > 0
    ? ` Last ${close.toFixed(2)} ${ (bullish ? close >= vwap : close <= vwap)
        ? `${bullish ? 'above' : 'below'} VWAP confirms the read.`
        : 'is fighting VWAP — wait for a reclaim before pressing.'}`
    : ''

  return (
    <div className="dt-card" style={{ background: dt.bg, border: `1px solid ${dt.border}`, borderRadius: 14, padding: '14px 16px', marginBottom: 12 }}>
      <div className="dt-muted" style={{ fontSize: '0.68rem', fontWeight: 700, color: dt.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>VWAP vs OR Mid</div>
      <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <svg width={W} height={H} style={{ flexShrink: 0 }} role="img" aria-label="VWAP versus opening-range midpoint ladder">
          <rect x={railX} y={padY} width={railW} height={H - padY * 2} rx={railW / 2} fill={railFill} stroke={dt.border} strokeWidth={1} />
          {levels.map(l => {
            const yy = y(l.price)
            const x1 = l.side === 'L' ? railX - 14 : railX
            const x2 = l.side === 'L' ? railX + railW : railX + railW + 14
            const lx = l.side === 'L' ? railX - 20 : railX + railW + 20
            return (
              <g key={l.key}>
                <line x1={x1} y1={yy} x2={x2} y2={yy} stroke={l.color} strokeWidth={l.strong ? 2.2 : 1.6} />
                <text x={lx} y={yy + 4} textAnchor={l.side === 'L' ? 'end' : 'start'} fontSize={12} fill={l.color} fontWeight={l.strong ? 700 : 600}>
                  {l.key}
                  <tspan dx={6} fontFamily={mono} fontWeight={700}>{l.price.toFixed(2)}</tspan>
                </text>
              </g>
            )
          })}
        </svg>
        <div style={{ flex: 1, minWidth: 280 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: headCol, marginBottom: 8 }}>{lean}</div>
          <p style={{ fontSize: 13.5, lineHeight: 1.6, color: dt.text, margin: '0 0 10px' }}>
            VWAP at <span style={{ fontFamily: mono, fontWeight: 600 }}>{vwap.toFixed(2)}</span> sits {bullish ? 'above' : 'below'} the OR midpoint at <span style={{ fontFamily: mono, fontWeight: 600 }}>{orMid.toFixed(2)}</span>. The average dollar traded today changed hands {bullish ? 'above' : 'below'} the middle of the opening range — {bullish ? 'buyers' : 'sellers'} controlled the auction.
          </p>
          <p style={{ fontSize: 13.5, lineHeight: 1.6, color: dt.text, margin: '0 0 12px' }}>
            <strong>Bias:</strong> lean {bullish ? 'long' : 'short'}. Favor the {bullish ? 'bull' : 'bear'} scenario on a break of {bullish ? 'ORH' : 'ORL'}; treat {bullish ? 'ORL breakdowns' : 'ORH breakouts'} with suspicion unless volume confirms.{closeLine}
          </p>
          <div style={{ border: `1px dashed ${dt.border}`, borderRadius: 8, padding: '10px 14px', background: dt.bgDeep, fontFamily: mono, fontSize: 13, color: dt.text }}>
            OR Mid = (ORH + ORL) ÷ 2 = ({orHigh.toFixed(2)} + {orLow.toFixed(2)}) ÷ 2 = {orMid.toFixed(2)}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function DayTradePage() {
  const {
    dayTradeEngineUI: ui,
    setDayTradeEngineUI: setUi,
    canAccessPage,
    navigate,
    addToWatchlist,
    isWatched,
    addManualPosition,
    portfolio,
    dayTradeWatchlist,
    swingTradeWatchlist,
    theme,
    user,
  } = useApp()

  const isDark = theme !== 'light'
  const dt = {
    bg:      isDark ? '#111318' : '#FFFFFF',
    bgDeep:  isDark ? '#181C23' : '#F8F9FB',
    border:  isDark ? '#1E2330' : '#E5E7EB',
    text:    isDark ? '#E8EBF0' : '#111827',
    muted:   isDark ? '#5A6478' : '#6B7280',
    green:   isDark ? '#00E5A0' : '#00A86B',
    red:     isDark ? '#FF4D6D' : '#DC2626',
    amber:   isDark ? '#F5A623' : '#D97706',
    accent:  '#4A7CFF',
    violet:  '#6B7FD4',
  }
  const [searchParams, setSearchParams] = useSearchParams()
  const routerNavigate = useNavigate()
  const { ticker, loading, refreshing, error, result, glossaryOpen } = ui
  const workspaceEnabled = true
  const workspaceSymbol = (searchParams.get('ticker') || ticker || 'AAPL').trim().toUpperCase()
  const workspaceSessionDate = searchParams.get('sessionDate')
  const workspaceIntervalParam = searchParams.get('interval')
  const workspaceInterval = workspaceIntervalParam === '5m' || workspaceIntervalParam === '15m' || workspaceIntervalParam === '1h' ? workspaceIntervalParam : '1m'
  const workspaceState = useDayTradeWorkspace(
    workspaceEnabled && workspaceSymbol
      ? {
          symbol: workspaceSymbol,
          sessionDate: workspaceSessionDate,
          interval: workspaceInterval,
        }
      : null
  )
  const [workspaceDisplayTimeZone, setWorkspaceDisplayTimeZone] = useState(() => {
    try {
      return localStorage.getItem('oa_timezone') || 'America/New_York'
    } catch {
      return 'America/New_York'
    }
  })

  useEffect(() => {
    const readTimeZone = () => {
      try {
        return localStorage.getItem('oa_timezone') || workspaceState.data?.session.marketTimeZone || 'America/New_York'
      } catch {
        return workspaceState.data?.session.marketTimeZone || 'America/New_York'
      }
    }
    setWorkspaceDisplayTimeZone(readTimeZone())
    const handleTimezoneChange = (event: Event) => {
      const custom = event as CustomEvent<string>
      setWorkspaceDisplayTimeZone(custom.detail || readTimeZone())
    }
    window.addEventListener('oa-timezone-changed', handleTimezoneChange)
    return () => window.removeEventListener('oa-timezone-changed', handleTimezoneChange)
  }, [workspaceState.data?.session.marketTimeZone])

  const existingPositions = useMemo(
    () => portfolio.filter(p => p.ticker.toUpperCase() === result?.ticker?.toUpperCase() && p.status === 'open'),
    [portfolio, result?.ticker]
  )

  const [enterOpen, setEnterOpen] = useState(false)
  const [alertOpen, setAlertOpen] = useState(false)
  const [portfolioOpen, setPortfolioOpen] = useState(false)
  const [portfolioContracts, setPortfolioContracts] = useState('')
  const [portfolioStockPrice, setPortfolioStockPrice] = useState('')
  const [portfolioStrike, setPortfolioStrike] = useState('')
  const [portfolioEntryPrice, setPortfolioEntryPrice] = useState('1.00')
  const [portfolioExpiry, setPortfolioExpiry] = useState('')
  const [portfolioNotes, setPortfolioNotes] = useState('')
  const [portfolioErr, setPortfolioErr] = useState<string | null>(null)
  const [portfolioSubmitting, setPortfolioSubmitting] = useState(false)
  const [portfolioDfltDte, setPortfolioDfltDte] = useState(7)
  const [portfolioBias, setPortfolioBias] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'success' | 'info'; message: string } | null>(null)
  const [savedToJournal, setSavedToJournal] = useState(false)
  const [side, setSide] = useState<'CALL' | 'PUT'>('CALL')
  const [tradeMode, setTradeMode] = useState<'day' | 'swing'>('day')
  const [entryPrice, setEntryPrice] = useState('')
  const [contracts, setContracts] = useState('')
  const [strikeInput, setStrikeInput] = useState('')
  const [expiryInput, setExpiryInput] = useState('')
  const [notes, setNotes] = useState('')
  const [enterSubmitting, setEnterSubmitting] = useState(false)
  const [enterErr, setEnterErr] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'strategies' | 'chat'>('overview')
  const [myTickerFull, setMyTickerFull] = useState<MyTickerEntry[]>([])
  const [collapsedTickerGroups, setCollapsedTickerGroups] = useState<Record<SidebarTickerGroupKey, boolean>>({
    day: false,
    regular: false,
    swing: false,
  })
  const [expandedTickerGroups, setExpandedTickerGroups] = useState<Record<SidebarTickerGroupKey, boolean>>({
    day: false,
    regular: false,
    swing: false,
  })
  const preTradeRoute = useMemo(() => {
    const sym = result?.ticker || ticker
    const direction = result?.bias === 'short' ? 'Bearish' : result?.bias === 'long' ? 'Bullish' : null
    const strategy = direction === 'Bearish' ? 'Long Put' : direction === 'Bullish' ? 'Long Call' : null
    return getTradeWorksheetRoute({ ticker: sym, direction, strategy, source: 'day' })
  }, [result?.bias, result?.ticker, ticker])
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)
  const [unified, setUnified] = useState<UnifiedAnalysis | null>(null)
  const [ocKey, setOcKey]     = useState(0)
  const [scanCount, setScanCount] = useState(0)
  const [sessionState, setSessionState] = useState<'forming' | 'watch' | 'entry' | 'hold' | 'reentry' | 'exhausted'>('watch')
  const [chartInterval, setChartInterval] = useState<ChartInterval>('1m')
  const prevScannedTickerRef = useRef('')
  const inFlightScanRef = useRef('')

  useEffect(() => {
    fetchMyTickers().then(res => {
      const entries = (res.data?.tickers ?? [])
        .filter(t => t.symbol && ((t as any).isActive ?? t.is_active ?? true))
      setMyTickerFull(entries)
    }).catch(() => {})
  }, [])

  const sidebarTickerGroups = useMemo(() => {
    const unique = new Map<string, MyTickerEntry>()
    for (const item of myTickerFull) {
      const sym = item.symbol?.trim().toUpperCase()
      if (!sym) continue
      if (!unique.has(sym)) unique.set(sym, { ...item, symbol: sym })
    }
    const items = [...unique.values()]
    return SIDEBAR_TICKER_GROUPS.map(group => ({
      ...group,
      items: sortSidebarTickers(items.filter(item => tickerGroupsFor(item).has(group.key))),
    }))
  }, [myTickerFull])

  const tickerAffiliations = useMemo(() => {
    const dayDash = new Set<string>()
    try {
      const raw = JSON.parse(localStorage.getItem('oa_dashboard_tickers_day') ?? '[]')
      if (Array.isArray(raw)) raw.forEach(v => dayDash.add(String(v).toUpperCase()))
    } catch { /* ignore localStorage */ }
    const watched = new Set([...dayTradeWatchlist, ...swingTradeWatchlist].map(v => String(v).toUpperCase()))
    const held = new Set(portfolio.map(p => p.ticker.toUpperCase()))
    return { dayDash, watched, held }
  }, [dayTradeWatchlist, portfolio, swingTradeWatchlist, scanCount])

  // Stable ref to read latest ticker without it being a useCallback dep
  const tickerRef = useRef(ticker)
  tickerRef.current = ticker

  const runScan = useCallback(async (overrideTicker?: string, forceRefresh = true) => {
    const sym = (overrideTicker || tickerRef.current).trim().toUpperCase()
    if (!sym || sym.length > 12) {
      setUi(cur => ({ ...cur, error: 'Enter a valid ticker symbol.' }))
      return
    }
    const scanKey = `${sym}:${forceRefresh ? 'force' : 'cache'}`
    if (inFlightScanRef.current === scanKey) return
    inFlightScanRef.current = scanKey
    // Write ticker to URL so sharing, refresh, and other tabs/browsers pick it up
    setSearchParams(prev => { const p = new URLSearchParams(prev); p.set('ticker', sym); return p }, { replace: true })
    // If a result already exists this is a background refresh — keep the stale
    // result visible so the panel doesn't collapse and rebuild during the fetch.
    setUi(cur => cur.result
      ? { ...cur, refreshing: true, error: null }
      : { ...cur, loading: true, error: null, result: null }
    )
    try {
      const data = await analyzeDayTrade(sym, forceRefresh)
      setUi(cur => ({
        ...cur,
        loading: false,
        refreshing: false,
        ticker: data.ticker,
        result: data,
      }))
      setOcKey(k => k + 1)
      setScanCount(c => c + 1)
      try {
        const v2res = await analyzeV2(sym, 'day', { forceRefresh })
        setUnified(v2res.data)
      } catch {
        setUnified(deriveUnifiedFromDayResult(data))
      }
      setLastRefreshed(new Date())
      } catch (e) {
      setUi(cur => ({
        ...cur,
        loading: false,
        refreshing: false,
        error: axiosDetail(e),
      }))
    } finally {
      if (inFlightScanRef.current === scanKey) inFlightScanRef.current = ''
    }
  }, [setUi]) // stable — no ticker dependency

  // Reload on mount: use URL ticker if present; otherwise wait for user input
  const didMountRef = useRef(false)
  const runScanRef = useRef(runScan)
  const urlTickerScanRef = useRef('')
  useEffect(() => { runScanRef.current = runScan }, [runScan])
  useEffect(() => {
    if (workspaceEnabled) return
    if (didMountRef.current) return
    didMountRef.current = true
    const urlT = searchParams.get('ticker')?.trim().toUpperCase()
    const sym = urlT && urlT.length <= 12 ? urlT : ticker.trim().toUpperCase()
    if (sym && sym !== ticker.trim().toUpperCase()) {
      setUi(cur => ({ ...cur, ticker: sym }))
    }
    if (sym) {
      urlTickerScanRef.current = sym
      void runScan(sym).finally(() => {
        if (urlTickerScanRef.current === sym) urlTickerScanRef.current = ''
      })
    }
  }, []) // eslint-disable-line

  // Re-scan when URL ticker changes (navigation from TCC, or another tab/browser pushes a new URL)
  // Guard: only fire when the URL ticker differs from the currently loaded result to avoid
  // an infinite loop with the setSearchParams call inside runScan. Also guard while
  // the first URL scan is still loading so app-wide rerenders don't launch duplicates.
  useEffect(() => {
    if (workspaceEnabled) return
    const t = searchParams.get('ticker')?.trim().toUpperCase()
    if (!t || t.length > 12 || !didMountRef.current) return
    const loaded = ui.result?.ticker?.toUpperCase()
    if (t === loaded) {
      if (urlTickerScanRef.current === t) urlTickerScanRef.current = ''
      return
    }
    if (urlTickerScanRef.current === t) return
    if (t !== loaded) {
      urlTickerScanRef.current = t
      setUi(cur => ({ ...cur, ticker: t }))
      void runScanRef.current(t).finally(() => {
        if (urlTickerScanRef.current === t) urlTickerScanRef.current = ''
      })
    }
  // runScan intentionally excluded — use ref to avoid resetting ticker on each keystroke
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, setUi, workspaceEnabled])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 2800)
    return () => clearTimeout(t)
  }, [notice])

  // Auto-refresh every 30 seconds when a result is loaded. Force refresh keeps the
  // Day Trade page aligned with the latest available 1m Yahoo bars.
  useEffect(() => {
    if (workspaceEnabled) return
    if (!result) return
    const id = setInterval(() => void runScan(undefined, true), 30_000)
    return () => clearInterval(id)
  }, [result, runScan, workspaceEnabled])

  const openEnterModal = useCallback(() => {
    if (!result) return
    const b = result.bias
    setSide(b === 'short' ? 'PUT' : 'CALL')
    setEntryPrice('')
    setContracts('')
    setStrikeInput('')
    setExpiryInput('')
    setNotes('')
    setEnterErr(null)
    setEnterOpen(true)
  }, [result])

  const handleAddToWatchlist = useCallback(() => {
    if (!result) return
    const already = isWatched(result.ticker)
    const ok = addToWatchlist({
      ticker: result.ticker,
      companyName: result.company_name || undefined,
      lastPrice: typeof result.metrics?.last_price === 'number' ? result.metrics.last_price : undefined,
      notes: `Day Trade · ${result.final_decision} · ${result.execution_readiness || result.execution_timing || 'WAIT'}`,
    })
    if (!ok) {
      setNotice({ tone: 'info', message: 'Unable to add this ticker to Signal Feed.' })
      return
    }
    setNotice({
      tone: already ? 'info' : 'success',
      message: already ? `${result.ticker} is already on Signal Feed.` : `${result.ticker} added to Signal Feed.`,
    })
  }, [addToWatchlist, isWatched, result])

  const handleSaveToJournal = useCallback(async () => {
    if (!result || !user?.email) return
    const eg = result.entry_guidance as Record<string, unknown> | undefined
    const lastPrice = typeof result.metrics?.last_price === 'number' ? result.metrics.last_price : 0
    const egState = typeof (eg?.state) === 'number' ? (eg.state as number) : 0
    const scalp = typeof eg?.scalp_target === 'number' ? (eg.scalp_target as number) : 0
    const stop = typeof eg?.risk_below === 'number' ? (eg.risk_below as number) : 0
    const maxProfit = scalp > lastPrice && lastPrice > 0 ? (scalp - lastPrice) / lastPrice : 0
    const maxLoss   = stop > 0 && lastPrice > stop ? (lastPrice - stop) / lastPrice : 0
    const verdict   = result.verdict ?? result.final_decision ?? ''
    const notes     = [
      verdict ? `Signal: ${verdict}` : '',
      scalp   ? `Target: $${scalp.toFixed(2)}` : '',
      stop    ? `Stop: $${stop.toFixed(2)}` : '',
      (result.metrics as Record<string, unknown>)?.entry_rr_ratio
        ? `R/R: ${(result.metrics as Record<string, unknown>).entry_rr_ratio}` : '',
    ].filter(Boolean).join(' · ')
    try {
      await saveToJournal(user.email, {
        ticker:           result.ticker,
        company_name:     result.company_name || '',
        strategy:         result.bias === 'short' ? 'Long Put' : 'Long Call',
        trade_type:       'day',
        bias:             result.bias === 'long' ? 'Bullish' : result.bias === 'short' ? 'Bearish' : 'Neutral',
        legs:             [],
        expiry:           new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
        entry_date:       new Date().toISOString().split('T')[0],
        dte_at_entry:     7,
        net_credit:       0,
        max_profit:       maxProfit,
        max_loss:         maxLoss,
        underlying_entry: lastPrice,
        prob_of_profit:   0,
        expected_value:   0,
        total_score:      result.confidence ?? 0,
        engine_signal:    verdict,
        engine_state:     egState,
        notes,
      })
      setSavedToJournal(true)
      setTimeout(() => setSavedToJournal(false), 4000)
    } catch { /* non-fatal */ }
  }, [result, user?.email])

  const handleCreateAlert = useCallback(async (data: DeskAlertCreate) => {
    await deskApi.createAlert(data)
    setAlertOpen(false)
  }, [])

  const openPortfolioModal = useCallback(() => {
    if (!result) return
    const eg = result.entry_guidance as Record<string, unknown> | null | undefined
    const m = result.metrics as Record<string, unknown>
    const lastU = typeof m.last_price === 'number' ? m.last_price : 0
    const bias = result.bias ?? 'neutral'
    // Next Friday as default expiry
    const nextFri = new Date()
    nextFri.setDate(nextFri.getDate() + ((5 + 7 - nextFri.getDay()) % 7 || 7))
    const dfltExpiry = nextFri.toISOString().slice(0, 10)
    const dfltDte = Math.ceil((nextFri.getTime() - Date.now()) / 86400000)
    const pt = eg?.premium_targets as Record<string, unknown> | undefined
    const atmPremium = pt?.atm_premium != null && typeof pt.atm_premium === 'number' ? pt.atm_premium : null
    setPortfolioContracts('1')
    setPortfolioStockPrice(lastU > 0 ? lastU.toFixed(2) : '')
    setPortfolioStrike(lastU > 0 ? lastU.toFixed(2) : '')
    setPortfolioEntryPrice(atmPremium != null && atmPremium > 0 ? atmPremium.toFixed(2) : '1.00')
    setPortfolioExpiry(dfltExpiry)
    setPortfolioNotes('')
    setPortfolioErr(null)
    // Store defaults for submit
    setPortfolioDfltDte(dfltDte)
    setPortfolioBias(bias)
    setPortfolioOpen(true)
  }, [result])

  const submitPortfolio = useCallback(() => {
    if (!result) return
    const c = parseInt(portfolioContracts, 10)
    if (!Number.isFinite(c) || c <= 0) {
      setPortfolioErr('Contracts must be a positive whole number.')
      return
    }
    let ep = 1.00
    if (portfolioEntryPrice.trim()) {
      ep = parseFloat(portfolioEntryPrice)
      if (!Number.isFinite(ep) || ep < 0) {
        setPortfolioErr('Premium paid must be a positive number.')
        return
      }
    }
    const strikeVal = parseFloat(portfolioStrike)
    const stockPriceVal = parseFloat(portfolioStockPrice)
    let expiryOut = ''
    if (portfolioExpiry.trim()) {
      const ex = portfolioExpiry.trim().slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ex)) {
        setPortfolioErr('Expiry must be YYYY-MM-DD.')
        return
      }
      expiryOut = ex
    }
    const lastU = typeof result.metrics?.last_price === 'number' ? result.metrics.last_price as number : 0
    const bias = portfolioBias || result.bias || 'neutral'
    const direction = bias === 'short' ? 'Bearish' : 'Bullish'
    const strategy = bias === 'short' ? 'Long Put' : 'Long Call'
    const dteVal = expiryOut
      ? Math.max(1, Math.ceil((new Date(expiryOut + 'T00:00:00').getTime() - Date.now()) / 86400000))
      : portfolioDfltDte || 1
    setPortfolioSubmitting(true)
    const isPut = bias === 'short'
    addManualPosition({
      ticker: result.ticker,
      companyName: result.company_name ?? result.ticker,
      strategy,
      bias: direction,
      legs: [{
        action: 'BUY' as const,
        option_type: isPut ? 'PUT' as const : 'CALL' as const,
        strike: Number.isFinite(strikeVal) && strikeVal > 0 ? strikeVal : 0,
        expiry: expiryOut,
        mid_price: ep,
        delta: 0,
        bid: 0,
        ask: 0,
        iv: 0,
        oi: 0,
        volume: 0,
        bid_ask_spread_pct: 0,
      }],
      expiry: expiryOut || (() => {
        const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10)
      })(),
      dte: dteVal,
      net_credit: ep > 0 ? -ep : 0,
      spread_width: 0,
      max_profit: 0,
      max_loss: ep > 0 ? ep : 0,
      prob_of_profit: 0,
      expected_value: 0,
      scores_total: 0,
      contracts: c,
      breakeven_lower: 0,
      breakeven_upper: 0,
      entryPrice: Number.isFinite(stockPriceVal) && stockPriceVal > 0 ? stockPriceVal : lastU,
      target1: result.entry_guidance?.scalp_target ?? undefined,
      stopLoss: result.entry_guidance?.risk_below ?? undefined,
      source: 'day',
      notes: portfolioNotes.trim() || undefined,
    })
    setPortfolioSubmitting(false)
    setPortfolioOpen(false)
    setNotice({ tone: 'success', message: `${result.ticker} day trade added to Positions Center.` })
    navigate('positions')
  }, [result, portfolioContracts, portfolioEntryPrice, portfolioExpiry, portfolioNotes, portfolioDfltDte, portfolioBias, addManualPosition, navigate])

  const submitEnter = useCallback(async () => {
    if (!result) return
    const ep = parseFloat(entryPrice)
    if (!Number.isFinite(ep) || ep <= 0) {
      setEnterErr('Enter a valid option premium (entry price).')
      return
    }
    const lastU = typeof result.metrics?.last_price === 'number' ? result.metrics.last_price as number : undefined
    let c: number | undefined
    if (contracts.trim()) {
      const n = parseFloat(contracts)
      if (!Number.isFinite(n) || n <= 0) {
        setEnterErr('Contracts must be a positive number.')
        return
      }
      c = n
    }
    let strikeOut: number | undefined
    if (strikeInput.trim()) {
      const sk = parseFloat(strikeInput)
      if (!Number.isFinite(sk) || sk <= 0) {
        setEnterErr('Strike must be a positive number.')
        return
      }
      strikeOut = sk
    }
    let expiryOut: string | undefined
    if (expiryInput.trim()) {
      const ex = expiryInput.trim().slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ex)) {
        setEnterErr('Expiry must be YYYY-MM-DD.')
        return
      }
      expiryOut = ex
    }
    setEnterSubmitting(true)
    setEnterErr(null)
    try {
      await enterActiveTrade({
        ticker: result.ticker,
        side,
        entry_price: ep,
        entry_underlying_px: lastU,
        contracts: c,
        strike: strikeOut,
        expiry: expiryOut,
        notes: notes.trim() || undefined,
        trade_type: tradeMode,
      })
      setEnterOpen(false)
      navigate('active-trades')
    } catch (e) {
      setEnterErr(axiosDetail(e))
    } finally {
      setEnterSubmitting(false)
    }
  }, [result, entryPrice, side, contracts, strikeInput, expiryInput, notes, navigate])

  const [searchOpen, setSearchOpen] = useState(false)
  const [watchlistScrollTop, setWatchlistScrollTop] = useState(() => {
    try {
      const saved = Number(localStorage.getItem('day_trade_watchlist_scroll_top'))
      return Number.isFinite(saved) ? Math.max(0, saved) : 0
    } catch {
      return 0
    }
  })
  const [watchlistWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem('day_trade_watchlist_width'))
      if (Number.isFinite(saved)) return Math.min(380, Math.max(240, saved))
    } catch { /* ignore */ }
    return 300
  })
  const [searchCollapsed, setSearchCollapsed] = useState(() => {
    try { return localStorage.getItem('day_trade_search_collapsed') === '1' } catch { return false }
  })

  useEffect(() => {
    try { localStorage.setItem('day_trade_watchlist_scroll_top', String(watchlistScrollTop)) } catch { /* quota */ }
  }, [watchlistScrollTop])

  useEffect(() => {
    try { localStorage.setItem('day_trade_search_collapsed', searchCollapsed ? '1' : '0') } catch { /* quota */ }
  }, [searchCollapsed])

  // ── Trend day detection ────────────────────────────────────────────────────
  const trendDayData = useMemo(() => {
    if (!result) return null
    const m        = result.metrics as Record<string, unknown>
    const spyMove  = typeof m.spy_change_pct === 'number' && isFinite(m.spy_change_pct as number) ? m.spy_change_pct as number : null
    const vixLevel = typeof m.vix            === 'number' && isFinite(m.vix as number)            ? m.vix as number            : null
    const qqqMove  = typeof m.qqq_change_pct === 'number' && isFinite(m.qqq_change_pct as number) ? m.qqq_change_pct as number : null
    if (spyMove == null || vixLevel == null || qqqMove == null) return null
    const isShort = result.bias === 'short'
    const movingWith = myTickerFull.filter(t => {
      const chg = t.price_change_pct
      if (chg == null) return false
      return isShort ? chg <= -1.5 : chg >= 1.5
    }).length
    const isBear = spyMove < -0.8 && vixLevel > 19  && movingWith >= 3 && qqqMove < 0
    const isBull = spyMove > 0.8  && vixLevel < 18  && movingWith >= 3 && qqqMove > 0
    if (!isBear && !isBull) return null
    return {
      direction: isBear ? 'BEAR' as const : 'BULL' as const,
      spyMove, vixLevel, tickerCount: movingWith,
    }
  }, [result, myTickerFull])

  // ── Session state machine ──────────────────────────────────────────────────
  useEffect(() => {
    if (!result) return
    const m = result.metrics as Record<string, unknown>
    const bars = parseChartBars(m.chart_bars)
    const orN = typeof m.or_minutes === 'number' ? m.or_minutes as number : 15
    const tickerChanged = result.ticker !== prevScannedTickerRef.current
    prevScannedTickerRef.current = result.ticker
    if (!bars || bars.length === 0) return
    if (bars.length < orN) { setSessionState('forming'); return }
    const verdict = result.verdict ?? result.final_decision ?? 'WAIT'
    const isGoLocal = /^(STRONG.?GO|GO)$/i.test(verdict)
    const sienLocal = String((result.entry_guidance as Record<string,unknown>)?.should_enter_now ?? '').toUpperCase()
    const rrRaw        = typeof m.entry_rr_ratio === 'number' && isFinite(m.entry_rr_ratio as number) ? m.entry_rr_ratio as number : null
    const confLocal    = typeof result.confidence === 'number' ? result.confidence : 0
    const extFlagLocal = (m.edge_remaining === 'EXHAUSTED' || m.edge_remaining === 'LATE') || !!m.is_chasing
    const rtxtLocal    = [result.reason ?? '', ...(Array.isArray(result.reasons) ? result.reasons : [])].join(' ').toLowerCase()
    const z2GoLocal    = isGoLocal && sienLocal === 'YES' && confLocal > 80
      && (rrRaw === null || rrRaw >= 1.5)
      && !extFlagLocal
      && !rtxtLocal.includes('wait')
      && !rtxtLocal.includes('no clean edge')
      && !rtxtLocal.includes('confirmation')
    const exhaustedLocal = !trendDayData && bars.length > 210
    setSessionState(prev => {
      if (!tickerChanged && prev === 'hold') return 'hold'
      if (exhaustedLocal) return 'exhausted'
      if (z2GoLocal) return 'entry'
      return 'watch'
    })
  }, [scanCount]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Local lifecycle display model mapped from existing entry rules ──────────
  const [stateLockedUntil, setStateLockedUntil] = useState(0)
  const prevEntryStateRef = useRef<TradeEntryState | null>(null)

  const [signalFlipCount, setSignalFlipCount] = useState(0)
  const noTradeZoneActive = useMemo(() => {
    const m = result?.metrics as Record<string, unknown> | undefined
    const bars = parseChartBars(m?.chart_bars)
    if (!bars || bars.length < 3) return false
    const last = bars[bars.length - 1]
    const vwapDist = Math.abs(last.c - last.vwap) / (last.vwap || 1)
    if (vwapDist >= 0.003) return false
    const orH = typeof m?.or_high === 'number' ? m.or_high as number : 0
    const orL = typeof m?.or_low === 'number' ? m.or_low as number : 0
    if (!(orH > 0 && orL > 0 && last.c >= orL && last.c <= orH)) return false
    return true
  }, [result])

  // Signal flip count: how many times momentum direction changed across bars
  useEffect(() => {
    const m = result?.metrics as Record<string, unknown> | undefined
    const bars = parseChartBars(m?.chart_bars)
    if (!bars || bars.length < 5) { setSignalFlipCount(0); return }
    let flips = 0
    for (let i = 2; i < bars.length; i++) {
      const prevUp = bars[i - 1]!.c >= bars[i - 1]!.o
      const curUp = bars[i]!.c >= bars[i]!.o
      if (prevUp !== curUp) flips++
    }
    setSignalFlipCount(flips)
  }, [result])

  const entryState = useMemo((): TradeEntryState => {
    if (sessionState === 'hold') return 'MANAGE'
    if (sessionState === 'forming' || sessionState === 'exhausted') return 'NO_TRADE'
    if (noTradeZoneActive) return 'NO_TRADE'
    if (signalFlipCount >= 2) return 'NO_TRADE'
    if (sessionState === 'entry') return 'EXECUTE'
    const v = result?.verdict ?? ''
    const isGo = /^(STRONG.?GO|GO)$/i.test(v)
    const m = result?.metrics as Record<string, unknown> | undefined
    const edgeExhausted = m?.edge_remaining === 'EXHAUSTED' || m?.edge_remaining === 'LATE' || !!m?.is_chasing
    if (edgeExhausted) return 'NO_TRADE'
    if (isGo) return 'ARMED'
    return 'WATCH'
  }, [sessionState, noTradeZoneActive, result, signalFlipCount])
  const entryLifecycleLabel = entryState === 'NO_TRADE' ? 'WATCHING'
    : entryState === 'EXECUTE' ? 'TRIGGERED'
    : entryState === 'MANAGE' ? 'ACTIVE'
    : entryState === 'WATCH' ? 'WATCHING'
    : entryState

  // State cooldown: lock for 10 min after change, unless strong breakout
  useEffect(() => {
    if (prevEntryStateRef.current === null) {
      prevEntryStateRef.current = entryState
      return
    }
    if (prevEntryStateRef.current === entryState) return
    const m = result?.metrics as Record<string, unknown> | undefined
    const lastBar = m?.chart_bars ? parseChartBars(m.chart_bars)?.slice(-1)[0] : null
    const breakout = lastBar ? Math.abs(lastBar.c - lastBar.o) / (lastBar.o || 1) * 100 > 0.75 : false
    const volSurge = lastBar && m?.rvol ? (m.rvol as number) > 1.5 : false
    if (!breakout || !volSurge) {
      setStateLockedUntil(Date.now() + 600_000)
    }
    prevEntryStateRef.current = entryState
  }, [entryState, result])

  const stateLocked = Date.now() < stateLockedUntil

  const handleBannerEntered = useCallback(() => {
    setSessionState('hold')
  }, [])
 
  const handleBannerExpire = useCallback(() => {
    setSessionState(prev => prev === 'entry' ? 'watch' : prev)
  }, [])

  const handleWorkspaceAction = useCallback((action: DayTradeWorkspaceAction) => {
    setNotice({
      tone: 'info',
      message: action.enabled
        ? `${action.label} is connected through the backend workspace contract.`
        : action.disabledReason || `${action.label} is currently unavailable.`,
    })
  }, [])

  const handleWorkspaceIntervalChange = useCallback((interval: '1m' | '5m' | '15m' | '1h') => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('interval', interval)
      return next
    }, { replace: true })
  }, [setSearchParams])

  const handleWorkspaceTickerAnalyze = useCallback((symbol?: string) => {
    const sym = (symbol || ticker).trim().toUpperCase()
    if (!sym || sym.length > 12) {
      setNotice({ tone: 'info', message: 'Enter a valid ticker symbol.' })
      return
    }
    setUi(cur => ({ ...cur, ticker: sym }))
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('ticker', sym)
      return next
    }, { replace: true })
  }, [setSearchParams, setUi, ticker])

  if (workspaceEnabled) {
    const workspaceError = workspaceState.error
    const workspace = workspaceState.data
    return (
      <div className="day-trade-page min-h-screen bg-surface-page p-3 text-primary">
        <div className="mx-auto flex max-w-[1920px] gap-3">
          <DayTradeLeftSidebar
            ticker={ticker}
            resultTicker={workspaceState.data?.symbol?.ticker || workspaceSymbol}
            loading={workspaceState.loading}
            width={watchlistWidth}
            groups={sidebarTickerGroups}
            onTickerChange={value => setUi(cur => ({ ...cur, ticker: value.toUpperCase() }))}
            onRun={sym => handleWorkspaceTickerAnalyze(sym)}
            onListScroll={setWatchlistScrollTop}
            initialListScrollTop={watchlistScrollTop}
            onManage={() => routerNavigate(ROUTES.myTickers)}
            onScanner={() => routerNavigate(ROUTES.signals)}
            onAlerts={() => routerNavigate(ROUTES.alerts)}
            onPositions={() => routerNavigate(ROUTES.positions)}
            onJournal={() => routerNavigate(ROUTES.journal)}
          />

          <main className="min-w-0 flex-1">
            {notice && (
              <div className="mb-3 rounded-xl border border-semantic-info-border bg-semantic-info-bg px-4 py-3 text-sm text-semantic-info">
                {notice.message}
              </div>
            )}
            {workspaceState.loading && !workspaceState.data ? (
              <div className="flex min-h-[680px] items-center justify-center rounded-2xl border border-slate-200 bg-white text-sm text-secondary dark:border-white/[0.08] dark:bg-slate-900">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading backend workspace...
              </div>
            ) : workspaceError ? (
              <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-700 dark:text-red-200">
                <div className="font-bold">Workspace unavailable</div>
                <p className="mt-1">{workspaceError}</p>
                <button type="button" onClick={() => void workspaceState.reload()} className="mt-4 rounded-lg border border-red-500/30 px-3 py-2 text-xs font-semibold hover:bg-red-500/10">
                Retry
              </button>
            </div>
            ) : workspace ? (
              <>
                <section className="mb-3 overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-950 shadow-sm dark:border-white/[0.07] dark:bg-slate-950 dark:text-slate-100">
                  <SessionStatusBar workspace={workspace} displayTimeZone={workspaceDisplayTimeZone} />
                  <TradeDecisionHeader workspace={workspace} action={workspace.decision.primaryAction} onAction={handleWorkspaceAction} />
                </section>

                <div className="grid min-h-0 gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
                  <WorkspaceChartPreview workspace={workspace} displayTimeZone={workspaceDisplayTimeZone} onIntervalChange={handleWorkspaceIntervalChange} />
                  <TradeDecisionPanel workspace={workspace} />
                </div>

                <section className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-white/[0.07] dark:bg-slate-950">
                  <WorkspaceDetailTabs workspace={workspace} />
                </section>
              </>
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-secondary dark:border-white/[0.08] dark:bg-slate-900">
                Enter a ticker to load the backend Day Trade workspace.
              </div>
            )}
          </main>
        </div>
      </div>
    )
  }
 
  return (
    <div className="day-trade-page min-h-screen p-4 md:p-6" style={{ maxWidth: '100vw', overflowX: 'clip', background: isDark ? '#0A0C10' : '#F3F4F6', color: dt.text }}>
      <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 items-start">
        {/* Mobile/tablet search toggle */}
        <button
          type="button"
          onClick={() => setSearchOpen(p => !p)}
          className="lg:hidden w-full flex items-center gap-2 rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900 px-4 py-3 text-sm font-semibold text-secondary"
        >
          <Search size={16} />
          {searchOpen ? 'Hide search' : 'Show search'}
        </button>

        {searchCollapsed && (
          <button
            type="button"
            onClick={() => setSearchCollapsed(false)}
            className="hidden lg:flex lg:sticky lg:top-6 h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900 text-secondary hover:text-heading hover:border-violet-500/50 transition-colors"
            title="Expand search"
            aria-label="Expand search panel"
          >
            <ChevronRight size={18} />
          </button>
        )}

        {/* Left: Search panel */}
        <div className={`${searchOpen ? 'block' : 'hidden'} ${searchCollapsed ? 'lg:hidden' : 'lg:block'} w-full lg:w-80 shrink-0 lg:sticky lg:top-6 space-y-4`}>
          {/* Header moved to left side */}
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-600/20 border border-orange-700 text-orange-400">
                  <Zap size={16} />
                </div>
                <h1 className="text-sm font-bold tracking-tight text-heading">Day Trade</h1>
                <span className="rounded-full border border-semantic-info-border bg-semantic-info-bg px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-semantic-info">Intraday</span>
              </div>
              <p className="mt-1 text-[11px] leading-snug text-gray-400">Intraday scanner — 1m bars, VWAP, opening range, momentum, volume, and SPY/VIX context.</p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setSearchCollapsed(true)}
                className="hidden lg:inline-flex rounded-full border border-slate-200 dark:border-white/[0.07] px-2 py-1 text-[10px] text-secondary hover:text-heading hover:border-violet-500/50"
                title="Collapse search"
                aria-label="Collapse search panel"
              >
                <ChevronLeft size={12} />
              </button>
              <button
                type="button"
                onClick={() => routerNavigate(preTradeRoute)}
                className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-bold text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300"
                title="Open Pre-Trade Analysis"
              >
                <ArrowUpRight size={12} />
                Pre-Trade
              </button>
              {searchParams.get('from') && (
                <button
                  type="button"
                  onClick={() => routerNavigate(searchParams.get('from')!)}
                  className="rounded-full border border-slate-200 dark:border-white/[0.07] px-2 py-1 text-[10px] text-secondary"
                >
                  <ArrowLeft size={12} /> Back
                </button>
              )}
              <button
                type="button"
                onClick={() => void runScan()}
                disabled={loading || refreshing}
                className="rounded-full border border-gray-700 px-2.5 py-1 text-[10px] font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50"
              >
                <RefreshCw size={12} className={refreshing || loading ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>

          <MarketTimeGateBanner tradeType="day" />

          {lastRefreshed && (
            <div className="text-[10px] font-mono" style={{ color: dt.muted }}>
              Updated {lastRefreshed.toLocaleTimeString()}
            </div>
          )}

          <section className="rounded-xl p-4 sm:p-5" style={{ background: dt.bg, border: `1px solid ${dt.border}` }}>
            <div className="flex flex-col sm:flex-row lg:flex-col gap-2">
              <input
                className="flex-1 min-w-0 rounded-lg px-4 py-3 font-mono text-lg uppercase outline-none"
                style={{ background: dt.bgDeep, border: `1px solid ${dt.border}`, color: dt.text }}
                placeholder="SPY, NVDA, …"
                value={ticker}
                onChange={e => setUi(cur => ({ ...cur, ticker: e.target.value.toUpperCase() }))}
                onKeyDown={e => e.key === 'Enter' && runScan()}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => runScan()}
                disabled={loading || refreshing}
                className="inline-flex items-center justify-center gap-2 shrink-0 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold px-5 py-3 min-h-[48px] transition-colors"
              >
                {loading ? <Loader2 className="animate-spin" size={18} /> : <Search size={18} />}
                Analyze
              </button>
            </div>
            <p className="text-[11px] mt-2" style={{ color: dt.muted }}>
              Uses Yahoo 1-minute RTH data for the most recent session, session VWAP, first 15m opening range, short-horizon momentum, volume vs average, plus SPY/QQQ daily change and VIX.
            </p>
            <div className="mt-4 space-y-2">
              {sidebarTickerGroups.map(group => {
                const collapsed = collapsedTickerGroups[group.key]
                const expanded = expandedTickerGroups[group.key]
                const visible = expanded ? group.items : group.items.slice(0, 8)
                return (
                  <div key={group.key} className="rounded-lg" style={{ border: `1px solid ${dt.border}`, background: dt.bgDeep }}>
                    <button
                      type="button"
                      onClick={() => setCollapsedTickerGroups(cur => ({ ...cur, [group.key]: !cur[group.key] }))}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        {collapsed ? <ChevronRight size={13} style={{ color: dt.muted }} /> : <ChevronDown size={13} style={{ color: dt.muted }} />}
                        <span className="truncate text-[11px] font-bold uppercase tracking-wide" style={{ color: dt.text }}>
                          {group.title}
                        </span>
                      </span>
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-mono" style={{ color: dt.muted, border: `1px solid ${dt.border}`, background: dt.bg }}>
                        {group.items.length}
                      </span>
                    </button>
                    {!collapsed && (
                      <div className="px-3 pb-3">
                        {group.items.length === 0 ? (
                          <p className="rounded-md px-2 py-2 text-[11px] leading-snug" style={{ color: dt.muted, background: dt.bg }}>
                            {group.empty}
                          </p>
                        ) : (
                          <>
                            <div className="flex flex-wrap gap-1.5">
                              {visible.map(item => {
                                const sym = item.symbol.toUpperCase()
                                const selected = sym === ticker.trim().toUpperCase()
                                const badges = [
                                  tickerAffiliations.dayDash.has(sym) ? { label: 'D', title: 'Dashboard' } : null,
                                  tickerAffiliations.watched.has(sym) ? { label: 'W', title: 'Watchlist' } : null,
                                  tickerAffiliations.held.has(sym) ? { label: 'P', title: 'Portfolio' } : null,
                                ].filter(Boolean) as Array<{ label: string; title: string }>
                                return (
                                  <button
                                    key={`${group.key}-${sym}`}
                                    type="button"
                                    onClick={() => { setUi(cur => ({ ...cur, ticker: sym })); void runScan(sym) }}
                                    title={item.company_name || sym}
                                    className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-mono font-bold transition-colors"
                                    style={{
                                      background: selected ? 'rgba(74,124,255,0.18)' : dt.bg,
                                      borderColor: selected ? dt.accent : dt.border,
                                      color: selected ? dt.accent : dt.text,
                                    }}
                                  >
                                    {sym}
                                    {badges.map(badge => (
                                      <span
                                        key={badge.label}
                                        title={badge.title}
                                        className="rounded-full px-1 text-[8px] font-black"
                                        style={{ background: selected ? 'rgba(74,124,255,0.22)' : dt.bgDeep, color: dt.muted, border: `1px solid ${dt.border}` }}
                                      >
                                        {badge.label}
                                      </span>
                                    ))}
                                  </button>
                                )
                              })}
                            </div>
                            {group.items.length > 8 && (
                              <button
                                type="button"
                                onClick={() => setExpandedTickerGroups(cur => ({ ...cur, [group.key]: !cur[group.key] }))}
                                className="mt-2 text-[11px] font-semibold"
                                style={{ color: dt.accent }}
                              >
                                {expanded ? 'Show less' : `View all ${group.items.length}`}
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
              <button
                type="button"
                onClick={() => routerNavigate(ROUTES.myTickers)}
                className="mt-1 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[11px] font-bold transition-colors"
                style={{ borderColor: dt.border, background: dt.bgDeep, color: dt.text }}
              >
                Manage My Tickers
                <ArrowUpRight size={12} />
              </button>
            </div>
          </section>

          {/* Already in Position */}
          {existingPositions.length > 0 && (
            <div className="rounded-xl border border-amber-600/40 bg-amber-950/30 px-3 py-3 space-y-2">
              <div className="flex items-center gap-2">
                <Check size={14} className="text-amber-400 shrink-0" />
                <span className="text-xs font-bold text-amber-300 uppercase tracking-wide">Already in Position</span>
                {(() => {
                  const lp = existingPositions[existingPositions.length - 1]
                  return lp?.source && (
                    <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                      lp.source === 'day'   ? 'border-orange-600/40 bg-orange-900/30 text-orange-300' :
                      lp.source === 'swing' ? 'border-blue-600/40 bg-blue-900/30 text-blue-300' :
                                             'border-gray-600/40 bg-gray-800/50 text-gray-400'
                    }`}>{lp.source}</span>
                  )
                })()}
              </div>
              {(() => {
                const lp = existingPositions[existingPositions.length - 1]
                if (!lp) return null
                return (
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-amber-200/80">
                    {lp.strategy && <span><span className="text-amber-400/60">Strategy</span> {lp.strategy}</span>}
                    {lp.contracts > 0 && <span><span className="text-amber-400/60">Contracts</span> {lp.contracts}</span>}
                    {lp.entryPrice > 0 && <span><span className="text-amber-400/60">Entry px</span> ${lp.entryPrice.toFixed(2)}</span>}
                    {lp.addedAt && <span><span className="text-amber-400/60">Added</span> {lp.addedAt.slice(0, 10)}</span>}
                  </div>
                )
              })()}
              <p className="text-[10px] text-amber-200/70 leading-snug">
                Follow your exit rules — manage this position rather than adding again without a clear plan.
              </p>
            </div>
          )}

          {/* Action buttons */}
          {result && (
          <div className="flex flex-wrap items-center gap-2">
            {existingPositions.length > 0 ? (
              <button
                type="button"
                onClick={() => routerNavigate(ROUTES.positions)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-600/50 bg-amber-900/30 text-amber-300 hover:bg-amber-900/50 px-3.5 py-2 text-xs font-bold transition-colors"
              >
                <BarChart2 size={14} />
                View Positions
              </button>
            ) : (
            <button
              type="button"
              onClick={openPortfolioModal}
              className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white px-3.5 py-2 text-xs font-bold transition-colors"
            >
              <PlusCircle size={14} />
              Add to Portfolio
            </button>
            )}
            {canAccessPage('active-trades') && (
              <button
                type="button"
                onClick={openEnterModal}
                disabled={entryState === 'NO_TRADE'}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-700 hover:bg-gray-800 text-gray-300 px-3 py-2 text-[11px] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Activity size={14} />
                Track Intraday{entryState === 'NO_TRADE' ? ' (locked)' : ''}
              </button>
            )}
            <button
              type="button"
              onClick={() => setAlertOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-700/50 hover:bg-rose-900/30 text-rose-300 px-3.5 py-2 text-xs font-bold transition-colors"
            >
              <Bell size={14} />
              Add Alert
            </button>
            <button
              type="button"
              onClick={() => {
                const sym = result.ticker.toUpperCase()
                try {
                  const existing: string[] = JSON.parse(localStorage.getItem('oa_dashboard_tickers_day') ?? '[]')
                  if (!existing.includes(sym) && existing.length < 8) {
                    localStorage.setItem('oa_dashboard_tickers_day', JSON.stringify([...existing, sym]))
                  }
                } catch { /* ignore quota */ }
                routerNavigate(ROUTES.dayTradeDashboard)
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-orange-700/50 hover:bg-orange-900/30 text-orange-300 px-3 py-2 text-[11px] font-semibold transition-colors"
            >
              <Gauge size={13} />
              Add to Dashboard
            </button>
            <button
              type="button"
              onClick={() => routerNavigate(`${ROUTES.strategyFinder}?ticker=${encodeURIComponent(result.ticker)}`)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-violet-700/50 hover:bg-violet-900/30 text-violet-300 px-3 py-2 text-[11px] font-semibold transition-colors"
            >
              <BarChart2 size={13} />
              Position Trading
            </button>
            <button
              type="button"
              onClick={() => routerNavigate(preTradeRoute)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-700/50 hover:bg-emerald-900/30 text-emerald-300 px-3 py-2 text-[11px] font-semibold transition-colors"
            >
              <ArrowUpRight size={13} />
              Pre-Trade Analysis
            </button>
            <button
              type="button"
              onClick={() => void handleSaveToJournal()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-700/50 hover:bg-emerald-900/30 text-emerald-300 px-3 py-2 text-[11px] font-semibold transition-colors"
            >
              {savedToJournal ? <Check size={14} /> : <Activity size={14} />}
              {savedToJournal ? 'Saved' : 'Save to Journal'}
            </button>
          </div>
          )}

        </div>

        {/* Right: Content */}
        <div className="flex-1 min-w-0 space-y-4" style={{ maxWidth: '100%' }}>

        {/* Tab strip */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 4, borderBottom: `1px solid ${dt.border}` }}>
          {([
            { id: 'overview'    as const, label: 'Overview',    icon: <Activity size={14} />,            accent: dt.accent },
            { id: 'strategies'  as const, label: 'Strategy Playbook',  icon: <BarChart2 size={14} />,    accent: dt.violet },
            { id: 'chat'        as const, label: 'Trade Check',  icon: <MessageSquare size={14} />,       accent: dt.green  },
          ]).map(({ id, label, icon, accent }) => {
            const active = activeTab === id
            return (
              <button key={id} onClick={() => setActiveTab(id)} style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '9px 18px',
                fontSize: 13, fontWeight: active ? 700 : 500,
                color: active ? accent : dt.muted, background: 'none', border: 'none',
                borderBottom: active ? `2px solid ${accent}` : '2px solid transparent',
                marginBottom: -1, cursor: 'pointer', transition: 'color 0.15s',
              }}>{icon} {label}</button>
            )
          })}
        </div>

        {activeTab === 'strategies' && (
          <DayTradeStrategiesTab dt={dt} />
        )}

        {activeTab === 'chat' && (
          <DayTradeChat dt={dt} currentTicker={result?.ticker || ticker || undefined} />
        )}

        {activeTab === 'overview' && (
        <>
        {error && (
        <div className="rounded-xl border border-rose-700/40 bg-rose-950/20 px-4 py-3 text-sm text-rose-200 flex gap-2">
          <ShieldAlert className="shrink-0 mt-0.5" size={16} />
          {error}
        </div>
      )}

      {notice && (
        <div className={`rounded-xl px-4 py-3 text-sm flex gap-2 ${
          notice.tone === 'success'
            ? 'border border-emerald-700/40 bg-emerald-950/20 text-emerald-200'
            : 'border border-sky-700/40 bg-sky-950/20 text-sky-200'
        }`}>
          <ShieldAlert className="shrink-0 mt-0.5" size={16} />
          {notice.message}
        </div>
      )}

      {unified && (
        <div className="day-trade-unified">
          {/* Ticker header bar */}
          <div className="dt-card" style={{ background: dt.bg, border: `1px solid ${dt.border}`, borderRadius: 14, padding: '14px 18px', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px 16px', minWidth: 0, maxWidth: '100%' }}>
              {/* Price row */}
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 10px', flex: '1 1 200px', minWidth: 0 }}>
                <span className="dt-primary" style={{ fontSize: '1.3rem', fontWeight: 700, fontFamily: 'monospace', color: dt.text }}>{unified.ticker}</span>
                {unified.company && <span className="dt-muted" style={{ fontSize: '0.78rem', color: dt.muted }}>{unified.company}</span>}
                {(() => {
                  const _m = result?.metrics as Record<string, unknown> | undefined
                  const _rawPrice = _m?.last_price as number | undefined
                  const _price = unified.price > 0 ? unified.price : (_rawPrice ?? 0)
                  return (
                    <>
                      <span className="dt-primary" style={{ fontSize: '1.1rem', fontWeight: 700, fontFamily: 'monospace', color: dt.text }}>${_price > 0 ? _price.toFixed(2) : '—'}</span>
                      {unified.change_pct != null && (
                        <span style={{ fontSize: '0.82rem', fontWeight: 600, color: unified.change_pct >= 0 ? dt.green : dt.red }}>
                          {unified.change_pct >= 0 ? '▲' : '▼'} ${Math.abs(_price * unified.change_pct / (100 + unified.change_pct)).toFixed(2)} ({Math.abs(unified.change_pct).toFixed(2)}%)
                        </span>
                      )}
                    </>
                  )
                })()}
                {(() => {
                  const m = result?.metrics as Record<string, unknown> | undefined
                  const extPrice = m?.ext_market_price as number | undefined
                  if (!extPrice) return null
                  const extChg = m?.ext_market_change as number | undefined
                  const extChgPct = m?.ext_market_change_pct as number | undefined
                  const extType = m?.ext_market_type as string | undefined
                  return (
                    <>
                      <span style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '1px 6px', borderRadius: 20, border: `1px solid ${dt.violet}`, color: dt.violet, background: 'rgba(107,127,212,0.08)' }}>{extType === 'pre' ? 'Pre' : 'AH'}</span>
                      <span className="dt-primary" style={{ fontSize: '0.82rem', fontWeight: 700, fontFamily: 'monospace', color: dt.text }}>${extPrice.toFixed(2)}</span>
                      {extChg != null && (
                        <span style={{ fontSize: '0.72rem', fontWeight: 600, color: extChg >= 0 ? dt.green : dt.red }}>
                          {extChg >= 0 ? '▲' : '▼'}{Math.abs(extChg).toFixed(2)} ({(extChgPct ?? 0) >= 0 ? '+' : ''}{(extChgPct ?? 0).toFixed(2)}%)
                        </span>
                      )}
                    </>
                  )
                })()}
              </div>
              {/* Bias + session meta */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '0.6rem', color: dt.muted }}>Bias</div>
                  <div style={{ fontSize: '0.78rem', fontWeight: 700, color: result?.bias === 'long' ? dt.green : result?.bias === 'short' ? dt.red : dt.muted }}>{result?.bias ? result.bias.charAt(0).toUpperCase() + result.bias.slice(1) : '—'}</div>
                  <div style={{ fontSize: '0.6rem', color: dt.muted }}>{result?.market_bias || '—'}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {unified.session && (
                    <span style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 20, border: `1px solid rgba(107,127,212,0.5)`, color: dt.violet, background: 'rgba(107,127,212,0.08)' }}>
                      {unified.session}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ── MARKET STATE CARD ──────────────────────────────────────────── */}
          {(() => {
            const m = result?.metrics as Record<string, unknown> | undefined
            const momPct = m?.momentum_pct as number | undefined
            const priceStructure = m?.price_structure as string | undefined
            const vwapPos = m?.vwap_position as string | undefined
            const orBO = m?.or_breakout as string | undefined
            const vwapDistPct = m?.vwap_dist_pct as number | undefined
            const confBlock = m?.confidence as Record<string, unknown> | undefined
            const trendStr = confBlock?.trend_strength as string | undefined

            // Map price_structure → display label
            const structLabel = priceStructure === 'HH_HL' ? 'BULLISH ↑' :
              priceStructure === 'LL_LH' ? 'BEARISH ↓' :
              priceStructure === 'MIXED' ? 'MIXED ↔' :
              priceStructure === 'FLAT' ? 'FLAT —' : (priceStructure ?? '—')

            // Micro Momentum interpretation (Part 1)
            let momLabel = '—'
            let momDir: '↑' | '↓' | '—' = '—'
            let momInterpretation = ''
            let momColor = dt.muted
            if (momPct != null && isFinite(momPct)) {
              momDir = momPct > 0 ? '↑' : momPct < 0 ? '↓' : '—'
              const absMom = Math.abs(momPct)
              if (momPct > 1.0) { momInterpretation = 'Strong acceleration'; momColor = '#34d399' }
              else if (momPct >= 0.3) { momInterpretation = 'Trend continuation'; momColor = '#34d399' }
              else if (momPct >= -0.3) { momInterpretation = 'Neutral'; momColor = '#94a3b8' }
              else if (momPct >= -1.0) { momInterpretation = 'Minor pullback'; momColor = '#E87B3A' }
              else { momInterpretation = 'Short-term weakness'; momColor = '#EF4444' }
              momLabel = `${momPct.toFixed(2)}%`
            }

            // Decision from matrix
            const isBullStruct = priceStructure === 'HH_HL'
            const isBearStruct = priceStructure === 'LL_LH'
            const momPositive = momPct != null && momPct > 0.3
            const momNegative = momPct != null && momPct < -0.3
            const verdict = (result?.verdict ?? result?.final_decision ?? 'WAIT') as string

            let matrixResult = verdict
            let matrixReason = ''
            if (isBullStruct && momNegative) { matrixResult = 'WAIT'; matrixReason = 'Pullback inside uptrend' }
            else if (isBullStruct && momPositive) { matrixResult = 'EXECUTE LONG'; matrixReason = 'Structure + Momentum aligned' }
            else if (isBearStruct && momPositive) { matrixResult = 'WATCH'; matrixReason = 'Countertrend bounce' }
            else if (isBearStruct && momNegative) { matrixResult = 'EXECUTE SHORT'; matrixReason = 'Structure + Momentum aligned' }
            else if (trendStr === 'HIGH' && momPct != null && Math.abs(momPct) < 0.3) { matrixReason = 'Strong structure, momentum neutral — wait for trigger' }
            else { matrixReason = result?.reason ?? 'No clear edge' }

            const timeframeState = (result?.timeframe_state ?? m?.timeframe_state ?? null) as DayTradeTimeframeState | null
            const timeframeDecision = String(timeframeState?.final_decision || result?.final_decision || '').toUpperCase()
            if (timeframeDecision) {
              matrixResult = timeframeDecision
              matrixReason = 'Backend gate: 15m setup → 5m confirmation → 1m execution'
            }

            const stColor = isBullStruct ? '#34d399' : isBearStruct ? '#EF4444' : '#94a3b8'

            return (
              <div className="dt-card" style={{ background: dt.bg, border: `1px solid ${dt.border}`, borderRadius: 14, padding: '14px 16px', marginBottom: 12 }}>
                <div style={{ fontSize: '0.6rem', fontWeight: 700, color: dt.muted, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10 }}>Market State</div>
                <div style={{ display: 'grid', gap: '6px 20px', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
                  {/* Structure */}
                  <div>
                    <div style={{ fontSize: '0.6rem', color: dt.muted, marginBottom: 1 }}>Structure</div>
                    <div style={{ fontSize: '0.88rem', fontWeight: 700, color: stColor, fontFamily: 'monospace' }}>{structLabel}</div>
                  </div>
                  {/* Micro Momentum */}
                  <div>
                    <div style={{ fontSize: '0.6rem', color: dt.muted, marginBottom: 1 }}>Micro Momentum</div>
                    <div style={{ fontSize: '0.88rem', fontWeight: 700, color: momColor, fontFamily: 'monospace' }}>{momDir} {momLabel}</div>
                    {momInterpretation && <div style={{ fontSize: '0.65rem', color: momColor, marginTop: 1 }}>{momInterpretation}</div>}
                  </div>
                  {/* VWAP */}
                  <div>
                    <div style={{ fontSize: '0.6rem', color: dt.muted, marginBottom: 1 }}>VWAP</div>
                    <div style={{ fontSize: '0.88rem', fontWeight: 700, color: vwapPos === 'above' ? '#34d399' : vwapPos === 'below' ? '#EF4444' : '#94a3b8', fontFamily: 'monospace' }}>{(vwapPos ?? '—').toUpperCase()}</div>
                    {vwapDistPct != null && <div style={{ fontSize: '0.65rem', color: dt.muted, marginTop: 1 }}>{vwapDistPct >= 0 ? '+' : ''}{vwapDistPct.toFixed(2)}%</div>}
                  </div>
                  {/* OR */}
                  <div>
                    <div style={{ fontSize: '0.6rem', color: dt.muted, marginBottom: 1 }}>OR</div>
                    <div style={{ fontSize: '0.88rem', fontWeight: 700, color: orBO === 'above' ? '#34d399' : orBO === 'below' ? '#EF4444' : '#94a3b8', fontFamily: 'monospace' }}>{(orBO ?? '—').toUpperCase()}</div>
                  </div>
                </div>
                {/* Structure Context + Verdict row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${dt.border}`, flexWrap: 'wrap' }}>
                  {/* Micro Momentum arrow */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.65rem', color: dt.muted }}>
                    Micro Momentum <span style={{ fontWeight: 700, color: momColor, fontFamily: 'monospace' }}>{momDir === '↑' ? '↑' : momDir === '↓' ? '↓' : '—'}</span>
                  </div>
                  {/* Structure arrow */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.65rem', color: dt.muted }}>
                    Structure <span style={{ fontWeight: 700, color: stColor, fontFamily: 'monospace' }}>{isBullStruct ? '↑' : isBearStruct ? '↓' : '—'}</span>
                  </div>
                  {/* Result */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                    <span style={{ fontSize: '0.65rem', color: dt.muted }}>→</span>
                    <span style={{ fontSize: '0.75rem', fontWeight: 800, color: entryState === 'NO_TRADE' ? '#EF4444' : entryState === 'EXECUTE' ? '#34d399' : entryState === 'ARMED' ? '#E87B3A' : '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{matrixResult}</span>
                    <span style={{ fontSize: '0.65rem', color: dt.muted }}>{matrixReason}</span>
                  </div>
                </div>
              </div>
            )
          })()}

          <DayTradeTimeframeVerdictCards
            timeframeState={(result?.timeframe_state ?? ((result?.metrics as Record<string, unknown> | undefined)?.timeframe_state as DayTradeTimeframeState | undefined) ?? null)}
            layeredDecision={(result?.layered_decision ?? ((result?.metrics as Record<string, unknown> | undefined)?.layered_decision as Record<string, unknown> | undefined) ?? (result?.entry_guidance?.layered_decision as Record<string, unknown> | undefined) ?? null)}
            finalDecision={result?.final_decision ?? result?.verdict ?? 'WAIT'}
            dt={dt}
          />

          {/* ── ENTRY CONFIRMATION (Part 5) + COUNTERTREND (Part 6) ──────── */}
          {(() => {
            const m = result?.metrics as Record<string, unknown> | undefined
            const eg = result?.entry_guidance as Record<string, unknown> | undefined
            const isShort = result?.bias === 'short'
            const momPct = m?.momentum_pct as number | undefined
            const vwapPos = m?.vwap_position as string | undefined
            const priceStructure = m?.price_structure as string | undefined
            const rvol = m?.rvol as number | undefined
            const entryRR = m?.entry_rr_ratio as number | undefined
            const vwapValue = eg?.vwap as number | undefined
            const orH = eg?.opening_range_high as number | undefined
            const orL = eg?.opening_range_low as number | undefined
            const lastPrice = m?.last_price as number | undefined
            const volSpike = !!m?.volume_spike
            const sien = String((eg as Record<string,unknown> | undefined)?.should_enter_now ?? '').toUpperCase()

            // Entry trigger description
            const triggerDesc = isShort
              ? (lastPrice != null && orL != null && lastPrice < orL ? 'Close < ORL' : 'Close below ORL')
              : (lastPrice != null && orH != null && lastPrice > orH ? 'Close > ORH' : 'Close above ORH')
            const triggerMet = isShort ? (lastPrice != null && orL != null && lastPrice < orL) : (lastPrice != null && orH != null && lastPrice > orH)

            // Confirmation: 2 candles
            const confMet = sien === 'YES'
            // Volume: 1.3× avg
            const volMet = volSpike || (rvol != null && rvol > 1.3)
            // Stop
            const stopDesc = isShort ? 'Above VWAP' : 'Below VWAP'
            // Risk
            const riskMet = entryRR != null && entryRR >= 1.5
            const riskDesc = entryRR != null ? `${entryRR.toFixed(1)}R` : '—'

            const allMet = triggerMet && confMet && volMet && riskMet
            const actionText = allMet ? 'EXECUTE' : sien === 'YES' ? 'ARMED' : 'WAIT'
            const actionColor = allMet ? '#34d399' : sien === 'YES' ? '#E87B3A' : '#94a3b8'

            // Countertrend protection (Part 6)
            const higherLowsIntact = priceStructure === 'HH_HL'
            const lowerHighsIntact = priceStructure === 'LL_LH'
            const aboveVWAP = vwapPos === 'above'
            const belowVWAP = vwapPos === 'below'
            const trendStrength = (m?.confidence as Record<string, unknown> | undefined)?.trend_strength as string | undefined
            const trendStrengthNum = trendStrength === 'HIGH' ? 80 : trendStrength === 'MEDIUM' ? 50 : 0
            const blockPuts = aboveVWAP && higherLowsIntact && trendStrengthNum > 70
            const blockCalls = belowVWAP && lowerHighsIntact
            const countertrend = (isShort && blockCalls) || (!isShort && blockPuts)

            return (
              <div className="dt-card" style={{ background: dt.bg, border: allMet ? '1px solid rgba(52,211,153,0.3)' : countertrend ? '1px solid rgba(239,68,68,0.25)' : `1px solid ${dt.border}`, borderRadius: 14, padding: '14px 16px', marginBottom: 12 }}>
                <div style={{ fontSize: '0.6rem', fontWeight: 700, color: dt.muted, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10 }}>Entry Confirmation</div>

                {countertrend && (
                  <div style={{ padding: '6px 10px', marginBottom: 8, borderRadius: 6, fontSize: '0.68rem', fontWeight: 600, color: '#EF4444', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}>
                    ⚠ Countertrend — {isShort ? 'Trend still intact (higher lows).' : 'Trend still intact (lower highs).'} Consider waiting.
                  </div>
                )}

                <div style={{ display: 'grid', gap: '5px 16px', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', fontSize: '0.75rem' }}>
                  {/* Entry Trigger */}
                  <div style={{ padding: '4px 0', borderBottom: `1px solid ${dt.border}` }}>
                    <div style={{ fontSize: '0.6rem', color: dt.muted, marginBottom: 1 }}>Entry Trigger</div>
                    <div style={{ fontWeight: 600, color: triggerMet ? '#34d399' : '#94a3b8', fontFamily: 'monospace' }}>{triggerMet ? '✓ ' : '○ '}{triggerDesc}</div>
                  </div>
                  {/* Confirmation */}
                  <div style={{ padding: '4px 0', borderBottom: `1px solid ${dt.border}` }}>
                    <div style={{ fontSize: '0.6rem', color: dt.muted, marginBottom: 1 }}>Confirmation</div>
                    <div style={{ fontWeight: 600, color: confMet ? '#34d399' : '#94a3b8', fontFamily: 'monospace' }}>{confMet ? '✓ 2 candles hold' : '○ Pending trigger'}</div>
                  </div>
                  {/* Volume */}
                  <div style={{ padding: '4px 0', borderBottom: `1px solid ${dt.border}` }}>
                    <div style={{ fontSize: '0.6rem', color: dt.muted, marginBottom: 1 }}>Volume</div>
                    <div style={{ fontWeight: 600, color: volMet ? '#34d399' : '#94a3b8', fontFamily: 'monospace' }}>{volMet ? '✓ ' : '○ '}{rvol != null ? `${(rvol).toFixed(1)}×` : 'avg'}</div>
                  </div>
                  {/* Stop */}
                  <div style={{ padding: '4px 0', borderBottom: `1px solid ${dt.border}` }}>
                    <div style={{ fontSize: '0.6rem', color: dt.muted, marginBottom: 1 }}>Stop</div>
                    <div style={{ fontWeight: 600, color: '#94a3b8', fontFamily: 'monospace' }}>{stopDesc}</div>
                  </div>
                  {/* Risk */}
                  <div style={{ padding: '4px 0', borderBottom: `1px solid ${dt.border}` }}>
                    <div style={{ fontSize: '0.6rem', color: dt.muted, marginBottom: 1 }}>Risk</div>
                    <div style={{ fontWeight: 600, color: riskMet ? '#34d399' : '#94a3b8', fontFamily: 'monospace' }}>{riskMet ? '✓ ' : '○ '}{riskDesc}</div>
                  </div>
                  {/* Action */}
                  <div style={{ padding: '4px 0', borderBottom: `1px solid ${dt.border}` }}>
                    <div style={{ fontSize: '0.6rem', color: dt.muted, marginBottom: 1 }}>Action</div>
                    <div style={{ fontWeight: 800, color: actionColor, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{actionText}</div>
                  </div>
                </div>

                {allMet && <div style={{ marginTop: 6, padding: '4px 10px', borderRadius: 6, fontSize: '0.65rem', fontWeight: 600, color: '#34d399', background: 'rgba(52,211,153,0.08)', textAlign: 'center' }}>All conditions met — ready to execute</div>}
              </div>
            )
          })()}

          {/* Exit Plan */}
          {(() => {
          const eg = result?.entry_guidance as Record<string, unknown> | undefined
          const scalpTarget = eg?.scalp_target as number | undefined
          const scalpTarget2 = eg?.scalp_target_2 as number | undefined
          const exitRows = [...(unified.exit_rows || [])]
          if (scalpTarget != null && !exitRows.some(r => r.type === 't1')) {
            exitRows.push({ when: 'Target 1 — sell ½', price: `$${scalpTarget.toFixed(2)}`, action: 'Sell ½ position', type: 't1' })
          }
          if (scalpTarget2 != null && !exitRows.some(r => r.type === 't2')) {
            exitRows.push({ when: 'Target 2 — full exit', price: `$${scalpTarget2.toFixed(2)}`, action: 'Sell remaining ½', type: 't2' })
          }
          return (
          <div className="dt-card" style={{ background: dt.bg, border: `1px solid ${dt.border}`, borderRadius: 14, padding: '14px 16px', marginBottom: 12 }}>
            <div className="dt-muted" style={{ fontSize: '0.68rem', fontWeight: 700, color: dt.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>Exit Plan — Pre-Committed</div>
            {exitRows.length > 0 ? (
              <>
                {/* Desktop table */}
                <div className="hidden sm:block" style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                    <thead>
                      <tr>
                        {['WHEN', 'PRICE', 'ACTION'].map(h => (
                          <th key={h} style={{ textAlign: 'left', color: dt.muted, fontWeight: 600, paddingBottom: 8, fontSize: '0.68rem', letterSpacing: '0.06em', borderBottom: `1px solid ${dt.border}` }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {exitRows.map((row, i) => {
                        const isStop = row.type === 'stop'
                        const isT2 = row.type === 't2'
                        const isT1 = row.type === 't1'
                        const isTime = row.type === 'time'
                        const rowTone = isStop ? dt.red : isT2 ? dt.amber : isT1 ? dt.green : dt.text
                        const priceCls = isStop ? dt.red : isT2 ? dt.amber : isT1 ? dt.green : dt.muted
                        return (
                          <tr key={i} style={{ borderBottom: `1px solid ${dt.border}` }}>
                            <td style={{ paddingTop: 8, paddingBottom: 8, color: dt.muted, fontFamily: 'monospace', fontSize: '0.75rem' }}>{row.when}</td>
                            <td style={{ paddingTop: 8, paddingBottom: 8, fontFamily: 'monospace', fontWeight: 700, color: priceCls }}>{row.price}</td>
                            <td style={{ paddingTop: 8, paddingBottom: 8, color: isStop ? dt.red : isT1 || isT2 ? dt.green : dt.muted, fontSize: '0.75rem', fontWeight: isStop ? 500 : 400 }}>{row.action}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {/* Mobile card list */}
                <div className="sm:hidden space-y-2">
                  {exitRows.map((row, i) => {
                    const isStop = row.type === 'stop'
                    const isT2 = row.type === 't2'
                    const isT1 = row.type === 't1'
                    const rowTone = isStop ? dt.red : isT2 ? dt.amber : isT1 ? dt.green : dt.text
                    const priceCls = isStop ? dt.red : isT2 ? dt.amber : isT1 ? dt.green : dt.muted
                    return (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', borderRadius: 8, border: `1px solid ${dt.border}`, background: dt.bgDeep }}>
                        <div>
                          <div style={{ fontSize: '0.72rem', fontFamily: 'monospace', color: dt.muted, fontWeight: 600 }}>{row.when}</div>
                          <div style={{ fontSize: '0.68rem', color: isStop ? dt.red : isT1 || isT2 ? dt.green : dt.muted, marginTop: 2 }}>{row.action}</div>
                        </div>
                        <span style={{ fontFamily: 'monospace', fontWeight: 700, color: priceCls, fontSize: '0.88rem' }}>{row.price}</span>
                      </div>
                    )
                  })}
                </div>
              </>
            ) : (
              <div style={{ color: dt.muted, textAlign: 'center', padding: '8px 0', fontSize: '0.8rem' }}>Run full analysis for detailed exit levels</div>
            )}
          </div>
          )})()}

        </div>
      )}


      {/* Trend day banner */}
      {result && trendDayData && (() => {
        const m = result.metrics as Record<string, unknown>
        const chartBarsForAtr = parseChartBars(m.chart_bars)
        const atrUsedPct = (() => {
          const drUp = typeof m.daily_range_used_pct === 'number' ? m.daily_range_used_pct as number : null
          if (drUp != null) return drUp
          if (!chartBarsForAtr || chartBarsForAtr.length === 0) return null
          const h = Math.max(...chartBarsForAtr.map(b => b.h))
          const l = Math.min(...chartBarsForAtr.map(b => b.l))
          const atr = typeof m.atr14 === 'number' ? m.atr14 as number
            : typeof m.atr === 'number' ? m.atr as number : null
          return atr && atr > 0 ? ((h - l) / atr) * 100 : null
        })()
        return (
          <TrendDayBanner
            direction={trendDayData.direction}
            spyMove={trendDayData.spyMove}
            vixLevel={trendDayData.vixLevel}
            tickerCount={trendDayData.tickerCount}
            atrUsedPct={atrUsedPct}
            isDark={isDark}
          />
        )
      })()}

      {/* Options entry check */}
      {result && (() => {
        const m       = result.metrics as Record<string, unknown>
        const eg      = result.entry_guidance
        const verdict = result.verdict ?? result.final_decision ?? 'WAIT'
        const isGo    = /^(STRONG.?GO|GO)$/i.test(verdict)
        const isWatch = /WATCH/i.test(verdict)
        const isShort = result.bias === 'short'
        const chartBars = parseChartBars(m.chart_bars)
        const orHigh  = typeof m.or_high === 'number' ? m.or_high as number : undefined
        const orLow   = typeof m.or_low  === 'number' ? m.or_low  as number : undefined
        const mVwap   = typeof m.vwap === 'number' && isFinite(m.vwap) ? m.vwap as number : null
        const mRvol   = typeof m.rvol === 'number' && isFinite(m.rvol as number) ? m.rvol as number : null
        const lastPrice = typeof m.last_price === 'number' ? m.last_price as number : 0

        const sienOec    = String((eg as Record<string,unknown>)?.should_enter_now ?? '').toUpperCase()
        const rrOec      = typeof m.entry_rr_ratio === 'number' && isFinite(m.entry_rr_ratio as number) ? m.entry_rr_ratio as number : null
        const confOec    = typeof result.confidence === 'number' ? result.confidence : 0
        const extFlagOec = (m.edge_remaining === 'EXHAUSTED' || m.edge_remaining === 'LATE') || !!m.is_chasing
        const rtxtOec    = [result.reason ?? '', ...(Array.isArray(result.reasons) ? result.reasons : [])].join(' ').toLowerCase()
        const showGO     = isGo && sienOec === 'YES' && confOec > 80
          && (rrOec === null || rrOec >= 1.5)
          && !extFlagOec
          && !rtxtOec.includes('wait')
          && !rtxtOec.includes('no clean edge')
          && !rtxtOec.includes('confirmation')

        const chartTrigger: 'GO' | 'WAIT' | 'WATCHING' =
          entryState === 'MANAGE' || entryState === 'EXECUTE' ? 'GO' :
          entryState === 'ARMED' ? 'GO' :
          entryState === 'NO_TRADE' ? 'WAIT' :
          'WATCHING'
        const direction: 'SHORT' | 'LONG' = isShort ? 'SHORT' : 'LONG'
        const stopPrice = (() => {
          const rb = typeof eg?.risk_below === 'number' ? eg.risk_below as number : null
          if (rb && rb > 0) return rb
          return isShort ? (orHigh ?? lastPrice) : (orLow ?? lastPrice)
        })()

        const pcRatio = typeof m.put_call_ratio === 'number' ? m.put_call_ratio as number : null
        const pcAlignment: 'aligned' | 'conflict' | 'neutral' =
          pcRatio == null ? 'neutral'
          : pcRatio > 1.1 ? (isShort ? 'aligned' : 'conflict')
          : pcRatio < 0.9 ? (isShort ? 'conflict' : 'aligned')
          : 'neutral'

        let flipCondition = ''
        if (!isGo && chartBars) {
          const curPrice = chartBars[chartBars.length - 1]?.c ?? 0
          if (trendDayData && chartBars.length > 210) {
            // Trend day overrides the exhausted verdict
            flipCondition = `⚡ Trend day · Extension rules suspended · SPY ${trendDayData.spyMove >= 0 ? '+' : ''}${trendDayData.spyMove.toFixed(2)}% · VIX ${trendDayData.vixLevel.toFixed(1)} · ${trendDayData.tickerCount} tickers confirm · Entry valid · Widen stop by 50% · Target: next sigma band`
          } else if (chartBars.length > 210) {
            flipCondition = "Move is exhausted. Next valid setup is tomorrow's open."
          } else if (mRvol != null && mRvol < 0.75) {
            const ref = isShort ? orLow ?? 0 : orHigh ?? 0
            flipCondition = `Next breakdown candle volume exceeds 1.5× prior 5-candle average near $${ref.toFixed(2)}.`
          } else if (mVwap && Math.abs(curPrice - mVwap) / mVwap > 0.015) {
            const pullback = isShort ? mVwap * 1.005 : mVwap * 0.995
            flipCondition = `Price pulls back to $${pullback.toFixed(2)} before continuing ${isShort ? 'down' : 'up'}.`
          } else {
            const breakLevel = isShort ? orLow ?? 0 : orHigh ?? 0
            flipCondition = `Two consecutive ${isShort ? 'red' : 'green'} candles closing ${isShort ? 'below' : 'above'} $${breakLevel.toFixed(2)} with no wick recovery.`
          }
        }

        // Widen stop 0.5% on trend day (more room for volatility)
        const trendAdjStop = trendDayData
          ? (isShort ? stopPrice * 1.005 : stopPrice * 0.995)
          : stopPrice

        return (
          <OptionsEntryCheck
            key={ocKey}
            ticker={result.ticker}
            direction={direction}
            stopPrice={trendAdjStop}
            chartTrigger={chartTrigger}
            flipCondition={flipCondition}
            pcAlignment={pcAlignment}
            initialPrice={lastPrice}
            isDark={isDark}
          />
        )
      })()}



      {/* Intraday chart */}
      {result && result.metrics && (() => {
        const m = result.metrics as Record<string, unknown>
        const chartBars = parseChartBars(m.chart_bars)
        const orHigh = m.or_high as number | undefined
        const orLow = m.or_low as number | undefined
        const orMin = m.or_minutes as number | undefined
        const sessionDate = String(m.session_date ?? '')
        if (!chartBars || orHigh == null || orLow == null) return null

        const eg = result.entry_guidance
        const ac = result.ai_coach
        const isShort = result.bias === 'short'
        const mVwap = typeof m.vwap === 'number' && isFinite(m.vwap) ? m.vwap : null
        const stopFallback = isShort ? orHigh : orLow
        const pageEntryPoints: ChartEntryPoint[] = []
        const direction = isShort ? 'short' : 'long' as const

        const addEntry = (
          price: number | null | undefined,
          trigger: string,
          stop?: number,
          rr?: number,
          pending?: boolean,
          verdict?: string,
          exitPrice?: number,
          exitPrice2?: number,
          label?: string,
        ) => {
          if (!price || !isFinite(price) || price <= 0) return
          pageEntryPoints.push({ label: label ?? `E${pageEntryPoints.length + 1}`, price, trigger, stop, direction, exitPrice, exitPrice2, rr, pending, verdict })
        }

        // E1 — Momentum Breakout
        const eg1 = ac?.entry_gate as Record<string, unknown> | undefined
        const eg1Verdict  = eg1?.verdict as string | undefined
        const eg1IsNT     = eg1Verdict === 'NO_TRADE'
        const eg1Trigger  = eg1IsNT
          ? `⚠ EXTENDED — ${(eg1?.extended_reason as string) || 'entry past session T1'}`
          : `Momentum Breakout — ${(eg1?.trigger_condition as string) ?? 'gate trigger'}`
        addEntry(
          eg1?.trigger_price as number | undefined,
          eg1Trigger,
          eg1IsNT ? undefined : (eg1?.stop as number | undefined) ?? stopFallback,
          eg1IsNT ? 0 : (eg1?.risk_reward as number | undefined),
          false,
          eg1Verdict,
          eg1IsNT ? undefined : (eg1?.target as number | undefined),
          eg1IsNT ? undefined : (eg1?.target_2 as number | undefined),
          'E1',
        )

        // AI coach trade (current price analysis) — no generic E-number; ORH owns E2/E2R.
        const tr = ac?.trade as Record<string, unknown> | undefined
        const trVerdict = tr?.verdict as string | undefined
        const trIsNT    = trVerdict === 'NO_TRADE'
        const trRr      = tr?.risk_reward as number | undefined
        const trTrigger = trIsNT
          ? `⚠ EXTENDED — ${(tr?.extended_reason as string) || 'entry past session T1'}`
          : (tr ? `AI Coach · ${tr.direction} (R/R ${(trRr ?? 0).toFixed(1)}×)` : 'AI Coach')
        addEntry(
          tr?.entry_price as number | undefined,
          trTrigger,
          trIsNT ? undefined : (tr?.stop as number | undefined) ?? stopFallback,
          trIsNT ? 0 : trRr,
          false,
          trVerdict,
          trIsNT ? undefined : (tr?.target as number | undefined),
          trIsNT ? undefined : (tr?.target_2 as number | undefined),
          'AI',
        )

        // E2/E2R — ORH breakout lifecycle
        const orEntryPx  = (eg?.breakout_level ?? (isShort ? orLow : orHigh)) as number | undefined
        const orRr       = ac?.or_breakout_rr as Record<string, unknown> | undefined
        const orVerdict  = orRr?.verdict as string | undefined
        const orIsNT     = orVerdict === 'NO_TRADE'
        const orhLife = (m.orh_breakout_lifecycle ?? eg?.orh_breakout_lifecycle) as Record<string, unknown> | undefined
        const orhSignal = typeof orhLife?.signal === 'string' ? orhLife.signal : undefined
        const orhStatus = typeof orhLife?.status_message === 'string' ? orhLife.status_message : undefined
        const orLabel = !isShort && orhSignal === 'E2R' ? 'E2R' : 'E2'
        const orName = !isShort && orhSignal === 'E2R'
          ? 'ORH Re-breakout'
          : isShort ? 'ORL Breakdown' : 'ORH Breakout'
        // Compute a tight OR breakout stop: just below ORH (long) or above ORL (short) — NOT the far side
        const orBreakoutStop = orEntryPx
          ? (isShort ? orEntryPx * 1.003 : orEntryPx * 0.997)
          : (isShort ? orHigh : orLow)
        addEntry(
          orEntryPx,
          orhStatus ? `${orName} — ${orhStatus}` : orName,
          orIsNT ? undefined : (orRr?.stop as number | undefined) ?? orBreakoutStop,
          orIsNT ? 0 : (orRr?.risk_reward as number | undefined),
          !isShort && !orhSignal,
          orVerdict,
          orIsNT ? undefined : (orRr?.target as number | undefined),
          orIsNT ? undefined : (orRr?.target_2 as number | undefined),
          orLabel,
        )

        // E3 — Pullback Reset (active if detected); E4 — VWAP Bounce/Re-test.
        const pb = ac?.pullback_entry
        if (pb?.detected && pb.entry_price && isFinite(pb.entry_price)) {
          const pbConf     = pb.confidence
          const pbPat      = (pb.reclaim_pattern ?? 'RECLAIM').replace(/_/g, ' ')
          const pbColor    = pbConf === 'HIGH' ? '#f59e0b' : pbConf === 'MEDIUM_HIGH' ? '#fb923c' : '#94a3b8'
          const pbSizeNote = pbConf === 'HIGH' ? '' : pbConf === 'MEDIUM_HIGH' ? ' · 75% size' : ' · 50% size'
          const pbTrigger  = `Pullback Reset — ${(pbConf ?? 'detected').replace(/_/g, '-')} (${pbPat})${pbSizeNote}`
          pageEntryPoints.push({
            label:       'E3',
            price:       pb.entry_price,
            trigger:     pbTrigger,
            stop:        pb.stop,
            direction,
            exitPrice:   pb.target_1,
            exitPrice2:  pb.target_2,
            rr:          pb.rr_t1,
            pending:     false,
            verdict:     'VALID',
            color:       pbColor,
            triggerTime: pb.bar_timestamp,
          })
        } else {
          const vRr      = ac?.vwap_retest_rr as Record<string, unknown> | undefined
          const vVerdict = vRr?.verdict as string | undefined
          const vwapPrice = (eg?.vwap ?? mVwap) as number | null
          // Tight VWAP stop: just below VWAP for long — NOT ORL which is way too far
          const vwapRetestStop = vwapPrice ? (isShort ? vwapPrice * 1.003 : vwapPrice * 0.997) : stopFallback
          addEntry(
            vwapPrice,
            isShort ? 'VWAP Rejection' : 'VWAP Bounce',
            (vRr?.stop as number | undefined) ?? vwapRetestStop,
            vRr?.risk_reward as number | undefined,
            true,
            vVerdict,
          vRr?.target as number | undefined,
          vRr?.target_2 as number | undefined,
          'E4',
        )
        }

        // ── Build zone annotations ──────────────────────────────────────────
        const verdict = result.verdict ?? result.final_decision ?? 'WAIT'
        const isGo = /^(STRONG.?GO|GO)$/i.test(verdict)
        const isWatch = /WATCH/i.test(verdict)
        const isWait = !isGo && !isWatch
        const biasLabel = isShort ? 'SHORT' : 'LONG'
        const verdictColor = isGo ? '#34d399' : isWatch ? '#38bdf8' : '#6b7280'
        const orN = orMin ?? 15
        const t1 = typeof eg?.scalp_target === 'number' && isFinite(eg.scalp_target) ? eg.scalp_target as number : null
        const egRaw = eg as Record<string, unknown> | undefined
        const t2 = typeof egRaw?.scalp_target_2 === 'number' && isFinite(egRaw.scalp_target_2 as number) ? egRaw.scalp_target_2 as number : null
        const sien = String((eg as Record<string,unknown>)?.should_enter_now ?? '').toUpperCase()
        const entryReadiness = sien === 'YES' ? 'Execute within 1–2 candles.' : sien === 'CONDITIONAL' ? 'Wait for trigger candle confirmation.' : 'No confirmed trigger yet — monitor closely.'

        const triggerConfirmed = sien === 'YES'
        const rrRatio = typeof m.entry_rr_ratio === 'number' && isFinite(m.entry_rr_ratio as number)
          ? m.entry_rr_ratio as number : null
        const conf       = typeof result.confidence === 'number' ? result.confidence : 0
        const extFlagged = (m.edge_remaining === 'EXHAUSTED' || m.edge_remaining === 'LATE') || !!m.is_chasing
        const reasonTxt  = [result.reason ?? '', ...(Array.isArray(result.reasons) ? result.reasons : [])].join(' ').toLowerCase()
        // State-based display values for Zone 2 card
        const z2Verdict = entryState === 'WATCH' ? 'WATCH' : entryState === 'NO_TRADE' ? 'NO TRADE' : entryState
        const z2BadgeText = entryState === 'MANAGE' ? 'MANAGING' : z2Verdict
        const entryStateColor = (st: TradeEntryState): string =>
          st === 'EXECUTE' ? '#34d399' :
          st === 'ARMED' ? '#E87B3A' :
          st === 'MANAGE' ? '#818CF8' :
          st === 'NO_TRADE' ? '#EF4444' :
          '#38bdf8'
        const z2VColor = entryStateColor(entryState)

        // Theme-adaptive card helpers
        const cBg  = (d: string, l: string) => isDark ? d : l
        const cBdr = (d: string, l: string) => isDark ? d : l
        const cTxt = (d: string, l: string) => isDark ? d : l

        const dayZones: ZoneAnnotation[] = []

        // Zone 1 — Opening Range
        dayZones.push({
          key: 'opening-range',
          from: 0,
          to: Math.min(orN - 1, chartBars.length - 1),
          fill: 'rgba(251,191,36,0.06)',
          label: 'Opening Range',
          sublabel: `First ${orN}m`,
          markerColor: '#F59E0B',
          cardBg:     cBg('rgba(20,14,4,0.88)',       'rgba(255,251,235,0.97)'),
          cardBorder: cBdr('#78350F',                  '#D97706'),
          textColor:  cTxt('#FCD34D',                  '#92400E'),
          badgeText: `${orN}m`,
          badgeBg: isDark ? 'rgba(245,158,11,0.14)' : 'rgba(245,158,11,0.22)',
          detail: `The first ${orN} minutes establish the opening range (ORH $${orHigh.toFixed(2)} / ORL $${orLow.toFixed(2)}). Wait for a confirmed break with volume expansion before entering.`,
        })

        // ── NO TRADE ZONE annotation ────────────────────────────────────────
        if (noTradeZoneActive && orN < chartBars.length && entryState === 'NO_TRADE') {
          dayZones.push({
            key: 'no-trade-zone',
            from: orN,
            to: chartBars.length - 1,
            fill: 'rgba(239,68,68,0.08)',
            label: 'NO TRADE ZONE',
            sublabel: 'VWAP compression + Inside OR',
            markerColor: '#EF4444',
            cardBg:     cBg('rgba(20,4,4,0.92)',       'rgba(254,242,242,0.97)'),
            cardBorder: cBdr('#7F1D1D',                 '#DC2626'),
            textColor:  cTxt('#FCA5A5',                 '#991B1B'),
            badgeText: 'NO TRADE',
            badgeBg: isDark ? 'rgba(239,68,68,0.14)' : 'rgba(239,68,68,0.22)',
            detail: 'No trade zone: price within 0.30% of VWAP and inside opening range. Wait for a clean break with volume before entering.',
          })
        }

        // ── Flip-to-GO condition (WAIT only) ────────────────────────────────
        let flipCondition: string | undefined
        if (isWait) {
          const lastBar = chartBars[chartBars.length - 1]
          const curPrice = lastBar?.c ?? 0
          const mRvol = typeof m.rvol === 'number' && isFinite(m.rvol as number) ? m.rvol as number : null

          if (trendDayData && chartBars.length > 210) {
            // TREND DAY — extension rules suspended even in a late session
            flipCondition = `⚡ Trend day · Extension rules suspended · SPY ${trendDayData.spyMove >= 0 ? '+' : ''}${trendDayData.spyMove.toFixed(2)}% · VIX ${trendDayData.vixLevel.toFixed(1)} · ${trendDayData.tickerCount} tickers confirm · Entry valid · Widen stop by 50% · Target: next sigma band`
          } else if (chartBars.length > 210) {
            // CONDITION E — late / exhausted session
            flipCondition = 'Do not enter. Move is exhausted. Next valid setup is tomorrow\'s open.'
          } else if (mRvol != null && mRvol < 0.75) {
            // CONDITION A — low relative volume
            const refLevel = isShort ? orLow : orHigh
            flipCondition = `Next breakdown candle volume exceeds 1.5× the prior 5-candle average near $${refLevel.toFixed(2)}. Watch the volume bar, not the price.`
          } else if (mVwap != null && mVwap > 0 && Math.abs(curPrice - mVwap) / mVwap > 0.015) {
            // CONDITION B — price extended from VWAP
            const pullback = isShort ? mVwap * 1.005 : mVwap * 0.995
            flipCondition = `Price pulls back to $${pullback.toFixed(2)} before continuing ${isShort ? 'down' : 'up'} — do not chase ${isShort ? 'below' : 'above'} $${curPrice.toFixed(2)}.`
          } else if (chartBars.length >= 4 && mVwap != null && mVwap > 0) {
            // CONDITION D — bouncing toward VWAP
            const recent4 = chartBars.slice(-4)
            const bouncing = isShort
              ? recent4[recent4.length - 1].c > recent4[0].c && curPrice < mVwap
              : recent4[recent4.length - 1].c < recent4[0].c && curPrice > mVwap
            if (bouncing) {
              flipCondition = `Bounce fails below $${mVwap.toFixed(2)}. Wait for the first ${isShort ? 'red' : 'green'} candle after the bounce stalls — that is the entry.`
            }
          }

          if (!flipCondition) {
            // CONDITION C — default: no confirmed break yet
            const breakLevel = isShort ? orLow : orHigh
            flipCondition = `Two consecutive ${isShort ? 'red' : 'green'} candles closing ${isShort ? 'below' : 'above'} $${breakLevel.toFixed(2)} with no wick recovery — that is your entry, not before.`
          }
        }

        // Zone 2 — Entry window (post-OR, up to 45 bars)
        if (orN < chartBars.length) {
          const eFill =
            entryState === 'EXECUTE' ? 'rgba(52,211,153,0.07)' :
            entryState === 'ARMED' ? 'rgba(232,123,58,0.07)' :
            entryState === 'NO_TRADE' ? 'rgba(239,68,68,0.07)' :
            entryState === 'MANAGE' ? 'rgba(99,102,241,0.07)' :
            'rgba(56,189,248,0.07)'
          const eBg = (d1: string, d2: string, d3: string, d4: string, l1: string, l2: string, l3: string, l4: string) =>
            entryState === 'EXECUTE' ? (isDark ? d1 : l1) :
            entryState === 'ARMED' ? (isDark ? d2 : l2) :
            entryState === 'NO_TRADE' ? (isDark ? d3 : l3) :
            entryState === 'MANAGE' ? (isDark ? d4 : l4) :
            (isDark ? d1 : l1)
          const eBdr = (d1: string, d2: string, d3: string, d4: string, l1: string, l2: string, l3: string, l4: string) =>
            entryState === 'EXECUTE' ? (isDark ? d1 : l1) :
            entryState === 'ARMED' ? (isDark ? d2 : l2) :
            entryState === 'NO_TRADE' ? (isDark ? d3 : l3) :
            entryState === 'MANAGE' ? (isDark ? d4 : l4) :
            (isDark ? d1 : l1)
          const eBgBadge = (d: string, l: string) => isDark ? d : l
          dayZones.push({
            key: 'entry',
            from: orN,
            to: Math.min(orN + 44, chartBars.length - 1),
            fill: eFill,
            label: entryState === 'NO_TRADE' ? 'NO TRADE' : z2BadgeText,
            sublabel: `${biasLabel} · post-OR`,
            markerColor: z2VColor,
            cardBg: eBg(
              'rgba(2,12,8,0.92)', 'rgba(18,10,2,0.92)', 'rgba(20,4,4,0.92)', 'rgba(4,4,18,0.92)',
              'rgba(240,253,244,0.97)', 'rgba(255,251,235,0.97)', 'rgba(254,242,242,0.97)', 'rgba(245,243,255,0.97)',
            ),
            cardBorder: eBdr(
              '#065F46', '#78350F', '#7F1D1D', '#312E81',
              '#059669', '#D97706', '#DC2626', '#7C3AED',
            ),
            textColor: cTxt(z2VColor,
              entryState === 'EXECUTE' ? '#065F46' :
              entryState === 'ARMED' ? '#92400E' :
              entryState === 'NO_TRADE' ? '#991B1B' :
              entryState === 'MANAGE' ? '#4C1D95' :
              '#0369A1'),
            badgeText: z2BadgeText,
            badgeBg: eBgBadge(
              entryState === 'EXECUTE' ? 'rgba(52,211,153,0.12)' :
              entryState === 'ARMED' ? 'rgba(232,123,58,0.12)' :
              entryState === 'NO_TRADE' ? 'rgba(239,68,68,0.14)' :
              entryState === 'MANAGE' ? 'rgba(99,102,241,0.12)' :
              'rgba(56,189,248,0.12)',
              entryState === 'EXECUTE' ? 'rgba(52,211,153,0.18)' :
              entryState === 'ARMED' ? 'rgba(232,123,58,0.18)' :
              entryState === 'NO_TRADE' ? 'rgba(239,68,68,0.22)' :
              entryState === 'MANAGE' ? 'rgba(99,102,241,0.16)' :
              'rgba(56,189,248,0.18)',
            ),
            price: t1 ? `T1 $${t1.toFixed(2)} · ${biasLabel}` : biasLabel,
            detail: `${entryState === 'EXECUTE' ? 'Entry window active' : entryState === 'ARMED' ? 'Setup present · conditions not met · wait for trigger' : entryState === 'NO_TRADE' ? 'No trade — VWAP compression inside OR' : entryState === 'MANAGE' ? 'Managing position' : 'Setup developing'}. ${biasLabel} bias confirmed. ${entryReadiness}${t1 ? ` First target T1: $${t1.toFixed(2)}.` : ''}`,
            flipCondition,
          })
        }

        // Zone 3 — Hold / Monitor (after entry window)
        const holdFrom = orN + 45
        if (holdFrom < chartBars.length) {
          dayZones.push({
            key: 'monitor',
            from: holdFrom,
            to: chartBars.length - 1,
            fill: 'rgba(99,102,241,0.04)',
            label: 'Hold / Monitor',
            sublabel: t1 ? `T1 $${t1.toFixed(2)}` : 'Manage position',
            markerColor: '#818CF8',
            cardBg:     cBg('rgba(4,4,18,0.92)',       'rgba(245,243,255,0.97)'),
            cardBorder: cBdr('#312E81',                 '#7C3AED'),
            textColor:  cTxt('#A5B4FC',                 '#4C1D95'),
            badgeText: 'MANAGE',
            badgeBg: isDark ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.16)',
            price: t1 ? `T1 $${t1.toFixed(2)}${t2 ? ` · T2 $${t2.toFixed(2)}` : ''}` : undefined,
            detail: t1
              ? `Manage your ${biasLabel} position. Take ½ off at T1 $${t1.toFixed(2)}${t2 ? `, trail the rest to T2 $${t2.toFixed(2)}` : ''}. Move stop to breakeven once T1 is hit.`
              : `Manage your position. Hold your pre-planned stop. Exit at your target or stop — no early exits on noise.`,
          })

          // ── Re-entry detection (Hold/Monitor zone only) ─────────────────────
          const holdBars = chartBars.slice(holdFrom)
          // Re-entries target T2 first (original extended target); fall back to T1
          const reTarget = t2 ?? t1
          const reBlue = {
            fill:       'rgba(59,130,246,0.07)',
            markerColor:'#60a5fa',
            cardBg:     cBg('rgba(2,8,22,0.92)',       'rgba(239,246,255,0.97)'),
            cardBorder: cBdr('#1e40af',                 '#3b82f6'),
            textColor:  cTxt('#93c5fd',                 '#1d4ed8'),
            badgeText:  'RE-ENTRY',
            badgeBg:    isDark ? 'rgba(59,130,246,0.12)' : 'rgba(59,130,246,0.18)',
          }
          const candle = isShort ? 'red' : 'green'

          // Trend day overrides exhaustion — re-entries stay open all session
          const isExhausted = !trendDayData && (chartBars.length > 210 || !!(flipCondition?.includes('exhausted')))

          if (!isExhausted) {
            // Shared throttle — all three types draw from one pool (max 3 / session)
            let reEntryCount      = 0
            let lastReEntryAbsIdx = -999   // absolute bar index of the last fired card
            let lastReEntryPrice  = 0      // close price at the last fired card

            // Returns true only when all quality gates pass.
            const canFire = (absIdx: number, closePx: number, rr: number | null): boolean =>
              reEntryCount < 3
              && (absIdx - lastReEntryAbsIdx) >= 20              // Fix 1: 20-bar cooldown
              && (lastReEntryPrice <= 0 || Math.abs(closePx - lastReEntryPrice) / lastReEntryPrice >= 0.005)  // Fix 2: 0.5% price movement
              && rr != null && rr >= 1.5                         // Fix 4: R/R gate

            const markFired = (absIdx: number, closePx: number) => {
              reEntryCount++
              lastReEntryAbsIdx = absIdx
              lastReEntryPrice  = closePx
            }

            // ── A: VWAP pullback ─────────────────────────────────────────────
            // Price must pull to within 0.3% of VWAP (tighter than before),
            // confirmed by the prior candle closing in the trade direction.
            {
              let rAextended  = false
              let rAinPullback = false
              for (let i = 1; i < holdBars.length; i++) {
                const bar  = holdBars[i]!
                const prev = holdBars[i - 1]!
                const vwap = bar.vwap
                if (vwap <= 0) continue
                const distPct  = (bar.c - vwap) / vwap
                const extended = isShort ? distPct < -0.005 : distPct > 0.005
                const nearVwap = Math.abs(distPct) <= 0.003      // Fix 4: tightened 0.5→0.3%
                if (extended) { rAextended = true; rAinPullback = false }
                if (rAextended && nearVwap && !rAinPullback) {
                  rAinPullback = true
                  const absIdx = holdFrom + i
                  const stopA  = isShort ? vwap * 1.005 : vwap * 0.995
                  const invalidated = holdBars.slice(i + 1).some(b => isShort ? b.h > stopA : b.l < stopA)
                  // Fix 4: prior candle must close in trade direction
                  const prevConfirms = isShort ? prev.c < prev.o : prev.c > prev.o
                  if (!invalidated && prevConfirms) {
                    const rrA = reTarget != null ? Math.abs(reTarget - vwap) / Math.abs(vwap - stopA) : null
                    if (canFire(absIdx, bar.c, rrA)) {
                      markFired(absIdx, bar.c)
                      dayZones.push({
                        key: `reentry-a-${absIdx}`,
                        from: Math.max(absIdx - 1, holdFrom),
                        to:   Math.min(absIdx + 3, chartBars.length - 1),
                        ...reBlue,
                        label:    'RE-ENTRY',
                        sublabel: 'A — VWAP pullback',
                        price:    `VWAP $${vwap.toFixed(2)}${rrA != null ? ` · R/R ${rrA.toFixed(1)}×` : ''}`,
                        detail:   `Re-entry window · Price testing VWAP $${vwap.toFixed(2)} · Stop ${isShort ? 'above' : 'below'} VWAP $${stopA.toFixed(2)}`,
                        reentryTrigger: `First ${candle} candle off VWAP $${vwap.toFixed(2)}${rrA != null ? ` · R/R ${rrA.toFixed(1)}×` : ''}`,
                      })
                    }
                  }
                }
              }
            }

            // ── B: OR level retest ───────────────────────────────────────────
            {
              const retestLevel = isShort ? orLow : orHigh
              const stopB = isShort ? retestLevel * 1.003 : retestLevel * 0.997
              const hadBreakout = chartBars.slice(0, holdFrom).some(b =>
                isShort ? b.c < retestLevel * 0.997 : b.c > retestLevel * 1.003
              )
              if (hadBreakout) {
                let rBaway    = false
                let rBinRetest = false
                for (let i = 1; i < holdBars.length; i++) {
                  const bar  = holdBars[i]!
                  const prev = holdBars[i - 1]!
                  const dist = Math.abs(bar.c - retestLevel) / retestLevel
                  const nearLevel     = dist <= 0.003
                  const awayFromLevel = dist > 0.003
                  if (awayFromLevel) { rBaway = true; rBinRetest = false }
                  if (rBaway && nearLevel && !rBinRetest) {
                    rBinRetest = true
                    const absIdx      = holdFrom + i
                    const invalidated = holdBars.slice(i + 1).some(b => isShort ? b.h > stopB : b.l < stopB)
                    const prevConfirms = isShort ? prev.c < prev.o : prev.c > prev.o
                    if (!invalidated && prevConfirms) {
                      const rrB = reTarget != null ? Math.abs(reTarget - retestLevel) / Math.abs(retestLevel - stopB) : null
                      if (canFire(absIdx, bar.c, rrB)) {
                        markFired(absIdx, bar.c)
                        const orLabel      = isShort ? 'OR low' : 'OR high'
                        const supportLabel = isShort ? 'resistance' : 'support'
                        dayZones.push({
                          key: `reentry-b-${absIdx}`,
                          from: Math.max(absIdx - 1, holdFrom),
                          to:   Math.min(absIdx + 3, chartBars.length - 1),
                          ...reBlue,
                          label:    'RE-ENTRY',
                          sublabel: `B — ${orLabel} retest`,
                          price:    `${orLabel} $${retestLevel.toFixed(2)}${rrB != null ? ` · R/R ${rrB.toFixed(1)}×` : ''}`,
                          detail:   `Re-entry window · ${orLabel} $${retestLevel.toFixed(2)} acting as ${supportLabel} · Hold confirmed · Enter · Stop ${isShort ? 'above' : 'below'} $${stopB.toFixed(2)}`,
                          reentryTrigger: `${candle.charAt(0).toUpperCase() + candle.slice(1)} candle holding ${isShort ? 'below' : 'above'} $${retestLevel.toFixed(2)}${rrB != null ? ` · R/R ${rrB.toFixed(1)}×` : ''}`,
                        })
                      }
                    }
                  }
                }
              }
            }

            // ── C: Higher low ────────────────────────────────────────────────
            // Confirmation candle = the bar after the swing low (the first bounce bar)
            {
              const swingLows: Array<{ absIdx: number; low: number }> = []
              for (let i = 1; i < holdBars.length - 1; i++) {
                const p = holdBars[i - 1]!, c = holdBars[i]!, n = holdBars[i + 1]!
                if (c.l <= p.l && c.l <= n.l) swingLows.push({ absIdx: holdFrom + i, low: c.l })
              }
              for (let j = 1; j < swingLows.length; j++) {
                const prevSL = swingLows[j - 1]!
                const cur    = swingLows[j]!
                if (cur.low > prevSL.low) {
                  const localI   = cur.absIdx - holdFrom
                  const nextBar  = holdBars[localI + 1]   // first bounce bar
                  if (!nextBar) continue
                  // Fix 4: confirmation bar must close in trade direction
                  const nextConfirms = isShort ? nextBar.c < nextBar.o : nextBar.c > nextBar.o
                  if (!nextConfirms) continue
                  const stopC      = isShort ? cur.low * 1.003 : cur.low * 0.997
                  const afterI     = localI + 1
                  const invalidated = holdBars.slice(afterI).some(b => isShort ? b.h > cur.low : b.l < cur.low)
                  if (!invalidated) {
                    const entryApprox = nextBar.c
                    const rrC = reTarget != null ? Math.abs(reTarget - entryApprox) / Math.abs(entryApprox - stopC) : null
                    const absIdx = cur.absIdx + 1  // fire at the confirmation bar
                    if (canFire(absIdx, entryApprox, rrC)) {
                      markFired(absIdx, entryApprox)
                      dayZones.push({
                        key: `reentry-c-${absIdx}`,
                        from: Math.max(absIdx - 1, holdFrom),
                        to:   Math.min(absIdx + 3, chartBars.length - 1),
                        ...reBlue,
                        label:    'RE-ENTRY',
                        sublabel: 'C — Higher low',
                        price:    `Higher low $${cur.low.toFixed(2)}${rrC != null ? ` · R/R ${rrC.toFixed(1)}×` : ''}`,
                        detail:   `Re-entry window · Higher low at $${cur.low.toFixed(2)} · Trend intact · Next ${candle} candle is entry · Stop ${isShort ? 'above' : 'below'} $${stopC.toFixed(2)}`,
                        reentryTrigger: `First ${candle} candle off higher low $${cur.low.toFixed(2)}${rrC != null ? ` · R/R ${rrC.toFixed(1)}×` : ''}`,
                      })
                    }
                  }
                }
              }
            }
          } // end !isExhausted
        }

        const displayBars = resampleBars(chartBars, chartInterval)
        const displayOrMinutes = orMinutesForInterval(orN, chartInterval)

        return (
         <>
          <VwapVsOrMidCard
            close={typeof m.last_price === 'number' ? (m.last_price as number) : null}
            vwap={mVwap}
            orHigh={orHigh}
            orLow={orLow}
            isDark={isDark}
            dt={dt}
          />
          <div className="dt-card" style={{ background: dt.bg, border: `1px solid ${dt.border}`, borderRadius: 14, padding: '14px 16px', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div className="dt-muted" style={{ fontSize: '0.68rem', fontWeight: 700, color: dt.muted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Session Chart · OR &amp; VWAP · {chartInterval}</div>
              <div style={{ display: 'flex', gap: 4 }}>
                {(['1h', '15m', '5m', '1m'] as ChartInterval[]).map(iv => (
                  <button
                    key={iv}
                    type="button"
                    onClick={() => setChartInterval(iv)}
                    title={`${iv} candles`}
                    style={{ padding: '2px 10px', borderRadius: 20, fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer', border: `1px solid ${chartInterval === iv ? dt.green : dt.border}`, background: chartInterval === iv ? (isDark ? '#064e3b' : '#d1fae5') : 'transparent', color: chartInterval === iv ? dt.green : dt.muted, transition: 'all 0.15s' }}
                  >
                    {iv}
                  </button>
                ))}
              </div>
            </div>
            {/* State banner + rule */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6, padding: '6px 10px', borderRadius: 8, border: `1px solid ${entryState === 'NO_TRADE' ? '#EF444480' : entryState === 'EXECUTE' ? '#34d39980' : entryState === 'ARMED' ? '#E87B3A80' : entryState === 'MANAGE' ? '#818CF880' : '#38bdf880'}`,
              background: entryState === 'NO_TRADE' ? 'rgba(239,68,68,0.08)' : entryState === 'EXECUTE' ? 'rgba(52,211,153,0.08)' : entryState === 'ARMED' ? 'rgba(232,123,58,0.08)' : entryState === 'MANAGE' ? 'rgba(129,140,248,0.08)' : 'rgba(56,189,248,0.08)'
            }}>
              <span style={{
                fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase',
                padding: '1px 8px', borderRadius: 12,
                color: entryState === 'NO_TRADE' ? '#EF4444' : entryState === 'EXECUTE' ? '#34d399' : entryState === 'ARMED' ? '#E87B3A' : entryState === 'MANAGE' ? '#818CF8' : '#38bdf8',
                background: entryState === 'NO_TRADE' ? 'rgba(239,68,68,0.15)' : entryState === 'EXECUTE' ? 'rgba(52,211,153,0.15)' : entryState === 'ARMED' ? 'rgba(232,123,58,0.15)' : entryState === 'MANAGE' ? 'rgba(129,140,248,0.15)' : 'rgba(56,189,248,0.15)',
              }}>{entryState === 'NO_TRADE' ? '◇ WATCHING' : entryState === 'EXECUTE' ? '🟢 TRIGGERED' : entryState === 'MANAGE' ? '🟢 ACTIVE' : entryState === 'ARMED' ? '🟠 ARMED' : `◇ ${entryLifecycleLabel}`}</span>
              <span style={{ fontSize: '0.68rem', color: dt.muted, flex: 1, minWidth: 0 }}>
                {entryState === 'NO_TRADE' && noTradeZoneActive ? 'Price inside OR + within 0.30% of VWAP — wait for breakout with volume.'
                : entryState === 'NO_TRADE' ? 'No valid setup yet — monitoring market structure and waiting for alignment.'
                : entryState === 'EXECUTE' ? 'Entry trigger fired — manage entry, stop, and targets.'
                : entryState === 'ARMED' ? 'Setup present — wait for trigger confirmation before entering.'
                : entryState === 'MANAGE' ? 'Trade active — manage stop, targets, and partial exits.'
                : 'Watching — setup developing, waiting for confluence.'}
              </span>
              {stateLocked && <span style={{ fontSize: '0.6rem', fontWeight: 700, color: '#F59E0B' }}>⏳ {(stateLockedUntil - Date.now() > 0 ? Math.ceil((stateLockedUntil - Date.now()) / 60000) : 0)}m</span>}
            </div>
            <PCRatioStrip
              pcRatio={typeof m.put_call_ratio === 'number' ? m.put_call_ratio as number : null}
              totalOptionsVol={typeof m.total_options_vol === 'number' ? m.total_options_vol as number : null}
              bias={result.bias ?? null}
              isDark={isDark}
            />
            <EntryWindowBanner
              key={result.ticker}
              active={sessionState === 'entry' || (!!trendDayData && sessionState !== 'hold' && sessionState !== 'exhausted')}
              ticker={result.ticker}
              direction={isShort ? 'PUT' : 'CALL'}
              entryPrice={pageEntryPoints[0]?.price ?? null}
              stopPrice={(() => {
                const base = (eg?.risk_below as number | undefined) ?? stopFallback
                return trendDayData ? (isShort ? base * 1.005 : base * 0.995) : base
              })()}
              t1={t1}
              t2={t2}
              allSession={!!trendDayData}
              onEntered={handleBannerEntered}
              onExpire={handleBannerExpire}
              isDark={isDark}
            />
            <DayTradeIntradayChart bars={displayBars} orHigh={orHigh} orLow={orLow} orMinutes={displayOrMinutes} sessionDate={sessionDate} entryPoints={pageEntryPoints.length > 0 ? pageEntryPoints : undefined} zones={dayZones} isDark={isDark} />
          </div>
         </>
        )
      })()}

      {/* AI Coach — compact summary */}
      {result && (() => {
        const raw = result as unknown as Record<string, unknown> | undefined
        const m = raw?.metrics as Record<string, unknown> | undefined
        const marketBias = (result.market_bias || '').toLowerCase().replace(/_/g, ' ')
        const vwapDist = m?.vwap_dist_pct as number | undefined
        const volSpike = !!m?.volume_spike
        const orBreakout = String(m?.or_breakout ?? '').toUpperCase()
        const isShortWalk = result.bias === 'short'
        const exec = String(result.entry_guidance?.should_enter_now || '').toUpperCase()

        const coachingLines: string[] = []
        coachingLines.push(marketBias ? `Market: ${marketBias}.` : '')
        coachingLines.push(
          isShortWalk
            ? (vwapDist != null && vwapDist <= 0 ? 'VWAP confirms bearish structure.' : 'VWAP not yet confirming short.')
            : (vwapDist != null && vwapDist >= 0 ? 'VWAP confirms bullish structure.' : 'VWAP not yet confirming long.')
        )
        if (volSpike) coachingLines.push('Volume spiking — execution quality improves.')
        if (exec === 'YES') coachingLines.push('Entry trigger confirmed — execute on next bar.')
        else if (exec === 'CONDITIONAL') coachingLines.push('Entry conditional — wait for trigger candle.')
        else coachingLines.push('No entry trigger yet — patience.')

        return (
          <div style={{ padding: '8px 14px', borderRadius: 8, fontSize: '0.7rem', color: dt.muted, background: dt.bgDeep, border: `1px solid ${dt.border}`, marginBottom: 12 }}>
            <span style={{ fontWeight: 700, color: dt.accent }}>Coach:</span> {coachingLines.filter(Boolean).join(' ')}
          </div>
        )
      })()}

      {/* Alert Overlay Chart + Collapsible Alert List */}
      {result && result.metrics && (() => {
        const m = result.metrics as Record<string, unknown>
        const chartBars2 = parseChartBars(m.chart_bars)
        const orHigh2 = m.or_high as number | undefined
        const orLow2  = m.or_low  as number | undefined
        const orMin2  = m.or_minutes as number | undefined
        if (!chartBars2 || orHigh2 == null || orLow2 == null) return null

        // Build a synthetic alert from the current scan so the marker always shows,
        // even when the ticker is not on the user's day-trade watchlist.
        const actionableVerdicts = ['STRONG_GO', 'GO', 'WATCH'] as const
        const lastBar = chartBars2[chartBars2.length - 1]
        const scanAlert: DayTradeAlertEvent | null =
          lastBar && (actionableVerdicts as readonly string[]).includes(result.verdict)
            ? {
                id: `scan-${result.ticker}-${lastBar.t}`,
                ticker: result.ticker,
                companyName: result.company_name,
                previousVerdict: '',
                verdict: result.verdict,
                bias: result.bias,
                bullScore: result.bull_score,
                bearScore: result.bear_score,
                reasons: result.reasons ?? [],
                metrics: result.metrics,
                detectedAt: new Date(lastBar.t).getTime(),
                emailSent: false,
              }
            : null

        return (
          <DayTradeAlertOverlay
            bars={chartBars2}
            orHigh={orHigh2}
            orLow={orLow2}
            orMinutes={orMin2 ?? 15}
            ticker={result.ticker}
            scanAlerts={scanAlert ? [scanAlert] : []}
          />
        )
      })()}

      {/* Step-by-step walkthrough */}
      {result && (
        <DayTradeWalkthrough result={result} />
      )}

      {/* Flow reference */}
      <details className="group rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900 overflow-hidden">
        <summary className="flex cursor-pointer items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-secondary hover:bg-surface-muted/30">
          <span className="flex items-center gap-2">
            <BarChart2 size={16} className="text-violet-400" />
            What this prototype does
          </span>
          <ChevronDown size={16} className="text-muted transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t border-slate-100 dark:border-white/[0.05] px-4 pb-4 space-y-3 text-xs text-gray-500 pt-3">
          <p>
            Pulls <span className="text-secondary">1-minute</span> regular-session candles, builds session{' '}
            <span className="text-secondary">VWAP</span>,{' '}
            <span className="text-secondary">opening range</span> (first 15 minutes), checks price vs range and VWAP, short lookback{' '}
            <span className="text-secondary">momentum</span>, and a simple <span className="text-secondary">volume spike</span> flag.
            Blends in <span className="text-secondary">SPY / QQQ</span> one-day change and <span className="text-secondary">VIX</span> as risk context.
          </p>
          <p className="text-amber-200/70 border border-amber-800/40 bg-amber-950/20 rounded-lg px-3 py-2">
            <Flame size={12} className="inline mr-1" />
            Educational only — not financial advice. Intraday data can be delayed; verify prices with your broker.
          </p>
          <ul className="space-y-2">
            <li className="flex gap-2"><Clock size={14} className="shrink-0 text-muted" /> Most recent trading day in the feed is analyzed if today has no session yet.</li>
            <li className="flex gap-2"><ArrowDown size={14} className="shrink-0 text-muted" /> <span className="text-tertiary">Market bias</span> tells you whether the tape is supportive. <span className="text-tertiary">Execution readiness</span> tells you whether the trigger is actually there.</li>
            <li className="flex gap-2"><ArrowDown size={14} className="shrink-0 text-muted" /> The page now resolves everything into <span className="text-tertiary">READY / WAIT / WATCH / AVOID</span> so a bullish tape does not get mistaken for an immediate entry.</li>
            <li className="flex gap-2"><Zap size={14} className="shrink-0 text-orange-400" /> <span><span className="text-tertiary">Trend day detection</span> fires when SPY moves {'>'} 0.8%, VIX confirms, and 3+ watchlist tickers move in the same direction. Extension rules are suspended and the entry window stays open all session. See Help → Day Trade Engine for full detection thresholds.</span></li>
          </ul>
        </div>
      </details>
      </>
      )}

      {portfolioOpen && result && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal>
          <div className="w-full max-w-md rounded-2xl border border-gray-700 bg-gray-900 shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
              <div className="text-base font-bold text-white">Add to Positions Center</div>
              <button
                type="button"
                onClick={() => setPortfolioOpen(false)}
                className="text-gray-500 hover:text-gray-300 p-1"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <div className="rounded-lg bg-gray-800/40 border border-gray-700/50 px-3 py-2.5 flex items-center gap-3">
                <span className="font-mono font-bold text-white text-base">{result.ticker}</span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${result.bias === 'short' ? 'bg-rose-900/60 text-rose-300' : 'bg-emerald-900/60 text-emerald-300'}`}>
                  {result.bias === 'short' ? 'BEARISH' : 'BULLISH'}
                </span>
                <span className="text-xs text-gray-500 ml-auto">{result.final_decision}</span>
              </div>
              <div>
                <label className="text-xs text-gray-500 font-semibold uppercase tracking-wide">Contracts</label>
                <input
                  className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white font-mono"
                  inputMode="numeric"
                  placeholder="1"
                  value={portfolioContracts}
                  onChange={e => setPortfolioContracts(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 font-semibold uppercase tracking-wide">Stock price</label>
                  <input
                    className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white font-mono"
                    inputMode="decimal"
                    placeholder="e.g. 185.00"
                    value={portfolioStockPrice}
                    onChange={e => setPortfolioStockPrice(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-semibold uppercase tracking-wide">Strike price</label>
                  <input
                    className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white font-mono"
                    inputMode="decimal"
                    placeholder="e.g. 185.00"
                    value={portfolioStrike}
                    onChange={e => setPortfolioStrike(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 font-semibold uppercase tracking-wide">Premium paid (per share)</label>
                {/* Estimated premium targets from delta conversion */}
                {(() => {
                  const pt = (result?.entry_guidance as Record<string, unknown> | null | undefined)?.premium_targets as Record<string, unknown> | undefined
                  if (!pt) return null
                  const _n = (k: string) => typeof pt[k] === 'number' ? pt[k] as number : null
                  const items = [
                    { label: 'Stop', val: _n('stop_premium'), cls: 'text-rose-400 border-rose-800/60 bg-rose-950/30' },
                    { label: 'T1',   val: _n('t1_premium'),   cls: 'text-emerald-400 border-emerald-800/60 bg-emerald-950/30' },
                    { label: 'T2',   val: _n('t2_premium'),   cls: 'text-emerald-300 border-emerald-700/60 bg-emerald-950/20' },
                  ].filter(i => i.val != null)
                  if (items.length === 0) return null
                  return (
                    <div className="mt-1 mb-2 flex flex-wrap gap-1.5">
                      {_n('atm_premium') != null && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full border border-violet-700/60 bg-violet-950/30 text-violet-300 font-mono">
                          ATM ${(_n('atm_premium') as number).toFixed(2)}
                        </span>
                      )}
                      {items.map(i => (
                        <button
                          key={i.label}
                          type="button"
                          onClick={() => setPortfolioEntryPrice(String(i.val))}
                          className={`text-[10px] px-2 py-0.5 rounded-full border font-mono font-semibold cursor-pointer hover:opacity-80 ${i.cls}`}
                          title={`Use ${i.label} premium`}
                        >
                          {i.label} ${(i.val as number).toFixed(2)}
                        </button>
                      ))}
                      {pt.source === 'atm_approx' && (
                        <span className="text-[10px] text-gray-600">δ≈0.5 est.</span>
                      )}
                      {_n('delta_used') != null && pt.source === 'chain' && (
                        <span className="text-[10px] text-gray-600">δ={_n('delta_used')}</span>
                      )}
                    </div>
                  )
                })()}
                <input
                  className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white font-mono"
                  inputMode="decimal"
                  placeholder="e.g. 2.45"
                  value={portfolioEntryPrice}
                  onChange={e => setPortfolioEntryPrice(e.target.value)}
                />
                <p className="mt-1 text-[10px] text-gray-600">Cost per share · 1 contract = 100 shares · click a pill to use estimated value</p>
              </div>
              <div>
                <label className="text-xs text-gray-500 font-semibold uppercase tracking-wide">Expiry (optional, YYYY-MM-DD)</label>
                <input
                  className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white font-mono"
                  placeholder="2026-05-16"
                  value={portfolioExpiry}
                  onChange={e => setPortfolioExpiry(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 font-semibold uppercase tracking-wide">Notes (optional)</label>
                <textarea
                  className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm min-h-[60px]"
                  placeholder="Plan / context"
                  value={portfolioNotes}
                  onChange={e => setPortfolioNotes(e.target.value)}
                />
              </div>
              {portfolioErr && (
                <div className="text-rose-300 text-xs">{portfolioErr}</div>
              )}
              <button
                type="button"
                onClick={submitPortfolio}
                disabled={portfolioSubmitting}
                className="w-full rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold py-2.5"
              >
                Save to Positions Center
              </button>
            </div>
          </div>
        </div>
      )}

      {enterOpen && result && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal>
          <div className="w-full max-w-md rounded-2xl border border-gray-700 bg-gray-900 shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
              <div className="text-base font-bold text-white">Day Trade Active</div>
              <button
                type="button"
                onClick={() => setEnterOpen(false)}
                className="text-gray-500 hover:text-gray-300 p-1"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-4 space-y-3 text-sm">
              {/* Day / Swing toggle — most important decision */}
              <div>
                <label className="text-xs text-gray-500 font-semibold uppercase tracking-wide">Trade type</label>
                <div className="flex gap-2 mt-1">
                  {(['day', 'swing'] as const).map(mode => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setTradeMode(mode)}
                      className={`flex-1 rounded-xl py-2.5 font-bold text-sm border transition-colors ${
                        tradeMode === mode
                          ? mode === 'day'
                            ? 'bg-orange-600 border-orange-500 text-white'
                            : 'bg-sky-600 border-sky-500 text-white'
                          : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
                      }`}
                    >
                      {mode === 'day' ? '⚡ Day Trade' : '📈 Swing Trade'}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-gray-500 leading-relaxed">
                  {tradeMode === 'day'
                    ? 'Intraday only — guidance uses VWAP, OR, and volume. Close by 3:45 PM ET regardless of P&L.'
                    : 'Multi-day hold — guidance uses DTE and swing thesis. Ignore intraday noise.'}
                </p>
                {/* DTE conflict warning */}
                {tradeMode === 'day' && expiryInput.trim() && (() => {
                  const d = new Date(expiryInput.trim() + 'T00:00:00')
                  const dte = Math.ceil((d.getTime() - Date.now()) / 86400000)
                  return Number.isFinite(dte) && dte > 3
                    ? (
                      <div className="mt-1.5 rounded-lg border border-amber-700/50 bg-amber-950/30 px-2.5 py-2 text-[11px] text-amber-300">
                        ⚠️ This expiry has <strong>{dte} DTE</strong> — that's a multi-day position. Consider switching to <strong>Swing Trade</strong> so the tool holds through intraday dips and uses DTE-aware exit rules.
                      </div>
                    )
                    : null
                })()}
              </div>
              <div>
                <label className="text-xs text-gray-500 font-semibold uppercase tracking-wide">Side</label>
                <div className="flex gap-2 mt-1">
                  {(['CALL', 'PUT'] as const).map(s => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSide(s)}
                      className={`flex-1 rounded-xl py-2 font-semibold border transition-colors ${
                        side === s
                          ? 'bg-violet-600 border-violet-500 text-white'
                          : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 font-semibold uppercase tracking-wide">Option entry (premium)</label>
                <input
                  className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white font-mono"
                  inputMode="decimal"
                  placeholder="e.g. 2.45"
                  value={entryPrice}
                  onChange={e => setEntryPrice(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 font-semibold uppercase tracking-wide">Contracts (optional)</label>
                <input
                  className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white font-mono"
                  inputMode="decimal"
                  placeholder="1"
                  value={contracts}
                  onChange={e => setContracts(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 font-semibold uppercase tracking-wide">Strike (optional)</label>
                <input
                  className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white font-mono"
                  inputMode="decimal"
                  placeholder="e.g. 575"
                  value={strikeInput}
                  onChange={e => setStrikeInput(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 font-semibold uppercase tracking-wide">
                  Expiry (optional, YYYY-MM-DD)
                </label>
                <input
                  className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white font-mono"
                  placeholder="2026-06-20"
                  value={expiryInput}
                  onChange={e => setExpiryInput(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 font-semibold uppercase tracking-wide">Notes (optional)</label>
                <textarea
                  className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm min-h-[72px]"
                  placeholder="Plan / context"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                />
              </div>
              {enterErr && (
                <div className="text-rose-300 text-xs">{enterErr}</div>
              )}
              <button
                type="button"
                onClick={() => void submitEnter()}
                disabled={enterSubmitting}
                className="w-full rounded-xl bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white font-semibold py-2.5"
              >
                {enterSubmitting ? <Loader2 className="inline animate-spin" size={16} /> : null} Save &amp; open Day Trade Active
              </button>
            </div>
          </div>
        </div>
      )}

      {alertOpen && result && (
        <SetAlertDrawer
          ticker={result.ticker}
          tradeType="day"
          onClose={() => setAlertOpen(false)}
          onSubmit={handleCreateAlert}
        />
      )}
      </div>{/* end right content */}
    </div>{/* end flex container */}
  </div>
  )
}
