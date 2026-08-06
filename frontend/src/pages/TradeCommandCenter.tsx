import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarClock, AlertTriangle, RefreshCw, Radar, ChevronUp, ChevronDown } from 'lucide-react'
import { fetchSignalFeed } from '../api/commandCenter'
import { fetchEarningsRadar, type EarningsRadarCard } from '../api/client'
import type { SignalFeedRow, SignalFeedDecisionBlock } from '../types/commandCenter'
import { getEngineRoute } from '../routing/routes'

// ── shared helpers ───────────────────────────────────────────────────────────
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
function StructBadge({ s }: { s: { label: string; tone: 'bull' | 'bear' | 'flat' } }) {
  return <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${toneCls(s.tone)}`}>{s.label}</span>
}

const ACTIONABLE = new Set(['GO', 'STRONG_GO', 'READY', 'ENTER', 'WATCH', 'MANAGE'])
const isActionable = (d?: string) => ACTIONABLE.has(String(d || '').toUpperCase())
const V_RANK: Record<string, number> = { STRONG_GO: 5, GO: 4, READY: 4, ENTER: 4, WATCH: 3, MANAGE: 2, WAIT: 1, CONFLICT: 1, AVOID: 0, NO_EDGE: 0 }
const rankOf = (v?: string) => V_RANK[String(v || '').toUpperCase()] ?? 0
const verdictCls = (v?: string) => {
  const r = rankOf(v)
  return r >= 4 ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
    : r >= 2 ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
    : 'bg-red-500/10 text-red-600 dark:text-red-300'
}
const engineCls: Record<string, string> = {
  day: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
  swing: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
  regular: 'bg-slate-500/10 text-secondary',
}
const engineLabel: Record<string, string> = { day: 'Day', swing: 'Swing', regular: 'Regular' }

function earningsTone(card: EarningsRadarCard): 'bull' | 'bear' | 'flat' {
  const cs = card.creditSpread
  if (card.directionalLean.includes('bearish') || (cs && cs.type.startsWith('Bear'))) return 'bear'
  if (card.directionalLean.includes('bullish') || (cs && cs.type.startsWith('Bull'))) return 'bull'
  return 'flat'
}

// ── flatten feed rows × engines into one opportunity per actionable engine ────
type Opp = {
  id: string; ticker: string; struct: ReturnType<typeof structOf>; engine: 'day' | 'swing' | 'regular'
  verdict: string; strategy: string | null; reason: string | null
  entry: string | null; stop: string | null; target: string | null; rr: string | null; confidence: number | null
  conviction: number; rrNum: number
}
function execVal(block: SignalFeedDecisionBlock | undefined, re: RegExp): string | null {
  const f = (block?.execution_fields || []).find(x => re.test(String(x.label)))
  return f?.value && f.value !== '—' ? f.value : null
}
const numOf = (s: string | null): number => {
  if (!s) return NaN
  const n = parseFloat(String(s).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : NaN
}
function buildOpps(rows: SignalFeedRow[]): Opp[] {
  const engines: Array<['day' | 'swing' | 'regular', 'day_decision' | 'swing_decision' | 'regular_decision']> = [
    ['day', 'day_decision'], ['swing', 'swing_decision'], ['regular', 'regular_decision'],
  ]
  const out: Opp[] = []
  for (const row of rows) {
    for (const [engine, dk] of engines) {
      const block = (row as unknown as Record<string, SignalFeedDecisionBlock | undefined>)[engine]
      const verdict = String(block?.verdict || block?.final_decision || row[dk] || '')
      if (!isActionable(verdict)) continue
      const rr = execVal(block, /r.?r|reward|risk.?reward/i)
      const confidence = typeof block?.confidence === 'number' ? block.confidence : null
      out.push({
        id: `${row.id}-${engine}`, ticker: row.ticker, struct: structOf(row), engine, verdict,
        strategy: block?.strategy ?? null, reason: block?.reason ?? null,
        entry: execVal(block, /entry/i), stop: execVal(block, /stop/i), target: execVal(block, /target|tgt/i), rr,
        confidence, conviction: rankOf(verdict) * 100 + (confidence ?? 0), rrNum: numOf(rr),
      })
    }
  }
  return out
}

const CC_CACHE_KEY = 'oa_command_center_cache_v1'
type CCCache = { rows: SignalFeedRow[]; earnings: EarningsRadarCard[]; at: number }
function readCCCache(): CCCache | null {
  try { const raw = localStorage.getItem(CC_CACHE_KEY); return raw ? (JSON.parse(raw) as CCCache) : null } catch { return null }
}
function writeCCCache(rows: SignalFeedRow[], earnings: EarningsRadarCard[]): number {
  const at = Date.now()
  try { localStorage.setItem(CC_CACHE_KEY, JSON.stringify({ rows, earnings, at })) } catch { /* quota/private */ }
  return at
}

type SortCol = 'conviction' | 'ticker' | 'engine' | 'verdict' | 'rr' | 'confidence'

export default function TradeCommandCenter() {
  const navigate = useNavigate()
  const cached = useMemo(() => readCCCache(), [])
  const [rows, setRows] = useState<SignalFeedRow[]>(cached?.rows ?? [])
  const [earnings, setEarnings] = useState<EarningsRadarCard[]>(cached?.earnings ?? [])
  const [loading, setLoading] = useState(!cached)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<number | null>(cached?.at ?? null)
  const [error, setError] = useState('')
  const [engineFilter, setEngineFilter] = useState<'all' | 'day' | 'swing' | 'regular'>('all')
  const [structFilter, setStructFilter] = useState<'all' | 'bull' | 'bear'>('all')
  const [sort, setSort] = useState<{ col: SortCol; dir: 'asc' | 'desc' }>({ col: 'conviction', dir: 'desc' })

  const load = useCallback(async (refresh: boolean, hasCache: boolean) => {
    if (!hasCache) setLoading(true)
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
      if (nextRows || nextEarnings) setUpdatedAt(writeCCCache(nextRows ?? cached?.rows ?? [], nextEarnings ?? cached?.earnings ?? []))
      if (feed.status === 'rejected' && radar.status === 'rejected' && !hasCache) setError('Unable to load the command center. Try again.')
    } catch {
      if (!hasCache) setError('Unable to load the command center. Try again.')
    } finally {
      setLoading(false); setRefreshing(false)
    }
  }, [cached])
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

  const opps = useMemo(() => {
    let list = buildOpps(rows)
    if (engineFilter !== 'all') list = list.filter(o => o.engine === engineFilter)
    if (structFilter !== 'all') list = list.filter(o => o.struct.tone === structFilter)
    const dir = sort.dir === 'asc' ? 1 : -1
    list.sort((a, b) => {
      switch (sort.col) {
        case 'ticker': return a.ticker.localeCompare(b.ticker) * dir
        case 'engine': return a.engine.localeCompare(b.engine) * dir
        case 'verdict': return (rankOf(a.verdict) - rankOf(b.verdict)) * dir
        case 'rr': return ((isNaN(a.rrNum) ? -1 : a.rrNum) - (isNaN(b.rrNum) ? -1 : b.rrNum)) * dir
        case 'confidence': return ((a.confidence ?? 0) - (b.confidence ?? 0)) * dir
        default: return (a.conviction - b.conviction) * dir
      }
    })
    return list
  }, [rows, engineFilter, structFilter, sort])

  const toggleSort = (col: SortCol) =>
    setSort(s => s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: col === 'ticker' || col === 'engine' ? 'asc' : 'desc' })

  const biasCls = (v: string) => /BULL/i.test(v) ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    : /BEAR/i.test(v) ? 'bg-red-500/10 text-red-600 dark:text-red-300' : 'bg-slate-500/10 text-secondary'

  const Th = ({ col, label, className }: { col?: SortCol; label: string; className?: string }) => (
    <th className={`px-3 py-2 text-left font-semibold ${className || ''}`}>
      {col ? (
        <button type="button" onClick={() => toggleSort(col)} className="inline-flex items-center gap-0.5 hover:text-heading">
          {label}{sort.col === col && (sort.dir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
        </button>
      ) : label}
    </th>
  )
  const Chip = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button type="button" onClick={onClick}
      className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${active ? 'border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-200' : 'border-border text-tertiary hover:bg-surface-muted'}`}>
      {children}
    </button>
  )

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 p-3 sm:p-5">
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
          <div className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-xs text-tertiary">No watchlist tickers report in the next 30 days. Add names, or open the Earnings Radar.</div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            {earnings.slice(0, 8).map((c, i, arr) => {
              const cs = c.creditSpread
              const tone = earningsTone(c)
              return (
                <button key={c.ticker} type="button" onClick={() => navigate('/earnings-radar')}
                  className={`flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left hover:bg-surface-muted ${i < arr.length - 1 ? 'border-b border-border' : ''}`}>
                  <div className="w-24 shrink-0"><div className="font-mono text-sm font-semibold text-heading">{c.ticker}</div><div className="text-[10px] text-tertiary">{c.nextEarnings} · in {c.daysToEarnings}d</div></div>
                  <StructBadge s={{ label: tone === 'bull' ? 'Bullish' : tone === 'bear' ? 'Bearish' : 'Neutral', tone }} />
                  <div className="min-w-0 flex-1">
                    {cs ? (
                      <><div className="text-sm font-medium text-heading">{cs.type} <span className="font-mono">{cs.shortStrike} / {cs.longStrike}</span></div>
                      <div className="text-[10px] text-tertiary">{cs.note} · impl ±{c.impliedMovePct ?? '—'}% vs typ ±{c.typicalMovePct ?? '—'}%</div></>
                    ) : <div className="text-xs text-tertiary">Spread unavailable (no chain) · impl ±{c.impliedMovePct ?? '—'}%</div>}
                  </div>
                  {cs && <div className="shrink-0 text-right font-mono text-[11px]"><div className="font-semibold text-emerald-600 dark:text-emerald-400">+${cs.credit.toFixed(2)} cr</div><div className="text-tertiary">risk ${cs.maxRisk.toFixed(0)} · POP {cs.pop}%</div></div>}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Unified sortable setups table */}
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <div className="text-[15px] font-semibold text-heading">Today's setups</div>
          <span className="text-xs text-tertiary">{opps.length} actionable</span>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {(['all', 'day', 'swing', 'regular'] as const).map(e => <Chip key={e} active={engineFilter === e} onClick={() => setEngineFilter(e)}>{e === 'all' ? 'All' : engineLabel[e]}</Chip>)}
            <span className="mx-1 h-4 w-px bg-border" />
            {(['all', 'bull', 'bear'] as const).map(s => <Chip key={s} active={structFilter === s} onClick={() => setStructFilter(s)}>{s === 'all' ? 'Any' : s === 'bull' ? 'Bull' : 'Bear'}</Chip>)}
          </div>
        </div>
        {opps.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-tertiary">No actionable setups match. Add tickers to your watchlists, or clear the filters.</div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[860px] border-collapse text-xs">
              <thead className="bg-surface-muted text-[10px] uppercase tracking-wide text-tertiary">
                <tr>
                  <Th col="ticker" label="Ticker" />
                  <Th label="Struct" />
                  <Th col="engine" label="Engine" />
                  <Th col="verdict" label="Verdict" />
                  <Th label="Setup / strategy" />
                  <Th label="Entry" className="text-right" />
                  <Th label="Stop" className="text-right" />
                  <Th label="Target" className="text-right" />
                  <Th col="rr" label="R:R" className="text-right" />
                  <Th col="confidence" label="Conf" className="text-right" />
                </tr>
              </thead>
              <tbody>
                {opps.map(o => (
                  <tr key={o.id} onClick={() => navigate(getEngineRoute(o.engine, o.ticker))}
                    className="cursor-pointer border-t border-border hover:bg-surface-muted">
                    <td className="px-3 py-2 font-mono text-sm font-semibold text-heading">{o.ticker}</td>
                    <td className="px-3 py-2"><StructBadge s={o.struct} /></td>
                    <td className="px-3 py-2"><span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${engineCls[o.engine]}`}>{engineLabel[o.engine]}</span></td>
                    <td className="px-3 py-2"><span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${verdictCls(o.verdict)}`}>{o.verdict.replace(/_/g, ' ')}</span></td>
                    <td className="px-3 py-2">
                      {o.strategy && <div className="font-medium text-heading">{o.strategy}</div>}
                      {o.reason && <div className="max-w-[320px] truncate text-[11px] text-tertiary">{o.reason}</div>}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-heading">{o.entry ?? '—'}</td>
                    <td className="px-3 py-2 text-right font-mono text-red-600 dark:text-red-400">{o.stop ?? '—'}</td>
                    <td className="px-3 py-2 text-right font-mono text-emerald-600 dark:text-emerald-400">{o.target ?? '—'}</td>
                    <td className="px-3 py-2 text-right font-mono text-secondary">{o.rr ?? '—'}</td>
                    <td className="px-3 py-2 text-right font-mono text-tertiary">{o.confidence != null ? `${o.confidence}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex items-start gap-1.5 border-t border-border pt-3 text-[11px] text-tertiary">
        <Radar size={13} className="mt-0.5 shrink-0" />
        <span>Educational analysis, not financial advice. Verdicts and entry / stop / target are the backend engines' reads, not guarantees; blank fields mean the engine didn't return that value. Credit-spread strikes are ~1σ estimates.</span>
      </div>
    </div>
  )
}
