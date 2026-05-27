import { useState } from 'react'
import { ChevronDown, ChevronRight, Activity, ShieldAlert } from 'lucide-react'
import type { UnifiedAnalysis, SwingTradeScanResult } from '../api/client'
import { getDecisionBadgeClass } from '../utils/semanticTrading'

type Tone = 'green' | 'blue' | 'orange' | 'red' | 'gray'

const TONE_BADGE: Record<Tone, string> = {
  green: getDecisionBadgeClass('READY'),
  blue: getDecisionBadgeClass('GO'),
  orange: getDecisionBadgeClass('WATCH'),
  red: getDecisionBadgeClass('AVOID'),
  gray: getDecisionBadgeClass('NEUTRAL'),
}

function fmtChg(pct: number | null): string | null {
  if (pct == null) return null
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
}

function fmtPct(v: unknown): string | null {
  const n = typeof v === 'number' ? v : null
  if (n === null || !isFinite(n)) return null
  return `${n.toFixed(1)}%`
}

function fmtPrice(v: unknown): string | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : null
  if (n === null || !isFinite(n)) return null
  return `$${n.toFixed(2)}`
}

function fmtNum(v: unknown, d = 2): string | null {
  const n = typeof v === 'number' ? v : null
  if (n === null || !isFinite(n)) return null
  return n.toFixed(d)
}

function verdictTone(verdict: string): Tone {
  const v = verdict.toUpperCase().replace(/ /g, '_')
  if (v === 'STRONG_GO' || v === 'GO' || v === 'ENTER' || v === 'READY') return 'green'
  if (v === 'WATCH') return 'blue'
  if (v === 'WAIT') return 'orange'
  return 'red'
}

function verdictLabel(verdict: string): string {
  const v = verdict.toUpperCase().replace(/ /g, '_')
  if (v === 'STRONG_GO') return 'Strong Go'
  if (v === 'GO' || v === 'READY') return 'Go'
  if (v === 'WATCH') return 'Watch'
  if (v === 'WAIT') return 'Wait'
  if (v === 'NO_EDGE') return 'No Edge'
  return 'Avoid'
}

function ExecMapRow({ label, value, tone }: { label: string; value: string | null; tone?: string }) {
  if (!value) return null
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-800/90 bg-black/15 px-3 py-2">
      <span className="text-[10px] uppercase tracking-wide text-gray-500">{label}</span>
      <span className={`text-xs font-semibold font-mono tabular-nums ${tone || 'text-gray-200'}`}>{value}</span>
    </div>
  )
}

function toneForLabel(l: string): string | undefined {
  const u = l.toUpperCase()
  if (u === 'BULLISH' || u === 'STRONG' || u === 'LOW' || u === 'ADEQUATE' || u.includes('SUPPORTIVE')) return 'text-emerald-400'
  if (u === 'BEARISH' || u === 'WEAK' || u === 'HIGH' || u === 'EXTENDED' || u.includes('WEAK')) return 'text-red-400'
  if (u === 'MIXED' || u === 'MODERATE' || u === 'MANAGEABLE' || u === 'ELEVATED') return 'text-amber-400'
  return undefined
}

