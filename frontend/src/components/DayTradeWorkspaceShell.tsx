import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { LayoutList, PanelRightOpen, X } from 'lucide-react'
import type {
  DayTradeRiskMonitorFactor,
  DayTradeRiskMonitorItem,
  DayTradeWorkspaceAction,
  DayTradeWorkspaceDisplayValue,
  DayTradeWorkspaceResponse,
  DayTradeWorkspaceStatus,
} from '../api/client'
import { workspaceToneBadgeClass, workspaceToneTextClass } from '../utils/workspaceTone'
import DayTradeWorkspaceChart from './DayTradeWorkspaceChart'

type Props = {
  workspace: DayTradeWorkspaceResponse
  onAction?: (action: DayTradeWorkspaceAction) => void
  onIntervalChange?: (interval: '1m' | '5m' | '15m') => void
}

export default function DayTradeWorkspaceShell({ workspace, onAction, onIntervalChange }: Props) {
  const action = workspace.decision.primaryAction
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false)
  const [activeDetailTab, setActiveDetailTab] = useState<string | null>(null)
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
    <div className="day-trade-workspace-shell relative flex min-h-0 flex-col overflow-visible rounded-xl border border-slate-200 bg-white text-slate-950 shadow-sm dark:border-white/[0.07] dark:bg-slate-950 dark:text-slate-100 md:h-full md:overflow-hidden">
      <SessionStatusBar workspace={workspace} displayTimeZone={displayTimeZone} />
      <TradeDecisionHeader
        workspace={workspace}
        action={action}
        onAction={onAction}
        onOpenDetails={() => setDetailDrawerOpen(true)}
      />
      <div className="grid min-h-0 flex-1 gap-3 p-3 md:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_380px]">
        <WorkspaceChartPreview workspace={workspace} displayTimeZone={displayTimeZone} onIntervalChange={onIntervalChange} />
        <TradeDecisionPanel workspace={workspace} />
      </div>
      <WorkspaceDetailDrawer
        workspace={workspace}
        open={detailDrawerOpen}
        activeTab={activeDetailTab}
        onActiveTabChange={setActiveDetailTab}
        onClose={() => setDetailDrawerOpen(false)}
      />
    </div>
  )
}

