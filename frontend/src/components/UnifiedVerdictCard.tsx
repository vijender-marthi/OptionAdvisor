import { Info } from 'lucide-react'
import type { UnifiedAnalysis } from '../api/client'

const VERDICT_BG: Record<string, string> = {
  // Unified verdict enum (new)
  STRONG_GO: 'rgba(0,168,107,0.10)',
  GO:        'rgba(0,168,107,0.06)',
  WATCH:     'rgba(212,160,23,0.06)',
  WAIT:      'rgba(107,114,128,0.06)',
  AVOID:     'rgba(208,49,45,0.06)',
  NO_EDGE:   'rgba(107,114,128,0.04)',
  // Legacy lowercase (kept for backward compat)
  enter: 'rgba(0,168,107,0.06)',
  watch: 'rgba(212,160,23,0.06)',
  wait:  'rgba(107,114,128,0.06)',
  avoid: 'rgba(208,49,45,0.06)',
}

const C = {
  text:  'var(--text-primary)',
  textSec: 'var(--text-secondary)',
  textTer: 'var(--text-tertiary)',
  panel: 'var(--surface-elevated)',
  border: 'var(--border-subtle)',
}

function fmtChg(pct: number | null): string | null {
  if (pct == null) return null
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
}

function computeSignalQuality(conditions: { label: string; type: 'pass' | 'warn' | 'fail' }[]): { score: number; label: string; color: string } {
  if (conditions.length === 0) return { score: 0, label: 'No data', color: '#6B7280' }
  const pass = conditions.filter(c => c.type === 'pass').length
  const warn = conditions.filter(c => c.type === 'warn').length
  const total = conditions.length
  const weighted = (pass * 2 + warn * 0.5) / (total * 2) * 10
  const score = Math.round(weighted * 10) / 10
  if (score >= 7) return { score, label: 'Strong', color: '#00A86B' }
  if (score >= 4) return { score, label: 'Moderate', color: '#D4A017' }
  return { score, label: 'Weak', color: '#6B7280' }
}

