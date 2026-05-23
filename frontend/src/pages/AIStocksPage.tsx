import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Star, Check, TrendingUp, Cpu, Cloud, Database, Zap, Wrench, Bot, Search, Cable, Network, LayoutGrid, ScanLine, X, Clock, TrendingDown, AlertTriangle, Minus, Plus, Layers, Loader2 } from 'lucide-react'
import { useApp } from '../contexts/AppContext'
import { addMyTicker, removeMyTicker, fetchMyTickers, searchTickers } from '../api/commandCenter'
import type { MyTickerEntry, SearchTickerResult } from '../api/commandCenter'
import { analyzeSwingTrade } from '../api/client'
import type { SwingTradeScanResult } from '../api/client'
import { computeExecLevels } from '../components/SwingTradeEnginePanel'
import { TICKER_UNIVERSE } from '../data/tickerUniverse'
import type { TickerEntry } from '../data/tickerUniverse'

// ─────────────────────────────────────────────────────────────
// STOCK UNIVERSE — curated AI / Data Center names
// ─────────────────────────────────────────────────────────────

type Category = 'All' | 'AI Chips' | 'AI Software' | 'Data Centers' | 'AI Power' | 'Semicon Equip' | 'AI Pure-Play' | 'Optical Networking' | 'AI Networking' | 'AI Applications' | 'Misc'
type SignalFilter = 'all' | 'buy' | 'bearish' | 'skip'
type TradeStyle = 'swing' | 'position'

interface StockEntry {
  ticker: string
  name: string
  category: Exclude<Category, 'All'>
  note: string
  marketCap?: string
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
  { ticker: 'TER',   name: 'Teradyne',                   category: 'Semicon Equip', marketCap: '$17B',  note: 'Semiconductor test equipment for AI chip validation' },

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
  { id: 'AI Applications',   label: 'AI Applications',    icon: <LayoutGrid size={14} />, color: 'teal',    desc: 'Software platforms and tools powered by or built for AI workloads' },
  { id: 'Misc',              label: 'Misc',               icon: <Layers size={14} />,     color: 'fuchsia', desc: 'Custom tickers you added — any sector' },
]

const CAT_BADGE: Record<Exclude<Category,'All'>, string> = {
  'Misc':               'bg-fuchsia-900/40 text-fuchsia-300 border-fuchsia-800',
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
  'fuchsia': 'bg-fuchsia-700 border-fuchsia-600 text-white',
}

// ─────────────────────────────────────────────────────────────
// SIGNAL LOGIC
// ─────────────────────────────────────────────────────────────

interface SignalInfo {
  label: string
  sublabel: string
  icon: React.ReactNode
  badgeCls: string       // badge background + text
  borderCls: string      // card border accent
  group: SignalFilter    // which filter bucket
}

