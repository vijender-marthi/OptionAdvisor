import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2, Search, X, Activity } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { DayTradeWorkspaceAction } from '../api/client'
import { addMyTicker, fetchMyTickers, searchTickers, updateMyTicker, type MyTickerEntry, type SearchTickerResult } from '../api/commandCenter'
import DayTradeWorkspaceShell from '../components/DayTradeWorkspaceShell'
import { useApp } from '../contexts/AppContext'
import { useDayTradeWorkspace } from '../hooks/useDayTradeWorkspace'
import { ROUTES } from '../routing/routes'

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
  workspaceLoading,
  listRef,
  handleListScroll,
  loadTicker,
  setAddDialogOpen,
  navigate,
  onCollapse,
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
  workspaceLoading: boolean
  listRef: React.RefObject<HTMLDivElement>
  handleListScroll: (scrollTop: number) => void
  loadTicker: (symbol?: string) => void
  setAddDialogOpen: (open: boolean) => void
  navigate: (path: string) => void
  onCollapse: () => void
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-start justify-between shrink-0">
        <div>
          <div className="text-[11px] font-black uppercase tracking-widest text-tertiary">Day Workstation</div>
          <div className="mt-1 flex items-center gap-2">
            <Activity size={16} className="text-violet-500" />
            <span className="text-lg font-black text-heading">Day Trade</span>
          </div>
        </div>
        <button type="button" onClick={onCollapse} className="rounded-lg p-1 text-secondary hover:bg-slate-100 dark:hover:bg-slate-900" aria-label="Collapse sidebar">
          <ChevronLeft size={16} />
        </button>
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

      <section className="flex min-h-0 flex-1 flex-col">
        <div className="mb-2 flex items-center justify-between shrink-0">
          <div className="text-[10px] font-black uppercase tracking-widest text-tertiary">My Tickers</div>
          <div className="flex items-center gap-2">
            <button type="button" className="text-[10px] font-bold text-violet-600 dark:text-violet-300" onClick={() => setAddDialogOpen(true)}>
              Add Ticker
            </button>
            <button type="button" className="text-[10px] font-bold text-violet-600 dark:text-violet-300" onClick={() => navigate(ROUTES.myTickers)}>
              Manage
            </button>
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
              return (
                <button
                  key={sym}
                  type="button"
                  onClick={() => loadTicker(sym)}
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
        )}
      </section>

      <section className="mt-3 shrink-0">
        <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-tertiary">Quick Tickers</div>
        <div className="flex flex-wrap gap-1.5">
          {['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMD', 'META'].map(sym => (
            <button
              key={sym}
              type="button"
              onClick={() => loadTicker(sym)}
              className="rounded-full border border-slate-200 px-2 py-1 font-mono text-[11px] font-black text-secondary hover:border-violet-400 dark:border-white/[0.08]"
            >
              {sym}
            </button>
          ))}
        </div>
      </section>

      <section className="mt-3 grid shrink-0 gap-2">
        <button type="button" onClick={() => navigate(ROUTES.signals)} className="rounded-lg border border-slate-200 px-3 py-2 text-left text-xs font-bold text-secondary hover:border-violet-400 dark:border-white/[0.08]">
          Ticker Scanner
        </button>
        <button type="button" onClick={() => navigate(ROUTES.alerts)} className="rounded-lg border border-slate-200 px-3 py-2 text-left text-xs font-bold text-secondary hover:border-violet-400 dark:border-white/[0.08]">
          Alerts
        </button>
        <button type="button" onClick={() => navigate(ROUTES.positions)} className="rounded-lg border border-slate-200 px-3 py-2 text-left text-xs font-bold text-secondary hover:border-violet-400 dark:border-white/[0.08]">
          Positions Center
        </button>
        <button type="button" onClick={() => navigate(ROUTES.journal)} className="rounded-lg border border-slate-200 px-3 py-2 text-left text-xs font-bold text-secondary hover:border-violet-400 dark:border-white/[0.08]">
          Journal
        </button>
      </section>
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

