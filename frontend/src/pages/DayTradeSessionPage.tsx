import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { fetchOptionChainLiquidity, type OptionChainLiquidityResponse, type OptionChainRow } from '../api/client'

/* ── Types ─────────────────────────────────────────────────────────────── */

interface PriceBar {
  t: string
  o: number; h: number; l: number; c: number
  v: number
  vwap: number
}

interface SessionAlert {
  id: string
  time: string
  timeIndex: number
  type: 'open' | 'confirmed' | 'watching'
  direction: 'SHORT' | 'LONG'
  entryPrice: number
  stop: number
  target: number
  trigger: string
  volumeConfirmed: boolean
  rrRatio: number
  verdict: 'best' | 'marginal' | 'skip' | 'watching'
  note: string
  outcomeReached: boolean
}

interface TooltipState {
  x: number
  y: number
  alert: SessionAlert
}

/* ── Constants ─────────────────────────────────────────────────────────── */

const VERDICT_COLOR: Record<string, string> = {
  best:     '#34d399',
  marginal: '#fbbf24',
  skip:     '#fb7185',
  watching: '#38bdf8',
}

const TYPE_LABEL: Record<string, string> = {
  open:      'Entry window OPEN',
  confirmed: 'Setup confirmed',
  watching:  'Watching',
}

const TYPE_COLOR: Record<string, string> = {
  open:      '#fbbf24',
  confirmed: '#34d399',
  watching:  '#38bdf8',
}

const CHART_PAD = { l: 56, r: 12, t: 18, b: 28 } as const
const PA_H = 200  // Panel A inner height (px)
const PB_H = 70   // Panel B inner height (px)

/* ── Mock data ─────────────────────────────────────────────────────────── */

function buildBars(): PriceBar[] {
  // 90 × 1-min bars: 6:30–8:00 AM PT on June 5 2026
  // Price story: gap-up open, rally to OR high, OR low breakdown, dead cat, continuation, recovery
  const start = new Date('2026-06-05T13:30:00.000Z') // 6:30 AM PT = 13:30 UTC
  const bars: PriceBar[] = []
  let price = 18.72
  let cumVP = 0
  let cumV = 0

  for (let i = 0; i < 90; i++) {
    const t = new Date(start.getTime() + i * 60_000).toISOString()
    const drift =
      i < 5  ? +0.08 :
      i < 15 ? +0.012 :
      i < 22 ? -0.045 :
      i < 30 ? -0.018 :
      i < 38 ? -0.07 :
      i < 48 ? +0.025 :
      i < 65 ? -0.035 :
               +0.022
    const n1 = Math.sin(i * 0.73 + 1.1) * 0.055
    const n2 = Math.sin(i * 1.37 + 0.4) * 0.022
    const c = Math.max(15, Math.min(24, price + drift + n1 + n2))
    const o = price
    const amp = Math.abs(c - o) * 0.45 + 0.032
    const h = Math.max(o, c) + Math.abs(Math.sin(i * 2.1 + 0.5)) * amp
    const l = Math.min(o, c) - Math.abs(Math.sin(i * 1.73 + 0.3)) * amp
    const v = 60_000 + Math.abs(Math.sin(i * 0.91 + 0.2)) * 350_000
    cumVP += ((h + l + c) / 3) * v
    cumV += v
    bars.push({ t, o, h, l, c, v, vwap: cumVP / cumV })
    price = c
  }
  return bars
}

const BARS = buildBars()
const OR_N = 30
const OR_HIGH = Math.max(...BARS.slice(0, OR_N).map(b => b.h))
const OR_LOW  = Math.min(...BARS.slice(0, OR_N).map(b => b.l))

function buildAlerts(): SessionAlert[] {
  const b = BARS
  const mk = (
    id: string, time: string, idx: number,
    type: SessionAlert['type'], dir: 'SHORT' | 'LONG',
    stopDist: number, tgtDist: number,
    trigger: string, volConf: boolean,
    verdict: SessionAlert['verdict'],
    note: string, outcomeReached: boolean,
  ): SessionAlert => {
    const entry = b[idx]!.c
    const stop   = dir === 'SHORT' ? entry + stopDist : entry - stopDist
    const target = dir === 'SHORT' ? entry - tgtDist  : entry + tgtDist
    const rrRatio = Math.round((tgtDist / stopDist) * 10) / 10
    return { id, time, timeIndex: idx, type, direction: dir, entryPrice: entry,
             stop, target, trigger, volumeConfirmed: volConf, rrRatio, verdict, note, outcomeReached }
  }
  return [
    mk('a1', '6:52 AM', 22, 'watching', 'LONG',  0.18, 0.46, 'VWAP retest',             false, 'watching', 'Price testing VWAP — no volume confirmation yet', false),
    mk('a2', '7:03 AM', 33, 'confirmed','SHORT',  0.16, 0.56, 'OR low breakdown',         true,  'best',     'OR low breakout — breakdown detected, high volume flush', true),
    mk('a3', '7:16 AM', 46, 'open',     'SHORT',  0.18, 0.36, 'Dead cat bounce rejection',false, 'marginal', 'Bounce to breakdown level — volume not confirming, wait', false),
    mk('a4', '7:26 AM', 56, 'confirmed','SHORT',  0.15, 0.50, 'Lower high continuation',  true,  'best',     'Lower high confirmed — trend continuation, strong R/R', true),
    mk('a5', '7:43 AM', 73, 'watching', 'LONG',   0.22, 0.60, 'Oversold reversal watch',  false, 'watching', 'Potential reversal zone — watching for volume confirmation', false),
  ]
}

const ALERTS = buildAlerts()

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function fmtP(n: number) {
  return Math.abs(n) >= 10 ? n.toFixed(2) : n.toFixed(3)
}

function ptTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true,
      timeZone: 'America/Los_Angeles',
    })
  } catch { return '' }
}

/* ══════════════════════════════════════════════════════════════════════════
   SECTION 1 — Alert List
══════════════════════════════════════════════════════════════════════════ */

