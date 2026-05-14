import { useState, useMemo } from 'react'
import type { ReactNode } from 'react'
import {
  Search, ChevronDown, ChevronRight, Zap, TrendingUp, Briefcase,
  Activity, Layers, Shield, BarChart3, Bell, BrainCircuit, Gauge, BookOpen,
} from 'lucide-react'

interface GlossaryEntry {
  term: string
  definition: string
}

interface GlossarySection {
  id: string
  title: string
  icon: ReactNode
  entries: GlossaryEntry[]
}

const SECTIONS: GlossarySection[] = [
  {
    id: 'engine-states',
    title: 'Engine States',
    icon: <Zap size={18} />,
    entries: [
      {
        term: 'READY',
        definition: 'Setup is fully aligned. Favorable risk/reward, all checks pass. This is the signal to execute — the engine has validated direction, IV environment, liquidity, and structural quality.',
      },
      {
        term: 'GO',
        definition: 'Active execution-ready setup. The engine has confirmed all gates and the trade qualifies for entry. Typically accompanied by specific strategy recommendations and entry parameters.',
      },
      {
        term: 'WATCH',
        definition: 'Interesting setup but not fully confirmed. One or more conditions are close but not yet meeting the threshold. Monitor for confirmation — a small price move or IV shift could trigger READY.',
      },
      {
        term: 'WAIT',
        definition: 'Setup is incomplete. Avoid early entry. The engine detects the ticker is setting up for a potential move but needs a breakout, pullback, or catalyst before the risk/reward becomes favorable.',
      },
      {
        term: 'EXTENDED',
        definition: 'The move has already run significantly. Risk of chasing. Wait for a pullback or consolidation before considering entry. Extended moves often revert or stall before continuing.',
      },
      {
        term: 'AVOID',
        definition: 'Poor structure, inadequate liquidity, or unfavorable risk. Low quality setup that does not meet the engine\'s minimum thresholds. Avoid entering under current conditions.',
      },
      {
        term: 'CONFLICT',
        definition: 'Engines disagree on the setup. Mixed signals between day-trade, swing, and regular analysis engines reduce confidence. Wait for alignment before committing capital.',
      },
      {
        term: 'NO-GO',
        definition: 'Do not trade. The setup is invalid, dangerous, or fails critical gates (e.g., negative expected value, IV mismatch, or broken structure). This is a hard pass — do not override without clear reasoning.',
      },
    ],
  },
    {
      id: 'directional-bias',
      title: 'Directional Bias & Confidence',
      icon: <TrendingUp size={18} />,
      entries: [
        {
          term: 'Directional Bias',
          definition: 'The engine\'s assessment of where the stock price is likely to move. Based on trend analysis, momentum indicators, volume patterns, and market context. Possible states: Bullish (expecting up), Bearish (expecting down), Neutral (no clear direction), or Mixed (conflicting signals between timeframes).',
        },
        {
          term: 'Bias Confidence',
          definition: 'A percentage score showing how strongly the engine believes the directional setup is valid. High confidence means strong trend alignment, clear momentum, and supportive market conditions. Low confidence means mixed indicators, unclear momentum, or conflicting signals across timeframes.',
        },
        {
          term: 'High Confidence (80–100%)',
          definition: 'Very strong directional conviction. Multiple trend systems agree, momentum is aligned, and market context supports the direction. Trades with high confidence have the highest probability of following the expected path. Suitable for full-position sizing.',
        },
        {
          term: 'Moderate Confidence (60–80%)',
          definition: 'Strong directional structure exists. Momentum and market context are broadly aligned, but one or more secondary indicators are neutral or lagging. Suitable for standard position sizing with normal risk management.',
        },
        {
          term: 'Low Confidence (30–60%)',
          definition: 'A trend exists but lacks strong confirmation. Trend models may disagree, momentum may be fading, or market context may be mixed. Higher probability of false breakouts or reversals. Consider smaller size, wider strikes, or a debit spread to reduce premium outlay.',
        },
        {
          term: 'Very Low Confidence (0–30%)',
          definition: 'Very weak directional conviction. Trend models disagree, momentum is unclear or absent, and market context provides no clear signal. Higher probability of false breakouts, mean reversion, or strike pressure. Consider waiting for better conditions or using a non-directional strategy (iron condor, straddle) instead.',
        },
        {
          term: 'Why Confidence Matters for Credit Spreads',
          definition: 'Credit spreads profit when the stock stays away from the short strike. Weak directional confidence means higher uncertainty about whether the stock will breach that strike. Mitigation: choose wider OTM strikes to increase cushion, or wait for confidence to improve.',
        },
        {
          term: 'Why Confidence Matters for Long Options',
          definition: 'Long options (calls, puts, debit spreads) need a real price move to profit. Weak directional confidence means a real move is less likely — premium paid may decay to zero without a meaningful price change. Mitigation: use a debit spread instead of a naked long option to reduce cost, or wait for stronger signals.',
        },
        {
          term: 'Why Confidence Matters for Covered Calls',
          definition: 'Covered Calls perform best in mildly bullish or sideways-bullish environments. Weak directional confidence increases the chance of sharp upside breakouts (capped gains) or sudden reversals (stock loss). Mitigation: choose a higher strike to give more room, or wait for trend clarity.',
        },
        {
          term: 'Weak Conviction',
          definition: 'When the engine shows low bias confidence, treat the directional signal as unreliable. The setup may still be tradeable with a non-directional strategy (iron condor, short straddle) or by reducing position size. Avoid adding to positions when conviction is weak.',
        },
      ],
    },
    {
      id: 'trade-signals',
    title: 'Trade Signals & Verdicts',
    icon: <TrendingUp size={18} />,
    entries: [
      {
        term: 'STRONG GO',
        definition: 'Highest conviction signal. All engines align, multiple confirmations fire, and the setup has favorable risk/reward across all timeframes. Prioritize these setups.',
      },
      {
        term: 'GO',
        definition: 'Execution-ready setup with solid alignment. Primary conditions are met. Suitable for standard position sizing.',
      },
      {
        term: 'CAUTION',
        definition: 'Tradeable but with caveats. One or more secondary conditions are marginal. Consider reduced position size or a tighter stop. The edge exists but is thinner.',
      },
      {
        term: 'NO GO',
        definition: 'Setup fails critical gates. Do not enter. Common causes: negative EV, poor liquidity, wrong IV environment, or conflicting signals.',
      },
      {
        term: 'Bullish',
        definition: 'The engine expects upward price movement. Bias is Bullish or Mildly Bullish with at least 20% confidence. Calls, bull spreads, and put credit spreads are the preferred strategies.',
      },
      {
        term: 'Bearish',
        definition: 'The engine expects downward price movement. Bias is Bearish or Mildly Bearish with at least 20% confidence. Puts, bear spreads, and call credit spreads are the preferred strategies.',
      },
      {
        term: 'Neutral',
        definition: 'No clear directional bias. Neither Bullish nor Bearish confidence thresholds are met. Range-bound strategies like iron condors or long straddles (in low IV) may be appropriate.',
      },
    ],
  },
  {
    id: 'portfolio-terms',
    title: 'Portfolio Terms',
    icon: <Briefcase size={18} />,
    entries: [
      {
        term: 'WINNER',
        definition: 'A currently profitable position. The position is in positive P&L territory. Consider protecting gains with stops or partial profit-taking.',
      },
      {
        term: 'LOSER',
        definition: 'A currently losing position. The position is in negative P&L territory. Evaluate whether the original thesis still holds before deciding to hold or cut.',
      },
      {
        term: 'HOLD',
        definition: 'Maintain the current position. No action needed. The position is performing as expected and the thesis remains intact.',
      },
      {
        term: 'TRIM',
        definition: 'Reduce position size partially. Take some profits off the table while keeping a smaller position for continued upside. Reduces exposure without fully exiting.',
      },
      {
        term: 'ROLL',
        definition: 'Move an option position to a different strike price or expiration date. Used to extend duration (roll out), adjust direction (roll up/down), or manage risk before expiry.',
      },
      {
        term: 'EXIT',
        definition: 'Fully close the position. Take the current P&L and move on. Exit signals may come from stop-loss hits, thesis invalidation, or target achievement.',
      },
      {
        term: 'PROTECT PROFITS',
        definition: 'Tighten stops or reduce exposure to lock in gains. When a position moves strongly in your favor, protecting profits ensures the gains are not given back during a reversal.',
      },
      {
        term: 'AT RISK',
        definition: 'The maximum capital exposed in a position. For defined-risk trades, this is the spread width minus credit received (× 100 × contracts). For undefined risk, this must be managed actively.',
      },
      {
        term: 'NET DEBIT',
        definition: 'The amount paid to enter a position. Debit spreads (e.g., Long Call, Bull Call Spread) require upfront payment. This is your maximum risk for defined-risk debit trades.',
      },
      {
        term: 'NET CREDIT',
        definition: 'The premium received to enter a position. Credit spreads (e.g., Bull Put, Bear Call) pay you upfront but have obligation risk. The credit collected is your maximum profit.',
      },
    ],
  },
  {
    id: 'position-health',
    title: 'Position Health',
    icon: <Activity size={18} />,
    entries: [
      {
        term: 'Open',
        definition: 'Position is active and has not been closed. The trade thesis is still in play. Monitor for changes in signals or market conditions.',
      },
      {
        term: 'Closed',
        definition: 'Position has been fully exited. All contracts have been bought back (for short positions) or sold (for long positions). Final P&L is recorded.',
      },
      {
        term: 'Expiring',
        definition: 'Position is approaching expiration. Time decay accelerates in the final weeks. Decide whether to close, roll, or let expire based on the position status.',
      },
      {
        term: 'At Risk',
        definition: 'Position is moving against you and approaching the stop-loss or max loss threshold. The original thesis may be breaking down. Consider cutting losses.',
      },
      {
        term: 'Managing',
        definition: 'Active management is required. This may involve rolling, adjusting stops, adding hedges, or reducing size. Do not let this position run on autopilot.',
      },
    ],
  },
  {
    id: 'strategy-types',
    title: 'Strategy Types',
    icon: <Layers size={18} />,
    entries: [
      {
        term: 'Long Call',
        definition: 'Bullish strategy. Buy a call option with unlimited upside and defined risk (the premium paid). Best in low IV with strong bullish conviction. Breakeven: strike + premium paid.',
      },
      {
        term: 'Long Put',
        definition: 'Bearish strategy. Buy a put option with downside exposure and defined risk (the premium paid). Best in low IV with strong bearish conviction. Breakeven: strike − premium paid.',
      },
      {
        term: 'Bull Call Spread',
        definition: 'Bullish debit spread. Buy a lower-strike call and sell a higher-strike call. Defined risk (net debit paid) and defined profit (spread width − debit). Best when moderately bullish.',
      },
      {
        term: 'Bear Put Spread',
        definition: 'Bearish debit spread. Buy a higher-strike put and sell a lower-strike put. Defined risk (net debit paid) and defined profit (spread width − debit). Best when moderately bearish.',
      },
      {
        term: 'Bull Put Spread',
        definition: 'Bullish credit spread. Sell a higher-strike put and buy a lower-strike put. Collect premium upfront. Defined risk (spread width − credit). Best in high IV with bullish/neutral outlook.',
      },
      {
        term: 'Bear Call Spread',
        definition: 'Bearish credit spread. Sell a lower-strike call and buy a higher-strike call. Collect premium upfront. Defined risk (spread width − credit). Best in high IV with bearish/neutral outlook.',
      },
      {
        term: 'Iron Condor',
        definition: 'Neutral strategy. Combines a Bull Put Spread and Bear Call Spread at four strikes. Collect premium. Defined risk on both sides. Best in high IV with range-bound expectations.',
      },
      {
        term: 'Iron Butterfly',
        definition: 'Neutral strategy. Combines a Bull Put Spread and Bear Call Spread with the same short strikes. Higher credit than an Iron Condor but tighter profit range. Best when expecting minimal movement.',
      },
      {
        term: 'Covered Call',
        definition: 'Income strategy. Own 100 shares and sell an OTM call against them. Collect premium but cap upside at the strike. Best in high IV when neutral-to-slightly-bullish. Stock risk is unchanged.',
      },
      {
        term: 'Cash-Secured Put',
        definition: 'Income strategy. Sell an OTM put with cash collateral to buy 100 shares if assigned. Collect premium. Best in high IV when willing to own the stock at a discount. Effectively a limit order with income.',
      },
      {
        term: 'Debit Spread',
        definition: 'Any spread where you pay upfront (net debit). Examples: Bull Call Spread, Bear Put Spread. Risk is limited to the debit paid. Profit is capped at the spread width minus debit.',
      },
      {
        term: 'Credit Spread',
        definition: 'Any spread where you receive upfront premium (net credit). Examples: Bull Put Spread, Bear Call Spread. Risk is the spread width minus credit received. Profit is capped at the credit received.',
      },
    ],
  },
  {
    id: 'risk-terms',
    title: 'Risk Terminology',
    icon: <Shield size={18} />,
    entries: [
      {
        term: 'POP (Probability of Profit)',
        definition: 'The estimated probability that the trade will be profitable at expiration. Higher PoP means higher odds of winning but typically smaller wins. The engine requires ≥ 62% for credit spreads, ≥ 65% for income strategies, ≥ 45% for long/debit trades.',
      },
      {
        term: 'EV (Expected Value)',
        definition: 'The average profit or loss per trade if the same setup were repeated many times. Positive EV means the math favors you over the long run. The engine hard-rejects any trade with EV ≤ 0 — negative expected value is mathematically indefensible.',
      },
      {
        term: 'Edge Ratio',
        definition: 'The ratio of expected value to risk. A measure of how much edge you get per dollar at risk. Higher is better. The engine warns when EV/risk < 5% ("Thin edge").',
      },
      {
        term: 'Kelly Criterion',
        definition: 'A position sizing formula that recommends the optimal fraction of capital to risk. Kelly = PoP − (1 − PoP) / (profit/risk). The engine uses Half-Kelly by default for safety, since PoP estimates carry estimation error.',
      },
      {
        term: 'Max Loss',
        definition: 'The worst-case dollar loss for a position. For defined-risk trades (spreads): the spread width minus credit received, times 100 × contracts. For long options: the total premium paid.',
      },
      {
        term: 'Max Profit',
        definition: 'The best-case dollar gain for a position. For credit spreads: the net credit received. For debit spreads: the spread width minus debit paid. Limited in defined-risk structures.',
      },
      {
        term: 'Breakeven',
        definition: 'The underlying price at which the position neither makes nor loses money at expiration. For long calls: strike + premium paid. For credit spreads: short strike ± credit received.',
      },
      {
        term: 'Theta Decay',
        definition: 'Time decay — the daily erosion of option value as expiration approaches. Benefits sellers (credit strategies) and hurts buyers (long options). Accelerates in the final 30 days before expiry.',
      },
      {
        term: 'IV (Implied Volatility)',
        definition: 'The market\'s forecast of future price movement, expressed as an annualized percentage. Higher IV = more expensive options. Selling premium in high IV and buying premium in low IV is the core principle.',
      },
      {
        term: 'IV Rank',
        definition: 'Current implied volatility as a percentile of its 52-week range. 0 = lowest IV in a year, 100 = highest. Above 50 is "elevated" — favors selling. Below 50 favors buying.',
      },
    ],
  },
  {
    id: 'market-context',
    title: 'Market Context',
    icon: <BarChart3 size={18} />,
    entries: [
      {
        term: 'MARKET SUPPORTIVE',
        definition: 'Broad market conditions are favorable for the strategy. Trend, breadth, and volatility align to support the trade thesis. Higher confidence in directional trades.',
      },
      {
        term: 'MARKET MIXED',
        definition: 'Market conditions are mixed or neutral. Some indicators support while others conflict. Reduce position size and prefer defined-risk structures. Range-bound strategies (iron condors) may be appropriate.',
      },
      {
        term: 'RISK-ON',
        definition: 'Market environment favors risk-taking. High appetite for speculative positions. Typically characterized by rising markets, low volatility, and strong breadth. Favor bullish strategies.',
      },
      {
        term: 'RISK-OFF',
        definition: 'Market environment favors capital preservation. Reduced appetite for risk. Typically characterized by falling markets, spiking volatility, and weak breadth. Favor bearish strategies or cash.',
      },
      {
        term: 'Bull Market Regime',
        definition: 'Sustained upward trend in broad market indices. Higher probability of successful bullish strategies. Call options, bull spreads, and put credit spreads perform well.',
      },
      {
        term: 'Bear Market Regime',
        definition: 'Sustained downward trend in broad market indices. Higher probability of successful bearish strategies. Put options, bear spreads, and call credit spreads perform well.',
      },
      {
        term: 'Range-Bound / Neutral Regime',
        definition: 'Market moving sideways with no clear direction. Iron condors, iron butterflies, and short premium strategies excel. Directional trades have lower probability of success.',
      },
    ],
  },
  {
    id: 'alert-types',
    title: 'Alert Types',
    icon: <Bell size={18} />,
    entries: [
      {
        term: 'Critical Alert',
        definition: 'Action required. A position or market condition has reached a critical threshold — stop-loss hit, margin call risk, or imminent expiry. Address immediately.',
      },
      {
        term: 'Warning Alert',
        definition: 'Caution advised. A position or market condition is approaching a threshold. Review the situation and prepare to act if conditions worsen.',
      },
      {
        term: 'Profit Protection Alert',
        definition: 'A position has reached a profit target or is showing significant gains. Consider tightening stops, taking partial profits, or implementing protection strategies.',
      },
      {
        term: 'Trade Entry Alert',
        definition: 'A new setup has been identified that meets READY criteria. The engine has detected a favorable entry opportunity. Review and consider execution.',
      },
      {
        term: 'Exit Alert',
        definition: 'A position should be closed. The thesis has invalidated, a stop-loss has been triggered, or a profit target has been reached. Execute the exit plan.',
      },
      {
        term: 'Risk Alert',
        definition: 'Risk parameters have been breached. Position size exceeds limits, concentration is too high, or portfolio-level risk thresholds have been triggered. Reduce exposure.',
      },
    ],
  },
  {
    id: 'ai-guidance',
    title: 'AI Guidance Terms',
    icon: <BrainCircuit size={18} />,
    entries: [
      {
        term: 'Strong leader vs QQQ',
        definition: 'The stock is outperforming the Nasdaq 100 (QQQ). This is a bullish relative strength signal. Stocks leading the benchmark are more likely to continue trending upward.',
      },
      {
        term: 'Wait for pullback',
        definition: 'The stock has moved up and is extended. Waiting for a pullback to support or moving averages provides a better risk/reward entry. Do not chase.',
      },
      {
        term: 'Breakout territory',
        definition: 'The stock is approaching or breaking through a key resistance level. A breakout with volume confirms the move. Entering during the breakout carries momentum but also higher risk of false break.',
      },
      {
        term: 'Liquidity too thin',
        definition: 'The options chain has wide bid-ask spreads or low open interest. Execution will be difficult and slippage will eat into edge. Skip this setup and look for more liquid alternatives.',
      },
      {
        term: 'Avoid chasing extended candles',
        definition: 'The stock has moved sharply in a short period. Entering now means buying near the top of a spike. Wait for price to cool off and form a consolidation pattern.',
      },
      {
        term: 'Trend is your friend',
        definition: 'The dominant trend supports the trade direction. Trading with the trend increases probability of success. Counter-trend trades need stronger confirmation and tighter risk management.',
      },
      {
        term: 'Constructive tape',
        definition: 'The overall market price action is healthy and supportive. Steady buying, good breadth, and controlled volatility. Favorable conditions for executing the strategy.',
      },
    ],
  },
  {
    id: 'technical-metrics',
    title: 'Technical Metrics',
    icon: <Gauge size={18} />,
    entries: [
      {
        term: 'RSI (Relative Strength Index)',
        definition: 'A momentum oscillator measuring the speed and magnitude of recent price changes. Ranges from 0–100. Above 70 = overbought (potential reversal or pullback). Below 30 = oversold (potential bounce). The engine uses RSI to gauge short-term momentum extremes.',
      },
      {
        term: 'VWAP (Volume-Weighted Average Price)',
        definition: 'The average price weighted by volume over a trading session. Used intraday to gauge fair value. Price above VWAP = bullish intraday bias. Price below VWAP = bearish intraday bias. Institutions use VWAP to execute large orders without moving the market.',
      },
      {
        term: 'Volume Ratio',
        definition: 'Current volume relative to the average volume. A ratio above 1.5 indicates above-average interest and confirms the strength of a move. Low volume breakouts are more likely to fail.',
      },
      {
        term: 'DTE (Days to Expiry)',
        definition: 'The number of calendar days until an option contract expires. The engine prefers 14–56 DTE. Under 14 DTE: theta risk too high (hard fail). Over 56 DTE: premium decay is slow (warning).',
      },
      {
        term: 'PoP (Probability of Profit)',
        definition: 'The estimated likelihood that a trade will close profitably. Based on delta approximation. Higher PoP means smaller but more frequent wins. Lower PoP means larger but less frequent wins.',
      },
      {
        term: 'Distance from 200-MA',
        definition: 'The percentage difference between current price and the 200-day moving average. Positive = price above the long-term trend (bullish). Negative = price below (bearish). Extreme values (+15% or more) suggest extended moves vulnerable to mean reversion.',
      },
      {
        term: 'Distance from 52W High',
        definition: 'The percentage difference between current price and the 52-week high. Near 0% = at highs (bullish momentum). Between −0.5% and −5% = near high (watch for breakout). Below −5% = below high (neutral/bearish context). Above 0% = breaking above prior high (breakout signal).',
      },
      {
        term: 'Trend Score',
        definition: 'A composite metric combining multiple timeframe trend analysis. Higher scores indicate stronger directional alignment. Used to filter out trades where the short-term and long-term trends conflict.',
      },
      {
        term: 'Edge Score',
        definition: 'A composite quality score (0–100) combining Signal Fit, Structure, Liquidity, and IV Fit. Higher scores indicate better setups. The engine ranks recommendations by total Edge Score.',
      },
      {
        term: 'MACD (Moving Average Convergence Divergence)',
        definition: 'A trend-following momentum indicator showing the relationship between two moving averages. The engine uses MACD crossovers and histogram slope as additional confirmation signals for trade entries.',
      },
    ],
  },
]

