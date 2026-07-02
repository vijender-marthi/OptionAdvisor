/**
 * Day Trade Strategies Tab — comprehensive reference for entry/exit strategies,
 * signals to watch, timing, risk management, and multi-day hold guidance (up to 5 days).
 *
 * Covers both intraday (flat by close) and multi-day hold (overnight runners up to 5 sessions)
 * strategies, reflecting volatile environments where holding 1-5 days captures bigger moves.
 *
 * All times are converted from ET (market time) to the user's selected timezone from Settings.
 */
import { useState, useEffect } from 'react'
import {
  Activity, AlertTriangle, ArrowDown, ArrowUp, BarChart2, Clock, Flame,
  Gauge, Layers, Target, TrendingUp, Shield, Zap, Calendar, Eye, CheckCircle2, XCircle,
} from 'lucide-react'

type DtTokens = {
  bg: string; bgDeep: string; border: string; text: string; muted: string
  green: string; red: string; amber: string; accent: string; violet: string
}

type SubTab = 'patterns' | 'entry' | 'exit' | 'signals' | 'timing' | 'risk' | 'mistakes' | 'gap'

const TZ_LABEL: Record<string, string> = {
  'America/New_York': 'ET',
  'America/Chicago': 'CT',
  'America/Denver': 'MT',
  'America/Los_Angeles': 'PT',
}

/**
 * Convert a market-hours time (expressed as minutes from 9:30 ET) to the user's
 * timezone, returning a formatted "H:MM AM/PM" string.
 * Market open is always 9:30 AM ET / 4:00 PM ET close — we convert those absolute
 * wall-clock times to the user's tz.
 */
function etTimeToUserTz(etHour: number, etMinute: number, userTz: string): string {
  // Build a reference date (today) with the ET time, then format in user tz
  const now = new Date()
  // Create the date as ET by using America/New_York, then read it in userTz
  const etDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const userDate = new Date(now.toLocaleString('en-US', { timeZone: userTz }))
  // Compute the offset difference between ET and user tz in minutes
  const etOffset = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' })).getTime()
  const userOffset = new Date(now.toLocaleString('en-US', { timeZone: userTz })).getTime()
  const diffMinutes = Math.round((userOffset - etOffset) / 60000)
  // Convert ET time to user time
  let userHour = etHour
  let userMinute = etMinute + diffMinutes
  // Normalize
  while (userMinute < 0) { userMinute += 60; userHour -= 1 }
  while (userMinute >= 60) { userMinute -= 60; userHour += 1 }
  userHour = ((userHour % 24) + 24) % 24
  const period = userHour < 12 ? 'AM' : 'PM'
  const displayHour = userHour === 0 ? 12 : userHour > 12 ? userHour - 12 : userHour
  return `${displayHour}:${String(userMinute).padStart(2, '0')} ${period}`
}

/** Convert a time range from ET to the user's timezone. */
function etRangeToUserTz(etStartHour: number, etStartMin: number, etEndHour: number, etEndMin: number, userTz: string): string {
  return `${etTimeToUserTz(etStartHour, etStartMin, userTz)}–${etTimeToUserTz(etEndHour, etEndMin, userTz)}`
}

/** Get the short label (ET/CT/MT/PT) for a timezone. */
function tzLabel(tz: string): string {
  return TZ_LABEL[tz] || 'local'
}

export default function DayTradeStrategiesTab({ dt }: { dt: DtTokens }) {
  const [subTab, setSubTab] = useState<SubTab>('patterns')
  const [userTz, setUserTz] = useState<string>(() => {
    try { return localStorage.getItem('oa_timezone') || 'America/New_York' }
    catch { return 'America/New_York' }
  })

  useEffect(() => {
    const handler = (e: Event) => {
      const tz = (e as CustomEvent<string>).detail
      if (tz) setUserTz(tz)
    }
    window.addEventListener('oa-timezone-changed', handler)
    return () => window.removeEventListener('oa-timezone-changed', handler)
  }, [])

  const subTabs: { id: SubTab; label: string; icon: React.ReactNode }[] = [
    { id: 'patterns', label: 'Pattern Playbook',    icon: <BarChart2 size={13} /> },
    { id: 'entry',    label: 'Entry Strategies',    icon: <ArrowUp size={13} /> },
    { id: 'gap',      label: 'Gap Scenarios',       icon: <Flame size={13} /> },
    { id: 'exit',     label: 'Exit Rules',          icon: <Target size={13} /> },
    { id: 'signals',  label: 'Signals to Watch',    icon: <Eye size={13} /> },
    { id: 'timing',   label: 'Timing & Phases',     icon: <Clock size={13} /> },
    { id: 'risk',     label: 'Risk Management',     icon: <Shield size={13} /> },
    { id: 'mistakes', label: 'Common Mistakes',     icon: <AlertTriangle size={13} /> },
  ]

  return (
    <div className="day-trade-strategies-tab" style={{ minHeight: 400 }}>
      {/* Sub-tab strip */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderBottom: `1px solid ${dt.border}`, flexWrap: 'wrap' }}>
        {subTabs.map(({ id, label, icon }) => {
          const active = subTab === id
          return (
            <button key={id} onClick={() => setSubTab(id)} style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '8px 14px',
              fontSize: 12, fontWeight: active ? 700 : 500,
              color: active ? dt.accent : dt.muted, background: 'none', border: 'none',
              borderBottom: active ? `2px solid ${dt.accent}` : '2px solid transparent',
              marginBottom: -1, cursor: 'pointer', transition: 'color 0.15s', whiteSpace: 'nowrap',
            }}>{icon} {label}</button>
          )
        })}
      </div>

      {subTab === 'patterns' && <PatternPlaybook dt={dt} />}
      {subTab === 'entry'    && <EntryStrategies dt={dt} tz={userTz} />}
      {subTab === 'gap'      && <GapScenarios dt={dt} />}
      {subTab === 'exit'     && <ExitRules dt={dt} tz={userTz} />}
      {subTab === 'signals'  && <SignalsToWatch dt={dt} />}
      {subTab === 'timing'   && <TimingPhases dt={dt} tz={userTz} />}
      {subTab === 'risk'     && <RiskManagement dt={dt} />}
      {subTab === 'mistakes' && <CommonMistakes dt={dt} />}
    </div>
  )
}

type PatternTone = 'bull' | 'bear' | 'neutral'

type Pattern = {
  title: string
  bias: string
  tone: PatternTone
  bestFor: string
  enter: string
  wait: string
  invalid: string
  risk: string
  chart: 'orh-break' | 'orl-break' | 'vwap-reject' | 'vwap-reclaim' | 'or-retest' | 'trend-pullback' | 'exhaustion' | 'range-fade'
  checks: string[]
}

