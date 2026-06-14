// ─── Fibonacci retracement + MA/EMA confluence (swing-trade pullback tooling) ──
//
// Purely additive helper used by the EOD Journal swing page. Daily-chart only —
// intraday fib is intentionally NOT computed here (see EOD prompt Part 15).

export type FibPct = '23.6' | '38.2' | '50' | '61.8' | '78.6'

export const FIB_PCTS: FibPct[] = ['23.6', '38.2', '50', '61.8', '78.6']

export const FIB_RATIOS: Record<FibPct, number> = {
  '23.6': 0.236,
  '38.2': 0.382,
  '50': 0.5,
  '61.8': 0.618,
  '78.6': 0.786,
}

// Dotted-line / label colors for each fib level (Part 13).
export const FIB_COLORS: Record<FibPct, string> = {
  '23.6': '#58a6ff', // light blue
  '38.2': '#3fb950', // green
  '50': '#d29922',   // yellow
  '61.8': '#ffa657', // orange
  '78.6': '#f85149', // red
}

export interface FibLevels {
  '23.6': number
  '38.2': number
  '50': number
  '61.8': number
  '78.6': number
}

export interface FibData {
  swingHigh: number
  swingHighDate: string
  swingLow: number
  swingLowDate: string
  direction: 'up' | 'down'
  levels: FibLevels
  /** Fib level the current price sits closest to. */
  currentZone: FibPct
}

export interface ConfluenceZone {
  price: number
  levelsAligned: string[]
  strength: 'STRONG' | 'MEDIUM'
}

// ─── Fib level calculation ──────────────────────────────────────────────────

/**
 * Build the five retracement levels from a swing high/low.
 *
 * For a bullish pullback (direction 'up') the levels are measured DOWN from the
 * swing high — i.e. shallower % = closer to the high. For a bearish bounce the
 * levels are measured UP from the swing low.
 */
export function computeFibLevels(
  swingHigh: number,
  swingLow: number,
  direction: 'up' | 'down',
): FibLevels {
  const range = swingHigh - swingLow
  const at = (ratio: number) =>
    direction === 'up'
      ? +(swingHigh - range * ratio).toFixed(2)
      : +(swingLow + range * ratio).toFixed(2)
  return {
    '23.6': at(FIB_RATIOS['23.6']),
    '38.2': at(FIB_RATIOS['38.2']),
    '50': at(FIB_RATIOS['50']),
    '61.8': at(FIB_RATIOS['61.8']),
    '78.6': at(FIB_RATIOS['78.6']),
  }
}

/** Which fib level the live price is closest to. */
export function currentFibZone(levels: FibLevels, price: number): FibPct {
  let best: FibPct = '38.2'
  let bestDist = Infinity
  for (const p of FIB_PCTS) {
    const d = Math.abs(levels[p] - price)
    if (d < bestDist) {
      bestDist = d
      best = p
    }
  }
  return best
}

export function buildFibData(
  swingHigh: number | null | undefined,
  swingHighDate: string | null | undefined,
  swingLow: number | null | undefined,
  swingLowDate: string | null | undefined,
  direction: 'up' | 'down' | null | undefined,
  price: number,
): FibData | null {
  if (
    swingHigh == null || swingLow == null ||
    swingHigh <= 0 || swingLow <= 0 ||
    swingHigh <= swingLow
  ) return null
  const dir: 'up' | 'down' = direction === 'down' ? 'down' : 'up'
  const levels = computeFibLevels(swingHigh, swingLow, dir)
  return {
    swingHigh,
    swingHighDate: swingHighDate ?? '',
    swingLow,
    swingLowDate: swingLowDate ?? '',
    direction: dir,
    levels,
    currentZone: currentFibZone(levels, price),
  }
}

// ─── Per-zone interpretation (Part 4 color coding) ──────────────────────────

export interface ZoneMeta {
  color: string
  label: string
  verdict: string
  /** Probability nudge applied to the confidence display (Part 12). */
  probAdjust: number
}

export const FIB_ZONE_META: Record<FibPct, ZoneMeta> = {
  '23.6': {
    color: '#58a6ff',
    label: 'Shallow pullback (strong trend)',
    verdict: 'Strong trend — usually too shallow for a fresh swing entry.',
    probAdjust: +5,
  },
  '38.2': {
    color: '#3fb950',
    label: 'Healthy pullback',
    verdict: 'Healthy pullback — ideal swing entry zone if other indicators confirm.',
    probAdjust: 0,
  },
  '50': {
    color: '#d29922',
    label: 'Balanced retracement',
    verdict: 'Balanced retracement — acceptable entry with confirmation.',
    probAdjust: 0,
  },
  '61.8': {
    color: '#ffa657',
    label: 'Deep but valid (last chance support)',
    verdict: 'Deep pullback — last-chance support. Enter only with multiple confirmations.',
    probAdjust: -10,
  },
  '78.6': {
    color: '#f85149',
    label: 'Trend in danger',
    verdict: 'Trend likely broken — avoid new entries here.',
    probAdjust: -20,
  },
}

// ─── Confluence detection (Part 5) ──────────────────────────────────────────

export interface ConfluenceInput {
  close: number
  ema9?: number | null
  ma20?: number | null
  ma50?: number | null
  fibLevels?: FibLevels | null
}

export type ConfluenceTightness = 'tight' | 'medium' | 'loose'

