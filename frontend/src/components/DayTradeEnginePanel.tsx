import { useRef, useState } from 'react'
import {
  AlertTriangle, BriefcaseBusiness, Check, CheckCircle, RefreshCw, PlusCircle, Bell, BarChart2, Search, Star,
  TrendingUp, TrendingDown, Minus, ChevronDown, ChevronRight, ShieldAlert,
  Activity, Target, Zap, Info, Layers,
} from 'lucide-react'
import type { AiCoachResult, DayTradeScanResult } from '../api/client'
import type { PortfolioPosition } from '../types'
import DayTradeIntradayChart, { parseChartBars } from './DayTradeIntradayChart'
import { coerceTraderDecision, DayTradeTraderDecisionExpanded } from './DayTradeTraderDecision'
import { getActionButtonClass, getDecisionBadgeClass, getMarketContextBadgeClass, getProfitLossTextClass } from '../utils/semanticTrading'
import { MarketTimeGateBanner } from './MarketTimeGate'

// ─── Helpers ────────────────────────────────────────────────────────

function asFiniteNum(x: unknown): number | null {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null
  if (typeof x === 'string' && x.trim() !== '') {
    const n = Number(x)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function fmtPct(x: unknown) {
  const n = asFiniteNum(x)
  return n === null ? null : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

function fmtNum(x: unknown, d = 2) {
  const n = asFiniteNum(x)
  return n === null ? null : n.toFixed(d)
}

type Tone = 'green' | 'blue' | 'orange' | 'red' | 'gray'

const TONE_BADGE: Record<Tone, string> = {
  green: getDecisionBadgeClass('READY'),
  blue: getDecisionBadgeClass('GO'),
  orange: getDecisionBadgeClass('WATCH'),
  red: getDecisionBadgeClass('AVOID'),
  gray: getDecisionBadgeClass('NEUTRAL'),
}

function toneForDecision(v: string): Tone {
  const d = v.toUpperCase()
  if (d === 'READY' || d === 'STRONG GO' || d === 'STRONG_BUY' || d === 'STRONG BUY') return 'green'
  if (d === 'WATCH' || d === 'GO' || d === 'BUY') return 'blue'
  if (d === 'WAIT' || d === 'HOLD' || d === 'AVOID_CHASE') return 'orange'
  if (d === 'AVOID' || d === 'NO-GO' || d === 'NO_EDGE' || d === 'NO GO') return 'red'
  return 'gray'
}

function toneForRisk(v: string): Tone {
  const r = v.toUpperCase()
  if (r === 'LOW') return 'green'
  if (r === 'MEDIUM') return 'blue'
  if (r === 'HIGH' || r === 'VERY_HIGH') return 'orange'
  if (r === 'EXTREME') return 'red'
  return 'gray'
}

function Badge({ text, tone }: { text: string; tone: Tone }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold leading-none ${TONE_BADGE[tone]}`}>
      {text}
    </span>
  )
}

function ExecMapRow({ label, value, tone }: { label: string; value: string | null; tone?: string }) {
  if (!value) return null
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-800/90 bg-black/15 px-3 py-2">
      <span className="text-[10px] uppercase tracking-wide text-gray-500">{label}</span>
      <span className={`text-xs font-semibold font-mono tabular-nums ${tone || 'text-gray-200'}`}>{value}</span>
    </div>
  )
}

function SignalRow({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-gray-800/40 px-3 py-1.5">
      <span className="text-[11px] text-gray-500 font-medium">{label}</span>
      <Badge text={value} tone={tone} />
    </div>
  )
}

function signedPctClass(n: number | null): string {
  return getProfitLossTextClass(n)
}

function vixClass(n: number | null): Tone {
  if (n === null) return 'gray'
  if (n >= 30) return 'red'
  if (n <= 18) return 'green'
  return 'blue'
}

function toneForOptionRisk(value: string): Tone {
  const risk = String(value || '').toUpperCase()
  if (risk === 'HIGH') return 'red'
  if (risk === 'MEDIUM') return 'orange'
  if (risk === 'LOW') return 'green'
  return 'gray'
}

function optionRiskLabel(key: 'theta_risk' | 'gamma_risk' | 'iv_risk' | 'liquidity_risk'): string {
  if (key === 'theta_risk') return 'Theta'
  if (key === 'gamma_risk') return 'Gamma'
  if (key === 'iv_risk') return 'IV'
  return 'Liquidity'
}

function optionRiskChrome(warning: string, hasOptions: boolean): string {
  if (!hasOptions) return 'border-gray-800/90 bg-black/15'
  const upper = String(warning || '').toUpperCase()
  if (upper.includes('HIGH') || upper.includes('POOR LIQUIDITY')) return 'border-semantic-bearish-border bg-semantic-bearish-bg'
  if (upper.includes('MODERATE') || upper.includes('FAIR LIQUIDITY') || upper.includes('ELEVATED')) return 'border-semantic-warning-border bg-semantic-warning-bg'
  return 'border-semantic-info-border bg-semantic-info-bg'
}

// ─── Signal breakdown builder ───────────────────────────────────────

type SignalMap = Record<string, { text: string; tone: Tone } | null>

function computeSignals(result: DayTradeScanResult, m: Record<string, unknown>): SignalMap {
  const confRaw = m.confidence
  const confidence = confRaw && typeof confRaw === 'object' && !Array.isArray(confRaw)
    ? confRaw as Record<string, string> : null
  const vwapDist = asFiniteNum(m.vwap_dist_pct)
  const mom = asFiniteNum(m.momentum_pct)
  const volSpike = !!m.volume_spike
  const rsN = asFiniteNum(m.rs_vs_qqq_pct)
  const orBreakout = String(m.or_breakout ?? '').toUpperCase()

  const trendVal = confidence?.trend_strength ?? null
  const breakoutVal = confidence?.breakout_quality ?? null
  const volVal = confidence?.volume_confirmation ?? null
  const marketVal = confidence?.market_alignment ?? null
  const riskVal = confidence?.risk ?? null

  const toneForConf = (key: string, val: string): Tone => {
    if (val === 'HIGH' || val === 'STRONG' || val === 'GOOD') return 'green'
    if (val === 'MEDIUM' || val === 'FAIR') return 'blue'
    if (val === 'LOW' || val === 'WEAK' || val === 'POOR') return 'orange'
    return 'gray'
  }

  return {
    trend_strength: trendVal ? { text: trendVal, tone: toneForConf('trend_strength', trendVal) } : null,
    breakout_quality: breakoutVal ? { text: breakoutVal, tone: toneForConf('breakout_quality', breakoutVal) } : null,
    volume_confirmation: volVal ? { text: volVal, tone: toneForConf('volume_confirmation', volVal) } : null,
    market_alignment: marketVal ? { text: marketVal, tone: toneForConf('market_alignment', marketVal) } : null,
    risk: riskVal ? { text: riskVal, tone: toneForRisk(riskVal) } : null,
    vwap_position: vwapDist != null
      ? { text: vwapDist >= 0 ? 'Above VWAP' : 'Below VWAP', tone: vwapDist >= 0 ? 'green' : 'red' }
      : null,
    momentum: mom != null
      ? { text: `${mom >= 0 ? '+' : ''}${mom.toFixed(1)}%`, tone: mom > 0 ? 'green' : mom < 0 ? 'red' : 'gray' }
      : null,
    volume: volSpike
      ? { text: 'Confirmed', tone: 'green' }
      : { text: 'Normal', tone: 'blue' },
    relative_strength: rsN != null
      ? { text: rsN >= 0 ? 'Positive' : 'Negative', tone: rsN >= 0 ? 'green' : 'red' }
      : null,
    or_position: orBreakout
      ? { text: orBreakout.replace(/_/g, ' '), tone: orBreakout === 'ABOVE' ? 'green' : orBreakout === 'BELOW' ? 'red' : 'blue' }
      : null,
  }
}

// ─── Reasoning builder ──────────────────────────────────────────────

type ReasoningBlock = {
  title: string
  items: string[]
  tone: 'emerald' | 'amber' | 'sky' | 'violet'
}

function computeReasoning(result: DayTradeScanResult, m: Record<string, unknown>): ReasoningBlock[] {
  const blocks: ReasoningBlock[] = []
  const vwapDist = asFiniteNum(m.vwap_dist_pct)
  const mom = asFiniteNum(m.momentum_pct)
  const volSpike = !!m.volume_spike
  const rsN = asFiniteNum(m.rs_vs_qqq_pct)
  const orBreakout = String(m.or_breakout ?? '').toUpperCase()
  const marketBias = result.market_bias

  // WHY THIS TRADE
  const whyTrade: string[] = []
  if (marketBias) {
    whyTrade.push(`Market bias: ${marketBias.replace(/_/g, ' ')}`)
  }
  if (volSpike) whyTrade.push('Volume spike confirms participation')
  if (vwapDist != null && vwapDist > 0) whyTrade.push('Price positioned above VWAP — bullish intraday bias')
  if (rsN != null && rsN > 0) whyTrade.push(`Relative strength vs QQQ positive (${rsN >= 0 ? '+' : ''}${rsN.toFixed(2)}%)`)
  if (orBreakout === 'ABOVE') whyTrade.push('Breakout above opening range — momentum expanding')
  if (result.supporting_factors.length > 0) whyTrade.push(...result.supporting_factors.slice(0, 2))
  if (whyTrade.length === 0 && result.reason) whyTrade.push(result.reason)
  if (whyTrade.length > 0) blocks.push({ title: 'WHY THIS TRADE', items: whyTrade, tone: 'emerald' })

  // WHY THIS EXECUTION
  const whyExec: string[] = []
  if (result.execution_timing) {
    whyExec.push(`Execution state: ${result.execution_timing.replace(/_/g, ' ')}`)
  }
  if (result.entry_guidance?.action) {
    whyExec.push(result.entry_guidance.action)
  }
  if (result.missing_confirmations.length > 0) {
    whyExec.push(...result.missing_confirmations.slice(0, 2).map(c => `Waiting: ${c}`))
  }
  if (vwapDist != null && vwapDist < 0) whyExec.push('Price below VWAP — wait for reclamation before entry')
  if (mom != null && mom > 2) whyExec.push('Momentum extended — avoid chasing at current levels')
  if (whyExec.length > 0) blocks.push({ title: 'WHY THIS EXECUTION', items: whyExec, tone: 'sky' })

  // WHY THIS STRUCTURE
  const whyStruct: string[] = []
  if (result.bias === 'long') whyStruct.push('Bullish bias — call structures preferred')
  if (result.bias === 'short') whyStruct.push('Bearish bias — put structures preferred')
  const vix = asFiniteNum(m.vix)
  if (vix != null) {
    if (vix > 25) whyStruct.push('Elevated VIX — spreads define risk, consider debit spreads')
    else whyStruct.push('Benign VIX — directional premium reasonable')
  }
  blocks.push({ title: 'WHY THIS STRUCTURE', items: whyStruct, tone: 'violet' })

  // RISK NOTES
  const riskNotes: string[] = []
  if (result.risk_reason) riskNotes.push(result.risk_reason)
  if (result.explanation?.main_risk) riskNotes.push(result.explanation.main_risk)
  if (mom != null && Math.abs(mom) > 1.5) riskNotes.push(`Momentum at ${mom >= 0 ? '+' : ''}${mom.toFixed(1)}% — extension risk`)
  if (result.entry_guidance?.avoid) riskNotes.push(result.entry_guidance.avoid)
  if (vwapDist != null && vwapDist < -0.5) riskNotes.push('Price significantly below VWAP — breakdown risk')
  if (riskNotes.length === 0) riskNotes.push('No material risk flags — standard intraday position management applies')
  blocks.push({ title: 'RISK NOTES', items: riskNotes, tone: 'amber' })

  return blocks
}

// ─── Risk panel builder ─────────────────────────────────────────────

type RiskItem = { label: string; value: string; tone: 'green' | 'amber' | 'red' | 'gray' }

function computeRiskPanel(result: DayTradeScanResult, m: Record<string, unknown>): RiskItem[] {
  const items: RiskItem[] = []
  const vwapDist = asFiniteNum(m.vwap_dist_pct)
  const mom = asFiniteNum(m.momentum_pct)
  const vix = asFiniteNum(m.vix)
  const volSpike = !!m.volume_spike
  const orBreakout = String(m.or_breakout ?? '').toUpperCase()

  const riskTone: 'green' | 'amber' | 'red' | 'gray' = (() => {
    const r = result.risk_state?.toUpperCase()
    if (r === 'LOW') return 'green'
    if (r === 'MEDIUM' || r === 'HIGH' || r === 'VERY_HIGH') return 'amber'
    if (r === 'EXTREME') return 'red'
    return 'gray'
  })()
  items.push({
    label: 'Overall Risk',
    value: result.risk_state ? result.risk_state.replace(/_/g, ' ') : '—',
    tone: riskTone,
  })

  items.push({
    label: 'Momentum Risk',
    value: mom != null && Math.abs(mom) > 1.5 ? 'Elevated' : 'Manageable',
    tone: mom != null && Math.abs(mom) > 1.5 ? 'amber' : 'green',
  })

  items.push({
    label: 'Breakout Failure',
    value: orBreakout === 'ABOVE' || orBreakout === 'BELOW' ? 'Low' : 'Moderate',
    tone: orBreakout === 'ABOVE' || orBreakout === 'BELOW' ? 'green' : 'amber',
  })

  items.push({
    label: 'Extended Move',
    value: mom != null && mom > 2 ? 'High' : mom != null && mom < -2 ? 'High' : 'Low',
    tone: mom != null && Math.abs(mom) > 2 ? 'red' : 'green',
  })

  items.push({
    label: 'Volume Fade',
    value: volSpike ? 'Low' : 'Possible',
    tone: volSpike ? 'green' : 'amber',
  })

  const vixRiskTone: 'green' | 'amber' | 'red' | 'gray' = vix == null ? 'gray' : vix >= 30 ? 'red' : vix <= 18 ? 'green' : 'amber'
  items.push({
    label: 'VIX Context',
    value: vix != null ? `${vix.toFixed(1)}` : '—',
    tone: vixRiskTone,
  })

  return items
}

function formatLabel(value: string | null | undefined): string {
  if (!value) return '—'
  return value.replace(/_/g, ' ')
}

function normalizedActionState(value: string | null | undefined): string {
  const v = String(value || '').toUpperCase()
  if (!v) return 'WAIT'
  if (v.includes('READY') || v.includes('STRONG GO') || v === 'GO') return 'READY'
  if (v.includes('WATCH')) return 'WATCH'
  if (v.includes('WAIT') || v.includes('CONDITIONAL')) return 'WAIT'
  if (v.includes('EXTENDED') || v.includes('AVOID_CHASE')) return 'EXTENDED'
  if (v.includes('EXIT') || v.includes('AVOID') || v.includes('NO GO') || v.includes('NO-GO') || v.includes('NO_EDGE')) return 'AVOID'
  if (v.includes('MANAGE')) return 'MANAGE'
  return 'WAIT'
}

function actionTone(value: string | null | undefined): Tone {
  const state = normalizedActionState(value)
  if (state === 'READY') return 'green'
  if (state === 'WATCH') return 'blue'
  if (state === 'WAIT' || state === 'EXTENDED') return 'orange'
  if (state === 'AVOID') return 'red'
  return 'gray'
}

function actionButtonClass(tone: Tone): string {
  if (tone === 'green' || tone === 'blue') return getActionButtonClass('trade')
  if (tone === 'orange' || tone === 'red') return getActionButtonClass('surface')
  return getActionButtonClass('surface')
}

function toneForExecText(value: string | null | undefined): string {
  const tone = actionTone(value)
  if (tone === 'green') return 'text-semantic-bullish'
  if (tone === 'blue') return 'text-semantic-info'
  if (tone === 'orange') return 'text-semantic-warning'
  if (tone === 'red') return 'text-semantic-bearish'
  return 'text-secondary'
}

function computeIntradaySummary(result: DayTradeScanResult, m: Record<string, unknown>): string {
  const parts: string[] = []
  const vwapDist = asFiniteNum(m.vwap_dist_pct)
  const mom = asFiniteNum(m.momentum_pct)
  const volSpike = !!m.volume_spike
  const marketBias = formatLabel(result.market_bias).toLowerCase()
  const pullbackProb = formatLabel(result.entry_guidance?.pullback_probability).toLowerCase()
  const shouldEnter = String(result.entry_guidance?.should_enter_now || '').toUpperCase()
  const isShort = result.bias === 'short'

  parts.push(
    result.market_bias
      ? `Market bias is ${marketBias}.`
      : 'Market context is mixed.'
  )

  if (vwapDist != null) {
    if (isShort) {
      parts.push(
        vwapDist <= 0
          ? 'Price is below VWAP — the bearish structure is in place.'
          : 'Price is still above VWAP, so the short setup needs VWAP to break first.'
      )
    } else {
      parts.push(
        vwapDist >= 0
          ? 'Price is holding above VWAP, so intraday structure is constructive.'
          : 'Price is below VWAP, so a reclaim is needed before the long setup confirms.'
      )
    }
  }

  const orBreakoutCoach = String(m.or_breakout || '').toUpperCase()
  if (isShort) {
    if (orBreakoutCoach === 'BELOW') {
      parts.push('Price broke below the opening range low — downside continuation is favored.')
    } else if (orBreakoutCoach === 'ABOVE') {
      parts.push('Price is above the opening range — wait for a rejection and breakdown before shorting.')
    } else {
      parts.push('Price is inside the opening range — wait for a clean breakdown below ORL.')
    }
  } else {
    if (orBreakoutCoach === 'ABOVE') {
      parts.push('The ticker is trading above the opening range high, which supports continuation.')
    } else if (orBreakoutCoach === 'BELOW') {
      parts.push('Price is below the opening range — a reclaim of ORL is needed before going long.')
    } else {
      parts.push('Opening-range breakout is not yet confirmed.')
    }
  }

  if (volSpike) {
    parts.push('Volume is confirming the move.')
  } else {
    parts.push('Volume is not fully confirming yet.')
  }

  if (shouldEnter === 'YES') {
    parts.push(isShort
      ? 'Execution is ready — breakdown and structure align.'
      : 'Execution is ready if VWAP support remains intact.')
  } else if (shouldEnter === 'CONDITIONAL') {
    parts.push('Execution is conditional — wait for the next confirmation candle.')
  } else {
    parts.push('Execution is not ready yet. Patience is the trade.')
  }

  if (mom != null && Math.abs(mom) > 2) {
    parts.push('Momentum is extended — protect against chase risk.')
  } else if (pullbackProb && pullbackProb !== '—') {
    parts.push(`Pullback probability is ${pullbackProb}.`)
  }

  return parts.join(' ')
}

function computeBestNextStep(result: DayTradeScanResult): string {
  const eg = result.entry_guidance
  const decision = eg?.entry_decision as Record<string, string> | undefined
  if (decision?.best_setup) return decision.best_setup
  if (eg?.pending_confirmations?.length) return eg.pending_confirmations[0] || eg.action || result.reason
  if (eg?.action) return eg.action
  return result.reason
}

function computeIntradayManagementPlan(result: DayTradeScanResult, m: Record<string, unknown>): string[] {
  const items: string[] = []
  const vwapDist = asFiniteNum(m.vwap_dist_pct)
  const mom = asFiniteNum(m.momentum_pct)
  const volSpike = !!m.volume_spike
  const orBreakout = String(m.or_breakout || '').toUpperCase()
  const eg = result.entry_guidance
  const isShort = result.bias === 'short'

  if (orBreakout === 'ABOVE' || orBreakout === 'BELOW') {
    items.push(isShort
      ? 'If the breakdown extends, scale into weakness and keep the stop anchored above the trigger level.'
      : 'If the breakout extends, scale into strength and keep the stop anchored to the breakout level.')
  }
  if (isShort) {
    items.push(vwapDist != null && vwapDist <= 0
      ? 'If price reclaims VWAP after entry, cut size immediately — the breakdown thesis is invalidated.'
      : 'If price fails to break below VWAP, do not force entry; wait for the structure to develop.')
  } else {
    items.push(vwapDist != null && vwapDist >= 0
      ? 'If VWAP fails after entry, cut size quickly instead of hoping for a second breakout.'
      : 'If price reclaims VWAP cleanly, reassess whether execution readiness improves.')
  }
  if (!volSpike) {
    items.push(isShort
      ? 'If volume stays weak, avoid adding to the short even if price drifts lower — low-volume drops reverse fast.'
      : 'If volume stays weak, avoid adding size even if price drifts higher.')
  } else {
    items.push(isShort
      ? 'If volume fades after the entry candle, tighten stops above the most recent resistance.'
      : 'If volume fades after the entry candle, tighten stops under the most recent support.')
  }
  if (mom != null && Math.abs(mom) > 2) {
    items.push('If extension keeps increasing, protect profits early and avoid turning an intraday trade into a hope trade.')
  } else {
    items.push('If momentum cools while structure holds, partial scale-outs are fine before reloading on confirmation.')
  }
  if (eg?.avoid) {
    items.push(`Avoid: ${eg.avoid}`)
  } else {
    items.push(isShort
      ? 'If price reclaims above the breakdown trigger and closes there, the short thesis is broken — step aside.'
      : 'If the opening range rejects and price cannot reclaim the trigger, step aside and wait for a new setup.')
  }
  return items
}

function buildDayWalkthrough(result: DayTradeScanResult, m: Record<string, unknown>): string[] {
  const marketBias = formatLabel(result.market_bias)
  const vwapDist = asFiniteNum(m.vwap_dist_pct)
  const volSpike = !!m.volume_spike
  const orBreakout = String(m.or_breakout || '').toUpperCase()
  const optionRisk = result.option_risk_context
  const exec = String(result.entry_guidance?.should_enter_now || '').toUpperCase()
  const steps: string[] = []

  const isShortWalk = result.bias === 'short'
  steps.push(result.market_bias ? `Market is ${marketBias.toLowerCase()}.` : 'Market context is mixed.')
  steps.push(
    isShortWalk
      ? vwapDist != null && vwapDist <= 0
        ? 'Price is below VWAP — bearish intraday structure is confirmed.'
        : 'Price is still above VWAP, so the short structure is not yet confirmed.'
      : vwapDist != null && vwapDist >= 0
        ? 'Price is holding above VWAP, so intraday structure is constructive.'
        : 'Price is not holding above VWAP yet, so structure is still fragile.'
  )
  steps.push(
    orBreakout === 'ABOVE'
      ? isShortWalk
        ? 'Price broke above the opening range — watch for a rejection back inside before shorting.'
        : 'The breakout is present, but it still needs continuation quality.'
      : orBreakout === 'BELOW'
        ? isShortWalk
          ? 'Breakdown is confirmed below ORL — follow-through volume seals the entry.'
          : 'Breakdown pressure exists below the opening range.'
        : isShortWalk
          ? 'Price is still inside the opening range — wait for a breakdown below ORL.'
          : 'Opening-range confirmation is still missing.'
  )
  steps.push(
    volSpike
      ? 'Volume is confirming the move, so execution quality improves.'
      : 'Volume is not expanding yet, so the safer entry comes after confirmation.'
  )
  if (optionRisk?.option_execution_warning) {
    steps.push(optionRisk.option_execution_warning)
  }
  steps.push(
    exec === 'YES'
      ? 'Execution is allowed now, but intraday risk still requires a tight invalidation.'
      : exec === 'CONDITIONAL'
        ? 'Entry is conditional, so wait for the trigger candle before committing size.'
        : 'Execution is not ready yet, so patience is the trade.'
  )
  return steps
}

function buildSeriesPath(values: number[], width: number, height: number): string {
  if (values.length === 0) return ''
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  return values
    .map((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * width
      const y = height - ((value - min) / range) * height
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')
}

function MiniLineChart({
  values,
  stroke,
  fill,
}: {
  values: number[]
  stroke: string
  fill?: string
}) {
  if (values.length < 2) {
    return <div className="rounded-lg border border-gray-800/80 bg-black/20 px-3 py-6 text-xs text-gray-500">Not enough data.</div>
  }

  const width = 560
  const height = 180
  const path = buildSeriesPath(values, width, height)
  return (
    <div className="rounded-xl border border-gray-800/80 bg-black/20 p-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="block h-44 w-full" role="img" aria-label="Decision support chart">
        <path d={path} fill="none" stroke={stroke} strokeWidth={3} strokeLinecap="round" />
        {fill ? <path d={`${path} L ${width} ${height} L 0 ${height} Z`} fill={fill} opacity={0.18} /> : null}
      </svg>
    </div>
  )
}

function MiniBarChart({
  values,
  color,
  avgRef,
}: {
  values: number[]
  color: string
  /** Historical average volume for this time of day (same units as values). */
  avgRef?: number
}) {
  if (values.length < 2) {
    return <div className="rounded-lg border border-gray-800/80 bg-black/20 px-3 py-6 text-xs text-gray-500">Not enough data.</div>
  }
  const hasAvg = avgRef != null && avgRef > 0
  // Scale bars to their own max — don't let avgRef inflate the scale and squish bars
  const max = Math.max(...values, 1)
  // If avgRef > max of bars, cap line at 96% (off the top = all below avg today)
  const avgPct = hasAvg ? Math.min(96, (avgRef / max) * 100) : null

  return (
    <div className="rounded-xl border border-gray-800/80 bg-black/20 p-3">
      <div className="relative flex h-44 items-end gap-[2px]">
        {values.map((value, index) => {
          const aboveAvg = hasAvg ? value >= avgRef : true
          return (
            <div
              key={`${index}-${value}`}
              className="flex-1 rounded-t-sm"
              style={{
                height: `${Math.max(6, (value / max) * 100)}%`,
                background: aboveAvg ? 'var(--chart-line-iv)' : color,
                opacity: aboveAvg ? 0.88 : 0.45,
              }}
            />
          )
        })}
        {avgPct != null && (
          <div
            className="pointer-events-none absolute inset-x-0"
            style={{ bottom: `${avgPct}%` }}
          >
            <svg width="100%" height="1" className="overflow-visible">
              <line
                x1="0" y1="0" x2="100%" y2="0"
                stroke="rgb(251 191 36 / 0.80)"
                strokeWidth="1.5"
                strokeDasharray="5 3"
              />
            </svg>
            <span className="absolute right-0 -top-4 whitespace-nowrap rounded bg-black/75 px-1 py-0.5 text-[9px] font-semibold text-amber-300">
              avg
            </span>
          </div>
        )}
      </div>
      {avgPct != null && (
        <div className="mt-2 flex items-center gap-1.5 text-[10px]">
          <svg width="16" height="6" className="shrink-0 overflow-visible">
            <line x1="0" y1="3" x2="16" y2="3" stroke="rgb(251 191 36 / 0.75)" strokeWidth="1.5" strokeDasharray="4 2" />
          </svg>
          <span className="text-amber-400/80">avg vol for time of day</span>
          <span className="ml-auto flex items-center gap-1 text-gray-400">
            <span className="text-cyan-400">■</span> above avg
            <span className="ml-1 text-gray-500">■</span> below avg
          </span>
        </div>
      )}
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────────────

interface Props {
  result: DayTradeScanResult
  existingPositions?: PortfolioPosition[]
  onRefresh?: () => void
  refreshing?: boolean
  showRefresh?: boolean
  onRequestEnterActiveTrade?: () => void
  onAddToPortfolio?: () => void
  onViewPositions?: () => void
  onOpenStrategyFinder?: () => void
  onOpenCommandCenter?: () => void
  onCreateAlert?: () => void
  onViewSignals?: () => void
  onAddToWatchlist?: () => void
}

export default function DayTradeEnginePanel({
  result,
  existingPositions = [],
  onRefresh,
  refreshing,
  showRefresh = true,
  onRequestEnterActiveTrade,
  onAddToPortfolio,
  onViewPositions,
  onOpenStrategyFinder,
  onOpenCommandCenter,
  onCreateAlert,
  onViewSignals,
}: Props) {
  const inPosition = existingPositions.length > 0
  const latestPos  = existingPositions[existingPositions.length - 1]
  const [signalsOpen, setSignalsOpen] = useState(false)
  const [chartsOpen, setChartsOpen] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth >= 768))
  const [chartTab, setChartTab] = useState<'session' | 'vwap' | 'volume' | 'momentum' | 'relative'>('session')
  const signalsSectionRef = useRef<HTMLDivElement | null>(null)

  const m = result.metrics ?? {}
  const vwapDist = asFiniteNum(m.vwap_dist_pct)
  const vwapPosition = typeof m.vwap_position === 'string' ? m.vwap_position : null
  const mom = asFiniteNum(m.momentum_pct)
  const lastPrice = asFiniteNum(m.last_price)
  const sessionChangePct = asFiniteNum(m.session_change_pct)
  const dayDollarChange = lastPrice != null && sessionChangePct != null ? lastPrice * sessionChangePct / 100 : null
  const vwapValue = asFiniteNum(m.vwap)
  const rvol = asFiniteNum(m.rvol)
  const gapPct = asFiniteNum(m.gap_pct)
  const gapFillRisk = Boolean(m.gap_fill_risk)
  const orWidthLabel = typeof m.or_width_label === 'string' ? m.or_width_label : null
  const orWidthPct = asFiniteNum(m.or_width_pct)
  const sessionPhase = typeof m.session_phase === 'string' ? m.session_phase : null
  const priceStructure = typeof m.price_structure === 'string' ? m.price_structure : null
  const secondaryBreakout = Boolean(m.secondary_breakout)
  const orRetest = Boolean(m.or_retest)
  const spyChg = asFiniteNum(m.spy_change_pct)
  const qqqChg = asFiniteNum(m.qqq_change_pct)
  const vixN = asFiniteNum(m.vix)
  const rsN = asFiniteNum(m.rs_vs_qqq_pct)
  const rsLabel = typeof m.rs_vs_qqq_label === 'string' ? m.rs_vs_qqq_label : null
  const chartBars = parseChartBars(m.chart_bars)
  const orChartHigh = asFiniteNum(m.or_high)
  const orChartLow = asFiniteNum(m.or_low)
  const orMinN = typeof m.or_minutes === 'number' && m.or_minutes > 0 ? m.or_minutes : 15
  const td = coerceTraderDecision(result.trader_decision ?? null)
  const eg = result.entry_guidance
  const signals = computeSignals(result, m)
  const reasoning = computeReasoning(result, m)
  const riskPanel = computeRiskPanel(result, m)
  const decisionTone = actionTone(result.final_decision)
  const execTone = actionTone(result.execution_readiness || result.execution_timing)
  const optionRisk = result.option_risk_context
  const hasOptionOverlay = !!optionRisk
  const hasListedOptions = hasOptionOverlay && optionRisk?.suggested_contract_window !== 'N/A'
  const optionWarning = String(optionRisk?.option_execution_warning || '').trim()
  const optionRiskItems = optionRisk ? ([
    ['theta_risk', optionRisk.theta_risk],
    ['gamma_risk', optionRisk.gamma_risk],
    ['iv_risk', optionRisk.iv_risk],
    ['liquidity_risk', optionRisk.liquidity_risk],
  ] as const) : []
  // AI Coach — use structured data when available, fall back to deterministic helpers
  const ac: AiCoachResult | undefined = result.ai_coach as AiCoachResult | undefined
  const hasAiCoach = !!ac?.summary

  const intradaySummary  = hasAiCoach ? (ac!.summary) : computeIntradaySummary(result, m)
  const bestNextStep     = hasAiCoach ? (ac!.best_next_step) : computeBestNextStep(result)
  const managementPlan   = computeIntradayManagementPlan(result, m)
  const walkthroughSteps = buildDayWalkthrough(result, m)
  const currentPrice = eg?.current_price ?? lastPrice
  const breakoutLevel = eg?.breakout_level
  const volumeSeries = chartBars?.map(bar => bar.v) ?? []
  // Implied average volume for the current time of day: backend rvol = lastBar.v / avg_vol_for_time
  const lastChartBar = chartBars?.[chartBars.length - 1] ?? null
  const avgVolForTimeOfDay = lastChartBar != null && rvol != null && rvol > 0
    ? lastChartBar.v / rvol
    : null
  const momentumSeries = chartBars?.length
    ? chartBars.map(bar => ((bar.c / chartBars[0].o) - 1) * 100)
    : []
  const relativeBars = [
    { label: 'Ticker Mom', value: mom ?? 0, color: mom != null && mom >= 0 ? 'bg-semantic-bullish' : 'bg-semantic-bearish' },
    { label: 'RS vs QQQ', value: rsN ?? 0, color: rsN != null && rsN >= 0 ? 'bg-semantic-info' : 'bg-semantic-bearish' },
    { label: 'SPY', value: spyChg ?? 0, color: spyChg != null && spyChg >= 0 ? 'bg-semantic-bullish' : 'bg-semantic-bearish' },
    { label: 'QQQ', value: qqqChg ?? 0, color: qqqChg != null && qqqChg >= 0 ? 'bg-semantic-accent' : 'bg-semantic-bearish' },
  ]
  const chaseRisk = mom != null && Math.abs(mom) > 2 ? 'HIGH' : mom != null && Math.abs(mom) > 1.2 ? 'MODERATE' : 'LOW'
  // When the engine is fully READY (all gates passed), treat any residual
  // aspirational confirmations from trader_decision as already satisfied.
  const entryGated = result.final_decision === 'READY' && eg?.should_enter_now === 'YES'
  const activePendingConfirmations = entryGated ? [] : (eg?.pending_confirmations ?? [])
  const confirmationState = activePendingConfirmations.length ? 'PENDING' : 'CLEAR'

  // Which step is the trader's primary action point right now?
  const focusStep = ((): number => {
    const state = eg?.state || ''
    if (state === 'ENTRY_ACTIVE' || state === 'ENTRY_RETEST') return 6
    const fd = String(result.final_decision || '').toUpperCase()
    if (fd === 'READY')                       return 5
    if (fd === 'WAIT')                        return 3
    if (fd === 'WATCH')                       return 2
    if (fd === 'AVOID' || fd === 'NO_EDGE')   return 1
    return 5
  })()
  const focusBadgeText = (() => {
    const state = eg?.state || ''
    if (state === 'ENTRY_ACTIVE' || state === 'ENTRY_RETEST') return 'Manage'
    const fd = String(result.final_decision || '').toUpperCase()
    if (fd === 'READY') return 'Enter'
    if (fd === 'WAIT')  return 'Wait'
    if (fd === 'WATCH') return 'Watch'
    if (fd === 'AVOID' || fd === 'NO_EDGE') return 'Avoid'
    return 'Focus'
  })()
  const focusToneText = decisionTone === 'green' ? 'text-semantic-bullish'
    : decisionTone === 'orange' ? 'text-semantic-warning'
    : decisionTone === 'red' ? 'text-semantic-bearish'
    : 'text-semantic-info'
  const focusBorderLeft = decisionTone === 'green' ? 'border-l-4 border-l-semantic-bullish'
    : decisionTone === 'orange' ? 'border-l-4 border-l-semantic-warning'
    : decisionTone === 'red' ? 'border-l-4 border-l-semantic-bearish'
    : 'border-l-4 border-l-semantic-info'

  return (
    <div className={`day-trade-engine-panel rounded-2xl border border-border bg-gray-900/70 overflow-hidden ${
      decisionTone === 'green' ? 'ring-1 ring-semantic-bullish-border' :
      decisionTone === 'blue' ? 'ring-1 ring-semantic-info-border' :
      decisionTone === 'orange' ? 'ring-1 ring-semantic-warning-border' :
      decisionTone === 'red' ? 'ring-1 ring-semantic-bearish-border' : 'ring-1 ring-border'
    }`}>
      <div className="px-4 pt-4 pb-3 border-b border-gray-800 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-semantic-accent">Trade Action Summary</div>
            <div className="mt-1 flex items-center gap-2.5 flex-wrap">
              <span className="text-xl font-bold text-white dark:text-heading tracking-tight">{result.ticker}</span>
              {result.company_name && (
                <span className="text-xs text-gray-500 truncate max-w-[220px]">{result.company_name}</span>
              )}
              {lastPrice != null && (
                <span className="flex items-center gap-1.5 ml-0.5">
                  <span className="text-sm font-bold text-white dark:text-heading font-mono tabular-nums">${lastPrice.toFixed(2)}</span>
                  {sessionChangePct != null && dayDollarChange != null && (
                    <span className={`text-xs font-semibold font-mono tabular-nums ${dayDollarChange >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {dayDollarChange >= 0 ? '+' : ''}{dayDollarChange.toFixed(2)} ({sessionChangePct >= 0 ? '+' : ''}{sessionChangePct.toFixed(2)}%)
                    </span>
                  )}
                </span>
              )}
            </div>
            <div className="mt-1 text-sm text-gray-300">
              {result.bias === 'short' ? 'Bearish' : 'Bullish'} intraday setup · {formatLabel(result.signal_quality || result.setup_quality)}
            </div>
            <div className="text-[10px] text-gray-600 mt-1">
              {typeof m.session_date === 'string' ? m.session_date : ''} · Intraday
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {showRefresh && onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                disabled={refreshing}
                title="Re-scan"
                className="rounded-lg p-1.5 text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-40"
              >
                <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
              </button>
            )}
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
          <div className="rounded-xl border border-gray-800/90 bg-black/15 px-3 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-600">Action</div>
            <div className="mt-1">
              <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${TONE_BADGE[decisionTone]}`}>
                {formatLabel(result.final_decision)}
              </span>
            </div>
          </div>
          <div className="rounded-xl border border-gray-800/90 bg-black/15 px-3 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-600">Execution</div>
            <div className="mt-1">
              <Badge text={result.execution_readiness || result.execution_timing || 'WAIT'} tone={execTone} />
            </div>
          </div>
          <div className="rounded-xl border border-gray-800/90 bg-black/15 px-3 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-600">Risk</div>
            <div className="mt-1">
              <Badge text={result.risk_state || 'MEDIUM'} tone={toneForRisk(result.risk_state || 'MEDIUM')} />
            </div>
          </div>
          <div className="rounded-xl border border-gray-800/90 bg-black/15 px-3 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-600">Market Support</div>
            <div className="mt-1">
              <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold leading-none ${getMarketContextBadgeClass(result.market_bias || 'MIXED')}`}>
                {result.market_bias || 'MIXED'}
              </span>
            </div>
          </div>
          <div className="rounded-xl border border-gray-800/90 bg-black/15 px-3 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-600">Confidence</div>
            <div className="mt-1 text-sm font-bold text-gray-100">{result.display_confidence ?? result.confidence} / 100</div>
          </div>
          <div className="rounded-xl border border-gray-800/90 bg-black/15 px-3 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-600">Best Next Step</div>
            <div className="mt-1 text-sm font-bold text-gray-100">{bestNextStep}</div>
          </div>
        </div>

        {/* ── Daily Range & R/R row ── */}
        {(() => {
          const rangeUsed  = typeof m.daily_range_used_pct === 'number' ? m.daily_range_used_pct : null
          const rangePhase = typeof m.daily_range_phase === 'string' ? m.daily_range_phase : null
          const rrRatio    = typeof m.entry_rr_ratio === 'number' ? m.entry_rr_ratio : null
          const warning    = typeof m.range_warning === 'string' ? m.range_warning : null
          if (rangeUsed == null && rrRatio == null) return null

          const phaseTone =
            rangePhase === 'EXHAUSTED' ? 'border-rose-500/40 bg-rose-500/10 text-rose-300' :
            rangePhase === 'LATE'      ? 'border-amber-500/40 bg-amber-500/10 text-amber-300' :
            rangePhase === 'MID'       ? 'border-sky-500/40 bg-sky-500/10 text-sky-300' :
                                         'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'

          const rrTone =
            rrRatio == null              ? 'text-gray-500' :
            rrRatio < 0.5               ? 'text-rose-400' :
            rrRatio < 1.0               ? 'text-amber-400' :
                                           'text-emerald-400'

          const rrIcon = rrRatio != null && rrRatio < 0.5 ? '❌' : rrRatio != null && rrRatio < 1.0 ? '⚠️' : '✅'

          return (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                {rangeUsed != null && rangePhase && (
                  <div className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${phaseTone}`}>
                    <span className="text-[10px] font-bold uppercase tracking-widest opacity-70">Range Used</span>
                    <span className="font-mono font-bold">{rangeUsed.toFixed(0)}%</span>
                    <span className="opacity-60">·</span>
                    <span className="text-[10px] font-bold uppercase tracking-wide">{rangePhase}</span>
                  </div>
                )}
                {rrRatio != null && (
                  <div className={`inline-flex items-center gap-1.5 rounded-lg border border-gray-700/50 bg-black/15 px-2.5 py-1.5 text-xs font-semibold`}>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-gray-600">R/R</span>
                    <span className={`font-mono font-bold ${rrTone}`}>{rrRatio.toFixed(1)}:1</span>
                    <span>{rrIcon}</span>
                  </div>
                )}
              </div>
              {warning && (
                <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed ${
                  rangePhase === 'EXHAUSTED'
                    ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                    : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                }`}>
                  <span className="shrink-0 mt-0.5">⚠️</span>
                  <span>{warning}</span>
                </div>
              )}
            </div>
          )
        })()}

        <div className="rounded-xl border border-semantic-accent-border bg-semantic-accent-bg px-3 py-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-semantic-accent">
              <BarChart2 size={12} />
              AI Coach Summary
            </div>
            {hasAiCoach && ac!._source && (
              <span className="text-[9px] text-gray-600 font-mono uppercase tracking-widest">
                {ac!._source === 'anthropic' ? '⚡ Claude' : ac!._source === 'openai' ? '⚡ GPT' : '◎ engine'}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-200 leading-relaxed">{intradaySummary}</p>

          {/* Entry condition + invalidation — from ai_coach when available */}
          {hasAiCoach && (
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-gray-800/80 bg-black/20 px-2.5 py-2">
                <div className="text-[9px] font-semibold uppercase tracking-widest text-emerald-500 mb-1">Entry Condition</div>
                <div className="text-[11px] text-gray-200 leading-snug">{ac!.entry_condition}</div>
              </div>
              <div className="rounded-lg border border-gray-800/80 bg-black/20 px-2.5 py-2">
                <div className="text-[9px] font-semibold uppercase tracking-widest text-rose-500 mb-1">Invalidation</div>
                <div className="text-[11px] text-gray-200 leading-snug">{ac!.invalidation}</div>
              </div>
            </div>
          )}

          {/* Confluence Zone */}
          {hasAiCoach && ac!.confluence?.detected && (
            <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide ${
                  ac!.confluence.strength === 'EXTREME' ? 'bg-amber-500/20 text-amber-300' :
                  'bg-amber-500/10 text-amber-400/80'
                }`}>
                  {ac!.confluence.strength}
                </span>
                <span className="text-[10px] font-semibold text-amber-300">
                  {ac!.confluence.zone_role} ZONE ${ac!.confluence.zone_price.toFixed(2)}
                </span>
                <span className="ml-auto text-[10px] text-amber-400/60">
                  {ac!.confluence.levels_converging.join(' + ')}
                </span>
              </div>
              {ac!.confluence_note && (
                <div className="mt-1 text-[10px] text-gray-400">{ac!.confluence_note}</div>
              )}
              {/* Entry gate status */}
              {ac!.entry_gate && (
                <div className={`mt-1.5 flex items-center gap-1.5 text-[10px] ${
                  ac!.entry_gate.valid ? 'text-semantic-bullish' : 'text-slate-500 dark:text-gray-500'
                }`}>
                  <span>{ac!.entry_gate.valid ? '✓' : '○'}</span>
                  <span>{ac!.entry_gate.valid ? 'Entry valid' : 'Entry not yet valid'} — {ac!.entry_gate.trigger_condition}</span>
                </div>
              )}
            </div>
          )}

          {/* Trade R/R */}
          {hasAiCoach && ac!.trade && ac!.trade.direction !== 'NONE' && ac!.trade.entry_price > 0 && (
            <div className="mt-2 grid grid-cols-4 gap-1">
              {[
                { label: 'Entry', value: `$${ac!.trade.entry_price.toFixed(2)}` },
                { label: 'Target', value: `$${ac!.trade.target.toFixed(2)}` },
                { label: 'Stop', value: `$${ac!.trade.stop.toFixed(2)}` },
                { label: 'R/R', value: `${ac!.trade.risk_reward.toFixed(1)}:1`,
                  highlight: ac!.trade.r_r_valid },
              ].map(({ label, value, highlight }) => (
                <div key={label} className={`rounded border px-2 py-1 text-center ${
                  highlight ? 'border-semantic-bullish/30 bg-semantic-bullish/5' : 'border-gray-800/60 bg-black/20'
                }`}>
                  <div className="text-[9px] text-gray-500">{label}</div>
                  <div className={`text-[11px] font-mono font-semibold ${
                    highlight ? 'text-semantic-bullish' : 'text-gray-200'
                  }`}>{value}</div>
                </div>
              ))}
            </div>
          )}

          {/* No-trade reason */}
          {hasAiCoach && ac!.no_trade_reason && (
            <div className="mt-1.5 rounded border border-slate-300 dark:border-gray-700/40 bg-slate-50 dark:bg-black/10 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 dark:text-gray-300">
              ⚠ {ac!.no_trade_reason}
            </div>
          )}

          {/* Decision Tree — IF/THEN nodes */}
          {hasAiCoach && ac!.decision_tree.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[9px] font-semibold uppercase tracking-widest text-gray-500">Decision Tree</div>
              {ac!.decision_tree.map((node, i) => {
                const actionColor =
                  node.action === 'ENTER' ? 'text-emerald-400 border-emerald-700/50 bg-emerald-950/30' :
                  node.action === 'EXIT'  ? 'text-rose-400 border-rose-700/50 bg-rose-950/30' :
                  node.action === 'AVOID' ? 'text-amber-400 border-amber-700/50 bg-amber-950/30' :
                  'text-gray-400 border-gray-700/50 bg-gray-900/30'
                return (
                  <div key={i} className={`rounded-lg border px-2.5 py-2 text-[11px] ${actionColor}`}>
                    <span className="font-semibold">IF</span> {node.if} →{' '}
                    <span className="font-semibold">THEN</span> {node.then}
                    <span className={`ml-2 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${actionColor}`}>
                      {node.action}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          <div className="text-[11px] text-semantic-accent leading-relaxed">
            Best setup: {bestNextStep}
          </div>
        </div>

        {/* ═══ 4-State Trading System (SETUP → ENTRY → ACTIVE → EXIT) ═══ */}
        {(() => {
          const state = eg?.state || ''
          const activeMap: Record<string, number> = {
            'WAIT_FOR_VWAP_HOLD': 1, 'WAIT_FOR_VWAP_BREAK': 1,
            'WAIT_FOR_BREAKOUT': 1, 'WAIT_FOR_BREAKDOWN': 1,
            'MONITORING': 1,
            'WAIT_FOR_VOLUME': 2, 'VWAP_TEST': 2,
            'ENTRY_ACTIVE': 3, 'ENTRY_RETEST': 3,
          }
          const activeState = activeMap[state] ?? 1
          const stateCls = (n: number) =>
            n === activeState
              ? 'ring-2 ring-offset-1 ring-offset-gray-900'
              : ''

          return (
          <div className="space-y-1.5">
          <div className="flex items-center">
            {([['SETUP','amber'],['ENTRY','emerald'],['IN-PLAY','sky'],['EXIT','red']] as const).map(([label, color], i) => {
              const n = i + 1
              const isActive = n === activeState
              const isPast = n < activeState
              const nodeCls = isActive
                ? color === 'amber'   ? 'border-amber-400 bg-amber-500/25 text-amber-200 ring-2 ring-amber-400/40 ring-offset-1 ring-offset-gray-900'
                  : color === 'emerald' ? 'border-emerald-400 bg-emerald-500/25 text-emerald-200 ring-2 ring-emerald-400/40 ring-offset-1 ring-offset-gray-900'
                  : color === 'sky'     ? 'border-sky-400 bg-sky-500/25 text-sky-200 ring-2 ring-sky-400/40 ring-offset-1 ring-offset-gray-900'
                  :                      'border-red-400 bg-red-500/25 text-red-200 ring-2 ring-red-400/40 ring-offset-1 ring-offset-gray-900'
                : isPast ? 'border-gray-600 bg-gray-700/50 text-gray-500'
                : 'border-gray-700 bg-gray-800 text-gray-600'
              const lblCls = isActive
                ? color === 'amber' ? 'text-amber-300' : color === 'emerald' ? 'text-emerald-300' : color === 'sky' ? 'text-sky-300' : 'text-red-300'
                : isPast ? 'text-gray-500' : 'text-gray-700'
              return (
                <div key={n} className="flex items-center flex-1">
                  <div className="flex flex-col items-center gap-0.5 flex-1">
                    <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-[10px] font-black transition-all ${nodeCls}`}>{n}</div>
                    <span className={`text-[9px] font-bold uppercase tracking-wide ${lblCls}`}>{label}</span>
                  </div>
                  {i < 3 && <div className={`h-0.5 w-3 shrink-0 mb-3.5 ${isPast ? 'bg-gray-600' : 'bg-gray-800'}`} />}
                </div>
              )
            })}
          </div>
          <div className="grid gap-2 sm:grid-cols-4">
            {/* STATE 1: SETUP */}
            <div className={`rounded-xl border transition-all duration-200 ${activeState === 1 ? 'border-amber-500/60 bg-amber-950/25 ring-2 ring-amber-500/20' : 'border-amber-700/40 bg-amber-950/12'}`}>
              <div className="px-3 py-3">
              <div className="flex items-center gap-1.5 text-amber-300 text-[11px] font-bold uppercase tracking-[0.12em] mb-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shrink-0" />
                STATE 1: SETUP
                {activeState === 1 && <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500 dark:text-white px-2 py-0.5 text-[9px] font-black uppercase tracking-widest"><span className="h-1.5 w-1.5 rounded-full bg-amber-700 dark:bg-white animate-pulse shrink-0" />NOW</span>}
              </div>
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Watch / Prepare</div>
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-100 uppercase text-[11px] tracking-wide">
                    {hasAiCoach ? ac!.states.setup.label : (result.bias === 'short' ? 'SHORT bias forming' : 'LONG bias forming')}
                  </span>
                </div>
                <div className="text-gray-300 text-[11px] leading-relaxed font-medium">
                  {hasAiCoach
                    ? ac!.states.setup.detail
                    : result.bias === 'short'
                      ? eg?.vwap != null && eg?.opening_range_low != null
                        ? `VWAP $${eg.vwap.toFixed(2)} + ORL $${eg.opening_range_low.toFixed(2)}`
                        : eg?.vwap != null ? `VWAP $${eg.vwap.toFixed(2)}` : 'Key resistance levels forming'
                      : eg?.vwap != null && eg?.opening_range_high != null
                        ? `VWAP $${eg.vwap.toFixed(2)} + ORH $${eg.opening_range_high.toFixed(2)}`
                        : eg?.vwap != null ? `VWAP $${eg.vwap.toFixed(2)}` : 'Key levels forming'}
                </div>
                <div className="text-[10px] text-amber-400/80 font-semibold">
                  {hasAiCoach
                    ? ac!.states.setup.key_levels.map(l => `$${l.toFixed(2)}`).join(' · ')
                    : result.bias === 'short'
                      ? `watch $${eg?.opening_range_low != null ? eg.opening_range_low.toFixed(2) : 'ORL'}–$${eg?.vwap != null ? eg.vwap.toFixed(2) : 'VWAP'} zone`
                      : `watch $${eg?.vwap != null ? eg.vwap.toFixed(2) : 'VWAP'}–$${eg?.opening_range_high != null ? eg.opening_range_high.toFixed(2) : 'ORH'} zone`}
                </div>
              </div>
              </div>
            </div>
            {/* STATE 2: ENTRY */}
            <div className={`rounded-xl border transition-all duration-200 ${activeState === 2 ? 'border-emerald-500/60 bg-emerald-950/25 ring-2 ring-emerald-500/20' : 'border-emerald-700/40 bg-emerald-950/12'}`}>
              <div className="px-3 py-3">
              <div className="flex items-center gap-1.5 text-emerald-300 text-[11px] font-bold uppercase tracking-[0.12em] mb-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shrink-0" />
                STATE 2: ENTRY
                {activeState === 2 && <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500 dark:text-white px-2 py-0.5 text-[9px] font-black uppercase tracking-widest"><span className="h-1.5 w-1.5 rounded-full bg-emerald-700 dark:bg-white animate-pulse shrink-0" />NOW</span>}
              </div>
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Execution Gate</div>
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-100 uppercase text-[11px] tracking-wide">{result.bias === 'short' ? 'PUT / SHORT' : 'CALL / LONG'}</span>
                  <span className="text-violet-300 font-mono text-[12px] font-semibold">
                    {result.bias === 'short'
                      ? eg?.breakout_level != null
                        ? `close & hold <$${eg.breakout_level.toFixed(2)}`
                        : eg?.vwap != null
                          ? `<$${eg.vwap.toFixed(2)} — hold below`
                          : '—'
                      : eg?.breakout_level != null
                        ? `close & hold >$${eg.breakout_level.toFixed(2)}`
                        : eg?.vwap != null
                          ? `>$${eg.vwap.toFixed(2)} — hold above`
                          : '—'}
                  </span>
                </div>
                <div className="text-gray-300 text-[11px] leading-relaxed font-medium">
                  {result.bias === 'short'
                    ? eg?.opening_range_low != null
                      ? `sustained below ORL $${eg.opening_range_low.toFixed(2)} — no reclaim`
                      : eg?.vwap != null
                        ? `sustained below VWAP $${eg.vwap.toFixed(2)}`
                        : 'await rejection confirmation'
                    : eg?.opening_range_high != null
                      ? `sustained above ORH $${eg.opening_range_high.toFixed(2)}`
                      : eg?.vwap != null
                        ? `sustained above VWAP $${eg.vwap.toFixed(2)}`
                        : 'await breakout confirmation'}
                </div>
              </div>
              </div>
            </div>
            {/* STATE 3: ACTIVE */}
            <div className={`rounded-xl border transition-all duration-200 ${activeState === 3 ? 'border-sky-500/60 bg-sky-950/25 ring-2 ring-sky-500/20' : 'border-sky-700/40 bg-sky-950/12'}`}>
              <div className="px-3 py-3">
              <div className="flex items-center gap-1.5 text-sky-300 text-[11px] font-bold uppercase tracking-[0.12em] mb-2">
                <span className="w-2.5 h-2.5 rounded-full bg-sky-400 shrink-0" />
                STATE 3: IN-PLAY
                {activeState === 3 && <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-sky-100 text-sky-700 dark:bg-sky-500 dark:text-white px-2 py-0.5 text-[9px] font-black uppercase tracking-widest"><span className="h-1.5 w-1.5 rounded-full bg-sky-700 dark:bg-white animate-pulse shrink-0" />NOW</span>}
              </div>
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                {hasAiCoach ? ac!.states.in_play.label : (result.bias === 'short' ? 'Breakdown Active' : 'Breakout Active')}
              </div>
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-100 text-[11px] uppercase tracking-wide">HOLD {result.bias === 'short' ? 'SHORT' : 'LONG'}</span>
                  <span className="text-emerald-300 font-mono text-[12px] font-semibold">
                    {hasAiCoach && ac!.states.in_play.target > 0
                      ? `TP $${ac!.states.in_play.target.toFixed(2)}`
                      : eg?.scalp_target != null ? `TP $${eg.scalp_target.toFixed(2)}` : '—'}
                  </span>
                </div>
                <div className="text-gray-300 text-[11px] leading-relaxed font-medium">
                  {hasAiCoach
                    ? ac!.states.in_play.add_condition
                    : result.bias === 'short'
                      ? `trail ORL ${eg?.opening_range_low != null ? `$${eg.opening_range_low.toFixed(2)}` : 'level'}, add on weakness below ${eg?.breakout_level != null ? `$${eg.breakout_level.toFixed(2)}` : 'trigger'}`
                      : `trail ORH ${eg?.opening_range_high != null ? `$${eg.opening_range_high.toFixed(2)}` : 'level'}, add on strength above ${eg?.vwap != null ? `$${eg.vwap.toFixed(2)}` : 'trigger'}`}
                </div>
              </div>
              </div>
            </div>
            {/* STATE 4: EXIT */}
            <div className={`rounded-xl border transition-all duration-200 ${activeState === 4 ? 'border-red-500/60 bg-red-950/25 ring-2 ring-red-500/20' : 'border-red-700/40 bg-red-950/12'}`}>
              <div className="px-3 py-3">
              <div className="flex items-center gap-1.5 text-red-300 text-[11px] font-bold uppercase tracking-[0.12em] mb-2">
                <span className="w-2.5 h-2.5 rounded-full bg-red-400 shrink-0" />
                STATE 4: EXIT
                {activeState === 4 && <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-red-100 text-red-700 dark:bg-red-500 dark:text-white px-2 py-0.5 text-[9px] font-black uppercase tracking-widest"><span className="h-1.5 w-1.5 rounded-full bg-red-700 dark:bg-white animate-pulse shrink-0" />NOW</span>}
              </div>
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                {hasAiCoach ? ac!.states.exit.label : 'Completion / Reset'}
              </div>
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-100 text-[11px] uppercase tracking-wide">SL</span>
                  <span className="text-red-300 font-mono text-[12px] font-semibold">
                    {hasAiCoach && ac!.states.exit.stop_loss > 0
                      ? `$${ac!.states.exit.stop_loss.toFixed(2)}`
                      : eg?.risk_below != null ? `$${eg.risk_below.toFixed(2)}` : '—'}
                  </span>
                </div>
                <div className="text-gray-300 text-[11px] leading-relaxed font-medium">
                  {hasAiCoach
                    ? ac!.states.exit.exit_condition
                    : result.bias === 'short'
                      ? 'VWAP reclaimed above · or ORL closed back above → cover'
                      : 'VWAP lost below · or ORH closed back below → exit'}
                  {eg?.scalp_target != null && ` · scale out at TP`}
                </div>
              </div>
              </div>
            </div>
          </div>
          </div>
          )
        })()}

        {inPosition && latestPos && (
          <div className="rounded-xl border border-amber-600/40 bg-amber-950/30 px-4 py-3 space-y-2">
            <div className="flex items-center gap-2">
              <Check size={14} className="text-amber-400 shrink-0" />
              <span className="text-xs font-bold text-amber-300 uppercase tracking-wide">Already in Position</span>
              {latestPos.source && (
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                  latestPos.source === 'day'   ? 'border-orange-600/40 bg-orange-900/30 text-orange-300' :
                  latestPos.source === 'swing' ? 'border-blue-600/40 bg-blue-900/30 text-blue-300' :
                                                 'border-gray-600/40 bg-gray-800/50 text-gray-400'
                }`}>{latestPos.source}</span>
              )}
              {existingPositions.length > 1 && (
                <span className="text-[10px] text-amber-400/70">{existingPositions.length} open positions</span>
              )}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-amber-200/80">
              {latestPos.strategy && <span><span className="text-amber-400/60">Strategy</span> {latestPos.strategy}</span>}
              {latestPos.contracts > 0 && <span><span className="text-amber-400/60">Contracts</span> {latestPos.contracts}</span>}
              {latestPos.entryPrice > 0 && <span><span className="text-amber-400/60">Entry px</span> ${latestPos.entryPrice.toFixed(2)}</span>}
              {latestPos.addedAt && <span><span className="text-amber-400/60">Added</span> {latestPos.addedAt.slice(0, 10)}</span>}
            </div>
            <p className="text-[11px] text-amber-200/70 leading-snug">
              Follow your exit rules — manage this position rather than adding again without a clear plan.
            </p>
          </div>
        )}

        <MarketTimeGateBanner tradeType="day" />

        <div className="flex flex-wrap items-center gap-2">
          {inPosition ? (
            <button
              type="button"
              onClick={onViewPositions}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold transition-colors border border-amber-600/50 bg-amber-900/30 text-amber-300 hover:bg-amber-900/50`}
            >
              <BriefcaseBusiness size={14} />
              View Positions
            </button>
          ) : (
          <button
            type="button"
            onClick={onAddToPortfolio}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold transition-colors ${actionButtonClass(decisionTone)}`}
          >
            <PlusCircle size={14} />
            Add to Portfolio
          </button>
          )}
          {onRequestEnterActiveTrade && (
            <button
              type="button"
              onClick={onRequestEnterActiveTrade}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-semibold transition-colors ${getActionButtonClass('surface')}`}
            >
              <Activity size={14} />
              Track Intraday
            </button>
          )}
          {onCreateAlert && (
            <button
              type="button"
              onClick={onCreateAlert}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold transition-colors ${getActionButtonClass('alert')}`}
            >
              <Bell size={14} />
              Add Alert
            </button>
          )}
          {onOpenStrategyFinder && (
            <button
              type="button"
              onClick={onOpenStrategyFinder}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-semibold transition-colors ${getActionButtonClass('analyze')}`}
            >
              <BarChart2 size={13} />
              Strategy Finder
            </button>
          )}
          {onOpenCommandCenter && (
            <button
              type="button"
              onClick={onOpenCommandCenter}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-semibold transition-colors ${getActionButtonClass('surface')}`}
            >
              <Layers size={13} />
              Command Center
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setSignalsOpen(true)
              signalsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              onViewSignals?.()
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-semibold transition-colors ${getActionButtonClass('surface')}`}
          >
            <Search size={13} />
            View Signals
          </button>
        </div>
      </div>

      <div className={`px-4 py-4 border-b border-gray-800 space-y-3${focusStep === 1 ? ` ${focusBorderLeft}` : ''}`}>
        <div>
          <div className="flex items-center gap-2">
            <div className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${focusStep === 1 ? focusToneText : 'text-semantic-info'}`}>Step 1</div>
            {focusStep === 1 && <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest ${TONE_BADGE[decisionTone]}`}><Activity size={8} />{focusBadgeText}</span>}
          </div>
          <h2 className="mt-1 text-sm font-bold text-white">Market Context</h2>
          <p className="mt-1 text-xs text-gray-400">Is the market helping or hurting this trade?</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
          <ExecMapRow label="SPY" value={spyChg != null ? `${spyChg >= 0 ? '+' : ''}${spyChg.toFixed(2)}%` : '—'} />
          <ExecMapRow label="QQQ" value={qqqChg != null ? `${qqqChg >= 0 ? '+' : ''}${qqqChg.toFixed(2)}%` : '—'} />
          <ExecMapRow label="VIX" value={vixN != null ? vixN.toFixed(1) : '—'} tone={toneForExecText(vixN != null ? (vixN >= 30 ? 'AVOID' : vixN <= 18 ? 'READY' : 'WAIT') : 'WAIT')} />
          <ExecMapRow label="RS vs QQQ" value={rsLabel || (rsN != null ? `${rsN >= 0 ? '+' : ''}${rsN.toFixed(2)}%` : '—')} tone={toneForExecText(rsN != null ? (rsN >= 0 ? 'READY' : 'AVOID') : 'WAIT')} />
          <ExecMapRow label="Market Support" value={formatLabel(result.market_bias)} tone={toneForExecText(result.market_bias)} />
          <ExecMapRow label="Tape Quality" value={signals.volume_confirmation?.text || signals.volume?.text || 'Normal'} tone={toneForExecText(signals.volume_confirmation?.text || signals.volume?.text)} />
        </div>
        <div className="rounded-lg border border-gray-800/90 bg-black/15 px-3 py-2 text-xs text-gray-300 leading-relaxed">
          {result.market_bias
            ? `${formatLabel(result.market_bias)} market backdrop. ${rsN != null && rsN >= 0 ? 'Leadership is present relative to QQQ.' : 'Leadership is not clear yet.'} ${vixN != null && vixN < 20 ? 'Continuation probability is healthier with calmer volatility.' : 'Volatility is elevated enough to demand tighter confirmation.'}`
            : 'Market context is mixed, so let confirmation matter more than bias.'}
        </div>
      </div>

      <div className={`px-4 py-4 border-b border-gray-800 space-y-3${focusStep === 2 ? ` ${focusBorderLeft}` : ''}`}>
        <div>
          <div className="flex items-center gap-2">
            <div className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${focusStep === 2 ? focusToneText : 'text-semantic-info'}`}>Step 2</div>
            {focusStep === 2 && <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest ${TONE_BADGE[decisionTone]}`}><Activity size={8} />{focusBadgeText}</span>}
          </div>
          <h2 className="mt-1 text-sm font-bold text-white">Price &amp; Intraday Structure</h2>
          <p className="mt-1 text-xs text-gray-400">Is the ticker structurally aligned with an intraday continuation or breakdown?</p>
        </div>

        <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-5">
          {signals.vwap_position ? <SignalRow label="VWAP Position" value={signals.vwap_position.text} tone={signals.vwap_position.tone} /> : null}
          {signals.or_position ? <SignalRow label="OR Position" value={signals.or_position.text} tone={signals.or_position.tone} /> : null}
          {signals.breakout_quality ? <SignalRow label="Breakout Quality" value={signals.breakout_quality.text} tone={signals.breakout_quality.tone} /> : null}
          {signals.momentum ? <SignalRow label="Momentum" value={signals.momentum.text} tone={signals.momentum.tone} /> : null}
          {signals.volume_confirmation ? <SignalRow label="Volume" value={signals.volume_confirmation.text} tone={signals.volume_confirmation.tone} /> : null}
        </div>

        {(() => {
          const aboveVWAP = currentPrice != null && vwapValue != null && currentPrice > vwapValue
          const aboveORH  = currentPrice != null && eg?.opening_range_high != null && currentPrice > eg.opening_range_high
          const orBreakoutTone = aboveORH ? 'text-emerald-400' : (currentPrice != null && eg?.opening_range_low != null && currentPrice < eg.opening_range_low ? 'text-rose-400' : 'text-gray-400')
          const vwapTone  = aboveVWAP ? 'text-emerald-400' : (currentPrice != null && vwapValue != null && currentPrice < vwapValue ? 'text-rose-400' : 'text-gray-300')
          const scalpTone = eg?.scalp_target != null ? 'text-emerald-400' : undefined
          const riskTone  = eg?.risk_below != null ? 'text-rose-400' : undefined
          const breakTone = aboveORH ? 'text-emerald-400' : 'text-yellow-400'
          return (
          <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
            <ExecMapRow label="Current Price" value={currentPrice != null ? `$${currentPrice.toFixed(2)}` : null} />
            <ExecMapRow label="VWAP" value={eg?.vwap != null ? `$${eg.vwap.toFixed(2)}` : vwapValue != null ? `$${vwapValue.toFixed(2)}` : null} tone={vwapTone} />
            <ExecMapRow label="ORH" value={eg?.opening_range_high != null ? `$${eg.opening_range_high.toFixed(2)}` : null} tone={orBreakoutTone} />
            <ExecMapRow label="ORL" value={eg?.opening_range_low != null ? `$${eg.opening_range_low.toFixed(2)}` : null} tone={orBreakoutTone} />
            <ExecMapRow label={result.bias === 'short' ? 'Breakdown Level' : 'Breakout Level'} value={breakoutLevel != null ? `$${breakoutLevel.toFixed(2)}` : null} tone={breakTone} />
            <ExecMapRow label={result.bias === 'short' ? 'Bounce Zone' : 'Pullback Zone'} value={eg?.pullback_zone ?? null} />
            <ExecMapRow label="Scalp Target" value={eg?.scalp_target != null ? `$${eg.scalp_target.toFixed(2)}` : null} tone={scalpTone} />
            <ExecMapRow label={result.bias === 'short' ? 'Stop Above' : 'Stop Below'} value={eg?.risk_below != null ? `$${eg.risk_below.toFixed(2)}` : null} tone={riskTone} />
          </div>
          )
        })()}

        <div className="rounded-lg border border-gray-800/90 bg-black/15 px-3 py-2 text-xs text-gray-300 leading-relaxed">
          {result.bias === 'short'
            ? vwapDist != null && vwapDist <= 0
              ? 'Price is below VWAP — bearish structure is confirmed. Look for a clean breakdown below ORL with volume expansion to trigger the PUT.'
              : 'Price is still above VWAP — wait for it to break and hold below before committing to a short position.'
            : vwapDist != null && vwapDist >= 0
              ? 'Price above VWAP and above the opening structure supports continuation. Best entry still depends on breakout quality and volume expansion.'
              : 'Until price reclaims VWAP with conviction, intraday structure is incomplete for a long entry.'}
        </div>
      </div>

      <div className={`px-4 py-4 border-b border-gray-800 space-y-3${focusStep === 3 ? ` ${focusBorderLeft}` : ''}`}>
        <div>
          <div className="flex items-center gap-2">
            <div className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${focusStep === 3 ? focusToneText : 'text-semantic-info'}`}>Step 3</div>
            {focusStep === 3 && <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest ${TONE_BADGE[decisionTone]}`}><Activity size={8} />{focusBadgeText}</span>}
          </div>
          <h2 className="mt-1 text-sm font-bold text-white">Execution Analysis</h2>
          <p className="mt-1 text-xs text-gray-400">Why is this entry good or bad right now, and what still needs to happen?</p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <ExecMapRow label="Entry Readiness" value={formatLabel(result.execution_readiness || result.execution_timing)} tone={toneForExecText(result.execution_readiness || result.execution_timing)} />
          <ExecMapRow label="Pullback Probability" value={formatLabel(eg?.pullback_probability)} tone={toneForExecText(eg?.pullback_probability)} />
          <ExecMapRow label="Chase Risk" value={chaseRisk} tone={toneForExecText(chaseRisk)} />
        </div>

        {/* New signal row */}
        <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
          <ExecMapRow
            label="RVOL"
            value={rvol != null ? `${rvol.toFixed(1)}×` : '—'}
            tone={rvol == null ? 'gray' : rvol >= 2.5 ? 'green' : rvol >= 1.5 ? 'blue' : 'gray'}
          />
          <ExecMapRow
            label="Pre-mkt Gap"
            value={gapPct != null ? `${gapPct > 0 ? '+' : ''}${gapPct.toFixed(2)}%` : '—'}
            tone={gapPct == null ? 'gray' : gapFillRisk ? 'orange' : gapPct > 1 ? 'green' : gapPct < -1 ? 'red' : 'gray'}
          />
          <ExecMapRow
            label="OR Width"
            value={orWidthLabel ? `${orWidthLabel}${orWidthPct != null ? ` (${orWidthPct.toFixed(2)}%)` : ''}` : '—'}
            tone={orWidthLabel === 'NARROW' ? 'blue' : orWidthLabel === 'WIDE' ? 'orange' : 'gray'}
          />
          <ExecMapRow
            label="Session Phase"
            value={sessionPhase ? sessionPhase.replace(/_/g, ' ') : '—'}
            tone={sessionPhase === 'POWER_HOUR' ? 'orange' : sessionPhase === 'MIDDAY' ? 'gray' : sessionPhase === 'OPENING' ? 'blue' : 'green'}
          />
          <ExecMapRow
            label="Price Structure"
            value={priceStructure === 'HH_HL' ? 'HH/HL ↑' : priceStructure === 'LL_LH' ? 'LL/LH ↓' : priceStructure === 'MIXED' ? 'Mixed' : '—'}
            tone={priceStructure === 'HH_HL' ? 'green' : priceStructure === 'LL_LH' ? 'red' : 'gray'}
          />
          <ExecMapRow
            label="Setup Flag"
            value={secondaryBreakout ? '2nd Breakout' : orRetest ? 'OR Re-test' : '—'}
            tone={secondaryBreakout || orRetest ? 'green' : 'gray'}
          />
        </div>

        <div className="rounded-xl border border-gray-800/90 bg-black/15 px-3 py-3 space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-600">Entry Gate</div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              text={confirmationState === 'CLEAR' ? (eg?.should_enter_now === 'YES' ? 'ENTER NOW' : 'READY') : 'PENDING'}
              tone={confirmationState === 'CLEAR' ? 'green' : 'orange'}
            />
            <span className="text-[10px] text-gray-500">
              {confirmationState === 'CLEAR' ? 'All entry conditions are satisfied.' : 'Waiting for conditions below.'}
            </span>
          </div>
          <div className="text-xs text-gray-300 leading-relaxed">
            {eg?.action || 'Wait for VWAP support, breakout quality, and volume expansion to align before entry.'}
          </div>
          {activePendingConfirmations.length ? (
            <div className="rounded-lg border border-semantic-warning-border bg-semantic-warning-bg px-3 py-2 space-y-1">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-semantic-warning">What must happen first</div>
              {activePendingConfirmations.map((c, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[11px] text-semantic-warning">
                  <span className="mt-1 h-1 w-1 rounded-full bg-semantic-warning shrink-0" />
                  {c}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className={`px-4 py-4 border-b border-gray-800 space-y-3${focusStep === 4 ? ` ${focusBorderLeft}` : ''}`}>
        <div>
          <div className="flex items-center gap-2">
            <div className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${focusStep === 4 ? focusToneText : 'text-semantic-info'}`}>Step 4</div>
            {focusStep === 4 && <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest ${TONE_BADGE[decisionTone]}`}><Activity size={8} />{focusBadgeText}</span>}
          </div>
          <h2 className="mt-1 text-sm font-bold text-white">Option Execution Context</h2>
          <p className="mt-1 text-xs text-gray-400">Use options only if the intraday setup is valid and the contract quality is still tradable.</p>
        </div>

        {hasOptionOverlay ? (
          <div className={`rounded-xl border px-3 py-3 space-y-3 ${optionRiskChrome(optionWarning, hasListedOptions)}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-600">Intraday option awareness</div>
                <div className="mt-1 text-xs text-gray-400">
                  This does not change the day-trade signal. It only warns about execution friction.
                </div>
              </div>
              <div className="rounded-full border border-semantic-accent-border bg-semantic-accent-bg px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-semantic-accent">
                {hasListedOptions ? (optionRisk?.suggested_contract_window || 'Same day') : 'Equity only'}
              </div>
            </div>

            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
              {optionRiskItems.map(([key, value]) => (
                <div key={key} className="flex items-center justify-between rounded-lg border border-gray-800/80 bg-black/15 px-3 py-2">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-gray-500">{optionRiskLabel(key)}</span>
                  <Badge text={String(value || '—')} tone={toneForOptionRisk(String(value || ''))} />
                </div>
              ))}
            </div>

            <div className="text-xs text-gray-200 leading-relaxed">
              {optionWarning || 'Options look tradable, but only if the underlying confirms the setup first.'}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-800/90 bg-black/15 px-3 py-3 text-xs text-gray-400">
            No option-risk overlay is available for this symbol yet. Use the equity setup first, then verify contract quality separately.
          </div>
        )}

        {/* AI Coach options note */}
        {hasAiCoach && ac!.options_note && (
          <div className="rounded-xl border border-violet-700/40 bg-violet-950/20 px-3 py-2.5 flex items-start gap-2">
            <span className="mt-0.5 text-[10px] text-violet-400 font-bold uppercase tracking-widest shrink-0">AI Coach</span>
            <span className="text-[11px] text-gray-300 leading-relaxed">{ac!.options_note}</span>
          </div>
        )}
      </div>

      <div className={`px-4 py-4 border-b border-gray-800 space-y-3${focusStep === 5 ? ` ${focusBorderLeft}` : ''}`}>
        <div>
          <div className="flex items-center gap-2">
            <div className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${focusStep === 5 ? focusToneText : 'text-semantic-info'}`}>Step 5</div>
            {focusStep === 5 && <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest ${TONE_BADGE[decisionTone]}`}><Activity size={8} />{focusBadgeText}</span>}
          </div>
          <h2 className="mt-1 text-sm font-bold text-white">Final Intraday Decision</h2>
          <p className="mt-1 text-xs text-gray-400">Translate market support and setup quality into an actual execution decision.</p>
        </div>

        <div className="grid gap-3 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-xl border border-gray-800/90 bg-black/15 px-3 py-3 space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-lg border border-gray-800/90 bg-black/15 px-3 py-2 text-center">
                <div className="text-[9px] font-semibold uppercase tracking-widest text-gray-500 mb-1">Decision</div>
                <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${TONE_BADGE[decisionTone]}`}>{formatLabel(result.final_decision)}</span>
              </div>
              <div className="rounded-lg border border-gray-800/90 bg-black/15 px-3 py-2 text-center">
                <div className="text-[9px] font-semibold uppercase tracking-widest text-gray-500 mb-1">Timing</div>
                <Badge text={result.execution_timing || result.execution_readiness || 'WAIT'} tone={execTone} />
              </div>
              <div className="rounded-lg border border-gray-800/90 bg-black/15 px-3 py-2 text-center">
                <div className="text-[9px] font-semibold uppercase tracking-widest text-gray-500 mb-1">Pullback Risk</div>
                {eg?.pullback_probability
                  ? <Badge text={eg.pullback_probability} tone={eg.pullback_probability === 'HIGH' ? 'orange' : eg.pullback_probability === 'LOW' ? 'green' : 'blue'} />
                  : <span className="text-[11px] text-gray-500">—</span>}
              </div>
              <div className="rounded-lg border border-gray-800/90 bg-black/15 px-3 py-2 text-center">
                <div className="text-[9px] font-semibold uppercase tracking-widest text-gray-500 mb-1">Risk State</div>
                <Badge text={result.risk_state || 'MEDIUM'} tone={toneForRisk(result.risk_state || 'MEDIUM')} />
              </div>
            </div>
            <div className="text-sm text-gray-200 leading-relaxed">{result.reason || eg?.action || 'Wait for the next valid confirmation before entry.'}</div>
            {eg?.avoid ? (
              <div className="flex items-start gap-1.5 text-xs text-semantic-bearish bg-semantic-bearish-bg border border-semantic-bearish-border rounded-lg px-3 py-2">
                <ShieldAlert size={12} className="shrink-0 mt-0.5" />
                {eg.avoid}
              </div>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-gray-800/90 bg-black/15 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-gray-500">Conservative Entry</div>
                <div className="mt-1 text-xs text-gray-300">{(eg?.entry_decision as Record<string, string> | undefined)?.conservative || 'Wait for volume expansion above the trigger.'}</div>
              </div>
              <div className="rounded-lg border border-gray-800/90 bg-black/15 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-gray-500">Aggressive Entry</div>
                <div className="mt-1 text-xs text-gray-300">{(eg?.entry_decision as Record<string, string> | undefined)?.aggressive || 'Only acceptable if VWAP remains supported and the breakout candle is clean.'}</div>
              </div>
            </div>
            <div className="rounded-lg border border-gray-800/90 bg-black/15 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-gray-500">Best Setup</div>
              <div className="mt-1 text-xs text-gray-300">{(eg?.entry_decision as Record<string, string> | undefined)?.best_setup || bestNextStep}</div>
            </div>
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

      <div className={`px-4 py-4 border-b border-gray-800 space-y-3${focusStep === 6 ? ` ${focusBorderLeft}` : ''}`}>
        <div>
          <div className="flex items-center gap-2">
            <div className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${focusStep === 6 ? focusToneText : 'text-semantic-info'}`}>Step 6</div>
            {focusStep === 6 && <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest ${TONE_BADGE[decisionTone]}`}><Activity size={8} />{focusBadgeText}</span>}
          </div>
          <h2 className="mt-1 text-sm font-bold text-white">Intraday Management Plan</h2>
          <p className="mt-1 text-xs text-gray-400">Know the management plan before entry so you do not improvise under pressure.</p>
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
        <div className="rounded-xl border border-gray-800/90 bg-black/15 px-3 py-3">
          {(() => {
            type DayExitRule = { trigger: string; price: number; action: string; note: string }
            const eg = result.entry_guidance
            const dayExitRules: DayExitRule[] = Array.isArray(eg?.exit_rules) ? (eg.exit_rules as DayExitRule[]) : []
            if (dayExitRules.length > 0) {
              return (
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 border-b border-gray-700/60">
                      <th className="pb-1.5 text-left font-medium">When</th>
                      <th className="pb-1.5 text-right font-medium tabular-nums pr-3">At Price</th>
                      <th className="pb-1.5 text-left font-medium">Do This</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/50">
                    {dayExitRules.map((rule, i) => {
                      const isStop   = rule.trigger.toLowerCase().includes('stop')
                      const isTarget2 = rule.trigger.toLowerCase().includes('target 2')
                      const isTarget1 = rule.trigger.toLowerCase().includes('target 1')
                      const isEOD    = rule.price === 0
                      const isVwap   = rule.trigger.toLowerCase().includes('vwap')
                      const priceCls = isStop ? 'text-red-400' : isTarget2 ? 'text-orange-300' : isTarget1 ? 'text-emerald-400' : isVwap ? 'text-amber-400' : 'text-slate-400'
                      const actionCls = isStop ? 'text-red-300' : isTarget2 ? 'text-orange-200' : isTarget1 ? 'text-emerald-300' : isVwap ? 'text-amber-300' : 'text-gray-200'
                      return (
                        <tr key={i}>
                          <td className="py-2 pr-2 text-gray-400 leading-snug align-top w-[32%]">{rule.trigger}</td>
                          <td className={`py-2 pr-3 text-right font-mono font-bold tabular-nums align-top ${priceCls}`}>
                            {isEOD ? 'EOD' : `$${rule.price.toFixed(2)}`}
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
              )
            }
            return (
              <>
                <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-600 mb-2">Management Checklist</div>
                <div className="space-y-1.5">
                  {managementPlan.map((item, index) => (
                    <div key={index} className="flex items-start gap-1.5 text-[11px] text-gray-300 leading-relaxed">
                      <span className="mt-1.5 h-1 w-1 rounded-full bg-sky-500 shrink-0" />
                      {item}
                    </div>
                  ))}
                </div>
              </>
            )
          })()}
        </div>
      </div>

      <div className="px-4 py-4 border-b border-gray-800 space-y-3">
        <div className="rounded-xl border border-gray-800/90 bg-black/15 overflow-hidden">
          <button
            type="button"
            onClick={() => setChartsOpen(v => !v)}
            className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left"
          >
            <span>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-600">Decision Charts</div>
              <div className="text-xs text-gray-400 mt-0.5">Use the session chart to support the decision, not replace it.</div>
            </span>
            {chartsOpen ? <ChevronDown size={14} className="text-gray-500" /> : <ChevronRight size={14} className="text-gray-500" />}
          </button>
          {chartsOpen ? (
            <div className="border-t border-gray-800 px-3 py-3 space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {[
                  ['session', 'Session Chart'],
                  ['vwap', 'VWAP + OR'],
                  ['volume', 'Volume'],
                  ['momentum', 'Momentum'],
                  ['relative', 'Relative Strength vs QQQ'],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setChartTab(value as 'session' | 'vwap' | 'volume' | 'momentum' | 'relative')}
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

              {(chartTab === 'session' || chartTab === 'vwap') && chartBars && orChartHigh != null && orChartLow != null ? (
                <div className="space-y-2">
                  <DayTradeIntradayChart
                    bars={chartBars}
                    orHigh={orChartHigh}
                    orLow={orChartLow}
                    orMinutes={orMinN}
                    sessionDate={String(m.session_date ?? '')}
                  />
                  <div className="text-xs text-gray-400">
                    {chartTab === 'session'
                      ? 'Session view: watch the relationship between price, VWAP, and the opening range before forcing an entry.'
                      : result.bias === 'short'
                        ? 'VWAP + OR view: the cleanest short setups stay below VWAP and break through ORL with real participation — not just a wick.'
                        : 'VWAP + OR view: the cleanest continuation trades hold above VWAP and clear ORH with real participation — not just a wick.'}
                  </div>
                </div>
              ) : null}

              {chartTab === 'volume' ? (
                <div className="space-y-2">
                  <MiniBarChart values={volumeSeries} color="var(--chart-line-rsi)" avgRef={avgVolForTimeOfDay ?? undefined} />
                  <div className="text-xs text-gray-400">{result.bias === 'short' ? 'Volume should expand into the breakdown candle — low-volume drops are traps, not entries.' : 'Volume should expand into the breakout candle, not shrink while price stretches.'}</div>
                </div>
              ) : null}

              {chartTab === 'momentum' ? (
                <div className="space-y-2">
                  <MiniLineChart values={momentumSeries} stroke="var(--chart-line-ma20)" fill="var(--chart-line-ma20)" />
                  <div className="text-xs text-gray-400">Momentum should trend cleanly upward for continuation longs or downward for breakdown shorts. Flat momentum means wait.</div>
                </div>
              ) : null}

              {chartTab === 'relative' ? (
                <div className="space-y-3">
                  <div className="rounded-xl border border-gray-800/80 bg-black/20 p-3 space-y-3">
                    {relativeBars.map(item => {
                      const width = Math.min(100, Math.max(8, Math.abs(item.value) * 20))
                      return (
                        <div key={item.label} className="space-y-1">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-gray-400">{item.label}</span>
                            <span className={signedPctClass(item.value)}>{item.value >= 0 ? '+' : ''}{item.value.toFixed(2)}%</span>
                          </div>
                          <div className="h-2 rounded-full bg-gray-800">
                            <div className={`h-2 rounded-full ${item.color}`} style={{ width: `${width}%` }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <div className="text-xs text-gray-400">Relative strength should stay positive versus QQQ for a bullish day setup to deserve aggressive execution.</div>
                </div>
              ) : null}

              {!chartBars && (chartTab === 'session' || chartTab === 'vwap') ? (
                <p className="text-xs text-gray-500 py-2">Chart data unavailable.</p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div ref={signalsSectionRef} className="px-4 py-4 border-b border-gray-800 space-y-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">Advanced Diagnostics</div>
          <h2 className="mt-1 text-sm font-bold text-white">Signal Engine Breakdown</h2>
          <p className="mt-1 text-xs text-gray-400">Keep the full diagnostic layer, but use it after the trade workflow is clear.</p>
        </div>
        <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
          {signals.trend_strength && <SignalRow label="Trend Strength" value={signals.trend_strength.text} tone={signals.trend_strength.tone} />}
          {signals.breakout_quality && <SignalRow label="Breakout Quality" value={signals.breakout_quality.text} tone={signals.breakout_quality.tone} />}
          {signals.volume_confirmation && <SignalRow label="Volume Conf." value={signals.volume_confirmation.text} tone={signals.volume_confirmation.tone} />}
          {signals.market_alignment && <SignalRow label="Market Align" value={signals.market_alignment.text} tone={signals.market_alignment.tone} />}
          {signals.vwap_position && <SignalRow label="VWAP Position" value={signals.vwap_position.text} tone={signals.vwap_position.tone} />}
          {signals.momentum && <SignalRow label="Momentum" value={signals.momentum.text} tone={signals.momentum.tone} />}
          {signals.volume && <SignalRow label="Volume" value={signals.volume.text} tone={signals.volume.tone} />}
          {signals.relative_strength && <SignalRow label="RS vs QQQ" value={signals.relative_strength.text} tone={signals.relative_strength.tone} />}
          {signals.risk && <SignalRow label="Risk" value={signals.risk.text} tone={signals.risk.tone} />}
          {signals.or_position && <SignalRow label="OR Position" value={signals.or_position.text} tone={signals.or_position.tone} />}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {reasoning.map(block => {
            const borderMap: Record<string, string> = {
              emerald: 'border-l-emerald-600/50', amber: 'border-l-amber-600/50',
              sky: 'border-l-sky-600/50', violet: 'border-l-violet-600/50',
            }
            const dotMap: Record<string, string> = {
              emerald: 'bg-semantic-bullish', amber: 'bg-semantic-warning',
              sky: 'bg-semantic-info', violet: 'bg-semantic-accent',
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

      <div className="border-b border-gray-800">
        <button
          type="button"
          onClick={() => setSignalsOpen(v => !v)}
          className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-left text-xs font-semibold text-gray-500 hover:bg-gray-800/40 transition-colors"
        >
          <span>Signal Notes ({result.reasons.length})</span>
          {signalsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        {signalsOpen && (
          <div className="px-4 pb-4 pt-1 space-y-1.5">
            {result.reasons.map((r, i) => {
              const lower = r.toLowerCase()
              let icon = <Minus size={12} className="shrink-0 mt-0.5 text-gray-600" />
              let lineClass = 'text-gray-400'
              if (lower.startsWith('strong go') || lower.includes('bullish') || /above vwap|above opening|volume spike|outperforming/.test(lower)) {
                icon = <CheckCircle size={12} className="shrink-0 mt-0.5 text-semantic-bullish" />
                lineClass = 'text-semantic-bullish'
              } else if (/below vwap|below opening|bearish|lagging qqq|no volume spike/.test(lower)) {
                icon = <AlertTriangle size={12} className="shrink-0 mt-0.5 text-semantic-warning" />
                lineClass = 'text-semantic-warning'
              } else if (/avoid|vix very high|elevated vix|skipping|reversal risk|headline risk/.test(lower)) {
                icon = <ShieldAlert size={12} className="shrink-0 mt-0.5 text-semantic-bearish" />
                lineClass = 'text-semantic-bearish'
              }
              return (
                <div key={i} className={`flex items-start gap-2 text-xs leading-relaxed ${lineClass}`}>
                  {icon}
                  <span>{r}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {td && (
        <div className="border-b border-gray-800">
          <DayTradeTraderDecisionExpanded td={td} />
        </div>
      )}

      {(result.explanation?.summary || result.reason) && (
        <div className="px-4 py-3 border-b border-gray-800">
          {result.explanation?.summary ? (
            <p className="text-sm text-gray-300 leading-relaxed">{result.explanation.summary}</p>
          ) : (
            <p className="text-sm text-gray-300 leading-relaxed">{result.reason}</p>
          )}
          {result.explanation?.main_risk && (
            <div className="mt-1.5 flex items-start gap-1.5 text-xs text-semantic-warning">
              <AlertTriangle size={11} className="shrink-0 mt-0.5" />
              {result.explanation.main_risk}
            </div>
          )}
        </div>
      )}

      <div className="px-4 py-2.5 bg-gray-950/25">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-gray-600">
          <span>Bull {result.bull_score} · Bear {result.bear_score}</span>
          <span className="text-gray-800">|</span>
          <span>Bias: {result.market_bias?.replace(/_/g, ' ') || '—'}</span>
          <span className="text-gray-800">|</span>
          <span>Risk: {result.risk_state?.replace(/_/g, ' ') || '—'}</span>
          {typeof m.bars_used === 'number' && (
            <>
              <span className="text-gray-800">|</span>
              <span>{m.bars_used} 1m bars</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Re-export utility ──────────────────────────────────────────────

export function formatDayTradeLastPrice(metrics: Record<string, unknown>): string {
  const n = asFiniteNum(metrics.last_price)
  return n === null ? '—' : `$${n.toFixed(2)}`
}
