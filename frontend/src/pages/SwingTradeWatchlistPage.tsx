import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ChevronDown, ChevronUp, LayoutList, Loader2, Layers, Plus, RefreshCw, Trash2, TrendingDown, TrendingUp,
} from 'lucide-react'
import { analyzeSwingTrade } from '../api/client'
import type { SwingTradeScanResult } from '../api/client'
import {
  formatSwingEngineLabel,
  toneForFinalAction,
  playbookHintFromResult,
  swingEngineSecondaryBadgeItems,
  swingEngineWatchlistExpandedAccentBarClass,
  swingEngineWatchlistExpandedShellClasses,
  swingEngineWatchlistRowRingClass,
  TONE_ACTION_BADGE,
  TONE_BADGE,
} from '../utils/swingTradeEngineBadges'
import SwingTradeEnginePanel from '../components/SwingTradeEnginePanel'
import { useApp } from '../contexts/AppContext'
import { useWatchlistHubBinding } from '../contexts/WatchlistHubContext'
import type { SwingTradeWatchlistRowState } from '../types/swingTradeUi'

const MAX_TICKERS = 20

function axiosDetail(e: unknown): string {
  const d = (e as { response?: { data?: { detail?: string } }; message?: string })?.response?.data?.detail
  if (typeof d === 'string') return d
  return (e as Error)?.message ?? 'Request failed'
}

type ScoreTone = 'bull' | 'bear' | 'neutral'

/** Green vs red leaning from directional bias or bull/bear gap (details + ticker accent). */
function scoreToneFromResult(r: SwingTradeScanResult): ScoreTone {
  if (r.bias === 'long') return 'bull'
  if (r.bias === 'short') return 'bear'
  const gap = r.bull_score - r.bear_score
  if (gap >= 1.25) return 'bull'
  if (gap <= -1.25) return 'bear'
  return 'neutral'
}

function tickerAccentClass(tone: ScoreTone): string {
  if (tone === 'bull') return 'font-mono font-bold text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.2)]'
  if (tone === 'bear') return 'font-mono font-bold text-rose-400 drop-shadow-[0_0_8px_rgba(251,113,133,0.2)]'
  return 'font-mono font-bold text-white'
}

/** Expanded row: gutter + backdrop from resolved decision tone. */
function expandedDetailsShell(row: SwingTradeWatchlistRowState): string {
  const base =
    'border-t border-gray-800 border-l-4 px-3 sm:px-4 py-4 transition-colors'
  if (row.status === 'loading' || row.status === 'idle')
    return `${base} border-l-transparent bg-black/25`
  if (row.status === 'err')
    return `${base} border-l-rose-600 bg-rose-950/15 ring-1 ring-inset ring-rose-600/15`
  const actionTone = toneForFinalAction(row.result.final_decision)
  return `${base} ${swingEngineWatchlistExpandedShellClasses(actionTone)}`
}

function BiasContextStrip({ result, compact }: { result: SwingTradeScanResult; compact?: boolean }) {
  if (!result.bias) return null
  const long = result.bias === 'long'
  const box = long
    ? 'swing-watchlist-bias flex items-center gap-2 rounded-xl border border-emerald-700/45 bg-emerald-950/40 font-semibold text-emerald-200'
    : 'swing-watchlist-bias flex items-center gap-2 rounded-xl border border-rose-700/45 bg-rose-950/40 font-semibold text-rose-200'
  const sizing = compact
    ? 'px-2 py-1 text-[10px] w-fit max-w-full'
    : 'mb-3 px-3 py-2 text-[11px]'
  const iconSize = compact ? 12 : 15
  return (
    <div className={`${box} ${sizing}`}>
      {long ? <TrendingUp size={iconSize} className="text-emerald-400 shrink-0" /> : <TrendingDown size={iconSize} className="text-rose-400 shrink-0" />}
      <span className="uppercase tracking-wide truncate">{long ? 'Long bias · swing framing' : 'Short bias · swing framing'}</span>
    </div>
  )
}

