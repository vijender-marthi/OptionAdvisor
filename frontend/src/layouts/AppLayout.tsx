import type { ReactNode } from 'react'
import Sidebar from '../components/Sidebar'
import CopyrightFooter from '../components/CopyrightFooter'
import AdvisoryDisclaimerModal from '../components/AdvisoryDisclaimerModal'
import FirstLoginHelpModal from '../components/FirstLoginHelpModal'

import { useApp } from '../contexts/AppContext'
import { X } from 'lucide-react'

function WatchlistNoticeBanner() {
  const { watchlistNotice, clearWatchlistNotice } = useApp()
  if (!watchlistNotice) return null
  return (
    <div
      className="sticky top-0 z-40 flex items-start sm:items-center justify-between gap-3 px-4 py-2.5 border-b border-amber-300 bg-amber-100 text-amber-950 text-sm shadow-sm dark:border-amber-800/80 dark:bg-amber-950/95 dark:text-amber-100"
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

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell font-sans flex h-[100svh] max-h-[100dvh] overflow-hidden bg-gray-950 text-gray-100">
      <Sidebar />
      <main className="app-main-scroll h-full min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-24 xl:pb-0 [-webkit-overflow-scrolling:touch]">
        <WatchlistNoticeBanner />
        {children}
        <CopyrightFooter />
      </main>
      <AdvisoryDisclaimerModal />
      <FirstLoginHelpModal />
    </div>
  )
}
