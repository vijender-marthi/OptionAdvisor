import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, MouseEvent, PointerEvent, ReactNode, WheelEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  BarChart2,
  Bell,
  BookOpen,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  FileText,
  GripVertical,
  Info,
  Layers,
  LayoutList,
  Loader2,
  Lock,
  Menu,
  Maximize2,
  Minimize2,
  Minus,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCw,
  RadioTower,
  RotateCcw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Target,
  TrendingUp,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { analyzeSwingTrade, analyzeV2, deskApi, saveToJournal } from '../api/client'
import type { DeskAlertCreate, ProfessionalDecisionPayload, SwingTradeScanResult, UnifiedAnalysis } from '../api/client'
import { fetchMyTickers, fetchStockTargets, type MyTickerEntry, type StockTargetData } from '../api/commandCenter'
import SetAlertDrawer from '../components/desk/SetAlertDrawer'
import MacdHistogramChart from '../components/MacdHistogramChart'
import { parseChartPayload } from '../components/SwingTradeMetricCharts'
import { useApp } from '../contexts/AppContext'
import { formatTickerTitle, useDocumentTitle } from '../hooks/useDocumentTitle'
import { ROUTES, getEngineRoute, getTradeWorksheetRoute } from '../routing/routes'
import type { OptionLeg } from '../types'

const OptionsEntryCheck = lazy(() => import('../components/OptionsEntryCheck'))
const BULLISH_CANDLE_COLOR = '#22c55e'
const BEARISH_CANDLE_COLOR = '#ef4444'
const ALPACA_TRADE_DRAFT_KEY = 'oa_alpaca_trade_draft'

type WorkstationTab = 'overview' | 'fibonacci' | 'options' | 'exit' | 'evidence' | 'journal' | 'alerts'
type Timeframe = 'Daily' | 'Weekly' | 'Monthly'
type IndicatorCategory = 'trend' | 'momentum' | 'volatility' | 'volume' | 'levels' | 'context'
type IndicatorPanel = 'price' | 'volume' | 'oscillator' | 'structure'
type IndicatorPresetId = 'clean' | 'swing_core' | 'trend' | 'momentum' | 'volatility' | 'engine_recommended'
type WidgetPlacement = 'right' | 'bottom'
type SwingSidebarFilterKey = 'all' | 'day' | 'regular' | 'swing'

const SWING_SIDEBAR_FILTERS: Array<{ key: SwingSidebarFilterKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'day', label: 'Day Trade' },
  { key: 'regular', label: 'Position' },
  { key: 'swing', label: 'Swing' },
]

function swingTickerGroups(item: MyTickerEntry): SwingSidebarFilterKey[] {
  const categories = (item as MyTickerEntry & { categories?: string[] }).categories
  const groups = [...item.trade_types, ...(Array.isArray(categories) ? categories : [])].map(value => {
    const normalized = value.trim().toUpperCase()
    if (normalized === 'DAY' || normalized === 'DAY_TRADE' || normalized === 'DAYTRADE') return 'day'
    if (normalized === 'REGULAR' || normalized === 'POSITION' || normalized === 'POSITION_TRADE' || normalized === 'POSITIONTRADING') return 'regular'
    if (normalized === 'SWING' || normalized === 'SWING_TRADE' || normalized === 'SWINGTRADE') return 'swing'
    return null
  })
  return Array.from(new Set(groups.filter((group): group is Exclude<SwingSidebarFilterKey, 'all'> => group != null)))
}

function widgetIdForTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

function handlePlainAnchorClick(event: MouseEvent<HTMLAnchorElement>, action: () => void) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  action()
}

function inferredSwingTextClass(label: string, value: string): string {
  const raw = `${label} ${value}`.toLowerCase()
  if (raw.includes('stop') || raw.includes('invalid') || raw.includes('bear') || raw.includes('short') || raw.includes('put') || raw.includes('avoid') || raw.includes('fail') || raw.includes('high risk')) {
    return 'text-rose-600 dark:text-rose-300'
  }
  if (raw.includes('target') || raw.includes('entry') || raw.includes('bull') || raw.includes('long') || raw.includes('call') || raw.includes('go') || raw.includes('low risk') || raw.includes('uptrend')) {
    return 'text-emerald-600 dark:text-emerald-300'
  }
  if (raw.includes('risk') || raw.includes('neutral') || raw.includes('wait') || raw.includes('watch') || raw.includes('medium') || raw.includes('pullback')) {
    return 'text-amber-600 dark:text-amber-300'
  }
  return 'text-heading'
}

function swingBiasBadgeClass(value?: string | null): string {
  const raw = String(value || '').toLowerCase()
  if (raw.includes('bear') || raw.includes('short')) return 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-200'
  if (raw.includes('bull') || raw.includes('long')) return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
  return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200'
}

type FibPriceLevel = NonNullable<StockTargetData['fib_retracement_levels']>[number]

function fibLevelPercent(level: FibPriceLevel): { primary: string; exact: string } {
  const ratio = num(level.ratio)
  const raw = ratio == null ? Number.parseFloat(String(level.level).replace('%', '')) : ratio > 1 ? ratio : ratio * 100
  if (!Number.isFinite(raw)) return { primary: String(level.level || '—'), exact: String(level.level || '—') }
  return {
    primary: `${Math.round(raw)}%`,
    exact: `${raw.toFixed(raw % 1 === 0 ? 0 : 1)}%`,
  }
}

function fibLevelDecision(level: FibPriceLevel): { title: string; detail: string; classes: string; dot: string } {
  const ratio = num(level.ratio)
  const pctValue = ratio == null ? Number.parseFloat(String(level.level).replace('%', '')) : ratio > 1 ? ratio : ratio * 100
  if (pctValue <= 24) {
    return {
      title: 'Shallow pullback',
      detail: 'Trend is still stretched; avoid chasing until price confirms.',
      classes: 'border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-200',
      dot: 'bg-sky-500',
    }
  }
  if (pctValue <= 39) {
    return {
      title: 'Healthy retreat',
      detail: 'First quality pullback area if momentum and structure stay intact.',
      classes: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200',
      dot: 'bg-emerald-500',
    }
  }
  if (pctValue <= 51) {
    return {
      title: 'Decision zone',
      detail: 'Needs confirmation candle; good place to wait instead of guessing.',
      classes: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200',
      dot: 'bg-amber-500',
    }
  }
  if (pctValue <= 64) {
    return {
      title: 'Golden retrace',
      detail: 'Strong pullback zone; bullish only if buyers defend this area.',
      classes: 'border-lime-500/30 bg-lime-500/10 text-lime-700 dark:text-lime-200',
      dot: 'bg-lime-500',
    }
  }
  if (pctValue <= 79) {
    return {
      title: 'Danger zone',
      detail: 'Deep retracement; trend quality is fading unless price reclaims fast.',
      classes: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-200',
      dot: 'bg-rose-500',
    }
  }
  return {
    title: 'Invalidation risk',
    detail: 'Beyond normal pullback depth; treat as breakdown risk first.',
    classes: 'border-red-500/35 bg-red-500/10 text-red-700 dark:text-red-200',
    dot: 'bg-red-500',
  }
}

type ChartIndicator = {
  id: string
  name: string
  category: IndicatorCategory
  panel: IndicatorPanel
  parameters?: Record<string, string | number>
  available: boolean
  recommended?: boolean
  mandatory?: boolean
  reason?: string
  unavailableReason?: string
  currentValue?: string
  formula?: string
  inputs?: string
  interpretation?: string
  source?: string
  timestamp?: string
}

type IndicatorFramework = {
  catalog: ChartIndicator[]
  recommendedIds: string[]
  mandatoryIds: string[]
  recommendedReason: string | null
  fibonacci: {
    enabled: boolean
    direction: 'LOW_TO_HIGH' | 'HIGH_TO_LOW' | null
    anchorLabel: string
    currentZone: string
    classification: string
    nearestConfluence: string
    invalidation: string
  }
}

type SwingChartPoint = NonNullable<ReturnType<typeof parseChartPayload>>[number]
type SwingStructurePivot = {
  label?: string | null
  price?: number | null
  date?: string | null
  confirmed?: boolean
  status?: string | null
}

const TABS: Array<{ id: WorkstationTab; label: string; icon: ReactNode }> = [
  { id: 'overview', label: 'Overview', icon: <Activity size={14} /> },
  { id: 'fibonacci', label: 'Fibonacci', icon: <Crosshair size={14} /> },
  { id: 'options', label: 'Options', icon: <BarChart2 size={14} /> },
  { id: 'exit', label: 'Exit Plan', icon: <Target size={14} /> },
  { id: 'evidence', label: 'Evidence', icon: <Layers size={14} /> },
  { id: 'journal', label: 'Journal', icon: <FileText size={14} /> },
  { id: 'alerts', label: 'Alerts', icon: <Bell size={14} /> },
]

const INDICATOR_STORAGE_KEY = 'oa_chart_indicators_swing_v1'

const INDICATOR_GROUP_LABELS: Record<IndicatorCategory, string> = {
  trend: 'Trend',
  momentum: 'Momentum',
  volatility: 'Volatility',
  volume: 'Volume',
  levels: 'Price Levels & Structure',
  context: 'Optional Context',
}

const PRESET_DEFINITIONS: Array<{ id: IndicatorPresetId; label: string; ids: string[] }> = [
  { id: 'clean', label: 'Clean', ids: ['candles', 'volume', 'structure'] },
  { id: 'swing_core', label: 'Swing Core', ids: ['candles', 'ema9', 'sma20', 'sma50', 'volume', 'structure', 'fibonacci_retracement', 'entry', 'stop', 'target1', 'target2'] },
  { id: 'trend', label: 'Trend', ids: ['candles', 'ema9', 'sma20', 'sma50', 'sma200', 'volume', 'structure'] },
  { id: 'momentum', label: 'Momentum', ids: ['candles', 'ema9', 'sma20', 'volume', 'rsi14', 'macd'] },
  { id: 'volatility', label: 'Volatility', ids: ['candles', 'sma20', 'bollinger20', 'atr14', 'volume'] },
  { id: 'engine_recommended', label: 'Engine Recommended', ids: [] },
]

function axiosDetail(e: unknown): string {
  const d = (e as { response?: { data?: { detail?: string } }; message?: string })?.response?.data?.detail
  if (typeof d === 'string') return d
  return (e as Error)?.message ?? 'Request failed'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

function text(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value : ''
}

function money(value: unknown): string {
  const n = num(value)
  return n == null ? '—' : `$${n.toFixed(2)}`
}

function signedMoney(value: unknown): string {
  const n = num(value)
  if (n == null) return '—'
  return `${n >= 0 ? '+' : '-'}$${Math.abs(n).toFixed(2)}`
}

function formatSwingVolume(value: unknown): string {
  const n = num(value)
  if (n == null) return '—'
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function pct(value: unknown): string {
  const n = num(value)
  if (n == null) return '—'
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

function indicatorValue(value: unknown, decimals = 2): string | undefined {
  const n = num(value)
  return n == null ? undefined : n.toFixed(decimals)
}

function compactLabel(value: string | null | undefined): string {
  return String(value || '—').replace(/_/g, ' ')
}

function formatSwingAxisTime(value: string | null | undefined): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const parsed = new Date(raw)
  if (!Number.isNaN(parsed.getTime())) {
    const hasExplicitTime = /T\d{2}:\d{2}/.test(raw)
    return parsed.toLocaleString([], hasExplicitTime
      ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
      : { month: 'short', day: 'numeric' })
  }
  const parts = raw.split('-')
  if (parts.length >= 3) return `${parts[1]}/${parts[2].slice(0, 2)}`
  return raw
}

function swingDateKey(value: string | null | undefined): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const parsed = new Date(raw)
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10)
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/)
  return match?.[1] || raw
}

function levelFromUnified(unified: UnifiedAnalysis | null, type: 't1' | 't2'): string {
  const row = unified?.exit_rows.find(item => item.type === type)
  return row?.price || '—'
}

function latestPrice(result: SwingTradeScanResult | null, unified: UnifiedAnalysis | null): number | null {
  const m = result?.metrics as Record<string, unknown> | undefined
  return unified?.price ?? num(m?.last_price)
}

function latestDailyChange(result: SwingTradeScanResult | null, unified: UnifiedAnalysis | null): number | null {
  const m = result?.metrics as Record<string, unknown> | undefined
  return num(unified?.change_amount) ?? num(m?.daily_change)
}

function latestDailyChangePct(result: SwingTradeScanResult | null, unified: UnifiedAnalysis | null): number | null {
  const m = result?.metrics as Record<string, unknown> | undefined
  return num(unified?.change_pct) ?? num(m?.daily_change_pct)
}

function getExec(result: SwingTradeScanResult | null): Record<string, unknown> {
  const m = result?.metrics as Record<string, unknown> | undefined
  return isRecord(m?.exec_levels) ? m.exec_levels : {}
}

function getSpread(result: SwingTradeScanResult | null, unified: UnifiedAnalysis | null): Record<string, unknown> {
  if (unified?.spread_entry && isRecord(unified.spread_entry)) return unified.spread_entry
  const m = result?.metrics as Record<string, unknown> | undefined
  return isRecord(m?.spread_entry) ? m.spread_entry : {}
}

function swingExpiryDate(result: SwingTradeScanResult, spread: Record<string, unknown>): string {
  const raw = text(spread.expiry)
  const match = raw.match(/\d{4}-\d{2}-\d{2}/)
  if (match) return match[0]
  const dte = parseInt(result.recommended_contract_duration || '', 10) || 45
  const date = new Date()
  date.setDate(date.getDate() + dte)
  return date.toISOString().slice(0, 10)
}

function hasBackendValue(...values: unknown[]): boolean {
  return values.some(value => num(value) != null || text(value) !== '')
}

// Local swing pivots and regular RSI divergence (price vs RSI), computed over the
// visible window from the backend close + rsi series.
function swingPivotIndices(values: number[], w = 2): { highs: number[]; lows: number[] } {
  const highs: number[] = [], lows: number[] = []
  for (let i = w; i < values.length - w; i++) {
    if (!Number.isFinite(values[i])) continue
    let isH = true, isL = true
    for (let j = 1; j <= w; j++) {
      if (values[i] < values[i - j] || values[i] < values[i + j]) isH = false
      if (values[i] > values[i - j] || values[i] > values[i + j]) isL = false
    }
    if (isH) highs.push(i)
    if (isL) lows.push(i)
  }
  return { highs, lows }
}

function swingRsiDivergences(prices: number[], rsi: number[]): { kind: 'bear' | 'bull'; i1: number; i2: number }[] {
  const out: { kind: 'bear' | 'bull'; i1: number; i2: number }[] = []
  const piv = swingPivotIndices(prices, 1)
  const scan = (idxs: number[], kind: 'bear' | 'bull') => {
    if (idxs.length < 2) return
    const last = idxs[idxs.length - 1]
    if (!Number.isFinite(rsi[last])) return
    for (let k = idxs.length - 2; k >= Math.max(0, idxs.length - 4); k--) {
      const prev = idxs[k]
      if (!Number.isFinite(rsi[prev])) continue
      if (kind === 'bear' && prices[last] > prices[prev] && rsi[last] < rsi[prev]) { out.push({ kind, i1: prev, i2: last }); break }
      if (kind === 'bull' && prices[last] < prices[prev] && rsi[last] > rsi[prev]) { out.push({ kind, i1: prev, i2: last }); break }
    }
  }
  scan(piv.highs, 'bear')
  scan(piv.lows, 'bull')
  return out
}

function backendStructurePivots(metrics: Record<string, unknown> | undefined): SwingStructurePivot[] {
  const structure = isRecord(metrics?.market_structure) ? metrics.market_structure : null
  const raw = Array.isArray(structure?.chart_pivots)
    ? structure.chart_pivots
    : Array.isArray(structure?.all_pivots)
      ? structure.all_pivots
      : Array.isArray(structure?.pivots)
        ? structure.pivots
        : []
  return raw
    .filter(isRecord)
    .map(pivot => ({
      label: text(pivot.label),
      price: num(pivot.price),
      date: text(pivot.date),
      confirmed: pivot.confirmed !== false,
      status: text(pivot.status),
    }))
    .filter(pivot => pivot.price != null && pivot.date && (pivot.confirmed || pivot.status === 'PROVISIONAL'))
}

function loadIndicatorSelection(defaultIds: string[]): { preset: IndicatorPresetId; ids: string[] } {
  if (typeof window === 'undefined') return { preset: 'swing_core', ids: defaultIds }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(INDICATOR_STORAGE_KEY) || '{}') as { preset?: IndicatorPresetId; ids?: unknown }
    const ids = Array.isArray(parsed.ids) ? parsed.ids.filter((id): id is string => typeof id === 'string') : defaultIds
    return { preset: parsed.preset || 'swing_core', ids: ids.length ? ids : defaultIds }
  } catch {
    return { preset: 'swing_core', ids: defaultIds }
  }
}

