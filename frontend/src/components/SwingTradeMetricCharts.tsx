/**
 * Swing-only daily metric charts (backend-aligned series from metrics.chart_series).
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Bar,
} from 'recharts'
import type { TooltipProps } from 'recharts'
import type { ValueType, NameType } from 'recharts/types/component/DefaultTooltipContent'
import type { SwingTradeChartPoint } from '../api/client'

type Row = {
  date: string
  close: number
  ma20: number | null
  ma50: number | null
  rsi: number | null
  hv20: number | null
  volume: number | null
}

type Palette = {
  axis: string
  grid: string
  tick: string
  tooltipBg: string
  tooltipBorder: string
  label: string
  lineClose: string
  lineMa20: string
  lineMa50: string
  lineRsi: string
  lineHv: string
  lineIv: string
  refMuted: string
  support: string
  resistance: string
}

const SWING_CHART_PALETTE_FALLBACK: Palette = {
  axis: '#9ca3af',
  grid: 'rgba(55, 65, 81, 0.55)',
  tick: '#6b7280',
  tooltipBg: 'rgba(17, 24, 39, 0.96)',
  tooltipBorder: '#374151',
  label: '#9ca3af',
  lineClose: '#f3f4f6',
  lineMa20: '#34d399',
  lineMa50: '#fbbf24',
  lineRsi: '#38bdf8',
  lineHv: '#a78bfa',
  lineIv: '#f472b6',
  refMuted: 'rgba(148, 163, 184, 0.5)',
  support: '#34d399',
  resistance: '#fb7185',
}

function readPalette(el: HTMLElement): Palette {
  const s = getComputedStyle(el)
  const g = (k: string, fb: string) => s.getPropertyValue(k).trim() || fb
  return {
    axis: g('--sw-chart-axis', '#9ca3af'),
    grid: g('--sw-chart-grid', 'rgba(55, 65, 81, 0.55)'),
    tick: g('--sw-chart-tick', '#6b7280'),
    tooltipBg: g('--sw-chart-tooltip-bg', 'rgba(17, 24, 39, 0.96)'),
    tooltipBorder: g('--sw-chart-tooltip-border', '#374151'),
    label: g('--sw-chart-tooltip-label', '#9ca3af'),
    lineClose: g('--sw-chart-line-close', '#f3f4f6'),
    lineMa20: g('--sw-chart-line-ma20', '#34d399'),
    lineMa50: g('--sw-chart-line-ma50', '#fbbf24'),
    lineRsi: g('--sw-chart-line-rsi', '#38bdf8'),
    lineHv: g('--sw-chart-line-hv', '#a78bfa'),
    lineIv: g('--sw-chart-line-iv', '#f472b6'),
    refMuted: g('--sw-chart-ref-muted', 'rgba(148, 163, 184, 0.5)'),
    support: g('--bullish', '#34d399'),
    resistance: g('--bearish', '#fb7185'),
  }
}

function fmtTickDate(d: string) {
  const dt = new Date(`${d}T12:00:00`)
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function parseChartPayload(raw: unknown): SwingTradeChartPoint[] | null {
  if (!raw || typeof raw !== 'object') return null
  const pts = (raw as { points?: unknown }).points
  if (!Array.isArray(pts) || pts.length === 0) return null
  const out: SwingTradeChartPoint[] = []
  for (const p of pts) {
    if (!p || typeof p !== 'object') continue
    const o = p as Record<string, unknown>
    const d = o.d
    const c = o.c
    if (typeof d !== 'string' || typeof c !== 'number' || !Number.isFinite(c)) continue
    out.push({
      d,
      c,
      o: typeof o.o === 'number' ? o.o : o.o === null ? null : undefined,
      h: typeof o.h === 'number' ? o.h : o.h === null ? null : undefined,
      l: typeof o.l === 'number' ? o.l : o.l === null ? null : undefined,
      ma20: typeof o.ma20 === 'number' ? o.ma20 : o.ma20 === null ? null : undefined,
      ma50: typeof o.ma50 === 'number' ? o.ma50 : o.ma50 === null ? null : undefined,
      rsi: typeof o.rsi === 'number' ? o.rsi : o.rsi === null ? null : undefined,
      hv20: typeof o.hv20 === 'number' ? o.hv20 : o.hv20 === null ? null : undefined,
      v: typeof o.v === 'number' ? o.v : o.v === null ? null : undefined,
    })
  }
  return out.length ? out : null
}

type RefLevel = {
  label: string
  price: number
  type: 'support' | 'resistance'
}

function asNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function priceExtent(rows: Row[], levels: RefLevel[] = []): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (const r of rows) {
    lo = Math.min(lo, r.close)
    hi = Math.max(hi, r.close)
    if (r.ma20 != null) {
      lo = Math.min(lo, r.ma20)
      hi = Math.max(hi, r.ma20)
    }
    if (r.ma50 != null) {
      lo = Math.min(lo, r.ma50)
      hi = Math.max(hi, r.ma50)
    }
  }
  for (const level of levels) {
    lo = Math.min(lo, level.price)
    hi = Math.max(hi, level.price)
  }
  if (!Number.isFinite(lo)) return [0, 1]
  const pad = Math.max((hi - lo) * 0.04, hi * 0.006, 0.01)
  return [lo - pad, hi + pad]
}

function hvExtent(rows: Row[], impliedIv?: number | null): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (const r of rows) {
    if (r.hv20 != null) {
      lo = Math.min(lo, r.hv20)
      hi = Math.max(hi, r.hv20)
    }
  }
  if (impliedIv != null && Number.isFinite(impliedIv)) {
    lo = Math.min(lo, impliedIv)
    hi = Math.max(hi, impliedIv)
  }
  if (!Number.isFinite(lo)) return [0, 100]
  const pad = Math.max((hi - lo) * 0.08, 3)
  return [Math.max(0, lo - pad), hi + pad]
}

type ChartTooltipProps = TooltipProps<ValueType, NameType> & {
  pal: Palette
  mode: 'price' | 'rsi' | 'hv'
  impliedIv?: number | null
}

function ChartTooltip({ active, payload, label, pal, mode, impliedIv }: ChartTooltipProps) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload as Row | undefined
  if (!row?.date) return null
  const lab = typeof label === 'string' ? fmtTickDate(label) : String(label)
  return (
    <div
      style={{
        backgroundColor: pal.tooltipBg,
        border: `1px solid ${pal.tooltipBorder}`,
        borderRadius: 8,
        fontSize: 11,
        padding: '8px 10px',
        color: pal.axis,
        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
      }}
    >
      <div style={{ color: pal.label, marginBottom: 6 }}>{lab}</div>
      {mode === 'price' && (
        <>
          <div style={{ color: pal.lineClose }}>Close {row.close.toFixed(2)}</div>
          {row.ma20 != null && <div style={{ color: pal.lineMa20 }}>MA20 {row.ma20.toFixed(2)}</div>}
          {row.ma50 != null && <div style={{ color: pal.lineMa50 }}>MA50 {row.ma50.toFixed(2)}</div>}
          {row.volume != null && <div style={{ color: pal.label, marginTop: 4 }}>Vol {Math.round(row.volume).toLocaleString()}</div>}
        </>
      )}
      {mode === 'rsi' && (
        <div style={{ color: pal.lineRsi }}>
          RSI(14) {row.rsi != null ? row.rsi.toFixed(1) : '—'}
        </div>
      )}
      {mode === 'hv' && (
        <>
          {row.hv20 != null && <div style={{ color: pal.lineHv }}>HV20 {row.hv20.toFixed(1)}%</div>}
          {impliedIv != null && impliedIv > 0 && (
            <div style={{ color: pal.lineIv, marginTop: 4 }}>Implied IV (spot) {impliedIv.toFixed(1)}%</div>
          )}
        </>
      )}
    </div>
  )
}

interface Props {
  metrics: Record<string, unknown>
  mode?: 'price' | 'rsi' | 'hv' | 'volume' | 'all'
}

export default function SwingTradeMetricCharts({ metrics, mode = 'all' }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [pal, setPal] = useState<Palette>(SWING_CHART_PALETTE_FALLBACK)

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const sync = () => setPal(readPalette(el))
    sync()
    const mo = new MutationObserver(sync)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => mo.disconnect()
  }, [])

  const points = useMemo(() => parseChartPayload(metrics.chart_series), [metrics.chart_series])
  const impliedIv = typeof metrics.implied_iv_pct === 'number' ? metrics.implied_iv_pct : null

  const data = useMemo<Row[]>(() => {
    if (!points) return []
    return points.map(p => ({
      date: p.d,
      close: p.c,
      ma20: p.ma20 ?? null,
      ma50: p.ma50 ?? null,
      rsi: p.rsi ?? null,
      hv20: p.hv20 ?? null,
      volume: p.v ?? null,
    }))
  }, [points])

  const referenceLevels = useMemo<RefLevel[]>(() => {
    const latest = data[data.length - 1]
    const last = asNum(metrics.last_price) ?? latest?.close ?? null
    const candidates: Array<{ label: string; price: number | null; source: 'trend' | 'exec' }> = [
      { label: 'MA20', price: asNum(metrics.ma20) ?? latest?.ma20 ?? null, source: 'trend' },
      { label: 'MA50', price: asNum(metrics.ma50) ?? latest?.ma50 ?? null, source: 'trend' },
    ]
    const exec = metrics.exec_levels && typeof metrics.exec_levels === 'object' ? metrics.exec_levels as Record<string, unknown> : null
    if (exec) {
      candidates.push(
        { label: 'Entry', price: asNum(exec.entry), source: 'exec' },
        { label: 'Stop', price: asNum(exec.stop), source: 'exec' },
        { label: 'T1', price: asNum(exec.t1), source: 'exec' },
        { label: 'T2', price: asNum(exec.t2), source: 'exec' },
        { label: 'Pullback', price: asNum(exec.pullback_low) ?? asNum(exec.pullback_zone_low), source: 'exec' },
        { label: 'Pullback', price: asNum(exec.pullback_high) ?? asNum(exec.pullback_zone_high), source: 'exec' },
      )
    }
    return candidates.reduce<RefLevel[]>((acc, item) => {
      if (item.price == null || item.price <= 0 || !Number.isFinite(item.price)) return acc
      const duplicate = acc.some(existing => Math.abs(existing.price - item.price!) <= Math.max(0.01, item.price! * 0.0003))
      if (duplicate) return acc
      acc.push({
        label: item.label,
        price: item.price,
        type: last != null && item.price <= last ? 'support' : 'resistance',
      })
      return acc
    }, [])
  }, [data, metrics])

  const [pLo, pHi] = useMemo(() => priceExtent(data, referenceLevels), [data, referenceLevels])
  const [vLo, vHi] = useMemo(() => hvExtent(data, impliedIv), [data, impliedIv])
  const volumeRatio = typeof metrics.volume_ratio === 'number' ? metrics.volume_ratio : null
  const volumeLabel = typeof metrics.volume_label === 'string' ? metrics.volume_label : ''
  const hasVolumeSeries = data.some(r => r.volume != null && r.volume > 0)

  if (mode !== 'volume' && data.length === 0) return null

  const hasHv = data.some(r => r.hv20 != null)
  const showIvLine = impliedIv != null && impliedIv > 0

  return (
    <div ref={wrapRef} className="swing-trade-metric-charts space-y-4">
      {mode === 'all' && (
        <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-600">
          Daily context (scan window)
        </div>
      )}

      {(mode === 'all' || mode === 'price') && (
      <div>
        <div className="text-[10px] font-medium text-gray-500 mb-1">Price · MA20 · MA50 · Volume</div>
        <ResponsiveContainer width="100%" height={hasVolumeSeries ? 260 : 210}>
          <ComposedChart data={data} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={pal.grid} strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tick={{ fill: pal.tick, fontSize: 10 }}
              tickFormatter={fmtTickDate}
              minTickGap={28}
            />
            <YAxis yAxisId="price" domain={[pLo, pHi]} width={44} tick={{ fill: pal.tick, fontSize: 10 }} />
            {hasVolumeSeries && <YAxis yAxisId="volume" orientation="right" hide />}
            <Tooltip content={(props: TooltipProps<ValueType, NameType>) => <ChartTooltip {...props} pal={pal} mode="price" />} />
            <Legend wrapperStyle={{ fontSize: 10, color: pal.axis }} />
            {hasVolumeSeries && (
              <Bar yAxisId="volume" dataKey="volume" name="Volume" fill={pal.lineRsi} fillOpacity={0.24} barSize={4} />
            )}
            {referenceLevels.slice(0, 8).map(level => (
              <ReferenceLine
                key={`${level.label}-${level.price}`}
                yAxisId="price"
                y={level.price}
                stroke={level.type === 'support' ? pal.support : pal.resistance}
                strokeDasharray="6 4"
                strokeOpacity={0.72}
                label={{
                  value: `${level.label} ${level.type}`,
                  position: 'insideRight',
                  fill: level.type === 'support' ? pal.support : pal.resistance,
                  fontSize: 10,
                }}
              />
            ))}
            <Line yAxisId="price" type="monotone" dataKey="close" name="Close" stroke={pal.lineClose} dot={false} strokeWidth={1.8} />
            <Line yAxisId="price" type="monotone" dataKey="ma20" name="MA20" stroke={pal.lineMa20} dot={false} strokeWidth={1.2} connectNulls />
            <Line yAxisId="price" type="monotone" dataKey="ma50" name="MA50" stroke={pal.lineMa50} dot={false} strokeWidth={1.2} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
        {referenceLevels.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {referenceLevels.slice(0, 8).map(level => (
              <span
                key={`chip-${level.label}-${level.price}`}
                className="rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                style={{
                  borderColor: level.type === 'support' ? pal.support : pal.resistance,
                  color: level.type === 'support' ? pal.support : pal.resistance,
                  background: level.type === 'support' ? 'rgba(52,211,153,0.08)' : 'rgba(251,113,133,0.08)',
                }}
              >
                {level.label} {level.type} ${level.price.toFixed(2)}
              </span>
            ))}
          </div>
        )}
      </div>
      )}

      {(mode === 'all' || mode === 'rsi') && (
      <div>
        <div className="text-[10px] font-medium text-gray-500 mb-1">RSI (14)</div>
        <ResponsiveContainer width="100%" height={130}>
          <ComposedChart data={data} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={pal.grid} strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tick={{ fill: pal.tick, fontSize: 10 }}
              tickFormatter={fmtTickDate}
              minTickGap={28}
            />
            <YAxis domain={[0, 100]} width={36} tick={{ fill: pal.tick, fontSize: 10 }} />
            <Tooltip content={(props: TooltipProps<ValueType, NameType>) => <ChartTooltip {...props} pal={pal} mode="rsi" />} />
            <ReferenceLine y={30} stroke={pal.refMuted} strokeDasharray="4 4" />
            <ReferenceLine y={70} stroke={pal.refMuted} strokeDasharray="4 4" />
            <Line type="monotone" dataKey="rsi" name="RSI" stroke={pal.lineRsi} dot={false} strokeWidth={1.4} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      )}

      {(mode === 'all' || mode === 'hv') && (hasHv || showIvLine) && (
        <div>
          <div className="text-[10px] font-medium text-gray-500 mb-1">HV20 (annualized %) · IV (Yahoo)</div>
          <ResponsiveContainer width="100%" height={130}>
            <ComposedChart data={data} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={pal.grid} strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                tick={{ fill: pal.tick, fontSize: 10 }}
                tickFormatter={fmtTickDate}
                minTickGap={28}
              />
              <YAxis domain={[vLo, vHi]} width={44} tick={{ fill: pal.tick, fontSize: 10 }} />
              <Tooltip
                content={(props: TooltipProps<ValueType, NameType>) => (
                  <ChartTooltip {...props} pal={pal} mode="hv" impliedIv={impliedIv} />
                )}
              />
              <Legend wrapperStyle={{ fontSize: 10, color: pal.axis }} />
              {hasHv && (
                <Line
                  type="monotone"
                  dataKey="hv20"
                  name="HV20"
                  stroke={pal.lineHv}
                  dot={false}
                  strokeWidth={1.4}
                  connectNulls
                />
              )}
              {showIvLine && (
                <ReferenceLine
                  y={impliedIv!}
                  stroke={pal.lineIv}
                  strokeDasharray="5 4"
                  label={{
                    value: 'Implied IV',
                    position: 'insideTopRight',
                    fill: pal.lineIv,
                    fontSize: 10,
                  }}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {(mode === 'all' || mode === 'volume') && (
        <div>
          <div className="text-[10px] font-medium text-gray-500 mb-1">Volume Context</div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-gray-800/80 bg-black/15 px-3 py-3">
              <div className="text-[10px] uppercase tracking-wide text-gray-500">Volume Ratio</div>
              <div className={`mt-1 text-lg font-mono font-bold ${
                volumeRatio == null ? 'text-gray-300' : volumeRatio > 1.5 ? 'text-emerald-400' : volumeRatio > 0.7 ? 'text-amber-400' : 'text-rose-400'
              }`}>
                {volumeRatio == null ? '—' : `${volumeRatio.toFixed(2)}x`}
              </div>
            </div>
            <div className="rounded-lg border border-gray-800/80 bg-black/15 px-3 py-3">
              <div className="text-[10px] uppercase tracking-wide text-gray-500">Participation</div>
              <div className="mt-1 text-sm font-semibold text-gray-200">
                {volumeLabel || 'Volume context unavailable'}
              </div>
              <div className="mt-1 text-xs text-gray-400">
                Volume should confirm continuation before adding size.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
