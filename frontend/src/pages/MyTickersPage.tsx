import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, Trash2, X, Search, AlertTriangle, Check, Undo2, RefreshCw,
  Pencil, ChevronDown, Calendar, ArrowUpRight, ListTodo,
} from 'lucide-react'
import { fetchMyTickers, addMyTicker, updateMyTicker, removeMyTicker, removeMyTickerType, searchTickers } from '../api/commandCenter'
import type { MyTickerEntry, SearchTickerResult } from '../api/commandCenter'
import { TICKER_UNIVERSE } from '../data/tickerUniverse'
import type { TickerEntry } from '../data/tickerUniverse'
import { getEngineRoute } from '../routing/routes'

type TabFilter = 'all' | 'day' | 'swing' | 'regular'
const TAB_STORAGE_KEY = 'oa_my_tickers_tab'

function axiosErrorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>
    if (e.response && typeof e.response === 'object') {
      const r = e.response as Record<string, unknown>
      if (r.data && typeof r.data === 'object') {
        const d = r.data as Record<string, unknown>
        if (typeof d.detail === 'string') return d.detail
      }
    }
    if (e.message && typeof e.message === 'string') return e.message
  }
  return 'Something went wrong'
}

function localLoad<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v !== null ? (JSON.parse(v) as T) : fallback
  } catch { return fallback }
}

function localSave(key: string, val: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(val)) } catch {}
}

const TRADE_TYPE_META: Record<string, { label: string; desc: string; badgeClass: string }> = {
  day: {
    label: 'Day',
    desc: '0–1 DTE \u00B7 scalp \u00B7 tight strikes',
    badgeClass: 'oa-tt-day',
  },
  swing: {
    label: 'Swing',
    desc: '2–21 DTE \u00B7 directional \u00B7 momentum',
    badgeClass: 'oa-tt-swing',
  },
  regular: {
    label: 'Regular',
    desc: 'Monthly \u00B7 income \u00B7 spreads',
    badgeClass: 'oa-tt-regular',
  },
}

const AVATAR_COLORS: { letters: string; bg: string; text: string }[] = [
  { letters: 'ABCDE', bg: 'bg-blue-600/30', text: 'text-blue-300' },
  { letters: 'FGHIJ', bg: 'bg-teal-600/30', text: 'text-teal-300' },
  { letters: 'KLMNO', bg: 'bg-purple-600/30', text: 'text-purple-300' },
  { letters: 'PQRST', bg: 'bg-amber-600/30', text: 'text-amber-300' },
  { letters: 'UVWXYZ', bg: 'bg-rose-600/30', text: 'text-rose-300' },
]

function avatarFor(symbol: string) {
  const c = symbol.charAt(0).toUpperCase()
  const palette = AVATAR_COLORS.find(p => p.letters.includes(c)) || AVATAR_COLORS[0]
  const initials = symbol.length >= 2 ? symbol.slice(0, 2).toUpperCase() : c
  return { initials, bg: palette.bg, text: palette.text }
}

function badgeBase(tradeType: string): string {
  return TRADE_TYPE_META[tradeType]?.badgeClass || 'bg-gray-700 text-gray-300'
}

const TABS: { key: TabFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'day', label: 'Day' },
  { key: 'swing', label: 'Swing' },
  { key: 'regular', label: 'Regular' },
]

