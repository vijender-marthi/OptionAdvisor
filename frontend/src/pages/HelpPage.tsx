import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  HelpCircle, SlidersHorizontal, ShieldCheck, TrendingUp, Filter, Trophy,
  Brain, Star, Briefcase, ChevronDown, ChevronRight, BookOpen,
  Radar, BarChart2, AlertTriangle, CheckCircle2, XCircle, Clock,
} from 'lucide-react'

// ─── Section data ────────────────────────────────────────────────────────────

const strategyRules = [
  {
    condition: 'BULLISH + LOW_IV',
    built: 'Long Call, Bull Call Spread',
    why: 'Buy premium when the engine has upside conviction and options are relatively cheap.',
  },
  {
    condition: 'BEARISH + LOW_IV',
    built: 'Long Put, Bear Put Spread',
    why: 'Buy downside exposure when bearish signals align and IV is not expensive.',
  },
  {
    condition: 'HIGH_IV + not BEARISH',
    built: 'Bull Put Spread',
    why: 'Sell put premium below price when IV is elevated and the signal is bullish or neutral.',
  },
  {
    condition: 'HIGH_IV + not BULLISH',
    built: 'Bear Call Spread',
    why: 'Sell call premium above price when IV is elevated and the signal is bearish or neutral.',
  },
  {
    condition: 'NEUTRAL + HIGH_IV',
    built: 'Iron Condor',
    why: 'Sell both sides when the engine expects range-bound movement and premium is rich.',
  },
  {
    condition: 'NEUTRAL + LOW_IV',
    built: 'Long Straddle',
    why: 'Buy both sides when the signal is neutral but premium is cheap enough to buy volatility.',
  },
]

const signalFlags = [
  { name: 'BULLISH', logic: 'Bias is Bullish or Mildly Bullish, and confidence is at least 20%.' },
  { name: 'BEARISH', logic: 'Bias is Bearish or Mildly Bearish, and confidence is at least 20%.' },
  { name: 'NEUTRAL', logic: 'Neither BULLISH nor BEARISH is true.' },
  { name: 'HIGH_IV', logic: 'IV Rank is 50 or higher.' },
  { name: 'LOW_IV', logic: 'IV Rank is below 50.' },
]

const scoringRules = [
  { label: 'Signal fit', points: '40 pts', desc: 'Matches directional bias, IV regime, confidence, and MACD confirmation.' },
  { label: 'Structure', points: '30 pts', desc: 'Rewards positive expected value, reasonable risk/reward, and strong credit collected.' },
  { label: 'Liquidity', points: '20 pts', desc: 'Penalizes wide bid/ask spreads and weak open interest across legs.' },
  { label: 'IV fit', points: '10 pts', desc: 'Favors selling premium in higher IV and buying premium in lower IV.' },
]

const filters = [
  'Options are limited to a tradeable strike range around the current price.',
  'Expiry is selected around the chosen weeks-out setting, with a one-week tolerance.',
  'Credit spreads target roughly 25 delta short legs; iron condors target roughly 20 delta short legs.',
  'Credit trades warn when collected premium is below 25% of spread width.',
  'Trades with both failed liquidity and failed credit checks are rejected before ranking.',
  'The final list is sorted by total score and capped to the top six recommendations.',
]

