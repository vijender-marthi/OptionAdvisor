import type { ReactNode } from 'react'
import { Info } from 'lucide-react'
import type { UnifiedAnalysis } from '../api/client'

const VERDICT_BG: Record<string, string> = {
  GO:        'rgba(0,168,107,0.06)',
  STRONG_GO: 'rgba(0,168,107,0.06)',
  enter:     'rgba(0,168,107,0.06)',
  WATCH:     'rgba(212,160,23,0.06)',
  watch:     'rgba(212,160,23,0.06)',
  WAIT:      'rgba(107,114,128,0.06)',
  wait:      'rgba(107,114,128,0.06)',
  AVOID:     'rgba(208,49,45,0.06)',
  avoid:     'rgba(208,49,45,0.06)',
}

const C = {
  text:    'var(--text-primary)',
  textSec: 'var(--text-secondary)',
  textTer: 'var(--text-tertiary)',
  panel:   'var(--surface-elevated)',
  border:  'var(--border-subtle)',
}

function fmtChg(pct: number | null): string | null {
  if (pct == null) return null
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
}

function unifiedStructureLabel(s: string): string {
  return s.replace(/\s*·\s*\d+\s*DTE.*$/, '').trim() || s
}

export default function UnifiedVerdictCard({ analysis, bias, levels, headerActions }: {
  analysis: UnifiedAnalysis
  /** Optional Long/Short/Neutral bias pill (swing layout only). */
  bias?: 'long' | 'short' | 'neutral' | null
  /** Optional key-level tiles (Entry/Stop/Target/R-R) rendered under the header (swing layout only). */
  levels?: { label: string; value: string; color: string }[]
  /** Optional primary action buttons rendered in the header band (swing layout only). */
  headerActions?: ReactNode
}) {
  const isSwing = analysis.trade_type === 'swing'
  const vp = analysis.verdict_presentation
  const { status_text, status_color, signal_quality, setup_bar_pct, setup_bar_color, pass_count, warn_count, fail_count } = vp
  const bg = VERDICT_BG[analysis.verdict] ?? 'rgba(107,114,128,0.06)'

  // ─── Swing Trade Verdict Card ────────────────────────────────────────
  if (isSwing) {
    return (
      <div className="uv-card" style={{ background: bg, border: `1px solid ${status_color}40`, borderRadius: 14, overflow: 'hidden', marginBottom: 14 }}>

        {/* Header band */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: `1px solid ${status_color}20`, background: `${status_color}08` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: status_color, boxShadow: `0 0 7px ${status_color}80`, flexShrink: 0 }} />
            <span style={{ fontSize: 18, fontWeight: 800, color: status_color, fontFamily: "'Inter', system-ui, sans-serif", letterSpacing: '-0.01em' }}>{status_text}</span>
            {bias && (
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: bias === 'long' ? '#00A86B' : bias === 'short' ? '#D0312D' : C.textTer, border: `1px solid ${bias === 'long' ? 'rgba(0,168,107,0.35)' : bias === 'short' ? 'rgba(208,49,45,0.35)' : C.border}`, background: bias === 'long' ? 'rgba(0,168,107,0.08)' : bias === 'short' ? 'rgba(208,49,45,0.08)' : 'var(--surface-raised)', borderRadius: 6, padding: '2px 8px' }}>
                {bias.charAt(0).toUpperCase() + bias.slice(1)}
              </span>
            )}
            {analysis.structure && (
              <span style={{ fontSize: 11, fontWeight: 600, color: C.textSec, background: 'var(--surface-raised)', border: `1px solid ${C.border}`, borderRadius: 6, padding: '2px 8px' }}>
                {unifiedStructureLabel(analysis.structure)}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: status_color, fontFamily: "'SF Mono', 'Fira Code', monospace", lineHeight: 1 }}>{analysis.confidence}</div>
              <div style={{ fontSize: 9, color: C.textTer, letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 2 }}>Setup</div>
            </div>
            <div style={{ width: 1, height: 28, background: C.border }} />
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: signal_quality.color, fontFamily: "'SF Mono', 'Fira Code', monospace", lineHeight: 1 }}>
                {signal_quality.score}<span style={{ fontSize: 13, fontWeight: 500, color: C.textTer }}>/10</span>
              </div>
              <div style={{ fontSize: 9, color: C.textTer, letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 2 }}>Signal</div>
            </div>
            {headerActions && (
              <>
                <div style={{ width: 1, height: 28, background: C.border }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{headerActions}</div>
              </>
            )}
          </div>
        </div>

        <div style={{ padding: '12px 16px' }}>
          {/* Key-level tiles (Entry / Stop / Target / R-R) */}
          {levels && levels.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${levels.length}, 1fr)`, gap: 8, marginBottom: 12 }}>
              {levels.map(l => (
                <div key={l.label} style={{ background: 'var(--surface-raised)', border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 10px' }}>
                  <div style={{ fontSize: 9.5, fontWeight: 700, color: C.textTer, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 3 }}>{l.label}</div>
                  <div style={{ fontSize: 15, fontWeight: 800, fontFamily: "'SF Mono', 'Fira Code', monospace", color: l.color }}>{l.value}</div>
                </div>
              ))}
            </div>
          )}

          {/* Reason */}
          <div className="uv-reason" style={{ fontSize: 12.5, color: C.textSec, lineHeight: 1.55, marginBottom: 12 }}>
            {analysis.reason || (analysis.entry_price ? 'Entry levels available.' : 'Setup conditions are being evaluated.')}
          </div>

          {/* Setup progress bar */}
          {analysis.conditions.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: C.textTer, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Conditions</span>
                <div style={{ display: 'flex', gap: 8, fontSize: 10 }}>
                  {pass_count > 0 && <span style={{ color: '#00A86B', fontWeight: 600 }}>{pass_count} pass</span>}
                  {warn_count > 0 && <span style={{ color: '#D4A017', fontWeight: 600 }}>{warn_count} warn</span>}
                  {fail_count > 0 && <span style={{ color: '#D0312D', fontWeight: 600 }}>{fail_count} fail</span>}
                </div>
              </div>
              <div style={{ height: 4, borderRadius: 2, background: 'var(--surface-muted)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${setup_bar_pct}%`, background: setup_bar_color, borderRadius: 2, transition: 'width 0.4s ease' }} />
              </div>
            </div>
          )}

          {/* Conditions chips */}
          {analysis.conditions.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 12 }}>
              {analysis.conditions.slice(0, 10).map((c, i) => (
                <span key={i} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10.5, padding: '3px 8px', borderRadius: 5,
                  border: `1px solid ${c.type === 'pass' ? 'rgba(0,168,107,0.35)' : c.type === 'warn' ? 'rgba(212,160,23,0.35)' : 'rgba(208,49,45,0.35)'}`,
                  color: c.type === 'pass' ? '#00A86B' : c.type === 'warn' ? '#D4A017' : '#D0312D',
                  background: c.type === 'pass' ? 'rgba(0,168,107,0.07)' : c.type === 'warn' ? 'rgba(212,160,23,0.07)' : 'rgba(208,49,45,0.07)',
                }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor', flexShrink: 0 }} />
                  {c.label}
                </span>
              ))}
            </div>
          )}

          {/* Risk profile chips */}
          {analysis.risk_profile.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
              {analysis.risk_profile.slice(0, 5).map((r, i) => {
                const sc = r.severity === 'HIGH' ? '#D0312D' : r.severity === 'MEDIUM' ? '#D4A017' : '#6B7280'
                return (
                  <span key={i} title={r.message} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, border: `1px solid ${sc}40`, color: sc, background: `${sc}10`, cursor: 'help' }}>
                    {r.type}
                  </span>
                )
              })}
            </div>
          )}

          {/* Psychology */}
          {analysis.psychology?.message && (
            <div style={{ fontSize: 11, color: C.textTer, fontStyle: 'italic', lineHeight: 1.45, marginBottom: 10, paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
              {analysis.psychology.message}
            </div>
          )}

          {/* Meta row */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11, color: C.textTer, paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
            <span>Risk: <span style={{ color: analysis.risk_level === 'LOW' ? '#00A86B' : analysis.risk_level === 'MEDIUM' ? '#D4A017' : '#D0312D', fontWeight: 600 }}>{analysis.risk_level || '—'}</span></span>
            {analysis.rr_ratio && <span>R/R: <span style={{ color: '#00A86B', fontWeight: 600, fontFamily: 'monospace' }}>{analysis.rr_ratio}</span></span>}
            <span>RVOL: <span style={{ color: C.text, fontFamily: 'monospace' }}>{analysis.rvol || '—'}</span></span>
          </div>
        </div>
      </div>
    )
  }

  // ─── Day / Regular layout ────────────────────────────────────────────
  return (
    <div className="uv-card" style={{ background: bg, border: `1px solid ${status_color}30`, borderRadius: 12, padding: '14px 18px', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: status_color, fontFamily: "'Inter', system-ui, sans-serif", lineHeight: 1.2 }}>{status_text}</span>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: status_color, fontFamily: "'SF Mono', 'Fira Code', monospace", lineHeight: 1.2 }}>{analysis.confidence}</div>
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
      {analysis.risk_profile.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6, marginBottom: 4 }}>
          {analysis.risk_profile.slice(0, 4).map((r, i) => {
            const sc = r.severity === 'HIGH' ? '#D0312D' : r.severity === 'MEDIUM' ? '#D4A017' : '#6B7280'
            return (
              <span key={i} title={r.message} style={{ fontSize: '0.55rem', padding: '2px 6px', borderRadius: 3, border: `1px solid ${sc}40`, color: sc, background: `${sc}10`, cursor: 'help' }}>
                {r.type}
              </span>
            )
          })}
        </div>
      )}
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
