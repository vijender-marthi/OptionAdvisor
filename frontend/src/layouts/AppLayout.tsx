import type { ReactNode } from 'react'
import Sidebar from '../components/Sidebar'
import CopyrightFooter from '../components/CopyrightFooter'
import FirstLoginHelpModal from '../components/FirstLoginHelpModal'

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell font-sans flex h-[100svh] max-h-[100dvh] overflow-hidden bg-gray-950 text-gray-100">
      <Sidebar />
      <main className="app-main-scroll h-full min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-6 sm:pb-24 xl:pb-0 [-webkit-overflow-scrolling:touch]">
        {children}
        <CopyrightFooter />
      </main>
      <FirstLoginHelpModal />
    </div>
  )
}