const DAY_TRADE_PATTERNS: Pattern[] = [
  {
    title: 'ORH Breakout',
    bias: 'Long Call',
    tone: 'bull',
    bestFor: 'Fresh strength after the opening range.',
    enter: '5m candle closes above ORH, then next candle holds ORH or breaks the prior high with volume.',
    wait: 'ORH touched by wick only, volume is weak, or candle closes back inside the range.',
    invalid: 'Two closes back below ORH or loss of VWAP after entry.',
    risk: 'Stop under ORH/retest candle. Take T1 at +0.5 opening-range width.',
    chart: 'orh-break',
    checks: ['OR complete', 'Close above ORH', 'Above VWAP', 'Volume confirmed', 'Not near +2σ'],
  },
  {
    title: 'ORL Breakdown',
    bias: 'Long Put',
    tone: 'bear',
    bestFor: 'Opening weakness and trend-down days.',
    enter: '5m candle closes below ORL, then continuation or failed bounce confirms sellers remain in control.',
    wait: 'First tick below ORL only, price is already extended into -2σ, or QQQ/SPY are not aligned.',
    invalid: 'Two closes back above ORL or reclaim of VWAP.',
    risk: 'Stop over ORL/retest candle. Reduce size if ATR used is high.',
    chart: 'orl-break',
    checks: ['OR complete', 'Close below ORL', 'Below VWAP', 'Volume confirmed', 'No exhaustion signal'],
  },
  {
    title: 'VWAP Rejection',
    bias: 'Long Put',
    tone: 'bear',
    bestFor: 'Bearish continuation after a weak bounce.',
    enter: 'Bounce into VWAP fails, rejection candle closes below VWAP, and next candle follows through.',
    wait: 'Price is below VWAP but has not retested it, or rejection candle has no volume.',
    invalid: 'Clean close and hold above VWAP.',
    risk: 'Stop just above the rejection candle or VWAP plus buffer.',
    chart: 'vwap-reject',
    checks: ['Bearish bias', 'VWAP test', 'Rejection close', 'Follow-through', 'Defined stop'],
  },
  {
    title: 'VWAP Reclaim',
    bias: 'Long Call',
    tone: 'bull',
    bestFor: 'Failed selloff turning into an upside reversal.',
    enter: 'Price reclaims VWAP, closes above it, then holds VWAP on the next candle.',
    wait: 'One candle spikes above VWAP but closes weak, or price is still under ORMID.',
    invalid: 'Close back below VWAP with rising sell volume.',
    risk: 'Stop below VWAP or reclaim candle low.',
    chart: 'vwap-reclaim',
    checks: ['Prior weakness', 'VWAP reclaim', 'Hold candle', 'Market aligned', 'Room to ORH'],
  },
  {
    title: 'OR Re-test Hold',
    bias: 'Long Call / Long Put',
    tone: 'neutral',
    bestFor: 'Safer entry after the initial breakout already happened.',
    enter: 'Breakout level flips into support/resistance and the retest candle closes in trend direction.',
    wait: 'Retest cuts through the level or volume disappears.',
    invalid: 'Level fails and price returns inside the opening range.',
    risk: 'Stop just beyond the retested OR level.',
    chart: 'or-retest',
    checks: ['Breakout first', 'Pullback to OR level', 'Level holds', 'Volume stable', 'Continuation candle'],
  },
  {
    title: 'Trend-Day Pullback',
    bias: 'Long Call / Long Put',
    tone: 'neutral',
    bestFor: 'Strong days where VWAP retest may never happen.',
    enter: 'Direction is confirmed, then first EMA/VWAP-lite pullback or small consolidation breaks in trend direction.',
    wait: 'Move is extended and no pullback/consolidation has formed.',
    invalid: 'Trend loses VWAP or forms a strong reversal candle.',
    risk: 'Use smaller size if entry comes after a large ATR move.',
    chart: 'trend-pullback',
    checks: ['Direction engine aligned', 'Trend day state', 'First pullback', '1m trigger', 'No chase'],
  },
  {
    title: 'Exhaustion Bounce Watch',
    bias: 'Wait / Reduce Shorts',
    tone: 'neutral',
    bestFor: 'Avoiding late puts after a large down move.',
    enter: 'No fresh short. Watch for first green 1m candle in -2σ zone if already short.',
    wait: 'Price enters -1σ or -2σ but has not printed a reversal candle.',
    invalid: 'Fresh breakdown below -2σ with volume and no green candle.',
    risk: 'Do not chase. Trail or reduce existing bearish trades.',
    chart: 'exhaustion',
    checks: ['ATR used high', 'Near -1σ/-2σ', 'RSI stretched', 'First green candle', 'Protect profits'],
  },
  {
    title: 'Range Fade',
    bias: 'Quick scalp only',
    tone: 'neutral',
    bestFor: 'No-edge range days where ORH/ORL repeatedly reject.',
    enter: 'Fade only at OR edge after failed breakout and clear rejection. Do not use if trend day is active.',
    wait: 'Inside OR without edge. Let price reach an extreme first.',
    invalid: 'Candle closes outside range with volume.',
    risk: 'Small size, fast T1 near ORMID/VWAP.',
    chart: 'range-fade',
    checks: ['Range day', 'OR edge test', 'Failed breakout', 'Rejection candle', 'Fast target'],
  },
]

function PatternPlaybook({ dt }: { dt: DtTokens }) {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
        {DAY_TRADE_PATTERNS.map(pattern => (
          <PatternCard key={pattern.title} pattern={pattern} dt={dt} />
        ))}
      </div>
    </div>
  )
}

function PatternCard({ pattern, dt }: { pattern: Pattern; dt: DtTokens }) {
  const toneColor = pattern.tone === 'bull' ? dt.green : pattern.tone === 'bear' ? dt.red : dt.accent
  return (
    <div className="dt-card" style={{ background: dt.bg, border: `1px solid ${dt.border}`, borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ padding: 14, borderBottom: `1px solid ${dt.border}` }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: dt.text }}>{pattern.title}</div>
            <div style={{ marginTop: 3, fontSize: 11, color: dt.muted }}>{pattern.bestFor}</div>
          </div>
          <span style={{ flexShrink: 0, border: `1px solid ${toneColor}55`, background: `${toneColor}18`, color: toneColor, borderRadius: 999, padding: '3px 8px', fontSize: 10, fontWeight: 800, textTransform: 'uppercase' }}>
            {pattern.bias}
          </span>
        </div>
      </div>
      <div style={{ padding: 12 }}>
        <PatternDiagram kind={pattern.chart} dt={dt} tone={pattern.tone} />
        <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
          <DecisionLine label="Enter" value={pattern.enter} color={dt.green} />
          <DecisionLine label="Wait" value={pattern.wait} color={dt.amber} />
          <DecisionLine label="Invalid" value={pattern.invalid} color={dt.red} />
          <DecisionLine label="Risk" value={pattern.risk} color={dt.accent} />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 10 }}>
          {pattern.checks.map(check => (
            <span key={check} style={{ border: `1px solid ${dt.border}`, background: dt.bgDeep, color: dt.muted, borderRadius: 999, padding: '3px 7px', fontSize: 10, fontWeight: 700 }}>
              {check}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function DecisionLine({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '58px 1fr', gap: 8, alignItems: 'start' }}>
      <span style={{ color, fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
      <span style={{ color: 'inherit', opacity: 0.82, fontSize: 11.5, lineHeight: 1.45 }}>{value}</span>
    </div>
  )
}

function PatternDiagram({ kind, dt, tone }: { kind: Pattern['chart']; dt: DtTokens; tone: PatternTone }) {
  const green = dt.green
  const red = dt.red
  const accent = dt.accent
  const price = tone === 'bear' ? red : tone === 'bull' ? green : accent
  const grid = dt.border
  const candle = (x: number, o: number, c: number, h: number, l: number, color: string) => (
    <g key={`${x}-${o}-${c}`}>
      <line x1={x} x2={x} y1={h} y2={l} stroke={color} strokeWidth="1.2" />
      <rect x={x - 4} y={Math.min(o, c)} width="8" height={Math.max(3, Math.abs(c - o))} rx="1.5" fill={color} opacity="0.9" />
    </g>
  )
  const line = (y: number, label: string, color: string, dash = '5 4') => (
    <g>
      <line x1="12" x2="248" y1={y} y2={y} stroke={color} strokeDasharray={dash} strokeWidth="1.2" opacity="0.85" />
      <text x="246" y={y - 4} textAnchor="end" fill={color} fontSize="9" fontWeight="700">{label}</text>
    </g>
  )
  const candlesByKind: Record<Pattern['chart'], React.ReactNode[]> = {
    'orh-break': [candle(34,72,62,78,58,green), candle(62,64,51,67,49,green), candle(90,53,39,56,38,green), candle(118,41,35,43,32,green), candle(146,38,30,40,29,green)],
    'orl-break': [candle(34,52,63,49,68,red), candle(62,62,76,59,78,red), candle(90,75,90,72,92,red), candle(118,87,96,85,99,red), candle(146,95,106,92,108,red)],
    'vwap-reject': [candle(34,92,80,96,78,red), candle(62,80,70,82,68,red), candle(90,70,58,72,56,red), candle(118,59,68,55,70,green), candle(146,67,78,64,80,red), candle(174,79,94,76,96,red)],
    'vwap-reclaim': [candle(34,88,96,85,99,red), candle(62,95,102,92,104,red), candle(90,102,91,90,106,green), candle(118,90,80,78,92,green), candle(146,82,72,70,84,green), candle(174,74,64,62,76,green)],
    'or-retest': [candle(34,80,66,84,64,green), candle(62,66,50,68,48,green), candle(90,51,40,53,38,green), candle(118,41,52,39,58,red), candle(146,52,44,50,55,green), candle(174,45,34,32,47,green)],
    'trend-pullback': [candle(34,42,55,38,58,red), candle(62,55,70,52,72,red), candle(90,70,84,68,88,red), candle(118,84,76,74,88,green), candle(146,76,88,74,92,red), candle(174,88,101,86,104,red)],
    exhaustion: [candle(34,42,58,40,60,red), candle(62,58,76,56,78,red), candle(90,76,92,74,95,red), candle(118,92,104,90,108,red), candle(146,104,96,94,110,green), candle(174,96,90,88,100,green)],
    'range-fade': [candle(34,72,64,75,62,green), candle(62,64,56,67,54,green), candle(90,56,68,54,70,red), candle(118,68,76,66,79,red), candle(146,76,65,63,80,green), candle(174,65,56,54,68,green)],
  }
  return (
    <svg viewBox="0 0 260 126" width="100%" height="126" role="img" aria-label={`${kind} pattern diagram`} style={{ display: 'block', border: `1px solid ${dt.border}`, borderRadius: 10, background: dt.bgDeep }}>
      {[34, 62, 90, 118, 146, 174, 202].map(x => <line key={x} x1={x} x2={x} y1="16" y2="110" stroke={grid} opacity="0.3" />)}
      {[32, 62, 92].map(y => <line key={y} x1="12" x2="248" y1={y} y2={y} stroke={grid} opacity="0.3" />)}
      {kind.includes('or') || kind === 'range-fade' ? line(46, 'ORH', green) : null}
      {kind.includes('or') || kind === 'range-fade' ? line(88, 'ORL', red) : null}
      {kind.includes('vwap') || kind === 'trend-pullback' ? line(66, 'VWAP', accent, '3 4') : null}
      {kind === 'exhaustion' ? line(86, '-1σ', accent, '3 4') : null}
      {kind === 'exhaustion' ? line(102, '-2σ', red, '3 4') : null}
      <g>{candlesByKind[kind]}</g>
      <path
        d={kind === 'orl-break' || kind === 'trend-pullback' ? 'M35 50 C70 66 92 82 120 88 C145 92 156 84 178 100' : kind === 'exhaustion' ? 'M35 44 C68 61 88 76 118 98 C138 110 154 101 178 90' : 'M35 82 C70 70 90 52 118 42 C142 34 158 44 178 31'}
        fill="none"
        stroke={price}
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.8"
      />
      <circle cx="178" cy={kind === 'orl-break' || kind === 'trend-pullback' ? 100 : kind === 'exhaustion' ? 90 : 31} r="4" fill={price} />
      <text x="14" y="118" fill={dt.muted} fontSize="9" fontWeight="700">Wait for close confirmation. Avoid wick-only entries.</text>
    </svg>
  )
}

// ─── Card helper ──────────────────────────────────────────────────────────────

function Card({ dt, title, icon, children, accent }: { dt: DtTokens; title: string; icon: React.ReactNode; children: React.ReactNode; accent?: string }) {
  return (
    <div className="dt-card" style={{ background: dt.bg, border: `1px solid ${dt.border}`, borderRadius: 14, padding: '14px 16px', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ color: accent || dt.accent }}>{icon}</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: dt.text }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

function Row({ label, value, color, dt }: { label: string; value: string; color?: string; dt: DtTokens }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '4px 0', borderBottom: `1px solid ${dt.border}40` }}>
      <span style={{ fontSize: 11.5, color: dt.muted, flexShrink: 0, paddingRight: 8 }}>{label}</span>
      <span style={{ fontSize: 11.5, color: color || dt.text, textAlign: 'right', fontWeight: 500, fontFamily: 'monospace' }}>{value}</span>
    </div>
  )
}

function Pill({ text, color, bg }: { text: string; color: string; bg: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 5, color, background: bg, border: `1px solid ${color}40`, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{text}</span>
  )
}

function CheckItem({ text, ok, dt }: { text: string; ok: boolean; dt: DtTokens }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '3px 0' }}>
      {ok ? <CheckCircle2 size={13} style={{ color: dt.green, flexShrink: 0, marginTop: 1 }} /> : <XCircle size={13} style={{ color: dt.red, flexShrink: 0, marginTop: 1 }} />}
      <span style={{ fontSize: 11.5, color: dt.text, lineHeight: 1.45 }}>{text}</span>
    </div>
  )
}

