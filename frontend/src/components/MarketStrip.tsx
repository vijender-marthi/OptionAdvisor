import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchMarketPosition } from '../api/commandCenter'

const C = {
  bgPage:    '#0A0B0D',
  bgPanel:   '#111215',
  bgCard:    '#18191D',
  border:    '#1E1F24',
  borderSub: '#25262B',
  muted:     '#6B7280',
  accent:    '#3B82F6',
  green:     '#00A86B',
  red:       '#D0312D',
  amber:     '#D4A017',
  purple:    '#6B7280',
}

const TIMEZONE_OPTIONS = [
  { label: 'ET', tz: 'America/New_York' },
  { label: 'CT', tz: 'America/Chicago' },
  { label: 'MT', tz: 'America/Denver' },
  { label: 'PT', tz: 'America/Los_Angeles' },
]

function etClock(tz: string): { time: string; session: string } {
  const now = new Date()
  const et = now.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false })
  const hNum = parseInt(et)
  const dow = now.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short' }).toUpperCase()
  const dateStr = now.toLocaleString('en-US', { timeZone: 'America/New_York', month: '2-digit', day: '2-digit' })

  // US market holidays (MM/DD format)
  const holidays = new Set([
    '01/01', '01/20', '02/17', '04/18', '05/26', '06/19', '07/04', '09/01', '11/27', '12/25',
  ])

  const isHoliday = holidays.has(dateStr)
  const isWeekend = dow === 'SAT' || dow === 'SUN'

  let session: string
  if (isWeekend || isHoliday) {
    session = 'Closed'
  } else if (hNum < 4) {
    session = 'Closed'
  } else if (hNum < 9) {
    session = 'Pre-Market'
  } else if (hNum < 10) {
    session = 'Opening'
  } else if (hNum < 12) {
    session = 'Morning'
  } else if (hNum < 14) {
    session = 'Midday'
  } else if (hNum < 15) {
    session = 'Power Hour'
  } else if (hNum < 16) {
    session = 'Closing'
  } else if (hNum < 20) {
    session = 'After-Hours'
  } else {
    session = 'Closed'
  }

  const tzLabel = TIMEZONE_OPTIONS.find(o => o.tz === tz)?.label || 'ET'
  return { time: `${now.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true })} ${tzLabel}`, session }
}

function sessionColor(session: string): string {
  switch (session) {
    case 'Opening':     return C.green
    case 'Power Hour':  return C.green
    case 'Morning':     return C.amber
    case 'Closing':     return C.amber
    case 'Midday':      return C.muted
    case 'Pre-Market':  return C.muted
    case 'After-Hours': return C.muted
    case 'Closed':      return '#3A4255'
    default:            return C.muted
  }
}

