import type { DayTradeScanResult, SwingTradeScanResult, AiCoachResult } from '../../api/client'
import type { DeskTradeLog } from '../../api/client'

type Analysis = (DayTradeScanResult & SwingTradeScanResult & { trade_type: string }) | null

interface Props {
  analysis: Analysis
  loading: boolean
  openTrade: DeskTradeLog | null
  tradeType: string
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

// SVG confidence ring
function ConfRing({ pct, color }: { pct: number; color: string }) {
  const r = 24
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - pct / 100)
  return (
    <svg width={60} height={60} style={{ flexShrink: 0 }}>
      <circle cx={30} cy={30} r={r} stroke={C.borderSub} strokeWidth={4} fill="none" />
      <circle
        cx={30} cy={30} r={r}
        stroke={color} strokeWidth={4} fill="none"
        strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90 30 30)"
      />
      <text x={30} y={27} textAnchor="middle" fill="#fff" fontSize={11} fontWeight={700} fontFamily="monospace">
        {pct}
      </text>
      <text x={30} y={39} textAnchor="middle" fill={C.muted} fontSize={8} fontFamily="monospace">
        CONF
      </text>
    </svg>
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
  analysis, loading, openTrade, tradeType,
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
  const entry = typeof eg?.breakout_level === 'number' ? eg.breakout_level : typeof eg?.current_price === 'number' ? eg.current_price : undefined
  const t1 = typeof eg?.scalp_target === 'number' ? eg.scalp_target : undefined
  const t2 = (analysis as unknown as Record<string, unknown>)?.scalp_target_2 as number | undefined
  const stop = typeof eg?.risk_below === 'number' ? eg.risk_below : undefined
  const structure = (analysis as unknown as Record<string, unknown>)?.structure as string | undefined

  const metrics = analysis.metrics as Record<string, unknown> | undefined
  const rvol = typeof metrics?.rvol === 'number' ? metrics.rvol : undefined
  const lastPrice = typeof metrics?.last_price === 'number' ? metrics.last_price : undefined

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

  const vc = verdictColor(verdict)
  const vbg = verdictBg(verdict)
  const vborder = verdictBorder(verdict)

  // Supporting factors / conditions
  const supportingFactors = analysis.supporting_factors || []
  const missingConfirmations = analysis.missing_confirmations || []

  const fmtP = (v: number | undefined) => v != null ? `$${v.toFixed(2)}` : '—'