export default function MyTickersPage() {
  const navigate = useNavigate()

  const [tickers, setTickers] = useState<MyTickerEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabFilter>(() => localLoad<TabFilter>(TAB_STORAGE_KEY, 'all'))
  const [notice, setNotice] = useState<{ tone: string; message: string } | null>(null)
  const [snackbar, setSnackbar] = useState<{ message: string; ticker: MyTickerEntry; timeoutId: number } | null>(null)
  const [highlightSymbol, setHighlightSymbol] = useState<string | null>(null)

  const [showAddModal, setShowAddModal] = useState(false)
  const [showRemoveSheet, setShowRemoveSheet] = useState(false)
  const [showEditSheet, setShowEditSheet] = useState(false)
  const [selectedTicker, setSelectedTicker] = useState<MyTickerEntry | null>(null)
  const [removeChecked, setRemoveChecked] = useState<Set<string>>(new Set())
  const [editChecked, setEditChecked] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetchMyTickers()
      setTickers(res.data?.tickers || [])
    } catch (err) {
      setError(axiosErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const handleTabChange = useCallback((tab: TabFilter) => {
    setActiveTab(tab)
    localSave(TAB_STORAGE_KEY, tab)
  }, [])

  const filteredTickers = useMemo(() => {
    if (activeTab === 'all') return tickers
    return tickers.filter(t => (t.trade_types || []).includes(activeTab))
  }, [tickers, activeTab])

  const noticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showNotice = useCallback((tone: string, message: string) => {
    setNotice({ tone, message })
    if (noticeTimeoutRef.current) clearTimeout(noticeTimeoutRef.current)
    noticeTimeoutRef.current = setTimeout(() => setNotice(null), 4000)
  }, [])

  const handleRemove = useCallback((ticker: MyTickerEntry) => {
    const types = ticker.trade_types || []
    if (types.length <= 1) {
      setTickers(prev => prev.filter(t => t.symbol !== ticker.symbol))
      removeMyTicker(ticker.symbol).catch(err => {
        showNotice('warning', `Failed to remove ${ticker.symbol}: ${axiosErrorMessage(err)}`)
        void load()
      })
      const id = window.setTimeout(() => {
        setSnackbar(null)
      }, 5000)
      setSnackbar({ message: `${ticker.symbol} removed.`, ticker, timeoutId: id })
    } else {
      setSelectedTicker(ticker)
      setRemoveChecked(new Set(types))
      setShowRemoveSheet(true)
    }
  }, [load, showNotice])

  const handleUndo = useCallback(() => {
    if (!snackbar) return
    clearTimeout(snackbar.timeoutId)
    const t = snackbar.ticker
    setTickers(prev => [t, ...prev])
    addMyTicker({ symbol: t.symbol, company_name: t.company_name, trade_types: t.trade_types || [] }).catch(err => {
      showNotice('warning', `Undo failed: ${axiosErrorMessage(err)}`)
      void load()
    })
    setSnackbar(null)
  }, [snackbar, load, showNotice])

  const handleConfirmRemove = useCallback(async () => {
    if (!selectedTicker) return
    const types = selectedTicker.trade_types || []
    const toRemove = types.filter(t => removeChecked.has(t))
    if (toRemove.length === 0) return

    if (toRemove.length === types.length) {
      setTickers(prev => prev.filter(t => t.symbol !== selectedTicker.symbol))
      removeMyTicker(selectedTicker.symbol).catch(err => {
        showNotice('warning', `Failed to remove ${selectedTicker.symbol}: ${axiosErrorMessage(err)}`)
        void load()
      })
      const id = window.setTimeout(() => setSnackbar(null), 5000)
      setSnackbar({ message: `${selectedTicker.symbol} removed.`, ticker: selectedTicker, timeoutId: id })
    } else {
      const kept = types.filter(t => !removeChecked.has(t))
      setTickers(prev => prev.map(t => t.symbol === selectedTicker.symbol ? { ...t, trade_types: kept } : t))
      try {
        await updateMyTicker(selectedTicker.symbol, { trade_types: kept })
      } catch (err) {
        showNotice('warning', `Failed to update ${selectedTicker.symbol}: ${axiosErrorMessage(err)}`)
        void load()
      }
      showNotice('success', `${selectedTicker.symbol} updated.`)
    }

    setShowRemoveSheet(false)
    setSelectedTicker(null)
  }, [selectedTicker, removeChecked, load, showNotice])

  const handleEdit = useCallback((ticker: MyTickerEntry) => {
    setSelectedTicker(ticker)
    setEditChecked(new Set(ticker.trade_types || []))
    setShowEditSheet(true)
  }, [])

  const handleSaveEdit = useCallback(async () => {
    if (!selectedTicker) return
    const newTypes = Array.from(editChecked)
    if (newTypes.length === 0) return

    setTickers(prev => prev.map(t => t.symbol === selectedTicker.symbol ? { ...t, trade_types: newTypes } : t))
    try {
      await updateMyTicker(selectedTicker.symbol, { trade_types: newTypes })
      showNotice('success', `${selectedTicker.symbol} updated.`)
    } catch (err) {
      showNotice('warning', `Failed to update ${selectedTicker.symbol}: ${axiosErrorMessage(err)}`)
      void load()
    }
    setShowEditSheet(false)
    setSelectedTicker(null)
  }, [selectedTicker, editChecked, load, showNotice])

  const handleAddTicker = useCallback(async (symbol: string, companyName: string, tradeTypes: string[]) => {
    try {
      const res = await addMyTicker({ symbol, company_name: companyName, trade_types: tradeTypes })
      setTickers(res.data?.tickers || [])
      setHighlightSymbol(symbol.toUpperCase())
      setTimeout(() => setHighlightSymbol(null), 1500)
      showNotice('success', `${symbol.toUpperCase()} added to My Tickers.`)
      setShowAddModal(false)
    } catch (err) {
      showNotice('warning', `Something went wrong \u2014 ${symbol} not saved. Try again: ${axiosErrorMessage(err)}`)
    }
  }, [showNotice])

  return (
    <div className="mx-auto min-h-screen max-w-6xl space-y-4 p-4 md:p-6 text-primary">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-sky-600/20 border border-sky-700 flex items-center justify-center shrink-0">
              <ListTodo size={18} className="text-sky-400" />
            </div>
            <h1 className="tcc-hero-title text-2xl font-bold tracking-tight text-heading sm:text-3xl">My Tickers</h1>
          </div>
          <p className="mt-1 text-sm text-gray-400">{tickers.length} ticker{tickers.length !== 1 ? 's' : ''} tracked</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setShowAddModal(true)} className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-500"><Plus size={16} /> Add</button>
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-full border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh</button>
        </div>
      </header>

      {notice && (
        <div className={`flex items-start justify-between gap-3 rounded-[24px] border px-4 py-3 text-sm ${notice.tone === 'success' ? 'border-semantic-bullish-border bg-semantic-bullish-bg text-semantic-bullish' : notice.tone === 'warning' ? 'border-semantic-bearish-border bg-semantic-bearish-bg text-semantic-bearish' : 'border-semantic-info-border bg-semantic-info-bg text-semantic-info'}`}>
          <div>{notice.message}</div>
          <button type="button" onClick={() => setNotice(null)} className="shrink-0 opacity-60 hover:opacity-100"><X size={16} /></button>
        </div>
      )}

      <div className="flex gap-1 border-b border-gray-800 pb-0">
        {TABS.map(tab => (
          <button key={tab.key} type="button" onClick={() => handleTabChange(tab.key)} className={`px-4 py-2 text-sm font-medium transition-colors ${activeTab === tab.key ? 'border-b-2 border-violet-500 text-violet-400' : 'text-gray-500 hover:text-gray-300'}`}>
            {tab.label}
          </button>
        ))}
      </div>

      {loading && tickers.length === 0 ? (
        <div className="flex items-center justify-center py-20 text-sm text-gray-500">Loading tickers...</div>
      ) : error ? (
        <div className="flex items-center justify-center py-20 text-sm text-red-400">{error}</div>
      ) : filteredTickers.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-gray-500">
          <Search size={32} className="opacity-40" />
          <p className="text-sm">
            {activeTab === 'all'
              ? 'No tickers here'
              : `No ${TRADE_TYPE_META[activeTab]?.label || activeTab} tickers yet \u2014 add one or update an existing ticker\u2019s trade types`}
          </p>
          {activeTab === 'all' && (
            <button type="button" onClick={() => setShowAddModal(true)} className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500"><Plus size={16} /> Add your first ticker</button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredTickers.map((ticker, idx) => (
            <TickerRow
              key={ticker.symbol}
              ticker={ticker}
              highlight={highlightSymbol === ticker.symbol}
              onRemove={() => handleRemove(ticker)}
              onEdit={() => handleEdit(ticker)}
            />
          ))}
        </div>
      )}

      <AddModal open={showAddModal} onClose={() => setShowAddModal(false)} onAdd={handleAddTicker} existingSymbols={new Set(tickers.map(t => t.symbol.toUpperCase()))} />

      {showRemoveSheet && selectedTicker && (
        <RemoveSheet ticker={selectedTicker} checked={removeChecked} onChange={setRemoveChecked} onConfirm={handleConfirmRemove} onCancel={() => { setShowRemoveSheet(false); setSelectedTicker(null) }} />
      )}

      {showEditSheet && selectedTicker && (
        <EditSheet ticker={selectedTicker} checked={editChecked} onChange={setEditChecked} onSave={handleSaveEdit} onCancel={() => { setShowEditSheet(false); setSelectedTicker(null) }} />
      )}

      {snackbar && (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl bg-[#2C2C2A] px-4 py-3 text-sm text-white shadow-lg">
          <span>{snackbar.message}</span>
          <button type="button" onClick={handleUndo} className="flex items-center gap-1 font-medium text-blue-400 hover:text-blue-300"><Undo2 size={14} /> Undo</button>
        </div>
      )}
    </div>
  )
}

