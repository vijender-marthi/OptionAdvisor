import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  BookOpen, RefreshCw, Trash2, CheckSquare, ChevronDown, ChevronUp,
  TrendingUp, TrendingDown, MinusCircle, Clock, Activity, X, Edit3, Check,
  AlertTriangle, DollarSign, BarChart3, Filter, Pencil,
} from 'lucide-react'
import { getJournal, refreshJournal, closeJournalEntry, updateJournalNotes, deleteJournalEntry, updateJournalEntry, executeTrade } from '../api/client'
import type { JournalEntry } from '../types'
import { useApp } from '../contexts/AppContext'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt$(n: number, decimals = 0): string {
  const abs = Math.abs(n)
  const str = abs.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  return (n < 0 ? '−$' : '+$') + str
}

function fmtPct(n: number): string {
  return (n >= 0 ? '+' : '') + n.toFixed(1) + '%'
}

function fmtDate(iso: string): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return iso
  }
}

function dteLabel(expiry: string): string {
  if (!expiry) return ''
  try {
    const diff = Math.ceil((new Date(expiry).getTime() - Date.now()) / 86_400_000)
    if (diff < 0) return `${Math.abs(diff)}d ago`
    return `${diff} DTE`
  } catch {
    return ''
  }
}

const STATUS_COLORS: Record<string, string> = {
  OPEN:    'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-700',
  CLOSED:  'bg-slate-100 text-slate-600 border-slate-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700',
  EXPIRED: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700',
}

const OUTCOME_COLORS: Record<string, string> = {
  WIN:  'text-emerald-400',
  LOSS: 'text-red-400',
  BE:   'text-gray-400',
}

const EXIT_LABELS: Record<string, string> = {
  PROFIT_TARGET: 'Profit Target',
  STOP_LOSS:     'Stop Loss',
  '21DTE':       '21 DTE Exit',
  '5DTE':        '5 DTE Exit',
  EXPIRY:        'Expired',
  MANUAL:        'Manual Close',
}

// ─── Price diff helper ───────────────────────────────────────────────────────

function PriceDiff({ current, entry }: { current: number; entry: number }) {
  const diff = current - entry
  const pct = entry !== 0 ? (diff / entry) * 100 : 0
  const color = diff > 0 ? 'text-emerald-400' : diff < 0 ? 'text-red-400' : 'text-gray-400'
  return (
    <span className={`font-mono font-semibold ${color}`}>
      {diff >= 0 ? '+' : ''}${diff.toFixed(2)}&nbsp;({pct >= 0 ? '+' : ''}{pct.toFixed(1)}%)
    </span>
  )
}

// ─── Stat card ───────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color = 'text-slate-900 dark:text-gray-200' }: {
  label: string; value: string; sub?: string; color?: string
}) {
  return (
    <div className="bg-slate-100 dark:bg-gray-800 rounded-xl px-3 py-2">
      <div className="text-slate-500 dark:text-gray-500 mb-0.5 text-xs">{label}</div>
      <div className={`font-semibold font-mono text-sm sm:text-base ${color} break-words`}>{value}</div>
      {sub && <div className="text-slate-400 dark:text-gray-600 text-xs mt-0.5">{sub}</div>}
    </div>
  )
}

// ─── Close modal ─────────────────────────────────────────────────────────────

