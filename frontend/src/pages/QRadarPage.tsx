import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Star, Check, TrendingUp, Atom, Shield, Cpu, Building2, Search, Zap, FlaskConical, ScanLine, X, Clock, TrendingDown, AlertTriangle, Minus } from 'lucide-react'
import { useApp } from '../contexts/AppContext'
import { addMyTicker, removeMyTicker, fetchMyTickers } from '../api/commandCenter'
import type { MyTickerEntry } from '../api/commandCenter'
import { analyzeSwingTrade } from '../api/client'
import type { SwingTradeScanResult } from '../api/client'
import { computeExecLevels } from '../components/SwingTradeEnginePanel'

// ─────────────────────────────────────────────────────────────
// STOCK UNIVERSE — curated Quantum Computing names
// ─────────────────────────────────────────────────────────────

type QCategory =
  | 'All'
  | 'Pure-Play Quantum'
  | 'Big Tech Quantum'
  | 'Quantum Enabling'
  | 'Defense & Gov'
  | 'Quantum Security'
  | 'Quantum Materials'

type SignalFilter = 'all' | 'buy' | 'bearish' | 'skip'
type TradeStyle  = 'swing' | 'position'

interface QStockEntry {
  ticker: string
  name: string
  category: Exclude<QCategory, 'All'>
  note: string
  marketCap?: string
  tech?: string
  highlight?: boolean
}

