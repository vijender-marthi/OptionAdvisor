import { lazy, Suspense, useLayoutEffect, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Outlet, useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { GoogleOAuthProvider } from '@react-oauth/google'
import { AppProvider, useApp } from './contexts/AppContext'
import AppLayout from './layouts/AppLayout'
import ErrorBoundary from './components/ErrorBoundary'
import LoginPage from './pages/LoginPage'
import LandingPage from './pages/LandingPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import ActivatePage from './pages/ActivatePage'
import { locationToPage } from './routing/paths'

const googleClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '').trim()

const TradeDeskPage = lazy(() => import('./pages/TradeDeskPage'))
const AlertCenterPage = lazy(() => import('./pages/AlertCenter'))
const TickerPage = lazy(() => import('./pages/TickerPage'))
const TradeCommandCenterPage = lazy(() => import('./pages/TradeCommandCenter'))
const PositionsCenterPage = lazy(() => import('./pages/PositionsCenter'))

const AIStocksPage = lazy(() => import('./pages/AIStocksPage'))
const QRadarPage = lazy(() => import('./pages/QRadarPage'))
const BacktestPage = lazy(() => import('./pages/BacktestPage'))
const TradeSignalsPage = lazy(() => import('./pages/TradeSignalsPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const JournalPage = lazy(() => import('./pages/JournalPage'))
const AutoTradePage = lazy(() => import('./pages/AutoTradePage'))
const DayTradeAlertsPage = lazy(() => import('./pages/DayTradeAlertsPage'))
const DayTradePage = lazy(() => import('./pages/DayTradePage'))
const SwingTradePage = lazy(() => import('./pages/SwingTradePage'))
const UnifiedWatchlistPage = lazy(() => import('./pages/UnifiedWatchlistPage'))
const SignalFeedPage = lazy(() => import('./pages/SignalFeedPage'))
const MyTickersPage = lazy(() => import('./pages/MyTickersPage'))
const ActiveTradesPage = lazy(() => import('./pages/ActiveTradesPage'))
const DayTradeDashboardPage = lazy(() => import('./pages/DayTradeDashboardPage'))
const TickerScannerPage      = lazy(() => import('./pages/TickerScannerPage'))
const ToolsPage              = lazy(() => import('./pages/ToolsPage'))
const DayTradeSessionPage    = lazy(() => import('./pages/DayTradeSessionPage'))
const OptionChainPage        = lazy(() => import('./pages/OptionChainPage'))
const EODJournalPage         = lazy(() => import('./pages/EODJournalPage'))
const JournalToolPage        = lazy(() => import('./pages/JournalToolPage'))
const TrackModePage          = lazy(() => import('./pages/TrackModePage'))

function PositionsRoute() {
  const [params] = useSearchParams()
  const tab = params.get('tab')?.trim() ?? 'open'
  if (tab === 'watchlist') {
    return <Navigate to="/signal-feed" replace />
  }
  return (
    <Suspense fallback={<RouteFallback />}>
      <PositionsCenterPage />
    </Suspense>
  )
}

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

/** Apply saved accent theme on every page load */
function ThemeInitializer() {
  useEffect(() => {
    const saved = (() => { try { return localStorage?.getItem('oa_accent') } catch { return null } })()
    if (saved) document.documentElement.classList.add(`accent-${saved}`)
  }, [])
  return null
}

/** Migrates legacy `#watchlist`-style URLs to BrowserRouter paths (301-equivalent client redirect). */
function LegacyHashRedirect() {
  const navigate = useNavigate()
  useLayoutEffect(() => {
    const raw = window.location.hash.replace(/^#/, '').trim()
    if (!raw) return
    const qi = raw.indexOf('?')
    const seg = qi >= 0 ? raw.slice(0, qi) : raw
    const qs = qi >= 0 ? raw.slice(qi) : ''
    const redirects: Record<string, string> = {
      watchlist: '/signal-feed',
      portfolio: '/positions?tab=open',
      ticker: '/position-trading',
      dashboard: '/trade-command-center',
      alerts: '/alerts',
      discovery: '/strategy-finder',
      scanner: '/strategy-finder',
    }
    const target = redirects[seg] ?? `/${seg}${qs}`
    navigate(target, { replace: true })
  }, [navigate])
  return null
}

function LoginRoute() {
  const { user } = useApp()
  if (user) return <Navigate to="/trade-command-center" replace />
  return <LoginPage />
}

function RequireAuth() {
  const { user } = useApp()
  if (!user) return <Navigate to="/login" replace />
  return <Outlet />
}

function RoleGuard() {
  const { user, canAccessPage } = useApp()
  const { pathname } = useLocation()
  const page = locationToPage(pathname)
  if (!user) return <Outlet />
  if (!canAccessPage(page)) return <Navigate to="/trade-command-center" replace />
  return <Outlet />
}

function SuspensedOutlet() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<RouteFallback />}>
        <Outlet />
      </Suspense>
    </ErrorBoundary>
  )
}

function ShellRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/activate" element={<ActivatePage />} />

      <Route path="/" element={<LandingPage />} />
      <Route path="/landing" element={<LandingPage />} />

      <Route path="/day-trade-watchlist" element={<Navigate to="/signal-feed?source=day" replace />} />
      <Route path="/swing-trade-watchlist" element={<Navigate to="/signal-feed?source=swing" replace />} />
      <Route path="/watchlistx" element={<Navigate to="/signal-feed" replace />} />
      <Route path="/portfolio" element={<Navigate to="/positions?tab=open" replace />} />
      <Route path="/dashboard" element={<Navigate to="/trade-command-center" replace />} />
      <Route path="/discovery" element={<Navigate to="/position-trading" replace />} />
      <Route path="/scanner" element={<Navigate to="/position-trading" replace />} />
      <Route path="/ticker" element={<Navigate to="/position-trading" replace />} />
      <Route path="/strategy-finder" element={<Navigate to="/position-trading" replace />} />
      <Route path="/trading-glossary" element={<Navigate to="/help" replace />} />

      <Route element={<RequireAuth />}>
        <Route element={<RoleGuard />}>
          <Route element={<AppLayout />}>
            <Route element={<SuspensedOutlet />}>
              <Route path="/trade-command-center" element={<TradeCommandCenterPage />} />
              <Route path="/desk" element={<TradeDeskPage />} />
              <Route path="/ai-coach" element={<TradeCommandCenterPage />} />
              <Route path="/position-trading" element={<TickerPage />} />
              <Route path="/positions" element={<PositionsRoute />} />
              <Route path="/alerts" element={<AlertCenterPage />} />
              {/* /help is now a modal — redirect to landing */}
              <Route path="/help" element={<Navigate to="/trade-command-center" replace />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/ai-stocks" element={<AIStocksPage />} />
              <Route path="/q-radar" element={<QRadarPage />} />
              <Route path="/backtest" element={<BacktestPage />} />
              <Route path="/trade-signals" element={<TradeSignalsPage />} />
              <Route path="/journal" element={<JournalPage />} />
              <Route path="/auto-trade" element={<AutoTradePage />} />
              <Route path="/signal-feed" element={<SignalFeedPage />} />
              <Route path="/watchlist" element={<UnifiedWatchlistPage />} />
              <Route path="/day-trade" element={<DayTradePage />} />
              <Route path="/day-trade-alerts" element={<DayTradeAlertsPage />} />
              <Route path="/active-trades" element={<Suspense fallback={<RouteFallback />}><ActiveTradesPage /></Suspense>} />
              <Route path="/swing-trade" element={<SwingTradePage />} />
              <Route path="/my-tickers" element={<MyTickersPage />} />
              <Route path="/day-trade-dashboard" element={<DayTradeDashboardPage />} />
              <Route path="/ticker-scanner" element={<TickerScannerPage />} />
              <Route path="/tools" element={<ToolsPage />} />
              <Route path="/day-trade-session" element={<DayTradeSessionPage />} />
              <Route path="/option-chain" element={<OptionChainPage />} />
              <Route path="/eod-journal" element={<EODJournalPage />} />
              <Route path="/journal-tool" element={<JournalToolPage />} />
              <Route path="/track-mode" element={<TrackModePage />} />
            </Route>
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/trade-command-center" replace />} />
    </Routes>
  )
}

const PAGE_ICONS: Record<string, string> = {
  'trade-command-center': '🏠',
  'watchlist': '📡',
  'my-tickers': '📋',
  'alert-center': '🔔',
  'positions': '💼',
  'ticker': '🎯',
  'trade-signals': '📊',
  'day-trade': '⚡',
  'swing-trade': '📈',
  'day-trade-alerts': '🔔',
  'active-trades': '⚡',
  'ai-stocks': '🤖',
  'q-radar': '🔍',
  'journal': '📓',
  'backtest': '🧪',
  'settings': '⚙️',
  'help': '❓',
}

function DynamicFavicon() {
  const loc = useLocation()
  const page = locationToPage(loc.pathname)
  const icon = PAGE_ICONS[page] || '📊'
  useEffect(() => {
    try {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><text y="28" font-size="28">${icon}</text></svg>`
      const blob = new Blob([svg], { type: 'image/svg+xml' })
      const url = URL.createObjectURL(blob)
      let link = document.querySelector<HTMLLinkElement>("link[rel*='icon']")
      if (!link) {
        link = document.createElement('link')
        link.rel = 'icon'
        document.head.appendChild(link)
      }
      link.href = url
      return () => { try { URL.revokeObjectURL(url) } catch { /* ignore */ } }
    } catch { return }
  }, [icon])
  return null
}

function AppBody() {
  return (
    <>
      <ThemeInitializer />
      <DynamicFavicon />
      <LegacyHashRedirect />
      <ShellRoutes />
    </>
  )
}

export default function App() {
  const inner = (
    <BrowserRouter>
      <AppProvider>
        <AppBody />
      </AppProvider>
    </BrowserRouter>
  )
  if (!googleClientId) return inner
  return <GoogleOAuthProvider clientId={googleClientId}>{inner}</GoogleOAuthProvider>
}