function buildIndicatorFramework(
  result: SwingTradeScanResult | null,
  unified: UnifiedAnalysis | null,
  fibTargets: StockTargetData | null,
): IndicatorFramework {
  const metrics = result?.metrics as Record<string, unknown> | undefined
  const exec = getExec(result)
  const points = parseChartPayload(metrics?.chart_series)
  const hasSeries = Boolean(points?.length)
  const hasRsiSeries = Boolean(points?.some(point => num(point.rsi) != null))
  const hasMa20Series = Boolean(points?.some(point => num(point.ma20) != null))
  const hasMa50Series = Boolean(points?.some(point => num(point.ma50) != null))
  const hasVolumeSeries = Boolean(points?.some(point => num(point.v) != null))
  const chartSeriesByTimeframe = isRecord(metrics?.chart_series_by_timeframe) ? metrics.chart_series_by_timeframe : null
  const hasContinuationPattern = ['Daily', 'Weekly'].some(timeframe => isRecord(chartSeriesByTimeframe?.[timeframe]) && isRecord(chartSeriesByTimeframe?.[timeframe]?.pattern_overlay))
  const hasFibAnchors = hasBackendValue(fibTargets?.fib_swing_high, fibTargets?.fib_swing_low, fibTargets?.fib_direction)
  const hasFibLevels = Boolean(fibTargets?.fib_retracement_levels?.length)
  const marketStructure = isRecord(metrics?.market_structure) ? metrics.market_structure : null
  const hasEntry = hasBackendValue(exec.breakout, unified?.entry_price)
  const hasStop = hasBackendValue(exec.stop, unified?.stop_price)
  const hasTargets = hasBackendValue(exec.target1, exec.target2)
  const decisionRelevantMomentum = hasBackendValue(metrics?.macd, metrics?.macd_signal, metrics?.macd_histogram, metrics?.rsi)
    && (String(result?.final_action || '').toUpperCase().includes('WAIT') || result?.missing_confirmations?.some(item => /rsi|macd/i.test(item)))
  const fibDirection = fibTargets?.fib_direction === 'down' ? 'HIGH_TO_LOW' : fibTargets?.fib_direction === 'up' ? 'LOW_TO_HIGH' : null
  const fibAnchorLabel = hasFibAnchors
    ? `${fibDirection === 'HIGH_TO_LOW' ? 'Swing High' : 'Swing Low'} ${money(fibDirection === 'HIGH_TO_LOW' ? fibTargets?.fib_swing_high : fibTargets?.fib_swing_low)} → ${fibDirection === 'HIGH_TO_LOW' ? 'Swing Low' : 'Swing High'} ${money(fibDirection === 'HIGH_TO_LOW' ? fibTargets?.fib_swing_low : fibTargets?.fib_swing_high)}`
    : 'No backend-confirmed anchors'
  const recommendedIds = [
    'candles',
    hasBackendValue(fibTargets?.ema9) ? 'ema9' : null,
    hasMa20Series ? 'sma20' : null,
    hasMa50Series ? 'sma50' : null,
    hasVolumeSeries ? 'volume' : null,
    hasContinuationPattern ? 'continuation_pattern' : null,
    hasBackendValue(marketStructure?.display, result?.metrics && text((result.metrics as Record<string, unknown>).trend_direction), unified?.structure) ? 'structure' : null,
    hasFibAnchors ? 'fibonacci_retracement' : null,
    hasEntry ? 'entry' : null,
    hasStop ? 'stop' : null,
    hasTargets ? 'target1' : null,
    hasTargets ? 'target2' : null,
    decisionRelevantMomentum && hasRsiSeries ? 'rsi14' : null,
    decisionRelevantMomentum ? 'macd' : null,
  ].filter((id): id is string => Boolean(id))
  const mandatoryIds = ['candles', ...recommendedIds.filter(id => ['entry', 'stop', 'target1', 'target2', 'structure', 'fibonacci_retracement'].includes(id))]
  const available = (ok: boolean, reason = 'Backend has not returned this indicator for the current swing snapshot.') => ({ available: ok, unavailableReason: ok ? undefined : reason })
  const base: ChartIndicator[] = [
    { id: 'candles', name: 'Candlesticks', category: 'levels', panel: 'price', ...available(hasSeries), currentValue: money(metrics?.last_price), formula: 'Backend daily price series', inputs: 'Backend chart_series close values', interpretation: 'Primary daily price action used for the snapshot.', source: 'Swing Trade API' },
    { id: 'ema9', name: 'EMA 9', category: 'trend', panel: 'price', parameters: { period: 9 }, ...available(hasBackendValue(fibTargets?.ema9)), currentValue: money(fibTargets?.ema9), formula: 'Backend EMA(9)', inputs: 'Backend stock-targets daily close series', interpretation: compactLabel(fibTargets?.price_vs_ema9 || 'Daily 9 EMA context'), source: 'Stock Targets API' },
    { id: 'ema20', name: 'EMA 20', category: 'trend', panel: 'price', parameters: { period: 20 }, ...available(false) },
    { id: 'sma20', name: 'SMA 20', category: 'trend', panel: 'price', parameters: { period: 20 }, ...available(hasMa20Series || hasBackendValue(metrics?.ma20, fibTargets?.ma20)), currentValue: money(fibTargets?.ma20 ?? metrics?.ma20), formula: 'Backend SMA(20)', inputs: 'Backend swing chart_series ma20', interpretation: compactLabel(text(metrics?.ma20_signal) || 'Intermediate swing trend reference'), source: 'Swing Trade API' },
    { id: 'sma50', name: 'SMA 50', category: 'trend', panel: 'price', parameters: { period: 50 }, ...available(hasMa50Series || hasBackendValue(metrics?.ma50, fibTargets?.ma50)), currentValue: money(fibTargets?.ma50 ?? metrics?.ma50), formula: 'Backend SMA(50)', inputs: 'Backend swing chart_series ma50', interpretation: 'Primary swing trend reference from backend.', source: 'Swing Trade API' },
    { id: 'sma100', name: 'SMA 100', category: 'trend', panel: 'price', parameters: { period: 100 }, ...available(false) },
    { id: 'sma200', name: 'SMA 200', category: 'trend', panel: 'price', parameters: { period: 200 }, ...available(false) },
    { id: 'rsi14', name: 'RSI 14', category: 'momentum', panel: 'oscillator', parameters: { period: 14 }, ...available(hasRsiSeries || hasBackendValue(metrics?.rsi, fibTargets?.rsi)), currentValue: indicatorValue(fibTargets?.rsi ?? metrics?.rsi), formula: 'Backend RSI(14)', inputs: 'Backend swing chart_series rsi', interpretation: compactLabel(text(metrics?.rsi_label) || 'Momentum context returned by backend'), source: 'Swing Trade API' },
    { id: 'macd', name: 'MACD 12/26/9', category: 'momentum', panel: 'oscillator', parameters: { fast: 12, slow: 26, signal: 9 }, ...available(hasBackendValue(metrics?.macd, metrics?.macd_signal, metrics?.macd_histogram)), currentValue: `MACD ${moneyless(metrics?.macd)} / Signal ${moneyless(metrics?.macd_signal)}`, formula: 'Backend MACD(12,26,9)', inputs: 'Backend swing metrics macd, macd_signal, macd_histogram', interpretation: compactLabel(text(metrics?.macd_label) || 'Momentum alignment from backend'), source: 'Swing Trade API' },
    { id: 'rsi_divergence', name: 'RSI Divergence', category: 'momentum', panel: 'price', ...available(hasRsiSeries), currentValue: hasRsiSeries ? 'Price vs RSI pivots' : undefined, formula: 'Regular bullish/bearish divergence between price and RSI swing pivots', inputs: 'Backend swing chart_series close + rsi', interpretation: 'Higher price high with lower RSI high is bearish; lower price low with higher RSI low is bullish.', source: 'Swing Trade API' },
    { id: 'stoch_rsi', name: 'Stochastic RSI', category: 'momentum', panel: 'oscillator', ...available(false) },
    { id: 'roc', name: 'Rate of Change', category: 'momentum', panel: 'oscillator', ...available(hasBackendValue(metrics?.mom_5d_pct, fibTargets?.mom_5d)), currentValue: pct(metrics?.mom_5d_pct ?? fibTargets?.mom_5d), formula: 'Backend momentum percentage', inputs: 'Backend mom_5d_pct / stock-targets mom_5d', interpretation: 'Recent swing momentum returned by backend.', source: 'Swing Trade API' },
    { id: 'atr14', name: 'ATR 14', category: 'volatility', panel: 'oscillator', parameters: { period: 14 }, ...available(false) },
    { id: 'bollinger20', name: 'Bollinger Bands 20/2', category: 'volatility', panel: 'price', parameters: { period: 20, stdev: 2 }, ...available(false) },
    { id: 'keltner', name: 'Keltner Channels', category: 'volatility', panel: 'price', ...available(false) },
    { id: 'volume', name: 'Volume', category: 'volume', panel: 'volume', ...available(hasVolumeSeries), currentValue: indicatorValue(metrics?.volume_ratio, 2), formula: 'Backend volume series', inputs: 'Backend chart_series volume', interpretation: compactLabel(text(metrics?.volume_label) || 'Volume context returned by backend'), source: 'Swing Trade API' },
    { id: 'avg_volume20', name: 'Average Volume 20', category: 'volume', panel: 'volume', parameters: { period: 20 }, ...available(false) },
    { id: 'relative_volume', name: 'Relative Volume', category: 'volume', panel: 'volume', ...available(hasBackendValue(metrics?.volume_ratio)), currentValue: indicatorValue(metrics?.volume_ratio, 2), formula: 'Backend relative volume ratio', inputs: 'Backend volume_ratio', interpretation: compactLabel(text(metrics?.volume_label) || 'Relative volume returned by backend'), source: 'Swing Trade API' },
    { id: 'obv', name: 'OBV', category: 'volume', panel: 'oscillator', ...available(false) },
    { id: 'volume_profile', name: 'Volume Profile', category: 'volume', panel: 'price', ...available(hasVolumeSeries), currentValue: hasVolumeSeries ? 'Volume-by-price histogram' : undefined, formula: 'Volume-by-price buckets over the visible window', inputs: 'Backend chart_series close + volume', interpretation: 'Horizontal histogram showing where volume concentrated by price.', source: 'Swing Trade API' },
    { id: 'fibonacci_retracement', name: 'Fibonacci Retracement', category: 'levels', panel: 'price', ...available(hasFibAnchors && hasFibLevels), currentValue: fibAnchorLabel, formula: 'Backend-confirmed swing anchors and retracement prices', inputs: 'Stock-targets fib_retracement_levels', interpretation: fibTargets?.fib_classification || 'Retracement overlay uses only backend-selected anchors.', source: 'Stock Targets API' },
    { id: 'fibonacci_extension', name: 'Fibonacci Extension', category: 'levels', panel: 'price', ...available(Boolean(fibTargets?.fib_extension_levels?.length) || hasTargets), currentValue: hasTargets ? `${money(exec.target1)} / ${money(exec.target2)}` : undefined, formula: 'Backend extension prices when supplied', inputs: 'Stock-targets fib_extension_levels and execution targets', interpretation: 'Disabled by default unless selected or target evidence is returned.', source: 'Stock Targets API' },
    { id: 'support_resistance', name: 'Support and Resistance', category: 'levels', panel: 'price', ...available(hasBackendValue(fibTargets?.suggested_stop_loss, fibTargets?.suggested_target1, exec.stop, exec.target1)), currentValue: `${money(fibTargets?.suggested_stop_loss ?? exec.stop)} / ${money(fibTargets?.suggested_target1 ?? exec.target1)}`, formula: 'Backend support/resistance levels', inputs: 'Stock-targets and execution levels', interpretation: 'Nearby levels returned by backend APIs.', source: 'Stock Targets API' },
    { id: 'swing_pivots', name: 'Swing High / Swing Low', category: 'levels', panel: 'structure', ...available(hasFibAnchors), currentValue: fibAnchorLabel, formula: 'Backend-confirmed swing pivots', inputs: 'Stock-targets fib anchors', interpretation: 'Labels are limited to backend-selected anchors.', source: 'Stock Targets API' },
    { id: 'structure', name: 'HH / HL / LH / LL Structure', category: 'levels', panel: 'structure', ...available(hasBackendValue(marketStructure?.display, result?.metrics && text((result.metrics as Record<string, unknown>).trend_direction), unified?.structure)), currentValue: compactLabel(text(marketStructure?.display) || text(metrics?.trend_direction) || unified?.structure), formula: 'Backend confirmed daily pivot structure', inputs: 'Swing metrics market_structure.pivots', interpretation: compactLabel(text(marketStructure?.story) || result?.playbook_hint || result?.decision_message || 'Structure context returned by backend'), source: 'Swing Trade API' },
    { id: 'continuation_pattern', name: 'Bull / Bear Flag', category: 'levels', panel: 'price', ...available(hasContinuationPattern), currentValue: hasContinuationPattern ? 'Backend pattern present' : undefined, formula: 'Backend pole and contained counter-trend flag detection', inputs: 'Backend OHLC + volume series', interpretation: 'Shown only when the backend finds a conservative daily or weekly continuation pattern.', source: 'Swing Trade API' },
    { id: 'bos', name: 'BOS', category: 'levels', panel: 'structure', ...available(hasBackendValue(marketStructure?.bos)), currentValue: compactLabel(text(marketStructure?.bos)), formula: 'Break of structure from confirmed pivots', inputs: 'Swing metrics market_structure.bos', interpretation: 'Most recent trend-continuation break in the HH/HL/LH/LL sequence.', source: 'Swing Trade API' },
    { id: 'choch', name: 'CHoCH', category: 'levels', panel: 'structure', ...available(hasBackendValue(marketStructure?.choch)), currentValue: compactLabel(text(marketStructure?.choch)), formula: 'Change of character from confirmed pivots', inputs: 'Swing metrics market_structure.choch', interpretation: 'Most recent character flip (potential reversal) in the pivot sequence.', source: 'Swing Trade API' },
    { id: 'entry', name: 'Entry', category: 'levels', panel: 'price', ...available(hasEntry), currentValue: money(exec.breakout ?? unified?.entry_price), formula: 'Backend execution entry', inputs: 'exec_levels.breakout / unified entry_price', interpretation: 'Entry level supplied by the backend decision snapshot.', source: 'Swing Trade API' },
    { id: 'stop', name: 'Stop', category: 'levels', panel: 'price', ...available(hasStop), currentValue: money(exec.stop ?? unified?.stop_price), formula: 'Backend execution stop', inputs: 'exec_levels.stop / unified stop_price', interpretation: 'Invalidation or risk-control level supplied by backend.', source: 'Swing Trade API' },
    { id: 'target1', name: 'Target 1', category: 'levels', panel: 'price', ...available(hasBackendValue(exec.target1)), currentValue: money(exec.target1), formula: 'Backend target 1', inputs: 'exec_levels.target1', interpretation: 'First profit objective returned by backend.', source: 'Swing Trade API' },
    { id: 'target2', name: 'Target 2', category: 'levels', panel: 'price', ...available(hasBackendValue(exec.target2)), currentValue: money(exec.target2), formula: 'Backend target 2', inputs: 'exec_levels.target2', interpretation: 'Second profit objective returned by backend.', source: 'Swing Trade API' },
    { id: 'earnings_marker', name: 'Earnings Marker', category: 'levels', panel: 'price', ...available(false) },
    { id: 'gap_levels', name: 'Gap Levels', category: 'levels', panel: 'price', ...available(false) },
    { id: 'vwap', name: 'VWAP', category: 'context', panel: 'price', ...available(false) },
    { id: 'anchored_vwap', name: 'Anchored VWAP', category: 'context', panel: 'price', ...available(false) },
    { id: 'previous_day_levels', name: 'Previous Day High / Low', category: 'context', panel: 'price', ...available(false) },
    { id: 'previous_week_levels', name: 'Previous Week High / Low', category: 'context', panel: 'price', ...available(false) },
  ]
  const catalog = base.map(item => ({
    ...item,
    recommended: recommendedIds.includes(item.id),
    mandatory: mandatoryIds.includes(item.id),
    reason: recommendedIds.includes(item.id)
      ? item.reason || compactLabel(result?.playbook_hint || result?.decision_message || 'Selected by the backend swing snapshot.')
      : item.reason,
    timestamp: item.timestamp || text(metrics?.session_date) || undefined,
  }))
  return {
    catalog,
    recommendedIds,
    mandatoryIds,
    recommendedReason: recommendedIds.length ? compactLabel(result?.playbook_hint || result?.decision_message || 'Backend returned a swing indicator recommendation for this setup.') : null,
    fibonacci: {
      enabled: hasFibAnchors,
      direction: fibDirection,
      anchorLabel: fibAnchorLabel,
      currentZone: fibTargets?.fib_current_zone || 'Backend fib zone not returned',
      classification: fibTargets?.fib_classification || 'Backend pullback classification not returned',
      nearestConfluence: fibTargets?.fib_nearest_confluence || compactLabel(result?.playbook_hint || text(metrics?.fib_confluence) || 'Backend confluence summary not returned'),
      invalidation: money(fibTargets?.fib_structural_invalidation ?? fibTargets?.suggested_stop_loss ?? exec.stop),
    },
  }
}

function buildCoachBullets(unified: UnifiedAnalysis | null, result: SwingTradeScanResult | null): Array<{ icon: string; label: string; value: string; tone: 'good' | 'warn' | 'bad' | 'neutral' }> {
  const risk = unified?.risk_level || result?.risk_level || '—'
  const missing = result?.missing_confirmations?.[0] || result?.confirmation_needed?.[0] || unified?.entry_description || 'Backend has not returned a confirmation note.'
  const items: Array<{ icon: string; label: string; value: string; tone: 'good' | 'warn' | 'bad' | 'neutral' }> = [
    { icon: '✓', label: 'Trend', value: compactLabel(result?.metrics && text((result.metrics as Record<string, unknown>).trend_direction) || result?.swing_bias || result?.bias || unified?.structure), tone: result?.bias ? 'good' : 'neutral' },
    { icon: '✓', label: 'Market', value: compactLabel(result?.market_bias || text((result?.metrics as Record<string, unknown> | undefined)?.market_context) || unified?.regime), tone: 'neutral' },
    { icon: '!', label: 'Risk', value: compactLabel(risk), tone: risk === 'LOW' ? 'good' : risk === 'HIGH' ? 'bad' : 'warn' },
    { icon: '!', label: 'Confirmation needed', value: compactLabel(missing), tone: 'warn' },
    { icon: '→', label: 'Final Action', value: compactLabel(result?.final_action || unified?.verdict), tone: unified?.verdict === 'GO' || unified?.verdict === 'STRONG_GO' ? 'good' : unified?.verdict === 'AVOID' ? 'bad' : 'warn' },
  ]
  return items.slice(0, 5)
}

