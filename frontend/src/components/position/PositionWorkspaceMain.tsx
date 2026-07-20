import { BarChart3, ChevronRight, HelpCircle, RefreshCw } from 'lucide-react'
import DayTradeWorkspaceChart from '../DayTradeWorkspaceChart'
import type { PositionDecision, PositionKeyLevel, PositionStrategy, PositionWorkspaceData } from '../../types/positionWorkspace'
import { AvailabilityBadge, LabelValue, Section, Skeleton, display, percent, price } from './shared'

const toolbarItems = ['1D', '5D', '1M', '3M', '6M', 'YTD', '1Y', 'Indicators', 'Draw', 'Compare', 'Templates']

function StrategyCard({ strategy, selected, best, onSelect }: { strategy: PositionStrategy; selected: boolean; best: boolean; onSelect: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => strategy.id && onSelect(strategy.id)}
      className={`rounded-xl border bg-white p-3 text-left transition dark:bg-slate-900 ${selected || best ? 'border-emerald-500 shadow-[0_0_0_1px_rgba(16,185,129,0.28)]' : 'border-slate-200 hover:border-violet-300 dark:border-white/[0.08] dark:hover:border-violet-400/50'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-violet-500/15 px-2 py-1 font-mono text-[10px] font-bold text-violet-300">{display(strategy.rank)}</span>
            <span className="truncate text-sm font-bold text-primary">{display(strategy.name)}</span>
          </div>
          <div className="mt-1 text-[11px] text-secondary">{display(strategy.direction)}</div>
        </div>
        {best ? <span className="rounded-full border border-amber-500/40 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300">Best</span> : null}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <LabelValue label="Score" value={strategy.position_score} mono />
        <LabelValue label="POP" value={percent(strategy.pop)} mono />
        <LabelValue label="DTE" value={strategy.dte} mono />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-200 pt-3 dark:border-white/[0.07]">
        <LabelValue label="Debit/Credit" value={strategy.debit_credit} mono />
        <LabelValue label="Risk/Reward" value={strategy.risk_reward} mono />
        <LabelValue label="Max Profit" value={price(strategy.max_profit)} mono />
        <LabelValue label="Max Loss" value={price(strategy.max_loss)} mono />
      </div>
      <div className="mt-3 rounded-md border border-violet-500/50 py-2 text-center text-[11px] font-bold text-violet-300">View Details</div>
    </button>
  )
}

function DecisionRow({ decision }: { decision: PositionDecision | null | undefined }) {
  const keyLevels = decision?.key_levels ?? []
  const timeline = decision?.timeline ?? []
  return (
    <div className="grid gap-3 lg:grid-cols-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/[0.07] dark:bg-slate-900">
        <div className="text-[11px] font-bold uppercase tracking-wider text-secondary">AI Verdict</div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-3xl font-bold text-emerald-400">{display(decision?.verdict || decision?.headline)}</div>
            <div className="mt-1 text-sm font-semibold text-primary">{display(decision?.recommended_strategy)}</div>
          </div>
          <div className="grid h-16 w-16 place-items-center rounded-full border border-emerald-500/40 bg-emerald-500/10">
            <div className="text-center"><div className="font-mono text-lg font-bold text-emerald-300">{display(decision?.score)}</div><div className="text-[9px] uppercase text-secondary">Score</div></div>
          </div>
        </div>
        <div className="mt-4 text-xs text-secondary">Confidence: <span className="font-mono text-emerald-300">{display(decision?.confidence)}</span></div>
        <p className="mt-3 text-xs leading-5 text-secondary">{display(decision?.summary || decision?.detail)}</p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/[0.07] dark:bg-slate-900">
        <div className="text-[11px] font-bold uppercase tracking-wider text-secondary">Why This Setup?</div>
        <div className="mt-3 grid gap-2">
          {(decision?.why ?? []).length ? decision?.why?.slice(0, 6).map((item, index) => <div key={`${item}-${index}`} className="flex gap-2 text-xs text-secondary"><span className="text-emerald-400">✓</span><span>{item}</span></div>) : <div className="text-sm text-secondary">Unavailable</div>}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/[0.07] dark:bg-slate-900">
        <div className="text-[11px] font-bold uppercase tracking-wider text-secondary">Key Levels</div>
        <div className="mt-3 grid gap-2">
          {keyLevels.length ? keyLevels.map((item, index) => <LevelRow key={`${item.label}-${index}`} item={item} />) : <div className="text-sm text-secondary">Unavailable</div>}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/[0.07] dark:bg-slate-900">
        <div className="text-[11px] font-bold uppercase tracking-wider text-secondary">Trade Timeline</div>
        <div className="mt-3 grid gap-3">
          {timeline.length ? timeline.map((item, index) => <div key={`${item.label}-${index}`} className="border-l border-violet-500/40 pl-3"><div className="text-xs font-semibold text-primary">{display(item.label)}</div><div className="font-mono text-[11px] text-secondary">{display(item.value)}</div></div>) : <div className="text-sm text-secondary">Unavailable</div>}
        </div>
      </section>
    </div>
  )
}

function LevelRow({ item }: { item: PositionKeyLevel }) {
  return <div className="flex items-center justify-between gap-3 text-xs"><span className="text-secondary">{display(item.label)}</span><span className="font-mono font-semibold text-primary">{display(item.value)}</span></div>
}

function StructureRibbon({ workspace }: { workspace: PositionWorkspaceData }) {
  const structure = workspace.market_structure
  const items = structure?.items ?? []
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-white/[0.07] dark:bg-slate-900">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <LabelValue label="Market Structure" value={structure?.summary} />
        <LabelValue label="Trend" value={structure?.trend} />
        <LabelValue label="Bias" value={structure?.bias} />
        {items.slice(0, 7).map((item, index) => <LabelValue key={`${item.label}-${index}`} label={display(item.label)} value={item.value} mono />)}
      </div>
    </div>
  )
}

export default function PositionWorkspaceMain({ workspace, selectedStrategyId, loading, error, onSelectStrategy, onRefresh, onOpenTutorial }: {
  workspace: PositionWorkspaceData | null
  selectedStrategyId: string | null
  loading: boolean
  error: string | null
  onSelectStrategy: (id: string) => void
  onRefresh: () => void
  onOpenTutorial: () => void
}) {
  if (loading && !workspace) return <main className="grid gap-4 p-4 md:p-5"><Skeleton className="h-24" /><Skeleton className="h-[32rem]" /><Skeleton className="h-48" /></main>
  if (error && !workspace) return <main className="p-5"><div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{error}<button type="button" onClick={onRefresh} className="mt-3 block rounded-md border border-red-400/40 px-3 py-1 text-xs">Retry</button></div></main>
  if (!workspace) return <main className="p-5"><div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-secondary dark:border-white/[0.12]">Select a top opportunity to open the workspace.</div></main>

  const header = workspace.header
  const strategies = workspace.strategies ?? []
  return (
    <main className="min-w-0 bg-surface-page p-3 md:p-4 xl:h-[calc(100dvh-4rem)] xl:overflow-y-auto">
      <div className="grid gap-3">
        <header className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/[0.07] dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-mono text-2xl font-bold text-primary">{display(header?.symbol)}</h1>
                <span className="truncate text-sm text-secondary">{display(header?.company)}</span>
                <AvailabilityBadge value={workspace.meta?.availability} />
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-secondary">
                <span className="rounded-md bg-slate-100 px-2 py-1 dark:bg-white/[0.06]">{display(header?.sector)}</span>
                <span className="rounded-md bg-slate-100 px-2 py-1 dark:bg-white/[0.06]">{display(header?.industry)}</span>
              </div>
              <div className="mt-2 flex items-baseline gap-3">
                <span className="font-mono text-xl font-bold text-primary">{price(header?.price)}</span>
                <span className="font-mono text-sm font-semibold text-emerald-400">{price(header?.change)} ({percent(header?.change_pct)})</span>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-x-8 gap-y-3 text-xs sm:grid-cols-6">
              <LabelValue label="Market Cap" value={header?.market_cap} mono />
              <LabelValue label="Volume" value={header?.volume} mono />
              <LabelValue label="IV Rank" value={percent(header?.iv_rank)} mono />
              <LabelValue label="Earnings" value={header?.earnings} />
              <LabelValue label="Market Bias" value={header?.market_bias} />
              <div className="flex items-start justify-end gap-2">
                <button type="button" onClick={onOpenTutorial} className="rounded-md border border-violet-500/40 px-3 py-2 text-xs font-bold text-violet-300 hover:bg-violet-500/10">Strategy Tutorial</button>
                <button type="button" title="Refresh workspace" aria-label="Refresh workspace" onClick={onRefresh} disabled={loading} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 text-secondary hover:bg-slate-100 dark:border-white/[0.1] dark:hover:bg-white/[0.06]"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
              </div>
            </div>
          </div>
        </header>

        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-white/[0.07] dark:bg-slate-900">
          <div className="flex flex-wrap items-center gap-2">
            {toolbarItems.map(item => <button key={item} type="button" className={`rounded-md border px-3 py-1.5 text-[11px] font-bold ${item === '5D' ? 'border-violet-500 bg-violet-600 text-white' : 'border-slate-200 text-primary dark:border-white/[0.08] dark:bg-slate-950'}`}>{item}</button>)}
            <button type="button" onClick={onRefresh} className="ml-auto inline-flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1.5 text-[11px] font-bold text-primary dark:border-white/[0.08]"><RefreshCw size={13} />Refresh</button>
          </div>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-3 dark:border-white/[0.07] dark:bg-slate-900">
          {workspace.chart ? <div className="h-[440px] lg:h-[560px] xl:h-[620px]"><DayTradeWorkspaceChart chart={workspace.chart} rangeOptions={['1h', '2h', '7d']} /></div> : <div className="grid h-[520px] place-items-center rounded-lg border border-dashed border-slate-300 text-sm text-secondary dark:border-white/[0.12]">Chart data is unavailable.</div>}
        </section>

        <StructureRibbon workspace={workspace} />
        <DecisionRow decision={workspace.decision} />

        <Section title="Recommended Strategies" action={<span className="font-mono text-[11px] text-secondary">{strategies.length}</span>}>
          {strategies.length === 0 ? <div className="flex gap-2 text-sm text-secondary"><BarChart3 size={16} className="shrink-0" />No strategy candidates are available for this workspace.</div> : <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">{strategies.slice(0, 4).map((strategy, index) => <StrategyCard key={strategy.id || index} strategy={strategy} best={index === 0} selected={strategy.id === selectedStrategyId} onSelect={onSelectStrategy} />)}</div>}
        </Section>
      </div>
    </main>
  )
}
