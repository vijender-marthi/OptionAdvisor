import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import type { ReactNode } from 'react'
import type { AlertEntry, Page, User, WatchlistItem, PortfolioPosition, Recommendation, TickerCacheEntry, AnalyzeResponse, StrategyMode } from '../types'
import { isCacheFresh, CACHE_TTL_MS } from '../types'
import { analyzeOptions, clearBackendAlerts, dismissBackendAlert, getAlerts, getUserData, saveUserData, scanBackendAlerts } from '../api/client'
import { buildChecklist, deriveVerdict } from '../components/PreTradeChecklist'

// ─── Router ────────────────────────────────────────────────────────────────────
function getHashPage(): Page {
  const h = window.location.hash.replace('#', '')
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

  // Cross-page ticker handoff
  pendingTicker: string | null
  requestAnalysis: (ticker: string) => void
  clearPendingTicker: () => void

  // Auth
  user: User | null
  login: (name: string, email: string, password: string) => boolean
  logout: () => void

  // Watchlist
  watchlist: WatchlistItem[]
  addToWatchlist: (item: Omit<WatchlistItem, 'addedAt'>) => void
  removeFromWatchlist: (ticker: string) => void
  isWatched: (ticker: string) => boolean

  // Portfolio
  portfolio: PortfolioPosition[]
  addToPortfolio: (rec: Recommendation, ticker: string, companyName: string, entryPrice: number, contracts: number) => void
  addManualPosition: (pos: Omit<PortfolioPosition, 'id' | 'addedAt' | 'status'>) => void
  removeFromPortfolio: (id: string) => void
  closePosition: (id: string, pnlPct: number) => void
  isInPortfolio: (ticker: string, strategy: string, expiry: string) => boolean

  // Cache
  tickerCache: Record<string, TickerCacheEntry>
  getCached: (ticker: string) => TickerCacheEntry | null
  setCached: (ticker: string, data: AnalyzeResponse, weeksOut: number, spreadWidth: number | null, strategyMode: StrategyMode) => void
  evictCache: (ticker: string) => void
  refreshingTickers: Set<string>
  refreshTicker: (ticker: string) => Promise<void>
  lastBgRefresh: number | null   // timestamp of last background sweep
  isMarketHours: boolean         // true when within 6 AM–4 PM PST weekdays
  refreshWatchlistForAlerts: () => Promise<void>
  // Multi-week scan (2,3,4,6,8 weeks) — stored inside the cache entry's multiWeekData
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
}

const AppContext = createContext<AppContextValue | null>(null)
const ALERT_RETENTION_MS = 24 * 60 * 60 * 1000

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

