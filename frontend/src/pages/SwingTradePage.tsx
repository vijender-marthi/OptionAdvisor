import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowUpRight, BarChart2, Bell, ChevronDown, ChevronRight, Flame, Loader2, RefreshCw, Search, ShieldAlert, TrendingUp, X, Zap } from 'lucide-react'
import { analyzeSwingTrade, saveToJournal } from '../api/client'
import { fetchMyTickers } from '../api/commandCenter'
import type { SwingTradeScanResult } from '../api/client'
import SwingTradeEnginePanel, { computeExecLevels } from '../components/SwingTradeEnginePanel'
import { useApp } from '../contexts/AppContext'
import { ROUTES } from '../routing/routes'
import { getActionButtonClass } from '../utils/semanticTrading'

function axiosDetail(e: unknown): string {
  const d = (e as { response?: { data?: { detail?: string } }; message?: string })?.response?.data?.detail
  if (typeof d === 'string') return d
  return (e as Error)?.message ?? 'Request failed'
}

export default function SwingTradePage() {
  const {
    swingTradeEngineUI: ui,
    setSwingTradeEngineUI: setUi,
    addManualPosition,
    portfolio,
    user,
  } = useApp()
  const { ticker, loading, error, result, glossaryOpen } = ui

  const existingPositions = useMemo(
    () => portfolio.filter(p => p.ticker.toUpperCase() === result?.ticker?.toUpperCase() && p.status === 'open'),
    [portfolio, result?.ticker]
  )
  const [enterOpen, setEnterOpen] = useState(false)
  const [alertOpen, setAlertOpen] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'info'; message: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const autoRunRef = useRef(false)
  const [myTickers, setMyTickers] = useState<string[]>([])
  const [savedToJournal, setSavedToJournal] = useState(false)

  useEffect(() => {
    fetchMyTickers().then(res => {
      const symbols = (res.data?.tickers ?? [])
        .filter(t => (t.trade_types || []).includes('swing'))
        .map(t => t.symbol).filter(Boolean).slice(0, 10)
      setMyTickers(symbols)
    }).catch(() => {})
  }, [])

  const runScan = useCallback(async (overrideTicker?: string) => {
    const sym = (overrideTicker || ticker).trim().toUpperCase()
    if (!sym || sym.length > 12) {
      setUi(cur => ({ ...cur, error: 'Enter a valid ticker symbol.' }))
      return
    }
    setUi(cur => ({ ...cur, loading: true, error: null, result: null }))
    try {
      const data = await analyzeSwingTrade(sym)
      setUi(cur => ({
        ...cur,
        loading: false,
        ticker: data.ticker,
        result: data,
      }))
    } catch (e) {
      setUi(cur => ({ ...cur, loading: false, error: axiosDetail(e) }))
    }
  }, [ticker, setUi])

  useEffect(() => {
    const t = searchParams.get('ticker')?.trim().toUpperCase()
    if (t && t.length <= 12) {
      setUi(cur => ({ ...cur, ticker: t }))
      autoRunRef.current = true
    }
  }, [searchParams, setUi])

  useEffect(() => {
    if (!autoRunRef.current || !ticker.trim()) return
    const urlT = searchParams.get('ticker')?.trim().toUpperCase()
    if (urlT && urlT !== ticker.trim().toUpperCase()) return
    autoRunRef.current = false
    runScan()
  }, [ticker, runScan, searchParams])

  // Default to SPY on first load when no ticker and no result
  const didDefaultRef = useRef(false)
  useEffect(() => {
    if (didDefaultRef.current) return
    if (ticker.trim() || result) return
    didDefaultRef.current = true
    setUi(cur => ({ ...cur, ticker: 'SPY' }))
    runScan('SPY')
  }, [ticker, result, runScan, setUi])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 2800)
    return () => clearTimeout(t)
  }, [notice])

  const handleSaveToJournal = useCallback(async () => {
    if (!result || !user?.email) return
    const m = result.metrics as Record<string, unknown>
    const el = computeExecLevels(result, m)
    const se = m.spread_entry as Record<string, unknown> | null | undefined
    const today = new Date().toISOString().split('T')[0]
    const parsePrice = (s: string | null | undefined): number => {
      if (!s) return 0
      const n = parseFloat(String(s).replace(/[^0-9.-]/g, ''))
      return Number.isFinite(n) ? n : 0
    }
    const dte = result.recommended_contract_duration
      ? Math.max(1, parseInt(result.recommended_contract_duration) || 45)
      : 45
    const expiry = se?.expiry
      ? String(se.expiry)
      : new Date(Date.now() + dte * 86400000).toISOString().slice(0, 10)
    const lastPrice = typeof m.last_price === 'number' ? m.last_price : 0

    // Parse option type from leg descriptor like "Long $430C" or "Short $440P"
    const parseOptType = (leg: string): string => {
      const last = leg.trim().slice(-1)
      return last === 'P' ? 'PUT' : 'CALL'
    }
    const buildLegs = (): object[] => {
      if (!se) return []
      const debit = Number(se.est_debit ?? 0)  // net debit per share for the spread
      const legs: object[] = [{
        action: 'BUY',
        option_type: parseOptType(String(se.long_leg || '')),
        strike: Number(se.long_strike ?? 0),
        expiry,
        delta: 0,
        mid_price: debit,  // spread net debit per share as entry price
      }]
      if (se.short_leg && se.short_strike) {
        legs.push({
          action: 'SELL',
          option_type: parseOptType(String(se.short_leg)),
          strike: Number(se.short_strike),
          expiry,
          delta: 0,
          mid_price: 0,  // sell leg entry at 0; net debit captures the cost
        })
      }
      return legs
    }

    try {
      await saveToJournal(user.email, {
        ticker:           result.ticker,
        company_name:     result.company_name || '',
        strategy:         String(se?.strategy || result.suggested_strategy || (result.bias === 'short' ? 'Long Put' : 'Long Call')),
        bias:             result.bias === 'long' ? 'Bullish' : result.bias === 'short' ? 'Bearish' : 'Neutral',
        legs:             buildLegs(),
        expiry,
        entry_date:       today,
        dte_at_entry:     dte,
        net_credit:       se ? -Number(se.est_debit ?? 0) : 0,
        max_profit:       Number(se?.max_gain ?? 0),
        max_loss:         Number(se?.max_loss ?? 0),
        underlying_entry: lastPrice,
        prob_of_profit:   0,
        expected_value:   0,
        total_score:      result.trade_quality_score ?? 0,
        trade_type:       'swing',
        engine_signal:    result.decision_label || result.final_action || '',
        engine_state:     1,
        notes:            [
          el.pullbackZone ? `Pullback: ${el.pullbackZone}` : '',
          el.breakoutTrigger ? `Breakout: ${el.breakoutTrigger}` : '',
          el.firstTarget ? `Target: ${el.firstTarget}` : '',
          el.stretchTarget ? `Stretch: ${el.stretchTarget}` : '',
          el.riskBelow ? `Stop: ${el.riskBelow}` : '',
        ].filter(Boolean).join(' · '),
      })
      setNotice({ tone: 'success', message: `${result.ticker} (1× swing) saved to Trade Journal.` })
      setSavedToJournal(true)
      setTimeout(() => setSavedToJournal(false), 4000)
    } catch {
      setNotice({ tone: 'info', message: 'Failed to save to journal. Please try again.' })
    }
  }, [result, user])

  const handleAddPosition = useCallback(() => {
    if (!result) return
    const dte = result.recommended_contract_duration
      ? Math.max(1, parseInt(result.recommended_contract_duration) || 45)
      : 45
    const expiry = new Date(Date.now() + dte * 86400000).toISOString().slice(0, 10)
    const m = result.metrics as Record<string, unknown>
    const el = computeExecLevels(result, m)
    const parsePrice = (s: string | null): number | undefined => {
      if (!s) return undefined
      const n = parseFloat(s.replace(/[^0-9.-]/g, ''))
      return Number.isFinite(n) ? n : undefined
    }
    const lastPrice = typeof m.last_price === 'number' ? m.last_price : undefined
    addManualPosition({
      ticker: result.ticker,
      companyName: result.company_name,
      strategy: result.suggested_strategy && result.suggested_strategy !== 'NO_TRADE' ? result.suggested_strategy : 'Long Call',
      bias: result.bias === 'short' ? 'Bearish' : 'Bullish',
      legs: [],
      expiry,
      dte,
      net_credit: 0,
      spread_width: 0,
      max_profit: 0,
      max_loss: 0,
      prob_of_profit: 0,
      expected_value: 0,
      scores_total: result.confidence || 0,
      contracts: 1,
      breakeven_lower: 0,
      breakeven_upper: 0,
      entryPrice: lastPrice ?? 0,
      source: 'swing',
      notes: `Swing: ${result.final_action?.replace(/_/g, ' ') || ''}`,
      target1: parsePrice(el.firstTarget),
      target2: parsePrice(el.stretchTarget),
      breakout: parsePrice(el.breakoutTrigger),
      stopLoss: parsePrice(el.riskBelow),
    })
    setNotice({ tone: 'success', message: `${result.ticker} added to Positions Center.` })
    setEnterOpen(false)
  }, [result, addManualPosition])

  const [searchOpen, setSearchOpen] = useState(false)

  return (
    <div className="swing-trade-page min-h-screen p-4 md:p-6 text-primary">
      <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 items-start">
        {/* Mobile/tablet search toggle */}
        <button
          type="button"
          onClick={() => setSearchOpen(p => !p)}
          className="lg:hidden w-full flex items-center gap-2 rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900 px-4 py-3 text-sm font-semibold text-secondary"
        >
          <Search size={16} />
          {searchOpen ? 'Hide search' : 'Show search'}
        </button>

        {/* Left: Search panel */}
        <div className={`${searchOpen ? 'block' : 'hidden'} lg:block w-full lg:w-80 shrink-0 lg:sticky lg:top-6 space-y-4`}>
          {/* Header moved to left side */}
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {searchParams.get('from') && (
                  <button
                    type="button"
                    onClick={() => navigate(searchParams.get('from')!)}
                    className="rounded-full border border-slate-200 dark:border-white/[0.07] px-2 py-1 text-[10px] text-secondary"
                  >
                    <ArrowLeft size={12} /> Back
                  </button>
                )}
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-600/20 border border-violet-700 text-violet-400">
                  <TrendingUp size={14} />
                </div>
                <h1 className="text-sm font-bold tracking-tight text-heading">Swing Trade</h1>
                <span className="rounded-full border border-semantic-info-border bg-semantic-info-bg px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-semantic-info">Multi-Day</span>
              </div>
              <p className="mt-1 text-[11px] leading-snug text-gray-400">Daily OHLCV scanner — MA20/MA50, RSI, MACD, momentum, volume trend, and SPY/VIX context for 2–5 day swing setups.</p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => void runScan()}
                disabled={loading}
                className="rounded-full border border-gray-700 px-2.5 py-1 text-[10px] font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50"
              >
                <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>

          <section className="rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900 p-4 sm:p-5">
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Ticker</label>
            <div className="flex flex-col sm:flex-row lg:flex-col gap-2">
              <input
                ref={inputRef}
                className="flex-1 min-w-0 rounded-lg border border-slate-200 dark:border-white/[0.08] bg-slate-50 dark:bg-slate-800/50 px-4 py-3 font-mono text-lg uppercase outline-none placeholder:text-muted focus:border-violet-500"
                placeholder="NVDA, AAPL, SPY…"
                value={ticker}
                onChange={e => setUi(cur => ({ ...cur, ticker: e.target.value.toUpperCase() }))}
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
            {myTickers.length > 0 && (
              <div className="flex gap-2 mt-3 flex-wrap">
                <span className="text-xs text-gray-500 self-center">Quick:</span>
                {myTickers.map((t: string) => (
                  <a key={t} href={`/swing-trade?ticker=${encodeURIComponent(t)}`}
                    onClick={(e) => { e.preventDefault(); setUi(cur => ({ ...cur, ticker: t })); void runScan(t) }}
                    className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors font-mono inline-block cursor-pointer"
                  >
                    {t}
                  </a>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Right: Content */}
        <div className="flex-1 min-w-0 space-y-4">



        {/* Error */}
        {error && (
        <div className="rounded-xl border border-rose-700/40 bg-rose-950/20 px-4 py-3 text-sm text-rose-200 flex gap-2">
          <ShieldAlert className="shrink-0 mt-0.5" size={16} />
          {error}
        </div>
      )}

      {notice && (
        <div className={`rounded-xl px-4 py-3 text-sm flex gap-2 ${
          notice.tone === 'success'
            ? 'border border-emerald-700/40 bg-emerald-950/20 text-emerald-200'
            : 'border border-sky-700/40 bg-sky-950/20 text-sky-200'
        }`}>
          <ShieldAlert className="shrink-0 mt-0.5" size={16} />
          {notice.message}
        </div>
      )}

      {/* Result panel */}
      {result && (
        <>
          <SwingTradeEnginePanel
            result={result}
            existingPositions={existingPositions}
            onRefresh={() => void runScan()}
            refreshing={loading}
            onRequestEnterActiveTrade={() => setEnterOpen(true)}
            onViewPositions={() => navigate(ROUTES.positions)}
            onOpenStrategyFinder={() => navigate(`${ROUTES.strategyFinder}?ticker=${encodeURIComponent(result.ticker)}`)}
            onOpenCommandCenter={() => navigate(`${ROUTES.tradeCommandCenter}?ticker=${encodeURIComponent(result.ticker)}`)}
            onCreateAlert={() => setAlertOpen(true)}
            onSaveToJournal={() => void handleSaveToJournal()}
            savedToJournal={savedToJournal}
          />
        </>
      )}

      {/* Methodology note */}
      <details className="group rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900 overflow-hidden">
        <summary className="flex cursor-pointer items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-secondary hover:bg-surface-muted/30">
          <span className="flex items-center gap-2">
            <BarChart2 size={16} className="text-violet-400" />
            How swing scoring works
          </span>
          <ChevronDown size={16} className="text-muted transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t border-slate-100 dark:border-white/[0.05] px-4 pb-4 space-y-3 text-xs text-gray-500 pt-3">
          <p>
            The engine fetches <span className="text-secondary">daily candles</span> (60+ bars) and scores seven signal groups for both bull and bear sides, then subtracts a{' '}
            <span className="text-secondary">VIX caution penalty</span> when the fear gauge is elevated.
          </p>
          <ul className="space-y-1.5 list-none">
            <li><span className="font-semibold text-tertiary">MA alignment</span> — price vs MA20 and MA50 (±2 pts)</li>
            <li><span className="font-semibold text-tertiary">MA trend</span> — slope and spacing of MA20/MA50 (±2 pts)</li>
            <li><span className="font-semibold text-tertiary">RSI</span> — momentum health and extreme zones (±1.5 pts)</li>
            <li><span className="font-semibold text-tertiary">MACD</span> — histogram trend + crossover (±2.5 pts)</li>
            <li><span className="font-semibold text-tertiary">Momentum</span> — 5-day price change (±1 pt)</li>
            <li><span className="font-semibold text-tertiary">Volume</span> — rising vs declining trend (±1.5 pts)</li>
            <li><span className="font-semibold text-tertiary">SPY context</span> — SPY vs own MA20 (±0.5 pt)</li>
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
      </details>

      {/* Add to Positions modal */}
      {enterOpen && result && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal>
          <div className="w-full max-w-md rounded-2xl border border-gray-700 bg-gray-900 shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
              <div className="text-base font-bold text-white">Add Swing Position</div>
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
              <div className="rounded-lg bg-gray-800/40 border border-gray-700/50 px-3 py-2.5 space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Ticker</span>
                  <span className="text-gray-200 font-bold">{result.ticker}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Source</span>
                  <span className="text-gray-200 font-bold">Swing Trade Engine</span>
                </div>
                {result.suggested_strategy && result.suggested_strategy !== 'NO_TRADE' && (
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Strategy</span>
                    <span className="text-violet-300 font-bold">{result.suggested_strategy.replace(/_/g, ' ')}</span>
                  </div>
                )}
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Final Action</span>
                  <span className="text-gray-200 font-bold">{result.final_action.replace(/_/g, ' ')}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Expected Hold</span>
                  <span className="text-gray-200 font-bold">{result.expected_holding_period || '3–5 trading days'}</span>
                </div>
                {result.recommended_contract_duration && (
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Contract Window</span>
                    <span className="text-gray-200 font-bold">{result.recommended_contract_duration} DTE</span>
                  </div>
                )}
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Signal Strength</span>
                  <span className="text-gray-200 font-bold">{Math.min(result.confidence, 95)}</span>
                </div>
              </div>
              <p className="text-xs text-gray-500">
                Adds 1 contract swing position with basic details. Edit entry price, strike, and expiry in Positions Center later.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleAddPosition}
                  className="flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-2.5 text-sm transition-colors"
                >
                  Add Position (1 contract)
                </button>
                <button
                  type="button"
                  onClick={() => setEnterOpen(false)}
                  className="flex-1 rounded-xl border border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 font-semibold py-2.5 text-sm transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {alertOpen && result && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal>
          <div className="w-full max-w-md rounded-2xl border border-gray-700 bg-gray-900 shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
              <div className="text-base font-bold text-white">Create Swing Alert</div>
              <button
                type="button"
                onClick={() => setAlertOpen(false)}
                className="text-gray-500 hover:text-gray-300 p-1"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <div className="rounded-lg bg-gray-800/40 border border-gray-700/50 px-3 py-2.5 space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Ticker</span>
                  <span className="text-gray-200 font-bold">{result.ticker}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Engine</span>
                  <span className="text-gray-200 font-bold">Swing Trade</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Alert Focus</span>
                  <span className="text-amber-300 font-bold">{result.final_action.replace(/_/g, ' ')}</span>
                </div>
                <div className="pt-1 text-xs text-gray-300 leading-relaxed">
                  {result.decision_message || 'Use alerts to catch the next valid pullback, breakout, or risk-management change.'}
                </div>
              </div>
              <p className="text-xs text-gray-500">
                Open Alert Center to create a ticker alert with this swing setup in mind.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => navigate(`${ROUTES.alerts}?ticker=${encodeURIComponent(result.ticker)}`)}
                  className="flex-1 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold py-2.5 text-sm transition-colors"
                >
                  Open Alert Center
                </button>
                <button
                  type="button"
                  onClick={() => setAlertOpen(false)}
                  className="flex-1 rounded-xl border border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 font-semibold py-2.5 text-sm transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>{/* end right content */}
    </div>{/* end flex container */}
  </div>
  )
}