const STOCKS: QStockEntry[] = [
  // ── Pure-Play Quantum ────────────────────────────────────
  {
    ticker: 'IONQ', name: 'IonQ Inc.',
    category: 'Pure-Play Quantum', marketCap: '$8B', tech: 'Trapped-Ion',
    highlight: true,
    note: 'Industry leader in trapped-ion quantum computing. Aria (25 AQ) and Forte (35 AQ) systems live on AWS, Azure & Google Cloud. Aerospace, pharma and finance customers ramping.',
  },
  {
    ticker: 'RGTI', name: 'Rigetti Computing',
    category: 'Pure-Play Quantum', marketCap: '$2B', tech: 'Superconducting',
    highlight: true,
    note: 'Full-stack superconducting quantum processor company. Novera QPU commercially available. Cloud access via QCS and AWS Braket. Focused on hybrid quantum-classical algorithms.',
  },
  {
    ticker: 'QUBT', name: 'Quantum Computing Inc.',
    category: 'Pure-Play Quantum', marketCap: '$1.5B', tech: 'Photonic / Reservoir',
    note: 'Developing photonic quantum processors and reservoir computing chips (Dirac series). Targeting optimization and sampling problems for finance and logistics.',
  },
  {
    ticker: 'QBTS', name: 'D-Wave Quantum',
    category: 'Pure-Play Quantum', marketCap: '$1.2B', tech: 'Quantum Annealing',
    highlight: true,
    note: 'Pioneer of quantum annealing — optimizes discrete combinatorial problems. Advantage2 system ships 7,000+ qubit annealer. Serving Volkswagen, Mastercard, USPS for logistics optimization.',
  },
  {
    ticker: 'ARQQ', name: 'Arqit Quantum',
    category: 'Pure-Play Quantum', marketCap: '$0.5B', tech: 'Quantum Encryption',
    note: 'Satellite-based quantum key distribution (QKD) and QuantumCloud encryption-as-a-service. Defense and government contracts for post-quantum secure communications.',
  },

  // ── Big Tech Quantum ─────────────────────────────────────
  {
    ticker: 'GOOGL', name: 'Alphabet / Google',
    category: 'Big Tech Quantum', marketCap: '$2.0T', tech: 'Superconducting',
    highlight: true,
    note: 'Willow chip (105 qubits) achieves below-threshold quantum error correction — landmark milestone. Google Quantum AI lab claims error rates decrease exponentially with scale.',
  },
  {
    ticker: 'MSFT', name: 'Microsoft Corporation',
    category: 'Big Tech Quantum', marketCap: '$3.1T', tech: 'Topological',
    highlight: true,
    note: 'Topological qubits using Majorana fermions (Majorana 1 chip). Azure Quantum platform integrates IonQ, Quantinuum, Rigetti hardware. Betting on inherently error-resistant architecture.',
  },
  {
    ticker: 'IBM', name: 'IBM Corporation',
    category: 'Big Tech Quantum', marketCap: '$220B', tech: 'Superconducting',
    highlight: true,
    note: 'Largest fleet of gate-based quantum computers. IBM Condor (1,121 qubits), Heron (133 qubits, improved error rates). IBM Quantum Network has 400+ members. Roadmap targets 100,000+ qubit system.',
  },
  {
    ticker: 'AMZN', name: 'Amazon Web Services',
    category: 'Big Tech Quantum', marketCap: '$2.2T', tech: 'Cloud Access',
    note: 'AWS Braket provides cloud access to IonQ, Rigetti, D-Wave, and QuEra quantum hardware. Amazon developing its own Cat-qubit processor via AWS Center for Quantum Computing.',
  },
  {
    ticker: 'HON', name: 'Honeywell International',
    category: 'Big Tech Quantum', marketCap: '$150B', tech: 'Trapped-Ion',
    highlight: true,
    note: 'Majority owner of Quantinuum (world\'s leading commercial quantum company). H2 processor holds world record 56 logical qubits with error correction.',
  },
  {
    ticker: 'INTC', name: 'Intel Corporation',
    category: 'Big Tech Quantum', marketCap: '$85B', tech: 'Spin Qubit',
    note: 'Silicon spin qubit research via Tunnel Falls chip. Horse Ridge II cryogenic control chip reduces wiring complexity. Leverages existing semiconductor manufacturing expertise.',
  },

  // ── Quantum Enabling Technology ──────────────────────────
  {
    ticker: 'NVDA', name: 'NVIDIA Corporation',
    category: 'Quantum Enabling', marketCap: '$2.9T', tech: 'Simulation',
    highlight: true,
    note: 'cuQuantum SDK accelerates quantum circuit simulation on GPUs. CUDA-Q platform integrates quantum and classical computing. NVIDIA is the "picks and shovels" for quantum simulation.',
  },
  {
    ticker: 'FORM', name: 'FormFactor Inc.',
    category: 'Quantum Enabling', marketCap: '$2B', tech: 'Cryogenic Test',
    note: 'Designs cryogenic probing and test equipment for quantum processor characterization at millikelvin temperatures. Critical infrastructure for every superconducting qubit lab.',
  },
  {
    ticker: 'MKSI', name: 'MKS Instruments',
    category: 'Quantum Enabling', marketCap: '$6B', tech: 'Vacuum & RF',
    note: 'Supplies vacuum systems, RF power sources, and gas control equipment used in quantum chip fabrication. Same equipment needed for trapped-ion vacuum chambers.',
  },
  {
    ticker: 'AMAT', name: 'Applied Materials',
    category: 'Quantum Enabling', marketCap: '$150B', tech: 'Fab Equipment',
    note: 'Materials engineering systems for depositing superconducting films (Josephson junctions) and silicon spin qubit fabrication.',
  },
  {
    ticker: 'TSM', name: 'Taiwan Semiconductor (TSMC)',
    category: 'Quantum Enabling', marketCap: '$900B', tech: 'Foundry',
    note: 'Manufactures Intel\'s Tunnel Falls spin qubit chips. Expected to be the foundry of choice as silicon-based quantum processors scale.',
  },
  {
    ticker: 'KEYSIGHT', name: 'Keysight Technologies',
    category: 'Quantum Enabling', marketCap: '$20B', tech: 'Test & Measure',
    note: 'Microwave signal generators, arbitrary waveform generators, and quantum computing control systems. Essential hardware for qubit readout and control at every quantum lab globally.',
  },

  // ── Defense & Government Quantum ─────────────────────────
  {
    ticker: 'LMT', name: 'Lockheed Martin',
    category: 'Defense & Gov', marketCap: '$130B', tech: 'Sensing & Navigation',
    highlight: true,
    note: 'Pioneering quantum sensing for GPS-denied navigation, quantum radar, and secure quantum communications. Early D-Wave adopter. Significant DARPA and DOD quantum contracts.',
  },
  {
    ticker: 'RTX', name: 'RTX Corporation (Raytheon)',
    category: 'Defense & Gov', marketCap: '$165B', tech: 'Quantum Radar',
    note: 'Quantum radar research using entangled photons for detection of stealth aircraft. Quantum communications for secure military networks. DOD-funded quantum sensing programs.',
  },
  {
    ticker: 'LDOS', name: 'Leidos Holdings',
    category: 'Defense & Gov', marketCap: '$22B', tech: 'Cyber & Sensing',
    note: 'Post-quantum cryptography migration for US defense and intelligence agencies. Quantum sensing programs for submarine detection and underground facility mapping.',
  },
  {
    ticker: 'PLTR', name: 'Palantir Technologies',
    category: 'Defense & Gov', marketCap: '$220B', tech: 'AI+Quantum',
    note: 'Integrating quantum optimization algorithms into AIP and Gotham platforms. US government AI and data infrastructure positioned to layer in quantum speedups.',
  },
  {
    ticker: 'SAIC', name: 'Science Applications International',
    category: 'Defense & Gov', marketCap: '$6B', tech: 'Gov IT & Quantum',
    note: 'IT contractor implementing post-quantum cryptography upgrades across US federal agencies under NSA/CISA quantum-safe transition mandates.',
  },

  // ── Quantum Security / Post-Quantum Crypto ───────────────
  {
    ticker: 'CRWD', name: 'CrowdStrike Holdings',
    category: 'Quantum Security', marketCap: '$88B', tech: 'Post-Quantum Crypto',
    highlight: true,
    note: 'Integrating NIST post-quantum cryptographic standards into Falcon platform. Quantum-safe security essential as "harvest now, decrypt later" attacks grow.',
  },
  {
    ticker: 'PANW', name: 'Palo Alto Networks',
    category: 'Quantum Security', marketCap: '$115B', tech: 'Post-Quantum Crypto',
    note: 'Rolling out quantum-safe encryption across Prisma Cloud and SASE platforms. NIST PQC standard implementation roadmap.',
  },
  {
    ticker: 'CSCO', name: 'Cisco Systems',
    category: 'Quantum Security', marketCap: '$220B', tech: 'QKD Networking',
    note: 'Building quantum key distribution (QKD) into enterprise networking hardware. Partnered with Toshiba for metro QKD deployments. Post-quantum TLS implementation across IOS-XE.',
  },
  {
    ticker: 'NTAP', name: 'NetApp',
    category: 'Quantum Security', marketCap: '$20B', tech: 'Data Encryption',
    note: 'Post-quantum encryption for enterprise data at rest and in motion. Storage platforms being upgraded to PQC standards ahead of NIST 2024 deadlines.',
  },

  // ── Quantum Materials ────────────────────────────────────
  {
    ticker: 'ENTG', name: 'Entegris Inc.',
    category: 'Quantum Materials', marketCap: '$14B', tech: 'Ultra-Pure Materials',
    note: 'Supplies ultra-pure chemicals and materials used in superconducting qubit fabrication. Niobium thin film deposition and contamination-free wafer handling for quantum chip fabs.',
  },
  {
    ticker: 'EMR', name: 'Emerson Electric',
    category: 'Quantum Materials', marketCap: '$65B', tech: 'Cryogenics',
    note: 'Manufactures dilution refrigerators and precision valves for cryogenic quantum systems. Every superconducting quantum computer runs at ~15 millikelvin.',
  },
  {
    ticker: 'AIR', name: 'AAR Corp.',
    category: 'Quantum Materials', marketCap: '$2B', tech: 'Rare Materials',
    note: 'Exposure to rare earth and specialty material supply chains critical for quantum sensor manufacturing, particularly for quantum magnetometers and atomic clocks.',
  },
  {
    ticker: 'MP', name: 'MP Materials',
    category: 'Quantum Materials', marketCap: '$2B', tech: 'Rare Earth',
    note: 'Largest US rare earth producer. Neodymium and other rare earth elements essential for permanent magnets in quantum sensing and ion-trap quantum computers.',
  },
]

