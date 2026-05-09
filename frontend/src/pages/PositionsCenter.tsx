import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  BrainCircuit,
  ChevronDown,
  ChevronUp,
  Clock,
  DollarSign,
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
  X,
} from 'lucide-react'
import { fetchPositionsCenter } from '../api/commandCenter'
import { useApp } from '../contexts/AppContext'
import type { ApiEnvelope } from '../types/commandCenter'
import type { PortfolioPosition, OptionLeg } from '../types/index'
import {
  getActionButtonClass,
  getBiasBadgeClass,
  getDecisionBadgeClass,
  getMarketContextBadgeClass,
  getProfitLossTextClass,
  getPositionCategoryClass,
} from '../utils/semanticTrading'

const TABS = [
  { id: 'open', label: 'Open Positions' },
  { id: 'closed', label: 'Closed Positions' },
] as const

type MainTabId = (typeof TABS)[number]['id']
type FilterStyle = 'all' | 'day' | 'swing' | 'regular'
type FilterType = 'all' | 'options' | 'stocks' | 'spreads'
type FilterRisk = 'all' | 'low' | 'medium' | 'high'
type SortKey = 'ticker' | 'dte' | 'entryPrice' | 'max_profit' | 'max_loss' | 'pnlPct'

const SHARES_PER_OPTION_CONTRACT = 100

interface LegTemplate { action: 'BUY' | 'SELL'; option_type: 'CALL' | 'PUT'; label: string }
interface StrategyDef { bias: string; legs: LegTemplate[] }

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
  } else {
    const premium = Math.abs(netCredit)
    const s0 = legStrikes[0] || 0
    const s1 = legStrikes[1] || 0
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
  const dte = pos.dte ?? 99
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
  const dte = pos.dte ?? 99
  const strat = (pos.strategy || '').toLowerCase()
  const bias = (pos.bias || '').toLowerCase()
  if (status === 'EXIT SOON') return `Expiry approaching in ${dte} days. Consider rolling or closing before theta decay accelerates.`
  if (status === 'WATCH') return `DTE at ${dte}. Set a price alert and review at ${Math.max(1, dte - 5)} DTE for roll decisions.`
  if (status === 'CONFLICT') return `Position probability is low (${pos.prob_of_profit ?? 50}%). Review thesis and consider reducing size.`
  if (status === 'MANAGE') {
    if (strat.includes('spread')) return `Spread position active. Monitor the short leg and manage pin risk near expiry.`
    return 'Active management required. Set stop-loss and review position sizing.'
  }
  if (status === 'EXIT') return 'Position closed. Review trade journal for lessons learned.'
  if (bias.includes('bull')) return `Bullish position with ${dte} DTE remaining. Trend is your friend — trail stops higher.`
  if (bias.includes('bear')) return `Bearish position with ${dte} DTE remaining. Protect against short squeezes with tight stops.`
  return `Position ${dte} DTE out. Monitor thesis and set exit conditions.`
}

function engineSourceLabel(source: 'day' | 'swing' | 'regular'): string {
  if (source === 'day') return 'Day'
  if (source === 'swing') return 'Swing'
  return 'Regular'
}

function stratelabel(strat: string): string {
  if (!strat) return '—'
  return strat.replace(/_/g, ' ')
}

