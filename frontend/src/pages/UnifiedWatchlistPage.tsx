import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Loader2,
  Plus,
  RefreshCw,
  Star,
  TrendingUp,
  Pencil,
  Trash2,
  Bell,
  Briefcase,
  StickyNote,
  Download,
  Settings,
  Search,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  MoreHorizontal,
  Layers,
} from 'lucide-react'
import { useApp } from '../contexts/AppContext'
import {
  WatchlistHubProvider,
  useWatchlistHubBinding,
  useWatchlistHubBindingsReader,
} from '../contexts/WatchlistHubContext'
import type { AlertEntry, TickerCacheEntry, WatchlistItem } from '../types'
import { isCacheFresh, cacheAge } from '../types'
import { DayTradeWatchlistPanel } from './DayTradeWatchlistPage'
import { SwingTradeWatchlistPanel } from './SwingTradeWatchlistPage'

const TAB_IDS = ['options', 'day', 'swing'] as const
type HubTabId = (typeof TAB_IDS)[number]

const FILTER_IDS = ['all', 'favorites', 'near', 'alerts', 'earnings', 'breakouts'] as const
type FilterTabId = (typeof FILTER_IDS)[number]

const FAV_KEY = 'oa_watchlist_favorites_v1'
const DESIRED_KEY = 'oa_watchlist_desired_entry_v1'

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function saveJson(key: string, val: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(val))
  } catch {
    /* ignore */
  }
}

function fmtPrice(n: number | undefined) {
  if (n == null || !Number.isFinite(n)) return '—'
  return `$${n.toFixed(2)}`
}

function fmtRelTime(ts: number | undefined) {
  if (ts == null || !Number.isFinite(ts)) return '—'
  const m = Math.floor((Date.now() - ts) / 60000)
  if (m < 1) return 'Just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return new Date(ts).toLocaleString()
}

function fmtChangePct(p: number | undefined) {
  if (p == null || !Number.isFinite(p)) return '—'
  const sign = p >= 0 ? '+' : ''
  return `${sign}${p.toFixed(2)}%`
}

function enginePillClass(verdict: string) {
  if (verdict === 'READY' || verdict === 'TRADE') return 'bg-emerald-950/55 text-emerald-300 ring-1 ring-emerald-500/25'
  if (verdict === 'WATCH' || verdict === 'WAIT') return 'bg-amber-950/50 text-amber-200 ring-1 ring-amber-500/25'
  if (verdict === 'AVOID' || verdict === 'EXIT' || verdict === 'NO_EDGE') return 'bg-red-950/50 text-red-300 ring-1 ring-red-500/20'
  return 'bg-gray-800/90 text-gray-400 ring-1 ring-gray-600/35'
}

function engineSignalFromCache(entry: TickerCacheEntry | null): string {
  if (!entry) return '—'
  return entry.data.final_decision || 'NO_EDGE'
}

function setupReason(item: WatchlistItem, entry: TickerCacheEntry | null): string {
  if (item.notes?.trim()) return item.notes.trim()
  const top = entry?.data.recommendations[0]
  if (top) return `${top.strategy} · ${top.bias}`
  return '—'
}

/** Within 2% of desired entry (matches control-room spec). */
function isNearEntry(price: number | undefined, desired: number | undefined): boolean {
  if (price == null || desired == null || desired <= 0) return false
  return Math.abs(price - desired) / desired <= 0.02
}

function directionDisplay(entry: TickerCacheEntry | null): { label: string; tone: 'bull' | 'bear' | 'neutral' } {
  const b = entry?.data.signals.directional_bias?.toLowerCase() ?? ''
  if (b.includes('bull')) return { label: 'Bullish · Calls', tone: 'bull' }
  if (b.includes('bear')) return { label: 'Bearish · Puts', tone: 'bear' }
  return { label: 'Neutral / Range', tone: 'neutral' }
}

function enginePillLabel(verdict: string): string {
  return verdict
}

