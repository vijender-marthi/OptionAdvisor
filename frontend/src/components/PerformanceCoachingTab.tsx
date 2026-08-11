import { useEffect, useState } from 'react'
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, Gauge,
  Target, TrendingDown, TrendingUp,
} from 'lucide-react'
import {
  Area, AreaChart, Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { fetchPositionsPerformance } from '../api/commandCenter'
import { getEngineRoute } from '../routing/routes'

// ── shapes returned by /positions-center/performance ────────────────────────
interface Summary {
  n: number; realized: number; wins: number; losses: number; win_rate: number
  profit_factor: number | null; expectancy: number; avg_win: number; avg_loss: number
  best: number; worst: number; max_drawdown: number; day_streak: number; trading_days: number
}
interface Bucket { key: string; n: number; realized: number; win_rate: number }
interface WeekEntry {
  id: string; ticker: string; strategy: string; bias: string
  contracts: number | null; source: string; exit_date: string | null
  realized_pnl: number | null; realized_pnl_percent: number | null
}
interface ThisWeek extends Summary { week_start: string; prior_avg_pnl: number; prior_avg_win_rate: number }
interface Performance {
  summary: Summary
  daily: { date: string; pnl: number; n: number }[]
  weekly: { week_start: string; pnl: number; n: number; win_rate: number; entries?: WeekEntry[] }[]
  equity: { date: string; cum: number }[]
  by_structure: Bucket[]; by_hold: Bucket[]; by_source: Bucket[]; by_ticker: Bucket[]
  this_week: ThisWeek
}
interface Leak {
  code: string; title: string; severity: 'high' | 'medium' | 'info'
  count: number; cost: number; this_week: number | null; prior_weekly_avg: number | null
  examples: { ticker: string; entry: string; exit: string; pnl: number }[]
  insight: string; fix: string
}
interface Coaching { leaks: Leak[]; total_leak_cost: number; weekly_digest: string }

const money = (v: number | null | undefined, sign = true) => {
  if (v == null || Number.isNaN(v)) return '—'
  const s = v < 0 ? '−' : sign ? '+' : ''
  return `${s}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}
const pnlClass = (v: number) => (v > 0 ? 'text-emerald-500' : v < 0 ? 'text-rose-500' : 'text-muted')
const PROFIT = '#10b981'
const LOSS = '#f43f5e'

/** Theme-aware chart tooltip — readable in both light and dark mode (Recharts
 *  inline contentStyle can't use Tailwind dark: variants, so use a custom node). */
function ChartTooltip({ active, payload, label, valueLabel }: {
  active?: boolean; payload?: { value?: number }[]; label?: string | number; valueLabel: string
}) {
  if (!active || !payload?.length) return null
  const v = Number(payload[0]?.value ?? 0)
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-white/10 dark:bg-slate-800">
      {label != null && label !== '' && (
        <div className="mb-0.5 font-mono text-[11px] text-slate-500 dark:text-slate-400">{label}</div>
      )}
      <div className={`font-mono font-semibold ${v >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
        {money(v)} <span className="font-normal text-slate-400 dark:text-slate-500">{valueLabel}</span>
      </div>
    </div>
  )
}

function Kpi({ icon, label, value, cls, hint }: {
  icon: React.ReactNode; label: string; value: string; cls?: string; hint?: string
}) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900 p-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted">{icon}{label}</div>
      <div className={`mt-1.5 font-mono text-xl font-semibold tabular-nums ${cls ?? ''}`}>{value}</div>
      {hint && <div className="mt-1 text-[11px] text-muted">{hint}</div>}
    </div>
  )
}