export default function SwingTradePage() {
  const {
    swingTradeEngineUI: ui,
    setSwingTradeEngineUI: setUi,
    addManualPosition,
    portfolio,
    user,
  } = useApp()
  const { ticker, loading, error, result } = ui
  useDocumentTitle(formatTickerTitle(result?.ticker || ticker, 'Swing Trade'))
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [watchlistOpen, setWatchlistOpen] = useState(() => {
    try { return window.localStorage.getItem('day_trade_workspace_sidebar_collapsed') !== '1' } catch { return true }
  })
  const [rightRailOpen, setRightRailOpen] = useState(() => {
    try {
      return window.localStorage.getItem('swing_trade_right_rail_open') !== '0'
    } catch {
      return true
    }
  })
  const [rightRailWidth, setRightRailWidth] = useState(() => {
    try {
      const saved = Number(window.localStorage.getItem('swing_trade_right_rail_width'))
      return Number.isFinite(saved) && saved >= 280 ? saved : 340
    } catch {
      return 340
    }
  })
  const [bottomDockOpen, setBottomDockOpen] = useState(false)
  const [bottomWidgetIds, setBottomWidgetIds] = useState<string[]>([])
  const [allWidgetsOpen, setAllWidgetsOpen] = useState(false)
  const [mobileWatchlistOpen, setMobileWatchlistOpen] = useState(false)
  const [myTickers, setMyTickers] = useState<MyTickerEntry[]>([])
  const [unified, setUnified] = useState<UnifiedAnalysis | null>(null)
  const [fibTargets, setFibTargets] = useState<StockTargetData | null>(null)
  const [notice, setNotice] = useState<{ tone: 'success' | 'info'; message: string } | null>(null)
  const [alertOpen, setAlertOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<WorkstationTab>('overview')
  const [sectionsOpen, setSectionsOpen] = useState(false)
  const [timeframe, setTimeframe] = useState<Timeframe>('Daily')
  const [chartMinimized, setChartMinimized] = useState(false)
  const [chartMaximized, setChartMaximized] = useState(false)
  const [chartHeight, setChartHeight] = useState(680)
  const [ocKey, setOcKey] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const didSelectDefaultTickerRef = useRef(false)

  const existingPositions = useMemo(
    () => portfolio.filter(p => p.ticker.toUpperCase() === result?.ticker?.toUpperCase() && p.status === 'open'),
    [portfolio, result?.ticker],
  )

  const preTradeRoute = useMemo(() => {
    const sym = result?.ticker || ticker
    const direction = result?.bias === 'short' ? 'Bearish' : result?.bias === 'long' ? 'Bullish' : null
    const rawStrategy = result?.suggested_strategy && result.suggested_strategy !== 'NO_TRADE' ? result.suggested_strategy : null
    const strategy = rawStrategy?.includes('PUT') || rawStrategy?.includes('Put')
      ? 'Bear Put Spread'
      : rawStrategy?.includes('CALL') || rawStrategy?.includes('Call')
        ? 'Bull Call Spread'
        : direction === 'Bearish'
          ? 'Bear Put Spread'
          : direction === 'Bullish'
            ? 'Bull Call Spread'
            : null
    return getTradeWorksheetRoute({ ticker: sym, direction, strategy, source: 'swing' })
  }, [result?.bias, result?.suggested_strategy, result?.ticker, ticker])

  const runScan = useCallback(async (overrideTicker?: string, forceRefresh = true) => {
    const sym = (overrideTicker || ticker).trim().toUpperCase()
    if (!sym || sym.length > 12) {
      setUi(cur => ({ ...cur, error: 'Enter a valid ticker symbol.' }))
      return
    }
    setUi(cur => ({ ...cur, loading: true, error: null, result: null, ticker: sym }))
    setUnified(null)
    setFibTargets(null)
    try {
      const data = await analyzeSwingTrade(sym, forceRefresh)
      setUi(cur => ({ ...cur, loading: false, ticker: data.ticker, result: data }))
      setOcKey(k => k + 1)
      try {
        const v2 = await analyzeV2(sym, 'swing')
        setUnified(v2.data)
      } catch {
        setUnified(null)
      }
    } catch (e) {
      setUi(cur => ({ ...cur, loading: false, error: axiosDetail(e) }))
    }
  }, [setUi, ticker])

  useEffect(() => {
    fetchMyTickers().then(res => {
      const rows = (res.data?.tickers ?? [])
        .filter(item => item.symbol && (item.is_active ?? true))
        .map(item => ({ ...item, symbol: item.symbol.toUpperCase() }))
        .sort((a, b) => a.symbol.localeCompare(b.symbol))
      setMyTickers(rows)
    }).catch(() => setMyTickers([]))
  }, [])

  useEffect(() => {
    const requestedTicker = searchParams.get('ticker')?.trim()
    if (requestedTicker || didSelectDefaultTickerRef.current || myTickers.length === 0) return
    const firstTicker = myTickers[0]?.symbol
    if (!firstTicker) return
    didSelectDefaultTickerRef.current = true
    void runScan(firstTicker)
  }, [myTickers, runScan, searchParams])

  useEffect(() => {
    const sym = result?.ticker
    if (!sym) return
    let cancelled = false
    fetchStockTargets(sym)
      .then(data => { if (!cancelled) setFibTargets(data) })
      .catch(() => { if (!cancelled) setFibTargets(null) })
    return () => { cancelled = true }
  }, [result?.ticker])

  useEffect(() => {
    const urlTicker = searchParams.get('ticker')?.trim().toUpperCase()
    const sym = urlTicker && urlTicker.length <= 12 ? urlTicker : ticker.trim().toUpperCase()
    if (sym) void runScan(sym)
    // run once on mount/url change only; runScan tracks input state for manual submits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  useEffect(() => {
    if (!notice) return
    const id = window.setTimeout(() => setNotice(null), 3000)
    return () => window.clearTimeout(id)
  }, [notice])

  useEffect(() => {
    try { window.localStorage.setItem('swing_trade_right_rail_open', rightRailOpen ? '1' : '0') } catch { /* quota */ }
  }, [rightRailOpen])

  useEffect(() => {
    try { window.localStorage.setItem('day_trade_workspace_sidebar_collapsed', watchlistOpen ? '0' : '1') } catch { /* quota */ }
  }, [watchlistOpen])

  useEffect(() => {
    try { window.localStorage.setItem('swing_trade_right_rail_width', String(rightRailWidth)) } catch { /* quota */ }
  }, [rightRailWidth])

  const resizeRightRail = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const startX = event.clientX
    const startWidth = rightRailWidth
    event.currentTarget.setPointerCapture(event.pointerId)
    const handleMove = (moveEvent: globalThis.PointerEvent) => {
      setRightRailWidth(Math.max(280, Math.min(560, startWidth - (moveEvent.clientX - startX))))
    }
    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }, [rightRailWidth])
  const dockWidgetToBottom = useCallback((widgetId: string) => {
    setBottomWidgetIds(current => current.includes(widgetId) ? current : [...current, widgetId])
    setBottomDockOpen(true)
  }, [])
  const undockWidgetToRight = useCallback((widgetId: string) => {
    setBottomWidgetIds(current => current.filter(id => id !== widgetId))
  }, [])
  const dropWidgetToBottom = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const sourceId = event.dataTransfer.getData('text/oa-widget-id')
    if (sourceId) dockWidgetToBottom(sourceId)
  }, [dockWidgetToBottom])

  const resizeChartWidget = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const startY = event.clientY
    const startHeight = chartHeight
    event.currentTarget.setPointerCapture(event.pointerId)
    const handleMove = (moveEvent: globalThis.PointerEvent) => {
      setChartHeight(Math.max(360, Math.min(1100, startHeight + (moveEvent.clientY - startY))))
    }
    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }, [chartHeight])

  const handleAddToPortfolio = useCallback(() => {
    if (!result) return
    const m = result.metrics as Record<string, unknown>
    const exec = getExec(result)
    const spread = getSpread(result, unified)
    const last = latestPrice(result, unified) ?? 0
    const longStrike = num(spread.long_strike)
    const optType = text(spread.long_leg).toUpperCase().includes('P') || result.bias === 'short' ? 'PUT' as const : 'CALL' as const
    const expiry = text(spread.expiry) || result.suggested_expiry_window || ''
    const legs: OptionLeg[] = longStrike != null ? [{
      action: 'BUY',
      option_type: optType,
      strike: longStrike,
      expiry,
      mid_price: num(spread.est_debit) ?? 0,
      delta: 0,
      bid: 0,
      ask: 0,
      iv: 0,
      oi: 0,
      volume: 0,
      bid_ask_spread_pct: 0,
    }] : [{
      action: 'BUY',
      option_type: optType,
      strike: 0,
      expiry,
      mid_price: last,
      delta: 0,
      bid: 0,
      ask: 0,
      iv: 0,
      oi: 0,
      volume: 0,
      bid_ask_spread_pct: 0,
    }]
    addManualPosition({
      ticker: result.ticker,
      companyName: result.company_name,
      strategy: text(spread.strategy) || result.suggested_strategy || 'SWING',
      bias: result.bias === 'short' ? 'Bearish' : 'Bullish',
      legs,
      expiry,
      dte: parseInt(result.recommended_contract_duration || '0', 10) || 0,
      net_credit: 0,
      spread_width: longStrike != null && num(spread.short_strike) != null ? Math.abs(longStrike - (num(spread.short_strike) || longStrike)) : 0,
      max_profit: num(spread.max_gain) ?? 0,
      max_loss: num(spread.max_loss) ?? 0,
      prob_of_profit: 0,
      expected_value: 0,
      scores_total: result.trade_quality_score || result.confidence || 0,
      contracts: 1,
      breakeven_lower: num(spread.breakeven) ?? 0,
      breakeven_upper: num(spread.breakeven) ?? 0,
      entryPrice: num(exec.breakout) ?? unified?.entry_price ?? last,
      source: 'swing',
      notes: result.decision_message || result.reason || '',
      target1: num(exec.target1) ?? undefined,
      target2: num(exec.target2) ?? undefined,
      stopLoss: num(exec.stop) ?? undefined,
    })
    setNotice({ tone: 'success', message: `${result.ticker} added to Positions Center.` })
    void m
  }, [addManualPosition, result, unified])

  const handleSaveToJournal = useCallback(async () => {
    if (!result || !user?.email) return
    const spread = getSpread(result, unified)
    const exec = getExec(result)
    const last = latestPrice(result, unified) ?? 0
    const dte = parseInt(result.recommended_contract_duration || '45', 10) || 45
    const expiry = text(spread.expiry) || new Date(Date.now() + dte * 86400000).toISOString().slice(0, 10)
    try {
      await saveToJournal(user.email, {
        ticker: result.ticker,
        company_name: result.company_name || '',
        strategy: text(spread.strategy) || result.suggested_strategy || (result.bias === 'short' ? 'Long Put' : 'Long Call'),
        bias: result.bias === 'short' ? 'Bearish' : result.bias === 'long' ? 'Bullish' : 'Neutral',
        legs: [],
        expiry,
        entry_date: new Date().toISOString().split('T')[0],
        dte_at_entry: dte,
        net_credit: -1 * (num(spread.est_debit) ?? 0),
        max_profit: num(spread.max_gain) ?? 0,
        max_loss: num(spread.max_loss) ?? 0,
        underlying_entry: last,
        prob_of_profit: 0,
        expected_value: 0,
        total_score: result.trade_quality_score ?? result.confidence ?? 0,
        trade_type: 'swing',
        engine_signal: result.decision_label || result.final_action || '',
        engine_state: 1,
        notes: [
          result.decision_message,
          num(exec.breakout) != null ? `Entry ${money(exec.breakout)}` : '',
          num(exec.stop) != null ? `Stop ${money(exec.stop)}` : '',
          num(exec.target1) != null ? `T1 ${money(exec.target1)}` : '',
        ].filter(Boolean).join(' · '),
      })
      setNotice({ tone: 'success', message: `${result.ticker} saved to Trade Journal.` })
    } catch {
      setNotice({ tone: 'info', message: 'Failed to save to journal. Please try again.' })
    }
  }, [result, unified, user?.email])

  const handleAddToAlpaca = useCallback(() => {
    if (!result) return
    const spread = getSpread(result, unified)
    const exec = getExec(result)
    const strike = num(spread.long_strike)
    if (strike == null || strike <= 0) {
      setNotice({ tone: 'info', message: 'Alpaca draft needs a backend option strike. Run pre-trade/options first.' })
      return
    }
    const optionType = text(spread.long_leg).toUpperCase().includes('P') || result.bias === 'short' ? 'PUT' : 'CALL'
    const expiry = swingExpiryDate(result, spread)
    const strategy = text(spread.strategy) || result.suggested_strategy || (optionType === 'PUT' ? 'Long Put' : 'Long Call')
    try {
      window.sessionStorage.setItem(ALPACA_TRADE_DRAFT_KEY, JSON.stringify({
        source: 'swing',
        createdAt: new Date().toISOString(),
        ticker: result.ticker,
        companyName: result.company_name || result.ticker,
        strategy,
        bias: result.bias === 'short' ? 'Bearish' : result.bias === 'long' ? 'Bullish' : 'Neutral',
        contracts: 1,
        legs: [{
          action: 'BUY',
          option_type: optionType,
          strike,
          expiry,
          mid_price: num(spread.est_debit) ?? 0,
          bid: 0,
          ask: 0,
        }],
        entryPrice: latestPrice(result, unified) ?? num(exec.breakout) ?? 0,
        stopLoss: num(exec.stop) ?? undefined,
        target1: num(exec.target1) ?? undefined,
        target2: num(exec.target2) ?? undefined,
        notes: result.decision_message || result.reason || '',
      }))
    } catch {
      setNotice({ tone: 'info', message: 'Unable to create Alpaca draft in this browser session.' })
      return
    }
    navigate(`${ROUTES.autoTrade}?ticker=${encodeURIComponent(result.ticker)}&source=swing`)
  }, [navigate, result, unified])

  const handleCreateAlert = useCallback(async (data: DeskAlertCreate) => {
    await deskApi.createAlert(data)
    setAlertOpen(false)
    setNotice({ tone: 'success', message: 'Alert saved.' })
  }, [])

  return (
    <div className="swing-trade-page min-h-screen bg-surface-page p-2 pb-24 text-primary md:min-h-0 md:flex-1 md:overflow-hidden md:p-0">
      <div className="flex w-full gap-1 md:h-full md:overflow-hidden">
        {watchlistOpen && (
          <SwingLeftSidebar
            ticker={ticker}
            result={result}
            loading={loading}
            inputRef={inputRef}
            myTickers={myTickers}
            onTickerChange={value => setUi(cur => ({ ...cur, ticker: value.toUpperCase() }))}
            onRun={sym => void runScan(sym)}
            onClose={() => setWatchlistOpen(false)}
          />
        )}

        {!watchlistOpen && (
          <button
            type="button"
            onClick={() => setWatchlistOpen(true)}
            className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-secondary hover:border-violet-400 dark:border-white/[0.08] dark:bg-slate-950 xl:flex"
            aria-label="Open Swing watchlist"
          >
            <ChevronRight size={18} />
          </button>
        )}

        <main className="flex min-w-0 flex-1 flex-col md:h-full md:overflow-hidden">
          <SwingMobileSearchBar
            ticker={ticker}
            loading={loading}
            onTickerChange={value => setUi(cur => ({ ...cur, ticker: value.toUpperCase() }))}
            onRun={sym => void runScan(sym)}
            onOpenWatchlist={() => setMobileWatchlistOpen(true)}
          />

          <SwingTopBar
            result={result}
            unified={unified}
            ticker={ticker}
            loading={loading}
            onRefresh={() => void runScan(undefined, true)}
            onAddToPortfolio={handleAddToPortfolio}
            onOpenAlert={() => setAlertOpen(true)}
            onOpenPreTrade={() => navigate(preTradeRoute)}
            onOpenSections={() => setSectionsOpen(true)}
            onOpenDayTrade={() => navigate(getEngineRoute('day', result?.ticker || ticker))}
            hasPosition={existingPositions.length > 0}
            rightRailOpen={rightRailOpen}
            onToggleRightRail={() => setRightRailOpen(open => !open)}
            bottomDockOpen={bottomDockOpen}
            bottomDockCount={bottomWidgetIds.length}
            onToggleBottomDock={() => setBottomDockOpen(open => !open)}
            onOpenAllWidgets={() => setAllWidgetsOpen(true)}
          />

          {notice && (
            <div className={`m-1 rounded-lg border px-3 py-2 text-xs ${
              notice.tone === 'success'
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
                : 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-200'
            }`}>
              {notice.message}
            </div>
          )}

          {error && (
            <div className="m-1 flex gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-200">
              <ShieldAlert className="mt-0.5 shrink-0" size={16} />
              {error}
            </div>
          )}

          <div
            className={`grid min-h-0 flex-1 auto-rows-max content-start items-start gap-1 overflow-auto p-1 xl:auto-rows-auto xl:content-stretch xl:items-stretch xl:overflow-hidden ${rightRailOpen ? 'xl:grid-cols-[minmax(0,1fr)_6px_var(--right-rail-width)]' : 'xl:grid-cols-1'}`}
            style={{ ['--right-rail-width' as string]: `${rightRailWidth}px` }}
          >
            <div className={`min-h-0 min-w-0 ${bottomDockOpen ? 'grid gap-1 xl:grid-rows-[minmax(0,3fr)_minmax(180px,1fr)]' : 'flex flex-col'}`}>
            <section className="flex h-full min-h-[220px] min-w-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white p-1 shadow-sm dark:border-white/[0.07] dark:bg-slate-950 md:min-h-0">
              <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-white/[0.07] dark:bg-slate-900/60">
                <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-tertiary">
                  <GripVertical size={14} />
                  Chart Widget
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => setChartMinimized(cur => !cur)} className="inline-flex h-6 w-6 items-center justify-center rounded-md text-tertiary hover:bg-slate-200 hover:text-heading dark:hover:bg-slate-800" aria-label={chartMinimized ? 'Restore chart widget' : 'Minimize chart widget'} title={chartMinimized ? 'Restore chart' : 'Minimize chart'}>
                    {chartMinimized ? <Minimize2 size={13} /> : <Minus size={13} />}
                  </button>
                  <button type="button" onClick={() => setChartMaximized(true)} className="inline-flex h-6 w-6 items-center justify-center rounded-md text-tertiary hover:bg-slate-200 hover:text-heading dark:hover:bg-slate-800" aria-label="Maximize chart widget" title="Maximize chart">
                    <Maximize2 size={13} />
                  </button>
                </div>
              </div>
              {!chartMinimized && (
                <>
                  <div className="min-h-0 flex-1" style={{ minHeight: bottomDockOpen ? 0 : `clamp(320px, 62dvh, ${chartHeight}px)` }}>
                    <SwingPrimaryChart
                      result={result}
                      unified={unified}
                      fibTargets={fibTargets}
                      timeframe={timeframe}
                      onTimeframeChange={setTimeframe}
                    />
                  </div>
                  <div className="h-2 shrink-0 cursor-row-resize border-t border-slate-100 bg-slate-50 transition hover:bg-violet-100 active:bg-violet-200 dark:border-white/[0.05] dark:bg-slate-900/70 dark:hover:bg-violet-950/50" onPointerDown={resizeChartWidget} role="separator" aria-orientation="horizontal" aria-label="Resize chart widget" title="Drag to resize chart" />
                </>
              )}
            </section>
            {bottomDockOpen && (
              <section
                className="flex min-h-[180px] min-w-0 flex-col overflow-hidden rounded-lg border border-dashed border-violet-300 bg-violet-50/40 dark:border-violet-500/35 dark:bg-violet-950/20"
                onDragOver={event => event.preventDefault()}
                onDrop={dropWidgetToBottom}
              >
                <div className="flex shrink-0 items-center justify-between border-b border-violet-200/70 px-3 py-2 dark:border-violet-500/20">
                  <div className="text-[11px] font-black uppercase tracking-widest text-violet-700 dark:text-violet-200">
                    Bottom Widget Tray · Drop right widgets here
                  </div>
                  <button type="button" onClick={() => setBottomDockOpen(false)} className="rounded-md p-1.5 text-secondary hover:bg-white hover:text-heading dark:hover:bg-slate-900" aria-label="Close bottom widget tray" title="Close bottom tray and expand chart">
                    <X size={15} />
                  </button>
                </div>
                {bottomWidgetIds.length ? (
                  <SwingRightRail
                    result={result}
                    unified={unified}
                    fibTargets={fibTargets}
                    existingPositionCount={existingPositions.length}
                    onAddToPortfolio={handleAddToPortfolio}
                    onSaveJournal={() => void handleSaveToJournal()}
                    onAddToAlpaca={handleAddToAlpaca}
                    placement="bottom"
                    dockedWidgetIds={bottomWidgetIds}
                    onUndockWidget={undockWidgetToRight}
                  />
                ) : (
                  <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-xs font-semibold text-violet-700 dark:text-violet-200">
                    Drag widgets from the right info panel into this bottom tray.
                  </div>
                )}
              </section>
            )}
            </div>
            {chartMaximized && (
              <div className="fixed inset-2 z-50 flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-white/[0.08] dark:bg-slate-950 sm:inset-4" role="dialog" aria-modal="true" aria-label="Chart widget">
                <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-white/[0.08] dark:bg-slate-900">
                  <div className="text-sm font-black uppercase tracking-widest text-heading">Chart Widget</div>
                  <button type="button" onClick={() => setChartMaximized(false)} className="rounded-lg p-2 text-secondary hover:bg-slate-200 hover:text-heading dark:hover:bg-slate-800" aria-label="Close maximized chart">
                    <X size={18} />
                  </button>
                </div>
                <div className="min-h-0 flex-1 p-2">
                  <SwingPrimaryChart
                    result={result}
                    unified={unified}
                    fibTargets={fibTargets}
                    timeframe={timeframe}
                    onTimeframeChange={setTimeframe}
                  />
                </div>
              </div>
            )}

            {rightRailOpen && (
              <>
                <div
                  className="hidden cursor-col-resize rounded-full bg-slate-200 transition hover:bg-violet-400 active:bg-violet-500 dark:bg-white/[0.08] xl:block"
                  onPointerDown={resizeRightRail}
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize right info panel"
                  title="Drag to resize right panel"
                />
                <SwingRightRail
                  result={result}
                  unified={unified}
                  fibTargets={fibTargets}
                  existingPositionCount={existingPositions.length}
                  onAddToPortfolio={handleAddToPortfolio}
                  onSaveJournal={() => void handleSaveToJournal()}
                  onAddToAlpaca={handleAddToAlpaca}
                  placement="right"
                  dockedWidgetIds={bottomWidgetIds}
                  onDockWidget={dockWidgetToBottom}
                  onUndockWidget={undockWidgetToRight}
                />
              </>
            )}
          </div>

          <SwingSectionsDrawer
            open={sectionsOpen}
            onClose={() => setSectionsOpen(false)}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            result={result}
            unified={unified}
            fibTargets={fibTargets}
            ocKey={ocKey}
            onOpenAlert={() => setAlertOpen(true)}
            onSaveJournal={() => void handleSaveToJournal()}
          />
        </main>
      </div>

      {mobileWatchlistOpen && (
        <div className="fixed inset-0 z-40 xl:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileWatchlistOpen(false)} />
          <SwingLeftSidebar
            ticker={ticker}
            result={result}
            loading={loading}
            inputRef={inputRef}
            myTickers={myTickers}
            onTickerChange={value => setUi(cur => ({ ...cur, ticker: value.toUpperCase() }))}
            onRun={sym => {
              setMobileWatchlistOpen(false)
              void runScan(sym)
            }}
            onClose={() => setMobileWatchlistOpen(false)}
            mobileOverlay
          />
        </div>
      )}

      {loading && !result && (
        <div className="fixed bottom-4 right-4 z-30 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-secondary shadow-xl dark:border-white/[0.08] dark:bg-slate-950">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading swing workspace...
        </div>
      )}

      {alertOpen && result && (
        <SetAlertDrawer
          ticker={result.ticker}
          tradeType="swing"
          onClose={() => setAlertOpen(false)}
          onSubmit={handleCreateAlert}
        />
      )}
      {allWidgetsOpen && (
        <div className="fixed inset-y-0 right-0 z-[60] flex w-full flex-col border-l border-slate-200 bg-slate-100/95 p-2 shadow-2xl backdrop-blur-sm dark:border-white/[0.08] dark:bg-slate-950/95 lg:w-1/2 lg:p-4" role="dialog" aria-modal="true" aria-label="Expanded Swing Trade widgets">
          <div className="flex shrink-0 items-center justify-between rounded-t-xl border border-slate-200 bg-white px-4 py-3 dark:border-white/[0.08] dark:bg-slate-950">
            <div>
              <div className="text-sm font-black uppercase tracking-widest text-heading">Swing Trade Workspace</div>
              <div className="text-xs text-secondary">All decision widgets expanded</div>
            </div>
            <button type="button" onClick={() => setAllWidgetsOpen(false)} className="rounded-lg p-2 text-secondary hover:bg-slate-100 hover:text-heading dark:hover:bg-slate-900" aria-label="Close expanded workspace" title="Close expanded workspace">
              <X size={18} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-b-xl border-x border-b border-slate-200 bg-surface-page p-3 dark:border-white/[0.08]">
            <SwingRightRail
              result={result}
              unified={unified}
              fibTargets={fibTargets}
              existingPositionCount={existingPositions.length}
              onAddToPortfolio={handleAddToPortfolio}
              onSaveJournal={() => void handleSaveToJournal()}
              onAddToAlpaca={handleAddToAlpaca}
              allExpanded
            />
          </div>
        </div>
      )}
    </div>
  )
}

