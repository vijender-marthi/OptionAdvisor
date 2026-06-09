import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchOptionChainLiquidity, type OptionChainLiquidityResponse, type OptionChainRow } from '../api/client'

// ── Helpers ──────────────────────────────────────────────────────────────────

function ocFindExpiry(expiries: string[], targetDte: number): string | null {
  if (!expiries.length) return null
  const now = Date.now()
  let best = expiries[0]!
  let bestD = Infinity
  for (const e of expiries) {
    const d = Math.abs(Math.max(0, Math.ceil((new Date(e + 'T00:00:00').getTime() - now) / 86_400_000)) - targetDte)
    if (d < bestD) { bestD = d; best = e }
  }
  return best
}

function ocVerdictStrip(
  trigger: 'GO' | 'WAIT' | 'WATCHING' | 'HOLD',
  pc: 'aligned' | 'conflict' | 'neutral',
  ss: 'ok' | 'warn' | 'bad' | null,
  flip: string,
  word: 'CALL' | 'PUT',
  atmStrike: number | null,
  stop: number,
): { tier: 'green' | 'amber' | 'red' | 'gray'; msg: string } {
  if (trigger === 'HOLD')
    return { tier: 'green' as const, msg: '✓ Position active · Manage to T1/T2 · Move stop to breakeven at T1' }
  if (trigger === 'WATCHING')
    return { tier: 'gray', msg: `— Watching · No trigger yet · Wait for: ${flip}` }
  if (trigger === 'WAIT')
    return { tier: 'red', msg: `✗ Not ready · Trigger not fired · Flip to GO: ${flip}` }
  if (ss === 'bad')
    return { tier: 'red', msg: `✗ Not ready · Spread exceeds 10% day-trade limit · Flip to GO: ${flip}` }
  if (pc === 'conflict')
    return { tier: 'red', msg: `✗ Not ready · P/C ratio conflicts with session direction · Flip to GO: ${flip}` }
  if (ss === 'warn')
    return { tier: 'amber', msg: `⚠ Spread marginal · enter 1 contract only · confirm volume before entry` }
  if (pc === 'neutral')
    return { tier: 'amber', msg: `⚠ P/C ratio neutral — no directional confirmation · 1 contract only` }
  const s = atmStrike ? `Enter ${word} at ATM $${atmStrike.toFixed(2)} · ` : ''
  return { tier: 'green', msg: `✓ All checks passed · ${s}Set stop at $${stop.toFixed(2)} before clicking confirm` }
}

const OC_COLS = '72px 58px 58px 60px 66px 100px 48px'

// ── Theme tokens ──────────────────────────────────────────────────────────────

