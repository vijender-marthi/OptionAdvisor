/**
 * Day Trade Hub — Features 1, 2, 4, 6 + Sigma Band context.
 *
 * Tabs:
 *   Pre-Market Bias (F1) — runs before 6:30 AM PT, 60s refresh
 *   Early Entry (F2)     — 7:00–7:30 AM PT, 30s refresh, Trade Card (F4)
 *                          (Yahoo 1m bars have ~30min lag; data reliable from 7:00 AM PT)
 *   OCO Explainer (F6)   — static calculator
 *
 * VWAP Zone Rejection (F3) signals surface inside the Day Trade page (existing).
 */
import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle, RefreshCw, Star, TrendingUp, TrendingDown,
  Minus, CheckCircle, XCircle, Clock, Calculator, Target,
  Activity, ChevronDown, ChevronUp,
} from 'lucide-react'
import {
  fetchPremarketBias, fetchEarlyEntryTrigger,
  type PremarketBiasData, type EarlyEntryResult,
} from '../api/commandCenter'
import { getProfitLossTextClass, getActionButtonClass } from '../utils/semanticTrading'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtUsd(n: unknown): string {
  if (n == null) return '—'
  const x = Number(n)
  if (!Number.isFinite(x)) return '—'
  return `${x < 0 ? '-' : ''}$${Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function SignalIcon({ signal }: { signal: string }) {
  if (signal === 'bull') return <CheckCircle size={14} className="text-emerald-400 shrink-0" />
  if (signal === 'bear') return <XCircle size={14} className="text-rose-400 shrink-0" />
  return <Minus size={14} className="text-slate-400 shrink-0" />
}

function ConditionPill({ cond }: { cond: string | undefined }) {
  const cls =
    cond === 'bull' ? 'bg-emerald-900/30 text-emerald-300 border-emerald-700' :
    cond === 'bear' ? 'bg-rose-900/30 text-rose-300 border-rose-700' :
    'bg-slate-800/50 text-slate-400 border-slate-600'
  const label = cond === 'bull' ? '✅ BULL' : cond === 'bear' ? '❌ BEAR' : '➖ WAIT'
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${cls}`}>{label}</span>
}

// ─── F4: Trade Output Card ────────────────────────────────────────────────────

