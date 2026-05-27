import axios from 'axios'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BellRing,
  BrainCircuit,
  BriefcaseBusiness,
  ChevronDown,
  ChevronUp,
  Clock,
  LineChart,
  RefreshCw,
  ShieldAlert,
  TrendingUp,
  LayoutDashboard,
  LayoutGrid,
  Gauge,
  Zap,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { fetchMarketPosition, fetchTradeCommandCenter } from '../api/commandCenter'
import type { MarketPositionData } from '../api/commandCenter'
import { useApp } from '../contexts/AppContext'
import { ROUTES, getEngineRoute, routeForEngine, getDetailsRoute } from '../routing/routes'
import GaugeMeter from '../components/GaugeMeter'
import SignalRing from '../components/SignalRing'
import SparklineCard from '../components/SparklineCard'
import RiskGauge from '../components/RiskGauge'
import HeatmapWidget from '../components/HeatmapWidget'
import CoachSummaryCard from '../components/CoachSummaryCard'
import MarketIntelligenceStrip from '../components/MarketIntelligenceStrip'
import ReserveSignalCard from '../components/ReserveSignalCard'
import type {
  ApiEnvelope,
  OverallDecision,
  TradeCommandCenterActivity,
  TradeCommandCenterConflict,
  TradeCommandCenterEngine,
  TradeCommandCenterPayload,
  TradeCommandCenterRecommendation,
} from '../types/commandCenter'

function axiosErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const d = err.response?.data as { detail?: unknown } | undefined
    if (typeof d?.detail === 'string') return d.detail
    if (err.response?.status === 401) return 'Session expired — sign in again.'
    if (err.response?.status === 404) return 'Command Center API not found (is the backend running on port 9000?).'
    return err.message || 'Request failed'
  }
  if (err instanceof Error) return err.message
  return 'Failed to load Trade Command Center'
}

function toneFromText(value: string): 'bullish' | 'bearish' | 'neutral' | 'warning' {
  const v = value.toLowerCase()
  if (v.includes('bull')) return 'bullish'
  if (v.includes('bear') || v.includes('risk-off')) return 'bearish'
  if (v.includes('high') || v.includes('elevated') || v.includes('extreme')) return 'warning'
  return 'neutral'
}

function badgeClass(tone: 'bullish' | 'bearish' | 'neutral' | 'warning'): string {
  if (tone === 'bullish') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  if (tone === 'bearish') return 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300'
  if (tone === 'warning') return 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
  return 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300'
}

function fmtTimestamp(value?: string): string {
  if (!value) return '—'
  const ts = Date.parse(value)
  if (!Number.isFinite(ts)) return '—'
  return new Date(ts).toLocaleString()
}

function signalClass(signal: string): string {
  const s = signal.toUpperCase()
  if (s === 'READY' || s === 'TRADE' || s === 'GO' || s === 'STRONG_GO' || s === 'STRONG GO') return 'oa-signal-badge oa-signal-go'
  if (s === 'WATCH' || s === 'WAIT' || s === 'HOLD') return 'oa-signal-badge oa-signal-watch'
  return 'oa-signal-badge oa-signal-avoid'
}

function SignalBadge({ signal }: { signal: string }) {
  return <span className={signalClass(signal)}>{signal}</span>
}

function EngineBadge({ engine }: { engine: string }) {
  return <span className="oa-engine-badge">{engine.toUpperCase()}</span>
}

function RiskBadge({ risk }: { risk: string }) {
  const tone = toneFromText(risk)
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase ${badgeClass(tone)}`}>{risk}</span>
}

/* Three-axis display badges — split opportunity quality, timing, and risk */
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
    t === 'WATCH' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' :
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

function formatCoachMessage(msg: string): ReactNode {
  return msg.split('\n\n').map((p, i) => <p key={i} className="mb-2 last:mb-0">{p}</p>)
}

function confidenceNumber(raw: string | number | undefined): number {
  if (typeof raw === 'number') return Math.round(raw <= 1 ? raw * 100 : raw)
  const text = String(raw || '').trim().toLowerCase()
  if (text === 'high') return 80
  if (text === 'medium') return 60
  if (text === 'warning') return 45
  if (text === 'low') return 35
  return 0
}

function isActionable(rec: TradeCommandCenterRecommendation): boolean {
  const signal = String(rec.final_decision || rec.signal || '').toUpperCase()
  if (signal === 'READY' || signal === 'TRADE') return true
  return signal === 'WATCH' && confidenceNumber(rec.confidence) >= 70
}

function isAvoid(rec: TradeCommandCenterRecommendation): boolean {
  const signal = String(rec.final_decision || rec.signal || '').toUpperCase()
  return signal === 'AVOID' || signal === 'EXIT' || signal === 'NO_EDGE'
}

function summaryNumber(raw: unknown): number {
  const n = Number(raw)
  return Number.isFinite(n) ? n : 0
}

function marketModeToValue(mode: string): number {
  const m = mode.toLowerCase()
  if (m.includes('euphoric')) return 90
  if (m.includes('bull')) return 72
  if (m.includes('neutral')) return 50
  if (m.includes('defensive')) return 25
  if (m.includes('bear')) return 10
  return 50
}

function trendToValue(trend: string): number {
  const t = trend.toLowerCase()
  if (t.includes('strong') && t.includes('bull')) return 85
  if (t.includes('bull')) return 70
  if (t.includes('neutral')) return 50
  if (t.includes('bear')) return 30
  if (t.includes('strong') && t.includes('bear')) return 15
  return 50
}

function riskToValue(risk: string): number {
  const r = risk.toLowerCase()
  if (r.includes('panic')) return 92
  if (r.includes('high') || r.includes('extreme')) return 75
  if (r.includes('elevated')) return 55
  if (r.includes('contained')) return 30
  if (r.includes('calm')) return 10
  return 50
}

function exposureFromMarket(market: Record<string, unknown>): { bullish: number; bearish: number; cash: number } {
  const mode = String(market.market_mode ?? '').toLowerCase()
  const risk = String(market.risk_status ?? '').toLowerCase()
  if (mode.includes('euphoric')) return { bullish: 70, bearish: 5, cash: 25 }
  if (mode.includes('bull')) return { bullish: 60, bearish: 10, cash: 30 }
  if (mode.includes('defensive')) return { bullish: 20, bearish: 45, cash: 35 }
  if (mode.includes('bear')) return { bullish: 15, bearish: 55, cash: 30 }
  if (risk.includes('high') || risk.includes('extreme')) return { bullish: 25, bearish: 40, cash: 35 }
  return { bullish: 40, bearish: 20, cash: 40 }
}

function toneColor(value: string): string {
  const t = value.toLowerCase()
  if (t.includes('bull')) return 'text-emerald-400'
  if (t.includes('bear') || t.includes('risk')) return 'text-rose-400'
  if (t.includes('elevated') || t.includes('high')) return 'text-amber-400'
  return 'text-sky-400'
}

function readinessColor(value: number): string {
  if (value >= 80) return '#22c55e'
  if (value >= 60) return '#3b82f6'
  if (value >= 40) return '#f59e0b'
  return '#ef4444'
}

function buildFallbackConflicts(recommendations: TradeCommandCenterRecommendation[]): TradeCommandCenterConflict[] {
  const byTicker = new Map<string, TradeCommandCenterRecommendation[]>()
  for (const rec of recommendations) {
    const ticker = String(rec.ticker || '').trim().toUpperCase()
    if (!ticker) continue
    const current = byTicker.get(ticker) ?? []
    current.push(rec)
    byTicker.set(ticker, current)
  }
  const out: TradeCommandCenterConflict[] = []
  for (const [ticker, rows] of byTicker.entries()) {
    if (rows.length < 2) continue
    const signals = rows.map(row => String(row.final_decision || row.signal || '').toUpperCase())
    const hasGo = signals.some(sig => sig === 'READY' || sig === 'TRADE' || sig === 'WATCH')
    const hasAvoid = signals.some(sig => sig === 'AVOID' || sig === 'EXIT' || sig === 'NO_EDGE')
    if (!hasGo || !hasAvoid) continue
    out.push({
      id: `fallback-${ticker}`,
      ticker,
      state: 'CONFLICTING_SIGNALS',
      summary: `${ticker} — mixed signals across engines. Check IV rank and daily bias before acting.`,
      resolution: 'Shorter-timeframe engine likely seeing intraday noise the swing/regular engine discounts. Check IV rank and daily bias.',
      suggested_action: 'Reduce position size by 50% or stand aside until all active engines agree on signal direction.',
        signals: rows.map(row => ({
          engine_type: String(row.engine_type || '').toUpperCase(),
          signal: String(row.final_decision || row.signal || '').toUpperCase(),
          note: row.reason,
        })),
    })
  }
  return out
}

function buildFallbackCharts(payload: TradeCommandCenterPayload) {
  const recommendations = payload.recommendations ?? []
  const trendStrength = payload.charts?.trend_strength ?? [
    { label: 'SPY', value: toneFromText(String(payload.market_summary?.spy_trend ?? 'neutral')) === 'bullish' ? 70 : 45 },
    { label: 'QQQ', value: toneFromText(String(payload.market_summary?.qqq_trend ?? 'neutral')) === 'bullish' ? 76 : 42 },
  ]

  const engineSignalMap = new Map<string, { engine: string; READY: number; WATCH: number; WAIT: number; AVOID: number; NO_EDGE: number }>()
  for (const rec of recommendations) {
    const engine = String(rec.engine_type || 'Unknown')
    const key = engine.charAt(0).toUpperCase() + engine.slice(1)
    const bucket = engineSignalMap.get(key) ?? { engine: key, READY: 0, WATCH: 0, WAIT: 0, AVOID: 0, NO_EDGE: 0 }
    const signal = String(rec.final_decision || rec.signal || '').toUpperCase()
    if (signal === 'READY' || signal === 'TRADE') bucket.READY += 1
    else if (signal === 'WATCH') bucket.WATCH += 1
    else if (signal === 'WAIT') bucket.WAIT += 1
    else if (signal === 'AVOID' || signal === 'EXIT') bucket.AVOID += 1
    else if (signal === 'NO_EDGE') bucket.NO_EDGE += 1
    engineSignalMap.set(key, bucket)
  }

  const riskCounts = { Low: 0, Medium: 0, High: 0 }
  for (const rec of recommendations) {
    const risk = String(rec.risk_level || '').toLowerCase()
    if (risk === 'low') riskCounts.Low += 1
    else if (risk === 'medium') riskCounts.Medium += 1
    else if (risk === 'high') riskCounts.High += 1
  }

  const bestStyle = String(payload.market_summary?.best_style_today || 'Swing').toLowerCase()
  const styleAllocation = payload.charts?.style_allocation ?? [
    { label: 'Day', value: bestStyle.includes('day') ? 55 : 20 },
    { label: 'Swing', value: bestStyle.includes('swing') ? 55 : 20 },
    { label: 'Regular', value: bestStyle.includes('regular') ? 45 : 20 },
    { label: 'Avoid', value: toneFromText(String(payload.market_summary?.risk_status || 'neutral')) === 'warning' ? 15 : 5 },
  ]

  return {
    trend_strength: trendStrength,
    engine_signal_distribution: Array.from(engineSignalMap.values()),
    risk_distribution: [
      { label: 'Low', value: riskCounts.Low },
      { label: 'Medium', value: riskCounts.Medium },
      { label: 'High', value: riskCounts.High },
    ],
    style_allocation: styleAllocation,
  }
}

function SummaryCard({
  label,
  value,
  tone,
  emphasis = 'normal',
}: {
  label: string
  value: string
  tone: 'bullish' | 'bearish' | 'neutral' | 'warning'
  emphasis?: 'high' | 'normal'
}) {
  const cardCls = emphasis === 'high'
    ? 'rounded-xl border border-slate-200 dark:border-white/[0.10] bg-white dark:bg-slate-900 p-4 shadow-sm'
    : 'rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900/60 p-3.5'
  const valCls = emphasis === 'high' ? 'text-2xl font-bold tabular-nums text-slate-900 dark:text-white mt-1.5' : 'text-sm font-semibold text-slate-900 dark:text-white mt-1'
  return (
    <div className={cardCls}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 truncate">{label}</div>
          <div className={valCls}>{value || '—'}</div>
        </div>
        <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${badgeClass(tone)}`}>
          {tone}
        </span>
      </div>
    </div>
  )
}

function ChartShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900 p-4">
      <div className="mb-3">
        <div className="text-sm font-semibold text-slate-900 dark:text-white">{title}</div>
        <div className="text-xs text-slate-500">{subtitle}</div>
      </div>
      {children}
    </div>
  )
}

const MP_TONE_SIGNAL: Record<string, string> = {
  green: 'bg-emerald-500/15 text-emerald-300 border border-emerald-600/40',
  red: 'bg-rose-500/15 text-rose-300 border border-rose-700/40',
  orange: 'bg-amber-500/15 text-amber-300 border border-amber-600/40',
  gray: 'bg-gray-700/40 text-gray-400 border border-gray-600/40',
}
const MP_TONE_DOT: Record<string, string> = {
  green: 'bg-emerald-400',
  red: 'bg-rose-400',
  orange: 'bg-amber-400',
  gray: 'bg-gray-500',
}

function MarketPositionWidget() {
  const [mpData, setMpData] = useState<MarketPositionData | null>(null)
  const [mpLoading, setMpLoading] = useState(true)
  const [mpError, setMpError] = useState<string | null>(null)

  useEffect(() => {
    fetchMarketPosition()
      .then(env => {
        if (env.error) setMpError((env.error as { message?: string }).message ?? 'Error')
        else if (env.data) setMpData(env.data)
        else setMpError('No data')
      })
      .catch(err => setMpError(axiosErrorMessage(err)))
      .finally(() => setMpLoading(false))
  }, [])

  if (mpLoading) {
    return (
      <div className="mt-4 flex items-center gap-2 border-t border-slate-100 dark:border-white/[0.05] pt-4 text-xs text-slate-500">
        <RefreshCw size={11} className="animate-spin" /> Loading market position…
      </div>
    )
  }
  if (mpError || !mpData) {
    return <div className="mt-4 border-t border-slate-100 dark:border-white/[0.05] pt-4 text-xs text-slate-500">Market position unavailable</div>
  }

  const tone = mpData.signal_tone
  const signalCls = MP_TONE_SIGNAL[tone] ?? MP_TONE_SIGNAL.gray
  const dotCls = MP_TONE_DOT[tone] ?? MP_TONE_DOT.gray
  const maBarPct = Math.min(100, Math.max(2, ((mpData.dist_200ma_pct + 5) / 20) * 100))
  const ddBarPct = Math.min(100, Math.max(2, (mpData.drawdown_pct / 25) * 100))
  const maBarColor =
    mpData.dist_200ma_pct >= 10 ? 'bg-rose-500' : mpData.dist_200ma_pct < 0 ? 'bg-amber-500' : 'bg-sky-500'
  const ddBarColor = mpData.drawdown_pct >= 8 ? 'bg-emerald-500' : 'bg-gray-600'

  return (
    <div className="mt-4 border-t border-slate-100 dark:border-white/[0.05] pt-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
          <TrendingUp size={11} className="text-violet-400" aria-hidden />
          Portfolio Reserve Signal
        </div>
        <div className="flex items-center gap-1.5 text-xs font-mono">
          <span className="text-slate-500 dark:text-slate-400">SPY</span>
          <span className="font-bold text-slate-900 dark:text-white">${mpData.spy_price.toFixed(2)}</span>
          <span className="text-[10px] text-slate-300 dark:text-slate-600">|</span>
          <span className="text-[10px] text-slate-500">200-MA ${mpData.ma200.toFixed(0)}</span>
        </div>
      </div>

      <div className="mb-3 space-y-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="w-24 shrink-0 font-semibold text-slate-500 dark:text-slate-400">vs 200-day MA</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700/30">
            <div className={`h-full rounded-full ${maBarColor}`} style={{ width: `${maBarPct}%` }} />
          </div>
          <span className="w-14 text-right font-mono text-xs font-bold text-sky-600 dark:text-sky-300">
            {mpData.dist_200ma_pct >= 0 ? '+' : ''}{mpData.dist_200ma_pct.toFixed(1)}%
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="w-24 shrink-0 font-semibold text-slate-500 dark:text-slate-400">Off 52w High</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700/30">
            <div className={`h-full rounded-full ${ddBarColor}`} style={{ width: `${ddBarPct}%` }} />
          </div>
          <span className="w-14 text-right font-mono text-xs font-bold text-emerald-600 dark:text-emerald-300">
            -{mpData.drawdown_pct.toFixed(1)}%
          </span>
        </div>
      </div>

      <div className={`flex items-center gap-2 rounded-lg px-3 py-2 ${signalCls}`}>
        <span className={`h-2 w-2 flex-none rounded-full ${dotCls}`} aria-hidden />
        <span className="flex-1 text-xs font-semibold leading-snug">{mpData.signal_label}</span>
        <span className="whitespace-nowrap font-mono text-[10px] text-slate-500">25% reserve rule</span>
      </div>
    </div>
  )
}

function OverallDecisionBanner({ od }: { od: OverallDecision }) {
  const v = od.verdict

  const bannerCls =
    v === 'STRONG GO' ? 'border-emerald-500/50 bg-emerald-950/20 dark:bg-emerald-900/15' :
    v === 'GO'        ? 'border-sky-500/40    bg-sky-950/20    dark:bg-sky-900/15'       :
    v === 'WATCH'     ? 'border-amber-500/40  bg-amber-950/15  dark:bg-amber-900/10'     :
                        'border-slate-500/30  bg-slate-900/40  dark:bg-slate-800/20'

  const verdictCls =
    v === 'STRONG GO' ? 'bg-emerald-500 text-white' :
    v === 'GO'        ? 'bg-sky-500     text-white' :
    v === 'WATCH'     ? 'bg-amber-500   text-white' :
                        'bg-slate-600   text-white'

  const dotCls =
    v === 'STRONG GO' ? 'bg-emerald-400' :
    v === 'GO'        ? 'bg-sky-400'     :
    v === 'WATCH'     ? 'bg-amber-400'   :
                        'bg-slate-500'

  const labelCls =
    v === 'STRONG GO' ? 'text-semantic-bullish' :
    v === 'GO'        ? 'text-semantic-info'    :
    v === 'WATCH'     ? 'text-semantic-warning' :
                        'text-gray-500'

  const engineTag = (e: string) => {
    const color =
      e === 'day'     ? 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/40 dark:text-orange-300 dark:border-orange-700/40' :
      e === 'swing'   ? 'bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-900/40 dark:text-violet-300 dark:border-violet-700/40' :
      e === 'regular' ? 'bg-teal-100   text-teal-700   border-teal-200   dark:bg-teal-900/40   dark:text-teal-300   dark:border-teal-700/40'   :
                        'bg-slate-100  text-slate-600  border-slate-200  dark:bg-slate-700/40  dark:text-slate-300  dark:border-slate-600/40'
    return (
      <span key={e} className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${color}`}>
        {e}
      </span>
    )
  }

  return (
    <section className={`rounded-2xl border p-4 md:p-5 ${bannerCls}`}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 shrink-0">
          <Zap size={15} className={labelCls} />
          <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">Overall Decision</span>
        </div>
        <div className="flex items-center gap-2 flex-1 flex-wrap">
          <span className={`rounded-lg px-3 py-1 text-sm font-black uppercase tracking-wide ${verdictCls}`}>{v}</span>
          <span className={`text-sm font-semibold ${labelCls}`}>{od.label}</span>
          <span className="text-xs text-slate-400 font-mono">{od.confidence}% conf.</span>
        </div>
        {od.engines_agreeing.length > 0 && (
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[10px] text-slate-500 uppercase tracking-wide">Agree:</span>
            {od.engines_agreeing.map(engineTag)}
          </div>
        )}
        {od.engines_conflicting.length > 0 && (
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[10px] text-rose-500 uppercase tracking-wide">Conflict:</span>
            {od.engines_conflicting.map(engineTag)}
          </div>
        )}
      </div>
      <div className="mt-3 flex items-start gap-2">
        <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${dotCls}`} />
        <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-300">{od.reason}</p>
      </div>
    </section>
  )
}

