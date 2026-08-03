import { useState, useMemo, type MouseEvent } from 'react'
import { CalendarRange } from 'lucide-react'

export interface MultiDayBar {
  time: string
  open: number; high: number; low: number; close: number; volume: number
  vwap: number; ema20: number; ema50: number
  dayIndex: number; isDayOpen: boolean
}

const W = 760, H = 300, PAD_L = 6, PAD_R = 56, TOP = 26, BOT = 250
const UP = '#16a34a', DOWN = '#dc2626', VWAP = '#8b5cf6', EMA20 = '#2563eb', EMA50 = '#f59e0b', PREV = '#94a3b8'
const fmt = (v: number) => `$${v.toFixed(2)}`
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const dayLabel = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso.slice(5, 10) : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}
const hhmm = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso.slice(11, 16) : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export default function DayTradeMultiDayChart({
  bars, prevClose, lastPrice,
}: { bars?: MultiDayBar[] | null; prevClose?: number | null; lastPrice?: number | null }) {
  const [days, setDays] = useState(3)
  const [hover, setHover] = useState<number | null>(null)

  const view = useMemo(() => {
    const all = (bars ?? []).filter(b => Number.isFinite(b.close))
    if (all.length === 0) return null
    const dayIdxs = [...new Set(all.map(b => b.dayIndex))].sort((a, b) => a - b)
    const keep = new Set(dayIdxs.slice(-days))
    const rows = all.filter(b => keep.has(b.dayIndex))
    if (rows.length === 0) return null
    const prices = rows.flatMap(b => [b.high, b.low, b.vwap, b.ema20, b.ema50]).filter(Number.isFinite)
    if (prevClose != null && Number.isFinite(prevClose)) prices.push(prevClose)
    const min = Math.min(...prices), max = Math.max(...prices)
    const pad = (max - min) * 0.06 || 0.5
    const lo = min - pad, hi = max + pad
    const n = rows.length
    const bw = (W - PAD_L - PAD_R) / n
    const x = (i: number) => PAD_L + i * bw + bw / 2
    const y = (p: number) => TOP + (1 - (p - lo) / (hi - lo || 1)) * (BOT - TOP)
    return { rows, x, y, bw, lo, hi }
  }, [bars, days, prevClose])

  const dayCount = useMemo(() => new Set((bars ?? []).map(b => b.dayIndex)).size, [bars])

  const gap = useMemo(() => {
    const all = (bars ?? []).filter(b => Number.isFinite(b.close))
    if (!all.length || prevClose == null || !Number.isFinite(prevClose) || prevClose <= 0) return null
    const lastDay = Math.max(...all.map(b => b.dayIndex))
    const open = all.find(b => b.dayIndex === lastDay)?.open
    if (open == null || !Number.isFinite(open)) return null
    return { open, dollars: open - prevClose, pct: (open / prevClose - 1) * 100 }
  }, [bars, prevClose])

  if (!view) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-tertiary dark:border-white/[0.08] dark:bg-slate-950">
        Multi-day chart appears once intraday history loads.
      </div>
    )
  }
  const { rows, x, y, bw } = view

  // per-day VWAP segments (reset each session)
  const vwapPaths: string[] = []
  let seg: string[] = []
  let curDay = rows[0]?.dayIndex
  rows.forEach((b, i) => {
    if (b.dayIndex !== curDay) { if (seg.length) vwapPaths.push(seg.join(' ')); seg = []; curDay = b.dayIndex }
    seg.push(`${seg.length === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(b.vwap).toFixed(1)}`)
  })
  if (seg.length) vwapPaths.push(seg.join(' '))
  const emaPath = (key: 'ema20' | 'ema50') => rows.map((b, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(b[key]).toFixed(1)}`).join(' ')
  const gridPrices = [0, 1, 2, 3].map(s => view.hi - s * ((view.hi - view.lo) / 3))

  const curPrice = lastPrice != null && Number.isFinite(lastPrice) ? lastPrice : rows[rows.length - 1].close
  const curY = clamp(y(curPrice), TOP, BOT)
  const prevY = prevClose != null && Number.isFinite(prevClose) ? clamp(y(prevClose), TOP, BOT) : null
  const hb = hover != null ? rows[hover] : null

  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    if (!rect.width) return
    const vx = ((e.clientX - rect.left) / rect.width) * W
    const i = clamp(Math.round((vx - PAD_L - bw / 2) / bw), 0, rows.length - 1)
    setHover(i)
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-white/[0.08] dark:bg-slate-950">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CalendarRange size={14} className="text-violet-500" />
          <span className="text-[11px] font-black uppercase tracking-widest text-tertiary">Multi-Day Context</span>
          {gap && (
            <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-black ${gap.dollars >= 0 ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-rose-500/15 text-rose-700 dark:text-rose-300'}`}
              title="Overnight gap: prior-session close → today's open">
              Overnight {gap.dollars >= 0 ? '+' : '−'}{fmt(Math.abs(gap.dollars))} ({gap.pct >= 0 ? '+' : '−'}{Math.abs(gap.pct).toFixed(2)}%)
            </span>
          )}
        </div>
        <div className="flex overflow-hidden rounded-md border border-slate-200 dark:border-white/[0.1]">
          {[2, 3, 5].map(d => (
            <button key={d} type="button" onClick={() => setDays(d)} disabled={d > dayCount && dayCount > 0}
              className={`px-2.5 py-1 text-[10px] font-black transition-colors ${days === d ? 'bg-violet-600 text-white' : 'text-secondary hover:bg-slate-50 disabled:opacity-40 dark:hover:bg-slate-900'}`}>
              {d}D
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-3 pb-1 text-[10px] font-bold">
        <span className="flex items-center gap-1" style={{ color: VWAP }}><span className="inline-block h-0.5 w-3" style={{ background: VWAP }} />VWAP (per day)</span>
        <span className="flex items-center gap-1" style={{ color: EMA20 }}><span className="inline-block h-0.5 w-3" style={{ background: EMA20 }} />EMA 20</span>
        <span className="flex items-center gap-1" style={{ color: EMA50 }}><span className="inline-block h-0.5 w-3" style={{ background: EMA50 }} />EMA 50</span>
        {prevClose != null && <span className="flex items-center gap-1" style={{ color: PREV }}><span className="inline-block h-0.5 w-3" style={{ background: PREV }} />Prev Close</span>}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Multi-day intraday chart"
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {gridPrices.map((p, i) => {
          const gy = TOP + (i * (BOT - TOP)) / 3
          return (
            <g key={i}>
              <line x1={PAD_L} x2={W - PAD_R} y1={gy} y2={gy} className="stroke-slate-200 dark:stroke-white/10" strokeDasharray="3 5" />
              <text x={W - PAD_R + 4} y={gy + 3} className="fill-slate-500 text-[10px] dark:fill-slate-400">{fmt(p)}</text>
            </g>
          )
        })}

        {/* day separators + labels */}
        {rows.map((b, i) => {
          if (!b.isDayOpen || i === 0) return null
          const sx = PAD_L + i * bw
          return (
            <g key={`sep-${i}`}>
              <line x1={sx} x2={sx} y1={TOP} y2={BOT} className="stroke-slate-300 dark:stroke-white/20" strokeDasharray="2 4" />
              <text x={sx + 3} y={TOP - 4} className="fill-slate-500 text-[9px] font-bold dark:fill-slate-400">{dayLabel(b.time)}</text>
            </g>
          )
        })}
        {rows[0] && <text x={PAD_L + 3} y={TOP - 4} className="fill-slate-500 text-[9px] font-bold dark:fill-slate-400">{dayLabel(rows[0].time)}</text>}

        {/* prev close reference line */}
        {prevY != null && (
          <g>
            <line x1={PAD_L} x2={W - PAD_R} y1={prevY} y2={prevY} stroke={PREV} strokeWidth={1.2} strokeDasharray="5 4" />
            <rect x={W - PAD_R} y={prevY - 8} width={PAD_R} height={16} rx={3} fill={PREV} opacity={0.9} />
            <text x={W - PAD_R + PAD_R / 2} y={prevY + 3} textAnchor="middle" className="fill-white text-[9px] font-bold">{fmt(prevClose as number)}</text>
          </g>
        )}

        {/* candles */}
        {rows.map((b, i) => {
          const up = b.close >= b.open
          const col = up ? UP : DOWN
          const cw = Math.max(1, Math.min(bw * 0.6, 6))
          const bodyTop = y(Math.max(b.open, b.close)), bodyBot = y(Math.min(b.open, b.close))
          return (
            <g key={i}>
              <line x1={x(i)} x2={x(i)} y1={y(b.high)} y2={y(b.low)} stroke={col} strokeWidth={0.8} opacity={0.8} />
              <rect x={x(i) - cw / 2} y={bodyTop} width={cw} height={Math.max(0.6, bodyBot - bodyTop)} fill={col} opacity={0.85} />
            </g>
          )
        })}

        {/* per-day VWAP + continuous EMAs */}
        {vwapPaths.map((d, i) => <path key={`vw-${i}`} d={d} fill="none" stroke={VWAP} strokeWidth={1.6} strokeLinejoin="round" />)}
        <path d={emaPath('ema20')} fill="none" stroke={EMA20} strokeWidth={1.3} opacity={0.9} strokeLinejoin="round" />
        <path d={emaPath('ema50')} fill="none" stroke={EMA50} strokeWidth={1.3} opacity={0.9} strokeLinejoin="round" />

        {/* current price marker */}
        <g>
          <line x1={PAD_L} x2={W - PAD_R} y1={curY} y2={curY} stroke="#0ea5e9" strokeWidth={1} strokeDasharray="1 3" opacity={0.8} />
          <circle cx={x(rows.length - 1)} cy={y(rows[rows.length - 1].close)} r={2.6} fill="#0ea5e9" />
          <rect x={W - PAD_R} y={curY - 8} width={PAD_R} height={16} rx={3} fill="#0ea5e9" />
          <text x={W - PAD_R + PAD_R / 2} y={curY + 3} textAnchor="middle" className="fill-white text-[9px] font-black">{fmt(curPrice)}</text>
        </g>

        {/* crosshair + tooltip */}
        {hb && (
          <g pointerEvents="none">
            <line x1={x(hover as number)} x2={x(hover as number)} y1={TOP} y2={BOT} className="stroke-slate-400/70" strokeDasharray="2 3" />
            {(() => {
              const tx = clamp(x(hover as number) + 8, 6, W - 150)
              return (
                <g transform={`translate(${tx}, ${TOP + 4})`}>
                  <rect width={142} height={92} rx={6} className="fill-white stroke-slate-300 dark:fill-slate-950 dark:stroke-white/15" opacity={0.98} />
                  <text x={8} y={15} className="fill-slate-700 text-[10px] font-bold dark:fill-slate-200">{dayLabel(hb.time)} {hhmm(hb.time)}</text>
                  <text x={8} y={30} className="fill-slate-600 text-[10px] dark:fill-slate-300">O {fmt(hb.open)}  H {fmt(hb.high)}</text>
                  <text x={8} y={44} className="fill-slate-600 text-[10px] dark:fill-slate-300">L {fmt(hb.low)}  C {fmt(hb.close)}</text>
                  <text x={8} y={58} className="text-[10px] font-bold" fill={VWAP}>VWAP {fmt(hb.vwap)}</text>
                  <text x={8} y={72} className="text-[10px]" fill={EMA20}>EMA20 {fmt(hb.ema20)}</text>
                  <text x={8} y={86} className="text-[10px]" fill={EMA50}>EMA50 {fmt(hb.ema50)}</text>
                </g>
              )
            })()}
          </g>
        )}
      </svg>
      <div className="mt-1 text-[10px] text-tertiary">RTH 5-minute bars. VWAP resets each session; EMA20/50 run continuously. Hover for details.</div>
    </div>
  )
}
