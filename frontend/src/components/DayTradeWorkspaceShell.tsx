import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, BookOpen, BriefcaseBusiness, CheckCircle2, GripVertical, LayoutList, Maximize2, Minimize2, Minus, PanelRightClose, PanelRightOpen, RadioTower, TrendingUp, X } from 'lucide-react'
import type {
  DayTradeRiskMonitorFactor,
  DayTradeRiskMonitorItem,
  DayTradeWorkspaceAction,
  DayTradeWorkspaceDisplayValue,
  DayTradeWorkspaceResponse,
  DayTradeWorkspaceStatus,
  ProfessionalDecisionPayload,
} from '../api/client'
import { workspaceToneBadgeClass, workspaceToneTextClass } from '../utils/workspaceTone'
import DayTradeWorkspaceChart from './DayTradeWorkspaceChart'
import AICoachWidget from './AICoachWidget'
import SetupExitPlanner from './SetupExitPlanner'
import DayTradePriorContext, { type PriorContext } from './DayTradePriorContext'
import DayTradeMultiDayChart, { type MultiDayBar } from './DayTradeMultiDayChart'

type Props = {
  workspace: DayTradeWorkspaceResponse
  onAction?: (action: DayTradeWorkspaceAction) => void
  onIntervalChange?: (interval: '1m' | '5m' | '15m' | '1h') => void
  selectedInterval?: '1m' | '5m' | '15m' | '1h'
  rightRailOpen?: boolean
  onToggleRightRail?: () => void
  rightRailWidth?: number
  onRightRailWidthChange?: (width: number) => void
}

type WidgetPlacement = 'right' | 'bottom'

function widgetIdForTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

function marketStructureBadgeClass(value?: string | null): string {
  const text = String(value || '').toLowerCase()
  if (text.includes('bull') || text.includes('uptrend') || text.includes('higher')) {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
  }
  if (text.includes('bear') || text.includes('downtrend') || text.includes('lower')) {
    return 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-200'
  }
  return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200'
}

function inferredValueTextClass(label: string, value: string): string {
  const raw = `${label} ${value}`.toLowerCase()
  if (raw.includes('stop') || raw.includes('invalid') || raw.includes('bear') || raw.includes('downtrend') || raw.includes('short') || raw.includes('danger') || raw.includes('avoid') || raw.includes('no go') || raw.includes('high risk')) {
    return 'text-rose-600 dark:text-rose-300'
  }
  if (raw.includes('target') || raw.includes('entry') || raw.includes('bull') || raw.includes('uptrend') || raw.includes('long') || raw.includes('go') || raw.includes('low risk') || raw.includes('support')) {
    return 'text-emerald-600 dark:text-emerald-300'
  }
  if (raw.includes('risk') || raw.includes('warn') || raw.includes('wait') || raw.includes('neutral') || raw.includes('pending') || raw.includes('resistance')) {
    return 'text-amber-600 dark:text-amber-300'
  }
  return 'text-heading'
}

