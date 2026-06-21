/**
 * Day Trade Strategies Tab — comprehensive reference for entry/exit strategies,
 * signals to watch, timing, risk management, and multi-day hold guidance (up to 5 days).
 *
 * Covers both intraday (flat by close) and multi-day hold (overnight runners up to 5 sessions)
 * strategies, reflecting volatile environments where holding 1-5 days captures bigger moves.
 */
import { useState } from 'react'
import {
  Activity, AlertTriangle, ArrowDown, ArrowUp, BarChart2, Clock, Flame,
  Gauge, Layers, Target, TrendingUp, Shield, Zap, Calendar, Eye, CheckCircle2, XCircle,
} from 'lucide-react'

type DtTokens = {
  bg: string; bgDeep: string; border: string; text: string; muted: string
  green: string; red: string; amber: string; accent: string; violet: string
}

type SubTab = 'entry' | 'exit' | 'signals' | 'timing' | 'risk' | 'mistakes'

export default function DayTradeStrategiesTab({ dt }: { dt: DtTokens }) {
  const [subTab, setSubTab] = useState<SubTab>('entry')

  const subTabs: { id: SubTab; label: string; icon: React.ReactNode }[] = [
    { id: 'entry',    label: 'Entry Strategies',    icon: <ArrowUp size={13} /> },
    { id: 'exit',     label: 'Exit Rules',          icon: <Target size={13} /> },
    { id: 'signals',  label: 'Signals to Watch',    icon: <Eye size={13} /> },
    { id: 'timing',   label: 'Timing & Phases',     icon: <Clock size={13} /> },
    { id: 'risk',     label: 'Risk Management',     icon: <Shield size={13} /> },
    { id: 'mistakes', label: 'Common Mistakes',     icon: <AlertTriangle size={13} /> },
  ]

  return (
    <div className="day-trade-strategies-tab" style={{ minHeight: 400 }}>
      {/* Sub-tab strip */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderBottom: `1px solid ${dt.border}`, flexWrap: 'wrap' }}>
        {subTabs.map(({ id, label, icon }) => {
          const active = subTab === id
          return (
            <button key={id} onClick={() => setSubTab(id)} style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '8px 14px',
              fontSize: 12, fontWeight: active ? 700 : 500,
              color: active ? dt.accent : dt.muted, background: 'none', border: 'none',
              borderBottom: active ? `2px solid ${dt.accent}` : '2px solid transparent',
              marginBottom: -1, cursor: 'pointer', transition: 'color 0.15s', whiteSpace: 'nowrap',
            }}>{icon} {label}</button>
          )
        })}
      </div>

      {subTab === 'entry'    && <EntryStrategies dt={dt} />}
      {subTab === 'exit'     && <ExitRules dt={dt} />}
      {subTab === 'signals'  && <SignalsToWatch dt={dt} />}
      {subTab === 'timing'   && <TimingPhases dt={dt} />}
      {subTab === 'risk'     && <RiskManagement dt={dt} />}
      {subTab === 'mistakes' && <CommonMistakes dt={dt} />}
    </div>
  )
}

// ─── Card helper ──────────────────────────────────────────────────────────────

function Card({ dt, title, icon, children, accent }: { dt: DtTokens; title: string; icon: React.ReactNode; children: React.ReactNode; accent?: string }) {
  return (
    <div className="dt-card" style={{ background: dt.bg, border: `1px solid ${dt.border}`, borderRadius: 14, padding: '14px 16px', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ color: accent || dt.accent }}>{icon}</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: dt.text }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

function Row({ label, value, color, dt }: { label: string; value: string; color?: string; dt: DtTokens }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '4px 0', borderBottom: `1px solid ${dt.border}40` }}>
      <span style={{ fontSize: 11.5, color: dt.muted, flexShrink: 0, paddingRight: 8 }}>{label}</span>
      <span style={{ fontSize: 11.5, color: color || dt.text, textAlign: 'right', fontWeight: 500, fontFamily: 'monospace' }}>{value}</span>
    </div>
  )
}

function Pill({ text, color, bg }: { text: string; color: string; bg: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 5, color, background: bg, border: `1px solid ${color}40`, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{text}</span>
  )
}

function CheckItem({ text, ok, dt }: { text: string; ok: boolean; dt: DtTokens }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '3px 0' }}>
      {ok ? <CheckCircle2 size={13} style={{ color: dt.green, flexShrink: 0, marginTop: 1 }} /> : <XCircle size={13} style={{ color: dt.red, flexShrink: 0, marginTop: 1 }} />}
      <span style={{ fontSize: 11.5, color: dt.text, lineHeight: 1.45 }}>{text}</span>
    </div>
  )
}

// ─── Entry Strategies ──────────────────────────────────────────────────────────

