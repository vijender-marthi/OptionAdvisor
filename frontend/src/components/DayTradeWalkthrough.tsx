import { useState } from 'react'
import { Activity, ChevronDown, ChevronRight, ShieldAlert } from 'lucide-react'
import type { DayTradeScanResult } from '../api/client'
import { getDecisionBadgeClass } from '../utils/semanticTrading'

type Tone = 'green' | 'blue' | 'orange' | 'red' | 'gray'

const TONE_BADGE: Record<Tone, string> = {
  green: getDecisionBadgeClass('READY'),
  blue: getDecisionBadgeClass('GO'),
  orange: getDecisionBadgeClass('WATCH'),
  red: getDecisionBadgeClass('AVOID'),
  gray: getDecisionBadgeClass('NEUTRAL'),
}

function asFiniteNum(x: unknown): number | null {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null
  if (typeof x === 'string' && x.trim() !== '') {
    const n = Number(x)
    return Number.isFinite(n) ? n : null
  }
  return null
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

function toneForExecText(value: string | null | undefined): string {
  const t = actionTone(value)
  if (t === 'green') return 'text-semantic-bullish'
  if (t === 'blue') return 'text-semantic-info'
  if (t === 'orange') return 'text-semantic-warning'
  if (t === 'red') return 'text-semantic-bearish'
  return 'text-secondary'
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
  items.push({ label: 'Overall Risk', value: result.risk_state ? result.risk_state.replace(/_/g, ' ') : '—', tone: riskTone })
  items.push({ label: 'Momentum Risk', value: mom != null && Math.abs(mom) > 1.5 ? 'Elevated' : 'Manageable', tone: mom != null && Math.abs(mom) > 1.5 ? 'amber' : 'green' })
  items.push({ label: 'Breakout Failure', value: orBreakout === 'ABOVE' || orBreakout === 'BELOW' ? 'Low' : 'Moderate', tone: orBreakout === 'ABOVE' || orBreakout === 'BELOW' ? 'green' : 'amber' })
  items.push({ label: 'Extended Move', value: mom != null && mom > 2 ? 'High' : mom != null && mom < -2 ? 'High' : 'Low', tone: mom != null && Math.abs(mom) > 2 ? 'red' : 'green' })
  items.push({ label: 'Volume Fade', value: volSpike ? 'Low' : 'Possible', tone: volSpike ? 'green' : 'amber' })
  items.push({ label: 'VIX Context', value: vix != null ? `${vix.toFixed(1)}` : '—', tone: vix == null ? 'gray' : vix >= 30 ? 'red' : vix <= 18 ? 'green' : 'amber' })
  return items
}

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
  const toneForConf = (_key: string, val: string): Tone => {
    if (val === 'HIGH' || val === 'STRONG' || val === 'GOOD') return 'green'
    if (val === 'MEDIUM' || val === 'FAIR' || val === 'ELEVATED' || val === 'NORMAL') return 'blue'
    if (val === 'LOW' || val === 'WEAK' || val === 'POOR') return 'orange'
    return 'gray'
  }
  return {
    trend_strength: confidence?.trend_strength ? { text: confidence.trend_strength, tone: toneForConf('trend_strength', confidence.trend_strength) } : null,
    breakout_quality: confidence?.breakout_quality ? { text: confidence.breakout_quality, tone: toneForConf('breakout_quality', confidence.breakout_quality) } : null,
    volume_confirmation: confidence?.volume_confirmation ? { text: confidence.volume_confirmation, tone: toneForConf('volume_confirmation', confidence.volume_confirmation) } : null,
    market_alignment: confidence?.market_alignment ? { text: confidence.market_alignment, tone: toneForConf('market_alignment', confidence.market_alignment) } : null,
    risk: confidence?.risk ? { text: confidence.risk, tone: toneForRisk(confidence.risk) } : null,
    vwap_position: vwapDist != null ? { text: vwapDist >= 0 ? 'Above VWAP' : 'Below VWAP', tone: vwapDist >= 0 ? 'green' : 'red' as Tone } : null,
    momentum: mom != null ? { text: `${mom >= 0 ? '+' : ''}${mom.toFixed(1)}%`, tone: mom > 0 ? 'green' : mom < 0 ? 'red' : 'gray' as Tone } : null,
    volume: (() => {
      const rvolN = asFiniteNum(m.rvol)
      if (volSpike || (rvolN != null && rvolN >= 2.0)) return { text: 'Strong', tone: 'green' as Tone }
      if (rvolN != null && rvolN >= 1.25) return { text: 'Elevated', tone: 'blue' as Tone }
      if (rvolN != null && rvolN >= 0.75) return { text: 'Normal', tone: 'blue' as Tone }
      return { text: 'Weak', tone: 'orange' as Tone }
    })(),
    relative_strength: rsN != null ? { text: rsN >= 0 ? 'Positive' : 'Negative', tone: rsN >= 0 ? 'green' : 'red' as Tone } : null,
    or_position: orBreakout ? { text: orBreakout.replace(/_/g, ' '), tone: orBreakout === 'ABOVE' ? 'green' : orBreakout === 'BELOW' ? 'red' : 'blue' as Tone } : null,
  }
}

