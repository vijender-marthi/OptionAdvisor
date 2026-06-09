import { useEffect, useRef, useState } from 'react'

interface Props {
  /** True when z2IsGo — triggers the window on mount / when it flips true */
  active: boolean
  ticker: string
  direction: 'CALL' | 'PUT'
  entryPrice: number | null
  stopPrice: number
  t1: number | null
  t2: number | null
}

type Phase = 'idle' | 'open' | 'expired' | 'entered'

// ── Audio helpers ────────────────────────────────────────────────────────────

function playEntryBeeps() {
  try {
    type WebkitAudio = { webkitAudioContext?: typeof AudioContext }
    const Ctx = window.AudioContext ?? (window as unknown as WebkitAudio).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const beep = (start: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0.25, start)
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.15)
      osc.start(start); osc.stop(start + 0.16)
    }
    beep(ctx.currentTime)
    beep(ctx.currentTime + 0.3)
  } catch { /* ignore — no audio permission */ }
}

function playExpiredTone() {
  try {
    type WebkitAudio = { webkitAudioContext?: typeof AudioContext }
    const Ctx = window.AudioContext ?? (window as unknown as WebkitAudio).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.frequency.value = 440
    gain.gain.setValueAtTime(0.2, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5)
    osc.start(); osc.stop(ctx.currentTime + 0.51)
  } catch { /* ignore */ }
}

// ── Session-storage log ──────────────────────────────────────────────────────

function logWindow(
  ticker: string,
  event: 'open' | 'expired' | 'entered',
  entryPrice: number | null,
  acted: boolean,
) {
  try {
    const key = 'oa_entry_windows'
    const arr = JSON.parse(sessionStorage.getItem(key) ?? '[]') as unknown[]
    arr.push({ ticker, time: new Date().toISOString(), entryPrice, acted, reason: event })
    sessionStorage.setItem(key, JSON.stringify(arr.slice(-50)))
  } catch { /* ignore */ }
}

// ── Progress bar sub-component ───────────────────────────────────────────────

function Bar({
  label, progress, isActive, isDone,
}: {
  label: string; progress: number; isActive: boolean; isDone: boolean
}) {
  const filled = isDone || isActive
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{
        width: 58, flexShrink: 0, fontSize: 11, fontWeight: 600,
        color: isDone ? '#a3cc6a' : isActive ? '#a3cc6a' : '#888780',
      }}>
        {label}
      </span>
      <div style={{
        flex: 1, height: 8, borderRadius: 4,
        background: '#2a2c28', overflow: 'hidden',
      }}>
        <div style={{
          height: '100%', borderRadius: 4,
          background: filled ? '#639922' : '#444441',
          width: `${Math.min(100, progress * 100).toFixed(1)}%`,
          transition: 'width 0.25s linear',
        }} />
      </div>
      <span style={{ width: 48, textAlign: 'right', fontSize: 10, color: '#888780' }}>
        {isDone ? 'done' : isActive ? 'filling' : 'waiting'}
      </span>
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

