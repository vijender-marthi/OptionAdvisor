import { useCallback, useEffect, useState } from 'react'
import { Radar, Calendar, TrendingUp, TrendingDown, AlertTriangle, RefreshCw } from 'lucide-react'
import { fetchEarningsRadar, type EarningsRadarResponse, type EarningsRadarCard } from '../api/client'
import { useApp } from '../contexts/AppContext'

const toneClasses = (tone: string) => {
  if (tone === 'positive') return 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-200 border-emerald-500/30'
  if (tone === 'warning') return 'bg-amber-500/10 text-amber-800 dark:text-amber-200 border-amber-500/30'
  return 'bg-slate-500/10 text-secondary border-border'
}

const pct = (n: number | null | undefined, signed = false) =>
  n == null ? '—' : `${signed && n > 0 ? '+' : ''}${n.toFixed(2)}%`

function ReactionBadge({ label, value }: { label: string; value: number | null | undefined }) {
  const up = (value ?? 0) >= 0
  const cls = value == null ? 'bg-slate-500/10 text-tertiary' : up ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-red-500/10 text-red-600 dark:text-red-300'
  return (
    <span className={`rounded-md px-2 py-0.5 font-mono text-[11px] ${cls}`}>{label} {pct(value, true)}</span>
  )
}

function RadarCard({ card }: { card: EarningsRadarCard }) {
  const em = card.expectedMove
  const play = card.play
  const bull = card.directionalLean.includes('bullish')
  const bear = card.directionalLean.includes('bearish')
  return (
    <div className="rounded-2xl border border-border bg-surface-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <span className="font-mono text-base font-semibold text-heading">{card.ticker}</span>
          <span className="text-sm text-secondary"> · {card.companyName}</span>
          {card.sector && <span className="ml-2 rounded-md bg-violet-500/10 px-2 py-0.5 text-[11px] text-violet-700 dark:text-violet-300">{card.industry || card.sector}</span>}
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold text-heading"><Calendar size={14} className="mr-1 inline align-[-2px]" />{card.nextEarnings}</div>
          <div className="text-[11px] text-tertiary">in {card.daysToEarnings} days{card.timing ? ` · ${card.timing}` : ''}</div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="rounded-lg bg-surface-muted p-2">
          <div className="text-[11px] text-tertiary">Implied move</div>
          <div className="font-mono text-sm font-semibold text-heading">{pct(card.impliedMovePct)}{em ? ` · ±$${em.straddle.toFixed(2)}` : ''}</div>
        </div>
        <div className="rounded-lg bg-surface-muted p-2">
          <div className="text-[11px] text-tertiary">Typical move (hist.)</div>
          <div className="font-mono text-sm font-semibold text-heading">{pct(card.typicalMovePct)}</div>
        </div>
        <div className="rounded-lg bg-surface-muted p-2">
          <div className="text-[11px] text-tertiary">Directional lean</div>
          <div className={`text-sm font-semibold ${bull ? 'text-emerald-700 dark:text-emerald-300' : bear ? 'text-red-600 dark:text-red-300' : 'text-secondary'}`}>
            {bull && <TrendingUp size={13} className="mr-1 inline align-[-2px]" />}{bear && <TrendingDown size={13} className="mr-1 inline align-[-2px]" />}{card.directionalLean}
          </div>
        </div>
      </div>

      {card.lastReaction && (
        <div className="mt-3">
          <div className="text-[11px] text-tertiary">Last earnings reaction ({card.lastReaction.date})</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <ReactionBadge label="Run-up 5d" value={card.lastReaction.runUpPct} />
            <ReactionBadge label="Gap" value={card.lastReaction.gapPct} />
            <ReactionBadge label="Drift 3d" value={card.lastReaction.driftPct} />
          </div>
        </div>
      )}

      <div className={`mt-3 rounded-lg border px-3 py-2 ${toneClasses(card.volRead.tone)}`}>
        <div className="text-sm font-semibold">{card.volRead.label}</div>
        <div className="mt-0.5 text-xs leading-relaxed">{card.volRead.text}</div>
      </div>

      {play && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-3 text-xs">
          <div>
            <div className="text-[11px] text-tertiary">{play.type}{play.atmStrike ? ` · ${play.atmStrike}` : ''}{play.expiry ? ` · ${play.expiry}` : ''}</div>
            {play.sizing && play.sizing.contracts > 0 ? (
              <div className="font-mono font-semibold text-heading">{play.sizing.contracts}× @ ${play.premiumPerContract.toFixed(0)} = ${play.sizing.maxRisk.toFixed(0)} max risk</div>
            ) : (
              <div className="font-mono text-amber-700 dark:text-amber-300">Above budget — needs ~${play.premiumPerContract.toFixed(0)}/contract</div>
            )}
          </div>
          {play.scenarioGainIfTypical != null && (
            <div className="ml-auto text-right">
              <div className="text-[11px] text-tertiary">If typical move repeats</div>
              <div className={`font-mono font-semibold ${play.scenarioGainIfTypical >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600 dark:text-red-300'}`}>
                {play.scenarioGainIfTypical >= 0 ? '≈ +' : '≈ '}${Math.abs(play.scenarioGainIfTypical).toFixed(0)}
              </div>
            </div>
          )}
        </div>
      )}

      {card.peers.length > 0 && (
        <div className="mt-2 text-[11px] text-tertiary">
          Related: <span className="font-mono text-secondary">{card.peers.join(' · ')}</span> — peer prints often pre-signal the move.
        </div>
      )}
    </div>
  )
}