// ─── Entry Strategies ──────────────────────────────────────────────────────────

function EntryStrategies({ dt, tz }: { dt: DtTokens; tz: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: dt.muted, marginBottom: 14, lineHeight: 1.55 }}>
        The engine confirms entries on <strong style={{ color: dt.text }}>5-minute candles</strong> with a 2-candle confirmation
        and wick-rejection guard. Below are the core setups — each requires volume confirmation for a GO verdict.
        In volatile environments, consider holding a <strong style={{ color: dt.amber }}>runner (25-50% position) up to 5 days</strong> for bigger moves.
      </div>

      <Card dt={dt} title="ORH Breakout — Long" icon={<ArrowUp size={15} />} accent={dt.green}>
        <Pill text="Intraday + Multi-day" color={dt.green} bg={`${dt.green}15`} />
        <div style={{ marginTop: 8 }}>
          <CheckItem text="Price breaks above Opening Range High (first 15 min)" ok={true} dt={dt} />
          <CheckItem text="2 consecutive green 5m candles closing above ORH" ok={true} dt={dt} />
          <CheckItem text="Neither candle wicks back below ORH (wick-rejection guard)" ok={true} dt={dt} />
          <CheckItem text="Volume spike on breakout bar (≥1.55× median)" ok={true} dt={dt} />
          <CheckItem text="Stop: OR Low or ORH × 0.9985" ok={true} dt={dt} />
          <CheckItem text="Targets: T1 = ORH + 50% OR range, T2 = ORH + 100% OR range" ok={true} dt={dt} />
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: dt.amber, fontStyle: 'italic' }}>
          Multi-day: If trend day (SPY &gt;0.8%, VIX &lt;18), hold 25-50% as runner with trailing stop at VWAP. Exit by day 5 or if daily trend breaks.
        </div>
      </Card>

      <Card dt={dt} title="ORL Breakdown — Short" icon={<ArrowDown size={15} />} accent={dt.red}>
        <Pill text="Intraday + Multi-day" color={dt.red} bg={`${dt.red}15`} />
        <div style={{ marginTop: 8 }}>
          <CheckItem text="Price breaks below Opening Range Low" ok={true} dt={dt} />
          <CheckItem text="2 consecutive red 5m candles closing below ORL" ok={true} dt={dt} />
          <CheckItem text="Neither candle wicks back above ORL" ok={true} dt={dt} />
          <CheckItem text="Volume spike confirms the breakdown" ok={true} dt={dt} />
          <CheckItem text="Stop: OR High or ORL × 1.0015" ok={true} dt={dt} />
          <CheckItem text="Targets: T1 = ORL − 50% OR range, T2 = ORL − 100% OR range" ok={true} dt={dt} />
        </div>
      </Card>

      <Card dt={dt} title="VWAP Reclaim — Long" icon={<TrendingUp size={15} />} accent={dt.green}>
        <div style={{ marginBottom: 6 }}>
          <Pill text="Best for multi-day holds" color={dt.violet} bg={`${dt.violet}15`} />
        </div>
        <div>
          <CheckItem text="Price was below VWAP, now reclaiming from below" ok={true} dt={dt} />
          <CheckItem text="2 green 5m candles closing above VWAP" ok={true} dt={dt} />
          <CheckItem text="Prior bar touched VWAP (low ≤ VWAP + tolerance)" ok={true} dt={dt} />
          <CheckItem text="Confirmation candle volume ≥ 80% of test candle" ok={true} dt={dt} />
          <CheckItem text="Stop: VWAP × 0.998 or VWAP − 0.3σ" ok={true} dt={dt} />
          <CheckItem text="Targets: T1 = OR High, T2 = ORH + 50% range" ok={true} dt={dt} />
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: dt.amber, fontStyle: 'italic' }}>
          Multi-day: VWAP reclaim with strong volume is the highest-quality multi-day entry. Hold 50% runner with stop at breakeven (day 2) then trail daily VWAP.
        </div>
      </Card>

      <Card dt={dt} title="VWAP Break — Short" icon={<ArrowDown size={15} />} accent={dt.red}>
        <div>
          <CheckItem text="Price was above VWAP, now breaking below" ok={true} dt={dt} />
          <CheckItem text="2 red 5m candles closing below VWAP" ok={true} dt={dt} />
          <CheckItem text="Prior bar's high touched VWAP zone" ok={true} dt={dt} />
          <CheckItem text="Stop: VWAP × 1.002 or VWAP + 0.3σ" ok={true} dt={dt} />
          <CheckItem text="Targets: T1 = OR Low, T2 = ORL − 50% range" ok={true} dt={dt} />
        </div>
      </Card>

      <Card dt={dt} title="Pullback Reset — Long/Short" icon={<Activity size={15} />} accent={dt.violet}>
        <div style={{ fontSize: 11.5, color: dt.muted, marginBottom: 8 }}>
          After price was ≥1.5σ extended from VWAP, it returns and reclaims. Four confidence patterns:
        </div>
        <Row label="Double Green (HIGH)" value="100% size · 0.30σ stop · 1.5× R/R min" color={dt.green} dt={dt} />
        <Row label="Strong Single Green (MED-HIGH)" value="75% size · 0.25σ stop · 1.2× R/R min" color={dt.green} dt={dt} />
        <Row label="Green Hold (MEDIUM)" value="50% size · 0.20σ stop · 1.0× R/R min" color={dt.amber} dt={dt} />
        <Row label="Volume Surge (MEDIUM)" value="50% size · 0.20σ stop · 1.0× R/R min" color={dt.amber} dt={dt} />
        <div style={{ marginTop: 8, fontSize: 11, color: dt.red }}>
          Skip if ≥3 wick failures in prior 10 bars. Skip after {etTimeToUserTz(15, 0, tz)} {tzLabel(tz)}.
        </div>
      </Card>

      <Card dt={dt} title="VWAP Zone Rejection — 1-min precision" icon={<Zap size={15} />} accent={dt.accent}>
        <div style={{ fontSize: 11.5, color: dt.muted, marginBottom: 6 }}>
          A 1-minute-bar pattern requiring all 4 conditions + R/R ≥ 1.5:
        </div>
        <div>
          <CheckItem text="Bar enters VWAP ± $0.50 zone" ok={true} dt={dt} />
          <CheckItem text="Rejection candle (red for PUT / green for CALL)" ok={true} dt={dt} />
          <CheckItem text="Wick touches VWAP, body closes back outside zone" ok={true} dt={dt} />
          <CheckItem text="Stop: candle high + $0.10 (PUT) / candle low − $0.10 (CALL)" ok={true} dt={dt} />
        </div>
      </Card>

      <Card dt={dt} title="OR Re-test Hold — Continuation" icon={<Layers size={15} />} accent={dt.green}>
        <div>
          <CheckItem text="Price broke OR, pulled back to OR level, holding with volume" ok={true} dt={dt} />
          <CheckItem text="Highest-quality continuation entry — level acting as support" ok={true} dt={dt} />
          <CheckItem text="Volume spike on re-test bar confirms buyers defending the level" ok={true} dt={dt} />
          <CheckItem text="Stop just below re-test level" ok={true} dt={dt} />
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: dt.amber, fontStyle: 'italic' }}>
          Multi-day: OR re-test holds are excellent multi-day entries — the level flip gives a tight, well-defined stop for overnight risk.
        </div>
      </Card>

      <Card dt={dt} title="Multi-Day Hold Strategy (1-5 Days)" icon={<Calendar size={15} />} accent={dt.violet}>
        <div style={{ fontSize: 12, color: dt.muted, marginBottom: 10, lineHeight: 1.55 }}>
          In volatile environments, holding a portion overnight captures gap moves and multi-day trends.
          The engine's overnight runner logic scores whether to keep 25% of the position.
        </div>
        <Row label="When to hold overnight" value="Trend day + VIX < 18 + strong close" color={dt.green} dt={dt} />
        <Row label="Runner size" value="25-50% of original position" color={dt.amber} dt={dt} />
        <Row label="Max hold" value="5 trading days" color={dt.text} dt={dt} />
        <Row label="Day 1 stop" value="Original stop or VWAP (whichever tighter)" color={dt.text} dt={dt} />
        <Row label="Day 2+ stop" value="Breakeven, then trail daily VWAP" color={dt.text} dt={dt} />
        <Row label="Exit triggers" value="Daily trend break, gap against, day 5" color={dt.red} dt={dt} />
        <Row label="Earnings risk" value="Exit before earnings — never hold through" color={dt.red} dt={dt} />
        <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, background: `${dt.amber}12`, border: `1px solid ${dt.amber}30` }}>
          <div style={{ fontSize: 11, color: dt.amber, fontWeight: 600, marginBottom: 4 }}>Gap Risk Checklist (before holding overnight)</div>
          <CheckItem text="Check if earnings is within the hold period — exit if yes" ok={true} dt={dt} />
          <CheckItem text="Check macro calendar (CPI, FOMC, jobs) next morning — exit if high-impact" ok={true} dt={dt} />
          <CheckItem text="Size the runner so a 3-5% gap against you is tolerable (max 1-2% account risk)" ok={true} dt={dt} />
          <CheckItem text="Set a mental stop for the gap open — if it gaps below stop, exit at open" ok={true} dt={dt} />
        </div>
      </Card>
    </div>
  )
}

