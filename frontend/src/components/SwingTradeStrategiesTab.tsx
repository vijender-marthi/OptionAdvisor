/**
 * Swing Trade Strategies Tab — comprehensive reference for swing entry/exit strategies,
 * signals to watch, timing, risk management, and multi-day hold guidance (3-5 days).
 *
 * Covers the swing engine's MA/MACD/RSI scoring system, IV-rank-aware strategy selection,
 * earnings/extension/VIX gating, and position management for overnight to 5-day holds.
 */
import { useState, useEffect } from 'react'
import {
  Activity, AlertTriangle, ArrowDown, ArrowUp, BarChart2, Clock, Flame,
  Gauge, Layers, Target, TrendingUp, Shield, Zap, Calendar, Eye, CheckCircle2, XCircle,
} from 'lucide-react'

type StTokens = {
  bg: string; bgDeep: string; border: string; text: string; muted: string
  green: string; red: string; amber: string; accent: string; violet: string
}

type SubTab = 'entry' | 'exit' | 'signals' | 'timing' | 'risk' | 'mistakes'

export default function SwingTradeStrategiesTab({ st }: { st: StTokens }) {
  const [subTab, setSubTab] = useState<SubTab>('entry')

  const subTabs: { id: SubTab; label: string; icon: React.ReactNode }[] = [
    { id: 'entry',    label: 'Entry Strategies',    icon: <ArrowUp size={13} /> },
    { id: 'exit',     label: 'Exit Rules',          icon: <Target size={13} /> },
    { id: 'signals',  label: 'Signals to Watch',    icon: <Eye size={13} /> },
    { id: 'timing',   label: 'Timing & Holds',      icon: <Clock size={13} /> },
    { id: 'risk',     label: 'Risk Management',     icon: <Shield size={13} /> },
    { id: 'mistakes', label: 'Common Mistakes',     icon: <AlertTriangle size={13} /> },
  ]

  return (
    <div className="swing-trade-strategies-tab" style={{ minHeight: 400 }}>
      <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderBottom: `1px solid ${st.border}`, flexWrap: 'wrap' }}>
        {subTabs.map(({ id, label, icon }) => {
          const active = subTab === id
          return (
            <button key={id} onClick={() => setSubTab(id)} style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '8px 14px',
              fontSize: 12, fontWeight: active ? 700 : 500,
              color: active ? st.accent : st.muted, background: 'none', border: 'none',
              borderBottom: active ? `2px solid ${st.accent}` : '2px solid transparent',
              marginBottom: -1, cursor: 'pointer', transition: 'color 0.15s', whiteSpace: 'nowrap',
            }}>{icon} {label}</button>
          )
        })}
      </div>

      {subTab === 'entry'    && <EntryStrategies st={st} />}
      {subTab === 'exit'     && <ExitRules st={st} />}
      {subTab === 'signals'  && <SignalsToWatch st={st} />}
      {subTab === 'timing'   && <TimingHolds st={st} />}
      {subTab === 'risk'     && <RiskManagement st={st} />}
      {subTab === 'mistakes' && <CommonMistakes st={st} />}
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Card({ st, title, icon, children, accent }: { st: StTokens; title: string; icon: React.ReactNode; children: React.ReactNode; accent?: string }) {
  return (
    <div style={{ background: st.bg, border: `1px solid ${st.border}`, borderRadius: 14, padding: '14px 16px', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ color: accent || st.accent }}>{icon}</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: st.text }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

function Row({ label, value, color, st }: { label: string; value: string; color?: string; st: StTokens }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '4px 0', borderBottom: `1px solid ${st.border}40` }}>
      <span style={{ fontSize: 11.5, color: st.muted, flexShrink: 0, paddingRight: 8 }}>{label}</span>
      <span style={{ fontSize: 11.5, color: color || st.text, textAlign: 'right', fontWeight: 500, fontFamily: 'monospace' }}>{value}</span>
    </div>
  )
}

function Pill({ text, color, bg }: { text: string; color: string; bg: string }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 5, color, background: bg, border: `1px solid ${color}40`, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{text}</span>
}

function CheckItem({ text, ok, st }: { text: string; ok: boolean; st: StTokens }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '3px 0' }}>
      {ok ? <CheckCircle2 size={13} style={{ color: st.green, flexShrink: 0, marginTop: 1 }} /> : <XCircle size={13} style={{ color: st.red, flexShrink: 0, marginTop: 1 }} />}
      <span style={{ fontSize: 11.5, color: st.text, lineHeight: 1.45 }}>{text}</span>
    </div>
  )
}

