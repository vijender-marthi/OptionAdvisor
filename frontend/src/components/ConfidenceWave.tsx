interface ConfidenceWaveProps {
  value: number
}

function confidenceColor(value: number): string {
  if (value >= 80) return '#22c55e'
  if (value >= 60) return '#3b82f6'
  if (value >= 40) return '#f59e0b'
  if (value >= 20) return '#f97316'
  return '#ef4444'
}

export default function ConfidenceWave({ value }: ConfidenceWaveProps) {
  const safe = Math.max(0, Math.min(100, value))
  const color = confidenceColor(safe)

  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 rounded-full bg-gray-800/60">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${safe}%`, backgroundColor: color, opacity: 0.75 }}
        />
      </div>
      <span className="text-xs font-bold shrink-0" style={{ color }}>{safe}%</span>
    </div>
  )
}
