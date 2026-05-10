import { useEffect, useState } from 'react'
import axios from 'axios'
import { RefreshCw, TrendingUp } from 'lucide-react'
import { fetchMarketPosition } from '../api/commandCenter'
import type { MarketPositionData } from '../api/commandCenter'

// ─── Tooltip ─────────────────────────────────────────────────────────────────
// Small ⓘ icon that reveals a styled popover on hover.
// `side` controls whether the popover opens above or below the icon.
function Tip({
  text,
  side = 'top',
  align = 'center',
}: {
  text: string
  side?: 'top' | 'bottom'
  align?: 'left' | 'center' | 'right'
}) {
  const hPos =
    align === 'left'
      ? 'left-0 translate-x-0'
      : align === 'right'
      ? 'right-0 translate-x-0'
      : 'left-1/2 -translate-x-1/2'

  const vPos =
    side === 'top'
      ? 'bottom-full mb-2'
      : 'top-full mt-2'

  return (
    <span className="group/tip relative ml-1 inline-flex shrink-0 items-center">
      {/* Trigger icon */}
      <span className="inline-flex h-3.5 w-3.5 cursor-help select-none items-center justify-center rounded-full border border-slate-300 dark:border-slate-600 text-[9px] font-bold leading-none text-slate-400 dark:text-slate-500 transition-colors hover:border-violet-400 hover:text-violet-500">
        ?
      </span>
      {/* Popover */}
      <span
        className={`pointer-events-none absolute z-50 ${vPos} ${hPos} w-60 rounded-xl border border-slate-200 dark:border-white/[0.12] bg-white dark:bg-slate-800 px-3 py-2.5 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300 shadow-2xl opacity-0 transition-opacity duration-150 group-hover/tip:opacity-100 whitespace-normal`}
      >
        {text}
        {/* Arrow */}
        {side === 'top' ? (
          <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-200 dark:border-t-white/[0.12]" />
        ) : (
          <span className="absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent border-b-slate-200 dark:border-b-white/[0.12]" />
        )}
      </span>
    </span>
  )
}

// ─── Tooltip copy ─────────────────────────────────────────────────────────────
const TIPS = {
  reserveSignal:
    'The 25% Reserve Rule: keep roughly 25% of equity exposure in cash when the market is extended. This card shows SPY vs its 200-day MA and 52-week high to guide when to deploy or protect that reserve.',

  vs200MA:
    'Measures how far SPY\'s current price sits above or below its 200-day moving average.\n\n+10% or more → market is overheating → Trim\n+2% to +10% → healthy trend → Hold\n–2% to +2% → neutral zone → Hold\n–2% to –8% → pullback opportunity → Add\nBelow –8% → deep drawdown → Wait for stabilisation',

  high52w:
    'Distance from SPY\'s highest closing price over the last 52 weeks.\n\nBreakout → SPY set a new 52-week high\nAt High → within 0.5% of peak\nNear High → 0.5%–5% below peak — momentum intact\nFar below → more than 5% off the high — trend may be weakening',

  actionTrim:
    'SPY is well above its 200-day MA. The market is extended. Consider reducing equity exposure and rebuilding your 25% cash reserve.',
  actionHold:
    'SPY is within a normal range of its 200-day MA. Maintain your current allocation and monitor for changes.',
  actionAdd:
    'SPY has pulled back from its 200-day MA. This is historically a good zone to deploy reserve cash into new positions.',
  actionWait:
    'SPY is deeply below its 200-day MA. Preserve capital. Wait for a stabilisation signal — a bounce and reclaim of the MA — before re-entering.',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function actionHint(distPct: number, drawdownPct: number): { label: string; color: string; cls: string; tip: string } {
  if (distPct >= 10) return { label: 'Trim', color: '#ef4444', cls: 'bg-red-500/15 text-red-300 border-red-600/30', tip: TIPS.actionTrim }
  if (distPct >= 5)  return { label: 'Trim', color: '#f97316', cls: 'bg-orange-500/15 text-orange-300 border-orange-600/30', tip: TIPS.actionTrim }
  if (distPct >= 2)  return { label: 'Hold', color: '#f59e0b', cls: 'bg-amber-500/15 text-amber-300 border-amber-600/30', tip: TIPS.actionHold }
  if (distPct >= -2) return { label: 'Hold', color: '#3b82f6', cls: 'bg-blue-500/15 text-blue-300 border-blue-600/30', tip: TIPS.actionHold }
  if (distPct >= -8) return { label: 'Add',  color: '#22c55e', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-600/30', tip: TIPS.actionAdd }
  return { label: 'Wait', color: '#64748b', cls: 'bg-gray-500/15 text-gray-300 border-gray-600/30', tip: TIPS.actionWait }
}

function axiosErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const d = err.response?.data as { detail?: unknown } | undefined
    if (typeof d?.detail === 'string') return d.detail
    return err.message || 'Request failed'
  }
  if (err instanceof Error) return err.message
  return 'Failed to load'
}

