import { createContext, useContext, useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react'
import type { ReactNode } from 'react'
import axios from 'axios'
import type { AlertEntry, Page, User, WatchlistItem, PortfolioPosition, Recommendation, TickerCacheEntry, AnalyzeResponse, StrategyMode, ClosePositionPayload } from '../types'
import {
  INITIAL_DAY_TRADE_ENGINE_PAGE,
  INITIAL_DAY_TRADE_WATCHLIST_PAGE,
  type DayTradeEnginePageState,
  type DayTradeWatchlistPageState,
} from '../types/dayTradeUi'
import {
  INITIAL_SWING_TRADE_WATCHLIST_PAGE,
  type SwingTradeWatchlistPageState,
} from '../types/swingTradeUi'
import { isCacheFresh, CACHE_TTL_MS } from '../types'
import {
  analyzeOptions,
  authGoogle,
  authLogin,
  authRegister,
  clearBackendAlerts,
  dismissBackendAlert,
  getAccessToken,
  getAlerts,
  getJournal,
  getUserData,
  saveUserData,
  scanBackendAlerts,
  setAccessToken,
  type AuthLoginResponse,
} from '../api/client'
import { buildChecklist, deriveVerdict } from '../components/PreTradeChecklist'
import { canAccessPage as roleCanAccessPage, normalizeUserRole } from '../permissions'
import {
  isPortfolioExpiryAnalysisFresh,
  normalizePortfolioExpiryIso,
} from '../utils/portfolioAnalysis'
import { OA_DAY_TRADE_WATCHLIST_KEY, OA_LAST_OPTION_ANALYSIS_KEY } from '../constants/storageKeys'
import { ADVISORY_TERMS_VERSION } from '../constants/advisoryDisclaimer'
import { MULTI_WEEK_TARGETS, type WeeksOut } from '../data/stockUniverse'

function isWeeksOut(n: number): n is WeeksOut {
  return (MULTI_WEEK_TARGETS as readonly number[]).includes(n)
}

function migrateStoredUser(raw: User | null): User | null {
  if (!raw?.email) return raw
  return { ...raw, role: normalizeUserRole(raw.role as string | undefined) }
}

function extractAxiosDetail(err: unknown): string | undefined {
  if (!axios.isAxiosError(err)) return undefined
  const d = err.response?.data?.detail as unknown
  if (typeof d === 'string') return d
  if (Array.isArray(d))
    return d
      .map((x: unknown) =>
        typeof x === 'object' && x !== null && 'msg' in x
          ? String((x as { msg: unknown }).msg)
          : String(x),
      )
      .join(' ')
  return undefined
}

// ─── Router ────────────────────────────────────────────────────────────────────
function getHashPage(): Page {
  const raw = window.location.hash.replace(/^#/, '')
  const pathPart = raw.split('?')[0].trim()
  const h = pathPart
  if (h === 'watchlist') return 'watchlist'
  if (h === 'portfolio') return 'portfolio'
  if (h === 'help') return 'help'
  if (h === 'login') return 'login'
  if (h === 'ai-stocks') return 'ai-stocks'
  if (h === 'q-radar') return 'q-radar'
  if (h === 'backtest') return 'backtest'
  if (h === 'trade-signals') return 'trade-signals'
  if (h === 'alerts') return 'alerts'
  if (h === 'settings') return 'settings'
  if (h === 'journal') return 'journal'
  if (h === 'auto-trade') return 'auto-trade'
  if (h === 'day-trade') return 'day-trade'
  if (h === 'day-trade-watchlist') return 'day-trade-watchlist'
  if (h === 'day-trade-alerts') return 'day-trade-alerts'
  if (h === 'active-trades') return 'active-trades'
  if (h === 'swing-trade') return 'swing-trade'
  if (h === 'swing-trade-watchlist') return 'swing-trade-watchlist'
  if (h === 'forgot-password') return 'forgot-password'
  if (h === 'reset-password') return 'reset-password'
  if (h === 'activate') return 'activate'
  return 'ticker'
}

// ─── Alert time-window helper ───────────────────────────────────────────────────
// Returns a PST "HH:MM AM – HH:MM AM PST" label for a 15-min bucket
function get15MinWindow(ts: number): string {
  const pacific = getPacificDateParts(ts)
  if (!pacific) return new Date(ts).toLocaleTimeString()

  const bucketStart = Math.floor(pacific.minute / 15) * 15
  const bucketEnd = bucketStart + 15
  const fmtTime = (hh: number, mm: number) => {
    const ampm = hh >= 12 ? 'PM' : 'AM'
    const h12 = hh % 12 || 12
    return `${h12}:${String(mm).padStart(2, '0')} ${ampm}`
  }
  const endH = bucketEnd === 60 ? pacific.hour + 1 : pacific.hour
  const endM = bucketEnd === 60 ? 0 : bucketEnd
  return `${fmtTime(pacific.hour, bucketStart)} – ${fmtTime(endH, endM)} PT`
}

// ─── Market hours helper ────────────────────────────────────────────────────────
// Returns true if "now" is a weekday between 6:00 AM and 4:00 PM America/Los_Angeles
function isMarketHoursNow(): boolean {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(new Date())
    const value = (type: string) => parts.find(part => part.type === type)?.value ?? ''
    const weekday = value('weekday')
    if (weekday === 'Sat' || weekday === 'Sun') return false
    const hour = Number(value('hour'))
    const minute = Number(value('minute'))
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false
    const mins = hour * 60 + minute
    return mins >= 6 * 60 && mins < 16 * 60  // 6:00 AM – 4:00 PM Pacific
  } catch {
    return false
  }
}

function getPacificDateParts(ts: number): { hour: number; minute: number } | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(new Date(ts))
    const hour = Number(parts.find(part => part.type === 'hour')?.value)
    const minute = Number(parts.find(part => part.type === 'minute')?.value)
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
    return { hour, minute }
  } catch {
    return null
  }
}

// ─── Context shape ──────────────────────────────────────────────────────────────
interface AppContextValue {
  // Router
  page: Page
  navigate: (p: Page) => void
  /** Go to Strategy Finder with empty form (no restore of last analysis). */
  navigateToTickerAdvisorFresh: () => void

  // Cross-page ticker handoff
  pendingTicker: string | null
  pendingAnalysisOptions: PendingAnalysisOptions | null
  requestAnalysis: (ticker: string, options?: PendingAnalysisOptions) => void
  clearPendingTicker: () => void

  // Auth
  user: User | null
  loginWithPassword: (email: string, password: string) => Promise<void>
  registerWithPassword: (name: string, email: string, password: string) => Promise<{ needs_activation: boolean; message: string }>
  loginWithGoogleCredential: (credential: string) => Promise<void>
  logout: () => void
  /** Feature gating: finance omits discovery radars; day trading + auto-trade are admin-only; admin/user see the rest. */
  canAccessPage: (p: Page) => boolean

