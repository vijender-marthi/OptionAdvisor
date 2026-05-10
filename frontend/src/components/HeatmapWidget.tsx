interface SectorTile {
  label: string
  value: number
  tone: 'bullish' | 'bearish' | 'neutral' | 'warning'
}

const SECTORS: SectorTile[] = [
  { label: 'Tech', value: 82, tone: 'bullish' },
  { label: 'Fin', value: 68, tone: 'bullish' },
  { label: 'Energy', value: 45, tone: 'neutral' },
  { label: 'Health', value: 55, tone: 'neutral' },
  { label: 'Cons Disc', value: 72, tone: 'bullish' },
  { label: 'Cons Stap', value: 35, tone: 'bearish' },
  { label: 'Indust', value: 58, tone: 'neutral' },
  { label: 'Util', value: 28, tone: 'bearish' },
]

function tileStyle(tone: 'bullish' | 'bearish' | 'neutral' | 'warning'): string {
  switch (tone) {
    case 'bullish': return 'bg-emerald-500/15 text-emerald-300 border-emerald-600/20'
    case 'bearish': return 'bg-red-500/15 text-red-300 border-red-600/20'
    case 'warning': return 'bg-amber-500/15 text-amber-300 border-amber-600/20'
    default: return 'bg-gray-700/20 text-gray-300 border-gray-600/15'
  }
}

export default function HeatmapWidget({ sectors = SECTORS }: { sectors?: SectorTile[] }) {
  const strong = sectors.filter(s => s.tone === 'bullish').map(s => s.label)
  const weak = sectors.filter(s => s.tone === 'bearish').map(s => s.label)

  return (
    <div className="flex flex-col h-full">
      <div className="tcc-label mb-3">Sector Heat</div>
      <div className="grid grid-cols-4 gap-3">
        {sectors.map(s => (
          <div
            key={s.label}
            className={`rounded-md border px-1.5 py-3 text-center ${tileStyle(s.tone)}`}
          >
            <div className="text-[9px] font-bold uppercase tracking-tight leading-tight">{s.label}</div>
            <div className="text-[10px] font-semibold mt-px">{s.value}%</div>
          </div>
        ))}
      </div>
      {strong.length > 0 || weak.length > 0 ? (
        <div className="mt-3 pt-3 border-t border-gray-700/20 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-gray-500 leading-relaxed">
          {strong.length > 0 && (
            <span>
              <span className="text-emerald-400 font-semibold">Strong:</span>{' '}
              {strong.join(', ')}
            </span>
          )}
          {weak.length > 0 && (
            <span>
              <span className="text-red-400 font-semibold">Weak:</span>{' '}
              {weak.join(', ')}
            </span>
          )}
        </div>
      ) : null}
    </div>
  )
}
