import { useState, useMemo } from 'react'
import {
  Briefcase, TrendingUp, TrendingDown, CheckCircle, Clock, Trash2, X,
  DollarSign, Layers, Plus, AlertTriangle, ChevronDown, ChevronUp, FileEdit, RefreshCw, Download,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import type { PortfolioPosition, OptionLeg } from '../types'
import { useApp } from '../contexts/AppContext'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmtDollar(n: number, showPlus = false): string {
  const abs = Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (n < 0)    return `-$${abs}`
  if (showPlus) return `+$${abs}`
  return `$${abs}`
}

function estimateAtExpiryPnl(legs: OptionLeg[], currentPrice: number): number {
  let total = 0
  for (const leg of legs) {
    const intrinsic =
      leg.option_type === 'CALL'
        ? Math.max(0, currentPrice - leg.strike)
        : Math.max(0, leg.strike - currentPrice)
    const premium = leg.mid_price
    total += leg.action === 'BUY' ? intrinsic - premium : premium - intrinsic
  }
  return total
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

function getExitSuggestion(pos: PortfolioPosition, currentPrice: number | null): Suggestion {
  const dte       = Math.ceil((new Date(pos.expiry + 'T00:00:00').getTime() - Date.now()) / 86400000)
  const isDebit   = pos.net_credit < 0
  const contracts = pos.contracts ?? 1
  const atExpiryPS = currentPrice != null ? estimateAtExpiryPnl(pos.legs, currentPrice) : null
  const atExpiry   = atExpiryPS != null ? atExpiryPS * 100 * contracts : null

  const refProfit = pos.max_profit * 100 * contracts
  const refLoss   = pos.max_loss   * 100 * contracts
  const profitPct = atExpiry != null && refProfit > 0 ? (atExpiry / refProfit) * 100 : null
  const lossPct   = atExpiry != null && refLoss   > 0 ? (-atExpiry / refLoss) * 100  : null

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
    reason: `At-expiry estimate shows ${profitPct.toFixed(0)}% of ${isDebit ? '10× target' : 'max profit'} captured.`,
    action: 'Lock in gains. Very little additional edge from holding further.',
  }
  if (profitPct != null && profitPct >= 50) return {
    level: 'CONSIDER_CLOSE', title: `50% Profit Target Hit`,
    reason: `${profitPct.toFixed(0)}% of max profit at current price. Standard target for credit trades.`,
    action: 'Close to lock in gains and free up buying power. Remaining edge is minimal vs remaining risk.',
  }
  if (lossPct != null && lossPct >= 200) return {
    level: 'EXIT_NOW', title: `🚨 2× Loss — Stop Out`,
    reason: `Position is at ${lossPct.toFixed(0)}% of max loss. Standard stop-loss trigger for spreads is 2× credit received.`,
    action: 'Exit now. Cutting the loss frees capital to recover elsewhere.',
  }
  if (lossPct != null && lossPct >= 100) return {
    level: 'EXIT_NOW', title: `🚨 Max Loss Reached`,
    reason: `At current price, holding to expiry results in maximum loss.`,
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
      ? `${dte} DTE · At-expiry estimate ${profitPct >= 0 ? '+' : ''}${profitPct.toFixed(0)}% of ${isDebit ? '10× target' : 'max profit'}.`
      : `${dte} DTE remaining. Analyze the ticker to get a live at-expiry estimate.`,
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
// Manual-entry modal
// ─────────────────────────────────────────────────────────────────────────────

function ManualEntryModal({ onClose, onAdd }: {
  onClose: () => void
  onAdd: (pos: Omit<PortfolioPosition, 'id' | 'addedAt' | 'status'>) => void
}) {
  const strategies = Object.keys(STRATEGY_DEFS)
  const [ticker,          setTicker]         = useState('')
  const [companyName,     setCompanyName]    = useState('')
  const [strategy,        setStrategy]       = useState(strategies[0])
  const [expiry,          setExpiry]         = useState('')
  const [contracts,       setContracts]      = useState(1)
  const [entryStockPrice, setEntryStock]     = useState('')
  const [notes,           setNotes]          = useState('')
  const [legStrikes,      setLegStrikes]     = useState<string[]>(['', '', '', ''])
  const [legPremiums,     setLegPremiums]    = useState<string[]>(['', '', '', ''])

  const def = STRATEGY_DEFS[strategy]

  // Reset leg fields when strategy changes
  const handleStrategyChange = (s: string) => {
    setStrategy(s)
    setLegStrikes(['', '', '', ''])
    setLegPremiums(['', '', '', ''])
  }

  const strikesNum  = legStrikes.map(s => parseFloat(s) || 0)
  const premiumsNum = legPremiums.map(p => parseFloat(p) || 0)
  const metrics     = computeMetrics(strategy, strikesNum, premiumsNum, parseFloat(entryStockPrice) || 0)

  const legsComplete = def.legs.every((_, i) => strikesNum[i] > 0 && premiumsNum[i] > 0)
  const canSubmit = ticker.trim() && expiry && legsComplete && (parseFloat(entryStockPrice) || 0) > 0

  const handleAdd = () => {
    if (!canSubmit) return
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

    onAdd({
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
      prob_of_profit: 0,
      expected_value: 0,
      scores_total: 0,
      contracts,
      breakeven_lower: metrics.beLower,
      breakeven_upper: metrics.beUpper,
      entryPrice,
      source: 'manual',
      notes: notes.trim() || undefined,
    })
  }

  const inputCls = 'w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500 placeholder-gray-600'
  const labelCls = 'block text-xs font-semibold text-gray-400 mb-1'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-lg my-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div>
            <div className="text-base font-bold text-white flex items-center gap-2">
              <FileEdit size={16} className="text-violet-400" /> Add Trade Manually
            </div>
            <div className="text-xs text-gray-500 mt-0.5">Enter any trade — recommendations, manual entries, or accidental trades to track for exit</div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 shrink-0"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Row 1: Ticker + Company */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Ticker *</label>
              <input className={inputCls} placeholder="AAPL" value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())} />
            </div>
            <div>
              <label className={labelCls}>Company (optional)</label>
              <input className={inputCls} placeholder="Apple Inc." value={companyName} onChange={e => setCompanyName(e.target.value)} />
            </div>
          </div>

          {/* Row 2: Strategy */}
          <div>
            <label className={labelCls}>Strategy *</label>
            <select className={inputCls} value={strategy} onChange={e => handleStrategyChange(e.target.value)}>
              {strategies.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* Row 3: Expiry + Contracts + Entry stock */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Expiry Date *</label>
              <input type="date" className={inputCls} value={expiry} onChange={e => setExpiry(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Contracts *</label>
              <input type="number" min={1} className={inputCls} value={contracts} onChange={e => setContracts(Math.max(1, parseInt(e.target.value) || 1))} />
            </div>
            <div>
              <label className={labelCls}>Stock Price @ Entry *</label>
              <input type="number" step="0.01" className={inputCls} placeholder="185.50" value={entryStockPrice} onChange={e => setEntryStock(e.target.value)} />
            </div>
          </div>

          {/* Legs */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Option Legs</div>
            {def.legs.map((tmpl, i) => (
              <div key={i} className="bg-gray-800/50 rounded-xl p-3 space-y-2">
                <div className={`text-xs font-bold ${tmpl.action === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>
                  {tmpl.action} {tmpl.option_type} — {tmpl.label}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Strike Price *</label>
                    <input type="number" step="0.5" className={inputCls} placeholder="195.00"
                      value={legStrikes[i]} onChange={e => { const a = [...legStrikes]; a[i] = e.target.value; setLegStrikes(a) }} />
                  </div>
                  <div>
                    <label className={labelCls}>Premium Paid/Received *</label>
                    <input type="number" step="0.01" className={inputCls} placeholder="3.45"
                      value={legPremiums[i]} onChange={e => { const a = [...legPremiums]; a[i] = e.target.value; setLegPremiums(a) }} />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Computed metrics preview */}
          {legsComplete && (
            <div className="bg-gray-800/60 rounded-xl p-3 text-xs font-mono space-y-1">
              <div className="text-gray-400 font-sans font-semibold text-[10px] uppercase tracking-wide mb-2">Computed</div>
              <div className="flex gap-4 flex-wrap">
                <span className={metrics.netCredit >= 0 ? 'text-violet-400' : 'text-amber-400'}>
                  {metrics.netCredit >= 0 ? 'Net Credit' : 'Net Debit'}: {metrics.netCredit >= 0 ? '+' : ''}${Math.abs(metrics.netCredit).toFixed(2)}/share
                </span>
                <span className="text-emerald-400">Max Profit: ${(metrics.maxProfit * 100 * contracts).toLocaleString()}</span>
                <span className="text-red-400">Max Loss: ${(metrics.maxLoss * 100 * contracts).toLocaleString()}</span>
              </div>
              {metrics.beLower > 0 && (
                <div className="text-gray-400">
                  Breakeven: ${metrics.beLower.toFixed(2)}{metrics.beUpper < 990 ? ` – $${metrics.beUpper.toFixed(2)}` : ''}
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          <div>
            <label className={labelCls}>Notes (optional — e.g. "accidental entry", "hedging position")</label>
            <textarea
              className={`${inputCls} resize-none`} rows={2}
              placeholder="e.g. Entered by mistake — need to exit ASAP"
              value={notes} onChange={e => setNotes(e.target.value)}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-5 py-4 border-t border-gray-800">
          <button onClick={onClose} className="flex-1 py-2.5 bg-gray-800 text-gray-300 text-sm rounded-xl hover:bg-gray-700 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleAdd}
            disabled={!canSubmit}
            className="flex-1 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors"
          >
            Add to Portfolio
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Close-position modal
// ─────────────────────────────────────────────────────────────────────────────

function CloseModal({ pos, onClose, onConfirm }: {
  pos: PortfolioPosition
  onClose: () => void
  onConfirm: (pnlPct: number) => void
}) {
  const [pnl, setPnl] = useState('')
  const pnlNum    = parseFloat(pnl)
  const contracts = pos.contracts ?? 1
  const isDebit   = pos.net_credit < 0
  const isValid   = pnl !== '' && !isNaN(pnlNum)
  const dollarPnl = isValid ? (pnlNum / 100) * pos.max_profit * 100 * contracts : 0
  const profitLabel = isDebit ? '10× premium target' : 'max profit'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-base font-bold text-white">Close Position</div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X size={16} /></button>
        </div>
        <div className="bg-gray-800 rounded-xl p-3 text-sm">
          <div className="text-gray-400 text-xs mb-1">{pos.ticker} · {pos.strategy} · {contracts} contract{contracts > 1 ? 's' : ''}</div>
          <div className="text-gray-200 font-mono">
            {isDebit ? '10× target' : 'Max profit'}: {fmtDollar(pos.max_profit * 100 * contracts)} total
          </div>
          <div className="text-gray-500 text-xs">{fmtDollar(pos.max_profit * 100)}/contract{isDebit ? ' (10× premium reference)' : ''}</div>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-400 block mb-1.5">P&L as % of {profitLabel}</label>
          <input type="number" value={pnl} onChange={e => setPnl(e.target.value)}
            placeholder={`e.g. 50 for 50% of ${profitLabel}`}
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-violet-500 placeholder-gray-600"
          />
          {isValid && (
            <div className={`mt-1.5 text-xs font-mono ${dollarPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              ≈ {fmtDollar(dollarPnl, true)} total ({contracts} contract{contracts > 1 ? 's' : ''})
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 bg-gray-800 text-gray-300 text-sm rounded-xl hover:bg-gray-700 transition-colors">Cancel</button>
          <button onClick={() => isValid && onConfirm(pnlNum)} disabled={!isValid}
            className="flex-1 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors">
            Confirm Close
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Position card
// ─────────────────────────────────────────────────────────────────────────────

function PositionCard({ pos, onClose, onRemove }: { pos: PortfolioPosition; onClose: () => void; onRemove: () => void }) {
  const { tickerCache } = useApp()
  const [expanded, setExpanded] = useState(false)
  const contracts  = pos.contracts ?? 1
  const isClosed   = pos.status === 'closed'
  const isDebit    = pos.net_credit < 0
  const isManual   = pos.source === 'manual'

  const cachedEntry        = tickerCache[pos.ticker]
  const currentPrice       = cachedEntry?.data?.signals?.current_price ?? null
  const unrealisedPerShare = currentPrice != null ? estimateAtExpiryPnl(pos.legs, currentPrice) : null
  const unrealisedDollar   = unrealisedPerShare != null ? unrealisedPerShare * 100 * contracts : null

  // P&L as % of max profit (when winning) or % of max loss (when losing)
  const refProfit  = pos.max_profit * 100 * contracts
  const refLoss    = pos.max_loss   * 100 * contracts
  const profitPct  = unrealisedDollar !== null && refProfit > 0
    ? (unrealisedDollar / refProfit) * 100 : null
  const lossPct    = unrealisedDollar !== null && refLoss > 0 && unrealisedDollar < 0
    ? (-unrealisedDollar / refLoss) * 100 : null
  const pctLabel   = profitPct !== null && profitPct >= 0
    ? `${profitPct.toFixed(0)}% of ${isDebit ? '10× target' : 'max profit'}`
    : lossPct !== null
      ? `${lossPct.toFixed(0)}% of max loss`
      : null

  const realisedDollar = pos.pnlPct != null ? (pos.pnlPct / 100) * pos.max_profit * 100 * contracts : null

  const suggestion = !isClosed ? getExitSuggestion(pos, currentPrice) : null
  const sStyle     = suggestion ? SUGGESTION_STYLE[suggestion.level] : null

  const biasColor =
    pos.bias.includes('Bullish') ? 'border-l-emerald-500' :
    pos.bias.includes('Bearish') ? 'border-l-red-500' : 'border-l-amber-500'

  const dte = Math.ceil((new Date(pos.expiry + 'T00:00:00').getTime() - Date.now()) / 86400000)

  const isMistake = !!(pos.notes?.toLowerCase().includes('mistake') || pos.notes?.toLowerCase().includes('accidental') || pos.notes?.toLowerCase().includes('error'))

  return (
    <div className={`bg-gray-900 border border-gray-800 border-l-4 ${biasColor} rounded-2xl overflow-hidden ${isClosed ? 'opacity-60' : ''}`}>
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
              <span className="text-xs bg-violet-900/50 text-violet-300 border border-violet-700 px-2 py-0.5 rounded-full font-semibold">{pos.strategy}</span>
              {isManual && (
                <span className="text-xs bg-gray-800 text-gray-500 border border-gray-700 px-2 py-0.5 rounded-full">manual</span>
              )}
              <span className="flex items-center gap-1 text-xs bg-gray-800 border border-gray-700 text-gray-400 px-2 py-0.5 rounded-full">
                <Layers size={10} /> {contracts} contract{contracts > 1 ? 's' : ''}
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

          <div className="flex items-center gap-1.5">
            {!isClosed && (
              <button onClick={onClose}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-900/20 hover:bg-emerald-900/40 border border-emerald-800 text-emerald-400 text-xs font-semibold rounded-xl transition-colors">
                <CheckCircle size={12} /> Close
              </button>
            )}
            <button onClick={onRemove} className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors">
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {/* Live at-expiry P&L */}
        {!isClosed && unrealisedDollar !== null && (
          <div className="rounded-xl px-3 py-2.5 bg-gray-800/60">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2 min-w-0">
                {unrealisedDollar >= 0
                  ? <TrendingUp size={15} className="text-gray-500 shrink-0 mt-0.5" />
                  : <TrendingDown size={15} className="text-gray-500 shrink-0 mt-0.5" />}
                <div className="min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
                    Current Est. P&amp;L
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    Current stock <span className="font-mono text-gray-300">${currentPrice!.toFixed(2)}</span>
                    <span className="mx-1 text-gray-600">·</span>
                    Entry <span className="font-mono text-gray-300">${pos.entryPrice.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              <div className="text-right shrink-0">
                <div className={`text-base font-bold font-mono ${unrealisedDollar >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {fmtDollar(unrealisedDollar, true)}
                </div>
                {pctLabel && (
                  <div className={`text-[11px] font-semibold ${unrealisedDollar >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {pctLabel}
                  </div>
                )}
              </div>
            </div>

            {/* Breakeven hint */}
            {isDebit && unrealisedDollar < 0 && pos.breakeven_lower && pos.breakeven_lower < 990 && (
              <div className="text-xs text-amber-400/80 mt-2 border-t border-gray-700/50 pt-2">
                {(() => {
                  const isBearishLeg = pos.legs.some(l => l.option_type === 'PUT' && l.action === 'BUY')
                  const direction = isBearishLeg ? 'fall to' : 'rise to'
                  const gap = currentPrice != null ? Math.abs(pos.breakeven_lower - currentPrice) : null
                  return <>⚠ Stock needs to {direction} ${pos.breakeven_lower.toFixed(2)} to break even{gap != null && <span className="text-gray-500 ml-1">(${gap.toFixed(2)} away)</span>}</>
                })()}
              </div>
            )}
          </div>
        )}

        {/* Realised P&L (closed) */}
        {isClosed && realisedDollar !== null && (
          <div className={`rounded-xl px-3 py-2.5 border ${
            realisedDollar >= 0 ? 'bg-emerald-900/20 border-emerald-800' : 'bg-red-900/20 border-red-800'
          }`}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {realisedDollar >= 0 ? <TrendingUp size={15} className="text-emerald-400" /> : <TrendingDown size={15} className="text-red-400" />}
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Realized P&amp;L</div>
                  <div className="text-xs text-gray-500">
                    {pos.pnlPct?.toFixed(0)}% of {isDebit ? '10x target' : 'max profit'}
                  </div>
                </div>
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
        <div className={`grid gap-2 ${!isClosed && unrealisedDollar !== null ? 'grid-cols-2 sm:grid-cols-5' : 'grid-cols-2 sm:grid-cols-4'}`}>
          {[
            isDebit
              ? { label: 'Net Debit',   value: `$${(Math.abs(pos.net_credit) * 100 * contracts).toLocaleString('en-US', { maximumFractionDigits: 0 })}`, sub: `$${(Math.abs(pos.net_credit) * 100).toFixed(0)}/ea`, color: 'text-amber-400' }
              : { label: 'Net Credit',  value: `+$${(pos.net_credit * 100 * contracts).toLocaleString('en-US', { maximumFractionDigits: 0 })}`,           sub: `${contracts}×contract`,                              color: 'text-violet-400' },
            isDebit
              ? { label: 'Max Profit',  value: `$${(pos.max_profit * 100 * contracts).toLocaleString('en-US', { maximumFractionDigits: 0 })}`, sub: '10× target/ea', color: 'text-emerald-400' }
              : { label: 'Max Profit',  value: `$${(pos.max_profit * 100 * contracts).toLocaleString('en-US', { maximumFractionDigits: 0 })}`, sub: `$${(pos.max_profit * 100).toFixed(0)}/ea`, color: 'text-emerald-400' },
            ...(!isClosed && unrealisedDollar !== null
              ? [{
                label: 'Estimated P&L At Expiry',
                value: fmtDollar(unrealisedDollar, true),
                sub: `Stock now $${currentPrice!.toFixed(2)}`,
                color: unrealisedDollar >= 0 ? 'text-emerald-400' : 'text-red-400',
              }]
              : []),
            { label: 'Max Loss',      value: `-$${(pos.max_loss * 100 * contracts).toLocaleString('en-US', { maximumFractionDigits: 0 })}`, sub: `$${(pos.max_loss * 100).toFixed(0)}/ea`, color: 'text-red-400' },
            { label: 'Stock @ Entry', value: `$${pos.entryPrice.toFixed(2)}`, sub: pos.bias, color: 'text-gray-300' },
          ].map(m => (
            <div key={m.label} className="bg-gray-800/60 rounded-xl px-3 py-2">
              <div className="text-xs text-gray-500 mb-0.5">{m.label}</div>
              <div className={`text-sm font-bold font-mono ${m.color}`}>{m.value}</div>
              <div className="text-xs text-gray-600 truncate">{m.sub}</div>
            </div>
          ))}
        </div>

        {/* Expand toggle for details */}
        <button
          onClick={() => setExpanded(e => !e)}
          className="w-full flex items-center justify-center gap-1 text-xs text-gray-600 hover:text-gray-400 transition-colors py-0.5"
        >
          {expanded ? <><ChevronUp size={12} /> Hide details</> : <><ChevronDown size={12} /> Show details</>}
        </button>

        {expanded && (
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
                  <span className={`ml-auto font-semibold ${unrealisedDollar != null && unrealisedDollar >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    Current: ${currentPrice.toFixed(2)}
                  </span>
                )}
              </div>
            )}

            {/* Legs */}
            <div className="bg-gray-800/40 rounded-xl px-3 py-2">
              <div className="text-xs text-gray-500 mb-1.5">Legs</div>
              <div className="flex flex-wrap gap-2">
                {pos.legs.map((leg, i) => (
                  <span key={i} className={`text-xs font-mono px-2 py-0.5 rounded-lg border ${leg.action === 'SELL' ? 'bg-red-900/15 border-red-900/40 text-red-300' : 'bg-emerald-900/15 border-emerald-900/40 text-emerald-300'}`}>
                    {leg.action} ${leg.strike} {leg.option_type[0]} @ ${leg.mid_price.toFixed(2)}
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
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function PortfolioPage() {
  const {
    portfolio, closePosition, removeFromPortfolio, addManualPosition, navigate,
    refreshTicker, refreshingTickers, tickerCache,
  } = useApp()
  const [closing,    setClosing]    = useState<PortfolioPosition | null>(null)
  const [addingNew,  setAddingNew]  = useState(false)
  const [filter,     setFilter]     = useState<'all' | 'open' | 'closed'>('open')
  const [refreshingPortfolio, setRefreshingPortfolio] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)

  const open   = portfolio.filter(p => p.status === 'open')
  const closed = portfolio.filter(p => p.status === 'closed')
  const shown  = filter === 'all' ? portfolio : filter === 'open' ? open : closed
  const openTickers = Array.from(new Set(open.map(p => p.ticker).filter(Boolean)))
  const portfolioRefreshActive = refreshingPortfolio || openTickers.some(ticker => refreshingTickers.has(ticker))

  // Urgent positions (EXIT_NOW / EXPIRED) — shown in alert banner
  const urgentCount = useMemo(() =>
    open.filter(p => {
      const price = tickerCache[p.ticker]?.data?.signals?.current_price ?? null
      const s = getExitSuggestion(p, price)
      return s.level === 'EXIT_NOW' || s.level === 'EXPIRED'
    }).length
  , [open, tickerCache])

  const closedWithPnl    = closed.filter(p => p.pnlPct != null)
  const totalRealisedPnl = closedWithPnl.reduce((s, p) => {
    const c = p.contracts ?? 1
    return s + ((p.pnlPct! / 100) * p.max_profit * 100 * c)
  }, 0)
  const totalOpenContracts = open.reduce((s, p) => s + (p.contracts ?? 1), 0)
  const winRate = closedWithPnl.length
    ? Math.round((closedWithPnl.filter(p => (p.pnlPct ?? 0) > 0).length / closedWithPnl.length) * 100)
    : null

  const handleRefreshPortfolio = async () => {
    if (openTickers.length === 0 || refreshingPortfolio) return
    setRefreshingPortfolio(true)
    try {
      for (const ticker of openTickers) {
        await refreshTicker(ticker)
      }
    } finally {
      setRefreshingPortfolio(false)
    }
  }

  const getExportRows = () => shown.map(pos => {
      const contracts = pos.contracts ?? 1
      const currentPrice = tickerCache[pos.ticker]?.data?.signals?.current_price ?? null
      const expiryPnl = pos.status === 'open' && currentPrice != null
        ? estimateAtExpiryPnl(pos.legs, currentPrice) * 100 * contracts
        : null
      const realizedPnl = pos.status === 'closed' && pos.pnlPct != null
        ? (pos.pnlPct / 100) * pos.max_profit * 100 * contracts
        : null
      const currentPnl = pos.status === 'closed' ? realizedPnl : expiryPnl
      const suggestion = pos.status === 'open' ? getExitSuggestion(pos, currentPrice) : null
      const warnings = [
        pos.status === 'open' && currentPrice == null ? 'No current price cache. Click Refresh Values before export.' : '',
        pos.status === 'open' && currentPrice != null ? 'Current P&L is estimated from current stock price and expiry payoff; not live option mark-to-market.' : '',
        suggestion && suggestion.level !== 'HOLD' ? `${suggestion.title}: ${suggestion.reason}` : '',
        pos.notes ? `Notes: ${pos.notes}` : '',
      ].filter(Boolean).join(' | ')
      const legColumns = Array.from({ length: 4 }, (_, index) => {
        const leg = pos.legs[index]
        const legNumber = index + 1
        const signedValue = leg
          ? (leg.action === 'BUY' ? -1 : 1) * leg.mid_price * 100 * contracts
          : ''
        return {
          [`Leg ${legNumber} Action`]: leg ? `${leg.action} ${leg.option_type}` : '',
          [`Leg ${legNumber} Strike`]: leg?.strike ?? '',
          [`Leg ${legNumber} Value`]: signedValue === '' ? '' : Math.round(signedValue * 100) / 100,
        }
      }).reduce<Record<string, string | number>>((acc, cols) => ({ ...acc, ...cols }), {})

      return {
        Ticker: pos.ticker,
        'Number of Contracts': contracts,
        'Purchased Date': pos.addedAt ? new Date(pos.addedAt).toLocaleDateString('en-US') : '',
        Expiry: pos.expiry,
        'Expiry P&L': expiryPnl != null ? Math.round(expiryPnl * 100) / 100 : '',
        'Current P&L': currentPnl != null ? Math.round(currentPnl * 100) / 100 : '',
        'Warnings / Errors': warnings,
        'Max Profit': pos.max_profit * 100 * contracts,
        'Max Loss': pos.max_loss * 100 * contracts,
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
      { wch: 14 }, { wch: 14 }, { wch: 46 }, { wch: 14 },
      { wch: 14 },
      { wch: 14 }, { wch: 12 }, { wch: 14 },
      { wch: 14 }, { wch: 12 }, { wch: 14 },
      { wch: 14 }, { wch: 12 }, { wch: 14 },
      { wch: 14 }, { wch: 12 }, { wch: 14 },
      { wch: 44 }, { wch: 22 }, { wch: 12 }, { wch: 18 }, { wch: 18 },
    ]
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, `Portfolio ${filter}`)
    XLSX.writeFile(workbook, `optionadvisor-portfolio-${filter}-${date}.xlsx`, {
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
      'Ticker', 'Contracts', 'Purchased Date', 'Expiry', 'Expiry P&L',
      'Current P&L', 'Warnings / Errors', 'Max Profit', 'Leg Details', 'Strategy Type',
    ]
    const body = rows.map(row => [
      row.Ticker,
      row['Number of Contracts'],
      row['Purchased Date'],
      row.Expiry,
      row['Expiry P&L'],
      row['Current P&L'],
      row['Warnings / Errors'],
      row['Max Profit'],
      row['Leg Details'],
      row['Strategy Type'],
    ])

    doc.setFontSize(14)
    doc.text('OptionAdvisor Portfolio', 36, 32)
    doc.setFontSize(9)
    doc.text(`View: ${filter} | Exported: ${date} | Positions: ${rows.length}`, 36, 48)

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
        4: { cellWidth: 58 },
        5: { cellWidth: 58 },
        6: { cellWidth: 150 },
        7: { cellWidth: 58 },
        8: { cellWidth: 150 },
        9: { cellWidth: 78 },
      },
      margin: { left: 36, right: 36 },
    })

    doc.save(`optionadvisor-portfolio-${filter}-${date}.pdf`)
    setExportOpen(false)
  }

  return (
    <div className="portfolio-page min-h-screen p-4 md:p-6">
      {closing && (
        <CloseModal pos={closing} onClose={() => setClosing(null)} onConfirm={pnl => { closePosition(closing.id, pnl); setClosing(null) }} />
      )}
      {addingNew && (
        <ManualEntryModal
          onClose={() => setAddingNew(false)}
          onAdd={pos => { addManualPosition(pos); setAddingNew(false) }}
        />
      )}

      <div className="max-w-6xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Briefcase className="text-violet-400" size={22} /> Portfolio
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {open.length} open · {totalOpenContracts} contracts{urgentCount > 0 ? ` · ` : ''}
              {urgentCount > 0 && <span className="text-red-400 font-semibold">{urgentCount} need immediate attention</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <button
                onClick={() => setExportOpen(open => !open)}
                disabled={shown.length === 0}
                className="flex items-center gap-1.5 px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700
                           text-gray-300 hover:text-emerald-300 hover:border-emerald-700 text-sm font-semibold rounded-xl
                           transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Export the current portfolio view"
              >
                <Download size={14} /> Export <ChevronDown size={13} />
              </button>
              {exportOpen && (
                <div className="absolute right-0 z-20 mt-2 w-44 overflow-hidden rounded-xl border border-gray-700 bg-gray-900 shadow-xl">
                  <button
                    onClick={handleExportXlsx}
                    className="w-full px-3 py-2 text-left text-sm font-semibold text-gray-300 hover:bg-gray-800 hover:text-emerald-300"
                  >
                    Export XLSX
                  </button>
                  <button
                    onClick={handleExportPdf}
                    className="w-full px-3 py-2 text-left text-sm font-semibold text-gray-300 hover:bg-gray-800 hover:text-amber-300"
                  >
                    Export PDF
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={handleRefreshPortfolio}
              disabled={openTickers.length === 0 || portfolioRefreshActive}
              className="flex items-center gap-1.5 px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700
                         text-gray-300 hover:text-cyan-300 hover:border-cyan-700 text-sm font-semibold rounded-xl
                         transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Refresh latest prices for open portfolio positions"
            >
              <RefreshCw size={14} className={portfolioRefreshActive ? 'animate-spin' : ''} />
              Refresh Values
            </button>
            <button
              onClick={() => setAddingNew(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-violet-600 text-gray-300 hover:text-violet-300 text-sm font-semibold rounded-xl transition-colors"
            >
              <Plus size={14} /> Add Trade
            </button>
            <button
              onClick={() => navigate('ticker')}
              className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              <TrendingUp size={14} /> New Analysis
            </button>
          </div>
        </div>

        {/* Urgent alert banner */}
        {urgentCount > 0 && (
          <div className="bg-red-900/30 border border-red-700 rounded-2xl px-4 py-3 flex items-center gap-3">
            <AlertTriangle size={16} className="text-red-400 shrink-0" />
            <div>
              <div className="text-sm font-bold text-red-300">{urgentCount} position{urgentCount > 1 ? 's' : ''} require immediate action</div>
              <div className="text-xs text-red-400/80">Check the EXIT NOW signals below — gamma risk or stop-loss triggered.</div>
            </div>
          </div>
        )}

        {/* Summary stats */}
        {portfolio.length > 0 && (
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

        {/* Filter tabs */}
        {portfolio.length > 0 && (
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
        {portfolio.length === 0 && (
          <div className="text-center py-20 space-y-3">
            <div className="text-5xl">💼</div>
            <div className="text-lg font-semibold text-gray-300">No positions yet</div>
            <div className="text-gray-500 text-sm max-w-sm mx-auto">
              Add trades manually or run an analysis and add a recommendation directly to the portfolio.
            </div>
            <div className="flex items-center justify-center gap-3 mt-4">
              <button onClick={() => setAddingNew(true)}
                className="px-5 py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-sm font-semibold rounded-xl transition-colors flex items-center gap-2">
                <Plus size={14} /> Add Trade Manually
              </button>
              <button onClick={() => navigate('ticker')}
                className="px-5 py-2.5 bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold rounded-xl transition-colors">
                Analyze a Ticker
              </button>
            </div>
          </div>
        )}

        {/* Positions */}
        <div className="space-y-3">
          {shown.map(pos => (
            <PositionCard key={pos.id} pos={pos} onClose={() => setClosing(pos)} onRemove={() => removeFromPortfolio(pos.id)} />
          ))}
        </div>

        {shown.length === 0 && portfolio.length > 0 && (
          <div className="text-center py-10 text-gray-500 text-sm">No {filter} positions.</div>
        )}

        {/* Disclaimer */}
        <div className="text-center text-xs text-gray-600 py-2 border-t border-gray-800/50">
          <DollarSign size={11} className="inline mr-1" />
          Exit signals are at-expiry estimates based on the last cached stock price. Actual P&L depends on time value, IV, and exit timing. Not financial advice.
        </div>
      </div>
    </div>
  )
}