function AlertList({
  alerts, selectedId, onSelect, alertRowRefs,
}: {
  alerts: SessionAlert[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  alertRowRefs: React.MutableRefObject<Map<string, HTMLDivElement>>
}) {
  const COL = '68px 172px 68px 72px 72px 72px 112px 1fr'

  return (
    <section
      className="flex-shrink-0 border-b border-gray-800/60"
      style={{ background: '#0f0f0f' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-gray-800/40">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Alert Timeline</span>
        <span className="text-[10px] text-gray-600">{alerts.length} alerts · click to sync chart &amp; analysis</span>
      </div>

      {/* Column labels */}
      <div
        className="grid px-4 py-1 text-[9px] uppercase tracking-wide text-gray-700 font-medium select-none"
        style={{ gridTemplateColumns: COL }}
      >
        <span>Time</span><span>Type</span><span>Dir</span>
        <span>Entry</span><span>Stop</span><span>Target</span>
        <span>Volume</span><span>Note</span>
      </div>

      {/* Rows */}
      <div style={{ maxHeight: 162, overflowY: 'auto' }}>
        {alerts.map(alert => {
          const sel = selectedId === alert.id
          const vc  = VERDICT_COLOR[alert.verdict]!
          const tc  = TYPE_COLOR[alert.type]!
          return (
            <div
              key={alert.id}
              ref={el => { if (el) alertRowRefs.current.set(alert.id, el) }}
              onClick={() => onSelect(sel ? null : alert.id)}
              className="grid items-center gap-x-2 px-4 py-1.5 cursor-pointer transition-colors"
              style={{
                gridTemplateColumns: COL,
                background: sel ? `${vc}14` : 'transparent',
                borderLeft: `3px solid ${sel ? vc : 'transparent'}`,
                borderBottom: '1px solid rgba(255,255,255,0.028)',
              }}
            >
              <span className="font-mono text-[11px] text-gray-400">{alert.time}</span>

              <span
                className="px-1.5 py-0.5 rounded text-[10px] font-medium w-fit truncate"
                style={{ background: `${tc}1e`, color: tc, border: `1px solid ${tc}40` }}
              >
                {TYPE_LABEL[alert.type]}
              </span>

              <span
                className="px-1.5 py-0.5 rounded text-[10px] font-bold w-fit"
                style={{
                  background: alert.direction === 'SHORT' ? 'rgba(251,113,133,0.14)' : 'rgba(52,211,153,0.14)',
                  color: alert.direction === 'SHORT' ? '#fb7185' : '#34d399',
                }}
              >
                {alert.direction}
              </span>

              <span className="font-mono text-[11px] text-gray-200">${fmtP(alert.entryPrice)}</span>
              <span className="font-mono text-[11px] text-red-400">${fmtP(alert.stop)}</span>
              <span className="font-mono text-[11px] text-teal-400">${fmtP(alert.target)}</span>

              <span className={`text-[10px] font-medium ${alert.volumeConfirmed ? 'text-emerald-400' : 'text-gray-600'}`}>
                {alert.volumeConfirmed ? '✓ Confirmed' : 'Pending'}
              </span>

              <span className="text-[11px] text-gray-500 truncate">{alert.note}</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

/* ══════════════════════════════════════════════════════════════════════════
   SECTION 2 — Dual-Panel Chart
══════════════════════════════════════════════════════════════════════════ */

function SessionChart({
  bars, alerts, orHigh, orLow, orN, selectedId, onSelect,
}: {
  bars: PriceBar[]
  alerts: SessionAlert[]
  orHigh: number
  orLow: number
  orN: number
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [cw, setCw] = useState(0)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setCw(Math.max(400, el.clientWidth)))
    ro.observe(el)
    setCw(Math.max(400, el.clientWidth))
    return () => ro.disconnect()
  }, [])

  const layout = useMemo(() => {
    if (!cw || bars.length < 2) return null
    const n = bars.length
    const innerW = cw - CHART_PAD.l - CHART_PAD.r
    const slot = innerW / n
    const bodyW = Math.max(1, Math.min(6, slot * 0.68))

    let yMin = Math.min(...bars.map(b => b.l), orLow,  ...bars.map(b => b.vwap))
    let yMax = Math.max(...bars.map(b => b.h), orHigh, ...bars.map(b => b.vwap))
    const pad = (yMax - yMin) * 0.065 || 0.02
    yMin -= pad; yMax += pad

    const xAt = (i: number) => CHART_PAD.l + slot * (i + 0.5)
    const yAt = (p: number) => CHART_PAD.t + ((yMax - p) / (yMax - yMin)) * PA_H

    const yTicks = Array.from({ length: 5 }, (_, k) => yMin + ((yMax - yMin) * k) / 4)
    const xTicks: { i: number; label: string }[] = []
    for (let i = 0; i < n; i += 15) xTicks.push({ i, label: ptTime(bars[i]!.t) })

    return { n, innerW, slot, bodyW, xAt, yAt, yMin, yMax, yTicks, xTicks }
  }, [cw, bars, orHigh, orLow])

  if (!cw) return <div ref={wrapRef} style={{ minHeight: 340, background: '#080808' }} />
  if (!layout) return null

  const { innerW, slot, bodyW, xAt, yAt, yTicks, xTicks } = layout

  const PA_SVG_H = CHART_PAD.t + PA_H + CHART_PAD.b
  const PB_SVG_H = 4 + PB_H + CHART_PAD.b

  const vwapPts = bars.map((b, i) => `${xAt(i).toFixed(1)},${yAt(b.vwap).toFixed(1)}`).join(' ')

  return (
    <section
      ref={wrapRef}
      className="flex-shrink-0 border-b border-gray-800/60 relative"
      style={{ background: '#080808' }}
    >
      {/* Section header */}
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-gray-800/40">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">
          Session Chart · 1m · CIEN
        </span>
        <div className="flex items-center gap-3 text-[9px] text-gray-600 select-none">
          <span><span style={{ color: '#f472b6' }}>—</span> VWAP</span>
          <span><span style={{ color: '#fbbf24' }}>- -</span> OR</span>
          <span style={{ color: '#2dd4bf' }}>- -</span><span style={{ color: '#2dd4bf', marginLeft: -6 }}>Target</span>
          <span><span style={{ color: '#34d399' }}>●</span> Best</span>
          <span><span style={{ color: '#fbbf24' }}>○</span> Entry</span>
          <span><span style={{ color: '#fb7185' }}>✕</span> Skip</span>
          <span><span style={{ color: '#38bdf8' }}>◆</span> Watch</span>
        </div>
      </div>

      {/* ─── Panel A: Price action ─── */}
      <svg width={cw} height={PA_SVG_H} style={{ display: 'block' }}>
        <defs>
          <clipPath id="pa-clip">
            <rect x={CHART_PAD.l} y={CHART_PAD.t} width={innerW} height={PA_H} />
          </clipPath>
        </defs>

        {/* Y grid + labels */}
        {yTicks.map((yt, k) => (
          <g key={`yg-${k}`}>
            <line x1={CHART_PAD.l} x2={CHART_PAD.l + innerW}
              y1={yAt(yt)} y2={yAt(yt)}
              stroke="rgba(55,65,81,0.38)" strokeWidth={1} />
            <text x={CHART_PAD.l - 5} y={yAt(yt)} dy="0.35em"
              textAnchor="end" fill="#4b5563" fontSize={9}
              fontFamily="ui-monospace,monospace">
              {fmtP(yt)}
            </text>
          </g>
        ))}

        {/* OR shading */}
        <rect x={CHART_PAD.l} y={CHART_PAD.t}
          width={slot * orN} height={PA_H}
          fill="rgba(251,191,36,0.055)" clipPath="url(#pa-clip)" />

        {/* OR high / low dashed lines */}
        <line x1={CHART_PAD.l} x2={CHART_PAD.l + innerW}
          y1={yAt(orHigh)} y2={yAt(orHigh)}
          stroke="#fbbf24" strokeWidth={1.1} strokeDasharray="6 4" strokeOpacity={0.75}
          clipPath="url(#pa-clip)" />
        <line x1={CHART_PAD.l} x2={CHART_PAD.l + innerW}
          y1={yAt(orLow)} y2={yAt(orLow)}
          stroke="#fbbf24" strokeWidth={1.1} strokeDasharray="6 4" strokeOpacity={0.75}
          clipPath="url(#pa-clip)" />
        <text x={CHART_PAD.l + innerW - 4} y={yAt(orHigh) - 3}
          textAnchor="end" fill="#fbbf24" fontSize={8} fontWeight={600}>
          OR H {fmtP(orHigh)}
        </text>
        <text x={CHART_PAD.l + innerW - 4} y={yAt(orLow) + 10}
          textAnchor="end" fill="#fbbf24" fontSize={8} fontWeight={600}>
          OR L {fmtP(orLow)}
        </text>

        {/* Candles */}
        <g clipPath="url(#pa-clip)">
          {bars.map((b, i) => {
            const cx = xAt(i)
            const up = b.c >= b.o
            const col = up ? '#34d399' : '#fb7185'
            const yH = yAt(b.h), yL = yAt(b.l)
            const yO = yAt(b.o), yC = yAt(b.c)
            const top = Math.min(yO, yC)
            const bh = Math.max(1, Math.max(yO, yC) - top)
            return (
              <g key={i}>
                <line x1={cx} x2={cx} y1={yH} y2={yL} stroke={col} strokeWidth={1} />
                <rect x={cx - bodyW / 2} y={top} width={bodyW} height={bh}
                  fill={col} fillOpacity={0.88} />
              </g>
            )
          })}
        </g>

        {/* VWAP */}
        <polyline fill="none" stroke="#f472b6" strokeWidth={1.6}
          strokeLinejoin="round" strokeLinecap="round"
          points={vwapPts} clipPath="url(#pa-clip)" />

        {/* Target lines (selected alert or best verdict) */}
        {alerts.map(alert => {
          const show = alert.id === selectedId || alert.verdict === 'best'
          if (!show) return null
          const ty = yAt(alert.target)
          if (ty < CHART_PAD.t - 2 || ty > CHART_PAD.t + PA_H + 2) return null
          const x1 = xAt(alert.timeIndex)
          return (
            <line key={`tgt-${alert.id}`}
              x1={x1} x2={CHART_PAD.l + innerW}
              y1={ty} y2={ty}
              stroke="#2dd4bf" strokeWidth={1} strokeDasharray="4 4" strokeOpacity={0.55}
              clipPath="url(#pa-clip)" />
          )
        })}

        {/* Alert markers */}
        {alerts.map(alert => {
          const x = xAt(alert.timeIndex)
          const y = yAt(alert.entryPrice)
          const vc = VERDICT_COLOR[alert.verdict]!
          const sel = alert.id === selectedId
          const r = sel ? 8 : 6

          return (
            <g
              key={`mkr-${alert.id}`}
              style={{ cursor: 'pointer' }}
              clipPath="url(#pa-clip)"
              onClick={(e) => { e.stopPropagation(); onSelect(sel ? null : alert.id) }}
              onMouseEnter={(e) => setTooltip({ x: e.clientX, y: e.clientY, alert })}
              onMouseLeave={() => setTooltip(null)}
            >
              {sel && (
                <circle cx={x} cy={y} r={r + 6}
                  fill="none" stroke={vc} strokeWidth={1.2} strokeOpacity={0.4} />
              )}
              {alert.verdict === 'best' && (
                <circle cx={x} cy={y} r={r} fill={vc} fillOpacity={0.92} />
              )}
              {alert.verdict === 'marginal' && (
                <circle cx={x} cy={y} r={r}
                  fill={sel ? `${vc}30` : 'none'} stroke={vc} strokeWidth={2} />
              )}
              {alert.verdict === 'skip' && (
                <>
                  <line x1={x - r} y1={y - r} x2={x + r} y2={y + r}
                    stroke={vc} strokeWidth={2.2} />
                  <line x1={x + r} y1={y - r} x2={x - r} y2={y + r}
                    stroke={vc} strokeWidth={2.2} />
                </>
              )}
              {alert.verdict === 'watching' && (
                <polygon
                  points={`${x},${y - r} ${x + r},${y} ${x},${y + r} ${x - r},${y}`}
                  fill={vc} fillOpacity={0.88} />
              )}
              {/* Direction label */}
              <text
                x={x}
                y={alert.direction === 'SHORT' ? y - r - 3 : y + r + 10}
                textAnchor="middle" fill={vc} fontSize={7} fontWeight={700}
              >
                {alert.direction === 'SHORT' ? '▼' : '▲'}
              </text>
            </g>
          )
        })}

        {/* X axis ticks */}
        {xTicks.map(({ i, label }) => (
          <text key={`xt-${i}`} x={xAt(i)} y={PA_SVG_H - 8}
            textAnchor="middle" fill="#4b5563" fontSize={9}>
            {label}
          </text>
        ))}

        {/* Outer border */}
        <rect x={CHART_PAD.l} y={CHART_PAD.t} width={innerW} height={PA_H}
          fill="none" stroke="rgba(55,65,81,0.35)" strokeWidth={1} />
      </svg>

      {/* ─── Panel B: Alert timeline ─── */}
      <div className="border-t border-gray-800/50">
        <div className="flex items-center gap-2 px-4 py-1 border-b border-gray-800/30">
          <span className="text-[9px] uppercase tracking-widest text-gray-700 font-semibold">Alert timeline</span>
          <span className="text-[9px] text-gray-700">· click band to sync</span>
        </div>
        <svg width={cw} height={PB_SVG_H} style={{ display: 'block' }}>
          {/* Background */}
          <rect x={CHART_PAD.l} y={4} width={innerW} height={PB_H}
            fill="rgba(0,0,0,0.45)" />

          {/* Vertical bands */}
          {alerts.map(alert => {
            const bx = xAt(alert.timeIndex)
            const vc = VERDICT_COLOR[alert.verdict]!
            const sel = alert.id === selectedId
            const bw = Math.max(slot * 0.75, 14)
            const rrLabel = `${alert.rrRatio}×`

            return (
              <g
                key={`band-${alert.id}`}
                style={{ cursor: 'pointer' }}
                onClick={() => onSelect(sel ? null : alert.id)}
              >
                <rect x={bx - bw / 2} y={4} width={bw} height={PB_H}
                  fill={vc} fillOpacity={sel ? 0.32 : 0.12} />
                <line x1={bx} x2={bx} y1={4} y2={4 + PB_H}
                  stroke={vc} strokeWidth={sel ? 2.5 : 1.5} strokeOpacity={0.9} />
                <text x={bx} y={4 + PB_H * 0.38}
                  textAnchor="middle" fill={vc} fontSize={8.5} fontWeight={600}>
                  {alert.time}
                </text>
                <text x={bx} y={4 + PB_H * 0.65}
                  textAnchor="middle" fill={vc} fontSize={7.5} fontWeight={500}>
                  {alert.verdict === 'best' ? 'BEST' :
                    alert.verdict === 'marginal' ? 'MARG' :
                    alert.verdict === 'skip' ? 'SKIP' : 'WATCH'}
                </text>
                <text x={bx} y={4 + PB_H * 0.88}
                  textAnchor="middle" fill={vc} fontSize={7} fillOpacity={0.7}>
                  {rrLabel}
                </text>
              </g>
            )
          })}

          {/* Outer border */}
          <rect x={CHART_PAD.l} y={4} width={innerW} height={PB_H}
            fill="none" stroke="rgba(55,65,81,0.35)" strokeWidth={1} />
        </svg>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          style={{
            position: 'fixed',
            left: tooltip.x + 14,
            top: tooltip.y - 12,
            background: 'rgba(13,13,13,0.97)',
            border: `1px solid ${VERDICT_COLOR[tooltip.alert.verdict]}50`,
            borderRadius: 8,
            padding: '8px 12px',
            pointerEvents: 'none',
            zIndex: 9999,
            minWidth: 210,
            boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
          }}
        >
          <div
            className="text-xs font-semibold mb-1"
            style={{ color: VERDICT_COLOR[tooltip.alert.verdict] }}
          >
            {tooltip.alert.time} · {tooltip.alert.verdict.toUpperCase()}
          </div>
          <div className="text-[11px] text-gray-400 mb-1.5">{tooltip.alert.trigger}</div>
          <div className="flex gap-3 font-mono text-[11px] mb-1">
            <span>E <span className="text-gray-100">${fmtP(tooltip.alert.entryPrice)}</span></span>
            <span>S <span className="text-red-400">${fmtP(tooltip.alert.stop)}</span></span>
            <span>T <span className="text-teal-400">${fmtP(tooltip.alert.target)}</span></span>
          </div>
          <div className="text-[10px]" style={{ color: VERDICT_COLOR[tooltip.alert.verdict] }}>
            {tooltip.alert.rrRatio}× R/R
            {tooltip.alert.volumeConfirmed ? ' · Vol confirmed' : ' · Vol pending'}
          </div>
          <div className="text-[10px] text-gray-600 mt-1">{tooltip.alert.direction} · {TYPE_LABEL[tooltip.alert.type]}</div>
        </div>
      )}
    </section>
  )
}

/* ══════════════════════════════════════════════════════════════════════════
   SECTION 3 — Step-by-Step Analysis
══════════════════════════════════════════════════════════════════════════ */

function AnalysisSection({
  alerts, selectedId, onSelect, cardRefs,
}: {
  alerts: SessionAlert[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  cardRefs: React.MutableRefObject<Map<string, HTMLDivElement>>
}) {
  return (
    <section style={{ background: '#0a0a0a' }}>
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-gray-800/40">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">
          Step-by-Step Analysis
        </span>
        <span className="text-[10px] text-gray-600">click card to sync chart &amp; list</span>
      </div>

      <div style={{ overflowX: 'auto', padding: '10px 16px 14px' }}>
        <div style={{ display: 'flex', gap: 10, minWidth: 'max-content' }}>
          {alerts.map((alert, idx) => {
            const sel = alert.id === selectedId
            const vc  = VERDICT_COLOR[alert.verdict]!
            const stopDist = Math.abs(alert.entryPrice - alert.stop)
            const tgtDist  = Math.abs(alert.entryPrice - alert.target)
            const risk100  = (stopDist * 100).toFixed(0)
            const rwd100   = (tgtDist  * 100).toFixed(0)

            const verdictText =
              alert.verdict === 'best'     ? 'Best Entry — high-confidence, full size' :
              alert.verdict === 'marginal' ? 'Marginal — reduce size, wait for volume' :
              alert.verdict === 'skip'     ? 'Skip — poor R/R or conflicting signals' :
                                             'Watching — needs candle + volume confirm'

            const contextDiff = alert.entryPrice - OR_LOW
            const contextText = contextDiff > 0
              ? `${fmtP(contextDiff)} above OR low`
              : `${fmtP(Math.abs(contextDiff))} below OR low`

            return (
              <div
                key={alert.id}
                ref={el => { if (el) cardRefs.current.set(alert.id, el) }}
                onClick={() => onSelect(sel ? null : alert.id)}
                style={{
                  width: 262,
                  flexShrink: 0,
                  background: sel ? `${vc}0c` : '#111',
                  border: `1px solid ${sel ? vc + '45' : 'rgba(255,255,255,0.06)'}`,
                  borderRadius: 10,
                  padding: '10px 12px',
                  cursor: 'pointer',
                  transition: 'border-color 0.15s, background 0.15s',
                }}
              >
                {/* Card header */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-gray-600 text-[10px] font-mono">#{idx + 1}</span>
                    <span className="font-mono text-xs font-semibold" style={{ color: vc }}>
                      {alert.time}
                    </span>
                    <span
                      className="text-[9px] font-bold px-1 py-0.5 rounded"
                      style={{ background: `${vc}20`, color: vc }}
                    >
                      {alert.verdict.toUpperCase()}
                    </span>
                  </div>
                  <span
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                    style={{
                      background: alert.direction === 'SHORT' ? 'rgba(251,113,133,0.14)' : 'rgba(52,211,153,0.14)',
                      color: alert.direction === 'SHORT' ? '#fb7185' : '#34d399',
                    }}
                  >
                    {alert.direction}
                  </span>
                </div>

                {/* Step 1 */}
                <div className="mb-2 pb-2 border-b border-gray-800/50">
                  <div className="text-[9px] font-semibold text-gray-700 uppercase tracking-wide mb-0.5">
                    1 · Trigger
                  </div>
                  <div className="text-[11px] text-gray-300">{alert.trigger}</div>
                </div>

                {/* Step 2 */}
                <div className="mb-2 pb-2 border-b border-gray-800/50">
                  <div className="text-[9px] font-semibold text-gray-700 uppercase tracking-wide mb-0.5">
                    2 · Price Context
                  </div>
                  <div className="text-[11px] text-gray-400">
                    Entry <span className="font-mono text-gray-200">${fmtP(alert.entryPrice)}</span>
                    {' · '}{contextText}
                  </div>
                </div>

                {/* Step 3 */}
                <div className="mb-2 pb-2 border-b border-gray-800/50">
                  <div className="text-[9px] font-semibold text-gray-700 uppercase tracking-wide mb-0.5">
                    3 · R/R
                  </div>
                  <div className="flex gap-2 font-mono text-[11px] mb-0.5">
                    <span className="text-gray-300">E ${fmtP(alert.entryPrice)}</span>
                    <span className="text-red-400">S ${fmtP(alert.stop)}</span>
                    <span className="text-teal-400">T ${fmtP(alert.target)}</span>
                  </div>
                  <div className="text-[10px] text-gray-600">
                    Risk ${risk100} · Reward ${rwd100} · {alert.rrRatio}× per 100 shares
                  </div>
                </div>

                {/* Step 4 */}
                <div className="mb-2 pb-2 border-b border-gray-800/50">
                  <div className="text-[9px] font-semibold text-gray-700 uppercase tracking-wide mb-0.5">
                    4 · Verdict
                  </div>
                  <div className="text-[11px] font-medium" style={{ color: vc }}>
                    {verdictText}
                  </div>
                </div>

                {/* Step 5 */}
                <div>
                  <div className="text-[9px] font-semibold text-gray-700 uppercase tracking-wide mb-0.5">
                    5 · Outcome
                  </div>
                  {alert.outcomeReached ? (
                    <div className="text-[11px] font-medium text-emerald-400">
                      ✓ Target reached — ${fmtP(alert.target)}
                    </div>
                  ) : alert.verdict === 'watching' ? (
                    <div className="text-[11px] text-gray-600">Pending confirmation</div>
                  ) : (
                    <div className="text-[11px] text-gray-600">Target not reached</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

/* ══════════════════════════════════════════════════════════════════════════
   SECTION 4 — Options Entry Check
══════════════════════════════════════════════════════════════════════════ */

function ocFindExpiry(expiries: string[], targetDte: number): string | null {
  if (!expiries.length) return null
  const now = Date.now()
  let best = expiries[0]!
  let bestD = Infinity
  for (const e of expiries) {
    const d = Math.abs(Math.max(0, Math.ceil((new Date(e + 'T00:00:00').getTime() - now) / 86_400_000)) - targetDte)
    if (d < bestD) { bestD = d; best = e }
  }
  return best
}

function ocVerdictStrip(
  trigger: 'GO' | 'WAIT' | 'WATCHING',
  pc: 'aligned' | 'conflict' | 'neutral',
  ss: 'ok' | 'warn' | 'bad' | null,
  flip: string,
  word: 'CALL' | 'PUT',
  atmStrike: number | null,
  stop: number,
): { tier: 'green' | 'amber' | 'red' | 'gray'; msg: string } {
  if (trigger === 'WATCHING')
    return { tier: 'gray', msg: `— Watching · No trigger yet · Wait for: ${flip}` }
  if (trigger === 'WAIT')
    return { tier: 'red', msg: `✗ Not ready · Trigger not fired · Flip to GO: ${flip}` }
  if (ss === 'bad')
    return { tier: 'red', msg: `✗ Not ready · Spread exceeds 10% day-trade limit · Flip to GO: ${flip}` }
  if (pc === 'conflict')
    return { tier: 'red', msg: `✗ Not ready · P/C ratio conflicts with session direction · Flip to GO: ${flip}` }
  if (ss === 'warn')
    return { tier: 'amber', msg: `⚠ Spread marginal · enter 1 contract only · confirm volume before entry` }
  if (pc === 'neutral')
    return { tier: 'amber', msg: `⚠ P/C ratio neutral — no directional confirmation · 1 contract only` }
  const s = atmStrike ? `Enter ${word} at ATM $${atmStrike.toFixed(2)} · ` : ''
  return { tier: 'green', msg: `✓ All checks passed · ${s}Set stop at $${stop.toFixed(2)} before clicking confirm` }
}

const OC_COLS = '72px 58px 58px 60px 66px 100px 48px'

function OptionsEntryCheck({
  ticker, direction, stopPrice, chartTrigger, flipCondition, pcAlignment, initialPrice,
}: {
  ticker: string
  direction: 'SHORT' | 'LONG'
  stopPrice: number
  chartTrigger: 'GO' | 'WAIT' | 'WATCHING'
  flipCondition: string
  pcAlignment: 'aligned' | 'conflict' | 'neutral'
  initialPrice: number
}) {
  const [expanded, setExpanded]     = useState(false)
  const [targetDte, setTargetDte]   = useState<5 | 7>(5)
  const [livePrice, setLivePrice]   = useState(initialPrice)
  const [draft, setDraft]           = useState(initialPrice.toFixed(2))
  const [data, setData]             = useState<OptionChainLiquidityResponse | null>(null)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const initRef                     = useRef(false)

  const doFetch = useCallback(async (expiry?: string) => {
    setLoading(true); setError(null)
    try {
      const r1 = await fetchOptionChainLiquidity(ticker, expiry)
      if (!expiry) {
        const best5 = ocFindExpiry(r1.expiries, 5)
        if (best5 && best5 !== r1.selected_expiry) {
          try {
            const r2 = await fetchOptionChainLiquidity(ticker, best5)
            setData(r2); return
          } catch { /* fall through to r1 */ }
        }
      }
      setData(r1)
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail ?? 'Failed to load option chain.')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [ticker])

  // Fetch once on first expand
  useEffect(() => {
    if (!expanded || initRef.current) return
    initRef.current = true
    doFetch()
  }, [expanded]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDte = (dte: 5 | 7) => {
    setTargetDte(dte)
    if (data) {
      const best = ocFindExpiry(data.expiries, dte)
      if (best) doFetch(best)
    }
  }

  // Derive 3 strikes from live price
  const side = direction === 'SHORT' ? 'put' : 'call'
  const rows: OptionChainRow[] = data ? (side === 'call' ? data.calls : data.puts) : []

  const atmIdx = rows.length > 0
    ? rows.reduce((b, r, i) => Math.abs(r.strike - livePrice) < Math.abs(rows[b]!.strike - livePrice) ? i : b, 0)
    : -1

  const three: { r: OptionChainRow; lbl: 'ITM' | 'ATM' | 'OTM' }[] = []
  if (atmIdx >= 0) {
    const atmRow = rows[atmIdx]!
    if (direction === 'SHORT') {
      // Puts: ITM = strike above price (higher index), OTM = strike below price (lower index)
      const itm = rows[atmIdx + 1]; const otm = rows[atmIdx - 1]
      if (itm) three.push({ r: itm, lbl: 'ITM' })
      three.push({ r: atmRow, lbl: 'ATM' })
      if (otm) three.push({ r: otm, lbl: 'OTM' })
    } else {
      // Calls: ITM = strike below price (lower index), OTM = strike above price (higher index)
      const itm = rows[atmIdx - 1]; const otm = rows[atmIdx + 1]
      if (itm) three.push({ r: itm, lbl: 'ITM' })
      three.push({ r: atmRow, lbl: 'ATM' })
      if (otm) three.push({ r: otm, lbl: 'OTM' })
    }
  }

  const atmRow  = three.find(x => x.lbl === 'ATM')?.r ?? null
  const ss      = atmRow ? (atmRow.spread_pct <= 5 ? 'ok' : atmRow.spread_pct <= 10 ? 'warn' : 'bad') as 'ok' | 'warn' | 'bad' : null
  const word    = (direction === 'SHORT' ? 'PUT' : 'CALL') as 'PUT' | 'CALL'
  const { tier, msg } = ocVerdictStrip(chartTrigger, pcAlignment, ss, flipCondition, word, atmRow?.strike ?? null, stopPrice)

  const vtBg  = tier === 'green' ? 'rgba(99,153,34,0.15)'    : tier === 'amber' ? 'rgba(232,123,58,0.10)' : tier === 'red' ? 'rgba(226,75,74,0.10)' : 'rgba(136,135,128,0.10)'
  const vtBdr = tier === 'green' ? '#639922'                  : tier === 'amber' ? '#E87B3A'               : tier === 'red' ? '#E24B4A'              : '#888780'
  const vtClr = tier === 'green' ? '#a3cc6a'                  : tier === 'amber' ? '#e8a06a'               : tier === 'red' ? '#e07070'              : '#888780'

  const liqColor = ss === 'ok' ? '#a3cc6a' : ss === 'warn' ? '#e8a06a' : ss === 'bad' ? '#e07070' : '#5A6478'
  const liqLbl   = ss === 'ok' ? '✓ Good'  : ss === 'warn' ? '⚠ Moderate' : ss === 'bad' ? '✗ Poor' : '—'
  const rt       = atmRow ? atmRow.spread * 2 * 100 : null
  const rtClr    = rt == null ? '#5A6478' : rt < 200 ? '#a3cc6a' : rt < 400 ? '#e8a06a' : '#e07070'
  const selDte   = data ? Math.max(0, Math.ceil((new Date(data.selected_expiry + 'T00:00:00').getTime() - Date.now()) / 86_400_000)) : null

  return (
    <section style={{ background: '#0f0f0f', borderTop: '1px solid rgba(255,255,255,0.04)', flexShrink: 0 }}>

      {/* ── Toggle row ── */}
      <div
        className="flex items-center justify-between px-4 py-2 cursor-pointer select-none"
        style={{ borderBottom: expanded ? '1px solid rgba(255,255,255,0.05)' : 'none' }}
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center gap-2.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">
            Options entry check
          </span>
          <span className="font-mono text-[11px] font-bold text-gray-300">{ticker}</span>
          <span
            className="px-1.5 py-0.5 rounded text-[9px] font-bold"
            style={{
              background: direction === 'SHORT' ? 'rgba(251,113,133,0.12)' : 'rgba(52,211,153,0.12)',
              color:      direction === 'SHORT' ? '#fb7185' : '#34d399',
            }}
          >
            {direction === 'SHORT' ? '▼ SHORT' : '▲ LONG'}
          </span>
          {data && selDte !== null && (
            <span className="text-[10px] text-gray-700">{selDte}DTE · {side}s</span>
          )}
        </div>

        <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
          {expanded && (
            <>
              <span style={{ fontSize: 10, color: '#5A6478' }}>price</span>
              <input
                type="text"
                inputMode="decimal"
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onBlur={() => {
                  const n = parseFloat(draft)
                  if (!isNaN(n) && n > 0) { setLivePrice(n); setDraft(n.toFixed(2)) }
                  else setDraft(livePrice.toFixed(2))
                }}
                onKeyDown={e => {
                  if (e.key !== 'Enter') return
                  const n = parseFloat(draft)
                  if (!isNaN(n) && n > 0) { setLivePrice(n); setDraft(n.toFixed(2)) }
                  else setDraft(livePrice.toFixed(2))
                  e.currentTarget.blur()
                }}
                style={{
                  width: 64, fontSize: 11, fontFamily: 'ui-monospace, monospace',
                  color: '#E8EBF0', background: 'transparent',
                  border: 'none', borderBottom: '1px solid #252C3A',
                  outline: 'none', textAlign: 'right', padding: '1px 0',
                }}
              />
            </>
          )}
          <span style={{ fontSize: 10, color: '#5A6478', marginLeft: 4 }}>
            {expanded ? '▲' : '▼'}
          </span>
        </div>
      </div>

      {/* ── Expanded body ── */}
      {expanded && (
        <div style={{ padding: '10px 16px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* DTE selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, color: '#5A6478' }}>DTE</span>
            {([5, 7] as const).map(dte => (
              <button
                key={dte}
                onClick={() => handleDte(dte)}
                style={{
                  fontSize: 11, padding: '3px 11px', borderRadius: 5, cursor: 'pointer',
                  border: '0.5px solid',
                  borderColor: targetDte === dte ? '#639922' : '#1E2330',
                  background:  targetDte === dte ? 'rgba(99,153,34,0.20)' : '#181C23',
                  color:       targetDte === dte ? '#a3cc6a' : '#5A6478',
                }}
              >
                {dte}DTE
              </button>
            ))}
            {loading && <span style={{ fontSize: 10, color: '#5A6478' }}>loading…</span>}
          </div>

          {/* Error */}
          {error && (
            <div style={{ fontSize: 11, color: '#e07070', padding: '6px 10px', borderRadius: 5, background: 'rgba(226,75,74,0.08)' }}>
              {error}
            </div>
          )}

          {/* Stat cards */}
          {atmRow && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {([
                { lbl: 'ATM strike', val: `$${atmRow.strike.toFixed(2)}`,               sub: null,                                                              clr: '#E8EBF0' },
                { lbl: 'Mid price',  val: `$${atmRow.mid.toFixed(2)}`,                  sub: `$${(atmRow.mid * 100).toFixed(0)} per contract`,                  clr: '#E8EBF0' },
                { lbl: 'Spread cost',val: `$${(atmRow.spread * 100).toFixed(0)}`,       sub: `${atmRow.spread_pct.toFixed(1)}% of premium`,                     clr: liqColor  },
                { lbl: 'Liquidity',  val: liqLbl,                                        sub: null,                                                              clr: liqColor  },
                { lbl: 'Round trip', val: rt != null ? `$${rt.toFixed(0)}` : '—',       sub: rt != null ? `entry + exit · 2× = $${(rt * 2).toFixed(0)}` : null, clr: rtClr     },
              ] as const).map(({ lbl, val, sub, clr }) => (
                <div key={lbl} style={{ flex: 1, minWidth: 90, background: '#111318', border: '0.5px solid #1E2330', borderRadius: 7, padding: '7px 11px' }}>
                  <div style={{ fontSize: 9, color: '#5A6478', marginBottom: 2 }}>{lbl}</div>
                  <div style={{ fontSize: 15, fontWeight: 500, color: clr }}>{val}</div>
                  {sub && <div style={{ fontSize: 9, color: '#5A6478', marginTop: 1 }}>{sub}</div>}
                </div>
              ))}
            </div>
          )}

          {/* 3-strike table */}
          {three.length > 0 && (
            <div style={{ border: '0.5px solid #1E2330', borderRadius: 7, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: OC_COLS, padding: '5px 10px', fontSize: 9, fontWeight: 600, color: '#3A4355', borderBottom: '0.5px solid #1E2330', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                <span>Strike</span><span>Bid</span><span>Ask</span>
                <span>Spread</span><span>Spread%</span><span>Status</span><span>IV</span>
              </div>
              {three.map(({ r, lbl }) => {
                const sp  = r.spread_pct <= 5 ? '#a3cc6a' : r.spread_pct <= 10 ? '#e8a06a' : '#e07070'
                const isA = lbl === 'ATM'
                const bs  = r.spread_pct <= 5
                  ? { bg: 'rgba(99,153,34,0.20)',  c: '#a3cc6a', t: '✓ Enter'     }
                  : r.spread_pct <= 10
                  ? { bg: 'rgba(232,123,58,0.20)', c: '#e8a06a', t: '⚠ Size down' }
                  : { bg: 'rgba(226,75,74,0.20)',  c: '#e07070', t: '✗ Skip'      }
                return (
                  <div
                    key={r.strike}
                    style={{
                      display: 'grid', gridTemplateColumns: OC_COLS,
                      alignItems: 'center', padding: '6px 10px',
                      borderBottom: '0.5px solid #141820',
                      fontSize: 11, color: '#E8EBF0',
                      borderLeft: `2px solid ${isA ? '#639922' : 'transparent'}`,
                      background: isA ? 'rgba(99,153,34,0.07)' : 'transparent',
                    }}
                  >
                    <span>
                      <span style={{ fontWeight: isA ? 600 : 400 }}>${r.strike.toFixed(2)}</span>
                      {' '}
                      <span style={{ fontSize: 8, color: isA ? '#639922' : '#3A4355' }}>{lbl}</span>
                    </span>
                    <span>${r.bid.toFixed(2)}</span>
                    <span>${r.ask.toFixed(2)}</span>
                    <span style={{ color: sp }}>${r.spread.toFixed(2)}</span>
                    <span style={{ color: sp }}>{r.spread_pct.toFixed(1)}%</span>
                    <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 3, fontWeight: 500, display: 'inline-block', background: bs.bg, color: bs.c }}>
                      {bs.t}
                    </span>
                    <span style={{ color: '#3A4355' }}>{r.iv > 200 ? '—' : `${r.iv.toFixed(0)}%`}</span>
                  </div>
                )
              })}
            </div>
          )}

          {/* Verdict strip */}
          {(data !== null || chartTrigger !== 'GO') && (
            <div style={{
              minHeight: 48, padding: '10px 14px',
              display: 'flex', alignItems: 'center',
              borderRadius: 6,
              background: vtBg,
              borderLeft: `3px solid ${vtBdr}`,
              fontSize: 12, color: vtClr, lineHeight: 1.5,
            }}>
              {msg}
            </div>
          )}

        </div>
      )}
    </section>
  )
}

/* ══════════════════════════════════════════════════════════════════════════
   Page root
══════════════════════════════════════════════════════════════════════════ */

export default function DayTradeSessionPage() {
  const ticker = 'CIEN'

  // Derive Options Entry Check inputs from mock session data
  const ocBestAlerts  = ALERTS.filter(a => a.verdict === 'best' && a.type === 'confirmed')
  const ocLatestBest  = ocBestAlerts[ocBestAlerts.length - 1]
  const ocDirection   = (ocLatestBest?.direction ?? 'SHORT') as 'SHORT' | 'LONG'
  const ocStop        = ocLatestBest?.stop ?? ALERTS[ALERTS.length - 1]!.stop
  const ocTrigger     = (ocLatestBest ? 'GO' : ALERTS.some(a => a.type === 'watching') ? 'WATCHING' : 'WAIT') as 'GO' | 'WAIT' | 'WATCHING'
  const ocFlip        = 'Two consecutive red candles closing below OR low with no wick recovery'
  const ocPcAlign     = 'aligned' as const
  const ocInitPrice   = BARS[BARS.length - 1]!.c

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const alertRowRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const cardRefs     = useRef<Map<string, HTMLDivElement>>(new Map())

  const select = useCallback((id: string | null) => setSelectedId(id), [])

  useEffect(() => {
    if (!selectedId) return
    alertRowRefs.current.get(selectedId)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    cardRefs.current.get(selectedId)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [selectedId])

  return (
    <div
      className="flex flex-col"
      style={{ background: '#0d0d0d', minHeight: '100%' }}
    >
      {/* ── Page header ── */}
      <div
        className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800/70"
        style={{ background: '#0a0a0a', flexShrink: 0 }}
      >
        <div className="flex items-center gap-3">
          <span className="font-mono text-lg font-bold text-white tracking-wide">{ticker}</span>
          <span
            className="px-2 py-0.5 rounded text-[10px] font-bold border"
            style={{ background: 'rgba(251,113,133,0.1)', color: '#fb7185', borderColor: 'rgba(251,113,133,0.3)' }}
          >
            DAY TRADE
          </span>
          <span className="text-gray-500 text-xs">Jun 5, 2026 · 6:30 AM – 8:00 AM PT</span>
        </div>
        <div className="flex items-center gap-4 text-[11px]">
          <span className="text-gray-500">OR High <span className="font-mono text-amber-400 ml-1">${fmtP(OR_HIGH)}</span></span>
          <span className="text-gray-500">OR Low <span className="font-mono text-amber-400 ml-1">${fmtP(OR_LOW)}</span></span>
          <span className="text-gray-600">{ALERTS.length} alerts</span>
          {selectedId && (
            <button
              className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors"
              onClick={() => setSelectedId(null)}
            >
              Clear selection ×
            </button>
          )}
        </div>
      </div>

      {/* ── Three sections ── */}
      <AlertList
        alerts={ALERTS}
        selectedId={selectedId}
        onSelect={select}
        alertRowRefs={alertRowRefs}
      />

      <OptionsEntryCheck
        ticker={ticker}
        direction={ocDirection}
        stopPrice={ocStop}
        chartTrigger={ocTrigger}
        flipCondition={ocFlip}
        pcAlignment={ocPcAlign}
        initialPrice={ocInitPrice}
      />

      <SessionChart
        bars={BARS}
        alerts={ALERTS}
        orHigh={OR_HIGH}
        orLow={OR_LOW}
        orN={OR_N}
        selectedId={selectedId}
        onSelect={select}
      />

      <AnalysisSection
        alerts={ALERTS}
        selectedId={selectedId}
        onSelect={select}
        cardRefs={cardRefs}
      />
    </div>
  )
}
