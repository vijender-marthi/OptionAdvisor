import { CheckCircle2, CircleAlert, Clock3, ListChecks, MapPinned, Target } from 'lucide-react'
import type { ReactNode } from 'react'
import type { PositionDecision, PositionMarketStructure, PositionStrategy } from '../../types/positionWorkspace'
import ServerPayoffChart from './ServerPayoffChart'

const display = (value: string | number | null | undefined) => value === null || value === undefined || value === '' ? 'Unavailable' : String(value)

const cardClass = 'rounded-lg border border-slate-200 bg-white dark:border-white/[0.07] dark:bg-slate-900'

export function MarketStructureRibbon({ structure }: { structure: PositionMarketStructure | null }) {
  const levels = structure?.key_levels ?? []
  return (
    <section className={`${cardClass} overflow-hidden`} aria-label="Market structure">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-slate-200 px-4 py-3 dark:border-white/[0.07]">
        <span className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-cyan-700 dark:text-cyan-300"><MapPinned size={14} /> Market structure</span>
        <span className="text-sm font-medium text-slate-900 dark:text-gray-100">{display(structure?.summary)}</span>
        <span className="text-xs text-slate-600 dark:text-gray-300">Trend: {display(structure?.trend)}</span>
        <span className="text-xs text-slate-600 dark:text-gray-300">Bias: {display(structure?.bias)}</span>
      </div>
      <div className="grid grid-cols-2 divide-x divide-y divide-slate-200 sm:grid-cols-4 dark:divide-white/[0.07]">
        {levels.length === 0 ? <div className="col-span-full px-4 py-3 text-xs text-slate-500 dark:text-gray-400">Unavailable</div> : levels.map((level, index) => (
          <div key={`${level.label}-${index}`} className="min-w-0 px-4 py-3">
            <div className="truncate text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400">{display(level.label)}</div>
            <div className="mt-1 truncate font-mono text-sm text-slate-900 dark:text-gray-100">{display(level.value)}</div>
            {level.detail && <div className="mt-1 truncate text-[11px] text-slate-600 dark:text-gray-300">{level.detail}</div>}
          </div>
        ))}
      </div>
    </section>
  )
}

export function DecisionCards({ decision }: { decision: PositionDecision | null }) {
  const cards = decision?.cards ?? []
  return (
    <section aria-label="Decision summary">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div><h2 className="text-sm font-semibold text-slate-900 dark:text-gray-100">Decision</h2><p className="mt-0.5 text-xs text-slate-600 dark:text-gray-300">{display(decision?.headline)}</p></div>
        <p className="text-xs text-slate-500 dark:text-gray-400">{display(decision?.detail)}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => {
          const card = cards[index]
          return <article key={`${card?.title}-${index}`} className={`${cardClass} min-h-28 p-4`}>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400">{display(card?.title)}</div>
            <div className="mt-2 text-sm font-semibold text-slate-900 dark:text-gray-100">{display(card?.value)}</div>
            <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-gray-300">{display(card?.detail)}</p>
            {card?.status && <div className="mt-2 text-[10px] font-bold uppercase tracking-wider text-cyan-700 dark:text-cyan-300">{card.status}</div>}
          </article>
        })}
      </div>
    </section>
  )
}

export function StrategyCards({ strategies, selectedId, onSelect }: { strategies: PositionStrategy[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <section aria-label="Strategies"><h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-gray-100">Strategies</h2>
      <div className="space-y-3">
        {strategies.length === 0 ? <div className={`${cardClass} p-4 text-sm text-slate-500 dark:text-gray-400`}>Unavailable</div> : strategies.map(strategy => {
          const selected = strategy.id === selectedId
          return <article key={strategy.id ?? strategy.name ?? 'strategy'} className={`${cardClass} overflow-hidden ${selected ? 'ring-1 ring-cyan-500' : ''}`}>
            <button type="button" onClick={() => strategy.id && onSelect(strategy.id)} className="flex w-full items-start justify-between gap-4 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-white/[0.03]" aria-pressed={selected}>
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400">Rank {display(strategy.rank)}</span><span className="text-[10px] font-bold uppercase tracking-wider text-cyan-700 dark:text-cyan-300">{display(strategy.direction)}</span></div><h3 className="mt-1 text-sm font-semibold text-slate-900 dark:text-gray-100">{display(strategy.name)}</h3></div>
              <span className="font-mono text-xs text-slate-600 dark:text-gray-300">{display(strategy.dte)} DTE</span>
            </button>
            {selected && <div className="border-t border-slate-200 p-4 dark:border-white/[0.07]">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-4">
                {[['Score', strategy.position_score], ['POP', strategy.pop], ['Debit / Credit', strategy.debit_credit], ['Risk / Reward', strategy.risk_reward], ['Max profit', strategy.max_profit], ['Max loss', strategy.max_loss], ['Expiry', strategy.details?.expiry], ['Position size', strategy.details?.position_size]].map(([label, value]) => <div key={String(label)}><div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400">{label}</div><div className="mt-1 font-mono text-slate-900 dark:text-gray-100">{display(value as string | number | null | undefined)}</div></div>)}
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div><h4 className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-gray-100"><Target size={14} /> Server payoff</h4><ServerPayoffChart payoff={strategy.details?.payoff} /></div>
                <div className="space-y-4"><DetailList icon={<ListChecks size={14} />} title="Checklist" entries={strategy.details?.checklist?.map(item => ({ label: item.label, value: item.status, detail: item.detail })) ?? []} /><DetailList icon={<Clock3 size={14} />} title="Timeline" entries={strategy.details?.timeline?.map(item => ({ label: item.label, value: item.detail })) ?? []} /></div>
              </div>
            </div>}
          </article>
        })}
      </div>
    </section>
  )
}

function DetailList({ icon, title, entries }: { icon: ReactNode; title: string; entries: Array<{ label: string | null; value: string | null; detail?: string | null }> }) {
  return <div><h4 className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-gray-100">{icon}{title}</h4><ul className="mt-2 space-y-2">{entries.length === 0 ? <li className="text-xs text-slate-500 dark:text-gray-400">Unavailable</li> : entries.map((entry, index) => <li key={`${entry.label}-${index}`} className="text-xs text-slate-600 dark:text-gray-300"><span className="font-medium text-slate-900 dark:text-gray-100">{display(entry.label)}:</span> {display(entry.value)} {entry.detail ? <span className="text-slate-500 dark:text-gray-400">{entry.detail}</span> : null}</li>)}</ul></div>
}

export function AvailabilityNotice({ availability }: { availability: string | null | undefined }) {
  if (!availability || availability === 'available') return null
  return <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-200"><CircleAlert size={14} /> Data availability: {availability}</div>
}

export function CheckIcon({ status }: { status: string | null | undefined }) { return status === 'complete' ? <CheckCircle2 size={14} className="text-emerald-600 dark:text-emerald-400" /> : <CircleAlert size={14} className="text-slate-500 dark:text-gray-400" /> }
