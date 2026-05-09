/**
 * stockUniverse.ts
 * Shared source-of-truth for the AI/datacenter ticker universe.
 * Used by AIStocksPage (card grid), WatchlistPage (grouping), and TradeSignalsPage (labels).
 */

export type AICategory =
  | 'AI Chips'
  | 'AI Software'
  | 'AI Pure-Play'
  | 'Data Centers'
  | 'AI Power'
  | 'Semicon Equip'
  | 'Optical Networking'
  | 'AI Networking'
  | 'AI Applications'

// Full ticker → AI category map (every ticker in the AI Radar universe)
export const TICKER_CATEGORY_MAP: Record<string, AICategory> = {
  // AI Chips & Hardware
  NVDA: 'AI Chips', AMD: 'AI Chips', AVGO: 'AI Chips', MRVL: 'AI Chips',
  QCOM: 'AI Chips', ARM: 'AI Chips', SMCI: 'AI Chips', INTC: 'AI Chips', MU: 'AI Chips',

  // AI Software & Cloud
  MSFT: 'AI Software', GOOGL: 'AI Software', META: 'AI Software', AMZN: 'AI Software',
  PLTR: 'AI Software', CRM: 'AI Software', NOW: 'AI Software', ORCL: 'AI Software', IBM: 'AI Software',

  // AI Pure-Play / Emerging
  AI: 'AI Pure-Play', SOUN: 'AI Pure-Play', BBAI: 'AI Pure-Play',
  IONQ: 'AI Pure-Play', RGTI: 'AI Pure-Play', UPST: 'AI Pure-Play',

  // Data Centers & Infrastructure
  EQIX: 'Data Centers', DLR: 'Data Centers', IRM: 'Data Centers',
  DELL: 'Data Centers', HPE: 'Data Centers', NTAP: 'Data Centers',
  WDC: 'Data Centers', VRT: 'Data Centers',

  // AI Power & Energy
  VST: 'AI Power', CEG: 'AI Power', NRG: 'AI Power',
  ETR: 'AI Power', PWR: 'AI Power', WATT: 'AI Power',

  // Semiconductor Equipment & Foundry
  ASML: 'Semicon Equip', LRCX: 'Semicon Equip', KLAC: 'Semicon Equip',
  AMAT: 'Semicon Equip', TSM: 'Semicon Equip', TER: 'Semicon Equip',

  // Optical Networking
  COHR: 'Optical Networking', CIEN: 'Optical Networking', LITE: 'Optical Networking',
  VIAV: 'Optical Networking', AAOI: 'Optical Networking', IPGP: 'Optical Networking',

  // AI Networking (Ethernet & switching)
  ANET: 'AI Networking', CSCO: 'AI Networking', INFN: 'AI Networking', JNPR: 'AI Networking',

  // AI Applications
  SNOW: 'AI Applications', DDOG: 'AI Applications', PATH: 'AI Applications',
  CRWD: 'AI Applications', PANW: 'AI Applications', RXRX: 'AI Applications',
}

export const CATEGORY_COLOR: Record<AICategory, string> = {
  'AI Chips':           'blue',
  'AI Software':        'sky',
  'AI Pure-Play':       'emerald',
  'Data Centers':       'amber',
  'AI Power':           'orange',
  'Semicon Equip':      'rose',
  'Optical Networking': 'cyan',
  'AI Networking':      'indigo',
  'AI Applications':    'teal',
}

export const CATEGORY_BADGE: Record<AICategory, string> = {
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

// All categories in display order
export const ALL_CATEGORIES: AICategory[] = [
  'AI Chips', 'AI Software', 'AI Pure-Play', 'Data Centers',
  'AI Power', 'Semicon Equip', 'Optical Networking', 'AI Networking', 'AI Applications',
]

// Target DTE windows for multi-week analysis
export const MULTI_WEEK_TARGETS = [0, 1, 2, 4, 6] as const
export type WeeksOut = typeof MULTI_WEEK_TARGETS[number]
