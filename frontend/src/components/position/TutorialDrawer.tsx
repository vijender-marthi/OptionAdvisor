import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import type { PositionTutorial } from '../../types/positionWorkspace'

const unavailable = (value: string | null | undefined) => value || 'Unavailable'

export default function TutorialDrawer({ tutorial, onClose }: { tutorial: PositionTutorial | null; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[120] flex justify-end" role="dialog" aria-modal="true" aria-labelledby="position-tutorial-title">
      <button type="button" aria-label="Close tutorial" className="absolute inset-0 cursor-default bg-black/55" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl dark:border-white/[0.07] dark:bg-slate-950">
        <header className="flex items-start justify-between border-b border-slate-200 p-5 dark:border-white/[0.07]">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-cyan-700 dark:text-cyan-300">Position workspace</p>
            <h2 id="position-tutorial-title" className="mt-1 text-lg font-semibold text-slate-900 dark:text-gray-100">{unavailable(tutorial?.title)}</h2>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} className="rounded-md p-2 text-slate-600 hover:bg-slate-100 dark:text-gray-300 dark:hover:bg-white/[0.06]" aria-label="Close tutorial">
            <X size={18} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <p className="text-sm leading-6 text-slate-600 dark:text-gray-300">{unavailable(tutorial?.summary)}</p>
          <ol className="mt-6 space-y-4">
            {(tutorial?.steps ?? []).length === 0 ? <li className="text-sm text-slate-500 dark:text-gray-400">Unavailable</li> : tutorial?.steps?.map((step, index) => (
              <li key={`${step.title}-${index}`} className="border-l-2 border-cyan-500 pl-4">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-gray-100">{unavailable(step.title)}</h3>
                <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-gray-300">{unavailable(step.body)}</p>
              </li>
            ))}
          </ol>
        </div>
      </aside>
    </div>
  )
}
