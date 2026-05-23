import { useState } from 'react'
import { ArrowRight, Bell, BookOpen, X } from 'lucide-react'
import type { DeskWatchlistItem } from '../../api/client'

const VERDICT_BADGE: Record<string, string> = {
  'STRONG GO': 'bg-emerald-900/60 text-emerald-300 border-emerald-700/40',
  'GO':        'bg-emerald-900/40 text-emerald-400 border-emerald-800/40',
  'WATCH':     'bg-amber-900/50 text-amber-300 border-amber-700/40',
  'WAIT':      'bg-slate-700/50 text-slate-400 border-slate-600/40',
  'NO-GO':     'bg-rose-900/50 text-rose-300 border-rose-700/40',
}

const QUICK_TICKERS = ['AAPL', 'NVDA', 'SPY', 'QQQ', 'TSLA', 'MSFT']

interface Props {
  watchlist: DeskWatchlistItem[]
  selectedTicker: string
  tradeType: string
  onLoadTicker: (ticker: string) => void
  onRemove: (ticker: string) => void
  openTradeSet: Set<string>
  alertTickerSet: Set<string>
  verdicts: Record<string, string>
}

export default function LeftPanel({
  watchlist,
  selectedTicker,
  tradeType,
  onLoadTicker,
  onRemove,
  openTradeSet,
  alertTickerSet,
  verdicts,
}: Props) {
  const [tickerInput, setTickerInput] = useState('')
  const [hovered, setHovered] = useState<string | null>(null)

  const handleSubmit = () => {
    const t = tickerInput.trim().toUpperCase()
    if (t) {
      onLoadTicker(t)
      setTickerInput('')
    }
  }

  return (
    <div className="flex flex-col h-full border-r border-white/[0.07] bg-slate-950">
      {/* Ticker input */}
      <div className="p-3 border-b border-white/[0.07]">
        <label className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 mb-1.5 block">
          Ticker
        </label>
        <div className="flex gap-1.5">
          <input
            className="flex-1 min-w-0 rounded-lg border border-white/[0.08] bg-slate-800/60 px-3 py-2 font-mono text-sm uppercase text-white outline-none placeholder:text-gray-600 focus:border-violet-500"
            placeholder="SPY…"
            value={tickerInput}
            onChange={e => setTickerInput(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={handleSubmit}
            className="shrink-0 rounded-lg bg-violet-600 hover:bg-violet-500 text-white px-2.5 py-2 transition-colors"
            aria-label="Load ticker"
          >
            <ArrowRight size={15} />
          </button>
        </div>

        {/* Quick chips */}
        <div className="flex flex-wrap gap-1.5 mt-2">
          {QUICK_TICKERS.map(t => (
            <button
              key={t}
              type="button"
              onClick={() => onLoadTicker(t)}
              className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-slate-800 hover:bg-slate-700 text-gray-400 hover:text-gray-200 transition-colors border border-white/[0.05]"
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Watchlist */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-3 pt-3 pb-1.5 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">
            Watchlist
          </span>
          <span className="text-[10px] text-gray-600">{watchlist.length}/10</span>
        </div>

        {watchlist.length === 0 ? (
          <p className="px-3 py-4 text-xs text-gray-600 text-center">Add tickers above</p>
        ) : (
          <ul>
            {watchlist.map(item => {
              const key = `${item.ticker}:${item.trade_type}`
              const isSelected = item.ticker === selectedTicker && item.trade_type === tradeType
              const verdict = verdicts[key] || ''
              const badgeCls = VERDICT_BADGE[verdict] || ''
              const hasOpen = openTradeSet.has(item.ticker)
              const hasAlert = alertTickerSet.has(item.ticker)

              return (
                <li
                  key={key}
                  className={`relative flex items-center gap-2 px-3 py-2.5 cursor-pointer transition-colors group ${
                    isSelected
                      ? 'bg-violet-900/20 border-l-2 border-violet-500'
                      : 'hover:bg-white/[0.03] border-l-2 border-transparent'
                  }`}
                  onClick={() => onLoadTicker(item.ticker)}
                  onMouseEnter={() => setHovered(key)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <span className="font-mono font-bold text-sm text-white min-w-[48px]">
                    {item.ticker}
                  </span>
                  <div className="flex items-center gap-1 flex-1 min-w-0">
                    {verdict && (
                      <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border ${badgeCls}`}>
                        {verdict === 'STRONG GO' ? 'SGO' : verdict.slice(0, 3)}
                      </span>
                    )}
                    {hasOpen && <BookOpen size={11} className="text-amber-400 shrink-0" />}
                    {hasAlert && <Bell size={11} className="text-sky-400 shrink-0" />}
                  </div>
                  {hovered === key && (
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); onRemove(item.ticker) }}
                      className="absolute right-2 text-gray-500 hover:text-rose-400 transition-colors"
                      aria-label="Remove"
                    >
                      <X size={13} />
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
