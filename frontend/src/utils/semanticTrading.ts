export type SemanticActionType = 'analyze' | 'trade' | 'alert' | 'surface'
export type MetricChipMetric = 'rsi' | 'relative_strength' | 'volume_ratio' | 'iv_rank' | 'trend'
export type PositionCategoryKind = 'day' | 'swing' | 'regular'

// ─── Unified Verdict ─────────────────────────────────────────────────────────
// Single source of truth for verdict display across all cards and pages.
// All three engines (day, swing, regular) emit one of these six values.

export type UnifiedVerdict = 'STRONG_GO' | 'GO' | 'TRIGGER_PENDING' | 'WATCH' | 'WAIT' | 'AVOID' | 'NO_EDGE'

const VERDICT_DISPLAY: Record<UnifiedVerdict, string> = {
  STRONG_GO:       'Strong Go',
  GO:              'Go',
  TRIGGER_PENDING: 'Waiting for Trigger',
  WATCH:           'Watch',
  WAIT:            'Wait',
  AVOID:           'Avoid',
  NO_EDGE:         'No Edge',
}

const VERDICT_TONE: Record<UnifiedVerdict, SemanticTone> = {
  STRONG_GO:       'bullish',
  GO:              'bullish',
  TRIGGER_PENDING: 'warning',
  WATCH:           'warning',
  WAIT:            'warning',
  AVOID:           'bearish',
  NO_EDGE:         'neutral',
}

/** Display label for a unified verdict. */
export function verdictLabel(v: string): string {
  return VERDICT_DISPLAY[v as UnifiedVerdict] ?? v
}

/** Badge CSS classes for a unified verdict. */
export function verdictBadgeClass(v: string): string {
  const tone = VERDICT_TONE[v as UnifiedVerdict] ?? 'neutral'
  return badgeToneClass(tone)
}

/** Normalize any legacy verdict string to a UnifiedVerdict. */
export function normalizeToUnifiedVerdict(raw: string): UnifiedVerdict {
  const v = String(raw || '').trim().toUpperCase().replace(/ /g, '_').replace(/-/g, '_')
  if (v === 'STRONG_GO')                          return 'STRONG_GO'
  if (['TRIGGER_PENDING', 'PENDING', 'WAITING_FOR_TRIGGER'].includes(v)) return 'TRIGGER_PENDING'
  if (['GO', 'READY', 'ENTER', 'TRADE'].includes(v)) return 'GO'
  if (v === 'WATCH')                              return 'WATCH'
  if (v === 'WAIT')                               return 'WAIT'
  if (['AVOID', 'NO_GO', 'NO_TRADE'].includes(v)) return 'AVOID'
  return 'NO_EDGE'
}

type SemanticTone =
  | 'bullish'
  | 'bearish'
  | 'warning'
  | 'extended'
  | 'conflict'
  | 'manage'
  | 'supportive'
  | 'accent'
  | 'info'
  | 'neutral'

function badgeToneClass(tone: SemanticTone): string {
  switch (tone) {
    case 'bullish':
      return 'border-semantic-bullish-border bg-semantic-bullish-bg text-semantic-bullish'
    case 'bearish':
      return 'border-semantic-bearish-border bg-semantic-bearish-bg text-semantic-bearish'
    case 'warning':
      return 'border-semantic-warning-border bg-semantic-warning-bg text-semantic-warning'
    case 'extended':
      return 'border-semantic-extended-border bg-semantic-extended-bg text-semantic-extended'
    case 'conflict':
      return 'border-semantic-conflict-border bg-semantic-conflict-bg text-semantic-conflict'
    case 'manage':
      return 'border-semantic-manage-border bg-semantic-manage-bg text-semantic-manage'
    case 'supportive':
      return 'border-semantic-supportive-border bg-semantic-supportive-bg text-semantic-supportive'
    case 'accent':
      return 'border-semantic-accent-border bg-semantic-accent-bg text-semantic-accent'
    case 'info':
      return 'border-semantic-info-border bg-semantic-info-bg text-semantic-info'
    default:
      return 'border-semantic-neutral-border bg-semantic-neutral-bg text-semantic-neutral'
  }
}

function normalizeDecisionTone(status: string): SemanticTone {
  const value = String(status || '').trim().toUpperCase()
  if (['READY', 'TRADE', 'GO', 'STRONG_GO', 'STRONG GO'].includes(value)) return 'bullish'
  if (['TRIGGER_PENDING', 'PENDING', 'WAITING FOR TRIGGER', 'WAITING_FOR_TRIGGER'].includes(value)) return 'warning'
  if (['WATCH', 'WAIT', 'HOLD'].includes(value)) return 'warning'
  if (value === 'EXTENDED') return 'extended'
  if (['AVOID', 'EXIT', 'NO_EDGE', 'SKIP'].includes(value)) return 'bearish'
  if (value === 'CONFLICT') return 'conflict'
  if (['MANAGE', 'SCALE_OUT'].includes(value)) return 'manage'
  if (value === 'LOW') return 'bullish'
  if (value === 'MEDIUM') return 'warning'
  if (value === 'HIGH') return 'bearish'
  if (value.includes('SUPPORTIVE')) return 'supportive'
  if (value === 'BULLISH') return 'bullish'
  if (value === 'BEARISH') return 'bearish'
  return 'neutral'
}

