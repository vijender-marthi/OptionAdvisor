import axios from 'axios'
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Activity, SatelliteDish,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  BellPlus,
  BriefcaseBusiness,
  ChevronDown,
  ChevronUp,
  EyeOff,
  Filter,
  Info,
  Monitor,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  X,
} from 'lucide-react'
import { createSignalFeedAlert, fetchSignalFeed } from '../api/commandCenter'
import { useApp } from '../contexts/AppContext'
import { ROUTES, getEngineRoute } from '../routing/routes'
import AddTickerModal from '../components/AddTickerModal'
import type { ApiEnvelope, SignalFeedDecisionBlock, SignalFeedMetrics, SignalFeedPayload, SignalFeedRow } from '../types/commandCenter'
import {
  getActionButtonClass,
  getAgreementBadgeClass,
  getBiasBadgeClass,
  getDecisionBadgeClass,
  getMarketContextBadgeClass,
  getRiskTextClass,
} from '../utils/semanticTrading'

type SourceFilter = 'all' | 'day' | 'swing' | 'regular'
type SortField =
  | 'engine_agreement'
  | 'trend'
  | 'price_change'
  | 'rsi'
  | 'relative_strength'
  | 'trend_score'
  | 'volume'
  | 'bull_bear'
  | 'iv_rank'
type NoticeTone = 'info' | 'success' | 'warning'
type StateFilter = 'all' | 'ready' | 'watch' | 'wait' | 'avoid' | 'conflict' | 'manage' | 'extended'
type AgreementFilter = 'all' | 'strong_agreement' | 'partial_agreement' | 'conflict' | 'extended' | 'no_edge' | 'manage'
type TrendFilter = 'all' | 'bullish' | 'neutral' | 'bearish'
type EngineKey = 'day' | 'swing' | 'regular'

const FAVORITES_KEY = 'oa_signal_feed_favorites_v1'
const FILTERS_EXPANDED_KEY = 'oa_signal_feed_filters_expanded_v1'

const SORT_OPTIONS: Array<{ value: SortField; label: string }> = [
  { value: 'engine_agreement', label: 'Engine agreement' },
  { value: 'price_change', label: '% change' },
  { value: 'rsi', label: 'RSI' },
  { value: 'relative_strength', label: 'Relative strength' },
  { value: 'trend_score', label: 'Trend score' },
  { value: 'volume', label: 'Volume ratio' },
  { value: 'bull_bear', label: 'Bull/Bear score' },
  { value: 'iv_rank', label: 'IV rank' },
  { value: 'trend', label: 'Trend' },
]

const SOURCE_OPTIONS: Array<{ value: SourceFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'day', label: 'Day' },
  { value: 'swing', label: 'Swing' },
  { value: 'regular', label: 'Regular' },
]

const STATE_OPTIONS: Array<{ value: StateFilter; label: string }> = [
  { value: 'all', label: 'All states' },
  { value: 'ready', label: 'READY' },
  { value: 'watch', label: 'WATCH' },
  { value: 'wait', label: 'WAIT' },
  { value: 'avoid', label: 'AVOID' },
  { value: 'conflict', label: 'CONFLICT' },
  { value: 'manage', label: 'MANAGE' },
  { value: 'extended', label: 'EXTENDED' },
]

const AGREEMENT_OPTIONS: Array<{ value: AgreementFilter; label: string }> = [
  { value: 'all', label: 'All agreement' },
  { value: 'strong_agreement', label: 'Strong agreement' },
  { value: 'partial_agreement', label: 'Partial agreement' },
  { value: 'conflict', label: 'Conflict' },
  { value: 'extended', label: 'Extended' },
  { value: 'no_edge', label: 'No edge' },
  { value: 'manage', label: 'Manage' },
]

const TREND_OPTIONS: Array<{ value: TrendFilter; label: string }> = [
  { value: 'all', label: 'All trends' },
  { value: 'bullish', label: 'Bullish' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'bearish', label: 'Bearish' },
]

const PRIMARY_STATE_OPTIONS: Array<{ value: StateFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'ready', label: 'Ready' },
  { value: 'watch', label: 'Watch' },
  { value: 'wait', label: 'Wait' },
  { value: 'avoid', label: 'Avoid' },
  { value: 'conflict', label: 'Conflict' },
  { value: 'extended', label: 'Extended' },
]

const PRIMARY_AGREEMENT_OPTIONS: Array<{ value: AgreementFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'strong_agreement', label: 'Strong' },
  { value: 'partial_agreement', label: 'Partial' },
  { value: 'conflict', label: 'Conflict' },
  { value: 'no_edge', label: 'No Edge' },
]

const PRIMARY_SORT_OPTIONS: Array<{ value: SortField; label: string }> = [
  { value: 'engine_agreement', label: 'Agreement' },
  { value: 'price_change', label: 'Price Change' },
  { value: 'trend', label: 'Trend' },
  { value: 'rsi', label: 'RSI' },
  { value: 'volume', label: 'Volume' },
]

const SIGNAL_TABLE_GROUPS: Array<{ engine: EngineKey; title: string; subtitle: string }> = [
  { engine: 'day', title: 'Day Trades', subtitle: 'Intraday setup, confirmation, and execution signals' },
  { engine: 'swing', title: 'Swing Trades', subtitle: 'Multi-day trend and momentum setups' },
  { engine: 'regular', title: 'Regular Trades', subtitle: 'Position trade and core option strategy signals' },
]

function FilterPillGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  className = '',
}: {
  label: string
  options: Array<{ value: T; label: string }>
  value: T
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <div className={`min-w-[10rem] flex-1 space-y-2 ${className}`}>
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map(option => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              value === option.value ? 'bg-violet-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-muted hover:text-secondary'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}

const IGNORE_STORAGE_KEY = 'oa_signal_feed_ignored'

interface IgnoredData {
  date: string
  tickers: string[]
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function loadIgnored(): IgnoredData {
  try {
    const raw = localStorage.getItem(IGNORE_STORAGE_KEY)
    if (raw) {
      const data = JSON.parse(raw) as IgnoredData
      if (data.date === todayStr()) return data
    }
  } catch {}
  return { date: todayStr(), tickers: [] }
}

function saveIgnored(data: IgnoredData) {
  try { localStorage.setItem(IGNORE_STORAGE_KEY, JSON.stringify(data)) } catch {}
}

function axiosErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { detail?: unknown } | undefined
    if (typeof data?.detail === 'string') return data.detail
    if (err.response?.status === 401) return 'Session expired — sign in again.'
    return err.message || 'Request failed'
  }
  if (err instanceof Error) return err.message
  return 'Failed to load Signal Feed'
}

function fmtPrice(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return '\u2014'
  return `$${value.toFixed(2)}`
}

function fmtPct(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return '\u2014'
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

function fmtDayChange(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return '\u2014'
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}`
}

function fmtNumber(value?: number | null, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '\u2014'
  return value.toFixed(digits)
}

function metricNumber(row: SignalFeedRow, key: keyof SignalFeedMetrics): number | null {
  const top = row.metrics?.[key]
  if (typeof top === 'number' && Number.isFinite(top)) return top
  const dayMetric = row.day.metrics?.[key as string]
  if (typeof dayMetric === 'number' && Number.isFinite(dayMetric)) return dayMetric
  return null
}

function fmtRelativeTime(value?: string): string {
  if (!value) return '\u2014'
  const ts = Date.parse(value)
  if (!Number.isFinite(ts)) return '\u2014'
  const diffSec = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.round(diffHr / 24)
  return `${diffDay}d ago`
}

function sourceChipClass(source: string): string {
  if (source === 'day') return 'border-semantic-bullish-border bg-semantic-bullish-bg text-semantic-bullish'
  if (source === 'swing') return 'border-semantic-info-border bg-semantic-info-bg text-semantic-info'
  return 'border-semantic-accent-border bg-semantic-accent-bg text-semantic-accent'
}

function signalClass(value: string): string {
  return getDecisionBadgeClass(value)
}

function agreementBadgeClass(value: string): string {
  return getAgreementBadgeClass(value)
}

function riskClass(value: string): string {
  return getRiskTextClass(value)
}

function compositeScore(row: SignalFeedRow): number {
  const val = (v: string) => {
    const u = String(v || '').toUpperCase()
    if (u === 'READY') return 3
    if (u === 'WATCH') return 2
    if (u === 'WAIT') return 1
    return 0
  }
  return val(row.day_decision) + val(row.swing_decision) + val(row.regular_decision)
}

function normalizeTrendFilter(value: string): TrendFilter {
  const trend = value.toLowerCase()
  if (trend.includes('up') || trend.includes('bull')) return 'bullish'
  if (trend.includes('down') || trend.includes('bear')) return 'bearish'
  return 'neutral'
}

function normalizeAgreementBadge(row: SignalFeedRow): string {
  const raw = String(row.agreement_badge || '').trim().toUpperCase()
  if (raw) return raw
  const state = String(row.agreement_state || '').trim().toUpperCase()
  if (state === 'CONFLICT') return 'CONFLICT'
  if (state === 'EXTENDED') return 'EXTENDED'
  if (state === 'MANAGE') return 'MANAGE'
  if (state === 'AVOID') return 'NO_EDGE'
  return 'PARTIAL_AGREEMENT'
}


function marketContextTone(value?: string | null): string {
  return getMarketContextBadgeClass(String(value || ''))
}

function matchesStateFilter(row: SignalFeedRow, stateFilter: StateFilter, sourceFilter: SourceFilter): boolean {
  if (stateFilter === 'all') return true
  const target = sourceFilter === 'all'
    ? row.agreement_state
    : sourceFilter === 'day'
      ? row.day_decision
      : sourceFilter === 'swing'
        ? row.swing_decision
        : row.regular_decision
  return String(target || '').trim().toLowerCase() === stateFilter
}

function matchesAgreementFilter(row: SignalFeedRow, agreementFilter: AgreementFilter): boolean {
  if (agreementFilter === 'all') return true
  return normalizeAgreementBadge(row).toLowerCase() === agreementFilter
}

function StatusPill({ value, agreement = false }: { value: string; agreement?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
        agreement ? agreementBadgeClass(value) : signalClass(value)
      }`}
    >
      {value.replace(/_/g, ' ')}
    </span>
  )
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="flex items-baseline gap-2 rounded-lg border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-slate-900 px-3 py-2">
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`text-base font-bold tabular-nums tracking-tight ${tone}`}>{value}</div>
    </div>
  )
}

