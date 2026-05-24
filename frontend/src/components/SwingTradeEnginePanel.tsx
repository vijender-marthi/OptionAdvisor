import { useRef, useState } from 'react'
import {
  RefreshCw, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronRight,
  ShieldAlert, AlertTriangle, Check, CheckCircle2, Clock, Layers,
  BarChart2, BriefcaseBusiness, PlusCircle, Bell, Search, Lightbulb, Info, Activity,
} from 'lucide-react'
import type { SwingTradeScanResult } from '../api/client'
import type { PortfolioPosition } from '../types'
import {
  formatSwingEngineLabel,
  toneForBias,
  toneForFinalAction,
  playbookHintFromResult,
  swingEngineSecondaryBadgeItems,
  TONE_ACTION_BADGE,
  TONE_BADGE,
  TONE_DOT,
  TONE_RING,
  type Tone,
} from '../utils/swingTradeEngineBadges'
import SwingTradeMetricCharts from './SwingTradeMetricCharts'
import { ROUTES } from '../routing/routes'
import { getActionButtonClass, getDecisionBadgeClass, getMarketContextBadgeClass } from '../utils/semanticTrading'
import { MarketTimeGateBanner } from './MarketTimeGate'

interface Props {
  result: SwingTradeScanResult
  existingPositions?: PortfolioPosition[]
  onRefresh: () => void
  refreshing: boolean
  onRequestEnterActiveTrade?: () => void
  onViewPositions?: () => void
  onOpenStrategyFinder?: () => void
  onOpenCommandCenter?: () => void
  onCreateAlert?: () => void
  onSaveToJournal?: () => void
  savedToJournal?: boolean
  onViewSignals?: () => void
}

function resolverBadgeClass(value: string): string {
  const v = value.toUpperCase()
  if (v.includes('MARKET') || v.includes('BULL') || v.includes('BEAR') || v.includes('MIXED')) return getMarketContextBadgeClass(v)
  return getDecisionBadgeClass(v)
}

function actionLabel(finalAction: string): string {
  const ready = ['READY', 'STRONG_GO', 'GO_SMALL', 'TRADE']
  const watch = ['WATCH', 'WATCH_CALL_OR_DEBIT_SPREAD', 'WATCH_CALL', 'WATCH_PUT']
  const wait = ['WAIT', 'WAIT_PULLBACK', 'WAIT_BREAKOUT', 'WAIT_FOR_BREAKDOWN', 'AVOID_CHASE']
  const avoid = ['AVOID', 'EXIT', 'NO_EDGE', 'AVOID_NAKED_CALLS', 'NO_TRADE']
  if (ready.includes(finalAction)) return 'READY'
  if (watch.includes(finalAction)) return 'WATCH'
  if (wait.includes(finalAction)) return 'WAIT'
  if (avoid.includes(finalAction)) return 'AVOID'
  return 'WAIT'
}

function actionTone(finalAction: string): 'green' | 'blue' | 'orange' | 'red' {
  const ready = ['READY', 'STRONG_GO', 'GO_SMALL', 'TRADE']
  const watch = ['WATCH', 'WATCH_CALL_OR_DEBIT_SPREAD', 'WATCH_CALL', 'WATCH_PUT']
  const wait = ['WAIT', 'WAIT_PULLBACK', 'WAIT_BREAKOUT', 'WAIT_FOR_BREAKDOWN', 'AVOID_CHASE']
  const avoid = ['AVOID', 'EXIT', 'NO_EDGE', 'AVOID_NAKED_CALLS', 'NO_TRADE']
  if (ready.includes(finalAction)) return 'green'
  if (watch.includes(finalAction)) return 'blue'
  if (wait.includes(finalAction)) return 'orange'
  if (avoid.includes(finalAction)) return 'red'
  return 'orange'
}

function actionButtonClass(tone: 'green' | 'blue' | 'orange' | 'red'): string {
  if (tone === 'green' || tone === 'blue') return getActionButtonClass('trade')
  if (tone === 'orange' || tone === 'red') return getActionButtonClass('surface')
  return getActionButtonClass('surface')
}

function Badge({ text, tone }: { text: string; tone: Tone }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold leading-none ${TONE_BADGE[tone]}`}>
      {formatSwingEngineLabel(text)}
    </span>
  )
}

function RiskFlagPill({ flag }: { flag: string }) {
  const isHard = flag.includes('EARNINGS') || flag.includes('LIQUIDITY') || flag === 'IV_VERY_HIGH'
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
      isHard
        ? getDecisionBadgeClass('AVOID')
        : getDecisionBadgeClass('WATCH')
    }`}>
      {isHard ? <ShieldAlert size={10} /> : <AlertTriangle size={10} />}
      {formatSwingEngineLabel(flag)}
    </span>
  )
}

function ExecMapRow({ label, value, tone }: { label: string; value: string; tone?: string }) {
  if (!value || value === '—' || value === 'No trade' || value === '') return null
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-800/90 bg-black/15 px-3 py-2">
      <span className="text-[10px] uppercase tracking-wide text-gray-500">{label}</span>
      <span className={`text-xs font-semibold font-mono tabular-nums ${tone || 'text-gray-200'}`}>{value}</span>
    </div>
  )
}

function SignalRow({ label, value }: { label: string; value: { text: string; tone: Tone } | null }) {
  if (!value) return null
  return (
    <div className="flex items-center justify-between rounded-lg bg-gray-800/40 px-3 py-1.5">
      <span className="text-[11px] text-gray-500 font-medium">{label}</span>
      <Badge text={value.text} tone={value.tone} />
    </div>
  )
}

// ── Helpers to derive structured data from the result ────────────────

type SignalMap = Record<string, { text: string; tone: Tone } | null>

function computeSignalBreakdown(result: SwingTradeScanResult, m: Record<string, unknown>): SignalMap {
  const rsiVal = typeof m.rsi === 'number' ? m.rsi : null
  const ma20 = typeof m.ma20 === 'number' ? m.ma20 : null
  const ma50 = typeof m.ma50 === 'number' ? m.ma50 : null
  const volLabel = typeof m.volume_label === 'string' ? m.volume_label : ''
  const iv = typeof m.implied_iv_pct === 'number' ? m.implied_iv_pct : null
  const hv = typeof m.hv_20 === 'number' ? m.hv_20 : null
  const distMA20 = typeof m.dist_ma20_pct === 'number' ? m.dist_ma20_pct : null
  const mom5d = typeof m.momentum_5d_pct === 'number' ? m.momentum_5d_pct : null
  const marketCtx = typeof m.market_context === 'string' ? m.market_context : null
  const isBull = result.bias === 'long'

  // Trend
  let trend: { text: string; tone: Tone } | null = null
  if (ma20 != null && ma50 != null) {
    if (ma20 > ma50) {
      trend = isBull ? { text: 'Bullish', tone: 'green' } : { text: 'Bearish', tone: 'green' }
    } else {
      trend = isBull ? { text: 'Bearish', tone: 'red' } : { text: 'Bullish', tone: 'red' }
    }
  }

  // Momentum
  let momentum: { text: string; tone: Tone } | null = null
  if (rsiVal != null) {
    if ((isBull && rsiVal >= 50) || (!isBull && rsiVal <= 50)) {
      momentum = { text: 'Strong', tone: 'green' }
    } else if ((isBull && rsiVal >= 40) || (!isBull && rsiVal <= 60)) {
      momentum = { text: 'Moderate', tone: 'blue' }
    } else {
      momentum = { text: 'Weak', tone: 'red' }
    }
  }

  // Volume
  const volUp = volLabel.includes('bull') || volLabel.includes('expanding')
  const volDown = volLabel.includes('bear') || volLabel.includes('low')
  const volume: { text: string; tone: Tone } | null = volUp
    ? { text: 'Confirmed', tone: 'green' }
    : volDown
    ? { text: 'Weak', tone: 'red' }
    : { text: 'Mixed', tone: 'orange' }

  // RSI label
  let rsiDisplay: { text: string; tone: Tone } | null = null
  if (rsiVal != null) {
    if ((isBull && rsiVal <= 70 && rsiVal >= 50) || (!isBull && rsiVal >= 30 && rsiVal <= 50)) {
      rsiDisplay = { text: `Healthy (${rsiVal.toFixed(0)})`, tone: 'green' }
    } else if ((isBull && rsiVal > 70) || (!isBull && rsiVal < 30)) {
      rsiDisplay = { text: `Extended (${rsiVal.toFixed(0)})`, tone: 'orange' }
    } else {
      rsiDisplay = { text: `${rsiVal.toFixed(0)}`, tone: 'blue' }
    }
  }

  // Liquidity
  const hasLiqRisk = result.risk_flags.some(f => f.includes('LIQUIDITY'))
  const liquidity: { text: string; tone: Tone } | null = hasLiqRisk
    ? { text: 'Poor', tone: 'red' }
    : { text: 'Strong', tone: 'green' }

  // IV Context
  let ivCtx: { text: string; tone: Tone } | null = null
  if (iv != null) {
    if (iv >= 40) {
      ivCtx = { text: `High (${iv.toFixed(0)}%)`, tone: 'orange' }
    } else if (iv >= 25) {
      ivCtx = { text: `Moderate (${iv.toFixed(0)}%)`, tone: 'blue' }
    } else {
      ivCtx = { text: `Low (${iv.toFixed(0)}%)`, tone: 'green' }
    }
  } else if (hv != null) {
    if (hv >= 35) {
      ivCtx = { text: `High (${hv.toFixed(0)}%)`, tone: 'orange' }
    } else if (hv >= 20) {
      ivCtx = { text: `Moderate (${hv.toFixed(0)}%)`, tone: 'blue' }
    } else {
      ivCtx = { text: `Low (${hv.toFixed(0)}%)`, tone: 'green' }
    }
  }

  // Market Alignment
  let market: { text: string; tone: Tone } | null = null
  if (marketCtx === 'MARKET_SUPPORTIVE') {
    market = { text: 'Positive', tone: 'green' }
  } else if (marketCtx === 'MARKET_WEAK') {
    market = { text: 'Negative', tone: 'red' }
  } else if (marketCtx === 'MARKET_MIXED') {
    market = { text: 'Mixed', tone: 'orange' }
  }

  // Extension
  let extension: { text: string; tone: Tone } | null = null
  if (distMA20 != null) {
    const absDist = Math.abs(distMA20)
    if (absDist > 5) {
      extension = { text: 'High', tone: 'orange' }
    } else if (absDist > 2) {
      extension = { text: 'Moderate', tone: 'blue' }
    } else {
      extension = { text: 'Low', tone: 'green' }
    }
  } else if (mom5d != null) {
    const absMom = Math.abs(mom5d)
    if (absMom > 5) {
      extension = { text: 'High', tone: 'orange' }
    } else if (absMom > 2) {
      extension = { text: 'Moderate', tone: 'blue' }
    } else {
      extension = { text: 'Low', tone: 'green' }
    }
  }

  return {
    trend, momentum, volume, rsi: rsiDisplay,
    liquidity, iv_context: ivCtx,
    market_alignment: market, extension,
  }
}