const checklistItems = [
  {
    name: 'IV Environment',
    desc: 'Checks whether you are selling premium in high-IV conditions or buying premium in low-IV conditions. A mismatch (e.g. buying a long call when IV Rank > 70) is a hard fail — the trade starts at a premium disadvantage.',
    hardFail: true,
  },
  {
    name: 'Directional Bias',
    desc: 'Confirms the strategy aligns with the engine\'s directional read. A bearish long call or a bullish long put are flagged. Weak confidence (< 30%) triggers a warning.',
    hardFail: false,
  },
  {
    name: 'Trend Alignment',
    desc: 'Checks if price is on the right side of the 20-day and 50-day moving averages for the strategy direction. Three out of four alignment checks must pass to avoid a soft fail.',
    hardFail: false,
  },
  {
    name: 'RSI',
    desc: 'For bullish trades: RSI should not be overbought (> 75). For bearish trades: RSI should not be oversold (< 25). A "caution zone" (60–75 for bullish, 25–40 for bearish) earns a warning.',
    hardFail: false,
  },
  {
    name: 'MACD',
    desc: 'Requires MACD histogram to confirm strategy direction. A confirmed crossover scores a pass; a diverging signal scores a soft fail.',
    hardFail: false,
  },
  {
    name: 'DTE Window',
    desc: 'Ensures days-to-expiry are in the 14–56 day sweet spot. Under 14 DTE is a hard fail (theta risk too high). Over 56 DTE earns a warning (premium decay is slow).',
    hardFail: true,
  },
  {
    name: 'Liquidity',
    desc: 'All legs must pass the liquidity filter (open interest ≥ 100 and bid/ask spread ≤ 5% of mid). A complete liquidity failure is a hard fail.',
    hardFail: true,
  },
  {
    name: 'Risk/Reward',
    desc: 'Credit spreads need R/R ≤ 3:1. Debit spreads need R/R ≤ 4:1. Failing this threshold earns a soft fail.',
    hardFail: false,
  },
  {
    name: 'Expected Value',
    desc: 'EV = (PoP × max_profit) − (prob_max_loss × max_loss). Negative EV is a hard fail regardless of other conditions.',
    hardFail: true,
  },
  {
    name: 'Probability of Profit',
    desc: 'PoP < 50% earns a soft fail. PoP in the 50–60% range earns a warning. Strategies with PoP ≥ 60% pass.',
    hardFail: false,
  },
]

const verdictRules = [
  {
    verdict: 'GO',
    color: 'text-emerald-400',
    badge: 'bg-emerald-900/40 border-emerald-700 text-emerald-300',
    icon: <CheckCircle2 size={15} />,
    desc: 'No hard fails, zero soft fails, and fewer than 3 warnings. This is the cleanest setup the engine can find.',
  },
  {
    verdict: 'CAUTION',
    color: 'text-amber-400',
    badge: 'bg-amber-900/40 border-amber-700 text-amber-300',
    icon: <AlertTriangle size={15} />,
    desc: 'No hard fails, but 1 soft fail or 3+ warnings. The trade is structurally valid but has at least one notable risk factor.',
  },
  {
    verdict: 'NO GO',
    color: 'text-red-400',
    badge: 'bg-red-900/40 border-red-700 text-red-300',
    icon: <XCircle size={15} />,
    desc: 'One or more hard fails, or 2+ soft fails. The trade does not pass minimum quality thresholds — skip or wait for better conditions.',
  },
]

const glossaryTerms = [
  { term: 'IV Rank', def: 'Current implied volatility as a percentile of its 52-week range. 0 = lowest IV in a year, 100 = highest. Above 50 is "elevated".' },
  { term: 'IV Percentile', def: 'Fraction of days in the past year where IV was below today\'s level. Similar to IV Rank but uses day count rather than range.' },
  { term: 'Delta', def: 'Rate of change in option price per $1 move in the stock. A delta of 0.25 means the option gains ~$0.25 for each $1 move up.' },
  { term: 'DTE', def: 'Days to expiration. The engine targets 21–45 DTE for credit spreads; the sweet spot for theta decay vs. time to be right.' },
  { term: 'Net Credit', def: 'For spread trades, the cash collected upfront (premium received minus premium paid). This is your maximum profit on a credit spread.' },
  { term: 'Spread Width', def: 'Distance between the two strike prices of a vertical spread. A $5-wide Bull Put Spread has a spread width of 5.' },
  { term: 'Expected Value (EV)', def: '(PoP × max profit) − (Prob of max loss × max loss). Positive EV means the trade has a mathematical edge over many repetitions.' },
  { term: 'PoP', def: 'Probability of Profit — the engine\'s estimate of the likelihood the trade expires with any profit, based on delta and structure.' },
  { term: 'Breakeven', def: 'The stock price at expiry where the trade neither gains nor loses. Credit spreads have one breakeven; iron condors have two.' },
  { term: 'Theta', def: 'Time-value decay per day. Short (credit) trades benefit from theta; long (debit) trades lose to theta each day.' },
  { term: 'PCR', def: 'Put/Call Ratio — ratio of put volume to call volume. High PCR (> 1.2) is often a contrarian bullish signal; low PCR (< 0.7) is bearish.' },
  { term: 'IV Skew', def: 'Difference in IV between equidistant puts and calls. Negative skew means puts are more expensive, signaling fear; positive skew is rare.' },
  { term: 'Open Interest', def: 'Number of outstanding option contracts for a given strike/expiry. Higher OI means better liquidity and tighter spreads.' },
  { term: 'Bid/Ask Spread %', def: '(Ask − Bid) / Mid. Below 5% is acceptable; above 10% means the market maker friction will eat into your edge.' },
]