function getSignalInfo(r: SwingTradeScanResult, style: TradeStyle): SignalInfo {
  const dl = r.decision_label
  const fa = r.final_action
  const bias = r.bias
  const isPosition = style === 'position'

  if (bias === 'long' && (dl === 'QUALITY_LONG' || fa === 'QUALITY_LONG')) {
    return {
      label: 'BUY',
      sublabel: isPosition ? 'Strong setup — hold 2-4 weeks' : 'Strong long setup',
      icon: <TrendingUp size={12} />,
      badgeCls: 'bg-emerald-900/60 text-emerald-300 border-emerald-700',
      borderCls: 'border-emerald-800',
      group: 'buy',
    }
  }
  if (dl === 'BULLISH_WAIT_CONFIRMATION' && bias === 'long') {
    return {
      // Position trades have time to absorb a slower confirmation — treat as a BUY
      label: isPosition ? 'BUY' : 'BUY — Wait',
      sublabel: isPosition ? 'Bullish — time to confirm over weeks' : 'Bullish, needs confirmation',
      icon: <TrendingUp size={12} />,
      badgeCls: 'bg-green-900/50 text-green-300 border-green-700',
      borderCls: 'border-green-800',
      group: 'buy',
    }
  }
  if ((dl === 'BULLISH_BUT_EXTENDED' || fa === 'AVOID_CHASE') && bias === 'long') {
    return {
      // For 2-4 week holds, a brief pullback resolves extension — still watchable
      label: isPosition ? 'WAIT PULLBACK' : 'EXTENDED',
      sublabel: isPosition ? 'Bullish trend — wait for a pullback entry' : 'Already ran — don\'t chase',
      icon: <AlertTriangle size={12} />,
      badgeCls: 'bg-orange-900/50 text-orange-300 border-orange-700',
      borderCls: 'border-orange-800',
      group: isPosition ? 'buy' : 'skip',
    }
  }
  if (dl === 'BULLISH_BUT_EARNINGS_RISK') {
    return {
      label: 'EARNINGS RISK',
      sublabel: isPosition ? 'Bullish long-term, but earnings in the way' : 'Bullish but earnings near',
      icon: <AlertTriangle size={12} />,
      badgeCls: 'bg-purple-900/50 text-purple-300 border-purple-700',
      borderCls: 'border-purple-800',
      group: 'skip',
    }
  }
  if (bias === 'short' || dl.includes('BEARISH') || (r.bear_score > r.bull_score + 2)) {
    return {
      label: 'BEARISH',
      sublabel: 'Short bias — avoid longs',
      icon: <TrendingDown size={12} />,
      badgeCls: 'bg-red-900/50 text-red-300 border-red-700',
      borderCls: 'border-red-800',
      group: 'bearish',
    }
  }
  if (dl === 'WEAK_SETUP') {
    return {
      label: 'WEAK',
      sublabel: 'Low-quality setup',
      icon: <Minus size={12} />,
      badgeCls: 'bg-gray-800 text-gray-400 border-gray-700',
      borderCls: 'border-gray-700',
      group: 'skip',
    }
  }
  if (dl === 'MARKET_CONFIRMATION_ONLY') {
    return {
      label: 'MKT RISK',
      sublabel: 'Market context unfavorable',
      icon: <AlertTriangle size={12} />,
      badgeCls: 'bg-slate-800 text-slate-300 border-slate-700',
      borderCls: 'border-slate-700',
      group: 'skip',
    }
  }
  return {
    label: 'NO SETUP',
    sublabel: 'No actionable trade now',
    icon: <Minus size={12} />,
    badgeCls: 'bg-gray-800 text-gray-500 border-gray-700',
    borderCls: 'border-gray-700',
    group: 'skip',
  }
}

// ─────────────────────────────────────────────────────────────
// POSITION-TRADE LEVELS  (2-4 week hold, wider targets)
// Swing targets use mom×0.5 (T1) and mom×1.0 (T2).
// Position targets scale to mom×2.0 (T1) and mom×3.5 (T2) —
// reflecting the larger expected move over a multi-week hold.
// ─────────────────────────────────────────────────────────────

interface PositionLevels {
  stop:    string | null
  entry:   string | null
  target1: string | null
  target2: string | null
}

function computePositionLevels(r: SwingTradeScanResult): PositionLevels {
  const m = r.metrics as Record<string, unknown>
  const lastPrice = typeof m.last_price === 'number' ? m.last_price : null
  const ma20      = typeof m.ma20 === 'number' ? m.ma20 : null
  const mom5d     = typeof m.momentum_5d_pct === 'number' ? m.momentum_5d_pct : null
  const isBull    = r.bias === 'long'

  if (lastPrice == null) return { stop: null, entry: null, target1: null, target2: null }

  const mom = mom5d != null ? Math.max(Math.abs(mom5d) / 100, 0.025) : 0.05

  if (isBull) {
    const entry = lastPrice * 1.015
    const stop  = ma20 != null ? ma20 * 0.96 : lastPrice * 0.94
    return {
      stop:    `$${stop.toFixed(2)}`,
      entry:   `$${entry.toFixed(2)}`,
      target1: `$${(entry * (1 + mom * 2.0)).toFixed(2)}`,
      target2: `$${(entry * (1 + mom * 3.5)).toFixed(2)}`,
    }
  }

  const entry = lastPrice * 0.985
  const stop  = ma20 != null ? ma20 * 1.04 : lastPrice * 1.06
  return {
    stop:    `$${stop.toFixed(2)}`,
    entry:   `$${entry.toFixed(2)}`,
    target1: `$${(entry * (1 - mom * 2.0)).toFixed(2)}`,
    target2: `$${(entry * (1 - mom * 3.5)).toFixed(2)}`,
  }
}

