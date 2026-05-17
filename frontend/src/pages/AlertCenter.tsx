import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bell, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { acknowledgeAlert, fetchAlertCenterPage, resolveAlert } from '../api/commandCenter'
import type { AlertCenterPayload, UnifiedAlert } from '../types/commandCenter'
import { useApp } from '../contexts/AppContext'

const SECTION_ORDER: Array<{ key: keyof AlertCenterPayload['sections']; title: string }> = [
  { key: 'day_trade', title: 'Day Trade Alerts' },
  { key: 'swing_trade', title: 'Swing Trade Alerts' },
  { key: 'regular_trade', title: 'Regular Trade Alerts' },
  { key: 'portfolio', title: 'Portfolio Alerts' },
  { key: 'market', title: 'Market Alerts' },
]

function fmtTime(value?: string | null): string {
  if (!value) return '—'
  const ts = Date.parse(value)
  if (!Number.isFinite(ts)) return '—'
  return new Date(ts).toLocaleString()
}

function SeverityBadge({ severity }: { severity: UnifiedAlert['severity'] }) {
  const cls =
    severity === 'CRITICAL'
      ? 'oa-severity-critical'
      : severity === 'WARNING'
        ? 'oa-severity-warning'
        : 'oa-severity-info'
  return <span className={`oa-severity-badge ${cls}`}>{severity}</span>
}

function SignalBadge({ signal }: { signal: UnifiedAlert['signal'] }) {
  const cls =
    signal === 'GO'
      ? 'oa-signal-badge oa-signal-go'
      : signal === 'WATCH' || signal === 'WAIT' || signal === 'SCALE_OUT'
        ? 'oa-signal-badge oa-signal-watch'
        : 'oa-signal-badge oa-signal-avoid'
  return <span className={cls}>{signal}</span>
}

function EngineBadge({ engine }: { engine: UnifiedAlert['engine_type'] }) {
  return <span className="oa-engine-badge">{engine}</span>
}