// ─────────────────────────────────────────────────────────────
// CATEGORY METADATA
// ─────────────────────────────────────────────────────────────

const CATEGORIES: { id: QCategory; label: string; icon: React.ReactNode; color: string; desc: string }[] = [
  { id: 'All',               label: 'All',           icon: <Atom size={14} />,        color: 'violet', desc: 'Complete quantum computing universe' },
  { id: 'Pure-Play Quantum', label: 'Pure-Play',     icon: <FlaskConical size={14} />, color: 'cyan',   desc: 'Companies solely focused on quantum hardware or software' },
  { id: 'Big Tech Quantum',  label: 'Big Tech',      icon: <Building2 size={14} />,   color: 'blue',   desc: 'Hyperscalers and large enterprises with major quantum divisions' },
  { id: 'Quantum Enabling',  label: 'Enabling Tech', icon: <Cpu size={14} />,         color: 'indigo', desc: 'Tools, equipment, simulation and foundry for quantum systems' },
  { id: 'Defense & Gov',     label: 'Defense & Gov', icon: <Shield size={14} />,      color: 'rose',   desc: 'Defense contractors and government IT with quantum sensing/comms programs' },
  { id: 'Quantum Security',  label: 'Q Security',    icon: <Zap size={14} />,         color: 'amber',  desc: 'Post-quantum cryptography and quantum-safe networking' },
  { id: 'Quantum Materials', label: 'Q Materials',   icon: <TrendingUp size={14} />,  color: 'teal',   desc: 'Cryogenics, ultra-pure materials and rare earths enabling quantum hardware' },
]

const CAT_BADGE: Record<Exclude<QCategory, 'All'>, string> = {
  'Pure-Play Quantum': 'bg-cyan-900/40 text-cyan-300 border-cyan-800',
  'Big Tech Quantum':  'bg-blue-900/40 text-blue-300 border-blue-800',
  'Quantum Enabling':  'bg-indigo-900/40 text-indigo-300 border-indigo-800',
  'Defense & Gov':     'bg-rose-900/40 text-rose-300 border-rose-800',
  'Quantum Security':  'bg-amber-900/40 text-amber-300 border-amber-800',
  'Quantum Materials': 'bg-teal-900/40 text-teal-300 border-teal-800',
}

const CAT_ACTIVE: Record<string, string> = {
  violet: 'bg-violet-600  border-violet-500  text-white',
  cyan:   'bg-cyan-700    border-cyan-600    text-white',
  blue:   'bg-blue-700    border-blue-600    text-white',
  indigo: 'bg-indigo-700  border-indigo-600  text-white',
  rose:   'bg-rose-700    border-rose-600    text-white',
  amber:  'bg-amber-600   border-amber-500   text-white',
  teal:   'bg-teal-700    border-teal-600    text-white',
}

// ─────────────────────────────────────────────────────────────
// SIGNAL LOGIC
// ─────────────────────────────────────────────────────────────

interface SignalInfo {
  label: string; sublabel: string; icon: React.ReactNode
  badgeCls: string; borderCls: string; group: SignalFilter
}