function makeT(isDark: boolean) {
  return isDark ? {
    sectionBg:    '#0f0f0f',
    cardBg:       '#111318',
    border:       '#1E2330',
    bodyLine:     'rgba(255,255,255,0.05)',
    rowLine:      '#141820',
    text:         '#E8EBF0',
    muted:        '#5A6478',
    colHdr:       '#3A4355',
    inputBorder:  '#252C3A',
    shortBadgeBg: 'rgba(251,113,133,0.12)', shortBadgeTxt: '#fb7185',
    longBadgeBg:  'rgba(52,211,153,0.12)',  longBadgeTxt:  '#34d399',
    greenBg:  'rgba(99,153,34,0.20)',    greenBdr: '#639922', greenTxt: '#a3cc6a',
    amberBg:  'rgba(232,123,58,0.20)',  amberBdr: '#E87B3A', amberTxt: '#e8a06a',
    redBg:    'rgba(226,75,74,0.10)',   redBdr:   '#E24B4A', redTxt:   '#e07070',
    grayBg:   'rgba(136,135,128,0.10)', grayBdr:  '#888780', grayTxt: '#888780',
    liqGood: '#a3cc6a', liqWarn: '#e8a06a', liqBad: '#e07070', liqNone: '#5A6478',
    rtGood:  '#a3cc6a', rtWarn:  '#e8a06a', rtBad:  '#e07070',
  } : {
    sectionBg:    '#FFFFFF',
    cardBg:       '#F8F9FB',
    border:       '#E5E7EB',
    bodyLine:     'rgba(0,0,0,0.06)',
    rowLine:      '#F0F0F0',
    text:         '#111827',
    muted:        '#6B7280',
    colHdr:       '#6B7280',
    inputBorder:  '#D1D5DB',
    shortBadgeBg: 'rgba(220,38,38,0.10)',   shortBadgeTxt: '#b91c1c',
    longBadgeBg:  'rgba(22,163,74,0.12)',   longBadgeTxt:  '#15803d',
    greenBg:  'rgba(99,153,34,0.12)',    greenBdr: '#639922', greenTxt: '#3d6b0d',
    amberBg:  'rgba(232,123,58,0.12)',  amberBdr: '#E87B3A', amberTxt: '#9a4e08',
    redBg:    'rgba(226,75,74,0.10)',   redBdr:   '#E24B4A', redTxt:   '#b91c1c',
    grayBg:   'rgba(136,135,128,0.08)', grayBdr:  '#888780', grayTxt: '#4B5563',
    liqGood: '#3d6b0d', liqWarn: '#9a4e08', liqBad: '#b91c1c', liqNone: '#6B7280',
    rtGood:  '#3d6b0d', rtWarn:  '#9a4e08', rtBad:  '#b91c1c',
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface OptionsEntryCheckProps {
  ticker: string
  direction: 'SHORT' | 'LONG'
  stopPrice: number
  chartTrigger: 'GO' | 'WAIT' | 'WATCHING' | 'HOLD'
  flipCondition: string
  pcAlignment: 'aligned' | 'conflict' | 'neutral'
  initialPrice: number
  isDark?: boolean
  /** 'day' shows 5/7 DTE; 'swing' shows 7/14/21/28 DTE */
  mode?: 'day' | 'swing'
}

export default function OptionsEntryCheck({
  ticker, direction, stopPrice, chartTrigger, flipCondition, pcAlignment, initialPrice,
  isDark = true,
  mode = 'day',
}: OptionsEntryCheckProps) {
  const T = makeT(isDark)
  const dteOptions = mode === 'swing' ? [7, 14, 21, 28] : [5, 7]
  const defaultDte = dteOptions[0]!

  const [expanded, setExpanded]   = useState(false)
  const [targetDte, setTargetDte] = useState<number>(defaultDte)
  const [livePrice, setLivePrice] = useState(initialPrice)
  const [draft, setDraft]         = useState(initialPrice.toFixed(2))
  const [data, setData]           = useState<OptionChainLiquidityResponse | null>(null)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(null)

  const fetchExpiry = useCallback(async (expiry: string) => {
    setLoading(true); setError(null)
    try {
      const r = await fetchOptionChainLiquidity(ticker, expiry)
      setData(r)
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail ?? 'Failed to load option chain.')
    } finally {
      setLoading(false)
    }
  }, [ticker])

  // Fetch on mount. key={ticker} in the parent forces a full remount whenever
  // the ticker changes, so this effect always runs with the correct ticker and
  // never sees stale data from a previous ticker.
  useEffect(() => {
    let cancelled = false
    setLoading(true)

    const run = async () => {
      try {
        const r1 = await fetchOptionChainLiquidity(ticker)
        if (cancelled) return
        const best5 = ocFindExpiry(r1.expiries, defaultDte)
        if (best5 && best5 !== r1.selected_expiry) {
          try {
            const r2 = await fetchOptionChainLiquidity(ticker, best5)
            if (!cancelled) setData(r2)
            return
          } catch { /* fall through to r1 */ }
        }
        if (!cancelled) setData(r1)
      } catch (e: unknown) {
        if (cancelled) return
        const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        setError(detail ?? 'Failed to load option chain.')
        setData(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    run()
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-expand the first time data arrives after mount.
  const autoExpandedRef = useRef(false)
  useEffect(() => {
    if (data !== null && !autoExpandedRef.current) {
      autoExpandedRef.current = true
      setExpanded(true)
    }
  }, [data])

  const handleDte = (dte: number) => {
    setTargetDte(dte)
    if (data) {
      const best = ocFindExpiry(data.expiries, dte)
      if (best) fetchExpiry(best)
    }
  }

  const side: 'put' | 'call' = direction === 'SHORT' ? 'put' : 'call'
  const rows: OptionChainRow[] = data ? (side === 'call' ? data.calls : data.puts) : []
  const atmIdx = rows.length > 0
    ? rows.reduce((b, r, i) => Math.abs(r.strike - livePrice) < Math.abs(rows[b]!.strike - livePrice) ? i : b, 0)
    : -1

  const three: { r: OptionChainRow; lbl: 'ITM' | 'ATM' | 'OTM' }[] = []
  if (atmIdx >= 0) {
    const atmRow = rows[atmIdx]!
    if (direction === 'SHORT') {
      const itm = rows[atmIdx + 1]; const otm = rows[atmIdx - 1]
      if (itm) three.push({ r: itm, lbl: 'ITM' })
      three.push({ r: atmRow, lbl: 'ATM' })
      if (otm) three.push({ r: otm, lbl: 'OTM' })
    } else {
      const itm = rows[atmIdx - 1]; const otm = rows[atmIdx + 1]
      if (itm) three.push({ r: itm, lbl: 'ITM' })
      three.push({ r: atmRow, lbl: 'ATM' })
      if (otm) three.push({ r: otm, lbl: 'OTM' })
    }
  }

  const atmRow     = three.find(x => x.lbl === 'ATM')?.r ?? null
  // Strike is more than 5% from current price → chain is incomplete for this expiry
  const atmTooFar  = atmRow != null && Math.abs(atmRow.strike - livePrice) / livePrice > 0.05
  const ss         = (atmRow && !atmTooFar) ? (atmRow.spread_pct <= 5 ? 'ok' : atmRow.spread_pct <= 10 ? 'warn' : 'bad') as 'ok' | 'warn' | 'bad' : null
  const word    = (direction === 'SHORT' ? 'PUT' : 'CALL') as 'PUT' | 'CALL'
  const { tier, msg } = ocVerdictStrip(chartTrigger, pcAlignment, ss, flipCondition, word, atmRow?.strike ?? null, stopPrice)

  const vtBg  = tier === 'green' ? T.greenBg  : tier === 'amber' ? T.amberBg  : tier === 'red' ? T.redBg  : T.grayBg
  const vtBdr = tier === 'green' ? T.greenBdr : tier === 'amber' ? T.amberBdr : tier === 'red' ? T.redBdr : T.grayBdr
  const vtClr = tier === 'green' ? T.greenTxt : tier === 'amber' ? T.amberTxt : tier === 'red' ? T.redTxt : T.grayTxt

  const liqColor = ss === 'ok' ? T.liqGood : ss === 'warn' ? T.liqWarn : ss === 'bad' ? T.liqBad : T.liqNone
  const liqLbl   = ss === 'ok' ? '✓ Good'  : ss === 'warn' ? '⚠ Moderate' : ss === 'bad' ? '✗ Poor' : '—'
  const rt       = atmRow ? atmRow.spread * 2 * 100 : null
  const rtClr    = rt == null ? T.liqNone : rt < 200 ? T.rtGood : rt < 400 ? T.rtWarn : T.rtBad
  const selDte   = data ? Math.max(0, Math.ceil((new Date(data.selected_expiry + 'T00:00:00').getTime() - Date.now()) / 86_400_000)) : null

  return (
    <section style={{ background: T.sectionBg, border: `1px solid ${T.border}`, borderRadius: 12, overflow: 'hidden', flexShrink: 0 }}>

      {/* ── Toggle row ── */}
      <div
        className="flex items-center justify-between px-4 py-2 cursor-pointer select-none"
        style={{ borderBottom: expanded ? `1px solid ${T.bodyLine}` : 'none' }}
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center gap-2.5">
          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.muted }}>
            Options entry check
          </span>
          <span style={{ fontFamily: 'ui-monospace,monospace', fontSize: 11, fontWeight: 700, color: T.text }}>{ticker}</span>
          <span
            style={{
              padding: '1px 6px', borderRadius: 4, fontSize: 9, fontWeight: 700,
              background: direction === 'SHORT' ? T.shortBadgeBg : T.longBadgeBg,
              color:      direction === 'SHORT' ? T.shortBadgeTxt : T.longBadgeTxt,
            }}
          >
            {direction === 'SHORT' ? '▼ SHORT' : '▲ LONG'}
          </span>
          {loading && <span style={{ fontSize: 10, color: T.muted }}>loading…</span>}
          {data && selDte !== null && !loading && (
            <span style={{ fontSize: 10, color: T.muted }}>{selDte}DTE · {side}s</span>
          )}
        </div>

        <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
          {expanded && (
            <>
              <span style={{ fontSize: 10, color: T.muted }}>price</span>
              <input
                type="text"
                inputMode="decimal"
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onBlur={() => {
                  const n = parseFloat(draft)
                  if (!isNaN(n) && n > 0) { setLivePrice(n); setDraft(n.toFixed(2)) }
                  else setDraft(livePrice.toFixed(2))
                }}
                onKeyDown={e => {
                  if (e.key !== 'Enter') return
                  const n = parseFloat(draft)
                  if (!isNaN(n) && n > 0) { setLivePrice(n); setDraft(n.toFixed(2)) }
                  else setDraft(livePrice.toFixed(2))
                  e.currentTarget.blur()
                }}
                style={{
                  width: 64, fontSize: 11, fontFamily: 'ui-monospace, monospace',
                  color: T.text, background: 'transparent',
                  border: 'none', borderBottom: `1px solid ${T.inputBorder}`,
                  outline: 'none', textAlign: 'right', padding: '1px 0',
                }}
              />
            </>
          )}
          <span style={{ fontSize: 10, color: T.muted, marginLeft: 4 }}>
            {expanded ? '▲' : '▼'}
          </span>
        </div>
      </div>

      {/* ── Expanded body ── */}
      {expanded && (
        <div style={{ padding: '10px 16px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* DTE selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, color: T.muted }}>DTE</span>
            {dteOptions.map(dte => (
              <button
                key={dte}
                onClick={() => handleDte(dte)}
                style={{
                  fontSize: 11, padding: '3px 11px', borderRadius: 5, cursor: 'pointer',
                  border: '0.5px solid',
                  borderColor: targetDte === dte ? T.greenBdr : T.border,
                  background:  targetDte === dte ? T.greenBg   : T.cardBg,
                  color:       targetDte === dte ? T.greenTxt  : T.muted,
                }}
              >
                {dte}DTE
              </button>
            ))}
          </div>

          {/* Error */}
          {error && (
            <div style={{ fontSize: 11, color: T.redTxt, padding: '6px 10px', borderRadius: 5, background: T.redBg }}>
              {error}
            </div>
          )}

          {/* Chain incomplete warning */}
          {atmTooFar && atmRow && (
            <div style={{ fontSize: 11, color: T.amberTxt, padding: '6px 10px', borderRadius: 5, background: T.amberBg, border: `0.5px solid ${T.amberBdr}` }}>
              ⚠ Chain tops out at ${atmRow.strike.toFixed(2)} — stock is at ${livePrice.toFixed(2)}. No near-money strikes available for this expiry. Try a later expiry date to find options closer to the current price.
            </div>
          )}

          {/* Stat cards */}
          {atmRow && !atmTooFar && (() => {
            const spreadPct = atmRow.mid > 0 ? (atmRow.spread / atmRow.mid * 100) : atmRow.spread_pct
            return (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {([
                  { lbl: 'ATM strike', val: `$${atmRow.strike.toFixed(2)}`,               sub: null,                                                              clr: T.text      },
                  { lbl: 'Mid price',  val: `$${atmRow.mid.toFixed(2)}`,                  sub: `$${(atmRow.mid * 100).toFixed(0)} per contract`,                  clr: T.text      },
                  { lbl: 'Spread cost',val: `$${(atmRow.spread * 100).toFixed(0)}`,       sub: `${spreadPct.toFixed(2)}% of premium`,                             clr: liqColor    },
                  { lbl: 'Liquidity',  val: liqLbl,                                        sub: null,                                                              clr: liqColor    },
                  { lbl: 'Round trip', val: rt != null ? `$${rt.toFixed(0)}` : '—',       sub: rt != null ? `entry + exit · 2× = $${(rt * 2).toFixed(0)}` : null, clr: rtClr       },
                ] as const).map(({ lbl, val, sub, clr }) => (
                  <div key={lbl} style={{ flex: 1, minWidth: 90, background: T.cardBg, border: `0.5px solid ${T.border}`, borderRadius: 7, padding: '7px 11px' }}>
                    <div style={{ fontSize: 9, color: T.muted, marginBottom: 2 }}>{lbl}</div>
                    <div style={{ fontSize: 15, fontWeight: 500, color: clr }}>{val}</div>
                    {sub && <div style={{ fontSize: 9, color: T.muted, marginTop: 1 }}>{sub}</div>}
                  </div>
                ))}
              </div>
            )
          })()}

          {/* 3-strike table */}
          {three.length > 0 && (
            <div style={{ border: `0.5px solid ${T.border}`, borderRadius: 7, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: OC_COLS, padding: '5px 10px', fontSize: 9, fontWeight: 600, color: T.colHdr, borderBottom: `0.5px solid ${T.border}`, letterSpacing: '0.05em', textTransform: 'uppercase', background: T.cardBg }}>
                <span>Strike</span><span>Bid</span><span>Ask</span>
                <span>Spread</span><span>Spread%</span><span>Status</span><span>IV</span>
              </div>
              {three.map(({ r, lbl }) => {
                const sp  = r.spread_pct <= 5 ? T.liqGood : r.spread_pct <= 10 ? T.liqWarn : T.liqBad
                const isA = lbl === 'ATM'
                const bs  = r.spread_pct <= 5
                  ? { bg: T.greenBg, c: T.greenTxt, t: '✓ Enter'     }
                  : r.spread_pct <= 10
                  ? { bg: T.amberBg, c: T.amberTxt, t: '⚠ Size down' }
                  : { bg: T.redBg,   c: T.redTxt,   t: '✗ Skip'      }
                return (
                  <div
                    key={r.strike}
                    style={{
                      display: 'grid', gridTemplateColumns: OC_COLS,
                      alignItems: 'center', padding: '6px 10px',
                      borderBottom: `0.5px solid ${T.rowLine}`,
                      fontSize: 11, color: T.text,
                      borderLeft: `2px solid ${isA ? T.greenBdr : 'transparent'}`,
                      background: isA ? T.greenBg : 'transparent',
                    }}
                  >
                    <span>
                      <span style={{ fontWeight: isA ? 600 : 400 }}>${r.strike.toFixed(2)}</span>
                      {' '}
                      <span style={{ fontSize: 8, color: isA ? T.greenBdr : T.colHdr }}>{lbl}</span>
                    </span>
                    <span>${r.bid.toFixed(2)}</span>
                    <span>${r.ask.toFixed(2)}</span>
                    <span style={{ color: sp }}>${r.spread.toFixed(2)}</span>
                    <span style={{ color: sp }}>{r.spread_pct.toFixed(1)}%</span>
                    <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 3, fontWeight: 500, display: 'inline-block', background: bs.bg, color: bs.c }}>
                      {bs.t}
                    </span>
                    <span style={{ color: T.colHdr }}>{r.iv > 200 ? '—' : `${r.iv.toFixed(0)}%`}</span>
                  </div>
                )
              })}
            </div>
          )}

          {/* Verdict strip */}
          {(data !== null || chartTrigger !== 'GO') && (
            <div style={{
              minHeight: 48, padding: '10px 14px',
              display: 'flex', alignItems: 'center',
              borderRadius: 6,
              background: vtBg,
              borderLeft: `3px solid ${vtBdr}`,
              fontSize: 12, color: vtClr, lineHeight: 1.5,
            }}>
              {msg}
            </div>
          )}

        </div>
      )}
    </section>
  )
}
