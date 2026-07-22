import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent, PointerEvent, ReactNode, WheelEvent } from 'react'
import { ArrowLeft, ArrowRight, Focus, Layers, Maximize2, Minimize2, RotateCcw, SlidersHorizontal, ZoomIn, ZoomOut } from 'lucide-react'
import type { DayTradeSemanticTone, DayTradeWorkspaceResponse } from '../api/client'

type WorkspaceChart = DayTradeWorkspaceResponse['chart']
type WorkspaceInterval = '1m' | '5m' | '15m' | '1h'
type WorkspaceRange = '30m' | '1h' | '2h' | 'session' | '7d'

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

type ChartIconButtonProps = {
  label: string
  onClick: () => void
  children: ReactNode
}

const WIDTH = 1000
const HEIGHT = 620
const PRICE_TOP = 20
const PRICE_BOTTOM = 468
const VOLUME_TOP = 500
const VOLUME_BOTTOM = 600
const VWAP_STROKE = '#facc15'
const BULLISH_CANDLE_COLOR = '#22c55e'
const BEARISH_CANDLE_COLOR = '#ef4444'
const MIN_VISIBLE_BARS = 10

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

function tradeTrackBadge(levelId: string): string | null {
  const id = levelId.toLowerCase()
  if (id === 'target1') return '+1'
  if (id === 'target2') return '+2'
  if (id === 'stop') return '-'
  if (id === 'entry') return 'E'
  return null
}

function ChartIconButton({ label, onClick, children }: ChartIconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-200 text-secondary transition hover:border-violet-400 hover:bg-slate-50 hover:text-heading dark:border-white/[0.08] dark:hover:bg-slate-900"
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  )
}