function EntryStrategies({ dt }: { dt: DtTokens }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: dt.muted, marginBottom: 14, lineHeight: 1.55 }}>
        The engine confirms entries on <strong style={{ color: dt.text }}>5-minute candles</strong> with a 2-candle confirmation
        and wick-rejection guard. Below are the core setups — each requires volume confirmation for a GO verdict.
        In volatile environments, consider holding a <strong style={{ color: dt.amber }}>runner (25-50% position) up to 5 days</strong> for bigger moves.
      </div>

      <Card dt={dt} title="ORH Breakout — Long" icon={<ArrowUp size={15} />} accent={dt.green}>
        <Pill text="Intraday + Multi-day" color={dt.green} bg={`${dt.green}15`} />
        <div style={{ marginTop: 8 }}>
          <CheckItem text="Price breaks above Opening Range High (first 15 min)" ok={true} dt={dt} />
          <CheckItem text="2 consecutive green 5m candles closing above ORH" ok={true} dt={dt} />
          <CheckItem text="Neither candle wicks back below ORH (wick-rejection guard)" ok={true} dt={dt} />
          <CheckItem text="Volume spike on breakout bar (≥1.55× median)" ok={true} dt={dt} />
          <CheckItem text="Stop: OR Low or ORH × 0.9985" ok={true} dt={dt} />
          <CheckItem text="Targets: T1 = ORH + 50% OR range, T2 = ORH + 100% OR range" ok={true} dt={dt} />
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: dt.amber, fontStyle: 'italic' }}>
          Multi-day: If trend day (SPY &gt;0.8%, VIX &lt;18), hold 25-50% as runner with trailing stop at VWAP. Exit by day 5 or if daily trend breaks.
        </div>
      </Card>

      <Card dt={dt} title="ORL Breakdown — Short" icon={<ArrowDown size={15} />} accent={dt.red}>
        <Pill text="Intraday + Multi-day" color={dt.red} bg={`${dt.red}15`} />
        <div style={{ marginTop: 8 }}>
          <CheckItem text="Price breaks below Opening Range Low" ok={true} dt={dt} />
          <CheckItem text="2 consecutive red 5m candles closing below ORL" ok={true} dt={dt} />
          <CheckItem text="Neither candle wicks back above ORL" ok={true} dt={dt} />
          <CheckItem text="Volume spike confirms the breakdown" ok={true} dt={dt} />
          <CheckItem text="Stop: OR High or ORL × 1.0015" ok={true} dt={dt} />
          <CheckItem text="Targets: T1 = ORL − 50% OR range, T2 = ORL − 100% OR range" ok={true} dt={dt} />
        </div>
      </Card>

      <Card dt={dt} title="VWAP Reclaim — Long" icon={<TrendingUp size={15} />} accent={dt.green}>
        <div style={{ marginBottom: 6 }}>
          <Pill text="Best for multi-day holds" color={dt.violet} bg={`${dt.violet}15`} />
        </div>
        <div>
          <CheckItem text="Price was below VWAP, now reclaiming from below" ok={true} dt={dt} />
          <CheckItem text="2 green 5m candles closing above VWAP" ok={true} dt={dt} />
          <CheckItem text="Prior bar touched VWAP (low ≤ VWAP + tolerance)" ok={true} dt={dt} />
          <CheckItem text="Confirmation candle volume ≥ 80% of test candle" ok={true} dt={dt} />
          <CheckItem text="Stop: VWAP × 0.998 or VWAP − 0.3σ" ok={true} dt={dt} />
          <CheckItem text="Targets: T1 = OR High, T2 = ORH + 50% range" ok={true} dt={dt} />
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: dt.amber, fontStyle: 'italic' }}>
          Multi-day: VWAP reclaim with strong volume is the highest-quality multi-day entry. Hold 50% runner with stop at breakeven (day 2) then trail daily VWAP.
        </div>
      </Card>

      <Card dt={dt} title="VWAP Break — Short" icon={<ArrowDown size={15} />} accent={dt.red}>
        <div>
          <CheckItem text="Price was above VWAP, now breaking below" ok={true} dt={dt} />
          <CheckItem text="2 red 5m candles closing below VWAP" ok={true} dt={dt} />
          <CheckItem text="Prior bar's high touched VWAP zone" ok={true} dt={dt} />
          <CheckItem text="Stop: VWAP × 1.002 or VWAP + 0.3σ" ok={true} dt={dt} />
          <CheckItem text="Targets: T1 = OR Low, T2 = ORL − 50% range" ok={true} dt={dt} />
        </div>
      </Card>

      <Card dt={dt} title="Pullback Reset — Long/Short" icon={<Activity size={15} />} accent={dt.violet}>
        <div style={{ fontSize: 11.5, color: dt.muted, marginBottom: 8 }}>
          After price was ≥1.5σ extended from VWAP, it returns and reclaims. Four confidence patterns:
        </div>
        <Row label="Double Green (HIGH)" value="100% size · 0.30σ stop · 1.5× R/R min" color={dt.green} dt={dt} />
        <Row label="Strong Single Green (MED-HIGH)" value="75% size · 0.25σ stop · 1.2× R/R min" color={dt.green} dt={dt} />
        <Row label="Green Hold (MEDIUM)" value="50% size · 0.20σ stop · 1.0× R/R min" color={dt.amber} dt={dt} />
        <Row label="Volume Surge (MEDIUM)" value="50% size · 0.20σ stop · 1.0× R/R min" color={dt.amber} dt={dt} />
        <div style={{ marginTop: 8, fontSize: 11, color: dt.red }}>
          Skip if ≥3 wick failures in prior 10 bars. Skip after 3:00 PM ET.
        </div>
      </Card>

      <Card dt={dt} title="VWAP Zone Rejection — 1-min precision" icon={<Zap size={15} />} accent={dt.accent}>
        <div style={{ fontSize: 11.5, color: dt.muted, marginBottom: 6 }}>
          A 1-minute-bar pattern requiring all 4 conditions + R/R ≥ 1.5:
        </div>
        <div>
          <CheckItem text="Bar enters VWAP ± $0.50 zone" ok={true} dt={dt} />
          <CheckItem text="Rejection candle (red for PUT / green for CALL)" ok={true} dt={dt} />
          <CheckItem text="Wick touches VWAP, body closes back outside zone" ok={true} dt={dt} />
          <CheckItem text="Stop: candle high + $0.10 (PUT) / candle low − $0.10 (CALL)" ok={true} dt={dt} />
        </div>
      </Card>

      <Card dt={dt} title="OR Re-test Hold — Continuation" icon={<Layers size={15} />} accent={dt.green}>
        <div>
          <CheckItem text="Price broke OR, pulled back to OR level, holding with volume" ok={true} dt={dt} />
          <CheckItem text="Highest-quality continuation entry — level acting as support" ok={true} dt={dt} />
          <CheckItem text="Volume spike on re-test bar confirms buyers defending the level" ok={true} dt={dt} />
          <CheckItem text="Stop just below re-test level" ok={true} dt={dt} />
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: dt.amber, fontStyle: 'italic' }}>
          Multi-day: OR re-test holds are excellent multi-day entries — the level flip gives a tight, well-defined stop for overnight risk.
        </div>
      </Card>

      <Card dt={dt} title="Multi-Day Hold Strategy (1-5 Days)" icon={<Calendar size={15} />} accent={dt.violet}>
        <div style={{ fontSize: 12, color: dt.muted, marginBottom: 10, lineHeight: 1.55 }}>
          In volatile environments, holding a portion overnight captures gap moves and multi-day trends.
          The engine's overnight runner logic scores whether to keep 25% of the position.
        </div>
        <Row label="When to hold overnight" value="Trend day + VIX < 18 + strong close" color={dt.green} dt={dt} />
        <Row label="Runner size" value="25-50% of original position" color={dt.amber} dt={dt} />
        <Row label="Max hold" value="5 trading days" color={dt.text} dt={dt} />
        <Row label="Day 1 stop" value="Original stop or VWAP (whichever tighter)" color={dt.text} dt={dt} />
        <Row label="Day 2+ stop" value="Breakeven, then trail daily VWAP" color={dt.text} dt={dt} />
        <Row label="Exit triggers" value="Daily trend break, gap against, day 5" color={dt.red} dt={dt} />
        <Row label="Earnings risk" value="Exit before earnings — never hold through" color={dt.red} dt={dt} />
        <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, background: `${dt.amber}12`, border: `1px solid ${dt.amber}30` }}>
          <div style={{ fontSize: 11, color: dt.amber, fontWeight: 600, marginBottom: 4 }}>Gap Risk Checklist (before holding overnight)</div>
          <CheckItem text="Check if earnings is within the hold period — exit if yes" ok={true} dt={dt} />
          <CheckItem text="Check macro calendar (CPI, FOMC, jobs) next morning — exit if high-impact" ok={true} dt={dt} />
          <CheckItem text="Size the runner so a 3-5% gap against you is tolerable (max 1-2% account risk)" ok={true} dt={dt} />
          <CheckItem text="Set a mental stop for the gap open — if it gaps below stop, exit at open" ok={true} dt={dt} />
        </div>
      </Card>
    </div>
  )
}

