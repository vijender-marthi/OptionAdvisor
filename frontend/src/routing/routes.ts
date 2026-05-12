export const ROUTES = {
  home: '/trade-command-center',
  tradeCommandCenter: '/trade-command-center',
  strategyFinder: '/strategy-finder',
  dayTrade: '/day-trade',
  swingTrade: '/swing-trade',
  swingWatchlist: '/watchlistx?source=swing',
  regularTrade: '/trade-signals',
  signals: '/trade-signals',
  aiCoach: '/ai-coach',
  journal: '/journal',
  settings: '/settings',
  positions: '/positions?tab=open',
  watchlist: '/watchlistx',
  alerts: '/alerts',
  dayTradeAlerts: '/day-trade-alerts',
  myTickers: '/my-tickers',
} as const

export type EngineType = 'DAY' | 'SWING' | 'REGULAR'

export function getEngineRoute(engineType: string, ticker: string): string {
  const key = engineType.trim().toLowerCase()
  const encodedTicker = encodeURIComponent(ticker)
  if (key === 'day') return `${ROUTES.dayTrade}?ticker=${encodedTicker}`
  if (key === 'swing') return `${ROUTES.swingTrade}?ticker=${encodedTicker}`
  return `${ROUTES.strategyFinder}?ticker=${encodedTicker}`
}