function toneForRisk(v: string): Tone {
  const r = v.toUpperCase()
  if (r === 'LOW') return 'green'
  if (r === 'MEDIUM') return 'blue'
  if (r === 'HIGH' || r === 'VERY_HIGH') return 'orange'
  if (r === 'EXTREME') return 'red'
  return 'gray'
}

export default function DayTradeWalkthrough({ result }: { result: DayTradeScanResult }) {
  const [open, setOpen] = useState(false)
  const m = result.metrics ?? {}
  const vwapDist = asFiniteNum(m.vwap_dist_pct)
  const mom = asFiniteNum(m.momentum_pct)
  const volSpike = !!m.volume_spike
  const spyChg = asFiniteNum(m.spy_change_pct)
  const qqqChg = asFiniteNum(m.qqq_change_pct)
  const vixN = asFiniteNum(m.vix)
  const rsN = asFiniteNum(m.rs_vs_qqq_pct)
  const rsLabel = typeof m.rs_vs_qqq_label === 'string' ? m.rs_vs_qqq_label : null
  const rvol = asFiniteNum(m.rvol)
  const gapPct = asFiniteNum(m.gap_pct)
  const gapFillRisk = Boolean(m.gap_fill_risk)
  const orWidthLabel = typeof m.or_width_label === 'string' ? m.or_width_label : null
  const orWidthPct = asFiniteNum(m.or_width_pct)
  const sessionPhase = typeof m.session_phase === 'string' ? m.session_phase : null
  const priceStructure = typeof m.price_structure === 'string' ? m.price_structure : null
  const secondaryBreakout = Boolean(m.secondary_breakout)
  const orRetest = Boolean(m.or_retest)
  const lastPrice = asFiniteNum(m.last_price)
  const vwapValue = asFiniteNum(m.vwap)
  const orBreakout = String(m.or_breakout || '').toUpperCase()
  const eg = result.entry_guidance
  const signals = computeSignals(result, m)
  const riskPanel = computeRiskPanel(result, m)
  const decisionTone = actionTone(result.final_decision)
  const walkthroughSteps = buildDayWalkthrough(result, m)
  const managementPlan = computeIntradayManagementPlan(result, m)
  const currentPrice = eg?.current_price ?? lastPrice
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
  const breakoutLevel = eg?.breakout_level
  const chaseRisk = mom != null && Math.abs(mom) > 2 ? 'HIGH' : mom != null && Math.abs(mom) > 1.2 ? 'MODERATE' : 'LOW'
  const entryGated = result.final_decision === 'READY' && eg?.should_enter_now === 'YES'
  const activePendingConfirmations = entryGated ? [] : (eg?.pending_confirmations ?? [])
  const confirmationState = activePendingConfirmations.length ? 'PENDING' : 'CLEAR'
  const focusStep = ((): number => {
    const state = eg?.state || ''
    if (state === 'ENTRY_ACTIVE' || state === 'ENTRY_RETEST') return 6
    const fd = String(result.final_decision || '').toUpperCase()
    if (fd === 'READY') return 5
    if (fd === 'WAIT') return 3
    if (fd === 'WATCH') return 2
    if (fd === 'AVOID' || fd === 'NO_EDGE') return 1
    return 5
  })()
  const focusBadgeText = (() => {
    const state = eg?.state || ''
    if (state === 'ENTRY_ACTIVE' || state === 'ENTRY_RETEST') return 'Manage'
    const fd = String(result.final_decision || '').toUpperCase()
    if (fd === 'READY') return 'Enter'
    if (fd === 'WAIT') return 'Wait'
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

  function toneForOptionRisk(value: string): Tone {
    const risk = String(value || '').toUpperCase()
    if (risk === 'HIGH') return 'red'
    if (risk === 'MEDIUM') return 'orange'
    if (risk === 'LOW') return 'green'
    return 'gray'
  }

  return (
    <div className="day-trade-walkthrough rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 cursor-pointer select-none" onClick={() => setOpen(v => !v)}>
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-semantic-accent">Step-by-Step Trade Workflow</div>
          <div className="text-[10px] text-gray-500 mt-0.5">Market context, execution, and risk management</div>
        </div>
        {open ? <ChevronDown size={14} className="text-gray-500" /> : <ChevronRight size={14} className="text-gray-500" />}
      </div>

      {open && (<div>
        <div className={`px-4 py-4 border-b border-gray-800 space-y-3${focusStep === 1 ? ` ${focusBorderLeft}` : ''}`}>
          <div>
            <div className="flex items-center gap-2">
              <div className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${focusStep === 1 ? focusToneText : 'text-semantic-info'}`}>Step 1</div>
              {focusStep === 1 && <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest ${TONE_BADGE[decisionTone]}`}><Activity size={8} />{focusBadgeText}</span>}
            </div>
            <h2 className="mt-1 text-sm font-bold text-heading">Market Context</h2>
            <p className="mt-1 text-xs text-gray-400">Is the market helping or hurting this trade?</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
            <ExecMapRow label="SPY" value={spyChg != null ? `${spyChg >= 0 ? '+' : ''}${spyChg.toFixed(2)}%` : '—'} />
            <ExecMapRow label="QQQ" value={qqqChg != null ? `${qqqChg >= 0 ? '+' : ''}${qqqChg.toFixed(2)}%` : '—'} />
            <ExecMapRow label="VIX" value={vixN != null ? vixN.toFixed(1) : '—'} tone={vixN != null ? (vixN >= 30 ? 'text-semantic-bearish' : vixN <= 18 ? 'text-semantic-bullish' : 'text-semantic-warning') : undefined} />
            <ExecMapRow label="RS vs QQQ" value={rsLabel || (rsN != null ? `${rsN >= 0 ? '+' : ''}${rsN.toFixed(2)}%` : '—')} tone={rsN != null ? (rsN >= 0 ? 'text-semantic-bullish' : 'text-semantic-bearish') : undefined} />
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
            <h2 className="mt-1 text-sm font-bold text-heading">Price &amp; Intraday Structure</h2>
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
              <ExecMapRow label="Target 1 — sell ½" value={eg?.scalp_target != null ? `$${eg.scalp_target.toFixed(2)}` : null} tone={scalpTone} />
              <ExecMapRow label="Target 2 — full exit" value={(eg as {scalp_target_2?: number})?.scalp_target_2 != null ? `$${((eg as {scalp_target_2?: number}).scalp_target_2 as number).toFixed(2)}` : null} tone={scalpTone} />
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
            <h2 className="mt-1 text-sm font-bold text-heading">Execution Analysis</h2>
            <p className="mt-1 text-xs text-gray-400">Why is this entry good or bad right now, and what still needs to happen?</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            <ExecMapRow label="Entry Readiness" value={formatLabel(result.execution_readiness || result.execution_timing)} tone={toneForExecText(result.execution_readiness || result.execution_timing)} />
            <ExecMapRow label="Pullback Probability" value={formatLabel(eg?.pullback_probability)} tone={toneForExecText(eg?.pullback_probability)} />
            <ExecMapRow label="Chase Risk" value={chaseRisk} tone={toneForExecText(chaseRisk)} />
          </div>
          <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
            <ExecMapRow label="RVOL" value={rvol != null ? `${rvol.toFixed(1)}×` : '—'} tone={rvol == null ? undefined : rvol >= 2.5 ? 'text-emerald-400' : rvol >= 1.25 ? 'text-sky-400' : rvol >= 0.75 ? 'text-gray-400' : 'text-orange-400'} />
            <ExecMapRow label="Pre-mkt Gap" value={gapPct != null ? `${gapPct > 0 ? '+' : ''}${gapPct.toFixed(2)}%` : '—'} tone={gapPct == null ? undefined : gapFillRisk ? 'text-orange-400' : gapPct > 1 ? 'text-emerald-400' : gapPct < -1 ? 'text-red-400' : 'text-gray-400'} />
            <ExecMapRow label="OR Width" value={orWidthLabel ? `${orWidthLabel}${orWidthPct != null ? ` (${orWidthPct.toFixed(2)}%)` : ''}` : '—'} tone={orWidthLabel === 'NARROW' ? 'text-sky-400' : orWidthLabel === 'WIDE' ? 'text-orange-400' : 'text-gray-400'} />
            <ExecMapRow label="Session Phase" value={sessionPhase ? sessionPhase.replace(/_/g, ' ') : '—'} tone={sessionPhase === 'POWER_HOUR' ? 'text-orange-400' : sessionPhase === 'MIDDAY' ? 'text-gray-400' : sessionPhase === 'OPENING' ? 'text-sky-400' : 'text-emerald-400'} />
            <ExecMapRow label="Price Structure" value={priceStructure === 'HH_HL' ? 'HH/HL ↑' : priceStructure === 'LL_LH' ? 'LL/LH ↓' : priceStructure === 'MIXED' ? 'Mixed' : '—'} tone={priceStructure === 'HH_HL' ? 'text-emerald-400' : priceStructure === 'LL_LH' ? 'text-red-400' : undefined} />
            <ExecMapRow label="Setup Flag" value={secondaryBreakout ? '2nd Breakout' : orRetest ? 'OR Re-test' : '—'} tone={secondaryBreakout || orRetest ? 'text-emerald-400' : undefined} />
          </div>
          <div className="rounded-xl border border-gray-800/90 bg-black/15 px-3 py-3 space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-600">Entry Gate</div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge text={eg?.should_enter_now === 'HOLD' ? 'HOLD — MANAGE POSITION' : confirmationState === 'CLEAR' ? (eg?.should_enter_now === 'YES' ? 'ENTER NOW' : 'READY') : 'PENDING'} tone={eg?.should_enter_now === 'HOLD' ? 'orange' : confirmationState === 'CLEAR' ? 'green' : 'orange'} />
              <span className="text-[10px] text-gray-500">
                {eg?.should_enter_now === 'HOLD'
                  ? 'Price pulling back from peak — hold existing position, no new entries.'
                  : confirmationState === 'CLEAR' ? 'All entry conditions are satisfied.' : 'Waiting for conditions below.'}
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
            <h2 className="mt-1 text-sm font-bold text-heading">Option Execution Context</h2>
            <p className="mt-1 text-xs text-gray-400">Use options only if the intraday setup is valid and the contract quality is still tradable.</p>
          </div>
          {hasOptionOverlay ? (
            <div className={`rounded-xl border px-3 py-3 space-y-3 ${optionRiskChrome(optionWarning, hasListedOptions)}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-600">Intraday option awareness</div>
                  <div className="mt-1 text-xs text-gray-400">This does not change the day-trade signal. It only warns about execution friction.</div>
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
        </div>

        <div className={`px-4 py-4 border-b border-gray-800 space-y-3${focusStep === 5 ? ` ${focusBorderLeft}` : ''}`}>
          <div>
            <div className="flex items-center gap-2">
              <div className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${focusStep === 5 ? focusToneText : 'text-semantic-info'}`}>Step 5</div>
              {focusStep === 5 && <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest ${TONE_BADGE[decisionTone]}`}><Activity size={8} />{focusBadgeText}</span>}
            </div>
            <h2 className="mt-1 text-sm font-bold text-heading">Final Intraday Decision</h2>
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
                  <Badge text={result.execution_timing || result.execution_readiness || 'WAIT'} tone={actionTone(result.execution_timing || result.execution_readiness)} />
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
              {eg?.avoid && (
                <div className="flex items-start gap-1.5 text-xs text-semantic-bearish bg-semantic-bearish-bg border border-semantic-bearish-border rounded-lg px-3 py-2">
                  <ShieldAlert size={12} className="shrink-0 mt-0.5" />
                  {eg.avoid}
                </div>
              )}
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
            <h2 className="mt-1 text-sm font-bold text-heading">Intraday Management Plan</h2>
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
            <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-600 mb-2">Management Checklist</div>
            <div className="space-y-1.5">
              {managementPlan.map((item, index) => (
                <div key={index} className="flex items-start gap-1.5 text-[11px] text-gray-300 leading-relaxed">
                  <span className="mt-1.5 h-1 w-1 rounded-full bg-sky-500 shrink-0" />
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>)}
    </div>
  )
}