// ─── Exit Rules ────────────────────────────────────────────────────────────────

function ExitRules({ dt }: { dt: DtTokens }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: dt.muted, marginBottom: 14, lineHeight: 1.55 }}>
        The exit engine monitors held positions in real-time. <strong style={{ color: dt.red }}>CRITICAL</strong> signals
        require immediate action; <strong style={{ color: dt.amber }}>WARNING</strong> signals mean prepare to exit.
        For multi-day holds, daily trend break is the primary invalidation.
      </div>

      <Card dt={dt} title="Real-Time Exit Signals" icon={<AlertTriangle size={15} />} accent={dt.red}>
        <Row label="STOP_HIT" value="CRITICAL — exit immediately at market" color={dt.red} dt={dt} />
        <Row label="VWAP_BREAK" value="CRITICAL — 2 consecutive 5m closes through VWAP" color={dt.red} dt={dt} />
        <Row label="OR_BREAK" value="CRITICAL — 2 consecutive 5m closes through OR level" color={dt.red} dt={dt} />
        <Row label="TIME_STOP (≤5 min)" value="CRITICAL — close before the bell" color={dt.red} dt={dt} />
        <Row label="TIME_STOP (≤15 min)" value="WARNING — day trade must be flat" color={dt.amber} dt={dt} />
        <Row label="APPROACH_VWAP" value="WARNING — within 0.5% of VWAP, prepare to exit" color={dt.amber} dt={dt} />
        <Row label="TARGET" value="WARNING — take profit, sell ½, trail the rest" color={dt.green} dt={dt} />
        <Row label="TRAILING_STOP" value="WARNING — 1% pullback from peak, tighten stop" color={dt.amber} dt={dt} />
      </Card>

      <Card dt={dt} title="Price-Based Exit Rules — Breakout Trades" icon={<Target size={15} />} accent={dt.green}>
        <Row label="Target 1 (½ off)" value="ORH + 50% OR range (long) / ORL − 50% (short)" color={dt.green} dt={dt} />
        <Row label="Move stop after T1" value="To breakout level (breakeven)" color={dt.amber} dt={dt} />
        <Row label="Target 2 (remaining)" value="ORH + 100% OR range / ORL − 100%" color={dt.green} dt={dt} />
        <Row label="VWAP loss" value="Exit full — breakout failed" color={dt.red} dt={dt} />
        <Row label="OR violation (stop)" value="Exit full — accept the loss" color={dt.red} dt={dt} />
      </Card>

      <Card dt={dt} title="EOD Exit Timeline" icon={<Clock size={15} />} accent={dt.amber}>
        <Row label="Normal session" value="Exit by 3:55 PM ET" color={dt.text} dt={dt} />
        <Row label="Power hour entry" value="Exit by 3:50 PM ET" color={dt.amber} dt={dt} />
        <Row label="EOD closing (last 10 min)" value="EXIT NOW — do not wait" color={dt.red} dt={dt} />
        <div style={{ marginTop: 8, fontSize: 11, color: dt.red, fontStyle: 'italic' }}>
          Never carry an intraday position overnight unless you've consciously decided to hold a runner (see Multi-Day Hold Strategy).
        </div>
      </Card>

      <Card dt={dt} title="Multi-Day Exit Rules (1-5 Day Holds)" icon={<Calendar size={15} />} accent={dt.violet}>
        <Row label="Day 1 exit" value="Same as intraday rules for the non-runner portion" color={dt.text} dt={dt} />
        <Row label="Day 2+ daily trend break" value="Price closes below MA20 (long) / above MA20 (short) → exit" color={dt.red} dt={dt} />
        <Row label="Gap against position" value="If gaps below stop, exit at open — do not hope" color={dt.red} dt={dt} />
        <Row label="Day 5 mandatory" value="Exit by close — do not extend beyond 5 days" color={dt.amber} dt={dt} />
        <Row label="Earnings approaching" value="Exit 1 day before earnings — never hold through" color={dt.red} dt={dt} />
        <Row label="VWAP reclaim against you" value="Exit — thesis invalidated" color={dt.red} dt={dt} />
        <Row label="Trailing stop" value="Trail daily VWAP or prior day low (long) / high (short)" color={dt.amber} dt={dt} />
      </Card>
    </div>
  )
}

