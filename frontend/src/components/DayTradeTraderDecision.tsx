import type { DayTraderDecision } from '../api/client'

type BadgeTone = 'green' | 'red' | 'orange' | 'gray'

export function coerceTraderDecision(raw: unknown): DayTraderDecision | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Record<string, unknown>
  const str = (k: string) => (typeof d[k] === 'string' ? d[k] as string : '')
  const arr = (k: string): string[] =>
    Array.isArray(d[k]) ? (d[k] as unknown[]).filter(x => typeof x === 'string') as string[] : []
  if (!str('trader_state')) return null
  return {
    ticker: str('ticker'),
    market_state: str('market_state'),
    market_guidance: str('market_guidance'),
    relative_strength: str('relative_strength'),
    trader_state: str('trader_state'),
    call_bias: str('call_bias'),
    put_bias: str('put_bias'),
    suggested_action: str('suggested_action'),
    decision_message: str('decision_message'),
    risk_warning: str('risk_warning'),
    confirmation_needed: arr('confirmation_needed'),
  }
}

const TRADER_STATE_HEADLINE: Record<string, string> = {
  STRONG_RELATIVE_STRENGTH: 'Strong RS · Long watch',
  RELATIVE_STRENGTH_LONG_WATCH: 'RS vs QQQ · Long watch',
  LONG_CONFIRMATION_WATCH: 'Long · Confirmation',
  AVOID_CALLS: 'Avoid calls',
  WEAK_BREAKDOWN_WATCH: 'Put breakdown watch',
  VERY_WEAK_EXTENDED: 'Extended down',
  NEUTRAL_WEAK: 'Neutral · Wait',
  NO_TRADE_WAIT: 'No trade · Wait',
  BROAD_MARKET_WEAK: 'Market weak',
  BROAD_MARKET_SUPPORTIVE: 'Market supportive',
  BROAD_MARKET_MIXED: 'Market mixed',
}

export function traderDecisionHeadline(state: string): string {
  return TRADER_STATE_HEADLINE[state] ?? 'Trader view'
}

