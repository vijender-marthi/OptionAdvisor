import axios from 'axios'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  RefreshCw,
  Zap,
  TrendingUp,
  Clock,
  ShieldAlert,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { fetchMarketPosition, fetchTradeCommandCenter } from '../api/commandCenter'
import type { MarketPositionData } from '../api/commandCenter'
import { useApp } from '../contexts/AppContext'
import { ROUTES, getDetailsRoute } from '../routing/routes'
import type {
  ApiEnvelope,
  OverallDecision,
  TradeCommandCenterEngine,
  TradeCommandCenterPayload,
  TradeCommandCenterRecommendation,
  TradeCommandCenterConflict,
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
    v === 'STRONG_GO' ? 'border-emerald-500/50 bg-emerald-950/20 dark:bg-emerald-900/15' :
    v === 'GO'        ? 'border-sky-500/40    bg-sky-950/20    dark:bg-sky-900/15'       :
    v === 'WATCH'     ? 'border-amber-500/40  bg-amber-950/15  dark:bg-amber-900/10'     :
                        'border-slate-500/30  bg-slate-900/40  dark:bg-slate-800/20'

  const verdictCls =
    v === 'STRONG_GO' ? 'bg-emerald-500 text-white' :
    v === 'GO'        ? 'bg-sky-500     text-white' :
    v === 'WATCH'     ? 'bg-amber-500   text-white' :
                        'bg-slate-600   text-white'

  const dotCls =
    v === 'STRONG_GO' ? 'bg-emerald-400' :
    v === 'GO'        ? 'bg-sky-400'     :
    v === 'WATCH'     ? 'bg-amber-400'   :
                        'bg-slate-500'

  const labelCls =
    v === 'STRONG_GO' ? 'text-semantic-bullish' :
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

  // ── Unified verdict helpers ──────────────────────────────────────────────
  function recVerdict(rec: TradeCommandCenterRecommendation): string {
    if (rec.verdict) return rec.verdict
    const fd = String(rec.final_decision || rec.signal || '').toUpperCase().replace(/ /g, '_').replace(/-/g, '_')
    if (fd === 'STRONG_GO' || fd === 'STRONG GO') return 'STRONG_GO'
    if (fd === 'READY' || fd === 'TRADE' || fd === 'GO') return 'GO'
    if (fd === 'WATCH') return 'WATCH'
    if (fd === 'WAIT') return 'WAIT'
    if (fd === 'AVOID' || fd === 'EXIT' || fd === 'NO_EDGE') return 'AVOID'
    return 'NO_EDGE'
  }

  function verdictRank(v: string): number {
    if (v === 'STRONG_GO') return 5
    if (v === 'GO')        return 4
    if (v === 'WATCH')     return 3
    if (v === 'WAIT')      return 2
    if (v === 'AVOID')     return 1
    return 0
  }

  function verdictBadge(v: string): { label: string; cls: string } {
    if (v === 'STRONG_GO') return { label: 'Strong Go', cls: 'bg-emerald-500 text-white' }
    if (v === 'GO')        return { label: 'Go',         cls: 'bg-emerald-400/20 text-emerald-300 border border-emerald-500/40' }
    if (v === 'WATCH')     return { label: 'Watch',      cls: 'bg-amber-400/15 text-amber-300 border border-amber-500/40' }
    if (v === 'WAIT')      return { label: 'Wait',       cls: 'bg-slate-700/60 text-slate-300 border border-slate-600/40' }
    if (v === 'AVOID')     return { label: 'Avoid',      cls: 'bg-rose-500/15 text-rose-300 border border-rose-600/40' }
    return                         { label: 'No Edge',   cls: 'bg-slate-800/60 text-slate-500 border border-slate-700/40' }
  }

  function borderAccent(v: string): string {
    if (v === 'STRONG_GO') return 'border-l-emerald-500'
    if (v === 'GO')        return 'border-l-emerald-400'
    if (v === 'WATCH')     return 'border-l-amber-400'
    if (v === 'WAIT')      return 'border-l-slate-500'
    return                        'border-l-rose-500'
  }

  function engineAccent(eng: string): string {
    if (eng === 'day')     return 'border-orange-500/20 hover:border-orange-500/40'
    if (eng === 'swing')   return 'border-violet-500/20 hover:border-violet-500/40'
    return                        'border-teal-500/20 hover:border-teal-500/40'
  }

  function engineChip(eng: string): string {
    if (eng === 'day')   return 'border-orange-500/30 text-orange-400 bg-orange-950/20'
    if (eng === 'swing') return 'border-violet-500/30 text-violet-400 bg-violet-950/20'
    return                      'border-teal-500/30 text-teal-400 bg-teal-950/20'
  }

  // ── Shared sub-indicator rows shown inside every card ────────────────────
  function SubIndicators({ rec }: { rec: TradeCommandCenterRecommendation }) {
    const rows: Array<{ label: string; value: string; tone: string }> = []

    function tone(val: string): string {
      const v = val.toUpperCase()
      if (['STRONG', 'PRIME', 'READY', 'HIGH', 'LOW_RISK', 'BULLISH', 'CONFIRMED'].some(k => v.includes(k))) return 'text-emerald-400'
      if (['WEAK', 'AVOID', 'HIGH_RISK', 'EXTREME', 'NO_EDGE', 'POOR'].some(k => v.includes(k))) return 'text-rose-400'
      if (['WATCH', 'MODERATE', 'MEDIUM', 'PARTIAL', 'MIXED', 'ELEVATED'].some(k => v.includes(k))) return 'text-amber-400'
      return 'text-slate-400'
    }

    if (rec.setup_quality)       rows.push({ label: 'Setup',     value: rec.setup_quality,       tone: tone(rec.setup_quality) })
    if (rec.execution_readiness) rows.push({ label: 'Execution', value: rec.execution_readiness,  tone: tone(rec.execution_readiness) })
    if (rec.signal_quality)      rows.push({ label: 'Signal',    value: rec.signal_quality,       tone: tone(rec.signal_quality) })
    if (rec.risk_state)          rows.push({ label: 'Risk',      value: rec.risk_state,           tone: tone(rec.risk_state) })
    if (rec.market_bias)         rows.push({ label: 'Bias',      value: rec.market_bias,          tone: tone(rec.market_bias) })

    const supporting = (rec.supporting_factors || []).slice(0, 2)
    const missing    = (rec.missing_confirmations || []).slice(0, 2)
    const hasReason  = rec.reason && String(rec.reason).length > 0

    if (rows.length === 0 && supporting.length === 0 && missing.length === 0 && !hasReason) return null

    return (
      <div className="mt-2.5 space-y-1.5 border-t border-white/[0.06] pt-2.5">
        {/* Sub-indicator pills */}
        {rows.length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {rows.map(r => (
              <div key={r.label} className="flex items-center gap-1 min-w-0">
                <span className="text-[9px] uppercase tracking-wide text-slate-600 shrink-0">{r.label}</span>
                <span className={`text-[10px] font-semibold uppercase ${r.tone} truncate`}>{r.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Supporting factors */}
        {supporting.length > 0 && (
          <div className="space-y-0.5">
            {supporting.map((f, i) => (
              <div key={i} className="flex items-start gap-1.5 text-[10px] text-emerald-600">
                <span className="mt-0.5 shrink-0">✓</span>
                <span className="leading-tight truncate">{f}</span>
              </div>
            ))}
          </div>
        )}

        {/* Missing confirmations */}
        {missing.length > 0 && (
          <div className="space-y-0.5">
            {missing.map((m, i) => (
              <div key={i} className="flex items-start gap-1.5 text-[10px] text-amber-600">
                <span className="mt-0.5 shrink-0">⚠</span>
                <span className="leading-tight truncate">{m}</span>
              </div>
            ))}
          </div>
        )}

        {/* Reason */}
        {hasReason && (
          <p className="text-[10px] leading-snug text-slate-500 line-clamp-2">{rec.reason}</p>
        )}
      </div>
    )
  }

  function navForRec(rec: TradeCommandCenterRecommendation) {
    const eng = (rec.engine_type || '').toLowerCase()
    const strat = (rec.strategy || '').toLowerCase()
    if (eng === 'swing' || strat.includes('swing') || strat.includes('credit') || strat.includes('debit') || strat.includes('spread'))
      return `/swing-trade?ticker=${encodeURIComponent(rec.ticker)}`
    if (eng === 'day') return `/day-trade?ticker=${encodeURIComponent(rec.ticker)}`
    return getDetailsRoute(eng, rec.ticker)
  }

  // ── Sorted trade lists ────────────────────────────────────────────────────
  const sortedRecs = useMemo(() =>
    [...recommendations].sort((a, b) => {
      const vDiff = verdictRank(recVerdict(b)) - verdictRank(recVerdict(a))
      if (vDiff !== 0) return vDiff
      return ((b.display_confidence ?? 0) - (a.display_confidence ?? 0))
    }),
    [recommendations] // eslint-disable-line react-hooks/exhaustive-deps
  )

  // Top pick per engine (best verdict then confidence)
  const topByEngine = useMemo(() => {
    const result: Record<string, TradeCommandCenterRecommendation | undefined> = {}
    for (const rec of sortedRecs) {
      const eng = (rec.engine_type || '').toLowerCase()
      if (!result[eng]) result[eng] = rec
    }
    return result
  }, [sortedRecs])

  const readyNow = sortedRecs.filter(r => {
    const v = recVerdict(r)
    return v === 'STRONG_GO' || v === 'GO'
  })

  const highConfWatch = sortedRecs.filter(r => {
    const v = recVerdict(r)
    const conf = r.display_confidence ?? (typeof r.confidence === 'number' ? r.confidence : 0)
    return v === 'WATCH' && conf >= 65
  })

  const lowSignals = sortedRecs.filter(r => {
    const v = recVerdict(r)
    const conf = r.display_confidence ?? (typeof r.confidence === 'number' ? r.confidence : 0)
    return v === 'WAIT' || (v === 'WATCH' && conf < 65)
  })

  const noticeClass =
    actionNotice?.tone === 'success'
      ? 'border-emerald-700/40 bg-emerald-950/30 text-emerald-200'
      : actionNotice?.tone === 'warning'
        ? 'border-amber-700/40 bg-amber-950/30 text-amber-200'
        : 'border-sky-700/40 bg-sky-950/30 text-sky-200'

  return (
    <div className="mx-auto min-h-screen max-w-4xl space-y-5 px-4 pt-4 pb-28 md:px-6 md:pt-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-violet-600/20 border border-violet-700 flex items-center justify-center shrink-0">
            <Zap size={15} className="text-violet-400" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-bold tracking-tight text-white leading-tight">Trade Command Center</h1>
            <p className="text-[11px] text-slate-500 leading-tight">What to trade today</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="btn btn-outline h-8 w-8 rounded-lg shrink-0"
          aria-label="Refresh"
          title={loading ? 'Loading…' : 'Refresh'}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* ── Notice ── */}
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

      {/* ── Loading / Errors ── */}
      {loading && !env ? (
        <div className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-slate-900 px-4 py-6 text-sm text-slate-500">
          <RefreshCw size={16} className="animate-spin text-violet-400" />
          Loading…
        </div>
      ) : null}
      {fetchError ? <div className="rounded-xl border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-200">{fetchError}</div> : null}
      {env?.error ? <div className="rounded-xl border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-200">{(env.error as { message?: string }).message ?? 'Error'}</div> : null}

      {payload ? (
        <>
          {/* ── Market Pulse Strip ── */}
          <section className="rounded-xl border border-white/[0.08] bg-slate-900 px-3 py-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <span className="font-semibold text-slate-500">SPY</span>
              <span className={`font-bold ${String(market.spy_trend ?? '').toLowerCase().includes('bull') ? 'text-emerald-400' : String(market.spy_trend ?? '').toLowerCase().includes('bear') ? 'text-red-400' : 'text-slate-300'}`}>
                {String(market.spy_trend ?? '—').toUpperCase()}
              </span>
              <span className="text-slate-700">·</span>
              <span className="font-semibold text-slate-500">QQQ</span>
              <span className={`font-bold ${String(market.qqq_trend ?? '').toLowerCase().includes('bull') ? 'text-emerald-400' : String(market.qqq_trend ?? '').toLowerCase().includes('bear') ? 'text-red-400' : 'text-slate-300'}`}>
                {String(market.qqq_trend ?? '—').toUpperCase()}
              </span>
              <span className="text-slate-700">·</span>
              <span className="font-semibold text-slate-500">VIX</span>
              <span className={`font-bold ${String(market.vix_risk ?? '').toLowerCase().includes('high') ? 'text-red-400' : 'text-emerald-400'}`}>
                {String(market.vix_risk ?? '—').toUpperCase()}
              </span>
              <span className="text-slate-700">·</span>
              <span className="font-semibold text-slate-500">Regime</span>
              <span className="font-bold text-violet-400">{String(market.market_mode ?? '—').toUpperCase()}</span>
              <span className="text-slate-700">·</span>
              <span className="font-semibold text-slate-500">Best</span>
              <span className="font-bold text-slate-200">{String(market.best_style_today ?? '—')}</span>
              <span className="text-slate-700">·</span>
              <span className="font-semibold text-emerald-500">{readyNow.length} ready</span>
              <span className="font-semibold text-amber-500">{highConfWatch.length} watching</span>
              {env?.fetched_at ? (
                <span className="ml-auto font-mono text-[10px] text-slate-600 flex items-center gap-1">
                  <Clock size={9} />
                  {new Date(env.fetched_at).toLocaleTimeString()}
                </span>
              ) : null}
            </div>
          </section>

          {/* ── Today's Overall Verdict ── */}
          {payload.overall_decision && (() => {
            const od = payload.overall_decision as OverallDecision
            const v = String(od.verdict || '').toUpperCase().replace(/ /g, '_')
            const { label: vLabel, cls: vCls } = verdictBadge(v)
            const bannerBg =
              v === 'STRONG_GO' ? 'border-emerald-500/40 bg-emerald-950/20' :
              v === 'GO'        ? 'border-sky-500/30 bg-sky-950/15' :
              v === 'WATCH'     ? 'border-amber-500/30 bg-amber-950/15' :
                                   'border-slate-700/40 bg-slate-900/40'
            const reasonDot =
              v === 'STRONG_GO' ? 'bg-emerald-400' :
              v === 'GO'        ? 'bg-sky-400' :
              v === 'WATCH'     ? 'bg-amber-400' : 'bg-slate-500'

            return (
              <section className={`rounded-2xl border p-4 ${bannerBg}`}>
                <div className="flex flex-wrap items-center gap-3">
                  <span className={`rounded-lg px-3 py-1 text-sm font-black uppercase tracking-wide ${vCls}`}>{vLabel}</span>
                  <span className="text-sm font-semibold text-slate-200">{od.label}</span>
                  <span className="font-mono text-xs text-slate-500">{od.confidence}% conf.</span>
                  {od.engines_agreeing.length > 0 && (
                    <div className="flex items-center gap-1 ml-auto">
                      <span className="text-[10px] text-slate-600 uppercase tracking-wide">Aligned:</span>
                      {od.engines_agreeing.map(e => (
                        <span key={e} className={`rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase ${engineChip(e)}`}>{e}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="mt-2.5 flex items-start gap-2">
                  <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${reasonDot}`} />
                  <p className="text-xs leading-relaxed text-slate-400">{od.reason}</p>
                </div>
              </section>
            )
          })()}

          {/* ── Engine Overview: Best Pick Per Engine ── */}
          {(() => {
            const engineOrder = ['day', 'swing', 'regular'].filter(e => {
              if (e === 'day')   return canDay
              if (e === 'swing') return canSwing
              return true
            })
            if (engineOrder.length === 0) return null
            const gridCols = engineOrder.length === 3 ? 'grid-cols-3' : engineOrder.length === 2 ? 'grid-cols-2' : 'grid-cols-1'
            return (
              <div className={`grid gap-3 ${gridCols}`}>
                {engineOrder.map(engKey => {
                  const top = topByEngine[engKey]
                  const engData = engines.find(e => String(e.engine_type || '').toLowerCase() === engKey)
                  const label = engKey === 'day' ? 'Day Trade' : engKey === 'swing' ? 'Swing Trade' : 'Options'
                  const timeframe = engKey === 'day' ? 'Intraday' : engKey === 'swing' ? '5–21 days' : 'Multi-leg'
                  const chipCls = engineChip(engKey)
                  const engConf = summaryNumber(engData?.confidence) || 0

                  if (!top) {
                    return (
                      <div key={engKey} className={`rounded-xl border border-l-4 ${engineAccent(engKey)} border-l-slate-700 bg-slate-900 p-4`}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase ${chipCls}`}>{engKey.toUpperCase()}</span>
                          <span className="text-[10px] text-slate-600">{timeframe}</span>
                        </div>
                        <div className="text-sm font-semibold text-slate-600">No setup</div>
                        <div className="text-[10px] text-slate-700 mt-1">{label} has no actionable signals</div>
                      </div>
                    )
                  }

                  const v = recVerdict(top)
                  const { label: vLabel, cls: vCls } = verdictBadge(v)
                  const conf = top.display_confidence ?? (typeof top.confidence === 'number' ? top.confidence : 0)

                  return (
                    <button
                      key={engKey}
                      type="button"
                      onClick={() => navigate(navForRec(top))}
                      className={`rounded-xl border border-l-4 ${engineAccent(engKey)} ${borderAccent(v)} bg-slate-900 p-4 text-left transition-all hover:shadow-md hover:-translate-y-0.5`}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className={`rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase ${chipCls}`}>{engKey.toUpperCase()}</span>
                          <span className="text-[10px] text-slate-600">{timeframe}</span>
                        </div>
                        <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${vCls}`}>{vLabel}</span>
                      </div>
                      <div className="font-mono text-xl font-bold text-white mb-1">{top.ticker}</div>
                      <div className="text-[11px] text-slate-500 truncate mb-3">{top.strategy || top.direction || label}</div>
                      <div className="flex items-center justify-between">
                        <div className="text-[10px] text-slate-600 uppercase tracking-wide">Confidence</div>
                        <div className={`font-mono text-sm font-bold ${conf >= 70 ? 'text-emerald-400' : conf >= 50 ? 'text-amber-400' : 'text-slate-500'}`}>{conf}%</div>
                      </div>
                      <div className="mt-1.5 h-1 w-full rounded-full bg-slate-800">
                        <div
                          className={`h-full rounded-full transition-all ${conf >= 70 ? 'bg-emerald-500' : conf >= 50 ? 'bg-amber-500' : 'bg-slate-600'}`}
                          style={{ width: `${conf}%` }}
                        />
                      </div>
                      <SubIndicators rec={top} />
                    </button>
                  )
                })}
              </div>
            )
          })()}

          {/* ── Ready to Act: STRONG_GO + GO ── */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 border-b border-white/[0.06] pb-2">
              <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">Ready to Act</h2>
              <span className="ml-2 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-bold text-emerald-400">{readyNow.length}</span>
              <span className="text-[10px] text-slate-600 ml-1">Strong Go + Go · sorted by confidence</span>
            </div>

            {readyNow.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/[0.08] px-4 py-8 text-center text-sm text-slate-600">
                No strong setups right now — check Watch list below
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {readyNow.map(rec => {
                  const v = recVerdict(rec)
                  const { label: vLabel, cls: vCls } = verdictBadge(v)
                  const conf = rec.display_confidence ?? (typeof rec.confidence === 'number' ? rec.confidence : 0)
                  const eng = (rec.engine_type || '').toLowerCase()
                  const chgPct = rec.price_change_pct
                  const chgColor = chgPct != null ? (chgPct >= 0 ? 'text-emerald-400' : 'text-red-400') : 'text-slate-500'

                  return (
                    <button
                      key={rec.id}
                      type="button"
                      onClick={() => navigate(navForRec(rec))}
                      className={`rounded-xl border border-l-4 ${engineAccent(eng)} ${borderAccent(v)} bg-slate-900 p-3.5 text-left transition-all hover:shadow-md hover:-translate-y-0.5`}
                    >
                      {/* Header row */}
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-base font-bold text-white">{rec.ticker}</span>
                          <span className={`rounded border px-1 py-0.5 text-[9px] font-bold uppercase ${engineChip(eng)}`}>{eng.toUpperCase()}</span>
                        </div>
                        <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${vCls}`}>{vLabel}</span>
                      </div>

                      {/* Price + strategy */}
                      <div className="flex items-center gap-2 mb-2.5">
                        {chgPct != null && (
                          <span className={`text-xs font-bold font-mono ${chgColor}`}>
                            {chgPct >= 0 ? '▲' : '▼'} {Math.abs(chgPct).toFixed(1)}%
                          </span>
                        )}
                        {rec.last_price != null && (
                          <span className="font-mono text-[11px] text-slate-500">${rec.last_price.toFixed(2)}</span>
                        )}
                        <span className="text-[10px] text-slate-600 ml-auto truncate max-w-[100px]">{rec.strategy || rec.direction || ''}</span>
                      </div>

                      {/* Entry / Target / Stop */}
                      {(rec.entry_zone || rec.target || rec.stop_loss) && (
                        <>
                          <div className="border-t border-white/[0.06] mb-2" />
                          <div className="grid grid-cols-3 gap-1 text-[11px] mb-2">
                            <div>
                              <div className="text-slate-600 text-[9px] uppercase tracking-wide">Entry</div>
                              <div className="font-mono font-semibold text-slate-200">{rec.entry_zone || '—'}</div>
                            </div>
                            <div>
                              <div className="text-slate-600 text-[9px] uppercase tracking-wide">Target</div>
                              <div className="font-mono font-semibold text-emerald-400">{rec.target || '—'}</div>
                            </div>
                            <div>
                              <div className="text-slate-600 text-[9px] uppercase tracking-wide">Stop</div>
                              <div className="font-mono font-semibold text-red-400">{rec.stop_loss || '—'}</div>
                            </div>
                          </div>
                        </>
                      )}

                      {/* Confidence bar */}
                      <div className="flex items-center gap-2 mt-auto">
                        <div className="flex-1">
                          <div className="h-1 w-full rounded-full bg-slate-800">
                            <div
                              className={`h-full rounded-full ${conf >= 70 ? 'bg-emerald-500' : 'bg-sky-500'}`}
                              style={{ width: `${conf}%` }}
                            />
                          </div>
                        </div>
                        <span className={`font-mono text-xs font-bold ${conf >= 70 ? 'text-emerald-400' : 'text-sky-400'}`}>{conf}%</span>
                      </div>
                      <SubIndicators rec={rec} />
                    </button>
                  )
                })}
              </div>
            )}
          </section>

          {/* ── Watch: high-confidence WATCH setups ── */}
          {highConfWatch.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2 border-b border-white/[0.06] pb-2">
                <div className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                <h2 className="text-sm font-bold text-white uppercase tracking-wider">Watch — Entry Developing</h2>
                <span className="ml-2 rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[10px] font-bold text-amber-400">{highConfWatch.length}</span>
                <span className="text-[10px] text-slate-600 ml-1">≥ 65% confidence · not yet triggered</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {highConfWatch.map(rec => {
                  const conf = rec.display_confidence ?? (typeof rec.confidence === 'number' ? rec.confidence : 0)
                  const eng = (rec.engine_type || '').toLowerCase()
                  const chgPct = rec.price_change_pct
                  const chgColor = chgPct != null ? (chgPct >= 0 ? 'text-emerald-400' : 'text-red-400') : 'text-slate-500'
                  const missingStr = (rec.missing_confirmations || []).slice(0, 2).join(' · ')

                  return (
                    <button
                      key={rec.id}
                      type="button"
                      onClick={() => navigate(navForRec(rec))}
                      className={`rounded-xl border border-l-4 ${engineAccent(eng)} border-l-amber-500/60 bg-slate-900 p-3.5 text-left transition-all hover:shadow-md hover:-translate-y-0.5`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-base font-bold text-white">{rec.ticker}</span>
                          <span className={`rounded border px-1 py-0.5 text-[9px] font-bold uppercase ${engineChip(eng)}`}>{eng.toUpperCase()}</span>
                        </div>
                        <span className="rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-amber-400/15 text-amber-300 border border-amber-500/40">Watch</span>
                      </div>

                      <div className="flex items-center gap-2 mb-2">
                        {chgPct != null && (
                          <span className={`text-xs font-bold font-mono ${chgColor}`}>
                            {chgPct >= 0 ? '▲' : '▼'} {Math.abs(chgPct).toFixed(1)}%
                          </span>
                        )}
                        {rec.last_price != null && (
                          <span className="font-mono text-[11px] text-slate-500">${rec.last_price.toFixed(2)}</span>
                        )}
                        <span className="text-[10px] text-slate-600 ml-auto truncate max-w-[100px]">{rec.strategy || rec.direction || ''}</span>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <div className="h-1 w-full rounded-full bg-slate-800">
                            <div className="h-full rounded-full bg-amber-500/60" style={{ width: `${conf}%` }} />
                          </div>
                        </div>
                        <span className="font-mono text-xs font-bold text-amber-400">{conf}%</span>
                      </div>
                      <SubIndicators rec={rec} />
                    </button>
                  )
                })}
              </div>
            </section>
          )}

          {/* ── Monitoring: lower signals (collapsed) ── */}
          {lowSignals.length > 0 && (
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl border border-white/[0.07] bg-slate-900 px-4 py-2.5 text-xs text-slate-500 select-none hover:bg-slate-800/50 transition-colors">
                <div className="h-2 w-2 rounded-full bg-slate-600" />
                <span className="font-semibold text-slate-400">Monitoring — {lowSignals.length} lower signals</span>
                <span className="text-slate-600 ml-1">Wait + lower-confidence Watch</span>
                <ChevronDown size={12} className="ml-auto text-slate-600 group-open:rotate-180 transition-transform" />
              </summary>
              <div className="flex flex-wrap gap-2 rounded-b-xl border border-t-0 border-white/[0.07] bg-slate-900 px-4 py-3">
                {lowSignals.map(rec => {
                  const v = recVerdict(rec)
                  const { label: vLabel, cls: vCls } = verdictBadge(v)
                  const eng = (rec.engine_type || '').toLowerCase()
                  return (
                    <button
                      key={rec.id}
                      type="button"
                      onClick={() => navigate(navForRec(rec))}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] px-2.5 py-1.5 text-xs hover:bg-slate-800/40 transition-colors"
                    >
                      <span className="font-mono font-bold text-slate-300">{rec.ticker}</span>
                      <span className={`rounded border px-1 py-0.5 text-[9px] font-bold uppercase ${engineChip(eng)}`}>{eng.toUpperCase()}</span>
                      <span className={`rounded px-1 py-0.5 text-[9px] font-bold uppercase ${vCls}`}>{vLabel}</span>
                    </button>
                  )
                })}
              </div>
            </details>
          )}

        </>
      ) : null}
    </div>
  )
}