const workflowSteps = [
  {
    step: '1',
    title: 'Browse AI Radar',
    icon: <Brain size={16} />,
    color: 'text-violet-400',
    desc: 'Start in AI Radar to survey the ~60 AI/datacenter stocks organized by category (Chips, Software, Pure-Play, Data Centers, Power, Semicon Equipment, Optical Networking, Networking, Applications). Click Analyze to instantly load any ticker.',
  },
  {
    step: '2',
    title: 'Add to Watchlist',
    icon: <Star size={16} />,
    color: 'text-yellow-400',
    desc: 'Star any ticker to add it to your Watchlist. The Watchlist groups tickers by their AI Radar category and shows last price. Background refresh keeps prices and signals current every 15 minutes.',
  },
  {
    step: '3',
    title: 'Analyze in Option Advisory',
    icon: <BarChart2 size={16} />,
    color: 'text-sky-400',
    desc: 'Enter a ticker in the search bar or click any Analyze button. Set weeks-out (2–8), spread width, and strategy mode. The engine fetches live option chains and builds the best candidates for the current market regime.',
  },
  {
    step: '4',
    title: 'Review Pre-Trade Checklist',
    icon: <CheckCircle2 size={16} />,
    color: 'text-emerald-400',
    desc: 'Each recommendation shows a GO / CAUTION / NO GO verdict badge. Expand the checklist inside each card to see all 10 check items, their pass/warn/fail status, and exact entry timing and exit rules for that specific trade.',
  },
  {
    step: '5',
    title: 'Scan Trade Signals',
    icon: <Radar size={16} />,
    color: 'text-amber-400',
    desc: 'Trade Signals shows every watchlist ticker with pre-trade verdicts for all analyzed DTE windows (2w–8w). Use "Fetch All Weeks" to populate all windows in one sweep, then filter by GO / CAUTION / NO GO to find the best setups across your list.',
  },
  {
    step: '6',
    title: 'Add to Portfolio',
    icon: <Briefcase size={16} />,
    color: 'text-indigo-400',
    desc: 'Click "Add to Portfolio" on any recommendation, enter contracts and entry price. Portfolio tracks all open and closed positions, calculates P&L, and shows aggregate stats. Mark positions closed with a P&L % when you exit.',
  },
]

// ─── Components ───────────────────────────────────────────────────────────────

