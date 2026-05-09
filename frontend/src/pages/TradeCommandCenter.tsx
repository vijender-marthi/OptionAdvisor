import axios from 'axios'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BellRing,
  BriefcaseBusiness,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { fetchMarketPosition, fetchTradeCommandCenter } from '../api/commandCenter'
import type { MarketPositionData } from '../api/commandCenter'
import { useApp } from '../contexts/AppContext'
import { ROUTES } from '../routing/routes'
import type {
  ApiEnvelope,
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
  if (tone === 'bullish') return 'border-emerald-600/35 bg-emerald-500/10 text-emerald-200'
  if (tone === 'bearish') return 'border-rose-600/35 bg-rose-500/10 text-rose-200'
  if (tone === 'warning') return 'border-amber-600/35 bg-amber-500/10 text-amber-200'
  return 'border-sky-700/35 bg-sky-500/10 text-sky-200'
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

function ConfidenceMeter({ value }: { value: number }) {
  const safe = Math.max(0, Math.min(100, value))
  const tone = safe >= 70 ? 'bg-emerald-400' : safe >= 45 ? 'bg-amber-400' : 'bg-rose-400'
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-gray-500">
        <span>Confidence</span>
        <span className="font-semibold text-gray-300">{safe}%</span>
      </div>
      <div className="h-2 rounded-full bg-gray-800">
        <div className={`h-2 rounded-full ${tone}`} style={{ width: `${safe}%` }} />
      </div>
    </div>
  )
}

