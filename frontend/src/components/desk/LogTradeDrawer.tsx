import { useEffect, useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import type { DeskTradeCreate, DeskTradeUpdate, DeskTradeLog } from '../../api/client'

type Mode = 'new' | 'close'

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

type Props = (NewModeProps | CloseModeProps) & {
  onClose: () => void
}

const EXIT_REASONS = ['T1 hit', 'T2 hit', 'Stop hit', 'Manual'] as const

export default function LogTradeDrawer(props: Props) {
  const { onClose } = props

  // New trade fields
  const [actualEntry, setActualEntry] = useState('')
  const [contracts, setContracts] = useState('1')
  const [notes, setNotes] = useState('')

  // Close trade fields
  const [exitReason, setExitReason] = useState<string>('Manual')
  const [exitPrice, setExitPrice] = useState('')
  const [followedPlan, setFollowedPlan] = useState<'yes' | 'partial' | 'no'>('yes')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Pre-fill exit price from radio selection for close mode
  useEffect(() => {
    if (props.mode !== 'close') return
    const t = props.trade
    if (exitReason === 'T1 hit' && t.planned_t1 != null) setExitPrice(String(t.planned_t1))
    else if (exitReason === 'T2 hit' && t.planned_t2 != null) setExitPrice(String(t.planned_t2))
    else if (exitReason === 'Stop hit' && t.planned_stop != null) setExitPrice(String(t.planned_stop))
  }, [exitReason]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close on Esc
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
        if (actualEntry.trim() && (!Number.isFinite(ep) || ep <= 0)) {
          setError('Enter a valid entry price.')
          return
        }
        const c = parseInt(contracts, 10)
        if (!Number.isFinite(c) || c <= 0) {
          setError('Contracts must be a positive number.')
          return
        }
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
        if (!Number.isFinite(ep) || ep <= 0) {
          setError('Enter a valid exit price.')
          return
        }
        const outcome = exitReason === 'Stop hit' ? 'LOSS' : 'WIN'
        const now = new Date().toISOString()
        const data: DeskTradeUpdate = {
          exit_price: ep,
          exit_time: now,
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

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal>
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-t-2xl border-t border-x border-white/[0.1] bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.07]">
          <h2 className="text-sm font-bold text-white">
            {props.mode === 'new' ? 'Log Trade' : 'Close Trade'}
          </h2>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-300 p-1">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-3 text-sm max-h-[80vh] overflow-y-auto">
          {props.mode === 'new' ? (
            <>
              {/* Read-only plan info */}
              {(props.plannedEntry || props.plannedT1 || props.plannedStop) && (
                <div className="rounded-lg bg-slate-800/50 border border-white/[0.06] px-3 py-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  {props.signalGiven && <span className="text-gray-500">Signal: <span className="text-gray-200 font-mono">{props.signalGiven}</span></span>}
                  {props.plannedEntry != null && <span className="text-gray-500">Entry: <span className="text-gray-200 font-mono">${props.plannedEntry?.toFixed(2)}</span></span>}
                  {props.plannedT1 != null && <span className="text-gray-500">T1: <span className="text-gray-200 font-mono">${props.plannedT1?.toFixed(2)}</span></span>}
                  {props.plannedT2 != null && <span className="text-gray-500">T2: <span className="text-gray-200 font-mono">${props.plannedT2?.toFixed(2)}</span></span>}
                  {props.plannedStop != null && <span className="text-gray-500">Stop: <span className="text-gray-200 font-mono">${props.plannedStop?.toFixed(2)}</span></span>}
                </div>
              )}
              <div>
                <label className="text-xs text-gray-500 font-semibold uppercase tracking-wide">Actual Entry ($)</label>
                <input
                  className="mt-1 w-full bg-slate-800 border border-white/[0.08] rounded-xl px-3 py-2.5 text-white font-mono outline-none focus:border-violet-500"
                  inputMode="decimal"
                  placeholder="e.g. 2.45"
                  value={actualEntry}
                  onChange={e => setActualEntry(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 font-semibold uppercase tracking-wide">Contracts</label>
                <div className="flex gap-2 mt-1">
                  {['1', '2', '5', '10'].map(n => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setContracts(n)}
                      className={`flex-1 rounded-lg py-2 font-mono font-bold text-sm border transition-colors ${
                        contracts === n
                          ? 'bg-violet-600 border-violet-500 text-white'
                          : 'bg-slate-800 border-white/[0.08] text-gray-400 hover:border-white/[0.15]'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                  <input
                    className="w-16 bg-slate-800 border border-white/[0.08] rounded-lg px-2 py-2 text-white font-mono text-sm text-center outline-none focus:border-violet-500"
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
              <div className="rounded-lg bg-slate-800/50 border border-white/[0.06] px-3 py-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <span className="text-gray-500">Entered at: <span className="text-gray-200 font-mono">{props.trade.actual_entry != null ? `$${props.trade.actual_entry}` : '—'}</span></span>
                <span className="text-gray-500">Contracts: <span className="text-gray-200 font-mono">{props.trade.contracts}</span></span>
              </div>
              <div>
                <label className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-1.5 block">Exit reason</label>
                <div className="grid grid-cols-2 gap-2">
                  {EXIT_REASONS.map(r => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setExitReason(r)}
                      className={`rounded-lg py-2 text-sm border transition-colors ${
                        exitReason === r
                          ? 'bg-violet-600 border-violet-500 text-white'
                          : 'bg-slate-800 border-white/[0.08] text-gray-400 hover:border-white/[0.15]'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 font-semibold uppercase tracking-wide">Exit Price ($)</label>
                <input
                  className="mt-1 w-full bg-slate-800 border border-white/[0.08] rounded-xl px-3 py-2.5 text-white font-mono outline-none focus:border-violet-500"
                  inputMode="decimal"
                  placeholder="e.g. 3.20"
                  value={exitPrice}
                  onChange={e => setExitPrice(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-1.5 block">Followed plan</label>
                <div className="flex gap-2">
                  {(['yes', 'partial', 'no'] as const).map(v => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setFollowedPlan(v)}
                      className={`flex-1 rounded-lg py-2 text-sm border transition-colors capitalize ${
                        followedPlan === v
                          ? 'bg-emerald-700 border-emerald-600 text-white'
                          : 'bg-slate-800 border-white/[0.08] text-gray-400 hover:border-white/[0.15]'
                      }`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Notes (both modes) */}
          <div>
            <label className="text-xs text-gray-500 font-semibold uppercase tracking-wide">Notes (optional)</label>
            <textarea
              className="mt-1 w-full bg-slate-800 border border-white/[0.08] rounded-xl px-3 py-2.5 text-white text-sm min-h-[60px] outline-none focus:border-violet-500"
              placeholder="What you saw, what you did…"
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>

          {error && <p className="text-rose-300 text-xs">{error}</p>}

          <div className="flex gap-2 pt-1 pb-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-white/[0.1] bg-transparent text-gray-400 hover:bg-white/[0.04] py-2.5 font-semibold text-sm transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={submitting}
              className="flex-1 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold py-2.5 text-sm flex items-center justify-center gap-2 transition-colors"
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
