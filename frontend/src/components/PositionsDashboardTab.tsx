/**
 * Positions Center — Dashboard Tab
 *
 * Visualizes portfolio metrics with Recharts: P&L by sector, ticker, time period,
 * strategy, option category, exit reason (loss analysis), capital allocation,
 * win rate, and actionable suggestions.
 *
 * Loss analysis includes: P&L by exit reason (Stop loss vs Profit target vs Manual),
 * P&L by DTE bucket, P&L by option category, and attribution analysis
 * (Is the loss from DTE/theta decay or market turnaround?).
 */
import { useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, AreaChart, Area, ReferenceLine, ScatterChart, Scatter, ZAxis,
} from 'recharts'
import {
  TrendingUp, TrendingDown, PieChart as PieIcon, BarChart3, Target,
  AlertTriangle, Lightbulb, DollarSign, Percent, Activity, Layers,
  Clock, Calendar, Filter, ChevronDown, ChevronUp,
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
  capital_by_ticker: { ticker: string; value: number }[]
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
const CYAN = '#06B6D4'
const ORANGE = '#F97316'

const PIE_COLORS = [BLUE, VIOLET, GREEN, AMBER, RED, GRAY, CYAN, ORANGE, '#8B5CF6', '#EC4899']

export default function PositionsDashboardTab({
  portfolio, sectorPnl, pnlByPeriod, pnlByStrategy, risk, summary, isDark,
}: Props) {
  const [periodMode, setPeriodMode] = useState<'week' | 'month'>('week')
  const [lossExpanded, setLossExpanded] = useState(false)

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

  // ─── P&L by Ticker (from closed positions) ───────────────────────────────
  const pnlByTicker = useMemo(() => {
    const map: Record<string, { ticker: string; pnl: number; count: number; wins: number; gain: number; loss: number }> = {}
    for (const p of closedPositions) {
      const t = (p.ticker || '').toUpperCase()
      if (!t) continue
      if (!map[t]) map[t] = { ticker: t, pnl: 0, count: 0, wins: 0, gain: 0, loss: 0 }
      const realized = p.realized_pnl ?? 0
      map[t].pnl += realized
      map[t].count += 1
      if (realized > 0) { map[t].wins += 1; map[t].gain += realized }
      else if (realized < 0) { map[t].loss += realized }
    }
    return Object.values(map).sort((a, b) => b.pnl - a.pnl)
  }, [closedPositions])

  // ─── P&L by Ticker × Week ─────────────────────────────────────────────────
  const pnlByTickerWeek = useMemo(() => {
    const weekMap: Record<string, Record<string, number>> = {}  // ticker -> weekKey -> pnl
    const weekSet = new Map<string, string>()                    // weekKey -> weekLabel
    const allTickers = new Set<string>()

    for (const p of closedPositions) {
      const t = (p.ticker || '').toUpperCase()
      const ed = p.exitDate
      if (!t || !ed) continue
      const d = new Date(ed)
      if (isNaN(d.getTime())) continue
      const day = d.getDay()
      const monday = new Date(d)
      monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
      const weekKey = monday.toISOString().slice(0, 10)
      const weekLabel = monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      weekSet.set(weekKey, weekLabel)
      allTickers.add(t)
      if (!weekMap[t]) weekMap[t] = {}
      weekMap[t][weekKey] = (weekMap[t][weekKey] ?? 0) + (p.realized_pnl ?? 0)
    }

    const sortedWeeks = [...weekSet.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    const sortedTickers = [...allTickers].sort((a, b) => {
      const ta = Object.values(weekMap[a] || {}).reduce((s, v) => s + v, 0)
      const tb = Object.values(weekMap[b] || {}).reduce((s, v) => s + v, 0)
      return tb - ta
    })

    return { weekMap, sortedWeeks, sortedTickers }
  }, [closedPositions])

  // ─── P&L by Month (computed from closed positions) ───────────────────────
  const pnlByMonth = useMemo(() => {
    const map: Record<string, number> = {}
    for (const p of closedPositions) {
      const ed = p.exitDate
      if (!ed) continue
      const d = new Date(ed)
      if (isNaN(d.getTime())) continue
      const key = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
      map[key] = (map[key] ?? 0) + (p.realized_pnl ?? 0)
    }
    return Object.entries(map)
      .map(([label, pnl]) => ({ label, pnl: Math.round(pnl * 100) / 100 }))
      .sort((a, b) => {
        const [ma, ya] = a.label.split(' ')
        const [mb, yb] = b.label.split(' ')
        return (parseInt(ya) - parseInt(yb)) || (new Date(`${ma} 1`).getMonth() - new Date(`${mb} 1`).getMonth())
      })
  }, [closedPositions])

  // ─── P&L by Exit Reason (loss analysis) ──────────────────────────────────
  const pnlByExitReason = useMemo(() => {
    const map: Record<string, { reason: string; pnl: number; count: number }> = {}
    for (const p of closedPositions) {
      const reason = p.exit_reason || 'Manual exit'
      if (!map[reason]) map[reason] = { reason, pnl: 0, count: 0 }
      map[reason].pnl += p.realized_pnl ?? 0
      map[reason].count += 1
    }
    return Object.values(map).sort((a, b) => a.pnl - b.pnl)
  }, [closedPositions])

  // ─── P&L by Option Category ──────────────────────────────────────────────
  const pnlByOptionCategory = useMemo(() => {
    const map: Record<string, { category: string; pnl: number; count: number; wins: number }> = {}
    for (const p of closedPositions) {
      const strat = p.strategy || 'Unknown'
      let cat: string
      if (strat === 'Stock') cat = 'Stock'
      else if (strat.includes('Long Call')) cat = 'Long Call'
      else if (strat.includes('Long Put')) cat = 'Long Put'
      else if (strat.includes('Bull Call') || strat.includes('Bear Put')) cat = 'Debit Spread'
      else if (strat.includes('Bull Put') || strat.includes('Bear Call')) cat = 'Credit Spread'
      else if (strat.includes('Iron Condor') || strat.includes('Iron Butterfly')) cat = 'Iron Condor'
      else if (strat.includes('Straddle') || strat.includes('Strangle')) cat = 'Volatility'
      else if (strat.includes('Calendar') || strat.includes('Diagonal')) cat = 'Calendar'
      else if (strat.includes('Covered')) cat = 'Covered'
      else if (strat.includes('Short')) cat = 'Naked Short'
      else cat = 'Other'
      if (!map[cat]) map[cat] = { category: cat, pnl: 0, count: 0, wins: 0 }
      map[cat].pnl += p.realized_pnl ?? 0
      map[cat].count += 1
      if ((p.realized_pnl ?? 0) > 0) map[cat].wins += 1
    }
    return Object.values(map).sort((a, b) => b.pnl - a.pnl)
  }, [closedPositions])

  // ─── P&L by DTE Bucket (loss attribution: is it theta/DTE?) ──────────────
  const pnlByDteBucket = useMemo(() => {
    const buckets = [
      { label: '0-7d', lo: 0, hi: 7 },
      { label: '8-14d', lo: 8, hi: 14 },
      { label: '15-21d', lo: 15, hi: 21 },
      { label: '22-30d', lo: 22, hi: 30 },
      { label: '31-45d', lo: 31, hi: 45 },
      { label: '46+d', lo: 46, hi: 999 },
    ]
    return buckets.map(b => {
      const trades = closedPositions.filter(p => {
        const dte = p.dte ?? 0
        return dte >= b.lo && dte <= b.hi
      })
      const pnl = trades.reduce((s, p) => s + (p.realized_pnl ?? 0), 0)
      const wins = trades.filter(p => (p.realized_pnl ?? 0) > 0).length
      return { label: b.label, pnl: Math.round(pnl * 100) / 100, count: trades.length, wins, win_rate: trades.length > 0 ? Math.round(wins / trades.length * 100) : 0 }
    }).filter(b => b.count > 0)
  }, [closedPositions])

  // ─── P&L by Bias (loss attribution: is it market turnaround?) ────────────
  const pnlByBias = useMemo(() => {
    const map: Record<string, { bias: string; pnl: number; count: number; wins: number }> = {}
    for (const p of closedPositions) {
      const bias = p.bias || 'Neutral'
      if (!map[bias]) map[bias] = { bias, pnl: 0, count: 0, wins: 0 }
      map[bias].pnl += p.realized_pnl ?? 0
      map[bias].count += 1
      if ((p.realized_pnl ?? 0) > 0) map[bias].wins += 1
    }
    return Object.values(map).sort((a, b) => b.pnl - a.pnl)
  }, [closedPositions])

  // ─── P&L by Source (Day vs Swing vs Regular) ─────────────────────────────
  const pnlBySource = useMemo(() => {
    const map: Record<string, { source: string; pnl: number; count: number; wins: number }> = {}
    for (const p of closedPositions) {
      const src = (p.source || 'manual').charAt(0).toUpperCase() + (p.source || 'manual').slice(1)
      if (!map[src]) map[src] = { source: src, pnl: 0, count: 0, wins: 0 }
      map[src].pnl += p.realized_pnl ?? 0
      map[src].count += 1
      if ((p.realized_pnl ?? 0) > 0) map[src].wins += 1
    }
    return Object.values(map).sort((a, b) => b.pnl - a.pnl)
  }, [closedPositions])

  // ─── DTE vs P&L scatter (loss attribution: DTE vs market) ────────────────
  const dteVsPnlScatter = useMemo(() => {
    return closedPositions
      .filter(p => p.dte != null && p.realized_pnl != null)
      .map(p => ({ dte: p.dte ?? 0, pnl: p.realized_pnl ?? 0, ticker: p.ticker, reason: p.exit_reason || 'Manual' }))
  }, [closedPositions])

  // ─── Loss attribution analysis ───────────────────────────────────────────
  const lossAnalysis = useMemo(() => {
    const losers = closedPositions.filter(p => (p.realized_pnl ?? 0) < 0)
    if (losers.length === 0) return null
    const totalLoss = losers.reduce((s, p) => s + Math.abs(p.realized_pnl ?? 0), 0)

    // By exit reason
    const byReason: Record<string, number> = {}
    for (const p of losers) {
      const r = p.exit_reason || 'Manual exit'
      byReason[r] = (byReason[r] ?? 0) + Math.abs(p.realized_pnl ?? 0)
    }
    const topReason = Object.entries(byReason).sort((a, b) => b[1] - a[1])[0]

    // By DTE
    const shortDteLoss = losers.filter(p => (p.dte ?? 0) <= 14).reduce((s, p) => s + Math.abs(p.realized_pnl ?? 0), 0)
    const longDteLoss = losers.filter(p => (p.dte ?? 0) > 30).reduce((s, p) => s + Math.abs(p.realized_pnl ?? 0), 0)
    const shortDtePct = totalLoss > 0 ? (shortDteLoss / totalLoss * 100) : 0
    const longDtePct = totalLoss > 0 ? (longDteLoss / totalLoss * 100) : 0

    // By bias (market turnaround)
    const bullLoss = losers.filter(p => (p.bias || '').toLowerCase().includes('bull')).reduce((s, p) => s + Math.abs(p.realized_pnl ?? 0), 0)
    const bearLoss = losers.filter(p => (p.bias || '').toLowerCase().includes('bear')).reduce((s, p) => s + Math.abs(p.realized_pnl ?? 0), 0)
    const bullPct = totalLoss > 0 ? (bullLoss / totalLoss * 100) : 0
    const bearPct = totalLoss > 0 ? (bearLoss / totalLoss * 100) : 0

    // Diagnosis
    let diagnosis = ''
    let diagnosisTone: 'dte' | 'market' | 'mixed' | 'stop' = 'mixed'
    if (topReason && topReason[0].toLowerCase().includes('stop')) {
      diagnosis = `Most losses (${Math.round(topReason[1] / totalLoss * 100)}%) came from stop-loss hits — this suggests your stops are working (limiting damage) but your entry timing may need improvement.`
      diagnosisTone = 'stop'
    } else if (shortDtePct > 50) {
      diagnosis = `${Math.round(shortDtePct)}% of losses came from trades with DTE ≤ 14 — theta decay and gamma risk are the primary drivers. Consider using longer-dated options (21+ DTE) or debit spreads to reduce theta impact.`
      diagnosisTone = 'dte'
    } else if (bullPct > 60 || bearPct > 60) {
      const side = bullPct > 60 ? 'bullish' : 'bearish'
      diagnosis = `${Math.round(Math.max(bullPct, bearPct))}% of losses came from ${side} positions — the market turned against your bias. Consider checking broad market context (SPY/QQQ/VIX) more carefully before entering, and use smaller position size when the market trend is unclear.`
      diagnosisTone = 'market'
    } else {
      diagnosis = `Losses are spread across multiple factors — no single dominant cause. Focus on overall trade quality (higher score thresholds) and consistent risk management.`
      diagnosisTone = 'mixed'
    }

    return { totalLoss, byReason, topReason, shortDtePct, longDtePct, bullPct, bearPct, diagnosis, diagnosisTone, loserCount: losers.length }
  }, [closedPositions])

  // ─── Capital allocation ──────────────────────────────────────────────────
  const capitalAllocation = useMemo(() => {
    if (!risk) return []
    return [
      { name: 'Options', value: risk.options_exposure || 0 },
      { name: 'Stocks', value: risk.stock_exposure || 0 },
    ].filter(d => d.value > 0)
  }, [risk])

  const engineAllocation = useMemo(() => {
    if (!risk?.capital_by_engine) return []
    return risk.capital_by_engine.map(e => ({ name: e.engine, value: e.value }))
  }, [risk])

  const biasAllocation = useMemo(() => {
    if (!risk) return []
    return [
      { name: 'Bullish', value: risk.bullish_exposure || 0 },
      { name: 'Bearish', value: risk.bearish_exposure || 0 },
    ].filter(d => d.value > 0)
  }, [risk])

  // ─── Suggestions ─────────────────────────────────────────────────────────
  const suggestions = useMemo(() => {
    const out: { icon: React.ReactNode; text: string; tone: 'good' | 'warn' | 'bad' }[] = []

    if (closedPositions.length >= 5) {
      if (winRate < 40) {
        out.push({ icon: <Target size={14} />, text: `Win rate is ${winRate.toFixed(0)}% — consider tightening entry criteria or requiring higher trade quality scores before entering.`, tone: 'bad' })
      } else if (winRate >= 60) {
        out.push({ icon: <Target size={14} />, text: `Win rate is ${winRate.toFixed(0)}% — excellent discipline. Consider slightly increasing position size on STRONG_GO setups.`, tone: 'good' })
      }
    }

    if (profitFactor > 0 && profitFactor < 1.0 && closedPositions.length >= 5) {
      out.push({ icon: <DollarSign size={14} />, text: `Profit factor is ${profitFactor.toFixed(2)} — your average loss exceeds your average win. Focus on cutting losers earlier and letting winners run.`, tone: 'bad' })
    } else if (profitFactor >= 2.0 && closedPositions.length >= 5) {
      out.push({ icon: <DollarSign size={14} />, text: `Profit factor is ${profitFactor.toFixed(2)} — excellent risk/reward. Your winners are ${profitFactor.toFixed(1)}× your losers.`, tone: 'good' })
    }

    if (risk?.concentration_risk?.top_ticker_pct && risk.concentration_risk.top_ticker_pct > 30) {
      out.push({ icon: <AlertTriangle size={14} />, text: `${risk.concentration_risk.top_ticker_pct}% of capital is concentrated in a single ticker — consider diversifying to reduce single-name risk.`, tone: 'warn' })
    }

    if (sectorPnl.length > 0) {
      const totalCap = sectorPnl.reduce((s, d) => s + d.capital, 0)
      if (totalCap > 0) {
        const top = sectorPnl[0]
        if (top.capital / totalCap > 0.5) {
          out.push({ icon: <Layers size={14} />, text: `${top.sector} sector holds ${((top.capital / totalCap) * 100).toFixed(0)}% of your capital — consider diversifying across sectors.`, tone: 'warn' })
        }
      }
    }

    if (sectorPnl.length >= 2) {
      const best = sectorPnl[0]
      const worst = sectorPnl[sectorPnl.length - 1]
      if (best.total_pnl > 0) out.push({ icon: <TrendingUp size={14} />, text: `${best.sector} is your best sector (+$${best.total_pnl.toFixed(0)} P&L) — your edge is strongest here.`, tone: 'good' })
      if (worst.total_pnl < 0) out.push({ icon: <TrendingDown size={14} />, text: `${worst.sector} is your worst sector ($${worst.total_pnl.toFixed(0)} P&L) — review whether your strategy fits this sector or reduce exposure.`, tone: 'bad' })
    }

    if (pnlByStrategy.length >= 2) {
      const best = pnlByStrategy[0]
      const worst = pnlByStrategy[pnlByStrategy.length - 1]
      if (best.pnl > 0) out.push({ icon: <BarChart3 size={14} />, text: `${best.strategy} is your most profitable strategy (+$${best.pnl.toFixed(0)}, ${best.win_rate}% win rate) — lean into this setup.`, tone: 'good' })
      if (worst.pnl < 0) out.push({ icon: <BarChart3 size={14} />, text: `${worst.strategy} is losing money ($${worst.pnl.toFixed(0)}, ${worst.win_rate}% win rate) — consider avoiding this strategy or refining entry criteria.`, tone: 'bad' })
    }

    // Ticker-level suggestion
    if (pnlByTicker.length >= 2) {
      const best = pnlByTicker[0]
      const worst = pnlByTicker[pnlByTicker.length - 1]
      if (best.pnl > 0) out.push({ icon: <TrendingUp size={14} />, text: `${best.ticker} is your best ticker (+$${best.pnl.toFixed(0)}, ${best.wins}/${best.count} wins) — your read on this name is strong.`, tone: 'good' })
      if (worst.pnl < 0) out.push({ icon: <TrendingDown size={14} />, text: `${worst.ticker} is your worst ticker ($${worst.pnl.toFixed(0)}, ${worst.wins}/${worst.count} wins) — consider reducing or avoiding this name until your edge improves.`, tone: 'bad' })
    }

    // DTE suggestion
    if (pnlByDteBucket.length >= 2) {
      const bestDte = [...pnlByDteBucket].sort((a, b) => b.pnl - a.pnl)[0]
      const worstDte = [...pnlByDteBucket].sort((a, b) => a.pnl - b.pnl)[0]
      if (bestDte.pnl > 0 && worstDte.pnl < 0) {
        out.push({ icon: <Clock size={14} />, text: `${bestDte.label} DTE bucket is profitable (+$${bestDte.pnl.toFixed(0)}, ${bestDte.win_rate}% win) while ${worstDte.label} is losing ($${worstDte.pnl.toFixed(0)}) — consider shifting toward ${bestDte.label} expiries.`, tone: 'warn' })
      }
    }

    // Loss analysis suggestion
    if (lossAnalysis?.diagnosis) {
      out.push({ icon: <AlertTriangle size={14} />, text: lossAnalysis.diagnosis, tone: lossAnalysis.diagnosisTone === 'stop' ? 'warn' : 'bad' })
    }

    if (openPositions.length > 10) {
      out.push({ icon: <Activity size={14} />, text: `You have ${openPositions.length} open positions — consider closing some to reduce management overhead and margin usage.`, tone: 'warn' })
    }

    const periodData = periodMode === 'week' ? pnlByPeriod : pnlByMonth
    if (periodData.length >= 3) {
      const last3 = periodData.slice(-3)
      const recentSum = last3.reduce((s, d) => s + d.pnl, 0)
      if (recentSum < 0) {
        out.push({ icon: <TrendingDown size={14} />, text: `Last 3 ${periodMode}s are net negative ($${recentSum.toFixed(0)}) — consider reducing position size until performance stabilizes.`, tone: 'bad' })
      } else if (recentSum > 0) {
        out.push({ icon: <TrendingUp size={14} />, text: `Last 3 ${periodMode}s are net positive (+$${recentSum.toFixed(0)}) — momentum is building, stay disciplined.`, tone: 'good' })
      }
    }

    if (out.length === 0) {
      out.push({ icon: <Lightbulb size={14} />, text: 'Close a few positions to start building your performance analytics. The more trades you log, the better the suggestions become.', tone: 'warn' })
    }

    return out
  }, [closedPositions.length, openPositions.length, winRate, profitFactor, risk, sectorPnl, pnlByStrategy, pnlByPeriod, pnlByMonth, pnlByTicker, pnlByDteBucket, lossAnalysis, periodMode])

  const tooltipStyle = {
    backgroundColor: st.bg,
    border: `1px solid ${st.border}`,
    borderRadius: 8,
    fontSize: 11,
    color: st.text,
  }

  const periodData = periodMode === 'week' ? pnlByPeriod : pnlByMonth

  return (
    <div className="space-y-4">
      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard st={st} label="Total Realized P&L" value={`$${totalRealized.toFixed(2)}`} tone={totalRealized >= 0 ? 'good' : 'bad'} icon={<DollarSign size={15} />} />
        <KpiCard st={st} label="Win Rate" value={`${winRate.toFixed(1)}%`} tone={winRate >= 50 ? 'good' : 'bad'} icon={<Percent size={15} />} sub={`${totalWins}W / ${totalLosses}L`} />
        <KpiCard st={st} label="Profit Factor" value={profitFactor >= 99 ? '∞' : profitFactor.toFixed(2)} tone={profitFactor >= 1.5 ? 'good' : 'bad'} icon={<Target size={15} />} sub={avgLoss > 0 ? `Avg W $${avgWin.toFixed(0)} / L $${avgLoss.toFixed(0)}` : `Avg W $${avgWin.toFixed(0)}`} />
        <KpiCard st={st} label="Open Positions" value={`${openPositions.length}`} tone="neutral" icon={<Activity size={15} />} sub={`${summary?.options_positions ?? 0} options · ${summary?.stock_positions ?? 0} stocks`} />
      </div>

      {/* Charts Row 1: P&L by Ticker + P&L by Period (week/month toggle) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* P&L by Ticker */}
        <ChartCard st={st} title="P&L by Ticker" icon={<BarChart3 size={15} />}>
          {pnlByTicker.length === 0 ? (
            <EmptyChart st={st} />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={Math.max(200, pnlByTicker.length * 28)}>
                <BarChart data={pnlByTicker.slice(0, 15)} layout="vertical" margin={{ left: 10, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={st.border} />
                  <XAxis type="number" stroke={st.muted} fontSize={10} tickFormatter={(v) => `$${v}`} />
                  <YAxis type="category" dataKey="ticker" stroke={st.muted} fontSize={10} width={60} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `$${v.toFixed(2)}`} />
                  <ReferenceLine x={0} stroke={st.muted} />
                  <Bar dataKey="pnl" name="P&L" radius={[0, 4, 4, 0]}>
                    {pnlByTicker.slice(0, 15).map((d, i) => (
                      <Cell key={i} fill={d.pnl >= 0 ? st.green : st.red} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              {pnlByTicker.length > 15 && (
                <div className="text-[10px] mt-1" style={{ color: st.muted }}>Showing top 15 of {pnlByTicker.length} tickers</div>
              )}
              {/* Gain / Loss breakdown table */}
              <div className="mt-3 border-t pt-3" style={{ borderColor: st.border }}>
                <div className="text-[10px] font-semibold uppercase tracking-wide mb-2" style={{ color: st.muted }}>Gain / Loss Breakdown</div>
                <div className="grid text-[10px] font-semibold mb-1 px-1" style={{ gridTemplateColumns: '56px 1fr 1fr 1fr 40px', color: st.muted }}>
                  <span>Ticker</span><span className="text-right">Gain</span><span className="text-right">Loss</span><span className="text-right">Net</span><span className="text-right">W/L</span>
                </div>
                <div className="space-y-0.5">
                  {pnlByTicker.slice(0, 15).map((t, ri) => (
                    <div key={t.ticker} className="grid text-[10px] rounded px-1 py-0.5" style={{
                      gridTemplateColumns: '56px 1fr 1fr 1fr 40px',
                      background: ri % 2 === 0 ? `${st.bgDeep}` : 'transparent',
                    }}>
                      <span className="font-mono font-bold" style={{ color: st.text }}>{t.ticker}</span>
                      <span className="text-right font-mono" style={{ color: st.green }}>{t.gain > 0 ? `+$${t.gain.toFixed(0)}` : '—'}</span>
                      <span className="text-right font-mono" style={{ color: st.red }}>{t.loss < 0 ? `-$${Math.abs(t.loss).toFixed(0)}` : '—'}</span>
                      <span className="text-right font-mono font-bold" style={{ color: t.pnl >= 0 ? st.green : st.red }}>{t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(0)}</span>
                      <span className="text-right" style={{ color: st.muted }}>{t.wins}/{t.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </ChartCard>

        {/* P&L by Period (week/month toggle) */}
        <ChartCard st={st} title={`P&L by ${periodMode === 'week' ? 'Week' : 'Month'}`} icon={<Calendar size={15} />}
          headerRight={
            <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: st.border }}>
              <button onClick={() => setPeriodMode('week')} style={{
                padding: '2px 10px', fontSize: 10, fontWeight: 600, cursor: 'pointer',
                background: periodMode === 'week' ? st.bgDeep : 'transparent',
                color: periodMode === 'week' ? st.text : st.muted,
                border: 'none',
              }}>Week</button>
              <button onClick={() => setPeriodMode('month')} style={{
                padding: '2px 10px', fontSize: 10, fontWeight: 600, cursor: 'pointer',
                background: periodMode === 'month' ? st.bgDeep : 'transparent',
                color: periodMode === 'month' ? st.text : st.muted,
                border: 'none', borderLeft: `1px solid ${st.border}`,
              }}>Month</button>
            </div>
          }
        >
          {periodData.length === 0 ? (
            <EmptyChart st={st} />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={periodData} margin={{ left: 10, right: 20 }}>
                <defs>
                  <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={st.green} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={st.green} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={st.border} />
                <XAxis dataKey="label" stroke={st.muted} fontSize={10} />
                <YAxis stroke={st.muted} fontSize={10} tickFormatter={(v) => `$${v}`} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `$${v.toFixed(2)}`} />
                <ReferenceLine y={0} stroke={st.muted} />
                <Area type="monotone" dataKey="pnl" name={periodMode === 'week' ? 'Weekly P&L' : 'Monthly P&L'} stroke={st.green} strokeWidth={2} fill="url(#pnlGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Ticker × Week P&L Matrix */}
      {pnlByTickerWeek.sortedTickers.length > 0 && (
        <div className="rounded-xl border p-4 overflow-x-auto" style={{ background: st.bg, borderColor: st.border }}>
          <div className="flex items-center gap-2 mb-3">
            <Calendar size={15} style={{ color: st.muted }} />
            <span className="text-sm font-bold" style={{ color: st.text }}>P&L by Ticker × Week</span>
            <span className="text-[10px] rounded-full px-2 py-0.5" style={{ background: `${BLUE}15`, color: BLUE, border: `1px solid ${BLUE}30` }}>
              {pnlByTickerWeek.sortedTickers.length} tickers · {pnlByTickerWeek.sortedWeeks.length} weeks
            </span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${st.border}` }}>
                <th style={{ textAlign: 'left', padding: '5px 8px', color: st.muted, fontWeight: 600, position: 'sticky', left: 0, background: st.bg, minWidth: 64, whiteSpace: 'nowrap' }}>Ticker</th>
                {pnlByTickerWeek.sortedWeeks.map(([key, label]) => (
                  <th key={key} style={{ textAlign: 'right', padding: '5px 8px', color: st.muted, fontWeight: 600, whiteSpace: 'nowrap', minWidth: 78 }}>
                    {label}
                  </th>
                ))}
                <th style={{ textAlign: 'right', padding: '5px 8px', color: st.text, fontWeight: 700, whiteSpace: 'nowrap', minWidth: 78 }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {pnlByTickerWeek.sortedTickers.map((ticker, ri) => {
                const row = pnlByTickerWeek.weekMap[ticker] || {}
                const total = Object.values(row).reduce((s, v) => s + v, 0)
                const rowBg = ri % 2 === 0 ? st.bgDeep : st.bg
                return (
                  <tr key={ticker} style={{ background: rowBg }}>
                    <td style={{ padding: '5px 8px', fontFamily: 'monospace', fontWeight: 700, color: st.text, position: 'sticky', left: 0, background: rowBg, whiteSpace: 'nowrap' }}>
                      {ticker}
                    </td>
                    {pnlByTickerWeek.sortedWeeks.map(([key]) => {
                      const v = row[key]
                      if (v == null) return (
                        <td key={key} style={{ textAlign: 'right', padding: '5px 8px', color: st.muted }}>—</td>
                      )
                      const cellColor = v >= 0 ? st.green : st.red
                      const cellBg = v >= 0 ? `${st.green}12` : `${st.red}12`
                      return (
                        <td key={key} style={{ textAlign: 'right', padding: '5px 8px', fontFamily: 'monospace', fontWeight: 600, color: cellColor, background: cellBg, borderRadius: 4 }}>
                          {v >= 0 ? '+' : ''}${Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'k' : v.toFixed(0)}
                        </td>
                      )
                    })}
                    <td style={{ textAlign: 'right', padding: '5px 8px', fontFamily: 'monospace', fontWeight: 700, color: total >= 0 ? st.green : st.red, borderLeft: `1px solid ${st.border}` }}>
                      {total >= 0 ? '+' : ''}${total.toFixed(0)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            {/* Totals row */}
            <tfoot>
              <tr style={{ borderTop: `1px solid ${st.border}` }}>
                <td style={{ padding: '5px 8px', fontWeight: 700, color: st.muted, fontSize: 10, position: 'sticky', left: 0, background: st.bg }}>Week total</td>
                {pnlByTickerWeek.sortedWeeks.map(([key]) => {
                  const weekTotal = pnlByTickerWeek.sortedTickers.reduce((s, t) => s + (pnlByTickerWeek.weekMap[t]?.[key] ?? 0), 0)
                  return (
                    <td key={key} style={{ textAlign: 'right', padding: '5px 8px', fontFamily: 'monospace', fontWeight: 700, color: weekTotal >= 0 ? st.green : st.red }}>
                      {weekTotal >= 0 ? '+' : ''}${weekTotal.toFixed(0)}
                    </td>
                  )
                })}
                <td style={{ textAlign: 'right', padding: '5px 8px', fontFamily: 'monospace', fontWeight: 700,
                  color: pnlByTickerWeek.sortedTickers.reduce((s, t) => s + Object.values(pnlByTickerWeek.weekMap[t] || {}).reduce((a, v) => a + v, 0), 0) >= 0 ? st.green : st.red,
                  borderLeft: `1px solid ${st.border}`,
                }}>
                  {(() => { const g = pnlByTickerWeek.sortedTickers.reduce((s, t) => s + Object.values(pnlByTickerWeek.weekMap[t] || {}).reduce((a, v) => a + v, 0), 0); return `${g >= 0 ? '+' : ''}$${g.toFixed(0)}` })()}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Charts Row 2: P&L by Sector + P&L by Option Category */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard st={st} title="P&L by Sector" icon={<Layers size={15} />}>
          {sectorPnl.length === 0 ? <EmptyChart st={st} /> : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={sectorPnl} layout="vertical" margin={{ left: 10, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={st.border} />
                <XAxis type="number" stroke={st.muted} fontSize={10} tickFormatter={(v) => `$${v}`} />
                <YAxis type="category" dataKey="sector" stroke={st.muted} fontSize={10} width={90} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `$${v.toFixed(2)}`} />
                <ReferenceLine x={0} stroke={st.muted} />
                <Bar dataKey="realized_pnl" name="Realized" radius={[0, 4, 4, 0]}>
                  {sectorPnl.map((d, i) => <Cell key={i} fill={d.realized_pnl >= 0 ? st.green : st.red} />)}
                </Bar>
                <Bar dataKey="unrealized_pnl" name="Unrealized" radius={[0, 4, 4, 0]}>
                  {sectorPnl.map((d, i) => <Cell key={i} fill={d.unrealized_pnl >= 0 ? st.amber : st.red} fillOpacity={0.5} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard st={st} title="P&L by Option Category" icon={<PieIcon size={15} />}>
          {pnlByOptionCategory.length === 0 ? <EmptyChart st={st} /> : (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={pnlByOptionCategory} margin={{ left: 10, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={st.border} />
                  <XAxis dataKey="category" stroke={st.muted} fontSize={9} angle={-20} textAnchor="end" height={50} interval={0} />
                  <YAxis stroke={st.muted} fontSize={10} tickFormatter={(v) => `$${v}`} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `$${v.toFixed(2)}`} />
                  <ReferenceLine y={0} stroke={st.muted} />
                  <Bar dataKey="pnl" name="P&L" radius={[4, 4, 0, 0]}>
                    {pnlByOptionCategory.map((d, i) => <Cell key={i} fill={d.pnl >= 0 ? st.green : st.red} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-2 space-y-1">
                {pnlByOptionCategory.slice(0, 6).map(c => (
                  <div key={c.category} className="flex items-center justify-between text-[10px]" style={{ color: st.muted }}>
                    <span style={{ color: st.text, fontWeight: 500 }}>{c.category}</span>
                    <span>
                      <span style={{ color: c.pnl >= 0 ? st.green : st.red, fontWeight: 600, fontFamily: 'monospace' }}>${c.pnl.toFixed(0)}</span>
                      {' · '}
                      {c.count} trades · {c.wins}/{c.count} wins
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </ChartCard>
      </div>

      {/* Loss Analysis Section (expandable) */}
      <div className="rounded-xl border" style={{ background: st.bg, borderColor: st.border }}>
        <button
          onClick={() => setLossExpanded(e => !e)}
          className="w-full flex items-center justify-between p-4"
          style={{ background: 'none', border: 'none', cursor: 'pointer' }}
        >
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} style={{ color: st.red }} />
            <span className="text-sm font-bold" style={{ color: st.text }}>Loss Analysis</span>
            {lossAnalysis && (
              <span className="text-[10px] rounded-full px-2 py-0.5" style={{ background: `${st.red}15`, color: st.red, border: `1px solid ${st.red}30` }}>
                ${lossAnalysis.totalLoss.toFixed(0)} total · {lossAnalysis.loserCount} losing trades
              </span>
            )}
          </div>
          {lossExpanded ? <ChevronUp size={16} style={{ color: st.muted }} /> : <ChevronDown size={16} style={{ color: st.muted }} />}
        </button>

        {lossExpanded && (
          <div className="px-4 pb-4 space-y-4">
            {/* Diagnosis banner */}
            {lossAnalysis && (
              <div className="rounded-lg p-3" style={{
                background: `${st.amber}10`,
                border: `1px solid ${st.amber}30`,
              }}>
                <div className="flex items-center gap-2 mb-1">
                  <Lightbulb size={14} style={{ color: st.amber }} />
                  <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: st.amber }}>Diagnosis</span>
                </div>
                <p className="text-[12px] leading-relaxed" style={{ color: st.text }}>{lossAnalysis.diagnosis}</p>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* P&L by Exit Reason */}
              <ChartCard st={st} title="P&L by Exit Reason" icon={<Filter size={14} />}>
                {pnlByExitReason.length === 0 ? <EmptyChart st={st} /> : (
                  <ResponsiveContainer width="100%" height={Math.max(160, pnlByExitReason.length * 32)}>
                    <BarChart data={pnlByExitReason} layout="vertical" margin={{ left: 10, right: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={st.border} />
                      <XAxis type="number" stroke={st.muted} fontSize={10} tickFormatter={(v) => `$${v}`} />
                      <YAxis type="category" dataKey="reason" stroke={st.muted} fontSize={9} width={110} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `$${v.toFixed(2)}`} />
                      <ReferenceLine x={0} stroke={st.muted} />
                      <Bar dataKey="pnl" name="P&L" radius={[0, 4, 4, 0]}>
                        {pnlByExitReason.map((d, i) => <Cell key={i} fill={d.pnl >= 0 ? st.green : st.red} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
                {pnlByExitReason.length > 0 && (
                  <div className="mt-2 space-y-0.5">
                    {pnlByExitReason.map(r => (
                      <div key={r.reason} className="flex items-center justify-between text-[10px]" style={{ color: st.muted }}>
                        <span style={{ color: st.text }}>{r.reason}</span>
                        <span>
                          <span style={{ color: r.pnl >= 0 ? st.green : st.red, fontFamily: 'monospace', fontWeight: 600 }}>${r.pnl.toFixed(0)}</span>
                          {' · '}{r.count} trades
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </ChartCard>

              {/* P&L by DTE Bucket */}
              <ChartCard st={st} title="P&L by DTE Bucket (Theta Impact)" icon={<Clock size={14} />}>
                {pnlByDteBucket.length === 0 ? <EmptyChart st={st} /> : (
                  <>
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={pnlByDteBucket} margin={{ left: 10, right: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={st.border} />
                        <XAxis dataKey="label" stroke={st.muted} fontSize={10} />
                        <YAxis stroke={st.muted} fontSize={10} tickFormatter={(v) => `$${v}`} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `$${v.toFixed(2)}`} />
                        <ReferenceLine y={0} stroke={st.muted} />
                        <Bar dataKey="pnl" name="P&L" radius={[4, 4, 0, 0]}>
                          {pnlByDteBucket.map((d, i) => <Cell key={i} fill={d.pnl >= 0 ? st.green : st.red} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                    <div className="mt-2 space-y-0.5">
                      {pnlByDteBucket.map(d => (
                        <div key={d.label} className="flex items-center justify-between text-[10px]" style={{ color: st.muted }}>
                          <span style={{ color: st.text }}>DTE {d.label}</span>
                          <span>
                            <span style={{ color: d.pnl >= 0 ? st.green : st.red, fontFamily: 'monospace', fontWeight: 600 }}>${d.pnl.toFixed(0)}</span>
                            {' · '}{d.count} trades · {d.win_rate}% win
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </ChartCard>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* P&L by Bias (market turnaround) */}
              <ChartCard st={st} title="P&L by Bias (Market Turnaround?)" icon={<TrendingUp size={14} />}>
                {pnlByBias.length === 0 ? <EmptyChart st={st} /> : (
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={pnlByBias} margin={{ left: 10, right: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={st.border} />
                      <XAxis dataKey="bias" stroke={st.muted} fontSize={10} />
                      <YAxis stroke={st.muted} fontSize={10} tickFormatter={(v) => `$${v}`} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `$${v.toFixed(2)}`} />
                      <ReferenceLine y={0} stroke={st.muted} />
                      <Bar dataKey="pnl" name="P&L" radius={[4, 4, 0, 0]}>
                        {pnlByBias.map((d, i) => <Cell key={i} fill={d.pnl >= 0 ? st.green : st.red} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
                {lossAnalysis && (
                  <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]" style={{ color: st.muted }}>
                    <div>Bullish losses: <span style={{ color: st.red, fontWeight: 600 }}>{lossAnalysis.bullPct.toFixed(0)}%</span></div>
                    <div>Bearish losses: <span style={{ color: st.red, fontWeight: 600 }}>{lossAnalysis.bearPct.toFixed(0)}%</span></div>
                  </div>
                )}
              </ChartCard>

              {/* P&L by Source (Day vs Swing vs Regular) */}
              <ChartCard st={st} title="P&L by Trade Type (Day/Swing/Regular)" icon={<Activity size={14} />}>
                {pnlBySource.length === 0 ? <EmptyChart st={st} /> : (
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={pnlBySource} margin={{ left: 10, right: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={st.border} />
                      <XAxis dataKey="source" stroke={st.muted} fontSize={10} />
                      <YAxis stroke={st.muted} fontSize={10} tickFormatter={(v) => `$${v}`} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `$${v.toFixed(2)}`} />
                      <ReferenceLine y={0} stroke={st.muted} />
                      <Bar dataKey="pnl" name="P&L" radius={[4, 4, 0, 0]}>
                        {pnlBySource.map((d, i) => <Cell key={i} fill={d.pnl >= 0 ? st.green : st.red} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
                {pnlBySource.length > 0 && (
                  <div className="mt-2 space-y-0.5">
                    {pnlBySource.map(s => (
                      <div key={s.source} className="flex items-center justify-between text-[10px]" style={{ color: st.muted }}>
                        <span style={{ color: st.text }}>{s.source}</span>
                        <span>
                          <span style={{ color: s.pnl >= 0 ? st.green : st.red, fontFamily: 'monospace', fontWeight: 600 }}>${s.pnl.toFixed(0)}</span>
                          {' · '}{s.wins}/{s.count} wins
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </ChartCard>
            </div>

            {/* DTE vs P&L Scatter */}
            {dteVsPnlScatter.length >= 3 && (
              <ChartCard st={st} title="DTE vs P&L (Loss Attribution Scatter)" icon={<Target size={14} />}>
                <ResponsiveContainer width="100%" height={220}>
                  <ScatterChart margin={{ left: 10, right: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={st.border} />
                    <XAxis type="number" dataKey="dte" name="DTE" stroke={st.muted} fontSize={10} label={{ value: 'DTE at entry', position: 'insideBottom', offset: -5, fontSize: 10, fill: st.muted }} />
                    <YAxis type="number" dataKey="pnl" name="P&L" stroke={st.muted} fontSize={10} tickFormatter={(v) => `$${v}`} label={{ value: 'P&L ($)', angle: -90, position: 'insideLeft', fontSize: 10, fill: st.muted }} />
                    <ZAxis range={[60, 60]} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ strokeDasharray: '3 3' }}
                      formatter={(v: number, name: string) => name === 'P&L' ? `$${v.toFixed(2)}` : v}
                    />
                    <ReferenceLine y={0} stroke={st.muted} />
                    <Scatter name="Trades" data={dteVsPnlScatter}>
                      {dteVsPnlScatter.map((d, i) => (
                        <Cell key={i} fill={d.pnl >= 0 ? st.green : st.red} fillOpacity={0.6} />
                      ))}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
                <div className="mt-1 text-[10px]" style={{ color: st.muted }}>
                  Each dot is a closed trade. Bottom-left quadrant = short-DTE losses (theta). Bottom-right = long-DTE losses (market move).
                </div>
              </ChartCard>
            )}
          </div>
        )}
      </div>

      {/* Charts Row 3: Capital Allocation + P&L by Strategy */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard st={st} title="Capital Allocation" icon={<PieIcon size={15} />}>
          {capitalAllocation.length === 0 && engineAllocation.length === 0 ? <EmptyChart st={st} /> : (
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

        <ChartCard st={st} title="P&L by Strategy" icon={<BarChart3 size={15} />}>
          {pnlByStrategy.length === 0 ? <EmptyChart st={st} /> : (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={pnlByStrategy} layout="vertical" margin={{ left: 10, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={st.border} />
                  <XAxis type="number" stroke={st.muted} fontSize={10} tickFormatter={(v) => `$${v}`} />
                  <YAxis type="category" dataKey="strategy" stroke={st.muted} fontSize={9} width={110} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `$${v.toFixed(2)}`} />
                  <ReferenceLine x={0} stroke={st.muted} />
                  <Bar dataKey="pnl" name="P&L" radius={[0, 4, 4, 0]}>
                    {pnlByStrategy.map((d, i) => <Cell key={i} fill={d.pnl >= 0 ? st.green : st.red} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-2 space-y-1">
                {pnlByStrategy.slice(0, 5).map(s => (
                  <div key={s.strategy} className="flex items-center justify-between text-[10px]" style={{ color: st.muted }}>
                    <span style={{ color: st.text, fontWeight: 500 }}>{s.strategy}</span>
                    <span>
                      <span style={{ color: s.pnl >= 0 ? st.green : st.red, fontWeight: 600, fontFamily: 'monospace' }}>${s.pnl.toFixed(0)}</span>
                      {' · '}{s.win_rate}% win ({s.count})
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

function ChartCard({ st, title, icon, children, headerRight }: {
  st: Record<string, string>; title: string; icon: React.ReactNode; children: React.ReactNode
  headerRight?: React.ReactNode
}) {
  return (
    <div className="rounded-xl border p-4" style={{ background: st.bg, borderColor: st.border }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span style={{ color: st.muted }}>{icon}</span>
          <span className="text-sm font-bold" style={{ color: st.text }}>{title}</span>
        </div>
        {headerRight}
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
