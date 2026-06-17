import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { fetchOptionChainLiquidity, type OptionChainLiquidityResponse, type OptionChainRow } from '../api/client'
import { useApp } from '../contexts/AppContext'

// ── Trade-type config ────────────────────────────────────────────────────────

type TradeType = 'day' | 'swing' | 'long'

const TT_CONFIG: Record<TradeType, {
  label: string
  green: number   // spread_pct <= green → Enter
  amber: number   // spread_pct <= amber → Size down
  banner: string
  detailCtx: (spread: number, mid: number) => string
  statLabel: (n: number, total: number) => string
}> = {
  day: {
    label: 'Day Trade',
    green: 5,
    amber: 10,
    banner: '0DTE – 7DTE · You pay spread twice (in and out same day) · under 10% is the hard limit',
    detailCtx: (spread) =>
      `You pay this spread on entry AND exit. Total spread cost: $${(spread * 2 * 100).toFixed(0)} per contract round trip.`,
    statLabel: (n, total) => `${n} of ${total} strikes under 10% spread · viable for same-day entry/exit`,
  },
  swing: {
    label: 'Swing Trade',
    green: 10,
    amber: 15,
    banner: '21DTE – 45DTE · Spread amortizes over the move · theta manageable · gives your thesis time to play out',
    detailCtx: (spread) =>
      `Holding 3–5 days. Spread cost of $${(spread * 100).toFixed(0)} is one-time on entry. Target premium move should be 3× spread.`,
    statLabel: (n, total) => `${n} of ${total} strikes under 15% spread · viable for multi-day hold`,
  },
  long: {
    label: 'Long Term',
    green: 15,
    amber: 25,
    banner: '60DTE – 180DTE · Spread is noise relative to expected premium move · buy time, not lottery tickets',
    detailCtx: () =>
      'Holding weeks to months. Spread cost is negligible vs expected move. Focus on IV rank, not spread.',
    statLabel: (n, total) => `${n} of ${total} strikes under 25% spread · viable for weeks-to-months hold`,
  },
}

function getVerdict(spreadPct: number, tt: TradeType): { label: string; tier: 'ok' | 'warn' | 'bad' } {
  const { green, amber } = TT_CONFIG[tt]
  if (spreadPct <= green)  return { label: '✓ Enter',     tier: 'ok' }
  if (spreadPct <= amber)  return { label: '⚠ Size down', tier: 'warn' }
  return { label: '✗ Skip', tier: 'bad' }
}

// ── Tier styles (semantic — same in both themes) ─────────────────────────────

function tierStyles(T: ThemeTokens) {
  return {
    ok:   { bg: T.greenBg,  color: T.green },
    warn: { bg: T.amberBg,  color: T.amber },
    bad:  { bg: T.redBg,    color: T.red },
  }
}

// ── Theme token type ─────────────────────────────────────────────────────────

interface ThemeTokens {
  pageBg: string
  cardBg: string
  statBg: string
  border: string
  hdrBorder: string
  rowBorder: string
  text: string
  muted: string
  inputBg: string
  inputBorder: string
  btnBg: string
  btnBorder: string
  ctxLineBg: string
  ctxLineBorder: string
  rowSelBg: string
  rowAtmBg: string
  green: string
  amber: string
  red: string
  greenBg: string
  amberBg: string
  redBg: string
  atmBorder: string
  selBorder: string
}

