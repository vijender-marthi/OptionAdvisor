/**
 * SwingTradeEnginePanel — Decision Quality Layer UI
 *
 * Main badge = final_action  (not raw score verdict)
 * Secondary badges = swing_bias  |  entry_quality  |  risk_level
 * Expandable section = decision message, strategy, expiry, confirmations, risk flags
 * Color rules:
 *   Green   STRONG_GO / QUALITY_LONG / GOOD_ENTRY
 *   Blue    WATCH_CALL_OR_DEBIT_SPREAD / WATCH_CALL / WATCH_PUT / GO_SMALL
 *   Orange  WAIT_PULLBACK / AVOID_CHASE / WAIT_BREAKOUT / EXTENDED / CAUTION_ENTRY
 *   Red     AVOID_NAKED_CALLS / NO_TRADE / HIGH / VERY_HIGH risk
 *   Gray    MARKET_CONFIRMATION_ONLY / NO_TRADE_WAIT / NEUTRAL
 */
import { useState } from 'react'
import {
  RefreshCw, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronRight,
  ShieldAlert, AlertTriangle, CheckCircle2, Clock, Layers,
} from 'lucide-react'
import type { SwingTradeScanResult } from '../api/client'
import {
  formatSwingEngineLabel,
  toneForBias,
  toneForFinalAction,
  playbookHintFromResult,
  swingEngineSecondaryBadgeItems,
  TONE_ACTION_BADGE,
  TONE_BADGE,
  TONE_DOT,
  TONE_RING,
  type Tone,
} from '../utils/swingTradeEngineBadges'
import SwingTradeMetricCharts from './SwingTradeMetricCharts'

interface Props {
  result: SwingTradeScanResult
  onRefresh: () => void
  refreshing: boolean
}

function resolverBadgeClass(value: string): string {
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

function ResolverCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-800/90 bg-black/20 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase ${resolverBadgeClass(value)}`}>
        {formatSwingEngineLabel(value)}
      </div>
    </div>
  )
}

function Badge({ text, tone }: { text: string; tone: Tone }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold leading-none ${TONE_BADGE[tone]}`}>
      {formatSwingEngineLabel(text)}
    </span>
  )
}

function ScoreBar({ label, value, tone }: { label: string; value: number; tone: Tone }) {
  const pct  = Math.min(100, (Math.max(0, value) / 11) * 100)
  const fill = tone === 'green' ? 'bg-emerald-500' : tone === 'orange' ? 'bg-amber-500' : tone === 'red' ? 'bg-rose-500' : 'bg-sky-500'
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 shrink-0 text-gray-500 font-semibold uppercase tracking-wide">{label}</span>
      <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${fill}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right font-mono text-gray-300 tabular-nums">{value.toFixed(1)}</span>
    </div>
  )
}

