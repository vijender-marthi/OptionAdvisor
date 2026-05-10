interface ExposureBarProps {
  bullish: number
  bearish: number
  cash: number
  concentration?: number
}

export default function ExposureBar({ bullish, bearish, cash }: ExposureBarProps) {
  const total = Math.max(1, bullish + bearish + cash)
  const bPct = (bullish / total) * 100
  const bePct = (bearish / total) * 100
  const cPct = (cash / total) * 100

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="tcc-label">Portfolio Exposure</span>
        <span className="text-[10px] text-gray-500">{Math.round(bullish + bearish + cash)}%</span>
      </div>

      <div className="flex h-4 rounded-full bg-gray-800/60 overflow-hidden">
        <div
          className="flex items-center justify-center text-[8px] font-bold text-white"
          style={{ width: `${bPct}%`, backgroundColor: '#22c55e', opacity: 0.8 }}
        >
          {bPct > 15 ? `${Math.round(bPct)}%` : ''}
        </div>
        <div
          className="flex items-center justify-center text-[8px] font-bold text-white"
          style={{ width: `${bePct}%`, backgroundColor: '#ef4444', opacity: 0.8 }}
        >
          {bePct > 15 ? `${Math.round(bePct)}%` : ''}
        </div>
        <div
          className="flex items-center justify-center text-[8px] font-bold text-gray-400"
          style={{ width: `${cPct}%`, backgroundColor: '#4b5563', opacity: 0.6 }}
        >
          {cPct > 15 ? `${Math.round(cPct)}%` : ''}
        </div>
      </div>

      <div className="flex gap-3 text-[10px]">
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          <span className="text-gray-500">Bull {Math.round(bPct)}%</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
          <span className="text-gray-500">Bear {Math.round(bePct)}%</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-gray-600" />
          <span className="text-gray-500">Cash {Math.round(cPct)}%</span>
        </span>
      </div>
    </div>
  )
}
