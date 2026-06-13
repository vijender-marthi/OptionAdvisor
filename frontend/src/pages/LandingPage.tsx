import { useState, FormEvent } from 'react'
import { TrendingUp, Shield, Zap, BarChart2, ArrowRight, Search, ChevronUp, ChevronDown } from 'lucide-react'
import { analyzePublic } from '../api/client'
import type { UnifiedAnalysis } from '../api/client'
import { useApp } from '../contexts/AppContext'

type Rec = UnifiedAnalysis['regular_recommendations'][number]

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtCost(rec: Rec): { label: string; value: string; color: string } {
  const isCredit = (rec.net_credit ?? 0) > 0
  if (isCredit) {
    const amt = Math.round((rec.net_credit ?? 0) * 100)
    return { label: 'Credit', value: `+$${amt}`, color: 'text-emerald-400' }
  }
  const cost = Math.round(Math.abs(rec.max_loss ?? 0) * 100)
  return { label: 'Max Cost', value: `-$${cost}`, color: 'text-red-400' }
}

function fmtRR(rec: Rec): string {
  const rr = rec.risk_reward_ratio
  if (rr != null && Number.isFinite(rr)) return `${rr.toFixed(1)}×`
  if (rec.max_profit && rec.max_loss && rec.max_loss > 0)
    return `${(rec.max_profit / rec.max_loss).toFixed(1)}×`
  return '—'
}

function rrColor(rec: Rec): string {
  const rr = rec.risk_reward_ratio ?? (rec.max_loss > 0 ? rec.max_profit / rec.max_loss : 0)
  if (rr >= 2)   return 'text-emerald-400'
  if (rr >= 1.5) return 'text-lime-400'
  if (rr >= 1)   return 'text-yellow-400'
  return 'text-red-400'
}

function setupState(rec: Rec): { label: string; cls: string } {
  const score = rec.scores?.total_score ?? rec.score ?? 0
  const rrOk  = rec.passes_rr_filter !== false
  const liqOk = rec.passes_liquidity_filter !== false

  if (score >= 70 && rrOk && liqOk)
    return { label: 'ENTRY', cls: 'bg-emerald-900/40 text-emerald-300 border-emerald-700' }
  if (score >= 55 && liqOk)
    return { label: 'SETUP', cls: 'bg-blue-900/40 text-blue-300 border-blue-700' }
  if (score >= 40)
    return { label: 'WATCH', cls: 'bg-sky-900/30 text-sky-400 border-sky-700' }
  return { label: 'AVOID', cls: 'bg-red-900/30 text-red-400 border-red-800' }
}

function BiasChip({ bias }: { bias: string }) {
  const up   = bias.toLowerCase().includes('bull') || bias.toLowerCase() === 'long'
  const down = bias.toLowerCase().includes('bear') || bias.toLowerCase() === 'short'
  const cls  = up   ? 'bg-emerald-900/40 text-emerald-400 border-emerald-700/40'
             : down ? 'bg-red-900/40 text-red-400 border-red-700/40'
                    : 'bg-amber-900/40 text-amber-400 border-amber-700/40'
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium border ${cls}`}>
      {bias}
    </span>
  )
}

// Compact legs display: "BUY CALL $150 · SELL CALL $155 · Jun 20"
function LegsCell({ legs }: { legs: Rec['legs'] }) {
  if (!legs?.length) return <span className="text-gray-600 font-mono text-[11px]">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {legs.map((leg, i) => (
        <span
          key={i}
          className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold border ${
            leg.action === 'BUY'
              ? 'bg-emerald-950/50 text-emerald-300 border-emerald-800/60'
              : 'bg-red-950/50 text-red-300 border-red-800/60'
          }`}
        >
          <span className="opacity-60 text-[9px]">{leg.action}</span>
          {' '}{leg.option_type} ${leg.strike.toFixed(0)}
        </span>
      ))}
    </div>
  )
}

// ── Sample data for the pre-analysis teaser ───────────────────────────────────