function RiskFlagPill({ flag }: { flag: string }) {
  const isHard = flag.includes('EARNINGS') || flag.includes('LIQUIDITY') || flag === 'IV_VERY_HIGH'
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
      isHard
        ? 'bg-rose-900/40 text-rose-300 border border-rose-700/40'
        : 'bg-amber-900/30 text-amber-300 border border-amber-700/30'
    }`}>
      {isHard ? <ShieldAlert size={10} /> : <AlertTriangle size={10} />}
      {formatSwingEngineLabel(flag)}
    </span>
  )
}

export default function SwingTradeEnginePanel({ result, onRefresh, refreshing }: Props) {
  const [detailOpen, setDetailOpen] = useState(false)
  const [signalsOpen, setSignalsOpen] = useState(false)

  const actionTone  = toneForFinalAction(result.final_action)
  const m           = result.metrics as Record<string, unknown>
  const secondaryBadges = swingEngineSecondaryBadgeItems(result)
  const playbookHint = playbookHintFromResult(result)

  const lastPrice   = typeof m.last_price === 'number' ? m.last_price : null
  const mom5d       = typeof m.momentum_5d_pct === 'number' ? m.momentum_5d_pct : null
  const vix         = typeof m.vix === 'number' ? m.vix : null
  const sessionDate = typeof m.session_date === 'string' ? m.session_date : null
  const spyBias     = typeof m.spy_bias === 'string' ? m.spy_bias : null
  const qqqBias     = typeof m.qqq_bias === 'string' ? m.qqq_bias : null

  const isLong  = result.bias === 'long'
  const isShort = result.bias === 'short'

  return (
    <div className={`rounded-2xl border border-gray-800 bg-gray-900/70 overflow-hidden ${TONE_RING[actionTone]}`}>

      {/* ── Header ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`flex-none w-2.5 h-2.5 rounded-full animate-pulse ${TONE_DOT[actionTone]}`} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-lg font-bold text-white font-mono">{result.ticker}</span>
              {result.company_name && (
                <span className="text-xs text-gray-500 truncate max-w-[180px]">{result.company_name}</span>
              )}
            </div>
            {sessionDate && (
              <div className="text-[10px] text-gray-600">{sessionDate}</div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`rounded-full px-3 py-1 text-xs font-bold tracking-wide ${resolverBadgeClass(result.final_decision)}`}>
            {formatSwingEngineLabel(result.final_decision)}
          </span>
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            title="Re-scan"
            className="rounded-lg p-1.5 text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-40"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="px-4 py-3 border-b border-gray-800 bg-gray-950/25 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <ResolverCell label="Market Bias" value={result.market_bias} />
          <ResolverCell label="Setup Quality" value={result.setup_quality} />
          <ResolverCell label="Execution Readiness" value={result.execution_readiness} />
          <ResolverCell label="Final Decision" value={result.final_decision} />
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
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
            <div className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase ${resolverBadgeClass(result.risk_state)}`}>
              {formatSwingEngineLabel(result.risk_state)}
            </div>
          </div>
        </div>
        <p className="text-sm text-gray-300">{result.reason || result.decision_message}</p>
        {result.missing_confirmations.length > 0 ? (
          <p className="text-xs text-amber-200/90">
            Missing confirmations: {result.missing_confirmations.join(' · ')}
          </p>
        ) : null}
      </div>

      {/* ── Secondary badges strip ────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-gray-800 bg-gray-900/30">
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold leading-none ${TONE_ACTION_BADGE[actionTone]}`}>
          {formatSwingEngineLabel(result.final_action)}
        </span>
        {secondaryBadges.map((item, i) => (
          <span key={`${item.label}-${item.text}`} className="contents">
            {i > 0 ? <span className="text-gray-800 text-xs">·</span> : null}
            <div className="flex items-center gap-1.5">
              {item.label === 'Bias' ? (
                <>
                  {isLong && <TrendingUp size={12} className="text-emerald-400" />}
                  {isShort && <TrendingDown size={12} className="text-rose-400" />}
                  {!result.bias && <Minus size={12} className="text-gray-500" />}
                </>
              ) : null}
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-600">{item.label}</span>
              <Badge text={item.text} tone={item.tone} />
            </div>
          </span>
        ))}
      </div>

      {/* ── Options playbook (server-derived) ───────────────────────── */}
      {playbookHint ? (
        <div className="swing-options-playbook px-4 py-3 border-b border-gray-800 border-l-4 border-l-violet-500/70 bg-violet-950/20">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-violet-300/90 mb-1.5 flex items-center gap-1.5">
            <Layers size={10} className="shrink-0 opacity-90" />
            Options playbook
          </div>
          <p className="text-sm text-gray-200 leading-relaxed">
            {playbookHint}
          </p>
        </div>
      ) : null}

      {/* ── Score bars + price strip ──────────────────────────────── */}
      <div className="px-4 py-3 border-b border-gray-800 space-y-2.5">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-3 text-xs">
            {lastPrice !== null && (
              <span className="font-mono text-gray-300 font-semibold">${lastPrice.toFixed(2)}</span>
            )}
            {mom5d !== null && (
              <span className={`font-semibold ${mom5d >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                5d {mom5d >= 0 ? '+' : ''}{mom5d.toFixed(2)}%
              </span>
            )}
            {vix !== null && (
              <span className={`font-semibold ${vix >= 30 ? 'text-rose-400' : vix >= 20 ? 'text-amber-400' : 'text-gray-500'}`}>
                VIX {vix.toFixed(1)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 text-[10px] text-gray-600">
            <Layers size={10} />
            <span>Quality {result.trade_quality_score}/10</span>
          </div>
        </div>
        <ScoreBar label="Bull" value={result.bull_score} tone={result.bull_score >= result.bear_score ? 'green' : 'gray'} />
        <ScoreBar label="Bear" value={result.bear_score} tone={result.bear_score > result.bull_score ? 'red' : 'gray'} />
        <div className="pt-2 border-t border-gray-800/80">
          <SwingTradeMetricCharts metrics={m} />
        </div>
      </div>

      {/* ── Decision message (always visible) ────────────────────── */}
      {result.decision_message && (
        <div className="px-4 py-3 border-b border-gray-800">
          <p className="text-sm text-gray-300 leading-relaxed">{result.decision_message}</p>
          {result.avoid_reason && (
            <div className="mt-2 flex items-start gap-1.5 text-xs text-rose-300 bg-rose-950/30 border border-rose-800/40 rounded-lg px-3 py-2">
              <ShieldAlert size={12} className="shrink-0 mt-0.5" />
              {result.avoid_reason}
            </div>
          )}
        </div>
      )}

      {/* ── Risk flags (always visible when non-empty) ───────────── */}
      {result.risk_flags.length > 0 && (
        <div className="px-4 py-2.5 border-b border-gray-800">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-600 mb-1.5">Risk Flags</div>
          <div className="flex flex-wrap gap-1.5">
            {result.risk_flags.map(f => <RiskFlagPill key={f} flag={f} />)}
          </div>
        </div>
      )}

      {/* ── Expandable trade details ──────────────────────────────── */}
      <button
        type="button"
        onClick={() => setDetailOpen(v => !v)}
        className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-left text-xs font-semibold text-gray-500 hover:bg-gray-800/40 border-b border-gray-800 transition-colors"
      >
        <span>Trade Details</span>
        {detailOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>

      {detailOpen && (
        <div className="px-4 py-3 border-b border-gray-800 space-y-3 text-xs">
          {/* Strategy + expiry */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-gray-800/60 px-3 py-2.5">
              <div className="text-[9px] uppercase tracking-wide text-gray-600 mb-0.5">Suggested Strategy</div>
              <div className={`text-sm font-bold ${result.suggested_strategy === 'NO_TRADE' ? 'text-gray-500' : 'text-gray-100'}`}>
                {formatSwingEngineLabel(result.suggested_strategy)}
              </div>
            </div>
            <div className="rounded-xl bg-gray-800/60 px-3 py-2.5">
              <div className="text-[9px] uppercase tracking-wide text-gray-600 mb-0.5">Suggested Expiry</div>
              <div className={`text-sm font-bold ${result.suggested_expiry_window === 'No trade' ? 'text-gray-500' : 'text-gray-100'}`}>
                {result.suggested_expiry_window}
              </div>
            </div>
          </div>

          {/* Market context detail */}
          {(spyBias || qqqBias) && (
            <div className="rounded-xl bg-gray-800/40 px-3 py-2 space-y-1">
              <div className="text-[9px] uppercase tracking-wide text-gray-600 mb-0.5">Market Context</div>
              {spyBias && (
                <div className="flex justify-between items-center">
                  <span className="text-gray-500">SPY bias</span>
                  <Badge text={spyBias} tone={toneForBias(spyBias)} />
                </div>
              )}
              {qqqBias && (
                <div className="flex justify-between items-center">
                  <span className="text-gray-500">QQQ bias</span>
                  <Badge text={qqqBias} tone={toneForBias(qqqBias)} />
                </div>
              )}
            </div>
          )}

          {/* Confirmation needed */}
          {result.confirmation_needed.length > 0 && (
            <div>
              <div className="text-[9px] uppercase tracking-wide text-gray-600 mb-1.5">Confirmation Needed</div>
              <div className="space-y-1">
                {result.confirmation_needed.map((c, i) => (
                  <div key={i} className="flex items-start gap-2 text-gray-400 leading-relaxed">
                    <Clock size={11} className="shrink-0 mt-0.5 text-amber-500" />
                    {c}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Expandable signals list ───────────────────────────────── */}
      <button
        type="button"
        onClick={() => setSignalsOpen(v => !v)}
        className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-left text-xs font-semibold text-gray-500 hover:bg-gray-800/40 transition-colors"
      >
        <span>Raw Signals ({result.reasons.length})</span>
        {signalsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>

      {signalsOpen && (
        <div className="px-4 pb-4 pt-1 space-y-1.5">
          {result.reasons.map((r, i) => {
            const isBull = r.startsWith('STRONG GO') || r.startsWith('GO —') || r.includes('bullish') || r.includes('above')
            const isBear = r.startsWith('NO-GO') || r.includes('bearish') || r.includes('below') || r.includes('oversold') || r.includes('overbought')
            return (
              <div key={i} className="flex items-start gap-2 text-xs text-gray-400 leading-relaxed">
                {isBull && !isBear
                  ? <CheckCircle2 size={12} className="shrink-0 mt-0.5 text-emerald-500" />
                  : isBear && !isBull
                  ? <ShieldAlert size={12} className="shrink-0 mt-0.5 text-rose-500" />
                  : <Minus size={12} className="shrink-0 mt-0.5 text-gray-600" />
                }
                <span>{r}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
