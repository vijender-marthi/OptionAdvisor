export const ROUTES = {
  home: '/trade-command-center',
  tradeCommandCenter: '/trade-command-center',
  strategyFinder: '/position-trading',
  dayTrade: '/day-trade',
  swingTrade: '/swing-trade',
  swingWatchlist: '/signal-feed?source=swing',
  regularTrade: '/trade-signals',
  signals: '/trade-signals',
  aiCoach: '/ai-coach',
  journal: '/journal',
  settings: '/settings',
  positions: '/positions?tab=open',
  watchlist: '/signal-feed',
  alerts: '/alerts',
  dayTradeAlerts: '/day-trade-alerts',
  myTickers: '/my-tickers',
  dayTradeDashboard: '/day-trade-dashboard',
  tools: '/tools',
  optionChain: '/option-chain',
  eodJournal: '/eod-journal',
} as const

export type EngineType = 'DAY' | 'SWING' | 'REGULAR'

/** Base route for engine type + ticker (?ticker=...). */
export function getEngineRoute(engineType: string, ticker: string): string {
  const key = engineType.trim().toLowerCase()
  const encodedTicker = encodeURIComponent(ticker)
  if (key === 'day') return `${ROUTES.dayTrade}?ticker=${encodedTicker}`
  if (key === 'swing') return `${ROUTES.swingTrade}?ticker=${encodedTicker}`
  return `${ROUTES.strategyFinder}?ticker=${encodedTicker}`
}

/** Route for engine type with optional ticker and from= param. */
export function routeForEngine(engineType: string, ticker?: string, from?: string): string {
  const key = engineType.trim().toLowerCase()
  const fromParam = from ? encodeURIComponent(from) : encodeURIComponent(ROUTES.tradeCommandCenter)
  const sep = ticker ? '&' : '?'
  if (key === 'day') {
    const base = ticker ? `${ROUTES.dayTrade}?ticker=${encodeURIComponent(ticker)}` : ROUTES.dayTrade
    return `${base}${sep}from=${fromParam}`
  }
  if (key === 'swing') {
    const base = ticker ? `${ROUTES.swingTrade}?ticker=${encodeURIComponent(ticker)}` : ROUTES.swingTrade
    return `${base}${sep}from=${fromParam}`
  }
  const base = ticker ? `${ROUTES.strategyFinder}?ticker=${encodeURIComponent(ticker)}` : ROUTES.strategyFinder
  return `${base}${sep}from=${fromParam}`
}

/** Route for a recommendation (always has ticker + from). */
export function getDetailsRoute(engineType: string, ticker: string, from?: string): string {
  const base = getEngineRoute(engineType, ticker)
  const fromParam = from ? encodeURIComponent(from) : encodeURIComponent(ROUTES.tradeCommandCenter)
  return `${base}&from=${fromParam}`
}