export default function DayTradeWorkspacePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const { portfolio } = useApp()
  const [notice, setNotice] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('day_trade_workspace_sidebar_collapsed') === '1'
    } catch {
      return false
    }
  })
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  useEffect(() => {
    try { localStorage.setItem('day_trade_workspace_sidebar_collapsed', sidebarCollapsed ? '1' : '0') } catch { /* quota */ }
  }, [sidebarCollapsed])
  const [tickerInput, setTickerInput] = useState((searchParams.get('symbol') || searchParams.get('ticker') || 'AAPL').trim().toUpperCase())
  const [myTickers, setMyTickers] = useState<MyTickerEntry[]>([])
  const [tickersLoading, setTickersLoading] = useState(false)
  const [tickersError, setTickersError] = useState('')
  const [sidebarTab, setSidebarTab] = useState<TickerListTab>(() => {
    try {
      const saved = localStorage.getItem('day_trade_workspace_sidebar_tab') as TickerListTab | null
      return saved && FILTER_TABS.some(item => item.key === saved) ? saved : 'all'
    } catch {
      return 'all'
    }
  })
  const [sidebarSearch, setSidebarSearch] = useState(() => {
    try {
      return localStorage.getItem('day_trade_workspace_sidebar_search') || ''
    } catch {
      return ''
    }
  })
  const [sidebarScrollTop, setSidebarScrollTop] = useState(() => {
    try {
      const saved = Number(localStorage.getItem('day_trade_workspace_sidebar_scroll_top'))
      return Number.isFinite(saved) ? Math.max(0, saved) : 0
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

  useEffect(() => {
    try { localStorage.setItem('day_trade_workspace_sidebar_tab', sidebarTab) } catch { /* quota */ }
  }, [sidebarTab])

  useEffect(() => {
    try { localStorage.setItem('day_trade_workspace_sidebar_search', sidebarSearch) } catch { /* quota */ }
  }, [sidebarSearch])

  useEffect(() => {
    try { localStorage.setItem('day_trade_workspace_sidebar_scroll_top', String(sidebarScrollTop)) } catch { /* quota */ }
  }, [sidebarScrollTop])

  const symbol = (searchParams.get('symbol') || searchParams.get('ticker') || tickerInput || 'AAPL').trim().toUpperCase()
  const sessionDate = searchParams.get('sessionDate')
  const intervalParam = searchParams.get('interval')
  const interval = intervalParam === '5m' || intervalParam === '15m' ? intervalParam : '1m'

  const workspaceState = useDayTradeWorkspace({
    symbol,
    sessionDate,
    interval,
  })

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

  const refreshMyTickers = useCallback(async () => {
    setTickersLoading(true)
    setTickersError('')
    try {
      const res = await fetchMyTickers()
      setMyTickers((res.data?.tickers ?? []).filter(item => item.symbol && (item.is_active ?? true)))
    } catch (err) {
      setTickersError(err instanceof Error ? err.message : 'Unable to load My Tickers.')
    } finally {
      setTickersLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshMyTickers()
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
    })
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

  const handleIntervalChange = useCallback((nextInterval: '1m' | '5m' | '15m') => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('interval', nextInterval)
      return next
    }, { replace: true })
  }, [setSearchParams])

  const handleWorkspaceAction = useCallback((action: DayTradeWorkspaceAction) => {
    setNotice(action.enabled
      ? `${action.label} is connected through the backend workspace contract.`
      : action.disabledReason || `${action.label} is currently unavailable.`
    )
  }, [])

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
    <div className="day-trade-page min-h-screen bg-surface-page p-3 text-primary">
      <div className="mx-auto flex max-w-[1920px] gap-3">

        {sidebarCollapsed ? (
          <button
            type="button"
            onClick={() => setSidebarCollapsed(false)}
            className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-secondary hover:border-violet-400 dark:border-white/[0.08] dark:bg-slate-950 lg:flex"
            aria-label="Expand sidebar"
          >
            <ChevronRight size={18} />
          </button>
        ) : (
          <aside className="hidden w-80 shrink-0 lg:block">
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
              workspaceLoading={workspaceLoading}
              listRef={listRef}
              handleListScroll={handleListScroll}
              loadTicker={loadTicker}
              setAddDialogOpen={setAddDialogOpen}
              navigate={navigate}
              onCollapse={() => setSidebarCollapsed(true)}
            />
          </aside>
        )}

        {mobileSidebarOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setMobileSidebarOpen(false)} />
            <aside className="absolute left-0 top-0 h-full w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-r-xl border border-slate-200 bg-white p-3 shadow-xl dark:border-white/[0.08] dark:bg-slate-950">
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
                workspaceLoading={workspaceLoading}
                listRef={listRef}
                handleListScroll={handleListScroll}
                loadTicker={loadTicker}
                setAddDialogOpen={setAddDialogOpen}
                navigate={navigate}
                onCollapse={() => setMobileSidebarOpen(false)}
              />
            </aside>
          </div>
        )}

        <main className="min-w-0 flex-1">
          {notice && (
            <div className="mb-3 rounded-xl border border-semantic-info-border bg-semantic-info-bg px-4 py-3 text-sm text-semantic-info">
              {notice}
            </div>
          )}

          {currentTickerItem && (
            <div className="mb-3 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-tertiary">
              {membershipsFor(currentTickerItem).map(key => (
                <span key={key} className="rounded-full border border-slate-200 px-2 py-0.5 dark:border-white/[0.08]">{TRADE_TYPE_LABELS[key]}</span>
              ))}
              {heldTickers.has(symbol) && <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-amber-700 dark:text-amber-200">In Position</span>}
            </div>
          )}

          {workspaceState.loading && !workspaceState.data ? (
            <div className="flex min-h-[680px] items-center justify-center rounded-2xl border border-slate-200 bg-white text-sm text-secondary dark:border-white/[0.08] dark:bg-slate-900">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading backend workspace...
            </div>
          ) : workspaceState.error ? (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-700 dark:text-red-200">
              <div className="font-bold">Workspace unavailable</div>
              <p className="mt-1">{workspaceState.error}</p>
              <button type="button" onClick={() => void workspaceState.reload()} className="mt-4 rounded-lg border border-red-500/30 px-3 py-2 text-xs font-semibold hover:bg-red-500/10">
                Retry
              </button>
            </div>
          ) : workspaceState.data ? (
            <DayTradeWorkspaceShell workspace={workspaceState.data} onAction={handleWorkspaceAction} onIntervalChange={handleIntervalChange} />
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-secondary dark:border-white/[0.08] dark:bg-slate-900">
              Enter a ticker to load the backend Day Trade workspace.
            </div>
          )}

          {/* Mobile sidebar trigger */}
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(true)}
            className="fixed bottom-4 left-4 z-30 flex items-center gap-2 rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 py-3 text-xs font-black text-violet-700 shadow-xl dark:text-violet-200 lg:hidden"
          >
            <Activity size={16} />
            My Tickers
          </button>
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
