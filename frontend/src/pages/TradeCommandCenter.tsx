import axios from 'axios'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ChevronDown,
  RefreshCw,
  Zap,
  TrendingUp,
  Clock,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { fetchMarketPosition, fetchTradeCommandCenter } from '../api/commandCenter'
import type { MarketPositionData } from '../api/commandCenter'
import { useApp } from '../contexts/AppContext'
import { getDetailsRoute } from '../routing/routes'
import type {
  ApiEnvelope,
  OverallDecision,
  TradeCommandCenterPayload,
  TccRec,
} from '../types/commandCenter'

// ── Error formatting ──────────────────────────────────────────────────────────
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

// ── Display formatting ────────────────────────────────────────────────────────
function fmtTimestamp(value?: string): string {
  if (!value) return '—'
  const ts = Date.parse(value)
  if (!Number.isFinite(ts)) return '—'
  return new Date(ts).toLocaleString()
}

// ── Pure CSS class helpers ────────────────────────────────────────────────────
function verdictBadgeClass(tone: string): string {
  if (tone === 'bullish') return 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
  if (tone === 'warning') return 'bg-amber-400/15 text-amber-300 border border-amber-500/40'
  if (tone === 'bearish') return 'bg-rose-500/15 text-rose-300 border border-rose-600/40'
  return 'bg-slate-700/60 text-slate-400 border border-slate-600/40'
}

function borderAccentClass(tone: string): string {
  if (tone === 'bullish') return 'border-l-emerald-500'
  if (tone === 'warning') return 'border-l-amber-400'
  if (tone === 'bearish') return 'border-l-rose-500'
  return 'border-l-slate-600'
}

function subIndicatorClass(tone: string): string {
  if (tone === 'bullish') return 'text-emerald-400'
  if (tone === 'bearish') return 'text-rose-400'
  if (tone === 'warning') return 'text-amber-400'
  return 'text-slate-400'
}

function engineChipClass(eng: string): string {
  if (eng === 'day')   return 'border-orange-500/30 text-orange-400 bg-orange-950/20'
  if (eng === 'swing') return 'border-violet-500/30 text-violet-400 bg-violet-950/20'
  return                      'border-teal-500/30 text-teal-400 bg-teal-950/20'
}

function engineBorderClass(eng: string): string {
  if (eng === 'day')   return 'border-orange-500/20 hover:border-orange-500/40'
  if (eng === 'swing') return 'border-violet-500/20 hover:border-violet-500/40'
  return                      'border-teal-500/20 hover:border-teal-500/40'
}

// ── Navigation (UI concern — uses pre-computed detail_route_key) ──────────────
function navForRec(rec: TccRec): string {
  const key = rec.detail_route_key  // 'day' | 'swing' | 'regular' — set by backend
  return getDetailsRoute(key, rec.ticker)
}

// ── Sub-indicators (pure render) ─────────────────────────────────────────────
function SubIndicators({ indicators }: { indicators: TccRec['sub_indicators'] }) {
  if (!indicators || indicators.length === 0) return null
  return (
    <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 border-t border-white/[0.06] pt-2.5">
      {indicators.map((ind, i) => (
        <div key={i} className="flex items-center gap-1 min-w-0">
          <span className="text-[9px] uppercase tracking-wide text-slate-600 shrink-0">{ind.label}</span>
          <span className={`text-[10px] font-semibold uppercase truncate ${subIndicatorClass(ind.tone)}`}>{ind.value}</span>
        </div>
      ))}
    </div>
  )
}

// ── Market Position Widget ────────────────────────────────────────────────────
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

