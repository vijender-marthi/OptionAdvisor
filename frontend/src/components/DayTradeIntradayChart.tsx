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
    // Parse the ISO string which carries the ET offset (e.g. "2026-05-19T09:30:00-04:00")
    const match = iso.match(/T(\d{2}):(\d{2})/)
    if (!match) return ''
    const h = parseInt(match[1], 10)
    const m = match[2]
    const ampm = h >= 12 ? 'PM' : 'AM'
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
    return `${h12}:${m} ${ampm}`
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

export default function DayTradeIntradayChart({
  bars,
  orHigh,
  orLow,
  orMinutes,
  sessionDate,
}: {
  bars: DayTradeChartBar[]
  orHigh: number
  orLow: number
  orMinutes: number
  sessionDate: string
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

    let yMin = Math.min(...bars.map(b => b.l), orLow, ...bars.map(b => b.vwap))
    let yMax = Math.max(...bars.map(b => b.h), orHigh, ...bars.map(b => b.vwap))
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
          {sessionDate ? `${sessionDate} ET` : 'Last RTH'}{' · '}
          <span className="text-semantic-accent">VWAP</span>
          {' · '}
          <span className="text-semantic-warning">OR high / low</span>
          {' · '}
          <span className="text-tertiary">Opening range (first {orMinutes}×1m)</span>
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
        </svg>
      </div>
    </div>
  )
}
