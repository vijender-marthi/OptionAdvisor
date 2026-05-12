import { useState, useEffect, useCallback, useMemo } from 'react'
import { Star, Check, TrendingUp, Atom, Shield, Cpu, Building2, Search, Zap, FlaskConical } from 'lucide-react'
import { useApp } from '../contexts/AppContext'
import { addMyTicker, removeMyTicker, fetchMyTickers } from '../api/commandCenter'
import type { MyTickerEntry } from '../api/commandCenter'

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

interface QStockEntry {
  ticker: string
  name: string
  category: Exclude<QCategory, 'All'>
  note: string
  marketCap?: string
  tech?: string      // underlying quantum tech/approach
  highlight?: boolean // "watch closely" flag
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
    note: 'Willow chip (105 qubits) achieves below-threshold quantum error correction — landmark milestone. Google Quantum AI lab claims error rates decrease exponentially with scale. Quantum supremacy experiments.',
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
    note: 'Majority owner of Quantinuum (world\'s leading commercial quantum company). H2 processor holds world record 56 logical qubits with error correction. Joint venture with Cambridge Quantum Computing.',
  },
  {
    ticker: 'INTC', name: 'Intel Corporation',
    category: 'Big Tech Quantum', marketCap: '$85B', tech: 'Spin Qubit',
    note: 'Silicon spin qubit research via Tunnel Falls chip. Horse Ridge II cryogenic control chip reduces wiring complexity. Leverages existing semiconductor manufacturing expertise for scalable qubits.',
  },

  // ── Quantum Enabling Technology ──────────────────────────
  {
    ticker: 'NVDA', name: 'NVIDIA Corporation',
    category: 'Quantum Enabling', marketCap: '$2.9T', tech: 'Simulation',
    highlight: true,
    note: 'cuQuantum SDK accelerates quantum circuit simulation on GPUs — essential for near-term error mitigation. CUDA-Q platform integrates quantum and classical computing. NVIDIA is the "picks and shovels" for quantum simulation.',
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
    note: 'Materials engineering systems for depositing superconducting films (Josephson junctions) and silicon spin qubit fabrication. Enables scale-up of quantum processor manufacturing.',
  },
  {
    ticker: 'TSM', name: 'Taiwan Semiconductor (TSMC)',
    category: 'Quantum Enabling', marketCap: '$900B', tech: 'Foundry',
    note: 'Manufactures Intel\'s Tunnel Falls spin qubit chips. Expected to be the foundry of choice as silicon-based quantum processors scale. World-class process control for atomic-precision qubits.',
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
    note: 'Pioneering quantum sensing for GPS-denied navigation, quantum radar, and secure quantum communications. Early D-Wave adopter for aerospace optimization. Significant DARPA and DOD quantum contracts.',
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
    note: 'Integrating quantum optimization algorithms into AIP and Gotham platforms. US government AI and data infrastructure positioned to layer in quantum speedups for intelligence analysis.',
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
    note: 'Integrating NIST post-quantum cryptographic standards (CRYSTALS-Kyber, CRYSTALS-Dilithium) into Falcon platform. Quantum-safe security essential as "harvest now, decrypt later" attacks grow.',
  },
  {
    ticker: 'PANW', name: 'Palo Alto Networks',
    category: 'Quantum Security', marketCap: '$115B', tech: 'Post-Quantum Crypto',
    note: 'Rolling out quantum-safe encryption across Prisma Cloud and SASE platforms. NIST PQC standard implementation roadmap. Enterprise security vendor with highest post-quantum urgency exposure.',
  },
  {
    ticker: 'CSCO', name: 'Cisco Systems',
    category: 'Quantum Security', marketCap: '$220B', tech: 'QKD Networking',
    note: 'Building quantum key distribution (QKD) into enterprise networking hardware. Partnered with Toshiba for metro QKD deployments. Post-quantum TLS implementation across IOS-XE.',
  },
  {
    ticker: 'NTAP', name: 'NetApp',
    category: 'Quantum Security', marketCap: '$20B', tech: 'Data Encryption',
    note: 'Post-quantum encryption for enterprise data at rest and in motion. Storage platforms being upgraded to PQC standards ahead of NIST 2024 deadlines for FIPS-compliant systems.',
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
    note: 'Manufactures dilution refrigerators (through Brooks Instrument / Bluefors partnership) and precision valves for cryogenic quantum systems. Every superconducting quantum computer runs at ~15 millikelvin.',
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
  { id: 'All',               label: 'All',              icon: <Atom size={14} />,       color: 'violet', desc: 'Complete quantum computing universe' },
  { id: 'Pure-Play Quantum', label: 'Pure-Play',        icon: <FlaskConical size={14}/>, color: 'cyan',   desc: 'Companies solely focused on quantum hardware or software' },
  { id: 'Big Tech Quantum',  label: 'Big Tech',         icon: <Building2 size={14} />,  color: 'blue',   desc: 'Hyperscalers and large enterprises with major quantum divisions' },
  { id: 'Quantum Enabling',  label: 'Enabling Tech',    icon: <Cpu size={14} />,        color: 'indigo', desc: 'Tools, equipment, simulation and foundry for quantum systems' },
  { id: 'Defense & Gov',     label: 'Defense & Gov',    icon: <Shield size={14} />,     color: 'rose',   desc: 'Defense contractors and government IT with quantum sensing/comms programs' },
  { id: 'Quantum Security',  label: 'Q Security',       icon: <Zap size={14} />,        color: 'amber',  desc: 'Post-quantum cryptography and quantum-safe networking' },
  { id: 'Quantum Materials', label: 'Q Materials',      icon: <TrendingUp size={14} />, color: 'teal',   desc: 'Cryogenics, ultra-pure materials and rare earths enabling quantum hardware' },
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
// STOCK CARD
// ─────────────────────────────────────────────────────────────

function QStockCard({ stock, myTickerSet, onToggleWatch }: { stock: QStockEntry; myTickerSet: Set<string>; onToggleWatch: (ticker: string, name: string, currentlyWatched: boolean) => void }) {
  const { requestAnalysis } = useApp()
  const watched = myTickerSet.has(stock.ticker)

  const handleAnalyze = () => requestAnalysis(stock.ticker)
  const handleWatch   = () => onToggleWatch(stock.ticker, stock.name, watched)

  return (
    <div className={`bg-gray-900 rounded-2xl p-4 flex flex-col gap-3 transition-colors group
                    ${stock.highlight
                      ? 'border border-cyan-900/60 hover:border-cyan-700/60'
                      : 'border border-gray-800 hover:border-gray-700'}`}>
      {/* Top row */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-lg font-bold text-white font-mono tracking-tight">
              {stock.ticker}
            </span>
            {stock.marketCap && (
              <span className="text-xs text-gray-600 font-mono">{stock.marketCap}</span>
            )}
            {stock.highlight && (
              <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-cyan-900/50 text-cyan-400 border border-cyan-800">
                ★ Key Play
              </span>
            )}
          </div>
          <div className="text-xs text-gray-400 mt-0.5 leading-snug">{stock.name}</div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${CAT_BADGE[stock.category]}`}>
            {stock.category}
          </span>
          {stock.tech && (
            <span className="text-[10px] text-gray-600 font-mono text-right">{stock.tech}</span>
          )}
        </div>
      </div>

      {/* Note */}
      <p className="text-xs text-gray-500 leading-relaxed flex-1">{stock.note}</p>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={handleAnalyze}
          aria-label={`Analyze ${stock.ticker}`}
          title="Analyze options"
          className="flex-1 inline-flex h-10 items-center justify-center bg-cyan-900/20 hover:bg-cyan-900/30
                     text-cyan-300 rounded-xl border border-cyan-800 hover:border-cyan-600 transition-colors"
        >
          <TrendingUp size={18} />
        </button>
        <button
          type="button"
          onClick={handleWatch}
          aria-label={watched ? `Remove ${stock.ticker} from watchlist` : `Add ${stock.ticker} to watchlist`}
          title={watched ? 'Remove from watchlist' : 'Add to watchlist'}
          className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-all ${
            watched
              ? 'bg-amber-900/30 border-amber-700 text-amber-400 hover:bg-red-900/20 hover:border-red-700 hover:text-red-400'
              : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-amber-600 hover:text-amber-400'
          }`}
        >
          {watched ? <Check size={18} /> : <Star size={18} />}
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────

export default function QRadarPage() {
  const [activeCategory, setActiveCategory] = useState<QCategory>('All')
  const [search, setSearch] = useState('')
  const [myTickers, setMyTickers] = useState<MyTickerEntry[]>([])

  useEffect(() => {
    fetchMyTickers().then(res => {
      setMyTickers(res.data?.tickers || [])
    }).catch(() => {})
  }, [])

  const myTickerSet = useMemo(() => new Set(myTickers.map(t => t.symbol.toUpperCase())), [myTickers])

  const handleToggleWatch = useCallback(async (ticker: string, name: string, currentlyWatched: boolean) => {
    const sym = ticker.toUpperCase()
    if (currentlyWatched) {
      try {
        await removeMyTicker(sym)
        setMyTickers(prev => prev.filter(t => t.symbol.toUpperCase() !== sym))
      } catch {}
    } else {
      try {
        const res = await addMyTicker({ symbol: sym, company_name: name, trade_types: ['regular'] })
        if (res.data?.tickers) setMyTickers(res.data.tickers)
      } catch {}
    }
  }, [])

  const filtered = STOCKS.filter(s => {
    const matchCat = activeCategory === 'All' || s.category === activeCategory
    const q = search.trim().toLowerCase()
    const matchSearch = !q ||
      s.ticker.toLowerCase().includes(q) ||
      s.name.toLowerCase().includes(q) ||
      s.note.toLowerCase().includes(q) ||
      (s.tech ?? '').toLowerCase().includes(q)
    return matchCat && matchSearch
  })

  const watchedCount   = STOCKS.filter(s => myTickerSet.has(s.ticker)).length
  const highlightCount = STOCKS.filter(s => s.highlight).length

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
                <h1 className="text-2xl font-bold text-white">Quantum Computing Radar</h1>
              </div>
              <p className="text-sm text-gray-500 max-w-xl">
                Curated universe of pure-play quantum hardware, big tech quantum divisions, enabling technology,
                defense/government contracts, post-quantum security, and quantum materials plays.
                One click to analyze options or add to your watchlist.
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-500">
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
          </div>

          {/* Search */}
          <div className="mt-4 relative">
            <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Search ticker, name, tech (trapped-ion, photonic, annealing…)"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl pl-9 pr-4 py-2.5
                         text-white text-sm placeholder-gray-600 focus:outline-none focus:border-cyan-500
                         focus:ring-1 focus:ring-cyan-500 transition-colors"
            />
          </div>
        </div>

        {/* Quantum tech explainer strip */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {[
            { tech: 'Trapped-Ion',    desc: 'IONQ, HON/Quantinuum', color: 'text-cyan-400',   bg: 'bg-cyan-900/20 border-cyan-900/50' },
            { tech: 'Superconducting',desc: 'GOOGL, IBM, RGTI',      color: 'text-blue-400',   bg: 'bg-blue-900/20 border-blue-900/50' },
            { tech: 'Topological',    desc: 'MSFT Majorana',         color: 'text-indigo-400', bg: 'bg-indigo-900/20 border-indigo-900/50' },
            { tech: 'Photonic',       desc: 'QUBT, PsiQuantum',      color: 'text-violet-400', bg: 'bg-violet-900/20 border-violet-900/50' },
            { tech: 'Annealing',      desc: 'D-Wave (QBTS)',         color: 'text-teal-400',   bg: 'bg-teal-900/20 border-teal-900/50' },
            { tech: 'Spin Qubit',     desc: 'INTC, Silicon-based',   color: 'text-emerald-400',bg: 'bg-emerald-900/20 border-emerald-900/50' },
          ].map(t => (
            <div key={t.tech} className={`rounded-xl px-3 py-2.5 border ${t.bg}`}>
              <div className={`text-[11px] font-bold ${t.color}`}>{t.tech}</div>
              <div className="text-[10px] text-gray-500 mt-0.5">{t.desc}</div>
            </div>
          ))}
        </div>

        {/* Category filter pills */}
        <div className="flex gap-2 flex-wrap">
          {CATEGORIES.map(cat => {
            const count = cat.id === 'All' ? STOCKS.length : STOCKS.filter(s => s.category === cat.id).length
            const isActive = activeCategory === cat.id
            return (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
                  isActive
                    ? CAT_ACTIVE[cat.color]
                    : 'bg-gray-900 border-gray-800 text-gray-400 hover:border-gray-600 hover:text-gray-200'
                }`}
              >
                {cat.icon}
                <span>{cat.label}</span>
                <span className={`ml-0.5 font-mono ${isActive ? 'opacity-80' : 'text-gray-600'}`}>
                  {count}
                </span>
              </button>
            )
          })}
        </div>

        {/* Category description */}
        {activeCategory !== 'All' && (
          <div className="text-xs text-gray-500 px-1">
            {CATEGORIES.find(c => c.id === activeCategory)?.desc}
            {' '}· {filtered.length} stock{filtered.length !== 1 ? 's' : ''}
          </div>
        )}

        {/* Stock grid */}
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <div className="text-4xl mb-3">⚛️</div>
            <div className="font-semibold">No stocks match "{search}"</div>
            <div className="text-xs mt-1">Try a ticker like IONQ or keyword like "trapped-ion"</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map(stock => (
              <QStockCard key={stock.ticker} stock={stock} myTickerSet={myTickerSet} onToggleWatch={handleToggleWatch} />
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
              <div>Pure-play quantum stocks are pre-revenue or early revenue. Massive volatility — 5–10× swings common. Treat as venture-style positions. Big tech plays (GOOGL, IBM, MSFT) offer quantum exposure with lower risk.</div>
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="bg-gray-900/50 border border-gray-800/50 rounded-xl p-4">
          <div className="text-xs text-gray-600 leading-relaxed">
            <span className="text-gray-500 font-semibold">How to use: </span>
            Click <span className="text-cyan-400">Analyze</span> to run a full options analysis on any stock.
            Click <span className="text-amber-400">Watch</span> to add to your watchlist for price tracking.
            <span className="text-cyan-400 font-semibold ml-2">★ Key Play</span> stocks are the highest-conviction quantum exposure names per category.
          </div>
        </div>

        <div className="text-center text-xs text-gray-600 py-1 border-t border-gray-800/50">
          ⚠️ Curated list for informational purposes only. Quantum computing stocks carry exceptional risk. Not a recommendation to buy or sell. Options trading involves significant risk.
        </div>
      </div>
    </div>
  )
}