// ─── Signals to Watch ──────────────────────────────────────────────────────────

function SignalsToWatch({ dt }: { dt: DtTokens }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: dt.muted, marginBottom: 14, lineHeight: 1.55 }}>
        The engine scores 10 correlation-capped signal groups. Each group caps at 3.0 to prevent
        correlated inflation. Watch these to understand why the engine is signaling GO, WATCH, or AVOID.
      </div>

      <Card dt={dt} title="Scoring Groups (correlation-capped)" icon={<BarChart2 size={15} />} accent={dt.accent}>
        <Row label="VWAP position + slope" value="Above/below/at + 15-bar & 60-bar slope" color={dt.text} dt={dt} />
        <Row label="Breakout quality" value="OR break + volume (3.0) / without (1.0)" color={dt.text} dt={dt} />
        <Row label="Momentum" value="Adaptive 15/30/45 bar + HH_HL / LL_LH structure" color={dt.text} dt={dt} />
        <Row label="Volume" value="Spike ≥1.55× median + RVOL + volume profile delta" color={dt.text} dt={dt} />
        <Row label="Relative strength" value="Session return vs QQQ" color={dt.text} dt={dt} />
        <Row label="Market context" value="SPY/QQQ daily + VIX penalty (≥30 = −0.5)" color={dt.text} dt={dt} />
        <Row label="Gap" value="Pre-market gap ≥1% + gap-fill risk" color={dt.text} dt={dt} />
        <Row label="OR width" value="Narrow <0.40% (coiling) / Wide >1.50% (chaotic)" color={dt.text} dt={dt} />
        <Row label="Time penalty" value="EOD −1.0 / Power hour −0.5 / Midday −0.25" color={dt.text} dt={dt} />
        <Row label="Daily trend context" value="Alignment/conflict with swing bias (±0.5)" color={dt.text} dt={dt} />
      </Card>

      <Card dt={dt} title="Confidence Block Indicators" icon={<Gauge size={15} />} accent={dt.violet}>
        <Row label="Trend strength" value="HIGH (≥0.20%) / MEDIUM (≥0.07%) / LOW" color={dt.text} dt={dt} />
        <Row label="Breakout quality" value="GOOD (OR+vol) / MODERATE (OR only) / WEAK" color={dt.text} dt={dt} />
        <Row label="Volume confirmation" value="STRONG / ELEVATED / NORMAL / WEAK" color={dt.text} dt={dt} />
        <Row label="Market alignment" value="STRONG (SPY+QQQ ≥0.3%) / MEDIUM / WEAK" color={dt.text} dt={dt} />
        <Row label="Risk level" value="HIGH (VIX ≥32) / MEDIUM (≥22) / LOW" color={dt.text} dt={dt} />
      </Card>

      <Card dt={dt} title="Edge Remaining — Am I too late?" icon={<Flame size={15} />} accent={dt.amber}>
        <Row label="EARLY" value="Fresh setup, best R/R — full size" color={dt.green} dt={dt} />
        <Row label="DEVELOPING" value="Momentum building with volume" color={dt.green} dt={dt} />
        <Row label="LATE" value="At ±1σ or 60-79% range used — require tighter confirmation" color={dt.amber} dt={dt} />
        <Row label="EXHAUSTED" value="At ±2σ or ≥80% range used — chasing is statistically losing" color={dt.red} dt={dt} />
      </Card>

      <Card dt={dt} title="Volume Profile" icon={<Activity size={15} />} accent={dt.accent}>
        <Row label="POC (Point of Control)" value="Price level with highest volume" color={dt.text} dt={dt} />
        <Row label="Delta %" value="Buy vs sell pressure — (buy_vol − sell_vol) / total" color={dt.text} dt={dt} />
        <Row label="POC position" value="Above/below/at current price — magnet level" color={dt.text} dt={dt} />
      </Card>
    </div>
  )
}

