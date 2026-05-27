import { useMemo } from 'react'
import type { UnifiedAnalysis } from '../../api/client'
import type { DeskTradeLog } from '../../api/client'

interface Props {
  analysis: UnifiedAnalysis | null
  loading: boolean
  openTrade: DeskTradeLog | null
  tradeType: string
  compact?: boolean
  onLogTrade: () => void
  onSetAlert: () => void
  onRefresh: () => void
  refreshing: boolean
  onNavigateFullAnalysis: () => void
  ticker: string
}

const C = {
  bgPage:    '#0A0C10',
  bgPanel:   '#111318',
  bgCard:    '#181C23',
  border:    '#1E2330',
  borderSub: '#252C3A',
  muted:     '#5A6478',
  accent:    '#4A7CFF',
  green:     '#00E5A0',
  red:       '#FF4D6D',
  amber:     '#F5A623',
  purple:    '#6B7FD4',
}

type Verdict = 'STRONG_GO' | 'GO' | 'WATCH' | 'WAIT' | 'AVOID' | 'NO_EDGE'

function mapVerdict(raw: string): Verdict {
  const v = (raw || '').toUpperCase().replace(/ /g, '_')
  if (v === 'STRONG_GO')                         return 'STRONG_GO'
  if (['GO', 'ENTER', 'READY', 'TRADE'].includes(v)) return 'GO'
  if (v === 'WATCH')                             return 'WATCH'
  if (v === 'WAIT')                              return 'WAIT'
  if (['AVOID', 'NO_GO', 'NO_TRADE'].includes(v)) return 'AVOID'
  return 'NO_EDGE'
}

function verdictLabel(v: Verdict): string {
  if (v === 'STRONG_GO') return 'STRONG GO'
  if (v === 'GO')        return 'GO — ENTER NOW'
  if (v === 'NO_EDGE')   return 'NO EDGE'
  return v
}

function verdictColor(v: Verdict): string {
  if (v === 'STRONG_GO' || v === 'GO') return C.green
  if (v === 'WATCH')   return C.amber
  if (v === 'WAIT')    return C.purple
  return C.red
}

function verdictBg(v: Verdict): string {
  if (v === 'STRONG_GO' || v === 'GO') return 'rgba(0,229,160,0.07)'
  if (v === 'WATCH')   return 'rgba(245,166,35,0.07)'
  if (v === 'WAIT')    return 'rgba(107,127,212,0.07)'
  return 'rgba(255,77,109,0.07)'
}

function verdictBorder(v: Verdict): string {
  if (v === 'STRONG_GO' || v === 'GO') return 'rgba(0,229,160,0.25)'
  if (v === 'WATCH')   return 'rgba(245,166,35,0.25)'
  if (v === 'WAIT')    return 'rgba(107,127,212,0.25)'
  return 'rgba(255,77,109,0.25)'
}

// SVG confidence ring — matches HTML prototype exactly (64×64, r=26)
function ConfRing({ pct, color }: { pct: number; color: string }) {
  const r = 26
  const circ = 2 * Math.PI * r
  const offset = circ - (pct / 100) * circ
  return (
    <div style={{ position: 'relative', width: 64, height: 64, flexShrink: 0 }}>
      <svg
        viewBox="0 0 64 64"
        width={64} height={64}
        style={{ transform: 'rotate(-90deg)', display: 'block' }}
      >
        <circle cx={32} cy={32} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={4} />
        <circle
          cx={32} cy={32} r={r} fill="none"
          stroke={color} strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
        />
      </svg>
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        fontFamily: 'monospace', fontSize: '0.72rem', fontWeight: 700,
        color: '#E8EBF0', textAlign: 'center', lineHeight: 1.2,
      }}>
        {pct}<br />
        <span style={{ fontSize: '0.55rem', color: C.muted }}>CONF</span>
      </div>
    </div>
  )
}

// Skeleton shimmer
function Skeleton({ h = 80 }: { h?: number }) {
  return (
    <div style={{
      height: h, borderRadius: 10, background: `linear-gradient(90deg, ${C.bgCard} 25%, ${C.bgPanel} 50%, ${C.bgCard} 75%)`,
      backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite',
      border: `1px solid ${C.border}`, marginBottom: 12,
    }} />
  )
}

function fmtP(v: number | null | undefined): string {
  return v != null ? `$${v.toFixed(2)}` : '—'
}

function exitRowColor(type: string): string {
  if (type === 't1') return C.green
  if (type === 't2') return 'rgba(0,229,160,0.6)'
  if (type === 'stop') return C.red
  return C.muted
}

