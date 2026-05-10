interface TrendStrengthBarProps {
  value: number
  label: string
  trend?: string
}

function trendColor(value: number, trend?: string): string {
  if (trend === 'bullish' || trend === 'bull') return '#22c55e'
  if (trend === 'bearish' || trend === 'bear') return '#ef4444'
  if (value >= 65) return '#22c55e'
  if (value >= 45) return '#3b82f6'
  if (value >= 35) return '#f59e0b'
  return '#ef4444'
}

export default function TrendStrengthBar({ value, label, trend }: TrendStrengthBarProps) {
  const safe = Math.max(0, Math.min(100, value))
  const isBullish = trend === 'bullish' || trend === 'bull' || safe >= 55
  const pct = isBullish ? (safe - 50) * 2 : (50 - safe) * 2
  const fillWidth = Math.min(100, Math.max(0, pct))
  const color = trendColor(safe, trend)

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="tcc-label">{label}</span>
        <span className="text-[10px] font-semibold" style={{ color }}>
          {isBullish ? 'Bullish' : 'Bearish'} {safe}%
        </span>
      </div>
      <div className="relative h-1.5 rounded-full bg-gray-800/60">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-2 w-px rounded-full bg-gray-600" />
        </div>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${fillWidth}%`,
            marginLeft: isBullish ? '50%' : undefined,
            marginRight: !isBullish ? '50%' : undefined,
            float: isBullish ? 'none' : 'right',
            backgroundColor: color,
            opacity: 0.7,
          }}
        />
      </div>
      <div className="flex justify-between text-[9px] text-gray-600 mt-0.5">
        <span>Weak</span>
        <span>Strong</span>
      </div>
    </div>
  )
}
