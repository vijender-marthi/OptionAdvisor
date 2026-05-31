import type { Page } from '../types'

/** Map browser location to legacy ``Page`` key (sidebar + permissions). */
export function locationToPage(pathname: string): Page {
  const raw = pathname.endsWith('/') && pathname.length > 1 ? pathname.slice(0, -1) : pathname
  const seg = raw === '/' ? '' : raw.replace(/^\//, '').split('/')[0] ?? ''

  switch (seg) {
    case '':
      return 'trade-command-center'
    case 'position-trading':
    case 'strategy-finder':
    case 'ticker':
      return 'ticker'
    case 'dashboard':
    case 'trade-command-center':
      return 'trade-command-center'
    case 'ai-coach':
      return 'ai-coach'
    case 'positions':
      return 'positions'
    case 'watchlist':
      return 'my-watchlist'
    case 'watchlistx':
    case 'signal-feed':
      return 'watchlist'
    case 'alerts':
      return 'alert-center'
    case 'help':
    case 'trading-glossary':
      return 'help'
    case 'settings':
      return 'settings'
    case 'ai-stocks':
      return 'ai-stocks'
    case 'q-radar':
      return 'q-radar'
    case 'backtest':
      return 'backtest'
    case 'trade-signals':
      return 'trade-signals'
    case 'journal':
      return 'journal'
    case 'auto-trade':
      return 'auto-trade'
    case 'day-trade':
      return 'day-trade'
    case 'day-trade-watchlist':
      return 'day-trade-watchlist'
    case 'day-trade-alerts':
      return 'day-trade-alerts'
    case 'active-trades':
      return 'active-trades'
    case 'swing-trade':
      return 'swing-trade'
    case 'swing-trade-watchlist':
      return 'swing-trade-watchlist'
    case 'login':
      return 'login'
    case 'forgot-password':
      return 'forgot-password'
    case 'reset-password':
      return 'reset-password'
    case 'activate':
      return 'activate'
    case 'my-tickers':
      return 'my-tickers'
    case 'desk':
      return 'desk'
    case 'day-trade-dashboard':
      return 'day-trade-dashboard'
    case 'ticker-scanner':
      return 'ticker-scanner'
    default:
      return 'trade-command-center'
  }
}

/** Human-readable path (+ optional query) for ``navigate(page)``. */
export function pageToLocation(p: Page): string {
  switch (p) {
    case 'ticker':
      return '/strategy-finder'
    case 'ai-coach':
      return '/ai-coach'
    case 'watchlist':
      return '/signal-feed'
    case 'my-watchlist':
      return '/watchlist'
    case 'portfolio':
      return '/positions?tab=open'
    case 'positions':
      return '/positions?tab=open'
    case 'trade-command-center':
      return '/trade-command-center'
    case 'alert-center':
      return '/alerts'
    case 'help':
    case 'trading-glossary':
      return '/help'
    case 'settings':
      return '/settings'
    case 'ai-stocks':
      return '/ai-stocks'
    case 'q-radar':
      return '/q-radar'
    case 'backtest':
      return '/backtest'
    case 'trade-signals':
      return '/trade-signals'
    case 'journal':
      return '/journal'
    case 'auto-trade':
      return '/auto-trade'
    case 'day-trade':
      return '/day-trade'
    case 'day-trade-watchlist':
      return '/signal-feed?source=day'
    case 'day-trade-alerts':
      return '/day-trade-alerts'
    case 'active-trades':
      return '/active-trades'
    case 'swing-trade':
      return '/swing-trade'
    case 'swing-trade-watchlist':
      return '/signal-feed?source=swing'
    case 'login':
      return '/login'
    case 'forgot-password':
      return '/forgot-password'
    case 'reset-password':
      return '/reset-password'
    case 'activate':
      return '/activate'
    case 'my-tickers':
      return '/my-tickers'
    case 'desk':
      return '/desk'
    case 'day-trade-dashboard':
      return '/day-trade-dashboard'
    case 'ticker-scanner':
      return '/ticker-scanner'
    default:
      return '/trade-command-center'
  }
}