function MiniBreakdown({ title, rows }: { title: string; rows: Bucket[] }) {
  const max = Math.max(1, ...rows.map(r => Math.abs(r.realized)))
  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900 p-4">
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</div>
      <div className="flex flex-col gap-2.5">
        {rows.map(r => (
          <div key={r.key} className="flex items-center gap-3">
            <div className="w-28 shrink-0 truncate text-sm text-secondary">{r.key}</div>
            <div className="relative h-2 flex-1 rounded-full bg-slate-100 dark:bg-white/10">
              <div className="absolute inset-y-0 rounded-full"
                style={{
                  width: `${(Math.abs(r.realized) / max) * 100}%`,
                  background: r.realized >= 0 ? PROFIT : LOSS,
                }} />
            </div>
            <div className={`w-16 shrink-0 text-right font-mono text-xs tabular-nums ${pnlClass(r.realized)}`}>
              {money(r.realized)}
            </div>
            <div className="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted">{r.win_rate}%</div>
          </div>
        ))}
      </div>
    </div>
  )
}

const sevStyle: Record<Leak['severity'], string> = {
  high: 'border-rose-500/40 bg-rose-50 dark:bg-rose-500/5',
  medium: 'border-amber-500/40 bg-amber-50 dark:bg-amber-500/5',
  info: 'border-slate-200 dark:border-white/10 bg-white dark:bg-white/5',
}
const sevBadge: Record<Leak['severity'], string> = {
  high: 'bg-rose-500/15 text-rose-400',
  medium: 'bg-amber-500/15 text-amber-400',
  info: 'bg-white/10 text-muted',
}

