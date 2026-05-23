import { useEffect, useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import type { DeskTradeCreate, DeskTradeUpdate, DeskTradeLog } from '../../api/client'

const C = {
  bgPage:    '#0A0C10',
  bgPanel:   '#111318',
  border:    '#1E2330',
  borderSub: '#252C3A',
  muted:     '#5A6478',
  accent:    '#4A7CFF',
  green:     '#00E5A0',
  red:       '#FF4D6D',
  amber:     '#F5A623',
}

interface NewModeProps {
  mode: 'new'
  ticker: string
  tradeType: string
  signalGiven?: string
  confidence?: number
  plannedEntry?: number | null
  plannedT1?: number | null
  plannedT2?: number | null
  plannedStop?: number | null
  structure?: string
  onSubmit: (data: DeskTradeCreate) => Promise<void>
}

interface CloseModeProps {
  mode: 'close'
  trade: DeskTradeLog
  onSubmit: (data: DeskTradeUpdate) => Promise<void>
}

type Props = (NewModeProps | CloseModeProps) & { onClose: () => void; drawerLeft?: number }

const EXIT_REASONS = ['T1 hit', 'T2 hit', 'Stop hit', 'Manual'] as const

export default function LogTradeDrawer(props: Props) {
  const { onClose, drawerLeft = 300 } = props

  const [actualEntry, setActualEntry] = useState('')
  const [contracts, setContracts] = useState('1')
  const [notes, setNotes] = useState('')
  const [exitReason, setExitReason] = useState<string>('Manual')
  const [exitPrice, setExitPrice] = useState('')
  const [followedPlan, setFollowedPlan] = useState<'yes' | 'partial' | 'no'>('yes')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (props.mode !== 'close') return
    const t = props.trade
    if (exitReason === 'T1 hit' && t.planned_t1 != null) setExitPrice(String(t.planned_t1))
    else if (exitReason === 'T2 hit' && t.planned_t2 != null) setExitPrice(String(t.planned_t2))
    else if (exitReason === 'Stop hit' && t.planned_stop != null) setExitPrice(String(t.planned_stop))
  }, [exitReason]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const handleSubmit = async () => {
    setError(null)
    try {
      setSubmitting(true)
      if (props.mode === 'new') {
        const ep = parseFloat(actualEntry)
        if (actualEntry.trim() && (!Number.isFinite(ep) || ep <= 0)) { setError('Enter a valid entry price.'); return }
        const c = parseInt(contracts, 10)
        if (!Number.isFinite(c) || c <= 0) { setError('Contracts must be a positive number.'); return }
        const data: DeskTradeCreate = {
          ticker: props.ticker,
          trade_type: props.tradeType,
          signal_given: props.signalGiven || '',
          confidence_score: props.confidence || 0,
          planned_entry: props.plannedEntry,
          planned_t1: props.plannedT1,
          planned_t2: props.plannedT2,
          planned_stop: props.plannedStop,
          structure: props.structure || '',
          actual_entry: actualEntry.trim() ? ep : undefined,
          contracts: c,
          notes,
        }
        await props.onSubmit(data)
      } else {
        const ep = parseFloat(exitPrice)
        if (!Number.isFinite(ep) || ep <= 0) { setError('Enter a valid exit price.'); return }
        const outcome = exitReason === 'Stop hit' ? 'LOSS' : 'WIN'
        const data: DeskTradeUpdate = {
          exit_price: ep,
          exit_time: new Date().toISOString(),
          exit_reason: exitReason,
          followed_plan: followedPlan,
          outcome,
          notes,
        }
        await props.onSubmit(data)
      }
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
    textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6,
  }
  const inputStyle: React.CSSProperties = {
    width: '100%', background: C.bgPage, border: `1px solid ${C.borderSub}`,
    borderRadius: 8, padding: '9px 12px', color: '#fff', fontFamily: 'monospace',
    fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box',
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, pointerEvents: 'none' }} role="dialog" aria-modal>
      {/* Backdrop */}
      <div
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', pointerEvents: 'all' }}
        onClick={onClose}
      />
      {/* Drawer */}
      <div style={{
        position: 'absolute', bottom: 0, left: drawerLeft, right: 0,
        background: C.bgPanel, borderTop: `1px solid ${C.border}`,
        borderRadius: '16px 16px 0 0',
        maxHeight: '75vh', display: 'flex', flexDirection: 'column',
        pointerEvents: 'all',
        boxShadow: '0 -8px 40px rgba(0,0,0,0.5)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <h2 style={{ fontWeight: 700, fontSize: '0.95rem', color: '#fff', margin: 0 }}>
            {props.mode === 'new'
              ? `Log Trade — ${props.ticker}`
              : `Close Trade — ${props.trade.ticker}`}
          </h2>
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {props.mode === 'new' ? (
            <>
              {/* Read-only plan section */}
              {(props.plannedEntry || props.plannedT1 || props.plannedStop || props.signalGiven) && (
                <div style={{ background: C.bgPage, border: `1px solid ${C.borderSub}`, borderRadius: 8, padding: '10px 14px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 20px', fontSize: '0.78rem' }}>
                  {props.signalGiven && <span style={{ color: C.muted }}>Signal: <span style={{ color: '#fff', fontFamily: 'monospace' }}>{props.signalGiven}</span></span>}
                  {props.structure && <span style={{ color: C.muted }}>Structure: <span style={{ color: '#fff', fontFamily: 'monospace' }}>{props.structure}</span></span>}
                  {props.plannedEntry != null && <span style={{ color: C.muted }}>Entry: <span style={{ color: C.green, fontFamily: 'monospace' }}>${props.plannedEntry.toFixed(2)}</span></span>}
                  {props.plannedT1 != null && <span style={{ color: C.muted }}>T1: <span style={{ color: C.green, fontFamily: 'monospace' }}>${props.plannedT1.toFixed(2)}</span></span>}
                  {props.plannedT2 != null && <span style={{ color: C.muted }}>T2: <span style={{ color: C.green, fontFamily: 'monospace' }}>${props.plannedT2.toFixed(2)}</span></span>}
                  {props.plannedStop != null && <span style={{ color: C.muted }}>Stop: <span style={{ color: C.red, fontFamily: 'monospace' }}>${props.plannedStop.toFixed(2)}</span></span>}
                </div>
              )}
              <div>
                <label style={labelStyle}>Actual Entry ($)</label>
                <input style={inputStyle} inputMode="decimal" placeholder="e.g. 2.45" value={actualEntry} onChange={e => setActualEntry(e.target.value)} />
              </div>
              <div>
                <label style={labelStyle}>Contracts</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {['1', '2', '5', '10'].map(n => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setContracts(n)}
                      style={{
                        flex: 1, padding: '8px 0', borderRadius: 8, fontFamily: 'monospace', fontWeight: 700, fontSize: '0.9rem',
                        background: contracts === n ? 'rgba(74,124,255,0.18)' : 'transparent',
                        border: `1px solid ${contracts === n ? C.accent : C.borderSub}`,
                        color: contracts === n ? C.accent : C.muted, cursor: 'pointer',
                      }}
                    >{n}</button>
                  ))}
                  <input
                    style={{ ...inputStyle, width: 64, flex: 'none', textAlign: 'center', padding: '8px 6px' }}
                    inputMode="numeric"
                    placeholder="…"
                    value={['1','2','5','10'].includes(contracts) ? '' : contracts}
                    onChange={e => setContracts(e.target.value)}
                  />
                </div>
              </div>
            </>
          ) : (
            <>
              <div style={{ background: C.bgPage, border: `1px solid ${C.borderSub}`, borderRadius: 8, padding: '10px 14px', fontSize: '0.78rem' }}>
                Entered <span style={{ color: '#fff', fontFamily: 'monospace' }}>{props.trade.actual_entry != null ? `$${props.trade.actual_entry}` : '—'}</span>
                {' · '}
                <span style={{ color: '#fff', fontFamily: 'monospace' }}>{props.trade.contracts} contracts</span>
              </div>
              <div>
                <label style={labelStyle}>Exit reason</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {EXIT_REASONS.map(r => {
                    const t = props.trade
                    const price = r === 'T1 hit' ? t.planned_t1 : r === 'T2 hit' ? t.planned_t2 : r === 'Stop hit' ? t.planned_stop : null
                    return (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setExitReason(r)}
                        style={{
                          padding: '10px 12px', borderRadius: 8, textAlign: 'left',
                          background: exitReason === r ? 'rgba(74,124,255,0.15)' : 'transparent',
                          border: `1px solid ${exitReason === r ? C.accent : C.borderSub}`,
                          color: exitReason === r ? '#fff' : C.muted, cursor: 'pointer',
                          fontSize: '0.82rem',
                        }}
                      >
                        <div style={{ fontWeight: 600 }}>{r}</div>
                        {price != null && <div style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: r === 'Stop hit' ? C.red : C.green, marginTop: 2 }}>${price.toFixed(2)}</div>}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div>
                <label style={labelStyle}>Exit Price ($)</label>
                <input style={inputStyle} inputMode="decimal" placeholder="e.g. 3.20" value={exitPrice} onChange={e => setExitPrice(e.target.value)} />
              </div>
              <div>
                <label style={labelStyle}>Did you follow the plan?</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['yes', 'partial', 'no'] as const).map(v => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setFollowedPlan(v)}
                      style={{
                        flex: 1, padding: '8px 0', borderRadius: 8, fontSize: '0.82rem', fontWeight: 600,
                        background: followedPlan === v ? (v === 'yes' ? 'rgba(0,229,160,0.15)' : v === 'partial' ? 'rgba(245,166,35,0.15)' : 'rgba(255,77,109,0.15)') : 'transparent',
                        border: `1px solid ${followedPlan === v ? (v === 'yes' ? C.green : v === 'partial' ? C.amber : C.red) : C.borderSub}`,
                        color: followedPlan === v ? '#fff' : C.muted, cursor: 'pointer', textTransform: 'capitalize',
                      }}
                    >{v}</button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Notes */}
          <div>
            <label style={labelStyle}>Notes (optional)</label>
            <textarea
              style={{ ...inputStyle, minHeight: 60, resize: 'vertical', fontFamily: 'inherit', fontSize: '0.85rem', lineHeight: 1.5 }}
              placeholder="What you saw, what you did…"
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
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
              style={{ flex: 1, padding: '10px 0', borderRadius: 10, background: C.accent, border: 'none', color: '#fff', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: submitting ? 0.6 : 1 }}
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              {props.mode === 'new' ? 'Log Trade →' : 'Close Trade →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
