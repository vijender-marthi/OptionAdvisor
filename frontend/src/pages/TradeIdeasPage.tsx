import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  TrendingUp, TrendingDown, X, Plus, ChevronDown, ChevronUp,
  Lightbulb, RefreshCw, Trash2, Eye, Zap,
} from 'lucide-react'
import { getTradeIdeas, createTradeIdea, updateTradeIdea, deleteTradeIdea } from '../api/client'
import type { TradeIdea, TradeIdeaStatus } from '../types'
import { useApp } from '../contexts/AppContext'

const IDEA_ENGINES  = [{ value: 'SWING', label: 'Swing Trade' }, { value: 'DAY', label: 'Day Trade' }]
const IDEA_DIRECTIONS = [{ value: 'LONG', label: 'Long (Bullish)' }, { value: 'SHORT', label: 'Short (Bearish)' }]
const IDEA_STRUCTURES = [
  { value: 'LONG_CALL',    label: 'Long Call' },
  { value: 'LONG_PUT',     label: 'Long Put' },
  { value: 'CALL_SPREAD',  label: 'Call Debit Spread' },
  { value: 'PUT_SPREAD',   label: 'Put Debit Spread' },
  { value: 'CSP',          label: 'Cash Secured Put' },
  { value: 'CC',           label: 'Covered Call' },
]
const IDEA_REASONS = [
  { value: 'BREAKOUT_SETUP',  label: 'Breakout setup forming' },
  { value: 'WAITING_ENTRY',   label: 'Waiting for better entry' },
  { value: 'PULLBACK_ENTRY',  label: 'Pullback to key level' },
  { value: 'VOLUME_CONFIRM',  label: 'Volume confirmation needed' },
  { value: 'EDUCATION',       label: 'Learning the setup' },
  { value: 'TREND_CONTINUE',  label: 'Trend continuation' },
  { value: 'EARNINGS_PLAY',   label: 'Earnings play' },
  { value: 'MARKET_ALIGNING', label: 'Market context aligning' },
]
const IDEA_STATUSES: { value: TradeIdeaStatus; label: string; cls: string }[] = [
  { value: 'WATCHING', label: 'Watching',  cls: 'border-amber-500/40 bg-amber-500/15 text-amber-300' },
  { value: 'READY',    label: 'Ready',     cls: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300' },
  { value: 'ENTERED',  label: 'Entered',   cls: 'border-sky-500/40 bg-sky-500/15 text-sky-300' },
  { value: 'PASSED',   label: 'Passed',    cls: 'border-gray-500/40 bg-gray-500/10 text-gray-400' },
  { value: 'EXPIRED',  label: 'Expired',   cls: 'border-red-500/40 bg-red-500/10 text-red-400' },
]

function ideaStatusCls(s: TradeIdeaStatus) {
  return IDEA_STATUSES.find(x => x.value === s)?.cls ?? 'border-gray-600 text-gray-400'
}
function ideaStatusLabel(s: TradeIdeaStatus) {
  return IDEA_STATUSES.find(x => x.value === s)?.label ?? s
}
function ideaReasonLabel(r: string) {
  return IDEA_REASONS.find(x => x.value === r)?.label ?? r
}
function ideaStructureLabel(s: string) {
  return IDEA_STRUCTURES.find(x => x.value === s)?.label ?? s
}

function AddIdeaModal({ onClose, onSave }: { onClose: () => void; onSave: (idea: Omit<TradeIdea, 'id' | 'created_at' | 'updated_at'>) => void }) {
  const { canAccessPage } = useApp()
  const visibleEngines = IDEA_ENGINES.filter(e =>
    e.value === 'SWING' ? canAccessPage('swing-trade') : e.value === 'DAY' ? canAccessPage('day-trade') : true
  )
  const [ticker,    setTicker]    = useState('')
  const [engine,    setEngine]    = useState<'DAY' | 'SWING'>((visibleEngines[0]?.value ?? 'SWING') as 'DAY' | 'SWING')
  const [direction, setDirection] = useState<'LONG' | 'SHORT'>('LONG')
  const [structure, setStructure] = useState(IDEA_STRUCTURES[0].value)
  const [reason,    setReason]    = useState(IDEA_REASONS[0].value)
  const [entryPx,   setEntryPx]   = useState('')
  const [targetPx,  setTargetPx]  = useState('')
  const [stopPx,    setStopPx]    = useState('')

  const valid = ticker.trim().length > 0

  const handleSave = () => {
    if (!valid) return
    onSave({
      ticker: ticker.trim().toUpperCase(),
      engine,
      direction,
      structure,
      reason,
      status: 'WATCHING',
      entry_price:  parseFloat(entryPx)  || 0,
      target_price: parseFloat(targetPx) || 0,
      stop_price:   parseFloat(stopPx)   || 0,
      engine_signal: '',
      engine_state:  1,
      notes: '',
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Lightbulb size={16} className="text-amber-400" />
            <span className="font-bold text-white text-sm">Add Trade Idea</span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors"><X size={16} /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-1.5">Ticker</label>
            <input
              value={ticker}
              onChange={e => setTicker(e.target.value.toUpperCase())}
              placeholder="e.g. AMD"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm font-mono font-bold text-white placeholder-gray-600 focus:outline-none focus:border-violet-500"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-1.5">Engine</label>
              <div className="flex rounded-lg border border-gray-700 overflow-hidden">
                {visibleEngines.map(e => (
                  <button key={e.value} onClick={() => setEngine(e.value as 'DAY' | 'SWING')}
                    className={`flex-1 py-2 text-xs font-semibold transition-colors ${engine === e.value ? 'bg-violet-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}>
                    {e.value === 'DAY' ? <Zap size={11} className="inline mr-1" /> : <TrendingUp size={11} className="inline mr-1" />}{e.value}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-1.5">Direction</label>
              <div className="flex rounded-lg border border-gray-700 overflow-hidden">
                {IDEA_DIRECTIONS.map(d => (
                  <button key={d.value} onClick={() => setDirection(d.value as 'LONG' | 'SHORT')}
                    className={`flex-1 py-2 text-xs font-semibold transition-colors ${direction === d.value ? (d.value === 'LONG' ? 'bg-emerald-600 text-white' : 'bg-red-700 text-white') : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}>
                    {d.value === 'LONG' ? <TrendingUp size={11} className="inline mr-1" /> : <TrendingDown size={11} className="inline mr-1" />}{d.value}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-1.5">Structure</label>
              <select value={structure} onChange={e => setStructure(e.target.value)}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-xs text-gray-200 focus:outline-none focus:border-violet-500">
                {IDEA_STRUCTURES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-1.5">Why Tracking</label>
              <select value={reason} onChange={e => setReason(e.target.value)}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-xs text-gray-200 focus:outline-none focus:border-violet-500">
                {IDEA_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-1.5">Price Levels <span className="font-normal normal-case text-gray-600">(optional)</span></label>
            <div className="grid grid-cols-3 gap-2">
              {[['Entry', entryPx, setEntryPx], ['Target', targetPx, setTargetPx], ['Stop', stopPx, setStopPx]].map(([label, val, set]) => (
                <div key={label as string}>
                  <div className="text-[9px] text-gray-600 mb-1 uppercase tracking-wide">{label as string}</div>
                  <input value={val as string} onChange={e => (set as (v: string) => void)(e.target.value)}
                    placeholder="0.00" type="number" step="0.01"
                    className="w-full rounded-lg border border-gray-700 bg-gray-800 px-2 py-2 text-xs font-mono text-gray-200 placeholder-gray-700 focus:outline-none focus:border-violet-500" />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="px-5 py-4 border-t border-gray-800 flex gap-3">
          <button onClick={onClose} className="flex-1 rounded-lg border border-gray-700 py-2.5 text-sm text-gray-400 hover:text-gray-200 transition-colors">Cancel</button>
          <button onClick={handleSave} disabled={!valid}
            className="flex-1 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 py-2.5 text-sm font-bold text-white transition-colors">
            Add Idea
          </button>
        </div>
      </div>
    </div>
  )
}

function IdeaCard({ idea, onStatusChange, onDelete }: {
  idea: TradeIdea
  onStatusChange: (id: string, status: TradeIdeaStatus) => void
  onDelete: (id: string) => void
}) {
  const [expanded,  setExpanded]  = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)

  const hasPrices = idea.entry_price > 0 || idea.target_price > 0 || idea.stop_price > 0

  return (
    <div className={`rounded-xl border transition-all duration-150 ${
      idea.status === 'WATCHING' ? 'border-amber-700/40 bg-amber-950/10'
      : idea.status === 'READY'   ? 'border-emerald-700/40 bg-emerald-950/10'
      : idea.status === 'ENTERED' ? 'border-sky-700/40 bg-sky-950/10'
      : 'border-gray-800/60 bg-gray-900/30'
    }`}>
      <div className="px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-mono font-bold text-white text-sm shrink-0">{idea.ticker}</span>

          <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold border shrink-0 ${
            idea.engine === 'DAY' ? 'border-violet-600/40 bg-violet-600/15 text-violet-300' : 'border-sky-600/40 bg-sky-600/15 text-sky-300'
          }`}>
            {idea.engine === 'DAY' ? <Zap size={9} /> : <TrendingUp size={9} />}{idea.engine}
          </span>
          <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold border shrink-0 ${
            idea.direction === 'LONG' ? 'border-emerald-600/40 bg-emerald-600/15 text-emerald-300' : 'border-red-600/40 bg-red-600/15 text-red-300'
          }`}>
            {idea.direction === 'LONG' ? <TrendingUp size={9} /> : <TrendingDown size={9} />}{idea.direction}
          </span>

          <span className="text-[11px] text-gray-500 truncate min-w-0 flex-1">{ideaStructureLabel(idea.structure)}</span>

          <div className="relative shrink-0">
            <button onClick={() => setStatusOpen(o => !o)}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${ideaStatusCls(idea.status)}`}>
              {ideaStatusLabel(idea.status)}<ChevronDown size={9} />
            </button>
            {statusOpen && (
              <div className="absolute right-0 top-full mt-1 z-20 w-36 rounded-xl border border-gray-700 bg-gray-900 shadow-xl py-1">
                {IDEA_STATUSES.map(s => (
                  <button key={s.value} onClick={() => { onStatusChange(idea.id, s.value); setStatusOpen(false) }}
                    className={`w-full text-left px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-gray-800 ${s.value === idea.status ? 'text-white' : 'text-gray-400'}`}>
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button onClick={() => setExpanded(o => !o)} className="text-gray-600 hover:text-gray-400 transition-colors shrink-0">
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>

        <div className="mt-1.5 flex items-center gap-2 text-[11px] text-gray-500">
          <Eye size={10} className="shrink-0" />
          {ideaReasonLabel(idea.reason)}
          <span className="text-gray-700">·</span>
          <span>{new Date(idea.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-800/60 px-4 py-3 space-y-3">
          {hasPrices && (
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Entry', val: idea.entry_price,  color: 'text-gray-200' },
                { label: 'Target', val: idea.target_price, color: 'text-emerald-400' },
                { label: 'Stop',   val: idea.stop_price,   color: 'text-red-400' },
              ].filter(p => p.val > 0).map(p => (
                <div key={p.label} className="rounded-lg border border-gray-800 bg-black/15 px-3 py-2">
                  <div className="text-[9px] uppercase tracking-widest text-gray-600">{p.label}</div>
                  <div className={`text-sm font-mono font-semibold ${p.color}`}>${p.val.toFixed(2)}</div>
                </div>
              ))}
            </div>
          )}
          {idea.engine_signal && (
            <div className="text-[11px] text-gray-500">
              Signal at creation: <span className="font-semibold text-gray-300">{idea.engine_signal}</span>
              {idea.engine_state > 0 && <span className="ml-2 text-gray-600">· State {idea.engine_state}</span>}
            </div>
          )}
          <div className="flex justify-end">
            <button onClick={() => onDelete(idea.id)}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-red-500 hover:text-red-300 hover:bg-red-900/20 transition-colors border border-transparent hover:border-red-800/40">
              <Trash2 size={12} />Remove idea
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function IdeasList() {
  const { user } = useApp()
  const email = user?.email ?? ''
  const [ideas,      setIdeas]      = useState<TradeIdea[]>([])
  const [loading,    setLoading]    = useState(true)
  const [showAdd,    setShowAdd]    = useState(false)
  const [statusFilter, setStatusFilter] = useState<TradeIdeaStatus | 'ALL'>('ALL')

  const load = useCallback(async () => {
    if (!email) return
    setLoading(true)
    try { setIdeas(await getTradeIdeas(email)) } catch { /* silent */ } finally { setLoading(false) }
  }, [email])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    if (statusFilter === 'ALL') return ideas
    return ideas.filter(i => i.status === statusFilter)
  }, [ideas, statusFilter])

  const active   = ideas.filter(i => i.status === 'WATCHING' || i.status === 'READY').length
  const entered  = ideas.filter(i => i.status === 'ENTERED').length

  const handleSave = async (idea: Omit<TradeIdea, 'id' | 'created_at' | 'updated_at'>) => {
    await createTradeIdea(email, idea)
    setShowAdd(false)
    load()
  }

  const handleStatusChange = async (id: string, status: TradeIdeaStatus) => {
    setIdeas(prev => prev.map(i => i.id === id ? { ...i, status } : i))
    await updateTradeIdea(email, id, { status })
  }

  const handleDelete = async (id: string) => {
    setIdeas(prev => prev.filter(i => i.id !== id))
    await deleteTradeIdea(email, id)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-4 text-sm">
          <span className="text-gray-400"><span className="font-bold text-white">{active}</span> active</span>
          <span className="text-gray-400"><span className="font-bold text-sky-300">{entered}</span> entered</span>
          <span className="text-gray-400"><span className="font-bold text-gray-300">{ideas.length}</span> total</span>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-500 px-4 py-2 text-sm font-bold text-white transition-colors">
          <Plus size={14} />Add Idea
        </button>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
        {([{ value: 'ALL', label: 'All' }, ...IDEA_STATUSES] as const).map(s => (
          <button key={s.value}
            onClick={() => setStatusFilter(s.value as TradeIdeaStatus | 'ALL')}
            className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
              statusFilter === s.value
                ? 'bg-violet-600/20 text-violet-300 border-violet-700'
                : 'bg-gray-800/60 text-gray-500 border-gray-700 hover:text-gray-300'
            }`}>
            {s.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12 text-gray-600"><RefreshCw size={18} className="animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Lightbulb size={32} className="text-gray-700 mb-3" />
          <p className="text-gray-500 font-medium text-sm">
            {statusFilter === 'ALL' ? 'No trade ideas yet' : `No ${ideaStatusLabel(statusFilter as TradeIdeaStatus).toLowerCase()} ideas`}
          </p>
          <p className="text-gray-600 text-xs mt-1">
            {statusFilter === 'ALL' ? 'Tap Add Idea to start tracking a setup' : 'Try a different filter'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(idea => (
            <IdeaCard key={idea.id} idea={idea} onStatusChange={handleStatusChange} onDelete={handleDelete} />
          ))}
        </div>
      )}

      {showAdd && <AddIdeaModal onClose={() => setShowAdd(false)} onSave={handleSave} />}
    </div>
  )
}

export default IdeasList
