import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, RefreshCw, Star, Clock, CheckCircle, XCircle, Minus } from 'lucide-react'
import { fetchPremarketBias, type PremarketBiasData } from '../api/commandCenter'
import { getActionButtonClass } from '../utils/semanticTrading'

function SignalIcon({ signal }: { signal: string }) {
  if (signal === 'bull') return <CheckCircle size={14} className="text-emerald-400 shrink-0" />
  if (signal === 'bear') return <XCircle size={14} className="text-rose-400 shrink-0" />
  return <Minus size={14} className="text-slate-400 shrink-0" />
}

export default function PreMarketBiasSection() {
  const [data, setData]     = useState<PremarketBiasData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [collapsed, setCollapsed] = useState(false)

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
    <div className="rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900 overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-4 py-3 text-xs font-bold uppercase tracking-wider text-muted hover:text-secondary transition-colors"
      >
        <span>Pre-Market Bias</span>
        <span className="text-[10px]">{collapsed ? 'Show' : 'Hide'}</span>
      </button>

      {!collapsed && (
        <div className="px-4 pb-4 space-y-4">
          {data?.friday_warning && (
            <div className="flex items-center gap-2.5 rounded-xl border border-rose-600/40 bg-rose-900/20 px-4 py-3 text-sm font-bold text-rose-300">
              <AlertTriangle size={16} className="shrink-0" />
              {data.friday_warning}
            </div>
          )}

          <div className="flex items-start justify-between gap-3">
            <div>
              {loading && !data ? (
                <div className="flex items-center gap-2 text-sm text-muted">
                  <RefreshCw size={14} className="animate-spin" /> Fetching...
                </div>
              ) : (
                <div className={`text-2xl font-black tracking-tight ${biasColor}`}>
                  {data?.bias ?? '—'}
                </div>
              )}
              {data && (
                <div className="flex items-center gap-0.5 mt-1">
                  {Array.from({ length: 5 }, (_, i) => (
                    <Star key={i} size={12} className={i < (data.confidence ?? 0) ? 'text-amber-400 fill-amber-400' : 'text-slate-600'} />
                  ))}
                  <span className="ml-1.5 text-xs text-muted">{data.confidence}/5</span>
                </div>
              )}
            </div>
            <button type="button" onClick={() => void load(true)} className={`${getActionButtonClass('surface')} rounded-lg p-2`} title="Refresh">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>

          {data && (
            <div className={`rounded-lg border px-3 py-2 text-sm font-bold ${
              data.action === 'Favor CALLS' ? 'bg-emerald-900/20 border-emerald-700 text-emerald-300' :
              data.action === 'Favor PUTS'  ? 'bg-rose-900/20 border-rose-700 text-rose-300' :
              'bg-slate-800/50 border-slate-600 text-slate-300'
            }`}>
              Recommended: {data.action}
            </div>
          )}

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

          {data && (
            <div className="flex items-center justify-between text-xs text-muted border-t border-white/[0.05] pt-3">
              <span>Score: <span className="font-semibold text-primary">{data.score > 0 ? `+${data.score}` : data.score}/5</span></span>
              {lastRefresh && <span><Clock size={10} className="inline mr-1" />Updated {lastRefresh.toLocaleTimeString()}</span>}
            </div>
          )}

          {error && <p className="text-xs text-rose-400">{error}</p>}

          <div className="rounded-xl border border-white/[0.06] bg-slate-800/40 px-4 py-3 text-xs text-secondary space-y-1">
            <div className="font-semibold text-primary text-[11px] uppercase tracking-wide mb-1.5">VWAP Sigma Context</div>
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-emerald-500/50 shrink-0" /> Price above VWAP — bullish channel</div>
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-amber-500/50 shrink-0" /> Price between −1σ and VWAP — caution</div>
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-orange-500/50 shrink-0" /> Price between −1σ and −2σ — ⚠️ −1σ Resistance</div>
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-rose-600/50 shrink-0" /> Price below −2σ — 🔴 −2σ Breakdown, high momentum bearish</div>
          </div>
        </div>
      )}
    </div>
  )
}