function getSignalInfo(r: SwingTradeScanResult, style: TradeStyle): SignalInfo {
  const dl = r.decision_label; const fa = r.final_action; const bias = r.bias
  const isPosition = style === 'position'

  if (dl === 'QUALITY_LONG' || (bias === 'long' && fa === 'QUALITY_LONG'))
    return { label: 'BUY', sublabel: isPosition ? 'Strong setup — hold 2-4 weeks' : 'Strong long setup', icon: <TrendingUp size={12} />, badgeCls: 'bg-emerald-900/60 text-emerald-300 border-emerald-700', borderCls: 'border-emerald-800', group: 'buy' }
  if (dl === 'BULLISH_WAIT_CONFIRMATION')
    return { label: isPosition ? 'BUY' : 'BUY — Wait', sublabel: isPosition ? 'Bullish — time to confirm over weeks' : 'Bullish, needs confirmation', icon: <TrendingUp size={12} />, badgeCls: 'bg-green-900/50 text-green-300 border-green-700', borderCls: 'border-green-800', group: 'buy' }
  if (dl === 'BULLISH_BUT_EXTENDED' || fa === 'AVOID_CHASE')
    return { label: isPosition ? 'WAIT PULLBACK' : 'EXTENDED', sublabel: isPosition ? 'Bullish trend — wait for a pullback entry' : "Already ran — don't chase", icon: <AlertTriangle size={12} />, badgeCls: 'bg-orange-900/50 text-orange-300 border-orange-700', borderCls: 'border-orange-800', group: isPosition ? 'buy' : 'skip' }
  if (dl === 'BULLISH_BUT_EARNINGS_RISK')
    return { label: 'EARNINGS RISK', sublabel: isPosition ? 'Bullish long-term, but earnings in the way' : 'Bullish but earnings near', icon: <AlertTriangle size={12} />, badgeCls: 'bg-purple-900/50 text-purple-300 border-purple-700', borderCls: 'border-purple-800', group: 'skip' }
  if (bias === 'short' || dl.includes('BEARISH') || (r.bear_score > r.bull_score + 2))
    return { label: 'BEARISH', sublabel: 'Short bias — avoid longs', icon: <TrendingDown size={12} />, badgeCls: 'bg-red-900/50 text-red-300 border-red-700', borderCls: 'border-red-800', group: 'bearish' }
  if (dl === 'WEAK_SETUP')
    return { label: 'WEAK', sublabel: 'Low-quality setup', icon: <Minus size={12} />, badgeCls: 'bg-gray-800 text-gray-400 border-gray-700', borderCls: 'border-gray-700', group: 'skip' }
  if (dl === 'MARKET_CONFIRMATION_ONLY')
    return { label: 'MKT RISK', sublabel: 'Market context unfavorable', icon: <AlertTriangle size={12} />, badgeCls: 'bg-slate-800 text-slate-300 border-slate-700', borderCls: 'border-slate-700', group: 'skip' }
  return { label: 'NO SETUP', sublabel: 'No actionable trade now', icon: <Minus size={12} />, badgeCls: 'bg-gray-800 text-gray-500 border-gray-700', borderCls: 'border-gray-700', group: 'skip' }
}

interface PositionLevels { stop: string | null; entry: string | null; target1: string | null; target2: string | null }

function computePositionLevels(r: SwingTradeScanResult): PositionLevels {
  const m = r.metrics as Record<string, unknown>
  const lastPrice = typeof m.last_price === 'number' ? m.last_price : null
  const ma20      = typeof m.ma20 === 'number' ? m.ma20 : null
  const mom5d     = typeof m.momentum_5d_pct === 'number' ? m.momentum_5d_pct : null
  const isBull    = r.bias === 'long'
  if (lastPrice == null) return { stop: null, entry: null, target1: null, target2: null }
  const mom = mom5d != null ? Math.max(Math.abs(mom5d) / 100, 0.025) : 0.05
  if (isBull) {
    const entry = lastPrice * 1.015; const stop = ma20 != null ? ma20 * 0.96 : lastPrice * 0.94
    return { stop: `$${stop.toFixed(2)}`, entry: `$${entry.toFixed(2)}`, target1: `$${(entry * (1 + mom * 2.0)).toFixed(2)}`, target2: `$${(entry * (1 + mom * 3.5)).toFixed(2)}` }
  }
  const entry = lastPrice * 0.985; const stop = ma20 != null ? ma20 * 1.04 : lastPrice * 1.06
  return { stop: `$${stop.toFixed(2)}`, entry: `$${entry.toFixed(2)}`, target1: `$${(entry * (1 - mom * 2.0)).toFixed(2)}`, target2: `$${(entry * (1 - mom * 3.5)).toFixed(2)}` }
}

// ─────────────────────────────────────────────────────────────
// STOCK CARD
// ─────────────────────────────────────────────────────────────

interface QStockCardProps {
  stock: QStockEntry; myTickerSet: Set<string>
  onToggleWatch: (ticker: string, name: string, currentlyWatched: boolean) => void
  signal: SwingTradeScanResult | 'loading' | 'error' | null
  tradeStyle: TradeStyle
}

