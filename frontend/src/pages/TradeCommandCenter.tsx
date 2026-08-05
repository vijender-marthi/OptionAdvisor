import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Zap, TrendingUp, Layers, CalendarClock, AlertTriangle, RefreshCw, Radar } from 'lucide-react'
import { fetchSignalFeed } from '../api/commandCenter'
import { fetchEarningsRadar, type EarningsRadarCard } from '../api/client'
import type { SignalFeedRow } from '../types/commandCenter'
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

// Credit-spread suggestion from an earnings card: sell ~1σ OTM on the structure side.
function creditSpread(card: EarningsRadarCard) {
  const spot = card.spot
  const move = (card.impliedMovePct ?? 6) / 100
  const bull = card.directionalLean.includes('bullish')
  const bear = card.directionalLean.includes('bearish')
  if (bull) {
    const s = Math.round(spot * (1 - move))
    return { type: 'Bull put spread', strikes: `${s} / ${s - 5}`, note: 'sell ~1σ OTM below structure', tone: 'bull' as const }
  }
  if (bear) {
    const s = Math.round(spot * (1 + move))
    return { type: 'Bear call spread', strikes: `${s} / ${s + 5}`, note: 'sell ~1σ OTM above structure', tone: 'bear' as const }
  }
  const lo = Math.round(spot * (1 - move))
  const hi = Math.round(spot * (1 + move))
  return { type: 'Iron condor', strikes: `${lo} / ${hi}`, note: 'defined-risk, both sides', tone: 'flat' as const }
}

function StructBadge({ s }: { s: { label: string; tone: 'bull' | 'bear' | 'flat' } }) {
  return <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${toneCls(s.tone)}`}>{s.label}</span>
}

function EngineList({ title, icon, rows, decisionKey, confKey, onOpen }: {
  title: string; icon: ReactNode
  rows: SignalFeedRow[]; decisionKey: 'day_decision' | 'swing_decision' | 'regular_decision'
  confKey: 'day' | 'swing' | 'regular'; onOpen: (ticker: string) => void
}) {
  const visible = rows.slice(0, 6)
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-heading">{icon}{title}</div>
      <div className="overflow-hidden rounded-xl border border-border">
        {visible.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-tertiary">No actionable {title.toLowerCase()} setups right now.</div>
        ) : visible.map((row, i) => {
          const conf = (row as unknown as Record<string, { confidence?: number } | undefined>)[confKey]?.confidence
          return (
            <button key={row.id} type="button" onClick={() => onOpen(row.ticker)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-muted ${i < visible.length - 1 ? 'border-b border-border' : ''}`}>
              <span className="w-14 shrink-0 font-mono text-sm font-semibold text-heading">{row.ticker}</span>
              <StructBadge s={structOf(row)} />
              <span className="min-w-0 flex-1 truncate text-xs text-secondary">{String(row[decisionKey] || '').replace(/_/g, ' ')}</span>
              {typeof conf === 'number' && <span className="shrink-0 font-mono text-[11px] text-tertiary">{conf}%</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function TradeCommandCenter() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<SignalFeedRow[]>([])
  const [earnings, setEarnings] = useState<EarningsRadarCard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true); setError('')
    try {
      const [feed, radar] = await Promise.allSettled([
        fetchSignalFeed({ page_size: 60, sort_by: 'relative_strength', sort_dir: 'desc' }),
        fetchEarningsRadar({ withinDays: 30 }),
      ])
      if (feed.status === 'fulfilled') setRows(feed.value.data?.rows ?? [])
      if (radar.status === 'fulfilled') setEarnings((radar.value.cards ?? []).filter(c => c.daysToEarnings >= 14))
      if (feed.status === 'rejected' && radar.status === 'rejected') setError('Unable to load the command center. Try again.')
    } catch {
      setError('Unable to load the command center. Try again.')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, [])

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
          <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-secondary hover:bg-surface-muted disabled:opacity-60">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />Refresh
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
        <div className="mb-2 flex items-center gap-2 text-[15px] font-semibold text-heading"><CalendarClock size={18} className="text-violet-500" />Earnings in 14–30 days · credit-spread candidates</div>
        {earnings.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-3 py-5 text-center text-xs text-tertiary">No watchlist tickers report in that window. Add names, or open the Earnings Radar.</div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            {earnings.slice(0, 6).map((c, i, arr) => {
              const cs = creditSpread(c)
              return (
                <button key={c.ticker} type="button" onClick={() => navigate('/earnings-radar')}
                  className={`flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left hover:bg-surface-muted ${i < arr.length - 1 ? 'border-b border-border' : ''}`}>
                  <div className="w-28 shrink-0"><div className="font-mono text-sm font-semibold text-heading">{c.ticker}</div><div className="text-[10px] text-tertiary">{c.nextEarnings} · in {c.daysToEarnings}d</div></div>
                  <StructBadge s={{ label: cs.tone === 'bull' ? 'Bullish' : cs.tone === 'bear' ? 'Bearish' : 'Neutral', tone: cs.tone }} />
                  <div className="min-w-0 flex-1"><div className="text-sm font-medium text-heading">{cs.type} {cs.strikes}</div><div className="text-[10px] text-tertiary">{cs.note}</div></div>
                  <div className="shrink-0 text-right font-mono text-[11px] text-tertiary">impl ±{c.impliedMovePct ?? '—'}% · typ ±{c.typicalMovePct ?? '—'}%</div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Day / Swing */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <EngineList title="Day trade" icon={<Zap size={15} className="text-violet-500" />} rows={dayRows} decisionKey="day_decision" confKey="day" onOpen={openEngine('day')} />
        <EngineList title="Swing trade" icon={<TrendingUp size={15} className="text-violet-500" />} rows={swingRows} decisionKey="swing_decision" confKey="swing" onOpen={openEngine('swing')} />
      </div>

      {/* Regular */}
      <EngineList title="Regular · options ideas" icon={<Layers size={15} className="text-violet-500" />} rows={regularRows} decisionKey="regular_decision" confKey="regular" onOpen={openEngine('regular')} />

      <div className="flex items-start gap-1.5 border-t border-border pt-3 text-[11px] text-tertiary">
        <Radar size={13} className="mt-0.5 shrink-0" />
        <span>Educational analysis, not financial advice. Credit spreads into earnings sell elevated IV at defined risk — a bigger-than-priced move can still hit the short strike. Structure is the backend read, not a guarantee. Strikes shown are ~1σ estimates.</span>
      </div>
    </div>
  )
}
