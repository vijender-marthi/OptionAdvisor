interface RiskLevel {
  label: string
  threshold: number
  color: string
}

const DEFAULT_LEVELS: RiskLevel[] = [
  { label: 'Panic', threshold: 90, color: '#ef4444' },
  { label: 'High Risk', threshold: 70, color: '#f97316' },
  { label: 'Elevated', threshold: 50, color: '#f59e0b' },
  { label: 'Contained', threshold: 30, color: '#3b82f6' },
  { label: 'Calm', threshold: 0, color: '#22c55e' },
]

interface RiskGaugeProps {
  value: number
  label: string
  currentLabel?: string
  subtitle?: string
}

function currentLevel(value: number, levels: RiskLevel[]): RiskLevel {
  for (const l of levels) {
    if (value >= l.threshold) return l
  }
  return levels[levels.length - 1]
}

export default function RiskGauge({ value, label, currentLabel, subtitle }: RiskGaugeProps) {
  const safe = Math.max(0, Math.min(100, value))
  const level = currentLevel(safe, DEFAULT_LEVELS)
  const displayLabel = currentLabel || level.label
  const color = level.color
  const dashArray = 2 * Math.PI * 32
  const dashOffset = dashArray - (safe / 100) * dashArray

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="tcc-label">{label}</span>
        {subtitle && <span className="text-[10px] text-gray-400">{subtitle}</span>}
      </div>
      <div className="flex items-center gap-3">
        <div className="relative shrink-0">
          <svg width="56" height="56" viewBox="0 0 80 80">
            <circle cx="40" cy="40" r="32" fill="none" stroke="rgba(71,85,105,0.15)" strokeWidth="6" />
            <circle
              cx="40" cy="40" r="32"
              fill="none"
              stroke={color}
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={dashArray}
              strokeDashoffset={dashOffset}
              transform="rotate(-90 40 40)"
              style={{ transition: 'stroke-dashoffset 700ms ease, stroke 300ms ease' }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs font-bold" style={{ color }}>{safe}</span>
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-100">{displayLabel}</div>
        </div>
      </div>
    </div>
  )
}