function QStockCard({ stock, myTickerSet, onToggleWatch, signal, tradeStyle }: QStockCardProps) {
  const { requestAnalysis } = useApp()
  const watched = myTickerSet.has(stock.ticker)

  const signalInfo     = signal && signal !== 'loading' && signal !== 'error' ? getSignalInfo(signal, tradeStyle) : null
  const swingLevels    = signal && signal !== 'loading' && signal !== 'error' && tradeStyle === 'swing'    ? computeExecLevels(signal, signal.metrics as Record<string, unknown>) : null
  const positionLevels = signal && signal !== 'loading' && signal !== 'error' && tradeStyle === 'position' ? computePositionLevels(signal) : null
  const lastPrice      = signal && signal !== 'loading' && signal !== 'error' ? (signal.metrics as Record<string, unknown>).last_price : null

  const borderCls = signalInfo
    ? `border ${signalInfo.borderCls}`
    : stock.highlight ? 'border border-cyan-900/60 hover:border-cyan-700/60' : 'border border-gray-800 hover:border-gray-700'

  return (
    <div className={`bg-gray-900 rounded-2xl p-4 flex flex-col gap-3 hover:brightness-110 transition-all group ${borderCls}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-lg font-bold text-white font-mono tracking-tight">{stock.ticker}</span>
            {stock.marketCap && <span className="text-xs text-gray-600 font-mono">{stock.marketCap}</span>}
            {typeof lastPrice === 'number' && <span className="text-xs text-gray-400 font-mono">${(lastPrice as number).toFixed(2)}</span>}
            {stock.highlight && (
              <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-cyan-900/50 text-cyan-400 border border-cyan-800">★ Key Play</span>
            )}
          </div>
          <div className="text-xs text-gray-400 mt-0.5 leading-snug">{stock.name}</div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${CAT_BADGE[stock.category]}`}>{stock.category}</span>
          {stock.tech && <span className="text-[10px] text-gray-600 font-mono text-right">{stock.tech}</span>}
        </div>
      </div>

      <p className="text-xs text-gray-500 leading-relaxed flex-1">{stock.note}</p>

      {signal === 'loading' && (
        <div className="rounded-xl bg-gray-800/60 border border-gray-700 px-3 py-2 flex items-center gap-2">
          <div className="w-3 h-3 rounded-full border-2 border-cyan-500 border-t-transparent animate-spin shrink-0" />
          <span className="text-xs text-gray-500">Scanning…</span>
        </div>
      )}
      {signal === 'error' && (
        <div className="rounded-xl bg-gray-800/40 border border-gray-700 px-3 py-2">
          <span className="text-xs text-gray-600">Scan failed</span>
        </div>
      )}
      {signalInfo && (swingLevels || positionLevels) && (
        <div className="rounded-xl bg-gray-800/40 border border-gray-700/60 px-3 py-2.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-lg border ${signalInfo.badgeCls}`}>
              {signalInfo.icon}{signalInfo.label}
            </span>
            <span className="flex items-center gap-1 text-[10px] text-gray-500">
              <Clock size={10} />
              {tradeStyle === 'position' ? '2–4 weeks' : (signal && signal !== 'loading' && signal !== 'error' && signal.expected_holding_period ? signal.expected_holding_period : '3–5 days')}
            </span>
          </div>
          <p className="text-[10px] text-gray-500 leading-tight">{signalInfo.sublabel}</p>
          {swingLevels && (swingLevels.riskBelow || swingLevels.firstTarget) && (
            <div className="flex gap-3 pt-0.5">
              {swingLevels.riskBelow    && <div className="flex flex-col"><span className="text-[9px] text-gray-600 uppercase tracking-wide">Stop</span><span className="text-[11px] font-mono text-red-400">{swingLevels.riskBelow}</span></div>}
              {swingLevels.breakoutTrigger && <div className="flex flex-col"><span className="text-[9px] text-gray-600 uppercase tracking-wide">Entry</span><span className="text-[11px] font-mono text-gray-300">{swingLevels.breakoutTrigger}</span></div>}
              {swingLevels.firstTarget  && <div className="flex flex-col"><span className="text-[9px] text-gray-600 uppercase tracking-wide">Target 1</span><span className="text-[11px] font-mono text-emerald-400">{swingLevels.firstTarget}</span></div>}
              {swingLevels.stretchTarget && <div className="flex flex-col"><span className="text-[9px] text-gray-600 uppercase tracking-wide">Target 2</span><span className="text-[11px] font-mono text-emerald-300">{swingLevels.stretchTarget}</span></div>}
            </div>
          )}
          {positionLevels && (positionLevels.stop || positionLevels.target1) && (
            <div className="flex gap-3 pt-0.5">
              {positionLevels.stop    && <div className="flex flex-col"><span className="text-[9px] text-gray-600 uppercase tracking-wide">Stop</span><span className="text-[11px] font-mono text-red-400">{positionLevels.stop}</span></div>}
              {positionLevels.entry   && <div className="flex flex-col"><span className="text-[9px] text-gray-600 uppercase tracking-wide">Entry</span><span className="text-[11px] font-mono text-gray-300">{positionLevels.entry}</span></div>}
              {positionLevels.target1 && <div className="flex flex-col"><span className="text-[9px] text-gray-600 uppercase tracking-wide">Target 1</span><span className="text-[11px] font-mono text-emerald-400">{positionLevels.target1}</span></div>}
              {positionLevels.target2 && <div className="flex flex-col"><span className="text-[9px] text-gray-600 uppercase tracking-wide">Target 2</span><span className="text-[11px] font-mono text-emerald-300">{positionLevels.target2}</span></div>}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button type="button" onClick={() => requestAnalysis(stock.ticker)} aria-label={`Analyze ${stock.ticker}`} title="Analyze options"
          className="flex-1 inline-flex h-10 items-center justify-center bg-cyan-900/20 hover:bg-cyan-900/30 text-cyan-300 rounded-xl border border-cyan-800 hover:border-cyan-600 transition-colors">
          <TrendingUp size={18} />
        </button>
        <button type="button" onClick={() => onToggleWatch(stock.ticker, stock.name, watched)}
          aria-label={watched ? `Remove ${stock.ticker} from watchlist` : `Add ${stock.ticker} to watchlist`}
          className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-all ${
            watched ? 'bg-amber-900/30 border-amber-700 text-amber-400 hover:bg-red-900/20 hover:border-red-700 hover:text-red-400'
                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-amber-600 hover:text-amber-400'}`}>
          {watched ? <Check size={18} /> : <Star size={18} />}
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────

const BATCH_SIZE = 5

export default function QRadarPage() {
  const [activeCategory, setActiveCategory] = useState<QCategory>('All')
  const [search, setSearch]                 = useState('')
  const [myTickers, setMyTickers]           = useState<MyTickerEntry[]>([])
  const [signalFilter, setSignalFilter]     = useState<SignalFilter>('all')
  const [tradeStyle, setTradeStyle]         = useState<TradeStyle>('swing')

  const [scanResults, setScanResults]     = useState<Map<string, SwingTradeScanResult | 'loading' | 'error'>>(new Map())
  const [scanning, setScanning]           = useState(false)
  const [scanProgress, setScanProgress]   = useState<{ done: number; total: number } | null>(null)
  const scanAbortRef = useRef(false)

  useEffect(() => {
    fetchMyTickers().then(res => setMyTickers(res.data?.tickers || [])).catch(() => {})
  }, [])

  const myTickerSet = useMemo(() => new Set(myTickers.map(t => t.symbol.toUpperCase())), [myTickers])

  const handleToggleWatch = useCallback(async (ticker: string, name: string, currentlyWatched: boolean) => {
    const sym = ticker.toUpperCase()
    if (currentlyWatched) {
      try { await removeMyTicker(sym); setMyTickers(prev => prev.filter(t => t.symbol.toUpperCase() !== sym)) } catch {}
    } else {
      try { const res = await addMyTicker({ symbol: sym, company_name: name, trade_types: ['regular'] }); if (res.data?.tickers) setMyTickers(res.data.tickers) } catch {}
    }
  }, [])

  const handleScan = useCallback(async () => {
    if (scanning) return
    scanAbortRef.current = false
    const tickers = STOCKS.map(s => s.ticker)
    const total   = tickers.length
    setScanResults(prev => { const next = new Map(prev); tickers.forEach(t => next.set(t, 'loading')); return next })
    setScanning(true); setScanProgress({ done: 0, total })
    let done = 0
    for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
      if (scanAbortRef.current) break
      await Promise.allSettled(tickers.slice(i, i + BATCH_SIZE).map(async ticker => {
        try { const result = await analyzeSwingTrade(ticker); setScanResults(prev => new Map(prev).set(ticker, result)) }
        catch { setScanResults(prev => new Map(prev).set(ticker, 'error')) }
        done++; setScanProgress({ done, total })
      }))
    }
    setScanning(false)
  }, [scanning])

  const handleClearScan = useCallback(() => {
    scanAbortRef.current = true
    setScanResults(new Map()); setScanning(false); setScanProgress(null); setSignalFilter('all')
  }, [])

  const hasScanResults = scanResults.size > 0
  const scanDone       = hasScanResults && !scanning

  const filtered = useMemo(() => STOCKS.filter(s => {
    const matchCat    = activeCategory === 'All' || s.category === activeCategory
    const q           = search.trim().toLowerCase()
    const matchSearch = !q || s.ticker.toLowerCase().includes(q) || s.name.toLowerCase().includes(q) ||
      s.note.toLowerCase().includes(q) || (s.tech ?? '').toLowerCase().includes(q)
    if (!matchCat || !matchSearch) return false
    if (signalFilter === 'all' || !scanDone) return true
    const res = scanResults.get(s.ticker)
    if (!res || res === 'loading' || res === 'error') return false
    return getSignalInfo(res, tradeStyle).group === signalFilter
  }), [activeCategory, search, signalFilter, scanResults, scanDone, tradeStyle])

  const watchedCount   = STOCKS.filter(s => myTickerSet.has(s.ticker)).length
  const highlightCount = STOCKS.filter(s => s.highlight).length

  const signalCounts = useMemo(() => {
    if (!scanDone) return { buy: 0, bearish: 0, skip: 0 }
    let buy = 0, bearish = 0, skip = 0
    for (const [, res] of scanResults) {
      if (!res || res === 'loading' || res === 'error') continue
      const g = getSignalInfo(res, tradeStyle).group
      if (g === 'buy') buy++; else if (g === 'bearish') bearish++; else skip++
    }
    return { buy, bearish, skip }
  }, [scanResults, scanDone, tradeStyle])

  return (
    <div className="q-radar-page ai-radar-page min-h-screen p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-5">

        {/* Header */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2.5 mb-1">
                <div className="w-9 h-9 rounded-xl bg-cyan-600/20 border border-cyan-700 flex items-center justify-center">
                  <Atom size={18} className="text-cyan-400" />
                </div>
                <h1 className="tcc-hero-title text-2xl font-bold tracking-tight text-heading">Quantum Computing Radar</h1>
              </div>
              <p className="text-sm text-gray-500 max-w-xl">
                Curated quantum universe — pure-play hardware, big tech, enabling tech, defense, security, and materials.
                Scan for live buy/sell signals powered by the Swing Trade engine.
              </p>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <div className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-center">
                  <div className="text-xl font-bold text-white font-mono">{STOCKS.length}</div>
                  <div>stocks</div>
                </div>
                <div className="bg-gray-800 border border-cyan-900/50 rounded-xl px-3 py-2 text-center">
                  <div className="text-xl font-bold text-cyan-400 font-mono">{highlightCount}</div>
                  <div>key plays</div>
                </div>
                <div className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-center">
                  <div className="text-xl font-bold text-amber-400 font-mono">{watchedCount}</div>
                  <div>watching</div>
                </div>
              </div>

              {/* Trade style toggle — cyan theme for Q-Radar */}
              <div className="flex items-center bg-gray-800 border border-gray-700 rounded-xl p-0.5 gap-0.5">
                <button type="button" onClick={() => setTradeStyle('swing')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${tradeStyle === 'swing' ? 'bg-cyan-700 text-white' : 'text-gray-400 hover:text-gray-200'}`}>
                  3–5 Days
                </button>
                <button type="button" onClick={() => setTradeStyle('position')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${tradeStyle === 'position' ? 'bg-cyan-700 text-white' : 'text-gray-400 hover:text-gray-200'}`}>
                  2–4 Weeks
                </button>
              </div>

              {!hasScanResults ? (
                <button type="button" onClick={handleScan} disabled={scanning}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-700 hover:bg-cyan-600
                             disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold
                             border border-cyan-600 transition-colors">
                  <ScanLine size={16} />Scan Signals
                </button>
              ) : (
                <button type="button" onClick={handleClearScan}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs border border-gray-700 transition-colors">
                  <X size={13} />Clear scan
                </button>
              )}
            </div>
          </div>

          {scanning && scanProgress && (
            <div className="mt-4">
              <div className="flex justify-between text-xs text-gray-500 mb-1.5">
                <span>Scanning stocks…</span>
                <span className="font-mono">{scanProgress.done} / {scanProgress.total}</span>
              </div>
              <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-cyan-600 rounded-full transition-all duration-300"
                  style={{ width: `${(scanProgress.done / scanProgress.total) * 100}%` }} />
              </div>
            </div>
          )}

          <div className="mt-4 relative">
            <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type="text" placeholder="Search ticker, name, tech (trapped-ion, photonic, annealing…)"
              value={search} onChange={e => setSearch(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl pl-9 pr-4 py-2.5
                         text-white text-sm placeholder-gray-600 focus:outline-none focus:border-cyan-500
                         focus:ring-1 focus:ring-cyan-500 transition-colors" />
          </div>
        </div>

        {/* Signal filter */}
        {scanDone && (
          <div className="flex gap-2 flex-wrap items-center">
            <span className="text-xs text-gray-600 mr-1">Signal:</span>
            {([
              { id: 'all',     label: 'All',        count: STOCKS.length,        cls: 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600' },
              { id: 'buy',     label: 'Buy',         count: signalCounts.buy,     cls: 'bg-emerald-900/30 border-emerald-800 text-emerald-300 hover:border-emerald-600' },
              { id: 'bearish', label: 'Bearish',     count: signalCounts.bearish, cls: 'bg-red-900/30 border-red-800 text-red-300 hover:border-red-600' },
              { id: 'skip',    label: 'Skip / Wait', count: signalCounts.skip,    cls: 'bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-600' },
            ] as const).map(f => (
              <button key={f.id} onClick={() => setSignalFilter(f.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all
                  ${signalFilter === f.id ? 'ring-1 ring-offset-1 ring-offset-gray-950 ring-white/20 brightness-125' : ''} ${f.cls}`}>
                {f.label}<span className="font-mono opacity-70">{f.count}</span>
              </button>
            ))}
          </div>
        )}

        {/* Quantum tech explainer strip */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {[
            { tech: 'Trapped-Ion',    desc: 'IONQ, HON/Quantinuum', color: 'text-cyan-400',    bg: 'bg-cyan-900/20 border-cyan-900/50' },
            { tech: 'Superconducting',desc: 'GOOGL, IBM, RGTI',     color: 'text-blue-400',    bg: 'bg-blue-900/20 border-blue-900/50' },
            { tech: 'Topological',    desc: 'MSFT Majorana',        color: 'text-indigo-400',  bg: 'bg-indigo-900/20 border-indigo-900/50' },
            { tech: 'Photonic',       desc: 'QUBT, PsiQuantum',     color: 'text-violet-400',  bg: 'bg-violet-900/20 border-violet-900/50' },
            { tech: 'Annealing',      desc: 'D-Wave (QBTS)',        color: 'text-teal-400',    bg: 'bg-teal-900/20 border-teal-900/50' },
            { tech: 'Spin Qubit',     desc: 'INTC, Silicon-based',  color: 'text-emerald-400', bg: 'bg-emerald-900/20 border-emerald-900/50' },
          ].map(t => (
            <div key={t.tech} className={`rounded-xl px-3 py-2.5 border ${t.bg}`}>
              <div className={`text-[11px] font-bold ${t.color}`}>{t.tech}</div>
              <div className="text-[10px] text-gray-500 mt-0.5">{t.desc}</div>
            </div>
          ))}
        </div>

        {/* Category filter */}
        <div className="flex gap-2 flex-wrap">
          {CATEGORIES.map(cat => {
            const count = cat.id === 'All' ? STOCKS.length : STOCKS.filter(s => s.category === cat.id).length
            const isActive = activeCategory === cat.id
            return (
              <button key={cat.id} onClick={() => setActiveCategory(cat.id)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
                  isActive ? CAT_ACTIVE[cat.color] : 'bg-gray-900 border-gray-800 text-gray-400 hover:border-gray-600 hover:text-gray-200'}`}>
                {cat.icon}<span>{cat.label}</span>
                <span className={`ml-0.5 font-mono ${isActive ? 'opacity-80' : 'text-gray-600'}`}>{count}</span>
              </button>
            )
          })}
        </div>

        {activeCategory !== 'All' && (
          <div className="text-xs text-gray-500 px-1">
            {CATEGORIES.find(c => c.id === activeCategory)?.desc}
            {' '}· {filtered.length} stock{filtered.length !== 1 ? 's' : ''}
          </div>
        )}

        {filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <div className="text-4xl mb-3">⚛️</div>
            <div className="font-semibold">
              {signalFilter !== 'all' && scanDone ? `No ${signalFilter} signals in this view` : `No stocks match "${search}"`}
            </div>
            <div className="text-xs mt-1">
              {signalFilter !== 'all' && scanDone ? 'Try a different filter or category' : 'Try a ticker like IONQ or keyword like "trapped-ion"'}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map(stock => (
              <QStockCard key={stock.ticker} stock={stock} myTickerSet={myTickerSet}
                onToggleWatch={handleToggleWatch} signal={scanResults.get(stock.ticker) ?? null} tradeStyle={tradeStyle} />
            ))}
          </div>
        )}

        {/* Quantum market context */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-3">
          <div className="text-sm font-bold text-white flex items-center gap-2">
            <Atom size={15} className="text-cyan-400" /> Quantum Market Context
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-gray-500">
            <div className="bg-gray-800/60 rounded-xl px-3 py-3">
              <div className="text-cyan-400 font-bold text-sm mb-1">$850B+</div>
              <div>Projected quantum computing market by 2040 (McKinsey). Drug discovery, materials science, and financial optimization are the highest-value near-term use cases.</div>
            </div>
            <div className="bg-gray-800/60 rounded-xl px-3 py-3">
              <div className="text-blue-400 font-bold text-sm mb-1">2024–2027</div>
              <div>NIST post-quantum cryptography standards finalized (2024). US agencies mandated to migrate by 2030. Creates multi-year tailwind for quantum security and post-quantum crypto vendors.</div>
            </div>
            <div className="bg-gray-800/60 rounded-xl px-3 py-3">
              <div className="text-amber-400 font-bold text-sm mb-1">⚠ High Risk</div>
              <div>Pure-play quantum stocks are pre-revenue or early revenue. Massive volatility — 5–10× swings common. Treat as venture-style positions. Big tech plays offer quantum exposure with lower risk.</div>
            </div>
          </div>
        </div>

        <div className="bg-gray-900/50 border border-gray-800/50 rounded-xl p-4">
          <div className="text-xs text-gray-600 leading-relaxed">
            <span className="text-gray-500 font-semibold">How to use: </span>
            Click <span className="text-cyan-400">Scan Signals</span> to run the Swing Trade engine across all quantum stocks.
            Toggle <span className="text-cyan-400">3–5 Days</span> / <span className="text-cyan-400">2–4 Weeks</span> to switch between swing and position-trade targets.
            Click <span className="text-cyan-400">Analyze</span> for full options analysis.
            <span className="text-cyan-400 font-semibold ml-2">★ Key Play</span> stocks are the highest-conviction names per category.
          </div>
        </div>

        <div className="text-center text-xs text-gray-600 py-1 border-t border-gray-800/50">
          ⚠️ Signals are for informational purposes only. Quantum stocks carry exceptional risk. Not a recommendation to buy or sell.
        </div>
      </div>
    </div>
  )
}
