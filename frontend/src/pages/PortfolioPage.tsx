import { useState, useMemo, useEffect, useCallback, useLayoutEffect, useRef, type RefObject, type MutableRefObject } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'
import {
  Briefcase, TrendingUp, TrendingDown, CheckCircle, Clock, Trash2, X,
  DollarSign, Layers, Plus, AlertTriangle, ChevronDown, ChevronUp, FileEdit, RefreshCw, Download,
  Loader2, XCircle,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import type { AnalyzeResponse, OptionLeg, OptionRow, PortfolioPosition, ClosePositionPayload, TickerCacheEntry } from '../types'
import { useApp } from '../contexts/AppContext'
import ActiveTradesPanel from '../components/ActiveTradesPanel'
import OpenPositionsFeedTable, {
  dayTradeToneBadgeClass,
  type OpenPositionsFeedRow,
} from '../components/OpenPositionsFeedTable'
import { PositionCategoryPill } from '../components/PositionHubCard'
import { exitActiveTrade, listActiveTrades, type ActiveTradeRow } from '../api/client'
import { parseBrokerContractPosition } from '../api/commandCenter'
import { inferPortfolioHubCategory } from '../utils/positionCategory'
import {
  isPortfolioExpiryAnalysisFresh,
  normalizePortfolioExpiryIso as normalizeExpiryIso,
  chainExpiryMatchesData as chainExpiryMatches,
  resolvePortfolioAnalyzeData,
} from '../utils/portfolioAnalysis'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmtDollar(n: number, showPlus = false): string {
  const abs = Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (n < 0)    return `-$${abs}`
  if (showPlus) return `+$${abs}`
  return `$${abs}`
}

/** Per-share P&L if every leg expired at spot S: intrinsic only vs entry mids. Not broker MTM. */
function estimateAtExpiryPnl(legs: OptionLeg[], spotPrice: number): number {
  let total = 0
  for (const leg of legs) {
    const intrinsic =
      leg.option_type === 'CALL'
        ? Math.max(0, spotPrice - leg.strike)
        : Math.max(0, leg.strike - spotPrice)
    const premium = leg.mid_price
    total += leg.action === 'BUY' ? intrinsic - premium : premium - intrinsic
  }
  return total
}

function optionRowMid(row: OptionRow | undefined): number | null {
  if (!row) return null
  const { bid, ask, last_price: lp } = row
  if (typeof bid === 'number' && typeof ask === 'number' && bid > 0 && ask > 0) return (bid + ask) / 2
  if (typeof lp === 'number' && lp > 0) return lp
  return null
}

function findStrikeRow(chain: OptionRow[], strike: number): OptionRow | undefined {
  return chain.find(r => Math.abs(r.strike - strike) < 0.02)
}

/** US equity options: premium is per share of underlying; one contract = 100 shares. */
const SHARES_PER_OPTION_CONTRACT = 100
const BROKER_CONTRACT_TEMPLATE = 'Buy to Open\n1 Contract AAPL Jul 24 2026 330 Call\nFilled at $2.86'

/**
 * Per-share mark-to-market vs entry leg mids using current chain mids (same expiry row as cached analysis).
 * Uses mid if bid & ask are quoted; otherwise last. Not a brokerage fill — still a model.
 */
function estimateMarkToMarketPerShare(
  legs: OptionLeg[],
  data: AnalyzeResponse,
  positionExpiry: string,
): { perShare: number } | null {
  if (!chainExpiryMatches(data, positionExpiry)) return null
  const calls = data.calls_chain ?? []
  const puts = data.puts_chain ?? []
  let total = 0
  for (const leg of legs) {
    const chain = leg.option_type === 'CALL' ? calls : puts
    const row = findStrikeRow(chain, leg.strike)
    const mid = optionRowMid(row)
    if (mid == null) return null
    const entry = leg.mid_price
    total += leg.action === 'BUY' ? mid - entry : entry - mid
  }
  return { perShare: total }
}

/** Whole-position dollar MTM: (sum of per-share leg deltas) × 100 × contract count. */
function markToMarketPositionDollars(
  legs: OptionLeg[],
  data: AnalyzeResponse,
  positionExpiry: string,
  contractCount: number,
): number | null {
  const mtm = estimateMarkToMarketPerShare(legs, data, positionExpiry)
  if (mtm == null) return null
  return mtm.perShare * SHARES_PER_OPTION_CONTRACT * contractCount
}

/** For suggestions / urgency: MTM dollar when mids exist; else intrinsic at cached spot × 100 × contracts. */
function normalizedContractCount(pos: PortfolioPosition): number {
  const n = Number(pos.contracts)
  if (!Number.isFinite(n) || n <= 0) return 1
  return Math.max(1, Math.round(n))
}

function openPositionEvalDollar(pos: PortfolioPosition, analyzeData: AnalyzeResponse | null): number | null {
  const contractCount = normalizedContractCount(pos)
  if (!analyzeData) return null
  const mtmD = markToMarketPositionDollars(pos.legs, analyzeData, pos.expiry, contractCount)
  if (mtmD != null) return mtmD
  const spot = analyzeData.signals?.current_price ?? null
  if (spot == null) return null
  return estimateAtExpiryPnl(pos.legs, spot) * SHARES_PER_OPTION_CONTRACT * contractCount
}

// ─────────────────────────────────────────────────────────────────────────────
// Strategy definitions for manual entry
// ─────────────────────────────────────────────────────────────────────────────

interface LegTemplate { action: 'BUY' | 'SELL'; option_type: 'CALL' | 'PUT'; label: string }
interface StrategyDef  { bias: string; legs: LegTemplate[] }

const STRATEGY_DEFS: Record<string, StrategyDef> = {
  'Long Call':        { bias: 'Bullish',        legs: [{ action: 'BUY',  option_type: 'CALL', label: 'Buy Call' }] },
  'Long Put':         { bias: 'Bearish',         legs: [{ action: 'BUY',  option_type: 'PUT',  label: 'Buy Put' }] },
  'Covered Call':     { bias: 'Bullish/Neutral', legs: [{ action: 'SELL', option_type: 'CALL', label: 'Sell Call (own the stock)' }] },
  'Covered Put':      { bias: 'Bullish/Neutral', legs: [{ action: 'SELL', option_type: 'PUT',  label: 'Sell Put (cash secured)' }] },
  'Short Put':        { bias: 'Bullish/Neutral', legs: [{ action: 'SELL', option_type: 'PUT',  label: 'Sell Put (naked)' }] },
  'Short Call':       { bias: 'Bearish/Neutral', legs: [{ action: 'SELL', option_type: 'CALL', label: 'Sell Call (naked)' }] },
  'Bull Put Spread':  { bias: 'Bullish/Neutral', legs: [
    { action: 'SELL', option_type: 'PUT',  label: 'Sell Put (higher strike)' },
    { action: 'BUY',  option_type: 'PUT',  label: 'Buy Put (lower strike, protection)' },
  ]},
  'Bear Call Spread': { bias: 'Bearish/Neutral', legs: [
    { action: 'SELL', option_type: 'CALL', label: 'Sell Call (lower strike)' },
    { action: 'BUY',  option_type: 'CALL', label: 'Buy Call (higher strike, protection)' },
  ]},
  'Bull Call Spread': { bias: 'Bullish',         legs: [
    { action: 'BUY',  option_type: 'CALL', label: 'Buy Call (lower strike)' },
    { action: 'SELL', option_type: 'CALL', label: 'Sell Call (higher strike)' },
  ]},
  'Bear Put Spread':  { bias: 'Bearish',          legs: [
    { action: 'BUY',  option_type: 'PUT',  label: 'Buy Put (higher strike)' },
    { action: 'SELL', option_type: 'PUT',  label: 'Sell Put (lower strike)' },
  ]},
  'Iron Condor':      { bias: 'Neutral',          legs: [
    { action: 'SELL', option_type: 'PUT',  label: 'Sell Put (higher put strike)' },
    { action: 'BUY',  option_type: 'PUT',  label: 'Buy Put (lower put strike)' },
    { action: 'SELL', option_type: 'CALL', label: 'Sell Call (lower call strike)' },
    { action: 'BUY',  option_type: 'CALL', label: 'Buy Call (higher call strike)' },
  ]},
  'Long Straddle':    { bias: 'Neutral',          legs: [
    { action: 'BUY',  option_type: 'CALL', label: 'Buy Call (ATM)' },
    { action: 'BUY',  option_type: 'PUT',  label: 'Buy Put (same strike)' },
  ]},
}

// Compute position metrics from manually-entered leg data
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
    // Credit trade
    maxProfit = netCredit
    maxLoss   = spreadWidth > 0 ? Math.max(0, Math.round((spreadWidth - netCredit) * 100) / 100) : Math.round(netCredit * 2 * 100) / 100
    const sellStrike0 = legStrikes[0] || 0
    const sellStrike2 = legStrikes[2] || 0
    if (['Bull Put Spread', 'Short Put', 'Covered Put'].includes(strategy))
      beLower = Math.round((sellStrike0 - netCredit) * 100) / 100
    if (['Bear Call Spread', 'Short Call', 'Covered Call'].includes(strategy))
      beUpper = Math.round((sellStrike0 + netCredit) * 100) / 100
    if (strategy === 'Iron Condor') {
      beLower = Math.round((sellStrike0 - netCredit) * 100) / 100
      beUpper = Math.round((sellStrike2 + netCredit) * 100) / 100
    }
  } else {
    // Debit trade
    const premium = Math.abs(netCredit)
    const s0 = legStrikes[0] || 0
    const s1 = legStrikes[1] || 0
    if (['Long Call', 'Long Put'].includes(strategy)) {
      maxLoss   = premium
      maxProfit = Math.round(premium * 10 * 100) / 100   // 10× target display
      beLower   = strategy === 'Long Call' ? Math.round((s0 + premium) * 100) / 100
                                           : Math.round((s0 - premium) * 100) / 100
    } else if (['Bull Call Spread', 'Bear Put Spread'].includes(strategy)) {
      maxLoss   = premium
      maxProfit = Math.max(0, Math.round((spreadWidth - premium) * 100) / 100)
      beLower   = strategy === 'Bull Call Spread' ? Math.round((s0 + premium) * 100) / 100
                                                  : Math.round((s0 - premium) * 100) / 100
    } else if (strategy === 'Long Straddle') {
      maxLoss   = premium
      maxProfit = Math.round(premium * 10 * 100) / 100
      beLower   = Math.round((s0 - premium) * 100) / 100
      beUpper   = Math.round((s0 + premium) * 100) / 100
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
  const sig = legs.map(l => `${l.action}:${l.option_type}`).join('|')
  for (const [name, def] of Object.entries(STRATEGY_DEFS)) {
    if (def.legs.length !== legs.length) continue
    const defSig = def.legs.map(l => `${l.action}:${l.option_type}`).join('|')
    if (defSig === sig) return name
  }
  return null
}

function resolveEditorStrategyForEdit(pos: PortfolioPosition): string {
  if (STRATEGY_DEFS[pos.strategy]) return pos.strategy
  const guessed = guessStrategyFromLegs(pos.legs)
  if (guessed) return guessed
  return Object.keys(STRATEGY_DEFS)[0]
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

type ManualPositionCommitPayload = Omit<PortfolioPosition, 'id' | 'addedAt' | 'status'>

// ─────────────────────────────────────────────────────────────────────────────
// Exit suggestion engine
// ─────────────────────────────────────────────────────────────────────────────

type SuggestionLevel = 'EXPIRED' | 'EXIT_NOW' | 'TAKE_PROFIT' | 'CONSIDER_CLOSE' | 'ROLL' | 'MANAGE' | 'HOLD'

interface Suggestion {
  level: SuggestionLevel
  title: string
  reason: string
  action: string
}

function getExitSuggestion(pos: PortfolioPosition, pnlDollar: number | null): Suggestion {
  const dte       = Math.ceil((new Date(pos.expiry + 'T00:00:00').getTime() - Date.now()) / 86400000)
  const isDebit   = pos.net_credit < 0
  const contractCount = normalizedContractCount(pos)

  const refProfit = pos.max_profit * SHARES_PER_OPTION_CONTRACT * contractCount
  const refLoss   = pos.max_loss   * SHARES_PER_OPTION_CONTRACT * contractCount
  const profitPct = pnlDollar !== null && refProfit > 0 ? (pnlDollar / refProfit) * 100 : null
  const lossPct   = pnlDollar !== null && refLoss > 0 && pnlDollar < 0 ? (-pnlDollar / refLoss) * 100 : null

  if (dte <= 0) return {
    level: 'EXPIRED', title: 'Expired',
    reason: 'This position has reached its expiry date.',
    action: 'Mark as closed. Check for assignment if short options finished ITM.',
  }
  if (dte <= 5) return {
    level: 'EXIT_NOW', title: `Exit Now — ${dte}d to Expiry`,
    reason: `Gamma spikes sharply in the final ${dte} day${dte === 1 ? '' : 's'}. Small moves cause outsized P&L swings.`,
    action: 'Close immediately to avoid pin risk and assignment risk.',
  }
  if (profitPct != null && profitPct >= 75) return {
    level: 'TAKE_PROFIT', title: `Take Profit — ${profitPct.toFixed(0)}% of target`,
    reason: `Estimated P&L is ${profitPct.toFixed(0)}% of ${isDebit ? '10× target' : 'max profit'} (option mids vs entry when available; else intrinsic at spot — see Help).`,
    action: 'Lock in gains. Very little additional edge from holding further.',
  }
  if (profitPct != null && profitPct >= 50) return {
    level: 'CONSIDER_CLOSE', title: `50% Profit Target Hit`,
    reason: `${profitPct.toFixed(0)}% of max profit on the estimate used for signals.`,
    action: 'Close to lock in gains and free up buying power. Remaining edge is minimal vs remaining risk.',
  }
  if (lossPct != null && lossPct >= 200) return {
    level: 'EXIT_NOW', title: `2× Loss — Stop Out`,
    reason: `Position is at ${lossPct.toFixed(0)}% of max loss. Standard stop-loss trigger for spreads is 2× credit received.`,
    action: 'Exit now. Cutting the loss frees capital to recover elsewhere.',
  }
  if (lossPct != null && lossPct >= 100) return {
    level: 'EXIT_NOW', title: `Max Loss Reached`,
    reason: `Estimate implies maximum loss at this mark.`,
    action: 'Close immediately. No remaining edge. Capital recovery takes priority.',
  }
  if (!isDebit && dte <= 21 && (profitPct == null || profitPct < 25)) return {
    level: 'ROLL', title: `Roll — 21 DTE Zone`,
    reason: `Credit position at ${dte} DTE with only ${profitPct?.toFixed(0) ?? '?'}% of profit captured. Theta decay plateaus here.`,
    action: 'Buy back current position, sell same strikes for the next expiry to reset time decay and collect additional premium.',
  }
  if (lossPct != null && lossPct >= 50) return {
    level: 'MANAGE', title: `Manage — Under Pressure (${lossPct.toFixed(0)}% of max loss)`,
    reason: `Position moving against the thesis with ${dte} days remaining.`,
    action: dte > 14
      ? 'Consider rolling to a better strike, reducing size, or adding a hedge.'
      : 'With limited time remaining, evaluate whether to close now or let it play out.',
  }
  return {
    level: 'HOLD', title: 'Hold — Within Parameters',
    reason: profitPct != null
      ? `${dte} DTE · Estimated P&L ${profitPct >= 0 ? '+' : ''}${profitPct.toFixed(0)}% of ${isDebit ? '10× target' : 'max profit'}.`
      : `${dte} DTE remaining. Load option marks (Refresh Portfolio) for a dollar P&L estimate vs your entry.`,
    action: isDebit
      ? 'Monitor for entry into profit zone. Consider closing if stock moves sharply in your favour.'
      : 'Let theta decay work. Next key review: 21 DTE or if position moves against you by 50% of max loss.',
  }
}

const SUGGESTION_STYLE: Record<SuggestionLevel, { bg: string; border: string; title: string; icon: string }> = {
  EXPIRED:        { bg: 'bg-red-900/30',    border: 'border-red-700',    title: 'text-red-300',    icon: '⏰' },
  EXIT_NOW:       { bg: 'bg-red-900/30',    border: 'border-red-700',    title: 'text-red-300',    icon: '🚨' },
  TAKE_PROFIT:    { bg: 'bg-emerald-900/30',border: 'border-emerald-700',title: 'text-emerald-300',icon: '✅' },
  CONSIDER_CLOSE: { bg: 'bg-emerald-900/20',border: 'border-emerald-800',title: 'text-emerald-400',icon: '💰' },
  ROLL:           { bg: 'bg-blue-900/20',   border: 'border-blue-800',   title: 'text-blue-300',   icon: '🔄' },
  MANAGE:         { bg: 'bg-amber-900/30',  border: 'border-amber-700',  title: 'text-amber-300',  icon: '⚠️' },
  HOLD:           { bg: 'bg-gray-800/40',   border: 'border-gray-700',   title: 'text-gray-300',   icon: '⏳' },
}

// ─────────────────────────────────────────────────────────────────────────────
// Manual position editor (modal add / inline edit on card)
// ─────────────────────────────────────────────────────────────────────────────

function ManualPositionEditor({
  variant,
  initialPosition,
  onCancel,
  onCommit,
}: {
  variant: 'modal' | 'inline'
  initialPosition: PortfolioPosition | null
  onCancel: () => void
  onCommit: (pos: ManualPositionCommitPayload) => void
}) {
  const strategies = Object.keys(STRATEGY_DEFS)
  const isEdit = initialPosition != null
  const [ticker,          setTicker]         = useState('')
  const [companyName,     setCompanyName]    = useState('')
  const [strategy,        setStrategy]       = useState(strategies[0])
  const [expiry,          setExpiry]         = useState('')
  const [contractsInput, setContractsInput] = useState('1')
  const [entryStockPrice, setEntryStock]     = useState('')
  const [notes,           setNotes]          = useState('')
  const [legStrikes,      setLegStrikes]     = useState<string[]>(['', '', '', ''])
  const [legPremiums,     setLegPremiums]    = useState<string[]>(['', '', '', ''])
  const [brokerText,      setBrokerText]     = useState(BROKER_CONTRACT_TEMPLATE)
  const [brokerParseError, setBrokerParseError] = useState('')
  const [brokerImporting, setBrokerImporting] = useState(false)

  useEffect(() => {
    if (!initialPosition) {
      setTicker('')
      setCompanyName('')
      setStrategy(Object.keys(STRATEGY_DEFS)[0])
      setExpiry('')
      setContractsInput('1')
      setEntryStock('')
      setNotes('')
      setLegStrikes(['', '', '', ''])
      setLegPremiums(['', '', '', ''])
      setBrokerText(BROKER_CONTRACT_TEMPLATE)
      setBrokerParseError('')
      setBrokerImporting(false)
      return
    }
    const strat = resolveEditorStrategyForEdit(initialPosition)
    const { strikes, premiums } = seedLegStringsFromPosition(initialPosition)
    setTicker(initialPosition.ticker)
    setCompanyName(initialPosition.companyName)
    setStrategy(strat)
    setExpiry(normalizeExpiryForDateInput(initialPosition.expiry))
    setContractsInput(String(normalizedContractCount(initialPosition)))
    setEntryStock(String(initialPosition.entryPrice))
    setNotes(initialPosition.notes ?? '')
    setLegStrikes(strikes)
    setLegPremiums(premiums)
    setBrokerText(BROKER_CONTRACT_TEMPLATE)
    setBrokerParseError('')
    setBrokerImporting(false)
  }, [initialPosition])

  const def = STRATEGY_DEFS[strategy]

  const handleStrategyChange = (s: string) => {
    setStrategy(s)
    setLegStrikes(['', '', '', ''])
    setLegPremiums(['', '', '', ''])
  }

  const strikesNum  = legStrikes.map(s => parseFloat(s) || 0)
  const premiumsNum = legPremiums.map(p => parseFloat(p) || 0)
  const metrics     = computeMetrics(strategy, strikesNum, premiumsNum, parseFloat(entryStockPrice) || 0)

  const parseContractCount = (raw: string): number | null => {
    const digits = raw.replace(/\D/g, '')
    if (digits === '') return null
    const n = parseInt(digits, 10)
    if (!Number.isFinite(n) || n < 1 || n > 9999) return null
    return n
  }

  const contractsParsed = parseContractCount(contractsInput)

  const applyParsedContractToFields = (nextForm: {
    ticker?: string
    strategy?: string
    expiry?: string
    contractCount?: string
    entryStockPrice?: string
    legStrikes?: string[]
    legPremiums?: string[]
    notes?: string
  }) => {
    if (nextForm.ticker) {
      setTicker(nextForm.ticker)
      setCompanyName(nextForm.ticker)
    }
    if (nextForm.strategy) setStrategy(nextForm.strategy)
    if (nextForm.expiry) setExpiry(nextForm.expiry)
    if (nextForm.contractCount) setContractsInput(nextForm.contractCount)
    if (nextForm.entryStockPrice) setEntryStock(nextForm.entryStockPrice)
    if (nextForm.legStrikes) setLegStrikes(nextForm.legStrikes.slice(0, 4).concat(['', '', '', '']).slice(0, 4))
    if (nextForm.legPremiums) setLegPremiums(nextForm.legPremiums.slice(0, 4).concat(['', '', '', '']).slice(0, 4))
    if (nextForm.notes) setNotes(nextForm.notes)
  }

  const handleImportBrokerContract = async (autoAdd: boolean) => {
    setBrokerParseError('')
    setBrokerImporting(true)
    try {
      const response = await parseBrokerContractPosition({ text: brokerText, trade_source: 'manual' })
      if (!response.data) throw new Error('No contract data returned.')
      applyParsedContractToFields(response.data.form)
      if (autoAdd) {
        onCommit(response.data.position)
        if (variant === 'modal') onCancel()
      }
    } catch (err) {
      setBrokerParseError(err instanceof Error ? err.message : 'Could not read that contract.')
    } finally {
      setBrokerImporting(false)
    }
  }

  const legsComplete = def.legs.every((_, i) => strikesNum[i] > 0 && premiumsNum[i] > 0)
  const canSubmit =
    ticker.trim() && expiry && legsComplete && (parseFloat(entryStockPrice) || 0) > 0 && contractsParsed != null

  const handleSubmit = () => {
    if (!canSubmit) return
    const cc = contractsParsed
    if (cc == null) return
    const entryPrice = parseFloat(entryStockPrice)
    const dteVal = Math.ceil((new Date(expiry + 'T00:00:00').getTime() - Date.now()) / 86400000)

    const legs: OptionLeg[] = def.legs.map((tmpl, i) => ({
      action: tmpl.action,
      option_type: tmpl.option_type,
      strike: strikesNum[i],
      expiry,
      delta: 0,
      mid_price: premiumsNum[i],
      bid: premiumsNum[i] * 0.95,
      ask: premiumsNum[i] * 1.05,
      iv: 0,
      oi: 0,
      volume: 0,
      bid_ask_spread_pct: 0,
    }))

    const capital_at_risk = Math.round(metrics.maxLoss * SHARES_PER_OPTION_CONTRACT * cc)

    const payload: ManualPositionCommitPayload = {
      ticker: ticker.trim().toUpperCase(),
      companyName: companyName.trim() || ticker.trim().toUpperCase(),
      strategy,
      bias: def.bias,
      legs,
      expiry,
      dte: dteVal,
      net_credit: metrics.netCredit,
      spread_width: metrics.spreadWidth,
      max_profit: metrics.maxProfit,
      max_loss: metrics.maxLoss,
      prob_of_profit: initialPosition?.prob_of_profit ?? 0,
      expected_value: initialPosition?.expected_value ?? 0,
      scores_total: initialPosition?.scores_total ?? 0,
      contracts: cc,
      breakeven_lower: metrics.beLower,
      breakeven_upper: metrics.beUpper,
      entryPrice,
      notes: notes.trim() || undefined,
      capital_at_risk,
      ...(initialPosition
        ? {
            source: initialPosition.source,
            kelly_fraction: initialPosition.kelly_fraction,
            half_kelly_fraction: initialPosition.half_kelly_fraction,
            edge_ratio: initialPosition.edge_ratio,
            account_size_at_entry: initialPosition.account_size_at_entry,
          }
        : { source: 'manual' as const }),
    }

    onCommit(payload)
    if (variant === 'modal') onCancel()
  }

  const inputCls = 'w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500 placeholder-gray-600'
  const labelCls = 'block text-xs font-semibold text-gray-400 mb-1'

  const fieldsBlock = (
    <div className={variant === 'modal' ? 'p-5 space-y-4 max-h-[75vh] overflow-y-auto' : 'space-y-4'}>
      {!isEdit && (
        <section className="rounded-xl border border-violet-500/25 bg-violet-950/20 p-3">
          <div className="mb-1 text-xs font-bold uppercase tracking-wide text-violet-300">Paste Broker Contract</div>
          <textarea
            className={`${inputCls} min-h-[92px] resize-y font-mono text-xs leading-relaxed`}
            value={brokerText}
            onChange={e => {
              setBrokerText(e.target.value)
              setBrokerParseError('')
            }}
            placeholder={'Buy to Open\n1 Contract TSLA Jul 24 2026 397.5 Put Limit at $15.30 (Day)\nFilled at $15.30'}
          />
          {brokerParseError && <div className="mt-2 text-xs font-semibold text-red-300">{brokerParseError}</div>}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => handleImportBrokerContract(true)}
              disabled={brokerImporting || !brokerText.trim() || brokerText.trim() === BROKER_CONTRACT_TEMPLATE}
              className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-gray-700"
            >
              {brokerImporting ? 'Reading...' : 'Add Contract'}
            </button>
            <button
              type="button"
              onClick={() => handleImportBrokerContract(false)}
              disabled={brokerImporting || !brokerText.trim()}
              className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-bold text-gray-300 hover:border-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Fill Form
            </button>
          </div>
        </section>
      )}

      {isEdit && initialPosition && !STRATEGY_DEFS[initialPosition.strategy] && (
        <p className="text-xs text-amber-400/90 rounded-lg bg-amber-950/25 border border-amber-900/50 px-3 py-2">
          Saved strategy name &quot;{initialPosition.strategy}&quot; was matched to template <span className="font-semibold text-amber-200">{strategy}</span> from your legs. Change the dropdown if that is wrong.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="min-w-0">
          <label className={labelCls}>Ticker *</label>
          <input className={`${inputCls} min-w-0`} placeholder="AAPL" value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())} />
        </div>
        <div className="min-w-0">
          <label className={labelCls}>Company (optional)</label>
          <input className={`${inputCls} min-w-0`} placeholder="Apple Inc." value={companyName} onChange={e => setCompanyName(e.target.value)} />
        </div>
      </div>

      <div>
        <label className={labelCls}>Strategy *</label>
        <select className={inputCls} value={strategy} onChange={e => handleStrategyChange(e.target.value)}>
          {strategies.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:gap-3 lg:grid-cols-3">
        <div className="min-w-0">
          <label className={labelCls}>Expiry Date *</label>
          <input type="date" className={inputCls} value={expiry} onChange={e => setExpiry(e.target.value)} />
        </div>
        <div className="min-w-0">
          <label className={labelCls}>Contracts *</label>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            className={`${inputCls} min-w-0`}
            value={contractsInput}
            onChange={e => {
              const digitsOnly = e.target.value.replace(/\D/g, '')
              setContractsInput(digitsOnly)
            }}
          />
        </div>
        <div className="min-w-0">
          <label className={labelCls}>Stock Price @ Entry *</label>
          <input type="number" step="0.01" className={`${inputCls} min-w-0`} placeholder="185.50" value={entryStockPrice} onChange={e => setEntryStock(e.target.value)} />
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Option Legs</div>
        {def.legs.map((tmpl, i) => (
          <div key={i} className="bg-gray-800/50 rounded-xl p-3 space-y-2">
            <div className={`text-xs font-bold ${tmpl.action === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>
              {tmpl.action} {tmpl.option_type} — {tmpl.label}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="min-w-0">
                <label className={labelCls}>Strike Price *</label>
                <input type="number" step="0.5" className={`${inputCls} min-w-0`} placeholder="195.00"
                  value={legStrikes[i]} onChange={e => { const a = [...legStrikes]; a[i] = e.target.value; setLegStrikes(a) }} />
              </div>
              <div className="min-w-0">
                <label className={labelCls}>Premium Paid/Received *</label>
                <input type="number" step="0.01" className={`${inputCls} min-w-0`} placeholder="3.45"
                  value={legPremiums[i]} onChange={e => { const a = [...legPremiums]; a[i] = e.target.value; setLegPremiums(a) }} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {legsComplete && (
        <div className="bg-gray-800/60 rounded-xl p-3 text-xs font-mono space-y-1">
          <div className="text-gray-400 font-sans font-semibold text-[10px] uppercase tracking-wide mb-2">Computed</div>
          <div className="flex gap-4 flex-wrap">
            <span className={metrics.netCredit >= 0 ? 'text-violet-400' : 'text-amber-400'}>
              {metrics.netCredit >= 0 ? 'Net Credit' : 'Net Debit'}: {metrics.netCredit >= 0 ? '+' : ''}${Math.abs(metrics.netCredit).toFixed(2)}/share
            </span>
            {contractsParsed != null ? (
              <>
                <span className="text-emerald-400">Max Profit: ${(metrics.maxProfit * 100 * contractsParsed).toLocaleString()}</span>
                <span className="text-red-400">Max Loss: ${(metrics.maxLoss * 100 * contractsParsed).toLocaleString()}</span>
              </>
            ) : (
              <span className="text-gray-500">Enter a contract count (1–9999) for position dollar totals</span>
            )}
          </div>
          {metrics.beLower > 0 && (
            <div className="text-gray-400">
              Breakeven: ${metrics.beLower.toFixed(2)}{metrics.beUpper < 990 ? ` – $${metrics.beUpper.toFixed(2)}` : ''}
            </div>
          )}
        </div>
      )}

      <div>
        <label className={labelCls}>Notes (optional — e.g. &quot;accidental entry&quot;, &quot;hedging position&quot;)</label>
        <textarea
          className={`${inputCls} resize-none`} rows={2}
          placeholder="e.g. Entered by mistake — need to exit ASAP"
          value={notes} onChange={e => setNotes(e.target.value)}
        />
      </div>
    </div>
  )

  const footer = (
    <div className={variant === 'modal' ? 'flex gap-2 px-5 py-4 border-t border-gray-800' : 'flex gap-2 pt-4 border-t border-gray-800'}>
      <button type="button" onClick={onCancel} className="flex-1 py-2.5 bg-gray-800 text-gray-300 text-sm rounded-xl hover:bg-gray-700 transition-colors">
        Cancel
      </button>
      {isEdit || variant === 'inline' ? (
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="flex-1 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors"
        >
          Save changes
        </button>
      ) : (
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          aria-label="Add to portfolio"
          title="Add to portfolio"
          className="inline-flex flex-1 min-h-[44px] items-center justify-center bg-violet-600 hover:bg-violet-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-xl transition-colors"
        >
          <Briefcase size={20} />
        </button>
      )}
    </div>
  )

  if (variant === 'modal') {
    return (
      <div className="portfolio-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto">
        <div className="portfolio-position-editor bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-lg my-4 overflow-hidden shadow-xl">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
            <div>
              <div className="text-base font-bold text-white flex items-center gap-2">
                <FileEdit size={16} className="text-violet-400" /> {isEdit ? 'Edit position' : 'Add Trade Manually'}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                {isEdit
                  ? 'Correct strikes, premiums, expiry, contracts, or ticker — distinct from Update (live quotes).'
                  : 'Enter any trade — recommendations, manual entries, or accidental trades to track for exit'}
              </div>
            </div>
            <button type="button" onClick={onCancel} className="text-gray-500 hover:text-gray-300 shrink-0"><X size={16} /></button>
          </div>
          {fieldsBlock}
          {footer}
        </div>
      </div>
    )
  }

  return (
    <div className="portfolio-position-editor rounded-xl border border-gray-700 bg-gray-950/40 p-4 max-h-[min(70vh,720px)] overflow-y-auto">
      <div className="text-xs font-bold text-violet-300 uppercase tracking-wide mb-1">Edit position fields</div>
      <p className="text-[11px] text-gray-500 mb-4">Fix typos or wrong legs here. Use <span className="text-cyan-400">Update</span> on the card header for fresh option-chain prices.</p>
      {fieldsBlock}
      {footer}
    </div>
  )
}

function ManualEntryModal({ onClose, onAdd }: {
  onClose: () => void
  onAdd: (pos: ManualPositionCommitPayload) => void
}) {
  return (
    <ManualPositionEditor variant="modal" initialPosition={null} onCancel={onClose} onCommit={onAdd} />
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Close-position modal (full or partial; % of max profit, realized $, or closing mark)
// ─────────────────────────────────────────────────────────────────────────────

type ClosePnlMode = 'percent' | 'dollars' | 'mark'

/** Match AppContext.portfolioContractCount rounding. */
function closeModalContractTotal(pos: PortfolioPosition): number {
  return normalizedContractCount(pos)
}

/** Cost-basis reference per contract: for debit strategies use |net_credit|, for credit use max_profit. */
function costBasisRefPerShare(pos: PortfolioPosition): number {
  return pos.net_credit < 0 ? Math.abs(pos.net_credit) : pos.max_profit
}

function pnlPctFromRealizedDollars(
  pos: PortfolioPosition,
  realizedDollars: number,
  contractsClosed: number,
): number {
  const denom = costBasisRefPerShare(pos) * SHARES_PER_OPTION_CONTRACT * contractsClosed
  if (!Number.isFinite(denom) || Math.abs(denom) < 1e-12) return 0
  return (realizedDollars / denom) * 100
}

/** Cash-style: opening net_credit + closing net (same sign: credit in positive, debit out negative) → realized on the trade. */
function realizedDollarsFromCloseNetPerShare(
  pos: PortfolioPosition,
  closeNetPerShare: number,
  contractsClosed: number,
): number {
  return (pos.net_credit + closeNetPerShare) * SHARES_PER_OPTION_CONTRACT * contractsClosed
}

function CloseModal({ pos, onClose, onConfirm }: {
  pos: PortfolioPosition
  onClose: () => void
  onConfirm: (payload: ClosePositionPayload) => void
}) {
  const total = closeModalContractTotal(pos)
  const [contractsStr, setContractsStr] = useState(String(total))
  const [pnlMode, setPnlMode] = useState<ClosePnlMode>('percent')
  const [pnl, setPnl] = useState('')
  const [realizedStr, setRealizedStr] = useState('')
  const [closeMarkStr, setCloseMarkStr] = useState('')

  useEffect(() => {
    setContractsStr(String(closeModalContractTotal(pos)))
    setPnl('')
    setRealizedStr('')
    setCloseMarkStr('')
    setPnlMode('percent')
  }, [pos.id, pos.contracts])

  const nParsed = Math.round(parseFloat(contractsStr))
  const contractsFieldValid = contractsStr.trim() !== '' && Number.isFinite(nParsed) && nParsed >= 1 && nParsed <= total
  const nClose = contractsFieldValid ? Math.min(Math.max(1, nParsed), total) : 1

  const isDebit = pos.net_credit < 0
  const profitLabel = isDebit ? '10× premium target' : 'max profit'
  const entryNetLabel = isDebit ? 'Net debit (/share)' : 'Net credit (/share)'

  const pnlNum = parseFloat(pnl)
  const realizedNum = parseFloat(realizedStr)
  const closeMarkNum = parseFloat(closeMarkStr)

  let pnlPctForSave = 0
  let previewDollars: number | null = null
  let canSubmit = false

  if (pnlMode === 'percent') {
    const valid = contractsFieldValid && pnl !== '' && Number.isFinite(pnlNum)
    if (valid) {
      canSubmit = true
      pnlPctForSave = pnlNum
      previewDollars = (pnlNum / 100) * costBasisRefPerShare(pos) * SHARES_PER_OPTION_CONTRACT * nClose
    }
  } else if (pnlMode === 'dollars') {
    const valid = contractsFieldValid && realizedStr !== '' && Number.isFinite(realizedNum)
    if (valid) {
      canSubmit = true
      previewDollars = realizedNum
      pnlPctForSave = pnlPctFromRealizedDollars(pos, realizedNum, nClose)
    }
  } else {
    const valid = contractsFieldValid && closeMarkStr !== '' && Number.isFinite(closeMarkNum)
    if (valid) {
      canSubmit = true
      previewDollars = realizedDollarsFromCloseNetPerShare(pos, closeMarkNum, nClose)
      pnlPctForSave = pnlPctFromRealizedDollars(pos, previewDollars, nClose)
    }
  }

  const remaining = total - nClose

  return (
    <div className="portfolio-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md p-6 space-y-4 my-auto">
        <div className="flex items-center justify-between gap-2">
          <div className="text-base font-bold text-white">Close position</div>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-300 shrink-0" aria-label="Dismiss">
            <X size={16} />
          </button>
        </div>

        <div className="bg-gray-800 rounded-xl p-3 text-sm space-y-1">
          <div className="text-gray-400 text-xs">{pos.ticker} · {pos.strategy}</div>
          <div className="text-gray-200 font-mono text-sm">
            Open size: <span className="text-white font-bold">{total}</span> contract{total > 1 ? 's' : ''}
            {' · '}
            {isDebit ? '10× target' : 'Max profit'}: {fmtDollar(pos.max_profit * SHARES_PER_OPTION_CONTRACT * total)} total
          </div>
          <div className="text-gray-500 text-xs">
            {entryNetLabel}: <span className="text-gray-300 font-mono">{pos.net_credit >= 0 ? '+' : ''}{pos.net_credit.toFixed(3)}</span>
            {' '}/share · {fmtDollar(pos.max_profit * SHARES_PER_OPTION_CONTRACT)}/share {isDebit ? '(10× ref)' : 'max profit'}
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-400 block mb-1.5">Contracts to close</label>
          <input
            type="number"
            min={1}
            max={total}
            step={1}
            value={contractsStr}
            onChange={e => setContractsStr(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-violet-500 placeholder-gray-600"
          />
          <p className="text-[11px] text-gray-500 mt-1.5">
            {remaining > 0
              ? <>
                  Leaves <span className="text-gray-300 font-mono">{remaining}</span> open on this line (same strikes/expiry).
                </>
              : <>
                  Closing the full open size ({total} contract{total > 1 ? 's' : ''}); this row will move to Closed.
                </>}
          </p>
        </div>

        <div>
          <div className="text-xs font-semibold text-gray-400 mb-2">How to record P&amp;L for these {nClose} contract{nClose > 1 ? 's' : ''}</div>
          <div className="flex flex-wrap gap-1.5">
            {(['percent', 'dollars', 'mark'] as const).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => setPnlMode(m)}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold border transition-colors ${
                  pnlMode === m
                    ? 'bg-violet-900/60 border-violet-500 text-violet-100'
                    : 'bg-gray-800/80 border-gray-700 text-gray-400 hover:border-gray-600'
                }`}
              >
                {m === 'percent' ? '% of max profit' : m === 'dollars' ? 'Realized ($)' : 'Closing net (/share)'}
              </button>
            ))}
          </div>
        </div>

        {pnlMode === 'percent' && (
          <div>
            <label className="text-xs font-semibold text-gray-400 block mb-1.5">P&amp;L as % of {profitLabel}</label>
            <input
              type="number"
              value={pnl}
              onChange={e => setPnl(e.target.value)}
              placeholder={`e.g. 50 = 50% of ${profitLabel} on ${nClose} ct`}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-violet-500 placeholder-gray-600"
            />
            <p className="text-[11px] text-gray-500 mt-1.5">
              Same idea as before: % applies to <span className="text-gray-400">max profit × 100 × ({nClose} contracts)</span>.
            </p>
          </div>
        )}

        {pnlMode === 'dollars' && (
          <div>
            <label className="text-xs font-semibold text-gray-400 block mb-1.5">Realized P&amp;L (total $)</label>
            <input
              type="number"
              value={realizedStr}
              onChange={e => setRealizedStr(e.target.value)}
              placeholder="e.g. 240 or -120"
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-violet-500 placeholder-gray-600"
            />
            <p className="text-[11px] text-gray-500 mt-1.5">
              Total dollars on this close only ({nClose} contract{nClose > 1 ? 's' : ''}). Positive = profit, negative = loss.
            </p>
          </div>
        )}

        {pnlMode === 'mark' && (
          <div>
            <label className="text-xs font-semibold text-gray-400 block mb-1.5">Closing net premium ($/share)</label>
            <input
              type="number"
              value={closeMarkStr}
              onChange={e => setCloseMarkStr(e.target.value)}
              placeholder="Same sign as entry: credit in +, debit out −"
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-violet-500 placeholder-gray-600"
            />
            <p className="text-[11px] text-gray-500 mt-1.5">
              Enter the combined net for the spread when you closed, using the <span className="text-gray-400">same sign as {entryNetLabel}</span> above
              (money received = positive, money paid = negative). We compute realized = (entry + closing net) × 100 × {nClose}.
            </p>
          </div>
        )}

        {previewDollars != null && Number.isFinite(previewDollars) && (
          <div className={`text-xs font-mono rounded-lg px-3 py-2 border ${
            previewDollars >= 0 ? 'text-emerald-400 border-emerald-800/60 bg-emerald-950/20' : 'text-red-400 border-red-800/60 bg-red-950/20'
          }`}>
            ≈ {fmtDollar(previewDollars, true)} on {nClose} contract{nClose > 1 ? 's' : ''}
            {pnlMode !== 'percent' && (
              <span className="text-gray-500"> · stored as {pnlPctForSave.toFixed(2)}% of {profitLabel}</span>
            )}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 bg-gray-800 text-gray-300 text-sm rounded-xl hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => canSubmit && onConfirm({ contractsToClose: nClose, realized_pnl_percent: pnlPctForSave, realized_pnl: previewDollars ?? undefined })}
            disabled={!canSubmit}
            className="flex-1 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors"
          >
            {remaining > 0 ? `Close ${nClose} · keep ${remaining}` : 'Close all'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Position card
// ─────────────────────────────────────────────────────────────────────────────

function PositionCard({
  pos,
  hubCategory,
  onClose,
  onRemove,
  onUpdateQuotes,
  isUpdatingQuotes,
  onSaveEditedPosition,
}: {
  pos: PortfolioPosition
  /** Positions hub: Regular vs Swing (day trades use a separate card). */
  hubCategory?: 'regular' | 'swing'
  onClose: () => void
  onRemove: () => void
  /** Refetch chain/quotes for this open position's ticker + expiry */
  onUpdateQuotes?: () => void | Promise<void>
  isUpdatingQuotes?: boolean
  onSaveEditedPosition: (id: string, payload: ManualPositionCommitPayload) => void
}) {
  const { tickerCache } = useApp()
  const [expanded, setExpanded] = useState(false)
  const [detailTab, setDetailTab] = useState<'details' | 'edit'>('details')
  const contractCount = normalizedContractCount(pos)
  const isClosed   = pos.status === 'closed'
  const isDebit    = pos.net_credit < 0
  const isManual   = pos.source === 'manual'

  const cachedEntry        = tickerCache[pos.ticker]
  const analyzeData        = resolvePortfolioAnalyzeData(cachedEntry, pos.expiry)
  const currentPrice       = analyzeData?.signals?.current_price ?? null
  const suggestionEval     = openPositionEvalDollar(pos, analyzeData)
  const mtmDollar =
    !isClosed && analyzeData
      ? markToMarketPositionDollars(pos.legs, analyzeData, pos.expiry, contractCount)
      : null

  let mtmUnavailableHint: string | null = null
  if (!isClosed && mtmDollar === null) {
    if (!analyzeData) {
      mtmUnavailableHint = 'Fetching option marks for your expiry… If this persists, tap Refresh at the top or Update on this card.'
    } else if (!chainExpiryMatches(analyzeData, pos.expiry)) {
      const ce = analyzeData.filters_applied?.chain_expiry
      const ceLabel = typeof ce === 'string' ? normalizeExpiryIso(ce) : '?'
      mtmUnavailableHint =
        `Live P&L compares entry mids to today's chain mids for expiry ${normalizeExpiryIso(pos.expiry)}. Cached chain is ${ceLabel}. Tap Refresh or Update on this card to reload.`
    } else {
      mtmUnavailableHint = 'Could not read a mid price for every leg (missing quotes). Try Refresh or Update on this card, or wait for tighter markets.'
    }
  }

  const realisedDollar = pos.pnlPct != null ? (pos.pnlPct / 100) * costBasisRefPerShare(pos) * SHARES_PER_OPTION_CONTRACT * contractCount : null

  const suggestion = !isClosed ? getExitSuggestion(pos, suggestionEval) : null
  const sStyle     = suggestion ? SUGGESTION_STYLE[suggestion.level] : null

  const dte = Math.ceil((new Date(pos.expiry + 'T00:00:00').getTime() - Date.now()) / 86400000)
  const hasKellySnapshot = pos.kelly_fraction != null || pos.half_kelly_fraction != null || pos.edge_ratio != null
  const capitalRiskPct = pos.account_size_at_entry && pos.capital_at_risk != null
    ? (pos.capital_at_risk / pos.account_size_at_entry) * 100
    : null

  const isMistake = !!(pos.notes?.toLowerCase().includes('mistake') || pos.notes?.toLowerCase().includes('accidental') || pos.notes?.toLowerCase().includes('error'))

  return (
    <div className={`bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden ${isClosed ? 'opacity-60' : ''}`}>
      {/* ── Suggestion banner (open positions only) ─────────────── */}
      {!isClosed && suggestion && sStyle && (
        <div className={`${sStyle.bg} border-b ${sStyle.border} px-4 py-2.5 flex items-start gap-2`}>
          <span className="text-base shrink-0 mt-0.5">{sStyle.icon}</span>
          <div className="flex-1 min-w-0">
            <div className={`text-xs font-bold ${sStyle.title}`}>{suggestion.title}</div>
            <div className="text-xs text-gray-400 mt-0.5">{suggestion.reason}</div>
            <div className={`text-xs font-semibold mt-1 ${sStyle.title}`}>→ {suggestion.action}</div>
          </div>
        </div>
      )}

      {/* Mistake flag */}
      {isMistake && !isClosed && (
        <div className="bg-orange-900/30 border-b border-orange-700 px-4 py-1.5 flex items-center gap-1.5">
          <AlertTriangle size={12} className="text-orange-400" />
          <span className="text-xs text-orange-300 font-semibold">Flagged: {pos.notes}</span>
        </div>
      )}

      <div className="p-4 space-y-3">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-lg font-bold text-white font-mono">{pos.ticker}</span>
              {hubCategory ? <PositionCategoryPill kind={hubCategory} /> : null}
              <span className="text-xs bg-violet-900/50 text-violet-300 border border-violet-700 px-2 py-0.5 rounded-full font-semibold">{pos.strategy}</span>
              {isManual && (
                <span className="text-xs bg-gray-800 text-gray-500 border border-gray-700 px-2 py-0.5 rounded-full">manual</span>
              )}
              <span className="flex items-center gap-1 text-xs bg-gray-800 border border-gray-700 text-gray-400 px-2 py-0.5 rounded-full">
                <Layers size={10} /> {contractCount} contract{contractCount > 1 ? 's' : ''}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${
                isClosed ? 'bg-gray-800 text-gray-500 border-gray-700'
                : dte > 7  ? 'bg-emerald-900/30 text-emerald-400 border-emerald-800'
                : dte > 0  ? 'bg-amber-900/30 text-amber-400 border-amber-800'
                :            'bg-red-900/30 text-red-400 border-red-800'
              }`}>
                {isClosed ? '✓ Closed' : dte > 0 ? `${dte}d left` : 'Expired'}
              </span>
            </div>
            <div className="text-xs text-gray-500 mt-0.5">{pos.companyName} · Exp {pos.expiry}</div>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            <button
              type="button"
              onClick={() => { setExpanded(true); setDetailTab('edit') }}
              title="Edit strikes, premiums, expiry, contracts — fixes wrong manual entry"
              className="portfolio-edit-trigger flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-violet-600 text-gray-300 hover:text-violet-300 text-xs font-semibold rounded-xl transition-colors"
            >
              <FileEdit size={12} /> Edit
            </button>
            {!isClosed && onUpdateQuotes && (
              <button
                type="button"
                onClick={() => void onUpdateQuotes()}
                disabled={isUpdatingQuotes}
                title="Update"
                className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-900/20 hover:bg-cyan-900/35 border border-cyan-800 text-cyan-400 text-xs font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw size={12} className={isUpdatingQuotes ? 'animate-spin shrink-0' : 'shrink-0'} />
                Update
              </button>
            )}
            {!isClosed && (
              <button
                type="button"
                onClick={onClose}
                title="Close contracts (full or partial) and record P&L"
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-900/20 hover:bg-emerald-900/40 border border-emerald-800 text-emerald-400 text-xs font-semibold rounded-xl transition-colors"
              >
                <CheckCircle size={12} /> Close
              </button>
            )}
            <button
              type="button"
              onClick={onRemove}
              title="Remove from portfolio"
              className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {/* Realised P&L (closed) */}
        {isClosed && realisedDollar !== null && (
          <div className={`rounded-xl px-3 py-2.5 border ${
            realisedDollar >= 0 ? 'bg-emerald-900/20 border-emerald-800' : 'bg-red-900/20 border-red-800'
          }`}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {realisedDollar >= 0 ? <TrendingUp size={15} className="text-emerald-400" /> : <TrendingDown size={15} className="text-red-400" />}
                <span className="text-sm font-medium text-gray-400">Realized P&amp;L</span>
              </div>
              <div className="text-right">
                <div className={`text-base font-bold font-mono ${realisedDollar >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {fmtDollar(realisedDollar, true)}
                </div>
                {pos.exitDate && (
                  <div className="text-[10px] text-gray-600">
                    Closed {new Date(pos.exitDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Key metrics grid */}
        <div className={`grid gap-2 grid-cols-2 ${isClosed ? 'sm:grid-cols-4' : 'sm:grid-cols-3 lg:grid-cols-5'}`}>
          {isDebit
            ? (
              <div className="bg-gray-800/60 rounded-xl px-3 py-2">
                <div className="text-xs text-gray-500 mb-0.5">Net Debit</div>
                <div className="text-sm font-bold font-mono text-amber-400">
                  ${(Math.abs(pos.net_credit) * SHARES_PER_OPTION_CONTRACT * contractCount).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                </div>
                <div className="text-xs text-gray-600 truncate">${(Math.abs(pos.net_credit) * SHARES_PER_OPTION_CONTRACT).toFixed(0)}/ea</div>
              </div>
            )
            : (
              <div className="bg-gray-800/60 rounded-xl px-3 py-2">
                <div className="text-xs text-gray-500 mb-0.5">Net Credit</div>
                <div className="text-sm font-bold font-mono text-violet-400">
                  +${(pos.net_credit * SHARES_PER_OPTION_CONTRACT * contractCount).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                </div>
                <div className="text-xs text-gray-600 truncate">{contractCount}× contract</div>
              </div>
            )}
          <div className="bg-gray-800/60 rounded-xl px-3 py-2">
            <div className="text-xs text-gray-500 mb-0.5">Max Profit</div>
            <div className="text-sm font-bold font-mono text-emerald-400">
              ${(pos.max_profit * SHARES_PER_OPTION_CONTRACT * contractCount).toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </div>
            <div className="text-xs text-gray-600 truncate">{isDebit ? '10× target/ea' : `$${(pos.max_profit * SHARES_PER_OPTION_CONTRACT).toFixed(0)}/ea`}</div>
          </div>
          <div className="bg-gray-800/60 rounded-xl px-3 py-2">
            <div className="text-xs text-gray-500 mb-0.5">Max Loss</div>
            <div className="text-sm font-bold font-mono text-red-400">
              -${(pos.max_loss * SHARES_PER_OPTION_CONTRACT * contractCount).toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </div>
            <div className="text-xs text-gray-600 truncate">${(pos.max_loss * SHARES_PER_OPTION_CONTRACT).toFixed(0)}/ea</div>
          </div>
          {!isClosed && (
            <div
              className={`portfolio-mtm-tile rounded-xl px-3 py-2 border ${
                mtmDollar == null
                  ? 'portfolio-mtm-tile--neutral bg-gray-800/60 border-gray-700/60'
                  : mtmDollar >= 0
                    ? 'portfolio-mtm-tile--gain bg-emerald-950/40 border-emerald-600/50'
                    : 'portfolio-mtm-tile--loss bg-red-950/40 border-red-600/50'
              }`}
            >
              <div className="text-xs text-gray-500 mb-0.5">Current P&amp;L</div>
              <div className={`text-sm font-bold font-mono tabular-nums ${
                mtmDollar == null ? 'text-gray-500' : mtmDollar >= 0 ? 'text-emerald-400' : 'text-red-400'
              }`}>
                {mtmDollar != null ? fmtDollar(mtmDollar, true) : '—'}
              </div>
              <div className="text-xs text-gray-600 truncate">{contractCount} ct × {SHARES_PER_OPTION_CONTRACT} sh</div>
            </div>
          )}
          <div className="bg-gray-800/60 rounded-xl px-3 py-2">
            <div className="text-xs text-gray-500 mb-0.5">Stock @ Entry</div>
            <div className="text-sm font-bold font-mono text-gray-300">${pos.entryPrice.toFixed(2)}</div>
            <div className="text-xs text-gray-600 truncate">{pos.bias}</div>
          </div>
        </div>
        {!isClosed && mtmUnavailableHint && (
          <p className="text-xs text-amber-400/95 px-0.5">{mtmUnavailableHint}</p>
        )}

        {/* Expand toggle for details / edit */}
        <button
          type="button"
          onClick={() => setExpanded(e => {
            if (e) setDetailTab('details')
            return !e
          })}
          className="w-full flex items-center justify-center gap-1 text-xs text-gray-600 hover:text-gray-400 transition-colors py-0.5"
        >
          {expanded ? <><ChevronUp size={12} /> Hide details</> : <><ChevronDown size={12} /> Show details</>}
        </button>

        {expanded && (
          <>
            <div className="flex justify-center gap-1 p-1 bg-gray-800/50 border border-gray-800 rounded-xl w-full max-w-xs mx-auto">
              <button
                type="button"
                onClick={() => setDetailTab('details')}
                className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  detailTab === 'details' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                Details
              </button>
              <button
                type="button"
                onClick={() => setDetailTab('edit')}
                className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  detailTab === 'edit' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                Edit
              </button>
            </div>

            {detailTab === 'details' ? (
          <div className="space-y-2">
            {/* Breakeven */}
            {(pos.breakeven_lower > 0 || (pos.breakeven_upper && pos.breakeven_upper < 990)) && (
              <div className="bg-gray-800/40 rounded-xl px-3 py-2 flex items-center gap-3 text-xs">
                <span className="text-gray-500">Breakeven:</span>
                <span className="text-white font-mono">
                  {pos.breakeven_upper && pos.breakeven_upper < 990
                    ? `$${pos.breakeven_lower.toFixed(2)} – $${pos.breakeven_upper.toFixed(2)}`
                    : `$${pos.breakeven_lower.toFixed(2)}`}
                </span>
                {currentPrice != null && (
                  <span className={`ml-auto font-semibold ${
                    suggestionEval == null ? 'text-gray-500'
                      : suggestionEval >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    Current: ${currentPrice.toFixed(2)}
                  </span>
                )}
              </div>
            )}
            {isDebit && suggestionEval != null && suggestionEval < 0 && pos.breakeven_lower && pos.breakeven_lower < 990 && currentPrice != null && (
              <div className="text-xs text-amber-400/80 rounded-xl px-3 py-2 bg-gray-800/40 border border-amber-900/30">
                {(() => {
                  const isBearishLeg = pos.legs.some(l => l.option_type === 'PUT' && l.action === 'BUY')
                  const direction = isBearishLeg ? 'fall to' : 'rise to'
                  const gap = Math.abs(pos.breakeven_lower - currentPrice)
                  return <>Stock needs to {direction} ${pos.breakeven_lower.toFixed(2)} to break even (${gap.toFixed(2)} away).</>
                })()}
              </div>
            )}

            {/* Kelly snapshot */}
            {hasKellySnapshot && (
              <div className="bg-violet-950/30 border border-violet-900/60 rounded-xl px-3 py-2">
                <div className="text-xs text-violet-300 font-semibold mb-1.5">Kelly snapshot at entry</div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px]">
                  <div>
                    <div className="text-gray-500">Edge</div>
                    <div className={`font-mono font-bold ${(pos.edge_ratio ?? 0) < 0.05 ? 'text-amber-400' : 'text-emerald-400'}`}>
                      {((pos.edge_ratio ?? 0) * 100).toFixed(1)}%
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-500">Full Kelly</div>
                    <div className="font-mono font-bold text-violet-300">{((pos.kelly_fraction ?? 0) * 100).toFixed(1)}%</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Half-Kelly</div>
                    <div className="font-mono font-bold text-violet-400">{((pos.half_kelly_fraction ?? 0) * 100).toFixed(1)}%</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Capital at risk</div>
                    <div className="font-mono font-bold text-gray-200">
                      {pos.capital_at_risk != null ? fmtDollar(pos.capital_at_risk) : '-'}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-500">Account</div>
                    <div className={`font-mono font-bold ${
                      capitalRiskPct != null && capitalRiskPct > 20 ? 'text-red-400' :
                      capitalRiskPct != null && capitalRiskPct >= 10 ? 'text-amber-400' : 'text-gray-200'
                    }`}>
                      {capitalRiskPct != null ? `${capitalRiskPct.toFixed(1)}%` : '-'}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Legs */}
            <div className="bg-gray-800/40 rounded-xl px-3 py-2">
              <div className="text-xs text-gray-500 mb-1.5">Legs</div>
              <div className="flex flex-wrap gap-2">
                {pos.legs.map((leg, i) => (
                  <span key={i} className={`text-xs font-mono px-2 py-0.5 rounded-lg border ${leg.action === 'SELL' ? 'bg-red-900/15 border-red-900/40 text-red-300' : 'bg-emerald-900/15 border-emerald-900/40 text-emerald-300'}`}>
                    {leg.action} ${leg.strike} {leg.option_type[0]} @ ${Number(leg.mid_price).toFixed(2)}
                  </span>
                ))}
              </div>
            </div>

            {/* Notes */}
            {pos.notes && (
              <div className="bg-gray-800/40 rounded-xl px-3 py-2 text-xs text-gray-400">
                <span className="text-gray-600 mr-1">Notes:</span>{pos.notes}
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between text-xs text-gray-600">
              <span className="flex items-center gap-1">
                <Clock size={11} />
                Added {new Date(pos.addedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
              {pos.scores_total > 0 && <span>Score: {pos.scores_total}/100 · PoP {(pos.prob_of_profit * 100).toFixed(0)}%</span>}
            </div>
          </div>
            ) : (
              <ManualPositionEditor
                variant="inline"
                initialPosition={pos}
                onCancel={() => setDetailTab('details')}
                onCommit={(payload) => {
                  onSaveEditedPosition(pos.id, payload)
                  setDetailTab('details')
                }}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

/** Standalone Portfolio page (`/portfolio` fallback) vs embedded Positions Center tabs */
export type PortfolioContentMode = 'standalone' | 'positions-open' | 'positions-closed' | 'positions-open-merged'

const ACTIVE_TRADES_POLL_MS = 900_000

export type PositionsHubFilters = {
  tradeStyle: 'all' | 'day' | 'swing' | 'regular'
  typeFilter: 'all' | 'options' | 'stocks' | 'spreads'
  riskFilter: 'all' | 'low' | 'medium' | 'high'
}

/** Wire Positions Center header Download control to the same export logic as standalone portfolio. */
export type PositionsHubExportHandles = {
  anchorRef: RefObject<HTMLButtonElement | null>
  toggleRef: MutableRefObject<{ toggle: () => void } | null>
  onCanExportChange: (can: boolean) => void
  onMenuOpenChange?: (open: boolean) => void
}

type MergedOpenRow =
  | { kind: 'portfolio'; pos: PortfolioPosition; category: ReturnType<typeof inferPortfolioHubCategory> }
  | { kind: 'day'; trade: ActiveTradeRow }

function portfolioTypeKind(pos: PortfolioPosition): 'options' | 'stocks' | 'spreads' {
  const n = pos.legs?.length ?? 0
  if (n >= 2) return 'spreads'
  if (n > 0) return 'options'
  return 'stocks'
}

function dayTradeTypeKind(row: ActiveTradeRow): 'options' | 'stocks' | 'spreads' {
  if (row.strike != null && row.strike > 0) return 'options'
  return 'stocks'
}

function dayTradeRiskTier(row: ActiveTradeRow): 'low' | 'medium' | 'high' {
  const d = row.decision as { badge_tone?: string }
  const t = d.badge_tone ?? 'gray'
  if (t === 'red') return 'high'
  if (t === 'orange') return 'medium'
  return 'low'
}

function portfolioRiskTier(pos: PortfolioPosition, tickerCache: Record<string, TickerCacheEntry>): 'low' | 'medium' | 'high' {
  const entry = tickerCache[pos.ticker]
  const resolved = resolvePortfolioAnalyzeData(entry, pos.expiry)
  const evalDollar = openPositionEvalDollar(pos, resolved)
  const s = getExitSuggestion(pos, evalDollar)
  if (s.level === 'EXIT_NOW' || s.level === 'EXPIRED') return 'high'
  if (s.level === 'MANAGE' || s.level === 'ROLL') return 'medium'
  return 'low'
}

function mergedRowMatchesFilters(
  row: MergedOpenRow,
  f: PositionsHubFilters,
  tickerCache: Record<string, TickerCacheEntry>,
): boolean {
  if (f.tradeStyle !== 'all') {
    if (f.tradeStyle === 'day') {
      if (row.kind !== 'day') return false
    } else if (row.kind === 'day') {
      return false
    } else if (row.kind === 'portfolio') {
      if (f.tradeStyle === 'swing' && row.category !== 'swing') return false
      if (f.tradeStyle === 'regular' && row.category !== 'regular') return false
    }
  }
  if (f.typeFilter !== 'all') {
    if (row.kind === 'day') {
      if (f.typeFilter === 'spreads') return false
      if (dayTradeTypeKind(row.trade) !== f.typeFilter) return false
    } else if (portfolioTypeKind(row.pos) !== f.typeFilter) {
      return false
    }
  }
  if (f.riskFilter !== 'all') {
    const tier = row.kind === 'day' ? dayTradeRiskTier(row.trade) : portfolioRiskTier(row.pos, tickerCache)
    if (tier !== f.riskFilter) return false
  }
  return true
}

function asActiveTradeDecision(row: ActiveTradeRow) {
  const d = row.decision as {
    state?: string
    action?: string
    message?: string
    badge_tone?: string
    risk_warning?: string
    confirmation_needed?: string[]
  }
  return d
}

function buildMergedOpenRows(dayTrades: ActiveTradeRow[], openPositions: PortfolioPosition[]): MergedOpenRow[] {
  const dayRows: MergedOpenRow[] = [...dayTrades]
    .sort((a, b) => b.opened_at_ms - a.opened_at_ms)
    .map(trade => ({ kind: 'day' as const, trade }))
  const pfRows: MergedOpenRow[] = [...openPositions]
    .sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime())
    .map(pos => ({
      kind: 'portfolio' as const,
      pos,
      category: inferPortfolioHubCategory(pos),
    }))
  return [...dayRows, ...pfRows]
}

export function PortfolioPageContent({
  mode,
  hubFilters,
  positionsHubExport,
}: {
  mode: PortfolioContentMode
  hubFilters?: PositionsHubFilters
  positionsHubExport?: PositionsHubExportHandles
}) {
  const {
    portfolio, closePosition, removeFromPortfolio, addManualPosition, updatePortfolioPosition, navigateToTickerAdvisorFresh,
    refreshingTickers, tickerCache, ensureAnalysisForPortfolioExpiry, canAccessPage,
  } = useApp()
  const [refreshingPositionIds, setRefreshingPositionIds] = useState<Set<string>>(() => new Set())
  const [closing,    setClosing]    = useState<PortfolioPosition | null>(null)
  const [addingNew,  setAddingNew]  = useState(false)
  const [filter,     setFilter]     = useState<'all' | 'open' | 'closed'>(
    mode === 'positions-closed' ? 'closed' : 'open',
  )
  const [refreshingPortfolio, setRefreshingPortfolio] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [hubExportPortalPos, setHubExportPortalPos] = useState<{ top: number; left: number } | null>(null)
  const hubExportMenuRef = useRef<HTMLDivElement | null>(null)
  const toggleExportMenu = useCallback(() => {
    setExportOpen(o => !o)
  }, [])
  const [activeDayTrades, setActiveDayTrades] = useState<ActiveTradeRow[]>([])
  const [activeDayTradesLoading, setActiveDayTradesLoading] = useState(false)
  const [activeExitingId, setActiveExitingId] = useState<string | null>(null)
  const [focusedPortfolioDetailId, setFocusedPortfolioDetailId] = useState<string | null>(null)
  const [portfolioHydratePulse, setPortfolioHydratePulse] = useState(0)
  const embedded = mode !== 'standalone'
  const [searchParams, setSearchParams] = useSearchParams()

  useEffect(() => {
    const add = searchParams.get('add')
    if (add === 'manual' || add === '1') {
      setAddingNew(true)
      setSearchParams(
        prev => {
          const next = new URLSearchParams(prev)
          next.delete('add')
          return next
        },
        { replace: true },
      )
    }
  }, [searchParams, setSearchParams])
  const effectiveFilter: 'all' | 'open' | 'closed' =
    mode === 'positions-open' || mode === 'positions-open-merged'
      ? 'open'
      : mode === 'positions-closed'
        ? 'closed'
        : filter

  const open   = portfolio.filter(p => p.status === 'open')
  const closed = portfolio.filter(p => p.status === 'closed')
  const shown  = effectiveFilter === 'all' ? portfolio : effectiveFilter === 'open' ? open : closed

  useLayoutEffect(() => {
    if (!embedded || !positionsHubExport) return
    positionsHubExport.toggleRef.current = { toggle: toggleExportMenu }
    positionsHubExport.onCanExportChange(shown.length > 0)
    return () => {
      positionsHubExport.toggleRef.current = null
    }
  }, [embedded, positionsHubExport, shown.length, toggleExportMenu])

  useEffect(() => {
    positionsHubExport?.onMenuOpenChange?.(exportOpen)
  }, [exportOpen, positionsHubExport])

  useEffect(() => {
    if (!positionsHubExport) setExportOpen(false)
  }, [positionsHubExport])

  useLayoutEffect(() => {
    if (!exportOpen || !embedded || !positionsHubExport) {
      setHubExportPortalPos(null)
      return
    }
    const el = positionsHubExport.anchorRef.current
    if (!el) {
      setHubExportPortalPos(null)
      return
    }
    const r = el.getBoundingClientRect()
    const menuWidth = 176
    setHubExportPortalPos({
      top: r.bottom + 8,
      left: Math.max(8, r.right - menuWidth),
    })
  }, [exportOpen, embedded, positionsHubExport])

  useEffect(() => {
    if (!exportOpen || !embedded || !positionsHubExport) return
    const onPointerDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (positionsHubExport.anchorRef.current?.contains(t)) return
      if (hubExportMenuRef.current?.contains(t)) return
      setExportOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [exportOpen, embedded, positionsHubExport])

  const openTickers = Array.from(new Set(open.map(p => p.ticker).filter(Boolean)))
  const portfolioRefreshActive = refreshingPortfolio || openTickers.some(ticker => refreshingTickers.has(ticker))

  const hubFilterResolved: PositionsHubFilters = hubFilters ?? {
    tradeStyle: 'all',
    typeFilter: 'all',
    riskFilter: 'all',
  }

  const loadActiveDayTrades = useCallback(async () => {
    if (mode !== 'positions-open-merged' || !canAccessPage('active-trades')) return
    setActiveDayTradesLoading(true)
    try {
      const { trades } = await listActiveTrades()
      setActiveDayTrades(trades)
    } catch {
      setActiveDayTrades([])
    } finally {
      setActiveDayTradesLoading(false)
    }
  }, [mode, canAccessPage])

  useEffect(() => {
    void loadActiveDayTrades()
  }, [loadActiveDayTrades])

  useEffect(() => {
    if (mode !== 'positions-open-merged' || !canAccessPage('active-trades')) return
    const id = window.setInterval(() => void loadActiveDayTrades(), ACTIVE_TRADES_POLL_MS)
    return () => window.clearInterval(id)
  }, [mode, canAccessPage, loadActiveDayTrades])

  const mergedOpenRows = useMemo(() => {
    if (mode !== 'positions-open-merged') return null
    return buildMergedOpenRows(activeDayTrades, open)
  }, [mode, activeDayTrades, open])

  const mergedOpenFiltered = useMemo(() => {
    if (!mergedOpenRows) return null
    return mergedOpenRows.filter(r => mergedRowMatchesFilters(r, hubFilterResolved, tickerCache))
  }, [mergedOpenRows, hubFilterResolved, tickerCache])

  useEffect(() => {
    if (!focusedPortfolioDetailId) return
    const stillHere = mergedOpenFiltered?.some(
      r => r.kind === 'portfolio' && r.pos.id === focusedPortfolioDetailId,
    )
    if (!stillHere) setFocusedPortfolioDetailId(null)
  }, [mergedOpenFiltered, focusedPortfolioDetailId])

  const handleExitActiveTrade = useCallback(
    async (id: string) => {
      setActiveExitingId(id)
      try {
        await exitActiveTrade(id)
        await loadActiveDayTrades()
      } finally {
        setActiveExitingId(null)
      }
    },
    [loadActiveDayTrades],
  )

  // Urgent positions (EXIT_NOW / EXPIRED) — shown in alert banner
  const urgentCount = useMemo(() =>
    open.filter(p => {
      const entry = tickerCache[p.ticker]
      const resolved = resolvePortfolioAnalyzeData(entry, p.expiry)
      const evalDollar = openPositionEvalDollar(p, resolved)
      const s = getExitSuggestion(p, evalDollar)
      return s.level === 'EXIT_NOW' || s.level === 'EXPIRED'
    }).length
  , [open, tickerCache])

  const closedWithPnl    = closed.filter(p => p.pnlPct != null)
  const totalRealisedPnl = closedWithPnl.reduce((s, p) => {
    const c = normalizedContractCount(p)
    return s + ((p.pnlPct! / 100) * p.max_profit * SHARES_PER_OPTION_CONTRACT * c)
  }, 0)
  const totalOpenContracts = open.reduce((s, p) => s + (p.contracts ?? 1), 0)
  const winRate = closedWithPnl.length
    ? Math.round((closedWithPnl.filter(p => (p.pnlPct ?? 0) > 0).length / closedWithPnl.length) * 100)
    : null

  const handleRefreshPortfolio = async () => {
    if (open.length === 0 || refreshingPortfolio) return
    setRefreshingPortfolio(true)
    try {
      const seen = new Set<string>()
      for (const pos of open) {
        const key = `${pos.ticker}|${normalizeExpiryIso(pos.expiry)}`
        if (seen.has(key)) continue
        seen.add(key)
        await ensureAnalysisForPortfolioExpiry(pos.ticker, pos.expiry, {
          force: true,
          spreadWidth: Number.isFinite(pos.spread_width) ? Math.round(pos.spread_width) : undefined,
        })
      }
    } finally {
      setRefreshingPortfolio(false)
    }
  }

  const handleUpdatePositionCard = useCallback(async (pos: PortfolioPosition) => {
    if (pos.status !== 'open') return
    setRefreshingPositionIds(prev => new Set(prev).add(pos.id))
    try {
      await ensureAnalysisForPortfolioExpiry(pos.ticker, pos.expiry, {
        force: true,
        spreadWidth: Number.isFinite(pos.spread_width) ? Math.round(pos.spread_width) : undefined,
      })
    } finally {
      setRefreshingPositionIds(prev => {
        const next = new Set(prev)
        next.delete(pos.id)
        return next
      })
    }
  }, [ensureAnalysisForPortfolioExpiry])

  const openFeedTableRows = useMemo((): OpenPositionsFeedRow[] => {
    if (!mergedOpenFiltered || mode !== 'positions-open-merged') return []
    const out: OpenPositionsFeedRow[] = []
    for (const row of mergedOpenFiltered) {
      if (row.kind === 'day') {
        const t = row.trade
        const d = asActiveTradeDecision(t)
        const contracts = t.contracts != null && t.contracts > 0 ? String(Math.round(t.contracts)) : '—'
        const strikeBit = t.strike != null && t.strike > 0 ? ` $${Number(t.strike).toFixed(0)}` : ''
        const strategy = `${t.side}${strikeBit}`
        const tone = typeof d.badge_tone === 'string' ? d.badge_tone : 'gray'
        const badge = (
          <span className={`rounded-lg border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${dayTradeToneBadgeClass(tone)}`}>
            {d.state ?? '—'}
          </span>
        )
        const secParts = [d.message, t.intraday_error ? `Tape: ${t.intraday_error}` : '', d.risk_warning].filter(Boolean) as string[]
        out.push({
          key: `dt-${t.id}`,
          categoryKind: 'day',
          ticker: t.ticker,
          strategy,
          contracts,
          expiry: t.expiry?.trim() || '—',
          entryRef: `$${t.entry_price.toFixed(2)}`,
          guidancePrimary: (
            <div className="flex flex-wrap items-center gap-2">
              {badge}
              {d.action ? <span className="text-xs font-semibold text-violet-300">{d.action}</span> : null}
            </div>
          ),
          guidanceSecondary: secParts.length ? secParts.join(' · ') : null,
          actions: (
            <button
              type="button"
              onClick={() => void handleExitActiveTrade(t.id)}
              disabled={activeExitingId === t.id}
              title="Exit day trade"
              className="inline-flex items-center gap-1 rounded-lg border border-gray-600 px-2 py-1 text-[11px] font-semibold text-gray-400 hover:text-rose-300 hover:border-rose-600 disabled:opacity-50"
            >
              {activeExitingId === t.id ? <Loader2 size={12} className="animate-spin shrink-0" /> : <XCircle size={12} className="shrink-0" />}
              Exit
            </button>
          ),
        })
        continue
      }

      const pos = row.pos
      if (pos.status !== 'open') continue

      const contractCount = normalizedContractCount(pos)
      const analyzeData = resolvePortfolioAnalyzeData(tickerCache[pos.ticker], pos.expiry)
      const mtmDollar = analyzeData
        ? markToMarketPositionDollars(pos.legs, analyzeData, pos.expiry, contractCount)
        : null
      const suggestionEval = openPositionEvalDollar(pos, analyzeData)
      const suggestion = getExitSuggestion(pos, suggestionEval)

      const categoryKind = row.category === 'swing' ? 'swing' : 'regular'
      const busy = refreshingPositionIds.has(pos.id)

      out.push({
        key: `pf-${pos.id}`,
        categoryKind,
        ticker: pos.ticker,
        strategy: pos.strategy,
        contracts: String(contractCount),
        expiry: pos.expiry,
        entryRef: `$${pos.entryPrice.toFixed(2)}`,
        guidancePrimary:
          mtmDollar != null ? (
            <span className={`font-mono font-semibold tabular-nums ${mtmDollar >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {fmtDollar(mtmDollar, true)}
            </span>
          ) : (
            <span className="text-gray-500 tabular-nums">—</span>
          ),
        guidanceSecondary:
          suggestion.level !== 'HOLD' ? `${suggestion.title}: ${suggestion.reason}` : null,
        actions: (
          <div className="flex flex-wrap justify-end gap-1">
            <button
              type="button"
              onClick={() =>
                setFocusedPortfolioDetailId(id => (id === pos.id ? null : pos.id))
              }
              title="Expand full portfolio card"
              className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold transition-colors ${focusedPortfolioDetailId === pos.id ? 'border-violet-500 text-violet-300 bg-violet-950/40' : 'border-gray-600 text-gray-400 hover:border-violet-600 hover:text-violet-300'}`}
            >
              Card
            </button>
            <button
              type="button"
              onClick={() => void handleUpdatePositionCard(pos)}
              disabled={busy}
              title="Refresh quotes"
              className="inline-flex items-center gap-1 rounded-lg border border-cyan-800/70 px-2 py-1 text-[11px] font-semibold text-cyan-400 hover:bg-cyan-950/35 disabled:opacity-50"
            >
              <RefreshCw size={12} className={busy ? 'animate-spin shrink-0' : 'shrink-0'} />
            </button>
            <button
              type="button"
              onClick={() => setClosing(pos)}
              title="Close position"
              className="inline-flex items-center gap-1 rounded-lg border border-emerald-800/70 px-2 py-1 text-[11px] font-semibold text-emerald-400 hover:bg-emerald-950/30"
            >
              <CheckCircle size={12} />
            </button>
            <button
              type="button"
              onClick={() => removeFromPortfolio(pos.id)}
              title="Remove"
              className="inline-flex items-center justify-center rounded-lg border border-gray-700 px-2 py-1 text-gray-500 hover:border-red-800 hover:text-red-400"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ),
      })
    }
    return out
  }, [
    mergedOpenFiltered,
    mode,
    tickerCache,
    handleExitActiveTrade,
    activeExitingId,
    removeFromPortfolio,
    handleUpdatePositionCard,
    refreshingPositionIds,
    focusedPortfolioDetailId,
  ])

  useEffect(() => {
    if (open.length === 0) return
    const staleOrMissing = open.some(
      p => !isPortfolioExpiryAnalysisFresh(tickerCache[p.ticker], p.expiry),
    )
    if (!staleOrMissing) return
    const id = window.setInterval(() => setPortfolioHydratePulse(h => h + 1), 61_000)
    return () => clearInterval(id)
  }, [open, tickerCache])

  useEffect(() => {
    if (open.length === 0) return
    const seen = new Set<string>()
    for (const pos of open) {
      const key = `${pos.ticker}|${normalizeExpiryIso(pos.expiry)}`
      if (seen.has(key)) continue
      seen.add(key)
      if (isPortfolioExpiryAnalysisFresh(tickerCache[pos.ticker], pos.expiry)) continue
      void ensureAnalysisForPortfolioExpiry(pos.ticker, pos.expiry, {
        spreadWidth: Number.isFinite(pos.spread_width) ? Math.round(pos.spread_width) : undefined,
      })
    }
  }, [open, tickerCache, ensureAnalysisForPortfolioExpiry, portfolioHydratePulse])

  const getExportRows = () => shown.map(pos => {
      const contractCount = normalizedContractCount(pos)
      const analyzeData = resolvePortfolioAnalyzeData(tickerCache[pos.ticker], pos.expiry)
      const currentPrice = analyzeData?.signals?.current_price ?? null
      const scenarioPnl = pos.status === 'open' && currentPrice != null
        ? estimateAtExpiryPnl(pos.legs, currentPrice) * SHARES_PER_OPTION_CONTRACT * contractCount
        : null
      const mtmDollarExport =
        pos.status === 'open' && analyzeData
          ? markToMarketPositionDollars(pos.legs, analyzeData, pos.expiry, contractCount)
          : null
      const realizedPnl = pos.status === 'closed' && pos.pnlPct != null
        ? (pos.pnlPct / 100) * pos.max_profit * SHARES_PER_OPTION_CONTRACT * contractCount
        : null
      const suggestion =
        pos.status === 'open' ? getExitSuggestion(pos, openPositionEvalDollar(pos, analyzeData)) : null
      const warnings = [
        pos.status === 'open' && currentPrice == null ? 'No current price cache. Refresh before export.' : '',
        pos.status === 'open' && currentPrice != null ? 'Scenario $ uses cached spot + intrinsic vs entry mids; not live option marks.' : '',
        pos.status === 'open' && analyzeData && mtmDollarExport == null
          ? 'MTM $ blank: cached chain expiry must match position expiry, or quotes missing on a leg.'
          : '',
        suggestion && suggestion.level !== 'HOLD' ? `${suggestion.title}: ${suggestion.reason}` : '',
        pos.notes ? `Notes: ${pos.notes}` : '',
      ].filter(Boolean).join(' | ')
      const legColumns = Array.from({ length: 4 }, (_, index) => {
        const leg = pos.legs[index]
        const legNumber = index + 1
        const signedValue = leg
          ? (leg.action === 'BUY' ? -1 : 1) * leg.mid_price * SHARES_PER_OPTION_CONTRACT * contractCount
          : ''
        return {
          [`Leg ${legNumber} Action`]: leg ? `${leg.action} ${leg.option_type}` : '',
          [`Leg ${legNumber} Strike`]: leg?.strike ?? '',
          [`Leg ${legNumber} Value`]: signedValue === '' ? '' : Math.round(signedValue * 100) / 100,
        }
      }).reduce<Record<string, string | number>>((acc, cols) => ({ ...acc, ...cols }), {})

      return {
        Ticker: pos.ticker,
        'Number of Contracts': contractCount,
        'Purchased Date': pos.addedAt ? new Date(pos.addedAt).toLocaleDateString('en-US') : '',
        Expiry: pos.expiry,
        'Scenario $ (@ cached spot)': scenarioPnl != null ? Math.round(scenarioPnl * 100) / 100 : '',
        'MTM $ (mid vs entry)':
          mtmDollarExport != null ? Math.round(mtmDollarExport * 100) / 100 : '',
        'Realized $ (closed)': realizedPnl != null ? Math.round(realizedPnl * 100) / 100 : '',
        'Warnings / Errors': warnings,
        'Max Profit': pos.max_profit * SHARES_PER_OPTION_CONTRACT * contractCount,
        'Max Loss': pos.max_loss * SHARES_PER_OPTION_CONTRACT * contractCount,
        'Kelly Fraction': pos.kelly_fraction != null ? pos.kelly_fraction : '',
        'Half-Kelly Fraction': pos.half_kelly_fraction != null ? pos.half_kelly_fraction : '',
        'Edge Ratio': pos.edge_ratio != null ? pos.edge_ratio : '',
        'Capital At Risk': pos.capital_at_risk ?? '',
        'Account Size At Entry': pos.account_size_at_entry ?? '',
        ...legColumns,
        'Leg Details': pos.legs.map(leg => `${leg.action} ${leg.option_type} ${leg.strike} @ ${leg.mid_price}`).join('; '),
        'Strategy Type': pos.strategy,
        Status: pos.status,
        Bias: pos.bias,
        'Current Stock Price': currentPrice ?? '',
      }
    })

  const handleExportXlsx = () => {
    if (shown.length === 0) return
    const rows = getExportRows()
    const date = new Date().toISOString().slice(0, 10)
    const worksheet = XLSX.utils.json_to_sheet(rows)
    worksheet['!cols'] = [
      { wch: 12 }, { wch: 20 }, { wch: 16 }, { wch: 14 },
      { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 46 }, { wch: 14 },
      { wch: 14 },
      { wch: 14 }, { wch: 12 }, { wch: 14 },
      { wch: 14 }, { wch: 12 }, { wch: 14 },
      { wch: 14 }, { wch: 12 }, { wch: 14 },
      { wch: 14 }, { wch: 12 }, { wch: 14 },
      { wch: 44 }, { wch: 22 }, { wch: 12 }, { wch: 18 }, { wch: 18 },
    ]
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, `Portfolio ${effectiveFilter}`)
    XLSX.writeFile(workbook, `optionadvisor-portfolio-${effectiveFilter}-${date}.xlsx`, {
      bookType: 'xlsx',
      compression: true,
    })
    setExportOpen(false)
  }

  const handleExportPdf = async () => {
    if (shown.length === 0) return
    const rows = getExportRows()
    const date = new Date().toISOString().slice(0, 10)
    const [{ jsPDF }, autoTableModule] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ])
    const autoTable = autoTableModule.default
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' })
    const headers = [
      'Ticker', 'Contracts', 'Purchased Date', 'Expiry', 'Scenario $ (@ cached spot)',
      'MTM $ (mid vs entry)', 'Realized $ (closed)', 'Warnings / Errors', 'Max Profit', 'Leg Details', 'Strategy Type',
    ]
    const body = rows.map(row => [
      row.Ticker,
      row['Number of Contracts'],
      row['Purchased Date'],
      row.Expiry,
      row['Scenario $ (@ cached spot)'],
      row['MTM $ (mid vs entry)'],
      row['Realized $ (closed)'],
      row['Warnings / Errors'],
      row['Max Profit'],
      row['Leg Details'],
      row['Strategy Type'],
    ])

    doc.setFontSize(14)
    doc.text('OptionAdvisor Portfolio', 36, 32)
    doc.setFontSize(9)
    doc.text(`View: ${effectiveFilter} | Exported: ${date} | Positions: ${rows.length}`, 36, 48)

    autoTable(doc, {
      head: [headers],
      body,
      startY: 62,
      styles: { fontSize: 7, cellPadding: 3, overflow: 'linebreak', valign: 'top' },
      headStyles: { fillColor: [31, 41, 55], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { cellWidth: 44 },
        1: { cellWidth: 48 },
        2: { cellWidth: 64 },
        3: { cellWidth: 58 },
        4: { cellWidth: 52 },
        5: { cellWidth: 52 },
        6: { cellWidth: 52 },
        7: { cellWidth: 140 },
        8: { cellWidth: 52 },
        9: { cellWidth: 140 },
        10: { cellWidth: 72 },
      },
      margin: { left: 36, right: 36 },
    })

    doc.save(`optionadvisor-portfolio-${effectiveFilter}-${date}.pdf`)
    setExportOpen(false)
  }

  return (
    <>
      {closing && (
        <CloseModal
          pos={closing}
          onClose={() => setClosing(null)}
          onConfirm={payload => {
            closePosition(closing.id, payload)
            setClosing(null)
          }}
        />
      )}
      {addingNew && (
        <ManualEntryModal
          onClose={() => setAddingNew(false)}
          onAdd={pos => { addManualPosition(pos); setAddingNew(false) }}
        />
      )}
      {exportOpen && embedded && positionsHubExport != null && hubExportPortalPos != null
        ? createPortal(
            <div
              ref={hubExportMenuRef}
              role="menu"
              className="fixed z-[200] w-44 overflow-hidden rounded-xl border border-gray-700 bg-gray-900 shadow-xl"
              style={{ top: hubExportPortalPos.top, left: hubExportPortalPos.left }}
            >
              <button
                type="button"
                role="menuitem"
                onClick={handleExportXlsx}
                className="w-full px-3 py-2 text-left text-sm font-semibold text-gray-300 hover:bg-gray-800 hover:text-emerald-300"
              >
                Export XLSX
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={handleExportPdf}
                className="w-full px-3 py-2 text-left text-sm font-semibold text-gray-300 hover:bg-gray-800 hover:text-amber-300"
              >
                Export PDF
              </button>
            </div>,
            document.body,
          )
        : null}

      <div className="max-w-6xl mx-auto space-y-5">

        {/* Header — standalone `/portfolio` only (Positions Center supplies page & tab titles) */}
        {!embedded && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h1 className="tcc-hero-title text-2xl font-bold tracking-tight text-heading flex items-center gap-2">
                <Briefcase className="text-violet-400" size={22} /> Portfolio
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">
                {open.length} open · {totalOpenContracts} contracts{urgentCount > 0 ? ` · ` : ''}
                {urgentCount > 0 && (
                  <span className="text-red-400 font-semibold">{urgentCount} need immediate attention</span>
                )}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 self-end sm:self-auto">
              <div className="relative">
                <button
                  type="button"
                  onClick={toggleExportMenu}
                  disabled={shown.length === 0}
                  aria-label="Export portfolio"
                  aria-expanded={exportOpen}
                  aria-haspopup="menu"
                  className="inline-flex h-10 w-10 items-center justify-center bg-gray-800 hover:bg-gray-700 border border-gray-700
                           text-gray-300 hover:text-emerald-300 hover:border-emerald-700 rounded-xl
                           transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                  title="Export"
                >
                  <Download size={18} />
                </button>
                {exportOpen && (
                  <div
                    role="menu"
                    className="absolute left-full top-1/2 z-20 ml-2 w-44 -translate-y-1/2 overflow-hidden rounded-xl border border-gray-700 bg-gray-900 shadow-xl
                             max-[420px]:left-auto max-[420px]:right-0 max-[420px]:top-full max-[420px]:ml-0 max-[420px]:mt-2 max-[420px]:translate-y-0"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={handleExportXlsx}
                      className="w-full px-3 py-2 text-left text-sm font-semibold text-gray-300 hover:bg-gray-800 hover:text-emerald-300"
                    >
                      Export XLSX
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={handleExportPdf}
                      className="w-full px-3 py-2 text-left text-sm font-semibold text-gray-300 hover:bg-gray-800 hover:text-amber-300"
                    >
                      Export PDF
                    </button>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={handleRefreshPortfolio}
                disabled={openTickers.length === 0 || portfolioRefreshActive}
                aria-label="Refresh latest prices for open positions"
                className="inline-flex h-10 w-10 items-center justify-center bg-gray-800 hover:bg-gray-700 border border-gray-700
                         text-gray-300 hover:text-cyan-300 hover:border-cyan-700 rounded-xl
                         transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                title="Refresh"
              >
                <RefreshCw size={18} className={portfolioRefreshActive ? 'animate-spin' : ''} />
              </button>
              <button
                type="button"
                onClick={() => setAddingNew(true)}
                aria-label="Add trade manually"
                className="inline-flex h-10 w-10 items-center justify-center bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-violet-600 text-gray-300 hover:text-violet-300 rounded-xl transition-colors shrink-0"
                title="Add trade"
              >
                <Plus size={20} strokeWidth={2.5} />
              </button>
              <button
                type="button"
                onClick={() => navigateToTickerAdvisorFresh()}
                title="New Analysis"
                className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                <TrendingUp size={14} /> New Analysis
              </button>
            </div>
          </div>
        )}

        {/* Urgent alert banner (standalone Portfolio only — Positions Center uses top KPIs / feeds) */}
        {urgentCount > 0 && mode !== 'positions-closed' && !embedded && (
          <div className="bg-red-900/30 border border-red-700 rounded-2xl px-4 py-3 flex items-center gap-3">
            <AlertTriangle size={16} className="text-red-400 shrink-0" />
            <div>
              <div className="text-sm font-bold text-red-300">{urgentCount} position{urgentCount > 1 ? 's' : ''} require immediate action</div>
              <div className="text-xs text-red-400/80">Check the EXIT NOW signals below — gamma risk or stop-loss triggered.</div>
            </div>
          </div>
        )}

        {canAccessPage('active-trades') && mode !== 'positions-closed' && mode !== 'positions-open-merged' && (
          <div className="space-y-2">
            <ActiveTradesPanel variant="embedded" />
          </div>
        )}

        {/* Summary stats (standalone only — KPI strip lives on Positions Center) */}
        {portfolio.length > 0 && !embedded && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Open Positions',  value: String(open.length),        color: 'text-violet-400' },
              { label: 'Open Contracts',  value: String(totalOpenContracts), color: 'text-blue-400'   },
              { label: 'Win Rate',        value: winRate != null ? `${winRate}%` : '—',
                color: winRate != null && winRate >= 50 ? 'text-emerald-400' : 'text-red-400' },
              { label: 'Realised P&L',   value: closedWithPnl.length ? fmtDollar(totalRealisedPnl, true) : '—',
                color: totalRealisedPnl >= 0 ? 'text-emerald-400' : 'text-red-400' },
            ].map(s => (
              <div key={s.label} className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3">
                <div className="text-xs text-gray-500 mb-0.5">{s.label}</div>
                <div className={`text-xl font-bold font-mono ${s.color}`}>{s.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Filter tabs (standalone Portfolio only — Positions Center uses its own tabs) */}
        {portfolio.length > 0 && !embedded && (
          <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1 w-fit">
            {(['open', 'closed', 'all'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-4 py-1.5 rounded-lg text-sm font-semibold capitalize transition-colors ${filter === f ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}>
                {f} {f === 'open' ? `(${open.length})` : f === 'closed' ? `(${closed.length})` : `(${portfolio.length})`}
              </button>
            ))}
          </div>
        )}

        {/* Empty state */}
        {portfolio.length === 0 && (mode !== 'positions-open-merged' || (activeDayTrades.length === 0 && !activeDayTradesLoading)) && (
          <div className="text-center py-20 space-y-3">
            <div className="text-5xl">💼</div>
            <div className="text-lg font-semibold text-gray-300">No positions yet</div>
            <div className="text-gray-500 text-sm max-w-sm mx-auto">
              {mode === 'positions-open-merged' && canAccessPage('active-trades') ? (
                <>Add portfolio trades here, or open day trades from the Day Trade Engine — they appear in this same feed when active.</>
              ) : (
                <>Add trades manually or run an analysis and add a recommendation directly to the portfolio.</>
              )}
            </div>
            <div className="flex items-center justify-center gap-3 mt-4">
              {!embedded ? (
                <button
                  type="button"
                  onClick={() => setAddingNew(true)}
                  aria-label="Add trade manually"
                  title="Add trade manually"
                  className="inline-flex h-11 w-11 items-center justify-center bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 rounded-xl transition-colors"
                >
                  <Plus size={22} strokeWidth={2.5} />
                </button>
              ) : null}
              <button onClick={() => navigateToTickerAdvisorFresh()}
                className="px-5 py-2.5 bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold rounded-xl transition-colors">
                Analyze a Ticker
              </button>
            </div>
          </div>
        )}

        {/* Positions */}
        <div className="space-y-3">
          {mode === 'positions-open-merged' && mergedOpenFiltered ? (
            <>
              <OpenPositionsFeedTable
                rows={openFeedTableRows}
                emptyMessage={
                  mergedOpenRows && mergedOpenFiltered.length === 0 && mergedOpenRows.length > 0
                    ? 'No rows match the current filters. Set Trade Style, Type, or Risk to All.'
                    : 'No open portfolio positions or active day trades in this feed yet.'
                }
              />
              {focusedPortfolioDetailId
                ? (() => {
                    const pos = open.find(p => p.id === focusedPortfolioDetailId)
                    if (!pos) return null
                    const cat = inferPortfolioHubCategory(pos)
                    return (
                      <div className="rounded-2xl border border-gray-800 bg-gray-950/20 p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-gray-500">Portfolio detail</span>
                          <button
                            type="button"
                            className="text-xs text-gray-400 hover:text-white"
                            onClick={() => setFocusedPortfolioDetailId(null)}
                          >
                            Dismiss
                          </button>
                        </div>
                        <PositionCard
                          pos={pos}
                          hubCategory={cat}
                          onClose={() => setClosing(pos)}
                          onRemove={() => removeFromPortfolio(pos.id)}
                          onUpdateQuotes={pos.status === 'open' ? () => handleUpdatePositionCard(pos) : undefined}
                          isUpdatingQuotes={refreshingPositionIds.has(pos.id)}
                          onSaveEditedPosition={(id, payload) => updatePortfolioPosition(id, payload)}
                        />
                      </div>
                    )
                  })()
                : null}
            </>
          ) : (
              shown.map(pos => (
                <PositionCard
                  key={pos.id}
                  pos={pos}
                  onClose={() => setClosing(pos)}
                  onRemove={() => removeFromPortfolio(pos.id)}
                  onUpdateQuotes={pos.status === 'open' ? () => handleUpdatePositionCard(pos) : undefined}
                  isUpdatingQuotes={refreshingPositionIds.has(pos.id)}
                  onSaveEditedPosition={(id, payload) => updatePortfolioPosition(id, payload)}
                />
              ))
          )}
        </div>

        {shown.length === 0 && portfolio.length > 0 && mode !== 'positions-open-merged' && (
          <div className="text-center py-10 text-gray-500 text-sm">
            No {effectiveFilter} positions.
            {effectiveFilter === 'open' && closed.length > 0 && (
              <span className="block mt-1 text-xs">
                You have {closed.length} closed position{closed.length === 1 ? '' : 's'}
                {embedded ? ' — use the Closed tab above.' : ' in the Closed tab.'}
              </span>
            )}
            {effectiveFilter === 'closed' && open.length > 0 && (
              <span className="block mt-1 text-xs">
                You have {open.length} open position{open.length === 1 ? '' : 's'}
                {embedded ? ' — use the Open tab above.' : ' in the Open tab.'}
              </span>
            )}
          </div>
        )}

        {/* Disclaimer */}
        {mode !== 'positions-closed' && (
          <div className="text-center text-xs text-gray-600 py-2 border-t border-gray-800/50">
            <DollarSign size={11} className="inline mr-1" />
            Open positions show <span className="text-gray-300">Current P&amp;L</span> in the metrics row (green/red tile): option mids vs entry mids, scaled by{' '}
            <span className="font-mono text-gray-300">{SHARES_PER_OPTION_CONTRACT}</span> shares per contract × your contract count. Not your broker&apos;s mark — see Help for formulas.
          </div>
        )}
      </div>
    </>
  )
}

export default function PortfolioPage() {
  return (
    <div className="portfolio-page min-h-screen p-4 md:p-6">
      <PortfolioPageContent mode="standalone" />
    </div>
  )
}

/** Full legacy portfolio UI embedded in Positions Center (Open / Closed tabs). */
export function PortfolioPositionsSection({
  variant,
  mergeActiveTrades,
  hubFilters,
  positionsHubExport,
}: {
  variant: 'open' | 'closed'
  mergeActiveTrades?: boolean
  hubFilters?: PositionsHubFilters
  positionsHubExport?: PositionsHubExportHandles
}) {
  const mode: PortfolioContentMode =
    variant === 'open' && mergeActiveTrades ? 'positions-open-merged' : variant === 'open' ? 'positions-open' : 'positions-closed'
  return <PortfolioPageContent mode={mode} hubFilters={hubFilters} positionsHubExport={positionsHubExport} />
}
