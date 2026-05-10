interface RiskLevel {
  label: string
  threshold: number
}

const DEFAULT_LEVELS: RiskLevel[] = [
  { label: 'Panic', threshold: 90 },
  { label: 'High Risk', threshold: 70 },
  { label: 'Elevated', threshold: 50 },
  { label: 'Contained', threshold: 30 },
  { label: 'Calm', threshold: 0 },
]

interface RiskThermometerProps {
  value: number
  label?: string
  levels?: RiskLevel[]
  currentLabel?: string
}

function currentLevel(value: number, levels: RiskLevel[]): RiskLevel {
  for (const l of levels) {
    if (value >= l.threshold) return l
  }
  return levels[levels.length - 1]
}

function levelColor(label: string): string {
  const l = label.toLowerCase()
  if (l.includes('panic')) return '#ef4444'
  if (l.includes('high') || l.includes('extreme')) return '#f97316'
  if (l.includes('elevated')) return '#f59e0b'
  if (l.includes('contained')) return '#3b82f6'
  return '#22c55e'
}

export default function RiskThermometer({ value, label = 'VIX Risk', levels = DEFAULT_LEVELS, currentLabel }: RiskThermometerProps) {
  const safe = Math.max(0, Math.min(100, value))
  const level = currentLevel(safe, levels)
  const displayLabel = currentLabel || level.label
  const color = levelColor(level.label)

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="tcc-label">{label}</span>
        <span className="text-xs font-semibold" style={{ color }}>{displayLabel}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-gray-800/60">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${safe}%`,
            backgroundColor: color,
            opacity: 0.7,
          }}
        />
      </div>
    </div>
  )
}
