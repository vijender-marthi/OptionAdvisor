import { useEffect, useState } from 'react'
import axios from 'axios'
import { RefreshCw, TrendingUp } from 'lucide-react'
import { fetchMarketPosition } from '../api/commandCenter'
import type { MarketPositionData } from '../api/commandCenter'

function actionHint(distPct: number, drawdownPct: number): { label: string; color: string; cls: string } {
  if (distPct >= 10) return { label: 'Trim', color: '#ef4444', cls: 'bg-red-500/15 text-red-300 border-red-600/30' }
  if (distPct >= 5) return { label: 'Trim', color: '#f97316', cls: 'bg-orange-500/15 text-orange-300 border-orange-600/30' }
  if (distPct >= 2) return { label: 'Hold', color: '#f59e0b', cls: 'bg-amber-500/15 text-amber-300 border-amber-600/30' }
  if (distPct >= -2) return { label: 'Hold', color: '#3b82f6', cls: 'bg-blue-500/15 text-blue-300 border-blue-600/30' }
  if (distPct >= -8) return { label: 'Add', color: '#22c55e', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-600/30' }
  return { label: 'Wait', color: '#64748b', cls: 'bg-gray-500/15 text-gray-300 border-gray-600/30' }
}

function axiosErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const d = err.response?.data as { detail?: unknown } | undefined
    if (typeof d?.detail === 'string') return d.detail
    return err.message || 'Request failed'
  }
  if (err instanceof Error) return err.message
  return 'Failed to load'
}

export default function ReserveSignalCard() {
  const [mpData, setMpData] = useState<MarketPositionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchMarketPosition()
      .then(env => {
        if (env.error) setError((env.error as { message?: string }).message ?? 'Error')
        else if (env.data) setMpData(env.data)
        else setError('No data')
      })
      .catch(err => setError(axiosErrorMessage(err)))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <RefreshCw size={11} className="animate-spin" /> Loading…
      </div>
    )
  }
  if (error || !mpData) {
    return <div className="text-xs text-gray-400">Market position unavailable</div>
  }

  const distPct = mpData.dist_200ma_pct
  const ddPct = mpData.drawdown_pct
  const action = actionHint(distPct, ddPct)
  const maBarPct = Math.min(100, Math.max(2, ((distPct + 15) / 30) * 100))
  const ddBarPct = Math.min(100, Math.max(2, (ddPct / 25) * 100))

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
          <TrendingUp size={11} className="text-violet-400" />
          Reserve Signal
        </div>
        <div className="flex items-center gap-1.5 text-xs font-mono">
          <span className="text-gray-400">SPY</span>
          <span className="font-bold text-white">${mpData.spy_price.toFixed(2)}</span>
        </div>
      </div>

      <div className="space-y-2">
        <div>
          <div className="flex items-center justify-between text-[11px] mb-1">
            <span className="font-semibold text-gray-400">vs 200-MA</span>
            <span className="font-bold font-mono" style={{ color: distPct >= 0 ? '#22c55e' : '#ef4444' }}>
              {distPct >= 0 ? '+' : ''}{distPct.toFixed(1)}%
            </span>
          </div>
          <div className="relative h-2 rounded-full bg-gray-700/30">
            <div
              className="absolute top-1/2 -translate-y-1/2 h-3 w-0.5 rounded-full bg-gray-500"
              style={{ left: `${50 - Math.min(15, Math.max(-15, distPct)) / 30 * 50 + 50}%` }}
            />
            <div className="flex h-full rounded-full overflow-hidden">
              <div className="h-full bg-red-500/20" style={{ width: `${Math.max(0, 50 - maBarPct / 2)}%` }} />
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${maBarPct}%`,
                  backgroundColor: action.color,
                  opacity: 0.7,
                }}
              />
              <div className="h-full bg-emerald-500/20" style={{ flex: 1 }} />
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between text-[11px] mb-1">
            <span className="font-semibold text-gray-400">52w High</span>
            <span className="font-bold font-mono text-emerald-400">-{ddPct.toFixed(1)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-gray-700/30">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${ddBarPct}%`, backgroundColor: ddPct >= 8 ? '#22c55e' : '#6b7280', opacity: 0.7 }}
            />
          </div>
        </div>
      </div>

      <div className={`mt-3 flex items-center gap-2 rounded-lg border px-3 py-2 ${action.cls}`}>
        <span className="flex-1 text-xs font-semibold">
          200-MA suggests <span style={{ color: action.color }}>{action.label.toLowerCase()}</span> positions
        </span>
        <span className="rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide" style={{ backgroundColor: `${action.color}22`, color: action.color }}>
          {action.label}
        </span>
      </div>
    </div>
  )
}
