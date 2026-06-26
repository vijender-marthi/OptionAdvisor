import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle, ArrowUpRight, BarChart3, BookOpen, BrainCircuit, Briefcase, Check, ChevronDown,
  ChevronUp,
  Clock,
  DollarSign,
  Download,
  Edit3,
  Filter,
  Info,
  Layers,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Shield,
  TrendingUp,
  TrendingDown,
  Trash2,
  X,
} from 'lucide-react'
import { fetchPositionsCenter, fetchStockTargets } from '../api/commandCenter'
import type { StockTargetData } from '../api/commandCenter'
import { ROUTES } from '../routing/routes'
import { useApp } from '../contexts/AppContext'
import type { AiPositionAnalysis, ApiEnvelope, StockPositionAnalysis } from '../types/commandCenter'
import type { PortfolioPosition, OptionLeg, ClosePositionPayload } from '../types/index'
import { EXIT_REASON_OPTIONS } from '../types/index'
import {
  getActionButtonClass,
  getBiasBadgeClass,
  getDecisionBadgeClass,
  getMarketContextBadgeClass,
  getProfitLossTextClass,
  getPositionCategoryClass,
} from '../utils/semanticTrading'
import * as XLSX from 'xlsx'
import PositionsDashboardTab from '../components/PositionsDashboardTab'

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'all',    label: 'All Positions' },
  { id: 'open',   label: 'Open Positions' },
  { id: 'closed', label: 'Closed Positions' },
  { id: 'stocks', label: 'Stocks' },
] as const

type MainTabId = (typeof TABS)[number]['id']
type FilterStyle = 'all' | 'day' | 'swing' | 'regular'
type FilterType = 'all' | 'options' | 'stocks' | 'spreads'
type FilterRisk = 'all' | 'low' | 'medium' | 'high'
type SortKey = 'ticker' | 'dte' | 'entryPrice' | 'max_profit' | 'max_loss' | 'pnlPct'

const SHARES_PER_OPTION_CONTRACT = 100

interface LegTemplate { action: 'BUY' | 'SELL'; option_type: 'CALL' | 'PUT'; label: string; expirySlot?: 'front' | 'back' }
interface StrategyDef { bias: string; legs: LegTemplate[]; isCalendar?: boolean }

const STRATEGY_DEFS: Record<string, StrategyDef> = {
  'Stock':            { bias: 'Neutral',          legs: [] },
  'Long Call':        { bias: 'Bullish',          legs: [{ action: 'BUY',  option_type: 'CALL', label: 'Buy Call' }] },
  'Long Put':         { bias: 'Bearish',           legs: [{ action: 'BUY',  option_type: 'PUT',  label: 'Buy Put' }] },
  'Short Put':        { bias: 'Bullish/Neutral',   legs: [{ action: 'SELL', option_type: 'PUT',  label: 'Sell Put' }] },
  'Short Call':       { bias: 'Bearish/Neutral',   legs: [{ action: 'SELL', option_type: 'CALL', label: 'Sell Call' }] },
  'Bull Put Spread':  { bias: 'Bullish/Neutral',   legs: [
    { action: 'SELL', option_type: 'PUT',  label: 'Sell Put (higher strike)' },
    { action: 'BUY',  option_type: 'PUT',  label: 'Buy Put (lower strike, protection)' },
  ]},
  'Bear Call Spread': { bias: 'Bearish/Neutral',   legs: [
    { action: 'SELL', option_type: 'CALL', label: 'Sell Call (lower strike)' },
    { action: 'BUY',  option_type: 'CALL', label: 'Buy Call (higher strike, protection)' },
  ]},
  'Bull Call Spread': { bias: 'Bullish',           legs: [
    { action: 'BUY',  option_type: 'CALL', label: 'Buy Call (lower strike)' },
    { action: 'SELL', option_type: 'CALL', label: 'Sell Call (higher strike)' },
  ]},
  'Bear Put Spread':  { bias: 'Bearish',           legs: [
    { action: 'BUY',  option_type: 'PUT',  label: 'Buy Put (higher strike)' },
    { action: 'SELL', option_type: 'PUT',  label: 'Sell Put (lower strike)' },
  ]},
  'Iron Condor':      { bias: 'Neutral',           legs: [
    { action: 'SELL', option_type: 'PUT',  label: 'Sell Put (higher put)' },
    { action: 'BUY',  option_type: 'PUT',  label: 'Buy Put (lower put)' },
    { action: 'SELL', option_type: 'CALL', label: 'Sell Call (lower call)' },
    { action: 'BUY',  option_type: 'CALL', label: 'Buy Call (higher call)' },
  ]},
  'Call Calendar Spread': { bias: 'Neutral', isCalendar: true, legs: [
    { action: 'SELL', option_type: 'CALL', label: 'Sell Call (front / near-term)', expirySlot: 'front' },
    { action: 'BUY',  option_type: 'CALL', label: 'Buy Call (back / far-term)',    expirySlot: 'back'  },
  ]},
  'Put Calendar Spread': { bias: 'Neutral', isCalendar: true, legs: [
    { action: 'SELL', option_type: 'PUT', label: 'Sell Put (front / near-term)', expirySlot: 'front' },
    { action: 'BUY',  option_type: 'PUT', label: 'Buy Put (back / far-term)',    expirySlot: 'back'  },
  ]},
}

function computeMetrics(
  strategy: string,
  legStrikes: number[],
  legPremiums: number[],
  entryStockPrice: number,
): { netCredit: number; spreadWidth: number; maxProfit: number; maxLoss: number; beLower: number; beUpper: number } {
  const def = STRATEGY_DEFS[strategy]
  if (!def) return { netCredit: 0, spreadWidth: 0, maxProfit: 0, maxLoss: 0, beLower: 0, beUpper: 999 }

  const sellPremSum = def.legs.reduce((s, leg, i) => leg.action === 'SELL' ? s + (legPremiums[i] || 0) : s, 0)
  const buyPremSum  = def.legs.reduce((s, leg, i) => leg.action === 'BUY'  ? s + (legPremiums[i] || 0) : s, 0)
  const netCredit   = Math.round((sellPremSum - buyPremSum) * 100) / 100

  const strikes = legStrikes.filter(s => s > 0)
  const spreadWidth = strikes.length >= 2 ? Math.round(Math.abs(Math.max(...strikes) - Math.min(...strikes)) * 100) / 100 : 0

  let maxProfit = 0, maxLoss = 0, beLower = 0, beUpper = 999

  if (netCredit > 0) {
    maxProfit = netCredit
    maxLoss   = spreadWidth > 0 ? Math.max(0, Math.round((spreadWidth - netCredit) * 100) / 100) : Math.round(netCredit * 2 * 100) / 100
    const sellStrike0 = legStrikes[0] || 0
    const sellStrike2 = legStrikes[2] || 0
    if (['Bull Put Spread', 'Short Put'].includes(strategy))
      beLower = Math.round((sellStrike0 - netCredit) * 100) / 100
    if (['Bear Call Spread', 'Short Call'].includes(strategy))
      beUpper = Math.round((sellStrike0 + netCredit) * 100) / 100
    if (strategy === 'Iron Condor') {
      beLower = Math.round((sellStrike0 - netCredit) * 100) / 100
      beUpper = Math.round((sellStrike2 + netCredit) * 100) / 100
    }
  } else if (def.isCalendar) {
    // Calendar spread: net debit = back_premium - front_premium
    // Max loss = net debit. Max profit ≈ net debit (conservative 1:1 estimate).
    // Breakevens ≈ strike ± net_debit for a rough display.
    const netDebit = Math.abs(netCredit)
    const strike = legStrikes[0] || entryStockPrice   // same strike on both legs
    maxLoss   = netDebit
    maxProfit = Math.round(netDebit * 100) / 100       // conservative 1:1 estimate
    beLower   = Math.round((strike - netDebit * 2) * 100) / 100
    beUpper   = Math.round((strike + netDebit * 2) * 100) / 100
  } else {
    const premium = Math.abs(netCredit)
    const s0 = legStrikes[0] || 0
    if (['Long Call', 'Long Put'].includes(strategy)) {
      maxLoss   = premium
      maxProfit = Math.round(premium * 10 * 100) / 100
      beLower   = strategy === 'Long Call' ? Math.round((s0 + premium) * 100) / 100
                                           : Math.round((s0 - premium) * 100) / 100
    } else if (['Bull Call Spread', 'Bear Put Spread'].includes(strategy)) {
      maxLoss   = premium
      maxProfit = Math.max(0, Math.round((spreadWidth - premium) * 100) / 100)
      beLower   = strategy === 'Bull Call Spread' ? Math.round((s0 + premium) * 100) / 100
                                                   : Math.round((s0 - premium) * 100) / 100
    } else {
      maxLoss   = premium
      maxProfit = Math.round(premium * 10 * 100) / 100
    }
  }

  return { netCredit, spreadWidth, maxProfit, maxLoss, beLower, beUpper }
}

function normalizeExpiryForDateInput(expiry: string): string {
  const s = expiry.trim()
  if (!s) return ''
  return s.includes('T') ? s.slice(0, 10) : s.slice(0, 10)
}

function guessStrategyFromLegs(legs: OptionLeg[]): string | null {
  // Calendar: same strike, different expiries
  if (legs.length === 2 && legs[0].strike === legs[1].strike && legs[0].expiry !== legs[1].expiry) {
    const sellLeg = legs.find(l => l.action === 'SELL')
    if (sellLeg?.option_type === 'CALL') return 'Call Calendar Spread'
    if (sellLeg?.option_type === 'PUT')  return 'Put Calendar Spread'
  }
  const sig = legs.map(l => `${l.action}:${l.option_type}`).join('|')
  for (const [name, d] of Object.entries(STRATEGY_DEFS)) {
    if (d.legs.length !== legs.length) continue
    const defSig = d.legs.map(l => `${l.action}:${l.option_type}`).join('|')
    if (defSig === sig) return name
  }
  return null
}

function resolveEditorStrategyForEdit(pos: PortfolioPosition): string {
  if (STRATEGY_DEFS[pos.strategy]) return pos.strategy
  const guessed = guessStrategyFromLegs(pos.legs)
  if (guessed) return guessed
  return 'Stock'
}

function seedLegStringsFromPosition(pos: PortfolioPosition): { strikes: string[]; premiums: string[] } {
  const strikes = ['', '', '', '']
  const premiums = ['', '', '', '']
  for (let i = 0; i < Math.min(pos.legs.length, 4); i++) {
    strikes[i] = pos.legs[i].strike > 0 ? String(pos.legs[i].strike) : ''
    premiums[i] = Number.isFinite(pos.legs[i].mid_price) ? String(pos.legs[i].mid_price) : ''
  }
  return { strikes, premiums }
}

function deriveEngineSource(pos: PortfolioPosition): 'day' | 'swing' | 'regular' {
  const src = (pos.source || '').toLowerCase()
  if (src.includes('day')) return 'day'
  if (src.includes('swing')) return 'swing'
  return 'regular'
}

function fmtUsd(n: unknown): string {
  if (n == null || n === '') return '—'
  const x = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(x)) return '—'
  const sign = x < 0 ? '-' : ''
  return `${sign}$${Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function safeDte(v: unknown, fallback: number = 99): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n > 0 && n < 9999 ? n : fallback
}

function fmtPct(n: unknown): string {
  if (n == null || n === '') return '—'
  const x = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(x)) return '—'
  const sign = x >= 0 ? '+' : ''
  return `${sign}${x.toFixed(2)}%`
}

function num(n: unknown, fallback = 0): number {
  if (n == null) return fallback
  const x = typeof n === 'number' ? n : Number(n)
  return Number.isFinite(x) ? x : fallback
}

function deriveAiStatus(pos: PortfolioPosition): string {
  if (pos.status === 'closed') return 'EXIT'
  const bias = (pos.bias || '').toLowerCase()
  const strat = (pos.strategy || '').toLowerCase()
  const dte = safeDte(pos.dte, 99)
  if (bias.includes('bull') && strat.includes('call')) return 'HOLD'
  if (bias.includes('bear') && strat.includes('put')) return 'HOLD'
  if ((pos.prob_of_profit ?? 50) >= 70) return 'HOLD'
  if (dte <= 7) return 'EXIT SOON'
  if (dte <= 14) return 'WATCH'
  if ((pos.prob_of_profit ?? 50) < 40) return 'CONFLICT'
  if (strat.includes('spread') || strat.includes('condor') || strat.includes('iron')) return 'MANAGE'
  return 'HOLD'
}

function deriveAiGuidance(pos: PortfolioPosition): string {
  const status = deriveAiStatus(pos)
  const dte = safeDte(pos.dte, 99)
  const strat = (pos.strategy || '').toLowerCase()
  const bias = (pos.bias || '').toLowerCase()
  if (status === 'EXIT SOON') return `EXIT SOON — ${dte} DTE remaining. Theta is destroying value daily; close or roll to a later expiry now. If rolling, target ≥ 21 DTE on the new leg.`
  if (status === 'WATCH') return `WATCH — ${dte} DTE. At ${Math.max(1, dte - 5)} DTE reassess: if position is ≥ 50% of max profit, close and redeploy. Otherwise, prepare a roll thesis before theta accelerates.`
  if (status === 'CONFLICT') return `CONFLICT — P(profit) at ${pos.prob_of_profit ?? 50}%, below the 40% floor. Cut size by 50% or close if price has moved against your breakeven by more than 1 ATR.`
  if (status === 'MANAGE') {
    if (strat.includes('spread')) return `MANAGE — Spread active. If the short leg goes ITM with < 7 DTE, buy it back to eliminate pin risk. Stop the spread at 2× the premium paid.`
    return 'MANAGE — Multi-leg position. Close if net delta exceeds ±0.30 per contract, or if the position loses > 25% of credit received.'
  }
  if (status === 'EXIT') return 'CLOSED — Compare final P&L to entry thesis: did price reach your target or stop you out? Log IV at open and DTE at close for pattern review.'
  if (bias.includes('bull')) return `HOLD — Bullish. ${dte} DTE remaining. Trail stop to just below the last swing low or VWAP reclaim. Target 50% profit for partial close, full exit at 80%.`
  if (bias.includes('bear')) return `HOLD — Bearish. ${dte} DTE remaining. Close if price reclaims the prior day's VWAP or breaks above nearest resistance with volume confirmation.`
  return `HOLD — ${dte} DTE remaining. Set profit target at 50% of max credit, stop at 2× premium paid, and hard close date at 21 DTE.`
}

type ExitRule = { trigger: string; price: number | null; action: string; note: string }

function deriveExitRules(pos: PortfolioPosition): ExitRule[] {
  if (pos.status === 'closed') return []

  const source = deriveEngineSource(pos)
  const rules: ExitRule[] = []

  const SELLING_STRATS = new Set([
    'Iron Condor', 'Bull Put Spread', 'Bear Call Spread',
    'Short Put', 'Short Call', 'Covered Call', 'Covered Put',
  ])
  const isCredit = SELLING_STRATS.has(pos.strategy)
  const dte = safeDte(pos.dte, 0)

  // ── User-entered execution map levels (highest priority) ─────────────
  // If the trader has entered target1/target2/breakout/stopLoss, use them
  // as the exit triggers since they reflect the trader's own thesis.
  const hasUserLevels = pos.target1 != null || pos.target2 != null || pos.stopLoss != null

  if (source === 'day') {
    // Day trades: VWAP-based, always close before EOD
    if (pos.target1 != null) rules.push({ trigger: 'Target 1 reached', price: pos.target1, action: 'Sell ½ position', note: 'Move stop to breakout / entry level' })
    if (pos.target2 != null) rules.push({ trigger: 'Target 2 — scalp target', price: pos.target2, action: 'Sell remaining ½', note: 'Intraday trade complete' })
    if (pos.stopLoss != null) rules.push({ trigger: 'Stop loss', price: pos.stopLoss, action: 'Exit full position', note: 'Capital preservation — accept the loss' })
    rules.push({ trigger: 'Market close (3:55 PM ET)', price: null, action: 'Close all intraday positions', note: 'Never carry a day-trade overnight' })
    return rules
  }

  if (source === 'swing') {
    if (hasUserLevels) {
      if (pos.target1 != null) rules.push({ trigger: 'Target 1 reached', price: pos.target1, action: 'Sell ½ position', note: 'Move stop to breakout / entry level' })
      if (pos.target2 != null) rules.push({ trigger: 'Target 2 reached', price: pos.target2, action: 'Sell remaining ½', note: 'Full exit — trade complete' })
      if (pos.breakout != null) rules.push({ trigger: 'Price fails to hold breakout', price: pos.breakout, action: 'Exit full position', note: 'Breakout structure failed — do not hold' })
      if (pos.stopLoss != null) rules.push({ trigger: 'Stop loss', price: pos.stopLoss, action: 'Exit full position', note: 'Capital preservation — accept the loss' })
    } else {
      // Derive from position metrics
      const profitTarget = pos.net_credit >= 0
        ? round2(pos.max_profit * 0.5)
        : round2(Math.abs(pos.net_credit) * 2)
      const stopAmt = pos.net_credit >= 0
        ? round2(pos.net_credit * 2)
        : round2(Math.abs(pos.net_credit) * 0.5)
      rules.push({ trigger: '50% of max profit reached', price: profitTarget, action: 'Sell ½ position', note: 'Lock in gains, trail stop to entry' })
      rules.push({ trigger: `${Math.max(7, Math.round(dte * 0.4))} DTE remaining`, price: null, action: 'Close or roll position', note: 'Theta decay accelerates — avoid holding to expiry' })
      rules.push({ trigger: 'Loss reaches 2× entry premium', price: stopAmt, action: 'Exit full position', note: 'Stop loss — protect account capital' })
    }
    return rules
  }

  // ── Regular options ───────────────────────────────────────────────────
  if (hasUserLevels) {
    if (pos.target1 != null) rules.push({ trigger: 'Target 1 reached', price: pos.target1, action: isCredit ? 'Buy back / close spread' : 'Sell to close ½', note: 'Partial profit — lock in gains' })
    if (pos.target2 != null) rules.push({ trigger: 'Target 2 reached', price: pos.target2, action: isCredit ? 'Close full position' : 'Sell to close rest', note: 'Full exit — trade complete' })
    if (pos.stopLoss != null) rules.push({ trigger: 'Stop loss', price: pos.stopLoss, action: 'Close full position', note: 'Capital preservation' })
  } else {
    // For debit spreads, use net_credit magnitude as the entry premium reference.
    // Fall back to entryPrice when net_credit is missing or effectively zero.
    const entryPremium = Math.abs(pos.net_credit) > 0.01
      ? Math.abs(pos.net_credit)
      : (pos.entryPrice || 0)

    const profitAmt = isCredit
      ? round2(pos.net_credit * 0.5)          // buy back at 50¢ on the dollar
      : round2(entryPremium * 2)              // close when option doubles in value
    const stopAmt = isCredit
      ? round2(pos.net_credit * 2)            // stop when loss = 2× credit received
      : round2(entryPremium * 0.5)            // stop when option loses 50% of entry value
    const closeDte = Math.max(7, Math.round(dte * 0.4))

    rules.push({
      trigger: isCredit ? '50% of credit captured' : '100% gain on premium',
      price: profitAmt,
      action: isCredit ? 'Buy back / close spread' : 'Sell to close',
      note: isCredit
        ? `Credit remaining ≈ $${profitAmt.toFixed(2)}/share`
        : `Close when option reaches $${profitAmt.toFixed(2)} (2× your $${entryPremium.toFixed(2)} entry premium)`,
    })
    rules.push({
      trigger: `${closeDte} DTE remaining`,
      price: null,
      action: 'Close or roll position',
      note: `Hold ≈ ${Math.max(0, dte - closeDte)} more days then exit — gamma risk rises sharply`,
    })
    rules.push({
      trigger: isCredit ? 'Loss reaches 2× credit' : '50% loss on premium',
      price: stopAmt,
      action: 'Close position — stop loss',
      note: isCredit
        ? `Max loss ≈ $${stopAmt.toFixed(2)}/share — cut and move on`
        : `Close when option falls to $${stopAmt.toFixed(2)} (50% below your $${entryPremium.toFixed(2)} entry premium)`,
    })
  }

  return rules
}