/** $ + %-of-price threshold pairs per tightness setting (Part 14). */
export function confluenceThreshold(close: number, t: ConfluenceTightness): number {
  switch (t) {
    case 'tight': return Math.max(0.5, close * 0.003)
    case 'loose': return Math.max(2, close * 0.01)
    case 'medium':
    default:      return Math.max(1, close * 0.005)
  }
}

export function detectFibMaConfluence(
  stock: ConfluenceInput,
  tightness: ConfluenceTightness = 'medium',
): ConfluenceZone[] {
  const levels: { name: string; value: number }[] = []

  if (stock.ema9 && stock.ema9 > 0) levels.push({ name: '9 EMA', value: stock.ema9 })
  if (stock.ma20 && stock.ma20 > 0) levels.push({ name: 'MA20', value: stock.ma20 })
  if (stock.ma50 && stock.ma50 > 0) levels.push({ name: 'MA50', value: stock.ma50 })
  if (stock.fibLevels) {
    for (const p of FIB_PCTS) {
      const v = stock.fibLevels[p]
      if (v > 0) levels.push({ name: `Fib ${p}%`, value: v })
    }
  }

  const threshold = confluenceThreshold(stock.close, tightness)
  const zones: ConfluenceZone[] = []

  for (let i = 0; i < levels.length; i++) {
    const nearby = levels.filter(
      (l, j) => j !== i && Math.abs(l.value - levels[i].value) <= threshold,
    )
    if (nearby.length >= 1) {
      const zonePrice =
        (levels[i].value + nearby.reduce((s, l) => s + l.value, 0)) / (nearby.length + 1)
      const aligned = [levels[i].name, ...nearby.map(l => l.name)]
      zones.push({
        price: +zonePrice.toFixed(2),
        levelsAligned: aligned,
        strength: aligned.length >= 3 ? 'STRONG' : 'MEDIUM',
      })
    }
  }

  // Dedup: zones built from the same set of levels appear once (sorted names).
  const seen = new Set<string>()
  const deduped: ConfluenceZone[] = []
  for (const z of zones) {
    const key = [...z.levelsAligned].sort().join('|')
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(z)
  }
  // Strongest (most levels), then nearest to price first.
  return deduped.sort(
    (a, b) =>
      b.levelsAligned.length - a.levelsAligned.length ||
      Math.abs(a.price - stock.close) - Math.abs(b.price - stock.close),
  )
}

// ─── Settings (Part 14) ─────────────────────────────────────────────────────

const FIB_LOOKBACK_KEY = 'oa_fib_lookback'
const EMA9_SHOW_KEY = 'oa_ema9_show'
const CONFLUENCE_TIGHTNESS_KEY = 'oa_confluence_tightness'

export interface SwingToolSettings {
  fibLookback: number
  showEma9: boolean
  confluenceTightness: ConfluenceTightness
}

export function loadSwingToolSettings(): SwingToolSettings {
  let fibLookback = 20
  let showEma9 = true
  let confluenceTightness: ConfluenceTightness = 'medium'
  try {
    const lb = parseInt(localStorage.getItem(FIB_LOOKBACK_KEY) ?? '', 10)
    if ([10, 20, 60, 90].includes(lb)) fibLookback = lb
    if (localStorage.getItem(EMA9_SHOW_KEY) === '0') showEma9 = false
    const ct = localStorage.getItem(CONFLUENCE_TIGHTNESS_KEY)
    if (ct === 'tight' || ct === 'loose' || ct === 'medium') confluenceTightness = ct
  } catch { /* ignore */ }
  return { fibLookback, showEma9, confluenceTightness }
}

export function saveFibLookback(days: number) {
  try { localStorage.setItem(FIB_LOOKBACK_KEY, String(days)) } catch { /* quota */ }
}
export function saveShowEma9(show: boolean) {
  try { localStorage.setItem(EMA9_SHOW_KEY, show ? '1' : '0') } catch { /* quota */ }
}
export function saveConfluenceTightness(t: ConfluenceTightness) {
  try { localStorage.setItem(CONFLUENCE_TIGHTNESS_KEY, t) } catch { /* quota */ }
}

// ─── Educational tooltips (Part 10) ─────────────────────────────────────────

export const EMA9_TOOLTIP =
  '9 EMA is the fastest of your moving averages. It signals momentum shifts before MA20 ' +
  'confirms. Use it as an early warning — when price closes below 9 EMA on a long position, ' +
  'tighten stops but do not exit. Wait for MA20 break for actual exit. Two consecutive ' +
  'closes below 9 EMA indicate momentum has shifted.'

export const FIB_TOOLTIP =
  'Fibonacci retracement identifies likely support/resistance during pullbacks. Drawn from a ' +
  'swing high to swing low (or vice versa). 38.2% and 61.8% are the most reliable levels. ' +
  'Healthy uptrends typically pull back to 38.2% before continuing. Pullbacks beyond 61.8% ' +
  "suggest trend weakness. 78.6% is the 'last chance' level — breaks below indicate trend reversal."

export const CONFLUENCE_TOOLTIP =
  'Confluence zones are price levels where multiple independent indicators agree. When ' +
  '9 EMA + MA20 + 38.2% Fib all sit within $1, that level becomes much more likely to hold as ' +
  'support or resistance. 3+ levels aligning = strong zone. 2 levels = medium. Single ' +
  'indicators alone are less reliable than confluence.'