// ─── Entry Strategies ──────────────────────────────────────────────────────────

function EntryStrategies({ st }: { st: StTokens }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: st.muted, marginBottom: 14, lineHeight: 1.55 }}>
        The swing engine scores on daily candles using MA20/MA50 trend, RSI, MACD, momentum, volume,
        and market context. Entry quality is gated by earnings, VIX, IV rank, extension, and liquidity.
        Target hold: <strong style={{ color: st.amber }}>3-5 trading days</strong>.
      </div>

      <Card st={st} title="Quality Long — STRONG GO" icon={<ArrowUp size={15} />} accent={st.green}>
        <Pill text="Best setup" color={st.green} bg={`${st.green}15`} />
        <div style={{ marginTop: 8 }}>
          <CheckItem text="MA20 > MA50 (bullish trend structure)" ok={true} st={st} />
          <CheckItem text="RSI 55-70 (momentum without overbought)" ok={true} st={st} />
          <CheckItem text="MACD bullish crossover (above signal line)" ok={true} st={st} />
          <CheckItem text="5-day momentum positive (not >+8% extended)" ok={true} st={st} />
          <CheckItem text="Volume expanding (≥1.2× average)" ok={true} st={st} />
          <CheckItem text="SPY/QQQ aligned or neutral" ok={true} st={st} />
          <CheckItem text="Trade quality score ≥ 8.0 + LOW/MEDIUM risk" ok={true} st={st} />
          <CheckItem text="No earnings within 5 days" ok={true} st={st} />
        </div>
        <div style={{ marginTop: 8 }}>
          <Row label="Strategy" value="Long Call (IV<60) / Debit Spread (IV 60-74)" color={st.text} st={st} />
          <Row label="Expiry" value="1-2 weeks (high quality) / 2-3 weeks (standard)" color={st.text} st={st} />
          <Row label="Stop" value="2% below MA20" color={st.red} st={st} />
          <Row label="Targets" value="T1 = 50% measured move, T2 = 100%" color={st.green} st={st} />
        </div>
      </Card>

      <Card st={st} title="Quality Short — STRONG GO" icon={<ArrowDown size={15} />} accent={st.red}>
        <Pill text="Bearish mirror" color={st.red} bg={`${st.red}15`} />
        <div style={{ marginTop: 8 }}>
          <CheckItem text="MA20 < MA50 (bearish trend structure)" ok={true} st={st} />
          <CheckItem text="RSI 30-45 (momentum without oversold)" ok={true} st={st} />
          <CheckItem text="MACD bearish crossover (below signal line)" ok={true} st={st} />
          <CheckItem text="5-day momentum negative (not >-8% extended)" ok={true} st={st} />
          <CheckItem text="Volume expanding on red days" ok={true} st={st} />
          <CheckItem text="Trade quality score ≥ 8.0 + LOW/MEDIUM risk" ok={true} st={st} />
        </div>
        <div style={{ marginTop: 8 }}>
          <Row label="Strategy" value="Long Put (IV<60) / Debit Spread (IV 60-74)" color={st.text} st={st} />
          <Row label="Stop" value="2% above MA20" color={st.red} st={st} />
        </div>
      </Card>

      <Card st={st} title="WATCH — Extended but Bullish" icon={<Eye size={15} />} accent={st.amber}>
        <div style={{ fontSize: 11.5, color: st.muted, marginBottom: 8 }}>
          Setup is bullish but price is extended. Wait for a pullback before entering.
        </div>
        <CheckItem text="RSI > 70 (overbought) — wait for pullback below 70" ok={false} st={st} />
        <CheckItem text="5-day move > +8% — wait for consolidation" ok={false} st={st} />
        <CheckItem text="Price > 8% above MA20 — wait for pullback toward MA" ok={false} st={st} />
        <div style={{ marginTop: 8 }}>
          <Row label="Action" value="Set alert at pullback zone (±1% of MA20)" color={st.amber} st={st} />
          <Row label="Strategy when entering" value="Debit spread (defined risk)" color={st.text} st={st} />
        </div>
      </Card>

      <Card st={st} title="AVOID — Earnings Imminent" icon={<AlertTriangle size={15} />} accent={st.red}>
        <div>
          <CheckItem text="Earnings within 2 days → AVOID naked calls (IV crush risk)" ok={false} st={st} />
          <CheckItem text="Earnings within 5 days → score penalty -2.0" ok={false} st={st} />
          <CheckItem text="If you must trade: use credit spreads (sell premium)" ok={true} st={st} />
        </div>
        <div style={{ marginTop: 8 }}>
          <Row label="Strategy" value="Credit spread (if IV ≥ 70)" color={st.amber} st={st} />
          <Row label="Rationale" value="Capture IV crush + theta decay, don't fight it" color={st.muted} st={st} />
        </div>
      </Card>

      <Card st={st} title="IV-Rank-Aware Strategy Selection" icon={<Layers size={15} />} accent={st.violet}>
        <div style={{ fontSize: 11.5, color: st.muted, marginBottom: 8 }}>
          The engine automatically selects the best option strategy based on IV rank:
        </div>
        <Row label="IV < 50 (low)" value="Long Call / Long Put — buy cheap premium" color={st.green} st={st} />
        <Row label="IV 50-69 (moderate)" value="Debit Spread — reduce cost" color={st.text} st={st} />
        <Row label="IV 60-74 (elevated)" value="Debit Spread (STRONG_GO only)" color={st.amber} st={st} />
        <Row label="IV ≥ 70 (high)" value="Credit Spread — sell premium, capture crush" color={st.amber} st={st} />
        <Row label="IV ≥ 75 (very high)" value="Bull Put / Bear Call Spread" color={st.red} st={st} />
        <Row label="IV ≥ 85 (extreme)" value="IV_VERY_HIGH flag — credit spreads only" color={st.red} st={st} />
      </Card>

      <Card st={st} title="Hard Override Priority Cascade" icon={<Shield size={15} />} accent={st.red}>
        <div style={{ fontSize: 11.5, color: st.muted, marginBottom: 8 }}>
          The engine evaluates these in priority order — the first match wins:
        </div>
        <Row label="1. Low liquidity" value="NO_TRADE — can't trade options" color={st.red} st={st} />
        <Row label="2. Earnings ≤ 2 days" value="AVOID_NAKED_CALLS" color={st.red} st={st} />
        <Row label="3. VIX ≥ 35" value="NO_TRADE — critically elevated" color={st.red} st={st} />
        <Row label="4. Very extended (>12% in 5d)" value="AVOID_CHASE — don't chase" color={st.red} st={st} />
        <Row label="5. Extended (>8% / RSI>73)" value="WAIT_PULLBACK" color={st.amber} st={st} />
        <Row label="6. Score ≥ 8.0 + low risk" value="STRONG_GO — quality entry" color={st.green} st={st} />
        <Row label="7. Score ≥ 6.5" value="WATCH — good but not perfect" color={st.amber} st={st} />
        <Row label="8. Score ≥ 5.0" value="WAIT — needs more confirmation" color={st.amber} st={st} />
        <Row label="9. Neutral bias" value="NO_TRADE — no edge" color={st.muted} st={st} />
      </Card>
    </div>
  )
}

