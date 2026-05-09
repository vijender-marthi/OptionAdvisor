/**
 * Shared tone + badge classes for swing trade engine UI (panel + watchlist cards).
 *
 * Primary messaging for the engine UI is `final_action` (structured trade cue), not the
 * aggregate score `verdict` string — keep watchlist collapsed copy aligned with the panel.
 */

import type { SwingTradeScanResult } from '../api/client'

export type Tone = 'green' | 'blue' | 'orange' | 'red' | 'gray'

/** Server playbook line — same source as `SwingTradeEnginePanel` options playbook block. */
export function playbookHintFromResult(result: SwingTradeScanResult): string {
  const m = result.metrics as Record<string, unknown>
  const raw = result.playbook_hint || (typeof m.playbook_hint === 'string' ? m.playbook_hint : '')
  return String(raw ?? '').trim()
}

/** Secondary badge row: Bias → Entry → Risk → Market (if any). Matches panel order below the main action. */
export function swingEngineSecondaryBadgeItems(result: SwingTradeScanResult): Array<{ label: string; text: string; tone: Tone }> {
  const m = result.metrics as Record<string, unknown>
  const marketCtx = typeof m.market_context === 'string' ? m.market_context : null
  const items: Array<{ label: string; text: string; tone: Tone }> = [
    { label: 'Bias', text: result.swing_bias, tone: toneForBias(result.swing_bias) },
    { label: 'Entry', text: result.entry_quality, tone: toneForEntryQuality(result.entry_quality) },
    { label: 'Risk', text: result.risk_level, tone: toneForRisk(result.risk_level) },
  ]
  if (marketCtx) {
    items.push({ label: 'Market', text: marketCtx, tone: toneForMarketContext(marketCtx) })
  }
  return items
}

/** Card / expanded-section chrome from final_action tone (not aggregate verdict). */
export function swingEngineWatchlistRowRingClass(tone: Tone): string {
  if (tone === 'green') return 'ring-1 ring-emerald-500/20'
  if (tone === 'blue') return 'ring-1 ring-sky-500/25'
  if (tone === 'orange') return 'ring-1 ring-amber-500/20'
  if (tone === 'red') return 'ring-1 ring-rose-500/20'
  return 'ring-1 ring-violet-500/15'
}

export function swingEngineWatchlistExpandedShellClasses(tone: Tone): string {
  if (tone === 'green')
    return 'border-l-emerald-500 bg-emerald-950/20 ring-1 ring-inset ring-emerald-500/15'
  if (tone === 'blue')
    return 'border-l-sky-500 bg-gray-950/40 ring-1 ring-inset ring-sky-500/15'
  if (tone === 'orange')
    return 'border-l-amber-400 bg-amber-950/30 ring-1 ring-inset ring-amber-500/15'
  if (tone === 'red')
    return 'border-l-rose-500 bg-rose-950/25 ring-1 ring-inset ring-rose-500/15'
  return 'border-l-violet-500/70 bg-gray-950/40 ring-1 ring-inset ring-violet-500/10'
}

/** Top accent bar in watchlist expanded details — matches `final_action` tone (panel ring). */
export function swingEngineWatchlistExpandedAccentBarClass(tone: Tone): string {
  if (tone === 'green')
    return 'swing-tone-bar mb-4 h-1.5 w-full rounded-md bg-emerald-500 shadow-[0_0_14px_rgba(16,185,129,0.35)]'
  if (tone === 'blue')
    return 'swing-tone-bar mb-4 h-1.5 w-full rounded-md bg-sky-500 shadow-[0_0_14px_rgba(14,165,233,0.32)]'
  if (tone === 'orange')
    return 'swing-tone-bar mb-4 h-1.5 w-full rounded-md bg-amber-500 shadow-[0_0_14px_rgba(245,158,11,0.3)]'
  if (tone === 'red')
    return 'swing-tone-bar mb-4 h-1.5 w-full rounded-md bg-rose-500 shadow-[0_0_14px_rgba(244,63,94,0.32)]'
  return 'swing-tone-bar mb-4 h-1 w-full rounded-md bg-slate-600/45'
}

