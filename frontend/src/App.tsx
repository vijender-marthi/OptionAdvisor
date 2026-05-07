import { lazy, Suspense, useEffect } from 'react'
import { GoogleOAuthProvider } from '@react-oauth/google'
import { AppProvider, useApp } from './contexts/AppContext'
import AppLayout from './layouts/AppLayout'
import LoginPage from './pages/LoginPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import ActivatePage from './pages/ActivatePage'
import { canAccessPage } from './permissions'

const googleClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '').trim()

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
const DayTradeAlertsPage = lazy(() => import('./pages/DayTradeAlertsPage'))
const DayTradePage = lazy(() => import('./pages/DayTradePage'))
const DayTradeWatchlistPage = lazy(() => import('./pages/DayTradeWatchlistPage'))
const ActiveTradesPage = lazy(() => import('./pages/ActiveTradesPage'))
const SwingTradePage = lazy(() => import('./pages/SwingTradePage'))
const SwingTradeWatchlistPage = lazy(() => import('./pages/SwingTradeWatchlistPage'))

const GATEWAY_PAGES = new Set([
  'login',
  'forgot-password',
  'reset-password',
  'activate',
])

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

function Router() {
  const { page, user, navigate } = useApp()

  useEffect(() => {
    if (!user && !GATEWAY_PAGES.has(page)) navigate('login')
  }, [user, page, navigate])

  useEffect(() => {
    if (user && (page === 'login' || page === 'forgot-password' || page === 'reset-password')) {
      navigate('ticker')
    }
  }, [user, page, navigate])

  useEffect(() => {
    if (!user) return
    if (!canAccessPage(user.role, page)) navigate('ticker')
  }, [user, page, navigate])

  if (page === 'activate') return <ActivatePage />

  if (!user) {
    if (page === 'forgot-password') return <ForgotPasswordPage />
    if (page === 'reset-password') return <ResetPasswordPage />
    return <LoginPage />
  }

  if (page === 'login' || page === 'forgot-password' || page === 'reset-password') {
    return <RouteFallback />
  }

  const renderPage = canAccessPage(user.role, page) ? page : 'ticker'

  return (
    <AppLayout>
      <Suspense fallback={<RouteFallback />}>
        {renderPage === 'ticker' && <TickerPage />}
        {renderPage === 'watchlist' && <WatchlistPage />}
        {renderPage === 'portfolio' && <PortfolioPage />}
        {renderPage === 'help' && <HelpPage />}
        {renderPage === 'ai-stocks' && <AIStocksPage />}
        {renderPage === 'q-radar' && <QRadarPage />}
        {renderPage === 'backtest' && <BacktestPage />}
        {renderPage === 'trade-signals' && <TradeSignalsPage />}
        {renderPage === 'alerts' && <AlertsPage />}
        {renderPage === 'settings' && <SettingsPage />}
        {renderPage === 'journal' && <JournalPage />}
        {renderPage === 'auto-trade' && <AutoTradePage />}
        {renderPage === 'day-trade' && <DayTradePage />}
        {renderPage === 'day-trade-watchlist' && <DayTradeWatchlistPage />}
        {renderPage === 'day-trade-alerts' && <DayTradeAlertsPage />}
        {renderPage === 'active-trades' && <ActiveTradesPage />}
        {renderPage === 'swing-trade' && <SwingTradePage />}
        {renderPage === 'swing-trade-watchlist' && <SwingTradeWatchlistPage />}
      </Suspense>
    </AppLayout>
  )
}

export default function App() {
  const inner = (
    <AppProvider>
      <Router />
    </AppProvider>
  )
  if (!googleClientId) return inner
  return <GoogleOAuthProvider clientId={googleClientId}>{inner}</GoogleOAuthProvider>
}