function rawNumber(value: DayTradeWorkspaceDisplayValue | undefined): number | null {
  if (!value) return null
  if (typeof value.raw === 'number' && Number.isFinite(value.raw)) return value.raw
  if (typeof value.raw === 'string') {
    const parsed = Number(value.raw.replace(/[^0-9.-]/g, ''))
    if (Number.isFinite(parsed)) return parsed
  }
  const parsed = Number(value.display.replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function moneyValue(value: number | null): string {
  return value == null || !Number.isFinite(value) ? '—' : `$${value.toFixed(2)}`
}

function formatTrendLabel(workspace: DayTradeWorkspaceResponse): string {
  const structure = workspace.chart.marketStructure
  if (!structure) return workspace.decision.context.label
  const trendText = structure.trend.replace(/_/g, ' ')
  const direction = /bull|bear/i.test(trendText) ? trendText : structure.display || trendText
  const strength = structure.structureStrength
  if (strength != null && strength >= 75) return `Strong ${direction.toLowerCase().includes('bull') ? 'Bullish' : direction.toLowerCase().includes('bear') ? 'Bearish' : direction}`
  return direction.replace(/_/g, ' ')
}

function buildDecisionChecks(workspace: DayTradeWorkspaceResponse): string[] {
  const current = rawNumber(workspace.symbol.price)
  const vwap = typeof workspace.chart.vwapOverlay?.latestValue === 'number' ? workspace.chart.vwapOverlay.latestValue : null
  const orh = workspace.chart.levels.find(level => /(^|\s)ORH($|\s)|opening range high/i.test(level.label))
  const structure = workspace.chart.marketStructure
  const chartChecks = [
    current != null && vwap != null && current >= vwap ? 'Above VWAP' : null,
    current != null && orh && current >= orh.price ? 'Above ORH' : null,
    structure?.trend && /bull|hh|hl|uptrend|higher/i.test(`${structure.trend} ${structure.display} ${structure.sequence.join(' ')}`)
      ? 'HH-HL structure intact'
      : structure?.display
        ? `Structure: ${structure.display}`
        : null,
  ].filter((item): item is string => Boolean(item))
  const checks = [
    ...chartChecks,
    ...workspace.trigger.requirements
      .filter(item => !/go long|go short|data quality|trigger/i.test(item.label))
      .filter(item => item.tone === 'positive' || /pass|above|intact|yes|true/i.test(`${item.result} ${item.displayValue || ''}`))
      .map(item => item.label),
    ...workspace.evidence
      .filter(item => item.tone === 'positive')
      .filter(item => !/go long|go short|data quality|trigger/i.test(item.label))
      .sort((a, b) => a.order - b.order)
      .map(item => item.label),
  ]
  return Array.from(new Set(checks)).slice(0, 4)
}

function buildDecisionWarnings(workspace: DayTradeWorkspaceResponse): string[] {
  const current = rawNumber(workspace.symbol.price)
  const vwap = typeof workspace.chart.vwapOverlay?.latestValue === 'number' ? workspace.chart.vwapOverlay.latestValue : null
  const entry = rawNumber(workspace.riskPlan.entry)
  const stop = rawNumber(workspace.riskPlan.stop)
  const target2 = rawNumber(workspace.riskPlan.target2)
  const warnings: string[] = []

  if (current != null && vwap != null && vwap > 0) {
    const pct = ((current - vwap) / vwap) * 100
    const side = pct >= 0 ? 'above' : 'below'
    warnings.push(`Price is ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% ${side} VWAP`)
  }
  if (entry != null && target2 != null) {
    warnings.push(`Only ${moneyValue(Math.abs(target2 - entry))} remains to T2`)
  }
  if (entry != null && stop != null) {
    warnings.push(`Stop requires ${moneyValue(Math.abs(entry - stop))} risk`)
  }
  return warnings
}

function buildActionCopy(workspace: DayTradeWorkspaceResponse): string {
  const vwap = typeof workspace.chart.vwapOverlay?.latestValue === 'number' ? workspace.chart.vwapOverlay.latestValue : null
  const pullback = vwap != null ? `Wait for pullback toward VWAP (${moneyValue(vwap)})` : 'Wait for a cleaner pullback'
  const structure = workspace.chart.marketStructure?.expectedNextPivot || workspace.chart.marketStructure?.expectedNext || 'a new higher low'
  const permissionText = `${workspace.decision.permission.code} ${workspace.decision.permission.label}`.toLowerCase()
  const blocked = permissionText.includes('block') || permissionText.includes('wait') || permissionText.includes('avoid') || workspace.decision.permission.tone !== 'positive' || !workspace.decision.primaryAction.enabled
  if (blocked) return workspace.decision.nextCondition || `${pullback} or ${String(structure).replace(/_/g, ' ')} before entering.`
  return workspace.decision.primaryAction.label || workspace.decision.headline
}

export default function DayTradeWorkspaceShell({
  workspace,
  onAction,
  onIntervalChange,
  selectedInterval,
  rightRailOpen = true,
  onToggleRightRail,
  rightRailWidth = 340,
  onRightRailWidthChange,
}: Props) {
  const action = workspace.decision.primaryAction
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false)
  const [activeDetailTab, setActiveDetailTab] = useState<string | null>(null)
  const [allWidgetsOpen, setAllWidgetsOpen] = useState(false)
  const [bottomDockOpen, setBottomDockOpen] = useState(false)
  const [bottomWidgetIds, setBottomWidgetIds] = useState<string[]>([])
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

  const resizeRightRail = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!onRightRailWidthChange) return
    const startX = event.clientX
    const startWidth = rightRailWidth
    event.currentTarget.setPointerCapture(event.pointerId)
    const handleMove = (moveEvent: PointerEvent) => {
      const next = Math.max(280, Math.min(560, startWidth - (moveEvent.clientX - startX)))
      onRightRailWidthChange(next)
    }
    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }
  const dockWidgetToBottom = (widgetId: string) => {
    setBottomWidgetIds(current => current.includes(widgetId) ? current : [...current, widgetId])
    setBottomDockOpen(true)
  }
  const undockWidgetToRight = (widgetId: string) => {
    setBottomWidgetIds(current => current.filter(id => id !== widgetId))
  }

  return (
    <div className="day-trade-workspace-shell relative flex min-h-0 flex-col overflow-visible rounded-xl border border-slate-200 bg-white text-slate-950 shadow-sm dark:border-white/[0.07] dark:bg-slate-950 dark:text-slate-100 md:h-full md:overflow-auto md:rounded-none md:border-0 md:shadow-none xl:overflow-hidden">
      <SessionStatusBar workspace={workspace} displayTimeZone={displayTimeZone} />
      <TradeDecisionHeader
        workspace={workspace}
        action={action}
        onAction={onAction}
        onOpenDetails={() => setDetailDrawerOpen(true)}
        rightRailOpen={rightRailOpen}
        onToggleRightRail={onToggleRightRail}
        bottomDockOpen={bottomDockOpen}
        bottomDockCount={bottomWidgetIds.length}
        onToggleBottomDock={() => setBottomDockOpen(open => !open)}
        onOpenAllWidgets={() => setAllWidgetsOpen(true)}
      />
      <div
        className={`grid min-h-0 flex-1 auto-rows-max content-start items-start gap-1 p-1 xl:auto-rows-auto xl:content-stretch xl:items-stretch ${rightRailOpen ? 'xl:grid-cols-[minmax(0,1fr)_6px_var(--right-rail-width)]' : 'xl:grid-cols-1'}`}
        style={{ ['--right-rail-width' as string]: `${rightRailWidth}px` }}
      >
        <WorkspaceCenterFrame
          workspace={workspace}
          displayTimeZone={displayTimeZone}
          selectedInterval={selectedInterval}
          onIntervalChange={onIntervalChange}
          bottomDockOpen={bottomDockOpen}
          bottomWidgetIds={bottomWidgetIds}
          onCloseBottomDock={() => setBottomDockOpen(false)}
          onDockWidget={dockWidgetToBottom}
          onUndockWidget={undockWidgetToRight}
          onAction={onAction}
        />
        {rightRailOpen && (
          <>
            <div
              className="hidden cursor-col-resize rounded-full bg-slate-200 transition hover:bg-violet-400 active:bg-violet-500 dark:bg-white/[0.08] xl:block"
              onPointerDown={resizeRightRail}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize right info panel"
              title="Drag to resize right panel"
            />
            <TradeDecisionPanel
              workspace={workspace}
              onAction={onAction}
              placement="right"
              dockedWidgetIds={bottomWidgetIds}
              onDockWidget={dockWidgetToBottom}
              onUndockWidget={undockWidgetToRight}
            />
          </>
        )}
      </div>
      <WorkspaceDetailDrawer
        workspace={workspace}
        open={detailDrawerOpen}
        activeTab={activeDetailTab}
        onActiveTabChange={setActiveDetailTab}
        onClose={() => setDetailDrawerOpen(false)}
      />
      {allWidgetsOpen && (
        <div className="fixed inset-y-0 right-0 z-[60] flex w-full flex-col border-l border-slate-200 bg-slate-100/95 p-2 shadow-2xl backdrop-blur-sm dark:border-white/[0.08] dark:bg-slate-950/95 lg:w-1/2 lg:p-4" role="dialog" aria-modal="true" aria-label="Expanded Day Trade widgets">
          <div className="flex shrink-0 items-center justify-between rounded-t-xl border border-slate-200 bg-white px-4 py-3 dark:border-white/[0.08] dark:bg-slate-950">
            <div>
              <div className="text-sm font-black uppercase tracking-widest text-heading">Day Trade Workspace</div>
              <div className="text-xs text-secondary">All decision widgets expanded</div>
            </div>
            <button type="button" onClick={() => setAllWidgetsOpen(false)} className="rounded-lg p-2 text-secondary hover:bg-slate-100 hover:text-heading dark:hover:bg-slate-900" aria-label="Close expanded workspace" title="Close expanded workspace">
              <X size={18} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-b-xl border-x border-b border-slate-200 bg-surface-page p-3 dark:border-white/[0.08]">
            <TradeDecisionPanel workspace={workspace} onAction={onAction} allExpanded />
          </div>
        </div>
      )}
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
    <div className="hidden min-h-7 flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-2 py-0.5 text-[11px] dark:border-white/[0.07] md:flex">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={workspace.session.status} />
        <span className="rounded-full border border-slate-200 px-1.5 py-0.5 font-semibold uppercase tracking-wide text-secondary dark:border-white/[0.08]">
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
  rightRailOpen = true,
  onToggleRightRail,
  bottomDockOpen = false,
  bottomDockCount = 0,
  onToggleBottomDock,
  onOpenAllWidgets,
}: {
  workspace: DayTradeWorkspaceResponse
  action: DayTradeWorkspaceAction
  onAction?: (action: DayTradeWorkspaceAction) => void
  onOpenDetails?: () => void
  rightRailOpen?: boolean
  onToggleRightRail?: () => void
  bottomDockOpen?: boolean
  bottomDockCount?: number
  onToggleBottomDock?: () => void
  onOpenAllWidgets?: () => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-2 py-1 dark:border-white/[0.07]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-lg font-black text-heading">{workspace.symbol.ticker}</span>
          <span className="truncate text-sm font-semibold text-secondary">{workspace.symbol.companyName}</span>
          <span className="rounded-full border border-violet-400/40 bg-violet-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-700 dark:text-violet-300">Day Trade</span>
          <span className="font-mono text-base font-black text-heading">{workspace.symbol.price.display}</span>
          <span className={`font-mono text-sm font-bold ${workspaceToneTextClass(workspace.symbol.changeAmount.tone || 'neutral')}`}>{workspace.symbol.changeAmount.display}</span>
          <span className={`font-mono text-sm font-bold ${workspaceToneTextClass(workspace.symbol.change.tone || 'neutral')}`}>{workspace.symbol.change.display}</span>
          {workspace.chart.marketStructure && (
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${marketStructureBadgeClass(`${workspace.chart.marketStructure.display} ${workspace.chart.marketStructure.trend}`)}`}>
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
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1.5 text-xs font-black text-secondary hover:border-violet-400 hover:text-heading dark:border-white/[0.08]"
            aria-label="Open workspace sections"
          >
            <LayoutList size={16} />
            Sections
          </button>
        )}
        {onToggleRightRail && (
          <button
            type="button"
            onClick={onToggleRightRail}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1.5 text-xs font-black text-secondary hover:border-violet-400 hover:text-heading dark:border-white/[0.08]"
            aria-label={rightRailOpen ? 'Collapse right info panel' : 'Expand right info panel'}
            title={rightRailOpen ? 'Collapse right panel' : 'Expand right panel'}
          >
            {rightRailOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
            <span className="hidden xl:inline">{rightRailOpen ? 'Hide Info' : 'Show Info'}</span>
          </button>
        )}
        {onToggleBottomDock && (
          <button
            type="button"
            onClick={onToggleBottomDock}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1.5 text-xs font-black text-secondary hover:border-violet-400 hover:text-heading dark:border-white/[0.08]"
            aria-label={bottomDockOpen ? 'Close bottom widget tray' : 'Open bottom widget tray'}
            title={bottomDockOpen ? 'Close bottom tray and expand chart' : 'Open bottom widget tray'}
          >
            <LayoutList size={16} />
            <span className="hidden sm:inline">{bottomDockOpen ? 'Hide Bottom' : 'Bottom'}</span>
            {bottomDockCount > 0 && <span className="font-mono text-[10px] text-violet-600 dark:text-violet-300">{bottomDockCount}</span>}
          </button>
        )}
        {onOpenAllWidgets && (
          <button
            type="button"
            onClick={onOpenAllWidgets}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-violet-400/50 bg-violet-500/10 px-2 py-1.5 text-xs font-black text-violet-700 hover:border-violet-500 hover:bg-violet-500/15 dark:text-violet-200"
            aria-label="Expand all workspace widgets"
            title="Open all widgets in an expanded workspace"
          >
            <Maximize2 size={16} />
            <span className="hidden sm:inline">Expand All</span>
          </button>
        )}
        {action.label !== 'Create Trigger Alert' && (
          <button
            type="button"
            disabled={!action.enabled}
            onClick={() => onAction?.(action)}
            className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-black uppercase tracking-wide transition ${
              action.enabled
                ? 'bg-violet-600 text-white hover:bg-violet-500'
                : 'cursor-not-allowed border border-slate-200 bg-slate-100 text-tertiary dark:border-white/[0.08] dark:bg-slate-900'
            }`}
            title={action.disabledReason || action.label}
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  )
}