/** Safe formatter — prevents JavaScript's negative-zero rendering as "-0.0%" */
function fmtDist(d: number): string {
  if (Math.abs(d) < 0.05) return '0.0%'
  if (d > 0) return `+${d.toFixed(1)}%`
  return `${d.toFixed(1)}%`
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function ReserveSignalCard() {
  const [mpData, setMpData] = useState<MarketPositionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchMarketPosition()
      .then(env => {
        if (env.error) setError((env.error as { message?: string }).message ?? 'Error')
        else if (env.data) setMpData(env.data)
        else setError('No data')
      })
      .catch(err => setError(axiosErrorMessage(err)))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <RefreshCw size={11} className="animate-spin" /> Loading…
      </div>
    )
  }
  if (error || !mpData) {
    return <div className="text-xs text-gray-400">Market position unavailable</div>
  }

  const distPct = mpData.dist_200ma_pct
  const ddPct   = mpData.drawdown_pct
  const action  = actionHint(distPct, ddPct)
  const maBarPct = Math.min(100, Math.max(2, ((distPct + 15) / 30) * 100))

  // ── 52W High distance ──────────────────────────────────────────
  const high52w    = mpData.high_52w
  const rawDistance = high52w > 0 ? ((mpData.spy_price - high52w) / high52w) * 100 : 0
  const distance    = Math.abs(rawDistance) < 0.05 ? 0 : rawDistance

  // Bar: 100% = at peak; shrinks 10pp per 1% below; floor at 3%
  const fwyBarPct =
    distance >= 0
      ? 100
      : Math.min(100, Math.max(3, 100 + distance * 10))

  type FwyState = {
    value: string; valueCls: string; barColor: string
    badge: string | null; badgeCls: string; detail: string; detailCls: string
  }

  const fwy: FwyState = (() => {
    if (distance > 0) return {
      value: fmtDist(distance),
      valueCls: 'text-emerald-600 dark:text-emerald-400',
      barColor: '#10b981',
      badge: 'Breakout',
      badgeCls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30',
      detail: `${distance.toFixed(1)}% above prior high`,
      detailCls: 'text-emerald-600/70 dark:text-emerald-400/70',
    }
    if (distance > -0.5) return {
      value: '0.0%',
      valueCls: 'text-emerald-600 dark:text-emerald-400',
      barColor: '#10b981',
      badge: 'At High',
      badgeCls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30',
      detail: 'At 52-week peak',
      detailCls: 'text-slate-500 dark:text-slate-400',
    }
    if (distance > -5) return {
      value: fmtDist(distance),
      valueCls: 'text-amber-600 dark:text-amber-400',
      barColor: '#f59e0b',
      badge: 'Near High',
      badgeCls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30',
      detail: `${Math.abs(distance).toFixed(1)}% below peak`,
      detailCls: 'text-slate-500 dark:text-slate-400',
    }
    const deep = distance < -15
    return {
      value: fmtDist(distance),
      valueCls: deep ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400',
      barColor: deep ? '#ef4444' : '#64748b',
      badge: null,
      badgeCls: '',
      detail: `${Math.abs(distance).toFixed(1)}% below 52-week high`,
      detailCls: deep ? 'text-rose-600/70 dark:text-rose-400/70' : 'text-slate-400 dark:text-slate-500',
    }
  })()

  return (
    <div>
      {/* ── Section header ────────────────────────────────── */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
          <TrendingUp size={11} className="text-violet-400" />
          Reserve Signal
          <Tip text={TIPS.reserveSignal} side="bottom" align="left" />
        </div>
        <div className="flex items-center gap-1.5 text-xs font-mono">
          <span className="text-gray-400">SPY</span>
          <span className="font-bold text-white">${mpData.spy_price.toFixed(2)}</span>
        </div>
      </div>

      <div className="space-y-3">
        {/* ── vs 200-day MA ─────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="flex items-center text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              vs 200-day MA
              <Tip text={TIPS.vs200MA} side="top" align="left" />
            </span>
            <span
              className="font-bold font-mono text-[11px] tabular-nums"
              style={{ color: distPct >= 0 ? '#22c55e' : '#ef4444' }}
            >
              {distPct >= 0 ? '+' : ''}{distPct.toFixed(1)}%
            </span>
          </div>
          <div className="relative h-1.5 rounded-full bg-slate-100 dark:bg-gray-700/40 overflow-hidden">
            {/* Centre zero-line marker */}
            <div
              className="absolute top-0 h-full w-px bg-slate-300/60 dark:bg-white/20 z-10"
              style={{ left: `${50 - Math.min(15, Math.max(-15, distPct)) / 30 * 50 + 50}%` }}
            />
            <div className="flex h-full rounded-full overflow-hidden">
              <div className="h-full bg-rose-500/20" style={{ width: `${Math.max(0, 50 - maBarPct / 2)}%` }} />
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${maBarPct}%`, backgroundColor: action.color, opacity: 0.75 }}
              />
              <div className="h-full bg-emerald-500/20" style={{ flex: 1 }} />
            </div>
          </div>
        </div>

        {/* ── 52-week High distance ──────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="flex items-center text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              52W High
              <Tip text={TIPS.high52w} side="top" align="left" />
            </span>
            <span className={`font-bold font-mono text-[11px] tabular-nums ${fwy.valueCls}`}>
              {fwy.value}
            </span>
          </div>

          {/* Progress bar: 100% = at peak, shrinks as price falls */}
          <div className="relative h-1.5 rounded-full bg-slate-100 dark:bg-gray-700/40 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${fwyBarPct}%`, backgroundColor: fwy.barColor, opacity: 0.8 }}
            />
            {/* Peak marker at right edge */}
            <div className="absolute right-0 top-0 h-full w-0.5 bg-slate-300/50 dark:bg-white/20" />
          </div>

          {/* State badge + detail */}
          <div className="mt-1.5 flex items-center gap-1.5">
            {fwy.badge !== null && (
              <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${fwy.badgeCls}`}>
                {fwy.badge}
              </span>
            )}
            <span className={`text-[11px] leading-none ${fwy.detailCls}`}>
              {fwy.detail}
            </span>
          </div>
        </div>
      </div>

      {/* ── 200-MA action signal ───────────────────────────── */}
      <div className={`mt-3 flex items-center gap-2 rounded-lg border px-3 py-2 ${action.cls}`}>
        <span className="flex-1 text-xs font-semibold">
          200-MA suggests{' '}
          <span style={{ color: action.color }}>{action.label.toLowerCase()}</span>{' '}
          positions
        </span>
        {/* Action badge with its own tooltip */}
        <span className="group/tip relative shrink-0">
          <span
            className="rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide cursor-help"
            style={{ backgroundColor: `${action.color}22`, color: action.color }}
          >
            {action.label}
          </span>
          {/* Tooltip popover — opens upward, right-aligned */}
          <span className="pointer-events-none absolute bottom-full right-0 z-50 mb-2 w-60 rounded-xl border border-slate-200 dark:border-white/[0.12] bg-white dark:bg-slate-800 px-3 py-2.5 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300 shadow-2xl opacity-0 transition-opacity duration-150 group-hover/tip:opacity-100 whitespace-normal">
            <span className="mb-1 block font-bold uppercase tracking-wide text-[10px]" style={{ color: action.color }}>
              {action.label}
            </span>
            {action.tip}
            <span className="absolute top-full right-3 border-4 border-transparent border-t-slate-200 dark:border-t-white/[0.12]" />
          </span>
        </span>
      </div>
    </div>
  )
}
