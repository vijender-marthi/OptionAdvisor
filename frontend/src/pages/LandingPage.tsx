import { useState, FormEvent } from 'react'
import { TrendingUp, Shield, Zap, BarChart2, ArrowRight, Search } from 'lucide-react'
import { analyzeV2 } from '../api/client'
import type { UnifiedAnalysis } from '../api/client'
import { useApp } from '../contexts/AppContext'

type Rec = UnifiedAnalysis['regular_recommendations'][number]

const VERDICT_COLOR: Record<string, string> = {
  STRONG_GO: 'text-emerald-400',
  GO:        'text-green-400',
  WATCH:     'text-amber-400',
  WAIT:      'text-gray-400',
  AVOID:     'text-red-400',
  NO_EDGE:   'text-gray-500',
}

function scoreLabel(score: number): { label: string; color: string } {
  if (score >= 80) return { label: 'Strong', color: 'text-emerald-400' }
  if (score >= 60) return { label: 'Good',   color: 'text-green-400' }
  if (score >= 40) return { label: 'Fair',   color: 'text-amber-400' }
  return { label: 'Weak', color: 'text-gray-500' }
}

function fmtUsd(n: number) {
  if (!Number.isFinite(n)) return '—'
  return n >= 0 ? `$${n.toFixed(0)}` : `-$${Math.abs(n).toFixed(0)}`
}

function fmtPct(n: number) {
  if (!Number.isFinite(n)) return '—'
  return `${(n * 100).toFixed(0)}%`
}

