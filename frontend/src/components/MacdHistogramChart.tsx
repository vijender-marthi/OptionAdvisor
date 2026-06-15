/**
 * MACD histogram (12/26/9 daily) computed client-side from metrics.chart_series
 * closes. Renders the price line over a four-phase histogram — solid bars =
 * momentum growing, faded bars = momentum fading — with crossover markers and
 * a phase readout. Lives inside the always-dark engine result panel.
 */
import { useEffect, useMemo, useRef } from 'react'
import { parseChartPayload } from './SwingTradeMetricCharts'

const C = {
  greenGrow: '#3fb950',
  greenFade: 'rgba(63,185,80,0.5)',
  redGrow: '#f85149',
  redFade: 'rgba(248,81,73,0.5)',
  greenSoft: '#4ade80',
  redSoft: '#f87171',
  zero: '#30363d',
  divider: '#1c2330',
  price: '#58a6ff',
  cross: '#d29922',
  label: '#6e7681',
}

function emaSeries(values: number[], period: number): number[] {
  const k = 2 / (period + 1)
  const out: number[] = []
  let prev = values[0]
  values.forEach((v, i) => {
    prev = i === 0 ? v : v * k + prev * (1 - k)
    out.push(prev)
  })
  return out
}

interface MacdData {
  hist: number[]
  macd: number[]
  signal: number[]
  closes: number[]
  dates: string[]
}

/** Warm-up bars to discard before the 12/26/9 values are trustworthy. */
const WARMUP = 33
/** Max bars shown in the chart window. */
const WINDOW = 60

function computeMacd(closes: number[], dates: string[]): MacdData | null {
  if (closes.length < WARMUP + 5) return null
  const ema12 = emaSeries(closes, 12)
  const ema26 = emaSeries(closes, 26)
  const macdFull = closes.map((_, i) => ema12[i] - ema26[i])
  const signalFull = emaSeries(macdFull, 9)
  const histFull = macdFull.map((v, i) => v - signalFull[i])
  const start = Math.max(WARMUP, histFull.length - WINDOW)
  return {
    hist: histFull.slice(start),
    macd: macdFull.slice(start),
    signal: signalFull.slice(start),
    closes: closes.slice(start),
    dates: dates.slice(start),
  }
}

type Phase = 'green-growing' | 'green-shrinking' | 'red-shrinking' | 'red-growing'

const PHASES: Record<Phase, { name: string; color: string }> = {
  'green-growing': { name: 'Green Growing', color: C.greenGrow },
  'green-shrinking': { name: 'Green Shrinking', color: C.greenSoft },
  'red-shrinking': { name: 'Red Shrinking', color: C.redSoft },
  'red-growing': { name: 'Red Growing', color: C.redGrow },
}

function currentPhase(hist: number[]): Phase {
  const last = hist[hist.length - 1]
  const prev = hist[hist.length - 2] ?? last
  const growing = Math.abs(last) >= Math.abs(prev)
  if (last >= 0) return growing ? 'green-growing' : 'green-shrinking'
  return growing ? 'red-growing' : 'red-shrinking'
}

/** Bars since the histogram last flipped sign (1 = flipped on the latest bar). */
function barsSinceFlip(hist: number[]): number {
  const lastPos = hist[hist.length - 1] >= 0
  for (let i = hist.length - 2; i >= 0; i--) {
    if ((hist[i] >= 0) !== lastPos) return hist.length - 1 - i
  }
  return hist.length
}