type ReasoningBlock = {
  title: string
  items: string[]
  tone: 'emerald' | 'amber' | 'sky' | 'violet'
}

function computeReasoning(
  result: SwingTradeScanResult,
  m: Record<string, unknown>,
): ReasoningBlock[] {
  const blocks: ReasoningBlock[] = []
  const isBull = result.bias === 'long'
  const isBear = result.bias === 'short'
  const ma20 = typeof m.ma20 === 'number' ? m.ma20 : null
  const ma50 = typeof m.ma50 === 'number' ? m.ma50 : null
  const rsiVal = typeof m.rsi === 'number' ? m.rsi : null
  const marketCtx = typeof m.market_context === 'string' ? m.market_context : null
  const iv = typeof m.implied_iv_pct === 'number' ? m.implied_iv_pct : null
  const hv = typeof m.hv_20 === 'number' ? m.hv_20 : null
  const volLabel = typeof m.volume_label === 'string' ? m.volume_label : ''

  // WHY THIS TRADE
  const whyTrade: string[] = []
  if (ma20 != null && ma50 != null) {
    whyTrade.push(ma20 > ma50 ? 'MA20 above MA50 — uptrend intact' : 'MA20 below MA50 — downtrend')
  }
  if (marketCtx === 'MARKET_SUPPORTIVE') {
    whyTrade.push(isBull ? 'Market context supportive' : 'Market context supportive of downside')
  } else if (marketCtx === 'MARKET_WEAK') {
    whyTrade.push(isBull ? 'Weak market — counter-trend risk' : 'Market weak — tailwind for bearish')
  }
  if (volLabel.includes('bull') || volLabel.includes('expanding')) {
    whyTrade.push('Volume confirms direction')
  }
  if (rsiVal != null) {
    if (isBull && rsiVal >= 50 && rsiVal <= 70) whyTrade.push('RSI in healthy bullish range')
    if (isBear && rsiVal <= 50 && rsiVal >= 30) whyTrade.push('RSI in healthy bearish range')
  }
  if (result.supporting_factors.length > 0) {
    whyTrade.push(...result.supporting_factors.slice(0, 2))
  }
  if (whyTrade.length === 0 && result.reason) {
    whyTrade.push(result.reason)
  }
  if (whyTrade.length > 0) {
    blocks.push({ title: 'WHY THIS TRADE', items: whyTrade, tone: 'emerald' })
  }

  // WHY THIS STRUCTURE
  const whyStruct: string[] = []
  if (result.suggested_strategy && result.suggested_strategy !== 'NO_TRADE') {
    whyStruct.push(`${formatSwingEngineLabel(result.suggested_strategy)} selected for current conditions`)
  }
  const ivVal = iv ?? hv
  if (ivVal != null) {
    if (ivVal >= 35) {
      whyStruct.push('IV elevated — buying calls/puts offers convexity')
    } else if (ivVal >= 20) {
      whyStruct.push('IV moderate — directional premium reasonable')
    } else {
      whyStruct.push('IV low — premium cheap for directional exposure')
    }
  }
  if (result.playbook_hint) {
    whyStruct.push(result.playbook_hint)
  }
  if (result.recommended_contract_duration) {
    whyStruct.push(`Contract duration: ${result.recommended_contract_duration} DTE`)
  }
  if (whyStruct.length > 0) {
    blocks.push({ title: 'WHY THIS STRUCTURE', items: whyStruct, tone: 'violet' })
  }

  // ENTRY CONDITIONS
  const execConds: string[] = []
  if (result.entry_quality === 'GOOD_ENTRY') {
    execConds.push('Entry quality is GOOD — conditions align')
  } else if (result.entry_quality === 'CAUTION_ENTRY') {
    execConds.push('Caution entry — reduce size')
  } else if (result.entry_quality === 'WAIT_PULLBACK') {
    execConds.push('Wait for pullback confirmation before entry')
    if (isBull && rsiVal != null && rsiVal > 60) execConds.push('RSI elevated — wait for cooling')
  } else if (result.entry_quality === 'LATE_ENTRY' || result.entry_quality === 'EXTENDED_RISK') {
    execConds.push('Stock is extended — avoid chasing')
  }
  if (result.confirmation_needed.length > 0) {
    execConds.push(...result.confirmation_needed.slice(0, 2))
  }
  if (execConds.length === 0) {
    if (isBull) execConds.push('Monitor for entry trigger confirmation')
    else execConds.push('Wait for clearer entry signal')
  }
  blocks.push({ title: 'ENTRY CONDITIONS', items: execConds, tone: 'sky' })

  // RISK NOTES
  const riskNotes: string[] = []
  if (result.risk_flags.length > 0) {
    result.risk_flags.slice(0, 3).forEach(f => {
      riskNotes.push(formatSwingEngineLabel(f))
    })
  }
  if (rsiVal != null) {
    if ((isBull && rsiVal > 70) || (!isBull && rsiVal < 30)) {
      riskNotes.push(`${isBull ? 'RSI overbought' : 'RSI oversold'} (${rsiVal.toFixed(0)})`)
    }
  }
  if (result.avoid_reason) {
    riskNotes.push(result.avoid_reason)
  }
  if (riskNotes.length === 0) {
    riskNotes.push('No material risk flags — standard position management applies')
  }
  blocks.push({ title: 'RISK NOTES', items: riskNotes, tone: 'amber' })

  return blocks
}

type RiskPanelItem = {
  label: string
  value: string
  tone: 'green' | 'amber' | 'red' | 'gray'
}

function computeRiskPanel(result: SwingTradeScanResult, m: Record<string, unknown>): RiskPanelItem[] {
  const items: RiskPanelItem[] = []
  const isBull = result.bias === 'long'
  const rsiVal = typeof m.rsi === 'number' ? m.rsi : null
  const iv = typeof m.implied_iv_pct === 'number' ? m.implied_iv_pct : null
  const hasEarnings = result.risk_flags.some(f => f.includes('EARNINGS'))
  const hasLiqRisk = result.risk_flags.some(f => f.includes('LIQUIDITY'))
  const hasVixExtreme = result.risk_flags.some(f => f.includes('VIX_EXTREME'))
  const hasVixElevated = result.risk_flags.some(f => f.includes('VIX_ELEVATED'))

  // Risk Level
  items.push({
    label: 'Overall Risk',
    value: formatSwingEngineLabel(result.risk_level),
    tone: result.risk_level === 'LOW' ? 'green' : result.risk_level === 'MEDIUM' ? 'amber' : 'red',
  })

  // Theta Risk
  const dte = result.suggested_expiry_window
  const shortDte = dte.includes('3') || dte.includes('short')
  items.push({
    label: 'Theta Risk',
    value: shortDte ? 'Elevated' : 'Manageable',
    tone: shortDte ? 'amber' : 'green',
  })

  // IV Crush Risk
  if (iv != null) {
    items.push({
      label: 'IV Crush Risk',
      value: iv > 50 ? 'Elevated' : iv > 30 ? 'Moderate' : 'Low',
      tone: iv > 50 ? 'red' : iv > 30 ? 'amber' : 'green',
    })
  } else {
    items.push({ label: 'IV Crush Risk', value: 'Moderate', tone: 'amber' })
  }

  // Extension Risk
  const distMA20 = typeof m.dist_ma20_pct === 'number' ? Math.abs(m.dist_ma20_pct) : null
  if (distMA20 != null) {
    items.push({
      label: 'Extension Risk',
      value: distMA20 > 5 ? 'High' : distMA20 > 2 ? 'Moderate' : 'Low',
      tone: distMA20 > 5 ? 'red' : distMA20 > 2 ? 'amber' : 'green',
    })
  }

  // Liquidity Risk
  items.push({
    label: 'Liquidity Risk',
    value: hasLiqRisk ? 'Poor' : 'Adequate',
    tone: hasLiqRisk ? 'red' : 'green',
  })

  // Earnings Risk
  items.push({
    label: 'Earnings Risk',
    value: hasEarnings ? 'Imminent' : 'Clear',
    tone: hasEarnings ? 'red' : 'green',
  })

  // VIX risk
  if (hasVixExtreme) {
    items.push({ label: 'VIX Risk', value: 'Extreme', tone: 'red' })
  } else if (hasVixElevated) {
    items.push({ label: 'VIX Risk', value: 'Elevated', tone: 'amber' })
  }

  return items
}

// ── Execution Plan helpers ──────────────────────────────────────────

type MA20Context = { label: string; tone: string }

function ma20ContextLabel(distPct: number): MA20Context {
  const abs = Math.abs(distPct)
  if (abs < 2) return { label: 'IDEAL', tone: 'text-semantic-bullish' }
  if (abs < 5) return { label: 'SLIGHTLY EXTENDED', tone: 'text-semantic-warning' }
  if (abs < 8) return { label: 'EXTENDED', tone: 'text-semantic-extended' }
  return { label: 'OVEREXTENDED', tone: 'text-semantic-bearish' }
}

type ExecPlan = { preferred: string; aggressive: string; avoid: string; management: string }

