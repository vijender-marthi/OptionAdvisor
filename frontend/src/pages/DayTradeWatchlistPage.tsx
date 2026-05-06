import { useCallback, useEffect } from 'react'
import {
  ChevronDown, ChevronRight, LayoutList, Loader2, Plus, RefreshCw, Trash2, Zap,
} from 'lucide-react'
import { analyzeDayTrade } from '../api/client'
import DayTradeEnginePanel from '../components/DayTradeEnginePanel'
import { useApp } from '../contexts/AppContext'
import type { DayTradeWatchlistRowState } from '../types/dayTradeUi'

const MAX_TICKERS = 10

function axiosDetail(e: unknown): string {
  const d = (e as { response?: { data?: { detail?: string } }; message?: string })?.response?.data?.detail
  if (typeof d === 'string') return d
  return (e as Error)?.message ?? 'Request failed'
}

function verdictPillClass(v: string): string {
  if (v === 'STRONG GO') return 'bg-emerald-500/20 text-emerald-200 border-emerald-400/50'
  if (v === 'GO') return 'bg-emerald-600/25 text-emerald-300 border-emerald-600/40'
  if (v === 'WATCH') return 'bg-amber-600/25 text-amber-200 border-amber-600/40'
  if (v === 'NO-GO') return 'bg-rose-600/25 text-rose-300 border-rose-600/40'
  return 'bg-gray-700/60 text-gray-300 border-gray-600/50'
}

function metricNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function fmtUsd2(n: number): string {
  return `$${n.toFixed(2)}`
}

function fmtPctSigned(pct: number | null): string {
  if (pct === null || Number.isNaN(pct)) return '—'
  const sign = pct > 0 ? '+' : pct < 0 ? '' : ''
  return `${sign}${pct.toFixed(2)}%`
}

/** Green / red neutral tone for signed percentage (session or extended-hours change). */
function pctChangeClass(pct: number | null): string {
  if (pct === null || Number.isNaN(pct)) return 'text-gray-400'
  if (pct > 0) return 'text-emerald-400'
  if (pct < 0) return 'text-rose-400'
  return 'text-gray-400'
}

/** Pick post / pre headline vs regular session close — matches backend metrics keys. */
function watchlistBannerQuote(metrics: Record<string, unknown>): {
  badge: string
  badgeClass: string
  price: string
  pct: number | null
} | null {
  const postP = metricNum(metrics.post_market_price)
  const postCp = metricNum(metrics.post_market_change_pct)
  const preP = metricNum(metrics.pre_market_price)
  const preCp = metricNum(metrics.pre_market_change_pct)
  const last = metricNum(metrics.last_price)
  const sessCp = metricNum(metrics.session_change_pct)
  const regCp = metricNum(metrics.regular_market_change_pct)
  const state = String(metrics.market_state ?? '').toUpperCase()

  // During live RTH prefer last bar + session % — Yahoo can still surface stale post/pre fields.
  if (state === 'REGULAR' && last !== null && last > 0) {
    return {
      badge: 'RTH',
      badgeClass: 'bg-gray-700/55 text-gray-300 border-gray-600/55',
      price: fmtUsd2(last),
      pct: sessCp ?? regCp,
    }
  }

  if (postP !== null && postP > 0) {
    return {
      badge: 'AH',
      badgeClass: 'bg-violet-500/18 text-violet-200 border-violet-500/35',
      price: fmtUsd2(postP),
      pct: postCp,
    }
  }
  const preSession = state === 'PRE' || state.startsWith('PRE')
  if (preP !== null && preP > 0 && (preSession || preCp != null)) {
    return {
      badge: 'Pre',
      badgeClass: 'bg-sky-500/15 text-sky-200 border-sky-500/35',
      price: fmtUsd2(preP),
      pct: preCp,
    }
  }
  if (last !== null && last > 0) {
    return {
      badge: 'RTH',
      badgeClass: 'bg-gray-700/55 text-gray-300 border-gray-600/55',
      price: fmtUsd2(last),
      pct: sessCp ?? regCp,
    }
  }
  return null
}