// ─── Gap Scenarios ────────────────────────────────────────────────────────────

function GapScenarios({ dt }: { dt: DtTokens }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: dt.muted, marginBottom: 14, lineHeight: 1.55 }}>
        Gap scenarios are the #1 source of avoidable losses for day traders. The engine now tracks
        <strong style={{ color: dt.text }}> prior day high/low</strong> and detects gap-fade patterns.
        The simple logic of "buy when 5m closes above prior day high" is <strong style={{ color: dt.red }}>dangerous</strong> —
        the move already happened at the open. What matters is whether the gap <em>holds</em> or <em>fades</em>.
      </div>

      {/* Scenario 1: Gap-Up Above Prior Day High — Holds (Bullish) */}
      <Card dt={dt} title="Gap-Up Above Prior Day High — HOLDS (Long)" icon={<ArrowUp size={15} />} accent={dt.green}>
        <Pill text="Valid long" color={dt.green} bg={`${dt.green}15`} />
        <div style={{ marginTop: 8 }}>
          <CheckItem text="Stock gaps up above prior day high at the open" ok={true} dt={dt} />
          <CheckItem text="Price HOLDS above VWAP after the first 15 minutes (OR window)" ok={true} dt={dt} />
          <CheckItem text="Prior day high now acts as SUPPORT — price bounces off it" ok={true} dt={dt} />
          <CheckItem text="Volume is expanding (≥1.55× median) — not a thin gap" ok={true} dt={dt} />
          <CheckItem text="SPY/QQQ are aligned (both green or at least not down >0.5%)" ok={true} dt={dt} />
          <CheckItem text="Entry: on the first 5m green candle that holds above VWAP after OR" ok={true} dt={dt} />
          <CheckItem text="Stop: below VWAP or prior day high (whichever is closer)" ok={true} dt={dt} />
        </div>
        <div style={{ marginTop: 8 }}>
          <Row label="Example" value="ARM gaps from $422 prior high to $449 open, holds $445+ above VWAP all day" color={dt.text} dt={dt} />
          <Row label="R/R" value="T1 = ORH + 50% OR range, T2 = ORH + 100% OR range" color={dt.green} dt={dt} />
        </div>
      </Card>

      {/* Scenario 2: Gap-Up Above Prior Day High — FADES (Short!) */}
      <Card dt={dt} title="Gap-Up Above Prior Day High — FADES (SHORT!)" icon={<ArrowDown size={15} />} accent={dt.red}>
        <Pill text="Gap fade short" color={dt.red} bg={`${dt.red}15`} />
        <div style={{ marginTop: 8, marginBottom: 8, padding: '8px 10px', borderRadius: 8, background: `${dt.red}10`, border: `1px solid ${dt.red}30` }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: dt.red }}>THIS IS THE ARM SCENARIO</span>
          <span style={{ fontSize: 11, color: dt.text }}>: Prior ORH $422 → gap to $439-$449 → price stays BELOW VWAP all day. The gap is failing. Buying long here is chasing a failed gap — statistically losing.</span>
        </div>
        <CheckItem text="Stock gaps up above prior day high at the open" ok={true} dt={dt} />
        <CheckItem text="Price drops BELOW VWAP within the first 15-30 minutes" ok={true} dt={dt} />
        <CheckItem text="Price stays below VWAP — cannot reclaim it" ok={true} dt={dt} />
        <CheckItem text="Prior day high acts as RESISTANCE — price rejected when testing it" ok={true} dt={dt} />
        <CheckItem text="Volume may be high but selling pressure dominates (red candles, lower highs)" ok={true} dt={dt} />
        <CheckItem text="Entry: on 2 consecutive red 5m candles below VWAP (trigger detector: VWAP_BREAK)" ok={true} dt={dt} />
        <CheckItem text="Stop: above VWAP or the session high (whichever is tighter)" ok={true} dt={dt} />
        <div style={{ marginTop: 8 }}>
          <Row label="Engine signal" value="⚠️ Gap-fade: bear_delta +1.0 (double weight)" color={dt.red} dt={dt} />
          <Row label="Targets" value="T1 = prior close, T2 = prior day low" color={dt.green} dt={dt} />
        </div>
      </Card>

      {/* Scenario 3: Gap-Down Below Prior Day Low — Bounces (Long) */}
      <Card dt={dt} title="Gap-Down Below Prior Day Low — BOUNCES (Long)" icon={<ArrowUp size={15} />} accent={dt.green}>
        <Pill text="Gap-fill long" color={dt.green} bg={`${dt.green}15`} />
        <div style={{ marginTop: 8 }}>
          <CheckItem text="Stock gaps down below prior day low at the open" ok={true} dt={dt} />
          <CheckItem text="Price bounces ABOVE VWAP within 15-30 minutes" ok={true} dt={dt} />
          <CheckItem text="Prior day low acts as SUPPORT — price holds above it" ok={true} dt={dt} />
          <CheckItem text="Volume expanding on the bounce (buyers stepping in)" ok={true} dt={dt} />
          <CheckItem text="Entry: 2 green 5m candles above VWAP (trigger: VWAP_RECLAIM)" ok={true} dt={dt} />
          <CheckItem text="Stop: below the session low or prior day low" ok={true} dt={dt} />
        </div>
        <div style={{ marginTop: 8 }}>
          <Row label="Engine signal" value="⚠️ Gap-fill: bull_delta +1.0 (double weight)" color={dt.green} dt={dt} />
          <Row label="Targets" value="T1 = prior close, T2 = prior day high" color={dt.green} dt={dt} />
        </div>
      </Card>

      {/* Scenario 4: Gap-Down Below Prior Day Low — Holds (Short) */}
      <Card dt={dt} title="Gap-Down Below Prior Day Low — HOLDS (Short)" icon={<ArrowDown size={15} />} accent={dt.red}>
        <Pill text="Valid short" color={dt.red} bg={`${dt.red}15`} />
        <div style={{ marginTop: 8 }}>
          <CheckItem text="Stock gaps down below prior day low at the open" ok={true} dt={dt} />
          <CheckItem text="Price stays BELOW VWAP — cannot reclaim it" ok={true} dt={dt} />
          <CheckItem text="Prior day low acts as RESISTANCE — rejected when testing from below" ok={true} dt={dt} />
          <CheckItem text="Selling pressure dominates (red candles, lower highs)" ok={true} dt={dt} />
          <CheckItem text="Entry: 2 red 5m candles below VWAP (trigger: VWAP_BREAK)" ok={true} dt={dt} />
          <CheckItem text="Stop: above VWAP or prior day low" ok={true} dt={dt} />
        </div>
      </Card>

      {/* What else to consider */}
      <Card dt={dt} title="What Else to Consider Before Entering a Gap Trade" icon={<Eye size={15} />} accent={dt.amber}>
        <div style={{ fontSize: 11.5, color: dt.muted, marginBottom: 10 }}>
          The simple "buy above prior day high" logic ignores these critical factors. The engine evaluates all of them:
        </div>
        <Row label="1. Gap size" value=">3% gap = volatile, wider stops, smaller size" color={dt.amber} dt={dt} />
        <Row label="2. VWAP position" value="Above VWAP = gap holding. Below VWAP = gap fading" color={dt.text} dt={dt} />
        <Row label="3. Volume on gap" value="Thin gap = likely fade. High volume = more conviction" color={dt.text} dt={dt} />
        <Row label="4. Market context" value="SPY/QQQ aligned? VIX elevated? Broad market matters" color={dt.text} dt={dt} />
        <Row label="5. News/earnings catalyst" value="Was the gap news-driven? Earnings gaps behave differently" color={dt.text} dt={dt} />
        <Row label="6. OR behavior" value="Did OR form above or below prior high? OR is the real setup" color={dt.text} dt={dt} />
        <Row label="7. Time of day" value="Morning gap behavior ≠ afternoon. Most gaps resolve by 11 AM" color={dt.text} dt={dt} />
        <Row label="8. Gap fill probability" value="Large gaps fill ~60% of the time within 1-3 days" color={dt.amber} dt={dt} />
        <Row label="9. Prior day level as S/R" value="Prior high = support if holding, resistance if fading" color={dt.text} dt={dt} />
        <Row label="10. R/R from current price" value="If gap is +6%, R/R to prior close is compressed — don't chase" color={dt.red} dt={dt} />
      </Card>

      {/* Decision Framework */}
      <Card dt={dt} title="Gap Decision Framework" icon={<Layers size={15} />} accent={dt.violet}>
        <div style={{ fontSize: 11.5, color: dt.muted, marginBottom: 10 }}>
          Use this framework instead of the simple "buy above prior high" logic:
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div style={{ padding: '8px 10px', borderRadius: 8, background: `${dt.green}10`, border: `1px solid ${dt.green}30` }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: dt.green, marginBottom: 4 }}>✓ GO LONG if ALL true:</div>
            <div style={{ fontSize: 10.5, color: dt.text, lineHeight: 1.5 }}>
              • Gapped up + above VWAP<br/>
              • Prior high holds as support<br/>
              • Volume expanding<br/>
              • SPY/QQQ aligned<br/>
              • 5m green candle confirms
            </div>
          </div>
          <div style={{ padding: '8px 10px', borderRadius: 8, background: `${dt.red}10`, border: `1px solid ${dt.red}30` }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: dt.red, marginBottom: 4 }}>✗ AVOID LONG if ANY true:</div>
            <div style={{ fontSize: 10.5, color: dt.text, lineHeight: 1.5 }}>
              • Below VWAP (gap fading)<br/>
              • Prior high acts as resistance<br/>
              • No volume confirmation<br/>
              • SPY/QQQ down {'>'} 0.5%<br/>
              • Gap {'>'} 3% (overextended)
            </div>
          </div>
          <div style={{ padding: '8px 10px', borderRadius: 8, background: `${dt.red}10`, border: `1px solid ${dt.red}30` }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: dt.red, marginBottom: 4 }}>↓ GO SHORT if ALL true:</div>
            <div style={{ fontSize: 10.5, color: dt.text, lineHeight: 1.5 }}>
              • Gapped up but below VWAP<br/>
              • Prior high rejected as resistance<br/>
              • 2 red 5m candles below VWAP<br/>
              • Lower highs forming<br/>
              • Volume on selling pressure
            </div>
          </div>
          <div style={{ padding: '8px 10px', borderRadius: 8, background: `${dt.amber}10`, border: `1px solid ${dt.amber}30` }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: dt.amber, marginBottom: 4 }}>○ WAIT if:</div>
            <div style={{ fontSize: 10.5, color: dt.text, lineHeight: 1.5 }}>
              • Price is at VWAP (testing)<br/>
              • OR not yet formed ({'<'} 15 min)<br/>
              • Mixed signals (gap up + SPY down)<br/>
              • Gap {'<'} 1% (insignificant)<br/>
              • No clear direction = NO TRADE
            </div>
          </div>
        </div>
      </Card>

      {/* Key rule */}
      <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 10, background: `${dt.red}10`, border: `1px solid ${dt.red}30` }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <AlertTriangle size={16} style={{ color: dt.red, flexShrink: 0, marginTop: 1 }} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: dt.red, marginBottom: 4 }}>The #1 Gap Rule</div>
            <div style={{ fontSize: 11.5, color: dt.text, lineHeight: 1.55 }}>
              <strong>Above prior-day high but below VWAP = gap fade = SHORT, not long.</strong>{' '}
              <strong>Below prior-day low but above VWAP = gap fill = LONG, not short.</strong>{' '}
              The VWAP position determines whether the gap is holding or fading — not the prior day level.
              The prior day level tells you WHERE the gap is; VWAP tells you WHAT the gap is doing.
              Always check VWAP before acting on a prior day level.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Exit Rules ────────────────────────────────────────────────────────────────

