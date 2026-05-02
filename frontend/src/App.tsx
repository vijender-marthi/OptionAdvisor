import { lazy, Suspense, useEffect } from 'react'
import { AppProvider, useApp } from './contexts/AppContext'
import AppLayout from './layouts/AppLayout'
import LoginPage from './pages/LoginPage'

const TickerPage = lazy(() => import('./pages/TickerPage'))
const WatchlistPage = lazy(() => import('./pages/WatchlistPage'))
const PortfolioPage = lazy(() => import('./pages/PortfolioPage'))
const HelpPage = lazy(() => import('./pages/HelpPage'))
const AIStocksPage = lazy(() => import('./pages/AIStocksPage'))
const QRadarPage = lazy(() => import('./pages/QRadarPage'))
const BacktestPage = lazy(() => import('./pages/BacktestPage'))
const TradeSignalsPage = lazy(() => import('./pages/TradeSignalsPage'))
const AlertsPage = lazy(() => import('./pages/AlertsPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const JournalPage = lazy(() => import('./pages/JournalPage'))

function RouteFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center text-sm text-gray-500">
      <span className="inline-flex items-center gap-2">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" aria-hidden />
        Loading…
      </span>
    </div>
  )
}

// ── Inner router (has access to context) ────────────────────────────────────
function Router() {
  const { page, user, navigate } = useApp()

  // Redirect unauthenticated users to login
  useEffect(() => {
    if (!user && page !== 'login') navigate('login')
  }, [user, page, navigate])

  if (!user || page === 'login') return <LoginPage />

  return (
    <AppLayout>
      <Suspense fallback={<RouteFallback />}>
        {page === 'ticker'        && <TickerPage />}
        {page === 'watchlist'     && <WatchlistPage />}
        {page === 'portfolio'     && <PortfolioPage />}
        {page === 'help'          && <HelpPage />}
        {page === 'ai-stocks'     && <AIStocksPage />}
        {page === 'q-radar'       && <QRadarPage />}
        {page === 'backtest'      && <BacktestPage />}
        {page === 'trade-signals' && <TradeSignalsPage />}
        {page === 'alerts'        && <AlertsPage />}
        {page === 'settings'      && <SettingsPage />}
        {page === 'journal'       && <JournalPage />}
      </Suspense>
    </AppLayout>
  )
}

// ── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <AppProvider>
      <Router />
    </AppProvider>
  )
}
