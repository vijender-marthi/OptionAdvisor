import { useEffect, useState } from 'react'
import { TrendingUp, AlertTriangle } from 'lucide-react'
import { fetchPositionsPerformance } from '../api/commandCenter'

type SourceRow = { key: string; label: string; repeatable: boolean; cadence: string; detail: string; realized: number; n: number; win_rate: number }
type TickerRow = { ticker: string; realized: number; n: number; dominant: string; bestSetup: string }
type PlaybookRow = { name: string; frequency: string; expectation: string; note: string }
type Edge = {
  total: number; durable: number; earningsDependent: number; durablePct: number
  bySource: SourceRow[]; perTicker: TickerRow[]; playbook: PlaybookRow[]; oneLiner: string
}

const money = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`

export default function PositionsEdgeTab({ refreshKey }: { refreshKey?: number }) {
  const [edge, setEdge] = useState<Edge | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    fetchPositionsPerformance()
      .then(res => { if (!cancelled) setEdge((res.edge as unknown as Edge) ?? null) })
      .catch(() => { if (!cancelled) setError('Unable to load your edge review.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [refreshKey])

  if (loading) return <div className="py-10 text-center text-sm text-tertiary">Analyzing where your money came from…</div>
  if (error) return <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">{error}</div>
  if (!edge || edge.total === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border py-12 text-center text-sm text-tertiary">
        No closed trades yet. Once you close positions, this tab separates your durable edge from earnings-season harvest.
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-heading"><TrendingUp size={18} className="text-violet-500" />My ticker list · your edge</h2>
        <p className="text-sm text-secondary">Where your realized money actually came from, and what's repeatable without earnings.</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl bg-surface-muted p-3"><div className="text-[11px] text-tertiary">Realized total</div><div className="font-mono text-xl font-semibold text-heading">{money(edge.total)}</div></div>
        <div className="rounded-xl bg-surface-muted p-3"><div className="text-[11px] text-tertiary">Durable (no earnings)</div><div className="font-mono text-xl font-semibold text-emerald-700 dark:text-emerald-300">{money(edge.durable)} · {edge.durablePct}%</div></div>
        <div className="rounded-xl bg-surface-muted p-3"><div className="text-[11px] text-tertiary">Needed earnings</div><div className="font-mono text-xl font-semibold text-amber-700 dark:text-amber-300">{money(edge.earningsDependent)}</div></div>
      </div>

      <div>
        <div className="mb-2 text-sm font-semibold text-heading">Where the money came from</div>
        <div className="overflow-hidden rounded-xl border border-border">
          {edge.bySource.map((s, i) => (
            <div key={s.key} className={`flex items-center gap-3 px-3 py-2.5 ${i < edge.bySource.length - 1 ? 'border-b border-border' : ''}`}>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-heading">{s.label}</div>
                <div className="truncate text-[11px] text-tertiary">{s.detail}</div>
              </div>
              <div className="text-right"><div className="font-mono text-sm font-semibold text-heading">{money(s.realized)}</div><div className="text-[10px] text-tertiary">{s.n} trades · {s.win_rate}% win</div></div>
              <span className={`w-24 rounded-md px-2 py-0.5 text-center text-[10px] font-bold ${s.repeatable ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'}`}>{s.repeatable ? s.cadence || 'repeatable' : s.cadence}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.07] px-4 py-3">
        <div className="text-sm font-semibold text-violet-700 dark:text-violet-200">{edge.durablePct >= 50 ? 'Most of your profit is durable.' : 'Half your profit needed earnings — the other half is the business.'}</div>
        <div className="mt-1 text-xs leading-relaxed text-violet-700/90 dark:text-violet-200/80">{edge.oneLiner}</div>
      </div>

      <div>
        <div className="mb-2 text-sm font-semibold text-heading">Your durable playbook</div>
        <div className="overflow-hidden rounded-xl border border-border">
          {edge.playbook.map((p, i) => (
            <div key={p.name} className={`flex items-baseline gap-3 px-3 py-2 ${i < edge.playbook.length - 1 ? 'border-b border-border' : ''}`}>
              <div className="flex-1 text-sm text-heading"><span className="font-medium">{p.name}</span> <span className="text-[11px] text-tertiary">{p.note}</span></div>
              <div className="w-20 text-[11px] text-secondary">{p.frequency}</div>
              <div className="w-24 text-right font-mono text-xs text-secondary">{p.expectation}</div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 text-sm font-semibold text-heading">Your tickers · best setup for each</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {edge.perTicker.slice(0, 8).map(t => (
            <div key={t.ticker} className="rounded-xl border border-border bg-surface-card p-3">
              <div className="flex items-center justify-between">
                <span className="font-mono font-semibold text-heading">{t.ticker}</span>
                <span className={`font-mono text-sm font-semibold ${t.realized >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600 dark:text-red-300'}`}>{money(t.realized)}</span>
              </div>
              <div className="mt-1 text-xs text-secondary">{t.bestSetup}</div>
              <div className="text-[10px] text-tertiary">{t.n} closed trades</div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-start gap-1.5 border-t border-border pt-3 text-[11px] text-tertiary">
        <AlertTriangle size={13} className="mt-0.5 shrink-0" />
        <span>Educational review of your own closed trades, not financial advice. Buckets are inferred from hold time and earnings proximity — verify before acting on them.</span>
      </div>
    </div>
  )
}
