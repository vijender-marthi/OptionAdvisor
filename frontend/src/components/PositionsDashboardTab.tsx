/**
 * Positions Center — Dashboard Tab
 *
 * Visualizes portfolio metrics with Recharts: P&L by sector, P&L by time period,
 * P&L by strategy, capital allocation, win rate, and actionable suggestions.
 */
import { useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, AreaChart, Area, ReferenceLine,
} from 'recharts'
import {
  TrendingUp, TrendingDown, PieChart as PieIcon, BarChart3, Target,
  AlertTriangle, Lightbulb, DollarSign, Percent, Activity, Layers,
} from 'lucide-react'
import type { PortfolioPosition } from '../types'

interface SectorPnl {
  sector: string; realized_pnl: number; unrealized_pnl: number
  total_pnl: number; open_count: number; closed_count: number; capital: number
}
interface PnlByPeriod { label: string; pnl: number }
interface PnlByStrategy {
  strategy: string; pnl: number; count: number; wins: number; win_rate: number
}
interface RiskData {
  by_underlying: { name: string; value: number }[]
  capital_by_strategy: { label: string; value: number }[]
  capital_by_engine: { engine: string; value: number }[]
  bullish_exposure: number; bearish_exposure: number
  options_exposure: number; stock_exposure: number
  concentration_risk: { top_ticker_pct: number }
}

interface Props {
  portfolio: PortfolioPosition[]
  sectorPnl: SectorPnl[]
  pnlByPeriod: PnlByPeriod[]
  pnlByStrategy: PnlByStrategy[]
  risk: RiskData | null
  summary: {
    total_pl?: number; day_pl?: number; day_pl_pct?: number
    week_pl?: number; week_pl_pct?: number
    total_open_positions?: number; options_positions?: number; stock_positions?: number
    total_capital_used?: number; options_capital?: number; stock_capital?: number
    closed_trades_count?: number
  } | null
  isDark: boolean
}

const GREEN = '#00A86B'
const RED = '#DC2626'
const AMBER = '#D4A017'
const BLUE = '#4A7CFF'
const VIOLET = '#7C5CFC'
const GRAY = '#6B7280'

const PIE_COLORS = [BLUE, VIOLET, GREEN, AMBER, RED, GRAY, '#06B6D4', '#F97316', '#8B5CF6', '#EC4899']