function ExitRules({ dt, tz }: { dt: DtTokens; tz: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: dt.muted, marginBottom: 14, lineHeight: 1.55 }}>
        The exit engine monitors held positions in real-time. <strong style={{ color: dt.red }}>CRITICAL</strong> signals
        require immediate action; <strong style={{ color: dt.amber }}>WARNING</strong> signals mean prepare to exit.
        For multi-day holds, daily trend break is the primary invalidation.
      </div>

      <Card dt={dt} title="Real-Time Exit Signals" icon={<AlertTriangle size={15} />} accent={dt.red}>
        <Row label="STOP_HIT" value="CRITICAL — exit immediately at market" color={dt.red} dt={dt} />
        <Row label="VWAP_BREAK" value="CRITICAL — 2 consecutive 5m closes through VWAP" color={dt.red} dt={dt} />
        <Row label="OR_BREAK" value="CRITICAL — 2 consecutive 5m closes through OR level" color={dt.red} dt={dt} />
        <Row label="TIME_STOP (≤5 min)" value="CRITICAL — close before the bell" color={dt.red} dt={dt} />
        <Row label="TIME_STOP (≤15 min)" value="WARNING — day trade must be flat" color={dt.amber} dt={dt} />
        <Row label="APPROACH_VWAP" value="WARNING — within 0.5% of VWAP, prepare to exit" color={dt.amber} dt={dt} />
        <Row label="TARGET" value="WARNING — take profit, sell ½, trail the rest" color={dt.green} dt={dt} />
        <Row label="TRAILING_STOP" value="WARNING — 1% pullback from peak, tighten stop" color={dt.amber} dt={dt} />
      </Card>

      <Card dt={dt} title="Price-Based Exit Rules — Breakout Trades" icon={<Target size={15} />} accent={dt.green}>
        <Row label="Target 1 (½ off)" value="ORH + 50% OR range (long) / ORL − 50% (short)" color={dt.green} dt={dt} />
        <Row label="Move stop after T1" value="To breakout level (breakeven)" color={dt.amber} dt={dt} />
        <Row label="Target 2 (remaining)" value="ORH + 100% OR range / ORL − 100%" color={dt.green} dt={dt} />
        <Row label="VWAP loss" value="Exit full — breakout failed" color={dt.red} dt={dt} />
        <Row label="OR violation (stop)" value="Exit full — accept the loss" color={dt.red} dt={dt} />
      </Card>

      <Card dt={dt} title="EOD Exit Timeline" icon={<Clock size={15} />} accent={dt.amber}>
        <Row label="Normal session" value={`Exit by ${etTimeToUserTz(15, 55, tz)} ${tzLabel(tz)}`} color={dt.text} dt={dt} />
        <Row label="Power hour entry" value={`Exit by ${etTimeToUserTz(15, 50, tz)} ${tzLabel(tz)}`} color={dt.amber} dt={dt} />
        <Row label="EOD closing (last 10 min)" value="EXIT NOW — do not wait" color={dt.red} dt={dt} />
        <div style={{ marginTop: 8, fontSize: 11, color: dt.red, fontStyle: 'italic' }}>
          Never carry an intraday position overnight unless you've consciously decided to hold a runner (see Multi-Day Hold Strategy).
        </div>
      </Card>

      <Card dt={dt} title="Multi-Day Exit Rules (1-5 Day Holds)" icon={<Calendar size={15} />} accent={dt.violet}>
        <Row label="Day 1 exit" value="Same as intraday rules for the non-runner portion" color={dt.text} dt={dt} />
        <Row label="Day 2+ daily trend break" value="Price closes below MA20 (long) / above MA20 (short) → exit" color={dt.red} dt={dt} />
        <Row label="Gap against position" value="If gaps below stop, exit at open — do not hope" color={dt.red} dt={dt} />
        <Row label="Day 5 mandatory" value="Exit by close — do not extend beyond 5 days" color={dt.amber} dt={dt} />
        <Row label="Earnings approaching" value="Exit 1 day before earnings — never hold through" color={dt.red} dt={dt} />
        <Row label="VWAP reclaim against you" value="Exit — thesis invalidated" color={dt.red} dt={dt} />
        <Row label="Trailing stop" value="Trail daily VWAP or prior day low (long) / high (short)" color={dt.amber} dt={dt} />
      </Card>
    </div>
  )
}

