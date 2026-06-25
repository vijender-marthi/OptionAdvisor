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
  if (tone === 'green') return 'ring-1 ring-semantic-bullish-border'
  if (tone === 'blue') return 'ring-1 ring-semantic-info-border'
  if (tone === 'orange') return 'ring-1 ring-semantic-warning-border'
  if (tone === 'red') return 'ring-1 ring-semantic-bearish-border'
  return 'ring-1 ring-semantic-accent-border'
}

export function swingEngineWatchlistExpandedShellClasses(tone: Tone): string {
  if (tone === 'green')
    return 'border-l-4 border-l-semantic-bullish bg-semantic-bullish-bg ring-1 ring-inset ring-semantic-bullish-border'
  if (tone === 'blue')
    return 'border-l-4 border-l-semantic-info bg-surface-card ring-1 ring-inset ring-semantic-info-border'
  if (tone === 'orange')
    return 'border-l-4 border-l-semantic-warning bg-semantic-warning-bg ring-1 ring-inset ring-semantic-warning-border'
  if (tone === 'red')
    return 'border-l-4 border-l-semantic-bearish bg-semantic-bearish-bg ring-1 ring-inset ring-semantic-bearish-border'
  return 'border-l-4 border-l-semantic-accent bg-surface-card ring-1 ring-inset ring-semantic-accent-border'
}

/** Top accent bar in watchlist expanded details — matches `final_action` tone (panel ring). */
export function swingEngineWatchlistExpandedAccentBarClass(tone: Tone): string {
  if (tone === 'green')
    return 'swing-tone-bar mb-4 h-1.5 w-full rounded-md bg-semantic-bullish'
  if (tone === 'blue')
    return 'swing-tone-bar mb-4 h-1.5 w-full rounded-md bg-semantic-info'
  if (tone === 'orange')
    return 'swing-tone-bar mb-4 h-1.5 w-full rounded-md bg-semantic-warning'
  if (tone === 'red')
    return 'swing-tone-bar mb-4 h-1.5 w-full rounded-md bg-semantic-bearish'
  return 'swing-tone-bar mb-4 h-1 w-full rounded-md bg-semantic-neutral-border'
}

export function toneForFinalAction(fa: string): Tone {
  if (fa === 'READY' || fa === 'TRADE' || fa === 'STRONG_GO' || fa === 'GO' || fa === 'GO_SMALL') return 'green'
  if (fa === 'WATCH' || fa === 'WATCH_CALL_OR_DEBIT_SPREAD' || fa === 'WATCH_CALL' || fa === 'WATCH_PUT') return 'blue'
  if (fa === 'WAIT' || fa === 'WAIT_PULLBACK' || fa === 'WAIT_BREAKOUT' || fa === 'WAIT_FOR_BREAKDOWN' || fa === 'AVOID_CHASE') return 'orange'
  if (fa === 'AVOID' || fa === 'EXIT' || fa === 'NO_EDGE' || fa === 'AVOID_NAKED_CALLS' || fa === 'NO_TRADE') return 'red'
  return 'gray'
}

/** Tone for unified verdict (STRONG_GO | GO | WATCH | WAIT | AVOID | NO_EDGE). */
export function toneForVerdict(v: string): Tone {
  if (v === 'STRONG_GO' || v === 'GO') return 'green'
  if (v === 'WATCH')                   return 'blue'
  if (v === 'WAIT')                    return 'orange'
  if (v === 'AVOID')                   return 'red'
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
  green:  'border-semantic-bullish-border bg-semantic-bullish-bg text-semantic-bullish',
  blue:   'border-semantic-info-border bg-semantic-info-bg text-semantic-info',
  orange: 'border-semantic-warning-border bg-semantic-warning-bg text-semantic-warning',
  red:    'border-semantic-bearish-border bg-semantic-bearish-bg text-semantic-bearish',
  gray:   'border-semantic-neutral-border bg-semantic-neutral-bg text-semantic-neutral',
}

export const TONE_RING: Record<Tone, string> = {
  green:  'ring-1 ring-semantic-bullish-border',
  blue:   'ring-1 ring-semantic-info-border',
  orange: 'ring-1 ring-semantic-warning-border',
  red:    'ring-1 ring-semantic-bearish-border',
  gray:   'ring-1 ring-border',
}

export const TONE_DOT: Record<Tone, string> = {
  green:  'bg-semantic-bullish',
  blue:   'bg-semantic-info',
  orange: 'bg-semantic-warning',
  red:    'bg-semantic-bearish',
  gray:   'bg-semantic-neutral',
}

/** Filled badge for primary final_action emphasis */
export const TONE_ACTION_BADGE: Record<Tone, string> = {
  green:  'border border-semantic-bullish-border bg-semantic-bullish-bg text-semantic-bullish',
  blue:   'border border-semantic-info-border bg-semantic-info-bg text-semantic-info',
  orange: 'border border-semantic-warning-border bg-semantic-warning-bg text-semantic-warning',
  red:    'border border-semantic-bearish-border bg-semantic-bearish-bg text-semantic-bearish',
  gray:   'border border-semantic-neutral-border bg-semantic-neutral-bg text-semantic-neutral',
}

export function formatSwingEngineLabel(s: string): string {
  return s.replace(/_/g, ' ')
}