function makeTokens(isDark: boolean): ThemeTokens {
  return isDark ? {
    pageBg:       '#0A0C10',
    cardBg:       '#111318',
    statBg:       '#181C23',
    border:       '#1E2330',
    hdrBorder:    '#252C3A',
    rowBorder:    '#1A1F2B',
    text:         '#E8EBF0',
    muted:        '#5A6478',
    inputBg:      '#181C23',
    inputBorder:  '#252C3A',
    btnBg:        '#181C23',
    btnBorder:    '#252C3A',
    ctxLineBg:    '#181C23',
    ctxLineBorder:'#252C3A',
    rowSelBg:     'rgba(55,138,221,0.14)',
    rowAtmBg:     'rgba(99,153,34,0.10)',
    green:        '#a3cc6a',
    amber:        '#e8a06a',
    red:          '#e07070',
    greenBg:      'rgba(99,153,34,0.20)',
    amberBg:      'rgba(232,123,58,0.20)',
    redBg:        'rgba(226,75,74,0.20)',
    atmBorder:    '#639922',
    selBorder:    '#378ADD',
  } : {
    pageBg:       '#F3F4F6',
    cardBg:       '#FFFFFF',
    statBg:       'rgba(0,0,0,0.03)',
    border:       'rgba(0,0,0,0.10)',
    hdrBorder:    'rgba(0,0,0,0.12)',
    rowBorder:    'rgba(0,0,0,0.06)',
    text:         '#111827',
    muted:        '#6B7280',
    inputBg:      'rgba(0,0,0,0.04)',
    inputBorder:  'rgba(0,0,0,0.15)',
    btnBg:        'rgba(0,0,0,0.04)',
    btnBorder:    'rgba(0,0,0,0.15)',
    ctxLineBg:    'rgba(0,0,0,0.03)',
    ctxLineBorder:'rgba(0,0,0,0.12)',
    rowSelBg:     'rgba(37,99,235,0.10)',
    rowAtmBg:     'rgba(22,163,74,0.08)',
    green:        '#15803d',
    amber:        '#b45309',
    red:          '#dc2626',
    greenBg:      'rgba(22,163,74,0.10)',
    amberBg:      'rgba(180,83,9,0.10)',
    redBg:        'rgba(220,38,38,0.08)',
    atmBorder:    '#16a34a',
    selBorder:    '#2563eb',
  }
}

// ── Badge ────────────────────────────────────────────────────────────────────

function Badge({ label, tier, T }: { label: string; tier: 'ok' | 'warn' | 'bad'; T: ThemeTokens }) {
  const s = tierStyles(T)[tier]
  return (
    <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 3, fontWeight: 500, background: s.bg, color: s.color }}>
      {label}
    </span>
  )
}

// ── Stat cards ───────────────────────────────────────────────────────────────

function StatCards({ rows, atm, tradeType, T }: {
  rows: OptionChainRow[]; atm: OptionChainRow | null; tradeType: TradeType; T: ThemeTokens
}) {
  if (!atm) return null
  const cfg = TT_CONFIG[tradeType]
  const liquidThresh = cfg.amber
  const enterCount = rows.filter(r => r.spread_pct <= liquidThresh).length
  const liqColor = atm.spread_pct <= cfg.green ? T.green : atm.spread_pct <= cfg.amber ? T.amber : T.red
  const liqLabel = atm.spread_pct <= cfg.green ? '✓ Good liquidity' : atm.spread_pct <= cfg.amber ? '⚠ Moderate' : '✗ Poor liquidity'

  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
      {[
        {
          label: 'ATM strike',
          big: `$${atm.strike.toFixed(2)}`,
          sub: null,
        },
        {
          label: 'Mid price',
          big: `$${atm.mid.toFixed(2)}`,
          sub: `$${(atm.mid * 100).toFixed(0)} per contract`,
        },
        {
          label: 'Spread cost',
          big: <span style={{ color: liqColor }}>${(atm.spread * 100).toFixed(0)}</span>,
          sub: `${atm.spread_pct.toFixed(1)}% of premium · per contract`,
        },
        {
          label: 'Liquidity',
          big: <span style={{ fontSize: 14, color: liqColor }}>{liqLabel}</span>,
          sub: cfg.statLabel(enterCount, rows.length),
        },
      ].map(({ label, big, sub }) => (
        <div key={label} style={{ background: T.statBg, border: `0.5px solid ${T.border}`, borderRadius: 8, padding: '10px 14px', flex: 1, minWidth: 120 }}>
          <div style={{ fontSize: 10, color: T.muted, marginBottom: 4 }}>{label}</div>
          <div style={{ fontSize: 20, fontWeight: 500, color: T.text }}>{big}</div>
          {sub && <div style={{ fontSize: 10, color: T.muted }}>{sub}</div>}
        </div>
      ))}
    </div>
  )
}

