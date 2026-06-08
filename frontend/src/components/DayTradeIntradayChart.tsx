import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { DayTradeChartBar } from '../api/client'

export interface ZoneAnnotation {
  key: string
  /** Start bar index (inclusive) */
  from: number
  /** End bar index (inclusive) */
  to: number
  fill: string
  label: string
  sublabel: string
  markerColor: string | null
  cardBg: string
  cardBorder: string
  textColor: string
  badgeText?: string | null
  badgeBg?: string
  /** e.g. "$356 · SHORT" — shown on annotation card */
  price?: string
  /** Full explanation text — card is only rendered when this is present */
  detail?: string
  /** WAIT cards only: the single "Flip to GO" trigger condition in plain English */
  flipCondition?: string
  /** RE-ENTRY cards only: the specific candle/price entry trigger */
  reentryTrigger?: string
}

function isChartBar(x: unknown): x is DayTradeChartBar {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return (
    typeof o.t === 'string'
    && typeof o.o === 'number'
    && typeof o.h === 'number'
    && typeof o.l === 'number'
    && typeof o.c === 'number'
    && typeof o.v === 'number'
    && typeof o.vwap === 'number'
  )
}

export function parseChartBars(raw: unknown): DayTradeChartBar[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const out: DayTradeChartBar[] = []
  for (const item of raw) {
    if (!isChartBar(item)) return null
    out.push(item)
  }
  return out
}

const PAD = { l: 56, r: 12, t: 18, b: 34 }

function fmtEtShort(iso: string) {
  if (!iso || typeof iso !== 'string') return ''
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    const tz = (typeof window !== 'undefined' && localStorage?.getItem('oa_timezone')) || 'America/New_York'
    return d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: tz,
    })
  } catch {
    return ''
  }
}