function computeExecPlan(result: SwingTradeScanResult, m: Record<string, unknown>): ExecPlan {
  const entryDecision = m.entry_decision as { conservative?: string; aggressive?: string; best_setup?: string } | undefined
  const execPersonality = m.execution_personality as { suitable_for?: string[]; not_ideal_for?: string[] } | undefined

  if (entryDecision?.conservative || entryDecision?.aggressive) {
    return {
      preferred: entryDecision.best_setup || entryDecision.conservative || 'No clear preferred entry',
      aggressive: entryDecision.aggressive || 'Not recommended',
      avoid: execPersonality?.not_ideal_for?.length
        ? `Not ideal for: ${execPersonality.not_ideal_for.join(', ')}`
        : 'Entering without confirmation',
      management: result.entry_quality === 'GOOD_ENTRY'
        ? 'Standard position management — trail below MA20'
        : 'Wait for confirmation — avoid FOMO entries',
    }
  }

  const isBull = result.bias === 'long'
  const distMA20 = typeof m.dist_ma20_pct === 'number' ? m.dist_ma20_pct : null
  const rsiVal = typeof m.rsi === 'number' ? m.rsi : null
  const absDist = distMA20 != null ? Math.abs(distMA20) : null
  const eq = result.entry_quality

  if (isBull) {
    const preferred = absDist != null && absDist < 3
      ? 'Pullback hold above MA20 with volume confirmation'
      : eq === 'GOOD_ENTRY'
        ? 'Current levels acceptable — execute with defined stop'
        : 'Wait for pullback to MA20 support zone'

    const aggressive = absDist != null && absDist < 3
      ? 'Breakout continuation above recent high with volume'
      : absDist != null && absDist < 6
        ? 'Entry on strength if volume confirms breakout above resistance'
        : 'Do not chase — wait for pullback'

    const avoid = absDist != null && absDist > 5
      ? `Chasing >${absDist.toFixed(0)}% extension above MA20`
      : rsiVal != null && rsiVal > 70
        ? 'Entry with RSI overbought at current level'
        : 'Entering without volume confirmation'

    const management = absDist != null && absDist > 6
      ? `Protect profits if extension exceeds 8%`
      : eq === 'WAIT_PULLBACK'
        ? 'Wait for pullback — avoid FOMO entries'
        : 'Standard position management — trail below MA20'

    return { preferred, aggressive, avoid, management }
  }

  return {
    preferred: 'Monitor for breakdown confirmation below support',
    aggressive: 'Entry on breakdown with volume confirmation',
    avoid: 'Counter-trend buying before breakdown confirmed',
    management: 'Trail above resistance on bearish position',
  }
}

export type ExecLevels = {
  pullbackZone: string | null
  breakoutTrigger: string | null
  riskBelow: string | null
  firstTarget: string | null
  stretchTarget: string | null
}

export function computeExecLevels(result: SwingTradeScanResult, m: Record<string, unknown>): ExecLevels {
  const lastPrice = typeof m.last_price === 'number' ? m.last_price : null
  const ma20 = typeof m.ma20 === 'number' ? m.ma20 : null
  const mom5d = typeof m.momentum_5d_pct === 'number' ? m.momentum_5d_pct : null
  const isBull = result.bias === 'long'

  const empty = { pullbackZone: null, breakoutTrigger: null, riskBelow: null, firstTarget: null, stretchTarget: null }
  if (lastPrice == null) return empty

  // Use a floor of 2.5% so targets always have meaningful distance.
  // Low-momentum tickers (mom5d < 2.5%) would otherwise produce targets
  // below the breakout confirmation level.
  const mom = mom5d != null ? Math.max(Math.abs(mom5d) / 100, 0.025) : 0.05

  if (isBull) {
    const pbLow  = ma20 != null ? ma20 * 0.98  : lastPrice * 0.97
    const pbHigh = ma20 != null ? ma20 * 1.015 : lastPrice * 0.995
    // Anchor targets to the breakout confirmation level, not current price.
    // This ensures Target 1 and Target 2 are always reachable AFTER entry.
    const brkLevel = lastPrice * 1.015
    return {
      pullbackZone:    `${pbLow.toFixed(2)}–${pbHigh.toFixed(2)}`,
      breakoutTrigger: `$${brkLevel.toFixed(2)}`,
      riskBelow:       ma20 != null ? `$${(ma20 * 0.96).toFixed(2)}` : `$${(lastPrice * 0.95).toFixed(2)}`,
      firstTarget:     `$${(brkLevel * (1 + mom * 0.5)).toFixed(2)}`,
      stretchTarget:   `$${(brkLevel * (1 + mom)).toFixed(2)}`,
    }
  }

  const brkLevel = lastPrice * 0.985
  return {
    pullbackZone:    ma20 != null ? `${(ma20 * 1.01).toFixed(2)}–${(ma20 * 1.025).toFixed(2)}` : `${(lastPrice * 1.005).toFixed(2)}–${(lastPrice * 1.03).toFixed(2)}`,
    breakoutTrigger: `$${brkLevel.toFixed(2)}`,
    riskBelow:       ma20 != null ? `$${(ma20 * 1.04).toFixed(2)}` : `$${(lastPrice * 1.05).toFixed(2)}`,
    firstTarget:     `$${(brkLevel * (1 - mom * 0.5)).toFixed(2)}`,
    stretchTarget:   `$${(brkLevel * (1 - mom)).toFixed(2)}`,
  }
}

function computeRiskExplanation(result: SwingTradeScanResult, m: Record<string, unknown>): string {
  const isBull = result.bias === 'long'
  const distMA20 = typeof m.dist_ma20_pct === 'number' ? m.dist_ma20_pct : null
  const absDist = distMA20 != null ? Math.abs(distMA20) : null
  const rl = result.risk_level
  const eq = result.entry_quality
  const hasEarnings = result.risk_flags.some(f => f.includes('EARNINGS'))

  if (rl === 'LOW') {
    if (absDist != null && absDist < 2) return 'Low risk because trend aligned and pullback support nearby.'
    return 'Low risk — trend supportive, entry conditions favorable.'
  }
  if (rl === 'MEDIUM') {
    if (absDist != null && absDist > 3) return `Medium risk due to extension above MA20 despite strong trend quality.`
    if (eq === 'CAUTION_ENTRY') return 'Medium risk — entry quality requires caution, manage position size.'
    return 'Medium risk — monitor for confirmation before adding exposure.'
  }
  if (absDist != null && absDist > 6) return `High risk because ${isBull ? 'momentum strong but extension elevated' : 'significant deviation from trend structure'}.`
  if (hasEarnings) return 'High risk due to imminent earnings event.'
  return 'High risk — consider defined-risk strategies and reduced size.'
}

function computeTradeManagement(result: SwingTradeScanResult, m: Record<string, unknown>): string[] {
  const isBull = result.bias === 'long'
  const distMA20 = typeof m.dist_ma20_pct === 'number' ? m.dist_ma20_pct : null
  const absDist = distMA20 != null ? Math.abs(distMA20) : null
  const rsiVal = typeof m.rsi === 'number' ? m.rsi : null
  const volLabel = typeof m.volume_label === 'string' ? m.volume_label : ''
  const marketCtx = typeof m.market_context === 'string' ? m.market_context : null
  const items: string[] = []

  if (isBull) {
    if (absDist != null && absDist < 3) items.push('If breakout succeeds: trail stop below MA20')
    if (rsiVal != null && rsiVal > 65) items.push('If RSI cools toward 50: wait for pullback support to hold')
    if (absDist != null && absDist > 6) items.push('If extension exceeds 8%: protect profits, tighten stops')
    if (volLabel.includes('low') || volLabel.includes('bear')) items.push('If volume weakens further: avoid adding size')
    if (marketCtx === 'MARKET_WEAK') items.push('Market weak: reduce size, wait for broader confirmation')
    if (marketCtx === 'MARKET_SUPPORTIVE') items.push('Market supportive: maintain position within risk limits')
    items.push('If price loses MA20: reduce size, reassess structure')
  } else {
    if (rsiVal != null && rsiVal < 35) items.push('If RSI bounces above 40: cover short, wait for re-entry')
    if (marketCtx === 'MARKET_WEAK') items.push('Market tailwind active: hold bearish position')
    if (marketCtx === 'MARKET_SUPPORTIVE') items.push('Market supportive of bulls: reduce bearish exposure')
    items.push('If price reclaims MA20: reduce size, reassess')
  }
  if (items.length === 0) items.push('Standard position management: define stop before entry, maintain R/R discipline')
  return items
}

function computeStructureReasoning(result: SwingTradeScanResult, m: Record<string, unknown>): string[] {
  const strategy = result.suggested_strategy
  const iv = typeof m.implied_iv_pct === 'number' ? m.implied_iv_pct : null
  const hv = typeof m.hv_20 === 'number' ? m.hv_20 : null
  const ivVal = iv ?? hv
  const strats: Record<string, string[]> = {
    LONG_CALL: [
      'Upside expansion expected with strong trend momentum',
      ivVal != null && ivVal > 35 ? 'IV elevated — convexity favors long premium' : 'IV acceptable for directional exposure',
      'Momentum strong — spread cap may limit upside',
      'Defined loss limited to premium paid',
    ],
    CALL_DEBIT_SPREAD: [
      ivVal != null && ivVal > 35 ? 'IV elevated — spread reduces cost and defines risk' : 'Moderate IV — spread lowers cost basis',
      'Moderate upside expected — structure matches outlook',
      'Defined risk protects against IV crush and gap risk',
      'Max loss limited to debit paid',
    ],
    LONG_PUT: [
      'Downside momentum favors directional put exposure',
      ivVal != null && ivVal > 35 ? 'IV elevated — premium pricing reflects elevated risk' : 'IV reasonable for protective positioning',
    ],
    PUT_DEBIT_SPREAD: [
      'Bearish outlook with defined risk',
      ivVal != null && ivVal > 35 ? 'IV supports spread structure — defined risk preferred' : 'Defined risk aligns with moderate downside view',
    ],
    PUT_CREDIT_SPREAD: [
      'Bull Put Spread — sell OTM put, buy further OTM put for net credit',
      ivVal != null && ivVal > 35 ? 'IV very elevated — selling premium captures IV crush and theta decay' : 'Credit structure collects premium upfront',
      'Profit if stock stays above the sold put strike at expiry',
      'Max loss is the spread width minus credit received — defined risk',
      'Time decay works in your favor every day you hold',
    ],
    CALL_CREDIT_SPREAD: [
      'Bear Call Spread — sell OTM call, buy higher OTM call for net credit',
      ivVal != null && ivVal > 35 ? 'IV very elevated — selling premium captures IV crush and theta decay' : 'Credit structure collects premium upfront',
      'Profit if stock stays below the sold call strike at expiry',
      'Max loss is the spread width minus credit received — defined risk',
      'Time decay works in your favor every day you hold',
    ],
  }
  if (strategy && strats[strategy]) return strats[strategy]
  return ['Standard structure selected for current conditions']
}

