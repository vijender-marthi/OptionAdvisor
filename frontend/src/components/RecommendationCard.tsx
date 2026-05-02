import { useState } from 'react'
import { ChevronDown, ChevronUp, CheckCircle, XCircle, AlertTriangle, Briefcase, Star, Check, TrendingUp, Layers } from 'lucide-react'
import type { Recommendation, Signals } from '../types'
import { useApp } from '../contexts/AppContext'
import PreTradeChecklist, { buildChecklist, deriveVerdict } from './PreTradeChecklist'

interface Props {
  rec: Recommendation
  ticker: string
  companyName: string
  currentPrice: number
  signals: Signals
  onFetchAllWeeks?: () => void
  fetchingAllWeeks?: boolean
}

const biasColor = (b: string) =>
  b.includes('Bullish') ? 'border-l-green-500' :
  b.includes('Bearish') ? 'border-l-red-500' : 'border-l-amber-500'

const biasBadgeClass = (b: string) =>
  b.includes('Bullish') ? 'bg-green-900/50 text-green-400 border-green-700' :
  b.includes('Bearish') ? 'bg-red-900/50 text-red-400 border-red-700' :
  'bg-amber-900/50 text-amber-400 border-amber-700'

const scoreColor = (s: number) =>
  s >= 75 ? 'text-green-400' : s >= 55 ? 'text-amber-400' : 'text-red-400'

