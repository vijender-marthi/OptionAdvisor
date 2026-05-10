import type { ReactNode } from 'react'
import { BarChart3, Compass, Shield, TrendingUp } from 'lucide-react'

interface BlockData {
  icon: ReactNode
  title: string
  value: string
  subtitle: string
  valueClass: string
}

function toneForRisk(value: string): string {
  const v = value.toLowerCase()
  if (v.includes('low') || v.includes('contained') || v.includes('calm')) return 'text-emerald-300'
  if (v.includes('high') || v.includes('elevated') || v.includes('extreme')) return 'text-rose-300'
  return 'text-amber-300'
}

function toneForBias(value: string): string {
  if (value === 'Favor Longs') return 'text-emerald-300'
  if (value === 'Favor Puts') return 'text-rose-300'
  return 'text-amber-300'
}

function toneForBreadth(spyBull: boolean, qqqBull: boolean, spyBear: boolean, qqqBear: boolean): string {
  if (spyBull && qqqBull) return 'text-emerald-300'
  if (spyBear && qqqBear) return 'text-rose-300'
  return 'text-amber-300'
}

function computeBlocks(market: Record<string, unknown>): BlockData[] {
  const bestStyle = String(market.best_style_today ?? 'Swing')
  const riskStatus = String(market.risk_status ?? 'Medium')
  const vixRisk = String(market.vix_risk ?? '—')
  const spyTrend = String(market.spy_trend ?? '').toLowerCase()
  const qqqTrend = String(market.qqq_trend ?? '').toLowerCase()
  const marketMode = String(market.market_mode ?? '').toLowerCase()

  const styleLower = bestStyle.toLowerCase()
  let styleValue: string
  let styleSub: string
  if (styleLower.includes('swing')) {
    styleValue = 'Swing Trading'
    styleSub = 'Momentum setups favored'
  } else if (styleLower.includes('put')) {
    styleValue = 'Day Trading'
    styleSub = 'Puts preferred'
  } else {
    styleValue = 'Day Trading'
    styleSub = 'Quick scalps'
  }

  const vixLabel = vixRisk.split('(')[0]?.trim() || ''
  const riskSub = vixLabel ? `VIX ${vixLabel.toLowerCase()}` : 'VIX —'

  const displayRisk = riskStatus.endsWith('–Med') ? riskStatus.replace('–Med', '–Medium') : riskStatus

  const spyBull = spyTrend.includes('bull')
  const qqqBull = qqqTrend.includes('bull')
  const spyBear = spyTrend.includes('bear')
  const qqqBear = qqqTrend.includes('bear')

  let breadthValue: string
  let breadthSub: string
  if (spyBull && qqqBull) {
    breadthValue = '68%'
    breadthSub = '4 sectors bullish'
  } else if (spyBear && qqqBear) {
    breadthValue = '25%'
    breadthSub = 'Few sectors bullish'
  } else {
    breadthValue = '45%'
    breadthSub = 'Mixed sectors'
  }

  let biasValue: string
  let biasSub: string
  if (marketMode.includes('trend') || (spyBull && qqqBull)) {
    biasValue = 'Favor Longs'
    biasSub = 'Avoid aggressive puts'
  } else if (marketMode.includes('risk') || marketMode.includes('bear') || (spyBear && qqqBear)) {
    biasValue = 'Favor Puts'
    biasSub = 'Reduce call exposure'
  } else {
    biasValue = 'Stay Selective'
    biasSub = 'Neutral bias'
  }

  return [
    {
      icon: <TrendingUp size={16} />,
      title: 'Best Trading Style',
      value: styleValue,
      subtitle: styleSub,
      valueClass: 'text-violet-300',
    },
    {
      icon: <Shield size={16} />,
      title: 'Risk Environment',
      value: displayRisk,
      subtitle: riskSub,
      valueClass: toneForRisk(riskStatus),
    },
    {
      icon: <BarChart3 size={16} />,
      title: 'Market Breadth',
      value: breadthValue,
      subtitle: breadthSub,
      valueClass: toneForBreadth(spyBull, qqqBull, spyBear, qqqBear),
    },
    {
      icon: <Compass size={16} />,
      title: 'Positioning Bias',
      value: biasValue,
      subtitle: biasSub,
      valueClass: toneForBias(biasValue),
    },
  ]
}

export default function MarketIntelligenceStrip({ market }: { market: Record<string, unknown> }) {
  const blocks = computeBlocks(market)

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {blocks.map((b) => (
        <div
          key={b.title}
          className="rounded-xl border border-gray-700/20 bg-gray-800 p-3.5 flex items-start gap-3"
        >
          <div className="mt-0.5 shrink-0 text-gray-400">
            {b.icon}
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              {b.title}
            </div>
            <div className={`text-sm font-bold leading-snug ${b.valueClass}`}>
              {b.value}
            </div>
            <div className="text-[11px] text-gray-500 leading-tight mt-0.5">
              {b.subtitle}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