/** Normalize chip text so we do not show the same phrase in the headline and a badge (watchlist row). */
function normChip(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s*·\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function badgesDedupedAgainstHeadline(
  headline: string,
  badges: { key: string; label: string; tone: BadgeTone }[],
): { key: string; label: string; tone: BadgeTone }[] {
  const hn = normChip(headline)
  return badges.filter(b => {
    const bn = normChip(b.label)
    if (!bn) return false
    if (hn === bn) return false
    if (hn.includes(bn)) return false
    return true
  })
}

const toneBadge: Record<BadgeTone, string> = {
  green:
    'day-trade-trader-badge day-trade-trader-badge--green border-emerald-600/45 bg-emerald-950/40 text-emerald-200',
  red: 'day-trade-trader-badge day-trade-trader-badge--red border-rose-600/45 bg-rose-950/40 text-rose-200',
  orange:
    'day-trade-trader-badge day-trade-trader-badge--orange border-amber-600/45 bg-amber-950/40 text-amber-200',
  gray: 'day-trade-trader-badge day-trade-trader-badge--gray border-gray-600/50 bg-gray-800/70 text-gray-300',
}

function marketBadge(marketState: string): { label: string; tone: BadgeTone } | null {
  if (marketState === 'MARKET_WEAK') return { label: 'Market weak', tone: 'orange' }
  if (marketState === 'MARKET_SUPPORTIVE') return { label: 'Market supportive', tone: 'green' }
  if (marketState === 'MARKET_MIXED') return { label: 'Market mixed', tone: 'gray' }
  return null
}

/** Compact badges for collapsed watchlist rows (semantic colors — not buy/sell). */
export function traderDecisionBadgeList(td: DayTraderDecision): { key: string; label: string; tone: BadgeTone }[] {
  const out: { key: string; label: string; tone: BadgeTone }[] = []
  const mb = marketBadge(td.market_state)
  if (mb && !td.trader_state.startsWith('BROAD_MARKET'))
    out.push({ key: 'mkt', ...mb })

  switch (td.trader_state) {
    case 'STRONG_RELATIVE_STRENGTH':
      out.push({ key: 'rs', label: 'Relative strength', tone: 'green' })
      out.push({ key: 'lw', label: 'Long watch', tone: 'green' })
      break
    case 'RELATIVE_STRENGTH_LONG_WATCH':
      out.push({ key: 'rs', label: 'Relative strength', tone: 'green' })
      out.push({ key: 'lw', label: 'Long watch', tone: 'green' })
      break
    case 'LONG_CONFIRMATION_WATCH':
      out.push({ key: 'cf', label: 'Confirmation req.', tone: 'green' })
      break
    case 'AVOID_CALLS':
      out.push({ key: 'ac', label: 'Avoid calls', tone: 'orange' })
      break
    case 'WEAK_BREAKDOWN_WATCH':
      out.push({ key: 'pw', label: 'Put breakdown watch', tone: 'red' })
      break
    case 'VERY_WEAK_EXTENDED':
      // Headline is already "Extended down" — only add non-redundant badge.
      out.push({ key: 'ap', label: 'Avoid late puts', tone: 'orange' })
      break
    case 'NEUTRAL_WEAK':
    case 'NO_TRADE_WAIT':
      out.push({ key: 'wt', label: 'No trade', tone: 'gray' })
      break
    case 'BROAD_MARKET_WEAK':
      out.push({ key: 'bm', label: 'Market weak', tone: 'orange' })
      break
    case 'BROAD_MARKET_SUPPORTIVE':
      out.push({ key: 'bm', label: 'Market supportive', tone: 'green' })
      break
    case 'BROAD_MARKET_MIXED':
      out.push({ key: 'bm', label: 'Market mixed', tone: 'gray' })
      break
    default:
      break
  }
  return out.slice(0, 4)
}

export function DayTradeTraderDecisionChips({
  td,
  className = '',
}: {
  td: DayTraderDecision
  className?: string
}) {
  const head = traderDecisionHeadline(td.trader_state)
  const badges = badgesDedupedAgainstHeadline(head, traderDecisionBadgeList(td))
  return (
    <div className={`flex flex-wrap items-center gap-1 ${className}`}>
      <span
        title={td.decision_message}
        className="day-trade-trader-headline text-[9px] font-bold uppercase tracking-wide rounded px-1.5 py-px border border-violet-600/40 bg-violet-950/30 text-violet-200/95 max-w-[11rem] truncate"
      >
        {head}
      </span>
      {badges.map(b => (
        <span
          key={b.key}
          className={`text-[9px] font-semibold uppercase tracking-wide rounded px-1.5 py-px border shrink-0 ${toneBadge[b.tone]}`}
        >
          {b.label}
        </span>
      ))}
    </div>
  )
}

export function DayTradeTraderDecisionExpanded({ td }: { td: DayTraderDecision }) {
  const conf = td.confirmation_needed.filter(Boolean)
  return (
    <div className="day-trade-trader-expanded rounded-xl border border-violet-900/40 bg-violet-950/20 px-3 py-2.5 space-y-2">
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-400">
        <span>
          <span className="text-gray-500">Tape</span>{' '}
          <span className="text-gray-200 font-medium">{td.market_state.replace(/_/g, ' ')}</span>
        </span>
        <span>
          <span className="text-gray-500">vs QQQ</span>{' '}
          <span className="text-gray-200 font-medium">{td.relative_strength}</span>
        </span>
        <span>
          <span className="text-gray-500">Calls</span>{' '}
          <span className="text-gray-200 font-medium">{td.call_bias.replace(/_/g, ' ')}</span>
          <span className="text-gray-600 mx-1">·</span>
          <span className="text-gray-500">Puts</span>{' '}
          <span className="text-gray-200 font-medium">{td.put_bias.replace(/_/g, ' ')}</span>
        </span>
      </div>
      <p className="text-sm text-gray-200 leading-snug">{td.decision_message}</p>
      <p className="text-[11px] text-amber-200/85 leading-snug">{td.risk_warning}</p>
      {td.market_guidance ? (
        <p className="text-[10px] text-amber-600/90 dark:text-amber-400/85 leading-snug border-t border-gray-800/80 pt-2">
          <span className="font-semibold text-amber-700 dark:text-amber-300">Market context:</span> {td.market_guidance}
        </p>
      ) : null}
      {conf.length > 0 ? (
        <div className="text-[10px] text-gray-500">
          <span className="font-semibold text-gray-400 uppercase tracking-wide">Confirmation ideas</span>
          <ul className="mt-1 list-disc list-inside space-y-0.5">
            {conf.slice(0, 8).map(c => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-[10px] text-gray-600 uppercase tracking-wide">
        Suggested posture:{' '}
        <span className="text-gray-400 font-semibold">{td.suggested_action.replace(/_/g, ' ')}</span>
      </p>
    </div>
  )
}