// ── Detail card ──────────────────────────────────────────────────────────────

function DetailCard({ row, direction, expiry, ticker, tradeType, T }: {
  row: OptionChainRow; direction: 'call' | 'put'; expiry: string; ticker: string; tradeType: TradeType; T: ThemeTokens
}) {
  const cfg = TT_CONFIG[tradeType]
  const verdict = getVerdict(row.spread_pct, tradeType)
  const cost2 = (row.mid * 200).toFixed(0)
  const tgt = direction === 'call'
    ? (row.strike + row.mid * 2).toFixed(2)
    : (row.strike - row.mid * 2).toFixed(2)
  const contextLine = cfg.detailCtx(row.spread, row.mid)

  const warnStyle: React.CSSProperties = {
    marginTop: 8, padding: '7px 10px', borderRadius: '0 4px 4px 0',
    fontSize: 11,
  }
  const warnBlock = verdict.tier === 'bad' ? (
    <div style={{ ...warnStyle, borderLeft: `3px solid ${T.red}`, background: T.redBg, color: T.red }}>
      ✗ Spread is {row.spread_pct.toFixed(1)}% of premium — ${(row.spread * 100).toFixed(0)} gone per contract on entry. Skip this strike.
    </div>
  ) : verdict.tier === 'warn' ? (
    <div style={{ ...warnStyle, borderLeft: `3px solid ${T.amber}`, background: T.amberBg, color: T.amber }}>
      ⚠ Spread {row.spread_pct.toFixed(1)}% — acceptable. Size down to 1 contract.
    </div>
  ) : (
    <div style={{ ...warnStyle, borderLeft: `3px solid ${T.green}`, background: T.greenBg, color: T.green }}>
      ✓ Spread clean at {row.spread_pct.toFixed(1)}% — good to enter 2 contracts.
    </div>
  )

  return (
    <div style={{ marginTop: 12, background: T.ctxLineBg, border: `0.5px solid ${T.border}`, borderRadius: 8, padding: '12px 14px', fontSize: 12, color: T.text }}>
      {/* Trade type context line */}
      <div style={{ fontSize: 11, color: T.muted, marginBottom: 10, padding: '6px 10px', background: T.ctxLineBg, borderRadius: 4, borderLeft: `2px solid ${T.ctxLineBorder}` }}>
        {contextLine}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontWeight: 500 }}>${row.strike.toFixed(2)} {direction.toUpperCase()} · {expiry} · {ticker}</span>
        <Badge label={verdict.label} tier={verdict.tier} T={T} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
        {[
          { label: 'Bid / Ask', val: `$${row.bid.toFixed(2)} / $${row.ask.toFixed(2)}` },
          { label: '2 contracts cost', val: `$${cost2}` },
          { label: 'Max loss', val: `-$${cost2}`, color: T.red },
          { label: 'IV', val: row.iv > 200 ? '—' : `${row.iv.toFixed(0)}%` },
          { label: '2× target price', val: `$${tgt}`, color: T.green },
          { label: 'Spread / contract', val: `$${(row.spread * 100).toFixed(0)}`, color: verdict.tier === 'ok' ? T.green : verdict.tier === 'warn' ? T.amber : T.red },
        ].map(({ label, val, color }) => (
          <div key={label}>
            <div style={{ fontSize: 10, color: T.muted }}>{label}</div>
            <div style={{ color: color ?? T.text }}>{val}</div>
          </div>
        ))}
      </div>
      {warnBlock}
    </div>
  )
}