export function SessionStatusBar({ workspace, displayTimeZone }: { workspace: DayTradeWorkspaceResponse; displayTimeZone: string }) {
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
    <div className="flex min-h-9 flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-1 text-xs dark:border-white/[0.07]">
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

export function TradeDecisionHeader({
  workspace,
  action,
  onAction,
  onOpenDetails,
}: {
  workspace: DayTradeWorkspaceResponse
  action: DayTradeWorkspaceAction
  onAction?: (action: DayTradeWorkspaceAction) => void
  onOpenDetails?: () => void
}) {
  const [moreOpen, setMoreOpen] = useState(false)
  const secondaryActions = workspace.decision.secondaryActions || []
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-3 py-2 dark:border-white/[0.07]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xl font-black text-heading">{workspace.symbol.ticker}</span>
          <span className="truncate text-sm font-semibold text-secondary">{workspace.symbol.companyName}</span>
          <span className="font-mono text-lg font-black text-heading">{workspace.symbol.price.display}</span>
          <span className={`font-mono text-sm font-bold ${workspaceToneTextClass(workspace.symbol.change.tone || 'neutral')}`}>{workspace.symbol.change.display}</span>
          {workspace.chart.marketStructure && (
            <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-violet-700 dark:text-violet-200">
              {workspace.chart.marketStructure.display} · {workspace.chart.marketStructure.trend.replace(/_/g, ' ')}
            </span>
          )}
        </div>
      </div>
      <div className="relative -mx-1 flex w-full flex-nowrap items-center gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:w-auto sm:flex-wrap sm:justify-end sm:overflow-visible sm:p-0">
        <StatusPill status={workspace.decision.context} />
        <StatusPill status={workspace.decision.permission} />
        {onOpenDetails && (
          <button
            type="button"
            onClick={onOpenDetails}
            className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-black text-secondary hover:border-violet-400 hover:text-heading dark:border-white/[0.08]"
            aria-label="Open workspace sections"
          >
            <LayoutList size={16} />
            Sections
          </button>
        )}
        <button
          type="button"
          disabled={!action.enabled}
          onClick={() => onAction?.(action)}
          className={`shrink-0 rounded-lg px-4 py-2 text-sm font-black uppercase tracking-wide transition ${
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
              className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-sm font-black text-secondary hover:border-violet-400 dark:border-white/[0.08]"
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

export function WorkspaceChartPreview({ workspace, displayTimeZone, onIntervalChange }: { workspace: DayTradeWorkspaceResponse; displayTimeZone: string; onIntervalChange?: (interval: '1m' | '5m' | '15m') => void }) {
  return (
    <section className="flex min-h-[560px] min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/[0.07] dark:bg-slate-900/60 md:min-h-0">
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
      <div className="mt-3 min-h-0 flex-1">
        <DayTradeWorkspaceChart chart={workspace.chart} marketTimeZone={displayTimeZone} onIntervalChange={onIntervalChange} />
      </div>
    </section>
  )
}

export function TradeDecisionPanel({ workspace }: { workspace: DayTradeWorkspaceResponse }) {
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const rrKey = 'risk' + 'Reward'
  const rrValue = workspace.riskPlan[rrKey as keyof typeof workspace.riskPlan] as DayTradeWorkspaceDisplayValue
  return (
    <aside className="grid max-h-[70vh] content-start gap-3 overflow-y-auto overscroll-contain pr-1 lg:max-h-none">
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
          {/* Trigger requirement intentionally omitted here — shown once in the Trigger panel to avoid duplication. */}
        </div>
      </Panel>
      <Panel title="Market Structure">
        {workspace.chart.marketStructure ? (
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-black uppercase tracking-wide text-tertiary">Trend</span>
              <span className="text-xs font-black text-heading">{workspace.chart.marketStructure.trend.replace(/_/g, ' ')}</span>
            </div>
            <Value label="Sequence" value={workspace.chart.marketStructure.sequence.length ? workspace.chart.marketStructure.sequence.join(' → ') : workspace.chart.marketStructure.display} />
            <Value label="Current Pivot" value={workspace.chart.marketStructure.currentPivot || '—'} />
            <Value label="Expected Next" value={workspace.chart.marketStructure.expectedNextPivot || '—'} />
            <Value label="Invalidation" value={workspace.chart.marketStructure.invalidationLevel == null ? '—' : `$${workspace.chart.marketStructure.invalidationLevel.toFixed(2)}`} />
            <Value label="Strength" value={workspace.chart.marketStructure.structureStrength == null ? '—' : `${workspace.chart.marketStructure.structureStrength.toFixed(0)}%`} />
            <div className="rounded-md bg-slate-50 px-2 py-1 text-[11px] text-tertiary dark:bg-slate-900">
              {workspace.chart.marketStructure.explanation || 'Backend-confirmed 5m structure.'}
            </div>
          </div>
        ) : (
          <div className="text-xs text-tertiary">No backend market structure payload for this workspace.</div>
        )}
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
      <RiskMonitorPanel workspace={workspace} />
      <Panel title="Entry / Stop / Targets">
        <div className="grid grid-cols-2 gap-2">
          <Value label="Entry" value={workspace.riskPlan.entry.display} />
          <Value label="Stop" value={workspace.riskPlan.stop.display} />
          <Value label="T1" value={workspace.riskPlan.target1.display} />
          <Value label="T2" value={workspace.riskPlan.target2.display} />
          <Value label="Invalidation" value={(workspace.riskPlan as { invalidation?: DayTradeWorkspaceDisplayValue }).invalidation?.display ?? workspace.riskPlan.stop.display} />
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

function riskToneClass(tone?: string): string {
  switch (String(tone || '').toLowerCase()) {
    case 'red':
      return 'border-red-500/35 bg-red-500/10 text-red-700 dark:text-red-200'
    case 'orange':
      return 'border-orange-500/35 bg-orange-500/10 text-orange-800 dark:text-orange-200'
    case 'yellow':
      return 'border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-200'
    case 'green':
      return 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
    default:
      return 'border-slate-200 bg-slate-50 text-secondary dark:border-white/[0.08] dark:bg-slate-900'
  }
}

function riskBarClass(tone?: string): string {
  switch (String(tone || '').toLowerCase()) {
    case 'red':
      return 'bg-red-500'
    case 'orange':
      return 'bg-orange-500'
    case 'yellow':
      return 'bg-amber-500'
    case 'green':
      return 'bg-emerald-500'
    default:
      return 'bg-slate-400 dark:bg-slate-600'
  }
}

function displayBackendText(value?: unknown): string {
  const text = typeof value === 'string' ? value.trim() : value == null ? '' : String(value)
  return text || 'Unavailable'
}

function RiskMonitorPanel({ workspace }: { workspace: DayTradeWorkspaceResponse }) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const monitor = workspace.trapDetection?.riskMonitor
  const items = monitor?.items || []

  if (!workspace.trapDetection?.enabled) return null

  return (
    <Panel title={monitor?.title || 'Risk Monitor'}>
      {items.length ? (
        <div className="grid gap-2">
          {items.map((item, index) => {
            const id = item.id || item.name || `risk-${index}`
            const open = expandedId === id
            return (
              <div key={id} className="rounded-lg border border-slate-200 bg-white p-2 dark:border-white/[0.08] dark:bg-slate-950">
                <button
                  type="button"
                  onClick={() => setExpandedId(cur => (cur === id ? null : id))}
                  className="w-full text-left"
                  aria-expanded={open}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-black text-heading">{displayBackendText(item.name)}</div>
                      <div className="mt-1 line-clamp-2 text-[11px] text-tertiary">{displayBackendText(item.explanation)}</div>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-wide ${riskToneClass(item.tone)}`}>
                      {displayBackendText(item.status)}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div className={`h-full rounded-full ${riskBarClass(item.tone)}`} style={{ width: item.progressPercent || '0%' }} />
                    </div>
                    <span className="font-mono text-[11px] font-black text-heading">{displayBackendText(item.scoreDisplay)}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-tertiary">
                    <span>{displayBackendText(item.confidenceDisplay)}</span>
                    <span>{displayBackendText(item.stage)}</span>
                  </div>
                </button>
                {open && <RiskMonitorDetails item={item} />}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-tertiary dark:border-white/[0.08] dark:bg-slate-900">
          Risk Monitor Unavailable. Backend did not return monitor items.
        </div>
      )}
      {workspace.trapDetection.positionRisk?.isExposedToTrap && (
        <div className="mt-2 rounded-lg border border-orange-500/35 bg-orange-500/10 px-3 py-2 text-xs text-orange-800 dark:text-orange-200">
          <div className="font-black uppercase tracking-wide">Position Risk</div>
          <div className="mt-1 font-semibold">{displayBackendText(workspace.trapDetection.positionRisk.message)}</div>
        </div>
      )}
    </Panel>
  )
}

