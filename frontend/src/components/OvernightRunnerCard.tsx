import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { ApiEnvelope } from '../types/commandCenter'

interface RunnerData {
  runner_score: number
  verdict: string
  confidence: string
  conditions: Record<string, { pass: boolean; label: string; points: number }>
  recommended_stop: number | null
  recommended_size_pct: number | null
}

interface Props {
  ticker: string
  currentPrice: number
  vwap: number
  orh: number
  orl: number
  intradayHighs: number[]
  volumeToday: number
  avgVolume20d: number
  spyTrendScore: number
  qqqTrendScore: number
  tickerTrendScore: number
  t1Hit: boolean
  t2Hit: boolean
  marketRegime: string
  onVerdict?: (verdict: string) => void
}

export default function OvernightRunnerCard({
  ticker, currentPrice, vwap, orh, orl, intradayHighs,
  volumeToday, avgVolume20d, spyTrendScore, qqqTrendScore,
  tickerTrendScore, t1Hit, t2Hit, marketRegime, onVerdict,
}: Props) {
  const [data, setData] = useState<RunnerData | null>(null)
  const [loading, setLoading] = useState(false)

  const evaluate = useCallback(async () => {
    setLoading(true)
    try {
      const { data: res } = await api.post<ApiEnvelope<RunnerData>>('/day-trade/overnight-runner', {
        ticker,
        current_price: currentPrice,
        vwap,
        orh,
        orl,
        intraday_highs: intradayHighs,
        volume_today: volumeToday,
        avg_volume_20d: avgVolume20d,
        spy_trend_score: spyTrendScore,
        qqq_trend_score: qqqTrendScore,
        ticker_trend_score: tickerTrendScore,
        t1_hit: t1Hit,
        t2_hit: t2Hit,
        market_regime: marketRegime,
      })
      if (res?.data) {
        setData(res.data as RunnerData)
        onVerdict?.((res.data as RunnerData).verdict)
      }
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [ticker, currentPrice, vwap, orh, orl, intradayHighs, volumeToday, avgVolume20d, spyTrendScore, qqqTrendScore, tickerTrendScore, t1Hit, t2Hit, marketRegime, onVerdict])

  useEffect(() => {
    if (t1Hit) void evaluate()
  }, [t1Hit, evaluate])

  if (!data) return null

  const score = data.runner_score
  const scoreColor = score >= 80 ? '#3fb950' : score >= 60 ? '#d29922' : '#f85149'
  const verdictIcon = score >= 80 ? '🟢' : score >= 60 ? '🟡' : '🔴'
  const condEntries = Object.entries(data.conditions)

  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-slate-900 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-100 dark:border-white/[0.05] flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          Overnight Runner Analysis
        </span>
        {loading && <span className="text-[10px] text-gray-500 ml-auto">Evaluating...</span>}
      </div>

      <div className="p-4 space-y-4">
        {/* Score + Verdict */}
        <div className="flex items-center gap-4">
          <div className="text-center">
            <div className="text-3xl font-extrabold tabular-nums" style={{ color: scoreColor }}>{score}</div>
            <div className="text-[10px] text-gray-500">/ 100</div>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-lg">{verdictIcon}</span>
              <span className="text-sm font-bold" style={{ color: scoreColor }}>{data.verdict}</span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Confidence:</span>
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                data.confidence === 'HIGH' ? 'bg-emerald-900/20 text-emerald-400' :
                data.confidence === 'MEDIUM' ? 'bg-yellow-900/20 text-yellow-400' :
                'bg-rose-900/20 text-rose-400'
              }`}>{data.confidence}</span>
            </div>
          </div>
        </div>

        {/* Conditions */}
        <div className="space-y-1.5">
          {condEntries.map(([key, cond]) => (
            <div key={key} className="flex items-center gap-2 text-xs">
              <span className={cond.pass ? 'text-emerald-400' : 'text-rose-400'}>
                {cond.pass ? '✓' : '✗'}
              </span>
              <span className={cond.pass ? 'text-gray-200' : 'text-gray-500'}>{cond.label}</span>
              <span className="ml-auto text-[10px] text-gray-500 font-mono">+{cond.points}</span>
            </div>
          ))}
        </div>

        {/* Action */}
        <div className="rounded-lg border border-slate-200 dark:border-white/[0.08] bg-gray-50 dark:bg-slate-800/40 p-3">
          {data.verdict === 'CLOSE ENTIRE POSITION' ? (
            <div className="text-xs text-rose-400 font-semibold">Take profits at T1. Close entire position. Do not hold overnight.</div>
          ) : (
            <div className="space-y-1 text-xs">
              <div className="text-emerald-400 font-semibold">Take profits at T1. Keep {data.recommended_size_pct}% overnight.</div>
              {data.recommended_stop && (
                <div className="text-gray-400">
                  Stop: <span className="font-mono font-bold text-gray-200">${data.recommended_stop.toFixed(2)}</span>
                  {' '}· Max(VWAP, Previous Swing Low, Breakeven)
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
