import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { Bell, BookOpen, BriefcaseBusiness, ChevronLeft, ChevronRight, Loader2, Menu, RefreshCw, Search, X, Activity, TrendingUp } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { fetchOptionChainLiquidity, saveToJournal } from '../api/client'
import type { DayTradeWorkspaceAction, DayTradeWorkspaceDisplayValue, DayTradeWorkspaceResponse, OptionChainRow } from '../api/client'
import { addMyTicker, fetchMyTickers, searchTickers, updateMyTicker, type MyTickerEntry, type SearchTickerResult } from '../api/commandCenter'
import DayTradeWorkspaceShell from '../components/DayTradeWorkspaceShell'
import { useApp } from '../contexts/AppContext'
import { useDayTradeWorkspace } from '../hooks/useDayTradeWorkspace'
import { formatTickerTitle, useDocumentTitle } from '../hooks/useDocumentTitle'
import { ROUTES, getEngineRoute } from '../routing/routes'

type SidebarTickerGroupKey = 'day' | 'regular' | 'swing'
type TickerListTab = SidebarTickerGroupKey | 'all'

const SIDEBAR_TICKER_GROUPS: Array<{ key: SidebarTickerGroupKey; title: string; empty: string }> = [
  { key: 'day', title: 'Day Trade Tickers', empty: 'No Day Trade tickers saved. Add tickers from My Ticker List.' },
  { key: 'regular', title: 'Position Trading Tickers', empty: 'No Position Trading tickers saved. Add tickers from My Ticker List.' },
  { key: 'swing', title: 'Swing Trading Tickers', empty: 'No Swing Trading tickers saved. Add tickers from My Ticker List.' },
]

const FILTER_TABS: Array<{ key: TickerListTab; label: string }> = [
  { key: 'day', label: 'Day Trade' },
  { key: 'regular', label: 'Position' },
  { key: 'swing', label: 'Swing' },
  { key: 'all', label: 'All' },
]

const ALPACA_TRADE_DRAFT_KEY = 'oa_alpaca_trade_draft'

const TRADE_TYPE_LABELS: Record<SidebarTickerGroupKey, string> = {
  day: 'Day Trade',
  regular: 'Position',
  swing: 'Swing',
}

const TRADE_TYPE_VALUES: Record<SidebarTickerGroupKey, string> = {
  day: 'day',
  regular: 'regular',
  swing: 'swing',
}

const DAY_TICKER_AUTO_REFRESH_MIN_MS = 5 * 60 * 1000
const DAY_TICKER_AUTO_REFRESH_MAX_MS = 15 * 60 * 1000
const DAY_TRADE_PAGE_AUTO_REFRESH_MS = 5 * 60 * 1000

function nextDayTickerRefreshDelay(): number {
  return DAY_TICKER_AUTO_REFRESH_MIN_MS + Math.round(Math.random() * (DAY_TICKER_AUTO_REFRESH_MAX_MS - DAY_TICKER_AUTO_REFRESH_MIN_MS))
}

function formatRefreshTimestamp(value: Date | null): string {
  if (!value) return 'not refreshed yet'
  return value.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function normalizeTickerGroup(value: string): SidebarTickerGroupKey | null {
  const v = String(value || '').trim().toUpperCase()
  if (v === 'DAY' || v === 'DAY_TRADE' || v === 'DAYTRADE') return 'day'
  if (v === 'REGULAR' || v === 'POSITION' || v === 'POSITION_TRADE' || v === 'POSITIONTRADING') return 'regular'
  if (v === 'SWING' || v === 'SWING_TRADE' || v === 'SWINGTRADE') return 'swing'
  return null
}

function tickerGroupsFor(item: MyTickerEntry): Set<SidebarTickerGroupKey> {
  return new Set((item.trade_types || []).map(normalizeTickerGroup).filter(Boolean) as SidebarTickerGroupKey[])
}

function isDayTradeTicker(item: MyTickerEntry): boolean {
  return tickerGroupsFor(item).has('day')
}

function sortSidebarTickers(items: MyTickerEntry[]): MyTickerEntry[] {
  return [...items].sort((a, b) => {
    const activeA = a.is_active ?? true
    const activeB = b.is_active ?? true
    if (activeA !== activeB) return activeA ? -1 : 1
    return a.symbol.localeCompare(b.symbol)
  })
}

function membershipsFor(item: MyTickerEntry): SidebarTickerGroupKey[] {
  return [...tickerGroupsFor(item)]
}

function handlePlainAnchorClick(event: MouseEvent<HTMLAnchorElement>, action: () => void) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  action()
}

