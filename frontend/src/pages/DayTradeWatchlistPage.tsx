import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ChevronDown, ChevronRight, LayoutList, Loader2, Plus, RefreshCw, Trash2, Zap,
} from 'lucide-react'
import { analyzeDayTrade, type DayTradeScanResult } from '../api/client'
import DayTradeEnginePanel, { formatDayTradeLastPrice } from '../components/DayTradeEnginePanel'
import { OA_DAY_TRADE_WATCHLIST_KEY } from '../constants/storageKeys'

const MAX_TICKERS = 10

function axiosDetail(e: unknown): string {
  const d = (e as { response?: { data?: { detail?: string } }; message?: string })?.response?.data?.detail
  if (typeof d === 'string') return d
  return (e as Error)?.message ?? 'Request failed'
}

type RowState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; result: DayTradeScanResult }
  | { status: 'err'; message: string }

function loadStoredTickers(): string[] {
  try {
    const raw = localStorage.getItem(OA_DAY_TRADE_WATCHLIST_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return []
    const out: string[] = []
    const seen = new Set<string>()
    for (const x of arr) {
      if (typeof x !== 'string') continue
      const t = x.toUpperCase().trim()
      if (!t || t.length > 12 || seen.has(t)) continue
      seen.add(t)
      out.push(t)
      if (out.length >= MAX_TICKERS) break
    }
    return out
  } catch {
    return []
  }
}

function saveStoredTickers(tickers: string[]) {
  try {
    localStorage.setItem(OA_DAY_TRADE_WATCHLIST_KEY, JSON.stringify(tickers.slice(0, MAX_TICKERS)))
  } catch {
    /* ignore */
  }
}

function verdictPillClass(v: string): string {
  if (v === 'STRONG GO') return 'bg-emerald-500/20 text-emerald-200 border-emerald-400/50'
  if (v === 'GO') return 'bg-emerald-600/25 text-emerald-300 border-emerald-600/40'
  if (v === 'WATCH') return 'bg-amber-600/25 text-amber-200 border-amber-600/40'
  if (v === 'NO-GO') return 'bg-rose-600/25 text-rose-300 border-rose-600/40'
  return 'bg-gray-700/60 text-gray-300 border-gray-600/50'
}

export default function DayTradeWatchlistPage() {
  const [tickers, setTickers] = useState<string[]>(() => loadStoredTickers())
  const [addInput, setAddInput] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const [bulkLoading, setBulkLoading] = useState(false)
  const rowsRef = useRef(rows)
  rowsRef.current = rows

  useEffect(() => {
    saveStoredTickers(tickers)
  }, [tickers])

  const fetchOne = useCallback(async (t: string) => {
    setRows(prev => ({ ...prev, [t]: { status: 'loading' } }))
    try {
      const data = await analyzeDayTrade(t)
      setRows(prev => ({ ...prev, [t]: { status: 'ok', result: data } }))
    } catch (e) {
      setRows(prev => ({ ...prev, [t]: { status: 'err', message: axiosDetail(e) } }))
    }
  }, [])

  const addTicker = useCallback(() => {
    const sym = addInput.trim().toUpperCase()
    setAddInput('')
    if (!sym || sym.length > 12) return
    if (tickers.length >= MAX_TICKERS) return
    if (tickers.includes(sym)) return
    setTickers(prev => [...prev, sym])
    setRows(prev => ({ ...prev, [sym]: { status: 'idle' } }))
  }, [addInput, tickers])

  const removeTicker = useCallback((t: string) => {
    setTickers(prev => prev.filter(x => x !== t))
    setExpanded(ex => {
      const next = { ...ex }
      delete next[t]
      return next
    })
    setRows(prev => {
      const next = { ...prev }
      delete next[t]
      return next
    })
  }, [])

  const onToggleRow = useCallback(
    (t: string) => {
      setExpanded(ex => {
        const nextOpen = !ex[t]
        if (nextOpen) {
          const cur = rowsRef.current[t]
          if (!cur || cur.status === 'idle' || cur.status === 'err') {
            void fetchOne(t)
          }
        }
        return { ...ex, [t]: nextOpen }
      })
    },
    [fetchOne],
  )

  const refreshAll = useCallback(async () => {
    if (tickers.length === 0) return
    setBulkLoading(true)
    try {
      await Promise.all(tickers.map(t => fetchOne(t)))
    } finally {
      setBulkLoading(false)
    }
  }, [tickers, fetchOne])

  return (
    <div className="day-trade-page mx-auto w-full max-w-2xl space-y-6 px-4 py-6 sm:px-6 pb-24">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-600/20 text-orange-400">
          <LayoutList size={20} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">Day Trade Watchlist</h1>
          <p className="text-xs text-gray-500">
            Up to {MAX_TICKERS} symbols · same engine as{' '}
            <span className="text-gray-400">Day Trade Engine</span> — expand a row for full metrics
          </p>
        </div>
      </div>

      <section className="rounded-2xl border border-gray-800 bg-gray-900/60 p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1 min-w-0">
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
              Add symbol
            </label>
            <div className="flex gap-2">
              <input
                className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white font-mono text-lg uppercase placeholder-gray-600 focus:outline-none focus:border-violet-500"
                placeholder="Ticker"
                value={addInput}
                onChange={e => setAddInput(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && addTicker()}
                autoComplete="off"
                spellCheck={false}
                disabled={tickers.length >= MAX_TICKERS}
              />
              <button
                type="button"
                onClick={addTicker}
                disabled={tickers.length >= MAX_TICKERS || !addInput.trim()}
                className="inline-flex items-center justify-center gap-2 shrink-0 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold px-4 py-3 min-h-[48px]"
              >
                <Plus size={18} />
                Add
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void refreshAll()}
            disabled={tickers.length === 0 || bulkLoading}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-600 bg-gray-800/80 hover:bg-gray-800 text-gray-200 font-semibold px-4 py-3 min-h-[48px] disabled:opacity-50"
          >
            {bulkLoading ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />}
            Refresh all
          </button>
        </div>
        <p className="text-[11px] text-gray-500 mt-2">
          {tickers.length} of {MAX_TICKERS} tickers · list is saved in this browser
        </p>
      </section>

      {tickers.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-900/30 px-4 py-10 text-center text-sm text-gray-500">
          Add tickers above to track day-trade verdicts side by side.
        </div>
      )}

      <ul className="space-y-3">
        {tickers.map(t => {
          const row = rows[t] ?? { status: 'idle' as const }
          const open = !!expanded[t]
          const result = row.status === 'ok' ? row.result : null
          const metrics = (result?.metrics ?? {}) as Record<string, unknown>
          const priceStr = result ? formatDayTradeLastPrice(metrics) : '—'

          return (
            <li key={t} className="rounded-2xl border border-gray-800 bg-gray-900/50 overflow-hidden">
              <div className="flex items-stretch gap-0">
                <button
                  type="button"
                  onClick={() => onToggleRow(t)}
                  className="flex-1 min-w-0 text-left px-4 py-3 hover:bg-gray-800/40 transition-colors"
                >
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="shrink-0 text-gray-500">{open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</span>
                    <span className="font-mono text-lg font-bold text-white">{t}</span>
                    <span className="font-mono text-sm text-gray-300">{priceStr}</span>
                    {row.status === 'loading' && (
                      <Loader2 className="animate-spin text-violet-400 shrink-0" size={16} />
                    )}
                    {result && (
                      <>
                        <span
                          className={`inline-flex items-center rounded-lg border px-2 py-0.5 text-xs font-bold ${verdictPillClass(result.verdict)}`}
                        >
                          {result.verdict}
                        </span>
                        <span className="text-[11px] text-gray-500 tabular-nums">
                          Bull <span className="text-emerald-400 font-mono">{result.bull_score}</span>
                          {' · '}
                          Bear <span className="text-rose-400 font-mono">{result.bear_score}</span>
                        </span>
                      </>
                    )}
                    {row.status === 'err' && <span className="text-xs text-rose-400">Error — expand for retry</span>}
                  </div>
                </button>
                <div className="flex items-center border-l border-gray-800 shrink-0">
                  <button
                    type="button"
                    title={`Remove ${t}`}
                    onClick={() => removeTicker(t)}
                    className="h-full px-3 text-gray-500 hover:text-rose-400 hover:bg-rose-950/20 transition-colors"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>

              {open && (
                <div className="border-t border-gray-800 px-3 pb-4 pt-2 space-y-3">
                  {row.status === 'loading' && (
                    <div className="flex items-center gap-2 text-sm text-gray-400 py-6 justify-center">
                      <Loader2 className="animate-spin" size={18} /> Scanning…
                    </div>
                  )}
                  {row.status === 'err' && (
                    <div className="rounded-xl border border-rose-800/60 bg-rose-950/25 px-3 py-2 text-sm text-rose-200 space-y-2">
                      {row.message}
                      <button
                        type="button"
                        onClick={() => void fetchOne(t)}
                        className="block text-violet-400 hover:text-violet-300 text-xs font-semibold"
                      >
                        Retry scan
                      </button>
                    </div>
                  )}
                  {row.status === 'ok' && result && (
                    <>
                      <div className="flex items-center gap-2 text-[11px] text-gray-500 px-1">
                        <Zap size={12} className="text-orange-400 shrink-0" />
                        Same layout as <span className="text-gray-400">Day Trade Engine</span> after Analyze
                      </div>
                      <DayTradeEnginePanel
                        result={result}
                        onRefresh={() => void fetchOne(t)}
                      />
                    </>
                  )}
                  {(row.status === 'idle' || (!result && row.status !== 'loading' && row.status !== 'err')) && (
                    <div className="text-center py-4">
                      <button
                        type="button"
                        onClick={() => void fetchOne(t)}
                        className="inline-flex items-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold px-4 py-2 text-sm"
                      >
                        <RefreshCw size={16} /> Run day-trade scan
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
