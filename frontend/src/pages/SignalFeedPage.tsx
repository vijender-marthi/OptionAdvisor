import axios from 'axios'
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  BellPlus,
  BriefcaseBusiness,
  BrainCircuit,
  ChevronDown,
  ChevronUp,
  EyeOff,
  Filter,
  Info,
  LineChart as LineChartIcon,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  X,
} from 'lucide-react'
import { Line, LineChart, ResponsiveContainer, Tooltip } from 'recharts'
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
  getMetricChipAppearance,
  getTrendTextClass,
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
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</div>
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

function fmtDate(value?: string): string {
  if (!value) return '\u2014'
  const ts = Date.parse(value)
  if (!Number.isFinite(ts)) return value
  return new Date(ts).toLocaleDateString()
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

function trendClass(value: string): string {
  return getTrendTextClass(value)
}

function riskClass(value: string): string {
  return getRiskTextClass(value)
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

function decisionSummary(decision: SignalFeedDecisionBlock): string {
  const parts = [decision.market_bias, decision.setup_quality, decision.execution_readiness]
    .map(part => String(part || '').trim())
    .filter(Boolean)
  return parts.length ? parts.join(' \u00b7 ') : 'No decision context yet'
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

function metricValue(metrics: SignalFeedMetrics | undefined, key: keyof SignalFeedMetrics): number | null {
  const value = metrics?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function SignalFeedSparkline({ points, height = 180 }: { points: Array<{ date: string; close: number }>; height?: number }) {
  if (!points.length) {
    return <div className="flex h-[160px] items-center justify-center text-sm text-gray-500">No chart data yet.</div>
  }
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points}>
          <Tooltip
            contentStyle={{ backgroundColor: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-tooltip-border)', borderRadius: 16 }}
            labelStyle={{ color: 'var(--chart-tooltip-label)' }}
            formatter={(value: number) => [`$${Number(value).toFixed(2)}`, 'Close']}
          />
          <Line type="monotone" dataKey="close" stroke="#38bdf8" strokeWidth={2.25} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
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
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</div>
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

function DecisionPanel({ title, decision, ticker }: { title: string; decision: SignalFeedDecisionBlock; ticker?: string }) {
  const navigate = useNavigate()
  const optionRisk = decision.option_risk_context
  const showOptionRisk = decision.engine === 'day' && optionRisk && Object.keys(optionRisk).length > 0
  const engineRoute = ticker ? getEngineRoute(title.toLowerCase(), ticker) : null

  return (
    <div className="rounded-xl border border-slate-100 dark:border-white/[0.06] bg-slate-50 dark:bg-slate-800/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-heading">{title}</div>
          <div className="mt-0.5 truncate text-[11px] text-muted">{decisionSummary(decision)}</div>
        </div>
        <StatusPill value={decision.final_decision} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <SignalQualityBadge quality={decision.signal_quality || ''} />
        <ExecTimingBadge timing={decision.execution_timing || ''} />
        <RiskCatBadge category={decision.risk_category || decision.risk_state || ''} />
      </div>
      <div className="mt-2 space-y-2">
        <div className="rounded-lg border border-slate-100 dark:border-white/[0.05] bg-white dark:bg-slate-800/50 p-2">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Reason</div>
          <div className="mt-1 text-sm text-secondary">{decision.reason || 'No reason provided.'}</div>
        </div>
        {(decision.expected_holding_period || decision.recommended_contract_duration) ? (
          <div className="rounded-lg border border-slate-100 dark:border-white/[0.05] bg-white dark:bg-slate-800/50 p-2">
            <div className="flex items-center gap-3 text-[11px] text-muted">
              {decision.expected_holding_period && <span>Hold: <span className="font-semibold text-secondary">~{decision.expected_holding_period}</span></span>}
              {decision.recommended_contract_duration && <span>Contract: <span className="font-semibold text-secondary">{decision.recommended_contract_duration} DTE</span></span>}
            </div>
          </div>
        ) : null}
        {showOptionRisk ? (
          <div className="rounded-lg border border-slate-100 dark:border-white/[0.05] bg-white dark:bg-slate-800/50 p-2">
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Option execution</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <OptionRiskPill label="Theta" value={optionRisk.theta_risk} />
              <OptionRiskPill label="Gamma" value={optionRisk.gamma_risk} />
              <OptionRiskPill label="IV" value={optionRisk.iv_risk} />
              <OptionRiskPill label="Liquidity" value={optionRisk.liquidity_risk} />
            </div>
            {optionRisk.suggested_contract_window ? (
              <div className="mt-2 text-[11px] font-semibold text-violet-600 dark:text-violet-300">
                Suggested window: {optionRisk.suggested_contract_window}
              </div>
            ) : null}
            {optionRisk.option_execution_warning ? (
              <div className="mt-1 text-xs leading-relaxed text-secondary">
                {optionRisk.option_execution_warning}
              </div>
            ) : null}
          </div>
        ) : null}
        {engineRoute ? (
          <Link to={engineRoute} className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold px-3 py-2 text-xs transition-colors">
            Open {title} Engine
            <ArrowUpRight size={13} />
          </Link>
        ) : null}
      </div>
    </div>
  )
}

function ExpandedAnalysis({
  row,
  alertBusy,
  canDay,
  canSwing,
  onAnalyze,
  onViewChart,
  onCreateAlert,
  onAddToPositions,
}: {
  row: SignalFeedRow
  alertBusy: boolean
  canDay: boolean
  canSwing: boolean
  onAnalyze: () => void
  onViewChart: () => void
  onCreateAlert: () => void
  onAddToPositions: () => void
}) {
  return (
    <div className="min-w-0 space-y-3 border-t border-slate-100 dark:border-white/[0.05] px-4 py-3">
      <div className="min-w-0 grid gap-3 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-3">
          <div className="rounded-xl border border-slate-100 dark:border-white/[0.06] bg-slate-50 dark:bg-slate-800/40 p-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-heading">
              <LineChartIcon size={14} className="text-info" />
              Price action
            </div>
            <div className="mt-2">
              <SignalFeedSparkline points={row.chart_points} />
            </div>
          </div>
          {(canDay || canSwing) && (
          <div className="rounded-xl border border-slate-100 dark:border-white/[0.06] bg-slate-50 dark:bg-slate-800/40 p-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-heading">
              <BrainCircuit size={14} className="text-accent" />
              AI coach
            </div>
            <div className="mt-2 text-sm leading-5 text-secondary">{row.ai_summary}</div>
            {row.agreement_reason ? (
              <div className="mt-2 rounded-lg border border-slate-100 dark:border-white/[0.05] bg-white dark:bg-slate-800/50 p-2">
                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Engine consensus</div>
                <div className="mt-1 text-sm text-secondary">{row.agreement_reason}</div>
              </div>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted">
              {row.notes?.trim() && <span><span className="font-semibold">Note:</span> {row.notes.trim()}</span>}
              {row.added_at && <span>Added {fmtDate(row.added_at)}</span>}
            </div>
          </div>
          )}
        </div>
        <div className="space-y-3">
          {canDay && <DecisionPanel title="Day" decision={row.day} ticker={row.ticker} />}
          {canSwing && <DecisionPanel title="Swing" decision={row.swing} ticker={row.ticker} />}
          <DecisionPanel title="Regular" decision={row.regular} ticker={row.ticker} />
        </div>
      </div>
    </div>
  )
}

const SignalFeedCard = memo(function SignalFeedCard({
  row,
  isOpen,
  isFavorite,
  isIgnored,
  alertBusy,
  sourceFilter,
  canDay,
  canSwing,
  onToggle,
  onAnalyze,
  onViewChart,
  onCreateAlert,
  onAddToPositions,
  onFavorite,
  onIgnore,
}: {
  row: SignalFeedRow
  isOpen: boolean
  isFavorite: boolean
  isIgnored: boolean
  alertBusy: boolean
  sourceFilter: SourceFilter
  canDay: boolean
  canSwing: boolean
  onAnalyze: () => void
  onViewChart: () => void
  onCreateAlert: () => void
  onAddToPositions: () => void
  onFavorite: () => void
  onIgnore: () => void
  onToggle: (id: string) => void
}) {
  const metrics = row.metrics
  const agreementBadge = normalizeAgreementBadge(row)
  const changeTone = row.price_change_pct > 0 ? 'text-semantic-bullish' : row.price_change_pct < 0 ? 'text-semantic-bearish' : 'text-tertiary'
  const trendTone = trendClass(row.trend)
  const marketContext = metrics?.market_context || 'MARKET_MIXED'
  const rsiAppearance = getMetricChipAppearance('rsi', metricValue(metrics, 'rsi'))
  const rsAppearance = getMetricChipAppearance('relative_strength', metricValue(metrics, 'relative_strength'))
  const volumeAppearance = getMetricChipAppearance('volume_ratio', metricValue(metrics, 'volume_ratio'))
  const ivAppearance = getMetricChipAppearance('iv_rank', metricValue(metrics, 'iv_rank'))
  const trendAppearance = getMetricChipAppearance('trend', null, row.trend)
  const updatedLabel = row.cache_age_seconds != null && Number.isFinite(row.cache_age_seconds)
    ? `${Math.max(0, Math.round(row.cache_age_seconds))}s ago`
    : 'cached'
  const handleToggle = useCallback(() => onToggle(row.id), [onToggle, row.id])

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
          {/* Row 2: company · sector · engine pills · updated */}
          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted">
            <span className="text-secondary font-medium">{row.company_name || row.ticker}</span>
            {row.sector && <><span className="opacity-30">·</span><span className="opacity-60">{row.sector}</span></>}
            <span className="opacity-30">·</span>
            {canDay && <SourcePill source="day" decision={row.day_decision} emphasized={sourceFilter === 'all' || sourceFilter === 'day'} />}
            {canSwing && <SourcePill source="swing" decision={row.swing_decision} emphasized={sourceFilter === 'all' || sourceFilter === 'swing'} />}
            <SourcePill source="regular" decision={row.regular_decision} emphasized={sourceFilter === 'all' || sourceFilter === 'regular'} />
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

      {/* Metrics chips */}
      <div className="flex flex-wrap gap-1 px-3 pb-2">
        <CompactChip label="RSI" value={fmtNumber(metricValue(metrics, 'rsi'), 1)} tone={rsiAppearance.value} chrome={rsiAppearance.container} />
        <CompactChip label="RS" value={fmtPct(metricValue(metrics, 'relative_strength'))} tone={rsAppearance.value} chrome={rsAppearance.container} />
        <CompactChip label="Vol" value={fmtNumber(metricValue(metrics, 'volume_ratio'), 2)} tone={volumeAppearance.value} chrome={volumeAppearance.container} />
        <CompactChip label="IV" value={fmtNumber(metricValue(metrics, 'iv_rank'), 1)} tone={ivAppearance.value} chrome={ivAppearance.container} />
        <CompactChip label="Trend" value={row.trend || 'NEUTRAL'} tone={trendTone} chrome={trendAppearance.container} />
      </div>

      {/* AI insight strip */}
      <div className="flex items-start gap-1.5 px-3 pb-2 text-sm text-secondary">
        <Sparkles size={11} className="mt-px shrink-0 text-violet-400" />
        <p className="min-w-0 leading-snug line-clamp-2">{row.ai_summary}</p>
      </div>

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
        <div className="relative ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={onIgnore}
            className={`${getActionButtonClass('surface')} inline-flex items-center gap-0.5 px-2 py-0.5 text-[10px]`}
          >
            <EyeOff size={10} /> {isIgnored ? 'Unignore' : 'Ignore'}
          </button>
          <button
            type="button"
            onClick={handleToggle}
            className={`${getActionButtonClass('surface')} inline-flex items-center gap-0.5 px-2 py-0.5 text-[10px]`}
          >
            {isOpen ? <><ChevronUp size={10} />Less</> : <><ChevronDown size={10} />Details</>}
          </button>
        </div>
      </div>

      {isOpen ? (
        <ExpandedAnalysis
          row={row}
          alertBusy={alertBusy}
          canDay={canDay}
          canSwing={canSwing}
          onAnalyze={onAnalyze}
          onViewChart={onViewChart}
          onCreateAlert={onCreateAlert}
          onAddToPositions={onAddToPositions}
        />
      ) : null}
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
      </div>
    </div>
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

  const load = useCallback(async () => {
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
      })
      setEnv(next)
    } catch (err) {
      setError(axiosErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, sortBy, sortDir, sourceFilter])

  useEffect(() => { void load() }, [load])

  const payload = env?.data
  const rows = payload?.rows ?? []
  const summary = payload?.summary ?? { total: 0, ready: 0, watch: 0, extended: 0, avoid: 0, conflict: 0, manage: 0, alerts: 0, strong_bullish: 0, strong_bearish: 0 }
  const aiSummary = payload?.ai_summary ?? { headline: 'No Signal Feed items yet', message: 'Add tickers to start the Signal Feed pipeline.', best_focus: 'Use Strategy Finder, day trade, or swing trade flows to seed tickers.', counts: {} }
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

  const toggleExpanded = useCallback((id: string) => { setExpandedId(cur => (cur === id ? null : id)) }, [])
  const toggleFavorite = useCallback((ticker: string) => {
    const norm = ticker.toUpperCase()
    setFavorites(cur => cur.map(t => t.toUpperCase()).includes(norm) ? cur.filter(t => t.toUpperCase() !== norm) : [...cur, norm])
  }, [])
  const handleAnalyze = useCallback((ticker: string) => requestAnalysis(ticker), [requestAnalysis])
  const handleTickerDetail = useCallback((row: SignalFeedRow) => routerNavigate(row.actions.chart_url || row.actions.analyze_url || '/'), [routerNavigate])
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
              <Activity size={18} className="text-indigo-400" />
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
          <button type="button" onClick={() => void load()} className={`${getActionButtonClass('surface')} gap-2 rounded-full px-3 py-2 text-sm`}><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh</button>
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
            <button type="button" onClick={() => void load()} className="btn btn-danger mt-4 px-4 py-2 text-sm">Retry</button>
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
        ) : (
          <div className="grid gap-4">
            {visibleRows.map(row => {
              const isOpen = expandedId === row.id
              const isFavorite = favoriteSet.has(row.ticker.toUpperCase())
              return (
                <SignalFeedCard key={row.id} row={row} sourceFilter={sourceFilter} canDay={canDay} canSwing={canSwing}
                  isOpen={isOpen} isFavorite={isFavorite} isIgnored={ignoredSet.has(row.ticker.toUpperCase())} alertBusy={Boolean(alertBusy[row.id])}
                  onToggle={toggleExpanded} onAnalyze={() => handleAnalyze(row.ticker)}
                  onViewChart={() => handleTickerDetail(row)}
                  onCreateAlert={() => void handleCreateAlert(row)}
                  onAddToPositions={() => handleAddToPositions(row)}
                  onFavorite={() => toggleFavorite(row.ticker)} onIgnore={() => toggleIgnore(row.ticker)}
                />
              )
            })}
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
        onAdded={() => { setNotice({ tone: 'success', message: 'Ticker added successfully.' }); void load() }}
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
