import { useState } from 'react'
import {
  TrendingUp, Star, Briefcase, LogOut, ChevronLeft, ChevronRight,
  User, BarChart2, HelpCircle, Brain, ShieldCheck, Activity, Bell, Settings, Atom,
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
  const { page, navigate, user, logout, watchlist, portfolio, isMarketHours, unreadAlertCount } = useApp()
  const [collapsed, setCollapsed] = useState(false)

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

  return (
    <aside className={`${w} h-screen bg-gray-900 border-r border-gray-800 flex flex-col transition-all duration-200 shrink-0 overflow-hidden`}>
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
              <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-600">
                {group.label}
              </div>
            )}
            {collapsed && <div className="border-t border-gray-800 my-1" />}
            <div className="space-y-0.5">
              {group.items.map(item => {
                const active = page === item.id
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
                        {item.badge !== undefined && (
                          <span className="bg-violet-700 text-violet-100 text-[11px] font-semibold px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center leading-none">
                            {item.badge}
                          </span>
                        )}
                      </>
                    )}
                    {collapsed && item.badge !== undefined && (
                      <span className="absolute top-1 right-1 w-2 h-2 bg-violet-500 rounded-full" />
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
  )
}