export default function VerdictTab({
  analysis, loading, openTrade, tradeType, compact = false,
  onLogTrade, onSetAlert, onRefresh, refreshing,
  onNavigateFullAnalysis, ticker,
}: Props) {
  // Loading state
  if (loading) {
    return (
      <div>
        <style>{`@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
        <Skeleton h={120} />
        <Skeleton h={80} />
        <Skeleton h={100} />
        <Skeleton h={80} />
      </div>
    )
  }

  // Empty state
  if (!analysis) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 320, gap: 12 }}>
        <span style={{ fontSize: '3rem' }}>📊</span>
        <p style={{ color: C.muted, fontSize: '0.95rem' }}>Add a ticker to get started</p>
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          {['ARM', 'NVDA'].map(t => (
            <button
              key={t}
              type="button"
              onClick={onRefresh}
              style={{
                background: C.bgCard, border: `1px solid ${C.borderSub}`,
                color: C.accent, borderRadius: 8, padding: '6px 14px',
                fontSize: '0.8rem', fontFamily: 'monospace', cursor: 'pointer',
              }}
            >
              Try {t} →
            </button>
          ))}
        </div>
      </div>
    )
  }

  const verdict = mapVerdict(analysis.verdict)
  const confidence = Math.round(analysis.confidence)
  const reason = analysis.reason
  const conditions = analysis.conditions || []
  const exitRows = analysis.exit_rows || []

  // Waiting-for reason when verdict is WAIT
  const waitingFor = useMemo(() => {
    if (verdict !== 'WAIT') return null
    const items = conditions
      .filter(c => c.type === 'warn' || c.type === 'fail')
      .map(c => c.label)
      .filter(Boolean)
      .slice(0, 2)
    return items.length > 0 ? items.join(' · ') : null
  }, [conditions, verdict])

  const vc = verdictColor(verdict)
  const vbg = verdictBg(verdict)
  const vborder = verdictBorder(verdict)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 24 }}>
      <style>{`@keyframes tdPulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.3 } }`}</style>
      {refreshing && (
        <div style={{ textAlign: 'center', fontSize: '0.75rem', color: C.muted }}>Refreshing…</div>
      )}

      {/* 1. Verdict hero card */}
      <div style={{
        background: vbg, border: `1px solid ${vborder}`,
        borderRadius: 16, overflow: 'hidden', position: 'relative',
        borderTop: `3px solid ${vc}`,
        boxShadow: verdict === 'GO' || verdict === 'STRONG_GO' ? '0 0 40px rgba(0,229,160,0.15)' : undefined,
      }}>
        <div style={{ padding: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
            <div>
              <div style={{
                fontFamily: "'Syne', sans-serif",
                fontSize: '3rem', fontWeight: 800, color: vc,
                lineHeight: 1, letterSpacing: '-0.03em',
              }}>
                {verdictLabel(verdict)}
              </div>
            </div>
            <ConfRing pct={confidence} color={vc} />
          </div>

          {/* Waiting-for indicator (WAIT verdict only) */}
          {verdict === 'WAIT' && waitingFor && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: '0.78rem', color: C.purple }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.purple, flexShrink: 0, animation: 'tdPulse 1.5s infinite' }} />
              <span>Waiting for: {waitingFor}</span>
            </div>
          )}

          <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: '0.95rem', lineHeight: 1.6, marginBottom: 16 }}>
            {reason}
          </p>

          {/* Conditions chips */}
          {conditions.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {conditions.map((c, i) => {
                const dotColor = c.type === 'pass' ? C.green : c.type === 'warn' ? C.amber : C.red
                const textColor = c.type === 'pass' ? 'rgba(232,235,240,0.7)' : c.type === 'warn' ? 'rgba(245,166,35,0.8)' : 'rgba(255,77,109,0.8)'
                return (
                  <span key={i} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 20, padding: '4px 10px', fontSize: '0.72rem', fontWeight: 500,
                    color: textColor, whiteSpace: 'nowrap',
                  }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: dotColor, flexShrink: 0, display: 'inline-block' }} />
                    {c.label}
                  </span>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* 2. Entry Plan + Risk Profile grid */}
      <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : '1fr 1fr', gap: 12 }}>
        {/* Entry Plan */}
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 700, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
            Entry Plan
          </div>
          {[
            {
              label: 'Entry',
              value: analysis.entry_price != null
                ? <span style={{ fontFamily: 'monospace', color: C.amber, fontSize: '0.75rem' }}>{fmtP(analysis.entry_price)}</span>
                : <span style={{ fontFamily: 'monospace', color: C.muted, fontSize: '0.75rem' }}>—</span>,
              sub: analysis.entry_price == null ? 'No entry — wait for setup' : analysis.entry_description || undefined,
            },
            {
              label: 'Structure',
              value: <span style={{ fontFamily: 'monospace', color: C.muted, fontSize: '0.75rem' }}>{analysis.structure || '—'}</span>,
              sub: undefined,
            },
            {
              label: 'Stop Loss',
              value: analysis.stop_price != null
                ? <span style={{ fontFamily: 'monospace', color: C.red, fontSize: '0.75rem' }}>{fmtP(analysis.stop_price)}</span>
                : <span style={{ fontFamily: 'monospace', color: C.muted, fontSize: '0.75rem' }}>—</span>,
              sub: analysis.stop_price == null ? undefined : analysis.stop_description || undefined,
            },
          ].map((row, i) => (
            <div key={row.label} style={{
              display: 'flex', flexDirection: 'column',
              fontSize: '0.82rem', padding: '5px 0',
              borderBottom: i < 2 ? `1px solid ${C.border}` : 'none',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: C.muted }}>{row.label}</span>
                {row.value}
              </div>
              {row.sub && (
                <span style={{ color: C.muted, fontSize: '0.68rem', marginTop: 2 }}>{row.sub}</span>
              )}
            </div>
          ))}
        </div>

        {/* Risk Profile */}
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 700, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
            Risk Profile
          </div>
          {[
            {
              label: 'R/R Ratio',
              value: <span style={{ fontFamily: 'monospace', color: C.muted, fontSize: '0.75rem' }}>{analysis.rr_ratio || '—'}</span>,
            },
            {
              label: 'Risk Level',
              value: (
                <span style={{
                  fontFamily: 'monospace', fontWeight: 700, fontSize: '0.75rem',
                  color: analysis.risk_level === 'LOW' ? C.green : analysis.risk_level === 'MEDIUM' ? C.amber : C.red,
                }}>
                  {analysis.risk_level || '—'}
                </span>
              ),
            },
            {
              label: 'RVOL',
              value: <span style={{ fontFamily: 'monospace', fontWeight: 700, color: C.muted, fontSize: '0.75rem' }}>{analysis.rvol || '—'}</span>,
            },
          ].map((row, i) => (
            <div key={row.label} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              fontSize: '0.82rem', padding: '5px 0',
              borderBottom: i < 2 ? `1px solid ${C.border}` : 'none',
            }}>
              <span style={{ color: C.muted }}>{row.label}</span>
              {row.value}
            </div>
          ))}
        </div>
      </div>

      {/* 3. Exit Plan card */}
      <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px' }}>
        <style>{`
          .desk-exit-row { border-bottom: 1px solid #1E2330; }
          .desk-exit-row:last-child { border-bottom: none; }
        `}</style>
        <div style={{ fontSize: '0.68rem', fontWeight: 700, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>
          Exit Plan — Pre-Committed
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
          <thead>
            <tr>
              {['WHEN', 'PRICE', 'ACTION'].map(h => (
                <th key={h} style={{ textAlign: 'left', color: C.muted, fontWeight: 600, paddingBottom: 8, fontSize: '0.68rem', letterSpacing: '0.06em', borderBottom: `1px solid ${C.border}` }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {exitRows.length > 0 ? exitRows.map((row, i) => (
              <tr key={i} className="desk-exit-row">
                <td style={{ paddingTop: 8, paddingBottom: 8, color: '#fff', fontFamily: 'monospace', fontSize: '0.75rem' }}>{row.when}</td>
                <td style={{ paddingTop: 8, paddingBottom: 8, fontFamily: 'monospace', fontWeight: 700, color: exitRowColor(row.type) }}>{row.price}</td>
                <td style={{ paddingTop: 8, paddingBottom: 8, color: C.muted, fontSize: '0.75rem' }}>{row.action}</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={3} style={{ color: C.muted, textAlign: 'center', padding: '8px 0', fontSize: '0.8rem' }}>
                  Run analysis for exit levels
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 4. AI Coach card */}
      {analysis.coach && (
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px', display: 'flex', gap: 14 }}>
          <div style={{
            width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
            background: 'rgba(74,124,255,0.12)', border: '1px solid rgba(74,124,255,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem',
          }}>
            🎯
          </div>
          <div>
            <div style={{ fontSize: '0.68rem', fontWeight: 700, color: C.accent, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
              AI Coach
            </div>
            <div
              style={{ color: C.muted, fontSize: '0.82rem', lineHeight: 1.6 }}
              dangerouslySetInnerHTML={{ __html: analysis.coach.replace(/\*\*(.*?)\*\*/g, '<strong style="color:#fff">$1</strong>') }}
            />
          </div>
        </div>
      )}

      {/* 5. Action buttons */}
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          type="button"
          onClick={onLogTrade}
          style={{
            flex: 1, padding: '10px 0', borderRadius: 10, fontWeight: 700, fontSize: '0.88rem',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            ...(openTrade
              ? { background: 'transparent', border: `1px solid ${C.accent}`, color: C.accent }
              : { background: C.accent, border: `1px solid ${C.accent}`, color: '#fff' }),
          }}
        >
          📋 {openTrade ? 'Update Open Trade' : 'Log This Trade'}
        </button>
        <button
          type="button"
          onClick={onSetAlert}
          style={{
            flex: 1, padding: '10px 0', borderRadius: 10, fontWeight: 700, fontSize: '0.88rem',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            background: 'transparent', border: `1px solid ${C.borderSub}`, color: '#fff',
          }}
        >
          🔔 Set Alert
        </button>
      </div>

      {/* 6. View full analysis link */}
      {ticker && (
        <button
          type="button"
          onClick={onNavigateFullAnalysis}
          style={{
            background: 'transparent',
            border: `1px dashed ${C.borderSub}`,
            borderRadius: 8, padding: '10px 0', color: C.muted,
            fontSize: '0.78rem', cursor: 'pointer', textAlign: 'center', width: '100%',
          }}
        >
          View full 6-step analysis for {ticker} ↗
        </button>
      )}
    </div>
  )
}
