import { useState } from 'react'
import { Star, Check, TrendingUp, Cpu, Cloud, Database, Zap, Wrench, Bot, Search, Cable, Network, LayoutGrid } from 'lucide-react'
import { useApp } from '../contexts/AppContext'

// ─────────────────────────────────────────────────────────────
// STOCK UNIVERSE — curated AI / Data Center names
// ─────────────────────────────────────────────────────────────

type Category = 'All' | 'AI Chips' | 'AI Software' | 'Data Centers' | 'AI Power' | 'Semicon Equip' | 'AI Pure-Play' | 'Optical Networking' | 'AI Networking' | 'AI Applications'

interface StockEntry {
  ticker: string
  name: string
  category: Exclude<Category, 'All'>
  note: string
  marketCap?: string   // rough size hint
}

const STOCKS: StockEntry[] = [
  // ── AI Chips & Hardware ───────────────────────────────────
  { ticker: 'NVDA',  name: 'NVIDIA Corporation',         category: 'AI Chips',      marketCap: '$2.9T', note: 'Dominant GPU maker powering AI training & inference worldwide' },
  { ticker: 'AMD',   name: 'Advanced Micro Devices',     category: 'AI Chips',      marketCap: '$240B', note: 'CPU/GPU challenger gaining AI datacenter share with MI300X' },
  { ticker: 'AVGO',  name: 'Broadcom Inc.',              category: 'AI Chips',      marketCap: '$780B', note: 'Custom AI ASICs (XPUs) built for Google, Meta hyperscalers' },
  { ticker: 'MRVL',  name: 'Marvell Technology',        category: 'AI Chips',      marketCap: '$60B',  note: 'Custom silicon and high-speed networking for AI infrastructure' },
  { ticker: 'QCOM',  name: 'Qualcomm',                   category: 'AI Chips',      marketCap: '$160B', note: 'On-device AI chips for mobile & edge — Snapdragon X Elite' },
  { ticker: 'ARM',   name: 'Arm Holdings',               category: 'AI Chips',      marketCap: '$130B', note: 'IP licensor behind most AI edge processors globally' },
  { ticker: 'SMCI',  name: 'Super Micro Computer',       category: 'AI Chips',      marketCap: '$25B',  note: 'AI server builder with deep NVIDIA GPU rack integration' },
  { ticker: 'INTC',  name: 'Intel Corporation',          category: 'AI Chips',      marketCap: '$85B',  note: 'Gaudi AI accelerators — restructuring to compete in AI era' },
  { ticker: 'MU',    name: 'Micron Technology',          category: 'AI Chips',      marketCap: '$95B',  note: 'HBM3E memory stacked inside H200/B200 GPUs — US-based HBM supplier to NVDA' },

  // ── AI Software & Cloud ───────────────────────────────────
  { ticker: 'MSFT',  name: 'Microsoft Corporation',      category: 'AI Software',   marketCap: '$3.1T', note: 'Azure AI, Copilot suite, primary OpenAI commercial partner' },
  { ticker: 'GOOGL', name: 'Alphabet / Google',          category: 'AI Software',   marketCap: '$2.0T', note: 'Gemini models, TPU silicon, Google Cloud AI services' },
  { ticker: 'META',  name: 'Meta Platforms',             category: 'AI Software',   marketCap: '$1.4T', note: 'Llama open-source LLMs, AI-powered Reels & ad targeting' },
  { ticker: 'AMZN',  name: 'Amazon',                     category: 'AI Software',   marketCap: '$2.2T', note: 'AWS Bedrock, Trainium/Inferentia custom AI chips' },
  { ticker: 'PLTR',  name: 'Palantir Technologies',      category: 'AI Software',   marketCap: '$220B', note: 'AIP platform for enterprise and US government/defense AI' },
  { ticker: 'CRM',   name: 'Salesforce',                 category: 'AI Software',   marketCap: '$300B', note: 'Agentforce AI platform built into CRM workflows' },
  { ticker: 'NOW',   name: 'ServiceNow',                 category: 'AI Software',   marketCap: '$185B', note: 'AI-powered workflow automation dominating enterprise IT' },
  { ticker: 'ORCL',  name: 'Oracle Corporation',         category: 'AI Software',   marketCap: '$450B', note: 'OCI cloud rapidly gaining AI workload share from hyperscalers' },
  { ticker: 'IBM',   name: 'IBM Corporation',            category: 'AI Software',   marketCap: '$220B', note: 'Watsonx AI platform targeting enterprise hybrid cloud' },

  // ── AI Pure-Play / Emerging ───────────────────────────────
  { ticker: 'AI',    name: 'C3.ai',                      category: 'AI Pure-Play',  marketCap: '$4B',   note: 'Enterprise AI application platform for industrial use cases' },
  { ticker: 'SOUN',  name: 'SoundHound AI',              category: 'AI Pure-Play',  marketCap: '$3B',   note: 'Voice AI powering automotive and restaurant kiosks' },
  { ticker: 'BBAI',  name: 'BigBear.ai',                 category: 'AI Pure-Play',  marketCap: '$1B',   note: 'AI decisioning for defense and national security' },
  { ticker: 'IONQ',  name: 'IonQ',                       category: 'AI Pure-Play',  marketCap: '$8B',   note: 'Trapped-ion quantum computing for AI optimization problems' },
  { ticker: 'RGTI',  name: 'Rigetti Computing',          category: 'AI Pure-Play',  marketCap: '$2B',   note: 'Superconducting quantum processors for hybrid AI/quantum' },
  { ticker: 'UPST',  name: 'Upstart Holdings',           category: 'AI Pure-Play',  marketCap: '$8B',   note: 'AI-native lending platform replacing FICO-based credit scoring' },

  // ── Data Centers & Infrastructure ────────────────────────
  { ticker: 'EQIX',  name: 'Equinix',                    category: 'Data Centers',  marketCap: '$82B',  note: 'Largest global data center REIT — 260+ facilities worldwide' },
  { ticker: 'DLR',   name: 'Digital Realty Trust',       category: 'Data Centers',  marketCap: '$50B',  note: 'Global data center REIT serving hyperscalers and cloud firms' },
  { ticker: 'IRM',   name: 'Iron Mountain',              category: 'Data Centers',  marketCap: '$25B',  note: 'Data center REIT with growing AI colocation footprint' },
  { ticker: 'DELL',  name: 'Dell Technologies',          category: 'Data Centers',  marketCap: '$85B',  note: 'AI servers (PowerEdge) and full enterprise datacenter solutions' },
  { ticker: 'HPE',   name: 'HP Enterprise',              category: 'Data Centers',  marketCap: '$22B',  note: 'Cray supercomputers and AI infrastructure for enterprise HPC' },
  { ticker: 'NTAP',  name: 'NetApp',                     category: 'Data Centers',  marketCap: '$20B',  note: 'Cloud-native data storage and infrastructure for AI workloads' },
  { ticker: 'WDC',   name: 'Western Digital',            category: 'Data Centers',  marketCap: '$20B',  note: 'HDD/SSD storage essential for AI training data lakes' },
  { ticker: 'VRT',   name: 'Vertiv Holdings',            category: 'Data Centers',  marketCap: '$32B',  note: 'Power distribution & liquid cooling systems inside every AI GPU rack — essential DC infrastructure' },

  // ── AI Power & Energy ────────────────────────────────────
  { ticker: 'VST',   name: 'Vistra Corp',                category: 'AI Power',      marketCap: '$38B',  note: 'Nuclear & combined-cycle power signed for major datacenter deals' },
  { ticker: 'CEG',   name: 'Constellation Energy',       category: 'AI Power',      marketCap: '$68B',  note: 'Largest US nuclear operator; Three Mile Island restart for MSFT' },
  { ticker: 'NRG',   name: 'NRG Energy',                 category: 'AI Power',      marketCap: '$16B',  note: 'Power generation with retail and C&I AI-load exposure' },
  { ticker: 'ETR',   name: 'Entergy Corp',               category: 'AI Power',      marketCap: '$24B',  note: 'Utility scaling generation capacity for AI datacenter clients' },
  { ticker: 'PWR',   name: 'Quanta Services',            category: 'AI Power',      marketCap: '$40B',  note: 'Builds power lines and substations feeding AI datacenters' },
  { ticker: 'WATT',  name: 'Energous Corporation',       category: 'AI Power',      marketCap: '$0.1B', note: 'Wireless power for edge AI devices' },

  // ── Semiconductor Equipment ───────────────────────────────
  { ticker: 'ASML',  name: 'ASML Holding',               category: 'Semicon Equip', marketCap: '$300B', note: 'Sole maker of EUV lithography — a chokepoint for AI chip production' },
  { ticker: 'LRCX',  name: 'Lam Research',               category: 'Semicon Equip', marketCap: '$95B',  note: 'Etch and deposition equipment critical for leading-edge nodes' },
  { ticker: 'KLAC',  name: 'KLA Corporation',            category: 'Semicon Equip', marketCap: '$90B',  note: 'Process control and inspection — ensures chip yield for AI fabs' },
  { ticker: 'AMAT',  name: 'Applied Materials',          category: 'Semicon Equip', marketCap: '$150B', note: 'Materials engineering systems for every major chipmaker globally' },
  { ticker: 'TSM',   name: 'Taiwan Semiconductor (TSMC)', category: 'Semicon Equip', marketCap: '$900B', note: 'Manufactures chips for NVDA, AMD, Apple — AI silicon foundry leader' },
  { ticker: 'TER',   name: 'Teradyne',                   category: 'Semicon Equip',    marketCap: '$17B',  note: 'Semiconductor test equipment for AI chip validation' },

  // ── AI Networking (Ethernet & InfiniBand switching) ──────
  { ticker: 'ANET',  name: 'Arista Networks',            category: 'AI Networking', marketCap: '$95B',  note: 'Ethernet spine switches for 400G/800G AI clusters — top supplier to Meta, Microsoft, Google' },
  { ticker: 'CSCO',  name: 'Cisco Systems',              category: 'AI Networking', marketCap: '$220B', note: 'Networking backbone for enterprise AI infrastructure and datacenter fabrics' },
  { ticker: 'INFN',  name: 'Infinera Corporation',       category: 'AI Networking', marketCap: '$2B',   note: 'Optical transport networking for long-haul datacenter interconnect' },
  { ticker: 'JNPR',  name: 'Juniper Networks',           category: 'AI Networking', marketCap: '$14B',  note: 'AI-driven networking platform; acquired by HPE for AI campus & DC networking' },

  // ── AI Applications ───────────────────────────────────────
  { ticker: 'SNOW',  name: 'Snowflake',                  category: 'AI Applications', marketCap: '$45B',  note: 'AI Data Cloud — Cortex AI and vector search for enterprise ML pipelines' },
  { ticker: 'DDOG',  name: 'Datadog',                    category: 'AI Applications', marketCap: '$38B',  note: 'AI-powered observability and monitoring for cloud-native AI infrastructure' },
  { ticker: 'PATH',  name: 'UiPath',                     category: 'AI Applications', marketCap: '$10B',  note: 'Agentic AI automation platform for enterprise RPA and workflow orchestration' },
  { ticker: 'CRWD',  name: 'CrowdStrike',                category: 'AI Applications', marketCap: '$88B',  note: 'AI-native cybersecurity — Falcon platform uses ML across 1T+ daily events' },
  { ticker: 'PANW',  name: 'Palo Alto Networks',         category: 'AI Applications', marketCap: '$115B', note: 'AI-powered security platform consolidating network, cloud, and SOC operations' },
  { ticker: 'RXRX',  name: 'Recursion Pharmaceuticals', category: 'AI Applications', marketCap: '$2B',   note: 'AI drug discovery — uses foundation models on biological data to find novel drugs' },

  // ── Optical Networking ────────────────────────────────────
  { ticker: 'COHR',  name: 'Coherent Corp.',              category: 'Optical Networking', marketCap: '$12B',  note: 'Largest optical transceiver maker — 400G/800G modules for NVDA, Meta, Google datacenters' },
  { ticker: 'CIEN',  name: 'Ciena Corporation',           category: 'Optical Networking', marketCap: '$10B',  note: 'Coherent optical networking systems for long-haul datacenter interconnects' },
  { ticker: 'LITE',  name: 'Lumentum Holdings',           category: 'Optical Networking', marketCap: '$4B',   note: 'Optical components & pump lasers inside transceivers used across hyperscaler DCs' },
  { ticker: 'VIAV',  name: 'Viavi Solutions',             category: 'Optical Networking', marketCap: '$2B',   note: 'Fiber test & measurement equipment for validating DC optical infrastructure' },
  { ticker: 'AAOI',  name: 'Applied Optoelectronics',     category: 'Optical Networking', marketCap: '$0.5B', note: 'High-speed 400G/800G transceiver modules for hyperscaler AI build-outs' },
  { ticker: 'IPGP',  name: 'IPG Photonics',               category: 'Optical Networking', marketCap: '$7B',   note: 'Fiber laser technology with growing datacenter and industrial optical applications' },
]

