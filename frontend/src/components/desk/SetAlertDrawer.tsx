import { useEffect, useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import type { DeskAlertCreate } from '../../api/client'

const C = {
  bgPage:    '#0A0C10',
  bgPanel:   '#111318',
  border:    '#1E2330',
  borderSub: '#252C3A',
  muted:     '#5A6478',
  accent:    '#4A7CFF',
  amber:     '#F5A623',
  green:     '#00E5A0',
  red:       '#FF4D6D',
}

const ALERT_TYPES = [
  { value: 'RVOL',         label: 'RVOL crosses X×',    hint: 'Triggers when relative volume exceeds threshold' },
  { value: 'PRICE_CROSS',  label: 'Price crosses $X',   hint: 'Triggers when price hits your level' },
  { value: 'VWAP_RETEST',  label: 'VWAP retest',        hint: 'Triggers on VWAP touch/retest' },
  { value: 'SIGNAL_ENTER', label: 'Signal → ENTER',     hint: 'Triggers when engine flips to ENTER' },
] as const

interface Props {
  ticker: string
  tradeType: string
  onClose: () => void
  onSubmit: (data: DeskAlertCreate) => Promise<void>
  drawerLeft?: number
}

export default function SetAlertDrawer({ ticker, tradeType, onClose, onSubmit, drawerLeft = 300 }: Props) {
  const [alertType, setAlertType] = useState<string>('RVOL')
  const [thresholdValue, setThresholdValue] = useState('')
  const [notifyMethod, setNotifyMethod] = useState<'inapp' | 'email' | 'both'>('inapp')
  const [expires, setExpires] = useState<'eod' | 'tomorrow' | 'week'>('eod')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const needsThreshold = alertType === 'RVOL' || alertType === 'PRICE_CROSS'

  const handleSubmit = async () => {
    setError(null)
    if (needsThreshold) {
      const v = parseFloat(thresholdValue)
      if (!Number.isFinite(v) || v <= 0) { setError('Enter a valid threshold value.'); return }
    }
    try {
      setSubmitting(true)
      const data: DeskAlertCreate = {
        ticker,
        trade_type: tradeType,
        alert_type: alertType,
        threshold_value: needsThreshold ? parseFloat(thresholdValue) : undefined,
        target_signal: alertType === 'SIGNAL_ENTER' ? 'ENTER' : '',
        notify_method: notifyMethod,
        expires,
      }
      await onSubmit(data)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } }; message?: string })?.response?.data?.detail
        ?? (e as Error)?.message ?? 'Request failed'
      setError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: '0.68rem', fontWeight: 700, color: C.muted,
    textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8,
  }
  const inputStyle: React.CSSProperties = {
    width: '100%', background: C.bgPage, border: `1px solid ${C.borderSub}`,
    borderRadius: 8, padding: '9px 12px', color: '#fff', fontFamily: 'monospace',
    fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box',
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, pointerEvents: 'none' }} role="dialog" aria-modal>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', pointerEvents: 'all' }} onClick={onClose} />
      <div style={{
        position: 'absolute', bottom: 0, left: drawerLeft, right: 0,
        background: C.bgPanel, borderTop: `1px solid ${C.border}`,
        borderRadius: '16px 16px 0 0',
        maxHeight: '60vh', display: 'flex', flexDirection: 'column',
        pointerEvents: 'all',
        boxShadow: '0 -8px 40px rgba(0,0,0,0.5)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <h2 style={{ fontWeight: 700, fontSize: '0.95rem', color: '#fff', margin: 0 }}>
            Set Alert — {ticker}
          </h2>
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Alert type radio cards */}
          <div>
            <label style={labelStyle}>Alert type</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {ALERT_TYPES.map(at => {
                const active = alertType === at.value
                return (
                  <button
                    key={at.value}
                    type="button"
                    onClick={() => setAlertType(at.value)}
                    style={{
                      padding: '10px 12px', borderRadius: 8, textAlign: 'left',
                      background: active ? 'rgba(74,124,255,0.15)' : 'transparent',
                      border: `1px solid ${active ? C.accent : C.borderSub}`,
                      color: active ? '#fff' : C.muted, cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: '0.82rem' }}>{at.label}</div>
                    <div style={{ fontSize: '0.68rem', color: C.muted, marginTop: 2 }}>{at.hint}</div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Dynamic input */}
          {needsThreshold && (
            <div>
              <label style={labelStyle}>
                {alertType === 'RVOL' ? 'RVOL threshold (e.g. 1.5×)' : 'Price level ($)'}
              </label>
              <input
                style={inputStyle}
                inputMode="decimal"
                placeholder={alertType === 'RVOL' ? '1.5' : '200.00'}
                value={thresholdValue}
                onChange={e => setThresholdValue(e.target.value)}
              />
            </div>
          )}
          {!needsThreshold && (
            <div style={{ background: C.bgPage, border: `1px solid ${C.borderSub}`, borderRadius: 8, padding: '10px 14px', fontSize: '0.78rem', color: C.muted }}>
              {alertType === 'VWAP_RETEST'
                ? 'Alert fires when price touches VWAP intraday'
                : `Alert fires when engine issues ENTER signal for ${ticker}`}
            </div>
          )}

          {/* Notify via */}
          <div>
            <label style={labelStyle}>Notify via</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['inapp', 'email', 'both'] as const).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setNotifyMethod(m)}
                  style={{
                    flex: 1, padding: '8px 0', borderRadius: 8, fontSize: '0.82rem', fontWeight: 600,
                    background: notifyMethod === m ? 'rgba(74,124,255,0.15)' : 'transparent',
                    border: `1px solid ${notifyMethod === m ? C.accent : C.borderSub}`,
                    color: notifyMethod === m ? '#fff' : C.muted, cursor: 'pointer',
                  }}
                >
                  {m === 'inapp' ? 'In-App' : m.charAt(0).toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Expires */}
          <div>
            <label style={labelStyle}>Expires</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {([['eod', 'End of Session'], ['tomorrow', 'Tomorrow'], ['week', 'This Week']] as const).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setExpires(v)}
                  style={{
                    flex: 1, padding: '8px 0', borderRadius: 8, fontSize: '0.78rem', fontWeight: 600,
                    background: expires === v ? 'rgba(245,166,35,0.12)' : 'transparent',
                    border: `1px solid ${expires === v ? C.amber : C.borderSub}`,
                    color: expires === v ? C.amber : C.muted, cursor: 'pointer',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {error && <p style={{ color: C.red, fontSize: '0.78rem' }}>{error}</p>}

          <div style={{ display: 'flex', gap: 10, paddingBottom: 8 }}>
            <button
              type="button"
              onClick={onClose}
              style={{ flex: 1, padding: '10px 0', borderRadius: 10, background: 'transparent', border: `1px solid ${C.borderSub}`, color: C.muted, fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={submitting}
              style={{ flex: 1, padding: '10px 0', borderRadius: 10, background: C.amber, border: 'none', color: '#000', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: submitting ? 0.6 : 1 }}
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              Set Alert →
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
