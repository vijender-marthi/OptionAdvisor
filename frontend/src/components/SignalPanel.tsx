import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { Signals } from '../types'

interface Props { signals: Signals }

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-gray-800 last:border-0">
      <span className="text-gray-400 text-sm">{label}</span>
      <span className={`font-mono text-sm font-medium ${color || 'text-white'}`}>{value}</span>
    </div>
  )
}

function RsiGauge({ rsi }: { rsi: number }) {
  const pct = rsi
  const color = rsi >= 70 ? '#ef4444' : rsi <= 30 ? '#22c55e' : '#94a3b8'
  return (
    <div className="mt-2">
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        <span>Oversold (30)</span><span>Neutral</span><span>Overbought (70)</span>
      </div>
      <div className="relative h-3 bg-gray-700 rounded-full overflow-hidden">
        <div className="absolute left-0 top-0 h-full w-[30%] bg-green-900/60 rounded-l-full" />
        <div className="absolute right-0 top-0 h-full w-[30%] bg-red-900/60 rounded-r-full" />
        <div
          className="absolute top-0 w-3 h-3 rounded-full border border-border/60 shadow-sm"
          style={{ left: `calc(${pct}% - 6px)`, backgroundColor: color }}
        />
      </div>
      <div className="text-center mt-1 text-xs font-mono" style={{ color }}>RSI: {rsi}</div>
    </div>
  )
}

function IvBar({ rank }: { rank: number }) {
  const color = rank >= 65 ? '#ef4444' : rank >= 50 ? '#f59e0b' : rank < 35 ? '#22c55e' : '#94a3b8'
  return (
    <div className="mt-2">
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        <span>0%</span><span>IV Rank</span><span>100%</span>
      </div>
      <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${rank}%`, backgroundColor: color }} />
      </div>
      <div className="text-center mt-1 text-xs font-mono" style={{ color }}>{rank.toFixed(0)}%</div>
    </div>
  )
}

export default function SignalPanel({ signals }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-800 transition-colors"
      >
        <span className="font-semibold text-violet-400">📡 Full Signal Breakdown</span>
        {open ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
      </button>

      {open && (
        <div className="p-4 pt-0 grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* Trend */}
          <div className="bg-gray-800/50 rounded-xl p-4">
            <div className="text-sm font-semibold text-white mb-3">📈 Trend Signals</div>
            <Row label="Trend" value={signals.trend} color={signals.trend.includes('Bullish') ? 'text-green-400' : signals.trend.includes('Bearish') ? 'text-red-400' : 'text-amber-400'} />
            <Row label="Strength" value={signals.trend_strength} />
            <Row label="MA20" value={`$${signals.ma20.toFixed(2)}`} color={signals.above_ma20 ? 'text-green-400' : 'text-red-400'} />
            <Row label="MA50" value={`$${signals.ma50.toFixed(2)}`} color={signals.above_ma50 ? 'text-green-400' : 'text-red-400'} />
            <Row label="MA200" value={`$${signals.ma200.toFixed(2)}`} color={signals.above_ma200 ? 'text-green-400' : 'text-red-400'} />
            <Row label="MA50 Slope" value={`${signals.ma50_slope > 0 ? '+' : ''}${signals.ma50_slope.toFixed(3)}%`} color={signals.ma50_slope > 0 ? 'text-green-400' : 'text-red-400'} />
            <Row label="MACD" value={signals.macd.toFixed(4)} />
            <Row label="MACD Signal" value={signals.macd_signal_line.toFixed(4)} />
            <Row label="Histogram" value={signals.macd_histogram.toFixed(4)} color={signals.macd_histogram > 0 ? 'text-green-400' : 'text-red-400'} />
            <Row label="Crossover" value={signals.macd_crossover} color={signals.macd_crossover === 'Bullish' ? 'text-green-400' : signals.macd_crossover === 'Bearish' ? 'text-red-400' : 'text-gray-400'} />
          </div>

          {/* Momentum */}
          <div className="bg-gray-800/50 rounded-xl p-4">
            <div className="text-sm font-semibold text-white mb-3">⚡ Momentum</div>
            <RsiGauge rsi={signals.rsi} />
            <div className="mt-3">
              <Row label="RSI Signal" value={signals.rsi_signal} color={signals.rsi_signal === 'Overbought' ? 'text-red-400' : signals.rsi_signal === 'Oversold' ? 'text-green-400' : 'text-white'} />
            </div>
          </div>

          {/* Volatility */}
          <div className="bg-gray-800/50 rounded-xl p-4">
            <div className="text-sm font-semibold text-white mb-3">🌊 Volatility</div>
            <Row label="Current IV" value={`${signals.current_iv.toFixed(1)}%`} />
            <Row label="HV 20-day" value={`${signals.hv_20.toFixed(1)}%`} />
            <Row label="HV 60-day" value={`${signals.hv_60.toFixed(1)}%`} />
            <Row label="IV vs HV20" value={`${signals.iv_vs_hv > 0 ? '+' : ''}${signals.iv_vs_hv.toFixed(1)}%`} color={signals.iv_vs_hv > 0 ? 'text-red-400' : 'text-green-400'} />
            <Row label="IV Percentile" value={`${signals.iv_percentile.toFixed(0)}%`} />
            <Row label="IV Environment" value={signals.iv_environment} />
            <IvBar rank={signals.iv_rank} />
          </div>

          {/* Sentiment */}
          <div className="bg-gray-800/50 rounded-xl p-4">
            <div className="text-sm font-semibold text-white mb-3">🧭 Sentiment</div>
            <Row label="Put/Call Ratio" value={signals.put_call_ratio.toFixed(2)} color={signals.put_call_ratio > 1.2 ? 'text-red-400' : signals.put_call_ratio < 0.8 ? 'text-green-400' : 'text-white'} />
            <Row label="PCR Signal" value={signals.pcr_signal} />
            <Row label="IV Skew" value={`${signals.iv_skew.toFixed(2)}%`} color={signals.iv_skew > 5 ? 'text-red-400' : signals.iv_skew < -2 ? 'text-green-400' : 'text-white'} />
            <Row label="Skew Signal" value={signals.skew_signal} />
            <Row label="Volatility Regime" value={signals.volatility_regime} color={signals.volatility_regime === 'Sell Premium' ? 'text-amber-400' : signals.volatility_regime === 'Buy Premium' ? 'text-green-400' : 'text-white'} />
            <div className="mt-3 p-2 bg-gray-900 rounded-lg text-xs text-gray-400">
              {signals.iv_skew > 5 ? '⚠️ High put skew — market fearful, puts are expensive relative to calls.' :
               signals.iv_skew < -2 ? '📈 Low skew — market complacent, calls bid up.' :
               '✅ Normal skew — balanced options market.'}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
