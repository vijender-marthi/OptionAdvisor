import { useEffect } from 'react'
import { AppProvider, useApp } from './contexts/AppContext'
import AppLayout from './layouts/AppLayout'
import LoginPage from './pages/LoginPage'
import TickerPage from './pages/TickerPage'
import WatchlistPage from './pages/WatchlistPage'
import PortfolioPage from './pages/PortfolioPage'
import HelpPage from './pages/HelpPage'
import AIStocksPage from './pages/AIStocksPage'
import TradeSignalsPage from './pages/TradeSignalsPage'

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
      {page === 'ticker'     && <TickerPage />}
      {page === 'watchlist'  && <WatchlistPage />}
      {page === 'portfolio'  && <PortfolioPage />}
      {page === 'help'       && <HelpPage />}
      {page === 'ai-stocks'     && <AIStocksPage />}
      {page === 'trade-signals' && <TradeSignalsPage />}
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
