import { useMemo, useState } from 'react'
import {
  Star, Trash2, TrendingUp, RefreshCw, Plus, Search,
  Database, Clock, AlertTriangle, CheckCircle, ChevronUp, ChevronDown, Layers,
} from 'lucide-react'
import { useApp } from '../contexts/AppContext'
import { isCacheFresh, cacheAge } from '../types'
import type { TickerCacheEntry, WatchlistItem } from '../types'
import { TICKER_CATEGORY_MAP, CATEGORY_BADGE, ALL_CATEGORIES } from '../data/stockUniverse'
import type { AICategory } from '../data/stockUniverse'

type SortKey = 'ticker' | 'price' | 'iv' | 'bias' | 'topRec' | 'cached'
type SortDir = 'asc' | 'desc'
type ViewMode = 'list' | 'grouped'

function getCategory(ticker: string, sector?: string): string {
  return TICKER_CATEGORY_MAP[ticker] ?? sector ?? 'Other'
}

function formatSector(sector?: string) {
  if (!sector) return 'Other'
  if (sector === 'Technology') return 'Tech'
  if (sector === 'Financial Services') return 'Finance'
  if (sector === 'Communication Services') return 'Communications'
  if (sector === 'Consumer Cyclical') return 'Consumer'
  return sector
}