export function getDecisionBadgeClass(status: string): string {
  return badgeToneClass(normalizeDecisionTone(status))
}

export function getAgreementBadgeClass(status: string): string {
  const value = String(status || '').trim().toUpperCase()
  if (value === 'STRONG_AGREEMENT') return badgeToneClass('bullish')
  if (value === 'PARTIAL_AGREEMENT') return badgeToneClass('warning')
  if (value === 'CONFLICT') return badgeToneClass('conflict')
  if (value === 'EXTENDED') return badgeToneClass('extended')
  if (value === 'MANAGE') return badgeToneClass('manage')
  if (value === 'NO_EDGE') return badgeToneClass('bearish')
  return getDecisionBadgeClass(value)
}

export function getMarketContextBadgeClass(status: string): string {
  const value = String(status || '').trim().toUpperCase()
  if (value.includes('SUPPORTIVE')) return badgeToneClass('supportive')
  if (value.includes('BULL')) return badgeToneClass('bullish')
  if (value.includes('BEAR') || value.includes('WEAK') || value.includes('REVERSAL')) return badgeToneClass('bearish')
  if (value.includes('RISK') || value.includes('MIXED') || value.includes('NEUTRAL')) return badgeToneClass('warning')
  return badgeToneClass('neutral')
}

export function getTrendTextClass(value: string): string {
  const trend = String(value || '').toLowerCase()
  if (trend.includes('up') || trend.includes('bull')) return 'text-semantic-bullish'
  if (trend.includes('down') || trend.includes('bear')) return 'text-semantic-bearish'
  return 'text-tertiary'
}

export function getRiskTextClass(value: string): string {
  const risk = String(value || '').toLowerCase()
  if (risk.includes('low')) return 'text-semantic-bullish'
  if (risk.includes('high')) return 'text-semantic-bearish'
  return 'text-semantic-warning'
}

export function getBiasBadgeClass(value: string): string {
  const text = String(value || '').trim().toUpperCase()
  if (text.includes('BULL')) return badgeToneClass('bullish')
  if (text.includes('BEAR')) return badgeToneClass('bearish')
  if (text.includes('SUPPORTIVE')) return badgeToneClass('supportive')
  return badgeToneClass('neutral')
}

export function getMetricChipAppearance(metric: MetricChipMetric, value: number | null, rawTrend?: string): {
  container: string
  value: string
} {
  let tone: SemanticTone = 'neutral'

  if (metric === 'rsi') {
    if (value !== null && value > 70) tone = 'extended'
    else if (value !== null && value < 30) tone = 'info'
  } else if (metric === 'relative_strength') {
    if (value !== null && value > 0) tone = 'bullish'
    else if (value !== null && value < 0) tone = 'bearish'
  } else if (metric === 'volume_ratio') {
    if (value !== null && value > 1.2) tone = 'bullish'
  } else if (metric === 'iv_rank') {
    if (value !== null && value >= 70) tone = 'extended'
    else if (value !== null && value >= 55) tone = 'warning'
  } else if (metric === 'trend') {
    const trend = String(rawTrend || '').toLowerCase()
    if (trend.includes('up') || trend.includes('bull')) tone = 'bullish'
    else if (trend.includes('down') || trend.includes('bear')) tone = 'bearish'
  }

  let valueClass = 'text-primary'
  switch (tone) {
    case 'warning':
      valueClass = 'text-semantic-warning'
      break
    case 'extended':
      valueClass = 'text-semantic-extended'
      break
    case 'info':
      valueClass = 'text-semantic-info'
      break
    case 'bullish':
      valueClass = 'text-semantic-bullish'
      break
    case 'bearish':
      valueClass = 'text-semantic-bearish'
      break
    default:
      valueClass = 'text-primary'
      break
  }

  return {
    container: badgeToneClass(tone),
    value: valueClass,
  }
}

export function getActionButtonClass(type: SemanticActionType): string {
  if (type === 'analyze') return 'btn btn-analyze'
  if (type === 'trade') return 'btn btn-trade'
  if (type === 'alert') return 'btn btn-alert'
  return 'btn btn-surface'
}

export function getPositionCategoryClass(kind: PositionCategoryKind): string {
  if (kind === 'day') return badgeToneClass('extended')
  if (kind === 'swing') return badgeToneClass('supportive')
  return badgeToneClass('accent')
}

export function getGuidanceToneClass(tone: string): string {
  if (tone === 'green') return badgeToneClass('bullish')
  if (tone === 'orange') return badgeToneClass('warning')
  if (tone === 'red') return badgeToneClass('bearish')
  return badgeToneClass('neutral')
}

export function getProfitLossTextClass(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'text-tertiary'
  if (value > 0) return 'text-semantic-bullish'
  if (value < 0) return 'text-semantic-bearish'
  return 'text-tertiary'
}
