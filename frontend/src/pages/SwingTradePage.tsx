import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  BarChart2,
  Bell,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  FileText,
  Info,
  Layers,
  LayoutList,
  Loader2,
  Lock,
  Maximize2,
  Minus,
  Plus,
  RefreshCw,
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
import type { DeskAlertCreate, SwingTradeScanResult, UnifiedAnalysis } from '../api/client'
import { fetchMyTickers, fetchStockTargets, type StockTargetData } from '../api/commandCenter'
import SetAlertDrawer from '../components/desk/SetAlertDrawer'
import { parseChartPayload } from '../components/SwingTradeMetricCharts'
import { useApp } from '../contexts/AppContext'
import { ROUTES, getTradeWorksheetRoute } from '../routing/routes'
import type { OptionLeg } from '../types'

const OptionsEntryCheck = lazy(() => import('../components/OptionsEntryCheck'))

type WorkstationTab = 'overview' | 'fibonacci' | 'options' | 'exit' | 'evidence' | 'journal' | 'alerts'
type Timeframe = 'Daily' | 'Weekly' | 'Monthly'
type IndicatorCategory = 'trend' | 'momentum' | 'volatility' | 'volume' | 'levels' | 'context'
type IndicatorPanel = 'price' | 'volume' | 'oscillator' | 'structure'
type IndicatorPresetId = 'clean' | 'swing_core' | 'trend' | 'momentum' | 'volatility' | 'engine_recommended'

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

function text(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value : ''
}

