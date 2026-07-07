# Trade Dashboard Audit

## Recommended Navigation

1. Trade Dashboard
2. Positions
3. Watchlist
4. Journal
5. Backtest
6. Settings

The product should be organized around the trader workflow: Market Story, Opportunity, Execution Plan, and Position Management. Engines should become trade types or panels inside the dashboard rather than separate destinations that compete for authority.

## Page Classification

| Page / Area | Classification | Why |
| --- | --- | --- |
| Trade Dashboard | KEEP | Best primary cockpit. Should become the one-ticker decision workspace and absorb duplicate trade views. |
| Day Trade Page | MERGE | Valuable session chart and execution detail, but overlaps with dashboard and should become a drill-down from Trade Dashboard. |
| Scalp Trading | MERGE | Keep as a trade type inside Trade Dashboard, not a separate product surface. |
| Carry Trading | MERGE | Keep as a final-hour overnight management/trade type panel inside Trade Dashboard. |
| Swing Trading | MERGE | Keep as a trade type inside Trade Dashboard with daily chart context and fewer duplicate verdict cards. |
| Classic / Regular Trade | MERGE | Strategy selection belongs in Pre-Trade Analysis and Trade Dashboard, not a competing engine page. |
| Turbo Trader | ADVANCED | Useful for speed workflows, but should be hidden behind Advanced Mode until it proves unique value. |
| Option Advisor / Pre-Trade Analysis | KEEP | Solves a distinct contract-quality question after the trade idea exists. |
| Position Center | KEEP | Core post-entry workflow. Metrics belong on dashboard; open/closed tabs should stay operational. |
| Watchlist / My Tickers | KEEP | Core input list. Keep simple table format and links into workflow pages. |
| Signal Feed / Trade Signals | MERGE | Mostly duplicate scanner/overview data. Keep as a lightweight overview or merge into Watchlist. |
| Ticker Scanner | KEEP | Useful discovery table. Should remain table-first and avoid duplicate verdict logic. |
| Backtest Lab | KEEP | Separate research workflow. Keep outside live trading cockpit. |
| Alerts / Alert Center | KEEP | Operationally useful. Show only actionable phrases by default. |
| EOD Journal / Journal Tool | MERGE | Keep journaling, but consolidate into one Journal area with history and comparison views. |
| Investment Thesis | KEEP | Long-term investing is separate from trading and should stay independent. |
| Track Mode | ADVANCED | Useful but can confuse core flow. Show under Advanced or Position Center. |
| Day Trade Alerts / Watchlist | MERGE | Belongs under Alerts or Watchlist, not as standalone nav. |
| QRadar / AI Stocks / Tools | ADVANCED | Research utilities. Hide behind Advanced Mode unless used daily. |
| Help / Glossary | KEEP | Keep under Resources/Help, not primary trading nav. |

## Component Themes

| Component Type | Classification | Why |
| --- | --- | --- |
| Duplicate verdict cards | MERGE | One final decision card should own action, blocker, invalidation, and next trigger. |
| Duplicate score cards | MERGE | Replace competing scores with one Trade Quality Score and clear breakdown. |
| Raw indicator lists | ADVANCED | Raw RSI/MACD/IV details should support the explanation, not dominate the decision. |
| Session chart | KEEP | High-value visual anchor. Add confirmed structure labels where possible. |
| Strategy guide tables | KEEP | Useful educational reference, but keep separate from live decision cards. |

## Target Trade Dashboard Structure

The Trade Dashboard should center on one ticker at a time:

1. Market Story
2. Structure Map
3. Opportunity Verdict
4. Execution Plan
5. Risk / Invalidation
6. What Would Change My Mind?
7. Existing Position Guidance

## Strictness Changes

Hard blockers should be limited to:

- Earnings today/tomorrow
- Major binary event
- Options illiquid
- Spread too wide
- Price too extended with no pullback
- Market halted / bad data
- No stop level possible

Warnings should not automatically block a setup:

- RSI overbought/oversold
- MACD lagging
- IV elevated
- Mixed timeframe
- Slightly weak volume
- Market not fully aligned

## Migration Plan

1. Add structure intelligence services and tests.
2. Add a compact Market Story panel to Trade Dashboard.
3. Deprecate duplicate nav entries by moving them under Advanced Mode.
4. Merge duplicate verdict cards into one decision component.
5. Keep detailed engine pages as drill-downs, not primary workflow destinations.
