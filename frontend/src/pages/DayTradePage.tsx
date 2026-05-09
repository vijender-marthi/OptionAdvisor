import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ArrowDown, BarChart2, ChevronDown, ChevronRight, Clock, Flame, Loader2,
  RefreshCw, Search, ShieldAlert, X, Zap,
} from 'lucide-react'
import { analyzeDayTrade, enterActiveTrade } from '../api/client'
import DayTradeEnginePanel from '../components/DayTradeEnginePanel'
import { useApp } from '../contexts/AppContext'

function axiosDetail(e: unknown): string {
  const d = (e as { response?: { data?: { detail?: string } }; message?: string })?.response?.data?.detail
  if (typeof d === 'string') return d
  return (e as Error)?.message ?? 'Request failed'
}

export default function DayTradePage() {
  const { dayTradeEngineUI: ui, setDayTradeEngineUI: setUi, canAccessPage, navigate } = useApp()
  const [searchParams] = useSearchParams()
  const { ticker, loading, error, result, glossaryOpen } = ui

  const [enterOpen, setEnterOpen] = useState(false)
  const [side, setSide] = useState<'CALL' | 'PUT'>('CALL')
  const [entryPrice, setEntryPrice] = useState('')
  const [contracts, setContracts] = useState('')
  const [strikeInput, setStrikeInput] = useState('')
  const [expiryInput, setExpiryInput] = useState('')
  const [notes, setNotes] = useState('')
  const [enterSubmitting, setEnterSubmitting] = useState(false)
  const [enterErr, setEnterErr] = useState<string | null>(null)

  useEffect(() => {
    const readTicker = () => {
      let t = searchParams.get('ticker')?.trim().toUpperCase()
      if (!t) {
        const raw = window.location.hash.replace(/^#/, '')
        const qi = raw.indexOf('?')
        if (qi >= 0) {
          const sp = new URLSearchParams(raw.slice(qi))
          t = sp.get('ticker')?.trim().toUpperCase()
        }
      }
      if (t && t.length <= 12) {
        setUi(cur => (cur.ticker.trim() === t ? cur : { ...cur, ticker: t }))
      }
    }
    readTicker()
    window.addEventListener('hashchange', readTicker)
    return () => window.removeEventListener('hashchange', readTicker)
  }, [searchParams, setUi])

  const runScan = useCallback(async () => {
    const sym = ticker.trim().toUpperCase()
    if (!sym || sym.length > 12) {
      setUi(cur => ({ ...cur, error: 'Enter a valid ticker symbol.' }))
      return
    }
    setUi(cur => ({ ...cur, loading: true, error: null, result: null }))
    try {
      const data = await analyzeDayTrade(sym)
      setUi(cur => ({
        ...cur,
        loading: false,
        ticker: data.ticker,
        result: data,
      }))
    } catch (e) {
      setUi(cur => ({
        ...cur,
        loading: false,
        error: axiosDetail(e),
      }))
    }
  }, [ticker, setUi])

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
      })
      setEnterOpen(false)
      navigate('active-trades')
    } catch (e) {
      setEnterErr(axiosDetail(e))
    } finally {
      setEnterSubmitting(false)
    }
  }, [result, entryPrice, side, contracts, strikeInput, expiryInput, notes, navigate])

  return (
    <div className="day-trade-page mx-auto w-full max-w-2xl space-y-6 px-4 py-6 sm:px-6 pb-24">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-600/20 text-orange-400">
          <Zap size={20} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">Day Trade Engine</h1>
          <p className="text-xs text-gray-500">Intraday prototype — 1m bars, VWAP, opening range, context</p>
        </div>
      </div>

      {/* Scan */}
      <section className="rounded-2xl border border-gray-800 bg-gray-900/60 p-4 sm:p-5">
        <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Ticker</label>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white font-mono text-lg uppercase placeholder-gray-600 focus:outline-none focus:border-violet-500"
            placeholder="SPY, NVDA, …"
            value={ticker}
            onChange={e => setUi(cur => ({ ...cur, ticker: e.target.value.toUpperCase() }))}
            onKeyDown={e => e.key === 'Enter' && runScan()}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={runScan}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 shrink-0 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold px-5 py-3 min-h-[48px] transition-colors"
          >
            {loading ? <Loader2 className="animate-spin" size={18} /> : <Search size={18} />}
            Analyze
          </button>
        </div>
        <p className="text-[11px] text-gray-500 mt-2">
          Uses Yahoo 1-minute RTH data for the most recent session, session VWAP, first 15m opening range, short-horizon momentum, volume vs average, plus SPY/QQQ daily change and VIX.
        </p>
      </section>

      {error && (
        <div className="rounded-xl border border-rose-800/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-200 flex gap-2">
          <ShieldAlert className="shrink-0 mt-0.5" size={16} />
          {error}
        </div>
      )}

      {result && (
        <DayTradeEnginePanel
          result={result}
          onRefresh={() => void runScan()}
          refreshing={loading}
          onRequestEnterActiveTrade={canAccessPage('active-trades') ? openEnterModal : undefined}
        />
      )}

      {/* Flow reference */}
      <section className="rounded-2xl border border-gray-800 bg-gray-900/40 overflow-hidden">
        <button
          type="button"
          onClick={() => setUi(cur => ({ ...cur, glossaryOpen: !cur.glossaryOpen }))}
          className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left text-sm font-semibold text-gray-300 hover:bg-gray-800/50"
        >
          <span className="flex items-center gap-2">
            <BarChart2 size={16} className="text-violet-400" />
            What this prototype does
          </span>
          {glossaryOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </button>
        {glossaryOpen && (
          <div className="px-4 pb-4 space-y-3 text-xs text-gray-500 border-t border-gray-800 pt-3">
            <p>
              Pulls <span className="text-gray-300">1-minute</span> regular-session candles, builds session{' '}
              <span className="text-gray-300">VWAP</span>,{' '}
              <span className="text-gray-300">opening range</span> (first 15 minutes), checks price vs range and VWAP, short lookback{' '}
              <span className="text-gray-300">momentum</span>, and a simple <span className="text-gray-300">volume spike</span> flag.
              Blends in <span className="text-gray-300">SPY / QQQ</span> one-day change and <span className="text-gray-300">VIX</span> as risk context.
            </p>
            <p className="text-amber-200/70 border border-amber-800/40 bg-amber-950/20 rounded-lg px-3 py-2">
              <Flame size={12} className="inline mr-1" />
              Educational only — not financial advice. Intraday data can be delayed; verify prices with your broker.
            </p>
            <ul className="space-y-2">
              <li className="flex gap-2"><Clock size={14} className="shrink-0 text-gray-600" /> Most recent trading day in the feed is analyzed if today has no session yet.</li>
              <li className="flex gap-2"><ArrowDown size={14} className="shrink-0 text-gray-600" /> <span className="text-gray-400">Market bias</span> tells you whether the tape is supportive. <span className="text-gray-400">Execution readiness</span> tells you whether the trigger is actually there.</li>
              <li className="flex gap-2"><ArrowDown size={14} className="shrink-0 text-gray-600" /> The page now resolves everything into <span className="text-gray-400">READY / WAIT / WATCH / AVOID</span> so a bullish tape does not get mistaken for an immediate entry.</li>
            </ul>
          </div>
        )}
      </section>

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
              <p className="text-xs text-gray-500 leading-relaxed">
                The <span className="text-gray-400">underlying</span> drives the decision engine (VWAP, opening range,
                volume). <span className="text-gray-400">Strike</span> and <span className="text-gray-400">expiry</span>{' '}
                are optional — useful for bookkeeping and future Greeks / P&amp;L tooling.
              </p>
              <p className="text-xs text-gray-500">
                Session tape uses <span className="font-mono text-gray-300">{result.ticker}</span> — log the option
                premium you paid.
              </p>
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
    </div>
  )
}