function routeForEngine(engineType: string): { href: string; label: string } {
  const key = engineType.trim().toLowerCase()
  if (key === 'day') return { href: ROUTES.dayTrade, label: 'View Day Details' }
  if (key === 'swing') return { href: ROUTES.swingWatchlist, label: 'View Swing Watchlist' }
  return { href: ROUTES.regularTrade, label: 'View Regular Details' }
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
      summary: `${ticker} has conflicting signals across engines.`,
      resolution: 'Timeframe or options pricing is creating a disagreement.',
      suggested_action: 'Prefer smaller size or wait for cleaner agreement before acting.',
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
}: {
  label: string
  value: string
  tone: 'bullish' | 'bearish' | 'neutral' | 'warning'
}) {
  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/90 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
          <div className="mt-2 text-sm font-semibold text-gray-100">{value || '—'}</div>
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${badgeClass(tone)}`}>
          {tone}
        </span>
      </div>
    </div>
  )
}

function ChartShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/90 p-4">
      <div className="mb-3">
        <div className="text-sm font-semibold text-gray-100">{title}</div>
        <div className="text-xs text-gray-500">{subtitle}</div>
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
      <div className="mt-4 flex items-center gap-2 border-t border-gray-800/70 pt-4 text-xs text-gray-600">
        <RefreshCw size={11} className="animate-spin" /> Loading market position…
      </div>
    )
  }
  if (mpError || !mpData) {
    return <div className="mt-4 border-t border-gray-800/70 pt-4 text-xs text-gray-600">Market position unavailable</div>
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
    <div className="mt-4 border-t border-gray-800/70 pt-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
          <TrendingUp size={11} className="text-violet-400" aria-hidden />
          Portfolio Reserve Signal
        </div>
        <div className="flex items-center gap-1.5 text-xs font-mono">
          <span className="text-gray-500">SPY</span>
          <span className="font-bold text-gray-100">${mpData.spy_price.toFixed(2)}</span>
          <span className="text-[10px] text-gray-700">|</span>
          <span className="text-[10px] text-gray-600">200-MA ${mpData.ma200.toFixed(0)}</span>
        </div>
      </div>

      <div className="mb-3 space-y-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="w-24 shrink-0 font-medium text-gray-500">vs 200-day MA</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-800">
            <div className={`h-full rounded-full ${maBarColor}`} style={{ width: `${maBarPct}%` }} />
          </div>
          <span className="w-14 text-right font-mono text-xs font-semibold text-sky-300">
            {mpData.dist_200ma_pct >= 0 ? '+' : ''}{mpData.dist_200ma_pct.toFixed(1)}%
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="w-24 shrink-0 font-medium text-gray-500">Off 52w High</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-800">
            <div className={`h-full rounded-full ${ddBarColor}`} style={{ width: `${ddBarPct}%` }} />
          </div>
          <span className="w-14 text-right font-mono text-xs font-semibold text-emerald-300">
            -{mpData.drawdown_pct.toFixed(1)}%
          </span>
        </div>
      </div>

      <div className={`flex items-center gap-2 rounded-lg px-3 py-2 ${signalCls}`}>
        <span className={`h-2 w-2 flex-none rounded-full ${dotCls}`} aria-hidden />
        <span className="flex-1 text-xs font-semibold leading-snug">{mpData.signal_label}</span>
        <span className="whitespace-nowrap font-mono text-[10px] text-gray-600">25% reserve rule</span>
      </div>
    </div>
  )
}

export default function TradeCommandCenter() {
  const navigate = useNavigate()
  const { addToWatchlist, isWatched, requestAnalysis } = useApp()
  const [env, setEnv] = useState<ApiEnvelope<TradeCommandCenterPayload> | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [engine, setEngine] = useState('')
  const [signal, setSignal] = useState('')
  const [direction, setDirection] = useState('')
  const [risk, setRisk] = useState('')
  const [showAllRecommendations, setShowAllRecommendations] = useState(false)
  const [expandedOpportunityId, setExpandedOpportunityId] = useState<string | null>(null)
  const [actionNotice, setActionNotice] = useState<{ tone: 'success' | 'warning' | 'info'; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setFetchError(null)
    try {
      const nextEnv = await fetchTradeCommandCenter({
        engine: engine || undefined,
        signal: signal || undefined,
        direction: direction || undefined,
        risk: risk || undefined,
      })
      setEnv(nextEnv)
    } catch (err) {
      setEnv(null)
      setFetchError(axiosErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [direction, engine, risk, signal])

  useEffect(() => {
    void load()
  }, [load])

  const payload = env?.data ?? null
  const market = payload?.market_summary ?? {}
  const engines = payload?.engines ?? []
  const recommendations = payload?.recommendations ?? []
  const conflicts = payload?.conflicts && payload.conflicts.length > 0 ? payload.conflicts : buildFallbackConflicts(recommendations)
  const alertsSummary = payload?.alerts_summary ?? {
    active_alerts: 0,
    critical_alerts: 0,
    positions_requiring_exit: 0,
    near_expiry_trades: 0,
    high_iv_warnings: 0,
  }
  const recentActivity = payload?.recent_activity ?? []
  const charts = useMemo(() => (payload ? { ...buildFallbackCharts(payload), ...(payload.charts ?? {}) } : null), [payload])

  const actionable = useMemo(() => recommendations.filter(isActionable), [recommendations])
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
    setNotice('info', `Opened ${rec.ticker} details. Direct add-to-positions from Trade Command Center is not wired yet, so use the ticker advisor flow to confirm and add the trade.`)
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
    <div className="trade-command-center-page oa-cc-page mx-auto min-h-screen max-w-7xl space-y-6 px-4 py-6 pb-28 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-white">Trade Command Center</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-500">
            One decision dashboard for market regime, engine trust, actionable setups, conflicts, alerts, and recent activity.
            {env?.stale ? <span className="text-amber-400"> Live market summary unavailable, using cached defaults.</span> : null}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="btn btn-outline h-10 w-10 rounded-xl"
          aria-label="Refresh command center data"
          title={loading ? 'Loading…' : 'Refresh'}
        >
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {actionNotice ? (
        <div className={`rounded-xl border px-4 py-3 text-sm ${noticeClass}`}>
          <div className="flex items-start justify-between gap-3">
            <span>{actionNotice.text}</span>
            <button type="button" className="text-xs font-semibold opacity-80 hover:opacity-100" onClick={() => setActionNotice(null)}>
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {loading && !env ? (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-6 text-sm text-muted">
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
          <section className="rounded-3xl border border-gray-800 bg-gray-950/90 p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <TrendingUp size={18} className="text-violet-400" />
              <h2 className="text-lg font-semibold text-white">Market Command Summary</h2>
            </div>
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              <SummaryCard label="Market Mode" value={String(market.market_mode ?? '—')} tone={toneFromText(String(market.market_mode ?? ''))} />
              <SummaryCard label="Best Style Today" value={String(market.best_style_today ?? '—')} tone={toneFromText(String(market.best_style_today ?? ''))} />
              <SummaryCard label="SPY Trend" value={String(market.spy_trend ?? '—')} tone={toneFromText(String(market.spy_trend ?? ''))} />
              <SummaryCard label="QQQ Trend" value={String(market.qqq_trend ?? '—')} tone={toneFromText(String(market.qqq_trend ?? ''))} />
              <SummaryCard label="VIX Risk" value={String(market.vix_risk ?? '—')} tone={toneFromText(String(market.vix_risk ?? ''))} />
              <SummaryCard label="Overall Risk" value={String(market.risk_status ?? '—')} tone={toneFromText(String(market.risk_status ?? ''))} />
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-[1.45fr_0.9fr]">
              <div className="rounded-2xl border border-gray-800 bg-gray-900/80 p-4">
                <div className="text-[11px] uppercase tracking-wide text-gray-500">AI Coach Summary</div>
                <p className="mt-2 text-sm leading-relaxed text-gray-200">{String(market.ai_coach_summary ?? 'No coach message yet.')}</p>
                <div className="mt-4">
                  <ConfidenceMeter value={confidenceScore} />
                </div>
              </div>
              <div className="rounded-2xl border border-gray-800 bg-gray-900/80 p-4">
                <MarketPositionWidget />
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <BarChart3 size={18} className="text-violet-400" />
              <h2 className="text-lg font-semibold text-white">Engine Health / Engine Bias</h2>
            </div>
            <div className="grid gap-4 xl:grid-cols-3">
              {engines.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-900/40 px-4 py-8 text-center text-sm text-gray-500">
                  No engine snapshots from API yet.
                </div>
              ) : (
                engines.map((card: TradeCommandCenterEngine) => {
                  const route = routeForEngine(String(card.engine_type || ''))
                  const topTicker = String(card.top_recommendation?.ticker || '').toUpperCase()
                  return (
                    <div key={`${card.engine_type}-${topTicker}`} className="rounded-2xl border border-gray-800 bg-gray-900/90 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-lg font-semibold text-white">{String(card.engine_type || '').toUpperCase()}</div>
                          <div className="text-xs text-gray-500">{card.timeframe || '—'}</div>
                        </div>
                        <SignalBadge signal={String(card.final_decision || card.signal || '—')} />
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                        <div className="rounded-xl border border-gray-800 bg-gray-950/60 px-3 py-2">
                          <div className="text-[11px] uppercase tracking-wide text-gray-500">Market Bias</div>
                          <div className="mt-1 text-gray-100">{card.market_bias || '—'}</div>
                        </div>
                        <div className="rounded-xl border border-gray-800 bg-gray-950/60 px-3 py-2">
                          <div className="text-[11px] uppercase tracking-wide text-gray-500">Readiness</div>
                          <div className="mt-1"><SignalBadge signal={String(card.execution_readiness || '—')} /></div>
                        </div>
                        <div className="rounded-xl border border-gray-800 bg-gray-950/60 px-3 py-2">
                          <div className="text-[11px] uppercase tracking-wide text-gray-500">Risk</div>
                          <div className="mt-1"><RiskBadge risk={String(card.risk_level || 'Unknown')} /></div>
                        </div>
                        <div className="rounded-xl border border-gray-800 bg-gray-950/60 px-3 py-2">
                          <div className="text-[11px] uppercase tracking-wide text-gray-500">Signal Count</div>
                          <div className="mt-1 text-lg font-semibold text-gray-100">{summaryNumber(card.signal_count)}</div>
                        </div>
                        <div className="rounded-xl border border-gray-800 bg-gray-950/60 px-3 py-2">
                          <div className="text-[11px] uppercase tracking-wide text-gray-500">Top Ticker</div>
                          <div className="mt-1 font-semibold text-violet-300">{topTicker || '—'}</div>
                        </div>
                        <div className="rounded-xl border border-gray-800 bg-gray-950/60 px-3 py-2">
                          <div className="text-[11px] uppercase tracking-wide text-gray-500">Best Use Case</div>
                          <div className="mt-1 text-gray-200">{card.best_use_case || '—'}</div>
                        </div>
                      </div>
                      <p className="mt-4 text-sm leading-relaxed text-gray-300">{card.reason || card.summary || card.top_recommendation?.reason || 'No engine summary yet.'}</p>
                      {card.missing_confirmations.length > 0 ? (
                        <p className="mt-2 text-xs text-amber-200/90">Waiting on: {card.missing_confirmations.join(' · ')}</p>
                      ) : null}
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => navigate(route.href)}
                          className="btn btn-primary gap-2 rounded-lg px-3 py-2 text-sm"
                        >
                          {route.label}
                          <ArrowRight size={14} />
                        </button>
                        {topTicker ? (
                          <button
                            type="button"
                            onClick={() => requestAnalysis(topTicker)}
                            className="btn btn-outline gap-2 rounded-lg px-3 py-2 text-sm"
                          >
                            View {topTicker}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <BriefcaseBusiness size={18} className="text-violet-400" />
                <h2 className="text-lg font-semibold text-white">Actionable Trade Opportunities</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowAllRecommendations(prev => !prev)}
                className="btn btn-outline gap-2 rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-wide"
              >
                {showAllRecommendations ? 'Hide full table' : 'Show all recommendations'}
              </button>
            </div>

            <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-gray-800 bg-gray-900/90 p-4">
              <label className="text-xs text-muted">
                Engine Type
                <select value={engine} onChange={e => setEngine(e.target.value)} className="mt-1 block w-36 rounded-lg border border-border bg-surface-elevated px-2 py-1.5 text-sm text-primary">
                  <option value="">All</option>
                  <option value="day">Day</option>
                  <option value="swing">Swing</option>
                  <option value="regular">Regular</option>
                </select>
              </label>
              <label className="text-xs text-muted">
                Signal
                <select value={signal} onChange={e => setSignal(e.target.value)} className="mt-1 block w-36 rounded-lg border border-border bg-surface-elevated px-2 py-1.5 text-sm text-primary">
                  <option value="">All</option>
                  <option value="READY">READY</option>
                  <option value="WATCH">WATCH</option>
                  <option value="WAIT">WAIT</option>
                  <option value="AVOID">AVOID</option>
                  <option value="NO_EDGE">NO_EDGE</option>
                </select>
              </label>
              <label className="text-xs text-muted">
                Direction
                <select value={direction} onChange={e => setDirection(e.target.value)} className="mt-1 block w-36 rounded-lg border border-border bg-surface-elevated px-2 py-1.5 text-sm text-primary">
                  <option value="">All</option>
                  <option value="call">Call</option>
                  <option value="put">Put</option>
                  <option value="spread">Spread</option>
                  <option value="stock">Stock</option>
                </select>
              </label>
              <label className="text-xs text-muted">
                Risk
                <select value={risk} onChange={e => setRisk(e.target.value)} className="mt-1 block w-32 rounded-lg border border-border bg-surface-elevated px-2 py-1.5 text-sm text-primary">
                  <option value="">All</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.6fr_0.8fr]">
              <div className="grid gap-4 lg:grid-cols-2">
                {actionable.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-900/40 px-4 py-8 text-center text-sm text-gray-500">
                    No actionable opportunities for the current filters.
                  </div>
                ) : (
                  actionable.map(rec => {
                    const expanded = expandedOpportunityId === rec.id
                    return (
                      <div key={rec.id} className="rounded-2xl border border-gray-800 bg-gray-900/90 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-base font-bold text-gray-100">{rec.ticker}</span>
                              <EngineBadge engine={rec.engine_type} />
                              <SignalBadge signal={rec.final_decision || rec.signal} />
                              <RiskBadge risk={String(rec.risk_level || 'Unknown')} />
                            </div>
                            <div className="mt-2 text-sm font-semibold text-violet-200">{rec.strategy}</div>
                            <div className="text-xs text-gray-500">{rec.direction} · Expiry {rec.expiry || '—'}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-[11px] uppercase tracking-wide text-gray-500">Confidence</div>
                            <div className="text-sm font-semibold text-gray-100">{String(rec.confidence || '—')}</div>
                          </div>
                        </div>

                        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                          <div className="rounded-xl border border-gray-800 bg-gray-950/60 px-3 py-2">
                            <div className="text-[11px] uppercase tracking-wide text-gray-500">Market Bias</div>
                            <div className="mt-1 text-gray-100">{rec.market_bias || '—'}</div>
                          </div>
                          <div className="rounded-xl border border-gray-800 bg-gray-950/60 px-3 py-2">
                            <div className="text-[11px] uppercase tracking-wide text-gray-500">Readiness</div>
                            <div className="mt-1"><SignalBadge signal={String(rec.execution_readiness || rec.final_decision || '—')} /></div>
                          </div>
                        </div>

                        <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                          <div className="rounded-xl border border-gray-800 bg-gray-950/60 px-3 py-2">
                            <div className="text-[11px] uppercase tracking-wide text-gray-500">Entry</div>
                            <div className="mt-1 text-gray-100">{rec.entry_zone || '—'}</div>
                          </div>
                          <div className="rounded-xl border border-gray-800 bg-gray-950/60 px-3 py-2">
                            <div className="text-[11px] uppercase tracking-wide text-gray-500">Target</div>
                            <div className="mt-1 text-gray-100">{rec.target || '—'}</div>
                          </div>
                          <div className="rounded-xl border border-gray-800 bg-gray-950/60 px-3 py-2">
                            <div className="text-[11px] uppercase tracking-wide text-gray-500">Stop</div>
                            <div className="mt-1 text-gray-100">{rec.stop_loss || '—'}</div>
                          </div>
                        </div>

                        <p className={`mt-4 text-sm leading-relaxed text-gray-300 ${expanded ? '' : 'line-clamp-2'}`}>{rec.reason || 'No reason from API.'}</p>
                        <p className={`mt-2 text-sm leading-relaxed text-violet-200/90 ${expanded ? '' : 'line-clamp-2'}`}>
                          Recommended action: {rec.recommended_action || rec.action_label || 'Review details before acting.'}
                        </p>
                        {rec.missing_confirmations && rec.missing_confirmations.length > 0 ? (
                          <p className={`mt-2 text-xs text-amber-200/90 ${expanded ? '' : 'line-clamp-1'}`}>
                            Waiting on: {rec.missing_confirmations.join(' · ')}
                          </p>
                        ) : null}

                        <div className="mt-4 flex flex-wrap gap-2">
                          <button type="button" className="btn btn-outline gap-2 rounded-lg px-2.5 py-1.5 text-xs" onClick={() => handleAddToWatchlist(rec.ticker)}>
                            Add to Watchlist
                          </button>
                          <button type="button" className="btn btn-primary gap-2 rounded-lg px-2.5 py-1.5 text-xs" onClick={() => handleAddToPositions(rec)}>
                            Add to Positions
                          </button>
                          <button type="button" className="btn btn-warning gap-2 rounded-lg px-2.5 py-1.5 text-xs" onClick={() => handleCreateAlert(rec.ticker)}>
                            Create Alert
                          </button>
                          <button type="button" className="btn btn-outline gap-2 rounded-lg px-2.5 py-1.5 text-xs" onClick={() => requestAnalysis(rec.ticker)}>
                            View Details
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline gap-1 rounded-lg px-2 py-1 text-xs"
                            onClick={() => setExpandedOpportunityId(expanded ? null : rec.id)}
                          >
                            {expanded ? (
                              <span className="inline-flex items-center gap-1"><ChevronUp size={14} /> Less</span>
                            ) : (
                              <span className="inline-flex items-center gap-1"><ChevronDown size={14} /> More</span>
                            )}
                          </button>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              <div className="rounded-2xl border border-gray-800 bg-gray-900/90 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <AlertTriangle size={16} className="text-amber-300" />
                  <h3 className="text-sm font-semibold text-white">Avoid Right Now</h3>
                </div>
                <div className="space-y-3">
                  {avoids.length === 0 ? (
                    <div className="text-sm text-gray-500">No avoid list items under the current filters.</div>
                  ) : (
                    avoids.map(rec => (
                      <div key={`avoid-${rec.id}`} className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono font-semibold text-gray-100">{rec.ticker}</span>
                          <EngineBadge engine={rec.engine_type} />
                          <SignalBadge signal={rec.final_decision || rec.signal} />
                        </div>
                        <div className="mt-2 text-sm text-gray-300">{rec.reason || 'No reason from API.'}</div>
                        <div className="mt-2 text-xs text-amber-200">Action: {rec.recommended_action || rec.action_label || 'Avoid for now.'}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {showAllRecommendations ? (
              <div className="overflow-x-auto rounded-2xl border border-gray-800 bg-gray-900/90">
                <table className="min-w-[1080px] w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800 text-left text-[11px] uppercase tracking-wide text-gray-500">
                      <th className="px-3 py-2">Ticker</th>
                      <th className="px-3 py-2">Engine</th>
                      <th className="px-3 py-2">Signal</th>
                      <th className="px-3 py-2">Direction</th>
                      <th className="px-3 py-2">Strategy</th>
                      <th className="px-3 py-2">Entry</th>
                      <th className="px-3 py-2">Target</th>
                      <th className="px-3 py-2">Stop</th>
                      <th className="px-3 py-2">Expiry</th>
                      <th className="px-3 py-2">Risk</th>
                      <th className="px-3 py-2">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recommendations.map(rec => (
                      <tr key={`table-${rec.id}`} className="border-b border-gray-800/70 align-top">
                        <td className="px-3 py-3 font-semibold text-gray-100">{rec.ticker}</td>
                        <td className="px-3 py-3"><EngineBadge engine={rec.engine_type} /></td>
                        <td className="px-3 py-3"><SignalBadge signal={rec.final_decision || rec.signal} /></td>
                        <td className="px-3 py-3 text-gray-300">{rec.direction || '—'}</td>
                        <td className="px-3 py-3 text-gray-300">{rec.strategy || '—'}</td>
                        <td className="px-3 py-3 text-gray-300">{rec.entry_zone || '—'}</td>
                        <td className="px-3 py-3 text-gray-300">{rec.target || '—'}</td>
                        <td className="px-3 py-3 text-gray-300">{rec.stop_loss || '—'}</td>
                        <td className="px-3 py-3 text-gray-300">{rec.expiry || '—'}</td>
                        <td className="px-3 py-3"><RiskBadge risk={String(rec.risk_level || 'Unknown')} /></td>
                        <td className="max-w-sm px-3 py-3 text-gray-500">{rec.reason || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>

          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <ShieldAlert size={18} className="text-violet-400" />
              <h2 className="text-lg font-semibold text-white">Engine Conflict Panel</h2>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              {conflicts.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-900/40 px-4 py-8 text-center text-sm text-gray-500">
                  No engine conflicts reported right now.
                </div>
              ) : (
                conflicts.map(conflict => (
                  <div key={conflict.id} className="rounded-2xl border border-gray-800 bg-gray-900/90 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-base font-bold text-gray-100">{conflict.ticker}</span>
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${badgeClass(toneFromText(conflict.state))}`}>
                            {conflict.state.replace(/_/g, ' ')}
                          </span>
                        </div>
                        <div className="mt-2 text-sm text-gray-300">{conflict.summary}</div>
                      </div>
                    </div>
                    <div className="mt-4 space-y-2 text-sm">
                      {conflict.signals.map(row => (
                        <div key={`${conflict.id}-${row.engine_type}`} className="rounded-xl border border-gray-800 bg-gray-950/60 px-3 py-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <EngineBadge engine={row.engine_type} />
                            <SignalBadge signal={row.signal} />
                          </div>
                          {row.note ? <div className="mt-2 text-gray-400">{row.note}</div> : null}
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 rounded-xl border border-amber-700/25 bg-amber-500/5 p-3">
                      <div className="text-[11px] uppercase tracking-wide text-amber-200/80">Resolution</div>
                      <div className="mt-1 text-sm text-gray-200">{conflict.resolution}</div>
                      <div className="mt-2 text-sm text-amber-200">Suggested action: {conflict.suggested_action}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <BarChart3 size={18} className="text-violet-400" />
              <h2 className="text-lg font-semibold text-white">Market Graphs / Trend Visuals</h2>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              <ChartShell title="SPY vs QQQ Trend Strength" subtitle="Lightweight trend conviction view from the command-center payload.">
                <div className="h-60">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={charts?.trend_strength ?? []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                      <XAxis dataKey="label" stroke="#6b7280" />
                      <YAxis stroke="#6b7280" domain={[0, 100]} />
                      <Tooltip />
                      <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                        {(charts?.trend_strength ?? []).map((entry, index) => (
                          <Cell key={`${entry.label}-${index}`} fill={toneFromText(String(entry.tone ?? 'neutral')) === 'bullish' ? '#34d399' : '#60a5fa'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </ChartShell>

              <ChartShell title="Engine Signal Distribution" subtitle="How each engine is leaning right now.">
                <div className="h-60">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={charts?.engine_signal_distribution ?? []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                      <XAxis dataKey="engine" stroke="#6b7280" />
                      <YAxis stroke="#6b7280" />
                      <Tooltip />
                      <Bar dataKey="READY" stackId="a" fill="#34d399" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="WATCH" stackId="a" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="WAIT" stackId="a" fill="#fbbf24" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="AVOID" stackId="a" fill="#ef4444" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="NO_EDGE" stackId="a" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </ChartShell>

              <ChartShell title="Risk Distribution" subtitle="Current opportunity mix by risk tier.">
                <div className="h-60">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={charts?.risk_distribution ?? []}
                        dataKey="value"
                        nameKey="label"
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={82}
                        paddingAngle={3}
                      >
                        {(charts?.risk_distribution ?? []).map((entry, index) => {
                          const label = String(entry.label || '').toLowerCase()
                          const fill = label === 'low' ? '#34d399' : label === 'medium' ? '#f59e0b' : '#ef4444'
                          return <Cell key={`${entry.label}-${index}`} fill={fill} />
                        })}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </ChartShell>

              <ChartShell title="Best Style Allocation" subtitle="How today’s tape is pushing your focus across trade styles.">
                <div className="space-y-4 pt-2">
                  {(charts?.style_allocation ?? []).map(entry => (
                    <div key={entry.label} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-300">{entry.label}</span>
                        <span className="font-semibold text-gray-100">{entry.value}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-gray-800">
                        <div className="h-2 rounded-full bg-violet-400" style={{ width: `${Math.max(0, Math.min(100, entry.value))}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </ChartShell>
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
            <div className="rounded-2xl border border-gray-800 bg-gray-900/90 p-4">
              <div className="mb-4 flex items-center gap-2">
                <BellRing size={18} className="text-violet-400" />
                <h2 className="text-lg font-semibold text-white">Risk &amp; Alert Snapshot</h2>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  ['Active alerts', alertsSummary.active_alerts],
                  ['Critical alerts', alertsSummary.critical_alerts],
                  ['Positions requiring exit', alertsSummary.positions_requiring_exit],
                  ['Near expiry trades', alertsSummary.near_expiry_trades],
                  ['High IV warnings', alertsSummary.high_iv_warnings],
                ].map(([label, raw]) => (
                  <div key={label} className="rounded-xl border border-gray-800 bg-gray-950/60 px-3 py-3">
                    <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
                    <div className="mt-1 text-2xl font-semibold text-gray-100">{summaryNumber(raw)}</div>
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

            <div className="rounded-2xl border border-gray-800 bg-gray-900/90 p-4">
              <div className="mb-4 flex items-center gap-2">
                <RefreshCw size={18} className="text-violet-400" />
                <h2 className="text-lg font-semibold text-white">Recent Decisions / Activity</h2>
              </div>
              <div className="space-y-3">
                {recentActivity.length === 0 ? (
                  <div className="text-sm text-gray-500">No recent activity from the API yet.</div>
                ) : (
                  recentActivity.map((item: TradeCommandCenterActivity) => (
                    <div key={item.id} className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-semibold text-gray-100">{item.ticker}</span>
                        <EngineBadge engine={item.engine_type} />
                        <SignalBadge signal={item.signal} />
                      </div>
                      <div className="mt-2 text-sm text-gray-300">
                        {item.action_taken ? `${item.action_taken} · ` : ''}
                        {item.message || 'Decision update'}
                      </div>
                      <div className="mt-2 text-[11px] text-gray-500">{fmtTimestamp(item.timestamp)}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        </>
      ) : null}
    </div>
  )
}
