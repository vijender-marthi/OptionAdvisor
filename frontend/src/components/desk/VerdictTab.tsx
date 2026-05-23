import { useMemo } from 'react'
import type { DayTradeScanResult, SwingTradeScanResult, AiCoachResult } from '../../api/client'
import type { DeskTradeLog } from '../../api/client'

type Analysis = (DayTradeScanResult & SwingTradeScanResult & { trade_type: string }) | null

interface Props {
  analysis: Analysis
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

type Verdict = 'ENTER' | 'WATCH' | 'WAIT' | 'AVOID'

function normalizeVerdict(raw: string): Verdict {
  const u = (raw || '').toUpperCase()
  if (u.includes('ENTER') || u.includes('READY') || u === 'GO' || u === 'STRONG GO') return 'ENTER'
  if (u.includes('WATCH')) return 'WATCH'
  if (u.includes('WAIT')) return 'WAIT'
  return 'AVOID'
}

function verdictColor(v: Verdict): string {
  return v === 'ENTER' ? C.green : v === 'WATCH' ? C.amber : v === 'WAIT' ? C.purple : C.red
}

function verdictBg(v: Verdict): string {
  return v === 'ENTER' ? 'rgba(0,229,160,0.07)' : v === 'WATCH' ? 'rgba(245,166,35,0.07)' : v === 'WAIT' ? 'rgba(107,127,212,0.07)' : 'rgba(255,77,109,0.07)'
}

function verdictBorder(v: Verdict): string {
  return v === 'ENTER' ? 'rgba(0,229,160,0.25)' : v === 'WATCH' ? 'rgba(245,166,35,0.25)' : v === 'WAIT' ? 'rgba(107,127,212,0.25)' : 'rgba(255,77,109,0.25)'
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

  // Parse data
  const verdict = normalizeVerdict(analysis.final_decision || analysis.verdict || '')
  const confidence = typeof analysis.confidence === 'number' ? Math.round(analysis.confidence) : 0
  const reason = (analysis as unknown as Record<string, unknown>)?.trader_decision && typeof ((analysis as unknown as Record<string, unknown>).trader_decision as Record<string, unknown>)?.decision_message === 'string'
    ? ((analysis as unknown as Record<string, unknown>).trader_decision as Record<string, unknown>).decision_message as string
    : analysis.reason || ''

  const eg = analysis.entry_guidance as Record<string, unknown> | undefined
  const raw = analysis as unknown as Record<string, unknown>
  const metricsRaw = analysis.metrics as Record<string, unknown> | undefined
  const execLevels = metricsRaw?.exec_levels as Record<string, unknown> | undefined

  // Entry — day: entry_guidance.breakout_level / current_price; swing: metrics.exec_levels.breakout
  const entry: number | undefined =
    (typeof eg?.breakout_level === 'number' ? eg.breakout_level : undefined)
    ?? (typeof eg?.current_price === 'number' ? eg.current_price : undefined)
    ?? (typeof execLevels?.breakout === 'number' ? execLevels.breakout as number : undefined)
    ?? (typeof raw.swing_entry === 'number' ? raw.swing_entry as number : undefined)
    ?? (typeof execLevels?.entry === 'number' ? execLevels.entry as number : undefined)
    ?? (typeof raw.planned_entry === 'number' ? raw.planned_entry as number : undefined)
    ?? undefined

  // T1 — day: entry_guidance.scalp_target; swing: metrics.exec_levels.target1
  const t1: number | undefined =
    (typeof eg?.scalp_target === 'number' ? eg.scalp_target : undefined)
    ?? (typeof execLevels?.target1 === 'number' ? execLevels.target1 as number : undefined)
    ?? (typeof raw.take_profit_1 === 'number' ? raw.take_profit_1 as number : undefined)
    ?? (typeof raw.swing_t1 === 'number' ? raw.swing_t1 as number : undefined)
    ?? undefined

  // T2 — day: entry_guidance.scalp_target_2; swing: metrics.exec_levels.target2
  const t2: number | undefined =
    (typeof eg?.scalp_target_2 === 'number' ? eg.scalp_target_2 : undefined)
    ?? (typeof execLevels?.target2 === 'number' ? execLevels.target2 as number : undefined)
    ?? (typeof raw.take_profit_2 === 'number' ? raw.take_profit_2 as number : undefined)
    ?? (typeof raw.swing_t2 === 'number' ? raw.swing_t2 as number : undefined)
    ?? undefined

  // Stop — day: entry_guidance.risk_below; swing: metrics.exec_levels.stop
  const stop: number | undefined =
    (typeof eg?.risk_below === 'number' ? eg.risk_below : undefined)
    ?? (typeof execLevels?.stop === 'number' ? execLevels.stop as number : undefined)
    ?? (typeof raw.swing_stop === 'number' ? raw.swing_stop as number : undefined)
    ?? (typeof raw.planned_stop === 'number' ? raw.planned_stop as number : undefined)
    ?? undefined

  const structure = raw?.structure as string | undefined
    ?? raw?.suggested_strategy as string | undefined
    ?? raw?.final_action as string | undefined

  const rvol = typeof metricsRaw?.rvol === 'number' ? metricsRaw.rvol
    : typeof metricsRaw?.volume_ratio === 'number' ? metricsRaw.volume_ratio as number
    : undefined
  const lastPrice = typeof metricsRaw?.last_price === 'number' ? metricsRaw.last_price : undefined

  // AI coach
  const aiCoachRaw = (analysis as unknown as Record<string, unknown>)?.ai_coach
  let coachText = ''
  if (typeof aiCoachRaw === 'string') coachText = aiCoachRaw
  else if (aiCoachRaw && typeof (aiCoachRaw as Record<string, unknown>).summary === 'string') {
    coachText = (aiCoachRaw as AiCoachResult).summary
  } else if (aiCoachRaw && typeof (aiCoachRaw as Record<string, unknown>).best_next_step === 'string') {
    coachText = (aiCoachRaw as AiCoachResult).best_next_step
  } else if (aiCoachRaw && typeof (aiCoachRaw as Record<string, unknown>).message === 'string') {
    coachText = (aiCoachRaw as Record<string, unknown>).message as string
  }

  // R/R
  let rr: number | undefined
  if (entry != null && t1 != null && stop != null && stop < entry) {
    rr = (t1 - entry) / (entry - stop)
  }

  // Waiting-for reason when verdict is WAIT
  const waitingFor = useMemo(() => {
    if (!analysis) return null
    if (verdict !== 'WAIT') return null
    const raw = analysis as unknown as Record<string, unknown>
    const conditions = (raw.conditions as Array<Record<string, unknown>> | undefined) || []
    const missing = (analysis.missing_confirmations || []) as string[]
    // Prefer missing_confirmations, fall back to warn/fail conditions
    const items: string[] = missing.length > 0
      ? missing
      : conditions
          .filter(c => c.type === 'warn' || c.type === 'fail')
          .map(c => String(c.label || ''))
    const shortened = items
      .map(s => s.split('—')[0].split(':')[0].split('(')[0].trim())
      .filter(Boolean)
      .slice(0, 2)
    return shortened.length > 0 ? shortened.join(' · ') : null
  }, [analysis, verdict])

  const vc = verdictColor(verdict)
  const vbg = verdictBg(verdict)
  const vborder = verdictBorder(verdict)

  // Supporting factors / conditions
  const supportingFactors = analysis.supporting_factors || []
  const missingConfirmations = analysis.missing_confirmations || []

  const fmtP = (v: number | undefined) => v != null ? `$${v.toFixed(2)}` : '—'

  // Shorten condition chip labels to ≤ 4 words
  function shortenLabel(raw: string): string {
    // Remove trailing parenthetical like "(range-bound)" or "(stock short...)"
    let s = raw.replace(/\s*\(.*?\)\s*$/, '').trim()
    // Take only the part before " — " or " - " or ":"
    s = s.split(/\s+[—–-]\s+/)[0].split(':')[0].trim()
    // Capitalize first letter
    s = s.charAt(0).toUpperCase() + s.slice(1)
    // If still > 5 words, take first 4
    const words = s.split(/\s+/)
    if (words.length > 4) s = words.slice(0, 4).join(' ')
    return s
  }

  // Exit rules — from entry_guidance (day) or metrics.exit_rules (swing)
  const exitRules: Array<{ trigger: string; price: number; action: string; note?: string }> | undefined =
    (eg?.exit_rules as Array<{ trigger: string; price: number; action: string; note?: string }> | undefined)
    ?? (metricsRaw?.exit_rules as Array<{ trigger: string; price: number; action: string; note?: string }> | undefined)

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
        boxShadow: verdict === 'ENTER' ? '0 0 40px rgba(0,229,160,0.15)' : undefined,
      }}>
        <div style={{ padding: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
            <div>
              <div style={{
                fontFamily: "'Syne', sans-serif",
                fontSize: '3rem', fontWeight: 800, color: vc,
                lineHeight: 1, letterSpacing: '-0.03em',
              }}>
                {verdict}
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
          {(supportingFactors.length > 0 || missingConfirmations.length > 0) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {supportingFactors.map((f, i) => (
                <span key={`pass-${i}`} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 20, padding: '4px 10px', fontSize: '0.72rem', fontWeight: 500,
                  color: 'rgba(232,235,240,0.7)', whiteSpace: 'nowrap',
                }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.green, flexShrink: 0, display: 'inline-block' }} />
                  {shortenLabel(f)}
                </span>
              ))}
              {missingConfirmations.map((f, i) => (
                <span key={`warn-${i}`} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 20, padding: '4px 10px', fontSize: '0.72rem', fontWeight: 500,
                  color: 'rgba(245,166,35,0.8)', whiteSpace: 'nowrap',
                }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.amber, flexShrink: 0, display: 'inline-block' }} />
                  {shortenLabel(f)}
                </span>
              ))}
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
            { label: 'Entry', value: <span style={{ fontFamily: 'monospace', color: C.amber, fontSize: '0.75rem' }}>Wait — no valid entry yet</span> },
            { label: 'Structure', value: <span style={{ fontFamily: 'monospace', color: C.muted, fontSize: '0.75rem' }}>No trade</span> },
            { label: 'Stop Loss', value: <span style={{ fontFamily: 'monospace', color: C.muted, fontSize: '0.75rem' }}>Not defined until setup forms</span> },
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

        {/* Risk Profile */}
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 700, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
            Risk Profile
          </div>
          {[
            { label: 'R/R Ratio', value: <span style={{ fontFamily: 'monospace', color: C.muted, fontSize: '0.75rem' }}>—</span> },
            { label: 'Risk Level', value: <span style={{ fontFamily: 'monospace', color: C.red, fontWeight: 700, fontSize: '0.75rem' }}>HIGH</span> },
            { label: 'RVOL', value: <span style={{ fontFamily: 'monospace', fontWeight: 700, color: C.muted, fontSize: '0.75rem' }}>0.8x</span> },
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
        {exitRules && exitRules.length > 0 ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr>
                {['WHEN', 'PRICE', 'ACTION'].map(h => (
                  <th key={h} style={{ textAlign: 'left', color: C.muted, fontWeight: 600, paddingBottom: 8, fontSize: '0.68rem', letterSpacing: '0.06em', borderBottom: `1px solid ${C.border}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {exitRules.map((rule, i) => (
                <tr key={i} className="desk-exit-row">
                  <td style={{ paddingTop: 8, paddingBottom: 8, color: '#fff', fontFamily: 'monospace', fontSize: '0.75rem' }}>{rule.trigger}</td>
                  <td style={{ paddingTop: 8, paddingBottom: 8, fontFamily: 'monospace', fontWeight: 700, color: rule.trigger.toLowerCase().includes('stop') ? C.red : C.green }}>{fmtP(rule.price)}</td>
                  <td style={{ paddingTop: 8, paddingBottom: 8, color: C.muted, fontSize: '0.75rem' }}>{rule.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr>
                {['WHEN', 'PRICE', 'ACTION'].map(h => (
                  <th key={h} style={{ textAlign: 'left', color: C.muted, fontWeight: 600, paddingBottom: 8, fontSize: '0.68rem', letterSpacing: '0.06em', borderBottom: `1px solid ${C.border}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {t1 != null && (
                <tr className="desk-exit-row">
                  <td style={{ paddingTop: 8, paddingBottom: 8, color: '#fff', fontFamily: 'monospace', fontSize: '0.75rem' }}>T1 Hit</td>
                  <td style={{ paddingTop: 8, paddingBottom: 8, fontFamily: 'monospace', fontWeight: 700, color: C.green }}>{fmtP(t1)}</td>
                  <td style={{ paddingTop: 8, paddingBottom: 8, color: C.muted, fontSize: '0.75rem' }}>Sell 50%, trail rest</td>
                </tr>
              )}
              {t2 != null && (
                <tr className="desk-exit-row">
                  <td style={{ paddingTop: 8, paddingBottom: 8, color: '#fff', fontFamily: 'monospace', fontSize: '0.75rem' }}>T2 Hit</td>
                  <td style={{ paddingTop: 8, paddingBottom: 8, fontFamily: 'monospace', fontWeight: 700, color: C.green }}>{fmtP(t2)}</td>
                  <td style={{ paddingTop: 8, paddingBottom: 8, color: C.muted, fontSize: '0.75rem' }}>Full exit</td>
                </tr>
              )}
              {stop != null && (
                <tr className="desk-exit-row">
                  <td style={{ paddingTop: 8, paddingBottom: 8, color: '#fff', fontFamily: 'monospace', fontSize: '0.75rem' }}>Stop</td>
                  <td style={{ paddingTop: 8, paddingBottom: 8, fontFamily: 'monospace', fontWeight: 700, color: C.red }}>{fmtP(stop)}</td>
                  <td style={{ paddingTop: 8, paddingBottom: 8, color: C.muted, fontSize: '0.75rem' }}>Full exit, no averaging</td>
                </tr>
              )}
              {tradeType === 'day' && (
                <tr className="desk-exit-row">
                  <td style={{ paddingTop: 8, paddingBottom: 8, color: '#fff', fontFamily: 'monospace', fontSize: '0.75rem' }}>EOD</td>
                  <td style={{ paddingTop: 8, paddingBottom: 8, fontFamily: 'monospace', fontWeight: 700, color: C.muted }}>{lastPrice != null ? fmtP(lastPrice) : 'Close'}</td>
                  <td style={{ paddingTop: 8, paddingBottom: 8, color: C.muted, fontSize: '0.75rem' }}>Close all before 4 PM</td>
                </tr>
              )}
              {(t1 == null && t2 == null && stop == null) && (
                <tr>
                  <td colSpan={3} style={{ color: C.muted, textAlign: 'center', padding: '8px 0', fontSize: '0.8rem' }}>
                    Run full analysis for detailed exit levels
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* 4. AI Coach card */}
      {coachText && (
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
              dangerouslySetInnerHTML={{ __html: coachText.replace(/\*\*(.*?)\*\*/g, '<strong style="color:#fff">$1</strong>') }}
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