/** Primary resolved decision emphasis — matches the backend resolver. */
function SwingWatchlistCollapsedFinalActionChip({ result }: { result: SwingTradeScanResult }) {
  const actionTone = toneForFinalAction(result.final_decision)
  const chipBase =
    'inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none max-w-[min(100%,14rem)] truncate shrink-0'
  return (
    <span
      className={`${chipBase} px-2 font-bold tracking-wide max-w-[min(100%,20rem)] ${TONE_ACTION_BADGE[actionTone]}`}
      title={formatSwingEngineLabel(result.final_decision)}
    >
      {formatSwingEngineLabel(result.final_decision)}
    </span>
  )
}

/** Expanded panel: secondary badges, full playbook blurb, quality (bias uses full `BiasContextStrip` above). */
function SwingWatchlistSecondaryStrip({ result }: { result: SwingTradeScanResult }) {
  const secondary = swingEngineSecondaryBadgeItems(result)
  const playbook = playbookHintFromResult(result)
  const chipBase = 'inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none max-w-[min(100%,14rem)] truncate'

  return (
    <div className="flex flex-col gap-1.5 min-w-0 w-full">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
        {secondary.map(item => (
          <span key={`${item.label}-${item.text}`} className="contents">
            <span className="text-gray-600 text-[10px] select-none hidden sm:inline" aria-hidden>
              ·
            </span>
            <div className="flex items-center gap-1 min-w-0">
              <span className="text-[9px] font-semibold uppercase tracking-wide text-gray-500 shrink-0">{item.label}</span>
              <span className={`${chipBase} ${TONE_BADGE[item.tone]}`} title={formatSwingEngineLabel(item.text)}>
                {formatSwingEngineLabel(item.text)}
              </span>
            </div>
          </span>
        ))}
      </div>
      {playbook ? (
        <div
          className="flex items-start gap-1.5 min-w-0 rounded-lg border border-violet-600/35 bg-violet-950/25 px-2 py-1.5 text-left"
          title={playbook}
        >
          <Layers size={11} className="shrink-0 mt-0.5 text-violet-400" aria-hidden />
          <div className="min-w-0">
            <div className="text-[9px] font-semibold uppercase tracking-widest text-violet-300/95 mb-0.5">Options playbook</div>
            <p className="text-[11px] text-gray-200 leading-snug line-clamp-2 sm:line-clamp-3">{playbook}</p>
          </div>
        </div>
      ) : null}
      <div
        className="inline-flex items-center gap-1 w-fit max-w-full rounded-lg border border-gray-700/90 bg-gray-800/60 px-1.5 py-0.5 text-[10px] font-medium text-gray-300 tabular-nums shrink-0"
        title="Trade quality score"
      >
        Quality {result.trade_quality_score}/10
      </div>
    </div>
  )
}