// ── Chain table ──────────────────────────────────────────────────────────────

const COL_WIDTHS = '70px 70px 70px 65px 70px 110px 55px'

function ChainTable({ rows, tradeType, direction, expiry, ticker, selectedStrike, onSelect, T }: {
  rows: OptionChainRow[]
  tradeType: TradeType
  direction: 'call' | 'put'
  expiry: string
  ticker: string
  selectedStrike: number | null
  onSelect: (s: number) => void
  T: ThemeTokens
}) {
  if (rows.length === 0) {
    return <div style={{ padding: '20px 12px', fontSize: 12, color: T.muted, textAlign: 'center' }}>No data for this expiry.</div>
  }

  return (
    <div style={{ border: `0.5px solid ${T.border}`, borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: COL_WIDTHS, padding: '6px 12px', fontSize: 10, fontWeight: 500, color: T.muted, borderBottom: `0.5px solid ${T.hdrBorder}`, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        <span>Strike</span><span>Bid</span><span>Ask</span>
        <span>Spread</span><span>Spread %</span><span>Status</span><span>IV</span>
      </div>
      {rows.map(r => {
        const verdict = getVerdict(r.spread_pct, tradeType)
        const spColor = r.spread_pct <= TT_CONFIG[tradeType].green ? T.green : r.spread_pct <= TT_CONFIG[tradeType].amber ? T.amber : T.red
        const isSelected = selectedStrike === r.strike
        const rowStyle: React.CSSProperties = {
          display: 'grid', gridTemplateColumns: COL_WIDTHS,
          alignItems: 'center', padding: '7px 12px',
          borderBottom: isSelected ? 'none' : `0.5px solid ${T.rowBorder}`,
          fontSize: 12, cursor: 'pointer',
          color: T.text, transition: 'background .12s',
          background: isSelected
            ? T.rowSelBg
            : r.is_atm
            ? T.rowAtmBg
            : 'transparent',
          borderLeft: isSelected ? `2px solid ${T.selBorder}` : r.is_atm ? `2px solid ${T.atmBorder}` : '2px solid transparent',
        }
        return (
          <Fragment key={r.strike}>
            <div style={rowStyle} onClick={() => onSelect(r.strike)}>
              <span style={{ fontWeight: r.is_atm ? 500 : 400, color: r.is_atm ? T.green : T.text }}>
                ${r.strike.toFixed(2)}{r.is_atm ? ' ATM' : ''}
              </span>
              <span>${r.bid.toFixed(2)}</span>
              <span>${r.ask.toFixed(2)}</span>
              <span style={{ color: spColor }}>${r.spread.toFixed(2)}</span>
              <span style={{ color: spColor }}>{r.spread_pct.toFixed(1)}%</span>
              <span><Badge label={verdict.label} tier={verdict.tier} T={T} /></span>
              <span style={{ color: T.muted }}>{r.iv > 200 ? '—' : `${r.iv.toFixed(0)}%`}</span>
            </div>
            {isSelected && (
              <div style={{ background: T.rowSelBg, borderBottom: `0.5px solid ${T.rowBorder}`, borderLeft: `2px solid ${T.selBorder}`, padding: '0 12px 12px' }}>
                <DetailCard row={r} direction={direction} expiry={expiry} ticker={ticker} tradeType={tradeType} T={T} />
              </div>
            )}
          </Fragment>
        )
      })}
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────

const LS_TRADE_TYPE = 'oa_chain_trade_type'

export default function OptionChainPage() {
  const { theme } = useApp()
  const isDark = theme !== 'light'
  const T = makeTokens(isDark)

  const [searchParams, setSearchParams] = useSearchParams()

  const [tickerInput, setTickerInput] = useState(() => searchParams.get('ticker') ?? '')
  const [submittedTicker, setSubmittedTicker] = useState('')
  const [direction, setDirection] = useState<'call' | 'put'>('call')
  const [tradeType, setTradeType] = useState<TradeType>(() => {
    const saved = localStorage.getItem(LS_TRADE_TYPE) as TradeType | null
    return saved && ['day', 'swing', 'long'].includes(saved) ? saved : 'day'
  })
  const [selectedExpiry, setSelectedExpiry] = useState<string | null>(null)
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [data, setData] = useState<OptionChainLiquidityResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    localStorage.setItem(LS_TRADE_TYPE, tradeType)
  }, [tradeType])

  const fetch = useCallback(async (ticker: string, expiry?: string) => {
    const t = ticker.trim().toUpperCase()
    if (!t) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetchOptionChainLiquidity(t, expiry)
      setData(res)
      setSubmittedTicker(t)
      setSelectedExpiry(res.selected_expiry)
      setSelectedStrike(null)
      setShowAll(false)
      setSearchParams(prev => { prev.set('ticker', t); return prev }, { replace: true })
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail ?? 'Failed to load option chain.')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [setSearchParams])

  useEffect(() => {
    const t = searchParams.get('ticker')
    if (t) fetch(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleExpiryChange = (exp: string) => {
    setSelectedExpiry(exp)
    setSelectedStrike(null)
    fetch(submittedTicker, exp)
  }

  const handleTradeTypeChange = (tt: TradeType) => {
    setTradeType(tt)
    setSelectedStrike(null)
  }

  const rows = data ? (direction === 'call' ? data.calls : data.puts) : []
  const atm = rows.find(r => r.is_atm) ?? null
  const cfg = TT_CONFIG[tradeType]
  const currentPrice = data?.current_price ?? 0
  const highPrice = currentPrice > 500

  const visibleRows = showAll || currentPrice <= 0
    ? rows
    : rows.filter(r => Math.abs(r.strike - currentPrice) / currentPrice <= 0.10)
  const hiddenCount = rows.length - visibleRows.length

  const btnBase: React.CSSProperties = {
    fontSize: 12, padding: '5px 12px', borderRadius: 6,
    border: `0.5px solid ${T.btnBorder}`,
    background: T.btnBg, color: T.text, cursor: 'pointer',
  }
  const btnActive: React.CSSProperties = {
    ...btnBase, background: T.greenBg, borderColor: T.atmBorder, color: T.green,
  }

  const dirBtnStyle = (d: 'call' | 'put'): React.CSSProperties => ({
    fontSize: 11, padding: '4px 12px', borderRadius: 5, cursor: 'pointer',
    border: `0.5px solid ${T.btnBorder}`, transition: 'all .12s',
    background: direction === d
      ? (d === 'call' ? T.greenBg : T.redBg)
      : 'transparent',
    borderColor: direction === d ? (d === 'call' ? T.atmBorder : T.red) : T.btnBorder,
    color: direction === d ? (d === 'call' ? T.green : T.red) : T.muted,
  })

  return (
    <div style={{ background: T.pageBg, minHeight: '100vh', padding: 16, fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
      <div style={{ background: T.cardBg, borderRadius: 12, padding: 16, color: T.text, maxWidth: 800, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ fontSize: 13, fontWeight: 500, color: T.text, marginBottom: 14 }}>
          Options chain · liquidity checker
        </div>

        {/* Ticker search + direction */}
        <form
          onSubmit={e => { e.preventDefault(); fetch(tickerInput) }}
          style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}
        >
          <span style={{ fontSize: 11, color: T.muted }}>Ticker</span>
          <input
            ref={inputRef}
            value={tickerInput}
            onChange={e => setTickerInput(e.target.value.toUpperCase())}
            placeholder="AAPL"
            style={{ fontSize: 12, padding: '5px 8px', borderRadius: 5, border: `0.5px solid ${T.inputBorder}`, background: T.inputBg, color: T.text, width: 90 }}
          />
          <button type="submit" style={btnBase} disabled={loading}>
            {loading ? '…' : 'Load'}
          </button>
          <button type="button" style={dirBtnStyle('call')} onClick={() => { setDirection('call'); setSelectedStrike(null) }}>
            ▲ Call
          </button>
          <button type="button" style={dirBtnStyle('put')} onClick={() => { setDirection('put'); setSelectedStrike(null) }}>
            ▼ Put
          </button>
          {data && (
            <span style={{ fontSize: 12, color: T.muted, marginLeft: 4 }}>
              {data.ticker} · <span style={{ color: T.text }}>${data.current_price.toFixed(2)}</span>
            </span>
          )}
        </form>

        {/* Expiry / DTE selector */}
        {data && data.expiries.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: T.muted }}>Expiry</span>
            {data.expiries.map(exp => {
              const dteD = Math.max(0, Math.ceil((new Date(exp + 'T00:00:00').getTime() - Date.now()) / 86_400_000))
              const isActive = exp === selectedExpiry
              return (
                <button
                  key={exp}
                  style={isActive ? btnActive : btnBase}
                  onClick={() => handleExpiryChange(exp)}
                >
                  {dteD === 0 ? '0DTE' : `${dteD}DTE`}
                </button>
              )
            })}
          </div>
        )}

        {/* Trade type selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: T.muted }}>Type</span>
          {(['day', 'swing', 'long'] as TradeType[]).map(tt => (
            <button
              key={tt}
              style={tradeType === tt ? btnActive : btnBase}
              onClick={() => handleTradeTypeChange(tt)}
            >
              {TT_CONFIG[tt].label}
            </button>
          ))}
        </div>

        {/* DTE banner */}
        <div style={{ fontSize: 11, color: T.muted, padding: '4px 0 10px', borderBottom: `0.5px solid ${T.border}`, marginBottom: 12 }}>
          {cfg.banner}
        </div>

        {/* High-price warning */}
        {highPrice && (
          <div style={{ fontSize: 11, padding: '5px 10px', borderLeft: `3px solid ${T.red}`, borderRadius: '0 4px 4px 0', background: T.redBg, color: T.red, marginBottom: 10 }}>
            ⚠ Stock above $500 — dollar spread cost is high regardless of % · Day trade: 1 contract max · Swing/Long: normal sizing
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ fontSize: 12, color: T.red, marginBottom: 12, padding: '8px 12px', background: T.redBg, borderRadius: 6 }}>
            {error}
          </div>
        )}

        {/* Empty state */}
        {!data && !loading && !error && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: T.muted, fontSize: 12 }}>
            Enter a ticker above to load the option chain.
          </div>
        )}

        {/* Stat cards */}
        {data && visibleRows.length > 0 && (
          <StatCards rows={visibleRows} atm={atm} tradeType={tradeType} T={T} />
        )}

        {/* Show-all toggle */}
        {data && hiddenCount > 0 && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
            <button
              style={{ fontSize: 11, padding: '3px 10px', borderRadius: 5, cursor: 'pointer', border: `0.5px solid ${T.btnBorder}`, background: T.btnBg, color: T.muted }}
              onClick={() => { setShowAll(v => !v); setSelectedStrike(null) }}
            >
              {showAll ? `Near ATM only (±10%)` : `Show all ${hiddenCount + visibleRows.length} strikes`}
            </button>
          </div>
        )}

        {/* Chain table — detail card expands inline below selected row */}
        {data && (
          <ChainTable
            rows={visibleRows}
            tradeType={tradeType}
            direction={direction}
            expiry={selectedExpiry ?? ''}
            ticker={submittedTicker}
            selectedStrike={selectedStrike}
            onSelect={s => setSelectedStrike(prev => prev === s ? null : s)}
            T={T}
          />
        )}

      </div>
    </div>
  )
}