export function WorkspaceCenterFrame({
  workspace,
  displayTimeZone,
  selectedInterval,
  onIntervalChange,
  bottomDockOpen,
  bottomWidgetIds,
  onCloseBottomDock,
  onDockWidget,
  onUndockWidget,
  onAction,
}: {
  workspace: DayTradeWorkspaceResponse
  displayTimeZone: string
  selectedInterval?: '1m' | '5m' | '15m' | '1h'
  onIntervalChange?: (interval: '1m' | '5m' | '15m' | '1h') => void
  bottomDockOpen: boolean
  bottomWidgetIds: string[]
  onCloseBottomDock: () => void
  onDockWidget: (widgetId: string) => void
  onUndockWidget: (widgetId: string) => void
  onAction?: (action: DayTradeWorkspaceAction) => void
}) {
  const onDropBottom = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const sourceId = event.dataTransfer.getData('text/oa-widget-id')
    if (sourceId) onDockWidget(sourceId)
  }
  return (
    <div className={`min-h-0 min-w-0 ${bottomDockOpen ? 'grid gap-1 xl:grid-rows-[minmax(0,3fr)_minmax(180px,1fr)]' : 'flex flex-col'}`}>
      <WorkspaceChartPreview workspace={workspace} displayTimeZone={displayTimeZone} selectedInterval={selectedInterval} onIntervalChange={onIntervalChange} fillFrame={bottomDockOpen} />
      {bottomDockOpen && (
        <section
          className="flex min-h-[180px] min-w-0 flex-col overflow-hidden rounded-lg border border-dashed border-violet-300 bg-violet-50/40 dark:border-violet-500/35 dark:bg-violet-950/20"
          onDragOver={event => event.preventDefault()}
          onDrop={onDropBottom}
        >
          <div className="flex shrink-0 items-center justify-between border-b border-violet-200/70 px-3 py-2 dark:border-violet-500/20">
            <div className="text-[11px] font-black uppercase tracking-widest text-violet-700 dark:text-violet-200">
              Bottom Widget Tray · Drop right widgets here
            </div>
            <button type="button" onClick={onCloseBottomDock} className="rounded-md p-1.5 text-secondary hover:bg-white hover:text-heading dark:hover:bg-slate-900" aria-label="Close bottom widget tray" title="Close bottom tray and expand chart">
              <X size={15} />
            </button>
          </div>
          {bottomWidgetIds.length ? (
            <TradeDecisionPanel
              workspace={workspace}
              onAction={onAction}
              placement="bottom"
              dockedWidgetIds={bottomWidgetIds}
              onUndockWidget={onUndockWidget}
            />
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-xs font-semibold text-violet-700 dark:text-violet-200">
              Drag widgets from the right info panel into this bottom tray.
            </div>
          )}
        </section>
      )}
    </div>
  )
}

