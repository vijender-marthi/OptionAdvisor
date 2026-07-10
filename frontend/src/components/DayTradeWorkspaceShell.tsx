import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
import type { DayTradeWorkspaceAction, DayTradeWorkspaceDisplayValue, DayTradeWorkspaceResponse, DayTradeWorkspaceStatus } from '../api/client'
import { workspaceToneBadgeClass, workspaceToneTextClass } from '../utils/workspaceTone'
import DayTradeWorkspaceChart from './DayTradeWorkspaceChart'

type Props = {
  workspace: DayTradeWorkspaceResponse
  onAction?: (action: DayTradeWorkspaceAction) => void
  onIntervalChange?: (interval: '1m' | '5m' | '15m') => void
}

export default function DayTradeWorkspaceShell({ workspace, onAction, onIntervalChange }: Props) {
  const action = workspace.decision.primaryAction
  const [displayTimeZone, setDisplayTimeZone] = useState(() => {
    try {
      return localStorage.getItem('oa_timezone') || workspace.session.marketTimeZone
    } catch {
      return workspace.session.marketTimeZone
    }
  })

  useEffect(() => {
    const readTimeZone = () => {
      try {
        return localStorage.getItem('oa_timezone') || workspace.session.marketTimeZone
      } catch {
        return workspace.session.marketTimeZone
      }
    }
    setDisplayTimeZone(readTimeZone())
    const handleTimezoneChange = (event: Event) => {
      const custom = event as CustomEvent<string>
      setDisplayTimeZone(custom.detail || readTimeZone())
    }
    window.addEventListener('oa-timezone-changed', handleTimezoneChange)
    return () => window.removeEventListener('oa-timezone-changed', handleTimezoneChange)
  }, [workspace.session.marketTimeZone])

  return (
    <div className="day-trade-workspace-shell min-h-0 rounded-xl border border-slate-200 bg-white text-slate-950 shadow-sm dark:border-white/[0.07] dark:bg-slate-950 dark:text-slate-100">
      <SessionStatusBar workspace={workspace} displayTimeZone={displayTimeZone} />
      <TradeDecisionHeader workspace={workspace} action={action} onAction={onAction} />
      <div className="grid min-h-0 gap-3 p-3 xl:grid-cols-[minmax(0,1fr)_360px]">
        <WorkspaceChartPreview workspace={workspace} displayTimeZone={displayTimeZone} onIntervalChange={onIntervalChange} />
        <TradeDecisionPanel workspace={workspace} />
      </div>
      <WorkspaceDetailTabs workspace={workspace} />
    </div>
  )
}

function SessionStatusBar({ workspace, displayTimeZone }: { workspace: DayTradeWorkspaceResponse; displayTimeZone: string }) {
  const generatedAt = useMemo(() => {
    const date = new Date(workspace.generatedAt)
    if (Number.isNaN(date.getTime())) return workspace.generatedAt
    return date.toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      timeZone: displayTimeZone,
      timeZoneName: 'short',
    })
  }, [displayTimeZone, workspace.generatedAt])
  return (
    <div className="flex h-11 flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 text-xs dark:border-white/[0.07]">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={workspace.session.status} />
        <span className="rounded-full border border-slate-200 px-2 py-0.5 font-semibold uppercase tracking-wide text-secondary dark:border-white/[0.08]">
          {workspace.session.mode}
        </span>
        <span className="font-mono text-tertiary">{workspace.session.displayDate}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-tertiary">
        <span>{displayTimeZone}</span>
        <span>Generated {generatedAt}</span>
      </div>
    </div>
  )
}