const SAMPLE_ROWS = [
  { rank:1, strategy:'Bull Call Spread',  bias:'Bullish', setup:'ENTRY', legs:'BUY CALL $185 · SELL CALL $195', expiry:'Jun 20', rr:'2.5×', cost:'+$310', rrCls:'text-emerald-400', setupCls:'bg-emerald-900/40 text-emerald-300 border-emerald-700' },
  { rank:2, strategy:'Bear Put Spread',   bias:'Bearish', setup:'SETUP', legs:'BUY PUT $180 · SELL PUT $170',  expiry:'Jun 20', rr:'1.8×', cost:'+$290', rrCls:'text-lime-400',    setupCls:'bg-blue-900/40 text-blue-300 border-blue-700' },
  { rank:3, strategy:'Iron Condor',       bias:'Neutral', setup:'WATCH', legs:'SELL CALL $200 · BUY CALL $210 · SELL PUT $170 · BUY PUT $160', expiry:'Jul 18', rr:'0.7×', cost:'+$145', rrCls:'text-yellow-400',  setupCls:'bg-sky-900/30 text-sky-400 border-sky-700' },
  { rank:4, strategy:'Bear Call Spread',  bias:'Bearish', setup:'WATCH', legs:'SELL CALL $200 · BUY CALL $210', expiry:'Jun 27', rr:'0.6×', cost:'+$180', rrCls:'text-yellow-400',  setupCls:'bg-sky-900/30 text-sky-400 border-sky-700' },
  { rank:5, strategy:'Long Call',         bias:'Bullish', setup:'AVOID', legs:'BUY CALL $190',                  expiry:'Jun 20', rr:'0.4×', cost:'-$230', rrCls:'text-red-400',     setupCls:'bg-red-900/30 text-red-400 border-red-800' },
]

// ── Main component ────────────────────────────────────────────────────────────