function DayTradeSidebarContent({
  tickerInput,
  setTickerInput,
  sidebarSearch,
  setSidebarSearch,
  sidebarTab,
  setSidebarTab,
  filteredTickers,
  symbol,
  tickersLoading,
  tickersError,
  refreshMyTickers,
  tickerListLastRefreshedAt,
  workspaceLoading,
  listRef,
  handleListScroll,
  loadTicker,
  setAddDialogOpen,
  navigate,
  onCollapse,
  onClose,
  closeable = false,
}: {
  tickerInput: string
  setTickerInput: (value: string) => void
  sidebarSearch: string
  setSidebarSearch: (value: string) => void
  sidebarTab: TickerListTab
  setSidebarTab: (value: TickerListTab) => void
  filteredTickers: Array<{ item: MyTickerEntry; groups: Set<SidebarTickerGroupKey> }>
  symbol: string
  tickersLoading: boolean
  tickersError: string
  refreshMyTickers: () => void
  tickerListLastRefreshedAt: Date | null
  workspaceLoading: boolean
  listRef: React.RefObject<HTMLDivElement>
  handleListScroll: (scrollTop: number) => void
  loadTicker: (symbol?: string) => void
  setAddDialogOpen: (open: boolean) => void
  navigate: (path: string) => void
  onCollapse?: () => void
  onClose?: () => void
  closeable?: boolean
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-start justify-between shrink-0">
        <div>
          {!closeable && <div className="text-[11px] font-black uppercase tracking-widest text-tertiary">Day Workstation</div>}
          <div className={`flex items-center gap-2 ${closeable ? '' : 'mt-1'}`}>
            <Activity size={16} className="text-violet-500" />
            <span className="text-lg font-black text-heading">Day Trade</span>
          </div>
          {!closeable && (
            <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-tertiary">
              Tickers refreshed {formatRefreshTimestamp(tickerListLastRefreshedAt)}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {onCollapse && (
            <button type="button" onClick={onCollapse} className="rounded-lg p-1 text-secondary hover:bg-slate-100 dark:hover:bg-slate-900" aria-label="Collapse ticker rail">
              <ChevronLeft size={16} />
            </button>
          )}
          {closeable && onClose && (
            <button type="button" onClick={onClose} className="rounded-lg p-1 text-secondary hover:bg-slate-100 dark:hover:bg-slate-900" aria-label="Close sidebar">
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      <section className="mb-3 shrink-0 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/[0.07] dark:bg-slate-900/60">
        <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-tertiary">Search My Tickers</div>
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-2 dark:border-white/[0.08] dark:bg-slate-950">
          <Search size={14} className="text-tertiary" />
          <input
            value={sidebarSearch}
            onChange={event => setSidebarSearch(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-heading outline-none placeholder:text-tertiary"
            placeholder="Symbol or company"
            autoComplete="off"
            spellCheck={false}
            aria-label="Search My Tickers"
          />
          {sidebarSearch && (
            <button
              type="button"
              onClick={() => setSidebarSearch('')}
              className="rounded-md p-1 text-tertiary hover:bg-slate-100 hover:text-heading dark:hover:bg-slate-900"
              aria-label="Clear ticker search"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </section>

      {/* The mobile overlay already has an Analyze bar (DayTradeMobileSearchBar)
          above the drawer, so hide this duplicate there and let the ticker list
          lead. */}
      {!closeable && (
      <section className="mb-3 shrink-0 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/[0.07] dark:bg-slate-900/60">
        <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-tertiary">Analyze</div>
        <div className="flex gap-2">
          <input
            value={tickerInput}
            onChange={event => setTickerInput(event.target.value.toUpperCase())}
            onKeyDown={event => { if (event.key === 'Enter') loadTicker() }}
            className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm font-black uppercase text-heading outline-none focus:border-violet-500 dark:border-white/[0.08] dark:bg-slate-950"
            placeholder="AAPL"
            autoComplete="off"
            spellCheck={false}
            aria-label="Analyze ticker"
          />
          <button
            type="button"
            disabled={workspaceLoading}
            onClick={() => loadTicker()}
            className="rounded-lg bg-violet-600 px-3 py-2 text-white hover:bg-violet-500 disabled:opacity-60"
            aria-label="Analyze ticker"
          >
            {workspaceLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search size={16} />}
          </button>
        </div>
      </section>
      )}

      <section className="flex min-h-0 flex-1 flex-col">
        <div className="mb-2 flex items-center justify-between shrink-0">
          <div className="text-[10px] font-black uppercase tracking-widest text-tertiary">My Tickers</div>
          <div className="flex items-center gap-2">
            <button type="button" className="text-[10px] font-bold text-violet-600 dark:text-violet-300" onClick={() => setAddDialogOpen(true)}>
              Add Ticker
            </button>
            <a
              href={ROUTES.myTickers}
              className="text-[10px] font-bold text-violet-600 dark:text-violet-300"
              onClick={event => handlePlainAnchorClick(event, () => navigate(ROUTES.myTickers))}
            >
              Manage
            </a>
          </div>
        </div>
        <div className="mb-2 grid grid-cols-2 gap-1.5 shrink-0">
          {FILTER_TABS.map(filter => (
            <button
              key={filter.key}
              type="button"
              onClick={() => setSidebarTab(filter.key)}
              className={`rounded-lg border px-2 py-1.5 text-[10px] font-black uppercase tracking-wide transition ${
                sidebarTab === filter.key
                  ? 'border-violet-500 bg-violet-500/10 text-violet-700 dark:text-violet-200'
                  : 'border-slate-200 bg-white text-secondary hover:border-violet-300 dark:border-white/[0.08] dark:bg-slate-950'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
        {tickersLoading ? (
          <div className="flex min-h-0 flex-1 items-center justify-center text-xs text-secondary">Loading tickers...</div>
        ) : tickersError ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-200">
            <div>{tickersError}</div>
            <button type="button" onClick={() => void refreshMyTickers()} className="mt-1 text-xs font-bold underline">Retry</button>
          </div>
        ) : (
          <div
            ref={listRef}
            className="min-h-0 flex-1 space-y-2 overflow-auto"
            onScroll={event => handleListScroll(event.currentTarget.scrollTop)}
          >
            {filteredTickers.length ? filteredTickers.map(({ item, groups: itemGroups }) => {
              const sym = item.symbol.toUpperCase()
              const selected = sym === symbol
              const moveUp = (item.price_change_pct ?? 0) >= 0
              return (
                <a
                  key={sym}
                  href={getEngineRoute('day', sym)}
                  onClick={event => handlePlainAnchorClick(event, () => loadTicker(sym))}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition ${
                    selected
                      ? 'border-violet-500 bg-violet-500/10'
                      : moveUp
                        ? 'border-emerald-300 bg-white hover:border-emerald-400 dark:border-emerald-400/15 dark:bg-slate-950'
                        : 'border-rose-300 bg-white hover:border-rose-400 dark:border-rose-400/15 dark:bg-slate-950'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block font-mono text-sm font-black text-heading">{sym}</span>
                    <span className="block truncate text-xs text-tertiary">{item.company_name}</span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {Array.from(itemGroups).map(groupKey => (
                        <span key={groupKey} className="rounded-full border border-slate-300 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-tertiary dark:border-white/[0.08]">
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
                </a>
              )
            }) : (
              <div className="rounded-lg border border-slate-200 px-3 py-3 text-sm text-tertiary dark:border-white/[0.08]">
                No tickers match this filter.
              </div>
            )}
          </div>
        )}
      </section>

      <section className="mt-3 shrink-0">
        <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-tertiary">Quick Tickers</div>
        <div className="flex flex-wrap gap-1.5">
          {['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMD', 'META'].map(sym => (
            <a
              key={sym}
              href={getEngineRoute('day', sym)}
              onClick={event => handlePlainAnchorClick(event, () => loadTicker(sym))}
              className="rounded-full border border-slate-200 px-2 py-1 font-mono text-[11px] font-black text-secondary hover:border-violet-400 dark:border-white/[0.08]"
            >
              {sym}
            </a>
          ))}
        </div>
      </section>

    </div>
  )
}

function DayTradeCollapsedSidebar({
  symbol,
  filteredTickers,
  loadTicker,
  onExpand,
}: {
  symbol: string
  filteredTickers: Array<{ item: MyTickerEntry; groups: Set<SidebarTickerGroupKey> }>
  loadTicker: (symbol?: string) => void
  onExpand: () => void
}) {
  const compactTickers = filteredTickers.slice(0, 8)
  return (
    <div className="flex h-full flex-col items-center gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-sm dark:border-white/[0.08] dark:bg-slate-950">
      <button
        type="button"
        onClick={onExpand}
        className="rounded-lg border border-violet-500/30 bg-violet-500/10 p-2 text-violet-700 hover:bg-violet-500/15 dark:text-violet-200"
        aria-label="Expand ticker rail"
        title="Expand ticker rail"
      >
        <ChevronRight size={18} />
      </button>
      <div className="h-px w-full bg-slate-200 dark:bg-white/[0.08]" />
      {compactTickers.map(({ item }) => {
        const sym = item.symbol.toUpperCase()
        const selected = sym === symbol
        return (
          <a
            key={sym}
            href={getEngineRoute('day', sym)}
            onClick={event => handlePlainAnchorClick(event, () => loadTicker(sym))}
            className={`flex h-10 w-10 items-center justify-center rounded-lg border font-mono text-[10px] font-black ${
              selected
                ? 'border-violet-500 bg-violet-500/10 text-violet-700 dark:text-violet-200'
                : 'border-slate-200 text-secondary hover:border-violet-300 dark:border-white/[0.08]'
            }`}
            title={`${sym} ${item.company_name || ''}`.trim()}
          >
            {sym.slice(0, 4)}
          </a>
        )
      })}
      <div className="mt-auto text-center text-[9px] font-black uppercase tracking-wider text-tertiary [writing-mode:vertical-rl]">
        Tickers
      </div>
    </div>
  )
}

const DAY_TRADE_ACTION_LINKS = [
  { label: 'Ticker Scanner', route: ROUTES.signals, icon: Activity },
  { label: 'Alerts', route: ROUTES.alerts, icon: Bell },
  { label: 'Positions', route: ROUTES.positions, icon: BriefcaseBusiness },
  { label: 'Journal', route: ROUTES.journal, icon: BookOpen },
]

function DayTradeActionLinks({ navigate, compact = false }: { navigate: (path: string) => void; compact?: boolean }) {
  return (
    <div className={`flex ${compact ? 'overflow-x-auto pb-1' : 'flex-nowrap justify-end'} gap-1.5`}>
      {DAY_TRADE_ACTION_LINKS.map(action => {
        const Icon = action.icon
        return (
          <a
            key={action.route}
            href={action.route}
            onClick={event => handlePlainAnchorClick(event, () => navigate(action.route))}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1.5 text-[11px] font-black text-secondary hover:border-violet-400 hover:text-heading dark:border-white/[0.08]"
          >
            <Icon size={14} />
            {action.label}
          </a>
        )
      })}
    </div>
  )
}

function DayTradeMobileSearchBar({
  tickerInput,
  setTickerInput,
  symbol,
  workspaceLoading,
  loadTicker,
  onRefresh,
  lastRefreshedAt,
  onOpenTickers,
  navigate,
}: {
  tickerInput: string
  setTickerInput: (value: string) => void
  symbol: string
  workspaceLoading: boolean
  loadTicker: (symbol?: string) => void
  onRefresh: () => void
  lastRefreshedAt: Date | null
  onOpenTickers: () => void
  navigate: (path: string) => void
}) {
  return (
    <section className="mb-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-white/[0.08] dark:bg-slate-950 xl:hidden">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenTickers}
            className="inline-flex rounded-lg border border-violet-500/30 bg-violet-500/10 p-2 text-violet-700 dark:text-violet-200"
            aria-label="Open navigation"
            title="Open navigation"
          >
            <Menu size={17} />
          </button>
          <div>
          <div className="text-[10px] font-black uppercase tracking-widest text-tertiary">Day Trade</div>
          <div className="text-sm font-black text-heading">Analyze Ticker</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={getEngineRoute('swing', symbol || tickerInput)}
            onClick={event => handlePlainAnchorClick(event, () => navigate(getEngineRoute('swing', symbol || tickerInput)))}
            className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-black text-emerald-700 dark:text-emerald-200"
          >
            <TrendingUp size={14} />
            Swing
          </a>
        </div>
      </div>
      <div className="flex gap-2">
        <input
          value={tickerInput}
          onChange={event => setTickerInput(event.target.value.toUpperCase())}
          onKeyDown={event => { if (event.key === 'Enter') loadTicker() }}
          className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-base font-black uppercase text-heading outline-none focus:border-violet-500 dark:border-white/[0.08] dark:bg-slate-900"
          placeholder="AAPL"
          autoComplete="off"
          spellCheck={false}
          aria-label="Analyze ticker"
        />
        <button
          type="button"
          disabled={workspaceLoading}
          onClick={() => loadTicker()}
          className="rounded-lg bg-violet-600 px-4 py-2 text-white hover:bg-violet-500 disabled:opacity-60"
          aria-label="Analyze ticker"
        >
          {workspaceLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search size={16} />}
        </button>
        <button
          type="button"
          disabled={workspaceLoading}
          onClick={onRefresh}
          className="rounded-lg border border-slate-200 px-3 py-2 text-secondary hover:border-violet-400 disabled:opacity-60 dark:border-white/[0.08]"
          aria-label="Refresh Day Trade workspace"
          title="Refresh"
        >
          <RefreshCw size={16} className={workspaceLoading ? 'animate-spin' : ''} />
        </button>
      </div>
      <div className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-tertiary">
        Workspace refreshed {formatRefreshTimestamp(lastRefreshedAt)}
      </div>
      <div className="mt-3 hidden sm:block">
        <DayTradeActionLinks navigate={navigate} compact />
      </div>
    </section>
  )
}

function DayTradeWorkspaceToolbar({
  symbol,
  loading,
  onRefresh,
  lastRefreshedAt,
  navigate,
}: {
  symbol: string
  loading: boolean
  onRefresh: () => void
  lastRefreshedAt: Date | null
  navigate: (path: string) => void
}) {
  return (
    <div className="mb-1 hidden min-h-10 items-center justify-between gap-2 border border-slate-200 bg-white px-2 py-1 shadow-sm dark:border-white/[0.08] dark:bg-slate-950 md:flex xl:border-x-0 xl:border-t-0">
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-[10px] font-black uppercase tracking-widest text-tertiary">Day Trade</span>
        <span className="font-mono text-base font-black text-heading">{symbol}</span>
        <span className="hidden text-[10px] font-semibold uppercase tracking-wide text-tertiary lg:inline">
          Refreshed {formatRefreshTimestamp(lastRefreshedAt)}
        </span>
      </div>
      <div className="flex flex-nowrap items-center justify-end gap-1.5 overflow-x-auto">
        <a
          href={getEngineRoute('swing', symbol)}
          onClick={event => handlePlainAnchorClick(event, () => navigate(getEngineRoute('swing', symbol)))}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-[11px] font-black text-emerald-700 hover:border-emerald-400 dark:text-emerald-200"
        >
          <TrendingUp size={14} />
          Swing Trade
        </a>
        <DayTradeActionLinks navigate={navigate} />
        <button
          type="button"
          disabled={loading}
          onClick={onRefresh}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1.5 text-[11px] font-black text-secondary hover:border-violet-400 disabled:opacity-60 dark:border-white/[0.08]"
          aria-label="Refresh Day Trade workspace"
          title="Refresh Day Trade workspace"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>
    </div>
  )
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

function workspaceRawNumber(value: DayTradeWorkspaceDisplayValue | undefined): number | null {
  if (!value) return null
  if (typeof value.raw === 'number' && Number.isFinite(value.raw)) return value.raw
  if (typeof value.raw === 'string') {
    const parsed = Number(value.raw.replace(/[^0-9.-]/g, ''))
    if (Number.isFinite(parsed)) return parsed
  }
  const parsed = Number(value.display.replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function workspaceDateValue(value: DayTradeWorkspaceDisplayValue | undefined, fallbackDays = 7): string {
  const raw = String(value?.raw ?? value?.display ?? '').trim()
  const match = raw.match(/\d{4}-\d{2}-\d{2}/)
  if (match) return match[0]
  const date = new Date()
  date.setDate(date.getDate() + fallbackDays)
  return date.toISOString().slice(0, 10)
}

function workspaceBias(workspace: DayTradeWorkspaceResponse): string {
  const text = `${workspace.chart.marketStructure?.trend || ''} ${workspace.chart.marketStructure?.display || ''}`.toLowerCase()
  if (text.includes('bear')) return 'Bearish'
  if (text.includes('bull')) return 'Bullish'
  return workspace.symbol.change.tone === 'danger' ? 'Bearish' : workspace.symbol.change.tone === 'positive' ? 'Bullish' : 'Neutral'
}

function workspaceOptionType(workspace: DayTradeWorkspaceResponse): 'CALL' | 'PUT' {
  const selected = String(workspace.selectedContract?.optionType.display || workspace.selectedContract?.optionType.raw || '').toUpperCase()
  if (selected.includes('PUT')) return 'PUT'
  if (selected.includes('CALL')) return 'CALL'
  return workspaceBias(workspace) === 'Bearish' ? 'PUT' : 'CALL'
}

function workspaceStrategy(workspace: DayTradeWorkspaceResponse): string {
  return workspaceOptionType(workspace) === 'PUT' ? 'Long Put' : 'Long Call'
}

function optionRowMid(row: OptionChainRow): number {
  const mid = Number(row.mid) || 0
  if (mid > 0) return mid
  const bid = Number(row.bid) || 0
  const ask = Number(row.ask) || 0
  return bid > 0 && ask > 0 ? (bid + ask) / 2 : Math.max(bid, ask, 0)
}

function closestOptionRow(rows: OptionChainRow[], strike: number): OptionChainRow | null {
  return rows.reduce<OptionChainRow | null>((best, row) => {
    if (!best) return row
    const bestDistance = Math.abs(Number(best.strike) - strike)
    const rowDistance = Math.abs(Number(row.strike) - strike)
    if (rowDistance < bestDistance) return row
    if (rowDistance === bestDistance && optionRowMid(row) > optionRowMid(best)) return row
    return best
  }, null)
}

async function resolveDayTradeOptionQuote(input: {
  ticker: string
  optionType: 'CALL' | 'PUT'
  strike: number
  expiry: string
}): Promise<{ row: OptionChainRow; expiry: string } | null> {
  const load = async (forceRefresh: boolean) => {
    const chain = await fetchOptionChainLiquidity(input.ticker, input.expiry, forceRefresh)
    const rows = input.optionType === 'PUT' ? chain.puts : chain.calls
    const row = closestOptionRow(rows, input.strike)
    return row ? { row, expiry: chain.selected_expiry || input.expiry } : null
  }

  const cached = await load(false)
  if (cached && optionRowMid(cached.row) > 0) return cached
  const refreshed = await load(true)
  if (refreshed && optionRowMid(refreshed.row) > 0) return refreshed
  return refreshed || cached
}

function workspaceRiskReward(workspace: DayTradeWorkspaceResponse): { entry: number; stop: number; target1: number; target2: number; risk: number; reward: number } {
  const entry = workspaceRawNumber(workspace.riskPlan.entry) ?? workspaceRawNumber(workspace.symbol.price) ?? 0
  const stop = workspaceRawNumber(workspace.riskPlan.stop) ?? entry
  const target1 = workspaceRawNumber(workspace.riskPlan.target1) ?? entry
  const target2 = workspaceRawNumber(workspace.riskPlan.target2) ?? target1
  return {
    entry,
    stop,
    target1,
    target2,
    risk: Math.abs(entry - stop),
    reward: Math.abs(target2 - entry),
  }
}

export default function DayTradeWorkspacePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const { portfolio, user, addManualPosition } = useApp()
  const [notice, setNotice] = useState('')
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem('day_trade_workspace_sidebar_collapsed')
      if (saved === '1') return true
      if (saved === '0') return false
      return typeof window !== 'undefined' ? window.innerWidth < 1280 : false
    } catch {
      return false
    }
  })

  const [tickerInput, setTickerInput] = useState((searchParams.get('symbol') || searchParams.get('ticker') || 'AAPL').trim().toUpperCase())
  const [myTickers, setMyTickers] = useState<MyTickerEntry[]>([])
  const [tickersLoading, setTickersLoading] = useState(false)
  const [tickersError, setTickersError] = useState('')
  const [tickerListLastRefreshedAt, setTickerListLastRefreshedAt] = useState<Date | null>(null)
  const [workspaceLastRefreshedAt, setWorkspaceLastRefreshedAt] = useState<Date | null>(null)
  const [sidebarTab, setSidebarTab] = useState<TickerListTab>('all')
  const [sidebarSearch, setSidebarSearch] = useState('')
  const [rightRailOpen, setRightRailOpen] = useState(() => {
    try {
      return localStorage.getItem('day_trade_workspace_right_rail_open') !== '0'
    } catch {
      return true
    }
  })
  const [rightRailWidth, setRightRailWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem('day_trade_workspace_right_rail_width'))
      return Number.isFinite(saved) && saved >= 280 ? saved : 340
    } catch {
      return 340
    }
  })
  const [sidebarScrollTop, setSidebarScrollTop] = useState(() => {
    try {
      const saved = Number(localStorage.getItem('day_trade_workspace_sidebar_scroll_top'))
      return Number.isFinite(saved) && saved > 0 ? saved : 0
    } catch {
      return 0
    }
  })
  const listRef = useRef<HTMLDivElement | null>(null)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [addQuery, setAddQuery] = useState('')
  const [addResults, setAddResults] = useState<SearchTickerResult[]>([])
  const [addSelected, setAddSelected] = useState<SearchTickerResult | null>(null)
  const [addTypes, setAddTypes] = useState<Record<SidebarTickerGroupKey, boolean>>({ day: true, regular: false, swing: false })
  const [addLoading, setAddLoading] = useState(false)
  const [addError, setAddError] = useState('')
  const autoRefreshInFlightRef = useRef(false)
  const didSelectDefaultTickerRef = useRef(false)

  useEffect(() => {
    try { localStorage.setItem('day_trade_workspace_sidebar_tab', sidebarTab) } catch { /* quota */ }
  }, [sidebarTab])

  useEffect(() => {
    try { localStorage.setItem('day_trade_workspace_sidebar_search', sidebarSearch) } catch { /* quota */ }
  }, [sidebarSearch])

  useEffect(() => {
    try { localStorage.setItem('day_trade_workspace_sidebar_scroll_top', String(sidebarScrollTop)) } catch { /* quota */ }
  }, [sidebarScrollTop])

  useEffect(() => {
    try { localStorage.setItem('day_trade_workspace_sidebar_collapsed', sidebarCollapsed ? '1' : '0') } catch { /* quota */ }
  }, [sidebarCollapsed])

  useEffect(() => {
    try { localStorage.setItem('day_trade_workspace_right_rail_open', rightRailOpen ? '1' : '0') } catch { /* quota */ }
  }, [rightRailOpen])

  useEffect(() => {
    try { localStorage.setItem('day_trade_workspace_right_rail_width', String(rightRailWidth)) } catch { /* quota */ }
  }, [rightRailWidth])

  const symbol = (searchParams.get('symbol') || searchParams.get('ticker') || tickerInput || 'AAPL').trim().toUpperCase()
  useDocumentTitle(formatTickerTitle(symbol, 'Day Trade'))
  const sessionDate = searchParams.get('sessionDate')
  const intervalParam = searchParams.get('interval')
  const interval = intervalParam === '5m' || intervalParam === '15m' || intervalParam === '1h' ? intervalParam : '1m'
  const [selectedInterval, setSelectedInterval] = useState<'1m' | '5m' | '15m' | '1h'>(interval)

  useEffect(() => {
    setSelectedInterval(interval)
  }, [interval])

  const workspaceState = useDayTradeWorkspace({
    symbol,
    sessionDate,
    interval,
  })

  useEffect(() => {
    if (workspaceState.data) setWorkspaceLastRefreshedAt(new Date())
  }, [workspaceState.data])

  useEffect(() => {
    setTickerInput(symbol)
  }, [symbol])

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setAddDialogOpen(false)
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [])

  useEffect(() => {
    if (listRef.current && sidebarScrollTop > 0) {
      listRef.current.scrollTop = sidebarScrollTop
    }
    // Only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refreshMyTickers = useCallback(async (opts: { dayOnly?: boolean; silent?: boolean } = {}) => {
    if (!opts.silent) setTickersLoading(true)
    setTickersError('')
    try {
      const res = await fetchMyTickers()
      const activeTickers = (res.data?.tickers ?? []).filter(item => item.symbol && (item.is_active ?? true))
      if (opts.dayOnly) {
        const refreshedDayTickers = activeTickers.filter(isDayTradeTicker)
        setMyTickers(prev => [
          ...prev.filter(item => !isDayTradeTicker(item)),
          ...refreshedDayTickers,
        ])
      } else {
        setMyTickers(activeTickers)
      }
      setTickerListLastRefreshedAt(new Date())
    } catch (err) {
      if (!opts.silent) setTickersError(err instanceof Error ? err.message : 'Unable to load My Tickers.')
    } finally {
      if (!opts.silent) setTickersLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshMyTickers()
  }, [refreshMyTickers])

  const refreshWorkspace = useCallback(async () => {
    await workspaceState.reload()
  }, [workspaceState.reload])

  useEffect(() => {
    const runAutoRefresh = async () => {
      if (autoRefreshInFlightRef.current || document.hidden) return
      autoRefreshInFlightRef.current = true
      try {
        await Promise.all([
          workspaceState.reload({ forceRefresh: true }),
          refreshMyTickers({ dayOnly: true, silent: true }),
        ])
      } finally {
        autoRefreshInFlightRef.current = false
      }
    }
    const id = window.setInterval(() => {
      void runAutoRefresh()
    }, DAY_TRADE_PAGE_AUTO_REFRESH_MS)
    return () => window.clearInterval(id)
  }, [refreshMyTickers, workspaceState.reload])

  useEffect(() => {
    let active = true
    let timeoutId: number | null = null
    const schedule = () => {
      if (!active) return
      timeoutId = window.setTimeout(() => {
        void refreshMyTickers({ dayOnly: true, silent: true }).finally(schedule)
      }, nextDayTickerRefreshDelay())
    }
    schedule()
    return () => {
      active = false
      if (timeoutId != null) window.clearTimeout(timeoutId)
    }
  }, [refreshMyTickers])

  useEffect(() => {
    if (!addQuery.trim() || addQuery.trim().length < 1) {
      setAddResults([])
      return
    }
    let active = true
    const id = setTimeout(() => {
      searchTickers(addQuery.trim())
        .then(res => { if (active) setAddResults(res.data?.results ?? []) })
        .catch(() => { if (active) setAddResults([]) })
    }, 300)
    return () => {
      active = false
      clearTimeout(id)
    }
  }, [addQuery])

  const sidebarTickerGroups = useMemo(() => {
    const unique = new Map<string, MyTickerEntry>()
    for (const item of myTickers) {
      const sym = item.symbol?.trim().toUpperCase()
      if (!sym) continue
      if (!unique.has(sym)) unique.set(sym, { ...item, symbol: sym })
    }
    const items = [...unique.values()]
    return SIDEBAR_TICKER_GROUPS.map(group => ({
      ...group,
      items: sortSidebarTickers(items.filter(item => tickerGroupsFor(item).has(group.key))),
    }))
  }, [myTickers])

  const savedTickerBySymbol = useMemo(() => {
    const map = new Map<string, MyTickerEntry>()
    for (const item of myTickers) map.set(item.symbol.toUpperCase(), item)
    return map
  }, [myTickers])

  const filteredTickers = useMemo(() => {
    const rows = new Map<string, { item: MyTickerEntry; groups: Set<SidebarTickerGroupKey> }>()
    sidebarTickerGroups.forEach(group => {
      if (sidebarTab !== 'all' && group.key !== sidebarTab) return
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
    const query = sidebarSearch.trim().toUpperCase()
    return Array.from(rows.values()).filter(row => {
      if (!query) return true
      return row.item.symbol.toUpperCase().includes(query) || String(row.item.company_name || '').toUpperCase().includes(query)
    }).sort((a, b) => a.item.symbol.localeCompare(b.item.symbol))
  }, [sidebarTab, sidebarTickerGroups, sidebarSearch])

  const currentTickerItem = savedTickerBySymbol.get(symbol)
  const heldTickers = useMemo(() => new Set(portfolio.map(item => item.ticker.toUpperCase())), [portfolio])

  const loadTicker = useCallback((raw?: string) => {
    const nextSymbol = (raw || tickerInput || '').trim().toUpperCase()
    if (!nextSymbol || nextSymbol.length > 12) {
      setNotice('Enter a valid ticker symbol.')
      return
    }
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('symbol', nextSymbol)
      next.delete('ticker')
      return next
    }, { replace: true })
    setTickerInput(nextSymbol)
  }, [setSearchParams, tickerInput])

  useEffect(() => {
    const requestedTicker = (searchParams.get('symbol') || searchParams.get('ticker') || '').trim()
    if (requestedTicker || didSelectDefaultTickerRef.current || myTickers.length === 0) return
    const firstTicker = sortSidebarTickers(myTickers)[0]?.symbol
    if (!firstTicker) return
    didSelectDefaultTickerRef.current = true
    loadTicker(firstTicker)
  }, [loadTicker, myTickers, searchParams])

  const handleIntervalChange = useCallback((nextInterval: '1m' | '5m' | '15m' | '1h') => {
    setSelectedInterval(nextInterval)
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('interval', nextInterval)
      return next
    }, { replace: true })
  }, [setSearchParams])

  const handleWorkspaceAction = useCallback(async (action: DayTradeWorkspaceAction) => {
    const workspace = workspaceState.data
    if (!workspace) return
    if (!action.enabled) {
      setNotice(action.disabledReason || `${action.label} is currently unavailable.`)
      return
    }

    const rr = workspaceRiskReward(workspace)
    const strategy = workspaceStrategy(workspace)
    const bias = workspaceBias(workspace)
    const expiry = workspaceDateValue(workspace.selectedContract?.expiration)
    const dte = Math.max(1, Math.round(workspaceRawNumber(workspace.selectedContract?.dte) ?? 7))
    const contracts = Math.max(1, Math.round(workspaceRawNumber(workspace.riskPlan.positionSize) ?? 1))
    const optionType = workspaceOptionType(workspace)
    const strike = workspaceRawNumber(workspace.selectedContract?.strike) ?? rr.entry
    const premium = workspaceRawNumber(workspace.selectedContract?.midpoint) ?? 0
    const optionLeg = {
      action: 'BUY' as const,
      option_type: optionType,
      strike,
      expiry,
      mid_price: premium,
      delta: 0,
      bid: workspaceRawNumber(workspace.selectedContract?.bid) ?? 0,
      ask: workspaceRawNumber(workspace.selectedContract?.ask) ?? 0,
      iv: 0,
      oi: 0,
      volume: 0,
      bid_ask_spread_pct: workspaceRawNumber(workspace.selectedContract?.spreadPercent) ?? 0,
    }
    const notes = [
      workspace.decision.setupName ? `Setup ${workspace.decision.setupName}` : null,
      workspace.decision.headline,
      workspace.decision.reason,
      `Entry ${workspace.riskPlan.entry.display}`,
      `Stop ${workspace.riskPlan.stop.display}`,
      `T1 ${workspace.riskPlan.target1.display}`,
      `T2 ${workspace.riskPlan.target2.display}`,
      `R/R ${workspace.riskPlan.riskReward.display}`,
    ].filter(Boolean).join(' · ')

    if (action.type === 'journal') {
      if (!user?.email) {
        setNotice('Sign in before saving to Journal.')
        return
      }
      void saveToJournal(user.email, {
        ticker: workspace.symbol.ticker,
        company_name: workspace.symbol.companyName || workspace.symbol.ticker,
        strategy,
        trade_type: 'day',
        bias,
        legs: [{
          action: 'BUY',
          option_type: optionType,
          strike,
          expiry,
          mid_price: premium,
        }],
        expiry,
        entry_date: new Date().toISOString().slice(0, 10),
        dte_at_entry: dte,
        net_credit: premium > 0 ? -premium : 0,
        max_profit: rr.reward,
        max_loss: rr.risk,
        underlying_entry: rr.entry,
        prob_of_profit: 0,
        expected_value: 0,
        total_score: workspace.chart.marketStructure?.confidence ?? 0,
        engine_signal: workspace.decision.permission.label,
        notes,
      }).then(() => {
        setNotice(`${workspace.symbol.ticker} saved to Journal.`)
      }).catch(() => {
        setNotice('Unable to save this setup to Journal.')
      })
      return
    }

    if (action.type === 'position') {
      addManualPosition({
        ticker: workspace.symbol.ticker,
        companyName: workspace.symbol.companyName || workspace.symbol.ticker,
        strategy,
        bias,
        legs: [optionLeg],
        expiry,
        dte,
        net_credit: premium > 0 ? -premium : 0,
        spread_width: 0,
        max_profit: rr.reward,
        max_loss: rr.risk,
        prob_of_profit: 0,
        expected_value: 0,
        scores_total: workspace.chart.marketStructure?.confidence ?? 0,
        contracts,
        breakeven_lower: 0,
        breakeven_upper: 0,
        entryPrice: rr.entry,
        target1: rr.target1,
        target2: rr.target2,
        stopLoss: rr.stop,
        source: 'day',
        notes,
      })
      setNotice(`${workspace.symbol.ticker} added to Positions Center.`)
      return
    }

    if (action.type === 'alpaca') {
      // Always take the user to the Alpaca trading page. When a live option
      // quote resolves we enrich the leg with real pricing; otherwise we still
      // navigate with a best-effort draft (labeled as estimated) so the button
      // never dead-ends — the user reviews and confirms on the Alpaca page.
      let alpacaLeg = optionLeg
      let alpacaExpiry = expiry
      let pricingNote = ''
      const canQuote = !!strike && strike > 0 && /^\d{4}-\d{2}-\d{2}$/.test(expiry)
      if (canQuote) {
        try {
          setNotice(`Loading ${workspace.symbol.ticker} option quote for Alpaca...`)
          const quote = await resolveDayTradeOptionQuote({
            ticker: workspace.symbol.ticker,
            optionType,
            strike,
            expiry,
          })
          if (quote && optionRowMid(quote.row) > 0) {
            alpacaExpiry = quote.expiry
            alpacaLeg = {
              ...optionLeg,
              strike: Number(quote.row.strike),
              expiry: alpacaExpiry,
              mid_price: optionRowMid(quote.row),
              bid: Number(quote.row.bid) || 0,
              ask: Number(quote.row.ask) || 0,
              iv: Number(quote.row.iv) || 0,
              oi: Number(quote.row.open_interest) || 0,
              volume: Number(quote.row.volume) || 0,
              bid_ask_spread_pct: Number(quote.row.spread_pct) || 0,
            }
          } else {
            pricingNote = ' — estimated pricing (live option quote unavailable)'
          }
        } catch {
          pricingNote = ' — estimated pricing (option quote lookup failed)'
        }
      } else {
        pricingNote = ' — estimated pricing (no option contract selected)'
      }
      try {
        window.sessionStorage.setItem(ALPACA_TRADE_DRAFT_KEY, JSON.stringify({
          source: 'day',
          createdAt: new Date().toISOString(),
          ticker: workspace.symbol.ticker,
          companyName: workspace.symbol.companyName || workspace.symbol.ticker,
          strategy,
          bias,
          contracts,
          legs: [alpacaLeg],
          entryPrice: rr.entry,
          stopLoss: rr.stop,
          target1: rr.target1,
          target2: rr.target2,
          notes,
          optionExpiry: alpacaExpiry,
        }))
      } catch {
        setNotice('Unable to create Alpaca draft in this browser session.')
        return
      }
      setNotice(`Opening Alpaca for ${workspace.symbol.ticker}${pricingNote}...`)
      navigate(`${ROUTES.autoTrade}?ticker=${encodeURIComponent(workspace.symbol.ticker)}&source=day`)
      return
    }

    setNotice(`${action.label} is connected through the backend workspace contract.`)
  }, [addManualPosition, navigate, user?.email, workspaceState.data])

  const handleAddTicker = useCallback(async () => {
    const target = addSelected || (addQuery.trim() ? { symbol: addQuery.trim().toUpperCase(), company: '', sector: '' } : null)
    if (!target?.symbol) {
      setAddError('Select a ticker to add.')
      return
    }
    const tradeTypes = (Object.keys(addTypes) as SidebarTickerGroupKey[])
      .filter(key => addTypes[key])
      .map(key => TRADE_TYPE_VALUES[key])
    if (!tradeTypes.length) {
      setAddError('Choose at least one list.')
      return
    }
    setAddLoading(true)
    setAddError('')
    try {
      const existing = savedTickerBySymbol.get(target.symbol.toUpperCase())
      const mergedTypes = existing
        ? Array.from(new Set([...(existing.trade_types || []), ...tradeTypes]))
        : tradeTypes
      const res = existing
        ? await updateMyTicker(target.symbol, { trade_types: mergedTypes })
        : await addMyTicker({ symbol: target.symbol, company_name: target.company, trade_types: mergedTypes })
      setMyTickers((res.data?.tickers ?? []).filter(item => item.symbol && (item.is_active ?? true)))
      setAddDialogOpen(false)
      setAddQuery('')
      setAddSelected(null)
      setNotice(`${target.symbol.toUpperCase()} saved to My Tickers.`)
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Unable to add ticker.')
    } finally {
      setAddLoading(false)
    }
  }, [addQuery, addSelected, addTypes, savedTickerBySymbol])

  const handleListScroll = useCallback((scrollTop: number) => {
    setSidebarScrollTop(scrollTop)
  }, [])

  const workspaceLoading = workspaceState.loading && !workspaceState.data

  return (
    <div className="day-trade-page min-h-screen bg-surface-page p-2 pb-24 text-primary md:min-h-0 md:flex-1 md:overflow-hidden md:p-0">
      <div className="flex w-full gap-1 md:h-full md:overflow-hidden">
        <aside className={`hidden h-full shrink-0 overflow-y-auto overscroll-contain border-r border-slate-200 bg-white dark:border-white/[0.08] dark:bg-slate-950 xl:block ${sidebarCollapsed ? 'w-14' : 'w-72 2xl:w-80'}`}>
          {sidebarCollapsed ? (
            <DayTradeCollapsedSidebar
              symbol={symbol}
              filteredTickers={filteredTickers}
              loadTicker={loadTicker}
              onExpand={() => setSidebarCollapsed(false)}
            />
          ) : (
            <DayTradeSidebarContent
              tickerInput={tickerInput}
              setTickerInput={setTickerInput}
              sidebarSearch={sidebarSearch}
              setSidebarSearch={setSidebarSearch}
              sidebarTab={sidebarTab}
              setSidebarTab={setSidebarTab}
              filteredTickers={filteredTickers}
              symbol={symbol}
              tickersLoading={tickersLoading}
              tickersError={tickersError}
              refreshMyTickers={refreshMyTickers}
              tickerListLastRefreshedAt={tickerListLastRefreshedAt}
              workspaceLoading={workspaceLoading}
              listRef={listRef}
              handleListScroll={handleListScroll}
              loadTicker={loadTicker}
              setAddDialogOpen={setAddDialogOpen}
              navigate={navigate}
              onCollapse={() => setSidebarCollapsed(true)}
            />
          )}
        </aside>

        {mobileSidebarOpen && (
          <div className="fixed inset-0 z-40 xl:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setMobileSidebarOpen(false)} />
            <aside className="absolute left-0 top-0 h-full w-80 max-w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain rounded-r-xl border border-slate-200 bg-white p-3 shadow-xl dark:border-white/[0.08] dark:bg-slate-950">
              <DayTradeSidebarContent
                tickerInput={tickerInput}
                setTickerInput={setTickerInput}
                sidebarSearch={sidebarSearch}
                setSidebarSearch={setSidebarSearch}
                sidebarTab={sidebarTab}
                setSidebarTab={setSidebarTab}
                filteredTickers={filteredTickers}
                symbol={symbol}
                tickersLoading={tickersLoading}
                tickersError={tickersError}
                refreshMyTickers={refreshMyTickers}
                tickerListLastRefreshedAt={tickerListLastRefreshedAt}
                workspaceLoading={workspaceLoading}
                listRef={listRef}
                handleListScroll={handleListScroll}
                loadTicker={loadTicker}
                setAddDialogOpen={setAddDialogOpen}
                navigate={navigate}
                onClose={() => setMobileSidebarOpen(false)}
                closeable
              />
            </aside>
          </div>
        )}

        <main className="flex min-w-0 flex-1 flex-col md:h-full md:overflow-hidden">
          <DayTradeMobileSearchBar
            tickerInput={tickerInput}
            setTickerInput={setTickerInput}
            symbol={symbol}
            workspaceLoading={workspaceLoading}
            loadTicker={loadTicker}
            onRefresh={() => void refreshWorkspace()}
            lastRefreshedAt={workspaceLastRefreshedAt}
            onOpenTickers={() => setMobileSidebarOpen(true)}
            navigate={navigate}
          />

          {notice && (
            <div className="m-1 rounded-lg border border-semantic-info-border bg-semantic-info-bg px-3 py-2 text-xs text-semantic-info">
              {notice}
            </div>
          )}

          <DayTradeWorkspaceToolbar
            symbol={symbol}
            loading={workspaceState.loading}
            onRefresh={() => void refreshWorkspace()}
            lastRefreshedAt={workspaceLastRefreshedAt}
            navigate={navigate}
          />

          {currentTickerItem && (
            <div className="flex flex-wrap items-center gap-1.5 px-1 pb-2 text-[10px] font-bold uppercase tracking-wide text-tertiary xl:hidden">
              {membershipsFor(currentTickerItem).map(key => (
                <span key={key} className="rounded-full border border-slate-200 px-2 py-0.5 dark:border-white/[0.08]">{TRADE_TYPE_LABELS[key]}</span>
              ))}
              {heldTickers.has(symbol) && <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-amber-700 dark:text-amber-200">In Position</span>}
            </div>
          )}

          {workspaceState.loading && !workspaceState.data ? (
            <div className="flex min-h-0 flex-1 items-center justify-center rounded-2xl border border-slate-200 bg-white text-sm text-secondary dark:border-white/[0.08] dark:bg-slate-900">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading backend workspace...
            </div>
          ) : workspaceState.error ? (
            <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-700 dark:text-red-200">
              <div className="font-bold">Workspace unavailable</div>
              <p className="mt-1">{workspaceState.error}</p>
              <button type="button" onClick={() => void workspaceState.reload()} className="mt-4 rounded-lg border border-red-500/30 px-3 py-2 text-xs font-semibold hover:bg-red-500/10">
                Retry
              </button>
            </div>
          ) : workspaceState.data ? (
            <div className="min-h-0 flex-1 md:overflow-hidden">
              <DayTradeWorkspaceShell
                workspace={workspaceState.data}
                onAction={handleWorkspaceAction}
                onIntervalChange={handleIntervalChange}
                selectedInterval={selectedInterval}
                rightRailOpen={rightRailOpen}
                onToggleRightRail={() => setRightRailOpen(open => !open)}
                rightRailWidth={rightRailWidth}
                onRightRailWidthChange={setRightRailWidth}
              />
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-slate-200 bg-white p-6 text-sm text-secondary dark:border-white/[0.08] dark:bg-slate-900">
              Enter a ticker to load the backend Day Trade workspace.
            </div>
          )}
        </main>
      </div>

      {addDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Add ticker">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-white/[0.08] dark:bg-slate-950">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-[11px] font-black uppercase tracking-widest text-tertiary">My Tickers</div>
                <h2 className="text-lg font-black text-heading">Add Ticker</h2>
              </div>
              <button type="button" onClick={() => setAddDialogOpen(false)} className="rounded-lg p-1 text-secondary hover:bg-slate-100 dark:hover:bg-slate-900" aria-label="Close add ticker dialog">
                <X size={16} />
              </button>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-tertiary" />
              <input
                autoFocus
                value={addQuery}
                onChange={event => {
                  setAddQuery(event.target.value.toUpperCase())
                  setAddSelected(null)
                  setAddError('')
                }}
                onKeyDown={event => { if (event.key === 'Escape') setAddDialogOpen(false) }}
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-heading outline-none focus:border-violet-500 dark:border-white/[0.08] dark:bg-slate-900"
                placeholder="Search symbol or company"
                aria-label="Search symbol or company"
              />
            </div>
            <div className="mt-3 max-h-44 overflow-auto rounded-lg border border-slate-200 dark:border-white/[0.08]">
              {addResults.length ? addResults.slice(0, 8).map(result => {
                const existing = savedTickerBySymbol.get(result.symbol.toUpperCase())
                return (
                  <button
                    key={result.symbol}
                    type="button"
                    onClick={() => {
                      setAddSelected(result)
                      setAddQuery(result.symbol.toUpperCase())
                    }}
                    className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-900 ${addSelected?.symbol === result.symbol ? 'bg-violet-500/10' : ''}`}
                  >
                    <span>
                      <span className="font-mono text-sm font-black text-heading">{result.symbol}</span>
                      <span className="ml-2 text-xs text-secondary">{result.company}</span>
                    </span>
                    {existing && <span className="text-[10px] font-bold uppercase tracking-wide text-tertiary">Existing</span>}
                  </button>
                )
              }) : (
                <div className="px-3 py-3 text-sm text-tertiary">{addQuery.trim() ? 'No backend search results yet. You can still submit the typed symbol.' : 'Search for a symbol to add.'}</div>
              )}
            </div>
            <div className="mt-4">
              <div className="mb-2 text-[11px] font-black uppercase tracking-widest text-tertiary">Add to</div>
              {addSelected && savedTickerBySymbol.get(addSelected.symbol.toUpperCase()) && (
                <div className="mb-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-secondary dark:border-white/[0.08] dark:bg-slate-900">
                  Existing memberships:{' '}
                  <span className="font-bold text-heading">
                    {membershipsFor(savedTickerBySymbol.get(addSelected.symbol.toUpperCase())!).map(key => TRADE_TYPE_LABELS[key]).join(' · ') || 'None'}
                  </span>
                </div>
              )}
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(TRADE_TYPE_LABELS) as SidebarTickerGroupKey[]).map(key => (
                  <label key={key} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-secondary dark:border-white/[0.08]">
                    <input
                      type="checkbox"
                      checked={addTypes[key]}
                      onChange={event => setAddTypes(cur => ({ ...cur, [key]: event.target.checked }))}
                    />
                    {TRADE_TYPE_LABELS[key]}
                  </label>
                ))}
              </div>
            </div>
            {addError && <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-200">{addError}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setAddDialogOpen(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-secondary dark:border-white/[0.08]">
                Cancel
              </button>
              <button type="button" disabled={addLoading} onClick={() => void handleAddTicker()} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-black text-white hover:bg-violet-500 disabled:opacity-60">
                {addLoading ? 'Adding...' : 'Add Ticker'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
