import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, Loader2, Plus, Search, Trash2, X } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { DayTradeWorkspaceAction } from '../api/client'
import { addMyTicker, fetchMyTickers, removeMyTicker, removeMyTickerType, searchTickers, updateMyTicker, type MyTickerEntry, type SearchTickerResult } from '../api/commandCenter'
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

const DRAWER_TABS: Array<{ key: TickerListTab; label: string }> = [
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

function formatPrice(item: MyTickerEntry): string {
  return typeof item.last_price === 'number' ? `$${item.last_price.toFixed(2)}` : '—'
}

function formatChange(item: MyTickerEntry): string {
  if (typeof item.price_change_pct !== 'number') return '—'
  const sign = item.price_change_pct > 0 ? '+' : ''
  return `${sign}${item.price_change_pct.toFixed(2)}%`
}

export default function DayTradeWorkspacePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const { portfolio } = useApp()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [tickerInput, setTickerInput] = useState((searchParams.get('symbol') || searchParams.get('ticker') || 'AAPL').trim().toUpperCase())
  const [myTickers, setMyTickers] = useState<MyTickerEntry[]>([])
  const [tickersLoading, setTickersLoading] = useState(false)
  const [tickersError, setTickersError] = useState('')
  const [drawerTab, setDrawerTab] = useState<TickerListTab>('day')
  const [drawerSearch, setDrawerSearch] = useState('')
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [switcherSearch, setSwitcherSearch] = useState('')
  const [recentTickers, setRecentTickers] = useState<string[]>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem('oa_day_trade_recent_tickers') || '[]')
      return Array.isArray(parsed) ? parsed.map(String).slice(0, 8) : []
    } catch {
      return []
    }
  })
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [addQuery, setAddQuery] = useState('')
  const [addResults, setAddResults] = useState<SearchTickerResult[]>([])
  const [addSelected, setAddSelected] = useState<SearchTickerResult | null>(null)
  const [addTypes, setAddTypes] = useState<Record<SidebarTickerGroupKey, boolean>>({ day: true, regular: false, swing: false })
  const [addLoading, setAddLoading] = useState(false)
  const [addError, setAddError] = useState('')

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
      setDrawerOpen(false)
      setSwitcherOpen(false)
      setAddDialogOpen(false)
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
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

  const allSavedTickers = useMemo(() => sortSidebarTickers(myTickers), [myTickers])
  const savedTickerBySymbol = useMemo(() => {
    const map = new Map<string, MyTickerEntry>()
    for (const item of myTickers) map.set(item.symbol.toUpperCase(), item)
    return map
  }, [myTickers])
  const drawerTickers = useMemo(() => {
    const query = drawerSearch.trim().toUpperCase()
    const base = drawerTab === 'all'
      ? allSavedTickers
      : sidebarTickerGroups.find(group => group.key === drawerTab)?.items || []
    if (!query) return base
    return base.filter(item => {
      const company = item.company_name || ''
      return item.symbol.toUpperCase().includes(query) || company.toUpperCase().includes(query)
    })
  }, [allSavedTickers, drawerSearch, drawerTab, sidebarTickerGroups])
  const currentTickerItem = savedTickerBySymbol.get(symbol)
  const addExistingTicker = savedTickerBySymbol.get((addSelected?.symbol || addQuery).trim().toUpperCase())

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
    setDrawerOpen(false)
    setSwitcherOpen(false)
    setRecentTickers(cur => {
      const next = [nextSymbol, ...cur.filter(item => item !== nextSymbol)].slice(0, 8)
      try { localStorage.setItem('oa_day_trade_recent_tickers', JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
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

  const toggleMembership = useCallback(async (item: MyTickerEntry, group: SidebarTickerGroupKey) => {
    const current = new Set(item.trade_types || [])
    const tradeType = TRADE_TYPE_VALUES[group]
    const hasMembership = current.has(tradeType)
    try {
      const res = hasMembership
        ? await removeMyTickerType(item.symbol, tradeType)
        : await updateMyTicker(item.symbol, { trade_types: Array.from(new Set([...current, tradeType])) })
      setMyTickers((res.data?.tickers ?? []).filter(next => next.symbol && (next.is_active ?? true)))
      if (hasMembership && item.symbol.toUpperCase() === symbol) {
        setNotice(`${item.symbol.toUpperCase()} removed from ${TRADE_TYPE_LABELS[group]}. The current workspace remains open.`)
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Unable to update ticker membership.')
    }
  }, [symbol])

  const removeTicker = useCallback(async (item: MyTickerEntry) => {
    try {
      const res = await removeMyTicker(item.symbol)
      setMyTickers((res.data?.tickers ?? []).filter(next => next.symbol && (next.is_active ?? true)))
      if (item.symbol.toUpperCase() === symbol) {
        setNotice(`${item.symbol.toUpperCase()} removed from My Tickers. The current workspace remains open.`)
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Unable to remove ticker.')
    }
  }, [symbol])

  return (
    <div className="day-trade-page min-h-screen bg-surface-page p-3 text-primary">
      <div className="mx-auto flex max-w-[1920px] gap-3">

        {drawerOpen && (
          <aside className="w-80 shrink-0 rounded-xl border border-slate-200 bg-white p-3 dark:border-white/[0.08] dark:bg-slate-950" role="dialog" aria-label="My Tickers drawer">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-[11px] font-black uppercase tracking-widest text-tertiary">Watchlists</div>
                <div className="text-sm font-bold text-heading">My Tickers</div>
              </div>
              <button type="button" onClick={() => setAddDialogOpen(true)} className="mr-1 rounded-lg border border-violet-500/30 bg-violet-500/10 p-1.5 text-violet-700 dark:text-violet-200" aria-label="Add ticker">
                <Plus size={14} />
              </button>
              <button type="button" onClick={() => setDrawerOpen(false)} className="rounded-lg p-1 text-secondary hover:bg-slate-100 dark:hover:bg-slate-900" aria-label="Close watchlist drawer">
                <X size={16} />
              </button>
            </div>
            <div className="grid grid-cols-4 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-900" role="tablist" aria-label="My Tickers lists">
              {DRAWER_TABS.map(tab => {
                const count = tab.key === 'all' ? allSavedTickers.length : sidebarTickerGroups.find(group => group.key === tab.key)?.items.length || 0
                const active = drawerTab === tab.key
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setDrawerTab(tab.key)}
                    className={`rounded-md px-1.5 py-1 text-[10px] font-black ${active ? 'bg-white text-violet-700 shadow-sm dark:bg-slate-800 dark:text-violet-200' : 'text-secondary'}`}
                  >
                    {tab.label} {count}
                  </button>
                )
              })}
            </div>
            <div className="relative mt-3">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-tertiary" />
              <input
                value={drawerSearch}
                onChange={event => setDrawerSearch(event.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-heading outline-none focus:border-violet-500 dark:border-white/[0.08] dark:bg-slate-900"
                placeholder="Search saved tickers..."
                aria-label="Search saved tickers"
              />
            </div>
            <div className="mt-3 max-h-[62vh] space-y-2 overflow-auto">
              {tickersLoading ? (
                <div className="rounded-lg border border-slate-200 p-3 text-sm text-secondary dark:border-white/[0.08]">Loading My Tickers...</div>
              ) : tickersError ? (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-200">
                  <div>{tickersError}</div>
                  <button type="button" onClick={() => void refreshMyTickers()} className="mt-2 text-xs font-bold underline">Retry</button>
                </div>
              ) : drawerTickers.length ? drawerTickers.map(item => {
                const sym = item.symbol.toUpperCase()
                const selected = sym === symbol
                const memberships = membershipsFor(item)
                return (
                  <div key={sym} className={`rounded-lg border p-2 ${selected ? 'border-violet-500 bg-violet-500/10' : 'border-slate-200 dark:border-white/[0.08]'}`}>
                    <button type="button" onClick={() => loadTicker(sym)} className="flex w-full items-start justify-between gap-2 text-left">
                      <span className="min-w-0">
                        <span className="font-mono text-sm font-black text-heading">{sym}</span>
                        <span className="ml-2 text-xs text-tertiary">{item.company_name}</span>
                        <span className="mt-1 block text-[10px] font-bold uppercase tracking-wide text-tertiary">
                          {memberships.map(key => TRADE_TYPE_LABELS[key]).join(' · ') || 'Not categorized'}{heldTickers.has(sym) ? ' · Portfolio' : ''}
                        </span>
                      </span>
                      <span className="text-right">
                        <span className="block font-mono text-xs font-bold text-heading">{formatPrice(item)}</span>
                        <span className={`block font-mono text-[11px] font-bold ${typeof item.price_change_pct === 'number' && item.price_change_pct >= 0 ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'}`}>{formatChange(item)}</span>
                      </span>
                    </button>
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      {(Object.keys(TRADE_TYPE_LABELS) as SidebarTickerGroupKey[]).map(key => {
                        const checked = memberships.includes(key)
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => void toggleMembership(item, key)}
                            className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${checked ? 'border-violet-500 bg-violet-500/10 text-violet-700 dark:text-violet-200' : 'border-slate-200 text-tertiary dark:border-white/[0.08]'}`}
                          >
                            {TRADE_TYPE_LABELS[key]}
                          </button>
                        )
                      })}
                      <button type="button" onClick={() => void removeTicker(item)} className="ml-auto rounded-full p-1 text-tertiary hover:text-red-600" aria-label={`Remove ${sym}`}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                )
              }) : (
                <div className="rounded-lg border border-slate-200 p-3 text-sm text-tertiary dark:border-white/[0.08]">No saved tickers in this list.</div>
              )}
            </div>
            <button type="button" onClick={() => navigate(ROUTES.myTickers)} className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-secondary hover:border-violet-400 dark:border-white/[0.08]">
              Manage My Tickers
            </button>
          </aside>
        )}

        <main className="min-w-0 flex-1">
          <div className="relative mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-white/[0.08] dark:bg-slate-950">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setDrawerOpen(cur => !cur)}
                className="inline-flex items-center gap-2 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs font-black text-violet-700 dark:text-violet-200"
                title="My Tickers"
                aria-label="My Tickers"
              >
                My Tickers
              </button>
              <button
                type="button"
                onClick={() => setSwitcherOpen(cur => !cur)}
                className="inline-flex min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-900"
                aria-expanded={switcherOpen}
                aria-haspopup="dialog"
              >
                <span className="min-w-0">
                  <span className="font-mono text-lg font-black text-heading">{symbol}</span>
                  <span className="ml-2 text-sm font-semibold text-secondary">{currentTickerItem?.company_name || workspaceState.data?.symbol.companyName || ''}</span>
                </span>
                <ChevronDown size={16} className="shrink-0 text-tertiary" />
              </button>
            </div>
            {currentTickerItem ? (
              <div className="flex flex-wrap gap-1 text-[10px] font-bold uppercase tracking-wide text-tertiary">
                {membershipsFor(currentTickerItem).map(key => <span key={key} className="rounded-full border border-slate-200 px-2 py-0.5 dark:border-white/[0.08]">{TRADE_TYPE_LABELS[key]}</span>)}
              </div>
            ) : (
              <button type="button" onClick={() => setAddDialogOpen(true)} className="rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs font-bold text-violet-700 dark:text-violet-200">
                Not in My Tickers · Add
              </button>
            )}
            {switcherOpen && (
              <div className="absolute left-3 top-14 z-30 w-[360px] max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-3 shadow-xl dark:border-white/[0.08] dark:bg-slate-950" role="dialog" aria-label="Ticker switcher">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-tertiary" />
                  <input
                    autoFocus
                    value={switcherSearch}
                    onChange={event => setSwitcherSearch(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Escape') setSwitcherOpen(false)
                      if (event.key === 'Enter' && switcherSearch.trim()) loadTicker(switcherSearch)
                    }}
                    className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-heading outline-none focus:border-violet-500 dark:border-white/[0.08] dark:bg-slate-900"
                    placeholder="Search My Tickers..."
                    aria-label="Search My Tickers"
                  />
                </div>
                {recentTickers.length > 0 && (
                  <div className="mt-3">
                    <div className="mb-1 text-[10px] font-black uppercase tracking-widest text-tertiary">Recent</div>
                    <div className="flex flex-wrap gap-1">
                      {recentTickers.map(sym => (
                        <button key={sym} type="button" onClick={() => loadTicker(sym)} className="rounded-full border border-slate-200 px-2 py-0.5 font-mono text-[11px] font-bold text-secondary dark:border-white/[0.08]">
                          {sym}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="mt-3 max-h-80 overflow-auto">
                  {allSavedTickers
                    .filter(item => {
                      const q = switcherSearch.trim().toUpperCase()
                      if (!q) return true
                      return item.symbol.toUpperCase().includes(q) || (item.company_name || '').toUpperCase().includes(q)
                    })
                    .slice(0, 16)
                    .map(item => {
                      const sym = item.symbol.toUpperCase()
                      return (
                        <button key={sym} type="button" onClick={() => loadTicker(sym)} className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-900">
                          <span>
                            <span className="font-mono text-sm font-black text-heading">{sym}</span>
                            <span className="ml-2 text-xs text-secondary">{item.company_name}</span>
                            <span className="block text-[10px] font-bold uppercase tracking-wide text-tertiary">{membershipsFor(item).map(key => TRADE_TYPE_LABELS[key]).join(' · ')}</span>
                          </span>
                          <span className="font-mono text-xs font-bold text-secondary">{formatPrice(item)}</span>
                        </button>
                      )
                    })}
                  {switcherSearch.trim() && !allSavedTickers.some(item => item.symbol.toUpperCase() === switcherSearch.trim().toUpperCase()) && (
                    <button
                      type="button"
                      onClick={() => {
                        setAddQuery(switcherSearch.trim().toUpperCase())
                        setAddSelected(null)
                        setAddDialogOpen(true)
                      }}
                      className="mt-2 w-full rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs font-bold text-violet-700 dark:text-violet-200"
                    >
                      Add {switcherSearch.trim().toUpperCase()} to My Tickers
                    </button>
                  )}
                </div>
                <button type="button" onClick={() => navigate(ROUTES.myTickers)} className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-secondary hover:border-violet-400 dark:border-white/[0.08]">
                  Manage My Tickers
                </button>
              </div>
            )}
          </div>
          {notice && (
            <div className="mb-3 rounded-xl border border-semantic-info-border bg-semantic-info-bg px-4 py-3 text-sm text-semantic-info">
              {notice}
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
              {addExistingTicker && (
                <div className="mb-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-secondary dark:border-white/[0.08] dark:bg-slate-900">
                  Existing memberships:{' '}
                  <span className="font-bold text-heading">
                    {membershipsFor(addExistingTicker).map(key => TRADE_TYPE_LABELS[key]).join(' · ') || 'None'}
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