function round2(x: number): number { return Math.round(x * 100) / 100 }

function engineSourceLabel(source: 'day' | 'swing' | 'regular'): string {
  if (source === 'day') return 'Day'
  if (source === 'swing') return 'Swing'
  return 'Regular'
}

function stratelabel(strat: string): string {
  if (!strat) return '—'
  return strat.replace(/_/g, ' ')
}

/** Cost-basis reference per share: debit strategies use |net_credit|, credit use max_profit. */
function costBasisRefPerShare(pos: PortfolioPosition): number {
  return pos.net_credit < 0 ? Math.abs(pos.net_credit) : pos.max_profit
}

function computePnlDollar(pos: PortfolioPosition): number | null {
  if (pos.status !== 'closed' || pos.pnlPct == null || !Number.isFinite(pos.pnlPct)) return null
  const ref = costBasisRefPerShare(pos)
  if (ref <= 0) return null
  return (pos.pnlPct / 100) * ref * 100 * pos.contracts
}

function computeCreditTotal(pos: PortfolioPosition): number {
  return Math.abs(pos.net_credit) * pos.contracts * 100
}

function creditPerContract(pos: PortfolioPosition): number {
  return Math.abs(pos.net_credit)
}

function PlBadge({ pnl }: { pnl: number | null | undefined }) {
  if (pnl == null) return null
  if (pnl > 0) return <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-400">WIN</span>
  if (pnl < 0) return <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-400">LOSS</span>
  return <span className="rounded-full bg-slate-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">EVEN</span>
}

function ProtectProfitsBadge() {
  return <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-400">PROTECT</span>
}

function ExitBadge() {
  return <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-400">EXIT</span>
}


function AIStatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${getDecisionBadgeClass(status)}`}>
      <BrainCircuit size={9} className="mr-1 shrink-0" />
      {status}
    </span>
  )
}

function normalizeExitBadgeLabel(badge?: string | null): string | null {
  const b = String(badge || '').toUpperCase()
  if (!b || b === 'HOLD') return null
  if (b === 'EXIT_NOW') return 'EXIT NOW'
  if (b === 'TIME_STOP') return 'TIME STOP'
  if (b === 'THESIS_INVALIDATED') return 'THESIS INVALID'
  if (b === 'TARGET_HIT') return 'TARGET HIT'
  if (b === 'REDUCE') return 'REDUCE'
  return b.replace(/_/g, ' ')
}

function sourceStyleBadge(kind: 'day' | 'swing' | 'regular') {
  const cls = getPositionCategoryClass(kind)
  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${cls}`}>
      {engineSourceLabel(kind)}
    </span>
  )
}

type OvernightCheckStatus = 'pass' | 'fail' | 'missing'
type OvernightCheck = { label: string; status: OvernightCheckStatus; detail: string }

function checkStatus(ok: boolean | null, detail: string): { status: OvernightCheckStatus; detail: string } {
  if (ok == null) return { status: 'missing', detail }
  return { status: ok ? 'pass' : 'fail', detail }
}

function deriveOvernightHoldChecks(pos: PortfolioPosition, aiAnalysis?: AiPositionAnalysis | null): {
  verdict: 'KEEP' | 'CLOSE'
  checks: OvernightCheck[]
  summary: string
} {
  const price = aiAnalysis?.current_price ?? null
  const vwap = aiAnalysis?.vwap ?? null
  const orh = aiAnalysis?.orh ?? null
  const ema20 = aiAnalysis?.ema20 ?? aiAnalysis?.ma20 ?? null
  const dte = safeDte(pos.dte, 0)
  const dailyTrend = String(aiAnalysis?.daily_trend ?? aiAnalysis?.momentum_quality ?? '').toUpperCase()
  const spyAligned = aiAnalysis?.spy_aligned
  const qqqAligned = aiAnalysis?.qqq_aligned
  const marketAligned = spyAligned == null && qqqAligned == null
    ? null
    : Boolean(spyAligned) && Boolean(qqqAligned)
  const dailyBullish = dailyTrend
    ? dailyTrend.includes('BULL') || dailyTrend.includes('STRONG') || dailyTrend.includes('HEALTHY')
    : null

  const vwapCheck = checkStatus(price != null && vwap != null ? price > vwap : null, price != null && vwap != null ? `$${price.toFixed(2)} vs VWAP $${vwap.toFixed(2)}` : 'VWAP level unavailable')
  const orhCheck = checkStatus(price != null && orh != null ? price > orh : null, price != null && orh != null ? `$${price.toFixed(2)} vs ORH $${orh.toFixed(2)}` : 'ORH level unavailable')
  const emaCheck = checkStatus(price != null && ema20 != null ? price > ema20 : null, price != null && ema20 != null ? `$${price.toFixed(2)} vs 20 EMA $${ema20.toFixed(2)}` : '20 EMA unavailable')
  const trendCheck = checkStatus(dailyBullish, dailyTrend ? dailyTrend.replace(/_/g, ' ') : 'Daily trend unavailable')
  const marketCheck = checkStatus(marketAligned, spyAligned == null && qqqAligned == null ? 'SPY/QQQ alignment unavailable' : `SPY ${spyAligned ? 'aligned' : 'not aligned'} · QQQ ${qqqAligned ? 'aligned' : 'not aligned'}`)
  const dteCheck = checkStatus(dte > 5, dte > 0 ? `${dte} DTE remaining` : 'DTE unavailable')

  const checks: OvernightCheck[] = [
    { label: 'Above VWAP', ...vwapCheck },
    { label: 'Above ORH', ...orhCheck },
    { label: 'Above 20 EMA', ...emaCheck },
    { label: 'Daily trend bullish', ...trendCheck },
    { label: 'QQQ/SPY aligned', ...marketCheck },
    { label: 'Expiry > 5 DTE', ...dteCheck },
  ]
  const allPassed = checks.every(check => check.status === 'pass')
  const missing = checks.filter(check => check.status === 'missing').length
  const failed = checks.filter(check => check.status === 'fail').length
  return {
    verdict: allPassed ? 'KEEP' : 'CLOSE',
    checks,
    summary: allPassed
      ? 'Overnight hold allowed. Day trade can be converted to a multi-day position.'
      : failed > 0
        ? `${failed} required condition${failed === 1 ? '' : 's'} failed. Close the day trade instead of converting it.`
        : `${missing} required condition${missing === 1 ? '' : 's'} missing. Do not convert without confirming these levels.`,
  }
}

