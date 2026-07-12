import { useEffect, useMemo, useState } from 'react'
import type { MouseEvent } from 'react'
import type { DayTradeSemanticTone, DayTradeWorkspaceResponse } from '../api/client'

type WorkspaceChart = DayTradeWorkspaceResponse['chart']
type WorkspaceInterval = '1m' | '5m' | '15m'
type WorkspaceRange = '30m' | '1h' | '2h' | 'session'

type Point = {
  x: number
  openY: number
  highY: number
  lowY: number
  closeY: number
  volumeY: number
  volumeHeight: number
  up: boolean
}

type VwapRenderPoint = {
  x: number
  y: number
  value: number
  time: string
}

const WIDTH = 1000
const HEIGHT = 620
const PRICE_TOP = 20
const PRICE_BOTTOM = 468
const VOLUME_TOP = 500
const VOLUME_BOTTOM = 600
const VWAP_STROKE = '#facc15'

function toneStroke(tone: DayTradeSemanticTone): string {
  if (tone === 'positive') return 'var(--semantic-bullish)'
  if (tone === 'danger') return 'var(--semantic-bearish)'
  if (tone === 'warning') return 'var(--semantic-warning)'
  if (tone === 'managing') return 'var(--semantic-manage)'
  if (tone === 'info') return 'var(--semantic-info)'
  return 'var(--text-tertiary)'
}

function safeNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value))
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function displayTime(value: string, timeZone?: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value.slice(11, 16)
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone })
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`
}

function formatVolume(value: number): string {
  return Math.round(value).toLocaleString()
}

export default function DayTradeWorkspaceChart({ chart, marketTimeZone, onIntervalChange }: { chart: WorkspaceChart; marketTimeZone?: string; onIntervalChange?: (interval: WorkspaceInterval) => void }) {
  const firstCandleTime = chart.candles[0]?.time || ''
  const defaultVisibleBars = clamp(safeNumber(chart.defaults.initialVisibleBars, 100), 10, Math.max(10, chart.candles.length || 10))
  const defaultOverlayIds = useMemo(() => new Set(chart.defaults.visibleOverlayIds), [chart.defaults.visibleOverlayIds])
  const [visibleBars, setVisibleBars] = useState(defaultVisibleBars)
  const [endIndex, setEndIndex] = useState(chart.candles.length)
  const [followLive, setFollowLive] = useState(chart.defaults.followLive)
  const [overlayMenuOpen, setOverlayMenuOpen] = useState(false)
  const [visibleOverlayIds, setVisibleOverlayIds] = useState(defaultOverlayIds)
  const [fullscreen, setFullscreen] = useState(false)
  const [visibleRange, setVisibleRange] = useState<WorkspaceRange>(chart.defaults.visibleRange === '30m' || chart.defaults.visibleRange === '2h' || chart.defaults.visibleRange === 'session' ? chart.defaults.visibleRange : '1h')
  const [crosshair, setCrosshair] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    setVisibleBars(defaultVisibleBars)
    setEndIndex(chart.candles.length)
    setFollowLive(chart.defaults.followLive)
    setVisibleOverlayIds(defaultOverlayIds)
    setVisibleRange(chart.defaults.visibleRange === '30m' || chart.defaults.visibleRange === '2h' || chart.defaults.visibleRange === 'session' ? chart.defaults.visibleRange : '1h')
  }, [chart.defaults.followLive, chart.defaults.interval, chart.defaults.visibleRange, defaultOverlayIds, defaultVisibleBars, firstCandleTime])

  const model = useMemo(() => {
    const candles = chart.candles || []
    const safeEndIndex = followLive ? candles.length : clamp(endIndex, 0, candles.length)
    const visibleCount = clamp(visibleBars, 1, Math.max(1, candles.length))
    const startIndex = clamp(safeEndIndex - visibleCount, 0, candles.length)
    const visibleCandles = candles.slice(startIndex, safeEndIndex)
    const visibleTimeSet = new Set(visibleCandles.map(candle => candle.time))
    const barWidth = visibleCandles.length > 0 ? WIDTH / (visibleCandles.length + safeNumber(chart.defaults.rightOffsetBars, 4)) : WIDTH
    const levelScaleIds = new Set(chart.tradeFocus?.levelIdsAllowedToAffectScale || [])
    const scaleLevels = chart.defaults.scaleMode === 'full_context'
      ? chart.levels
      : chart.levels.filter(level => levelScaleIds.has(level.id))
    const scaleVwapValues = chart.vwapOverlay && (chart.defaults.scaleMode === 'full_context' || chart.vwapOverlay.affectsTradeFocusScale)
      ? chart.vwapOverlay.points
          .filter(point => chart.defaults.scaleMode === 'full_context' || visibleTimeSet.has(point.barStartUtc))
          .map(point => point.value)
      : []
    const confirmedStructurePivots = (chart.marketStructure?.pivots || [])
      .filter(pivot => pivot.confirmed && String(pivot.status || 'CONFIRMED').toUpperCase() === 'CONFIRMED' && Boolean(pivot.label))
    const scaleStructureValues = chart.marketStructure && visibleOverlayIds.has(chart.marketStructure.id)
      ? confirmedStructurePivots
          .filter(pivot => visibleTimeSet.has(pivot.timestamp))
          .map(pivot => pivot.price)
      : []

    const prices = [
      ...visibleCandles.flatMap(candle => [candle.high, candle.low]),
      ...scaleLevels.map(level => level.price),
      ...scaleVwapValues,
      ...scaleStructureValues,
    ].filter(isFiniteNumber)
    const rawMin = prices.length ? Math.min(...prices) : 0
    const rawMax = prices.length ? Math.max(...prices) : 1
    const rawRange = rawMax - rawMin || 1
    const padding = rawRange * safeNumber(chart.tradeFocus?.scalePaddingPercent ?? 8, 8) / 100
    const minPrice = rawMin - padding
    const maxPrice = rawMax + padding
    const priceRange = maxPrice - minPrice || 1
    const maxVolume = Math.max(1, ...visibleCandles.map(candle => safeNumber(candle.volume, 0)))

    const yForPrice = (price: number) => PRICE_BOTTOM - ((price - minPrice) / priceRange) * (PRICE_BOTTOM - PRICE_TOP)
    const xForIndex = (index: number) => index * barWidth + barWidth * 0.5
    const visibleTimes = new Map(visibleCandles.map((candle, index) => [candle.time, xForIndex(index)]))
    const points: Point[] = visibleCandles.map((candle, index) => {
      const volumeHeight = (safeNumber(candle.volume, 0) / maxVolume) * (VOLUME_BOTTOM - VOLUME_TOP)
      return {
        x: xForIndex(index),
        openY: yForPrice(candle.open),
        highY: yForPrice(candle.high),
        lowY: yForPrice(candle.low),
        closeY: yForPrice(candle.close),
        volumeY: VOLUME_BOTTOM - volumeHeight,
        volumeHeight,
        up: candle.close >= candle.open,
      }
    })
    const vwapSegments: VwapRenderPoint[][] = []
    let currentSegment: VwapRenderPoint[] = []
    for (const point of chart.vwapOverlay?.points || []) {
      const value = typeof point.value === 'number' && Number.isFinite(point.value) ? point.value : null
      const x = visibleTimes.get(point.barStartUtc)
      const quality = String(point.quality || '').toLowerCase()
      if (value == null || x == null || quality === 'unavailable') {
        if (currentSegment.length) vwapSegments.push(currentSegment)
        currentSegment = []
        continue
      }
      currentSegment.push({
        x,
        y: yForPrice(value),
        value,
        time: point.barStartUtc,
      })
    }
    if (currentSegment.length) vwapSegments.push(currentSegment)
    const structurePoints = confirmedStructurePivots
      .map(pivot => {
        const x = visibleTimes.get(pivot.timestamp)
        if (x == null || !Number.isFinite(pivot.price)) return null
        return { ...pivot, x, y: yForPrice(pivot.price) }
      })
      .filter((point): point is NonNullable<typeof point> => point != null)

    return {
      visibleCandles,
      points,
      barWidth,
      yForPrice,
      visibleTimes,
      vwapSegments,
      structurePoints,
      minPrice,
      maxPrice,
    }
  }, [chart, endIndex, followLive, visibleBars, visibleOverlayIds])

  const overlayOptions = useMemo(() => {
    const map = new Map<string, { id: string; label: string }>()
    for (const level of chart.levels) map.set(level.id, { id: level.id, label: level.label })
    for (const event of chart.events) map.set(event.id, { id: event.id, label: event.title })
    if (chart.vwapOverlay) map.set(chart.vwapOverlay.id, { id: chart.vwapOverlay.id, label: chart.vwapOverlay.label })
    if (chart.marketStructure) map.set(chart.marketStructure.id, { id: chart.marketStructure.id, label: 'HH / HL / LH / LL' })
    return [...map.values()]
  }, [chart.events, chart.levels, chart.marketStructure, chart.vwapOverlay])

  const activeChips = useMemo(() => {
    const chips: Array<{ id: string; label: string; removable: boolean }> = []
    if (chart.vwapOverlay) chips.push({ id: chart.vwapOverlay.id, label: 'VWAP', removable: true })
    for (const level of chart.levels) chips.push({ id: level.id, label: level.label, removable: true })
    if (chart.marketStructure) chips.push({ id: chart.marketStructure.id, label: 'HH / HL / LH / LL', removable: true })
    chips.push({ id: 'volume', label: 'Volume', removable: false })
    return chips
  }, [chart.levels, chart.marketStructure, chart.vwapOverlay])

  const crosshairDetail = useMemo(() => {
    if (!crosshair || !model.visibleCandles.length) return null
    const nearestIndex = clamp(Math.round(crosshair.x / Math.max(1, model.barWidth) - 0.5), 0, model.visibleCandles.length - 1)
    const candle = model.visibleCandles[nearestIndex]
    const vwapPoint = chart.vwapOverlay?.points.find(point => point.barStartUtc === candle.time)
    const vwapValue = typeof vwapPoint?.value === 'number' && Number.isFinite(vwapPoint.value) ? vwapPoint.value : null
    return { candle, vwapValue }
  }, [chart.vwapOverlay?.points, crosshair, model.barWidth, model.visibleCandles])

  const zoom = (direction: 'in' | 'out') => {
    const barChange = direction === 'in' ? -15 : 15
    setVisibleBars(cur => clamp(cur + barChange, 10, Math.max(10, chart.candles.length)))
    if (!followLive) setEndIndex(cur => clamp(cur, 0, chart.candles.length))
  }

  const pan = (direction: 'left' | 'right') => {
    setFollowLive(false)
    const step = Math.max(5, Math.round(visibleBars * 0.25))
    setEndIndex(cur => clamp(cur + (direction === 'left' ? -step : step), visibleBars, chart.candles.length))
  }

  const resetView = () => {
    setVisibleBars(defaultVisibleBars)
    setEndIndex(chart.candles.length)
    setFollowLive(chart.defaults.followLive)
    setVisibleOverlayIds(defaultOverlayIds)
  }

  const fitSession = () => {
    setVisibleBars(Math.max(10, chart.candles.length))
    setEndIndex(chart.candles.length)
    setFollowLive(false)
    setVisibleRange('session')
  }

  const returnToLive = () => {
    setEndIndex(chart.candles.length)
    setFollowLive(true)
  }

  const toggleOverlay = (id: string) => {
    setVisibleOverlayIds(cur => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const vwapVisible = Boolean(chart.vwapOverlay && visibleOverlayIds.has(chart.vwapOverlay.id))
  const latestVwap = chart.vwapOverlay && typeof chart.vwapOverlay.latestValue === 'number' && Number.isFinite(chart.vwapOverlay.latestValue)
    ? chart.vwapOverlay.latestValue
    : null
  const latestVwapY = latestVwap == null ? null : model.yForPrice(latestVwap)
  const clampedLatestVwapY = latestVwapY == null ? null : clamp(latestVwapY, PRICE_TOP + 12, PRICE_BOTTOM - 12)
  const latestVwapOffscreen = latestVwapY != null && (latestVwapY < PRICE_TOP || latestVwapY > PRICE_BOTTOM)

  const changeVisibleRange = (range: WorkspaceRange) => {
    setVisibleRange(range)
    const bars = range === '30m' ? 30 : range === '1h' ? 60 : range === '2h' ? 120 : chart.candles.length
    setVisibleBars(clamp(bars, 10, Math.max(10, chart.candles.length)))
    setEndIndex(chart.candles.length)
    setFollowLive(range !== 'session' ? chart.defaults.followLive : false)
  }

  const handleMouseMove = (event: MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    setCrosshair({
      x: clamp(((event.clientX - rect.left) / rect.width) * WIDTH, 0, WIDTH),
      y: clamp(((event.clientY - rect.top) / rect.height) * HEIGHT, 0, HEIGHT),
    })
  }

  if (!chart.candles.length) {
    const dataEvent = chart.events.find(event => event.eventType === 'data_error') || chart.events[0]
    return (
      <div className="flex h-[620px] items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white px-6 text-center text-sm text-tertiary dark:border-white/[0.10] dark:bg-slate-950/50">
        <div className="max-w-xl">
          <div className="text-xs font-black uppercase tracking-widest text-tertiary">Chart Data Unavailable</div>
          <div className="mt-2 text-base font-bold text-heading">{dataEvent?.title || 'No backend chart candles available'}</div>
          <div className="mt-2 leading-relaxed text-secondary">
            {dataEvent?.detail || 'The backend did not return intraday candles for this ticker/session. Try another ticker or retry after market-data recovers.'}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`${fullscreen ? 'fixed inset-3 z-50 overflow-auto bg-white p-3 dark:bg-slate-950' : ''}`}>
    <div className="rounded-lg border border-slate-200 bg-white dark:border-white/[0.08] dark:bg-slate-950/50">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2 text-xs dark:border-white/[0.08]">
        <div className="flex flex-wrap items-center gap-2 font-semibold text-secondary">
          <div className="flex overflow-hidden rounded-md border border-slate-200 dark:border-white/[0.08]" aria-label="Chart interval">
            {(['1m', '5m', '15m'] as WorkspaceInterval[]).map(interval => (
              <button
                key={interval}
                type="button"
                onClick={() => onIntervalChange?.(interval)}
                className={`px-2 py-1 text-[10px] font-black ${chart.defaults.interval === interval ? 'bg-violet-600 text-white' : 'text-secondary hover:bg-slate-50 dark:hover:bg-slate-800'}`}
              >
                {interval}
              </button>
            ))}
          </div>
          <select
            value={visibleRange}
            onChange={event => changeVisibleRange(event.target.value as WorkspaceRange)}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-secondary dark:border-white/[0.08] dark:bg-slate-900"
            aria-label="Visible range"
          >
            <option value="30m">30m</option>
            <option value="1h">1h</option>
            <option value="2h">2h</option>
            <option value="session">Session</option>
          </select>
          <span>{chart.defaults.scaleMode}</span>
          {!followLive && (
            <button type="button" onClick={returnToLive} className="rounded-full border border-violet-400 px-2 py-0.5 text-[10px] font-bold text-violet-700 dark:text-violet-200">
              Return to live
            </button>
          )}
        </div>
        <div className="relative flex flex-wrap gap-1">
          <button type="button" onClick={() => zoom('in')} className="rounded-md border border-slate-200 px-2 py-1 font-bold text-secondary hover:text-heading dark:border-white/[0.08]" aria-label="Zoom in">+</button>
          <button type="button" onClick={() => zoom('out')} className="rounded-md border border-slate-200 px-2 py-1 font-bold text-secondary hover:text-heading dark:border-white/[0.08]" aria-label="Zoom out">-</button>
          <button type="button" onClick={() => pan('left')} className="rounded-md border border-slate-200 px-2 py-1 font-bold text-secondary hover:text-heading dark:border-white/[0.08]" aria-label="Pan left">←</button>
          <button type="button" onClick={() => pan('right')} className="rounded-md border border-slate-200 px-2 py-1 font-bold text-secondary hover:text-heading dark:border-white/[0.08]" aria-label="Pan right">→</button>
          <button type="button" onClick={fitSession} className="rounded-md border border-slate-200 px-2 py-1 font-bold text-secondary hover:text-heading dark:border-white/[0.08]">Fit</button>
          <button type="button" onClick={resetView} className="rounded-md border border-slate-200 px-2 py-1 font-bold text-secondary hover:text-heading dark:border-white/[0.08]">Reset</button>
          <button type="button" onClick={() => setFullscreen(cur => !cur)} className="rounded-md border border-slate-200 px-2 py-1 font-bold text-secondary hover:text-heading dark:border-white/[0.08]">
            {fullscreen ? 'Exit' : 'Full'}
          </button>
          <button type="button" onClick={() => setOverlayMenuOpen(cur => !cur)} className="rounded-md border border-slate-200 px-2 py-1 font-bold text-secondary hover:text-heading dark:border-white/[0.08]">
            Indicators
          </button>
          <button type="button" onClick={() => setOverlayMenuOpen(cur => !cur)} className="rounded-md border border-slate-200 px-2 py-1 font-bold text-secondary hover:text-heading dark:border-white/[0.08]">
            Overlays
          </button>
          {overlayMenuOpen && (
            <div className="absolute right-0 top-8 z-20 w-56 rounded-lg border border-slate-200 bg-white p-2 shadow-lg dark:border-white/[0.08] dark:bg-slate-900">
              <div className="mb-1 text-[10px] font-black uppercase tracking-widest text-tertiary">Backend overlays</div>
              {overlayOptions.length ? overlayOptions.map(option => (
                <label key={option.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs text-secondary hover:bg-slate-50 dark:hover:bg-slate-800">
                  <input
                    type="checkbox"
                    checked={visibleOverlayIds.has(option.id)}
                    onChange={() => toggleOverlay(option.id)}
                    className="h-3 w-3"
                  />
                  <span className="truncate">{option.label}</span>
                </label>
              )) : (
                <div className="px-2 py-1 text-xs text-tertiary">No overlays provided.</div>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 px-3 py-2 text-xs dark:border-white/[0.08]">
        <span className="mr-1 text-[10px] font-black uppercase tracking-widest text-tertiary">Active</span>
        {activeChips.map(chip => {
          const active = chip.id === 'volume' || visibleOverlayIds.has(chip.id)
          return (
            <button
              key={chip.id}
              type="button"
              disabled={!chip.removable}
              onClick={() => chip.removable && toggleOverlay(chip.id)}
              className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                active
                  ? 'border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-200'
                  : 'border-slate-200 text-tertiary opacity-60 dark:border-white/[0.08]'
              }`}
            >
              {chip.label}
            </button>
          )
        })}
      </div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="Backend provided Day Trade workspace chart"
        className={`${fullscreen ? 'h-[calc(100vh-110px)]' : 'h-[620px]'} w-full`}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setCrosshair(null)}
      >
        <rect x="0" y="0" width={WIDTH} height={HEIGHT} className="fill-white dark:fill-slate-950" />
        {[0, 1, 2, 3].map(step => {
          const y = PRICE_TOP + step * ((PRICE_BOTTOM - PRICE_TOP) / 3)
          const price = model.maxPrice - step * ((model.maxPrice - model.minPrice) / 3)
          return (
            <g key={step}>
              <line x1="0" x2={WIDTH} y1={y} y2={y} className="stroke-slate-200 dark:stroke-white/10" strokeDasharray="3 5" />
              <text x={WIDTH - 8} y={y - 4} textAnchor="end" className="fill-slate-500 text-[11px] dark:fill-slate-400">
                ${price.toFixed(2)}
              </text>
            </g>
          )
        })}
        <line x1="0" x2={WIDTH} y1={VOLUME_TOP} y2={VOLUME_TOP} className="stroke-slate-200 dark:stroke-white/10" />
        {model.points.map((point, index) => {
          const candleWidth = Math.max(3, Math.min(model.barWidth * 0.58, 12))
          const bodyTop = Math.min(point.openY, point.closeY)
          const bodyHeight = Math.max(1, Math.abs(point.closeY - point.openY))
          const candleClass = point.up ? 'fill-emerald-500 stroke-emerald-500' : 'fill-rose-500 stroke-rose-500'
          return (
            <g key={`${model.visibleCandles[index].time}-${index}`}>
              <line x1={point.x} x2={point.x} y1={point.highY} y2={point.lowY} className={candleClass} strokeWidth="1.5" />
              <rect x={point.x - candleWidth / 2} y={bodyTop} width={candleWidth} height={bodyHeight} rx="1" className={candleClass} />
              <rect
                x={point.x - candleWidth / 2}
                y={point.volumeY}
                width={candleWidth}
                height={Math.max(1, point.volumeHeight)}
                className={point.up ? 'fill-emerald-500/30' : 'fill-rose-500/30'}
              />
            </g>
          )
        })}
        {vwapVisible && model.vwapSegments.map((segment, index) => {
          if (!segment.length) return null
          const path = segment.map((point, pointIndex) => `${pointIndex === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')
          return (
            <path
              key={`vwap-${index}`}
              d={path}
              fill="none"
              stroke={VWAP_STROKE}
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )
        })}
        {chart.marketStructure && visibleOverlayIds.has(chart.marketStructure.id) && model.structurePoints.length > 0 && (
          <g>
            {chart.marketStructure.showZigZagByDefault && model.structurePoints.length > 1 && (
              <polyline
                points={model.structurePoints.map(point => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ')}
                fill="none"
                stroke="rgba(139,92,246,0.72)"
                strokeWidth="1.8"
                strokeDasharray="5 5"
                strokeLinejoin="round"
              />
            )}
            {model.structurePoints.map(point => {
              const isHigh = point.pivotType === 'HIGH'
              const labelY = point.y + (isHigh ? -12 : 20)
              const fill = point.latest ? '#8b5cf6' : isHigh ? '#f59e0b' : '#22c55e'
              return (
                <g key={point.id}>
                  <circle cx={point.x} cy={point.y} r={point.latest ? 5.5 : 4} fill={fill} stroke="white" strokeWidth="1.5" />
                  <rect x={point.x - 14} y={labelY - 13} width="28" height="16" rx="5" className="fill-white/95 stroke-slate-200 dark:fill-slate-950/95 dark:stroke-white/10" />
                  <text x={point.x} y={labelY - 2} textAnchor="middle" className="fill-violet-700 text-[10px] font-black dark:fill-violet-200">
                    {point.label}
                  </text>
                </g>
              )
            })}
          </g>
        )}
        {chart.levels.filter(level => visibleOverlayIds.has(level.id)).sort((a, b) => a.priority - b.priority).map(level => {
          const y = model.yForPrice(level.price)
          const color = toneStroke(level.tone)
          return (
            <g key={level.id} opacity={level.active ? 1 : 0.46}>
              <line x1="0" x2={WIDTH} y1={y} y2={y} stroke={color} strokeWidth="1.7" strokeDasharray={level.lineStyleToken.includes('dash') ? '6 5' : undefined} />
              <rect x="8" y={y - 11} width="172" height="22" rx="6" className="fill-white/90 dark:fill-slate-950/90" />
              <text x="16" y={y + 4} className="fill-slate-700 text-[11px] font-bold dark:fill-slate-200">
                {level.label} ${level.price.toFixed(2)}
              </text>
            </g>
          )
        })}
        {chart.events.filter(event => visibleOverlayIds.has(event.id)).sort((a, b) => a.priority - b.priority).map(event => {
          const x = model.visibleTimes.get(event.timestamp)
          if (x == null) return null
          const y = event.price == null ? PRICE_TOP + 18 : model.yForPrice(event.price)
          return (
            <g key={event.id}>
              <circle cx={x} cy={y} r="5" fill={toneStroke(event.tone)} />
              <text x={x + 8} y={y - 8} className="fill-slate-700 text-[11px] font-bold dark:fill-slate-200">
                {event.title}
              </text>
            </g>
          )
        })}
        {vwapVisible && latestVwap != null && clampedLatestVwapY != null && (
          <g>
            <line x1={WIDTH - 120} x2={WIDTH} y1={clampedLatestVwapY} y2={clampedLatestVwapY} stroke={VWAP_STROKE} strokeWidth="2.4" />
            <rect x={WIDTH - 116} y={clampedLatestVwapY - 12} width="112" height="24" rx="6" className="fill-amber-50 stroke-amber-300 dark:fill-slate-950/95 dark:stroke-amber-300/80" />
            <text x={WIDTH - 60} y={clampedLatestVwapY + 4} textAnchor="middle" className="fill-amber-700 text-[11px] font-bold dark:fill-amber-200">
              VWAP {formatUsd(latestVwap)}{latestVwapOffscreen ? (latestVwapY! < PRICE_TOP ? ' ↑' : ' ↓') : ''}
            </text>
          </g>
        )}
        {model.visibleCandles.length > 0 && (
          <g>
            <text x="10" y={HEIGHT - 8} className="fill-slate-500 text-[11px] dark:fill-slate-400">
              {displayTime(model.visibleCandles[0].time, marketTimeZone)}
            </text>
            <text x={WIDTH - 10} y={HEIGHT - 8} textAnchor="end" className="fill-slate-500 text-[11px] dark:fill-slate-400">
              {displayTime(model.visibleCandles[model.visibleCandles.length - 1].time, marketTimeZone)}
            </text>
          </g>
        )}
        {crosshair && (
          <g pointerEvents="none">
            <line x1={crosshair.x} x2={crosshair.x} y1="0" y2={HEIGHT} className="stroke-slate-400 dark:stroke-slate-500" strokeDasharray="3 4" />
            <line x1="0" x2={WIDTH} y1={crosshair.y} y2={crosshair.y} className="stroke-slate-400 dark:stroke-slate-500" strokeDasharray="3 4" />
            {crosshairDetail && (
              <g transform={`translate(${clamp(crosshair.x + 14, 8, WIDTH - 178)}, ${clamp(crosshair.y + 14, 8, HEIGHT - 126)})`}>
                <rect width="170" height="118" rx="8" className="fill-white/95 stroke-slate-200 dark:fill-slate-950/95 dark:stroke-white/10" />
                <text x="10" y="18" className="fill-slate-700 text-[11px] font-bold dark:fill-slate-200">Time: {displayTime(crosshairDetail.candle.time, marketTimeZone)}</text>
                <text x="10" y="36" className="fill-slate-600 text-[11px] dark:fill-slate-300">Open: {formatUsd(crosshairDetail.candle.open)}</text>
                <text x="10" y="52" className="fill-slate-600 text-[11px] dark:fill-slate-300">High: {formatUsd(crosshairDetail.candle.high)}</text>
                <text x="10" y="68" className="fill-slate-600 text-[11px] dark:fill-slate-300">Low: {formatUsd(crosshairDetail.candle.low)}</text>
                <text x="10" y="84" className="fill-slate-600 text-[11px] dark:fill-slate-300">Close: {formatUsd(crosshairDetail.candle.close)}</text>
                <text x="10" y="100" className="fill-slate-600 text-[11px] dark:fill-slate-300">VWAP: {crosshairDetail.vwapValue == null ? 'unavailable' : formatUsd(crosshairDetail.vwapValue)}</text>
                <text x="10" y="114" className="fill-slate-500 text-[10px] dark:fill-slate-400">Vol: {formatVolume(crosshairDetail.candle.volume)}</text>
              </g>
            )}
          </g>
        )}
      </svg>
    </div>
    </div>
  )
}
