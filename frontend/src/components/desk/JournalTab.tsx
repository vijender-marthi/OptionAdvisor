import { useState } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import type { DeskTradeLog, DeskTradeStats } from '../../api/client'

function statPill(label: string, value: string, tone: 'green' | 'amber' | 'red' | 'gray') {
  const cls = {
    green: 'bg-emerald-900/30 text-emerald-300 border-emerald-800/40',
    amber: 'bg-amber-900/30 text-amber-300 border-amber-800/40',
    red:   'bg-rose-900/30 text-rose-300 border-rose-800/40',
    gray:  'bg-slate-800/50 text-gray-400 border-white/[0.06]',
  }[tone]
  return (
    <div className={`inline-flex flex-col items-center rounded-xl border px-3 py-2 ${cls}`}>
      <span className="text-[10px] uppercase tracking-wide opacity-70">{label}</span>
      <span className="font-bold text-sm mt-0.5">{value}</span>
    </div>
  )
}

function statTone(val: number, goodThresh: number, okThresh: number): 'green' | 'amber' | 'red' {
  if (val >= goodThresh) return 'green'
  if (val >= okThresh) return 'amber'
  return 'red'
}

interface Props {
  trades: DeskTradeLog[]
  stats: DeskTradeStats
  onClose: (trade: DeskTradeLog) => void
  onDelete: (id: string) => void
}