function computeExecutionSummary(result: SwingTradeScanResult, m: Record<string, unknown>): string {
  const isBull = result.bias === 'long'
  const eq = result.entry_quality
  const distMA20 = typeof m.dist_ma20_pct === 'number' ? m.dist_ma20_pct : null
  const absDist = distMA20 != null ? Math.abs(distMA20) : null
  const marketCtx = typeof m.market_context === 'string' ? m.market_context : null
  const rsiVal = typeof m.rsi === 'number' ? m.rsi : null
  const sq = result.setup_quality

  const shouldEnter = m.should_enter_now as string | undefined
  const rrQuality = m.rr_quality as string | undefined
  const pullbackProb = m.pullback_probability as string | undefined
  const marketPhaseField = m.market_phase as string | undefined

  const parts: string[] = []

  if (sq === 'STRONG' || sq === 'GOOD') parts.push(isBull ? 'Strong trend continuation setup.' : 'Strong breakdown structure.')
  else if (sq === 'FAIR') parts.push('Moderate setup quality.')
  else parts.push('Setup quality is weak — exercise caution.')

  if (marketPhaseField) {
    parts.push(`Market phase: ${marketPhaseField.replace(/_/g, ' ').toLowerCase()}.`)
  } else {
    const rsiOk = isBull ? (rsiVal != null && rsiVal >= 45 && rsiVal <= 70) : (rsiVal != null && rsiVal <= 55 && rsiVal >= 30)
    if (rsiOk) parts.push('Momentum supportive.')
    else if (rsiVal != null) parts.push('Momentum less supportive at current levels.')
  }

  if (shouldEnter === 'YES') {
    parts.push('Entry conditions favorable — can enter now.')
  } else if (shouldEnter === 'CONDITIONAL') {
    parts.push('Entry conditional — wait for confirmation triggers.')
  } else if (shouldEnter === 'NO') {
    parts.push('Do not enter at current levels — wait for better setup.')
  } else if (eq === 'GOOD_ENTRY') {
    parts.push('Entry quality remains good.')
  } else if (eq === 'CAUTION_ENTRY' || eq === 'INTRADAY_CAUTION') {
    parts.push('Entry requires caution — reduce size.')
  } else if (eq === 'WAIT_PULLBACK') {
    parts.push('Wait for pullback before entry.')
  }

  if (pullbackProb) {
    parts.push(`Pullback probability: ${pullbackProb.toLowerCase()}.`)
  } else if (absDist != null && absDist > 4) {
    parts.push('Extension above MA20 increases chase risk. Prefer pullback entries.')
  } else if (absDist != null && absDist > 2) {
    parts.push('Extension is moderate — manage entry timing.')
  }

  if (rrQuality) {
    parts.push(`Risk/reward quality: ${rrQuality.toLowerCase()}.`)
  } else if (marketCtx === 'MARKET_WEAK') {
    parts.push('Weak market context — prefer reduced size and defined risk.')
  } else if (marketCtx === 'MARKET_SUPPORTIVE' && isBull) {
    parts.push('Market context supportive of bullish positioning.')
  }

  return parts.join(' ')
}

function computeBestNextAction(result: SwingTradeScanResult, m: Record<string, unknown>, execPlan: ExecPlan): string {
  const shouldEnter = String(m.should_enter_now || '').toUpperCase()
  if (shouldEnter === 'YES') return execPlan.preferred
  if (shouldEnter === 'CONDITIONAL') return result.confirmation_needed[0] || execPlan.preferred
  if (result.final_decision === 'AVOID' || result.final_action === 'NO_TRADE') {
    return result.avoid_reason || execPlan.avoid
  }
  if (result.final_decision === 'WATCH' || result.final_decision === 'WAIT') {
    return result.confirmation_needed[0] || execPlan.preferred
  }
  return execPlan.preferred
}

function computeAlternativeStructureNote(result: SwingTradeScanResult, m: Record<string, unknown>): string {
  const iv = typeof m.implied_iv_pct === 'number' ? m.implied_iv_pct : null
  const strategy = String(result.suggested_strategy || '')
  if (strategy === 'LONG_CALL') {
    return iv != null && iv >= 35
      ? 'Long Call is still acceptable, but shift toward a debit spread if premium expands further.'
      : 'Debit spread is not required unless premium becomes expensive or extension increases.'
  }
  if (strategy === 'CALL_DEBIT_SPREAD') {
    return 'Spread preferred here because it limits premium outlay and reduces damage if momentum stalls.'
  }
  if (strategy === 'LONG_PUT') {
    return iv != null && iv >= 35
      ? 'Long Put works, but a put debit spread can improve efficiency if implied volatility keeps climbing.'
      : 'Long Put remains acceptable while downside momentum stays clean.'
  }
  if (strategy === 'PUT_DEBIT_SPREAD') {
    return 'Spread structure is favored because risk is defined while still keeping bearish participation.'
  }
  if (strategy === 'PUT_CREDIT_SPREAD') {
    return iv != null && iv >= 35
      ? 'Bull Put Spread is preferred — IV is very high, selling premium via a credit spread captures IV crush and theta. Profit zone: stock stays above sold put strike.'
      : 'Bull Put Spread collects a net credit and profits from time decay. Switch to a call debit spread if IV compresses significantly before entry.'
  }
  if (strategy === 'CALL_CREDIT_SPREAD') {
    return iv != null && iv >= 35
      ? 'Bear Call Spread is preferred — IV is very high, selling premium via a credit spread captures IV crush and theta. Profit zone: stock stays below sold call strike.'
      : 'Bear Call Spread collects a net credit and profits from time decay. Switch to a put debit spread if IV compresses significantly before entry.'
  }
  return 'Use the selected structure only while the current execution conditions remain valid.'
}

function buildStepWalkthrough(result: SwingTradeScanResult, m: Record<string, unknown>, execPlan: ExecPlan): string[] {
  const marketCtx = typeof m.market_context === 'string' ? m.market_context : ''
  const distMA20 = typeof m.dist_ma20_pct === 'number' ? Math.abs(m.dist_ma20_pct) : null
  const iv = typeof m.implied_iv_pct === 'number' ? m.implied_iv_pct : null
  const shouldEnter = String(m.should_enter_now || '').toUpperCase()
  const steps: string[] = []

  steps.push(marketCtx === 'MARKET_SUPPORTIVE' ? 'Market is supportive.' : marketCtx === 'MARKET_WEAK' ? 'Market is fighting the setup.' : 'Market context is mixed.')
  steps.push(
    distMA20 != null && distMA20 > 5
      ? `${result.ticker} trend is constructive but extended.`
      : `${result.ticker} trend structure is aligned for a swing setup.`,
  )
  steps.push(
    result.suggested_strategy && result.suggested_strategy !== 'NO_TRADE'
      ? `${formatSwingEngineLabel(result.suggested_strategy)} is preferred${iv != null ? ` because IV is ${iv >= 40 ? 'elevated' : iv >= 25 ? 'moderate' : 'low'}.` : '.'}`
      : 'No preferred options structure is ready yet.',
  )
  steps.push(
    shouldEnter === 'YES'
      ? 'Entry is allowed now, but cleaner pullbacks still improve risk/reward.'
      : shouldEnter === 'CONDITIONAL'
        ? 'Entry is conditional, so wait for confirmation before committing size.'
        : 'Entry is not ready yet, so patience matters more than prediction.',
  )
  steps.push(execPlan.management || 'Protect profits if extension increases and reduce risk if price loses MA20.')
  return steps
}

function ma20Display(distPct: number): { text: string; cls: string } {
  const ctx = ma20ContextLabel(distPct)
  const sign = distPct >= 0 ? '+' : ''
  return { text: `${sign}${distPct.toFixed(1)}% ${ctx.label}`, cls: ctx.tone }
}

function toneForExecMap(label: string): string {
  const v = label.toUpperCase()
  if (v === 'READY' || v === 'GOOD' || v === 'LOW' || v === 'STRONG') return 'text-semantic-bullish'
  if (v === 'WATCH' || v === 'WAIT' || v === 'MEDIUM' || v === 'MODERATE') return 'text-semantic-warning'
  if (v === 'AVOID' || v === 'HIGH' || v === 'EXTREME' || v === 'POOR') return 'text-semantic-bearish'
  return 'text-secondary'
}

// ── Main Component ──────────────────────────────────────────────────

