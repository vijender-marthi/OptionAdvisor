import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

interface GaugeMeterProps {
  value: number
  label: string
  states?: string[]
}

function regimeLabel(value: number, states?: string[]): string {
  if (states && states.length > 0) {
    const idx = Math.min(Math.floor((value / 100) * states.length), states.length - 1)
    return states[idx]
  }
  if (value >= 85) return 'Euphoric'
  if (value >= 65) return 'Bullish'
  if (value >= 45) return 'Neutral'
  if (value >= 25) return 'Defensive'
  return 'Bearish'
}

const REGIME_STYLES: Record<string, { dot: string; text: string; bg: string; icon: 'up' | 'down' | 'flat' }> = {
  Euphoric: { dot: 'bg-emerald-500', text: 'text-emerald-400', bg: 'bg-emerald-500/10', icon: 'up' },
  Bullish: { dot: 'bg-emerald-500', text: 'text-emerald-400', bg: 'bg-emerald-500/10', icon: 'up' },
  Neutral: { dot: 'bg-sky-500', text: 'text-sky-400', bg: 'bg-sky-500/10', icon: 'flat' },
  Defensive: { dot: 'bg-amber-500', text: 'text-amber-400', bg: 'bg-amber-500/10', icon: 'down' },
  Bearish: { dot: 'bg-red-500', text: 'text-red-400', bg: 'bg-red-500/10', icon: 'down' },
}

export default function GaugeMeter({ value, label, states }: GaugeMeterProps) {
  const safe = Math.max(0, Math.min(100, value))
  const regime = regimeLabel(safe, states)
  const s = REGIME_STYLES[regime] ?? REGIME_STYLES.Neutral

  return (
    <div>
      <div className="tcc-label mb-2">{label}</div>
      <div className={`flex items-center gap-2.5 rounded-lg ${s.bg} px-3 py-2`}>
        {s.icon === 'up' ? (
          <TrendingUp size={16} className={s.text} />
        ) : s.icon === 'down' ? (
          <TrendingDown size={16} className={s.text} />
        ) : (
          <Minus size={16} className={s.text} />
        )}
        <div>
          <div className={`text-base font-extrabold leading-tight ${s.text}`}>{regime}</div>
          <div className="text-[10px] text-gray-400">{safe}% strength</div>
        </div>
      </div>
      <div className="mt-2 h-1 w-full rounded-full bg-gray-700/30">
        <div
          className={`h-full rounded-full ${s.dot.replace('bg-', 'bg-')} transition-all duration-500`}
          style={{ width: `${safe}%`, opacity: 0.6 }}
        />
      </div>
    </div>
  )
}
