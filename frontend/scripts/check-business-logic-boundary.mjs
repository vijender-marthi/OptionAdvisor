import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const srcRoot = path.join(root, 'src')

const BUSINESS_LOGIC_PATTERNS = [
  /\bmaxProfit\b/i,
  /\bmaxLoss\b/i,
  /\bbreakeven\b/i,
  /\bprobability(?:OfProfit|Itm|Otm)?\b/i,
  /\bivRank\b/i,
  /\bgreeks?\b/i,
  /\b(delta|gamma|theta|vega)\b/i,
  /\briskReward\b/i,
  /\bexpectedValue\b/i,
  /\bMath\.(?:abs|max|min|round|floor|ceil|pow|sqrt)\b/,
]

const IGNORED_PREFIXES = [
  'src/api/',
  'src/types/',
  'src/mocks/',
  'src/constants/',
]

const LEGACY_ALLOWED_FILES = new Set([
  'src/components/ActiveTradesPanel.tsx',
  'src/components/CoachSummaryCard.tsx',
  'src/components/ConfidenceWave.tsx',
  'src/components/DayTradeAlertOverlay.tsx',
  'src/components/DayTradeEnginePanel.tsx',
  'src/components/DayTradeIntradayChart.tsx',
  'src/components/DayTradeStrategiesTab.tsx',
  'src/components/DayTradeWalkthrough.tsx',
  'src/components/EarlyEntrySection.tsx',
  'src/components/EntryWindowBanner.tsx',
  'src/components/ExposureBar.tsx',
  'src/components/FirstLoginHelpModal.tsx',
  'src/components/GaugeMeter.tsx',
  'src/components/IntradayReplay.tsx',
  'src/components/MacdHistogramChart.tsx',
  'src/components/MarketOverview.tsx',
  'src/components/MarketStrip.tsx',
  'src/components/MarketTimeGate.tsx',
  'src/components/OptionProfitCalculator.tsx',
  'src/components/OptionsChainTable.tsx',
  'src/components/OptionsEntryCheck.tsx',
  'src/components/OvernightRunnerCard.tsx',
  'src/components/PositionHubCard.tsx',
  'src/components/PositionsDashboardTab.tsx',
  'src/components/PreTradeChecklist.tsx',
  'src/components/PriceChart.tsx',
  'src/components/RecommendationCard.tsx',
  'src/components/ReserveSignalCard.tsx',
  'src/components/RiskGauge.tsx',
  'src/components/RiskThermometer.tsx',
  'src/components/ScalpTradingChart.tsx',
  'src/components/Sidebar.tsx',
  'src/components/SignalRing.tsx',
  'src/components/SparklineCard.tsx',
  'src/components/SwingTradeEnginePanel.tsx',
  'src/components/SwingTradeMetricCharts.tsx',
  'src/components/SwingTradeStrategiesTab.tsx',
  'src/components/SwingTradeWalkthrough.tsx',
  'src/components/TrendDayBanner.tsx',
  'src/components/TrendStrengthBar.tsx',
  'src/components/desk/VerdictTab.tsx',
  'src/contexts/AppContext.tsx',
  'src/layouts/AppLayout.tsx',
  'src/pages/AIStocksPage.tsx',
  'src/pages/AlertsPage.tsx',
  'src/pages/AutoTradePage.tsx',
  'src/pages/BacktestPage.tsx',
  'src/pages/DayTradeAlertsPage.tsx',
  'src/pages/DayTradeBacktestPage.tsx',
  'src/pages/DayTradeDashboardPage.tsx',
  'src/pages/DayTradePage.tsx',
  'src/pages/DayTradeSessionPage.tsx',
  'src/pages/EODJournalPage.tsx',
  'src/pages/HelpPage.tsx',
  'src/pages/InvestmentThesisPage.tsx',
  'src/pages/JournalPage.tsx',
  'src/pages/LandingPage.tsx',
  'src/pages/LoginPage.tsx',
  'src/pages/OptionChainPage.tsx',
  'src/pages/PortfolioPage.tsx',
  'src/pages/PositionsCenter.tsx',
  'src/pages/QRadarPage.tsx',
  'src/pages/SignalFeedPage.tsx',
  'src/pages/SwingTradePage.tsx',
  'src/pages/TickerPage.tsx',
  'src/pages/TickerScannerPage.tsx',
  'src/pages/ToolsPage.tsx',
  'src/pages/TradeCommandCenter.tsx',
  'src/pages/TradeDeskPage.tsx',
  'src/pages/TradeSignalsPage.tsx',
  'src/pages/TradeWorksheetPage.tsx',
  'src/pages/TradingGlossary.tsx',
  'src/pages/UnifiedWatchlistPage.tsx',
  'src/pages/WatchlistPage.tsx',
  'src/utils/fibConfluence.ts',
])

const PRESENTATION_MATH_ALLOWED_FILES = new Set([
  // Chart coordinate conversion only. This file may use Math for SVG pixel
  // scaling, but must not derive trading state or business decisions.
  'src/components/DayTradeWorkspaceChart.tsx',
])

function walk(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walk(full))
    } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

function toRel(file) {
  return path.relative(root, file).split(path.sep).join('/')
}

const violations = []
for (const file of walk(srcRoot)) {
  const rel = toRel(file)
  if (IGNORED_PREFIXES.some(prefix => rel.startsWith(prefix))) continue
  if (LEGACY_ALLOWED_FILES.has(rel)) continue

  const text = fs.readFileSync(file, 'utf8')
  const patterns = PRESENTATION_MATH_ALLOWED_FILES.has(rel)
    ? BUSINESS_LOGIC_PATTERNS.filter(pattern => !/Math\\/.test(pattern.source) && !/Math/.test(pattern.source))
    : BUSINESS_LOGIC_PATTERNS
  const hits = patterns
    .filter(pattern => pattern.test(text))
    .map(pattern => pattern.source)

  if (hits.length > 0) {
    violations.push({ file: rel, hits })
  }
}

if (violations.length > 0) {
  console.error('Frontend business-logic boundary check failed.')
  console.error('Move trading/options/risk calculations to the backend, or explicitly review and add a temporary legacy allowlist entry.')
  for (const violation of violations) {
    console.error(`- ${violation.file}: ${violation.hits.join(', ')}`)
  }
  process.exit(1)
}

console.log('Frontend business-logic boundary check passed.')