// ── Main component ────────────────────────────────────────────────────────────
export default function TradeCommandCenter() {
  const navigate = useNavigate()
  const { canAccessPage } = useApp()
  const canDay   = canAccessPage('day-trade')
  const canSwing = canAccessPage('swing-trade')
  const [env, setEnv] = useState<ApiEnvelope<TradeCommandCenterPayload> | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [actionNotice, setActionNotice] = useState<{ tone: 'success' | 'warning' | 'info'; text: string } | null>(null)

  // Stale-load guard: React StrictMode double-fires effects in dev; without this the page
  // makes two identical backend calls on mount. The counter lets us discard the response
  // from any load that was superseded by a newer one before it completed.
  const loadSeqRef = useRef(0)

  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current
    setLoading(true)
    setFetchError(null)
    try {
      const nextEnv = await fetchTradeCommandCenter({})
      if (seq !== loadSeqRef.current) return   // stale — a newer load already fired
      setEnv(nextEnv)
    } catch (err) {
      if (seq !== loadSeqRef.current) return
      setEnv(null)
      setFetchError(axiosErrorMessage(err))
    } finally {
      if (seq === loadSeqRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const payload = env?.data ?? null
  const market = payload?.market_summary ?? {}

  // Read pre-computed sections from backend
  const sections = payload?.tcc_sections
  const topByEngine = sections?.top_by_engine ?? { day: null, swing: null, regular: null }
  const readyNow = sections?.ready_now ?? []
  const highConfWatch = sections?.high_conf_watch ?? []
  const lowSignals = sections?.low_signals ?? []

  // Filter to engines the current role can access
  const engineOrder = (['day', 'swing', 'regular'] as const).filter(e => {
    if (e === 'day')   return canDay
    if (e === 'swing') return canSwing
    return true
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
            // Map verdict to tone for badge
            const tone =
              v === 'STRONG_GO' ? 'bullish' :
              v === 'GO'        ? 'bullish' :
              v === 'WATCH'     ? 'warning' :
              v === 'AVOID'     ? 'bearish' : 'neutral'
            const bannerBg =
              tone === 'bullish' ? 'border-emerald-500/40 bg-emerald-950/20' :
              tone === 'warning' ? 'border-amber-500/30 bg-amber-950/15' :
              tone === 'bearish' ? 'border-rose-500/30 bg-rose-950/15' :
                                   'border-slate-700/40 bg-slate-900/40'
            const reasonDot =
              tone === 'bullish' ? 'bg-emerald-400' :
              tone === 'warning' ? 'bg-amber-400' :
              tone === 'bearish' ? 'bg-rose-400' : 'bg-slate-500'

            return (
              <section className={`rounded-2xl border p-4 ${bannerBg}`}>
                <div className="flex flex-wrap items-center gap-3">
                  <span className={`rounded-lg px-3 py-1 text-sm font-black uppercase tracking-wide ${verdictBadgeClass(tone)}`}>{v.replace(/_/g, ' ')}</span>
                  <span className="text-sm font-semibold text-slate-200">{od.label}</span>
                  <span className="font-mono text-xs text-slate-500">{od.confidence}% conf.</span>
                  {od.engines_agreeing.length > 0 && (
                    <div className="flex items-center gap-1 ml-auto">
                      <span className="text-[10px] text-slate-600 uppercase tracking-wide">Aligned:</span>
                      {od.engines_agreeing.map(e => (
                        <span key={e} className={`rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase ${engineChipClass(e)}`}>{e}</span>
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
          {engineOrder.length > 0 && (() => {
            const gridCols = engineOrder.length === 3 ? 'grid-cols-3' : engineOrder.length === 2 ? 'grid-cols-2' : 'grid-cols-1'
            return (
              <div className={`grid gap-3 ${gridCols}`}>
                {engineOrder.map(engKey => {
                  const top = topByEngine[engKey]
                  const label = engKey === 'day' ? 'Day Trade' : engKey === 'swing' ? 'Swing Trade' : 'Options'
                  const timeframe = engKey === 'day' ? 'Intraday' : engKey === 'swing' ? '5–21 days' : 'Multi-leg'
                  const chipCls = engineChipClass(engKey)
                  const borderCls = engineBorderClass(engKey)

                  if (!top) {
                    return (
                      <div key={engKey} className={`rounded-xl border border-l-4 ${borderCls} border-l-slate-700 bg-slate-900 p-4`}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase ${chipCls}`}>{engKey.toUpperCase()}</span>
                          <span className="text-[10px] text-slate-600">{timeframe}</span>
                        </div>
                        <div className="text-sm font-semibold text-slate-600">No setup</div>
                        <div className="text-[10px] text-slate-700 mt-1">{label} has no actionable signals</div>
                      </div>
                    )
                  }

                  const conf = top.display_confidence ?? (typeof top.confidence === 'number' ? top.confidence : 0)

                  return (
                    <button
                      key={engKey}
                      type="button"
                      onClick={() => navigate(navForRec(top))}
                      className={`rounded-xl border border-l-4 ${borderCls} ${borderAccentClass(top.verdict_tone)} bg-slate-900 p-4 text-left transition-all hover:shadow-md hover:-translate-y-0.5`}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className={`rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase ${chipCls}`}>{engKey.toUpperCase()}</span>
                          <span className="text-[10px] text-slate-600">{timeframe}</span>
                        </div>
                        <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${verdictBadgeClass(top.verdict_tone)}`}>{top.verdict_label}</span>
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
                      <SubIndicators indicators={top.sub_indicators} />
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
                  const conf = rec.display_confidence ?? (typeof rec.confidence === 'number' ? rec.confidence : 0)
                  const eng = rec.detail_route_key
                  const chgPct = rec.price_change_pct
                  const chgColor = chgPct != null ? (chgPct >= 0 ? 'text-emerald-400' : 'text-red-400') : 'text-slate-500'

                  return (
                    <button
                      key={rec.id}
                      type="button"
                      onClick={() => navigate(navForRec(rec))}
                      className={`rounded-xl border border-l-4 ${engineBorderClass(eng)} ${borderAccentClass(rec.verdict_tone)} bg-slate-900 p-3.5 text-left transition-all hover:shadow-md hover:-translate-y-0.5`}
                    >
                      {/* Header row */}
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-base font-bold text-white">{rec.ticker}</span>
                          <span className={`rounded border px-1 py-0.5 text-[9px] font-bold uppercase ${engineChipClass(eng)}`}>{eng.toUpperCase()}</span>
                        </div>
                        <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${verdictBadgeClass(rec.verdict_tone)}`}>{rec.verdict_label}</span>
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
                      <SubIndicators indicators={rec.sub_indicators} />
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
                <span className="text-[10px] text-slate-600 ml-1">not yet triggered</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {highConfWatch.map(rec => {
                  const conf = rec.display_confidence ?? (typeof rec.confidence === 'number' ? rec.confidence : 0)
                  const eng = rec.detail_route_key
                  const chgPct = rec.price_change_pct
                  const chgColor = chgPct != null ? (chgPct >= 0 ? 'text-emerald-400' : 'text-red-400') : 'text-slate-500'

                  return (
                    <button
                      key={rec.id}
                      type="button"
                      onClick={() => navigate(navForRec(rec))}
                      className={`rounded-xl border border-l-4 ${engineBorderClass(eng)} border-l-amber-500/60 bg-slate-900 p-3.5 text-left transition-all hover:shadow-md hover:-translate-y-0.5`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-base font-bold text-white">{rec.ticker}</span>
                          <span className={`rounded border px-1 py-0.5 text-[9px] font-bold uppercase ${engineChipClass(eng)}`}>{eng.toUpperCase()}</span>
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
                      <SubIndicators indicators={rec.sub_indicators} />
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
                  const eng = rec.detail_route_key
                  return (
                    <button
                      key={rec.id}
                      type="button"
                      onClick={() => navigate(navForRec(rec))}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] px-2.5 py-1.5 text-xs hover:bg-slate-800/40 transition-colors"
                    >
                      <span className="font-mono font-bold text-slate-300">{rec.ticker}</span>
                      <span className={`rounded border px-1 py-0.5 text-[9px] font-bold uppercase ${engineChipClass(eng)}`}>{eng.toUpperCase()}</span>
                      <span className={`rounded px-1 py-0.5 text-[9px] font-bold uppercase ${verdictBadgeClass(rec.verdict_tone)}`}>{rec.verdict_label}</span>
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