function CloseModal({ entry, onClose, onConfirm }: {
  entry: JournalEntry
  onClose: () => void
  onConfirm: (reason: string, notes: string) => Promise<void>
}) {
  const [reason, setReason] = useState('MANUAL')
  const [notes, setNotes] = useState(entry.notes || '')
  const [loading, setLoading] = useState(false)

  const handleConfirm = async () => {
    setLoading(true)
    try {
      await onConfirm(reason, notes)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
          className="w-full max-w-md max-h-[90dvh] overflow-y-auto overscroll-contain bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 rounded-2xl p-4 sm:p-5 shadow-2xl"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-4">
            <div className="font-bold text-slate-900 dark:text-white">Close Trade</div>
            <button onClick={onClose} className="text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-300 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="text-sm text-gray-400 mb-4">
          <span className="font-semibold text-white">{entry.ticker}</span> · {entry.strategy} · exp {entry.expiry}
        </div>

        <div className="mb-4">
          <div className="text-xs text-gray-500 mb-2">Exit Reason</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {Object.entries(EXIT_LABELS).map(([k, v]) => (
              <button
                key={k}
                onClick={() => setReason(k)}
                className={`px-3 py-2.5 rounded-lg text-xs font-semibold border transition-all min-h-[44px] sm:min-h-0 ${
                  reason === k
                    ? 'bg-violet-600 border-violet-500 text-white'
                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-violet-600 hover:text-violet-400'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4">
          <div className="text-xs text-gray-500 mb-1.5">Notes (optional)</div>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200
                       placeholder-gray-600 focus:outline-none focus:border-violet-600 resize-none"
            placeholder="e.g. closed for profit before expiry…"
          />
        </div>

        <div className="flex flex-col-reverse sm:flex-row gap-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-3 sm:py-2 bg-gray-800 text-gray-400 text-sm rounded-lg hover:bg-gray-700 transition-colors min-h-[44px] sm:min-h-0"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className="flex-1 px-4 py-3 sm:py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-60 min-h-[44px] sm:min-h-0"
          >
            {loading ? 'Closing…' : 'Close Trade'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Edit modal ──────────────────────────────────────────────────────────────

function EditModal({ entry, onClose, onSave }: {
  entry: JournalEntry
  onClose: () => void
  onSave: (fields: Record<string, unknown>) => Promise<void>
}) {
  const [form, setForm] = useState({
    strategy:         entry.strategy ?? '',
    bias:             entry.bias ?? '',
    underlying_entry: entry.underlying_entry > 0 ? String(entry.underlying_entry) : '',
    net_credit:       entry.net_credit !== 0 ? String(Math.abs(entry.net_credit)) : '',
    expiry:           entry.expiry ?? '',
    max_profit:       entry.max_profit > 0 ? String((entry.max_profit * 100).toFixed(2)) : '',
    max_loss:         entry.max_loss > 0 ? String((entry.max_loss * 100).toFixed(2)) : '',
    total_score:      entry.total_score > 0 ? String(entry.total_score) : '',
    notes:            entry.notes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const handleSave = async () => {
    setSaving(true)
    setErr(null)
    try {
      const fields: Record<string, unknown> = {}
      if (form.strategy.trim())         fields.strategy         = form.strategy.trim()
      if (form.bias.trim())             fields.bias             = form.bias.trim()
      if (form.expiry.trim())           fields.expiry           = form.expiry.trim()
      if (form.notes !== undefined)     fields.notes            = form.notes
      const ue = parseFloat(form.underlying_entry)
      if (!isNaN(ue) && ue > 0)        fields.underlying_entry = ue
      const nc = parseFloat(form.net_credit)
      if (!isNaN(nc) && nc > 0)        fields.net_credit       = nc / 100  // store as per-share fraction
      const mp = parseFloat(form.max_profit)
      if (!isNaN(mp))                   fields.max_profit       = mp / 100
      const ml = parseFloat(form.max_loss)
      if (!isNaN(ml))                   fields.max_loss         = ml / 100
      const sc = parseInt(form.total_score, 10)
      if (!isNaN(sc))                   fields.total_score      = sc
      await onSave(fields)
      onClose()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const inputCls = "w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 font-mono placeholder-gray-600 focus:outline-none focus:border-violet-600"
  const labelCls = "text-xs text-gray-500 mb-1 block"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[90dvh] overflow-y-auto overscroll-contain bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 rounded-2xl p-4 sm:p-5 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Pencil size={14} className="text-violet-400" />
            Edit Journal Entry
          </div>
          <button onClick={onClose} className="text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-300"><X size={16} /></button>
        </div>

        <div className="text-xs text-gray-400 mb-4 font-semibold">{entry.ticker} · {entry.trade_type?.toUpperCase() ?? 'TRADE'}</div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <div>
            <label className={labelCls}>Strategy</label>
            <input className={inputCls} value={form.strategy} onChange={set('strategy')} placeholder="Long Call, Vertical…" />
          </div>
          <div>
            <label className={labelCls}>Bias</label>
            <select className={inputCls} value={form.bias} onChange={set('bias')}>
              <option value="">— select —</option>
              <option value="Bullish">Bullish</option>
              <option value="Bearish">Bearish</option>
              <option value="Neutral">Neutral</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Underlying Entry Price ($)</label>
            <input className={inputCls} type="number" step="0.01" value={form.underlying_entry} onChange={set('underlying_entry')} placeholder="e.g. 512.50" />
          </div>
          <div>
            <label className={labelCls}>Premium Paid ($/contract)</label>
            <input className={inputCls} type="number" step="0.01" value={form.net_credit} onChange={set('net_credit')} placeholder="e.g. 3.50 per contract" />
          </div>
          <div>
            <label className={labelCls}>Expiry Date</label>
            <input className={inputCls} type="date" value={form.expiry} onChange={set('expiry')} />
          </div>
          <div>
            <label className={labelCls}>Score (0–100)</label>
            <input className={inputCls} type="number" min="0" max="100" value={form.total_score} onChange={set('total_score')} placeholder="e.g. 78" />
          </div>
          <div>
            <label className={labelCls}>Max Profit ($/contract)</label>
            <input className={inputCls} type="number" step="0.01" value={form.max_profit} onChange={set('max_profit')} placeholder="e.g. 350" />
          </div>
          <div>
            <label className={labelCls}>Max Loss ($/contract)</label>
            <input className={inputCls} type="number" step="0.01" value={form.max_loss} onChange={set('max_loss')} placeholder="e.g. 150" />
          </div>
        </div>

        <div className="mb-4">
          <label className={labelCls}>Notes</label>
          <textarea
            value={form.notes}
            onChange={set('notes')}
            rows={3}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-violet-600 resize-none"
            placeholder="Trade rationale, observations, lessons…"
          />
        </div>

        {err && <div className="mb-3 text-xs text-red-400 bg-red-900/20 border border-red-700 rounded-lg px-3 py-2">{err}</div>}

        <div className="flex flex-col-reverse sm:flex-row gap-2">
          <button onClick={onClose} className="flex-1 px-4 py-3 sm:py-2 bg-gray-800 text-gray-400 text-sm rounded-lg hover:bg-gray-700 transition-colors">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-4 py-3 sm:py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Entry card ──────────────────────────────────────────────────────────────

function EntryCard({
  entry,
  onClose,
  onDeleteConfirm,
  onNotesSave,
  onUpdate,
  userRole,
}: {
  entry: JournalEntry
  onClose: (id: string, reason: string, notes: string) => Promise<void>
  onDeleteConfirm: (id: string) => void
  onNotesSave: (id: string, notes: string) => Promise<void>
  onUpdate: (id: string, fields: Record<string, unknown>) => Promise<void>
  userRole?: string | null
}) {
  const [expanded, setExpanded] = useState(false)
  const [showClose, setShowClose] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesText, setNotesText] = useState(entry.notes || '')
  const [savingNotes, setSavingNotes] = useState(false)
  const [executingTrade, setExecutingTrade] = useState(false)
  const [executedTrade, setExecutedTrade] = useState(false)
  const [tradeError, setTradeError] = useState<string | null>(null)

  const isOpen    = entry.status === 'OPEN'
  const isClosed  = entry.status === 'CLOSED'
  const isExpired = entry.status === 'EXPIRED'

  const pnlValue  = isOpen ? entry.current_pnl : entry.realized_pnl
  const pnlColor  = pnlValue > 0 ? 'text-emerald-400' : pnlValue < 0 ? 'text-red-400' : 'text-gray-400'
  const pnlLabel  = isOpen ? 'MTM P&L' : 'Realized P&L'

  // pnl per contract (current_pnl from backend is already per-contract dollars)
  const pnlContract = pnlValue

  const handleSaveNotes = async () => {
    setSavingNotes(true)
    try {
      await onNotesSave(entry.id, notesText)
      setEditingNotes(false)
    } finally {
      setSavingNotes(false)
    }
  }

  const outcomeColor = entry.outcome ? OUTCOME_COLORS[entry.outcome] ?? 'text-gray-400' : ''

  const biasColor =
    (entry.bias || '').includes('Bullish') ? 'text-emerald-400' :
    (entry.bias || '').includes('Bearish') ? 'text-red-400' : 'text-amber-400'

  const handleExecuteTrade = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!userRole || executedTrade || executingTrade) return
    setExecutingTrade(true)
    setTradeError(null)
    try {
      await executeTrade({
        email: entry.email || '',
        ticker: entry.ticker,
        strategy: entry.strategy,
        legs: entry.legs as object[],
        contracts: 1,
      })
      setExecutedTrade(true)
      setTimeout(() => setExecutedTrade(false), 8000)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Trade execution failed'
      setTradeError(msg)
      setTimeout(() => setTradeError(null), 6000)
    } finally {
      setExecutingTrade(false)
    }
  }

  return (
    <>
      {showClose && (
        <CloseModal
          entry={entry}
          onClose={() => setShowClose(false)}
          onConfirm={async (reason, notes) => {
            await onClose(entry.id, reason, notes)
            setShowClose(false)
          }}
        />
      )}
      {showEdit && (
        <EditModal
          entry={entry}
          onClose={() => setShowEdit(false)}
          onSave={async (fields) => {
            await onUpdate(entry.id, fields)
          }}
        />
      )}

      <div className="rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900 overflow-hidden transition-colors hover:border-slate-300 dark:hover:border-white/[0.12]">
        {/* Header row — grid/flex aligned with Watchlist ticker rows */}
        <button
          type="button"
          onClick={() => setExpanded(o => !o)}
          className="w-full text-left touch-manipulation transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/30 active:bg-slate-100 dark:active:bg-slate-800/40"
        >
          <div className="grid grid-cols-2 gap-3 px-4 py-3 sm:flex sm:items-center sm:flex-wrap">
            <div className="min-w-0 sm:w-32 sm:shrink-0">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-slate-900 dark:text-white text-sm tracking-tight">{entry.ticker}</span>
                {entry.trade_type && (
                  <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border shrink-0 ${
                    entry.trade_type === 'day' ? 'border-violet-600/40 bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300' :
                    entry.trade_type === 'swing' ? 'border-sky-600/40 bg-sky-100 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300' :
                    'border-emerald-600/40 bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                  }`}>
                    {entry.trade_type}
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-500 dark:text-gray-500 truncate sm:max-w-[120px]">
                {entry.company_name || '—'}
              </div>
            </div>

            {/* Current price — color by P&L */}
            <div className="min-w-0 sm:w-20 sm:shrink-0 text-right sm:text-left">
              {(() => {
                const isClosed = entry.status === 'CLOSED' || entry.status === 'EXPIRED'
                const hasOptionEntry = entry.net_credit !== 0 && entry.legs.length > 0
                const entryOptPx = hasOptionEntry ? Math.abs(entry.net_credit) : 0
                const currentOptPx = hasOptionEntry ? entryOptPx + (entry.current_pnl / 100) : 0
                const ep = hasOptionEntry ? entryOptPx : entry.underlying_entry
                const cp = hasOptionEntry ? currentOptPx : entry.current_price
                const hasBoth = ep > 0 && cp > 0
                const realizedPnl = isClosed && entry.realized_pnl != null ? entry.realized_pnl : null
                const pnlColor = realizedPnl != null
                  ? (realizedPnl > 0 ? 'text-emerald-600 dark:text-emerald-400' : realizedPnl < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-gray-200')
                  : hasBoth && cp !== ep
                    ? (cp > ep ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')
                    : 'text-slate-800 dark:text-slate-200'
                return (
                  <>
                    <div className={`text-xs font-bold font-mono ${pnlColor}`}>
                      {entry.current_price > 0 ? `$${entry.current_price.toFixed(2)}` : '—'}
                    </div>
                    <div className="text-[9px] text-slate-400 dark:text-gray-600">
                      {isClosed && realizedPnl != null ? 'Closed' : 'Price'}
                    </div>
                  </>
                )
              })()}
            </div>

            {(() => {
              // For option trades (net_credit set), show option premium change; else show underlying Δ
              const hasOptPremium = entry.net_credit !== 0
              const entryOptPx = hasOptPremium ? Math.abs(entry.net_credit) * 100 : 0  // per-contract $
              const currentOptPx = hasOptPremium ? entryOptPx + entry.current_pnl : 0
              const ep = hasOptPremium ? entryOptPx : entry.underlying_entry
              const cp = hasOptPremium ? currentOptPx : entry.current_price
              const hasBoth = ep > 0 && cp > 0
              const diff = hasBoth ? cp - ep : 0
              const pct = hasBoth && ep > 0 ? (diff / ep) * 100 : 0
              const color = hasBoth ? (diff > 0 ? 'text-emerald-600 dark:text-emerald-400' : diff < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-gray-200') : 'text-slate-500 dark:text-gray-200'
              const colLabel = hasOptPremium ? 'Premium Δ' : 'Stock Δ'
              const displayVal = hasOptPremium
                ? (cp > 0 ? `$${cp.toFixed(2)}` : '—')
                : (cp > 0 ? `$${cp.toFixed(2)}` : '—')
              return (
                <div className="min-w-0 text-right sm:text-left sm:w-28 sm:shrink-0">
                  <div className={`text-sm font-semibold font-mono ${color}`}>
                    {displayVal}
                    {hasBoth && (
                      <span className="text-[10px] ml-1 font-normal">{pct >= 0 ? '+' : ''}{pct.toFixed(1)}%</span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-gray-500">
                    {ep > 0 ? `${colLabel} · entry $${ep.toFixed(2)}` : colLabel}
                  </div>
                </div>
              )
            })()}

            <div className="flex items-center sm:hidden">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_COLORS[entry.status] ?? 'bg-gray-800 text-gray-400 border-gray-700'}`}>
                {entry.status}
              </span>
            </div>

            <div className="text-right sm:hidden">
              <div className="text-xs text-gray-400">{entry.expiry}</div>
              <div className="text-xs text-gray-500">{dteLabel(entry.expiry)}</div>
            </div>

            <div className="w-20 shrink-0 hidden sm:block">
              <div className="text-sm font-semibold text-gray-300">{dteLabel(entry.expiry) || '—'}</div>
              <div className="text-xs text-gray-500">DTE</div>
            </div>

            <div className="w-24 shrink-0 hidden md:block">
              <div className={`text-xs font-semibold ${biasColor} truncate`}>{entry.bias}</div>
              <div className="text-xs text-gray-500">Bias</div>
            </div>

            <div className="flex-1 hidden lg:block min-w-0">
              <div className="text-xs">
                <span className="text-violet-300 font-semibold truncate block" title={entry.strategy}>{entry.strategy}</span>
                <span className="text-gray-500">
                  {(() => {
                    const optPx = entry.net_credit !== 0 && entry.legs.length > 0
                      ? Math.abs(entry.net_credit) + (entry.current_pnl / 100)
                      : 0
                    return optPx > 0 ? `$${optPx.toFixed(2)} · ` : ''
                  })()}
                  +${(entry.max_profit * 100).toFixed(0)} max · {(entry.prob_of_profit * 100).toFixed(0)}% PoP
                </span>
              </div>
            </div>

            <div className="w-28 shrink-0 hidden sm:flex flex-col items-end gap-0.5 justify-center">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_COLORS[entry.status] ?? 'bg-gray-800 text-gray-400 border-gray-700'}`}>
                {entry.status}
              </span>
              {(isClosed || isExpired) && entry.outcome && (
                <span className={`text-[10px] font-bold ${outcomeColor}`}>
                  {entry.outcome === 'WIN' ? '✓ WIN' : entry.outcome === 'LOSS' ? '✗ LOSS' : '≈ BE'}
                </span>
              )}
            </div>

            <div className="col-span-2 flex justify-end sm:justify-center sm:w-10 sm:shrink-0">
              <span className="p-1.5 text-gray-400 rounded-xl border border-transparent">
                {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </span>
            </div>
          </div>
        </button>

        {/* Expanded detail */}
        {expanded && (
          <div className="border-t border-slate-200 dark:border-gray-800 px-4 py-3 bg-slate-50 dark:bg-gray-800/30">
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-4 gap-3 text-xs">
              {[
                { label: 'Entry Date', value: fmtDate(entry.entry_date), note: '' },
                {
                  label: 'Net / contract',
                  value: `${entry.net_credit > 0 ? '+' : ''}$${(entry.net_credit * 100).toFixed(0)}`,
                  note: entry.net_credit > 0 ? 'Credit' : 'Debit',
                },
                {
                  label: 'Score',
                  value: `${entry.total_score}/100`,
                  note: entry.total_score >= 75 ? 'Strong' : entry.total_score >= 55 ? 'OK' : 'Weak',
                },
                { label: 'Max Profit', value: `+$${(entry.max_profit * 100).toFixed(0)}`, note: '' },
                { label: 'Max Loss', value: `−$${(entry.max_loss * 100).toFixed(0)}`, note: '' },
                { label: 'PoP', value: `${(entry.prob_of_profit * 100).toFixed(0)}%`, note: '' },
                {
                  label: 'EV',
                  value: `${entry.expected_value > 0 ? '+' : ''}$${(entry.expected_value * 100).toFixed(0)}`,
                  note: '',
                },
              ].map(m => (
                <div key={m.label} className="bg-gray-800 rounded-xl px-3 py-2">
                  <div className="text-gray-500 mb-0.5">{m.label}</div>
                  <div className="text-gray-200 font-semibold font-mono">{m.value}</div>
                  {m.note ? <div className="text-gray-600">{m.note}</div> : null}
                </div>
              ))}
            </div>

            {/* Price comparison: entry vs current (open) */}
            {isOpen && entry.current_price > 0 && (
              <div className="mt-3 p-2.5 bg-blue-950/30 border border-blue-800/50 rounded-xl text-[11px] sm:text-xs flex flex-wrap gap-x-3 gap-y-1">
                {(() => {
                  const hasOptPremium = entry.net_credit !== 0
                  const eOpt = hasOptPremium ? Math.abs(entry.net_credit) * 100 : 0  // per-contract $
                  const cOpt = hasOptPremium ? eOpt + entry.current_pnl : 0
                  return (
                    <>
                      {hasOptPremium ? (
                        <>
                          <span className="text-gray-500">
                            Premium Entry: <span className="font-mono text-gray-300">${eOpt.toFixed(2)}/contract</span>
                          </span>
                          <span className="text-gray-500">
                            Current: <span className="font-mono text-gray-300">${cOpt.toFixed(2)}/contract</span>
                          </span>
                          <span className="text-gray-500">
                            P&L: <PriceDiff current={cOpt} entry={eOpt} />
                          </span>
                          <span className="text-gray-500">
                            Stock: <span className="font-mono text-gray-300">${entry.current_price.toFixed(2)}</span>
                            {entry.underlying_entry > 0 && (
                              <> · entry <span className="font-mono">${entry.underlying_entry.toFixed(2)}</span></>
                            )}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="text-gray-500">
                            Stock Entry: <span className="font-mono text-gray-300">${entry.underlying_entry?.toFixed(2) ?? '—'}</span>
                          </span>
                          <span className="text-gray-500">
                            Current: <span className="font-mono text-gray-300">${entry.current_price.toFixed(2)}</span>
                          </span>
                          {entry.underlying_entry > 0 && (
                            <span className="text-gray-500">
                              Δ: <PriceDiff current={entry.current_price} entry={entry.underlying_entry} />
                            </span>
                          )}
                          <span className="text-xs text-gray-600 italic">Set Premium Paid via Edit to track option P&L</span>
                        </>
                      )}
                    </>
                  )
                })()}
              </div>
            )}

            {(isClosed || isExpired) && (
              <div className="mt-3 p-2.5 bg-gray-900 border border-gray-800 rounded-xl text-[11px] sm:text-xs flex flex-wrap gap-3">
                <span className="text-gray-500">
                  Closed: <span className="text-gray-300">{fmtDate(entry.exit_date)}</span>
                </span>
                {entry.underlying_exit > 0 && (
                  <span className="text-gray-500">
                    Exit: <span className="font-mono text-gray-300">${entry.underlying_exit.toFixed(2)}</span>
                  </span>
                )}
                {(entry.underlying_entry > 0 || Math.abs(entry.realized_pnl) > 0) && (
                  <span className="text-gray-500">
                    P&L: <span className={`font-mono font-bold ${pnlColor}`}>{fmt$(pnlContract)}</span>
                  </span>
                )}
              </div>
            )}

            {/* Summary chips — key info at a glance */}
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {entry.strategy && (
                <span className="bg-gray-800 rounded-lg px-2.5 py-1.5">
                  <span className="text-gray-500">Strategy: </span>
                  <span className="text-gray-200 font-semibold">{entry.strategy}</span>
                </span>
              )}
              {entry.bias && (
                <span className="bg-gray-800 rounded-lg px-2.5 py-1.5">
                  <span className="text-gray-500">Bias: </span>
                  <span className={`font-semibold ${biasColor}`}>{entry.bias}</span>
                </span>
              )}
              {entry.underlying_entry > 0 && (
                <span className="bg-gray-800 rounded-lg px-2.5 py-1.5 font-mono">
                  <span className="text-gray-500">Entry: </span>
                  <span className="text-gray-200">${entry.underlying_entry.toFixed(2)}</span>
                </span>
              )}
              {entry.net_credit !== 0 && (
                <span className="bg-gray-800 rounded-lg px-2.5 py-1.5 font-mono">
                  <span className="text-gray-500">Premium: </span>
                  <span className="text-gray-200">${(Math.abs(entry.net_credit) * 100).toFixed(2)}/contract</span>
                </span>
              )}
            </div>

            {/* Engine signal at creation */}
            {entry.engine_signal && (
              <div className="mt-2 px-3 text-[11px] text-gray-500">
                Signal at creation: <span className="font-semibold text-gray-300">{entry.engine_signal}</span>
                {entry.engine_state > 0 && <span className="ml-2 text-gray-600">· State {entry.engine_state}</span>}
              </div>
            )}

            {/* Legs table */}
            {entry.legs && entry.legs.length > 0 && (
              <div className="mt-3 bg-gray-800 rounded-xl p-2 sm:p-3 font-mono text-[10px] sm:text-xs overflow-x-auto touch-pan-x">
                <table className="w-full min-w-[20rem] sm:min-w-[30rem]">
                  <thead>
                    <tr className="text-gray-500 border-b border-gray-700">
                      <th className="text-left pb-1.5 pr-3">Action</th>
                      <th className="text-left pb-1.5 pr-3">Type</th>
                      <th className="text-right pb-1.5 pr-3">Strike</th>
                      <th className="text-right pb-1.5 pr-3">Delta</th>
                      <th className="text-right pb-1.5 pr-3">Mid</th>
                      <th className="text-right pb-1.5">IV</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entry.legs.map((leg: { action: string; option_type: string; strike: number; delta: number; mid_price: number; iv: number }, i: number) => (
                      <tr key={i} className="border-b border-gray-700/40 last:border-0">
                        <td className={`pr-3 py-1 font-bold ${leg.action === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>{leg.action}</td>
                        <td className="pr-3 py-1 text-white">{leg.option_type}</td>
                        <td className="pr-3 py-1 text-right text-white">${leg.strike.toFixed(1)}</td>
                        <td className="pr-3 py-1 text-right text-gray-400">{leg.delta?.toFixed(3) ?? '—'}</td>
                        <td className="pr-3 py-1 text-right text-gray-400">${leg.mid_price?.toFixed(2) ?? '—'}</td>
                        <td className="py-1 text-right text-gray-400">{leg.iv?.toFixed(1) ?? '—'}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Notes section */}
            <div className="mt-3">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xs text-gray-500 font-semibold">Notes</span>
                {!editingNotes && (
                  <button
                    onClick={() => setEditingNotes(true)}
                    className="text-gray-600 hover:text-violet-400 transition-colors"
                  >
                    <Edit3 size={11} />
                  </button>
                )}
              </div>
              {editingNotes ? (
                <div>
                  <textarea
                    value={notesText}
                    onChange={e => setNotesText(e.target.value)}
                    rows={2}
                    autoFocus
                    className="w-full bg-gray-800 border border-gray-700 focus:border-violet-600 rounded-lg px-3 py-2
                               text-sm text-gray-200 placeholder-gray-600 focus:outline-none resize-none"
                    placeholder="Trade notes, observations, lessons…"
                  />
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => { setEditingNotes(false); setNotesText(entry.notes || '') }}
                      className="px-3 py-1 bg-gray-800 text-gray-400 text-xs rounded-lg hover:bg-gray-700 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveNotes}
                      disabled={savingNotes}
                      aria-label={savingNotes ? 'Saving notes' : 'Save notes'}
                      title={savingNotes ? 'Saving…' : 'Save notes'}
                      className="inline-flex h-9 w-9 items-center justify-center bg-violet-600 hover:bg-violet-500 text-white rounded-lg transition-colors disabled:opacity-60"
                    >
                      {savingNotes ? <RefreshCw size={14} className="animate-spin" /> : <Check size={16} />}
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  className="text-xs text-gray-400 bg-gray-800/40 rounded-lg px-3 py-2 min-h-[2rem] cursor-text"
                  onClick={() => setEditingNotes(true)}
                >
                  {notesText || <span className="text-gray-600 italic">Add notes…</span>}
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="mt-3 flex gap-1.5 flex-wrap items-center">
              {isOpen && (
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); setShowClose(true) }}
                  title="Close trade"
                  aria-label="Close trade"
                  className="inline-flex h-10 w-10 items-center justify-center bg-violet-600/20 hover:bg-violet-600/40
                             border border-violet-700/50 text-violet-300 rounded-xl transition-colors touch-manipulation shrink-0"
                >
                  <CheckSquare size={16} />
                </button>
              )}
              <button
                type="button"
                onClick={e => { e.stopPropagation(); setShowEdit(true) }}
                title="Edit entry"
                aria-label="Edit journal entry"
                className="inline-flex h-10 items-center gap-1.5 px-3 bg-gray-800 hover:bg-gray-700 border border-gray-700
                           text-gray-400 hover:text-violet-300 hover:border-violet-700/50 rounded-xl transition-colors touch-manipulation shrink-0 text-xs font-semibold"
              >
                <Pencil size={13} /> Edit
              </button>
              {userRole === 'admin' && entry.legs.length > 0 && (
                <button
                  type="button"
                  onClick={handleExecuteTrade}
                  disabled={executingTrade}
                  title={executedTrade ? 'Trade executed' : 'Execute Alpaca paper trade'}
                  className={`inline-flex h-10 items-center gap-1.5 px-3 rounded-xl text-xs font-semibold border transition-colors shrink-0 ${
                    executedTrade
                      ? 'bg-emerald-900/30 border-emerald-700 text-emerald-300'
                      : 'bg-amber-900/30 border-amber-700 text-amber-300 hover:bg-amber-900/50'
                  }`}
                >
                  {executingTrade ? '…' : executedTrade ? '✓ Executed' : 'Paper Trade'}
                </button>
              )}
              {tradeError && (
                <span className="text-xs text-red-400 ml-1">{tradeError}</span>
              )}
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onDeleteConfirm(entry.id) }}
                title="Delete entry"
                aria-label="Delete journal entry"
                className="inline-flex h-10 w-10 items-center justify-center bg-gray-800 hover:bg-red-900/30 border border-gray-700
                           text-gray-500 hover:text-red-400 rounded-xl transition-colors touch-manipulation shrink-0"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

// ─── Main page ───────────────────────────────────────────────────────────────

type StatusFilter = 'ALL' | 'OPEN' | 'CLOSED' | 'EXPIRED'

export default function JournalPage() {
  const { user, syncJournalEntryCount } = useApp()
  const email = user?.email ?? ''

  const [entries, setEntries]         = useState<JournalEntry[]>([])
  const [loading, setLoading]         = useState(true)
  const [refreshing, setRefreshing]   = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [deleting, setDeleting]       = useState(false)

  const load = useCallback(async () => {
    if (!email) return
    setLoading(true)
    setError(null)
    try {
      const data = await getJournal(email)
      const list = (data.entries as JournalEntry[]) ?? []
      setEntries(list)
      syncJournalEntryCount(list.length)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load journal')
    } finally {
      setLoading(false)
    }
  }, [email, syncJournalEntryCount])

  useEffect(() => { load() }, [load])

  // Auto-refresh every 60s
  useEffect(() => {
    if (!email) return
    const id = setInterval(() => {
      refreshJournal(email).then(data => {
        const list = (data.entries as JournalEntry[]) ?? []
        setEntries(list)
        syncJournalEntryCount(list.length)
      }).catch(() => {})
    }, 60_000)
    return () => clearInterval(id)
  }, [email, syncJournalEntryCount])

  const handleRefresh = async () => {
    if (!email) return
    setRefreshing(true)
    setError(null)
    try {
      const data = await refreshJournal(email)
      const list = (data.entries as JournalEntry[]) ?? []
      setEntries(list)
      syncJournalEntryCount(list.length)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Refresh failed')
    } finally {
      setRefreshing(false)
    }
  }

  const handleClose = async (id: string, reason: string, notes: string) => {
    if (!email) return
    await closeJournalEntry(email, id, reason, notes)
    await load()
  }

  const handleDeleteConfirm = (id: string) => { setDeleteTarget(id); setDeleteError(null) }

  const [deleteError, setDeleteError] = useState<string | null>(null)

  const handleDeleteExecute = async () => {
    if (!deleteTarget || !email) return
    setDeleting(true)
    setDeleteError(null)
    const prevEntries = entries
    // Optimistic: remove immediately so UI feels instant
    const next = entries.filter(e => e.id !== deleteTarget)
    setEntries(next)
    syncJournalEntryCount(next.length)
    setDeleteTarget(null)
    try {
      await deleteJournalEntry(email, deleteTarget)
      // Confirm with backend re-fetch
      try {
        const data = await getJournal(email)
        const list = (data.entries as JournalEntry[]) ?? []
        setEntries(list)
        syncJournalEntryCount(list.length)
      } catch { /* re-fetch failed; optimistic state is still correct */ }
    } catch (e: unknown) {
      // Delete failed — restore previous list and show error in a toast-like banner
      setEntries(prevEntries)
      syncJournalEntryCount(prevEntries.length)
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? (e instanceof Error ? e.message : 'Delete failed')
      setError(msg)
    } finally {
      setDeleting(false)
    }
  }

  const handleNotesSave = async (id: string, notes: string) => {
    if (!email) return
    await updateJournalNotes(email, id, notes)
    setEntries(prev => prev.map(e => e.id === id ? { ...e, notes } : e))
  }

  const handleUpdate = async (id: string, fields: Record<string, unknown>) => {
    if (!email) return
    await updateJournalEntry(email, id, fields)
    setEntries(prev => prev.map(e => e.id === id ? { ...e, ...fields } as JournalEntry : e))
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const openList   = entries.filter(e => e.status === 'OPEN')
    const closedList = entries.filter(e => e.status === 'CLOSED' || e.status === 'EXPIRED')
    const winList    = closedList.filter(e => e.outcome === 'WIN')
    const totalPnl   = closedList.reduce((s, e) => s + (e.realized_pnl ?? 0), 0)
    const openMtm    = openList.reduce((s, e) => s + (e.current_pnl ?? 0), 0)
    const winRate    = closedList.length > 0 ? (winList.length / closedList.length) * 100 : 0
    return { openCount: openList.length, closedCount: closedList.length, winRate, totalPnl, openMtm }
  }, [entries])

  // ── Filtered entries ───────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    if (statusFilter === 'ALL') return entries
    return entries.filter(e => e.status === statusFilter)
  }, [entries, statusFilter])

  // sort: open first (by entry date desc), then closed/expired
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (a.status === 'OPEN' && b.status !== 'OPEN') return -1
      if (a.status !== 'OPEN' && b.status === 'OPEN') return 1
      return (b.created_at ?? 0) - (a.created_at ?? 0)
    })
  }, [filtered])

  const STATUS_TABS: { key: StatusFilter; label: string }[] = [
    { key: 'ALL',     label: `All (${entries.length})` },
    { key: 'OPEN',    label: `Open (${entries.filter(e => e.status === 'OPEN').length})` },
    { key: 'CLOSED',  label: `Closed (${entries.filter(e => e.status === 'CLOSED').length})` },
    { key: 'EXPIRED', label: `Expired (${entries.filter(e => e.status === 'EXPIRED').length})` },
  ]

  return (
    <div className="journal-page min-h-screen p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-5">
      {/* Delete confirm modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm max-h-[90dvh] overflow-y-auto overscroll-contain bg-gray-900 border border-gray-700 rounded-2xl p-4 sm:p-5 shadow-2xl">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle size={16} className="text-red-400" />
              <div className="font-bold text-white">Delete Entry?</div>
            </div>
            <p className="text-sm text-gray-400 mb-4">
              This will permanently remove this trade from your journal. This action cannot be undone.
            </p>
            {deleteError && (
              <div className="mb-3 rounded-lg border border-red-700 bg-red-900/20 px-3 py-2 text-xs text-red-400 flex items-center gap-2">
                <AlertTriangle size={12} className="shrink-0" />
                {deleteError}
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => { setDeleteTarget(null); setDeleteError(null) }}
                className="flex-1 px-4 py-3 sm:py-2 bg-gray-800 text-gray-400 text-sm rounded-lg hover:bg-gray-700 transition-colors min-h-[44px] sm:min-h-0"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteExecute}
                disabled={deleting}
                className="flex-1 px-4 py-3 sm:py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-60 min-h-[44px] sm:min-h-0"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Page header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="tcc-hero-title text-2xl font-bold tracking-tight text-heading flex items-center gap-2">
            <BookOpen className="text-violet-400" size={22} />
            Trade Journal
          </h1>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            <span className="text-sm text-gray-500">
              {entries.length} entr{entries.length !== 1 ? 'ies' : 'y'}
            </span>
            <span className="text-xs text-gray-600">Live P&L · filters · notes</span>
          </div>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing || loading}
          aria-label={refreshing ? 'Refreshing P&L' : 'Refresh journal P&L'}
          title="Refresh"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center bg-gray-800 border border-gray-700
                     text-gray-400 hover:text-gray-200 hover:border-gray-600 rounded-xl
                     transition-colors disabled:opacity-50"
        >
          <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-900/20 border border-red-800 rounded-xl text-sm text-red-400 flex items-center gap-2">
          <AlertTriangle size={14} className="shrink-0" />
          {error}
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Open Trades"
          value={String(stats.openCount)}
          sub={stats.openCount > 0 ? `MTM ${fmt$(stats.openMtm * 100)}` : 'No open trades'}
          color={stats.openCount > 0 ? 'text-blue-300' : 'text-gray-400'}
        />
        <StatCard
          label="Win Rate"
          value={stats.closedCount > 0 ? `${stats.winRate.toFixed(0)}%` : '—'}
          sub={`${stats.closedCount} closed trades`}
          color={stats.winRate >= 60 ? 'text-emerald-400' : stats.winRate >= 45 ? 'text-amber-400' : 'text-red-400'}
        />
        <StatCard
          label="Realized P&L"
          value={stats.closedCount > 0 ? fmt$(stats.totalPnl * 100) : '—'}
          sub="per contract basis"
          color={stats.totalPnl > 0 ? 'text-emerald-400' : stats.totalPnl < 0 ? 'text-red-400' : 'text-gray-400'}
        />
        <StatCard
          label="Total Entries"
          value={String(entries.length)}
          sub={`${stats.openCount} open · ${stats.closedCount} closed`}
        />
      </div>

      {/* Status filter tabs */}
      <div className="flex items-stretch gap-2 border-b border-gray-800 pb-3">
        <Filter size={14} className="text-gray-600 self-center shrink-0" />
        <div className="mobile-tab-scroll flex items-center gap-2 overflow-x-auto min-w-0 flex-1 pb-0.5">
        {STATUS_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setStatusFilter(tab.key)}
            className={`shrink-0 whitespace-nowrap px-3 py-2 rounded-lg text-xs font-semibold border transition-all min-h-[40px] sm:min-h-0 ${
              statusFilter === tab.key
                ? 'bg-violet-600/20 text-violet-300 border-violet-700'
                : 'bg-gray-800/60 text-gray-500 border-gray-700 hover:text-gray-300 hover:border-gray-600'
            }`}
          >
            {tab.label}
          </button>
        ))}
        </div>
      </div>

      {/* Entries list */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-600">
          <RefreshCw size={24} className="animate-spin mb-3" />
          <span className="text-sm">Loading journal…</span>
        </div>
      ) : sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <BookOpen size={32} className="text-gray-700 mb-3" />
          <div className="text-gray-500 font-semibold mb-1">
            {statusFilter === 'ALL' ? 'No journal entries yet' : `No ${statusFilter.toLowerCase()} trades`}
          </div>
          <div className="text-gray-600 text-sm max-w-sm">
            {statusFilter === 'ALL'
              ? 'Analyze a ticker, expand a recommendation, and click "Save to Journal" to start tracking your trades.'
              : `Switch to "All" to see all trades or analyze new tickers.`
            }
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map(entry => (
            <EntryCard
              key={entry.id}
              entry={entry}
              onClose={handleClose}
              onDeleteConfirm={handleDeleteConfirm}
              onNotesSave={handleNotesSave}
              onUpdate={handleUpdate}
              userRole={user?.role}
            />
          ))}
        </div>
      )}
    </div>
    </div>
  )
}
