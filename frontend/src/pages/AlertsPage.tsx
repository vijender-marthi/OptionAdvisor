import { useMemo } from 'react'
import {
  Bell, CheckCircle2, X, Trash2, Mail, MailCheck, TrendingUp,
  Clock, RefreshCw, AlertTriangle,
} from 'lucide-react'
import { useApp } from '../contexts/AppContext'
import type { AlertEntry } from '../types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(val: number) {
  return val.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function relativeTime(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60_000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  return `${hrs}h ${mins % 60}m ago`
}

// Group alerts by their 15-min PST window label, most-recent window first
function groupByWindow(alerts: AlertEntry[]): { window: string; ts: number; items: AlertEntry[] }[] {
  const map = new Map<string, { ts: number; items: AlertEntry[] }>()
  for (const a of alerts) {
    if (!map.has(a.timeWindow)) {
      map.set(a.timeWindow, { ts: a.detectedAt, items: [] })
    }
    map.get(a.timeWindow)!.items.push(a)
  }
  return Array.from(map.entries())
    .map(([window, v]) => ({ window, ts: v.ts, items: v.items }))
    .sort((a, b) => b.ts - a.ts)  // newest window first
}

const biasBg = (b: string) =>
  b.toLowerCase().includes('bull') ? 'bg-green-900/30 border-green-800 text-green-300' :
  b.toLowerCase().includes('bear') ? 'bg-red-900/30 border-red-800 text-red-300' :
  'bg-amber-900/30 border-amber-800 text-amber-300'

// ─── Alert card ───────────────────────────────────────────────────────────────

