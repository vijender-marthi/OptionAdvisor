import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchMarketPosition } from '../api/commandCenter'

const TIMEZONE_OPTIONS = [
  { label: 'ET', tz: 'America/New_York' },
  { label: 'CT', tz: 'America/Chicago' },
  { label: 'MT', tz: 'America/Denver' },
  { label: 'PT', tz: 'America/Los_Angeles' },
]

function etClock(tz: string): { time: string; session: string } {
  const t = new Date().toLocaleTimeString('en-US', {
    timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true,
  })
  const h = new Date().toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false })
  const hNum = parseInt(h)
  const session =
    hNum < 4  ? 'Closed' :
    hNum < 9  ? 'Pre-Market' :
    hNum < 10 ? 'Opening' :
    hNum < 12 ? 'Morning' :
    hNum < 14 ? 'Midday' :
    hNum < 15 ? 'Power Hour' :
    hNum < 16 ? 'Closing' :
    hNum < 20 ? 'After-Hours' :
                'Closed'
  const tzLabel = TIMEZONE_OPTIONS.find(o => o.tz === tz)?.label || 'ET'
  return { time: `${t} ${tzLabel}`, session }
}

function sessionColor(session: string): string {
  switch (session) {
    case 'Opening':     return '#00E5A0'
    case 'Power Hour':  return '#00E5A0'
    case 'Morning':     return '#F5A623'
    case 'Closing':     return '#F5A623'
    case 'Midday':      return '#5A6478'
    case 'Pre-Market':  return '#6B7FD4'
    case 'After-Hours': return '#6B7FD4'
    case 'Closed':      return '#3A4255'
    default:            return '#5A6478'
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

  const toneColor: Record<string, string> = { green: '#00E5A0', red: '#FF4D6D', orange: '#F5A623', gray: '#5A6478' }
  const toneBg: Record<string, string> = { green: 'rgba(0,229,160,0.08)', red: 'rgba(255,77,109,0.08)', orange: 'rgba(245,166,35,0.08)', gray: 'transparent' }
  const tone = marketData.tone || 'gray'
  const signalLabel = marketData.signal || 'NEUTRAL MARKET'

  const fmtPx = (v: number | undefined) => v != null ? `$${v.toFixed(2)}` : '—'
  const fmtChg = (v: number | undefined) => v != null ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : null

  return (
    <div className="flex items-center gap-3 px-4 py-1.5 border-b border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900/80 text-[11px] font-mono shrink-0 overflow-x-auto">
      {/* OptionAdvisor label */}
      <span className="font-bold text-violet-500 whitespace-nowrap mr-1">OptionAdvisor</span>

      <span className="text-gray-600 dark:text-gray-700">|</span>

      {/* SPY */}
      <span className="flex items-center gap-1.5 whitespace-nowrap text-gray-500">
        SPY
        <span className="font-semibold text-gray-900 dark:text-gray-100">{fmtPx(marketData.spy)}</span>
        {marketData.spyChg != null && (
          <span className={`font-semibold ${marketData.spyChg >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>{fmtChg(marketData.spyChg)}</span>
        )}
      </span>

      <span className="text-gray-600 dark:text-gray-700">|</span>

      {/* QQQ */}
      <span className="flex items-center gap-1.5 whitespace-nowrap text-gray-500">
        QQQ
        <span className="font-semibold text-gray-900 dark:text-gray-100">{fmtPx(marketData.qqq)}</span>
        {marketData.qqqChg != null && (
          <span className={`font-semibold ${marketData.qqqChg >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>{fmtChg(marketData.qqqChg)}</span>
        )}
      </span>

      <span className="text-gray-600 dark:text-gray-700">|</span>

      {/* Regime badge */}
      <span
        className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap"
        style={{ color: toneColor[tone], background: toneBg[tone], border: `1px solid ${toneColor[tone]}` }}
      >
        {signalLabel}
      </span>

      <div className="ml-auto flex items-center gap-2 shrink-0">
        <span className="text-gray-600 dark:text-gray-700">|</span>

        {/* Clock / timezone */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowTzPicker(p => !p)}
            className="flex items-center gap-1 text-gray-500 hover:text-gray-300 cursor-pointer bg-transparent border-none text-[11px] font-mono whitespace-nowrap"
          >
            <span>{clock.time}</span>
            <span style={{ color: sessionColor(clock.session), fontWeight: 600 }}>· {clock.session}</span>
          </button>
          {showTzPicker && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowTzPicker(false)} />
              <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg py-1 min-w-[140px]">
                {TIMEZONE_OPTIONS.map(opt => (
                  <button
                    key={opt.tz}
                    type="button"
                    onClick={() => { setUserTz(opt.tz); setShowTzPicker(false) }}
                    className={`w-full text-left px-3 py-1.5 text-[11px] font-mono hover:bg-slate-100 dark:hover:bg-slate-700 ${userTz === opt.tz ? 'text-violet-500 font-bold' : 'text-gray-500'}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