function RiskMonitorDetails({ item }: { item: DayTradeRiskMonitorItem }) {
  return (
    <div className="mt-2 grid gap-2 border-t border-slate-200 pt-2 dark:border-white/[0.08]">
      <div className="grid gap-1 text-[11px]">
        <Value label="Next Confirmation" value={displayBackendText(item.nextConfirmation)} />
        <Value label="Next Invalidation" value={displayBackendText(item.nextInvalidation)} />
      </div>
      <RiskFactorGroup title="Triggered Factors" factors={item.triggeredFactors} empty="No backend-triggered factors." />
      <RiskFactorGroup title="Passed Factors" factors={item.passedFactors} empty="No backend-passed factors." />
      <RiskFactorGroup title="Missing Data" factors={item.missingFactors} empty="No missing backend data." />
      <div className="rounded-md bg-slate-50 px-2 py-1 text-[11px] text-tertiary dark:bg-slate-900">
        <span className="font-bold text-secondary">Backend formula:</span> {displayBackendText(item.formula)}
      </div>
    </div>
  )
}

function RiskFactorGroup({ title, factors, empty }: { title: string; factors?: DayTradeRiskMonitorFactor[]; empty: string }) {
  return (
    <div>
      <div className="text-[10px] font-black uppercase tracking-wide text-tertiary">{title}</div>
      <div className="mt-1 grid gap-1">
        {factors?.length ? factors.map((factor, index) => (
          <div key={factor.code || `${title}-${index}`} className="rounded-md border border-slate-200 px-2 py-1 text-[11px] dark:border-white/[0.08]">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-secondary">{displayBackendText(factor.label)}</span>
              <span className="font-bold text-tertiary">{displayBackendText(factor.status)}</span>
            </div>
            <div className="mt-1 text-tertiary">{displayBackendText(factor.explanation || factor.displayEvidence)}</div>
            {factor.inputs?.length ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {factor.inputs.map(input => (
                  <span key={`${factor.code || factor.label}-${input.label}`} className="rounded-full bg-slate-50 px-1.5 py-0.5 text-[10px] text-tertiary dark:bg-slate-900">
                    {displayBackendText(input.label)}: {displayBackendText(input.display ?? input.value)}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        )) : (
          <div className="rounded-md bg-slate-50 px-2 py-1 text-[11px] text-tertiary dark:bg-slate-900">{empty}</div>
        )}
      </div>
    </div>
  )
}

function orderedWorkspaceTabs(workspace: DayTradeWorkspaceResponse): string[] {
  const preferred = ['plan', 'options', 'events', 'alerts', 'position', 'journal']
  const names = Object.keys(workspace.tabs || {})
  return [
    ...preferred.filter(name => names.includes(name)),
    ...names.filter(name => !preferred.includes(name)),
  ]
}

export function WorkspaceDetailDrawer({
  workspace,
  open,
  activeTab,
  onActiveTabChange,
  onClose,
}: {
  workspace: DayTradeWorkspaceResponse
  open: boolean
  activeTab: string | null
  onActiveTabChange: (tab: string | null) => void
  onClose: () => void
}) {
  const tabs = useMemo(() => {
    return orderedWorkspaceTabs(workspace)
  }, [workspace.tabs])
  const resolvedActiveTab = activeTab && tabs.includes(activeTab) ? activeTab : tabs[0] || null
  const active = resolvedActiveTab && workspace.tabs ? workspace.tabs[resolvedActiveTab] : null

  useEffect(() => {
    if (open && !activeTab && tabs.length) onActiveTabChange(tabs[0])
  }, [activeTab, onActiveTabChange, open, tabs])

  if (!tabs.length) {
    return null
  }

  return (
    <div className={`fixed inset-0 z-40 ${open ? '' : 'pointer-events-none'}`} aria-hidden={!open}>
      <div className={`absolute inset-0 bg-slate-950/35 transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`} onClick={onClose} />
      <aside
        className={`absolute right-0 top-0 flex h-full w-full max-w-[520px] transform flex-col border-l border-slate-200 bg-white shadow-2xl transition-transform dark:border-white/[0.08] dark:bg-slate-950 sm:w-[88vw] ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Day Trade workspace sections"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 p-4 dark:border-white/[0.08]">
          <div>
            <div className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-tertiary">
              <PanelRightOpen size={14} />
              Workspace Sections
            </div>
            <div className="mt-1 text-lg font-black text-heading">{workspace.symbol.ticker} Details</div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-secondary hover:bg-slate-100 dark:hover:bg-slate-900" aria-label="Close workspace sections">
            <X size={18} />
          </button>
        </div>
        <div className="shrink-0 overflow-x-auto border-b border-slate-200 px-4 py-3 dark:border-white/[0.08]">
          <div className="flex min-w-max gap-2">
            {tabs.map(name => {
              const selected = name === resolvedActiveTab
              const tab = workspace.tabs[name] as WorkspaceTabPayload | undefined
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => onActiveTabChange(name)}
                  aria-pressed={selected}
                  className={`rounded-full border px-3 py-1.5 text-xs font-bold capitalize transition ${
                    selected
                      ? 'border-violet-500 bg-violet-500/10 text-violet-700 dark:text-violet-200'
                      : 'border-slate-200 text-secondary hover:border-violet-400 dark:border-white/[0.08]'
                  }`}
                >
                  {tab?.title || name}
                </button>
              )
            })}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {resolvedActiveTab && <WorkspaceTabPanel name={resolvedActiveTab} payload={active} framed={false} />}
        </div>
      </aside>
    </div>
  )
}

export function WorkspaceDetailTabs({ workspace }: { workspace: DayTradeWorkspaceResponse }) {
  const tabs = useMemo(() => orderedWorkspaceTabs(workspace), [workspace.tabs])
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

function WorkspaceTabPanel({ name, payload, framed = true }: { name: string; payload: unknown; framed?: boolean }) {
  if (!isWorkspaceTabPayload(payload)) {
    return (
      <div className={framed ? 'px-3 pb-3' : ''}>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-tertiary dark:border-white/[0.08] dark:bg-slate-900">
          {name} is unavailable in the backend workspace response.
        </div>
      </div>
    )
  }
  const items = Array.isArray(payload.items) ? payload.items : []
  return (
    <div className={framed ? 'px-3 pb-3' : ''}>
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
    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-black uppercase tracking-wide ${workspaceToneBadgeClass(status.tone)}`} title={status.description || status.label}>
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