function TradeOutputCard({
  symbol, direction, entry, stop, target1, target2, rr, atr, trigger,
}: {
  symbol: string
  direction: 'CALL' | 'PUT'
  entry: number
  stop: number
  target1: number
  target2: number
  rr: number
  atr?: number | null
  trigger?: string
}) {
  const today = new Date()
  const isFriday = today.getDay() === 5
  const dte = isFriday ? '3–4 DTE (next Tue/Wed)' : '1 DTE'
  const strike = direction === 'CALL'
    ? Math.ceil(entry) + 1
    : Math.floor(entry) - 1

  const dirCls = direction === 'CALL'
    ? 'text-emerald-400 bg-emerald-900/20 border-emerald-700'
    : 'text-rose-400 bg-rose-900/20 border-rose-700'

  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-slate-900 overflow-hidden">
      {/* Header */}
      <div className={`flex items-center justify-between px-4 py-3 border-b border-white/[0.06] ${dirCls}`}>
        <span className="font-mono text-lg font-bold tracking-tight">{symbol}</span>
        <span className={`rounded-full border px-3 py-0.5 text-sm font-bold uppercase tracking-wide ${dirCls}`}>
          {direction}
        </span>
      </div>

      {/* Levels */}
      <div className="px-4 py-3 space-y-1.5 text-sm font-mono">
        <div className="flex justify-between">
          <span className="text-secondary">Entry</span>
          <span className="font-bold text-primary">{fmtUsd(entry)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-rose-400">Stop Loss</span>
          <span className="font-bold text-rose-400">{fmtUsd(stop)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-amber-400">Target 1</span>
          <span className="font-bold text-amber-400">{fmtUsd(target1)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-emerald-400">Target 2</span>
          <span className="font-bold text-emerald-400">{fmtUsd(target2)}</span>
        </div>
        <div className="flex justify-between pt-1 border-t border-white/[0.06]">
          <span className="text-secondary">R/R</span>
          <span className={`font-bold tabular-nums ${rr >= 1.5 ? 'text-emerald-400' : 'text-rose-400'}`}>{rr.toFixed(1)}x</span>
        </div>
        {atr != null && (
          <div className="flex justify-between text-xs text-muted">
            <span>ATR(14)</span>
            <span>{fmtUsd(atr)}</span>
          </div>
        )}
      </div>

      {/* Option suggestion */}
      <div className="px-4 py-2.5 border-t border-white/[0.06] bg-slate-50 dark:bg-slate-800/50">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted mb-1">Option</div>
        <div className="text-sm font-mono text-primary">
          ${strike} {direction} · {dte}
        </div>
      </div>

      {/* Trigger */}
      {trigger && (
        <div className="px-4 py-2 border-t border-white/[0.06] text-xs text-tertiary">
          <span className="font-semibold">Trigger:</span> {trigger}
        </div>
      )}

      {/* Friday warning */}
      {isFriday && (
        <div className="px-4 py-2 border-t border-rose-600/30 bg-rose-900/20 text-xs text-rose-300 font-semibold">
          ⚠️ Friday — Use 3–4 DTE minimum. No 0DTE.
        </div>
      )}
    </div>
  )
}

// ─── F1: Pre-Market Bias Tab ──────────────────────────────────────────────────

function PreMarketBiasTab() {
  const [data, setData]     = useState<PremarketBiasData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const load = useCallback(async (force = false) => {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchPremarketBias(force)
      setData(result)
      setLastRefresh(new Date())
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  // 60-second auto-refresh
  useEffect(() => {
    void load()
    const id = setInterval(() => void load(), 60_000)
    return () => clearInterval(id)
  }, [load])

  const biasColor =
    data?.bias === 'BULLISH' ? 'text-emerald-400' :
    data?.bias === 'BEARISH' ? 'text-rose-400' :
    'text-slate-400'

  return (
    <div className="space-y-4">
      {/* Friday override */}
      {data?.friday_warning && (
        <div className="flex items-center gap-2.5 rounded-xl border border-rose-600/40 bg-rose-900/20 px-4 py-3 text-sm font-bold text-rose-300">
          <AlertTriangle size={16} className="shrink-0" />
          {data.friday_warning}
        </div>
      )}

      {/* Main bias card */}
      <div className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-slate-900 p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1">
              Pre-Market Bias
            </div>
            {loading && !data ? (
              <div className="flex items-center gap-2 text-sm text-muted">
                <RefreshCw size={14} className="animate-spin" /> Fetching...
              </div>
            ) : (
              <div className={`text-2xl font-black tracking-tight ${biasColor}`}>
                {data?.bias ?? '—'}
              </div>
            )}
            {/* Confidence stars */}
            {data && (
              <div className="flex items-center gap-0.5 mt-1">
                {Array.from({ length: 5 }, (_, i) => (
                  <Star key={i} size={12} className={i < (data.confidence ?? 0) ? 'text-amber-400 fill-amber-400' : 'text-slate-600'} />
                ))}
                <span className="ml-1.5 text-xs text-muted">{data.confidence}/5</span>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => void load(true)}
            className={`${getActionButtonClass('surface')} rounded-lg p-2`}
            title="Refresh"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Action */}
        {data && (
          <div className={`rounded-lg border px-3 py-2 text-sm font-bold ${
            data.action === 'Favor CALLS' ? 'bg-emerald-900/20 border-emerald-700 text-emerald-300' :
            data.action === 'Favor PUTS'  ? 'bg-rose-900/20 border-rose-700 text-rose-300' :
            'bg-slate-800/50 border-slate-600 text-slate-300'
          }`}>
            Recommended: {data.action}
          </div>
        )}

        {/* Conditions */}
        {data?.conditions && (
          <div className="space-y-2">
            {data.conditions.map((c, i) => (
              <div key={i} className="flex items-center gap-2.5 text-sm">
                <SignalIcon signal={c.signal} />
                <span className="text-secondary flex-1">{c.label}</span>
                <span className={`font-mono text-xs font-semibold ${
                  c.signal === 'bull' ? 'text-emerald-400' :
                  c.signal === 'bear' ? 'text-rose-400' :
                  'text-muted'
                }`}>{c.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Score */}
        {data && (
          <div className="flex items-center justify-between text-xs text-muted border-t border-white/[0.05] pt-3">
            <span>Score: <span className="font-semibold text-primary">{data.score > 0 ? `+${data.score}` : data.score}/5</span></span>
            {lastRefresh && <span><Clock size={10} className="inline mr-1" />Updated {lastRefresh.toLocaleTimeString()}</span>}
          </div>
        )}

        {error && <p className="text-xs text-rose-400">{error}</p>}
      </div>

      {/* Sigma band context note */}
      <div className="rounded-xl border border-white/[0.06] bg-slate-800/40 px-4 py-3 text-xs text-secondary space-y-1">
        <div className="font-semibold text-primary text-[11px] uppercase tracking-wide mb-1.5">VWAP Sigma Context</div>
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-emerald-500/50 shrink-0" /> Price above VWAP — bullish channel</div>
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-amber-500/50 shrink-0" /> Price between −1σ and VWAP — caution</div>
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-orange-500/50 shrink-0" /> Price between −1σ and −2σ — ⚠️ −1σ Resistance</div>
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-rose-600/50 shrink-0" /> Price below −2σ — 🔴 −2σ Breakdown, high momentum bearish</div>
      </div>
    </div>
  )
}

// ─── F2: Early Entry Trigger Tab ─────────────────────────────────────────────

const EARLY_ENTRY_TICKERS = ['QQQ', 'SPY', 'NVDA', 'AAPL']

function EarlyEntryTab() {
  const [ticker, setTicker]   = useState('QQQ')
  const [data, setData]       = useState<EarlyEntryResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const load = useCallback(async (force = false) => {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchEarlyEntryTrigger(ticker, force)
      setData(result)
      setLastRefresh(new Date())
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [ticker])

  // 30-second auto-refresh
  useEffect(() => {
    void load()
    const id = setInterval(() => void load(), 30_000)
    return () => clearInterval(id)
  }, [load])

  const statusColor =
    data?.status === 'ENTRY' ? 'text-emerald-400' :
    data?.status === 'SKIP'  ? 'text-amber-400' :
    data?.status === 'NO_SETUP' || data?.status === 'TIMEOUT' ? 'text-rose-400' :
    'text-slate-400'

  const condIcon = (c: string | undefined) => {
    if (c === 'bull') return <CheckCircle size={13} className="text-emerald-400 shrink-0" />
    if (c === 'bear') return <XCircle size={13} className="text-rose-400 shrink-0" />
    if (c === 'mixed') return <AlertTriangle size={13} className="text-amber-400 shrink-0" />
    return <Clock size={13} className="text-slate-500 shrink-0" />
  }

  return (
    <div className="space-y-4">
      {/* Ticker selector */}
      <div className="flex items-center gap-2 flex-wrap">
        {EARLY_ENTRY_TICKERS.map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setTicker(t)}
            className={`rounded-lg px-3 py-1.5 text-sm font-bold transition-colors ${
              ticker === t
                ? 'bg-violet-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-muted hover:text-secondary'
            }`}
          >{t}</button>
        ))}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => void load(true)}
          className={`${getActionButtonClass('surface')} rounded-lg p-2`}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Status card */}
      <div className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-slate-900 p-4 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1">
              Early Entry — 7:00 AM Window
            </div>
            <div className={`text-xl font-black tracking-tight ${statusColor}`}>
              {loading && !data ? 'Loading...' : data?.status ?? '—'}
            </div>
          </div>
          {data?.direction && (
            <span className={`rounded-full border px-3 py-0.5 text-sm font-bold uppercase ${
              data.direction === 'CALL'
                ? 'bg-emerald-900/20 border-emerald-700 text-emerald-400'
                : 'bg-rose-900/20 border-rose-700 text-rose-400'
            }`}>{data.direction}</span>
          )}
        </div>

        {/* Message */}
        {data?.message && (
          <p className={`text-sm font-semibold ${statusColor}`}>{data.message}</p>
        )}

        {/* Conditions A/B/C */}
        {data && (
          <div className="space-y-2.5">
            {[
              { label: 'A — First 5-min candle (7:00–7:05 AM PT)', cond: data.condition_a, detail: data.condition_a_detail },
              { label: 'B — VWAP position at 7:05 AM PT',          cond: data.condition_b, detail: data.condition_b_detail },
              { label: 'C — 2 consecutive 1M candles',       cond: data.condition_c, detail: data.condition_c_detail },
            ].map(r => (
              <div key={r.label} className="rounded-lg border border-white/[0.05] bg-slate-50 dark:bg-slate-800/50 px-3 py-2">
                <div className="flex items-center gap-2">
                  {condIcon(r.cond)}
                  <span className="text-xs font-semibold text-secondary">{r.label}</span>
                  <div className="flex-1" />
                  <ConditionPill cond={r.cond} />
                </div>
                {r.detail && <p className="text-xs text-tertiary mt-1 ml-5">{r.detail}</p>}
              </div>
            ))}
          </div>
        )}

        {/* VWAP */}
        {data?.vwap != null && (
          <div className="text-xs text-muted">
            VWAP at 7:05: <span className="font-mono font-semibold text-sky-400">${data.vwap.toFixed(2)}</span>
          </div>
        )}

        {lastRefresh && (
          <div className="text-[10px] text-muted border-t border-white/[0.05] pt-2">
            <Clock size={10} className="inline mr-1" />Updated {lastRefresh.toLocaleTimeString()} · 30s auto-refresh
          </div>
        )}
        {error && <p className="text-xs text-rose-400">{error}</p>}
      </div>

      {/* Trade Output Card when entry triggered */}
      {data?.status === 'ENTRY' && data.entry != null && data.stop != null && data.target_1 != null && data.target_2 != null && data.rr_ratio != null && (
        <TradeOutputCard
          symbol={ticker}
          direction={data.direction!}
          entry={data.entry}
          stop={data.stop}
          target1={data.target_1}
          target2={data.target_2}
          rr={data.rr_ratio}
          atr={data.atr14}
          trigger={data.trigger}
        />
      )}
    </div>
  )
}

// ─── F6: OCO Trailing Stop Explainer ─────────────────────────────────────────

function OcoExplainerTab() {
  const [totalShares, setTotalShares] = useState('')
  const [pctA, setPctA] = useState('')
  const [pctB, setPctB] = useState('')
  const [sharesA, setSharesA] = useState('')
  const [sharesB, setSharesB] = useState('')
  const [currentPrice, setCurrentPrice] = useState('')

  const ts  = parseFloat(totalShares) || 0
  const pa  = parseFloat(pctA) || 0
  const pb  = parseFloat(pctB) || 0
  const sa  = parseFloat(sharesA) || ts
  const sb  = parseFloat(sharesB) || ts
  const px  = parseFloat(currentPrice) || 0

  const tighter = Math.min(pa, pb)
  const wider   = Math.max(pa, pb)
  const overlap = sa + sb > ts && ts > 0

  const stopA = px > 0 ? px * (1 - pa / 100) : null
  const stopB = px > 0 ? px * (1 - pb / 100) : null
  const suggestA = Math.round(ts * 0.6)
  const suggestB = ts - suggestA

  const labelCls = 'block text-xs font-semibold text-secondary mb-1'
  const inputCls = 'w-full rounded-lg border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-slate-800 px-3 py-2 text-sm text-primary outline-none focus:border-violet-500'

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-slate-900 p-4 space-y-4">
        <h3 className="font-bold text-heading">OCO Trailing Stop Conflict Checker</h3>
        <p className="text-xs text-secondary">When two trailing stop orders cover the same shares, only the tighter one executes — the other is cancelled.</p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <label className="col-span-2 sm:col-span-1">
            <span className={labelCls}>Total Shares</span>
            <input type="number" min={1} value={totalShares} onChange={e => setTotalShares(e.target.value)} className={inputCls} placeholder="e.g. 100" />
          </label>
          <label>
            <span className={labelCls}>Current Price</span>
            <input type="number" step="0.01" value={currentPrice} onChange={e => setCurrentPrice(e.target.value)} className={inputCls} placeholder="e.g. 185.00" />
          </label>
          <label>
            <span className={labelCls}>Order A — Trail %</span>
            <input type="number" step="0.5" value={pctA} onChange={e => setPctA(e.target.value)} className={inputCls} placeholder="e.g. 8" />
          </label>
          <label>
            <span className={labelCls}>Order B — Trail %</span>
            <input type="number" step="0.5" value={pctB} onChange={e => setPctB(e.target.value)} className={inputCls} placeholder="e.g. 10" />
          </label>
          <label>
            <span className={labelCls}>Order A — Shares</span>
            <input type="number" min={1} value={sharesA} onChange={e => setSharesA(e.target.value)} className={inputCls} placeholder={`default: ${ts || '?'}`} />
          </label>
          <label>
            <span className={labelCls}>Order B — Shares</span>
            <input type="number" min={1} value={sharesB} onChange={e => setSharesB(e.target.value)} className={inputCls} placeholder={`default: ${ts || '?'}`} />
          </label>
        </div>

        {/* Analysis */}
        {ts > 0 && pa > 0 && pb > 0 && (
          <div className="space-y-3 pt-2">
            {overlap && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-900/20 px-3 py-2.5 text-sm text-amber-300 space-y-1">
                <p className="font-bold flex items-center gap-2"><AlertTriangle size={14} /> WARNING: Both orders cover overlapping shares</p>
                <p>The {tighter}% trail triggers first at {stopA && stopB ? `$${(tighter === pa ? stopA : stopB).toFixed(2)}` : '—'}.</p>
                <p>The {wider}% order will be <strong>cancelled</strong>.</p>
                <p className="text-amber-400">To run both: split shares between orders.</p>
              </div>
            )}

            {/* Stop levels */}
            {px > 0 && (
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div className="rounded-lg border border-white/[0.05] bg-slate-800/50 px-3 py-2">
                  <div className="text-muted mb-0.5">Order A ({pa}% trail)</div>
                  <div className="font-bold text-amber-400">{stopA ? `$${stopA.toFixed(2)}` : '—'}</div>
                </div>
                <div className="rounded-lg border border-white/[0.05] bg-slate-800/50 px-3 py-2">
                  <div className="text-muted mb-0.5">Order B ({pb}% trail)</div>
                  <div className="font-bold text-amber-400">{stopB ? `$${stopB.toFixed(2)}` : '—'}</div>
                </div>
              </div>
            )}

            {/* Split recommendation */}
            {ts > 0 && (
              <div className="rounded-lg border border-sky-500/30 bg-sky-900/20 px-3 py-2.5 text-sm text-sky-300 space-y-1">
                <p className="font-semibold">Suggested split for independent execution:</p>
                <p>{suggestA} shares on {pa}% trail · {suggestB} shares on {pb}% trail</p>
                <p className="text-sky-400 text-xs">Both orders execute independently — neither cancels the other.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'premarket',   label: 'Pre-Market Bias' },
  { id: 'early',       label: 'Early Entry' },
  { id: 'oco',         label: 'OCO Explainer' },
] as const
type TabId = typeof TABS[number]['id']

export default function DayTradeHubPage() {
  const [tab, setTab] = useState<TabId>('premarket')

  return (
    <div className="oa-cc-page max-w-3xl mx-auto p-4 md:p-6 space-y-5">
      <header>
        <div className="flex items-center gap-2.5 mb-1">
          <div className="w-9 h-9 rounded-xl bg-violet-600/20 border border-violet-700 flex items-center justify-center shrink-0">
            <Activity size={18} className="text-violet-400" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-heading">Day Trade Hub</h1>
        </div>
        <p className="text-sm text-tertiary">Pre-market bias · Early entry trigger · OCO conflict checker</p>
      </header>

      {/* Tabs */}
      <div className="flex gap-1">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
              tab === t.id ? 'bg-violet-600 text-white shadow-sm' : 'text-muted hover:text-secondary'
            }`}
          >{t.label}</button>
        ))}
      </div>

      {/* Content */}
      {tab === 'premarket' && <PreMarketBiasTab />}
      {tab === 'early'     && <EarlyEntryTab />}
      {tab === 'oco'       && <OcoExplainerTab />}
    </div>
  )
}