  // Exit rules from entry_guidance
  const exitRules = eg?.exit_rules as Array<{ trigger: string; price: number; action: string; note?: string }> | undefined

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 24 }}>
      {refreshing && (
        <div style={{ textAlign: 'center', fontSize: '0.75rem', color: C.muted }}>Refreshing…</div>
      )}

      {/* 1. Verdict hero card */}
      <div style={{
        background: vbg, border: `1px solid ${vborder}`,
        borderRadius: 10, overflow: 'hidden',
        borderTop: `3px solid ${vc}`,
      }}>
        <div style={{ padding: '16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontSize: '3rem', fontWeight: 900, color: vc, lineHeight: 1, letterSpacing: '-0.02em' }}>
                {verdict}
              </div>
              <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: '0.85rem', marginTop: 8, lineHeight: 1.5, maxWidth: 380 }}>
                {reason}
              </p>
            </div>
            <ConfRing pct={confidence} color={vc} />
          </div>

          {/* Conditions chips */}
          {(supportingFactors.length > 0 || missingConfirmations.length > 0) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 14 }}>
              {supportingFactors.slice(0, 4).map((f, i) => (
                <span key={i} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  background: 'rgba(0,229,160,0.08)', border: '1px solid rgba(0,229,160,0.2)',
                  borderRadius: 20, padding: '3px 10px', fontSize: '0.72rem', color: C.green,
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.green, display: 'inline-block' }} />
                  {f}
                </span>
              ))}
              {missingConfirmations.slice(0, 2).map((f, i) => (
                <span key={i} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  background: 'rgba(245,166,35,0.08)', border: '1px solid rgba(245,166,35,0.2)',
                  borderRadius: 20, padding: '3px 10px', fontSize: '0.72rem', color: C.amber,
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.amber, display: 'inline-block' }} />
                  {f}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 2. Entry Plan + Risk Profile grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* Entry Plan */}
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 700, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
            Entry Plan
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
              <span style={{ color: C.muted }}>Entry</span>
              <span style={{ fontFamily: 'monospace', fontWeight: 700, color: C.green }}>{fmtP(entry)}</span>
            </div>
            {structure && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                <span style={{ color: C.muted }}>Structure</span>
                <span style={{ fontFamily: 'monospace', color: '#fff', maxWidth: 120, textAlign: 'right', fontSize: '0.75rem' }}>{structure}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
              <span style={{ color: C.muted }}>Stop</span>
              <span style={{ fontFamily: 'monospace', fontWeight: 700, color: C.red }}>{fmtP(stop)}</span>
            </div>
          </div>
        </div>

        {/* Risk Profile */}
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 700, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
            Risk Profile
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
              <span style={{ color: C.muted }}>R/R</span>
              <span style={{ fontFamily: 'monospace', fontWeight: 700, color: rr != null && rr >= 2 ? C.green : C.amber }}>
                {rr != null ? `${rr.toFixed(1)}:1` : '—'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
              <span style={{ color: C.muted }}>Risk Level</span>
              <span style={{ fontFamily: 'monospace', color: '#fff', fontSize: '0.75rem' }}>
                {analysis.risk_state || analysis.risk_level || '—'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
              <span style={{ color: C.muted }}>RVOL</span>
              <span style={{ fontFamily: 'monospace', fontWeight: 700, color: rvol != null && rvol >= 1.5 ? C.green : C.muted }}>
                {rvol != null ? `${rvol.toFixed(2)}×` : '—'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Exit Plan card */}
      <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px' }}>
        <div style={{ fontSize: '0.68rem', fontWeight: 700, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>
          Exit Plan — Pre-Committed
        </div>
        {exitRules && exitRules.length > 0 ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr>
                {['WHEN', 'PRICE', 'ACTION'].map(h => (
                  <th key={h} style={{ textAlign: 'left', color: C.muted, fontWeight: 600, paddingBottom: 6, fontSize: '0.68rem', letterSpacing: '0.06em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {exitRules.map((rule, i) => (
                <tr key={i}>
                  <td style={{ paddingBottom: 4, color: '#fff', fontFamily: 'monospace', fontSize: '0.75rem' }}>{rule.trigger}</td>
                  <td style={{ paddingBottom: 4, fontFamily: 'monospace', fontWeight: 700, color: rule.trigger.toLowerCase().includes('stop') ? C.red : C.green }}>{fmtP(rule.price)}</td>
                  <td style={{ paddingBottom: 4, color: C.muted, fontSize: '0.75rem' }}>{rule.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr>
                {['WHEN', 'PRICE', 'ACTION'].map(h => (
                  <th key={h} style={{ textAlign: 'left', color: C.muted, fontWeight: 600, paddingBottom: 6, fontSize: '0.68rem', letterSpacing: '0.06em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {t1 != null && (
                <tr>
                  <td style={{ paddingBottom: 4, color: '#fff', fontFamily: 'monospace', fontSize: '0.75rem' }}>T1 Hit</td>
                  <td style={{ paddingBottom: 4, fontFamily: 'monospace', fontWeight: 700, color: C.green }}>{fmtP(t1)}</td>
                  <td style={{ paddingBottom: 4, color: C.muted, fontSize: '0.75rem' }}>Sell 50%, trail rest</td>
                </tr>
              )}
              {t2 != null && (
                <tr>
                  <td style={{ paddingBottom: 4, color: '#fff', fontFamily: 'monospace', fontSize: '0.75rem' }}>T2 Hit</td>
                  <td style={{ paddingBottom: 4, fontFamily: 'monospace', fontWeight: 700, color: C.green }}>{fmtP(t2)}</td>
                  <td style={{ paddingBottom: 4, color: C.muted, fontSize: '0.75rem' }}>Full exit</td>
                </tr>
              )}
              {stop != null && (
                <tr>
                  <td style={{ paddingBottom: 4, color: '#fff', fontFamily: 'monospace', fontSize: '0.75rem' }}>Stop</td>
                  <td style={{ paddingBottom: 4, fontFamily: 'monospace', fontWeight: 700, color: C.red }}>{fmtP(stop)}</td>
                  <td style={{ paddingBottom: 4, color: C.muted, fontSize: '0.75rem' }}>Full exit, no averaging</td>
                </tr>
              )}
              {tradeType === 'day' && (
                <tr>
                  <td style={{ paddingBottom: 0, color: '#fff', fontFamily: 'monospace', fontSize: '0.75rem' }}>EOD</td>
                  <td style={{ paddingBottom: 0, fontFamily: 'monospace', fontWeight: 700, color: C.muted }}>{lastPrice != null ? fmtP(lastPrice) : 'Close'}</td>
                  <td style={{ paddingBottom: 0, color: C.muted, fontSize: '0.75rem' }}>Close all before 4 PM</td>
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
