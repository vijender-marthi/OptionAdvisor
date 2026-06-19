import { useEffect, useState, type ReactNode } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import CopyrightFooter from '../components/CopyrightFooter'
import AdvisoryDisclaimerModal from '../components/AdvisoryDisclaimerModal'
import FirstLoginHelpModal from '../components/FirstLoginHelpModal'
import HelpModal from '../components/HelpModal'
import MarketStrip from '../components/MarketStrip'
import ExitSignalOverlay from '../components/ExitSignalOverlay'

import { useApp } from '../contexts/AppContext'
import { X, Database } from 'lucide-react'

function WatchlistNoticeBanner() {
  const { watchlistNotice, clearWatchlistNotice } = useApp()
  if (!watchlistNotice) return null
  return (
    <div
      className="sticky top-0 z-40 flex items-start sm:items-center justify-between gap-3 px-4 py-2.5 border-b border-amber-300 bg-amber-100 text-amber-950 text-sm shadow-sm dark:border-amber-800/80 dark:bg-amber-950/95 dark:text-amber-200"
      role="status"
    >
      <span className="min-w-0 leading-snug">{watchlistNotice}</span>
      <button
        type="button"
        onClick={clearWatchlistNotice}
        className="shrink-0 rounded-md p-1 text-amber-800 hover:bg-amber-200/80 dark:text-amber-200 dark:hover:bg-amber-900/60 dark:hover:text-white"
        aria-label="Dismiss notice"
      >
        <X size={18} />
      </button>
    </div>
  )
}

function CacheTimestamp() {
  const { lastBgRefresh } = useApp()
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  if (!lastBgRefresh) return null
  const elapsed = now - lastBgRefresh
  const mins = Math.floor(elapsed / 60_000)
  const secs = Math.floor((elapsed % 60_000) / 1000)
  const label = mins > 0 ? `${mins}m ${secs}s ago` : `${secs}s ago`
  const stale = elapsed > 5 * 60_000

  return (
    <span
      className={`inline-flex items-center gap-1 fixed top-2 right-3 z-30 text-[10px] font-mono font-medium ${stale ? 'text-amber-500' : 'text-gray-500'}`}
      title={`Last cache refresh: ${new Date(lastBgRefresh).toLocaleString()}`}
    >
      <Database size={10} />
      {label}
    </span>
  )
}

export default function AppLayout({ children }: { children?: ReactNode }) {
  return (
    <div className="app-shell font-sans flex h-[100svh] max-h-[100dvh] overflow-hidden" style={{ backgroundColor: 'var(--surface-page)', color: 'var(--text-primary)' }}>
      <Sidebar />
      <main className="app-main-scroll h-full min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-[7rem] xl:pb-0 [-webkit-overflow-scrolling:touch]">
        <MarketStrip />
        <CacheTimestamp />
        <WatchlistNoticeBanner />
        {children ?? <Outlet />}
        <CopyrightFooter />
      </main>
      <AdvisoryDisclaimerModal />
      <FirstLoginHelpModal />
      <HelpModal />
      <ExitSignalOverlay />
    </div>
  )
}
