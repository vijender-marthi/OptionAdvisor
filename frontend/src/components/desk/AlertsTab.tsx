import { useState } from 'react'
import type { DeskAlert } from '../../api/client'

const C = {
  bgPanel:   '#111318',
  bgCard:    '#181C23',
  border:    '#1E2330',
  muted:     '#5A6478',
  amber:     '#F5A623',
  red:       '#FF4D6D',
}

function alertDescription(a: DeskAlert): string {
  switch (a.alert_type) {
    case 'RVOL':        return `RVOL > ${a.threshold_value ?? '?'}×`
    case 'PRICE_CROSS': return `Price crosses $${a.threshold_value ?? '?'}`
    case 'VWAP_RETEST': return 'VWAP retest'
    case 'SIGNAL_ENTER': return `Signal → ${a.target_signal || 'ENTER'}`
    default:            return a.alert_type
  }
}

function expiryCopy(expires: string): string {
  if (expires === 'eod')      return 'Expires EOD'
  if (expires === 'tomorrow') return 'Expires tomorrow'
  if (expires === 'week')     return 'Expires this week'
  return `Expires ${expires}`
}

interface Props {
  alerts: DeskAlert[]
  history: DeskAlert[]
  onDelete: (id: string) => void
}

export default function AlertsTab({ alerts, history, onDelete }: Props) {
  const [confirmId, setConfirmId] = useState<string | null>(null)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingBottom: 24 }}>
      {/* Active Alerts */}
      <section>
        <h3 style={{ fontSize: '0.68rem', fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 10 }}>
          Active Alerts
        </h3>
        {alerts.length === 0 ? (
          <p style={{ textAlign: 'center', color: C.muted, fontSize: '0.85rem', padding: '24px 0' }}>No active alerts</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {alerts.map(a => (
              <div
                key={a.id}
                style={{
                  background: C.bgPanel, border: `1px solid ${C.border}`,
                  borderLeft: `3px solid ${C.amber}`,
                  borderRadius: 8, padding: '10px 14px',
                  display: 'flex', alignItems: 'center', gap: 12,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '0.9rem', color: '#fff' }}>{a.ticker}</span>
                    <span style={{ fontSize: '0.78rem', color: C.muted }}>{alertDescription(a)}</span>
                  </div>
                  <div style={{ fontSize: '0.68rem', color: C.muted }}>{expiryCopy(a.expires)}</div>
                </div>
                {confirmId === a.id ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => { onDelete(a.id); setConfirmId(null) }}
                      style={{ background: 'rgba(255,77,109,0.15)', border: `1px solid rgba(255,77,109,0.4)`, color: C.red, borderRadius: 5, padding: '3px 10px', fontSize: '0.72rem', cursor: 'pointer' }}
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmId(null)}
                      style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, borderRadius: 5, padding: '3px 10px', fontSize: '0.72rem', cursor: 'pointer' }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmId(a.id)}
                    style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, borderRadius: 5, padding: '3px 10px', fontSize: '0.72rem', cursor: 'pointer' }}
                  >
                    Delete
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Alert History */}
      <section>
        <h3 style={{ fontSize: '0.68rem', fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 10 }}>
          Alert History
        </h3>
        {history.length === 0 ? (
          <p style={{ textAlign: 'center', color: C.muted, fontSize: '0.85rem', padding: '16px 0' }}>No fired alerts yet</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {history.map(a => (
              <div
                key={a.id}
                style={{
                  background: C.bgCard, border: `1px solid ${C.border}`,
                  borderRadius: 8, padding: '8px 14px', opacity: 0.7,
                  display: 'flex', alignItems: 'center', gap: 10,
                }}
              >
                <span style={{ color: '#00E5A0', fontSize: '0.8rem' }}>✓</span>
                <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '0.82rem', color: '#ccc' }}>{a.ticker}</span>
                <span style={{ fontSize: '0.75rem', color: C.muted }}>·</span>
                <span style={{ fontSize: '0.75rem', color: C.muted }}>{alertDescription(a)}</span>
                {a.fired_at && (
                  <>
                    <span style={{ fontSize: '0.75rem', color: C.muted }}>·</span>
                    <span style={{ fontSize: '0.72rem', color: C.muted }}>{a.fired_at.slice(0, 10)}</span>
                  </>
                )}
                {a.action_taken && (
                  <>
                    <span style={{ fontSize: '0.75rem', color: C.muted }}>·</span>
                    <span style={{ fontSize: '0.72rem', color: C.muted }}>{a.action_taken}</span>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
