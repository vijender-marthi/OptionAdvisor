import type { ReactNode } from 'react'
import Sidebar from '../components/Sidebar'
import CopyrightFooter from '../components/CopyrightFooter'
import FirstLoginHelpModal from '../components/FirstLoginHelpModal'

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="font-sans flex h-[100dvh] overflow-hidden bg-gray-950 text-gray-100">
      <Sidebar />
      <main className="h-[100dvh] flex-1 overflow-y-auto pb-24 xl:pb-0">
        {children}
        <CopyrightFooter />
      </main>
      <FirstLoginHelpModal />
    </div>
  )
}