function money(value: unknown): string {
  const n = num(value)
  return n == null ? '—' : `$${n.toFixed(2)}`
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

function levelFromUnified(unified: UnifiedAnalysis | null, type: 't1' | 't2'): string {
  const row = unified?.exit_rows.find(item => item.type === type)
  return row?.price || '—'
}

function latestPrice(result: SwingTradeScanResult | null, unified: UnifiedAnalysis | null): number | null {
  const m = result?.metrics as Record<string, unknown> | undefined
  return unified?.price ?? num(m?.last_price)
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

function hasBackendValue(...values: unknown[]): boolean {
  return values.some(value => num(value) != null || text(value) !== '')
}

function backendStructurePivots(metrics: Record<string, unknown> | undefined): SwingStructurePivot[] {
  const structure = isRecord(metrics?.market_structure) ? metrics.market_structure : null
  const raw = Array.isArray(structure?.pivots) ? structure.pivots : []
  return raw
    .filter(isRecord)
    .map(pivot => ({
      label: text(pivot.label),
      price: num(pivot.price),
      date: text(pivot.date),
      confirmed: pivot.confirmed !== false,
    }))
    .filter(pivot => pivot.confirmed && pivot.price != null && pivot.date)
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
    { id: 'stoch_rsi', name: 'Stochastic RSI', category: 'momentum', panel: 'oscillator', ...available(false) },
    { id: 'roc', name: 'Rate of Change', category: 'momentum', panel: 'oscillator', ...available(hasBackendValue(metrics?.mom_5d_pct, fibTargets?.mom_5d)), currentValue: pct(metrics?.mom_5d_pct ?? fibTargets?.mom_5d), formula: 'Backend momentum percentage', inputs: 'Backend mom_5d_pct / stock-targets mom_5d', interpretation: 'Recent swing momentum returned by backend.', source: 'Swing Trade API' },
    { id: 'atr14', name: 'ATR 14', category: 'volatility', panel: 'oscillator', parameters: { period: 14 }, ...available(false) },
    { id: 'bollinger20', name: 'Bollinger Bands 20/2', category: 'volatility', panel: 'price', parameters: { period: 20, stdev: 2 }, ...available(false) },
    { id: 'keltner', name: 'Keltner Channels', category: 'volatility', panel: 'price', ...available(false) },
    { id: 'volume', name: 'Volume', category: 'volume', panel: 'volume', ...available(hasVolumeSeries), currentValue: indicatorValue(metrics?.volume_ratio, 2), formula: 'Backend volume series', inputs: 'Backend chart_series volume', interpretation: compactLabel(text(metrics?.volume_label) || 'Volume context returned by backend'), source: 'Swing Trade API' },
    { id: 'avg_volume20', name: 'Average Volume 20', category: 'volume', panel: 'volume', parameters: { period: 20 }, ...available(false) },
    { id: 'relative_volume', name: 'Relative Volume', category: 'volume', panel: 'volume', ...available(hasBackendValue(metrics?.volume_ratio)), currentValue: indicatorValue(metrics?.volume_ratio, 2), formula: 'Backend relative volume ratio', inputs: 'Backend volume_ratio', interpretation: compactLabel(text(metrics?.volume_label) || 'Relative volume returned by backend'), source: 'Swing Trade API' },
    { id: 'obv', name: 'OBV', category: 'volume', panel: 'oscillator', ...available(false) },
    { id: 'volume_profile', name: 'Volume Profile', category: 'volume', panel: 'price', ...available(false, 'Volume Profile is hidden because backend support was not detected.') },
    { id: 'fibonacci_retracement', name: 'Fibonacci Retracement', category: 'levels', panel: 'price', ...available(hasFibAnchors && hasFibLevels), currentValue: fibAnchorLabel, formula: 'Backend-confirmed swing anchors and retracement prices', inputs: 'Stock-targets fib_retracement_levels', interpretation: fibTargets?.fib_classification || 'Retracement overlay uses only backend-selected anchors.', source: 'Stock Targets API' },
    { id: 'fibonacci_extension', name: 'Fibonacci Extension', category: 'levels', panel: 'price', ...available(Boolean(fibTargets?.fib_extension_levels?.length) || hasTargets), currentValue: hasTargets ? `${money(exec.target1)} / ${money(exec.target2)}` : undefined, formula: 'Backend extension prices when supplied', inputs: 'Stock-targets fib_extension_levels and execution targets', interpretation: 'Disabled by default unless selected or target evidence is returned.', source: 'Stock Targets API' },
    { id: 'support_resistance', name: 'Support and Resistance', category: 'levels', panel: 'price', ...available(hasBackendValue(fibTargets?.suggested_stop_loss, fibTargets?.suggested_target1, exec.stop, exec.target1)), currentValue: `${money(fibTargets?.suggested_stop_loss ?? exec.stop)} / ${money(fibTargets?.suggested_target1 ?? exec.target1)}`, formula: 'Backend support/resistance levels', inputs: 'Stock-targets and execution levels', interpretation: 'Nearby levels returned by backend APIs.', source: 'Stock Targets API' },
    { id: 'swing_pivots', name: 'Swing High / Swing Low', category: 'levels', panel: 'structure', ...available(hasFibAnchors), currentValue: fibAnchorLabel, formula: 'Backend-confirmed swing pivots', inputs: 'Stock-targets fib anchors', interpretation: 'Labels are limited to backend-selected anchors.', source: 'Stock Targets API' },
    { id: 'structure', name: 'HH / HL / LH / LL Structure', category: 'levels', panel: 'structure', ...available(hasBackendValue(marketStructure?.display, result?.metrics && text((result.metrics as Record<string, unknown>).trend_direction), unified?.structure)), currentValue: compactLabel(text(marketStructure?.display) || text(metrics?.trend_direction) || unified?.structure), formula: 'Backend confirmed daily pivot structure', inputs: 'Swing metrics market_structure.pivots', interpretation: compactLabel(text(marketStructure?.story) || result?.playbook_hint || result?.decision_message || 'Structure context returned by backend'), source: 'Swing Trade API' },
    { id: 'bos', name: 'BOS', category: 'levels', panel: 'structure', ...available(false) },
    { id: 'choch', name: 'CHoCH', category: 'levels', panel: 'structure', ...available(false) },
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
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [watchlistOpen, setWatchlistOpen] = useState(true)
  const [mobileWatchlistOpen, setMobileWatchlistOpen] = useState(false)
  const [myTickers, setMyTickers] = useState<Array<{ symbol: string; company?: string; price?: number | null; changePct?: number | null }>>([])
  const [unified, setUnified] = useState<UnifiedAnalysis | null>(null)
  const [fibTargets, setFibTargets] = useState<StockTargetData | null>(null)
  const [notice, setNotice] = useState<{ tone: 'success' | 'info'; message: string } | null>(null)
  const [alertOpen, setAlertOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<WorkstationTab>('overview')
  const [sectionsOpen, setSectionsOpen] = useState(false)
  const [timeframe, setTimeframe] = useState<Timeframe>('Daily')
  const [ocKey, setOcKey] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

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

  const runScan = useCallback(async (overrideTicker?: string) => {
    const sym = (overrideTicker || ticker).trim().toUpperCase()
    if (!sym || sym.length > 12) {
      setUi(cur => ({ ...cur, error: 'Enter a valid ticker symbol.' }))
      return
    }
    setUi(cur => ({ ...cur, loading: true, error: null, result: null, ticker: sym }))
    setUnified(null)
    setFibTargets(null)
    try {
      const data = await analyzeSwingTrade(sym)
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
        .filter(item => (item.trade_types || []).includes('swing') && (item.is_active ?? true))
        .map(item => ({
          symbol: item.symbol.toUpperCase(),
          company: item.company_name,
          price: item.last_price,
          changePct: item.price_change_pct,
        }))
        .slice(0, 18)
      setMyTickers(rows)
    }).catch(() => setMyTickers([]))
  }, [])

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

  const handleCreateAlert = useCallback(async (data: DeskAlertCreate) => {
    await deskApi.createAlert(data)
    setAlertOpen(false)
    setNotice({ tone: 'success', message: 'Alert saved.' })
  }, [])

  return (
    <div className="swing-trade-page min-h-0 flex-1 overflow-hidden bg-surface-page p-3 text-primary">
      <div className="mx-auto flex h-full max-w-[1920px] gap-3 overflow-hidden">
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
            className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-secondary hover:border-violet-400 dark:border-white/[0.08] dark:bg-slate-950 lg:flex"
            aria-label="Open Swing watchlist"
          >
            <ChevronRight size={18} />
          </button>
        )}

        <main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
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
            loading={loading}
            onRefresh={() => void runScan()}
            onAddToPortfolio={handleAddToPortfolio}
            onOpenAlert={() => setAlertOpen(true)}
            onOpenPreTrade={() => navigate(preTradeRoute)}
            onOpenSections={() => setSectionsOpen(true)}
            hasPosition={existingPositions.length > 0}
          />

          {notice && (
            <div className={`mb-3 rounded-xl border px-4 py-3 text-sm ${
              notice.tone === 'success'
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
                : 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-200'
            }`}>
              {notice.message}
            </div>
          )}

          {error && (
            <div className="mb-3 flex gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-200">
              <ShieldAlert className="mt-0.5 shrink-0" size={16} />
              {error}
            </div>
          )}

          <div className="grid min-h-0 flex-1 gap-3 overflow-hidden xl:grid-cols-[minmax(0,1fr)_360px]">
            <section className="min-h-0 overflow-hidden rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-white/[0.07] dark:bg-slate-950">
              <SwingPrimaryChart
                result={result}
                unified={unified}
                fibTargets={fibTargets}
                timeframe={timeframe}
                onTimeframeChange={setTimeframe}
              />
            </section>

            <SwingRightRail
              result={result}
              unified={unified}
              fibTargets={fibTargets}
              existingPositionCount={existingPositions.length}
            />
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
        <div className="fixed inset-0 z-40 lg:hidden">
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
  myTickers: Array<{ symbol: string; company?: string; price?: number | null; changePct?: number | null }>
  onTickerChange: (value: string) => void
  onRun: (ticker?: string) => void
  onClose: () => void
  mobileOverlay?: boolean
}) {
  return (
    <aside className={mobileOverlay
      ? 'absolute left-0 top-0 flex h-full w-80 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-r-xl border border-slate-200 bg-white p-3 shadow-xl dark:border-white/[0.08] dark:bg-slate-950'
      : 'hidden h-full w-80 shrink-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-3 dark:border-white/[0.08] dark:bg-slate-950 lg:flex'
    }>
      <div className="mb-3 flex shrink-0 items-start justify-between">
        <div>
          <div className="text-[11px] font-black uppercase tracking-widest text-tertiary">Swing Workstation</div>
          <div className="mt-1 flex items-center gap-2">
            <TrendingUp size={16} className="text-violet-500" />
            <span className="text-lg font-black text-heading">Swing Trade</span>
          </div>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg p-1 text-secondary hover:bg-slate-100 dark:hover:bg-slate-900" aria-label="Collapse sidebar">
          <ChevronLeft size={16} />
        </button>
      </div>

      <section className="shrink-0 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/[0.07] dark:bg-slate-900/60">
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
            <div className="font-mono text-xl font-black text-heading">{result.ticker}</div>
            <div className="truncate text-xs text-secondary">{result.company_name}</div>
          </div>
        )}
      </section>

      <section className="mt-3 flex min-h-0 flex-1 flex-col">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[10px] font-black uppercase tracking-widest text-tertiary">Watchlist</div>
          <button type="button" className="text-[10px] font-bold text-violet-600 dark:text-violet-300" onClick={() => window.location.assign(ROUTES.myTickers)}>
            Manage
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-auto overscroll-contain">
          {myTickers.length ? myTickers.map(item => {
            const selected = item.symbol === result?.ticker
            return (
              <button
                key={item.symbol}
                type="button"
                onClick={() => onRun(item.symbol)}
                className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition ${
                  selected
                    ? 'border-violet-500 bg-violet-500/10'
                    : 'border-slate-200 bg-white hover:border-violet-300 dark:border-white/[0.08] dark:bg-slate-950'
                }`}
              >
                <span className="min-w-0">
                  <span className="font-mono text-sm font-black text-heading">{item.symbol}</span>
                  <span className="ml-2 truncate text-xs text-tertiary">{item.company}</span>
                </span>
                <span className="text-right">
                  <span className="block font-mono text-xs font-bold text-heading">{money(item.price)}</span>
                  <span className={`block font-mono text-[11px] font-bold ${(item.changePct ?? 0) >= 0 ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'}`}>
                    {pct(item.changePct)}
                  </span>
                </span>
              </button>
            )
          }) : (
            <div className="rounded-lg border border-slate-200 px-3 py-3 text-sm text-tertiary dark:border-white/[0.08]">
              No swing tickers saved.
            </div>
          )}
        </div>
      </section>

      <section className="mt-3 shrink-0">
        <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-tertiary">Quick Tickers</div>
        <div className="flex flex-wrap gap-1.5">
          {['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMD', 'META'].map(sym => (
            <button
              key={sym}
              type="button"
              onClick={() => onRun(sym)}
              className="rounded-full border border-slate-200 px-2 py-1 font-mono text-[11px] font-black text-secondary hover:border-violet-400 dark:border-white/[0.08]"
            >
              {sym}
            </button>
          ))}
        </div>
      </section>

      <section className="mt-3 grid shrink-0 gap-2">
        <button type="button" onClick={() => window.location.assign(ROUTES.dayTrade)} className="rounded-lg border border-slate-200 px-3 py-2 text-left text-xs font-bold text-secondary hover:border-violet-400 dark:border-white/[0.08]">
          Day Trade Workspace
        </button>
        <button type="button" onClick={() => window.location.assign(ROUTES.positions)} className="rounded-lg border border-slate-200 px-3 py-2 text-left text-xs font-bold text-secondary hover:border-violet-400 dark:border-white/[0.08]">
          Positions Center
        </button>
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
    <section className="mb-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-white/[0.08] dark:bg-slate-950 lg:hidden">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-black uppercase tracking-widest text-tertiary">Swing Trade</div>
          <div className="text-sm font-black text-heading">Analyze Ticker</div>
        </div>
        <button
          type="button"
          onClick={onOpenWatchlist}
          className="inline-flex items-center gap-2 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs font-black text-violet-700 dark:text-violet-200"
        >
          <TrendingUp size={14} />
          Watchlist
        </button>
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
  loading,
  hasPosition,
  onRefresh,
  onAddToPortfolio,
  onOpenAlert,
  onOpenPreTrade,
  onOpenSections,
}: {
  result: SwingTradeScanResult | null
  unified: UnifiedAnalysis | null
  loading: boolean
  hasPosition: boolean
  onRefresh: () => void
  onAddToPortfolio: () => void
  onOpenAlert: () => void
  onOpenPreTrade: () => void
  onOpenSections: () => void
}) {
  return (
    <div className="relative mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-white/[0.08] dark:bg-slate-950">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="font-mono text-2xl font-black text-heading">{result?.ticker || '—'}</span>
        <span className="max-w-[340px] truncate text-sm font-semibold text-secondary">{result?.company_name || unified?.company || ''}</span>
        <span className="font-mono text-xl font-black text-heading">{money(latestPrice(result, unified))}</span>
        {unified?.change_pct != null && (
          <span className={`font-mono text-sm font-bold ${unified.change_pct >= 0 ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'}`}>
            {pct(unified.change_pct)}
          </span>
        )}
      </div>
      <div className="flex max-w-full shrink-0 items-center gap-2 overflow-x-auto pb-1">
        <button type="button" onClick={onOpenSections} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-secondary hover:border-violet-400 dark:border-white/[0.08]">
          <LayoutList size={14} />
          Sections
        </button>
        {hasPosition && (
          <button type="button" onClick={() => window.location.assign(ROUTES.positions)} className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-black text-amber-700 dark:text-amber-200">
            In Position
          </button>
        )}
        <button type="button" onClick={onOpenPreTrade} className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-black text-emerald-700 dark:text-emerald-200">
          Pre-Trade
        </button>
        <button type="button" onClick={onOpenAlert} disabled={!result} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-secondary hover:border-violet-400 disabled:opacity-50 dark:border-white/[0.08]">
          Alert
        </button>
        <button type="button" onClick={onAddToPortfolio} disabled={!result || hasPosition} className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-black text-white hover:bg-violet-500 disabled:opacity-50">
          Portfolio
        </button>
        <button type="button" onClick={onRefresh} disabled={loading} className="rounded-lg border border-slate-200 p-2 text-secondary hover:border-violet-400 disabled:opacity-50 dark:border-white/[0.08]" aria-label="Refresh swing analysis">
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
}: {
  result: SwingTradeScanResult | null
  unified: UnifiedAnalysis | null
  fibTargets: StockTargetData | null
  existingPositionCount: number
}) {
  const exec = getExec(result)
  const spread = getSpread(result, unified)
  const metrics = result?.metrics as Record<string, unknown> | undefined
  const signalQuality = unified?.verdict_presentation?.signal_quality?.label || result?.setup_quality || result?.entry_quality || '—'
  const confidence = unified?.confidence ?? result?.confidence ?? null
  return (
    <aside className="hidden min-h-0 content-start gap-3 overflow-y-auto overscroll-contain pr-1 xl:grid">
      <RailCard title="Current Decision">
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
        {existingPositionCount > 0 && <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs font-bold text-amber-700 dark:text-amber-200">Already tracked in Positions Center</div>}
      </RailCard>

      <RailCard title="Market Structure">
        <div className="grid gap-2">
          <Value label="Trend" value={compactLabel(text(metrics?.trend_direction) || result?.swing_bias || result?.bias)} />
          <Value label="Sequence" value="Confirmed pivot sequence not returned by backend" muted />
          <Value label="Current" value={compactLabel(unified?.structure || text(metrics?.trend_stage))} />
          <Value label="Expected Next" value={compactLabel(text(metrics?.preferred_entry_trigger) || text(metrics?.entry_quality_label) || result?.entry_quality)} />
          <Value label="Invalidation" value={money(exec.stop ?? unified?.stop_price)} />
        </div>
      </RailCard>

      <RailCard title="Entry Plan">
        <div className="grid grid-cols-2 gap-2">
          <Value label="Entry" value={money(exec.breakout ?? unified?.entry_price)} />
          <Value label="Stop" value={money(exec.stop ?? unified?.stop_price)} />
          <Value label="Target 1" value={money(exec.target1) !== '—' ? money(exec.target1) : levelFromUnified(unified, 't1')} />
          <Value label="Target 2" value={money(exec.target2) !== '—' ? money(exec.target2) : levelFromUnified(unified, 't2')} />
          <Value label="R/R" value={unified?.rr_ratio || '—'} />
          <Value label="Timing" value={compactLabel(result?.execution_readiness || text(metrics?.trade_timing_verdict))} />
        </div>
      </RailCard>

      <RailCard title="Strategy">
        <div className="grid grid-cols-2 gap-2">
          <Value label="Selected" value={compactLabel(text(spread.strategy) || result?.suggested_strategy)} />
          <Value label="DTE" value={result?.recommended_contract_duration || (text(spread.expiry) ? text(spread.expiry) : '—')} />
          <Value label="Debit" value={money(spread.est_debit)} />
          <Value label="Max Gain" value={money(spread.max_gain)} />
          <Value label="Max Loss" value={money(spread.max_loss)} />
          <Value label="Breakeven" value={money(spread.breakeven)} />
        </div>
      </RailCard>

      <RailCard title="AI Coach">
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
      </RailCard>

      <RailCard title="Fib Summary">
        <div className="grid gap-2">
          <Value label="Active Anchors" value={fibTargets?.fib_swing_high && fibTargets?.fib_swing_low ? `${money(fibTargets.fib_swing_low)} → ${money(fibTargets.fib_swing_high)}` : 'Backend anchors not returned'} muted={!fibTargets?.fib_swing_high || !fibTargets?.fib_swing_low} />
          <Value label="Current Fib Zone" value={fibTargets?.fib_current_zone || 'Backend fib zone not returned'} muted={!fibTargets?.fib_current_zone} />
          <Value label="Pullback" value={fibTargets?.fib_classification || 'Backend classification not returned'} muted={!fibTargets?.fib_classification} />
          <Value label="Nearest Confluence" value={fibTargets?.fib_nearest_confluence || compactLabel(result?.playbook_hint)} />
          <Value label="Invalidation" value={money(fibTargets?.fib_structural_invalidation ?? fibTargets?.suggested_stop_loss ?? exec.stop)} />
        </div>
      </RailCard>
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
  const points = useMemo(() => parseChartPayload(metrics?.chart_series), [metrics?.chart_series])
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
        Run a swing analysis to load the backend daily chart series.
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
  const visible = points.slice(Math.max(0, safeEnd - visibleBars), safeEnd)
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
  const xFor = (index: number) => index * xStep + xStep * 0.5
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
        const index = visible.findIndex(point => point.d === pivot.date)
        return index >= 0 && pivot.price != null
          ? { ...pivot, x: xFor(index), y: yFor(pivot.price) }
          : null
      }).filter((pivot): pivot is SwingStructurePivot & { x: number; y: number; price: number } => Boolean(pivot))
    : []
  const structureTone = String((metrics?.market_structure as Record<string, unknown> | undefined)?.bias || '').toLowerCase()
  const structureColor = structureTone.includes('bear') ? '#ef4444' : structureTone.includes('bull') ? '#10b981' : '#f59e0b'
  const nearest = crosshair && visible.length
    ? visible[Math.max(0, Math.min(visible.length - 1, Math.round(crosshair.x / Math.max(1, xStep) - 0.5)))]
    : null
  const zoom = (dir: 'in' | 'out') => setVisibleBars(cur => Math.max(20, Math.min(points.length, cur + (dir === 'in' ? -16 : 16))))
  const pan = (dir: 'left' | 'right') => setEndIndex(cur => Math.max(visibleBars, Math.min(points.length, (cur || points.length) + (dir === 'left' ? -12 : 12))))
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

  return (
    <div className={fullScreen ? 'fixed inset-3 z-50 flex flex-col overflow-hidden rounded-xl bg-white p-4 shadow-2xl dark:bg-slate-950' : 'flex h-full min-h-0 flex-col overflow-hidden'}>
      <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-black uppercase tracking-widest text-tertiary">Primary Chart</div>
          <div className="mt-1 text-sm font-semibold text-secondary">
            Backend daily series · {preset === 'engine_recommended' && framework.recommendedReason ? framework.recommendedReason : 'user-selected indicator view'}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {(['Daily', 'Weekly', 'Monthly'] as Timeframe[]).map(tf => (
            <button
              key={tf}
              type="button"
              disabled={tf !== 'Daily'}
              onClick={() => onTimeframeChange(tf)}
              className={`rounded-lg border px-2.5 py-1 text-xs font-black ${timeframe === tf ? 'border-violet-500 bg-violet-500/10 text-violet-700 dark:text-violet-200' : 'border-slate-200 text-secondary dark:border-white/[0.08]'} disabled:cursor-not-allowed disabled:opacity-45`}
              title={tf === 'Daily' ? 'Daily backend series' : `${tf} backend series is not returned yet`}
            >
              {tf}
            </button>
          ))}
          <button type="button" onClick={() => zoom('in')} className="rounded-lg border border-slate-200 p-1.5 text-secondary dark:border-white/[0.08]" aria-label="Zoom in"><ZoomIn size={15} /></button>
          <button type="button" onClick={() => zoom('out')} className="rounded-lg border border-slate-200 p-1.5 text-secondary dark:border-white/[0.08]" aria-label="Zoom out"><ZoomOut size={15} /></button>
          <button type="button" onClick={() => pan('left')} className="rounded-lg border border-slate-200 p-1.5 text-secondary dark:border-white/[0.08]" aria-label="Pan left"><ChevronLeft size={15} /></button>
          <button type="button" onClick={() => pan('right')} className="rounded-lg border border-slate-200 p-1.5 text-secondary dark:border-white/[0.08]" aria-label="Pan right"><ChevronRight size={15} /></button>
          <button type="button" onClick={() => { setVisibleBars(points.length); setEndIndex(points.length) }} className="rounded-lg border border-slate-200 p-1.5 text-secondary dark:border-white/[0.08]" aria-label="Fit chart" title="Fit"><Maximize2 size={15} /></button>
          <button type="button" onClick={resetView} className="rounded-lg border border-slate-200 p-1.5 text-secondary dark:border-white/[0.08]" aria-label="Reset chart" title="Reset"><RotateCcw size={15} /></button>
          <div className="relative">
            <button type="button" onClick={() => setIndicatorOpen(cur => !cur)} className="rounded-lg border border-slate-200 p-1.5 text-secondary dark:border-white/[0.08]" aria-label="Indicators" title="Indicators"><SlidersHorizontal size={15} /></button>
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
            <button type="button" onClick={() => setOverlayOpen(cur => !cur)} className="rounded-lg border border-slate-200 p-1.5 text-secondary dark:border-white/[0.08]" aria-label="Chart overlays" title="Overlays"><Layers size={15} /></button>
            {overlayOpen && (
              <div className="absolute right-0 top-9 z-20 w-52 rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-white/[0.08] dark:bg-slate-950">
                {['fibonacci_retracement', 'fibonacci_extension', 'swing_pivots', 'structure', 'entry', 'stop', 'target1', 'target2'].map(id => {
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
          <button type="button" onClick={() => setFullScreen(cur => !cur)} className="rounded-lg border border-slate-200 p-1.5 text-secondary dark:border-white/[0.08]" aria-label="Full screen chart" title="Full screen"><Maximize2 size={15} /></button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-white/[0.07] dark:bg-slate-900/60">
        <div className="mb-2 flex flex-wrap items-center gap-1.5 px-1">
          <span className="mr-1 text-[10px] font-black uppercase tracking-widest text-tertiary">Active</span>
          {activeIndicators.length ? activeIndicators.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => removeIndicator(item.id)}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${item.recommended ? 'border-violet-300 bg-violet-500/10 text-violet-700 dark:border-violet-400/30 dark:text-violet-200' : 'border-slate-200 bg-white text-secondary dark:border-white/[0.08] dark:bg-slate-950'}`}
              title={item.mandatory ? 'Engine evidence for the current backend decision. Hiding changes only this visual view, not the backend verdict.' : item.reason || item.name}
            >
              {item.mandatory && <Lock size={10} />}
              {item.name}
              <X size={10} />
            </button>
          )) : <span className="text-[11px] text-tertiary">No optional indicators selected.</span>}
        </div>
        <svg viewBox={`0 0 ${width} ${height}`} className={`${fullScreen ? 'h-[calc(100vh-220px)]' : 'min-h-0 flex-1'} block w-full`} role="img" aria-label="Swing trade daily chart" onMouseMove={handleMouseMove} onMouseLeave={() => setCrosshair(null)}>
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
          {visible.map((point, index) => {
            const prev = visible[index - 1]?.c ?? point.c
            const up = point.c >= prev
            const x = xFor(index)
            const openY = yFor(prev)
            const closeY = yFor(point.c)
            const highY = Math.min(openY, closeY) - Math.max(2, Math.abs(closeY - openY) * 0.2)
            const lowY = Math.max(openY, closeY) + Math.max(2, Math.abs(closeY - openY) * 0.2)
            const bodyTop = Math.min(openY, closeY)
            const bodyHeight = Math.max(2, Math.abs(closeY - openY))
            const volHeight = ((point.v || 0) / maxVol) * (volumeBottom - volumeTop)
            return (
              <g key={`${point.d}-${index}`}>
                <line x1={x} x2={x} y1={highY} y2={lowY} stroke={up ? '#22c55e' : '#ef4444'} strokeWidth="1.5" opacity="0.9" />
                <rect x={x - candleWidth / 2} y={bodyTop} width={candleWidth} height={bodyHeight} rx="1.5" fill={up ? '#22c55e' : '#ef4444'} opacity="0.9" />
                {activeIds.has('volume') && <rect x={x - candleWidth / 2} y={volumeBottom - volHeight} width={candleWidth} height={volHeight} fill={up ? '#22c55e' : '#ef4444'} opacity="0.28" />}
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
                const labelWidth = label.length > 2 ? 54 : 32
                const yOffset = label.includes('H') ? -18 : 18
                const chipY = Math.max(8, Math.min(priceBottom - 26, pivot.y + yOffset))
                return (
                  <g key={`${pivot.date}-${label}-${index}`}>
                    <circle cx={pivot.x} cy={pivot.y} r="4.2" fill={structureColor} stroke="rgba(15,23,42,0.95)" strokeWidth="1.5" />
                    <rect x={pivot.x - labelWidth / 2} y={chipY - 9} width={labelWidth} height="18" rx="6" fill="rgba(15,23,42,0.88)" stroke={structureColor} strokeWidth="1" />
                    <text x={pivot.x} y={chipY + 4} textAnchor="middle" fill={structureColor} className="text-[10px] font-black">
                      {index === structurePivots.length - 1 ? `Current ${label}` : label}
                    </text>
                    <text x={pivot.x} y={chipY + (label.includes('H') ? -10 : 17)} textAnchor="middle" className="fill-slate-500 text-[9px] font-mono">
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
        </svg>
      </div>
      <div className="mt-2 flex shrink-0 flex-wrap items-center justify-between gap-2 text-[11px] text-tertiary">
        <div className="flex flex-wrap gap-2">
          <span className="font-mono">{visible[0]?.d} → {visible[visible.length - 1]?.d}</span>
          <span>{visible.length} daily bars</span>
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
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <InfoPanel title="Backend Snapshot">
        <Value label="Session" value={compactLabel(text(metrics?.session_date) || unified?.session)} />
        <Value label="Market" value={compactLabel(result?.market_bias || text(metrics?.market_context) || unified?.regime)} />
        <Value label="Volume" value={num(metrics?.volume_ratio) == null ? compactLabel(text(metrics?.volume_label)) : `${num(metrics?.volume_ratio)?.toFixed(2)}x · ${compactLabel(text(metrics?.volume_label))}`} />
      </InfoPanel>
      <InfoPanel title="Fib / Levels">
        <Value label="Fib Zone" value={fibTargets?.fib_current_zone || 'Backend fib zone not returned'} muted={!fibTargets?.fib_current_zone} />
        <Value label="Classification" value={fibTargets?.fib_classification || 'Backend classification not returned'} muted={!fibTargets?.fib_classification} />
        <Value label="Support" value={money(fibTargets?.suggested_stop_loss ?? getExec(result).stop)} />
        <Value label="Resistance" value={money(fibTargets?.suggested_target1 ?? getExec(result).target1)} />
      </InfoPanel>
      <InfoPanel title="Backend Coach">
        <p className="line-clamp-5 text-sm leading-relaxed text-secondary">{unified?.coach || result?.decision_message || result?.reason || 'Run analysis to load backend coach guidance.'}</p>
      </InfoPanel>
    </div>
  )
}

function FibonacciTab({ result, fibTargets }: { result: SwingTradeScanResult | null; fibTargets: StockTargetData | null }) {
  const metrics = result?.metrics as Record<string, unknown> | undefined
  const exec = getExec(result)
  if (!result) return <EmptyTab text="Run analysis to load Fibonacci context." />
  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
      <InfoPanel title="Fibonacci Map">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <Value label="Swing High" value={money(fibTargets?.fib_swing_high)} />
          <Value label="Swing Low" value={money(fibTargets?.fib_swing_low)} />
          <Value label="Direction" value={compactLabel(fibTargets?.fib_direction || '—')} />
          <Value label="Current Price" value={money(fibTargets?.current_price ?? metrics?.last_price)} />
        </div>
        <div className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3">
          <div className="text-[10px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-200">Backend Fib Context</div>
          <div className="mt-1 grid gap-2 md:grid-cols-3">
            <Value label="Current Zone" value={fibTargets?.fib_current_zone || '—'} />
            <Value label="Classification" value={fibTargets?.fib_classification || '—'} />
            <Value label="Nearest Confluence" value={fibTargets?.fib_nearest_confluence || '—'} />
          </div>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-4">
          {(fibTargets?.fib_retracement_levels || []).map(level => (
            <Value key={level.level} label={level.level} value={money(level.price)} />
          ))}
          {!fibTargets?.fib_retracement_levels?.length && <Value label="Levels" value="Backend levels not returned" muted />}
        </div>
      </InfoPanel>
      <InfoPanel title="Confluence">
        <div className="grid gap-2">
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
        <div className="grid gap-2">
          {(fibTargets?.fib_extension_levels || []).map(level => (
            <Value key={level.level} label={level.level} value={money(level.price)} />
          ))}
          {!fibTargets?.fib_extension_levels?.length && <Value label="Extensions" value="Backend extensions not returned" muted />}
        </div>
      </InfoPanel>
      <InfoPanel title="Dates">
        <div className="grid gap-2">
          <Value label="High Date" value={fibTargets?.fib_swing_high_date || '—'} />
          <Value label="Low Date" value={fibTargets?.fib_swing_low_date || '—'} />
        </div>
      </InfoPanel>
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
  return (
    <InfoPanel title="Exit Plan">
      {exitRows.length ? (
        <div className="overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-[10px] font-black uppercase tracking-widest text-tertiary">
              <tr><th className="pb-2">When</th><th className="pb-2">Price</th><th className="pb-2">Action</th></tr>
            </thead>
            <tbody>
              {exitRows.map((row, index) => (
                <tr key={`${row.when}-${index}`} className="border-t border-slate-200 dark:border-white/[0.07]">
                  <td className="py-2 text-secondary">{row.when}</td>
                  <td className="py-2 font-mono font-black text-heading">{row.price}</td>
                  <td className="py-2 text-secondary">{row.action}{row.note ? ` · ${row.note}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyTab text="No unified exit rows returned by backend." />
      )}
      {Array.isArray(backendRules) && backendRules.length > 0 && (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {backendRules.map((rule, index) => (
            <div key={index} className="rounded-lg border border-slate-200 px-3 py-2 text-xs dark:border-white/[0.08]">
              <pre className="whitespace-pre-wrap font-sans text-secondary">{JSON.stringify(rule, null, 2)}</pre>
            </div>
          ))}
        </div>
      )}
    </InfoPanel>
  )
}

function EvidenceTab({ result, unified }: { result: SwingTradeScanResult | null; unified: UnifiedAnalysis | null }) {
  const reasons = result?.reasons || []
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <InfoPanel title="Conditions">
        <div className="grid gap-2">
          {(unified?.conditions || []).map((condition, index) => (
            <div key={`${condition.label}-${index}`} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-900">
              <span className="text-secondary">{condition.label}</span>
              <span className={`font-black uppercase ${condition.type === 'pass' ? 'text-emerald-600 dark:text-emerald-300' : condition.type === 'fail' ? 'text-rose-600 dark:text-rose-300' : 'text-amber-600 dark:text-amber-300'}`}>{condition.type}</span>
            </div>
          ))}
          {!unified?.conditions?.length && <EmptyTab text="No unified condition payload returned." />}
        </div>
      </InfoPanel>
      <InfoPanel title="Reasons">
        <div className="grid gap-2">
          {reasons.slice(0, 10).map((reason, index) => (
            <div key={index} className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-secondary dark:bg-slate-900">{reason}</div>
          ))}
          {!reasons.length && <EmptyTab text="No backend reasons returned." />}
        </div>
      </InfoPanel>
    </div>
  )
}

function JournalTab({ result, onSaveJournal }: { result: SwingTradeScanResult | null; onSaveJournal: () => void }) {
  return (
    <InfoPanel title="Journal">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-heading">{result ? `${result.ticker} swing plan` : 'No active swing plan'}</div>
          <div className="mt-1 text-xs text-tertiary">Saving uses the backend journal API and the backend-returned plan fields.</div>
        </div>
        <button type="button" disabled={!result} onClick={onSaveJournal} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-black text-white hover:bg-violet-500 disabled:opacity-50">
          Save to Journal
        </button>
      </div>
    </InfoPanel>
  )
}

function AlertsTab({ result, onOpenAlert }: { result: SwingTradeScanResult | null; onOpenAlert: () => void }) {
  const alerts = (result?.metrics as Record<string, unknown> | undefined)?.contextual_alerts
  return (
    <InfoPanel title="Alerts">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {Array.isArray(alerts) && alerts.length ? (
            <div className="grid gap-2">
              {alerts.map((alert, index) => (
                <div key={index} className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-white/[0.08]">
                  <pre className="whitespace-pre-wrap font-sans text-secondary">{JSON.stringify(alert, null, 2)}</pre>
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
  )
}

function RailCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3 dark:border-white/[0.07] dark:bg-slate-950">
      <div className="mb-2 text-[11px] font-black uppercase tracking-widest text-tertiary">{title}</div>
      {children}
    </section>
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
    <div className="rounded-lg bg-slate-50 px-2 py-1.5 dark:bg-slate-900">
      <div className="text-[10px] font-bold uppercase tracking-wide text-tertiary">{label}</div>
      <div className={`mt-0.5 truncate font-mono text-sm font-black ${muted ? 'text-tertiary' : 'text-heading'}`}>{value || '—'}</div>
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
  return <span className={`rounded-full border px-2 py-0.5 text-xs font-black uppercase tracking-wide ${cls}`}>{raw}</span>
}

function EmptyTab({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 px-3 py-3 text-sm text-tertiary dark:border-white/[0.10]">
      {text}
    </div>
  )
}