function week52FromHistory(entry: TickerCacheEntry | null): { low: number; high: number } | null {
  const ph = entry?.data.price_history
  if (!ph?.length) return null
  let lo = Infinity
  let hi = -Infinity
  for (const p of ph) {
    if (p.close < lo) lo = p.close
    if (p.close > hi) hi = p.close
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null
  return { low: lo, high: hi }
}

function isBreakout(entry: TickerCacheEntry | null): boolean {
  const sig = entry?.data.signals
  if (!sig) return false
  const m = sig.macd_crossover?.toLowerCase() ?? ''
  if (m.includes('bull') || m.includes('buy')) return true
  return sig.rsi >= 62 && sig.current_price > sig.ma20
}

type StrategyRow = {
  item: WatchlistItem
  ticker: string
  entry: TickerCacheEntry | null
  price: number | undefined
  setupReason: string
  earnKw: boolean
}

function RegularOptionsExpandedDetails({ row }: { row: StrategyRow }) {
  const sig = row.entry?.data.signals
  const w52 = week52FromHistory(row.entry)
  const price = row.price
  let w52Frac = 0.5
  if (w52 && price != null && w52.high > w52.low) {
    w52Frac = Math.min(1, Math.max(0, (price - w52.low) / (w52.high - w52.low)))
  }
  const ivr = sig?.iv_rank
  const ivLabel =
    ivr == null || !Number.isFinite(ivr) ? '—' : ivr >= 55 ? 'Elevated' : ivr >= 35 ? 'Moderate' : 'Low'
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <div>
        <div className="text-[10px] uppercase tracking-wide text-gray-500">Price</div>
        <div className="text-lg font-semibold text-white tabular-nums">
          {fmtPrice(price)}{' '}
          <span
            className={
              sig?.price_change_pct == null
                ? 'text-gray-500 text-sm'
                : sig.price_change_pct >= 0
                  ? 'text-emerald-400 text-sm'
                  : 'text-red-400 text-sm'
            }
          >
            {fmtChangePct(sig?.price_change_pct)}
          </span>
        </div>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-gray-500">52W range</div>
        {w52 ? (
          <>
            <div className="text-xs text-gray-400 tabular-nums">
              {w52.low.toFixed(2)} — {w52.high.toFixed(2)}
            </div>
            <div className="mt-2 relative h-2 rounded-full bg-gray-800">
              <div
                className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-violet-400 bg-gray-950 shadow"
                style={{ left: `${w52Frac * 100}%` }}
              />
            </div>
          </>
        ) : (
          <div className="text-sm text-gray-500">—</div>
        )}
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-gray-500">IV rank</div>
        <div className="text-sm text-gray-200">
          {ivr != null && Number.isFinite(ivr) ? (
            <>
              {Math.round(ivr)} <span className="text-gray-500">({ivLabel})</span>
            </>
          ) : (
            '—'
          )}
        </div>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-gray-500">Next earnings</div>
        <div className="text-sm text-gray-300">
          {row.earnKw ? 'Flagged in notes (no calendar yet)' : '—'}
        </div>
      </div>
      <div className="sm:col-span-2">
        <div className="text-[10px] uppercase tracking-wide text-gray-500">Watch reason</div>
        <div className="text-sm text-gray-300">{row.setupReason}</div>
      </div>
    </div>
  )
}

function hasEarningsKeyword(item: WatchlistItem): boolean {
  return /\bearn/i.test(item.notes ?? '')
}