// ─── Timing & Phases ───────────────────────────────────────────────────────────

function TimingPhases({ dt }: { dt: DtTokens }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: dt.muted, marginBottom: 14, lineHeight: 1.55 }}>
        The session has distinct phases with different scoring penalties. Timing is critical —
        the same setup at 10:00 AM is a GO; at 3:50 PM it's an AVOID.
      </div>

      <Card dt={dt} title="Session Phases (ET)" icon={<Clock size={15} />} accent={dt.accent}>
        <Row label="9:30–10:00 (OPENING)" value="OR forming — no entries until OR set" color={dt.muted} dt={dt} />
        <Row label="10:00–11:30 (MID_MORNING)" value="Primary breakout window — best entries" color={dt.green} dt={dt} />
        <Row label="11:30–15:00 (MIDDAY)" value="Lower liquidity — breakout follow-through weaker (−0.25)" color={dt.amber} dt={dt} />
        <Row label="15:00–15:50 (POWER_HOUR)" value="Size down (−0.5), mandatory EOD exit" color={dt.amber} dt={dt} />
        <Row label="15:50–16:00 (EOD_CLOSING)" value="EXIT ONLY (−1.0) — no new entries" color={dt.red} dt={dt} />
      </Card>

      <Card dt={dt} title="Opening Range" icon={<Layers size={15} />} accent={dt.violet}>
        <Row label="OR window" value="First 15 1-minute bars of RTH (9:30–9:45)" color={dt.text} dt={dt} />
        <Row label="Narrow OR (<0.40%)" value="Coiling setup — breakout likely sharp" color={dt.green} dt={dt} />
        <Row label="Wide OR (>1.50%)" value="Chaotic open — levels loose, risk elevated" color={dt.red} dt={dt} />
        <Row label="Valid breakout" value="Bar CLOSES beyond OR + volume spike on same bar" color={dt.text} dt={dt} />
        <div style={{ marginTop: 8, fontSize: 11, color: dt.red }}>
          Wick pokes or low-volume touches beyond OR do NOT qualify as breakouts.
        </div>
      </Card>

      <Card dt={dt} title="Critical Timing Gates" icon={<AlertTriangle size={15} />} accent={dt.amber}>
        <Row label="< 5 min elapsed" value="No entries — OR not established" color={dt.muted} dt={dt} />
        <Row label="> 45 min after OR break" value="Late to the move — chase risk flagged" color={dt.amber} dt={dt} />
        <Row label="> 210 bars (~12:30+)" value="Exhausted unless trend day detected" color={dt.amber} dt={dt} />
        <Row label="> 330 bars (~3:00 PM)" value="Pullback reset detection disabled" color={dt.red} dt={dt} />
      </Card>

      <Card dt={dt} title="Trend Day Exception" icon={<TrendingUp size={15} />} accent={dt.green}>
        <div style={{ fontSize: 11.5, color: dt.muted, marginBottom: 8 }}>
          When a trend day is detected, extension rules are suspended — the move can run further than normal:
        </div>
        <CheckItem text="SPY move > 0.8% + VIX < 18 (bull) / VIX > 19 (bear)" ok={true} dt={dt} />
        <CheckItem text="3+ tracked tickers confirming the direction" ok={true} dt={dt} />
        <CheckItem text="QQQ aligned with SPY" ok={true} dt={dt} />
        <div style={{ marginTop: 8 }}>
          <Row label="Effect" value="Extension rules suspended, stop widened 50%, target = next σ band" color={dt.green} dt={dt} />
          <Row label="Multi-day implication" value="Best conditions for 5-day runner holds" color={dt.violet} dt={dt} />
        </div>
      </Card>
    </div>
  )
}