export function WorkspaceChartPreview({ workspace, displayTimeZone, selectedInterval, onIntervalChange, fillFrame = false }: { workspace: DayTradeWorkspaceResponse; displayTimeZone: string; selectedInterval?: '1m' | '5m' | '15m' | '1h'; onIntervalChange?: (interval: '1m' | '5m' | '15m' | '1h') => void; fillFrame?: boolean }) {
  const [minimized, setMinimized] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const [chartHeight, setChartHeight] = useState(680)
  const resizeChart = (event: React.PointerEvent<HTMLDivElement>) => {
    const startY = event.clientY
    const startHeight = chartHeight
    event.currentTarget.setPointerCapture(event.pointerId)
    const handleMove = (moveEvent: PointerEvent) => {
      setChartHeight(Math.max(360, Math.min(1100, startHeight + (moveEvent.clientY - startY))))
    }
    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }
  const chartBody = (
    <div className="min-h-0 flex-1" style={{ minHeight: minimized ? 0 : fillFrame ? 0 : `clamp(320px, 62dvh, ${chartHeight}px)` }}>
      <DayTradeWorkspaceChart chart={workspace.chart} marketTimeZone={displayTimeZone} activeInterval={selectedInterval} onIntervalChange={onIntervalChange} />
    </div>
  )
  return (
    <>
    <section className="flex h-full min-h-[220px] min-w-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white p-1 shadow-sm dark:border-white/[0.07] dark:bg-slate-950 md:min-h-0">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-white/[0.07] dark:bg-slate-900/60">
        <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-tertiary">
          <GripVertical size={14} />
          Chart Widget
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setMinimized(cur => !cur)} className="inline-flex h-6 w-6 items-center justify-center rounded-md text-tertiary hover:bg-slate-200 hover:text-heading dark:hover:bg-slate-800" aria-label={minimized ? 'Restore chart widget' : 'Minimize chart widget'} title={minimized ? 'Restore chart' : 'Minimize chart'}>
            {minimized ? <Minimize2 size={13} /> : <Minus size={13} />}
          </button>
          <button type="button" onClick={() => setMaximized(true)} className="inline-flex h-6 w-6 items-center justify-center rounded-md text-tertiary hover:bg-slate-200 hover:text-heading dark:hover:bg-slate-800" aria-label="Maximize chart widget" title="Maximize chart">
            <Maximize2 size={13} />
          </button>
        </div>
      </div>
      {!minimized && chartBody}
      {!minimized && (
        <div className="h-2 shrink-0 cursor-row-resize border-t border-slate-100 bg-slate-50 transition hover:bg-violet-100 active:bg-violet-200 dark:border-white/[0.05] dark:bg-slate-900/70 dark:hover:bg-violet-950/50" onPointerDown={resizeChart} role="separator" aria-orientation="horizontal" aria-label="Resize chart widget" title="Drag to resize chart" />
      )}
    </section>
    {maximized && (
      <div className="fixed inset-2 z-50 flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-white/[0.08] dark:bg-slate-950 sm:inset-4" role="dialog" aria-modal="true" aria-label="Chart widget">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-white/[0.08] dark:bg-slate-900">
          <div className="text-sm font-black uppercase tracking-widest text-heading">Chart Widget</div>
          <button type="button" onClick={() => setMaximized(false)} className="rounded-lg p-2 text-secondary hover:bg-slate-200 hover:text-heading dark:hover:bg-slate-800" aria-label="Close maximized chart">
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 p-2">
          <DayTradeWorkspaceChart chart={workspace.chart} marketTimeZone={displayTimeZone} activeInterval={selectedInterval} onIntervalChange={onIntervalChange} />
        </div>
      </div>
    )}
    </>
  )
}

