import { useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react'
import { ChevronLeft, ChevronRight, Maximize2, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react'
import type { PositionSwingChartPoint, PositionSwingChartResponse } from '../api/client'

type Timeframe = 'Daily' | 'Weekly' | 'Monthly'

const BULLISH_CANDLE_COLOR = '#22c55e'
const BEARISH_CANDLE_COLOR = '#ef5350'

const money = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? '—' : `$${value.toFixed(2)}`
const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value))
const dateKey = (value: string) => value.slice(0, 10)
const formatDate = (value: string) => {
  const date = new Date(`${dateKey(value)}T12:00:00`)
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
const formatVolume = (value: number | null | undefined) => {
  if (value == null || !Number.isFinite(value)) return '—'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return value.toFixed(0)
}

function validNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function record(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

// ── indicator math (client-side, from the candle closes) ────────────────────
function emaSeries(values: number[], period: number): number[] {
  const k = 2 / (period + 1)
  const out = new Array<number>(values.length).fill(NaN)
  let prev: number | null = null
  values.forEach((v, i) => {
    if (!Number.isFinite(v)) { out[i] = prev ?? NaN; return }
    prev = prev == null ? v : v * k + prev * (1 - k)
    out[i] = prev
  })
  return out
}

function macdSeries(values: number[]): { macd: number[]; signal: number[]; hist: number[] } {
  const e12 = emaSeries(values, 12)
  const e26 = emaSeries(values, 26)
  const macd = values.map((_, i) => e12[i] - e26[i])
  const signal = emaSeries(macd, 9)
  const hist = macd.map((m, i) => m - signal[i])
  return { macd, signal, hist }
}

const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]
const INDICATOR_CHIPS = [
  { key: 'sma', label: 'SMA', color: '#f59e0b' },
  { key: 'ema', label: 'EMA', color: '#0ea5e9' },
  { key: 'fib', label: 'FIB', color: '#a78bfa' },
  { key: 'volProfile', label: 'VOL PROFILE', color: '#2dd4bf' },
  { key: 'macd', label: 'MACD', color: '#ef4444' },
] as const
type IndicatorKey = (typeof INDICATOR_CHIPS)[number]['key']

export default function PositionSwingChart({ chart }: { chart: PositionSwingChartResponse }) {
  const [timeframe, setTimeframe] = useState<Timeframe>('Daily')
  const [visibleBars, setVisibleBars] = useState(80)
  const [endIndex, setEndIndex] = useState(0)
  const [crosshair, setCrosshair] = useState<{ x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [indicators, setIndicators] = useState<Record<IndicatorKey, boolean>>({
    sma: true, ema: false, fib: false, volProfile: false, macd: false,
  })
  const toggleIndicator = (key: IndicatorKey) => setIndicators(prev => ({ ...prev, [key]: !prev[key] }))
  const dragRef = useRef<{ pointerId: number; startX: number } | null>(null)
  const points = chart.chartSeriesByTimeframe[timeframe]?.points ?? []
  const closes = useMemo(() => points.map(point => point.c), [points])
  const ema20All = useMemo(() => emaSeries(closes, 20), [closes])
  const ema50All = useMemo(() => emaSeries(closes, 50), [closes])
  const macdAll = useMemo(() => macdSeries(closes), [closes])

  useEffect(() => {
    setEndIndex(points.length)
    setVisibleBars(Math.min(80, Math.max(20, points.length || 80)))
  }, [points.length, timeframe])

  const values = useMemo(() => points.flatMap(point => [point.c, point.ma20, point.ma50].filter(validNumber)), [points])
  if (!points.length || !values.length) {
    return <div className="flex h-full min-h-[320px] items-center justify-center rounded-lg border border-dashed border-border bg-surface-canvas text-sm text-text-tertiary">No backend {timeframe.toLowerCase()} chart series is available.</div>
  }

  const width = 1100
  const height = 560
  const priceTop = 22
  const priceBottom = 390
  const volumeTop = 412
  const volumeBottom = 490
  const safeEnd = Math.min(Math.max(endIndex || points.length, visibleBars), points.length)
  const visibleStart = Math.max(0, safeEnd - visibleBars)
  const visible = points.slice(visibleStart, safeEnd)
  const priceValues = visible.flatMap(point => [point.c, point.o, point.h, point.l, point.ma20, point.ma50].filter(validNumber))
  const minValue = Math.min(...priceValues)
  const maxValue = Math.max(...priceValues)
  const padding = Math.max((maxValue - minValue) * 0.08, maxValue * 0.004)
  const minimum = minValue - padding
  const maximum = maxValue + padding
  const range = maximum - minimum || 1
  const maxVolume = Math.max(1, ...visible.map(point => point.v || 0))
  const step = width / Math.max(1, visible.length)
  const candleWidth = Math.max(3, Math.min(18, step * 0.58))
  const xFor = (index: number) => index * step + step / 2
  const yFor = (price: number) => priceBottom - ((price - minimum) / range) * (priceBottom - priceTop)
  const seriesPath = (key: 'ma20' | 'ma50') => visible.reduce((path, point, index) => {
    const value = point[key]
    if (!validNumber(value)) return path
    return `${path}${path ? 'L' : 'M'}${xFor(index).toFixed(1)},${yFor(value).toFixed(1)}`
  }, '')
  // EMA path from a full-series array, sliced to the visible window
  const emaPathFor = (arr: number[]) => visible.reduce((path, _point, index) => {
    const value = arr[visibleStart + index]
    if (!validNumber(value)) return path
    return `${path}${path ? 'L' : 'M'}${xFor(index).toFixed(1)},${yFor(value).toFixed(1)}`
  }, '')
  // Fibonacci retracement across the visible swing high → low
  const swingHigh = Math.max(...visible.map(point => (validNumber(point.h) ? point.h : point.c)))
  const swingLow = Math.min(...visible.map(point => (validNumber(point.l) ? point.l : point.c)))
  const fibLevels = FIB_RATIOS.map(ratio => ({ ratio, price: swingHigh - ratio * (swingHigh - swingLow) }))
  // Volume profile — volume-by-price buckets across the visible price range
  const VP_BINS = 28
  const vpBuckets = new Array<number>(VP_BINS).fill(0)
  visible.forEach(point => {
    if (!validNumber(point.c)) return
    const bin = clamp(Math.floor(((point.c - minimum) / range) * VP_BINS), 0, VP_BINS - 1)
    vpBuckets[bin] += point.v || 0
  })
  const vpMax = Math.max(1, ...vpBuckets)
  const tickCount = Math.min(7, visible.length)
  const tickIndexes: number[] = Array.from({ length: tickCount }, (_, index) => Math.round(index * (visible.length - 1) / Math.max(1, tickCount - 1)))
  const indexByDate = new Map(visible.map((point, index) => [dateKey(point.d), index]))
  const pattern = chart.chartSeriesByTimeframe[timeframe]?.pattern_overlay
  const segments = record(pattern) && Array.isArray(pattern.segments) ? pattern.segments.flatMap(segment => {
    if (!record(segment) || !validNumber(segment.fromPrice) || !validNumber(segment.toPrice) || typeof segment.from !== 'string' || typeof segment.to !== 'string') return []
    const from = indexByDate.get(dateKey(segment.from))
    const to = indexByDate.get(dateKey(segment.to))
    return from == null || to == null ? [] : [{ role: String(segment.role || ''), x1: xFor(from), y1: yFor(segment.fromPrice), x2: xFor(to), y2: yFor(segment.toPrice) }]
  }) : []
  const pivots = record(chart.marketStructure) && Array.isArray(chart.marketStructure.chart_pivots)
    ? chart.marketStructure.chart_pivots.flatMap(pivot => {
        if (!record(pivot) || typeof pivot.date !== 'string' || !validNumber(pivot.price)) return []
        const index = indexByDate.get(dateKey(pivot.date))
        return index == null ? [] : [{ label: String(pivot.label || 'Pivot'), price: pivot.price, x: xFor(index), y: yFor(pivot.price), provisional: pivot.status === 'PROVISIONAL' || pivot.confirmed === false }]
      }).slice(-6)
    : []
  const nearestIndex = crosshair ? clamp(Math.round(crosshair.x / step - 0.5), 0, visible.length - 1) : null
  const nearest = nearestIndex == null ? null : visible[nearestIndex]

  const panBy = (bars: number) => setEndIndex(current => clamp((current || points.length) + bars, visibleBars, points.length))
  const zoom = (direction: 'in' | 'out') => setVisibleBars(current => clamp(current + (direction === 'in' ? -16 : 16), 20, points.length))
  const reset = () => { setVisibleBars(Math.min(80, Math.max(20, points.length))); setEndIndex(points.length) }
  const pointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX }
    setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const pointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const pixelWidth = event.currentTarget.getBoundingClientRect().width / Math.max(1, visibleBars)
    const bars = Math.trunc((event.clientX - drag.startX) / Math.max(4, pixelWidth))
    if (bars) { panBy(-bars); dragRef.current = { ...drag, startX: event.clientX } }
  }
  const stopDrag = (event: PointerEvent<SVGSVGElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const wheel = (event: WheelEvent<SVGSVGElement>) => {
    if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) panBy(Math.sign(event.deltaX || event.deltaY) * Math.max(1, Math.round(visibleBars * 0.08)))
    else zoom(event.deltaY < 0 ? 'in' : 'out')
  }

  return (
    <div className="flex h-full min-h-[420px] flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-2 py-2">
        <div className="flex items-center gap-2 text-[11px] font-semibold text-text-secondary">
          <span className="text-[10px] font-black uppercase tracking-widest text-text-tertiary">Swing Chart</span>
          <span className="hidden font-mono text-text-tertiary sm:inline">{visible.length} bars</span>
          {record(pattern) && typeof pattern.label === 'string' && <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] font-bold text-violet-700 dark:text-violet-200">{pattern.label} · {String(pattern.status || 'FORMING')}</span>}
        </div>
        <div className="flex items-center gap-1">
          {(['Daily', 'Weekly', 'Monthly'] as Timeframe[]).map(value => <button key={value} type="button" onClick={() => setTimeframe(value)} className={`rounded-md border px-2 py-1 text-[10px] font-black ${timeframe === value ? 'border-violet-500 bg-violet-500/10 text-violet-700 dark:text-violet-200' : 'border-border text-text-secondary hover:bg-surface-muted'}`}>{value}</button>)}
          <button type="button" onClick={() => zoom('in')} className="rounded-md border border-border p-1.5 text-text-secondary hover:bg-surface-muted" title="Zoom in" aria-label="Zoom in"><ZoomIn size={14} /></button>
          <button type="button" onClick={() => zoom('out')} className="rounded-md border border-border p-1.5 text-text-secondary hover:bg-surface-muted" title="Zoom out" aria-label="Zoom out"><ZoomOut size={14} /></button>
          <button type="button" onClick={() => panBy(-12)} className="rounded-md border border-border p-1.5 text-text-secondary hover:bg-surface-muted" title="Pan left" aria-label="Pan left"><ChevronLeft size={14} /></button>
          <button type="button" onClick={() => panBy(12)} className="rounded-md border border-border p-1.5 text-text-secondary hover:bg-surface-muted" title="Pan right" aria-label="Pan right"><ChevronRight size={14} /></button>
          <button type="button" onClick={() => { setVisibleBars(points.length); setEndIndex(points.length) }} className="rounded-md border border-border p-1.5 text-text-secondary hover:bg-surface-muted" title="Fit chart" aria-label="Fit chart"><Maximize2 size={14} /></button>
          <button type="button" onClick={reset} className="rounded-md border border-border p-1.5 text-text-secondary hover:bg-surface-muted" title="Reset chart" aria-label="Reset chart"><RotateCcw size={14} /></button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-2 py-1.5">
        <span className="text-[9px] font-black uppercase tracking-widest text-text-tertiary">Indicators</span>
        {INDICATOR_CHIPS.map(chip => (
          <button key={chip.key} type="button" onClick={() => toggleIndicator(chip.key)}
            className={`flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold transition-colors ${indicators[chip.key] ? 'border-transparent text-white' : 'border-border text-text-secondary hover:bg-surface-muted'}`}
            style={indicators[chip.key] ? { backgroundColor: chip.color } : undefined}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: indicators[chip.key] ? '#ffffff' : chip.color }} />
            {chip.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <svg viewBox={`0 0 ${width} ${height}`} className={`h-full w-full select-none touch-none ${dragging ? 'cursor-grabbing' : 'cursor-crosshair'}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={stopDrag} onPointerCancel={stopDrag} onMouseMove={event => { const rect = event.currentTarget.getBoundingClientRect(); setCrosshair({ x: ((event.clientX - rect.left) / rect.width) * width, y: ((event.clientY - rect.top) / rect.height) * height }) }} onMouseLeave={() => setCrosshair(null)} onWheel={wheel}>
          <rect width={width} height={height} fill="var(--surface-canvas)" />
          {[0, 0.25, 0.5, 0.75, 1].map(fraction => { const y = priceTop + fraction * (priceBottom - priceTop); const price = maximum - fraction * range; return <g key={fraction}><line x1="0" x2={width} y1={y} y2={y} stroke="var(--border-subtle)" strokeDasharray="3 5" /><text x={width - 8} y={y - 5} textAnchor="end" className="fill-slate-500 text-[10px] font-mono">${price.toFixed(2)}</text></g> })}
          {visible.map((point, index) => { const open = validNumber(point.o) ? point.o : point.c; const high = validNumber(point.h) ? point.h : Math.max(open, point.c); const low = validNumber(point.l) ? point.l : Math.min(open, point.c); const bullish = point.c >= open; const color = bullish ? BULLISH_CANDLE_COLOR : BEARISH_CANDLE_COLOR; const x = xFor(index); const bodyTop = yFor(Math.max(open, point.c)); const bodyBottom = yFor(Math.min(open, point.c)); return <g key={`${point.d}-${index}`}><line x1={x} x2={x} y1={yFor(high)} y2={yFor(low)} stroke={color} strokeWidth="1.5" /><rect x={x - candleWidth / 2} y={bodyTop} width={candleWidth} height={Math.max(1.6, bodyBottom - bodyTop)} rx="1" fill={color} /></g> })}
          {indicators.volProfile && vpBuckets.map((vol, bin) => {
            const yTop = yFor(minimum + ((bin + 1) / VP_BINS) * range)
            const yBottom = yFor(minimum + (bin / VP_BINS) * range)
            const barWidth = (vol / vpMax) * 170
            return <rect key={`vp-${bin}`} x="0" y={yTop} width={barWidth} height={Math.max(1, yBottom - yTop - 1)} fill="#2dd4bf" opacity="0.42" rx="1" />
          })}
          {indicators.sma && seriesPath('ma20') && <path d={seriesPath('ma20')} fill="none" stroke="#f59e0b" strokeWidth="1.8" />}
          {indicators.sma && seriesPath('ma50') && <path d={seriesPath('ma50')} fill="none" stroke="#8b5cf6" strokeWidth="1.8" />}
          {indicators.ema && emaPathFor(ema20All) && <path d={emaPathFor(ema20All)} fill="none" stroke="#0ea5e9" strokeWidth="1.6" strokeDasharray="5 3" />}
          {indicators.ema && emaPathFor(ema50All) && <path d={emaPathFor(ema50All)} fill="none" stroke="#6366f1" strokeWidth="1.6" strokeDasharray="5 3" />}
          {indicators.fib && fibLevels.map(level => (
            <g key={level.ratio}>
              <line x1="0" x2={width} y1={yFor(level.price)} y2={yFor(level.price)} stroke="#a78bfa" strokeWidth="1" strokeDasharray="2 4" opacity="0.75" />
              <text x="6" y={yFor(level.price) - 3} className="fill-violet-500 text-[9px] font-mono">{(level.ratio * 100).toFixed(1)}% · ${level.price.toFixed(2)}</text>
            </g>
          ))}
          {segments.map((segment, index) => <line key={`${segment.role}-${index}`} x1={segment.x1} y1={segment.y1} x2={segment.x2} y2={segment.y2} stroke={segment.role === 'pole' ? '#8b5cf6' : '#a78bfa'} strokeWidth={segment.role === 'pole' ? '2.5' : '1.8'} strokeDasharray={segment.role === 'pole' ? undefined : '6 5'} />)}
          {pivots.map((pivot, index) => <g key={`${pivot.label}-${index}`}><circle cx={pivot.x} cy={pivot.y} r="4" fill={pivot.provisional ? 'var(--surface-card)' : '#10b981'} stroke="#10b981" strokeWidth="1.5" /><rect x={pivot.x - 18} y={pivot.y + (pivot.label.includes('H') ? -24 : 8)} width="36" height="16" rx="5" fill="var(--surface-card)" stroke="#10b981" /><text x={pivot.x} y={pivot.y + (pivot.label.includes('H') ? -13 : 20)} textAnchor="middle" className="fill-emerald-600 text-[9px] font-black dark:fill-emerald-300">{pivot.label}</text></g>)}
          <line x1="0" x2={width} y1={volumeTop - 8} y2={volumeTop - 8} stroke="var(--border-subtle)" />
          <text x="10" y={volumeTop - 17} className="fill-slate-500 text-[10px] font-black uppercase tracking-widest">Volume</text>
          {visible.map((point, index) => { const heightValue = ((point.v || 0) / maxVolume) * (volumeBottom - volumeTop); const bullish = point.c >= (validNumber(point.o) ? point.o : point.c); return <rect key={`v-${point.d}-${index}`} x={xFor(index) - candleWidth / 2} y={volumeBottom - heightValue} width={candleWidth} height={heightValue} fill={bullish ? BULLISH_CANDLE_COLOR : BEARISH_CANDLE_COLOR} opacity="0.45" /> })}
          {tickIndexes.map(index => <g key={index}><line x1={xFor(index)} x2={xFor(index)} y1={volumeBottom + 4} y2={volumeBottom + 10} stroke="var(--border-default)" /><text x={xFor(index)} y={height - 12} textAnchor="middle" className="fill-slate-500 text-[10px] font-mono">{formatDate(visible[index]!.d)}</text></g>)}
          {crosshair && <g><line x1={crosshair.x} x2={crosshair.x} y1="0" y2={height} stroke="#94a3b8" strokeDasharray="3 4" opacity="0.5" /><line x1="0" x2={width} y1={crosshair.y} y2={crosshair.y} stroke="#94a3b8" strokeDasharray="3 4" opacity="0.3" />{nearest && <g transform={`translate(${clamp(crosshair.x + 14, 8, width - 170)}, ${clamp(crosshair.y + 14, 8, height - 124)})`}><rect width="162" height="116" rx="7" fill="var(--chart-tooltip-bg)" stroke="var(--chart-tooltip-border)" /><text x="10" y="19" className="fill-slate-900 text-[10px] font-bold dark:fill-slate-100">{formatDate(nearest.d)}</text><text x="10" y="38" className="fill-slate-600 text-[10px] dark:fill-slate-300">Open: {money(nearest.o ?? nearest.c)}</text><text x="10" y="54" className="fill-slate-600 text-[10px] dark:fill-slate-300">High: {money(nearest.h ?? nearest.c)}</text><text x="10" y="70" className="fill-slate-600 text-[10px] dark:fill-slate-300">Low: {money(nearest.l ?? nearest.c)}</text><text x="10" y="86" className="fill-slate-600 text-[10px] dark:fill-slate-300">Close: {money(nearest.c)}</text><text x="10" y="102" className="fill-slate-500 text-[9px] dark:fill-slate-400">Vol: {formatVolume(nearest.v)} · MA20 {money(nearest.ma20)}</text></g>}</g>}
        </svg>
      </div>
      {indicators.macd && (() => {
        const vMacd = visible.map((_p, i) => macdAll.macd[visibleStart + i])
        const vSignal = visible.map((_p, i) => macdAll.signal[visibleStart + i])
        const vHist = visible.map((_p, i) => macdAll.hist[visibleStart + i])
        const scale = Math.max(0.0001, ...[...vMacd, ...vSignal, ...vHist].filter(validNumber).map(Math.abs))
        const mH = 150
        const yM = (v: number) => mH / 2 - (v / scale) * (mH / 2 - 16)
        const line = (arr: number[]) => arr.reduce((path, v, i) => (validNumber(v) ? `${path}${path ? 'L' : 'M'}${xFor(i).toFixed(1)},${yM(v).toFixed(1)}` : path), '')
        return (
          <div className="shrink-0 border-t border-border">
            <svg viewBox={`0 0 ${width} ${mH}`} className="h-[118px] w-full">
              <rect width={width} height={mH} fill="var(--surface-canvas)" />
              <text x="10" y="16" className="fill-slate-500 text-[10px] font-black uppercase tracking-widest">MACD 12 / 26 / 9</text>
              <line x1="0" x2={width} y1={mH / 2} y2={mH / 2} stroke="var(--border-subtle)" />
              {vHist.map((v, i) => (validNumber(v) ? <rect key={`h-${i}`} x={xFor(i) - candleWidth / 2} y={Math.min(mH / 2, yM(v))} width={candleWidth} height={Math.abs(yM(v) - mH / 2)} fill={v >= 0 ? BULLISH_CANDLE_COLOR : BEARISH_CANDLE_COLOR} opacity="0.55" /> : null))}
              {line(vMacd) && <path d={line(vMacd)} fill="none" stroke="#3b82f6" strokeWidth="1.6" />}
              {line(vSignal) && <path d={line(vSignal)} fill="none" stroke="#f59e0b" strokeWidth="1.6" />}
            </svg>
          </div>
        )
      })()}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2 text-[11px] text-text-tertiary"><span className="font-mono">{visible[0]?.d} → {visible[visible.length - 1]?.d}</span><span>{timeframe} OHLC · SMA/EMA/MACD/Fib/Volume-Profile indicators</span></div>
    </div>
  )
}