function SwingLeftSidebar({
  ticker,
  result,
  loading,
  inputRef,
  myTickers,
  onTickerChange,
  onRun,
  onClose,
  mobileOverlay = false,
}: {
  ticker: string
  result: SwingTradeScanResult | null
  loading: boolean
  inputRef: React.RefObject<HTMLInputElement>
  myTickers: MyTickerEntry[]
  onTickerChange: (value: string) => void
  onRun: (ticker?: string) => void
  onClose: () => void
  mobileOverlay?: boolean
}) {
  const navigate = useNavigate()
  const [activeFilter, setActiveFilter] = useState<SwingSidebarFilterKey>('all')
  const [tickerSearch, setTickerSearch] = useState('')
  const filteredTickers = useMemo(() => {
    const query = tickerSearch.trim().toUpperCase()
    return myTickers.filter(item => {
      const groups = swingTickerGroups(item)
      const matchesFilter = activeFilter === 'all' || groups.includes(activeFilter)
      const matchesQuery = !query || item.symbol.includes(query) || String(item.company_name || '').toUpperCase().includes(query)
      return matchesFilter && matchesQuery
    })
  }, [activeFilter, myTickers, tickerSearch])

  useEffect(() => {
    try { localStorage.setItem('day_trade_workspace_sidebar_tab', activeFilter) } catch { /* quota */ }
  }, [activeFilter])

  useEffect(() => {
    try { localStorage.setItem('day_trade_workspace_sidebar_search', tickerSearch) } catch { /* quota */ }
  }, [tickerSearch])

  return (
    <aside className={mobileOverlay
      ? 'absolute left-0 top-0 flex h-full w-80 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-r-xl border border-slate-200 bg-white p-3 shadow-xl dark:border-white/[0.08] dark:bg-slate-950'
      : 'hidden h-full w-72 shrink-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-3 dark:border-white/[0.08] dark:bg-slate-950 xl:flex 2xl:w-80'
    }>
      <div className="mb-3 flex shrink-0 items-start justify-between">
        <div>
          {!mobileOverlay && <div className="text-[11px] font-black uppercase tracking-widest text-tertiary">Swing Workstation</div>}
          <div className={`flex items-center gap-2 ${mobileOverlay ? '' : 'mt-1'}`}>
            <TrendingUp size={16} className="text-violet-500" />
            <span className="text-lg font-black text-heading">Swing Trade</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {!mobileOverlay && (
            <div className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-violet-700 dark:text-violet-200">
              My Tickers
            </div>
          )}
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-secondary hover:bg-slate-100 dark:hover:bg-slate-900" aria-label={mobileOverlay ? 'Close navigation' : 'Collapse sidebar'}>
            {mobileOverlay ? <X size={17} /> : <ChevronLeft size={16} />}
          </button>
        </div>
      </div>

      <section className="mb-3 shrink-0 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/[0.07] dark:bg-slate-900/60">
        <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-tertiary">Search My Tickers</div>
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-2 dark:border-white/[0.08] dark:bg-slate-950">
          <Search size={14} className="text-tertiary" />
          <input
            value={tickerSearch}
            onChange={event => setTickerSearch(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-heading outline-none placeholder:text-tertiary"
            placeholder="Symbol or company"
            autoComplete="off"
            spellCheck={false}
            aria-label="Search swing tickers"
          />
          {tickerSearch && (
            <button
              type="button"
              onClick={() => setTickerSearch('')}
              className="rounded-md p-1 text-tertiary hover:bg-slate-100 hover:text-heading dark:hover:bg-slate-900"
              aria-label="Clear ticker search"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </section>

      {/* The mobile overlay already has an Analyze bar (SwingMobileSearchBar) above
          the drawer, so hide this duplicate there and let the ticker list lead. */}
      {!mobileOverlay && (
      <section className="mb-3 shrink-0 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/[0.07] dark:bg-slate-900/60">
        <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-tertiary">Analyze</div>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={ticker}
            onChange={event => onTickerChange(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') onRun() }}
            className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm font-black uppercase text-heading outline-none focus:border-violet-500 dark:border-white/[0.08] dark:bg-slate-950"
            placeholder="AAPL"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            disabled={loading}
            onClick={() => onRun()}
            className="rounded-lg bg-violet-600 px-3 py-2 text-white hover:bg-violet-500 disabled:opacity-60"
            aria-label="Analyze ticker"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search size={16} />}
          </button>
        </div>
        {result && (
          <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/[0.08] dark:bg-slate-950">
            <div className="font-mono text-lg font-black text-heading">{result.ticker}</div>
            <div className="truncate text-xs text-secondary">{result.company_name}</div>
          </div>
        )}
      </section>
      )}

      <section className="flex min-h-0 flex-1 flex-col">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[10px] font-black uppercase tracking-widest text-tertiary">My Tickers</div>
          <div className="flex items-center gap-2">
            <a href={ROUTES.myTickers} className="text-[10px] font-bold text-violet-600 dark:text-violet-300" onClick={event => handlePlainAnchorClick(event, () => navigate(ROUTES.myTickers))}>Add Ticker</a>
            <a href={ROUTES.myTickers} className="text-[10px] font-bold text-violet-600 dark:text-violet-300" onClick={event => handlePlainAnchorClick(event, () => navigate(ROUTES.myTickers))}>Manage</a>
          </div>
        </div>
        <div className="mb-2 grid grid-cols-2 gap-1.5">
          {SWING_SIDEBAR_FILTERS.map(filter => (
            <button
              key={filter.key}
              type="button"
              onClick={() => setActiveFilter(filter.key)}
              className={`rounded-lg border px-2 py-1.5 text-[10px] font-black uppercase tracking-wide transition ${
                activeFilter === filter.key
                  ? 'border-violet-500 bg-violet-500/10 text-violet-700 dark:text-violet-200'
                  : 'border-slate-200 bg-white text-secondary hover:border-violet-300 dark:border-white/[0.08] dark:bg-slate-950'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-auto overscroll-contain">
          {filteredTickers.length ? filteredTickers.map(item => {
            const selected = item.symbol === result?.ticker
            const groups = swingTickerGroups(item)
            return (
              <a
                key={item.symbol}
                href={getEngineRoute('swing', item.symbol)}
                onClick={event => handlePlainAnchorClick(event, () => onRun(item.symbol))}
                className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition ${
                  selected
                    ? 'border-violet-500 bg-violet-500/10'
                    : 'border-slate-200 bg-white hover:border-violet-300 dark:border-white/[0.08] dark:bg-slate-950'
                }`}
              >
                <span className="min-w-0">
                  <span className="block font-mono text-sm font-black text-heading">{item.symbol}</span>
                  <span className="block truncate text-xs text-tertiary">{item.company_name}</span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    {groups.map(group => (
                      <span key={group} className="rounded-full border border-slate-200 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-tertiary dark:border-white/[0.08]">
                        {group === 'regular' ? 'Position' : group}
                      </span>
                    ))}
                  </span>
                </span>
                <span className="text-right">
                  <span className="block font-mono text-xs font-bold text-heading">{money(item.last_price)}</span>
                  <span className={`block font-mono text-[11px] font-bold ${(item.price_change_pct ?? 0) >= 0 ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'}`}>
                    {pct(item.price_change_pct)}
                  </span>
                </span>
              </a>
            )
          }) : (
            <div className="rounded-lg border border-slate-200 px-3 py-3 text-sm text-tertiary dark:border-white/[0.08]">
              {tickerSearch ? 'No tickers match this search.' : 'No tickers match this filter.'}
            </div>
          )}
        </div>
      </section>

      <section className="mt-3 shrink-0">
        <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-tertiary">Quick Tickers</div>
        <div className="flex flex-wrap gap-1.5">
          {['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMD', 'META'].map(sym => (
            <a
              key={sym}
              href={getEngineRoute('swing', sym)}
              onClick={event => handlePlainAnchorClick(event, () => onRun(sym))}
              className="rounded-full border border-slate-200 px-2 py-1 font-mono text-[11px] font-black text-secondary hover:border-violet-400 dark:border-white/[0.08]"
            >
              {sym}
            </a>
          ))}
        </div>
      </section>

    </aside>
  )
}

function SwingMobileSearchBar({
  ticker,
  loading,
  onTickerChange,
  onRun,
  onOpenWatchlist,
}: {
  ticker: string
  loading: boolean
  onTickerChange: (value: string) => void
  onRun: (ticker?: string) => void
  onOpenWatchlist: () => void
}) {
  return (
    <section className="mb-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-white/[0.08] dark:bg-slate-950 xl:hidden">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenWatchlist}
            className="inline-flex rounded-lg border border-violet-500/30 bg-violet-500/10 p-2 text-violet-700 dark:text-violet-200"
            aria-label="Open navigation"
            title="Open navigation"
          >
            <Menu size={17} />
          </button>
          <div>
          <div className="text-[10px] font-black uppercase tracking-widest text-tertiary">Swing Trade</div>
          <div className="text-sm font-black text-heading">Analyze Ticker</div>
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        <input
          value={ticker}
          onChange={event => onTickerChange(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') onRun() }}
          className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-base font-black uppercase text-heading outline-none focus:border-violet-500 dark:border-white/[0.08] dark:bg-slate-900"
          placeholder="AAPL"
          autoComplete="off"
          spellCheck={false}
          aria-label="Analyze ticker"
        />
        <button
          type="button"
          disabled={loading}
          onClick={() => onRun()}
          className="rounded-lg bg-violet-600 px-4 py-2 text-white hover:bg-violet-500 disabled:opacity-60"
          aria-label="Analyze ticker"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search size={16} />}
        </button>
      </div>
    </section>
  )
}

function SwingTopBar({
  result,
  unified,
  ticker,
  loading,
  hasPosition,
  onRefresh,
  onAddToPortfolio,
  onOpenAlert,
  onOpenPreTrade,
  onOpenSections,
  onOpenDayTrade,
  rightRailOpen,
  onToggleRightRail,
  bottomDockOpen,
  bottomDockCount,
  onToggleBottomDock,
  onOpenAllWidgets,
}: {
  result: SwingTradeScanResult | null
  unified: UnifiedAnalysis | null
  ticker: string
  loading: boolean
  hasPosition: boolean
  onRefresh: () => void
  onAddToPortfolio: () => void
  onOpenAlert: () => void
  onOpenPreTrade: () => void
  onOpenSections: () => void
  onOpenDayTrade: () => void
  rightRailOpen: boolean
  onToggleRightRail: () => void
  bottomDockOpen: boolean
  bottomDockCount: number
  onToggleBottomDock: () => void
  onOpenAllWidgets: () => void
}) {
  const dayTradeRoute = getEngineRoute('day', result?.ticker || ticker)
  const dailyChange = latestDailyChange(result, unified)
  const dailyChangePct = latestDailyChangePct(result, unified)
  return (
    <div className="relative mb-1 flex min-h-10 flex-wrap items-center justify-between gap-2 border border-slate-200 bg-white px-2 py-1 shadow-sm dark:border-white/[0.08] dark:bg-slate-950 xl:border-x-0 xl:border-t-0">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-[10px] font-black uppercase tracking-widest text-tertiary">Swing Trade</span>
        <span className="font-mono text-base font-black text-heading">{result?.ticker || ticker || '—'}</span>
        <span className="max-w-[340px] truncate text-sm font-semibold text-secondary">{result?.company_name || unified?.company || ''}</span>
        <span className="font-mono text-base font-black text-heading">{money(latestPrice(result, unified))}</span>
        {dailyChange != null && dailyChangePct != null && (
          <span className={`font-mono text-sm font-bold ${dailyChange >= 0 ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'}`}>
            {signedMoney(dailyChange)} ({pct(dailyChangePct)})
          </span>
        )}
        {(result?.bias || result?.swing_bias) && (
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${swingBiasBadgeClass(result?.bias || result?.swing_bias)}`}>
            {compactLabel(result?.bias || result?.swing_bias)}
          </span>
        )}
      </div>
      <div className="flex max-w-full shrink-0 items-center gap-1.5 overflow-x-auto">
        <a
          href={dayTradeRoute}
          onClick={event => handlePlainAnchorClick(event, onOpenDayTrade)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-1.5 text-[11px] font-black text-sky-700 hover:border-sky-400 dark:text-sky-200"
        >
          <Activity size={14} />
          Day Trade
        </a>
        <button type="button" onClick={onOpenSections} className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1.5 text-[11px] font-black text-secondary hover:border-violet-400 dark:border-white/[0.08]">
          <LayoutList size={14} />
          Sections
        </button>
        <button
          type="button"
          onClick={onToggleRightRail}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1.5 text-[11px] font-black text-secondary hover:border-violet-400 dark:border-white/[0.08]"
          aria-label={rightRailOpen ? 'Collapse right info panel' : 'Expand right info panel'}
          title={rightRailOpen ? 'Collapse right panel' : 'Expand right panel'}
        >
          {rightRailOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
          <span className="hidden xl:inline">{rightRailOpen ? 'Hide Info' : 'Show Info'}</span>
        </button>
        <button
          type="button"
          onClick={onToggleBottomDock}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1.5 text-[11px] font-black text-secondary hover:border-violet-400 dark:border-white/[0.08]"
          aria-label={bottomDockOpen ? 'Close bottom widget tray' : 'Open bottom widget tray'}
          title={bottomDockOpen ? 'Close bottom tray and expand chart' : 'Open bottom widget tray'}
        >
          <LayoutList size={14} />
          <span className="hidden sm:inline">{bottomDockOpen ? 'Hide Bottom' : 'Bottom'}</span>
          {bottomDockCount > 0 && <span className="font-mono text-[10px] text-violet-600 dark:text-violet-300">{bottomDockCount}</span>}
        </button>
        <button
          type="button"
          onClick={onOpenAllWidgets}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-violet-400/50 bg-violet-500/10 px-2 py-1.5 text-[11px] font-black text-violet-700 hover:border-violet-500 hover:bg-violet-500/15 dark:text-violet-200"
          aria-label="Expand all workspace widgets"
          title="Open all widgets in an expanded workspace"
        >
          <Maximize2 size={14} />
          <span className="hidden sm:inline">Expand All</span>
        </button>
        {hasPosition && (
          <button type="button" onClick={() => window.location.assign(ROUTES.positions)} className="shrink-0 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] font-black text-amber-700 dark:text-amber-200">
            In Position
          </button>
        )}
        <button type="button" onClick={onOpenPreTrade} className="shrink-0 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-[11px] font-black text-emerald-700 dark:text-emerald-200">
          Pre-Trade
        </button>
        <button type="button" onClick={onOpenAlert} disabled={!result} className="shrink-0 rounded-md border border-slate-200 px-2 py-1.5 text-[11px] font-black text-secondary hover:border-violet-400 disabled:opacity-50 dark:border-white/[0.08]">
          Alert
        </button>
        <button type="button" onClick={onAddToPortfolio} disabled={!result || hasPosition} className="shrink-0 rounded-md bg-violet-600 px-2 py-1.5 text-[11px] font-black text-white hover:bg-violet-500 disabled:opacity-50">
          Portfolio
        </button>
        <button type="button" onClick={onRefresh} disabled={loading} className="shrink-0 rounded-md border border-slate-200 p-1.5 text-secondary hover:border-violet-400 disabled:opacity-50 dark:border-white/[0.08]" aria-label="Refresh swing analysis">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
    </div>
  )
}

function SwingRightRail({
  result,
  unified,
  fibTargets,
  existingPositionCount,
  onAddToPortfolio,
  onSaveJournal,
  onAddToAlpaca,
  placement = 'right',
  dockedWidgetIds = [],
  onDockWidget,
  onUndockWidget,
  allExpanded = false,
}: {
  result: SwingTradeScanResult | null
  unified: UnifiedAnalysis | null
  fibTargets: StockTargetData | null
  existingPositionCount: number
  onAddToPortfolio: () => void
  onSaveJournal: () => void
  onAddToAlpaca: () => void
  placement?: WidgetPlacement
  dockedWidgetIds?: string[]
  onDockWidget?: (widgetId: string) => void
  onUndockWidget?: (widgetId: string) => void
  allExpanded?: boolean
}) {
  const exec = getExec(result)
  const spread = getSpread(result, unified)
  const metrics = result?.metrics as Record<string, unknown> | undefined
  const marketStructure = isRecord(metrics?.market_structure) ? metrics.market_structure : null
  const marketStructureSequence = Array.isArray(marketStructure?.sequence)
    ? marketStructure.sequence.map(item => String(item)).filter(Boolean).join(' -> ')
    : ''
  const structurePivots = backendStructurePivots(metrics)
  const signalQuality = unified?.verdict_presentation?.signal_quality?.label || result?.setup_quality || result?.entry_quality || '—'
  const confidence = unified?.confidence ?? result?.confidence ?? null
  const professional = result?.professional_decision
  const shouldRenderWidget = (title: string) => {
    const docked = dockedWidgetIds.includes(widgetIdForTitle(title))
    return placement === 'bottom' ? docked : !docked
  }
  const cardProps = { placement, onDockWidget, onUndockWidget, allExpanded }
  return (
    <aside className={placement === 'bottom'
      ? 'grid min-h-0 flex-1 auto-cols-[minmax(280px,420px)] grid-flow-col content-start gap-2 overflow-x-auto overflow-y-hidden p-2'
      : allExpanded
        ? 'grid min-h-0 w-full content-start gap-3 pr-0'
        : 'grid min-h-0 w-full content-start gap-3 overflow-visible overscroll-contain pr-0 xl:overflow-y-auto xl:pr-1'}>
      {shouldRenderWidget('Current Decision') && <RailCard title="Current Decision" {...cardProps}>
        {professional ? (
          <SwingProfessionalDecisionSummary decision={professional} />
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <VerdictPill verdict={unified?.verdict || result?.final_action || result?.verdict} />
              <span className="font-mono text-xl font-black text-heading">{confidence == null ? '—' : `${Math.round(confidence)}%`}</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Value label="Bias" value={compactLabel(result?.bias || result?.swing_bias)} />
              <Value label="Score" value={result?.trade_quality_score != null ? String(result.trade_quality_score) : '—'} />
              <Value label="Signal" value={signalQuality} />
              <Value label="Risk" value={unified?.risk_level || result?.risk_level || '—'} />
            </div>
          </>
        )}
        {existingPositionCount > 0 && <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs font-bold text-amber-700 dark:text-amber-200">Already tracked in Positions Center</div>}
      </RailCard>}

      {shouldRenderWidget('Market Structure') && <RailCard title="Market Structure" {...cardProps}>
        <div className="grid gap-2">
          <Value label="Trend" value={compactLabel(text(metrics?.trend_direction) || result?.swing_bias || result?.bias)} />
          <div>
            <div className="mb-1 text-[10px] font-black uppercase tracking-widest text-tertiary">Sequence</div>
            {structurePivots.length ? (
              <div className="flex flex-wrap items-center gap-1">
                {structurePivots.slice(-6).map((pivot, index, arr) => {
                  const label = String(pivot.label ?? '')
                  const up = /^(HH|HL)/i.test(label)
                  const down = /^(LH|LL)/i.test(label)
                  const last = index === arr.length - 1
                  return (
                    <span key={`${pivot.label}-${index}`} className="flex items-center gap-1">
                      <span className={`rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-bold ${last ? 'ring-2 ring-violet-400' : ''} ${up ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-300' : down ? 'border-rose-500/40 text-rose-600 dark:text-rose-300' : 'border-slate-300 text-tertiary dark:border-white/10'}`}>{pivot.label}</span>
                      {!last && <span className="text-tertiary">→</span>}
                    </span>
                  )
                })}
                <span className="ml-1 rounded-md bg-violet-500/15 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-violet-600 dark:text-violet-300">Current</span>
              </div>
            ) : (
              <div className="text-xs text-tertiary">{compactLabel(text(marketStructure?.display) || marketStructureSequence) || 'No confirmed pivots yet'}</div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Value label="BOS" value={compactLabel(text(marketStructure?.bos)) || '—'} />
            <Value label="CHoCH" value={compactLabel(text(marketStructure?.choch)) || '—'} />
          </div>
          <Value label="Current" value={compactLabel(unified?.structure || text(metrics?.trend_stage))} />
          <Value label="Expected Next" value={compactLabel(text(metrics?.preferred_entry_trigger) || text(metrics?.entry_quality_label) || result?.entry_quality)} />
          <Value label="Invalidation" value={money(exec.stop ?? unified?.stop_price)} />
        </div>
      </RailCard>}

      {shouldRenderWidget('Entry Plan / Strategy') && <RailCard title="Entry Plan / Strategy" {...cardProps}>
        <div className="grid gap-3">
          <div>
            <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-tertiary">Entry Plan</div>
            <div className="grid grid-cols-2 gap-2">
              <Value label="Entry" value={professional?.risk.entry.display ?? money(exec.breakout ?? unified?.entry_price)} />
              <Value label="Stop" value={professional?.risk.stop.display ?? money(exec.stop ?? unified?.stop_price)} />
              <Value label="Risk" value={professional?.risk.risk.display ?? '—'} />
              <Value label="Target" value={professional?.risk.target.display ?? (money(exec.target2) !== '—' ? money(exec.target2) : levelFromUnified(unified, 't2'))} />
              <Value label="R/R" value={professional?.risk.riskReward.display ?? (unified?.rr_ratio || '—')} />
              <Value label="Timing" value={professional?.confidence.entryTiming.display ?? compactLabel(result?.execution_readiness || text(metrics?.trade_timing_verdict))} />
              <Value label="Reward Left" value={professional?.risk.rewardRemaining.display ?? '—'} />
              <Value label="Quality" value={professional?.risk.tradeQuality.display ?? '—'} />
            </div>
          </div>
          <div className="border-t border-slate-200 pt-3 dark:border-white/[0.08]">
            <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-tertiary">Strategy</div>
            <div className="grid grid-cols-2 gap-2">
              <Value label="Selected" value={compactLabel(text(spread.strategy) || result?.suggested_strategy)} />
              <Value label="DTE" value={result?.recommended_contract_duration || (text(spread.expiry) ? text(spread.expiry) : '—')} />
              <Value label="Debit" value={money(spread.est_debit)} />
              <Value label="Max Gain" value={money(spread.max_gain)} />
              <Value label="Max Loss" value={money(spread.max_loss)} />
              <Value label="Breakeven" value={money(spread.breakeven)} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-1.5 border-t border-slate-200 pt-3 dark:border-white/[0.08]">
            <RailActionButton
              label="Position"
              icon={<BriefcaseBusiness size={13} />}
              disabled={!result || existingPositionCount > 0}
              onClick={onAddToPortfolio}
            />
            <RailActionButton
              label="Journal"
              icon={<BookOpen size={13} />}
              disabled={!result}
              onClick={onSaveJournal}
            />
            <RailActionButton
              label="Alpaca"
              icon={<RadioTower size={13} />}
              disabled={!result}
              onClick={onAddToAlpaca}
            />
          </div>
        </div>
      </RailCard>}

      {shouldRenderWidget('AI Coach') && <RailCard title="AI Coach" {...cardProps}>
        <div className="space-y-2">
          {buildCoachBullets(unified, result).map(item => (
            <div key={item.label} className="flex gap-2 rounded-lg bg-slate-50 px-2 py-1.5 text-xs dark:bg-slate-900">
              <span className={`font-black ${item.tone === 'good' ? 'text-emerald-600 dark:text-emerald-300' : item.tone === 'bad' ? 'text-rose-600 dark:text-rose-300' : item.tone === 'warn' ? 'text-amber-600 dark:text-amber-300' : 'text-tertiary'}`}>{item.icon}</span>
              <span className="min-w-0">
                <span className="font-bold text-heading">{item.label}: </span>
                <span className="text-secondary">{item.value}</span>
              </span>
            </div>
          ))}
        </div>
      </RailCard>}

      {shouldRenderWidget('Fib Summary') && <RailCard title="Fib Summary" {...cardProps}>
        <div className="grid gap-2">
          <Value label="Active Anchors" value={fibTargets?.fib_swing_high && fibTargets?.fib_swing_low ? `${money(fibTargets.fib_swing_low)} → ${money(fibTargets.fib_swing_high)}` : 'Backend anchors not returned'} muted={!fibTargets?.fib_swing_high || !fibTargets?.fib_swing_low} />
          <Value label="Current Fib Zone" value={fibTargets?.fib_current_zone || 'Backend fib zone not returned'} muted={!fibTargets?.fib_current_zone} />
          <Value label="Pullback" value={fibTargets?.fib_classification || 'Backend classification not returned'} muted={!fibTargets?.fib_classification} />
          <Value label="Nearest Confluence" value={fibTargets?.fib_nearest_confluence || compactLabel(result?.playbook_hint)} />
          <Value label="Invalidation" value={money(fibTargets?.fib_structural_invalidation ?? fibTargets?.suggested_stop_loss ?? exec.stop)} />
        </div>
      </RailCard>}
    </aside>
  )
}

function SwingPrimaryChart({
  result,
  unified,
  fibTargets,
  timeframe,
  onTimeframeChange,
}: {
  result: SwingTradeScanResult | null
  unified: UnifiedAnalysis | null
  fibTargets: StockTargetData | null
  timeframe: Timeframe
  onTimeframeChange: (value: Timeframe) => void
}) {
  const metrics = result?.metrics as Record<string, unknown> | undefined
  const chartSeriesByTimeframe = isRecord(metrics?.chart_series_by_timeframe) ? metrics.chart_series_by_timeframe : null
  const chartPayload = chartSeriesByTimeframe?.[timeframe] ?? metrics?.chart_series
  const rawPoints = useMemo(() => parseChartPayload(chartPayload), [chartPayload])
  const points = useMemo(() => {
    if (!rawPoints?.length) return rawPoints
    const last = num(metrics?.last_price)
    if (last == null || last <= 0) return rawPoints
    const next = rawPoints.slice()
    next[next.length - 1] = { ...next[next.length - 1]!, c: last }
    return next
  }, [metrics?.last_price, rawPoints])
  const framework = useMemo(() => buildIndicatorFramework(result, unified, fibTargets), [result, unified, fibTargets])
  const defaultIds = framework.recommendedIds.length
    ? framework.recommendedIds
    : PRESET_DEFINITIONS.find(preset => preset.id === 'swing_core')?.ids || []
  const initialSelection = useMemo(() => loadIndicatorSelection(defaultIds), [])
  const [visibleBars, setVisibleBars] = useState(80)
  const [endIndex, setEndIndex] = useState(0)
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [indicatorOpen, setIndicatorOpen] = useState(false)
  const [indicatorSearch, setIndicatorSearch] = useState('')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [preset, setPreset] = useState<IndicatorPresetId>(initialSelection.preset)
  const [selectedIds, setSelectedIds] = useState<string[]>(initialSelection.ids)
  const [fullScreen, setFullScreen] = useState(false)
  const [crosshair, setCrosshair] = useState<{ x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ pointerId: number; startX: number } | null>(null)
  const availableIds = useMemo(() => new Set(framework.catalog.filter(item => item.available).map(item => item.id)), [framework.catalog])
  const indicatorById = useMemo(() => new Map(framework.catalog.map(item => [item.id, item])), [framework.catalog])
  const activeIds = useMemo(() => new Set(selectedIds.filter(id => availableIds.has(id) || id === 'candles')), [selectedIds, availableIds])
  const activeIndicators = useMemo(() => selectedIds.map(id => indicatorById.get(id)).filter((item): item is ChartIndicator => Boolean(item && item.available)), [selectedIds, indicatorById])
  const visibleOscillators = activeIndicators.filter(item => item.panel === 'oscillator').slice(0, 2)

  useEffect(() => {
    setEndIndex(points?.length || 0)
    setVisibleBars(Math.min(80, Math.max(20, points?.length || 80)))
  }, [points?.length])

  useEffect(() => {
    if (preset === 'engine_recommended' && framework.recommendedIds.length) {
      setSelectedIds(framework.recommendedIds)
    }
  }, [framework.recommendedIds, preset])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(INDICATOR_STORAGE_KEY, JSON.stringify({ preset, ids: selectedIds }))
  }, [preset, selectedIds])

  if (!points?.length) {
    return (
      <div className="flex h-full min-h-[320px] items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-sm text-tertiary dark:border-white/[0.10] dark:bg-slate-900/60">
        Run a swing analysis to load the backend {timeframe.toLowerCase()} chart series.
      </div>
    )
  }

  const width = 1100
  const height = visibleOscillators.length > 1 ? 670 : 620
  const priceTop = 24
  const priceBottom = 410
  const volumeTop = 432
  const volumeBottom = 505
  const macdTop = 535
  const macdBottom = 596
  const safeEnd = Math.min(Math.max(endIndex || points.length, visibleBars), points.length)
  const visibleStartIndex = Math.max(0, safeEnd - visibleBars)
  const visible = points.slice(visibleStartIndex, safeEnd)
  const prices = visible.flatMap(p => [p.c, p.ma20, p.ma50].filter((n): n is number => typeof n === 'number' && Number.isFinite(n)))
  const levelValues = [
    num(getExec(result).breakout),
    num(getExec(result).stop),
    num(getExec(result).target1),
    num(getExec(result).target2),
    fibTargets?.suggested_target1,
    fibTargets?.suggested_target2,
    fibTargets?.suggested_stop_loss,
  ].filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0)
  const lo = Math.min(...prices, ...levelValues)
  const hi = Math.max(...prices, ...levelValues)
  const pad = Math.max((hi - lo) * 0.08, hi * 0.004)
  const minPrice = lo - pad
  const maxPrice = hi + pad
  const priceRange = maxPrice - minPrice || 1
  const maxVol = Math.max(1, ...visible.map(p => p.v || 0))
  const xStep = width / Math.max(1, visible.length)
  const candleWidth = Math.max(3, Math.min(18, xStep * 0.58))
  const yFor = (price: number) => priceBottom - ((price - minPrice) / priceRange) * (priceBottom - priceTop)
  const swingRsiDivs = activeIds.has('rsi_divergence')
    ? swingRsiDivergences(visible.map(p => p.c), visible.map(p => num(p.rsi) ?? NaN))
    : []
  const xFor = (index: number) => index * xStep + xStep * 0.5
  const visibleIndexByDate = new Map(visible.map((point, index) => [swingDateKey(point.d), index]))
  const axisY = height - 22
  const xAxisTicks = (() => {
    if (!visible.length) return []
    const maxTicks = Math.min(7, visible.length)
    const tickStep = Math.max(1, Math.floor((visible.length - 1) / Math.max(1, maxTicks - 1)))
    const tickIndexes = new Set<number>()
    for (let index = 0; index < visible.length; index += tickStep) tickIndexes.add(index)
    tickIndexes.add(visible.length - 1)
    return [...tickIndexes].sort((a, b) => a - b).map(index => ({ index, label: formatSwingAxisTime(visible[index]?.d) })).filter(item => item.label)
  })()
  const linePath = (key: 'c' | 'ma20' | 'ma50') => visible.reduce((path, point, index) => {
    const value = point[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) return path
    const cmd = path ? 'L' : 'M'
    return `${path}${cmd}${xFor(index).toFixed(1)},${yFor(value).toFixed(1)}`
  }, '')
  const exec = getExec(result)
  const lineLevels = [
    { id: 'entry', label: 'Entry', value: activeIds.has('entry') ? num(exec.breakout ?? unified?.entry_price) : null, color: '#8b5cf6' },
    { id: 'stop', label: 'Stop', value: activeIds.has('stop') ? num(exec.stop ?? unified?.stop_price) : null, color: '#ef4444' },
    { id: 'target1', label: 'T1', value: activeIds.has('target1') ? num(exec.target1) : null, color: '#22c55e' },
    { id: 'target2', label: 'T2', value: activeIds.has('target2') ? num(exec.target2) : null, color: '#14b8a6' },
  ].filter((level): level is { id: string; label: string; value: number; color: string } => level.value != null)
  const fibLevels = activeIds.has('fibonacci_retracement') && fibTargets?.fib_retracement_levels?.length
    ? buildFibChartLevels(fibTargets.fib_retracement_levels, false)
    : []
  const fibExtensionLevels = activeIds.has('fibonacci_extension') && fibTargets?.fib_extension_levels?.length
    ? buildFibChartLevels(fibTargets.fib_extension_levels, true)
    : []
  const structurePivots = activeIds.has('structure')
    ? backendStructurePivots(metrics).slice(-5).map(pivot => {
        const index = visibleIndexByDate.get(swingDateKey(pivot.date)) ?? -1
        return index >= 0 && pivot.price != null
          ? { ...pivot, x: xFor(index), y: yFor(pivot.price) }
          : null
      }).filter((pivot): pivot is SwingStructurePivot & { x: number; y: number; price: number } => Boolean(pivot))
    : []
  const structureTone = String((metrics?.market_structure as Record<string, unknown> | undefined)?.bias || '').toLowerCase()
  const structureColor = structureTone.includes('bear') ? '#ef4444' : structureTone.includes('bull') ? '#10b981' : '#f59e0b'
  const patternOverlay = isRecord(chartPayload) && isRecord(chartPayload.pattern_overlay) ? chartPayload.pattern_overlay : null
  const patternSegments = activeIds.has('continuation_pattern') && patternOverlay
    ? (Array.isArray(patternOverlay.segments) ? patternOverlay.segments : []).map(segment => {
        if (!isRecord(segment)) return null
        const from = visibleIndexByDate.get(swingDateKey(text(segment.from)))
        const to = visibleIndexByDate.get(swingDateKey(text(segment.to)))
        const fromPrice = num(segment.fromPrice)
        const toPrice = num(segment.toPrice)
        if (from == null || to == null || fromPrice == null || toPrice == null) return null
        return { role: text(segment.role), fromX: xFor(from), fromY: yFor(fromPrice), toX: xFor(to), toY: yFor(toPrice) }
      }).filter((segment): segment is { role: string; fromX: number; fromY: number; toX: number; toY: number } => Boolean(segment))
    : []
  const nearestIndex = crosshair && visible.length
    ? clamp(Math.round(crosshair.x / Math.max(1, xStep) - 0.5), 0, visible.length - 1)
    : null
  const nearest = nearestIndex == null ? null : visible[nearestIndex]
  const crosshairDetail = nearest && nearestIndex != null
    ? (() => {
        const absoluteIndex = visibleStartIndex + nearestIndex
        const open = num(nearest.o) ?? points[absoluteIndex - 1]?.c ?? nearest.c
        const close = nearest.c
        const rangeHigh = num(nearest.h) ?? Math.max(open, close)
        const rangeLow = num(nearest.l) ?? Math.min(open, close)
        return {
          point: nearest,
          open,
          close,
          rangeHigh,
          rangeLow,
          change: close - open,
          changePct: open ? ((close - open) / open) * 100 : null,
        }
      })()
    : null
  const zoom = (dir: 'in' | 'out') => setVisibleBars(cur => Math.max(20, Math.min(points.length, cur + (dir === 'in' ? -16 : 16))))
  const panByBars = (bars: number) => {
    if (!bars) return
    setEndIndex(cur => Math.max(visibleBars, Math.min(points.length, (cur || points.length) + bars)))
  }
  const pan = (dir: 'left' | 'right') => panByBars(dir === 'left' ? -12 : 12)
  const resetView = () => {
    setVisibleBars(Math.min(80, Math.max(20, points.length)))
    setEndIndex(points.length)
  }
  const selectPreset = (id: IndicatorPresetId) => {
    const ids = id === 'engine_recommended'
      ? framework.recommendedIds
      : PRESET_DEFINITIONS.find(item => item.id === id)?.ids || []
    setPreset(id)
    setSelectedIds(ids.filter(indicatorId => availableIds.has(indicatorId) || indicatorId === 'candles'))
  }
  const toggleIndicator = (id: string) => {
    const item = indicatorById.get(id)
    if (!item?.available) return
    setPreset('swing_core')
    setSelectedIds(cur => cur.includes(id) ? cur.filter(itemId => itemId !== id) : [...cur, id])
  }
  const removeIndicator = (id: string) => {
    setPreset('swing_core')
    setSelectedIds(cur => cur.filter(itemId => itemId !== id))
  }
  const handleMouseMove = (event: MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    setCrosshair({
      x: ((event.clientX - rect.left) / rect.width) * width,
      y: ((event.clientY - rect.top) / rect.height) * height,
    })
  }
  const handleWheel = (event: WheelEvent<SVGSVGElement>) => {
    const horizontalIntent = event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)
    if (horizontalIntent) {
      const wheelMove = event.deltaX || event.deltaY
      const step = Math.max(1, Math.round(visibleBars * 0.08))
      panByBars(Math.sign(wheelMove) * step)
      return
    }
    zoom(event.deltaY < 0 ? 'in' : 'out')
  }
  const handlePointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX }
    setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const rect = event.currentTarget.getBoundingClientRect()
    if (!rect.width) return
    const pixelsPerBar = rect.width / Math.max(1, visibleBars)
    const movedBars = Math.trunc((event.clientX - drag.startX) / Math.max(4, pixelsPerBar))
    if (!movedBars) return
    panByBars(-movedBars)
    dragRef.current = { ...drag, startX: event.clientX }
  }
  const stopDrag = (event: PointerEvent<SVGSVGElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null
      setDragging(false)
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <div className={fullScreen ? 'fixed inset-3 z-50 flex flex-col overflow-hidden rounded-xl bg-white p-4 shadow-2xl dark:bg-slate-950' : 'flex min-h-0 flex-col md:h-full md:overflow-hidden'}>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-1 border-b border-slate-200 px-2 py-1 text-[11px] dark:border-white/[0.08]">
        <div className="flex min-w-0 flex-wrap items-center gap-2 font-semibold text-secondary">
          <span className="text-[10px] font-black uppercase tracking-widest text-tertiary">Chart</span>
          <span className="hidden truncate xl:inline">
            {preset === 'engine_recommended' && framework.recommendedReason ? framework.recommendedReason : `Backend ${timeframe.toLowerCase()} series`}
          </span>
          <span className="font-mono text-[10px] text-tertiary">{visibleBars} bars</span>
        </div>
        <div className="flex items-center gap-1">
          {(['Daily', 'Weekly', 'Monthly'] as Timeframe[]).map(tf => (
            <button
              key={tf}
              type="button"
              onClick={() => onTimeframeChange(tf)}
              className={`rounded-md border px-2 py-0.5 text-[10px] font-black ${timeframe === tf ? 'border-violet-500 bg-violet-500/10 text-violet-700 dark:text-violet-200' : 'border-slate-200 text-secondary hover:bg-slate-50 dark:border-white/[0.08] dark:hover:bg-slate-900'}`}
              title={`${tf} backend series`}
            >
              {tf}
            </button>
          ))}
          <button type="button" onClick={() => zoom('in')} className="rounded-md border border-slate-200 p-1.5 text-secondary dark:border-white/[0.08]" aria-label="Zoom in"><ZoomIn size={15} /></button>
          <button type="button" onClick={() => zoom('out')} className="rounded-md border border-slate-200 p-1.5 text-secondary dark:border-white/[0.08]" aria-label="Zoom out"><ZoomOut size={15} /></button>
          <button type="button" onClick={() => pan('left')} className="rounded-md border border-slate-200 p-1.5 text-secondary dark:border-white/[0.08]" aria-label="Pan left"><ChevronLeft size={15} /></button>
          <button type="button" onClick={() => pan('right')} className="rounded-md border border-slate-200 p-1.5 text-secondary dark:border-white/[0.08]" aria-label="Pan right"><ChevronRight size={15} /></button>
          <button type="button" onClick={() => { setVisibleBars(points.length); setEndIndex(points.length) }} className="rounded-md border border-slate-200 p-1.5 text-secondary dark:border-white/[0.08]" aria-label="Fit chart" title="Fit"><Maximize2 size={15} /></button>
          <button type="button" onClick={resetView} className="rounded-md border border-slate-200 p-1.5 text-secondary dark:border-white/[0.08]" aria-label="Reset chart" title="Reset"><RotateCcw size={15} /></button>
          <div className="relative">
            <button type="button" onClick={() => setIndicatorOpen(cur => !cur)} className="rounded-md border border-slate-200 p-1.5 text-secondary dark:border-white/[0.08]" aria-label="Indicators" title="Indicators"><SlidersHorizontal size={15} /></button>
            {indicatorOpen && (
              <IndicatorDrawer
                framework={framework}
                selectedIds={selectedIds}
                preset={preset}
                search={indicatorSearch}
                detailId={detailId}
                onSearch={setIndicatorSearch}
                onPreset={selectPreset}
                onToggle={toggleIndicator}
                onDetail={setDetailId}
                onClose={() => setIndicatorOpen(false)}
              />
            )}
          </div>
          <div className="relative">
            <button type="button" onClick={() => setOverlayOpen(cur => !cur)} className="rounded-md border border-slate-200 p-1.5 text-secondary dark:border-white/[0.08]" aria-label="Chart overlays" title="Overlays"><Layers size={15} /></button>
            {overlayOpen && (
              <div className="absolute right-0 top-9 z-20 w-52 rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-white/[0.08] dark:bg-slate-950">
                {['fibonacci_retracement', 'fibonacci_extension', 'swing_pivots', 'structure', 'continuation_pattern', 'entry', 'stop', 'target1', 'target2'].map(id => {
                  const item = indicatorById.get(id)
                  return (
                    <label key={id} className={`flex items-center justify-between rounded-lg px-2 py-1.5 text-xs font-bold ${item?.available ? 'cursor-pointer text-secondary hover:bg-slate-50 dark:hover:bg-slate-900' : 'cursor-not-allowed text-tertiary opacity-50'}`}>
                      <span>{item?.name || id}</span>
                      <input type="checkbox" disabled={!item?.available} checked={activeIds.has(id)} onChange={() => toggleIndicator(id)} />
                    </label>
                  )
                })}
              </div>
            )}
          </div>
          <button type="button" onClick={() => setFullScreen(cur => !cur)} className="rounded-md border border-slate-200 p-1.5 text-secondary dark:border-white/[0.08]" aria-label="Full screen chart" title="Full screen"><Maximize2 size={15} /></button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col bg-slate-50 dark:bg-slate-900/60">
        <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 px-2 py-1 text-[11px] dark:border-white/[0.08]">
          <span className="mr-1 text-[10px] font-black uppercase tracking-widest text-tertiary">Active</span>
          {activeIndicators.length ? activeIndicators.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => removeIndicator(item.id)}
              className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-bold ${item.recommended ? 'border-violet-300 bg-violet-500/10 text-violet-700 dark:border-violet-400/30 dark:text-violet-200' : 'border-slate-200 bg-white text-secondary dark:border-white/[0.08] dark:bg-slate-950'}`}
              title={item.mandatory ? 'Engine evidence for the current backend decision. Hiding changes only this visual view, not the backend verdict.' : item.reason || item.name}
            >
              {item.mandatory && <Lock size={10} />}
              {item.name}
              <X size={10} />
            </button>
          )) : <span className="text-[11px] text-tertiary">No optional indicators selected.</span>}
        </div>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className={`${fullScreen ? 'h-[calc(100vh-220px)]' : 'min-h-0 flex-1'} block w-full select-none md:touch-none`}
          role="img"
          aria-label={`Swing trade ${timeframe.toLowerCase()} chart`}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => {
            dragRef.current = null
            setDragging(false)
            setCrosshair(null)
          }}
          style={{ cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none' }}
        >
          <rect x="0" y="0" width={width} height={height} rx="8" fill="transparent" />
          {[0, 1, 2, 3, 4].map(i => {
            const y = priceTop + i * ((priceBottom - priceTop) / 4)
            const price = maxPrice - i * (priceRange / 4)
            return (
              <g key={i}>
                <line x1="0" x2={width} y1={y} y2={y} stroke="currentColor" className="text-slate-200 dark:text-slate-800" strokeDasharray="3 5" />
                <text x={width - 6} y={y - 4} textAnchor="end" className="fill-slate-500 text-[11px] font-mono">${price.toFixed(2)}</text>
              </g>
            )
          })}
          {activeIds.has('volume_profile') && (() => {
            const VP_BINS = 26
            const buckets = new Array<number>(VP_BINS).fill(0)
            visible.forEach(p => {
              const price = num(p.c)
              if (price == null) return
              const bin = Math.max(0, Math.min(VP_BINS - 1, Math.floor(((price - minPrice) / priceRange) * VP_BINS)))
              buckets[bin] += p.v || 0
            })
            const vpMax = Math.max(1, ...buckets)
            return buckets.map((vol, bin) => {
              const yTop = yFor(minPrice + ((bin + 1) / VP_BINS) * priceRange)
              const yBottom = yFor(minPrice + (bin / VP_BINS) * priceRange)
              const w = (vol / vpMax) * 170
              return <rect key={`vp-${bin}`} x="0" y={yTop} width={w} height={Math.max(1, yBottom - yTop - 1)} fill="#2dd4bf" opacity="0.55" rx="1" stroke="#5eead4" strokeWidth="0.5" strokeOpacity="0.5" />
            })
          })()}
          {visible.map((point, index) => {
            const prev = visible[index - 1]?.c ?? point.c
            const up = point.c >= prev
            const x = xFor(index)
            const open = num(point.o) ?? prev
            const high = num(point.h) ?? Math.max(open, point.c)
            const low = num(point.l) ?? Math.min(open, point.c)
            const openY = yFor(open)
            const closeY = yFor(point.c)
            const highY = yFor(high)
            const lowY = yFor(low)
            const bodyTop = Math.min(openY, closeY)
            const bodyHeight = Math.max(2, Math.abs(closeY - openY))
            const volHeight = ((point.v || 0) / maxVol) * (volumeBottom - volumeTop)
            const candleColor = up ? BULLISH_CANDLE_COLOR : BEARISH_CANDLE_COLOR
            return (
              <g key={`${point.d}-${index}`}>
                <line x1={x} x2={x} y1={highY} y2={lowY} stroke={candleColor} strokeWidth="1.5" opacity="0.9" />
                <rect x={x - candleWidth / 2} y={bodyTop} width={candleWidth} height={bodyHeight} rx="1.5" fill={candleColor} opacity="0.9" />
                {activeIds.has('volume') && <rect x={x - candleWidth / 2} y={volumeBottom - volHeight} width={candleWidth} height={volHeight} fill={candleColor} opacity="0.28" />}
              </g>
            )
          })}
          {swingRsiDivs.map((div, k) => {
            const p1 = visible[div.i1]?.c, p2 = visible[div.i2]?.c
            if (p1 == null || p2 == null) return null
            const color = div.kind === 'bear' ? '#f43f5e' : '#10b981'
            return (
              <g key={`rsidiv-${k}`}>
                <line x1={xFor(div.i1)} y1={yFor(p1)} x2={xFor(div.i2)} y2={yFor(p2)} stroke={color} strokeWidth="2" strokeDasharray="4 3" />
                <circle cx={xFor(div.i1)} cy={yFor(p1)} r="3" fill={color} />
                <circle cx={xFor(div.i2)} cy={yFor(p2)} r="3" fill={color} />
                <text x={(xFor(div.i1) + xFor(div.i2)) / 2} y={Math.min(yFor(p1), yFor(p2)) - 6} textAnchor="middle" fill={color} className="text-[9px] font-mono font-bold">{div.kind === 'bear' ? 'Bear Div' : 'Bull Div'}</text>
              </g>
            )
          })}
          {activeIds.has('sma20') && <path d={linePath('ma20')} fill="none" stroke="#34d399" strokeWidth="1.8" opacity="0.72" />}
          {activeIds.has('sma50') && <path d={linePath('ma50')} fill="none" stroke="#fbbf24" strokeWidth="1.8" opacity="0.72" />}
          {activeIds.has('ema9') && num(fibTargets?.ema9) != null && (
            <g>
              <line x1="0" x2={width} y1={yFor(num(fibTargets?.ema9) || 0)} y2={yFor(num(fibTargets?.ema9) || 0)} stroke="#38bdf8" strokeDasharray="5 5" strokeWidth="1.2" opacity="0.72" />
              <text x="12" y={yFor(num(fibTargets?.ema9) || 0) - 5} className="fill-sky-400 text-[10px] font-bold">EMA9 {money(fibTargets?.ema9)}</text>
            </g>
          )}
          {patternOverlay && patternSegments.length > 0 && (() => {
            const bullish = text(patternOverlay.direction).toLowerCase() === 'bullish'
            const color = bullish ? '#10b981' : '#ef4444'
            const status = text(patternOverlay.status) === 'CONFIRMED' ? 'Confirmed' : 'Forming'
            const anchor = patternSegments[patternSegments.length - 1]
            return (
              <g>
                {patternSegments.map((segment, index) => (
                  <line key={`${segment.role}-${index}`} x1={segment.fromX} y1={segment.fromY} x2={segment.toX} y2={segment.toY} stroke={color} strokeWidth={segment.role === 'pole' ? 2.8 : 1.8} strokeDasharray={segment.role === 'pole' ? undefined : '5 4'} opacity={status === 'Confirmed' ? 0.95 : 0.68} />
                ))}
                <rect x={Math.max(8, Math.min(width - 156, anchor.toX + 8))} y={Math.max(priceTop + 4, Math.min(priceBottom - 24, anchor.toY - 30))} width="150" height="20" rx="6" fill="var(--surface-card)" stroke={color} strokeWidth="1" />
                <text x={Math.max(15, Math.min(width - 149, anchor.toX + 15))} y={Math.max(priceTop + 18, Math.min(priceBottom - 10, anchor.toY - 16))} fill={color} className="text-[10px] font-black">{text(patternOverlay.label)} · {status}</text>
              </g>
            )
          })()}
          {[...lineLevels, ...fibLevels, ...fibExtensionLevels].map(level => {
            const y = yFor(level.value)
            return (
              <g key={`${level.label}-${level.value}`}>
                <line x1="0" x2={width} y1={y} y2={y} stroke={level.color} strokeDasharray={level.label.includes('Ext') ? '3 6' : '7 5'} strokeWidth="1.3" opacity="0.72" />
                <rect x={width - 112} y={y - 11} width="106" height="18" rx="5" fill="rgba(15,23,42,0.78)" />
                <text x={width - 60} y={y + 3} textAnchor="middle" fill={level.color} className="text-[10px] font-bold">{level.label} ${level.value.toFixed(2)}</text>
              </g>
            )
          })}
          {activeIds.has('swing_pivots') && fibTargets?.fib_swing_high && fibTargets.fib_swing_low && (
            <g>
              <circle cx={width * 0.22} cy={yFor(fibTargets.fib_swing_high)} r="4" fill="#f59e0b" />
              <text x={width * 0.22 + 8} y={yFor(fibTargets.fib_swing_high) - 6} className="fill-amber-500 text-[10px] font-bold">Swing High</text>
              <circle cx={width * 0.42} cy={yFor(fibTargets.fib_swing_low)} r="4" fill="#f59e0b" />
              <text x={width * 0.42 + 8} y={yFor(fibTargets.fib_swing_low) + 12} className="fill-amber-500 text-[10px] font-bold">Swing Low</text>
            </g>
          )}
          {structurePivots.length > 0 && (
            <g>
              <polyline
                points={structurePivots.map(pivot => `${pivot.x.toFixed(1)},${pivot.y.toFixed(1)}`).join(' ')}
                fill="none"
                stroke={structureColor}
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.9"
              />
              {structurePivots.map((pivot, index) => {
                const label = pivot.label || 'Pivot'
                const provisional = pivot.status === 'PROVISIONAL' || pivot.confirmed === false || label.endsWith('?')
                const labelWidth = label.length > 2 ? 54 : 32
                const yOffset = label.includes('H') ? -18 : 18
                const chipY = Math.max(8, Math.min(priceBottom - 26, pivot.y + yOffset))
                return (
                  <g key={`${pivot.date}-${label}-${index}`}>
                    <circle cx={pivot.x} cy={pivot.y} r="4.2" fill={provisional ? 'transparent' : structureColor} stroke={structureColor} strokeWidth={provisional ? '2' : '1.5'} strokeDasharray={provisional ? '2 2' : undefined} />
                    <rect x={pivot.x - labelWidth / 2} y={chipY - 9} width={labelWidth} height="18" rx="6" fill="var(--surface-card)" stroke={structureColor} strokeWidth="1" strokeDasharray={provisional ? '2 2' : undefined} />
                    <text x={pivot.x} y={chipY + 4} textAnchor="middle" fill={structureColor} className="text-[10px] font-black">
                      {index === structurePivots.length - 1 ? `Current ${label}` : label}
                    </text>
                    <text x={pivot.x} y={chipY + (label.includes('H') ? -10 : 17)} textAnchor="middle" fill="var(--text-tertiary)" className="text-[9px] font-mono">
                      ${pivot.price.toFixed(2)}
                    </text>
                  </g>
                )
              })}
            </g>
          )}
          {crosshair && (
            <g>
              <line x1={crosshair.x} x2={crosshair.x} y1="0" y2={height} stroke="#94a3b8" strokeDasharray="3 4" opacity="0.45" />
              <line x1="0" x2={width} y1={crosshair.y} y2={crosshair.y} stroke="#94a3b8" strokeDasharray="3 4" opacity="0.25" />
              {crosshairDetail && (
                <g transform={`translate(${clamp(crosshair.x + 14, 8, width - 186)}, ${clamp(crosshair.y + 14, 8, height - 158)})`}>
                  <rect width="178" height="150" rx="8" fill="var(--chart-tooltip-bg)" stroke="var(--chart-tooltip-border)" strokeWidth="1" />
                  <text x="10" y="18" fill="var(--text-heading)" className="text-[11px] font-bold">
                    Date: {formatSwingAxisTime(crosshairDetail.point.d)}
                  </text>
                  <text x="10" y="36" fill="var(--text-secondary)" className="text-[11px]">Open: {money(crosshairDetail.open)}</text>
                  <text x="10" y="52" fill="var(--text-secondary)" className="text-[11px]">High: {money(crosshairDetail.rangeHigh)}</text>
                  <text x="10" y="68" fill="var(--text-secondary)" className="text-[11px]">Low: {money(crosshairDetail.rangeLow)}</text>
                  <text x="10" y="84" fill="var(--text-secondary)" className="text-[11px]">Close: {money(crosshairDetail.close)}</text>
                  <text x="10" y="100" fill={crosshairDetail.change >= 0 ? BULLISH_CANDLE_COLOR : BEARISH_CANDLE_COLOR} className="text-[11px] font-bold">
                    Move: {signedMoney(crosshairDetail.change)}
                    {crosshairDetail.changePct == null ? '' : ` (${crosshairDetail.changePct >= 0 ? '+' : ''}${crosshairDetail.changePct.toFixed(2)}%)`}
                  </text>
                  <text x="10" y="116" fill="var(--text-tertiary)" className="text-[10px]">Vol: {formatSwingVolume(crosshairDetail.point.v)}</text>
                  <text x="10" y="132" fill="var(--text-tertiary)" className="text-[10px]">MA20: {money(crosshairDetail.point.ma20)} · MA50: {money(crosshairDetail.point.ma50)}</text>
                  <text x="10" y="144" fill="var(--text-faint)" className="text-[9px]">Daily series uses backend close data</text>
                </g>
              )}
            </g>
          )}
          <line x1="0" x2={width} y1={volumeTop - 10} y2={volumeTop - 10} stroke="currentColor" className="text-slate-200 dark:text-slate-800" />
          <text x="10" y={volumeTop - 18} className="fill-slate-500 text-[10px] font-black uppercase tracking-widest">Volume</text>
          {visibleOscillators.map((indicator, panelIndex) => (
            <OscillatorPanel
              key={indicator.id}
              id={indicator.id}
              top={macdTop + panelIndex * 42}
              bottom={panelIndex === 0 ? macdBottom : macdBottom + 42}
              width={width}
              visible={visible}
              metrics={metrics}
              xFor={xFor}
            />
          ))}
          <g>
            <line x1="0" x2={width} y1={axisY - 10} y2={axisY - 10} stroke="currentColor" className="text-slate-200 dark:text-slate-800" />
            {xAxisTicks.map(tick => {
              const x = xFor(tick.index)
              return (
                <g key={`${tick.index}-${tick.label}`}>
                  <line x1={x} x2={x} y1={axisY - 15} y2={axisY - 8} stroke="currentColor" className="text-slate-300 dark:text-slate-700" />
                  <text x={x} y={axisY + 6} textAnchor="middle" className="fill-slate-500 text-[10px] font-mono">
                    {tick.label}
                  </text>
                </g>
              )
            })}
          </g>
        </svg>
      </div>
      <div className="mt-2 flex shrink-0 flex-wrap items-center justify-between gap-2 text-[11px] text-tertiary">
        <div className="flex flex-wrap gap-2">
          <span className="font-mono">{visible[0]?.d} → {visible[visible.length - 1]?.d}</span>
          <span>{visible.length} {timeframe.toLowerCase()} bars</span>
          <span>{preset === 'engine_recommended' ? 'Engine Recommended' : 'User Selected'} indicators</span>
        </div>
        {nearest && (
          <div className="rounded-full border border-slate-200 px-2 py-0.5 font-mono text-secondary dark:border-white/[0.08]">
            {nearest.d} · Close ${nearest.c.toFixed(2)} · MA20 {nearest.ma20 == null ? '—' : `$${nearest.ma20.toFixed(2)}`}
          </div>
        )}
      </div>
      <ChartUnderlay result={result} unified={unified} fibTargets={fibTargets} nearestDate={nearest?.d || null} />
    </div>
  )
}

function moneyless(value: unknown): string {
  const n = num(value)
  return n == null ? '—' : n.toFixed(3)
}

function buildFibChartLevels(
  levels: Array<{ level: string; price: number }>,
  extension: boolean,
): Array<{ label: string; value: number; color: string }> {
  const primary = new Set(['23.6%', '38.2%', '50%', '61.8%', '78.6%'])
  return levels
    .filter(level => typeof level.price === 'number' && Number.isFinite(level.price))
    .map(level => ({
      label: `${extension ? 'Ext ' : 'Fib '}${level.level}`,
      value: level.price,
      color: extension ? '#14b8a6' : primary.has(level.level) ? '#f59e0b' : '#94a3b8',
    }))
}

function IndicatorDrawer({
  framework,
  selectedIds,
  preset,
  search,
  detailId,
  onSearch,
  onPreset,
  onToggle,
  onDetail,
  onClose,
}: {
  framework: IndicatorFramework
  selectedIds: string[]
  preset: IndicatorPresetId
  search: string
  detailId: string | null
  onSearch: (value: string) => void
  onPreset: (value: IndicatorPresetId) => void
  onToggle: (id: string) => void
  onDetail: (id: string | null) => void
  onClose: () => void
}) {
  const selected = new Set(selectedIds)
  const q = search.trim().toLowerCase()
  const detail = framework.catalog.find(item => item.id === detailId) || null
  const filtered = framework.catalog.filter(item => {
    if (!q) return true
    return `${item.name} ${item.category} ${item.parameters ? JSON.stringify(item.parameters) : ''}`.toLowerCase().includes(q)
  })
  return (
    <div className="absolute right-0 top-9 z-30 w-[360px] max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-white/[0.08] dark:bg-slate-950">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 dark:border-white/[0.08]">
        <div>
          <div className="text-xs font-black uppercase tracking-widest text-heading">Indicators</div>
          <div className="text-[10px] text-tertiary">{preset === 'engine_recommended' ? 'Engine Recommended' : 'User Selected'} · backend-rendered values only</div>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg p-1 text-tertiary hover:bg-slate-100 dark:hover:bg-slate-900" aria-label="Close indicators"><X size={15} /></button>
      </div>
      <div className="space-y-2 p-3">
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 dark:border-white/[0.08] dark:bg-slate-900">
          <Search size={14} className="text-tertiary" />
          <input
            value={search}
            onChange={event => onSearch(event.target.value)}
            placeholder="Search indicators"
            className="min-w-0 flex-1 bg-transparent text-xs font-semibold text-heading outline-none placeholder:text-tertiary"
          />
        </div>
        <div className="grid grid-cols-2 gap-1">
          {PRESET_DEFINITIONS.map(item => (
            <button
              key={item.id}
              type="button"
              disabled={item.id === 'engine_recommended' && !framework.recommendedIds.length}
              onClick={() => onPreset(item.id)}
              className={`rounded-lg border px-2 py-1.5 text-[10px] font-black ${preset === item.id ? 'border-violet-500 bg-violet-500/10 text-violet-700 dark:text-violet-200' : 'border-slate-200 text-secondary dark:border-white/[0.08]'} disabled:cursor-not-allowed disabled:opacity-45`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="max-h-[380px] space-y-3 overflow-auto pr-1">
          {(Object.keys(INDICATOR_GROUP_LABELS) as IndicatorCategory[]).map(category => {
            const items = filtered.filter(item => item.category === category)
            if (!items.length) return null
            return (
              <div key={category}>
                <div className="mb-1 text-[10px] font-black uppercase tracking-widest text-tertiary">{INDICATOR_GROUP_LABELS[category]}</div>
                <div className="space-y-1">
                  {items.map(item => (
                    <div key={item.id} className={`rounded-lg border px-2 py-1.5 ${item.available ? 'border-slate-200 bg-white dark:border-white/[0.08] dark:bg-slate-950' : 'border-slate-200 bg-slate-50 opacity-60 dark:border-white/[0.06] dark:bg-slate-900'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <label className={`flex min-w-0 flex-1 items-center gap-2 text-xs font-bold ${item.available ? 'cursor-pointer text-secondary' : 'cursor-not-allowed text-tertiary'}`}>
                          <input type="checkbox" checked={selected.has(item.id)} disabled={!item.available} onChange={() => onToggle(item.id)} />
                          <span className="truncate">{item.name}</span>
                          {item.recommended && <span className="rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[9px] font-black uppercase text-violet-700 dark:text-violet-200">Engine</span>}
                          {item.mandatory && <Lock size={11} className="text-tertiary" />}
                        </label>
                        <button type="button" onClick={() => onDetail(detailId === item.id ? null : item.id)} className="rounded-md p-1 text-tertiary hover:bg-slate-100 dark:hover:bg-slate-900" aria-label={`${item.name} details`}>
                          <Info size={13} />
                        </button>
                      </div>
                      {!item.available && <div className="mt-1 text-[10px] text-tertiary">{item.unavailableReason}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
        {detail && <IndicatorDetails indicator={detail} />}
      </div>
    </div>
  )
}

function IndicatorDetails({ indicator }: { indicator: ChartIndicator }) {
  return (
    <div className="rounded-lg border border-violet-300/60 bg-violet-500/10 p-2 dark:border-violet-400/30">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="text-xs font-black text-heading">{indicator.name}</div>
        <div className="text-[10px] font-bold uppercase text-tertiary">{indicator.panel}</div>
      </div>
      <div className="grid gap-1 text-[11px] text-secondary">
        <SmallValue label="Parameters" value={indicator.parameters ? JSON.stringify(indicator.parameters) : '—'} />
        <SmallValue label="Timeframe" value="Daily" />
        <SmallValue label="Current" value={indicator.currentValue || '—'} />
        <SmallValue label="Formula" value={indicator.formula || indicator.unavailableReason || '—'} />
        <SmallValue label="Inputs" value={indicator.inputs || '—'} />
        <SmallValue label="Interpretation" value={indicator.interpretation || indicator.unavailableReason || '—'} />
        <SmallValue label="Why it matters" value={indicator.reason || indicator.interpretation || indicator.unavailableReason || '—'} />
        <SmallValue label="Data timestamp" value={indicator.timestamp || '—'} />
        <SmallValue label="Source" value={indicator.source || '—'} />
      </div>
    </div>
  )
}

function OscillatorPanel({
  id,
  top,
  bottom,
  width,
  visible,
  metrics,
  xFor,
}: {
  id: string
  top: number
  bottom: number
  width: number
  visible: SwingChartPoint[]
  metrics: Record<string, unknown> | undefined
  xFor: (index: number) => number
}) {
  if (id === 'rsi14') {
    const values = visible.map(point => num(point.rsi)).filter((value): value is number => value != null)
    if (!values.length) return null
    const yForRsi = (value: number) => bottom - (Math.max(0, Math.min(100, value)) / 100) * (bottom - top)
    const path = visible.reduce((acc, point, index) => {
      const value = num(point.rsi)
      if (value == null) return acc
      return `${acc}${acc ? 'L' : 'M'}${xFor(index).toFixed(1)},${yForRsi(value).toFixed(1)}`
    }, '')
    return (
      <g>
        <line x1="0" x2={width} y1={top - 12} y2={top - 12} stroke="currentColor" className="text-slate-200 dark:text-slate-800" />
        <text x="10" y={top - 20} className="fill-slate-500 text-[10px] font-black uppercase tracking-widest">RSI 14</text>
        <line x1="0" x2={width} y1={yForRsi(70)} y2={yForRsi(70)} stroke="#f59e0b" strokeDasharray="4 4" opacity="0.45" />
        <line x1="0" x2={width} y1={yForRsi(30)} y2={yForRsi(30)} stroke="#38bdf8" strokeDasharray="4 4" opacity="0.45" />
        <path d={path} fill="none" stroke="#38bdf8" strokeWidth="1.5" opacity="0.8" />
      </g>
    )
  }
  if (id === 'macd') {
    const mid = (top + bottom) / 2
    const hist = num(metrics?.macd_histogram)
    return (
      <g>
        <line x1="0" x2={width} y1={top - 12} y2={top - 12} stroke="currentColor" className="text-slate-200 dark:text-slate-800" />
        <text x="10" y={top - 20} className="fill-slate-500 text-[10px] font-black uppercase tracking-widest">MACD</text>
        <text x="72" y={top - 20} className="fill-slate-500 text-[10px]">MACD {moneyless(metrics?.macd)} · Signal {moneyless(metrics?.macd_signal)} · Hist {moneyless(metrics?.macd_histogram)}</text>
        <line x1="0" x2={width} y1={mid} y2={mid} stroke="#475569" strokeDasharray="4 4" opacity="0.5" />
        {hist != null && <rect x="18" y={hist >= 0 ? mid - 22 : mid} width="18" height="22" fill={hist >= 0 ? '#22c55e' : '#ef4444'} opacity="0.7" />}
      </g>
    )
  }
  return null
}

function ChartUnderlay({
  result,
  unified,
  fibTargets,
  nearestDate,
}: {
  result: SwingTradeScanResult | null
  unified: UnifiedAnalysis | null
  fibTargets: StockTargetData | null
  nearestDate: string | null
}) {
  const metrics = result?.metrics as Record<string, unknown> | undefined
  const exec = getExec(result)
  const spread = getSpread(result, unified)
  return (
    <div className="mt-3 grid gap-2 lg:grid-cols-4">
      <MiniChartPanel title="Focused Bar">
        <div className="font-mono text-sm font-black text-heading">{nearestDate || text(metrics?.session_date) || '—'}</div>
        <div className="mt-1 text-[11px] text-tertiary">Crosshair date and latest backend session context.</div>
      </MiniChartPanel>
      <MiniChartPanel title="Fib Context">
        <div className="grid grid-cols-2 gap-2">
          <SmallValue label="High" value={money(fibTargets?.fib_swing_high)} />
          <SmallValue label="Low" value={money(fibTargets?.fib_swing_low)} />
        </div>
        <div className="mt-1 text-[11px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-300">
          {compactLabel(fibTargets?.fib_direction || 'No backend fib swing')}
        </div>
      </MiniChartPanel>
      <MiniChartPanel title="Trade Levels">
        <div className="grid grid-cols-3 gap-1.5">
          <SmallValue label="Entry" value={money(exec.breakout ?? unified?.entry_price)} />
          <SmallValue label="Stop" value={money(exec.stop ?? unified?.stop_price)} />
          <SmallValue label="T1" value={money(exec.target1)} />
        </div>
      </MiniChartPanel>
      <MiniChartPanel title="Options Snapshot">
        <div className="grid grid-cols-3 gap-1.5">
          <SmallValue label="Debit" value={money(spread.est_debit)} />
          <SmallValue label="Gain" value={money(spread.max_gain)} />
          <SmallValue label="Loss" value={money(spread.max_loss)} />
        </div>
      </MiniChartPanel>
    </div>
  )
}

function MiniChartPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-[86px] rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/[0.07] dark:bg-slate-950">
      <div className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-tertiary">{title}</div>
      {children}
    </div>
  )
}

function SmallValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] font-bold uppercase tracking-wide text-tertiary">{label}</div>
      <div className="truncate font-mono text-xs font-black text-heading">{value}</div>
    </div>
  )
}

function SwingSectionsDrawer({
  open,
  onClose,
  activeTab,
  setActiveTab,
  result,
  unified,
  fibTargets,
  ocKey,
  onOpenAlert,
  onSaveJournal,
}: {
  open: boolean
  onClose: () => void
  activeTab: WorkstationTab
  setActiveTab: (tab: WorkstationTab) => void
  result: SwingTradeScanResult | null
  unified: UnifiedAnalysis | null
  fibTargets: StockTargetData | null
  ocKey: number
  onOpenAlert: () => void
  onSaveJournal: () => void
}) {
  return (
    <div className={`fixed inset-0 z-40 ${open ? '' : 'pointer-events-none'}`} aria-hidden={!open}>
      <div className={`absolute inset-0 bg-slate-950/35 transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`} onClick={onClose} />
      <section
        className={`absolute right-0 top-0 flex h-full w-full max-w-[560px] transform flex-col border-l border-slate-200 bg-white shadow-2xl transition-transform dark:border-white/[0.08] dark:bg-slate-950 sm:w-[88vw] ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Swing Trade sections"
      >
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 p-4 dark:border-white/[0.08]">
        <div>
          <div className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-tertiary">
            <LayoutList size={14} />
            Workspace Sections
          </div>
          <div className="mt-1 text-lg font-black text-heading">{result?.ticker || 'Swing'} Details</div>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg p-2 text-secondary hover:bg-slate-100 dark:hover:bg-slate-900" aria-label="Close swing sections">
          <X size={18} />
        </button>
      </div>
      <div className="shrink-0 overflow-x-auto border-b border-slate-200 px-4 py-3 dark:border-white/[0.08]">
        <div className="flex min-w-max gap-2">
          {TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-black transition ${
                activeTab === tab.id
                  ? 'border-violet-500 bg-violet-500/10 text-violet-700 dark:text-violet-200'
                  : 'border-slate-200 text-secondary hover:border-violet-400 dark:border-white/[0.08]'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {activeTab === 'overview' && <OverviewTab result={result} unified={unified} fibTargets={fibTargets} />}
        {activeTab === 'fibonacci' && <FibonacciTab result={result} fibTargets={fibTargets} />}
        {activeTab === 'options' && <OptionsTab result={result} ocKey={ocKey} />}
        {activeTab === 'exit' && <ExitTab result={result} unified={unified} />}
        {activeTab === 'evidence' && <EvidenceTab result={result} unified={unified} />}
        {activeTab === 'journal' && <JournalTab result={result} onSaveJournal={onSaveJournal} />}
        {activeTab === 'alerts' && <AlertsTab result={result} onOpenAlert={onOpenAlert} />}
      </div>
      </section>
    </div>
  )
}

function OverviewTab({ result, unified, fibTargets }: { result: SwingTradeScanResult | null; unified: UnifiedAnalysis | null; fibTargets: StockTargetData | null }) {
  const metrics = result?.metrics as Record<string, unknown> | undefined
  const exec = getExec(result)
  const macdPoints = useMemo(() => parseChartPayload(metrics?.chart_series), [metrics?.chart_series])
  const canDrawMacd = (macdPoints?.length || 0) >= 38
  return (
    <div className="grid gap-3">
      <SectionHero
        eyebrow="Backend Overview"
        title={result?.decision_label || result?.final_action || 'Run swing analysis'}
        body={unified?.coach || result?.decision_message || result?.reason || 'Backend guidance will appear here after analysis.'}
        tone={result?.bias || result?.market_bias}
        badge={result?.ticker || 'Swing'}
      />
      <div className="grid gap-3 md:grid-cols-2">
        <InfoPanel title="Market Snapshot">
          <div className="grid gap-2 sm:grid-cols-2">
            <Value label="Session" value={compactLabel(text(metrics?.session_date) || unified?.session)} />
            <Value label="Market" value={compactLabel(result?.market_bias || text(metrics?.market_context) || unified?.regime)} />
            <Value label="Volume" value={num(metrics?.volume_ratio) == null ? compactLabel(text(metrics?.volume_label)) : `${num(metrics?.volume_ratio)?.toFixed(2)}x · ${compactLabel(text(metrics?.volume_label))}`} />
            <Value label="Bias" value={compactLabel(result?.bias)} />
          </div>
        </InfoPanel>
        <InfoPanel title="Trade Levels">
          <div className="grid gap-2 sm:grid-cols-2">
            <Value label="Entry" value={money(exec.entry)} />
            <Value label="Stop" value={money(exec.stop ?? fibTargets?.suggested_stop_loss)} />
            <Value label="Target 1" value={money(exec.target1 ?? fibTargets?.suggested_target1)} />
            <Value label="Target 2" value={money(exec.target2 ?? fibTargets?.suggested_target2)} />
          </div>
        </InfoPanel>
      </div>
      <InfoPanel title="Fib / Levels">
        <div className="grid gap-2 sm:grid-cols-2">
          <Value label="Fib Zone" value={fibTargets?.fib_current_zone || 'Backend fib zone not returned'} muted={!fibTargets?.fib_current_zone} />
          <Value label="Classification" value={fibTargets?.fib_classification || 'Backend classification not returned'} muted={!fibTargets?.fib_classification} />
        </div>
      </InfoPanel>
      <InfoPanel title="MACD Diagram">
        {metrics && canDrawMacd ? (
          <MacdHistogramChart metrics={metrics} />
        ) : (
          <EmptyTab text="Backend chart history needs more bars to draw the MACD diagram." />
        )}
      </InfoPanel>
    </div>
  )
}

function FibonacciTab({ result, fibTargets }: { result: SwingTradeScanResult | null; fibTargets: StockTargetData | null }) {
  const metrics = result?.metrics as Record<string, unknown> | undefined
  const exec = getExec(result)
  const retracementLevels = [...(fibTargets?.fib_retracement_levels || [])].sort((a, b) => (num(a.ratio) ?? 0) - (num(b.ratio) ?? 0))
  if (!result) return <EmptyTab text="Run analysis to load Fibonacci context." />
  return (
    <div className="grid gap-3">
      <InfoPanel title="Fibonacci Map">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Value label="Swing High" value={money(fibTargets?.fib_swing_high)} />
          <Value label="Swing Low" value={money(fibTargets?.fib_swing_low)} />
          <Value label="Direction" value={compactLabel(fibTargets?.fib_direction || '—')} />
          <Value label="Current Price" value={money(fibTargets?.current_price ?? metrics?.last_price)} />
        </div>
        <div className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-200">Current Fib Read</div>
              <div className="mt-1 text-base font-semibold leading-snug text-heading">{fibTargets?.fib_classification || 'Backend classification not returned'}</div>
              <div className="mt-1 text-xs leading-relaxed text-secondary">
                {fibTargets?.fib_nearest_confluence || result.playbook_hint || 'No backend confluence summary returned.'}
              </div>
            </div>
            <div className="w-fit rounded-full border border-amber-500/30 bg-white/70 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:bg-slate-950/40 dark:text-amber-200">
              {fibTargets?.fib_current_zone || 'Zone unavailable'}
            </div>
          </div>
        </div>
        <div className="mt-4 grid gap-2">
          {retracementLevels.map(level => {
            const percent = fibLevelPercent(level)
            const decision = fibLevelDecision(level)
            return (
              <div key={level.level} className={`rounded-lg border p-3 ${decision.classes}`}>
                <div className="grid gap-3 md:grid-cols-[104px_minmax(0,1fr)_112px] md:items-center">
                  <div className="flex items-end gap-2 md:block">
                    <div className="font-mono text-3xl font-semibold leading-none tabular-nums">{percent.primary}</div>
                    <div className="pb-0.5 font-mono text-[10px] font-bold uppercase tracking-wide opacity-70 md:pb-0 md:pt-1">{percent.exact}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-semibold text-heading">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${decision.dot}`} />
                      <span className="truncate">{decision.title}</span>
                    </div>
                    <div className="mt-1 max-w-2xl text-xs leading-relaxed text-secondary">{decision.detail}</div>
                  </div>
                  <div className="rounded-md bg-white/70 px-2.5 py-1.5 font-mono text-sm font-semibold tabular-nums text-heading dark:bg-slate-950/35 md:text-right">
                    {money(level.price)}
                  </div>
                </div>
              </div>
            )
          })}
          {!retracementLevels.length && <Value label="Levels" value="Backend levels not returned" muted />}
        </div>
      </InfoPanel>
      <div className="grid gap-3 lg:grid-cols-2">
        <InfoPanel title="Confluence">
          <div className="grid gap-2 sm:grid-cols-2">
            <Value label="EMA9" value={money(fibTargets?.ema9)} />
            <Value label="EMA9 Slope" value={compactLabel(fibTargets?.ema9_slope || '—')} />
            <Value label="Price vs EMA9" value={compactLabel(fibTargets?.price_vs_ema9 || '—')} />
            <Value label="MA20" value={money(fibTargets?.ma20 ?? metrics?.ma20)} />
            <Value label="MA50" value={money(fibTargets?.ma50 ?? metrics?.ma50)} />
          </div>
        </InfoPanel>
        <InfoPanel title="Backend Hint">
          <p className="text-sm leading-relaxed text-secondary">{result.playbook_hint || result.decision_message || 'No backend Fibonacci hint returned.'}</p>
        </InfoPanel>
        <InfoPanel title="Extensions">
          <div className="grid gap-2 sm:grid-cols-2">
            {(fibTargets?.fib_extension_levels || []).map(level => (
              <Value key={level.level} label={level.level} value={money(level.price)} />
            ))}
            {!fibTargets?.fib_extension_levels?.length && <Value label="Extensions" value="Backend extensions not returned" muted />}
          </div>
        </InfoPanel>
        <InfoPanel title="Dates">
          <div className="grid gap-2 sm:grid-cols-2">
            <Value label="High Date" value={fibTargets?.fib_swing_high_date || '—'} />
            <Value label="Low Date" value={fibTargets?.fib_swing_low_date || '—'} />
          </div>
        </InfoPanel>
      </div>
    </div>
  )
}

