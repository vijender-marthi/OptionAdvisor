import { useMemo } from 'react'
import {
  AlertTriangle,
  BarChart3,
  BrainCircuit,
  Clock,
  DollarSign,
  Layers,
  Lightbulb,
  Target,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import type { PortfolioPosition } from '../types'

interface SectorPnl {
  sector: string
  realized_pnl: number
  unrealized_pnl: number
  total_pnl: number
  open_count: number
  closed_count: number
  capital: number
}

interface PnlByPeriod { label: string; pnl: number }
interface PnlByStrategy { strategy: string; pnl: number; count: number; wins: number; win_rate: number }
interface RiskData {
  capital_by_ticker?: { ticker: string; value: number }[]
  concentration_risk?: { top_ticker_pct: number }
  options_exposure?: number
  stock_exposure?: number
}

interface Props {
  portfolio: PortfolioPosition[]
  sectorPnl: SectorPnl[]
  pnlByPeriod: PnlByPeriod[]
  pnlByStrategy: PnlByStrategy[]
  risk: RiskData | null
  summary: {
    total_pl?: number
    day_pl?: number
    week_pl?: number
    total_open_positions?: number
    options_positions?: number
    stock_positions?: number
    total_capital_used?: number
    closed_trades_count?: number
  } | null
  isDark: boolean
}

type Tone = 'good' | 'bad' | 'warn' | 'neutral'
type ReportRow = {
  key: string
  label: string
  pnl: number
  count: number
  wins: number
  losses: number
  capital: number
  avgPnl: number
  winRate: number
}

const DTE_BUCKETS = [
  { label: '0-7 DTE', lo: 0, hi: 7 },
  { label: '8-14 DTE', lo: 8, hi: 14 },
  { label: '15-21 DTE', lo: 15, hi: 21 },
  { label: '22-30 DTE', lo: 22, hi: 30 },
  { label: '31-45 DTE', lo: 31, hi: 45 },
  { label: '46+ DTE', lo: 46, hi: 9999 },
]

function money(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const sign = value < 0 ? '-' : ''
  return `${sign}$${Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`
}

function pct(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${value.toFixed(digits)}%`
}

function safeNum(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

function safeDte(value: unknown): number {
  const n = safeNum(value, 0)
  return n > 0 ? n : 0
}

function dteBucketLabel(dte: number): string {
  return DTE_BUCKETS.find(bucket => dte >= bucket.lo && dte <= bucket.hi)?.label ?? 'Unknown DTE'
}

function realizedPnl(pos: PortfolioPosition): number {
  if (pos.realized_pnl != null && Number.isFinite(pos.realized_pnl)) return pos.realized_pnl
  if (pos.pnlPct != null && Number.isFinite(pos.pnlPct)) {
    const ref = pos.net_credit < 0 ? Math.abs(pos.net_credit) : pos.max_profit
    if (ref > 0) return (pos.pnlPct / 100) * ref * 100 * Math.max(1, pos.contracts || 1)
  }
  return 0
}

function capitalAtRisk(pos: PortfolioPosition): number {
  if (pos.capital_at_risk != null && Number.isFinite(pos.capital_at_risk)) return pos.capital_at_risk
  if (pos.strategy === 'Stock') return safeNum(pos.entryPrice) * Math.max(1, pos.shares ?? pos.contracts ?? 1)
  return Math.max(safeNum(pos.max_loss), Math.abs(safeNum(pos.net_credit))) * 100 * Math.max(1, pos.contracts || 1)
}

function makeRow(label: string, positions: PortfolioPosition[]): ReportRow {
  const count = positions.length
  const pnl = positions.reduce((sum, pos) => sum + realizedPnl(pos), 0)
  const wins = positions.filter(pos => realizedPnl(pos) > 0).length
  const losses = positions.filter(pos => realizedPnl(pos) < 0).length
  const capital = positions.reduce((sum, pos) => sum + capitalAtRisk(pos), 0)
  return {
    key: label,
    label,
    pnl,
    count,
    wins,
    losses,
    capital,
    avgPnl: count > 0 ? pnl / count : 0,
    winRate: count > 0 ? (wins / count) * 100 : 0,
  }
}

function groupBy(positions: PortfolioPosition[], keyFn: (pos: PortfolioPosition) => string): ReportRow[] {
  const map = new Map<string, PortfolioPosition[]>()
  for (const pos of positions) {
    const key = keyFn(pos) || 'Unknown'
    map.set(key, [...(map.get(key) ?? []), pos])
  }
  return [...map.entries()]
    .map(([label, group]) => makeRow(label, group))
    .sort((a, b) => b.pnl - a.pnl)
}

function optionCategory(strategy: string): string {
  const s = strategy.toLowerCase()
  if (s === 'stock') return 'Stock'
  if (s.includes('long call')) return 'Long Call'
  if (s.includes('long put')) return 'Long Put'
  if (s.includes('bull put') || s.includes('bear call') || s.includes('short put') || s.includes('short call')) return 'Credit / Short Premium'
  if (s.includes('bull call') || s.includes('bear put')) return 'Debit Spread'
  if (s.includes('calendar')) return 'Calendar'
  if (s.includes('iron')) return 'Iron Condor'
  if (s.includes('spread')) return 'Spread'
  return 'Other'
}

function sourceLabel(pos: PortfolioPosition): string {
  const src = String(pos.source || 'regular').toLowerCase()
  if (src.includes('day')) return 'Day'
  if (src.includes('swing')) return 'Swing'
  return 'Regular'
}

export default function PositionsDashboardTab({
  portfolio,
  sectorPnl,
  pnlByPeriod,
  pnlByStrategy,
  risk,
  summary,
  isDark,
}: Props) {
  const st = {
    bg: isDark ? '#111318' : '#FFFFFF',
    bgSoft: isDark ? '#181C23' : '#F8FAFC',
    border: isDark ? '#252B37' : '#E5E7EB',
    text: isDark ? '#E8EBF0' : '#111827',
    muted: isDark ? '#8B94A7' : '#64748B',
    faint: isDark ? '#5A6478' : '#94A3B8',
    green: isDark ? '#34D399' : '#059669',
    red: isDark ? '#FB7185' : '#DC2626',
    amber: isDark ? '#FBBF24' : '#D97706',
    blue: isDark ? '#60A5FA' : '#2563EB',
  }

  const closed = useMemo(() => portfolio.filter(pos => pos.status === 'closed'), [portfolio])
  const open = useMemo(() => portfolio.filter(pos => pos.status === 'open'), [portfolio])

  const totals = useMemo(() => {
    const realized = closed.reduce((sum, pos) => sum + realizedPnl(pos), 0)
    const winners = closed.filter(pos => realizedPnl(pos) > 0)
    const losers = closed.filter(pos => realizedPnl(pos) < 0)
    const grossWin = winners.reduce((sum, pos) => sum + realizedPnl(pos), 0)
    const grossLoss = Math.abs(losers.reduce((sum, pos) => sum + realizedPnl(pos), 0))
    const deployed = closed.reduce((sum, pos) => sum + capitalAtRisk(pos), 0)
    return {
      realized,
      tradeCount: closed.length,
      wins: winners.length,
      losses: losers.length,
      winRate: closed.length ? (winners.length / closed.length) * 100 : 0,
      avgWin: winners.length ? grossWin / winners.length : 0,
      avgLoss: losers.length ? grossLoss / losers.length : 0,
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
      returnOnRisk: deployed > 0 ? (realized / deployed) * 100 : 0,
      deployed,
    }
  }, [closed])

  const byStrategy = useMemo(() => {
    const fromPositions = groupBy(closed, pos => pos.strategy || 'Unknown')
    if (fromPositions.length > 0) return fromPositions
    return pnlByStrategy.map(row => ({
      key: row.strategy,
      label: row.strategy,
      pnl: row.pnl,
      count: row.count,
      wins: row.wins,
      losses: Math.max(0, row.count - row.wins),
      capital: 0,
      avgPnl: row.count ? row.pnl / row.count : 0,
      winRate: row.win_rate,
    }))
  }, [closed, pnlByStrategy])

  const byTicker = useMemo(() => groupBy(closed, pos => pos.ticker.toUpperCase()), [closed])
  const byDte = useMemo(() => groupBy(closed, pos => dteBucketLabel(safeDte(pos.dte))), [closed])
  const byTickerDte = useMemo(
    () => groupBy(closed, pos => `${pos.ticker.toUpperCase()} · ${dteBucketLabel(safeDte(pos.dte))}`),
    [closed],
  )
  const byTickerStrategy = useMemo(
    () => groupBy(closed, pos => `${pos.ticker.toUpperCase()} · ${pos.strategy || 'Unknown'}`),
    [closed],
  )
  const byCategory = useMemo(() => groupBy(closed, pos => optionCategory(pos.strategy || 'Unknown')), [closed])
  const byTradeType = useMemo(() => groupBy(closed, sourceLabel), [closed])

  const monthly = useMemo(() => {
    if (pnlByPeriod.length > 0) return pnlByPeriod.slice(-8)
    const map = new Map<string, number>()
    for (const pos of closed) {
      if (!pos.exitDate) continue
      const d = new Date(pos.exitDate)
      if (Number.isNaN(d.getTime())) continue
      const key = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
      map.set(key, (map.get(key) ?? 0) + realizedPnl(pos))
    }
    return [...map.entries()].map(([label, pnl]) => ({ label, pnl }))
  }, [closed, pnlByPeriod])

  const suggestions = useMemo(() => {
    const items: Array<{ title: string; detail: string; tone: Tone; icon: React.ReactNode }> = []
    const bestStrategy = byStrategy[0]
    const worstStrategy = [...byStrategy].sort((a, b) => a.pnl - b.pnl)[0]
    const bestTicker = byTicker[0]
    const worstTicker = [...byTicker].sort((a, b) => a.pnl - b.pnl)[0]
    const bestDte = byDte[0]
    const worstDte = [...byDte].sort((a, b) => a.pnl - b.pnl)[0]
    const worstCombo = [...byTickerDte].sort((a, b) => a.pnl - b.pnl)[0]

    if (totals.tradeCount < 5) {
      items.push({
        title: 'Need More Closed Trades',
        detail: 'Close and log at least 5 trades before making strong conclusions. The dashboard will become more reliable as the sample size grows.',
        tone: 'warn',
        icon: <Lightbulb size={15} />,
      })
    }
    if (totals.tradeCount >= 5 && totals.profitFactor < 1) {
      items.push({
        title: 'Average Loss Is Too Large',
        detail: `Profit factor is ${totals.profitFactor.toFixed(2)}. Reduce loser size, close invalidated trades faster, or require better entry confirmation before adding risk.`,
        tone: 'bad',
        icon: <AlertTriangle size={15} />,
      })
    }
    if (bestStrategy?.pnl > 0) {
      items.push({
        title: `Lean Into ${bestStrategy.label}`,
        detail: `${bestStrategy.label} has produced ${money(bestStrategy.pnl)} across ${bestStrategy.count} closed trades with ${pct(bestStrategy.winRate)} win rate.`,
        tone: 'good',
        icon: <TrendingUp size={15} />,
      })
    }
    if (worstStrategy?.pnl < 0 && worstStrategy.count >= 2) {
      items.push({
        title: `Reduce ${worstStrategy.label}`,
        detail: `${worstStrategy.label} is down ${money(worstStrategy.pnl)}. Pause this setup or require a higher score until the entry/exit rules improve.`,
        tone: 'bad',
        icon: <TrendingDown size={15} />,
      })
    }
    if (bestTicker?.pnl > 0 && worstTicker?.pnl < 0) {
      items.push({
        title: 'Ticker Selection Matters',
        detail: `${bestTicker.label} is your strongest ticker at ${money(bestTicker.pnl)}, while ${worstTicker.label} is weakest at ${money(worstTicker.pnl)}. Size up only where the ticker edge is proven.`,
        tone: 'warn',
        icon: <Target size={15} />,
      })
    }
    if (bestDte?.pnl > 0 && worstDte?.pnl < 0) {
      items.push({
        title: 'Use The Better DTE Window',
        detail: `${bestDte.label} is profitable (${money(bestDte.pnl)}), while ${worstDte.label} is losing (${money(worstDte.pnl)}). Favor the profitable expiry window unless the setup is exceptional.`,
        tone: 'warn',
        icon: <Clock size={15} />,
      })
    }
    if (worstCombo?.pnl < 0 && worstCombo.count >= 2) {
      items.push({
        title: `Avoid ${worstCombo.label}`,
        detail: `This ticker/DTE combination has lost ${money(worstCombo.pnl)} across ${worstCombo.count} trades. Treat it as a blocked setup until reviewed.`,
        tone: 'bad',
        icon: <BrainCircuit size={15} />,
      })
    }
    if (risk?.concentration_risk?.top_ticker_pct && risk.concentration_risk.top_ticker_pct > 35) {
      items.push({
        title: 'Concentration Risk',
        detail: `${risk.concentration_risk.top_ticker_pct}% of capital is concentrated in one ticker. Consider trimming or diversifying before opening new correlated trades.`,
        tone: 'warn',
        icon: <Layers size={15} />,
      })
    }
    if (items.length === 0) {
      items.push({
        title: 'Process Looks Balanced',
        detail: 'No major performance issue stands out yet. Keep logging exits, close reason, DTE, and strategy so the dashboard can isolate the strongest edge.',
        tone: 'good',
        icon: <Lightbulb size={15} />,
      })
    }
    return items.slice(0, 6)
  }, [byDte, byStrategy, byTicker, byTickerDte, risk?.concentration_risk?.top_ticker_pct, totals.profitFactor, totals.tradeCount])

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard st={st} label="Realized P&L" value={money(totals.realized, 2)} tone={totals.realized >= 0 ? 'good' : 'bad'} icon={<DollarSign size={15} />} sub={`${totals.tradeCount} closed trades`} />
        <KpiCard st={st} label="Win Rate" value={pct(totals.winRate, 1)} tone={totals.winRate >= 50 ? 'good' : 'bad'} icon={<Target size={15} />} sub={`${totals.wins}W / ${totals.losses}L`} />
        <KpiCard st={st} label="Profit Factor" value={totals.profitFactor === Infinity ? '∞' : totals.profitFactor.toFixed(2)} tone={totals.profitFactor >= 1.5 ? 'good' : totals.profitFactor >= 1 ? 'warn' : 'bad'} icon={<BarChart3 size={15} />} sub={`Avg W ${money(totals.avgWin)} / L ${money(totals.avgLoss)}`} />
        <KpiCard st={st} label="Return On Risk" value={pct(totals.returnOnRisk, 1)} tone={totals.returnOnRisk >= 0 ? 'good' : 'bad'} icon={<TrendingUp size={15} />} sub={`${money(totals.deployed)} deployed`} />
        <KpiCard st={st} label="Open Positions" value={String(open.length || summary?.total_open_positions || 0)} tone="neutral" icon={<Layers size={15} />} sub={`${summary?.options_positions ?? 0} options · ${summary?.stock_positions ?? 0} stocks`} />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <ReportCard st={st} title="P&L by Option Strategy" icon={<BarChart3 size={16} />}>
          <ReportTable st={st} rows={byStrategy} primaryLabel="Strategy" limit={12} />
        </ReportCard>
        <ReportCard st={st} title="Suggestions to Improve" icon={<Lightbulb size={16} />}>
          <div className="space-y-2">
            {suggestions.map(item => (
              <SuggestionRow key={item.title} st={st} {...item} />
            ))}
          </div>
        </ReportCard>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ReportCard st={st} title="P&L by Ticker" icon={<Target size={16} />}>
          <ReportTable st={st} rows={byTicker} primaryLabel="Ticker" limit={14} />
        </ReportCard>
        <ReportCard st={st} title="Ticker + DTE Combination" icon={<Clock size={16} />}>
          <ReportTable st={st} rows={byTickerDte} primaryLabel="Ticker / DTE" limit={14} />
        </ReportCard>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ReportCard st={st} title="P&L by DTE Bucket" icon={<Clock size={16} />}>
          <ReportTable st={st} rows={byDte} primaryLabel="DTE" limit={8} />
        </ReportCard>
        <ReportCard st={st} title="Ticker + Strategy Combination" icon={<BrainCircuit size={16} />}>
          <ReportTable st={st} rows={byTickerStrategy} primaryLabel="Ticker / Strategy" limit={10} />
        </ReportCard>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <ReportCard st={st} title="Category Performance" icon={<Layers size={16} />}>
          <ReportTable st={st} rows={byCategory} primaryLabel="Category" limit={8} compact />
        </ReportCard>
        <ReportCard st={st} title="Day / Swing / Regular" icon={<ActivityIcon />} >
          <ReportTable st={st} rows={byTradeType} primaryLabel="Type" limit={6} compact />
        </ReportCard>
        <ReportCard st={st} title="Recent P&L Periods" icon={<TrendingUp size={16} />}>
          <PeriodList st={st} rows={monthly} />
        </ReportCard>
      </section>

      {sectorPnl.length > 0 || risk?.capital_by_ticker?.length ? (
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <ReportCard st={st} title="Sector P&L" icon={<Layers size={16} />}>
            <SimpleMetricList
              st={st}
              rows={sectorPnl.map(row => ({
                label: row.sector,
                value: row.total_pnl,
                detail: `${row.closed_count} closed · ${row.open_count} open · ${money(row.capital)} capital`,
              }))}
            />
          </ReportCard>
          <ReportCard st={st} title="Current Capital by Ticker" icon={<DollarSign size={16} />}>
            <SimpleMetricList
              st={st}
              rows={(risk?.capital_by_ticker ?? []).map(row => ({
                label: row.ticker,
                value: row.value,
                detail: 'capital in open positions',
                neutralValue: true,
              }))}
            />
          </ReportCard>
        </section>
      ) : null}
    </div>
  )
}

function ActivityIcon() {
  return <BarChart3 size={16} />
}

function toneColor(st: Record<string, string>, tone: Tone): string {
  if (tone === 'good') return st.green
  if (tone === 'bad') return st.red
  if (tone === 'warn') return st.amber
  return st.text
}

function KpiCard({
  st,
  label,
  value,
  tone,
  icon,
  sub,
}: {
  st: Record<string, string>
  label: string
  value: string
  tone: Tone
  icon: React.ReactNode
  sub?: string
}) {
  const color = toneColor(st, tone)
  return (
    <div className="rounded-xl border p-3" style={{ background: st.bg, borderColor: st.border }}>
      <div className="mb-1 flex items-center gap-1.5">
        <span style={{ color: st.muted }}>{icon}</span>
        <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: st.muted }}>{label}</span>
      </div>
      <div className="font-mono text-xl font-bold tabular-nums" style={{ color }}>{value}</div>
      {sub ? <div className="mt-0.5 text-[10px]" style={{ color: st.muted }}>{sub}</div> : null}
    </div>
  )
}

function ReportCard({
  st,
  title,
  icon,
  children,
}: {
  st: Record<string, string>
  title: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border p-4" style={{ background: st.bg, borderColor: st.border }}>
      <div className="mb-3 flex items-center gap-2">
        <span style={{ color: st.muted }}>{icon}</span>
        <h2 className="text-sm font-bold" style={{ color: st.text }}>{title}</h2>
      </div>
      {children}
    </div>
  )
}

function ReportTable({
  st,
  rows,
  primaryLabel,
  limit,
  compact = false,
}: {
  st: Record<string, string>
  rows: ReportRow[]
  primaryLabel: string
  limit: number
  compact?: boolean
}) {
  const visibleRows = rows.slice(0, limit)
  if (visibleRows.length === 0) return <EmptyState st={st} />
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-left text-xs">
        <thead>
          <tr className="border-b" style={{ borderColor: st.border, color: st.muted }}>
            <th className="py-2 pr-3 text-[10px] font-bold uppercase tracking-wide">{primaryLabel}</th>
            <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wide">P&L</th>
            <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wide">Trades</th>
            <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wide">Win</th>
            {!compact && <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wide">Avg</th>}
            {!compact && <th className="pl-3 py-2 text-right text-[10px] font-bold uppercase tracking-wide">Risk</th>}
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row, index) => (
            <tr key={row.key} className="border-b last:border-0" style={{ borderColor: st.border, background: index % 2 === 0 ? st.bgSoft : st.bg }}>
              <td className="max-w-[220px] py-2 pr-3 font-semibold" style={{ color: st.text }}>
                <span className="line-clamp-1">{row.label}</span>
              </td>
              <td className="px-3 py-2 text-right font-mono font-bold tabular-nums" style={{ color: row.pnl >= 0 ? st.green : st.red }}>
                {money(row.pnl)}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums" style={{ color: st.text }}>
                {row.count}
                <span style={{ color: st.faint }}> · {row.wins}W/{row.losses}L</span>
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums" style={{ color: row.winRate >= 50 ? st.green : st.red }}>
                {pct(row.winRate)}
              </td>
              {!compact && (
                <td className="px-3 py-2 text-right font-mono tabular-nums" style={{ color: row.avgPnl >= 0 ? st.green : st.red }}>
                  {money(row.avgPnl)}
                </td>
              )}
              {!compact && (
                <td className="pl-3 py-2 text-right font-mono tabular-nums" style={{ color: st.muted }}>
                  {row.capital > 0 ? money(row.capital) : '—'}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > limit ? <div className="mt-2 text-[10px]" style={{ color: st.muted }}>Showing top {limit} of {rows.length} rows.</div> : null}
    </div>
  )
}

function SuggestionRow({
  st,
  title,
  detail,
  tone,
  icon,
}: {
  st: Record<string, string>
  title: string
  detail: string
  tone: Tone
  icon: React.ReactNode
}) {
  const color = toneColor(st, tone)
  return (
    <div className="rounded-lg border px-3 py-2.5" style={{ borderColor: `${color}55`, background: `${color}12` }}>
      <div className="mb-1 flex items-center gap-2">
        <span style={{ color }}>{icon}</span>
        <span className="text-xs font-bold" style={{ color }}>{title}</span>
      </div>
      <p className="text-xs leading-5" style={{ color: st.text }}>{detail}</p>
    </div>
  )
}

function PeriodList({ st, rows }: { st: Record<string, string>; rows: PnlByPeriod[] }) {
  if (rows.length === 0) return <EmptyState st={st} />
  return (
    <div className="space-y-1">
      {rows.slice(-8).map(row => (
        <div key={row.label} className="flex items-center justify-between rounded-lg px-2 py-1.5" style={{ background: st.bgSoft }}>
          <span className="text-xs font-semibold" style={{ color: st.text }}>{row.label}</span>
          <span className="font-mono text-xs font-bold tabular-nums" style={{ color: row.pnl >= 0 ? st.green : st.red }}>{money(row.pnl)}</span>
        </div>
      ))}
    </div>
  )
}

function SimpleMetricList({
  st,
  rows,
}: {
  st: Record<string, string>
  rows: Array<{ label: string; value: number; detail: string; neutralValue?: boolean }>
}) {
  if (rows.length === 0) return <EmptyState st={st} />
  return (
    <div className="space-y-1">
      {rows.slice(0, 10).map(row => (
        <div key={row.label} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5" style={{ background: st.bgSoft }}>
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold" style={{ color: st.text }}>{row.label}</div>
            <div className="truncate text-[10px]" style={{ color: st.muted }}>{row.detail}</div>
          </div>
          <div className="font-mono text-xs font-bold tabular-nums" style={{ color: row.neutralValue ? st.text : row.value >= 0 ? st.green : st.red }}>
            {money(row.value)}
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyState({ st }: { st: Record<string, string> }) {
  return (
    <div className="rounded-lg border border-dashed px-4 py-10 text-center text-xs" style={{ borderColor: st.border, color: st.muted }}>
      Close positions with realized P&L to populate this report.
    </div>
  )
}
