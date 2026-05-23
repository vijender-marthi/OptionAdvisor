import { useState } from 'react'
import type { DeskTradeLog, DeskTradeStats } from '../../api/client'

const C = {
  bgPage:    '#0A0C10',
  bgPanel:   '#111318',
  bgCard:    '#181C23',
  border:    '#1E2330',
  borderSub: '#252C3A',
  muted:     '#5A6478',
  accent:    '#4A7CFF',
  green:     '#00E5A0',
  red:       '#FF4D6D',
  amber:     '#F5A623',
  purple:    '#6B7FD4',
}

function statTone(val: number, goodThresh: number, okThresh: number): string {
  if (val >= goodThresh) return C.green
  if (val >= okThresh) return C.amber
  return C.red
}

interface Props {
  trades: DeskTradeLog[]
  stats: DeskTradeStats
  onClose: (trade: DeskTradeLog) => void
  onDelete: (id: string) => void
}

export default function JournalTab({ trades, stats, onClose, onDelete }: Props) {
  const [period, setPeriod] = useState<'7' | '30' | 'all'>('30')
  const [expanded, setExpanded] = useState<string | null>(null)

  const now = Date.now()
  const cutoff = period === '7' ? now - 7 * 86400000 : period === '30' ? now - 30 * 86400000 : 0

  const filtered = trades.filter(t => {
    const ms = new Date(t.logged_at).getTime()
    return cutoff === 0 || ms >= cutoff
  })

  const fmt = (v: number | null | undefined) => v != null ? `$${v.toFixed(2)}` : '—'

  const pills = [
    { label: 'Trades', value: String(stats.total), color: '#fff' },
    { label: 'Win %', value: stats.total > 0 ? `${stats.win_rate.toFixed(0)}%` : '—', color: stats.total > 0 ? statTone(stats.win_rate, 60, 45) : C.muted },
    { label: 'Avg R/R', value: stats.total > 0 ? stats.avg_rr.toFixed(2) : '—', color: stats.total > 0 ? statTone(stats.avg_rr, 1.5, 0.8) : C.muted },
    { label: 'Open', value: String(stats.open_count), color: C.purple },
    { label: 'Plan %', value: stats.total > 0 ? `${stats.followed_plan_pct.toFixed(0)}%` : '—', color: stats.total > 0 ? statTone(stats.followed_plan_pct, 70, 50) : C.muted },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 24 }}>
      {/* Stats strip */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {pills.map(p => (
          <div key={p.label} style={{
            background: C.bgPanel, border: `1px solid ${C.border}`,
            borderRadius: 8, padding: '8px 14px', display: 'flex', flexDirection: 'column', alignItems: 'center',
          }}>
            <span style={{ fontSize: '0.62rem', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{p.label}</span>
            <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '0.92rem', color: p.color, marginTop: 2 }}>{p.value}</span>
          </div>
        ))}
      </div>

      {/* Period selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: '0.75rem', color: C.muted }}>Period:</span>
        {([['7', '7 Days'], ['30', '30 Days'], ['all', 'All']] as const).map(([v, label]) => (
          <button
            key={v}
            type="button"
            onClick={() => setPeriod(v)}
            style={{
              background: period === v ? 'rgba(74,124,255,0.15)' : C.bgCard,
              border: `1px solid ${period === v ? C.accent : C.borderSub}`,
              color: period === v ? C.accent : C.muted,
              borderRadius: 6, padding: '4px 12px', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', color: C.muted, padding: '48px 0', fontSize: '0.88rem' }}>
          No trades logged yet
        </div>
      ) : (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
            <thead>
              <tr style={{ background: C.bgCard, borderBottom: `1px solid ${C.border}` }}>
                {['Date', 'Ticker', 'Type', 'Signal', 'Entry', 'Exit', 'W/L', '✓'].map(h => (
                  <th key={h} style={{ textAlign: h === 'Entry' || h === 'Exit' ? 'right' : 'left', padding: '8px 10px', color: C.muted, fontWeight: 600, fontSize: '0.68rem', letterSpacing: '0.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(t => {
                const isOpen = !t.exit_time
                const isExpanded = expanded === t.id
                const wlColor = t.outcome === 'WIN' ? C.green : t.outcome === 'LOSS' ? C.red : C.purple
                const planIcon = t.followed_plan === 'yes' ? '✓' : t.followed_plan === 'partial' ? '≈' : t.followed_plan === 'no' ? '✗' : '—'
                const planColor = t.followed_plan === 'yes' ? C.green : t.followed_plan === 'partial' ? C.amber : C.red

                return (
                  <>
                    <tr
                      key={t.id}
                      onClick={() => setExpanded(isExpanded ? null : t.id)}
                      style={{ borderBottom: `1px solid ${C.border}`, cursor: 'pointer', background: isExpanded ? C.bgCard : 'transparent' }}
                    >
                      <td style={{ padding: '8px 10px', color: C.muted }}>{t.logged_at.slice(0, 10)}</td>
                      <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontWeight: 700, color: '#fff' }}>{t.ticker}</td>
                      <td style={{ padding: '8px 10px', color: C.muted, textTransform: 'capitalize' }}>{t.trade_type}</td>
                      <td style={{ padding: '8px 10px', color: C.muted, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.signal_given || '—'}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: '#ccc' }}>{fmt(t.actual_entry)}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: '#ccc' }}>{fmt(t.exit_price)}</td>
                      <td style={{ padding: '8px 10px', fontWeight: 700, color: wlColor }}>
                        {t.outcome || (isOpen ? <span style={{ color: C.purple }}>OPEN</span> : '—')}
                      </td>
                      <td style={{ padding: '8px 10px', color: planColor, fontWeight: 700 }}>{planIcon}</td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${t.id}-exp`} style={{ background: C.bgPage, borderBottom: `1px solid ${C.border}` }}>
                        <td colSpan={8} style={{ padding: '12px 16px' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 24px', fontSize: '0.75rem', marginBottom: 10 }}>
                            <span style={{ color: C.muted }}>Planned entry: <span style={{ color: '#ccc', fontFamily: 'monospace' }}>{fmt(t.planned_entry)}</span></span>
                            <span style={{ color: C.muted }}>T1: <span style={{ color: C.green, fontFamily: 'monospace' }}>{fmt(t.planned_t1)}</span></span>
                            <span style={{ color: C.muted }}>T2: <span style={{ color: C.green, fontFamily: 'monospace' }}>{fmt(t.planned_t2)}</span></span>
                            <span style={{ color: C.muted }}>Stop: <span style={{ color: C.red, fontFamily: 'monospace' }}>{fmt(t.planned_stop)}</span></span>
                            <span style={{ color: C.muted }}>Contracts: <span style={{ color: '#ccc' }}>{t.contracts}</span></span>
                            {t.pnl_estimate != null && (
                              <span style={{ color: C.muted }}>P&L est: <span style={{ color: t.pnl_estimate >= 0 ? C.green : C.red, fontFamily: 'monospace' }}>{fmt(t.pnl_estimate)}</span></span>
                            )}
                          </div>
                          {t.notes && <p style={{ color: C.muted, fontSize: '0.75rem', marginBottom: 8 }}>{t.notes}</p>}
                          <div style={{ display: 'flex', gap: 8 }}>
                            {isOpen && (
                              <button
                                type="button"
                                onClick={e => { e.stopPropagation(); onClose(t) }}
                                style={{
                                  background: 'rgba(74,124,255,0.12)', border: `1px solid ${C.accent}`,
                                  color: C.accent, borderRadius: 6, padding: '5px 12px', fontSize: '0.75rem', cursor: 'pointer',
                                }}
                              >
                                Close Trade
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={e => { e.stopPropagation(); onDelete(t.id) }}
                              style={{
                                background: 'rgba(255,77,109,0.08)', border: `1px solid rgba(255,77,109,0.3)`,
                                color: C.red, borderRadius: 6, padding: '5px 12px', fontSize: '0.75rem', cursor: 'pointer',
                              }}
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