function OptionsTab({ result, ocKey }: { result: SwingTradeScanResult | null; ocKey: number }) {
  if (!result) return <EmptyTab text="Run analysis to load options workflow." />
  const metrics = result.metrics as Record<string, unknown>
  const exec = getExec(result)
  const stop = num(exec.stop) ?? num(metrics.last_price) ?? 0
  const direction = result.bias === 'short' ? 'SHORT' : 'LONG'
  const finalAction = String(result.final_action || result.decision_label || '').toUpperCase()
  const chartTrigger: 'GO' | 'WAIT' | 'WATCHING' = /^(STRONG_?GO|GO)$/.test(finalAction) ? 'GO' : /^(WATCH|READY)/.test(finalAction) ? 'WATCHING' : 'WAIT'
  return (
    <Suspense fallback={<div className="rounded-lg border border-slate-200 px-3 py-3 text-sm text-tertiary dark:border-white/[0.08]">Loading options tab...</div>}>
      <OptionsEntryCheck
        key={ocKey}
        ticker={result.ticker}
        direction={direction}
        stopPrice={stop}
        chartTrigger={chartTrigger}
        flipCondition={result.decision_message || 'Wait for backend confirmation before entry.'}
        pcAlignment="neutral"
        initialPrice={num(metrics.last_price) || 0}
        isDark
      />
    </Suspense>
  )
}