export default function DayTradeWorkspaceChart({
  chart,
  marketTimeZone,
  activeInterval,
  onIntervalChange,
  rangeOptions = ['30m', '1h', '2h', 'session'],
}: {
  chart: WorkspaceChart
  marketTimeZone?: string
  activeInterval?: WorkspaceInterval
  onIntervalChange?: (interval: WorkspaceInterval) => void
  rangeOptions?: WorkspaceRange[]
}) {
  const firstCandleTime = chart.candles[0]?.time || ''
  const baseVisibleBars = clamp(safeNumber(chart.defaults.initialVisibleBars, 100), MIN_VISIBLE_BARS, Math.max(MIN_VISIBLE_BARS, chart.candles.length || MIN_VISIBLE_BARS))
  const defaultOverlayIds = useMemo(() => new Set(chart.defaults.visibleOverlayIds), [chart.defaults.visibleOverlayIds])
  const [zoomLevel, setZoomLevel] = useState(1)
  const [panOffsetBars, setPanOffsetBars] = useState(0)
  const [followLive, setFollowLive] = useState(chart.defaults.followLive)
  const [overlayMenuOpen, setOverlayMenuOpen] = useState(false)
  const [visibleOverlayIds, setVisibleOverlayIds] = useState(defaultOverlayIds)
  const [fullscreen, setFullscreen] = useState(false)
  const [visibleRange, setVisibleRange] = useState<WorkspaceRange>(chart.defaults.visibleRange === '30m' || chart.defaults.visibleRange === '2h' || chart.defaults.visibleRange === 'session' || chart.defaults.visibleRange === '7d' ? chart.defaults.visibleRange : '1h')
  const [crosshair, setCrosshair] = useState<{ x: number; y: number } | null>(null)
  const dragRef = useRef<{ x: number; panOffsetBars: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const visibleBars = clamp(Math.round(baseVisibleBars / Math.max(0.1, zoomLevel)), MIN_VISIBLE_BARS, Math.max(MIN_VISIBLE_BARS, chart.candles.length || MIN_VISIBLE_BARS))
  const selectedInterval = activeInterval || chart.defaults.interval

  useEffect(() => {
    setZoomLevel(1)
    setPanOffsetBars(0)
    setFollowLive(chart.defaults.followLive)
    setVisibleOverlayIds(defaultOverlayIds)
    setVisibleRange(chart.defaults.visibleRange === '30m' || chart.defaults.visibleRange === '2h' || chart.defaults.visibleRange === 'session' || chart.defaults.visibleRange === '7d' ? chart.defaults.visibleRange : '1h')
  }, [chart.defaults.followLive, chart.defaults.interval, chart.defaults.visibleRange, defaultOverlayIds, firstCandleTime])

  const model = useMemo(() => {
    const candles = chart.candles || []
    const liveEndIndex = Math.max(0, candles.length - 1)
    const safePanOffsetBars = followLive ? 0 : clamp(panOffsetBars, 0, Math.max(0, candles.length - 1))
    const endIndex = clamp(liveEndIndex - safePanOffsetBars, 0, liveEndIndex)
    const visibleCount = clamp(visibleBars, 1, Math.max(1, candles.length))
    const startIndex = clamp(endIndex - visibleCount + 1, 0, candles.length)
    const visibleCandles = candles.slice(startIndex, endIndex + 1)
    const visibleTimeSet = new Set(visibleCandles.map(candle => candle.time))
    const barWidth = visibleCandles.length > 0 ? WIDTH / visibleCandles.length : WIDTH
    const visibleCandlePrices = visibleCandles.flatMap(candle => [candle.high, candle.low]).filter(isFiniteNumber)
    const candleMin = visibleCandlePrices.length ? Math.min(...visibleCandlePrices) : 0
    const candleMax = visibleCandlePrices.length ? Math.max(...visibleCandlePrices) : 1
    const latestClose = visibleCandles[visibleCandles.length - 1]?.close
    const candleRange = Math.max(candleMax - candleMin, 0.01)
    // Keep the price scale hugging the visible candles so distant trade levels
    // (T1/T2/Stop) can't stretch the axis and squash the candles into a thin band.
    const focusBand = Math.max(candleRange * 0.4, safeNumber(latestClose, candleMax) * 0.004, 0.15)
    const affectsTradeFocusScale = (price: number) => {
      if (chart.defaults.scaleMode === 'full_context') return true
      return price >= candleMin - focusBand && price <= candleMax + focusBand
    }
    const levelScaleIds = new Set(chart.tradeFocus?.levelIdsAllowedToAffectScale || [])
    const scaleLevels = chart.defaults.scaleMode === 'full_context'
      ? chart.levels
      : chart.levels.filter(level => levelScaleIds.has(level.id) && affectsTradeFocusScale(level.price))
    const scaleVwapValues = chart.vwapOverlay && (chart.defaults.scaleMode === 'full_context' || chart.vwapOverlay.affectsTradeFocusScale)
      ? chart.vwapOverlay.points
          .filter(point => chart.defaults.scaleMode === 'full_context' || visibleTimeSet.has(point.barStartUtc))
          .filter(point => typeof point.value === 'number' && affectsTradeFocusScale(point.value))
          .map(point => point.value)
      : []
    const confirmedStructurePivots = (chart.marketStructure?.pivots || [])
      .filter(pivot => Boolean(pivot.label) && (
        (pivot.confirmed && String(pivot.status || 'CONFIRMED').toUpperCase() === 'CONFIRMED') ||
        String(pivot.status || '').toUpperCase() === 'PROVISIONAL'
      ))
    const scaleStructureValues = chart.marketStructure && visibleOverlayIds.has(chart.marketStructure.id)
      ? confirmedStructurePivots
          .filter(pivot => visibleTimeSet.has(pivot.timestamp))
          .filter(pivot => affectsTradeFocusScale(pivot.price))
          .map(pivot => pivot.price)
      : []

    const prices = [
      ...visibleCandlePrices,
      ...scaleLevels.map(level => level.price),
      ...scaleVwapValues,
      ...scaleStructureValues,
    ].filter(isFiniteNumber)
    const rawMin = prices.length ? Math.min(...prices) : 0
    const rawMax = prices.length ? Math.max(...prices) : 1
    const rawRange = rawMax - rawMin || 1
    const basePadding = rawRange * safeNumber(chart.tradeFocus?.scalePaddingPercent ?? 8, 8) / 100
    const minPrice = rawMin - basePadding * 1.25
    const maxPrice = rawMax + basePadding * 0.55
    const priceRange = maxPrice - minPrice || 1
    const maxVolume = Math.max(1, ...visibleCandles.map(candle => safeNumber(candle.volume, 0)))

    const yForPrice = (price: number) => PRICE_BOTTOM - ((price - minPrice) / priceRange) * (PRICE_BOTTOM - PRICE_TOP)
    const xForIndex = (index: number) => index * barWidth + barWidth * 0.5
    const visibleTimes = new Map(visibleCandles.map((candle, index) => [candle.time, xForIndex(index)]))
    const xAxisTicks = (() => {
      if (!visibleCandles.length) return []
      const maxTicks = Math.min(8, visibleCandles.length)
      const tickStep = Math.max(1, Math.floor((visibleCandles.length - 1) / Math.max(1, maxTicks - 1)))
      const tickIndexes = new Set<number>()
      for (let index = 0; index < visibleCandles.length; index += tickStep) tickIndexes.add(index)
      tickIndexes.add(visibleCandles.length - 1)
      return [...tickIndexes].sort((a, b) => a - b).map(index => ({
        index,
        x: xForIndex(index),
        label: displayTime(visibleCandles[index]?.time || '', undefined),
      }))
    })()
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
        // Structure pivots are computed on 5m bars; on a 1m/other chart the pivot's
        // timestamp maps to the bar's first candle, not the candle that made the
        // extreme. Snap the marker onto the real candle wick within the pivot's 5m
        // window so it sits on the candle instead of floating.
        const pivotMs = Date.parse(pivot.timestamp)
        const isHigh = pivot.pivotType === 'HIGH'
        let anchorIndex: number | null = null
        let anchorExtreme = isHigh ? -Infinity : Infinity
        if (Number.isFinite(pivotMs)) {
          const windowMs = 5 * 60 * 1000
          visibleCandles.forEach((candle, index) => {
            const t = Date.parse(candle.time)
            if (!Number.isFinite(t) || t < pivotMs || t >= pivotMs + windowMs) return
            const extreme = isHigh ? candle.high : candle.low
            if (anchorIndex == null || (isHigh ? extreme > anchorExtreme : extreme < anchorExtreme)) {
              anchorIndex = index
              anchorExtreme = extreme
            }
          })
        }
        const anchorPrice = anchorIndex != null ? anchorExtreme : pivot.price
        const x = anchorIndex != null ? xForIndex(anchorIndex) : visibleTimes.get(pivot.timestamp)
        if (x == null || !Number.isFinite(anchorPrice)) return null
        const provisional = String(pivot.status || '').toUpperCase() === 'PROVISIONAL'
        return { ...pivot, x, y: yForPrice(anchorPrice), provisional }
      })
      .filter((point): point is NonNullable<typeof point> => point != null)

    return {
      visibleCandles,
      points,
      barWidth,
      yForPrice,
      visibleTimes,
      xAxisTicks,
      vwapSegments,
      structurePoints,
      minPrice,
      maxPrice,
      startIndex,
      endIndex,
    }
  }, [chart, followLive, panOffsetBars, visibleBars, visibleOverlayIds])

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
    zoomByVisibleFactor(direction === 'in' ? 0.72 : 1.32)
  }

  const zoomByVisibleFactor = (visibleFactor: number) => {
    const total = chart.candles.length
    if (total <= 1) return
    const minZoom = baseVisibleBars / Math.max(MIN_VISIBLE_BARS, total)
    const maxZoom = baseVisibleBars / MIN_VISIBLE_BARS
    setZoomLevel(cur => clamp(cur / visibleFactor, Math.max(0.1, minZoom), Math.max(1, maxZoom)))
  }

  const pan = (direction: 'left' | 'right') => {
    setFollowLive(false)
    const step = Math.max(5, Math.round(visibleBars * 0.25))
    setPanOffsetBars(cur => clamp(cur + (direction === 'left' ? step : -step), 0, Math.max(0, chart.candles.length - visibleBars)))
  }

  const panByBars = (deltaBars: number) => {
    if (!deltaBars || chart.candles.length <= visibleBars) return
    setFollowLive(false)
    setPanOffsetBars(cur => clamp(cur + deltaBars, 0, Math.max(0, chart.candles.length - visibleBars)))
  }

  const resetView = () => {
    setZoomLevel(1)
    setPanOffsetBars(0)
    setFollowLive(chart.defaults.followLive)
    setVisibleOverlayIds(defaultOverlayIds)
  }

  const fitSession = () => {
    setZoomLevel(baseVisibleBars / Math.max(MIN_VISIBLE_BARS, chart.candles.length))
    setPanOffsetBars(0)
    setFollowLive(true)
    setVisibleRange('session')
  }

  const returnToLive = () => {
    setPanOffsetBars(0)
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
  const visibleLevels = chart.levels
    .filter(level => visibleOverlayIds.has(level.id))
    .sort((a, b) => a.priority - b.priority)
  const levelLabelY = useMemo(() => {
    const minimumGap = 25
    const rows = visibleLevels
      .map(level => ({ id: level.id, y: clamp(model.yForPrice(level.price), PRICE_TOP + 11, PRICE_BOTTOM - 11) }))
      .sort((a, b) => a.y - b.y)
    let previousY = PRICE_TOP - minimumGap
    for (const row of rows) {
      row.y = Math.max(row.y, previousY + minimumGap)
      previousY = row.y
    }
    const overflow = Math.max(0, previousY - (PRICE_BOTTOM - 11))
    if (overflow) rows.forEach(row => { row.y -= overflow })
    return new Map(rows.map(row => [row.id, row.y]))
  }, [model, visibleLevels])

  const changeVisibleRange = (range: WorkspaceRange) => {
    setVisibleRange(range)
    const bars = range === '30m' ? 30 : range === '1h' ? 60 : range === '2h' ? 120 : chart.candles.length
    const nextVisibleBars = clamp(bars, MIN_VISIBLE_BARS, Math.max(MIN_VISIBLE_BARS, chart.candles.length))
    setZoomLevel(baseVisibleBars / nextVisibleBars)
    setPanOffsetBars(0)
    setFollowLive(true)
  }

  const handleMouseMove = (event: MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    setCrosshair({
      x: clamp(((event.clientX - rect.left) / rect.width) * WIDTH, 0, WIDTH),
      y: clamp(((event.clientY - rect.top) / rect.height) * HEIGHT, 0, HEIGHT),
    })
  }

  const handleWheel = (event: WheelEvent<SVGSVGElement>) => {
    if (chart.candles.length <= 1) return
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      const delta = event.deltaX || event.deltaY
      panByBars(Math.round((delta / Math.max(1, rect.width)) * visibleBars))
      return
    }
    zoomByVisibleFactor(event.deltaY < 0 ? 0.78 : 1.28)
  }

  const handlePointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (chart.candles.length <= visibleBars) return
    setFollowLive(false)
    dragRef.current = { x: event.clientX, panOffsetBars: followLive ? 0 : panOffsetBars }
    setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    handleMouseMove(event)
    const drag = dragRef.current
    if (!drag || chart.candles.length <= visibleBars) return
    const rect = event.currentTarget.getBoundingClientRect()
    const barsPerPx = visibleBars / Math.max(1, rect.width)
    const deltaBars = Math.round((event.clientX - drag.x) * barsPerPx)
    setPanOffsetBars(clamp(drag.panOffsetBars + deltaBars, 0, Math.max(0, chart.candles.length - visibleBars)))
  }

  const handlePointerEnd = (event: PointerEvent<SVGSVGElement>) => {
    dragRef.current = null
    setDragging(false)
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* pointer may already be released */ }
  }

  if (!chart.candles.length) {
    const dataEvent = chart.events.find(event => event.eventType === 'data_error') || chart.events[0]
    return (
      <div className="flex h-full min-h-[320px] items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white px-6 text-center text-sm text-tertiary dark:border-white/[0.10] dark:bg-slate-950/50">
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
    <div className={`${fullscreen ? 'fixed inset-3 z-50 overflow-auto bg-white/80 p-3 backdrop-blur-2xl dark:bg-slate-950/80' : 'h-full min-h-0'}`}>
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-white/70 bg-white/75 shadow-[0_18px_60px_rgba(15,23,42,0.14)] backdrop-blur-2xl dark:border-white/[0.10] dark:bg-slate-950/60 dark:shadow-[0_18px_70px_rgba(0,0,0,0.38)] md:rounded-none">
      <div className="flex flex-wrap items-center justify-between gap-1 border-b border-white/70 bg-white/50 px-2 py-1 text-[11px] backdrop-blur-xl dark:border-white/[0.08] dark:bg-slate-900/40">
        <div className="flex flex-wrap items-center gap-2 font-semibold text-secondary">
          <select
            value={visibleRange}
            onChange={event => changeVisibleRange(event.target.value as WorkspaceRange)}
            className="rounded-md border border-white/70 bg-white/70 px-2 py-0.5 text-[10px] font-bold text-secondary backdrop-blur dark:border-white/[0.08] dark:bg-slate-900/70 dark:[color-scheme:dark]"
            aria-label="Visible range"
          >
            {rangeOptions.map(option => (
              <option key={option} value={option} className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">{option === 'session' ? 'Session' : option}</option>
            ))}
          </select>
          <span className="hidden xl:inline">{chart.defaults.scaleMode}</span>
          <span className="font-mono text-[10px] text-tertiary">
            {chart.candles.length} candles
          </span>
          <span className="hidden font-mono text-[10px] text-tertiary xl:inline">
            {model.visibleCandles.length} visible
          </span>
          {!followLive && (
            <button type="button" onClick={returnToLive} className="rounded-full border border-violet-400 px-2 py-0.5 text-[10px] font-bold text-violet-700 dark:text-violet-200">
              Return to live
            </button>
          )}
        </div>
        <div className="relative flex flex-wrap justify-end gap-1">
          <ChartIconButton label="Zoom in" onClick={() => zoom('in')}>
            <ZoomIn size={15} />
          </ChartIconButton>
          <ChartIconButton label="Zoom out" onClick={() => zoom('out')}>
            <ZoomOut size={15} />
          </ChartIconButton>
          <ChartIconButton label="Pan left" onClick={() => pan('left')}>
            <ArrowLeft size={15} />
          </ChartIconButton>
          <ChartIconButton label="Pan right" onClick={() => pan('right')}>
            <ArrowRight size={15} />
          </ChartIconButton>
          <ChartIconButton label="Fit session" onClick={fitSession}>
            <Focus size={15} />
          </ChartIconButton>
          <ChartIconButton label="Reset chart view" onClick={resetView}>
            <RotateCcw size={15} />
          </ChartIconButton>
          <ChartIconButton label={fullscreen ? 'Exit fullscreen' : 'Expand chart'} onClick={() => setFullscreen(cur => !cur)}>
            {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </ChartIconButton>
          <ChartIconButton label="Indicators" onClick={() => setOverlayMenuOpen(cur => !cur)}>
            <SlidersHorizontal size={15} />
          </ChartIconButton>
          <ChartIconButton label="Overlays" onClick={() => setOverlayMenuOpen(cur => !cur)}>
            <Layers size={15} />
          </ChartIconButton>
          {overlayMenuOpen && (
            <div className="absolute right-0 top-8 z-20 w-56 rounded-lg border border-slate-200 bg-white p-2 shadow-2xl dark:border-slate-700 dark:bg-slate-950">
              <div className="mb-1 px-2 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Backend overlays</div>
              {overlayOptions.length ? overlayOptions.map(option => (
                <label
                  key={option.id}
                  className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs font-semibold transition ${visibleOverlayIds.has(option.id) ? 'bg-slate-100 text-slate-950 dark:bg-slate-800 dark:text-slate-100' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900'}`}
                >
                  <input
                    type="checkbox"
                    checked={visibleOverlayIds.has(option.id)}
                    onChange={() => toggleOverlay(option.id)}
                    className="h-3.5 w-3.5 rounded border-slate-400 accent-violet-500 dark:border-slate-600"
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
      <div className="flex flex-wrap items-center gap-1 border-b border-white/70 bg-white/40 px-2 py-1 text-[11px] backdrop-blur-xl dark:border-white/[0.08] dark:bg-slate-900/30">
        <span className="mr-1 text-[10px] font-black uppercase tracking-widest text-tertiary">Active</span>
        {activeChips.map(chip => {
          const active = chip.id === 'volume' || visibleOverlayIds.has(chip.id)
          return (
            <button
              key={chip.id}
              type="button"
              disabled={!chip.removable}
              onClick={() => chip.removable && toggleOverlay(chip.id)}
              className={`rounded-full border px-1.5 py-0.5 text-[10px] font-bold ${
                active
                  ? 'border-violet-500/35 bg-violet-500/10 text-violet-700 shadow-sm shadow-violet-500/10 dark:text-violet-200'
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
        className={`${fullscreen ? 'h-[calc(100vh-110px)]' : 'min-h-0 flex-1 w-full'} bg-transparent`}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onMouseLeave={() => setCrosshair(null)}
        style={{ cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none' }}
      >
        <defs>
          <linearGradient id="day-trade-chart-bg" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.94)" />
            <stop offset="46%" stopColor="rgba(241,245,249,0.66)" />
            <stop offset="100%" stopColor="rgba(226,232,240,0.42)" />
          </linearGradient>
          <linearGradient id="day-trade-chart-bg-dark" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(15,23,42,0.94)" />
            <stop offset="48%" stopColor="rgba(2,6,23,0.82)" />
            <stop offset="100%" stopColor="rgba(15,23,42,0.72)" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width={WIDTH} height={HEIGHT} rx="10" className="fill-[url(#day-trade-chart-bg)] dark:fill-[url(#day-trade-chart-bg-dark)]" />
        <rect x="10" y="10" width={WIDTH - 20} height={HEIGHT - 20} rx="16" fill="none" className="stroke-white/70 dark:stroke-white/[0.05]" />
        {[0, 1, 2, 3].map(step => {
          const y = PRICE_TOP + step * ((PRICE_BOTTOM - PRICE_TOP) / 3)
          const price = model.maxPrice - step * ((model.maxPrice - model.minPrice) / 3)
          return (
            <g key={step}>
              <line x1="0" x2={WIDTH} y1={y} y2={y} className="stroke-slate-300/70 dark:stroke-white/10" strokeDasharray="3 5" />
              <text x={WIDTH - 8} y={y - 4} textAnchor="end" className="fill-slate-500 text-[11px] dark:fill-slate-400">
                ${price.toFixed(2)}
              </text>
            </g>
          )
        })}
        <line x1="0" x2={WIDTH} y1={VOLUME_TOP} y2={VOLUME_TOP} className="stroke-slate-300/70 dark:stroke-white/10" />
        {model.points.map((point, index) => {
          const candleWidth = Math.max(3.5, Math.min(model.barWidth * 0.76, 20))
          const bodyTop = Math.min(point.openY, point.closeY)
          const bodyHeight = Math.max(1, Math.abs(point.closeY - point.openY))
          const candleColor = point.up ? BULLISH_CANDLE_COLOR : BEARISH_CANDLE_COLOR
          return (
            <g key={`${model.visibleCandles[index].time}-${index}`}>
              <line x1={point.x} x2={point.x} y1={point.highY} y2={point.lowY} stroke={candleColor} strokeWidth={Math.max(1.5, Math.min(candleWidth * 0.22, 3))} opacity="0.9" />
              <rect x={point.x - candleWidth / 2} y={bodyTop} width={candleWidth} height={bodyHeight} rx="1.5" fill={candleColor} opacity="0.9" />
              <rect
                x={point.x - candleWidth / 2}
                y={point.volumeY}
                width={candleWidth}
                height={Math.max(1, point.volumeHeight)}
                fill={candleColor}
                opacity="0.28"
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
              const typeColor = isHigh ? '#f59e0b' : '#22c55e'
              // Provisional (developing, unconfirmed) pivots render hollow + dashed and read "LH?"/"LL?".
              const fill = point.provisional ? 'white' : point.latest ? '#8b5cf6' : typeColor
              const stroke = point.provisional ? typeColor : 'white'
              return (
                <g key={point.id} opacity={point.provisional ? 0.85 : 1}>
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r={point.latest ? 5.5 : 4}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth="1.5"
                    strokeDasharray={point.provisional ? '2 2' : undefined}
                  />
                  <rect x={point.x - 15} y={labelY - 13} width={point.provisional ? 32 : 28} height="16" rx="5" className="fill-white stroke-slate-300 dark:fill-slate-950 dark:stroke-white/10" />
                  <text x={point.x} y={labelY - 2} textAnchor="middle" className={point.provisional ? 'fill-slate-600 text-[10px] font-black dark:fill-slate-400' : 'fill-violet-800 text-[10px] font-black dark:fill-violet-200'}>
                    {point.provisional ? `${point.label}?` : point.label}
                  </text>
                </g>
              )
            })}
          </g>
        )}
        {visibleLevels.map(level => {
          const rawY = model.yForPrice(level.price)
          // Off-scale levels (e.g. far T1/T2 when zoomed in) are pinned to the pane
          // edge with a ↑/↓ marker instead of drawing a misleading line off-chart.
          const offscreen = rawY < PRICE_TOP || rawY > PRICE_BOTTOM
          const y = clamp(rawY, PRICE_TOP + 11, PRICE_BOTTOM - 11)
          const labelY = levelLabelY.get(level.id) ?? y
          const color = toneStroke(level.tone)
          const arrow = offscreen ? (rawY < PRICE_TOP ? ' ↑' : ' ↓') : ''
          const badge = tradeTrackBadge(level.id)
          return (
            <g key={level.id} opacity={level.active ? (offscreen ? 0.6 : 1) : 0.46}>
              {!offscreen && <line x1="0" x2={WIDTH} y1={y} y2={y} stroke={color} strokeWidth="1.7" strokeDasharray={level.lineStyleToken.includes('dash') ? '6 5' : undefined} />}
              <rect x="8" y={labelY - 11} width="172" height="22" rx="6" className="fill-white stroke-slate-300 dark:fill-slate-950 dark:stroke-white/10" />
              <text x="16" y={labelY + 4} className="fill-slate-900 text-[11px] font-bold dark:fill-slate-100">
                {level.label} ${level.price.toFixed(2)}{arrow}
              </text>
              {badge && (
                <>
                  <rect x="184" y={labelY - 11} width="28" height="22" rx="6" fill={color} opacity="0.92" />
                  <text x="198" y={labelY + 4} textAnchor="middle" className="fill-white text-[11px] font-black">
                    {badge}
                  </text>
                </>
              )}
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
            <rect x={WIDTH - 116} y={clampedLatestVwapY - 12} width="112" height="24" rx="6" className="fill-amber-50 stroke-amber-400 dark:fill-slate-950 dark:stroke-amber-300/80" />
            <text x={WIDTH - 60} y={clampedLatestVwapY + 4} textAnchor="middle" className="fill-amber-900 text-[11px] font-bold dark:fill-amber-200">
              VWAP {formatUsd(latestVwap)}{latestVwapOffscreen ? (latestVwapY! < PRICE_TOP ? ' ↑' : ' ↓') : ''}
            </text>
          </g>
        )}
        {model.xAxisTicks.length > 0 && (
          <g>
            <line x1="0" x2={WIDTH} y1={VOLUME_BOTTOM + 4} y2={VOLUME_BOTTOM + 4} className="stroke-slate-300/70 dark:stroke-white/10" />
            {model.xAxisTicks.map(tick => (
              <g key={`${tick.index}-${tick.label}`}>
                <line x1={tick.x} x2={tick.x} y1={VOLUME_BOTTOM + 1} y2={VOLUME_BOTTOM + 8} className="stroke-slate-300 dark:stroke-slate-700" />
                <text x={tick.x} y={HEIGHT - 7} textAnchor="middle" className="fill-slate-500 text-[10px] font-mono dark:fill-slate-400">
                  {displayTime(model.visibleCandles[tick.index]?.time || tick.label, marketTimeZone)}
                </text>
              </g>
            ))}
          </g>
        )}
        {crosshair && (
          <g pointerEvents="none">
            <line x1={crosshair.x} x2={crosshair.x} y1="0" y2={HEIGHT} className="stroke-slate-500/80 dark:stroke-slate-400/70" strokeDasharray="3 4" />
            <line x1="0" x2={WIDTH} y1={crosshair.y} y2={crosshair.y} className="stroke-slate-500/70 dark:stroke-slate-400/50" strokeDasharray="3 4" />
            {crosshairDetail && (
              <g transform={`translate(${clamp(crosshair.x + 14, 8, WIDTH - 178)}, ${clamp(crosshair.y + 14, 8, HEIGHT - 126)})`}>
                <rect width="170" height="118" rx="8" fill="var(--chart-tooltip-bg)" stroke="var(--chart-tooltip-border)" strokeWidth="1" opacity="0.97" />
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
      <div className="flex shrink-0 justify-end border-t border-white/70 bg-white/50 px-2 py-1.5 backdrop-blur-xl dark:border-white/[0.08] dark:bg-slate-900/40">
        <div className="flex overflow-hidden rounded-md border border-slate-200 bg-white/70 dark:border-white/[0.08] dark:bg-slate-950/70" aria-label="Chart interval">
          {(['1m', '5m', '15m', '1h'] as WorkspaceInterval[]).map(interval => (
            <button
              key={interval}
              type="button"
              onClick={() => onIntervalChange?.(interval)}
              className={`px-2.5 py-1 text-[10px] font-black ${selectedInterval === interval ? 'bg-violet-600 text-white shadow-sm shadow-violet-500/30' : 'text-secondary hover:bg-white/70 dark:hover:bg-slate-800/80'}`}
            >
              {interval}
            </button>
          ))}
        </div>
      </div>
    </div>
    </div>
  )
}
