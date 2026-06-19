import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, X, RefreshCw, Radio, TrendingUp, ExternalLink, Search } from 'lucide-react'
import { fetchTrackMode, addTrackModeTicker, removeTrackModeTicker, type TrackModeItem } from '../api/commandCenter'
import { ROUTES } from '../routing/routes'

export default function TrackModePage() {
  const navigate = useNavigate()
  const [tracked, setTracked] = useState<TrackModeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [newTicker, setNewTicker] = useState('')
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchTrackMode()
      setTracked(res.tracked ?? [])
    } catch {
      setTracked([])
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleAdd = async () => {
    const t = newTicker.trim().toUpperCase()
    if (!t) return
    setAdding(true)
    try {
      await addTrackModeTicker(t)
      setNewTicker('')
      await load()
    } catch { /* ignore */ }
    setAdding(false)
  }

  const handleRemove = async (ticker: string) => {
    await removeTrackModeTicker(ticker)
    await load()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleAdd()
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-violet-600/20 flex items-center justify-center">
            <Radio size={18} className="text-violet-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-100">Track Mode</h1>
            <p className="text-[11px] text-gray-500">Post-exit re-entry monitoring</p>
          </div>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-[11px] font-medium text-gray-300 hover:bg-gray-700 transition-colors"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Add ticker */}
      <div className="rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900 p-4 mb-5">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              value={newTicker}
              onChange={e => setNewTicker(e.target.value.toUpperCase())}
              onKeyDown={handleKeyDown}
              placeholder="Add ticker to track..."
              className="w-full rounded-lg border border-gray-700 bg-gray-800 pl-9 pr-3 py-2 text-sm text-gray-100 placeholder:text-gray-600 focus:outline-none focus:border-violet-500 transition-colors"
              maxLength={10}
            />
          </div>
          <button
            type="button"
            onClick={handleAdd}
            disabled={!newTicker.trim() || adding}
            className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Plus size={15} />
            Track
          </button>
        </div>
      </div>

      {/* Tracked list */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <RefreshCw size={20} className="animate-spin text-gray-500" />
        </div>
      ) : tracked.length === 0 ? (
        <div className="rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900 p-8 text-center">
          <Radio size={32} className="mx-auto mb-3 text-gray-600" />
          <p className="text-sm text-gray-500 mb-1">No tickers being tracked</p>
          <p className="text-[11px] text-gray-600">Add tickers above to monitor for re-entry opportunities after exiting a position.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {tracked.map(item => (
            <div
              key={item.ticker}
              className="rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900 px-4 py-3 flex items-center justify-between hover:bg-slate-800/40 transition-colors group"
            >
              <div className="flex items-center gap-4 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-violet-600/10 flex items-center justify-center shrink-0">
                  <TrendingUp size={15} className="text-violet-400" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-100 font-mono">{item.ticker}</span>
                    {item.current_price != null && (
                      <span className="text-sm font-mono text-gray-400 tabular-nums">
                        ${item.current_price.toFixed(2)}
                      </span>
                    )}
                  </div>
                  {item.notes && (
                    <p className="text-[11px] text-gray-500 truncate max-w-[300px]">{item.notes}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => navigate(`${ROUTES.dayTrade}?ticker=${item.ticker}`)}
                  className="inline-flex items-center gap-1 rounded-md border border-gray-700 bg-gray-800/60 px-2.5 py-1 text-[10px] font-medium text-sky-300 hover:text-sky-200 hover:bg-gray-700/60 transition-colors"
                  title="Day Trade analysis"
                >
                  Day
                  <ExternalLink size={10} />
                </button>
                <button
                  type="button"
                  onClick={() => navigate(`${ROUTES.swingTrade}?ticker=${item.ticker}`)}
                  className="inline-flex items-center gap-1 rounded-md border border-gray-700 bg-gray-800/60 px-2.5 py-1 text-[10px] font-medium text-blue-300 hover:text-blue-200 hover:bg-gray-700/60 transition-colors"
                  title="Swing Trade analysis"
                >
                  Swing
                  <ExternalLink size={10} />
                </button>
                <button
                  type="button"
                  onClick={() => handleRemove(item.ticker)}
                  className="inline-flex items-center gap-1 rounded-md border border-gray-700 bg-gray-800/60 px-2.5 py-1 text-[10px] font-medium text-red-400 hover:text-red-300 hover:bg-gray-700/60 transition-colors opacity-0 group-hover:opacity-100"
                  title="Stop tracking"
                >
                  <X size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Info */}
      <div className="mt-6 rounded-xl border border-amber-800/30 bg-amber-950/15 px-4 py-3">
        <p className="text-[11px] text-amber-300/80 leading-relaxed">
          <strong className="text-amber-200">Track Mode</strong> monitors tickers you've exited for potential re-entry opportunities.
          Click the Day or Swing button to open the engine and check current conditions. Tickers are persistent across sessions.
        </p>
      </div>
    </div>
  )
}
