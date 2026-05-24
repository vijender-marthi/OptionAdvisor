import type { UnifiedAnalysis } from '../api/client'

const VERDICT_COLOR: Record<string, string> = {
  enter: '#00E5A0',
  watch: '#F5A623',
  wait:  '#6B7FD4',
  avoid: '#FF4D6D',
}

const VERDICT_BG: Record<string, string> = {
  enter: 'rgba(0,229,160,0.06)',
  watch: 'rgba(245,166,35,0.06)',
  wait:  'rgba(107,127,212,0.06)',
  avoid: 'rgba(255,77,109,0.06)',
}

const VERDICT_LABEL: Record<string, string> = {
  enter: 'ENTER NOW',
  watch: 'WATCH',
  wait:  'WAIT',
  avoid: 'AVOID',
}

export default function UnifiedVerdictCard({ analysis }: { analysis: UnifiedAnalysis }) {
  const v = analysis.verdict
  const color = VERDICT_COLOR[v] ?? '#6B7FD4'
  const bg = VERDICT_BG[v] ?? 'rgba(107,127,212,0.06)'
  const label = VERDICT_LABEL[v] ?? 'WAIT'

  return (
    <div style={{
      background: bg,
      border: `1px solid ${color}40`,
      borderRadius: 14,
      borderTop: `3px solid ${color}`,
      padding: '20px 24px',
      marginBottom: 16,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div style={{ fontSize: '2.5rem', fontWeight: 700, color, letterSpacing: '-0.02em', lineHeight: 1, fontFamily: 'monospace' }}>{label}</div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color, fontFamily: 'monospace' }}>{analysis.confidence}</div>
          <div style={{ fontSize: '0.6rem', color: '#5A6478', textTransform: 'uppercase', letterSpacing: '0.08em' }}>CONF</div>
        </div>
      </div>
      <div style={{ fontSize: '0.875rem', color: '#E8EBF0', opacity: 0.85, lineHeight: 1.6, marginBottom: 12 }}>{analysis.reason}</div>
      {analysis.conditions.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {analysis.conditions.map((c, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.7rem', fontWeight: 500, padding: '3px 10px', borderRadius: 20, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: c.type === 'pass' ? 'rgba(232,235,240,0.8)' : c.type === 'warn' ? '#F5A623' : '#FF4D6D' }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: c.type === 'pass' ? '#00E5A0' : c.type === 'warn' ? '#F5A623' : '#FF4D6D', flexShrink: 0 }} />
              {c.label}
            </span>
          ))}
        </div>
      )}
      <div style={{ paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {analysis.entry_price && (
          <div style={{ fontSize: '0.75rem', color: '#5A6478' }}>
            Entry: <span style={{ color: '#00E5A0', fontFamily: 'monospace', fontWeight: 600, marginLeft: 6 }}>{analysis.entry_description || `$${analysis.entry_price.toFixed(2)}`}</span>
            {analysis.stop_price && (
              <span style={{ marginLeft: 12 }}>Stop: <span style={{ color: '#FF4D6D', fontFamily: 'monospace', fontWeight: 600, marginLeft: 6 }}>${analysis.stop_price.toFixed(2)}</span></span>
            )}
          </div>
        )}
        {analysis.coach && (
          <div style={{ fontSize: '0.75rem', color: '#5A6478', lineHeight: 1.5, fontStyle: 'italic' }}>
            {analysis.coach.length > 120 ? analysis.coach.slice(0, 120) + '...' : analysis.coach}
          </div>
        )}
      </div>
    </div>
  )
}
