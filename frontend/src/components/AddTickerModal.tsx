import { useState } from 'react'
import { Loader2, Plus, X } from 'lucide-react'
import { addWatchlistTicker } from '../api/commandCenter'

function axiosErrorMessage(err: unknown): string {
  if (typeof err === 'string') return err
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>
    if (typeof e.message === 'string') return e.message
    const resp = (e as Record<string, unknown>).response as Record<string, unknown> | undefined
    if (resp) {
      const d = resp.data as Record<string, unknown> | undefined
      if (d) {
        if (typeof d.detail === 'string') return d.detail
        if (d.error && typeof d.error === 'object') {
          const em = (d.error as Record<string, unknown>).message
          if (typeof em === 'string') return em
        }
      }
      if (typeof resp.status === 'number') return `HTTP ${resp.status}`
    }
  }
  return 'An unexpected error occurred.'
}

const SOURCES = [
  { value: 'Manual', label: 'Manual' },
  { value: 'Day Trade', label: 'Day Trade' },
  { value: 'Swing Trade', label: 'Swing Trade' },
  { value: 'Regular', label: 'Regular' },
]

interface Props {
  open: boolean
  onClose: () => void
  onAdded: () => void
}

export default function AddTickerModal({ open, onClose, onAdded }: Props) {
  const [ticker, setTicker] = useState('')
  const [source, setSource] = useState('Manual')
  const [watchReason, setWatchReason] = useState('')
  const [notes, setNotes] = useState('')
  const [desiredEntry, setDesiredEntry] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  const handleSubmit = async () => {
    const sym = ticker.trim().toUpperCase()
    if (!sym) { setError('Ticker symbol is required.'); return }
    setBusy(true)
    setError(null)
    try {
      const res = await addWatchlistTicker({
        ticker: sym,
        source,
        watch_reason: watchReason.trim() || undefined,
        notes: notes.trim() || undefined,
        desired_entry: desiredEntry ? Number(desiredEntry) : null,
      })
      if (res?.data?.duplicate) {
        setError(`"${sym}" is already in your watchlist.`)
        setBusy(false)
        return
      }
      onAdded()
      handleClose()
    } catch (err) {
      setError(axiosErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const handleClose = () => {
    setTicker('')
    setSource('Manual')
    setWatchReason('')
    setNotes('')
    setDesiredEntry('')
    setError(null)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm p-4 pt-[10vh]" onClick={handleClose}>
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-gray-800 bg-gray-900 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-800 px-5 py-4">
          <h2 className="text-base font-bold text-white">Add Ticker</h2>
          <button type="button" onClick={handleClose} className="rounded-lg p-1 text-muted hover:bg-gray-800 hover:text-white"><X size={16} /></button>
        </div>
        <div className="space-y-4 px-5 py-4">
          {error && (
            <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</div>
          )}

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">Ticker Symbol</label>
            <input
              value={ticker}
              onChange={e => setTicker(e.target.value.toUpperCase())}
              placeholder="e.g. NVDA"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder:text-muted focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
              autoFocus
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">Source</label>
            <select
              value={source}
              onChange={e => setSource(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
            >
              {SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">Watch Reason</label>
            <input
              value={watchReason}
              onChange={e => setWatchReason(e.target.value)}
              placeholder="e.g. Earnings play, support bounce..."
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder:text-muted focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Optional notes..."
              rows={2}
              className="w-full resize-none rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder:text-muted focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">Desired Entry Price</label>
            <input
              value={desiredEntry}
              onChange={e => setDesiredEntry(e.target.value)}
              placeholder="Optional"
              type="number"
              step="0.01"
              min="0"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder:text-muted focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-gray-800 px-5 py-4">
          <button type="button" onClick={handleClose} className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-semibold text-muted hover:bg-gray-800 hover:text-white">Cancel</button>
          <button type="button" onClick={() => void handleSubmit()} disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Add Ticker
          </button>
        </div>
      </div>
    </div>
  )
}