export default function JournalTab({ trades, stats, onClose, onDelete }: Props) {
  const [period, setPeriod] = useState<'week' | 'month' | 'all'>('month')
  const [filterType, setFilterType] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const now = Date.now()
  const cutoff = period === 'week' ? now - 7 * 86400000 : period === 'month' ? now - 30 * 86400000 : 0

  const filtered = trades.filter(t => {
    const ms = new Date(t.logged_at).getTime()
    if (cutoff > 0 && ms < cutoff) return false
    if (filterType && t.trade_type !== filterType) return false
    if (filterStatus === 'open' && t.exit_time) return false
    if (filterStatus === 'closed' && !t.exit_time) return false
    return true
  })

  const fmt = (v: number | null | undefined, prefix = '$') =>
    v != null ? `${prefix}${v.toFixed(2)}` : '—'

  return (
    <div className="space-y-4 pb-6">
      {/* Stats strip */}
      <div className="flex flex-wrap gap-2 pt-1">
        {statPill('Trades', String(stats.total), 'gray')}
        {statPill('Win%', stats.total > 0 ? `${stats.win_rate.toFixed(0)}%` : '—', statTone(stats.win_rate, 60, 45))}
        {statPill('Avg R/R', stats.total > 0 ? stats.avg_rr.toFixed(2) : '—', statTone(stats.avg_rr, 1.5, 0.8))}
        {statPill('Open', String(stats.open_count), 'gray')}
        {statPill('Plan%', stats.total > 0 ? `${stats.followed_plan_pct.toFixed(0)}%` : '—', statTone(stats.followed_plan_pct, 70, 50))}
      </div>

      {/* Period + filters */}
      <div className="flex flex-wrap gap-2 items-center">
        {(['week', 'month', 'all'] as const).map(p => (
          <button
            key={p}
            type="button"
            onClick={() => setPeriod(p)}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
              period === p
                ? 'bg-violet-600 border-violet-500 text-white'
                : 'bg-slate-800/50 border-white/[0.06] text-gray-400 hover:border-white/[0.12]'
            }`}
          >
            {p.charAt(0).toUpperCase() + p.slice(1)}
          </button>
        ))}
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          className="text-xs rounded-lg border border-white/[0.07] bg-slate-800 text-gray-400 px-2 py-1.5 outline-none"
        >
          <option value="">All Types</option>
          <option value="day">Day</option>
          <option value="swing">Swing</option>
          <option value="regular">Regular</option>
        </select>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="text-xs rounded-lg border border-white/[0.07] bg-slate-800 text-gray-400 px-2 py-1.5 outline-none"
        >
          <option value="">All</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
        </select>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <p className="text-center text-sm text-gray-600 py-8">No trades logged yet</p>
      ) : (
        <div className="rounded-xl border border-white/[0.07] overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-white/[0.03] border-b border-white/[0.07]">
                <th className="text-left px-3 py-2 text-gray-500 font-semibold">Date</th>
                <th className="text-left px-3 py-2 text-gray-500 font-semibold">Ticker</th>
                <th className="text-left px-3 py-2 text-gray-500 font-semibold">Type</th>
                <th className="text-left px-3 py-2 text-gray-500 font-semibold">Signal</th>
                <th className="text-right px-3 py-2 text-gray-500 font-semibold">Entry</th>
                <th className="text-right px-3 py-2 text-gray-500 font-semibold">Exit</th>
                <th className="text-center px-3 py-2 text-gray-500 font-semibold">W/L</th>
                <th className="text-center px-3 py-2 text-gray-500 font-semibold">Plan</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(t => {
                const isOpen = !t.exit_time
                const isExpanded = expanded === t.id
                const outCls = t.outcome === 'WIN'
                  ? 'text-emerald-400'
                  : t.outcome === 'LOSS' ? 'text-rose-400' : 'text-gray-500'
                return (
                  <>
                    <tr
                      key={t.id}
                      className="border-b border-white/[0.04] hover:bg-white/[0.02] cursor-pointer"
                      onClick={() => setExpanded(isExpanded ? null : t.id)}
                    >
                      <td className="px-3 py-2 text-gray-500">{t.logged_at.slice(0, 10)}</td>
                      <td className="px-3 py-2 font-mono font-bold text-white">{t.ticker}</td>
                      <td className="px-3 py-2 text-gray-400 capitalize">{t.trade_type}</td>
                      <td className="px-3 py-2 text-gray-400">{t.signal_given || '—'}</td>
                      <td className="px-3 py-2 text-right text-gray-300">{fmt(t.actual_entry)}</td>
                      <td className="px-3 py-2 text-right text-gray-300">{fmt(t.exit_price)}</td>
                      <td className={`px-3 py-2 text-center font-semibold ${outCls}`}>
                        {t.outcome || (isOpen ? <span className="text-amber-400">OPEN</span> : '—')}
                      </td>
                      <td className="px-3 py-2 text-center text-gray-400">{t.followed_plan || '—'}</td>
                      <td className="px-2 py-2 text-gray-600">
                        {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${t.id}-expanded`} className="bg-slate-900/50">
                        <td colSpan={9} className="px-4 py-3">
                          <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs mb-2">
                            <span className="text-gray-500">Planned entry: <span className="text-gray-300">{fmt(t.planned_entry)}</span></span>
                            <span className="text-gray-500">T1: <span className="text-gray-300">{fmt(t.planned_t1)}</span></span>
                            <span className="text-gray-500">T2: <span className="text-gray-300">{fmt(t.planned_t2)}</span></span>
                            <span className="text-gray-500">Stop: <span className="text-gray-300">{fmt(t.planned_stop)}</span></span>
                            <span className="text-gray-500">Contracts: <span className="text-gray-300">{t.contracts}</span></span>
                            <span className="text-gray-500">Est P&L: <span className={t.pnl_estimate != null && t.pnl_estimate >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{fmt(t.pnl_estimate)}</span></span>
                          </div>
                          {t.notes && <p className="text-xs text-gray-400 mb-2">{t.notes}</p>}
                          <div className="flex gap-2 mt-1">
                            {isOpen && (
                              <button
                                type="button"
                                onClick={e => { e.stopPropagation(); onClose(t) }}
                                className="text-xs px-3 py-1.5 rounded-lg bg-amber-600/20 border border-amber-700/40 text-amber-300 hover:bg-amber-600/30 transition-colors"
                              >
                                Close Trade
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={e => { e.stopPropagation(); onDelete(t.id) }}
                              className="text-xs px-3 py-1.5 rounded-lg bg-rose-900/20 border border-rose-800/40 text-rose-400 hover:bg-rose-900/30 transition-colors"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
