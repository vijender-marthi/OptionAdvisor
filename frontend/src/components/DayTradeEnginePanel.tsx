import { RefreshCw } from 'lucide-react'
import type { DayTradeScanResult } from '../api/client'
import DayTradeIntradayChart, { parseChartBars } from './DayTradeIntradayChart'
import { coerceTraderDecision, DayTradeTraderDecisionExpanded } from './DayTradeTraderDecision'

export function verdictStyle(verdict: string) {
  if (verdict === 'READY' || verdict === 'STRONG GO') {
    return {
      bg: 'bg-emerald-950/70',
      border: 'border-emerald-500/70',
      text: 'text-emerald-200',
      ring: 'ring-emerald-400/35',
    }
  }
  if (verdict === 'WATCH' || verdict === 'GO') {
    return {
      bg: 'bg-amber-950/40',
      border: 'border-amber-600/50',
      text: 'text-amber-200',
      ring: 'ring-amber-500/25',
    }
  }
  if (verdict === 'AVOID' || verdict === 'EXIT' || verdict === 'NO-GO') {
    return {
      bg: 'bg-rose-950/50',
      border: 'border-rose-600/50',
      text: 'text-rose-300',
      ring: 'ring-rose-500/30',
    }
  }
  return {
    bg: 'bg-gray-800/80',
    border: 'border-gray-600/50',
    text: 'text-gray-200',
    ring: 'ring-gray-500/20',
  }
}

function MetricRow({
  label,
  value,
  valueClassName = 'text-gray-200',
}: {
  label: string
  value: string
  /** Tailwind classes for the value column (semantic green / red where it helps). */
  valueClassName?: string
}) {
  return (
    <div className="flex justify-between gap-3 border-b border-gray-800/80 py-2 text-sm last:border-0">
      <span className="text-gray-500">{label}</span>
      <span className={`font-mono text-right font-medium ${valueClassName}`}>{value}</span>
    </div>
  )
}