export function TradeDecisionPanel({
  workspace,
  onAction,
  placement = 'right',
  dockedWidgetIds = [],
  onDockWidget,
  onUndockWidget,
  allExpanded = false,
}: {
  workspace: DayTradeWorkspaceResponse
  onAction?: (action: DayTradeWorkspaceAction) => void
  placement?: WidgetPlacement
  dockedWidgetIds?: string[]
  onDockWidget?: (widgetId: string) => void
  onUndockWidget?: (widgetId: string) => void
  allExpanded?: boolean
}) {
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const engine = workspace.decisionEngine
  const professional = workspace.professionalDecision
  const rrKey = 'risk' + 'Reward'
  const rrValue = workspace.riskPlan[rrKey as keyof typeof workspace.riskPlan] as DayTradeWorkspaceDisplayValue
  const entry = rawNumber(workspace.riskPlan.entry)
  const stop = rawNumber(workspace.riskPlan.stop)
  const target2 = rawNumber(workspace.riskPlan.target2)
  const risk = entry != null && stop != null ? Math.abs(entry - stop) : null
  const reward = entry != null && target2 != null ? Math.abs(target2 - entry) : null
  const decisionChecks = buildDecisionChecks(workspace)
  const decisionWarnings = buildDecisionWarnings(workspace)
  const formingPivot = workspace.chart.marketStructure?.provisionalPivot
  const shouldRenderWidget = (title: string) => {
    const docked = dockedWidgetIds.includes(widgetIdForTitle(title))
    return placement === 'bottom' ? docked : !docked
  }
  const panelProps = { placement, onDockWidget, onUndockWidget, allExpanded }
  return (
    <aside className={placement === 'bottom'
      ? 'grid min-h-0 flex-1 auto-cols-[minmax(280px,420px)] grid-flow-col content-start gap-2 overflow-x-auto overflow-y-hidden p-2'
      : allExpanded
        ? 'grid w-full content-start gap-2 pr-0'
        : 'grid w-full max-h-none content-start gap-2 overflow-visible overscroll-contain pr-0 xl:max-h-none xl:overflow-y-auto xl:pr-1'}>
      {shouldRenderWidget('Current Decision') && <Panel title="Current Decision" {...panelProps}>
        {professional ? (
          <ProfessionalDecisionSummary decision={professional} />
        ) : engine ? (
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <TrendingUp size={16} className={marketStructureBadgeClass(engine.currentState.state).includes('emerald') ? 'text-emerald-600 dark:text-emerald-300' : marketStructureBadgeClass(engine.currentState.state).includes('rose') ? 'text-rose-600 dark:text-rose-300' : 'text-amber-600 dark:text-amber-300'} />
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wide text-tertiary">Current State</div>
                  <div className={`text-sm font-semibold ${inferredValueTextClass('Trend', engine.currentState.state)}`}>{engine.currentState.state}</div>
                </div>
              </div>
              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-black uppercase tracking-wide ${workspaceToneBadgeClass(engine.currentAction.action === 'WAIT' ? 'warning' : engine.currentAction.action.includes('EXIT') ? 'danger' : 'positive')}`}>
                {engine.currentAction.action}
              </span>
            </div>
            <div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-tertiary">Reason</div>
              <div className="text-xs leading-relaxed text-secondary">{engine.currentAction.reason}</div>
            </div>
            <div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-tertiary">Backend Reasoning</div>
              <div className="grid gap-1">
                {engine.reasoning.slice(0, 4).map(item => (
                  <div key={item} className="flex items-center gap-2 text-xs text-secondary">
                    <CheckCircle2 size={13} className="shrink-0 text-emerald-600 dark:text-emerald-300" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-tertiary">Reward / Risk</div>
              <div className="grid grid-cols-3 gap-1.5">
                <MiniMetric label="Risk" value={engine.rewardRisk.risk.display} tone="danger" />
                <MiniMetric label="Reward" value={engine.rewardRisk.reward.display} tone="positive" />
                <MiniMetric label="R:R" value={engine.rewardRisk.display} tone={engine.rewardRisk.ratio != null && engine.rewardRisk.ratio >= 1.2 ? 'positive' : 'warning'} />
              </div>
            </div>
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
              <div className="text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-200">Recommendation</div>
              <div className="mt-1 text-xs leading-relaxed text-secondary">{engine.currentAction.recommendation}</div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <TrendingUp size={16} className={marketStructureBadgeClass(formatTrendLabel(workspace)).includes('emerald') ? 'text-emerald-600 dark:text-emerald-300' : marketStructureBadgeClass(formatTrendLabel(workspace)).includes('rose') ? 'text-rose-600 dark:text-rose-300' : 'text-amber-600 dark:text-amber-300'} />
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wide text-tertiary">Trend</div>
                  <div className={`text-sm font-semibold ${inferredValueTextClass('Trend', formatTrendLabel(workspace))}`}>{formatTrendLabel(workspace)}</div>
                </div>
              </div>
              <StatusPill status={workspace.decision.permission} />
            </div>
            <div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-tertiary">Reason Blocked</div>
              <div className="grid gap-1">
                {(decisionChecks.length ? decisionChecks : [workspace.decision.context.label, workspace.trigger.status.label]).map(item => (
                  <div key={item} className="flex items-center gap-2 text-xs text-secondary">
                    <CheckCircle2 size={13} className="shrink-0 text-emerald-600 dark:text-emerald-300" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
            {decisionWarnings.length > 0 && (
              <div>
                <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-tertiary">But</div>
                <div className="grid gap-1">
                  {decisionWarnings.map(item => (
                    <div key={item} className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-200">
                      <AlertTriangle size={13} className="shrink-0" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-tertiary">Risk / Reward</div>
              <div className="grid grid-cols-3 gap-1.5">
                <MiniMetric label="Risk" value={moneyValue(risk)} tone="danger" />
                <MiniMetric label="Reward" value={moneyValue(reward)} tone="positive" />
                <MiniMetric label="R:R" value={rrValue.display} tone={rrValue.tone || 'warning'} />
              </div>
            </div>
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
              <div className="text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-200">Action</div>
              <div className="mt-1 text-xs leading-relaxed text-secondary">{buildActionCopy(workspace)}</div>
            </div>
          </div>
        )}
      </Panel>}
      <DayTradePriorContext ctx={(workspace as unknown as { priorContext?: PriorContext }).priorContext} />
      <DayTradeMultiDayChart bars={(workspace as unknown as { priorContext?: { multiDay?: MultiDayBar[] } }).priorContext?.multiDay} />
      {shouldRenderWidget('Entry / Stop / Targets') && <Panel title="Entry / Stop / Targets" {...panelProps}>
        <div className="grid grid-cols-2 gap-2">
          <Value label="Entry" value={professional?.risk.entry.display ?? workspace.riskPlan.entry.display} />
          <Value label="Stop" value={professional?.risk.stop.display ?? workspace.riskPlan.stop.display} />
          <Value label="Risk" value={professional?.risk.risk.display ?? moneyValue(risk)} />
          <Value label="Target" value={professional?.risk.target.display ?? workspace.riskPlan.target2.display} />
          <Value label="R/R" value={professional?.risk.riskReward.display ?? rrValue.display} />
          <Value label="Reward Left" value={professional?.risk.rewardRemaining.display ?? moneyValue(reward)} />
          <Value label="Risk Left" value={professional?.risk.riskRemaining.display ?? moneyValue(risk)} />
          <Value label="Quality" value={professional?.risk.tradeQuality.display ?? '—'} />
        </div>
        <div className="mt-3">
          <SetupExitPlanner
            compact
            entry={rawNumber(workspace.riskPlan.entry)}
            stop={rawNumber(workspace.riskPlan.stop)}
            target={rawNumber(workspace.riskPlan.target1) ?? rawNumber(workspace.riskPlan.target2)}
            target2={rawNumber(workspace.riskPlan.target2)}
            current={rawNumber(workspace.symbol.price)}
            direction={(rawNumber(workspace.riskPlan.stop) ?? 0) < (rawNumber(workspace.riskPlan.entry) ?? 0) ? 'long' : 'short'}
          />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          <QuickTradeAction
            label="Journal"
            icon={<BookOpen size={13} />}
            onClick={() => onAction?.({ id: 'quick_journal', type: 'journal', label: 'Add to Journal', enabled: true })}
          />
          <QuickTradeAction
            label="Position"
            icon={<BriefcaseBusiness size={13} />}
            onClick={() => onAction?.({ id: 'quick_position', type: 'position', label: 'Add to Positions Center', enabled: true })}
          />
          <QuickTradeAction
            label="Alpaca"
            icon={<RadioTower size={13} />}
            onClick={() => onAction?.({ id: 'quick_alpaca', type: 'alpaca', label: 'Open Alpaca Trading', enabled: true })}
          />
        </div>
      </Panel>}
      {shouldRenderWidget('Setup') && <Panel title="Setup" {...panelProps}>
        {engine ? (
          <div className="grid gap-2">
            <Value label="Today's Setup" value={engine.setup.setupType} />
            <Value label="Status" value={engine.setup.status} />
            <Value label="Triggered" value={engine.setup.triggerTime || '—'} />
            <Value label="Entry" value={engine.setup.triggerPrice == null ? '—' : `$${engine.setup.triggerPrice.toFixed(2)}`} />
            <Value label="Valid Window" value={engine.setup.validFrom && engine.setup.validUntil ? `${engine.setup.validFrom} - ${engine.setup.validUntil}` : '—'} />
            <Value label={engine.setup.result || 'Current Result'} value={engine.setup.currentGainPct == null ? '—' : `${engine.setup.currentGainPct >= 0 ? '+' : ''}${engine.setup.currentGainPct.toFixed(2)}%`} />
          </div>
        ) : (
          <div className="grid gap-2">
            <Value label="Setup" value={workspace.decision.setupName || '—'} />
            <div>
              <div className="text-[10px] font-black uppercase tracking-wide text-tertiary">Context</div>
              <StatusPill status={workspace.decision.context} />
            </div>
          </div>
        )}
      </Panel>}
      {shouldRenderWidget('Market Structure') && <Panel title="Market Structure" {...panelProps}>
        {workspace.chart.marketStructure ? (
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-black uppercase tracking-wide text-tertiary">Trend</span>
              <span className={`text-xs font-semibold ${inferredValueTextClass('Trend', workspace.chart.marketStructure.trend)}`}>{workspace.chart.marketStructure.trend.replace(/_/g, ' ')}</span>
            </div>
            <Value label="Sequence" value={workspace.chart.marketStructure.sequence.length ? workspace.chart.marketStructure.sequence.join(' → ') : workspace.chart.marketStructure.display} />
            <Value label="Current Pivot" value={workspace.chart.marketStructure.currentPivot || '—'} />
            {formingPivot && (
              <Value
                label="Forming"
                value={`${formingPivot.label}? · $${formingPivot.price.toFixed(2)}`}
              />
            )}
            <Value label="Expected Next" value={workspace.chart.marketStructure.expectedNextPivot || '—'} />
            <Value label="Invalidation" value={workspace.chart.marketStructure.invalidationLevel == null ? '—' : `$${workspace.chart.marketStructure.invalidationLevel.toFixed(2)}`} />
            <Value label="Strength" value={workspace.chart.marketStructure.structureStrength == null ? '—' : `${workspace.chart.marketStructure.structureStrength.toFixed(0)}%`} />
            {engine && (
              <>
                <Value label="Trend Health" value={`${engine.trendHealth.score.toFixed(0)}/100 · ${engine.trendHealth.label}`} />
                <Value label="Expected" value={engine.expectedStructure.expected.map(item => `${item.label} ${item.probability.toFixed(0)}%`).join(' · ')} />
              </>
            )}
            <div className="rounded-md bg-slate-50 px-2 py-1 text-[11px] text-tertiary dark:bg-slate-900">
              {formingPivot?.explanation || workspace.chart.marketStructure.explanation || 'Backend-confirmed 5m structure.'}
            </div>
          </div>
        ) : (
          <div className="text-xs text-tertiary">No backend market structure payload for this workspace.</div>
        )}
      </Panel>}
      {shouldRenderWidget('Trigger') && <Panel title="Trigger" {...panelProps}>
        <StatusPill status={workspace.trigger.status} />
        <div className="mt-2 text-xs text-secondary">{workspace.trigger.summary}</div>
        {engine && (
          <div className="mt-2 rounded-lg border border-sky-500/25 bg-sky-500/10 px-3 py-2">
            <div className="text-[10px] font-black uppercase tracking-wide text-sky-700 dark:text-sky-200">Next Opportunity</div>
            <div className="mt-1 text-sm font-semibold text-heading">{engine.nextOpportunity.nextOpportunity}</div>
            <div className="mt-1 text-xs text-secondary">{engine.nextOpportunity.trigger}</div>
            <div className="mt-1 font-mono text-xs font-bold text-sky-700 dark:text-sky-200">{engine.nextOpportunity.probability.toFixed(0)}%</div>
          </div>
        )}
        <div className="mt-2 grid gap-1">
          {workspace.trigger.requirements.map(item => (
            <div key={item.id} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2 py-1 text-xs dark:bg-slate-900">
              <span className="text-secondary">{item.label}</span>
              <span className={`font-bold ${workspaceToneTextClass(item.tone)}`}>{item.displayValue || item.result}</span>
            </div>
          ))}
        </div>
      </Panel>}
      <RiskMonitorPanel workspace={workspace} placement={placement} dockedWidgetIds={dockedWidgetIds} onDockWidget={onDockWidget} onUndockWidget={onUndockWidget} />
      {workspace.selectedContract && (
        shouldRenderWidget('Contract / Risk') && <Panel title="Contract / Risk" {...panelProps}>
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
      {shouldRenderWidget('Why This State') && <Panel title="Why This State" {...panelProps}>
        {professional ? (
          <ProfessionalWhy decision={professional} />
        ) : (
          <>
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
          </>
        )}
      </Panel>}
    </aside>
  )
}

function ProfessionalDecisionSummary({ decision }: { decision: ProfessionalDecisionPayload }) {
  const h = decision.hierarchy
  const blockers = decision.blockers ?? []
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Value label="Market" value={h.marketContext.display} />
        <Value label="Stock Bias" value={h.stockBias.display} />
        <Value label="Setup" value={h.setup.display} />
        <Value label="Current Phase" value={h.currentPhase.display} />
        <Value label="Original Entry" value={h.originalEntry?.display || '—'} />
        <Value label="Current Action" value={h.currentAction.display} />
        <Value label="Next Opportunity" value={h.nextOpportunity.display} />
        <Value label="Confidence" value={decision.confidence.tradeConfidence.display} />
        <Value label="Bias Confidence" value={decision.confidence.biasConfidence.display} />
        <Value label="Entry Quality" value={decision.confidence.entryQuality.display} />
        <Value label="Entry Timing" value={decision.confidence.entryTiming.display} />
        <Value label="Trade Score" value={decision.scores.overallTradeScore?.display || '—'} />
      </div>
      <div className={`rounded-lg border px-3 py-2 ${blockers.length ? 'border-amber-500/30 bg-amber-500/10' : 'border-emerald-500/25 bg-emerald-500/10'}`}>
        <div className={`text-[10px] font-black uppercase tracking-wide ${blockers.length ? 'text-amber-700 dark:text-amber-200' : 'text-emerald-700 dark:text-emerald-200'}`}>
          Intraday Blockers
        </div>
        {blockers.length ? (
          <div className="mt-1 grid gap-1">
            {blockers.map(blocker => (
              <div key={`${blocker.display}-${blocker.timestamp || ''}`} className="flex items-start gap-2 text-xs text-secondary">
                <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-300" />
                <span>{blocker.display}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-1 flex items-center gap-2 text-xs text-secondary">
            <CheckCircle2 size={13} className="shrink-0 text-emerald-600 dark:text-emerald-300" />
            <span>No intraday blockers</span>
          </div>
        )}
      </div>
      {h.nextOpportunity.reason && (
        <div className="rounded-lg border border-sky-500/25 bg-sky-500/10 px-3 py-2 text-xs text-secondary">
          <div className="text-[10px] font-black uppercase tracking-wide text-sky-700 dark:text-sky-200">Wait For</div>
          <div className="mt-1 font-semibold text-heading">{h.nextOpportunity.display}</div>
          <div className="mt-1 leading-relaxed">{h.nextOpportunity.reason}</div>
        </div>
      )}
      <div className="grid gap-1">
        {decision.aiCoach.lines.slice(0, 6).map(line => (
          <div key={line} className="rounded-md bg-slate-50 px-2 py-1 text-xs text-secondary dark:bg-slate-900">{line}</div>
        ))}
      </div>
    </div>
  )
}

function ProfessionalWhy({ decision }: { decision: ProfessionalDecisionPayload }) {
  return (
    <div className="space-y-3">
      <FactorGroup title="Positive" items={decision.why.positiveFactors} tone="positive" />
      <FactorGroup title="Negative" items={decision.why.negativeFactors} tone="danger" />
      <FactorGroup title="Neutral" items={decision.why.neutralFactors} tone="neutral" />
      <div className="rounded-lg border border-slate-200 p-2 dark:border-white/[0.08]">
        <div className="text-[10px] font-black uppercase tracking-widest text-tertiary">What Changes The Decision</div>
        <FactorGroup title="Bullish If" items={decision.changesDecision.bullish} tone="positive" compact />
        <FactorGroup title="Bearish If" items={decision.changesDecision.bearish} tone="danger" compact />
        <FactorGroup title="Invalidated If" items={decision.changesDecision.invalidation} tone="danger" compact />
      </div>
    </div>
  )
}

function FactorGroup({ title, items, tone, compact = false }: { title: string; items: ProfessionalDecisionPayload['why']['positiveFactors']; tone: string; compact?: boolean }) {
  const iconClass = tone === 'positive' ? 'text-emerald-600 dark:text-emerald-300' : tone === 'danger' ? 'text-rose-600 dark:text-rose-300' : 'text-tertiary'
  if (!items.length) return null
  return (
    <div className={compact ? 'mt-2' : ''}>
      <div className="mb-1 text-[10px] font-black uppercase tracking-wide text-tertiary">{title}</div>
      <div className="grid gap-1">
        {items.slice(0, compact ? 3 : 6).map(item => (
          <div key={`${title}-${item.display}-${item.reason || ''}`} className="flex gap-2 rounded-md bg-slate-50 px-2 py-1 text-xs dark:bg-slate-900">
            {tone === 'danger' ? <AlertTriangle size={13} className={`mt-0.5 shrink-0 ${iconClass}`} /> : <CheckCircle2 size={13} className={`mt-0.5 shrink-0 ${iconClass}`} />}
            <span className="min-w-0">
              <span className="font-semibold text-heading">{item.display}</span>
              {item.reason && <span className="text-secondary"> — {item.reason}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
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

function RiskMonitorPanel({
  workspace,
  placement = 'right',
  dockedWidgetIds = [],
  onDockWidget,
  onUndockWidget,
}: {
  workspace: DayTradeWorkspaceResponse
  placement?: WidgetPlacement
  dockedWidgetIds?: string[]
  onDockWidget?: (widgetId: string) => void
  onUndockWidget?: (widgetId: string) => void
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const monitor = workspace.trapDetection?.riskMonitor
  const items = monitor?.items || []
  const title = monitor?.title || 'Risk Monitor'
  const docked = dockedWidgetIds.includes(widgetIdForTitle(title))

  if (!workspace.trapDetection?.enabled) return null
  if (placement === 'bottom' ? !docked : docked) return null

  return (
    <Panel title={title} placement={placement} onDockWidget={onDockWidget} onUndockWidget={onUndockWidget}>
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
      <div className="px-3 pb-3">
        <AICoachWidget
          mode="day_trade"
          compact
          heading="AI Coach — Day Trade Setup"
          title={`${workspace.symbol.ticker} day trade`}
          context={{
            ticker: workspace.symbol.ticker,
            price: workspace.symbol.price?.display,
            change: workspace.symbol.change?.display,
            decision: workspace.decision.headline,
            action: workspace.decision.primaryAction?.label,
            setup: workspace.decision.setupName,
            context: workspace.decision.context?.label,
            permission: workspace.decision.permission?.label,
            marketStructure: workspace.chart?.marketStructure
              ? `${workspace.chart.marketStructure.display} · ${workspace.chart.marketStructure.trend}` : undefined,
            risk: {
              entry: workspace.riskPlan.entry?.display,
              stop: workspace.riskPlan.stop?.display,
              target1: workspace.riskPlan.target1?.display,
              target2: workspace.riskPlan.target2?.display,
              riskReward: workspace.riskPlan.riskReward?.display,
            },
          }}
        />
      </div>
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

function workspaceSectionCardClass(tone?: string): string {
  const raw = String(tone || '').toLowerCase()
  if (raw.includes('positive') || raw.includes('success') || raw.includes('green') || raw.includes('bull') || raw.includes('pass')) {
    return 'border-emerald-500/25 bg-emerald-500/10'
  }
  if (raw.includes('negative') || raw.includes('danger') || raw.includes('red') || raw.includes('bear') || raw.includes('fail')) {
    return 'border-rose-500/25 bg-rose-500/10'
  }
  if (raw.includes('warning') || raw.includes('amber') || raw.includes('wait') || raw.includes('yellow')) {
    return 'border-amber-500/25 bg-amber-500/10'
  }
  return 'border-slate-200 bg-white dark:border-white/[0.08] dark:bg-slate-950'
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
      <div className="grid gap-3">
        <section className="rounded-xl border border-violet-500/25 bg-violet-500/10 p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-violet-700 dark:text-violet-200">
                <LayoutList size={13} />
                {payload.title || name}
              </div>
              {payload.summary && <div className="mt-2 max-w-4xl text-sm leading-relaxed text-secondary">{payload.summary}</div>}
            </div>
            <span className="rounded-full border border-violet-500/30 bg-white/60 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-violet-700 dark:bg-slate-950/40 dark:text-violet-200">
              {items.length} item{items.length === 1 ? '' : 's'}
            </span>
          </div>
        </section>
        <div className="grid gap-2">
          {items.length ? items.map((item, index) => (
            <div key={`${item.label || 'item'}-${index}`} className={`rounded-xl border p-3 ${workspaceSectionCardClass(item.tone)}`}>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                <div className="min-w-0">
                  <div className="text-[10px] font-black uppercase tracking-widest text-tertiary">{item.label || `Item ${index + 1}`}</div>
                  <div className={`mt-1 break-words font-mono text-base font-semibold tabular-nums ${workspaceToneTextClass(item.tone || 'neutral')}`}>{item.value || '—'}</div>
                </div>
                <span className={`w-fit rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${workspaceToneBadgeClass(item.tone || 'neutral')}`}>
                  {item.tone || 'neutral'}
                </span>
              </div>
              {item.detail && <div className="mt-2 rounded-lg border border-slate-200/80 bg-white/65 px-3 py-2 text-xs leading-relaxed text-secondary dark:border-white/[0.08] dark:bg-slate-950/45">{item.detail}</div>}
            </div>
          )) : (
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-tertiary dark:border-white/[0.08] dark:bg-slate-950">
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

function Panel({
  title,
  children,
  placement = 'right',
  onDockWidget,
  onUndockWidget,
  allExpanded = false,
}: {
  title: string
  children: React.ReactNode
  placement?: WidgetPlacement
  onDockWidget?: (widgetId: string) => void
  onUndockWidget?: (widgetId: string) => void
  allExpanded?: boolean
}) {
  const pinnedFullLength = title === 'Current Decision'
  const widgetId = widgetIdForTitle(title)
  const [minimized, setMinimized] = useState(!allExpanded && !pinnedFullLength)
  const [maximized, setMaximized] = useState(false)
  const [bodyMaxHeight, setBodyMaxHeight] = useState(pinnedFullLength ? 860 : 720)
  const startWidgetDrag = (event: React.DragEvent<HTMLElement>) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/oa-widget-id', widgetId)
  }
  const dropWidget = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault()
    const sourceId = event.dataTransfer.getData('text/oa-widget-id')
    if (!sourceId || sourceId === widgetId) return
    const target = event.currentTarget
    const source = target.parentElement?.querySelector<HTMLElement>(`[data-widget-id="${sourceId}"]`)
    if (!source || !target.parentElement) return
    const rect = target.getBoundingClientRect()
    const placeBefore = event.clientY < rect.top + rect.height / 2
    target.parentElement.insertBefore(source, placeBefore ? target : target.nextSibling)
  }
  const resizeWidget = (event: React.PointerEvent<HTMLDivElement>) => {
    const startY = event.clientY
    const startHeight = bodyMaxHeight
    event.currentTarget.setPointerCapture(event.pointerId)
    const handleMove = (moveEvent: PointerEvent) => {
      const viewportCap = Math.max(280, window.innerHeight - 180)
      setBodyMaxHeight(Math.max(220, Math.min(Math.max(viewportCap, 420), startHeight + (moveEvent.clientY - startY))))
    }
    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }
  const body = (
    <div
      className={allExpanded ? 'min-h-0 overflow-visible break-words p-3' : 'min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain break-words p-3'}
      style={{ maxHeight: placement === 'bottom' || allExpanded ? 'none' : `min(70vh, ${bodyMaxHeight}px)` }}
    >
      {children}
    </div>
  )
  return (
    <>
    <section
      className={`day-trade-widget flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-white/[0.07] dark:bg-slate-950 ${placement === 'bottom' ? 'h-full' : ''}`}
      data-widget-id={widgetId}
      onDragOver={event => event.preventDefault()}
      onDrop={dropWidget}
    >
      <div
        className="flex shrink-0 cursor-grab items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 active:cursor-grabbing dark:border-white/[0.07] dark:bg-slate-900/60"
        draggable
        onDragStart={startWidgetDrag}
      >
        <button
          type="button"
          onClick={() => !pinnedFullLength && setMinimized(cur => !cur)}
          className={`flex min-w-0 flex-1 items-center gap-2 text-left text-[11px] font-black uppercase tracking-widest text-tertiary ${pinnedFullLength ? 'cursor-grab' : 'cursor-pointer hover:text-heading'}`}
          aria-expanded={pinnedFullLength || !minimized}
          aria-label={pinnedFullLength ? title : `${minimized ? 'Restore' : 'Minimize'} ${title} widget`}
        >
          <GripVertical size={14} className="shrink-0" />
          <span className="truncate">{title}</span>
        </button>
        <div className="flex items-center gap-1">
          <span className="rounded-full border border-slate-200 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-tertiary dark:border-white/[0.08]">
            Widget
          </span>
          {placement === 'right' && onDockWidget && (
            <button
              type="button"
              onClick={() => onDockWidget(widgetId)}
              className="hidden rounded-md border border-slate-200 px-1.5 py-1 text-[9px] font-black uppercase tracking-wide text-tertiary hover:border-violet-400 hover:text-heading dark:border-white/[0.08] sm:inline-flex"
              aria-label={`Move ${title} widget to bottom tray`}
              title="Move widget to bottom tray"
            >
              Bottom
            </button>
          )}
          {placement === 'bottom' && onUndockWidget && (
            <button
              type="button"
              onClick={() => onUndockWidget(widgetId)}
              className="rounded-md border border-slate-200 px-1.5 py-1 text-[9px] font-black uppercase tracking-wide text-tertiary hover:border-violet-400 hover:text-heading dark:border-white/[0.08]"
              aria-label={`Move ${title} widget back to right panel`}
              title="Move widget back to right panel"
            >
              Right
            </button>
          )}
          {!pinnedFullLength && (
            <button
              type="button"
              onClick={() => setMinimized(cur => !cur)}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-tertiary hover:bg-slate-200 hover:text-heading dark:hover:bg-slate-800"
              aria-label={minimized ? `Restore ${title} widget` : `Minimize ${title} widget`}
              title={minimized ? 'Restore widget' : 'Minimize widget'}
            >
              {minimized ? <Minimize2 size={13} /> : <Minus size={13} />}
            </button>
          )}
          <button
            type="button"
            onClick={() => setMaximized(true)}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-tertiary hover:bg-slate-200 hover:text-heading dark:hover:bg-slate-800"
            aria-label={`Maximize ${title} widget`}
            title="Maximize widget"
          >
            <Maximize2 size={13} />
          </button>
        </div>
      </div>
      {(!minimized || pinnedFullLength) && (
        <>
          {body}
          <div
            className="h-2 shrink-0 cursor-row-resize border-t border-slate-100 bg-slate-50 transition hover:bg-violet-100 active:bg-violet-200 dark:border-white/[0.05] dark:bg-slate-900/70 dark:hover:bg-violet-950/50"
            onPointerDown={placement === 'bottom' ? undefined : resizeWidget}
            role="separator"
            aria-orientation="horizontal"
            aria-label={`Resize ${title} widget`}
            title={placement === 'bottom' ? 'Bottom tray height is controlled by the center frame' : 'Drag to resize widget'}
          />
        </>
      )}
    </section>
    {maximized && (
      <div className="fixed inset-x-2 inset-y-3 z-50 flex max-w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-white/[0.08] dark:bg-slate-950 sm:left-auto sm:right-3 sm:w-[min(520px,calc(100vw-1.5rem))]" role="dialog" aria-modal="true" aria-label={`${title} widget`}>
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-white/[0.08] dark:bg-slate-900">
          <div className="text-sm font-black uppercase tracking-widest text-heading">{title}</div>
          <button type="button" onClick={() => setMaximized(false)} className="rounded-lg p-2 text-secondary hover:bg-slate-200 hover:text-heading dark:hover:bg-slate-800" aria-label="Close maximized widget">
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
      </div>
    )}
    </>
  )
}

function Value({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md bg-slate-50 px-2 py-1 dark:bg-slate-900">
      <div className="truncate text-[10px] font-bold uppercase tracking-wide text-tertiary">{label}</div>
      <div className={`truncate font-mono text-sm font-semibold ${inferredValueTextClass(label, value)}`}>{value}</div>
    </div>
  )
}

function MiniMetric({ label, value, tone }: { label: string; value: string; tone: string }) {
  const cls = tone === 'positive'
    ? 'text-emerald-600 dark:text-emerald-300'
    : tone === 'danger'
      ? 'text-rose-600 dark:text-rose-300'
      : tone === 'warning'
        ? 'text-amber-600 dark:text-amber-300'
        : 'text-heading'
  return (
    <div className="min-w-0 rounded-md bg-slate-50 px-2 py-1 dark:bg-slate-900">
      <div className="truncate text-[9px] font-bold uppercase tracking-wide text-tertiary">{label}</div>
      <div className={`truncate font-mono text-xs font-semibold ${cls}`}>{value}</div>
    </div>
  )
}

function QuickTradeAction({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-9 min-w-0 items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-secondary transition hover:border-violet-400 hover:text-heading dark:border-white/[0.08] dark:bg-slate-950"
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  )
}
