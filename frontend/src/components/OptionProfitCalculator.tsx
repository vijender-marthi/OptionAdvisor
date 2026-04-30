import { useState, useMemo } from 'react'
import {
  ComposedChart, Area, Line, XAxis, YAxis, Tooltip,
  ReferenceLine, ResponsiveContainer, CartesianGrid, Legend
} from 'recharts'
import type { Recommendation } from '../types'

interface Props {
  recommendations: Recommendation[]
  currentPrice: number
}

// Compute P&L at expiration for a single leg
function legPnl(
  action: 'BUY' | 'SELL',
  optionType: 'CALL' | 'PUT',
  strike: number,
  premium: number,
  stockPrice: number
): number {
  const intrinsic =
    optionType === 'CALL'
      ? Math.max(stockPrice - strike, 0)
      : Math.max(strike - stockPrice, 0)

  return action === 'BUY' ? intrinsic - premium : premium - intrinsic
}

// Build a P&L curve dataset for a recommendation
function buildCurve(rec: Recommendation, currentPrice: number) {
  const lo = currentPrice * 0.65
  const hi = currentPrice * 1.35
  const steps = 120
  const step = (hi - lo) / steps

  return Array.from({ length: steps + 1 }, (_, i) => {
    const price = lo + i * step
    const pnl = rec.legs.reduce(
      (sum, leg) => sum + legPnl(leg.action, leg.option_type, leg.strike, leg.mid_price, price),
      0
    )
    return { price: parseFloat(price.toFixed(2)), pnl: parseFloat(pnl.toFixed(2)) }
  })
}

// Tooltip
const CustomTooltip = ({
  active, payload, label,
}: {
  active?: boolean
  payload?: Array<{ value: number }>
  label?: number
}) => {
  if (!active || !payload?.length) return null
  const pnl = payload[0].value
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 text-xs shadow-xl">
      <div className="text-gray-400 mb-1">Stock @ <span className="text-white font-mono">${label?.toFixed(2)}</span></div>
      <div className={`font-bold text-base ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
        {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
      </div>
      <div className="text-gray-500 mt-0.5">{pnl >= 0 ? 'Profit' : 'Loss'} at expiration</div>
    </div>
  )
}

export default function OptionProfitCalculator({ recommendations, currentPrice }: Props) {
  const [selectedIdx, setSelectedIdx] = useState(0)

  const rec = recommendations[selectedIdx]

  const curve = useMemo(
    () => (rec ? buildCurve(rec, currentPrice) : []),
    [rec, currentPrice]
  )

  // Determine y-axis domain with padding
  const pnlValues = curve.map(d => d.pnl)
  const minPnl = Math.min(...pnlValues)
  const maxPnl = Math.max(...pnlValues)
  const pad = (maxPnl - minPnl) * 0.15 || 10
  const yDomain = [Math.floor(minPnl - pad), Math.ceil(maxPnl + pad)]

  if (!rec) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500 text-sm">
        No recommendations available to plot.
      </div>
    )
  }

  const breakevens = [rec.breakeven_lower, rec.breakeven_upper].filter(b => b && b > 0)

  return (
    <div className="space-y-4">
      {/* Trade selector */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Trade</span>
        <div className="flex flex-wrap gap-2">
          {recommendations.map((r, i) => (
            <button
              key={i}
              onClick={() => setSelectedIdx(i)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                i === selectedIdx
                  ? 'bg-violet-600 border-violet-500 text-white shadow-lg shadow-violet-900/30'
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-200'
              }`}
            >
              #{r.rank} {r.strategy}
            </button>
          ))}
        </div>
      </div>

      {/* Key stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: 'Max Profit', value: `+$${rec.max_profit.toFixed(2)}`, color: 'text-emerald-400' },
          { label: 'Max Loss', value: `-$${rec.max_loss.toFixed(2)}`, color: 'text-red-400' },
          { label: 'Net Credit', value: `$${rec.net_credit.toFixed(2)}`, color: 'text-violet-400' },
          { label: 'Prob of Profit', value: `${(rec.prob_of_profit * 100).toFixed(0)}%`, color: 'text-blue-400' },
        ].map(s => (
          <div key={s.label} className="bg-gray-800/60 rounded-xl px-3 py-2 border border-gray-700/50">
            <div className="text-gray-500 text-xs mb-0.5">{s.label}</div>
            <div className={`font-bold text-sm ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="relative">
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={curve} margin={{ top: 10, right: 16, left: 0, bottom: 5 }}>
            <defs>
              <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="lossGrad" x1="0" y1="1" x2="0" y2="0">
                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />

            <XAxis
              dataKey="price"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={v => `$${v.toFixed(0)}`}
              tick={{ fontSize: 10, fill: '#6b7280' }}
              axisLine={false}
              tickLine={false}
              scale="linear"
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#6b7280' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={v => `$${v.toFixed(0)}`}
              width={52}
              domain={yDomain}
            />

            <Tooltip content={<CustomTooltip />} />
            <Legend
              wrapperStyle={{ fontSize: 11, color: '#9ca3af', paddingTop: 6 }}
            />

            {/* Zero line */}
            <ReferenceLine y={0} stroke="#4b5563" strokeWidth={1.5} />

            {/* Current price */}
            <ReferenceLine
              x={currentPrice}
              stroke="#7c3aed"
              strokeWidth={1.5}
              strokeDasharray="5 3"
              label={{ value: `Now $${currentPrice.toFixed(0)}`, position: 'top', fill: '#a78bfa', fontSize: 10 }}
            />

            {/* Breakevens */}
            {breakevens.map((be, i) => (
              <ReferenceLine
                key={i}
                x={be}
                stroke="#f59e0b"
                strokeWidth={1}
                strokeDasharray="4 3"
                label={{ value: `BE $${be.toFixed(0)}`, position: i === 0 ? 'insideBottomLeft' : 'insideBottomRight', fill: '#fbbf24', fontSize: 9 }}
              />
            ))}

            {/* Profit area (pnl >= 0) */}
            <Area
              type="monotone"
              dataKey="pnl"
              name="P&L at Expiry"
              stroke="#10b981"
              strokeWidth={2.5}
              fill="url(#profitGrad)"
              dot={false}
              activeDot={{ r: 4, fill: '#10b981', stroke: '#065f46' }}
              connectNulls
            />

            {/* Loss shading: overlay with red where pnl < 0 */}
            <Line
              type="monotone"
              dataKey={(d: { pnl: number }) => (d.pnl < 0 ? d.pnl : null)}
              name="Loss zone"
              stroke="#ef4444"
              strokeWidth={2.5}
              dot={false}
              legendType="none"
              connectNulls={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Leg breakdown */}
      <div>
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Legs</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {rec.legs.map((leg, i) => (
            <div
              key={i}
              className={`flex items-center justify-between rounded-xl px-3 py-2 border text-xs
                ${leg.action === 'SELL'
                  ? 'bg-red-900/10 border-red-900/30'
                  : 'bg-emerald-900/10 border-emerald-900/30'
                }`}
            >
              <div className="flex items-center gap-2">
                <span className={`font-bold ${leg.action === 'SELL' ? 'text-red-400' : 'text-emerald-400'}`}>
                  {leg.action}
                </span>
                <span className="text-gray-300 font-mono">
                  ${leg.strike} {leg.option_type}
                </span>
                <span className="text-gray-500">{leg.expiry}</span>
              </div>
              <div className="text-right">
                <div className="text-gray-300 font-mono">${leg.mid_price.toFixed(2)}</div>
                <div className="text-gray-500">Δ {leg.delta?.toFixed(2)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
