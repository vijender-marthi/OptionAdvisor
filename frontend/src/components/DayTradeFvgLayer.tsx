// SVG overlay for the Day Trade session chart: Fair Value Gap boxes, CHoCH markers,
// the target order block, and the SMC strategy entry/stop/target lines.
// Rendered inside the chart's <svg>, so it consumes the chart's price/time geometry.

export type FvgBox = {
  type: 'bullish' | 'bearish'
  top: number
  bottom: number
  mid: number
  startTime: string
  endTime: string
  mitigated: boolean
  extendsPastData?: boolean
}
export type ChochEvent = { index: number; time: string; price: number; direction: 'bullish' | 'bearish'; isFirst?: boolean }
export type OrderBlockZone = { type: 'bullish' | 'bearish'; top: number; bottom: number; time: string }
export type FvgStrategy = {
  extendBars: number
  fvgs: FvgBox[]
  choch: ChochEvent[]
  orderBlocks: OrderBlockZone[]
  strategy: {
    valid: boolean
    direction?: 'bullish' | 'bearish'
    entry?: number
    stop?: number
    target?: number | null
    riskReward?: number | null
    status?: string
    reason?: string
    orderBlock?: OrderBlockZone | null
    fvg?: FvgBox | null
    choch?: ChochEvent | null
  }
  counts?: Record<string, number>
}

const BULL = '#22c55e'
const BEAR = '#ef4444'

export default function DayTradeFvgLayer({
  data, yForPrice, visibleTimes, firstTime, lastTime, width, priceTop, priceBottom,
}: {
  data: FvgStrategy
  yForPrice: (p: number) => number
  visibleTimes: Map<string, number>
  firstTime: string
  lastTime: string
  width: number
  priceTop: number
  priceBottom: number
}) {
  // Map a candle time to an x. Times outside the visible window clamp to the edges
  // so a box that starts before / extends past the view still renders correctly.
  const xForTime = (t: string): number | null => {
    const exact = visibleTimes.get(t)
    if (exact != null) return exact
    if (t <= firstTime) return 0
    if (t >= lastTime) return width
    return null
  }
  const clampY = (y: number) => Math.max(priceTop, Math.min(priceBottom, y))
  const s = data.strategy

  return (
    <g>
      {/* Fair Value Gap boxes + midline */}
      {data.fvgs.map((f, i) => {
        const xL = xForTime(f.startTime)
        const xR = xForTime(f.endTime)
        if (xL == null || xR == null || xR <= xL) return null
        const bull = f.type === 'bullish'
        const color = bull ? BULL : BEAR
        const yT = clampY(yForPrice(f.top))
        const yB = clampY(yForPrice(f.bottom))
        const yMid = clampY(yForPrice(f.mid))
        return (
          <g key={`fvg-${i}`}>
            <rect x={xL} y={Math.min(yT, yB)} width={xR - xL} height={Math.max(1, Math.abs(yB - yT))} fill={color} opacity={f.mitigated ? 0.05 : 0.15} />
            <line x1={xL} x2={xR} y1={yMid} y2={yMid} stroke={color} strokeWidth={1} strokeDasharray="3 3" opacity={f.mitigated ? 0.25 : 0.6} />
          </g>
        )
      })}

      {/* Target order block (the SMC exit zone) */}
      {s.valid && s.orderBlock && (() => {
        const ob = s.orderBlock
        const xL = xForTime(ob.time)
        if (xL == null) return null
        const yT = clampY(yForPrice(ob.top))
        const yB = clampY(yForPrice(ob.bottom))
        return (
          <g>
            <rect x={xL} y={Math.min(yT, yB)} width={width - xL} height={Math.max(2, Math.abs(yB - yT))} fill="#8b5cf6" opacity={0.14} stroke="#8b5cf6" strokeOpacity={0.5} strokeDasharray="4 3" />
            <text x={width - 6} y={Math.min(yT, yB) - 3} textAnchor="end" className="fill-violet-500 text-[9px] font-black">ORDER BLOCK · exit</text>
          </g>
        )
      })()}

      {/* CHoCH markers */}
      {data.choch.map((e, i) => {
        const x = xForTime(e.time)
        if (x == null) return null
        const y = clampY(yForPrice(e.price))
        const color = e.direction === 'bullish' ? BULL : BEAR
        return (
          <g key={`choch-${i}`} opacity={0.9}>
            <line x1={x} x2={x} y1={y - 6} y2={y + 6} stroke={color} strokeWidth={1.4} />
            <text x={x + 3} y={y - 6} className="text-[8px] font-black" fill={color}>CHoCH</text>
          </g>
        )
      })}

      {/* Strategy entry / stop / target lines */}
      {s.valid && s.entry != null && (() => {
        const line = (price: number, color: string, label: string, dash: string) => {
          const y = clampY(yForPrice(price))
          return (
            <g>
              <line x1={0} x2={width} y1={y} y2={y} stroke={color} strokeWidth={1.2} strokeDasharray={dash} opacity={0.85} />
              <text x={6} y={y - 3} className="text-[9px] font-black" fill={color}>{label} {price.toFixed(2)}</text>
            </g>
          )
        }
        const dir = s.direction === 'bullish' ? BULL : BEAR
        return (
          <g>
            {line(s.entry, dir, 'ENTRY (FVG mid)', '6 3')}
            {s.stop != null && line(s.stop, BEAR, 'STOP', '2 3')}
            {s.target != null && line(s.target, BULL, 'TARGET (OB)', '2 3')}
          </g>
        )
      })()}
    </g>
  )
}