function TickerRow({ ticker, highlight, onRemove, onEdit }: { ticker: MyTickerEntry; highlight: boolean; onRemove: () => void; onEdit: () => void }) {
  const navigate = useNavigate()
  const avatar = avatarFor(ticker.symbol)
  const types = ticker.trade_types || []
  const ed = ticker.next_earnings_date
  const edDays = ticker.next_earnings_days
  const earningsThisWeek = edDays != null && edDays >= 0 && edDays <= 7

  const ENGINE_LABEL: Record<string, string> = {
    day: 'Day Trade',
    swing: 'Swing Trade',
    regular: 'Strategy Finder',
  }

  return (
    <div className={`flex items-center justify-between gap-4 rounded-xl border px-4 py-3 transition-colors ${highlight ? 'animate-pulse border-green-600/50 bg-green-900/20' : earningsThisWeek ? 'border-yellow-700/50 bg-yellow-900/15' : 'border-gray-800 bg-gray-900/60'}`}>
      <div className="flex min-w-0 items-center gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold ${avatar.bg} ${avatar.text}`}>{avatar.initials}</div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white">{ticker.symbol}</span>
            <button type="button" onClick={onEdit} className="text-gray-500 hover:text-gray-300"><Pencil size={12} /></button>
          </div>
          {ticker.company_name && <div className="truncate text-xs text-gray-500">{ticker.company_name}</div>}
          {ed && (
            <div className={`mt-0.5 flex items-center gap-1 text-[10px] ${earningsThisWeek ? 'font-semibold text-yellow-400' : 'text-gray-600'}`}>
              <Calendar size={10} />
              <span>Earnings {ed}{edDays != null ? ` (${edDays}d)` : ''}</span>
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex gap-1">
          {types.map(tt => (
            <button
              key={tt}
              type="button"
              onClick={() => navigate(getEngineRoute(tt, ticker.symbol))}
              title={`Open ${ticker.symbol} in ${ENGINE_LABEL[tt] ?? tt}`}
              className={`inline-flex items-center gap-0.5 rounded px-2 py-0.5 text-[10px] font-medium transition-all hover:brightness-125 hover:scale-105 ${badgeBase(tt)}`}
            >
              {TRADE_TYPE_META[tt]?.label || tt}
              <ArrowUpRight size={9} className="opacity-70" />
            </button>
          ))}
        </div>
        <button type="button" onClick={onRemove} className="ml-2 shrink-0 rounded-lg p-1.5 text-gray-500 hover:bg-gray-800 hover:text-red-400"><Trash2 size={15} /></button>
      </div>
    </div>
  )
}

function AddModal({ open, onClose, onAdd, existingSymbols }: { open: boolean; onClose: () => void; onAdd: (symbol: string, company: string, types: string[]) => void; existingSymbols: Set<string> }) {
  const [query, setQuery] = useState('')
  const [selectedResult, setSelectedResult] = useState<TickerEntry | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null)
  const [remoteResults, setRemoteResults] = useState<SearchTickerResult[]>([])
  const [remoteLoading, setRemoteLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const remoteIdRef = useRef(0)

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedResult(null)
      setChecked(new Set())
      setDuplicateWarning(null)
      setBusy(false)
      setRemoteResults([])
      setRemoteLoading(false)
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open])

  const localResults = useMemo(() => {
    if (!query.trim()) return []
    const q = query.trim().toLowerCase()
    return TICKER_UNIVERSE.filter(e => e.symbol.toLowerCase().includes(q) || e.company.toLowerCase().includes(q)).slice(0, 30)
  }, [query])

  useEffect(() => {
    if (!query.trim() || localResults.length > 0) {
      setRemoteResults([])
      setRemoteLoading(false)
      return
    }
    setRemoteLoading(true)
    const id = ++remoteIdRef.current
    const timer = setTimeout(async () => {
      try {
        const env = await searchTickers(query.trim())
        if (id === remoteIdRef.current) {
          setRemoteResults(env.data?.results ?? [])
        }
      } catch {
        if (id === remoteIdRef.current) setRemoteResults([])
      } finally {
        if (id === remoteIdRef.current) setRemoteLoading(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [query, localResults.length])

  const allResults = useMemo(() => {
    if (!query.trim()) return []
    const seen = new Set(localResults.map(r => r.symbol.toUpperCase()))
    const remote = remoteResults.filter(r => !seen.has(r.symbol.toUpperCase()))
    return [...localResults, ...remote]
  }, [localResults, remoteResults, query])

  const handleSelect = (entry: TickerEntry) => {
    const sym = entry.symbol.toUpperCase()
    if (existingSymbols.has(sym)) {
      setDuplicateWarning(`${sym} is already in My Tickers \u2014 edit its trade types instead`)
      setSelectedResult(null)
      return
    }
    setDuplicateWarning(null)
    setSelectedResult(entry)
  }

  const handleAdd = async () => {
    if (!selectedResult || checked.size === 0) return
    setBusy(true)
    await onAdd(selectedResult.symbol, selectedResult.company, Array.from(checked))
    setBusy(false)
    onClose()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 pt-12" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-gray-800 bg-gray-900 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-800 px-5 py-4">
          <h2 className="text-base font-semibold text-white">Add ticker</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-gray-500 hover:bg-gray-800 hover:text-white"><X size={18} /></button>
        </div>

        <div className="p-5">
          {!selectedResult ? (
            <>
              <input
                ref={inputRef}
                type="text"
                placeholder="Search by symbol or company name..."
                value={query}
                onChange={e => setQuery(e.target.value)}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:border-violet-500"
              />
              {duplicateWarning && (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-800/50 bg-amber-900/20 px-3 py-2 text-xs text-amber-400">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>{duplicateWarning}</span>
                </div>
              )}
              {allResults.length > 0 && (
                <div className="mt-3 max-h-60 space-y-1 overflow-y-auto">
                  {allResults.map(entry => (
                    <button key={entry.symbol} type="button" onClick={() => handleSelect(entry)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-gray-800">
                      <span className="text-sm font-semibold text-white">{entry.symbol}</span>
                      <span className="text-xs text-gray-500">{entry.company}</span>
                      <span className="ml-auto text-[10px] text-gray-600">{entry.sector}</span>
                    </button>
                  ))}
                </div>
              )}
              {remoteLoading && (
                <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-violet-400 border-t-transparent" />
                  Searching Yahoo Finance...
                </div>
              )}
              {query.trim() && !remoteLoading && allResults.length === 0 && (
                <p className="mt-3 text-xs text-gray-500">No results for &lsquo;{query.trim()}&rsquo;.</p>
              )}
            </>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-lg bg-gray-800/60 px-3 py-2">
                <span className="text-sm font-semibold text-white">{selectedResult.symbol}</span>
                <span className="text-xs text-gray-400">{selectedResult.company}</span>
                <span className="ml-auto text-[10px] text-gray-600">{selectedResult.sector}</span>
                <button type="button" onClick={() => setSelectedResult(null)} className="text-gray-500 hover:text-gray-300"><X size={14} /></button>
              </div>
              <p className="text-xs font-medium text-gray-400">Select trade types:</p>
              {['day', 'swing', 'regular'].map(tt => (
                <label key={tt} className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-800 px-3 py-2.5 hover:bg-gray-800/50">
                  <input type="checkbox" checked={checked.has(tt)} onChange={() => setChecked(prev => { const next = new Set(prev); next.has(tt) ? next.delete(tt) : next.add(tt); return next })} className="h-4 w-4 accent-violet-500" />
                  <div className="min-w-0 flex-1">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${badgeBase(tt)}`}>{TRADE_TYPE_META[tt]?.label || tt}</span>
                    <span className="ml-2 text-xs text-gray-500">{TRADE_TYPE_META[tt]?.desc}</span>
                  </div>
                </label>
              ))}
              <button type="button" disabled={checked.size === 0 || busy} onClick={handleAdd} className={`mt-2 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium ${checked.size === 0 ? 'cursor-not-allowed bg-gray-800 text-gray-500' : 'bg-violet-600 text-white hover:bg-violet-500'}`}>
                {busy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-violet-200 border-t-transparent" /> : <Plus size={16} />}
                Add {selectedResult.symbol.toUpperCase()}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function RemoveSheet({ ticker, checked, onChange, onConfirm, onCancel }: { ticker: MyTickerEntry; checked: Set<string>; onChange: (c: Set<string>) => void; onConfirm: () => void; onCancel: () => void }) {
  const types = ticker.trade_types || []
  const allChecked = types.every(t => checked.has(t))
  const someChecked = types.some(t => checked.has(t))
  const noneChecked = !someChecked

  const label = allChecked ? `Remove ${ticker.symbol} entirely` : someChecked ? `Remove ${types.filter(t => checked.has(t)).map(t => TRADE_TYPE_META[t]?.label || t).join(' + ')}` : ''

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={onCancel}>
      <div className="w-full max-w-md rounded-t-2xl border border-gray-800 bg-gray-900 px-5 pb-8 pt-3" onClick={e => e.stopPropagation()}>
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-gray-700" />
        <h3 className="text-base font-semibold text-white">Remove {ticker.symbol} from My Tickers</h3>
        <p className="mt-1 text-xs text-gray-500">Uncheck the modes you want to keep watching.</p>
        <div className="mt-4 space-y-2">
          {types.map(tt => (
            <label key={tt} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 ${checked.has(tt) ? 'border-red-800/50 bg-red-900/15' : 'border-gray-800 bg-gray-800/40'}`}>
              <input type="checkbox" checked={checked.has(tt)} onChange={() => { const next = new Set(checked); next.has(tt) ? next.delete(tt) : next.add(tt); onChange(next) }} className="h-4 w-4 accent-red-500" />
              <div className="min-w-0 flex-1">
                <span className={`rounded px-2 py-0.5 text-xs font-medium ${badgeBase(tt)}`}>{TRADE_TYPE_META[tt]?.label || tt}</span>
                <span className="ml-2 text-xs text-gray-500">{TRADE_TYPE_META[tt]?.desc}</span>
              </div>
            </label>
          ))}
        </div>
        <button type="button" disabled={noneChecked} onClick={onConfirm} className={`mt-4 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-medium ${noneChecked ? 'cursor-not-allowed bg-gray-800 text-gray-500' : 'bg-red-600 text-white hover:bg-red-500'}`}>
          {noneChecked ? 'Select types to remove' : label}
        </button>
        <button type="button" onClick={onCancel} className="mt-2 flex w-full items-center justify-center rounded-lg px-4 py-2.5 text-sm text-gray-400 hover:text-gray-300">Cancel</button>
      </div>
    </div>
  )
}

function EditSheet({ ticker, checked, onChange, onSave, onCancel }: { ticker: MyTickerEntry; checked: Set<string>; onChange: (c: Set<string>) => void; onSave: () => void; onCancel: () => void }) {
  const hasNone = checked.size === 0
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={onCancel}>
      <div className="w-full max-w-md rounded-t-2xl border border-gray-800 bg-gray-900 px-5 pb-8 pt-3" onClick={e => e.stopPropagation()}>
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-gray-700" />
        <h3 className="text-base font-semibold text-white">Edit {ticker.symbol} trade types</h3>
        <div className="mt-4 space-y-2">
          {['day', 'swing', 'regular'].map(tt => (
            <label key={tt} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 ${checked.has(tt) ? 'border-violet-800/50 bg-violet-900/15' : 'border-gray-800 bg-gray-800/40'}`}>
              <input type="checkbox" checked={checked.has(tt)} onChange={() => { const next = new Set(checked); next.has(tt) ? next.delete(tt) : next.add(tt); onChange(next) }} className="h-4 w-4 accent-violet-500" />
              <div className="min-w-0 flex-1">
                <span className={`rounded px-2 py-0.5 text-xs font-medium ${badgeBase(tt)}`}>{TRADE_TYPE_META[tt]?.label || tt}</span>
                <span className="ml-2 text-xs text-gray-500">{TRADE_TYPE_META[tt]?.desc}</span>
              </div>
            </label>
          ))}
        </div>
        <button type="button" disabled={hasNone} onClick={onSave} className={`mt-4 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-medium ${hasNone ? 'cursor-not-allowed bg-gray-800 text-gray-500' : 'bg-violet-600 text-white hover:bg-violet-500'}`}>
          Save changes
        </button>
        <button type="button" onClick={onCancel} className="mt-2 flex w-full items-center justify-center rounded-lg px-4 py-2.5 text-sm text-gray-400 hover:text-gray-300">Cancel</button>
      </div>
    </div>
  )
}
