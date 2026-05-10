import type { ReactNode } from 'react'
import { BrainCircuit } from 'lucide-react'

interface CoachSummaryCardProps {
  message: string
  confidence: number
  regime?: string
  mode?: string
}

function regimeBadge(mode: string): { label: string; cls: string } {
  const m = mode.toLowerCase()
  if (m.includes('euphoric')) return { label: 'Euphoric', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-600/25' }
  if (m.includes('bull')) return { label: 'Bullish', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-600/25' }
  if (m.includes('neutral')) return { label: 'Neutral', cls: 'bg-sky-500/15 text-sky-300 border-sky-600/25' }
  if (m.includes('defensive')) return { label: 'Defensive', cls: 'bg-amber-500/15 text-amber-300 border-amber-600/25' }
  if (m.includes('bear')) return { label: 'Bearish', cls: 'bg-red-500/15 text-red-300 border-red-600/25' }
  return { label: '—', cls: 'bg-gray-500/15 text-gray-300 border-gray-600/25' }
}

function confidenceColor(value: number): string {
  if (value >= 80) return '#22c55e'
  if (value >= 60) return '#3b82f6'
  if (value >= 40) return '#f59e0b'
  return '#ef4444'
}

export default function CoachSummaryCard({ message, confidence, regime, mode = 'neutral' }: CoachSummaryCardProps) {
  const safe = Math.max(0, Math.min(100, confidence))
  const color = confidenceColor(safe)
  const badge = regimeBadge(mode)
  const displayRegime = regime || badge.label

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <BrainCircuit size={16} className="text-violet-400 shrink-0" />
        <span className="tcc-label">AI Coach</span>
        <span className={`ml-auto inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${badge.cls}`}>
          {displayRegime}
        </span>
      </div>
      <div className="text-sm leading-relaxed text-white">{message || 'No coach message yet.'}</div>
      <div className="mt-3 flex items-center gap-3">
        <div className="flex-1 h-2 rounded-full bg-gray-700/30">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${safe}%`, backgroundColor: color, opacity: 0.8 }}
          />
        </div>
        <span className="text-xs font-bold shrink-0" style={{ color }}>{safe}% conf</span>
      </div>
    </div>
  )
}