export default function LandingPage() {
  const { user, navigate } = useApp()
  const [ticker, setTicker]   = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState<UnifiedAnalysis | null>(null)
  const [weeksOut, setWeeksOut] = useState(4)
  const [error, setError]     = useState('')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const runAnalyze = async (sym: string, weeks: number) => {
    setError('')
    setResult(null)
    setLoading(true)
    setWeeksOut(weeks)
    try {
      const res = await analyzePublic(sym, { weeksOut: weeks, strategyMode: 'all' })
      if ((res.data.regular_recommendations ?? []).length === 0 && weeks === 4) {
        const res2 = await analyzePublic(sym, { weeksOut: 8, strategyMode: 'all' })
        setWeeksOut(8)
        setResult(res2.data)
      } else {
        setResult(res.data)
      }
    } catch (err: unknown) {
      setError('Could not analyze ticker. Check the symbol and try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleAnalyze = (e: FormEvent) => {
    e.preventDefault()
    const sym = ticker.trim().toUpperCase()
    if (!sym) return
    runAnalyze(sym, 4)
  }

  const recs: Rec[] = (result?.regular_recommendations ?? []).slice().sort((a, b) => {
    const sa = a.scores?.total_score ?? a.score ?? 0
    const sb = b.scores?.total_score ?? b.score ?? 0
    return sortDir === 'desc' ? sb - sa : sa - sb
  })

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
              <button onClick={() => navigate('login')} className="text-sm text-gray-400 hover:text-white transition-colors">
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
          Enter any ticker to see ranked options strategies — setup state, legs, strikes, expiry, R/R, and cost. No login required.
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
          </div>
        )}
      </section>

      {/* ── Live results ──────────────────────────────────────────────────────── */}
      {result && (
        <section className="max-w-6xl mx-auto px-6 pb-16">

          {/* Summary strip */}
          <div className="mb-5 px-4 py-3 rounded-xl bg-gray-900/60 border border-gray-800 flex flex-wrap items-center gap-4">
            <div>
              <span className="font-mono font-bold text-white text-base">{result.ticker}</span>
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
            <div className="ml-auto hidden md:block text-xs text-gray-500 max-w-xs leading-snug">
              {recs.length} setup{recs.length !== 1 ? 's' : ''} · {weeksOut}-week window · Sign in for alerts, coaching &amp; portfolio tracking
            </div>
          </div>

          {recs.length > 0 ? (
            <div className="rounded-xl border border-gray-800 overflow-hidden">
              <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm border-collapse">
                <thead>
                  <tr className="border-b border-gray-800 bg-gray-900/70 text-left text-[10px] uppercase tracking-wide text-gray-500">
                    <th className="px-3 py-2.5 w-6">#</th>
                    <th className="px-3 py-2.5">Strategy</th>
                    <th className="px-3 py-2.5">Bias</th>
                    <th className="px-3 py-2.5">Setup</th>
                    <th className="px-3 py-2.5">Legs</th>
                    <th className="px-3 py-2.5 text-center">Expiry</th>
                    <th
                      className="px-3 py-2.5 text-right cursor-pointer select-none hover:text-gray-300 transition-colors"
                      onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
                    >
                      <span className="inline-flex items-center gap-1">
                        Score
                        {sortDir === 'desc' ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
                      </span>
                    </th>
                    <th className="px-3 py-2.5 text-right">R/R</th>
                    <th className="px-3 py-2.5 text-right">Cost / Contract</th>
                  </tr>
                </thead>
                <tbody>
                  {recs.map((rec, i) => {
                    const state = setupState(rec)
                    const cost  = fmtCost(rec)
                    const score = rec.scores?.total_score ?? rec.score ?? 0
                    return (
                      <tr key={i} className="border-b border-gray-800/50 last:border-0 hover:bg-gray-900/30 transition-colors">
                        <td className="px-3 py-3 text-gray-600 font-mono text-xs">{rec.rank ?? i + 1}</td>
                        <td className="px-3 py-3 font-medium text-white text-xs whitespace-nowrap">{rec.strategy}</td>
                        <td className="px-3 py-3"><BiasChip bias={rec.bias} /></td>
                        <td className="px-3 py-3">
                          <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold border tracking-wide ${state.cls}`}>
                            {state.label}
                          </span>
                        </td>
                        <td className="px-3 py-3"><LegsCell legs={rec.legs} /></td>
                        <td className="px-3 py-3 text-center font-mono text-xs text-gray-300">{rec.expiry}<span className="ml-1 text-gray-600 text-[10px]">{rec.dte}d</span></td>
                        <td className="px-3 py-3 text-right font-mono text-xs font-bold text-gray-300">{score}</td>
                        <td className={`px-3 py-3 text-right font-mono text-xs font-bold ${rrColor(rec)}`}>{fmtRR(rec)}</td>
                        <td className={`px-3 py-3 text-right font-mono text-xs font-bold ${cost.color}`}>
                          <div>{cost.value}</div>
                          <div className="text-[10px] font-normal text-gray-600">{cost.label}</div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              </div>
            </div>
          ) : (
            <div className="py-8 px-4 rounded-xl bg-gray-900/40 border border-gray-800 text-center">
              <p className="text-gray-400 text-sm font-medium mb-1">No setups passed filters for this ticker</p>
              <p className="text-gray-600 text-xs mb-5">
                {weeksOut >= 8
                  ? 'Even with an 8-week window, no setups cleared the risk/reward filters.'
                  : 'Filters were applied across 4- and 8-week windows.'}
              </p>
              <button
                onClick={() => runAnalyze(ticker.trim().toUpperCase(), 12)}
                disabled={loading}
                className="px-4 py-1.5 rounded-lg border border-gray-700 text-gray-300 text-xs font-medium hover:bg-gray-800 transition-colors disabled:opacity-40"
              >
                Try 12-week window
              </button>
            </div>
          )}

          <p className="mt-3 text-[11px] text-gray-600">
            Ranked by score · not financial advice · sign in for AI coaching, alerts, and portfolio tracking
          </p>
        </section>
      )}

      {/* ── Pre-analysis teaser ───────────────────────────────────────────────── */}
      {!result && !error && (
        <section className="max-w-6xl mx-auto px-6 pb-10">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">
              Sample output · AAPL · 5 setups
            </h2>
            <span className="text-[11px] text-violet-400 font-medium">← Enter a ticker above for live analysis</span>
          </div>

          <div className="relative rounded-xl border border-gray-800 overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm border-collapse">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-900/70 text-left text-[10px] uppercase tracking-wide text-gray-500">
                  {['#','Strategy','Bias','Setup','Legs','Expiry','Score','R/R','Cost / Contract'].map(h => (
                    <th key={h} className="px-3 py-2.5 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {SAMPLE_ROWS.map(row => (
                  <tr key={row.rank} className="border-b border-gray-800/50 last:border-0 bg-gray-900/20">
                    <td className="px-3 py-3 text-gray-600 font-mono text-xs">{row.rank}</td>
                    <td className="px-3 py-3 font-medium text-white text-xs whitespace-nowrap">{row.strategy}</td>
                    <td className="px-3 py-3">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                        row.bias === 'Bullish' ? 'bg-emerald-900/40 text-emerald-400 border-emerald-700/40'
                        : row.bias === 'Bearish' ? 'bg-red-900/40 text-red-400 border-red-700/40'
                        : 'bg-amber-900/40 text-amber-400 border-amber-700/40'
                      }`}>{row.bias}</span>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold border tracking-wide ${row.setupCls}`}>
                        {row.setup}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        {row.legs.split(' · ').map((leg, i) => {
                          const isBuy = leg.startsWith('BUY')
                          return (
                            <span key={i} className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold border ${
                              isBuy ? 'bg-emerald-950/50 text-emerald-300 border-emerald-800/60'
                                    : 'bg-red-950/50 text-red-300 border-red-800/60'
                            }`}>
                              <span className="opacity-60 text-[9px]">{isBuy ? 'BUY' : 'SELL'}</span>
                              {' '}{leg.replace(/^(BUY|SELL)\s+/, '')}
                            </span>
                          )
                        })}
                      </div>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-gray-300">{row.expiry}</td>
                    <td className="px-3 py-3 font-mono text-xs text-gray-500">—</td>
                    <td className={`px-3 py-3 font-mono text-xs font-bold ${row.rrCls}`}>{row.rr}</td>
                    <td className={`px-3 py-3 font-mono text-xs font-bold ${row.cost.startsWith('-') ? 'text-red-400' : 'text-emerald-400'}`}>{row.cost}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>

            {/* fade + CTA */}
            <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-gray-950 via-gray-950/80 to-transparent pointer-events-none" />
            <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-4 py-3">
              <p className="text-xs text-gray-500">Sample data · enter a ticker above for live results</p>
              <button
                onClick={() => navigate('login')}
                className="px-4 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors pointer-events-auto"
              >
                Sign in for AI coaching &amp; alerts →
              </button>
            </div>
          </div>

          <p className="mt-2 text-[11px] text-gray-600">
            Sample data for illustration · setup state, legs, expiry, R/R, and cost shown for each strategy
          </p>
        </section>
      )}

      {/* Feature highlights */}
      {!result && (
        <section className="max-w-4xl mx-auto px-6 pb-20 grid md:grid-cols-3 gap-6">
          {[
            {
              icon: <TrendingUp className="w-5 h-5 text-violet-400" />,
              title: 'Setup state at a glance',
              desc: 'Every strategy is classified as ENTRY, SETUP, WATCH, or AVOID — no guessing what the score means.',
            },
            {
              icon: <Zap className="w-5 h-5 text-amber-400" />,
              title: 'Full leg detail',
              desc: 'Strike, option type, expiry, and cost per contract for every leg — ready to place.',
            },
            {
              icon: <Shield className="w-5 h-5 text-emerald-400" />,
              title: 'Risk-aware R/R',
              desc: 'Adaptive R/R filters, IV environment checks, and probability of profit on every setup.',
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
