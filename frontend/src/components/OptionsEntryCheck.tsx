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
  trigger: 'GO' | 'WAIT' | 'WATCHING',
  pc: 'aligned' | 'conflict' | 'neutral',
  ss: 'ok' | 'warn' | 'bad' | null,
  flip: string,
  word: 'CALL' | 'PUT',
  atmStrike: number | null,
  stop: number,
): { tier: 'green' | 'amber' | 'red' | 'gray'; msg: string } {
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

// ── Component ─────────────────────────────────────────────────────────────────

export interface OptionsEntryCheckProps {
  ticker: string
  direction: 'SHORT' | 'LONG'
  stopPrice: number
  chartTrigger: 'GO' | 'WAIT' | 'WATCHING'
  flipCondition: string
  pcAlignment: 'aligned' | 'conflict' | 'neutral'
  initialPrice: number
}

export default function OptionsEntryCheck({
  ticker, direction, stopPrice, chartTrigger, flipCondition, pcAlignment, initialPrice,
}: OptionsEntryCheckProps) {
  const [expanded, setExpanded]   = useState(false)
  const [targetDte, setTargetDte] = useState<5 | 7>(5)
  const [livePrice, setLivePrice] = useState(initialPrice)
  const [draft, setDraft]         = useState(initialPrice.toFixed(2))
  const [data, setData]           = useState<OptionChainLiquidityResponse | null>(null)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const initRef                   = useRef(false)

  const doFetch = useCallback(async (expiry?: string) => {
    setLoading(true); setError(null)
    try {
      const r1 = await fetchOptionChainLiquidity(ticker, expiry)
      if (!expiry) {
        const best5 = ocFindExpiry(r1.expiries, 5)
        if (best5 && best5 !== r1.selected_expiry) {
          try { const r2 = await fetchOptionChainLiquidity(ticker, best5); setData(r2); return } catch { /* fall through */ }
        }
      }
      setData(r1)
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail ?? 'Failed to load option chain.')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [ticker])

  // Fetch once on first expand
  useEffect(() => {
    if (!expanded || initRef.current) return
    initRef.current = true
    doFetch()
  }, [expanded]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDte = (dte: 5 | 7) => {
    setTargetDte(dte)
    if (data) {
      const best = ocFindExpiry(data.expiries, dte)
      if (best) doFetch(best)
    }
  }

  // Recompute ATM from live price (no re-fetch needed)
  const side: 'put' | 'call' = direction === 'SHORT' ? 'put' : 'call'
  const rows: OptionChainRow[] = data ? (side === 'call' ? data.calls : data.puts) : []
  const atmIdx = rows.length > 0
    ? rows.reduce((b, r, i) => Math.abs(r.strike - livePrice) < Math.abs(rows[b]!.strike - livePrice) ? i : b, 0)
    : -1

  const three: { r: OptionChainRow; lbl: 'ITM' | 'ATM' | 'OTM' }[] = []
  if (atmIdx >= 0) {
    const atmRow = rows[atmIdx]!
    if (direction === 'SHORT') {
      // Puts: ITM = higher strike (above price), OTM = lower strike (below price)
      const itm = rows[atmIdx + 1]; const otm = rows[atmIdx - 1]
      if (itm) three.push({ r: itm, lbl: 'ITM' })
      three.push({ r: atmRow, lbl: 'ATM' })
      if (otm) three.push({ r: otm, lbl: 'OTM' })
    } else {
      // Calls: ITM = lower strike (below price), OTM = higher strike (above price)
      const itm = rows[atmIdx - 1]; const otm = rows[atmIdx + 1]
      if (itm) three.push({ r: itm, lbl: 'ITM' })
      three.push({ r: atmRow, lbl: 'ATM' })
      if (otm) three.push({ r: otm, lbl: 'OTM' })
    }
  }

  const atmRow  = three.find(x => x.lbl === 'ATM')?.r ?? null
  const ss      = atmRow ? (atmRow.spread_pct <= 5 ? 'ok' : atmRow.spread_pct <= 10 ? 'warn' : 'bad') as 'ok' | 'warn' | 'bad' : null
  const word    = (direction === 'SHORT' ? 'PUT' : 'CALL') as 'PUT' | 'CALL'
  const { tier, msg } = ocVerdictStrip(chartTrigger, pcAlignment, ss, flipCondition, word, atmRow?.strike ?? null, stopPrice)

  const vtBg  = tier === 'green' ? 'rgba(99,153,34,0.15)'  : tier === 'amber' ? 'rgba(232,123,58,0.10)' : tier === 'red' ? 'rgba(226,75,74,0.10)' : 'rgba(136,135,128,0.10)'
  const vtBdr = tier === 'green' ? '#639922'               : tier === 'amber' ? '#E87B3A'               : tier === 'red' ? '#E24B4A'              : '#888780'
  const vtClr = tier === 'green' ? '#a3cc6a'               : tier === 'amber' ? '#e8a06a'               : tier === 'red' ? '#e07070'              : '#888780'

  const liqColor = ss === 'ok' ? '#a3cc6a' : ss === 'warn' ? '#e8a06a' : ss === 'bad' ? '#e07070' : '#5A6478'
  const liqLbl   = ss === 'ok' ? '✓ Good'  : ss === 'warn' ? '⚠ Moderate' : ss === 'bad' ? '✗ Poor' : '—'
  const rt       = atmRow ? atmRow.spread * 2 * 100 : null
  const rtClr    = rt == null ? '#5A6478' : rt < 200 ? '#a3cc6a' : rt < 400 ? '#e8a06a' : '#e07070'
  const selDte   = data ? Math.max(0, Math.ceil((new Date(data.selected_expiry + 'T00:00:00').getTime() - Date.now()) / 86_400_000)) : null

  return (
    <section style={{ background: '#0f0f0f', borderTop: '1px solid rgba(255,255,255,0.04)', flexShrink: 0 }}>

      {/* ── Toggle row ── */}
      <div
        className="flex items-center justify-between px-4 py-2 cursor-pointer select-none"
        style={{ borderBottom: expanded ? '1px solid rgba(255,255,255,0.05)' : 'none' }}
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center gap-2.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">
            Options entry check
          </span>
          <span className="font-mono text-[11px] font-bold text-gray-300">{ticker}</span>
          <span
            className="px-1.5 py-0.5 rounded text-[9px] font-bold"
            style={{
              background: direction === 'SHORT' ? 'rgba(251,113,133,0.12)' : 'rgba(52,211,153,0.12)',
              color:      direction === 'SHORT' ? '#fb7185' : '#34d399',
            }}
          >
            {direction === 'SHORT' ? '▼ SHORT' : '▲ LONG'}
          </span>
          {data && selDte !== null && (
            <span className="text-[10px] text-gray-700">{selDte}DTE · {side}s</span>
          )}
        </div>

        <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
          {expanded && (
            <>
              <span style={{ fontSize: 10, color: '#5A6478' }}>price</span>
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
                  color: '#E8EBF0', background: 'transparent',
                  border: 'none', borderBottom: '1px solid #252C3A',
                  outline: 'none', textAlign: 'right', padding: '1px 0',
                }}
              />
            </>
          )}
          <span style={{ fontSize: 10, color: '#5A6478', marginLeft: 4 }}>
            {expanded ? '▲' : '▼'}
          </span>
        </div>
      </div>

      {/* ── Expanded body ── */}
      {expanded && (
        <div style={{ padding: '10px 16px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* DTE selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, color: '#5A6478' }}>DTE</span>
            {([5, 7] as const).map(dte => (
              <button
                key={dte}
                onClick={() => handleDte(dte)}
                style={{
                  fontSize: 11, padding: '3px 11px', borderRadius: 5, cursor: 'pointer',
                  border: '0.5px solid',
                  borderColor: targetDte === dte ? '#639922' : '#1E2330',
                  background:  targetDte === dte ? 'rgba(99,153,34,0.20)' : '#181C23',
                  color:       targetDte === dte ? '#a3cc6a' : '#5A6478',
                }}
              >
                {dte}DTE
              </button>
            ))}
            {loading && <span style={{ fontSize: 10, color: '#5A6478' }}>loading…</span>}
          </div>

          {/* Error */}
          {error && (
            <div style={{ fontSize: 11, color: '#e07070', padding: '6px 10px', borderRadius: 5, background: 'rgba(226,75,74,0.08)' }}>
              {error}
            </div>
          )}

          {/* Stat cards */}
          {atmRow && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {([
                { lbl: 'ATM strike', val: `$${atmRow.strike.toFixed(2)}`,               sub: null,                                                              clr: '#E8EBF0' },
                { lbl: 'Mid price',  val: `$${atmRow.mid.toFixed(2)}`,                  sub: `$${(atmRow.mid * 100).toFixed(0)} per contract`,                  clr: '#E8EBF0' },
                { lbl: 'Spread cost',val: `$${(atmRow.spread * 100).toFixed(0)}`,       sub: `${atmRow.spread_pct.toFixed(1)}% of premium`,                     clr: liqColor  },
                { lbl: 'Liquidity',  val: liqLbl,                                        sub: null,                                                              clr: liqColor  },
                { lbl: 'Round trip', val: rt != null ? `$${rt.toFixed(0)}` : '—',       sub: rt != null ? `entry + exit · 2× = $${(rt * 2).toFixed(0)}` : null, clr: rtClr     },
              ] as const).map(({ lbl, val, sub, clr }) => (
                <div key={lbl} style={{ flex: 1, minWidth: 90, background: '#111318', border: '0.5px solid #1E2330', borderRadius: 7, padding: '7px 11px' }}>
                  <div style={{ fontSize: 9, color: '#5A6478', marginBottom: 2 }}>{lbl}</div>
                  <div style={{ fontSize: 15, fontWeight: 500, color: clr }}>{val}</div>
                  {sub && <div style={{ fontSize: 9, color: '#5A6478', marginTop: 1 }}>{sub}</div>}
                </div>
              ))}
            </div>
          )}

          {/* 3-strike table */}
          {three.length > 0 && (
            <div style={{ border: '0.5px solid #1E2330', borderRadius: 7, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: OC_COLS, padding: '5px 10px', fontSize: 9, fontWeight: 600, color: '#3A4355', borderBottom: '0.5px solid #1E2330', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                <span>Strike</span><span>Bid</span><span>Ask</span>
                <span>Spread</span><span>Spread%</span><span>Status</span><span>IV</span>
              </div>
              {three.map(({ r, lbl }) => {
                const sp  = r.spread_pct <= 5 ? '#a3cc6a' : r.spread_pct <= 10 ? '#e8a06a' : '#e07070'
                const isA = lbl === 'ATM'
                const bs  = r.spread_pct <= 5
                  ? { bg: 'rgba(99,153,34,0.20)',  c: '#a3cc6a', t: '✓ Enter'     }
                  : r.spread_pct <= 10
                  ? { bg: 'rgba(232,123,58,0.20)', c: '#e8a06a', t: '⚠ Size down' }
                  : { bg: 'rgba(226,75,74,0.20)',  c: '#e07070', t: '✗ Skip'      }
                return (
                  <div
                    key={r.strike}
                    style={{
                      display: 'grid', gridTemplateColumns: OC_COLS,
                      alignItems: 'center', padding: '6px 10px',
                      borderBottom: '0.5px solid #141820',
                      fontSize: 11, color: '#E8EBF0',
                      borderLeft: `2px solid ${isA ? '#639922' : 'transparent'}`,
                      background: isA ? 'rgba(99,153,34,0.07)' : 'transparent',
                    }}
                  >
                    <span>
                      <span style={{ fontWeight: isA ? 600 : 400 }}>${r.strike.toFixed(2)}</span>
                      {' '}
                      <span style={{ fontSize: 8, color: isA ? '#639922' : '#3A4355' }}>{lbl}</span>
                    </span>
                    <span>${r.bid.toFixed(2)}</span>
                    <span>${r.ask.toFixed(2)}</span>
                    <span style={{ color: sp }}>${r.spread.toFixed(2)}</span>
                    <span style={{ color: sp }}>{r.spread_pct.toFixed(1)}%</span>
                    <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 3, fontWeight: 500, display: 'inline-block', background: bs.bg, color: bs.c }}>
                      {bs.t}
                    </span>
                    <span style={{ color: '#3A4355' }}>{r.iv > 200 ? '—' : `${r.iv.toFixed(0)}%`}</span>
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