function CompactChip({
  label,
  value,
  tone = 'text-white',
  chrome = 'border-semantic-neutral-border bg-semantic-neutral-bg',
}: {
  label: string
  value: string
  tone?: string
  chrome?: string
}) {
  return (
    <div className={`rounded-lg border px-2 py-1 leading-none ${chrome}`}>
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-0.5 text-sm font-semibold ${tone}`}>{value}</div>
    </div>
  )
}

function SourcePill({ source, decision, emphasized = true }: { source: string; decision: string; emphasized?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-lg border font-bold uppercase ${emphasized ? 'px-1.5 py-0.5 text-[11px] tracking-wide' : 'px-1 py-0.5 text-[10px] tracking-normal opacity-55'} ${sourceChipClass(source)}`}>
      {source}
      <span className="opacity-60">/</span>
      <span className="font-extrabold">{decision}</span>
    </span>
  )
}

function engineCardBorder(engine: string): string {
  if (engine === 'day') return 'border-emerald-500/30 dark:border-emerald-500/25 bg-emerald-50/60 dark:bg-emerald-900/10'
  if (engine === 'swing') return 'border-sky-500/30 dark:border-sky-500/25 bg-sky-50/60 dark:bg-sky-900/10'
  return 'border-violet-500/20 dark:border-violet-500/15 bg-violet-50/40 dark:bg-violet-900/10'
}

function engineLabelClass(engine: string): string {
  if (engine === 'day') return 'text-emerald-700 dark:text-emerald-400'
  if (engine === 'swing') return 'text-sky-700 dark:text-sky-400'
  return 'text-violet-700 dark:text-violet-400'
}

function engineLabel(engine: string): string {
  if (engine === 'day') return '⚡ Day Trade'
  if (engine === 'swing') return '📈 Swing Trade'
  return '🏛 Regular / Position'
}