function fmtPrice(n: number) {
  if (!Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  const d = abs >= 100 ? 2 : abs >= 10 ? 2 : abs >= 1 ? 3 : 4
  return n.toFixed(d)
}

export interface ChartEntryPoint {
  label: string   // "E1", "E2", "E3"
  price: number
  trigger: string // short description for table
  stop?: number
  color?: string  // CSS color — defaults to per-index color
  direction?: 'long' | 'short'  // arrow direction; default 'long'
  exitPrice?: number             // optional take-profit line
  rr?: number                   // risk/reward ratio — entries < 1.0 are flagged
  stub?: boolean                 // table-only placeholder (no price/chart line)
  pending?: boolean              // conditional setup not yet triggered — dashed line, no arrow
}

const ENTRY_COLORS = [
  '#34d399', // emerald
  '#38bdf8', // sky
  '#a78bfa', // violet
  '#fbbf24', // amber (4th if needed)
]

const TL_H = 60 // timeline SVG height (px)

export default function DayTradeIntradayChart({
  bars,
  orHigh,
  orLow,
  orMinutes,
  sessionDate,
  entryPoints,
  dimEntries,
  zones,
  isDark = false,
}: {
  bars: DayTradeChartBar[]
  orHigh: number
  orLow: number
  orMinutes: number
  sessionDate: string
  entryPoints?: ChartEntryPoint[]
  /** When true, entry lines/chips render dimmed — verdict is WAIT/CONFLICT */
  dimEntries?: boolean
  zones?: ZoneAnnotation[]
  isDark?: boolean
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [cw, setCw] = useState(0)
  const uid = useId().replace(/:/g, '')
  const clipId = `daytrade-plot-clip-${uid}`
  // Set of entry indices that are hidden (empty = all visible)
  const [hidden, setHidden] = useState<Set<number>>(new Set())

  // Zone selection state — auto-selects 'entry' zone on first render
  const [selectedZone, setSelectedZone] = useState<string | null>(null)
  const zoneAutoSelectedRef = useRef(false)
  useEffect(() => {
    if (!zones || zones.length === 0 || zoneAutoSelectedRef.current) return
    zoneAutoSelectedRef.current = true
    setSelectedZone(zones.find(z => z.key === 'entry') ? 'entry' : zones[0]!.key)
  }, [zones])

  // Scroll active annotation card into view
  useEffect(() => {
    if (!selectedZone) return
    const card = document.querySelector(`[data-zone-key="${selectedZone}"]`)
    card?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [selectedZone])

  // Reset toggles when entry points change (new scan result)
  useEffect(() => {
    setHidden(new Set())
  }, [entryPoints])

  // useLayoutEffect so cw is measured before the first paint — prevents
  // rendering with cw=0 (fallback) which causes the chart to be narrower
  // than its container and leave a large empty gap on the right.
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setCw(Math.max(320, el.clientWidth))
    })
    ro.observe(el)
    setCw(Math.max(320, el.clientWidth))
    return () => ro.disconnect()
  }, [])

  // Entries for the chart (exclude stubs and bad-R/R entries — no line to draw)
  const validEntryPoints = useMemo(() => {
    if (!entryPoints) return undefined
    return entryPoints.filter(ep => !ep.stub && !(ep.rr != null && ep.rr < 1.0))
  }, [entryPoints])

  // All entries for the table (stubs and bad-R/R still shown, grayed)
  const displayEntryPoints = entryPoints

  const displayFirstTouchData = useMemo(() => {
    if (!displayEntryPoints) return []
    return displayEntryPoints.map(ep => {
      if (ep.stub || !ep.price) return null
      for (let i = orMinutes; i < bars.length; i++) {
        const b = bars[i]!
        if (b.l <= ep.price && ep.price <= b.h) return { time: fmtEtShort(b.t), barIndex: i }
      }
      return null
    })
  }, [displayEntryPoints, bars, orMinutes])

  const displayFirstTouchTimes = useMemo(
    () => displayFirstTouchData.map(d => d?.time ?? null),
    [displayFirstTouchData]
  )

  const layout = useMemo(() => {
    const n = bars.length
    if (n < 2) return null

    const times = bars.map(b => new Date(b.t).getTime())
    const tMin = times[0]!
    const tMax = times[n - 1]!
    const span = Math.max(1, tMax - tMin)

    const bandKeys = ['vwap_upper1','vwap_lower1','vwap_upper2','vwap_lower2'] as const
    let yMin = Math.min(
      ...bars.map(b => b.l), orLow, ...bars.map(b => b.vwap),
      ...bandKeys.flatMap(k => bars.map(b => b[k]).filter((v): v is number => v != null))
    )
    let yMax = Math.max(
      ...bars.map(b => b.h), orHigh, ...bars.map(b => b.vwap),
      ...bandKeys.flatMap(k => bars.map(b => b[k]).filter((v): v is number => v != null))
    )
    const padY = (yMax - yMin) * 0.06 || yMin * 0.002 || 0.01
    yMin -= padY
    yMax += padY

    const innerH = 220
    /** Wide enough for ~2px per bar minimum; parent can scroll horizontally. */
    const innerW = Math.max(n * 2.2, cw - PAD.l - PAD.r)
    const W = PAD.l + PAD.r + innerW
    const H = PAD.t + innerH + PAD.b

    const slot = innerW / n
    const bodyW = Math.max(1, Math.min(8, slot * 0.72))

    // Bars span the full plotting area with no right gap.
    const plotW = innerW - slot * 0.5
    const xAt = (tMs: number) => PAD.l + slot * 0.5 + ((tMs - tMin) / span) * plotW
    const yAt = (p: number) => PAD.t + ((yMax - p) / (yMax - yMin)) * innerH

    const lastOrI = Math.max(0, Math.min(orMinutes, n) - 1)
    const orStartX = xAt(times[0]!)
    const orEndX = xAt(times[lastOrI]!) + slot * 0.5

    const ticks = 5
    const yTicks: number[] = []
    for (let i = 0; i < ticks; i++) {
      yTicks.push(yMin + ((yMax - yMin) * i) / (ticks - 1))
    }

    // 2-hour vertical grid lines and labels
    const TWO_HOUR = 2 * 60 * 60 * 1000
    const firstLabel = Math.ceil(tMin / TWO_HOUR) * TWO_HOUR
    const xTicks: { tMs: number; label: string }[] = []
    for (let tm = firstLabel; tm <= tMin + span; tm += TWO_HOUR) {
      xTicks.push({ tMs: tm, label: fmtEtShort(new Date(tm).toISOString()) })
    }

    return {
      W, H, innerW, innerH, xAt, yAt, bodyW, slot,
      yMin, yMax, yTicks, orStartX, orEndX, tMin, span, xTicks, times,
    }
  }, [bars, cw, orHigh, orLow, orMinutes])

  // Don't render until container width is known — avoids the wrong-width flash
  if (cw === 0) {
    return <div ref={wrapRef} className="day-trade-chart w-full min-w-0" style={{ minHeight: 270 }} />
  }

  if (!layout) {
    return (
      <p className="text-xs text-gray-500 py-2 day-trade-chart">
        Not enough bars to chart.
      </p>
    )
  }

  const { W, H, innerW, innerH, xAt, yAt, bodyW, slot, yMin, yMax, yTicks,
          orStartX, orEndX, tMin, times, xTicks } = layout

  const vwapPts = bars
    .map((b, i) => `${xAt(times[i]!)},${yAt(b.vwap)}`)
    .join(' ')

  const toggleEntry = (idx: number) => {
    setHidden(prev => {
      const next = new Set(prev)
      next.has(idx) ? next.delete(idx) : next.add(idx)
      return next
    })
  }

  return (
    <div ref={wrapRef} className="day-trade-chart w-full min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Session chart (1m)
        </div>
        <div className="text-[11px] text-gray-500">
          {sessionDate ? `${sessionDate} PT` : 'Last RTH'}{' · '}
          <span className="text-semantic-accent">VWAP</span>
          {' · '}
          <span className="text-semantic-warning">OR high / low</span>
          {' · '}
          <span className="text-tertiary">Opening range (first {orMinutes}×1m)</span>
          {' · '}
          <span style={{ color: 'var(--bullish)' }}>▲</span>
          <span style={{ color: 'var(--bearish)' }}>▼</span>
          {' '}
          <span className="text-gray-600">bias flip</span>
          {bars.some(b => b.vwap_upper1 != null) && (
            <><span className="text-gray-500"> · </span><span className="text-info">±1σ</span><span className="text-gray-500"> · </span><span className="text-info" style={{ opacity: 0.5 }}>±2σ</span></>
          )}
        </div>
      </div>

      {/* ── Entry toggle chips ── */}
      {displayEntryPoints && displayEntryPoints.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {dimEntries && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full border border-amber-700/40 bg-amber-950/30 text-[10px] text-amber-500 font-medium">
              ⚠ Signal present — verdict is WAIT
            </span>
          )}
          {displayEntryPoints.map((ep, idx) => {
            if (ep.stub || (ep.rr != null && ep.rr < 1.0)) return null
            const color = ep.color ?? ENTRY_COLORS[idx % ENTRY_COLORS.length]!
            const isHidden = hidden.has(idx)
            const effectiveDim = dimEntries && !isHidden
            const chipColor = isHidden || effectiveDim ? '#6b7280' : color
            return (
              <button
                key={`chip-${idx}`}
                type="button"
                onClick={() => toggleEntry(idx)}
                className="flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium transition-opacity cursor-pointer select-none"
                style={{
                  borderColor: isHidden || effectiveDim ? 'rgba(75,85,99,0.5)' : color,
                  color: chipColor,
                  background: isHidden || effectiveDim ? 'transparent' : `${color}18`,
                  opacity: isHidden ? 0.55 : effectiveDim ? 0.4 : 1,
                }}
                title={dimEntries ? `${ep.label} — signal exists but verdict is WAIT` : (isHidden ? `Show ${ep.label}` : `Hide ${ep.label}`)}
              >
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: chipColor, display: 'inline-block', flexShrink: 0 }} />
                {ep.label}
                <span className="font-mono" style={{ opacity: 0.8 }}>${fmtPrice(ep.price)}</span>
              </button>
            )
          })}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-800/80 bg-black/20">
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          className="block max-w-none min-w-max"
          role="img"
          aria-label={`Intraday candlesticks for ${sessionDate} with VWAP and opening range levels`}
        >
          <defs>
            <clipPath id={clipId}>
              <rect x={PAD.l} y={PAD.t} width={innerW} height={innerH} />
            </clipPath>
          </defs>

          {/* ── Zone strips (behind OR shading and candles) ── */}
          {zones?.map(z => {
            const from = Math.min(z.from, bars.length - 1)
            const to   = Math.min(z.to,   bars.length - 1)
            if (from > to || !times[from] || !times[to]) return null
            const x1 = xAt(times[from]!) - slot / 2
            const x2 = xAt(times[to]!) + slot / 2
            const w  = x2 - x1
            if (w <= 0) return null
            const sel = selectedZone === z.key
            return (
              <g key={`zone-${z.key}`} clipPath={`url(#${clipId})`}
                style={{ cursor: 'pointer' }} onClick={() => setSelectedZone(z.key)}>
                <rect x={x1} y={PAD.t} width={w} height={innerH} fill={z.fill} />
                {sel && <rect x={x1} y={PAD.t} width={w} height={innerH} fill={z.fill} fillOpacity={0.6} />}
                {sel && z.markerColor && (
                  <>
                    <line x1={x1} y1={PAD.t} x2={x1} y2={PAD.t + innerH}
                      stroke={z.markerColor} strokeWidth={1.5} strokeOpacity={0.55} />
                    <line x1={x2} y1={PAD.t} x2={x2} y2={PAD.t + innerH}
                      stroke={z.markerColor} strokeWidth={1.5} strokeOpacity={0.55} />
                  </>
                )}
              </g>
            )
          })}

          {orEndX > orStartX && (
            <rect
              x={orStartX}
              y={PAD.t}
              width={orEndX - orStartX}
              height={innerH}
              fill="var(--accent)"
              fillOpacity={0.08}
              clipPath={`url(#${clipId})`}
            />
          )}

          {yTicks.map((yt, i) => (
            <g key={`yg-${i}`}>
              <line
                x1={PAD.l}
                x2={PAD.l + innerW}
                y1={yAt(yt)}
                y2={yAt(yt)}
                stroke="var(--chart-grid)"
                strokeOpacity={0.35}
                strokeWidth={1}
              />
              <text
                x={PAD.l - 6}
                y={yAt(yt)}
                dy="0.35em"
                textAnchor="end"
                fill="var(--chart-axis)"
                fontSize={10}
                fontFamily="ui-monospace, monospace"
              >
                {fmtPrice(yt)}
              </text>
            </g>
          ))}

          <line
            x1={PAD.l} x2={PAD.l + innerW}
            y1={yAt(orHigh)} y2={yAt(orHigh)}
            stroke="var(--chart-line-ma50)" strokeWidth={1.2}
            strokeDasharray="6 4" strokeOpacity={0.95}
            clipPath={`url(#${clipId})`}
          />
          <line
            x1={PAD.l} x2={PAD.l + innerW}
            y1={yAt(orLow)} y2={yAt(orLow)}
            stroke="var(--chart-line-ma50)" strokeWidth={1.2}
            strokeDasharray="6 4" strokeOpacity={0.95}
            clipPath={`url(#${clipId})`}
          />
          <text x={PAD.l + innerW - 4} y={yAt(orHigh) - 4} textAnchor="end"
            fill="var(--chart-line-ma50)" fontSize={9} fontWeight={600}>OR high</text>
          <text x={PAD.l + innerW - 4} y={yAt(orLow) + 12} textAnchor="end"
            fill="var(--chart-line-ma50)" fontSize={9} fontWeight={600}>OR low</text>

          <g clipPath={`url(#${clipId})`}>
            {bars.map((b, i) => {
              const cx = xAt(times[i]!)
              const yL = yAt(b.l), yH = yAt(b.h)
              const yO = yAt(b.o), yC = yAt(b.c)
              const top = Math.min(yO, yC), bot = Math.max(yO, yC)
              const up = b.c >= b.o
              const bh = Math.max(1, bot - top)
              return (
                <g key={`${b.t}-${i}`}>
                  <line x1={cx} x2={cx} y1={yL} y2={yH} stroke="var(--chart-grid)" strokeWidth={1} />
                  <rect x={cx - bodyW / 2} y={top} width={bodyW} height={bh}
                    fill={up ? 'var(--bullish)' : 'var(--bearish)'} fillOpacity={0.92} />
                </g>
              )
            })}
          </g>

          <polyline fill="none" stroke="var(--chart-line-iv)" strokeWidth={1.5}
            strokeLinejoin="round" strokeLinecap="round"
            points={vwapPts} clipPath={`url(#${clipId})`} />

          {/* ── VWAP bias-flip markers (full session) ── */}
          {bars.map((b, i) => {
            if (i === 0) return null
            const prev = bars[i - 1]!
            const prevAbove = prev.c >= prev.vwap
            const currAbove = b.c >= b.vwap
            if (prevAbove === currAbove) return null          // no flip
            const cx = xAt(times[i]!)
            const vy = yAt(b.vwap)
            const bullish = currAbove                         // flipped up → bullish
            const color = bullish ? 'var(--bullish)' : 'var(--bearish)'
            // Triangle: ▲ below VWAP line for bullish flip, ▼ above for bearish flip
            const ty = bullish ? vy + 10 : vy - 10
            const size = 4
            const pts = bullish
              ? `${cx},${ty - size} ${cx - size},${ty + size} ${cx + size},${ty + size}`
              : `${cx},${ty + size} ${cx - size},${ty - size} ${cx + size},${ty - size}`
            return (
              <polygon
                key={`vflip-${i}`}
                points={pts}
                fill={color}
                fillOpacity={0.9}
                clipPath={`url(#${clipId})`}
              />
            )
          })}

          {/* VWAP ±1σ bands */}
          {bars.some(b => b.vwap_upper1 != null) && (() => {
            const u1 = bars.map((b,i) => b.vwap_upper1 != null ? `${xAt(times[i]!)},${yAt(b.vwap_upper1)}` : '').filter(Boolean).join(' ')
            const l1 = bars.map((b,i) => b.vwap_lower1 != null ? `${xAt(times[i]!)},${yAt(b.vwap_lower1)}` : '').filter(Boolean).join(' ')
            return (
              <>
                <polyline fill="none" stroke="var(--chart-line-rsi)" strokeWidth={1} strokeDasharray="4 3" strokeOpacity={0.5} strokeLinejoin="round" points={u1} clipPath={`url(#${clipId})`} />
                <polyline fill="none" stroke="var(--chart-line-rsi)" strokeWidth={1} strokeDasharray="4 3" strokeOpacity={0.5} strokeLinejoin="round" points={l1} clipPath={`url(#${clipId})`} />
              </>
            )
          })()}

          {/* VWAP ±2σ bands */}
          {bars.some(b => b.vwap_upper2 != null) && (() => {
            const u2 = bars.map((b,i) => b.vwap_upper2 != null ? `${xAt(times[i]!)},${yAt(b.vwap_upper2)}` : '').filter(Boolean).join(' ')
            const l2 = bars.map((b,i) => b.vwap_lower2 != null ? `${xAt(times[i]!)},${yAt(b.vwap_lower2)}` : '').filter(Boolean).join(' ')
            return (
              <>
                <polyline fill="none" stroke="var(--chart-line-rsi)" strokeWidth={0.8} strokeDasharray="2 4" strokeOpacity={0.25} strokeLinejoin="round" points={u2} clipPath={`url(#${clipId})`} />
                <polyline fill="none" stroke="var(--chart-line-rsi)" strokeWidth={0.8} strokeDasharray="2 4" strokeOpacity={0.25} strokeLinejoin="round" points={l2} clipPath={`url(#${clipId})`} />
              </>
            )
          })()}

          <rect x={PAD.l} y={PAD.t} width={innerW} height={innerH}
            fill="none" stroke="var(--chart-grid)" strokeWidth={1} opacity={0.6} />

          {/* Session open label + 2-hour grid lines */}
          <text x={PAD.l} y={H - 10} textAnchor="start" fill="var(--chart-axis)" fontSize={10}>
            {fmtEtShort(new Date(tMin).toISOString())}
          </text>
          {xTicks.map((xt, i) => {
            const x = xAt(xt.tMs)
            if (x < PAD.l || x > PAD.l + innerW) return null
            return (
              <g key={`xt-${i}`}>
                <line x1={x} y1={PAD.t} x2={x} y2={PAD.t + innerH}
                  stroke="var(--chart-grid)" strokeOpacity={0.2} strokeWidth={1} />
                <text x={x} y={H - 10} textAnchor="middle" fill="var(--chart-axis)" fontSize={10}>
                  {xt.label}
                </text>
              </g>
            )
          })}

          <text x={PAD.l} y={12} fill="var(--chart-axis)" fontSize={10}>
            Price · {fmtPrice(yMax)} → {fmtPrice(yMin)}
          </text>

          {/* ── Entry price lines (respects toggle) ── */}
          {displayEntryPoints?.map((ep, idx) => {
            if (hidden.has(idx)) return null
            if (!Number.isFinite(ep.price) || ep.price <= 0) return null
            if (ep.price < yMin || ep.price > yMax) return null
            const ey = yAt(ep.price)
            const color = dimEntries ? '#6b7280' : (ep.color ?? ENTRY_COLORS[idx % ENTRY_COLORS.length]!)
            const isPending = ep.pending === true
            return (
              <g key={`entry-${idx}`} opacity={dimEntries ? 0.4 : isPending ? 0.45 : 1}>
                <line
                  x1={PAD.l} x2={PAD.l + innerW}
                  y1={ey} y2={ey}
                  stroke={color} strokeWidth={isPending ? 1 : 1.2}
                  strokeDasharray={isPending ? '2 6' : '3 3'} strokeOpacity={0.9}
                  clipPath={`url(#${clipId})`}
                />
                <text
                  x={PAD.l + 4}
                  y={Math.max(PAD.t + 9, ey - 4)}
                  textAnchor="start" fill={color} fontSize={9} fontWeight={600}
                >
                  {ep.label} · ${fmtPrice(ep.price)}{isPending ? ' (watching)' : ''}
                </text>
              </g>
            )
          })}

          {/* ── Entry arrow markers on the trigger candle ── */}
          {displayEntryPoints?.map((ep, idx) => {
            if (hidden.has(idx)) return null
            if (ep.pending) return null  // pending entries have no confirmed trigger yet
            const touch = displayFirstTouchData[idx]
            if (!touch) return null
            const bar = bars[touch.barIndex]!
            const color = dimEntries ? '#6b7280' : (ep.color ?? ENTRY_COLORS[idx % ENTRY_COLORS.length]!)
            const isShort = ep.direction === 'short'
            const cx = xAt(times[touch.barIndex]!)
            const arrowSize = 6
            // Short: arrow above candle high pointing down; Long: arrow below candle low pointing up
            if (isShort) {
              const ty = yAt(bar.h) - 14
              const pts = `${cx},${ty + arrowSize} ${cx - arrowSize},${ty - arrowSize} ${cx + arrowSize},${ty - arrowSize}`
              return (
                <g key={`earrow-${idx}`} clipPath={`url(#${clipId})`} opacity={dimEntries ? 0.35 : 1}>
                  <polygon points={pts} fill={color} fillOpacity={0.95} />
                  <text x={cx} y={ty - arrowSize - 3} textAnchor="middle" fill={color} fontSize={8} fontWeight={700}>
                    {ep.label}
                  </text>
                </g>
              )
            } else {
              const ty = yAt(bar.l) + 14
              const pts = `${cx},${ty - arrowSize} ${cx - arrowSize},${ty + arrowSize} ${cx + arrowSize},${ty + arrowSize}`
              return (
                <g key={`earrow-${idx}`} clipPath={`url(#${clipId})`} opacity={dimEntries ? 0.35 : 1}>
                  <polygon points={pts} fill={color} fillOpacity={0.95} />
                  <text x={cx} y={ty + arrowSize + 9} textAnchor="middle" fill={color} fontSize={8} fontWeight={700}>
                    {ep.label}
                  </text>
                </g>
              )
            }
          })}

          {/* ── Exit / take-profit lines ── */}
          {displayEntryPoints?.map((ep, idx) => {
            if (hidden.has(idx)) return null
            if (!ep.exitPrice || !Number.isFinite(ep.exitPrice)) return null
            if (ep.exitPrice < yMin || ep.exitPrice > yMax) return null
            const ey = yAt(ep.exitPrice)
            const color = ep.color ?? ENTRY_COLORS[idx % ENTRY_COLORS.length]!
            return (
              <g key={`exit-${idx}`} clipPath={`url(#${clipId})`}>
                <line
                  x1={PAD.l} x2={PAD.l + innerW}
                  y1={ey} y2={ey}
                  stroke={color} strokeWidth={1}
                  strokeDasharray="2 5" strokeOpacity={0.6}
                />
                <text
                  x={PAD.l + innerW - 4}
                  y={ey - 4}
                  textAnchor="end" fill={color} fontSize={8} fontWeight={600} fillOpacity={0.8}
                >
                  {ep.label} exit · ${fmtPrice(ep.exitPrice)}
                </text>
              </g>
            )
          })}

          {/* ── Zone labels (topmost layer — after candles/lines) ── */}
          {zones?.map(z => {
            const from = Math.min(z.from, bars.length - 1)
            const to   = Math.min(z.to,   bars.length - 1)
            if (from > to || !times[from] || !times[to]) return null
            const x1 = xAt(times[from]!) - slot / 2
            const x2 = xAt(times[to]!) + slot / 2
            const w  = x2 - x1
            if (w < 20) return null
            const lblW = Math.min(w - 4, z.label.length * 5.8 + 10)
            const subW = Math.min(w - 4, z.sublabel.length * 4.8 + 8)
            const textFill = isDark ? z.textColor : 'rgba(0,0,0,0.78)'
            const bgFill   = isDark ? 'rgba(0,0,0,0.48)' : 'rgba(255,255,255,0.78)'
            return (
              <g key={`zone-lbl-${z.key}`} clipPath={`url(#${clipId})`}
                style={{ pointerEvents: 'none' }}>
                <rect x={x1 + 2} y={PAD.t + 2} width={lblW} height={12}
                  fill={bgFill} rx={2} />
                <text x={x1 + 5} y={PAD.t + 11}
                  fill={textFill} fontSize={9} fontWeight={600}
                  style={{ userSelect: 'none' }}>
                  {z.label}
                </text>
                {w > 80 && (
                  <>
                    <rect x={x1 + 2} y={PAD.t + 15} width={subW} height={11}
                      fill={bgFill} rx={2} />
                    <text x={x1 + 5} y={PAD.t + 23}
                      fill={textFill} fontSize={8} opacity={0.8}
                      style={{ userSelect: 'none' }}>
                      {z.sublabel}
                    </text>
                  </>
                )}
              </g>
            )
          })}
        </svg>

        {/* ── Timeline bar panel (PART 2) ── */}
        {zones && zones.length > 0 && (
          <svg
            width={W}
            height={TL_H}
            viewBox={`0 0 ${W} ${TL_H}`}
            className="block max-w-none min-w-max"
            style={{ borderTop: isDark ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(0,0,0,0.08)' }}
          >
            <rect x={PAD.l} y={0} width={innerW} height={TL_H - 20}
              fill={isDark ? 'rgba(0,0,0,0.28)' : 'rgba(0,0,0,0.04)'} />
            {zones.filter(z => z.markerColor).map(z => {
              const from = Math.min(z.from, bars.length - 1)
              const to   = Math.min(z.to,   bars.length - 1)
              const midIdx = Math.min(Math.floor((from + to) / 2), bars.length - 1)
              if (!times[midIdx]) return null
              const cx  = xAt(times[midIdx]!)
              const bw  = Math.max(8, slot * 0.8)
              const sel = selectedZone === z.key
              const tlTextFill = isDark ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.72)'
              return (
                <g key={`tl-${z.key}`} style={{ cursor: 'pointer' }}
                  onClick={() => setSelectedZone(z.key)}>
                  <title>{z.label}</title>
                  <rect x={cx - bw / 2} y={4} width={bw} height={TL_H - 28}
                    fill={z.markerColor + (isDark ? '33' : '28')} stroke={z.markerColor!}
                    strokeWidth={sel ? 2 : 1.5} rx={3} opacity={sel ? 1 : 0.75} />
                  <text x={cx} y={TL_H - 6} textAnchor="middle"
                    fill={sel ? (isDark ? z.textColor : z.markerColor!) : tlTextFill}
                    fontSize={7.5} fontWeight={sel ? 700 : 500}
                    style={{ userSelect: 'none' }}>
                    {z.label.split(' ').slice(0, 2).join(' ')}
                  </text>
                </g>
              )
            })}
            <rect x={PAD.l} y={0} width={innerW} height={TL_H - 20}
              fill="none" stroke={isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.10)'}
              strokeWidth={1} />
          </svg>
        )}
      </div>

      {/* ── Annotation cards (PART 3) — only zones with detail text ── */}
      {zones && zones.some(z => z.detail) && (
        <div className="mt-3 flex flex-col gap-2">
          {zones.filter(z => z.detail).map(z => {
            const from = Math.min(z.from, bars.length - 1)
            const to   = Math.min(z.to,   bars.length - 1)
            const midIdx = Math.min(Math.floor((from + to) / 2), bars.length - 1)
            const midTime = times[midIdx] ? fmtEtShort(new Date(times[midIdx]!).toISOString()) : ''
            const sel = selectedZone === z.key
            return (
              <div
                key={`card-${z.key}`}
                data-zone-key={z.key}
                onClick={() => setSelectedZone(z.key)}
                className="rounded-lg px-3 py-2.5 cursor-pointer transition-all"
                style={{
                  background: z.cardBg,
                  border: `1px solid ${sel ? z.cardBorder : 'rgba(255,255,255,0.06)'}`,
                  boxShadow: sel ? `0 0 0 1px ${z.cardBorder}40` : 'none',
                  opacity: sel ? 1 : 0.75,
                }}
              >
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  {z.markerColor && (
                    <span style={{
                      width: 8, height: 8, borderRadius: 2,
                      background: z.markerColor, display: 'inline-block', flexShrink: 0,
                    }} />
                  )}
                  <span className="text-[11px] font-semibold" style={{ color: z.textColor }}>
                    {z.label}
                  </span>
                  {z.badgeText && (
                    <span
                      className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide"
                      style={{ background: z.badgeBg ?? 'rgba(255,255,255,0.1)', color: z.textColor }}
                    >
                      {z.badgeText}
                    </span>
                  )}
                  {z.price && (
                    <span className="font-mono text-[11px]" style={{ color: z.textColor, opacity: 0.85 }}>
                      {z.price}
                    </span>
                  )}
                  {midTime && (
                    <span className="ml-auto font-mono text-[10px] text-gray-500">{midTime}</span>
                  )}
                </div>
                <p className={`text-[11px] leading-relaxed m-0 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>{z.detail}</p>
                {z.flipCondition && (
                  <div style={{ background: 'rgba(255,255,255,0.05)', borderLeft: '3px solid #E8A020', borderRadius: '0 6px 6px 0', padding: '8px 12px', marginTop: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 500, color: '#E8A020' }}>⚡ Flip to GO if: </span>
                    <span style={{ fontSize: 12, color: '#c2c0b6' }}>{z.flipCondition}</span>
                  </div>
                )}
                {z.reentryTrigger && (
                  <div style={{ background: isDark ? 'rgba(59,130,246,0.08)' : 'rgba(59,130,246,0.06)', borderLeft: '3px solid #3b82f6', borderRadius: '0 6px 6px 0', padding: '8px 12px', marginTop: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 500, color: '#60a5fa' }}>Entry: </span>
                    <span style={{ fontSize: 12, color: isDark ? '#93c5fd' : '#1d4ed8' }}>{z.reentryTrigger}</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Entry points table ── */}
      {displayEntryPoints && displayEntryPoints.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-[11px] border-collapse">
            <thead>
              <tr className="border-b border-gray-800/60">
                <th className="pb-1 text-left font-medium text-gray-500 uppercase tracking-wide pr-3">Entry</th>
                <th className="pb-1 text-right font-mono font-medium text-gray-500 uppercase tracking-wide pr-3">Price</th>
                <th className="pb-1 text-right font-mono font-medium text-gray-500 uppercase tracking-wide pr-3">Time</th>
                <th className="pb-1 text-left font-medium text-gray-500 uppercase tracking-wide pr-3">Trigger</th>
                <th className="pb-1 text-right font-mono font-medium text-gray-500 uppercase tracking-wide">Stop</th>
              </tr>
            </thead>
            <tbody>
              {displayEntryPoints.map((ep, idx) => {
                const isUnavailable = ep.stub || (ep.rr != null && ep.rr < 1.0)
                const color = ep.color ?? ENTRY_COLORS[idx % ENTRY_COLORS.length]!
                const isHidden = hidden.has(idx)
                const touchTime = displayFirstTouchTimes[idx]
                const rowOpacity = isUnavailable ? 0.45 : isHidden ? 0.38 : dimEntries ? 0.4 : 1
                const rowTitle = isUnavailable
                  ? `${ep.label} — AI Coach entry (not actionable${ep.rr != null ? `, R/R ${ep.rr.toFixed(1)}×` : ''})`
                  : isHidden ? `Click to show ${ep.label} on chart`
                  : dimEntries ? `${ep.label} — signal exists but verdict is WAIT`
                  : `Click to hide ${ep.label} on chart`
                return (
                  <tr
                    key={`erow-${idx}`}
                    className={`border-b border-gray-800/40 last:border-0 transition-opacity ${isUnavailable ? 'cursor-default' : 'cursor-pointer'}`}
                    style={{ opacity: rowOpacity }}
                    onClick={isUnavailable ? undefined : () => toggleEntry(idx)}
                    title={rowTitle}
                  >
                    <td className="py-1 pr-3 font-semibold" style={{ color: isUnavailable || isHidden || dimEntries ? '#6b7280' : color }}>
                      <span className="inline-flex items-center gap-1">
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: isUnavailable || isHidden || dimEntries ? '#4b5563' : color, display: 'inline-block' }} />
                        {ep.label}
                      </span>
                    </td>
                    <td className="py-1 pr-3 text-right font-mono text-gray-200">
                      {ep.stub || !ep.price ? '—' : `$${fmtPrice(ep.price)}`}
                    </td>
                    <td className="py-1 pr-3 text-right font-mono text-gray-400">
                      {ep.pending ? (
                        <span className="text-amber-500/70 text-[10px] font-medium">Watching</span>
                      ) : (touchTime ?? '—')}
                    </td>
                    <td className="py-1 pr-3 text-gray-400">
                      {ep.stub ? (
                        <span className="text-gray-600 italic">AI Coach</span>
                      ) : ep.rr != null && ep.rr < 1.0 ? (
                        <span>{ep.trigger} <span className="text-orange-500/70 text-[10px]">(low R/R)</span></span>
                      ) : dimEntries ? (
                        <span>{ep.trigger} <span className="text-yellow-500/60 text-[10px]">(WAIT)</span></span>
                      ) : ep.pending ? (
                        <span>{ep.trigger} <span className="text-amber-500/60 text-[10px]">(no confirmation yet)</span></span>
                      ) : ep.trigger}
                    </td>
                    <td className="py-1 text-right font-mono text-red-400">
                      {ep.stop && ep.stop > 0 ? `$${fmtPrice(ep.stop)}` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="mt-1 text-[10px] text-gray-600">Click an entry row or chip above to toggle its line on the chart.</div>
        </div>
      )}
    </div>
  )
}
