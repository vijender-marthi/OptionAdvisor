import { useEffect, useRef, useState } from 'react'
import {
  TrendingUp, Star, Briefcase, LogOut, ChevronLeft, ChevronRight, FlaskConical,
  User, BarChart2, HelpCircle, Brain, ShieldCheck, Activity, Bell, Settings, Atom,
  MoreHorizontal, Moon, Sun, Menu, BookOpen, Zap,
} from 'lucide-react'
import type { Page, UserRole } from '../types'
import { useApp } from '../contexts/AppContext'
import { normalizeUserRole, roleLabel } from '../permissions'
import ThemeToggle from './ThemeToggle'
import BetaProductTag from './BetaProductTag'

type ProfileRole = 'user' | 'admin' | 'finance'

function profileRole(role: UserRole | undefined | null): ProfileRole {
  if (!role) return 'user'
  const r = normalizeUserRole(role)
  if (r === 'admin' || r === 'finance') return r
  return 'user'
}

/** Desktop sidebar profile strip only — role tint + html.light overrides in index.css */
const PROFILE: Record<
  ProfileRole,
  {
    card: string
    avatar: string
    name: string
    email: string
    logout: string
    roleTagClass: string | null
  }
> = {
  user: {
    card: 'sidebar-profile-card sidebar-profile-user bg-gray-800/60',
    avatar: 'bg-violet-700',
    name: 'sidebar-profile-name text-gray-200',
    email: 'sidebar-profile-email text-gray-500',
    logout: 'sidebar-profile-logout text-gray-500 hover:text-red-400',
    roleTagClass: null,
  },
  admin: {
    card:
      'sidebar-profile-card sidebar-profile-admin bg-amber-950/45 border border-amber-600/40 ring-1 ring-inset ring-amber-400/15',
    avatar: 'bg-amber-600',
    name: 'sidebar-profile-name text-amber-50',
    email: 'sidebar-profile-email text-amber-200/65',
    logout: 'sidebar-profile-logout text-amber-200/80 hover:text-red-400',
    roleTagClass:
      'sidebar-profile-role-tag text-[10px] font-semibold uppercase tracking-wide text-amber-300/95',
  },
  finance: {
    card:
      'sidebar-profile-card sidebar-profile-finance bg-emerald-950/40 border border-emerald-600/38 ring-1 ring-inset ring-emerald-400/12',
    avatar: 'bg-emerald-600',
    name: 'sidebar-profile-name text-emerald-50',
    email: 'sidebar-profile-email text-emerald-200/65',
    logout: 'sidebar-profile-logout text-emerald-200/80 hover:text-red-400',
    roleTagClass:
      'sidebar-profile-role-tag text-[10px] font-semibold uppercase tracking-wide text-emerald-300/95',
  },
}

interface NavItem {
  id: Page
  label: string
  icon: React.ReactNode
  badge?: number
}

interface NavGroup {
  label: string
  items: NavItem[]
}

/** Phone + tablet bottom rails — shared styles; opacity/backdrop tightened in index.css (`html.dark` / `html.light`). */
const MOBILE_BOTTOM_NAV_CLASS =
  'mobile-bottom-nav fixed inset-x-0 bottom-0 border-t border-gray-600/35 bg-gray-900 shadow-[0_-8px_32px_rgba(0,0,0,0.42)] pb-[env(safe-area-inset-bottom)]'