// ─── Signals to Watch ──────────────────────────────────────────────────────────

function SignalsToWatch({ dt }: { dt: DtTokens }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: dt.muted, marginBottom: 14, lineHeight: 1.55 }}>
        The engine scores 10 correlation-capped signal groups. Each group caps at 3.0 to prevent
        correlated inflation. Watch these to understand why the engine is signaling GO, WATCH, or AVOID.
      </div>

      <Card dt={dt} title="Scoring Groups (correlation-capped)" icon={<BarChart2 size={15} />} accent={dt.accent}>
        <Row label="VWAP position + slope" value="Above/below/at + 15-bar & 60-bar slope" color={dt.text} dt={dt} />
        <Row label="Breakout quality" value="OR break + volume (3.0) / without (1.0)" color={dt.text} dt={dt} />
        <Row label="Momentum" value="Adaptive 15/30/45 bar + HH_HL / LL_LH structure" color={dt.text} dt={dt} />
        <Row label="Volume" value="Spike ≥1.55× median + RVOL + volume profile delta" color={dt.text} dt={dt} />
        <Row label="Relative strength" value="Session return vs QQQ" color={dt.text} dt={dt} />
        <Row label="Market context" value="SPY/QQQ daily + VIX penalty (≥30 = −0.5)" color={dt.text} dt={dt} />
        <Row label="Gap" value="Pre-market gap ≥1% + gap-fill risk" color={dt.text} dt={dt} />
        <Row label="OR width" value="Narrow <0.40% (coiling) / Wide >1.50% (chaotic)" color={dt.text} dt={dt} />
        <Row label="Time penalty" value="EOD −1.0 / Power hour −0.5 / Midday −0.25" color={dt.text} dt={dt} />
        <Row label="Daily trend context" value="Alignment/conflict with swing bias (±0.5)" color={dt.text} dt={dt} />
      </Card>

      <Card dt={dt} title="Confidence Block Indicators" icon={<Gauge size={15} />} accent={dt.violet}>
        <Row label="Trend strength" value="HIGH (≥0.20%) / MEDIUM (≥0.07%) / LOW" color={dt.text} dt={dt} />
        <Row label="Breakout quality" value="GOOD (OR+vol) / MODERATE (OR only) / WEAK" color={dt.text} dt={dt} />
        <Row label="Volume confirmation" value="STRONG / ELEVATED / NORMAL / WEAK" color={dt.text} dt={dt} />
        <Row label="Market alignment" value="STRONG (SPY+QQQ ≥0.3%) / MEDIUM / WEAK" color={dt.text} dt={dt} />
        <Row label="Risk level" value="HIGH (VIX ≥32) / MEDIUM (≥22) / LOW" color={dt.text} dt={dt} />
      </Card>

      <Card dt={dt} title="Edge Remaining — Am I too late?" icon={<Flame size={15} />} accent={dt.amber}>
        <Row label="EARLY" value="Fresh setup, best R/R — full size" color={dt.green} dt={dt} />
        <Row label="DEVELOPING" value="Momentum building with volume" color={dt.green} dt={dt} />
        <Row label="LATE" value="At ±1σ or 60-79% range used — require tighter confirmation" color={dt.amber} dt={dt} />
        <Row label="EXHAUSTED" value="At ±2σ or ≥80% range used — chasing is statistically losing" color={dt.red} dt={dt} />
      </Card>

      <Card dt={dt} title="Volume Profile" icon={<Activity size={15} />} accent={dt.accent}>
        <Row label="POC (Point of Control)" value="Price level with highest volume" color={dt.text} dt={dt} />
        <Row label="Delta %" value="Buy vs sell pressure — (buy_vol − sell_vol) / total" color={dt.text} dt={dt} />
        <Row label="POC position" value="Above/below/at current price — magnet level" color={dt.text} dt={dt} />
      </Card>
    </div>
  )
}