function StrategyWatchlistBoard() {
  const {
    watchlist,
    watchlistMax,
    removeFromWatchlist,
    addToWatchlist,
    updateWatchlistNotes,
    requestAnalysis,
    getCached,
    refreshingTickers,
    refreshWatchlistForAlerts,
    lastBgRefresh,
    alerts,
    navigate,
    navigatePositionsTab,
  } = useApp()

  const [searchParams, setSearchParams] = useSearchParams()
  const filterRaw = (searchParams.get('filter')?.trim().toLowerCase() ?? 'all') as string
  const filter: FilterTabId = FILTER_IDS.includes(filterRaw as FilterTabId)
    ? (filterRaw as FilterTabId)
    : 'all'

  const setFilter = useCallback(
    (next: FilterTabId) => {
      const t = new URLSearchParams(searchParams)
      t.set('filter', next)
      setSearchParams(t, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  const [favorites, setFavorites] = useState<string[]>(() => loadJson<string[]>(FAV_KEY, []))
  const [desiredMap, setDesiredMap] = useState<Record<string, number>>(() =>
    loadJson<Record<string, number>>(DESIRED_KEY, {}),
  )

  useEffect(() => {
    saveJson(FAV_KEY, favorites)
  }, [favorites])

  useEffect(() => {
    saveJson(DESIRED_KEY, desiredMap)
  }, [desiredMap])

  const favSet = useMemo(() => new Set(favorites.map(t => t.toUpperCase())), [favorites])

  const toggleFavorite = (ticker: string) => {
    const u = ticker.toUpperCase()
    setFavorites(prev => (prev.map(x => x.toUpperCase()).includes(u) ? prev.filter(x => x.toUpperCase() !== u) : [...prev, u]))
  }

  const setDesiredEntry = (ticker: string, raw: string) => {
    const n = parseFloat(raw)
    if (!Number.isFinite(n) || n <= 0) {
      setDesiredMap(prev => {
        const next = { ...prev }
        delete next[ticker.toUpperCase()]
        return next
      })
      return
    }
    setDesiredMap(prev => ({ ...prev, [ticker.toUpperCase()]: n }))
  }

  const rows = useMemo(() => {
    return watchlist.map(item => {
      const t = item.ticker.toUpperCase()
      const entry = getCached(t)
      const sig = entry?.data.signals
      const price = sig?.current_price ?? item.lastPrice
      const desired = desiredMap[t]
      const strong = entry?.data.final_decision === 'READY'
      const near = isNearEntry(price, desired)
      const brk = isBreakout(entry)
      const earnKw = hasEarningsKeyword(item)
      const alertN = alerts.filter((a: AlertEntry) => a.ticker === t && !a.dismissed).length
      const chg = sig?.price_change_pct
      const verdict = engineSignalFromCache(entry)
      const enginePill = enginePillLabel(verdict)
      const dir = directionDisplay(entry)
      const distPctNum =
        price != null && desired != null && desired > 0 ? ((price - desired) / desired) * 100 : null
      const dist =
        distPctNum != null ? `${distPctNum >= 0 ? '+' : ''}${distPctNum.toFixed(2)}%` : '—'

      return {
        item,
        ticker: t,
        entry,
        price,
        desired,
        changePct: chg,
        dist,
        distPctNum,
        engineSignal: verdict,
        enginePill,
        direction: dir.label,
        directionTone: dir.tone,
        setupReason: setupReason(item, entry),
        alertStatus: alertN > 0 ? `${alertN} active` : 'None',
        alertN,
        lastUpdated: entry?.timestamp,
        refreshing: refreshingTickers.has(t),
        near,
        strong,
        brk,
        earnKw,
        favorite: favSet.has(t),
      }
    })
  }, [watchlist, getCached, desiredMap, alerts, favSet, refreshingTickers])

  const summary = useMemo(() => {
    const total = rows.length
    const nearC = rows.filter(r => r.near).length
    const strongC = rows.filter(r => r.strong).length
    const earnC = rows.filter(r => r.earnKw).length
    const withAlerts = rows.filter(r => r.alertN > 0).length
    return {
      total,
      withAlerts,
      nearEntry: nearC,
      strongSignals: strongC,
      earningsWeek: earnC,
    }
  }, [rows])

  const tabCounts = useMemo(
    () => ({
      all: rows.length,
      favorites: rows.filter(r => r.favorite).length,
      near: rows.filter(r => r.near).length,
      alerts: rows.filter(r => r.alertN > 0).length,
      earnings: rows.filter(r => r.earnKw).length,
      breakouts: rows.filter(r => r.brk).length,
    }),
    [rows],
  )

  const filtered = useMemo(() => {
    return rows.filter(r => {
      switch (filter) {
        case 'all':
          return true
        case 'favorites':
          return r.favorite
        case 'near':
          return r.near
        case 'alerts':
          return r.alertN > 0
        case 'earnings':
          return r.earnKw
        case 'breakouts':
          return r.brk
        default:
          return true
      }
    })
  }, [rows, filter])

  const [tableSearch, setTableSearch] = useState('')
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null)
  const [openMenuTicker, setOpenMenuTicker] = useState<string | null>(null)

  const filteredTable = useMemo(() => {
    const q = tableSearch.trim().toLowerCase()
    if (!q) return filtered
    return filtered.filter(
      r =>
        r.ticker.toLowerCase().includes(q) ||
        (r.item.companyName?.toLowerCase().includes(q) ?? false) ||
        (r.entry?.data.company_name?.toLowerCase().includes(q) ?? false),
    )
  }, [filtered, tableSearch])

  const exportCsv = useCallback(() => {
    const lines = [
      'ticker,company_name,notes',
      ...watchlist.map(w =>
        `${w.ticker},"${(w.companyName ?? '').replace(/"/g, '""')}","${(w.notes ?? '').replace(/"/g, '""')}"`,
      ),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `watchlist-export-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }, [watchlist])

  const [showAdd, setShowAdd] = useState(false)
  const [addTicker, setAddTicker] = useState('')
  const [addNotes, setAddNotes] = useState('')

  useEffect(() => {
    if (!openMenuTicker) return
    const close = () => setOpenMenuTicker(null)
    const id = window.setTimeout(() => {
      document.addEventListener('click', close)
    }, 0)
    return () => {
      clearTimeout(id)
      document.removeEventListener('click', close)
    }
  }, [openMenuTicker])

  const cachedCount = watchlist.filter(w => !!getCached(w.ticker)).length
  const anyRefreshing = refreshingTickers.size > 0

  const hubOnAdd = useCallback(() => setShowAdd(s => !s), [])
  const hubOnRefresh = useCallback(() => {
    refreshWatchlistForAlerts()
  }, [refreshWatchlistForAlerts])

  useWatchlistHubBinding('options', true, {
    onAdd: hubOnAdd,
    onRefresh: hubOnRefresh,
    refreshDisabled: cachedCount === 0 || anyRefreshing,
    refreshBusy: anyRefreshing,
    addActive: showAdd,
    onExportCsv: exportCsv,
  })

  const handleAdd = () => {
    const t = addTicker.trim().toUpperCase()
    if (!t) return
    if (!addToWatchlist({ ticker: t, notes: addNotes.trim() || undefined })) return
    setAddTicker('')
    setAddNotes('')
    setShowAdd(false)
  }

  const filterLabels: { id: FilterTabId; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'favorites', label: 'Favorites' },
    { id: 'near', label: 'Near Entry' },
    { id: 'alerts', label: 'With Alerts' },
    { id: 'earnings', label: 'Earnings' },
    { id: 'breakouts', label: 'Breakouts' },
  ]

  const footerLastUpdated = useMemo(() => {
    const ts = rows.map(r => r.lastUpdated).filter((x): x is number => x != null && Number.isFinite(x))
    const maxRow = ts.length ? Math.max(...ts) : 0
    const bg = lastBgRefresh ?? 0
    return fmtRelTime(Math.max(maxRow, bg) || undefined)
  }, [rows, lastBgRefresh])

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
        <div className="rounded-xl border border-gray-800 bg-gray-900/60 px-4 py-3 shadow-sm">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Watchlist items</div>
          <div className="text-xl font-bold tabular-nums text-gray-100">{summary.total}</div>
          <div className="text-[11px] text-gray-500 mt-0.5">{summary.withAlerts} with alerts</div>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900/60 px-4 py-3 shadow-sm">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Near entry</div>
          <div className="text-xl font-bold tabular-nums text-gray-100">{summary.nearEntry}</div>
          <div className="text-[11px] text-gray-500 mt-0.5">Within 2% of entry</div>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900/60 px-4 py-3 shadow-sm">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Ready signals</div>
          <div className="text-xl font-bold tabular-nums text-emerald-400/95">{summary.strongSignals}</div>
          <div className="text-[11px] text-gray-500 mt-0.5">Backend resolved to READY</div>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900/60 px-4 py-3 shadow-sm">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Earnings this week</div>
          <div className="text-xl font-bold tabular-nums text-amber-400/95">{summary.earningsWeek}</div>
          <div className="text-[11px] text-gray-500 mt-0.5">Notes flagged “earn”</div>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900/60 px-4 py-3 shadow-sm col-span-2 sm:col-span-1">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Watchlist P/L (est.)</div>
          <div className="text-xl font-bold tabular-nums text-gray-300">—</div>
          <div className="text-[11px] text-gray-500 mt-0.5">Unrealized · portfolio link TBD</div>
        </div>
      </section>

      <p className="text-[11px] text-gray-600">
        Watchlist status now comes from the backend resolver, not a UI-side checklist. Desired entry is stored in this
        browser only.
      </p>

      <div className="space-y-4 min-w-0">
          <div className="grid grid-cols-2 gap-2 border-b border-gray-800 pb-2 sm:grid-cols-3 lg:grid-cols-6">
            {filterLabels.map(ft => (
              <button
                key={ft.id}
                type="button"
                onClick={() => setFilter(ft.id)}
                className={`w-full text-center rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                  filter === ft.id ? 'bg-violet-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                }`}
              >
                {ft.label}{' '}
                <span className="tabular-nums opacity-80">({tabCounts[ft.id]})</span>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[10rem] max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
              <input
                value={tableSearch}
                onChange={e => setTableSearch(e.target.value)}
                placeholder="Search ticker…"
                className="w-full rounded-lg border border-gray-700 bg-gray-950/80 py-2 pl-9 pr-3 text-sm text-white placeholder:text-gray-600 focus:border-violet-600 focus:outline-none focus:ring-1 focus:ring-violet-600"
              />
            </div>
          </div>

      {showAdd && (
        <div className="rounded-xl border border-gray-700 bg-gray-900/80 p-4 space-y-3 max-w-lg">
          <div className="text-sm font-semibold text-gray-200">Add ticker</div>
          <div className="flex flex-wrap gap-2">
            <input
              value={addTicker}
              onChange={e => setAddTicker(e.target.value)}
              placeholder="Ticker"
              className="flex-1 min-w-[8rem] rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white uppercase"
            />
            <input
              value={addNotes}
              onChange={e => setAddNotes(e.target.value)}
              placeholder="Setup / notes (optional)"
              className="flex-[2] min-w-[12rem] rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleAdd}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => {
                setShowAdd(false)
                setAddTicker('')
                setAddNotes('')
              }}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800"
            >
              Cancel
            </button>
            <span className="text-xs text-gray-500 self-center">
              {watchlist.length} / {watchlistMax}
            </span>
          </div>
        </div>
      )}

      {filteredTable.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-900/30 px-4 py-10 text-center text-sm text-gray-500">
          No rows for this filter or search. Try another tab or clear search.
        </div>
      ) : (
        <div className="space-y-2">
          <div className="hidden sm:flex items-center gap-3 px-4 py-1.5 text-xs font-semibold text-gray-600 uppercase tracking-wide">
            <div className="w-28 shrink-0">Ticker</div>
            <div className="w-28 shrink-0">Quote</div>
            <div className="w-28 shrink-0 hidden sm:block">Decision</div>
            <div className="w-36 shrink-0 hidden md:block">Direction</div>
            <div className="flex-1 min-w-0 hidden lg:block">Setup</div>
            <div className="w-28 shrink-0 justify-end text-right hidden sm:flex">Status</div>
            <div className="min-w-[11rem] shrink-0 hidden sm:flex justify-end text-right">Actions</div>
          </div>

          {filteredTable.map(r => {
            const fresh = r.entry && isCacheFresh(r.entry)
            const scanning = r.refreshing
            const expanded = expandedTicker === r.ticker
            const chgCls =
              r.changePct == null
                ? 'text-gray-500'
                : r.changePct >= 0
                  ? 'text-emerald-400'
                  : 'text-red-400'
            const distCls =
              r.distPctNum == null
                ? 'text-gray-500'
                : r.distPctNum >= 0
                  ? 'text-emerald-400'
                  : 'text-red-400'
            const dirCls =
              r.directionTone === 'bull'
                ? 'text-emerald-400/95'
                : r.directionTone === 'bear'
                  ? 'text-red-400/90'
                  : 'text-gray-400'
            const company = r.item.companyName ?? r.entry?.data.company_name ?? '—'
            const statusLabel = scanning ? 'Refreshing…' : r.entry ? 'Ready' : 'Idle'

            const rowForDetails: StrategyRow = {
              item: r.item,
              ticker: r.ticker,
              entry: r.entry,
              price: r.price,
              setupReason: r.setupReason,
              earnKw: r.earnKw,
            }

            return (
              <div
                key={r.ticker}
                className={`rounded-2xl overflow-hidden transition-colors bg-gray-900 border ${
                  scanning ? 'border-blue-800/50' : 'border-gray-800 hover:border-gray-700'
                } ${expanded ? 'ring-1 ring-inset ring-violet-500/25' : ''}`}
              >
                <div className="grid grid-cols-2 gap-3 px-4 py-3 sm:flex sm:items-center sm:flex-wrap">
                  <div className="min-w-0 sm:w-28 sm:shrink-0">
                    <div className="flex items-start gap-1.5">
                      <button
                        type="button"
                        title={r.favorite ? 'Remove favorite' : 'Favorite'}
                        className={`shrink-0 mt-0.5 p-0.5 rounded-md ${r.favorite ? 'text-amber-400' : 'text-gray-600 hover:text-amber-400'}`}
                        onClick={() => toggleFavorite(r.ticker)}
                      >
                        <Star size={14} className={r.favorite ? 'fill-current' : ''} />
                      </button>
                      <div className="min-w-0">
                        <div className="font-semibold text-white text-sm tracking-tight font-mono">{r.ticker}</div>
                        <div className="text-xs text-gray-500 truncate sm:max-w-[110px]">{company}</div>
                        <div className="text-[10px] text-gray-600">Options · Strategy Finder</div>
                      </div>
                    </div>
                  </div>

                  <div className="min-w-0 text-right sm:text-left sm:w-28 sm:shrink-0">
                    {scanning ? (
                      <Loader2 className="inline-block animate-spin text-gray-500 sm:mx-0 ml-auto" size={14} />
                    ) : (
                      <>
                        <div className="text-sm font-semibold text-white font-mono tabular-nums">{fmtPrice(r.price)}</div>
                        <div className={`text-xs font-medium ${chgCls}`}>{fmtChangePct(r.changePct)}</div>
                      </>
                    )}
                  </div>

                  <div className="flex items-center sm:hidden">
                    <span className={`text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 ${enginePillClass(r.engineSignal)}`}>
                      {r.enginePill}
                    </span>
                  </div>

                  <div className="text-right sm:hidden space-y-0.5">
                    <div className={`text-[11px] leading-snug line-clamp-2 ${dirCls}`}>{r.direction}</div>
                    <div className="flex items-center justify-end gap-1 text-[10px] text-gray-500 tabular-nums">
                      {r.desired != null ? (
                        <>
                          <span>{r.desired.toFixed(2)}</span>
                          <button
                            type="button"
                            title="Set desired entry"
                            className="p-0.5 rounded text-gray-500 hover:text-violet-400"
                            onClick={() => {
                              const raw = window.prompt('Desired entry price (stock)', r.desired != null ? String(r.desired) : '')
                              if (raw === null) return
                              setDesiredEntry(r.ticker, raw.trim())
                            }}
                          >
                            <Pencil size={11} />
                          </button>
                          <span>·</span>
                        </>
                      ) : (
                        <>
                          <span>—</span>
                          <span>·</span>
                        </>
                      )}
                      <span className={`font-medium ${distCls}`}>{r.dist}</span>
                    </div>
                  </div>

                  <div className="w-28 shrink-0 hidden sm:block">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${enginePillClass(r.engineSignal)}`}>
                      {r.enginePill}
                    </span>
                  </div>

                  <div className="w-36 shrink-0 hidden sm:block md:hidden">
                    <div className={`text-[10px] leading-snug line-clamp-2 ${dirCls}`}>{r.direction}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-gray-500 tabular-nums">
                      <span>{r.desired != null ? r.desired.toFixed(2) : '—'}</span>
                      <button
                        type="button"
                        title="Set desired entry"
                        className="p-0.5 rounded text-gray-500 hover:text-violet-400 shrink-0"
                        onClick={() => {
                          const raw = window.prompt('Desired entry price (stock)', r.desired != null ? String(r.desired) : '')
                          if (raw === null) return
                          setDesiredEntry(r.ticker, raw.trim())
                        }}
                      >
                        <Pencil size={10} />
                      </button>
                      <span>·</span>
                      <span className={distCls}>{r.dist}</span>
                    </div>
                  </div>

                  <div className="w-36 shrink-0 hidden md:block">
                    <div className={`text-[11px] leading-snug ${dirCls}`}>{r.direction}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-gray-400 tabular-nums">
                      <span>{r.desired != null ? r.desired.toFixed(2) : '—'}</span>
                      <button
                        type="button"
                        title="Set desired entry"
                        className="p-0.5 rounded text-gray-500 hover:text-violet-400 shrink-0"
                        onClick={() => {
                          const raw = window.prompt('Desired entry price (stock)', r.desired != null ? String(r.desired) : '')
                          if (raw === null) return
                          setDesiredEntry(r.ticker, raw.trim())
                        }}
                      >
                        <Pencil size={11} />
                      </button>
                      <span className="text-gray-500">·</span>
                      <span className={distCls}>{r.dist}</span>
                    </div>
                  </div>

                  <div className="flex-1 min-w-0 hidden lg:block">
                    <div className="flex items-start gap-1.5 min-w-0" title={r.setupReason}>
                      <Layers size={12} className="shrink-0 mt-0.5 text-violet-400/90" aria-hidden />
                      <p className="text-xs text-gray-300 leading-snug line-clamp-2">{r.setupReason}</p>
                    </div>
                  </div>

                  <div className="w-28 shrink-0 hidden sm:flex flex-col items-end justify-center gap-0.5 text-right">
                    <span className="text-xs text-gray-400">{statusLabel}</span>
                    <span className={`text-[11px] tabular-nums ${fresh ? 'text-emerald-400/95' : 'text-gray-500'}`}>
                      {fmtRelTime(r.lastUpdated)}
                    </span>
                    {r.entry ? <span className="text-[10px] text-gray-600">{cacheAge(r.entry)}m cache</span> : null}
                  </div>

                  <div className="col-span-2 flex items-center justify-end gap-1.5 sm:col-span-1 sm:flex sm:shrink-0 sm:w-auto sm:min-w-[10.5rem] sm:justify-end sm:ml-auto">
                    <button
                      type="button"
                      title="Analyze"
                      aria-label={`Analyze ${r.ticker}`}
                      onClick={() => requestAnalysis(r.ticker)}
                      className="inline-flex h-9 w-9 items-center justify-center bg-violet-600/20 hover:bg-violet-600/40 border border-violet-700/50 text-violet-300 rounded-xl transition-colors shrink-0 disabled:opacity-40"
                      disabled={scanning}
                    >
                      <TrendingUp size={16} />
                    </button>
                    <button
                      type="button"
                      title="Move to portfolio"
                      aria-label="Move to portfolio"
                      onClick={() => navigatePositionsTab('open')}
                      className="inline-flex h-9 w-9 items-center justify-center bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 hover:text-gray-200 rounded-xl transition-colors shrink-0"
                    >
                      <Briefcase size={14} />
                    </button>
                    <button
                      type="button"
                      title={r.alertN > 0 ? `${r.alertN} alerts` : 'Alerts'}
                      aria-label="Alert center"
                      onClick={() => navigate('alert-center')}
                      className="relative inline-flex h-9 w-9 items-center justify-center bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 hover:text-amber-400 rounded-xl transition-colors shrink-0"
                    >
                      <Bell size={14} strokeWidth={2} />
                      {r.alertN > 0 ? (
                        <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-0.5 text-[9px] font-bold text-white">
                          {r.alertN > 9 ? '9+' : r.alertN}
                        </span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      onClick={() => setExpandedTicker(x => (x === r.ticker ? null : r.ticker))}
                      aria-expanded={expanded}
                      title={expanded ? 'Collapse details' : 'Expand details'}
                      aria-label={expanded ? 'Collapse' : 'Expand details'}
                      className="inline-flex h-9 w-9 items-center justify-center bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 hover:text-gray-200 rounded-xl transition-colors shrink-0"
                    >
                      {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                    <button
                      type="button"
                      title={`Remove ${r.ticker}`}
                      aria-label={`Remove ${r.ticker}`}
                      onClick={() => {
                        removeFromWatchlist(r.ticker)
                        setOpenMenuTicker(null)
                        setExpandedTicker(e => (e === r.ticker ? null : e))
                      }}
                      className="inline-flex h-9 w-9 items-center justify-center bg-gray-800 hover:bg-red-900/30 border border-gray-700 text-gray-500 hover:text-red-400 rounded-xl transition-colors shrink-0"
                    >
                      <Trash2 size={14} />
                    </button>
                    <div className="relative">
                      <button
                        type="button"
                        title="More"
                        className="inline-flex h-9 w-9 items-center justify-center bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 hover:text-gray-200 rounded-xl transition-colors shrink-0"
                        onMouseDown={e => e.stopPropagation()}
                        onClick={e => {
                          e.stopPropagation()
                          setOpenMenuTicker(ot => (ot === r.ticker ? null : r.ticker))
                        }}
                      >
                        <MoreHorizontal size={14} />
                      </button>
                      {openMenuTicker === r.ticker ? (
                        <div className="absolute right-0 bottom-full z-30 mb-1 w-44 rounded-lg border border-gray-700 bg-gray-900 py-1 text-left shadow-xl sm:bottom-auto sm:top-full sm:mt-1 sm:mb-0">
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 px-3 py-2 text-[11px] text-gray-200 hover:bg-gray-800"
                            onClick={() => {
                              const raw = window.prompt('Watchlist note', r.item.notes ?? '')
                              if (raw !== null) updateWatchlistNotes(r.ticker, raw)
                              setOpenMenuTicker(null)
                            }}
                          >
                            <StickyNote size={14} />
                            Edit note
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="col-span-2 flex justify-end text-xs text-gray-500 sm:hidden">{statusLabel}</div>
                </div>

                {expanded ? (
                  <div className="border-t border-gray-800 px-4 py-3 bg-gray-800/30">
                    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-gray-800/80 pb-3 mb-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-lg font-bold text-white font-mono">{r.ticker}</span>
                          <span className="text-sm text-gray-400 truncate max-w-[16rem]">{company}</span>
                        </div>
                        <p className="text-[11px] text-gray-500 mt-1">
                          {[r.entry?.data.sector ?? r.item.sector, r.entry?.data.market_cap].filter(Boolean).join(' · ') || '—'}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="text-xs text-gray-500 hover:text-white shrink-0"
                        onClick={() => setExpandedTicker(null)}
                      >
                        Close
                      </button>
                    </div>
                    <RegularOptionsExpandedDetails row={rowForDetails} />
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
      </div>

      <footer className="flex flex-col gap-2 border-t border-gray-800/80 pt-4 text-[11px] text-gray-600 sm:flex-row sm:items-center sm:justify-between">
        <p>Quotes and signals are illustrative; not investment advice. Desired entry is local to this browser.</p>
        <div className="flex flex-wrap items-center gap-3 text-gray-500">
          {lastBgRefresh ? <span>Sweep {new Date(lastBgRefresh).toLocaleTimeString()}</span> : null}
          <span className="tabular-nums">Last updated {footerLastUpdated}</span>
          <button
            type="button"
            title="Refresh watchlist"
            onClick={() => refreshWatchlistForAlerts()}
            className="inline-flex items-center gap-1 rounded-md border border-gray-700 px-2 py-1 text-gray-400 hover:text-white"
          >
            <RefreshCw size={12} />
            Refresh
          </button>
        </div>
      </footer>
    </div>
  )
}

export default function UnifiedWatchlistPage() {
  return (
    <WatchlistHubProvider>
      <UnifiedWatchlistInner />
    </WatchlistHubProvider>
  )
}

function UnifiedWatchlistInner() {
  const { canAccessPage, navigate } = useApp()
  const [searchParams, setSearchParams] = useSearchParams()
  const canDay = canAccessPage('day-trade-watchlist')
  const canSwing = canAccessPage('swing-trade-watchlist')

  const rawTab = (searchParams.get('tab')?.trim().toLowerCase() ?? 'options') as string
  const tab: HubTabId = TAB_IDS.includes(rawTab as HubTabId) ? (rawTab as HubTabId) : 'options'

  const safeTab = useMemo((): HubTabId => {
    if (tab === 'day' && !canDay) return 'options'
    if (tab === 'swing' && !canSwing) return 'options'
    return tab
  }, [tab, canDay, canSwing])

  useLayoutEffect(() => {
    if (safeTab !== tab) {
      setSearchParams(prev => {
        const n = new URLSearchParams(prev)
        n.set('tab', safeTab)
        return n
      }, { replace: true })
    }
  }, [safeTab, tab, setSearchParams])

  const tabs = useMemo(
    () =>
      [
        { id: 'options' as const, label: 'Regular', hint: 'Options & Finder', enabled: true },
        { id: 'day' as const, label: 'Day trade', hint: 'Intraday', enabled: canDay },
        { id: 'swing' as const, label: 'Swing trade', hint: 'Multi-day', enabled: canSwing },
      ].filter(t => t.enabled),
    [canDay, canSwing],
  )

  const hubBindings = useWatchlistHubBindingsReader()
  const hub = hubBindings[safeTab]

  return (
    <div className="watchlist-hub-page min-h-screen p-4 md:p-6 pb-28">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-gray-800 pb-3">
          <div
            className={`grid gap-2 min-w-0 flex-1 ${
              tabs.length >= 3 ? 'grid-cols-3' : tabs.length === 2 ? 'grid-cols-2' : 'grid-cols-1'
            }`}
          >
            {tabs.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setSearchParams(prev => {
                    const n = new URLSearchParams(prev)
                    n.set('tab', t.id)
                    return n
                  }, { replace: true })
                }}
                title={t.hint}
                className={`w-full text-center rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                  safeTab === t.id ? 'bg-violet-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {hub ? (
            <div className="flex flex-wrap items-center gap-2 shrink-0 ml-auto">
              <button
                type="button"
                onClick={() => hub.onAdd()}
                disabled={hub.addDisabled}
                aria-label={hub.addActive ? 'Close add form' : 'Add ticker'}
                title={hub.addActive ? 'Close' : 'Add'}
                className={`inline-flex h-10 w-10 items-center justify-center rounded-xl transition-colors shrink-0 border ${
                  hub.addActive
                    ? 'bg-gray-700 border-gray-600 text-white hover:bg-gray-600'
                    : 'bg-violet-600 hover:bg-violet-500 border-transparent text-white'
                } disabled:opacity-50`}
              >
                <Plus size={20} strokeWidth={2.5} />
              </button>
              <button
                type="button"
                onClick={() => hub.onRefresh()}
                disabled={hub.refreshDisabled}
                aria-label="Refresh watchlist"
                title="Refresh all"
                className="inline-flex h-10 w-10 items-center justify-center bg-gray-800 border border-gray-700
                  text-gray-400 hover:text-gray-200 hover:border-gray-600 rounded-xl transition-colors disabled:opacity-50"
              >
                {hub.refreshBusy ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
              </button>
              {hub.onExportCsv ? (
                <button
                  type="button"
                  title="Export CSV"
                  onClick={() => hub.onExportCsv?.()}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-700 bg-gray-800
                    text-gray-300 hover:border-gray-600 hover:text-white transition-colors shrink-0"
                >
                  <Download size={18} />
                </button>
              ) : null}
              <button
                type="button"
                title="Settings"
                onClick={() => navigate('settings')}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-700 bg-gray-800
                  text-gray-300 hover:border-gray-600 hover:text-white transition-colors shrink-0"
              >
                <Settings size={18} />
              </button>
            </div>
          ) : null}
        </div>

        <div className="rounded-2xl border border-gray-800/70 bg-gray-950/35 p-3 sm:p-5">
          {safeTab === 'options' && <StrategyWatchlistBoard />}
          {safeTab === 'day' && canDay && (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">
                Scans periodically for alert emails when verdict escalates{' '}
                <span className="text-gray-400">WATCH → GO</span>.{' '}
                <button
                  type="button"
                  onClick={() => navigate('day-trade-alerts')}
                  className="font-semibold text-violet-400 hover:text-violet-300"
                >
                  Alert history →
                </button>
              </p>
              <DayTradeWatchlistPanel embedInHub />
            </div>
          )}
          {safeTab === 'swing' && canSwing && (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">Expand rows to refresh the swing engine; symbols sync to your account.</p>
              <SwingTradeWatchlistPanel embedInHub />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