function EngineCard({ engine, decision, ticker }: { engine: string; decision: SignalFeedDecisionBlock; ticker?: string }) {
  const engineRoute = ticker ? getEngineRoute(engine, ticker) : null
  const navigate = useNavigate()
  const { requestAnalysis } = useApp()
  const optionRisk = decision.option_risk_context
  const showOptionRisk = engine === 'day' && optionRisk && Object.keys(optionRisk).length > 0
  const handleNav = engineRoute ? () => {
    if (engine === 'regular') requestAnalysis(ticker!)
    navigate(engineRoute)
  } : undefined
  const labelEl = (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest ${engineLabelClass(engine)}`}>
      {engineLabel(engine)}
      {engineRoute && <ArrowUpRight size={10} className="opacity-60" />}
    </span>
  )
  return (
    <div className={`rounded-xl border p-3 ${engineCardBorder(engine)}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        {handleNav ? (
          <button onClick={handleNav} className="hover:underline underline-offset-2 text-left">{labelEl}</button>
        ) : labelEl}
        <StatusPill value={decision.final_decision} />
      </div>
      <div className="flex flex-wrap gap-1 mb-2">
        <SignalQualityBadge quality={decision.signal_quality || ''} />
        <ExecTimingBadge timing={decision.execution_timing || ''} />
        <RiskCatBadge category={decision.risk_category || decision.risk_state || ''} />
      </div>
      {decision.reason ? (
        <p className="text-[11px] leading-relaxed text-secondary line-clamp-2">{decision.reason}</p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted">
        {decision.expected_holding_period && <span>Hold: <span className="font-semibold text-secondary">~{decision.expected_holding_period}</span></span>}
        {decision.recommended_contract_duration && <span>Contract: <span className="font-semibold text-secondary">{decision.recommended_contract_duration} DTE</span></span>}
      </div>
      {showOptionRisk ? (
        <div className="mt-2 flex flex-wrap gap-1">
          <OptionRiskPill label="Theta" value={optionRisk.theta_risk} />
          <OptionRiskPill label="Gamma" value={optionRisk.gamma_risk} />
          <OptionRiskPill label="IV" value={optionRisk.iv_risk} />
          <OptionRiskPill label="Liq" value={optionRisk.liquidity_risk} />
        </div>
      ) : null}
    </div>
  )
}

function RegularEngineBar({ decision, ticker }: { decision: SignalFeedDecisionBlock; ticker?: string }) {
  const engineRoute = ticker ? getEngineRoute('regular', ticker) : null
  const navigate = useNavigate()
  const { requestAnalysis } = useApp()
  const handleNav = engineRoute ? () => {
    requestAnalysis(ticker!)
    navigate(engineRoute)
  } : undefined
  const labelEl = (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-violet-700 dark:text-violet-400 shrink-0">
      🏛 Regular / Position
      {engineRoute && <ArrowUpRight size={10} className="opacity-60" />}
    </span>
  )
  return (
    <div className={`rounded-xl border px-3 py-2 flex flex-wrap items-center justify-between gap-2 ${engineCardBorder('regular')}`}>
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        {handleNav ? (
          <button onClick={handleNav} className="hover:underline underline-offset-2 text-left">{labelEl}</button>
        ) : labelEl}
        <StatusPill value={decision.final_decision} />
        <SignalQualityBadge quality={decision.signal_quality || ''} />
        {decision.reason ? (
          <span className="text-[11px] text-secondary line-clamp-1 min-w-0 hidden sm:block">{decision.reason}</span>
        ) : null}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <ExecTimingBadge timing={decision.execution_timing || ''} />
      </div>
    </div>
  )
}

function EngineCardsGrid({ row, canDay, canSwing }: { row: SignalFeedRow; canDay: boolean; canSwing: boolean }) {
  const hasActiveEngines = canDay || canSwing
  return (
    <div className="space-y-2 px-3 pb-2">
      {hasActiveEngines && (
        <div className={`grid gap-2 ${canDay && canSwing ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {canDay && <EngineCard engine="day" decision={row.day} ticker={row.ticker} />}
          {canSwing && <EngineCard engine="swing" decision={row.swing} ticker={row.ticker} />}
        </div>
      )}
      <RegularEngineBar decision={row.regular} ticker={row.ticker} />
    </div>
  )
}

function SignalQualityBadge({ quality }: { quality: string }) {
  const q = String(quality || '').toUpperCase()
  if (!q) return null
  const qClass = q === 'STRONG GO' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' :
    q === 'GO' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400' :
    'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300'
  return <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${qClass}`}>{quality}</span>
}

function ExecTimingBadge({ timing }: { timing: string }) {
  const t = String(timing || '').toUpperCase()
  if (!t) return null
  const tClass = t === 'ENTER NOW' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' :
    t === 'WATCH' ? 'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300' :
    t === 'WAIT FOR PULLBACK' ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300' :
    t === 'STAND ASIDE' ? 'bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300' :
    'bg-violet-50 text-violet-700 dark:bg-violet-900/20 dark:text-violet-300'
  return <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tClass}`}>{timing}</span>
}

function RiskCatBadge({ category }: { category: string }) {
  const c = String(category || '').toUpperCase()
  if (!c) return null
  const cClass = c === 'LOW' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300' :
    c === 'MODERATE' ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300' :
    c === 'EXTENDED' ? 'bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-300' :
    'bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300'
  return <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${cClass}`}>{category}</span>
}

function OptionRiskPill({ label, value }: { label: string; value: string }) {
  const tone = String(value || '').toUpperCase()
  const chrome = tone === 'HIGH'
    ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/25 dark:bg-rose-900/20 dark:text-rose-300'
    : tone === 'MEDIUM'
      ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/25 dark:bg-amber-900/20 dark:text-amber-300'
      : tone === 'LOW'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-900/20 dark:text-emerald-300'
        : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-white/[0.08] dark:bg-slate-800/50 dark:text-slate-300'
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${chrome}`}>
      {label}
      <span className="opacity-75">{value}</span>
    </span>
  )
}

function engineDecisionBlock(row: SignalFeedRow, engine: EngineKey): SignalFeedDecisionBlock {
  if (engine === 'day') return row.day
  if (engine === 'swing') return row.swing
  return row.regular
}

function engineDecisionValue(row: SignalFeedRow, engine: EngineKey): string {
  const block = engineDecisionBlock(row, engine)
  if (block.final_decision) return block.final_decision
  if (engine === 'day') return row.day_decision
  if (engine === 'swing') return row.swing_decision
  return row.regular_decision
}

function engineTitle(engine: EngineKey): string {
  if (engine === 'day') return 'Day'
  if (engine === 'swing') return 'Swing'
  return 'Regular'
}

function SignalMetric({ label, value, tone = 'text-secondary' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-[3.75rem]">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-0.5 font-mono text-xs font-semibold tabular-nums ${tone}`}>{value}</div>
    </div>
  )
}

function DayLevelsBlock({ row, compact = false }: { row: SignalFeedRow; compact?: boolean }) {
  const orh = metricNumber(row, 'or_high')
  const orl = metricNumber(row, 'or_low')
  const vwap = metricNumber(row, 'vwap')
  const price = typeof row.price === 'number' && Number.isFinite(row.price) ? row.price : null
  const vwapTone = price != null && vwap != null
    ? price >= vwap ? 'text-semantic-bullish' : 'text-semantic-bearish'
    : 'text-secondary'
  const orhDist = price != null && orh != null && orh > 0 ? ((price - orh) / orh) * 100 : null
  const orlDist = price != null && orl != null && orl > 0 ? ((price - orl) / orl) * 100 : null
  const vwapDist = price != null && vwap != null && vwap > 0 ? ((price - vwap) / vwap) * 100 : null
  const items = [
    { label: 'ORH', value: fmtPrice(orh), sub: orhDist == null ? '—' : fmtPct(orhDist), tone: orhDist != null && orhDist >= 0 ? 'text-semantic-bullish' : 'text-secondary' },
    { label: 'ORL', value: fmtPrice(orl), sub: orlDist == null ? '—' : fmtPct(orlDist), tone: orlDist != null && orlDist <= 0 ? 'text-semantic-bearish' : 'text-secondary' },
    { label: 'VWAP', value: fmtPrice(vwap), sub: vwapDist == null ? '—' : fmtPct(vwapDist), tone: vwapTone },
  ]
  return (
    <div className={compact ? 'grid grid-cols-3 gap-1.5' : 'grid grid-cols-3 gap-2'}>
      {items.map(item => (
        <div key={item.label} className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 dark:border-white/[0.07] dark:bg-slate-800/40">
          <div className="text-[9px] font-bold uppercase tracking-wide text-muted">{item.label}</div>
          <div className={`mt-0.5 font-mono text-[11px] font-bold tabular-nums ${item.tone}`}>{item.value}</div>
          <div className="font-mono text-[9px] text-tertiary tabular-nums">{item.sub}</div>
        </div>
      ))}
    </div>
  )
}

function EngineOverviewStrip({ row }: { row: SignalFeedRow }) {
  const engines: Array<{ key: EngineKey; label: string; decision: string; block: SignalFeedDecisionBlock }> = [
    { key: 'day', label: 'Day', decision: row.day_decision, block: row.day },
    { key: 'swing', label: 'Swing', decision: row.swing_decision, block: row.swing },
    { key: 'regular', label: 'Regular', decision: row.regular_decision, block: row.regular },
  ]
  return (
    <div className="grid gap-1.5 sm:grid-cols-3">
      {engines.map(item => (
        <div key={item.key} className={`rounded-lg border px-2 py-1.5 ${engineCardBorder(item.key)}`}>
          <div className="flex items-center justify-between gap-2">
            <span className={`text-[10px] font-bold uppercase tracking-wide ${engineLabelClass(item.key)}`}>{item.label}</span>
            <StatusPill value={item.decision || item.block.final_decision || 'WAIT'} />
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            <SignalQualityBadge quality={item.block.signal_quality || item.block.setup_quality || ''} />
            <ExecTimingBadge timing={item.block.execution_timing || item.block.execution_readiness || ''} />
          </div>
        </div>
      ))}
    </div>
  )
}

function morningScan(row: SignalFeedRow) {
  return row.morning_scan ?? {
    scan_time: '6:45 AM PT',
    status: row.metrics?.morning_trending ? 'TRENDING' : 'NOT_TRENDING',
    trending: Boolean(row.metrics?.morning_trending),
    direction: row.price_change_pct > 0 ? 'BULLISH' : row.price_change_pct < 0 ? 'BEARISH' : 'NEUTRAL',
    session_change_pct: row.metrics?.morning_session_change_pct ?? row.price_change_pct,
    volume_vs_average: row.metrics?.morning_volume_vs_average ?? row.metrics?.volume_ratio ?? 0,
    consecutive_same_direction_candles: row.metrics?.morning_consecutive_candles ?? 0,
    candle_direction: row.metrics?.morning_candle_direction ?? 'FLAT',
    directional_consistency: Boolean(row.metrics?.morning_directional_consistency),
    missing: [],
  }
}

function MorningTrendMetrics({ row, compact = false }: { row: SignalFeedRow; compact?: boolean }) {
  const scan = morningScan(row)
  const directionTone = scan.direction === 'BULLISH' ? 'text-semantic-bullish' : scan.direction === 'BEARISH' ? 'text-semantic-bearish' : 'text-tertiary'
  const volTone = scan.volume_vs_average > 1.5 ? 'text-semantic-bullish' : 'text-semantic-warning'
  const consistencyTone = scan.directional_consistency ? 'text-semantic-bullish' : 'text-semantic-warning'
  if (compact) {
    return (
      <div className="flex flex-wrap gap-1 px-3 pb-2">
        <CompactChip label="Move" value={fmtPct(scan.session_change_pct)} tone={directionTone} chrome="border-slate-200 dark:border-white/[0.08] bg-slate-50 dark:bg-slate-800/50" />
        <CompactChip label="Vol" value={`${fmtNumber(scan.volume_vs_average, 2)}x`} tone={volTone} chrome="border-slate-200 dark:border-white/[0.08] bg-slate-50 dark:bg-slate-800/50" />
        <CompactChip label="Candles" value={`${scan.consecutive_same_direction_candles} ${scan.candle_direction}`} tone={consistencyTone} chrome="border-slate-200 dark:border-white/[0.08] bg-slate-50 dark:bg-slate-800/50" />
        {scan.trending && <CompactChip label="Flag" value="TRENDING" tone="text-semantic-bullish" chrome="border-emerald-400/40 bg-emerald-50 dark:bg-emerald-500/10" />}
      </div>
    )
  }
  return (
    <div className="grid grid-cols-3 gap-2">
      <SignalMetric label="Session" value={fmtPct(scan.session_change_pct)} tone={directionTone} />
      <SignalMetric label="Vol / Avg" value={`${fmtNumber(scan.volume_vs_average, 2)}x`} tone={volTone} />
      <SignalMetric label="Candles" value={`${scan.consecutive_same_direction_candles} ${scan.candle_direction}`} tone={consistencyTone} />
    </div>
  )
}

function SignalFeedTableSection({
  title,
  subtitle,
  engine,
  sourceFilter,
  rows,
  favoriteSet,
  ignoredSet,
  alertBusy,
  onOpenEngine,
  onAnalyze,
  onAddToPositions,
  onOpenAlerts,
  onCreateAlert,
  onFavorite,
  onIgnore,
  onMonitor,
}: {
  title: string
  subtitle: string
  engine: EngineKey
  sourceFilter: SourceFilter
  rows: SignalFeedRow[]
  favoriteSet: Set<string>
  ignoredSet: Set<string>
  alertBusy: Record<string, boolean>
  onOpenEngine: (row: SignalFeedRow, engine: EngineKey) => void
  onAnalyze: (ticker: string) => void
  onAddToPositions: (row: SignalFeedRow) => void
  onOpenAlerts: (row: SignalFeedRow) => void
  onCreateAlert: (row: SignalFeedRow) => void
  onFavorite: (ticker: string) => void
  onIgnore: (ticker: string) => void
  onMonitor: (row: SignalFeedRow) => void
}) {
  const actionable = rows.filter(row => ['READY', 'WATCH', 'MANAGE'].includes(engineDecisionValue(row, engine).toUpperCase())).length

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-white/[0.06] px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-bold uppercase tracking-wide text-heading">{title}</h2>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${sourceChipClass(engine)}`}>
              {engineTitle(engine)}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted">{subtitle}</p>
        </div>
        <div className="text-right text-xs text-muted">
          <span className="font-semibold text-secondary">{rows.length}</span> rows
          <span className="mx-1 text-slate-300 dark:text-slate-700">/</span>
          <span className="font-semibold text-secondary">{actionable}</span> actionable
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[1320px] w-full border-collapse text-left">
          <thead className="bg-slate-50 dark:bg-slate-950/40">
            <tr className="text-[10px] font-bold uppercase tracking-wide text-muted">
              <th className="w-[16%] px-4 py-2">Ticker</th>
              <th className="w-[9%] px-3 py-2">Price</th>
              <th className="w-[11%] px-3 py-2">Verdict</th>
              <th className="w-[24%] px-3 py-2">Trading Overview</th>
              <th className="w-[21%] px-3 py-2">OR / VWAP</th>
              <th className="w-[13%] px-3 py-2">Reason</th>
              <th className="w-[6%] px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-white/[0.05]">
            {rows.map(row => {
              const block = engineDecisionBlock(row, engine)
              const decision = engineDecisionValue(row, engine)
              const ticker = row.ticker.toUpperCase()
              const changeTone = row.price_change_pct > 0 ? 'text-semantic-bullish' : row.price_change_pct < 0 ? 'text-semantic-bearish' : 'text-tertiary'
              const isFavorite = favoriteSet.has(ticker)
              const isIgnored = ignoredSet.has(ticker)
              const reason = block.reason || block.normalized_reason || row.agreement_reason || row.ai_summary

              return (
                <tr key={`${engine}-${row.id}`} className="align-top hover:bg-slate-50/80 dark:hover:bg-white/[0.025]">
                  <td className="px-4 py-3">
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        onClick={() => onFavorite(row.ticker)}
                        title={isFavorite ? 'Unfavorite' : 'Favorite'}
                        className={`mt-0.5 shrink-0 ${isFavorite ? 'text-amber-400' : 'text-muted hover:text-amber-400'}`}
                      >
                        <Star size={13} className={isFavorite ? 'fill-current' : ''} />
                      </button>
                      <div className="min-w-0">
                        <button type="button" onClick={() => onOpenEngine(row, engine)} className="font-mono text-sm font-bold text-heading hover:text-info">
                          {ticker}
                        </button>
                        <div className="mt-0.5 truncate text-xs text-secondary">{row.company_name || ticker}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-muted">
                          {row.sector && <span>{row.sector}</span>}
                          {row.alerts_count > 0 && <span className="rounded-full bg-rose-50 px-1.5 py-0.5 font-semibold text-rose-600 dark:bg-rose-900/30 dark:text-rose-300">{row.alerts_count} alerts</span>}
                          {isIgnored && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">ignored</span>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="font-mono text-sm font-bold tabular-nums text-heading">{fmtPrice(row.price)}</div>
                    <div className={`mt-0.5 font-mono text-xs font-semibold tabular-nums ${changeTone}`}>{fmtPct(row.price_change_pct)}</div>
                    {row.price_change != null && row.price_change !== 0 && (
                      <div className={`font-mono text-[10px] tabular-nums ${changeTone}`}>{fmtDayChange(row.price_change)}</div>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-1">
                      <StatusPill value={decision} />
                      {sourceFilter !== engine && <StatusPill value={normalizeAgreementBadge(row)} agreement />}
                    </div>
                    {block.confidence != null && Number.isFinite(block.confidence) && (
                      <div className="mt-1 text-[10px] text-muted">{fmtNumber(block.confidence, 0)} confidence</div>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <EngineOverviewStrip row={row} />
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted">
                      {block.expected_holding_period && <span>Hold <span className="font-semibold text-secondary">{block.expected_holding_period}</span></span>}
                      {block.recommended_contract_duration && <span>DTE <span className="font-semibold text-secondary">{block.recommended_contract_duration}</span></span>}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="space-y-2">
                      <DayLevelsBlock row={row} />
                      <MorningTrendMetrics row={row} />
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <p className="line-clamp-3 text-xs leading-5 text-secondary">{reason || 'No engine note available.'}</p>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap justify-end gap-1">
                      <button type="button" onClick={() => onOpenEngine(row, engine)} className={`${getActionButtonClass('surface')} px-2 py-1 text-[10px]`}>Open</button>
                      <button type="button" onClick={() => onAnalyze(row.ticker)} className={`${getActionButtonClass('analyze')} px-2 py-1 text-[10px]`}>Analyze</button>
                      <button type="button" onClick={() => onAddToPositions(row)} className={`${getActionButtonClass('trade')} px-2 py-1 text-[10px]`}>Trade</button>
                      <button type="button" onClick={() => onOpenAlerts(row)} className={`${getActionButtonClass('surface')} px-2 py-1 text-[10px]`}>Alerts</button>
                      <button type="button" onClick={() => onCreateAlert(row)} disabled={Boolean(alertBusy[row.id])} className={`${getActionButtonClass('alert')} px-2 py-1 text-[10px]`}>
                        {alertBusy[row.id] ? 'Creating' : 'New'}
                      </button>
                      <button type="button" onClick={() => onMonitor(row)} className={`${getActionButtonClass('surface')} px-2 py-1 text-[10px]`}>Watch</button>
                      <button type="button" onClick={() => onIgnore(row.ticker)} className={`${getActionButtonClass('surface')} px-2 py-1 text-[10px]`}>
                        {isIgnored ? 'Unhide' : 'Hide'}
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}



const SignalFeedCard = memo(function SignalFeedCard({
  row,
  isCompact,
  isFavorite,
  isIgnored,
  alertBusy,
  canDay,
  canSwing,
  onToggleCompact,
  onAnalyze,
  onViewChart,
  onCreateAlert,
  onAddToPositions,
  onFavorite,
  onIgnore,
  onMonitor,
}: {
  row: SignalFeedRow
  isCompact: boolean
  isFavorite: boolean
  isIgnored: boolean
  alertBusy: boolean
  canDay: boolean
  canSwing: boolean
  onAnalyze: () => void
  onViewChart: () => void
  onCreateAlert: () => void
  onAddToPositions: () => void
  onFavorite: () => void
  onIgnore: () => void
  onMonitor: () => void
  onToggleCompact: (id: string) => void
}) {
  const agreementBadge = normalizeAgreementBadge(row)
  const changeTone = row.price_change_pct > 0 ? 'text-semantic-bullish' : row.price_change_pct < 0 ? 'text-semantic-bearish' : 'text-tertiary'
  const updatedLabel = row.cache_age_seconds != null && Number.isFinite(row.cache_age_seconds)
    ? `${Math.max(0, Math.round(row.cache_age_seconds))}s ago`
    : 'cached'
  const handleToggleCompact = useCallback(() => onToggleCompact(row.id), [onToggleCompact, row.id])

  const accentBorder =
    agreementBadge === 'STRONG_BULLISH' ? 'border-l-emerald-500'
    : agreementBadge === 'PARTIAL_AGREEMENT' ? 'border-l-sky-400'
    : agreementBadge === 'CONFLICT' ? 'border-l-fuchsia-500'
    : (agreementBadge === 'NO_EDGE' || agreementBadge === 'AVOID') ? 'border-l-rose-500'
    : (agreementBadge === 'EXTENDED' || agreementBadge === 'MANAGE') ? 'border-l-amber-400'
    : 'border-l-slate-300 dark:border-l-slate-600'

  return (
    <article className={`w-full rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900 transition-shadow border-l-[3px] ${accentBorder}`}>

      {/* Header */}
      <div className="flex items-start justify-between gap-2 px-3 pt-2.5 pb-2">
        <div className="min-w-0 flex-1">
          {/* Row 1: ticker + fav + agreement state */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button type="button" onClick={onViewChart} className="font-mono text-base font-bold tracking-tight text-heading hover:text-info">
              {row.ticker}
            </button>
            <button
              type="button"
              onClick={onFavorite}
              title={isFavorite ? 'Unfavorite' : 'Favorite'}
              className={`-ml-0.5 ${isFavorite ? 'text-amber-400' : 'text-muted hover:text-amber-400'}`}
            >
              <Star size={12} className={isFavorite ? 'fill-current' : ''} />
            </button>
            <StatusPill value={agreementBadge} agreement />
          </div>
          {/* Row 2: company · sector · updated */}
          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted">
            <span className="text-secondary font-medium">{row.company_name || row.ticker}</span>
            {row.sector && <><span className="opacity-30">·</span><span className="opacity-60">{row.sector}</span></>}
            <span className="opacity-30">·</span>
            <span>{updatedLabel}</span>
          </div>
        </div>

        {/* Price hero */}
        <div className="shrink-0 text-right">
          <div className="font-mono text-base font-bold tabular-nums leading-tight tracking-tight text-heading">{fmtPrice(row.price)}</div>
          <div className={`text-[11px] font-semibold tabular-nums ${changeTone}`}>{fmtPct(row.price_change_pct)}</div>
          {row.price_change != null && row.price_change !== 0 && (
            <div className={`text-[10px] tabular-nums ${changeTone}`}>{fmtDayChange(row.price_change)}</div>
          )}
          {row.alerts_count > 0 && (
            <div className="mt-0.5 inline-flex items-center gap-1 rounded-full border border-rose-400/40 bg-rose-50 dark:bg-rose-900/30 px-2 py-0.5 text-[10px] font-medium text-rose-600 dark:text-rose-300">
              <BellPlus size={10} /> {row.alerts_count}
            </div>
          )}
        </div>
      </div>

      {/* Engine Cards Grid \u2014 or compact pills */}
      {isCompact ? (
        <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2">
          {canDay && <SourcePill source="day" decision={row.day_decision} />}
          {canSwing && <SourcePill source="swing" decision={row.swing_decision} />}
          <SourcePill source="regular" decision={row.regular_decision} />
        </div>
      ) : (
        <EngineCardsGrid row={row} canDay={canDay} canSwing={canSwing} />
      )}

      {/* Morning trend scan */}
      <MorningTrendMetrics row={row} compact />

      {/* AI insight \u2014 shown in compact mode; in full mode it lives in the Chart details panel */}
      {isCompact && (
        <div className="flex items-start gap-1.5 px-3 pb-2 text-sm text-secondary">
          <Sparkles size={11} className="mt-px shrink-0 text-violet-400" />
          <p className="min-w-0 leading-snug line-clamp-2">{row.ai_summary}</p>
        </div>
      )}

      {/* Action footer */}
      <div className="flex items-center gap-1 border-t border-slate-100 dark:border-white/[0.05] px-3 py-1.5">
        <button type="button" onClick={onAnalyze} className={`${getActionButtonClass('analyze')} px-2 py-0.5 text-[10px]`}>
          Analyze
        </button>
        <button type="button" onClick={onAddToPositions} className={`${getActionButtonClass('trade')} px-2 py-0.5 text-[10px]`}>
          Trade
        </button>
        <button type="button" onClick={onCreateAlert} disabled={alertBusy} className={`${getActionButtonClass('alert')} px-2 py-0.5 text-[10px]`}>
          {alertBusy ? 'Creating\u2026' : 'Alert'}
        </button>
        <button type="button" onClick={onMonitor} className={`${getActionButtonClass('surface')} inline-flex items-center gap-0.5 px-2 py-0.5 text-[10px]`}>
          <Monitor size={10} /> Monitor
        </button>
        <div className="relative ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={handleToggleCompact}
            className={`${getActionButtonClass('surface')} inline-flex items-center gap-0.5 px-2 py-0.5 text-[10px]`}
          >
            {isCompact ? <><ChevronDown size={10} />Expand</> : <><ChevronUp size={10} />Compact</>}
          </button>
          <button
            type="button"
            onClick={onIgnore}
            className={`${getActionButtonClass('surface')} inline-flex items-center gap-0.5 px-2 py-0.5 text-[10px]`}
          >
            <EyeOff size={10} /> {isIgnored ? 'Unignore' : 'Ignore'}
          </button>
        </div>
      </div>
    </article>
  )
})

function MobileActionTray({
  row,
  isFavorite,
  alertBusy,
  isOpen,
  onAnalyze,
  onAddToPositions,
  onCreateAlert,
  onFavorite,
  onRemove,
  onToggle,
  onMonitor,
}: {
  row: SignalFeedRow | null
  isFavorite: boolean
  alertBusy: boolean
  isOpen: boolean
  onAnalyze: () => void
  onAddToPositions: () => void
  onCreateAlert: () => void
  onFavorite: () => void
  onRemove: () => void
  onToggle: () => void
  onMonitor: () => void
}) {
  if (!row) return null
  return (
    <div className="sm:hidden fixed bottom-4 left-4 right-4 z-40 rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-slate-900 p-3 shadow-[0_14px_32px_rgba(2,6,23,0.22)] backdrop-blur">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-base font-bold text-heading">{row.ticker}</div>
          <div className="truncate text-xs text-tertiary">{row.company_name}</div>
        </div>
        <StatusPill value={normalizeAgreementBadge(row)} agreement />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <button type="button" onClick={onAnalyze} className={`${getActionButtonClass('analyze')} gap-1 rounded-xl px-2 py-2 text-xs`}>Analyze</button>
        <button type="button" onClick={onAddToPositions} className={`${getActionButtonClass('trade')} gap-1 rounded-xl px-2 py-2 text-xs`}>Add Trade</button>
        <button type="button" onClick={onCreateAlert} disabled={alertBusy} className={`${getActionButtonClass('alert')} gap-1 rounded-xl px-2 py-2 text-xs`}>{alertBusy ? 'Busy\u2026' : 'Alert'}</button>
        <button type="button" onClick={onFavorite} className={`${getActionButtonClass('surface')} gap-1 rounded-xl px-2 py-2 text-xs`}>{isFavorite ? 'Unfavorite' : 'Favorite'}</button>
        <button type="button" onClick={onRemove} className="btn btn-danger gap-1 rounded-xl px-2 py-2 text-xs">Remove</button>
        <button type="button" onClick={onToggle} className={`${getActionButtonClass('surface')} gap-1 rounded-xl px-2 py-2 text-xs`}>{isOpen ? 'Collapse' : 'Expand'}</button>
        <button type="button" onClick={onMonitor} className={`${getActionButtonClass('surface')} gap-1 rounded-xl px-2 py-2 text-xs`}>Monitor</button>
      </div>
    </div>
  )
}


function TopPickCard({ row, onOpen }: { row: SignalFeedRow; onOpen: () => void }) {
  const score = compositeScore(row)
  const changeTone = row.price_change_pct > 0 ? 'text-semantic-bullish' : row.price_change_pct < 0 ? 'text-semantic-bearish' : 'text-tertiary'
  const dotColor = (d: string) => {
    const u = String(d || '').toUpperCase()
    if (u === 'READY') return 'bg-emerald-500'
    if (u === 'WATCH') return 'bg-sky-400'
    if (u === 'WAIT') return 'bg-amber-400'
    return 'bg-slate-300 dark:bg-slate-600'
  }
  const engines = [
    { key: 'D', decision: row.day_decision },
    { key: 'S', decision: row.swing_decision },
    { key: 'R', decision: row.regular_decision },
  ]
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-w-[130px] max-w-[170px] flex-1 flex-col gap-2.5 rounded-xl border border-violet-400/25 bg-white p-3 text-left transition-all hover:border-violet-400/50 hover:shadow-md dark:bg-slate-900"
    >
      <div className="flex items-start justify-between gap-1">
        <div>
          <div className="font-mono text-sm font-bold text-heading">{row.ticker}</div>
          <div className={`font-mono text-[11px] font-semibold tabular-nums ${changeTone}`}>
            {row.price_change_pct >= 0 ? '+' : ''}{row.price_change_pct?.toFixed(2)}%
          </div>
        </div>
        <div className="font-mono text-xs font-bold tabular-nums text-heading">{fmtPrice(row.price)}</div>
      </div>
      <div className="flex items-center gap-1.5">
        {engines.map(e => (
          <div key={e.key} className="flex items-center gap-0.5">
            <span className={`h-2 w-2 rounded-full ${dotColor(e.decision)}`} />
            <span className="text-[9px] font-bold text-muted">{e.key}</span>
          </div>
        ))}
        <div className="ml-auto h-1 w-10 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${(score / 9) * 100}%` }} />
        </div>
      </div>
    </button>
  )
}

export default function SignalFeedPage() {
  const routerNavigate = useNavigate()
  const { requestAnalysis, removeFromAllWatchlists, canAccessPage } = useApp()
  const canDay   = canAccessPage('day-trade')
  const canSwing = canAccessPage('swing-trade')

  if (!canDay && !canSwing) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <Star size={36} className="mx-auto mb-3 text-gray-600 opacity-40" />
          <div className="text-base font-semibold text-gray-400 mb-1">Signal Feed</div>
          <p className="text-sm text-gray-600">
            Signal Feed is available to Day Trade and Swing Trade subscribers.
            Upgrade your plan to access unified cross-engine signals.
          </p>
        </div>
      </div>
    )
  }
  const [searchParams, setSearchParams] = useSearchParams()
  const [env, setEnv] = useState<ApiEnvelope<SignalFeedPayload> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: NoticeTone; message: string } | null>(null)
  const [alertBusy, setAlertBusy] = useState<Record<string, boolean>>({})
  const [filtersExpanded, setFiltersExpanded] = useState<boolean>(() => loadJson<boolean>(FILTERS_EXPANDED_KEY, false))
  const [searchInput, setSearchInput] = useState(searchParams.get('q')?.trim() ?? '')
  const [favorites, setFavorites] = useState<string[]>(() => loadJson<string[]>(FAVORITES_KEY, []))
  const deferredSearch = useDeferredValue(searchInput)
  const [showMoreStats, setShowMoreStats] = useState(false)
  const [marketExpanded, setMarketExpanded] = useState(false)
  const [showAddTicker, setShowAddTicker] = useState(false)
  const moreStatsRef = useRef<HTMLButtonElement>(null)
  const [ignoredData, setIgnoredData] = useState<IgnoredData>(loadIgnored)
  const [showInfo, setShowInfo] = useState(false)
  const [showIgnored, setShowIgnored] = useState(false)
  const [onlyIgnored, setOnlyIgnored] = useState(false)
  const [compactIds, setCompactIds] = useState<Set<string>>(new Set())

  const toggleCompact = useCallback((id: string) => {
    setCompactIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  useEffect(() => { saveJson(FAVORITES_KEY, favorites) }, [favorites])
  useEffect(() => { saveJson(FILTERS_EXPANDED_KEY, filtersExpanded) }, [filtersExpanded])
  useEffect(() => { saveIgnored(ignoredData) }, [ignoredData])

  const favoriteSet = useMemo(() => new Set(favorites.map(item => item.toUpperCase())), [favorites])
  const ignoredSet = useMemo(() => new Set(ignoredData.tickers.map(t => t.toUpperCase())), [ignoredData])

  const toggleIgnore = useCallback((ticker: string) => {
    setIgnoredData(prev => {
      const sym = ticker.toUpperCase()
      const exists = prev.tickers.some(t => t.toUpperCase() === sym)
      return {
        ...prev,
        tickers: exists
          ? prev.tickers.filter(t => t.toUpperCase() !== sym)
          : [...prev.tickers, sym],
      }
    })
  }, [])

  const sourceFilter = useMemo<SourceFilter>(() => {
    const raw = searchParams.get('source')?.trim().toLowerCase()
    return raw === 'day' || raw === 'swing' || raw === 'regular' ? raw : 'all'
  }, [searchParams])

  const stateFilter = useMemo<StateFilter>(() => {
    const raw = searchParams.get('state')?.trim().toLowerCase()
    return STATE_OPTIONS.some(o => o.value === raw) ? (raw as StateFilter) : 'all'
  }, [searchParams])

  const agreementFilter = useMemo<AgreementFilter>(() => {
    const raw = searchParams.get('agreement')?.trim().toLowerCase()
    return AGREEMENT_OPTIONS.some(o => o.value === raw) ? (raw as AgreementFilter) : 'all'
  }, [searchParams])

  const trendFilter = useMemo<TrendFilter>(() => {
    const raw = searchParams.get('trend_filter')?.trim().toLowerCase()
    return TREND_OPTIONS.some(o => o.value === raw) ? (raw as TrendFilter) : 'all'
  }, [searchParams])

  const sectorFilter = searchParams.get('sector')?.trim() || 'all'

  const sortBy = useMemo<SortField>(() => {
    const raw = searchParams.get('sort_by')?.trim().toLowerCase()
    return SORT_OPTIONS.some(o => o.value === raw) ? (raw as SortField) : 'engine_agreement'
  }, [searchParams])

  const sortDir = searchParams.get('sort_dir') === 'asc' ? 'asc' : 'desc'
  const page = Math.max(1, Number(searchParams.get('page') || '1') || 1)
  const pageSize = Math.max(10, Math.min(100, Number(searchParams.get('page_size') || '24') || 24))

  // Sync URL → local state only when the 'q' param itself changes (e.g. browser back/forward).
  // BUG FIX: removed `searchInput` from deps — having it there caused the effect to fire on
  // every keystroke, read the still-stale URL (deferredSearch hadn't committed yet) and reset
  // the field back to '' immediately after the user typed a character.
  const prevUrlQRef = useRef(searchParams.get('q')?.trim() ?? '')
  useEffect(() => {
    const urlQ = searchParams.get('q')?.trim() ?? ''
    if (urlQ !== prevUrlQRef.current) {
      prevUrlQRef.current = urlQ
      setSearchInput(urlQ)
    }
  }, [searchParams])

  useEffect(() => {
    const current = searchParams.get('q')?.trim() ?? ''
    if (current === deferredSearch.trim()) return
    const next = new URLSearchParams(searchParams)
    const value = deferredSearch.trim()
    if (value) next.set('q', value)
    else next.delete('q')
    next.set('page', '1')
    setSearchParams(next, { replace: true })
  }, [deferredSearch, searchParams, setSearchParams])

  const setParam = useCallback(
    (key: string, value: string | null, resetPage = false) => {
      const next = new URLSearchParams(searchParams)
      if (value == null || value === '') next.delete(key)
      else next.set(key, value)
      if (resetPage) next.set('page', '1')
      setSearchParams(next)
    },
    [searchParams, setSearchParams],
  )

  const load = useCallback(async (forceRefresh = false) => {
    setLoading(true)
    setError(null)
    try {
      // BUG FIX: search is now client-side only — do NOT pass it here.
      // Passing search in the URL caused searchParams to change on every keystroke
      // (via the deferredSearch effect), which recreated `load` and triggered a
      // redundant backend fetch for each character typed.
      const next = await fetchSignalFeed({
        source: sourceFilter === 'all' ? undefined : sourceFilter,
        sort_by: sortBy,
        sort_dir: sortDir,
        page,
        page_size: pageSize,
        refresh: forceRefresh,
      })
      setEnv(next)
    } catch (err) {
      setError(axiosErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, sortBy, sortDir, sourceFilter])

  useEffect(() => { void load(false) }, [load])

  const payload = env?.data
  const rows = payload?.rows ?? []
  const summary = payload?.summary ?? { total: 0, ready: 0, watch: 0, extended: 0, avoid: 0, conflict: 0, manage: 0, alerts: 0, strong_bullish: 0, strong_bearish: 0 }
  const aiSummary = payload?.ai_summary ?? { headline: 'No Signal Feed items yet', message: 'Add tickers to start the Signal Feed pipeline.', best_focus: 'Use Position Trading, day trade, or swing trade flows to seed tickers.', counts: {} }
  const pagination = payload?.pagination ?? { page: 1, page_size: pageSize, total: 0, total_pages: 1 }

  const sectors = useMemo(() => {
    return [...new Set(rows.map(r => r.sector).filter((s): s is string => Boolean(s && s !== 'N/A')))].sort((a, b) => a.localeCompare(b))
  }, [rows])

  const visibleRows = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase()
    return rows.filter(row => {
      const isIgnored = ignoredSet.has(row.ticker.toUpperCase())
      if (onlyIgnored) return isIgnored
      if (isIgnored) return false
      if (q) {
        const tickerMatch = row.ticker.toLowerCase().includes(q)
        const nameMatch = String(row.company_name ?? '').toLowerCase().includes(q)
        if (!tickerMatch && !nameMatch) return false
      }
      if (!matchesStateFilter(row, stateFilter, sourceFilter)) return false
      if (!matchesAgreementFilter(row, agreementFilter)) return false
      if (trendFilter !== 'all' && normalizeTrendFilter(row.trend) !== trendFilter) return false
      if (sectorFilter !== 'all' && (row.sector || 'N/A') !== sectorFilter) return false
      return true
    })
  }, [deferredSearch, agreementFilter, ignoredSet, onlyIgnored, rows, sectorFilter, sourceFilter, stateFilter, trendFilter])

  const trendingTodayRows = useMemo(
    () => visibleRows.filter(row => row.trending_today || row.morning_scan?.trending),
    [visibleRows],
  )

  const topPickRows = useMemo(
    () =>
      [...visibleRows]
        .sort((a, b) => compositeScore(b) - compositeScore(a))
        .filter(row => compositeScore(row) >= 5),
    [visibleRows],
  )

  const sortedVisibleRows = useMemo(
    () =>
      sourceFilter === 'all'
        ? [...visibleRows].sort((a, b) => compositeScore(b) - compositeScore(a))
        : visibleRows,
    [visibleRows, sourceFilter],
  )

  const engineCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    const getVal = (row: SignalFeedRow): string => {
      if (sourceFilter === 'all') return String(row.agreement_state || '').toLowerCase()
      if (sourceFilter === 'day') return String(row.day_decision || '').toLowerCase()
      if (sourceFilter === 'swing') return String(row.swing_decision || '').toLowerCase()
      return String(row.regular_decision || '').toLowerCase()
    }
    for (const row of rows) {
      const val = getVal(row)
      counts[val] = (counts[val] || 0) + 1
    }
    return counts
  }, [rows, sourceFilter])

  const marketStrip = useMemo(() => {
    const row = visibleRows[0] || rows[0]
    const dayMetrics = row?.day.metrics as Record<string, unknown> | undefined
    return {
      marketContext: row?.metrics?.market_context || 'MARKET_MIXED',
      spyBias: typeof dayMetrics?.spy_bias === 'string' ? dayMetrics.spy_bias : '',
      qqqBias: typeof dayMetrics?.qqq_bias === 'string' ? dayMetrics.qqq_bias : '',
      fetchedAt: env?.fetched_at,
    }
  }, [env?.fetched_at, rows, visibleRows])

  const activeRow = useMemo(
    () => visibleRows.find(row => row.id === expandedId) ?? rows.find(row => row.id === expandedId) ?? null,
    [expandedId, rows, visibleRows],
  )

  const clearAllFilters = useCallback(() => {
    const next = new URLSearchParams(searchParams)
    next.delete('source')
    next.delete('state')
    next.delete('agreement')
    next.delete('trend_filter')
    next.delete('sector')
    next.set('page', '1')
    setSearchParams(next)
  }, [searchParams, setSearchParams])

  // Source filter is shown in the engine tab bar — omit from chip strip to avoid duplication
  const activeFilters = useMemo(() => {
    const chips: Array<{ key: string; label: string; onRemove: () => void }> = []
    if (stateFilter !== 'all') chips.push({ key: 'state', label: STATE_OPTIONS.find(o => o.value === stateFilter)?.label ?? stateFilter.toUpperCase(), onRemove: () => setParam('state', null, true) })
    if (agreementFilter !== 'all') chips.push({ key: 'agreement', label: AGREEMENT_OPTIONS.find(o => o.value === agreementFilter)?.label ?? agreementFilter, onRemove: () => setParam('agreement', null, true) })
    if (trendFilter !== 'all') chips.push({ key: 'trend', label: TREND_OPTIONS.find(o => o.value === trendFilter)?.label ?? trendFilter, onRemove: () => setParam('trend_filter', null, true) })
    if (sectorFilter !== 'all') chips.push({ key: 'sector', label: sectorFilter, onRemove: () => setParam('sector', null, true) })
    return chips
  }, [stateFilter, agreementFilter, trendFilter, sectorFilter, setParam])

  const noticeClass =
    notice?.tone === 'success'
      ? 'border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/12 text-emerald-800 dark:text-emerald-100'
      : notice?.tone === 'warning'
        ? 'border-amber-500/30 bg-amber-50 dark:bg-amber-500/12 text-amber-800 dark:text-amber-100'
        : 'border-sky-500/30 bg-sky-50 dark:bg-sky-500/12 text-sky-800 dark:text-sky-100'

  const engineLabel = sourceFilter === 'all' ? 'Overall' : sourceFilter.charAt(0).toUpperCase() + sourceFilter.slice(1)
  const sourceSubtitle = sourceFilter === 'all' ? 'All engines in one view' : `Filtering by ${sourceFilter} engine decision`
  const tableGroups = useMemo(() => {
    return SIGNAL_TABLE_GROUPS.filter(group => {
      if (sourceFilter !== 'all' && group.engine !== sourceFilter) return false
      if (group.engine === 'day') return canDay
      if (group.engine === 'swing') return canSwing
      return true
    })
  }, [canDay, canSwing, sourceFilter])

  const toggleExpanded = useCallback((id: string) => { setExpandedId(cur => (cur === id ? null : id)) }, [])
  const toggleFavorite = useCallback((ticker: string) => {
    const norm = ticker.toUpperCase()
    setFavorites(cur => cur.map(t => t.toUpperCase()).includes(norm) ? cur.filter(t => t.toUpperCase() !== norm) : [...cur, norm])
  }, [])
  const handleAnalyze = useCallback((ticker: string) => requestAnalysis(ticker), [requestAnalysis])
  const handleTickerDetail = useCallback((row: SignalFeedRow) => routerNavigate(row.actions.chart_url || row.actions.analyze_url || '/'), [routerNavigate])
  const handleOpenEngine = useCallback((row: SignalFeedRow, engine: EngineKey) => {
    const route = getEngineRoute(engine, row.ticker)
    if (engine === 'regular') requestAnalysis(row.ticker)
    routerNavigate(route || row.actions.chart_url || row.actions.analyze_url || '/')
  }, [requestAnalysis, routerNavigate])
  const handleAddToPositions = useCallback((row: SignalFeedRow) => {
    if (!row.actions.positions_url) { setNotice({ tone: 'info', message: `${row.ticker} add-trade route is not wired yet.` }); return }
    routerNavigate(row.actions.positions_url)
  }, [routerNavigate])
  const handleOpenAlerts = useCallback((row: SignalFeedRow) => routerNavigate(row.actions.alerts_url || ROUTES.alerts), [routerNavigate])
  const handleCreateAlert = useCallback(async (row: SignalFeedRow) => {
    setAlertBusy(cur => ({ ...cur, [row.id]: true }))
    try {
      await createSignalFeedAlert({ ticker: row.ticker, agreement_state: row.agreement_state, message: `${row.ticker} ${row.agreement_state.toLowerCase()} watchlist alert`, recommended_action: row.agreement_reason })
      setNotice({ tone: 'success', message: `${row.ticker} alert created in Alert Center.` })
    } catch (err) {
      setNotice({ tone: 'warning', message: axiosErrorMessage(err) })
    } finally {
      setAlertBusy(cur => ({ ...cur, [row.id]: false }))
    }
  }, [])
  const handleMonitor = useCallback((row: SignalFeedRow) => {
    const sym = row.ticker.toUpperCase()
    try {
      const existing: string[] = JSON.parse(localStorage.getItem('oa_dashboard_tickers_day') ?? '[]')
      if (!existing.includes(sym) && existing.length < 8) {
        localStorage.setItem('oa_dashboard_tickers_day', JSON.stringify([...existing, sym]))
      }
    } catch { /* quota */ }
    routerNavigate(ROUTES.dayTradeDashboard)
  }, [routerNavigate])
  const handleRemove = useCallback((row: SignalFeedRow) => {
    removeFromAllWatchlists(row.ticker)
    setEnv(cur => cur && cur.data ? { ...cur, data: { ...cur.data, rows: cur.data.rows.filter(r => r.id !== row.id) } } : cur)
    setExpandedId(cur => (cur === row.id ? null : cur))
    setNotice({ tone: 'success', message: `${row.ticker} removed from watchlist.` })
  }, [removeFromAllWatchlists])

  return (
    <div className="signal-feed-page mx-auto min-h-screen max-w-6xl space-y-4 p-4 md:p-6 text-primary">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-600/20 border border-indigo-700 flex items-center justify-center shrink-0">
              <SatelliteDish size={18} className="text-indigo-400" />
            </div>
            <h1 className="tcc-hero-title text-2xl font-bold tracking-tight text-heading sm:text-3xl">Signal Feed</h1>
            <span className="rounded-full border border-semantic-info-border bg-semantic-info-bg px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-semantic-info">Unified Engine View</span>
            <div className="relative">
              <button type="button" onClick={() => setShowInfo(!showInfo)} className="text-muted hover:text-secondary transition-colors">
                <Info size={16} />
              </button>
              {showInfo && (
                <div className="absolute left-0 top-full mt-1.5 z-50 w-72 rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-slate-900 px-3 py-2.5 text-xs text-gray-600 dark:text-gray-400 shadow-lg">
                  Unified SignalFeed separates market bias from actual execution readiness. A bullish backdrop only becomes actionable when setup quality and agreement line up.
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => routerNavigate(ROUTES.alerts)} className={`${getActionButtonClass('alert')} gap-2 rounded-full px-3 py-2 text-sm`}><AlertTriangle size={16} /> Alert Center</button>
          <button type="button" onClick={() => routerNavigate(ROUTES.positions)} className={`${getActionButtonClass('trade')} gap-2 rounded-full px-3 py-2 text-sm`}><BriefcaseBusiness size={16} /> Positions</button>
          <button type="button" onClick={() => void load(true)} className={`${getActionButtonClass('surface')} gap-2 rounded-full px-3 py-2 text-sm`}><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh</button>
        </div>
      </header>

      {notice ? (
        <div className={`flex items-start justify-between gap-3 rounded-[24px] border px-4 py-3 text-sm ${noticeClass}`}>
          <div>{notice.message}</div>
          <button type="button" onClick={() => setNotice(null)} className="shrink-0 text-current/80 hover:text-current"><X size={16} /></button>
        </div>
      ) : null}

      <section className="flex flex-wrap items-center gap-2">
        <SummaryCard label="Total" value={String(rows.length)} tone="text-heading" />
        <SummaryCard label="Ready" value={String(engineCounts.ready ?? 0)} tone="text-semantic-bullish" />
        <SummaryCard label="Conflict" value={String(engineCounts.conflict ?? 0)} tone="text-semantic-conflict" />
        <SummaryCard label="Alerts" value={String(summary.alerts ?? rows.reduce((c, row) => c + row.alerts_count, 0))} tone="text-semantic-info" />
        <div className="relative">
          <button ref={moreStatsRef} type="button" onClick={() => setShowMoreStats(o => !o)}
            className="inline-flex items-center gap-1 rounded-lg border border-border/25 bg-surface-muted px-2.5 py-2 text-xs font-semibold text-muted hover:text-secondary transition-colors"
          >
            More Stats <ChevronDown size={12} className={`transition-transform ${showMoreStats ? 'rotate-180' : ''}`} />
          </button>
          {showMoreStats && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setShowMoreStats(false)} />
              <div className="absolute right-0 top-full z-30 mt-1.5 w-44 rounded-xl border border-border/25 bg-surface-card p-2 shadow-lg">
                {[
                  { label: 'Watch', value: engineCounts.watch ?? 0, tone: 'text-semantic-warning' },
                  { label: 'Wait', value: engineCounts.wait ?? 0, tone: 'text-semantic-warning' },
                  { label: 'Avoid', value: engineCounts.avoid ?? 0, tone: 'text-semantic-bearish' },
                  { label: 'Extended', value: engineCounts.extended ?? 0, tone: 'text-semantic-extended' },
                ].map(item => (
                  <div key={item.label} className="flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs hover:bg-surface-muted/30">
                    <span className="text-muted">{item.label}</span>
                    <span className={`font-semibold tabular-nums ${item.tone}`}>{item.value}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      {/* ── Filter bar ── */}
      <section className="sticky top-3 z-20 rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-slate-900 p-3 shadow-sm">

        {/* Top control row — always visible */}
        <div className="flex flex-wrap items-center gap-2">

          {/* Search */}
          <label className="flex min-w-[10rem] flex-1 items-center gap-2 rounded-lg border border-slate-200 dark:border-white/[0.08] bg-slate-50 dark:bg-slate-800/50 px-3 py-1.5">
            <Search size={14} className="text-muted" />
            <input value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="Search ticker or company…" className="w-full bg-transparent text-sm text-primary outline-none placeholder:text-muted" />
          </label>

          {/* Engine tabs: All / Day / Swing / Regular / Ignored */}
          <div className="flex gap-1 overflow-x-auto">
            {SOURCE_OPTIONS.filter(opt =>
              opt.value === 'all' || opt.value === 'regular' ||
              (opt.value === 'day' && canDay) || (opt.value === 'swing' && canSwing)
            ).map(opt => (
              <button key={opt.value} type="button"
                onClick={() => setParam('source', opt.value === 'all' ? null : opt.value, true)}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  sourceFilter === opt.value ? 'bg-violet-600 text-white shadow-sm' : 'text-muted hover:text-secondary bg-transparent'
                }`}
              >{opt.label}</button>
            ))}
            <button type="button"
              onClick={() => setOnlyIgnored(prev => !prev)}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                onlyIgnored ? 'bg-rose-600 text-white shadow-sm' : 'text-muted hover:text-secondary bg-transparent'
              }`}
            ><EyeOff size={12} className="inline" /> Ignored</button>

            <button type="button"
              onClick={() => setParam('state', stateFilter === 'ready' ? null : 'ready', true)}
              className={`ml-1 shrink-0 inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                stateFilter === 'ready'
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'border-violet-400/25 text-violet-600 hover:bg-violet-500/10 dark:text-violet-400'
              }`}
            >
              <Sparkles size={11} />
              Best
            </button>
          </div>

          {/* Sort + direction */}
          <label className="rounded-lg border border-slate-200 dark:border-white/[0.08] bg-slate-50 dark:bg-slate-800/50 px-2 py-1.5 text-xs text-secondary">
            <select value={sortBy} onChange={e => setParam('sort_by', e.target.value, true)} className="bg-transparent text-primary outline-none text-xs">
              {PRIMARY_SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <button type="button" onClick={() => setParam('sort_dir', sortDir === 'asc' ? 'desc' : 'asc')} className="ml-1 text-muted hover:text-secondary">
              {sortDir === 'asc' ? '↑' : '↓'}
            </button>
          </label>

          {/* Expand / Collapse Filters */}
          <button type="button" onClick={() => setFiltersExpanded(o => !o)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
              filtersExpanded
                ? 'border-violet-500/30 bg-violet-500/10 text-violet-400'
                : 'border-slate-200 dark:border-white/[0.08] text-muted hover:text-secondary'
            }`}
          >
            <Filter size={12} />
            {filtersExpanded
              ? <><ChevronUp size={11} className="shrink-0" />Collapse Filters</>
              : <><ChevronDown size={11} className="shrink-0" />Expand Filters</>}
            {activeFilters.length > 0 && <span className="h-2 w-2 rounded-full bg-violet-500 shrink-0" />}
          </button>
        </div>

        {/* Advanced filter panel — smoothly collapses via grid-rows trick */}
        <div className={`grid overflow-hidden transition-all duration-200 ease-in-out ${filtersExpanded ? 'grid-rows-[1fr] opacity-100 mt-3' : 'grid-rows-[0fr] opacity-0'}`}>
          <div className="min-h-0">
            <div className="border-t border-slate-100 dark:border-white/[0.05] pt-3 space-y-3">

              {/* Pill filter groups */}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <FilterPillGroup
                  label="Overall State"
                  options={PRIMARY_STATE_OPTIONS}
                  value={stateFilter === 'manage' ? 'all' : stateFilter}
                  onChange={value => setParam('state', value === 'all' ? null : value, true)}
                />
                <FilterPillGroup
                  label="Agreement"
                  options={PRIMARY_AGREEMENT_OPTIONS}
                  value={PRIMARY_AGREEMENT_OPTIONS.some(o => o.value === agreementFilter) ? agreementFilter : 'all'}
                  onChange={value => setParam('agreement', value === 'all' ? null : value, true)}
                />
                <FilterPillGroup
                  label="Trend"
                  options={TREND_OPTIONS}
                  value={trendFilter}
                  onChange={value => setParam('trend_filter', value === 'all' ? null : value, true)}
                />
              </div>

              {/* Selects row: Sector, Page Size, Clear */}
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1 min-w-[140px]">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Sector</div>
                  <label className="flex items-center rounded-lg border border-slate-200 dark:border-white/[0.08] bg-slate-50 dark:bg-slate-800/50 px-2 py-1.5 text-xs">
                    <select value={sectorFilter} onChange={e => setParam('sector', e.target.value === 'all' ? null : e.target.value, true)} className="bg-transparent text-primary outline-none text-xs">
                      <option value="all">All sectors</option>
                      {sectors.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                </div>
                <div className="space-y-1">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Page Size</div>
                  <label className="flex items-center rounded-lg border border-slate-200 dark:border-white/[0.08] bg-slate-50 dark:bg-slate-800/50 px-2 py-1.5 text-xs">
                    <select value={String(pageSize)} onChange={e => setParam('page_size', e.target.value, true)} className="bg-transparent text-primary outline-none text-xs">
                      {[24, 48, 96].map(size => <option key={size} value={String(size)}>{size} cards</option>)}
                    </select>
                  </label>
                </div>
                <button type="button" onClick={clearAllFilters}
                  className="rounded-lg border border-slate-200 dark:border-white/[0.08] px-3 py-1.5 text-xs font-semibold text-muted hover:text-secondary transition-colors">
                  Clear all
                </button>
              </div>

            </div>
          </div>
        </div>

        {/* Active filter chips */}
        {activeFilters.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mt-2 pt-2 border-t border-slate-100 dark:border-white/[0.05]">
            {activeFilters.map(chip => (
              <span key={chip.key} className="inline-flex items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold text-violet-400">
                {chip.label}
                <button type="button" onClick={chip.onRemove} className="hover:text-white"><X size={11} /></button>
              </span>
            ))}
          </div>
        )}
      </section>

      {topPickRows.length >= 2 && (
        <section className="rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-3 dark:bg-violet-500/10">
          <div className="mb-2.5 flex items-center gap-2">
            <Sparkles size={14} className="text-violet-500" />
            <div className="text-sm font-bold uppercase tracking-wide text-violet-800 dark:text-violet-200">Top Picks</div>
            <div className="text-xs text-violet-600/70 dark:text-violet-300/70">Highest multi-engine agreement</div>
            <div className="ml-auto rounded-full border border-violet-400/30 bg-violet-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-600 dark:text-violet-300">
              {topPickRows.length} ready
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {topPickRows.slice(0, 6).map(row => (
              <TopPickCard
                key={row.id}
                row={row}
                onOpen={() => {
                  const url = row.actions?.chart_url || row.actions?.analyze_url
                  if (url) routerNavigate(url)
                }}
              />
            ))}
          </div>
        </section>
      )}

      {trendingTodayRows.length > 0 && (
        <section className="rounded-xl border border-emerald-500/25 bg-emerald-50/70 px-4 py-3 dark:bg-emerald-500/10">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-bold uppercase tracking-wide text-emerald-800 dark:text-emerald-100">Trending Today</div>
              <div className="mt-0.5 text-xs text-emerald-700/80 dark:text-emerald-200/80">
                6:45 AM scan: move over 4%, volume over 1.5x, and 5+ same-direction 1m candles. Auto-added to Day Trade watch.
              </div>
            </div>
            <span className="rounded-full border border-emerald-500/30 bg-white/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800 dark:bg-black/20 dark:text-emerald-100">
              {trendingTodayRows.length} active
            </span>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {trendingTodayRows.slice(0, 9).map(row => {
              const scan = morningScan(row)
              const biasTone = scan.direction === 'BULLISH' ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'
              return (
                <button
                  key={`trending-${row.id}`}
                  type="button"
                  onClick={() => handleOpenEngine(row, 'day')}
                  className="rounded-lg border border-emerald-500/20 bg-white/80 px-3 py-2 text-left transition-colors hover:bg-white dark:bg-slate-950/30 dark:hover:bg-slate-900/70"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-bold text-heading">{row.ticker}</span>
                    <span className={`text-[10px] font-bold uppercase tracking-wide ${biasTone}`}>{scan.direction}</span>
                  </div>
                  <div className="mt-1 grid grid-cols-3 gap-2 text-[10px]">
                    <span><span className="text-muted">Move</span> <span className="font-mono font-semibold text-secondary">{fmtPct(scan.session_change_pct)}</span></span>
                    <span><span className="text-muted">Vol</span> <span className="font-mono font-semibold text-secondary">{fmtNumber(scan.volume_vs_average, 2)}x</span></span>
                    <span><span className="text-muted">Bars</span> <span className="font-mono font-semibold text-secondary">{scan.consecutive_same_direction_candles} {scan.candle_direction}</span></span>
                  </div>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {/* ── Market context strip ── */}
      <section className="rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900 px-4 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${marketContextTone(marketStrip.marketContext)}`}>
              {String(marketStrip.marketContext).replace(/_/g, ' ')}
            </span>
            <span className="text-[11px] text-muted whitespace-nowrap">
              {engineCounts.ready ?? 0} ready · {engineCounts.conflict ?? 0} conflict
            </span>
            <span className="hidden sm:inline text-xs text-tertiary truncate max-w-[280px]">{aiSummary.headline}</span>
          </div>
          <button type="button" onClick={() => setMarketExpanded(o => !o)}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-white/[0.07] bg-slate-50 dark:bg-slate-800/50 px-2.5 py-1 text-[11px] font-semibold text-muted hover:text-secondary transition-colors"
          >
            {marketExpanded ? 'Less' : 'Details'} <ChevronDown size={11} className={`transition-transform ${marketExpanded ? 'rotate-180' : ''}`} />
          </button>
        </div>
        {marketExpanded && (
          <div className="mt-3 space-y-2 border-t border-slate-100 dark:border-white/[0.05] pt-2">
            <div className="flex flex-wrap items-center gap-2">
              {marketStrip.spyBias ? <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${getBiasBadgeClass(marketStrip.spyBias)}`}>SPY {marketStrip.spyBias}</span> : null}
              {marketStrip.qqqBias ? <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${getBiasBadgeClass(marketStrip.qqqBias)}`}>QQQ {marketStrip.qqqBias}</span> : null}
              <span className="text-[10px] text-muted">{sourceSubtitle}</span>
            </div>
            <p className="text-xs leading-5 text-secondary">{aiSummary.message}</p>
            <div className="rounded-lg border border-slate-200 dark:border-white/[0.07] bg-slate-50 dark:bg-slate-800/30 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-muted">AI focus</div>
              <div className="mt-1 text-xs text-secondary">{aiSummary.best_focus}</div>
              <div className="mt-1 text-[10px] text-muted">Updated {fmtRelativeTime(marketStrip.fetchedAt)}</div>
            </div>
          </div>
        )}
      </section>

      <section className="space-y-4 pb-24 sm:pb-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm text-muted">
            Showing <span className="font-semibold text-secondary">{visibleRows.length}</span>{''}
            {onlyIgnored ? 'ignored' : engineLabel.toLowerCase()}{stateFilter !== 'all' ? ` · ${stateFilter.toUpperCase()}` : ''}{!onlyIgnored && ignoredData.tickers.length > 0 ? ` · ${ignoredData.tickers.length} ignored` : ''}
          </div>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900/50 px-4 py-16 text-center text-sm text-muted">
            <div className="inline-flex items-center gap-2"><RefreshCw size={16} className="animate-spin" /> Loading Signal Feed\u2026</div>
          </div>
        ) : error ? (
          <div className="rounded-[28px] border border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 px-4 py-14 text-center text-sm text-rose-700 dark:text-rose-300">
            <div>{error}</div>
            <button type="button" onClick={() => void load(true)} className="btn btn-danger mt-4 px-4 py-2 text-sm">Retry</button>
          </div>
        ) : visibleRows.length === 0 && ignoredData.tickers.length > 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 dark:border-white/[0.08] bg-white dark:bg-slate-900/30 px-4 py-16 text-center">
            <div className="text-lg font-semibold text-heading">All tickers ignored for today</div>
            <div className="mt-2 text-sm text-muted">Unignore tickers below to see them again, or add more tickers in My Tickers.</div>
            <button type="button" onClick={() => setShowIgnored(true)} className="mt-4 inline-flex items-center gap-2 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-sm text-secondary hover:bg-slate-50 dark:hover:bg-slate-700">View ignored tickers</button>
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 dark:border-white/[0.08] bg-white dark:bg-slate-900/30 px-4 py-16 text-center">
            <div className="text-lg font-semibold text-heading">No cards match the current filters</div>
            <div className="mt-2 text-sm text-muted">Try a different state, agreement, trend, or sector combination.</div>
          </div>
        ) : sourceFilter === 'all' ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {sortedVisibleRows.map(row => (
              <SignalFeedCard
                key={row.id}
                row={row}
                isCompact={!compactIds.has(row.id)}
                isFavorite={favoriteSet.has(row.ticker.toUpperCase())}
                isIgnored={ignoredSet.has(row.ticker.toUpperCase())}
                alertBusy={Boolean(alertBusy[row.id])}
                canDay={canDay}
                canSwing={canSwing}
                onToggleCompact={toggleCompact}
                onAnalyze={() => handleAnalyze(row.ticker)}
                onViewChart={() => handleTickerDetail(row)}
                onCreateAlert={() => void handleCreateAlert(row)}
                onAddToPositions={() => handleAddToPositions(row)}
                onFavorite={() => toggleFavorite(row.ticker)}
                onIgnore={() => toggleIgnore(row.ticker)}
                onMonitor={() => handleMonitor(row)}
              />
            ))}
          </div>
        ) : (
          <div className="grid gap-4">
            {tableGroups.map(group => (
              <SignalFeedTableSection
                key={group.engine}
                title={group.title}
                subtitle={group.subtitle}
                engine={group.engine}
                sourceFilter={sourceFilter}
                rows={visibleRows}
                favoriteSet={favoriteSet}
                ignoredSet={ignoredSet}
                alertBusy={alertBusy}
                onOpenEngine={handleOpenEngine}
                onAnalyze={handleAnalyze}
                onAddToPositions={handleAddToPositions}
                onOpenAlerts={handleOpenAlerts}
                onCreateAlert={(row) => void handleCreateAlert(row)}
                onFavorite={toggleFavorite}
                onIgnore={toggleIgnore}
                onMonitor={handleMonitor}
              />
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900 px-4 py-3 text-sm">
          <div className="text-muted">Page {pagination.page} / {pagination.total_pages} · {pagination.total} tickers total</div>
          <div className="flex items-center gap-2">
            <button type="button" disabled={pagination.page <= 1} onClick={() => setParam('page', String(Math.max(1, pagination.page - 1)))} className={`${getActionButtonClass('surface')} gap-2 rounded-xl px-3 py-2 text-sm`}>Previous</button>
            <button type="button" disabled={pagination.page >= pagination.total_pages} onClick={() => setParam('page', String(Math.min(pagination.total_pages, pagination.page + 1)))} className={`${getActionButtonClass('surface')} gap-2 rounded-xl px-3 py-2 text-sm`}>Next</button>
          </div>
        </div>
      </section>

      <AddTickerModal
        open={showAddTicker}
        onClose={() => setShowAddTicker(false)}
        onAdded={() => { setNotice({ tone: 'success', message: 'Ticker added successfully.' }); void load(true) }}
      />

      <MobileActionTray
        row={activeRow}
        isFavorite={activeRow ? favoriteSet.has(activeRow.ticker.toUpperCase()) : false}
        alertBusy={activeRow ? Boolean(alertBusy[activeRow.id]) : false}
        isOpen={Boolean(activeRow && expandedId === activeRow.id)}
        onAnalyze={() => { if (activeRow) handleAnalyze(activeRow.ticker) }}
        onAddToPositions={() => { if (activeRow) handleAddToPositions(activeRow) }}
        onCreateAlert={() => { if (activeRow) void handleCreateAlert(activeRow) }}
        onFavorite={() => { if (activeRow) toggleFavorite(activeRow.ticker) }}
        onRemove={() => { if (activeRow) handleRemove(activeRow) }}
        onToggle={() => { if (activeRow) toggleExpanded(activeRow.id) }}
        onMonitor={() => { if (activeRow) handleMonitor(activeRow) }}
      />

      {ignoredData.tickers.length > 0 && (
        <div className="fixed bottom-6 left-4 z-40">
          <button type="button" onClick={() => setShowIgnored(!showIgnored)} className="inline-flex items-center gap-2 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2 text-xs text-muted shadow-lg hover:bg-slate-50 dark:hover:bg-slate-800">
            <EyeOff size={12} /> {ignoredData.tickers.length} ignored
          </button>
        </div>
      )}

      {showIgnored && ignoredData.tickers.length > 0 && (
        <div className="fixed bottom-16 left-4 z-40 w-72 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-secondary">Ignored today ({ignoredData.tickers.length})</span>
            <button type="button" onClick={() => setShowIgnored(false)} className="text-muted hover:text-secondary"><X size={14} /></button>
          </div>
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {ignoredData.tickers.map(sym => (
              <div key={sym} className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800">
                <span className="text-xs font-medium text-muted">{sym}</span>
                <button type="button" onClick={() => { toggleIgnore(sym); setShowIgnored(false) }} className="text-[10px] text-violet-500 hover:text-violet-400 dark:text-violet-400 dark:hover:text-violet-300">Unignore</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
