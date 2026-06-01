import { useEffect, useState } from 'react'
import { Clock, ShieldAlert } from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────

export type TimeGateType = 'blocked' | 'caution' | 'clear'

export interface TimeGateStatus {
  type: TimeGateType
  window: string
  message: string
  minutesRemaining?: number
}

// ─── Pacific Time helpers ────────────────────────────────────────────

function pacificMinutes(date: Date): number {
  // Uses IANA timezone — handles PST (UTC-8) and PDT (UTC-7) automatically
  const str = date.toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const [h, m] = str.split(':').map(Number)
  return h * 60 + m
}

function fmtCountdown(min: number): string {
  if (min <= 0) return 'soon'
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

// ─── Time window constants (Pacific Time minutes since midnight) ─────

const PT = {
  MARKET_OPEN:      6 * 60 + 30,   // 6:30 AM PT  (9:30 AM ET)
  OR_DATA_READY:    6 * 60 + 45,   // 6:45 AM PT — first 15×1m candles complete, OR/VWAP reliable
  OPEN_RANGE_END:   7 * 60,         // 7:00 AM PT — first 30 min settles
  MIDDAY_START:     9 * 60,         // 9:00 AM PT  (12:00 PM ET)
  MIDDAY_END:       10 * 60 + 30,   // 10:30 AM PT (1:30 PM ET) — lunch lull
  CLOSE_WARN:       12 * 60 + 45,   // 12:45 PM PT — last 15 min
  MARKET_CLOSE:     13 * 60,        // 1:00 PM PT  (4:00 PM ET)
}

// True during the first 15 minutes when OR/VWAP data is still forming
export function isOpeningRangeWindow(): boolean {
  const now = pacificMinutes(new Date())
  return now >= PT.MARKET_OPEN && now < PT.OR_DATA_READY
}

export function openingRangeMinutesRemaining(): number {
  const now = pacificMinutes(new Date())
  return Math.max(0, PT.OR_DATA_READY - now)
}

// ─── Core gate logic ─────────────────────────────────────────────────

export function getTimeGateStatus(
  tradeType: 'day' | 'swing',
  nowMin: number,
): TimeGateStatus {

  if (tradeType === 'day') {
    if (nowMin < PT.MARKET_OPEN) {
      return {
        type: 'blocked',
        window: 'Pre-Market',
        message: 'Regular session not yet open. Day trade signals use live RTH data — wait for 6:30 AM PT.',
        minutesRemaining: PT.MARKET_OPEN - nowMin,
      }
    }
    if (nowMin < PT.OPEN_RANGE_END) {
      return {
        type: 'blocked',
        window: 'Opening Range  6:30–7:00 AM PT',
        message:
          'First 30 minutes — VWAP, ORH/ORL, and volume direction are still forming. ' +
          'Entering now is gambling on direction, not trading with confirmation. ' +
          'Let the opening range complete, then act on the breakout.',
        minutesRemaining: PT.OPEN_RANGE_END - nowMin,
      }
    }
    if (nowMin >= PT.MIDDAY_START && nowMin < PT.MIDDAY_END) {
      return {
        type: 'caution',
        window: 'Midday Lull  9:00–10:30 AM PT',
        message:
          'Volume typically dries up during the lunch hour. ' +
          'New day trade entries in this window have lower follow-through odds. ' +
          'Prefer managing existing positions over opening new ones.',
        minutesRemaining: PT.MIDDAY_END - nowMin,
      }
    }
    if (nowMin >= PT.CLOSE_WARN && nowMin < PT.MARKET_CLOSE) {
      return {
        type: 'caution',
        window: 'Near Close  after 12:45 PM PT',
        message: `Market closes in ${PT.MARKET_CLOSE - nowMin} min. Not enough runway for a new intraday move to develop. Avoid opening new positions — manage or close existing ones instead.`,
        minutesRemaining: PT.MARKET_CLOSE - nowMin,
      }
    }
    if (nowMin >= PT.MARKET_CLOSE) {
      return {
        type: 'blocked',
        window: 'After Hours',
        message:
          'Regular session closed. Day trade signals are only valid during RTH (6:30 AM–1:00 PM PT). ' +
          'Review today\'s tape and plan tomorrow\'s setups.',
      }
    }
  }

  if (tradeType === 'swing') {
    if (nowMin < PT.MARKET_OPEN) {
      return {
        type: 'caution',
        window: 'Pre-Market',
        message:
          'Swing setups are based on prior-session closes. ' +
          'Wait for the regular session open (6:30 AM PT) before executing — ' +
          'pre-market gaps can shift the entry price significantly.',
        minutesRemaining: PT.MARKET_OPEN - nowMin,
      }
    }
    if (nowMin < PT.OPEN_RANGE_END) {
      return {
        type: 'caution',
        window: 'Opening Volatility  6:30–7:00 AM PT',
        message:
          'First 30 minutes are volatile. Swing entries get better fill quality and ' +
          'cleaner breakout confirmation after the opening range settles at 7:00 AM PT.',
        minutesRemaining: PT.OPEN_RANGE_END - nowMin,
      }
    }
  }

  return { type: 'clear', window: '', message: '' }
}

// ─── Hook ────────────────────────────────────────────────────────────

export function useMarketTimeGate(tradeType: 'day' | 'swing'): TimeGateStatus {
  const [status, setStatus] = useState<TimeGateStatus>(() =>
    getTimeGateStatus(tradeType, pacificMinutes(new Date())),
  )

  useEffect(() => {
    const tick = () =>
      setStatus(getTimeGateStatus(tradeType, pacificMinutes(new Date())))
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [tradeType])

  return status
}

// ─── Banner component ────────────────────────────────────────────────

export function MarketTimeGateBanner({ tradeType }: { tradeType: 'day' | 'swing' }) {
  const status = useMarketTimeGate(tradeType)
  if (status.type === 'clear') return null

  const isBlocked = status.type === 'blocked'

  const containerCls = isBlocked
    ? 'border-red-500/40 bg-red-950/30'
    : 'border-amber-500/35 bg-amber-950/20'
  const iconCls    = isBlocked ? 'text-red-400'    : 'text-amber-400'
  const labelCls   = isBlocked ? 'text-red-300'    : 'text-amber-300'
  const textCls    = isBlocked ? 'text-red-200/80' : 'text-amber-200/80'
  const pillCls    = isBlocked
    ? 'border-red-500/40 bg-red-500/15 text-red-300'
    : 'border-amber-500/40 bg-amber-500/15 text-amber-300'
  const countdownCls = isBlocked ? 'text-red-400' : 'text-amber-400'

  return (
    <div className={`rounded-xl border px-3.5 py-3 space-y-1.5 ${containerCls}`}>
      <div className="flex items-center gap-2">
        {isBlocked
          ? <ShieldAlert size={14} className={iconCls} />
          : <Clock size={14} className={iconCls} />}
        <span className={`text-[11px] font-black uppercase tracking-widest ${labelCls}`}>
          {isBlocked ? 'No-Trade Window' : 'Patience Window'}
        </span>
        <span className={`ml-auto inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold shrink-0 ${pillCls}`}>
          {status.window}
        </span>
      </div>
      <p className={`text-[11px] leading-snug ${textCls}`}>{status.message}</p>
      {status.minutesRemaining != null && status.minutesRemaining > 0 && (
        <div className={`flex items-center gap-1 text-[10px] font-semibold ${countdownCls}`}>
          <Clock size={10} />
          Window clears in {fmtCountdown(status.minutesRemaining)}
        </div>
      )}
    </div>
  )
}