function ExitTab({ result, unified }: { result: SwingTradeScanResult | null; unified: UnifiedAnalysis | null }) {
  const exitRows = unified?.exit_rows || []
  const backendRules = (result?.metrics as Record<string, unknown> | undefined)?.exit_rules
  const unifiedRows = exitRows.map(row => ({
    when: row.when,
    price: row.price,
    action: row.action,
    note: row.note,
    type: '',
  }))
  const ruleRows = Array.isArray(backendRules)
    ? backendRules.filter(isRecord).map(rule => ({
        when: text(rule.trigger) || 'Exit condition',
        price: num(rule.price),
        action: text(rule.action) || 'Review position',
        note: text(rule.note),
        type: text(rule.type).toLowerCase(),
      }))
    : []
  const displayRows = unifiedRows.length ? unifiedRows : ruleRows
  return (
    <div className="grid gap-3">
      <SectionHero
        eyebrow="Exit Plan"
        title={displayRows.length ? `${displayRows.length} managed exit step${displayRows.length === 1 ? '' : 's'}` : 'Exit plan unavailable'}
        body={result?.decision_message || 'Use backend exit rows for the active swing plan.'}
        tone={result?.bias}
        badge={result?.ticker || 'Swing'}
      />
      <InfoPanel title="Exit Steps">
      {displayRows.length ? (
        <div className="grid gap-2">
          {displayRows.map((row, index) => {
            const isStop = row.type === 'stop' || /stop|exit full|close/i.test(row.when)
            const isTarget = row.type === 't1' || row.type === 't2' || /target/i.test(row.when)
            const tone = isStop
              ? 'border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-200'
              : isTarget
                ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
                : 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-200'
            return (
            <div key={`${row.when}-${index}`} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-white/[0.08] dark:bg-slate-950">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] font-black uppercase tracking-widest text-tertiary">{isStop ? 'Risk Control' : isTarget ? 'Profit Plan' : `Step ${index + 1}`}</div>
                  <div className="mt-1 text-sm font-semibold text-heading">{row.when}</div>
                </div>
                <div className="rounded-md bg-slate-50 px-2.5 py-1.5 font-mono text-sm font-semibold tabular-nums text-heading dark:bg-slate-900">
                  {typeof row.price === 'number' ? money(row.price) : row.price || '—'}
                </div>
              </div>
              <div className="mt-2 text-sm leading-relaxed text-secondary">{row.action}</div>
              {row.note && <div className={`mt-2 rounded-md border px-2.5 py-1.5 text-xs ${tone}`}>{row.note}</div>}
            </div>
            )
          })}
        </div>
      ) : (
        <EmptyTab text="No backend exit steps are available for this swing snapshot." />
      )}
      </InfoPanel>
    </div>
  )
}