function highlight(text: string, query: string): ReactNode {
  if (!query) return text
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'))
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <span key={i} className="bg-amber-500/20 text-amber-200 rounded px-0.5">{part}</span>
      : part
  )
}

export default function TradingGlossary() {
  const [search, setSearch] = useState('')
  const [openSections, setOpenSections] = useState<Set<string>>(() => new Set(SECTIONS.map(s => s.id)))

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return SECTIONS.map(s => ({ ...s, entries: s.entries }))
    return SECTIONS
      .map(s => ({
        ...s,
        entries: s.entries.filter(e =>
          e.term.toLowerCase().includes(q) || e.definition.toLowerCase().includes(q)
        ),
      }))
      .filter(s => s.entries.length > 0)
  }, [search])

  const toggleSection = (id: string) => {
    setOpenSections(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const resultCount = filtered.reduce((sum, s) => sum + s.entries.length, 0)

  return (
    <div className="trading-glossary-page min-h-screen px-4 py-6 md:p-6">
      <div className="max-w-4xl mx-auto space-y-5">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-600 flex items-center justify-center shrink-0">
              <BookOpen size={20} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="tcc-hero-title text-2xl font-bold tracking-tight text-heading">Trading Glossary</h1>
              <p className="text-sm text-gray-400 mt-1">
                Understand every term, signal, and metric used across the platform. Search below or browse by section.
              </p>
            </div>
          </div>
        </div>

        <div className="relative">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search glossary…"
            className="w-full rounded-xl border border-gray-700 bg-gray-900 pl-10 pr-4 py-3 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-violet-500 transition-colors"
          />
        </div>

        {search && (
          <p className="text-xs text-gray-500">
            {resultCount} result{resultCount !== 1 ? 's' : ''} for &quot;{search}&quot;
          </p>
        )}

        <div className="space-y-3">
          {filtered.map(section => {
            const isOpen = openSections.has(section.id)
            return (
              <section key={section.id} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                <button
                  onClick={() => toggleSection(section.id)}
                  className="w-full flex items-center gap-2.5 px-5 py-3.5 hover:bg-gray-800/40 transition-colors"
                >
                  <span className="text-violet-400 shrink-0">{section.icon}</span>
                  <h2 className="text-sm font-bold text-white flex-1 text-left">{section.title}</h2>
                  <span className="text-[11px] text-gray-500 font-semibold tabular-nums">{section.entries.length}</span>
                  {isOpen ? <ChevronDown size={15} className="text-gray-500 shrink-0" /> : <ChevronRight size={15} className="text-gray-500 shrink-0" />}
                </button>
                {isOpen && (
                  <div className="px-5 pb-4 space-y-1">
                    {section.entries.map(entry => (
                      <div
                        key={entry.term}
                        className="rounded-xl border border-gray-800/60 bg-gray-800/30 px-4 py-3 hover:bg-gray-800/50 transition-colors"
                      >
                        <div className="text-sm font-semibold text-violet-300 mb-1">{highlight(entry.term, search)}</div>
                        <p className="text-xs text-gray-400 leading-relaxed">{highlight(entry.definition, search)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )
          })}
        </div>

        {filtered.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-700/50 px-4 py-10 text-center">
            <p className="text-sm text-gray-500">No glossary terms match &quot;{search}&quot;</p>
            <button
              onClick={() => setSearch('')}
              className="mt-2 text-xs text-violet-400 hover:text-violet-300 transition-colors"
            >
              Clear search
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
