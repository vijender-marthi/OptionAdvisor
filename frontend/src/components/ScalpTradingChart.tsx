import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { DayTradeChartBar } from '../api/client'

type ScalpState = {
  action?: string
  reason?: string
  trade_quality?: number
  quality_grade?: string
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
  volume_confirmed?: boolean
  extension_state?: string
  extension_from_ema50_pct?: number
  recommended_dte?: string
  risk_per_share?: number
  risk_reward_t1?: number
  blockers?: Array<{ label?: string; status?: string }>
  logic_note?: string
  momentum_label?: string
  price_label?: string
  status_label?: string
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
  zoomScale = 1,
}: {
  bars: DayTradeChartBar[]
  scalp?: ScalpState | null
  isDark?: boolean
  zoomScale?: number
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

  const chartBars = useMemo(() => {
    if (bars.length <= 2) return bars
    if (zoomScale > 1.05) return bars
    const maxBars = cw < 480 ? 90 : cw < 768 ? 130 : cw < 1100 ? 180 : 260
    return bars.length > maxBars ? bars.slice(-maxBars) : bars
  }, [bars, cw, zoomScale])

  const layout = useMemo(() => {
    const len = chartBars.length
    if (len < 2) return null
    const times = chartBars.map(b => new Date(b.t).getTime())
    const tMin = times[0]!
    const tMax = times[len - 1]!
    const span = Math.max(1, tMax - tMin)
    const prices = chartBars.flatMap(b => [b.h, b.l, b.ema50, b.ema150].filter((x): x is number => typeof x === 'number' && Number.isFinite(x)))
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
    const safeZoom = Number.isFinite(zoomScale) ? Math.max(0.75, Math.min(2.5, zoomScale)) : 1
    const minBarWidth = cw < 480 ? 2.2 : cw < 768 ? 2.7 : 3.2
    const innerW = Math.max(len * minBarWidth, cw - PAD.l - PAD.r) * safeZoom
    const W = PAD.l + PAD.r + innerW
    const H = PAD.t + priceH + volGap + volH + stochGap + stochH + PAD.b
    const slot = innerW / len
    const bodyW = Math.max(2, Math.min(9, slot * 0.7))
    const plotW = innerW - slot * 0.5
    const xAt = (t: number) => PAD.l + slot * 0.5 + ((t - tMin) / span) * plotW
    const yAt = (p: number) => PAD.t + ((hi - p) / (hi - lo)) * priceH
    const volTop = PAD.t + priceH + volGap
    const volMax = Math.max(1, ...chartBars.map(b => b.v || 0))
    const volYAt = (v: number) => volTop + volH - (Math.max(0, v) / volMax) * volH
    const stochTop = volTop + volH + stochGap
    const stochYAt = (v: number) => stochTop + stochH - (Math.max(0, Math.min(100, v)) / 100) * stochH
    const yTicks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4)
    return { W, H, times, xAt, yAt, volYAt, stochYAt, yTicks, lo, hi, innerW, priceH, volTop, volH, stochTop, stochH, slot, bodyW, tMin }
  }, [chartBars, cw, scalp, zoomScale])

  if (cw === 0) return <div ref={wrapRef} style={{ minHeight: 430 }} />
  if (!layout) return <div ref={wrapRef} className="text-xs text-gray-500">Not enough scalp bars to chart.</div>

  const { W, H, times, xAt, yAt, volYAt, stochYAt, yTicks, innerW, priceH, volTop, volH, stochTop, stochH, bodyW, tMin } = layout
  const ema50Pts = chartBars.map((b, i) => b.ema50 != null ? `${xAt(times[i]!)},${yAt(b.ema50)}` : '').filter(Boolean).join(' ')
  const ema150Pts = chartBars.map((b, i) => b.ema150 != null ? `${xAt(times[i]!)},${yAt(b.ema150)}` : '').filter(Boolean).join(' ')
  const stochPts = chartBars.map((b, i) => b.stoch5 != null ? `${xAt(times[i]!)},${stochYAt(b.stoch5)}` : '').filter(Boolean).join(' ')
  const trendPts = chartBars.map((b, i) => b.trend_confirmation != null ? `${xAt(times[i]!)},${stochYAt(b.trend_confirmation)}` : '').filter(Boolean).join(' ')
  const entry = n(scalp?.entry_price)
  const stop = n(scalp?.stop_level)
  const t1 = n(scalp?.target_1)
  const t2 = n(scalp?.target_2)
  const dir = String(scalp?.direction || '').toUpperCase()
  const action = String(scalp?.action || scalp?.status || 'WAIT').replace(/_/g, ' ')
  const entryTime = scalp?.entry_time ? fmtTime(scalp.entry_time) : ''
  const momentumLabel = scalp?.momentum_label || 'BUILDING'
  const priceLabel = scalp?.price_label || 'NOT CONFIRMED'
  const statusLabel = scalp?.status_label || action
  const currentIndex = chartBars.length - 1
  const entryIndex = scalp?.entry_time
    ? chartBars.reduce((best, bar, idx) => {
        const target = new Date(scalp.entry_time as string).getTime()
        const curDiff = Math.abs(new Date(bar.t).getTime() - target)
        const bestDiff = Math.abs(new Date(chartBars[best]?.t ?? bar.t).getTime() - target)
        return curDiff < bestDiff ? idx : best
      }, currentIndex)
    : currentIndex
  const currentX = xAt(times[currentIndex]!)
  const entryX = xAt(times[entryIndex]!)

  const surface = isDark ? '#05070b' : '#ffffff'
  const panel = isDark ? '#0b1018' : '#f8fafc'
  const border = isDark ? 'rgba(148,163,184,0.18)' : 'rgba(15,23,42,0.14)'
  const grid = isDark ? 'rgba(148,163,184,0.20)' : 'rgba(100,116,139,0.22)'
  const axis = isDark ? '#94a3b8' : '#64748b'
  const actionColor = action === 'GO' ? '#22c55e' : action.includes('DO NOT') || action === 'NO TRADE' ? '#fb7185' : action === 'TRACK' ? '#38bdf8' : '#f59e0b'

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
  const zoneRect = (a: number | null, b: number | null, color: string, label: string) => {
    if (a == null || b == null) return null
    const y1 = yAt(a)
    const y2 = yAt(b)
    const top = Math.min(y1, y2)
    const h = Math.max(1, Math.abs(y2 - y1))
    return (
      <g key={label}>
        <rect x={PAD.l} y={top} width={innerW} height={h} fill={color} opacity={0.08} />
        <text x={PAD.l + 8} y={top + 13} fill={color} fontSize={10} fontWeight={800}>{label}</text>
      </g>
    )
  }

  return (
    <div ref={wrapRef} className="scalp-trading-chart w-full min-w-0">
      <div className="mb-2 rounded-xl border px-3 py-2" style={{ borderColor: border, background: panel }}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wider" style={{ borderColor: actionColor, color: actionColor, background: `${actionColor}18` }}>
            {action}
          </span>
          <span className="font-mono text-xs font-bold" style={{ color: isDark ? '#e5e7eb' : '#0f172a' }}>
            Quality {scalp?.trade_quality ?? '-'}{scalp?.quality_grade ? ` · ${scalp.quality_grade}` : ''}
          </span>
          <span className="font-mono text-xs font-bold" style={{ color: axis }}>
            DTE {scalp?.recommended_dte || '5-10 DTE'}
          </span>
          <span className="font-mono text-xs font-bold" style={{ color: axis }}>
            Risk ${scalp?.risk_per_share != null ? fmtPrice(scalp.risk_per_share) : '-'} / share
          </span>
        </div>
        <div className="mt-1 text-xs" style={{ color: axis }}>{scalp?.reason || 'Waiting for scalp decision.'}</div>
      </div>

      <div className="mb-2 grid grid-cols-2 gap-2 lg:grid-cols-6">
        {[
          ['Momentum', momentumLabel, momentumLabel === 'STRONG' ? '#22c55e' : momentumLabel === 'WEAK' ? '#fb7185' : '#f59e0b'],
          ['Price', priceLabel, priceLabel === 'CONFIRMED' ? '#22c55e' : '#f59e0b'],
          ['Status', statusLabel, statusLabel.includes('BUY') || statusLabel.includes('SELL') ? '#38bdf8' : actionColor],
          ['Entry', entry != null ? `$${fmtPrice(entry)}` : '-', '#22c55e'],
          ['Stop', stop != null ? `$${fmtPrice(stop)}` : '-', '#fb7185'],
          ['Risk', scalp?.risk_per_share != null ? `$${fmtPrice(scalp.risk_per_share)}` : '-', '#fb7185'],
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
          {zoneRect(entry, stop, '#fb7185', 'RISK ZONE')}
          {zoneRect(entry, t1, '#22c55e', 'REWARD TO T1')}
          {currentX && (
            <rect x={currentX - Math.max(5, bodyW * 1.3)} y={PAD.t} width={Math.max(10, bodyW * 2.6)} height={priceH} fill="#38bdf8" opacity={0.08} />
          )}
          {entryX && (
            <rect x={entryX - Math.max(5, bodyW * 1.2)} y={PAD.t} width={Math.max(10, bodyW * 2.4)} height={priceH} fill="#22c55e" opacity={0.10} />
          )}
          {yTicks.map((yt, i) => (
            <g key={i}>
              <line x1={PAD.l} x2={PAD.l + innerW} y1={yAt(yt)} y2={yAt(yt)} stroke={grid} />
              <text x={PAD.l - 6} y={yAt(yt)} dy="0.35em" textAnchor="end" fill={axis} fontSize={10} fontFamily="ui-monospace, monospace">{fmtPrice(yt)}</text>
            </g>
          ))}

          {chartBars.map((b, i) => {
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

          {ema50Pts && <polyline fill="none" points={ema50Pts} stroke="#f59e0b" strokeWidth={1.9} strokeLinejoin="round" strokeLinecap="round" />}
          {ema150Pts && <polyline fill="none" points={ema150Pts} stroke="#a855f7" strokeWidth={1.9} strokeLinejoin="round" strokeLinecap="round" />}
          {entry != null && t1 != null && (
            <polyline
              fill="none"
              points={`${entryX},${yAt(entry)} ${Math.min(PAD.l + innerW - 36, entryX + innerW * 0.22)},${yAt(t1)}${t2 != null ? ` ${Math.min(PAD.l + innerW - 12, entryX + innerW * 0.42)},${yAt(t2)}` : ''}`}
              stroke="#22c55e"
              strokeWidth={1.6}
              strokeDasharray="5 5"
              strokeLinecap="round"
            />
          )}
          {lineLevel(entry, 'ENTRY', '#22c55e', false)}
          {lineLevel(stop, 'STOP', '#fb7185')}
          {lineLevel(t1, 'T1', '#38bdf8')}
          {lineLevel(t2, 'T2', '#818cf8')}
          <text x={Math.min(PAD.l + innerW - 8, currentX + 8)} y={PAD.t + 15} fill="#38bdf8" fontSize={10} fontWeight={900} textAnchor="end">CURRENT</text>
          {entry != null && <text x={Math.min(PAD.l + innerW - 8, entryX + 8)} y={PAD.t + 30} fill="#22c55e" fontSize={10} fontWeight={900} textAnchor="end">TRIGGER</text>}
          {stop != null && <text x={PAD.l + 8} y={Math.min(PAD.t + priceH - 8, yAt(stop) + 16)} fill="#fb7185" fontSize={10} fontWeight={900}>INVALID BELOW/ABOVE STOP</text>}
          {entry != null && (
            <polygon points={`${PAD.l + 12},${yAt(entry)} ${PAD.l + 2},${yAt(entry) - 6} ${PAD.l + 2},${yAt(entry) + 6}`} fill="#22c55e" />
          )}

          <g transform={`translate(${PAD.l + 6}, ${PAD.t + 7})`}>
            <rect x={0} y={-5} width={5} height={10} fill="#22c55e" rx={1} />
            <rect x={8} y={-5} width={5} height={10} fill="#fb7185" rx={1} />
            <text x={19} y={4} fill={axis} fontSize={10} fontWeight={700}>Candles</text>
            <line x1={70} x2={94} y1={0} y2={0} stroke="#f59e0b" strokeWidth={2} strokeLinecap="round" />
            <text x={100} y={4} fill="#f59e0b" fontSize={10} fontWeight={700}>EMA50</text>
            <line x1={148} x2={172} y1={0} y2={0} stroke="#a855f7" strokeWidth={2} strokeLinecap="round" />
            <text x={178} y={4} fill="#a855f7" fontSize={10} fontWeight={700}>EMA150</text>
          </g>
          <text x={PAD.l} y={H - 10} fill={axis} fontSize={10}>{fmtTime(new Date(tMin).toISOString())}</text>

          <rect x={PAD.l} y={volTop} width={innerW} height={volH} fill={panel} stroke={border} />
          {chartBars.map((b, i) => {
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
          <text x={PAD.l + 4} y={stochTop + 13} fill={axis} fontSize={10} fontWeight={700}>Momentum · trend confirmation</text>
        </svg>
      </div>

      <div className="mt-2 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: border, background: panel, color: axis }}>
        <div className="font-semibold" style={{ color: isDark ? '#e5e7eb' : '#0f172a' }}>
          Entry plan {entryTime ? `· triggered ${entryTime}` : ''}
        </div>
        <div className="mt-1">{scalp?.trigger_requirement || 'Waiting for scalp trigger requirements.'}</div>
        <div className="mt-1">{scalp?.next_action || 'Wait for a clean 1m setup before entering.'}</div>
        {scalp?.blockers && scalp.blockers.length > 0 && (
          <div className="mt-2 grid gap-1 sm:grid-cols-2">
            {scalp.blockers.map((b, i) => {
              const status = String(b.status || '').toUpperCase()
              const color = status === 'PASS' ? '#22c55e' : status === 'FAIL' ? '#fb7185' : '#f59e0b'
              return (
                <div key={`${b.label}-${i}`} className="flex items-center gap-1.5">
                  <span style={{ width: 7, height: 7, borderRadius: 999, background: color, display: 'inline-block' }} />
                  <span>{b.label}</span>
                </div>
              )
            })}
          </div>
        )}
        {scalp?.logic_note && <div className="mt-2 text-[11px]" style={{ color: axis }}>{scalp.logic_note}</div>}
      </div>
    </div>
  )
}
