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

type ExitRow = { when: string; price: string; action: string; note?: string; type: string }

const EXIT_META: Record<string, { icon: string; label: string; bg: string; border: string; priceCls: string; labelCls: string }> = {
  t1:   { icon: '🎯', label: 'Target 1',  bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.25)', priceCls: 'text-emerald-400', labelCls: 'text-emerald-500' },
  t2:   { icon: '🚀', label: 'Target 2',  bg: 'rgba(16,185,129,0.05)', border: 'rgba(16,185,129,0.15)', priceCls: 'text-emerald-300', labelCls: 'text-emerald-600' },
  stop: { icon: '🛑', label: 'Stop Loss', bg: 'rgba(239,68,68,0.08)',  border: 'rgba(239,68,68,0.25)',  priceCls: 'text-red-400',     labelCls: 'text-red-500' },
  time: { icon: '⏱',  label: 'Time Exit', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.25)', priceCls: 'text-amber-400',   labelCls: 'text-amber-500' },
  none: { icon: '📋', label: 'Note',      bg: 'rgba(99,102,241,0.06)', border: 'rgba(99,102,241,0.15)', priceCls: 'text-indigo-300',  labelCls: 'text-indigo-400' },
}

function ExitPlanCard({ exitRows }: { exitRows: ExitRow[] }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-gray-800 flex items-center gap-2">
        <span className="text-sm">🚪</span>
        <span className="text-[11px] font-bold uppercase tracking-widest text-gray-400">Exit Plan — Pre-Committed</span>
      </div>

      {exitRows.length === 0 ? (
        <div className="px-4 py-5 text-center text-xs text-gray-600">
          Run analysis for exit levels
        </div>
      ) : (
        <div className="divide-y divide-gray-800/60">
          {exitRows.map((row, i) => {
            const meta = EXIT_META[row.type] ?? EXIT_META.none!
            return (
              <div
                key={i}
                className="flex items-start gap-3 px-4 py-3"
                style={{ background: meta.bg }}
              >
                {/* Left: icon + type label */}
                <div className="flex flex-col items-center gap-1 pt-0.5 min-w-[44px]">
                  <span className="text-base leading-none">{meta.icon}</span>
                  <span className={`text-[9px] font-bold uppercase tracking-wider ${meta.labelCls}`}>{meta.label}</span>
                </div>

                {/* Divider */}
                <div className="w-px self-stretch bg-gray-800/80 shrink-0" />

                {/* Middle: when + note */}
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-gray-200 font-medium leading-snug">{row.when}</div>
                  {row.action && (
                    <div className="text-[11px] text-gray-500 mt-0.5 leading-snug">{row.action}</div>
                  )}
                  {row.note && (
                    <div className="text-[10px] text-gray-600 mt-1 leading-snug italic">{row.note}</div>
                  )}
                </div>

                {/* Right: price pill */}
                <div
                  className={`shrink-0 rounded-lg px-2.5 py-1 font-mono font-bold text-sm tabular-nums border ${meta.priceCls}`}
                  style={{ borderColor: meta.border, background: 'rgba(0,0,0,0.3)' }}
                >
                  {row.price || '—'}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Footer risk reminder */}
      {exitRows.length > 0 && (
        <div className="px-4 py-2 border-t border-gray-800 flex items-center gap-1.5 bg-gray-950/30">
          <span className="text-[10px]">⚠️</span>
          <span className="text-[10px] text-gray-600 leading-snug">
            Set orders before entry. Never move your stop against the position.
          </span>
        </div>
      )}
    </div>
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
      <ExitPlanCard exitRows={exitRows} />

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
