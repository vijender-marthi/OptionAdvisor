import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Zap, TrendingUp, Layers, CalendarClock, AlertTriangle, RefreshCw, Radar } from 'lucide-react'
import { fetchSignalFeed } from '../api/commandCenter'
import { fetchEarningsRadar, type EarningsRadarCard } from '../api/client'
import type { SignalFeedRow, SignalFeedDecisionBlock } from '../types/commandCenter'
import { getEngineRoute } from '../routing/routes'

// ── structure (bull / bear / flat) from the row's backend trend ──────────────
function structOf(row: SignalFeedRow): { label: string; tone: 'bull' | 'bear' | 'flat' } {
  const m = row.metrics as Record<string, unknown> | undefined
  const t = String(row.trend || (typeof m?.market_bias === 'string' ? m.market_bias : '')).toUpperCase()
  if (t.includes('BULL')) return { label: 'Bull', tone: 'bull' }
  if (t.includes('BEAR')) return { label: 'Bear', tone: 'bear' }
  return { label: 'Flat', tone: 'flat' }
}
const toneCls = (tone: 'bull' | 'bear' | 'flat') =>
  tone === 'bull' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  : tone === 'bear' ? 'bg-red-500/10 text-red-600 dark:text-red-300'
  : 'bg-slate-500/10 text-tertiary'

const ACTIONABLE = new Set(['GO', 'STRONG_GO', 'READY', 'ENTER', 'WATCH', 'MANAGE'])
const isActionable = (d?: string) => ACTIONABLE.has(String(d || '').toUpperCase())

function earningsTone(card: EarningsRadarCard): 'bull' | 'bear' | 'flat' {
  const cs = card.creditSpread
  if (card.directionalLean.includes('bearish') || (cs && cs.type.startsWith('Bear'))) return 'bear'
  if (card.directionalLean.includes('bullish') || (cs && cs.type.startsWith('Bull'))) return 'bull'
  return 'flat'
}

function StructBadge({ s }: { s: { label: string; tone: 'bull' | 'bear' | 'flat' } }) {
  return <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${toneCls(s.tone)}`}>{s.label}</span>
}

const verdictCls = (v?: string) => {
  const s = String(v || '').toUpperCase()
  if (s.includes('STRONG_GO') || s === 'GO' || s === 'READY' || s === 'ENTER') return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
  if (s === 'WATCH' || s === 'MANAGE') return 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
  if (s.includes('AVOID') || s.includes('NO_EDGE') || s === 'WAIT' || s === 'CONFLICT') return 'bg-red-500/10 text-red-600 dark:text-red-300'
  return 'bg-slate-500/10 text-tertiary'
}

function EngineList({ title, icon, rows, blockKey, decisionKey, onOpen }: {
  title: string; icon: ReactNode
  rows: SignalFeedRow[]; blockKey: 'day' | 'swing' | 'regular'
  decisionKey: 'day_decision' | 'swing_decision' | 'regular_decision'; onOpen: (ticker: string) => void
}) {
  const visible = rows.slice(0, 6)
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-heading">{icon}{title}</div>
      <div className="overflow-hidden rounded-xl border border-border">
        {visible.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-tertiary">No actionable {title.toLowerCase()} setups right now.</div>
        ) : visible.map((row, i) => {
          const block = (row as unknown as Record<string, SignalFeedDecisionBlock | undefined>)[blockKey]
          const verdict = block?.verdict || block?.final_decision || String(row[decisionKey] || '')
          const exec = (block?.execution_fields || []).filter(f => f?.value && f.value !== '—').slice(0, 3)
          return (
            <button key={row.id} type="button" onClick={() => onOpen(row.ticker)}
              className={`block w-full px-3 py-2.5 text-left hover:bg-surface-muted ${i < visible.length - 1 ? 'border-b border-border' : ''}`}>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-semibold text-heading">{row.ticker}</span>
                <StructBadge s={structOf(row)} />
                <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${verdictCls(verdict)}`}>{String(verdict).replace(/_/g, ' ')}</span>
                {block?.strategy && <span className="truncate text-[11px] font-medium text-secondary">{block.strategy}</span>}
                {typeof block?.confidence === 'number' && <span className="ml-auto shrink-0 font-mono text-[11px] text-tertiary">{block.confidence}%</span>}
              </div>
              {block?.reason && <div className="mt-1 line-clamp-2 text-[11px] leading-snug text-secondary">{block.reason}</div>}
              {exec.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px] text-tertiary">
                  {exec.map(f => <span key={f.label}><span className="opacity-70">{f.label}</span> {f.value}</span>)}
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