// ─────────────────────────────────────────────────────────────
// CATEGORY METADATA
// ─────────────────────────────────────────────────────────────

const CATEGORIES: { id: Category; label: string; icon: React.ReactNode; color: string; desc: string }[] = [
  { id: 'All',          label: 'All',             icon: <Bot size={14} />,     color: 'violet', desc: 'Complete AI & datacenter universe' },
  { id: 'AI Chips',     label: 'AI Chips',        icon: <Cpu size={14} />,     color: 'blue',   desc: 'GPUs, ASICs, accelerators' },
  { id: 'AI Software',  label: 'AI Software',     icon: <Cloud size={14} />,   color: 'sky',    desc: 'Cloud AI platforms & models' },
  { id: 'AI Pure-Play', label: 'Pure-Play AI',    icon: <TrendingUp size={14}/>,color: 'emerald',desc: 'Emerging AI-native companies' },
  { id: 'Data Centers', label: 'Data Centers',    icon: <Database size={14} />, color: 'amber',  desc: 'REITs, servers, storage' },
  { id: 'AI Power',     label: 'AI Power',        icon: <Zap size={14} />,     color: 'orange', desc: 'Energy & grid for AI compute' },
  { id: 'Semicon Equip',     label: 'Semicon Equip',      icon: <Wrench size={14} />,  color: 'rose',  desc: 'Tools to build AI chips' },
  { id: 'Optical Networking', label: 'Optical Networking', icon: <Cable size={14} />,   color: 'cyan',    desc: 'High-speed fiber & transceiver plays for AI datacenter interconnects' },
  { id: 'AI Networking',     label: 'AI Networking',      icon: <Network size={14} />, color: 'indigo',  desc: 'Ethernet & switching infrastructure connecting AI GPU clusters' },
  { id: 'AI Applications',   label: 'AI Applications',    icon: <LayoutGrid size={14} />, color: 'teal', desc: 'Software platforms and tools powered by or built for AI workloads' },
]