function FilterBadge({ label, pass }: { label: string; pass: boolean }) {
  return (
    <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium
      ${pass ? 'bg-green-900/30 text-green-400 border-green-800' : 'bg-red-900/30 text-red-400 border-red-800'}`}>
      {pass ? <CheckCircle size={11} /> : <XCircle size={11} />} {label}
    </span>
  )
}

function ScoreBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-400 w-20 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${(value / max) * 100}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs font-mono text-gray-300 w-10 text-right">{value}/{max}</span>
    </div>
  )
}

const CONTRACT_OPTIONS = [1, 2, 3, 5, 10]

export default function RecommendationCard({
  rec, ticker, companyName, currentPrice, signals, onFetchAllWeeks, fetchingAllWeeks = false,
}: Props) {
  const { addToPortfolio, addToWatchlist, isInPortfolio, isWatched, navigate } = useApp()
  const [open, setOpen]                       = useState(false)
  const [exitOpen, setExitOpen]               = useState(false)
  const [addedPort, setAddedPort]             = useState(false)
  const [addedWatch, setAddedWatch]           = useState(false)
  const [contractPickerOpen, setContractPickerOpen] = useState(false)
  const [selectedContracts, setSelectedContracts]   = useState(1)

  const inPortfolio = isInPortfolio(ticker, rec.strategy, rec.expiry) || addedPort
  const watched     = isWatched(ticker) || addedWatch

  const handleConfirmPortfolio = () => {
    addToPortfolio(rec, ticker, companyName, currentPrice, selectedContracts)
    setAddedPort(true)
    setContractPickerOpen(false)
    setTimeout(() => navigate('portfolio'), 800)
  }

  const handleAddWatchlist = () => {
    addToWatchlist({ ticker, companyName, lastPrice: currentPrice })
    setAddedWatch(true)
  }

  const openPortfolioPicker = () => {
    setOpen(true)
    setContractPickerOpen(true)
  }

  const checkItems      = buildChecklist(rec, signals)
  const verdict         = deriveVerdict(checkItems)
  const hardFailReasons = checkItems.filter(i => i.status === 'fail' && i.hard).map(i => i.label)
  const softFailReasons = checkItems.filter(i => i.status === 'fail' && !i.hard).map(i => i.label)
  const blockingReasons = [...hardFailReasons, ...softFailReasons].slice(0, 3)

  const verdictBadge = verdict === 'GO'
    ? 'bg-emerald-900/50 text-emerald-400 border-emerald-700'
    : verdict === 'CAUTION'
    ? 'bg-amber-900/50 text-amber-400 border-amber-700'
    : 'bg-red-900/50 text-red-400 border-red-700'
  const verdictLabel = verdict === 'GO' ? '✅ GO' : verdict === 'CAUTION' ? '⚠️ CAUTION' : '🚫 NO GO'

  const isCredit = rec.net_credit > 0
  const c = (val: number) => (val * 100)                        // per contract value
  const fmt = (val: number) => val.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  const rrRatio = rec.risk_reward_ratio
  const rrColor = rrRatio <= 2.5 ? 'text-green-400' : rrRatio <= 4 ? 'text-amber-400' : 'text-red-400'
  const evColor = rec.expected_value > 0 ? 'text-green-400' : 'text-red-400'

  return (
    <div className={`bg-gray-900 border border-gray-800 rounded-2xl border-l-4 ${biasColor(rec.bias)} overflow-hidden`}>

      {/* ── Collapsed summary row (always visible) ── */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 text-left hover:bg-gray-800/40 transition-colors flex-wrap sm:flex-nowrap"
      >
        {/* Rank badge */}
        <span className="bg-violet-900/60 text-violet-300 text-xs font-bold px-2 py-0.5 rounded-full border border-violet-700 shrink-0">
          #{rec.rank}
        </span>

        {/* Strategy + bias */}
        <span className="font-bold text-white text-sm min-w-0 break-words">{rec.strategy}</span>
        <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold shrink-0 ${biasBadgeClass(rec.bias)}`}>
          {rec.bias.includes('Bullish') ? '↑' : rec.bias.includes('Bearish') ? '↓' : '↔'} {rec.bias}
        </span>
        <span className="text-xs px-2 py-0.5 bg-gray-800 text-gray-400 rounded-full border border-gray-700 shrink-0">
          {rec.dte} DTE
        </span>

        {/* Quick stats — visible when collapsed */}
        {!open && (
          <span className="hidden sm:flex items-center gap-3 ml-2 text-xs text-gray-500 flex-1 flex-wrap">
            <span className="text-emerald-400 font-mono">+${fmt(c(rec.max_profit))}</span>
            <span className="text-red-400 font-mono">-${fmt(c(rec.max_loss))}</span>
            <span className="flex items-center gap-1"><TrendingUp size={10} />{(rec.prob_of_profit * 100).toFixed(0)}% PoP</span>
            {isCredit && <span className="text-violet-400 font-mono">${fmt(c(rec.net_credit))} credit</span>}
          </span>
        )}

        {/* Spacer + verdict + score + chevron */}
        <span className="hidden sm:block flex-1" />
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${verdictBadge}`}>
          {verdictLabel}
        </span>
        <span className={`font-bold text-xs font-mono shrink-0 ml-2 ${scoreColor(rec.scores.total_score)}`}>
          {rec.scores.total_score}/100
        </span>
        <span className="text-gray-500 shrink-0 ml-1">
          {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </span>
      </button>

      {!open && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-3 sm:px-4 pb-3 -mt-1">
          <div className="text-xs min-w-0">
            {verdict === 'NO GO' && blockingReasons.length > 0
              ? <span className="text-red-400/80">🚫 Blocked: {blockingReasons.join(' · ')}</span>
              : verdict === 'CAUTION' && blockingReasons.length > 0
              ? <span className="recommendation-caution-reason text-amber-400/80">⚠️ Caution: {blockingReasons.join(' · ')}</span>
              : <span className="text-gray-500">Add this trade idea to your portfolio tracker with contract sizing.</span>
            }
          </div>
          {!inPortfolio ? (
            <button
              type="button"
              onClick={openPortfolioPicker}
              className="w-full sm:w-auto justify-center flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all
                         bg-violet-600/15 border-violet-700/60 text-violet-300 hover:bg-violet-600/25 hover:border-violet-500"
            >
              <Briefcase size={11} /> Add to Portfolio
            </button>
          ) : (
            <span className="w-full sm:w-auto justify-center flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border
                             bg-violet-900/30 border-violet-700 text-violet-300">
              <Check size={11} /> Added to Portfolio
            </span>
          )}
        </div>
      )}

      {/* ── Expanded detail ── */}
      {open && (
        <div>
          {/* Filter badges + action buttons */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-3 sm:px-4 pb-3">
            <div className="flex gap-2 flex-wrap">
              <FilterBadge label="R:R Filter" pass={rec.passes_rr_filter} />
              {isCredit && <FilterBadge label={`Credit ≥25% (${rec.credit_pct_of_width.toFixed(0)}%)`} pass={rec.passes_credit_filter} />}
              <FilterBadge label="Liquidity OK" pass={rec.passes_liquidity_filter} />
            </div>
            <div className="grid grid-cols-2 sm:flex gap-2 sm:shrink-0">
              {onFetchAllWeeks && (
                <button
                  onClick={e => { e.stopPropagation(); onFetchAllWeeks() }}
                  disabled={fetchingAllWeeks}
                  className="justify-center flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all
                             bg-gray-800 border-gray-700 text-gray-400 hover:border-violet-600 hover:text-violet-400 disabled:opacity-50"
                >
                  <Layers size={11} className={fetchingAllWeeks ? 'animate-pulse' : ''} />
                  {fetchingAllWeeks ? 'Fetching…' : 'All Weeks'}
                </button>
              )}
              <button
                onClick={e => { e.stopPropagation(); handleAddWatchlist() }}
                disabled={watched}
                className={`justify-center flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                  watched
                    ? 'bg-amber-900/20 border-amber-800 text-amber-400 cursor-default'
                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-amber-600 hover:text-amber-400'
                }`}
              >
                {watched ? <><Check size={11} /> Watched</> : <><Star size={11} /> Watchlist</>}
              </button>
              {!inPortfolio ? (
                <button
                  onClick={e => { e.stopPropagation(); setContractPickerOpen(o => !o) }}
                  className="justify-center flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all
                             bg-gray-800 border-gray-700 text-gray-400 hover:border-violet-600 hover:text-violet-400"
                >
                  <Briefcase size={11} /> Portfolio
                </button>
              ) : (
                <span className="justify-center flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border
                                 bg-violet-900/30 border-violet-700 text-violet-300">
                  <Check size={11} /> Added
                </span>
              )}
            </div>
          </div>

          {/* Contract picker — shown when Portfolio button clicked */}
          {contractPickerOpen && !inPortfolio && (
            <div
              className="mx-3 sm:mx-4 mb-3 p-3 bg-violet-950/40 border border-violet-800 rounded-xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="text-xs text-violet-300 font-semibold mb-2">
                How many contracts?
                <span className="block sm:inline text-violet-500 font-normal sm:ml-1.5 mt-1 sm:mt-0">1 contract = 100 shares · ${(rec.max_profit * 100).toFixed(0)} max profit each</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {CONTRACT_OPTIONS.map(n => (
                  <button
                    key={n}
                    onClick={() => setSelectedContracts(n)}
                    className={`w-10 h-10 rounded-lg text-sm font-bold border transition-all ${
                      selectedContracts === n
                        ? 'bg-violet-600 border-violet-500 text-white'
                        : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-violet-600 hover:text-violet-400'
                    }`}
                  >
                    {n}
                  </button>
                ))}
                <div className="ml-2 text-xs text-gray-400">
                  <span className="text-emerald-400 font-mono">${(rec.max_profit * 100 * selectedContracts).toLocaleString()}</span>
                  <span> max profit · </span>
                  <span className="text-red-400 font-mono">${(rec.max_loss * 100 * selectedContracts).toLocaleString()}</span>
                  <span> max loss</span>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:flex gap-2 mt-3">
                <button
                  onClick={() => setContractPickerOpen(false)}
                  className="px-3 py-1.5 bg-gray-800 text-gray-400 text-xs rounded-lg hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmPortfolio}
                  className="px-4 py-1.5 bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold rounded-lg transition-colors"
                >
                  Add {selectedContracts} Contract{selectedContracts > 1 ? 's' : ''} to Portfolio
                </button>
              </div>
            </div>
          )}

          {/* Warnings */}
          {rec.warnings.length > 0 && (
            <div className="mx-4 mb-3 p-2 bg-amber-900/20 border border-amber-800 rounded-lg">
              {rec.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-1.5 text-xs text-amber-300">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {w}
                </div>
              ))}
            </div>
          )}

      {/* Legs */}
      <div className="mx-3 sm:mx-4 bg-gray-800/60 rounded-xl p-3 font-mono text-xs mb-3 overflow-x-auto">
        <div className="text-gray-500 text-xs mb-1.5">1 contract = 100 shares</div>
        <table className="w-full min-w-[46rem]">
          <thead>
            <tr className="text-gray-500 border-b border-gray-700">
              <th className="text-left pb-1.5 pr-3">Action</th>
              <th className="text-left pb-1.5 pr-3">Type</th>
              <th className="text-right pb-1.5 pr-3">Strike</th>
              <th className="text-right pb-1.5 pr-3">Expiry</th>
              <th className="text-right pb-1.5 pr-3">Delta</th>
              <th className="text-right pb-1.5 pr-3">Mid/sh</th>
              <th className="text-right pb-1.5 pr-3">Contract Cost</th>
              <th className="text-right pb-1.5 pr-3">IV</th>
              <th className="text-right pb-1.5 pr-3">OI</th>
              <th className="text-right pb-1.5">BA%</th>
            </tr>
          </thead>
          <tbody>
            {rec.legs.map((leg, i) => (
              <tr key={i} className="border-b border-gray-700/50 last:border-0">
                <td className={`pr-3 py-1 font-bold ${leg.action === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>{leg.action}</td>
                <td className="pr-3 py-1 text-white">{leg.option_type}</td>
                <td className="pr-3 py-1 text-right text-white">${leg.strike.toFixed(1)}</td>
                <td className="pr-3 py-1 text-right text-gray-300">{leg.expiry}</td>
                <td className="pr-3 py-1 text-right text-gray-300">{leg.delta !== 0 ? leg.delta.toFixed(3) : '—'}</td>
                <td className="pr-3 py-1 text-right text-gray-400">
                  ${leg.mid_price.toFixed(2)}
                  {leg.data_quality === 'MODEL' && (
                    <span
                      title={leg.data_quality_reason || 'Using IV-based model mark because the Yahoo quote looked stale'}
                      className="ml-1 px-1 py-0.5 rounded text-[9px] font-bold uppercase bg-blue-900/60 text-blue-300 border border-blue-700 cursor-help"
                    >
                      Model
                    </span>
                  )}
                </td>
                <td className={`pr-3 py-1 text-right font-bold ${leg.action === 'BUY' ? 'text-red-300' : 'text-green-300'}`}>
                  {leg.action === 'BUY' ? '-' : '+'}${fmt(c(leg.mid_price))}
                </td>
                <td className="pr-3 py-1 text-right text-gray-300">{leg.iv.toFixed(1)}%</td>
                <td className="pr-3 py-1 text-right text-gray-300">{leg.oi.toLocaleString()}</td>
                <td className={`py-1 text-right ${leg.bid_ask_spread_pct > 10 ? 'text-amber-400' : 'text-gray-300'}`}>
                  {leg.bid_ask_spread_pct.toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Compact risk/reward + score summary */}
      <div className="px-3 sm:px-4 pb-3 grid gap-3 lg:grid-cols-[1.45fr_1fr]">
        <div className="bg-gray-800/60 rounded-xl p-3">
          <div className="flex items-center justify-between gap-3 mb-2">
            <span className="text-xs font-semibold text-gray-400">Risk / Reward</span>
            <span className={`text-xs font-mono font-bold ${rrColor}`}>
              1:{(rec.max_profit / rec.max_loss).toFixed(1)}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div>
              <div className="text-gray-500">Max Profit</div>
              <div className="text-emerald-400 font-bold font-mono">${fmt(c(rec.max_profit))}</div>
            </div>
            <div>
              <div className="text-gray-500">Max Loss</div>
              <div className="text-red-400 font-bold font-mono">${fmt(c(rec.max_loss))}</div>
            </div>
            <div>
              <div className="text-gray-500">PoP / EV</div>
              <div className="font-mono text-gray-200">
                {(rec.prob_of_profit * 100).toFixed(0)}% · <span className={evColor}>{rec.expected_value > 0 ? '+' : ''}${fmt(c(rec.expected_value))}</span>
              </div>
            </div>
            <div>
              <div className="text-gray-500">Breakeven</div>
              <div className="font-mono text-gray-200 truncate">
                {rec.breakeven_upper < 990
                  ? `$${rec.breakeven_lower.toFixed(2)}–$${rec.breakeven_upper.toFixed(2)}`
                  : `$${rec.breakeven_lower.toFixed(2)}`}
              </div>
            </div>
          </div>
          {isCredit && (
            <div className={`mt-2 border-t border-gray-700/60 pt-2 text-xs font-mono ${rec.passes_credit_filter ? 'text-green-400' : 'text-amber-400'}`}>
              {rec.passes_credit_filter ? '✅' : '⚠️'} ${fmt(c(rec.net_credit))} credit · {rec.credit_pct_of_width.toFixed(0)}% of ${rec.spread_width.toFixed(0)} width
              {!rec.passes_credit_filter && ' · below 25% minimum'}
            </div>
          )}
        </div>

        <div className="bg-gray-800/40 rounded-xl p-3">
          <div className="flex items-center justify-between gap-3 mb-2">
            <span className="text-xs font-semibold text-gray-400">Score Breakdown</span>
            <span className={`font-mono text-sm font-bold ${scoreColor(rec.scores.total_score)}`}>{rec.scores.total_score}/100</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5 text-[11px]">
            <div className="rounded-lg bg-gray-900/50 px-2 py-1 flex justify-between"><span className="text-gray-500">Signal</span><span className="font-mono text-violet-300">{rec.scores.signal_score}/40</span></div>
            <div className="rounded-lg bg-gray-900/50 px-2 py-1 flex justify-between"><span className="text-gray-500">Structure</span><span className="font-mono text-blue-300">{rec.scores.structure_score}/30</span></div>
            <div className="rounded-lg bg-gray-900/50 px-2 py-1 flex justify-between"><span className="text-gray-500">Liquidity</span><span className="font-mono text-emerald-300">{rec.scores.liquidity_score}/20</span></div>
            <div className="rounded-lg bg-gray-900/50 px-2 py-1 flex justify-between"><span className="text-gray-500">IV</span><span className="font-mono text-amber-300">{rec.scores.iv_fit_score}/10</span></div>
          </div>
        </div>
      </div>

      {/* Rationale */}
      <div className="px-4 pb-3">
        <div className="bg-gray-800/40 rounded-xl p-3">
          <div className="text-xs text-violet-400 font-semibold mb-1.5">💡 Why this trade</div>
          <p className="text-sm text-gray-300 leading-relaxed">{rec.rationale}</p>
        </div>
      </div>

      {/* Pre-Trade Checklist */}
      <PreTradeChecklist rec={rec} signals={signals} />

      {/* Exit plan (collapsible) */}
      <div className="px-4 pb-4">
        <button
          onClick={() => setExitOpen(o => !o)}
          className="w-full flex items-center justify-between text-xs text-indigo-400 hover:text-indigo-300
                     bg-indigo-950/40 border border-indigo-900 rounded-xl px-3 py-2 transition-colors"
        >
          <span>🚪 Exit Plan</span>
          {exitOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
        {exitOpen && (
          <div className="mt-2 p-3 bg-indigo-950/30 border border-indigo-900 rounded-xl text-sm text-indigo-200 leading-relaxed">
            {rec.exit_plan}
          </div>
        )}
      </div>
        </div>
      )}
    </div>
  )
}
