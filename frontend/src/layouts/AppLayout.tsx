import type { ReactNode } from 'react'
import Sidebar from '../components/Sidebar'
import CopyrightFooter from '../components/CopyrightFooter'

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-gray-950 text-gray-100">
      <Sidebar />
      <main className="h-screen flex-1 overflow-y-auto">
        {children}
        <CopyrightFooter />
      </main>
    </div>
  )
}
