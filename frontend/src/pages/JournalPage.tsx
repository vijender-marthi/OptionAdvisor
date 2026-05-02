import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  BookOpen, RefreshCw, Trash2, CheckSquare, ChevronDown, ChevronUp,
  TrendingUp, TrendingDown, MinusCircle, Clock, Activity, X, Edit3, Check,
  AlertTriangle, DollarSign, BarChart3, Filter,
} from 'lucide-react'
import { getJournal, refreshJournal, closeJournalEntry, updateJournalNotes, deleteJournalEntry } from '../api/client'
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
  OPEN:    'bg-blue-900/40 text-blue-300 border-blue-700',
  CLOSED:  'bg-gray-800 text-gray-400 border-gray-700',
  EXPIRED: 'bg-amber-900/30 text-amber-400 border-amber-700',
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

// ─── Stat card ───────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color = 'text-white' }: {
  label: string; value: string; sub?: string; color?: string
}) {
  return (
    <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-2.5 sm:p-3 min-h-[4.25rem] sm:min-h-0">
      <div className="text-[10px] sm:text-xs text-gray-500 mb-1 line-clamp-2 sm:line-clamp-none">{label}</div>
      <div className={`text-base sm:text-lg font-bold font-mono ${color} break-words`}>{value}</div>
      {sub && <div className="text-[10px] sm:text-xs text-gray-500 mt-0.5 line-clamp-2 sm:line-clamp-none">{sub}</div>}
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
        className="w-full max-w-md max-h-[90dvh] overflow-y-auto overscroll-contain bg-gray-900 border border-gray-700 rounded-2xl p-4 sm:p-5 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="font-bold text-white">Close Trade</div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
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

// ─── Entry card ──────────────────────────────────────────────────────────────

function EntryCard({
  entry,
  onClose,
  onDeleteConfirm,
  onNotesSave,
}: {
  entry: JournalEntry
  onClose: (id: string, reason: string, notes: string) => Promise<void>
  onDeleteConfirm: (id: string) => void
  onNotesSave: (id: string, notes: string) => Promise<void>
}) {
  const [expanded, setExpanded] = useState(false)
  const [showClose, setShowClose] = useState(false)
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesText, setNotesText] = useState(entry.notes || '')
  const [savingNotes, setSavingNotes] = useState(false)

  const isOpen    = entry.status === 'OPEN'
  const isClosed  = entry.status === 'CLOSED'
  const isExpired = entry.status === 'EXPIRED'

  const pnlValue  = isOpen ? entry.current_pnl : entry.realized_pnl
  const pnlColor  = pnlValue > 0 ? 'text-emerald-400' : pnlValue < 0 ? 'text-red-400' : 'text-gray-400'
  const pnlLabel  = isOpen ? 'MTM P&L' : 'Realized P&L'

  // pnl per contract
  const pnlContract = pnlValue * 100

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

      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        {/* Header row */}
        <button
          onClick={() => setExpanded(o => !o)}
          className="w-full flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 text-left hover:bg-gray-800/30 active:bg-gray-800/40 transition-colors flex-wrap touch-manipulation"
        >
          {/* Ticker + company */}
          <div className="shrink-0">
            <span className="font-bold text-white text-sm">{entry.ticker}</span>
            <span className="text-gray-500 text-xs ml-1.5 hidden sm:inline">{entry.company_name}</span>
          </div>

          {/* Strategy */}
          <span className="text-xs text-gray-300 bg-gray-800 border border-gray-700 px-2 py-0.5 rounded-full shrink-0 max-w-[9.5rem] sm:max-w-[13rem] truncate" title={entry.strategy}>
            {entry.strategy}
          </span>

          {/* Bias */}
          <span className={`text-[10px] sm:text-xs px-2 py-0.5 rounded-full border font-semibold shrink-0 max-w-[9rem] sm:max-w-none truncate sm:whitespace-normal ${
            entry.bias.includes('Bullish') ? 'bg-green-900/50 text-green-400 border-green-700' :
            entry.bias.includes('Bearish') ? 'bg-red-900/50 text-red-400 border-red-700' :
            'bg-amber-900/50 text-amber-400 border-amber-700'
          }`}>
            {entry.bias.includes('Bullish') ? '↑' : entry.bias.includes('Bearish') ? '↓' : '↔'} {entry.bias}
          </span>

          {/* Status */}
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${STATUS_COLORS[entry.status] ?? 'bg-gray-800 text-gray-400 border-gray-700'}`}>
            {entry.status}
          </span>

          {/* Expiry / DTE */}
          <span className="text-[10px] sm:text-xs text-gray-500 shrink-0 whitespace-nowrap">{entry.expiry} · {dteLabel(entry.expiry)}</span>

          {/* Spacer */}
          <span className="hidden sm:block flex-1" />

          {/* P&L */}
          <span className={`font-bold text-sm font-mono shrink-0 ${pnlColor}`}>
            {fmt$(pnlContract)}
            <span className="text-xs font-normal text-gray-500 ml-1">/{pnlLabel}</span>
          </span>

          {/* Outcome for closed */}
          {(isClosed || isExpired) && entry.outcome && (
            <span className={`text-xs font-bold shrink-0 ml-1 ${outcomeColor}`}>
              {entry.outcome === 'WIN' ? '✓ WIN' : entry.outcome === 'LOSS' ? '✗ LOSS' : '≈ BE'}
            </span>
          )}

          <span className="text-gray-500 shrink-0 ml-1">
            {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </span>
        </button>

        {/* Expanded detail */}
        {expanded && (
          <div className="border-t border-gray-800">
            {/* Metrics grid */}
            <div className="px-3 sm:px-4 pt-3 pb-2 grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-3">
              <div>
                <div className="text-xs text-gray-500">Entry Date</div>
                <div className="text-sm font-semibold text-gray-200">{fmtDate(entry.entry_date)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Entry Price</div>
                <div className="text-sm font-mono text-gray-200">${entry.underlying_entry?.toFixed(2) ?? '—'}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Net Credit/Debit</div>
                <div className={`text-sm font-mono font-bold ${entry.net_credit > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {entry.net_credit > 0 ? '+' : ''}${(entry.net_credit * 100).toFixed(0)}/contract
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Score</div>
                <div className={`text-sm font-mono font-bold ${
                  entry.total_score >= 75 ? 'text-green-400' : entry.total_score >= 55 ? 'text-amber-400' : 'text-red-400'
                }`}>
                  {entry.total_score}/100
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Max Profit</div>
                <div className="text-sm font-mono text-emerald-400">+${(entry.max_profit * 100).toFixed(0)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Max Loss</div>
                <div className="text-sm font-mono text-red-400">−${(entry.max_loss * 100).toFixed(0)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">PoP</div>
                <div className="text-sm font-mono text-gray-200">{(entry.prob_of_profit * 100).toFixed(0)}%</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">EV</div>
                <div className={`text-sm font-mono ${entry.expected_value > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {entry.expected_value > 0 ? '+' : ''}${(entry.expected_value * 100).toFixed(0)}
                </div>
              </div>
            </div>

            {/* Current / exit price info */}
            {isOpen && entry.current_price > 0 && (
              <div className="mx-3 sm:mx-4 mb-3 p-2.5 bg-blue-950/30 border border-blue-800/50 rounded-xl text-[11px] sm:text-xs">
                <span className="text-blue-400 font-semibold">Live · </span>
                <span className="text-gray-300">
                  {entry.ticker} @ <span className="font-mono">${entry.current_price.toFixed(2)}</span>
                  &nbsp;·&nbsp;MTM P&L: <span className={`font-mono font-bold ${pnlColor}`}>{fmt$(pnlContract)}</span> per contract
                </span>
              </div>
            )}

            {(isClosed || isExpired) && (
              <div className="mx-3 sm:mx-4 mb-3 p-2.5 bg-gray-800/60 border border-gray-700 rounded-xl text-[11px] sm:text-xs flex flex-wrap gap-3">
                <span className="text-gray-500">
                  Closed: <span className="text-gray-300">{fmtDate(entry.exit_date)}</span>
                </span>
                {entry.underlying_exit > 0 && (
                  <span className="text-gray-500">
                    Exit price: <span className="font-mono text-gray-300">${entry.underlying_exit.toFixed(2)}</span>
                  </span>
                )}
                <span className="text-gray-500">
                  Reason: <span className="text-gray-300">{EXIT_LABELS[entry.exit_reason] ?? entry.exit_reason}</span>
                </span>
                <span className="text-gray-500">
                  P&L: <span className={`font-mono font-bold ${pnlColor}`}>{fmt$(pnlContract)}</span>
                </span>
              </div>
            )}

            {/* Legs table */}
            {entry.legs && entry.legs.length > 0 && (
              <div className="mx-3 sm:mx-4 mb-3 bg-gray-800/60 rounded-xl p-2 sm:p-3 font-mono text-[10px] sm:text-xs overflow-x-auto touch-pan-x">
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
            <div className="mx-3 sm:mx-4 mb-3">
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
                      onClick={handleSaveNotes}
                      disabled={savingNotes}
                      className="px-3 py-1 bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-60"
                    >
                      {savingNotes ? 'Saving…' : <><Check size={11} className="inline mr-1" />Save</>}
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
            <div className="px-3 sm:px-4 pb-4 flex gap-2 flex-wrap">
              {isOpen && (
                <button
                  onClick={() => setShowClose(true)}
                  className="flex items-center justify-center gap-1.5 px-3 py-2.5 sm:py-1.5 rounded-xl text-xs font-semibold border transition-all min-h-[44px] sm:min-h-0 touch-manipulation
                             bg-gray-800 border-gray-700 text-gray-400 hover:border-emerald-600 hover:text-emerald-400"
                >
                  <CheckSquare size={12} /> Close Trade
                </button>
              )}
              <button
                onClick={() => onDeleteConfirm(entry.id)}
                className="flex items-center justify-center gap-1.5 px-3 py-2.5 sm:py-1.5 rounded-xl text-xs font-semibold border transition-all min-h-[44px] sm:min-h-0 touch-manipulation
                           bg-gray-800 border-gray-700 text-gray-400 hover:border-red-600 hover:text-red-400"
              >
                <Trash2 size={12} /> Delete
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
  const { user } = useApp()
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
      setEntries((data.entries as JournalEntry[]) ?? [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load journal')
    } finally {
      setLoading(false)
    }
  }, [email])

  useEffect(() => { load() }, [load])

  const handleRefresh = async () => {
    if (!email) return
    setRefreshing(true)
    setError(null)
    try {
      const data = await refreshJournal(email)
      setEntries((data.entries as JournalEntry[]) ?? [])
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

  const handleDeleteConfirm = (id: string) => setDeleteTarget(id)

  const handleDeleteExecute = async () => {
    if (!deleteTarget || !email) return
    setDeleting(true)
    try {
      await deleteJournalEntry(email, deleteTarget)
      setEntries(prev => prev.filter(e => e.id !== deleteTarget))
      setDeleteTarget(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  const handleNotesSave = async (id: string, notes: string) => {
    if (!email) return
    await updateJournalNotes(email, id, notes)
    setEntries(prev => prev.map(e => e.id === id ? { ...e, notes } : e))
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
    <div className="journal-page min-h-screen">
      <div className="max-w-5xl mx-auto px-3 sm:px-6 py-4 sm:py-6 pb-12 sm:pb-10">
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
            <div className="flex gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5 sm:mb-6">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-violet-600/20 border border-violet-700/50 flex items-center justify-center shrink-0">
            <BookOpen size={18} className="text-violet-400" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-bold text-white leading-tight">Trade Journal</h1>
            <p className="text-[11px] sm:text-xs text-gray-500 mt-0.5">Track your real trades with live P&L monitoring</p>
          </div>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing || loading}
          className="flex items-center justify-center gap-2 px-4 py-3 sm:py-2 rounded-xl text-sm font-semibold border transition-all
                     bg-gray-800 border-gray-700 text-gray-300 hover:border-violet-600 hover:text-violet-300
                     disabled:opacity-50 w-full sm:w-auto shrink-0 min-h-[44px] sm:min-h-0"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Refreshing P&L…' : 'Refresh P&L'}
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-900/20 border border-red-800 rounded-xl text-sm text-red-400 flex items-center gap-2">
          <AlertTriangle size={14} className="shrink-0" />
          {error}
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-5 sm:mb-6">
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
      <div className="flex items-stretch gap-2 mb-4 border-b border-gray-800 pb-3 -mx-1 px-1">
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
        <div className="space-y-3">
          {sorted.map(entry => (
            <EntryCard
              key={entry.id}
              entry={entry}
              onClose={handleClose}
              onDeleteConfirm={handleDeleteConfirm}
              onNotesSave={handleNotesSave}
            />
          ))}
        </div>
      )}
    </div>
    </div>
  )
}