// ─── Risk Management ───────────────────────────────────────────────────────────

function RiskManagement({ dt }: { dt: DtTokens }) {
  return (
    <div>
      <Card dt={dt} title="Stop Placement by Setup" icon={<Shield size={15} />} accent={dt.red}>
        <Row label="Fresh OR Breakout" value="ORH × 0.9985 (long) / ORL × 1.0015 (short)" color={dt.text} dt={dt} />
        <Row label="VWAP Defense Continuation" value="VWAP − 0.3σ (long) / VWAP + 0.3σ (short)" color={dt.text} dt={dt} />
        <Row label="VWAP Double Bottom" value="VWAP − 0.5σ / VWAP + 0.5σ" color={dt.text} dt={dt} />
        <Row label="Level Flip" value="flip × 0.997 / flip × 1.003" color={dt.text} dt={dt} />
        <Row label="Extended (fade)" value="+1σ band / −1σ band" color={dt.text} dt={dt} />
        <Row label="VWAP bounce long" value="VWAP × 0.998" color={dt.text} dt={dt} />
        <Row label="VWAP rejection short" value="VWAP × 1.002" color={dt.text} dt={dt} />
        <Row label="Conservative fallback" value="OR Low (long) / OR High (short)" color={dt.muted} dt={dt} />
      </Card>

      <Card dt={dt} title="R/R Requirements" icon={<Target size={15} />} accent={dt.green}>
        <Row label="Minimum R/R" value="1.5:1 — entry window closes below this" color={dt.amber} dt={dt} />
        <Row label="Recommended R/R" value="Adaptive — based on setup-type probabilities" color={dt.green} dt={dt} />
        <Row label="R/R < 1.0" value="Setup does not offer adequate reward — skip" color={dt.red} dt={dt} />
        <Row label="R/R < 1.5" value="Marginal — require high-probability confirmation" color={dt.amber} dt={dt} />
        <Row label="Multi-day runner R/R" value="≥ 2:1 preferred (gap risk requires more cushion)" color={dt.violet} dt={dt} />
      </Card>

      <Card dt={dt} title="VIX Gates" icon={<Flame size={15} />} accent={dt.amber}>
        <Row label="VIX ≥ 40" value="AVOID / NO-GO — hard veto" color={dt.red} dt={dt} />
        <Row label="VIX ≥ 35" value="AVOID — verdict resolver veto" color={dt.red} dt={dt} />
        <Row label="VIX ≥ 30" value="Caution — size down, wider swings" color={dt.amber} dt={dt} />
        <Row label="VIX ≥ 25" value="Volatility risk flagged (HIGH if ≥30)" color={dt.amber} dt={dt} />
        <Row label="VIX ≥ 22" value="Risk = MEDIUM" color={dt.amber} dt={dt} />
        <Row label="VIX < 18" value="Risk = LOW — favorable for multi-day holds" color={dt.green} dt={dt} />
      </Card>

      <Card dt={dt} title="RVOL Thresholds" icon={<BarChart2 size={15} />} accent={dt.accent}>
        <Row label="HIGH (standard tickers)" value="2.5× average" color={dt.green} dt={dt} />
        <Row label="HIGH (large-cap liquid)" value="1.5× — SPY/QQQ/NVDA/AAPL/MSFT/AMZN/META/GOOGL/TSLA" color={dt.green} dt={dt} />
        <Row label="ELEVATED (standard)" value="1.5×" color={dt.green} dt={dt} />
        <Row label="ELEVATED (large-cap)" value="1.3×" color={dt.green} dt={dt} />
        <Row label="LOW (HIGH risk)" value="< 0.6× — false-move probability elevated" color={dt.red} dt={dt} />
        <Row label="LOW (LOW risk)" value="< 0.9× — thin participation" color={dt.amber} dt={dt} />
      </Card>

      <Card dt={dt} title="Daily Range Exhaustion (vs 14-day ATR)" icon={<Gauge size={15} />} accent={dt.violet}>
        <Row label="≥ 100% ATR used" value="EXHAUSTED — rare extended day" color={dt.red} dt={dt} />
        <Row label="≥ 80% ATR used" value="EXHAUSTED — chasing is statistically losing" color={dt.red} dt={dt} />
        <Row label="≥ 60% ATR used" value="LATE — RR compressed, require tighter confirmation" color={dt.amber} dt={dt} />
        <Row label="≥ 35% ATR used" value="MID — move developing, room to run" color={dt.green} dt={dt} />
        <Row label="< 35% ATR used" value="EARLY — range still wide open" color={dt.green} dt={dt} />
      </Card>

      <Card dt={dt} title="Multi-Day Position Sizing" icon={<Calendar size={15} />} accent={dt.violet}>
        <Row label="Intraday portion" value="50-75% of position — exit by EOD or at T1" color={dt.text} dt={dt} />
        <Row label="Runner portion" value="25-50% — held overnight up to 5 days" color={dt.amber} dt={dt} />
        <Row label="Max account risk" value="1-2% per position (including gap risk)" color={dt.red} dt={dt} />
        <Row label="Gap risk sizing" value="Size so a 3-5% gap against you = max 1-2% account loss" color={dt.red} dt={dt} />
        <div style={{ marginTop: 8, fontSize: 11, color: dt.amber, fontStyle: 'italic' }}>
          In volatile environments, the runner portion can be increased to 50% — but gap risk must be calculated and tolerated.
        </div>
      </Card>
    </div>
  )
}

