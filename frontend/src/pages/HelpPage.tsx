import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  HelpCircle, SlidersHorizontal, ShieldCheck, TrendingUp, Filter, Trophy,
  Brain, Star, Briefcase, ChevronDown, ChevronRight, BookOpen,
  Radar, BarChart2, AlertTriangle, CheckCircle2, XCircle, Clock,
  FlaskConical, NotebookPen, Scale, Sigma, Flame, ArrowDown, Zap, LineChart,
  Menu, X, Search, Copy, LayoutDashboard, GitBranch, RefreshCw, Gauge,
  Activity, Layers, Target, Eye, ToggleLeft, Bell, List, ShieldAlert,
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
  { id: 'regular-engine',   label: 'Regular Engine',            icon: SlidersHorizontal },
  { id: 'options-funda',    label: 'Options Fundamentals',      icon: BookOpen },
  { id: 'strategy-glossary',label: 'Strategy Glossary',         icon: BookOpen },
  { id: 'validation',       label: 'Validation System',         icon: CheckCircle2 },
  { id: 'hard-soft-fail',   label: 'Hard Fail vs Soft Fail',    icon: XCircle },
  { id: 'ev-pop-kelly',     label: 'EV / PoP / Kelly',          icon: Sigma },
  { id: 'alerts',           label: 'Alert System',              icon: Bell },
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
  { verdict: 'GO', color: 'text-emerald-400', badge: 'bg-emerald-900/40 border-emerald-700 text-emerald-300', icon: <CheckCircle2 size={15} />, desc: 'No hard fails, zero soft fails, edge ratio ≥ 5% of max loss (no Kelly Edge thin-edge warning), and fewer than 5 warnings total. This is the cleanest actionable verdict.' },
  { verdict: 'CAUTION', color: 'text-amber-400', badge: 'bg-amber-900/40 border-amber-700 text-amber-300', icon: <AlertTriangle size={15} />, desc: 'No hard fails, but either a thin Kelly edge (EV ÷ max loss below 5%), one soft fail, or five or more warnings. The setup may still be tradeable — reduce size and review every checklist row.' },
  { verdict: 'NO GO', color: 'text-red-400', badge: 'bg-red-900/40 border-red-700 text-red-300', icon: <XCircle size={15} />, desc: 'One or more hard fails, or 2+ soft fails. The trade does not pass minimum quality thresholds — skip or wait for better conditions.' },
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
  { step: '4', title: 'Review Pre-Trade Checklist', icon: <CheckCircle2 size={16} />, color: 'text-emerald-400', desc: 'Each recommendation shows a GO / CAUTION / NO GO verdict badge. Expand the checklist inside each card to see all 10 check items, their pass/warn/fail status, and exact entry timing and exit rules for that specific trade.' },
  { step: '5', title: 'Scan Trade Signals', icon: <Radar size={16} />, color: 'text-amber-400', desc: 'Trade Signals shows every watchlist ticker with pre-trade verdicts for analyzed DTE windows (0w, 1w, 2w, 4w, 6w). Use "Fetch All Weeks" to populate all windows in one sweep, then filter by GO / CAUTION / NO GO to find the best setups across your list.' },
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
  { stage: 'ANALYZE', subtitle: 'Evaluate setup quality', desc: 'Run the pre-trade checklist. Each trade gets a GO, CAUTION, or NO GO verdict backed by 10 independent validation checks.' },
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

