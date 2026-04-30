import { ComposedChart, Area, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import type { PricePoint } from '../types'

interface Props { history: PricePoint[] }

const fmt = (d: string) => {
  const dt = new Date(d)
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function PriceChart({ history }: Props) {
  const sampled = history.filter((_, i) => i % 3 === 0)

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
      <div className="text-sm font-semibold text-gray-300 mb-3">📉 Price History (1 Year)</div>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={sampled} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <defs>
            <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#7c3aed" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="date" tickFormatter={fmt} tick={{ fontSize: 11, fill: '#6b7280' }}
            interval={Math.floor(sampled.length / 6)} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false}
            tickFormatter={v => `$${v.toFixed(0)}`} width={55} domain={['auto', 'auto']} />
          <Tooltip
            contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: '#9ca3af' }}
            formatter={(val: number, name: string) => [`$${val?.toFixed(2)}`, name]}
            labelFormatter={fmt}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />
          <Area type="monotone" dataKey="close" name="Price" stroke="#7c3aed" fill="url(#priceGrad)" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="ma20" name="MA20" stroke="#3b82f6" strokeWidth={1} strokeDasharray="4 2" dot={false} />
          <Line type="monotone" dataKey="ma50" name="MA50" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5 3" dot={false} />
          <Line type="monotone" dataKey="ma200" name="MA200" stroke="#ef4444" strokeWidth={1.5} strokeDasharray="6 3" dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
