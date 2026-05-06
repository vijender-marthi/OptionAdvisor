import { useMemo } from 'react'
import {
  ComposedChart,
  CartesianGrid,
  Line,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import type { TooltipProps } from 'recharts'
import type { PricePoint } from '../types'

interface Props {
  history: PricePoint[]
}

const fmt = (d: string) => {
  const dt = new Date(d)
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function yExtent(rows: PricePoint[]): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (const r of rows) {
    lo = Math.min(lo, r.low, r.ma20, r.ma50, r.ma200)
    hi = Math.max(hi, r.high, r.ma20, r.ma50, r.ma200)
  }
  if (!Number.isFinite(lo)) return [0, 1]
  const pad = Math.max((hi - lo) * 0.03, hi * 0.008, 0.05)
  return [lo - pad, hi + pad]
}

/** Recharts Scatter shape — OHLC candles using numeric Y scale + band X scale. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CandlestickShape(raw: any) {
  const cx = Number(raw.cx)
  const yAxis = raw.yAxis as { scale: (v: number) => number } | undefined
  const xAxis = raw.xAxis as { scale?: { bandwidth?: () => number } } | undefined
  if (!Number.isFinite(cx) || !yAxis?.scale) return <g />

  const open = Number(raw.open)
  const high = Number(raw.high)
  const low = Number(raw.low)
  const close = Number(raw.close)
  if (![open, high, low, close].every(n => Number.isFinite(n))) return <g />

  const scale = yAxis.scale
  const yh = scale(high)
  const yl = scale(low)
  const yo = scale(open)
  const yc = scale(close)
  const up = close >= open
  const bodyTop = Math.min(yo, yc)
  const bodyH = Math.max(1, Math.abs(yo - yc))
  const bw = typeof xAxis?.scale?.bandwidth === 'function' ? xAxis.scale.bandwidth() : 8
  const w = Math.max(2, Math.min(14, bw * 0.68))
  const x = cx - w / 2
  const stroke = up ? '#34d399' : '#f87171'
  const fill = up ? '#10b981' : '#ef4444'

  return (
    <g className="candlestick" aria-hidden>
      <line x1={cx} y1={yh} x2={cx} y2={yl} stroke="#6b7280" strokeWidth={1} />
      <rect x={x} y={bodyTop} width={w} height={bodyH} fill={fill} stroke={stroke} strokeWidth={1} rx={0.5} />
    </g>
  )
}

function PriceTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload as PricePoint | undefined
  if (!row?.date) return null
  const labelStr = typeof label === 'string' ? fmt(label) : String(label)
  return (
    <div
      style={{
        backgroundColor: '#1f2937',
        border: '1px solid #374151',
        borderRadius: 8,
        fontSize: 12,
        padding: '10px 12px',
      }}
    >
      <div style={{ color: '#9ca3af', marginBottom: 6 }}>{labelStr}</div>
      <div
        style={{
          color: '#f3f4f6',
          fontFamily: 'ui-monospace, SFMono-Regular, monospace',
          fontSize: 11,
          lineHeight: 1.5,
        }}
      >
        O {row.open.toFixed(2)} · H {row.high.toFixed(2)} · L {row.low.toFixed(2)} · C {row.close.toFixed(2)}
        <div style={{ color: '#9ca3af', marginTop: 6 }}>
          MA20 {row.ma20.toFixed(2)} · MA50 {row.ma50.toFixed(2)} · MA200 {row.ma200.toFixed(2)}
        </div>
      </div>
    </div>
  )
}

export default function PriceChart({ history }: Props) {
  const sampled = useMemo(() => history.filter((_, i) => i % 3 === 0), [history])
  const domain = useMemo(() => yExtent(sampled), [sampled])

  if (sampled.length === 0) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 text-gray-500 text-sm">
        No price history loaded.
      </div>
    )
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
      <div className="text-sm font-semibold text-gray-300 mb-1">Underlying · daily candles (1 year)</div>
      <div className="text-[11px] text-gray-500 mb-3">
        Spot OHLC with moving averages (options on this page are built from the same underlying)
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={sampled} margin={{ top: 8, right: 10, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={fmt}
            tick={{ fontSize: 11, fill: '#6b7280' }}
            interval={Math.max(0, Math.floor(sampled.length / 6) - 1)}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={domain}
            tick={{ fontSize: 11, fill: '#6b7280' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={v => `$${Number(v).toFixed(0)}`}
            width={56}
          />
          <Tooltip content={<PriceTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />
          <Line
            type="monotone"
            dataKey="ma20"
            name="MA20"
            stroke="#3b82f6"
            strokeWidth={1}
            strokeDasharray="4 2"
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="ma50"
            name="MA50"
            stroke="#f59e0b"
            strokeWidth={1}
            strokeDasharray="5 3"
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="ma200"
            name="MA200"
            stroke="#ef4444"
            strokeWidth={1}
            strokeDasharray="6 3"
            dot={false}
            isAnimationActive={false}
          />
          <Scatter
            name="OHLC"
            dataKey="close"
            fill="transparent"
            stroke="transparent"
            shape={CandlestickShape}
            isAnimationActive={false}
            legendType="none"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