export default function DayTradeWatchlistPage() {
  const {
    dayTradeWatchlist: tickers,
    setDayTradeWatchlist,
    dayTradeWatchlistUI,
    setDayTradeWatchlistUI: setWtUi,
    navigate,
  } = useApp()
  const { addInput, expanded, rows, rowBusy, bulkLoading } = dayTradeWatchlistUI

  useEffect(() => {
    setWtUi(prev => {
      const nextRows: Record<string, DayTradeWatchlistRowState> = {}
      for (const t of tickers) {
        if (prev.rows[t]) nextRows[t] = prev.rows[t]
        else nextRows[t] = { status: 'idle' }
      }
      const nextEx: Record<string, boolean> = {}
      for (const t of tickers) {
        if (prev.expanded[t]) nextEx[t] = true
      }
      return { ...prev, rows: nextRows, expanded: nextEx }
    })
  }, [tickers, setWtUi])

  const fetchOne = useCallback(
    async (t: string) => {
      setWtUi(prev => {
        const cur = prev.rows[t]
        if (cur?.status === 'ok')
          return { ...prev, rowBusy: { ...prev.rowBusy, [t]: true } }
        return {
          ...prev,
          rows: { ...prev.rows, [t]: { status: 'loading' } },
          rowBusy: { ...prev.rowBusy, [t]: true },
        }
      })
      try {
        const data = await analyzeDayTrade(t)
        setWtUi(prev => ({
          ...prev,
          rows: { ...prev.rows, [t]: { status: 'ok', result: data } },
          rowBusy: { ...prev.rowBusy, [t]: false },
        }))
      } catch (e) {
        setWtUi(prev => ({
          ...prev,
          rows: {
            ...prev.rows,
            [t]: { status: 'err', message: axiosDetail(e) },
          },
          rowBusy: { ...prev.rowBusy, [t]: false },
        }))
      }
    },
    [setWtUi],
  )

  const addTicker = useCallback(() => {
    const sym = addInput.trim().toUpperCase()
    if (!sym || sym.length > 12) return
    if (tickers.length >= MAX_TICKERS) return
    if (tickers.includes(sym)) return
    setDayTradeWatchlist(prev => [...prev, sym])
    setWtUi(prev => ({
      ...prev,
      addInput: '',
      rows: { ...prev.rows, [sym]: { status: 'idle' } },
    }))
  }, [addInput, tickers, setDayTradeWatchlist, setWtUi])

  const removeTicker = useCallback(
    (t: string) => {
      setDayTradeWatchlist(prev => prev.filter(x => x !== t))
      setWtUi(prev => {
        const nextRows = { ...prev.rows }
        delete nextRows[t]
        const nextEx = { ...prev.expanded }
        delete nextEx[t]
        const nextBusy = { ...prev.rowBusy }
        delete nextBusy[t]
        return { ...prev, rows: nextRows, expanded: nextEx, rowBusy: nextBusy }
      })
    },
    [setDayTradeWatchlist, setWtUi],
  )

  const onToggleRow = useCallback(
    (t: string) => {
      setWtUi(prev => {
        const nextOpen = !prev.expanded[t]
        if (nextOpen) {
          const cur = prev.rows[t]
          if (!cur || cur.status === 'idle' || cur.status === 'err') {
            queueMicrotask(() => void fetchOne(t))
          }
        }
        return { ...prev, expanded: { ...prev.expanded, [t]: nextOpen } }
      })
    },
    [fetchOne, setWtUi],
  )

  const refreshAll = useCallback(async () => {
    if (tickers.length === 0) return
    setWtUi(prev => ({ ...prev, bulkLoading: true }))
    try {
      await Promise.all(tickers.map(t => fetchOne(t)))
    } finally {
      setWtUi(prev => ({ ...prev, bulkLoading: false }))
    }
  }, [tickers, fetchOne, setWtUi])

  return (
    <div className="day-trade-page mx-auto w-full max-w-2xl space-y-6 px-4 py-6 sm:px-6 pb-24">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-600/20 text-orange-400">
          <LayoutList size={20} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">Day Trade Watchlist</h1>
          <p className="text-xs text-gray-500">
            Up to {MAX_TICKERS} symbols · synced to your account · same engine as{' '}
            <span className="text-gray-400">Day Trade Engine</span>
          </p>
        </div>
      </div>

      <p className="text-xs text-gray-500 -mt-2">
        Backend scans this list ~ every 15 minutes (when alerts run) and emails you when a symbol moves{' '}
        <span className="text-gray-400">WATCH → GO</span> or <span className="text-gray-400">STRONG GO</span>.{' '}
        <button
          type="button"
          onClick={() => navigate('day-trade-alerts')}
          className="text-violet-400 hover:text-violet-300 font-semibold"
        >
          View alert history →
        </button>
      </p>

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
                onChange={e => setWtUi(prev => ({ ...prev, addInput: e.target.value.toUpperCase() }))}
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
          {tickers.length} of {MAX_TICKERS} tickers saved (server-backed)
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
          const verdict =
            row.status === 'ok' ? row.result.verdict : undefined
          const metrics = row.status === 'ok' ? row.result.metrics : undefined
          const busy = !!rowBusy[t]
          const banner = metrics ? watchlistBannerQuote(metrics as Record<string, unknown>) : null
          const bull = row.status === 'ok' ? row.result.bull_score : undefined
          const bear = row.status === 'ok' ? row.result.bear_score : undefined

          return (
            <li key={t} className="rounded-2xl border border-gray-800 bg-gray-900/50 overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2.5 sm:px-4">
                <button
                  type="button"
                  onClick={() => onToggleRow(t)}
                  className="p-1 text-gray-500 hover:text-white shrink-0"
                  aria-expanded={!!expanded[t]}
                >
                  {expanded[t] ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                </button>
                <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap gap-y-1.5">
                  <span className="font-mono font-bold text-white">{t}</span>
                  {verdict ? (
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wide border rounded-full px-2 py-0.5 shrink-0 ${verdictPillClass(verdict)}`}
                    >
                      {verdict}
                    </span>
                  ) : row.status === 'loading' ? (
                    <Loader2 size={14} className="animate-spin text-gray-500" />
                  ) : null}
                  {busy && row.status === 'ok' ? (
                    <Loader2 size={14} className="animate-spin text-gray-500 shrink-0" />
                  ) : null}
                  {bull != null && bear != null && (
                    <span
                      title="Bull score · Bear score"
                      className="tabular-nums text-[11px] sm:text-xs shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-lg bg-gray-800/70 border border-gray-700/80"
                    >
                      <span className="text-emerald-400 font-semibold">{bull.toFixed(1)}</span>
                      <span className="text-gray-500 select-none">/</span>
                      <span className="text-rose-400 font-semibold">{bear.toFixed(1)}</span>
                    </span>
                  )}
                  {banner ? (
                    <div className="ml-auto flex items-center gap-2 shrink-0 text-right tabular-nums">
                      <span
                        title="Quote context: AH after-hours, Pre pre-market, RTH regular session close"
                        className={`text-[9px] font-bold uppercase tracking-wider border rounded px-1.5 py-px ${banner.badgeClass}`}
                      >
                        {banner.badge}
                      </span>
                      <span className="text-sm font-mono font-semibold text-gray-100">{banner.price}</span>
                      <span className={`text-xs font-mono font-medium min-w-[3.75rem] text-right ${pctChangeClass(banner.pct)}`}>
                        {fmtPctSigned(banner.pct)}
                      </span>
                    </div>
                  ) : row.status !== 'loading' ? (
                    <span className="text-xs text-gray-500 ml-auto shrink-0">—</span>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => removeTicker(t)}
                  className="p-2 text-gray-600 hover:text-rose-400 shrink-0"
                  title="Remove"
                >
                  <Trash2 size={16} />
                </button>
              </div>
              {expanded[t] && (
                <div className="border-t border-gray-800 px-3 sm:px-4 py-4 bg-black/25">
                  {row.status === 'err' ? (
                    <p className="text-sm text-rose-300">{row.message}</p>
                  ) : row.status === 'ok' ? (
                    <div className="space-y-3">
                      <DayTradeEnginePanel
                        result={row.result}
                        onRefresh={() => void fetchOne(t)}
                        refreshing={busy}
                      />
                      <button
                        type="button"
                        onClick={() => void fetchOne(t)}
                        disabled={busy}
                        className="inline-flex items-center gap-2 text-xs font-semibold text-violet-400 hover:text-violet-300"
                      >
                        <RefreshCw size={16} /> Run day-trade scan
                      </button>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">Opening…</p>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <button
        type="button"
        onClick={() => navigate('day-trade')}
        className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-400"
      >
        <Zap size={14} /> Single-symbol Day Trade Engine
      </button>
    </div>
  )
}