function TradeDecisionHeader({ workspace, action, onAction }: { workspace: DayTradeWorkspaceResponse; action: DayTradeWorkspaceAction; onAction?: (action: DayTradeWorkspaceAction) => void }) {
  const [moreOpen, setMoreOpen] = useState(false)
  const secondaryActions = workspace.decision.secondaryActions || []
  return (
    <div className="grid gap-3 border-b border-slate-200 px-3 py-3 dark:border-white/[0.07] lg:grid-cols-[minmax(220px,320px)_minmax(0,1fr)_auto]">
      <div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-2xl font-black text-heading">{workspace.symbol.ticker}</span>
          <span className="truncate text-sm font-semibold text-secondary">{workspace.symbol.companyName}</span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className="font-mono text-xl font-black text-heading">{workspace.symbol.price.display}</span>
          <span className={`font-mono text-sm font-bold ${workspaceToneTextClass(workspace.symbol.change.tone || 'neutral')}`}>{workspace.symbol.change.display}</span>
        </div>
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={workspace.decision.context} />
          <StatusPill status={workspace.decision.permission} />
        </div>
        <div className="mt-2 text-xl font-black text-heading">{workspace.decision.headline}</div>
        <div className="mt-1 line-clamp-2 text-sm text-secondary">{workspace.decision.reason}</div>
        {workspace.decision.nextCondition && (
          <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-secondary dark:border-white/[0.07] dark:bg-slate-900">
            {workspace.decision.nextCondition}
          </div>
        )}
      </div>
      <div className="relative flex items-start justify-end gap-2">
        <button
          type="button"
          disabled={!action.enabled}
          onClick={() => onAction?.(action)}
          className={`rounded-lg px-4 py-2 text-sm font-black uppercase tracking-wide transition ${
            action.enabled
              ? 'bg-violet-600 text-white hover:bg-violet-500'
              : 'cursor-not-allowed border border-slate-200 bg-slate-100 text-tertiary dark:border-white/[0.08] dark:bg-slate-900'
          }`}
          title={action.disabledReason || action.label}
        >
          {action.label}
        </button>
        {secondaryActions.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setMoreOpen(cur => !cur)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-black text-secondary hover:border-violet-400 dark:border-white/[0.08]"
              aria-haspopup="menu"
              aria-expanded={moreOpen}
            >
              More
            </button>
            {moreOpen && (
              <div className="absolute right-0 top-11 z-20 w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-white/[0.08] dark:bg-slate-950" role="menu">
                {secondaryActions.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    disabled={!item.enabled}
                    onClick={() => {
                      setMoreOpen(false)
                      onAction?.(item)
                    }}
                    className={`flex w-full flex-col rounded-lg px-3 py-2 text-left text-xs ${
                      item.enabled
                        ? 'text-secondary hover:bg-slate-50 dark:hover:bg-slate-900'
                        : 'cursor-not-allowed text-tertiary opacity-70'
                    }`}
                    title={item.disabledReason || item.label}
                    role="menuitem"
                  >
                    <span className="font-black">{item.label}</span>
                    {!item.enabled && item.disabledReason && <span className="mt-0.5 text-[10px]">{item.disabledReason}</span>}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function WorkspaceChartPreview({ workspace, displayTimeZone, onIntervalChange }: { workspace: DayTradeWorkspaceResponse; displayTimeZone: string; onIntervalChange?: (interval: '1m' | '5m' | '15m') => void }) {
  return (
    <section className="min-h-[520px] rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/[0.07] dark:bg-slate-900/60">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-black uppercase tracking-widest text-tertiary">Primary Chart</div>
          <div className="mt-1 text-sm font-semibold text-secondary">
            {workspace.chart.defaults.interval} · {workspace.chart.defaults.visibleRange} · {workspace.chart.defaults.scaleMode}
          </div>
        </div>
        <div className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-secondary dark:border-white/[0.08]">
          {workspace.chart.candles.length} candles · {workspace.chart.levels.length} levels · {workspace.chart.events.length} events
        </div>
      </div>
      <div className="mt-3">
        <DayTradeWorkspaceChart chart={workspace.chart} marketTimeZone={displayTimeZone} onIntervalChange={onIntervalChange} />
      </div>
    </section>
  )
}

function TradeDecisionPanel({ workspace }: { workspace: DayTradeWorkspaceResponse }) {
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const rrKey = 'risk' + 'Reward'
  const rrValue = workspace.riskPlan[rrKey as keyof typeof workspace.riskPlan] as DayTradeWorkspaceDisplayValue
  return (
    <aside className="grid content-start gap-3">
      <Panel title="Current Decision">
        <StatusPill status={workspace.decision.permission} />
        <div className="mt-2 text-sm font-semibold text-heading">{workspace.decision.headline}</div>
        <div className="mt-1 text-xs text-tertiary">{workspace.decision.reason}</div>
      </Panel>
      <Panel title="Setup">
        <div className="grid gap-2">
          <Value label="Setup" value={workspace.decision.setupName || '—'} />
          <div>
            <div className="text-[10px] font-black uppercase tracking-wide text-tertiary">Context</div>
            <StatusPill status={workspace.decision.context} />
          </div>
          {workspace.decision.nextCondition && (
            <div className="rounded-md bg-slate-50 px-2 py-1 text-xs font-semibold text-secondary dark:bg-slate-900">
              {workspace.decision.nextCondition}
            </div>
          )}
        </div>
      </Panel>
      <Panel title="Trigger">
        <StatusPill status={workspace.trigger.status} />
        <div className="mt-2 text-xs text-secondary">{workspace.trigger.summary}</div>
        <div className="mt-2 grid gap-1">
          {workspace.trigger.requirements.map(item => (
            <div key={item.id} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2 py-1 text-xs dark:bg-slate-900">
              <span className="text-secondary">{item.label}</span>
              <span className={`font-bold ${workspaceToneTextClass(item.tone)}`}>{item.displayValue || item.result}</span>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Entry / Stop / Targets">
        <div className="grid grid-cols-2 gap-2">
          <Value label="Entry" value={workspace.riskPlan.entry.display} />
          <Value label="Stop" value={workspace.riskPlan.stop.display} />
          <Value label="T1" value={workspace.riskPlan.target1.display} />
          <Value label="T2" value={workspace.riskPlan.target2.display} />
          <Value label="Size" value={workspace.riskPlan.positionSize.display} />
          <Value label="R/R" value={rrValue.display} />
        </div>
      </Panel>
      {workspace.selectedContract && (
        <Panel title="Contract / Risk">
          <div className="grid grid-cols-2 gap-2">
            <Value label="Expiry" value={workspace.selectedContract.expiration.display} />
            <Value label="DTE" value={workspace.selectedContract.dte.display} />
            <Value label="Strike" value={workspace.selectedContract.strike.display} />
            <Value label="Type" value={workspace.selectedContract.optionType.display} />
            <Value label="Spread" value={workspace.selectedContract.spread.display} />
            <Value label="Round Trip" value={workspace.selectedContract.roundTrip.display} />
          </div>
          <div className="mt-2">
            <StatusPill status={workspace.selectedContract.liquidity} />
          </div>
        </Panel>
      )}
      <Panel title="Why This State">
        <button
          type="button"
          onClick={() => setEvidenceOpen(cur => !cur)}
          className="flex w-full items-center justify-between rounded-md border border-slate-200 px-2 py-1 text-xs font-bold text-secondary hover:border-violet-400 dark:border-white/[0.08]"
          aria-expanded={evidenceOpen}
        >
          <span>{workspace.evidence.length} backend evidence item{workspace.evidence.length === 1 ? '' : 's'}</span>
          <span>{evidenceOpen ? 'Hide' : 'Show'}</span>
        </button>
        {evidenceOpen && (
          <div className="mt-2 grid gap-1">
            {workspace.evidence.length ? workspace.evidence.map(item => (
              <div key={item.id} className="rounded-md border border-slate-200 px-2 py-1 text-xs dark:border-white/[0.08]">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-secondary">{item.label}</span>
                  <span className={`font-bold ${workspaceToneTextClass(item.tone)}`}>{item.result}</span>
                </div>
                {item.detail && <div className="mt-1 text-tertiary">{item.detail}</div>}
              </div>
            )) : (
              <div className="rounded-md border border-slate-200 px-2 py-1 text-xs text-tertiary dark:border-white/[0.08]">
                No backend evidence items for this workspace.
              </div>
            )}
          </div>
        )}
      </Panel>
    </aside>
  )
}

function WorkspaceDetailTabs({ workspace }: { workspace: DayTradeWorkspaceResponse }) {
  const tabs = useMemo(() => {
    const preferred = ['plan', 'options', 'events', 'alerts', 'position', 'journal']
    const names = Object.keys(workspace.tabs || {})
    return [
      ...preferred.filter(name => names.includes(name)),
      ...names.filter(name => !preferred.includes(name)),
    ]
  }, [workspace.tabs])
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const active = activeTab && workspace.tabs ? workspace.tabs[activeTab] : null

  if (!tabs.length) {
    return (
      <div className="border-t border-slate-200 px-3 py-3 text-xs text-tertiary dark:border-white/[0.07]">
        No backend detail tabs are available for this workspace.
      </div>
    )
  }

  return (
    <section className="border-t border-slate-200 dark:border-white/[0.07]">
      <div className="flex flex-wrap gap-2 px-3 py-2">
        {tabs.map(name => {
          const selected = name === activeTab
          const tab = workspace.tabs[name] as WorkspaceTabPayload | undefined
          return (
            <button
              key={name}
              type="button"
              onClick={() => setActiveTab(cur => cur === name ? null : name)}
              aria-expanded={selected}
              className={`rounded-full border px-3 py-1 text-xs font-bold capitalize transition ${
                selected
                  ? 'border-violet-500 bg-violet-500/10 text-violet-700 dark:text-violet-200'
                  : 'border-slate-200 text-secondary hover:border-violet-400 dark:border-white/[0.08]'
              }`}
            >
              {tab?.title || name}
            </button>
          )
        })}
        <span className="self-center text-[11px] text-tertiary">Collapsed by default. One section opens at a time.</span>
      </div>
      {activeTab && <WorkspaceTabPanel name={activeTab} payload={active} />}
    </section>
  )
}

type WorkspaceTabPayload = {
  title?: string
  summary?: string
  items?: Array<{
    label?: string
    value?: string
    tone?: string
    detail?: string | null
  }>
}

function isWorkspaceTabPayload(value: unknown): value is WorkspaceTabPayload {
  return value != null && typeof value === 'object'
}

function WorkspaceTabPanel({ name, payload }: { name: string; payload: unknown }) {
  if (!isWorkspaceTabPayload(payload)) {
    return (
      <div className="px-3 pb-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-tertiary dark:border-white/[0.08] dark:bg-slate-900">
          {name} is unavailable in the backend workspace response.
        </div>
      </div>
    )
  }
  const items = Array.isArray(payload.items) ? payload.items : []
  return (
    <div className="px-3 pb-3">
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/[0.08] dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-black uppercase tracking-widest text-tertiary">{payload.title || name}</div>
            {payload.summary && <div className="mt-1 max-w-4xl text-sm text-secondary">{payload.summary}</div>}
          </div>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {items.length ? items.map((item, index) => (
            <div key={`${item.label || 'item'}-${index}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/[0.08] dark:bg-slate-950">
              <div className="text-[10px] font-bold uppercase tracking-wide text-tertiary">{item.label || 'Item'}</div>
              <div className={`mt-1 text-sm font-bold ${workspaceToneTextClass(item.tone || 'neutral')}`}>{item.value || '—'}</div>
              {item.detail && <div className="mt-1 text-xs text-tertiary">{item.detail}</div>}
            </div>
          )) : (
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-tertiary dark:border-white/[0.08] dark:bg-slate-950">
              No backend items for this tab.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StatusPill({ status }: { status: DayTradeWorkspaceStatus }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-black uppercase tracking-wide ${workspaceToneBadgeClass(status.tone)}`} title={status.description || status.label}>
      {status.label}
    </span>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3 dark:border-white/[0.07] dark:bg-slate-950">
      <div className="mb-2 text-[11px] font-black uppercase tracking-widest text-tertiary">{title}</div>
      {children}
    </section>
  )
}

function Value({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 px-2 py-1 dark:bg-slate-900">
      <div className="text-[10px] font-bold uppercase tracking-wide text-tertiary">{label}</div>
      <div className="font-mono text-sm font-black text-heading">{value}</div>
    </div>
  )
}
