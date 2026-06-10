import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  HelpCircle, SlidersHorizontal, ShieldCheck, TrendingUp, Filter, Trophy,
  Brain, Star, Briefcase, ChevronDown, ChevronRight, BookOpen,
  Radar, BarChart2, AlertTriangle, CheckCircle2, XCircle, Clock,
  FlaskConical, NotebookPen, Scale, Sigma, Flame, ArrowDown, ArrowRight, Zap, LineChart,
  Menu, X, Search, Copy, LayoutDashboard, GitBranch, RefreshCw, Gauge,
  Activity, Layers, Target, Eye, ToggleLeft, Bell, List, ShieldAlert, Award, Ban, Users,
} from 'lucide-react'
import { useApp } from '../contexts/AppContext'
import { normalizeUserRole } from '../permissions'

// ─── Nav structure ──────────────────────────────────────────────────

// ─── Search index — section id → searchable keywords and snippets ───────────
const SEARCH_INDEX: { id: string; label: string; keywords: string[] }[] = [
  { id: 'access-roles',      label: 'Access Roles',           keywords: ['role', 'admin', 'user', 'superuser', 'permission', 'finance', 'access', 'login', 'account'] },
  { id: 'overview',          label: 'Platform Overview',      keywords: ['overview', 'platform', 'what is', 'introduction', 'how it works', 'dashboard', 'tcc', 'command center'] },
  { id: 'engine-arch',       label: 'Engine Architecture',    keywords: ['engine', 'architecture', 'signal', 'pipeline', 'how engine works', 'backend', 'scoring pipeline'] },
  { id: 'trade-lifecycle',   label: 'Trade Lifecycle',        keywords: ['lifecycle', 'workflow', 'setup', 'watch', 'entry', 'manage', 'exit', 'close', 'trade flow'] },
  { id: 'engine-states',     label: 'Engine States',          keywords: ['state', 'ready', 'watch', 'wait', 'avoid', 'no edge', 'verdict', 'state 2', 'state 1', 'entry state'] },
  { id: 'execution-states',  label: 'Execution States',       keywords: ['execution', 'enter now', 'pending', 'hold', 'manage position', 'entry gate', 'confirmation'] },
  { id: 'day-trade',         label: 'Day Trade Engine',       keywords: ['day trade', 'intraday', 'rvol', 'vwap', 'or high', 'or low', 'opening range', 'breakout', 'scalp', 'momentum', 'extension', 'chasing', 'spy', 'qqq', 'nvda', 'large cap', 'volume', 'day trade setup', '0dte', '1dte', 'trend day', 'bear trend', 'bull trend', 'vix', 'entry window', 'atr limit', 'exhausted', 'extension override'] },
  { id: 'swing-trade',       label: 'Swing Trade Engine',     keywords: ['swing', 'trend', 'ema', 'ma20', 'pullback', 'breakout swing', 'daily chart', 'multi day', 'swing verdict', 'swing setup', 'relative strength'] },
  { id: 'vix-reference',     label: 'VIX Reference',          keywords: ['vix', 'volatility index', 'fear index', 'market fear', 'vix spike', 'vix 35', 'avoid vix'] },
  { id: 'regular-engine',    label: 'Regular Engine',         keywords: ['regular', 'options engine', 'spread', 'iron condor', 'credit spread', 'debit spread', 'covered call', 'put spread', 'call spread', 'score', 'checklist', 'pop', 'ev', 'monthly', 'income'] },
  { id: 'entry-guide',       label: 'Trade Entry Guide',      keywords: ['entry', 'when to enter', 'limit order', 'fill', 'entry price', 'how to enter', 'entry guide', 'atm', 'otm'] },
  { id: 'options-funda',     label: 'Options Fundamentals',   keywords: ['options', 'call', 'put', 'strike', 'expiry', 'dte', 'premium', 'intrinsic', 'extrinsic', 'theta', 'delta', 'gamma', 'vega', 'iv', 'implied volatility', 'in the money', 'out of the money'] },
  { id: 'strategy-glossary', label: 'Strategy Glossary',      keywords: ['glossary', 'long call', 'long put', 'bull call spread', 'bear put spread', 'straddle', 'strangle', 'iron condor', 'covered call', 'cash secured put', 'strategy list', 'definitions'] },
  { id: 'validation',        label: 'Validation System',      keywords: ['validation', 'checklist', 'pre trade', 'hard fail', 'soft fail', 'filter', 'rr filter', 'liquidity filter', 'credit filter', 'iv fit'] },
  { id: 'hard-soft-fail',    label: 'Hard Fail vs Soft Fail', keywords: ['hard fail', 'soft fail', 'fail', 'block', 'warning', 'critical', 'checklist fail', 'required condition'] },
  { id: 'ev-pop-kelly',      label: 'EV / PoP / Kelly',       keywords: ['ev', 'expected value', 'pop', 'probability of profit', 'kelly', 'kelly criterion', 'half kelly', 'position sizing', 'edge', 'edge ratio'] },
  { id: 'alerts',            label: 'Alert System',           keywords: ['alert', 'notification', 'email', 'watchlist alert', 'price alert', 'vwap alert', 'or break alert', 'set alert'] },
  { id: 'range-analysis',    label: 'Range & R/R Analysis',   keywords: ['range', 'risk reward', 'rr', 'reward', 'risk', 'atr', 'daily range', 'r:r', 'stop loss', 'target', 'profit target'] },
  { id: 'position-mgmt',     label: 'Position Management',    keywords: ['position', 'manage', 'portfolio', 'open position', 'close position', 'partial close', 'trail stop', 'exit plan', 'position center'] },
  { id: 'market-summary',    label: 'Market Command Summary', keywords: ['market', 'summary', 'command center', 'market overview', 'spy trend', 'qqq trend', 'vix', 'market context', 'tcc'] },
  { id: 'portfolio',         label: 'Portfolio Philosophy',   keywords: ['portfolio', 'philosophy', 'diversification', 'sizing', 'risk management', 'drawdown', 'capital', 'allocation'] },
  { id: 'ui-ux-rules',       label: 'UI/UX Design Rules',     keywords: ['ui', 'ux', 'design', 'color', 'badge', 'card', 'layout', 'interface', 'dark mode', 'theme'] },
  { id: 'verdict-card',      label: 'Verdict Card Scoring',   keywords: ['verdict', 'score', 'card', 'recommendation card', 'entry button', 'avoid button', 'state badge', 'scoring', 'total score'] },
  { id: 'faq',               label: 'FAQ',                    keywords: ['faq', 'frequently asked', 'question', 'why', 'how', 'common question', 'troubleshoot'] },
]

