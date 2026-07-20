import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { PositionPayoff } from '../../types/positionWorkspace'

function display(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === '' ? 'Unavailable' : String(value)
}

export default function ServerPayoffChart({ payoff }: { payoff: PositionPayoff | null | undefined }) {
  const points = (payoff?.points ?? []).filter(point => point.price !== null && point.value !== null)
  if (points.length === 0) {
    return <div className="flex h-48 items-center justify-center text-xs text-slate-500 dark:text-gray-400">Unavailable</div>
  }

  return (
    <div className="h-48" aria-label="Server-computed payoff chart">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <defs>
            <linearGradient id="position-payoff-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.28} />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border-subtle)" strokeDasharray="3 3" />
          <XAxis dataKey="price" tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }} tickLine={false} axisLine={false} />
          <ReferenceLine y={0} stroke="var(--text-tertiary)" strokeDasharray="4 4" />
          <Tooltip
            contentStyle={{ background: 'var(--surface-elevated)', border: '1px solid var(--border-default)', borderRadius: 6, fontSize: 11 }}
            labelFormatter={label => `${payoff?.x_label ?? 'Price'}: ${display(label as string | number)}`}
            formatter={value => [display(value as string | number), payoff?.y_label ?? 'Value']}
          />
          <Area type="monotone" dataKey="value" stroke="#38bdf8" strokeWidth={2} fill="url(#position-payoff-fill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