const CAT_BADGE: Record<Exclude<Category,'All'>, string> = {
  'AI Chips':           'bg-blue-900/40 text-blue-300 border-blue-800',
  'AI Software':        'bg-sky-900/40 text-sky-300 border-sky-800',
  'AI Pure-Play':       'bg-emerald-900/40 text-emerald-300 border-emerald-800',
  'Data Centers':       'bg-amber-900/40 text-amber-300 border-amber-800',
  'AI Power':           'bg-orange-900/40 text-orange-300 border-orange-800',
  'Semicon Equip':      'bg-rose-900/40 text-rose-300 border-rose-800',
  'Optical Networking': 'bg-cyan-900/40 text-cyan-300 border-cyan-800',
  'AI Networking':      'bg-indigo-900/40 text-indigo-300 border-indigo-800',
  'AI Applications':    'bg-teal-900/40 text-teal-300 border-teal-800',
}

const CAT_ACTIVE: Record<string, string> = {
  'violet':  'bg-violet-600  border-violet-500  text-white',
  'blue':    'bg-blue-700    border-blue-600    text-white',
  'sky':     'bg-sky-700     border-sky-600     text-white',
  'emerald': 'bg-emerald-700 border-emerald-600 text-white',
  'amber':   'bg-amber-600   border-amber-500   text-white',
  'orange':  'bg-orange-700  border-orange-600  text-white',
  'rose':    'bg-rose-700    border-rose-600    text-white',
  'cyan':    'bg-cyan-700    border-cyan-600    text-white',
  'indigo':  'bg-indigo-700  border-indigo-600  text-white',
  'teal':    'bg-teal-700    border-teal-600    text-white',
}