export default function PositionsDashboardTab({
  portfolio, sectorPnl, pnlByPeriod, pnlByStrategy, risk, summary, isDark,
}: Props) {
  const st = {
    bg:     isDark ? '#111318' : '#FFFFFF',
    bgDeep: isDark ? '#181C23' : '#F8F9FB',
    border: isDark ? '#1E2330' : '#E5E7EB',
    text:   isDark ? '#E8EBF0' : '#111827',
    muted:  isDark ? '#5A6478' : '#6B7280',
    green:  isDark ? '#00E5A0' : GREEN,
    red:    isDark ? '#FF4D6D' : RED,
    amber:  isDark ? '#F5A623' : AMBER,
  }

  const closedPositions = useMemo(() => portfolio.filter(p => p.status === 'closed'), [portfolio])
  const openPositions = useMemo(() => portfolio.filter(p => p.status === 'open'), [portfolio])

  const totalRealized = useMemo(() =>
    closedPositions.reduce((s, p) => s + (p.realized_pnl ?? 0), 0), [closedPositions])
  const totalWins = useMemo(() => closedPositions.filter(p => (p.realized_pnl ?? 0) > 0).length, [closedPositions])
  const totalLosses = closedPositions.length - totalWins
  const winRate = closedPositions.length > 0 ? (totalWins / closedPositions.length * 100) : 0
  const avgWin = totalWins > 0
    ? closedPositions.filter(p => (p.realized_pnl ?? 0) > 0).reduce((s, p) => s + (p.realized_pnl ?? 0), 0) / totalWins
    : 0
  const avgLoss = totalLosses > 0
    ? Math.abs(closedPositions.filter(p => (p.realized_pnl ?? 0) < 0).reduce((s, p) => s + (p.realized_pnl ?? 0), 0) / totalLosses)
    : 0
  const profitFactor = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? 99 : 0

  // Capital allocation pie data
  const capitalAllocation = useMemo(() => {
    if (!risk) return []
    return [
      { name: 'Options', value: risk.options_exposure || 0 },
      { name: 'Stocks', value: risk.stock_exposure || 0 },
    ].filter(d => d.value > 0)
  }, [risk])

  // Engine allocation
  const engineAllocation = useMemo(() => {
    if (!risk?.capital_by_engine) return []
    return risk.capital_by_engine.map(e => ({ name: e.engine, value: e.value }))
  }, [risk])

  // Bullish vs Bearish
  const biasAllocation = useMemo(() => {
    if (!risk) return []
    return [
      { name: 'Bullish', value: risk.bullish_exposure || 0 },
      { name: 'Bearish', value: risk.bearish_exposure || 0 },
    ].filter(d => d.value > 0)
  }, [risk])

  // Suggestions
  const suggestions = useMemo(() => {
    const out: { icon: React.ReactNode; text: string; tone: 'good' | 'warn' | 'bad' }[] = []

    // Win rate suggestion
    if (closedPositions.length >= 5) {
      if (winRate < 40) {
        out.push({ icon: <Target size={14} />, text: `Win rate is ${winRate.toFixed(0)}% — consider tightening entry criteria or requiring higher trade quality scores before entering.`, tone: 'bad' })
      } else if (winRate >= 60) {
        out.push({ icon: <Target size={14} />, text: `Win rate is ${winRate.toFixed(0)}% — excellent discipline. Consider slightly increasing position size on STRONG_GO setups.`, tone: 'good' })
      }
    }

    // Profit factor
    if (profitFactor > 0 && profitFactor < 1.0 && closedPositions.length >= 5) {
      out.push({ icon: <DollarSign size={14} />, text: `Profit factor is ${profitFactor.toFixed(2)} — your average loss exceeds your average win. Focus on cutting losers earlier and letting winners run.`, tone: 'bad' })
    } else if (profitFactor >= 2.0 && closedPositions.length >= 5) {
      out.push({ icon: <DollarSign size={14} />, text: `Profit factor is ${profitFactor.toFixed(2)} — excellent risk/reward. Your winners are ${profitFactor.toFixed(1)}× your losers.`, tone: 'good' })
    }

    // Concentration risk
    if (risk?.concentration_risk?.top_ticker_pct && risk.concentration_risk.top_ticker_pct > 30) {
      out.push({ icon: <AlertTriangle size={14} />, text: `${risk.concentration_risk.top_ticker_pct}% of capital is concentrated in a single ticker — consider diversifying to reduce single-name risk.`, tone: 'warn' })
    }

    // Sector concentration
    if (sectorPnl.length > 0) {
      const totalCap = sectorPnl.reduce((s, d) => s + d.capital, 0)
      if (totalCap > 0) {
        const top = sectorPnl[0]
        if (top.capital / totalCap > 0.5) {
          out.push({ icon: <Layers size={14} />, text: `${top.sector} sector holds ${((top.capital / totalCap) * 100).toFixed(0)}% of your capital — consider diversifying across sectors.`, tone: 'warn' })
        }
      }
    }

    // Best/worst sector
    if (sectorPnl.length >= 2) {
      const best = sectorPnl[0]
      const worst = sectorPnl[sectorPnl.length - 1]
      if (best.total_pnl > 0) {
        out.push({ icon: <TrendingUp size={14} />, text: `${best.sector} is your best sector (+$${best.total_pnl.toFixed(0)} P&L) — your edge is strongest here.`, tone: 'good' })
      }
      if (worst.total_pnl < 0) {
        out.push({ icon: <TrendingDown size={14} />, text: `${worst.sector} is your worst sector ($${worst.total_pnl.toFixed(0)} P&L) — review whether your strategy fits this sector or reduce exposure.`, tone: 'bad' })
      }
    }

    // Best/worst strategy
    if (pnlByStrategy.length >= 2) {
      const best = pnlByStrategy[0]
      const worst = pnlByStrategy[pnlByStrategy.length - 1]
      if (best.pnl > 0) {
        out.push({ icon: <BarChart3 size={14} />, text: `${best.strategy} is your most profitable strategy (+$${best.pnl.toFixed(0)}, ${best.win_rate}% win rate) — lean into this setup.`, tone: 'good' })
      }
      if (worst.pnl < 0) {
        out.push({ icon: <BarChart3 size={14} />, text: `${worst.strategy} is losing money ($${worst.pnl.toFixed(0)}, ${worst.win_rate}% win rate) — consider avoiding this strategy or refining entry criteria.`, tone: 'bad' })
      }
    }

    // Open position count
    if (openPositions.length > 10) {
      out.push({ icon: <Activity size={14} />, text: `You have ${openPositions.length} open positions — consider closing some to reduce management overhead and margin usage.`, tone: 'warn' })
    }

    // Recent P&L trend
    if (pnlByPeriod.length >= 3) {
      const last3 = pnlByPeriod.slice(-3)
      const recentSum = last3.reduce((s, d) => s + d.pnl, 0)
      if (recentSum < 0) {
        out.push({ icon: <TrendingDown size={14} />, text: `Last 3 weeks are net negative ($${recentSum.toFixed(0)}) — consider reducing position size until performance stabilizes.`, tone: 'bad' })
      } else if (recentSum > 0) {
        out.push({ icon: <TrendingUp size={14} />, text: `Last 3 weeks are net positive (+$${recentSum.toFixed(0)}) — momentum is building, stay disciplined.`, tone: 'good' })
      }
    }

    if (out.length === 0) {
      out.push({ icon: <Lightbulb size={14} />, text: 'Close a few positions to start building your performance analytics. The more trades you log, the better the suggestions become.', tone: 'warn' })
    }

    return out
  }, [closedPositions.length, openPositions.length, winRate, profitFactor, risk, sectorPnl, pnlByStrategy, pnlByPeriod])

  const tooltipStyle = {
    backgroundColor: st.bg,
    border: `1px solid ${st.border}`,
    borderRadius: 8,
    fontSize: 11,
    color: st.text,
  }

  return (
    <div className="space-y-4">
      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard st={st} label="Total Realized P&L" value={`$${totalRealized.toFixed(2)}`} tone={totalRealized >= 0 ? 'good' : 'bad'} icon={<DollarSign size={15} />} />
        <KpiCard st={st} label="Win Rate" value={`${winRate.toFixed(1)}%`} tone={winRate >= 50 ? 'good' : 'bad'} icon={<Percent size={15} />} sub={`${totalWins}W / ${totalLosses}L`} />
        <KpiCard st={st} label="Profit Factor" value={profitFactor >= 99 ? '∞' : profitFactor.toFixed(2)} tone={profitFactor >= 1.5 ? 'good' : 'bad'} icon={<Target size={15} />} sub={avgLoss > 0 ? `Avg W $${avgWin.toFixed(0)} / L $${avgLoss.toFixed(0)}` : `Avg W $${avgWin.toFixed(0)}`} />
        <KpiCard st={st} label="Open Positions" value={`${openPositions.length}`} tone="neutral" icon={<Activity size={15} />} sub={`${summary?.options_positions ?? 0} options · ${summary?.stock_positions ?? 0} stocks`} />
      </div>

      {/* Charts Row 1: P&L by Sector + P&L by Period */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* P&L by Sector */}
        <ChartCard st={st} title="P&L by Sector" icon={<Layers size={15} />}>
          {sectorPnl.length === 0 ? (
            <EmptyChart st={st} />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={sectorPnl} layout="vertical" margin={{ left: 10, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={st.border} />
                <XAxis type="number" stroke={st.muted} fontSize={10} tickFormatter={(v) => `$${v}`} />
                <YAxis type="category" dataKey="sector" stroke={st.muted} fontSize={10} width={90} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `$${v.toFixed(2)}`} />
                <ReferenceLine x={0} stroke={st.muted} />
                <Bar dataKey="realized_pnl" name="Realized" radius={[0, 4, 4, 0]}>
                  {sectorPnl.map((d, i) => (
                    <Cell key={i} fill={d.realized_pnl >= 0 ? st.green : st.red} />
                  ))}
                </Bar>
                <Bar dataKey="unrealized_pnl" name="Unrealized" radius={[0, 4, 4, 0]}>
                  {sectorPnl.map((d, i) => (
                    <Cell key={i} fill={d.unrealized_pnl >= 0 ? st.amber : st.red} fillOpacity={0.5} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
          {sectorPnl.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2 text-[10px]" style={{ color: st.muted }}>
              {sectorPnl.slice(0, 6).map(s => (
                <span key={s.sector} className="inline-flex items-center gap-1">
                  <span style={{ color: s.total_pnl >= 0 ? st.green : st.red, fontWeight: 600 }}>{s.sector}</span>
                  ${s.total_pnl.toFixed(0)} ({s.open_count}o/{s.closed_count}c)
                </span>
              ))}
            </div>
          )}
        </ChartCard>

        {/* P&L by Time Period */}
        <ChartCard st={st} title="P&L by Week (Last 8 Weeks)" icon={<TrendingUp size={15} />}>
          {pnlByPeriod.length === 0 ? (
            <EmptyChart st={st} />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={pnlByPeriod} margin={{ left: 10, right: 20 }}>
                <defs>
                  <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={st.green} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={st.green} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={st.border} />
                <XAxis dataKey="label" stroke={st.muted} fontSize={10} />
                <YAxis stroke={st.muted} fontSize={10} tickFormatter={(v) => `$${v}`} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `$${v.toFixed(2)}`} />
                <ReferenceLine y={0} stroke={st.muted} />
                <Area type="monotone" dataKey="pnl" name="Weekly P&L" stroke={st.green} strokeWidth={2} fill="url(#pnlGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Charts Row 2: Capital Allocation + P&L by Strategy */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Capital Allocation */}
        <ChartCard st={st} title="Capital Allocation" icon={<PieIcon size={15} />}>
          {capitalAllocation.length === 0 && engineAllocation.length === 0 ? (
            <EmptyChart st={st} />
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {capitalAllocation.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: st.muted }}>Options vs Stocks</div>
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie data={capitalAllocation} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60} fontSize={10}>
                        {capitalAllocation.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `$${v.toFixed(0)}`} />
                      <Legend wrapperStyle={{ fontSize: 10, color: st.muted }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
              {engineAllocation.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: st.muted }}>By Engine</div>
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie data={engineAllocation} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60} fontSize={10}>
                        {engineAllocation.map((_, i) => <Cell key={i} fill={PIE_COLORS[(i + 2) % PIE_COLORS.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `$${v.toFixed(0)}`} />
                      <Legend wrapperStyle={{ fontSize: 10, color: st.muted }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}
          {biasAllocation.length > 0 && (
            <div className="mt-3 flex items-center justify-center gap-6">
              <div className="text-center">
                <div className="text-[10px] uppercase tracking-wide" style={{ color: st.muted }}>Bullish</div>
                <div className="text-lg font-bold font-mono" style={{ color: st.green }}>${(risk?.bullish_exposure ?? 0).toFixed(0)}</div>
              </div>
              <div className="text-center">
                <div className="text-[10px] uppercase tracking-wide" style={{ color: st.muted }}>Bearish</div>
                <div className="text-lg font-bold font-mono" style={{ color: st.red }}>${(risk?.bearish_exposure ?? 0).toFixed(0)}</div>
              </div>
            </div>
          )}
        </ChartCard>

        {/* P&L by Strategy */}
        <ChartCard st={st} title="P&L by Strategy" icon={<BarChart3 size={15} />}>
          {pnlByStrategy.length === 0 ? (
            <EmptyChart st={st} />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={pnlByStrategy} layout="vertical" margin={{ left: 10, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={st.border} />
                  <XAxis type="number" stroke={st.muted} fontSize={10} tickFormatter={(v) => `$${v}`} />
                  <YAxis type="category" dataKey="strategy" stroke={st.muted} fontSize={9} width={110} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `$${v.toFixed(2)}`} />
                  <ReferenceLine x={0} stroke={st.muted} />
                  <Bar dataKey="pnl" name="P&L" radius={[0, 4, 4, 0]}>
                    {pnlByStrategy.map((d, i) => (
                      <Cell key={i} fill={d.pnl >= 0 ? st.green : st.red} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-2 space-y-1">
                {pnlByStrategy.slice(0, 5).map(s => (
                  <div key={s.strategy} className="flex items-center justify-between text-[10px]" style={{ color: st.muted }}>
                    <span style={{ color: st.text, fontWeight: 500 }}>{s.strategy}</span>
                    <span>
                      <span style={{ color: s.pnl >= 0 ? st.green : st.red, fontWeight: 600, fontFamily: 'monospace' }}>${s.pnl.toFixed(0)}</span>
                      {' · '}
                      {s.win_rate}% win ({s.count})
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </ChartCard>
      </div>

      {/* Suggestions Section */}
      <div className="rounded-xl border p-4" style={{ background: st.bg, borderColor: st.border }}>
        <div className="flex items-center gap-2 mb-3">
          <Lightbulb size={16} style={{ color: st.amber }} />
          <span className="text-sm font-bold" style={{ color: st.text }}>Suggestions</span>
          <span className="text-[10px] rounded-full px-2 py-0.5" style={{ background: `${st.amber}15`, color: st.amber, border: `1px solid ${st.amber}30` }}>
            {suggestions.length} insights
          </span>
        </div>
        <div className="space-y-2">
          {suggestions.map((s, i) => {
            const color = s.tone === 'good' ? st.green : s.tone === 'bad' ? st.red : st.amber
            const bg = s.tone === 'good' ? `${st.green}10` : s.tone === 'bad' ? `${st.red}10` : `${st.amber}10`
            return (
              <div key={i} className="flex items-start gap-2.5 rounded-lg px-3 py-2" style={{ background: bg, border: `1px solid ${color}25` }}>
                <span style={{ color, flexShrink: 0, marginTop: 1 }}>{s.icon}</span>
                <span className="text-[11.5px] leading-relaxed" style={{ color: st.text }}>{s.text}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function KpiCard({ st, label, value, tone, icon, sub }: {
  st: Record<string, string>; label: string; value: string; tone: 'good' | 'bad' | 'neutral'
  icon: React.ReactNode; sub?: string
}) {
  const color = tone === 'good' ? st.green : tone === 'bad' ? st.red : st.text
  return (
    <div className="rounded-xl border p-3" style={{ background: st.bg, borderColor: st.border }}>
      <div className="flex items-center gap-1.5 mb-1">
        <span style={{ color: st.muted }}>{icon}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: st.muted }}>{label}</span>
      </div>
      <div className="text-xl font-bold font-mono" style={{ color }}>{value}</div>
      {sub && <div className="text-[10px] mt-0.5" style={{ color: st.muted }}>{sub}</div>}
    </div>
  )
}

function ChartCard({ st, title, icon, children }: {
  st: Record<string, string>; title: string; icon: React.ReactNode; children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border p-4" style={{ background: st.bg, borderColor: st.border }}>
      <div className="flex items-center gap-2 mb-3">
        <span style={{ color: st.muted }}>{icon}</span>
        <span className="text-sm font-bold" style={{ color: st.text }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

function EmptyChart({ st }: { st: Record<string, string> }) {
  return (
    <div className="flex items-center justify-center" style={{ height: 200, color: st.muted, fontSize: 12 }}>
      No data yet — close positions to see analytics
    </div>
  )
}
