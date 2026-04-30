import { useState } from 'react'
import { Briefcase, TrendingUp, TrendingDown, CheckCircle, Clock, Trash2, X, DollarSign, Layers } from 'lucide-react'
import type { PortfolioPosition, OptionLeg } from '../types'
import { useApp } from '../contexts/AppContext'

// ── At-expiry P&L estimator (uses entry premiums) ──────────────────────────
function estimateAtExpiryPnl(legs: OptionLeg[], currentPrice: number): number {
  let total = 0
  for (const leg of legs) {
    const intrinsic =
      leg.option_type === 'CALL'
        ? Math.max(0, currentPrice - leg.strike)
        : Math.max(0, leg.strike - currentPrice)
    const premium = leg.mid_price
    total += leg.action === 'BUY' ? intrinsic - premium : premium - intrinsic
  }
  return total // per share
}

// ── Close-position modal ─────────────────────────────────────────────────────
function CloseModal({ pos, onClose, onConfirm }: {
  pos: PortfolioPosition
  onClose: () => void
  onConfirm: (pnlPct: number) => void
}) {
  const [pnl, setPnl] = useState('')
  const pnlNum = parseFloat(pnl)
  const contracts = pos.contracts ?? 1
  const isValid = pnl !== '' && !isNaN(pnlNum)
  const dollarPnl = isValid ? (pnlNum / 100) * pos.max_profit * 100 * contracts : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-base font-bold text-white">Close Position</div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X size={16} /></button>
        </div>

        <div className="bg-gray-800 rounded-xl p-3 text-sm">
          <div className="text-gray-400 text-xs mb-1">{pos.ticker} · {pos.strategy} · {contracts} contract{contracts > 1 ? 's' : ''}</div>
          <div className="text-gray-200 font-mono">
            Max profit: ${(pos.max_profit * 100 * contracts).toFixed(0)} total
          </div>
          <div className="text-gray-500 text-xs">${(pos.max_profit * 100).toFixed(0)}/contract</div>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-400 block mb-1.5">
            P&L as % of max profit
          </label>
          <input
            type="number"
            value={pnl}
            onChange={e => setPnl(e.target.value)}
            placeholder="e.g. 50 (for 50% of max profit)"
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm
                       focus:outline-none focus:border-violet-500 placeholder-gray-600"
          />
          {isValid && (
            <div className={`mt-1.5 text-xs font-mono ${dollarPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              ≈ {dollarPnl >= 0 ? '+' : ''}${dollarPnl.toFixed(0)} total ({contracts} contracts)
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 bg-gray-800 text-gray-300 text-sm rounded-xl hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => isValid && onConfirm(pnlNum)}
            disabled={!isValid}
            className="flex-1 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:bg-gray-700 disabled:cursor-not-allowed
                       text-white text-sm font-semibold rounded-xl transition-colors"
          >
            Confirm Close
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Position card ─────────────────────────────────────────────────────────────
function PositionCard({ pos, onClose, onRemove }: {
  pos: PortfolioPosition
  onClose: () => void
  onRemove: () => void
}) {
  const { tickerCache } = useApp()
  const contracts = pos.contracts ?? 1
  const isClosed  = pos.status === 'closed'

  // Realised P&L (user-entered)
  const realisedDollar = pos.pnlPct != null
    ? (pos.pnlPct / 100) * pos.max_profit * 100 * contracts
    : null

  // Estimated unrealised P&L (at-expiry theoretical, using current cached price)
  const cachedEntry       = tickerCache[pos.ticker]
  const currentPrice      = cachedEntry?.data?.signals?.current_price ?? null
  const unrealisedPerShare = currentPrice != null
    ? estimateAtExpiryPnl(pos.legs, currentPrice)
    : null
  const unrealisedDollar  = unrealisedPerShare != null
    ? unrealisedPerShare * 100 * contracts
    : null

  const biasColor =
    pos.bias.includes('Bullish') ? 'border-l-emerald-500' :
    pos.bias.includes('Bearish') ? 'border-l-red-500' : 'border-l-amber-500'

  const dte = Math.ceil((new Date(pos.expiry).getTime() - Date.now()) / 86400000)

  return (
    <div className={`bg-gray-900 border border-gray-800 border-l-4 ${biasColor} rounded-2xl p-4 space-y-3
      ${isClosed ? 'opacity-60' : ''}`}>

      {/* Header row */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-lg font-bold text-white font-mono">{pos.ticker}</span>
            <span className="text-xs bg-violet-900/50 text-violet-300 border border-violet-700 px-2 py-0.5 rounded-full font-semibold">
              {pos.strategy}
            </span>
            {/* Contracts badge */}
            <span className="flex items-center gap-1 text-xs bg-gray-800 border border-gray-700 text-gray-400 px-2 py-0.5 rounded-full">
              <Layers size={10} /> {contracts} contract{contracts > 1 ? 's' : ''}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${
              isClosed
                ? 'bg-gray-800 text-gray-500 border-gray-700'
                : dte > 7
                  ? 'bg-emerald-900/30 text-emerald-400 border-emerald-800'
                  : 'bg-amber-900/30 text-amber-400 border-amber-800'
            }`}>
              {isClosed ? '✓ Closed' : dte > 0 ? `${dte}d left` : 'Expired'}
            </span>
          </div>
          <div className="text-xs text-gray-500 mt-0.5">{pos.companyName} · Exp {pos.expiry}</div>
        </div>

        <div className="flex items-center gap-1.5">
          {!isClosed && (
            <button
              onClick={onClose}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-900/20 hover:bg-emerald-900/40
                         border border-emerald-800 text-emerald-400 text-xs font-semibold rounded-xl transition-colors"
            >
              <CheckCircle size={12} /> Close
            </button>
          )}
          <button
            onClick={onRemove}
            className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Live unrealised P&L (open positions only) */}
      {!isClosed && unrealisedDollar !== null && (
        <div className={`flex items-center gap-3 rounded-xl px-3 py-2 ${
          unrealisedDollar >= 0
            ? 'bg-emerald-900/20 border border-emerald-800'
            : 'bg-red-900/20 border border-red-800'
        }`}>
          {unrealisedDollar >= 0
            ? <TrendingUp size={14} className="text-emerald-400 shrink-0" />
            : <TrendingDown size={14} className="text-red-400 shrink-0" />}
          <div>
            <span className={`text-sm font-bold font-mono ${unrealisedDollar >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {unrealisedDollar >= 0 ? '+' : ''}${unrealisedDollar.toFixed(0)} est. at expiry
            </span>
            <span className="text-xs text-gray-500 ml-2">
              if held at current ${currentPrice!.toFixed(2)}
            </span>
          </div>
          <span className="ml-auto text-xs text-gray-600">
            Entry: ${pos.entryPrice.toFixed(2)}
          </span>
        </div>
      )}

      {/* Realised P&L strip — closed positions */}
      {isClosed && realisedDollar !== null && (
        <div className={`flex items-center gap-2 rounded-xl px-3 py-2 ${
          realisedDollar >= 0 ? 'bg-emerald-900/20 border border-emerald-800' : 'bg-red-900/20 border border-red-800'
        }`}>
          {realisedDollar >= 0 ? <TrendingUp size={14} className="text-emerald-400" /> : <TrendingDown size={14} className="text-red-400" />}
          <span className={`text-sm font-bold font-mono ${realisedDollar >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {realisedDollar >= 0 ? '+' : ''}${realisedDollar.toFixed(0)} ({pos.pnlPct?.toFixed(0)}% of max profit)
          </span>
          {pos.exitDate && (
            <span className="text-xs text-gray-500 ml-auto">
              Closed {new Date(pos.exitDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          )}
        </div>
      )}

      {/* Key metrics — scaled by contracts */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: 'Net Credit',  value: `$${(pos.net_credit * 100 * contracts).toFixed(0)}`, sub: `${contracts}×contract`, color: 'text-violet-400' },
          { label: 'Max Profit',  value: `$${(pos.max_profit * 100 * contracts).toFixed(0)}`,  sub: `$${(pos.max_profit * 100).toFixed(0)}/ea`,   color: 'text-emerald-400' },
          { label: 'Max Loss',    value: `$${(pos.max_loss   * 100 * contracts).toFixed(0)}`,  sub: `$${(pos.max_loss * 100).toFixed(0)}/ea`,     color: 'text-red-400' },
          { label: 'Entry Price', value: `$${pos.entryPrice.toFixed(2)}`,                       sub: pos.bias,                                     color: 'text-gray-300' },
        ].map(m => (
          <div key={m.label} className="bg-gray-800/60 rounded-xl px-3 py-2">
            <div className="text-xs text-gray-500 mb-0.5">{m.label}</div>
            <div className={`text-sm font-bold font-mono ${m.color}`}>{m.value}</div>
            <div className="text-xs text-gray-600 truncate">{m.sub}</div>
          </div>
        ))}
      </div>

      {/* Breakeven levels */}
      {(pos.breakeven_lower != null || pos.breakeven_upper != null) && (
        <div className="bg-gray-800/40 rounded-xl px-3 py-2 flex items-center gap-3 text-xs">
          <span className="text-gray-500">Breakeven:</span>
          <span className="text-white font-mono">
            {pos.breakeven_upper && pos.breakeven_upper < 990
              ? `$${pos.breakeven_lower.toFixed(2)} – $${pos.breakeven_upper.toFixed(2)}`
              : `$${pos.breakeven_lower?.toFixed(2)}`}
          </span>
          {currentPrice != null && (
            <span className={`ml-auto font-semibold ${
              unrealisedDollar != null && unrealisedDollar >= 0 ? 'text-emerald-400' : 'text-red-400'
            }`}>
              Current: ${currentPrice.toFixed(2)}
            </span>
          )}
        </div>
      )}

      {/* Legs */}
      <div className="bg-gray-800/40 rounded-xl px-3 py-2">
        <div className="text-xs text-gray-500 mb-1.5">Legs</div>
        <div className="flex flex-wrap gap-2">
          {pos.legs.map((leg, i) => (
            <span key={i} className={`text-xs font-mono px-2 py-0.5 rounded-lg border ${
              leg.action === 'SELL'
                ? 'bg-red-900/15 border-red-900/40 text-red-300'
                : 'bg-emerald-900/15 border-emerald-900/40 text-emerald-300'
            }`}>
              {leg.action} ${leg.strike} {leg.option_type[0]} @ ${leg.mid_price.toFixed(2)}
            </span>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-gray-600">
        <span className="flex items-center gap-1">
          <Clock size={11} />
          Added {new Date(pos.addedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
        <span>Score: {pos.scores_total}/100 · PoP {(pos.prob_of_profit * 100).toFixed(0)}%</span>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function PortfolioPage() {
  const { portfolio, closePosition, removeFromPortfolio, navigate } = useApp()
  const [closing, setClosing] = useState<PortfolioPosition | null>(null)
  const [filter, setFilter]   = useState<'all' | 'open' | 'closed'>('open')

  const open   = portfolio.filter(p => p.status === 'open')
  const closed = portfolio.filter(p => p.status === 'closed')
  const shown  = filter === 'all' ? portfolio : filter === 'open' ? open : closed

  // Summary stats
  const closedWithPnl   = closed.filter(p => p.pnlPct != null)
  const totalRealisedPnl = closedWithPnl.reduce((s, p) => {
    const c = p.contracts ?? 1
    return s + ((p.pnlPct! / 100) * p.max_profit * 100 * c)
  }, 0)
  const totalOpenContracts = open.reduce((s, p) => s + (p.contracts ?? 1), 0)
  const winRate = closedWithPnl.length
    ? Math.round((closedWithPnl.filter(p => (p.pnlPct ?? 0) > 0).length / closedWithPnl.length) * 100)
    : null

  return (
    <div className="min-h-screen p-4 md:p-6">
      {closing && (
        <CloseModal
          pos={closing}
          onClose={() => setClosing(null)}
          onConfirm={pnl => { closePosition(closing.id, pnl); setClosing(null) }}
        />
      )}

      <div className="max-w-4xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Briefcase className="text-violet-400" size={22} />
              Portfolio
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {open.length} open position{open.length !== 1 ? 's' : ''} · {totalOpenContracts} total contracts
            </p>
          </div>
          <button
            onClick={() => navigate('ticker')}
            className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            <TrendingUp size={14} /> New Analysis
          </button>
        </div>

        {/* Summary stats */}
        {portfolio.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Open Positions',    value: String(open.length),       color: 'text-violet-400' },
              { label: 'Open Contracts',    value: String(totalOpenContracts), color: 'text-blue-400'   },
              { label: 'Win Rate',          value: winRate != null ? `${winRate}%` : '—',
                color: winRate != null && winRate >= 50 ? 'text-emerald-400' : 'text-red-400' },
              {
                label: 'Realised P&L',
                value: closedWithPnl.length ? `${totalRealisedPnl >= 0 ? '+' : ''}$${totalRealisedPnl.toFixed(0)}` : '—',
                color: totalRealisedPnl >= 0 ? 'text-emerald-400' : 'text-red-400',
              },
            ].map(s => (
              <div key={s.label} className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3">
                <div className="text-xs text-gray-500 mb-0.5">{s.label}</div>
                <div className={`text-xl font-bold font-mono ${s.color}`}>{s.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Filter tabs */}
        {portfolio.length > 0 && (
          <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1 w-fit">
            {(['open', 'closed', 'all'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-1.5 rounded-lg text-sm font-semibold capitalize transition-colors ${
                  filter === f ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {f} {f === 'open' ? `(${open.length})` : f === 'closed' ? `(${closed.length})` : `(${portfolio.length})`}
              </button>
            ))}
          </div>
        )}

        {/* Empty state */}
        {portfolio.length === 0 && (
          <div className="text-center py-20 space-y-3">
            <div className="text-5xl">💼</div>
            <div className="text-lg font-semibold text-gray-300">No positions yet</div>
            <div className="text-gray-500 text-sm max-w-sm mx-auto">
              Run an analysis, expand any recommendation card, then click{' '}
              <strong className="text-violet-400">Portfolio</strong> — choose how many contracts
              and confirm to start tracking.
            </div>
            <button
              onClick={() => navigate('ticker')}
              className="mt-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              Analyze a Ticker
            </button>
          </div>
        )}

        {/* Positions */}
        <div className="space-y-3">
          {shown.map(pos => (
            <PositionCard
              key={pos.id}
              pos={pos}
              onClose={() => setClosing(pos)}
              onRemove={() => removeFromPortfolio(pos.id)}
            />
          ))}
        </div>

        {shown.length === 0 && portfolio.length > 0 && (
          <div className="text-center py-10 text-gray-500 text-sm">
            No {filter} positions.
          </div>
        )}

        {/* Disclaimer */}
        <div className="text-center text-xs text-gray-600 py-2 border-t border-gray-800/50">
          <DollarSign size={11} className="inline mr-1" />
          Live P&L is a theoretical at-expiry estimate based on current price. Actual P&L depends on time value, IV changes, and early exit.
        </div>
      </div>
    </div>
  )
}