function BiasChip({ bias }: { bias: string }) {
  const up = bias.toLowerCase().includes('bull') || bias.toLowerCase() === 'long'
  const down = bias.toLowerCase().includes('bear') || bias.toLowerCase() === 'short'
  const cls = up ? 'bg-emerald-900/40 text-emerald-400 border-emerald-700/40'
    : down ? 'bg-red-900/40 text-red-400 border-red-700/40'
    : 'bg-gray-800/60 text-gray-400 border-gray-700/40'
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium border ${cls}`}>
      {bias}
    </span>
  )
}

export default function LandingPage() {
  const { user, navigate } = useApp()
  const [ticker, setTicker] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<UnifiedAnalysis | null>(null)
  const [weeksOut, setWeeksOut] = useState(4)
  const [error, setError] = useState('')

  // Logged-in users see the landing page too (with dashboard link in nav)

  const runAnalyze = async (sym: string, weeks: number) => {
    setError('')
    setResult(null)
    setLoading(true)
    setWeeksOut(weeks)
    try {
      const res = await analyzeV2(sym, 'regular', { weeksOut: weeks, strategyMode: 'all' })
      // Auto-retry with wider window if no recs returned
      if ((res.data.regular_recommendations ?? []).length === 0 && weeks === 4) {
        const res2 = await analyzeV2(sym, 'regular', { weeksOut: 8, strategyMode: 'all' })
        setWeeksOut(8)
        setResult(res2.data)
      } else {
        setResult(res.data)
      }
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 401 || status === 403) {
        setError('Sign in to unlock full analysis — or create a free account.')
      } else {
        setError('Could not analyze ticker. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleAnalyze = async (e: FormEvent) => {
    e.preventDefault()
    const sym = ticker.trim().toUpperCase()
    if (!sym) return
    runAnalyze(sym, 4)
  }

  const recs: Rec[] = result?.regular_recommendations ?? []

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Nav */}
      <header className="border-b border-gray-800/60 px-6 py-4 flex items-center justify-between max-w-6xl mx-auto">
        <div className="flex items-center gap-2">
          <BarChart2 className="w-5 h-5 text-violet-400" />
          <span className="font-bold text-white tracking-tight">OptionAdvisor</span>
          <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-900/50 text-violet-300 border border-violet-700/40">BETA</span>
        </div>
        <div className="flex items-center gap-3">
          {user ? (
            <button
              onClick={() => navigate('trade-command-center')}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-colors"
            >
              Open Dashboard <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <>
              <button
                onClick={() => navigate('login')}
                className="text-sm text-gray-400 hover:text-white transition-colors"
              >
                Sign in
              </button>
              <button
                onClick={() => navigate('login')}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-colors"
              >
                Get started free
              </button>
            </>
          )}
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-4xl mx-auto px-6 pt-20 pb-12 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-900/30 border border-violet-700/40 text-violet-300 text-xs font-medium mb-6">
          <Zap className="w-3 h-3" /> AI-powered options analysis
        </div>
        <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-4 leading-tight">
          Find your next options trade<br />
          <span className="text-violet-400">in seconds</span>
        </h1>
        <p className="text-gray-400 text-lg mb-10 max-w-xl mx-auto">
          Enter any ticker below to see ranked options strategies for the next 3–4 weeks,
          with AI-scored setups and plain-English decisions.
        </p>

        {/* Ticker Input */}
        <form onSubmit={handleAnalyze} className="flex items-center gap-3 max-w-sm mx-auto">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
            <input
              type="text"
              value={ticker}
              onChange={e => setTicker(e.target.value.toUpperCase())}
              placeholder="AAPL, TSLA, SPY…"
              className="w-full pl-9 pr-4 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500 font-mono text-sm"
              maxLength={10}
            />
          </div>
          <button
            type="submit"
            disabled={loading || !ticker.trim()}
            className="px-5 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
          >
            {loading ? 'Analyzing…' : 'Analyze'}
          </button>
        </form>

        {error && (
          <div className="mt-4 max-w-sm mx-auto px-4 py-3 rounded-lg bg-red-900/30 border border-red-700/40 text-red-300 text-sm">
            {error}
            {error.includes('Sign in') && (
              <button
                onClick={() => navigate('login')}
                className="ml-2 underline font-medium"
              >
                Sign in →
              </button>
            )}
          </div>
        )}
      </section>

      {/* Results */}
      {result && (
        <section className="max-w-5xl mx-auto px-6 pb-16">
          {/* Summary */}
          <div className="mb-6 p-4 rounded-xl bg-gray-900/60 border border-gray-800 flex flex-wrap items-center gap-4">
            <div>
              <span className="font-mono font-bold text-white text-lg">{result.ticker}</span>
              <span className="ml-2 text-gray-400 text-sm">{result.company}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-gray-500 text-xs">Price</span>
              <span className="font-mono text-white font-semibold">${result.price?.toFixed(2) ?? '—'}</span>
              {result.change_pct != null && (
                <span className={`text-xs font-mono ${result.change_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {result.change_pct >= 0 ? '+' : ''}{result.change_pct.toFixed(2)}%
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-gray-500 text-xs">Verdict</span>
              <span className={`text-sm font-bold ${VERDICT_COLOR[result.verdict] ?? 'text-gray-400'}`}>
                {result.verdict.replace('_', ' ')}
              </span>
            </div>
            <div className="ml-auto text-xs text-gray-400 max-w-xs leading-snug hidden md:block">
              {result.reason}
            </div>
          </div>

          {/* Options Table */}
          {recs.length > 0 ? (
            <>
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
                Options strategies · {recs.length} setups across 3–4 weeks
              </h2>
              <div className="overflow-x-auto rounded-xl border border-gray-800">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-gray-800 bg-gray-900/60">
                      <th className="px-3 py-2.5 text-left text-[11px] font-medium text-gray-500 uppercase tracking-wide">#</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-medium text-gray-500 uppercase tracking-wide">Strategy</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-medium text-gray-500 uppercase tracking-wide">Bias</th>
                      <th className="px-3 py-2.5 text-right text-[11px] font-medium text-gray-500 uppercase tracking-wide">Expiry</th>
                      <th className="px-3 py-2.5 text-right text-[11px] font-medium text-gray-500 uppercase tracking-wide">DTE</th>
                      <th className="px-3 py-2.5 text-right text-[11px] font-medium text-gray-500 uppercase tracking-wide">Max Profit</th>
                      <th className="px-3 py-2.5 text-right text-[11px] font-medium text-gray-500 uppercase tracking-wide">Max Loss</th>
                      <th className="px-3 py-2.5 text-right text-[11px] font-medium text-gray-500 uppercase tracking-wide">Prob Profit</th>
                      <th className="px-3 py-2.5 text-right text-[11px] font-medium text-gray-500 uppercase tracking-wide">Exp. Value</th>
                      <th className="px-3 py-2.5 text-right text-[11px] font-medium text-gray-500 uppercase tracking-wide">Score</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-medium text-gray-500 uppercase tracking-wide">Decision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recs.map((rec, i) => {
                      const { label: scoreText, color: scoreColor } = scoreLabel(rec.score)
                      return (
                        <tr
                          key={i}
                          className="border-b border-gray-800/50 last:border-0 hover:bg-gray-900/40 transition-colors"
                        >
                          <td className="px-3 py-2.5 text-gray-500 font-mono text-xs">{rec.rank ?? i + 1}</td>
                          <td className="px-3 py-2.5 font-medium text-white text-xs whitespace-nowrap">{rec.strategy}</td>
                          <td className="px-3 py-2.5"><BiasChip bias={rec.bias} /></td>
                          <td className="px-3 py-2.5 text-right font-mono text-xs text-gray-300">{rec.expiry}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-xs text-gray-400">{rec.dte}d</td>
                          <td className="px-3 py-2.5 text-right font-mono text-xs text-emerald-400">{fmtUsd(rec.max_profit)}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-xs text-red-400">{fmtUsd(-Math.abs(rec.max_loss))}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-xs text-gray-300">{fmtPct(rec.prob_of_profit)}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-xs">
                            <span className={rec.expected_value >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                              {fmtUsd(rec.expected_value)}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <span className={`font-bold text-xs ${scoreColor}`}>
                              {rec.score.toFixed(0)} <span className="font-normal opacity-70">{scoreText}</span>
                            </span>
                          </td>
                          <td className="px-3 py-2.5 max-w-[220px]">
                            <p className="text-[11px] text-gray-400 leading-snug line-clamp-2">{rec.rationale}</p>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11px] text-gray-600">
                Ranked by expected value and probability of profit. Sign in for real-time alerts, portfolio tracking, and AI coaching.
              </p>
            </>
          ) : (
            <div className="py-8 px-4 rounded-xl bg-gray-900/40 border border-gray-800 text-center">
              <p className="text-gray-400 text-sm font-medium mb-1">No setups passed filters for this ticker</p>
              <p className="text-gray-600 text-xs mb-5">
                {weeksOut >= 8
                  ? 'Even with an 8-week window, no setups cleared the risk/reward filters. The market may be pricing in too much uncertainty.'
                  : 'Filters were applied across 4- and 8-week windows. No setups cleared the risk/reward thresholds.'}
              </p>
              <div className="flex items-center justify-center gap-3 flex-wrap">
                <button
                  onClick={() => runAnalyze(ticker.trim().toUpperCase(), 12)}
                  disabled={loading}
                  className="px-4 py-1.5 rounded-lg border border-gray-700 text-gray-300 text-xs font-medium hover:bg-gray-800 transition-colors disabled:opacity-40"
                >
                  Try 12-week window
                </button>
                <button
                  onClick={() => navigate('login')}
                  className="px-4 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors"
                >
                  Sign in for advanced filters →
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Preview teaser — shown when no result yet */}
      {!result && !error && (
        <section className="max-w-5xl mx-auto px-6 pb-10">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">
              Sample output · AAPL · 6 setups · Long &amp; Short
            </h2>
            <span className="text-[11px] text-violet-400 font-medium">← Enter a ticker above to run live analysis</span>
          </div>
          <div className="relative rounded-xl border border-gray-800 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-gray-800 bg-gray-900/60">
                    {['#','Strategy','Bias','Expiry','DTE','Max Profit','Max Loss','Prob Profit','Exp. Value','Score','Decision'].map(h => (
                      <th key={h} className="px-3 py-2.5 text-left text-[11px] font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { rank:1, strategy:'Bull Call Spread',  bias:'Bullish', expiry:'Jun 20', dte:19, profit:'$320', loss:'-$180', prob:'62%', ev:'$56',  score:'84 Strong', rationale:'Strong momentum with support at 20-day MA. IV rank at 28 favours debit spreads.' },
                    { rank:2, strategy:'Bear Put Spread',   bias:'Bearish', expiry:'Jun 20', dte:19, profit:'$290', loss:'-$210', prob:'54%', ev:'$33',  score:'72 Good',   rationale:'Overhead resistance at 200-day MA. Negative divergence on RSI. Defined risk bearish play.' },
                    { rank:3, strategy:'Iron Condor',       bias:'Neutral', expiry:'Jul 18', dte:47, profit:'$145', loss:'-$355', prob:'68%', ev:'$24',  score:'61 Good',   rationale:'Range-bound price action. IV contraction expected post-FOMC. Wide wings reduce assignment risk.' },
                    { rank:4, strategy:'Bear Call Spread',  bias:'Bearish', expiry:'Jun 27', dte:26, profit:'$180', loss:'-$320', prob:'58%', ev:'$14',  score:'55 Fair',   rationale:'Call premium elevated near resistance. Credit spread captures decay while capping upside risk.' },
                    { rank:5, strategy:'Cash-Secured Put',  bias:'Neutral', expiry:'Jun 27', dte:26, profit:'$210', loss:'-$790', prob:'71%', ev:'$41',  score:'50 Fair',   rationale:'High put premium relative to delta. Earnings risk cleared. Suitable for accumulation below support.' },
                    { rank:6, strategy:'Long Call',         bias:'Bullish', expiry:'Jun 20', dte:19, profit:'∞',   loss:'-$230', prob:'44%', ev:'-$8',  score:'39 Weak',   rationale:'Breakout potential but low probability. Only suitable for high-conviction directional plays.' },
                  ].map(row => (
                    <tr key={row.rank} className="border-b border-gray-800/50 last:border-0 bg-gray-900/20">
                      <td className="px-3 py-2.5 text-gray-500 font-mono text-xs">{row.rank}</td>
                      <td className="px-3 py-2.5 font-medium text-white text-xs whitespace-nowrap">{row.strategy}</td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium border ${row.bias === 'Bullish' ? 'bg-emerald-900/40 text-emerald-400 border-emerald-700/40' : row.bias === 'Bearish' ? 'bg-red-900/40 text-red-400 border-red-700/40' : 'bg-gray-800/60 text-gray-400 border-gray-700/40'}`}>{row.bias}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs text-gray-300">{row.expiry}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs text-gray-400">{row.dte}d</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs text-emerald-400">{row.profit}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs text-red-400">{row.loss}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs text-gray-300">{row.prob}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs">
                        <span className={row.ev.startsWith('-') ? 'text-red-400' : 'text-emerald-400'}>{row.ev}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className={`font-bold text-xs ${row.score.includes('Strong') ? 'text-emerald-400' : row.score.includes('Good') ? 'text-green-400' : row.score.includes('Fair') ? 'text-amber-400' : 'text-gray-500'}`}>{row.score}</span>
                      </td>
                      <td className="px-3 py-2.5 max-w-[220px]">
                        <p className="text-[11px] text-gray-400 leading-snug line-clamp-2">{row.rationale}</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* bottom fade + CTA strip */}
            <div className="absolute bottom-0 left-0 right-0 h-28 bg-gradient-to-t from-gray-950 via-gray-950/80 to-transparent pointer-events-none" />
            <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-4 py-3">
              <p className="text-xs text-gray-500">Sample data · enter a ticker above for live results</p>
              <button
                onClick={() => navigate('login')}
                className="px-4 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors pointer-events-auto"
              >
                Sign in for real-time analysis →
              </button>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-gray-600">
            Ranked by expected value and probability of profit · Sample data shown for illustration only
          </p>
        </section>
      )}

      {/* Feature highlights */}
      {!result && (
        <section className="max-w-4xl mx-auto px-6 pb-20 grid md:grid-cols-3 gap-6">
          {[
            {
              icon: <TrendingUp className="w-5 h-5 text-violet-400" />,
              title: 'Multi-week options view',
              desc: 'See ranked strategies across 1–4 week expirations with scored R/R and probability of profit.',
            },
            {
              icon: <Zap className="w-5 h-5 text-amber-400" />,
              title: 'AI-powered decisions',
              desc: 'Every setup comes with a plain-English rationale and a confidence-scored verdict.',
            },
            {
              icon: <Shield className="w-5 h-5 text-emerald-400" />,
              title: 'Risk-aware guardrails',
              desc: 'R/R filters, opening range checks, and IV environment alerts keep you out of bad trades.',
            },
          ].map(({ icon, title, desc }) => (
            <div key={title} className="p-5 rounded-xl bg-gray-900/50 border border-gray-800">
              <div className="mb-3">{icon}</div>
              <h3 className="font-semibold text-white mb-1.5 text-sm">{title}</h3>
              <p className="text-gray-500 text-xs leading-relaxed">{desc}</p>
            </div>
          ))}
        </section>
      )}

      <footer className="border-t border-gray-800/60 py-6 text-center text-xs text-gray-600">
        © {new Date().getFullYear()} OptionAdvisor · Not financial advice.
      </footer>
    </div>
  )
}
