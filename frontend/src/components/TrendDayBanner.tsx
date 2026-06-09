export interface TrendDayBannerProps {
  direction: 'BULL' | 'BEAR'
  spyMove: number
  vixLevel: number
  tickerCount: number
  atrUsedPct?: number | null
  isDark?: boolean
}

export default function TrendDayBanner({
  direction, spyMove, vixLevel, tickerCount, atrUsedPct, isDark = true,
}: TrendDayBannerProps) {
  const isBear   = direction === 'BEAR'
  const bg       = isBear ? 'rgba(226,75,74,0.12)'  : 'rgba(99,153,34,0.12)'
  const border   = isBear ? '#E24B4A'                : '#639922'
  const color    = isBear ? '#e07070'                : '#a3cc6a'
  const icon     = isBear ? '📉'                     : '📈'
  const label    = isBear ? 'Bear confirmed'          : 'Bull confirmed'
  const orBreak  = isBear ? 'OR low breaks'           : 'OR high breaks'
  const bodyMuted = isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)'

  const atrOver = atrUsedPct != null && atrUsedPct >= 150

  return (
    <div style={{
      borderRadius: 10, padding: '12px 14px', marginBottom: 8,
      background: bg, border: `1.5px solid ${border}`,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 14 }}>{icon}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            TREND DAY · {label}
          </span>
        </div>
        {atrOver && (
          <span style={{ fontSize: 10, fontWeight: 700, color: '#E24B4A', background: 'rgba(226,75,74,0.15)', border: '0.5px solid #E24B4A', borderRadius: 4, padding: '2px 7px' }}>
            ATR LIMIT
          </span>
        )}
      </div>

      {/* Context line */}
      <div style={{ fontSize: 11, color, fontFamily: 'monospace', marginBottom: 8 }}>
        SPY {spyMove >= 0 ? '+' : ''}{spyMove.toFixed(2)}%
        {' · '}VIX {vixLevel.toFixed(1)}
        {' · '}{tickerCount} ticker{tickerCount !== 1 ? 's' : ''} moving together
      </div>

      {/* Rules */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {[
          'Extension signals suspended',
          `${orBreak} valid all session`,
          'Widen stops by 50%',
        ].map((line, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 9, color, flexShrink: 0 }}>▸</span>
            <span style={{ fontSize: 11, color: bodyMuted }}>{line}</span>
          </div>
        ))}

        {/* ATR usage */}
        {atrUsedPct != null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <span style={{ fontSize: 9, color: atrOver ? '#E24B4A' : color, flexShrink: 0 }}>▸</span>
            <span style={{ fontSize: 11, color: atrOver ? '#E24B4A' : color }}>
              Entry valid until ATR 150% used · Current ATR used: {Math.round(atrUsedPct)}%
              {atrOver ? ' · Suspend new entries' : ''}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