function InfoCard({
  icon,
  title,
  children,
  defaultOpen = true,
}: {
  icon: ReactNode
  title: string
  children: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-5 py-4 hover:bg-gray-800/40 transition-colors"
      >
        <span className="text-violet-400">{icon}</span>
        <h2 className="text-base font-bold text-white flex-1 text-left">{title}</h2>
        {open ? <ChevronDown size={16} className="text-gray-500" /> : <ChevronRight size={16} className="text-gray-500" />}
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </section>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HelpPage() {
  return (
    <div className="min-h-screen p-4 md:p-6">
      <div className="max-w-5xl mx-auto space-y-5">

        {/* Header */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-600 flex items-center justify-center shrink-0">
              <HelpCircle size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">OptionAdvisor — Documentation</h1>
              <p className="text-sm text-gray-400 mt-1 max-w-3xl">
                A systematic options engine that reads live market signals, builds strategy candidates for the current
                IV regime and directional bias, runs a 10-point pre-trade checklist, and ranks the survivors by score.
              </p>
            </div>
          </div>
        </div>

        {/* Workflow */}
        <InfoCard icon={<BookOpen size={18} />} title="How to Use OptionAdvisor — Workflow">
          <div className="grid gap-3 md:grid-cols-2">
            {workflowSteps.map(step => (
              <div key={step.step} className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4 flex gap-3">
                <div className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center shrink-0 text-xs font-bold text-gray-300">
                  {step.step}
                </div>
                <div>
                  <div className={`flex items-center gap-1.5 font-semibold text-sm mb-1 ${step.color}`}>
                    {step.icon}{step.title}
                  </div>
                  <p className="text-xs text-gray-400 leading-relaxed">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </InfoCard>

        {/* AI Radar */}
        <InfoCard icon={<Brain size={18} />} title="AI Radar">
          <div className="space-y-3 text-sm text-gray-400">
            <p>
              AI Radar tracks ~60 stocks across the AI and datacenter infrastructure theme, organized into 9 categories:
              <span className="text-gray-200"> AI Chips, AI Software, AI Pure-Play, Data Centers, AI Power,
              Semicon Equipment, Optical Networking, AI Networking, and AI Applications.</span>
            </p>
            <p>
              Each card shows a one-click Analyze button that loads the ticker directly into Option Advisory with your
              current weeks-out and spread settings. The Watchlist groups tickers using these same categories so you
              always know at a glance which theme a position belongs to.
            </p>
            <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4 mt-2">
              <div className="text-xs font-semibold text-gray-300 mb-2">Category guide</div>
              <div className="grid gap-1.5 text-xs grid-cols-1 md:grid-cols-2">
                {[
                  ['AI Chips', 'NVDA, AMD, AVGO, MRVL, ARM, MU … — companies designing AI accelerators and memory.'],
                  ['AI Software', 'MSFT, GOOGL, META, AMZN, PLTR … — hyperscalers and enterprise AI platforms.'],
                  ['AI Pure-Play', 'AI, SOUN, BBAI, IONQ, RGTI … — small-cap and speculative AI companies.'],
                  ['Data Centers', 'EQIX, DLR, DELL, VRT … — infrastructure that physically houses AI compute.'],
                  ['AI Power', 'VST, CEG, NRG, ETR … — utilities and power suppliers for AI data centers.'],
                  ['Semicon Equip', 'ASML, LRCX, KLAC, AMAT … — equipment used to fabricate AI chips.'],
                  ['Optical Networking', 'COHR, CIEN, LITE, VIAV … — high-bandwidth fiber optics connecting AI clusters.'],
                  ['AI Networking', 'ANET, CSCO, INFN … — ethernet switching and routing for AI data flows.'],
                  ['AI Applications', 'SNOW, DDOG, CRWD, PATH … — SaaS platforms running on or enabling AI.'],
                ].map(([cat, desc]) => (
                  <div key={cat} className="flex gap-2">
                    <span className="font-semibold text-gray-300 shrink-0 w-36">{cat}</span>
                    <span className="text-gray-500">{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </InfoCard>

        {/* Pre-Trade Checklist */}
        <InfoCard icon={<CheckCircle2 size={18} />} title="Pre-Trade Checklist">
          <div className="space-y-3">
            <p className="text-sm text-gray-400">
              Every recommendation is automatically run through 10 checks. Each check is either a
              <span className="text-red-400 font-semibold"> hard fail</span> (one alone triggers NO GO) or a
              <span className="text-amber-400 font-semibold"> soft fail</span> (accumulate two → NO GO; one → CAUTION).
              Warnings count toward CAUTION when there are 3 or more.
            </p>

            {/* Verdict legend */}
            <div className="grid gap-2 md:grid-cols-3">
              {verdictRules.map(v => (
                <div key={v.verdict} className={`flex items-start gap-2 border rounded-xl p-3 ${v.badge}`}>
                  <span className="shrink-0 mt-0.5">{v.icon}</span>
                  <div>
                    <div className="font-bold text-sm">{v.verdict}</div>
                    <div className="text-xs mt-0.5 opacity-80">{v.desc}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Check items table */}
            <div className="overflow-x-auto rounded-xl border border-gray-700/50 mt-1">
              <table className="w-full min-w-[580px] text-sm">
                <thead className="bg-gray-800">
                  <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-3 w-36">Check</th>
                    <th className="px-4 py-3 w-20">Type</th>
                    <th className="px-4 py-3">What It Tests</th>
                  </tr>
                </thead>
                <tbody>
                  {checklistItems.map(item => (
                    <tr key={item.name} className="border-t border-gray-700/50">
                      <td className="px-4 py-3 font-semibold text-white whitespace-nowrap">{item.name}</td>
                      <td className="px-4 py-3">
                        {item.hardFail
                          ? <span className="text-xs font-bold text-red-400 bg-red-900/30 border border-red-800 rounded px-1.5 py-0.5">Hard</span>
                          : <span className="text-xs font-bold text-amber-400 bg-amber-900/30 border border-amber-800 rounded px-1.5 py-0.5">Soft</span>
                        }
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs leading-relaxed">{item.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-gray-600 pt-1">
              Hard fail checks: IV Environment, DTE Window, Liquidity, Expected Value (negative EV).
              All other checks are soft fails or warnings.
            </p>
          </div>
        </InfoCard>

        {/* Trade Signals */}
        <InfoCard icon={<Radar size={18} />} title="Trade Signals Page">
          <div className="space-y-3 text-sm text-gray-400">
            <p>
              Trade Signals is your signal dashboard — it shows every watchlist ticker with pre-trade
              verdicts across all DTE windows (2w, 3w, 4w, 6w, 8w) at a glance.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              {[
                {
                  title: 'Coverage dots',
                  desc: 'Each ticker shows colored dots for 2w/3w/4w/6w/8w. Green = GO, amber = CAUTION, red = NO GO, gray = not yet fetched. At a glance you can see which DTE windows are tradeable.',
                },
                {
                  title: 'Fetch All Weeks',
                  desc: 'One button fires five API calls (600ms staggered) for all DTE windows simultaneously. Results are cached for 15 minutes — you only need to do this once per session per ticker.',
                },
                {
                  title: 'Week tabs',
                  desc: 'Each ticker has tabs for each fetched DTE window. Switch tabs to see the best recommendation for that window along with its full verdict breakdown.',
                },
                {
                  title: 'Filters',
                  desc: 'Filter the entire list by All / GO / CAUTION / NO GO / Not Analyzed. Use this to instantly zero in on the cleanest setups across your whole watchlist.',
                },
              ].map(item => (
                <div key={item.title} className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-3">
                  <div className="font-semibold text-gray-200 text-sm mb-1">{item.title}</div>
                  <p className="text-xs text-gray-400 leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-600 border-t border-gray-800 pt-2">
              Tip: for earnings plays, use 2w–3w windows. For position trades, use 4w–6w. For LEAPS-style plays, use 8w+.
            </p>
          </div>
        </InfoCard>

        {/* Portfolio */}
        <InfoCard icon={<Briefcase size={18} />} title="Portfolio Tracking">
          <div className="space-y-3 text-sm text-gray-400">
            <p>
              The Portfolio page tracks every position you add from a recommendation. Each entry records the full
              trade structure — strategy, legs, expiry, max profit/loss, PoP, and the stock price when you added it.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              {[
                {
                  title: 'Adding a position',
                  desc: 'Click "Add to Portfolio" inside any recommendation card. Enter the number of contracts and the actual entry credit received. The portfolio stores the theoretical max profit/loss for later reference.',
                },
                {
                  title: 'Closing a position',
                  desc: 'When you exit a trade, mark it as Closed and enter your actual P&L%. The position moves to Closed status with an exit date. Closed positions stay visible for your records.',
                },
                {
                  title: 'P&L tracking',
                  desc: 'The summary bar shows total open positions, total max risk deployed, and average PoP across open trades. These are theoretical max figures — actual P&L depends on your exit timing.',
                },
                {
                  title: 'Position sizing',
                  desc: 'One contract controls 100 shares. A $5-wide put spread sold for $1.50 credit has max profit = $150 and max loss = $350 per contract. Scale contracts conservatively relative to account size.',
                },
              ].map(item => (
                <div key={item.title} className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-3">
                  <div className="font-semibold text-gray-200 text-sm mb-1">{item.title}</div>
                  <p className="text-xs text-gray-400 leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </InfoCard>

        {/* Engine logic */}
        <InfoCard icon={<TrendingUp size={18} />} title="Trading Logic Matrix" defaultOpen={false}>
          <div className="overflow-x-auto rounded-xl border border-gray-700/50">
            <table className="w-full min-w-[680px] text-sm">
              <thead className="bg-gray-800">
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3">Condition</th>
                  <th className="px-4 py-3">Strategies Built</th>
                  <th className="px-4 py-3">Intent</th>
                </tr>
              </thead>
              <tbody>
                {strategyRules.map(rule => (
                  <tr key={rule.condition} className="border-t border-gray-700/50">
                    <td className="px-4 py-3 font-mono font-bold text-white">{rule.condition}</td>
                    <td className="px-4 py-3 font-semibold text-violet-300">{rule.built}</td>
                    <td className="px-4 py-3 text-gray-400">{rule.why}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {signalFlags.map(flag => (
              <div key={flag.name} className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-3">
                <div className="font-mono text-sm font-bold text-violet-300">{flag.name}</div>
                <div className="text-xs text-gray-400 mt-1">{flag.logic}</div>
              </div>
            ))}
          </div>
        </InfoCard>

        <InfoCard icon={<Filter size={18} />} title="Exact Build Flow" defaultOpen={false}>
          <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4 font-mono text-xs text-gray-300 overflow-x-auto">
            <pre>{`if BULLISH and LOW_IV:
  build Long Call
  build Bull Call Spread

if BEARISH and LOW_IV:
  build Long Put
  build Bear Put Spread

if HIGH_IV and not BEARISH:
  build Bull Put Spread

if HIGH_IV and not BULLISH:
  build Bear Call Spread

if NEUTRAL and HIGH_IV:
  build Iron Condor

if NEUTRAL and LOW_IV:
  build Long Straddle`}</pre>
          </div>
          <p className="text-sm text-gray-400 mt-3">
            After these candidates are built, the engine filters weak trades and ranks the survivors by score.
          </p>
        </InfoCard>

        <div className="grid gap-5 lg:grid-cols-2">
          <InfoCard icon={<SlidersHorizontal size={18} />} title="Strategy Mode Overrides" defaultOpen={false}>
            <div className="space-y-3 text-sm text-gray-400">
              <p>
                <span className="font-semibold text-gray-200">All Strategies</span> is market-driven: long/debit trades prefer low IV,
                and credit trades prefer elevated IV.
              </p>
              <p>
                <span className="font-semibold text-gray-200">Long Options</span> relaxes the IV gate so long calls, long puts,
                debit spreads, or straddles can still appear even when IV is high.
              </p>
              <p>
                <span className="font-semibold text-gray-200">Credit Spreads</span> relaxes the IV gate so premium-selling ideas
                can appear even when IV is not elevated.
              </p>
            </div>
          </InfoCard>

          <InfoCard icon={<Trophy size={18} />} title="Recommendation Score" defaultOpen={false}>
            <div className="space-y-2">
              {scoringRules.map(rule => (
                <div key={rule.label} className="flex gap-3 bg-gray-800/60 border border-gray-700/50 rounded-xl px-3 py-2">
                  <div className="w-16 shrink-0 text-violet-300 font-bold font-mono text-sm">{rule.points}</div>
                  <div>
                    <div className="text-sm font-semibold text-white">{rule.label}</div>
                    <div className="text-xs text-gray-400">{rule.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </InfoCard>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <InfoCard icon={<Filter size={18} />} title="Filters Before Ranking" defaultOpen={false}>
            <ul className="space-y-2">
              {filters.map(item => (
                <li key={item} className="flex gap-2 text-sm text-gray-400">
                  <span className="mt-2 h-1.5 w-1.5 rounded-full bg-violet-500 shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </InfoCard>

          <InfoCard icon={<Clock size={18} />} title="Caching & Refresh" defaultOpen={false}>
            <div className="space-y-3 text-sm text-gray-400">
              <p>
                Analysis results are cached for <span className="text-gray-200 font-semibold">15 minutes</span>. During that window,
                navigating back to a ticker reloads instantly from cache — no extra API calls.
              </p>
              <p>
                A background sweep runs every 15 minutes for all watchlisted tickers that have been previously analyzed.
                The sweep staggers calls 2 seconds apart to avoid flooding the data provider.
              </p>
              <p>
                Multi-week data (all 5 DTE windows) is cached separately under <span className="font-mono text-xs text-violet-300">multiWeekData</span>.
                Use the "Fetch All Weeks" button in Trade Signals to populate it. It persists across page navigations for the session.
              </p>
            </div>
          </InfoCard>
        </div>

        {/* Glossary */}
        <InfoCard icon={<BookOpen size={18} />} title="Options Glossary" defaultOpen={false}>
          <div className="grid gap-2 md:grid-cols-2">
            {glossaryTerms.map(item => (
              <div key={item.term} className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-3">
                <div className="font-semibold text-violet-300 text-sm">{item.term}</div>
                <div className="text-xs text-gray-400 mt-1 leading-relaxed">{item.def}</div>
              </div>
            ))}
          </div>
        </InfoCard>

        {/* Risk */}
        <InfoCard icon={<ShieldCheck size={18} />} title="Risk Warnings">
          <div className="space-y-3 text-sm text-gray-400">
            <div className="bg-amber-900/20 border border-amber-800/50 rounded-xl p-4">
              <div className="flex items-center gap-2 text-amber-400 font-semibold mb-2">
                <AlertTriangle size={15} />
                Important disclaimers
              </div>
              <ul className="space-y-2 text-xs">
                <li className="flex gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                  <span>The recommendation list is a systematic screen, not investment advice. Always do your own research before trading.</span>
                </li>
                <li className="flex gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                  <span>Price movement, IV changes, liquidity, assignment risk, and early exits can materially change real P&L.</span>
                </li>
                <li className="flex gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                  <span>One options contract controls 100 shares. Small premium changes can become meaningful dollar swings.</span>
                </li>
                <li className="flex gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                  <span>Defined-risk spreads cap your loss at the spread width minus credit received — but only if held to expiry. Early assignment or leg-out errors can exceed the theoretical max loss.</span>
                </li>
                <li className="flex gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                  <span>Never size a position so large that a max-loss outcome would be devastating. Risk only what you can afford to lose on any single trade.</span>
                </li>
              </ul>
            </div>
            <p className="text-xs text-gray-600 border-t border-gray-800 pt-3 text-center">
              Educational use only. Not financial advice. Options trading involves substantial risk of loss.
            </p>
          </div>
        </InfoCard>

      </div>
    </div>
  )
}
