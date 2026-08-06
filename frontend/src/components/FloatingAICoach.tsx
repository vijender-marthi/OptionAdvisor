import { useCallback, useRef, useState } from 'react'
import { MessageSquare, X, GripHorizontal, Sparkles } from 'lucide-react'
import AICoachChat from './AICoachChat'

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Global floating AI Coach: a bottom-right launcher that opens a draggable panel
 * sized to ~30% of the screen width on the right. Mounted once in AppLayout. */
export default function FloatingAICoach() {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 380, h: 560 })
  const drag = useRef<{ px: number; py: number; bx: number; by: number } | null>(null)

  const openPanel = useCallback(() => {
    const w = clamp(Math.round(window.innerWidth * 0.30), 320, 620)
    const h = clamp(Math.round(window.innerHeight * 0.80), 380, window.innerHeight - 24)
    setSize({ w, h })
    setPos({ x: window.innerWidth - w - 16, y: window.innerHeight - h - 16 })
    setOpen(true)
  }, [])

  const onDragMove = useCallback((e: PointerEvent) => {
    const d = drag.current
    if (!d) return
    setPos({
      x: clamp(d.bx + (e.clientX - d.px), 8, window.innerWidth - size.w - 8),
      y: clamp(d.by + (e.clientY - d.py), 8, window.innerHeight - 60),
    })
  }, [size.w])

  const onDragEnd = useCallback(() => {
    drag.current = null
    window.removeEventListener('pointermove', onDragMove)
    window.removeEventListener('pointerup', onDragEnd)
  }, [onDragMove])

  const onDragStart = useCallback((e: React.PointerEvent) => {
    drag.current = { px: e.clientX, py: e.clientY, bx: pos.x, by: pos.y }
    window.addEventListener('pointermove', onDragMove)
    window.addEventListener('pointerup', onDragEnd)
  }, [pos.x, pos.y, onDragMove, onDragEnd])

  if (!open) {
    return (
      <button
        type="button"
        onClick={openPanel}
        aria-label="Open AI Coach"
        className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-violet-600 text-white shadow-lg shadow-violet-600/30 transition-transform hover:scale-105 hover:bg-violet-500"
      >
        <MessageSquare size={20} />
      </button>
    )
  }

  return (
    <div
      className="fixed z-50 flex flex-col overflow-hidden rounded-2xl border border-border bg-surface-canvas shadow-2xl"
      style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}
    >
      <div
        onPointerDown={onDragStart}
        className="flex cursor-grab items-center gap-2 border-b border-border bg-surface-muted px-3 py-2 active:cursor-grabbing"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-violet-600 text-white"><Sparkles size={13} /></span>
        <span className="text-sm font-black text-text-primary">AI Coach</span>
        <GripHorizontal size={15} className="mx-auto text-text-tertiary" />
        <button type="button" onClick={() => setOpen(false)} aria-label="Close AI Coach" className="rounded-md p-1 text-text-tertiary hover:bg-surface-card hover:text-text-primary">
          <X size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <AICoachChat />
      </div>
    </div>
  )
}
