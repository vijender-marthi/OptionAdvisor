import { Info } from 'lucide-react'
import type { UnifiedAnalysis } from '../api/client'

const VERDICT_COLOR: Record<string, string> = {
  enter: '#00A86B',
  watch: '#D4A017',
  wait:  '#3B82F6',
  avoid: '#D0312D',
}

const VERDICT_BG: Record<string, string> = {
  enter: 'rgba(0,168,107,0.06)',
  watch: 'rgba(212,160,23,0.06)',
  wait:  'rgba(107,114,128,0.06)',
  avoid: 'rgba(208,49,45,0.06)',
}

const VERDICT_LABEL: Record<string, string> = {
  enter: 'Ready to enter',
  watch: 'Watch',
  wait:  'Waiting',
  avoid: 'Not aligned',
}

const C = {
  text:  '#E5E7EB',
  textSec: '#9CA3AF',
  textTer: '#6B7280',
  panel: '#111215',
  border: '#1E1F24',
}

function fmtChg(pct: number | null): string | null {
  if (pct == null) return null
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
}

export default function UnifiedVerdictCard({ analysis }: { analysis: UnifiedAnalysis }) {
  const v = analysis.verdict
  const color = VERDICT_COLOR[v] ?? C.textTer
  const bg = VERDICT_BG[v] ?? 'rgba(107,114,128,0.06)'
  const label = VERDICT_LABEL[v] ?? 'Waiting'

  return (
    <div className="uv-card" style={{ background: bg, border: `1px solid ${color}30`, borderRadius: 12, padding: '14px 18px', marginBottom: 14 }}>
      {/* Row 1: Status left, Score right */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 22, fontWeight: 700, color, fontFamily: "'Inter', system-ui, sans-serif", lineHeight: 1.2 }}>{label}</span>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color, fontFamily: "'SF Mono', 'Fira Code', monospace", lineHeight: 1.2 }}>{analysis.confidence}</div>
          <div className="uv-muted" style={{ fontSize: 10, color: C.textTer, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Score</div>
        </div>
      </div>

      {/* Row 2: Reason text */}
      <div className="uv-reason" style={{ fontSize: 13, color: C.textSec, lineHeight: 1.5, marginBottom: 8 }}>{analysis.reason}</div>

      {/* Row 3: SPY / QQQ / VIX market context */}
      {(analysis.spy_price != null || analysis.qqq_price != null) && (
        <div className="uv-mkt" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 8, fontSize: 12, color: C.textTer }}>
          {analysis.spy_price != null && (
            <span>
              SPY <span className="uv-primary" style={{ fontFamily: 'monospace', fontWeight: 600 }}>${analysis.spy_price.toFixed(2)}</span>
              {analysis.spy_change_pct != null && (
                <span style={{ color: analysis.spy_change_pct >= 0 ? '#00A86B' : '#D0312D', marginLeft: 4, fontFamily: 'monospace' }}>{fmtChg(analysis.spy_change_pct)}</span>
              )}
            </span>
          )}
          {analysis.qqq_price != null && (
            <span>
              QQQ <span className="uv-primary" style={{ fontFamily: 'monospace', fontWeight: 600 }}>${analysis.qqq_price.toFixed(2)}</span>
              {analysis.qqq_change_pct != null && (
                <span style={{ color: analysis.qqq_change_pct >= 0 ? '#00A86B' : '#D0312D', marginLeft: 4, fontFamily: 'monospace' }}>{fmtChg(analysis.qqq_change_pct)}</span>
              )}
            </span>
          )}
          {analysis.vix != null && (
            <span>
              VIX <span style={{ color: analysis.vix < 20 ? '#00A86B' : analysis.vix < 25 ? '#D4A017' : '#D0312D', fontFamily: 'monospace', fontWeight: 600 }}>{analysis.vix.toFixed(1)}</span>
            </span>
          )}
          {analysis.regime && (
            <span>
              Regime <span className="uv-primary" style={{ fontFamily: 'monospace', fontWeight: 600 }}>{analysis.regime}</span>
            </span>
          )}
        </div>
      )}

      {/* Row 4: Conditions chips */}
      {analysis.conditions.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: analysis.structure ? 0 : undefined }}>
          {analysis.conditions.map((c, i) => (
            <span key={i} className={`uv-chip${c.type === 'pass' ? ' uv-chip--pass' : ''}${c.type === 'warn' ? ' uv-chip--warn' : ''}${c.type === 'fail' ? ' uv-chip--fail' : ''}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 4, background: C.panel, border: `1px solid ${C.border}`, color: c.type === 'pass' ? C.text : c.type === 'warn' ? '#D4A017' : '#D0312D' }}>
              <span style={{ width: 4, height: 4, borderRadius: '50%', background: c.type === 'pass' ? '#00A86B' : c.type === 'warn' ? '#D4A017' : '#D0312D', flexShrink: 0 }} />
              {c.label}
            </span>
          ))}
        </div>
      )}

      {/* Row 5: Structure / R:R / Risk meta */}
      {analysis.structure && (
        <div className="uv-meta" style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${C.border}`, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="uv-muted" style={{ fontSize: 12, color: C.textTer, display: 'flex', alignItems: 'center', gap: 4 }}>
            Best structure: <span className="uv-primary" style={{ color: C.text, fontWeight: 500 }}>{analysis.structure}</span>
            {(analysis.coach || analysis.entry_description) && (
              <span style={{ position: 'relative', display: 'inline-flex' }} className="uv-info-wrap">
                <Info size={12} style={{ cursor: 'pointer', color: C.textTer }} />
                <span style={{
                  position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)',
                  background: '#1E1F24', color: '#E5E7EB', fontSize: 11, lineHeight: 1.5, padding: '8px 10px',
                  borderRadius: 8, whiteSpace: 'normal', width: 280, zIndex: 20, pointerEvents: 'none',
                  opacity: 0, transition: 'opacity 0.15s',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                }} className="uv-tooltip">{analysis.coach || analysis.entry_description}</span>
              </span>
            )}
          </span>
          {analysis.rr_ratio && <span className="uv-muted" style={{ fontSize: 12, color: C.textTer }}>R/R: <span style={{ color: '#00A86B', fontWeight: 600, fontFamily: "'SF Mono', 'Fira Code', monospace" }}>{analysis.rr_ratio}</span></span>}
          <span className="uv-muted" style={{ fontSize: 12, color: C.textTer }}>Risk: <span style={{ color: analysis.risk_level === 'LOW' ? '#00A86B' : analysis.risk_level === 'MEDIUM' ? '#D4A017' : '#D0312D', fontWeight: 500 }}>{analysis.risk_level}</span></span>
        </div>
      )}
    </div>
  )
}