  /** Server-backed watchlist/portfolio finished loading for the signed-in user. */
  userDataLoaded: boolean
  /** ISO timestamp when user accepted the advisory disclaimer in the DB, if any. */
  advisoryAcceptedAt: string | null
  advisoryTermsVersion: string | null
  /** Blocking modal until user accepts current ADVISORY_TERMS_VERSION. */
  needsAdvisoryAcknowledgement: boolean
  acknowledgeAdvisoryDisclaimer: () => Promise<void>

  // Watchlist
  watchlist: WatchlistItem[]
  /** Max symbols allowed on the watchlist for this session (from server; defaults to 15 until loaded). */
  watchlistMax: number
  addToWatchlist: (item: Omit<WatchlistItem, 'addedAt'>) => boolean
  removeFromWatchlist: (ticker: string) => void
  isWatched: (ticker: string) => boolean
  watchlistNotice: string | null
  clearWatchlistNotice: () => void

  /** Persisted symbols for backend day-trade WATCH→GO alerts (admin-only; max 10). */
  dayTradeWatchlist: string[]
  setDayTradeWatchlist: React.Dispatch<React.SetStateAction<string[]>>

  /** Persisted swing-trade watchlist (admin-only; max 10). */
  swingTradeWatchlist: string[]
  setSwingTradeWatchlist: React.Dispatch<React.SetStateAction<string[]>>

  /**
   * In-memory snapshot of Day Trade Engine page fields so navigation away does not wipe results.
   * Cleared only on full reload or sign-out / account switch.
   */
  dayTradeEngineUI: DayTradeEnginePageState
  setDayTradeEngineUI: React.Dispatch<React.SetStateAction<DayTradeEnginePageState>>

  /** Same as engine: watchlist scans + expanded panels survive route changes until refresh or logout. */
  dayTradeWatchlistUI: DayTradeWatchlistPageState
  setDayTradeWatchlistUI: React.Dispatch<React.SetStateAction<DayTradeWatchlistPageState>>

  /** Swing watchlist scans + expanded rows survive route changes until explicit refresh/logout/account switch. */
  swingTradeWatchlistUI: SwingTradeWatchlistPageState
  setSwingTradeWatchlistUI: React.Dispatch<React.SetStateAction<SwingTradeWatchlistPageState>>

  // Portfolio
  portfolio: PortfolioPosition[]
  addToPortfolio: (rec: Recommendation, ticker: string, companyName: string, entryPrice: number, contracts: number) => void
  addManualPosition: (pos: Omit<PortfolioPosition, 'id' | 'addedAt' | 'status'>) => void
  /** Replace editable fields while preserving id, addedAt, status, and close metadata (pnlPct, exitDate). */
  updatePortfolioPosition: (id: string, pos: Omit<PortfolioPosition, 'id' | 'addedAt' | 'status'>) => void
  removeFromPortfolio: (id: string) => void
  closePosition: (id: string, payload: ClosePositionPayload) => void
  isInPortfolio: (ticker: string, strategy: string, expiry: string) => boolean

  // Cache
  tickerCache: Record<string, TickerCacheEntry>
  getCached: (ticker: string) => TickerCacheEntry | null
  setCached: (
    ticker: string,
    data: AnalyzeResponse,
    weeksOut: number,
    spreadWidth: number | null,
    strategyMode: StrategyMode,
    chainExpiry?: string | null,
  ) => void
  evictCache: (ticker: string) => void
  refreshingTickers: Set<string>
  refreshTicker: (ticker: string) => Promise<void>
  /** Fetch /analyze for an open position's exact expiry and merge into ticker cache (Portfolio). */
  ensureAnalysisForPortfolioExpiry: (
    ticker: string,
    positionExpiry: string,
    opts?: { force?: boolean; spreadWidth?: number | null },
  ) => Promise<void>
  lastBgRefresh: number | null   // timestamp of last background sweep
  isMarketHours: boolean         // true when within 6 AM–4 PM PST weekdays
  refreshWatchlistForAlerts: () => Promise<void>
  // Multi-week scan (MULTI_WEEK_TARGETS) — stored inside the cache entry's multiWeekData
  fetchAllWeeks: (ticker: string) => Promise<void>
  fetchSingleWeek: (ticker: string, weeksOut: number) => Promise<void>
  fetchingAllWeeks: Set<string>
  fetchingWeeks: Map<string, Set<number>>   // ticker → set of weeks currently loading

  // Alerts
  alerts: AlertEntry[]
  unreadAlertCount: number
  dismissAlert: (id: string) => void
  clearAlerts: () => void

  // Theme
  theme: 'dark' | 'light'
  toggleTheme: () => void

  // Settings
  alertEmailEnabled: boolean
  setAlertEmailEnabled: (enabled: boolean) => void
  /** Trading account size in USD — used to compute Kelly-recommended contracts. */
  accountSize: number
  setAccountSize: (n: number) => void

  /** Total saved journal entries (server); refreshes after save/delete and on login. */
  journalEntryCount: number
  refreshJournalCount: () => Promise<void>
  /** Set badge count from a known list length (e.g. after Journal page fetch) without re-querying. */
  syncJournalEntryCount: (n: number) => void
}

const AppContext = createContext<AppContextValue | null>(null)
const ALERT_RETENTION_MS = 24 * 60 * 60 * 1000

interface PendingAnalysisOptions {
  weeksOut?: number
  spreadWidth?: number | null
  strategyMode?: StrategyMode
  /** Lock analyze to this chain expiry (YYYY-MM-DD), e.g. when opening from Alerts. */
  chainExpiry?: string | null
  force?: boolean
  /** After load, scroll to / expand this recommendation (Strategy Finder). */
  focusStrategy?: string | null
  focusExpiry?: string | null
}

// ─── Persistence helpers ────────────────────────────────────────────────────────
function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch { return fallback }
}
function save<T>(key: string, val: T) {
  try { localStorage.setItem(key, JSON.stringify(val)) } catch {}
}

function activeAlertsOnly(alerts: AlertEntry[], now = Date.now()): AlertEntry[] {
  return alerts.filter(alert => now - alert.detectedAt < ALERT_RETENTION_MS)
}