export function SwingTradeWatchlistPanel({ embedInHub = false }: { embedInHub?: boolean }) {
  const {
    swingTradeWatchlist: tickers,
    setSwingTradeWatchlist,
    swingTradeWatchlistUI,
    setSwingTradeWatchlistUI: setWtUi,
    navigate,
  } = useApp()
  const { addInput, expanded, rows, rowBusy, bulkLoading } = swingTradeWatchlistUI

  const addInputRef = useRef<HTMLInputElement>(null)
  const [showAddForm, setShowAddForm] = useState(false)

  useEffect(() => {
    setWtUi(prev => {
      const nextRows: Record<string, SwingTradeWatchlistRowState> = {}
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
        const data = await analyzeSwingTrade(t)
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
    setSwingTradeWatchlist(prev => [...prev, sym])
    setWtUi(prev => ({
      ...prev,
      addInput: '',
      rows: { ...prev.rows, [sym]: { status: 'idle' } },
    }))
    if (embedInHub) setShowAddForm(false)
  }, [addInput, embedInHub, tickers, setSwingTradeWatchlist, setWtUi])

  const removeTicker = useCallback(
    (t: string) => {
      setSwingTradeWatchlist(prev => prev.filter(x => x !== t))
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
    [setSwingTradeWatchlist, setWtUi],
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

  const hubOnAdd = useCallback(() => setShowAddForm(s => !s), [])

  const hubOnRefresh = useCallback(() => {
    void refreshAll()
  }, [refreshAll])

  const hubOnExportCsv = useCallback(() => {
    const lines = ['ticker', ...tickers.map(t => `${t}`)]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `swing-trade-watchlist-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }, [tickers])

  useWatchlistHubBinding('swing', embedInHub, {
    onAdd: hubOnAdd,
    onRefresh: hubOnRefresh,
    refreshDisabled: tickers.length === 0 || bulkLoading,
    refreshBusy: bulkLoading,
    addDisabled: tickers.length >= MAX_TICKERS,
    addActive: showAddForm,
    onExportCsv: hubOnExportCsv,
  })

  useEffect(() => {
    if (embedInHub && showAddForm) queueMicrotask(() => addInputRef.current?.focus())
  }, [embedInHub, showAddForm])

  const wrapperClass = embedInHub
    ? 'swing-trade-page swing-trade-watchlist-page mx-auto w-full max-w-6xl space-y-6 pb-8'
    : 'swing-trade-page swing-trade-watchlist-page mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 pb-24'

  return (
    <div className={wrapperClass}>
      {!embedInHub && (
        <>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-600/20 text-violet-400">
              <LayoutList size={20} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Swing Trade Watchlist</h1>
              <p className="text-xs text-gray-500">
                Up to {MAX_TICKERS} symbols · synced to your account · same engine as{' '}
                <span className="text-gray-400">Swing Trade</span>
              </p>
            </div>
          </div>

          <p className="text-xs text-gray-500 -mt-2">
            Expand a row to run the daily swing scan. Lists are server-backed for this device session after login.
          </p>
        </>
      )}

      <section className="rounded-2xl border border-gray-800 bg-gray-900/60 p-4 sm:p-5">
        {embedInHub ? (
          <>
            <p className="text-[11px] text-gray-500">
              {tickers.length} of {MAX_TICKERS} tickers saved (server-backed)
            </p>
            {showAddForm && (
              <div className="mt-4 bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
                <div className="text-sm font-semibold text-gray-300">Add ticker</div>
                <div className="flex gap-3 flex-wrap items-center">
                  <input
                    ref={addInputRef}
                    value={addInput}
                    onChange={e => setWtUi(prev => ({ ...prev, addInput: e.target.value.toUpperCase() }))}
                    onKeyDown={e => e.key === 'Enter' && addTicker()}
                    placeholder="AAPL"
                    autoComplete="off"
                    spellCheck={false}
                    disabled={tickers.length >= MAX_TICKERS}
                    className="w-28 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white font-mono
                      text-sm uppercase placeholder-gray-600 focus:outline-none focus:border-violet-500"
                  />
                  <button
                    type="button"
                    onClick={addTicker}
                    disabled={tickers.length >= MAX_TICKERS || !addInput.trim()}
                    aria-label="Add ticker"
                    title="Add to watchlist"
                    className="inline-flex h-10 w-10 items-center justify-center bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl transition-colors shrink-0"
                  >
                    <Plus size={20} strokeWidth={2.5} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddForm(false)}
                    className="px-4 py-2 bg-gray-800 text-gray-400 text-sm rounded-xl hover:bg-gray-700 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="flex flex-col sm:flex-row sm:items-end gap-3">
              <div className="flex-1 min-w-0">
                <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                  Add ticker
                </label>
                <div className="flex gap-2">
                  <input
                    ref={addInputRef}
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
          </>
        )}
      </section>

      {tickers.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-900/30 px-4 py-10 text-center text-sm text-gray-500">
          {embedInHub
            ? 'Click Add in the tab bar to enter a symbol, then confirm here.'
            : 'Add tickers above to track resolved swing decisions side by side.'}
        </div>
      )}

      <div className="space-y-2">
        {tickers.length > 0 && (
          <div className="hidden sm:flex items-center gap-3 px-4 py-1.5 text-xs font-semibold text-gray-600 uppercase tracking-wide">
            <div className="w-28 shrink-0">Ticker</div>
            <div className="min-w-[10rem] max-w-xs shrink-0">Final action</div>
            <div className="w-28 shrink-0 hidden md:block">Bull / Bear</div>
            <div className="flex-1 min-w-0 hidden lg:block">Playbook</div>
            <div className="w-28 shrink-0 justify-end text-right hidden sm:flex">Status</div>
            <div className="w-24 shrink-0 justify-end text-right hidden sm:flex">Actions</div>
          </div>
        )}
        {tickers.map(t => {
          const row = rows[t] ?? ({ status: 'idle' as const })
          const busy = !!rowBusy[t]
          const bull = row.status === 'ok' ? row.result.bull_score : undefined
          const bear = row.status === 'ok' ? row.result.bear_score : undefined
          const scoreTone =
            row.status === 'ok' ? scoreToneFromResult(row.result) : null

          const rowChrome =
            row.status === 'ok'
              ? swingEngineWatchlistRowRingClass(toneForFinalAction(row.result.final_decision))
              : ''

          const scanning = row.status === 'loading' || busy
          const playbookHint = row.status === 'ok' ? playbookHintFromResult(row.result) : null

          const statusLabel =
            row.status === 'loading' ? 'Scanning…'
            : row.status === 'err' ? 'Error'
            : row.status === 'ok' ? 'Ready'
            : 'Idle'

          const tickerCls =
            scoreTone !== null ? tickerAccentClass(scoreTone) : 'font-mono font-bold text-white'

          return (
            <div
              key={t}
              className={`rounded-2xl overflow-hidden transition-colors bg-gray-900 border
                ${scanning ? 'border-blue-800/50' : 'border-gray-800 hover:border-gray-700'}
                ${rowChrome}`}
            >
              <div className="grid grid-cols-2 gap-3 px-4 py-3 sm:flex sm:items-center sm:flex-wrap">
                <div className="min-w-0 sm:w-28 sm:shrink-0">
                  <div className={`font-semibold text-sm tracking-tight ${tickerCls}`}>{t}</div>
                  <div className="text-xs text-gray-500 truncate sm:max-w-[110px]">Swing trade</div>
                </div>

                <div className="flex items-center sm:hidden">
                  {row.status === 'ok' ? (
                    <div className="flex items-center gap-2 min-w-0">
                      <SwingWatchlistCollapsedFinalActionChip result={row.result} />
                      {busy ? <Loader2 size={14} className="animate-spin text-gray-500 shrink-0" /> : null}
                    </div>
                  ) : row.status === 'loading' ? (
                    <Loader2 size={14} className="animate-spin text-gray-500" />
                  ) : (
                    <span className="text-xs text-gray-600">—</span>
                  )}
                </div>

                <div className="text-right sm:hidden">
                  {bull != null && bear != null ? (
                    <div className="text-xs tabular-nums">
                      <span className="text-emerald-400 font-semibold">{bull.toFixed(1)}</span>
                      <span className="text-gray-500"> / </span>
                      <span className="text-rose-400 font-semibold">{bear.toFixed(1)}</span>
                    </div>
                  ) : (
                    <div className="text-xs text-gray-600">—</div>
                  )}
                </div>

                <div className="min-w-[10rem] max-w-xs shrink-0 hidden sm:block">
                  {row.status === 'ok' ? (
                    <div className="flex items-center gap-2 min-w-0">
                      <SwingWatchlistCollapsedFinalActionChip result={row.result} />
                      {busy ? <Loader2 size={14} className="animate-spin text-gray-500 shrink-0" /> : null}
                    </div>
                  ) : row.status === 'loading' ? (
                    <Loader2 size={14} className="animate-spin text-gray-500" />
                  ) : (
                    <div className="text-xs text-gray-600">—</div>
                  )}
                </div>

                <div className="w-28 shrink-0 hidden md:block">
                  {bull != null && bear != null ? (
                    <>
                      <div className="text-sm font-semibold tabular-nums text-white">
                        <span className="text-emerald-400">{bull.toFixed(1)}</span>
                        <span className="text-gray-500"> / </span>
                        <span className="text-rose-400">{bear.toFixed(1)}</span>
                      </div>
                      <div className="text-xs text-gray-500">Bull · Bear</div>
                    </>
                  ) : (
                    <div className="text-xs text-gray-600">—</div>
                  )}
                </div>

                <div className="flex-1 min-w-0 hidden lg:block">
                  {playbookHint ? (
                    <div className="flex items-start gap-1.5 min-w-0" title={playbookHint}>
                      <Layers size={12} className="shrink-0 mt-0.5 text-violet-400/90" aria-hidden />
                      <p className="text-xs text-gray-300 leading-snug line-clamp-2">{playbookHint}</p>
                    </div>
                  ) : (
                    <span className="text-xs text-gray-600">—</span>
                  )}
                </div>

                <div className="w-28 shrink-0 hidden sm:flex flex-col items-end justify-center gap-0.5 text-right">
                  <span className="text-xs text-gray-400">{statusLabel}</span>
                </div>

                <div className="col-span-2 flex items-center justify-end gap-1.5 sm:col-span-1 sm:flex sm:shrink-0 sm:w-[7.75rem] sm:justify-end">
                  <button
                    type="button"
                    onClick={() => void fetchOne(t)}
                    disabled={busy}
                    aria-label={`Run swing scan for ${t}`}
                    title="Run scan"
                    className="inline-flex h-9 w-9 items-center justify-center bg-violet-600/20 hover:bg-violet-600/40
                      border border-violet-700/50 text-violet-300 rounded-xl transition-colors shrink-0 disabled:opacity-40"
                  >
                    <TrendingUp size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleRow(t)}
                    aria-expanded={!!expanded[t]}
                    title={expanded[t] ? 'Collapse' : 'Expand details'}
                    className="inline-flex h-9 w-9 items-center justify-center bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400
                      hover:text-gray-200 rounded-xl transition-colors shrink-0"
                  >
                    {expanded[t] ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeTicker(t)}
                    title={`Remove ${t}`}
                    className="inline-flex h-9 w-9 items-center justify-center bg-gray-800 hover:bg-red-900/30 border border-gray-700 text-gray-500 hover:text-red-400 rounded-xl transition-colors shrink-0"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                <div className="col-span-2 flex justify-end text-xs text-gray-500 sm:hidden">{statusLabel}</div>
              </div>

              {expanded[t] && (
                <div className={expandedDetailsShell(row)}>
                  {row.status === 'ok' ? (
                    <div
                      className={swingEngineWatchlistExpandedAccentBarClass(toneForFinalAction(row.result.final_decision))}
                      aria-hidden
                    />
                  ) : null}
                  {row.status === 'err' ? (
                    <p className="text-sm text-rose-300">{row.message}</p>
                  ) : row.status === 'ok' ? (
                    <div className="space-y-3">
                      <BiasContextStrip result={row.result} />
                      <SwingWatchlistSecondaryStrip result={row.result} />
                      <SwingTradeEnginePanel
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
                        <RefreshCw size={16} /> Run swing scan
                      </button>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">Opening…</p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <button
        type="button"
        onClick={() => navigate('swing-trade')}
        className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-400"
      >
        <TrendingUp size={14} /> Single-symbol Swing Trade Engine
      </button>
    </div>
  )
}

export default function SwingTradeWatchlistPage() {
  return <SwingTradeWatchlistPanel />
}
