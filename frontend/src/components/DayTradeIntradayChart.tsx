import { useEffect, useMemo, useRef, useState } from 'react'
import type { DayTradeChartBar } from '../api/client'

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

const PAD = { l: 56, r: 10, t: 18, b: 34 }

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
  color?: string  // CSS color — defaults to bullish green
}

const ENTRY_COLORS = [
  '#34d399', // emerald
  '#38bdf8', // sky
  '#a78bfa', // violet
  '#fbbf24', // amber (4th if needed)
]

export default function DayTradeIntradayChart({
  bars,
  orHigh,
  orLow,
  orMinutes,
  sessionDate,
  entryPoints,
}: {
  bars: DayTradeChartBar[]
  orHigh: number
  orLow: number
  orMinutes: number
  sessionDate: string
  entryPoints?: ChartEntryPoint[]
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [cw, setCw] = useState(720)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setCw(Math.max(320, el.clientWidth))
    })
    ro.observe(el)
    setCw(Math.max(320, el.clientWidth))
    return () => ro.disconnect()
  }, [])

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

    const xAt = (tMs: number) => PAD.l + ((tMs - tMin) / span) * innerW
    const yAt = (p: number) => PAD.t + ((yMax - p) / (yMax - yMin)) * innerH

    const slot = innerW / n
    const bodyW = Math.max(1, Math.min(8, slot * 0.72))

    const lastOrI = Math.max(0, Math.min(orMinutes, n) - 1)
    const orStartX = xAt(times[0]!)
    const orEndX = xAt(times[lastOrI]!) + slot * 0.5

    const ticks = 5
    const yTicks: number[] = []
    for (let i = 0; i < ticks; i++) {
      yTicks.push(yMin + ((yMax - yMin) * i) / (ticks - 1))
    }

    const xLabelIdx = [0, Math.floor(n / 2), n - 1]

    return {
      W,
      H,
      innerW,
      innerH,
      xAt,
      yAt,
      bodyW,
      slot,
      yMin,
      yMax,
      yTicks,
      orStartX,
      orEndX,
      tMin,
      span,
      xLabelIdx,
      times,
    }
  }, [bars, cw, orHigh, orLow, orMinutes])

  if (!layout) {
    return (
      <p className="text-xs text-gray-500 py-2 day-trade-chart">
        Not enough bars to chart.
      </p>
    )
  }

  const {
    W,
    H,
    innerW,
    innerH,
    xAt,
    yAt,
    bodyW,
    yMin,
    yMax,
    yTicks,
    orStartX,
    orEndX,
    tMin,
    times,
    xLabelIdx,
  } = layout

  const vwapPts = bars
    .map((b, i) => `${xAt(times[i]!)},${yAt(b.vwap)}`)
    .join(' ')

  return (
    <div ref={wrapRef} className="day-trade-chart w-full">
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
          {bars.some(b => b.vwap_upper1 != null) && (
            <><span className="text-gray-500"> · </span><span className="text-info">±1σ</span><span className="text-gray-500"> · </span><span className="text-info" style={{ opacity: 0.5 }}>±2σ</span></>
          )}
          {entryPoints && entryPoints.length > 0 && (
            <><span className="text-gray-500"> · </span><span style={{ color: ENTRY_COLORS[0] }}>E1</span>{entryPoints.length > 1 && <><span className="text-gray-500">–</span><span style={{ color: ENTRY_COLORS[entryPoints.length - 1] }}>E{entryPoints.length}</span></>}<span className="text-gray-500"> entries</span></>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-800/80 bg-black/20">
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          className="block max-w-none"
          role="img"
          aria-label={`Intraday candlesticks for ${sessionDate} with VWAP and opening range levels`}
        >
          <defs>
            <clipPath id="daytrade-plot-clip">
              <rect x={PAD.l} y={PAD.t} width={innerW} height={innerH} />
            </clipPath>
          </defs>

          {orEndX > orStartX && (
            <rect
              x={orStartX}
              y={PAD.t}
              width={orEndX - orStartX}
              height={innerH}
              fill="var(--accent)"
              fillOpacity={0.08}
              clipPath="url(#daytrade-plot-clip)"
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
            x1={PAD.l}
            x2={PAD.l + innerW}
            y1={yAt(orHigh)}
            y2={yAt(orHigh)}
            stroke="var(--chart-line-ma50)"
            strokeWidth={1.2}
            strokeDasharray="6 4"
            strokeOpacity={0.95}
            clipPath="url(#daytrade-plot-clip)"
          />
          <line
            x1={PAD.l}
            x2={PAD.l + innerW}
            y1={yAt(orLow)}
            y2={yAt(orLow)}
            stroke="var(--chart-line-ma50)"
            strokeWidth={1.2}
            strokeDasharray="6 4"
            strokeOpacity={0.95}
            clipPath="url(#daytrade-plot-clip)"
          />

          <text
            x={PAD.l + innerW - 4}
            y={yAt(orHigh) - 4}
            textAnchor="end"
            fill="var(--chart-line-ma50)"
            fontSize={9}
            fontWeight={600}
            clipPath="url(#daytrade-plot-clip)"
          >
            OR high
          </text>
          <text
            x={PAD.l + innerW - 4}
            y={yAt(orLow) + 12}
            textAnchor="end"
            fill="var(--chart-line-ma50)"
            fontSize={9}
            fontWeight={600}
            clipPath="url(#daytrade-plot-clip)"
          >
            OR low
          </text>

          <g clipPath="url(#daytrade-plot-clip)">
            {bars.map((b, i) => {
              const cx = xAt(times[i]!)
              const yL = yAt(b.l)
              const yH = yAt(b.h)
              const yO = yAt(b.o)
              const yC = yAt(b.c)
              const top = Math.min(yO, yC)
              const bot = Math.max(yO, yC)
              const up = b.c >= b.o
              const bodyFill = up ? 'var(--bullish)' : 'var(--bearish)'
              const wickStroke = 'var(--chart-grid)'
              const bh = Math.max(1, bot - top)
              return (
                <g key={`${b.t}-${i}`}>
                  <line x1={cx} x2={cx} y1={yL} y2={yH} stroke={wickStroke} strokeWidth={1} />
                  <rect
                    x={cx - bodyW / 2}
                    y={top}
                    width={bodyW}
                    height={bh}
                    fill={bodyFill}
                    fillOpacity={0.92}
                  />
                </g>
              )
            })}
          </g>

          <polyline
            fill="none"
            stroke="var(--chart-line-iv)"
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            points={vwapPts}
            clipPath="url(#daytrade-plot-clip)"
          />

          {/* VWAP ±1σ bands */}
          {bars.some(b => b.vwap_upper1 != null) && (() => {
            const u1 = bars.map((b,i) => b.vwap_upper1 != null ? `${xAt(times[i]!)},${yAt(b.vwap_upper1)}` : '').filter(Boolean).join(' ')
            const l1 = bars.map((b,i) => b.vwap_lower1 != null ? `${xAt(times[i]!)},${yAt(b.vwap_lower1)}` : '').filter(Boolean).join(' ')
            return (
              <>
                <polyline fill="none" stroke="var(--chart-line-rsi)" strokeWidth={1} strokeDasharray="4 3" strokeOpacity={0.5} strokeLinejoin="round" points={u1} clipPath="url(#daytrade-plot-clip)" />
                <polyline fill="none" stroke="var(--chart-line-rsi)" strokeWidth={1} strokeDasharray="4 3" strokeOpacity={0.5} strokeLinejoin="round" points={l1} clipPath="url(#daytrade-plot-clip)" />
              </>
            )
          })()}

          {/* VWAP ±2σ bands */}
          {bars.some(b => b.vwap_upper2 != null) && (() => {
            const u2 = bars.map((b,i) => b.vwap_upper2 != null ? `${xAt(times[i]!)},${yAt(b.vwap_upper2)}` : '').filter(Boolean).join(' ')
            const l2 = bars.map((b,i) => b.vwap_lower2 != null ? `${xAt(times[i]!)},${yAt(b.vwap_lower2)}` : '').filter(Boolean).join(' ')
            return (
              <>
                <polyline fill="none" stroke="var(--chart-line-rsi)" strokeWidth={0.8} strokeDasharray="2 4" strokeOpacity={0.25} strokeLinejoin="round" points={u2} clipPath="url(#daytrade-plot-clip)" />
                <polyline fill="none" stroke="var(--chart-line-rsi)" strokeWidth={0.8} strokeDasharray="2 4" strokeOpacity={0.25} strokeLinejoin="round" points={l2} clipPath="url(#daytrade-plot-clip)" />
              </>
            )
          })()}

          <rect
            x={PAD.l}
            y={PAD.t}
            width={innerW}
            height={innerH}
            fill="none"
            stroke="var(--chart-grid)"
            strokeWidth={1}
            opacity={0.6}
          />

          {xLabelIdx.map(i => {
            const bar = bars[i]
            if (!bar) return null
            return (
              <text
                key={`xt-${i}`}
                x={xAt(times[i]!)}
                y={H - 10}
                textAnchor="middle"
                fill="var(--chart-axis)"
                fontSize={10}
              >
                {fmtEtShort(bar.t)}
              </text>
            )
          })}

          <text x={PAD.l} y={12} fill="var(--chart-axis)" fontSize={10}>
            Price · {fmtPrice(yMax)} → {fmtPrice(yMin)}
          </text>

          {/* ── Entry price lines ── */}
          {entryPoints?.map((ep, idx) => {
            if (!Number.isFinite(ep.price) || ep.price <= 0) return null
            if (ep.price < yMin || ep.price > yMax) return null
            const ey = yAt(ep.price)
            const color = ep.color ?? ENTRY_COLORS[idx % ENTRY_COLORS.length]!
            return (
              <g key={`entry-${idx}`}>
                <line
                  x1={PAD.l}
                  x2={PAD.l + innerW}
                  y1={ey}
                  y2={ey}
                  stroke={color}
                  strokeWidth={1.2}
                  strokeDasharray="3 3"
                  strokeOpacity={0.9}
                  clipPath="url(#daytrade-plot-clip)"
                />
                <text
                  x={PAD.l + innerW - 4}
                  y={Math.max(PAD.t + 9, ey - 4)}
                  textAnchor="end"
                  fill={color}
                  fontSize={9}
                  fontWeight={600}
                >
                  {ep.label} · ${fmtPrice(ep.price)}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      {/* ── Entry points table ── */}
      {entryPoints && entryPoints.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-[11px] border-collapse">
            <thead>
              <tr className="border-b border-gray-800/60">
                <th className="pb-1 text-left font-medium text-gray-500 uppercase tracking-wide pr-3">Entry</th>
                <th className="pb-1 text-right font-mono font-medium text-gray-500 uppercase tracking-wide pr-3">Price</th>
                <th className="pb-1 text-left font-medium text-gray-500 uppercase tracking-wide pr-3">Trigger</th>
                <th className="pb-1 text-right font-mono font-medium text-gray-500 uppercase tracking-wide">Stop</th>
              </tr>
            </thead>
            <tbody>
              {entryPoints.map((ep, idx) => {
                const color = ep.color ?? ENTRY_COLORS[idx % ENTRY_COLORS.length]!
                return (
                  <tr key={`erow-${idx}`} className="border-b border-gray-800/40 last:border-0">
                    <td className="py-1 pr-3 font-semibold" style={{ color }}>{ep.label}</td>
                    <td className="py-1 pr-3 text-right font-mono text-gray-200">${fmtPrice(ep.price)}</td>
                    <td className="py-1 pr-3 text-gray-400">{ep.trigger}</td>
                    <td className="py-1 text-right font-mono text-red-400">
                      {ep.stop && ep.stop > 0 ? `$${fmtPrice(ep.stop)}` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