export function toneForFinalAction(fa: string): Tone {
  if (fa === 'READY' || fa === 'TRADE' || fa === 'STRONG_GO') return 'green'
  if (fa === 'WATCH' || fa === 'WATCH_CALL_OR_DEBIT_SPREAD' || fa === 'WATCH_CALL' || fa === 'WATCH_PUT' || fa === 'GO_SMALL') return 'blue'
  if (fa === 'WAIT' || fa === 'WAIT_PULLBACK' || fa === 'WAIT_BREAKOUT' || fa === 'WAIT_FOR_BREAKDOWN' || fa === 'AVOID_CHASE') return 'orange'
  if (fa === 'AVOID' || fa === 'EXIT' || fa === 'NO_EDGE' || fa === 'AVOID_NAKED_CALLS' || fa === 'NO_TRADE') return 'red'
  return 'gray'
}

export function toneForRisk(rl: string): Tone {
  if (rl === 'LOW')       return 'green'
  if (rl === 'MEDIUM')    return 'blue'
  if (rl === 'HIGH')      return 'orange'
  if (rl === 'VERY_HIGH') return 'red'
  return 'gray'
}

export function toneForEntryQuality(eq: string): Tone {
  if (eq === 'GOOD_ENTRY')               return 'green'
  if (eq === 'MARKET_CONFIRMATION_ONLY') return 'gray'
  if (eq === 'CAUTION_ENTRY') return 'orange'
  if (eq === 'WAIT_PULLBACK' || eq === 'WAIT_BREAKOUT_CONFIRMATION' || eq === 'NO_CLEAN_ENTRY') return 'orange'
  if (eq === 'LATE_ENTRY' || eq === 'BAD_ENTRY' || eq === 'EXTENDED_RISK') return 'red'
  return 'gray'
}

export function toneForBias(bias: string): Tone {
  if (bias === 'STRONG_BULLISH' || bias === 'BULLISH') return 'green'
  if (bias === 'NEUTRAL') return 'gray'
  if (bias === 'BEARISH' || bias === 'STRONG_BEARISH') return 'orange'
  return 'gray'
}

export function toneForMarketContext(mc: string | null | undefined): Tone {
  if (mc === 'MARKET_SUPPORTIVE') return 'green'
  if (mc === 'MARKET_WEAK')     return 'red'
  return 'gray'
}

export const TONE_BADGE: Record<Tone, string> = {
  green:  'bg-emerald-500/15 text-emerald-300 border border-emerald-600/40',
  blue:   'bg-sky-500/15 text-sky-300 border border-sky-600/40',
  orange: 'bg-amber-500/15 text-amber-300 border border-amber-600/40',
  red:    'bg-rose-500/15 text-rose-300 border border-rose-700/40',
  gray:   'bg-gray-700/50 text-gray-400 border border-gray-600/40',
}

export const TONE_RING: Record<Tone, string> = {
  green:  'ring-2 ring-emerald-500/30',
  blue:   'ring-2 ring-sky-500/25',
  orange: 'ring-2 ring-amber-500/25',
  red:    'ring-2 ring-rose-600/30',
  gray:   'ring-1 ring-gray-700/60',
}

export const TONE_DOT: Record<Tone, string> = {
  green:  'bg-emerald-400',
  blue:   'bg-sky-400',
  orange: 'bg-amber-400',
  red:    'bg-rose-400',
  gray:   'bg-gray-500',
}

/** Filled badge for primary final_action emphasis */
export const TONE_ACTION_BADGE: Record<Tone, string> = {
  green:  'bg-emerald-600 text-white',
  blue:   'bg-sky-600 text-white',
  orange: 'bg-amber-600 text-white',
  red:    'bg-rose-700 text-white',
  gray:   'bg-gray-700 text-gray-200',
}

export function formatSwingEngineLabel(s: string): string {
  return s.replace(/_/g, ' ')
}
