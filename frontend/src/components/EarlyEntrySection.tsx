import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, RefreshCw, Clock, CheckCircle, XCircle, Minus } from 'lucide-react'
import { fetchEarlyEntryTrigger, type EarlyEntryResult } from '../api/commandCenter'
import { getActionButtonClass } from '../utils/semanticTrading'

const EARLY_ENTRY_TICKERS = ['QQQ', 'SPY', 'NVDA', 'AAPL']

function fmtUsd(n: unknown): string {
  if (n == null) return '—'
  const x = Number(n)
  if (!Number.isFinite(x)) return '—'
  return `${x < 0 ? '-' : ''}$${Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function ConditionPill({ cond }: { cond: string | undefined }) {
  const cls =
    cond === 'bull' ? 'bg-emerald-900/30 text-emerald-300 border-emerald-700' :
    cond === 'bear' ? 'bg-rose-900/30 text-rose-300 border-rose-700' :
    'bg-slate-800/50 text-slate-400 border-slate-600'
  const label = cond === 'bull' ? '✅ BULL' : cond === 'bear' ? '❌ BEAR' : '➖ WAIT'
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${cls}`}>{label}</span>
}

function TradeOutputCard({
  symbol, direction, entry, stop, target1, target2, rr, atr, trigger,
}: {
  symbol: string; direction: 'CALL' | 'PUT'; entry: number; stop: number
  target1: number; target2: number; rr: number; atr?: number | null; trigger?: string
}) {
  const today = new Date()
  const isFriday = today.getDay() === 5
  const dte = isFriday ? '3–4 DTE (next Tue/Wed)' : '1 DTE'
  const strike = direction === 'CALL' ? Math.ceil(entry) + 1 : Math.floor(entry) - 1
  const dirCls = direction === 'CALL'
    ? 'text-emerald-400 bg-emerald-900/20 border-emerald-700'
    : 'text-rose-400 bg-rose-900/20 border-rose-700'

  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-slate-900 overflow-hidden">
      <div className={`flex items-center justify-between px-4 py-3 border-b border-white/[0.06] ${dirCls}`}>
        <span className="font-mono text-lg font-bold tracking-tight">{symbol}</span>
        <span className={`rounded-full border px-3 py-0.5 text-sm font-bold uppercase tracking-wide ${dirCls}`}>{direction}</span>
      </div>
      <div className="px-4 py-3 space-y-1.5 text-sm font-mono">
        <div className="flex justify-between"><span className="text-secondary">Entry</span><span className="font-bold text-primary">{fmtUsd(entry)}</span></div>
        <div className="flex justify-between"><span className="text-rose-400">Stop Loss</span><span className="font-bold text-rose-400">{fmtUsd(stop)}</span></div>
        <div className="flex justify-between"><span className="text-amber-400">Target 1</span><span className="font-bold text-amber-400">{fmtUsd(target1)}</span></div>
        <div className="flex justify-between"><span className="text-emerald-400">Target 2</span><span className="font-bold text-emerald-400">{fmtUsd(target2)}</span></div>
        <div className="flex justify-between pt-1 border-t border-white/[0.06]">
          <span className="text-secondary">R/R</span>
          <span className={`font-bold tabular-nums ${rr >= 1.5 ? 'text-emerald-400' : 'text-rose-400'}`}>{rr.toFixed(1)}x</span>
        </div>
        {atr != null && <div className="flex justify-between text-xs text-muted"><span>ATR(14)</span><span>{fmtUsd(atr)}</span></div>}
      </div>
      <div className="px-4 py-2.5 border-t border-white/[0.06] bg-slate-50 dark:bg-slate-800/50">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted mb-1">Option</div>
        <div className="text-sm font-mono text-primary">${strike} {direction} · {dte}</div>
      </div>
      {trigger && <div className="px-4 py-2 border-t border-white/[0.06] text-xs text-tertiary"><span className="font-semibold">Trigger:</span> {trigger}</div>}
      {isFriday && <div className="px-4 py-2 border-t border-rose-600/30 bg-rose-900/20 text-xs text-rose-300 font-semibold">⚠️ Friday — Use 3–4 DTE minimum. No 0DTE.</div>}
    </div>
  )
}

export default function EarlyEntrySection() {
  const [ticker, setTicker]   = useState('QQQ')
  const [data, setData]       = useState<EarlyEntryResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [collapsed, setCollapsed] = useState(false)

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
    <div className="rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900 overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-4 py-3 text-xs font-bold uppercase tracking-wider text-muted hover:text-secondary transition-colors"
      >
        <span>Early Entry — 6:30 AM Window</span>
        <span className="text-[10px]">{collapsed ? 'Show' : 'Hide'}</span>
      </button>

      {!collapsed && (
        <div className="px-4 pb-4 space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            {EARLY_ENTRY_TICKERS.map(t => (
              <button
                key={t} type="button" onClick={() => setTicker(t)}
                className={`rounded-lg px-3 py-1.5 text-sm font-bold transition-colors ${
                  ticker === t ? 'bg-violet-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-muted hover:text-secondary'
                }`}
              >{t}</button>
            ))}
            <div className="flex-1" />
            <button type="button" onClick={() => void load(true)} className={`${getActionButtonClass('surface')} rounded-lg p-2`}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-slate-900 p-4 space-y-4">
            <div className="flex items-start justify-between">
              <div>
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

            {data?.message && <p className={`text-sm font-semibold ${statusColor}`}>{data.message}</p>}

            {data && (
              <div className="space-y-2.5">
                {[
                  { label: 'A — First 5-min candle (6:30–6:35)', cond: data.condition_a, detail: data.condition_a_detail },
                  { label: 'B — VWAP position at 6:35',          cond: data.condition_b, detail: data.condition_b_detail },
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

            {data?.vwap != null && (
              <div className="text-xs text-muted">
                VWAP at 6:35: <span className="font-mono font-semibold text-sky-400">${data.vwap.toFixed(2)}</span>
              </div>
            )}

            {lastRefresh && (
              <div className="text-[10px] text-muted border-t border-white/[0.05] pt-2">
                <Clock size={10} className="inline mr-1" />Updated {lastRefresh.toLocaleTimeString()} · 30s auto-refresh
              </div>
            )}
            {error && <p className="text-xs text-rose-400">{error}</p>}
          </div>

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
      )}
    </div>
  )
}
