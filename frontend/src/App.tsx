import { lazy, Suspense, useEffect } from 'react'
import { AppProvider, useApp } from './contexts/AppContext'
import AppLayout from './layouts/AppLayout'
import LoginPage from './pages/LoginPage'
import { canAccessPage } from './permissions'

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
const AutoTradePage = lazy(() => import('./pages/AutoTradePage'))

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

  useEffect(() => {
    if (!user) return
    if (!canAccessPage(user.role, page)) navigate('ticker')
  }, [user, page, navigate])

  if (!user || page === 'login') return <LoginPage />

  const renderPage = canAccessPage(user.role, page) ? page : 'ticker'

  return (
    <AppLayout>
      <Suspense fallback={<RouteFallback />}>
        {renderPage === 'ticker'        && <TickerPage />}
        {renderPage === 'watchlist'     && <WatchlistPage />}
        {renderPage === 'portfolio'     && <PortfolioPage />}
        {renderPage === 'help'          && <HelpPage />}
        {renderPage === 'ai-stocks'     && <AIStocksPage />}
        {renderPage === 'q-radar'       && <QRadarPage />}
        {renderPage === 'backtest'      && <BacktestPage />}
        {renderPage === 'trade-signals' && <TradeSignalsPage />}
        {renderPage === 'alerts'        && <AlertsPage />}
        {renderPage === 'settings'      && <SettingsPage />}
        {renderPage === 'journal'       && <JournalPage />}
        {renderPage === 'auto-trade'    && <AutoTradePage />}
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