function computePnlDollar(pos: PortfolioPosition): number | null {
  if (pos.status === 'closed' && pos.pnlPct != null && pos.max_profit > 0) {
    return (pos.pnlPct / 100) * pos.max_profit * 100 * pos.contracts
  }
  return null
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

function sourceStyleBadge(kind: 'day' | 'swing' | 'regular') {
  const cls = getPositionCategoryClass(kind)
  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${cls}`}>
      {engineSourceLabel(kind)}
    </span>
  )
}

function ModalOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={onClose}>
      <div className="my-8 w-full max-w-2xl rounded-xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-slate-900 shadow-xl" onClick={e => e.stopPropagation()}>
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
  contractCount: string
  entryStockPrice: string
  notes: string
  legStrikes: string[]
  legPremiums: string[]
}

function emptyForm(): FormState {
  return {
    ticker: '',
    tradeSource: 'regular',
    strategy: 'Stock',
    expiry: '',
    contractCount: '1',
    entryStockPrice: '',
    notes: '',
    legStrikes: ['', '', '', ''],
    legPremiums: ['', '', '', ''],
  }
}

function PositionFormFields({
  form, onChange, readonlyTicker, isEdit,
}: {
  form: FormState
  onChange: (patch: Partial<FormState>) => void
  readonlyTicker?: boolean
  isEdit?: boolean
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

  const inputCls = 'mt-1 w-full rounded-lg border border-slate-300 dark:border-white/[0.12] bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-violet-500 dark:focus:border-violet-400 placeholder:text-slate-400 dark:placeholder:text-slate-500'
  const labelCls = 'block text-xs font-semibold text-slate-600 dark:text-slate-300'

  return (
    <div className="space-y-4">
      <label className={labelCls}>Ticker *
        <input value={form.ticker} onChange={e => onChange({ ticker: e.target.value.toUpperCase() })}
          className={`${inputCls} ${readonlyTicker ? 'opacity-60' : ''}`} readOnly={readonlyTicker} />
      </label>

      <div>
        <div className="text-xs font-semibold text-secondary mb-1.5">Trade Source</div>
        <div className="flex gap-2">
          {TRADE_SOURCE_OPTIONS.map(s => (
            <button key={s.id} type="button" onClick={() => onChange({ tradeSource: s.id })}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                form.tradeSource === s.id ? 'bg-violet-600 text-white' : 'bg-surface-muted/30 text-muted hover:text-secondary'
              }`}
            >{s.label}</button>
          ))}
        </div>
      </div>

      <div>
        <label className={labelCls}>Strategy *</label>
        <select value={form.strategy} onChange={e => handleStrategyChange(e.target.value)} className={inputCls}>
          {Object.keys(STRATEGY_DEFS).map(s => (
            <option key={s} value={s} className="bg-surface-card">{s}</option>
          ))}
        </select>
      </div>

      {isStock ? (
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
            <label className={labelCls}>Expiry *
              <input type="date" value={form.expiry}
                onChange={e => onChange({ expiry: e.target.value })} className={inputCls} />
            </label>
          </div>

          {def && def.legs.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-secondary uppercase tracking-wide">Option Legs</div>
              {def.legs.map((tmpl, i) => (
                <div key={i} className="rounded-lg border border-slate-200 dark:border-white/[0.07] bg-slate-50 dark:bg-slate-800/50 p-3 space-y-2">
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
            <div className="rounded-lg border border-slate-200 dark:border-white/[0.07] bg-slate-50 dark:bg-slate-800/50 p-3 text-xs font-mono space-y-1">
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

function TradingPositionCard({
  pos,
  expanded,
  pnlData,
  onToggle,
  onClose,
  onManage,
  onRoll,
  onAlert,
}: {
  pos: PortfolioPosition
  expanded: boolean
  pnlData?: { pnl: number; pnl_pct: number } | null
  onToggle: () => void
  onClose: () => void
  onManage: () => void
  onRoll: () => void
  onAlert: () => void
}) {
  const aiStatus = deriveAiStatus(pos)
  const sourceKind = deriveEngineSource(pos)
  const guidance = deriveAiGuidance(pos)
  const isExpiringSoon = (pos.dte ?? 99) <= 7
  const dteForDisplay = pos.dte != null ? String(pos.dte) : '—'

  const displayPnl = pnlData ?? (pos.status === 'closed' ? (() => {
    const d = computePnlDollar(pos)
    return d != null ? { pnl: d, pnl_pct: pos.pnlPct ?? 0 } : null
  })() : null)

  const pnlColor = displayPnl
    ? displayPnl.pnl > 0 ? 'text-emerald-400' : displayPnl.pnl < 0 ? 'text-rose-400' : 'text-gray-400'
    : 'text-muted'

  const isCredit = pos.net_credit >= 0
  const creditTotal = computeCreditTotal(pos)
  const creditPer = creditPerContract(pos)

  const accentBorder =
    aiStatus === 'HOLD' || aiStatus === 'EXIT'
      ? 'border-l-emerald-500'
      : aiStatus === 'WATCH' || aiStatus === 'EXIT SOON'
        ? 'border-l-amber-400'
        : aiStatus === 'CONFLICT'
          ? 'border-l-fuchsia-500'
          : aiStatus === 'MANAGE'
            ? 'border-l-blue-400'
            : 'border-l-slate-300 dark:border-l-slate-700'

  return (
    <article className={`w-full rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-slate-900 shadow-sm hover:shadow-md transition-shadow border-l-[3px] ${accentBorder}`}>

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-2 px-3 pt-2.5 pb-2">

        {/* Left: identity */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-mono text-sm font-bold tracking-tight text-heading">{pos.ticker}</span>
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
            {pos.dte != null && (
              <span className={isExpiringSoon ? 'font-semibold text-amber-400' : ''}>{dteForDisplay} DTE</span>
            )}
            {pos.status === 'open' && creditTotal > 0 && (
              <span className={isCredit ? 'font-medium text-emerald-400' : 'font-medium text-amber-400'}>
                {isCredit ? 'Cr' : 'Dr'} {fmtUsd(creditTotal)}
              </span>
            )}
          </div>
        </div>

        {/* Right: P&L hero */}
        <div className="shrink-0 text-right">
          {displayPnl ? (
            <>
              <div className={`font-mono text-xl font-bold tabular-nums leading-tight ${pnlColor}`}>
                {displayPnl.pnl >= 0 ? '+' : ''}{fmtUsd(displayPnl.pnl)}
              </div>
              <div className={`text-[11px] font-semibold tabular-nums ${pnlColor}`}>
                {displayPnl.pnl_pct >= 0 ? '+' : ''}{displayPnl.pnl_pct.toFixed(2)}%
              </div>
              <div className="mt-1 flex gap-1 justify-end">
                {pos.status === 'open' && displayPnl.pnl > 0 && displayPnl.pnl_pct > 30 && <ProtectProfitsBadge />}
                <PlBadge pnl={displayPnl.pnl} />
                {pos.status === 'closed' && <ExitBadge />}
              </div>
            </>
          ) : pos.status === 'open' ? (
            <>
              <div className="font-mono text-base font-bold text-heading leading-tight">{fmtUsd(pos.entryPrice)}</div>
              <div className="text-[10px] text-muted">entry</div>
            </>
          ) : null}
        </div>
      </div>

      {/* ── Footer: actions ── */}
      <div className="flex items-center gap-1 border-t border-slate-100 dark:border-white/[0.05] px-3 py-1.5">
        {pos.status === 'open' && (
          <>
            <button type="button" onClick={onClose} className={`${getActionButtonClass('alert')} px-2 py-0.5 text-[10px]`}>Close</button>
            <button type="button" onClick={onManage} className={`${getActionButtonClass('trade')} inline-flex items-center gap-0.5 px-2 py-0.5 text-[10px]`}>
              <Edit3 size={10} />Edit
            </button>
            <button type="button" onClick={onRoll} className={`${getActionButtonClass('surface')} px-2 py-0.5 text-[10px]`}>Roll</button>
            <button type="button" onClick={onAlert} className={`${getActionButtonClass('alert')} px-2 py-0.5 text-[10px]`}>Alert</button>
          </>
        )}
        {pos.status === 'closed' && (
          <button type="button" onClick={onManage} className={`${getActionButtonClass('surface')} px-2 py-0.5 text-[10px]`}>Review</button>
        )}
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
        <div className="border-t border-slate-100 dark:border-white/[0.05] bg-slate-50 dark:bg-slate-800/30 px-3 py-3 space-y-3 rounded-b-xl">

          {/* AI guidance */}
          <div className="flex items-start gap-1.5 text-xs text-secondary">
            <BrainCircuit size={13} className="mt-px shrink-0 text-violet-400" />
            <p className="leading-snug">{guidance}</p>
          </div>

          {/* Metrics — borderless grid */}
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-x-4 gap-y-2 text-[11px]">
            {pos.prob_of_profit != null && (
              <div><div className="text-muted">PoP</div>
                <div className={`font-semibold tabular-nums ${pos.prob_of_profit >= 60 ? 'text-emerald-400' : 'text-secondary'}`}>{pos.prob_of_profit.toFixed(0)}%</div></div>
            )}
            {pos.edge_ratio != null && (
              <div><div className="text-muted">Edge</div>
                <div className={`font-semibold tabular-nums ${pos.edge_ratio >= 0.05 ? 'text-emerald-400' : 'text-secondary'}`}>{pos.edge_ratio.toFixed(2)}</div></div>
            )}
            {pos.kelly_fraction != null && (
              <div><div className="text-muted">½ Kelly</div>
                <div className="font-semibold tabular-nums text-sky-400">{((pos.half_kelly_fraction ?? pos.kelly_fraction) * 100).toFixed(1)}%</div></div>
            )}
            {pos.max_profit != null && pos.max_profit > 0 && (
              <div><div className="text-muted">Max $</div>
                <div className="font-semibold tabular-nums text-emerald-400">{fmtUsd(pos.max_profit)}</div></div>
            )}
            {pos.max_loss != null && pos.max_loss > 0 && (
              <div><div className="text-muted">Max loss</div>
                <div className="font-semibold tabular-nums text-rose-400">{fmtUsd(pos.max_loss)}</div></div>
            )}
            {pos.capital_at_risk != null && (
              <div><div className="text-muted">At risk</div>
                <div className="font-semibold tabular-nums text-amber-400">{fmtUsd(pos.capital_at_risk)}</div></div>
            )}
            {pos.net_credit != null && (
              <div><div className="text-muted">Net {pos.net_credit >= 0 ? 'cr' : 'dr'}</div>
                <div className="font-semibold tabular-nums text-secondary">{fmtUsd(pos.net_credit)}</div></div>
            )}
            {pos.breakeven_lower != null && pos.breakeven_lower > 0 && (
              <div><div className="text-muted">B/E</div>
                <div className="font-semibold tabular-nums text-secondary">{fmtUsd(pos.breakeven_lower)}</div></div>
            )}
            <div><div className="text-muted">Entry</div>
              <div className="font-semibold tabular-nums text-secondary">{fmtUsd(pos.entryPrice)}</div></div>
            <div><div className="text-muted">Added</div>
              <div className="font-semibold text-secondary">{pos.addedAt ? new Date(pos.addedAt).toLocaleDateString() : '—'}</div></div>
            {pos.status === 'closed' && pos.exitDate && (
              <div><div className="text-muted">Closed</div>
                <div className="font-semibold text-secondary">{new Date(pos.exitDate).toLocaleDateString()}</div></div>
            )}
            {pos.status === 'closed' && pos.pnlPct != null && (
              <div><div className="text-muted">Realized</div>
                <div className={`font-semibold ${getProfitLossTextClass(pos.pnlPct)}`}>{fmtPct(pos.pnlPct)}</div></div>
            )}
            {displayPnl && pos.status === 'open' && (
              <div><div className="text-muted">Cur. P&L</div>
                <div className={`font-semibold tabular-nums ${pnlColor}`}>{fmtUsd(displayPnl.pnl)}</div></div>
            )}
          </div>

          {/* Legs */}
          {pos.legs && pos.legs.length > 0 && (
            <div className="text-[11px] space-y-0.5">
              <div className="text-muted mb-0.5">Legs</div>
              {pos.legs.map((leg, i) => (
                <div key={i} className="flex items-center gap-2 font-mono text-secondary">
                  <span className={`font-bold ${leg.action === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}`}>{leg.action}</span>
                  <span>{leg.option_type === 'CALL' ? 'C' : 'P'}</span>
                  <span>${leg.strike.toFixed(1)}</span>
                  <span className="text-muted">{leg.expiry}</span>
                  {leg.delta != null && <span className="text-muted">Δ{leg.delta.toFixed(2)}</span>}
                </div>
              ))}
            </div>
          )}

          {pos.notes && <p className="text-[11px] text-secondary italic">{pos.notes}</p>}
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
    <div className="rounded-lg border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900 px-3 py-2 shadow-sm">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className={`text-base font-bold tabular-nums mt-0.5 ${valueClass}`}>{value}</div>
      {sub ? <div className="text-[11px] mt-0.5 tabular-nums">{sub}</div> : null}
    </div>
  )
}

export default function PositionsCenter() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigateRouter = useNavigate()
  const { positionsTab, navigatePositionsTab, navigate, portfolio, accountSize, portfolioRefreshKey, closePosition, updatePortfolioPosition, removeFromPortfolio, addManualPosition } = useApp()
  const [env, setEnv] = useState<ApiEnvelope<Record<string, unknown>> | null>(null)
  const [loading, setLoading] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const [tradeStyle, setTradeStyle] = useState<FilterStyle>('all')
  const [typeFilter, setTypeFilter] = useState<FilterType>('all')
  const [riskFilter, setRiskFilter] = useState<FilterRisk>('all')
  const [sortKey, setSortKey] = useState<SortKey>('dte')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

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

  const d = env?.data ?? ({} as Record<string, unknown>)
  const summary = (d.summary ?? {}) as Record<string, unknown>
  const market = (d.market_snapshot ?? {}) as Record<string, unknown>
  const perPositionPnl = (d.per_position_pnl ?? {}) as Record<string, { pnl: number; pnl_pct: number }>
  const rawTab = positionsTab as string
  const tab: MainTabId = TABS.some(t => t.id === rawTab) ? (rawTab as MainTabId) : 'open'

  const openPortfolio = useMemo(() => portfolio.filter(p => p.status === 'open'), [portfolio])
  const closedPortfolio = useMemo(() => portfolio.filter(p => p.status === 'closed'), [portfolio])
  const derivedOpt = openPortfolio.filter(p => (p.legs?.length ?? 0) > 0).length
  const derivedStock = Math.max(0, openPortfolio.length - derivedOpt)

  const optionsN = num(summary.options_positions, derivedOpt)
  const stockN = num(summary.stock_positions, derivedStock)
  const openN = num(summary.total_open_positions, openPortfolio.length)

  const totalPl = summary.total_pl ?? summary.total_net_pl
  const totalPlPct = summary.total_pl_pct ?? summary.total_net_pl_pct
  const dayPl = summary.day_pl
  const dayPlPct = summary.day_pl_pct
  const capitalUsed = num(summary.total_capital_used)
  const buyingPower = num(summary.buying_power, accountSize)
  const utilPct =
    capitalUsed > 0 && buyingPower + capitalUsed > 0
      ? (capitalUsed / (capitalUsed + buyingPower)) * 100
      : num(summary.capital_utilization_pct)

  const wlCount = num(summary.watchlist_count)
  const wlAlerts = num(summary.watchlist_alerts, num(summary.alerts_count))
  const alertCenterN = num(summary.alert_center_count, num(summary.alerts_count))
  const criticalN = num(summary.critical_alerts)

  const regime = String(market.regime ?? '').toLowerCase()
  const marketMood =
    regime === 'bullish' ? { label: 'Bullish', cls: getMarketContextBadgeClass('MARKET_SUPPORTIVE') }
    : regime === 'bearish' ? { label: 'Bearish', cls: getDecisionBadgeClass('AVOID') }
    : { label: 'Mixed', cls: getDecisionBadgeClass('WATCH') }

  const positions = tab === 'open' ? openPortfolio : closedPortfolio

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
  }, [positions, searchQuery, tradeStyle, typeFilter, riskFilter, sortKey, sortDir])

  const toggleExpanded = useCallback((id: string) => {
    setExpandedId(cur => (cur === id ? null : id))
  }, [])

  const handleClose = useCallback((pos: PortfolioPosition) => {
    closePosition(pos.id, { contractsToClose: pos.contracts, pnlPct: 0 })
    toggleExpanded(pos.id)
  }, [closePosition, toggleExpanded])

  const handleManage = useCallback((pos: PortfolioPosition) => {
    setEditingId(pos.id)
  }, [])

  const handleEdit = useCallback((id: string) => {
    setEditingId(id)
  }, [])

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

  const filtersActive = tradeStyle !== 'all' || typeFilter !== 'all' || riskFilter !== 'all'

  return (
    <div className="oa-cc-page positions-center-page max-w-[1600px] mx-auto px-4 py-6 space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight text-heading">Positions Center</h1>
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
            <button type="button" title="Settings" onClick={() => navigate('settings')} className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${getActionButtonClass('surface')}`}>
              <Settings size={16} />
            </button>
          </div>
        </div>
      </header>

      <section className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3">
        <KpiCard label="Total Net P&L" value={fmtUsd(totalPl)} valueClass={getProfitLossTextClass(num(totalPl))} sub={totalPlPct != null && String(totalPlPct) !== '' ? <span className={getProfitLossTextClass(num(totalPlPct))}>{fmtPct(totalPlPct)}</span> : null} />
        <KpiCard label="Day P&L" value={fmtUsd(dayPl)} valueClass={getProfitLossTextClass(num(dayPl))} sub={dayPlPct != null && String(dayPlPct) !== '' ? <span className={getProfitLossTextClass(num(dayPlPct))}>{fmtPct(dayPlPct)}</span> : null} />
        <KpiCard label="Open Positions" value={String(openN || '—')} sub={<span className="text-tertiary">{optionsN} Options / {stockN} Stocks</span>} />
        <KpiCard label="Buying Power" value={fmtUsd(buyingPower)} sub={<span className="text-tertiary">Available</span>} />
        <KpiCard label="Capital in Use" value={fmtUsd(capitalUsed)} sub={<span className="text-tertiary">{utilPct > 0 ? `${utilPct.toFixed(1)}%` : '—'}</span>} />
        <KpiCard label="Watchlist" value={String(wlCount)} sub={<span className="text-tertiary">{wlAlerts} Alerts</span>} />
        <KpiCard label="Alert Center" value={String(alertCenterN)} sub={criticalN > 0 ? <span className="inline-flex items-center gap-1 text-semantic-bearish"><AlertTriangle size={12} />{criticalN} Critical</span> : <span className="text-tertiary">—</span>} />
      </section>

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
                {t.label} <span className="text-[11px] opacity-70">({t.id === 'open' ? openPortfolio.length : closedPortfolio.length})</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-white/[0.08] bg-slate-50 dark:bg-slate-800/50 px-3 py-1.5 text-sm">
              <Search size={14} className="text-muted" />
              <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search ticker..." className="w-32 sm:w-40 bg-transparent text-sm text-primary outline-none placeholder:text-muted" />
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
        </div>

        {filterOpen && (
          <div className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-slate-900 p-4 shadow-sm">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Trade Style</div>
                <div className="flex flex-wrap gap-1.5">
                  {(['all', 'day', 'swing', 'regular'] as const).map(s => (
                    <button key={s} type="button" onClick={() => setTradeStyle(s)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${tradeStyle === s ? 'bg-violet-600 text-white' : 'bg-surface-muted/30 text-muted hover:text-secondary'}`}
                    >{s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}</button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Type</div>
                <div className="flex flex-wrap gap-1.5">
                  {(['all', 'options', 'stocks', 'spreads'] as const).map(t => (
                    <button key={t} type="button" onClick={() => setTypeFilter(t)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${typeFilter === t ? 'bg-violet-600 text-white' : 'bg-surface-muted/30 text-muted hover:text-secondary'}`}
                    >{t === 'all' ? 'All' : t.charAt(0).toUpperCase() + t.slice(1)}</button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Risk</div>
                <div className="flex flex-wrap gap-1.5">
                  {(['all', 'low', 'medium', 'high'] as const).map(r => (
                    <button key={r} type="button" onClick={() => setRiskFilter(r)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${riskFilter === r ? 'bg-violet-600 text-white' : 'bg-surface-muted/30 text-muted hover:text-secondary'}`}
                    >{r === 'all' ? 'All' : r.charAt(0).toUpperCase() + r.slice(1)}</button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {loading && positions.length === 0 ? (
        <div className="flex items-center justify-center py-24 text-sm text-muted">
          <RefreshCw size={16} className="mr-2 animate-spin" /> Loading positions...
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 dark:border-white/[0.08] px-4 py-20 text-center">
          <div className="text-lg font-semibold text-heading">{positions.length === 0 ? 'No positions yet' : 'No matching positions'}</div>
          <p className="mt-1 text-sm text-tertiary">
            {positions.length === 0
              ? 'Add positions from the Strategy Finder or ticker analysis pages.'
              : 'Try adjusting filters or search query.'}
          </p>
        </div>
      ) : filtered.length <= 3 ? (
        <div className="space-y-3">
          {filtered.map(pos => (
            <TradingPositionCard
              key={pos.id}
              pos={pos}
              pnlData={perPositionPnl[pos.id] ?? null}
              expanded={expandedId === pos.id}
              onToggle={() => toggleExpanded(pos.id)}
              onClose={() => handleClose(pos)}
              onManage={() => handleManage(pos)}
              onRoll={() => setNotice({ message: 'Roll action not wired yet' })}
              onAlert={() => setNotice({ message: 'Alert action not wired yet' })}
            />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map(pos => (
            <TradingPositionCard
              key={pos.id}
              pos={pos}
              pnlData={perPositionPnl[pos.id] ?? null}
              expanded={expandedId === pos.id}
              onToggle={() => toggleExpanded(pos.id)}
              onClose={() => handleClose(pos)}
              onManage={() => handleManage(pos)}
              onRoll={() => setNotice({ message: 'Roll action not wired yet' })}
              onAlert={() => setNotice({ message: 'Alert action not wired yet' })}
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

      {editingPos && (
        <EditPositionModal
          pos={editingPos}
          onSave={handleSaveEdit}
          onClose={() => setEditingId(null)}
        />
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
  const [form, setForm] = useState<FormState>(emptyForm)

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
        breakeven_lower: entryPrice,
        breakeven_upper: entryPrice,
        entryPrice,
        source: form.tradeSource,
        capital_at_risk: Math.round(entryPrice * cc),
        notes: form.notes.trim() || undefined,
      })
      return
    }

    const strikesNum = form.legStrikes.map(s => parseFloat(s) || 0)
    const premiumsNum = form.legPremiums.map(p => parseFloat(p) || 0)
    const metrics = computeMetrics(form.strategy, strikesNum, premiumsNum, entryPrice)

    const legs: OptionLeg[] = def.legs.map((tmpl, i) => ({
      action: tmpl.action,
      option_type: tmpl.option_type,
      strike: strikesNum[i],
      expiry: form.expiry,
      delta: 0,
      mid_price: premiumsNum[i],
      bid: premiumsNum[i] * 0.95,
      ask: premiumsNum[i] * 1.05,
      iv: 0,
      oi: 0,
      volume: 0,
      bid_ask_spread_pct: 0,
    }))

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
    ? (parseInt(form.contractCount) || 0) >= 1
    : form.expiry && form.entryStockPrice && (parseInt(form.contractCount) || 0) >= 1
  )

  return (
    <ModalOverlay onClose={onClose}>
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-white/[0.07]">
        <h2 className="text-base font-bold text-heading">Add Position</h2>
        <button type="button" onClick={onClose} className="text-muted hover:text-secondary"><X size={18} /></button>
      </div>
      <form onSubmit={handleSubmit}>
        <div className="px-6 py-5">
          <PositionFormFields form={form} onChange={patch => setForm(f => ({ ...f, ...patch }))} />
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100 dark:border-white/[0.05]">
          <button type="button" onClick={onClose} className={`${getActionButtonClass('surface')} rounded-lg px-4 py-2 text-sm`}>Cancel</button>
          <button type="submit" disabled={!canSubmit} className={`${getActionButtonClass('trade')} rounded-lg px-4 py-2 text-sm font-semibold`}>Add Position</button>
        </div>
      </form>
    </ModalOverlay>
  )
}

function EditPositionModal({
  pos,
  onSave,
  onClose,
}: {
  pos: PortfolioPosition
  onSave: (id: string, data: Omit<PortfolioPosition, 'id' | 'addedAt' | 'status'>) => void
  onClose: () => void
}) {
  const [form, setForm] = useState<FormState>(() => {
    const strat = resolveEditorStrategyForEdit(pos)
    const { strikes, premiums } = seedLegStringsFromPosition(pos)
    const src = deriveEngineSource(pos)
    return {
      ticker: pos.ticker,
      tradeSource: src,
      strategy: strat,
      expiry: normalizeExpiryForDateInput(pos.expiry),
      contractCount: String(pos.contracts),
      entryStockPrice: String(pos.entryPrice),
      notes: pos.notes ?? '',
      legStrikes: strikes,
      legPremiums: premiums,
    }
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const def = STRATEGY_DEFS[form.strategy]
    if (!def) return

    const isStock = form.strategy === 'Stock'
    const cc = parseInt(form.contractCount) || 0
    if (cc < 1) return

    const entryPrice = parseFloat(form.entryStockPrice) || pos.entryPrice
    const dteVal = form.expiry
      ? Math.ceil((new Date(form.expiry + 'T00:00:00').getTime() - Date.now()) / 86400000)
      : pos.dte

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
      })
      return
    }

    const strikesNum = form.legStrikes.map(s => parseFloat(s) || 0)
    const premiumsNum = form.legPremiums.map(p => parseFloat(p) || 0)
    const metrics = computeMetrics(form.strategy, strikesNum, premiumsNum, entryPrice)

    const legs: OptionLeg[] = def.legs.map((tmpl, i) => ({
      action: tmpl.action,
      option_type: tmpl.option_type,
      strike: strikesNum[i],
      expiry: form.expiry,
      delta: 0,
      mid_price: premiumsNum[i],
      bid: premiumsNum[i] * 0.95,
      ask: premiumsNum[i] * 1.05,
      iv: 0,
      oi: 0,
      volume: 0,
      bid_ask_spread_pct: 0,
    }))

    onSave(pos.id, {
      ticker: form.ticker.trim().toUpperCase(),
      companyName: pos.companyName,
      strategy: form.strategy,
      bias: def.bias,
      legs,
      expiry: form.expiry || pos.expiry,
      dte: dteVal,
      net_credit: metrics.netCredit,
      spread_width: metrics.spreadWidth,
      max_profit: metrics.maxProfit,
      max_loss: metrics.maxLoss,
      prob_of_profit: pos.prob_of_profit,
      expected_value: pos.expected_value,
      scores_total: pos.scores_total,
      contracts: cc,
      breakeven_lower: metrics.beLower,
      breakeven_upper: metrics.beUpper,
      entryPrice,
      source: form.tradeSource,
      capital_at_risk: Math.round(metrics.maxLoss * SHARES_PER_OPTION_CONTRACT * cc),
      kelly_fraction: pos.kelly_fraction,
      half_kelly_fraction: pos.half_kelly_fraction,
      edge_ratio: pos.edge_ratio,
      account_size_at_entry: pos.account_size_at_entry,
      notes: form.notes.trim() || undefined,
    })
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-white/[0.07]">
        <h2 className="text-base font-bold text-heading">Edit Position</h2>
        <button type="button" onClick={onClose} className="text-muted hover:text-secondary"><X size={18} /></button>
      </div>
      <form onSubmit={handleSubmit}>
        <div className="px-6 py-5">
          <PositionFormFields form={form} onChange={patch => setForm(f => ({ ...f, ...patch }))} readonlyTicker isEdit />
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100 dark:border-white/[0.05]">
          <button type="button" onClick={onClose} className={`${getActionButtonClass('surface')} rounded-lg px-4 py-2 text-sm`}>Cancel</button>
          <button type="submit" className={`${getActionButtonClass('trade')} rounded-lg px-4 py-2 text-sm font-semibold`}>Save Changes</button>
        </div>
      </form>
    </ModalOverlay>
  )
}
