import { useMemo } from 'react'
import { Area, AreaChart, ResponsiveContainer } from 'recharts'

interface SparklineCardProps {
  label: string
  value: string
  trend: string
  direction?: 'up' | 'down' | 'flat'
  data?: { v: number }[]
  color?: string
}

function generateSparkline(trend: string): { v: number }[] {
  const bullish = trend === 'bullish' || trend === 'bull'
  const base = bullish ? 100 : 95
  const pts = 20
  const out: { v: number }[] = []
  for (let i = 0; i < pts; i++) {
    const drift = bullish ? 0.3 + Math.random() * 0.4 : -0.3 + Math.random() * 0.4
    const noise = (Math.random() - 0.5) * 1.5
    const val = base + (i / pts) * (bullish ? 8 : -8) + noise + drift * i * 0.1
    out.push({ v: Math.round(val * 100) / 100 })
  }
  return out
}

function trendColor(trend: string): string {
  const t = trend.toLowerCase()
  if (t.includes('bull')) return '#22c55e'
  if (t.includes('bear')) return '#ef4444'
  return '#3b82f6'
}

function trendLabel(trend: string): string {
  const t = trend.toLowerCase()
  if (t.includes('strong') && t.includes('bull')) return 'Strong Buy'
  if (t.includes('bull')) return 'Bullish'
  if (t.includes('bear')) return 'Bearish'
  if (t.includes('neutral')) return 'Neutral'
  return '—'
}

export default function SparklineCard({ label, value, trend, direction, data, color }: SparklineCardProps) {
  const pts = useMemo(() => data ?? generateSparkline(trend), [data, trend])
  const c = color ?? trendColor(trend)
  const dir = direction ?? (trend.toLowerCase().includes('bull') ? 'up' : trend.toLowerCase().includes('bear') ? 'down' : 'flat')
  const first = pts[0]?.v ?? 100
  const last = pts[pts.length - 1]?.v ?? 100
  const slope = ((last - first) / first * 100).toFixed(1)

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="tcc-label">{label}</span>
        <span className="text-[10px] font-semibold text-gray-400">7D</span>
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              className={`inline-flex h-2 w-2 rounded-full ${dir === 'up' ? 'bg-emerald-500' : dir === 'down' ? 'bg-red-500' : 'bg-sky-500'}`}
            />
            <span className="text-lg font-bold text-white leading-none">{value}</span>
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-xs font-semibold" style={{ color: c }}>{trendLabel(trend)}</span>
            <span className="text-[10px]" style={{ color: c }}>
              {dir === 'up' ? '+' : ''}{slope}%
            </span>
          </div>
        </div>
        <div className="h-10 w-24 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={pts} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`sg-${label.replace(/\s/g, '')}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={c} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={c} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="v"
                stroke={c}
                strokeWidth={1.5}
                fill={`url(#sg-${label.replace(/\s/g, '')})`}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