export default function EarningsRadarPage() {
  const { user } = useApp()
  const [tickersInput, setTickersInput] = useState('')
  const [withinDays, setWithinDays] = useState(21)
  const [riskBudget, setRiskBudget] = useState(1000)
  const [data, setData] = useState<EarningsRadarResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const scan = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const tickers = tickersInput.split(/[\s,]+/).map(t => t.trim().toUpperCase()).filter(Boolean)
      const res = await fetchEarningsRadar({ tickers, withinDays, riskBudget })
      setData(res)
    } catch {
      setError('Unable to load the earnings radar. Try again.')
    } finally {
      setLoading(false)
    }
  }, [tickersInput, withinDays, riskBudget])

  useEffect(() => { if (user?.email) void scan() }, [user?.email]) // eslint-disable-line react-hooks/exhaustive-deps

  const avgMove = data && data.cards.length
    ? data.cards.reduce((s, c) => s + (c.impliedMovePct ?? 0), 0) / data.cards.filter(c => c.impliedMovePct != null).length
    : null

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 p-3 sm:p-5">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-heading"><Radar size={20} className="text-violet-500" />Earnings volatility radar</h1>
        <p className="text-sm text-secondary">Speculative, defined-risk earnings plays from your tickers. Higher variance than the balanced engine — sized to a small risk budget.</p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-surface-muted p-3">
        <div className="min-w-[200px] flex-1">
          <label className="mb-1 block text-[11px] text-tertiary">Tickers (blank = your watchlist)</label>
          <input value={tickersInput} onChange={e => setTickersInput(e.target.value)} placeholder="NVDA AMD AAPL"
            className="w-full rounded-lg border border-border bg-surface-card px-3 py-1.5 font-mono text-sm text-heading" />
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-tertiary">Within</label>
          <select value={withinDays} onChange={e => setWithinDays(Number(e.target.value))} className="rounded-lg border border-border bg-surface-card px-2 py-1.5 text-sm text-heading">
            <option value={21}>21 days</option><option value={14}>14 days</option><option value={7}>7 days</option><option value={45}>45 days</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-tertiary">Risk budget $</label>
          <input type="number" value={riskBudget} min={100} step={100} onChange={e => setRiskBudget(Number(e.target.value))}
            className="w-24 rounded-lg border border-border bg-surface-card px-2 py-1.5 font-mono text-sm text-heading" />
        </div>
        <button onClick={() => void scan()} disabled={loading}
          className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-60">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />Scan
        </button>
      </div>

      {data && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-surface-muted p-3"><div className="text-[11px] text-tertiary">In window</div><div className="text-xl font-semibold text-heading">{data.count} tickers</div></div>
          <div className="rounded-xl bg-surface-muted p-3"><div className="text-[11px] text-tertiary">Avg implied move</div><div className="font-mono text-xl font-semibold text-heading">{avgMove != null ? `±${avgMove.toFixed(1)}%` : '—'}</div></div>
          <div className="rounded-xl bg-surface-muted p-3"><div className="text-[11px] text-tertiary">Risk budget</div><div className="font-mono text-xl font-semibold text-heading">${riskBudget.toLocaleString()}</div></div>
        </div>
      )}

      {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">{error}</div>}
      {loading && !data && <div className="py-10 text-center text-sm text-tertiary">Scanning your tickers for upcoming earnings…</div>}

      {data && data.cards.map(card => <RadarCard key={card.ticker} card={card} />)}
      {data && data.count === 0 && !loading && (
        <div className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-tertiary">
          No tickers have earnings in the next {withinDays} days{data.noEarningsInWindow.length ? ` (checked ${data.noEarningsInWindow.length})` : ''}.
        </div>
      )}

      <div className="flex items-start gap-1.5 pt-2 text-[11px] text-tertiary">
        <AlertTriangle size={13} className="mt-0.5 shrink-0" />
        <span>Educational analysis, not financial advice. Earnings trades are high variance — you can lose the full premium. Position sizing caps defined risk to your budget; it does not predict the outcome.</span>
      </div>
    </div>
  )
}
