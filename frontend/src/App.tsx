import { useEffect } from 'react'
import { AppProvider, useApp } from './contexts/AppContext'
import AppLayout from './layouts/AppLayout'
import LoginPage from './pages/LoginPage'
import TickerPage from './pages/TickerPage'
import WatchlistPage from './pages/WatchlistPage'
import PortfolioPage from './pages/PortfolioPage'
import HelpPage from './pages/HelpPage'
import AIStocksPage from './pages/AIStocksPage'
import QRadarPage from './pages/QRadarPage'
import TradeSignalsPage from './pages/TradeSignalsPage'
import AlertsPage from './pages/AlertsPage'
import SettingsPage from './pages/SettingsPage'

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
      {page === 'ticker'        && <TickerPage />}
      {page === 'watchlist'     && <WatchlistPage />}
      {page === 'portfolio'     && <PortfolioPage />}
      {page === 'help'          && <HelpPage />}
      {page === 'ai-stocks'     && <AIStocksPage />}
      {page === 'q-radar'       && <QRadarPage />}
      {page === 'trade-signals' && <TradeSignalsPage />}
      {page === 'alerts'        && <AlertsPage />}
      {page === 'settings'      && <SettingsPage />}
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