function StatusBadge({ status }: { status: UnifiedAlert['status'] }) {
  const cls =
    status === 'ACTIVE'
      ? 'text-red-300 bg-red-500/10 border-red-500/30'
      : status === 'ACKNOWLEDGED'
        ? 'text-amber-200 bg-amber-500/10 border-amber-500/30'
        : 'text-gray-300 bg-gray-500/10 border-gray-500/30'
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{status}</span>
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'neutral' | 'warning' | 'critical' | 'positive'
}) {
  const cls =
    tone === 'critical'
      ? 'border-red-500/25 bg-red-500/8 text-red-100'
      : tone === 'warning'
        ? 'border-amber-500/25 bg-amber-500/8 text-amber-100'
        : tone === 'positive'
          ? 'border-emerald-500/25 bg-emerald-500/8 text-emerald-100'
          : 'border-gray-700 bg-gray-900 text-gray-100'
  return (
    <div className={`rounded-2xl border px-4 py-3 ${cls}`}>
      <div className="text-xs uppercase tracking-wide text-gray-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  )
}

function longText(text: string): boolean {
  return text.length > 120
}

export default function AlertCenter() {
  const navigate = useNavigate()
  const { requestAnalysis, canAccessPage } = useApp()
  const canDay   = canAccessPage('day-trade')
  const canSwing = canAccessPage('swing-trade')

  const visibleSections = SECTION_ORDER.filter(s => {
    if (s.key === 'day_trade')   return canDay
    if (s.key === 'swing_trade') return canSwing
    return true
  })
  const [payload, setPayload] = useState<AlertCenterPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [engineType, setEngineType] = useState('')
  const [severity, setSeverity] = useState('')
  const [status, setStatus] = useState('')
  const [ticker, setTicker] = useState('')
  const [activeOnly, setActiveOnly] = useState(true)
  const [todayOnly, setTodayOnly] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const env = await fetchAlertCenterPage({
        engine_type: engineType || undefined,
        severity: severity || undefined,
        status: status || undefined,
        ticker: ticker.trim() || undefined,
        active_only: activeOnly,
        today_only: todayOnly,
      })
      if (import.meta.env.DEV) {
        const rawAlerts = env.data?.alerts ?? []
        const groupedCount = Object.values(env.data?.sections ?? {}).reduce((sum, rows) => sum + rows.length, 0)
        console.debug('[alerts] alert center load', {
          endpoint: '/api/alerts',
          sidebarCount: null,
          alertCenterRawCount: rawAlerts.length,
          afterActiveFilter: activeOnly ? rawAlerts.length : null,
          afterStatusFilter: status || 'ALL',
          afterEngineTypeFilter: engineType || 'ALL',
          afterGrouping: groupedCount,
          summary: env.data?.summary ?? null,
        })
      }
      setPayload(env.data)
      window.dispatchEvent(new Event('oa-alert-center-updated'))
    } finally {
      setLoading(false)
    }
  }, [activeOnly, engineType, severity, status, ticker, todayOnly])

  useEffect(() => {
    void load()
  }, [load])

  const allAlerts = payload?.alerts ?? []
  const alerts = allAlerts.filter(a => {
    const t = String(a.engine_type || '').toUpperCase()
    if (t === 'DAY')   return canDay
    if (t === 'SWING') return canSwing
    return true
  })
  const sections = payload?.sections ?? {
    day_trade: [],
    swing_trade: [],
    regular_trade: [],
    portfolio: [],
    market: [],
  }

  const summary = useMemo(() => {
    const raw = payload?.summary
    if (raw) return raw
    return {
      total: alerts.length,
      active: alerts.filter(a => a.status === 'ACTIVE').length,
      critical: alerts.filter(a => a.severity === 'CRITICAL').length,
      warning: alerts.filter(a => a.severity === 'WARNING').length,
      info: alerts.filter(a => a.severity === 'INFO').length,
      profit_protection: alerts.filter(a => ['SCALE_OUT', 'PROTECT_PROFITS', 'PROFIT_TARGET_HIT'].includes(a.alert_type)).length,
      trade_entry: alerts.filter(a =>
        ['DAY_GO', 'DAY_WAIT', 'OR_BREAKOUT', 'SWING_GO', 'SWING_WATCH', 'BREAKOUT_CONFIRMED', 'RELATIVE_STRENGTH', 'LATE_DAY_STRENGTH', 'REGULAR_TRADE', 'REGULAR_WATCH', 'CREDIT_SPREAD_TARGET'].includes(a.alert_type)
      ).length,
    }
  }, [alerts, payload?.summary])

  const toggleSection = (key: string) => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }))
  const toggleRow = (id: string) => setExpandedRows(prev => ({ ...prev, [id]: !prev[id] }))

  const onAck = async (id: string) => {
    await acknowledgeAlert(id)
    window.dispatchEvent(new Event('oa-alert-center-updated'))
    void load()
  }

  const onResolve = async (id: string) => {
    await resolveAlert(id)
    window.dispatchEvent(new Event('oa-alert-center-updated'))
    void load()
  }

  return (
    <div className="oa-cc-page mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-100">Alert Center</h1>
          <p className="mt-1 text-sm text-gray-500">
            One normalized stream for entry, exit, risk, and market alerts across all trading engines.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm font-semibold text-gray-200"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <SummaryCard label="Total Active Alerts" value={summary.active ?? 0} tone="neutral" />
        <SummaryCard label="Critical Alerts" value={summary.critical ?? 0} tone="critical" />
        <SummaryCard label="Warning Alerts" value={summary.warning ?? 0} tone="warning" />
        <SummaryCard label="Profit Protection Alerts" value={summary.profit_protection ?? 0} tone="warning" />
        <SummaryCard label="Trade Entry Alerts" value={summary.trade_entry ?? 0} tone="positive" />
      </div>

      <div className="flex flex-wrap items-end gap-2 sm:gap-3">
        <label className="text-[10px] sm:text-xs text-gray-500">
          Engine Type
          <select
            value={engineType}
            onChange={e => setEngineType(e.target.value)}
            className="mt-1 block w-full min-w-[100px] sm:w-36 rounded-lg border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs sm:text-sm"
          >
            <option value="">All</option>
            {canDay   && <option value="DAY">Day</option>}
            {canSwing && <option value="SWING">Swing</option>}
            <option value="REGULAR">Regular</option>
            <option value="PORTFOLIO">Portfolio</option>
            <option value="MARKET">Market</option>
          </select>
        </label>
        <label className="text-[10px] sm:text-xs text-gray-500">
          Severity
          <select
            value={severity}
            onChange={e => setSeverity(e.target.value)}
            className="mt-1 block w-full min-w-[90px] sm:w-32 rounded-lg border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs sm:text-sm"
          >
            <option value="">All</option>
            <option value="INFO">Info</option>
            <option value="WARNING">Warning</option>
            <option value="CRITICAL">Critical</option>
          </select>
        </label>
        <label className="text-[10px] sm:text-xs text-gray-500">
          Status
          <select
            value={status}
            onChange={e => setStatus(e.target.value)}
            className="mt-1 block w-full min-w-[100px] sm:w-40 rounded-lg border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs sm:text-sm"
          >
            <option value="">All</option>
            <option value="ACTIVE">Active</option>
            <option value="ACKNOWLEDGED">Acknowledged</option>
            <option value="RESOLVED">Resolved</option>
          </select>
        </label>
        <label className="text-[10px] sm:text-xs text-gray-500">
          Ticker
          <input
            value={ticker}
            onChange={e => setTicker(e.target.value.toUpperCase())}
            placeholder="e.g. NVDA"
            className="mt-1 block w-full min-w-[80px] sm:w-28 rounded-lg border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs sm:text-sm uppercase"
          />
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 sm:gap-2 text-[10px] sm:text-xs text-gray-400 whitespace-nowrap pt-1">
          <input type="checkbox" checked={activeOnly} onChange={e => setActiveOnly(e.target.checked)} className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          Active Only
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 sm:gap-2 text-[10px] sm:text-xs text-gray-400 whitespace-nowrap pt-1">
          <input type="checkbox" checked={todayOnly} onChange={e => setTodayOnly(e.target.checked)} className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          Today Only
        </label>
      </div>

      {visibleSections.map(section => {
        const rows = sections[section.key] ?? []
        const open = !collapsed[section.key]
        return (
          <section key={section.key} className="overflow-hidden rounded-2xl border border-gray-800 bg-white dark:bg-gray-900">
            <button
              type="button"
              onClick={() => toggleSection(section.key)}
              className="flex w-full items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-3 text-left dark:border-gray-800 dark:bg-gray-800/40"
            >
              <span className="flex items-center gap-2 font-semibold text-gray-900 dark:text-gray-100">
                <Bell size={16} className="text-violet-400" />
                {section.title}
                <span className="text-xs font-normal text-gray-500">({rows.length})</span>
              </span>
              {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
            </button>
            {open ? (
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {rows.length === 0 ? (
                  <div className="px-4 py-6 text-center text-sm text-gray-500">No alerts in this section.</div>
                ) : (
                  rows.map(row => {
                    const expanded = !!expandedRows[row.id]
                    const showExpand = longText(row.reason) || longText(row.recommended_action)
                    return (
                      <div key={row.id} className="space-y-3 px-3 py-3 sm:px-4 sm:py-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0 flex-1 space-y-2">
                            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                              {row.ticker ? <span className="font-mono text-xs sm:text-sm font-bold text-gray-100">{row.ticker}</span> : null}
                              <EngineBadge engine={row.engine_type} />
                              <span className="text-[10px] sm:text-[11px] uppercase tracking-wide text-gray-500">{row.alert_type}</span>
                              <SeverityBadge severity={row.severity} />
                              <SignalBadge signal={row.signal} />
                              <StatusBadge status={row.status} />
                            </div>
                            <div className="text-sm sm:text-base font-semibold leading-snug text-gray-900 dark:text-gray-100">{row.message}</div>
                            {row.reason ? (
                              <div className={`text-xs sm:text-sm leading-relaxed text-gray-600 dark:text-gray-400 ${expanded ? '' : 'line-clamp-2'}`}>
                                {row.reason}
                              </div>
                            ) : null}
                            {row.recommended_action ? (
                              <div className={`text-xs sm:text-sm leading-relaxed text-violet-300/95 ${expanded ? '' : 'line-clamp-2'}`}>
                                <span className="font-medium">Action:</span> {row.recommended_action}
                              </div>
                            ) : null}
                            <div className="text-[10px] sm:text-[11px] text-gray-500">Created: {fmtTime(row.created_at)}</div>
                          </div>
                          <div className="flex flex-row flex-wrap gap-1.5 sm:flex-col sm:gap-2 shrink-0">
                            <button
                              type="button"
                              className="oa-cc-btn-secondary text-[11px] sm:text-xs min-h-[32px] sm:min-h-[28px] px-2.5 sm:px-3"
                              disabled={row.status !== 'ACTIVE'}
                              onClick={() => void onAck(row.id)}
                            >
                              Acknowledge
                            </button>
                            <button type="button" className="oa-cc-btn-secondary text-[11px] sm:text-xs min-h-[32px] sm:min-h-[28px] px-2.5 sm:px-3" onClick={() => void onResolve(row.id)}>
                              Resolve
                            </button>
                            {row.ticker ? (
                              <button type="button" className="oa-cc-btn-secondary text-[11px] sm:text-xs min-h-[32px] sm:min-h-[28px] px-2.5 sm:px-3" onClick={() => requestAnalysis(row.ticker)}>
                                View Ticker
                              </button>
                            ) : null}
                            {row.related_trade_id ? (
                              <button
                                type="button"
                                className="oa-cc-btn-secondary text-[11px] sm:text-xs min-h-[32px] sm:min-h-[28px] px-2.5 sm:px-3"
                                onClick={() => navigate(`/positions?tab=open&trade=${encodeURIComponent(row.related_trade_id ?? '')}`)}
                              >
                                View Trade
                              </button>
                            ) : null}
                          </div>
                        </div>
                        {showExpand ? (
                          <button
                            type="button"
                            className="text-xs font-semibold text-violet-300"
                            onClick={() => toggleRow(row.id)}
                          >
                            {expanded ? 'Show less' : 'Show more'}
                          </button>
                        ) : null}
                      </div>
                    )
                  })
                )}
              </div>
            ) : null}
          </section>
        )
      })}
    </div>
  )
}
