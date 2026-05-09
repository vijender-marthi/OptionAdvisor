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
  const { requestAnalysis } = useApp()
  const [payload, setPayload] = useState<AlertCenterPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [engineType, setEngineType] = useState('')
  const [severity, setSeverity] = useState('')
  const [status, setStatus] = useState('')
  const [ticker, setTicker] = useState('')
  const [activeOnly, setActiveOnly] = useState(true)
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
      })
      setPayload(env.data)
    } finally {
      setLoading(false)
    }
  }, [activeOnly, engineType, severity, status, ticker])

  useEffect(() => {
    void load()
  }, [load])

  const alerts = payload?.alerts ?? []
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
    void load()
  }

  const onResolve = async (id: string) => {
    await resolveAlert(id)
    void load()
  }

  return (
    <div className="oa-cc-page mx-auto max-w-6xl space-y-6 px-4 py-6">
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

      <div className="grid gap-3 md:grid-cols-5">
        <SummaryCard label="Total Active Alerts" value={summary.active ?? 0} tone="neutral" />
        <SummaryCard label="Critical Alerts" value={summary.critical ?? 0} tone="critical" />
        <SummaryCard label="Warning Alerts" value={summary.warning ?? 0} tone="warning" />
        <SummaryCard label="Profit Protection Alerts" value={summary.profit_protection ?? 0} tone="warning" />
        <SummaryCard label="Trade Entry Alerts" value={summary.trade_entry ?? 0} tone="positive" />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-gray-500">
          Engine Type
          <select
            value={engineType}
            onChange={e => setEngineType(e.target.value)}
            className="mt-1 block w-36 rounded-lg border border-gray-700 bg-gray-900 px-2 py-1.5 text-sm"
          >
            <option value="">All</option>
            <option value="DAY">Day</option>
            <option value="SWING">Swing</option>
            <option value="REGULAR">Regular</option>
            <option value="PORTFOLIO">Portfolio</option>
            <option value="MARKET">Market</option>
          </select>
        </label>
        <label className="text-xs text-gray-500">
          Severity
          <select
            value={severity}
            onChange={e => setSeverity(e.target.value)}
            className="mt-1 block w-32 rounded-lg border border-gray-700 bg-gray-900 px-2 py-1.5 text-sm"
          >
            <option value="">All</option>
            <option value="INFO">Info</option>
            <option value="WARNING">Warning</option>
            <option value="CRITICAL">Critical</option>
          </select>
        </label>
        <label className="text-xs text-gray-500">
          Status
          <select
            value={status}
            onChange={e => setStatus(e.target.value)}
            className="mt-1 block w-40 rounded-lg border border-gray-700 bg-gray-900 px-2 py-1.5 text-sm"
          >
            <option value="">All</option>
            <option value="ACTIVE">Active</option>
            <option value="ACKNOWLEDGED">Acknowledged</option>
            <option value="RESOLVED">Resolved</option>
          </select>
        </label>
        <label className="text-xs text-gray-500">
          Ticker
          <input
            value={ticker}
            onChange={e => setTicker(e.target.value.toUpperCase())}
            placeholder="e.g. NVDA"
            className="mt-1 block w-28 rounded-lg border border-gray-700 bg-gray-900 px-2 py-1.5 text-sm uppercase"
          />
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-400">
          <input type="checkbox" checked={activeOnly} onChange={e => setActiveOnly(e.target.checked)} />
          Active Only
        </label>
      </div>

      {SECTION_ORDER.map(section => {
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
                      <div key={row.id} className="space-y-3 px-4 py-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              {row.ticker ? <span className="font-mono text-sm font-bold text-gray-100">{row.ticker}</span> : null}
                              <EngineBadge engine={row.engine_type} />
                              <span className="text-[11px] uppercase tracking-wide text-gray-500">{row.alert_type}</span>
                              <SeverityBadge severity={row.severity} />
                              <SignalBadge signal={row.signal} />
                              <StatusBadge status={row.status} />
                            </div>
                            <div className="font-semibold text-gray-900 dark:text-gray-100">{row.message}</div>
                            <div className={`text-sm text-gray-600 dark:text-gray-400 ${expanded ? '' : 'line-clamp-2'}`}>
                              {row.reason}
                            </div>
                            <div className={`text-sm text-violet-300/95 ${expanded ? '' : 'line-clamp-2'}`}>
                              Recommended action: {row.recommended_action}
                            </div>
                            <div className="text-[11px] text-gray-500">Created: {fmtTime(row.created_at)}</div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="oa-cc-btn-secondary text-xs"
                              disabled={row.status !== 'ACTIVE'}
                              onClick={() => void onAck(row.id)}
                            >
                              Acknowledge
                            </button>
                            <button type="button" className="oa-cc-btn-secondary text-xs" onClick={() => void onResolve(row.id)}>
                              Resolve
                            </button>
                            {row.ticker ? (
                              <button type="button" className="oa-cc-btn-secondary text-xs" onClick={() => requestAnalysis(row.ticker)}>
                                View Ticker
                              </button>
                            ) : null}
                            {row.related_trade_id ? (
                              <button
                                type="button"
                                className="oa-cc-btn-secondary text-xs"
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
