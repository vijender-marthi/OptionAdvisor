import { useCallback, useEffect, useState } from 'react'
import { BellRing, ExternalLink, LayoutList, Loader2, RefreshCw, Zap } from 'lucide-react'
import { useApp } from '../contexts/AppContext'
import { getDayTradeAlerts } from '../api/client'
import type { DayTradeAlertEvent } from '../types'

function relativeTime(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  return `${hrs}h ${mins % 60}m ago`
}

function verdictPillClass(v: string): string {
  if (v === 'STRONG GO') return 'bg-emerald-500/20 text-emerald-200 border-emerald-400/50'
  if (v === 'GO') return 'bg-emerald-600/25 text-emerald-300 border-emerald-600/40'
  return 'bg-gray-700/60 text-gray-300 border-gray-600/50'
}

export default function DayTradeAlertsPage() {
  const { user, navigate } = useApp()
  const [items, setItems] = useState<DayTradeAlertEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user?.email) return
    setError(null)
    setLoading(true)
    try {
      const data = await getDayTradeAlerts(user.email)
      setItems(data)
    } catch (e) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(typeof msg === 'string' ? msg : 'Could not load alerts.')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [user?.email])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!user?.email) return
    const id = setInterval(() => void load(), 60_000)
    return () => clearInterval(id)
  }, [user?.email, load])

  const openScanner = (ticker: string) => {
    const t = ticker.trim().toUpperCase()
    window.location.hash = `day-trade?ticker=${encodeURIComponent(t)}`
  }

  return (
    <div className="day-trade-page mx-auto w-full max-w-2xl space-y-6 px-4 py-6 sm:px-6 pb-24">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-600/20 text-teal-300">
            <BellRing size={20} />
          </div>
          <div>
            <h1 className="tcc-hero-title text-2xl font-bold tracking-tight text-heading">Day Trade Alerts</h1>
            <p className="text-xs text-gray-500">
              WATCH → GO / STRONG GO on your saved watchlist (server scan ~ every 15 min when the alert window runs)
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border border-gray-600 bg-gray-800/80 hover:bg-gray-800 text-gray-200 font-semibold px-4 py-2 text-sm disabled:opacity-50"
        >
          {loading ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => navigate('day-trade-watchlist')}
          className="inline-flex items-center gap-2 text-xs font-semibold text-violet-300 hover:text-violet-200"
        >
          <LayoutList size={14} /> Edit watchlist
        </button>
        <button
          type="button"
          onClick={() => navigate('day-trade')}
          className="inline-flex items-center gap-2 text-xs font-semibold text-violet-300 hover:text-violet-200"
        >
          <Zap size={14} /> Day trade scanner
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-800/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      {loading && items.length === 0 && !error && (
        <div className="flex justify-center py-16 text-gray-500">
          <Loader2 className="animate-spin" size={28} />
        </div>
      )}

      {!loading && items.length === 0 && !error && (
        <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-900/30 px-4 py-10 text-center text-sm text-gray-500">
          No escalations yet. Add symbols under Day Trade Watchlist; when volume confirms after a WATCH reading, an alert
          lands here (and emails you if mail is configured).
        </div>
      )}

      <ul className="space-y-3">
        {items.map(a => (
          <li
            key={a.id}
            className="rounded-2xl border border-gray-800 bg-gray-900/60 p-4 space-y-2"
          >
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => openScanner(a.ticker)}
                  className="text-lg font-bold font-mono text-white hover:text-teal-300 transition-colors"
                >
                  {a.ticker}
                </button>
                <span className={`text-[10px] font-bold uppercase tracking-wide border rounded-full px-2 py-0.5 ${verdictPillClass(a.previousVerdict)}`}>
                  {a.previousVerdict}
                </span>
                <span className="text-gray-500 text-xs">→</span>
                <span className={`text-[10px] font-bold uppercase tracking-wide border rounded-full px-2 py-0.5 ${verdictPillClass(a.verdict)}`}>
                  {a.verdict}
                </span>
                {a.bias && (
                  <span className="text-xs text-gray-400 capitalize">({a.bias})</span>
                )}
              </div>
              <div className="text-xs text-gray-500 shrink-0">
                {relativeTime(a.detectedAt)}
                {a.sessionDate ? ` · ${a.sessionDate}` : ''}
              </div>
            </div>
            <div className="text-xs text-gray-400">
              Bull {a.bullScore?.toFixed?.(2) ?? a.bullScore} · Bear {a.bearScore?.toFixed?.(2) ?? a.bearScore}
            </div>
            {a.reasons?.length ? (
              <ul className="text-xs text-gray-500 list-disc pl-4 space-y-1">
                {a.reasons.slice(0, 5).map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            ) : null}
            <div className="flex items-center gap-3 flex-wrap text-[11px]">
              <button
                type="button"
                onClick={() => openScanner(a.ticker)}
                className="inline-flex items-center gap-1 text-teal-400 hover:text-teal-300 font-semibold"
              >
                <ExternalLink size={12} /> Open scanner
              </button>
              <span className={a.emailSent ? 'text-emerald-500/90' : 'text-amber-500/90'}>
                Email: {a.emailSent ? 'sent' : 'not sent'}{' '}
                {a.emailMessage ? `— ${a.emailMessage}` : ''}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