// ─── Exit Rules ────────────────────────────────────────────────────────────────

function ExitRules({ st }: { st: StTokens }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: st.muted, marginBottom: 14, lineHeight: 1.55 }}>
        Swing exits are based on the MA20 structural break (primary invalidation) and measured-move
        targets. The live exit engine monitors stop-hit for held swing positions.
      </div>

      <Card st={st} title="Price-Based Exit Rules" icon={<Target size={15} />} accent={st.green}>
        <Row label="Target 1 reached" value="Sell ½ position, move stop to breakeven" color={st.green} st={st} />
        <Row label="T1 formula" value="Entry + 50% of (price - MA20) distance" color={st.text} st={st} />
        <Row label="Target 2 reached" value="Sell remaining ½ position" color={st.green} st={st} />
        <Row label="T2 formula" value="Entry + 100% of measured move" color={st.text} st={st} />
        <Row label="MA20 break (daily close)" value="Exit full — thesis invalidated" color={st.red} st={st} />
        <Row label="High-risk stall at T1" value="Exit full — momentum lost" color={st.red} st={st} />
        <Row label="Stop loss hit" value="Exit full — accept the loss" color={st.red} st={st} />
      </Card>

      <Card st={st} title="Live Exit Signals (Real-Time)" icon={<AlertTriangle size={15} />} accent={st.red}>
        <Row label="STOP_HIT" value="CRITICAL — exit immediately at market" color={st.red} st={st} />
        <Row label="TARGET" value="WARNING — take profit, sell ½, trail the rest" color={st.green} st={st} />
        <Row label="TRAILING_STOP" value="WARNING — 1% pullback from peak, tighten" color={st.amber} st={st} />
        <div style={{ marginTop: 8, fontSize: 11, color: st.muted }}>
          Note: VWAP/OR/EOD checks are intraday-only and do not apply to swing positions.
        </div>
      </Card>

      <Card st={st} title="Active Position Monitoring" icon={<Activity size={15} />} accent={st.violet}>
        <div style={{ fontSize: 11.5, color: st.muted, marginBottom: 8 }}>
          For held swing positions, the engine checks:
        </div>
        <Row label="DTE ≤ 2" value="EXIT — expiry approaching" color={st.red} st={st} />
        <Row label="DTE ≤ 5 + OR break against thesis" value="EXIT — weakness" color={st.red} st={st} />
        <Row label="Market stress (VIX ≥32, SPY ≤-1.5%)" value="WEAKENING — consider exit" color={st.amber} st={st} />
        <Row label="Thesis intact" value="HOLD — swing" color={st.green} st={st} />
      </Card>

      <Card st={st} title="Multi-Day Exit Timeline (3-5 Day Holds)" icon={<Calendar size={15} />} accent={st.violet}>
        <Row label="Day 1" value="Take ½ off at T1, move stop to breakeven" color={st.text} st={st} />
        <Row label="Day 2-3" value="Trail stop at MA20, take remaining at T2" color={st.text} st={st} />
        <Row label="Day 4" value="If thesis intact, hold with tight stop (MA20)" color={st.amber} st={st} />
        <Row label="Day 5" value="Exit by close — do not extend beyond 5 days" color={st.red} st={st} />
        <Row label="Daily trend break" value="Price closes below MA20 (long) → exit" color={st.red} st={st} />
        <Row label="Gap against position" value="If gaps below stop, exit at open" color={st.red} st={st} />
        <Row label="Earnings approaching" value="Exit 1 day before — never hold through" color={st.red} st={st} />
      </Card>
    </div>
  )
}

