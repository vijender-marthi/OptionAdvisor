import { useEffect, useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import type { DeskAlertCreate } from '../../api/client'

const ALERT_TYPES = [
  { value: 'RVOL', label: 'RVOL > X' },
  { value: 'PRICE_CROSS', label: 'Price crosses $X' },
  { value: 'VWAP_RETEST', label: 'VWAP retest' },
  { value: 'SIGNAL_ENTER', label: 'Signal → ENTER' },
] as const

interface Props {
  ticker: string
  tradeType: string
  onClose: () => void
  onSubmit: (data: DeskAlertCreate) => Promise<void>
}

export default function SetAlertDrawer({ ticker, tradeType, onClose, onSubmit }: Props) {
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
      if (!Number.isFinite(v) || v <= 0) {
        setError('Enter a valid threshold value.')
        return
      }
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

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal>
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-t-2xl border-t border-x border-white/[0.1] bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.07]">
          <h2 className="text-sm font-bold text-white">Set Alert — {ticker}</h2>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-300 p-1">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-4 text-sm max-h-[80vh] overflow-y-auto">
          {/* Alert type */}
          <div>
            <label className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-2 block">Alert type</label>
            <div className="grid grid-cols-2 gap-2">
              {ALERT_TYPES.map(at => (
                <button
                  key={at.value}
                  type="button"
                  onClick={() => setAlertType(at.value)}
                  className={`rounded-lg py-2.5 px-3 text-sm border text-left transition-colors ${
                    alertType === at.value
                      ? 'bg-violet-700/40 border-violet-500 text-violet-200'
                      : 'bg-slate-800 border-white/[0.08] text-gray-400 hover:border-white/[0.15]'
                  }`}
                >
                  {at.label}
                </button>
              ))}
            </div>
          </div>

          {/* Dynamic input */}
          {needsThreshold && (
            <div>
              <label className="text-xs text-gray-500 font-semibold uppercase tracking-wide">
                {alertType === 'RVOL' ? 'RVOL threshold (e.g. 1.5)' : 'Price ($)'}
              </label>
              <input
                className="mt-1 w-full bg-slate-800 border border-white/[0.08] rounded-xl px-3 py-2.5 text-white font-mono outline-none focus:border-violet-500"
                inputMode="decimal"
                placeholder={alertType === 'RVOL' ? '1.5' : '200.00'}
                value={thresholdValue}
                onChange={e => setThresholdValue(e.target.value)}
              />
            </div>
          )}

          {/* Notify method */}
          <div>
            <label className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-2 block">Notify via</label>
            <div className="flex gap-2">
              {(['inapp', 'email', 'both'] as const).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setNotifyMethod(m)}
                  className={`flex-1 rounded-lg py-2 text-sm border transition-colors capitalize ${
                    notifyMethod === m
                      ? 'bg-sky-700/40 border-sky-500 text-sky-200'
                      : 'bg-slate-800 border-white/[0.08] text-gray-400 hover:border-white/[0.15]'
                  }`}
                >
                  {m === 'inapp' ? 'In-app' : m.charAt(0).toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Expires */}
          <div>
            <label className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-2 block">Expires</label>
            <div className="flex gap-2">
              {(['eod', 'tomorrow', 'week'] as const).map(e => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setExpires(e)}
                  className={`flex-1 rounded-lg py-2 text-sm border transition-colors ${
                    expires === e
                      ? 'bg-amber-700/40 border-amber-500 text-amber-200'
                      : 'bg-slate-800 border-white/[0.08] text-gray-400 hover:border-white/[0.15]'
                  }`}
                >
                  {e === 'eod' ? 'EOD' : e.charAt(0).toUpperCase() + e.slice(1)}
                </button>
              ))}
            </div>
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
              className="flex-1 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-semibold py-2.5 text-sm flex items-center justify-center gap-2 transition-colors"
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