function draw(canvas: HTMLCanvasElement, d: MacdData) {
  const W = canvas.offsetWidth || 600
  const H = 210
  const dpr = window.devicePixelRatio || 1
  canvas.width = W * dpr
  canvas.height = H * dpr
  canvas.style.height = `${H}px`
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, W, H)

  const n = d.hist.length
  const padL = 30
  const padR = 10
  const priceTop = 8
  const priceH = 80
  const histTop = 106
  const histH = 84
  const zeroY = histTop + histH / 2
  const bw = Math.max(3, (W - padL - padR) / n - 2)

  // divider between price and histogram
  ctx.strokeStyle = C.divider
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(padL, histTop - 8)
  ctx.lineTo(W - padR, histTop - 8)
  ctx.stroke()

  // zero line
  ctx.strokeStyle = C.zero
  ctx.beginPath()
  ctx.moveTo(padL, zeroY)
  ctx.lineTo(W - padR, zeroY)
  ctx.stroke()

  const xOf = (i: number) => padL + i * ((W - padL - padR) / n) + ((W - padL - padR) / n - bw) / 2

  // crossover markers — dashed vertical at each sign flip, label on the latest
  let lastFlip = -1
  for (let i = 1; i < n; i++) {
    if ((d.hist[i] >= 0) !== (d.hist[i - 1] >= 0)) lastFlip = i
  }
  for (let i = 1; i < n; i++) {
    if ((d.hist[i] >= 0) !== (d.hist[i - 1] >= 0)) {
      const x = xOf(i) - 1
      const latest = i === lastFlip
      ctx.strokeStyle = latest ? C.cross : 'rgba(210,153,34,0.25)'
      ctx.lineWidth = latest ? 1.5 : 1
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      ctx.moveTo(x, priceTop)
      ctx.lineTo(x, histTop + histH)
      ctx.stroke()
      ctx.setLineDash([])
      if (latest) {
        ctx.fillStyle = C.cross
        ctx.font = 'bold 9px -apple-system, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(d.hist[i] >= 0 ? '▲ BULL CROSS' : '▼ BEAR CROSS', x, priceTop + 8)
      }
    }
  }

  // price line + gradient fill
  const mn = Math.min(...d.closes)
  const mx = Math.max(...d.closes)
  const span = mx - mn || 1
  const px = (i: number) => padL + i * ((W - padL - padR) / (n - 1))
  const py = (v: number) => priceTop + (1 - (v - mn) / span) * priceH

  const lastUp = d.closes[n - 1] >= d.closes[0]
  const grad = ctx.createLinearGradient(0, priceTop, 0, priceTop + priceH)
  grad.addColorStop(0, lastUp ? 'rgba(63,185,80,0.15)' : 'rgba(248,81,73,0.15)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.beginPath()
  d.closes.forEach((v, i) => (i === 0 ? ctx.moveTo(px(i), py(v)) : ctx.lineTo(px(i), py(v))))
  ctx.lineTo(px(n - 1), priceTop + priceH)
  ctx.lineTo(px(0), priceTop + priceH)
  ctx.closePath()
  ctx.fillStyle = grad
  ctx.fill()

  ctx.strokeStyle = C.price
  ctx.lineWidth = 1.8
  ctx.beginPath()
  d.closes.forEach((v, i) => (i === 0 ? ctx.moveTo(px(i), py(v)) : ctx.lineTo(px(i), py(v))))
  ctx.stroke()

  // histogram bars — solid when |v| growing, faded when fading
  const maxV = Math.max(...d.hist.map(Math.abs)) * 1.1 || 1
  d.hist.forEach((v, i) => {
    const x = xOf(i)
    const barH = (Math.abs(v) / maxV) * (histH / 2 - 4)
    const isPos = v >= 0
    const growing = i === 0 ? true : Math.abs(v) >= Math.abs(d.hist[i - 1])
    ctx.fillStyle = isPos ? (growing ? C.greenGrow : C.greenFade) : (growing ? C.redGrow : C.redFade)
    if (isPos) ctx.fillRect(x, zeroY - barH, bw, barH)
    else ctx.fillRect(x, zeroY, bw, barH)
  })

  // labels
  ctx.fillStyle = C.price
  ctx.font = '9px -apple-system, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('Price', padL + 2, priceTop + 10)
  ctx.fillStyle = C.label
  ctx.fillText('MACD Histogram (12/26/9)', padL + 2, histTop + 4)
  ctx.fillText('0', 4, zeroY + 3)

  // date range
  ctx.textAlign = 'right'
  ctx.fillText(`${d.dates[0]} → ${d.dates[n - 1]}`, W - padR, H - 2)
}

export default function MacdHistogramChart({ metrics }: { metrics: Record<string, unknown> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const data = useMemo(() => {
    const points = parseChartPayload(metrics.chart_series)
    if (!points) return null
    return computeMacd(points.map(p => p.c), points.map(p => p.d))
  }, [metrics.chart_series])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !data) return
    const redraw = () => draw(canvas, data)
    redraw()
    const ro = new ResizeObserver(redraw)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [data])

  if (!data) return null

  const phase = PHASES[currentPhase(data.hist)]
  const flipAge = barsSinceFlip(data.hist)
  const lastHist = data.hist[data.hist.length - 1]

  return (
    <div>
      <canvas ref={canvasRef} className="block w-full" />

      {/* current readings for the selected ticker */}
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[11px] text-slate-500 dark:text-gray-400">
        <span className="font-sans font-bold" style={{ color: phase.color }}>● {phase.name}</span>
        <span>MACD <span className="text-slate-700 dark:text-gray-200">{data.macd[data.macd.length - 1].toFixed(2)}</span></span>
        <span>Signal <span className="text-slate-700 dark:text-gray-200">{data.signal[data.signal.length - 1].toFixed(2)}</span></span>
        <span>Histogram <span style={{ color: lastHist >= 0 ? C.greenGrow : C.redGrow }}>{lastHist.toFixed(2)}</span></span>
        <span>Last flip <span className="text-slate-700 dark:text-gray-200">{flipAge >= data.hist.length ? '—' : `${flipAge} bar${flipAge === 1 ? '' : 's'} ago`}</span></span>
      </div>
    </div>
  )
}