function qualityColor(v: string): string {
  const u = v.toUpperCase()
  if (u === 'GOOD' || u === 'READY' || u === 'HIGH') return 'text-green-600 dark:text-green-400'
  if (u === 'WATCH' || u === 'MEDIUM' || u === 'FAIR') return 'text-amber-600 dark:text-amber-400'
  if (u === 'AVOID' || u === 'WEAK' || u === 'LOW' || u === 'WAIT') return 'text-red-600 dark:text-red-400'
  return 'text-slate-900 dark:text-white'
}

function alertPressureLevel(a: { active_alerts: number; critical_alerts: number; high_iv_warnings: number }): { label: string; color: string } {
  const total = a.active_alerts + a.critical_alerts * 2 + a.high_iv_warnings
  if (total >= 8) return { label: 'Critical', color: '#ef4444' }
  if (total >= 5) return { label: 'Elevated', color: '#f97316' }
  if (total >= 3) return { label: 'Active',   color: '#f59e0b' }
  if (total >= 1) return { label: 'Watch',    color: '#3b82f6' }
  return           { label: 'Quiet',    color: '#22c55e' }
}

export default function TradeCommandCenter() {
  const navigate = useNavigate()
  const { addToWatchlist, isWatched, requestAnalysis, canAccessPage } = useApp()
  const canDay   = canAccessPage('day-trade')
  const canSwing = canAccessPage('swing-trade')
  const [env, setEnv] = useState<ApiEnvelope<TradeCommandCenterPayload> | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [engine, setEngine] = useState('')
  const [signal, setSignal] = useState('')
  const [direction, setDirection] = useState('')
  const [risk, setRisk] = useState('')
  const [showAllRecommendations, setShowAllRecommendations] = useState(false)
  const [expandedOpportunityId, setExpandedOpportunityId] = useState<string | null>(null)
  const [expandedConflictId, setExpandedConflictId] = useState<string | null>(null)
  const [actionNotice, setActionNotice] = useState<{ tone: 'success' | 'warning' | 'info'; text: string } | null>(null)
  const [expandedEngines, setExpandedEngines] = useState<Set<string>>(new Set())

  // Stale-load guard: React StrictMode double-fires effects in dev; without this the page
  // makes two identical backend calls on mount. The counter lets us discard the response
  // from any load that was superseded by a newer one before it completed.
  const loadSeqRef = useRef(0)

  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current
    setLoading(true)
    setFetchError(null)
    try {
      const nextEnv = await fetchTradeCommandCenter({
        engine: engine || undefined,
        signal: signal || undefined,
        direction: direction || undefined,
        risk: risk || undefined,
      })
      if (seq !== loadSeqRef.current) return   // stale — a newer load already fired
      setEnv(nextEnv)
    } catch (err) {
      if (seq !== loadSeqRef.current) return
      setEnv(null)
      setFetchError(axiosErrorMessage(err))
    } finally {
      if (seq === loadSeqRef.current) setLoading(false)
    }
  }, [direction, engine, risk, signal])

  useEffect(() => {
    void load()
  }, [load])

  const payload = env?.data ?? null
  const market = payload?.market_summary ?? {}
  const allEngines = payload?.engines ?? []
  const allRecommendations = payload?.recommendations ?? []

  // Filter to engines the current role can access
  const engines = allEngines.filter(e => {
    const t = String(e.engine_type || '').toLowerCase()
    if (t === 'day')   return canDay
    if (t === 'swing') return canSwing
    return true  // regular — always visible
  })
  const recommendations = allRecommendations.filter(r => {
    const t = String(r.engine_type || '').toLowerCase()
    if (t === 'day')   return canDay
    if (t === 'swing') return canSwing
    return true
  })
  const conflicts = payload?.conflicts
    ? payload.conflicts.filter(c =>
        c.signals.some(s => {
          const t = String(s.engine_type || '').toLowerCase()
          if (t === 'day')   return canDay
          if (t === 'swing') return canSwing
          return true
        })
      )
    : buildFallbackConflicts(recommendations)
  const alertsSummary = payload?.alerts_summary ?? {
    active_alerts: 0,
    critical_alerts: 0,
    positions_requiring_exit: 0,
    near_expiry_trades: 0,
    high_iv_warnings: 0,
  }
  const recentActivity = payload?.recent_activity ?? []
  const charts = useMemo(() => {
    if (!payload) return null
    const raw = { ...buildFallbackCharts(payload), ...(payload.charts ?? {}) }
    // Filter style_allocation bars to only the engines this role can see
    if (raw.style_allocation) {
      raw.style_allocation = raw.style_allocation.filter((s: { label: string; value: number }) => {
        const l = s.label.toLowerCase()
        if (l === 'day')   return canDay
        if (l === 'swing') return canSwing
        return true
      })
    }
    return raw
  }, [payload, canDay, canSwing])

  const actionable = useMemo(() => recommendations.filter(isActionable), [recommendations])

  useEffect(() => {
    if (!env) return
    const firstEngine = engines[0]
    if (firstEngine) {
      setExpandedEngines(prev => {
        const next = new Set(prev)
        const key = String(firstEngine.engine_type || '').toLowerCase()
        if (key) next.add(key)
        return next
      })
    }
    if (actionable.length > 0 && !expandedOpportunityId) setExpandedOpportunityId(actionable[0].id)
    if (conflicts.length > 0 && !expandedConflictId) setExpandedConflictId(conflicts[0].id)
  }, [env]) // eslint-disable-line react-hooks/exhaustive-deps
  const avoids = useMemo(() => recommendations.filter(isAvoid).slice(0, 4), [recommendations])
  const confidenceScore = summaryNumber(market.confidence_score) || 62

  const setNotice = (tone: 'success' | 'warning' | 'info', text: string) => setActionNotice({ tone, text })

  const handleAddToWatchlist = (ticker: string) => {
    const t = ticker.trim().toUpperCase()
    if (!t) return
    const alreadyWatched = isWatched(t)
    const ok = addToWatchlist({ ticker: t })
    if (alreadyWatched || ok) {
      setNotice('success', `${t} is ready in your watchlist.`)
    } else {
      setNotice('warning', `Could not add ${t} to the watchlist. Check your watchlist limit and try again.`)
    }
  }

  const handleAddToPositions = (rec: TradeCommandCenterRecommendation) => {
    if (rec.ticker) requestAnalysis(rec.ticker)
    setNotice('info', `${rec.ticker} analysis opened — review entry/stop/target in the Ticker Advisor, then add to Positions from there.`)
  }

  const handleCreateAlert = (ticker: string) => {
    navigate(ROUTES.alerts)
    setNotice('info', `Alert Center opened. Custom alert creation for ${ticker} is not wired yet.`)
  }

  const noticeClass =
    actionNotice?.tone === 'success'
      ? 'border-emerald-700/40 bg-emerald-950/30 text-emerald-200'
      : actionNotice?.tone === 'warning'
        ? 'border-amber-700/40 bg-amber-950/30 text-amber-200'
        : 'border-sky-700/40 bg-sky-950/30 text-sky-200'

  return (
    <div className="trade-command-center-page oa-cc-page mx-auto min-h-screen max-w-5xl space-y-4 px-4 pt-4 pb-28 md:px-6 md:pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-violet-600/20 border border-violet-700 flex items-center justify-center shrink-0">
            <LayoutDashboard size={16} className="text-violet-400" />
          </div>
          <h1 className="tcc-hero-title text-lg font-bold tracking-tight text-heading">Trade Command Center</h1>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="btn btn-outline h-8 w-8 rounded-lg"
          aria-label="Refresh command center data"
          title={loading ? 'Loading…' : 'Refresh'}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {actionNotice ? (
        <div className={`rounded-xl border px-4 py-3 text-sm shadow-lg ${noticeClass}`}>
          <div className="flex items-start justify-between gap-3">
            <span className="font-medium">{actionNotice.text}</span>
            <button type="button" className="text-xs font-semibold opacity-80 hover:opacity-100" onClick={() => setActionNotice(null)}>
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {loading && !env ? (
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900 px-4 py-6 text-sm text-slate-500">
          <RefreshCw size={16} className="animate-spin text-violet-400" />
          Loading Trade Command Center…
        </div>
      ) : null}

      {fetchError ? (
        <div className="rounded-xl border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-200">{fetchError}</div>
      ) : null}

      {env?.error ? (
        <div className="rounded-xl border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          {(env.error as { message?: string }).message ?? 'Error'}
        </div>
      ) : null}

      {!(loading && !env && !fetchError) && payload ? (
        <>
          {/* ═══ MARKET CONTEXT STRIP ═══ */}
          <section className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-slate-900 px-3 py-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <span className="font-semibold text-slate-500">SPY</span>
              <span className={`font-bold ${String(market.spy_trend ?? '').toLowerCase().includes('bull') ? 'text-emerald-500' : String(market.spy_trend ?? '').toLowerCase().includes('bear') ? 'text-red-500' : 'text-slate-300'}`}>{String(market.spy_trend ?? '—').toUpperCase()}</span>
              <span className="text-slate-600">|</span>
              <span className="font-semibold text-slate-500">QQQ</span>
              <span className={`font-bold ${String(market.qqq_trend ?? '').toLowerCase().includes('bull') ? 'text-emerald-500' : String(market.qqq_trend ?? '').toLowerCase().includes('bear') ? 'text-red-500' : 'text-slate-300'}`}>{String(market.qqq_trend ?? '—').toUpperCase()}</span>
              <span className="text-slate-600">|</span>
              <span className="font-semibold text-slate-500">VIX</span>
              <span className={`font-bold ${String(market.vix_risk ?? '').toLowerCase().includes('high') ? 'text-red-500' : String(market.vix_risk ?? '').toLowerCase().includes('low') ? 'text-emerald-500' : 'text-amber-500'}`}>{String(market.vix_risk ?? '—').toUpperCase()}</span>
              <span className="text-slate-600">|</span>
              <span className="font-semibold text-slate-500">Regime</span>
              <span className="font-bold text-violet-500">{String(market.market_mode ?? '—').toUpperCase()}</span>
              <span className="text-slate-600">|</span>
              <span className="font-semibold text-slate-500">Best</span>
              <span className="font-bold text-slate-200">{String(market.best_style_today ?? '—')}</span>
              <span className="text-slate-600">|</span>
              <span className="font-semibold text-slate-500">Confidence</span>
              <span className="font-bold text-slate-200">{confidenceScore}%</span>
              <span className="text-slate-600">|</span>
              <span className="font-semibold text-slate-500">Ready</span>
              <span className="font-bold text-emerald-500">{actionable.length}</span>
              {env?.fetched_at ? <span className="ml-auto text-[10px] text-gray-600">{new Date(env.fetched_at).toLocaleTimeString()}</span> : null}
            </div>
          </section>

          {/* ═══ OVERALL DECISION ═══ */}
          {payload.overall_decision ? (
            <OverallDecisionBanner od={payload.overall_decision} />
          ) : null}

          {/* ═══ ACTIVE TRADES ═══ */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <LayoutGrid size={18} className="text-emerald-400" />
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Active Trades</h2>
            </div>
            {(() => {
              const byEngine = (list: typeof recommendations) => {
                const groups: { key: string; label: string; accent: string; items: typeof recommendations }[] = []
                for (const key of ['day', 'swing', 'regular']) {
                  const items = list.filter(r => (r.engine_type || '').toLowerCase() === key)
                  if (items.length === 0) continue
                  const label = key === 'day' ? 'Day Trade' : key === 'swing' ? 'Swing Trade' : 'Position Trading'
                  const accent = key === 'day' ? 'border-orange-500/20' : key === 'swing' ? 'border-violet-500/20' : 'border-sky-500/20'
                  groups.push({ key, label, accent, items })
                }
                return groups
              }

              // Each card shows execution readiness status
              const ready = recommendations
                .filter(r => {
                  const er = (r.execution_timing || r.execution_readiness || '').toUpperCase()
                  return er === 'READY' || er === 'ENTER NOW' || er === 'ENTER'
                })
              const monitoring = recommendations
                .filter(r => {
                  const er = (r.execution_timing || r.execution_readiness || '').toUpperCase()
                  return !['READY', 'ENTER NOW', 'ENTER'].includes(er) && ['WATCH', 'WAIT', 'AVOID', 'NO_EDGE'].includes(er)
                })
              const readyGroups = byEngine(ready)
              const monitoringGroups = byEngine(monitoring)
              return (
                <>
                  {/* Ready section */}
                  {ready.length > 0 && (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="text-emerald-500 text-sm font-bold">Ready</span>
                        <span className="text-xs text-slate-500">{ready.length} setup{ready.length > 1 ? 's' : ''}</span>
                      </div>
                      {readyGroups.map(group => (
                        <div key={group.key}>
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">{group.label}</span>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {group.items.map(rec => {
                              const execStatus = (rec.execution_timing || rec.execution_readiness || '').toUpperCase()
                              const isDay = group.key === 'day'
                              const confPct = rec.display_confidence ?? (typeof rec.confidence === 'number' ? rec.confidence : 0)
                              const chgPct = rec.price_change_pct
                              return (
                                <button key={rec.id} type="button"
                                  onClick={() => {
                                    if (group.key === 'swing') navigate(`/swing-trade?ticker=${encodeURIComponent(rec.ticker)}`)
                                    else if (group.key === 'day') navigate(`/day-trade?ticker=${encodeURIComponent(rec.ticker)}`)
                                    else navigate(getDetailsRoute(group.key, rec.ticker))
                                  }}
                                  className={`rounded-xl border ${group.accent} bg-white dark:bg-slate-900 p-3.5 text-left transition-all hover:shadow-md hover:-translate-y-0.5`}
                                >
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                      <span className="font-mono text-base font-bold text-slate-900 dark:text-white">{rec.ticker}</span>
                                      <span className={`rounded border px-1 py-0.5 text-[9px] font-bold uppercase ${isDay ? 'border-orange-500/30 text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/20' : group.key === 'swing' ? 'border-violet-500/30 text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/20' : 'border-sky-500/30 text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/20'}`}>
                                        {isDay ? 'DAY' : group.key === 'swing' ? 'SWING' : 'REGULAR'}
                                      </span>
                                    </div>
                                    {(() => {
                                      const ec = execStatus
                                      const eCls = ec === 'ENTER NOW' || ec === 'READY' || ec === 'ENTER'
                                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'
                                        : ec === 'WATCH'
                                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                                          : ec === 'WAIT'
                                            ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300'
                                            : ec === 'AVOID' || ec === 'NO_EDGE'
                                              ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                                              : 'bg-slate-100 text-slate-800 dark:bg-slate-800/50 dark:text-slate-300'
                                      return <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${eCls}`}>{ec}</span>
                                    })()}
                                  </div>
                                  <div className="flex items-center gap-2 mb-3">
                                    {chgPct != null && <span className={`text-[13px] font-bold font-mono ${chgPct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>{chgPct >= 0 ? '▲' : '▼'} {Math.abs(chgPct).toFixed(1)}%</span>}
                                    {rec.last_price != null && chgPct == null && <span className="font-mono text-[12px] text-slate-500">${rec.last_price.toFixed(2)}</span>}
                                    <span className="text-[10px] text-slate-500 ml-auto truncate">{rec.strategy || rec.direction || ''}</span>
                                  </div>
                                  <div className="grid grid-cols-3 gap-1 text-[11px] mb-3">
                                    <div><div className="text-slate-500 text-[9px] uppercase tracking-wide">Entry</div><div className="font-mono font-semibold text-slate-900 dark:text-slate-100">{rec.entry_zone || '—'}</div></div>
                                    <div><div className="text-slate-500 text-[9px] uppercase tracking-wide">Target</div><div className="font-mono font-semibold text-emerald-500">{rec.target || '—'}</div></div>
                                    <div><div className="text-slate-500 text-[9px] uppercase tracking-wide">Stop</div><div className="font-mono font-semibold text-red-500">{rec.stop_loss || '—'}</div></div>
                                  </div>
                                  {confPct > 0 && (
                                    <div className="flex items-center justify-end pt-2 border-t border-slate-100 dark:border-white/[0.06]">
                                      <div className="text-right">
                                        <div className="text-[9px] text-slate-500 uppercase">Confidence</div>
                                        <div className={`font-mono text-sm font-bold ${confPct >= 70 ? 'text-emerald-500' : confPct >= 50 ? 'text-amber-500' : 'text-slate-400'}`}>{confPct}%</div>
                                      </div>
                                    </div>
                                  )}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      ))}
                    </>
                  )}

                  {/* Monitoring section */}
                  {monitoring.length > 0 && (
                    <details className="group" open={ready.length === 0}>
                      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900 px-4 py-2 text-xs text-slate-500 select-none hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                        <span className="font-semibold text-slate-700 dark:text-slate-300">Monitoring — {monitoring.length} signal{monitoring.length > 1 ? 's' : ''}</span>
                        <ChevronDown size={12} className="ml-auto text-slate-400 group-open:rotate-180 transition-transform" />
                      </summary>
                      <div className="rounded-b-xl border border-t-0 border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900 px-4 py-3 space-y-3">
                        {monitoringGroups.map(group => (
                          <div key={group.key}>
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{group.label}</span>
                              <span className="text-[10px] text-slate-500">{group.items.length}</span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {group.items.map(rec => (
                                <button key={rec.id} type="button"
                                  onClick={() => {
                                    if (group.key === 'swing') navigate(`/swing-trade?ticker=${encodeURIComponent(rec.ticker)}`)
                                    else if (group.key === 'day') navigate(`/day-trade?ticker=${encodeURIComponent(rec.ticker)}`)
                                    else navigate(getDetailsRoute(group.key, rec.ticker))
                                  }}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-white/[0.08] px-2.5 py-1.5 text-xs hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                                >
                                  <span className="font-mono font-bold text-slate-900 dark:text-white">{rec.ticker}</span>
                                  {(() => {
                                    const ec = (rec.execution_timing || rec.execution_readiness || rec.signal || rec.signal_quality || rec.final_decision || '').toUpperCase()
                                      const eCls = ec === 'ENTER NOW' || ec === 'READY' || ec === 'ENTER'
                                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'
                                        : ec === 'WATCH'
                                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300'
                                          : ec === 'WAIT'
                                            ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/20 dark:text-orange-300'
                                            : ec === 'AVOID' || ec === 'NO_EDGE'
                                              ? 'bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-300'
                                              : 'bg-slate-100 text-slate-600 dark:bg-slate-800/50 dark:text-slate-300'
                                    return <span className={`rounded px-1 py-0.5 text-[9px] font-bold uppercase ${eCls}`}>{ec}</span>
                                  })()}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                  {ready.length === 0 && monitoring.length === 0 && (
                    <div className="rounded-xl border border-dashed border-slate-200 dark:border-white/[0.08] px-4 py-8 text-center text-sm text-slate-500">No active setups right now</div>
                  )}
                </>
              )
            })()}
          </section>

           {/* ═══ ENGINES — Engine Health (collapsed) ═══ */}
          <details className="group rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-slate-900">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3 select-none">
              <BarChart3 size={16} className="text-teal-400" />
              <span className="text-sm font-semibold text-slate-900 dark:text-white">Engine Details &amp; Trust Scores</span>
              <ChevronDown size={14} className="ml-auto text-slate-400 group-open:rotate-180 transition-transform" />
            </summary>
            <div className="px-5 pb-5 space-y-4">
            <div className="border-t border-slate-100 dark:border-white/[0.05] mb-4" />
            <div className="flex flex-col gap-2">
              {/* Locked-engine notices for engines this role can't access */}
              {!canDay && (
                <div className="flex items-center gap-3 rounded-xl border border-dashed border-orange-700/30 bg-orange-950/10 px-4 py-3 text-sm text-orange-400/70">
                  <Zap size={15} className="shrink-0 opacity-50" />
                  <div>
                    <span className="font-semibold">Day Trade Engine</span>
                    <span className="ml-2 text-[11px] text-orange-500/60 uppercase tracking-wide">— Administrator access required</span>
                  </div>
                </div>
              )}
              {!canSwing && (
                <div className="flex items-center gap-3 rounded-xl border border-dashed border-violet-700/30 bg-violet-950/10 px-4 py-3 text-sm text-violet-400/70">
                  <TrendingUp size={15} className="shrink-0 opacity-50" />
                  <div>
                    <span className="font-semibold">Swing Trade Engine</span>
                    <span className="ml-2 text-[11px] text-violet-500/60 uppercase tracking-wide">— Swing Trader plan required</span>
                  </div>
                </div>
              )}
              {engines.length === 0 && canDay && canSwing ? (
                <div className="rounded-xl border border-dashed border-slate-200 dark:border-white/[0.08] px-4 py-8 text-center text-sm text-slate-500">
                  No engine data loaded — check that the backend is running and the last scan completed successfully.
                </div>
              ) : (
                engines.map((card: TradeCommandCenterEngine) => {
                   const topTicker = String(card.top_recommendation?.ticker || '').toUpperCase()
                   const confPct = confidenceNumber(card.confidence)
                   const confColor = readinessColor(confPct)
                   const sigCount = summaryNumber(card.signal_count)
                   const engKey = String(card.engine_type || '').toLowerCase()
                   const isExpanded = expandedEngines.has(engKey)
                   const detailRoute = topTicker ? routeForEngine(engKey, topTicker) : null

                   const engineAccent = engKey === 'day' ? 'text-orange-500 border-orange-500/30 bg-orange-50 dark:bg-orange-950/20' :
                     engKey === 'swing' ? 'text-violet-500 border-violet-500/30 bg-violet-50 dark:bg-violet-950/20' :
                     'text-teal-500 border-teal-500/30 bg-teal-50 dark:bg-teal-950/20'
                   const buttonAccent = engKey === 'day' ? 'bg-orange-600 hover:bg-orange-500' :
                     engKey === 'swing' ? 'bg-violet-600 hover:bg-violet-500' :
                     'bg-teal-600 hover:bg-teal-500'

                   return (
                      <div key={engKey}>
                         <button type="button" onClick={() => setExpandedEngines(prev => { const next = new Set(prev); isExpanded ? next.delete(engKey) : next.add(engKey); return next })} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900 px-3 py-2 shadow-sm text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs sm:text-sm font-bold ${engKey === 'day' ? 'text-orange-600 dark:text-orange-400' : engKey === 'swing' ? 'text-violet-600 dark:text-violet-400' : 'text-teal-600 dark:text-teal-400'}`}>{String(card.engine_type || '').toUpperCase()}</span>
                            <span className="text-[9px] sm:text-[10px] text-slate-500 whitespace-nowrap">{card.timeframe || '—'}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <div className="h-1.5 w-12 sm:w-16 rounded-full bg-slate-100 dark:bg-slate-700/30">
                              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${confPct}%`, backgroundColor: confColor, opacity: 0.7 }} />
                            </div>
                            <span className="text-[10px] sm:text-[11px] font-bold text-slate-900 dark:text-white whitespace-nowrap">{(card as any).display_confidence ?? confPct}%</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-1 min-w-0">
                            <span className="text-[10px] sm:text-[11px] text-slate-400 whitespace-nowrap">{card.market_bias || '—'}</span>
                            <RiskBadge risk={String(card.risk_level || 'Unknown')} />
                            <SignalQualityBadge quality={card.signal_quality || ''} />
                            <ExecTimingBadge timing={card.execution_timing || ''} />
                            <RiskCatBadge category={card.risk_category || ''} />
                            <span className="text-[10px] sm:text-[11px] text-slate-500 whitespace-nowrap">{sigCount} setup{sigCount !== 1 ? 's' : ''}</span>
                          </div>
                          {topTicker ? (
                            <span className="ml-auto shrink-0 text-[10px] sm:text-xs font-semibold text-violet-600 dark:text-violet-300">{topTicker}</span>
                          ) : null}
                          <span className="shrink-0 text-slate-400 transition-transform duration-200" style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                            <ChevronDown size={14} />
                          </span>
                        </button>
                        {isExpanded && (
                          <div className={`rounded-b-xl border-x border-b px-4 pb-4 pt-2 -mt-1 space-y-3 ${engineAccent}`}>
                            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                              {card.setup_quality ? (
                                <div><span className="text-slate-500">Setup Quality</span><span className={`ml-2 font-medium ${qualityColor(card.setup_quality)}`}>{card.setup_quality}</span></div>
                              ) : null}
                              {card.execution_readiness ? (
                                <div><span className="text-slate-500">Execution Readiness</span><span className={`ml-2 font-medium ${qualityColor(card.execution_readiness)}`}>{card.execution_readiness}</span></div>
                              ) : null}
                              {card.final_decision ? (
                                <div><span className="text-slate-500">Final Decision</span><span className={`ml-2 font-medium ${qualityColor(card.final_decision)}`}>{card.final_decision}</span></div>
                              ) : null}
                              {card.risk_state ? (
                                <div><span className="text-slate-500">Risk State</span><span className={`ml-2 font-medium ${qualityColor(card.risk_state)}`}>{card.risk_state}</span></div>
                              ) : null}
                            </div>
                            {card.reason || card.summary ? (
                              <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">{card.reason || card.summary}</p>
                            ) : null}
                            {card.risk_reason ? (
                              <p className="text-xs text-amber-600/80 dark:text-amber-300/70 italic">{card.risk_reason}</p>
                            ) : null}
                            {card.missing_confirmations.length > 0 ? (
                              <p className="text-[10px] text-amber-700 dark:text-amber-200/70 font-medium">Waiting: {card.missing_confirmations.join(' · ')}</p>
                            ) : null}
                            {card.explanation && Object.keys(card.explanation).length > 0 ? (
                              <div className="rounded-lg border border-slate-200 dark:border-white/[0.06] bg-white/50 dark:bg-slate-800/40 px-3 py-2 space-y-1">
                                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">AI Explanation</span>
                                {Object.entries(card.explanation).map(([k, v]) => (
                                  <p key={k} className="text-xs text-slate-700 dark:text-slate-300"><span className="font-medium capitalize">{k.replace(/_/g, ' ')}:</span> {v}</p>
                                ))}
                              </div>
                            ) : null}
                            {detailRoute && canAccessPage(engKey === 'day' ? 'day-trade' : engKey === 'swing' ? 'swing-trade' : 'ticker') ? (
                              <button type="button" onClick={() => navigate(detailRoute)} className={`inline-flex items-center gap-1.5 rounded-lg text-white font-semibold px-3 py-2 text-xs transition-colors ${buttonAccent}`}>
                                Open {String(card.engine_type || '').toUpperCase()} Engine
                                <ArrowRight size={14} />
                              </button>
                            ) : null}
                          </div>
                        )}
                      </div>
                   )
                 })
              )}
            </div>
            </div>
          </details>

          {/* ═══ ALL SETUPS ═══ */}
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <BriefcaseBusiness size={18} className="text-emerald-400" />
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">All Setups</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowAllRecommendations(prev => !prev)}
                className="btn btn-outline gap-2 rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-wide"
              >
                {showAllRecommendations ? 'Hide full table' : 'Show all'}
              </button>
            </div>
            <div className="border-t border-slate-100 dark:border-white/[0.05]" />

            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-slate-900 px-4 py-2.5 text-xs text-slate-500 select-none">
                <span className="font-semibold text-slate-700 dark:text-slate-300">Filter Setups</span>
                <ChevronDown size={12} className="ml-auto text-slate-400 group-open:rotate-180 transition-transform" />
              </summary>
              <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-end gap-3 rounded-b-xl border border-t-0 border-slate-200 dark:border-white/[0.08] bg-white dark:bg-slate-900 px-4 pb-4 pt-3">
              <label className="text-xs text-slate-500">
                Engine Type
                <select value={engine} onChange={e => setEngine(e.target.value)} className="mt-1 block w-full sm:w-36 rounded-lg border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-white">
                  <option value="">All</option>
                  {canDay   && <option value="day">Day</option>}
                  {canSwing && <option value="swing">Swing</option>}
                  <option value="regular">Regular</option>
                </select>
              </label>
              <label className="text-xs text-slate-500">
                Signal
                <select value={signal} onChange={e => setSignal(e.target.value)} className="mt-1 block w-full sm:w-36 rounded-lg border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-white">
                  <option value="">All</option>
                  <option value="READY">READY</option>
                  <option value="WATCH">WATCH</option>
                  <option value="WAIT">WAIT</option>
                  <option value="AVOID">AVOID</option>
                  <option value="NO_EDGE">NO_EDGE</option>
                </select>
              </label>
              <label className="text-xs text-slate-500">
                Direction
                <select value={direction} onChange={e => setDirection(e.target.value)} className="mt-1 block w-full sm:w-36 rounded-lg border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-white">
                  <option value="">All</option>
                  <option value="call">Call</option>
                  <option value="put">Put</option>
                  <option value="spread">Spread</option>
                  <option value="stock">Stock</option>
                </select>
              </label>
              <label className="text-xs text-slate-500">
                Risk
                <select value={risk} onChange={e => setRisk(e.target.value)} className="mt-1 block w-full sm:w-32 rounded-lg border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-white">
                  <option value="">All</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>
              </div>
            </details>

            <div className="grid gap-4 xl:grid-cols-[1.6fr_0.8fr] items-start">
                <div className="grid gap-2">
                {actionable.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 dark:border-white/[0.08] px-4 py-8 text-center text-sm text-slate-500">
                    No READY or TRADE signals match the current filters — widen engine/direction filters or wait for next scan cycle.
                  </div>
                ) : (
                  actionable.map(rec => {
                    const expanded = expandedOpportunityId === rec.id
                    const detailsRoute = getDetailsRoute(rec.engine_type, rec.ticker)
                    const recKey = rec.id
                    const execStatus = (rec.execution_timing || rec.execution_readiness || rec.signal_quality || rec.final_decision || rec.signal || '').toUpperCase()
                    const execBadgeCls = execStatus === 'ENTER NOW' || execStatus === 'READY' || execStatus === 'ENTER'
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'
                      : execStatus === 'WATCH'
                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                        : execStatus === 'WAIT'
                          ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300'
                          : execStatus === 'AVOID' || execStatus === 'NO_EDGE'
                            ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                            : 'bg-slate-100 text-slate-800 dark:bg-slate-800/50 dark:text-slate-300'
                    return (
                      <div key={recKey}>
                        <button type="button" onClick={() => setExpandedOpportunityId(expanded ? null : recKey)} className="flex w-full items-start gap-3 rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900 px-4 py-3 shadow-sm text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <div className="flex flex-wrap items-center gap-1.5 min-w-0 flex-1">
                            <span className="font-mono text-sm font-bold text-slate-900 dark:text-white">{rec.ticker}</span>
                            <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${execBadgeCls}`}>{execStatus}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <div className="text-right">
                              <div className="text-[10px] uppercase tracking-wide text-slate-500">Signal</div>
                              <div className="text-xs font-semibold text-slate-900 dark:text-white">{String(rec.display_confidence || rec.confidence || '—')}</div>
                            </div>
                            <span className="text-slate-400 transition-transform duration-200" style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                              <ChevronDown size={16} />
                            </span>
                          </div>
                        </button>
                        {expanded && (
                          <div className="rounded-b-xl border-x border-b border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900/60 px-4 pb-4 pt-2 -mt-1 space-y-3">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <EngineBadge engine={rec.engine_type} />
                              {rec.signal_quality && <SignalQualityBadge quality={rec.signal_quality} />}
                              {rec.execution_timing && <ExecTimingBadge timing={rec.execution_timing} />}
                              {rec.risk_category && <RiskCatBadge category={rec.risk_category} />}
                            </div>
                            <div className="text-sm font-semibold text-violet-700 dark:text-violet-200">{rec.strategy}</div>
                            <div className="text-xs text-slate-500">{rec.direction} · Expiry {rec.expiry || '—'}</div>

                            <div className="grid grid-cols-2 gap-3 text-sm">
                              <div className="rounded-lg border border-slate-100 dark:border-white/[0.06] bg-slate-50 dark:bg-slate-800/50 px-3 py-2">
                                <div className="text-[11px] uppercase tracking-wide text-slate-500">Regime Bias</div>
                                <div className="mt-1 text-slate-900 dark:text-slate-100">{rec.market_bias || '—'}</div>
                              </div>
                              <div className="rounded-lg border border-slate-100 dark:border-white/[0.06] bg-slate-50 dark:bg-slate-800/50 px-3 py-2">
                                <div className="text-[11px] uppercase tracking-wide text-slate-500">Entry Timing</div>
                                <div className="mt-1"><ExecTimingBadge timing={String(rec.execution_timing || rec.execution_readiness || '—')} /></div>
                              </div>
                            </div>

                            {(rec.execution_fields && rec.execution_fields.length > 0) ? (
                              <div className="flex flex-wrap gap-2 text-sm">
                                {rec.execution_fields.map((ef: { label: string; value: string }, i: number) => (
                                  <div key={i} className="rounded-lg border border-slate-100 dark:border-white/[0.06] bg-slate-50 dark:bg-slate-800/50 px-3 py-2 min-w-[100px] flex-1">
                                    <div className="text-[11px] uppercase tracking-wide text-slate-500">{ef.label}</div>
                                    <div className="mt-1 text-slate-900 dark:text-slate-100 font-medium">{ef.value}</div>
                                  </div>
                                ))}
                              </div>
                            ) : (rec.entry_zone || rec.target || rec.stop_loss) ? (
                              <div className="grid grid-cols-3 gap-3 text-sm">
                                {rec.entry_zone ? (
                                  <div className="rounded-lg border border-slate-100 dark:border-white/[0.06] bg-slate-50 dark:bg-slate-800/50 px-3 py-2">
                                    <div className="text-[11px] uppercase tracking-wide text-slate-500">Entry</div>
                                    <div className="mt-1 text-slate-900 dark:text-slate-100">{rec.entry_zone}</div>
                                  </div>
                                ) : null}
                                {rec.target ? (
                                  <div className="rounded-lg border border-slate-100 dark:border-white/[0.06] bg-slate-50 dark:bg-slate-800/50 px-3 py-2">
                                    <div className="text-[11px] uppercase tracking-wide text-slate-500">Target</div>
                                    <div className="mt-1 text-slate-900 dark:text-slate-100">{rec.target}</div>
                                  </div>
                                ) : null}
                                {rec.stop_loss ? (
                                  <div className="rounded-lg border border-slate-100 dark:border-white/[0.06] bg-slate-50 dark:bg-slate-800/50 px-3 py-2">
                                    <div className="text-[11px] uppercase tracking-wide text-slate-500">Stop</div>
                                    <div className="mt-1 text-slate-900 dark:text-slate-100">{rec.stop_loss}</div>
                                  </div>
                                ) : null}
                              </div>
                            ) : null}

                            {rec.explanation?.summary ? (
                              <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">{rec.explanation.summary}</p>
                            ) : (
                              <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">{rec.reason || 'No reason from API.'}</p>
                            )}
                            {rec.explanation?.recommended_action ? (
                              <p className="text-sm leading-relaxed text-violet-700/90 dark:text-violet-200/90">{rec.explanation.recommended_action}</p>
                            ) : (
                              <p className="text-sm leading-relaxed text-violet-700/90 dark:text-violet-200/90">{rec.recommended_action || rec.action_label || 'Verify entry trigger, stop, and target before sizing in.'}</p>
                            )}
                            {rec.risk_reason ? (
                              <p className="text-xs text-amber-600/80 dark:text-amber-300/70 italic">{rec.risk_reason}</p>
                            ) : null}
                            {(rec.engine_type || '').toLowerCase() === 'day' && rec.option_risk_context?.option_execution_warning ? (
                              <div className="rounded-lg border border-amber-200/70 bg-amber-50/90 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:border-amber-500/20 dark:bg-amber-900/15 dark:text-amber-200/90">
                                <span className="font-semibold">Option execution:</span> {rec.option_risk_context.option_execution_warning}
                              </div>
                            ) : null}
                            {rec.missing_confirmations && rec.missing_confirmations.length > 0 ? (
                              <p className={`text-xs ${(rec.engine_type || '').toLowerCase() === 'day' ? 'text-orange-700/90 dark:text-orange-200/90' : 'text-amber-700/90 dark:text-amber-200/90'}`}>
                                {(rec.engine_type || '').toLowerCase() === 'day'
                                  ? `WAIT — confirming: ${rec.missing_confirmations.slice(0, 2).join(', ')}${rec.missing_confirmations.length > 2 ? '…' : ''} before entry is valid.`
                                  : `PENDING — needs: ${rec.missing_confirmations.join(' · ')} to align before acting.`}
                              </p>
                            ) : null}

                            <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100 dark:border-white/[0.05]">
                              <button type="button" className="btn btn-primary gap-2 rounded-lg px-2.5 py-1.5 text-xs" onClick={() => handleAddToPositions(rec)}>
                                Add to Positions
                              </button>
                              <button type="button" className="btn btn-warning gap-2 rounded-lg px-2.5 py-1.5 text-xs" onClick={() => handleCreateAlert(rec.ticker)}>
                                Create Alert
                              </button>
                              <button type="button" className="btn btn-outline gap-2 rounded-lg px-2.5 py-1.5 text-xs" onClick={() => navigate(detailsRoute)}>
                                View Details
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>

              <div className="sticky top-4 self-start space-y-4">
                <div className="rounded-xl border border-rose-200 dark:border-rose-900/30 bg-rose-50/50 dark:bg-rose-950/10 border-l-[3px] border-l-rose-500 p-4 md:p-5">
                  <div className="mb-3 flex items-center gap-2">
                    <AlertTriangle size={16} className="text-rose-300" />
                    <h3 className="text-sm font-semibold text-rose-700 dark:text-rose-300">AVOID — High-Risk or Conflicting Tickers</h3>
                  </div>
                  <div className="space-y-3">
                    {avoids.length === 0 ? (
                      <div className="text-sm text-slate-500">No AVOID signals under current filters — all scanned tickers are WATCH or better.</div>
                    ) : (
                      avoids.map(rec => (
                        <div key={`avoid-${rec.id}`} className="rounded-lg border border-rose-100 dark:border-rose-900/20 bg-white dark:bg-slate-900/80 p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono font-semibold text-slate-900 dark:text-white">{rec.ticker}</span>
                            <EngineBadge engine={rec.engine_type} />
                            <div className="flex items-center gap-1">
                              <SignalQualityBadge quality={rec.signal_quality || ''} />
                              <ExecTimingBadge timing={rec.execution_timing || ''} />
                              <RiskCatBadge category={rec.risk_category || ''} />
                            </div>
                          </div>
                          <div className="mt-2 text-sm text-slate-700 dark:text-slate-300">{rec.reason || 'No reason from API.'}</div>
                          <div className="mt-2 text-xs text-amber-700 dark:text-amber-300">Action: {rec.recommended_action || rec.action_label || 'Stand aside — re-evaluate if signal flips to WATCH above key resistance.'}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>

            {showAllRecommendations ? (
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900">
                <table className="min-w-[1080px] w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-white/[0.05] text-left text-[11px] uppercase tracking-wide text-slate-500">
                      <th className="px-3 py-2">Ticker</th>
                      <th className="px-3 py-2">Engine</th>
                      <th className="px-3 py-2">Setup</th>
                      <th className="px-3 py-2">Timing</th>
                      <th className="px-3 py-2">Risk</th>
                      <th className="px-3 py-2">Direction</th>
                      <th className="px-3 py-2">Strategy</th>
                      <th className="px-3 py-2">Expiry</th>
                      <th className="px-3 py-2">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recommendations.map(rec => (
                      <tr key={`table-${rec.id}`} className="border-b border-slate-100 dark:border-white/[0.05] align-top">
                        <td className="px-3 py-3 font-semibold text-slate-900 dark:text-white">{rec.ticker}</td>
                        <td className="px-3 py-3"><EngineBadge engine={rec.engine_type} /></td>
                        <td className="px-3 py-3"><SignalQualityBadge quality={rec.signal_quality || rec.final_decision || ''} /></td>
                        <td className="px-3 py-3"><ExecTimingBadge timing={rec.execution_timing || rec.execution_readiness || ''} /></td>
                        <td className="px-3 py-3"><RiskCatBadge category={rec.risk_category || rec.risk_state || ''} /></td>
                        <td className="px-3 py-3 text-slate-700 dark:text-slate-300">{rec.direction || '—'}</td>
                        <td className="px-3 py-3 text-slate-700 dark:text-slate-300">{rec.strategy || '—'}</td>
                        <td className="px-3 py-3 text-slate-700 dark:text-slate-300">{rec.expiry || '—'}</td>
                        <td className="max-w-sm px-3 py-3 text-slate-500">{rec.reason || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>

          {(canDay || canSwing) && <section className="space-y-4">
            <div className="flex items-center gap-2">
              <ShieldAlert size={18} className="text-violet-400" />
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Cross-Engine Signal Conflicts — Do Not Trade Until Resolved</h2>
            </div>
            <div className="grid gap-2">
              {conflicts.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 dark:border-white/[0.08] px-4 py-8 text-center text-sm text-slate-500">
                  No cross-engine conflicts right now — all active engines are in signal agreement.
                </div>
              ) : (
                conflicts.map(conflict => {
                  const conflictKey = conflict.id
                  const conflictExpanded = expandedConflictId === conflictKey
                  return (
                    <div key={conflictKey}>
                      <button type="button" onClick={() => setExpandedConflictId(conflictExpanded ? null : conflictKey)} className="flex w-full items-center gap-3 rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900 px-4 py-3 shadow-sm text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <span className="font-mono text-sm font-bold text-slate-900 dark:text-white shrink-0">{conflict.ticker}</span>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${badgeClass(toneFromText(conflict.state))}`}>
                          {conflict.state === 'CONFLICTING_SIGNALS' ? 'SIGNAL CONFLICT' : conflict.state.replace(/_/g, ' ')}
                        </span>
                        <span className="ml-auto shrink-0 text-slate-400 transition-transform duration-200" style={{ transform: conflictExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                          <ChevronDown size={16} />
                        </span>
                      </button>
                      {conflictExpanded && (
                        <div className="rounded-b-xl border-x border-b border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900/60 px-4 pb-4 pt-2 -mt-1 space-y-3">
                          <div className="text-sm text-slate-700 dark:text-slate-300">{conflict.summary}</div>
                          <div className="space-y-2 text-sm">
                            {conflict.signals.map(row => (
                              <div key={`${conflict.id}-${row.engine_type}`} className="rounded-lg border border-slate-100 dark:border-white/[0.06] bg-slate-50 dark:bg-slate-800/50 px-3 py-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <EngineBadge engine={row.engine_type} />
                                  <SignalBadge signal={row.signal} />
                                </div>
                                {row.note ? <div className="mt-2 text-slate-500">{row.note}</div> : null}
                              </div>
                            ))}
                          </div>
                          <div className="rounded-xl border border-amber-700/25 bg-amber-500/5 p-3">
                            <div className="text-[11px] uppercase tracking-wide text-amber-700 dark:text-amber-200/80">Root Cause</div>
                            <div className="mt-1 text-sm text-slate-800 dark:text-slate-200">{conflict.resolution}</div>
                            <div className="mt-2 text-sm text-amber-700 dark:text-amber-200">ACTION — {conflict.suggested_action}</div>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </section>}

          <details className="group rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-slate-900">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3 select-none">
              <LineChart size={16} className="text-violet-400" />
              <span className="text-sm font-semibold text-slate-900 dark:text-white">Market Graphs / Trend Visuals</span>
              <ChevronDown size={14} className="ml-auto text-slate-400 group-open:rotate-180 transition-transform" />
            </summary>
            <div className="px-5 pb-5 space-y-4">
            <div className="grid gap-4 xl:grid-cols-2">
              <ChartShell title="SPY vs QQQ Trend Strength" subtitle="Trend conviction and direction for the two major indices.">
                <div className="space-y-4">
                  {(charts?.trend_strength ?? []).map(entry => {
                    const val = Math.min(100, Math.max(0, entry.value))
                    const isBullish = toneFromText(String(entry.tone ?? 'neutral')) === 'bullish'
                    const fillColor = isBullish ? '#34d399' : '#60a5fa'
                    const bgColor = isBullish ? 'bg-emerald-500/10' : 'bg-blue-500/10'
                    const textColor = isBullish ? 'text-emerald-400' : 'text-blue-400'
                    const label = entry.tone ? String(entry.tone).toUpperCase() : isBullish ? 'BULLISH' : 'BEARISH'
                    return (
                      <div key={entry.label}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-semibold text-slate-900 dark:text-white">{entry.label}</span>
                          <span className={`text-xs font-bold ${textColor}`}>{label}</span>
                        </div>
                        <div className="relative h-8 rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-800">
                          <div className="absolute inset-0 flex items-center justify-center z-10">
                            <span className="text-xs font-bold text-slate-900 dark:text-white drop-shadow-sm">{val}/100</span>
                          </div>
                          <div className="h-full rounded-lg transition-all duration-500" style={{ width: `${val}%`, backgroundColor: fillColor, opacity: 0.75 }} />
                        </div>
                        <div className="flex justify-between mt-0.5 text-[10px] text-slate-500">
                          <span>Bearish</span>
                          <span>Neutral</span>
                          <span>Bullish</span>
                        </div>
                      </div>
                    )
                  })}
                  {(charts?.trend_strength ?? []).length === 0 && (
                    <div className="h-20 flex items-center justify-center text-xs text-slate-500">No trend data available.</div>
                  )}
                </div>
              </ChartShell>

              <ChartShell title="Engine Signal Distribution" subtitle="How each engine is leaning right now.">
                <div className="space-y-4">
                  {(charts?.engine_signal_distribution ?? []).filter(entry => {
                    const e = entry.engine.toLowerCase()
                    if (e === 'day')   return canDay
                    if (e === 'swing') return canSwing
                    return true
                  }).map(entry => {
                    const total = (entry.READY || 0) + (entry.WATCH || 0) + (entry.WAIT || 0) + (entry.AVOID || 0) + (entry.NO_EDGE || 0)
                    const segments = [
                      { key: 'READY', value: entry.READY || 0, color: '#34d399', label: 'Ready' },
                      { key: 'WATCH', value: entry.WATCH || 0, color: '#f59e0b', label: 'Watch' },
                      { key: 'WAIT', value: entry.WAIT || 0, color: '#fbbf24', label: 'Wait' },
                      { key: 'AVOID', value: entry.AVOID || 0, color: '#ef4444', label: 'Avoid' },
                      { key: 'NO_EDGE', value: entry.NO_EDGE || 0, color: '#94a3b8', label: 'No Edge' },
                    ].filter(s => s.value > 0)
                    return (
                      <div key={entry.engine}>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-sm font-semibold text-slate-900 dark:text-white">{entry.engine}</span>
                          <span className="text-xs text-slate-500">{total} signal{total !== 1 ? 's' : ''}</span>
                        </div>
                        {segments.length > 0 ? (
                          <div className="flex h-7 rounded-lg overflow-hidden">
                            {segments.map(seg => {
                              const pct = total > 0 ? Math.round((seg.value / total) * 100) : 0
                              return (
                                <div key={seg.key} className="flex items-center justify-center text-[10px] font-bold text-white transition-all" style={{ width: `${pct}%`, backgroundColor: seg.color, minWidth: pct > 0 ? '8px' : '0' }} title={`${seg.label}: ${seg.value}`}>
                                  {pct >= 15 ? seg.label : null}
                                </div>
                              )
                            })}
                          </div>
                        ) : (
                          <div className="h-7 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-[10px] text-slate-500">No signals</div>
                        )}
                        <div className="flex flex-wrap gap-3 mt-1">
                          {segments.map(seg => {
                            const pct = total > 0 ? Math.round((seg.value / total) * 100) : 0
                            return (
                              <span key={seg.key} className="flex items-center gap-1 text-[10px] text-slate-500">
                                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: seg.color }} />
                                {seg.label} {seg.value} ({pct}%)
                              </span>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                  {(charts?.engine_signal_distribution ?? []).filter(entry => {
                    const e = entry.engine.toLowerCase()
                    if (e === 'day')   return canDay
                    if (e === 'swing') return canSwing
                    return true
                  }).length === 0 && (
                    <div className="h-20 flex items-center justify-center text-xs text-slate-500">No engine signal data available.</div>
                  )}
                </div>
              </ChartShell>

              <ChartShell title="Risk Distribution" subtitle="Current opportunity mix by risk tier.">
                <div className="space-y-4">
                  {(() => {
                    const data = charts?.risk_distribution ?? []
                    const total = data.reduce((s, r) => s + (r.value || 0), 0)
                    const riskColors: Record<string, string> = { low: '#34d399', medium: '#f59e0b', high: '#ef4444' }
                    const riskLabels: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High' }
                    return (
                      <>
                        {total > 0 ? (
                          <div className="flex h-10 rounded-lg overflow-hidden">
                            {['low', 'medium', 'high'].map(key => {
                              const entry = data.find(d => String(d.label || '').toLowerCase() === key)
                              const val = entry?.value || 0
                              const pct = total > 0 ? Math.round((val / total) * 100) : 0
                              const color = riskColors[key]
                              return (
                                <div key={key} className="flex flex-col items-center justify-center text-white transition-all" style={{ width: `${pct}%`, backgroundColor: color, minWidth: pct > 0 ? '8px' : '0' }}>
                                  {pct >= 12 ? <span className="text-[11px] font-bold">{key.charAt(0).toUpperCase() + key.slice(1)}</span> : null}
                                  {pct >= 12 ? <span className="text-[9px] opacity-80">{val}</span> : null}
                                </div>
                              )
                            })}
                          </div>
                        ) : (
                          <div className="h-10 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-xs text-slate-500">No risk data</div>
                        )}
                        <div className="grid grid-cols-3 gap-2">
                          {['low', 'medium', 'high'].map(key => {
                            const entry = data.find(d => String(d.label || '').toLowerCase() === key)
                            const val = entry?.value || 0
                            const pct = total > 0 ? Math.round((val / total) * 100) : 0
                            const color = riskColors[key]
                            return (
                              <div key={key} className="rounded-lg border border-slate-100 dark:border-white/[0.06] bg-slate-50 dark:bg-slate-800/50 p-2 text-center">
                                <div className="w-2 h-2 rounded-full mx-auto mb-1" style={{ backgroundColor: color }} />
                                <div className="text-xs font-semibold text-slate-900 dark:text-white">{val}</div>
                                <div className="text-[10px] text-slate-500">{riskLabels[key]}</div>
                                <div className="text-[10px] text-slate-400">{pct}%</div>
                              </div>
                            )
                          })}
                        </div>
                      </>
                    )
                  })()}
                </div>
              </ChartShell>

              <ChartShell title="Best Style Allocation" subtitle="How today’s tape is pushing your focus across trade styles.">
                <div className="space-y-4 pt-2">
                  {(charts?.style_allocation ?? []).map(entry => (
                    <div key={entry.label} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-700 dark:text-slate-300">{entry.label}</span>
                        <span className="font-semibold text-slate-900 dark:text-slate-100">{entry.value}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800">
                        <div className="h-2 rounded-full bg-violet-400" style={{ width: `${Math.max(0, Math.min(100, entry.value))}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </ChartShell>
            </div>
            </div>
          </details>

          <details className="group rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-slate-900">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3 select-none">
              <BellRing size={16} className="text-violet-400" />
              <span className="text-sm font-semibold text-slate-900 dark:text-white">Activity &amp; Alerts</span>
              <ChevronDown size={14} className="ml-auto text-slate-400 group-open:rotate-180 transition-transform" />
            </summary>
            <div className="px-5 pb-5">
            <div className="grid gap-4 xl:grid-cols-[1fr_1fr] pt-4">
            <div className="rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900 p-4">
              <div className="mb-4 flex items-center gap-2">
                <BellRing size={18} className="text-violet-400" />
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Risk &amp; Alert Snapshot</h2>
              </div>

              {(() => {
                const pressure = alertPressureLevel(alertsSummary)
                const pct = Math.min(90, Math.max(5, (alertsSummary.active_alerts + alertsSummary.critical_alerts * 2 + alertsSummary.high_iv_warnings) * 10))
                return (
                  <div className="mb-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Alert Pressure</span>
                      <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: pressure.color }}>{pressure.label}</span>
                    </div>
                    <div className="tcc-alert-bar">
                      <div className="tcc-alert-bar-segment quiet" style={{ width: '20%' }} />
                      <div className="tcc-alert-bar-segment watch" style={{ width: '20%' }} />
                      <div className={`tcc-alert-bar-segment active ${alertsSummary.active_alerts >= 3 ? 'active-fill' : ''}`} style={{ width: '20%' }} />
                      <div className={`tcc-alert-bar-segment elevated ${alertsSummary.critical_alerts >= 2 || alertsSummary.positions_requiring_exit > 0 ? 'elevated-fill' : ''}`} style={{ width: '20%' }} />
                      <div className={`tcc-alert-bar-segment critical ${alertsSummary.critical_alerts >= 3 || alertsSummary.positions_requiring_exit >= 2 ? 'critical-fill' : ''}`} style={{ width: '20%' }} />
                      <div className="tcc-alert-bar-active" style={{ left: `${pct}%` }} />
                    </div>
                  </div>
                )
              })()}

              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Market Breadth</span>
                  <span className="text-[10px] text-gray-500">{(() => {
                    const mode = String(market.market_mode ?? '').toLowerCase()
                    if (mode.includes('bull') || mode.includes('euphoric')) return 'Bullish bias'
                    if (mode.includes('bear') || mode.includes('defensive')) return 'Bearish bias'
                    return 'Mixed'
                  })()}</span>
                </div>
                <div className="tcc-breadth-bar">
                  <div
                    className="tcc-breadth-advancing"
                    style={{ width: `${(() => {
                      const mode = String(market.market_mode ?? '').toLowerCase()
                      if (mode.includes('euphoric')) return 72
                      if (mode.includes('bull')) return 62
                      if (mode.includes('neutral')) return 52
                      if (mode.includes('defensive')) return 38
                      if (mode.includes('bear')) return 28
                      return 50
                    })()}%` }}
                  />
                  <div
                    className="tcc-breadth-declining"
                    style={{ width: `${(() => {
                      const mode = String(market.market_mode ?? '').toLowerCase()
                      if (mode.includes('euphoric')) return 28
                      if (mode.includes('bull')) return 38
                      if (mode.includes('neutral')) return 48
                      if (mode.includes('defensive')) return 62
                      if (mode.includes('bear')) return 72
                      return 50
                    })()}%` }}
                  />
                </div>
                <div className="mt-1 flex justify-between text-[10px] text-gray-600">
                  <span>Adv.</span>
                  <span>Dec.</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {[
                  ['Active alerts', alertsSummary.active_alerts],
                  ['Critical alerts', alertsSummary.critical_alerts],
                  ['Positions requiring exit', alertsSummary.positions_requiring_exit],
                  ['Near expiry trades', alertsSummary.near_expiry_trades],
                  ['High IV warnings', alertsSummary.high_iv_warnings],
                ].map(([label, raw]) => (
                  <div key={label} className="rounded-lg border border-slate-100 dark:border-white/[0.06] bg-slate-50 dark:bg-slate-800/50 px-3 py-3">
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
                    <div className="mt-1 text-2xl font-semibold text-slate-900 dark:text-white">{summaryNumber(raw)}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" className="btn btn-outline gap-2 rounded-lg px-3 py-2 text-xs" onClick={() => navigate(ROUTES.alerts)}>
                  View Alert Center
                </button>
                <button type="button" className="btn btn-outline gap-2 rounded-lg px-3 py-2 text-xs" onClick={() => navigate(ROUTES.positions)}>
                  View Positions Center
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900 p-4">
              <div className="mb-4 flex items-center gap-2">
                <Clock size={18} className="text-violet-400" />
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Recent Decisions / Activity</h2>
              </div>
              <div className="space-y-3">
                {recentActivity.length === 0 ? (
                  <div className="text-sm text-slate-500">No recent activity from the API yet.</div>
                ) : (
                  recentActivity.map((item: TradeCommandCenterActivity) => (
                    <div key={item.id} className="rounded-lg border border-slate-100 dark:border-white/[0.06] bg-slate-50 dark:bg-slate-800/50 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-semibold text-slate-900 dark:text-white">{item.ticker}</span>
                        <EngineBadge engine={item.engine_type} />
                        <SignalBadge signal={item.signal} />
                      </div>
                      <div className="mt-2 text-sm text-slate-700 dark:text-slate-300">
                        {item.action_taken ? `${item.action_taken} · ` : ''}
                        {item.message || 'Decision update'}
                      </div>
                      <div className="mt-2 text-[11px] text-slate-500">{fmtTimestamp(item.timestamp)}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
            </div>
            </div>
          </details>
        </>
      ) : null}
    </div>
  )
}