export default function MarketStrip() {
  const [marketData, setMarketData] = useState<{
    spy?: number; spyChg?: number
    qqq?: number; qqqChg?: number
    vix?: number; vixLabel?: string
    signal?: string; tone?: string
  }>({})
  const [userTz, setUserTz] = useState(() => { try { return localStorage.getItem('oa_timezone') || 'America/New_York' } catch { return 'America/New_York' } })
  const [clock, setClock] = useState(() => etClock(userTz))
  const [showTzPicker, setShowTzPicker] = useState(false)
  const tzRef = useRef(userTz)
  const tzBtnRef = useRef<HTMLButtonElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetchMarketPosition()
      const d = res.data
      if (d) {
        setMarketData({
          spy:     d.spy_price,
          spyChg:  d.spy_change_pct ?? undefined,
          qqq:     d.qqq_price ?? undefined,
          qqqChg:  d.qqq_change_pct ?? undefined,
          vix:     d.vix ?? undefined,
          vixLabel: d.vix_label ?? undefined,
          signal:  d.signal_label,
          tone:    d.signal_tone,
        })
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { load(); const id = setInterval(load, 60_000); return () => clearInterval(id) }, [load])

  useEffect(() => {
    tzRef.current = userTz
    setClock(etClock(userTz))
    try { localStorage.setItem('oa_timezone', userTz) } catch {}
  }, [userTz])

  useEffect(() => {
    const id = setInterval(() => setClock(etClock(tzRef.current)), 30_000)
    return () => clearInterval(id)
  }, [])

  const toneColor: Record<string, string> = { green: C.green, red: C.red, orange: C.amber, gray: C.muted }
  const toneBg: Record<string, string> = {
    green: 'rgba(0,229,160,0.08)', red: 'rgba(255,77,109,0.08)', orange: 'rgba(245,166,35,0.08)', gray: 'transparent',
  }
  const tone = marketData.tone || 'gray'
  const signalLabel = marketData.signal || 'NEUTRAL MARKET'

  const fmtPx = (v: number | undefined) => v != null ? `$${v.toFixed(2)}` : '—'
  const fmtChg = (v: number | undefined) => v != null ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : null

  // Compute fixed position for the dropdown so it doesn't get clipped
  const [tzPickerStyle, setTzPickerStyle] = useState<React.CSSProperties>({ display: 'none' })
  useEffect(() => {
    if (!showTzPicker) { setTzPickerStyle({ display: 'none' }); return }
    const btn = tzBtnRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    setTzPickerStyle({
      position: 'fixed',
      top: rect.bottom + 4,
      right: 12,
      zIndex: 9999,
    })
  }, [showTzPicker])

  return (
    <div className="market-strip" style={{
      display: 'flex', alignItems: 'center', gap: 20, height: 44,
      padding: '0 12px', flexShrink: 0,
      background: C.bgPage, borderBottom: `1px solid ${C.border}`,
      fontFamily: 'monospace', fontSize: '0.72rem', color: C.muted,
      overflow: 'hidden',
    }}>
      {/* Left: logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, flexShrink: 0 }}>
        <span style={{ fontWeight: 700, fontSize: '0.92rem', color: '#fff' }}>Option</span>
        <span style={{ fontWeight: 700, fontSize: '0.92rem', color: C.green }}>Advisor</span>
      </div>

      {/* Market open/closed indicator */}
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: '0.68rem', fontWeight: 600, whiteSpace: 'nowrap',
        color: clock.session === 'Closed' || clock.session === 'Pre-Market' || clock.session === 'After-Hours' ? C.muted : C.green,
      }}>
        <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: clock.session === 'Closed' || clock.session === 'Pre-Market' || clock.session === 'After-Hours' ? C.muted : C.green }} />
        {clock.session === 'Closed' || clock.session === 'Pre-Market' || clock.session === 'After-Hours' ? 'Closed' : 'Live'}
      </span>

      <span style={{ color: C.borderSub }}>|</span>

      {/* Clock / timezone */}
      <div style={{ position: 'relative' }}>
        <button
          ref={tzBtnRef}
          type="button"
          onClick={() => setShowTzPicker(p => !p)}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontFamily: 'monospace', fontSize: '0.72rem', color: C.muted,
            padding: 0, display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
          }}
        >
          <span>{clock.time}</span>
          <span style={{ color: sessionColor(clock.session), fontWeight: 600 }}>· {clock.session}</span>
        </button>

        {showTzPicker && (
          <>
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
              onClick={() => setShowTzPicker(false)}
            />
            <div style={{
              ...tzPickerStyle,
              background: C.bgPanel, border: `1px solid ${C.borderSub}`,
              borderRadius: 10, padding: '8px 0', minWidth: 150,
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            }}>
              {TIMEZONE_OPTIONS.map(opt => (
                <button
                  key={opt.tz}
                  type="button"
                  onClick={() => { setUserTz(opt.tz); setShowTzPicker(false) }}
                  onMouseEnter={e => { e.currentTarget.style.background = C.bgCard }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                    padding: '8px 14px', background: userTz === opt.tz ? 'rgba(74,124,255,0.1)' : 'transparent',
                    border: 'none', cursor: 'pointer', textAlign: 'left',
                    fontFamily: 'monospace', fontSize: '0.78rem',
                    color: userTz === opt.tz ? '#fff' : C.muted,
                  }}
                >
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    background: userTz === opt.tz ? C.accent : 'transparent',
                    border: `1px solid ${userTz === opt.tz ? C.accent : C.borderSub}`,
                  }} />
                  <span style={{ fontWeight: 700, marginRight: 4 }}>{opt.label}</span>
                  <span style={{ fontSize: '0.72rem', color: C.muted }}>
                    {opt.tz.split('/').pop()?.replace(/_/g, ' ')}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <span style={{ color: C.borderSub }}>|</span>

      {/* SPY */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
        <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: C.green }} />
        SPY
        {marketData.spy != null ? (
          <>
            <span style={{ color: '#fff', fontWeight: 700 }}>{fmtPx(marketData.spy)}</span>
            {marketData.spyChg != null && (
              <span style={{ color: marketData.spyChg >= 0 ? C.green : C.red }}>
                {fmtChg(marketData.spyChg)}
              </span>
            )}
          </>
        ) : (
          <span style={{ color: C.muted }}>—</span>
        )}
      </div>

      <span style={{ color: C.borderSub }}>|</span>

      {/* QQQ */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
        QQQ
        {marketData.qqq != null ? (
          <>
            <span style={{ color: '#fff', fontWeight: 700 }}>{fmtPx(marketData.qqq)}</span>
            {marketData.qqqChg != null && (
              <span style={{ color: marketData.qqqChg >= 0 ? C.green : C.red }}>
                {fmtChg(marketData.qqqChg)}
              </span>
            )}
          </>
        ) : (
          <span style={{ color: C.muted }}>—</span>
        )}
      </div>

      <span style={{ color: C.borderSub }}>|</span>

      {/* VIX */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
        VIX
        {marketData.vix != null ? (
          <>
            <span style={{ color: '#fff', fontWeight: 700 }}>{marketData.vix.toFixed(1)}</span>
            <span style={{
              color: marketData.vix < 15 ? C.green : marketData.vix < 20 ? C.green : marketData.vix < 25 ? C.amber : C.red,
              fontWeight: 600,
            }}>
              {marketData.vixLabel || (marketData.vix < 20 ? 'Contained' : marketData.vix < 25 ? 'Elevated' : 'High')}
            </span>
          </>
        ) : (
          <span style={{ color: C.muted }}>—</span>
        )}
      </div>

      <span style={{ color: C.borderSub }}>|</span>

      {/* Regime badge */}
      <span style={{
        border: `1px solid ${toneColor[tone]}`, color: toneColor[tone],
        background: toneBg[tone], borderRadius: 20,
        padding: '2px 10px', fontSize: '0.7rem', fontWeight: 700,
        letterSpacing: '0.04em', whiteSpace: 'nowrap', textTransform: 'uppercase',
      }}>
        {signalLabel}
      </span>
    </div>
  )
}