// ─── Signals to Watch ──────────────────────────────────────────────────────────

function SignalsToWatch({ st }: { st: StTokens }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: st.muted, marginBottom: 14, lineHeight: 1.55 }}>
        The swing engine uses 8 scoring factors on daily candles. Each contributes to the
        bull/bear score, which determines the verdict.
      </div>

      <Card st={st} title="Scoring Factors" icon={<BarChart2 size={15} />} accent={st.accent}>
        <Row label="Price vs MA20" value="±2.0 pts — above=bullish, below=bearish" color={st.text} st={st} />
        <Row label="MA trend (MA20 vs MA50)" value="0.5-3.0 pts — proportional to spread" color={st.text} st={st} />
        <Row label="MA convergence" value="Halves trend score if spread narrowing" color={st.amber} st={st} />
        <Row label="RSI(14)" value="±1.5 pts — 55+ bull, 45- bear, 45-55 neutral" color={st.text} st={st} />
        <Row label="MACD crossover" value="±2.0 pts + ±0.5 histogram bonus" color={st.text} st={st} />
        <Row label="5-day momentum" value="±1.0 pt — ±1.5% neutral band" color={st.text} st={st} />
        <Row label="Volume participation" value="±1.5 pts — bull/bear expanding / mixed / low" color={st.text} st={st} />
        <Row label="Market context (SPY)" value="±0.5 pts — QQQ is inline note only" color={st.text} st={st} />
        <Row label="VIX penalty" value="-0.5 both sides when VIX elevated" color={st.amber} st={st} />
      </Card>

      <Card st={st} title="Trade Quality Score Adjustments" icon={<Gauge size={15} />} accent={st.violet}>
        <div style={{ fontSize: 11.5, color: st.muted, marginBottom: 8 }}>
          The raw bull/bear score is adjusted for risk factors:
        </div>
        <Row label="Market counter-trend" value="-2.0 pts" color={st.red} st={st} />
        <Row label="Very extended (>12%)" value="-4.0 pts" color={st.red} st={st} />
        <Row label="Extended (>8%)" value="-2.0 pts" color={st.amber} st={st} />
        <Row label="Earnings ≤ 5 days" value="-4.0 / -2.0 pts" color={st.red} st={st} />
        <Row label="IV rank ≥ 70" value="-2.5 pts" color={st.amber} st={st} />
        <Row label="IV rank ≥ 50" value="-1.5 pts" color={st.amber} st={st} />
        <Row label="Low liquidity" value="-4.0 pts" color={st.red} st={st} />
        <Row label="Volume expanding" value="+1.0 pt" color={st.green} st={st} />
      </Card>

      <Card st={st} title="Verdict Thresholds" icon={<Target size={15} />} accent={st.green}>
        <Row label="STRONG_GO" value="Score ≥ 8.0 + LOW/MEDIUM risk" color={st.green} st={st} />
        <Row label="GO / WATCH" value="Score ≥ 6.5" color={st.amber} st={st} />
        <Row label="WAIT" value="Score ≥ 5.0 — needs more confirmation" color={st.amber} st={st} />
        <Row label="NO_TRADE" value="Score < 5.0 or neutral bias" color={st.muted} st={st} />
        <Row label="AVOID" value="Hard override (earnings, VIX, extension)" color={st.red} st={st} />
      </Card>

      <Card st={st} title="Key Indicators to Monitor" icon={<Eye size={15} />} accent={st.accent}>
        <Row label="MA20" value="Primary trend + stop reference" color={st.text} st={st} />
        <Row label="MA50" value="Secondary trend confirmation" color={st.text} st={st} />
        <Row label="RSI(14)" value="Momentum — 55+ bull, 45- bear, 70+ extended" color={st.text} st={st} />
        <Row label="MACD (12/26/9)" value="Crossover + histogram momentum" color={st.text} st={st} />
        <Row label="Volume ratio" value="1.2× = expanding, 0.7× = low participation" color={st.text} st={st} />
        <Row label="IV rank" value="Strategy selector — <50 buy, ≥70 sell premium" color={st.text} st={st} />
        <Row label="VIX" value="≥35 = NO_TRADE, ≥25 = HIGH risk, <18 = LOW" color={st.text} st={st} />
      </Card>
    </div>
  )
}