export default function HelpPage() {
  const { user } = useApp()
  const isAdmin = normalizeUserRole(user?.role) === 'admin'
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [activeSection, setActiveSection] = useState('overview')
  const [searchQuery, setSearchQuery] = useState('')
  const mainRef = useRef<HTMLDivElement>(null)
  const tickingRef = useRef(false)

  useEffect(() => {
    const handleScroll = () => {
      if (tickingRef.current) return
      tickingRef.current = true
      requestAnimationFrame(() => {
        const offset = 120
        for (const s of [...NAV_SECTIONS].reverse()) {
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
  }, [])

  const filteredNav = useMemo(() => {
    if (!searchQuery) return NAV_SECTIONS
    const q = searchQuery.toLowerCase()
    return NAV_SECTIONS.filter(s => s.label.toLowerCase().includes(q))
  }, [searchQuery])

  // Preserve the role check (keep ai-radar section hidden for finance accounts)
  const showAiRadar = true // Help is open-docs

  return (
    <div className="help-page min-h-screen">
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
        <div className="p-3 border-t border-gray-800 mt-2">
          <div className="text-[10px] text-gray-600 leading-relaxed">
            OptionAdvisor v2.0<br />
            Institutional documentation
          </div>
        </div>
      </aside>

      {/* ── Main content ────────────────────────────────────────── */}
      <div ref={mainRef} className="lg:ml-60 min-h-screen">
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
                <h1 className="text-2xl font-bold text-white">OptionAdvisor Trading Engine Documentation</h1>
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
              <DocCard icon={<Activity size={15} />} title="Core Concepts">
                <div className="space-y-3 text-xs text-gray-400">
                  <p>The Day Trade engine analyzes intraday momentum using VWAP (Volume-Weighted Average Price), opening range breakouts, and session-level confirmation. Designed for 0–1 day holds with active management.</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      { label: 'VWAP', desc: 'Volume-Weighted Average Price. Acts as an intraday support/resistance level. Price above VWAP = bullish bias for the session; below = bearish.' },
                      { label: 'Opening Range High (ORH)', desc: 'The high of the first N minutes of trading. A breakout above ORH with volume signals intraday momentum.' },
                      { label: 'Opening Range Low (ORL)', desc: 'The low of the first N minutes. A breakdown below ORL signals intraday weakness.' },
                      { label: 'Breakout Confirmation', desc: 'Price must hold above ORH for a defined period before the engine upgrades the entry signal. Prevents false breakouts.' },
                      { label: 'Controlled Pullback', desc: 'A retracement to VWAP or ORH that holds and shows buying pressure. Often the best entry for momentum continuation.' },
                      { label: 'Scalp Target', desc: 'The initial profit objective, typically 1.5–2× the risk amount for intraday positions.' },
                    ].map(c => (
                      <div key={c.label} className="rounded-lg bg-gray-800/40 border border-gray-700/50 px-3 py-2">
                        <div className="font-semibold text-gray-200 text-[11px]">{c.label}</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">{c.desc}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </DocCard>

              <DocCard icon={<Target size={15} />} title="Verdict Tiers">
                <div className="space-y-2 text-xs text-gray-400">
                  {[
                    { verdict: 'STRONG BUY', tone: 'text-emerald-400', dot: 'green', desc: 'Multiple confirmations align: VWAP hold, OR breakout, volume confirmation, and sector/market tailwind.' },
                    { verdict: 'BUY', tone: 'text-emerald-400', dot: 'green', desc: 'Primary signals are positive but may lack full confirmation. Good risk/reward setup.' },
                    { verdict: 'HOLD', tone: 'text-amber-400', dot: 'amber', desc: 'No decisive signal. Wait for clearer direction or better entry.' },
                    { verdict: 'AVOID', tone: 'text-rose-400', dot: 'red', desc: 'Risk factors dominate. Poor liquidity, failed technical levels, or adverse market conditions.' },
                  ].map(v => (
                    <div key={v.verdict} className="flex items-start gap-2">
                      <BadgeDot tone={v.dot as 'green' | 'amber' | 'red'} />
                      <div><span className={`font-semibold ${v.tone}`}>{v.verdict}</span><span className="text-gray-500"> — {v.desc}</span></div>
                    </div>
                  ))}
                </div>
              </DocCard>

              <DocCard icon={<Clock size={15} />} title="Execution Timing">
                <div className="space-y-1.5 text-xs text-gray-400">
                  <p className="text-amber-200/90">Waiting on: VWAP hold · breakout confirmation · controlled pullback hold</p>
                  <ul className="space-y-1 text-gray-500">
                    <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-gray-600 shrink-0" /><span><strong className="text-gray-300">VWAP hold:</strong> Price establishes support at VWAP after a period above it. Indicates institutional buying interest.</span></li>
                    <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-gray-600 shrink-0" /><span><strong className="text-gray-300">Breakout confirmation:</strong> Price breaks above ORH and holds for N minutes with rising volume. Filters fakeouts.</span></li>
                    <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-gray-600 shrink-0" /><span><strong className="text-gray-300">Controlled pullback:</strong> Price pulls back to VWAP or breakout level without breaking it, then resumes the move. Indicates healthy price action.</span></li>
                  </ul>
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
              <DocCard icon={<Activity size={15} />} title="Core Concepts">
                <div className="space-y-3 text-xs text-gray-400">
                  <p>The Swing Trade engine analyzes daily OHLCV bars (60+ sessions) to identify multi-day momentum setups. It evaluates MA20/MA50 alignment, RSI, MACD, 5-day momentum, volume trends, and SPY/QQQ market context.</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      { label: '2–5 Day Setups', desc: 'Target holding period. The engine evaluates setups that can develop over several sessions, not intraday moves.' },
                      { label: 'Pullback Entries', desc: 'When price is extended from MA20, the engine recommends waiting for a pullback to establish a better entry.' },
                      { label: 'Breakout Continuation', desc: 'When price breaks a key level with volume and holds, the engine can recommend continuation entries.' },
                      { label: 'MA20/MA50 Alignment', desc: 'MA20 > MA50 = uptrend. The slope and spacing of these MAs determine trend strength scoring.' },
                      { label: 'Swing Execution Map', desc: 'Entry zone (pullback level), breakout trigger, risk-below line, and target zone. Each trade has a structured execution map.' },
                      { label: 'DTE Windows', desc: 'Despite 2–5 day holds, swing uses 21–42 DTE options to reduce gamma risk and allow time for the thesis to develop.' },
                    ].map(c => (
                      <div key={c.label} className="rounded-lg bg-gray-800/40 border border-gray-700/50 px-3 py-2">
                        <div className="font-semibold text-gray-200 text-[11px]">{c.label}</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">{c.desc}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </DocCard>

              <DocCard icon={<Sigma size={15} />} title="Decision Quality Layer">
                <div className="space-y-2 text-xs text-gray-400">
                  <p>The swing engine adds a Decision Quality Layer that separates trend direction from entry quality:</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      { label: 'Swing Bias', desc: 'Directional read: STRONG_BULLISH, BULLISH, NEUTRAL, BEARISH, STRONG_BEARISH' },
                      { label: 'Entry Quality', desc: 'GOOD_ENTRY, CAUTION_ENTRY, WAIT_PULLBACK, LATE_ENTRY, NO_CLEAN_ENTRY' },
                      { label: 'Risk Level', desc: 'LOW, MEDIUM, HIGH, VERY_HIGH — based on extension, VIX, earnings, IV, liquidity' },
                      { label: 'Final Action', desc: 'STRONG_GO, READY, WATCH, WAIT_PULLBACK, AVOID_CHASE, NO_TRADE' },
                    ].map(d => (
                      <div key={d.label} className="rounded-lg bg-gray-800/40 border border-gray-700/50 px-3 py-2">
                        <div className="font-semibold text-gray-200 text-[11px]">{d.label}</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">{d.desc}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </DocCard>

              <DocCard icon={<RefreshCw size={15} />} title="Why 21–42 DTE for 3–5 Day Holds">
                <div className="space-y-1.5 text-xs text-gray-400">
                  <p>A common question: why use options with 3–6 weeks to expiry when you only hold for 3–5 days?</p>
                  <ul className="space-y-1 text-gray-500">
                    <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-gray-600 shrink-0" /><span><strong className="text-gray-300">Theta decay curve:</strong> Gamma risk accelerates in the final 2 weeks. Longer DTE reduces the risk of an adverse intraday move wiping out the position.</span></li>
                    <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-gray-600 shrink-0" /><span><strong className="text-gray-300">Time for thesis to develop:</strong> Swing trades are based on daily closes. A setup may take 2–5 sessions to play out. Longer DTE gives room to be right.</span></li>
                    <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-gray-600 shrink-0" /><span><strong className="text-gray-300">Exit flexibility:</strong> If the trade moves in your favor early, you can close with significant time premium remaining, improving the risk/reward.</span></li>
                    <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-gray-600 shrink-0" /><span><strong className="text-gray-300">Earnings and event buffer:</strong> Longer DTE provides a cushion if unexpected events occur during the holding period.</span></li>
                  </ul>
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

            <DocCard icon={<Scale size={15} />} title="Verdict Decision Flow">
              <div className="rounded-xl border border-gray-800 bg-gray-950/30 p-4 mb-3">
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  {['10 Checks', 'Hard Fail Detection', 'Soft Fail Count', 'Warning Stack', 'Kelly Edge Validation', 'Final Verdict'].map((step, i) => (
                    <div key={step} className="flex items-center gap-2">
                      <span className="rounded-lg bg-gray-800/60 border border-gray-700/50 px-2 py-1 text-gray-300 font-medium">{step}</span>
                      {i < 5 && <ChevronRight size={11} className="text-gray-700" />}
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
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
                  <li className="flex gap-2"><span className="mt-1 h-1.5 w-1.5 rounded-full bg-rose-500 shrink-0" />A single hard fail triggers an automatic NO GO verdict</li>
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
                  <li className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />Soft fails downgrade the verdict to CAUTION but do not block the trade</li>
                  <li className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />2+ soft fails trigger a NO GO even with zero hard fails</li>
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
                    { condition: '0 hard fails + 0 soft fails + &lt;5 warnings + edge ≥ 5%', result: 'GO', tone: 'text-emerald-400' },
                    { condition: '0 hard fails + 1 soft fail OR &lt;5 warnings OR thin edge', result: 'CAUTION', tone: 'text-amber-400' },
                    { condition: '1+ hard fails OR 2+ soft fails', result: 'NO GO', tone: 'text-red-400' },
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
                  { q: 'What is the difference between WATCH and WAIT?', a: 'WATCH means the direction is established but entry confirmation is needed. WAIT means conditions are not yet favorable for entry. WAIT is a stronger signal to be patient.' },
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