// ─── Timing & Phases ───────────────────────────────────────────────────────────

function TimingPhases({ dt, tz }: { dt: DtTokens; tz: string }) {
  const tl = tzLabel(tz)
  return (
    <div>
      <div style={{ fontSize: 12, color: dt.muted, marginBottom: 14, lineHeight: 1.55 }}>
        The session has distinct phases with different scoring penalties. Timing is critical —
        the same setup at {etTimeToUserTz(10, 0, tz)} {tl} is a GO; at {etTimeToUserTz(15, 50, tz)} {tl} it's an AVOID.
        <br/><span style={{ fontSize: 11, color: dt.muted }}>All times shown in your timezone ({tl}). Market hours are 9:30 AM – 4:00 PM ET.</span>
      </div>

      <Card dt={dt} title={`Session Phases (${tl})`} icon={<Clock size={15} />} accent={dt.accent}>
        <Row label={`${etRangeToUserTz(9, 30, 10, 0, tz)} (OPENING)`} value="OR forming — no entries until OR set" color={dt.muted} dt={dt} />
        <Row label={`${etRangeToUserTz(10, 0, 11, 30, tz)} (MID_MORNING)`} value="Primary breakout window — best entries" color={dt.green} dt={dt} />
        <Row label={`${etRangeToUserTz(11, 30, 15, 0, tz)} (MIDDAY)`} value="Lower liquidity — breakout follow-through weaker (−0.25)" color={dt.amber} dt={dt} />
        <Row label={`${etRangeToUserTz(15, 0, 15, 50, tz)} (POWER_HOUR)`} value="Size down (−0.5), mandatory EOD exit" color={dt.amber} dt={dt} />
        <Row label={`${etRangeToUserTz(15, 50, 16, 0, tz)} (EOD_CLOSING)`} value="EXIT ONLY (−1.0) — no new entries" color={dt.red} dt={dt} />
      </Card>

      <Card dt={dt} title="Opening Range" icon={<Layers size={15} />} accent={dt.violet}>
        <Row label="OR window" value={`First 15 1-minute bars of RTH (${etRangeToUserTz(9, 30, 9, 45, tz)})`} color={dt.text} dt={dt} />
        <Row label="Narrow OR (<0.40%)" value="Coiling setup — breakout likely sharp" color={dt.green} dt={dt} />
        <Row label="Wide OR (>1.50%)" value="Chaotic open — levels loose, risk elevated" color={dt.red} dt={dt} />
        <Row label="Valid breakout" value="Bar CLOSES beyond OR + volume spike on same bar" color={dt.text} dt={dt} />
        <div style={{ marginTop: 8, fontSize: 11, color: dt.red }}>
          Wick pokes or low-volume touches beyond OR do NOT qualify as breakouts.
        </div>
      </Card>

      <Card dt={dt} title="Critical Timing Gates" icon={<AlertTriangle size={15} />} accent={dt.amber}>
        <Row label="< 5 min elapsed" value="No entries — OR not established" color={dt.muted} dt={dt} />
        <Row label="> 45 min after OR break" value="Late to the move — chase risk flagged" color={dt.amber} dt={dt} />
        <Row label={`> 210 bars (~${etTimeToUserTz(12, 30, tz)} ${tl}+)`} value="Exhausted unless trend day detected" color={dt.amber} dt={dt} />
        <Row label={`> 330 bars (~${etTimeToUserTz(15, 0, tz)} ${tl})`} value="Pullback reset detection disabled" color={dt.red} dt={dt} />
      </Card>

      <Card dt={dt} title="Trend Day Exception" icon={<TrendingUp size={15} />} accent={dt.green}>
        <div style={{ fontSize: 11.5, color: dt.muted, marginBottom: 8 }}>
          When a trend day is detected, extension rules are suspended — the move can run further than normal:
        </div>
        <CheckItem text="SPY move > 0.8% + VIX < 18 (bull) / VIX > 19 (bear)" ok={true} dt={dt} />
        <CheckItem text="3+ tracked tickers confirming the direction" ok={true} dt={dt} />
        <CheckItem text="QQQ aligned with SPY" ok={true} dt={dt} />
        <div style={{ marginTop: 8 }}>
          <Row label="Effect" value="Extension rules suspended, stop widened 50%, target = next σ band" color={dt.green} dt={dt} />
          <Row label="Multi-day implication" value="Best conditions for 5-day runner holds" color={dt.violet} dt={dt} />
        </div>
      </Card>
    </div>
  )
}

// ─── Risk Management ───────────────────────────────────────────────────────────

function RiskManagement({ dt }: { dt: DtTokens }) {
  return (
    <div>
      <Card dt={dt} title="Stop Placement by Setup" icon={<Shield size={15} />} accent={dt.red}>
        <Row label="Fresh OR Breakout" value="ORH × 0.9985 (long) / ORL × 1.0015 (short)" color={dt.text} dt={dt} />
        <Row label="VWAP Defense Continuation" value="VWAP − 0.3σ (long) / VWAP + 0.3σ (short)" color={dt.text} dt={dt} />
        <Row label="VWAP Double Bottom" value="VWAP − 0.5σ / VWAP + 0.5σ" color={dt.text} dt={dt} />
        <Row label="Level Flip" value="flip × 0.997 / flip × 1.003" color={dt.text} dt={dt} />
        <Row label="Extended (fade)" value="+1σ band / −1σ band" color={dt.text} dt={dt} />
        <Row label="VWAP bounce long" value="VWAP × 0.998" color={dt.text} dt={dt} />
        <Row label="VWAP rejection short" value="VWAP × 1.002" color={dt.text} dt={dt} />
        <Row label="Conservative fallback" value="OR Low (long) / OR High (short)" color={dt.muted} dt={dt} />
      </Card>

      <Card dt={dt} title="R/R Requirements" icon={<Target size={15} />} accent={dt.green}>
        <Row label="Minimum R/R" value="1.5:1 — entry window closes below this" color={dt.amber} dt={dt} />
        <Row label="Recommended R/R" value="Adaptive — based on setup-type probabilities" color={dt.green} dt={dt} />
        <Row label="R/R < 1.0" value="Setup does not offer adequate reward — skip" color={dt.red} dt={dt} />
        <Row label="R/R < 1.5" value="Marginal — require high-probability confirmation" color={dt.amber} dt={dt} />
        <Row label="Multi-day runner R/R" value="≥ 2:1 preferred (gap risk requires more cushion)" color={dt.violet} dt={dt} />
      </Card>

      <Card dt={dt} title="VIX Gates" icon={<Flame size={15} />} accent={dt.amber}>
        <Row label="VIX ≥ 40" value="AVOID / NO-GO — hard veto" color={dt.red} dt={dt} />
        <Row label="VIX ≥ 35" value="AVOID — verdict resolver veto" color={dt.red} dt={dt} />
        <Row label="VIX ≥ 30" value="Caution — size down, wider swings" color={dt.amber} dt={dt} />
        <Row label="VIX ≥ 25" value="Volatility risk flagged (HIGH if ≥30)" color={dt.amber} dt={dt} />
        <Row label="VIX ≥ 22" value="Risk = MEDIUM" color={dt.amber} dt={dt} />
        <Row label="VIX < 18" value="Risk = LOW — favorable for multi-day holds" color={dt.green} dt={dt} />
      </Card>

      <Card dt={dt} title="RVOL Thresholds" icon={<BarChart2 size={15} />} accent={dt.accent}>
        <Row label="HIGH (standard tickers)" value="2.5× average" color={dt.green} dt={dt} />
        <Row label="HIGH (large-cap liquid)" value="1.5× — SPY/QQQ/NVDA/AAPL/MSFT/AMZN/META/GOOGL/TSLA" color={dt.green} dt={dt} />
        <Row label="ELEVATED (standard)" value="1.5×" color={dt.green} dt={dt} />
        <Row label="ELEVATED (large-cap)" value="1.3×" color={dt.green} dt={dt} />
        <Row label="LOW (HIGH risk)" value="< 0.6× — false-move probability elevated" color={dt.red} dt={dt} />
        <Row label="LOW (LOW risk)" value="< 0.9× — thin participation" color={dt.amber} dt={dt} />
      </Card>

      <Card dt={dt} title="Daily Range Exhaustion (vs 14-day ATR)" icon={<Gauge size={15} />} accent={dt.violet}>
        <Row label="≥ 100% ATR used" value="EXHAUSTED — rare extended day" color={dt.red} dt={dt} />
        <Row label="≥ 80% ATR used" value="EXHAUSTED — chasing is statistically losing" color={dt.red} dt={dt} />
        <Row label="≥ 60% ATR used" value="LATE — RR compressed, require tighter confirmation" color={dt.amber} dt={dt} />
        <Row label="≥ 35% ATR used" value="MID — move developing, room to run" color={dt.green} dt={dt} />
        <Row label="< 35% ATR used" value="EARLY — range still wide open" color={dt.green} dt={dt} />
      </Card>

      <Card dt={dt} title="Multi-Day Position Sizing" icon={<Calendar size={15} />} accent={dt.violet}>
        <Row label="Intraday portion" value="50-75% of position — exit by EOD or at T1" color={dt.text} dt={dt} />
        <Row label="Runner portion" value="25-50% — held overnight up to 5 days" color={dt.amber} dt={dt} />
        <Row label="Max account risk" value="1-2% per position (including gap risk)" color={dt.red} dt={dt} />
        <Row label="Gap risk sizing" value="Size so a 3-5% gap against you = max 1-2% account loss" color={dt.red} dt={dt} />
        <div style={{ marginTop: 8, fontSize: 11, color: dt.amber, fontStyle: 'italic' }}>
          In volatile environments, the runner portion can be increased to 50% — but gap risk must be calculated and tolerated.
        </div>
      </Card>
    </div>
  )
}