// ─── Timing & Holds ────────────────────────────────────────────────────────────

function TimingHolds({ st }: { st: StTokens }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: st.muted, marginBottom: 14, lineHeight: 1.55 }}>
        Swing trades target 3-5 trading day holds. Entry timing matters — the best entries
        are at pullback-to-MA20 zones, not at extension highs.
      </div>

      <Card st={st} title="Hold Period" icon={<Calendar size={15} />} accent={st.violet}>
        <Row label="Target hold" value="3-5 trading days" color={st.text} st={st} />
        <Row label="Contract duration" value="1-2 weeks (high quality) / 2-3 weeks (standard)" color={st.text} st={st} />
        <Row label="High risk / earnings soon" value="6-8 weeks (wider buffer)" color={st.amber} st={st} />
        <Row label="DTE penalty" value=">15 DTE for 5-day hold = too long, score penalized" color={st.amber} st={st} />
      </Card>

      <Card st={st} title="Best Entry Timing" icon={<Clock size={15} />} accent={st.green}>
        <CheckItem text="After a pullback to MA20 (±1% zone) with a green reclaim candle" ok={true} st={st} />
        <CheckItem text="RSI pulled back from 70+ to 55-65 range" ok={true} st={st} />
        <CheckItem text="MACD histogram turning positive after a pullback" ok={true} st={st} />
        <CheckItem text="Volume expanding on the reclaim day (≥1.2× average)" ok={true} st={st} />
        <CheckItem text="SPY/QQQ in an uptrend or at least not down >0.5%" ok={true} st={st} />
      </Card>

      <Card st={st} title="Worst Entry Timing" icon={<XCircle size={15} />} accent={st.red}>
        <CheckItem text="After a 5-day run of >+8% — extended, chase risk" ok={false} st={st} />
        <CheckItem text="RSI > 73 — overbought, mean-reversion probable" ok={false} st={st} />
        <CheckItem text="Price > 8% above MA20 — too far from support" ok={false} st={st} />
        <CheckItem text="Earnings within 2 days — IV crush will destroy premium" ok={false} st={st} />
        <CheckItem text="VIX ≥ 35 — broad market stress, gap risk elevated" ok={false} st={st} />
        <CheckItem text="MA20 crossing below MA50 (death cross forming)" ok={false} st={st} />
      </Card>

      <Card st={st} title="Gap Risk Management" icon={<Flame size={15} />} accent={st.amber}>
        <div style={{ fontSize: 11.5, color: st.muted, marginBottom: 8 }}>
          Swing trades carry overnight gap risk. Manage it:
        </div>
        <CheckItem text="Check macro calendar (CPI, FOMC, Jobs) — exit before high-impact days" ok={true} st={st} />
        <CheckItem text="Check earnings date — exit 1 day before earnings" ok={true} st={st} />
        <CheckItem text="Size position so a 3-5% gap = max 1-2% account loss" ok={true} st={st} />
        <CheckItem text="Set mental stop for gap open — if gaps below stop, exit at open" ok={true} st={st} />
        <CheckItem text="Consider debit spreads (defined risk) over naked calls for gap protection" ok={true} st={st} />
      </Card>
    </div>
  )
}

