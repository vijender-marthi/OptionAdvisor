import { Moon, Sun } from 'lucide-react'
import { useApp } from '../contexts/AppContext'

interface ThemeToggleProps {
  collapsed?: boolean
  className?: string
}

export default function ThemeToggle({ collapsed = false, className = '' }: ThemeToggleProps) {
  const { theme, toggleTheme } = useApp()
  const isLight = theme === 'light'
  const label = isLight ? 'Switch to dark theme' : 'Switch to light theme'

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={collapsed ? label : undefined}
      aria-label={label}
      aria-pressed={isLight}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border border-gray-700 bg-gray-800 text-sm font-semibold tracking-tight text-gray-400 hover:bg-gray-700 hover:text-gray-200 transition-colors ${collapsed ? 'justify-center' : ''} ${className}`}
    >
      {isLight ? <Moon size={18} className="shrink-0" /> : <Sun size={18} className="shrink-0" />}
      {!collapsed && <span>{isLight ? 'Dark theme' : 'Light theme'}</span>}
    </button>
  )
}