function asFiniteNum(x: unknown): number | null {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null
  if (typeof x === 'string' && x.trim() !== '') {
    const n = Number(x)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function fmtPct(x: unknown) {
  const n = asFiniteNum(x)
  return n === null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

function fmtNum(x: unknown, d = 2) {
  const n = asFiniteNum(x)
  return n === null ? '—' : n.toFixed(d)
}

/** Signed % display: green if &gt; 0, red if &lt; 0, neutral at 0. */
function signedPctClass(n: number | null): string {
  if (n === null) return 'text-gray-200'
  if (n > 0) return 'text-emerald-400'
  if (n < 0) return 'text-rose-400'
  return 'text-gray-300'
}

function orPositionClass(raw: string): string {
  const s = raw.toLowerCase()
  if (s === 'above') return 'text-emerald-400'
  if (s === 'below') return 'text-rose-400'
  if (s === 'inside') return 'text-amber-400/90'
  return 'text-gray-200'
}

function volumeSpikeClass(yes: boolean): string {
  return yes ? 'text-emerald-400' : 'text-rose-400/95'
}

function vixClass(n: number | null): string {
  if (n === null) return 'text-gray-200'
  if (n >= 30) return 'text-rose-400'
  if (n <= 18) return 'text-emerald-400/90'
  return 'text-gray-200'
}

const CONF_LABEL: Record<string, string> = {
  trend_strength: 'Trend strength',
  breakout_quality: 'Breakout quality',
  volume_confirmation: 'Volume confirmation',
  market_alignment: 'Market alignment',
  risk: 'Risk',
}

function confidenceTone(dim: string, val: string): string {
  switch (dim) {
    case 'risk':
      if (val === 'LOW') return 'text-emerald-400'
      if (val === 'MEDIUM') return 'text-amber-400'
      return 'text-rose-400'
    case 'trend_strength':
      if (val === 'HIGH') return 'text-emerald-400'
      if (val === 'MEDIUM') return 'text-amber-400'
      return 'text-gray-400'
    case 'breakout_quality':
      if (val === 'GOOD') return 'text-emerald-400'
      if (val === 'FAIR') return 'text-amber-400'
      return 'text-rose-400'
    case 'volume_confirmation':
      return val === 'STRONG' ? 'text-emerald-400' : 'text-rose-400'
    case 'market_alignment':
      if (val === 'STRONG') return 'text-emerald-400'
      if (val === 'MEDIUM') return 'text-amber-400'
      return 'text-rose-400'
    default:
      return 'text-gray-200'
  }
}

function rsSessionClass(rs: number | null): string {
  if (rs === null) return 'text-gray-200'
  if (rs >= 0.02) return 'text-emerald-400'
  if (rs <= -0.02) return 'text-rose-400'
  return 'text-gray-300'
}

function decisionBadgeClass(value: string): string {
  const v = value.toUpperCase()
  if (v === 'READY' || v === 'TRADE') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
  if (v === 'WATCH' || v === 'WAIT') return 'border-amber-500/40 bg-amber-500/10 text-amber-200'
  if (v === 'AVOID' || v === 'EXIT' || v === 'NO_EDGE') return 'border-rose-500/40 bg-rose-500/10 text-rose-200'
  if (v === 'BULLISH') return 'border-emerald-600/35 bg-emerald-500/10 text-emerald-200'
  if (v === 'BEARISH') return 'border-rose-600/35 bg-rose-500/10 text-rose-200'
  if (v === 'MIXED') return 'border-sky-700/35 bg-sky-500/10 text-sky-200'
  if (v === 'STRONG' || v === 'GOOD') return 'border-emerald-600/35 bg-emerald-500/10 text-emerald-200'
  if (v === 'FAIR' || v === 'WEAK') return 'border-amber-500/40 bg-amber-500/10 text-amber-200'
  if (v === 'POOR') return 'border-rose-500/40 bg-rose-500/10 text-rose-200'
  if (v === 'LOW') return 'border-emerald-600/35 bg-emerald-500/10 text-emerald-200'
  if (v === 'MEDIUM') return 'border-amber-500/40 bg-amber-500/10 text-amber-200'
  if (v === 'HIGH' || v === 'EXTREME') return 'border-rose-500/40 bg-rose-500/10 text-rose-200'
  return 'border-gray-700/40 bg-gray-800/80 text-gray-200'
}

function DecisionCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-800/90 bg-black/20 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase ${decisionBadgeClass(value)}`}>
        {value || '—'}
      </div>
    </div>
  )
}

/** Full verdict + metrics + notes — same content as the Day Trade Engine result card. */
export default function DayTradeEnginePanel({
  result,
  onRefresh,
  refreshing,
  showRefresh = true,
  onRequestEnterActiveTrade,
}: {
  result: DayTradeScanResult
  onRefresh?: () => void
  refreshing?: boolean
  showRefresh?: boolean
  /** When set, shows admin-only CTA to persist this symbol for Day Trade Active monitoring. */
  onRequestEnterActiveTrade?: () => void
}) {
  const cfg = verdictStyle(result.final_decision)
  const m = result.metrics ?? {}
  const vwapDist = asFiniteNum(m.vwap_dist_pct)
  const mom = asFiniteNum(m.momentum_pct)
  const spyChg = m.spy_change_pct == null ? null : asFiniteNum(m.spy_change_pct)
  const qqqChg = m.qqq_change_pct == null ? null : asFiniteNum(m.qqq_change_pct)
  const vixN = m.vix == null ? null : asFiniteNum(m.vix)
  const orBreakout = String(m.or_breakout ?? '—')
  const rsN = m.rs_vs_qqq_pct == null ? null : asFiniteNum(m.rs_vs_qqq_pct)
  const rsLabel = typeof m.rs_vs_qqq_label === 'string' ? m.rs_vs_qqq_label : null
  const confRaw = m.confidence
  const confidence =
    confRaw && typeof confRaw === 'object' && !Array.isArray(confRaw)
      ? (confRaw as Record<string, string>)
      : null
  const confOrder = ['trend_strength', 'breakout_quality', 'volume_confirmation', 'market_alignment', 'risk'] as const
  const chartBars = parseChartBars(m.chart_bars)
  const orChartHigh = asFiniteNum(m.or_high)
  const orChartLow = asFiniteNum(m.or_low)
  const orMinN = typeof m.or_minutes === 'number' && m.or_minutes > 0 ? m.or_minutes : 15
  const td = coerceTraderDecision(result.trader_decision ?? null)

  return (
    <section className={`rounded-2xl border ${cfg.border} ${cfg.bg} ring-1 ${cfg.ring} p-4 sm:p-5 space-y-4`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xs text-gray-500 font-mono">{result.ticker}</div>
          <div className="text-sm text-gray-400">{result.company_name}</div>
        </div>
        {showRefresh && onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="text-xs text-gray-400 hover:text-violet-400 flex items-center gap-1 shrink-0"
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> Refresh
          </button>
        )}
      </div>

      <div className="text-center py-2">
        <div className={`font-black tracking-tight text-3xl sm:text-4xl ${cfg.text}`}>{result.final_decision}</div>
        <p className="mt-2 text-sm text-gray-300">{result.reason || 'No clean trigger yet.'}</p>
        <p className="mt-1 text-[11px] text-gray-500">
          Market bias does not equal execution. Engine score: <span className="text-gray-300">{result.verdict}</span>
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <DecisionCell label="Market Bias" value={result.market_bias} />
        <DecisionCell label="Setup Quality" value={result.setup_quality} />
        <DecisionCell label="Execution Readiness" value={result.execution_readiness} />
        <DecisionCell label="Final Decision" value={result.final_decision} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-gray-800/90 bg-black/15 px-3 py-3">
          <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-wide text-gray-500">
            <span>Confidence</span>
            <span className="font-semibold text-gray-300">{result.confidence}%</span>
          </div>
          <div className="mt-2 h-2 rounded-full bg-gray-800">
            <div
              className={`${result.confidence >= 70 ? 'bg-emerald-400' : result.confidence >= 45 ? 'bg-amber-400' : 'bg-rose-400'} h-2 rounded-full`}
              style={{ width: `${Math.max(0, Math.min(100, result.confidence))}%` }}
            />
          </div>
        </div>
        <div className="rounded-xl border border-gray-800/90 bg-black/15 px-3 py-3">
          <div className="text-[10px] uppercase tracking-wide text-gray-500">Risk State</div>
          <div className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase ${decisionBadgeClass(result.risk_state)}`}>
            {result.risk_state}
          </div>
        </div>
      </div>

      {result.missing_confirmations.length > 0 && (
        <div className="rounded-xl border border-amber-700/30 bg-amber-950/20 px-3 py-3">
          <div className="text-[10px] uppercase tracking-wide text-amber-200/80">Missing Confirmations</div>
          <p className="mt-1 text-sm text-amber-100/90">{result.missing_confirmations.join(' · ')}</p>
        </div>
      )}

      {td ? <DayTradeTraderDecisionExpanded td={td} /> : null}

      {chartBars && orChartHigh != null && orChartLow != null && (
        <DayTradeIntradayChart
          bars={chartBars}
          orHigh={orChartHigh}
          orLow={orChartLow}
          orMinutes={orMinN}
          sessionDate={String(m.session_date ?? '')}
        />
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-emerald-950/25 border border-emerald-800/40 px-3 py-2 text-center ring-1 ring-emerald-500/10">
          <div className="text-[10px] uppercase tracking-wide text-emerald-600/80 dark:text-emerald-500/80">Bull score</div>
          <div className="text-xl font-mono tabular-nums text-emerald-400 drop-shadow-[0_0_12px_rgba(52,211,153,0.15)]">
            {result.bull_score}
          </div>
        </div>
        <div className="rounded-xl bg-rose-950/25 border border-rose-800/40 px-3 py-2 text-center ring-1 ring-rose-500/10">
          <div className="text-[10px] uppercase tracking-wide text-rose-600/80 dark:text-rose-500/80">Bear score</div>
          <div className="text-xl font-mono tabular-nums text-rose-400 drop-shadow-[0_0_12px_rgba(251,113,133,0.12)]">
            {result.bear_score}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-violet-900/40 bg-violet-950/20 px-3 py-2.5">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-violet-400/90 mb-2">
          Intraday confidence
        </div>
        {confidence ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {confOrder.map(key => {
              const val = confidence[key]
              if (!val) return null
              return (
                <div
                  key={key}
                  className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 rounded-lg border border-gray-800/80 bg-black/20 px-2.5 py-1.5 text-sm"
                >
                  <span className="text-gray-500">{CONF_LABEL[key] ?? key}</span>
                  <span className={`font-bold font-mono tabular-nums ${confidenceTone(key, val)}`}>
                    {val}
                  </span>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-xs text-gray-500">Confidence scores unavailable.</p>
        )}
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-950/50 px-3 py-1">
        <MetricRow label="Session (ET date)" value={String(m.session_date ?? '—')} />
        <MetricRow
          label="Last"
          value={`$${fmtNum(m.last_price, 4)}`}
          valueClassName="text-gray-100"
        />
        <MetricRow label="VWAP" value={`$${fmtNum(m.vwap, 4)}`} valueClassName="text-sky-300/90" />
        <MetricRow
          label="vs VWAP"
          value={fmtPct(m.vwap_dist_pct)}
          valueClassName={signedPctClass(vwapDist)}
        />
        <MetricRow
          label="Opening range (15m)"
          value={`$${fmtNum(m.or_low, 2)} – $${fmtNum(m.or_high, 2)}`}
          valueClassName="text-gray-300"
        />
        <MetricRow label="OR position" value={orBreakout} valueClassName={orPositionClass(orBreakout)} />
        <MetricRow
          label="Momentum (recent)"
          value={fmtPct(m.momentum_pct)}
          valueClassName={signedPctClass(mom)}
        />
        <MetricRow
          label="Volume spike"
          value={m.volume_spike ? 'Yes' : 'No'}
          valueClassName={volumeSpikeClass(!!m.volume_spike)}
        />
        {rsLabel != null && (
          <div className="border-b border-gray-800/80 py-2 text-sm last:border-0">
            <div className="text-gray-500 mb-1">RS vs QQQ (session)</div>
            <p className={`text-right font-medium leading-snug pl-2 ${rsSessionClass(rsN)}`}>{rsLabel}</p>
          </div>
        )}
        {rsLabel == null && rsN !== null && (
          <MetricRow
            label="RS vs QQQ (session)"
            value={`${rsN >= 0 ? '+' : ''}${rsN.toFixed(2)}%`}
            valueClassName={rsSessionClass(rsN)}
          />
        )}
        <MetricRow
          label="SPY (daily chg %)"
          value={m.spy_change_pct == null ? '—' : fmtPct(m.spy_change_pct)}
          valueClassName={spyChg === null ? 'text-gray-200' : signedPctClass(spyChg)}
        />
        <MetricRow
          label="QQQ (daily chg %)"
          value={m.qqq_change_pct == null ? '—' : fmtPct(m.qqq_change_pct)}
          valueClassName={qqqChg === null ? 'text-gray-200' : signedPctClass(qqqChg)}
        />
        <MetricRow
          label="SPY (session chg %)"
          value={m.spy_session_change_pct == null ? '—' : fmtPct(m.spy_session_change_pct)}
          valueClassName={signedPctClass(asFiniteNum(m.spy_session_change_pct))}
        />
        <MetricRow
          label="QQQ (session chg %)"
          value={m.qqq_session_change_pct == null ? '—' : fmtPct(m.qqq_session_change_pct)}
          valueClassName={signedPctClass(asFiniteNum(m.qqq_session_change_pct))}
        />
        <MetricRow
          label="VIX"
          value={m.vix == null ? '—' : fmtNum(m.vix, 2)}
          valueClassName={vixClass(vixN)}
        />
        <MetricRow label="1m bars (RTH)" value={String(m.bars_used ?? '—')} />
      </div>

      {onRequestEnterActiveTrade && (
        <div className="rounded-xl border border-orange-700/35 bg-orange-950/25 px-3 py-3">
          <p className="text-[11px] text-orange-200/80 mb-2">
            Save this symbol for the <span className="font-semibold text-orange-100">Day Trade Active</span> monitor
            (option entry + intraday guidance).
          </p>
          <button
            type="button"
            onClick={onRequestEnterActiveTrade}
            className="w-full rounded-xl bg-orange-600/90 hover:bg-orange-500 text-white text-sm font-semibold py-2.5 px-3 transition-colors"
          >
            Day Trade Active
          </button>
        </div>
      )}

      <div>
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Signal notes</div>
        <ul className="space-y-1.5 text-sm">
          {result.reasons.map((r, i) => {
            const lower = r.toLowerCase()
            let lineClass = 'text-gray-400'
            if (lower.startsWith('strong go')) lineClass = 'text-emerald-200'
            else if (lower.startsWith('go —') || lower.startsWith('go -')) lineClass = 'text-emerald-400/95'
            else if (lower.startsWith('watch')) lineClass = 'text-amber-300/95'
            else if (
              /above vwap|above opening|bullish|long-bias|positive broad|\+[\d.]+%/.test(lower)
              || lower.includes('long-bias context')
            ) {
              lineClass = 'text-emerald-400/95'
            } else if (
              /below vwap|below opening|bearish|short-bias|negative broad|-[\d.]+%/.test(lower)
              || lower.includes('short-bias context')
            ) {
              lineClass = 'text-rose-400/95'
            } else if (/vix very high|avoid new day-trade|no clear intraday|skipping|elevated vix/.test(lower)) {
              lineClass = 'text-amber-400/90'
            } else if (/volume spike confirms/.test(lower)) {
              lineClass = 'text-emerald-400/90'
            } else if (/outperforming qqq|lagging qqq|vs qqq:/.test(lower)) {
              lineClass = 'text-violet-400/90'
            } else if (/no volume spike|expansion not confirmed|reversal risk|headline risk|fragile follow/.test(lower)) {
              lineClass = 'text-amber-400/85'
            } else if (/inside opening range|range-bound|choppy/.test(lower)) {
              lineClass = 'text-gray-400'
            }
            return (
              <li key={i} className={`flex gap-2 ${lineClass}`}>
                <span className="shrink-0 opacity-80">·</span>
                <span>{r}</span>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}

/** Compact price / verdict for watchlist summary row. */
export function formatDayTradeLastPrice(metrics: Record<string, unknown>): string {
  const n = asFiniteNum(metrics.last_price)
  return n === null ? '—' : `$${n.toFixed(2)}`
}