function EvidenceTab({ result, unified }: { result: SwingTradeScanResult | null; unified: UnifiedAnalysis | null }) {
  const reasons = result?.reasons || []
  const conditions = unified?.conditions || []
  const passCount = conditions.filter(condition => condition.type === 'pass').length
  const warnCount = conditions.filter(condition => condition.type === 'warn').length
  const failCount = conditions.filter(condition => condition.type === 'fail').length
  const evidenceToneClass = (type: 'pass' | 'warn' | 'fail') => (
    type === 'pass'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
      : type === 'fail'
        ? 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-200'
        : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200'
  )
  return (
    <div className="grid gap-2.5">
      <SectionHero
        eyebrow="Evidence"
        title={conditions.length ? `${conditions.length} conditions checked` : 'Backend evidence'}
        body={result?.reason || result?.decision_message || 'Evidence from the swing engine appears here.'}
        tone={result?.bias}
        badge={result?.ticker || 'Swing'}
      />
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2">
          <div className="text-[10px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-200">Pass</div>
          <div className="font-mono text-xl font-semibold tabular-nums text-heading">{passCount}</div>
        </div>
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2">
          <div className="text-[10px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-200">Watch</div>
          <div className="font-mono text-xl font-semibold tabular-nums text-heading">{warnCount}</div>
        </div>
        <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2">
          <div className="text-[10px] font-black uppercase tracking-widest text-rose-700 dark:text-rose-200">Fail</div>
          <div className="font-mono text-xl font-semibold tabular-nums text-heading">{failCount}</div>
        </div>
      </div>
      <InfoPanel title="Condition Check">
        {conditions.length ? (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-white/[0.08] dark:bg-slate-950">
            {conditions.map((condition, index) => (
              <div key={`${condition.label}-${index}`} className="grid grid-cols-[minmax(0,1fr)_72px] items-center gap-2 border-b border-slate-100 px-3 py-2 last:border-b-0 dark:border-white/[0.06]">
                <div className="min-w-0 truncate text-sm font-semibold text-heading">{condition.label}</div>
                <span className={`justify-self-end rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${evidenceToneClass(condition.type)}`}>
                  {condition.type}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyTab text="No unified condition payload returned." />
        )}
      </InfoPanel>
      <InfoPanel title="Backend Reasons">
        {reasons.length ? (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-white/[0.08] dark:bg-slate-950">
            {reasons.slice(0, 10).map((reason, index) => (
              <div key={index} className="grid gap-2 border-b border-slate-100 px-3 py-2 last:border-b-0 dark:border-white/[0.06] sm:grid-cols-[72px_minmax(0,1fr)]">
                <div className="font-mono text-[10px] font-black uppercase tracking-wide text-tertiary">#{index + 1}</div>
                <div className="min-w-0 text-sm leading-snug text-secondary">{reason}</div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyTab text="No backend reasons returned." />
        )}
      </InfoPanel>
      {reasons.length > 10 && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-tertiary dark:border-white/[0.08] dark:bg-slate-900/60">
          Showing first 10 backend reasons from {reasons.length} returned items.
        </div>
      )}
      </div>
  )
}

function JournalTab({ result, onSaveJournal }: { result: SwingTradeScanResult | null; onSaveJournal: () => void }) {
  return (
    <div className="grid gap-3">
      <SectionHero
        eyebrow="Journal"
        title={result ? `${result.ticker} swing plan` : 'No active swing plan'}
        body="Saving uses the backend journal API and the backend-returned plan fields."
        tone={result?.bias}
        badge="Review"
      />
      <InfoPanel title="Save Plan">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Value label="Ticker" value={result?.ticker || '—'} />
            <Value label="Decision" value={result?.decision_label || result?.final_action || '—'} />
          </div>
        <button type="button" disabled={!result} onClick={onSaveJournal} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-black text-white hover:bg-violet-500 disabled:opacity-50">
          Save to Journal
        </button>
      </div>
      </InfoPanel>
    </div>
  )
}

function AlertsTab({ result, onOpenAlert }: { result: SwingTradeScanResult | null; onOpenAlert: () => void }) {
  const rawAlerts = (result?.metrics as Record<string, unknown> | undefined)?.contextual_alerts
  const alerts = Array.isArray(rawAlerts) ? rawAlerts as Array<Record<string, unknown>> : []
  return (
    <div className="grid gap-3">
      <SectionHero
        eyebrow="Alerts"
        title={alerts.length ? `${alerts.length} contextual alert${alerts.length === 1 ? '' : 's'}` : 'No contextual alerts'}
        body="Create alerts from the active backend swing setup."
        tone={result?.bias}
        badge={result?.ticker || 'Swing'}
      />
      <InfoPanel title="Alert Candidates">
        <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {alerts.length ? (
            <div className="grid gap-2">
              {alerts.map((alert, index) => (
                <div key={index} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-white/[0.08] dark:bg-slate-950">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[10px] font-black uppercase tracking-widest text-tertiary">Alert {index + 1}</div>
                      <div className="mt-0.5 truncate text-sm font-semibold text-heading">
                        {compactLabel(text(alert.message) || text(alert.type) || 'Backend alert')}
                      </div>
                    </div>
                    <span className="rounded-full border border-violet-500/25 bg-violet-500/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-violet-700 dark:text-violet-200">
                      {compactLabel(text(alert.type) || 'Alert')}
                    </span>
                  </div>
                  <div className="mt-2 grid gap-1.5">
                    <div className="rounded-md bg-slate-50 px-2.5 py-1.5 dark:bg-slate-900">
                      <div className="text-[10px] font-bold uppercase tracking-wide text-tertiary">Condition</div>
                      <div className="mt-0.5 text-xs leading-snug text-secondary">{text(alert.condition) || 'Backend condition not returned.'}</div>
                    </div>
                    {Object.entries(alert).filter(([key]) => !['type', 'message', 'condition'].includes(key)).map(([key, value]) => (
                      <div key={key} className="grid gap-1 rounded-md bg-slate-50 px-2.5 py-1.5 dark:bg-slate-900 sm:grid-cols-[112px_minmax(0,1fr)]">
                        <div className="text-[10px] font-bold uppercase tracking-wide text-tertiary">{compactLabel(key)}</div>
                        <div className="min-w-0 text-xs leading-snug text-secondary">{typeof value === 'object' && value != null ? JSON.stringify(value) : String(value ?? '—')}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyTab text="No contextual backend alerts returned for this setup." />
          )}
        </div>
        <button type="button" disabled={!result} onClick={onOpenAlert} className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-4 py-2 text-sm font-black text-violet-700 disabled:opacity-50 dark:text-violet-200">
          Create Alert
        </button>
      </div>
      </InfoPanel>
    </div>
  )
}

function SectionHero({ eyebrow, title, body, tone, badge }: { eyebrow: string; title: string; body?: string; tone?: string | null; badge?: string }) {
  return (
    <section className={`rounded-xl border p-3 ${swingBiasBadgeClass(tone)}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-widest opacity-80">{eyebrow}</div>
          <div className="mt-1 text-lg font-semibold leading-snug text-heading">{title}</div>
          {body && <p className="mt-1 text-sm leading-relaxed text-secondary">{body}</p>}
        </div>
        {badge && <span className="rounded-full border border-current/25 bg-white/50 px-2 py-0.5 font-mono text-[10px] font-black uppercase tracking-wide dark:bg-slate-950/35">{badge}</span>}
      </div>
    </section>
  )
}

function RailCard({
  title,
  children,
  placement = 'right',
  onDockWidget,
  onUndockWidget,
  allExpanded = false,
}: {
  title: string
  children: ReactNode
  placement?: WidgetPlacement
  onDockWidget?: (widgetId: string) => void
  onUndockWidget?: (widgetId: string) => void
  allExpanded?: boolean
}) {
  const pinnedFullLength = title === 'Current Decision'
  const widgetId = widgetIdForTitle(title)
  const [minimized, setMinimized] = useState(!allExpanded && !pinnedFullLength)
  const [maximized, setMaximized] = useState(false)
  const [bodyMaxHeight, setBodyMaxHeight] = useState(pinnedFullLength ? 860 : 720)
  const startWidgetDrag = (event: DragEvent<HTMLElement>) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/oa-widget-id', widgetId)
  }
  const dropWidget = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    const sourceId = event.dataTransfer.getData('text/oa-widget-id')
    if (!sourceId || sourceId === widgetId) return
    const target = event.currentTarget
    const source = target.parentElement?.querySelector<HTMLElement>(`[data-widget-id="${sourceId}"]`)
    if (!source || !target.parentElement) return
    const rect = target.getBoundingClientRect()
    const placeBefore = event.clientY < rect.top + rect.height / 2
    target.parentElement.insertBefore(source, placeBefore ? target : target.nextSibling)
  }
  const resizeWidget = (event: PointerEvent<HTMLDivElement>) => {
    const startY = event.clientY
    const startHeight = bodyMaxHeight
    event.currentTarget.setPointerCapture(event.pointerId)
    const handleMove = (moveEvent: globalThis.PointerEvent) => {
      const viewportCap = Math.max(280, window.innerHeight - 180)
      setBodyMaxHeight(Math.max(220, Math.min(Math.max(viewportCap, 420), startHeight + (moveEvent.clientY - startY))))
    }
    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }
  const body = (
    <div
      className={allExpanded ? 'min-h-0 overflow-visible break-words p-3' : 'min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain break-words p-3'}
      style={{ maxHeight: placement === 'bottom' || allExpanded ? 'none' : `min(70vh, ${bodyMaxHeight}px)` }}
    >
      {children}
    </div>
  )
  return (
    <>
    <section
      className={`swing-trade-widget flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-white/[0.07] dark:bg-slate-950 ${placement === 'bottom' ? 'h-full' : ''}`}
      data-widget-id={widgetId}
      onDragOver={event => event.preventDefault()}
      onDrop={dropWidget}
    >
      <div
        className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-white/[0.07] dark:bg-slate-900/60"
      >
        <span
          draggable
          onDragStart={startWidgetDrag}
          className="shrink-0 cursor-grab text-tertiary active:cursor-grabbing"
          aria-label={`Move ${title} widget`}
          title="Drag to move widget"
        >
          <GripVertical size={14} />
        </span>
        <button
          type="button"
          onClick={() => !pinnedFullLength && setMinimized(cur => !cur)}
          className={`flex min-w-0 flex-1 items-center gap-2 text-left text-[11px] font-black uppercase tracking-widest text-tertiary ${pinnedFullLength ? 'cursor-default' : 'cursor-pointer hover:text-heading'}`}
          aria-expanded={pinnedFullLength || !minimized}
          aria-label={pinnedFullLength ? title : `${minimized ? 'Restore' : 'Minimize'} ${title} widget`}
        >
          <span className="truncate">{title}</span>
        </button>
        <div className="flex items-center gap-1">
          <span className="rounded-full border border-slate-200 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-tertiary dark:border-white/[0.08]">
            Widget
          </span>
          {placement === 'right' && onDockWidget && (
            <button
              type="button"
              onClick={() => onDockWidget(widgetId)}
              className="hidden rounded-md border border-slate-200 px-1.5 py-1 text-[9px] font-black uppercase tracking-wide text-tertiary hover:border-violet-400 hover:text-heading dark:border-white/[0.08] sm:inline-flex"
              aria-label={`Move ${title} widget to bottom tray`}
              title="Move widget to bottom tray"
            >
              Bottom
            </button>
          )}
          {placement === 'bottom' && onUndockWidget && (
            <button
              type="button"
              onClick={() => onUndockWidget(widgetId)}
              className="rounded-md border border-slate-200 px-1.5 py-1 text-[9px] font-black uppercase tracking-wide text-tertiary hover:border-violet-400 hover:text-heading dark:border-white/[0.08]"
              aria-label={`Move ${title} widget back to right panel`}
              title="Move widget back to right panel"
            >
              Right
            </button>
          )}
          {!pinnedFullLength && (
            <button
              type="button"
              onClick={() => setMinimized(cur => !cur)}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-tertiary hover:bg-slate-200 hover:text-heading dark:hover:bg-slate-800"
              aria-label={minimized ? `Restore ${title} widget` : `Minimize ${title} widget`}
              title={minimized ? 'Restore widget' : 'Minimize widget'}
            >
              {minimized ? <ChevronDown size={15} /> : <Minus size={13} />}
            </button>
          )}
          <button
            type="button"
            onClick={() => setMaximized(true)}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-tertiary hover:bg-slate-200 hover:text-heading dark:hover:bg-slate-800"
            aria-label={`Maximize ${title} widget`}
            title="Maximize widget"
          >
            <Maximize2 size={13} />
          </button>
        </div>
      </div>
      {(!minimized || pinnedFullLength) && (
        <>
          {body}
          <div
            className="h-2 shrink-0 cursor-row-resize border-t border-slate-100 bg-slate-50 transition hover:bg-violet-100 active:bg-violet-200 dark:border-white/[0.05] dark:bg-slate-900/70 dark:hover:bg-violet-950/50"
            onPointerDown={placement === 'bottom' ? undefined : resizeWidget}
            role="separator"
            aria-orientation="horizontal"
            aria-label={`Resize ${title} widget`}
            title={placement === 'bottom' ? 'Bottom tray height is controlled by the center frame' : 'Drag to resize widget'}
          />
        </>
      )}
    </section>
    {maximized && (
      <div className="fixed inset-x-2 inset-y-3 z-50 flex max-w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-white/[0.08] dark:bg-slate-950 sm:left-auto sm:right-3 sm:w-[min(520px,calc(100vw-1.5rem))]" role="dialog" aria-modal="true" aria-label={`${title} widget`}>
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-white/[0.08] dark:bg-slate-900">
          <div className="text-sm font-black uppercase tracking-widest text-heading">{title}</div>
          <button type="button" onClick={() => setMaximized(false)} className="rounded-lg p-2 text-secondary hover:bg-slate-200 hover:text-heading dark:hover:bg-slate-800" aria-label="Close maximized widget">
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
      </div>
    )}
    </>
  )
}

function SwingProfessionalDecisionSummary({ decision }: { decision: ProfessionalDecisionPayload }) {
  const h = decision.hierarchy
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Value label="Market" value={h.marketContext.display} />
        <Value label="Stock Bias" value={h.stockBias.display} />
        <Value label="Setup" value={h.setup.display} />
        <Value label="Current Phase" value={h.currentPhase.display} />
        <Value label="Original Entry" value={h.originalEntry?.display || '—'} />
        <Value label="Current Action" value={h.currentAction.display} />
        <Value label="Next Opportunity" value={h.nextOpportunity.display} />
        <Value label="Confidence" value={decision.confidence.tradeConfidence.display} />
        <Value label="Bias Confidence" value={decision.confidence.biasConfidence.display} />
        <Value label="Entry Quality" value={decision.confidence.entryQuality.display} />
        <Value label="Entry Timing" value={decision.confidence.entryTiming.display} />
        <Value label="Trade Score" value={decision.scores.overallTradeScore?.display || '—'} />
      </div>
      <SwingFactorGroup title="Positive" items={decision.why.positiveFactors} tone="positive" />
      <SwingFactorGroup title="Negative" items={decision.why.negativeFactors} tone="danger" />
      <div className="rounded-lg border border-slate-200 p-2 dark:border-white/[0.08]">
        <div className="text-[10px] font-black uppercase tracking-widest text-tertiary">What Changes The Decision</div>
        <SwingFactorGroup title="Bullish If" items={decision.changesDecision.bullish} tone="positive" compact />
        <SwingFactorGroup title="Bearish If" items={decision.changesDecision.bearish} tone="danger" compact />
        <SwingFactorGroup title="Invalidated If" items={decision.changesDecision.invalidation} tone="danger" compact />
      </div>
      <div className="grid gap-1">
        {decision.aiCoach.lines.slice(0, 6).map(line => (
          <div key={line} className="rounded-md bg-slate-50 px-2 py-1 text-xs text-secondary dark:bg-slate-900">{line}</div>
        ))}
      </div>
    </div>
  )
}

function SwingFactorGroup({ title, items, tone, compact = false }: { title: string; items: ProfessionalDecisionPayload['why']['positiveFactors']; tone: string; compact?: boolean }) {
  if (!items.length) return null
  const iconClass = tone === 'positive' ? 'text-emerald-600 dark:text-emerald-300' : tone === 'danger' ? 'text-rose-600 dark:text-rose-300' : 'text-tertiary'
  return (
    <div className={compact ? 'mt-2' : ''}>
      <div className="mb-1 text-[10px] font-black uppercase tracking-wide text-tertiary">{title}</div>
      <div className="grid gap-1">
        {items.slice(0, compact ? 3 : 5).map(item => (
          <div key={`${title}-${item.display}-${item.reason || ''}`} className="flex gap-2 rounded-md bg-slate-50 px-2 py-1 text-xs dark:bg-slate-900">
            {tone === 'danger' ? <AlertTriangle size={13} className={`mt-0.5 shrink-0 ${iconClass}`} /> : <CheckCircle2 size={13} className={`mt-0.5 shrink-0 ${iconClass}`} />}
            <span className="min-w-0">
              <span className="font-semibold text-heading">{item.display}</span>
              {item.reason && <span className="text-secondary"> — {item.reason}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function RailActionButton({ label, icon, disabled, onClick }: { label: string; icon: ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex min-h-9 min-w-0 items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-secondary transition hover:border-violet-400 hover:text-heading disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:bg-slate-950"
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  )
}

function InfoPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/[0.08] dark:bg-slate-900/60">
      <div className="mb-2 text-[11px] font-black uppercase tracking-widest text-tertiary">{title}</div>
      {children}
    </section>
  )
}

function Value({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="min-w-0 rounded-lg bg-slate-50 px-2 py-1.5 dark:bg-slate-900">
      <div className="truncate text-[10px] font-bold uppercase tracking-wide text-tertiary">{label}</div>
      <div className={`mt-0.5 truncate font-mono text-sm font-semibold ${muted ? 'text-tertiary' : inferredSwingTextClass(label, value || '—')}`}>{value || '—'}</div>
    </div>
  )
}

function VerdictPill({ verdict }: { verdict?: string | null }) {
  const raw = compactLabel(verdict)
  const upper = raw.toUpperCase()
  const cls = upper.includes('GO') && !upper.includes('NO')
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
    : upper.includes('AVOID') || upper.includes('NO')
      ? 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-200'
      : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200'
  return <span className={`rounded-full border px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${cls}`}>{raw}</span>
}

function EmptyTab({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 px-3 py-3 text-sm text-tertiary dark:border-white/[0.10]">
      {text}
    </div>
  )
}