function SortHeader({
  label, sortKey, activeKey, dir, className, onSort,
}: {
  label: string
  sortKey: SortKey
  activeKey: SortKey
  dir: SortDir
  className: string
  onSort: (key: SortKey) => void
}) {
  const active = activeKey === sortKey
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={`${className} items-center gap-1 text-left hover:text-gray-300 transition-colors ${active ? 'text-violet-400' : ''}`}
    >
      <span>{label}</span>
      {active && (dir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
    </button>
  )
}

// ── Freshness badge ────────────────────────────────────────────────────────────
function FreshnessBadge({ entry, refreshing }: { entry: TickerCacheEntry | null; refreshing: boolean }) {
  if (refreshing) return (
    <span className="flex items-center gap-1 text-xs text-blue-400">
      <RefreshCw size={10} className="animate-spin" /> Refreshing…
    </span>
  )
  if (!entry) return (
    <span className="flex items-center gap-1 text-xs text-gray-600">
      <Database size={10} /> No data
    </span>
  )
  const fresh = isCacheFresh(entry)
  const age   = cacheAge(entry)
  return fresh ? (
    <span className="flex items-center gap-1 text-xs text-emerald-500">
      <CheckCircle size={10} />
      {age === 0 ? 'Just now' : `${age}m ago`}
    </span>
  ) : (
    <span className="flex items-center gap-1 text-xs text-amber-500">
      <AlertTriangle size={10} />
      Stale · {age}m ago
    </span>
  )
}

// ── Single ticker row ──────────────────────────────────────────────────────────
function TickerRow({
  item, entry, refreshing, onAnalyze, onRefresh, onRemove,
}: {
  item: WatchlistItem
  entry: TickerCacheEntry | null
  refreshing: boolean
  onAnalyze: () => void
  onRefresh: () => void
  onRemove: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const sig = entry?.data.signals
  const recs = entry?.data.recommendations ?? []
  const topRec = recs[0]

  const priceChange = sig?.price_change ?? 0
  const priceChangePct = sig?.price_change_pct ?? 0
  const priceColor = priceChange >= 0 ? 'text-emerald-400' : 'text-red-400'

  const biasColor =
    sig?.directional_bias?.includes('Bullish') ? 'text-emerald-400' :
    sig?.directional_bias?.includes('Bearish') ? 'text-red-400' : 'text-amber-400'

  const ivColor =
    (sig?.iv_rank ?? 0) >= 70 ? 'text-red-400' :
    (sig?.iv_rank ?? 0) >= 40 ? 'text-amber-400' : 'text-emerald-400'

  return (
    <div className={`bg-gray-900 border rounded-2xl overflow-hidden transition-colors
      ${refreshing ? 'border-blue-800/50' : 'border-gray-800 hover:border-gray-700'}`}>

      {/* Main row */}
      <div className="grid grid-cols-2 gap-3 px-4 py-3 sm:flex sm:items-center sm:flex-wrap">

        {/* Ticker + company */}
        <div className="min-w-0 sm:w-28 sm:shrink-0">
          <div className="font-semibold text-white text-sm tracking-tight">{item.ticker}</div>
          <div className="text-xs text-gray-500 truncate sm:max-w-[110px]">
            {item.companyName ?? entry?.data.company_name ?? '—'}
          </div>
        </div>

        {/* Price */}
        <div className="min-w-0 text-right sm:text-left sm:w-24 sm:shrink-0">
          {sig ? (
            <>
              <div className="text-sm font-semibold text-white">${sig.current_price.toFixed(2)}</div>
              <div className={`text-xs font-medium ${priceColor}`}>
                {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)} ({priceChangePct.toFixed(1)}%)
              </div>
            </>
          ) : (
            <div className="text-xs text-gray-600">—</div>
          )}
        </div>

        {/* Freshness on phone */}
        <div className="flex items-center sm:hidden">
          <FreshnessBadge entry={entry} refreshing={refreshing} />
        </div>

        {/* Bias on phone */}
        <div className="text-right sm:hidden">
          {sig ? (
            <>
              <div className={`text-xs font-semibold ${biasColor}`}>{sig.directional_bias}</div>
              <div className="text-xs text-gray-500">{sig.bias_confidence}% conf.</div>
            </>
          ) : <div className="text-xs text-gray-600">Not analyzed</div>}
        </div>

        {/* IV Rank */}
        <div className="w-20 shrink-0 hidden sm:block">
          {sig ? (
            <>
              <div className={`text-sm font-semibold ${ivColor}`}>{sig.iv_rank.toFixed(0)}%</div>
              <div className="text-xs text-gray-500">IV Rank</div>
            </>
          ) : <div className="text-xs text-gray-600">—</div>}
        </div>

        {/* Bias */}
        <div className="w-24 shrink-0 hidden md:block">
          {sig ? (
            <>
              <div className={`text-xs font-semibold ${biasColor}`}>{sig.directional_bias}</div>
              <div className="text-xs text-gray-500">{sig.bias_confidence}% conf.</div>
            </>
          ) : <div className="text-xs text-gray-600">—</div>}
        </div>

        {/* Top recommendation */}
        <div className="flex-1 hidden lg:block min-w-0">
          {topRec ? (
            <div className="text-xs">
              <span className="text-violet-300 font-semibold">{topRec.strategy}</span>
              <span className="text-gray-500 ml-1.5">
                +${(topRec.max_profit * 100).toFixed(0)} max · {(topRec.prob_of_profit * 100).toFixed(0)}% PoP
              </span>
            </div>
          ) : (
            <div className="text-xs text-gray-600">{entry ? 'No trades passed filters' : 'Not analyzed'}</div>
          )}
        </div>

        {/* Freshness */}
        <div className="w-28 shrink-0 hidden sm:flex justify-end">
          <FreshnessBadge entry={entry} refreshing={refreshing} />
        </div>

        {/* Actions */}
        <div className="col-span-2 grid grid-cols-[1fr_auto_auto_auto] gap-1.5 sm:flex sm:items-center sm:shrink-0">
          <button
            type="button"
            onClick={onAnalyze}
            aria-label={`Analyze ${item.ticker}`}
            title="Analyze ticker"
            className="inline-flex h-9 w-9 items-center justify-center bg-violet-600/20 hover:bg-violet-600/40
                       border border-violet-700/50 text-violet-300 rounded-xl transition-colors shrink-0"
          >
            <TrendingUp size={16} />
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Refresh ticker data"
            title="Refresh"
            className="inline-flex h-9 w-9 items-center justify-center bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400
                       hover:text-gray-200 rounded-xl transition-colors disabled:opacity-40 shrink-0"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          </button>
          {entry && (
            <button
              onClick={() => setExpanded(e => !e)}
              title={expanded ? 'Collapse' : 'Expand details'}
              className="p-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400
                         hover:text-gray-200 rounded-xl transition-colors"
            >
              {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
          )}
          <button
            onClick={onRemove}
            title="Remove"
            className="p-1.5 bg-gray-800 hover:bg-red-900/30 border border-gray-700
                       text-gray-500 hover:text-red-400 rounded-xl transition-colors"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Expanded detail strip */}
      {expanded && entry && (
        <div className="border-t border-gray-800 px-4 py-3 bg-gray-800/30">
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3 text-xs">
            {[
              { label: 'RSI',         value: entry.data.signals.rsi.toFixed(1),                              note: entry.data.signals.rsi_signal },
              { label: 'MACD',        value: entry.data.signals.macd.toFixed(3),                             note: entry.data.signals.macd_crossover },
              { label: 'MA Trend',    value: entry.data.signals.trend,                                       note: entry.data.signals.trend_strength },
              { label: 'IV Env',      value: entry.data.signals.iv_environment,                              note: `HV20: ${(entry.data.signals.hv_20 * 100).toFixed(0)}%` },
              { label: 'Put/Call',    value: entry.data.signals.put_call_ratio.toFixed(2),                   note: entry.data.signals.pcr_signal },
              { label: 'Cached',      value: cacheAge(entry) === 0 ? 'Just now' : `${cacheAge(entry)}m ago`, note: new Date(entry.timestamp).toLocaleTimeString() },
            ].map(m => (
              <div key={m.label} className="bg-gray-800 rounded-xl px-3 py-2">
                <div className="text-gray-500 mb-0.5">{m.label}</div>
                <div className="text-gray-200 font-semibold">{m.value}</div>
                <div className="text-gray-600">{m.note}</div>
              </div>
            ))}
          </div>

          {/* Recommendations mini-list */}
          {entry.data.recommendations.length > 0 && (
            <div className="mt-3 space-y-1.5">
              <div className="text-xs text-gray-500 font-semibold uppercase tracking-wide">Recommendations</div>
              {entry.data.recommendations.slice(0, 3).map(rec => (
                <div key={rec.rank} className="flex items-center justify-between bg-gray-800 rounded-xl px-3 py-2 text-xs">
                  <span className="text-violet-300 font-semibold w-36 truncate">{rec.strategy}</span>
                  <span className="text-gray-400 hidden sm:block">{rec.expiry} · {rec.dte}d</span>
                  <span className="text-emerald-400 font-medium">+${(rec.max_profit * 100).toFixed(0)}</span>
                  <span className="text-red-400 font-medium hidden md:block">-${(rec.max_loss * 100).toFixed(0)}</span>
                  <span className="text-gray-300">{(rec.prob_of_profit * 100).toFixed(0)}% PoP</span>
                  <span className="text-gray-500">Score {rec.scores.total_score}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function WatchlistPage() {
  const {
    watchlist, watchlistMax, removeFromWatchlist, addToWatchlist,
    requestAnalysis, getCached, refreshTicker, refreshingTickers, lastBgRefresh, refreshWatchlistForAlerts,
  } = useApp()

  const [search,    setSearch]    = useState('')
  const [addTicker, setAddTicker] = useState('')
  const [addNotes,  setAddNotes]  = useState('')
  const [showAdd,   setShowAdd]   = useState(false)
  const [sortKey,   setSortKey]   = useState<SortKey>('ticker')
  const [sortDir,   setSortDir]   = useState<SortDir>('asc')

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const sorted = useMemo(() => {
    const query = search.trim().toLowerCase()
    const filtered = watchlist.filter(w =>
      w.ticker.toLowerCase().includes(query) ||
      (w.companyName?.toLowerCase().includes(query) ?? false)
    )

    const valueFor = (item: WatchlistItem): string | number | null => {
      const entry = getCached(item.ticker)
      const sig = entry?.data.signals
      const topRec = entry?.data.recommendations[0]

      switch (sortKey) {
        case 'ticker':
          return item.ticker
        case 'price':
          return sig?.current_price ?? item.lastPrice ?? null
        case 'iv':
          return sig?.iv_rank ?? null
        case 'bias':
          return sig?.directional_bias ?? null
        case 'topRec':
          return topRec?.strategy ?? null
        case 'cached':
          return entry ? Date.now() - entry.timestamp : null
      }
    }

    return [...filtered].sort((a, b) => {
      const av = valueFor(a)
      const bv = valueFor(b)
      if (av == null && bv == null) return a.ticker.localeCompare(b.ticker)
      if (av == null) return 1
      if (bv == null) return -1

      const result = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv))

      return sortDir === 'asc' ? result : -result
    })
  }, [getCached, search, sortDir, sortKey, watchlist])

  const grouped = useMemo(() => {
    const groups = new Map<string, WatchlistItem[]>()

    for (const item of sorted) {
      const ticker = item.ticker.toUpperCase()
      const entry  = getCached(ticker)
      const cat    = getCategory(ticker, item.sector ?? entry?.data.sector)
      groups.set(cat, [...(groups.get(cat) ?? []), item])
    }

    // Sort: AI Radar categories in defined order first, then any sector labels alphabetically
    return Array.from(groups.entries())
      .sort(([a], [b]) => {
        const ai = ALL_CATEGORIES as readonly string[]
        const ia = ai.indexOf(a as AICategory)
        const ib = ai.indexOf(b as AICategory)
        if (ia !== -1 && ib !== -1) return ia - ib   // both are AI categories → keep order
        if (ia !== -1) return -1                       // a is AI, b is sector → a first
        if (ib !== -1) return 1
        if (a === 'Other') return 1                    // Other always last
        if (b === 'Other') return -1
        return a.localeCompare(b)
      })
      .map(([cat, items]) => ({ cat, items }))
  }, [getCached, sorted])

  const handleAdd = () => {
    const t = addTicker.trim().toUpperCase()
    if (!t) return
    if (!addToWatchlist({ ticker: t, notes: addNotes.trim() || undefined })) return
    setAddTicker('')
    setAddNotes('')
    setShowAdd(false)
  }

  const cachedCount  = watchlist.filter(w => !!getCached(w.ticker)).length
  const staleCount   = watchlist.filter(w => { const e = getCached(w.ticker); return e && !isCacheFresh(e) }).length
  const anyRefreshing = refreshingTickers.size > 0

  const refreshAll = () => {
    refreshWatchlistForAlerts()
  }

  return (
    <div className="watchlist-page min-h-screen p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-white flex items-center gap-2">
              <Star className="text-amber-400" size={22} />
              Watchlist
            </h1>
            <div className="flex items-center gap-3 mt-0.5">
              <span className="text-sm text-gray-500">
                {watchlist.length} of {watchlistMax} ticker{watchlist.length !== 1 ? 's' : ''}
              </span>
              {cachedCount > 0 && (
                <span className="text-xs text-gray-600">· {cachedCount} cached</span>
              )}
              {staleCount > 0 && (
                <span className="flex items-center gap-1 text-xs text-amber-600">
                  <AlertTriangle size={10} /> {staleCount} stale
                </span>
              )}
              {lastBgRefresh && (
                <span className="flex items-center gap-1 text-xs text-gray-600">
                  <Clock size={10} />
                  Auto-refresh: {new Date(lastBgRefresh).toLocaleTimeString()}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {cachedCount > 0 && (
              <button
                type="button"
                onClick={refreshAll}
                disabled={anyRefreshing}
                aria-label="Refresh all cached watchlist tickers"
                title="Refresh all cached tickers"
                className="inline-flex h-10 w-10 items-center justify-center bg-gray-800 border border-gray-700
                           text-gray-400 hover:text-gray-200 hover:border-gray-600 rounded-xl
                           transition-colors disabled:opacity-50 shrink-0"
              >
                <RefreshCw size={18} className={anyRefreshing ? 'animate-spin' : ''} />
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowAdd(s => !s)}
              aria-label={showAdd ? 'Close add ticker form' : 'Add ticker to watchlist'}
              title={showAdd ? 'Close' : 'Add ticker'}
              className="inline-flex h-10 w-10 items-center justify-center bg-violet-600 hover:bg-violet-500
                         text-white rounded-xl transition-colors shrink-0"
            >
              <Plus size={20} strokeWidth={2.5} />
            </button>
          </div>
        </div>

        {/* Add ticker form */}
        {showAdd && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
            <div className="text-sm font-semibold text-gray-300">Add to Watchlist</div>
            <div className="flex gap-3 flex-wrap">
              <input
                value={addTicker}
                onChange={e => setAddTicker(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                placeholder="AAPL"
                className="w-28 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white font-mono
                           text-sm uppercase placeholder-gray-600 focus:outline-none focus:border-violet-500"
              />
              <input
                value={addNotes}
                onChange={e => setAddNotes(e.target.value)}
                placeholder="Notes (optional)"
                className="flex-1 min-w-40 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white
                           text-sm placeholder-gray-600 focus:outline-none focus:border-violet-500"
              />
              <button
                type="button"
                onClick={handleAdd}
                aria-label="Add ticker to watchlist"
                title="Add to watchlist"
                className="inline-flex h-10 w-10 items-center justify-center bg-violet-600 hover:bg-violet-500 text-white rounded-xl transition-colors shrink-0"
              >
                <Plus size={20} strokeWidth={2.5} />
              </button>
              <button onClick={() => setShowAdd(false)}
                className="px-4 py-2 bg-gray-800 text-gray-400 text-sm rounded-xl hover:bg-gray-700 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Column headers */}
        {watchlist.length > 0 && (
          <div className="hidden sm:flex items-center gap-3 px-4 py-1.5 text-xs font-semibold text-gray-600 uppercase tracking-wide">
            <SortHeader label="Ticker" sortKey="ticker" activeKey={sortKey} dir={sortDir} onSort={handleSort} className="w-28 shrink-0 flex" />
            <SortHeader label="Price" sortKey="price" activeKey={sortKey} dir={sortDir} onSort={handleSort} className="w-24 shrink-0 flex" />
            <SortHeader label="IV Rank" sortKey="iv" activeKey={sortKey} dir={sortDir} onSort={handleSort} className="w-20 shrink-0 hidden sm:flex" />
            <SortHeader label="Bias" sortKey="bias" activeKey={sortKey} dir={sortDir} onSort={handleSort} className="w-24 shrink-0 hidden md:flex" />
            <SortHeader label="Top Rec" sortKey="topRec" activeKey={sortKey} dir={sortDir} onSort={handleSort} className="flex-1 hidden lg:flex" />
            <SortHeader label="Cached" sortKey="cached" activeKey={sortKey} dir={sortDir} onSort={handleSort} className="w-28 shrink-0 hidden sm:flex justify-end text-right" />
            <div className="w-36 shrink-0 text-right">Actions</div>
          </div>
        )}

        {/* Search */}
        {watchlist.length > 3 && (
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search tickers or companies…"
              className="w-full bg-gray-900 border border-gray-800 rounded-xl pl-8 pr-4 py-2.5 text-sm
                         text-white placeholder-gray-600 focus:outline-none focus:border-violet-500"
            />
          </div>
        )}

        {/* Empty state */}
        {watchlist.length === 0 && (
          <div className="text-center py-20 space-y-3">
            <div className="text-5xl">⭐</div>
            <div className="text-lg font-semibold text-gray-300">Your watchlist is empty</div>
            <div className="text-gray-500 text-sm max-w-sm mx-auto">
              Add tickers here or click <strong className="text-amber-400">Add to Watchlist</strong> after running an analysis.
            </div>
            <button
              onClick={() => requestAnalysis('SPY')}
              className="mt-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              Try SPY
            </button>
          </div>
        )}

        {/* Ticker rows grouped by AI Radar category */}
        <div className="space-y-4">
          {grouped.map(group => {
            const catBadge = group.cat in CATEGORY_BADGE
              ? CATEGORY_BADGE[group.cat as AICategory]
              : 'bg-gray-800 text-gray-400 border-gray-700'
            return (
              <section key={group.cat} className="space-y-2">
                <div className="flex items-center gap-2 px-1">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${catBadge}`}>
                    {group.cat}
                  </span>
                  <span className="text-[10px] font-medium text-gray-600 bg-gray-800 border border-gray-700 rounded-full px-2 py-0.5">
                    {group.items.length}
                  </span>
                  <div className="h-px flex-1 bg-gray-800/70" />
                </div>
                <div className="space-y-2">
                  {group.items.map(item => (
                    <TickerRow
                      key={item.ticker}
                      item={item}
                      entry={getCached(item.ticker)}
                      refreshing={refreshingTickers.has(item.ticker)}
                      onAnalyze={() => requestAnalysis(item.ticker)}
                      onRefresh={() => refreshTicker(item.ticker)}
                      onRemove={() => removeFromWatchlist(item.ticker)}
                    />
                  ))}
                </div>
              </section>
            )
          })}
        </div>

        {watchlist.length > 0 && sorted.length === 0 && (
          <div className="text-center py-12 text-gray-500 text-sm">
            No tickers matching "<span className="text-gray-300">{search}</span>"
          </div>
        )}

        {/* Auto-refresh legend */}
        {watchlist.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-gray-600 justify-center pt-2 border-t border-gray-800/50">
            <Clock size={11} />
            Prices auto-refresh every 15 minutes for analyzed tickers
          </div>
        )}
      </div>
    </div>
  )
}
