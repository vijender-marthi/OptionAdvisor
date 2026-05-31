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
  const [error, setError] = useState('')

  // Logged-in users see the landing page too (with dashboard link in nav)

  const handleAnalyze = async (e: FormEvent) => {
    e.preventDefault()
    const sym = ticker.trim().toUpperCase()
    if (!sym) return
    setError('')
    setResult(null)
    setLoading(true)
    try {
      const res = await analyzeV2(sym, 'regular', { weeksOut: 4 })
      setResult(res.data)
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
            <div className="text-center py-8 text-gray-500 text-sm">
              No options recommendations returned for this ticker.
            </div>
          )}
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
