import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  TrendingUp, Briefcase, LogOut, ChevronLeft, ChevronRight,
  User, FlaskConical, Activity, Bell, Settings, SatelliteDish,
  Moon, Sun, Menu, BookOpen, Zap, LayoutDashboard, Search, Radar,
  BrainCircuit, HelpCircle, ListTodo, Eye, Bot, Monitor,
} from 'lucide-react'
import type { Page, UserRole } from '../types'
import { useApp } from '../contexts/AppContext'
import { normalizeUserRole, roleLabel } from '../permissions'
import { pageToLocation } from '../routing/paths'
import ThemeToggle from './ThemeToggle'
import BetaProductTag from './BetaProductTag'

type ProfileRole = 'user' | 'admin' | 'super_user' | 'day' | 'swing' | 'finance'

function profileRole(role: UserRole | undefined | null): ProfileRole {
  if (!role) return 'user'
  const r = normalizeUserRole(role)
  if (r === 'admin' || r === 'super_user' || r === 'day' || r === 'swing' || r === 'finance') return r
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
  super_user: {
    card:
      'sidebar-profile-card sidebar-profile-super_user bg-purple-950/45 border border-purple-600/40 ring-1 ring-inset ring-purple-400/15',
    avatar: 'bg-purple-600',
    name: 'sidebar-profile-name text-purple-50',
    email: 'sidebar-profile-email text-purple-200/65',
    logout: 'sidebar-profile-logout text-purple-200/80 hover:text-red-400',
    roleTagClass:
      'sidebar-profile-role-tag text-[10px] font-semibold uppercase tracking-wide text-purple-300/95',
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
  day: {
    card:
      'sidebar-profile-card sidebar-profile-day bg-orange-950/45 border border-orange-600/40 ring-1 ring-inset ring-orange-400/15',
    avatar: 'bg-orange-600',
    name: 'sidebar-profile-name text-orange-50',
    email: 'sidebar-profile-email text-orange-200/65',
    logout: 'sidebar-profile-logout text-orange-200/80 hover:text-red-400',
    roleTagClass:
      'sidebar-profile-role-tag text-[10px] font-semibold uppercase tracking-wide text-orange-300/95',
  },
  swing: {
    card:
      'sidebar-profile-card sidebar-profile-swing bg-blue-950/45 border border-blue-600/40 ring-1 ring-inset ring-blue-400/15',
    avatar: 'bg-blue-600',
    name: 'sidebar-profile-name text-blue-50',
    email: 'sidebar-profile-email text-blue-200/65',
    logout: 'sidebar-profile-logout text-blue-200/80 hover:text-red-400',
    roleTagClass:
      'sidebar-profile-role-tag text-[10px] font-semibold uppercase tracking-wide text-blue-300/95',
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

/** Phone + tablet: transparent shell + floating capsule (`.mobile-dock-pill` in index.css). */
const MOBILE_BOTTOM_NAV_SHELL_PHONE =
  'mobile-bottom-nav-shell fixed inset-x-0 bottom-0 z-[70] pointer-events-none pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-3 px-5 sm:hidden'
const MOBILE_BOTTOM_NAV_SHELL_TABLET =
  'mobile-bottom-nav-shell fixed inset-x-0 bottom-0 z-40 pointer-events-none pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-3 px-8 sm:px-10 hidden sm:block xl:hidden'

export default function Sidebar() {
  const { page, navigate, user, logout, portfolio, isMarketHours, unreadAlertCount, theme, toggleTheme, journalEntryCount, canAccessPage, setHelpOpen } = useApp()
  const [collapsed, setCollapsed] = useState(false)
  const [phoneMenuOpen, setPhoneMenuOpen] = useState(false)

  const openPositions = portfolio.filter(p => p.status === 'open').length
  const pr = user ? profileRole(user.role) : 'user'
  const pf = PROFILE[pr]

  const navGroups: NavGroup[] = [
    {
      label: 'Home',
      items: [
        { id: 'desk', label: 'Trade Desk', icon: <Monitor size={18} /> },
        { id: 'trade-command-center', label: 'Trade Command Center', icon: <LayoutDashboard size={18} /> },
        { id: 'watchlist', label: 'Signal Feed', icon: <SatelliteDish size={18} /> },
        { id: 'my-tickers', label: 'My Tickers', icon: <ListTodo size={18} /> },
        { id: 'alert-center', label: 'Alert Center', icon: <Bell size={18} />, badge: unreadAlertCount || undefined },
        { id: 'positions', label: 'Positions Center', icon: <Briefcase size={18} />, badge: openPositions || undefined },
      ],
    },
    {
      label: 'Analyze',
      items: [
        { id: 'ticker', label: 'Strategy Finder', icon: <Search size={18} /> },
        { id: 'trade-signals', label: 'Trade Signals', icon: <Radar size={18} /> },
      ],
    },
    {
      label: 'Advanced Trades',
      items: [
        { id: 'day-trade', label: 'Day Trade', icon: <Zap size={18} /> },
        { id: 'active-trades', label: 'Track Intraday', icon: <Activity size={18} /> },
        { id: 'swing-trade', label: 'Swing Trade', icon: <TrendingUp size={18} /> },
        { id: 'auto-trade', label: 'Alpaca Trade', icon: <Bot size={18} /> },
      ],
    },
    {
      label: 'Discovery',
      items: [
        { id: 'ai-stocks', label: 'AI Stocks', icon: <BrainCircuit size={18} /> },
        { id: 'q-radar', label: 'Quantum', icon: <Radar size={18} /> },
      ],
    },
    {
      label: 'Tools',
      items: [
    { id: 'journal', label: 'Trade Journal', icon: <BookOpen size={18} />, badge: journalEntryCount || undefined },
    { id: 'backtest', label: 'Backtest Lab', icon: <FlaskConical size={18} /> },
      ],
    },
    {
      label: 'Support',
      items: [
        { id: 'help', label: 'Help', icon: <HelpCircle size={18} /> },
        { id: 'settings', label: 'Settings', icon: <Settings size={18} /> },
      ],
    },
  ]

  const w = collapsed ? 'w-16' : 'w-56'
  /** Bottom rail (< xl docked): fixed five tabs — order matches product priority. */
  const mobilePrimaryItems: NavItem[] = [
    { id: 'trade-command-center', label: 'Home', icon: <LayoutDashboard size={23} /> },
    { id: 'positions', label: 'Positions', icon: <Briefcase size={23} />, badge: openPositions || undefined },
    { id: 'watchlist', label: 'Signal Feed', icon: <SatelliteDish size={23} /> },
    { id: 'alert-center', label: 'Alerts', icon: <Bell size={23} />, badge: unreadAlertCount || undefined },
    { id: 'ticker', label: 'Analyze', icon: <Search size={23} /> },
  ]
  const mobileMoreItems: NavItem[] = [
    { id: 'my-tickers', label: 'My Tickers', icon: <ListTodo size={18} /> },
    { id: 'trade-signals', label: 'Trade Signals', icon: <Radar size={18} /> },
    { id: 'day-trade', label: 'Day Trade Engine', icon: <Zap size={18} /> },
    { id: 'active-trades', label: 'Track Intraday', icon: <Activity size={18} /> },
    { id: 'swing-trade', label: 'Swing Trade', icon: <TrendingUp size={18} /> },
    { id: 'auto-trade', label: 'Alpaca Trade', icon: <Bot size={18} /> },
    { id: 'ai-stocks', label: 'AI Stocks', icon: <BrainCircuit size={18} /> },
    { id: 'q-radar', label: 'Quantum', icon: <Radar size={18} /> },
    { id: 'journal', label: 'Trade Journal', icon: <BookOpen size={18} />, badge: journalEntryCount || undefined },
    { id: 'backtest', label: 'Backtest Lab', icon: <FlaskConical size={18} /> },
    { id: 'help', label: 'Help', icon: <HelpCircle size={18} /> },
    { id: 'settings', label: 'Settings', icon: <Settings size={18} /> },
  ]

  const visibleNavGroups = navGroups
    .map(g => ({ ...g, items: g.items.filter(i => canAccessPage(i.id)) }))
    .filter(g => g.items.length > 0)
  const visibleMobilePrimaryItems = mobilePrimaryItems.filter(i => canAccessPage(i.id))
  const visibleMobileMoreItems = mobileMoreItems.filter(i => canAccessPage(i.id))
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
  }, [dockBottomMobileNav])

  const handleMobileNavigate = (target: Page) => {
    if (target === 'help') {
      setHelpOpen(true)
    } else {
      navigate(target)
    }
    setPhoneMenuOpen(false)
  }

  const mobileDockGrid = (
    <div className="pointer-events-auto mx-auto w-full max-w-2xl">
      <div className="mobile-dock-pill overflow-hidden rounded-full border">
        <div className="mobile-nav-scroll flex w-full touch-manipulation flex-nowrap items-stretch gap-0 px-1 py-1 sm:px-2 sm:py-1.5">
          {visibleMobilePrimaryItems.map(item => {
            const active = page === item.id
            const countBadge = typeof item.badge === 'number' && item.badge > 0 ? item.badge : null
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleMobileNavigate(item.id)}
                title={item.label}
                className={`mobile-nav-item flex min-h-[48px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-full border px-0.5 py-2 text-[10px] font-semibold leading-tight tracking-tight transition-all duration-200 ease-out sm:min-h-[52px] sm:py-2.5 ${
                  active
                    ? 'mobile-nav-glass-active'
                    : 'border-transparent dark:hover:bg-gray-800/75 dark:hover:text-gray-100'
                }`}
              >
                <span className="relative inline-flex shrink-0">
                  {item.id === 'ticker' ? (
                    <span className="mobile-dock-finder-icon inline-flex">{item.icon}</span>
                  ) : (
                    item.icon
                  )}
                  {countBadge !== null && (
                    <span className="absolute -right-2 -top-1 min-w-[0.875rem] rounded-full bg-violet-700 px-0.5 text-center text-[8px] font-semibold leading-[14px] text-violet-100 tabular-nums">
                      {countBadge}
                    </span>
                  )}
                </span>
                <span className="max-w-full truncate text-center">{item.label}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )

  return (
    <>
    <aside className={`${w} hidden xl:flex font-sans h-full min-h-0 shrink-0 bg-gray-900 border-r border-gray-800 flex-col transition-all duration-200 overflow-hidden`}>
      {/* Logo */}
      <div className={`flex items-center gap-2.5 px-3 py-2.5 border-b border-gray-800 shrink-0 ${collapsed ? 'justify-center' : ''}`}>
        <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center shrink-0">
          <LayoutDashboard size={16} className="text-white" />
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
                const countBadge = typeof item.badge === 'number' && item.badge > 0 ? item.badge : null
                const isHelp = item.id === 'help'
                const linkTo = pageToLocation(item.id)
                const cls = `relative isolate w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] font-semibold transition-all touch-manipulation
                  ${active
                    ? 'bg-violet-600/20 text-violet-300 border border-violet-700/50'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200 border border-transparent'
                  } ${collapsed ? 'justify-center' : ''}`
                const inner = (
                  <>
                    <span className="shrink-0">{item.icon}</span>
                    {!collapsed && (
                      <>
                        <span className="min-w-0 flex-1 text-left truncate">{item.label}</span>
                        {item.id === 'ticker' && (
                          <span className="shrink-0 flex items-center gap-1 rounded-full border border-emerald-600/40 bg-emerald-950/40 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-emerald-400">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            ACTIVE
                          </span>
                        )}
                        {countBadge !== null && (
                          <span className="shrink-0 bg-violet-700 text-violet-100 text-[11px] font-semibold px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center leading-none tabular-nums">
                            {countBadge}
                          </span>
                        )}
                      </>
                    )}
                    {collapsed && countBadge !== null && (
                      <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-violet-500" />
                    )}
                  </>
                )
                if (isHelp) {
                  return (
                    <button key={item.id} type="button" onClick={() => setHelpOpen(true)} title={item.label} className={cls}>
                      {inner}
                    </button>
                  )
                }
                return (
                  <Link key={item.id} to={linkTo} title={item.label} className={cls}>
                    {inner}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom: theme · profile · market status */}
      <div className="border-t border-gray-800 p-1.5 space-y-0.5 shrink-0">
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
      <nav className={MOBILE_BOTTOM_NAV_SHELL_PHONE} aria-label="Primary">
        {mobileDockGrid}
      </nav>

      <nav className={MOBILE_BOTTOM_NAV_SHELL_TABLET} aria-label="Primary">
        {mobileDockGrid}
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
              <div className="space-y-3 border-b border-gray-800 px-4 py-3">
                {user && (
                  <div
                    data-profile-role={pr}
                    className={`mobile-floating-menu-profile flex items-center gap-2.5 rounded-xl px-3 py-2.5 ${pf.card}`}
                  >
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${pf.avatar}`}>
                      <User size={16} className="text-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                      {pf.roleTagClass && (
                        <div className={pf.roleTagClass}>{roleLabel(normalizeUserRole(user.role))}</div>
                      )}
                      <div className={`truncate text-sm font-semibold ${pf.name}`}>{user.name}</div>
                      <div className={`truncate text-[11px] font-medium ${pf.email}`}>{user.email}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        logout()
                        setPhoneMenuOpen(false)
                      }}
                      title="Sign out"
                      className={`shrink-0 rounded-lg p-1.5 transition-colors ${pf.logout}`}
                    >
                      <LogOut size={16} />
                    </button>
                  </div>
                )}
                <div>
                  <div className="text-sm font-semibold text-white">Menu</div>
                  <div className="text-xs text-gray-500">Shortcuts, theme, and more</div>
                </div>
              </div>
              <div className="max-h-[70svh] overflow-y-auto overscroll-contain p-3">
                <div className="grid grid-cols-2 gap-2">
                  {[...visibleMobilePrimaryItems, ...visibleMobileMoreItems].map(item => {
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
                      setPhoneMenuOpen(false)
                    }}
                    title={isLight ? 'Dark theme' : 'Light theme'}
                    className="mobile-more-item flex items-center gap-2 rounded-xl border border-gray-800 bg-gray-800/60 px-3 py-2.5 text-left text-sm font-semibold text-gray-300 transition-colors hover:border-gray-700 hover:bg-gray-800"
                  >
                    {isLight ? <Moon size={18} className="shrink-0" /> : <Sun size={18} className="shrink-0" />}
                    <span>{isLight ? 'Dark theme' : 'Light theme'}</span>
                  </button>
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
