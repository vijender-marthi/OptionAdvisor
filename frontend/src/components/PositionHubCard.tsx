import { useState } from 'react'
import { ChevronDown, ChevronUp, Layers, Loader2, XCircle } from 'lucide-react'
import type { ActiveTradeRow } from '../api/client'
import { getDecisionBadgeClass, getGuidanceToneClass, getPositionCategoryClass } from '../utils/semanticTrading'

export type HubCategoryKind = 'regular' | 'day' | 'swing'

const SHARES = 100

export function PositionCategoryPill({ kind }: { kind: HubCategoryKind }) {
  const cfg = getPositionCategoryClass(kind)
  const label = kind === 'day' ? 'Day Trade' : kind === 'swing' ? 'Swing Trade' : 'Regular'
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wide border px-2 py-0.5 rounded-full shrink-0 ${cfg}`}>
      {label}
    </span>
  )
}

function bannerFromTone(tone: string) {
  return {
    className: getGuidanceToneClass(tone),
    title:
      tone === 'green'
        ? 'text-semantic-bullish'
        : tone === 'orange'
          ? 'text-semantic-warning'
          : tone === 'red'
            ? 'text-semantic-bearish'
            : 'text-primary',
    icon: tone === 'green' ? ('✅' as const) : tone === 'orange' ? ('⚠️' as const) : tone === 'red' ? ('🚨' as const) : ('⏳' as const),
  }
}

function asDecision(row: ActiveTradeRow) {
  const d = row.decision as {
    state?: string
    action?: string
    message?: string
    badge_tone?: string
    risk_warning?: string
    confirmation_needed?: string[]
  }
  return d
}

/**
 * Open day-trade row using the same shell as portfolio position cards (alert strip + header + metrics grid).
 */
export function ActiveDayTradeHubCard({
  row,
  exiting,
  onExit,
}: {
  row: ActiveTradeRow
  exiting: boolean
  onExit: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const d = asDecision(row)
  const tone = d.badge_tone ?? 'gray'
  const strip = bannerFromTone(tone)
  const conf = Array.isArray(d.confirmation_needed) ? d.confirmation_needed : []
  const contracts = row.contracts != null && row.contracts > 0 ? Math.round(row.contracts) : null
  const title = (d.state && String(d.state).trim()) || 'Day trade guidance'
  const hasBanner = Boolean(d.message || d.action || title)

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-800/50 bg-gray-900/95 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_12px_28px_rgba(2,6,23,0.18)]">
      {hasBanner && (
        <div className={`${strip.className} flex items-start gap-2 border-b border-white/6 px-4 py-2.5`}>
          <span className="text-base shrink-0 mt-0.5">{strip.icon}</span>
          <div className="flex-1 min-w-0">
            <div className={`text-xs font-bold ${strip.title}`}>{title}</div>
            {d.message ? <div className="text-xs text-gray-400 mt-0.5">{d.message}</div> : null}
            {d.action ? (
              <div className={`text-xs font-semibold mt-1 ${strip.title}`}>→ {d.action}</div>
            ) : null}
          </div>
        </div>
      )}

      <div className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-lg font-bold text-white font-mono">{row.ticker}</span>
              <PositionCategoryPill kind="day" />
              <span className="text-xs bg-violet-900/50 text-violet-300 border border-violet-700 px-2 py-0.5 rounded-full font-semibold">
                {row.side} {row.strike != null && row.strike > 0 ? `$${Number(row.strike).toFixed(0)}` : ''}
              </span>
              {contracts != null ? (
                <span className="flex items-center gap-1 rounded-full border border-gray-700/40 bg-gray-800/70 px-2 py-0.5 text-xs text-gray-400">
                  <Layers size={10} /> {contracts} contract{contracts > 1 ? 's' : ''}
                </span>
              ) : null}
              <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${getDecisionBadgeClass('READY')}`}>
                Active session
              </span>
            </div>
            <div className="text-xs text-gray-500 mt-0.5">
              Entry {row.side} @ ${row.entry_price.toFixed(2)}
              {row.expiry ? ` · Exp ${row.expiry}` : ''}
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            <button
              type="button"
              onClick={() => void onExit(row.id)}
              disabled={exiting}
              title="Exit day trade"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-900/20 hover:bg-emerald-900/40 border border-emerald-800 text-emerald-400 text-xs font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {exiting ? <Loader2 size={12} className="animate-spin shrink-0" /> : <XCircle size={12} />}
              Exit
            </button>
          </div>
        </div>

        <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
          <div className="rounded-xl border border-gray-800/40 bg-gray-800/45 px-3 py-2">
            <div className="text-xs text-gray-500 mb-0.5">Entry price</div>
            <div className="text-sm font-bold font-mono text-violet-400">${row.entry_price.toFixed(2)}</div>
            <div className="text-xs text-gray-600 truncate">Marked reference</div>
          </div>
          <div className="rounded-xl border border-gray-800/40 bg-gray-800/45 px-3 py-2">
            <div className="text-xs text-gray-500 mb-0.5">Contracts</div>
            <div className="text-sm font-bold font-mono text-gray-200">{contracts != null ? String(contracts) : '—'}</div>
            <div className="text-xs text-gray-600 truncate">{SHARES} sh / ct</div>
          </div>
          <div className="rounded-xl border border-gray-800/40 bg-gray-800/45 px-3 py-2">
            <div className="text-xs text-gray-500 mb-0.5">Strike</div>
            <div className="text-sm font-bold font-mono text-gray-200">
              {row.strike != null && row.strike > 0 ? `$${Number(row.strike).toFixed(2)}` : '—'}
            </div>
            <div className="text-xs text-gray-600 truncate">Option leg</div>
          </div>
          <div className="rounded-xl border border-gray-800/40 bg-gray-800/45 px-3 py-2">
            <div className="text-xs text-gray-500 mb-0.5">Underlying @ entry</div>
            <div className="text-sm font-bold font-mono text-gray-300">
              {row.entry_underlying_px != null && Number.isFinite(row.entry_underlying_px)
                ? `$${Number(row.entry_underlying_px).toFixed(2)}`
                : '—'}
            </div>
            <div className="text-xs text-gray-600 truncate">Spot snapshot</div>
          </div>
          <div className="rounded-xl border border-gray-800/40 bg-gray-800/45 px-3 py-2 sm:col-span-2 lg:col-span-1">
            <div className="text-xs text-gray-500 mb-0.5">Opened</div>
            <div className="text-sm font-bold font-mono text-gray-300">
              {new Date(row.opened_at_ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </div>
            <div className="text-xs text-gray-600 truncate">Session</div>
          </div>
        </div>

        {row.intraday_error ? (
          <p className="text-xs text-amber-400/95 px-0.5">Tape error: {row.intraday_error}</p>
        ) : null}

        {d.risk_warning ? (
          <div className="rounded-lg border border-amber-700/20 bg-amber-950/18 px-3 py-2 text-xs text-amber-200/80">
            {d.risk_warning}
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          className="w-full flex items-center justify-center gap-1 text-xs text-gray-600 hover:text-gray-400 transition-colors py-0.5"
        >
          {expanded ? (
            <>
              <ChevronUp size={12} /> Hide details
            </>
          ) : (
            <>
              <ChevronDown size={12} /> Show details
            </>
          )}
        </button>

        {expanded && (
          <div className="space-y-2 border-t border-gray-800/40 pt-3">
            {conf.length > 0 ? (
              <div className="rounded-xl border border-gray-800/30 bg-gray-800/28 px-3 py-2">
                <div className="text-xs text-gray-500 mb-1">Confirmations</div>
                <ul className="text-xs text-gray-400 space-y-1 list-disc pl-4">
                  {conf.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {row.notes ? (
              <div className="rounded-xl border border-gray-800/30 bg-gray-800/28 px-3 py-2 text-xs text-gray-400">
                <span className="text-gray-600 mr-1">Notes:</span>
                {row.notes}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
