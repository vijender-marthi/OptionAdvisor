import { Bell, Bookmark, CheckCircle2, CircleAlert, Loader2, SlidersHorizontal } from 'lucide-react'
import { useEffect, useState } from 'react'
import { runPositionScenario } from '../../api/client'
import type { PositionMetricItem, PositionScenarioData, PositionStrategy } from '../../types/positionWorkspace'
import ServerPayoffChart from './ServerPayoffChart'
import { LabelValue, Section, display, percent, price } from './shared'

function MetricList({ items }: { items: PositionMetricItem[] | null | undefined }) {
  if (!items?.length) return <div className="text-sm text-secondary">Unavailable</div>
  return <div className="grid grid-cols-2 gap-3">{items.map((item, index) => <LabelValue key={`${item.label}-${index}`} label={display(item.label)} value={item.value} mono />)}</div>
}

function ScenarioPanel({ symbol, strategy }: { symbol: string; strategy: PositionStrategy }) {
  const range = strategy.details?.scenario_range
  const [priceMove, setPriceMove] = useState(range?.default ?? 0)
  const [scenario, setScenario] = useState<PositionScenarioData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setPriceMove(range?.default ?? 0)
    setScenario(null)
    setError(null)
  }, [range?.default, strategy.id])

  const submit = async (move = priceMove) => {
    if (!strategy.id) return
    setLoading(true)
    setError(null)
    try {
      const response = await runPositionScenario({ symbol, candidateId: strategy.id, priceMovePct: move, contracts: 1 })
      if (response.error) {
        setError(typeof response.error === 'string' ? response.error : 'Scenario unavailable.')
        setScenario(null)
      } else setScenario(response.data)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Scenario request failed.')
      setScenario(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid gap-3">
      <ServerPayoffChart payoff={scenario?.payoff ?? strategy.details?.payoff} />
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <button type="button" className="rounded-md bg-violet-600 px-3 py-1.5 font-bold text-white">Graph</button>
        <button type="button" className="rounded-md border border-slate-200 px-3 py-1.5 font-bold text-primary dark:border-white/[0.08]">Table</button>
      </div>
      <label className="grid gap-1.5 text-[10px] font-bold uppercase tracking-wider text-secondary">
        Price Slider
        <input type="range" min={range?.min ?? -20} max={range?.max ?? 20} step={range?.step ?? 1} value={priceMove} onChange={event => setPriceMove(Number(event.target.value))} onMouseUp={() => void submit()} onTouchEnd={() => void submit()} className="accent-violet-500" />
      </label>
      <button type="button" onClick={() => void submit()} disabled={loading} className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-violet-500/50 text-xs font-bold text-violet-300">
        <SlidersHorizontal size={14} />{loading ? <Loader2 size={14} className="animate-spin" /> : `Run ${priceMove}% scenario`}
      </button>
      {error ? <div className="text-xs text-red-300">{error}</div> : null}
      {scenario?.values?.length ? <MetricList items={scenario.values} /> : null}
    </div>
  )
}

export default function PositionDetailRail({ symbol, strategy, watched, onOpenAlert, onToggleWatchlist }: { symbol: string; strategy: PositionStrategy | null; watched: boolean; onOpenAlert: () => void; onToggleWatchlist: () => void }) {
  if (!strategy) return <aside className="border-l border-slate-200 bg-white p-4 dark:border-white/[0.07] dark:bg-slate-950 xl:h-[calc(100dvh-4rem)]"><div className="rounded-xl border border-dashed border-slate-300 p-5 text-sm text-secondary dark:border-white/[0.12]">Select a strategy to inspect the server-provided candidate details.</div></aside>
  const details = strategy.details
  return (
    <aside className="border-l border-slate-200 bg-white p-4 dark:border-white/[0.07] dark:bg-slate-950 xl:h-[calc(100dvh-4rem)] xl:overflow-y-auto">
      <Section title="Trade & Position Details">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-amber-300">Selected Strategy</div>
            <h2 className="mt-1 truncate text-base font-bold text-primary">{display(strategy.name)}</h2>
            <div className="mt-1 text-sm text-secondary">{display(details?.expiry)} ({display(strategy.dte)} DTE)</div>
          </div>
          <button type="button" className="rounded-md border border-emerald-500/40 px-3 py-2 text-xs font-bold text-emerald-300">Edit Strategy</button>
        </div>
        {details?.legs?.length ? <div className="mt-4 grid gap-2">{details.legs.map((leg, index) => <div key={`${leg.strike}-${index}`} className="grid grid-cols-[auto_auto_1fr_auto] items-center gap-2 rounded-lg bg-slate-100 px-2 py-2 text-xs dark:bg-slate-900"><span className={`rounded px-1.5 py-0.5 font-bold ${String(leg.action).toLowerCase() === 'sell' ? 'bg-red-500/15 text-red-300' : 'bg-emerald-500/15 text-emerald-300'}`}>{display(leg.action)}</span><span className="font-mono">{display(leg.quantity)}</span><span>{display(leg.strike)} {display(leg.option_type ?? leg.type)}</span><span className="font-mono text-primary">{display(leg.expiry)}</span></div>)}</div> : <div className="mt-4 text-sm text-secondary">Unavailable</div>}
        <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-slate-200 p-3 dark:border-white/[0.07]">
          <LabelValue label="Position Size" value={details?.position_size} mono />
          <LabelValue label="Debit/Credit" value={strategy.debit_credit} mono />
          <LabelValue label="Max Profit" value={price(strategy.max_profit)} mono />
          <LabelValue label="Max Loss" value={price(strategy.max_loss)} mono />
          <LabelValue label="Break-even" value={details?.breakeven} mono />
          <LabelValue label="POP" value={percent(strategy.pop)} mono />
          <LabelValue label="Risk/Reward" value={strategy.risk_reward} mono />
          <LabelValue label="IV Rank" value={percent(details?.iv_rank)} mono />
        </div>
      </Section>

      <Section title="Profit / Loss at Expiration"><ScenarioPanel symbol={symbol} strategy={strategy} /></Section>

      <Section title="Probability & Expectations">
        <div className="mb-4 grid place-items-center">
          <div className="grid h-28 w-28 place-items-center rounded-full border-[10px] border-emerald-500/70 bg-emerald-500/10">
            <div className="text-center"><div className="font-mono text-2xl font-bold text-primary">{percent(strategy.pop)}</div><div className="text-[10px] text-secondary">POP</div></div>
          </div>
        </div>
        <MetricList items={details?.probability_expectations} />
        <div className="mt-3 grid grid-cols-2 gap-3"><LabelValue label="Reward/Risk" value={strategy.risk_reward} mono /><LabelValue label="Position Score" value={strategy.position_score} mono /></div>
      </Section>

      <Section title="Trade Checklist">
        {details?.checklist_items?.length ? <div className="grid gap-2">{details.checklist_items.map((item, index) => {
          const failed = String(item.status || '').toLowerCase() === 'fail'
          return <div key={`${item.label}-${index}`} className="flex gap-2 text-xs"><CheckCircle2 size={15} className={`mt-0.5 shrink-0 ${failed ? 'text-red-400' : 'text-emerald-400'}`} /><div><div className="font-medium text-primary">{display(item.label)}</div>{item.detail ? <div className="mt-0.5 text-secondary">{item.detail}</div> : null}</div></div>
        })}</div> : <div className="text-sm text-secondary">Unavailable</div>}
      </Section>

      {!details ? <div className="mt-4 flex gap-2 text-sm text-secondary"><CircleAlert size={16} className="shrink-0" />Incomplete Data</div> : null}
      <div className="sticky bottom-0 -mx-4 mt-4 grid grid-cols-2 gap-2 border-t border-slate-200 bg-white p-4 dark:border-white/[0.07] dark:bg-slate-950">
        <button type="button" onClick={onToggleWatchlist} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-violet-600 px-3 text-sm font-bold text-white hover:bg-violet-500"><Bookmark size={15} fill={watched ? 'currentColor' : 'none'} />Add to Watchlist</button>
        <button type="button" onClick={onOpenAlert} className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-bold text-primary dark:border-white/[0.08]"><Bell size={15} />Create Trade Alert</button>
      </div>
    </aside>
  )
}
