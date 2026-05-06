import { useCallback, useEffect } from 'react'
import {
  ArrowDown, BarChart2, ChevronDown, ChevronRight, Clock, Flame, Loader2,
  RefreshCw, Search, ShieldAlert, Zap,
} from 'lucide-react'
import { analyzeDayTrade } from '../api/client'
import DayTradeEnginePanel from '../components/DayTradeEnginePanel'
import { useApp } from '../contexts/AppContext'

function axiosDetail(e: unknown): string {
  const d = (e as { response?: { data?: { detail?: string } }; message?: string })?.response?.data?.detail
  if (typeof d === 'string') return d
  return (e as Error)?.message ?? 'Request failed'
}

export default function DayTradePage() {
  const { dayTradeEngineUI: ui, setDayTradeEngineUI: setUi } = useApp()
  const { ticker, loading, error, result, glossaryOpen } = ui

  useEffect(() => {
    const readHashTicker = () => {
      const raw = window.location.hash.replace(/^#/, '')
      const qi = raw.indexOf('?')
      if (qi < 0) return
      const sp = new URLSearchParams(raw.slice(qi))
      const t = sp.get('ticker')?.trim().toUpperCase()
      if (t && t.length <= 12) {
        setUi(cur =>
          cur.ticker.trim() === t ? cur : { ...cur, ticker: t },
        )
      }
    }
    readHashTicker()
    window.addEventListener('hashchange', readHashTicker)
    return () => window.removeEventListener('hashchange', readHashTicker)
  }, [setUi])

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
        <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Symbol</label>
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
        <DayTradeEnginePanel result={result} onRefresh={() => void runScan()} refreshing={loading} />
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
              <li className="flex gap-2"><ArrowDown size={14} className="shrink-0 text-gray-600" /> <span className="text-gray-400">STRONG GO / GO / WATCH</span> = tiered edge (volume + RS gate STRONG; medium GO; weak volume → WATCH); <span className="text-gray-400">NO-GO</span> = veto; <span className="text-gray-400">WAIT</span> = no edge.</li>
            </ul>
          </div>
        )}
      </section>
    </div>
  )
}