export default function Sidebar() {
  const { page, navigate, user, logout, watchlist, portfolio, isMarketHours, unreadAlertCount, theme, toggleTheme, journalEntryCount, canAccessPage } = useApp()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false)
  const [phoneMenuOpen, setPhoneMenuOpen] = useState(false)

  const openPositions = portfolio.filter(p => p.status === 'open').length
  const pr = user ? profileRole(user.role) : 'user'
  const pf = PROFILE[pr]

  const navGroups: NavGroup[] = [
    {
      label: 'Analyze',
      items: [
        { id: 'ticker',        label: 'Strategy Finder', icon: <TrendingUp size={18} /> },
        { id: 'trade-signals', label: 'Signals',   icon: <ShieldCheck size={18} /> },
      ],
    },
    {
      label: 'Track',
      items: [
        { id: 'watchlist', label: 'Watchlist', icon: <Star size={18} />,      badge: watchlist.length || undefined },
        { id: 'portfolio', label: 'Portfolio', icon: <Briefcase size={18} />, badge: openPositions || undefined },
        { id: 'journal',   label: 'Journal',   icon: <BookOpen size={18} />,  badge: journalEntryCount || undefined },
        { id: 'alerts',    label: 'Alerts',    icon: <Bell size={18} />,      badge: unreadAlertCount || undefined },
        ...(canAccessPage('auto-trade') ? [{ id: 'auto-trade' as const, label: 'Auto Trade', icon: <Zap size={18} /> }] : []),
      ],
    },
    {
      label: 'Discover',
      items: [
        { id: 'ai-stocks', label: 'AI Radar',    icon: <Brain         size={18} /> },
        { id: 'q-radar',   label: 'Q Radar',    icon: <Atom          size={18} /> },
        { id: 'backtest',  label: 'Backtest Lab', icon: <FlaskConical size={18} /> },
      ],
    },
  ]

  const w = collapsed ? 'w-16' : 'w-56'
  const mobilePrimaryItems: NavItem[] = [
    { id: 'ticker',        label: 'Home', icon: <TrendingUp size={18} /> },
    { id: 'trade-signals', label: 'Signals', icon: <ShieldCheck size={18} /> },
    { id: 'watchlist',     label: 'Watchlist', icon: <Star size={18} />,      badge: watchlist.length || undefined },
    { id: 'portfolio',     label: 'Portfolio', icon: <Briefcase size={18} />, badge: openPositions || undefined },
    { id: 'alerts',        label: 'Alerts',    icon: <Bell size={18} />,      badge: unreadAlertCount || undefined },
  ]
  const mobileMoreItems: NavItem[] = [
    { id: 'journal',    label: 'Journal',    icon: <BookOpen size={18} />, badge: journalEntryCount || undefined },
    { id: 'auto-trade', label: 'Auto Trade', icon: <Zap     size={18} /> },
    { id: 'ai-stocks', label: 'AI Radar', icon: <Brain         size={18} /> },
    { id: 'q-radar',   label: 'Q Radar',  icon: <Atom          size={18} /> },
    { id: 'backtest',  label: 'Backtest', icon: <FlaskConical  size={18} /> },
    { id: 'settings',  label: 'Settings',   icon: <Settings size={18} /> },
    { id: 'help',      label: 'Help',     icon: <HelpCircle size={18} /> },
  ]

  const visibleNavGroups = navGroups
    .map(g => ({ ...g, items: g.items.filter(i => canAccessPage(i.id)) }))
    .filter(g => g.items.length > 0)
  const visibleMobilePrimaryItems = mobilePrimaryItems.filter(i => canAccessPage(i.id))
  const visibleMobileMoreItems = mobileMoreItems.filter(i => canAccessPage(i.id))
  const mobileMoreActive = visibleMobileMoreItems.some(item => item.id === page)
  const isLight = theme === 'light'

  /** Mobile + tablet (< xl): bottom rail at top / scroll-up; corner Menu FAB when scrolling down. */
  const [dockBottomMobileNav, setDockBottomMobileNav] = useState(true)
  const lastMainScrollRef = useRef(0)

  useEffect(() => {
    const root = document.querySelector('.app-main-scroll') as HTMLElement | null
    if (!root) return
    lastMainScrollRef.current = root.scrollTop
    const deltaThresh = 5
    const topSnap = 24
    const onScroll = () => {
      const st = root.scrollTop
      const prev = lastMainScrollRef.current
      const delta = st - prev
      lastMainScrollRef.current = st
      if (st <= topSnap) {
        setDockBottomMobileNav(true)
        return
      }
      if (delta > deltaThresh) setDockBottomMobileNav(false)
      else if (delta < -deltaThresh) setDockBottomMobileNav(true)
    }
    root.addEventListener('scroll', onScroll, { passive: true })
    return () => root.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (dockBottomMobileNav) setPhoneMenuOpen(false)
    else setMobileMoreOpen(false)
  }, [dockBottomMobileNav])

  const handleMobileNavigate = (target: Page) => {
    navigate(target)
    setMobileMoreOpen(false)
    setPhoneMenuOpen(false)
  }

  return (
    <>
    <aside className={`${w} hidden xl:flex font-sans h-full min-h-0 shrink-0 bg-gray-900 border-r border-gray-800 flex-col transition-all duration-200 overflow-hidden`}>
      {/* Logo */}
      <div className={`flex items-center gap-2.5 px-3 py-2.5 border-b border-gray-800 shrink-0 ${collapsed ? 'justify-center' : ''}`}>
        <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center shrink-0">
          <BarChart2 size={16} className="text-white" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-semibold text-white leading-tight">OptionAdvisor</span>
              <BetaProductTag />
            </div>
            <div className="text-[10px] text-gray-500 leading-tight">Systematic Engine v2</div>
          </div>
        )}
      </div>

      {/* Nav items — compact layout; overscroll contained so wheel doesn’t scroll the main column */}
      <nav className="desktop-sidebar-nav flex-1 min-h-0 overflow-y-auto py-2 px-1.5 space-y-2">
        {visibleNavGroups.map(group => (
          <div key={group.label}>
            {!collapsed && (
              <div className="px-3 pb-0.5 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-600">
                {group.label}
              </div>
            )}
            {collapsed && <div className="border-t border-gray-800 my-0.5" />}
            <div className="space-y-0.5">
              {group.items.map(item => {
                const active = page === item.id
                const isTradeSignals = item.id === 'trade-signals'
                const countBadge = typeof item.badge === 'number' && item.badge > 0 ? item.badge : null
                return (
                  <button
                    key={item.id}
                    onClick={() => navigate(item.id)}
                    title={item.label}
                    className={`relative isolate w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] font-semibold transition-all touch-manipulation
                      ${active
                        ? 'bg-violet-600/20 text-violet-300 border border-violet-700/50'
                        : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200 border border-transparent'
                      } ${collapsed ? 'justify-center' : ''}`}
                  >
                    <span className="shrink-0">{item.icon}</span>
                    {!collapsed && (
                      <>
                        <span className="min-w-0 flex-1 text-left truncate">{item.label}</span>
                        {isTradeSignals && (
                          <span className="shrink-0 bg-violet-700/30 text-violet-300 border border-violet-700/50 text-[10px] font-semibold px-1.5 py-0.5 rounded-full leading-none">
                            Live
                          </span>
                        )}
                        {countBadge !== null && (
                          <span className="shrink-0 bg-violet-700 text-violet-100 text-[11px] font-semibold px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center leading-none tabular-nums">
                            {countBadge}
                          </span>
                        )}
                      </>
                    )}
                    {collapsed && (countBadge !== null || isTradeSignals) && (
                      <span className={`absolute top-1 right-1 rounded-full ${isTradeSignals ? 'w-2 h-2 bg-violet-400' : 'w-2 h-2 bg-violet-500'}`} />
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom: settings + user */}
      <div className="border-t border-gray-800 p-1.5 space-y-0.5 shrink-0">
        <button
          onClick={() => navigate('settings')}
          title="Settings"
          className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] font-semibold transition-all
            ${page === 'settings'
              ? 'bg-violet-600/20 text-violet-300 border border-violet-700/50'
              : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300 border border-transparent'
            } ${collapsed ? 'justify-center' : ''}`}
        >
          <Settings size={18} className="shrink-0" />
          {!collapsed && <span>Settings</span>}
        </button>

        <button
          onClick={() => navigate('help')}
          title="Help"
          className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] font-semibold transition-all
            ${page === 'help'
              ? 'bg-violet-600/20 text-violet-300 border border-violet-700/50'
              : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300 border border-transparent'
            } ${collapsed ? 'justify-center' : ''}`}
        >
          <HelpCircle size={18} className="shrink-0" />
          {!collapsed && <span>Help</span>}
        </button>

        <ThemeToggle collapsed={collapsed} className="w-full !py-2" />

        {user && (
          <div
            data-profile-role={pr}
            title={collapsed ? `${user.name} — ${user.email}` : undefined}
            className={`flex items-center gap-2 px-2.5 py-2 rounded-lg ${pf.card} ${collapsed ? 'justify-center' : ''}`}
          >
            <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${pf.avatar}`}>
              <User size={13} className="text-white" />
            </div>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                {pf.roleTagClass && (
                  <div className={pf.roleTagClass}>{roleLabel(normalizeUserRole(user.role))}</div>
                )}
                <div className={`text-sm font-semibold truncate ${pf.name}`}>{user.name}</div>
                <div className={`text-[11px] font-medium truncate ${pf.email}`}>{user.email}</div>
              </div>
            )}
            {!collapsed && (
              <button onClick={logout} title="Sign out" className={`transition-colors shrink-0 ${pf.logout}`}>
                <LogOut size={14} />
              </button>
            )}
          </div>
        )}

        {/* Market hours indicator */}
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${collapsed ? 'justify-center' : ''}`}
          title={isMarketHours ? 'Market live — auto-refresh active (6 AM–4 PM PST)' : 'Market closed — auto-refresh paused'}>
          <Activity size={11} className={isMarketHours ? 'text-emerald-400 animate-pulse' : 'text-gray-700'} />
          {!collapsed && (
            <span className={`text-[10px] font-semibold ${isMarketHours ? 'text-emerald-400' : 'text-gray-700'}`}>
              {isMarketHours ? 'Market Live' : 'Market Closed'}
            </span>
          )}
        </div>

        {/* Collapse toggle */}
        <button
          type="button"
          onClick={() => setCollapsed(c => !c)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold text-gray-600 hover:text-gray-400 transition-colors ${collapsed ? 'justify-center' : ''}`}
        >
          {collapsed ? <ChevronRight size={14} /> : <><ChevronLeft size={14} /><span>Collapse</span></>}
        </button>
      </div>
    </aside>

    {/* Phone + tablet: full bottom rail when docked; scroll down → corner Menu FAB (see dockBottomMobileNav) */}
    {dockBottomMobileNav ? (
      <>
      <nav className={`${MOBILE_BOTTOM_NAV_CLASS} sm:hidden z-[70]`}>
        {mobileMoreOpen && (
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-[65] bg-black/25 sm:hidden"
            onClick={() => setMobileMoreOpen(false)}
          />
        )}
        {mobileMoreOpen && (
          <div className="mobile-more-menu absolute bottom-full left-1/2 z-[71] mb-2 w-[min(22rem,calc(100vw-1rem))] -translate-x-1/2 overflow-hidden rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl shadow-black/40">
            <div className="border-b border-gray-800 px-4 py-3">
              <div className="text-sm font-semibold text-white">More</div>
              <div className="text-xs text-gray-500">Radar, settings, theme, and account</div>
            </div>
            <div className="grid grid-cols-2 gap-2 p-3">
              {visibleMobileMoreItems.map(item => {
                const active = page === item.id
                const countBadge = typeof item.badge === 'number' && item.badge > 0 ? item.badge : null
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleMobileNavigate(item.id)}
                    title={item.label}
                    className={`mobile-more-item relative flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-semibold transition-colors touch-manipulation ${
                      active
                        ? 'border-violet-700/50 bg-violet-600/20 text-violet-300'
                        : 'border-gray-800 bg-gray-800/60 text-gray-300 hover:border-gray-700 hover:bg-gray-800'
                    }`}
                  >
                    <span className="shrink-0">{item.icon}</span>
                    <span className="min-w-0 truncate">{item.label}</span>
                    {countBadge !== null && (
                      <span className="shrink-0 ml-auto min-w-[1.15rem] rounded-full bg-violet-700 px-1 text-center text-[9px] leading-4 text-violet-100 tabular-nums">
                        {countBadge}
                      </span>
                    )}
                  </button>
                )
              })}
              <button
                type="button"
                onClick={() => {
                  toggleTheme()
                  setMobileMoreOpen(false)
                }}
                title={isLight ? 'Dark theme' : 'Light theme'}
                className="mobile-more-item flex items-center gap-2 rounded-xl border border-gray-800 bg-gray-800/60 px-3 py-2.5 text-left text-sm font-semibold text-gray-300 transition-colors hover:border-gray-700 hover:bg-gray-800"
              >
                {isLight ? <Moon size={18} className="shrink-0" /> : <Sun size={18} className="shrink-0" />}
                <span>{isLight ? 'Dark theme' : 'Light theme'}</span>
              </button>
              {user && (
                <button
                  type="button"
                  onClick={() => {
                    logout()
                    setMobileMoreOpen(false)
                  }}
                  title="Sign out"
                  className="mobile-more-item flex items-center gap-2 rounded-xl border border-gray-800 bg-gray-800/60 px-3 py-2.5 text-left text-sm font-semibold text-gray-300 transition-colors hover:border-red-800 hover:bg-red-900/20 hover:text-red-300"
                >
                  <LogOut size={18} className="shrink-0" />
                  <span>Sign out</span>
                </button>
              )}
            </div>
          </div>
        )}
        <div className="mobile-nav-scroll flex items-center gap-2 overflow-x-auto px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] justify-center">
          {visibleMobilePrimaryItems.map(item => {
            const active = page === item.id
            const isTradeSignals = item.id === 'trade-signals'
            const countBadge = typeof item.badge === 'number' && item.badge > 0 ? item.badge : null
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleMobileNavigate(item.id)}
                title={item.label}
                className={`mobile-nav-item min-w-[4.75rem] flex flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2 text-[11px] font-semibold transition-colors touch-manipulation ${
                  active
                    ? 'bg-violet-600/20 text-violet-300 border-violet-700/50'
                    : 'text-gray-400 border-transparent hover:bg-gray-800 hover:text-gray-200'
                }`}
              >
                <span className="relative inline-flex">
                  {item.icon}
                  {isTradeSignals && (
                    <span className="absolute -right-4 -top-2 rounded-full border border-violet-700/50 bg-violet-700/30 px-1 text-[8px] font-semibold leading-3 text-violet-300">
                      Live
                    </span>
                  )}
                  {countBadge !== null && (
                    <span className="absolute -right-2 -top-1 min-w-[1rem] rounded-full bg-violet-700 px-1 text-center text-[9px] leading-4 text-violet-100 tabular-nums">
                      {countBadge}
                    </span>
                  )}
                </span>
                <span className="max-w-[4.25rem] truncate">{item.label}</span>
              </button>
            )
          })}
          <button
            type="button"
            onClick={() => setMobileMoreOpen(open => !open)}
            aria-expanded={mobileMoreOpen}
            title="More"
            className={`mobile-nav-item min-w-[4.25rem] flex flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2 text-[11px] font-semibold transition-colors ${
              mobileMoreOpen || mobileMoreActive
                ? 'bg-violet-600/20 text-violet-300 border-violet-700/50'
                : 'text-gray-400 border-transparent hover:bg-gray-800 hover:text-gray-200'
            }`}
          >
            <MoreHorizontal size={18} />
            <span>More</span>
          </button>
        </div>
      </nav>

      <nav className={`${MOBILE_BOTTOM_NAV_CLASS} hidden sm:block xl:hidden z-40`}>
      {mobileMoreOpen && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-[35] bg-black/25 sm:block xl:hidden"
          onClick={() => setMobileMoreOpen(false)}
        />
      )}
      {mobileMoreOpen && (
          <div className="mobile-more-menu absolute bottom-full right-2 z-50 sm:right-1/2 sm:translate-x-1/2 mb-2 w-[min(22rem,calc(100vw-1rem))] overflow-hidden rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl shadow-black/40">
            <div className="border-b border-gray-800 px-4 py-3">
              <div className="text-sm font-semibold text-white">More</div>
              <div className="text-xs text-gray-500">Radar, settings, theme, and account</div>
            </div>
            <div className="grid grid-cols-2 gap-2 p-3">
              {visibleMobileMoreItems.map(item => {
                const active = page === item.id
                const countBadge = typeof item.badge === 'number' && item.badge > 0 ? item.badge : null
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleMobileNavigate(item.id)}
                    title={item.label}
                    className={`mobile-more-item relative flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-semibold transition-colors touch-manipulation ${
                      active
                        ? 'border-violet-700/50 bg-violet-600/20 text-violet-300'
                        : 'border-gray-800 bg-gray-800/60 text-gray-300 hover:border-gray-700 hover:bg-gray-800'
                    }`}
                  >
                    <span className="shrink-0">{item.icon}</span>
                    <span className="min-w-0 truncate">{item.label}</span>
                    {countBadge !== null && (
                      <span className="shrink-0 ml-auto min-w-[1.15rem] rounded-full bg-violet-700 px-1 text-center text-[9px] leading-4 text-violet-100 tabular-nums">
                        {countBadge}
                      </span>
                    )}
                  </button>
                )
              })}
              <button
                type="button"
                onClick={() => {
                  toggleTheme()
                  setMobileMoreOpen(false)
                }}
                title={isLight ? 'Dark theme' : 'Light theme'}
                className="mobile-more-item flex items-center gap-2 rounded-xl border border-gray-800 bg-gray-800/60 px-3 py-2.5 text-left text-sm font-semibold text-gray-300 transition-colors hover:border-gray-700 hover:bg-gray-800"
              >
                {isLight ? <Moon size={18} className="shrink-0" /> : <Sun size={18} className="shrink-0" />}
                <span>{isLight ? 'Dark theme' : 'Light theme'}</span>
              </button>
              {user && (
                <button
                  type="button"
                  onClick={() => {
                    logout()
                    setMobileMoreOpen(false)
                  }}
                  title="Sign out"
                  className="mobile-more-item flex items-center gap-2 rounded-xl border border-gray-800 bg-gray-800/60 px-3 py-2.5 text-left text-sm font-semibold text-gray-300 transition-colors hover:border-red-800 hover:bg-red-900/20 hover:text-red-300"
                >
                  <LogOut size={18} className="shrink-0" />
                  <span>Sign out</span>
                </button>
              )}
            </div>
          </div>
      )}
      <div className="mobile-nav-scroll flex items-center gap-2 overflow-x-auto px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:justify-center">
        {visibleMobilePrimaryItems.map(item => {
          const active = page === item.id
          const isTradeSignals = item.id === 'trade-signals'
          const countBadge = typeof item.badge === 'number' && item.badge > 0 ? item.badge : null
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleMobileNavigate(item.id)}
              title={item.label}
              className={`mobile-nav-item min-w-[4.75rem] flex flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2 text-[11px] font-semibold transition-colors touch-manipulation ${
                active
                  ? 'bg-violet-600/20 text-violet-300 border-violet-700/50'
                  : 'text-gray-400 border-transparent hover:bg-gray-800 hover:text-gray-200'
              }`}
            >
              <span className="relative inline-flex">
                {item.icon}
                {isTradeSignals && (
                  <span className="absolute -right-4 -top-2 rounded-full border border-violet-700/50 bg-violet-700/30 px-1 text-[8px] font-semibold leading-3 text-violet-300">
                    Live
                  </span>
                )}
                {countBadge !== null && (
                  <span className="absolute -right-2 -top-1 min-w-[1rem] rounded-full bg-violet-700 px-1 text-center text-[9px] leading-4 text-violet-100 tabular-nums">
                    {countBadge}
                  </span>
                )}
              </span>
              <span className="max-w-[4.25rem] truncate">{item.label}</span>
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => setMobileMoreOpen(open => !open)}
          aria-expanded={mobileMoreOpen}
          title="More"
          className={`mobile-nav-item min-w-[4.25rem] flex flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2 text-[11px] font-semibold transition-colors ${
            mobileMoreOpen || mobileMoreActive
              ? 'bg-violet-600/20 text-violet-300 border-violet-700/50'
              : 'text-gray-400 border-transparent hover:bg-gray-800 hover:text-gray-200'
          }`}
        >
          <MoreHorizontal size={18} />
          <span>More</span>
        </button>
      </div>
    </nav>

      </>
    ) : (
      <>
        {phoneMenuOpen && (
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-[60] bg-black/25 xl:hidden"
            onClick={() => setPhoneMenuOpen(false)}
          />
        )}
        <div className="xl:hidden fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] z-[70]">
          {phoneMenuOpen && (
            <div className="mobile-more-menu absolute bottom-full right-0 mb-3 w-[min(21rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl shadow-black/40">
              <div className="border-b border-gray-800 px-4 py-3">
                <div className="text-sm font-semibold text-white">Menu</div>
                <div className="text-xs text-gray-500">Navigate, theme, and account</div>
              </div>
              <div className="max-h-[70svh] overflow-y-auto overscroll-contain p-3">
                <div className="grid grid-cols-2 gap-2">
                  {[...visibleMobilePrimaryItems, ...visibleMobileMoreItems].map(item => {
                    const active = page === item.id
                    const isTradeSignals = item.id === 'trade-signals'
                    const countBadge = typeof item.badge === 'number' && item.badge > 0 ? item.badge : null
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleMobileNavigate(item.id)}
                        title={item.label}
                        className={`mobile-more-item relative flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-semibold transition-colors touch-manipulation ${
                          active
                            ? 'border-violet-700/50 bg-violet-600/20 text-violet-300'
                            : 'border-gray-800 bg-gray-800/60 text-gray-300 hover:border-gray-700 hover:bg-gray-800'
                        }`}
                      >
                        <span className="shrink-0">{item.icon}</span>
                        <span className="min-w-0 truncate">{item.label}</span>
                        {isTradeSignals && (
                          <span className="shrink-0 ml-auto rounded-full border border-violet-700/50 bg-violet-700/30 px-1.5 py-0.5 text-[9px] font-semibold leading-none text-violet-300">
                            Live
                          </span>
                        )}
                        {countBadge !== null && (
                          <span className="shrink-0 ml-auto min-w-[1.15rem] rounded-full bg-violet-700 px-1 text-center text-[9px] leading-4 text-violet-100 tabular-nums">
                            {countBadge}
                          </span>
                        )}
                      </button>
                    )
                  })}
                  <button
                    type="button"
                    onClick={() => {
                      toggleTheme()
                      setPhoneMenuOpen(false)
                    }}
                    title={isLight ? 'Dark theme' : 'Light theme'}
                    className="mobile-more-item flex items-center gap-2 rounded-xl border border-gray-800 bg-gray-800/60 px-3 py-2.5 text-left text-sm font-semibold text-gray-300 transition-colors hover:border-gray-700 hover:bg-gray-800"
                  >
                    {isLight ? <Moon size={18} className="shrink-0" /> : <Sun size={18} className="shrink-0" />}
                    <span>{isLight ? 'Dark theme' : 'Light theme'}</span>
                  </button>
                  {user && (
                    <button
                      type="button"
                      onClick={() => {
                        logout()
                        setPhoneMenuOpen(false)
                      }}
                      title="Sign out"
                      className="mobile-more-item flex items-center gap-2 rounded-xl border border-gray-800 bg-gray-800/60 px-3 py-2.5 text-left text-sm font-semibold text-gray-300 transition-colors hover:border-red-800 hover:bg-red-900/20 hover:text-red-300"
                    >
                      <LogOut size={18} className="shrink-0" />
                      <span>Sign out</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => setPhoneMenuOpen(open => !open)}
            aria-expanded={phoneMenuOpen}
            title="Menu"
            className="mobile-floating-menu-button flex h-14 min-w-14 items-center justify-center gap-2 rounded-full border border-violet-700/60 bg-violet-600 px-4 text-sm font-semibold text-white shadow-2xl shadow-violet-950/30"
          >
            <Menu size={20} />
            <span>Menu</span>
          </button>
        </div>
      </>
    )}
    </>
  )
}
