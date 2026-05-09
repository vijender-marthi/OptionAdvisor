import { useCallback, useRef, useState } from 'react'
import { BarChart2, ChevronDown, ChevronRight, Flame, Loader2, Search, ShieldAlert, TrendingUp } from 'lucide-react'
import { analyzeSwingTrade } from '../api/client'
import type { SwingTradeScanResult } from '../api/client'
import SwingTradeEnginePanel from '../components/SwingTradeEnginePanel'

function axiosDetail(e: unknown): string {
  const d = (e as { response?: { data?: { detail?: string } }; message?: string })?.response?.data?.detail
  if (typeof d === 'string') return d
  return (e as Error)?.message ?? 'Request failed'
}

export default function SwingTradePage() {
  const [ticker, setTicker] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SwingTradeScanResult | null>(null)
  const [glossaryOpen, setGlossaryOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const runScan = useCallback(async () => {
    const sym = ticker.trim().toUpperCase()
    if (!sym || sym.length > 12) {
      setError('Enter a valid ticker symbol.')
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const data = await analyzeSwingTrade(sym)
      setResult(data)
      setTicker(data.ticker)
    } catch (e) {
      setError(axiosDetail(e))
    } finally {
      setLoading(false)
    }
  }, [ticker])

  return (
    <div className="swing-trade-page mx-auto w-full max-w-2xl space-y-6 px-4 py-6 sm:px-6 pb-24">
      {/* Page header */}
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-600/20 text-violet-400">
          <TrendingUp size={20} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">Swing Trade Engine</h1>
          <p className="text-xs text-gray-500">Daily candles · overnight &amp; multi-day setups</p>
        </div>
      </div>

      {/* Ticker input */}
      <section className="rounded-2xl border border-gray-800 bg-gray-900/60 p-4 sm:p-5">
        <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Ticker</label>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            ref={inputRef}
            className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white font-mono text-lg uppercase placeholder-gray-600 focus:outline-none focus:border-violet-500"
            placeholder="NVDA, AAPL, SPY…"
            value={ticker}
            onChange={e => setTicker(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && void runScan()}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => void runScan()}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 shrink-0 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold px-5 py-3 min-h-[48px] transition-colors"
          >
            {loading ? <Loader2 className="animate-spin" size={18} /> : <Search size={18} />}
            Analyze
          </button>
        </div>
        <p className="text-[11px] text-gray-500 mt-2">
          Uses daily OHLCV bars from Yahoo Finance. Evaluates MA20/MA50 alignment and slope, RSI, MACD crossover, 5-day momentum, volume trend, and SPY/VIX context for overnight or 2–5 day swing trade setups.
        </p>
      </section>

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-rose-800/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-200 flex gap-2">
          <ShieldAlert className="shrink-0 mt-0.5" size={16} />
          {error}
        </div>
      )}

      {/* Result panel */}
      {result && (
        <SwingTradeEnginePanel
          result={result}
          onRefresh={() => void runScan()}
          refreshing={loading}
        />
      )}

      {/* Methodology note */}
      <section className="rounded-2xl border border-gray-800 bg-gray-900/40 overflow-hidden">
        <button
          type="button"
          onClick={() => setGlossaryOpen(v => !v)}
          className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left text-sm font-semibold text-gray-300 hover:bg-gray-800/50"
        >
          <span className="flex items-center gap-2">
            <BarChart2 size={16} className="text-violet-400" />
            How swing scoring works
          </span>
          {glossaryOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </button>
        {glossaryOpen && (
          <div className="px-4 pb-4 space-y-3 text-xs text-gray-500 border-t border-gray-800 pt-3">
            <p>
              The engine fetches <span className="text-gray-300">daily candles</span> (60+ bars) and scores seven signal groups for both bull and bear sides, then subtracts a{' '}
              <span className="text-gray-300">VIX caution penalty</span> when the fear gauge is elevated.
            </p>
            <ul className="space-y-1.5 list-none">
              <li><span className="text-gray-400 font-semibold">MA alignment</span> — price vs MA20 and MA50 (±2 pts)</li>
              <li><span className="text-gray-400 font-semibold">MA trend</span> — slope and spacing of MA20/MA50 (±2 pts)</li>
              <li><span className="text-gray-400 font-semibold">RSI</span> — momentum health and extreme zones (±1.5 pts)</li>
              <li><span className="text-gray-400 font-semibold">MACD</span> — histogram trend + crossover (±2.5 pts)</li>
              <li><span className="text-gray-400 font-semibold">Momentum</span> — 5-day price change (±1 pt)</li>
              <li><span className="text-gray-400 font-semibold">Volume</span> — rising vs declining trend (±1.5 pts)</li>
              <li><span className="text-gray-400 font-semibold">SPY context</span> — SPY vs own MA20 (±0.5 pt)</li>
            </ul>
            <div className="space-y-1">
              <p><span className="text-emerald-400 font-semibold">Market bias</span> explains the trend direction, but the decision card separates that from entry quality and execution readiness.</p>
              <p><span className="text-amber-300 font-semibold">WAIT / WATCH</span> means the trend can still be constructive while the entry is not ready yet.</p>
              <p><span className="text-rose-300 font-semibold">AVOID / NO EDGE</span> means risk, pricing, or structure is still too poor to trust.</p>
            </div>
            <p className="text-amber-200/70 border border-amber-800/40 bg-amber-950/20 rounded-lg px-3 py-2 leading-relaxed">
              <Flame size={12} className="inline mr-1" />
              Educational only — not financial advice. Daily data from Yahoo may lag by one session. Always verify with your broker before trading.
            </p>
          </div>
        )}
      </section>
    </div>
  )
}
