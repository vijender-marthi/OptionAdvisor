import { useEffect, useState, KeyboardEvent } from 'react'
import { Search, TrendingUp } from 'lucide-react'
import type { StrategyMode } from '../types'

interface Props {
  onAnalyze: (ticker: string, weeksOut: number, spreadWidth: number | null, strategyMode: StrategyMode) => void
  loading: boolean
  initialTicker?: string
}

const POPULAR = ['AAPL', 'TSLA', 'SPY', 'QQQ', 'NVDA', 'AMZN', 'MSFT']

const WIDTH_OPTIONS: { label: string; value: number | null }[] = [
  { label: 'Auto', value: null },
  { label: '$5',   value: 5 },
  { label: '$10',  value: 10 },
]

const STRATEGY_MODES: { label: string; sub: string; value: StrategyMode }[] = [
  { label: 'All Strategies',  sub: 'Engine picks best fit',           value: 'all'               },
  { label: 'Long Options',    sub: 'Long calls, puts, spreads',       value: 'long_only'         },
  { label: 'Credit Spreads',  sub: 'Defined-risk spreads only',       value: 'credit_only'       },
  { label: 'Short / Covered', sub: 'Naked short & covered plays',     value: 'short_or_covered'  },
]

export default function TickerInput({ onAnalyze, loading, initialTicker = '' }: Props) {
  const [ticker,       setTicker]       = useState('')
  const [weeks,        setWeeks]        = useState(4)
  const [spreadWidth,  setSpreadWidth]  = useState<number | null>(5)
  const [strategyMode, setStrategyMode] = useState<StrategyMode>('all')

  useEffect(() => {
    setTicker(initialTicker)
  }, [initialTicker])

  const handle = () => {
    const t = ticker.trim().toUpperCase()
    if (t) onAnalyze(t, weeks, spreadWidth, strategyMode)
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handle()
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <div className="flex items-center gap-3 mb-4">
        <TrendingUp className="text-violet-400" size={22} />
        <h1 className="text-xl font-bold text-white">Options Trade Advisor</h1>
        <span className="ml-auto text-xs text-gray-500 bg-gray-800 px-2 py-1 rounded-full">
          Systematic Engine v2
        </span>
      </div>

      <div className="flex gap-3 flex-wrap">
        <input
          className="flex-1 min-w-48 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3
                     text-white placeholder-gray-500 focus:outline-none focus:border-violet-500
                     focus:ring-1 focus:ring-violet-500 font-mono text-lg uppercase"
          placeholder="AAPL, TSLA, SPY..."
          value={ticker}
          onChange={e => setTicker(e.target.value.toUpperCase())}
          onKeyDown={onKey}
        />
        <select
          className="bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white
                     focus:outline-none focus:border-violet-500"
          value={weeks}
          onChange={e => setWeeks(Number(e.target.value))}
        >
          {[2, 3, 4, 6, 8].map(w => (
            <option key={w} value={w}>{w} weeks out</option>
          ))}
        </select>
        <button
          onClick={handle}
          disabled={loading || !ticker.trim()}
          className="bg-violet-600 hover:bg-violet-500 disabled:bg-gray-700 disabled:cursor-not-allowed
                     text-white font-semibold px-6 py-3 rounded-xl flex items-center gap-2
                     transition-colors duration-150"
        >
          {loading ? (
            <>
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Analyzing...
            </>
          ) : (
            <><Search size={16} /> Analyze</>
          )}
        </button>
      </div>

      {/* Strategy mode selector */}
      <div className="flex items-start gap-3 mt-4 flex-wrap">
        <span className="text-xs text-gray-500 font-semibold mt-2 shrink-0">Strategy mode:</span>
        <div className="flex gap-2 flex-wrap">
          {STRATEGY_MODES.map(opt => (
            <button
              key={opt.value}
              onClick={() => setStrategyMode(opt.value)}
              className={`flex flex-col items-start px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                strategyMode === opt.value
                  ? 'bg-violet-600 border-violet-500 text-white'
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200'
              }`}
            >
              <span>{opt.label}</span>
              <span className={`text-[10px] font-normal mt-0.5 ${strategyMode === opt.value ? 'text-violet-200' : 'text-gray-600'}`}>
                {opt.sub}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Spread width selector */}
      <div className="flex items-center gap-3 mt-3">
        <span className="text-xs text-gray-500 font-semibold">Spread width:</span>
        <div className="flex gap-1">
          {WIDTH_OPTIONS.map(opt => (
            <button
              key={String(opt.value)}
              onClick={() => setSpreadWidth(opt.value)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-all ${
                spreadWidth === opt.value
                  ? 'bg-violet-600 border-violet-500 text-white'
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-600">
          {spreadWidth === null
            ? 'Engine picks width based on OTM distance'
            : spreadWidth === 5
            ? 'Lower risk per trade · best for liquid names'
            : 'Higher absolute credit · fewer commissions'}
        </span>
      </div>

      {/* Quick picks */}
      <div className="flex gap-2 mt-3 flex-wrap">
        <span className="text-xs text-gray-500 self-center">Quick:</span>
        {POPULAR.map(t => (
          <button
            key={t}
            onClick={() => { setTicker(t); onAnalyze(t, weeks, spreadWidth, strategyMode) }}
            className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300
                       rounded-lg transition-colors font-mono"
          >
            {t}
          </button>
        ))}
      </div>
    </div>
  )
}