// ─────────────────────────────────────────────────────────────
// STOCK CARD
// ─────────────────────────────────────────────────────────────

function StockCard({ stock }: { stock: StockEntry }) {
  const { requestAnalysis, addToWatchlist, removeFromWatchlist, isWatched } = useApp()
  const watched = isWatched(stock.ticker)

  const handleAnalyze = () => requestAnalysis(stock.ticker)
  const handleWatch   = () => {
    if (watched) removeFromWatchlist(stock.ticker)
    else addToWatchlist({ ticker: stock.ticker, companyName: stock.name })
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 flex flex-col gap-3
                    hover:border-gray-700 transition-colors group">
      {/* Top row */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-white font-mono tracking-tight">
              {stock.ticker}
            </span>
            {stock.marketCap && (
              <span className="text-xs text-gray-600 font-mono">{stock.marketCap}</span>
            )}
          </div>
          <div className="text-xs text-gray-400 mt-0.5 leading-snug">{stock.name}</div>
        </div>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap shrink-0 ${CAT_BADGE[stock.category]}`}>
          {stock.category}
        </span>
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
          className="flex-1 inline-flex h-10 items-center justify-center bg-violet-600/20 hover:bg-violet-600/30
                     text-violet-300 rounded-xl border border-violet-700 hover:border-violet-500 transition-colors"
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

export default function AIStocksPage() {
  const [activeCategory, setActiveCategory] = useState<Category>('All')
  const [search, setSearch] = useState('')
  const { watchlist } = useApp()

  const filtered = STOCKS.filter(s => {
    const matchCat = activeCategory === 'All' || s.category === activeCategory
    const q = search.trim().toLowerCase()
    const matchSearch = !q ||
      s.ticker.toLowerCase().includes(q) ||
      s.name.toLowerCase().includes(q) ||
      s.note.toLowerCase().includes(q)
    return matchCat && matchSearch
  })

  const watchedCount = STOCKS.filter(s => watchlist.some(w => w.ticker === s.ticker)).length

  return (
    <div className="ai-radar-page min-h-screen p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-5">

        {/* Header */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2.5 mb-1">
                <div className="w-9 h-9 rounded-xl bg-violet-600/20 border border-violet-700 flex items-center justify-center">
                  <Bot size={18} className="text-violet-400" />
                </div>
                <h1 className="text-2xl font-bold text-white">AI & Data Center Radar</h1>
              </div>
              <p className="text-sm text-gray-500 max-w-xl">
                Curated universe of AI infrastructure, semiconductor, software, power and data center stocks.
                One click to analyze options or add to your watchlist.
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <div className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-center">
                <div className="text-xl font-bold text-white font-mono">{STOCKS.length}</div>
                <div>stocks</div>
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
              placeholder="Search ticker, name or theme…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl pl-9 pr-4 py-2.5
                         text-white text-sm placeholder-gray-600 focus:outline-none focus:border-violet-500
                         focus:ring-1 focus:ring-violet-500 transition-colors"
            />
          </div>
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
            <div className="text-4xl mb-3">🔍</div>
            <div className="font-semibold">No stocks match "{search}"</div>
            <div className="text-xs mt-1">Try a ticker like NVDA or keyword like "cloud"</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map(stock => (
              <StockCard key={stock.ticker} stock={stock} />
            ))}
          </div>
        )}

        {/* Legend / tip footer */}
        <div className="bg-gray-900/50 border border-gray-800/50 rounded-xl p-4">
          <div className="text-xs text-gray-600 leading-relaxed">
            <span className="text-gray-500 font-semibold">How to use: </span>
            Click <span className="text-violet-400">Analyze</span> to run a full options analysis on any stock.
            Click <span className="text-amber-400">Watch</span> to add to your watchlist for price tracking and periodic refresh.
            Prices shown in the watchlist refresh automatically every 15 minutes after first analysis.
            Market caps are approximate and may not reflect current prices.
          </div>
        </div>

        <div className="text-center text-xs text-gray-600 py-1 border-t border-gray-800/50">
          ⚠️ Curated list for informational purposes only. Not a recommendation to buy or sell. Options trading involves significant risk.
        </div>
      </div>
    </div>
  )
}