const CC_CACHE_KEY = 'oa_command_center_cache_v1'
type CCCache = { rows: SignalFeedRow[]; earnings: EarningsRadarCard[]; at: number }
function readCCCache(): CCCache | null {
  try {
    const raw = localStorage.getItem(CC_CACHE_KEY)
    return raw ? (JSON.parse(raw) as CCCache) : null
  } catch { return null }
}
function writeCCCache(rows: SignalFeedRow[], earnings: EarningsRadarCard[]): number {
  const at = Date.now()
  try { localStorage.setItem(CC_CACHE_KEY, JSON.stringify({ rows, earnings, at })) } catch { /* quota/private mode */ }
  return at
}

export default function TradeCommandCenter() {
  const navigate = useNavigate()
  const cached = useMemo(() => readCCCache(), [])
  const [rows, setRows] = useState<SignalFeedRow[]>(cached?.rows ?? [])
  const [earnings, setEarnings] = useState<EarningsRadarCard[]>(cached?.earnings ?? [])
  // Only block the page when there is nothing cached to show yet.
  const [loading, setLoading] = useState(!cached)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<number | null>(cached?.at ?? null)
  const [error, setError] = useState('')

  const load = useCallback(async (refresh: boolean, hasCache: boolean) => {
    if (refresh || !hasCache) { if (!hasCache) setLoading(true) }
    setRefreshing(true); setError('')
    try {
      const [feed, radar] = await Promise.allSettled([
        fetchSignalFeed({ page_size: 60, sort_by: 'relative_strength', sort_dir: 'desc', refresh }),
        fetchEarningsRadar({ withinDays: 30 }),
      ])
      const nextRows = feed.status === 'fulfilled' ? (feed.value.data?.rows ?? []) : null
      const nextEarnings = radar.status === 'fulfilled' ? (radar.value.cards ?? []) : null
      if (nextRows) setRows(nextRows)
      if (nextEarnings) setEarnings(nextEarnings)
      if (nextRows || nextEarnings) {
        setUpdatedAt(writeCCCache(nextRows ?? cached?.rows ?? [], nextEarnings ?? cached?.earnings ?? []))
      }
      if (feed.status === 'rejected' && radar.status === 'rejected' && !hasCache) {
        setError('Unable to load the command center. Try again.')
      }
    } catch {
      if (!hasCache) setError('Unable to load the command center. Try again.')
    } finally {
      setLoading(false); setRefreshing(false)
    }
  }, [cached])

  // Show cached data instantly, then always revalidate in the background on mount.
  useEffect(() => { void load(false, !!cached) }, [load, cached])

  const market = useMemo(() => {
    const row = rows[0]
    const dm = row?.metrics as Record<string, unknown> | undefined
    const dayM = (row as unknown as { day?: { metrics?: Record<string, unknown> } })?.day?.metrics
    const vixRaw = dayM?.vix ?? dayM?.vix_level ?? dm?.vix
    const vix = typeof vixRaw === 'number' ? vixRaw : (typeof vixRaw === 'string' ? Number(vixRaw) : null)
    return {
      spy: typeof dayM?.spy_bias === 'string' ? dayM.spy_bias : '',
      qqq: typeof dayM?.qqq_bias === 'string' ? dayM.qqq_bias : '',
      vix: vix != null && Number.isFinite(vix) ? vix : null,
    }
  }, [rows])

  const dayRows = useMemo(() => rows.filter(r => isActionable(r.day_decision)), [rows])
  const swingRows = useMemo(() => rows.filter(r => isActionable(r.swing_decision)), [rows])
  const regularRows = useMemo(() => rows.filter(r => isActionable(r.regular_decision)), [rows])

  const openEngine = (engine: 'day' | 'swing' | 'regular') => (ticker: string) =>
    navigate(getEngineRoute(engine, ticker))

  const biasCls = (v: string) => /BULL/i.test(v) ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    : /BEAR/i.test(v) ? 'bg-red-500/10 text-red-600 dark:text-red-300' : 'bg-slate-500/10 text-secondary'

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-3 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-heading">Trade command center</h1>
        <div className="flex items-center gap-2">
          <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${biasCls(market.spy)}`}>SPY {market.spy || '—'}</span>
          <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${biasCls(market.qqq)}`}>QQQ {market.qqq || '—'}</span>
          {market.vix != null && <span className="rounded-md bg-surface-muted px-2 py-0.5 text-xs font-semibold text-secondary">VIX {market.vix.toFixed(1)}</span>}
          {updatedAt && <span className="text-[10px] text-tertiary">{refreshing ? 'updating…' : `updated ${new Date(updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}</span>}
          <button type="button" onClick={() => void load(true, true)} disabled={refreshing} className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-secondary hover:bg-surface-muted disabled:opacity-60">
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />Refresh
          </button>
        </div>
      </div>

      {market.vix != null && market.vix >= 20 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span><span className="font-semibold">VIX {market.vix.toFixed(1)} — high territory.</span> Consider trimming ~25% into the next vol spike and keeping new risk defined.</span>
        </div>
      )}

      {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">{error}</div>}
      {loading && rows.length === 0 && earnings.length === 0 && <div className="py-10 text-center text-sm text-tertiary">Loading your command center…</div>}

      {/* Earnings → credit spreads */}
      <div>
        <div className="mb-2 flex items-center gap-2 text-[15px] font-semibold text-heading"><CalendarClock size={18} className="text-violet-500" />Earnings in the next 30 days · credit-spread candidates</div>
        {earnings.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-3 py-5 text-center text-xs text-tertiary">No watchlist tickers report in the next 30 days. Add names, or open the Earnings Radar.</div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            {earnings.slice(0, 8).map((c, i, arr) => {
              const cs = c.creditSpread
              const tone = earningsTone(c)
              return (
                <button key={c.ticker} type="button" onClick={() => navigate('/earnings-radar')}
                  className={`flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left hover:bg-surface-muted ${i < arr.length - 1 ? 'border-b border-border' : ''}`}>
                  <div className="w-24 shrink-0"><div className="font-mono text-sm font-semibold text-heading">{c.ticker}</div><div className="text-[10px] text-tertiary">{c.nextEarnings} · in {c.daysToEarnings}d</div></div>
                  <StructBadge s={{ label: tone === 'bull' ? 'Bullish' : tone === 'bear' ? 'Bearish' : 'Neutral', tone }} />
                  <div className="min-w-0 flex-1">
                    {cs ? (
                      <>
                        <div className="text-sm font-medium text-heading">{cs.type} <span className="font-mono">{cs.shortStrike} / {cs.longStrike}</span></div>
                        <div className="text-[10px] text-tertiary">{cs.note} · impl ±{c.impliedMovePct ?? '—'}% vs typ ±{c.typicalMovePct ?? '—'}%</div>
                      </>
                    ) : (
                      <div className="text-xs text-tertiary">Spread unavailable (no chain) · impl ±{c.impliedMovePct ?? '—'}%</div>
                    )}
                  </div>
                  {cs && (
                    <div className="shrink-0 text-right font-mono text-[11px]">
                      <div className="font-semibold text-emerald-600 dark:text-emerald-400">+${cs.credit.toFixed(2)} cr</div>
                      <div className="text-tertiary">risk ${cs.maxRisk.toFixed(0)} · POP {cs.pop}%</div>
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Day / Swing */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <EngineList title="Day trade" icon={<Zap size={15} className="text-violet-500" />} rows={dayRows} decisionKey="day_decision" blockKey="day" onOpen={openEngine('day')} />
        <EngineList title="Swing trade" icon={<TrendingUp size={15} className="text-violet-500" />} rows={swingRows} decisionKey="swing_decision" blockKey="swing" onOpen={openEngine('swing')} />
      </div>

      {/* Regular */}
      <EngineList title="Regular · options ideas" icon={<Layers size={15} className="text-violet-500" />} rows={regularRows} decisionKey="regular_decision" blockKey="regular" onOpen={openEngine('regular')} />

      <div className="flex items-start gap-1.5 border-t border-border pt-3 text-[11px] text-tertiary">
        <Radar size={13} className="mt-0.5 shrink-0" />
        <span>Educational analysis, not financial advice. Credit spreads into earnings sell elevated IV at defined risk — a bigger-than-priced move can still hit the short strike. Structure is the backend read, not a guarantee. Strikes shown are ~1σ estimates.</span>
      </div>
    </div>
  )
}
