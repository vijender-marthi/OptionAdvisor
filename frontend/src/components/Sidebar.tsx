import { useState } from 'react'
import {
  TrendingUp, Star, Briefcase, LogOut, ChevronLeft, ChevronRight,
  User, BarChart2, HelpCircle, Brain, ShieldCheck, Activity, Bell, Settings, Atom,
  MoreHorizontal, Moon, Sun, Menu,
} from 'lucide-react'
import type { Page } from '../types'
import { useApp } from '../contexts/AppContext'
import ThemeToggle from './ThemeToggle'

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

export default function Sidebar() {
  const { page, navigate, user, logout, watchlist, portfolio, isMarketHours, unreadAlertCount, theme, toggleTheme } = useApp()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false)
  const [phoneMenuOpen, setPhoneMenuOpen] = useState(false)

  const openPositions = portfolio.filter(p => p.status === 'open').length

  const navGroups: NavGroup[] = [
    {
      label: 'Discover',
      items: [
        { id: 'ai-stocks', label: 'AI Radar',  icon: <Brain size={18} /> },
        { id: 'q-radar',   label: 'Q Radar',   icon: <Atom  size={18} /> },
      ],
    },
    {
      label: 'Analyze',
      items: [
        { id: 'ticker',        label: 'Option Advisory', icon: <TrendingUp size={18} /> },
        { id: 'trade-signals', label: 'Trade Signals',   icon: <ShieldCheck size={18} /> },
      ],
    },
    {
      label: 'Track',
      items: [
        { id: 'watchlist', label: 'Watchlist', icon: <Star size={18} />,      badge: watchlist.length || undefined },
        { id: 'portfolio', label: 'Portfolio', icon: <Briefcase size={18} />, badge: openPositions || undefined },
        { id: 'alerts',    label: 'Alerts',    icon: <Bell size={18} />,      badge: unreadAlertCount || undefined },
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
    { id: 'ai-stocks', label: 'AI Radar', icon: <Brain size={18} /> },
    { id: 'q-radar',   label: 'Q Radar',  icon: <Atom size={18} /> },
    { id: 'settings',  label: 'Settings', icon: <Settings size={18} /> },
    { id: 'help',      label: 'Help',     icon: <HelpCircle size={18} /> },
  ]
  const mobileMoreActive = mobileMoreItems.some(item => item.id === page)
  const isLight = theme === 'light'

  const handleMobileNavigate = (target: Page) => {
    navigate(target)
    setMobileMoreOpen(false)
    setPhoneMenuOpen(false)
  }

  return (
    <>
    <aside className={`${w} hidden xl:flex font-sans h-[100dvh] bg-gray-900 border-r border-gray-800 flex-col transition-all duration-200 shrink-0 overflow-hidden`}>
      {/* Logo */}
      <div className={`flex items-center gap-2.5 px-4 py-4 border-b border-gray-800 shrink-0 ${collapsed ? 'justify-center' : ''}`}>
        <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center shrink-0">
          <BarChart2 size={16} className="text-white" />
        </div>
        {!collapsed && (
          <div>
            <div className="text-sm font-semibold text-white leading-tight">OptionAdvisor</div>
            <div className="text-[11px] text-gray-500 leading-tight">Systematic Engine v2</div>
          </div>
        )}
      </div>

      {/* Nav items */}
      <nav className="flex-1 min-h-0 overflow-y-auto py-3 px-2 space-y-4">
        {navGroups.map(group => (
          <div key={group.label}>
            {/* Group label — hidden when collapsed */}
            {!collapsed && (
              <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-600">
                {group.label}
              </div>
            )}
            {collapsed && <div className="border-t border-gray-800 my-1" />}
            <div className="space-y-0.5">
              {group.items.map(item => {
                const active = page === item.id
                const isTradeSignals = item.id === 'trade-signals'
                return (
                  <button
                    key={item.id}
                    onClick={() => navigate(item.id)}
                    title={collapsed ? item.label : undefined}
                    className={`relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all
                      ${active
                        ? 'bg-violet-600/20 text-violet-300 border border-violet-700/50'
                        : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200 border border-transparent'
                      } ${collapsed ? 'justify-center' : ''}`}
                  >
                    <span className="shrink-0">{item.icon}</span>
                    {!collapsed && (
                      <>
                        <span className="flex-1 text-left">{item.label}</span>
                        {isTradeSignals && (
                          <span className="bg-violet-700/30 text-violet-300 border border-violet-700/50 text-[10px] font-semibold px-1.5 py-0.5 rounded-full leading-none">
                            Live
                          </span>
                        )}
                        {item.badge !== undefined && (
                          <span className="bg-violet-700 text-violet-100 text-[11px] font-semibold px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center leading-none">
                            {item.badge}
                          </span>
                        )}
                      </>
                    )}
                    {collapsed && (item.badge !== undefined || isTradeSignals) && (
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
      <div className="border-t border-gray-800 p-2 space-y-1 shrink-0">
        <button
          onClick={() => navigate('settings')}
          title={collapsed ? 'Settings' : undefined}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all
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
          title={collapsed ? 'Help' : undefined}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all
            ${page === 'help'
              ? 'bg-violet-600/20 text-violet-300 border border-violet-700/50'
              : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300 border border-transparent'
            } ${collapsed ? 'justify-center' : ''}`}
        >
          <HelpCircle size={18} className="shrink-0" />
          {!collapsed && <span>Help</span>}
        </button>

        <ThemeToggle collapsed={collapsed} className="w-full" />

        {user && (
          <div className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-gray-800/60 ${collapsed ? 'justify-center' : ''}`}>
            <div className="w-7 h-7 rounded-full bg-violet-700 flex items-center justify-center shrink-0">
              <User size={13} className="text-white" />
            </div>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-gray-200 truncate">{user.name}</div>
                <div className="text-[11px] font-medium text-gray-500 truncate">{user.email}</div>
              </div>
            )}
            {!collapsed && (
              <button onClick={logout} title="Sign out" className="text-gray-500 hover:text-red-400 transition-colors shrink-0">
                <LogOut size={14} />
              </button>
            )}
          </div>
        )}

        {/* Market hours indicator */}
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl ${collapsed ? 'justify-center' : ''}`}
          title={isMarketHours ? 'Market live — auto-refresh active (6 AM–4 PM PST)' : 'Market closed — auto-refresh paused'}>
          <Activity size={12} className={isMarketHours ? 'text-emerald-400 animate-pulse' : 'text-gray-700'} />
          {!collapsed && (
            <span className={`text-[11px] font-semibold ${isMarketHours ? 'text-emerald-400' : 'text-gray-700'}`}>
              {isMarketHours ? 'Market Live' : 'Market Closed'}
            </span>
          )}
        </div>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(c => !c)}
          className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold text-gray-600 hover:text-gray-400 transition-colors ${collapsed ? 'justify-center' : ''}`}
        >
          {collapsed ? <ChevronRight size={14} /> : <><ChevronLeft size={14} /><span>Collapse</span></>}
        </button>
      </div>
    </aside>

    {/* Phone-only floating menu maximizes vertical screen space on small devices. */}
    <div className="sm:hidden fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-50">
      {phoneMenuOpen && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 -z-10 bg-black/20"
            onClick={() => setPhoneMenuOpen(false)}
          />
          <div className="mobile-more-menu absolute bottom-full right-0 mb-3 w-[min(21rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl shadow-black/40">
            <div className="border-b border-gray-800 px-4 py-3">
              <div className="text-sm font-semibold text-white">Menu</div>
              <div className="text-xs text-gray-500">Navigate, theme, and account</div>
            </div>
            <div className="max-h-[70dvh] overflow-y-auto p-3">
              <div className="grid grid-cols-2 gap-2">
                {[...mobilePrimaryItems, ...mobileMoreItems].map(item => {
                  const active = page === item.id
                  const isTradeSignals = item.id === 'trade-signals'
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleMobileNavigate(item.id)}
                      className={`mobile-more-item relative flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-semibold transition-colors ${
                        active
                          ? 'border-violet-700/50 bg-violet-600/20 text-violet-300'
                          : 'border-gray-800 bg-gray-800/60 text-gray-300 hover:border-gray-700 hover:bg-gray-800'
                      }`}
                    >
                      <span className="shrink-0">{item.icon}</span>
                      <span className="min-w-0 truncate">{item.label}</span>
                      {isTradeSignals && (
                        <span className="ml-auto rounded-full border border-violet-700/50 bg-violet-700/30 px-1.5 py-0.5 text-[9px] font-semibold leading-none text-violet-300">
                          Live
                        </span>
                      )}
                      {item.badge !== undefined && (
                        <span className="ml-auto min-w-[1.15rem] rounded-full bg-violet-700 px-1 text-center text-[9px] leading-4 text-violet-100">
                          {item.badge}
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
                    className="mobile-more-item flex items-center gap-2 rounded-xl border border-gray-800 bg-gray-800/60 px-3 py-2.5 text-left text-sm font-semibold text-gray-300 transition-colors hover:border-red-800 hover:bg-red-900/20 hover:text-red-300"
                  >
                    <LogOut size={18} className="shrink-0" />
                    <span>Sign out</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
      <button
        type="button"
        onClick={() => setPhoneMenuOpen(open => !open)}
        aria-expanded={phoneMenuOpen}
        className="mobile-floating-menu-button flex h-14 min-w-14 items-center justify-center gap-2 rounded-full border border-violet-700/60 bg-violet-600 px-4 text-sm font-semibold text-white shadow-2xl shadow-violet-950/30"
      >
        <Menu size={20} />
        <span>Menu</span>
      </button>
    </div>

    {/* Tablet bottom navigation stays visible and centered. */}
    <nav className="mobile-bottom-nav hidden sm:block xl:hidden fixed inset-x-0 bottom-0 z-40 border-t border-gray-800 bg-gray-900/95 backdrop-blur supports-[backdrop-filter]:bg-gray-900/85">
      {mobileMoreOpen && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 -z-10 bg-black/20"
            onClick={() => setMobileMoreOpen(false)}
          />
          <div className="mobile-more-menu absolute bottom-full right-2 sm:right-1/2 sm:translate-x-1/2 mb-2 w-[min(22rem,calc(100vw-1rem))] overflow-hidden rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl shadow-black/40">
            <div className="border-b border-gray-800 px-4 py-3">
              <div className="text-sm font-semibold text-white">More</div>
              <div className="text-xs text-gray-500">Radar, settings, theme, and account</div>
            </div>
            <div className="grid grid-cols-2 gap-2 p-3">
              {mobileMoreItems.map(item => {
                const active = page === item.id
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleMobileNavigate(item.id)}
                    className={`mobile-more-item flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-semibold transition-colors ${
                      active
                        ? 'border-violet-700/50 bg-violet-600/20 text-violet-300'
                        : 'border-gray-800 bg-gray-800/60 text-gray-300 hover:border-gray-700 hover:bg-gray-800'
                    }`}
                  >
                    <span className="shrink-0">{item.icon}</span>
                    <span className="min-w-0 truncate">{item.label}</span>
                  </button>
                )
              })}
              <button
                type="button"
                onClick={() => {
                  toggleTheme()
                  setMobileMoreOpen(false)
                }}
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
                  className="mobile-more-item flex items-center gap-2 rounded-xl border border-gray-800 bg-gray-800/60 px-3 py-2.5 text-left text-sm font-semibold text-gray-300 transition-colors hover:border-red-800 hover:bg-red-900/20 hover:text-red-300"
                >
                  <LogOut size={18} className="shrink-0" />
                  <span>Sign out</span>
                </button>
              )}
            </div>
          </div>
        </>
      )}
      <div className="mobile-nav-scroll flex items-center gap-2 overflow-x-auto px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:justify-center">
        {mobilePrimaryItems.map(item => {
          const active = page === item.id
          const isTradeSignals = item.id === 'trade-signals'
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleMobileNavigate(item.id)}
              className={`mobile-nav-item min-w-[4.75rem] flex flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2 text-[11px] font-semibold transition-colors ${
                active
                  ? 'bg-violet-600/20 text-violet-300 border-violet-700/50'
                  : 'text-gray-400 border-transparent hover:bg-gray-800 hover:text-gray-200'
              }`}
            >
              <span className="relative">
                {item.icon}
                {isTradeSignals && (
                  <span className="absolute -right-4 -top-2 rounded-full border border-violet-700/50 bg-violet-700/30 px-1 text-[8px] font-semibold leading-3 text-violet-300">
                    Live
                  </span>
                )}
                {item.badge !== undefined && (
                  <span className="absolute -right-2 -top-1 min-w-[1rem] rounded-full bg-violet-700 px-1 text-[9px] leading-4 text-violet-100">
                    {item.badge}
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
  )
}