function getInitialTheme(): 'dark' | 'light' {
  const saved = load<'dark' | 'light' | null>('oa_theme', null)
  if (saved === 'dark' || saved === 'light') return saved
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

// ─── Provider ──────────────────────────────────────────────────────────────────
export function AppProvider({ children }: { children: ReactNode }) {
  const [page, setPage]             = useState<Page>(getHashPage)
  const [user, setUser]             = useState<User | null>(() => load<User | null>('oa_user', null))
  const [watchlist, setWatchlist]   = useState<WatchlistItem[]>([])
  const [portfolio, setPortfolio]   = useState<PortfolioPosition[]>([])
  const [pendingTicker, setPendingTicker] = useState<string | null>(null)
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
  const [userDataLoaded, setUserDataLoaded] = useState(false)
  const loginRefreshEmailRef = useRef<string | null>(null)

  // Keep refs so interval/async closures always see current values
  const watchlistRef = useRef(watchlist)
  useEffect(() => { watchlistRef.current = watchlist }, [watchlist])
  const userRef = useRef(user)
  useEffect(() => { userRef.current = user }, [user])
  const tickerCacheRef = useRef(tickerCache)
  useEffect(() => { tickerCacheRef.current = tickerCache }, [tickerCache])

  // Sync hash
  useEffect(() => {
    window.location.hash = page === 'ticker' ? '' : page
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
        setUserDataLoaded(false)
        return
      }

      setUserDataLoaded(false)
      try {
        const data = await getUserData(user.email)
        if (cancelled) return
        setWatchlist(data.watchlist)
        setPortfolio(data.portfolio)
        setUserDataLoaded(true)
      } catch (e) {
        console.warn('[user-data] load failed:', e)
        if (!cancelled) {
          setWatchlist([])
          setPortfolio([])
          setUserDataLoaded(false)
        }
      }
    }

    loadUserData()
    return () => { cancelled = true }
  }, [user?.email])

  // Save per-email watchlist and portfolio changes to SQLite.
  useEffect(() => {
    if (!user?.email || !userDataLoaded) return
    saveUserData(user.email, watchlist, portfolio).catch(e => {
      console.warn('[user-data] save failed:', e)
    })
  }, [portfolio, user?.email, userDataLoaded, watchlist])

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

  // ── Router ──────────────────────────────────────────────────────────────────
  const navigate = useCallback((p: Page) => setPage(p), [])

  const requestAnalysis = useCallback((ticker: string) => {
    setPendingTicker(ticker.trim().toUpperCase())
    setPage('ticker')
  }, [])
  const clearPendingTicker = useCallback(() => setPendingTicker(null), [])

  // ── Auth ────────────────────────────────────────────────────────────────────
  const login = useCallback((name: string, email: string, password: string): boolean => {
    const cleanEmail = email.trim()
    if (!cleanEmail || !password.trim()) return false
    const displayName = name.trim() || cleanEmail.split('@')[0] || 'User'
    loginRefreshEmailRef.current = null
    setWatchlist([])
    setPortfolio([])
    setUserDataLoaded(false)
    setUser({ name: displayName, email: cleanEmail })
    return true
  }, [])

  const logout = useCallback(() => {
    loginRefreshEmailRef.current = null
    setUser(null)
    setWatchlist([])
    setPortfolio([])
    setUserDataLoaded(false)
    setPage('login')
  }, [])

  // ── Watchlist ───────────────────────────────────────────────────────────────
  const addToWatchlist = useCallback((item: Omit<WatchlistItem, 'addedAt'>) => {
    setWatchlist(prev => {
      if (prev.some(w => w.ticker === item.ticker)) return prev
      return [...prev, { ...item, addedAt: new Date().toISOString() }]
    })
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

  const removeFromPortfolio = useCallback((id: string) => {
    setPortfolio(prev => prev.filter(p => p.id !== id))
  }, [])

  const closePosition = useCallback((id: string, pnlPct: number) => {
    setPortfolio(prev => prev.map(p =>
      p.id === id ? { ...p, status: 'closed' as const, pnlPct, exitDate: new Date().toISOString() } : p
    ))
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
  ) => {
    const entry: TickerCacheEntry = { ticker, data, timestamp: Date.now(), weeksOut, spreadWidth, strategyMode }
    setTickerCache(prev => ({ ...prev, [ticker]: entry }))
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
      const entry: TickerCacheEntry = { ticker, data, timestamp: Date.now(), weeksOut, spreadWidth, strategyMode }
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

  // ── fetchAllWeeks: fetch 2,3,4,6,8 week expiries and store in multiWeekData ──
  const fetchAllWeeks = useCallback(async (ticker: string) => {
    if (fetchingAllWeeks.has(ticker)) return
    setFetchingAllWeeks(prev => new Set(prev).add(ticker))
    const existing = tickerCacheRef.current[ticker]
    const spreadWidth  = existing?.spreadWidth  ?? null
    const strategyMode = (existing?.strategyMode ?? 'all') as StrategyMode
    const weeks = [2, 3, 4, 6, 8]
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
      return { ...prev, [ticker]: { ...existing, multiWeekData, multiWeekTimestamp: Date.now() } }
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

  return (
    <AppContext.Provider value={{
      page, navigate,
      pendingTicker, requestAnalysis, clearPendingTicker,
      user, login, logout,
      watchlist, addToWatchlist, removeFromWatchlist, isWatched,
      portfolio, addToPortfolio, addManualPosition, removeFromPortfolio, closePosition, isInPortfolio,
      tickerCache, getCached, setCached, evictCache,
      refreshingTickers, refreshTicker, lastBgRefresh, isMarketHours, refreshWatchlistForAlerts,
      fetchAllWeeks, fetchSingleWeek, fetchingAllWeeks, fetchingWeeks,
      alerts, unreadAlertCount, dismissAlert, clearAlerts,
      theme, toggleTheme,
      alertEmailEnabled, setAlertEmailEnabled,
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
