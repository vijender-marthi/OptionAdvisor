import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowUpRight, BarChart2, Bell, ChevronDown, ChevronRight, Flame, Loader2, RefreshCw, Search, ShieldAlert, TrendingUp, X, Zap, PlusCircle, Activity, Check } from 'lucide-react'
import PriceChart from '../components/PriceChart'
import SwingTradeWalkthrough from '../components/SwingTradeWalkthrough'
import { analyzeSwingTrade, analyzeV2, saveToJournal, deskApi } from '../api/client'
import type { DeskAlertCreate, UnifiedAnalysis } from '../api/client'
import { fetchMyTickers } from '../api/commandCenter'
import SetAlertDrawer from '../components/desk/SetAlertDrawer'
import UnifiedVerdictCard from '../components/UnifiedVerdictCard'
import { computeExecLevels } from '../components/SwingTradeEnginePanel'
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
    theme,
  } = useApp()
  const isDark = theme !== 'light'
  const st = {
    bg:     isDark ? '#111318' : '#FFFFFF',
    bgDeep: isDark ? '#181C23' : '#F8F9FB',
    border: isDark ? '#1E2330' : '#E5E7EB',
    text:   isDark ? '#E8EBF0' : '#111827',
    muted:  isDark ? '#5A6478' : '#6B7280',
    green:  isDark ? '#00E5A0' : '#00A86B',
    red:    isDark ? '#FF4D6D' : '#DC2626',
    amber:  isDark ? '#F5A623' : '#D97706',
    accent: '#4A7CFF',
    violet: '#6B7FD4',
  }
  const { ticker, loading, error, result, glossaryOpen } = ui

  const existingPositions = useMemo(
    () => portfolio.filter(p => p.ticker.toUpperCase() === result?.ticker?.toUpperCase() && p.status === 'open'),
    [portfolio, result?.ticker]
  )
  const [enterOpen, setEnterOpen] = useState(false)
  const [alertOpen, setAlertOpen] = useState(false)
  const [unified, setUnified] = useState<UnifiedAnalysis | null>(null)
  const [notice, setNotice] = useState<{ tone: 'success' | 'info'; message: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
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
      try { const v2 = await analyzeV2(sym, 'swing'); setUnified(v2.data) } catch { /* non-fatal */ }
    } catch (e) {
      setUi(cur => ({ ...cur, loading: false, error: axiosDetail(e) }))
    }
  }, [ticker, setUi])

  useEffect(() => {
    const t = searchParams.get('ticker')?.trim().toUpperCase()
    if (t && t.length <= 12) {
      setUi(cur => ({ ...cur, ticker: t }))
    }
  }, [searchParams, setUi])

  // Reload on mount: use URL ticker, or default to SPY if none
  const didMountRef = useRef(false)
  useEffect(() => {
    if (didMountRef.current) return
    didMountRef.current = true
    const urlT = searchParams.get('ticker')?.trim().toUpperCase()
    const sym = urlT && urlT.length <= 12 ? urlT : ticker.trim().toUpperCase() || 'SPY'
    if (sym !== ticker.trim().toUpperCase()) {
      setUi(cur => ({ ...cur, ticker: sym }))
    }
    runScan(sym)
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

  const handleCreateAlert = useCallback(async (data: DeskAlertCreate) => {
    await deskApi.createAlert(data)
    setAlertOpen(false)
  }, [])

  const [searchOpen, setSearchOpen] = useState(false)

  return (
    <div className="swing-trade-page min-h-screen p-4 md:p-6" style={{ background: isDark ? '#0A0C10' : '#F3F4F6', color: st.text }}>
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
              <p className="mt-1 text-[11px] leading-snug" style={{ color: st.muted }}>Daily OHLCV scanner — MA20/MA50, RSI, MACD, momentum, volume trend, and SPY/VIX context for 2–5 day swing setups.</p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => void runScan()}
                disabled={loading}
                className="rounded-full px-2.5 py-1 text-[10px] font-semibold disabled:opacity-50"
                style={{ border: `1px solid ${st.border}`, color: st.muted, background: 'transparent' }}
              >
                <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>

          <section className="rounded-xl p-4 sm:p-5" style={{ background: st.bg, border: `1px solid ${st.border}` }}>
            <div className="flex flex-col sm:flex-row lg:flex-col gap-2">
              <input
                ref={inputRef}
                className="flex-1 min-w-0 rounded-lg px-4 py-3 font-mono text-lg uppercase outline-none"
                style={{ background: st.bgDeep, border: `1px solid ${st.border}`, color: st.text }}
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
            <p className="text-[11px] mt-2" style={{ color: st.muted }}>
              Uses daily OHLCV bars from Yahoo Finance. Evaluates MA20/MA50 alignment and slope, RSI, MACD crossover, 5-day momentum, volume trend, and SPY/VIX context for overnight or 2–5 day swing trade setups.
            </p>
            {myTickers.length > 0 && (
              <div className="flex gap-2 mt-3 flex-wrap">
                <span className="text-xs self-center" style={{ color: st.muted }}>Quick:</span>
                {myTickers.map((t: string) => (
                  <a key={t} href={`/swing-trade?ticker=${encodeURIComponent(t)}`}
                    onClick={(e) => { e.preventDefault(); setUi(cur => ({ ...cur, ticker: t })); void runScan(t) }}
                    className="text-xs px-2 py-1 rounded-lg transition-colors font-mono inline-block cursor-pointer"
                    style={{ background: st.bgDeep, color: st.text, border: `1px solid ${st.border}` }}
                  >
                    {t}
                  </a>
                ))}
              </div>
            )}
          </section>

          {/* Already in Position */}
          {existingPositions.length > 0 && (
            <div className="rounded-xl border border-amber-600/40 bg-amber-950/30 px-3 py-3 space-y-2">
              <div className="flex items-center gap-2">
                <Check size={14} className="text-amber-400 shrink-0" />
                <span className="text-xs font-bold text-amber-300 uppercase tracking-wide">Already in Position</span>
                {(() => {
                  const lp = existingPositions[existingPositions.length - 1]
                  return lp?.source && (
                    <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                      lp.source === 'day'   ? 'border-orange-600/40 bg-orange-900/30 text-orange-300' :
                      lp.source === 'swing' ? 'border-blue-600/40 bg-blue-900/30 text-blue-300' :
                                             'border-gray-600/40 bg-gray-800/50 text-gray-400'
                    }`}>{lp.source}</span>
                  )
                })()}
              </div>
              {(() => {
                const lp = existingPositions[existingPositions.length - 1]
                if (!lp) return null
                return (
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-amber-200/80">
                    {lp.strategy && <span><span className="text-amber-400/60">Strategy</span> {lp.strategy}</span>}
                    {lp.contracts > 0 && <span><span className="text-amber-400/60">Contracts</span> {lp.contracts}</span>}
                    {lp.entryPrice > 0 && <span><span className="text-amber-400/60">Entry px</span> ${lp.entryPrice.toFixed(2)}</span>}
                    {lp.addedAt && <span><span className="text-amber-400/60">Added</span> {lp.addedAt.slice(0, 10)}</span>}
                  </div>
                )
              })()}
              <p className="text-[10px] text-amber-200/70 leading-snug">
                Follow your exit rules — manage this position rather than adding again without a clear plan.
              </p>
            </div>
          )}

          {/* Action buttons */}
          {result && (
          <div className="flex flex-wrap items-center gap-2">
            {existingPositions.length > 0 ? (
              <button
                type="button"
                onClick={() => navigate(ROUTES.positions)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-600/50 bg-amber-900/30 text-amber-300 hover:bg-amber-900/50 px-3.5 py-2 text-xs font-bold transition-colors"
              >
                <BarChart2 size={14} />
                View Positions
              </button>
            ) : (
            <button
              type="button"
              onClick={() => {
                if (!result) return
                const m = result.metrics
                const s = result as Record<string, unknown>
                const eg = result.entry_guidance as Record<string, unknown> | undefined
                addManualPosition({
                  ticker: result.ticker,
                  bias: result.bias,
                  strategy: String(s.suggested_strategy ?? 'SWING'),
                  contracts: 1,
                  entryPrice: (typeof eg?.breakout_level === 'number' ? eg.breakout_level : (m as Record<string, unknown>)?.last_price ?? result.metrics?.last_price) as number,
                  expiry: result.suggested_expiry_window || '',
                  notes: result.decision_message || '',
                  source: 'swing',
                  target1: (m as Record<string, unknown>)?.exec_levels ? ((m as Record<string, unknown>).exec_levels as Record<string, unknown>)?.target1 as number : undefined,
                  stopLoss: (m as Record<string, unknown>)?.exec_levels ? ((m as Record<string, unknown>).exec_levels as Record<string, unknown>)?.stop as number : undefined,
                })
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white px-3.5 py-2 text-xs font-bold transition-colors"
            >
              <PlusCircle size={14} />
              Add to Portfolio
            </button>
            )}
            <button
              type="button"
              onClick={() => setEnterOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-700 hover:bg-gray-800 text-gray-300 px-3 py-2 text-[11px] font-semibold transition-colors"
            >
              <Activity size={14} />
              Track Intraday
            </button>
            <button
              type="button"
              onClick={() => setAlertOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-700/50 hover:bg-rose-900/30 text-rose-300 px-3.5 py-2 text-xs font-bold transition-colors"
            >
              <Bell size={14} />
              Add Alert
            </button>
            <button
              type="button"
              onClick={() => navigate(`${ROUTES.strategyFinder}?ticker=${encodeURIComponent(result.ticker)}`)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-violet-700/50 hover:bg-violet-900/30 text-violet-300 px-3 py-2 text-[11px] font-semibold transition-colors"
            >
              <BarChart2 size={13} />
              Position Trading
            </button>
            <button
              type="button"
              onClick={() => void handleSaveToJournal()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-700/50 hover:bg-emerald-900/30 text-emerald-300 px-3 py-2 text-[11px] font-semibold transition-colors"
            >
              {savedToJournal ? '✓' : '📋'} {savedToJournal ? 'Saved' : 'Save to Journal'}
            </button>
          </div>
          )}
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
      {unified && (
        <div className="day-trade-unified">
          {/* Ticker header bar */}
          <div className="dt-card" style={{ background: '#111318', border: '1px solid #1E2330', borderRadius: 14, padding: '14px 18px', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="dt-primary" style={{ fontSize: '1.3rem', fontWeight: 700, fontFamily: 'monospace', color: '#E8EBF0' }}>{unified.ticker}</span>
                {unified.company && <span className="dt-muted" style={{ fontSize: '0.78rem', color: '#5A6478' }}>{unified.company}</span>}
                <span className="dt-primary" style={{ fontSize: '1.1rem', fontWeight: 700, fontFamily: 'monospace', color: '#E8EBF0' }}>${unified.price.toFixed(2)}</span>
                {unified.change_pct != null && (
                  <span style={{ fontSize: '0.82rem', fontWeight: 600, color: unified.change_pct >= 0 ? '#00E5A0' : '#FF4D6D' }}>
                    {unified.change_pct >= 0 ? '▲' : '▼'} {Math.abs(unified.change_pct).toFixed(2)}%
                  </span>
                )}
                {(() => {
                  const m = result?.metrics as Record<string, unknown> | undefined
                  const extPrice = m?.ext_market_price as number | undefined
                  if (!extPrice) return null
                  const extChg = m?.ext_market_change as number | undefined
                  const extChgPct = m?.ext_market_change_pct as number | undefined
                  const extType = m?.ext_market_type as string | undefined
                  return (
                    <>
                      <span style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '1px 6px', borderRadius: 20, border: '1px solid #6B7FD4', color: '#6B7FD4', background: 'rgba(107,127,212,0.08)' }}>{extType === 'pre' ? 'Pre' : 'AH'}</span>
                      <span className="dt-primary" style={{ fontSize: '0.82rem', fontWeight: 700, fontFamily: 'monospace', color: '#E8EBF0' }}>${extPrice.toFixed(2)}</span>
                      {extChg != null && (
                        <span style={{ fontSize: '0.72rem', fontWeight: 600, color: extChg >= 0 ? '#00A86B' : '#D0312D' }}>
                          {extChg >= 0 ? '▲' : '▼'}{Math.abs(extChg).toFixed(2)} ({(extChgPct ?? 0) >= 0 ? '+' : ''}{(extChgPct ?? 0).toFixed(2)}%)
                        </span>
                      )}
                    </>
                  )
                })()}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {unified.session && <span style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 20, border: '1px solid rgba(107,127,212,0.5)', color: '#6B7FD4', background: 'rgba(107,127,212,0.08)' }}>{unified.session}</span>}
                <div style={{ textAlign: 'center', flexShrink: 0 }}>
                  <div style={{ fontSize: '0.6rem', color: '#5A6478' }}>Bias</div>
                  <div style={{ fontSize: '0.78rem', fontWeight: 700, color: result?.bias === 'long' ? '#00A86B' : result?.bias === 'short' ? '#D0312D' : '#6B7280' }}>{result?.bias ? result.bias.charAt(0).toUpperCase() + result.bias.slice(1) : '—'}</div>
                  <div style={{ fontSize: '0.6rem', color: '#5A6478' }}>{result?.market_bias || '—'}</div>
                </div>
              </div>
            </div>
          </div>

          <UnifiedVerdictCard analysis={unified} />

          {/* Entry Plan / Risk Profile */}
          <div className="dt-card" style={{ background: '#111318', border: '1px solid #1E2330', borderRadius: 14, padding: '14px 16px', marginBottom: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              <div>
                <div className="dt-muted" style={{ fontSize: '0.68rem', fontWeight: 700, color: '#5A6478', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>Entry Plan</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid #1E2330' }}>
                  <span className="dt-muted" style={{ color: '#5A6478', fontSize: '0.82rem' }}>Entry</span>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, color: unified.entry_price ? '#00E5A0' : '#F5A623', fontSize: '0.82rem' }}>{unified.entry_price ? `$${unified.entry_price.toFixed(2)}` : (unified.entry_description || '—')}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid #1E2330' }}>
                  <span className="dt-muted" style={{ color: '#5A6478', fontSize: '0.82rem' }}>Structure</span>
                  <span className="dt-primary" style={{ fontFamily: 'monospace', color: '#E8EBF0', fontSize: '0.82rem' }}>{unified.structure || '—'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0' }}>
                  <span className="dt-muted" style={{ color: '#5A6478', fontSize: '0.82rem' }}>Stop Loss</span>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, color: unified.stop_price ? '#FF4D6D' : '#5A6478', fontSize: '0.82rem' }}>{unified.stop_price ? `$${unified.stop_price.toFixed(2)}` : '—'}</span>
                </div>
              </div>
              <div>
                <div className="dt-muted" style={{ fontSize: '0.68rem', fontWeight: 700, color: '#5A6478', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>Risk Profile</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid #1E2330' }}>
                  <span className="dt-muted" style={{ color: '#5A6478', fontSize: '0.82rem' }}>R/R Ratio</span>
                  <span className="dt-muted" style={{ fontFamily: 'monospace', color: '#5A6478', fontSize: '0.82rem' }}>{unified.rr_ratio || '—'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid #1E2330' }}>
                  <span className="dt-muted" style={{ color: '#5A6478', fontSize: '0.82rem' }}>Risk Level</span>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, color: unified.risk_level === 'LOW' ? '#00E5A0' : unified.risk_level === 'MEDIUM' ? '#F5A623' : '#FF4D6D', fontSize: '0.82rem' }}>{unified.risk_level || '—'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0' }}>
                  <span className="dt-muted" style={{ color: '#5A6478', fontSize: '0.82rem' }}>RVOL</span>
                  <span className="dt-muted" style={{ fontFamily: 'monospace', fontWeight: 700, color: '#5A6478', fontSize: '0.82rem' }}>{unified.rvol || '—'}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Exit Plan */}
          <div className="dt-card" style={{ background: '#111318', border: '1px solid #1E2330', borderRadius: 14, padding: '14px 16px', marginBottom: 12 }}>
            <div className="dt-muted" style={{ fontSize: '0.68rem', fontWeight: 700, color: '#5A6478', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>Exit Plan — Pre-Committed</div>
            {unified.exit_rows.length > 0 ? (
              <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr>{['WHEN', 'PRICE', 'ACTION'].map(h => <th key={h} className="dt-muted" style={{ textAlign: 'left', color: '#5A6478', fontWeight: 600, paddingBottom: 8, fontSize: '0.68rem', letterSpacing: '0.06em', borderBottom: '1px solid #1E2330' }}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {unified.exit_rows.map((row, i) => {
                    const isStop = row.type === 'stop'
                    const isT2 = row.type === 't2'
                    const isT1 = row.type === 't1'
                    const isTime = row.type === 'time'
                    const isStall = /stalls/i.test(row.when)
                    const clr = isT1 ? '#00E5A0' : isT2 ? '#F5A623' : (isStop || isStall) ? '#FF4D6D' : isTime ? '#6B7FD4' : '#5A6478'
                    const whenLabel = row.when
                      .replace(/^Target 1 reached$/i, 'Target 1')
                      .replace(/^Target 2 reached$/i, 'Target 2')
                      .replace(/^Stop loss$/i, 'Stop Loss')
                      .replace(/^Price closes below MA20$/i, 'MA20 Breakdown')
                      .replace(/^Price stalls at Target 1.*$/i, 'Stalls at T1')
                    return (
                      <tr key={i} style={{ borderBottom: '1px solid #1E2330' }}>
                        <td style={{ paddingTop: 8, paddingBottom: 8, color: clr, fontFamily: 'monospace', fontSize: '0.75rem', fontWeight: 600 }}>{whenLabel}</td>
                        <td style={{ paddingTop: 8, paddingBottom: 8, fontFamily: 'monospace', fontWeight: 700, color: clr }}>{row.price}</td>
                        <td style={{ paddingTop: 8, paddingBottom: 8, fontSize: '0.75rem', verticalAlign: 'top' }}>
                          <div style={{ color: clr, fontWeight: 600 }}>{row.action}</div>
                          {row.note && <div style={{ color: '#5A6478', fontSize: '0.68rem', marginTop: 2 }}>{row.note}</div>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              </div>
            ) : (
              <div className="dt-muted" style={{ color: '#5A6478', textAlign: 'center', padding: '8px 0', fontSize: '0.8rem' }}>Run full analysis for detailed exit levels</div>
            )}
          </div>

          {/* AI Coach */}
          {unified.coach && (
            <div className="dt-card" style={{ background: '#181C23', border: '1px solid #1E2330', borderRadius: 10, padding: '14px 16px', display: 'flex', gap: 14, marginBottom: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0, background: 'rgba(74,124,255,0.12)', border: '1px solid rgba(74,124,255,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem' }}>🎯</div>
              <div>
                <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#4A7CFF', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>AI Coach</div>
                <div className="dt-muted" style={{ color: '#5A6478', fontSize: '0.82rem', lineHeight: 1.6 }}>{unified.coach}</div>
              </div>
            </div>
          )}

        </div>
      )}

      {/* Price chart */}
      {result && result.metrics && (() => {
        const m = result.metrics as Record<string, unknown>
        const rawHistory = m.price_history as Record<string, unknown>[] | undefined
        if (!rawHistory || !Array.isArray(rawHistory) || rawHistory.length < 2) return null
        const history = rawHistory as unknown as import('../types').PricePoint[]
        return (
          <div className="dt-card" style={{ background: '#111318', border: '1px solid #1E2330', borderRadius: 14, padding: '14px 16px', marginBottom: 12 }}>
            <div className="dt-muted" style={{ fontSize: '0.68rem', fontWeight: 700, color: '#5A6478', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Price Chart</div>
            <PriceChart history={history} />
          </div>
        )
      })()}

      {/* Step-by-step walkthrough */}
      {unified && result && (
        <SwingTradeWalkthrough unified={unified} result={result} />
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
        <SetAlertDrawer
          ticker={result.ticker}
          tradeType="swing"
          onClose={() => setAlertOpen(false)}
          onSubmit={handleCreateAlert}
          drawerLeft={0}
        />
      )}
      </div>{/* end right content */}
    </div>{/* end flex container */}
  </div>
  )
}