export default function UnifiedVerdictCard({ analysis }: { analysis: UnifiedAnalysis }) {
  const isSwing = analysis.trade_type === 'swing'
  const v = analysis.verdict
  const bg = VERDICT_BG[v] ?? 'rgba(107,114,128,0.06)'
  const sq = computeSignalQuality(analysis.conditions)
  const displayScore = analysis.confidence

  // Score-gated status: both scores must cross thresholds before green.
  // Engine verdict overrides: when the engine says GO/STRONG GO, respect it.
  const setupScore = displayScore
  const signalScore = sq.score
  const rawVerdict = (analysis.verdict || analysis.verdict_raw || '').toUpperCase().replace(/ /g, '_')
  const isGo = rawVerdict === 'STRONG_GO' || rawVerdict === 'GO'
  let statusText: string
  let statusColor: string

  if (rawVerdict === 'STRONG_GO') {
    statusText = 'Entry conditions met — ready to act'
    statusColor = '#00A86B'
  } else if (isGo && setupScore >= 65) {
    statusText = 'Entry conditions met — ready to act'
    statusColor = '#00A86B'
  } else if (setupScore >= 65 && signalScore >= 7.0) {
    statusText = 'Setup building'
    statusColor = '#D4A017'
  } else {
    statusText = 'Watching — entry not triggered'
    statusColor = '#D4A017'
  }

  const scoreColor = statusColor

  if (isSwing) {
    return (
      <div className="uv-card" style={{ background: bg, border: `1px solid ${statusColor}30`, borderRadius: 12, padding: '14px 18px', marginBottom: 14 }}>
        {/* Status line */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
            <span style={{ fontSize: 16, fontWeight: 700, color: statusColor, fontFamily: "'Inter', system-ui, sans-serif", lineHeight: 1.2 }}>{statusText}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: scoreColor, fontFamily: "'SF Mono', 'Fira Code', monospace", lineHeight: 1 }}>{displayScore}</div>
              <div style={{ fontSize: 9, color: C.textTer, letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 1 }}>Setup score</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: sq.color, fontFamily: "'SF Mono', 'Fira Code', monospace", lineHeight: 1 }}>{sq.score}/10</div>
              <div style={{ fontSize: 9, color: C.textTer, letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 1 }}>Signal quality</div>
            </div>
          </div>
        </div>

        {/* Explanation */}
        <div className="uv-reason" style={{ fontSize: 12, color: C.textSec, lineHeight: 1.5, marginBottom: 10 }}>
          {(() => {
            if (!analysis.entry_price) {
              if (isGo) {
                return `Engine verdict is ${rawVerdict.replace(/_/g, ' ')} — setup conditions are aligned. Setup score ${setupScore} with signal quality ${signalScore}/10. Proceed with entry plan.`
              }
              if (setupScore >= 65 && signalScore >= 7.0) {
                return `Setup is building. Setup score ${setupScore} with signal quality ${signalScore}/10. Conditions are developing — waiting for confirmation trigger before committing.`
              }
              return `Signal quality ${sq.label.toLowerCase()} on a ${isGo ? 'developing' : 'forming'} setup. Setup score is ${setupScore} — structural conditions are building but entry confirmation is not yet met. Wait for pullback hold or breakout with volume before acting.`
            }
            return analysis.reason || 'Setup conditions are being evaluated.'
          })()}
          {analysis.structure && ` Best structure: ${analysis.structure}${analysis.spread_entry?.expiry ? `, \u00B7 ${analysis.spread_entry.expiry}` : ''}.`}
        </div>

        {/* Conditions as inline chips */}
        {analysis.conditions.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {analysis.conditions.slice(0, 8).map((c, i) => (
                <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '2px 8px', borderRadius: 4, border: `1px solid ${c.type === 'pass' ? 'rgba(0,168,107,0.3)' : c.type === 'warn' ? 'rgba(212,160,23,0.3)' : 'rgba(208,49,45,0.3)'}`, color: c.type === 'pass' ? '#00A86B' : c.type === 'warn' ? '#D4A017' : '#D0312D', background: c.type === 'pass' ? 'rgba(0,168,107,0.06)' : c.type === 'warn' ? 'rgba(212,160,23,0.06)' : 'rgba(208,49,45,0.06)' }}>
                  {c.label}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Risk profile chips */}
        {analysis.risk_profile.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
            {analysis.risk_profile.slice(0, 4).map((r, i) => {
              const sv: Record<string, string> = { HIGH: '#D0312D', MEDIUM: '#D4A017', LOW: '#6B7280' }
              const sc = sv[r.severity] || '#6B7280'
              return (
                <span key={i} title={r.message} style={{ fontSize: '0.55rem', padding: '2px 6px', borderRadius: 3, border: `1px solid ${sc}40`, color: sc, background: `${sc}10`, cursor: 'help' }}>
                  {r.type}
                </span>
              )
            })}
          </div>
        )}

        {/* Psychology message */}
        {analysis.psychology?.message && (
          <div style={{ fontSize: '0.65rem', color: C.textTer, fontStyle: 'italic', lineHeight: 1.4, marginBottom: 10, paddingTop: 6, borderTop: `1px solid ${C.border}` }}>
            {analysis.psychology.message}
          </div>
        )}

        {/* Meta row */}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11, color: C.textTer, paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
          {analysis.structure && <span>Structure: <span style={{ color: C.text, fontWeight: 500 }}>{unifiedStructureLabel(analysis.structure)}</span></span>}
          <span>Risk if entered: <span style={{ color: analysis.risk_level === 'LOW' ? '#00A86B' : analysis.risk_level === 'MEDIUM' ? '#D4A017' : '#D0312D', fontWeight: 500 }}>{analysis.risk_level || '—'}</span></span>
          <span>RVOL: <span style={{ color: C.text, fontFamily: 'monospace' }}>{analysis.rvol || '—'}</span></span>
        </div>
      </div>
    )
  }

  // ─── Standard layout (day / regular) ────────────────────────────────
  const stdColor = v === 'enter' ? '#00A86B' : v === 'watch' ? '#D4A017' : v === 'wait' ? '#3B82F6' : '#D0312D'
  const stdLabel = v === 'enter' ? 'Ready to enter' : v === 'watch' ? 'Monitor — no entry yet' : v === 'wait' ? 'Waiting' : 'Not aligned'

  return (
    <div className="uv-card" style={{ background: bg, border: `1px solid ${stdColor}30`, borderRadius: 12, padding: '14px 18px', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: stdColor, fontFamily: "'Inter', system-ui, sans-serif", lineHeight: 1.2 }}>{stdLabel}</span>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: stdColor, fontFamily: "'SF Mono', 'Fira Code', monospace", lineHeight: 1.2 }}>{analysis.confidence}</div>
          <div className="uv-muted" style={{ fontSize: 10, color: C.textTer, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Score</div>
        </div>
      </div>
      <div className="uv-reason" style={{ fontSize: 13, color: C.textSec, lineHeight: 1.5, marginBottom: 8 }}>{analysis.reason}</div>
      {(analysis.spy_price != null || analysis.qqq_price != null) && (
        <div className="uv-mkt" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 8, fontSize: 12, color: C.textTer }}>
          {analysis.spy_price != null && <span>SPY <span className="uv-primary" style={{ fontFamily: 'monospace', fontWeight: 600 }}>${analysis.spy_price.toFixed(2)}</span>{analysis.spy_change_pct != null && <span style={{ color: analysis.spy_change_pct >= 0 ? '#00A86B' : '#D0312D', marginLeft: 4, fontFamily: 'monospace' }}>{fmtChg(analysis.spy_change_pct)}</span>}</span>}
          {analysis.qqq_price != null && <span>QQQ <span className="uv-primary" style={{ fontFamily: 'monospace', fontWeight: 600 }}>${analysis.qqq_price.toFixed(2)}</span>{analysis.qqq_change_pct != null && <span style={{ color: analysis.qqq_change_pct >= 0 ? '#00A86B' : '#D0312D', marginLeft: 4, fontFamily: 'monospace' }}>{fmtChg(analysis.qqq_change_pct)}</span>}</span>}
          {analysis.vix != null && <span>VIX <span style={{ color: analysis.vix < 20 ? '#00A86B' : analysis.vix < 25 ? '#D4A017' : '#D0312D', fontFamily: 'monospace', fontWeight: 600 }}>{analysis.vix.toFixed(1)}</span></span>}
          {analysis.regime && <span>Regime <span className="uv-primary" style={{ fontFamily: 'monospace', fontWeight: 600 }}>{analysis.regime}</span></span>}
        </div>
      )}
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
      {/* Risk profile chips — standard layout */}
      {analysis.risk_profile.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6, marginBottom: 4 }}>
          {analysis.risk_profile.slice(0, 4).map((r, i) => {
            const sv: Record<string, string> = { HIGH: '#D0312D', MEDIUM: '#D4A017', LOW: '#6B7280' }
            const sc = sv[r.severity] || '#6B7280'
            return (
              <span key={i} title={r.message} style={{ fontSize: '0.55rem', padding: '2px 6px', borderRadius: 3, border: `1px solid ${sc}40`, color: sc, background: `${sc}10`, cursor: 'help' }}>
                {r.type}
              </span>
            )
          })}
        </div>
      )}
      {/* Psychology — standard layout */}
      {analysis.psychology?.message && (
        <div style={{ fontSize: '0.65rem', color: C.textTer, fontStyle: 'italic', lineHeight: 1.4, marginBottom: 6, paddingTop: 4 }}>
          {analysis.psychology.message}
        </div>
      )}
      {analysis.structure && (
        <div className="uv-meta" style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${C.border}`, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="uv-muted" style={{ fontSize: 12, color: C.textTer, display: 'flex', alignItems: 'center', gap: 4 }}>
            Best structure: <span className="uv-primary" style={{ color: C.text, fontWeight: 500 }}>{analysis.structure}</span>
            {(analysis.coach || analysis.entry_description) && (
              <span style={{ position: 'relative', display: 'inline-flex' }} className="uv-info-wrap">
                <Info size={12} style={{ cursor: 'pointer', color: C.textTer }} />
                <span style={{ position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)', fontSize: 11, lineHeight: 1.5, padding: '8px 10px', borderRadius: 8, whiteSpace: 'normal', width: 280, zIndex: 20, pointerEvents: 'none', opacity: 0, transition: 'opacity 0.15s', boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }} className="uv-tooltip">{analysis.coach || analysis.entry_description}</span>
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

function unifiedStructureLabel(s: string): string {
  const clean = s.replace(/\s*·\s*\d+\s*DTE.*$/, '').trim()
  return clean || s
}
