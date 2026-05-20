import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  HelpCircle, SlidersHorizontal, ShieldCheck, TrendingUp, Filter, Trophy,
  Brain, Star, Briefcase, ChevronDown, ChevronRight, BookOpen,
  Radar, BarChart2, AlertTriangle, CheckCircle2, XCircle, Clock,
  FlaskConical, NotebookPen, Scale, Sigma, Flame, ArrowDown, ArrowRight, Zap, LineChart,
  Menu, X, Search, Copy, LayoutDashboard, GitBranch, RefreshCw, Gauge,
  Activity, Layers, Target, Eye, ToggleLeft, Bell, List, ShieldAlert, Award, Ban,
} from 'lucide-react'
import { useApp } from '../contexts/AppContext'
import { normalizeUserRole } from '../permissions'

// ─── Nav structure ──────────────────────────────────────────────────

const NAV_SECTIONS = [
  { id: 'overview',         label: 'Platform Overview',         icon: LayoutDashboard },
  { id: 'engine-arch',      label: 'Engine Architecture',       icon: GitBranch },
  { id: 'trade-lifecycle',  label: 'Trade Lifecycle',           icon: Activity },
  { id: 'engine-states',    label: 'Engine States',             icon: Gauge },
  { id: 'execution-states', label: 'Execution States',          icon: Target },
  { id: 'day-trade',        label: 'Day Trade Engine',          icon: Zap },
  { id: 'swing-trade',      label: 'Swing Trade Engine',        icon: TrendingUp },
  { id: 'vix-reference',    label: 'VIX Reference',             icon: Activity },
  { id: 'regular-engine',   label: 'Regular Engine',            icon: SlidersHorizontal },
  { id: 'entry-guide',      label: 'Trade Entry Guide',          icon: ArrowRight },
  { id: 'options-funda',    label: 'Options Fundamentals',      icon: BookOpen },
  { id: 'strategy-glossary',label: 'Strategy Glossary',         icon: BookOpen },
  { id: 'validation',       label: 'Validation System',         icon: CheckCircle2 },
  { id: 'hard-soft-fail',   label: 'Hard Fail vs Soft Fail',    icon: XCircle },
  { id: 'ev-pop-kelly',     label: 'EV / PoP / Kelly',          icon: Sigma },
  { id: 'alerts',           label: 'Alert System',              icon: Bell },
  { id: 'range-analysis',   label: 'Range & R/R Analysis',      icon: Gauge },
  { id: 'position-mgmt',    label: 'Position Management',       icon: Briefcase },
  { id: 'market-summary',   label: 'Market Command Summary',    icon: BarChart2 },
  { id: 'portfolio',        label: 'Portfolio Philosophy',      icon: ShieldCheck },
  { id: 'ui-ux-rules',      label: 'UI/UX Design Rules',        icon: Eye },
  { id: 'faq',              label: 'FAQ',                        icon: HelpCircle },
]

// ─── Data constants (preserved from existing page) ──────────────────

const strategyRules = [
  { condition: 'BULLISH + LOW_IV', built: 'Long Call, Bull Call Spread', why: 'Buy premium when the engine has upside conviction and options are relatively cheap.' },
  { condition: 'BEARISH + LOW_IV', built: 'Long Put, Bear Put Spread', why: 'Buy downside exposure when bearish signals align and IV is not expensive.' },
  { condition: 'HIGH_IV + not BEARISH', built: 'Bull Put Spread', why: 'Sell put premium below price when IV is elevated and the signal is bullish or neutral.' },
  { condition: 'HIGH_IV + not BULLISH', built: 'Bear Call Spread', why: 'Sell call premium above price when IV is elevated and the signal is bearish or neutral.' },
  { condition: 'NEUTRAL + HIGH_IV', built: 'Iron Condor', why: 'Sell both sides when the engine expects range-bound movement and premium is rich.' },
  { condition: 'NEUTRAL + LOW_IV', built: 'Long Straddle', why: 'Buy both sides when the signal is neutral but premium is cheap enough to buy volatility.' },
  { condition: 'HIGH_IV + not BEARISH', built: 'Covered Call', why: 'Sell an OTM call against 100 shares already owned. Collects income in elevated IV; stock gains are capped at the short strike.' },
  { condition: 'HIGH_IV + not BEARISH', built: 'Covered Put (Cash-Secured Put)', why: 'Sell an OTM put with cash collateral. Collects income in elevated IV; if assigned you buy the stock at an effective discount.' },
  { condition: 'HIGH_IV + not BEARISH', built: 'Short Put (naked)', why: 'Sell an OTM put for premium without cash-securing. Requires a margin account. Profit if stock stays above the strike.' },
  { condition: 'HIGH_IV + BEARISH', built: 'Short Call (naked)', why: 'Sell an OTM call when bearish and IV is elevated. Unlimited upside risk — requires active management and margin.' },
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
  'Any trade with EV ≤ 0 is hard-rejected — negative expected value is mathematically indefensible.',
  'Trades with EV/risk < 5% receive a "Thin edge" warning and are downgraded to CAUTION — model error may erase the edge.',
  'The final list is sorted by total score and capped to the top six recommendations.',
]

const checklistItems = [
  { name: 'IV Environment', desc: 'Checks whether you are selling premium in high-IV conditions or buying premium in low-IV conditions. A mismatch (e.g. buying a long call when IV Rank > 70) is a hard fail — the trade starts at a premium disadvantage.', hardFail: true },
  { name: 'Directional Bias', desc: 'Confirms the strategy aligns with the engine\'s directional read. A bearish long call or a bullish long put are flagged. Weak confidence (< 30%) triggers a warning.', hardFail: false },
  { name: 'Trend Alignment', desc: 'Checks if price is on the right side of the 20-day and 50-day moving averages for the strategy direction. Three out of four alignment checks must pass to avoid a soft fail.', hardFail: false },
  { name: 'RSI', desc: 'For bullish trades: RSI should not be overbought (> 75). For bearish trades: RSI should not be oversold (< 25). A "caution zone" (60–75 for bullish, 25–40 for bearish) earns a warning.', hardFail: false },
  { name: 'MACD', desc: 'Requires MACD histogram to confirm strategy direction. A confirmed crossover scores a pass; a diverging signal scores a soft fail.', hardFail: false },
  { name: 'DTE Window', desc: 'Ensures days-to-expiry are in the 14–56 day sweet spot. Under 14 DTE is a hard fail (theta risk too high). Over 56 DTE earns a warning (premium decay is slow).', hardFail: true },
  { name: 'Liquidity', desc: 'All legs must pass the liquidity filter (open interest ≥ 100 and bid/ask spread ≤ 5% of mid). A complete liquidity failure is a hard fail.', hardFail: true },
  { name: 'Risk/Reward', desc: 'Credit spreads need R/R ≤ 3:1. Debit spreads need R/R ≤ 4:1. Failing this threshold earns a soft fail.', hardFail: false },
  { name: 'Expected Value', desc: 'EV = (PoP × max_profit) − (prob_max_loss × max_loss). Negative EV means the probability-weighted loss exceeds the probability-weighted gain — a hard fail. Highly liquid, efficiently priced tickers like SPY often show negative EV because the options market leaves little room for edge.', hardFail: true },
  { name: 'Income Edge (Covered strategies only)', desc: 'Replaces the EV check for Covered Calls and Covered Puts. Evaluates income yield: pass ≥ 1.0% of stock/collateral value, warn 0.6–1.0%, fail < 0.6%. Not a hard fail — income strategies are judged on yield, not speculative EV.', hardFail: false },
  { name: 'Probability of Profit', desc: 'Thresholds differ by strategy type. Credit spreads (Bull Put, Bear Call, Iron Condor): pass ≥ 62%, warn 52–62%, fail < 52%. Covered Call / Covered Put: pass ≥ 65%, warn 55–65%, fail < 55% — higher bar because the whole thesis is "stock stays away from the strike." Long / debit trades: pass ≥ 45%, warn 35–45%, fail < 35%.', hardFail: false },
]

const verdictRules = [
  { verdict: 'STATE 2: ENTRY', color: 'text-emerald-400', badge: 'bg-emerald-900/40 border-emerald-700 text-emerald-300', icon: <CheckCircle2 size={15} />, desc: 'All conditions aligned. Score ≥ 70, IV fits the strategy, all filters pass, and internal verdict is GO. Execute at the next clean entry point — no averaging, no anticipation.' },
  { verdict: 'STATE 1: SETUP', color: 'text-amber-400', badge: 'bg-amber-900/40 border-amber-700 text-amber-300', icon: <AlertTriangle size={15} />, desc: 'Conditions mostly there. Score ≥ 55 and liquidity passes, but one soft fail, thin edge, or IV mismatch remains. Monitor and prepare — do not enter yet.' },
  { verdict: 'WATCH', color: 'text-sky-400', badge: 'bg-sky-900/40 border-sky-700 text-sky-300', icon: <Eye size={15} />, desc: 'Conditions building but not ready. Score is between 40–55 or multiple filters are failing. Set alerts and re-analyze when the score reaches 70 and IV fits.' },
  { verdict: 'AVOID', color: 'text-red-400', badge: 'bg-red-900/40 border-red-700 text-red-300', icon: <XCircle size={15} />, desc: 'Hard fail present or score below 40. Internal verdict is NO GO. The trade does not pass minimum thresholds — skip entirely and wait for conditions to change.' },
]

const glossaryTerms = [
  { term: 'IV Rank', def: 'Current implied volatility as a percentile of its 52-week range. 0 = lowest IV in a year, 100 = highest. Above 50 is "elevated".' },
  { term: 'IV Percentile', def: 'Fraction of days in the past year where IV was below today\'s level. Similar to IV Rank but uses day count rather than range.' },
  { term: 'Delta', def: 'Rate of change in option price per $1 move in the stock. A delta of 0.25 means the option gains ~$0.25 for each $1 move up.' },
  { term: 'DTE', def: 'Days to expiration. The engine targets 21–45 DTE for credit spreads; the sweet spot for theta decay vs. time to be right.' },
  { term: 'Net Credit', def: 'For spread trades, the cash collected upfront (premium received minus premium paid). This is your maximum profit on a credit spread.' },
  { term: 'Spread Width', def: 'Distance between the two strike prices of a vertical spread. A $5-wide Bull Put Spread has a spread width of 5.' },
  { term: 'Expected Value (EV)', def: '(PoP × max profit) − (Prob of max loss × max loss). Positive EV means the trade has a mathematical edge repeated over many occurrences. A negative EV (e.g. "EV −$236/contract") means the probability-weighted downside exceeds the upside — the math does not favor this trade. Very liquid, efficiently priced tickers like SPY/QQQ often show negative EV because the options market is tightly arbitraged.' },
  { term: 'PoP', def: 'Probability of Profit — the engine\'s estimate of the likelihood the trade expires with any profit, based on delta and structure.' },
  { term: 'Breakeven', def: 'The stock price at expiry where the trade neither gains nor loses. Credit spreads have one breakeven; iron condors have two.' },
  { term: 'Theta', def: 'Time-value decay per day. Short (credit) trades benefit from theta; long (debit) trades lose to theta each day.' },
  { term: 'PCR', def: 'Put/Call Ratio — ratio of put volume to call volume. High PCR (> 1.2) is often a contrarian bullish signal; low PCR (< 0.7) is bearish.' },
  { term: 'IV Skew', def: 'Difference in IV between equidistant puts and calls. Negative skew means puts are more expensive, signaling fear; positive skew is rare.' },
  { term: 'Open Interest', def: 'Number of outstanding option contracts for a given strike/expiry. Higher OI means better liquidity and tighter spreads.' },
  { term: 'Bid/Ask Spread %', def: '(Ask − Bid) / Mid. Below 5% is acceptable; above 10% means the market maker friction will eat into your edge.' },
  { term: 'Covered Call', def: 'You own 100 shares and sell an OTM call against them. You collect premium income upfront. If the stock closes above the strike at expiry, your shares are "called away" at the strike price — you keep the premium plus any appreciation up to the strike. Your downside is still the stock dropping, partially cushioned by the premium received.' },
  { term: 'Covered Put (Cash-Secured Put)', def: 'You sell an OTM put and hold cash equal to (strike × 100) as collateral. You collect premium income. If the stock stays above the strike, the put expires worthless and you keep the premium. If it falls below the strike, you are assigned 100 shares at the strike price — your effective cost basis is (strike − premium received), which is a discount to where the stock was when you sold the put.' },
  { term: 'The Wheel Strategy', def: 'A compound income strategy: (1) Sell a cash-secured put. If assigned, you now own the stock. (2) Sell a covered call against those shares. If called away, you no longer own the stock — return to step 1. Each cycle collects premium and resets. Works best in high-IV environments on stocks you are comfortable owning.' },
  { term: 'Income Yield', def: 'For covered strategies, the checklist replaces EV with income yield: (net premium collected ÷ position value). Covered Call yield = premium ÷ stock price. Covered Put yield = premium ÷ cash collateral (the strike price). A 1%+ monthly yield is typically the target.' },
  { term: 'Kelly Criterion', def: 'A mathematical formula that calculates the optimal fraction of capital to risk on a trade: Kelly% = EV ÷ max_loss. The system uses Half-Kelly (÷2, capped at 20%) for safety. Example: EV=$0.20, max_loss=$3.90 → Kelly=5.1%, Half-Kelly=2.55% of capital.' },
  { term: 'Half-Kelly', def: 'The recommended position size — half of the raw Kelly fraction, capped at 20% per trade. Halving protects against estimation error in the probability inputs. Practitioners widely prefer Half-Kelly over Full-Kelly to reduce drawdowns.' },
  { term: 'Edge Ratio', def: 'EV ÷ max_loss expressed as a percentage. Measures the quality of the mathematical edge. Below 5% = "thin edge" warning (model error may erase it). Above 5% = solid edge. This is more useful than raw EV dollar amount because it normalizes across different position sizes.' },
  { term: 'Capital at Risk', def: 'The actual maximum dollar loss for your position: contracts × max_loss × 100. Shown as a % of account size in the contract picker. Turns amber above 10% and red above 20% — Kelly math says concentrating more than 20% on one trade is outside the optimal range.' },
  { term: 'EV Hard Gate', def: 'Any trade with EV ≤ 0 is automatically rejected by the engine before it reaches you. A negative-EV trade loses money in expectation over many repetitions — no amount of good signal alignment can fix negative expected value.' },
  { term: 'Short Put (Naked)', def: 'Sell a put option with no stock or cash collateral (unlike a cash-secured put). You collect the full premium but require a margin account. Profit if the stock stays above the strike. Maximum loss if the stock goes to zero. Requires active management — a disciplined stop at 2× the premium received is standard.' },
  { term: 'Short Call (Naked)', def: 'Sell a call option without owning the underlying shares (unlike a covered call). You collect premium but face theoretically unlimited loss if the stock rallies above the strike. Requires margin. Best reserved for bearish/neutral setups in elevated IV, with a hard stop at 2× the credit received. Never hold into expiry week without a clear exit plan.' },
]

const optionReference = [
  { position: 'Buy a CALL', formalName: 'Long Call', action: 'You pay to have the right to buy stock.', outlook: 'Bullish: You want the price to go UP.' },
  { position: 'Sell a CALL', formalName: 'Short Call', action: 'You write a contract and must sell stock if assigned.', outlook: 'Bearish: You want the price to stay DOWN.' },
  { position: 'Buy a PUT', formalName: 'Long Put', action: 'You pay to have the right to sell stock.', outlook: 'Bearish: You want the price to go DOWN.' },
  { position: 'Sell a PUT', formalName: 'Short Put', action: 'You write a contract and must buy stock if assigned.', outlook: 'Bullish: You want the price to stay UP.' },
]

const optionExamples = [
  { title: 'Long Call Example', setup: 'Buy 1 call for $3.00 premium.', profit: 'Profit starts above strike + $3.00. Upside is theoretically unlimited.', risk: 'Maximum loss is the $300 premium paid.', bestWhen: 'Best when you are bullish and IV is low enough that premium is not overpriced.' },
  { title: 'Long Put Example', setup: 'Buy 1 put for $2.50 premium.', profit: 'Profit starts below strike − $2.50. Downside profit grows as the stock falls.', risk: 'Maximum loss is the $250 premium paid.', bestWhen: 'Best when you are bearish and want defined-risk downside exposure.' },
  { title: 'Bull Put Spread Example', setup: 'Sell a $100 put and buy a $95 put for $1.20 net credit.', profit: 'Maximum profit is $120 if the stock stays above $100 at expiry.', risk: 'Maximum loss is $380: $5 spread width − $1.20 credit, times 100.', bestWhen: 'Best when IV is elevated and the stock is bullish or neutral.' },
  { title: 'Covered Call Example', setup: 'Own 100 shares and sell 1 OTM call for $1.50 premium.', profit: 'You keep $150 premium; upside is capped if shares are called away.', risk: 'You still carry stock downside risk, partly cushioned by the premium.', bestWhen: 'Best when you own the stock, IV is high, and you are willing to sell at the strike.' },
]

const workflowSteps = [
  { step: '1', title: 'Browse AI Radar', icon: <Brain size={16} />, color: 'text-violet-400', desc: 'Start in AI Radar to survey the ~60 AI/datacenter stocks organized by category (Chips, Software, Pure-Play, Data Centers, Power, Semicon Equip, Optical Networking, Networking, Applications). Click Analyze to instantly load any ticker.' },
  { step: '2', title: 'Add to Watchlist', icon: <Star size={16} />, color: 'text-yellow-400', desc: 'Star any ticker to add it to your Watchlist. The Watchlist groups tickers by their AI Radar category and shows last price. Background refresh keeps prices and signals current every 15 minutes.' },
  { step: '3', title: 'Analyze in Strategy Finder', icon: <BarChart2 size={16} />, color: 'text-sky-400', desc: 'Enter a ticker in the search bar or click any Analyze button. Set weeks-out (0w–6w: 0w, 1w, 2w, 4w, 6w), spread width, and strategy mode. The engine fetches live option chains and builds the best candidates for the current market regime.' },
  { step: '4', title: 'Review Pre-Trade Checklist', icon: <CheckCircle2 size={16} />, color: 'text-emerald-400', desc: 'Each recommendation card shows a state badge (STATE 2: ENTRY, STATE 1: SETUP, WATCH, AVOID) and total score. Expand the card to see the pre-trade checklist with all check items, their pass/warn/fail status, and exact entry timing and exit rules for that specific trade.' },
  { step: '5', title: 'Scan Trade Signals', icon: <Radar size={16} />, color: 'text-amber-400', desc: 'Trade Signals shows every watchlist ticker with 4-state entry ratings for analyzed DTE windows (0w, 1w, 2w, 4w, 6w). Use "Fetch All Weeks" to populate all windows in one sweep, then filter by Entry / Setup / Watch / Avoid to find the best setups across your list.' },
  { step: '6', title: 'Add to Portfolio', icon: <Briefcase size={16} />, color: 'text-indigo-400', desc: 'Click "Add to Portfolio" on any recommendation. The contract picker shows Kelly Criterion sizing — how many contracts are mathematically optimal for your account size. Kelly data (edge ratio, Half-Kelly %, capital at risk) is saved with the position so you can review your sizing discipline later.' },
  { step: '7', title: 'Backtest Lab', icon: <FlaskConical size={16} />, color: 'text-violet-400', desc: 'Run walk-forward backtests on historical signals: synthetic Black–Scholes pricing with HV-20×1.15 as an IV proxy, standard exit rules (credit/debit), equity curve, trade log, and stats. For research — not live execution.' },
  { step: '8', title: 'Trade Journal', icon: <NotebookPen size={16} />, color: 'text-sky-400', desc: 'Save real trades from an expanded recommendation via "Save to Journal". Track open MTM P&L, refresh quotes, add notes, close with exit reason, or delete. Filter by All / Open / Closed / Expired.' },
]

const aiRadarCategories = [
  { name: 'AI Chips', desc: 'NVDA, AMD, MRVL, AVGO — GPU and custom ASIC designers.' },
  { name: 'AI Software', desc: 'CRM, NOW, ADBE, ORCL — enterprise AI application layers.' },
  { name: 'AI Pure-Play', desc: 'SNOW, C3.ai, UPST, PATH — high-growth AI-native companies.' },
  { name: 'Data Centers', desc: 'EQIX, DLR, CONE, QTS — physical infrastructure for AI compute.' },
  { name: 'AI Power', desc: 'VST, CEG, TLN, GEV — energy providers for datacenter load.' },
  { name: 'Semicon Equipment', desc: 'ASML, AMAT, LRCX, KLAC — wafer fabrication equipment.' },
  { name: 'Optical Networking', desc: 'LITE, CIEN, COHR — high-speed optical interconnect.' },
  { name: 'AI Networking', desc: 'ANET, CSCO, HPE, ARista — datacenter switching and routing.' },
  { name: 'AI Applications', desc: 'MSFT, GOOGL, META, AMZN — hyperscaler AI platforms.' },
]

const positionLifecycleStates = [
  { state: 'ACTIVE', icon: <Activity size={14} />, color: 'text-emerald-400', desc: 'Position is open and performing within expected parameters.' },
  { state: 'PROFIT_TARGET', icon: <Target size={14} />, color: 'text-emerald-400', desc: 'Price has reached the profit target zone. Consider taking partial or full profits.' },
  { state: 'PROTECT', icon: <ShieldCheck size={14} />, color: 'text-amber-400', desc: 'Price approaching a key level. Tighten stops or consider protective actions.' },
  { state: 'WATCH', icon: <Eye size={14} />, color: 'text-sky-400', desc: 'Position needs monitoring. Conditions are changing.' },
  { state: 'EXIT_SOON', icon: <Clock size={14} />, color: 'text-amber-400', desc: 'Expiry approaching or thesis weakening. Plan exit.' },
  { state: 'STOP_LOSS', icon: <ShieldAlert size={14} />, color: 'text-red-400', desc: 'Stop loss triggered or at risk. Manage immediately.' },
  { state: 'ROLL_CANDIDATE', icon: <RefreshCw size={14} />, color: 'text-violet-400', desc: 'Position can be rolled forward to extend duration or adjust strikes.' },
]

const tradeLifecycleStages = [
  { stage: 'DISCOVER', subtitle: 'Find opportunities', desc: 'Browse AI Radar categories, scan Trade Signals, or load a ticker in Strategy Finder. The engine surfaces candidates based on market conditions.' },
  { stage: 'ANALYZE', subtitle: 'Evaluate setup quality', desc: 'Run the pre-trade checklist. Each trade receives a 4-state entry rating — STATE 2: ENTRY, STATE 1: SETUP, WATCH, or AVOID — backed by 10 independent validation checks.' },
  { stage: 'READY', subtitle: 'Clear to enter', desc: 'Setup quality is GOOD, execution status is READY. Entry conditions are met or imminent. Proceed with position sizing.' },
  { stage: 'EXECUTE', subtitle: 'Place the trade', desc: 'Choose contract structure in the picker. Kelly sizing determines optimal capital allocation. Add to Portfolio to track.' },
  { stage: 'MANAGE', subtitle: 'Monitor and adjust', desc: 'Track open P&L, monitor risk flags, set alerts for key levels. The engine provides live decision guidance.' },
  { stage: 'PROTECT', subtitle: 'Defend profits', desc: 'As price moves in your favor, trail stops or take partial profits. The alert system helps protect gains.' },
  { stage: 'CLOSE', subtitle: 'Exit the position', desc: 'Close at profit target, stop loss, or expiry. Record exit reason in Trade Journal for post-trade review.' },
]

const engineStateCards = [
  { state: 'GO', tone: 'bg-emerald-500/15 text-emerald-300 border-emerald-600/40', def: 'All conditions met. The trade is actionable with full confidence.', when: 'Appears when no hard fails, zero soft fails, edge ratio ≥ 5%, and < 5 warnings.', interpret: 'Proceed with standard position sizing. Entry conditions are favorable.', next: 'Execute the trade. Monitor entry timing.' },
  { state: 'READY', tone: 'bg-emerald-500/15 text-emerald-300 border-emerald-600/40', def: 'Trade setup is sound and execution timing is aligned.', when: 'The engine has validated all checks and entry conditions appear met.', interpret: 'The setup is worth taking. Follow the execution plan.', next: 'Enter on confirmation. Follow suggested strategy and sizing.' },
  { state: 'WATCH', tone: 'bg-sky-500/15 text-sky-300 border-sky-600/40', def: 'Trend direction is established but entry timing needs confirmation.', when: 'Bias aligns with position but a confirmation trigger is still needed.', interpret: 'The direction is right but waiting for a better entry point is prudent.', next: 'Set alerts for confirmation triggers. Do not enter without them.' },
  { state: 'WAIT', tone: 'bg-amber-500/15 text-amber-300 border-amber-600/40', def: 'Setup is constructive but entry is not yet ready.', when: 'Trend may still be intact but conditions to enter are not met.', interpret: 'A quality entry requires patience. Forcing a trade here risks poor execution.', next: 'Wait for pullback, breakout confirmation, or improved conditions.' },
  { state: 'EXTENDED', tone: 'bg-amber-500/15 text-amber-300 border-amber-600/40', def: 'Price has moved significantly from a key level. Chasing risk is high.', when: 'Price is > 5% from MA20 or RSI is overbought/oversold, or momentum is extreme.', interpret: 'The move already happened. Entering now means buying near the top or selling near the bottom.', next: 'Wait for mean reversion or consolidation before considering entry.' },
  { state: 'AVOID', tone: 'bg-rose-500/15 text-rose-300 border-rose-700/40', def: 'Risk factors outweigh potential reward. Recommended to skip.', when: 'Hard fails detected, earnings imminent, or VIX extreme.', interpret: 'The trade has material risk factors that make it unsafe to enter.', next: 'Remove from consideration. Re-evaluate after conditions change.' },
  { state: 'NO GO', tone: 'bg-rose-500/15 text-rose-300 border-rose-700/40', def: 'Trade does not pass minimum quality thresholds.', when: 'One or more hard fails, 2+ soft fails, or negative EV.', interpret: 'The math does not support this trade. Even with a good bias, the risk-adjusted outlook is poor.', next: 'Skip entirely. Find a better setup.' },
  { state: 'CONFLICT', tone: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-600/40', def: 'Engines disagree on direction or suitability.', when: 'Day trade engine, swing engine, and regular strategy engine produce conflicting signals.', interpret: 'Different timeframes and methodologies give opposing reads. Resolution requires deeper analysis.', next: 'Review the conflict resolution panel. Use the tiebreaker logic or wait for alignment.' },
]

const execStateCards = [
  { state: 'ENTER NOW', tone: 'bg-emerald-500/15 text-emerald-300 border-emerald-600/40', def: 'Entry conditions are confirmed. The trade can be placed immediately.', when: 'All confirmation triggers met, no warnings, good liquidity.' },
  { state: 'WAIT FOR VWAP HOLD', tone: 'bg-amber-500/15 text-amber-300 border-amber-600/40', def: 'Price needs to establish support at or above VWAP before entry.', when: 'Intraday: price is testing VWAP from below for long entries.' },
  { state: 'WAIT FOR BREAKOUT', tone: 'bg-amber-500/15 text-amber-300 border-amber-600/40', def: 'Waiting for price to break and hold above a resistance level.', when: 'Price is approaching a key level but has not yet cleared it with volume.' },
  { state: 'WAIT FOR PULLBACK', tone: 'bg-amber-500/15 text-amber-300 border-amber-600/40', def: 'Price is extended. Waiting for a retracement to a better entry level.', when: '5d momentum > 5% or distance to MA20 > 5%.' },
  { state: 'ENTRY CONDITIONAL', tone: 'bg-sky-500/15 text-sky-300 border-sky-600/40', def: 'Entry requires specific conditions to be met before placement.', when: 'Multiple confirmation triggers are defined and not yet satisfied.' },
  { state: 'AVOID CHASE', tone: 'bg-rose-500/15 text-rose-300 border-rose-700/40', def: 'Price has moved too far too fast. Do not enter at current levels.', when: '5d momentum exceeds hard threshold or gap is too large.' },
  { state: 'NO CLEAN ENTRY', tone: 'bg-gray-700/50 text-gray-400 border-gray-600/40', def: 'No viable entry point exists at current prices.', when: 'Entry quality check fails all categories.' },
]

// ─── Helpers ────────────────────────────────────────────────────────

function SectionLink({ id, label, icon: Icon, active }: { id: string; label: string; icon: React.ElementType; active: boolean }) {
  return (
    <a
      href={`#${id}`}
      onClick={e => {
        e.preventDefault()
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
      }}
      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
        active
          ? 'bg-violet-500/15 text-violet-300 border border-violet-500/25'
          : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50 border border-transparent'
      }`}
    >
      <Icon size={14} className="shrink-0" />
      <span className="truncate">{label}</span>
    </a>
  )
}

function DocCard({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900/60 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-gray-800/30 transition-colors"
      >
        <span className="text-violet-400 shrink-0">{icon}</span>
        <h3 className="text-sm font-bold text-white flex-1 text-left">{title}</h3>
        {open ? <ChevronDown size={14} className="text-gray-600" /> : <ChevronRight size={14} className="text-gray-600" />}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </section>
  )
}

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/60 px-3 py-2.5 text-center">
      <div className="text-lg font-bold text-white">{value}</div>
      <div className="text-[10px] text-gray-500 font-medium">{label}</div>
    </div>
  )
}

function FormulaBlock({ formula }: { formula: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="relative group">
      <pre className="bg-gray-950/80 border border-gray-800 rounded-lg px-4 py-3 text-xs font-mono text-gray-300 overflow-x-auto whitespace-pre-wrap">{formula}</pre>
      <button
        type="button"
        onClick={() => { navigator.clipboard.writeText(formula); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
        className="absolute top-2 right-2 rounded-md p-1.5 text-gray-600 hover:text-gray-300 hover:bg-gray-800 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        {copied ? <CheckCircle2 size={12} className="text-emerald-400" /> : <Copy size={12} />}
      </button>
    </div>
  )
}

function BadgePill({ text, cls }: { text: string; cls: string }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${cls}`}>{text}</span>
}

