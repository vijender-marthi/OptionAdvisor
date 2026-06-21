/**
 * Global exit-signal overlay. Polls /api/exit-signals on an interval and, for any
 * CRITICAL signal on a held position, throws a screen-covering modal with an
 * audio alert that must be explicitly acknowledged. Mirrors the spec's
 * "impossible to miss" exit alert. Server-side alerts (Alert Center) fire in
 * parallel so the signal isn't lost when the app is closed.
 *
 * Acknowledgment is persisted in two layers:
 *   1. localStorage — survives page refresh within the same session day
 *   2. POST /api/exit-signals/acknowledge — server-side filter stops re-firing
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertOctagon, X } from 'lucide-react'
import { fetchExitSignals, acknowledgeExitSignal, type ExitSignal } from '../api/client'
import { ROUTES } from '../routing/routes'

const POLL_MS = 45_000
const ACK_STORAGE_KEY = 'oa_exit_signal_acked'
const sigKey = (s: ExitSignal) => `${new Date().toISOString().slice(0, 10)}|${s.ticker}|${s.code}`

function loadAckedSet(): Set<string> {
  try {
    const raw = localStorage.getItem(ACK_STORAGE_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as string[]
    return new Set(parsed)
  } catch {
    return new Set()
  }
}

function saveAckedSet(s: Set<string>) {
  try {
    localStorage.setItem(ACK_STORAGE_KEY, JSON.stringify([...s]))
  } catch { /* ignore quota errors */ }
}

function beep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.type = 'square'; osc.frequency.value = 880
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5)
    osc.start(); osc.stop(ctx.currentTime + 0.55)
    osc.onended = () => ctx.close().catch(() => {})
  } catch { /* audio unavailable — modal still shows */ }
}

export default function ExitSignalOverlay() {
  const navigate = useNavigate()
  const [active, setActive] = useState<ExitSignal | null>(null)
  const ackedRef = useRef<Set<string>>(loadAckedSet())

  const poll = useCallback(async () => {
    let signals: ExitSignal[]
    try {
      signals = await fetchExitSignals()
    } catch {
      return // not authed / no access / network — silent
    }
    const critical = signals.filter(s => s.severity === 'critical' && !ackedRef.current.has(sigKey(s)))
    if (critical.length === 0) return
    setActive(prev => {
      if (prev) return prev // already showing one; don't stack
      beep()
      // Best-effort push notification (in addition to the modal)
      try {
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(`🚨 EXIT ${critical[0].ticker}`, { body: critical[0].reason })
        }
      } catch { /* ignore */ }
      return critical[0]
    })
  }, [])

  useEffect(() => {
    // Ask once for notification permission (non-blocking)
    try {
      if ('Notification' in window && Notification.permission === 'default') {
        void Notification.requestPermission()
      }
    } catch { /* ignore */ }

    void poll()
    const id = setInterval(() => { if (!document.hidden) void poll() }, POLL_MS)
    return () => clearInterval(id)
  }, [poll])

  if (!active) return null

  const acknowledge = () => {
    const key = sigKey(active)
    ackedRef.current.add(key)
    saveAckedSet(ackedRef.current)
    // Fire-and-forget backend ack so the server stops returning this signal
    void acknowledgeExitSignal(active.ticker, active.code).catch(() => {})
    setActive(null)
  }
  const closePosition = () => {
    const key = sigKey(active)
    ackedRef.current.add(key)
    saveAckedSet(ackedRef.current)
    void acknowledgeExitSignal(active.ticker, active.code).catch(() => {})
    setActive(null)
    navigate(ROUTES.positions ?? '/positions')
  }

  const loss = active.pnl_estimate < 0

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border-2 border-rose-500 bg-slate-900 shadow-2xl">
        <div className="flex items-center gap-2 bg-rose-600 px-5 py-3 text-white">
          <AlertOctagon className="animate-pulse" size={22} />
          <span className="text-lg font-extrabold tracking-tight">EXIT SIGNAL — {active.ticker}</span>
          <button onClick={acknowledge} className="ml-auto rounded p-1 hover:bg-white/20" aria-label="Dismiss">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4 text-slate-100">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wide text-rose-300">Reason</div>
            <div className="text-sm font-semibold">{active.reason}</div>
          </div>

          <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-800/70 p-3 font-mono text-sm">
            <div>
              <div className="text-[10px] uppercase text-slate-400">Current price</div>
              <div className="font-bold">${active.current_price?.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-slate-400">Est. P&amp;L</div>
              <div className={`font-bold ${loss ? 'text-rose-400' : 'text-emerald-400'}`}>
                {active.pnl_estimate >= 0 ? '+' : ''}${active.pnl_estimate.toFixed(2)}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2">
            <div className="text-[11px] font-bold uppercase tracking-wide text-rose-300">Recommended action</div>
            <div className="text-sm font-bold text-rose-200">{active.recommended_action}</div>
          </div>

          <div className="flex gap-2 pt-1">
            <button onClick={closePosition}
              className="flex-1 rounded-lg bg-rose-600 px-3 py-2.5 text-sm font-bold text-white hover:bg-rose-500">
              Close Position
            </button>
            <button onClick={acknowledge}
              className="rounded-lg border border-slate-600 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-800">
              Acknowledge
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