export default function EntryWindowBanner({
  active, ticker, direction, entryPrice, stopPrice, t1, t2,
}: Props) {
  const [phase, setPhase]   = useState<Phase>('idle')
  const [openTime, setOpenTime] = useState(0)
  const [pulse, setPulse]   = useState(true)
  const [fading, setFading] = useState(false)
  // Incremented by the ticker interval to force progress-bar re-renders.
  const [, forceRender] = useState(0)

  const openTimeRef     = useRef(0)
  const expiredFiredRef = useRef(false)
  const fadeTimer       = useRef<ReturnType<typeof setTimeout> | null>(null)
  const idleTimer       = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Derived timing values (fresh on every render) ────────────────────────
  const now     = Date.now()
  const c1Start = openTime > 0 ? Math.floor(openTime / 60000) * 60000 : 0
  const c1End   = c1Start + 60000
  const c2End   = c1End + 60000

  const c1Prog = openTime > 0
    ? now >= c1End ? 1 : Math.max(0, (now - openTime) / Math.max(1, c1End - openTime))
    : 0
  const c2Prog = openTime > 0 && now >= c1End
    ? now >= c2End ? 1 : (now - c1End) / 60000
    : 0
  const onCandle2  = openTime > 0 && now >= c1End && now < c2End
  const windowDone = openTime > 0 && now >= c2End

  // ── Open window when active flips true ──────────────────────────────────
  useEffect(() => {
    if (!active || phase !== 'idle') return
    const t = Date.now()
    openTimeRef.current     = t
    expiredFiredRef.current = false
    setOpenTime(t)
    setPhase('open')
    setPulse(true)
    setFading(false)
    playEntryBeeps()
    logWindow(ticker, 'open', entryPrice, false)
  }, [active, phase, ticker, entryPrice])

  // ── Pulse toggle every second while open ────────────────────────────────
  useEffect(() => {
    if (phase !== 'open') return
    const id = setInterval(() => setPulse(p => !p), 1000)
    return () => clearInterval(id)
  }, [phase])

  // ── Progress + expiry ticker (250 ms) ────────────────────────────────────
  useEffect(() => {
    if (phase !== 'open') return
    const id = setInterval(() => {
      const n  = Date.now()
      const ot = openTimeRef.current
      if (ot <= 0) return

      const c1s = Math.floor(ot / 60000) * 60000
      const c2e = c1s + 120000  // c1End + 60s

      if (n >= c2e && !expiredFiredRef.current) {
        expiredFiredRef.current = true
        clearInterval(id)
        setPhase('expired')
        setPulse(false)
        playExpiredTone()
        logWindow(ticker, 'expired', ot > 0 ? null : null, false)
        fadeTimer.current = setTimeout(() => setFading(true), 10000)
        idleTimer.current = setTimeout(() => {
          setPhase('idle')
          setFading(false)
          setOpenTime(0)
          openTimeRef.current = 0
        }, 11400)
      } else {
        forceRender(r => r + 1)
      }
    }, 250)
    return () => clearInterval(id)
  }, [phase, ticker])

  // ── Cleanup on unmount ───────────────────────────────────────────────────
  useEffect(() => () => {
    if (fadeTimer.current) clearTimeout(fadeTimer.current)
    if (idleTimer.current) clearTimeout(idleTimer.current)
  }, [])

  const handleEntered = () => {
    setPhase('entered')
    setPulse(false)
    logWindow(ticker, 'entered', entryPrice, true)
  }

  // ── Render: idle ─────────────────────────────────────────────────────────
  if (phase === 'idle') return null

  const ep  = entryPrice != null ? `$${entryPrice.toFixed(2)}` : null
  const sp  = stopPrice  > 0    ? `$${stopPrice.toFixed(2)}` : null

  // ── Render: entered ──────────────────────────────────────────────────────
  if (phase === 'entered') {
    return (
      <div style={{
        marginBottom: 8, borderRadius: 8, padding: '12px 14px',
        background: 'rgba(99,153,34,0.15)', border: '1px solid #639922',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <span style={{ fontSize: 16, color: '#a3cc6a', flexShrink: 0, lineHeight: 1 }}>✓</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#a3cc6a', marginBottom: 5 }}>
              Trade active · {ticker} {direction}{ep ? ` · ${ep}` : ''}
            </div>
            <div style={{ fontSize: 11, color: '#c2c0b6', lineHeight: 1.6 }}>
              {sp && <>Stop locked at {sp}</>}
              {t1  && ` · T1: $${t1.toFixed(2)}`}
              {t2  && ` · T2: $${t2.toFixed(2)}`}
            </div>
            <div style={{ fontSize: 11, color: '#888780', marginTop: 3 }}>
              Move stop to breakeven when T1 hits
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Render: expired ──────────────────────────────────────────────────────
  if (phase === 'expired') {
    return (
      <div style={{
        marginBottom: 8, borderRadius: 8, padding: '12px 14px',
        background: 'rgba(136,135,128,0.10)', border: '0.5px solid #888780',
        opacity: fading ? 0 : 1, transition: 'opacity 1.2s ease',
      }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: '#888780', marginBottom: 8 }}>
          ⏱ Entry window closed
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 8 }}>
          <Bar label="Candle 1" progress={1} isActive={false} isDone />
          <Bar label="Candle 2" progress={1} isActive={false} isDone />
        </div>
        <div style={{ fontSize: 11, color: '#888780' }}>
          Window expired · Watching for re-entry setup
        </div>
      </div>
    )
  }

  // ── Render: open ─────────────────────────────────────────────────────────
  const borderAlpha = pulse ? '1.0' : '0.35'
  return (
    <div style={{
      marginBottom: 8, borderRadius: 8, padding: '14px 16px',
      background: 'rgba(99,153,34,0.18)',
      border: `2px solid rgba(99,153,34,${borderAlpha})`,
      transition: 'border-color 0.35s ease',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 500, color: '#a3cc6a', letterSpacing: '0.01em' }}>
          ⚡ ENTRY WINDOW OPEN · ACT NOW
        </span>
        <span style={{
          fontSize: 10, fontWeight: 700, color: onCandle2 ? '#a3cc6a' : '#639922',
          background: 'rgba(99,153,34,0.2)', borderRadius: 4, padding: '2px 6px',
        }}>
          {onCandle2 ? 'CANDLE 2' : 'CANDLE 1'}
        </span>
      </div>

      {/* Trade line */}
      {(ep || sp) && (
        <div style={{ fontSize: 12, color: '#c2c0b6', marginBottom: 10, fontFamily: 'monospace' }}>
          {ticker} · {direction}{ep ? ` · ${ep}` : ''}{sp ? ` · Stop ${sp}` : ''}
        </div>
      )}

      {/* Progress bars */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
        <Bar
          label="Candle 1"
          progress={c1Prog}
          isActive={!onCandle2 && !windowDone}
          isDone={c1Prog >= 1}
        />
        <Bar
          label="Candle 2"
          progress={c2Prog}
          isActive={onCandle2}
          isDone={c2Prog >= 1}
        />
      </div>

      {/* Footer + button */}
      <div style={{
        display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', gap: 10, flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 11, color: '#888780', lineHeight: 1.5 }}>
          Enter within this candle or next one. After that — window closes.
        </span>
        <button
          type="button"
          onClick={handleEntered}
          style={{
            minHeight: 44, padding: '8px 18px', borderRadius: 6, flexShrink: 0,
            background: 'rgba(99,153,34,0.28)', border: '1px solid #639922',
            color: '#a3cc6a', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(99,153,34,0.48)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(99,153,34,0.28)' }}
        >
          ✓ I entered this trade
        </button>
      </div>
    </div>
  )
}