// ─── Common Mistakes ───────────────────────────────────────────────────────────

function CommonMistakes({ dt }: { dt: DtTokens }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: dt.muted, marginBottom: 14, lineHeight: 1.55 }}>
        The engine actively detects chasing and FOMO patterns. When chasing is detected, GO is downgraded to WAIT.
        Understanding these patterns is the single biggest lever for improving your win rate.
      </div>

      <Card dt={dt} title="Chasing Detection — GO → WAIT Triggers" icon={<AlertTriangle size={15} />} accent={dt.red}>
        <CheckItem text="Price at ±2σ — statistical extreme, mean-reversion probable" ok={false} dt={dt} />
        <CheckItem text="OR breakout already at +1σ with >60% range used — late to the move" ok={false} dt={dt} />
        <CheckItem text="OR broke >45 min ago — late to breakout/breakdown" ok={false} dt={dt} />
        <CheckItem text="Momentum spike without volume (|mom| >0.8%, RVOL <1.0) — exhaustion" ok={false} dt={dt} />
        <CheckItem text="Lower highs forming on long bias — momentum rolling over" ok={false} dt={dt} />
        <CheckItem text="Higher lows forming on short bias — momentum recovering" ok={false} dt={dt} />
      </Card>

      <Card dt={dt} title="Risk Classifications" icon={<Shield size={15} />} accent={dt.amber}>
        <Row label="EXTENSION" value="HIGH (±2σ) / MEDIUM (±1σ) — price at band extreme" color={dt.amber} dt={dt} />
        <Row label="LOW_PARTICIPATION" value="HIGH (<0.6× RVOL) / LOW (<0.9×) — false-move risk" color={dt.amber} dt={dt} />
        <Row label="MACRO_CONFLICT" value="MEDIUM — bias conflicts with OR direction" color={dt.amber} dt={dt} />
        <Row label="VOLATILITY" value="HIGH (VIX ≥30) / MEDIUM (≥25) — gap + premium decay" color={dt.amber} dt={dt} />
        <Row label="EXHAUSTION" value="HIGH (≥80% range) / LOW (≥60%) — move near completion" color={dt.amber} dt={dt} />
        <Row label="REVERSAL" value="MEDIUM — OR breakout failed, price back inside OR" color={dt.red} dt={dt} />
      </Card>

      <Card dt={dt} title="Psychology — What the engine tells you" icon={<Eye size={15} />} accent={dt.violet}>
        <div style={{ fontSize: 11.5, color: dt.text, lineHeight: 1.6, fontStyle: 'italic' }}>
          <p style={{ margin: '0 0 8px' }}><strong style={{ color: dt.red }}>Chasing:</strong> "What looks like momentum is mostly complete. The RR that existed earlier is gone. Chasing here is statistically losing. The next setup will be better than this one — protect your capital for it."</p>
          <p style={{ margin: '0 0 8px' }}><strong style={{ color: dt.muted }}>NO-GO:</strong> "Skipping a bad setup is more profitable than forcing a marginal one."</p>
          <p style={{ margin: '0 0 8px' }}><strong style={{ color: dt.green }}>PRIME + EARLY:</strong> "Multiple timeframes align. The difficult part is waiting for these moments — not trading the noise in between."</p>
          <p style={{ margin: '0 0 8px' }}><strong style={{ color: dt.amber }}>LATE:</strong> "Even if direction is correct, RR is compressed. Good trades come from good entries — not good directions entered poorly."</p>
          <p style={{ margin: '0' }}><strong style={{ color: dt.muted }}>No edge:</strong> "The hardest skill in trading is knowing when to do nothing."</p>
        </div>
      </Card>

      <Card dt={dt} title="Explicit Warnings to Heed" icon={<XCircle size={15} />} accent={dt.red}>
        <CheckItem text="Avoid entering while price is below VWAP (long) / above VWAP (short)" ok={false} dt={dt} />
        <CheckItem text="Avoid entering at VWAP — a rejection here turns the setup bearish quickly" ok={false} dt={dt} />
        <CheckItem text="Do not enter while price is inside the opening range" ok={false} dt={dt} />
        <CheckItem text="Low-volume re-tests often fail — patience here saves the trade" ok={false} dt={dt} />
        <CheckItem text="If price closes below ORH, the breakout has failed — exit immediately" ok={false} dt={dt} />
        <CheckItem text="Do not short in the middle — both VWAP and ORL are too far for a clean stop" ok={false} dt={dt} />
        <CheckItem text="Spreads widen at EOD — reversals accelerate, no time to manage a bad fill" ok={false} dt={dt} />
      </Card>

      <Card dt={dt} title="Multi-Day Hold Mistakes" icon={<Calendar size={15} />} accent={dt.red}>
        <CheckItem text="Holding through earnings — IV crush + gap risk is catastrophic" ok={false} dt={dt} />
        <CheckItem text="Holding through FOMC/CPI/Jobs reports — gap risk is unpredictable" ok={false} dt={dt} />
        <CheckItem text="Not setting a gap plan — if it gaps below stop, exit at open, do not hope" ok={false} dt={dt} />
        <CheckItem text="Extending beyond 5 days — the thesis has a time window, respect it" ok={false} dt={dt} />
        <CheckItem text="Not trailing the stop — give profits back waiting for T2" ok={false} dt={dt} />
        <CheckItem text="Holding a full position overnight — always split into intraday + runner" ok={false} dt={dt} />
      </Card>

      <Card dt={dt} title="Pullback Probability Factors" icon={<Activity size={15} />} accent={dt.amber}>
        <div style={{ fontSize: 11.5, color: dt.muted, marginBottom: 8 }}>
          The engine calculates pullback probability from these factors — high pullback probability means wait, don't chase:
        </div>
        <Row label="Distance from VWAP > 0.3%" value="+6 points" color={dt.amber} dt={dt} />
        <Row label="Strong momentum" value="+7 points" color={dt.amber} dt={dt} />
        <Row label="No volume spike" value="+3 points" color={dt.amber} dt={dt} />
        <Row label="VWAP hold failed" value="+10 points" color={dt.red} dt={dt} />
        <Row label="Waiting for VWAP hold/break" value="+5 points" color={dt.amber} dt={dt} />
        <Row label="VWAP test" value="+2 points" color={dt.amber} dt={dt} />
        <div style={{ marginTop: 8 }}>
          <Row label="HIGH pullback" value="≥ 8 points — wait for it to come back" color={dt.red} dt={dt} />
          <Row label="MODERATE pullback" value="≥ 5 points — be cautious" color={dt.amber} dt={dt} />
          <Row label="LOW pullback" value="< 5 points — momentum is real" color={dt.green} dt={dt} />
        </div>
      </Card>
    </div>
  )
}
