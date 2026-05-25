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

type AlertTypeOption = { value: string; label: string; hint: string; needsThreshold?: boolean }

const ALERT_TYPES_BY_TRADE: Record<string, AlertTypeOption[]> = {
  day: [
    { value: 'VERDICT_CHANGE', label: 'Verdict transition',   hint: 'Fires when engine moves WAIT→WATCH or WATCH→ENTER' },
    { value: 'RVOL',           label: 'RVOL crosses X×',      hint: 'Fires once when relative volume crosses threshold', needsThreshold: true },
    { value: 'OR_BREAK',       label: 'OR High/Low break',    hint: 'Fires once when price breaks the opening range' },
    { value: 'VWAP_RETEST',    label: 'VWAP retest',          hint: 'Fires when price touches VWAP intraday' },
    { value: 'PRICE_CROSS',    label: 'Price crosses $X',     hint: 'Fires once when price crosses your level', needsThreshold: true },
  ],
  swing: [
    { value: 'VERDICT_CHANGE', label: 'Verdict transition',   hint: 'Fires when verdict changes (WAIT→WATCH→GO)' },
    { value: 'SCORE_CROSS',    label: 'Score crosses X',      hint: 'Fires when swing score crosses threshold', needsThreshold: true },
    { value: 'MA_PROXIMITY',   label: 'MA20 proximity',       hint: 'Fires when price comes within 1% of MA20' },
    { value: 'PRICE_CROSS',    label: 'Position target $X',   hint: 'Fires when price reaches your target level', needsThreshold: true },
  ],
  regular: [
    { value: 'SCORE_CROSS',      label: 'Score crosses X',      hint: 'Fires when score crosses 70 (entry) or drops below 50', needsThreshold: true },
    { value: 'VERDICT_CHANGE',   label: 'Verdict change',        hint: 'Fires when trade moves from SETUP→ENTRY' },
    { value: 'EARNINGS_WARNING', label: 'Earnings warning',      hint: 'Fires 10 days before earnings within your DTE' },
    { value: 'DTE_STOP',         label: 'DTE time stop',         hint: 'Fires when position reaches 21 DTE' },
    { value: 'PROFIT_TARGET',    label: '50% profit target',     hint: 'Fires when position reaches 50% of max profit' },
  ],
}

const EXPIRY_BY_TRADE: Record<string, 'eod' | 'tomorrow' | 'week'> = {
  day:     'eod',
  swing:   'tomorrow',
  regular: 'week',
}

interface Props {
  ticker: string
  tradeType: string
  onClose: () => void
  onSubmit: (data: DeskAlertCreate) => Promise<void>
}

export default function SetAlertDrawer({ ticker, tradeType, onClose, onSubmit }: Props) {
  const normalizedType = (tradeType || 'day').toLowerCase().replace(/[^a-z]/g, '')
  const alertOptions = ALERT_TYPES_BY_TRADE[normalizedType] ?? ALERT_TYPES_BY_TRADE.day
  const defaultExpiry = EXPIRY_BY_TRADE[normalizedType] ?? 'eod'

  const [alertType, setAlertType] = useState<string>(alertOptions[0].value)
  const [thresholdValue, setThresholdValue] = useState('')
  const [notifyMethod, setNotifyMethod] = useState<'inapp' | 'email' | 'both'>('inapp')
  const [expires, setExpires] = useState<'eod' | 'tomorrow' | 'week'>(defaultExpiry)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const selectedOption = alertOptions.find(o => o.value === alertType) ?? alertOptions[0]
  const needsThreshold = !!selectedOption.needsThreshold

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
        target_signal: '',
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
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} role="dialog" aria-modal>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(2px)' }} onClick={onClose} />
      <div style={{
        position: 'relative',
        width: '100%', maxWidth: 520,
        maxHeight: '85dvh',
        display: 'flex', flexDirection: 'column',
        background: C.bgPanel,
        borderRadius: '20px 20px 0 0',
        border: `1px solid ${C.border}`,
        borderBottom: 'none',
        boxShadow: '0 -12px 48px rgba(0,0,0,0.6)',
        margin: '0 auto',
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
              {alertOptions.map(at => {
                const active = alertType === at.value
                return (
                  <button
                    key={at.value}
                    type="button"
                    onClick={() => { setAlertType(at.value); setThresholdValue('') }}
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

          {/* Dynamic threshold input */}
          {needsThreshold && (
            <div>
              <label style={labelStyle}>
                {alertType === 'RVOL' ? 'RVOL threshold (e.g. 2×)' : alertType === 'SCORE_CROSS' ? 'Score threshold (e.g. 70)' : 'Price level ($)'}
              </label>
              <input
                style={inputStyle}
                inputMode="decimal"
                placeholder={alertType === 'RVOL' ? '2.0' : alertType === 'SCORE_CROSS' ? '70' : '200.00'}
                value={thresholdValue}
                onChange={e => setThresholdValue(e.target.value)}
              />
            </div>
          )}
          {!needsThreshold && (
            <div style={{ background: C.bgPage, border: `1px solid ${C.borderSub}`, borderRadius: 8, padding: '10px 14px', fontSize: '0.78rem', color: C.muted }}>
              {selectedOption.hint}
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