// ─────────────────────────────────────────────────────────────
// STOCK CARD
// ─────────────────────────────────────────────────────────────

interface StockCardProps {
  stock: StockEntry
  myTickerSet: Set<string>
  onToggleWatch: (ticker: string, name: string, currentlyWatched: boolean) => void
  signal: SwingTradeScanResult | 'loading' | 'error' | null
  tradeStyle: TradeStyle
  onRemoveMisc?: (ticker: string) => void
}

function StockCard({ stock, myTickerSet, onToggleWatch, signal, tradeStyle, onRemoveMisc }: StockCardProps) {
  const { requestAnalysis } = useApp()
  const watched = myTickerSet.has(stock.ticker)

  const handleAnalyze = () => requestAnalysis(stock.ticker)
  const handleWatch   = () => onToggleWatch(stock.ticker, stock.name, watched)

  const signalInfo = signal && signal !== 'loading' && signal !== 'error'
    ? getSignalInfo(signal, tradeStyle)
    : null

  const swingLevels = signal && signal !== 'loading' && signal !== 'error' && tradeStyle === 'swing'
    && signalInfo?.group !== 'bearish'
    ? computeExecLevels(signal, signal.metrics as Record<string, unknown>)
    : null

  const positionLevels = signal && signal !== 'loading' && signal !== 'error' && tradeStyle === 'position'
    && signalInfo?.group !== 'bearish'
    ? computePositionLevels(signal)
    : null

  const lastPrice = signal && signal !== 'loading' && signal !== 'error'
    ? (signal.metrics as Record<string, unknown>).last_price
    : null

  const cardBorder = signalInfo
    ? `border ${signalInfo.borderCls}`
    : 'border border-gray-800'

  return (
    <div className={`bg-gray-900 rounded-2xl p-4 flex flex-col gap-3 hover:brightness-110 transition-all group ${cardBorder}`}>
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
            {typeof lastPrice === 'number' && (
              <span className="text-xs text-gray-400 font-mono">${(lastPrice as number).toFixed(2)}</span>
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

      {/* Signal panel — shown when scan has run */}
      {signal === 'loading' && (
        <div className="rounded-xl bg-gray-800/60 border border-gray-700 px-3 py-2 flex items-center gap-2">
          <div className="w-3 h-3 rounded-full border-2 border-violet-500 border-t-transparent animate-spin shrink-0" />
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
          {/* Action + hold */}
          <div className="flex items-center justify-between gap-2">
            <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-lg border ${signalInfo.badgeCls}`}>
              {signalInfo.icon}
              {signalInfo.label}
            </span>
            <span className="flex items-center gap-1 text-[10px] text-gray-500">
              <Clock size={10} />
              {tradeStyle === 'position' ? '2–4 weeks' : (
                signal && signal !== 'loading' && signal !== 'error' && signal.expected_holding_period
                  ? signal.expected_holding_period
                  : '3–5 days'
              )}
            </span>
          </div>
          <p className="text-[10px] text-gray-500 leading-tight">{signalInfo.sublabel}</p>

          {/* Swing levels */}
          {swingLevels && (swingLevels.riskBelow || swingLevels.firstTarget) && (
            <div className="flex gap-3 pt-0.5">
              {swingLevels.riskBelow && (
                <div className="flex flex-col">
                  <span className="text-[9px] text-gray-600 uppercase tracking-wide">Stop</span>
                  <span className="text-[11px] font-mono text-red-400">{swingLevels.riskBelow}</span>
                </div>
              )}
              {swingLevels.breakoutTrigger && (
                <div className="flex flex-col">
                  <span className="text-[9px] text-gray-600 uppercase tracking-wide">Trigger</span>
                  <span className="text-[11px] font-mono text-gray-300">{swingLevels.breakoutTrigger}</span>
                </div>
              )}
              {swingLevels.firstTarget && (
                <div className="flex flex-col">
                  <span className="text-[9px] text-gray-600 uppercase tracking-wide">Target 1</span>
                  <span className="text-[11px] font-mono text-emerald-400">{swingLevels.firstTarget}</span>
                </div>
              )}
              {swingLevels.stretchTarget && (
                <div className="flex flex-col">
                  <span className="text-[9px] text-gray-600 uppercase tracking-wide">Target 2</span>
                  <span className="text-[11px] font-mono text-emerald-300">{swingLevels.stretchTarget}</span>
                </div>
              )}
            </div>
          )}

          {/* Position levels — wider targets for 2-4 week hold */}
          {positionLevels && (positionLevels.stop || positionLevels.target1) && (
            <div className="flex gap-3 pt-0.5">
              {positionLevels.stop && (
                <div className="flex flex-col">
                  <span className="text-[9px] text-gray-600 uppercase tracking-wide">Stop</span>
                  <span className="text-[11px] font-mono text-red-400">{positionLevels.stop}</span>
                </div>
              )}
              {positionLevels.entry && (
                <div className="flex flex-col">
                  <span className="text-[9px] text-gray-600 uppercase tracking-wide">Entry</span>
                  <span className="text-[11px] font-mono text-gray-300">{positionLevels.entry}</span>
                </div>
              )}
              {positionLevels.target1 && (
                <div className="flex flex-col">
                  <span className="text-[9px] text-gray-600 uppercase tracking-wide">Target 1</span>
                  <span className="text-[11px] font-mono text-emerald-400">{positionLevels.target1}</span>
                </div>
              )}
              {positionLevels.target2 && (
                <div className="flex flex-col">
                  <span className="text-[9px] text-gray-600 uppercase tracking-wide">Target 2</span>
                  <span className="text-[11px] font-mono text-emerald-300">{positionLevels.target2}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

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
        {onRemoveMisc && (
          <button
            type="button"
            onClick={() => onRemoveMisc(stock.ticker)}
            aria-label={`Remove ${stock.ticker} from Misc`}
            title="Remove from Misc list"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gray-700
                       bg-gray-800 text-gray-500 hover:border-red-700 hover:text-red-400 hover:bg-red-900/20 transition-all"
          >
            <X size={16} />
          </button>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────

const BATCH_SIZE = 5

export default function AIStocksPage() {
  const [activeCategory, setActiveCategory] = useState<Category>('All')
  const [search, setSearch] = useState('')
  const [myTickers, setMyTickers] = useState<MyTickerEntry[]>([])
  const [signalFilter, setSignalFilter] = useState<SignalFilter>('all')
  const [tradeStyle, setTradeStyle] = useState<TradeStyle>('swing')

  // Misc custom tickers — persisted in localStorage
  const [miscStocks, setMiscStocks] = useState<StockEntry[]>(() => {
    try { return JSON.parse(localStorage.getItem('ai_stocks_misc') ?? '[]') } catch { return [] }
  })
  const [showAddForm, setShowAddForm] = useState(false)
  const [addQuery, setAddQuery]       = useState('')
  const [addName, setAddName]         = useState('')
  const [addNote, setAddNote]         = useState('')
  const [addError, setAddError]       = useState('')
  const [addSelected, setAddSelected] = useState<{ symbol: string; company: string } | null>(null)
  const [remoteResults, setRemoteResults] = useState<SearchTickerResult[]>([])
  const [remoteLoading, setRemoteLoading] = useState(false)
  const remoteIdRef = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // scan state
  const [scanResults, setScanResults] = useState<Map<string, SwingTradeScanResult | 'loading' | 'error'>>(new Map())
  const [scanning, setScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState<{ done: number; total: number } | null>(null)
  const scanAbortRef = useRef(false)

  const { watchlist } = useApp()

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

  // ── misc ticker management ───────────────────────────────────
  const allStocks: StockEntry[] = useMemo(() => [...STOCKS, ...miscStocks], [miscStocks])

  const handleAddMisc = useCallback(() => {
    const sym = (addSelected?.symbol || addQuery.trim()).toUpperCase()
    if (!sym) { setAddError('Ticker is required'); return }
    if (allStocks.some(s => s.ticker === sym)) { setAddError(`${sym} is already in the list`); return }
    const entry: StockEntry = {
      ticker: sym,
      name:   addName.trim() || addSelected?.company || sym,
      note:   addNote.trim() || 'Custom ticker',
      category: 'Misc',
    }
    const updated = [...miscStocks, entry]
    setMiscStocks(updated)
    localStorage.setItem('ai_stocks_misc', JSON.stringify(updated))
    setAddQuery(''); setAddName(''); setAddNote(''); setAddError(''); setAddSelected(null); setShowAddForm(false)
    setActiveCategory('Misc')
  }, [addSelected, addQuery, addName, addNote, allStocks, miscStocks])

  const handleRemoveMisc = useCallback((ticker: string) => {
    const updated = miscStocks.filter(s => s.ticker !== ticker)
    setMiscStocks(updated)
    localStorage.setItem('ai_stocks_misc', JSON.stringify(updated))
  }, [miscStocks])

  // Misc search — local TICKER_UNIVERSE + remote fallback
  const localResults = useMemo(() => {
    if (!addQuery.trim()) return []
    const q = addQuery.trim().toLowerCase()
    return TICKER_UNIVERSE.filter(
      e => e.symbol.toLowerCase().includes(q) || e.company.toLowerCase().includes(q)
    ).slice(0, 30)
  }, [addQuery])

  useEffect(() => {
    if (!addQuery.trim() || localResults.length > 0) {
      setRemoteResults([])
      setRemoteLoading(false)
      return
    }
    setRemoteLoading(true)
    const id = ++remoteIdRef.current
    const timer = setTimeout(async () => {
      try {
        const env = await searchTickers(addQuery.trim())
        if (id === remoteIdRef.current) setRemoteResults(env.data?.results ?? [])
      } catch {
        if (id === remoteIdRef.current) setRemoteResults([])
      } finally {
        if (id === remoteIdRef.current) setRemoteLoading(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [addQuery, localResults.length])

  const allSearchResults = useMemo(() => {
    if (!addQuery.trim()) return []
    const seen = new Set(localResults.map(r => r.symbol.toUpperCase()))
    const remote = remoteResults.filter(r => !seen.has(r.symbol.toUpperCase()))
    return [...localResults, ...remote]
  }, [localResults, remoteResults, addQuery])

  // ── scan all visible stocks in batches ──────────────────────
  const handleScan = useCallback(async () => {
    if (scanning) return
    scanAbortRef.current = false

    const tickers = allStocks.map(s => s.ticker)
    const total = tickers.length

    // mark all as loading
    setScanResults(prev => {
      const next = new Map(prev)
      tickers.forEach(t => next.set(t, 'loading'))
      return next
    })
    setScanning(true)
    setScanProgress({ done: 0, total })

    let done = 0
    for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
      if (scanAbortRef.current) break
      const batch = tickers.slice(i, i + BATCH_SIZE)
      await Promise.allSettled(
        batch.map(async ticker => {
          try {
            const result = await analyzeSwingTrade(ticker)
            setScanResults(prev => new Map(prev).set(ticker, result))
          } catch {
            setScanResults(prev => new Map(prev).set(ticker, 'error'))
          }
          done++
          setScanProgress({ done, total })
        })
      )
    }

    setScanning(false)
  }, [scanning])

  const handleClearScan = useCallback(() => {
    scanAbortRef.current = true
    setScanResults(new Map())
    setScanning(false)
    setScanProgress(null)
    setSignalFilter('all')
  }, [])

  const hasScanResults = scanResults.size > 0
  const scanDone = hasScanResults && !scanning

  // ── filter ──────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return allStocks.filter(s => {
      const matchCat = activeCategory === 'All' || s.category === activeCategory
      const q = search.trim().toLowerCase()
      const matchSearch = !q ||
        s.ticker.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.note.toLowerCase().includes(q)

      if (!matchCat || !matchSearch) return false

      if (signalFilter === 'all' || !scanDone) return true

      const res = scanResults.get(s.ticker)
      if (!res || res === 'loading' || res === 'error') return false
      return getSignalInfo(res, tradeStyle).group === signalFilter
    })
  }, [activeCategory, search, signalFilter, scanResults, scanDone, allStocks])

  const watchedCount = allStocks.filter(s => myTickerSet.has(s.ticker)).length

  // counts for signal filter badges — recalculate when tradeStyle changes
  const signalCounts = useMemo(() => {
    if (!scanDone) return { buy: 0, bearish: 0, skip: 0 }
    let buy = 0, bearish = 0, skip = 0
    for (const [, res] of scanResults) {
      if (!res || res === 'loading' || res === 'error') continue
      const g = getSignalInfo(res, tradeStyle).group
      if (g === 'buy') buy++
      else if (g === 'bearish') bearish++
      else skip++
    }
    return { buy, bearish, skip }
  }, [scanResults, scanDone, tradeStyle])

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
                <h1 className="tcc-hero-title text-2xl font-bold tracking-tight text-heading">AI &amp; Core Stocks</h1>
              </div>
              <p className="text-sm text-gray-500 max-w-xl">
                Curated universe of AI infrastructure stocks. Scan for live buy/sell signals — powered by the Swing Trade engine.
              </p>
            </div>

            {/* Stats + Scan button */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <div className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-center">
                  <div className="text-xl font-bold text-white font-mono">{allStocks.length}</div>
                  <div>stocks</div>
                </div>
                <div className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-center">
                  <div className="text-xl font-bold text-amber-400 font-mono">{watchedCount}</div>
                  <div>watching</div>
                </div>
              </div>

              {/* Trade style toggle */}
              <div className="flex items-center bg-gray-800 border border-gray-700 rounded-xl p-0.5 gap-0.5">
                <button
                  type="button"
                  onClick={() => setTradeStyle('swing')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    tradeStyle === 'swing'
                      ? 'bg-violet-600 text-white'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  3–5 Days
                </button>
                <button
                  type="button"
                  onClick={() => setTradeStyle('position')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    tradeStyle === 'position'
                      ? 'bg-violet-600 text-white'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  2–4 Weeks
                </button>
              </div>

              {/* Scan button */}
              {!hasScanResults ? (
                <button
                  type="button"
                  onClick={handleScan}
                  disabled={scanning}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500
                             disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold
                             border border-violet-500 transition-colors"
                >
                  <ScanLine size={16} />
                  Scan Signals
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleClearScan}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gray-800 hover:bg-gray-700
                             text-gray-400 text-xs border border-gray-700 transition-colors"
                >
                  <X size={13} />
                  Clear scan
                </button>
              )}
            </div>
          </div>

          {/* Scan progress bar */}
          {scanning && scanProgress && (
            <div className="mt-4">
              <div className="flex justify-between text-xs text-gray-500 mb-1.5">
                <span>Scanning stocks…</span>
                <span className="font-mono">{scanProgress.done} / {scanProgress.total}</span>
              </div>
              <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-violet-500 rounded-full transition-all duration-300"
                  style={{ width: `${(scanProgress.done / scanProgress.total) * 100}%` }}
                />
              </div>
            </div>
          )}

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

        {/* Signal filter — only shown after scan */}
        {scanDone && (
          <div className="flex gap-2 flex-wrap items-center">
            <span className="text-xs text-gray-600 mr-1">Signal:</span>
            {([
              { id: 'all',     label: 'All',      count: allStocks.length, cls: 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600' },
              { id: 'buy',     label: 'Buy',      count: signalCounts.buy,     cls: 'bg-emerald-900/30 border-emerald-800 text-emerald-300 hover:border-emerald-600' },
              { id: 'bearish', label: 'Bearish',  count: signalCounts.bearish, cls: 'bg-red-900/30 border-red-800 text-red-300 hover:border-red-600' },
              { id: 'skip',    label: 'Skip / Wait', count: signalCounts.skip, cls: 'bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-600' },
            ] as const).map(f => (
              <button
                key={f.id}
                onClick={() => setSignalFilter(f.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all
                  ${signalFilter === f.id ? 'ring-1 ring-offset-1 ring-offset-gray-950 ring-white/20 brightness-125' : ''}
                  ${f.cls}`}
              >
                {f.label}
                <span className="font-mono opacity-70">{f.count}</span>
              </button>
            ))}
          </div>
        )}

        {/* Add Ticker panel — shown when Misc is active */}
        {activeCategory === 'Misc' && (
          <div className="bg-gray-900 border border-fuchsia-900/50 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers size={14} className="text-fuchsia-400" />
                <span className="text-sm font-semibold text-white">Misc — Custom Tickers</span>
                <span className="text-xs text-gray-500">({miscStocks.length} added)</span>
              </div>
              <button
                type="button"
                onClick={() => { setShowAddForm(v => !v); setAddError('') }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-fuchsia-700/20 hover:bg-fuchsia-700/30
                           text-fuchsia-300 text-xs font-semibold border border-fuchsia-800 hover:border-fuchsia-600 transition-colors"
              >
                <Plus size={13} />
                Add Ticker
              </button>
            </div>

            {showAddForm && (
              <div className="bg-gray-800/60 border border-fuchsia-900/40 rounded-xl p-4 space-y-3">
                {!addSelected ? (
                  <>
                    <label className="text-[10px] text-gray-500 uppercase tracking-wide mb-1 block">Search ticker</label>
                    <input
                      ref={inputRef}
                      type="text"
                      placeholder="Search by symbol or company name..."
                      value={addQuery}
                      onChange={e => { setAddQuery(e.target.value); setAddError('') }}
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white
                                 placeholder-gray-600 focus:outline-none focus:border-fuchsia-500"
                    />
                    {addError && <p className="text-xs text-red-400">{addError}</p>}
                    {allSearchResults.length > 0 && (
                      <div className="max-h-48 space-y-1 overflow-y-auto">
                        {allSearchResults.map(entry => (
                          <button key={entry.symbol} type="button"
                            onClick={() => {
                              setAddSelected({ symbol: entry.symbol, company: entry.company })
                              setAddName(entry.company)
                              setAddQuery(entry.symbol)
                              setAddError('')
                            }}
                            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-gray-800 transition-colors"
                          >
                            <span className="text-sm font-semibold text-white">{entry.symbol}</span>
                            <span className="text-xs text-gray-500 truncate">{entry.company}</span>
                            {'sector' in entry && <span className="ml-auto text-[10px] text-gray-600 shrink-0">{(entry as TickerEntry).sector || ''}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                    {remoteLoading && (
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <Loader2 size={12} className="animate-spin" />
                        Searching Yahoo Finance...
                      </div>
                    )}
                    {addQuery.trim() && !remoteLoading && allSearchResults.length === 0 && (
                      <p className="text-xs text-gray-500">No results for '{addQuery.trim()}'</p>
                    )}
                    <div className="flex gap-2 pt-1">
                      <button type="button" onClick={() => { setShowAddForm(false); setAddError(''); setAddSelected(null); setAddQuery('') }}
                        className="px-4 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs border border-gray-700 transition-colors">
                        Cancel
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-3 rounded-lg bg-gray-800/60 px-3 py-2">
                      <span className="text-sm font-semibold text-white">{addSelected.symbol}</span>
                      <span className="text-xs text-gray-500 truncate">{addSelected.company}</span>
                      <button type="button" onClick={() => { setAddSelected(null); setAddQuery('') }}
                        className="ml-auto text-gray-500 hover:text-gray-300">
                        <X size={14} />
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] text-gray-500 uppercase tracking-wide mb-1 block">Note (optional)</label>
                        <input type="text" placeholder="Why you're watching this"
                          value={addNote} onChange={e => setAddNote(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleAddMisc()}
                          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white
                                     placeholder-gray-600 focus:outline-none focus:border-fuchsia-500" />
                      </div>
                    </div>
                    {addError && <p className="text-xs text-red-400">{addError}</p>}
                    <div className="flex gap-2">
                      <button type="button" onClick={handleAddMisc}
                        className="px-4 py-2 rounded-xl bg-fuchsia-700 hover:bg-fuchsia-600 text-white text-xs font-semibold border border-fuchsia-600 transition-colors">
                        Add to Misc
                      </button>
                      <button type="button" onClick={() => { setShowAddForm(false); setAddError(''); setAddSelected(null); setAddQuery('') }}
                        className="px-4 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs border border-gray-700 transition-colors">
                        Cancel
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {miscStocks.length === 0 && !showAddForm && (
              <p className="text-xs text-gray-600">No custom tickers yet. Click <span className="text-fuchsia-400">Add Ticker</span> to add any stock you want to track and scan.</p>
            )}
          </div>
        )}

        {/* Category filter pills */}
        <div className="flex gap-2 flex-wrap">
          {CATEGORIES.map(cat => {
            const count = cat.id === 'All' ? allStocks.length : allStocks.filter(s => s.category === cat.id).length
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
            <div className="font-semibold">
              {signalFilter !== 'all' && scanDone
                ? `No ${signalFilter === 'buy' ? 'buy' : signalFilter === 'bearish' ? 'bearish' : 'skip/wait'} signals in this view`
                : `No stocks match "${search}"`}
            </div>
            <div className="text-xs mt-1">
              {signalFilter !== 'all' && scanDone
                ? 'Try a different filter or category'
                : 'Try a ticker like NVDA or keyword like "cloud"'}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map(stock => (
              <StockCard
                key={stock.ticker}
                stock={stock}
                myTickerSet={myTickerSet}
                onToggleWatch={handleToggleWatch}
                signal={scanResults.get(stock.ticker) ?? null}
                tradeStyle={tradeStyle}
                onRemoveMisc={stock.category === 'Misc' ? handleRemoveMisc : undefined}
              />
            ))}
          </div>
        )}

        {/* Legend / tip footer */}
        <div className="bg-gray-900/50 border border-gray-800/50 rounded-xl p-4">
          <div className="text-xs text-gray-600 leading-relaxed">
            <span className="text-gray-500 font-semibold">How to use: </span>
            Click <span className="text-violet-400">Scan Signals</span> to run the Swing Trade engine across all stocks and get buy/sell suggestions with hold period and price levels.
            Click <span className="text-violet-400">Analyze</span> to open a full options analysis.
            Click <span className="text-amber-400">Watch</span> to add to your watchlist.
            Signals reflect daily chart structure — swing trade timeframe (3–5 trading days).
          </div>
        </div>

        <div className="text-center text-xs text-gray-600 py-1 border-t border-gray-800/50">
          ⚠️ Signals are for informational purposes only. Not a recommendation to buy or sell. Trading involves significant risk.
        </div>
      </div>
    </div>
  )
}