// ─── Common Mistakes ───────────────────────────────────────────────────────────

function CommonMistakes({ dt }: { dt: DtTokens }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: dt.muted, marginBottom: 14, lineHeight: 1.55 }}>
        The engine actively detects chasing and FOMO patterns. When chasing is detected, GO is downgraded to WAIT.
        Understanding these patterns is the single biggest lever for improving your win rate.
      </div>

      <Card dt={dt} title="Chasing Detection — GO → WAIT Triggers" icon={<AlertTriangle size={15} />} accent={dt.red}>
        <CheckItem text="Price at ±2σ — statistical extreme, mean-reversion probable" ok={false} dt={dt} />
        <CheckItem text="OR breakout already at +1σ with >60% range used — late to the move" ok={false} dt={dt} />
        <CheckItem text="OR broke >45 min ago — late to breakout/breakdown" ok={false} dt={dt} />
        <CheckItem text="Momentum spike without volume (|mom| >0.8%, RVOL <1.0) — exhaustion" ok={false} dt={dt} />
        <CheckItem text="Lower highs forming on long bias — momentum rolling over" ok={false} dt={dt} />
        <CheckItem text="Higher lows forming on short bias — momentum recovering" ok={false} dt={dt} />
      </Card>

      <Card dt={dt} title="Risk Classifications" icon={<Shield size={15} />} accent={dt.amber}>
        <Row label="EXTENSION" value="HIGH (±2σ) / MEDIUM (±1σ) — price at band extreme" color={dt.amber} dt={dt} />
        <Row label="LOW_PARTICIPATION" value="HIGH (<0.6× RVOL) / LOW (<0.9×) — false-move risk" color={dt.amber} dt={dt} />
        <Row label="MACRO_CONFLICT" value="MEDIUM — bias conflicts with OR direction" color={dt.amber} dt={dt} />
        <Row label="VOLATILITY" value="HIGH (VIX ≥30) / MEDIUM (≥25) — gap + premium decay" color={dt.amber} dt={dt} />
        <Row label="EXHAUSTION" value="HIGH (≥80% range) / LOW (≥60%) — move near completion" color={dt.amber} dt={dt} />
        <Row label="REVERSAL" value="MEDIUM — OR breakout failed, price back inside OR" color={dt.red} dt={dt} />
      </Card>

      <Card dt={dt} title="Psychology — What the engine tells you" icon={<Eye size={15} />} accent={dt.violet}>
        <div style={{ fontSize: 11.5, color: dt.text, lineHeight: 1.6, fontStyle: 'italic' }}>
          <p style={{ margin: '0 0 8px' }}><strong style={{ color: dt.red }}>Chasing:</strong> "What looks like momentum is mostly complete. The RR that existed earlier is gone. Chasing here is statistically losing. The next setup will be better than this one — protect your capital for it."</p>
          <p style={{ margin: '0 0 8px' }}><strong style={{ color: dt.muted }}>NO-GO:</strong> "Skipping a bad setup is more profitable than forcing a marginal one."</p>
          <p style={{ margin: '0 0 8px' }}><strong style={{ color: dt.green }}>PRIME + EARLY:</strong> "Multiple timeframes align. The difficult part is waiting for these moments — not trading the noise in between."</p>
          <p style={{ margin: '0 0 8px' }}><strong style={{ color: dt.amber }}>LATE:</strong> "Even if direction is correct, RR is compressed. Good trades come from good entries — not good directions entered poorly."</p>
          <p style={{ margin: '0' }}><strong style={{ color: dt.muted }}>No edge:</strong> "The hardest skill in trading is knowing when to do nothing."</p>
        </div>
      </Card>

      <Card dt={dt} title="Explicit Warnings to Heed" icon={<XCircle size={15} />} accent={dt.red}>
        <CheckItem text="Avoid entering while price is below VWAP (long) / above VWAP (short)" ok={false} dt={dt} />
        <CheckItem text="Avoid entering at VWAP — a rejection here turns the setup bearish quickly" ok={false} dt={dt} />
        <CheckItem text="Do not enter while price is inside the opening range" ok={false} dt={dt} />
        <CheckItem text="Low-volume re-tests often fail — patience here saves the trade" ok={false} dt={dt} />
        <CheckItem text="If price closes below ORH, the breakout has failed — exit immediately" ok={false} dt={dt} />
        <CheckItem text="Do not short in the middle — both VWAP and ORL are too far for a clean stop" ok={false} dt={dt} />
        <CheckItem text="Spreads widen at EOD — reversals accelerate, no time to manage a bad fill" ok={false} dt={dt} />
      </Card>

      <Card dt={dt} title="Multi-Day Hold Mistakes" icon={<Calendar size={15} />} accent={dt.red}>
        <CheckItem text="Holding through earnings — IV crush + gap risk is catastrophic" ok={false} dt={dt} />
        <CheckItem text="Holding through FOMC/CPI/Jobs reports — gap risk is unpredictable" ok={false} dt={dt} />
        <CheckItem text="Not setting a gap plan — if it gaps below stop, exit at open, do not hope" ok={false} dt={dt} />
        <CheckItem text="Extending beyond 5 days — the thesis has a time window, respect it" ok={false} dt={dt} />
        <CheckItem text="Not trailing the stop — give profits back waiting for T2" ok={false} dt={dt} />
        <CheckItem text="Holding a full position overnight — always split into intraday + runner" ok={false} dt={dt} />
      </Card>

      <Card dt={dt} title="Pullback Probability Factors" icon={<Activity size={15} />} accent={dt.amber}>
        <div style={{ fontSize: 11.5, color: dt.muted, marginBottom: 8 }}>
          The engine calculates pullback probability from these factors — high pullback probability means wait, don't chase:
        </div>
        <Row label="Distance from VWAP > 0.3%" value="+6 points" color={dt.amber} dt={dt} />
        <Row label="Strong momentum" value="+7 points" color={dt.amber} dt={dt} />
        <Row label="No volume spike" value="+3 points" color={dt.amber} dt={dt} />
        <Row label="VWAP hold failed" value="+10 points" color={dt.red} dt={dt} />
        <Row label="Waiting for VWAP hold/break" value="+5 points" color={dt.amber} dt={dt} />
        <Row label="VWAP test" value="+2 points" color={dt.amber} dt={dt} />
        <div style={{ marginTop: 8 }}>
          <Row label="HIGH pullback" value="≥ 8 points — wait for it to come back" color={dt.red} dt={dt} />
          <Row label="MODERATE pullback" value="≥ 5 points — be cautious" color={dt.amber} dt={dt} />
          <Row label="LOW pullback" value="< 5 points — momentum is real" color={dt.green} dt={dt} />
        </div>
      </Card>
    </div>
  )
}