export default function SwingTradeWalkthrough({ unified, result }: { unified: UnifiedAnalysis; result?: SwingTradeScanResult | null }) {
  const [open, setOpen] = useState(false)
  const tone = verdictTone(unified.verdict)
  const label = verdictLabel(unified.verdict)
  const m = (result?.metrics ?? {}) as Record<string, unknown>
  const el = (m.exec_levels ?? {}) as Record<string, unknown>
  const spread = unified.spread_entry

  const focusStep: number = (unified.verdict === 'AVOID' || unified.verdict === 'NO_EDGE') ? 1 : unified.verdict === 'WATCH' ? 2 : unified.verdict === 'WAIT' ? 3 : unified.coach ? 6 : 5
  const focusToneText = tone === 'green' ? 'text-semantic-bullish'
    : tone === 'orange' ? 'text-semantic-warning'
    : tone === 'red' ? 'text-semantic-bearish'
    : 'text-semantic-info'
  const focusBorderLeft = tone === 'green' ? 'border-l-4 border-l-semantic-bullish'
    : tone === 'orange' ? 'border-l-4 border-l-semantic-warning'
    : tone === 'red' ? 'border-l-4 border-l-semantic-bearish'
    : 'border-l-4 border-l-semantic-info'

  const marketCtx = typeof m.market_context === 'string' ? m.market_context : ''
  const ma20 = typeof m.ma20 === 'number' ? m.ma20 : null
  const ma50 = typeof m.ma50 === 'number' ? m.ma50 : null
  const distMA20 = typeof m.dist_ma20_pct === 'number' ? m.dist_ma20_pct : null
  const iv = typeof m.implied_iv_pct === 'number' ? m.implied_iv_pct : null
  const hv20 = typeof m.hv_20 === 'number' ? m.hv_20 : null
  const volRatio = typeof m.volume_ratio === 'number' ? m.volume_ratio : null
  const rsi = typeof m.rsi === 'number' ? m.rsi : null
  const exitRules: Array<Record<string, unknown>> = Array.isArray(m.exit_rules) ? m.exit_rules as Array<Record<string, unknown>> : []

  return (
    <div className="swing-trade-walkthrough rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 cursor-pointer select-none" onClick={() => setOpen(v => !v)}>
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-semantic-accent">Step-by-Step Trade Workflow</div>
          <div className="text-[10px] mt-0.5 text-gray-500">Market context, execution, and risk management</div>
        </div>
        {open ? <ChevronDown size={14} className="text-gray-500" /> : <ChevronRight size={14} className="text-gray-500" />}
      </div>

      {open && (<div>
        {/* Step 1: Market & Price Context */}
        <div className={`px-4 py-4 border-b border-gray-800 space-y-3${focusStep === 1 ? ` ${focusBorderLeft}` : ''}`}>
          <div>
            <div className="flex items-center gap-2">
              <div className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${focusStep === 1 ? focusToneText : 'text-semantic-info'}`}>Step 1</div>
              {focusStep === 1 && <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest ${TONE_BADGE[tone]}`}><Activity size={8} />{label}</span>}
            </div>
            <h2 className="mt-1 text-sm font-bold text-heading">Market &amp; Price Context</h2>
            <p className="mt-1 text-xs" style={{ color: '#9CA3AF' }}>Is the market helping or fighting this trade?</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
            <ExecMapRow label="Current Price" value={unified.price ? `$${unified.price.toFixed(2)}` : null} />
            <ExecMapRow label="Market Strength" value={result?.market_bias ? result.market_bias.replace(/_/g, ' ') : result?.swing_bias || null} tone={toneForLabel(result?.market_bias || result?.swing_bias || '')} />
            <ExecMapRow label="SPY Support" value={typeof m.spy_bias === 'string' ? m.spy_bias.replace(/_/g, ' ') : null} tone={toneForLabel(m.spy_bias as string || '')} />
            <ExecMapRow label="QQQ Support" value={typeof m.qqq_bias === 'string' ? m.qqq_bias.replace(/_/g, ' ') : null} tone={toneForLabel(m.qqq_bias as string || '')} />
            <ExecMapRow label="Dist. to MA20" value={distMA20 != null ? `${distMA20 >= 0 ? '+' : ''}${distMA20.toFixed(1)}% ${distMA20 > 5 ? 'EXTENDED' : distMA20 > 3 ? 'MODERATE' : 'NEAR'}` : null} tone={distMA20 != null && Math.abs(distMA20) > 5 ? 'text-red-400' : distMA20 != null && Math.abs(distMA20) > 3 ? 'text-amber-400' : 'text-emerald-400'} />
            <ExecMapRow label="Trend Phase" value={typeof m.market_phase === 'string' ? m.market_phase.replace(/_/g, ' ') : null} tone={toneForLabel(m.market_phase as string || '')} />
          </div>
          <div className="rounded-lg border border-gray-800/90 bg-black/15 px-3 py-2 text-xs text-gray-300 leading-relaxed">
            {marketCtx === 'MARKET_SUPPORTIVE'
              ? `Market backdrop is supportive.${typeof m.spy_bias === 'string' ? ` SPY is ${m.spy_bias.replace(/_/g, ' ').toLowerCase()}.` : ''}${distMA20 != null && Math.abs(distMA20) < 3 ? ' Price is near MA20 — ideal base for continuation.' : distMA20 != null && Math.abs(distMA20) > 5 ? ' Price is extended from MA20 — wait for pullback before entry.' : ' Monitor MA20 proximity before committing size.'}`
              : marketCtx === 'MARKET_WEAK'
              ? `Market context is fighting this trade.${typeof m.spy_bias === 'string' ? ` SPY is ${m.spy_bias.replace(/_/g, ' ').toLowerCase()}.` : ''} Reduce size and require stronger confirmation before entry.`
              : 'Market context is mixed. Let confirmation from structure and volume matter more than bias alone.'}
          </div>
        </div>

        {/* Step 2: Technical Analysis */}
        <div className={`px-4 py-4 border-b border-gray-800 space-y-3${focusStep === 2 ? ` ${focusBorderLeft}` : ''}`}>
          <div>
            <div className="flex items-center gap-2">
              <div className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${focusStep === 2 ? focusToneText : 'text-semantic-info'}`}>Step 2</div>
              {focusStep === 2 && <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest ${TONE_BADGE[tone]}`}><Activity size={8} />{label}</span>}
            </div>
            <h2 className="mt-1 text-sm font-bold text-heading">Technical Analysis</h2>
            <p className="mt-1 text-xs" style={{ color: '#9CA3AF' }}>Trend, momentum, extension, and volatility should all support the trade.</p>
          </div>

          <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-5">
            {(() => {
              const items: { label: string; value: string; tone: string }[] = []
              const trend = typeof m.trend === 'string' ? m.trend : null
              if (trend) items.push({ label: 'Trend', value: trend, tone: trend.includes('Bullish') ? 'text-emerald-400' : trend.includes('Bearish') ? 'text-red-400' : 'text-gray-200' })
              const mom = typeof m.momentum_label === 'string' ? m.momentum_label : null
              if (mom) items.push({ label: 'Momentum', value: mom, tone: mom === 'Strong' ? 'text-emerald-400' : mom === 'Weak' ? 'text-red-400' : 'text-amber-400' })
              if (rsi != null) items.push({ label: 'RSI', value: `${rsi.toFixed(0)}${rsi >= 70 ? ' (Overbought)' : rsi <= 30 ? ' (Oversold)' : ''}`, tone: rsi >= 70 ? 'text-red-400' : rsi <= 30 ? 'text-emerald-400' : 'text-gray-200' })
              const vol = typeof m.volume_label === 'string' ? m.volume_label : null
              if (vol) items.push({ label: 'Volume', value: vol, tone: vol === 'Strong' ? 'text-emerald-400' : vol === 'Weak' ? 'text-red-400' : 'text-amber-400' })
              const liq = typeof m.liquidity_label === 'string' ? m.liquidity_label : null
              if (liq) items.push({ label: 'Liquidity', value: liq, tone: liq === 'Strong' ? 'text-emerald-400' : liq === 'Weak' ? 'text-red-400' : 'text-amber-400' })
              if (iv != null) items.push({ label: 'IV Context', value: `${iv.toFixed(0)}%${iv < 25 ? ' (Low)' : iv < 40 ? ' (Moderate)' : ' (High)'}`, tone: iv < 25 ? 'text-emerald-400' : iv >= 40 ? 'text-red-400' : 'text-amber-400' })
              const mkt = typeof m.market_alignment === 'string' ? m.market_alignment : null
              if (mkt) items.push({ label: 'Market Align', value: mkt, tone: mkt === 'Aligned' ? 'text-emerald-400' : mkt === 'Conflicting' ? 'text-red-400' : 'text-amber-400' })
              const ext = typeof m.extension_label === 'string' ? m.extension_label : null
              if (ext) items.push({ label: 'Extension', value: ext, tone: ext === 'High' ? 'text-red-400' : ext === 'Low' ? 'text-emerald-400' : 'text-amber-400' })
              return items.map(item => (
                <div key={item.label} className="flex items-center justify-between rounded-lg bg-gray-800/40 px-3 py-1.5">
                  <span className="text-[11px] text-gray-500 font-medium">{item.label}</span>
                  <span className={`text-xs font-semibold font-mono tabular-nums ${item.tone}`}>{item.value}</span>
                </div>
              ))
            })()}
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            {ma20 != null ? <ExecMapRow label="MA20" value={`$${ma20.toFixed(2)}`} /> : null}
            {ma50 != null ? <ExecMapRow label="MA50" value={`$${ma50.toFixed(2)}`} /> : null}
            {iv != null ? <ExecMapRow label="IV" value={`${iv.toFixed(0)}%`} tone={iv > 40 ? 'text-red-400' : iv > 25 ? 'text-amber-400' : 'text-emerald-400'} /> : null}
            {hv20 != null ? <ExecMapRow label="HV20" value={`${hv20.toFixed(0)}%`} tone="text-semantic-accent" /> : null}
            {volRatio != null ? <ExecMapRow label="Volume Ratio" value={`${volRatio.toFixed(2)}x`} tone={volRatio > 1.5 ? 'text-emerald-400' : volRatio > 0.7 ? 'text-amber-400' : 'text-red-400'} /> : null}
          </div>
        </div>

        {/* Step 3: Execution Map */}
        <div className={`px-4 py-4 border-b border-gray-800 space-y-3${focusStep === 3 ? ` ${focusBorderLeft}` : ''}`}>
          <div>
            <div className="flex items-center gap-2">
              <div className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${focusStep === 3 ? focusToneText : 'text-semantic-info'}`}>Step 3</div>
              {focusStep === 3 && <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest ${TONE_BADGE[tone]}`}><Activity size={8} />{label}</span>}
            </div>
            <h2 className="mt-1 text-sm font-bold text-heading">Execution Map</h2>
            <p className="mt-1 text-xs" style={{ color: '#9CA3AF' }}>Where would I enter, where am I wrong, and where is the target?</p>
          </div>
          <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            <ExecMapRow label="Pullback Zone" value={el.pullback_zone ? String(el.pullback_zone) : null} tone="text-semantic-info" />
            <ExecMapRow label="Breakout Trigger" value={fmtPrice(el.breakout)} tone="text-emerald-400" />
            <ExecMapRow label="Risk Below" value={fmtPrice(el.stop)} tone="text-red-400" />
            <ExecMapRow label="First Target" value={fmtPrice(el.target1)} tone="text-emerald-400" />
            <ExecMapRow label="Stretch Target" value={fmtPrice(el.target2)} tone="text-amber-400" />
            <ExecMapRow label="DTE Window" value={result?.suggested_expiry_window && result.suggested_expiry_window !== 'No trade' ? result.suggested_expiry_window : null} />
          </div>
        </div>

        {/* Step 4: Strategy Selection */}
        <div className={`px-4 py-4 border-b border-gray-800 space-y-3${focusStep === 4 ? ` ${focusBorderLeft}` : ''}`}>
          <div>
            <div className="flex items-center gap-2">
              <div className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${focusStep === 4 ? focusToneText : 'text-semantic-info'}`}>Step 4</div>
              {focusStep === 4 && <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest ${TONE_BADGE[tone]}`}><Activity size={8} />{label}</span>}
            </div>
            <h2 className="mt-1 text-sm font-bold text-heading">Strategy Selection</h2>
            <p className="mt-1 text-xs" style={{ color: '#9CA3AF' }}>Choose the structure that best matches momentum, IV context, and risk appetite.</p>
          </div>
          <div className="rounded-xl border border-gray-800/90 bg-black/15 px-3 py-3 space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-600">Selected Structure</div>
            <div className="text-xl font-bold font-mono text-gray-200">{result?.suggested_strategy ? result.suggested_strategy.replace(/_/g, ' ') : unified.structure || 'See analysis'}</div>
            {unified.entry_description && (
              <div className="text-xs" style={{ color: '#00A86B' }}>{unified.entry_description}</div>
            )}
            {result?.recommended_contract_duration ? (
              <div className="text-xs text-gray-500 font-mono">Contract duration: {result.recommended_contract_duration} DTE</div>
            ) : null}

            {unified.conditions.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-600 mt-2 mb-1">ENTRY CONDITIONS</div>
                <div className="flex flex-wrap gap-1.5">
                  {unified.conditions.map((c, i) => (
                    <span key={i} className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium" style={{
                      background: c.type === 'pass' ? 'rgba(0,168,107,0.1)' : c.type === 'warn' ? 'rgba(212,160,23,0.1)' : 'rgba(208,49,45,0.1)',
                      color: c.type === 'pass' ? '#00A86B' : c.type === 'warn' ? '#D4A017' : '#D0312D',
                    }}>
                      {c.label}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {spread && (
              <div className="rounded-lg border border-gray-800/70 bg-black/10 px-3 py-3 space-y-2 mt-2">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Suggested Entry</div>
                <div className="text-xs font-semibold" style={{ color: '#00A86B' }}>{spread.strategy}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 4, background: 'rgba(0,168,107,0.06)' }}>
                    <span style={{ width: 40, fontWeight: 600, color: '#00A86B' }}>Buy</span>
                    <span className="font-mono font-semibold" style={{ color: '#00A86B' }}>{spread.long_leg}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 4, background: 'rgba(208,49,45,0.06)' }}>
                    <span style={{ width: 40, fontWeight: 600, color: '#D0312D' }}>Sell</span>
                    <span className="font-mono font-semibold" style={{ color: '#D0312D' }}>{spread.short_leg}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 6px' }}>
                    <span className="text-gray-500">Expiry</span>
                    <span className="font-mono font-semibold text-gray-200">{spread.expiry}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 6px' }}>
                    <span className="text-gray-500">Est. Debit</span>
                    <span className="font-mono font-semibold" style={{ color: '#00A86B' }}>${spread.est_debit.toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 6px' }}>
                    <span className="text-gray-500">Max Gain</span>
                    <span className="font-mono font-semibold" style={{ color: '#00A86B' }}>${(spread.max_gain || 0).toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 6px' }}>
                    <span className="text-gray-500">Max Loss</span>
                    <span className="font-mono font-semibold" style={{ color: '#D0312D' }}>${(spread.max_loss || 0).toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 6px' }}>
                    <span className="text-gray-500">Breakeven</span>
                    <span className="font-mono font-semibold" style={{ color: '#00A86B' }}>${spread.breakeven.toFixed(2)}</span>
                  </div>
                </div>
                {spread.entry_note && (
                  <div style={{ padding: '6px 8px', borderRadius: 4, background: 'rgba(212,160,23,0.08)', fontSize: 11, fontWeight: 500, color: '#D4A017', marginTop: 2 }}>
                    {spread.entry_note}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="text-[10px] text-gray-600">Prices are estimated mid-market at scan time. Verify live before placing order.</div>
        </div>

        {/* Step 5: Final Decision */}
        <div className={`px-4 py-4 border-b border-gray-800 space-y-3${focusStep === 5 ? ` ${focusBorderLeft}` : ''}`}>
          <div>
            <div className="flex items-center gap-2">
              <div className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${focusStep === 5 ? focusToneText : 'text-semantic-info'}`}>Step 5</div>
              {focusStep === 5 && <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest ${TONE_BADGE[tone]}`}><Activity size={8} />{label}</span>}
            </div>
            <h2 className="mt-1 text-sm font-bold text-heading">Final Decision</h2>
            <p className="mt-1 text-xs" style={{ color: '#9CA3AF' }}>Translate setup quality into a trader action, not just a market opinion.</p>
          </div>
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
            <div className="rounded-lg border border-gray-800/90 bg-black/15 px-3 py-2 text-center">
              <div className="text-[9px] font-semibold uppercase tracking-widest text-gray-500 mb-1">Verdict</div>
              <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide ${TONE_BADGE[tone]}`}>{unified.verdict_raw || label}</span>
            </div>
            <div className="rounded-lg border border-gray-800/90 bg-black/15 px-3 py-2 text-center">
              <div className="text-[9px] font-semibold uppercase tracking-widest text-gray-500 mb-1">Confidence</div>
              <span className="text-sm font-bold font-mono" style={{ color: (unified.verdict === 'STRONG_GO' || unified.verdict === 'GO') ? '#00A86B' : (unified.verdict === 'AVOID' || unified.verdict === 'NO_EDGE') ? '#D0312D' : '#E5E7EB' }}>{unified.confidence}</span>
            </div>
            <div className="rounded-lg border border-gray-800/90 bg-black/15 px-3 py-2 text-center">
              <div className="text-[9px] font-semibold uppercase tracking-widest text-gray-500 mb-1">R/R</div>
              <span className="text-sm font-bold font-mono" style={{ color: '#00A86B' }}>{unified.rr_ratio || '—'}</span>
            </div>
            <div className="rounded-lg border border-gray-800/90 bg-black/15 px-3 py-2 text-center">
              <div className="text-[9px] font-semibold uppercase tracking-widest text-gray-500 mb-1">Risk</div>
              <span className={`text-sm font-bold font-mono ${unified.risk_level === 'LOW' ? 'text-emerald-400' : unified.risk_level === 'MEDIUM' ? 'text-amber-400' : 'text-red-400'}`}>{unified.risk_level || '—'}</span>
            </div>
          </div>
          <div className="text-xs text-gray-300 leading-relaxed">{unified.reason || 'Analysis ready.'}</div>
        </div>

        {/* Step 6: Trade Management Plan */}
        <div className={`px-4 py-4 border-b border-gray-800 space-y-3${focusStep === 6 ? ` ${focusBorderLeft}` : ''}`}>
          <div>
            <div className="flex items-center gap-2">
              <div className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${focusStep === 6 ? focusToneText : 'text-semantic-info'}`}>Step 6</div>
              {focusStep === 6 && <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest ${TONE_BADGE[tone]}`}><Activity size={8} />{label}</span>}
            </div>
            <h2 className="mt-1 text-sm font-bold text-heading">Exit Plan — Pre-Committed</h2>
            <p className="mt-1 text-xs" style={{ color: '#9CA3AF' }}>Plan the response before the trade moves, not after.</p>
          </div>

          {/* Risk indicators */}
          {(() => {
            const riskLvl = unified.risk_level
            const isOverbought = rsi != null && rsi >= 70
            const isOversold = rsi != null && rsi <= 30
            const extRisk = distMA20 != null ? (Math.abs(distMA20) > 7 ? 'High' : Math.abs(distMA20) > 4 ? 'Medium' : 'Low') : riskLvl === 'HIGH' ? 'High' : riskLvl === 'MEDIUM' ? 'Medium' : 'Low'
            const extTone = extRisk === 'High' ? 'text-red-400' : extRisk === 'Medium' ? 'text-amber-400' : 'text-emerald-400'
            const volRiskLabel = volRatio != null ? (volRatio < 0.7 ? 'Weak' : volRatio < 1.5 ? 'Normal' : 'Strong') : null
            const volTone = volRiskLabel === 'Weak' ? 'text-red-400' : volRiskLabel === 'Strong' ? 'text-emerald-400' : 'text-gray-300'
            const ivRisk = iv != null ? (iv < 25 ? 'Low' : iv < 40 ? 'Moderate' : 'High') : null
            const ivTone = ivRisk === 'High' ? 'text-red-400' : ivRisk === 'Moderate' ? 'text-amber-400' : 'text-emerald-400'
            const earn = typeof m.earnings_risk === 'string' ? m.earnings_risk : null
            return (
              <div className="rounded-xl border border-gray-800/90 bg-black/15 px-3 py-2.5 space-y-1.5">
                {(isOverbought || isOversold) && (
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide border ${isOverbought ? 'bg-red-950/40 border-red-700/50 text-red-400' : 'bg-emerald-950/40 border-emerald-700/50 text-emerald-400'}`}>
                      {isOverbought ? 'Overbought' : 'Oversold'}
                    </span>
                    {rsi != null && <span className="text-[10px] text-gray-600">RSI {rsi.toFixed(0)}</span>}
                  </div>
                )}
                <div className="grid gap-1 grid-cols-2 sm:grid-cols-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-gray-500">Extension Risk</span>
                    <span className={`text-[11px] font-semibold ${extTone}`}>{extRisk}</span>
                  </div>
                  {volRiskLabel && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-gray-500">Volume Risk</span>
                      <span className={`text-[11px] font-semibold ${volTone}`}>{volRiskLabel}</span>
                    </div>
                  )}
                  {ivRisk && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-gray-500">IV Crush Risk</span>
                      <span className={`text-[11px] font-semibold ${ivTone}`}>{ivRisk}</span>
                    </div>
                  )}
                  {earn && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-gray-500">Earnings Risk</span>
                      <span className={`text-[11px] font-semibold ${earn === 'Clear' ? 'text-emerald-400' : earn === 'Caution' ? 'text-amber-400' : 'text-red-400'}`}>{earn}</span>
                    </div>
                  )}
                </div>
              </div>
            )
          })()}

          {/* Exit rules table */}
          {exitRules.length > 0 && (
            <div className="rounded-xl border border-gray-800/90 bg-black/15 px-3 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 mb-2.5">Exit Rules</div>
              <div style={{ overflowX: 'auto' }}>
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="text-[10px] font-semibold uppercase tracking-widest text-gray-600 border-b border-gray-700/60">
                      <th className="pb-2 text-left font-medium">When</th>
                      <th className="pb-2 text-right font-medium tabular-nums pr-4">At Price</th>
                      <th className="pb-2 text-left font-medium">Do This</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/50">
                    {exitRules.map((rule, i) => {
                      const trigger = String(rule.trigger || rule.when || '')
                      const price = typeof rule.price === 'number' ? rule.price : null
                      const action = String(rule.action || '')
                      const note = String(rule.note || '')
                      const isStall = /stalls/i.test(trigger)
                      const isStop = /stop/i.test(trigger)
                      const isTarget2 = /target 2/i.test(trigger)
                      const isTarget1 = /target 1/i.test(trigger) && !isTarget2 && !isStall
                      const isBreakdown = /ma20|breakdown|closes/i.test(trigger)
                      // Color palette: T1=green, T2=amber, stop/stall=red, breakdown=muted, other=slate
                      const colorCls = isStop || isStall ? 'text-red-400'
                        : isTarget1 ? 'text-emerald-400'
                        : isTarget2 ? 'text-amber-400'
                        : isBreakdown ? 'text-slate-400'
                        : 'text-slate-500'
                      const whenLabel = trigger
                        .replace(/^Target 1 reached$/i, 'Target 1')
                        .replace(/^Target 2 reached$/i, 'Target 2')
                        .replace(/^Stop loss$/i, 'Stop Loss')
                        .replace(/^Price closes below MA20$/i, 'MA20 Breakdown')
                        .replace(/^Price stalls at Target 1.*$/i, 'Stalls at T1')
                      return (
                        <tr key={i}>
                          <td className={`py-2.5 pr-2 leading-snug align-top font-semibold text-[11px] font-mono ${colorCls}`} style={{ width: '28%' }}>{whenLabel}</td>
                          <td className={`py-2.5 pr-4 text-right font-mono font-bold tabular-nums align-top ${colorCls}`}>
                            {price != null ? `$${price.toFixed(2)}` : '—'}
                          </td>
                          <td className="py-2.5 align-top">
                            <div className={`font-semibold leading-snug ${colorCls}`}>{action}</div>
                            {note && <div className="text-[10px] leading-snug mt-0.5 text-gray-500">{note}</div>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* AI Coach */}
          {unified.coach && (
            <div className="rounded-xl border border-violet-700/40 bg-violet-950/20 px-3 py-2.5 flex items-start gap-2">
              <span className="mt-0.5 text-[10px] text-violet-400 font-bold uppercase tracking-widest shrink-0">Coach</span>
              <span className="text-xs text-gray-300 leading-relaxed">{unified.coach}</span>
            </div>
          )}
        </div>
      </div>)}
    </div>
  )
}