function AlertCard({ alert, onDismiss, onNavigate }: {
  alert: AlertEntry
  onDismiss: (id: string) => void
  onNavigate: (ticker: string) => void
}) {
  const isCredit  = alert.netCredit > 0
  const evColor   = alert.ev > 0 ? 'text-green-400' : 'text-red-400'

  return (
    <div className={`alert-item-row relative bg-gray-900 border rounded-2xl overflow-hidden transition-colors ${
      alert.dismissed ? 'opacity-40 border-gray-800' : 'border-gray-800 hover:border-gray-700'
    }`}>
      {/* dismiss button */}
      <button
        onClick={() => onDismiss(alert.id)}
        className="absolute top-3 right-3 p-1.5 bg-gray-800 hover:bg-red-900/30 border border-gray-700
                   text-gray-500 hover:text-red-400 rounded-xl transition-colors"
        title="Dismiss"
      >
        <X size={12} />
      </button>

      <div className="flex items-start gap-3 px-4 py-3 pr-14 flex-wrap">
        {/* GO badge */}
        <div className="w-16 shrink-0">
          <span className="inline-flex items-center text-[10px] font-semibold bg-emerald-900/50 text-emerald-400 border border-emerald-700 px-2 py-0.5 rounded-full">
            GO
          </span>
          <div className="text-xs text-gray-500 mt-1">Score {alert.score}</div>
        </div>

        {/* Main info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => onNavigate(alert.ticker)}
              className="text-sm font-semibold text-white tracking-tight hover:text-violet-300 transition-colors"
            >
              {alert.ticker}
            </button>
            <span className="text-sm font-semibold text-violet-300">{alert.strategy}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${biasBg(alert.bias)}`}>
              {alert.bias.includes('Bullish') ? '↑' : alert.bias.includes('Bearish') ? '↓' : '↔'} {alert.bias}
            </span>
            <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full border border-gray-700">
              {alert.dte} DTE · {alert.weeksOut}w
            </span>
            <span className="text-xs text-gray-500">{alert.expiry}</span>
          </div>

          {/* Stats row */}
          <div className="flex items-center gap-4 mt-2 flex-wrap text-xs">
            <span>
              <span className="text-gray-500">Max Profit </span>
              <span className="text-green-400 font-mono font-semibold">${fmt(alert.maxProfit * 100)}</span>
              <span className="text-gray-600">/contract</span>
            </span>
            <span>
              <span className="text-gray-500">Max Loss </span>
              <span className="text-red-400 font-mono font-semibold">${fmt(alert.maxLoss * 100)}</span>
              <span className="text-gray-600">/contract</span>
            </span>
            {isCredit && (
              <span>
                <span className="text-gray-500">Credit </span>
                <span className="text-violet-400 font-mono font-semibold">${fmt(alert.netCredit * 100)}</span>
                <span className="text-gray-600">/contract</span>
              </span>
            )}
            <span>
              <span className="text-gray-500">PoP </span>
              <span className="text-white font-semibold">{(alert.pop * 100).toFixed(0)}%</span>
            </span>
            <span>
              <span className="text-gray-500">EV </span>
              <span className={`font-mono font-semibold ${evColor}`}>
                {alert.ev > 0 ? '+' : ''}${fmt(alert.ev * 100)}/contract
              </span>
            </span>
          </div>

          {/* Company + time + email status */}
          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            <span className="text-xs text-gray-600">{alert.companyName}</span>
            <span className="text-xs text-gray-600 flex items-center gap-1">
              <Clock size={10} /> {relativeTime(alert.detectedAt)}
            </span>
            {alert.emailSent ? (
              <span className="flex items-center gap-1 text-xs text-emerald-600">
                <MailCheck size={10} /> Email sent
              </span>
            ) : alert.emailMessage ? (
              <span className="flex items-center gap-1 text-xs text-red-500" title={alert.emailMessage}>
                <Mail size={10} /> Email failed
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs text-gray-700">
                <Mail size={10} /> Email pending
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function AlertsPage() {
  const {
    alerts, unreadAlertCount, dismissAlert, clearAlerts, requestAnalysis,
    isMarketHours, lastBgRefresh, refreshWatchlistForAlerts, refreshingTickers,
  } = useApp()

  const activeAlerts  = useMemo(() => alerts.filter(a => !a.dismissed), [alerts])
  const groupedActive = useMemo(() => groupByWindow(activeAlerts), [activeAlerts])
  const totalCount    = activeAlerts.length
  const scanning = refreshingTickers.size > 0

  const handleNavigate = (ticker: string) => {
    requestAnalysis(ticker)
  }

  return (
    <div className="alerts-page min-h-screen p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-white flex items-center gap-2">
              <Bell className="text-violet-400" size={22} />
              Trade Alerts
              {unreadAlertCount > 0 && (
                <span className="text-sm font-semibold bg-emerald-900/50 text-emerald-400 border border-emerald-700 px-2 py-0.5 rounded-full">
                  {unreadAlertCount} new
                </span>
              )}
            </h1>
            <div className="flex items-center gap-3 mt-0.5 flex-wrap">
              <span className="text-sm text-gray-500">{totalCount} active GO alert{totalCount !== 1 ? 's' : ''}</span>
              <span className="text-xs text-gray-600">· retained for 24 hours</span>
              {lastBgRefresh && (
                <span className="flex items-center gap-1 text-xs text-gray-600">
                  <Clock size={10} />
                  Auto-refresh: {new Date(lastBgRefresh).toLocaleTimeString()}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Market hours status */}
            <div className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm ${
              isMarketHours
                ? 'bg-emerald-900/20 border-emerald-800 text-emerald-400'
                : 'bg-gray-800/60 border-gray-700 text-gray-500'
            }`}>
              <RefreshCw size={13} className={isMarketHours ? 'animate-spin' : ''} />
              {isMarketHours ? 'Live scan active' : 'Scan paused'}
            </div>

            {alerts.length > 0 && (
              <button
                onClick={clearAlerts}
                className="flex items-center gap-1.5 px-3 py-2 bg-gray-800 border border-gray-700
                           text-gray-400 hover:text-red-400 hover:border-red-700 text-sm rounded-xl
                           transition-colors"
              >
                <Trash2 size={13} /> Clear all
              </button>
            )}
            <button
              onClick={() => refreshWatchlistForAlerts()}
              disabled={scanning}
              className="flex items-center gap-1.5 px-3 py-2 bg-violet-600/20 border border-violet-700
                         text-violet-300 hover:bg-violet-600/30 text-sm font-semibold rounded-xl
                         transition-colors disabled:opacity-50"
            >
              <RefreshCw size={13} className={scanning ? 'animate-spin' : ''} />
              Scan Watchlist
            </button>
          </div>
        </div>

        {/* How it works info bar */}
        <div className="bg-blue-950/30 border border-blue-900/50 rounded-xl px-4 py-3 flex items-start gap-3">
          <AlertTriangle size={14} className="text-blue-400 shrink-0 mt-0.5" />
          <p className="text-xs text-blue-300/80 leading-relaxed">
            Alerts fire automatically after each 15-minute background refresh (market hours only: 6 AM–4 PM PST).
            Each trade appears once — the same ticker, strategy, and expiry combo is not resent on later 15-minute refreshes.
            Alerts stay on this page for 24 hours, then clear automatically.
            An email is sent to your account address when new GO trades are found (requires SMTP setup in <code className="text-blue-400">.env</code>).
          </p>
        </div>

        {/* Empty state */}
        {totalCount === 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-10 text-center">
            <Bell size={32} className="text-gray-700 mx-auto mb-3" />
            <div className="text-gray-400 font-semibold mb-1">No GO alerts yet</div>
            <p className="text-gray-600 text-sm max-w-xs mx-auto">
              {isMarketHours
                ? 'The background scan is active. GO trades will appear here automatically after the next 15-minute refresh.'
                : 'Market is outside scan hours (6 AM–4 PM PST). Alerts will resume next trading session.'
              }
            </p>
            <div className="mt-4 text-xs text-gray-700">
              Make sure tickers are on your Watchlist and have been analyzed at least once.
            </div>
          </div>
        )}

        {/* Alert groups */}
        {groupedActive.map(group => (
          <div key={group.window} className="space-y-2">
            {/* Window header */}
            <div className="flex items-center gap-2 px-1">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold text-violet-400 bg-gray-800 border border-gray-700 rounded px-2 py-0.5">
                <Clock size={12} />
                {group.window}
              </div>
              <span className="text-[10px] font-medium text-gray-600 bg-gray-800 border border-gray-700 rounded-full px-2 py-0.5">
                {group.items.length} GO trade{group.items.length !== 1 ? 's' : ''}
              </span>
              <div className="h-px flex-1 bg-gray-800/70" />
              <span className="text-[10px] text-gray-600">{relativeTime(group.ts)}</span>
            </div>

            {/* Cards */}
            {group.items.map(alert => (
              <AlertCard
                key={alert.id}
                alert={alert}
                onDismiss={dismissAlert}
                onNavigate={handleNavigate}
              />
            ))}
          </div>
        ))}

        {/* Summary footer */}
        {totalCount > 0 && (
          <div className="bg-gray-900/50 border border-gray-800 rounded-xl px-4 py-3">
            <div className="flex items-center justify-between flex-wrap gap-2 text-xs text-gray-500">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <CheckCircle2 size={11} className="text-emerald-500" />
                  {totalCount} active GO alert{totalCount !== 1 ? 's' : ''}
                </span>
                <span className="flex items-center gap-1">
                  <TrendingUp size={11} className="text-violet-400" />
                  {alerts.filter(a => a.emailSent).length} emails sent
                </span>
              </div>
              <span className="text-gray-700">Click a ticker to open it in Option Advisory</span>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
