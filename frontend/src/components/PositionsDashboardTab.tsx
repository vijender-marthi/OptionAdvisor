import { useMemo, useState } from 'react'
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
  X,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
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
type PeriodReportRow = {
  key: string
  label: string
  pnl: number
  count: number
  wins: number
  losses: number
  cumulative?: number
  positions?: PortfolioPosition[]
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

function compactMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '--'
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  if (abs >= 1000000) return `${sign}$${(abs / 1000000).toFixed(1)}M`
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}K`
  return `${sign}$${abs.toFixed(0)}`
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

function parseExitDate(pos: PortfolioPosition): Date | null {
  if (!pos.exitDate) return null
  const d = new Date(pos.exitDate)
  return Number.isNaN(d.getTime()) ? null : d
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function weekStart(d: Date): Date {
  const start = new Date(d)
  const day = start.getDay()
  const diff = day === 0 ? -6 : 1 - day
  start.setDate(start.getDate() + diff)
  start.setHours(0, 0, 0, 0)
  return start
}

function periodRows(
  positions: PortfolioPosition[],
  keyFn: (d: Date) => string,
  labelFn: (d: Date) => string,
  limit: number,
): PeriodReportRow[] {
  const map = new Map<string, { date: Date; positions: PortfolioPosition[] }>()
  for (const pos of positions) {
    const date = parseExitDate(pos)
    if (!date) continue
    const key = keyFn(date)
    const existing = map.get(key)
    if (existing) {
      existing.positions.push(pos)
    } else {
      map.set(key, { date, positions: [pos] })
    }
  }
  return [...map.entries()]
    .sort((a, b) => a[1].date.getTime() - b[1].date.getTime())
    .slice(-limit)
    .reduce<PeriodReportRow[]>((acc, [key, row]) => {
      const pnl = row.positions.reduce((sum, pos) => sum + realizedPnl(pos), 0)
      const wins = row.positions.filter(pos => realizedPnl(pos) > 0).length
      const losses = row.positions.filter(pos => realizedPnl(pos) < 0).length
      const cumulative = (acc[acc.length - 1]?.cumulative ?? 0) + pnl
      acc.push({
        key,
        label: labelFn(row.date),
        pnl,
        count: row.positions.length,
        wins,
        losses,
        cumulative,
        positions: row.positions,
      })
      return acc
    }, [])
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

  const weeklyPerformance = useMemo(
    () => periodRows(
      closed,
      date => weekStart(date).toISOString().slice(0, 10),
      date => weekStart(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      12,
    ),
    [closed],
  )

  const monthlyPerformance = useMemo(() => {
    const fromPositions = periodRows(
      closed,
      monthKey,
      date => date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      8,
    )
    if (fromPositions.length > 0) return fromPositions
    return pnlByPeriod.slice(-8).reduce<PeriodReportRow[]>((acc, row) => {
      acc.push({
        key: row.label,
        label: row.label,
        pnl: row.pnl,
        count: 0,
        wins: 0,
        losses: 0,
        cumulative: (acc[acc.length - 1]?.cumulative ?? 0) + row.pnl,
      })
      return acc
    }, [])
  }, [closed, pnlByPeriod])

  const bestMonth = useMemo(() => [...monthlyPerformance].sort((a, b) => b.pnl - a.pnl)[0], [monthlyPerformance])
  const worstWeek = useMemo(() => [...weeklyPerformance].sort((a, b) => a.pnl - b.pnl)[0], [weeklyPerformance])

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

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <ReportCard st={st} title="Executive P&L Story" icon={<TrendingUp size={16} />}>
          <MonthlyEquityStory st={st} rows={monthlyPerformance} bestMonth={bestMonth} />
        </ReportCard>
        <ReportCard st={st} title="Weekly Performance Tape" icon={<BarChart3 size={16} />}>
          <WeeklyPerformanceTape st={st} rows={weeklyPerformance} worstWeek={worstWeek} />
        </ReportCard>
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
            <CapitalAllocationBars st={st} rows={risk?.capital_by_ticker ?? []} />
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

function MonthlyEquityStory({
  st,
  rows,
  bestMonth,
}: {
  st: Record<string, string>
  rows: PeriodReportRow[]
  bestMonth?: PeriodReportRow
}) {
  if (rows.length === 0) return <EmptyState st={st} />
  const total = rows.reduce((sum, row) => sum + row.pnl, 0)
  const last = rows[rows.length - 1]
  const positive = rows.filter(row => row.pnl > 0).length
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <StoryStat st={st} label="Net closed P&L" value={money(total)} tone={total >= 0 ? 'good' : 'bad'} />
        <StoryStat st={st} label="Best month" value={bestMonth ? `${bestMonth.label} ${money(bestMonth.pnl)}` : '--'} tone={(bestMonth?.pnl ?? 0) >= 0 ? 'good' : 'bad'} />
        <StoryStat st={st} label="Positive months" value={`${positive}/${rows.length}`} tone={positive >= rows.length / 2 ? 'good' : 'warn'} />
      </div>
      <div className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="monthlyPnlFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="5%" stopColor={st.blue} stopOpacity={0.28} />
                <stop offset="95%" stopColor={st.blue} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={st.border} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: st.muted, fontSize: 10 }} />
            <YAxis axisLine={false} tickLine={false} tick={{ fill: st.muted, fontSize: 10 }} tickFormatter={compactMoney} width={50} />
            <ReferenceLine y={0} stroke={st.faint} strokeWidth={1} />
            <Tooltip cursor={{ stroke: st.blue, strokeOpacity: 0.35 }} content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const row = payload[0].payload as PeriodReportRow
              return (
                <div className="rounded-lg border px-3 py-2 text-xs shadow-lg" style={{ background: st.bg, borderColor: st.border, color: st.text }}>
                  <div className="font-bold">{label}</div>
                  <div className="font-mono font-bold" style={{ color: row.pnl >= 0 ? st.green : st.red }}>Month {money(row.pnl, 2)}</div>
                  <div className="font-mono" style={{ color: st.muted }}>Cumulative {money(row.cumulative ?? row.pnl, 2)}</div>
                  {row.count > 0 ? <div style={{ color: st.muted }}>{row.count} trades · {row.wins}W/{row.losses}L</div> : null}
                </div>
              )
            }} />
            <Area type="monotone" dataKey="cumulative" stroke={st.blue} strokeWidth={2.5} fill="url(#monthlyPnlFill)" dot={{ r: 3, strokeWidth: 2, fill: st.bg, stroke: st.blue }} />
            <Line type="monotone" dataKey="pnl" stroke={st.muted} strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="text-xs leading-5" style={{ color: st.muted }}>
        The blue curve shows whether closed trades are compounding into a smoother equity path. The dotted line marks monthly P&L pressure.
        {last ? <span className="font-semibold" style={{ color: last.pnl >= 0 ? st.green : st.red }}> Latest: {last.label} {money(last.pnl)}.</span> : null}
      </div>
    </div>
  )
}

function tradeAction(pos: PortfolioPosition): string {
  if (pos.strategy === 'Stock') return 'Shares'
  const legs = Array.isArray(pos.legs) ? pos.legs.filter(Boolean) : []
  if (legs.length === 1) {
    const l = legs[0] as { action?: string; option_type?: string }
    return `${String(l.action || '').toUpperCase() === 'SELL' ? 'Sell' : 'Buy'} ${String(l.option_type || '').toUpperCase() === 'PUT' ? 'Put' : 'Call'}`
  }
  if (legs.length >= 2) return pos.strategy
  const s = (pos.strategy || '').toLowerCase()
  if (s.includes('covered call') || s.includes('short call')) return 'Sell Call'
  if (s.includes('cash') || s.includes('secured') || s.includes('short put')) return 'Sell Put'
  if (s.includes('put')) return 'Buy Put'
  if (s.includes('call')) return 'Buy Call'
  return pos.strategy || '—'
}

function tradeStrike(pos: PortfolioPosition): string {
  const legs = Array.isArray(pos.legs) ? pos.legs.filter(Boolean) : []
  const strikes = legs.map(l => (l as { strike?: number })?.strike).filter((s): s is number => s != null && Number.isFinite(s))
  if (strikes.length === 0) return '—'
  if (strikes.length === 1) return `$${strikes[0].toFixed(0)}`
  return `$${Math.min(...strikes).toFixed(0)}/${Math.max(...strikes).toFixed(0)}`
}

function tradeExp(pos: PortfolioPosition): string {
  const raw = pos.expiry || (pos.legs?.[0] as { expiry?: string } | undefined)?.expiry
  if (!raw) return '—'
  const m = String(raw).match(/(\d{4})-(\d{2})-(\d{2})/)
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(raw)
  return Number.isNaN(d.getTime()) ? String(raw) : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function WeeklyTradesModal({ st, row, onClose }: { st: Record<string, string>; row: PeriodReportRow; onClose: () => void }) {
  const trades = (row.positions ?? []).slice().sort((a, b) => realizedPnl(b) - realizedPnl(a))
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border shadow-2xl" style={{ borderColor: st.border, background: st.bg }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: st.border }}>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: st.muted }}>Week of {row.label} · {row.count} trades · {row.wins}W/{row.losses}L</div>
            <div className="font-mono text-xl font-black tabular-nums" style={{ color: row.pnl >= 0 ? st.green : st.red }}>{money(row.pnl, 2)}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5" style={{ color: st.muted }}>
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 text-[10px] uppercase tracking-wide" style={{ background: st.bgSoft, color: st.muted }}>
              <tr>
                <th className="px-3 py-2 text-left font-black">Ticker</th>
                <th className="px-3 py-2 text-left font-black">Action</th>
                <th className="px-3 py-2 text-right font-black">Strike</th>
                <th className="px-3 py-2 text-right font-black">Exp</th>
                <th className="px-3 py-2 text-right font-black">Qty</th>
                <th className="px-3 py-2 text-right font-black">P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((pos, i) => {
                const pnl = realizedPnl(pos)
                return (
                  <tr key={pos.id ?? i} className="border-t" style={{ borderColor: st.border }}>
                    <td className="px-3 py-2 font-mono font-bold" style={{ color: st.text }}>{pos.ticker}</td>
                    <td className="px-3 py-2 font-semibold" style={{ color: st.text }}>{tradeAction(pos)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums" style={{ color: st.text }}>{tradeStrike(pos)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums" style={{ color: st.muted }}>{tradeExp(pos)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums" style={{ color: st.muted }}>{pos.contracts ?? 1}</td>
                    <td className="px-3 py-2 text-right font-mono font-bold tabular-nums" style={{ color: pnl >= 0 ? st.green : st.red }}>{pnl >= 0 ? '+' : ''}{money(pnl, 2)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function WeeklyPerformanceTape({
  st,
  rows,
  worstWeek,
}: {
  st: Record<string, string>
  rows: PeriodReportRow[]
  worstWeek?: PeriodReportRow
}) {
  const [openWeek, setOpenWeek] = useState<PeriodReportRow | null>(null)
  if (rows.length === 0) return <EmptyState st={st} />
  const max = Math.max(...rows.map(row => Math.abs(row.pnl)), 1)
  const net = rows.reduce((sum, row) => sum + row.pnl, 0)
  const positiveWeeks = rows.filter(row => row.pnl > 0).length
  const negativeWeeks = rows.filter(row => row.pnl < 0).length
  const chartHeight = Math.max(230, rows.length * 34)
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: st.muted }}>Last {rows.length} weeks</div>
          <div className="font-mono text-2xl font-black tabular-nums" style={{ color: net >= 0 ? st.green : st.red }}>{money(net)}</div>
        </div>
        {worstWeek ? (
          <div className="rounded-lg border px-3 py-2 text-right" style={{ borderColor: st.border, background: st.bgSoft }}>
            <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: st.muted }}>Pressure week</div>
            <div className="font-mono text-sm font-bold" style={{ color: worstWeek.pnl >= 0 ? st.green : st.red }}>{worstWeek.label} {money(worstWeek.pnl)}</div>
          </div>
        ) : null}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <StoryStat st={st} label="Positive Weeks" value={String(positiveWeeks)} tone="good" />
        <StoryStat st={st} label="Negative Weeks" value={String(negativeWeeks)} tone={negativeWeeks > positiveWeeks ? 'bad' : 'neutral'} />
        <StoryStat st={st} label="Avg Week" value={money(net / rows.length)} tone={net >= 0 ? 'good' : 'bad'} />
      </div>
      <div className="rounded-xl border p-3" style={{ borderColor: st.border, background: st.bgSoft }}>
        <div style={{ height: chartHeight }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={rows}
              layout="vertical"
              margin={{ top: 8, right: 18, left: 10, bottom: 18 }}
              barCategoryGap={8}
            >
              <CartesianGrid stroke={st.border} strokeDasharray="3 3" horizontal={false} />
              <XAxis
                type="number"
                domain={[-max * 1.15, max * 1.15]}
                axisLine={false}
                tickLine={false}
                tick={{ fill: st.muted, fontSize: 10 }}
                tickFormatter={compactMoney}
              />
              <YAxis
                type="category"
                dataKey="label"
                axisLine={false}
                tickLine={false}
                width={58}
                tick={{ fill: st.text, fontSize: 11, fontWeight: 700 }}
              />
              <ReferenceLine x={0} stroke={st.faint} strokeWidth={1.5} />
              <Tooltip
                cursor={{ fill: `${st.blue}10` }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  const row = payload[0].payload as PeriodReportRow
                  return (
                    <div className="rounded-lg border px-3 py-2 text-xs shadow-lg" style={{ background: st.bg, borderColor: st.border, color: st.text }}>
                      <div className="font-bold">{label}</div>
                      <div className="font-mono font-bold" style={{ color: row.pnl >= 0 ? st.green : st.red }}>P&L {money(row.pnl, 2)}</div>
                      <div style={{ color: st.muted }}>{row.count} trades · {row.wins}W/{row.losses}L</div>
                    </div>
                  )
                }}
              />
              <Bar dataKey="pnl" radius={[5, 5, 5, 5]} maxBarSize={18} cursor="pointer"
                onClick={(_: unknown, index: number) => { const r = rows[index]; if (r) setOpenWeek(r) }}>
                {rows.map(row => (
                  <Cell key={row.key} fill={row.pnl >= 0 ? st.green : st.red} opacity={0.86} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="text-xs leading-5" style={{ color: st.muted }}>
        Click any week to see its trades — buy/sell, strike, expiration, and P&amp;L. Zero-centered scale keeps positive and negative weeks comparable.
      </div>
      {openWeek && <WeeklyTradesModal st={st} row={openWeek} onClose={() => setOpenWeek(null)} />}
    </div>
  )
}

function StoryStat({
  st,
  label,
  value,
  tone,
}: {
  st: Record<string, string>
  label: string
  value: string
  tone: Tone
}) {
  return (
    <div className="rounded-lg border px-3 py-2" style={{ borderColor: st.border, background: st.bgSoft }}>
      <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: st.muted }}>{label}</div>
      <div className="mt-1 truncate font-mono text-sm font-black tabular-nums" style={{ color: toneColor(st, tone) }}>{value}</div>
    </div>
  )
}

function PerformanceBars({
  st,
  rows,
  compact = false,
}: {
  st: Record<string, string>
  rows: PeriodReportRow[]
  compact?: boolean
}) {
  if (rows.length === 0) return <EmptyState st={st} />
  const total = rows.reduce((sum, row) => sum + row.pnl, 0)
  const wins = rows.filter(row => row.pnl > 0).length
  const losses = rows.filter(row => row.pnl < 0).length
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-wide" style={{ color: st.muted }}>
        <span className="rounded-full border px-2 py-1" style={{ borderColor: st.border, color: total >= 0 ? st.green : st.red }}>
          Net {money(total)}
        </span>
        <span>{wins} positive</span>
        <span>{losses} negative</span>
      </div>
      <div className={compact ? 'h-[210px]' : 'h-[250px]'}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={st.border} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fill: st.muted, fontSize: 10 }}
              interval={compact ? 'preserveStartEnd' : 0}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: st.muted, fontSize: 10 }}
              tickFormatter={compactMoney}
              width={48}
            />
            <ReferenceLine y={0} stroke={st.faint} strokeWidth={1} />
            <Tooltip
              cursor={{ fill: `${st.blue}10` }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null
                const row = payload[0].payload as PeriodReportRow
                return (
                  <div className="rounded-lg border px-3 py-2 text-xs shadow-lg" style={{ background: st.bg, borderColor: st.border, color: st.text }}>
                    <div className="font-bold">{label}</div>
                    <div className="font-mono font-bold tabular-nums" style={{ color: row.pnl >= 0 ? st.green : st.red }}>{money(row.pnl, 2)}</div>
                    {row.count > 0 ? <div style={{ color: st.muted }}>{row.count} trades · {row.wins}W/{row.losses}L</div> : null}
                  </div>
                )
              }}
            />
            <Bar dataKey="pnl" radius={[5, 5, 0, 0]}>
              {rows.map(row => (
                <Cell key={row.key} fill={row.pnl >= 0 ? st.green : st.red} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function CapitalAllocationBars({
  st,
  rows,
}: {
  st: Record<string, string>
  rows: Array<{ ticker: string; value: number }>
}) {
  const sorted = [...rows].sort((a, b) => b.value - a.value).slice(0, 10)
  if (sorted.length === 0) return <EmptyState st={st} />
  const total = sorted.reduce((sum, row) => sum + Math.max(0, safeNum(row.value)), 0)
  const max = Math.max(...sorted.map(row => Math.max(0, safeNum(row.value))), 1)
  return (
    <div className="space-y-2">
      {sorted.map(row => {
        const value = Math.max(0, safeNum(row.value))
        const width = `${Math.max(5, (value / max) * 100)}%`
        const share = total > 0 ? (value / total) * 100 : 0
        return (
          <div key={row.ticker} className="rounded-lg px-2 py-2" style={{ background: st.bgSoft }}>
            <div className="mb-1 flex items-center justify-between gap-3">
              <span className="font-mono text-xs font-bold" style={{ color: st.text }}>{row.ticker}</span>
              <span className="font-mono text-xs font-bold tabular-nums" style={{ color: st.text }}>{money(value)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full" style={{ background: st.border }}>
              <div className="h-full rounded-full" style={{ width, background: st.blue }} />
            </div>
            <div className="mt-1 text-[10px]" style={{ color: st.muted }}>{pct(share, 1)} of shown capital</div>
          </div>
        )
      })}
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