function BadgeDot({ tone }: { tone: 'green' | 'amber' | 'red' | 'sky' | 'violet' | 'gray' }) {
  const colors = { green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-rose-500', sky: 'bg-sky-500', violet: 'bg-violet-500', gray: 'bg-gray-500' }
  return <span className={`inline-block w-2 h-2 rounded-full ${colors[tone]} shrink-0`} />
}

// ─── Options fundamentals helpers ────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-1.5">
      <span className="text-gray-500 font-semibold shrink-0 w-[72px] text-right text-[10px]">{label}:</span>
      <span className="text-gray-400 text-[10px] leading-relaxed">{value}</span>
    </div>
  )
}

function PayoffSvg({ type }: { type: string }) {
  const w = 200, h = 80
  const profitClr = 'var(--color-emerald-400, #34d399)'
  const lossClr = 'var(--color-rose-400, #fb7185)'
  const profitBg = 'rgba(52,211,153,0.08)'
  const lossBg = 'rgba(251,113,133,0.08)'
  const markerClr = 'var(--color-violet-400, #a78bfa)'

  const axes = (
    <>
      <line x1="15" y1={h-10} x2={w-5} y2={h-10} stroke="var(--color-gray-700, #374151)" strokeWidth="0.5" />
      <line x1="20" y1="10" x2="20" y2={h-10} stroke="var(--color-gray-700, #374151)" strokeWidth="0.5" />
      <line x1="20" y1={h/2} x2={w-5} y2={h/2} stroke="var(--color-gray-600, #4b5563)" strokeWidth="0.5" strokeDasharray="2,2" />
    </>
  )

  const dash = (x: number, color: string) => (
    <line x1={x} y1={h-10} x2={x} y2={15} stroke={color} strokeWidth="0.5" strokeDasharray="2,1.5" opacity={0.6} />
  )

  const path = (d: string, color: string) => (
    <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
  )

  const area = (d: string, color: string) => (
    <path d={d} fill={color} />
  )

  const styles = { maxHeight: 80 } as const

  const go = (children: React.ReactNode) => (
    <svg viewBox="0 0 200 80" className="w-full h-auto" style={styles}>{axes}{children}</svg>
  )

  switch (type) {
    case 'long-call': {
      const sx = 60
      return go(<>
        {dash(sx, markerClr)}
        {area(`M20,50 L${sx},50 L160,15 L160,50 Z`, profitBg)}
        {path(`M20,50 L${sx},50 L160,15`, profitClr)}
        <text x={sx} y={76} fontSize="6" textAnchor="middle" fill={markerClr}>Strike</text>
        <text x={175} y={54} fontSize="6" textAnchor="end" fill={profitClr}>+</text>
      </>)
    }
    case 'long-put': {
      const sx = 60
      return go(<>
        {dash(sx, markerClr)}
        {area(`M160,50 L${sx},50 L20,15 L20,50 Z`, profitBg)}
        {path(`M160,50 L${sx},50 L20,15`, profitClr)}
        <text x={sx} y={76} fontSize="6" textAnchor="middle" fill={markerClr}>Strike</text>
        <text x={25} y={54} fontSize="6" textAnchor="start" fill={profitClr}>+</text>
      </>)
    }
    case 'covered-call': {
      const sx = 80
      return go(<>
        {dash(sx, markerClr)}
        {area(`M20,50 L20,35 L${sx},35 L${sx},15 L160,15 L160,50 Z`, profitBg)}
        {path(`M20,50 L20,35 L${sx},35 L${sx},15 L160,15`, profitClr)}
        {area(`M20,50 L20,65 L160,65 Z`, lossBg)}
        {path(`M20,50 L20,65 L160,65`, lossClr)}
        <text x={sx} y={76} fontSize="6" textAnchor="middle" fill={markerClr}>Capped</text>
        <text x={25} y={73} fontSize="5" textAnchor="start" fill={lossClr}>stock risk</text>
      </>)
    }
    case 'cash-secured-put': {
      const sx = 80
      return go(<>
        {dash(sx, markerClr)}
        {area(`M20,15 L${sx},15 L${sx},50 L20,50 Z`, profitBg)}
        {path(`M20,15 L${sx},15 L${sx},50 L160,50`, profitClr)}
        {area(`M${sx},50 L${sx},65 L160,65 Z`, lossBg)}
        {path(`M${sx},50 L${sx},65 L160,65`, lossClr)}
        <text x={sx} y={76} fontSize="6" textAnchor="middle" fill={markerClr}>Strike</text>
      </>)
    }
    case 'bull-call-spread': {
      const ln = 45, sh = 95
      return go(<>
        {dash(ln, profitClr)}
        {dash(sh, markerClr)}
        {area(`M${ln},50 L${sh},20 L160,20 L160,50 Z`, profitBg)}
        {path(`M20,50 L${ln},50 L${sh},20 L160,20`, profitClr)}
        <text x={ln} y={76} fontSize="5" textAnchor="middle" fill={profitClr}>Long</text>
        <text x={sh} y={76} fontSize="5" textAnchor="middle" fill={markerClr}>Short</text>
      </>)
    }
    case 'bear-put-spread': {
      const ln = 95, sh = 45
      return go(<>
        {dash(sh, markerClr)}
        {dash(ln, lossClr)}
        {area(`M${sh},20 L${ln},50 L160,50 L160,20 Z`, profitBg)}
        {path(`M20,20 L${sh},20 L${ln},50 L160,50`, profitClr)}
        <text x={sh} y={76} fontSize="5" textAnchor="middle" fill={markerClr}>Short</text>
        <text x={ln} y={76} fontSize="5" textAnchor="middle" fill={lossClr}>Long</text>
      </>)
    }
    case 'bull-put-spread': {
      const sh = 45, ln = 95
      return go(<>
        {dash(sh, profitClr)}
        {dash(ln, markerClr)}
        {area(`M20,15 L${sh},15 L${ln},50 L20,50 Z`, profitBg)}
        {path(`M20,15 L${sh},15 L${ln},50 L160,50`, profitClr)}
        <text x={sh} y={76} fontSize="5" textAnchor="middle" fill={profitClr}>Short</text>
        <text x={ln} y={76} fontSize="5" textAnchor="middle" fill={markerClr}>Long</text>
      </>)
    }
    case 'bear-call-spread': {
      const sh = 45, ln = 95
      return go(<>
        {dash(sh, markerClr)}
        {dash(ln, lossClr)}
        {area(`M20,50 L${sh},50 L${ln},15 L160,15 L160,50 Z`, profitBg)}
        {path(`M20,50 L${sh},50 L${ln},15 L160,15`, profitClr)}
        <text x={sh} y={76} fontSize="5" textAnchor="middle" fill={markerClr}>Short</text>
        <text x={ln} y={76} fontSize="5" textAnchor="middle" fill={lossClr}>Long</text>
      </>)
    }
    case 'iron-condor': {
      const ps = 25, pl = 55, cl = 65, cs = 95
      return go(<>
        {dash(ps, markerClr)}
        {dash(cs, markerClr)}
        {dash(pl, profitClr)}
        {dash(cl, lossClr)}
        {area(`M${ps},50 L${pl},15 L${cl},15 L${cs},50 Z`, profitBg)}
        {path(`M20,50 L${ps},50 L${pl},15 L${cl},15 L${cs},50 L160,50`, profitClr)}
        <text x={(ps+pl)/2} y={76} fontSize="4" textAnchor="middle" fill={markerClr}>Puts</text>
        <text x={(cl+cs)/2} y={76} fontSize="4" textAnchor="middle" fill={markerClr}>Calls</text>
      </>)
    }
    case 'butterfly': {
      const lx = 25, mx = 60, rx = 95
      return go(<>
        {dash(lx, markerClr)}
        {dash(mx, 'var(--color-violet-400, #a78bfa)')}
        {dash(rx, markerClr)}
        {area(`M${lx},50 L${mx},15 L${rx},50 Z`, profitBg)}
        {path(`M20,50 L${lx},50 L${mx},15 L${rx},50 L160,50`, profitClr)}
        <text x={mx} y={76} fontSize="5" textAnchor="middle" fill="#a78bfa">ATM</text>
      </>)
    }
    case 'long-straddle': {
      const sx = 60
      return go(<>
        {dash(sx, markerClr)}
        {area(`M20,50 L${sx},50 L160,50 Z`, profitBg)}
        {area(`M20,15 L${sx},50 L20,50 Z`, lossBg)}
        {area(`M160,15 L${sx},50 L160,50 Z`, profitBg)}
        {path(`M20,15 L${sx},50 L160,15`, profitClr)}
        <text x={sx} y={76} fontSize="6" textAnchor="middle" fill={markerClr}>ATM</text>
        <text x={15} y={55} fontSize="5" textAnchor="start" fill={profitClr}>+</text>
        <text x={185} y={55} fontSize="5" textAnchor="end" fill={profitClr}>+</text>
      </>)
    }
    default:
      return <div className="text-[10px] text-gray-600 text-center py-2">Payoff diagram</div>
  }
}

function lineAxis(w: number, h: number) {
  return (
    <>
      <line x1="15" y1={h-10} x2={w-5} y2={h-10} stroke="var(--color-gray-700, #374151)" strokeWidth="0.5" />
      <line x1="20" y1="10" x2="20" y2={h-10} stroke="var(--color-gray-700, #374151)" strokeWidth="0.5" />
      <line x1="20" y1={h/2} x2={w-5} y2={h/2} stroke="var(--color-gray-600, #4b5563)" strokeWidth="0.5" strokeDasharray="2,2" />
    </>
  )
}

function strikeLine(x: number, h: number, color: string) {
  return <line x1={x} y1={h-10} x2={x} y2={15} stroke={color} strokeWidth="0.5" strokeDasharray="2,1.5" opacity={0.6} />
}

// ─── Page ───────────────────────────────────────────────────────────