/** Legacy browser-only list — migrated to SQLite on first load when server list is empty. */
function loadStoredDayTradeTickers(max = 10): string[] {
  try {
    const raw = localStorage.getItem(OA_DAY_TRADE_WATCHLIST_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return []
    const out: string[] = []
    const seen = new Set<string>()
    for (const x of arr) {
      if (typeof x !== 'string') continue
      const t = x.toUpperCase().trim()
      if (!t || t.length > 12 || seen.has(t)) continue
      seen.add(t)
      out.push(t)
      if (out.length >= max) break
    }
    return out
  } catch {
    return []
  }
}

/** Whole contracts for portfolio P&L math (must match PortfolioPage). */
function portfolioContractCount(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 1
  return Math.max(1, Math.round(n))
}

function newPortfolioLotId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `pf_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
  }
}

function getInitialTheme(): 'dark' | 'light' {
  const saved = load<'dark' | 'light' | null>('oa_theme', null)
  if (saved === 'dark' || saved === 'light') return saved
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

// ─── Provider ──────────────────────────────────────────────────────────────────
export function AppProvider({ children }: { children: ReactNode }) {
  const [page, setPage]             = useState<Page>(getHashPage)
  const [user, setUser]             = useState<User | null>(() => migrateStoredUser(load<User | null>('oa_user', null)))
  const [watchlist, setWatchlist]   = useState<WatchlistItem[]>([])
  const [watchlistMax, setWatchlistMax] = useState(15)
  const [watchlistNotice, setWatchlistNotice] = useState<string | null>(null)
  const [dayTradeWatchlist, setDayTradeWatchlist] = useState<string[]>([])
  const [swingTradeWatchlist, setSwingTradeWatchlist] = useState<string[]>([])
  const [dayTradeEngineUI, setDayTradeEngineUI] = useState<DayTradeEnginePageState>(() => ({
    ...INITIAL_DAY_TRADE_ENGINE_PAGE,
  }))
  const [dayTradeWatchlistUI, setDayTradeWatchlistUI] = useState<DayTradeWatchlistPageState>(() => ({
    ...INITIAL_DAY_TRADE_WATCHLIST_PAGE,
  }))
  const [swingTradeWatchlistUI, setSwingTradeWatchlistUI] = useState<SwingTradeWatchlistPageState>(() => ({
    ...INITIAL_SWING_TRADE_WATCHLIST_PAGE,
  }))
  const [portfolio, setPortfolio]   = useState<PortfolioPosition[]>([])
  const [pendingTicker, setPendingTicker] = useState<string | null>(null)
  const [pendingAnalysisOptions, setPendingAnalysisOptions] = useState<PendingAnalysisOptions | null>(null)
  const [tickerCache, setTickerCache]     = useState<Record<string, TickerCacheEntry>>(
    () => load('oa_cache', {})
  )
  const [refreshingTickers, setRefreshingTickers]   = useState<Set<string>>(new Set())
  const [fetchingAllWeeks, setFetchingAllWeeks]     = useState<Set<string>>(new Set())
  const [fetchingWeeks, setFetchingWeeks]           = useState<Map<string, Set<number>>>(new Map())
  const [lastBgRefresh, setLastBgRefresh]           = useState<number | null>(null)
  const [isMarketHours, setIsMarketHours]           = useState<boolean>(isMarketHoursNow)
  const [alerts, setAlerts]                         = useState<AlertEntry[]>(() => activeAlertsOnly(load<AlertEntry[]>('oa_alerts', [])))
  // Dedup: once an alert fires for (ticker-strategy-expiry), never fire again this session
  const sentAlertKeysRef = useRef<Set<string>>(new Set(load<string[]>('oa_sent_alert_keys', [])))
  const [theme, setTheme] = useState<'dark' | 'light'>(getInitialTheme)
  const [alertEmailEnabled, setAlertEmailEnabledState] = useState<boolean>(() => load<boolean>('oa_alert_email_enabled', true))
  const [accountSize, setAccountSizeState] = useState<number>(() => load<number>('oa_account_size', 25000))
  const [userDataLoaded, setUserDataLoaded] = useState(false)
  const [advisoryAcceptedAt, setAdvisoryAcceptedAt] = useState<string | null>(null)
  const [advisoryTermsVersion, setAdvisoryTermsVersion] = useState<string | null>(null)
  const [journalEntryCount, setJournalEntryCount] = useState(0)
  const loginRefreshEmailRef = useRef<string | null>(null)
  const finderDeepLinkHandledRef = useRef(false)
  /** Previous signed-in email; used to detect account switch vs first login (day-trade UI resets on switch/sign-out). */
  const dayTradeSessionEmailRef = useRef<string | null>(null)

  useEffect(() => {
    const curr = user?.email?.trim().toLowerCase() ?? null
    const prev = dayTradeSessionEmailRef.current
    if (prev !== null && curr !== prev) {
      setDayTradeEngineUI({ ...INITIAL_DAY_TRADE_ENGINE_PAGE })
      setDayTradeWatchlistUI({ ...INITIAL_DAY_TRADE_WATCHLIST_PAGE })
      setSwingTradeWatchlistUI({ ...INITIAL_SWING_TRADE_WATCHLIST_PAGE })
    }
    dayTradeSessionEmailRef.current = curr
  }, [user?.email])

  /** Drop stale client-only sessions now that APIs require a Bearer token. */
  useEffect(() => {
    const tok = getAccessToken()
    const raw = load<User | null>('oa_user', null)
    if (raw?.email && !tok) {
      setUser(null)
      save('oa_user', null)
    }
  }, [])

  // Keep refs so interval/async closures always see current values
  const watchlistRef = useRef(watchlist)
  useEffect(() => { watchlistRef.current = watchlist }, [watchlist])
  const watchlistMaxRef = useRef(watchlistMax)
  useEffect(() => { watchlistMaxRef.current = watchlistMax }, [watchlistMax])
  const portfolioRef = useRef(portfolio)
  useEffect(() => { portfolioRef.current = portfolio }, [portfolio])
  const dayTradeWatchlistRef = useRef(dayTradeWatchlist)
  useEffect(() => { dayTradeWatchlistRef.current = dayTradeWatchlist }, [dayTradeWatchlist])
  const swingTradeWatchlistRef = useRef(swingTradeWatchlist)
  useEffect(() => { swingTradeWatchlistRef.current = swingTradeWatchlist }, [swingTradeWatchlist])
  const userRef = useRef(user)
  useEffect(() => { userRef.current = user }, [user])
  const tickerCacheRef = useRef(tickerCache)
  useEffect(() => { tickerCacheRef.current = tickerCache }, [tickerCache])
  const portfolioExpiryFetchRef = useRef<Set<string>>(new Set())
  const portfolioFetchFailuresRef = useRef<Map<string, number>>(new Map())

  // Sync hash (preserve ?token= on activate / reset-password; ?ticker= on day-trade email links)
  useEffect(() => {
    if (page === 'ticker') {
      window.location.hash = ''
      return
    }
    if (page === 'day-trade') {
      const raw = window.location.hash.replace(/^#/, '')
      const qi = raw.indexOf('?')
      const pathPart = qi >= 0 ? raw.slice(0, qi) : raw
      const qs = qi >= 0 ? raw.slice(qi) : ''
      if (pathPart === 'day-trade' && qs) {
        window.location.hash = `day-trade${qs}`
        return
      }
      window.location.hash = 'day-trade'
      return
    }
    const seg = window.location.hash.replace(/^#/, '').split('?')[0]
    if ((page === 'activate' || page === 'reset-password') && seg === page) {
      return
    }
    window.location.hash = page
  }, [page])

  // Browser back/forward
  useEffect(() => {
    const handler = () => setPage(getHashPage())
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])

  // Persist
  useEffect(() => { save('oa_user', user) }, [user])
  useEffect(() => { save('oa_cache', tickerCache) }, [tickerCache])
  useEffect(() => { save('oa_alerts', activeAlertsOnly(alerts)) }, [alerts])
  useEffect(() => {
    save('oa_theme', theme)
    const html = document.documentElement
    if (theme === 'light') {
      html.classList.add('light')
      html.classList.remove('dark')
    } else {
      html.classList.remove('light')
      html.classList.add('dark')
    }
  }, [theme])

  // Load watchlist and portfolio from SQLite for the signed-in email.
  useEffect(() => {
    let cancelled = false

    const loadUserData = async () => {
      if (!user?.email) {
        setWatchlist([])
        setPortfolio([])
        setWatchlistMax(15)
        setWatchlistNotice(null)
        setDayTradeWatchlist([])
        setSwingTradeWatchlist([])
        setUserDataLoaded(false)
        setAdvisoryAcceptedAt(null)
        setAdvisoryTermsVersion(null)
        return
      }

      setUserDataLoaded(false)
      setAdvisoryAcceptedAt(null)
      setAdvisoryTermsVersion(null)
      try {
        const data = await getUserData(user.email)
        if (cancelled) return
        setWatchlist(data.watchlist)
        setPortfolio(data.portfolio)
        let dt: string[] = Array.isArray(data.day_trade_watchlist)
          ? data.day_trade_watchlist.map(x => String(x).trim().toUpperCase()).filter(Boolean)
          : []
        if (dt.length === 0) {
          const migrated = loadStoredDayTradeTickers()
          if (migrated.length) dt = migrated
        }
        setDayTradeWatchlist(dt.slice(0, 10))
        let sw: string[] = Array.isArray(data.swing_trade_watchlist)
          ? data.swing_trade_watchlist.map(x => String(x).trim().toUpperCase()).filter(Boolean)
          : []
        setSwingTradeWatchlist(sw.slice(0, 10))
        const wm = Number(data.watchlist_max)
        setWatchlistMax(Number.isFinite(wm) && wm >= 1 ? Math.floor(wm) : 15)
        setAdvisoryAcceptedAt(data.advisory_accepted_at ?? null)
        setAdvisoryTermsVersion(data.advisory_terms_version ?? null)
        {
          const serverAlertEmail = data.alert_email_enabled !== false
          setAlertEmailEnabledState(serverAlertEmail)
          save('oa_alert_email_enabled', serverAlertEmail)
        }
        setUser(prev => {
          if (!prev) return prev
          const em = prev.email.trim().toLowerCase()
          if (em !== String(data.email).trim().toLowerCase()) return prev
          return { ...prev, role: normalizeUserRole(data.role) }
        })
        setUserDataLoaded(true)
      } catch (e) {
        console.warn('[user-data] load failed:', e)
        if (!cancelled) {
          setWatchlist([])
          setPortfolio([])
          setWatchlistMax(15)
          setDayTradeWatchlist([])
          setSwingTradeWatchlist([])
          setUserDataLoaded(false)
          setAdvisoryAcceptedAt(null)
          setAdvisoryTermsVersion(null)
        }
      }
    }

    loadUserData()
    return () => { cancelled = true }
  }, [user?.email])

  // Save per-email watchlist and portfolio changes to SQLite.
  useEffect(() => {
    if (!user?.email || !userDataLoaded) return
    const advisory =
      advisoryAcceptedAt && advisoryTermsVersion
        ? { advisoryTermsVersion, advisoryAcceptedAt }
        : undefined
    saveUserData(user.email, watchlist, portfolio, advisory, dayTradeWatchlist, swingTradeWatchlist, alertEmailEnabled).catch(e => {
      const msg = extractAxiosDetail(e)
      if (msg && /watchlist/i.test(msg)) setWatchlistNotice(msg)
      console.warn('[user-data] save failed:', e)
    })
  }, [advisoryAcceptedAt, advisoryTermsVersion, alertEmailEnabled, dayTradeWatchlist, swingTradeWatchlist, portfolio, user?.email, userDataLoaded, watchlist])

  const needsAdvisoryAcknowledgement = Boolean(
    user &&
      userDataLoaded &&
      (!advisoryAcceptedAt || advisoryTermsVersion !== ADVISORY_TERMS_VERSION),
  )

  const acknowledgeAdvisoryDisclaimer = useCallback(async () => {
    const email = userRef.current?.email
    if (!email) return
    const version = ADVISORY_TERMS_VERSION
    const acceptedAt = new Date().toISOString()
    const data = await saveUserData(email, watchlistRef.current, portfolioRef.current, {
      advisoryTermsVersion: version,
      advisoryAcceptedAt: acceptedAt,
    }, dayTradeWatchlistRef.current, swingTradeWatchlistRef.current, alertEmailEnabledRef.current)
    const wm = Number(data.watchlist_max)
    setWatchlistMax(Number.isFinite(wm) && wm >= 1 ? Math.floor(wm) : 15)
    setAdvisoryAcceptedAt(data.advisory_accepted_at ?? acceptedAt)
    setAdvisoryTermsVersion(data.advisory_terms_version ?? version)
  }, [])

  // Alerts are produced by the backend scanner, independent of browser sessions.
  useEffect(() => {
    if (!user?.email) {
      setAlerts([])
      return
    }

    let cancelled = false
    const loadBackendAlerts = async () => {
      try {
        const backendAlerts = await getAlerts(user.email)
        if (!cancelled) setAlerts(activeAlertsOnly(backendAlerts))
      } catch (e) {
        console.warn('[alerts] load failed:', e)
      }
    }

    loadBackendAlerts()
    const id = setInterval(loadBackendAlerts, 60_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [user?.email])

  // Journal entries count (for sidebar badge)
  const refreshJournalCount = useCallback(async () => {
    const email = userRef.current?.email
    if (!email) {
      setJournalEntryCount(0)
      return
    }
    try {
      const data = await getJournal(email)
      const n = Array.isArray(data.entries) ? data.entries.length : 0
      setJournalEntryCount(n)
    } catch (e) {
      console.warn('[journal] count refresh failed:', e)
    }
  }, [])

  const syncJournalEntryCount = useCallback((n: number) => {
    setJournalEntryCount(Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0)
  }, [])

  useEffect(() => {
    if (!user?.email) {
      setJournalEntryCount(0)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const data = await getJournal(user.email)
        if (cancelled) return
        const n = Array.isArray(data.entries) ? data.entries.length : 0
        setJournalEntryCount(n)
      } catch {
        if (!cancelled) setJournalEntryCount(0)
      }
    })()
    return () => { cancelled = true }
  }, [user?.email])

  // ── Router ──────────────────────────────────────────────────────────────────
  const navigate = useCallback((p: Page) => setPage(p), [])

  const clearWatchlistNotice = useCallback(() => setWatchlistNotice(null), [])

  const clearPendingTicker = useCallback(() => {
    setPendingTicker(null)
    setPendingAnalysisOptions(null)
  }, [])

  const navigateToTickerAdvisorFresh = useCallback(() => {
    try {
      localStorage.removeItem(OA_LAST_OPTION_ANALYSIS_KEY)
    } catch {
      /* ignore */
    }
    clearPendingTicker()
    setPage('ticker')
  }, [clearPendingTicker])

  const requestAnalysis = useCallback((ticker: string, options?: PendingAnalysisOptions) => {
    setPendingTicker(ticker.trim().toUpperCase())
    setPendingAnalysisOptions(options ?? null)
    setPage('ticker')
  }, [])

  useEffect(() => {
    if (!user) finderDeepLinkHandledRef.current = false
  }, [user])

  /** Email alert links: ?ticker=SYM&weeks=4&expiry=YYYY-MM-DD — consume before TickerPage localStorage restore. */
  useLayoutEffect(() => {
    if (!user || finderDeepLinkHandledRef.current) return
    const params = new URLSearchParams(window.location.search)
    const raw = params.get('ticker')
    const ticker = typeof raw === 'string' ? raw.trim().toUpperCase() : ''
    if (!ticker || ticker.length > 16 || !/^[A-Z0-9.\-]+$/.test(ticker)) return

    finderDeepLinkHandledRef.current = true

    let weeksOut = Number(params.get('weeks'))
    if (!Number.isFinite(weeksOut) || !isWeeksOut(weeksOut)) weeksOut = 4

    const expRaw = params.get('expiry')?.trim().slice(0, 10) ?? ''
    const chainExpiry = /^\d{4}-\d{2}-\d{2}$/.test(expRaw) ? expRaw : null

    const url = new URL(window.location.href)
    url.searchParams.delete('ticker')
    url.searchParams.delete('weeks')
    url.searchParams.delete('expiry')
    const q = url.searchParams.toString()
    window.history.replaceState({}, '', `${url.pathname}${q ? `?${q}` : ''}${url.hash}`)

    requestAnalysis(ticker, { weeksOut: weeksOut, chainExpiry, force: false })
  }, [user, requestAnalysis])

  // ── Auth ────────────────────────────────────────────────────────────────────
  const applyAuthSession = useCallback((session: AuthLoginResponse) => {
    const cleanEmail = session.email.trim().toLowerCase()
    const displayName = session.name.trim() || cleanEmail.split('@')[0] || 'User'
    setAccessToken(session.access_token)
    loginRefreshEmailRef.current = null
    setWatchlist([])
    setPortfolio([])
    setUserDataLoaded(false)
    setUser({
      name: displayName,
      email: cleanEmail,
      role: normalizeUserRole(session.role),
    })
  }, [])

  const loginWithPassword = useCallback(
    async (email: string, password: string) => {
      const session = await authLogin(email.trim().toLowerCase(), password)
      applyAuthSession(session)
    },
    [applyAuthSession],
  )

  const registerWithPassword = useCallback(async (name: string, email: string, password: string) => {
    const data = await authRegister({
      email: email.trim().toLowerCase(),
      password,
      name: name.trim() || undefined,
    })
    return { needs_activation: data.needs_activation, message: data.message }
  }, [])

  const loginWithGoogleCredential = useCallback(
    async (credential: string) => {
      const session = await authGoogle(credential)
      applyAuthSession(session)
    },
    [applyAuthSession],
  )

  const logout = useCallback(() => {
    loginRefreshEmailRef.current = null
    setAccessToken(null)
    setUser(null)
    setWatchlist([])
    setPortfolio([])
    setWatchlistMax(15)
    setWatchlistNotice(null)
    setDayTradeWatchlist([])
    setSwingTradeWatchlist([])
    setUserDataLoaded(false)
    setAdvisoryAcceptedAt(null)
    setAdvisoryTermsVersion(null)
    setJournalEntryCount(0)
    setPage('login')
  }, [])

  const logoutRef = useRef(logout)
  useEffect(() => {
    logoutRef.current = logout
  }, [logout])

  useEffect(() => {
    const onExpire = () => {
      logoutRef.current()
    }
    window.addEventListener('oa-auth-expired', onExpire)
    return () => window.removeEventListener('oa-auth-expired', onExpire)
  }, [])

  // ── Watchlist ───────────────────────────────────────────────────────────────
  const addToWatchlist = useCallback((item: Omit<WatchlistItem, 'addedAt'>): boolean => {
    const ticker = String(item.ticker ?? '').trim().toUpperCase()
    if (!ticker) return false
    const prev = watchlistRef.current
    if (prev.some(w => w.ticker === ticker)) return true
    const max = watchlistMaxRef.current
    if (prev.length >= max) {
      setWatchlistNotice(`Watchlist is full (${max} symbols max). Remove one to add another.`)
      return false
    }
    setWatchlistNotice(null)
    setWatchlist([...prev, { ...item, ticker, addedAt: new Date().toISOString() }])
    return true
  }, [])

  const removeFromWatchlist = useCallback((ticker: string) => {
    setWatchlist(prev => prev.filter(w => w.ticker !== ticker))
  }, [])

  const isWatched = useCallback((ticker: string) =>
    watchlist.some(w => w.ticker === ticker), [watchlist])

  // ── Portfolio ───────────────────────────────────────────────────────────────
  const addToPortfolio = useCallback((
    rec: Recommendation, ticker: string, companyName: string, entryPrice: number, contracts: number,
  ) => {
    setPortfolio(prev => {
      if (prev.some(p => p.status === 'open' && p.ticker === ticker && p.strategy === rec.strategy && p.expiry === rec.expiry))
        return prev
      const acctSize = load<number>('oa_account_size', 25000)
      return [{
        id: `${ticker}-${rec.strategy}-${rec.expiry}-${Date.now()}`,
        ticker, companyName,
        strategy: rec.strategy, bias: rec.bias, legs: rec.legs,
        expiry: rec.expiry, dte: rec.dte,
        net_credit: rec.net_credit, spread_width: rec.spread_width,
        max_profit: rec.max_profit, max_loss: rec.max_loss,
        prob_of_profit: rec.prob_of_profit, expected_value: rec.expected_value,
        scores_total: rec.scores.total_score,
        contracts,
        breakeven_lower: rec.breakeven_lower,
        breakeven_upper: rec.breakeven_upper,
        addedAt: new Date().toISOString(), entryPrice, status: 'open' as const,
        // Kelly Criterion snapshot — locked at time of entry for later review
        kelly_fraction: rec.kelly_fraction,
        half_kelly_fraction: rec.half_kelly_fraction,
        edge_ratio: rec.edge_ratio,
        capital_at_risk: Math.round(rec.max_loss * 100 * contracts),
        account_size_at_entry: acctSize,
      }, ...prev]
    })
  }, [])

  const addManualPosition = useCallback((pos: Omit<PortfolioPosition, 'id' | 'addedAt' | 'status'>) => {
    setPortfolio(prev => [{
      ...pos,
      id: `manual-${pos.ticker}-${Date.now()}`,
      addedAt: new Date().toISOString(),
      status: 'open' as const,
      source: 'manual' as const,
    }, ...prev])
  }, [])

  const updatePortfolioPosition = useCallback((id: string, data: Omit<PortfolioPosition, 'id' | 'addedAt' | 'status'>) => {
    setPortfolio(prev => prev.map(p =>
      p.id !== id
        ? p
        : {
            ...data,
            id: p.id,
            addedAt: p.addedAt,
            status: p.status,
            pnlPct: p.pnlPct,
            exitDate: p.exitDate,
          },
    ))
  }, [])

  const removeFromPortfolio = useCallback((id: string) => {
    setPortfolio(prev => prev.filter(p => p.id !== id))
  }, [])

  const closePosition = useCallback((id: string, payload: ClosePositionPayload) => {
    const now = new Date().toISOString()
    setPortfolio(prev => {
      const idx = prev.findIndex(p => p.id === id && p.status === 'open')
      if (idx < 0) return prev

      const pos = prev[idx]!
      const total = portfolioContractCount(pos.contracts)
      let nClose = Math.round(Number(payload.contractsToClose))
      if (!Number.isFinite(nClose) || nClose < 1) nClose = 1
      if (nClose > total) nClose = total

      const pnlPct = Number(payload.pnlPct)
      const safePct = Number.isFinite(pnlPct) ? pnlPct : 0

      const scaleRemaining = total > 0 ? (total - nClose) / total : 0

      if (nClose >= total) {
        return prev.map(p =>
          p.id === id ? { ...p, status: 'closed' as const, pnlPct: safePct, exitDate: now } : p,
        )
      }

      const closedNote = `Partial close: ${nClose} of ${total} contracts`
      const closedNotes = [pos.notes?.trim(), closedNote].filter(Boolean).join(' · ') || undefined

      const closedRow: PortfolioPosition = {
        ...pos,
        id: newPortfolioLotId(),
        contracts: nClose,
        status: 'closed',
        pnlPct: safePct,
        exitDate: now,
        notes: closedNotes,
        capital_at_risk:
          pos.capital_at_risk != null
            ? Math.round((pos.capital_at_risk * nClose) / total * 100) / 100
            : undefined,
      }

      const remaining: PortfolioPosition = {
        ...pos,
        contracts: total - nClose,
        capital_at_risk:
          pos.capital_at_risk != null
            ? Math.round(pos.capital_at_risk * scaleRemaining * 100) / 100
            : undefined,
      }

      return prev.flatMap((p, i) => (i === idx ? [remaining, closedRow] : [p]))
    })
  }, [])

  const isInPortfolio = useCallback((ticker: string, strategy: string, expiry: string) =>
    portfolio.some(p => p.status === 'open' && p.ticker === ticker && p.strategy === strategy && p.expiry === expiry),
    [portfolio])

  // ── Cache ───────────────────────────────────────────────────────────────────
  const getCached = useCallback((ticker: string): TickerCacheEntry | null =>
    tickerCache[ticker] ?? null, [tickerCache])

  const setCached = useCallback((
    ticker: string, data: AnalyzeResponse,
    weeksOut: number, spreadWidth: number | null, strategyMode: StrategyMode = 'all',
    chainExpiry?: string | null,
  ) => {
    setTickerCache(prev => {
      const old = prev[ticker]
      const entry: TickerCacheEntry = {
        ticker,
        data,
        timestamp: Date.now(),
        weeksOut,
        spreadWidth,
        strategyMode,
        chainExpiry: chainExpiry ?? undefined,
        portfolioByExpiry: old?.portfolioByExpiry,
        portfolioByExpiryFetchedAt: old?.portfolioByExpiryFetchedAt,
        multiWeekData: old?.multiWeekData,
        multiWeekTimestamp: old?.multiWeekTimestamp,
      }
      return { ...prev, [ticker]: entry }
    })
    // Also update lastPrice on matching watchlist item
    setWatchlist(prev => prev.map(w =>
      w.ticker === ticker
        ? { ...w, lastPrice: data.signals.current_price, companyName: data.company_name, sector: data.sector }
        : w
    ))
  }, [])

  const evictCache = useCallback((ticker: string) => {
    setTickerCache(prev => { const n = { ...prev }; delete n[ticker]; return n })
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(t => t === 'dark' ? 'light' : 'dark')
  }, [])

  const setAlertEmailEnabled = useCallback((enabled: boolean) => {
    setAlertEmailEnabledState(enabled)
    save('oa_alert_email_enabled', enabled)
  }, [])

  const setAccountSize = useCallback((n: number) => {
    const clamped = Math.max(1000, Math.round(n))
    setAccountSizeState(clamped)
    save('oa_account_size', clamped)
  }, [])

  // Keep alertEmailEnabled accessible in async closures without stale capture
  const alertEmailEnabledRef = useRef(alertEmailEnabled)
  useEffect(() => { alertEmailEnabledRef.current = alertEmailEnabled }, [alertEmailEnabled])

  // ── Alert actions ───────────────────────────────────────────────────────────
  const dismissAlert = useCallback((id: string) => {
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, dismissed: true } : a))
    const currentUser = userRef.current
    if (currentUser?.email) {
      dismissBackendAlert(currentUser.email, id).catch(e => {
        console.warn('[alerts] dismiss failed:', e)
      })
    }
  }, [])

  const clearAlerts = useCallback(() => {
    setAlerts([])
    sentAlertKeysRef.current.clear()
    save('oa_alerts', [])
    save('oa_sent_alert_keys', [])
    const currentUser = userRef.current
    if (currentUser?.email) {
      clearBackendAlerts(currentUser.email).catch(e => {
        console.warn('[alerts] clear failed:', e)
      })
    }
  }, [])

  // ── scanForGoAlerts: consumes cached AnalyzeResponse data — ZERO API calls ───
  const scanForGoAlerts = useCallback(async (
    ticker: string,
    data: AnalyzeResponse,
    companyName: string,
  ) => {
    const newAlerts: AlertEntry[] = []
    const now = Date.now()
    const timeWindow = get15MinWindow(now)

    for (const rec of data.recommendations) {
      const dedupKey = `${ticker}-${rec.strategy}-${rec.expiry}`
      if (sentAlertKeysRef.current.has(dedupKey)) continue  // already alerted

      const verdict = deriveVerdict(buildChecklist(rec, data.signals))
      if (verdict !== 'GO') continue

      sentAlertKeysRef.current.add(dedupKey)
      newAlerts.push({
        id: dedupKey,
        ticker,
        companyName,
        strategy: rec.strategy,
        bias: rec.bias,
        expiry: rec.expiry,
        dte: rec.dte,
        weeksOut: Math.round(rec.dte / 7),
        score: rec.scores.total_score,
        maxProfit: rec.max_profit,
        maxLoss: rec.max_loss,
        netCredit: rec.net_credit,
        pop: rec.prob_of_profit,
        ev: rec.expected_value,
        detectedAt: now,
        timeWindow,
        emailSent: false,
        dismissed: false,
      })
    }

    if (newAlerts.length === 0) return
    save('oa_sent_alert_keys', Array.from(sentAlertKeysRef.current))

    // Add to alerts page
    setAlerts(prev => activeAlertsOnly([...newAlerts, ...prev]))

    // Email delivery is handled by the backend scanner. This browser-side path
    // only keeps any legacy cached alerts visible until the next backend poll.
  }, [])

  const scanCachedTickerForGoAlerts = useCallback(async (ticker: string) => {
    const entry = tickerCacheRef.current[ticker]
    if (!entry) return
    await scanForGoAlerts(entry.ticker, entry.data, entry.data.company_name)
  }, [scanForGoAlerts])

  const scanCachedWatchlistForGoAlerts = useCallback(async () => {
    const tickers = watchlistRef.current.map(w => w.ticker)
    for (const ticker of tickers) {
      await scanCachedTickerForGoAlerts(ticker)
    }
  }, [scanCachedTickerForGoAlerts])

  const ensureAnalysisForPortfolioExpiry = useCallback(async (
    ticker: string,
    positionExpiry: string,
    opts?: { force?: boolean; spreadWidth?: number | null },
  ) => {
    const norm = normalizePortfolioExpiryIso(positionExpiry)
    const inflightKey = `${ticker}|${norm}`
    if (!opts?.force && isPortfolioExpiryAnalysisFresh(tickerCacheRef.current[ticker], positionExpiry)) return
    const failedAt = portfolioFetchFailuresRef.current.get(inflightKey)
    if (!opts?.force && failedAt != null && Date.now() - failedAt < 60_000) return
    if (portfolioExpiryFetchRef.current.has(inflightKey)) return

    portfolioExpiryFetchRef.current.add(inflightKey)
    try {
      const existing = tickerCacheRef.current[ticker]
      const spreadWidth =
        opts?.spreadWidth !== undefined ? opts.spreadWidth : existing?.spreadWidth ?? null
      const strategyMode = (existing?.strategyMode ?? 'all') as StrategyMode
      const expMs = new Date(`${norm}T12:00:00`).getTime()
      const dte = Math.ceil((expMs - Date.now()) / 86400000)
      const weeksOut = Math.max(2, Math.min(8, Math.round(dte / 7) || 2))

      const data = await analyzeOptions(ticker, weeksOut, spreadWidth, strategyMode, norm)
      const portfolioByExpiry = { ...(existing?.portfolioByExpiry ?? {}), [norm]: data }
      const nowSlice = Date.now()
      const portfolioByExpiryFetchedAt = {
        ...(existing?.portfolioByExpiryFetchedAt ?? {}),
        [norm]: nowSlice,
      }
      const hadPrimary = !!existing?.data
      const entry: TickerCacheEntry = {
        ticker,
        data: hadPrimary ? existing!.data : data,
        timestamp: hadPrimary ? existing!.timestamp : Date.now(),
        weeksOut: hadPrimary ? existing!.weeksOut : weeksOut,
        spreadWidth: hadPrimary ? existing!.spreadWidth : spreadWidth,
        strategyMode: hadPrimary ? existing!.strategyMode : strategyMode,
        chainExpiry: existing?.chainExpiry,
        multiWeekData: existing?.multiWeekData,
        multiWeekTimestamp: existing?.multiWeekTimestamp,
        portfolioByExpiry,
        portfolioByExpiryFetchedAt,
      }

      tickerCacheRef.current = { ...tickerCacheRef.current, [ticker]: entry }
      setTickerCache(prev => ({ ...prev, [ticker]: entry }))
      setWatchlist(prev => prev.map(w =>
        w.ticker === ticker
          ? { ...w, lastPrice: data.signals.current_price, companyName: data.company_name, sector: data.sector }
          : w
      ))
      portfolioFetchFailuresRef.current.delete(inflightKey)
      await scanCachedTickerForGoAlerts(ticker)
    } catch (e) {
      console.warn(`[portfolio] fetch analysis failed for ${ticker} ${norm}:`, e)
      portfolioFetchFailuresRef.current.set(inflightKey, Date.now())
    } finally {
      portfolioExpiryFetchRef.current.delete(inflightKey)
    }
  }, [scanCachedTickerForGoAlerts])

  // ── refreshTicker: re-fetch one ticker and update cache ─────────────────────
  const refreshTicker = useCallback(async (ticker: string) => {
    const existing = tickerCacheRef.current[ticker]
    const weeksOut     = existing?.weeksOut     ?? 4
    const spreadWidth  = existing?.spreadWidth  ?? 5
    const strategyMode = (existing?.strategyMode ?? 'all') as StrategyMode

    setRefreshingTickers(prev => new Set(prev).add(ticker))
    try {
      // ONE Yahoo API fetch — used for both cache update AND alert scanning
      const data = await analyzeOptions(ticker, weeksOut, spreadWidth, strategyMode)
      const chainRaw = data.filters_applied?.chain_expiry
      const chainNorm = typeof chainRaw === 'string' ? normalizePortfolioExpiryIso(chainRaw) : null
      let portfolioByExpiry = existing?.portfolioByExpiry
      let portfolioByExpiryFetchedAt = existing?.portfolioByExpiryFetchedAt
      if (chainNorm && existing?.portfolioByExpiry?.[chainNorm]) {
        portfolioByExpiry = { ...existing.portfolioByExpiry, [chainNorm]: data }
        portfolioByExpiryFetchedAt = {
          ...(existing.portfolioByExpiryFetchedAt ?? {}),
          [chainNorm]: Date.now(),
        }
      }
      const entry: TickerCacheEntry = {
        ticker,
        data,
        timestamp: Date.now(),
        weeksOut,
        spreadWidth,
        strategyMode,
        chainExpiry: undefined,
        portfolioByExpiry,
        portfolioByExpiryFetchedAt,
        multiWeekData: existing?.multiWeekData,
        multiWeekTimestamp: existing?.multiWeekTimestamp,
      }
      tickerCacheRef.current = { ...tickerCacheRef.current, [ticker]: entry }
      setTickerCache(prev => ({ ...prev, [ticker]: entry }))
      setWatchlist(prev => prev.map(w =>
        w.ticker === ticker
          ? { ...w, lastPrice: data.signals.current_price, companyName: data.company_name, sector: data.sector }
          : w
      ))
    } catch (e) {
      console.warn(`[cache] refresh failed for ${ticker}:`, e)
    } finally {
      setRefreshingTickers(prev => { const n = new Set(prev); n.delete(ticker); return n })
    }
  }, [scanCachedTickerForGoAlerts])

  const refreshWatchlistForAlerts = useCallback(async (force = true) => {
    const currentUser = userRef.current
    const watchedTickers = watchlistRef.current
      .map(w => w.ticker)
      .filter(Boolean)
    const tickersToRefresh = watchedTickers.filter(ticker => {
        if (force) return true
        const entry = tickerCacheRef.current[ticker]
        return entry && !isCacheFresh(entry)
      })

    for (let i = 0; i < tickersToRefresh.length; i++) {
      const ticker = tickersToRefresh[i]
      await new Promise(r => setTimeout(r, i * 2000))
      await refreshTicker(ticker)
    }

    if (currentUser?.email) {
      try {
        const backendAlerts = await scanBackendAlerts(currentUser.email)
        setAlerts(activeAlertsOnly(backendAlerts))
      } catch (e) {
        console.warn('[alerts] backend scan failed:', e)
      }
    }
    setLastBgRefresh(Date.now())
  }, [refreshTicker])

  // After a saved watchlist loads for this signed-in email, refresh it once for
  // the current browser session so new sessions do not depend on local cache.
  useEffect(() => {
    if (!user?.email || !userDataLoaded || watchlist.length === 0) return
    if (loginRefreshEmailRef.current === user.email) return

    loginRefreshEmailRef.current = user.email
    refreshWatchlistForAlerts(true)
  }, [refreshWatchlistForAlerts, user?.email, userDataLoaded, watchlist.length])

  // ── fetchAllWeeks: fetch each MULTI_WEEK_TARGETS expiry and store in multiWeekData ──
  const fetchAllWeeks = useCallback(async (ticker: string) => {
    if (fetchingAllWeeks.has(ticker)) return
    setFetchingAllWeeks(prev => new Set(prev).add(ticker))
    const existing = tickerCacheRef.current[ticker]
    const spreadWidth  = existing?.spreadWidth  ?? null
    const strategyMode = (existing?.strategyMode ?? 'all') as StrategyMode
    const weeks = [...MULTI_WEEK_TARGETS]
    const multiWeekData: Record<number, AnalyzeResponse> = {}
    for (let i = 0; i < weeks.length; i++) {
      const w = weeks[i]
      try {
        await new Promise(r => setTimeout(r, i * 600))   // stagger 600ms between calls
        const data = await analyzeOptions(ticker, w, spreadWidth, strategyMode)
        multiWeekData[w] = data
      } catch (e) {
        console.warn(`[multi-week] week ${w} failed for ${ticker}:`, e)
      }
    }
    setTickerCache(prev => {
      const existing = prev[ticker]
      if (!existing) return prev
      // Merge so an all-Yahoo-failure sweep does not wipe previously cached weeks.
      const mergedMulti: Record<number, AnalyzeResponse> = {
        ...(existing.multiWeekData ?? {}),
        ...multiWeekData,
      }
      const hasNew = Object.keys(multiWeekData).length > 0
      return {
        ...prev,
        [ticker]: {
          ...existing,
          multiWeekData: mergedMulti,
          multiWeekTimestamp: hasNew ? Date.now() : (existing.multiWeekTimestamp ?? Date.now()),
        },
      }
    })
    setFetchingAllWeeks(prev => { const n = new Set(prev); n.delete(ticker); return n })
  }, [fetchingAllWeeks])

  // ── fetchSingleWeek: fetch one specific week on demand (triggered by tab click) ──
  const fetchSingleWeek = useCallback(async (ticker: string, weeksOut: number) => {
    // Skip if already loading this week
    setFetchingWeeks(prev => {
      const next = new Map(prev)
      const weeks = new Set(next.get(ticker) ?? [])
      if (weeks.has(weeksOut)) return prev   // already in flight
      weeks.add(weeksOut)
      next.set(ticker, weeks)
      return next
    })
    const existing = tickerCacheRef.current[ticker]
    const spreadWidth  = existing?.spreadWidth  ?? null
    const strategyMode = (existing?.strategyMode ?? 'all') as StrategyMode
    try {
      const data = await analyzeOptions(ticker, weeksOut, spreadWidth, strategyMode)
      setTickerCache(prev => {
        const entry = prev[ticker]
        if (!entry) return prev
        const multiWeekData = { ...(entry.multiWeekData ?? {}), [weeksOut]: data }
        return { ...prev, [ticker]: { ...entry, multiWeekData, multiWeekTimestamp: Date.now() } }
      })
    } catch (e) {
      console.warn(`[single-week] week ${weeksOut} failed for ${ticker}:`, e)
    } finally {
      setFetchingWeeks(prev => {
        const next = new Map(prev)
        const weeks = new Set(next.get(ticker) ?? [])
        weeks.delete(weeksOut)
        if (weeks.size === 0) next.delete(ticker)
        else next.set(ticker, weeks)
        return next
      })
    }
  }, [])

  // ── Keep isMarketHours current (re-check every minute) ──────────────────────
  useEffect(() => {
    const id = setInterval(() => setIsMarketHours(isMarketHoursNow()), 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const prune = () => setAlerts(prev => activeAlertsOnly(prev))
    prune()
    const id = setInterval(prune, 60 * 60 * 1000)
    return () => clearInterval(id)
  }, [])

  // ── Background refresh: every 15 minutes, sweep stale watched tickers ────────
  // Only fires during market hours: 6:00 AM – 4:00 PM PST, weekdays only.
  // Note: watchlist is read via watchlistRef.current inside refreshWatchlistForAlerts,
  // so we do NOT add watchlist.length here — that would cause unwanted sweeps on
  // every add/remove and flood the API during market hours.
  useEffect(() => {
    const sweep = async () => {
      if (!isMarketHoursNow()) return
      await refreshWatchlistForAlerts(false)
    }

    const id = setInterval(sweep, CACHE_TTL_MS)
    return () => clearInterval(id)
  }, [refreshWatchlistForAlerts])

  const unreadAlertCount = alerts.filter(a => !a.dismissed).length

  const canAccessPage = useCallback(
    (p: Page) => roleCanAccessPage(user?.role, p),
    [user?.role],
  )

  return (
    <AppContext.Provider value={{
      page, navigate, navigateToTickerAdvisorFresh,
      pendingTicker, pendingAnalysisOptions, requestAnalysis, clearPendingTicker,
      user, loginWithPassword, registerWithPassword, loginWithGoogleCredential, logout, canAccessPage,
      userDataLoaded, advisoryAcceptedAt, advisoryTermsVersion, needsAdvisoryAcknowledgement, acknowledgeAdvisoryDisclaimer,
      watchlist, watchlistMax, addToWatchlist, removeFromWatchlist, isWatched, watchlistNotice, clearWatchlistNotice,
      dayTradeWatchlist, setDayTradeWatchlist,
      swingTradeWatchlist, setSwingTradeWatchlist,
      dayTradeEngineUI, setDayTradeEngineUI,
      dayTradeWatchlistUI, setDayTradeWatchlistUI,
      swingTradeWatchlistUI, setSwingTradeWatchlistUI,
      portfolio, addToPortfolio, addManualPosition, updatePortfolioPosition, removeFromPortfolio, closePosition, isInPortfolio,
      tickerCache, getCached, setCached, evictCache,
      refreshingTickers, refreshTicker, ensureAnalysisForPortfolioExpiry, lastBgRefresh, isMarketHours, refreshWatchlistForAlerts,
      fetchAllWeeks, fetchSingleWeek, fetchingAllWeeks, fetchingWeeks,
      alerts, unreadAlertCount, dismissAlert, clearAlerts,
      theme, toggleTheme,
      alertEmailEnabled, setAlertEmailEnabled,
      accountSize, setAccountSize,
      journalEntryCount, refreshJournalCount, syncJournalEntryCount,
    }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
