import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Activity, Loader2, RefreshCw, XCircle } from 'lucide-react'
import {
  exitActiveTrade,
  listActiveTrades,
  type ActiveTradeRow,
} from '../api/client'
import { useApp } from '../contexts/AppContext'
import OpenPositionsFeedTable, { dayTradeToneBadgeClass, type OpenPositionsFeedRow } from './OpenPositionsFeedTable'

const POLL_MS = 900_000

function formatNextRefreshSecs(secs: number): string {
  if (secs <= 0) return 'soon'
  const m = Math.floor(secs / 60)
  const s = secs % 60
  if (m <= 0) return `${s}s`
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

function asDecision(row: ActiveTradeRow) {
  const d = row.decision as {
    state?: string
    action?: string
    message?: string
    badge_tone?: string
    risk_warning?: string
    confirmation_needed?: string[]
  }
  return d
}

export default function ActiveTradesPanel({
  variant = 'page',
}: {
  variant?: 'page' | 'embedded'
}) {
  const { canAccessPage, user } = useApp()
  const navigate = useNavigate()
  const allowed = !!user && canAccessPage('active-trades')
  const [rows, setRows] = useState<ActiveTradeRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exitingId, setExitingId] = useState<string | null>(null)
  const [lastFetchAt, setLastFetchAt] = useState<number | null>(null)
  const [wallTick, setWallTick] = useState(0)

  const load = useCallback(async () => {
    if (!allowed) return
    setLoading(true)
    setError(null)
    try {
      const { trades } = await listActiveTrades()
      setRows(trades)
      setLastFetchAt(Date.now())
    } catch (e) {
      setError((e as Error)?.message ?? 'Failed to load Day Trade Active')
    } finally {
      setLoading(false)
    }
  }, [allowed])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!allowed) return
    const id = window.setInterval(() => void load(), POLL_MS)
    return () => window.clearInterval(id)
  }, [allowed, load])

  useEffect(() => {
    if (!allowed || lastFetchAt === null) return
    const id = window.setInterval(() => setWallTick(t => t + 1), 1000)
    return () => window.clearInterval(id)
  }, [allowed, lastFetchAt])

  const nextRefreshLabel = useMemo(() => {
    if (lastFetchAt === null) return null
    void wallTick
    const secsLeft = Math.max(0, Math.ceil((POLL_MS - (Date.now() - lastFetchAt)) / 1000))
    return formatNextRefreshSecs(secsLeft)
  }, [lastFetchAt, wallTick])

  const onExit = async (id: string) => {
    setExitingId(id)
    try {
      await exitActiveTrade(id)
      await load()
    } catch (e) {
      setError((e as Error)?.message ?? 'Exit failed')
    } finally {
      setExitingId(null)
    }
  }

  const feedRows = useMemo((): OpenPositionsFeedRow[] => {
    return rows.map(row => {
      const d = asDecision(row)
      const contracts = row.contracts != null && row.contracts > 0 ? String(Math.round(row.contracts)) : '—'
      const strikeBit = row.strike != null && row.strike > 0 ? ` $${Number(row.strike).toFixed(0)}` : ''
      const strategy = `${row.side}${strikeBit}`
      const tone = typeof d.badge_tone === 'string' ? d.badge_tone : 'gray'
      const badge = (
        <span className={`rounded-lg border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${dayTradeToneBadgeClass(tone)}`}>
          {d.state ?? '—'}
        </span>
      )
      const secParts = [d.message, row.intraday_error ? `Tape: ${row.intraday_error}` : '', d.risk_warning].filter(Boolean) as string[]
      return {
        key: row.id,
        categoryKind: 'day',
        ticker: row.ticker,
        strategy,
        contracts,
        expiry: row.expiry?.trim() || '—',
        entryRef: `$${row.entry_price.toFixed(2)}`,
        guidancePrimary: (
          <div className="flex flex-wrap items-center gap-2">
            {badge}
            {d.action ? <span className="text-xs font-semibold text-violet-300">{d.action}</span> : null}
          </div>
        ),
        guidanceSecondary: secParts.length ? secParts.join(' · ') : null,
        actions: (
          <button
            type="button"
            onClick={() => void onExit(row.id)}
            disabled={exitingId === row.id}
            title="Exit day trade"
            className="inline-flex items-center gap-1 rounded-lg border border-gray-600 px-2 py-1 text-[11px] font-semibold text-gray-400 hover:text-rose-300 hover:border-rose-600 disabled:opacity-50"
          >
            {exitingId === row.id ? <Loader2 size={12} className="animate-spin shrink-0" /> : <XCircle size={12} className="shrink-0" />}
            Exit
          </button>
        ),
      }
    })
  }, [rows, exitingId])

  if (!allowed) {
    return null
  }

  const shell = variant === 'embedded'
    ? 'rounded-2xl border border-gray-800 bg-gray-900/50 p-4 sm:p-5'
    : ''

  return (
    <section className={['active-trades-page', shell].filter(Boolean).join(' ')}>
      <div className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${variant === 'embedded' ? '' : 'mb-4'}`}>
        <div className="flex items-center gap-2">
          <Activity className="text-orange-400 shrink-0" size={22} />
          <div>
            {variant === 'page' ? (
              <h1 className="text-xl sm:text-2xl font-bold text-white">Day Trade Active</h1>
            ) : (
              <h2 className="text-lg font-bold text-white">Day Trade Active</h2>
            )}
            <p className="text-xs text-gray-500">
              Refreshes about every 15 min · intraday guidance only (copy-only, no auto execution).
            </p>
            {nextRefreshLabel != null && (
              <p className="text-[11px] text-gray-600 mt-0.5">
                Next refresh in {nextRefreshLabel}
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 self-start rounded-xl border border-gray-700 bg-gray-800/80 px-3 py-2 text-sm font-semibold text-gray-200 hover:bg-gray-700 disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-xl border border-rose-800/60 bg-rose-950/30 px-3 py-2 text-sm text-rose-200">
          {error}
        </div>
      )}

      {loading && rows.length === 0 ? (
        <div className="flex justify-center py-12 text-gray-500">
          <Loader2 className="animate-spin" size={28} />
        </div>
      ) : (
        <OpenPositionsFeedTable
          rows={feedRows}
          onTickerClick={(ticker) => navigate(`/day-trade?ticker=${encodeURIComponent(ticker)}`)}
          emptyMessage={
            <span className="text-sm">
              No open trades for today’s session yet. Run the Day Trade Engine and tap{' '}
              <span className="text-gray-400">Day Trade Active</span> after a scan.
            </span>
          }
        />
      )}
    </section>
  )
}