export default function SwingTradeEnginePanel({
  result, onRefresh, refreshing,
  existingPositions = [],
  onRequestEnterActiveTrade,
  onViewPositions,
  onOpenStrategyFinder,
  onOpenCommandCenter,
  onCreateAlert,
  onSaveToJournal,
  savedToJournal,
  onViewSignals,
}: Props) {
  const inPosition = existingPositions.length > 0
  const latestPos  = existingPositions[existingPositions.length - 1]
  const [detailOpen, setDetailOpen] = useState(false)
  const [signalsOpen, setSignalsOpen] = useState(false)
  const [chartsOpen, setChartsOpen] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth >= 768))
  const [chartTab, setChartTab] = useState<'price' | 'rsi' | 'hv' | 'volume'>('price')
  const signalsSectionRef = useRef<HTMLDivElement | null>(null)

  const m = result.metrics as Record<string, unknown>
  const swingLastPrice = typeof m.last_price === 'number' && Number.isFinite(m.last_price) ? m.last_price : null
  const swingChartSeries = m.chart_series as { points?: Array<{ c: number }> } | undefined
  let swingDailyDollar: number | null = null
  let swingDailyPct: number | null = null
  if (swingChartSeries?.points && swingChartSeries.points.length >= 2) {
    const pts = swingChartSeries.points
    const lastC = pts[pts.length - 1]?.c
    const prevC = pts[pts.length - 2]?.c
    if (typeof lastC === 'number' && typeof prevC === 'number' && Number.isFinite(lastC) && Number.isFinite(prevC) && prevC !== 0) {
      swingDailyDollar = lastC - prevC
      swingDailyPct = (swingDailyDollar / prevC) * 100
    }
  }
  const ringTone = toneForFinalAction(result.final_action)
  const execLabel = actionLabel(result.final_action)
  const execTone: 'green' | 'blue' | 'orange' | 'red' = actionTone(result.final_action)

  const secondaryBadges = swingEngineSecondaryBadgeItems(result)
  const playbookHint = playbookHintFromResult(result)
  const signalMap = computeSignalBreakdown(result, m)
  const reasoning = computeReasoning(result, m)
  const riskPanel = computeRiskPanel(result, m)

  const lastPrice = typeof m.last_price === 'number' ? m.last_price : null
  const priceStale = Boolean(m.price_stale)
  const priceWarning = typeof m.price_warning === 'string' && m.price_warning ? m.price_warning : null
  const ma20 = typeof m.ma20 === 'number' ? m.ma20 : null
  const ma50 = typeof m.ma50 === 'number' ? m.ma50 : null
  const sessionDate = typeof m.session_date === 'string' ? m.session_date : null
  const spyBias = typeof m.spy_bias === 'string' ? m.spy_bias : null
  const qqqBias = typeof m.qqq_bias === 'string' ? m.qqq_bias : null
  const distMA20 = typeof m.dist_ma20_pct === 'number' ? m.dist_ma20_pct : null

  const isBull = result.bias === 'long'
  const isShort = result.bias === 'short'

  const biasBadge = secondaryBadges.find(b => b.label === 'Bias')
  const entryBadge = secondaryBadges.find(b => b.label === 'Entry')
  const riskBadge = secondaryBadges.find(b => b.label === 'Risk')
  const marketBadge = secondaryBadges.find(b => b.label === 'Market')

  const execPlan = computeExecPlan(result, m)
  const execLevels = computeExecLevels(result, m)
  const riskExplanation = computeRiskExplanation(result, m)
  const tradeMgmt = computeTradeManagement(result, m)
  type ExitRule = { trigger: string; price: number; action: string; note: string }
  const exitRules: ExitRule[] = Array.isArray(m.exit_rules) ? (m.exit_rules as ExitRule[]) : []
  const structureReasoning = computeStructureReasoning(result, m)
  const execSummary = computeExecutionSummary(result, m)
  const bestNextAction = computeBestNextAction(result, m, execPlan)
  const alternativeStructureNote = computeAlternativeStructureNote(result, m)
  const walkthroughSteps = buildStepWalkthrough(result, m, execPlan)
  const distMA20Display = distMA20 != null ? ma20Display(distMA20) : null
  const marketSupportive = typeof m.market_context === 'string' ? m.market_context : ''
  const marketPhase = typeof m.market_phase === 'string' ? m.market_phase : result.setup_quality
  const pullbackProb = typeof m.pullback_probability === 'string' ? m.pullback_probability : ''
  const rrQuality = typeof m.rr_quality === 'string' ? m.rr_quality : ''
  const executionPersonality = m.execution_personality as { suitable_for?: string[]; not_ideal_for?: string[] } | undefined
  const entryDecision = m.entry_decision as { conservative?: string; aggressive?: string; best_setup?: string } | undefined
  const contextualAlerts = Array.isArray(m.contextual_alerts) ? m.contextual_alerts as Array<{ type?: string; message?: string; condition?: string }> : []
  const volumeRatio = typeof m.volume_ratio === 'number' ? m.volume_ratio : null
  const volumeLabel = typeof m.volume_label === 'string' ? m.volume_label : ''

  // Which step is the trader's primary action point right now?
  const focusStep = ((): number => {
    const fd = String(result.final_action || result.final_decision || '').toUpperCase()
    if (['READY', 'STRONG_GO', 'GO_SMALL', 'TRADE'].some(v => fd === v))                return 5
    if (['WAIT', 'WAIT_PULLBACK', 'WAIT_BREAKOUT', 'WAIT_FOR_BREAKDOWN', 'AVOID_CHASE'].some(v => fd === v)) return 3
    if (['WATCH', 'WATCH_CALL_OR_DEBIT_SPREAD', 'WATCH_CALL', 'WATCH_PUT'].some(v => fd === v)) return 2
    if (['AVOID', 'EXIT', 'NO_EDGE', 'AVOID_NAKED_CALLS', 'NO_TRADE'].some(v => fd === v)) return 1
    return 5
  })()
  const focusBadgeText = (() => {
    const fd = String(result.final_action || result.final_decision || '').toUpperCase()
    if (['READY', 'STRONG_GO', 'GO_SMALL', 'TRADE'].some(v => fd === v))                return 'Enter'
    if (['WAIT', 'WAIT_PULLBACK', 'WAIT_BREAKOUT', 'WAIT_FOR_BREAKDOWN', 'AVOID_CHASE'].some(v => fd === v)) return 'Wait'
    if (['WATCH', 'WATCH_CALL_OR_DEBIT_SPREAD', 'WATCH_CALL', 'WATCH_PUT'].some(v => fd === v)) return 'Watch'
    if (['AVOID', 'EXIT', 'NO_EDGE', 'AVOID_NAKED_CALLS', 'NO_TRADE'].some(v => fd === v)) return 'Avoid'
    return 'Focus'
  })()
  const focusToneText = execTone === 'green' ? 'text-semantic-bullish'
    : execTone === 'orange' ? 'text-semantic-warning'
    : execTone === 'red' ? 'text-semantic-bearish'
    : 'text-semantic-info'
  const focusBorderLeft = execTone === 'green' ? 'border-l-4 border-l-semantic-bullish'
    : execTone === 'orange' ? 'border-l-4 border-l-semantic-warning'
    : execTone === 'red' ? 'border-l-4 border-l-semantic-bearish'
    : 'border-l-4 border-l-semantic-info'

  // Which of the 4 states is the current market position?
  // WATCH = setup forming, direction not confirmed → State 1 (observe only)
  // WAIT  = direction confirmed, waiting for exact entry trigger → State 2 (entry zone)
  // READY = conditions met, enter now → State 3 (in-play)
  // EXIT  = invalidated or complete → State 4
  const swingActiveState = ((): number => {
    const fd = String(result.final_action || result.final_decision || '').toUpperCase()
    if (fd === 'EXIT') return 4
    if (['READY', 'STRONG_GO', 'GO_SMALL', 'TRADE'].includes(fd)) return 3
    if (['WAIT', 'WAIT_PULLBACK', 'WAIT_BREAKOUT', 'WAIT_FOR_BREAKDOWN', 'AVOID_CHASE'].includes(fd)) return 2
    // WATCH variants and AVOID/NO_EDGE → still in setup/observation phase
    return 1
  })()

  return (
    <div className={`rounded-2xl border border-gray-800 bg-gray-900/70 overflow-hidden ${TONE_RING[toneForFinalAction(result.final_action)]}`}>
      {/* Ticker header */}
      <div className="px-4 pt-3 pb-2 border-b border-gray-800">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-sm font-bold text-white">{result.ticker}</span>
            {result.company_name && <span className="text-[10px] text-gray-500 truncate">{result.company_name}</span>}
            {swingLastPrice != null && (
              <span className="flex items-center gap-1">
                <span className="text-sm font-bold text-white font-mono tabular-nums">${swingLastPrice.toFixed(2)}</span>
                {swingDailyPct != null && swingDailyDollar != null && (
                  <span className={`text-[11px] font-semibold font-mono tabular-nums ${swingDailyDollar >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {swingDailyDollar >= 0 ? '+' : ''}{swingDailyDollar.toFixed(2)} ({swingDailyPct >= 0 ? '+' : ''}{swingDailyPct.toFixed(2)}%)
                  </span>
                )}
              </span>
            )}
            <span className={`text-[11px] font-semibold ${result.bias === 'short' ? 'text-rose-400' : 'text-emerald-400'}`}>
              · {swingActiveState === 4 ? 'Exit Zone' : swingActiveState === 3 ? 'In-Play' : swingActiveState === 2 ? 'Entry Open' : 'Setup'}
            </span>
          </div>
          <div className="text-[10px] text-gray-600 shrink-0">
            {sessionDate && <span>{sessionDate}</span>}
          </div>
        </div>
        {priceStale && priceWarning && (
          <div className="mt-1.5 flex items-start gap-1.5 rounded-lg border border-amber-700/50 bg-amber-900/20 px-2.5 py-1.5 text-[10px] text-amber-300 leading-snug">
            <span className="mt-px shrink-0">⚠</span>
            <span>{priceWarning}</span>
          </div>
        )}
      </div>

      {/* Trade Action Summary header */}
      <div className="px-4 py-3 border-b border-gray-800">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-semantic-accent">Trade Action Summary</div>
        <div className="text-[10px] text-gray-500 mt-0.5">Entry plan, risk profile, and pre-committed exit levels</div>
      </div>

      <div className="px-4 pt-3 pb-2 border-b border-gray-800 space-y-3">

        {/* Verdict section */}
        <div className="rounded-xl border border-gray-800/90 bg-black/15 px-3 py-3">
          <div className="flex items-start justify-between gap-3">
            <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[15px] font-bold uppercase tracking-wide ${TONE_ACTION_BADGE[execTone]}`}>
              {formatSwingEngineLabel(result.final_action)}
            </span>
            <div style={{ position: 'relative', width: 52, height: 52, flexShrink: 0 }}>
              <svg viewBox="0 0 52 52" width={52} height={52} style={{ transform: 'rotate(-90deg)' }}>
                <circle cx={26} cy={26} r={22} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={3} />
                <circle cx={26} cy={26} r={22} fill="none" stroke={execTone === 'green' ? '#10b981' : execTone === 'blue' ? '#3b82f6' : execTone === 'orange' ? '#f59e0b' : '#ef4444'} strokeWidth={3} strokeLinecap="round" strokeDasharray={138.23} strokeDashoffset={138.23 - (Math.min(result.confidence ?? 0, 95) / 95) * 138.23} />
              </svg>
              <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: '#e8ebf0', textAlign: 'center', lineHeight: 1.2 }}>
                {Math.min(result.confidence, 95)}<br /><span style={{ fontSize: 9, color: '#5a6478' }}>CONF</span>
              </div>
            </div>
          </div>
          <div className="mt-2 text-[11px] text-gray-300 leading-relaxed">{execSummary || formatSwingEngineLabel(result.final_action)}</div>
        </div>



        {/* Entry Plan / Risk Profile */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-gray-800/90 bg-black/15 px-3 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-600 mb-2">Entry Plan</div>
            {[
              { label: 'Entry', value: execLevels.breakoutTrigger ? <span className="font-mono font-bold text-emerald-400 text-[12px]">{execLevels.breakoutTrigger}</span> : <span className="font-mono text-amber-400 text-[11px]">Wait — no valid entry yet</span> },
              { label: 'Structure', value: <span className="font-mono text-gray-400 text-[11px]">{formatSwingEngineLabel(result.suggested_strategy || 'NO_TRADE')}</span> },
              { label: 'Stop Loss', value: execLevels.riskBelow ? <span className="font-mono font-bold text-red-400 text-[12px]">{execLevels.riskBelow}</span> : <span className="font-mono text-gray-500 text-[11px]">Not defined until setup forms</span> },
            ].map((row, i) => (
              <div key={row.label} className="flex justify-between items-center py-1 border-b border-gray-800/60 last:border-0">
                <span className="text-[11px] text-gray-500">{row.label}</span>
                <span>{row.value}</span>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-gray-800/90 bg-black/15 px-3 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-600 mb-2">Risk Profile</div>
            {[
              { label: 'R/R Ratio', value: <span className="font-mono text-gray-400 text-[11px]">—</span> },
              { label: 'Risk Level', value: <span className="font-mono font-bold text-red-400 text-[11px]">{result.risk_level}</span> },
              { label: 'RVOL', value: <span className="font-mono text-gray-400 text-[11px]">0.8x</span> },
            ].map((row, i) => (
              <div key={row.label} className="flex justify-between items-center py-1 border-b border-gray-800/60 last:border-0">
                <span className="text-[11px] text-gray-500">{row.label}</span>
                <span>{row.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Exit Plan */}
        <div className="rounded-xl border border-gray-800/90 bg-black/15 px-3 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-600 mb-2">Exit Plan — Pre-Committed</div>
          {(() => {
            const eg = result.entry_guidance as Record<string, unknown> | undefined
            const exitRules = (eg?.exit_rules || result.metrics?.exit_rules) as Array<{ trigger: string; price: number; action: string; note: string }> | undefined
            if (exitRules && exitRules.length > 0) {
              return (
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 border-b border-gray-700/60">
                      <th className="pb-1.5 text-left font-medium">WHEN</th>
                      <th className="pb-1.5 text-right font-medium tabular-nums pr-3">PRICE</th>
                      <th className="pb-1.5 text-left font-medium">ACTION</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/50">
                    {exitRules.map((rule, i) => {
                      const isStop = rule.trigger.toLowerCase().includes('stop')
                      const isTarget1 = rule.trigger.toLowerCase().includes('target 1')
                      const isTarget2 = rule.trigger.toLowerCase().includes('target 2')
                      const isEOD = rule.price === 0
                      const isVwap = rule.trigger.toLowerCase().includes('vwap')
                      const priceCls = isStop ? 'text-red-400' : isTarget2 ? 'text-orange-300' : isTarget1 ? 'text-emerald-400' : isVwap ? 'text-amber-400' : 'text-slate-400'
                      const actionCls = isStop ? 'text-red-300' : isTarget2 ? 'text-orange-200' : isTarget1 ? 'text-emerald-300' : isVwap ? 'text-amber-300' : 'text-gray-200'
                      return (
                        <tr key={i}>
                          <td className="py-2 pr-2 text-gray-400 leading-snug align-top w-[32%]">{rule.trigger}</td>
                          <td className={`py-2 pr-3 text-right font-mono font-bold tabular-nums align-top ${priceCls}`}>
                            {isEOD ? 'NOW' : `$${rule.price.toFixed(2)}`}
                          </td>
                          <td className={`py-2 align-top ${actionCls}`}>{rule.action}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )
            }
            return (
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 border-b border-gray-700/60">
                    <th className="pb-1.5 text-left font-medium">WHEN</th>
                    <th className="pb-1.5 text-right font-medium tabular-nums pr-3">PRICE</th>
                    <th className="pb-1.5 text-left font-medium">ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td colSpan={3} className="py-3 text-center text-gray-500 text-[11px]">Run analysis for detailed exit levels</td></tr>
                </tbody>
              </table>
            )
          })()}
        </div>



        <div className="rounded-xl border border-semantic-accent-border bg-semantic-accent-bg px-3 py-3 space-y-2">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-semantic-accent">
            <BarChart2 size={12} />
            AI Coach Summary
          </div>
          <p className="text-xs text-gray-200 leading-relaxed">{execSummary}</p>
          <div className="text-[11px] text-semantic-accent leading-relaxed">
            Best next action: {bestNextAction}
          </div>
        </div>



      </div>

      {/* ─── Details (collapsible) ─── */}
      <div className="px-4 py-3 border-b border-gray-800">
        <button
          type="button"
          onClick={() => setDetailOpen(p => !p)}
          className="w-full flex items-center justify-between gap-2 bg-transparent border-none cursor-pointer text-left"
        >
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-semantic-accent">Details</div>
            <div className="text-[10px] text-gray-500 mt-0.5">Step-by-step analysis — market context, execution, and risk</div>
          </div>
          <ChevronDown size={14} className={`text-gray-500 transition-transform ${detailOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>

      <div className={`px-4 py-4 border-b border-gray-800 space-y-3${detailOpen ? '' : ' hidden'}${focusStep === 1 ? ` ${focusBorderLeft}` : ''}`}>
        <div>
          <div className="flex items-center gap-2">
            <div className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${focusStep === 1 ? focusToneText : 'text-semantic-info'}`}>Step 1</div>
            {focusStep === 1 && <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest ${TONE_BADGE[execTone]}`}><Activity size={8} />{focusBadgeText}</span>}
          </div>
          <h2 className="mt-1 text-sm font-bold text-white">Market &amp; Price Context</h2>
          <p className="mt-1 text-xs text-gray-400">Is the market helping or fighting this trade?</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
          <ExecMapRow label="Current Price" value={lastPrice != null ? `$${lastPrice.toFixed(2)}` : ''} />
          <ExecMapRow label="Market Strength" value={formatSwingEngineLabel(result.market_bias || result.swing_bias)} tone={toneForExecMap(result.market_bias || result.swing_bias)} />
          <ExecMapRow label="SPY Support" value={spyBias ? formatSwingEngineLabel(spyBias) : ''} tone={toneForExecMap(spyBias || '')} />
          <ExecMapRow label="QQQ Support" value={qqqBias ? formatSwingEngineLabel(qqqBias) : ''} tone={toneForExecMap(qqqBias || '')} />
          <ExecMapRow label="Dist. to MA20" value={distMA20Display ? distMA20Display.text : ''} tone={distMA20Display?.cls} />
          <ExecMapRow label="Trend Phase" value={formatSwingEngineLabel(marketPhase || 'NEUTRAL')} tone={toneForExecMap(marketPhase || '')} />
        </div>
        <div className="rounded-lg border border-gray-800/90 bg-black/15 px-3 py-2 text-xs text-gray-300 leading-relaxed">
          {marketSupportive === 'MARKET_SUPPORTIVE'
            ? `Market backdrop is supportive. ${spyBias ? `SPY is ${formatSwingEngineLabel(spyBias).toLowerCase()}.` : ''} ${distMA20 != null && Math.abs(distMA20) < 3 ? 'Price is near MA20 — ideal base for continuation.' : distMA20 != null && Math.abs(distMA20) > 5 ? 'Price is extended from MA20 — wait for pullback before entry.' : 'Monitor MA20 proximity before committing size.'}`
            : marketSupportive === 'MARKET_WEAK'
            ? `Market context is fighting this trade. ${spyBias ? `SPY is ${formatSwingEngineLabel(spyBias).toLowerCase()}.` : ''} Reduce size and require stronger confirmation before entry.`
            : 'Market context is mixed. Let confirmation from structure and volume matter more than bias alone.'}
        </div>
      </div>

      <div className={`px-4 py-4 border-b border-gray-800 space-y-3${detailOpen ? '' : ' hidden'}${focusStep === 2 ? ` ${focusBorderLeft}` : ''}`}>
        <div>
          <div className="flex items-center gap-2">
            <div className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${focusStep === 2 ? focusToneText : 'text-semantic-info'}`}>Step 2</div>
            {focusStep === 2 && <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest ${TONE_BADGE[execTone]}`}><Activity size={8} />{focusBadgeText}</span>}
          </div>
          <h2 className="mt-1 text-sm font-bold text-white">Technical Analysis</h2>
          <p className="mt-1 text-xs text-gray-400">Trend, momentum, extension, and volatility should all support the trade.</p>
        </div>

        <div ref={signalsSectionRef} className="grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
          <SignalRow label="Trend" value={signalMap.trend} />
          <SignalRow label="Momentum" value={signalMap.momentum} />
          <SignalRow label="RSI" value={signalMap.rsi} />
          <SignalRow label="Volume" value={signalMap.volume} />
          <SignalRow label="Liquidity" value={signalMap.liquidity} />
          <SignalRow label="IV Context" value={signalMap.iv_context} />
          <SignalRow label="Market Align" value={signalMap.market_alignment} />
          <SignalRow label="Extension" value={signalMap.extension} />
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
          {ma20 != null ? <ExecMapRow label="MA20" value={`$${ma20.toFixed(2)}`} /> : null}
          {ma50 != null ? <ExecMapRow label="MA50" value={`$${ma50.toFixed(2)}`} /> : null}
          {typeof m.implied_iv_pct === 'number' ? <ExecMapRow label="IV" value={`${Number(m.implied_iv_pct).toFixed(0)}%`} tone={Number(m.implied_iv_pct) > 40 ? 'text-semantic-bearish' : Number(m.implied_iv_pct) > 25 ? 'text-semantic-warning' : 'text-semantic-bullish'} /> : null}
          {typeof m.hv_20 === 'number' ? <ExecMapRow label="HV20" value={`${Number(m.hv_20).toFixed(0)}%`} tone="text-semantic-accent" /> : null}
          {volumeRatio != null ? <ExecMapRow label="Volume Ratio" value={`${volumeRatio.toFixed(2)}x`} tone={volumeRatio > 1.5 ? 'text-semantic-bullish' : volumeRatio > 0.7 ? 'text-semantic-warning' : 'text-semantic-bearish'} /> : null}
        </div>

        <div className="rounded-xl border border-gray-800/90 bg-black/15 overflow-hidden">
          <button
            type="button"
            onClick={() => setChartsOpen(v => !v)}
            className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left"
          >
            <span>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-600">Decision Charts</div>
              <div className="text-xs text-gray-400 mt-0.5">Charts support the setup, but they do not replace the decision rules.</div>
            </span>
            {chartsOpen ? <ChevronDown size={14} className="text-gray-500" /> : <ChevronRight size={14} className="text-gray-500" />}
          </button>
          {chartsOpen ? (
            <div className="border-t border-gray-800 px-3 py-3 space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {[
                  ['price', 'Price + MA20/MA50'],
                  ['rsi', 'RSI'],
                  ['hv', 'IV/HV'],
                  ['volume', 'Volume'],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setChartTab(value as 'price' | 'rsi' | 'hv' | 'volume')}
                    className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                      chartTab === value
                        ? 'border border-semantic-accent-border bg-semantic-accent-bg text-semantic-accent'
                        : 'border border-border bg-gray-800 text-secondary hover:bg-gray-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <SwingTradeMetricCharts metrics={m} mode={chartTab === 'hv' ? 'hv' : chartTab} />
              {chartTab === 'volume' && volumeLabel ? (
                <div className="text-xs text-gray-400">Volume context: {volumeLabel}</div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className={`px-4 py-4 border-b border-gray-800 space-y-3${detailOpen ? '' : ' hidden'}${focusStep === 3 ? ` ${focusBorderLeft}` : ''}`}>
        <div>
          <div className="flex items-center gap-2">
            <div className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${focusStep === 3 ? focusToneText : 'text-semantic-info'}`}>Step 3</div>
            {focusStep === 3 && <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest ${TONE_BADGE[execTone]}`}><Activity size={8} />{focusBadgeText}</span>}
          </div>
          <h2 className="mt-1 text-sm font-bold text-white">Execution Map</h2>
          <p className="mt-1 text-xs text-gray-400">Where would I enter, where am I wrong, and where is the target?</p>
        </div>
        <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          <ExecMapRow label="Pullback Zone" value={execLevels.pullbackZone || ''} tone="text-semantic-info" />
          <ExecMapRow label="Breakout Trigger" value={execLevels.breakoutTrigger || ''} tone="text-semantic-bullish" />
          <ExecMapRow label="Risk Below" value={execLevels.riskBelow || ''} tone="text-semantic-bearish" />
          <ExecMapRow label="First Target" value={execLevels.firstTarget || ''} tone="text-semantic-bullish" />
          <ExecMapRow label="Stretch Target" value={execLevels.stretchTarget || ''} tone="text-semantic-warning" />
          <ExecMapRow label="DTE Window" value={result.suggested_expiry_window && result.suggested_expiry_window !== 'No trade' ? result.suggested_expiry_window : ''} />
        </div>
      </div>

      <div className={`px-4 py-4 border-b border-gray-800 space-y-3${detailOpen ? '' : ' hidden'}${focusStep === 4 ? ` ${focusBorderLeft}` : ''}`}>
        <div>
          <div className="flex items-center gap-2">
            <div className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${focusStep === 4 ? focusToneText : 'text-semantic-info'}`}>Step 4</div>
            {focusStep === 4 && <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest ${TONE_BADGE[execTone]}`}><Activity size={8} />{focusBadgeText}</span>}
          </div>
          <h2 className="mt-1 text-sm font-bold text-white">Strategy Selection</h2>
          <p className="mt-1 text-xs text-gray-400">Choose the structure that best matches momentum, IV context, and risk appetite.</p>
        </div>
        <div className="grid gap-3 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-xl border border-gray-800/90 bg-black/15 px-3 py-3 space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-600">Selected Structure</div>
            <div className="text-base font-bold text-gray-100">{formatSwingEngineLabel(result.suggested_strategy || 'NO_TRADE')}</div>
            <div className="text-xs text-semantic-accent">{alternativeStructureNote}</div>
            {result.recommended_contract_duration ? (
              <div className="text-[11px] text-gray-500 font-mono">Contract duration: {result.recommended_contract_duration} DTE</div>
            ) : null}
            <ul className="space-y-1 pt-1">
              {structureReasoning.map((item, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[11px] text-gray-400 leading-relaxed">
                  <span className="mt-1.5 h-1 w-1 rounded-full bg-semantic-accent shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="grid gap-2">
            {reasoning.map(block => {
              const borderMap = {
                emerald: 'border-l-emerald-600/50',
                amber: 'border-l-amber-600/50',
                sky: 'border-l-sky-600/50',
                violet: 'border-l-violet-600/50',
              }
              const dotMap = {
                emerald: 'bg-emerald-500',
                amber: 'bg-semantic-warning',
                sky: 'bg-semantic-info',
                violet: 'bg-semantic-accent',
              }
              return (
                <div key={block.title} className={`rounded-lg border border-gray-800/90 bg-black/15 px-3 py-2.5 border-l-2 ${borderMap[block.tone]}`}>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1">{block.title}</div>
                  <ul className="space-y-0.5">
                    {block.items.map((item, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-[11px] text-gray-400 leading-relaxed">
                        <span className={`mt-1.5 h-1 w-1 rounded-full ${dotMap[block.tone]} shrink-0`} />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Weekly Range Exhaustion ── */}
        {(() => {
          const weeklyPct   = typeof m.weekly_range_used_pct === 'number' ? m.weekly_range_used_pct : null
          const weeklyPhase = typeof m.weekly_range_phase === 'string' ? m.weekly_range_phase : null
          if (weeklyPct === null || weeklyPhase === null) return null

          const phaseStyle: Record<string, string> = {
            EXTENDED: 'bg-rose-500/15 border-rose-500/30 text-rose-300',
            LATE:     'bg-amber-500/15 border-amber-500/30 text-amber-300',
            MID:      'bg-sky-500/15 border-sky-500/30 text-sky-300',
            EARLY:    'bg-emerald-500/15 border-emerald-500/30 text-emerald-300',
          }
          const badgeStyle = phaseStyle[weeklyPhase] ?? phaseStyle.MID
          const isWarning = weeklyPhase === 'EXTENDED' || weeklyPhase === 'LATE'

          return (
            <div className="mt-3 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold font-mono ${badgeStyle}`}>
                  {weeklyPct.toFixed(0)}% · {weeklyPhase}
                </span>
                <span className="text-[10px] text-gray-500">5-day range used</span>
              </div>
              {isWarning && (
                <div className={`rounded-lg border px-2.5 py-2 text-[11px] ${weeklyPhase === 'EXTENDED' ? 'border-rose-500/30 bg-rose-500/8 text-rose-300' : 'border-amber-500/30 bg-amber-500/8 text-amber-300'}`}>
                  {weeklyPhase === 'EXTENDED'
                    ? `Weekly range ${weeklyPct.toFixed(0)}% used — extended move. Wait for a pullback before initiating a new position.`
                    : `Weekly range ${weeklyPct.toFixed(0)}% used — late stage. Risk/reward is compressed; size down or wait for confirmation.`}
                </div>
              )}
            </div>
          )
        })()}

        {/* ── Option Entry Suggestion ── */}
        {(() => {
          type SpreadEntry = {
            strategy: string
            long_leg: string
            short_leg: string | null
            long_strike: number
            short_strike: number | null
            expiry: string
            est_debit: number
            width: number | null
            max_gain: number | null
            max_loss: number
            breakeven: number
            entry_note: string
          }
          const se = m.spread_entry as SpreadEntry | null | undefined
          if (!se) return null
          const isSpread = se.short_leg != null
          return (
            <div className="mt-3 rounded-xl border border-violet-500/25 bg-violet-500/8 px-3 py-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="text-[10px] font-bold uppercase tracking-widest text-violet-400">Suggested Entry</div>
                <span className="rounded-md border border-violet-500/30 bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-bold text-violet-300">{se.strategy}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <div className="rounded-lg border border-gray-800 bg-black/20 px-2.5 py-2 min-w-[7rem]">
                  <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-600 mb-0.5">Buy</div>
                  <div className="text-sm font-bold text-emerald-300 font-mono">{se.long_leg}</div>
                </div>
                {isSpread && (
                  <div className="rounded-lg border border-gray-800 bg-black/20 px-2.5 py-2 min-w-[7rem]">
                    <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-600 mb-0.5">Sell</div>
                    <div className="text-sm font-bold text-rose-300 font-mono">{se.short_leg}</div>
                  </div>
                )}
                <div className="rounded-lg border border-gray-800 bg-black/20 px-2.5 py-2 min-w-[6rem]">
                  <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-600 mb-0.5">Expiry</div>
                  <div className="text-sm font-bold text-gray-200 font-mono">{se.expiry}</div>
                </div>
                <div className="rounded-lg border border-gray-800 bg-black/20 px-2.5 py-2 min-w-[5.5rem]">
                  <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-600 mb-0.5">Est. Debit</div>
                  <div className="text-sm font-bold text-amber-300 font-mono">${se.est_debit.toFixed(2)}</div>
                </div>
                {isSpread && se.max_gain != null && (
                  <div className="rounded-lg border border-gray-800 bg-black/20 px-2.5 py-2 min-w-[5.5rem]">
                    <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-600 mb-0.5">Max Gain</div>
                    <div className="text-sm font-bold text-emerald-300 font-mono">${se.max_gain.toFixed(0)}</div>
                  </div>
                )}
                <div className="rounded-lg border border-gray-800 bg-black/20 px-2.5 py-2 min-w-[5.5rem]">
                  <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-600 mb-0.5">Max Loss</div>
                  <div className="text-sm font-bold text-rose-300 font-mono">${se.max_loss.toFixed(0)}</div>
                </div>
                <div className="rounded-lg border border-gray-800 bg-black/20 px-2.5 py-2 min-w-[5.5rem]">
                  <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-600 mb-0.5">Breakeven</div>
                  <div className="text-sm font-bold text-sky-300 font-mono">${se.breakeven.toFixed(2)}</div>
                </div>
              </div>
              <div className="text-[11px] text-violet-300/80">{se.entry_note}</div>
              <div className="text-[10px] text-gray-600">Prices are estimated mid-market at scan time. Verify live before placing order.</div>
            </div>
          )
        })()}
      </div>

      <div className={`px-4 py-4 border-b border-gray-800 space-y-3${detailOpen ? '' : ' hidden'}${focusStep === 5 ? ` ${focusBorderLeft}` : ''}`}>
        <div>
          <div className="flex items-center gap-2">
            <div className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${focusStep === 5 ? focusToneText : 'text-semantic-info'}`}>Step 5</div>
            {focusStep === 5 && <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest ${TONE_BADGE[execTone]}`}><Activity size={8} />{focusBadgeText}</span>}
          </div>
          <h2 className="mt-1 text-sm font-bold text-white">Final Decision</h2>
          <p className="mt-1 text-xs text-gray-400">Translate setup quality into a trader action, not just a market opinion.</p>
        </div>

        <div className="grid gap-3 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-xl border border-gray-800/90 bg-black/15 px-3 py-3 space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-lg border border-gray-800/90 bg-black/15 px-3 py-2 text-center">
                <div className="text-[9px] font-semibold uppercase tracking-widest text-gray-500 mb-1">Decision</div>
                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${TONE_ACTION_BADGE[execTone]}`}>{formatSwingEngineLabel(result.final_action)}</span>
              </div>
              <div className="rounded-lg border border-gray-800/90 bg-black/15 px-3 py-2 text-center">
                <div className="text-[9px] font-semibold uppercase tracking-widest text-gray-500 mb-1">Pullback Risk</div>
                {pullbackProb
                  ? <Badge text={pullbackProb} tone={pullbackProb === 'HIGH' ? 'orange' : pullbackProb === 'LOW' ? 'green' : 'blue'} />
                  : <span className="text-[11px] text-gray-500">—</span>}
              </div>
              <div className="rounded-lg border border-gray-800/90 bg-black/15 px-3 py-2 text-center">
                <div className="text-[9px] font-semibold uppercase tracking-widest text-gray-500 mb-1">R/R Quality</div>
                {rrQuality
                  ? <Badge text={rrQuality} tone={rrQuality === 'STRONG' ? 'green' : rrQuality === 'MODERATE' ? 'blue' : 'orange'} />
                  : <span className="text-[11px] text-gray-500">—</span>}
              </div>
              <div className="rounded-lg border border-gray-800/90 bg-black/15 px-3 py-2 text-center">
                <div className="text-[9px] font-semibold uppercase tracking-widest text-gray-500 mb-1">Risk Level</div>
                <Badge text={result.risk_level} tone={riskBadge?.tone || toneForFinalAction(result.risk_level)} />
              </div>
            </div>
            <div className="text-sm text-gray-200 leading-relaxed">{result.decision_message || bestNextAction}</div>
            {result.avoid_reason ? (
              <div className="flex items-start gap-1.5 text-xs text-semantic-bearish bg-semantic-bearish-bg border border-semantic-bearish-border rounded-lg px-3 py-2">
                <ShieldAlert size={12} className="shrink-0 mt-0.5" />
                {result.avoid_reason}
              </div>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-gray-800/90 bg-black/15 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-gray-500">Conservative Trader</div>
                <div className="mt-1 text-xs text-gray-300">{entryDecision?.conservative || execPlan.preferred}</div>
              </div>
              <div className="rounded-lg border border-gray-800/90 bg-black/15 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-gray-500">Aggressive Trader</div>
                <div className="mt-1 text-xs text-gray-300">{entryDecision?.aggressive || execPlan.aggressive}</div>
              </div>
            </div>
            {executionPersonality ? (
              <div className="rounded-lg border border-gray-800/90 bg-black/15 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-gray-500">Trader Profile</div>
                {executionPersonality.suitable_for?.length ? <div className="mt-1 text-xs text-semantic-bullish">Best for: {executionPersonality.suitable_for.join(', ')}</div> : null}
                {executionPersonality.not_ideal_for?.length ? <div className="mt-1 text-xs text-semantic-warning">Avoid for: {executionPersonality.not_ideal_for.join(', ')}</div> : null}
              </div>
            ) : null}
          </div>

          <div className="rounded-xl border border-semantic-accent-border bg-semantic-accent-bg px-3 py-3 space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-semantic-accent">AI Decision Walkthrough</div>
            <div className="space-y-1.5">
              {walkthroughSteps.map((step, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-gray-200 leading-relaxed">
                  <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full border border-semantic-accent-border bg-semantic-accent-bg text-[10px] font-bold text-semantic-accent shrink-0">{i + 1}</span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className={`px-4 py-4 border-b border-gray-800 space-y-3${detailOpen ? '' : ' hidden'}${focusStep === 6 ? ` ${focusBorderLeft}` : ''}`}>
        <div>
          <div className="flex items-center gap-2">
            <div className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${focusStep === 6 ? focusToneText : 'text-semantic-info'}`}>Step 6</div>
            {focusStep === 6 && <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest ${TONE_BADGE[execTone]}`}><Activity size={8} />{focusBadgeText}</span>}
          </div>
          <h2 className="mt-1 text-sm font-bold text-white">Trade Management Plan</h2>
          <p className="mt-1 text-xs text-gray-400">Plan the response before the trade moves, not after.</p>
        </div>
        <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {riskPanel.map(item => (
            <div key={item.label} className="flex items-center justify-between gap-2 rounded-lg border border-gray-800/90 bg-black/15 px-3 py-2">
              <span className="text-[10px] text-gray-500 font-medium">{item.label}</span>
              <span className={`text-xs font-semibold ${
                item.tone === 'green' ? 'text-semantic-bullish' : item.tone === 'amber' ? 'text-semantic-warning' : item.tone === 'red' ? 'text-semantic-bearish' : 'text-secondary'
              }`}>{item.value}</span>
            </div>
          ))}
        </div>
        <div className="rounded-lg bg-gray-800/30 border border-gray-800/70 px-3 py-2 space-y-2">
          <div className="text-xs text-gray-400 leading-relaxed">{riskExplanation}</div>

          {/* ── Structured exit rules table ── */}
          {exitRules.length > 0 ? (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 border-b border-gray-700/60">
                    <th className="pb-1.5 text-left font-medium">When</th>
                    <th className="pb-1.5 text-right font-medium tabular-nums pr-3">At Price</th>
                    <th className="pb-1.5 text-left font-medium">Do This</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/50">
                  {exitRules.map((rule, i) => {
                    const isStop   = rule.trigger.toLowerCase().includes('stop loss')
                    const isTarget1 = rule.trigger.toLowerCase().includes('target 1')
                    const isTarget2 = rule.trigger.toLowerCase().includes('target 2')
                    const isClose  = rule.trigger.toLowerCase().includes('close') || rule.trigger.toLowerCase().includes('loses') || rule.trigger.toLowerCase().includes('reclaims')
                    const priceCls = isStop ? 'text-red-400' : isTarget2 ? 'text-orange-300' : isTarget1 ? 'text-emerald-400' : isClose ? 'text-amber-400' : 'text-slate-300'
                    const actionCls = isStop ? 'text-red-300' : isTarget2 ? 'text-orange-200' : isTarget1 ? 'text-emerald-300' : isClose ? 'text-amber-300' : 'text-gray-200'
                    return (
                      <tr key={i} className="group">
                        <td className="py-2 pr-2 text-gray-400 leading-snug align-top w-[30%]">{rule.trigger}</td>
                        <td className={`py-2 pr-3 text-right font-mono font-bold tabular-nums align-top ${priceCls}`}>
                          ${rule.price.toFixed(2)}
                        </td>
                        <td className="py-2 align-top">
                          <div className={`font-semibold leading-snug ${actionCls}`}>{rule.action}</div>
                          <div className="text-[10px] text-gray-500 leading-snug mt-0.5">{rule.note}</div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="space-y-1.5">
              {tradeMgmt.map((item, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-gray-300 leading-relaxed">
                  <span className="mt-1.5 h-1 w-1 rounded-full bg-semantic-accent shrink-0" />
                  {item}
                </div>
              ))}
            </div>
          )}
        </div>
        {contextualAlerts.length > 0 ? (
          <div className="rounded-lg border border-semantic-warning-border bg-semantic-warning-bg px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-semantic-warning">Alert Recommendations</div>
            <div className="mt-1 space-y-1">
              {contextualAlerts.map((alert, i) => (
                <div key={`${alert.type || 'alert'}-${i}`} className="text-xs text-semantic-warning">
                  {alert.message || alert.condition || alert.type || 'Alert condition available'}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {result.risk_flags.length > 0 ? (
        <div className="px-4 py-2.5 border-b border-gray-800">
          <div className="flex flex-wrap gap-1.5">
            {result.risk_flags.map(f => <RiskFlagPill key={f} flag={f} />)}
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setDetailOpen(v => !v)}
        className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-left text-xs font-semibold text-gray-500 hover:bg-gray-800/40 border-b border-gray-800 transition-colors"
      >
        <span>Trade Details</span>
        {detailOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>

      {detailOpen ? (
        <div className="px-4 py-3 border-b border-gray-800 space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-gray-800/60 px-3 py-2.5">
              <div className="text-[9px] uppercase tracking-wide text-gray-600 mb-0.5">Suggested Strategy</div>
              <div className={`text-sm font-bold ${result.suggested_strategy === 'NO_TRADE' ? 'text-gray-500' : 'text-gray-100'}`}>{formatSwingEngineLabel(result.suggested_strategy)}</div>
            </div>
            <div className="rounded-xl bg-gray-800/60 px-3 py-2.5">
              <div className="text-[9px] uppercase tracking-wide text-gray-600 mb-0.5">Suggested Expiry</div>
              <div className={`text-sm font-bold ${result.suggested_expiry_window === 'No trade' ? 'text-gray-500' : 'text-gray-100'}`}>{result.suggested_expiry_window}</div>
            </div>
          </div>
          {(spyBias || qqqBias) ? (
            <div className="rounded-xl bg-gray-800/40 px-3 py-2 space-y-1">
              <div className="text-[9px] uppercase tracking-wide text-gray-600 mb-0.5">Market Context</div>
              {spyBias ? <div className="flex justify-between items-center"><span className="text-gray-500">SPY bias</span><Badge text={spyBias} tone={toneForBias(spyBias)} /></div> : null}
              {qqqBias ? <div className="flex justify-between items-center"><span className="text-gray-500">QQQ bias</span><Badge text={qqqBias} tone={toneForBias(qqqBias)} /></div> : null}
            </div>
          ) : null}
          {result.confirmation_needed.length > 0 ? (
            <div>
              <div className="text-[9px] uppercase tracking-wide text-gray-600 mb-1.5">Confirmation Needed</div>
              <div className="space-y-1">
                {result.confirmation_needed.map((c, i) => (
                  <div key={i} className="flex items-start gap-2 text-gray-400 leading-relaxed">
                    <Clock size={11} className="shrink-0 mt-0.5 text-semantic-warning" />
                    {c}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setSignalsOpen(v => !v)}
        className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-left text-xs font-semibold text-gray-500 hover:bg-gray-800/40 border-b border-gray-800 transition-colors"
      >
        <span>Raw Signals ({result.reasons.length})</span>
        {signalsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>

      {signalsOpen ? (
        <div className="px-4 pb-4 pt-1 space-y-1.5">
          {result.reasons.map((r, i) => {
            const bullishReason = r.startsWith('STRONG GO') || r.startsWith('GO —') || r.includes('bullish') || r.includes('above')
            const bearishReason = r.startsWith('NO-GO') || r.includes('bearish') || r.includes('below') || r.includes('oversold') || r.includes('overbought')
            return (
              <div key={i} className="flex items-start gap-2 text-xs text-gray-400 leading-relaxed">
                {bullishReason && !bearishReason ? (
                  <CheckCircle2 size={12} className="shrink-0 mt-0.5 text-semantic-bullish" />
                ) : bearishReason && !bullishReason ? (
                  <ShieldAlert size={12} className="shrink-0 mt-0.5 text-semantic-bearish" />
                ) : (
                  <Minus size={12} className="shrink-0 mt-0.5 text-gray-600" />
                )}
                <span>{r}</span>
              </div>
            )
          })}
        </div>
      ) : null}

      <div className="px-4 py-2.5 border-b border-gray-800 bg-gray-950/25">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-gray-600">
          <span>Quality {result.trade_quality_score}/10</span>
          <span className="text-gray-800">|</span>
          <span>Bias: {formatSwingEngineLabel(result.swing_bias)}</span>
          <span className="text-gray-800">|</span>
          <span>Risk: {formatSwingEngineLabel(result.risk_state)}</span>
          {result.setup_quality ? (
            <>
              <span className="text-gray-800">|</span>
              <span>Setup: {formatSwingEngineLabel(result.setup_quality)}</span>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
