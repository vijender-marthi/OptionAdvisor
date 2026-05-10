interface SignalRingProps {
  value: number
  label: string
}

function ringColor(value: number): string {
  if (value >= 80) return '#22c55e'
  if (value >= 60) return '#3b82f6'
  if (value >= 40) return '#f59e0b'
  if (value >= 20) return '#f97316'
  return '#ef4444'
}

function statusText(value: number): string {
  if (value >= 80) return 'Ready'
  if (value >= 60) return 'Watch'
  if (value >= 40) return 'Caution'
  if (value >= 20) return 'Risky'
  return 'Avoid'
}

export default function SignalRing({ value, label }: SignalRingProps) {
  const safe = Math.max(0, Math.min(100, value))
  const color = ringColor(safe)
  const barColor = ringColor(safe).replace('#', '')

  return (
    <div className="flex items-center gap-2.5">
      <div className="flex-1">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] font-semibold text-gray-400">{label || statusText(safe)}</span>
          <span className="text-[11px] font-bold" style={{ color }}>{safe}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-gray-800/60">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${safe}%`, backgroundColor: color, opacity: 0.7 }}
          />
        </div>
      </div>
    </div>
  )
}
