import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { DayTradeChartBar } from '../api/client'

type ScalpState = {
  status?: string
  direction?: string
  entry_price?: number
  entry_time?: string | null
  stop_level?: number
  target_1?: number
  target_2?: number
  ema50?: number
  ema150?: number
  stoch5?: number
  volume_ratio_20?: number
  trend_confirmed?: boolean
  trigger_requirement?: string
  next_action?: string
}

const PAD = { l: 54, r: 18, t: 18, b: 30 }

function fmtPrice(n: number) {
  if (!Number.isFinite(n)) return '-'
  return n.toFixed(Math.abs(n) >= 10 ? 2 : 3)
}

function fmtTime(iso: string) {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    const tz = (typeof window !== 'undefined' && localStorage?.getItem('oa_timezone')) || 'America/New_York'
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz })
  } catch {
    return ''
  }
}

function n(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export default function ScalpTradingChart({
  bars,
  scalp,
  isDark = false,
}: {
  bars: DayTradeChartBar[]
  scalp?: ScalpState | null
  isDark?: boolean
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [cw, setCw] = useState(0)

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setCw(Math.max(340, el.clientWidth)))
    ro.observe(el)
    setCw(Math.max(340, el.clientWidth))
    return () => ro.disconnect()
  }, [])

  const layout = useMemo(() => {
    const len = bars.length
    if (len < 2) return null
    const times = bars.map(b => new Date(b.t).getTime())
    const tMin = times[0]!
    const tMax = times[len - 1]!
    const span = Math.max(1, tMax - tMin)
    const prices = bars.flatMap(b => [b.h, b.l, b.ema50, b.ema150].filter((x): x is number => typeof x === 'number' && Number.isFinite(x)))
    const levels = [scalp?.entry_price, scalp?.stop_level, scalp?.target_1, scalp?.target_2].filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
    let lo = Math.min(...prices, ...levels)
    let hi = Math.max(...prices, ...levels)
    const pad = Math.max((hi - lo) * 0.08, hi * 0.002, 0.01)
    lo -= pad
    hi += pad

    const priceH = 260
    const volGap = 12
    const volH = 72
    const stochGap = 12
    const stochH = 86
    const innerW = Math.max(len * 3.2, cw - PAD.l - PAD.r)
    const W = PAD.l + PAD.r + innerW
    const H = PAD.t + priceH + volGap + volH + stochGap + stochH + PAD.b
    const slot = innerW / len
    const bodyW = Math.max(2, Math.min(9, slot * 0.7))
    const plotW = innerW - slot * 0.5
    const xAt = (t: number) => PAD.l + slot * 0.5 + ((t - tMin) / span) * plotW
    const yAt = (p: number) => PAD.t + ((hi - p) / (hi - lo)) * priceH
    const volTop = PAD.t + priceH + volGap
    const volMax = Math.max(1, ...bars.map(b => b.v || 0))
    const volYAt = (v: number) => volTop + volH - (Math.max(0, v) / volMax) * volH
    const stochTop = volTop + volH + stochGap
    const stochYAt = (v: number) => stochTop + stochH - (Math.max(0, Math.min(100, v)) / 100) * stochH
    const yTicks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4)
    return { W, H, times, xAt, yAt, volYAt, stochYAt, yTicks, lo, hi, innerW, priceH, volTop, volH, stochTop, stochH, slot, bodyW, tMin }
  }, [bars, cw, scalp])

  if (cw === 0) return <div ref={wrapRef} style={{ minHeight: 430 }} />
  if (!layout) return <div ref={wrapRef} className="text-xs text-gray-500">Not enough scalp bars to chart.</div>

  const { W, H, times, xAt, yAt, volYAt, stochYAt, yTicks, innerW, priceH, volTop, volH, stochTop, stochH, bodyW, tMin } = layout
  const ema50Pts = bars.map((b, i) => b.ema50 != null ? `${xAt(times[i]!)},${yAt(b.ema50)}` : '').filter(Boolean).join(' ')
  const ema150Pts = bars.map((b, i) => b.ema150 != null ? `${xAt(times[i]!)},${yAt(b.ema150)}` : '').filter(Boolean).join(' ')
  const stochPts = bars.map((b, i) => b.stoch5 != null ? `${xAt(times[i]!)},${stochYAt(b.stoch5)}` : '').filter(Boolean).join(' ')
  const trendPts = bars.map((b, i) => b.trend_confirmation != null ? `${xAt(times[i]!)},${stochYAt(b.trend_confirmation)}` : '').filter(Boolean).join(' ')
  const entry = n(scalp?.entry_price)
  const stop = n(scalp?.stop_level)
  const t1 = n(scalp?.target_1)
  const t2 = n(scalp?.target_2)
  const dir = String(scalp?.direction || '').toUpperCase()
  const status = String(scalp?.status || 'WAIT_TRIGGER').replace(/_/g, ' ')
  const entryTime = scalp?.entry_time ? fmtTime(scalp.entry_time) : ''

  const surface = isDark ? '#05070b' : '#ffffff'
  const panel = isDark ? '#0b1018' : '#f8fafc'
  const border = isDark ? 'rgba(148,163,184,0.18)' : 'rgba(15,23,42,0.14)'
  const grid = isDark ? 'rgba(148,163,184,0.20)' : 'rgba(100,116,139,0.22)'
  const axis = isDark ? '#94a3b8' : '#64748b'

  const lineLevel = (value: number | null, label: string, color: string, dashed = true) => {
    if (value == null) return null
    const y = yAt(value)
    return (
      <g key={label}>
        <line x1={PAD.l} x2={PAD.l + innerW} y1={y} y2={y} stroke={color} strokeWidth={1.25} strokeDasharray={dashed ? '6 5' : undefined} />
        <text x={PAD.l + innerW - 4} y={y - 4} textAnchor="end" fill={color} fontSize={10} fontWeight={700}>
          {label} ${fmtPrice(value)}
        </text>
      </g>
    )
  }

  return (
    <div ref={wrapRef} className="scalp-trading-chart w-full min-w-0">
      <div className="mb-2 grid grid-cols-2 gap-2 lg:grid-cols-6">
        {[
          ['Status', status, status.includes('ENTRY') ? '#22c55e' : '#f59e0b'],
          ['Direction', dir || '-', dir === 'LONG' ? '#22c55e' : '#fb7185'],
          ['Entry', entry != null ? `$${fmtPrice(entry)}` : '-', '#22c55e'],
          ['Stop', stop != null ? `$${fmtPrice(stop)}` : '-', '#fb7185'],
          ['T1 / T2', t1 != null && t2 != null ? `$${fmtPrice(t1)} / $${fmtPrice(t2)}` : '-', '#38bdf8'],
          ['Stoch(5)', scalp?.stoch5 != null ? scalp.stoch5.toFixed(1) : '-', '#38bdf8'],
        ].map(([label, value, color]) => (
          <div key={label} className="rounded-lg border px-2 py-1.5" style={{ borderColor: border, background: panel }}>
            <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: axis }}>{label}</div>
            <div className="mt-0.5 font-mono text-xs font-bold tabular-nums" style={{ color }}>{value}</div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border" style={{ borderColor: border, background: surface }}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block max-w-none min-w-max" role="img" aria-label="Scalp trading chart with EMA, stochastic, volume, and entry levels">
          <rect x={PAD.l} y={PAD.t} width={innerW} height={priceH} fill={isDark ? 'rgba(15,23,42,0.32)' : 'rgba(248,250,252,0.92)'} stroke={border} />
          {yTicks.map((yt, i) => (
            <g key={i}>
              <line x1={PAD.l} x2={PAD.l + innerW} y1={yAt(yt)} y2={yAt(yt)} stroke={grid} />
              <text x={PAD.l - 6} y={yAt(yt)} dy="0.35em" textAnchor="end" fill={axis} fontSize={10} fontFamily="ui-monospace, monospace">{fmtPrice(yt)}</text>
            </g>
          ))}

          {bars.map((b, i) => {
            const cx = xAt(times[i]!)
            const up = b.c >= b.o
            const yH = yAt(b.h)
            const yL = yAt(b.l)
            const yO = yAt(b.o)
            const yC = yAt(b.c)
            const top = Math.min(yO, yC)
            const bot = Math.max(yO, yC)
            return (
              <g key={`${b.t}-${i}`}>
                <line x1={cx} x2={cx} y1={yH} y2={yL} stroke={up ? '#22c55e' : '#fb7185'} strokeOpacity={0.78} />
                <rect x={cx - bodyW / 2} y={top} width={bodyW} height={Math.max(1, bot - top)} fill={up ? '#22c55e' : '#fb7185'} fillOpacity={0.9} />
              </g>
            )
          })}

          {ema50Pts && <polyline fill="none" points={ema50Pts} stroke="#ef4444" strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />}
          {ema150Pts && <polyline fill="none" points={ema150Pts} stroke="#22c55e" strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />}
          {lineLevel(entry, 'ENTRY', '#22c55e', false)}
          {lineLevel(stop, 'STOP', '#fb7185')}
          {lineLevel(t1, 'T1', '#38bdf8')}
          {lineLevel(t2, 'T2', '#818cf8')}
          {entry != null && (
            <polygon points={`${PAD.l + 12},${yAt(entry)} ${PAD.l + 2},${yAt(entry) - 6} ${PAD.l + 2},${yAt(entry) + 6}`} fill="#22c55e" />
          )}

          <text x={PAD.l + 4} y={PAD.t + 13} fill={axis} fontSize={10} fontWeight={700}>Candles · EMA50 red · EMA150 green</text>
          <text x={PAD.l} y={H - 10} fill={axis} fontSize={10}>{fmtTime(new Date(tMin).toISOString())}</text>

          <rect x={PAD.l} y={volTop} width={innerW} height={volH} fill={panel} stroke={border} />
          {bars.map((b, i) => {
            const cx = xAt(times[i]!)
            const top = volYAt(b.v || 0)
            const up = b.c >= b.o
            return <rect key={`vol-${i}`} x={cx - bodyW / 2} y={top} width={bodyW} height={Math.max(1, volTop + volH - top)} fill={up ? '#22c55e' : '#fb7185'} fillOpacity={0.42} />
          })}
          <text x={PAD.l + 4} y={volTop + 13} fill={axis} fontSize={10} fontWeight={700}>Volume</text>

          <rect x={PAD.l} y={stochTop} width={innerW} height={stochH} fill={panel} stroke={border} />
          {[20, 50, 80].map(level => (
            <g key={level}>
              <line x1={PAD.l} x2={PAD.l + innerW} y1={stochYAt(level)} y2={stochYAt(level)} stroke={level === 50 ? axis : grid} strokeDasharray="4 4" strokeOpacity={level === 50 ? 0.4 : 0.7} />
              <text x={PAD.l + innerW - 4} y={stochYAt(level) - 3} textAnchor="end" fill={axis} fontSize={9}>{level}</text>
            </g>
          ))}
          {trendPts && <polyline fill="none" points={trendPts} stroke="#f59e0b" strokeWidth={1.4} strokeDasharray="6 4" strokeLinejoin="round" />}
          {stochPts && <polyline fill="none" points={stochPts} stroke="#38bdf8" strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />}
          <text x={PAD.l + 4} y={stochTop + 13} fill={axis} fontSize={10} fontWeight={700}>Stochastic(5) · trend confirmation</text>
        </svg>
      </div>

      <div className="mt-2 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: border, background: panel, color: axis }}>
        <div className="font-semibold" style={{ color: isDark ? '#e5e7eb' : '#0f172a' }}>
          Entry plan {entryTime ? `· triggered ${entryTime}` : ''}
        </div>
        <div className="mt-1">{scalp?.trigger_requirement || 'Waiting for scalp trigger requirements.'}</div>
        <div className="mt-1">{scalp?.next_action || 'Wait for a clean 1m setup before entering.'}</div>
      </div>
    </div>
  )
}
