import { useCallback, useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { useApp } from '../contexts/AppContext'
import HelpPage from '../pages/HelpPage'

export default function HelpModal() {
  const { helpOpen, setHelpOpen } = useApp()
  const innerRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setHelpOpen(false), [setHelpOpen])

  useEffect(() => {
    if (!helpOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [helpOpen, close])

  if (!helpOpen) return null

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-hidden">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={close} />
      <div
        ref={innerRef}
        className="relative mt-4 mb-4 w-[min(80rem,calc(100vw-2rem))] max-h-[calc(100svh-2rem)] overflow-y-auto rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl shadow-black/50"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-800 bg-gray-900/95 backdrop-blur-sm px-4 py-3 rounded-t-2xl">
          <h2 className="text-sm font-bold text-white">Help & Documentation</h2>
          <button
            type="button"
            onClick={close}
            className="rounded-lg p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
            aria-label="Close help"
          >
            <X size={20} />
          </button>
        </div>
        <div className="p-4">
          <HelpPage embedded />
        </div>
      </div>
    </div>
  )
}