// ─── Risk Management ───────────────────────────────────────────────────────────

function RiskManagement({ st }: { st: StTokens }) {
  return (
    <div>
      <Card st={st} title="Stop Placement" icon={<Shield size={15} />} accent={st.red}>
        <Row label="Long stop" value="2% below MA20 (structural support + volatility buffer)" color={st.text} st={st} />
        <Row label="Short stop" value="2% above MA20 (structural resistance + buffer)" color={st.text} st={st} />
        <Row label="After T1" value="Move stop to breakeven" color={st.green} st={st} />
        <Row label="Day 2+" value="Trail stop at MA20 (daily close basis)" color={st.amber} st={st} />
        <Row label="Fallback (no MA data)" value="0.5% of price" color={st.muted} st={st} />
      </Card>

      <Card st={st} title="R/R Calculation" icon={<Target size={15} />} accent={st.green}>
        <Row label="Measured move" value="Distance from MA20 to current price" color={st.text} st={st} />
        <Row label="T1" value="50% of measured move" color={st.green} st={st} />
        <Row label="T2" value="100% of measured move" color={st.green} st={st} />
        <Row label="Minimum R/R" value="≥ 1.5:1 preferred" color={st.amber} st={st} />
        <Row label="Floor" value="At least 1% of price (minimum measured move)" color={st.muted} st={st} />
      </Card>

      <Card st={st} title="VIX Gates" icon={<Flame size={15} />} accent={st.amber}>
        <Row label="VIX ≥ 35" value="NO_TRADE — critically elevated, avoid new swings" color={st.red} st={st} />
        <Row label="VIX ≥ 25" value="HIGH risk — size down, wider stops expected" color={st.amber} st={st} />
        <Row label="VIX 20-24" value="MEDIUM risk" color={st.amber} st={st} />
        <Row label="VIX < 18" value="LOW risk — favorable for new swings" color={st.green} st={st} />
      </Card>

      <Card st={st} title="Risk Level Classification" icon={<Gauge size={15} />} accent={st.violet}>
        <Row label="VERY_HIGH" value="VIX ≥ 35 (VIX_NO_GO)" color={st.red} st={st} />
        <Row label="HIGH" value="VIX ≥ 25 or RSI extended or >12% momentum" color={st.amber} st={st} />
        <Row label="MEDIUM" value="VIX ≥ 20 or moderate extension (RSI >68, >5% move)" color={st.amber} st={st} />
        <Row label="LOW" value="VIX < 20, no extension, trend aligned" color={st.green} st={st} />
      </Card>

      <Card st={st} title="Position Sizing Guidelines" icon={<Calendar size={15} />} accent={st.violet}>
        <Row label="Max account risk" value="1-2% per position (including gap risk)" color={st.red} st={st} />
        <Row label="Gap risk sizing" value="Size so 3-5% gap = max 1-2% account loss" color={st.red} st={st} />
        <Row label="High risk trades" value="Reduce size by 50%" color={st.amber} st={st} />
        <Row label="Earnings soon" value="Credit spreads only (defined risk)" color={st.amber} st={st} />
        <Row label="Multiple swings" value="Max 5-7 concurrent swing positions" color={st.amber} st={st} />
      </Card>

      <Card st={st} title="Option Liquidity Check" icon={<BarChart2 size={15} />} accent={st.accent}>
        <div style={{ fontSize: 11.5, color: st.muted, marginBottom: 8 }}>
          The engine rejects trades with poor option liquidity (score {'<'} 4):
        </div>
        <Row label="Bid-ask spread" value="Tighter = better" color={st.text} st={st} />
        <Row label="Open interest" value="Higher = better" color={st.text} st={st} />
        <Row label="Volume" value="Higher = better" color={st.text} st={st} />
        <Row label="Strike density" value="More strikes = more liquid" color={st.text} st={st} />
        <Row label="Score < 4" value="NO_TRADE — cannot trade options" color={st.red} st={st} />
      </Card>
    </div>
  )
}