function LeakCard({ l }: { l: Leak }) {
  return (
    <div className={`rounded-xl border p-4 ${sevStyle[l.severity]}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <AlertTriangle size={15} className={l.severity === 'high' ? 'text-rose-400' : 'text-amber-400'} />
          <span className="text-sm font-semibold text-secondary">{l.title}</span>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${sevBadge[l.severity]}`}>
          {l.severity}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-xs tabular-nums text-muted">
        <span>{l.count}× · <span className="text-rose-500">{money(l.cost)}</span></span>
        {l.this_week != null && (
          <span>this week <b className="text-secondary">{l.this_week}</b> · prior avg {l.prior_weekly_avg}/wk</span>
        )}
      </div>
      <p className="mt-2 text-[13px] leading-snug text-secondary">{l.insight}</p>
      <p className="mt-1.5 text-[13px] leading-snug"><span className="text-muted">Fix: </span>{l.fix}</p>
      {l.examples.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {l.examples.map((e, i) => (
            <span key={i} className="rounded-md bg-slate-100 dark:bg-black/20 px-2 py-0.5 font-mono text-[11px] tabular-nums text-muted">
              {e.ticker} {e.entry}→{e.exit} <span className={pnlClass(e.pnl)}>{money(e.pnl)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export default function PerformanceCoachingTab({ refreshKey }: { refreshKey?: number }) {
  const [perf, setPerf] = useState<Performance | null>(null)
  const [coach, setCoach] = useState<Coaching | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchPositionsPerformance()
      .then(({ performance, coaching }) => {
        if (cancelled) return
        setPerf(performance as unknown as Performance)
        setCoach(coaching as unknown as Coaching)
      })
      .catch(() => { if (!cancelled) setError('Could not load performance analytics.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [refreshKey])

  if (loading) return <div className="p-8 text-center text-muted">Analyzing your realized book…</div>
  if (error) return <div className="p-8 text-center text-rose-500">{error}</div>
  if (!perf || !perf.summary || perf.summary.n === 0)
    return <div className="p-8 text-center text-muted">No closed trades yet — performance analytics appear once positions are closed.</div>

  const s = perf.summary
  const tw = perf.this_week
  const twDelta = tw.realized - (tw.prior_avg_pnl ?? 0)

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="mt-2 border-t border-slate-200 pt-4 text-[11px] font-semibold uppercase tracking-wide text-violet-500 dark:border-white/[0.07]">Retrospective review &amp; coaching</div>
        <p className="mt-0.5 text-sm text-muted">How the closed book performed over time, and where the recurring leaks are.</p>
      </div>

      {/* This-week banner */}
      <div className="rounded-2xl border border-violet-300 dark:border-violet-500/30 bg-violet-50 dark:bg-violet-500/5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted">This week (from {tw.week_start})</div>
            <div className="mt-1 flex items-baseline gap-3">
              <span className={`font-mono text-2xl font-semibold tabular-nums ${pnlClass(tw.realized)}`}>{money(tw.realized)}</span>
              <span className="text-sm text-secondary">{tw.n} closed · {tw.win_rate}% wins</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wide text-muted">vs prior 4-wk avg</div>
            <div className={`mt-1 flex items-center justify-end gap-1 font-mono text-sm tabular-nums ${pnlClass(twDelta)}`}>
              {twDelta >= 0 ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}
              {money(tw.prior_avg_pnl)}/wk · {tw.prior_avg_win_rate}%
            </div>
          </div>
        </div>
      </div>

      {/* Retrospective stats — only what the Dashboard tab does NOT already show
          (win rate / profit factor / P&L snapshot live on the Dashboard tab). */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <Kpi icon={<Target size={12} />} label="Expectancy" value={money(s.expectancy)} cls={pnlClass(s.expectancy)} hint="avg per closed trade" />
        <Kpi icon={<TrendingDown size={12} />} label="Max drawdown" value={money(s.max_drawdown)} cls="text-rose-500" hint={`over ${s.trading_days} trading days`} />
        <Kpi icon={<TrendingUp size={12} />} label="Best trade" value={money(s.best)} cls="text-emerald-500" />
        <Kpi icon={<Activity size={12} />} label="Worst trade" value={money(s.worst)} cls="text-rose-500" />
        <Kpi icon={<Gauge size={12} />} label="Day streak"
          value={`${s.day_streak > 0 ? '+' : ''}${s.day_streak}d`}
          cls={s.day_streak > 0 ? 'text-emerald-500' : s.day_streak < 0 ? 'text-rose-500' : 'text-muted'}
          hint={s.day_streak >= 0 ? 'winning days' : 'losing days'} />
      </div>

      {/* Equity curve */}
      <div className="rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900 p-4">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Realized equity curve</div>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={perf.equity} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
            <defs>
              <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={PROFIT} stopOpacity={0.25} />
                <stop offset="100%" stopColor={PROFIT} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#8a93a0' }} tickFormatter={(d: string) => d.slice(5)} minTickGap={40} />
            <YAxis tick={{ fontSize: 10, fill: '#8a93a0' }} tickFormatter={(v: number) => `${v < 0 ? '−' : ''}$${Math.abs(Math.round(v / 100) / 10)}k`} width={48} />
            <ReferenceLine y={0} stroke="#8a93a0" strokeOpacity={0.4} />
            <Tooltip content={<ChartTooltip valueLabel="Cumulative" />} />
            <Area type="monotone" dataKey="cum" stroke={PROFIT} strokeWidth={2} fill="url(#eq)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Weekly P&L bars — click a bar to see that week's trades */}
      <div className="rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900 p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Weekly realized P&amp;L</div>
          <div className="text-[10px] text-muted">Click a bar to see its trades</div>
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={perf.weekly} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
            <XAxis dataKey="week_start" tick={{ fontSize: 10, fill: '#8a93a0' }} tickFormatter={(d: string) => d.slice(5)} />
            <YAxis tick={{ fontSize: 10, fill: '#8a93a0' }} tickFormatter={(v: number) => `${v < 0 ? '−' : ''}$${Math.abs(Math.round(v / 100) / 10)}k`} width={48} />
            <ReferenceLine y={0} stroke="#8a93a0" strokeOpacity={0.4} />
            <Tooltip content={<ChartTooltip valueLabel="P&L" />} cursor={{ fill: 'rgba(124,58,237,0.10)' }} />
            <Bar dataKey="pnl" radius={[3, 3, 0, 0]} cursor="pointer">
              {perf.weekly.map((w, i) => (
                <Cell key={i} fill={w.pnl >= 0 ? PROFIT : LOSS}
                  fillOpacity={selectedWeek && selectedWeek !== w.week_start ? 0.35 : 1}
                  stroke={selectedWeek === w.week_start ? '#7c3aed' : undefined} strokeWidth={selectedWeek === w.week_start ? 2 : 0}
                  onClick={() => setSelectedWeek(prev => (prev === w.week_start ? null : w.week_start))} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        {selectedWeek && (() => {
          const wk = perf.weekly.find(w => w.week_start === selectedWeek)
          const entries = wk?.entries ?? []
          return (
            <div className="mt-3 border-t border-slate-100 pt-3 dark:border-white/[0.06]">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-xs font-semibold text-secondary">
                  Week of {selectedWeek} · <span className="text-muted">{entries.length} trade{entries.length === 1 ? '' : 's'}</span> ·{' '}
                  <span className={pnlClass(wk?.pnl ?? 0)}>{money(wk?.pnl)}</span>
                </div>
                <button type="button" onClick={() => setSelectedWeek(null)} className="text-[11px] text-muted hover:text-secondary">Clear</button>
              </div>
              {entries.length === 0 ? (
                <div className="py-3 text-center text-xs text-muted">No trade detail available for this week.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wide text-muted">
                        <th className="px-2 py-1 text-left">Ticker</th>
                        <th className="px-2 py-1 text-left">Strategy</th>
                        <th className="px-2 py-1 text-right">Qty</th>
                        <th className="px-2 py-1 text-left">Exit</th>
                        <th className="px-2 py-1 text-right">P&amp;L</th>
                        <th className="px-2 py-1 text-right">%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map(e => (
                        <tr key={e.id || `${e.ticker}-${e.exit_date}`} className="border-t border-slate-100 dark:border-white/[0.05]">
                          <td className="px-2 py-1.5">
                            <a href={getEngineRoute(e.source || 'regular', e.ticker)} target="_blank" rel="noopener noreferrer"
                              title={`Open ${e.ticker} (${e.source || 'regular'}) in a new tab`}
                              className="font-mono font-bold text-violet-600 hover:underline dark:text-violet-300 inline-flex items-center gap-1">
                              {e.ticker} <ArrowUpRight size={11} className="opacity-70" />
                            </a>
                          </td>
                          <td className="px-2 py-1.5 text-secondary"><span className="block max-w-[220px] truncate">{e.strategy || '—'}</span></td>
                          <td className="px-2 py-1.5 text-right font-mono">{e.contracts ?? '—'}</td>
                          <td className="px-2 py-1.5 font-mono text-muted">{e.exit_date ?? '—'}</td>
                          <td className={`px-2 py-1.5 text-right font-mono font-semibold ${pnlClass(e.realized_pnl ?? 0)}`}>{e.realized_pnl != null ? money(e.realized_pnl) : '—'}</td>
                          <td className={`px-2 py-1.5 text-right font-mono ${pnlClass(e.realized_pnl_percent ?? 0)}`}>{e.realized_pnl_percent != null ? `${e.realized_pnl_percent > 0 ? '+' : ''}${e.realized_pnl_percent.toFixed(1)}%` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })()}
      </div>

      {/* Breakdowns unique to the retrospective view — structure/strategy lives on the Dashboard tab */}
      <div className="grid gap-4 md:grid-cols-2">
        <MiniBreakdown title="By hold — same-day vs overnight" rows={perf.by_hold} />
        <MiniBreakdown title="By broker" rows={perf.by_source} />
      </div>

      {/* Coaching */}
      {coach && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-secondary">Coaching — where the leaks are</h3>
            {coach.total_leak_cost < 0 && (
              <span className="font-mono text-xs tabular-nums text-rose-500">
                high-severity leaks: {money(coach.total_leak_cost)}
              </span>
            )}
          </div>
          {coach.weekly_digest && (
            <div className="rounded-xl border border-violet-300 dark:border-violet-500/30 bg-violet-50 dark:bg-violet-500/5 p-3 text-[13px] leading-snug text-secondary">
              {coach.weekly_digest}
            </div>
          )}
          {coach.leaks.length === 0 ? (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/5 p-4 text-sm text-emerald-500">
              No process leaks flagged — discipline is holding.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {coach.leaks.map(l => <LeakCard key={l.code} l={l} />)}
            </div>
          )}
          <p className="text-[11px] italic text-muted">
            Retrospective analysis of your own closed trades to sharpen process — not investment advice.
          </p>
        </div>
      )}
    </div>
  )
}
