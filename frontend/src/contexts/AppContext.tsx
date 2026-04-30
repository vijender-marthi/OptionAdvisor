import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import type { ReactNode } from 'react'
import type { Page, User, WatchlistItem, PortfolioPosition, Recommendation, TickerCacheEntry, AnalyzeResponse, StrategyMode } from '../types'
import { isCacheFresh, CACHE_TTL_MS } from '../types'
import { analyzeOptions, getUserData, saveUserData } from '../api/client'

// ─── Router ────────────────────────────────────────────────────────────────────
function getHashPage(): Page {
  const h = window.location.hash.replace('#', '')
  if (h === 'watchlist') return 'watchlist'
  if (h === 'portfolio') return 'portfolio'
  if (h === 'help') return 'help'
  if (h === 'login') return 'login'
  if (h === 'ai-stocks') return 'ai-stocks'
  if (h === 'trade-signals') return 'trade-signals'
  return 'ticker'
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
  // Multi-week scan (2,3,4,6,8 weeks) — stored inside the cache entry's multiWeekData
  fetchAllWeeks: (ticker: string) => Promise<void>
  fetchingAllWeeks: Set<string>

  // Theme
  theme: 'dark' | 'light'
  toggleTheme: () => void
}

const AppContext = createContext<AppContextValue | null>(null)

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
  const [lastBgRefresh, setLastBgRefresh]           = useState<number | null>(null)
  const [theme, setTheme] = useState<'dark' | 'light'>(getInitialTheme)
  const [userDataLoaded, setUserDataLoaded] = useState(false)

  // Keep a ref to watchlist so the interval closure always sees current value
  const watchlistRef = useRef(watchlist)
  useEffect(() => { watchlistRef.current = watchlist }, [watchlist])
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
      } catch (e) {
        console.warn('[user-data] load failed:', e)
        if (!cancelled) {
          setWatchlist([])
          setPortfolio([])
        }
      } finally {
        if (!cancelled) setUserDataLoaded(true)
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
    setWatchlist([])
    setPortfolio([])
    setUserDataLoaded(false)
    setUser({ name: displayName, email: cleanEmail })
    return true
  }, [])

  const logout = useCallback(() => {
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
      if (prev.some(p => p.ticker === ticker && p.strategy === rec.strategy && p.expiry === rec.expiry))
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

  const removeFromPortfolio = useCallback((id: string) => {
    setPortfolio(prev => prev.filter(p => p.id !== id))
  }, [])

  const closePosition = useCallback((id: string, pnlPct: number) => {
    setPortfolio(prev => prev.map(p =>
      p.id === id ? { ...p, status: 'closed' as const, pnlPct, exitDate: new Date().toISOString() } : p
    ))
  }, [])

  const isInPortfolio = useCallback((ticker: string, strategy: string, expiry: string) =>
    portfolio.some(p => p.ticker === ticker && p.strategy === strategy && p.expiry === expiry),
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

  // ── refreshTicker: re-fetch one ticker and update cache ─────────────────────
  const refreshTicker = useCallback(async (ticker: string) => {
    const existing = tickerCacheRef.current[ticker]
    const weeksOut     = existing?.weeksOut     ?? 4
    const spreadWidth  = existing?.spreadWidth  ?? 5
    const strategyMode = (existing?.strategyMode ?? 'all') as StrategyMode

    setRefreshingTickers(prev => new Set(prev).add(ticker))
    try {
      const data = await analyzeOptions(ticker, weeksOut, spreadWidth, strategyMode)
      const entry: TickerCacheEntry = { ticker, data, timestamp: Date.now(), weeksOut, spreadWidth, strategyMode }
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
  }, [])

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

  // ── Background refresh: every 15 minutes, sweep all watched tickers ─────────
  useEffect(() => {
    const sweep = async () => {
      const tickers = watchlistRef.current.map(w => w.ticker)
      if (tickers.length === 0) return

      setLastBgRefresh(Date.now())
      // Stagger: 2 s between each call to avoid flooding the API
      for (let i = 0; i < tickers.length; i++) {
        const t = tickers[i]
        // Only refresh if we have cached data (don't auto-fetch tickers never analyzed)
        if (!tickerCacheRef.current[t]) continue
        // Skip if already refreshing or recently refreshed (< 14 min old)
        const entry = tickerCacheRef.current[t]
        if (entry && isCacheFresh(entry)) continue
        await new Promise(r => setTimeout(r, i * 2000))
        // Re-check after delay (user may have navigated away or manual refresh ran)
        if (tickerCacheRef.current[t] && isCacheFresh(tickerCacheRef.current[t])) continue
        refreshTicker(t)
      }
    }

    const id = setInterval(sweep, CACHE_TTL_MS)
    return () => clearInterval(id)
  }, [refreshTicker])

  return (
    <AppContext.Provider value={{
      page, navigate,
      pendingTicker, requestAnalysis, clearPendingTicker,
      user, login, logout,
      watchlist, addToWatchlist, removeFromWatchlist, isWatched,
      portfolio, addToPortfolio, removeFromPortfolio, closePosition, isInPortfolio,
      tickerCache, getCached, setCached, evictCache,
      refreshingTickers, refreshTicker, lastBgRefresh,
      fetchAllWeeks, fetchingAllWeeks,
      theme, toggleTheme,
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