function OvernightHoldEngineCard({ pos, aiAnalysis }: { pos: PortfolioPosition; aiAnalysis?: AiPositionAnalysis | null }) {
  const decision = deriveOvernightHoldChecks(pos, aiAnalysis)
  const allow = decision.verdict === 'KEEP'
  const rowClass = (status: OvernightCheckStatus) =>
    status === 'pass'
      ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
      : status === 'fail'
        ? 'border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300'
        : 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300'
  return (
    <div className={`mt-5 rounded-xl border p-4 ${allow ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-rose-500/30 bg-rose-500/10'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-heading">Overnight Hold Engine</div>
          <p className="mt-1 text-xs leading-5 text-secondary">Prevents day-trade drift. A Day trade can become multi-day only when every checklist item passes.</p>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${allow ? 'border-emerald-500/40 text-emerald-400' : 'border-rose-500/40 text-rose-400'}`}>
          {allow ? 'Keep Overnight' : 'Close Today'}
        </span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {decision.checks.map(check => (
          <div key={check.label} className={`rounded-lg border px-3 py-2 ${rowClass(check.status)}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold">{check.label}</span>
              <span className="text-[10px] font-black uppercase tracking-wide">{check.status === 'pass' ? 'Pass' : check.status === 'fail' ? 'Fail' : 'Missing'}</span>
            </div>
            <div className="mt-0.5 text-[11px] opacity-80">{check.detail}</div>
          </div>
        ))}
      </div>
      <div className={`mt-3 rounded-lg px-3 py-2 text-xs font-semibold ${allow ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-rose-500/10 text-rose-700 dark:text-rose-300'}`}>
        {decision.summary}
      </div>
    </div>
  )
}

function ModalOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={onClose}>
      <div className="my-8 w-full max-w-2xl rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-slate-900 shadow-xl" onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

const TRADE_SOURCE_OPTIONS = [
  { id: 'regular' as const, label: 'Regular' },
  { id: 'swing' as const, label: 'Swing' },
  { id: 'day' as const, label: 'Day' },
]

interface FormState {
  ticker: string
  tradeSource: 'day' | 'swing' | 'regular'
  strategy: string
  expiry: string
  backExpiry: string   // calendar spreads only — back-month (long) leg expiry
  contractCount: string
  entryStockPrice: string
  notes: string
  legStrikes: string[]
  legPremiums: string[]
  target1: string
  target2: string
  breakout: string
  stopLoss: string
  trailingStopPct: string
  accountType: '401K' | 'TAXABLE' | ''
  purchaseDate: string
}

function emptyForm(): FormState {
  return {
    ticker: '',
    tradeSource: 'regular',
    strategy: 'Stock',
    expiry: '',
    backExpiry: '',
    contractCount: '1',
    entryStockPrice: '',
    notes: '',
    legStrikes: ['', '', '', ''],
    legPremiums: ['', '', '', ''],
    target1: '',
    target2: '',
    breakout: '',
    stopLoss: '',
    trailingStopPct: '8',
    accountType: '',
    purchaseDate: '',
  }
}

function StockTargetsFetcher({
  ticker,
  entryPrice,
  onFill,
}: {
  ticker: string
  entryPrice?: number
  onFill: (targets: { target1: string; target2: string; stopLoss: string }) => void
}) {
  const [loading, setLoading] = useState(false)
  const [info, setInfo] = useState<StockTargetData | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const run = async () => {
    const t = ticker.trim().toUpperCase()
    if (!t) return
    setLoading(true)
    setErr(null)
    try {
      const result = await fetchStockTargets(t, entryPrice)
      setInfo(result)
      onFill({
        target1: result.suggested_target1.toFixed(2),
        target2: result.suggested_target2.toFixed(2),
        stopLoss: result.suggested_stop_loss.toFixed(2),
      })
    } catch {
      setErr('Could not fetch market data — enter targets manually.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={run}
        disabled={!ticker.trim() || loading}
        className={`w-full rounded-lg px-3 py-2 text-xs font-semibold transition-colors border ${
          ticker.trim() && !loading
            ? 'bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-700 hover:bg-violet-100 dark:hover:bg-violet-900/30'
            : 'bg-slate-100 dark:bg-slate-800 text-muted border-transparent cursor-not-allowed'
        }`}
      >
        {loading ? 'Fetching MA data…' : 'Auto-Fill Targets from MA20 / MA50'}
      </button>
      {info && (
        <div className="rounded-lg border border-slate-100 dark:border-white/[0.05] bg-slate-50 dark:bg-slate-800/50 p-3 text-xs font-mono space-y-1">
          <div className="text-slate-500 dark:text-slate-400 font-sans font-semibold text-[10px] uppercase tracking-wide mb-1.5">
            Live Context — {info.ticker}
          </div>
          <div className="flex gap-4 flex-wrap">
            <span className="text-primary">Price: <span className="font-bold">${info.current_price.toFixed(2)}</span></span>
            <span className="text-sky-400">MA20: ${info.ma20.toFixed(2)}</span>
            <span className="text-amber-400">MA50: ${info.ma50.toFixed(2)}</span>
            <span className="text-slate-400">RSI: {info.rsi.toFixed(0)}</span>
          </div>
        </div>
      )}
      {err && <p className="text-xs text-semantic-bearish">{err}</p>}
    </div>
  )
}

function PositionFormFields({
  form, onChange, readonlyTicker, isEdit, sourceOptions = TRADE_SOURCE_OPTIONS,
}: {
  form: FormState
  onChange: (patch: Partial<FormState>) => void
  readonlyTicker?: boolean
  isEdit?: boolean
  sourceOptions?: typeof TRADE_SOURCE_OPTIONS
}) {
  const def = STRATEGY_DEFS[form.strategy]
  const isStock = form.strategy === 'Stock'

  const handleStrategyChange = (s: string) => {
    onChange({ strategy: s, legStrikes: ['', '', '', ''], legPremiums: ['', '', '', ''] })
  }

  const strikesNum = form.legStrikes.map(s => parseFloat(s) || 0)
  const premiumsNum = form.legPremiums.map(p => parseFloat(p) || 0)
  const metrics = computeMetrics(form.strategy, strikesNum, premiumsNum, parseFloat(form.entryStockPrice) || 0)
  const cc = parseInt(form.contractCount) || 0
  const legsComplete = def ? def.legs.every((_, i) => strikesNum[i] > 0 && premiumsNum[i] > 0) : false

  const inputCls = 'mt-1 w-full rounded-lg border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-slate-800 px-3 py-2 text-sm text-primary outline-none focus:border-violet-500 dark:focus:border-violet-400 placeholder:text-tertiary'
  const labelCls = 'block text-xs font-semibold text-slate-600 dark:text-slate-300'

  return (
    <div className="space-y-4">
      <label className={labelCls}>Ticker *
        <input value={form.ticker} onChange={e => onChange({ ticker: e.target.value.toUpperCase() })}
          className={`${inputCls} ${readonlyTicker ? 'opacity-60' : ''}`} readOnly={readonlyTicker} />
      </label>

      {sourceOptions.length > 1 && (
        <div>
          <div className="text-xs font-semibold text-secondary mb-1.5">Trade Source</div>
          <div className="flex gap-2">
            {sourceOptions.map(s => (
              <button key={s.id} type="button" onClick={() => onChange({ tradeSource: s.id })}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  form.tradeSource === s.id ? 'bg-violet-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-muted hover:text-secondary'
                }`}
              >{s.label}</button>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className={labelCls}>Strategy *</label>
        <select value={form.strategy} onChange={e => handleStrategyChange(e.target.value)} className={inputCls}>
          {Object.keys(STRATEGY_DEFS).map(s => (
            <option key={s} value={s} className="bg-surface-card">{s}</option>
          ))}
        </select>
      </div>

      {isStock ? (
        <>
          {/* Shares + Entry Price */}
          <div className="grid grid-cols-2 gap-3">
            <label className={labelCls}>Shares *
              <input type="number" min={1} value={form.contractCount}
                onChange={e => onChange({ contractCount: e.target.value })} className={inputCls} />
            </label>
            <label className={labelCls}>Entry Price ($) *
              <input type="number" step="any" value={form.entryStockPrice}
                onChange={e => onChange({ entryStockPrice: e.target.value })} className={inputCls} />
            </label>
          </div>

          {/* Trailing Stop % */}
          <div>
            <label className={labelCls}>Trailing Stop %
              <div className="relative mt-1">
                <input type="number" min={1} max={30} step={0.5}
                  value={form.trailingStopPct}
                  onChange={e => onChange({ trailingStopPct: e.target.value })}
                  className={`${inputCls} !mt-0 pr-8`} />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-tertiary pointer-events-none">%</span>
              </div>
            </label>
            <p className="text-[10px] text-tertiary mt-0.5">Trailing stop follows the highest price down by this %</p>
          </div>

          {/* Account type + purchase date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Account Type
                <select value={form.accountType} onChange={e => onChange({ accountType: e.target.value as FormState['accountType'] })} className={inputCls}>
                  <option value="">— Select —</option>
                  <option value="TAXABLE">Taxable</option>
                  <option value="401K">401K</option>
                </select>
              </label>
            </div>
            <div>
              <label className={labelCls}>Purchase Date
                <input type="date" value={form.purchaseDate} onChange={e => onChange({ purchaseDate: e.target.value })} className={inputCls} />
              </label>
            </div>
          </div>

          {/* Auto-fill targets from live MA data */}
          <StockTargetsFetcher
            ticker={form.ticker}
            entryPrice={parseFloat(form.entryStockPrice) || undefined}
            onFill={targets => onChange(targets)}
          />

          {/* Targets + Hard Stop */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelCls}>Target 1
                <input value={form.target1} onChange={e => onChange({ target1: e.target.value })}
                  placeholder="MA20 zone" className={inputCls} />
              </label>
            </div>
            <div>
              <label className={labelCls}>Target 2
                <input value={form.target2} onChange={e => onChange({ target2: e.target.value })}
                  placeholder="MA50 zone" className={inputCls} />
              </label>
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Hard Stop Loss
                <input value={form.stopLoss} onChange={e => onChange({ stopLoss: e.target.value })}
                  placeholder="e.g. 195" className={inputCls} />
              </label>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className={labelCls}>{isEdit ? 'Contracts (rescales risk)' : 'Contracts *'}
              <input type="text" inputMode="numeric" value={form.contractCount}
                onChange={e => {
                  const digitsOnly = e.target.value.replace(/\D/g, '')
                  onChange({ contractCount: digitsOnly })
                }} className={inputCls} />
            </label>
            <label className={labelCls}>Stock Price @ Entry ($) *
              <input type="number" step="any" value={form.entryStockPrice}
                onChange={e => onChange({ entryStockPrice: e.target.value })} className={inputCls} />
            </label>
            {STRATEGY_DEFS[form.strategy]?.isCalendar ? (
              <div className="space-y-2">
                <label className={labelCls}>Front Expiry (short leg) *
                  <input type="date" value={form.expiry}
                    onChange={e => onChange({ expiry: e.target.value })} className={inputCls} />
                </label>
                <label className={labelCls}>Back Expiry (long leg) *
                  <input type="date" value={form.backExpiry}
                    onChange={e => onChange({ backExpiry: e.target.value })} className={inputCls} />
                </label>
              </div>
            ) : (
              <label className={labelCls}>Expiry *
                <input type="date" value={form.expiry}
                  onChange={e => onChange({ expiry: e.target.value })} className={inputCls} />
              </label>
            )}
          </div>

          {def && def.legs.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-secondary uppercase tracking-wide">Option Legs</div>
              {def.legs.map((tmpl, i) => (
                <div key={i} className="rounded-lg border border-slate-100 dark:border-white/[0.05] bg-slate-50 dark:bg-slate-800/50 p-3 space-y-2">
                  <div className={`text-xs font-bold ${tmpl.action === 'BUY' ? 'text-semantic-bullish' : 'text-semantic-bearish'}`}>
                    {tmpl.action} {tmpl.option_type} — {tmpl.label}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="min-w-0">
                      <label className={labelCls}>Strike Price *</label>
                      <input type="number" step="0.5" value={form.legStrikes[i]}
                        onChange={e => { const a = [...form.legStrikes]; a[i] = e.target.value; onChange({ legStrikes: a }) }}
                        className={inputCls} />
                    </div>
                    <div className="min-w-0">
                      <label className={labelCls}>Premium *</label>
                      <input type="number" step="0.01" value={form.legPremiums[i]}
                        onChange={e => { const a = [...form.legPremiums]; a[i] = e.target.value; onChange({ legPremiums: a }) }}
                        className={inputCls} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {legsComplete && (
            <div className="rounded-lg border border-slate-100 dark:border-white/[0.05] bg-slate-50 dark:bg-slate-800/50 p-3 text-xs font-mono space-y-1">
              <div className="text-slate-500 dark:text-slate-400 font-sans font-semibold text-[10px] uppercase tracking-wide mb-2">Computed</div>
              <div className="flex gap-4 flex-wrap">
                <span className={metrics.netCredit >= 0 ? 'text-semantic-bullish' : 'text-semantic-bearish'}>
                  {metrics.netCredit >= 0 ? 'Net Credit' : 'Net Debit'}: {metrics.netCredit >= 0 ? '+' : ''}${Math.abs(metrics.netCredit).toFixed(2)}/share
                </span>
                {cc > 0 && (
                  <>
                    <span className="text-emerald-400">Max Profit: ${(metrics.maxProfit * SHARES_PER_OPTION_CONTRACT * cc).toLocaleString()}</span>
                    <span className="text-rose-400">Max Loss: ${(metrics.maxLoss * SHARES_PER_OPTION_CONTRACT * cc).toLocaleString()}</span>
                  </>
                )}
              </div>
              {metrics.beLower > 0 && (
                <div className="text-tertiary">
                  Breakeven: ${metrics.beLower.toFixed(2)}{metrics.beUpper < 990 ? ` – $${metrics.beUpper.toFixed(2)}` : ''}
                </div>
              )}
            </div>
          )}

          {/* Options execution map — includes Breakout */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelCls}>Target 1
                <input value={form.target1} onChange={e => onChange({ target1: e.target.value })} placeholder="e.g. 225"
                  className={inputCls} />
              </label>
            </div>
            <div>
              <label className={labelCls}>Target 2
                <input value={form.target2} onChange={e => onChange({ target2: e.target.value })} placeholder="e.g. 240"
                  className={inputCls} />
              </label>
            </div>
            <div>
              <label className={labelCls}>Breakout
                <input value={form.breakout} onChange={e => onChange({ breakout: e.target.value })} placeholder="e.g. 215"
                  className={inputCls} />
              </label>
            </div>
            <div>
              <label className={labelCls}>Stop Loss
                <input value={form.stopLoss} onChange={e => onChange({ stopLoss: e.target.value })} placeholder="e.g. 195"
                  className={inputCls} />
              </label>
            </div>
          </div>
        </>
      )}

      <div>
        <label className={labelCls}>Notes
          <textarea value={form.notes} onChange={e => onChange({ notes: e.target.value })} rows={2}
            className={`${inputCls} resize-none`} />
        </label>
      </div>
    </div>
  )
}

type ActionAlert = {
  type: 'EXIT_NOW' | 'SELL_HALF' | 'WATCH' | 'MANAGE' | 'HOLD'
  label: string
  reason: string
  urgency: 'red' | 'amber' | 'blue' | 'green'
}

function deriveActionAlert(
  pos: PortfolioPosition,
  pnlData: { pnl: number; pnl_pct: number } | null | undefined,
  aiAnalysis: AiPositionAnalysis | null | undefined,
): ActionAlert {
  const dte = safeDte(pos.dte, 99)
  const pnlPct = pnlData?.pnl_pct ?? 0
  const pnlDollar = pnlData?.pnl ?? 0
  const strat = (pos.strategy || '').toLowerCase()
  const bias = (pos.bias || '').toLowerCase()

  // Day trade positions must close same day — DTE roll logic does not apply.
  if (deriveEngineSource(pos) === 'day') {
    const nowEt = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
    const h = nowEt.getHours(), m = nowEt.getMinutes()
    const afterClose = h > 15 || (h === 15 && m >= 45)
    if (afterClose) {
      return {
        type: 'EXIT_NOW',
        label: 'EXIT TODAY',
        urgency: 'red',
        reason: 'Day trade — market is closing. Exit now. Do not hold overnight; swing engine may not support this position.',
      }
    }
    // Stop loss hit — a day trade down 25% has violated its risk budget. Exit now;
    // never average down or "wait it out" on an intraday position.
    if (pnlPct <= -25)
      return {
        type: 'EXIT_NOW',
        label: 'EXIT NOW',
        urgency: 'red',
        reason: `Stop hit — down ${Math.abs(pnlPct).toFixed(0)}% intraday (≥25% loss). Exit now to preserve capital. Do not average down or hold a losing day trade.`,
      }
    if (pnlPct >= 50)
      return { type: 'SELL_HALF', label: 'TAKE PROFIT', urgency: 'amber', reason: `${pnlPct.toFixed(0)}% gain intraday — take profit or scale out. Day trades do not carry overnight.` }
    return {
      type: 'MANAGE',
      label: 'MANAGE STOP',
      urgency: 'amber',
      reason: `Day trade — close by 3:45 PM ET regardless of P&L. Trail stop to session VWAP. Do not hold overnight.`,
    }
  }

  if (dte <= 5)
    return { type: 'EXIT_NOW', label: 'EXIT NOW', urgency: 'red', reason: `Only ${dte} DTE left — theta is eroding value. Close or roll immediately.` }
  if (aiAnalysis && aiAnalysis.health_score < 35)
    return { type: 'EXIT_NOW', label: 'EXIT NOW', urgency: 'red', reason: aiAnalysis.next_best_action || 'Health critical — exit to preserve capital.' }

  const maxProfitTotal = (pos.max_profit ?? 0) * SHARES_PER_OPTION_CONTRACT * pos.contracts
  if (pos.status === 'open' && maxProfitTotal > 0 && pnlDollar >= maxProfitTotal * 0.5) {
    if (pos.partial_closed)
      return { type: 'EXIT_NOW', label: 'EXIT', urgency: 'amber', reason: `Already took partial profit. ${((pnlDollar / maxProfitTotal) * 100).toFixed(0)}% of max profit captured on remaining — close the rest.` }
    return { type: 'SELL_HALF', label: 'SELL HALF', urgency: 'amber', reason: `${((pnlDollar / maxProfitTotal) * 100).toFixed(0)}% of max profit captured. Sell ½ now, trail stop to entry.` }
  }
  if (pos.status === 'open' && pnlPct >= 50) {
    if (pos.partial_closed)
      return { type: 'EXIT_NOW', label: 'EXIT', urgency: 'amber', reason: `Already took partial profit. ${pnlPct.toFixed(0)}% gain on remaining — close the rest.` }
    return { type: 'SELL_HALF', label: 'SELL HALF', urgency: 'amber', reason: `${pnlPct.toFixed(0)}% gain — take partial profit and trail stop.` }
  }

  if (dte <= 14)
    return { type: 'WATCH', label: 'WATCH', urgency: 'amber', reason: `${dte} DTE. At ${Math.max(1, dte - 5)} DTE close if ≥50% max profit, otherwise prepare a roll.` }

  if (strat.includes('spread') || strat.includes('condor') || strat.includes('iron'))
    return { type: 'MANAGE', label: 'MANAGE', urgency: 'blue', reason: 'Multi-leg: buy back short leg if it goes ITM with <7 DTE. Stop if net loss > 2× credit.' }

  const holdReason = bias.includes('bull')
    ? 'Bullish thesis intact. Trail stop to last swing low. Target 50% profit for partial close.'
    : bias.includes('bear')
    ? 'Bearish thesis intact. Exit if price reclaims VWAP or prior resistance with volume.'
    : `${dte} DTE remaining. Profit target: 50% of max credit. Stop: 2× premium paid.`
  return { type: 'HOLD', label: 'HOLD', urgency: 'green', reason: holdReason }
}

function SimplifiedPositionDetails({
  pos,
  actionAlert,
  aiAnalysis,
  displayPnl,
  sourceKind,
}: {
  pos: PortfolioPosition
  actionAlert: ActionAlert
  aiAnalysis?: AiPositionAnalysis | null
  displayPnl?: { pnl: number; pnl_pct: number } | null
  sourceKind: 'day' | 'swing' | 'regular'
}) {
  const exitRules = deriveExitRules(pos).slice(0, 3)
  const isClosed = pos.status === 'closed'
  const outcome = displayPnl?.pnl != null
    ? displayPnl.pnl > 0 ? 'Winner' : displayPnl.pnl < 0 ? 'Loser' : 'Breakeven'
    : 'Recorded'
  const outcomeCls = displayPnl?.pnl != null
    ? displayPnl.pnl > 0 ? 'text-emerald-600 dark:text-emerald-400' : displayPnl.pnl < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-muted'
    : 'text-secondary'
  const note = isClosed ? (pos.close_notes || pos.notes) : pos.notes

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-[1.1fr_1fr]">
        <div className="rounded-lg border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-white/[0.03] p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">
              {isClosed ? 'Trade Summary' : 'Position Snapshot'}
            </div>
            {sourceStyleBadge(sourceKind)}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
            <div>
              <div className="text-muted">Opened</div>
              <div className="font-semibold text-secondary">{pos.addedAt ? new Date(pos.addedAt).toLocaleDateString() : '—'}</div>
            </div>
            <div>
              <div className="text-muted">{isClosed ? 'Closed' : 'Expiry'}</div>
              <div className="font-semibold text-secondary">{isClosed ? (pos.exitDate ? new Date(pos.exitDate).toLocaleDateString() : '—') : (pos.expiry || '—')}</div>
            </div>
            <div>
              <div className="text-muted">Strategy</div>
              <div className="font-semibold text-secondary">{stratelabel(pos.strategy)}</div>
            </div>
            <div>
              <div className="text-muted">Size</div>
              <div className="font-semibold text-secondary">{pos.contracts} {pos.strategy === 'Stock' ? 'shares' : 'contracts'}</div>
            </div>
            <div>
              <div className="text-muted">Entry Stock</div>
              <div className="font-mono font-semibold text-secondary">{fmtUsd(pos.entryPrice)}</div>
            </div>
            <div>
              <div className="text-muted">{isClosed ? 'Exit Price' : 'DTE'}</div>
              <div className="font-mono font-semibold text-secondary">{isClosed ? fmtUsd(pos.exit_price) : (safeDte(pos.dte, 0) > 0 ? `${safeDte(pos.dte, 99)}` : '—')}</div>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-white/[0.03] p-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted">
            {isClosed ? 'Exit Record' : 'Action Plan'}
          </div>
          {isClosed ? (
            <div className="space-y-2 text-[11px]">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted">Outcome</span>
                <span className={`font-bold ${outcomeCls}`}>{outcome}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted">Realized P&L</span>
                <span className={`font-mono font-bold ${outcomeCls}`}>{displayPnl ? fmtUsd(displayPnl.pnl) : fmtUsd(pos.realized_pnl)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted">Return</span>
                <span className={`font-mono font-bold ${outcomeCls}`}>{displayPnl ? fmtPct(displayPnl.pnl_pct) : fmtPct(pos.realized_pnl_percent ?? pos.pnlPct)}</span>
              </div>
              <div className="rounded-md bg-slate-50 dark:bg-slate-900/60 px-2 py-1.5">
                <div className="text-muted">Reason</div>
                <div className="font-semibold text-secondary">{pos.exit_reason || '—'}</div>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="rounded-md border border-slate-200 dark:border-white/[0.07] bg-slate-50 dark:bg-slate-900/60 px-2.5 py-2 text-xs text-secondary">
                <div className="mb-1 flex items-center gap-1.5">
                  <span className="rounded bg-violet-600 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-white">{actionAlert.label}</span>
                  <span className="font-semibold text-primary">Next action</span>
                </div>
                <p className="leading-snug">{actionAlert.reason}</p>
              </div>
              {exitRules.map((rule, i) => (
                <div key={i} className="rounded-md bg-slate-50 dark:bg-slate-900/60 px-2.5 py-1.5 text-[11px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-secondary">{rule.trigger}</span>
                    <span className="font-mono font-bold text-violet-500 dark:text-violet-300">{rule.price == null ? 'Time' : fmtUsd(rule.price)}</span>
                  </div>
                  <div className="mt-0.5 text-muted">{rule.action}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {pos.legs && pos.legs.length > 0 && (
        <div className="rounded-lg border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-white/[0.03] p-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted">Option Legs</div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {pos.legs.map((leg, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 rounded-md bg-slate-50 dark:bg-slate-900/60 px-2.5 py-1.5 font-mono text-[11px] text-secondary">
                <span className={`font-bold ${leg.action === 'BUY' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{leg.action}</span>
                <span>{leg.option_type}</span>
                <span>${leg.strike.toFixed(1)}</span>
                <span className="text-muted">{leg.expiry}</span>
                {leg.mid_price > 0 && <span className="text-muted">@ ${leg.mid_price.toFixed(2)}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {!isClosed && aiAnalysis && (
        <div className="rounded-lg border border-violet-400/25 bg-violet-50 dark:bg-violet-500/10 p-3 text-xs text-violet-800 dark:text-violet-100">
          <div className="mb-1 flex items-center gap-1.5 font-bold uppercase tracking-wide text-violet-900 dark:text-violet-200">
            <BrainCircuit size={13} /> Coach
          </div>
          <p className="leading-snug">{aiAnalysis.ai_summary}</p>
          {aiAnalysis.next_best_action && (
            <p className="mt-1.5 leading-snug"><span className="font-bold">Next:</span> {aiAnalysis.next_best_action}</p>
          )}
        </div>
      )}

      {note && <p className="rounded-lg border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-white/[0.03] p-3 text-sm italic text-secondary">{note}</p>}
    </div>
  )
}

function TradingPositionCard({
  pos,
  expanded,
  pnlData,
  aiAnalysis,
  exitBadge,
  onToggle,
  onClose,
  onManage,
  onAlert,
  onDelete,
}: {
  pos: PortfolioPosition
  expanded: boolean
  pnlData?: {
    pnl: number
    pnl_pct: number
    entry_premium_per_share?: number
    current_mark_per_share?: number
    mark_source?: 'live' | 'bs_theoretical' | 'stale'
  } | null
  aiAnalysis?: AiPositionAnalysis | null
  exitBadge?: string | null
  onToggle: () => void
  onClose: () => void
  onManage: () => void
  onAlert: () => void
  onDelete: () => void
}) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const actionAlert = deriveActionAlert(pos, pnlData, aiAnalysis)
  const liveExitLabel = normalizeExitBadgeLabel(exitBadge)
  // Header badge is always driven by actionAlert so it can't contradict the action strip.
  const aiStatus = pos.status !== 'open'
    ? deriveAiStatus(pos)
    : liveExitLabel || (
      actionAlert.type === 'EXIT_NOW'  ? 'EXIT NOW'
      : actionAlert.type === 'SELL_HALF' ? 'TAKE PROFIT'
      : actionAlert.label
    )
  const sourceKind = deriveEngineSource(pos)
  const guidance = deriveAiGuidance(pos)
  const isExpiringSoon = (safeDte(pos.dte, 99)) <= 7
  const dteForDisplay = safeDte(pos.dte, 0) > 0 ? String(safeDte(pos.dte, 99)) : '—'

  // For closed positions, always prefer the user-entered realized_pnl over the
  // server-calculated perPositionPnl (which uses the old pnlPct-based formula).
  // The server formula can return wrong values for debit spreads, so the
  // authoritative source is the stored realized_pnl / realized_pnl_percent.
  const closedPnl = pos.status === 'closed' ? (() => {
    if (pos.realized_pnl != null && Number.isFinite(pos.realized_pnl)) {
      if (pos.net_credit < 0 && pos.pnlPct != null && pos.max_profit > 0) {
        const buggyCalc = (pos.pnlPct / 100) * pos.max_profit * 100 * pos.contracts
        if (Math.abs(pos.realized_pnl - buggyCalc) < 1) {
          const corrected = computePnlDollar(pos)
          if (corrected != null) {
            return { pnl: corrected, pnl_pct: pos.realized_pnl_percent ?? pos.pnlPct }
          }
        }
      }
      const rawPct = pos.realized_pnl_percent ?? pos.pnlPct
      if (rawPct != null && Number.isFinite(rawPct)) {
        if (pos.net_credit < 0) {
          const costBasis = Math.abs(pos.net_credit) * 100 * pos.contracts
          if (costBasis > 0) {
            const expectedPct = (pos.realized_pnl / costBasis) * 100
            if (Math.abs(rawPct - expectedPct) > 20) {
              return { pnl: pos.realized_pnl, pnl_pct: expectedPct }
            }
          }
        }
        return { pnl: pos.realized_pnl, pnl_pct: rawPct }
      }
      return { pnl: pos.realized_pnl, pnl_pct: 0 }
    }
    // Fallback: estimate from pnlPct or entry/exit price difference
    const d = computePnlDollar(pos)
    if (d != null) return { pnl: d, pnl_pct: pos.pnlPct ?? 0 }
    // Last resort: compute from entry_price vs exit_price
    const entryP = pos.entryPrice || 0
    const exitP = pos.exit_price || 0
    if (entryP > 0 && exitP > 0) {
      const multiplier = pos.strategy === 'Stock' ? 1 : 100
      const estPnl = (exitP - entryP) * pos.contracts * multiplier
      const costBas = entryP * pos.contracts * multiplier
      const estPct = costBas > 0 ? (estPnl / costBas) * 100 : 0
      return { pnl: estPnl, pnl_pct: estPct }
    }
    return null
  })() : null

  const displayPnl = (pos.status === 'closed' && closedPnl != null)
    ? closedPnl
    : pnlData ?? null

  const pnlColor = displayPnl
    ? displayPnl.pnl > 0 ? 'text-emerald-600 dark:text-emerald-400' : displayPnl.pnl < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-muted'
    : 'text-muted'

  const isCredit = pos.net_credit >= 0
  const creditTotal = computeCreditTotal(pos)
  const creditPer = creditPerContract(pos)

  const accentBorder =
    aiStatus === 'EXIT NOW' || aiStatus === 'THESIS INVALID' || aiStatus === 'TIME STOP'
      ? 'border-l-red-500'
      : aiStatus === 'HOLD' || aiStatus === 'EXIT'
        ? 'border-l-emerald-500'
        : aiStatus === 'WATCH' || aiStatus === 'EXIT SOON' || aiStatus === 'TAKE PROFIT' || aiStatus === 'TARGET HIT' || aiStatus === 'REDUCE'
          ? 'border-l-amber-400'
          : aiStatus === 'CONFLICT'
            ? 'border-l-fuchsia-500'
            : aiStatus === 'MANAGE'
              ? 'border-l-blue-400'
              : 'border-l-slate-300 dark:border-l-slate-700'

  return (
    <article className={`w-full rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900 transition-shadow border-l-[3px] ${accentBorder}`}>

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-2 px-3 pt-2.5 pb-2">

        {/* Left: identity */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-mono text-base font-bold tracking-tight text-heading">{pos.ticker}</span>
            {sourceStyleBadge(sourceKind)}
            <AIStatusBadge status={aiStatus} />
            {isExpiringSoon && (
              <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-400">
                <AlertTriangle size={9} />exp
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0 text-[11px] text-muted">
            <span className="text-secondary">{stratelabel(pos.strategy)}</span>
            {pos.bias && <span className="opacity-60">{pos.bias.replace(/_/g, ' ')}</span>}
            <span className="opacity-40">·</span>
            <span>{pos.contracts}× {pos.expiry || '—'}</span>
            {safeDte(pos.dte, 0) > 0 && (
              <span className={isExpiringSoon ? 'font-semibold text-amber-400' : ''}>{dteForDisplay} DTE</span>
            )}
            {pos.status === 'open' && creditTotal > 0 && (
              <span className={isCredit ? 'font-medium text-emerald-400' : 'font-medium text-amber-400'}>
                {isCredit ? 'Cr' : 'Dr'} {fmtUsd(creditTotal)}
              </span>
            )}
            {aiAnalysis?.current_price != null && aiAnalysis.current_price > 0 && (
              <span className="font-medium tabular-nums text-secondary">
                ${aiAnalysis.current_price.toFixed(2)}
              </span>
            )}
          </div>
        </div>

        {/* Right: P&L hero */}
        <div className="shrink-0 text-right">
          {displayPnl ? (
            <>
              <div className={`font-mono text-xl font-bold tabular-nums leading-tight tracking-tight ${pnlColor}`}>
                {displayPnl.pnl >= 0 ? '+' : ''}{fmtUsd(displayPnl.pnl)}
              </div>
              {displayPnl.pnl_pct != null && (
              <div className={`text-[11px] font-semibold tabular-nums tracking-tight ${pnlColor}`}>
                {displayPnl.pnl_pct >= 0 ? '+' : ''}{displayPnl.pnl_pct.toFixed(2)}%
              </div>
              )}
              <div className="mt-1 flex gap-1 justify-end">
                {pos.status === 'open' && displayPnl.pnl > 0 && (displayPnl.pnl_pct ?? 0) > 30 && <ProtectProfitsBadge />}
                <PlBadge pnl={displayPnl.pnl} />
                {pos.status === 'closed' && <ExitBadge />}
              </div>
            </>
          ) : pos.status === 'open' ? (
            <>
              <div className="font-mono text-base font-bold text-heading leading-tight tracking-tight">{fmtUsd(pos.entryPrice)}</div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">entry</div>
            </>
          ) : null}
        </div>
      </div>

      {/* ── Action Strip (always visible) ── */}
      {pos.status === 'open' && (() => {
        const alert = actionAlert
        const stripCls = alert.urgency === 'red'   ? 'border-red-500/30'
          : alert.urgency === 'amber' ? 'border-amber-500/30'
          : alert.urgency === 'blue'  ? 'border-sky-500/30'
          : 'border-emerald-500/30'
        const badgeCls = alert.urgency === 'red'   ? 'bg-red-100 text-red-700 dark:bg-red-600 dark:text-white'
          : alert.urgency === 'amber' ? 'bg-amber-100 text-amber-700 dark:bg-amber-600 dark:text-white'
          : alert.urgency === 'blue'  ? 'bg-sky-100 text-sky-700 dark:bg-sky-600 dark:text-white'
          : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-600 dark:text-white'
        const textCls = 'text-gray-600 dark:text-gray-400'
        return (
          <div className={`flex items-start gap-2.5 border-t px-3 py-2 ${stripCls}`}>
            <span className={`mt-px shrink-0 rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest ${badgeCls}`}>
              {alert.label}
            </span>
            <span className={`text-xs leading-snug ${textCls}`}>{alert.reason}</span>
          </div>
        )
      })()}

      {/* ── Footer: actions ── */}
      <div className="flex items-center gap-1 border-t border-slate-100 dark:border-white/[0.05] px-3 py-1.5">
        {pos.status === 'open' && (
          <>
            <button type="button" onClick={onClose} className={`${getActionButtonClass('alert')} px-2 py-0.5 text-[10px]`}>Close</button>
            <button type="button" onClick={onManage} className={`${getActionButtonClass('trade')} inline-flex items-center gap-0.5 px-2 py-0.5 text-[10px]`}>
              <Edit3 size={10} />Edit
            </button>
            <button type="button" onClick={onAlert} className={`${getActionButtonClass('alert')} px-2 py-0.5 text-[10px]`}>Alert</button>
          </>
        )}
        {pos.status === 'closed' && (
          <button type="button" onClick={onManage} className={`${getActionButtonClass('surface')} px-2 py-0.5 text-[10px]`}>Review</button>
        )}
        <button type="button" onClick={onDelete} className="inline-flex items-center gap-0.5 px-2 py-0.5 text-[10px] text-rose-400 hover:text-rose-300 hover:bg-rose-900/20 rounded-lg transition-colors" title="Delete position">
          <Trash2 size={10} />Delete
        </button>
        <button
          type="button"
          onClick={onToggle}
          className={`${getActionButtonClass('surface')} ml-auto inline-flex items-center gap-0.5 px-2 py-0.5 text-[10px]`}
        >
          {expanded ? <><ChevronUp size={10} />Less</> : <><ChevronDown size={10} />Details</>}
        </button>
      </div>

      {/* ── Expanded details ── */}
      {expanded && (
        <div className="border-t border-slate-100 dark:border-white/[0.05] bg-gray-50 dark:bg-slate-800/40 px-3 py-3 space-y-3 rounded-b-xl">
          <SimplifiedPositionDetails
            pos={pos}
            actionAlert={actionAlert}
            aiAnalysis={aiAnalysis}
            displayPnl={displayPnl}
            sourceKind={sourceKind}
          />

          {Boolean(0) && pnlData && aiAnalysis && displayPnl && pos.exitDate && aiAnalysis.value_capture_pct != null && (
            <>
          {/* ── SECTION 1: Premium Tracker (always visible when expanded) ── */}
          {pos.status === 'open' && pnlData?.entry_premium_per_share != null && pnlData?.current_mark_per_share != null && (() => {
            const entry  = pnlData.entry_premium_per_share!
            const curr   = pnlData.current_mark_per_share!
            const isCredit = pos.net_credit >= 0
            const changePct  = pnlData.pnl_pct
            const changeAmt  = curr - entry
            const isProfiting = pnlData.pnl > 0
            const changeColor = isProfiting ? 'text-emerald-600 dark:text-emerald-400' : pnlData.pnl < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-muted'
            const arrowChar   = isProfiting ? '▲' : pnlData.pnl < 0 ? '▼' : '—'
            const src = pnlData.mark_source
            const srcLabel = src === 'live' ? 'Live' : src === 'bs_theoretical' ? 'Est.' : 'Stale'
            const srcDot   = src === 'live' ? 'bg-emerald-400' : src === 'bs_theoretical' ? 'bg-amber-400' : 'bg-gray-500'
            return (
              <div className="rounded-lg border border-slate-200 dark:border-white/[0.08] bg-slate-50 dark:bg-white/[0.02] px-3 py-2.5">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">Premium</div>
                  <div className="flex items-center gap-1">
                    <span className={`inline-block h-1.5 w-1.5 rounded-full ${srcDot}`} />
                    <span className="text-[10px] text-muted">{srcLabel}</span>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div>
                    <div className="text-[10px] text-muted mb-0.5">{isCredit ? 'Credit received' : 'Paid'}</div>
                    <div className="font-mono font-bold text-primary tabular-nums">${Math.abs(entry).toFixed(2)}<span className="text-[10px] text-muted font-normal">/sh</span></div>
                    <div className="text-[10px] text-muted">${(Math.abs(entry) * 100 * pos.contracts).toFixed(0)} total</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted mb-0.5">{isCredit ? 'Cost to close' : 'Current'}</div>
                    <div className={`font-mono font-bold tabular-nums ${changeColor}`}>${Math.abs(curr).toFixed(2)}<span className="text-[10px] font-normal opacity-60">/sh</span></div>
                    <div className="text-[10px] text-muted">${(Math.abs(curr) * 100 * pos.contracts).toFixed(0)} total</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted mb-0.5">Change</div>
                    <div className={`font-mono font-bold tabular-nums ${changeColor}`}><span className="mr-0.5 text-[10px]">{arrowChar}</span>{changeAmt >= 0 ? '+' : ''}${changeAmt.toFixed(2)}<span className="text-[10px] font-normal opacity-60">/sh</span></div>
                    <div className={`text-[10px] font-semibold tabular-nums ${changeColor}`}>{changePct >= 0 ? '+' : ''}{changePct.toFixed(1)}%</div>
                  </div>
                </div>
              </div>
            )
          })()}

          {/* ── SECTION 2: Exit Plan (always visible when expanded) ── */}
          {pos.status === 'open' && (() => {
            const rules = deriveExitRules(pos)
            if (rules.length === 0) return null
            const _leg       = pos.legs?.[0]
            const _entryPrem = _leg?.mid_price != null && _leg.mid_price > 0 ? _leg.mid_price : Math.abs(pos.net_credit)
            const _delta     = _leg?.delta != null && Math.abs(_leg.delta) > 0 ? Math.abs(_leg.delta) : 0.5
            const _entryStock = pos.entryPrice > 0 ? pos.entryPrice : 0
            const _isPut     = _leg?.option_type === 'PUT'
            const estPremium = (targetStockPrice: number | null): number | null => {
              if (targetStockPrice == null || _entryStock <= 0 || _entryPrem <= 0) return null
              const move = _isPut ? (_entryStock - targetStockPrice) : (targetStockPrice - _entryStock)
              return Math.max(0.01, parseFloat((_entryPrem + _delta * move).toFixed(2)))
            }
            return (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-1.5">Exit Plan</div>
                {_entryPrem > 0 && _entryStock > 0 && (
                  <div className="mb-2 flex items-center gap-2 text-[10px] text-gray-500">
                    <span>Entry premium</span>
                    <span className="font-mono font-semibold text-violet-400">${_entryPrem.toFixed(2)}</span>
                    <span className="text-gray-600">δ={_delta.toFixed(2)}{_leg?.delta == null ? ' est.' : ''}</span>
                    <span className="text-gray-600">→ target premium shown per row</span>
                  </div>
                )}
                <div className="space-y-1">
                  {rules.map((rule, i) => {
                    const isStop    = rule.trigger.toLowerCase().includes('stop') || rule.trigger.toLowerCase().includes('loss')
                    const isTarget2 = rule.trigger.toLowerCase().includes('target 2') || rule.trigger.toLowerCase().includes('100%')
                    const isTarget1 = rule.trigger.toLowerCase().includes('target 1') || rule.trigger.toLowerCase().includes('50%') || rule.trigger.toLowerCase().includes('captured')
                    const isTime    = rule.price == null
                    const isEOD     = rule.trigger.toLowerCase().includes('close') && isTime
                    const dotCls    = isStop ? 'bg-red-400' : isTarget2 ? 'bg-orange-400' : isTarget1 ? 'bg-emerald-400' : isTime ? 'bg-amber-400' : 'bg-sky-400'
                    const priceCls  = isStop ? 'text-red-400' : isTarget2 ? 'text-orange-300' : isTarget1 ? 'text-emerald-400' : 'text-amber-400'
                    const actionCls = isStop ? 'text-red-700 dark:text-red-300' : isTarget2 ? 'text-orange-700 dark:text-orange-200' : isTarget1 ? 'text-emerald-700 dark:text-emerald-300' : isTime ? 'text-amber-700 dark:text-amber-300' : 'text-secondary'
                    const priceLabel = (() => {
                      if (isEOD) return 'EOD'
                      if (isTime) return 'time-based'
                      if (rule.price == null) return '—'
                      const isDerived = (rule.trigger.includes('50%') || rule.trigger.includes('Loss reaches') || rule.trigger.includes('max profit'))
                      if (isDerived && pos.strategy === 'Stock' && pos.entryPrice > 0) {
                        const isProfit = rule.trigger.includes('50%') || rule.trigger.includes('profit')
                        const targetPx = isProfit ? pos.entryPrice + rule.price / pos.contracts : pos.entryPrice - rule.price / pos.contracts
                        return `$${targetPx.toFixed(2)}`
                      }
                      if (isDerived) {
                        const perShare = rule.price / 100 / (pos.contracts || 1)
                        return `$${perShare.toFixed(2)}`
                      }
                      return `$${rule.price.toFixed(2)}`
                    })()
                    const estPrem = isTime ? null : estPremium(rule.price)
                    const estPremCls = isStop
                      ? 'text-rose-400 border-rose-800/50 bg-rose-950/30'
                      : isTarget2 ? 'text-orange-300 border-orange-800/50 bg-orange-950/30'
                      : isTarget1 ? 'text-emerald-400 border-emerald-800/50 bg-emerald-950/30'
                      : 'text-amber-400 border-amber-800/50 bg-amber-950/30'
                    return (
                      <div key={i} className="flex items-start gap-2 rounded-lg border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-white/[0.03] px-2.5 py-1.5">
                        <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dotCls}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className={`font-mono text-[11px] font-bold tabular-nums ${priceCls}`}>{priceLabel}</span>
                            <span className={`text-[11px] font-semibold ${actionCls}`}>→ {rule.action}</span>
                            {estPrem != null && (
                              <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${estPremCls}`}>prem ~${estPrem.toFixed(2)}</span>
                            )}
                          </div>
                          <div className="text-[10px] text-muted leading-snug">{rule.note}</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {/* ── SECTION 3: Details (folded) ── */}
          <div>
            <button
              type="button"
              onClick={() => setDetailsOpen(o => !o)}
              className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted hover:text-secondary transition-colors"
            >
              {detailsOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              {detailsOpen ? 'Hide details' : 'Show details'}
            </button>
            {detailsOpen && (
              <div className="mt-3 space-y-3">

          {aiAnalysis ? (
            /* ── AI Coach ── */
            <div className="space-y-3">

              {/* Health bar */}
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <span className="font-semibold text-secondary">Health</span>
                    <span className={`font-bold tabular-nums ${
                      aiAnalysis.health_score >= 75 ? 'text-emerald-400'
                      : aiAnalysis.health_score >= 60 ? 'text-amber-400'
                      : aiAnalysis.health_score >= 40 ? 'text-orange-400'
                      : 'text-rose-400'
                    }`}>{aiAnalysis.health_score}/100</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${
                      aiAnalysis.health_score >= 75 ? 'bg-emerald-400'
                      : aiAnalysis.health_score >= 60 ? 'bg-amber-400'
                      : aiAnalysis.health_score >= 40 ? 'bg-orange-400'
                      : 'bg-rose-400'
                    }`} style={{ width: `${aiAnalysis.health_score}%` }} />
                  </div>
                </div>
                <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                  aiAnalysis.health_label === 'STRONG_TREND' ? 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400'
                  : aiAnalysis.health_label === 'HEALTHY' ? 'border-emerald-400/40 text-emerald-600 dark:text-emerald-300'
                  : aiAnalysis.health_label === 'CAUTION' ? 'border-amber-400/40 text-amber-700 dark:text-amber-400'
                  : aiAnalysis.health_label === 'WEAKENING' ? 'border-orange-400/40 text-orange-700 dark:text-orange-400'
                  : 'border-rose-400/40 text-rose-700 dark:text-rose-400'
                }`}>{aiAnalysis.health_label.replace(/_/g, ' ')}</span>
              </div>

              {/* State + Timeline */}
              <div className="flex flex-wrap gap-1.5">
                <AIStatusBadge status={aiAnalysis.state_label} />
                <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                  aiAnalysis.timeline_stage === 'EXIT_SOON' ? 'border-rose-400/40 text-rose-700 dark:text-rose-400'
                  : aiAnalysis.timeline_stage === 'ROLL_WINDOW' ? 'border-amber-400/40 text-amber-700 dark:text-amber-400'
                  : aiAnalysis.timeline_stage === 'PROFIT_PROTECTION' ? 'border-sky-400/40 text-sky-700 dark:text-sky-400'
                  : aiAnalysis.timeline_stage === 'RISK_MANAGEMENT' ? 'border-orange-400/40 text-orange-700 dark:text-orange-400'
                  : 'border-emerald-400/40 text-emerald-700 dark:text-emerald-400'
                }`}>{aiAnalysis.timeline_stage.replace(/_/g, ' ')}</span>
              </div>

              {/* AI summary */}
              <div className="flex items-start gap-1.5 text-sm text-secondary">
                <BrainCircuit size={13} className="mt-px shrink-0 text-violet-400" />
                <p className="leading-snug">{aiAnalysis.ai_summary}</p>
              </div>

              {/* Next action */}
              <div className="rounded-lg border border-violet-400/30 bg-violet-50 dark:bg-violet-500/10 px-3 py-2 text-xs font-medium text-violet-700 dark:text-violet-200">
                <span className="font-bold uppercase tracking-wide text-violet-800 dark:text-violet-300">Next:</span> {aiAnalysis.next_best_action}
              </div>

              {/* Smart alerts */}
              {aiAnalysis.smart_alerts.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-muted">Smart Alerts</div>
                  {aiAnalysis.smart_alerts.map((a, i) => (
                    <div key={i} className={`flex items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] ${
                      a.severity === 'CRITICAL' ? 'border-rose-400/40 bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300'
                      : a.severity === 'WARNING' ? 'border-amber-400/40 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300'
                      : 'border-sky-400/40 bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-300'
                    }`}>
                      <AlertTriangle size={11} className="mt-px shrink-0" />
                      <span>{a.message}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Risk breakdown */}
              <div className="space-y-1">
                <div className="text-[10px] font-bold uppercase tracking-wide text-muted">Risk Factors</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-[10px]">
                  {[
                    { label: 'Extension', value: aiAnalysis.extension_risk },
                    { label: 'Theta', value: aiAnalysis.theta_risk },
                    { label: 'RSI', value: aiAnalysis.rsi_risk },
                    { label: 'IV', value: aiAnalysis.iv_risk },
                    { label: 'Trend', value: aiAnalysis.trend_risk },
                    { label: 'Liquidity', value: aiAnalysis.liquidity_risk },
                    { label: 'Market Corr.', value: aiAnalysis.market_correlation_risk },
                  ].map(r => (
                    <div key={r.label} className={`rounded border px-2 py-1 font-semibold ${
                      r.value === 'HIGH' || r.value === 'CRITICAL' ? 'border-rose-400/20 bg-rose-500/10 text-rose-400'
                      : r.value === 'MODERATE' ? 'border-amber-400/20 bg-amber-500/10 text-amber-400'
                      : 'border-emerald-400/20 bg-emerald-500/10 text-emerald-400'
                    }`}>
                      <span className="text-muted font-normal">{r.label}</span>{' '}{r.value}
                    </div>
                  ))}
                </div>
              </div>

              {/* Management playbook */}
              {aiAnalysis.management_playbook.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-muted">Playbook</div>
                  <ul className="space-y-0.5">
                    {aiAnalysis.management_playbook.map((step, i) => (
                      <li key={i} className="flex items-center gap-1.5 text-[11px] text-secondary">
                        <span className="h-1 w-1 rounded-full bg-violet-400 shrink-0" />
                        {step}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Momentum */}
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
                <span>Momentum: <span className={`font-semibold ${
                  aiAnalysis.momentum_quality === 'STRONG' ? 'text-emerald-400'
                  : aiAnalysis.momentum_quality === 'MODERATE' ? 'text-amber-400'
                  : 'text-rose-400'
                }`}>{aiAnalysis.momentum_quality}</span></span>
                <span>RSI: <span className={`font-semibold tabular-nums ${
                  aiAnalysis.rsi > 70 || aiAnalysis.rsi < 30 ? 'text-rose-400'
                  : 'text-secondary'
                }`}>{aiAnalysis.rsi.toFixed(1)}</span></span>
                <span>Price: <span className="font-semibold tabular-nums text-secondary">${aiAnalysis.current_price.toFixed(2)}</span></span>
                <span>MA20: <span className="font-semibold tabular-nums text-secondary">${aiAnalysis.ma20.toFixed(2)}</span></span>
                {aiAnalysis.extension_pct != null && (
                  <span>Ext: <span className={`font-semibold tabular-nums ${
                    Math.abs(aiAnalysis.extension_pct) > 8 ? 'text-rose-400' : 'text-secondary'
                  }`}>{aiAnalysis.extension_pct >= 0 ? '+' : ''}{aiAnalysis.extension_pct.toFixed(1)}%</span></span>
                )}
                {aiAnalysis.value_capture_pct != null && (
                  <span>Value: <span className="font-semibold tabular-nums text-sky-400">{aiAnalysis.value_capture_pct.toFixed(0)}%</span></span>
                )}
              </div>
            </div>
          ) : (
            /* Fallback: simple AI guidance */
            <div className="flex items-start gap-1.5 text-sm text-secondary">
              <BrainCircuit size={13} className="mt-px shrink-0 text-violet-400" />
              <p className="leading-snug">{guidance}</p>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-white/[0.03] p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">Entry Criteria</div>
                {sourceStyleBadge(sourceKind)}
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
                <div>
                  <div className="text-muted">Opened</div>
                  <div className="font-semibold text-secondary">{pos.addedAt ? new Date(pos.addedAt).toLocaleDateString() : '—'}</div>
                </div>
                <div>
                  <div className="text-muted">Entry Stock</div>
                  <div className="font-mono font-semibold text-secondary">{fmtUsd(pos.entryPrice)}</div>
                </div>
                <div>
                  <div className="text-muted">Size</div>
                  <div className="font-semibold text-secondary">{pos.contracts} {pos.strategy === 'Stock' ? 'shares' : 'contracts'}</div>
                </div>
                <div>
                  <div className="text-muted">Expiry</div>
                  <div className="font-semibold text-secondary">{pos.expiry || '—'}</div>
                </div>
                {pos.target1 != null && (
                  <div>
                    <div className="text-muted">Target 1</div>
                    <div className="font-mono font-semibold text-emerald-400">{fmtUsd(pos.target1)}</div>
                  </div>
                )}
                {pos.target2 != null && (
                  <div>
                    <div className="text-muted">Target 2</div>
                    <div className="font-mono font-semibold text-orange-300">{fmtUsd(pos.target2)}</div>
                  </div>
                )}
                {pos.breakout != null && (
                  <div>
                    <div className="text-muted">Breakout</div>
                    <div className="font-mono font-semibold text-sky-400">{fmtUsd(pos.breakout)}</div>
                  </div>
                )}
                {pos.stopLoss != null && (
                  <div>
                    <div className="text-muted">Stop</div>
                    <div className="font-mono font-semibold text-rose-400">{fmtUsd(pos.stopLoss)}</div>
                  </div>
                )}
              </div>
              {pos.legs && pos.legs.length > 0 && (
                <div className="mt-3 space-y-1">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Option Legs</div>
                  {pos.legs.map((leg, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2 rounded-md bg-slate-50 dark:bg-slate-900/60 px-2 py-1 font-mono text-[11px] text-secondary">
                      <span className={`font-bold ${leg.action === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}`}>{leg.action}</span>
                      <span>{leg.option_type === 'CALL' ? 'CALL' : 'PUT'}</span>
                      <span>${leg.strike.toFixed(1)}</span>
                      <span className="text-muted">{leg.expiry}</span>
                      {leg.mid_price > 0 && <span className="text-muted">@ ${leg.mid_price.toFixed(2)}</span>}
                      {leg.delta != null && <span className="text-muted">Δ{leg.delta.toFixed(2)}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-white/[0.03] p-3">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted">
                {pos.status === 'closed' ? 'Exit Record' : 'Exit Criteria'}
              </div>
              {pos.status === 'closed' ? (
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
                  <div>
                    <div className="text-muted">Closed</div>
                    <div className="font-semibold text-secondary">{pos.exitDate ? new Date(pos.exitDate).toLocaleDateString() : '—'}</div>
                  </div>
                  <div>
                    <div className="text-muted">Exit Price</div>
                    <div className="font-mono font-semibold text-secondary">{fmtUsd(pos.exit_price)}</div>
                  </div>
                  <div>
                    <div className="text-muted">Realized P&L</div>
                    <div className={`font-mono font-semibold ${displayPnl && displayPnl.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{displayPnl ? fmtUsd(displayPnl.pnl) : fmtUsd(pos.realized_pnl)}</div>
                  </div>
                  <div>
                    <div className="text-muted">Return</div>
                    <div className={`font-mono font-semibold ${displayPnl && displayPnl.pnl_pct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{displayPnl ? fmtPct(displayPnl.pnl_pct) : fmtPct(pos.realized_pnl_percent ?? pos.pnlPct)}</div>
                  </div>
                  <div className="col-span-2">
                    <div className="text-muted">Reason</div>
                    <div className="font-semibold text-secondary">{pos.exit_reason || '—'}</div>
                  </div>
                  {pos.pnl_overridden && (
                    <div className="col-span-2 rounded-md border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-amber-400">
                      Manual P&L override was used for this close.
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2 text-[11px]">
                  {deriveExitRules(pos).slice(0, 4).map((rule, i) => (
                    <div key={i} className="rounded-md bg-slate-50 dark:bg-slate-900/60 px-2 py-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-secondary">{rule.trigger}</span>
                        <span className="font-mono font-bold text-violet-400">{rule.price == null ? 'Time' : fmtUsd(rule.price)}</span>
                      </div>
                      <div className="mt-0.5 text-muted">{rule.action} · {rule.note}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

              {pos.notes && <p className="text-sm text-secondary italic">{pos.notes}</p>}
              </div>
            )}
          </div>
            </>
          )}

        </div>
      )}
    </article>
  )
}

function KpiCard({
  label,
  value,
  valueClass = 'text-primary',
  sub,
}: {
  label: string
  value: string
  valueClass?: string
  sub?: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900 px-3 py-2">
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-base font-bold tabular-nums mt-0.5 ${valueClass}`}>{value}</div>
      {sub ? <div className="text-[11px] mt-0.5 tabular-nums">{sub}</div> : null}
    </div>
  )
}

export default function PositionsCenter() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigateRouter = useNavigate()
  const { positionsTab, navigatePositionsTab, navigate, portfolio, accountSize, portfolioRefreshKey, closePosition, updatePortfolioPosition, removeFromPortfolio, addManualPosition, canAccessPage, theme } = useApp()
  const isDark = theme !== 'light'
  const canDay   = canAccessPage('day-trade')
  const canSwing = canAccessPage('swing-trade')
  const [env, setEnv] = useState<ApiEnvelope<Record<string, unknown>> | null>(null)
  const [loading, setLoading] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [closingId, setClosingId] = useState<string | null>(null)
  const [reviewingClosedId, setReviewingClosedId] = useState<string | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const [tradeStyle, setTradeStyle] = useState<FilterStyle>('all')
  const [typeFilter, setTypeFilter] = useState<FilterType>('all')
  const [riskFilter, setRiskFilter] = useState<FilterRisk>('all')
  const [sortKey, setSortKey] = useState<SortKey>('dte')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [plFilter, setPlFilter] = useState<'total' | 'week' | 'day' | null>(null)
  const [closedDateFilter, setClosedDateFilter] = useState<string | null>(null)

  useEffect(() => {
    const s = searchParams.get('style')?.trim().toLowerCase()
    if (s === 'day' || s === 'swing' || s === 'regular') setTradeStyle(s)
  }, [searchParams])

  useEffect(() => {
    if (searchParams.get('add') === 'manual') {
      setShowAddModal(true)
      const next = new URLSearchParams(searchParams)
      next.delete('add')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const e = await fetchPositionsCenter()
      setEnv(e)
    } catch {
      setEnv(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, portfolioRefreshKey])

  const isVisible = typeof document !== 'undefined' ? !document.hidden : true
  const [pageVisible, setPageVisible] = useState(isVisible)
  useEffect(() => {
    const onVis = () => setPageVisible(!document.hidden)
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  useEffect(() => {
    if (!pageVisible) return
    const id = setInterval(() => { void load() }, 90_000)
    return () => clearInterval(id)
  }, [load, pageVisible, portfolioRefreshKey])

  const d = env?.data ?? ({} as Record<string, unknown>)
  const summary = (d.summary ?? {}) as Record<string, unknown>
  const market = (d.market_snapshot ?? {}) as Record<string, unknown>
  const perPositionPnl = (d.per_position_pnl ?? {}) as Record<string, {
    pnl: number; pnl_pct: number
    entry_premium_per_share?: number
    current_mark_per_share?: number
    mark_source?: 'live' | 'bs_theoretical' | 'stale'
  }>
  const aiAnalyses    = (d.ai_analyses    ?? {}) as Record<string, AiPositionAnalysis>
  const stockAnalyses = (d.stock_analyses ?? {}) as Record<string, StockPositionAnalysis>
  const exitBadgeByTicker = (d.exit_badge_by_ticker ?? {}) as Record<string, string>
  const rawTab = positionsTab as string
  const tab: MainTabId = TABS.some(t => t.id === rawTab) ? (rawTab as MainTabId) : 'dashboard'

  const openPortfolio   = useMemo(() => portfolio.filter(p => p.status === 'open'), [portfolio])
  const closedPortfolio = useMemo(() => portfolio.filter(p => p.status === 'closed'), [portfolio])
  const stockPortfolio  = useMemo(() => openPortfolio.filter(isStockPos), [openPortfolio])
  const derivedOpt   = openPortfolio.filter(p => !isStockPos(p) && (p.legs?.length ?? 0) > 0).length
  const derivedStock = openPortfolio.filter(isStockPos).length

  const optionsN = num(summary.options_positions, derivedOpt)
  const stockN = num(summary.stock_positions, derivedStock)
  const openN = num(summary.total_open_positions, openPortfolio.length)

  const totalPl = summary.total_pl ?? summary.total_net_pl
  const totalPlPct = summary.total_pl_pct ?? summary.total_net_pl_pct
  const dayPl = summary.day_pl
  const dayPlPct = summary.day_pl_pct
  const weekPl = summary.week_pl
  const weekPlPct = summary.week_pl_pct
  const capitalUsed = num(summary.total_capital_used)
  const buyingPower = num(summary.buying_power, accountSize)
  const utilPct = capitalUsed > 0 && buyingPower > 0
    ? (capitalUsed / (capitalUsed + buyingPower)) * 100
    : num(summary.capital_utilization_pct)
  // Contract-level win/loss stats from closed positions
  const contractStats = useMemo(() => {
    let winContracts = 0, lossContracts = 0, totalRealizedPnl = 0, totalCapitalDeployed = 0
    for (const pos of closedPortfolio) {
      const pnl = pos.realized_pnl ?? computePnlDollar(pos) ?? 0
      const contracts = pos.contracts ?? 1
      if (pnl > 0) winContracts += contracts
      else if (pnl < 0) lossContracts += contracts
      totalRealizedPnl += pnl
      // Capital deployed = max_loss per contract × 100 shares × contracts (options), or entryPrice × contracts (stocks)
      const capitalPerContract = pos.strategy === 'Stock'
        ? (pos.entryPrice ?? 0)
        : (pos.max_loss ?? Math.abs(pos.net_credit ?? 0)) * 100
      totalCapitalDeployed += capitalPerContract * contracts
    }
    const totalContracts = winContracts + lossContracts
    const winRate = totalContracts > 0 ? (winContracts / totalContracts) * 100 : null
    const returnOnCapital = totalCapitalDeployed > 0 ? (totalRealizedPnl / totalCapitalDeployed) * 100 : null
    return { winContracts, lossContracts, totalContracts, winRate, returnOnCapital, totalRealizedPnl }
  }, [closedPortfolio])

  const regime = String(market.regime ?? '').toLowerCase()
  const marketMood =
    regime === 'bullish' ? { label: 'Bullish', cls: getMarketContextBadgeClass('MARKET_SUPPORTIVE') }
    : regime === 'bearish' ? { label: 'Bearish', cls: getDecisionBadgeClass('AVOID') }
    : { label: 'Mixed', cls: getDecisionBadgeClass('WATCH') }

  const positions = tab === 'stocks' ? [] : tab === 'open' ? openPortfolio : tab === 'closed' ? closedPortfolio : portfolio

  const filtered = useMemo(() => {
    let list = [...positions]

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      list = list.filter(p => p.ticker.toLowerCase().includes(q) || p.strategy.toLowerCase().includes(q))
    }

    if (tradeStyle !== 'all') {
      list = list.filter(p => deriveEngineSource(p) === tradeStyle)
    }

    if (typeFilter !== 'all') {
      if (typeFilter === 'options') list = list.filter(p => (p.legs?.length ?? 0) > 0)
      else if (typeFilter === 'stocks') list = list.filter(p => (p.legs?.length ?? 0) === 0)
      else if (typeFilter === 'spreads') {
        list = list.filter(p => (p.strategy || '').toLowerCase().includes('spread'))
      }
    }

    if (riskFilter !== 'all') {
      const cap = (p: PortfolioPosition) => p.capital_at_risk ?? p.max_loss ?? 0
      if (riskFilter === 'low') list = list.filter(p => cap(p) <= 2500)
      else if (riskFilter === 'medium') list = list.filter(p => cap(p) > 2500 && cap(p) < 15000)
      else if (riskFilter === 'high') list = list.filter(p => cap(p) >= 15000)
    }

    if (closedDateFilter && tab === 'closed') {
      list = list.filter(p => {
        if (!p.exitDate) return false
        return new Date(p.exitDate).toISOString().slice(0, 10) === closedDateFilter
      })
    }

    list.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1
      let va: number, vb: number
      switch (sortKey) {
        case 'ticker': return dir * a.ticker.localeCompare(b.ticker)
        case 'dte': va = a.dte ?? 99; vb = b.dte ?? 99; break
        case 'entryPrice': va = a.entryPrice ?? 0; vb = b.entryPrice ?? 0; break
        case 'max_profit': va = a.max_profit ?? 0; vb = b.max_profit ?? 0; break
        case 'max_loss': va = a.max_loss ?? 0; vb = b.max_loss ?? 0; break
        case 'pnlPct': va = a.pnlPct ?? 0; vb = b.pnlPct ?? 0; break
        default: va = 0; vb = 0
      }
      return dir * (va - vb)
    })

    return list
  }, [positions, searchQuery, tradeStyle, typeFilter, riskFilter, closedDateFilter, sortKey, sortDir])

  const toggleExpanded = useCallback((id: string) => {
    setExpandedId(cur => (cur === id ? null : id))
  }, [])

  const handleClose = useCallback((pos: PortfolioPosition) => {
    setClosingId(pos.id)
  }, [])

  const handleCloseConfirm = useCallback(async (id: string, payload: ClosePositionPayload) => {
    await closePosition(id, payload)
    setClosingId(null)
    toggleExpanded(id)
    setNotice({ message: 'Position closed.' })
  }, [closePosition, toggleExpanded])

  const handleManage = useCallback((pos: PortfolioPosition) => {
    setEditingId(pos.id)
  }, [])

  const handleDeletePosition = useCallback((pos: PortfolioPosition) => {
    const label = `${pos.ticker} · ${pos.strategy || 'Position'}`
    if (!window.confirm(`Delete ${label} permanently? This cannot be undone.`)) return
    removeFromPortfolio(pos.id)
    toggleExpanded(pos.id)
    setNotice({ message: `${label} deleted.` })
  }, [removeFromPortfolio, toggleExpanded])

  const handleEdit = useCallback((id: string) => {
    setEditingId(id)
  }, [])

  const handleExportXlsx = useCallback(() => {
    const rows = filtered.map(p => ({
      'Ticker': p.ticker,
      'Status': p.status === 'open' ? 'Open' : 'Closed',
      'Strategy': p.strategy || '',
      'Bias': p.bias || '',
      'Expiry': p.expiry || '',
      'Contracts': p.contracts,
      'Entry Price': p.net_credit ? Math.abs(p.net_credit).toFixed(2) : (p.entryPrice || 0),
      'Close Price': p.exit_debit_credit ?? '',
      'Net Credit $': (p.net_credit || 0).toFixed(2),
      'Max Profit $': (p.max_profit || 0).toFixed(2),
      'Max Loss $': (p.max_loss || 0).toFixed(2),
      'Realized P&L $': p.realized_pnl ?? '',
      'Realized P&L %': p.realized_pnl_percent ?? '',
      'P&L %': p.pnlPct ?? '',
      'Stock Entry Price': p.entryPrice || 0,
      'Stock Close Price': p.exit_price ?? '',
      'Entry Date': p.addedAt ? new Date(p.addedAt).toLocaleDateString() : '',
      'Exit Date': p.exitDate ? new Date(p.exitDate).toLocaleDateString() : '',
      'Exit Reason': p.exit_reason || '',
      'Notes': p.notes || '',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Positions')
    const colWidths = Object.keys(rows[0] || {}).map(k => ({ wch: Math.max(k.length, 14) }))
    ws['!cols'] = colWidths
    const tabLabel = tab === 'open' ? 'Open' : 'Closed'
    XLSX.writeFile(wb, `positions-${tabLabel.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }, [filtered, tab])

  const [notice, setNotice] = useState<{ message: string } | null>(null)

  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(null), 3000)
      return () => clearTimeout(t)
    }
  }, [notice])

  const editingPos = useMemo(() => {
    if (!editingId) return null
    return portfolio.find(p => p.id === editingId) ?? null
  }, [editingId, portfolio])

  const reviewingClosedPos = useMemo(() => {
    if (!reviewingClosedId) return null
    return portfolio.find(p => p.id === reviewingClosedId) ?? null
  }, [reviewingClosedId, portfolio])

  const closingPos = useMemo(() => {
    if (!closingId) return null
    return portfolio.find(p => p.id === closingId && p.status === 'open') ?? null
  }, [closingId, portfolio])

  const handleSaveEdit = useCallback((id: string, data: Omit<PortfolioPosition, 'id' | 'addedAt' | 'status'>) => {
    updatePortfolioPosition(id, data)
    setEditingId(null)
    setNotice({ message: 'Position updated.' })
  }, [updatePortfolioPosition])

  const handleAddPosition = useCallback((data: Omit<PortfolioPosition, 'id' | 'addedAt' | 'status'>) => {
    addManualPosition(data)
    setShowAddModal(false)
    setNotice({ message: `Position added: ${data.ticker} ${data.strategy}` })
  }, [addManualPosition])

  const filtersActive = tradeStyle !== 'all' || typeFilter !== 'all' || riskFilter !== 'all' || closedDateFilter !== null

  return (
    <div className="oa-cc-page positions-center-page max-w-6xl mx-auto p-4 md:p-6 space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5 mb-1">
            <div className="w-9 h-9 rounded-xl bg-emerald-600/20 border border-emerald-700 flex items-center justify-center shrink-0">
              <Briefcase size={18} className="text-emerald-400" />
            </div>
            <h1 className="tcc-hero-title text-2xl font-bold tracking-tight text-heading">Positions Center</h1>
          </div>
          <p className="text-sm text-tertiary mt-1">AI-managed portfolio overview across all trading styles.</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3 w-full sm:w-auto">
          <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3 text-xs sm:text-sm">
            {market.regime != null && (
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${marketMood.cls}`}>
                {market.regime === 'bullish' ? <TrendingUp size={12} /> : market.regime === 'bearish' ? <TrendingDown size={12} /> : null}
                {marketMood.label}
              </span>
            )}
            {market.vix != null && (
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${Number(market.vix) >= 25 ? getDecisionBadgeClass('EXTENDED') : getDecisionBadgeClass('WATCH')}`}>
                VIX: <span className="font-medium tabular-nums">{String(market.vix)}</span>
              </span>
            )}
            {summary.risk_status != null && (
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${getDecisionBadgeClass(String(summary.risk_status))}`}>
                <Shield size={12} className="shrink-0" />Risk: {String(summary.risk_status)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={() => setShowAddModal(true)} className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${getActionButtonClass('trade')}`}>
              <Plus size={18} strokeWidth={2.5} />
            </button>
            <button type="button" onClick={() => void load()} className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${getActionButtonClass('surface')}`} title="Refresh">
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
            <button type="button" onClick={handleExportXlsx} className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${getActionButtonClass('surface')}`} title="Export to XLSX">
              <Download size={16} />
            </button>
            <button type="button" title="Settings" onClick={() => navigate('settings')} className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${getActionButtonClass('surface')}`}>
              <Settings size={16} />
            </button>
          </div>
        </div>
      </header>

      {tab === 'all' && (
      <section className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3">
        {/* 1. Contract Results */}
        <div className="rounded-lg border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900 px-3 py-2">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">Contract Results</div>
          {contractStats.totalContracts === 0 ? (
            <div className="text-sm font-semibold text-muted">No closed trades</div>
          ) : (
            <>
              <div className="flex items-center gap-1.5 text-sm font-bold tabular-nums">
                <span className="text-emerald-400">{contractStats.winContracts}W</span>
                <span className="text-muted text-xs">/</span>
                <span className="text-rose-400">{contractStats.lossContracts}L</span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                {contractStats.winRate != null && (
                  <span className={`text-[11px] font-semibold tabular-nums ${contractStats.winRate >= 50 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {contractStats.winRate.toFixed(0)}% win
                  </span>
                )}
                {contractStats.returnOnCapital != null && (
                  <span className={`text-[11px] font-semibold tabular-nums ${contractStats.returnOnCapital >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    · {contractStats.returnOnCapital >= 0 ? '+' : ''}{contractStats.returnOnCapital.toFixed(1)}% ROC
                  </span>
                )}
              </div>
            </>
          )}
        </div>
        {/* 2. Open Positions */}
        <KpiCard label="Open Positions" value={String(openN || '—')} sub={<span className="text-tertiary">{optionsN} Options / {stockN} Stocks</span>} />
        {/* 3–5. Day / Week / Total P&L */}
        {[
          { key: 'day', label: 'Day P&L', value: dayPl, pct: dayPlPct },
          { key: 'week', label: 'Week P&L', value: weekPl, pct: weekPlPct },
          { key: 'total', label: 'Total Net P&L', value: totalPl, pct: totalPlPct },
        ].map(m => (
          <button key={m.key} type="button" onClick={() => setPlFilter(plFilter === m.key ? null : m.key as 'total' | 'week' | 'day')}
            className={`rounded-lg border px-3 py-2 text-left transition-all ${
              plFilter === m.key
                ? 'border-violet-500 ring-2 ring-violet-500/30 bg-white dark:bg-slate-900'
                : 'border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900'
            }`}
          >
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{m.label}</div>
            <div className={`text-base font-bold tabular-nums mt-0.5 ${getProfitLossTextClass(num(m.value))}`}>{fmtUsd(m.value)}</div>
            {m.pct != null && <div className={`text-[11px] mt-0.5 tabular-nums ${getProfitLossTextClass(num(m.pct))}`}>{fmtPct(m.pct)}</div>}
          </button>
        ))}
        {/* 6–7. Buying Power / Capital in Use */}
        <KpiCard label="Buying Power" value={fmtUsd(buyingPower)} sub={<span className="text-tertiary">Available</span>} />
        <KpiCard label="Capital in Use" value={fmtUsd(capitalUsed)} sub={<span className="text-tertiary">{utilPct > 0 ? `${utilPct.toFixed(1)}%` : '—'}</span>} />
      </section>
      )}

      {notice && (
        <div className="flex items-center justify-between rounded-xl border border-sky-500/25 bg-sky-500/10 px-4 py-2.5 text-sm text-sky-200">
          <span>{notice.message}</span>
          <button type="button" onClick={() => setNotice(null)} className="shrink-0 text-sky-300 hover:text-sky-100"><X size={16} /></button>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex gap-1 overflow-x-auto">
            {TABS.map(t => (
              <button key={t.id} type="button" onClick={() => navigatePositionsTab(t.id)}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                  tab === t.id ? 'bg-violet-600 text-white shadow-sm' : 'text-muted hover:text-secondary bg-transparent'
                }`}
              >
                {t.label} <span className="text-[11px] opacity-70">({
                  t.id === 'stocks' ? stockPortfolio.length
                  : t.id === 'open' ? openPortfolio.length
                  : t.id === 'closed' ? closedPortfolio.length
                  : portfolio.length
                })</span>
              </button>
            ))}
          </div>
          {tab !== 'dashboard' && (
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-slate-800/60 px-3 py-1.5 text-sm">
              <Filter size={14} className="shrink-0 text-secondary" />
               <select value={tradeStyle} onChange={e => setTradeStyle(e.target.value as FilterStyle)} className="bg-transparent outline-none text-sm text-primary font-medium cursor-pointer">
                <option value="all">All Types</option>
                <option value="day">Day</option>
                <option value="swing">Swing</option>
                <option value="regular">Regular</option>
              </select>
            </label>
            <label className="rounded-lg border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-slate-800/60 px-2 py-1.5 text-xs text-secondary">
              <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as FilterType)} className="bg-transparent outline-none text-xs font-semibold cursor-pointer">
                <option value="all">All</option>
                <option value="options">Options</option>
                <option value="stocks">Stocks</option>
                <option value="spreads">Spreads</option>
              </select>
            </label>
            <button type="button" onClick={() => setFilterOpen(o => !o)} className={`${getActionButtonClass('surface')} gap-2 rounded-lg px-3 py-1.5 text-sm relative`}>
              <Filter size={14} />
              Filters
              {filtersActive ? <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-violet-500" /> : null}
            </button>
            <label className="rounded-lg border border-slate-200 dark:border-white/[0.08] bg-slate-50 dark:bg-slate-800/50 px-2 py-1.5 text-xs text-secondary">
              <select value={sortKey} onChange={e => setSortKey(e.target.value as SortKey)} className="bg-transparent text-primary outline-none text-xs">
                <option value="dte" className="bg-surface-card">DTE</option>
                <option value="ticker" className="bg-surface-card">Ticker</option>
                <option value="entryPrice" className="bg-surface-card">Entry</option>
                <option value="max_profit" className="bg-surface-card">Max profit</option>
                <option value="max_loss" className="bg-surface-card">Max loss</option>
                {tab === 'closed' && <option value="pnlPct" className="bg-surface-card">P&L</option>}
              </select>
              <button type="button" onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')} className="ml-1 text-muted hover:text-secondary">
                {sortDir === 'asc' ? '↑' : '↓'}
              </button>
            </label>
          </div>
          )}
        </div>

        {filterOpen && tab !== 'dashboard' && (
          <div className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-slate-900 p-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Trade Style</div>
                <div className="flex flex-wrap gap-1.5">
                  {(['all', 'day', 'swing', 'regular'] as const).filter(s =>
                    s === 'all' || s === 'regular' || (s === 'swing' && canSwing) || (s === 'day' && canDay)
                  ).map(s => (
                    <button key={s} type="button" onClick={() => setTradeStyle(s)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${tradeStyle === s ? 'bg-violet-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-muted hover:text-secondary'}`}
                    >{s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}</button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Type</div>
                <div className="flex flex-wrap gap-1.5">
                  {(['all', 'options', 'stocks', 'spreads'] as const).map(t => (
                    <button key={t} type="button" onClick={() => setTypeFilter(t)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${typeFilter === t ? 'bg-violet-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-muted hover:text-secondary'}`}
                    >{t === 'all' ? 'All' : t.charAt(0).toUpperCase() + t.slice(1)}</button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Risk</div>
                <div className="flex flex-wrap gap-1.5">
                  {(['all', 'low', 'medium', 'high'] as const).map(r => (
                    <button key={r} type="button" onClick={() => setRiskFilter(r)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${riskFilter === r ? 'bg-violet-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-muted hover:text-secondary'}`}
                    >{r === 'all' ? 'All' : r.charAt(0).toUpperCase() + r.slice(1)}</button>
                  ))}
                </div>
              </div>
              {tab === 'closed' && (
                <div className="space-y-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Close Date</div>
                  <div className="flex items-center gap-2">
                    <input type="date" value={closedDateFilter ?? ''} onChange={e => setClosedDateFilter(e.target.value || null)}
                      className="rounded-lg border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-slate-800 px-3 py-1.5 text-xs text-primary outline-none focus:border-violet-500" />
                    {closedDateFilter && (
                      <button type="button" onClick={() => setClosedDateFilter(null)}
                        className="text-[11px] text-violet-500 hover:text-violet-400 font-semibold">Clear</button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {tab === 'dashboard' ? (
        <PositionsDashboardTab
          portfolio={portfolio}
          sectorPnl={(d.sector_pnl ?? []) as any[]}
          pnlByPeriod={(d.pnl_by_period ?? []) as any[]}
          pnlByStrategy={(d.pnl_by_strategy ?? []) as any[]}
          risk={(d.risk ?? null) as any}
          summary={summary as any}
          isDark={isDark}
        />
      ) : tab === 'stocks' ? (
        <StocksTabContent
          positions={openPortfolio}
          stockAnalyses={stockAnalyses}
          summary={summary}
          expandedId={expandedId}
          onToggle={toggleExpanded}
          onClose={handleClose}
          onManage={handleManage}
          loading={loading}
          onAdd={() => setShowAddModal(true)}
        />
      ) : loading && positions.length === 0 ? (
        <div className="flex items-center justify-center py-24 text-sm text-muted">
          <RefreshCw size={16} className="mr-2 animate-spin" /> Loading positions...
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 dark:border-white/[0.08] px-4 py-20 text-center">
          <div className="text-lg font-semibold text-heading">{positions.length === 0 ? 'No positions yet' : 'No matching positions'}</div>
          <p className="mt-1 text-sm text-tertiary">
            {positions.length === 0
              ? 'Add positions from the Position Trading or ticker analysis pages.'
              : 'Try adjusting filters or search query.'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map(pos => (
            <TradingPositionCard
              key={pos.id}
              pos={pos}
              pnlData={perPositionPnl[pos.id] ?? null}
              aiAnalysis={aiAnalyses[pos.id] ?? null}
              exitBadge={exitBadgeByTicker[pos.ticker?.toUpperCase?.() ?? ''] ?? null}
              expanded={expandedId === pos.id}
              onToggle={() => toggleExpanded(pos.id)}
              onClose={() => handleClose(pos)}
              onManage={() => handleManage(pos)}
              onAlert={() => { navigateRouter(ROUTES.alerts); setNotice({ message: `Alert Center opened. Set a price alert for ${pos.ticker} from there.` }) }}
              onDelete={() => handleDeletePosition(pos)}
            />
          ))}
        </div>
      )}

      <footer className="flex flex-wrap items-start gap-2 border-t border-slate-100 dark:border-white/[0.05] pt-4 text-[11px] text-muted">
        <Info size={14} className="shrink-0 mt-0.5" aria-hidden />
        <p>Prices may be delayed. Double-check option quotes before entering or exiting positions.</p>
      </footer>

      {showAddModal && (
        <AddPositionModal
          onSave={handleAddPosition}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {closingPos && (
        <ClosePositionModal
          pos={closingPos}
          onConfirm={handleCloseConfirm}
          onClose={() => setClosingId(null)}
        />
      )}

      {editingPos && (
        <EditPositionModal
          pos={editingPos}
          aiAnalysis={aiAnalyses[editingPos.id] ?? null}
          onSave={handleSaveEdit}
          onClose={() => setEditingId(null)}
        />
      )}

      {reviewingClosedPos && (
        <ClosedPositionReviewModal
          pos={reviewingClosedPos}
          onSave={(id, patch) => {
            updatePortfolioPosition(id, patch)
            setReviewingClosedId(null)
            setNotice({ message: 'Close details saved.' })
          }}
          onClose={() => setReviewingClosedId(null)}
        />
      )}
    </div>
  )
}

function ClosedPositionReviewModal({
  pos,
  onSave,
  onClose,
}: {
  pos: PortfolioPosition
  onSave: (id: string, patch: Omit<PortfolioPosition, 'id' | 'addedAt' | 'status'>) => void
  onClose: () => void
}) {
  const [exitPrice, setExitPrice] = useState(pos.exit_price != null ? String(pos.exit_price) : '')
  const [pnlPct, setPnlPct] = useState(pos.realized_pnl_percent != null ? String(pos.realized_pnl_percent) : (pos.pnlPct != null ? String(pos.pnlPct) : ''))
  const [closeNotes, setCloseNotes] = useState(pos.close_notes ?? pos.notes ?? '')

  const inputCls = 'mt-1 w-full rounded-lg border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-slate-800 px-3 py-2 text-sm text-primary outline-none focus:border-violet-500 dark:focus:border-violet-400 placeholder:text-tertiary'
  const labelCls = 'block text-xs font-semibold text-slate-600 dark:text-slate-300'

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const parsedExitPrice = parseFloat(exitPrice)
    const parsedPnlPct = parseFloat(pnlPct)
    onSave(pos.id, {
      ...pos,
      exit_price: Number.isFinite(parsedExitPrice) && parsedExitPrice > 0 ? parsedExitPrice : pos.exit_price,
      realized_pnl_percent: Number.isFinite(parsedPnlPct) ? parsedPnlPct : pos.realized_pnl_percent,
      pnlPct: Number.isFinite(parsedPnlPct) ? parsedPnlPct : pos.pnlPct,
      close_notes: closeNotes.trim() || undefined,
      exitDate: pos.exitDate,
    })
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-white/[0.07]">
        <h2 className="text-lg font-bold tracking-tight text-heading">Review Closed Position</h2>
        <button type="button" onClick={onClose} className="text-muted hover:text-secondary"><X size={18} /></button>
      </div>

      <div className="px-6 py-4 space-y-1 bg-slate-50 dark:bg-slate-800/40 border-b border-slate-100 dark:border-white/[0.07]">
        <div className="flex items-center gap-2">
          <span className="font-bold text-heading text-base">{pos.ticker}</span>
          <span className="text-xs text-muted">{pos.strategy}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${getBiasBadgeClass(pos.bias)}`}>{pos.bias}</span>
        </div>
        <div className="text-xs text-muted">
          {pos.contracts} contract{pos.contracts !== 1 ? 's' : ''} · Entry {fmtUsd(pos.entryPrice)}
          {pos.exitDate && <> · Closed {new Date(pos.exitDate).toLocaleDateString()}</>}
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className={labelCls}>
              Close Price ($)
              <input type="number" step="any" min={0} placeholder="e.g. 1.85" value={exitPrice}
                onChange={e => setExitPrice(e.target.value)} className={inputCls} />
            </label>
            <label className={labelCls}>
              Realized P&L %
              <input type="number" step="any" placeholder="e.g. 50" value={pnlPct}
                onChange={e => setPnlPct(e.target.value)} className={inputCls} />
              <span className="text-[10px] text-muted mt-0.5 block">% of max profit captured</span>
            </label>
          </div>
          <label className={labelCls}>
            Close Notes
            <textarea rows={2} placeholder="Optional close notes…" value={closeNotes}
              onChange={e => setCloseNotes(e.target.value)}
              className={`${inputCls} resize-none`} />
          </label>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100 dark:border-white/[0.05]">
          <button type="button" onClick={onClose} className={`${getActionButtonClass('surface')} rounded-lg px-4 py-2 text-sm`}>Cancel</button>
          <button type="submit" className={`${getActionButtonClass('trade')} rounded-lg px-4 py-2 text-sm font-semibold`}>Save Close Details</button>
        </div>
      </form>
    </ModalOverlay>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Stocks Tab — components
// ─────────────────────────────────────────────────────────────────────────────

function isStockPos(p: PortfolioPosition): boolean {
  if ((p.strategy || '').toLowerCase() === 'stock') return true
  const hasLegs = Array.isArray(p.legs) && p.legs.length > 0
  if (hasLegs) return false
  return typeof p.shares === 'number' && p.shares > 0
}

function getStockDecisionCls(decision: string): string {
  switch (decision) {
    case 'STOP_HIT': return 'bg-rose-900/30 border-rose-500 text-rose-300'
    case 'SELL':     return 'bg-rose-800/20 border-rose-400 text-rose-300'
    case 'TRIM':     return 'bg-amber-800/20 border-amber-400 text-amber-300'
    case 'WATCH':    return 'bg-sky-800/20 border-sky-400 text-sky-300'
    case 'HOLD':     return 'bg-emerald-800/20 border-emerald-400 text-emerald-300'
    default:         return 'bg-slate-800/20 border-slate-400 text-slate-300'
  }
}

function StockPriceLevels({ a }: { a: StockPositionAnalysis }) {
  const eff = a.trailing_stop > 0 ? a.trailing_stop : a.stop_loss
  const entry = a.entry_price

  const pctVsEntry = (p: number) =>
    entry > 0 ? ((p / entry - 1) * 100).toFixed(1) : '0'

  const levels = [
    { key: 'stop',    label: 'Stop',    price: eff,             cls: 'text-rose-400 border-rose-600/50 bg-rose-900/20' },
    { key: 'entry',   label: 'Entry',   price: entry,           cls: 'text-slate-300 border-slate-600/50 bg-slate-800/50' },
    { key: 'ma20',    label: 'MA20',    price: a.ma20,          cls: 'text-sky-400 border-sky-600/50 bg-sky-900/20' },
    { key: 'current', label: 'Current', price: a.current_price, cls: 'text-emerald-400 border-emerald-600/50 bg-emerald-900/30 ring-1 ring-emerald-500/40' },
    { key: 't1',      label: 'T1',      price: a.target1,       cls: 'text-amber-400 border-amber-600/50 bg-amber-900/20' },
    { key: 't2',      label: 'T2',      price: a.target2,       cls: 'text-violet-400 border-violet-600/50 bg-violet-900/20' },
  ].filter(l => l.price > 0)

  return (
    <div className="flex items-start gap-1.5 overflow-x-auto pb-1">
      {levels.map(l => (
        <div key={l.key} className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-center ${l.cls}`}>
          <div className="text-[9px] font-semibold uppercase tracking-wide opacity-70 mb-0.5">{l.label}</div>
          <div className="text-xs font-mono font-bold">${l.price.toFixed(2)}</div>
          <div className="text-[9px] opacity-60 mt-0.5">
            {l.price === entry
              ? 'base'
              : `${Number(pctVsEntry(l.price)) >= 0 ? '+' : ''}${pctVsEntry(l.price)}%`}
          </div>
        </div>
      ))}
    </div>
  )
}

function StockPositionCard({
  pos,
  analysis,
  expanded,
  onToggle,
  onClose,
  onManage,
}: {
  pos: PortfolioPosition
  analysis: StockPositionAnalysis | null
  expanded: boolean
  onToggle: () => void
  onClose: () => void
  onManage: () => void
}) {
  const shares = num(pos.shares ?? pos.contracts, 0)
  const entry  = num(pos.entryPrice, 0)
  const costBasis = entry * shares

  const pnlDollar = analysis?.pnl_dollar ?? 0
  const pnlPct    = analysis?.pnl_pct    ?? 0
  const currentPx = analysis?.current_price ?? entry
  const decision  = analysis?.decision ?? 'HOLD'

  return (
    <div className={`rounded-xl border transition-all ${
      decision === 'STOP_HIT'
        ? 'border-rose-600/60 bg-rose-900/10 shadow-rose-900/30 shadow-md'
        : 'border-slate-200 dark:border-white/[0.08] bg-white dark:bg-slate-900'
    }`}>
      {/* Collapsed header */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left px-4 py-3 flex items-center gap-3 flex-wrap"
      >
        {/* Ticker */}
        <div className="flex items-center gap-2 min-w-[90px]">
          <span className="font-mono text-base font-bold text-heading">{pos.ticker}</span>
          <span className="text-[10px] text-tertiary bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">Stock</span>
        </div>

        {/* Size + cost */}
        <div className="text-xs text-secondary tabular-nums">
          {shares.toLocaleString()} sh <span className="text-tertiary">× ${entry.toFixed(2)}</span>
          {costBasis > 0 && (
            <span className="text-tertiary ml-1">= ${costBasis.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
          )}
        </div>

        <div className="flex-1" />

        {/* Current price */}
        {currentPx > 0 && (
          <span className="text-sm font-mono font-semibold text-heading tabular-nums">
            ${currentPx.toFixed(2)}
          </span>
        )}

        {/* P&L */}
        <span className={`text-xs font-semibold tabular-nums ${pnlPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
          {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
          {pnlDollar !== 0 && (
            <span className="opacity-70 ml-1">({pnlDollar >= 0 ? '+' : ''}{fmtUsd(pnlDollar)})</span>
          )}
        </span>

        {/* Decision badge */}
        {analysis && (
          <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${getStockDecisionCls(decision)}`}>
            {analysis.decision_label}
          </span>
        )}

        <ChevronDown size={16} className={`shrink-0 text-muted transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {/* Expanded detail */}
      {expanded && analysis && (
        <div className="border-t border-slate-100 dark:border-white/[0.06] px-4 py-4 space-y-4">

          {/* Decision + Reasoning */}
          <div className="rounded-lg border border-slate-100 dark:border-white/[0.05] bg-slate-50 dark:bg-slate-800/50 p-3 space-y-1">
            <div className={`text-xs font-bold uppercase tracking-wide ${getStockDecisionCls(decision).split(' ').find(c => c.startsWith('text-')) ?? 'text-primary'}`}>
              {analysis.decision_label}
            </div>
            <p className="text-sm text-secondary">{analysis.reasoning}</p>
          </div>

          {/* Price levels */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted mb-2">Price Levels</div>
            <StockPriceLevels a={analysis} />
          </div>

          {/* Technical context */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            {[
              { label: 'MA20', value: `$${analysis.ma20.toFixed(2)}` },
              { label: 'MA50', value: `$${analysis.ma50.toFixed(2)}` },
              { label: 'RSI', value: analysis.rsi.toFixed(0) },
              { label: '5d Mom', value: `${analysis.mom_5d >= 0 ? '+' : ''}${analysis.mom_5d.toFixed(1)}%` },
            ].map(m => (
              <div key={m.label} className="rounded-lg border border-slate-100 dark:border-white/[0.05] bg-slate-50 dark:bg-slate-800/50 px-2.5 py-1.5">
                <div className="text-[9px] font-semibold uppercase tracking-wide text-muted">{m.label}</div>
                <div className="font-mono font-semibold text-primary mt-0.5">{m.value}</div>
              </div>
            ))}
          </div>

          {/* Deviation from MA20 */}
          {analysis.deviation_from_ma20 != null && (
            <div className="text-xs text-secondary">
              Dev from MA20:{' '}
              <span className={`font-semibold ${analysis.deviation_from_ma20 >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {analysis.deviation_from_ma20 >= 0 ? '+' : ''}{analysis.deviation_from_ma20.toFixed(1)}%
              </span>
              {Math.abs(analysis.deviation_from_ma20) > 10 && (
                <span className="ml-1.5 text-amber-400 font-semibold">— Overextended</span>
              )}
            </div>
          )}

          {/* Dual trailing stops */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            {analysis.trailing_stop_8pct > 0 && (
              <div className="rounded-lg border border-rose-600/30 bg-rose-900/10 px-2.5 py-1.5">
                <div className="text-[9px] font-semibold uppercase tracking-wide text-muted mb-0.5">Trail Stop 8%</div>
                <div className="font-mono font-bold text-rose-400">${analysis.trailing_stop_8pct.toFixed(2)}</div>
              </div>
            )}
            {analysis.trailing_stop_10pct > 0 && (
              <div className="rounded-lg border border-amber-600/30 bg-amber-900/10 px-2.5 py-1.5">
                <div className="text-[9px] font-semibold uppercase tracking-wide text-muted mb-0.5">Trail Stop 10%</div>
                <div className="font-mono font-bold text-amber-400">${analysis.trailing_stop_10pct.toFixed(2)}</div>
              </div>
            )}
          </div>
          {analysis.stop_loss > 0 && (
            <div className="text-xs text-muted">
              Hard stop: <span className="font-mono text-rose-400">${analysis.stop_loss.toFixed(2)}</span>
              {analysis.high_water_mark > 0 && (
                <span className="ml-2">HWM: <span className="font-mono">${analysis.high_water_mark.toFixed(2)}</span></span>
              )}
            </div>
          )}

          {/* Day P&L */}
          {analysis.day_pl_dollar !== 0 && (
            <div className="text-xs text-secondary">
              Day P&L:{' '}
              <span className={analysis.day_pl_dollar >= 0 ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>
                {analysis.day_pl_dollar >= 0 ? '+' : ''}{fmtUsd(analysis.day_pl_dollar)} ({analysis.day_pl_pct >= 0 ? '+' : ''}{analysis.day_pl_pct.toFixed(2)}%)
              </span>
            </div>
          )}

          {/* Earnings */}
          {analysis.earnings_date && (
            <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
              (analysis.days_to_earnings ?? 999) <= 14
                ? 'bg-rose-900/20 border-rose-600/40 text-rose-300'
                : 'bg-amber-900/20 border-amber-600/40 text-amber-300'
            }`}>
              <AlertTriangle size={12} className="shrink-0" />
              <span>
                Earnings:{' '}
                <span className="font-semibold">
                  {new Date(analysis.earnings_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
                {analysis.days_to_earnings != null && ` (${analysis.days_to_earnings} days)`}
                {(analysis.days_to_earnings ?? 999) <= 14 && ' — Trim or set tight stop'}
              </span>
            </div>
          )}

          {/* Days held + account */}
          {(analysis.days_held != null || analysis.account_type) && (
            <div className="text-xs text-muted flex gap-4 flex-wrap">
              {analysis.days_held != null && <span>Held: <span className="text-primary font-semibold">{analysis.days_held}d</span></span>}
              {analysis.account_type && <span>Account: <span className="text-primary font-semibold">{analysis.account_type}</span></span>}
            </div>
          )}

          {/* Tax overlay */}
          {analysis.tax_overlay && (
            <div className={`rounded-lg border px-3 py-2 text-xs ${
              analysis.tax_overlay.startsWith('✅')
                ? 'bg-emerald-900/20 border-emerald-700/40 text-emerald-300'
                : 'bg-amber-900/20 border-amber-700/40 text-amber-300'
            }`}>
              {analysis.tax_overlay}
            </div>
          )}

          {/* Smart alerts */}
          {analysis.smart_alerts.length > 0 && (
            <div className="space-y-1.5">
              {analysis.smart_alerts.map((a, i) => (
                <div key={i} className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs border ${
                  a.severity === 'CRITICAL' ? 'bg-rose-900/20 border-rose-600/40 text-rose-300'
                  : a.severity === 'WARNING' ? 'bg-amber-900/20 border-amber-600/40 text-amber-300'
                  : 'bg-sky-900/20 border-sky-600/40 text-sky-300'
                }`}>
                  <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                  <span>{a.message}</span>
                </div>
              ))}
            </div>
          )}

          {/* Management actions */}
          {analysis.management_actions.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted mb-1.5">Actions</div>
              <ul className="space-y-1">
                {analysis.management_actions.map((action, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs text-secondary">
                    <span className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" />
                    {action}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onManage}
              className={`${getActionButtonClass('surface')} rounded-lg px-3 py-1.5 text-xs font-semibold`}>
              <Edit3 size={12} className="mr-1.5" />Edit
            </button>
            <button type="button" onClick={onClose}
              className={`${getActionButtonClass('alert')} rounded-lg px-3 py-1.5 text-xs font-semibold`}>
              Close Position
            </button>
          </div>
        </div>
      )}

      {/* No analysis fallback */}
      {expanded && !analysis && (
        <div className="border-t border-slate-100 dark:border-white/[0.06] px-4 py-4 text-xs text-muted">
          Analysis loading — refresh to get the latest decision data.
        </div>
      )}
    </div>
  )
}

function StocksBanner({ summary }: { summary: Record<string, unknown> }) {
  const s = (summary.stocks ?? {}) as Record<string, unknown>
  const costBasis    = num(s.cost_basis)
  const unrealizedPl = s.unrealized_pl as number | null | undefined
  const dayPl        = s.day_pl        as number | null | undefined
  const weekPl       = s.week_pl       as number | null | undefined
  const count        = num(s.count)

  if (costBasis === 0 && count === 0) return null

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {[
        { label: 'Cost Basis', value: fmtUsd(costBasis), sub: `${count} position${count !== 1 ? 's' : ''}`, color: '' },
        { label: 'Unrealized P&L', value: fmtUsd(unrealizedPl), sub: null, color: unrealizedPl != null ? (unrealizedPl >= 0 ? 'text-emerald-400' : 'text-rose-400') : '' },
        { label: 'Day P&L', value: fmtUsd(dayPl), sub: null, color: dayPl != null ? (dayPl >= 0 ? 'text-emerald-400' : 'text-rose-400') : '' },
        { label: 'Week P&L', value: fmtUsd(weekPl), sub: null, color: weekPl != null ? (weekPl >= 0 ? 'text-emerald-400' : 'text-rose-400') : '' },
      ].map(m => (
        <div key={m.label} className="rounded-lg border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900 px-3 py-2.5">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">{m.label}</div>
          <div className={`text-base font-bold tabular-nums ${m.color || 'text-primary'}`}>{m.value}</div>
          {m.sub && <div className="text-[11px] text-tertiary mt-0.5">{m.sub}</div>}
        </div>
      ))}
    </div>
  )
}

function StocksTabContent({
  positions,
  stockAnalyses,
  summary,
  expandedId,
  onToggle,
  onClose,
  onManage,
  loading,
  onAdd,
}: {
  positions: PortfolioPosition[]
  stockAnalyses: Record<string, StockPositionAnalysis>
  summary: Record<string, unknown>
  expandedId: string | null
  onToggle: (id: string) => void
  onClose: (pos: PortfolioPosition) => void
  onManage: (pos: PortfolioPosition) => void
  loading: boolean
  onAdd: () => void
}) {
  const stocks = useMemo(() => positions.filter(isStockPos), [positions])

  return (
    <div className="space-y-4">
      <StocksBanner summary={summary} />

      {loading && stocks.length === 0 ? (
        <div className="flex items-center justify-center py-24 text-sm text-muted">
          <RefreshCw size={16} className="mr-2 animate-spin" /> Loading stock positions…
        </div>
      ) : stocks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 dark:border-white/[0.08] px-4 py-20 text-center">
          <div className="text-lg font-semibold text-heading">No stock positions</div>
          <p className="mt-1 text-sm text-tertiary">Add a position with Strategy = Stock to track it here.</p>
          <button type="button" onClick={onAdd}
            className={`mt-4 inline-flex items-center gap-2 ${getActionButtonClass('trade')} rounded-lg px-4 py-2 text-sm font-semibold`}>
            <Plus size={16} /> Add Stock Position
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {stocks.map(pos => (
            <StockPositionCard
              key={pos.id}
              pos={pos}
              analysis={stockAnalyses[pos.id] ?? null}
              expanded={expandedId === pos.id}
              onToggle={() => onToggle(pos.id)}
              onClose={() => onClose(pos)}
              onManage={() => onManage(pos)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function AddPositionModal({
  onSave,
  onClose,
}: {
  onSave: (data: Omit<PortfolioPosition, 'id' | 'addedAt' | 'status'>) => void
  onClose: () => void
}) {
  const { canAccessPage } = useApp()
  const canDay   = canAccessPage('day-trade')
  const canSwing = canAccessPage('swing-trade')
  const sourceOptions = TRADE_SOURCE_OPTIONS.filter(s =>
    s.id === 'regular' || (s.id === 'swing' && canSwing) || (s.id === 'day' && canDay)
  )
  const [form, setForm] = useState<FormState>(() => ({
    ...emptyForm(),
    tradeSource: sourceOptions[0]?.id ?? 'regular',
  }))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.ticker.trim()) return

    const def = STRATEGY_DEFS[form.strategy]
    if (!def) return

    const isStock = form.strategy === 'Stock'
    const cc = parseInt(form.contractCount) || 0
    if (cc < 1) return

    const entryPrice = parseFloat(form.entryStockPrice) || 0
    const dteVal = form.expiry
      ? Math.ceil((new Date(form.expiry + 'T00:00:00').getTime() - Date.now()) / 86400000)
      : 45

    if (isStock) {
      const t1 = parseFloat(form.target1) || undefined
      const t2 = parseFloat(form.target2) || undefined
      const sl = parseFloat(form.stopLoss) || undefined
      const trailingPct = (parseFloat(form.trailingStopPct) || 8) / 100
      onSave({
        ticker: form.ticker.trim().toUpperCase(),
        companyName: form.ticker.trim().toUpperCase(),
        strategy: 'Stock',
        bias: def.bias,
        legs: [],
        expiry: '',
        dte: 0,
        net_credit: 0,
        spread_width: 0,
        max_profit: 0,
        max_loss: 0,
        prob_of_profit: 0,
        expected_value: 0,
        scores_total: 0,
        contracts: cc,
        shares: cc,
        breakeven_lower: entryPrice,
        breakeven_upper: entryPrice,
        entryPrice,
        source: form.tradeSource,
        capital_at_risk: Math.round(entryPrice * cc),
        trailing_stop_pct: trailingPct,
        target1: t1,
        target2: t2,
        stopLoss: sl,
        account_type: form.accountType || undefined,
        purchase_date: form.purchaseDate || undefined,
        notes: form.notes.trim() || undefined,
      })
      return
    }

    const strikesNum = form.legStrikes.map(s => parseFloat(s) || 0)
    const premiumsNum = form.legPremiums.map(p => parseFloat(p) || 0)
    const metrics = computeMetrics(form.strategy, strikesNum, premiumsNum, entryPrice)

    const legs: OptionLeg[] = def.legs.map((tmpl, i) => {
      const legExpiry = def.isCalendar
        ? (tmpl.expirySlot === 'back' ? form.backExpiry : form.expiry)
        : form.expiry
      return {
        action: tmpl.action,
        option_type: tmpl.option_type,
        strike: strikesNum[i],
        expiry: legExpiry,
        delta: 0,
        mid_price: premiumsNum[i],
        bid: premiumsNum[i] * 0.95,
        ask: premiumsNum[i] * 1.05,
        iv: 0,
        oi: 0,
        volume: 0,
        bid_ask_spread_pct: 0,
      }
    })

    onSave({
      ticker: form.ticker.trim().toUpperCase(),
      companyName: form.ticker.trim().toUpperCase(),
      strategy: form.strategy,
      bias: def.bias,
      legs,
      expiry: form.expiry || new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10),
      dte: dteVal,
      net_credit: metrics.netCredit,
      spread_width: metrics.spreadWidth,
      max_profit: metrics.maxProfit,
      max_loss: metrics.maxLoss,
      prob_of_profit: 0,
      expected_value: 0,
      scores_total: 0,
      contracts: cc,
      breakeven_lower: metrics.beLower,
      breakeven_upper: metrics.beUpper,
      entryPrice,
      source: form.tradeSource,
      capital_at_risk: Math.round(metrics.maxLoss * SHARES_PER_OPTION_CONTRACT * cc),
      notes: form.notes.trim() || undefined,
    })
  }

  const canSubmit = form.ticker.trim() && (form.strategy === 'Stock'
    ? form.entryStockPrice && (parseFloat(form.entryStockPrice) || 0) > 0 && (parseInt(form.contractCount) || 0) >= 1
    : form.expiry && (STRATEGY_DEFS[form.strategy]?.isCalendar ? !!form.backExpiry : true)
      && form.entryStockPrice && (parseInt(form.contractCount) || 0) >= 1
  )

  return (
    <ModalOverlay onClose={onClose}>
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-white/[0.07]">
        <h2 className="text-lg font-bold tracking-tight text-heading">Add Position</h2>
        <button type="button" onClick={onClose} className="text-muted hover:text-secondary"><X size={18} /></button>
      </div>
      <form onSubmit={handleSubmit}>
        <div className="px-6 py-5">
          <PositionFormFields form={form} onChange={patch => setForm(f => ({ ...f, ...patch }))} sourceOptions={sourceOptions} />
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100 dark:border-white/[0.05]">
          <button type="button" onClick={onClose} className={`${getActionButtonClass('surface')} rounded-lg px-4 py-2 text-sm`}>Cancel</button>
          <button type="submit" disabled={!canSubmit} className={`${getActionButtonClass('trade')} rounded-lg px-4 py-2 text-sm font-semibold`}>Add Position</button>
        </div>
      </form>
    </ModalOverlay>
  )
}

function computeClosePnl(
  pos: PortfolioPosition,
  exitPrice: number | null,
  exitDebitCredit: number | null,
  contractsOverride?: number,
): { realizedPnl: number | null; realizedPnlPct: number | null } {
  const isStock = pos.strategy === 'Stock'
  const contracts = contractsOverride != null ? contractsOverride : (pos.contracts || 0)
  const netCredit = pos.net_credit || 0

  let realizedPnl: number | null = null
  let costBasis = 0

  if (isStock && exitPrice != null) {
    realizedPnl = (exitPrice - pos.entryPrice) * contracts
    costBasis = pos.entryPrice * contracts
  } else if (netCredit >= 0 && exitDebitCredit != null) {
    // Credit strategy (credit spread, short put/call)
    realizedPnl = (netCredit - exitDebitCredit) * contracts * 100
    costBasis = (pos.capital_at_risk != null
      ? (pos.capital_at_risk * contracts) / (pos.contracts || 1)
      : (pos.max_loss || netCredit) * contracts * 100)
  } else if (netCredit < 0 && exitPrice != null) {
    // Debit strategy (long call/put, debit spread)
    realizedPnl = (exitPrice - Math.abs(netCredit)) * contracts * 100
    costBasis = Math.abs(netCredit) * contracts * 100
  } else if (pos.pnlPct != null && Number.isFinite(pos.pnlPct)) {
    // Fallback: estimate from stored pnlPct when user didn't enter exit details
    const ref = costBasisRefPerShare(pos)
    if (ref > 0) {
      realizedPnl = (pos.pnlPct / 100) * ref * 100 * contracts
    } else {
      realizedPnl = 0
    }
    costBasis = Math.abs(netCredit) > 0
      ? Math.abs(netCredit) * contracts * 100
      : ref * contracts * 100
  }

  const realizedPnlPct = realizedPnl != null && costBasis > 0
    ? (realizedPnl / costBasis) * 100
    : null

  return { realizedPnl, realizedPnlPct }
}

function ClosePositionModal({
  pos,
  onConfirm,
  onClose,
}: {
  pos: PortfolioPosition
  onConfirm: (id: string, payload: ClosePositionPayload) => void
  onClose: () => void
}) {
  const isStock = pos.strategy === 'Stock'
  const isCredit = pos.net_credit >= 0

  const [contractsToCloseStr, setContractsToCloseStr] = useState(() => String(pos.contracts))
  const [exitPriceStr, setExitPriceStr] = useState('')
  const [exitDebitCreditStr, setExitDebitCreditStr] = useState('')
  const [closeDate, setCloseDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [exitReason, setExitReason] = useState('')
  const [closeNotes, setCloseNotes] = useState('')
  const [overrideEnabled, setOverrideEnabled] = useState(false)
  const [overridePnlStr, setOverridePnlStr] = useState('')
  const [overridePnlPctStr, setOverridePnlPctStr] = useState('')
  const [overrideReason, setOverrideReason] = useState('')

  const contractsToClose = Math.min(Math.max(parseInt(contractsToCloseStr) || 1, 1), pos.contracts)
  const isPartialClose = contractsToClose < pos.contracts

  const exitPrice = exitPriceStr ? parseFloat(exitPriceStr) : null
  const exitDebitCredit = exitDebitCreditStr ? parseFloat(exitDebitCreditStr) : null

  const { realizedPnl, realizedPnlPct } = computeClosePnl(pos, exitPrice, exitDebitCredit, contractsToClose)

  const displayPnl = overrideEnabled
    ? { pnl: parseFloat(overridePnlStr) || 0, pnlPct: parseFloat(overridePnlPctStr) || 0 }
    : { pnl: realizedPnl ?? 0, pnlPct: realizedPnlPct ?? 0 }

  const pnlColor =
    displayPnl.pnl > 0 ? 'text-emerald-400' : displayPnl.pnl < 0 ? 'text-rose-400' : 'text-gray-400'

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onConfirm(pos.id, {
      contractsToClose,
      exit_price: exitPrice ?? undefined,
      exit_debit_credit: exitDebitCredit ?? undefined,
      close_date: closeDate ? new Date(closeDate + 'T12:00:00').toISOString() : undefined,
      realized_pnl: displayPnl.pnl,
      realized_pnl_percent: displayPnl.pnlPct,
      exit_reason: exitReason || undefined,
      close_notes: closeNotes.trim() || undefined,
      pnl_overridden: overrideEnabled || undefined,
      pnl_override_reason: overrideEnabled ? (overrideReason.trim() || undefined) : undefined,
    })
  }

  const canSubmit = true

  const inputCls = 'mt-1 w-full rounded-lg border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-slate-800 px-3 py-2 text-sm text-primary outline-none focus:border-violet-500 dark:focus:border-violet-400 placeholder:text-tertiary'
  const labelCls = 'block text-xs font-semibold text-slate-600 dark:text-slate-300'
  const readOnlyCls = 'mt-1 w-full rounded-lg border border-slate-200 dark:border-white/[0.08] bg-slate-50 dark:bg-slate-800/40 px-3 py-2 text-sm text-secondary outline-none'

  return (
    <ModalOverlay onClose={onClose}>
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-white/[0.07]">
        <h2 className="text-lg font-bold tracking-tight text-heading">Close Position</h2>
        <button type="button" onClick={onClose} className="text-muted hover:text-secondary"><X size={18} /></button>
      </div>
      <form onSubmit={handleSubmit}>
        <div className="px-6 py-5 space-y-5">
          {/* Readonly position info */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <div className={labelCls}>Ticker</div>
              <div className={readOnlyCls}>{pos.ticker}</div>
            </div>
            <div>
              <div className={labelCls}>Strategy</div>
              <div className={readOnlyCls}>{pos.strategy}</div>
            </div>
            <div>
              <label className={labelCls}>
                {isStock ? 'Shares to Close' : 'Contracts to Close'}
                <input
                  type="number"
                  min={1}
                  max={pos.contracts}
                  step={1}
                  value={contractsToCloseStr}
                  onChange={e => setContractsToCloseStr(e.target.value.replace(/[^0-9]/g, ''))}
                  className={inputCls}
                />
                {isPartialClose && (
                  <span className="mt-1 block text-[11px] text-amber-400 font-medium">
                    Partial close — {contractsToClose} of {pos.contracts} {isStock ? 'shares' : 'contracts'}. Remaining {pos.contracts - contractsToClose} will stay open.
                  </span>
                )}
              </label>
            </div>
            <div>
              <div className={labelCls}>Entry {isCredit ? 'Credit' : 'Debit'}</div>
              <div className={readOnlyCls}>{fmtUsd(pos.net_credit)}</div>
            </div>
          </div>

          {/* Entry price display */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className={labelCls}>Entry Price</div>
              <div className={readOnlyCls}>{fmtUsd(pos.entryPrice)}</div>
            </div>
            <div>
              <div className={labelCls}>Est. P&L (current)</div>
              <div className={readOnlyCls}>—</div>
            </div>
          </div>

          {/* Exit inputs */}
          <div className="border-t border-slate-100 dark:border-white/[0.05] pt-4 space-y-3">
            <div className="text-sm font-bold text-heading">Exit Details</div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {isStock || !isCredit ? (
                <label className={labelCls}>Exit Price / Closing Premium ($)
                  <input type="number" step="any" value={exitPriceStr}
                    onChange={e => setExitPriceStr(e.target.value)} className={inputCls} />
                </label>
              ) : null}
              {isCredit && !isStock ? (
                <label className={labelCls}>Exit Debit / Cost to Close ($)
                  <input type="number" step="any" value={exitDebitCreditStr}
                    onChange={e => setExitDebitCreditStr(e.target.value)} className={inputCls} />
                </label>
              ) : null}
              <label className={labelCls}>Close Date
                <input type="date" value={closeDate}
                  onChange={e => setCloseDate(e.target.value)} className={inputCls} />
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className={labelCls}>Exit Reason
                <select value={exitReason} onChange={e => setExitReason(e.target.value)} className={inputCls}>
                  <option value="">Select reason...</option>
                  {EXIT_REASON_OPTIONS.map(r => (
                    <option key={r} value={r} className="bg-surface-card">{r}</option>
                  ))}
                </select>
              </label>
              <label className={labelCls}>Notes
                <input value={closeNotes} onChange={e => setCloseNotes(e.target.value)} className={inputCls} />
              </label>
            </div>
          </div>

          {/* Auto-calculated P&L */}
          {realizedPnl != null && (
            <div className="rounded-lg border border-slate-200 dark:border-white/[0.08] bg-slate-50 dark:bg-slate-800/40 p-4 space-y-2">
              <div className="text-xs font-bold text-secondary uppercase tracking-wide">Calculated Realized P&L</div>
              <div className="flex items-center gap-4">
                <span className={`font-mono text-xl font-bold tabular-nums ${pnlColor}`}>
                  {displayPnl.pnl >= 0 ? '+' : ''}{fmtUsd(displayPnl.pnl)}
                </span>
                <span className={`font-mono text-base font-semibold tabular-nums ${pnlColor}`}>
                  {displayPnl.pnlPct >= 0 ? '+' : ''}{displayPnl.pnlPct.toFixed(2)}%
                </span>
              </div>
            </div>
          )}

          {/* Manual override toggle */}
          <div className="border-t border-slate-100 dark:border-white/[0.05] pt-4 space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={overrideEnabled}
                onChange={e => setOverrideEnabled(e.target.checked)}
                className="rounded border-slate-300 dark:border-slate-600" />
              <span className="text-xs font-semibold text-secondary">Override calculated P&L</span>
            </label>

            {overrideEnabled && (
              <div className="space-y-3 pl-6 border-l-2 border-amber-400/40">
                <div className="grid grid-cols-2 gap-3">
                  <label className={labelCls}>Realized P&L ($)
                    <input type="number" step="any" value={overridePnlStr}
                      onChange={e => setOverridePnlStr(e.target.value)}
                      className={inputCls} placeholder="e.g. 450.00" />
                  </label>
                  <label className={labelCls}>Realized P&L (%)
                    <input type="number" step="any" value={overridePnlPctStr}
                      onChange={e => setOverridePnlPctStr(e.target.value)}
                      className={inputCls} placeholder="e.g. 12.5" />
                  </label>
                </div>
                <label className={labelCls}>Override Reason
                  <input value={overrideReason} onChange={e => setOverrideReason(e.target.value)}
                    className={inputCls} placeholder="e.g. Broker fill differs from estimated mid price" />
                </label>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100 dark:border-white/[0.05]">
          <button type="button" onClick={onClose} className={`${getActionButtonClass('surface')} rounded-lg px-4 py-2 text-sm`}>Cancel</button>
          <button type="submit" disabled={!canSubmit} className={`${getActionButtonClass('trade')} rounded-lg px-4 py-2 text-sm font-semibold`}>
            {isPartialClose ? `Close ${contractsToClose} of ${pos.contracts} ${isStock ? 'Shares' : 'Contracts'}` : 'Close Position'}
          </button>
        </div>
      </form>
    </ModalOverlay>
  )
}

function EditPositionModal({
  pos,
  aiAnalysis,
  onSave,
  onClose,
}: {
  pos: PortfolioPosition
  aiAnalysis?: AiPositionAnalysis | null
  onSave: (id: string, data: Omit<PortfolioPosition, 'id' | 'addedAt' | 'status'>) => void
  onClose: () => void
}) {
  const { canAccessPage } = useApp()
  const canDay   = canAccessPage('day-trade')
  const canSwing = canAccessPage('swing-trade')
  const sourceOptions = TRADE_SOURCE_OPTIONS.filter(s =>
    s.id === 'regular' || (s.id === 'swing' && canSwing) || (s.id === 'day' && canDay)
  )
  const isClosed = pos.status === 'closed'
  const [form, setForm] = useState<FormState>(() => {
    const strat = resolveEditorStrategyForEdit(pos)
    const { strikes, premiums } = seedLegStringsFromPosition(pos)
    const src = deriveEngineSource(pos)
    return {
      ticker: pos.ticker,
      tradeSource: src,
      strategy: strat,
      expiry: normalizeExpiryForDateInput(pos.expiry),
      backExpiry: STRATEGY_DEFS[strat]?.isCalendar
        ? normalizeExpiryForDateInput(pos.legs.find(l => l.action === 'BUY')?.expiry ?? '')
        : '',
      contractCount: String(pos.contracts),
      entryStockPrice: String(pos.entryPrice),
      notes: pos.notes ?? '',
      legStrikes: strikes,
      legPremiums: premiums,
      target1: pos.target1 != null ? String(pos.target1) : '',
      target2: pos.target2 != null ? String(pos.target2) : '',
      breakout: pos.breakout != null ? String(pos.breakout) : '',
      stopLoss: pos.stopLoss != null ? String(pos.stopLoss) : '',
      trailingStopPct: pos.trailing_stop_pct != null ? String(Math.round(pos.trailing_stop_pct * 100)) : '8',
      accountType: (pos.account_type as FormState['accountType']) || '',
      purchaseDate: pos.purchase_date ?? '',
    }
  })

  const isStockEdit = pos.strategy === 'Stock'
  const isCreditEdit = pos.net_credit >= 0

  // Close-detail editing state for closed positions
  const [closeExitPrice, setCloseExitPrice] = useState(pos.exit_price != null ? String(pos.exit_price) : '')
  const [closeExitDebitCredit, setCloseExitDebitCredit] = useState(pos.exit_debit_credit != null ? String(pos.exit_debit_credit) : '')
  const [closeRealizedPnl, setCloseRealizedPnl] = useState(pos.realized_pnl != null ? String(pos.realized_pnl) : '')
  const [closeRealizedPnlPct, setCloseRealizedPnlPct] = useState(pos.realized_pnl_percent != null ? String(pos.realized_pnl_percent) : '')
  const [closeExitReason, setCloseExitReason] = useState(pos.exit_reason || '')
  const [closeOverrideReason, setCloseOverrideReason] = useState(pos.pnl_override_reason || '')
  const [closeNotes, setCloseNotes] = useState(pos.close_notes || '')
  const [closePnlOverridden, setClosePnlOverridden] = useState(pos.pnl_overridden || false)

  const exitPriceVal = closeExitPrice !== '' ? parseFloat(closeExitPrice) : null
  const exitDebitCreditVal = closeExitDebitCredit !== '' ? parseFloat(closeExitDebitCredit) : null
  const isDayToMultiDayConversion = pos.status === 'open' && deriveEngineSource(pos) === 'day' && form.tradeSource !== 'day'
  const overnightDecision = useMemo(() => deriveOvernightHoldChecks(pos, aiAnalysis), [aiAnalysis, pos])
  const overnightHoldAllowed = overnightDecision.verdict === 'KEEP'

  const { realizedPnl: editComputedPnl, realizedPnlPct: editComputedPnlPct } = isClosed
    ? computeClosePnl(pos, exitPriceVal, exitDebitCreditVal)
    : { realizedPnl: null, realizedPnlPct: null }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (isDayToMultiDayConversion && !overnightHoldAllowed) return
    const def = STRATEGY_DEFS[form.strategy]
    if (!def) return

    const isStock = form.strategy === 'Stock'
    const cc = parseInt(form.contractCount) || 0
    if (cc < 1) return

    const entryPrice = parseFloat(form.entryStockPrice) || pos.entryPrice
    const dteVal = form.expiry
      ? Math.ceil((new Date(form.expiry + 'T00:00:00').getTime() - Date.now()) / 86400000)
      : safeDte(pos.dte, 0)

    const parsedRealizedPnl = closeRealizedPnl !== '' ? parseFloat(closeRealizedPnl) : undefined
    const parsedRealizedPnlPct = closeRealizedPnlPct !== '' ? parseFloat(closeRealizedPnlPct) : undefined

    const closeDetails = isClosed ? {
      exit_price: exitPriceVal ?? pos.exit_price,
      exit_debit_credit: exitDebitCreditVal ?? pos.exit_debit_credit,
      realized_pnl: Number.isFinite(parsedRealizedPnl) ? parsedRealizedPnl : pos.realized_pnl,
      realized_pnl_percent: Number.isFinite(parsedRealizedPnlPct) ? parsedRealizedPnlPct : pos.realized_pnl_percent,
      exit_reason: closeExitReason || undefined,
      close_notes: closeNotes.trim() || undefined,
      pnl_overridden: closePnlOverridden,
      pnl_override_reason: closeOverrideReason.trim() || undefined,
    } : {}

    if (isStock) {
      onSave(pos.id, {
        ticker: form.ticker.trim().toUpperCase(),
        companyName: pos.companyName,
        strategy: 'Stock',
        bias: def.bias,
        legs: [],
        expiry: '',
        dte: 0,
        net_credit: 0,
        spread_width: 0,
        max_profit: 0,
        max_loss: 0,
        prob_of_profit: 0,
        expected_value: 0,
        scores_total: 0,
        contracts: cc,
        breakeven_lower: entryPrice,
        breakeven_upper: entryPrice,
        entryPrice,
        source: form.tradeSource,
        capital_at_risk: Math.round(entryPrice * cc),
        notes: form.notes.trim() || undefined,
        kelly_fraction: pos.kelly_fraction,
        half_kelly_fraction: pos.half_kelly_fraction,
        edge_ratio: pos.edge_ratio,
        account_size_at_entry: pos.account_size_at_entry,
        target1: form.target1 !== '' ? parseFloat(form.target1) : undefined,
        target2: form.target2 !== '' ? parseFloat(form.target2) : undefined,
        breakout: form.breakout !== '' ? parseFloat(form.breakout) : undefined,
        stopLoss: form.stopLoss !== '' ? parseFloat(form.stopLoss) : undefined,
        ...closeDetails,
      })
      return
    }

    const strikesNum = form.legStrikes.map(s => parseFloat(s) || 0)
    const premiumsNum = form.legPremiums.map(p => parseFloat(p) || 0)
    // Only recompute metrics if the user actually filled in premiums.
    // If all premiums are 0 (blank), preserve the original values to avoid wiping
    // max_profit / max_loss / spread_width that were set when the position was added.
    const userEnteredPremiums = premiumsNum.some(p => p > 0)
    const metrics = computeMetrics(form.strategy, strikesNum, premiumsNum, entryPrice)

    const legs: OptionLeg[] = def.legs.map((tmpl, i) => {
      const legExpiry = def.isCalendar
        ? (tmpl.expirySlot === 'back'
            ? (form.backExpiry || pos.legs.find(l => l.action === 'BUY')?.expiry || '')
            : (form.expiry || pos.expiry || ''))
        : (form.expiry || pos.legs[i]?.expiry || '')
      return {
      action: tmpl.action,
      option_type: tmpl.option_type,
      strike: strikesNum[i] > 0 ? strikesNum[i] : (pos.legs[i]?.strike ?? 0),
      expiry: legExpiry,
      delta: pos.legs[i]?.delta ?? 0,
      mid_price: premiumsNum[i] > 0 ? premiumsNum[i] : (pos.legs[i]?.mid_price ?? 0),
      bid: premiumsNum[i] > 0 ? premiumsNum[i] * 0.95 : (pos.legs[i]?.bid ?? 0),
      ask: premiumsNum[i] > 0 ? premiumsNum[i] * 1.05 : (pos.legs[i]?.ask ?? 0),
      iv: pos.legs[i]?.iv ?? 0,
      oi: pos.legs[i]?.oi ?? 0,
      volume: pos.legs[i]?.volume ?? 0,
      bid_ask_spread_pct: pos.legs[i]?.bid_ask_spread_pct ?? 0,
      }
    })

    onSave(pos.id, {
      ticker: form.ticker.trim().toUpperCase(),
      companyName: pos.companyName,
      strategy: form.strategy,
      bias: def.bias,
      legs,
      expiry: form.expiry || pos.expiry,
      dte: dteVal,
      net_credit: userEnteredPremiums ? metrics.netCredit : pos.net_credit,
      spread_width: userEnteredPremiums ? metrics.spreadWidth : pos.spread_width,
      max_profit: userEnteredPremiums ? metrics.maxProfit : pos.max_profit,
      max_loss: userEnteredPremiums ? metrics.maxLoss : pos.max_loss,
      prob_of_profit: pos.prob_of_profit,
      expected_value: pos.expected_value,
      scores_total: pos.scores_total,
      contracts: cc,
      breakeven_lower: userEnteredPremiums ? metrics.beLower : pos.breakeven_lower,
      breakeven_upper: userEnteredPremiums ? metrics.beUpper : pos.breakeven_upper,
      entryPrice,
      source: form.tradeSource,
      capital_at_risk: userEnteredPremiums ? Math.round(metrics.maxLoss * SHARES_PER_OPTION_CONTRACT * cc) : pos.capital_at_risk,
      kelly_fraction: pos.kelly_fraction,
      half_kelly_fraction: pos.half_kelly_fraction,
      edge_ratio: pos.edge_ratio,
      account_size_at_entry: pos.account_size_at_entry,
      notes: form.notes.trim() || undefined,
      target1: form.target1 !== '' ? parseFloat(form.target1) : undefined,
      target2: form.target2 !== '' ? parseFloat(form.target2) : undefined,
      breakout: form.breakout !== '' ? parseFloat(form.breakout) : undefined,
      stopLoss: form.stopLoss !== '' ? parseFloat(form.stopLoss) : undefined,
      ...closeDetails,
    })
  }

  const inputCls = 'mt-1 w-full rounded-lg border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-slate-800 px-3 py-2 text-sm text-primary outline-none focus:border-violet-500 dark:focus:border-violet-400 placeholder:text-tertiary'

  return (
    <ModalOverlay onClose={onClose}>
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-white/[0.07]">
        <h2 className="text-lg font-bold tracking-tight text-heading">{isClosed ? 'Review / Edit Close Details' : 'Edit Position'}</h2>
        <button type="button" onClick={onClose} className="text-muted hover:text-secondary"><X size={18} /></button>
      </div>
      <form onSubmit={handleSubmit}>
        <div className="px-6 py-5">
          <PositionFormFields form={form} onChange={patch => setForm(f => ({ ...f, ...patch }))} readonlyTicker isEdit sourceOptions={sourceOptions} />

          {isDayToMultiDayConversion && (
            <OvernightHoldEngineCard pos={pos} aiAnalysis={aiAnalysis} />
          )}

          {isClosed && (
            <div className="mt-6 border-t border-slate-100 dark:border-white/[0.05] pt-5 space-y-4">
              <div className="text-sm font-bold text-heading">Close Details</div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {isStockEdit || !isCreditEdit ? (
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">Exit Price / Closing Premium ($)
                    <input type="number" step="any" value={closeExitPrice}
                      onChange={e => setCloseExitPrice(e.target.value)} className={inputCls} />
                  </label>
                ) : null}
                {isCreditEdit && !isStockEdit ? (
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">Exit Debit / Cost to Close ($)
                    <input type="number" step="any" value={closeExitDebitCredit}
                      onChange={e => setCloseExitDebitCredit(e.target.value)} className={inputCls} />
                  </label>
                ) : null}
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">Exit Reason
                  <select value={closeExitReason} onChange={e => setCloseExitReason(e.target.value)} className={inputCls}>
                    <option value="">Select reason...</option>
                    {EXIT_REASON_OPTIONS.map(r => (
                      <option key={r} value={r} className="bg-surface-card">{r}</option>
                    ))}
                  </select>
                </label>
              </div>

              {editComputedPnl != null && (
                <div className="rounded-lg border border-slate-200 dark:border-white/[0.08] bg-slate-50 dark:bg-slate-800/40 p-3 space-y-1">
                  <div className="text-xs font-bold text-secondary uppercase tracking-wide">Calculated Realized P&L</div>
                  <div className="flex items-center gap-4">
                    <span className={`font-mono text-base font-semibold tabular-nums ${editComputedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {editComputedPnl >= 0 ? '+' : ''}{fmtUsd(editComputedPnl)}
                    </span>
                    {editComputedPnlPct != null && (
                      <span className={`font-mono text-sm font-semibold tabular-nums ${editComputedPnlPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {editComputedPnlPct >= 0 ? '+' : ''}{editComputedPnlPct.toFixed(2)}%
                      </span>
                    )}
                    <button type="button"
                      className="text-[11px] text-violet-400 hover:text-violet-300 font-medium underline underline-offset-2"
                      onClick={() => {
                        if (editComputedPnl != null) setCloseRealizedPnl(String(Math.round(editComputedPnl * 100) / 100))
                        if (editComputedPnlPct != null) setCloseRealizedPnlPct(String(Math.round(editComputedPnlPct * 100) / 100))
                      }}>
                      Apply to fields
                    </button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">Realized P&L ($)
                  <input type="number" step="any" value={closeRealizedPnl}
                    onChange={e => setCloseRealizedPnl(e.target.value)} className={inputCls} />
                </label>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">Realized P&L (%)
                  <input type="number" step="any" value={closeRealizedPnlPct}
                    onChange={e => setCloseRealizedPnlPct(e.target.value)} className={inputCls} />
                </label>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={closePnlOverridden}
                  onChange={e => setClosePnlOverridden(e.target.checked)}
                  className="rounded border-slate-300 dark:border-slate-600" />
                <span className="text-xs font-semibold text-secondary">Manual P&L override</span>
              </label>

              {closePnlOverridden && (
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">Override Reason
                  <input value={closeOverrideReason}
                    onChange={e => setCloseOverrideReason(e.target.value)}
                    className={inputCls} placeholder="e.g. Broker fill differs" />
                </label>
              )}

              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">Close Notes
                <input value={closeNotes}
                  onChange={e => setCloseNotes(e.target.value)}
                  className={inputCls} />
              </label>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100 dark:border-white/[0.05]">
          <button type="button" onClick={onClose} className={`${getActionButtonClass('surface')} rounded-lg px-4 py-2 text-sm`}>Cancel</button>
          <button type="submit" disabled={isDayToMultiDayConversion && !overnightHoldAllowed} className={`${getActionButtonClass('trade')} rounded-lg px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50`}>
            {isDayToMultiDayConversion && !overnightHoldAllowed ? 'Overnight Hold Blocked' : 'Save Changes'}
          </button>
        </div>
      </form>
    </ModalOverlay>
  )
}