export default function HelpPage({ embedded }: { embedded?: boolean }) {
  const { user, canAccessPage } = useApp()
  const isAdmin = normalizeUserRole(user?.role) === 'admin'
  const canDay   = canAccessPage('day-trade')
  const canSwing = canAccessPage('swing-trade')
  const visibleNavSections = NAV_SECTIONS.filter(s =>
    s.id !== 'day-trade' && s.id !== 'swing-trade'
      ? true
      : s.id === 'day-trade' ? canDay : canSwing
  )
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [activeSection, setActiveSection] = useState('overview')
  const [searchQuery, setSearchQuery] = useState('')
  const mainRef = useRef<HTMLDivElement>(null)
  const tickingRef = useRef(false)

  useEffect(() => {
    if (embedded) return
    const handleScroll = () => {
      if (tickingRef.current) return
      tickingRef.current = true
      requestAnimationFrame(() => {
        const offset = 120
        for (const s of [...visibleNavSections].reverse()) {
          const el = document.getElementById(s.id)
          if (el && el.getBoundingClientRect().top <= offset) {
            setActiveSection(s.id)
            break
          }
        }
        tickingRef.current = false
      })
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [embedded])

  const filteredNav = useMemo(() => {
    if (!searchQuery) return visibleNavSections
    const q = searchQuery.toLowerCase()
    return visibleNavSections.filter(s => s.label.toLowerCase().includes(q))
  }, [searchQuery, visibleNavSections])

  // Preserve the role check (keep ai-radar section hidden for finance accounts)
  const showAiRadar = true // Help is open-docs

  const sidebarContent = (
    <div className="p-4 border-b border-gray-800">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-violet-600 flex items-center justify-center shrink-0">
          <HelpCircle size={15} className="text-white" />
        </div>
        <span className="text-sm font-bold text-white">OptionAdvisor Docs</span>
      </div>
      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600" />
        <input
          type="text"
          placeholder="Search docs..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="w-full rounded-lg bg-gray-900 border border-gray-800 pl-8 pr-3 py-1.5 text-xs text-gray-300 placeholder:text-gray-600 focus:outline-none focus:border-violet-500/50"
        />
      </div>
    </div>
  )

  const sidebarNav = (
    <nav className="p-3 space-y-1">
      {filteredNav.map(s => (
        <SectionLink
          key={s.id}
          id={s.id}
          label={s.label}
          icon={s.icon}
          active={activeSection === s.id}
        />
      ))}
    </nav>
  )

  const sidebarFooter = (
    <div className="p-3 border-t border-gray-800 mt-2">
      <div className="text-[10px] text-gray-600 leading-relaxed">
        OptionAdvisor v2.0<br />
        Institutional documentation
      </div>
    </div>
  )

  return (
    <div className={`help-page ${embedded ? 'flex' : 'min-h-screen'}`}>
      {!embedded && (
        <>
          {/* Mobile sidebar toggle */}
          <button
            type="button"
            onClick={() => setSidebarOpen(v => !v)}
            className="fixed bottom-6 left-4 z-50 flex h-11 w-11 items-center justify-center rounded-xl bg-violet-600 text-white shadow-lg hover:bg-violet-500 transition-colors lg:hidden"
          >
            {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
          </button>

          {/* Mobile overlay */}
          {sidebarOpen && (
            <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setSidebarOpen(false)} />
          )}

          {/* ── Sidebar ─────────────────────────────────────────────── */}
          <aside className={`fixed top-0 left-0 z-50 h-full w-60 bg-gray-950 border-r border-gray-800 overflow-y-auto transition-transform duration-200 lg:translate-x-0 ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}>
            {sidebarContent}
            {sidebarNav}
            {sidebarFooter}
          </aside>
        </>
      )}

      {embedded && (
        <>
          {/* Embedded sidebar: sticky, not fixed */}
          <aside className="hidden lg:block sticky top-0 w-60 shrink-0 h-[calc(100svh-8rem)] overflow-y-auto bg-gray-950/80 border-r border-gray-800 rounded-l-2xl">
            {sidebarContent}
            {sidebarNav}
            {sidebarFooter}
          </aside>
          {/* Mobile sidebar toggle for embedded */}
          <button
            type="button"
            onClick={() => setSidebarOpen(v => !v)}
            className="lg:hidden fixed bottom-6 left-4 z-50 flex h-11 w-11 items-center justify-center rounded-xl bg-violet-600 text-white shadow-lg hover:bg-violet-500 transition-colors"
          >
            {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          {sidebarOpen && (
            <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setSidebarOpen(false)} />
          )}
          <aside className={`lg:hidden fixed top-0 left-0 z-50 h-full w-60 bg-gray-950 border-r border-gray-800 overflow-y-auto transition-transform duration-200 ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}>
            {sidebarContent}
            {sidebarNav}
            {sidebarFooter}
          </aside>
        </>
      )}

      {/* ── Main content ────────────────────────────────────────── */}
      <div ref={mainRef} className={embedded ? 'flex-1 min-w-0' : 'lg:ml-60 min-h-screen'}>
        <div className="max-w-4xl mx-auto px-4 py-6 md:px-6 md:py-8 space-y-8">

          {/* ═══════════════════════════════════════════════════════
             HERO
             ═══════════════════════════════════════════════════════ */}
          <section className="rounded-2xl border border-gray-800 bg-gray-900/80 p-6 md:p-8">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-violet-600 flex items-center justify-center shrink-0">
                <HelpCircle size={22} className="text-white" />
              </div>
              <div>
                <h1 className="tcc-hero-title text-2xl font-bold tracking-tight text-heading">OptionAdvisor Trading Engine Documentation</h1>
                <p className="text-sm text-gray-400 mt-1 max-w-2xl">
                  AI-assisted execution, validation, risk scoring, and portfolio intelligence framework.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <StatCard value="10" label="Validation Checks" />
              <StatCard value="3" label="Engine Types" />
              <StatCard value="15+" label="Strategies" />
              <StatCard value="Real-time" label="Execution Logic" />
              <StatCard value="Risk-Aware" label="Positioning" />
            </div>
          </section>

          {/* ═══════════════════════════════════════════════════════
             SECTION 1 — PLATFORM OVERVIEW
             ═══════════════════════════════════════════════════════ */}
          <section id="overview" className="scroll-mt-24">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <LayoutDashboard size={18} className="text-violet-400" />
              Platform Overview
            </h2>

            <div className="grid gap-3 sm:grid-cols-2">
              <DocCard icon={<BarChart2 size={15} />} title="Trade Command Center">
                <p className="text-xs text-gray-400 leading-relaxed">Macro market view showing regime detection, VIX risk, sector heat, and aggregated execution opportunities across all engines. The central dashboard for market awareness.</p>
              </DocCard>
              <DocCard icon={<Star size={15} />} title="Signal Feed">
                <p className="text-xs text-gray-400 leading-relaxed">Unified trade monitoring with readiness filtering. Aggregates Day Trade, Swing Trade, and Regular engine outputs. Filter by verdict, risk, and engine type.</p>
              </DocCard>
              <DocCard icon={<Briefcase size={15} />} title="Positions Center">
                <p className="text-xs text-gray-400 leading-relaxed">Live position management with P&L tracking, lifecycle monitoring, and decision guidance. Each position shows its current state (ACTIVE, PROFIT_TARGET, EXIT_SOON, etc.) with actionable next steps.</p>
              </DocCard>
              <DocCard icon={<Zap size={15} />} title="Day Trade Engine">
                <p className="text-xs text-gray-400 leading-relaxed">Intraday execution logic using VWAP, opening range breakouts, and live momentum. Generates structured strategy recommendations with entry timing and risk levels.</p>
              </DocCard>
              <DocCard icon={<TrendingUp size={15} />} title="Swing Trade Engine">
                <p className="text-xs text-gray-400 leading-relaxed">Multi-day momentum setups using daily OHLCV analysis (MA20/MA50, RSI, MACD, volume trends). Provides entry quality grades, risk assessment, and structured playbooks.</p>
              </DocCard>
              <DocCard icon={<SlidersHorizontal size={15} />} title="Strategy Finder">
                <p className="text-xs text-gray-400 leading-relaxed">Options structure discovery and analysis. Enter a ticker, set parameters (weeks-out, spread width, strategy mode), and the engine builds the best candidates for the current market regime.</p>
              </DocCard>
            </div>

            {/* Workflow steps */}
            <div className="mt-4">
              <h3 className="text-sm font-semibold text-gray-200 mb-3">Recommended Workflow</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {workflowSteps.map(s => (
                  <div key={s.step} className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-3 flex gap-3">
                    <div className="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center shrink-0 text-[10px] font-bold text-gray-300">{s.step}</div>
                    <div>
                      <div className={`flex items-center gap-1 text-xs font-semibold mb-0.5 ${s.color}`}>{s.icon}{s.title}</div>
                      <p className="text-[11px] text-gray-400 leading-relaxed">{s.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ═══════════════════════════════════════════════════════
             SECTION 2 — ENGINE ARCHITECTURE
             ═══════════════════════════════════════════════════════ */}
          <section id="engine-arch" className="scroll-mt-24">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <GitBranch size={18} className="text-violet-400" />
              Engine Architecture
            </h2>

            {/* Visual flow */}
            <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4 mb-4">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-600 mb-3">Decision Pipeline</div>
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                {['Market Context', 'Signal Engine', 'Validation Engine', 'Execution Timing', 'Risk Filters', 'Strategy Selection', 'Final Verdict'].map((step, i) => (
                  <div key={step} className="flex items-center gap-1.5">
                    <span className="rounded-lg border border-gray-700/60 bg-gray-800/60 px-2.5 py-1.5 text-gray-300 font-medium">{step}</span>
                    {i < 6 && <ChevronRight size={12} className="text-gray-700" />}
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <DocCard icon={<Gauge size={15} />} title="Trade Quality Score">
                <p className="text-xs text-gray-400 leading-relaxed">A 0–10 score combining bull/bear signal strength, market context adjustments, extension penalties, and IV/earnings modifiers. Scores ≥ 7 indicate strong setups; scores &lt; 5 trigger NO TRADE.</p>
              </DocCard>
              <DocCard icon={<Target size={15} />} title="Execution Timing">
                <p className="text-xs text-gray-400 leading-relaxed">Separates trend quality from entry timing. A strong trend can still have WAIT execution if price is extended or confirmation is needed. This prevents chasing moves.</p>
              </DocCard>
              <DocCard icon={<Brain size={15} />} title="Confidence Scoring">
                <p className="text-xs text-gray-400 leading-relaxed">Aggregates MA alignment, MACD confirmation, RSI health, volume participation, and VIX context into a composite confidence percentage. Higher confidence does not guarantee profit — it indicates signal consistency.</p>
              </DocCard>
              <DocCard icon={<ShieldCheck size={15} />} title="Risk State">
                <p className="text-xs text-gray-400 leading-relaxed">Derived from risk flags (extension, earnings, IV extremes, VIX, liquidity) and market context. Modifies position sizing guidance and verdict eligibility. HIGH risk states reduce trade quality scores.</p>
              </DocCard>
            </div>

            {/* Three engines */}
            <div className="mt-4 rounded-xl border border-gray-800 bg-gray-900/60 p-4">
              <h3 className="text-xs font-semibold text-gray-200 mb-3">Three Independent Engines</h3>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-gray-800 bg-black/20 px-3 py-3">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400 mb-1"><Zap size={13} /> Day Trade</div>
                  <p className="text-[11px] text-gray-400 leading-relaxed">Intraday VWAP and ORB logic. 0–1 day holds. Quotes and 1-min/5-min bars. Verdicts: STRONG BUY / BUY / HOLD / AVOID.</p>
                </div>
                <div className="rounded-lg border border-gray-800 bg-black/20 px-3 py-3">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-sky-400 mb-1"><TrendingUp size={13} /> Swing Trade</div>
                  <p className="text-[11px] text-gray-400 leading-relaxed">Daily OHLCV multi-day analysis. 2–5 day holds. MA20/MA50, RSI, MACD, momentum, volume, SPY/QQQ context. Decision quality layer adds entry/risk grading.</p>
                </div>
                <div className="rounded-lg border border-gray-800 bg-black/20 px-3 py-3">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-violet-400 mb-1"><SlidersHorizontal size={13} /> Regular Engine</div>
                  <p className="text-[11px] text-gray-400 leading-relaxed">Strategic options structures (spreads, covered calls, condors). Portfolio-aware with Black-Scholes EV, Kelly sizing, and multi-leg validation.</p>
                </div>
              </div>
            </div>
          </section>

          {/* ═══════════════════════════════════════════════════════
             SECTION 3 — TRADE LIFECYCLE
             ═══════════════════════════════════════════════════════ */}
          <section id="trade-lifecycle" className="scroll-mt-24">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Activity size={18} className="text-violet-400" />
              Trade Lifecycle
            </h2>

            <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4 mb-4">
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                {tradeLifecycleStages.map((t, i) => (
                  <div key={t.stage} className="flex items-center gap-1.5">
                    <div className="rounded-lg border border-gray-700/60 bg-gray-800/60 px-2.5 py-1.5">
                      <div className="text-[10px] font-bold text-gray-200">{t.stage}</div>
                    </div>
                    {i < tradeLifecycleStages.length - 1 && <ChevronRight size={11} className="text-gray-700" />}
                  </div>
                ))}
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {tradeLifecycleStages.map(t => (
                  <div key={t.stage} className="rounded-lg bg-gray-800/40 border border-gray-700/50 px-3 py-2">
                    <div className="text-[10px] font-bold text-gray-300">{t.stage}</div>
                    <div className="text-[10px] text-gray-500 mb-0.5">{t.subtitle}</div>
                    <p className="text-[10px] text-gray-400 leading-relaxed">{t.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Position lifecycle states */}
            <DocCard icon={<Briefcase size={15} />} title="Position Lifecycle States">
              <div className="grid gap-2 sm:grid-cols-2">
                {positionLifecycleStates.map(p => (
                  <div key={p.state} className="flex items-start gap-2.5 rounded-lg bg-gray-800/40 border border-gray-700/50 px-3 py-2">
                    <span className={p.color}>{p.icon}</span>
                    <div>
                      <div className="text-[11px] font-bold text-gray-200">{p.state}</div>
                      <p className="text-[10px] text-gray-400 leading-relaxed">{p.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </DocCard>
          </section>

          {/* ═══════════════════════════════════════════════════════
             SECTION 4 — ENGINE STATES
             ═══════════════════════════════════════════════════════ */}
          <section id="engine-states" className="scroll-mt-24">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Gauge size={18} className="text-violet-400" />
              Engine States
            </h2>
            <p className="text-xs text-gray-500 mb-4">Each state represents a distinct verdict from the engine. States determine whether a trade is actionable, needs monitoring, or should be avoided.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {engineStateCards.map(e => (
                <div key={e.state} className="rounded-xl border border-gray-800 bg-gray-900/60 px-4 py-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${e.tone}`}>{e.state}</span>
                  </div>
                  <p className="text-xs text-gray-300 leading-relaxed">{e.def}</p>
                  <div className="text-[10px] text-gray-500 space-y-0.5">
                    <div><span className="text-gray-600 font-semibold">When:</span> {e.when}</div>
                    <div><span className="text-gray-600 font-semibold">Interpretation:</span> {e.interpret}</div>
                    <div><span className="text-gray-600 font-semibold">Next action:</span> {e.next}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ═══════════════════════════════════════════════════════
             SECTION 5 — EXECUTION STATES
             ═══════════════════════════════════════════════════════ */}
          <section id="execution-states" className="scroll-mt-24">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Target size={18} className="text-violet-400" />
              Execution States
            </h2>
            <p className="text-xs text-gray-500 mb-4">Execution states describe entry timing specifically. A trade can have a strong bias (BULLISH) but still show WAIT execution if the market has not yet provided a clean entry.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {execStateCards.map(e => (
                <div key={e.state} className="rounded-xl border border-gray-800 bg-gray-900/60 px-4 py-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${e.tone}`}>{e.state}</span>
                  </div>
                  <p className="text-xs text-gray-300 leading-relaxed mb-1">{e.def}</p>
                  <div className="text-[10px] text-gray-500">
                    <span className="text-gray-600 font-semibold">When:</span> {e.when}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-lg border border-gray-800 bg-amber-950/20 px-4 py-3 text-[11px] text-amber-200/90 leading-relaxed">
              <span className="font-semibold">Signal quality vs. entry timing:</span> A trade can be fundamentally sound (good bias, good structure) but lack an actionable entry. The engine always evaluates both dimensions independently. Strong signal + poor timing = WAIT.
            </div>
          </section>

          {/* ═══════════════════════════════════════════════════════
             SECTION 6 — DAY TRADE ENGINE
             ═══════════════════════════════════════════════════════ */}
          <section id="day-trade" className="scroll-mt-24">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Zap size={18} className="text-violet-400" />
              Day Trade Engine
            </h2>
            <div className="space-y-3">

              <DocCard icon={<Zap size={15} />} title="Overview & Verdict Scale">
                <p className="text-xs text-gray-400 leading-relaxed mb-3">
                  Intraday scoring engine using 1-minute RTH bars (9:30–16:00 ET). Produces a <strong className="text-gray-200">bull score</strong> and
                  <strong className="text-gray-200"> bear score</strong>. Net edge + margin determines the verdict.
                </p>
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  {['STRONG GO', 'GO', 'WATCH', 'WAIT', 'NO-GO'].map((v, i, a) => (
                    <div key={v} className="flex items-center gap-2">
                      <span className="rounded-lg bg-gray-800/60 border border-gray-700/50 px-2 py-1 font-mono font-bold text-gray-200">{v}</span>
                      {i < a.length - 1 && <ChevronRight size={11} className="text-gray-700" />}
                    </div>
                  ))}
                </div>
              </DocCard>

              <DocCard icon={<Activity size={15} />} title="Step 1: Data Fetch">
                <div className="space-y-2 text-xs text-gray-400">
                  <div className="space-y-1">
                    <p><strong className="text-gray-300">Source:</strong> Yahoo Finance 1-minute bars, last 5 days, auto-adjusted</p>
                    <p><strong className="text-gray-300">Minimum bars:</strong> 25 (MIN_BARS)</p>
                    <p><strong className="text-gray-300">Session:</strong> Most recent calendar day with RTH bars</p>
                  </div>
                </div>
              </DocCard>

              <DocCard icon={<Layers size={15} />} title="Step 2: Indicators Computed">
                <div className="space-y-4 text-xs text-gray-400">

                  <div className="rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2.5 space-y-1.5">
                    <div className="font-semibold text-gray-200 text-[11px]">2a. VWAP</div>
                    <p>Cumulative volume-weighted average price from session open:</p>
                    <ul className="space-y-0.5 pl-3 text-gray-500">
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-gray-600 shrink-0" /><span>TP = (High + Low + Close) / 3</span></li>
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-gray-600 shrink-0" /><span>VWAP[bar i] = Σ(TP × Volume)[0..i] / Σ(Volume)[0..i]</span></li>
                    </ul>
                    <p className="text-gray-500">Zero-volume bars contribute 0. If all volume is zero → VWAP signals suppressed.</p>
                  </div>

                  <div className="rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2.5 space-y-1.5">
                    <div className="font-semibold text-gray-200 text-[11px]">2b. VWAP Slope</div>
                    <p>Linear regression over last 15 bars of the VWAP series:</p>
                    <FormulaBlock formula="x = [0, 1, 2, ..., 14]\nslope = polyfit(x, VWAP[-15:], degree=1)[0]\nvwap_slope_pct = slope / VWAP_last × 100" />
                    <p className="text-gray-500">Thresholds: <span className="font-mono text-gray-300">&gt;+0.001%/bar</span> = rising, <span className="font-mono text-gray-300">&lt;-0.001%/bar</span> = declining, else flat.</p>
                  </div>

                  <div className="rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2.5 space-y-1.5">
                    <div className="font-semibold text-gray-200 text-[11px]">2c. Opening Range (OR)</div>
                    <p>OR window: first 15 bars (OR_MINUTES) of the session</p>
                    <ul className="space-y-0.5 pl-3 text-gray-500">
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-gray-600 shrink-0" /><span>OR High = max(High) over bars 0..14</span></li>
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-gray-600 shrink-0" /><span>OR Low = min(Low) over bars 0..14</span></li>
                    </ul>
                    <p className="text-gray-400 mt-1"><strong className="text-gray-300">or_state:</strong> "above" if last &gt; OR High, "below" if last &lt; OR Low, "inside" otherwise.</p>
                    <p className="text-gray-400"><strong className="text-gray-300">or_historical:</strong> tracks whether price <em>ever</em> broke the OR during the session (flag: broke out then retraced).</p>
                  </div>

                  <div className="rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2.5 space-y-1.5">
                    <div className="font-semibold text-gray-200 text-[11px]">2d. Momentum (30-bar window)</div>
                    <p><span className="font-mono text-gray-300">mom_bars = min(30, len(session) - 1)</span></p>
                    <p><span className="font-mono text-gray-300">momentum_pct = (last / close[-mom_bars] − 1) × 100</span></p>
                    <p className="text-gray-500">At 1 bar/minute this covers the last ~30 minutes of price movement.</p>
                  </div>

                  <div className="rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2.5 space-y-1.5">
                    <div className="font-semibold text-gray-200 text-[11px]">2e. Volume Spike</div>
                    <p>Baseline: mean volume of mid-session bars (after OR, excluding final bar):</p>
                    <ul className="space-y-0.5 pl-3 text-gray-500">
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-gray-600 shrink-0" /><span>avg_vol = mean(Volume[15 : -1])</span></li>
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-gray-600 shrink-0" /><span>vol_spike = (last_bar_volume &ge; 1.55 × avg_vol)</span></li>
                    </ul>
                  </div>

                </div>
              </DocCard>

              <DocCard icon={<Sigma size={15} />} title="Step 3: Scoring">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wide text-gray-600 border-b border-gray-800">
                        <th className="px-2 py-1.5 font-semibold">#</th>
                        <th className="px-2 py-1.5 font-semibold">Signal</th>
                        <th className="px-2 py-1.5 font-semibold">Condition</th>
                        <th className="px-2 py-1.5 font-semibold">Points</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ['1', 'VWAP position', 'price > VWAP', 'bull += 2.0'],
                        ['1a', 'VWAP slope up', 'rising (&gt;+0.001%/bar)', 'bull += 0.5'],
                        ['1b', 'VWAP slope down', 'declining (&lt;-0.001%/bar)', 'bull −= 0.5'],
                        ['2', 'OR breakout (confirmed)', 'or_state=above + vol_spike', 'bull += 3.0'],
                        ['2', 'OR breakout (unconfirmed)', 'or_state=above, no spike', 'bull += 1.0'],
                        ['3', 'Momentum', 'mom_pct &gt; +0.12%', 'bull += 1.5'],
                        ['4', 'Volume spike', 'vol &gt; 1.55× avg', 'bull += 1.5'],
                        ['5', 'RS vs QQQ', 'outperforms QQQ &ge;+0.5%', 'bull += 1.0'],
                        ['5a', 'RS squeeze guard', 'RS&ge;+0.5% but SPY+QQQ down &ge;0.5%', 'bull += 0.5'],
                        ['6', 'SPY session', 'SPY &ge; +0.25%', 'bull += 0.5'],
                        ['7', 'VIX caution', 'VIX &ge; 30.0', 'bull −= 0.5 (floor 0)'],
                        ['8', 'Daily trend aligns', 'swing GO aligns with bias', 'bull += 0.5'],
                        ['8a', 'Daily trend conflict', 'swing GO opposes bias', 'bull −= 0.5'],
                      ].map(r => (
                        <tr key={r[0] + r[1]} className="border-b border-gray-800/40 text-[11px]">
                          <td className="px-2 py-1.5 font-mono text-violet-300">{r[0]}</td>
                          <td className="px-2 py-1.5 font-semibold text-gray-200">{r[1]}</td>
                          <td className="px-2 py-1.5 text-gray-400">{r[2]}</td>
                          <td className="px-2 py-1.5 font-mono text-emerald-300">{r[3]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-gray-500 mt-2">Bear side mirrors: same rules flipped (price below VWAP, below OR Low, negative momentum, etc.)</p>
              </DocCard>

              <DocCard icon={<Gauge size={15} />} title="Step 4: Verdict Logic">
                <div className="space-y-3 text-xs text-gray-400">
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      { label: 'GO_THRESHOLD', value: '4.5' },
                      { label: 'MARGIN_GO', value: '2.75' },
                      { label: 'STRONG_BULL', value: '7.0' },
                      { label: 'STRONG_DIFF', value: '4.0' },
                      { label: 'VIX_NO_GO', value: '40.0' },
                      { label: 'VIX_CAUTION', value: '30.0' },
                    ].map(t => (
                      <div key={t.label} className="flex items-center justify-between rounded-lg bg-gray-800/40 px-3 py-1.5">
                        <code className="text-[10px] font-mono text-violet-300">{t.label}</code>
                        <span className="text-[11px] font-bold text-gray-200 font-mono">{t.value}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-gray-400"><strong className="text-gray-200">soft_edge</strong> = max(bull, bear) &ge; 4.5 AND |bull − bear| &ge; 2.75</p>
                  <div className="rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2">
                    <p className="font-semibold text-gray-200 text-[11px] mb-1">Vetoes (checked first):</p>
                    <ul className="space-y-0.5 text-gray-500">
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-red-500 shrink-0" />VIX &ge; 40 → NO-GO</li>
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-red-500 shrink-0" />bull&gt;bear + SPY &le; −1.2% → NO-GO</li>
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-red-500 shrink-0" />bear&gt;bull + SPY &ge; +1.2% → NO-GO</li>
                    </ul>
                  </div>
                  <div className="rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2">
                    <p className="font-semibold text-gray-200 text-[11px] mb-1">If soft_edge + long bias:</p>
                    <ul className="space-y-0.5 text-gray-500">
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-emerald-500 shrink-0" />vol_spike + bull &ge; 7.0 + diff &ge; 4.0 → STRONG GO</li>
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-emerald-500 shrink-0" />vol_spike + below STRONG threshold → GO</li>
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-amber-500 shrink-0" />no vol_spike → WATCH</li>
                    </ul>
                    <p className="text-gray-500 mt-1">If not soft_edge → WAIT</p>
                  </div>
                </div>
              </DocCard>

              <DocCard icon={<FlaskConical size={15} />} title="Step 5: Full Worked Example (NVDA, Bullish Day)">
                <div className="space-y-3 text-xs text-gray-400">
                  <div className="rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2 space-y-1">
                    <p className="font-semibold text-gray-200 text-[11px]">Inputs</p>
                    <p className="text-gray-500 font-mono">Last: $152.40 | VWAP: $150.80 (rising +0.0213%/bar) | OR High: $151.20 | OR Low: $149.80</p>
                    <p className="text-gray-500 font-mono">or_state: "above" | vol_spike: True (2.02×) | momentum_pct: +1.465%</p>
                    <p className="text-gray-500 font-mono">SPY: +0.45% | QQQ: +0.60% | rs_vs_qqq: +1.45% | VIX: 18.5</p>
                    <p className="text-gray-500 font-mono">daily_trend_context: bias=long, verdict=GO</p>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-[10px] uppercase tracking-wide text-gray-600 border-b border-gray-800">
                          <th className="px-2 py-1 font-semibold">Signal</th>
                          <th className="px-2 py-1 font-semibold">Points</th>
                          <th className="px-2 py-1 font-semibold">Running</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ['VWAP + slope', '2.0 + 0.5 = 2.5', 'bul 2.5'],
                          ['OR breakout (confirmed)', '3.0', 'bul 5.5'],
                          ['Momentum', '1.5', 'bul 7.0'],
                          ['Volume spike', '1.5', 'bul 8.5'],
                          ['RS vs QQQ', '1.0', 'bul 9.5'],
                          ['SPY daily', '0.5', 'bul 10.0'],
                          ['Daily trend aligns', '0.5', 'bul 10.5'],
                        ].map(r => (
                          <tr key={r[0]} className="border-b border-gray-800/40 text-[11px]">
                            <td className="px-2 py-1.5 font-semibold text-gray-200">{r[0]}</td>
                            <td className="px-2 py-1.5 font-mono text-emerald-300">{r[1]}</td>
                            <td className="px-2 py-1.5 font-mono text-gray-400">{r[2]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="rounded-lg border border-gray-800 bg-emerald-950/20 px-3 py-2">
                    <p className="font-semibold text-gray-200 text-[11px]">Result</p>
                    <p className="text-gray-400">bull = 10.5, bear = 0.0, diff = 10.5</p>
                    <p className="text-gray-400">soft_edge = True, long_edge = True, vol_spike = True</p>
                    <p className="text-gray-400">strong_ok: bull(10.5) &ge; 7.0 ✓ AND diff(10.5) &ge; 4.0 ✓</p>
                    <p className="text-emerald-400 font-bold text-[11px] mt-1">→ Verdict: STRONG GO, bias: long</p>
                  </div>

                  <div className="rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2">
                    <p className="font-semibold text-gray-200 text-[11px] mb-1">Normalized Score</p>
                    <p className="text-gray-500 font-mono">raw = 10.5, GO_THRESHOLD = 4.5, STRONG_BULL = 7.0</p>
                    <p className="text-gray-500 font-mono">raw &ge; 7.0 → norm = 85 + (10.5 − 7.0) / 2.5 × 15 = 100</p>
                    <p className="text-emerald-400 font-bold text-[11px] mt-1">→ Normalized score: 100</p>
                  </div>
                </div>
              </DocCard>

              <DocCard icon={<Layers size={15} />} title="4-State Trading System & Entry Authorization">
                <div className="space-y-3 text-xs text-gray-400">
                  <p>The Day Trade engine now organizes the trade lifecycle into four deterministic states with an entry authorization rule:</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      { state: '🟡 SETUP', desc: 'Watch / Prepare. Bias forming, key levels identified. No entry allowed. Must define trigger before advancing.' },
                      { state: '🟢 ENTRY', desc: 'Execution Gate. Breakout confirmation required (break & hold above breakout level, sustained above ORH or VWAP). Entry only if trigger is active — no averaging, no anticipation.' },
                      { state: '🔵 ACTIVE', desc: 'Management Mode. Position held with trail (ORH/VWAP), partial exit at TP, add on strength. Focus is capital protection + trend continuation.' },
                      { state: '🔴 EXIT', desc: 'Completion / Reset. Stop hit, target hit, or structure broken. No hope holding. Reset to SETUP.' },
                    ].map(c => (
                      <div key={c.state} className="rounded-lg bg-gray-800/40 border border-gray-700/50 px-3 py-2">
                        <div className="font-semibold text-gray-200 text-[11px]">{c.state}</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">{c.desc}</div>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-lg border border-emerald-800/30 bg-emerald-950/10 px-3 py-2">
                    <p className="font-semibold text-emerald-300 text-[11px]">Entry Authorization Rule</p>
                    <p className="text-gray-400 text-[10px] mt-1">System executes (READY) only when setup quality is STRONG/GOOD, execution readiness is READY, risk is LOW/MEDIUM, and structure is confirmed (or_breakout != "inside"). When all gates pass, pending confirmations are cleared and the system stops saying "wait."</p>
                  </div>
                </div>
              </DocCard>

              <DocCard icon={<FlaskConical size={15} />} title="STATE 3 Walkthrough — AMD Long Breakout Example">
                <div className="space-y-3 text-xs text-gray-400">
                  <p>When the engine advances to STATE 3 (IN-PLAY) on a long setup, the panel shows three execution instructions. Here is how to read each one using a real AMD setup.</p>

                  <div className="rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2 space-y-1">
                    <p className="font-semibold text-gray-200 text-[11px]">Setup snapshot</p>
                    <p className="font-mono text-gray-500">Bias: LONG · VWAP $446.18 · ORH $447.58</p>
                    <p className="font-mono text-gray-500">Action at trigger: break &amp; hold above ORH $447.58</p>
                  </div>

                  <div className="space-y-2">
                    {[
                      {
                        label: 'HOLD LONG',
                        color: 'text-emerald-400',
                        desc: 'Bias is long. The confirmed trade direction is long — not short. This field flips to HOLD SHORT on bearish setups.',
                      },
                      {
                        label: 'TP $459.19',
                        color: 'text-emerald-400',
                        desc: 'Measured-move target — calculated from the opening range size projected above ORH. Scale out or fully exit here. In this case ~$11.61 above the ORH trigger.',
                      },
                      {
                        label: 'trail ORH $447.58',
                        color: 'text-sky-400',
                        desc: 'Your trailing stop is the opening range high. Once you enter above $447.58, that level becomes support. If AMD closes back below $447.58, the breakout has failed — exit. You trail the structural level, not a fixed pip stop.',
                      },
                      {
                        label: 'add on strength above $446.18',
                        color: 'text-amber-400',
                        desc: '$446.18 is VWAP. If AMD pulls back toward VWAP after the breakout and then bounces with a confirmation candle, that retest is your lower-risk add-on entry. You are adding at a tighter level while the ORH confirms as support above.',
                      },
                    ].map(r => (
                      <div key={r.label} className="rounded-lg bg-gray-800/40 border border-gray-700/50 px-3 py-2">
                        <div className={`font-mono font-bold text-[11px] ${r.color}`}>{r.label}</div>
                        <div className="text-[10px] text-gray-400 mt-0.5 leading-relaxed">{r.desc}</div>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2 space-y-1 font-mono text-[10px] text-gray-500">
                    <p className="font-semibold text-gray-200 text-[11px] font-sans">Full trade sequence</p>
                    <p>VWAP &nbsp; $446.18 &nbsp; ← secondary add-on level (pullback + bounce)</p>
                    <p>ORH &nbsp;&nbsp; $447.58 &nbsp; ← primary entry trigger / trailing stop</p>
                    <p>TP &nbsp;&nbsp;&nbsp; $459.19 &nbsp; ← measured-move target, scale out here</p>
                  </div>

                  <div className="rounded-lg border border-amber-800/30 bg-amber-950/10 px-3 py-2">
                    <p className="font-semibold text-amber-300 text-[11px]">Key rule</p>
                    <p className="text-[10px] text-gray-400 mt-0.5 leading-relaxed">The $1.40 gap between VWAP and ORH is your risk window. If AMD closes back below ORH after entry, stop out immediately — do not wait for it to reach VWAP. The trail is ORH, not VWAP.</p>
                  </div>
                </div>
              </DocCard>

              <DocCard icon={<Activity size={15} />} title="Signal Improvements (13 Additions)">
                <div className="space-y-2 text-xs text-gray-400">
                  <p>Engine updates added the following signals and scoring improvements:</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      { label: 'VWAP Band', desc: '±0.15% band around VWAP. Inside band = "testing," not "above/below." Distance-proportional scoring replaces binary check. VWAP_TEST state added.' },
                      { label: 'OR Re-test', desc: 'Pullback holding ORH after breakout detected. +0.75 bull bonus. New ENTRY_RETEST state bypasses WAIT_FOR_VOLUME.' },
                      { label: 'HH/HL Structure', desc: '5-bar swing point scan for higher highs/lows (bull) or lower lows/highs (bear). +0.75 bonus for confirmed structure.' },
                      { label: 'Volume Median', desc: 'Baseline switched from mean to np.median. Single anomalous burst no longer inflates baseline and suppresses spike detection.' },
                      { label: 'Pre-market Gap', desc: 'Uses previousClose and session open. Gap ≥1% directional bonus (+0.5). Gap fill proximity detected and reverses bonus.' },
                      { label: 'OR Width', desc: '(or_high − or_low) / price × 100. Narrow (&lt;0.4%) = coiling +0.5 breakout bonus. Wide (&gt;1.5%) = −0.25 both sides.' },
                      { label: 'RVOL', desc: 'Cumulative session volume vs time-adjusted avg daily volume. ≥2.5× → +1.0, ≥1.5× → +0.5, below → noted.' },
                      { label: 'Dual VWAP Slope', desc: 'Micro 15-bar + macro 60-bar slopes. Macro aligned with bias → +0.5. Against bias → −0.5 structural caution.' },
                      { label: 'Time-of-Day', desc: 'Four session phases (Opening, Mid-Morning, Midday, Power Hour). Midday: −0.25. Power Hour: −0.5 + EOD exit note.' },
                      { label: 'Adaptive Momentum', desc: 'Window adapts: 15 bars (&lt;60 in session), 30 bars (60–180), 45 bars (&gt;180). Avoids open-to-now noise early.' },
                      { label: 'Secondary Breakout', desc: 'Counts distinct OR crossings. Second crossing with vol spike → +1.0. Higher conviction than first breakout.' },
                      { label: 'False-Positive NO-GO Veto', desc: 'Compound veto fires when: OR never broken (contained) + RVOL < 0.75× + market bearish (SPY & QQQ both ≤ −0.25%). Prevents bullish CALL signal when the actual breakout trigger has never fired.' },
                      { label: 'Bounce-Rejection Tiers', desc: 'After ORL breakdown, the engine detects WHERE a bounce gets rejected. VWAP rejection scores bear +1.2 (more bearish than ORL retest). See "Bounce-Rejection Entry Tiers" card below.' },
                    ].map(c => (
                      <div key={c.label} className="rounded-lg bg-gray-800/40 border border-gray-700/50 px-3 py-2">
                        <div className="font-semibold text-gray-200 text-[11px]">{c.label}</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">{c.desc}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </DocCard>

              <DocCard icon={<Layers size={15} />} title="Bounce-Rejection Entry Tiers (After ORL Breakdown)">
                <div className="space-y-3 text-xs text-gray-400">
                  <p>
                    After a breakdown below ORL, price often bounces. <strong className="text-gray-200">Where</strong> the bounce gets rejected
                    determines the entry tier, stop placement, and target size. The engine detects four states via{' '}
                    <code className="font-mono text-violet-300 text-[10px]">bounce_scenario</code>:
                  </p>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-[10px] uppercase tracking-wide text-gray-600 border-b border-gray-800">
                          <th className="px-2 py-1.5 font-semibold">Scenario</th>
                          <th className="px-2 py-1.5 font-semibold">Meaning</th>
                          <th className="px-2 py-1.5 font-semibold">Bear</th>
                          <th className="px-2 py-1.5 font-semibold">Entry</th>
                          <th className="px-2 py-1.5 font-semibold">Stop</th>
                          <th className="px-2 py-1.5 font-semibold">Target</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ['vwap_rejection', 'Bounce capped at VWAP (sellers stepped in early)', '+1.2', 'Near VWAP', 'Just above VWAP +0.2%', 'ORL'],
                          ['orl_rejection_retest', 'Bounce reached ORL, now rejected', '+0.8', 'Near ORL', 'Just above ORL +0.2%', 'Below day low'],
                          ['no_mans_land', 'Churning between VWAP and ORL', '—', 'WAIT', 'No clean stop', '—'],
                          ['vwap_test', 'Approaching VWAP, volume unconfirmed', '—', 'WAIT', '—', '—'],
                        ].map(r => (
                          <tr key={r[0]} className="border-b border-gray-800/40 text-[11px]">
                            <td className="px-2 py-1.5 font-mono text-violet-300">{r[0]}</td>
                            <td className="px-2 py-1.5 text-gray-400">{r[1]}</td>
                            <td className="px-2 py-1.5 font-mono text-rose-300">{r[2]}</td>
                            <td className="px-2 py-1.5 text-gray-300">{r[3]}</td>
                            <td className="px-2 py-1.5 text-gray-400">{r[4]}</td>
                            <td className="px-2 py-1.5 text-gray-400">{r[5]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="rounded-lg border border-amber-800/30 bg-amber-950/10 px-3 py-2.5 space-y-1.5">
                    <p className="font-semibold text-amber-300 text-[11px]">Key insight — VWAP rejection is MORE bearish, not less</p>
                    <p className="text-[10px] text-gray-400 leading-relaxed">
                      When sellers are so aggressive that they reject a bounce <em>before</em> it even reaches ORL, that's a sign of heavy
                      selling pressure — stronger than a bounce that gets all the way to ORL. The engine scores <code className="font-mono text-violet-300">vwap_rejection</code> at
                      bear +1.2 vs <code className="font-mono text-violet-300">orl_rejection_retest</code> at +0.8 to reflect this.
                    </p>
                  </div>

                  <div className="rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2.5 space-y-1">
                    <p className="font-semibold text-gray-200 text-[11px]">Detection thresholds</p>
                    <ul className="space-y-0.5 pl-3 text-gray-500 text-[10px]">
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-gray-600 shrink-0" /><span><strong className="text-gray-300">VWAP rejection:</strong> or_historical = broke_down, or_state = below, price within ±0.45% of VWAP, price &gt;0.55% below ORL, vol_spike = true</span></li>
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-gray-600 shrink-0" /><span><strong className="text-gray-300">ORL retest:</strong> same breakdown conditions, price within 0.55% of ORL from below, price &gt;0.3% below VWAP</span></li>
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-gray-600 shrink-0" /><span><strong className="text-gray-300">No-man's land:</strong> price more than 0.55% below ORL AND more than 0.45% below VWAP — stuck in between, no clean level</span></li>
                    </ul>
                  </div>

                  <p className="text-[10px] text-gray-500">
                    AI Coach summary, entry condition, decision tree, and best_next_step all adapt to the active bounce scenario tier.
                    Long-side mirror logic also applies: after ORH breakout, VWAP support hold is scored bull +1.2.
                  </p>
                </div>
              </DocCard>

              <DocCard icon={<Bell size={15} />} title="Key-Level Price Alerts">
                <div className="space-y-3 text-xs text-gray-400">
                  <p>
                    Beyond WATCH→GO verdict escalation, the scanner fires <strong className="text-gray-200">level-retest alerts</strong> when
                    price approaches a key structural level with volume. These fire for both watchlist tickers and tickers
                    tracked in <strong className="text-gray-200">Track Intraday</strong>.
                  </p>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-[10px] uppercase tracking-wide text-gray-600 border-b border-gray-800">
                          <th className="px-2 py-1.5 font-semibold">Alert type</th>
                          <th className="px-2 py-1.5 font-semibold">Trigger condition</th>
                          <th className="px-2 py-1.5 font-semibold">Example title</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ['ORL Retest', 'or_historical = broke_down, or_state = below, price within 0.4% of ORL from below', '⚡ AMD — OR Low Retest (Short Re-entry)'],
                          ['ORH Retest', 'or_historical = broke_up, or_state = above, price within 0.4% of ORH from above', '⚡ NVDA — OR High Retest (Long Re-entry)'],
                          ['VWAP Test', 'Price within 0.2% of VWAP in either direction, RVOL ≥ 1.2×', '⚡ TSLA — VWAP Test (Vol 1.4×)'],
                        ].map(r => (
                          <tr key={r[0]} className="border-b border-gray-800/40 text-[11px]">
                            <td className="px-2 py-1.5 font-semibold text-gray-200 whitespace-nowrap">{r[0]}</td>
                            <td className="px-2 py-1.5 text-gray-400">{r[1]}</td>
                            <td className="px-2 py-1.5 font-mono text-amber-300 text-[10px]">{r[2]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      { label: 'Deduplication', desc: 'Each alert type fires at most once per session per ticker. The level_alert_key is persisted in the database and compared before firing. A new trading day resets all keys.' },
                      { label: 'Active Trades Coverage', desc: 'The scanner loops over open active-trade tickers (Track Intraday, opened today) after finishing the main watchlist. Tickers not on the watchlist still get level alerts.' },
                    ].map(c => (
                      <div key={c.label} className="rounded-lg bg-gray-800/40 border border-gray-700/50 px-3 py-2">
                        <div className="font-semibold text-gray-200 text-[11px]">{c.label}</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">{c.desc}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </DocCard>

              <DocCard icon={<Gauge size={15} />} title="Volume Chart — avg vol for time of day">
                <div className="space-y-3 text-xs text-gray-400">
                  <p>
                    The volume tab shows each 1-minute bar colour-coded against a yellow dashed reference line labelled
                    <strong className="text-gray-200"> avg vol for time of day</strong>.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      { label: '🟦 Cyan bar', desc: 'That bar\'s volume was at or above the historical average for this time slot (bar ≥ avg line).' },
                      { label: '⬛ Gray bar', desc: 'That bar\'s volume was below average. Most bars will be gray on low-RVOL days.' },
                      { label: '— Yellow line', desc: 'Derived from the last bar\'s RVOL: avg = last_bar_volume / rvol. Represents what "normal" volume looks like for this time of day.' },
                      { label: 'All bars below line', desc: 'Normal for low-RVOL sessions. The line near the top means the entire session ran below historical average — useful context for entry decisions.' },
                    ].map(c => (
                      <div key={c.label} className="rounded-lg bg-gray-800/40 border border-gray-700/50 px-3 py-2">
                        <div className="font-semibold text-gray-200 text-[11px]">{c.label}</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">{c.desc}</div>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2">
                    <p className="font-semibold text-gray-200 text-[11px] mb-1">Reading the chart</p>
                    <ul className="space-y-0.5 text-gray-500 text-[10px]">
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-cyan-400 shrink-0" /><span>RVOL 1.5×+: several cyan spikes visible, bars reaching or exceeding the avg line. Volume is confirming moves.</span></li>
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-gray-500 shrink-0" /><span>RVOL 0.3×: all bars gray, avg line near the top. Session volume is light — breakouts without volume spike are suspect.</span></li>
                    </ul>
                  </div>
                </div>
              </DocCard>

              <DocCard icon={<Target size={15} />} title="Confluence Zone Trading — AI Coach Strategy">
                <div className="space-y-3 text-xs text-gray-400">
                  <p>
                    The AI Coach uses <strong className="text-gray-200">Confluence Zone Trading</strong> as its core strategy.
                    A confluence zone forms when two or more key levels stack within <strong className="text-gray-200">$0.10</strong> of each other.
                  </p>

                  <div className="rounded-lg border border-amber-800/30 bg-amber-950/10 px-3 py-2.5 space-y-1.5">
                    <p className="font-semibold text-amber-300 text-[11px]">Confluence strength tiers</p>
                    <div className="grid gap-1.5 text-[10px]">
                      {[
                        { badge: 'EXTREME', color: 'bg-amber-500/20 text-amber-300', desc: '3+ levels within $0.10, OR specifically VWAP + ORL within $0.10 (highest conviction)' },
                        { badge: 'STRONG', color: 'bg-amber-500/10 text-amber-400/80', desc: 'Any 2 levels (VWAP, ORL, ORH) within $0.10 of each other' },
                        { badge: 'NONE', color: 'bg-gray-800/40 text-gray-500', desc: 'Levels spread apart — no zone, no structured entry' },
                      ].map(t => (
                        <div key={t.badge} className="flex items-start gap-2">
                          <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold ${t.color}`}>{t.badge}</span>
                          <span className="text-gray-400">{t.desc}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2.5 space-y-1.5">
                    <p className="font-semibold text-gray-200 text-[11px]">Zone role — determined by price position</p>
                    <ul className="space-y-0.5 text-[10px] text-gray-500">
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-rose-500 shrink-0" /><span><strong className="text-gray-300">RESISTANCE</strong> — price is below the zone. Zone acts as ceiling. Look for bounce → rejection → PUT entry.</span></li>
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-emerald-500 shrink-0" /><span><strong className="text-gray-300">SUPPORT</strong> — price is above the zone. Zone acts as floor. Look for pullback → bounce → CALL entry.</span></li>
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-amber-500 shrink-0" /><span><strong className="text-gray-300">CHOP</strong> — price is at the zone. No trade — wait for directional resolution with volume.</span></li>
                    </ul>
                  </div>

                  <div className="rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2.5 space-y-1.5">
                    <p className="font-semibold text-gray-200 text-[11px]">Entry gate — all three required</p>
                    <ul className="space-y-0.5 text-[10px] text-gray-500">
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-violet-400 shrink-0" /><span>Price within <strong className="text-gray-300">$0.50</strong> of the confluence zone</span></li>
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-violet-400 shrink-0" /><span><strong className="text-gray-300">Rejection candle</strong> (for PUT) or <strong className="text-gray-300">Bounce candle</strong> (for CALL) forms at the zone</span></li>
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-violet-400 shrink-0" /><span><strong className="text-gray-300">RVOL &gt; 1.2×</strong> at the moment of the candle</span></li>
                    </ul>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-[10px] uppercase tracking-wide text-gray-600 border-b border-gray-800">
                          <th className="px-2 py-1.5 font-semibold">RVOL</th>
                          <th className="px-2 py-1.5 font-semibold">Meaning</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ['< 0.8×', 'No trade — wait', 'text-rose-400'],
                          ['0.8–1.2×', 'Watch closely — not yet confirmed', 'text-amber-400'],
                          ['> 1.2×', 'Valid entry', 'text-emerald-400'],
                          ['> 1.5×', 'High conviction entry', 'text-emerald-300'],
                        ].map(r => (
                          <tr key={r[0]} className="border-b border-gray-800/40 text-[11px]">
                            <td className={`px-2 py-1.5 font-mono font-bold ${r[2]}`}>{r[0]}</td>
                            <td className="px-2 py-1.5 text-gray-400">{r[1]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2.5 space-y-1.5">
                    <p className="font-semibold text-gray-200 text-[11px]">No-trade conditions (any one blocks entry)</p>
                    <ul className="space-y-0.5 text-[10px] text-gray-500">
                      {[
                        'Daily range already > 60% used',
                        'RVOL < 0.8× at entry zone',
                        'Price in chop zone (at confluence)',
                        'No confluence zone detected',
                        'R/R ratio < 1:2',
                        'Entry missed — price already moved past zone',
                      ].map(r => (
                        <li key={r} className="flex gap-2">
                          <span className="mt-1.5 h-1 w-1 rounded-full bg-rose-500 shrink-0" />
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2.5 space-y-1">
                    <p className="font-semibold text-gray-200 text-[11px] mb-1">AI Coach output fields (new)</p>
                    <div className="grid gap-1.5 text-[10px]">
                      {[
                        { field: 'confluence', desc: 'Detected zone: price, converging levels, strength, zone role' },
                        { field: 'entry_gate', desc: 'Valid (true/false), trigger price, trigger condition, RVOL required, candle type' },
                        { field: 'trade', desc: 'Direction, entry price, target, stop, R/R ratio, r_r_valid flag' },
                        { field: 'no_trade_reason', desc: 'Human-readable explanation of why entry is blocked (null when entry is valid)' },
                        { field: 'confluence_note', desc: '≤20-word description of the active zone, shown in the amber banner' },
                      ].map(f => (
                        <div key={f.field} className="flex gap-2">
                          <code className="shrink-0 font-mono text-[9px] text-violet-300 bg-violet-950/30 px-1.5 py-0.5 rounded">{f.field}</code>
                          <span className="text-gray-400">{f.desc}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <p className="text-[10px] text-gray-500">
                    Options tier: confidence &gt; 80 = naked option acceptable; 60–80 = debit spread preferred; &lt; 60 = watch only, no trade.
                    SPY alignment adds +10 confidence; SPY conflict deducts −15.
                  </p>
                </div>
              </DocCard>

              <DocCard icon={<Clock size={15} />} title="Best Exit Windows for Day Trades (Pacific Time)">
                <div className="space-y-3 text-xs text-gray-400">

                  <div className="rounded-lg border border-emerald-800/30 bg-emerald-950/10 px-3 py-2.5">
                    <p className="font-semibold text-emerald-300 text-[11px]">Power Hour — 12:00–1:00 PM PT (3:00–4:00 PM ET)</p>
                    <p className="text-gray-400 text-[10px] mt-1 leading-relaxed">
                      The best exit window of the day. Volume surges in the final hour as institutions close or rebalance positions.
                      Moves that started midday often accelerate or reverse hard here. If you're in a profitable trade, the last 30
                      minutes (12:30–1:00 PM PT) is where you want to be out or scaling out aggressively.
                    </p>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-[10px] uppercase tracking-wide text-gray-600 border-b border-gray-800">
                          <th className="px-2 py-1.5 font-semibold">Time (PT)</th>
                          <th className="px-2 py-1.5 font-semibold">Market Phase</th>
                          <th className="px-2 py-1.5 font-semibold">What to do</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ['6:30–7:00 AM', 'Opening Range', 'No entry. Let the range form.'],
                          ['7:00–9:00 AM', 'Mid-Morning', 'Best entry window. Trends establish here.'],
                          ['9:00–10:30 AM', 'Midday Lull', 'Manage existing positions. Volume dries up, moves fade.'],
                          ['10:30–12:00 PM', 'Afternoon', 'Momentum can resume. Second entries possible.'],
                          ['12:00–12:45 PM', 'Power Hour', 'Start scaling out. Take partial profits.'],
                          ['12:45–1:00 PM', 'Last 15 min', 'Close everything. No new positions.'],
                        ].map(r => (
                          <tr key={r[0]} className="border-b border-gray-800/40 text-[11px]">
                            <td className="px-2 py-1.5 font-mono text-violet-300 whitespace-nowrap">{r[0]}</td>
                            <td className="px-2 py-1.5 font-semibold text-gray-200 whitespace-nowrap">{r[1]}</td>
                            <td className="px-2 py-1.5 text-gray-400">{r[2]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="rounded-lg border border-amber-800/30 bg-amber-950/10 px-3 py-2">
                    <p className="font-semibold text-amber-300 text-[11px]">The rules</p>
                    <ul className="space-y-1 mt-1.5">
                      <li className="flex items-start gap-2 text-[10px] text-gray-400">
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                        <span><strong className="text-gray-200">Never hold a day trade into close</strong> (after 12:45 PM PT). There isn't enough time for a new move to develop. You're just holding risk with no reward runway.</span>
                      </li>
                      <li className="flex items-start gap-2 text-[10px] text-gray-400">
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                        <span><strong className="text-gray-200">Scale out, don't dump all at once.</strong> At TP level → take half off. Trail the rest with ORH/ORL stop. Force-close remainder by 12:45 PM PT.</span>
                      </li>
                      <li className="flex items-start gap-2 text-[10px] text-gray-400">
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                        <span><strong className="text-gray-200">If midday (9:00–10:30 AM PT) and you're flat or small profit</strong> — consider closing. The lull kills momentum. A trade that hasn't moved by midday usually won't. The risk of giving back gains is higher than the reward of waiting.</span>
                      </li>
                    </ul>
                  </div>

                  <div className="rounded-lg border border-red-800/30 bg-red-950/10 px-3 py-2">
                    <p className="font-semibold text-red-300 text-[11px]">The one rule that matters most</p>
                    <p className="text-gray-400 text-[10px] mt-1 leading-relaxed">
                      The market close is not your stop — it's your deadline. If your stop hasn't been hit but the clock hits
                      12:45 PM PT, you exit anyway. Day trades don't carry overnight. The MarketTimeGate banners in the app
                      enforce this logic — they flag the caution and no-trade windows automatically.
                    </p>
                  </div>

                </div>
              </DocCard>

            </div>
          </section>

          {/* ═══════════════════════════════════════════════════════
             SECTION 7 — SWING TRADE ENGINE
             ═══════════════════════════════════════════════════════ */}
          <section id="swing-trade" className="scroll-mt-24">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <TrendingUp size={18} className="text-violet-400" />
              Swing Trade Engine
            </h2>
            <div className="space-y-3">

              <DocCard icon={<TrendingUp size={15} />} title="Overview & Verdict Scale">
                <p className="text-xs text-gray-400 leading-relaxed mb-3">
                  Multi-day signal engine using daily candles (6 months history). Targets 1–5 session holds. Scores 7 technical signals + market context + VIX.
                </p>
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  {['STRONG GO', 'GO', 'WATCH', 'WAIT', 'NO-GO'].map((v, i, a) => (
                    <div key={v} className="flex items-center gap-2">
                      <span className="rounded-lg bg-gray-800/60 border border-gray-700/50 px-2 py-1 font-mono font-bold text-gray-200">{v}</span>
                      {i < a.length - 1 && <ChevronRight size={11} className="text-gray-700" />}
                    </div>
                  ))}
                </div>
              </DocCard>

              <DocCard icon={<Activity size={15} />} title="Step 1: Data Requirements">
                <div className="space-y-2 text-xs text-gray-400">
                  <p><strong className="text-gray-300">Source:</strong> Yahoo Finance daily bars, 6-month period, auto-adjusted</p>
                  <p><strong className="text-gray-300">Minimum bars:</strong> 60 (MIN_BARS) — needed for MA50 stability</p>
                </div>
              </DocCard>

              <DocCard icon={<Layers size={15} />} title="Step 2: Indicators">
                <div className="space-y-4 text-xs text-gray-400">

                  <div className="rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2.5 space-y-1.5">
                    <div className="font-semibold text-gray-200 text-[11px]">2a. MA20 / MA50 (Simple Moving Average)</div>
                    <p><span className="font-mono text-gray-300">MA20 = SMA(Close, 20)</span> &nbsp; <span className="font-mono text-gray-300">MA50 = SMA(Close, 50)</span></p>
                    <p><span className="font-mono text-gray-300">dist_ma20_pct = (last / MA20 − 1) × 100</span></p>
                    <p className="text-gray-500">Guard: if MA20 or MA50 is NaN (insufficient history) → ValueError raised.</p>
                  </div>

                  <div className="rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2.5 space-y-1.5">
                    <div className="font-semibold text-gray-200 text-[11px]">2b. RSI (14-day Wilder's)</div>
                    <p>Average gain / average loss over 14 periods using exponential smoothing (com = 13):</p>
                    <p><span className="font-mono text-gray-300">RSI = 100 − 100 / (1 + avg_gain / avg_loss)</span></p>
                  </div>

                  <div className="rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2.5 space-y-1.5">
                    <div className="font-semibold text-gray-200 text-[11px]">2c. MACD (12, 26, 9)</div>
                    <p><span className="font-mono text-gray-300">MACD_line = EMA(Close, 12) − EMA(Close, 26)</span></p>
                    <p><span className="font-mono text-gray-300">Signal = EMA(MACD_line, 9)</span></p>
                    <p><span className="font-mono text-gray-300">Histogram = MACD_line − Signal</span></p>
                    <p className="text-gray-500">Histogram direction matters: expanding = momentum acceleration</p>
                  </div>

                  <div className="rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2.5 space-y-1.5">
                    <div className="font-semibold text-gray-200 text-[11px]">2d. 5-Day Momentum</div>
                    <p><span className="font-mono text-gray-300">mom_pct = (last / close[−5] − 1) × 100</span></p>
                  </div>

                  <div className="rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2.5 space-y-1.5">
                    <div className="font-semibold text-gray-200 text-[11px]">2e. Volume Trend</div>
                    <p>Classifies last 5 sessions vs 20-day average:</p>
                    <ul className="space-y-0.5 pl-3 text-gray-500">
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-gray-600 shrink-0" /><span>bull_expanding: up-day vol &gt; 1.2× avg AND &gt; down-day vol</span></li>
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-gray-600 shrink-0" /><span>bear_expanding: down-day vol &gt; 1.2× avg AND &gt; up-day vol</span></li>
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-gray-600 shrink-0" /><span>mixed: no dominant side</span></li>
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-gray-600 shrink-0" /><span>low: recent volume &lt; 0.7× avg</span></li>
                    </ul>
                  </div>

                </div>
              </DocCard>

              <DocCard icon={<Sigma size={15} />} title="Step 3: Scoring">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wide text-gray-600 border-b border-gray-800">
                        <th className="px-2 py-1.5 font-semibold">#</th>
                        <th className="px-2 py-1.5 font-semibold">Signal</th>
                        <th className="px-2 py-1.5 font-semibold">Condition</th>
                        <th className="px-2 py-1.5 font-semibold">Points</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ['1', 'Price vs MA20', 'price &gt; MA20', 'bull += 2.0'],
                        ['2', 'MA trend structure', 'MA20 &gt; MA50 by X%', 'bull += min(3, max(0.5, X×0.15))'],
                        ['2a', 'Convergence penalty', 'spread narrowing &gt;5%', 'score × 0.5'],
                        ['3', 'RSI bullish zone', '55–73', 'bull += 1.5'],
                        ['3a', 'RSI overbought', '&gt;73', '0 pts + caps → WATCH'],
                        ['4', 'MACD crossover', 'MACD &gt; Signal', 'bull += 2.0'],
                        ['4a', 'MACD histogram', 'hist &gt; 0 AND expanding', 'bull += 0.5'],
                        ['5', '5-day momentum', 'mom &gt; +1.5%', 'bull += 1.0'],
                        ['6', 'Volume participation', 'bull_expanding', 'bull += 1.5'],
                        ['7', 'SPY market context', 'SPY BULLISH', 'bull += 0.5'],
                        ['8', 'VIX caution', 'VIX &ge; 25', 'bull −= 0.5 (floor 0)'],
                      ].map(r => (
                        <tr key={r[0] + r[1]} className="border-b border-gray-800/40 text-[11px]">
                          <td className="px-2 py-1.5 font-mono text-violet-300">{r[0]}</td>
                          <td className="px-2 py-1.5 font-semibold text-gray-200">{r[1]}</td>
                          <td className="px-2 py-1.5 text-gray-400">{r[2]}</td>
                          <td className="px-2 py-1.5 font-mono text-emerald-300">{r[3]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-gray-500 mt-2">Bear side mirrors all rules (price below MA20, MA20 &lt; MA50, RSI &le; 45, etc.)</p>
              </DocCard>

              <DocCard icon={<LineChart size={15} />} title="Step 4: MA Structure — Proportional Scoring Detail">
                <div className="space-y-3 text-xs text-gray-400">
                  <p>The key fix: score scales with how far apart MA20 and MA50 are.</p>
                  <FormulaBlock formula="ma_spread_pct = (MA20 - MA50) / MA50 × 100\nscore = min(3.0, max(0.5, ma_spread_pct × 0.15))" />
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-[10px] uppercase tracking-wide text-gray-600 border-b border-gray-800">
                          <th className="px-2 py-1 font-semibold">MA20 above MA50 by</th>
                          <th className="px-2 py-1 font-semibold">Raw</th>
                          <th className="px-2 py-1 font-semibold">After floor</th>
                          <th className="px-2 py-1 font-semibold">Final (capped)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ['1%', '0.15', '0.50', '0.50'],
                          ['3%', '0.45', '0.50', '0.50'],
                          ['5%', '0.75', '0.75', '0.75'],
                          ['10%', '1.50', '1.50', '1.50'],
                          ['15%', '2.25', '2.25', '2.25'],
                          ['20%+', '3.00+', '—', '3.00'],
                        ].map(r => (
                          <tr key={r[0]} className="border-b border-gray-800/40 text-[11px]">
                            <td className="px-2 py-1 font-semibold text-gray-200">{r[0]}</td>
                            <td className="px-2 py-1 font-mono text-gray-400">{r[1]}</td>
                            <td className="px-2 py-1 font-mono text-gray-400">{r[2]}</td>
                            <td className="px-2 py-1 font-mono text-emerald-300">{r[3]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2">
                    <p className="font-semibold text-gray-200 text-[11px] mb-1">Convergence Detection</p>
                    <p><span className="font-mono text-gray-300">prev_spread = (MA20[-2] − MA50[-2]) / MA50[-2] × 100</span></p>
                    <p><span className="font-mono text-gray-300">converging = prev_spread &gt; ma_spread_pct × 1.05</span></p>
                    <p className="text-gray-500 mt-1">If converging → score halved. Reason appended: "MA20 &gt; MA50 but converging (gap X% from Y%) — trend fading."</p>
                  </div>
                </div>
              </DocCard>

              <DocCard icon={<Gauge size={15} />} title="Step 5: Verdict Logic & Extension Checks">
                <div className="space-y-3 text-xs text-gray-400">
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      { label: 'GO_THRESHOLD', value: '5.5' },
                      { label: 'MARGIN_GO', value: '3.0' },
                      { label: 'STRONG_THRESHOLD', value: '8.0' },
                      { label: 'STRONG_DIFF', value: '4.0' },
                      { label: 'VIX_NO_GO', value: '35.0' },
                      { label: 'VIX_CAUTION', value: '25.0' },
                      { label: 'EXT_5D_WARN', value: '8.0' },
                      { label: 'EXT_5D_HARD', value: '12.0' },
                      { label: 'EXT_MA20_WARN', value: '8.0' },
                      { label: 'RSI_OVERBOUGHT', value: '73.0' },
                    ].map(t => (
                      <div key={t.label} className="flex items-center justify-between rounded-lg bg-gray-800/40 px-3 py-1.5">
                        <code className="text-[10px] font-mono text-violet-300">{t.label}</code>
                        <span className="text-[11px] font-bold text-gray-200 font-mono">{t.value}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-gray-400"><strong className="text-gray-200">soft_edge</strong> = max(bull, bear) &ge; 5.5 AND |bull − bear| &ge; 3.0</p>
                  <div className="rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2 space-y-1.5">
                    <p className="font-semibold text-gray-200 text-[11px] mb-1">Extension Checks (run before verdict)</p>
                    <ul className="space-y-0.5 text-gray-500">
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-gray-600 shrink-0" /><span><span className="font-mono text-gray-300">_is_very_extended</span> = mom_5d &gt; 12% (for long bias)</span></li>
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-gray-600 shrink-0" /><span><span className="font-mono text-gray-300">_is_extended</span> = mom_5d &gt; 8% OR dist_ma20 &gt; 8% OR RSI &gt; 73</span></li>
                    </ul>
                  </div>
                  <div className="rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2">
                    <p className="font-semibold text-gray-200 text-[11px] mb-1">Verdict Rules</p>
                    <ul className="space-y-0.5 text-gray-500">
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-red-500 shrink-0" />VIX &ge; 35 → NO-GO</li>
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-gray-500 shrink-0" />not soft_edge → WAIT</li>
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-amber-500 shrink-0" />long + (RSI&gt;73 OR extended) → WATCH</li>
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-emerald-500 shrink-0" />long + bull &ge; 8.0 + diff &ge; 4.0 → STRONG GO</li>
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-emerald-500 shrink-0" />long + below strong → GO</li>
                    </ul>
                  </div>
                </div>
              </DocCard>

              <DocCard icon={<FlaskConical size={15} />} title="Step 6: Full Worked Example (AAPL, Strong Bull)">
                <div className="space-y-3 text-xs text-gray-400">
                  <div className="rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2 space-y-1">
                    <p className="font-semibold text-gray-200 text-[11px]">Inputs</p>
                    <p className="text-gray-500 font-mono">Last: $198.50 | MA20: $190.00 | MA50: $175.00 | dist_ma20: +4.47%</p>
                    <p className="text-gray-500 font-mono">MA20_prev: $189.20 | MA50_prev: $174.80 | RSI: 65.2</p>
                    <p className="text-gray-500 font-mono">MACD: +1.245 | Signal: +0.980 | Hist: +0.265 (prev +0.190)</p>
                    <p className="text-gray-500 font-mono">5d mom: +3.49% | Volume: bull_expanding (1.35×) | SPY: BULLISH | VIX: 14.2</p>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-[10px] uppercase tracking-wide text-gray-600 border-b border-gray-800">
                          <th className="px-2 py-1 font-semibold">Signal</th>
                          <th className="px-2 py-1 font-semibold">Points</th>
                          <th className="px-2 py-1 font-semibold">Running</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ['Price vs MA20', '2.0', '2.0'],
                          ['MA structure (8.6% spread)', '1.286', '3.286'],
                          ['RSI 65.2 (55–73)', '1.5', '4.786'],
                          ['MACD crossover + hist', '2.0 + 0.5 = 2.5', '7.286'],
                          ['5d momentum +3.49%', '1.0', '8.286'],
                          ['Volume bull_expanding', '1.5', '9.786'],
                          ['SPY BULLISH', '0.5', '10.286'],
                        ].map(r => (
                          <tr key={r[0]} className="border-b border-gray-800/40 text-[11px]">
                            <td className="px-2 py-1.5 font-semibold text-gray-200">{r[0]}</td>
                            <td className="px-2 py-1.5 font-mono text-emerald-300">{r[1]}</td>
                            <td className="px-2 py-1.5 font-mono text-gray-400">{r[2]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="rounded-lg border border-gray-800 bg-emerald-950/20 px-3 py-2">
                    <p className="font-semibold text-gray-200 text-[11px]">Result</p>
                    <p className="text-gray-400">bull = 10.29, bear = 0.0, diff = 10.29</p>
                    <p className="text-gray-400">soft_edge = True, not extended, strong_ok = True</p>
                    <p className="text-emerald-400 font-bold text-[11px] mt-1">→ Verdict: STRONG GO, bias: long</p>
                    <p className="text-gray-500 font-mono mt-1">Normalized: 85 + (10.29 − 8.0) / 2.0 × 15 = 100</p>
                  </div>

                  <div className="rounded-lg border border-gray-800 bg-amber-950/20 px-3 py-2">
                    <p className="font-semibold text-gray-200 text-[11px] mb-1">Convergence Example (Same Stock, Later)</p>
                    <p className="text-gray-500 font-mono">MA20=$192, MA50=$180 → spread=6.7%</p>
                    <p className="text-gray-500 font-mono">Prev: MA20=$194, MA50=$179.50 → prev_spread=8.1%</p>
                    <p className="text-gray-500 font-mono">converging = 8.1 &gt; 6.7×1.05 = 7.0? → YES</p>
                    <p className="text-gray-500 font-mono">score = min(3, max(0.5, 6.7×0.15)) = 1.0 → ×0.5 = 0.50</p>
                    <p className="text-amber-400 font-bold text-[11px] mt-1">→ Downgraded from STRONG GO to GO or WATCH</p>
                  </div>
                </div>
              </DocCard>

              <DocCard icon={<ShieldCheck size={15} />} title="Step 7: Entry Quality (Decision Layer)">
                <div className="space-y-2 text-xs text-gray-400">
                  <p>After scoring, <span className="font-mono text-gray-300">build_swing_trade_decision()</span> applies additional trade quality gates based on risk flags and extension checks.</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-[10px] uppercase tracking-wide text-gray-600 border-b border-gray-800">
                          <th className="px-2 py-1 font-semibold">Entry Quality</th>
                          <th className="px-2 py-1 font-semibold">Condition</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ['GOOD_ENTRY', 'Clean setup, no extension flags, trade_quality_score &ge; 6.5'],
                          ['CAUTION_ENTRY', 'GOOD_ENTRY but risk_level = HIGH (elevated IV, VIX, earnings)'],
                          ['WAIT_PULLBACK', 'Price extended from MA20 &gt; 8% or RSI &gt; 73 or 5d momentum &gt; 8%'],
                          ['WAIT_BREAKOUT_CONFIRMATION', 'Near resistance (52W high / prior swing high)'],
                          ['LATE_ENTRY', 'Price gapped &gt; 3% today, or 5d momentum &gt; 12% (AVOID_CHASE)'],
                          ['BAD_ENTRY', 'Very extended (12%+ in 5d), low option liquidity, earnings imminent'],
                          ['NO_CLEAN_ENTRY', 'Conflicting signals, trade_quality_score &lt; 5.0, or bias is NEUTRAL'],
                        ].map(r => (
                          <tr key={r[0]} className="border-b border-gray-800/40 text-[11px]">
                            <td className="px-2 py-1.5 font-semibold text-gray-200">{r[0]}</td>
                            <td className="px-2 py-1.5 text-gray-400">{r[1]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-gray-500 mt-1">
                    The <span className="font-mono text-gray-300">trade_quality_score</span> is a post-penalty float (0–10) used for final action. Trend direction (verdict) and entry timing (entry_quality) are separate — a GO verdict can coexist with WAIT_PULLBACK when the trend is there but entry price is stretched.
                  </p>
                </div>
              </DocCard>

            </div>
          </section>

          {/* ═══════════════════════════════════════════════════════
             VIX REFERENCE
             ═══════════════════════════════════════════════════════ */}
          <section id="vix-reference" className="scroll-mt-24">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Activity size={18} className="text-violet-400" />
              VIX Reference
            </h2>
            <div className="space-y-3">

              <DocCard icon={<BookOpen size={15} />} title="What is VIX?">
                <div className="space-y-2 text-xs text-gray-400">
                  <div className="rounded-lg bg-amber-950/20 border border-amber-800/30 px-3 py-2.5">
                    <p className="text-[11px] font-semibold text-amber-200">Simple Definition</p>
                    <p className="text-gray-300 mt-1">VIX = The market's &ldquo;fear meter&rdquo;</p>
                    <p className="text-gray-500 mt-1">It measures how much fear or uncertainty investors have about the stock market over the next 30 days. Also called the &ldquo;Fear Index.&rdquo;</p>
                  </div>
                  <div className="rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2.5 space-y-1.5">
                    <p className="font-semibold text-gray-200 text-[11px]">How It Actually Works</p>
                    <ul className="space-y-1 text-gray-500">
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-violet-500 shrink-0" />VIX is calculated from S&amp;P 500 options prices</li>
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-violet-500 shrink-0" />When traders are scared they buy more put options to protect themselves</li>
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-violet-500 shrink-0" />More put buying = higher options prices = VIX goes up</li>
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-violet-500 shrink-0" />When traders are confident they buy fewer puts = VIX goes down</li>
                    </ul>
                    <div className="mt-2 rounded-lg bg-gray-900/60 border border-gray-800 px-3 py-2">
                      <p className="font-semibold text-gray-200 text-[10px]">Think of it like insurance prices:</p>
                      <p className="text-gray-500 text-[10px] mt-0.5">If a hurricane is coming → insurance gets expensive → VIX high</p>
                      <p className="text-gray-500 text-[10px]">Beautiful sunny weather → insurance is cheap → VIX low</p>
                    </div>
                  </div>
                </div>
              </DocCard>

              <DocCard icon={<Activity size={15} />} title="How to Read VIX Numbers">
                <div className="space-y-3 text-xs text-gray-400">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-[10px] uppercase tracking-wide text-gray-600 border-b border-gray-800">
                          <th className="px-2 py-1.5 font-semibold">VIX Level</th>
                          <th className="px-2 py-1.5 font-semibold">Market Mood</th>
                          <th className="px-2 py-1.5 font-semibold">What It Means for Traders</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ['Below 15', 'Very calm 😴', 'Low fear, bull market cruising'],
                          ['15–20', 'Normal ✅', 'Healthy market, manageable risk'],
                          ['20–25', 'Cautious ⚠️', 'Some nervousness, be careful'],
                          ['25–35', 'Fearful 😰', 'Volatility picking up, reduce risk'],
                          ['35–50', 'Panic 😱', 'Major selloff, very dangerous'],
                          ['50+', 'Crisis 🔴', 'Crash level — COVID was 85, 2008 was 80'],
                        ].map(r => (
                          <tr key={r[0]} className="border-b border-gray-800/40 text-[11px]">
                            <td className={`px-2 py-1.5 font-bold font-mono ${
                              r[0] === 'Below 15' || r[0] === '15–20' ? 'text-emerald-400' :
                              r[0] === '20–25' ? 'text-amber-400' :
                              r[0] === '25–35' ? 'text-orange-400' :
                              'text-red-400'
                            }`}>{r[0]}</td>
                            <td className="px-2 py-1.5 text-gray-200">{r[1]}</td>
                            <td className="px-2 py-1.5 text-gray-400">{r[2]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="rounded-lg bg-emerald-950/20 border border-emerald-800/30 px-3 py-2.5">
                    <p className="font-semibold text-emerald-300 text-[11px]">Your Reading Today: 17.9</p>
                    <p className="text-emerald-400/80 text-[11px] mt-0.5">Calm and contained — market is NOT panicking</p>
                  </div>
                </div>
              </DocCard>

              <DocCard icon={<RefreshCw size={15} />} title="VIX vs Market Relationship">
                <div className="space-y-3 text-xs text-gray-400">
                  <p>VIX and the stock market almost always move in <strong className="text-gray-200">OPPOSITE</strong> directions:</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      { event: 'Market goes UP', vix: 'VIX goes DOWN', mood: '✅ Good', cls: 'text-emerald-400' },
                      { event: 'Market goes DOWN', vix: 'VIX goes UP', mood: '🔴 Bad', cls: 'text-red-400' },
                    ].map(r => (
                      <div key={r.event} className="rounded-lg bg-gray-800/40 border border-gray-700/50 px-3 py-2 text-center">
                        <div className="text-gray-200 font-semibold text-[11px]">{r.event}</div>
                        <div className={`font-mono text-[11px] font-bold ${r.cls}`}>{r.vix}</div>
                        <div className="text-[10px] text-gray-500">{r.mood}</div>
                      </div>
                    ))}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-[10px] uppercase tracking-wide text-gray-600 border-b border-gray-800">
                          <th className="px-2 py-1.5 font-semibold">Market Event</th>
                          <th className="px-2 py-1.5 font-semibold">VIX Did</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ['COVID crash March 2020', 'Spiked to 85 🔴'],
                          ['2008 financial crisis', 'Hit 80 🔴'],
                          ['Normal bull market', 'Stays 12–18 ✅'],
                          ['Today', '17.9 ✅'],
                        ].map(r => (
                          <tr key={r[0]} className="border-b border-gray-800/40 text-[11px]">
                            <td className="px-2 py-1.5 font-semibold text-gray-200">{r[0]}</td>
                            <td className="px-2 py-1.5 font-mono text-gray-400">{r[1]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </DocCard>

              <DocCard icon={<Target size={15} />} title="How to Use VIX in Your Trading">
                <div className="space-y-3 text-xs text-gray-400">
                  <div className="rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2.5">
                    <p className="font-semibold text-gray-200 text-[11px] mb-1">For Swing Trades</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-[10px] uppercase tracking-wide text-gray-600 border-b border-gray-800">
                            <th className="px-2 py-1 font-semibold">VIX</th>
                            <th className="px-2 py-1 font-semibold">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[
                            ['Below 20', '✅ Good environment for calls', 'text-emerald-400'],
                            ['20–25', '⚠️ Be selective, smaller size', 'text-amber-400'],
                            ['Above 25', '🔴 Avoid new call positions', 'text-red-400'],
                            ['Above 35', '🔴 Consider puts or stay cash', 'text-red-500'],
                          ].map(r => (
                            <tr key={r[0]} className="border-b border-gray-800/40 text-[11px]">
                              <td className={`px-2 py-1 font-bold font-mono ${r[2]}`}>{r[0]}</td>
                              <td className="px-2 py-1 text-gray-400">{r[1]}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2.5">
                    <p className="font-semibold text-gray-200 text-[11px] mb-1">For Options Specifically</p>
                    <ul className="space-y-1 text-gray-500">
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-gray-600 shrink-0" /><span><strong className="text-gray-300">High VIX</strong> = Expensive options (premiums are inflated)</span></li>
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-gray-600 shrink-0" /><span><strong className="text-gray-300">Low VIX</strong> = Cheaper options (better time to buy calls)</span></li>
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-emerald-500 shrink-0" /><span>Right now at <strong className="text-emerald-400">17.9</strong> → options are reasonably priced</span></li>
                    </ul>
                  </div>
                </div>
              </DocCard>

              <DocCard icon={<AlertTriangle size={15} />} title="VIX as a Traffic Light">
                <div className="space-y-2 text-xs text-gray-400">
                  {[
                    { level: 'Below 20', light: '🟢 Green Light', action: 'Trade freely', cls: 'text-emerald-400' },
                    { level: '20–25', light: '🟡 Yellow Light', action: 'Slow down, be careful', cls: 'text-amber-400' },
                    { level: 'Above 25', light: '🔴 Red Light', action: 'Stop, reduce risk', cls: 'text-red-400' },
                    { level: 'Above 35', light: '🚨 Emergency', action: 'Protect capital only', cls: 'text-red-500' },
                  ].map(r => (
                    <div key={r.level} className="flex items-center gap-3 rounded-lg bg-gray-800/40 border border-gray-700/50 px-3 py-2">
                      <span className={`font-bold font-mono text-[11px] ${r.cls}`}>{r.level}</span>
                      <span className="text-gray-200 text-[11px]">{r.light}</span>
                      <span className="text-gray-500 text-[10px] ml-auto">{r.action}</span>
                    </div>
                  ))}
                </div>
              </DocCard>

              <DocCard icon={<Layers size={15} />} title="4-State Swing System & Single-Line Execution">
                <div className="space-y-3 text-xs text-gray-400">
                  <p>The Swing Trade engine uses the same 4-state lifecycle as Day Trade with a single-line execution bar for quick reference:</p>

                  <div className="rounded-lg border border-gray-800 bg-gray-900/60 px-3 py-2">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">Single-Line Execution</div>
                    <div className="text-[11px] font-mono">
                      <span className="font-bold text-gray-100 uppercase">BIAS</span> |<span className="text-yellow-300 font-semibold"> BREAKOUT $T</span> |<span className="text-emerald-300 font-semibold"> BASE ZONE</span> |<span className="text-violet-300"> T1</span> <span className="text-orange-300">T2</span> |<span className="text-red-300"> SL</span>
                    </div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      { state: '🟡 SETUP', desc: 'Base / Accumulation zone. Support/resistance zone identified. No entry — observe only.' },
                      { state: '🟢 ENTRY', desc: 'Breakout confirmation required. Entry on confirmed breakout — no anticipation. No intraday timing rules (VWAP, ORH not used).' },
                      { state: '🔵 ACTIVE', desc: 'Trend Holding Phase. Scale ½ at TP1, trail rest to TP2. Focus on capital protection + continuation.' },
                      { state: '🔴 EXIT', desc: 'Invalidated / Complete. Stop loss = structural breakdown of base. Target hit = predefined swing extensions (TP1 → TP2 → runners). Reset to SETUP.' },
                    ].map(c => (
                      <div key={c.state} className="rounded-lg bg-gray-800/40 border border-gray-700/50 px-3 py-2">
                        <div className="font-semibold text-gray-200 text-[11px]">{c.state}</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">{c.desc}</div>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-lg border border-amber-800/30 bg-amber-950/10 px-3 py-2">
                    <p className="font-semibold text-amber-300 text-[11px]">Swing Rules</p>
                    <ul className="space-y-1 text-gray-400 text-[10px] mt-1">
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-amber-500 shrink-0" />Entry ONLY on breakout confirmation (no anticipation)</li>
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-amber-500 shrink-0" />Stop loss = structural breakdown of base (not arbitrary distance)</li>
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-amber-500 shrink-0" />Targets = predefined swing extensions (TP1 → TP2 → runners)</li>
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-amber-500 shrink-0" />No emotional labels ("maybe," "pullback," "current")</li>
                    </ul>
                  </div>
                </div>
              </DocCard>

            </div>
          </section>

          {/* ═══════════════════════════════════════════════════════
             SECTION 8 — REGULAR ENGINE
             ═══════════════════════════════════════════════════════ */}
          <section id="regular-engine" className="scroll-mt-24">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <SlidersHorizontal size={18} className="text-violet-400" />
              Regular Engine
            </h2>
            <div className="space-y-3">
              <DocCard icon={<Briefcase size={15} />} title="Strategic Options Structures">
                <div className="space-y-3 text-xs text-gray-400">
                  <p>The Regular (strategic) engine builds and validates complete option structures — spreads, covered positions, and multi-leg strategies. It applies the full pre-trade checklist, EV calculation, and Kelly sizing to every candidate.</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      { label: 'Strategy Mode Overrides', desc: 'All, Long Options, Credit Spreads, or Straddles mode restricts which strategies the engine considers.' },
                      { label: 'Spread Construction', desc: 'Credit spreads target ~25 delta short legs. Iron condors target ~20 delta. Debit spreads adjust based on expected move.' },
                      { label: 'Portfolio-Aware', desc: 'Cross-ticker exposure checks prevent over-concentration in correlated positions.' },
                      { label: 'Income Trades', desc: 'Covered Calls and Covered Puts use Income Yield instead of EV as the primary quality metric.' },
                    ].map(c => (
                      <div key={c.label} className="rounded-lg bg-gray-800/40 border border-gray-700/50 px-3 py-2">
                        <div className="font-semibold text-gray-200 text-[11px]">{c.label}</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">{c.desc}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </DocCard>

              <DocCard icon={<Layers size={15} />} title="4-State Entry System">
                <div className="space-y-3 text-xs text-gray-400">
                  <p>Every recommendation card and the Trade Signals page shows one of four entry states. The state is derived from the internal pre-trade checklist verdict combined with score, IV fit, and filter results.</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      {
                        num: 'STATE 2', label: 'ENTRY', color: 'emerald',
                        badgeCls: 'bg-emerald-900/50 text-emerald-300 border-emerald-700',
                        conditions: 'Internal verdict = GO · Score ≥ 70 · IV fits strategy · All filters pass (R:R, liquidity, credit ≥ 25%)',
                        action: 'Enter now. Sell credit spreads: stop at 2× credit, target 50% profit. Buy debit: stop at 50% of premium, target 100%.',
                      },
                      {
                        num: 'STATE 1', label: 'SETUP', color: 'amber',
                        badgeCls: 'bg-amber-900/50 text-amber-300 border-amber-700',
                        conditions: 'Verdict = GO or CAUTION · Score ≥ 55 · Liquidity passes · One soft fail, thin edge, or IV mismatch remains',
                        action: 'Setup in progress. Monitor the missing conditions listed on the card. Do not enter — one or more gates are not yet cleared.',
                      },
                      {
                        num: 'WATCH', label: 'WATCH', color: 'sky',
                        badgeCls: 'bg-sky-900/40 text-sky-300 border-sky-700',
                        conditions: 'No hard fails · Score 40–55 · Multiple filters failing or IV not yet aligned',
                        action: 'Set an alert and re-analyze when conditions improve. The directional bias may be forming but the structure is not ready.',
                      },
                      {
                        num: 'AVOID', label: 'AVOID', color: 'red',
                        badgeCls: 'bg-red-900/40 text-red-300 border-red-800',
                        conditions: 'Verdict = NO GO OR score < 40. Hard fail present (EV ≤ 0, DTE too short, liquidity failure, IV mismatch)',
                        action: 'Skip entirely. The trade fails minimum quality thresholds. Re-evaluate after conditions change.',
                      },
                    ].map(s => (
                      <div key={s.num} className="rounded-lg border border-gray-700/50 bg-gray-800/30 px-3 py-2.5 space-y-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${s.badgeCls}`}>{s.num}: {s.label}</span>
                        </div>
                        <div>
                          <span className="text-[10px] font-semibold text-gray-300">When: </span>
                          <span className="text-[10px]">{s.conditions}</span>
                        </div>
                        <div>
                          <span className="text-[10px] font-semibold text-gray-300">Action: </span>
                          <span className="text-[10px]">{s.action}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-lg border border-violet-800/30 bg-violet-950/10 px-3 py-2">
                    <p className="text-[10px] text-violet-300 font-semibold mb-0.5">Reading the state badge tooltip</p>
                    <p className="text-[10px]">Hover the state badge on any recommendation card to see the exact score, IV Rank, and which conditions are still missing. The tooltip lists each unmet condition so you know precisely what to watch for.</p>
                  </div>
                </div>
              </DocCard>

              <DocCard icon={<Filter size={15} />} title="Strategy Selection Matrix">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wide text-gray-600 border-b border-gray-800">
                        <th className="px-3 py-2">Condition</th>
                        <th className="px-3 py-2">Strategies</th>
                        <th className="px-3 py-2">Why</th>
                      </tr>
                    </thead>
                    <tbody>
                      {strategyRules.map(r => (
                        <tr key={r.condition} className="border-b border-gray-800/50">
                          <td className="px-3 py-2 font-mono text-[10px] text-violet-300 whitespace-nowrap">{r.condition}</td>
                          <td className="px-3 py-2 text-gray-200 font-semibold text-[10px]">{r.built}</td>
                          <td className="px-3 py-2 text-gray-500 text-[10px]">{r.why}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </DocCard>
            </div>
          </section>

          {/* ═══════════════════════════════════════════════════════
             SECTION 8B — TRADE ENTRY GUIDE
             ═══════════════════════════════════════════════════════ */}
          <section id="entry-guide" className="scroll-mt-24">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <ArrowRight size={18} className="text-violet-400" />
              Trade Entry Guide
            </h2>
            <div className="space-y-3">

              <DocCard icon={<Brain size={15} />} title="When to Use Each Engine">
                <div className="space-y-2 text-xs text-gray-400">
                  <p>Each engine serves a different purpose. Using the wrong one for your hold timeframe is the most common mistake.</p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div className="rounded-lg border border-sky-800/30 bg-sky-950/10 px-3 py-2.5">
                      <div className="font-semibold text-sky-300 text-[11px]">Day Trade Engine</div>
                      <p className="text-[10px] text-gray-400 mt-1">Intraday entry timing only. Use to find the cleanest entry after swing says READY. Best window: 7:00–9:00 AM PT after opening range settles.<br /><br />Never use as primary signal for a swing trade.</p>
                    </div>
                    <div className="rounded-lg border border-emerald-800/30 bg-emerald-950/10 px-3 py-2.5">
                      <div className="font-semibold text-emerald-300 text-[11px]">Swing Engine</div>
                      <p className="text-[10px] text-gray-400 mt-1">Multi-day directional signal. READY = daily structure supports a move over days.<br /><br />This is your go/no-go decision for swing trades. Use it first.</p>
                    </div>
                    <div className="rounded-lg border border-amber-800/30 bg-amber-950/10 px-3 py-2.5">
                      <div className="font-semibold text-amber-300 text-[11px]">Regular Engine</div>
                      <p className="text-[10px] text-gray-400 mt-1">Longer holds (1–3 weeks). Confirms the weekly trend. Adds conviction when it aligns with Swing.<br /><br />Use as a conviction-booster for swing trades targeting multi-week moves.</p>
                    </div>
                  </div>
                </div>
              </DocCard>

              <DocCard icon={<Clock size={15} />} title="DTE Selection by Hold Intention">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wide text-gray-600 border-b border-gray-800">
                        <th className="px-2 py-1.5 font-semibold">Hold Plan</th>
                        <th className="px-2 py-1.5 font-semibold">DTE to Buy</th>
                        <th className="px-2 py-1.5 font-semibold">Why</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ['1–3 days', '14–21 DTE', 'Gives buffer without heavy premium'],
                        ['3–5 days', '21–30 DTE', 'Sweet spot for swing trades'],
                        ['5–10 days', '30–45 DTE', 'Theta barely touches you'],
                        ['10+ days', '45–60 DTE', 'Full swing, no time pressure'],
                      ].map(r => (
                        <tr key={r[0]} className="border-b border-gray-800/40 text-[11px]">
                          <td className="px-2 py-1.5 text-gray-200 font-semibold">{r[0]}</td>
                          <td className="px-2 py-1.5 font-mono text-emerald-300">{r[1]}</td>
                          <td className="px-2 py-1.5 text-gray-400">{r[2]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="rounded-lg border border-emerald-800/30 bg-emerald-950/10 px-3 py-2 mt-2">
                  <p className="font-semibold text-emerald-300 text-[10px]">Rule of thumb: buy 3× more DTE than your intended hold. If you plan to hold 5 days, buy 15–21 DTE minimum.</p>
                </div>
              </DocCard>

              <DocCard icon={<Activity size={15} />} title="The Right Workflow for Multi-Day Swings">
                <div className="space-y-2 text-xs">
                  <p className="text-gray-400">When a swing trade targets a multi-day move, follow this order:</p>
                  <div className="space-y-1.5">
                    {[
                      ['1', 'Swing engine says READY', 'Go / No-Go decision'],
                      ['2', 'Regular engine agrees', 'Higher conviction (bonus)'],
                      ['3', 'Day trade engine: entry timing', 'When to pull the trigger (7:00–9:00 AM PT)'],
                      ['4', 'Buy 21–30 DTE calls', 'No theta pressure on the swing'],
                      ['5', 'Hold until swing target or stop', 'Not a DTE countdown'],
                    ].map(([num, action, note]) => (
                      <div key={num} className="flex items-center gap-3 rounded-lg bg-gray-800/40 border border-gray-700/50 px-3 py-2">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-600/30 text-[10px] font-bold text-violet-300">{num}</span>
                        <span className="flex-1 font-semibold text-gray-200 text-[11px]">{action}</span>
                        <span className="text-[10px] text-gray-500">{note}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </DocCard>

              <DocCard icon={<TrendingUp size={15} />} title="Real Example: AMD at $448">
                <div className="space-y-2 text-xs text-gray-400">
                  <p>For AMD at $448 targeting a swing move:</p>
                  <ul className="space-y-1">
                    <li className="flex items-start gap-2 text-[10px]">
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400" />
                      <span>Buy the <strong className="text-gray-200">June 6 expiry</strong> (or nearest Friday ~21 days out)</span>
                    </li>
                    <li className="flex items-start gap-2 text-[10px]">
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400" />
                      <span>Strike: <strong className="text-gray-200">at-the-money</strong> or one strike above current price</span>
                    </li>
                    <li className="flex items-start gap-2 text-[10px]">
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400" />
                      <span>This gives you <strong className="text-gray-200">3 full weeks</strong> for the move to develop</span>
                    </li>
                    <li className="flex items-start gap-2 text-[10px]">
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400" />
                      <span>Theta is <strong className="text-gray-200">mild for the first 10 days</strong> — you're not fighting the clock</span>
                    </li>
                  </ul>
                </div>
              </DocCard>

              <DocCard icon={<Brain size={15} />} title="The Key Mindset Shift">
                <div className="rounded-lg border border-amber-800/30 bg-amber-950/10 px-3 py-2.5 text-xs">
                  <p className="text-gray-400 leading-relaxed">
                    <strong className="text-amber-300">With 8 DTE</strong> you were managing time instead of managing the trade.
                  </p>
                  <p className="text-gray-400 leading-relaxed mt-2">
                    <strong className="text-emerald-300">With 21–30 DTE</strong> you check the swing signal once a day, let the move develop, and only act when the setup changes — not because the clock is running out.
                  </p>
                </div>
              </DocCard>

              <DocCard icon={<Flame size={15} />} title="Why 8 DTE Fails for Swing Trades">
                <div className="space-y-2 text-xs text-gray-400">
                  <p>You planned a swing trade (multi-day hold, ~10 DTE window) but used the Day Trade engine to time the entry, then compressed the exit to 8 DTE. The day trade engine confirmed the intraday setup was valid. That doesn't automatically mean the multi-day swing move is confirmed.</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2">
                      <div className="font-semibold text-sky-300 text-[10px]">Swing Trade</div>
                      <ul className="mt-1 space-y-0.5 text-[10px] text-gray-500">
                        <li>Timeframe: Days to weeks</li>
                        <li>Confirmation: Daily structure, trend</li>
                        <li>Entry signal: READY on swing engine</li>
                        <li>Option DTE: 21–45 DTE</li>
                      </ul>
                    </div>
                    <div className="rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2">
                      <div className="font-semibold text-amber-300 text-[10px]">Day Trade</div>
                      <ul className="mt-1 space-y-0.5 text-[10px] text-gray-500">
                        <li>Timeframe: Hours</li>
                        <li>Confirmation: Intraday breakout</li>
                        <li>Entry signal: READY on day engine</li>
                        <li>Option DTE: Same day or 1 DTE</li>
                      </ul>
                    </div>
                  </div>
                  <div className="rounded-lg border border-red-800/30 bg-red-950/10 px-3 py-2">
                    <p className="font-semibold text-red-300 text-[10px]">The specific problem with 8 DTE</p>
                    <ul className="mt-1 space-y-0.5 text-[10px] text-gray-400">
                      <li className="flex items-start gap-2"><span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-red-500" />Day 1–2: entry + settling</li>
                      <li className="flex items-start gap-2"><span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-red-500" />Day 3–5: waiting for the move</li>
                      <li className="flex items-start gap-2"><span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-red-500" />Day 6–7: theta accelerating hard</li>
                      <li className="flex items-start gap-2"><span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-red-500" />Day 8: expiry week — panic or hope</li>
                    </ul>
                    <p className="text-[10px] text-gray-400 mt-1">A swing trade needs the move to develop over days. With 8 DTE you're already in theta danger before the swing has time to play out. It became a day trade by necessity even though you intended it as a swing.</p>
                  </div>
                </div>
              </DocCard>

              <DocCard icon={<Award size={15} />} title="Summary: The Right Workflow">
                <div className="space-y-2 text-xs text-gray-400">
                  <div className="space-y-1.5">
                    {[
                      ['Step 1', 'Check Swing Trade engine first. Is it READY?'],
                      ['Step 2', 'If READY on swing, use Day Trade engine only to time the intraday entry (7:00–9:00 AM PT, after opening range).'],
                      ['Step 3', "Buy 21–45 DTE options so theta doesn't pressure you while waiting for the swing to develop."],
                      ['Step 4', 'Set your exit at the swing target, not a DTE countdown.'],
                    ].map(([step, desc]) => (
                      <div key={step} className="flex items-start gap-2 rounded-lg bg-gray-800/40 border border-gray-700/50 px-3 py-2">
                        <span className="shrink-0 rounded bg-violet-600/30 px-1.5 py-0.5 text-[9px] font-bold text-violet-300">{step}</span>
                        <span className="text-[10px] text-gray-400 leading-snug">{desc}</span>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-lg border border-emerald-800/30 bg-emerald-950/10 px-3 py-2">
                    <p className="text-[10px] text-gray-400 leading-relaxed">
                      The day trade engine is a <strong className="text-gray-200">precision entry tool</strong> for swing trades — not the confirmation signal.
                      The swing engine is the confirmation. You had the tools right, just the order and the DTE selection worked against you.
                    </p>
                  </div>
                </div>
              </DocCard>

            </div>
          </section>

          {/* ═══════════════════════════════════════════════════════
              SECTION 9 — OPTIONS FUNDAMENTALS
              ═══════════════════════════════════════════════════════ */}
          <section id="options-funda" className="scroll-mt-24">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <BookOpen size={18} className="text-violet-400" />
              Options Fundamentals
            </h2>
            <p className="text-xs text-gray-500 mb-4">Professional reference for every option strategy supported by the engine. Each entry includes the ideal market condition, risk profile, IV environment, common mistakes, and a payoff diagram.</p>

            <div className="grid gap-4 sm:grid-cols-2">
              {/* Long Call */}
              <div className="rounded-xl border border-gray-800 bg-gray-900/60 overflow-hidden">
                <div className="px-3 py-2.5 border-b border-gray-800 flex items-center gap-2">
                  <span className="text-xs font-bold text-white">Long Call</span>
                  <span className="rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-600/40 px-2 py-0.5 text-[9px] font-bold uppercase">Bullish</span>
                </div>
                <div className="p-3 space-y-2 text-[11px]">
                  <PayoffSvg type="long-call" />
                  <div className="grid gap-1.5">
                    <InfoRow label="What" value="Buy a call option. Pay premium for the right to buy stock at the strike." />
                    <InfoRow label="When" value="Strong bullish conviction, low IV, defined risk tolerance." />
                    <InfoRow label="Market" value="Bull trend, breakout, momentum expansion." />
                    <InfoRow label="Risk" value="Limited to premium paid. Unlimited upside." />
                    <InfoRow label="IV" value="Best in LOW IV — expensive premium erodes edge in high IV." />
                    <InfoRow label="Mistakes" value="Buying OTM far from price; holding through theta decay too long; buying into earnings." />
                    <InfoRow label="Max P/L" value="Max Loss = premium paid. Max Profit = unlimited (model truncates at 3× strike). Breakeven = strike + premium." />
                  </div>
                </div>
              </div>

              {/* Long Put */}
              <div className="rounded-xl border border-gray-800 bg-gray-900/60 overflow-hidden">
                <div className="px-3 py-2.5 border-b border-gray-800 flex items-center gap-2">
                  <span className="text-xs font-bold text-white">Long Put</span>
                  <span className="rounded-full bg-rose-500/15 text-rose-300 border border-rose-700/40 px-2 py-0.5 text-[9px] font-bold uppercase">Bearish</span>
                </div>
                <div className="p-3 space-y-2 text-[11px]">
                  <PayoffSvg type="long-put" />
                  <div className="grid gap-1.5">
                    <InfoRow label="What" value="Buy a put option. Pay premium for the right to sell stock at the strike." />
                    <InfoRow label="When" value="Strong bearish conviction, low IV, defined risk tolerance." />
                    <InfoRow label="Market" value="Bear trend, breakdown, panic selling." />
                    <InfoRow label="Risk" value="Limited to premium paid. Profit grows as stock falls to $0." />
                    <InfoRow label="IV" value="Best in LOW IV — elevated IV inflates put premiums." />
                    <InfoRow label="Mistakes" value="Buying far OTM puts expecting a crash; holding through volatility crush." />
                    <InfoRow label="Max P/L" value="Max Loss = premium paid. Max Profit = strike − premium (stock → $0). Breakeven = strike − premium." />
                  </div>
                </div>
              </div>

              {/* Covered Call */}
              <div className="rounded-xl border border-gray-800 bg-gray-900/60 overflow-hidden">
                <div className="px-3 py-2.5 border-b border-gray-800 flex items-center gap-2">
                  <span className="text-xs font-bold text-white">Covered Call</span>
                  <span className="rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-600/40 px-2 py-0.5 text-[9px] font-bold uppercase">Bullish</span>
                </div>
                <div className="p-3 space-y-2 text-[11px]">
                  <PayoffSvg type="covered-call" />
                  <div className="grid gap-1.5">
                    <InfoRow label="What" value="Own 100 shares, sell an OTM call. Collect premium, cap upside at strike." />
                    <InfoRow label="When" value="Neutral-to-slightly-bullish outlook on shares you already own." />
                    <InfoRow label="Market" value="Sideways to modestly bullish. Low volatility expected." />
                    <InfoRow label="Risk" value="Stock downside risk (unhedged). Capped upside at the short strike." />
                    <InfoRow label="IV" value="Best in HIGH IV — collect richer premium when options are expensive." />
                    <InfoRow label="Mistakes" value="Selling too low (strike near price) and capping upside too early; selling during strong uptrend." />
                    <InfoRow label="Max P/L" value="Max Profit = (strike − entry) + premium. Max Loss = stock loss − premium. Breakeven = entry − premium." />
                  </div>
                </div>
              </div>

              {/* Cash-Secured Put */}
              <div className="rounded-xl border border-gray-800 bg-gray-900/60 overflow-hidden">
                <div className="px-3 py-2.5 border-b border-gray-800 flex items-center gap-2">
                  <span className="text-xs font-bold text-white">Cash-Secured Put</span>
                  <span className="rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-600/40 px-2 py-0.5 text-[9px] font-bold uppercase">Bullish</span>
                </div>
                <div className="p-3 space-y-2 text-[11px]">
                  <PayoffSvg type="cash-secured-put" />
                  <div className="grid gap-1.5">
                    <InfoRow label="What" value="Sell an OTM put with cash collateral. Collect premium; may be assigned shares." />
                    <InfoRow label="When" value="Bullish or neutral on a stock you want to own at a discount." />
                    <InfoRow label="Market" value="Bullish or range-bound. Willing to buy the dip." />
                    <InfoRow label="Risk" value="Obligation to buy 100 shares at strike if stock falls below. Cash collateral required." />
                    <InfoRow label="IV" value="Best in HIGH IV — elevated premium improves income yield." />
                    <InfoRow label="Mistakes" value="Selling puts on stocks you do not want to own; assigning too much capital to one trade." />
                    <InfoRow label="Max P/L" value="Max Profit = premium collected. Max Loss = strike − premium (stock → $0). Breakeven = strike − premium." />
                  </div>
                </div>
              </div>

              {/* Bull Call Spread */}
              <div className="rounded-xl border border-gray-800 bg-gray-900/60 overflow-hidden">
                <div className="px-3 py-2.5 border-b border-gray-800 flex items-center gap-2">
                  <span className="text-xs font-bold text-white">Bull Call Spread</span>
                  <span className="rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-600/40 px-2 py-0.5 text-[9px] font-bold uppercase">Bullish</span>
                </div>
                <div className="p-3 space-y-2 text-[11px]">
                  <PayoffSvg type="bull-call-spread" />
                  <div className="grid gap-1.5">
                    <InfoRow label="What" value="Buy lower-strike call, sell higher-strike call. Debit spread with defined risk/reward." />
                    <InfoRow label="When" value="Moderately bullish. Expect price to rise but not explode past the short strike." />
                    <InfoRow label="Market" value="Bullish with defined target. Lower cost than a naked long call." />
                    <InfoRow label="Risk" value="Limited to net debit paid. Profit capped at spread width minus debit." />
                    <InfoRow label="IV" value="Works in any IV. Better in LOW IV (cheaper to buy)." />
                    <InfoRow label="Mistakes" value="Choosing strikes too close together (low max profit); paying too much for short-dated spreads." />
                    <InfoRow label="Max P/L" value="Max Loss = debit paid. Max Profit = spread width − debit. Breakeven = long strike + debit." />
                  </div>
                </div>
              </div>

              {/* Bear Put Spread */}
              <div className="rounded-xl border border-gray-800 bg-gray-900/60 overflow-hidden">
                <div className="px-3 py-2.5 border-b border-gray-800 flex items-center gap-2">
                  <span className="text-xs font-bold text-white">Bear Put Spread</span>
                  <span className="rounded-full bg-rose-500/15 text-rose-300 border border-rose-700/40 px-2 py-0.5 text-[9px] font-bold uppercase">Bearish</span>
                </div>
                <div className="p-3 space-y-2 text-[11px]">
                  <PayoffSvg type="bear-put-spread" />
                  <div className="grid gap-1.5">
                    <InfoRow label="What" value="Buy higher-strike put, sell lower-strike put. Debit spread with defined risk/reward." />
                    <InfoRow label="When" value="Moderately bearish. Expect price to fall but not crash through the short strike." />
                    <InfoRow label="Market" value="Bearish with defined target. Lower cost than a naked long put." />
                    <InfoRow label="Risk" value="Limited to net debit paid. Profit capped at spread width minus debit." />
                    <InfoRow label="IV" value="Works in any IV. Better in LOW IV (cheaper to buy)." />
                    <InfoRow label="Mistakes" value="Opening during IV spike (expensive); strikes too narrow for expected move." />
                    <InfoRow label="Max P/L" value="Max Loss = debit paid. Max Profit = spread width − debit. Breakeven = long strike − debit." />
                  </div>
                </div>
              </div>

              {/* Bull Put Spread */}
              <div className="rounded-xl border border-gray-800 bg-gray-900/60 overflow-hidden">
                <div className="px-3 py-2.5 border-b border-gray-800 flex items-center gap-2">
                  <span className="text-xs font-bold text-white">Bull Put Spread</span>
                  <span className="rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-600/40 px-2 py-0.5 text-[9px] font-bold uppercase">Bullish</span>
                </div>
                <div className="p-3 space-y-2 text-[11px]">
                  <PayoffSvg type="bull-put-spread" />
                  <div className="grid gap-1.5">
                    <InfoRow label="What" value="Sell higher-strike put, buy lower-strike put. Credit spread. Collect premium upfront." />
                    <InfoRow label="When" value="Bullish or neutral outlook. Stock expected to stay above short strike." />
                    <InfoRow label="Market" value="Bullish or range-bound. High IV environments." />
                    <InfoRow label="Risk" value="Defined: spread width − credit received." />
                    <InfoRow label="IV" value="Best in HIGH IV — elevates premium collected." />
                    <InfoRow label="Mistakes" value="Selling too close to price (high assignment risk); not managing when stock drops near short strike." />
                    <InfoRow label="Max P/L" value="Max Profit = credit received. Max Loss = spread width − credit. Breakeven = short strike − credit." />
                  </div>
                </div>
              </div>

              {/* Bear Call Spread */}
              <div className="rounded-xl border border-gray-800 bg-gray-900/60 overflow-hidden">
                <div className="px-3 py-2.5 border-b border-gray-800 flex items-center gap-2">
                  <span className="text-xs font-bold text-white">Bear Call Spread</span>
                  <span className="rounded-full bg-rose-500/15 text-rose-300 border border-rose-700/40 px-2 py-0.5 text-[9px] font-bold uppercase">Bearish</span>
                </div>
                <div className="p-3 space-y-2 text-[11px]">
                  <PayoffSvg type="bear-call-spread" />
                  <div className="grid gap-1.5">
                    <InfoRow label="What" value="Sell lower-strike call, buy higher-strike call. Credit spread. Collect premium upfront." />
                    <InfoRow label="When" value="Bearish or neutral outlook. Stock expected to stay below short strike." />
                    <InfoRow label="Market" value="Bearish or range-bound. High IV environments." />
                    <InfoRow label="Risk" value="Defined: spread width − credit received." />
                    <InfoRow label="IV" value="Best in HIGH IV — elevates premium collected." />
                    <InfoRow label="Mistakes" value="Selling too close to price during uptrend; ignoring upside gap risk." />
                    <InfoRow label="Max P/L" value="Max Profit = credit received. Max Loss = spread width − credit. Breakeven = short strike + credit." />
                  </div>
                </div>
              </div>

              {/* Iron Condor */}
              <div className="rounded-xl border border-gray-800 bg-gray-900/60 overflow-hidden">
                <div className="px-3 py-2.5 border-b border-gray-800 flex items-center gap-2">
                  <span className="text-xs font-bold text-white">Iron Condor</span>
                  <span className="rounded-full bg-sky-500/15 text-sky-300 border border-sky-600/40 px-2 py-0.5 text-[9px] font-bold uppercase">Neutral</span>
                </div>
                <div className="p-3 space-y-2 text-[11px]">
                  <PayoffSvg type="iron-condor" />
                  <div className="grid gap-1.5">
                    <InfoRow label="What" value="Bull Put Spread + Bear Call Spread at 4 strikes. Range-bound profit zone." />
                    <InfoRow label="When" value="Stock expected to stay within a defined range. Neutral outlook." />
                    <InfoRow label="Market" value="Range-bound, low volatility expected. Premium selling opportunity." />
                    <InfoRow label="Risk" value="Defined on both sides. Max loss = wing width − credit." />
                    <InfoRow label="IV" value="Best in HIGH IV — maximum premium collection." />
                    <InfoRow label="Mistakes" value="Wings too narrow (low PoP); opening before known catalysts; not adjusting when one side is threatened." />
                    <InfoRow label="Max P/L" value="Max Profit = credit received. Max Loss = widest wing − credit. Breakevens = inner strikes ± credit." />
                  </div>
                </div>
              </div>

              {/* Butterfly */}
              <div className="rounded-xl border border-gray-800 bg-gray-900/60 overflow-hidden">
                <div className="px-3 py-2.5 border-b border-gray-800 flex items-center gap-2">
                  <span className="text-xs font-bold text-white">Butterfly</span>
                  <span className="rounded-full bg-sky-500/15 text-sky-300 border border-sky-600/40 px-2 py-0.5 text-[9px] font-bold uppercase">Neutral</span>
                </div>
                <div className="p-3 space-y-2 text-[11px]">
                  <PayoffSvg type="butterfly" />
                  <div className="grid gap-1.5">
                    <InfoRow label="What" value="Buy 1 lower strike, sell 2 middle strikes, buy 1 higher strike. Tent-shaped payoff." />
                    <InfoRow label="When" value="Stock expected to land exactly at the middle strike at expiry." />
                    <InfoRow label="Market" value="Very low volatility, precise price target. Pin action expected." />
                    <InfoRow label="Risk" value="Limited to net debit paid (typically small)." />
                    <InfoRow label="IV" value="Works in any IV. Higher IV increases credit but widens breakevens." />
                    <InfoRow label="Mistakes" value="Wrong strike selection; ignoring commission costs on 4-leg trades; not adjusting when price moves toward the body." />
                    <InfoRow label="Max P/L" value="Max Profit = spread width − debit (at middle strike). Max Loss = debit paid. Breakevens = middle ± spread width." />
                  </div>
                </div>
              </div>

              {/* Long Straddle */}
              <div className="rounded-xl border border-gray-800 bg-gray-900/60 overflow-hidden">
                <div className="px-3 py-2.5 border-b border-gray-800 flex items-center gap-2">
                  <span className="text-xs font-bold text-white">Long Straddle</span>
                  <span className="rounded-full bg-sky-500/15 text-sky-300 border border-sky-600/40 px-2 py-0.5 text-[9px] font-bold uppercase">Neutral</span>
                </div>
                <div className="p-3 space-y-2 text-[11px]">
                  <PayoffSvg type="long-straddle" />
                  <div className="grid gap-1.5">
                    <InfoRow label="What" value="Buy an ATM call + ATM put at the same strike and expiry. Profits from big moves either direction." />
                    <InfoRow label="When" value="Expecting a large move but unsure of direction. Earnings, Fed days, catalysts." />
                    <InfoRow label="Market" value="High volatility expected. Breakout or crash scenarios." />
                    <InfoRow label="Risk" value="Limited to total premium paid (both legs). Theta decay is double." />
                    <InfoRow label="IV" value="Best in LOW IV — cheap premium. IV expansion after entry boosts value." />
                    <InfoRow label="Mistakes" value="Buying straddles when IV is already high (overpaying); holding too long through theta decay." />
                    <InfoRow label="Max P/L" value="Max Loss = total premium paid. Max Profit = unlimited (either direction). Breakevens = strike ± total premium." />
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ═══════════════════════════════════════════════════════
              SECTION 10 — STRATEGY GLOSSARY
              ═══════════════════════════════════════════════════════ */}
          <section id="strategy-glossary" className="scroll-mt-24">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <BookOpen size={18} className="text-violet-400" />
              Strategy Glossary
            </h2>

            {/* Options reference table */}
            <DocCard icon={<BookOpen size={15} />} title="Options Reference">
              <div className="overflow-x-auto rounded-lg border border-gray-800">
                <table className="w-full text-xs">
                  <thead className="bg-gray-800/80">
                    <tr className="text-left text-[10px] uppercase tracking-wide text-gray-500">
                      <th className="px-3 py-2">Position</th>
                      <th className="px-3 py-2">Formal Name</th>
                      <th className="px-3 py-2">Your Action</th>
                      <th className="px-3 py-2">Outlook</th>
                    </tr>
                  </thead>
                  <tbody>
                    {optionReference.map(item => (
                      <tr key={item.position} className="border-t border-gray-800/50">
                        <td className="px-3 py-2 font-semibold text-white text-[11px]">{item.position}</td>
                        <td className="px-3 py-2 font-semibold text-violet-300 text-[11px]">{item.formalName}</td>
                        <td className="px-3 py-2 text-gray-400 text-[10px]">{item.action}</td>
                        <td className="px-3 py-2 text-gray-400 text-[10px]">{item.outlook}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </DocCard>

            {/* Detailed examples */}
            <DocCard icon={<BarChart2 size={15} />} title="Strategy Examples & Risk Profiles">
              <div className="grid gap-2 sm:grid-cols-2">
                {optionExamples.map(item => (
                  <div key={item.title} className="bg-gray-800/40 border border-gray-700/50 rounded-lg p-3">
                    <div className="text-xs font-semibold text-white mb-1.5">{item.title}</div>
                    <div className="space-y-1 text-[10px] leading-relaxed">
                      <div><span className="text-gray-600">Setup:</span> <span className="text-gray-300">{item.setup}</span></div>
                      <div><span className="text-emerald-400">Profit:</span> <span className="text-gray-400">{item.profit}</span></div>
                      <div><span className="text-red-400">Risk:</span> <span className="text-gray-400">{item.risk}</span></div>
                      <div><span className="text-violet-300">Best when:</span> <span className="text-gray-400">{item.bestWhen}</span></div>
                    </div>
                  </div>
                ))}
              </div>
            </DocCard>

            {/* Full glossary grid */}
            <DocCard icon={<HelpCircle size={15} />} title="Complete Options Glossary">
              <div className="grid gap-2 md:grid-cols-2">
                {glossaryTerms.map(item => (
                  <div key={item.term} className="bg-gray-800/40 border border-gray-700/50 rounded-lg p-3">
                    <div className="font-semibold text-violet-300 text-xs">{item.term}</div>
                    <div className="text-[10px] text-gray-400 mt-1 leading-relaxed">{item.def}</div>
                  </div>
                ))}
              </div>
            </DocCard>

            {/* Directional Bias & Confidence */}
            <DocCard icon={<TrendingUp size={15} />} title="Directional Bias &amp; Confidence">
              <div className="space-y-3 text-xs text-gray-400">
                <p>The engine's assessment of where the stock price is likely to move, based on trend analysis, momentum indicators, volume patterns, and market context.</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {[
                    { level: 'High (80–100%)', desc: 'Very strong directional conviction. Multiple trend systems agree, momentum aligned, market context supportive. Suitable for full-position sizing.' },
                    { level: 'Moderate (60–80%)', desc: 'Strong directional structure. Momentum and market broadly aligned, but secondary indicators lag. Standard position sizing.' },
                    { level: 'Low (30–60%)', desc: 'Trend exists but lacks strong confirmation. Higher probability of false breakouts. Consider smaller size or debit spreads.' },
                    { level: 'Very Low (0–30%)', desc: 'Very weak conviction. Trend models disagree, momentum unclear. Consider non-directional strategies or waiting.' },
                  ].map(c => (
                    <div key={c.level} className="rounded-lg bg-gray-800/40 border border-gray-700/50 px-3 py-2">
                      <div className="font-semibold text-gray-200 text-[11px]">{c.level}</div>
                      <div className="text-[10px] text-gray-400 mt-0.5">{c.desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            </DocCard>

            {/* AI Guidance Terms */}
            <DocCard icon={<Brain size={15} />} title="AI Guidance Terms">
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  { term: 'Strong leader vs QQQ', def: 'The stock is outperforming the Nasdaq 100. A bullish relative strength signal.' },
                  { term: 'Wait for pullback', def: 'The stock has moved up and is extended. Waiting for a pullback provides better risk/reward.' },
                  { term: 'Breakout territory', def: 'Stock approaching or breaking a key resistance level. Entering with volume confirmation.' },
                  { term: 'Liquidity too thin', def: 'Wide bid-ask spreads or low open interest. Skip this setup.' },
                  { term: 'Avoid chasing extended candles', def: 'Stock moved sharply in a short period. Wait for consolidation.' },
                  { term: 'Trend is your friend', def: 'The dominant trend supports the trade direction. Trade with the trend.' },
                  { term: 'Constructive tape', def: 'Healthy market price action. Steady buying, good breadth, controlled volatility.' },
                ].map(c => (
                  <div key={c.term} className="rounded-lg bg-gray-800/40 border border-gray-700/50 px-3 py-2">
                    <div className="font-semibold text-gray-200 text-[11px]">{c.term}</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">{c.def}</div>
                  </div>
                ))}
              </div>
            </DocCard>

            {/* Technical Metrics */}
            <DocCard icon={<Gauge size={15} />} title="Technical Metrics Glossary">
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  { term: 'RSI (Relative Strength Index)', def: 'A momentum oscillator (0–100). Above 70 = overbought, below 30 = oversold.' },
                  { term: 'VWAP (Volume-Weighted Average Price)', def: 'Average price weighted by volume. Price above = bullish bias; below = bearish bias.' },
                  { term: 'Volume Ratio', def: 'Current volume vs average. Above 1.5 confirms move strength.' },
                  { term: 'DTE (Days to Expiry)', def: 'Days until option expires. Engine prefers 14–56 DTE.' },
                  { term: 'Distance from 200-MA', def: '% from 200-day MA. Positive = above long-term trend (bullish).' },
                  { term: 'Distance from 52W High', def: '% from 52-week high. Near 0% = at highs (momentum).' },
                  { term: 'Trend Score', def: 'Composite metric of multi-timeframe trend analysis. Higher = stronger alignment.' },
                  { term: 'Edge Score', def: 'Composite quality (0–100) combining Signal Fit, Structure, Liquidity, IV Fit.' },
                  { term: 'MACD', def: 'Moving Average Convergence Divergence. Crossovers confirm trend direction.' },
                ].map(c => (
                  <div key={c.term} className="rounded-lg bg-gray-800/40 border border-gray-700/50 px-3 py-2">
                    <div className="font-semibold text-gray-200 text-[11px]">{c.term}</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">{c.def}</div>
                  </div>
                ))}
              </div>
            </DocCard>
          </section>

          {/* ═══════════════════════════════════════════════════════
              SECTION 10 — VALIDATION SYSTEM
             ═══════════════════════════════════════════════════════ */}
          <section id="validation" className="scroll-mt-24">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <CheckCircle2 size={18} className="text-violet-400" />
              Validation System
            </h2>
            <p className="text-xs text-gray-500 mb-4">Every trade candidate passes through 10 independent validation checks before reaching a verdict. These checks form the quality gate that separates actionable setups from speculative entries.</p>

            <DocCard icon={<List size={15} />} title="The 10-Point Pre-Trade Checklist">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wide text-gray-600 border-b border-gray-800">
                      <th className="px-3 py-2 w-8">#</th>
                      <th className="px-3 py-2">Check</th>
                      <th className="px-3 py-2 w-20">Hard Fail</th>
                      <th className="px-3 py-2">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {checklistItems.map((c, i) => (
                      <tr key={c.name} className="border-b border-gray-800/40">
                        <td className="px-3 py-2 text-gray-600 font-mono">{i + 1}</td>
                        <td className="px-3 py-2 font-semibold text-gray-200 text-[11px]">{c.name}</td>
                        <td className="px-3 py-2">
                          {c.hardFail
                            ? <BadgePill text="HARD" cls="bg-rose-900/40 border-rose-700/40 text-rose-300" />
                            : <BadgePill text="SOFT" cls="bg-amber-900/30 border-amber-700/30 text-amber-300" />
                          }
                        </td>
                        <td className="px-3 py-2 text-gray-400 text-[10px]">{c.desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </DocCard>

            <DocCard icon={<Scale size={15} />} title="Entry State Decision Flow">
              <div className="rounded-xl border border-gray-800 bg-gray-950/30 p-4 mb-3">
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  {['10 Checks', 'Hard Fail Detection', 'Soft Fail Count', 'Warning Stack', 'Kelly Edge Validation', 'Entry State'].map((step, i) => (
                    <div key={step} className="flex items-center gap-2">
                      <span className="rounded-lg bg-gray-800/60 border border-gray-700/50 px-2 py-1 text-gray-300 font-medium">{step}</span>
                      {i < 5 && <ChevronRight size={11} className="text-gray-700" />}
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {verdictRules.map(v => (
                  <div key={v.verdict} className="rounded-lg border border-gray-800 bg-black/20 px-3 py-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className={v.color}>{v.icon}</span>
                      <BadgePill text={v.verdict} cls={v.badge} />
                    </div>
                    <p className="text-[10px] text-gray-400 leading-relaxed">{v.desc}</p>
                  </div>
                ))}
              </div>
            </DocCard>

            <DocCard icon={<Trophy size={15} />} title="Recommendation Score (100 pts)">
              <div className="grid gap-2 sm:grid-cols-2">
                {scoringRules.map(r => (
                  <div key={r.label} className="flex items-start gap-2.5 bg-gray-800/40 border border-gray-700/50 rounded-lg px-3 py-2">
                    <div className="shrink-0 w-10 h-5 rounded-md bg-violet-600/20 flex items-center justify-center text-[10px] font-bold text-violet-300">{r.points}</div>
                    <div>
                      <div className="text-[11px] font-semibold text-gray-200">{r.label}</div>
                      <div className="text-[10px] text-gray-400">{r.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </DocCard>
          </section>

          {/* ═══════════════════════════════════════════════════════
             SECTION 11 — HARD FAIL vs SOFT FAIL
             ═══════════════════════════════════════════════════════ */}
          <section id="hard-soft-fail" className="scroll-mt-24">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <XCircle size={18} className="text-violet-400" />
              Hard Fail vs Soft Fail
            </h2>
            <p className="text-xs text-gray-500 mb-4">The engine uses two failure severity levels. Understanding the difference is critical to interpreting verdicts correctly.</p>

            <div className="grid gap-3 sm:grid-cols-2 mb-4">
              <div className="rounded-xl border border-rose-800/40 bg-rose-950/20 px-4 py-4">
                <div className="flex items-center gap-2 mb-2">
                  <BadgePill text="HARD FAIL" cls="bg-rose-900/40 border-rose-700/40 text-rose-300" />
                  <span className="text-xs font-bold text-rose-200">Fatal — trade is rejected</span>
                </div>
                <ul className="space-y-1.5 text-[11px] text-gray-400">
                  <li className="flex gap-2"><span className="mt-1 h-1.5 w-1.5 rounded-full bg-rose-500 shrink-0" />A single hard fail triggers an automatic AVOID state</li>
                  <li className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-rose-500 shrink-0" />The trade cannot proceed regardless of other check results</li>
                  <li className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-rose-500 shrink-0" />Example: EV ≤ 0, DTE &lt; 14, IV environment mismatch, liquidity failure</li>
                  <li className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-rose-500 shrink-0" />Hard fails protect traders from mathematically unsound or structurally flawed trades</li>
                </ul>
              </div>

              <div className="rounded-xl border border-amber-800/40 bg-amber-950/20 px-4 py-4">
                <div className="flex items-center gap-2 mb-2">
                  <BadgePill text="SOFT FAIL" cls="bg-amber-900/30 border-amber-700/30 text-amber-300" />
                  <span className="text-xs font-bold text-amber-200">Cautionary — trade is downgraded</span>
                </div>
                <ul className="space-y-1.5 text-[11px] text-gray-400">
                  <li className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />Soft fails downgrade the trade to STATE 1: SETUP — conditions forming but not ready to enter</li>
                  <li className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />2+ soft fails can push the state to AVOID even with zero hard fails</li>
                  <li className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />Example: RSI caution zone, MACD divergence, weak confidence, borderline risk/reward</li>
                  <li className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />Soft fails signal: "proceed carefully — reduce size, tighten stops"</li>
                </ul>
              </div>
            </div>

            <DocCard icon={<ToggleLeft size={15} />} title="Hard Fail Conditions">
              <div className="grid gap-2 sm:grid-cols-2">
                {checklistItems.filter(c => c.hardFail).map(c => (
                  <div key={c.name} className="rounded-lg bg-gray-800/40 border border-gray-700/50 px-3 py-2">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                      <span className="text-[11px] font-bold text-gray-200">{c.name}</span>
                    </div>
                    <p className="text-[10px] text-gray-400">{c.desc}</p>
                  </div>
                ))}
              </div>
            </DocCard>

            <DocCard icon={<AlertTriangle size={15} />} title="Soft Fail & Warning Accumulation">
              <div className="space-y-1.5 text-xs text-gray-400">
                <p>Soft fails and warnings stack to determine the final verdict:</p>
                <div className="rounded-lg border border-gray-800 bg-gray-950/30 px-4 py-3 space-y-1.5">
                  {[
                    { condition: '0 hard fails + 0 soft fails + &lt;5 warnings + edge ≥ 5% + score ≥ 70 + IV fits', result: 'STATE 2: ENTRY', tone: 'text-emerald-400' },
                    { condition: '0 hard fails + score ≥ 55 + liquidity passes (1 soft fail or thin edge or warnings ≥ 5)', result: 'STATE 1: SETUP', tone: 'text-amber-400' },
                    { condition: '0 hard fails + score 40–55 (not yet setup-ready)', result: 'WATCH', tone: 'text-sky-400' },
                    { condition: '1+ hard fails OR score &lt; 40', result: 'AVOID', tone: 'text-red-400' },
                  ].map(r => (
                    <div key={r.result} className="flex items-start gap-2 text-[11px]">
                      <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-gray-600 shrink-0" />
                      <span className="text-gray-400">{r.condition} <span className={`font-semibold ${r.tone}`}>→ {r.result}</span></span>
                    </div>
                  ))}
                </div>
              </div>
            </DocCard>
          </section>

          {/* ═══════════════════════════════════════════════════════
             SECTION 12 — EV / PoP / KELLY
             ═══════════════════════════════════════════════════════ */}
          <section id="ev-pop-kelly" className="scroll-mt-24">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Sigma size={18} className="text-violet-400" />
              EV / PoP / Kelly
            </h2>

            <DocCard icon={<Sigma size={15} />} title="Expected Value (EV)">
              <div className="space-y-3 text-xs text-gray-400">
                <p className="leading-relaxed">Expected Value measures the probability-weighted average outcome of a trade repeated many times. A positive EV means the trade has a mathematical edge.</p>
                <FormulaBlock formula="EV = (PoP × Max Profit) − (Prob of Max Loss × Max Loss)" />
                <div className="rounded-lg bg-gray-800/40 border border-gray-700/50 px-3 py-2 space-y-1">
                  <div className="font-semibold text-gray-200 text-[11px]">Worked example (Bull Put Spread)</div>
                  <div className="text-[10px] text-gray-400">Max profit = $120, Max loss = $380, PoP = 76%, Prob of max loss = 24%</div>
                  <div className="text-[10px] text-gray-300 font-mono">EV = ($120 × 0.76) − ($380 × 0.24) = $91.20 − $91.20 = $0.00</div>
                  <div className="text-[10px] text-amber-200/90">Zero EV means the trade has no mathematical edge. The engine requires EV &gt; 0 to pass the EV check.</div>
                </div>
                <p className="text-amber-200/90">A trade with EV ≤ 0 is <strong>automatically rejected</strong> by the EV Hard Gate — no amount of good signal alignment can fix negative expected value.</p>
              </div>
            </DocCard>

            <DocCard icon={<ShieldCheck size={15} />} title="Probability of Profit (PoP)">
              <div className="space-y-3 text-xs text-gray-400">
                <p>Probability of Profit estimates the likelihood that the trade expires with any profit. Calculated from delta-based probabilities and structure geometry.</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  {[
                    { strategy: 'Credit spreads (Bull Put, Bear Call, Iron Condor)', pass: '≥ 62%', warn: '52–62%', fail: '< 52%' },
                    { strategy: 'Covered Call / Covered Put', pass: '≥ 65%', warn: '55–65%', fail: '< 55%' },
                    { strategy: 'Long / Debit trades', pass: '≥ 45%', warn: '35–45%', fail: '< 35%' },
                  ].map(r => (
                    <div key={r.strategy} className="rounded-lg bg-gray-800/40 border border-gray-700/50 px-3 py-2">
                      <div className="text-[10px] font-semibold text-gray-200 mb-1">{r.strategy}</div>
                      <div className="text-[10px] space-y-0.5">
                        <div><span className="text-emerald-400">Pass:</span> {r.pass}</div>
                        <div><span className="text-amber-400">Warn:</span> {r.warn}</div>
                        <div><span className="text-red-400">Fail:</span> {r.fail}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </DocCard>

            <DocCard icon={<Scale size={15} />} title="Kelly Criterion & Position Sizing">
              <div className="space-y-3 text-xs text-gray-400">
                <p>The Kelly Criterion calculates the mathematically optimal fraction of capital to risk on a trade:</p>
                <FormulaBlock formula="Kelly % = EV ÷ Max Loss" />
                <div className="rounded-lg bg-gray-800/40 border border-gray-700/50 px-3 py-3 space-y-1.5">
                  <div className="font-semibold text-gray-200 text-[11px]">Worked example (WDC $5 spread)</div>
                  <div className="text-[10px] text-gray-400">EV = $0.20, Max loss = $3.90</div>
                  <div className="text-[10px] text-gray-300 font-mono">Kelly% = $0.20 ÷ $3.90 = 5.1%</div>
                  <div className="text-[10px] text-gray-300 font-mono">Half-Kelly = 5.1% ÷ 2 = 2.55% of capital, capped at 20%</div>
                  <div className="text-[10px] text-emerald-200/90">Recommended position size: 2.55% of account → 1 contract</div>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-lg border border-gray-800 bg-black/20 px-3 py-3">
                    <div className="text-[11px] font-bold text-gray-200 mb-1">Edge Ratio</div>
                    <FormulaBlock formula="Edge Ratio = EV ÷ Max Loss (as %)" />
                    <div className="text-[10px] text-gray-400 mt-1">Below 5% = "thin edge" warning. Above 5% = solid edge. Normalizes across different position sizes.</div>
                  </div>
                  <div className="rounded-lg border border-gray-800 bg-black/20 px-3 py-3">
                    <div className="text-[11px] font-bold text-gray-200 mb-1">Capital at Risk</div>
                    <FormulaBlock formula="Capital at Risk = Contracts × Max Loss × 100" />
                    <div className="text-[10px] text-gray-400 mt-1">Amber above 10% of account. Red above 20%. Kelly math says &gt;20% is outside optimal range.</div>
                  </div>
                </div>

                <div className="bg-gray-800/40 border border-gray-700/50 rounded-lg px-3 py-2">
                  <div className="font-semibold text-gray-200 text-[10px] mb-1">Why Half-Kelly?</div>
                  <p className="text-[10px] text-gray-400 leading-relaxed">Raw Kelly assumes perfect probability estimates, which never exist in trading. Halving the fraction (Half-Kelly) protects against estimation error and reduces drawdown severity. Practitioners widely prefer Half-Kelly over Full-Kelly.</p>
                </div>
              </div>
            </DocCard>

            {/* Preserve existing EV model details */}
            <DocCard icon={<BarChart2 size={15} />} title="EV Models Per Strategy">
              <div className="space-y-3 text-xs text-gray-400">
                <p>The engine uses Black-Scholes EV for multi-leg structures and binary EV for single-leg positions. Each strategy has a specific formula:</p>

                <div className="overflow-x-auto rounded-lg border border-gray-800">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-800/80">
                      <tr className="text-left text-[10px] uppercase tracking-wide text-gray-500">
                        <th className="px-3 py-2">Strategy</th>
                        <th className="px-3 py-2">EV Model</th>
                        <th className="px-3 py-2">Max Profit</th>
                        <th className="px-3 py-2">Max Loss</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ['Long Call', 'Black-Scholes', 'Unlimited (model truncates at 3× strike)', 'Premium paid'],
                        ['Long Put', 'Black-Scholes', 'Strike − Premium (stock → $0)', 'Premium paid'],
                        ['Bull Put Spread', 'Binary (credit)', 'Credit received', 'Spread width − credit'],
                        ['Bear Call Spread', 'Binary (credit)', 'Credit received', 'Spread width − credit'],
                        ['Iron Condor', 'Binary (credit)', 'Credit received', 'Wing width − credit'],
                        ['Covered Call', 'No EV (Income Yield)', 'Strike + premium − entry', 'Stock loss − premium'],
                        ['Covered Put', 'No EV (Income Yield)', 'Premium collected', 'Strike − premium'],
                        ['Short Put (naked)', 'Binary (naked)', 'Premium collected', 'Strike × 100 − premium'],
                      ].map(row => (
                        <tr key={row[0]} className="border-t border-gray-800/50">
                          <td className="px-3 py-2 font-semibold text-gray-200 text-[10px]">{row[0]}</td>
                          <td className="px-3 py-2 text-gray-400 text-[10px]">{row[1]}</td>
                          <td className="px-3 py-2 text-emerald-400/80 text-[10px]">{row[2]}</td>
                          <td className="px-3 py-2 text-red-400/80 text-[10px]">{row[3]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="bg-amber-950/20 border border-amber-800/40 rounded-lg px-4 py-3 text-[11px] text-amber-200/90 leading-relaxed">
                  <strong>Why positive EV still may be CAUTION:</strong> A trade can have positive EV but still receive a CAUTION verdict. The Edge Ratio (EV ÷ max loss) might be below 5%, meaning the edge is thin relative to the risk. Small model errors or slippage could erase a thin edge entirely. CAUTION with positive EV says "the math works, but the margin is tight."
                </div>
              </div>
            </DocCard>
          </section>

          {/* ═══════════════════════════════════════════════════════
             SECTION 12B — GOLDEN RULES
             ═══════════════════════════════════════════════════════ */}
          <section id="golden-rules" className="scroll-mt-24">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Award size={18} className="text-amber-400" />
              Golden Rules
            </h2>
            <p className="text-xs text-gray-500 mb-4">Hard rules that override any signal or suggestion. These protect your account from the most common options trading mistakes.</p>

            <div className="grid gap-3 sm:grid-cols-2">
              <DocCard icon={<Ban size={15} />} title="Never Hold Options <14 DTE Through Earnings">
                <p className="text-xs text-gray-400 leading-relaxed">Earnings events cause IV crush and gap risk. Options with less than 14 DTE cannot absorb the volatility collapse. Close before earnings or choose a further expiry.</p>
              </DocCard>
              <DocCard icon={<Ban size={15} />} title="Never Buy at Market Open (6:30–6:45 AM PST)">
                <p className="text-xs text-gray-400 leading-relaxed">The first 15 minutes capture overnight order imbalances, spreads are widest, and false breakouts are common. Wait for the opening range to establish before entering.</p>
              </DocCard>
              <DocCard icon={<Ban size={15} />} title="Never Average Down on Losing Options">
                <p className="text-xs text-gray-400 leading-relaxed">Adding to a losing option position doubles down on a thesis that has already failed. Unlike stocks, options have finite life and accelerating time decay. Cut losses, do not average.</p>
              </DocCard>
              <DocCard icon={<Target size={15} />} title="Always Have a Profit Target AND Stop Loss Before Entering">
                <p className="text-xs text-gray-400 leading-relaxed">Define your exit before your entry. Know exactly where you take profit and where you cut the loss. If you cannot define both levels, the trade is not ready.</p>
              </DocCard>
              <DocCard icon={<Layers size={15} />} title="Always Scale Out — Never Sell Everything at Once">
                <p className="text-xs text-gray-400 leading-relaxed">Selling in pieces lets you capture extended moves while locking in gains. Use the profit-taking plan: +50% → stop to breakeven, +100% → sell half, +150% → sell another quarter, +200%+ → trail the rest.</p>
              </DocCard>
              <DocCard icon={<Clock size={15} />} title="Trading Windows (PST)">
                <p className="text-xs text-gray-400 leading-relaxed">
                  <strong className="text-gray-300">Best entry:</strong> 6:45–7:30 AM PST<br />
                  <strong className="text-gray-300">Avoid:</strong> 8:30–10:00 AM PST (lunch dead zone)<br />
                  <strong className="text-gray-300">Power hour:</strong> 12:00–12:45 PM PST<br />
                  <strong className="text-gray-300">Exit by:</strong> 12:45 PM PST for day trades
                </p>
              </DocCard>
            </div>

            <div className="mt-4 rounded-xl border border-amber-800/30 bg-amber-950/20 px-4 py-3">
              <div className="flex items-start gap-2">
                <AlertTriangle size={15} className="text-amber-400 shrink-0 mt-0.5" />
                <div className="text-[11px] text-amber-200/90 leading-relaxed">
                  These rules are not suggestions. If any signal engine recommends a trade that violates one of these rules, the trade is automatically rejected regardless of score, confidence, or EV.
                </div>
              </div>
            </div>
          </section>

          {/* ═══════════════════════════════════════════════════════
             SECTION 13 — ALERT SYSTEM
             ═══════════════════════════════════════════════════════ */}
          <section id="alerts" className="scroll-mt-24">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Bell size={18} className="text-violet-400" />
              Alert System
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { title: 'Entry Alerts', desc: 'Triggered when entry conditions are met for a watched trade. Includes price level, confirmation status, and suggested action.' },
                { title: 'VWAP Alerts', desc: 'Intraday alerts when price crosses VWAP or establishes support/resistance at VWAP. Critical for day trade execution timing.' },
                { title: 'Breakout Alerts', desc: 'Price breaks a key level (ORH, resistance, MA cross) with volume confirmation. Includes breakout strength assessment.' },
                { title: 'Profit Protection', desc: 'Price approaches profit target or key resistance. Suggests taking partial profits or trailing stops.' },
                { title: 'Risk Alerts', desc: 'Adverse price movement, IV expansion, VIX spike, or earnings approaching. Triggers position review.' },
                { title: 'Assignment Alerts', desc: 'Options approaching expiry ITM. Alerts for assignment risk, early exercise, or roll decisions.' },
              ].map(a => (
                <div key={a.title} className="rounded-xl border border-gray-800 bg-gray-900/60 px-4 py-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-violet-500" />
                    <div className="text-xs font-semibold text-gray-200">{a.title}</div>
                  </div>
                  <p className="text-[10px] text-gray-400 leading-relaxed">{a.desc}</p>
                </div>
              ))}
            </div>

            <DocCard icon={<Activity size={15} />} title="Polling Intervals">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wide text-gray-600 border-b border-gray-800">
                      <th className="px-2 py-1.5 font-semibold">Alert Type</th>
                      <th className="px-2 py-1.5 font-semibold">Interval</th>
                      <th className="px-2 py-1.5 font-semibold">Why</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ['Day Trade state change', '15 min', 'Day trades move fast — 30 min can miss the entry window entirely.'],
                      ['Swing Trade state change', '30 min', 'Swing states develop over hours, 30 min is sufficient.'],
                      ['Position warnings (EXIT, Sell Half)', 'Real-time / 5 min', 'Time-critical — delay costs money.'],
                    ].map(r => (
                      <tr key={r[0]} className="border-b border-gray-800/40 text-[11px]">
                        <td className="px-2 py-1.5 font-semibold text-gray-200">{r[0]}</td>
                        <td className="px-2 py-1.5 font-mono text-sky-300">{r[1]}</td>
                        <td className="px-2 py-1.5 text-gray-400">{r[2]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </DocCard>

            <DocCard icon={<Bell size={15} />} title="State Transition Triggers (My Tickers)">
              <div className="space-y-2 text-xs text-gray-400">
                <p>The alert scan loop runs every 15 minutes and checks each ticker in your My Tickers list for state changes.</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2">
                    <div className="font-semibold text-sky-300 text-[11px]">Day Trade — poll every 15 min</div>
                    <ul className="mt-1 space-y-0.5 text-[10px] text-gray-500">
                      <li className="flex gap-2"><span className="mt-1 h-1 w-1 rounded-full bg-gray-600 shrink-0" />STATE 1 → 2 — setup advancing, prepare</li>
                      <li className="flex gap-2"><span className="mt-1 h-1 w-1 rounded-full bg-gray-600 shrink-0" />STATE 2 → 3 — entry confirmed, act now</li>
                      <li className="flex gap-2"><span className="mt-1 h-1 w-1 rounded-full bg-gray-600 shrink-0" />STATE 3 → 4 — exit triggered, close</li>
                      <li className="flex gap-2"><span className="mt-1 h-1 w-1 rounded-full bg-gray-600 shrink-0" />STATE 3 → 2 — breakout failed, re-evaluate</li>
                      <li className="flex gap-2"><span className="mt-1 h-1 w-1 rounded-full bg-gray-600 shrink-0" />STATE 2 → 1 — setup invalidated, stand down</li>
                    </ul>
                  </div>
                  <div className="rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2">
                    <div className="font-semibold text-emerald-300 text-[11px]">Swing Trade — poll every 30 min</div>
                    <ul className="mt-1 space-y-0.5 text-[10px] text-gray-500">
                      <li className="flex gap-2"><span className="mt-1 h-1 w-1 rounded-full bg-gray-600 shrink-0" />Same state transitions as Day Trade</li>
                      <li className="flex gap-2"><span className="mt-1 h-1 w-1 rounded-full bg-gray-600 shrink-0" />Swing states develop over hours</li>
                      <li className="flex gap-2"><span className="mt-1 h-1 w-1 rounded-full bg-gray-600 shrink-0" />Every 2nd scan cycle (15 min × 2)</li>
                    </ul>
                  </div>
                </div>
                <div className="rounded-lg border border-amber-800/30 bg-amber-950/10 px-3 py-2">
                  <p className="font-semibold text-amber-300 text-[11px]">How it works</p>
                  <p className="text-[10px] text-gray-400 mt-1 leading-relaxed">The scan runs for tickers in your <strong className="text-gray-200">My Tickers</strong> list. Each ticker's last known state is stored in the database. When the engine returns a different state on the next scan, an email alert fires showing the ticker, engine, old state → new state, and the action label. The scan resets at the start of each trading session so stale states don't trigger false alerts.</p>
                </div>
              </div>
            </DocCard>

            <DocCard icon={<Target size={15} />} title="Day Trade Smart Alerts (My Tickers — 3 Alert Types)">
              <div className="space-y-3 text-xs text-gray-400">
                <p>Beyond state-change emails, the scan loop emits three purpose-built alerts that fire independently of state transitions. Each fires <strong className="text-gray-200">once per session per ticker</strong> and resets the next trading day.</p>

                {/* Gap 1 — Take-profit */}
                <div className="rounded-lg border border-yellow-800/40 bg-yellow-950/10 px-3 py-2.5 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">💰</span>
                    <span className="font-semibold text-yellow-300 text-[11px]">Gap 1 — Take-Profit Target Hit</span>
                    <span className="ml-auto font-mono text-[10px] text-gray-500">alertType: TARGET_REACHED</span>
                  </div>
                  <p className="text-[11px] leading-relaxed"><strong className="text-gray-200">When:</strong> State is IN-PLAY (3) and last price ≥ scalp target (long) or ≤ scalp target (short).</p>
                  <p className="text-[11px] leading-relaxed"><strong className="text-gray-200">Scalp target:</strong> entry price × 1.015 for longs (+1.5%), × 0.985 for shorts (−1.5%). Special: VWAP-rejection longs target OR high; ORL-rejection shorts target extension below day low.</p>
                  <p className="text-[11px] leading-relaxed"><strong className="text-gray-200">Action:</strong> Exit now or move stop to breakeven. The email gold card shows current price, target, VWAP, risk level.</p>
                  <div className="rounded bg-gray-900/60 px-2 py-1 font-mono text-[10px] text-gray-400">
                    Subject: 💰 OptionAdvisor: Take-profit target hit — MU
                  </div>
                  <p className="text-[10px] text-gray-500">Why it matters: without this alert, winners ride back to zero. MU today: +61% on calls; AMD today: +61% on puts — both recovered the full move after the target. Gap 1 is the exit you set automatically.</p>
                </div>

                {/* Gap 2 — Stalling breakout */}
                <div className="rounded-lg border border-orange-800/40 bg-orange-950/10 px-3 py-2.5 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">⚠️</span>
                    <span className="font-semibold text-orange-300 text-[11px]">Gap 2 — Breakout Stalling (Weak Follow-Through)</span>
                    <span className="ml-auto font-mono text-[10px] text-gray-500">alertType: WEAK_BREAKOUT</span>
                  </div>
                  <p className="text-[11px] leading-relaxed"><strong className="text-gray-200">When:</strong> State is IN-PLAY (3) for ≥ 30 minutes and price has not extended ≥ 0.3% past ORH (long) or ORL (short).</p>
                  <p className="text-[11px] leading-relaxed"><strong className="text-gray-200">Thresholds:</strong> wait = 30 min (2 scan cycles), extension = 0.3% beyond ORH/ORL. Both are tunable constants.</p>
                  <p className="text-[11px] leading-relaxed"><strong className="text-gray-200">Action:</strong> Exit or set hard stop at ORH. Price is stalling — time decay is working against any options held. The orange card shows elapsed IN-PLAY time, current price vs ORH/ORL, and NARROW OR badge if applicable.</p>
                  <div className="rounded bg-gray-900/60 px-2 py-1 font-mono text-[10px] text-gray-400">
                    Subject: ⚠️ OptionAdvisor: Breakout stalling — TSLA
                  </div>
                  <p className="text-[10px] text-gray-500">Why it matters: TSLA today entered IN-PLAY at $404 (ORH) but never exceeded $405.21 (ORH+0.3%). Without Gap 2, you'd hold a dead call for 2+ hours through a full reversal to $405 → $401. Gap 2 fires at 30 min and says exit.</p>
                </div>

                {/* Gap 3 — Narrow OR */}
                <div className="rounded-lg border border-amber-800/30 bg-amber-950/10 px-3 py-2.5 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">🟡</span>
                    <span className="font-semibold text-amber-300 text-[11px]">Gap 3 — Narrow OR Caution (Pre-Entry Filter)</span>
                    <span className="ml-auto font-mono text-[10px] text-gray-500">field: narrowOrCaution</span>
                  </div>
                  <p className="text-[11px] leading-relaxed"><strong className="text-gray-200">When:</strong> A state-change alert fires for ENTRY → IN-PLAY and OR width % {'<'} 1.5%. OR width = (ORH − ORL) / ORL × 100.</p>
                  <p className="text-[11px] leading-relaxed"><strong className="text-gray-200">What it does:</strong> Does not block the entry — adds an amber ⚠️ warning strip inside the IN-PLAY email card and a gold border. The NARROW OR badge shows in the card header.</p>
                  <p className="text-[11px] leading-relaxed"><strong className="text-gray-200">Action:</strong> Half-size or skip. Require price to hold {'>'} 0.5% past ORH for 2+ bars before adding full size.</p>
                  <div className="grid grid-cols-2 gap-2 text-[10px] mt-1">
                    <div className="rounded bg-gray-900/60 px-2 py-1">
                      <span className="text-gray-500">TSLA (flagged):</span><br />
                      <span className="font-mono text-amber-300">$4 / $400 = 1.00% ✗</span>
                    </div>
                    <div className="rounded bg-gray-900/60 px-2 py-1">
                      <span className="text-gray-500">MU (clean):</span><br />
                      <span className="font-mono text-emerald-300">$40 / $660 = 6.06% ✓</span>
                    </div>
                    <div className="rounded bg-gray-900/60 px-2 py-1">
                      <span className="text-gray-500">AMD (clean):</span><br />
                      <span className="font-mono text-emerald-300">$18 / $411 = 4.38% ✓</span>
                    </div>
                    <div className="rounded bg-gray-900/60 px-2 py-1">
                      <span className="text-gray-500">AVGO (clean, no IN-PLAY):</span><br />
                      <span className="font-mono text-emerald-300">$10 / $408 = 2.45% ✓</span>
                    </div>
                  </div>
                  <p className="text-[10px] text-gray-500">Threshold 1.5% is tunable via <span className="font-mono">_NARROW_OR_ALERT_PCT</span> in main.py. Raise to 2.0% for more conservative filtering; lower to 0.8% to only flag extreme compression.</p>
                </div>

                {/* Summary table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wide text-gray-600 border-b border-gray-800">
                        <th className="px-2 py-1.5 font-semibold">Alert</th>
                        <th className="px-2 py-1.5 font-semibold">Color</th>
                        <th className="px-2 py-1.5 font-semibold">Fires when</th>
                        <th className="px-2 py-1.5 font-semibold">Your action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ['💰 Take-Profit', 'Gold card', 'Price hits scalp target while IN-PLAY', 'Exit or trail stop to breakeven'],
                        ['⚠ Stalling', 'Orange card', '30 min IN-PLAY, <0.3% past ORH/ORL', 'Exit or hard stop at ORH'],
                        ['🟡 Narrow OR', 'Amber strip on green card', 'OR width <1.5% on IN-PLAY entry', 'Half-size or skip entirely'],
                        ['⚡ State Change', 'Green/Red/Amber card', 'State number changes (1↔2↔3)', 'Context — know where you are'],
                      ].map(r => (
                        <tr key={r[0]} className="border-b border-gray-800/40">
                          <td className="px-2 py-1.5 font-semibold text-gray-200">{r[0]}</td>
                          <td className="px-2 py-1.5 text-gray-400">{r[1]}</td>
                          <td className="px-2 py-1.5 text-gray-400">{r[2]}</td>
                          <td className="px-2 py-1.5 text-gray-300">{r[3]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </DocCard>

            <DocCard icon={<ShieldAlert size={15} />} title="Position Warnings (Positions Center)">
              <div className="space-y-2 text-xs text-gray-400">
                <p>Position warnings fire immediately (or within 5 minutes) when a monitored position reaches a critical threshold:</p>
                <div className="grid gap-1.5">
                  {[
                    'EXIT NOW — DTE ≤ 5 or health score critical',
                    'Sell Half / Scale Out — 50%+ of max profit captured',
                    'Stop Hit — loss exceeds predefined stop level',
                    'DTE < 5 on losing position — time decay accelerating',
                    'Loss > threshold on short-dated option — gamma risk imminent',
                  ].map(w => (
                    <div key={w} className="flex items-start gap-2 rounded-lg bg-gray-800/40 border border-gray-700/50 px-3 py-1.5">
                      <AlertTriangle size={11} className="mt-0.5 shrink-0 text-amber-400" />
                      <span className="text-[10px] text-gray-400">{w}</span>
                    </div>
                  ))}
                </div>
              </div>
            </DocCard>

            <DocCard icon={<Clock size={15} />} title="Recommended Defaults">
              <div className="rounded-lg border border-emerald-800/30 bg-emerald-950/10 px-3 py-2.5 text-xs">
                <p className="text-gray-400 leading-relaxed">
                  <strong className="text-emerald-300">15 minutes is the right default for day trade.</strong> A state 1→2 transition that you see 30 minutes late is often already STATE 3 or failed. You need to act within the window. Add tickers like AMD, AVGO, NVDA, AAPL, GOOG to your My Tickers list and every state transition will trigger an email alert within 15 minutes.
                </p>
              </div>
            </DocCard>
          </section>

          {/* ═══════════════════════════════════════════════════════
             SECTION — RANGE & R/R ANALYSIS
             ═══════════════════════════════════════════════════════ */}
          <section id="range-analysis" className="scroll-mt-24">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Gauge size={18} className="text-violet-400" />
              Daily Range & R/R Analysis
            </h2>

            <DocCard icon={<BarChart2 size={15} />} title="What Is Daily Range Used?">
              <p className="text-[11px] text-gray-400 leading-relaxed mb-3">
                Every stock has a typical daily range — the distance from the session low to the session high. "Range Used %" tells you how much of that range has already been consumed by the time you look at a trade entry. Entering when most of the range is gone means chasing a nearly finished move.
              </p>
              <div className="rounded-lg border border-gray-800 bg-gray-900/60 p-3 font-mono text-[11px] text-gray-300 space-y-1 mb-3">
                <div><span className="text-gray-600">Day High:  </span>$730.36</div>
                <div><span className="text-gray-600">Day Low:   </span>$647.79</div>
                <div><span className="text-gray-600">Range:     </span>$82.57 (100%)</div>
                <div className="border-t border-gray-800 pt-1 mt-1"><span className="text-gray-600">Price now: </span>$716.93</div>
                <div><span className="text-gray-600">From low:  </span>$69.14 / $82.57 = <span className="text-rose-400 font-bold">83.7% used</span></div>
              </div>
              <p className="text-[11px] text-gray-400 leading-relaxed">
                Think of it like a fuel tank. The stock started the day with $82 of range. It has already consumed $69 of that fuel. Only $13 remains. Buying a CALL at $716 targeting $727 means you are betting on the last 12% of the tank reaching the destination — while risking $53 if the stop is at $663.
              </p>
            </DocCard>

            <DocCard icon={<Gauge size={15} />} title="Range Phase Thresholds">
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wide text-gray-600 border-b border-gray-800">
                      <th className="px-3 py-2 font-semibold">Phase</th>
                      <th className="px-3 py-2 font-semibold">Range Used</th>
                      <th className="px-3 py-2 font-semibold">Meaning</th>
                      <th className="px-3 py-2 font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ['EARLY',     '0 – 40%',  'Big move still possible. Most fuel remains.',        'Enter with full confidence when other signals align.', 'text-emerald-400'],
                      ['MID',       '40 – 65%', 'Decent room left. Entry is acceptable.',             'Consider entry. Watch for confirmation.', 'text-sky-400'],
                      ['LATE',      '65 – 80%', 'Getting tight. Reward is shrinking.',                'Require tighter confirmation. Reduce size.', 'text-amber-400'],
                      ['EXHAUSTED', '80%+',     'Tank nearly empty. Move is mostly over.',            'Avoid new entries. Wait for a pullback and reset.', 'text-rose-400'],
                    ].map(([phase, range, meaning, action, tone]) => (
                      <tr key={phase} className="border-b border-gray-800/40">
                        <td className={`px-3 py-2 font-bold font-mono text-[11px] ${tone}`}>{phase}</td>
                        <td className="px-3 py-2 font-mono text-[11px] text-gray-300">{range}</td>
                        <td className="px-3 py-2 text-[11px] text-gray-400">{meaning}</td>
                        <td className="px-3 py-2 text-[11px] text-gray-400">{action}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 rounded-lg border border-emerald-800/30 bg-emerald-950/10 px-3 py-2 text-[11px] text-gray-400">
                <strong className="text-emerald-300">Golden rule:</strong> Enter trades when range is 0–50% used. That is when the most fuel remains and R/R is cleanest. On most tickers the best CALL or PUT entry is in the first 60–90 minutes of the session, when the opening range is fresh.
              </div>
            </DocCard>

            <DocCard icon={<Scale size={15} />} title="Risk/Reward (R/R) Requirements">
              <p className="text-[11px] text-gray-400 leading-relaxed mb-3">
                R/R = (Target − Entry) / (Entry − Stop). A 1:1 ratio means you risk $1 to make $1. Day trade options have additional theta decay, so the bar is higher than for stock trades.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wide text-gray-600 border-b border-gray-800">
                      <th className="px-3 py-2 font-semibold">R/R</th>
                      <th className="px-3 py-2 font-semibold">Signal</th>
                      <th className="px-3 py-2 font-semibold">For Options</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ['2:1 +',  '✅ Strong',  'Ideal. Theta decay is well offset by the reward potential.', 'text-emerald-400'],
                      ['1.5:1',  '✅ Good',    'Acceptable for day trades with clear confirmation.', 'text-emerald-400'],
                      ['1:1',    '⚠️ Borderline', 'Minimum viable. Only take with high-conviction confirmation.', 'text-amber-400'],
                      ['0.5:1',  '🔴 Poor',   'Avoid. You need a very high win rate to break even.', 'text-rose-400'],
                      ['< 0.5:1','❌ Terrible','Do not enter. The math does not work regardless of confidence.', 'text-rose-400'],
                    ].map(([rr, signal, desc, tone]) => (
                      <tr key={rr} className="border-b border-gray-800/40">
                        <td className={`px-3 py-2 font-bold font-mono text-[11px] ${tone}`}>{rr}</td>
                        <td className="px-3 py-2 text-[11px] text-gray-300">{signal}</td>
                        <td className="px-3 py-2 text-[11px] text-gray-400">{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 rounded-lg border border-rose-800/30 bg-rose-950/10 px-3 py-2 text-[11px] text-gray-400">
                <strong className="text-rose-300">MU example (above):</strong> Entry $716 → Target $727 = $11 reward. Entry $716 → Stop $663 = $53 risk. R/R = 0.2:1. This is a terrible trade — you risk $53 to make $11, even with a bullish structure. The move was already 88% done.
              </div>
            </DocCard>

            <DocCard icon={<Target size={15} />} title="Combining Range + R/R">
              <p className="text-[11px] text-gray-400 leading-relaxed mb-2">
                Both signals must be acceptable before entering. A good R/R with an exhausted range still means chasing. A good range phase with poor R/R still means the setup is misaligned.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  { range: 'EARLY (20%)', rr: '2.5:1', verdict: '✅ ENTER', tone: 'border-emerald-800/40 bg-emerald-950/15 text-emerald-300' },
                  { range: 'MID (55%)',   rr: '1.5:1', verdict: '✅ CONSIDER', tone: 'border-sky-800/40 bg-sky-950/15 text-sky-300' },
                  { range: 'LATE (72%)',  rr: '1.2:1', verdict: '⚠️ REDUCE SIZE', tone: 'border-amber-800/40 bg-amber-950/15 text-amber-300' },
                  { range: 'EXHAUSTED (88%)', rr: '0.2:1', verdict: '❌ DO NOT ENTER', tone: 'border-rose-800/40 bg-rose-950/15 text-rose-300' },
                ].map(item => (
                  <div key={item.verdict} className={`rounded-lg border px-3 py-2.5 ${item.tone}`}>
                    <div className="text-[10px] font-bold uppercase tracking-wide opacity-60 mb-1">Scenario</div>
                    <div className="text-[11px] font-mono">Range: {item.range} · R/R: {item.rr}</div>
                    <div className="mt-1 text-xs font-bold">{item.verdict}</div>
                  </div>
                ))}
              </div>
            </DocCard>

            <DocCard icon={<Gauge size={15} />} title="Swing Trade: Weekly Range Used">
              <p className="text-[11px] text-gray-400 mb-3">
                Swing trades operate over days-to-weeks. The same &ldquo;gas tank&rdquo; concept applies to the
                5-session (weekly) high/low range — entering after a ticker has already traveled most of its
                weekly range means chasing a nearly complete move.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-gray-800 text-gray-500 text-left">
                      <th className="pb-2 pr-4 font-semibold">Phase</th>
                      <th className="pb-2 pr-4 font-semibold">Weekly Range Used</th>
                      <th className="pb-2 font-semibold">Guidance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-900">
                    {[
                      { phase: 'EARLY',    range: '< 30%',  color: 'text-emerald-400', guidance: 'Fresh move. Full position size appropriate.' },
                      { phase: 'MID',      range: '30–50%', color: 'text-sky-400',     guidance: 'Still room to run. Normal size.' },
                      { phase: 'LATE',     range: '50–70%', color: 'text-amber-400',   guidance: 'Compressed reward. Reduce size, wait for pullback.' },
                      { phase: 'EXTENDED', range: '≥ 70%',  color: 'text-rose-400',    guidance: 'Move nearly complete. Avoid new entries; watch for reversal.' },
                    ].map(row => (
                      <tr key={row.phase}>
                        <td className={`py-2 pr-4 font-mono font-bold ${row.color}`}>{row.phase}</td>
                        <td className="py-2 pr-4 font-mono text-gray-300">{row.range}</td>
                        <td className="py-2 text-gray-400">{row.guidance}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </DocCard>
          </section>

          {/* ═══════════════════════════════════════════════════════
             SECTION 14 — POSITION MANAGEMENT
             ═══════════════════════════════════════════════════════ */}
          <section id="position-mgmt" className="scroll-mt-24">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Briefcase size={18} className="text-violet-400" />
              Position Management
            </h2>
            <p className="text-xs text-gray-500 mb-4">Each position moves through lifecycle stages. The engine provides state-specific guidance for every stage.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                { state: 'WINNER', color: 'text-emerald-400', dot: 'green', desc: 'Position is profitable. Consider trailing stops or partial profit taking. Let winners run with protection.' },
                { state: 'LOSER', color: 'text-rose-400', dot: 'red', desc: 'Position is underwater. Review thesis: is the move against you or is the timing just off? Cut losses at predefined stop.' },
                { state: 'PROTECT PROFITS', color: 'text-amber-400', dot: 'amber', desc: 'Price approaching target zone. Tighten stops. Consider scaling out 50% at target and letting the rest run.' },
                { state: 'ROLL', color: 'text-violet-400', dot: 'violet', desc: 'Position near expiry with remaining thesis. Rolling extends duration at a different strike to maintain exposure.' },
                { state: 'EXIT SOON', color: 'text-amber-400', dot: 'amber', desc: 'Expiry approaching or thesis weakening. Plan the exit. Do not hold into expiry week without a clear plan.' },
                { state: 'STOP LOSS', color: 'text-red-400', dot: 'red', desc: 'Stop level hit or at imminent risk. Execute the stop. Preserve capital for the next opportunity.' },
                { state: 'EXPIRING SOON', color: 'text-gray-400', dot: 'gray', desc: 'Position is in its final week. Gamma risk accelerates. Either close or roll before expiration Friday.' },
              ].map(p => (
                <div key={p.state} className="rounded-xl border border-gray-800 bg-gray-900/60 px-4 py-3">
                  <div className="flex items-center gap-2 mb-1">
                    <BadgeDot tone={p.dot as 'green' | 'amber' | 'red' | 'sky' | 'violet' | 'gray'} />
                    <span className={`text-xs font-bold ${p.color}`}>{p.state}</span>
                  </div>
                  <p className="text-[10px] text-gray-400 leading-relaxed">{p.desc}</p>
                </div>
              ))}
            </div>

            <DocCard icon={<Clock size={15} />} title="Portfolio Tracking Features">
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  'Open P&L with MTM refresh',
                  'Real-time quote streaming',
                  'Entry timing and exit rules saved per position',
                  'Kelly sizing data for post-trade review',
                  'Roll and adjustment suggestions',
                  'Exportable trade logs and reports',
                ].map(f => (
                  <div key={f} className="flex items-center gap-2 text-[11px] text-gray-400">
                    <CheckCircle2 size={11} className="text-emerald-500 shrink-0" />
                    {f}
                  </div>
                ))}
              </div>
            </DocCard>
          </section>

          {/* ═══════════════════════════════════════════════════════
             SECTION 15 — MARKET COMMAND SUMMARY
             ═══════════════════════════════════════════════════════ */}
          <section id="market-summary" className="scroll-mt-24">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <BarChart2 size={18} className="text-violet-400" />
              Market Command Summary
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { title: 'Market Regime', desc: 'Detects the current market environment (bullish, bearish, range-bound, volatile) using SPY/QQQ trend analysis and VIX regime classification.' },
                { title: 'VIX Risk', desc: 'The VIX fear gauge is categorized into tiers: Low (&lt; 15), Normal (15–20), Elevated (20–28), High (28–35), Extreme (≥ 35). Each tier modifies engine behavior and position sizing.' },
                { title: 'Sector Heat', desc: 'Tracks which AI/datacenter sectors are showing relative strength or weakness. Helps rotate capital toward the strongest sub-themes.' },
                { title: 'Reserve Signal — 52W High', desc: 'Measures SPY\'s position relative to its 52-week high and 200-day MA. Shows: At High, Near High, Far Below, Breaking Above. Indicates market momentum extremes.' },
              ].map(c => (
                <div key={c.title} className="rounded-xl border border-gray-800 bg-gray-900/60 px-4 py-3">
                  <div className="text-xs font-semibold text-gray-200 mb-1">{c.title}</div>
                  <p className="text-[10px] text-gray-400 leading-relaxed">{c.desc}</p>
                </div>
              ))}

              {/* 52W High formula */}
              <div className="rounded-xl border border-gray-800 bg-gray-900/60 px-4 py-3 col-span-full">
                <div className="text-xs font-semibold text-gray-200 mb-1">52-Week High Formula</div>
                <FormulaBlock formula="distance = ((currentPrice − high52w) / high52w) × 100" />
                <div className="mt-2 grid gap-1.5 sm:grid-cols-4">
                  {[
                    { state: 'At 52W High', when: 'Within 0.5% of high', cls: 'text-emerald-400' },
                    { state: 'Near High', when: '0.5% – 5% below high', cls: 'text-amber-400' },
                    { state: 'Far Below', when: '> 5% below high', cls: 'text-gray-400' },
                    { state: 'Breaking Above', when: 'Exceeds prior high', cls: 'text-emerald-400' },
                  ].map(d => (
                    <div key={d.state} className="rounded-lg bg-gray-800/40 border border-gray-700/50 px-2.5 py-2 text-center">
                      <div className={`text-[10px] font-bold ${d.cls}`}>{d.state}</div>
                      <div className="text-[9px] text-gray-500">{d.when}</div>
                    </div>
                  ))}
                </div>
              </div>

              <DocCard icon={<ShieldCheck size={15} />} title="Portfolio Exposure">
                <div className="text-xs text-gray-400 space-y-2">
                  <p>The Portfolio Exposure widget aggregates all open positions to show:</p>
                  <ul className="space-y-1 text-[10px] text-gray-500">
                    <li className="flex gap-2"><span className="mt-1 h-1 w-1 rounded-full bg-gray-600 shrink-0" />Total capital deployed vs. available</li>
                    <li className="flex gap-2"><span className="mt-1 h-1 w-1 rounded-full bg-gray-600 shrink-0" />Sector concentration analysis</li>
                    <li className="flex gap-2"><span className="mt-1 h-1 w-1 rounded-full bg-gray-600 shrink-0" />Directional exposure (net long/short)</li>
                    <li className="flex gap-2"><span className="mt-1 h-1 w-1 rounded-full bg-gray-600 shrink-0" />Risk distribution across strategies</li>
                  </ul>
                </div>
              </DocCard>
            </div>
          </section>

          {/* ═══════════════════════════════════════════════════════
             SECTION 16 — PORTFOLIO PHILOSOPHY
             ═══════════════════════════════════════════════════════ */}
          <section id="portfolio" className="scroll-mt-24">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <ShieldCheck size={18} className="text-violet-400" />
              Portfolio Philosophy
            </h2>
            <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  { rule: 'Do not fight the strong tape', desc: 'If the market is trending strongly upward, avoid aggressive bearish positions. Let the trend be your tailwind.' },
                  { rule: 'Avoid aggressive puts in bullish markets', desc: 'Selling puts in a bull market is collecting pennies in front of a steamroller. Favor call-based structures in uptrends.' },
                  { rule: 'Use spreads in high IV', desc: 'Elevated IV means option premiums are expensive. Selling premium via credit spreads captures IV-rich premiums while defining risk.' },
                  { rule: 'Covered calls for income', desc: 'When you own the stock and IV is elevated, selling OTM calls generates income and provides downside cushion.' },
                  { rule: 'Avoid chasing extended candles', desc: 'If price has moved 5%+ in 5 days, wait for a pullback. Extended entries have poor risk/reward and high mean-reversion risk.' },
                  { rule: 'Wait for pullback confirmation', desc: 'A pullback to MA20 or a key level that holds and shows buying pressure is a higher-quality entry than buying the breakout.' },
                  { rule: 'Position size according to conviction', desc: 'Let Kelly Criterion dictate size. Higher confidence does not mean larger size — it means the math supports the allocation.' },
                  { rule: 'Cut losses, let winners run', desc: 'Respect your stop levels. A small loss is a good loss. Prematurely closing winners is the most common wealth-limiting behavior.' },
                ].map(p => (
                  <div key={p.rule} className="flex items-start gap-2 rounded-lg bg-gray-800/40 border border-gray-700/50 px-3 py-2.5">
                    <div className="w-1 h-1 rounded-full bg-violet-500 mt-1.5 shrink-0" />
                    <div>
                      <div className="text-[11px] font-semibold text-gray-200">{p.rule}</div>
                      <p className="text-[10px] text-gray-400 mt-0.5 leading-relaxed">{p.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ═══════════════════════════════════════════════════════
             SECTION 17 — UI/UX DESIGN RULES
             ═══════════════════════════════════════════════════════ */}
          <section id="ui-ux-rules" className="scroll-mt-24">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Eye size={18} className="text-violet-400" />
              UI/UX Design Rules
            </h2>
            <p className="text-xs text-gray-500 mb-4">These rules document the design system for future development. All pages must follow these standards regardless of feature complexity.</p>

            <DocCard icon={<Eye size={15} />} title="Card & Visual System">
              <div className="space-y-3 text-xs text-gray-400">
                <div className="grid gap-2 sm:grid-cols-2">
                  {[
                    { rule: 'Unified card system', desc: 'All pages use the same card style: rounded-xl border, subtle border colors, bg-gray-900 on dark / bg-white on light.' },
                    { rule: 'No glassmorphism', desc: 'No backdrop-blur, no transparency layers. Every surface has a solid or near-solid background. Clarity over aesthetics.' },
                    { rule: 'No transparency windows', desc: 'Overlays and modals have solid backgrounds with optional border accents. No semi-transparent chrome effects.' },
                    { rule: 'Subtle borders only', desc: 'Borders use 0.5–1px width with muted opacity (border-gray-800 on dark, border-slate-200 on light).' },
                    { rule: 'Positions Center is canonical', desc: 'The Positions Center card style is the reference implementation. Signal Feed and TCC follow the same patterns.' },
                    { rule: 'Execution-first UX', desc: 'Every page prioritizes: What is the trade? Can I enter? Where? What structure? What are the risks? Why?' },
                  ].map(r => (
                    <div key={r.rule} className="flex items-start gap-2 bg-gray-800/40 border border-gray-700/50 rounded-lg px-3 py-2">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-violet-500 shrink-0" />
                      <div>
                        <div className="text-[11px] font-semibold text-gray-200">{r.rule}</div>
                        <p className="text-[10px] text-gray-400 mt-0.5">{r.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </DocCard>

            <DocCard icon={<Activity size={15} />} title="Typography & Spacing">
              <div className="space-y-2 text-xs text-gray-400">
                <div className="grid gap-2 sm:grid-cols-3">
                  {[
                    { level: 'Page titles', cls: 'text-2xl font-bold text-white', example: 'Platform Overview' },
                    { level: 'Section headings', cls: 'text-lg font-bold text-white', example: 'Engine Architecture' },
                    { level: 'Card headings', cls: 'text-sm font-bold text-white', example: 'Core Concepts' },
                    { level: 'Body text', cls: 'text-xs text-gray-400 leading-relaxed', example: 'Primary content text' },
                    { level: 'Labels', cls: 'text-[10px] uppercase tracking-wide text-gray-500', example: 'RISK LEVEL' },
                    { level: 'Monospace data', cls: 'font-mono text-xs text-gray-300', example: 'EV = $0.20' },
                  ].map(t => (
                    <div key={t.level} className="rounded-lg bg-gray-800/40 border border-gray-700/50 px-3 py-2">
                      <div className="text-[10px] font-semibold text-gray-500">{t.level}</div>
                      <div className={t.cls}>{t.example}</div>
                    </div>
                  ))}
                </div>
              </div>
            </DocCard>

            <DocCard icon={<HelpCircle size={15} />} title="Theme System">
              <div className="space-y-2 text-xs text-gray-400">
                <p>Theme tokens defined as CSS custom properties in index.css:</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {[
                    { var: '--surface-canvas', usage: 'Page backgrounds' },
                    { var: '--surface-page', usage: 'Section backgrounds' },
                    { var: '--surface-card', usage: 'Card backgrounds' },
                    { var: '--surface-raised', usage: 'Hover/elevated states' },
                    { var: '--border-subtle', usage: 'Border colors (muted)' },
                    { var: '--border-default', usage: 'Standard borders' },
                    { var: '--text-primary', usage: 'Primary text' },
                    { var: '--text-secondary', usage: 'Secondary text' },
                    { var: '--text-tertiary', usage: 'Muted/label text' },
                    { var: '--chart-line-*', usage: 'Chart series colors' },
                  ].map(t => (
                    <div key={t.var} className="flex items-center justify-between rounded-lg bg-gray-800/40 px-3 py-1.5">
                      <code className="text-[10px] font-mono text-violet-300">{t.var}</code>
                      <span className="text-[10px] text-gray-500">{t.usage}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-gray-500 mt-2">All Tailwind gray classes (bg-gray-*, text-gray-*, border-gray-*) auto-adapt between dark/light mode via global CSS variable overrides. No per-page scope duplication.</p>
              </div>
            </DocCard>
          </section>

          {/* ═══════════════════════════════════════════════════════
             SECTION 18 — FAQ
             ═══════════════════════════════════════════════════════ */}
          <section id="faq" className="scroll-mt-24">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <HelpCircle size={18} className="text-violet-400" />
              FAQ
            </h2>

            <DocCard icon={<HelpCircle size={15} />} title="Frequently Asked Questions">
              <div className="space-y-3">
                {[
                  { q: 'Why is a GO trade still waiting?', a: 'GO refers to the trade quality — the setup is sound and passes all checks. But execution timing is a separate dimension. A GO trade can still show WAIT if the entry trigger (pullback, breakout confirmation) has not been met yet.' },
                  { q: 'Why is a setup EXTENDED?', a: 'Extension means price has moved significantly from a key level (typically 5%+ from MA20, or RSI above 70, or 5-day momentum above 5%). The move already happened — entering now means buying near the top. Wait for a pullback.' },
                  { q: 'Why can a positive EV still be CAUTION?', a: 'EV measures the expected value per trade, but Edge Ratio (EV ÷ max loss) measures the quality of that edge. If Edge Ratio is below 5%, a small model error or slippage can erase the edge entirely. CAUTION with positive EV says "the math works, but the margin is tight."' },
                  { q: 'Why are NO GO trades shown?', a: 'NO GO trades are shown for transparency. Even rejected trades help you understand what the engine is seeing and why. When market conditions improve, previously NO GO setups may become actionable.' },
                  { q: 'Why does Swing use 21–42 DTE for 3–5 day holds?', a: 'Longer DTE reduces gamma risk, gives the thesis time to develop, provides exit flexibility (close early with time premium remaining), and buffers against unexpected events. The holding period is about when you plan to exit; the DTE is about managing risk while you hold.' },
                  { q: 'What does confidence actually mean?', a: 'Confidence is a composite of signal consistency: MA alignment, MACD confirmation, RSI health, volume participation, and VIX context. Higher confidence means the signals are in greater agreement — it does NOT guarantee profit or predict magnitude.' },
                  { q: 'What do the state badges mean?', a: 'STATE 2: ENTRY (emerald with glow) — all conditions aligned, enter now. STATE 1: SETUP (amber) — conditions forming, monitor for alignment. WATCH (sky) — not ready yet, keep monitoring. AVOID (red) — critical conditions not met, do not trade.' },
                  { q: 'Can I override the engine recommendations?', a: 'The engine is a systematic screen, not an advisor. You have full discretion over every trade. Manual strategy mode overrides (All, Long Options, Credit Spreads, Straddles) let you restrict which strategies the engine considers.' },
                ].map(faq => (
                  <div key={faq.q} className="rounded-lg bg-gray-800/40 border border-gray-700/50 px-3 py-2.5">
                    <div className="flex items-start gap-2">
                      <div className="w-4 h-4 rounded-full bg-violet-600/20 flex items-center justify-center shrink-0 mt-0.5">
                        <span className="text-[8px] font-bold text-violet-400">Q</span>
                      </div>
                      <div>
                        <div className="text-[11px] font-semibold text-gray-200 mb-0.5">{faq.q}</div>
                        <p className="text-[10px] text-gray-400 leading-relaxed">{faq.a}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </DocCard>
          </section>

          {/* ═══════════════════════════════════════════════════════
             FOOTER — RISK WARNINGS
             ═══════════════════════════════════════════════════════ */}
          <section className="rounded-xl border border-amber-800/40 bg-amber-950/20 px-5 py-4">
            <div className="flex items-center gap-2 text-amber-400 font-semibold text-xs mb-3">
              <AlertTriangle size={15} />
              Important disclaimers
            </div>
            <ul className="space-y-2 text-[11px]">
              {[
                'The recommendation list is a systematic screen, not investment advice. Always do your own research before trading.',
                'Price movement, IV changes, liquidity, assignment risk, and early exits can materially change real P&L.',
                'One options contract controls 100 shares. Small premium changes can become meaningful dollar swings.',
                'Defined-risk spreads cap your loss at the spread width minus credit received — but only if held to expiry. Early assignment or leg-out errors can exceed the theoretical max loss.',
                'Never size a position so large that a max-loss outcome would be devastating. Risk only what you can afford to lose on any single trade.',
              ].map((d, i) => (
                <li key={i} className="flex gap-2 text-amber-200/80">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-500/50 shrink-0" />
                  {d}
                </li>
              ))}
            </ul>
            <p className="text-[10px] text-gray-600 mt-4 text-center">Educational use only. Not financial advice. Options trading involves substantial risk of loss.</p>
          </section>

        </div>
      </div>
    </div>
  )
}