// ─── Common Mistakes ───────────────────────────────────────────────────────────

function CommonMistakes({ st }: { st: StTokens }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: st.muted, marginBottom: 14, lineHeight: 1.55 }}>
        Understanding these patterns is the single biggest lever for improving your swing win rate.
      </div>

      <Card st={st} title="Extension — Don't Chase" icon={<AlertTriangle size={15} />} accent={st.red}>
        <CheckItem text="Entering after a 5-day run of >+8% — the move is mostly done" ok={false} st={st} />
        <CheckItem text="Buying when RSI > 73 — overbought, mean-reversion probable" ok={false} st={st} />
        <CheckItem text="Entering > 8% above MA20 — too far from support, poor R/R" ok={false} st={st} />
        <CheckItem text="Entering > 12% in 5 days — AVOID_CHASE, statistically losing" ok={false} st={st} />
      </Card>

      <Card st={st} title="Earnings Mistakes" icon={<Calendar size={15} />} accent={st.red}>
        <CheckItem text="Holding naked calls through earnings — IV crush is catastrophic" ok={false} st={st} />
        <CheckItem text="Not checking earnings date before entering a 5-day swing" ok={false} st={st} />
        <CheckItem text="Using long calls when IV ≥ 70 before earnings — use credit spreads" ok={false} st={st} />
      </Card>

      <Card st={st} title="Trend Mistakes" icon={<TrendingUp size={15} />} accent={st.amber}>
        <CheckItem text="Buying when MA20 < MA50 (downtrend) — fighting the trend" ok={false} st={st} />
        <CheckItem text="Ignoring MA convergence (spread narrowing) — momentum fading" ok={false} st={st} />
        <CheckItem text="Not checking daily MACD — crossover is a key confirmation" ok={false} st={st} />
        <CheckItem text="Entering without volume confirmation — low-volume moves fail" ok={false} st={st} />
      </Card>

      <Card st={st} title="Market Context Mistakes" icon={<Eye size={15} />} accent={st.amber}>
        <CheckItem text="Entering longs when SPY is down > 0.5% — broad market against you" ok={false} st={st} />
        <CheckItem text="Ignoring VIX ≥ 30 — gap risk + premium decay elevated" ok={false} st={st} />
        <CheckItem text="Entering new swings when VIX ≥ 35 — NO_TRADE for a reason" ok={false} st={st} />
      </Card>

      <Card st={st} title="Exit Mistakes" icon={<Target size={15} />} accent={st.red}>
        <CheckItem text="Not exiting when price closes below MA20 — thesis is invalidated" ok={false} st={st} />
        <CheckItem text="Holding beyond 5 days — the thesis has a time window" ok={false} st={st} />
        <CheckItem text="Not moving stop to breakeven after T1 — giving profits back" ok={false} st={st} />
        <CheckItem text="Holding through FOMC/CPI — unpredictable gap risk" ok={false} st={st} />
        <CheckItem text="Not exiting before earnings — IV crush destroys premium" ok={false} st={st} />
      </Card>

      <Card st={st} title="Psychology" icon={<Activity size={15} />} accent={st.violet}>
        <div style={{ fontSize: 11.5, color: st.text, lineHeight: 1.6, fontStyle: 'italic' }}>
          <p style={{ margin: '0 0 8px' }}><strong style={{ color: st.amber }}>Extended:</strong> "Even if direction is correct, RR is compressed. Good trades come from good entries — not good directions entered poorly."</p>
          <p style={{ margin: '0 0 8px' }}><strong style={{ color: st.muted }}>NO_TRADE:</strong> "Skipping a bad setup is more profitable than forcing a marginal one."</p>
          <p style={{ margin: '0' }}><strong style={{ color: st.muted }}>No edge:</strong> "The hardest skill in trading is knowing when to do nothing."</p>
        </div>
      </Card>
    </div>
  )
}