const NAV_SECTIONS = [
  { id: 'access-roles',     label: 'Access Roles',              icon: Users },
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
  { id: 'verdict-card',      label: 'Verdict Card Scoring',       icon: Award },
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
  { step: '3', title: 'Analyze in Position Trading', icon: <BarChart2 size={16} />, color: 'text-sky-400', desc: 'Enter a ticker in the search bar or click any Analyze button. Set weeks-out (0w–6w: 0w, 1w, 2w, 4w, 6w), spread width, and strategy mode. The engine fetches live option chains and builds the best candidates for the current market regime.' },
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
  { stage: 'DISCOVER', subtitle: 'Find opportunities', desc: 'Browse AI Radar categories, scan Trade Signals, or load a ticker in Position Trading. The engine surfaces candidates based on market conditions.' },
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
  const userRole = normalizeUserRole(user?.role)
  const isAdmin = userRole === 'admin' || userRole === 'super_user'
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

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return []
    const q = searchQuery.toLowerCase().trim()
    const scored = SEARCH_INDEX
      .filter(entry => {
        // Only show sections visible to this user
        if (!visibleNavSections.find(s => s.id === entry.id)) return false
        const labelMatch = entry.label.toLowerCase().includes(q)
        const kwMatch = entry.keywords.some(k => k.toLowerCase().includes(q))
        return labelMatch || kwMatch
      })
      .map(entry => {
        const labelMatch = entry.label.toLowerCase().includes(q)
        const kwMatches = entry.keywords.filter(k => k.toLowerCase().includes(q))
        // Score: label match = high priority, keyword match = lower
        const score = labelMatch ? 2 : kwMatches.length
        const snippet = kwMatches.slice(0, 3).join(', ')
        return { ...entry, score, snippet }
      })
      .sort((a, b) => b.score - a.score)
    return scored
  }, [searchQuery, visibleNavSections])

  const filteredNav = useMemo(() => {
    if (!searchQuery) return visibleNavSections
    // When searching, show only sections that appear in results
    const matchIds = new Set(searchResults.map(r => r.id))
    return visibleNavSections.filter(s => matchIds.has(s.id))
  }, [searchQuery, visibleNavSections, searchResults])

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
        {searchQuery.trim() && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400"
          >
            <X size={11} />
          </button>
        )}
      </div>
      {searchResults.length > 0 && (
        <div className="mt-2 rounded-lg border border-gray-800 bg-gray-950 overflow-hidden">
          <div className="px-2.5 py-1.5 border-b border-gray-800 text-[10px] font-semibold uppercase tracking-widest text-gray-600">
            {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
          </div>
          <div className="max-h-64 overflow-y-auto">
            {searchResults.map(r => (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  document.getElementById(r.id)?.scrollIntoView({ behavior: 'smooth' })
                  setActiveSection(r.id)
                  setSidebarOpen(false)
                }}
                className="w-full text-left px-2.5 py-2 hover:bg-gray-900 border-b border-gray-800/50 last:border-0 transition-colors"
              >
                <div className="text-xs font-semibold text-violet-300">{r.label}</div>
                {r.snippet && (
                  <div className="text-[10px] text-gray-500 mt-0.5 truncate">{r.snippet}</div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
      {searchQuery.trim() && searchResults.length === 0 && (
        <div className="mt-2 rounded-lg border border-gray-800 bg-gray-950 px-3 py-3 text-[11px] text-gray-600 text-center">
          No results for "{searchQuery}"
        </div>
      )}
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
             SECTION 0 — ACCESS ROLES
             ═══════════════════════════════════════════════════════ */}
          <section id="access-roles" className="scroll-mt-24">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Users size={18} className="text-violet-400" />
              Access Roles
            </h2>
            <p className="text-xs text-gray-400 leading-relaxed mb-4">
              Every account is assigned one role. The role controls which engines and tools are visible in the sidebar. Contact your administrator to change your role.
            </p>
            <div className="rounded-xl border border-gray-800 bg-gray-900/60 overflow-hidden mb-4">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-gray-800 bg-gray-800/50">
                    <th className="text-left px-3 py-2 text-gray-400 font-semibold uppercase tracking-wide">Role</th>
                    <th className="text-center px-3 py-2 text-gray-400 font-semibold uppercase tracking-wide">Regular Trade</th>
                    <th className="text-center px-3 py-2 text-gray-400 font-semibold uppercase tracking-wide">Day Trade</th>
                    <th className="text-center px-3 py-2 text-gray-400 font-semibold uppercase tracking-wide">Swing Trade</th>
                    <th className="text-center px-3 py-2 text-gray-400 font-semibold uppercase tracking-wide">Advanced Tools</th>
                    <th className="text-center px-3 py-2 text-gray-400 font-semibold uppercase tracking-wide">Alpaca Trade</th>
                    <th className="text-center px-3 py-2 text-gray-400 font-semibold uppercase tracking-wide">Discovery</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/60">
                  {[
                    { role: 'Administrator', badge: 'bg-amber-900/50 text-amber-300 border-amber-700', regular: true, day: true, swing: true, advanced: true, alpaca: true, discovery: true },
                    { role: 'Super User',    badge: 'bg-purple-900/50 text-purple-300 border-purple-700', regular: true, day: true, swing: true, advanced: true, alpaca: true, discovery: true },
                    { role: 'Day Trader',    badge: 'bg-orange-900/50 text-orange-300 border-orange-700', regular: true, day: true, swing: false, advanced: false, alpaca: false, discovery: true },
                    { role: 'Swing Trader',  badge: 'bg-blue-900/50 text-blue-300 border-blue-700', regular: true, day: false, swing: true, advanced: false, alpaca: false, discovery: true },
                    { role: 'Finance',       badge: 'bg-cyan-900/40 text-cyan-300 border-cyan-700', regular: true, day: false, swing: false, advanced: false, alpaca: false, discovery: false },
                    { role: 'User',          badge: 'bg-gray-800 text-gray-400 border-gray-600', regular: true, day: false, swing: false, advanced: false, alpaca: false, discovery: true },
                  ].map(r => (
                    <tr key={r.role} className="hover:bg-gray-800/30 transition-colors">
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${r.badge}`}>{r.role}</span>
                      </td>
                      {[r.regular, r.day, r.swing, r.advanced, r.alpaca, r.discovery].map((v, i) => (
                        <td key={i} className="text-center px-3 py-2">
                          {v
                            ? <span className="text-emerald-400 font-bold">✓</span>
                            : <span className="text-gray-700">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <DocCard icon={<Users size={15} />} title="Advanced Tools">
                <p className="text-xs text-gray-400 leading-relaxed">Day Trade Engine, Track Intraday, and Swing Trade Engine. Available to Administrator and Super User roles.</p>
              </DocCard>
              <DocCard icon={<Users size={15} />} title="Alpaca Trade (Support section)">
                <p className="text-xs text-gray-400 leading-relaxed">Automated order execution via Alpaca broker integration. Listed under the Support section in the sidebar. Available to Administrator and Super User roles.</p>
              </DocCard>
              <DocCard icon={<Users size={15} />} title="Discovery">
                <p className="text-xs text-gray-400 leading-relaxed">AI Core and Q-Radar stock discovery tools. Hidden for Finance role accounts; visible to all other roles.</p>
              </DocCard>
              <DocCard icon={<Users size={15} />} title="Assigning Roles">
                <p className="text-xs text-gray-400 leading-relaxed">Roles are stored in the database and assigned by an administrator. Set <code className="text-violet-300 bg-gray-800 px-1 rounded">role = 'super_user'</code> (or any valid role string) in the <code className="text-violet-300 bg-gray-800 px-1 rounded">user_state</code> table.</p>
              </DocCard>
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
              <DocCard icon={<SlidersHorizontal size={15} />} title="Position Trading">
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
                  Intraday scoring engine using 1-minute RTH bars (9:30–16:00 ET). Produces a <strong className="text-gray-200">bull score</strong> and <strong className="text-gray-200">bear score</strong>. Net edge + margin + post-verdict gate determines the final verdict.
                </p>
                <div className="flex flex-wrap items-center gap-2 text-[11px] mb-3">
                  {['STRONG GO', 'GO', 'WATCH', 'WAIT', 'AVOID'].map((v, i, a) => (
                    <div key={v} className="flex items-center gap-2">
                      <span className="rounded-lg bg-gray-800/60 border border-gray-700/50 px-2 py-1 font-mono font-bold text-gray-200">{v}</span>
                      {i < a.length - 1 && <ChevronRight size={11} className="text-gray-700" />}
                    </div>
                  ))}
                </div>
                <div className="rounded-lg border border-amber-800/40 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-200/80">
                  <strong className="text-amber-300">Two-stage verdict:</strong> resolve_verdict() computes a raw verdict from scores, then a post-verdict gate overrides it if contextual signals contradict — extension, no soft edge, or VWAP structural mismatch all force a downgrade.
                </div>
              </DocCard>

              <DocCard icon={<Activity size={15} />} title="Step 1: Data Fetch">
                <div className="space-y-2 text-xs text-gray-400">
                  <p><strong className="text-gray-300">Source:</strong> Yahoo Finance 1-minute bars, last 5 days, auto-adjusted</p>
                  <p><strong className="text-gray-300">Minimum bars:</strong> 25 (MIN_BARS)</p>
                  <p><strong className="text-gray-300">Session:</strong> Most recent calendar day with RTH bars (9:30–16:00 ET)</p>
                  <p><strong className="text-gray-300">Index context:</strong> SPY and QQQ daily % change fetched separately for market bias</p>
                </div>
              </DocCard>

              <DocCard icon={<Layers size={15} />} title="Step 2: Indicators Computed">
                <div className="space-y-3 text-xs text-gray-400">
                  {[
                    { title: '2a. VWAP + Standard Deviation Bands', body: 'Cumulative session VWAP using volume-weighted typical price. Bands at ±1σ and ±2σ computed from volume-weighted variance. Used for position classification, extension detection, and chasing guard.' },
                    { title: '2b. Opening Range (first 15×1m candles)', body: 'OR High = max(High, first 15 bars). OR Low = min(Low, first 15 bars). OR state: "above" | "below" | "inside". OR historical: "broke_up" | "broke_down" | "contained". Data not available during first 15 minutes of session.' },
                    { title: '2c. Volume', body: 'Cumulative session volume vs time-adjusted expected volume (based on 20-day ADV profile). RVOL = cumulative / expected. vol_spike = last bar volume ≥ 1.55× median.' },
                    { title: '2d. Momentum', body: 'momentum_pct = (last − open) / open × 100. Measures intraday directional force from session open.' },
                    { title: '2e. Macro VWAP Slope', body: 'VWAP slope over last 60 bars (macro) and 15 bars (micro). Rising slope = institutional accumulation. Falling slope = distribution.' },
                    { title: '2f. RS vs QQQ', body: 'rs_vs_qqq_pct = (stock % change) − (QQQ % change). Positive = outperforming tech benchmark. Key signal for large-cap names.' },
                  ].map(s => (
                    <div key={s.title} className="rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2.5">
                      <div className="font-semibold text-gray-200 text-[11px] mb-1">{s.title}</div>
                      <p className="text-gray-500">{s.body}</p>
                    </div>
                  ))}
                </div>
              </DocCard>

              <DocCard icon={<Sigma size={15} />} title="Step 3: Scoring — Correlation-Aware Groups">
                <p className="text-xs text-gray-500 mb-3">Signals are grouped by statistical correlation. Each group contributes at most 3.0 to the final score. Correlated signals (e.g. OR breakout + secondary breakout) can't inflate the total.</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wide text-gray-600 border-b border-gray-800">
                        <th className="px-2 py-1.5 font-semibold">Group</th>
                        <th className="px-2 py-1.5 font-semibold">Signal</th>
                        <th className="px-2 py-1.5 font-semibold">Condition</th>
                        <th className="px-2 py-1.5 font-semibold">Points</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ['vwap', 'VWAP position', 'price > VWAP (above band)', 'bull += 2.0'],
                        ['vwap', 'VWAP slope up', 'rising macro slope', 'bull += 0.5'],
                        ['vwap', 'VWAP slope down', 'declining macro slope', 'bull −= 0.5'],
                        ['vwap', 'At +2σ, strong momentum', 'vol_spike + RVOL ≥ thresh + mom > 0.5%', 'bull += 0.5'],
                        ['vwap', 'At +2σ, low volume', 'no vol_spike', 'bear += 1.0 (fade risk)'],
                        ['breakout', 'OR breakout confirmed', 'or_state=above + vol_spike', 'bull += 3.0'],
                        ['breakout', 'OR breakout unconfirmed', 'or_state=above, no spike', 'bull += 1.0'],
                        ['momentum', 'Momentum strong', 'mom_pct > +0.12%', 'bull += 1.5'],
                        ['volume', 'RVOL high', 'RVOL ≥ HIGH_THRESH', 'side += 1.0'],
                        ['volume', 'RVOL elevated', 'RVOL ≥ ELEV_THRESH', 'side += 0.5'],
                        ['rs', 'RS vs QQQ', 'outperforms ≥ +0.5%', 'bull += 1.0'],
                        ['rs', 'RS squeeze guard', 'RS ≥ +0.5% but mkt down', 'bull += 0.5'],
                        ['market', 'SPY session', 'SPY ≥ +0.25%', 'bull += 0.5'],
                        ['market', 'VIX caution', 'VIX ≥ 30.0', '−= 0.5 both sides'],
                        ['market', 'VIX elevated', 'VIX ≥ 40.0 → veto', 'bull = 0, AVOID'],
                        ['swing_context', 'Daily trend aligns', 'swing GO = same bias', 'bias side += 0.5'],
                        ['swing_context', 'Daily trend conflicts', 'swing GO = opposite', 'bias side −= 0.5'],
                      ].map((r, i) => (
                        <tr key={i} className="border-b border-gray-800/40 text-[11px]">
                          <td className="px-2 py-1.5 font-mono text-violet-300">{r[0]}</td>
                          <td className="px-2 py-1.5 font-semibold text-gray-200">{r[1]}</td>
                          <td className="px-2 py-1.5 text-gray-400">{r[2]}</td>
                          <td className="px-2 py-1.5 font-mono text-emerald-300">{r[3]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-gray-500 mt-2">Bear side mirrors the bull rules. Max group score = 3.0.</p>
              </DocCard>

              <DocCard icon={<AlertTriangle size={15} />} title="SPY / QQQ / Large-Cap RVOL Rules">
                <div className="space-y-3 text-xs text-gray-400">
                  <p>SPY, QQQ, NVDA, AAPL, MSFT, AMZN, META, GOOGL, TSLA trade 50M–500M shares daily. A 3× RVOL is structurally impossible. The engine uses differentiated thresholds.</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-[10px] uppercase tracking-wide text-gray-600 border-b border-gray-800">
                          <th className="px-3 py-2">Tier</th>
                          <th className="px-3 py-2">HIGH threshold</th>
                          <th className="px-3 py-2">ELEVATED threshold</th>
                          <th className="px-3 py-2">Primary signal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ['Small / Mid cap (AMD, AVGO, ARM…)', '2.5×', '1.5×', 'RVOL alone'],
                          ['Large-cap liquid (SPY, QQQ, NVDA…)', '1.5×', '1.3×', 'VWAP + RS vs SPY + structure'],
                        ].map((r, i) => (
                          <tr key={i} className="border-b border-gray-800/40 text-[11px]">
                            <td className="px-3 py-2 text-gray-200 font-semibold">{r[0]}</td>
                            <td className="px-3 py-2 font-mono text-emerald-400">{r[1]}</td>
                            <td className="px-3 py-2 font-mono text-amber-400">{r[2]}</td>
                            <td className="px-3 py-2 text-gray-400">{r[3]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="rounded-lg border border-sky-800/40 bg-sky-950/20 px-3 py-2 space-y-1">
                    <p className="text-[11px] font-semibold text-sky-300">What replaces RVOL for large caps:</p>
                    <ul className="space-y-1 text-gray-400">
                      {[
                        ['Price vs VWAP', 'above and holding = long bias; below and rejected = short bias'],
                        ['RS vs SPY/QQQ', 'NVDA holding green while SPY dips = institutional support'],
                        ['Market structure', 'higher highs / higher lows on 5-min chart confirms momentum'],
                        ['VWAP extra weight', '+0.5 added to VWAP group score for large-cap names'],
                      ].map(([k, v]) => (
                        <li key={k} className="flex gap-2 text-[10px]">
                          <span className="font-semibold text-gray-300 shrink-0">{k}:</span>
                          <span>{v}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </DocCard>

              <DocCard icon={<Gauge size={15} />} title="Step 4: Verdict Logic — Two-Stage">
                <div className="space-y-3 text-xs text-gray-400">
                  <div className="grid gap-2 sm:grid-cols-3">
                    {[
                      { label: 'GO_THRESHOLD', value: '4.5' },
                      { label: 'MARGIN_GO', value: '2.75' },
                      { label: 'VIX_NO_GO', value: '40.0' },
                      { label: 'RVOL_HIGH', value: '2.5× (small)' },
                      { label: 'RVOL_HIGH_LC', value: '1.5× (large)' },
                      { label: 'VIX_CAUTION', value: '30.0' },
                    ].map(t => (
                      <div key={t.label} className="flex items-center justify-between rounded-lg bg-gray-800/40 px-3 py-1.5">
                        <code className="text-[10px] font-mono text-violet-300">{t.label}</code>
                        <span className="text-[11px] font-bold text-gray-200 font-mono">{t.value}</span>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2 space-y-1.5">
                    <p className="font-semibold text-gray-200 text-[11px]">Stage 1 — resolve_verdict() (score-based):</p>
                    <ul className="space-y-0.5 text-gray-500 text-[11px]">
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-red-500 shrink-0" />VIX ≥ 35 → AVOID (any engine)</li>
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-red-500 shrink-0" />score &lt; 3.0 → NO_EDGE</li>
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-amber-500 shrink-0" />score &lt; 5.0 → WAIT</li>
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-emerald-500 shrink-0" />score ≥ 8.0 + vol_spike + OR breakout → STRONG_GO</li>
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-emerald-500 shrink-0" />score ≥ 6.0 → GO</li>
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-sky-500 shrink-0" />score ≥ 4.5 → WATCH</li>
                    </ul>
                  </div>

                  <div className="rounded-lg border border-amber-800/40 bg-amber-950/20 px-3 py-2 space-y-1.5">
                    <p className="font-semibold text-amber-300 text-[11px]">Stage 2 — Post-verdict gate (override when signals contradict):</p>
                    <p className="text-[10px] text-gray-500 mb-1">GO only survives if contextual evidence supports it. Every rule here downgrades, never upgrades.</p>
                    <ul className="space-y-0.5 text-gray-400 text-[11px]">
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-red-500 shrink-0" /><strong className="text-gray-300">is_chasing OR edge_state EXHAUSTED/LATE</strong> → GO→WAIT (extension detected)</li>
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-red-500 shrink-0" /><strong className="text-gray-300">soft_edge = False</strong> → GO→WAIT (bull/bear scores too close)</li>
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-amber-500 shrink-0" /><strong className="text-gray-300">long bias + price below VWAP</strong> → GO→WATCH (wait for VWAP reclaim)</li>
                      <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-amber-500 shrink-0" /><strong className="text-gray-300">short bias + price above VWAP</strong> → GO→WATCH (wait for VWAP rejection)</li>
                    </ul>
                    <p className="text-[10px] text-amber-200/60 mt-1">Each downgrade appends a body message explaining the reason. Tags like "EXTENSION" and "No clean edge" are the visual output of these gate conditions.</p>
                  </div>
                </div>
              </DocCard>

              <DocCard icon={<FlaskConical size={15} />} title="Step 5: Full Worked Example (NVDA, Bullish Day)">
                <div className="space-y-3 text-xs text-gray-400">
                  <div className="rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2 space-y-1">
                    <p className="font-semibold text-gray-200 text-[11px]">Inputs</p>
                    <p className="text-gray-500 font-mono text-[10px]">Last: $152.40 | VWAP: $150.80 (rising) | OR High: $151.20 | OR Low: $149.80</p>
                    <p className="text-gray-500 font-mono text-[10px]">or_state: "above" | vol_spike: True | momentum_pct: +1.47%</p>
                    <p className="text-gray-500 font-mono text-[10px]">RVOL: 1.6× (large-cap HIGH ≥ 1.5×) | SPY: +0.45% | RS vs QQQ: +1.45% | VIX: 18.5</p>
                    <p className="text-gray-500 font-mono text-[10px]">daily_trend: GO long | is_chasing: False | edge_state: EARLY</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-[10px] uppercase tracking-wide text-gray-600 border-b border-gray-800">
                          <th className="px-2 py-1 font-semibold">Group</th>
                          <th className="px-2 py-1 font-semibold">Signal</th>
                          <th className="px-2 py-1 font-semibold">Points</th>
                          <th className="px-2 py-1 font-semibold">Running</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ['vwap', 'VWAP above + slope + LC extra', '2.0 + 0.5 + 0.5', 'bull 3.0'],
                          ['breakout', 'OR breakout confirmed', '3.0 (capped)', 'bull 6.0'],
                          ['momentum', 'Momentum strong', '1.5', 'bull 7.5'],
                          ['volume', 'RVOL 1.6× (LC HIGH ≥ 1.5×)', '1.0', 'bull 8.5'],
                          ['rs', 'RS vs QQQ +1.45%', '1.0', 'bull 9.5'],
                          ['market', 'SPY +0.45%', '0.5', 'bull 10.0'],
                          ['swing_context', 'Daily trend aligns', '0.5', 'bull 10.5'],
                        ].map((r, i) => (
                          <tr key={i} className="border-b border-gray-800/40 text-[11px]">
                            <td className="px-2 py-1.5 font-mono text-violet-300">{r[0]}</td>
                            <td className="px-2 py-1.5 text-gray-200">{r[1]}</td>
                            <td className="px-2 py-1.5 font-mono text-emerald-300">{r[2]}</td>
                            <td className="px-2 py-1.5 font-mono text-gray-400">{r[3]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="rounded-lg border border-gray-800 bg-emerald-950/20 px-3 py-2 space-y-0.5">
                    <p className="font-semibold text-emerald-300 text-[11px]">Stage 1: STRONG GO (score 10.5, vol_spike, OR above)</p>
                    <p className="text-gray-400 text-[11px]">Stage 2 gate: is_chasing=False, edge_state=EARLY, price above VWAP ✓</p>
                    <p className="text-emerald-400 font-bold text-[11px]">→ Final verdict: STRONG GO (gate did not fire)</p>
                  </div>
                </div>
              </DocCard>

              <DocCard icon={<FlaskConical size={15} />} title="Step 5b: Gate Fired Example (NVDA, Extension)">
                <div className="space-y-3 text-xs text-gray-400">
                  <div className="rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2 space-y-1">
                    <p className="font-semibold text-gray-200 text-[11px]">Same inputs but: price above +2σ, daily range 82% used</p>
                    <p className="text-gray-500 font-mono text-[10px]">Last: $162.40 (+6.5% on day) | VWAP: $150.80 | price above +2σ ($158.00)</p>
                    <p className="text-gray-500 font-mono text-[10px]">is_chasing: True | edge_state: EXHAUSTED | daily_range_used: 82%</p>
                  </div>
                  <div className="rounded-lg border border-red-800/40 bg-red-950/20 px-3 py-2 space-y-0.5">
                    <p className="font-semibold text-red-300 text-[11px]">Stage 1: STRONG GO (score still 10.5 — raw score unchanged)</p>
                    <p className="text-gray-400 text-[11px]">Stage 2 gate: is_chasing=True → override fires</p>
                    <p className="text-red-400 font-bold text-[11px]">→ Final verdict: WAIT</p>
                    <p className="text-gray-500 text-[11px]">Body: "Verdict downgraded GO→WAIT: extension/chasing detected (EXHAUSTED)…"</p>
                  </div>
                  <p className="text-[11px] text-gray-500">This is the NVDA pattern the engine now correctly catches. Tags "EXTENSION" and "No clean edge" are the visible output of gate conditions firing.</p>
                </div>
              </DocCard>

              <DocCard icon={<Layers size={15} />} title="4-State Trading System & Entry Authorization">
                <div className="space-y-3 text-xs text-gray-400">
                  <p>The Day Trade engine organizes the trade lifecycle into four deterministic states. State transitions are one-way within a session.</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      { state: 'State 1 — MONITORING', color: 'text-sky-400', badge: 'bg-sky-900/30 border-sky-700', desc: 'Opening range forming or no clear edge yet. VWAP direction not confirmed. Wait — no entries.', cond: 'session_minutes < 15 OR no soft_edge OR price inside OR' },
                      { state: 'State 2 — WAIT_FOR_VOLUME', color: 'text-amber-400', badge: 'bg-amber-900/30 border-amber-700', desc: 'Soft edge present. Direction is leaning. Waiting for volume expansion to confirm breakout.', cond: 'soft_edge=True but vol_spike=False' },
                      { state: 'State 3 — ENTRY_ACTIVE', color: 'text-emerald-400', badge: 'bg-emerald-900/30 border-emerald-700', desc: 'All conditions met. Volume confirmed. Enter now. Stop at VWAP or OR Low/High.', cond: 'soft_edge=True AND vol_spike=True AND or_state=above/below' },
                      { state: 'State 3b — ENTRY_PULLBACK', color: 'text-violet-400', badge: 'bg-violet-900/30 border-violet-700', desc: 'Price pulled back from peak after State 3. Hold existing positions. No new entries until price recovers within 0.30% of peak.', cond: 'was ENTRY_ACTIVE, price dropped from peak' },
                      { state: 'State 4 — EOD_CLOSING', color: 'text-red-400', badge: 'bg-red-900/30 border-red-800', desc: 'Last 10 minutes (≥ 15:50 ET). Exit all intraday positions. No new entries regardless of signal quality.', cond: 'session_minutes ≥ 380' },
                    ].map(s => (
                      <div key={s.state} className={`rounded-lg border px-3 py-2.5 space-y-1 ${s.badge}`}>
                        <div className={`text-[11px] font-bold ${s.color}`}>{s.state}</div>
                        <p className="text-[11px] text-gray-300">{s.desc}</p>
                        <p className="text-[10px] text-gray-600 font-mono">{s.cond}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </DocCard>

              <DocCard icon={<Clock size={15} />} title="Session Phases & Time Rules">
                <div className="space-y-2 text-xs text-gray-400">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-[10px] uppercase tracking-wide text-gray-600 border-b border-gray-800">
                          <th className="px-3 py-2">Phase</th>
                          <th className="px-3 py-2">ET Time</th>
                          <th className="px-3 py-2">PT Time</th>
                          <th className="px-3 py-2">Rule</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ['Opening Range', '9:30–9:45', '6:30–6:45', 'OR forming — alerts suppressed for OR_BREAK/VWAP_RETEST'],
                          ['OPENING', '9:30–10:00', '6:30–7:00', 'High volatility, setups still forming'],
                          ['MID_AM', '10:00–11:30', '7:00–8:30', 'Prime entry window'],
                          ['MIDDAY', '11:30–15:00', '8:30–12:00', '−0.25 score penalty, lower follow-through'],
                          ['POWER_HOUR', '15:00–15:50', '12:00–12:50', '−0.5 score penalty, size down'],
                          ['EOD_CLOSING', '15:50–16:00', '12:50–13:00', '−1.0 score penalty, no new entries'],
                        ].map((r, i) => (
                          <tr key={i} className="border-b border-gray-800/40 text-[11px]">
                            <td className="px-3 py-2 font-semibold text-gray-200">{r[0]}</td>
                            <td className="px-3 py-2 font-mono text-gray-400">{r[1]}</td>
                            <td className="px-3 py-2 font-mono text-gray-500">{r[2]}</td>
                            <td className="px-3 py-2 text-gray-400">{r[3]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </DocCard>

              <DocCard icon={<Zap size={15} />} title="Trend Day Detection & Extension Override">
                <div className="space-y-3 text-xs text-gray-400">
                  <p>
                    On most days, extension signals cap the entry window to 2 candles after the OR break. On a <strong className="text-gray-200">trend day</strong>, those rules are suspended and the entry window stays open all session — any OR retest failure is a valid entry.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      {
                        label: '📉 Bear Trend Day', badge: 'bg-red-900/30 border-red-700/50 text-red-300',
                        conditions: ['SPY < −0.8% on the day', 'VIX > 19.0', '3+ watchlist tickers down > 1.5%', 'QQQ moving same direction as SPY'],
                      },
                      {
                        label: '📈 Bull Trend Day', badge: 'bg-emerald-900/30 border-emerald-700/50 text-emerald-300',
                        conditions: ['SPY > +0.8% on the day', 'VIX < 18.0', '3+ watchlist tickers up > 1.5%', 'QQQ moving same direction as SPY'],
                      },
                    ].map(t => (
                      <div key={t.label} className={`rounded-lg border px-3 py-2.5 space-y-1.5 ${t.badge}`}>
                        <div className="font-bold text-[11px]">{t.label}</div>
                        {t.conditions.map(c => (
                          <div key={c} className="flex items-start gap-1.5 text-[11px] text-gray-400">
                            <span className="mt-0.5 shrink-0">□</span>{c}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                  <div className="rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2.5 space-y-1.5">
                    <div className="font-semibold text-gray-200 text-[11px]">When trend day fires</div>
                    <ul className="space-y-1">
                      {[
                        'Extension verdict overridden → "⚡ Trend day · Extension rules suspended"',
                        'Entry window stays open all session (not limited to 2 candles)',
                        'Stop widened by 50% (add 0.5% distance to OR level) for volatility room',
                        'Re-entry zones remain active even when session bar count exceeds 210',
                        'ATR usage tracked — entry suspended when session range > 150% of ATR',
                      ].map((item, i) => (
                        <li key={i} className="flex gap-2 text-[11px]">
                          <span className="mt-0.5 h-1 w-1 rounded-full bg-violet-500 shrink-0 mt-1.5" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-lg border border-gray-800 bg-gray-800/20 px-3 py-2 text-[11px] text-gray-500">
                    <strong className="text-gray-300">Choppy day (default):</strong> SPY between −0.8% and +0.8%, or mixed watchlist directions. Normal 2-candle entry window applies. Stick to the 2-candle window — do not extend on choppy days.
                  </div>
                </div>
              </DocCard>

              <DocCard icon={<Bell size={15} />} title="Price Alerts — OR Window Guard">
                <div className="space-y-2 text-xs text-gray-400">
                  <p>Alerts for <strong className="text-gray-300">OR_BREAK</strong> and <strong className="text-gray-300">VWAP_RETEST</strong> are suppressed during the first 15 minutes (6:30–6:45 AM PT / 9:30–9:45 AM ET) because OR high/low and VWAP are not yet reliable. The alert activates automatically at 6:45 AM PT.</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      { type: 'OR_BREAK', desc: 'Fires once when price breaks the opening range high or low. Suppressed during first 15 min.' },
                      { type: 'VWAP_RETEST', desc: 'Fires when price touches VWAP intraday. Suppressed during first 15 min.' },
                      { type: 'RVOL', desc: 'Fires when RVOL crosses your threshold. Not suppressed — volume is reliable from bar 1.' },
                      { type: 'PRICE_CROSS', desc: 'Fires when price crosses your level. Not suppressed — price is always reliable.' },
                    ].map(a => (
                      <div key={a.type} className="rounded-lg bg-gray-800/40 border border-gray-700/50 px-3 py-2">
                        <code className="text-[10px] font-mono text-violet-300">{a.type}</code>
                        <p className="text-[10px] text-gray-500 mt-0.5">{a.desc}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </DocCard>

              <DocCard icon={<Gauge size={15} />} title="Verdict Window — All Five States & Combinations">
                <div className="space-y-4 text-xs text-gray-400">
                  <p className="leading-relaxed">
                    The Day Trade engine produces one of five verdicts. Each verdict is the result of a two-stage process: a score-based raw verdict followed by a post-verdict gate that can only downgrade, never upgrade. Understanding what produces each state — and how they interact — tells you exactly what must change before an entry is valid.
                  </p>

                  <div className="space-y-2">
                    {[
                      {
                        verdict: 'STRONG GO',
                        color: 'text-emerald-300',
                        badge: 'bg-emerald-900/40 border-emerald-700/60',
                        dotColor: 'bg-emerald-500',
                        action: 'Enter at breakout — maximum position size within your plan.',
                        conditions: [
                          'Score ≥ 8.0 AND volume spike AND OR breakout confirmed above (long) or below (short)',
                          'Post-verdict gate did not fire: no extension, no chasing, VWAP structure aligned',
                          'SPY and QQQ providing a supportive macro backdrop',
                        ],
                        note: 'This is the highest-conviction day trade signal. All three signal groups (momentum, breakout, volume) are firing together. The engine has seen this setup historically lead to clean follow-through.',
                      },
                      {
                        verdict: 'GO',
                        color: 'text-emerald-400',
                        badge: 'bg-emerald-900/30 border-emerald-800/60',
                        dotColor: 'bg-emerald-400',
                        action: 'Enter — standard position sizing. Respect your stop level.',
                        conditions: [
                          'Score ≥ 6.0 — good edge present but not all signals at peak',
                          'Post-verdict gate did not fire (no extension, price on correct side of VWAP)',
                          'Soft edge confirmed (bull score clearly exceeds bear score by the margin threshold)',
                        ],
                        note: 'A valid trade, but entry quality is lower than STRONG GO. Volume or breakout confirmation may be partial. Use standard sizing — do not go maximum size on a GO alone.',
                      },
                      {
                        verdict: 'WATCH',
                        color: 'text-sky-400',
                        badge: 'bg-sky-900/30 border-sky-800/60',
                        dotColor: 'bg-sky-500',
                        action: 'Monitor only — do NOT enter. Set alerts for OR break and VWAP reclaim.',
                        conditions: [
                          'Score 4.5–5.9 — setup building but not confirmed',
                          'OR: GO downgraded because long bias + price below VWAP, or short bias + price above VWAP',
                          'RSI overbought (> 73) capping the verdict despite a solid score',
                        ],
                        note: 'WATCH means the engine sees a credible setup forming but one structural condition is not yet satisfied. The most common WATCH trigger is a VWAP misalignment — the engine is bullish but price is below VWAP, or bearish but price is above VWAP. Wait for the structure to confirm before touching size.',
                      },
                      {
                        verdict: 'WAIT',
                        color: 'text-amber-400',
                        badge: 'bg-amber-900/30 border-amber-800/60',
                        dotColor: 'bg-amber-500',
                        action: 'Stay flat. Read the "Flip to GO" condition shown on the session chart zone card.',
                        conditions: [
                          'Score < 5.0 — raw edge is insufficient',
                          'OR: GO downgraded because chasing detected (is_chasing = True)',
                          'OR: GO downgraded because edge_state = EXHAUSTED or LATE',
                          'OR: Soft edge failed — bull and bear scores are too close (no clear direction)',
                        ],
                        note: 'WAIT has a specific, actionable "Flip to GO" condition shown on the session chart. That condition is the only thing standing between WAIT and a valid entry. Examples: "Two consecutive green candles above $185.50 with no wick recovery," or "Price pulls back to $183.20 before continuing." Read it before deciding to skip or hold.',
                      },
                      {
                        verdict: 'AVOID',
                        color: 'text-red-400',
                        badge: 'bg-red-900/30 border-red-800/60',
                        dotColor: 'bg-red-500',
                        action: 'Do not trade this ticker today. Move on.',
                        conditions: [
                          'VIX ≥ 35 — macro volatility too high for clean intraday setups',
                          'Score < 3.0 (NO_EDGE) — no statistical edge detected in either direction',
                          'VIX ≥ 40 — hard veto, bull score zeroed out regardless of other signals',
                        ],
                        note: 'AVOID is an absolute signal. A high score does not override an AVOID verdict. The engine is not saying "wait for a better entry" — it is saying the structural conditions for a day trade do not exist today. Move to the next ticker.',
                      },
                    ].map(v => (
                      <div key={v.verdict} className={`rounded-lg border px-3 py-3 space-y-2 ${v.badge}`}>
                        <div className="flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full shrink-0 ${v.dotColor}`} />
                          <span className={`text-[12px] font-bold tracking-wide ${v.color}`}>{v.verdict}</span>
                        </div>
                        <div className="rounded-lg bg-black/20 px-3 py-2 space-y-1">
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Conditions that produce this state</p>
                          {v.conditions.map((c, i) => (
                            <div key={i} className="flex items-start gap-1.5 text-[11px] text-gray-400">
                              <span className="mt-1 h-1 w-1 rounded-full bg-gray-600 shrink-0" />{c}
                            </div>
                          ))}
                        </div>
                        <div className="rounded-lg bg-black/15 px-3 py-2 space-y-1">
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Recommended action</p>
                          <p className="text-[11px] text-gray-300">{v.action}</p>
                        </div>
                        <p className="text-[11px] text-gray-500 leading-relaxed italic">{v.note}</p>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-lg border border-violet-800/40 bg-violet-950/20 px-3 py-3 space-y-2">
                    <p className="text-[11px] font-semibold text-violet-300">Common verdict downgrade combinations</p>
                    <div className="space-y-1">
                      {[
                        { from: 'STRONG GO (raw)', arrow: '→', to: 'WAIT', reason: 'Extension gate fired — is_chasing=True or edge_state=EXHAUSTED' },
                        { from: 'STRONG GO (raw)', arrow: '→', to: 'WAIT', reason: 'No soft edge — bull and bear scores converged' },
                        { from: 'GO (raw)',         arrow: '→', to: 'WATCH', reason: 'Long bias + price below VWAP — wait for VWAP reclaim' },
                        { from: 'GO (raw)',         arrow: '→', to: 'WATCH', reason: 'Short bias + price above VWAP — wait for VWAP rejection' },
                        { from: 'WATCH',            arrow: '→', to: 'GO',   reason: 'VWAP reclaimed (long) or rejected (short) — stage resolves upward on next scan' },
                        { from: 'WAIT',             arrow: '→', to: 'GO',   reason: '"Flip to GO" condition met — specific candle and volume pattern confirmed' },
                      ].map((r, i) => (
                        <div key={i} className="grid grid-cols-[130px_16px_70px_1fr] gap-x-2 items-start text-[11px]">
                          <span className="font-mono text-gray-400">{r.from}</span>
                          <span className="text-gray-600">{r.arrow}</span>
                          <span className={`font-bold ${r.to === 'WAIT' ? 'text-amber-400' : r.to === 'WATCH' ? 'text-sky-400' : 'text-emerald-400'}`}>{r.to}</span>
                          <span className="text-gray-500 leading-snug">{r.reason}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </DocCard>

              <DocCard icon={<LineChart size={15} />} title="Session Chart — E1, E2, E3, E4 Entry Points">
                <div className="space-y-3 text-xs text-gray-400">
                  <p className="leading-relaxed">
                    The intraday session chart overlays up to four labeled entry levels. Each entry is derived from a different source and represents a different level of confidence. They are displayed as colored horizontal lines with arrow markers showing direction (up arrow for long, down arrow for short). Click any row in the entry table to toggle that line on or off the chart.
                  </p>

                  <div className="space-y-2">
                    {[
                      {
                        label: 'E1',
                        color: 'text-emerald-400',
                        dot: 'bg-emerald-400',
                        title: 'AI Coach Entry Gate Trigger',
                        source: 'AI Coach — entry_gate.trigger_price',
                        desc: 'The most specific entry level. The AI Coach has identified the exact price and candle condition that constitutes a valid entry trigger. If no gate price is available, the row shows as a stub placeholder labeled "AI Coach" — this means the AI Coach identified a trigger condition but could not pin it to a specific price level yet.',
                        pending: false,
                        stopNote: 'Stop: entry_guidance.risk_below, or OR high/low fallback',
                      },
                      {
                        label: 'E2',
                        color: 'text-sky-400',
                        dot: 'bg-sky-400',
                        title: 'AI Coach Trade Entry with R/R',
                        source: 'AI Coach — trade.entry_price',
                        desc: 'The AI Coach recommended entry price derived from its full trade analysis. Includes a risk/reward ratio. Entries where R/R < 1.0× are shown dimmed with an orange "(low R/R)" warning — this entry is not recommended. Uses the AI Coach stop level when available.',
                        pending: false,
                        stopNote: 'Stop: ai_coach.trade.stop, or OR high/low fallback',
                      },
                      {
                        label: 'E3',
                        color: 'text-violet-400',
                        dot: 'bg-violet-400',
                        title: 'OR Breakout Level',
                        source: 'entry_guidance.breakout_level, or OR high (long) / OR low (short)',
                        desc: 'The opening range breakout entry. For a long, this is the OR high — price must break and hold above with volume expansion. For a short, this is the OR low. This is the classic "confirmed OR break" entry. Stop is placed at the opposite side of the opening range.',
                        pending: false,
                        stopNote: 'Stop: OR low (long) / OR high (short)',
                      },
                      {
                        label: 'E4',
                        color: 'text-amber-400',
                        dot: 'bg-amber-400',
                        title: 'VWAP Re-Test (Pending / Conditional)',
                        source: 'entry_guidance.vwap or metrics.vwap',
                        desc: 'Shown as a dashed line — this entry is conditional and has not yet triggered. It represents a pullback-to-VWAP entry after an initial breakout. The "Watching" label in the table time column means the price hasn\'t reached this level yet. Only valid after a confirmed initial breakout; do not use as a first entry.',
                        pending: true,
                        stopNote: 'Stop: entry_guidance.risk_below, or OR high/low fallback',
                      },
                    ].map(e => (
                      <div key={e.label} className="rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2.5 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full shrink-0 ${e.dot}`} />
                          <span className={`font-bold font-mono text-[13px] ${e.color}`}>{e.label}</span>
                          <span className="font-semibold text-gray-200 text-[11px]">{e.title}</span>
                          {e.pending && <span className="text-[9px] font-semibold uppercase tracking-widest bg-amber-900/30 border border-amber-700/50 text-amber-400 px-1.5 py-0.5 rounded">Dashed — Pending</span>}
                        </div>
                        <p className="text-[11px] text-gray-400 leading-relaxed">{e.desc}</p>
                        <p className="text-[10px] text-gray-600 font-mono">{e.stopNote}</p>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-lg border border-gray-800 bg-gray-800/20 px-3 py-2.5 space-y-1.5">
                    <p className="text-[11px] font-semibold text-gray-300">Reading the entry table</p>
                    <div className="space-y-1">
                      {[
                        ['Price column', 'The exact level. "—" means no valid price was computed for this entry type.'],
                        ['Time column', '"Watching" = not yet triggered. A time stamp = the first bar that touched this level.'],
                        ['Trigger column', 'The candle condition or rule that defines this entry.'],
                        ['Stop column', 'The invalidation level in red — your stop loss goes here, not below an arbitrary round number.'],
                        ['Dimmed row', 'Either a stub placeholder (E1 with no gate price) or a low R/R entry (< 1.0×). Not recommended for execution.'],
                        ['Yellow "(WAIT)" tag', 'The overall verdict is WAIT — all entry rows are dimmed regardless of individual quality.'],
                      ].map(([k, v]) => (
                        <div key={k} className="flex gap-2 text-[11px]">
                          <span className="font-semibold text-gray-300 shrink-0 min-w-[110px]">{k}:</span>
                          <span className="text-gray-500">{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </DocCard>

              <DocCard icon={<CheckCircle2 size={15} />} title="Option Entry Check — Verdict Tab Logic">
                <div className="space-y-3 text-xs text-gray-400">
                  <p className="leading-relaxed">
                    The Option Entry Check panel sits below the session chart and runs three simultaneous checks before you touch any contract. It does not change the day-trade signal — it only tells you whether the execution conditions for an option trade are clean right now. The verdict strip at the bottom shows a single color-coded result that combines all three checks.
                  </p>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-[10px] uppercase tracking-wide text-gray-600 border-b border-gray-800">
                          <th className="px-2 py-1.5 font-semibold">Check</th>
                          <th className="px-2 py-1.5 font-semibold">What it measures</th>
                          <th className="px-2 py-1.5 font-semibold">Pass threshold</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ['Chart Trigger', 'Is the engine verdict GO (entry confirmed)?', 'chartTrigger = GO — engine authorized entry'],
                          ['Spread Quality', 'Is the ATM option bid-ask spread acceptable for intraday?', '≤ 5% of premium = OK · 5–10% = Warn · > 10% = Bad'],
                          ['P/C Alignment', 'Does the put/call ratio confirm the session direction?', 'Aligned = P/C matches bias · Neutral = 0.80–1.00 · Conflict = P/C opposes bias'],
                        ].map((r, i) => (
                          <tr key={i} className="border-b border-gray-800/40 text-[11px]">
                            <td className="px-2 py-2 font-semibold text-gray-200">{r[0]}</td>
                            <td className="px-2 py-2 text-gray-400">{r[1]}</td>
                            <td className="px-2 py-2 text-gray-500">{r[2]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold text-gray-300">Four verdict tiers</p>
                    {[
                      {
                        tier: 'Green — All checks passed',
                        bg: 'bg-emerald-900/20 border-emerald-700/50',
                        text: 'text-emerald-300',
                        conditions: 'Chart trigger = GO · Spread ≤ 5% · P/C aligned (or not in conflict)',
                        message: '"✓ All checks passed · Enter [CALL/PUT] at ATM $X.XX · Set stop at $X.XX before clicking confirm"',
                        action: 'Proceed with entry at the ATM strike. Use your normal position sizing for a day trade.',
                      },
                      {
                        tier: 'Amber — Marginal conditions',
                        bg: 'bg-amber-900/20 border-amber-700/50',
                        text: 'text-amber-300',
                        conditions: 'Spread 5–10% (moderate) OR P/C ratio is neutral (0.80–1.00)',
                        message: '"⚠ Spread marginal · enter 1 contract only · confirm volume before entry" or "⚠ P/C ratio neutral — no directional confirmation · 1 contract only"',
                        action: 'Enter 1 contract maximum. Confirm volume expansion on the next candle before adding size.',
                      },
                      {
                        tier: 'Red — Not ready',
                        bg: 'bg-red-900/20 border-red-700/50',
                        text: 'text-red-300',
                        conditions: 'Chart trigger = WAIT · OR spread > 10% · OR P/C conflicts with session direction',
                        message: '"✗ Not ready · [reason] · Flip to GO: [specific condition]"',
                        action: 'Do not enter. The "Flip to GO" condition shown tells you exactly what must happen before this panel can go green.',
                      },
                      {
                        tier: 'Gray — Watching',
                        bg: 'bg-gray-800/30 border-gray-700/50',
                        text: 'text-gray-300',
                        conditions: 'Chart trigger = WATCHING — engine is monitoring but has not confirmed the setup yet',
                        message: '"— Watching · No trigger yet · Wait for: [condition]"',
                        action: 'Set an alert. The engine is watching the same condition you are. No action until it fires.',
                      },
                    ].map(v => (
                      <div key={v.tier} className={`rounded-lg border px-3 py-2.5 space-y-1.5 ${v.bg}`}>
                        <p className={`text-[11px] font-bold ${v.text}`}>{v.tier}</p>
                        <div className="text-[10px] text-gray-500"><span className="font-semibold text-gray-400">Conditions: </span>{v.conditions}</div>
                        <div className="text-[10px] text-gray-600 italic">{v.message}</div>
                        <div className="text-[11px] text-gray-300"><span className="font-semibold">Action: </span>{v.action}</div>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-lg border border-sky-800/40 bg-sky-950/20 px-3 py-2 text-[11px] text-sky-200/80">
                    <strong className="text-sky-300">DTE selector:</strong> For day trades use 5–7 DTE. The panel shows the ATM strike for your selected expiry and flags if the chain is incomplete (closest strike more than 5% from current price). When the chain is incomplete, try a later expiry — some tickers have sparse near-term strike coverage.
                  </div>
                </div>
              </DocCard>

              <DocCard icon={<Sigma size={15} />} title="PUT/CALL Ratio — Interpretation & Alignment">
                <div className="space-y-3 text-xs text-gray-400">
                  <p className="leading-relaxed">
                    The PUT/CALL ratio measures total put volume divided by total call volume for the ticker, sourced from the prior session's options market. A ratio above 1.0 means more puts than calls were traded — negative sentiment. A ratio below 1.0 means more calls than puts — positive sentiment. This is a pre-market bias indicator, not a real-time timing signal. It tells you what the options market was feeling about this ticker yesterday, not what price will do in the next candle.
                  </p>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-[10px] uppercase tracking-wide text-gray-600 border-b border-gray-800">
                          <th className="px-3 py-2 font-semibold">Ratio range</th>
                          <th className="px-3 py-2 font-semibold">Reading</th>
                          <th className="px-3 py-2 font-semibold">Color</th>
                          <th className="px-3 py-2 font-semibold">Implication</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ['≥ 1.20', 'Bearish lean', 'Red', 'Heavy put buying — market expects downside or is hedging aggressively'],
                          ['1.00 – 1.19', 'Mild bearish', 'Amber', 'More puts than calls, but not extreme — moderate caution on long entries'],
                          ['0.80 – 0.99', 'Neutral', 'Gray', 'Balanced put/call activity — no directional confirmation from options market'],
                          ['0.60 – 0.79', 'Mild bullish', 'Amber', 'More calls than puts — market tilting toward upside but not strongly'],
                          ['< 0.60', 'Bullish lean', 'Green', 'Call buying dominant — market participants positioning for upside'],
                        ].map((r, i) => (
                          <tr key={i} className="border-b border-gray-800/40 text-[11px]">
                            <td className="px-3 py-2 font-mono text-gray-200">{r[0]}</td>
                            <td className={`px-3 py-2 font-semibold ${i <= 1 ? 'text-red-400' : i === 2 ? 'text-gray-400' : 'text-emerald-400'}`}>{r[1]}</td>
                            <td className="px-3 py-2 text-gray-500">{r[2]}</td>
                            <td className="px-3 py-2 text-gray-500">{r[3]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2.5 space-y-2">
                    <p className="text-[11px] font-semibold text-gray-200">Alignment with session bias</p>
                    <p className="text-[11px] text-gray-500 leading-relaxed">The engine compares the P/C ratio against the current day-trade bias to determine alignment. The result appears as a badge on the PUT/CALL strip at the top of the session card.</p>
                    <div className="space-y-1.5">
                      {[
                        { badge: '✓ Aligned', bg: 'bg-emerald-900/30 border-emerald-700/50 text-emerald-300', rule: 'SHORT bias + ratio ≥ 1.00 — put buying confirms the downside direction' },
                        { badge: '✓ Aligned', bg: 'bg-emerald-900/30 border-emerald-700/50 text-emerald-300', rule: 'LONG bias + ratio ≤ 0.80 — call buying confirms the upside direction' },
                        { badge: '— Neutral', bg: 'bg-gray-800/30 border-gray-700/50 text-gray-400', rule: 'Ratio 0.80–1.00 — no clear directional confirmation from options market' },
                        { badge: '✗ Conflicts', bg: 'bg-red-900/20 border-red-700/50 text-red-300', rule: 'SHORT bias + ratio < 0.90, or LONG bias + ratio > 1.10 — options market leans opposite' },
                      ].map((r, i) => (
                        <div key={i} className="flex items-start gap-2 text-[11px]">
                          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold border ${r.bg}`}>{r.badge}</span>
                          <span className="text-gray-500">{r.rule}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-lg border border-amber-800/40 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-200/80">
                    <strong className="text-amber-300">Important:</strong> A conflicting P/C ratio does not block entry — it reduces conviction. The Option Entry Check verdict drops to Red when P/C conflicts with session direction, meaning you should size down or skip the option entirely and trade the underlying equity instead. A neutral P/C ratio caps the Option Entry Check at Amber (1 contract max). The ratio is derived from prior-session data — intraday P/C updates are not available.
                  </div>
                </div>
              </DocCard>

              <DocCard icon={<RefreshCw size={15} />} title="Re-Entry Signals (REntry) — Types A, B, C">
                <div className="space-y-3 text-xs text-gray-400">
                  <p className="leading-relaxed">
                    After the initial entry window closes (roughly 45 bars after the opening range), the engine continues scanning for re-entry opportunities in the Hold / Monitor zone. Re-entries appear as blue "RE-ENTRY" zone cards on the session chart. They are second-chance entries for traders who missed the initial breakout, or opportunities to add size to an existing position at a better price. A maximum of three re-entries are shown per session.
                  </p>

                  <div className="space-y-2">
                    {[
                      {
                        type: 'A',
                        label: 'RE-ENTRY A — VWAP Pullback',
                        color: 'text-blue-300',
                        badge: 'bg-blue-900/30 border-blue-700/50',
                        trigger: 'Price extends more than 0.5% past VWAP, then pulls back to within 0.3% of VWAP.',
                        confirmation: 'The prior candle must close in the trade direction (green for long, red for short) before the zone fires.',
                        entry: 'First confirming candle off the VWAP test — do not enter before the candle closes.',
                        stop: '0.5% beyond VWAP (above VWAP for shorts, below for longs).',
                        why: 'VWAP is institutional anchoring. A pullback to VWAP after an extension often resolves in the direction of the original move — institutional desks add at VWAP, not after the move is 3% extended.',
                      },
                      {
                        type: 'B',
                        label: 'RE-ENTRY B — OR Level Retest',
                        color: 'text-blue-300',
                        badge: 'bg-blue-900/30 border-blue-700/50',
                        trigger: 'Price already broke out of the opening range (confirmed), then moves away and returns to within 0.3% of OR high (long) or OR low (short).',
                        confirmation: 'The OR level must hold as new support (long) or resistance (short). Prior candle must close in trade direction.',
                        entry: 'Confirming candle closing above OR high (long) or below OR low (short) — the OR level is now acting as a floor or ceiling.',
                        stop: '0.3% beyond the OR level.',
                        why: 'Breakout-pullback-retest is one of the most reliable intraday patterns. The OR level, once broken, often becomes support or resistance. This re-entry captures that structural hold.',
                      },
                      {
                        type: 'C',
                        label: 'RE-ENTRY C — Higher Low (Long) / Lower High (Short)',
                        color: 'text-blue-300',
                        badge: 'bg-blue-900/30 border-blue-700/50',
                        trigger: 'A swing low forms that is higher than the prior swing low (long), or a swing high forms that is lower than the prior swing high (short).',
                        confirmation: 'The first bounce bar after the swing low must close in the trade direction (green for long). This is the confirmation candle.',
                        entry: 'Enter at the close of the confirmation bar — the bar immediately after the qualifying swing low.',
                        stop: '0.3% below the new swing low (long) or above the new swing high (short).',
                        why: 'Higher lows are the definition of an uptrend. When the trend is making higher lows on the intraday chart, momentum is intact and the next push higher is likely. This entry captures the third leg of a wave structure.',
                      },
                    ].map(r => (
                      <div key={r.type} className={`rounded-lg border px-3 py-3 space-y-2 ${r.badge}`}>
                        <p className={`text-[12px] font-bold ${r.color}`}>{r.label}</p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {[
                            { label: 'Trigger condition', value: r.trigger },
                            { label: 'Confirmation required', value: r.confirmation },
                            { label: 'Entry', value: r.entry },
                            { label: 'Stop placement', value: r.stop },
                          ].map(f => (
                            <div key={f.label} className="rounded-lg bg-black/15 px-2.5 py-2">
                              <p className="text-[9px] font-semibold uppercase tracking-widest text-gray-600 mb-0.5">{f.label}</p>
                              <p className="text-[11px] text-gray-300 leading-snug">{f.value}</p>
                            </div>
                          ))}
                        </div>
                        <p className="text-[11px] text-gray-500 leading-relaxed italic">{r.why}</p>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2.5 space-y-2">
                    <p className="text-[11px] font-semibold text-gray-200">Quality gates — all three types must pass every gate</p>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {[
                        { gate: 'Max 3 per session', desc: 'Only the first three qualifying re-entries are shown. After that, the engine stops looking.' },
                        { gate: '20-bar cooldown', desc: 'A new re-entry cannot fire within 20 bars of the previous one — prevents clustering.' },
                        { gate: 'R/R ≥ 1.5×', desc: 'Distance to target must be at least 1.5× the distance to stop. Below this, the re-entry is skipped entirely.' },
                        { gate: '0.5% price movement', desc: 'Price must have moved at least 0.5% from the last re-entry close before the next one can fire.' },
                        { gate: 'Not invalidated', desc: 'If stop level is breached in future bars, the zone is suppressed — the engine looks ahead and hides stale zones.' },
                        { gate: 'Trend day exception', desc: 'On a trend day, re-entries remain active even when session bar count exceeds 210. Exhaustion rules are suspended.' },
                      ].map(g => (
                        <div key={g.gate} className="rounded-lg bg-gray-800/40 border border-gray-700/50 px-2.5 py-2">
                          <p className="text-[10px] font-semibold text-gray-300">{g.gate}</p>
                          <p className="text-[10px] text-gray-500 mt-0.5">{g.desc}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-lg border border-amber-800/40 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-200/80">
                    <strong className="text-amber-300">Re-entry target logic:</strong> Re-entries target T2 first (the extended scalp target), not T1. If T2 is not available, they fall back to T1. This means re-entry R/R calculations are based on the further target — if T2 is out of reach from the re-entry price, the R/R gate will fail and the zone will not appear.
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
                  Multi-day signal engine using daily candles (6 months history). Targets 1–5 session holds. Scores 7 technical signals + market context + VIX. Weak RVOL (&lt; 0.7×) downgrades GO to WATCH.
                </p>
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  {['STRONG GO', 'GO', 'WATCH', 'WAIT', 'AVOID'].map((v, i, a) => (
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
                  <p><strong className="text-gray-300">Index context:</strong> SPY daily trend and YTD performance fetched for market bias</p>
                  <p><strong className="text-gray-300">Earnings calendar:</strong> Next earnings date fetched — within 5 days forces debit spread override</p>
                </div>
              </DocCard>

              <DocCard icon={<Layers size={15} />} title="Step 2: Indicators Computed">
                <div className="space-y-3 text-xs text-gray-400">
                  {[
                    { title: '2a. MA20 / MA50', body: 'MA20 = SMA(Close, 20) · MA50 = SMA(Close, 50) · dist_ma20_pct = (last / MA20 − 1) × 100. Guard: NaN raises ValueError.' },
                    { title: '2b. RSI 14-day (Wilder\'s)', body: 'RSI = 100 − 100 / (1 + avg_gain / avg_loss) using EWM with com=13. Overbought > 73 caps momentum score.' },
                    { title: '2c. MACD (12, 26, 9)', body: 'MACD_line = EMA12 − EMA26. Signal = EMA9(MACD). Histogram = MACD − Signal. Expanding histogram = acceleration.' },
                    { title: '2d. 5-Day Momentum', body: 'mom_pct = (last / close[−5] − 1) × 100. Measures 1-week directional force.' },
                    { title: '2e. Volume Trend', body: 'bull_expanding: up-day vol > 1.2× avg AND > down-day vol. bear_expanding: reverse. low: recent < 0.7× avg. RVOL < 0.7 → GO downgraded to WATCH.' },
                    { title: '2f. Earnings Calendar', body: 'days_to_earnings fetched from yfinance calendar. ≤ 5 days → forced debit spread strategy override. Earnings within DTE window triggers warning.' },
                  ].map(s => (
                    <div key={s.title} className="rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2.5">
                      <div className="font-semibold text-gray-200 text-[11px] mb-1">{s.title}</div>
                      <p className="text-gray-500 text-[10px]">{s.body}</p>
                    </div>
                  ))}
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
                        ['1', 'Price vs MA20', 'price > MA20', 'bull += 2.0'],
                        ['2', 'MA trend structure', 'MA20 > MA50 by X%', 'bull += min(3, max(0.5, X×0.15))'],
                        ['2a', 'MA convergence penalty', 'spread narrowing > 5%', 'score × 0.5'],
                        ['3', 'RSI bullish zone', '55–73', 'bull += 1.5'],
                        ['3a', 'RSI overbought', '> 73', '0 pts; caps verdict → WATCH'],
                        ['4', 'MACD crossover', 'MACD > Signal', 'bull += 2.0'],
                        ['4a', 'MACD histogram', 'hist > 0 AND expanding', 'bull += 0.5'],
                        ['5', '5-day momentum', 'mom > +1.5%', 'bull += 1.0'],
                        ['6', 'Volume participation', 'bull_expanding', 'bull += 1.5'],
                        ['7', 'SPY market context', 'SPY BULLISH', 'bull += 0.5'],
                        ['8', 'VIX caution', 'VIX ≥ 25', 'bull −= 0.5 (floor 0)'],
                        ['9', 'Weak RVOL', 'RVOL < 0.7', 'GO → WATCH downgrade'],
                        ['10', 'VIX ≥ 35 hard veto', 'any score', '→ AVOID'],
                      ].map((r, i) => (
                        <tr key={i} className="border-b border-gray-800/40 text-[11px]">
                          <td className="px-2 py-1.5 font-mono text-violet-300">{r[0]}</td>
                          <td className="px-2 py-1.5 font-semibold text-gray-200">{r[1]}</td>
                          <td className="px-2 py-1.5 text-gray-400">{r[2]}</td>
                          <td className="px-2 py-1.5 font-mono text-emerald-300">{r[3]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-gray-500 mt-2">Bear side mirrors bull rules. STRONG setup_quality upgrades GO → STRONG_GO via resolve_verdict_swing().</p>
              </DocCard>

              <DocCard icon={<Gauge size={15} />} title="Step 4: Verdict Logic">
                <div className="space-y-3 text-xs text-gray-400">
                  <div className="rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2 space-y-1">
                    <p className="font-semibold text-gray-200 text-[11px]">resolve_verdict("swing", raw_score, rvol, vix):</p>
                    <ul className="space-y-0.5 text-gray-500">
                      <li className="flex gap-2 text-[11px]"><span className="mt-1.5 h-1 w-1 rounded-full bg-red-500 shrink-0" />VIX ≥ 35 → AVOID</li>
                      <li className="flex gap-2 text-[11px]"><span className="mt-1.5 h-1 w-1 rounded-full bg-gray-500 shrink-0" />score &lt; 3.0 → NO_EDGE</li>
                      <li className="flex gap-2 text-[11px]"><span className="mt-1.5 h-1 w-1 rounded-full bg-amber-500 shrink-0" />score &lt; 5.0 → WAIT</li>
                      <li className="flex gap-2 text-[11px]"><span className="mt-1.5 h-1 w-1 rounded-full bg-emerald-500 shrink-0" />score ≥ 8.0 + vol_spike → STRONG_GO</li>
                      <li className="flex gap-2 text-[11px]"><span className="mt-1.5 h-1 w-1 rounded-full bg-emerald-500 shrink-0" />score ≥ 6.0 → GO (but RVOL &lt; 0.7 → WATCH)</li>
                      <li className="flex gap-2 text-[11px]"><span className="mt-1.5 h-1 w-1 rounded-full bg-sky-500 shrink-0" />score ≥ 4.5 → WATCH</li>
                      <li className="flex gap-2 text-[11px]"><span className="mt-1.5 h-1 w-1 rounded-full bg-sky-500 shrink-0" />setup_quality=STRONG + score=GO → upgrade to STRONG_GO</li>
                    </ul>
                  </div>
                </div>
              </DocCard>

              <DocCard icon={<FlaskConical size={15} />} title="Step 5: Worked Example (AVGO, Bullish Swing)">
                <div className="space-y-3 text-xs text-gray-400">
                  <div className="rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2 space-y-1">
                    <p className="font-semibold text-gray-200 text-[11px]">Inputs</p>
                    <p className="text-gray-500 font-mono text-[10px]">Price: $458 | MA20: $442 | MA50: $420 | RSI: 62 | MACD hist: expanding</p>
                    <p className="text-gray-500 font-mono text-[10px]">5d mom: +2.1% | vol: bull_expanding | SPY: BULLISH | VIX: 18.0 | RVOL: 1.1×</p>
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
                          ['Price > MA20 (+3.6%)', '2.0', 'bull 2.0'],
                          ['MA20 > MA50 (5.2%)', '2.5 (capped)', 'bull 4.5'],
                          ['RSI 62 (55–73)', '1.5', 'bull 6.0'],
                          ['MACD > Signal + expanding', '2.0 + 0.5', 'bull 8.5'],
                          ['5d momentum +2.1%', '1.0', 'bull 9.5'],
                          ['bull_expanding volume', '1.5', 'bull 11.0'],
                          ['SPY BULLISH', '0.5', 'bull 11.5'],
                        ].map((r, i) => (
                          <tr key={i} className="border-b border-gray-800/40 text-[11px]">
                            <td className="px-2 py-1.5 text-gray-200">{r[0]}</td>
                            <td className="px-2 py-1.5 font-mono text-emerald-300">{r[1]}</td>
                            <td className="px-2 py-1.5 font-mono text-gray-400">{r[2]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="rounded-lg border border-gray-800 bg-emerald-950/20 px-3 py-2">
                    <p className="text-gray-400 text-[11px]">RVOL 1.1× &gt; 0.7 ✓ (no downgrade) | VIX 18 &lt; 35 ✓</p>
                    <p className="text-emerald-400 font-bold text-[11px] mt-0.5">→ Verdict: STRONG GO (score 11.5 ≥ 8.0 + vol_spike)</p>
                  </div>
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

              <DocCard icon={<Briefcase size={15} />} title="Overview — Strategic Options Structures">
                <div className="space-y-2 text-xs text-gray-400">
                  <p>Builds and validates complete multi-leg option structures against a full pre-trade checklist. Applies EV calculation, Kelly sizing, IV rank gate, and the 4-state entry system to every candidate.</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      { label: 'Verdict scale', desc: 'STRONG GO / GO / WATCH / WAIT / AVOID — driven by resolve_verdict_regular(score, candidates).' },
                      { label: 'AVOID is absolute', desc: 'Verdict = NO GO or score < 40 → AVOID state shown on card. Score 89 + AVOID = AVOID. Score never overrides verdict.' },
                      { label: 'IV Rank gate', desc: 'Credit strategies need IV Rank ≥ 30. Debit strategies need IV Rank < 50. Mismatch = missing condition on card.' },
                      { label: 'Earnings guard', desc: '≤ 5 days to earnings → strategy forced to debit spread. Earnings within DTE shows warning badge.' },
                    ].map(c => (
                      <div key={c.label} className="rounded-lg bg-gray-800/40 border border-gray-700/50 px-3 py-2">
                        <div className="font-semibold text-gray-200 text-[11px]">{c.label}</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">{c.desc}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </DocCard>

              <DocCard icon={<Gauge size={15} />} title="Verdict Scoring — resolve_verdict_regular()">
                <div className="space-y-2 text-xs text-gray-400">
                  <p className="text-gray-500">Score comes from the pre-trade checklist. 0 candidates → NO_EDGE regardless of score.</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-[10px] uppercase tracking-wide text-gray-600 border-b border-gray-800">
                          <th className="px-3 py-2">Score range</th>
                          <th className="px-3 py-2">Verdict</th>
                          <th className="px-3 py-2">Entry state</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ['≥ 80', 'STRONG GO', 'STATE 2: ENTRY'],
                          ['60–79', 'GO', 'STATE 2: ENTRY (all filters must pass)'],
                          ['45–59', 'WATCH', 'STATE 1: SETUP'],
                          ['30–44', 'WAIT', 'WATCH'],
                          ['< 30', 'AVOID', 'AVOID (blocked)'],
                          ['0 candidates', 'NO_EDGE', '— (no structures built)'],
                        ].map((r, i) => (
                          <tr key={i} className="border-b border-gray-800/40 text-[11px]">
                            <td className="px-3 py-2 font-mono text-violet-300">{r[0]}</td>
                            <td className="px-3 py-2 font-semibold text-gray-200">{r[1]}</td>
                            <td className="px-3 py-2 text-gray-400">{r[2]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </DocCard>

              <DocCard icon={<Layers size={15} />} title="4-State Entry System">
                <div className="space-y-3 text-xs text-gray-400">
                  <p>Every recommendation card shows one of four states derived from verdict + score + IV fit + filters. <strong className="text-amber-300">AVOID verdict always wins — score is never sufficient to override it.</strong></p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      {
                        num: 'STATE 2', label: 'ENTRY', badgeCls: 'bg-emerald-900/50 text-emerald-300 border-emerald-700',
                        when: 'Verdict = GO · Score ≥ 70 · IV fits · All filters pass (R:R, liquidity, credit ≥ 25%)',
                        action: 'Enter now. Credit: stop at 2× credit, target 50% profit. Debit: stop at 50% premium, target 100%.',
                      },
                      {
                        num: 'STATE 1', label: 'SETUP', badgeCls: 'bg-amber-900/50 text-amber-300 border-amber-700',
                        when: 'Verdict = GO or CAUTION · Score ≥ 55 · Liquidity passes · One condition still missing',
                        action: 'Monitor missing conditions. Do not enter — one or more gates not cleared.',
                      },
                      {
                        num: 'WATCH', label: 'WATCH', badgeCls: 'bg-sky-900/40 text-sky-300 border-sky-700',
                        when: 'Score 40–55 · Multiple filters failing or IV not aligned',
                        action: 'Set an alert. Re-analyze when score reaches 70 and IV fits.',
                      },
                      {
                        num: 'AVOID', label: 'AVOID', badgeCls: 'bg-red-900/40 text-red-300 border-red-800',
                        when: 'Verdict = NO GO OR score < 40. Hard fail: EV ≤ 0, DTE too short, liquidity fail, IV mismatch.',
                        action: 'Skip. Fails minimum quality thresholds. ENTER button does not appear.',
                      },
                    ].map(s => (
                      <div key={s.num} className="rounded-lg border border-gray-700/50 bg-gray-800/30 px-3 py-2.5 space-y-1.5">
                        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${s.badgeCls}`}>{s.num}: {s.label}</span>
                        <div><span className="text-[10px] font-semibold text-gray-300">When: </span><span className="text-[10px]">{s.when}</span></div>
                        <div><span className="text-[10px] font-semibold text-gray-300">Action: </span><span className="text-[10px]">{s.action}</span></div>
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
                        <th className="px-3 py-2">Strategies built</th>
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
             SECTION 18 — VERDICT CARD SCORING
             ═══════════════════════════════════════════════════════ */}
          <section id="verdict-card" className="scroll-mt-24">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Award size={18} className="text-violet-400" />
              Verdict Card Scoring
            </h2>
            <p className="text-xs text-gray-500 mb-4">The UnifiedVerdictCard appears on the Swing Trade and Day Trade pages. It determines the trade readiness status using a two-score threshold system displayed as a green, amber, or gray status bar.</p>

            <DocCard icon={<Activity size={15} />} title="Two-Score System">
              <div className="space-y-2 text-xs text-gray-400">
                <p>The card evaluates two independent scores. Both must cross their respective thresholds to advance to the next status level.</p>
                <div className="grid gap-2 sm:grid-cols-2 mt-2">
                  {[
                    { name: 'Setup Score', range: '0–100', source: 'Composite of all engine signals, confidence, and market context. Higher = more conditions aligned.' },
                    { name: 'Signal Quality', range: '0–10', source: 'Weighted ratio of passing vs warning conditions. 7+ = Strong, 4–6.9 = Moderate, below 4 = Weak.' },
                  ].map(s => (
                    <div key={s.name} className="rounded-lg bg-gray-800/40 border border-gray-700/50 px-3 py-2.5">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] font-semibold text-gray-200">{s.name}</span>
                        <span className="text-[10px] font-mono text-violet-300">{s.range}</span>
                      </div>
                      <p className="text-[10px] text-gray-500">{s.source}</p>
                    </div>
                  ))}
                </div>
              </div>
            </DocCard>

            <DocCard icon={<Gauge size={15} />} title="Status Thresholds">
              <p className="text-xs text-gray-500 mb-3">The card determines the trade readiness status. The engine verdict overrides the score thresholds when it indicates an actionable setup:</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wide text-gray-600 border-b border-gray-800">
                      <th className="px-2 py-1.5 font-semibold">Status</th>
                      <th className="px-2 py-1.5 font-semibold">Engine Verdict</th>
                      <th className="px-2 py-1.5 font-semibold">Setup Score</th>
                      <th className="px-2 py-1.5 font-semibold">Color</th>
                      <th className="px-2 py-1.5 font-semibold">Meaning</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { status: 'Entry conditions met', verdict: 'STRONG GO', ss: 'any', color: 'Green', meaning: 'Engine verdict overrides scores. The setup is fully aligned regardless of confidence — proceed with entry.' },
                      { status: 'Entry conditions met', verdict: 'GO', ss: '≥ 65', color: 'Green', meaning: 'Engine says GO and scores support it. Entry conditions are favorable.' },
                      { status: 'Setup building', verdict: 'GO', ss: '< 65', color: 'Amber', meaning: 'Engine says GO but setup score is too low for full confidence. Scores must improve before acting.' },
                      { status: 'Setup building', verdict: 'WATCH or lower', ss: '≥ 65 + SQ ≥ 7.0', color: 'Amber', meaning: 'Scores are decent but engine is not yet ready. Monitor for confirmation triggers.' },
                      { status: 'Watching', verdict: 'WATCH or lower', ss: '< 65 or SQ < 7.0', color: 'Amber', meaning: 'Scores are below both thresholds. Conditions are not forming. Do not enter.' },
                    ].map(r => (
                      <tr key={`${r.status}-${r.verdict}`} className="border-b border-gray-800/40 text-[11px]">
                        <td className={`px-2 py-1.5 font-semibold ${r.color === 'Green' ? 'text-emerald-400' : 'text-amber-400'}`}>{r.status}</td>
                        <td className="px-2 py-1.5 font-mono text-gray-300">{r.verdict}</td>
                        <td className="px-2 py-1.5 font-mono text-gray-300">{r.ss}</td>
                        <td className="px-2 py-1.5">
                          <span className={`inline-block w-2 h-2 rounded-full ${r.color === 'Green' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                          <span className="ml-1.5 text-gray-400">{r.color}</span>
                        </td>
                        <td className="px-2 py-1.5 text-gray-400">{r.meaning}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="rounded-lg bg-amber-950/20 border border-amber-800/30 px-3 py-2 mt-3">
                <p className="text-[10px] text-amber-200/80"><strong>Rule:</strong> The engine verdict is checked first. STRONG GO always shows green regardless of scores. GO shows green only if setup score ≥ 65. For all other verdicts (WATCH, WAIT, AVOID), the score thresholds apply: both setup score ≥ 65 AND signal quality ≥ 7.0 are required for "Setup building."</p>
              </div>
            </DocCard>

            <DocCard icon={<Layers size={15} />} title="Additional Card Content">
              <div className="space-y-2 text-xs text-gray-400">
                <div className="grid gap-2 sm:grid-cols-2">
                  {[
                    { label: 'Risk Profile Chips', desc: 'Inline severity-coded badges showing specific risk factors (extension, volatility, liquidity). Hover for detail. Max 4 shown.' },
                    { label: 'Psychology Message', desc: 'Italic insight about the trader\u2019s emotional state \u2014 addressing FOMO, chase risk, patience required. Only shown when the engine produces a psychology signal.' },
                    { label: 'Condition Chips', desc: 'Up to 8 pass/warn/fail condition chips. Pass = green, Warn = amber, Fail = red. Same data as the analysis condition list.' },
                    { label: 'Meta Footer', desc: 'Structure label, risk level (LOW/MEDIUM/HIGH), RVOL. Consistent across all trade types.' },
                  ].map(c => (
                    <div key={c.label} className="rounded-lg bg-gray-800/40 border border-gray-700/50 px-3 py-2">
                      <div className="text-[11px] font-semibold text-gray-200 mb-0.5">{c.label}</div>
                      <p className="text-[10px] text-gray-500">{c.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </DocCard>
          </section>

          {/* ═══════════════════════════════════════════════════════
             SECTION 19 — FAQ
             ═══════════════════════════════════════════════════════ */}
          <section id="faq" className="scroll-mt-24">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <HelpCircle size={18} className="text-violet-400" />
              FAQ
            </h2>

            <DocCard icon={<HelpCircle size={15} />} title="Frequently Asked Questions">
              <div className="space-y-3">
                {[
                  { q: 'Why is a GO trade still waiting?', a: 'When the engine verdict is STRONG GO, the card always shows "Entry conditions met." When the verdict is GO, the card checks the setup score: if ≥ 65, it shows "Entry conditions met." If < 65, it shows "Setup building" because the scores don\'t support the GO verdict yet. This prevents contradiction between a high-level GO and weak underlying scores.' },
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
