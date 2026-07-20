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

const TRAP_DETECTION_LOGIC_PATTERNS = [
  /\btrap(?:Score|Detection)\s*[+\-*/]?=/i,
  /\bscore\s*\+=\s*(?:25|20|15|10|5)\b/,
  /\b(?:price|close|high|low)\s*[<>]=?\s*(?:orh|orl|orHigh|orLow|ORH|ORL)\b/,
  /\b(?:orh|orl|orHigh|orLow|ORH|ORL)\s*[<>]=?\s*(?:price|close|high|low)\b/,
  /\bvolume\s*\/\s*(?:avg|average|avgVolume|averageVolume|average20BarVolume)\b/i,
  /\bspyChange(?:Pct)?\s*[<>]=?\s*0\b/i,
  /\bqqqChange(?:Pct)?\s*[<>]=?\s*0\b/i,
  /\bsectorChange(?:Pct)?\s*[<>]=?\s*0\b/i,
  /\bputCallRatio\s*[<>]=?\s*(?:0\.5|1\.5)\b/i,
  /\bbarsSinceBreak\s*[<>]=?\s*6\b/i,
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
  'src/components/DayTradeWorkspaceChart.tsx',
  'src/components/DayTradeWorkspaceShell.tsx',
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
  'src/components/TickerInput.tsx',
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
  'src/pages/DayTradeWorkspacePage.tsx',
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

const SERVER_RENDERING_PREFIXES = [
  'src/components/position/',
]

// These components only render fields returned by /position-trade. Their use of
// canonical API names such as `breakeven` must not be mistaken for a calculation.
const SERVER_POSITION_PRESENTATION_FILES = new Set([
  'src/components/position/PositionDetailRail.tsx',
  'src/components/position/PositionPanels.tsx',
  'src/components/position/PositionScannerRail.tsx',
  'src/components/position/PositionTutorialDrawer.tsx',
  'src/components/position/PositionWorkspaceMain.tsx',
  'src/components/position/ServerPayoffChart.tsx',
  'src/components/position/TutorialDrawer.tsx',
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
const trapViolations = []
for (const file of walk(srcRoot)) {
  const rel = toRel(file)
  if (IGNORED_PREFIXES.some(prefix => rel.startsWith(prefix))) continue

  const text = fs.readFileSync(file, 'utf8')
  const isTrapSurface = /\btrapDetection\b|bull trap|bear trap|trap risk|trap score/i.test(text)
  if (isTrapSurface) {
    const trapHits = TRAP_DETECTION_LOGIC_PATTERNS
      .filter(pattern => pattern.test(text))
      .map(pattern => pattern.source)
    if (trapHits.length > 0) {
      trapViolations.push({ file: rel, hits: trapHits })
    }
  }

  if (LEGACY_ALLOWED_FILES.has(rel) || SERVER_POSITION_PRESENTATION_FILES.has(rel)) continue

  const patterns = PRESENTATION_MATH_ALLOWED_FILES.has(rel) || SERVER_RENDERING_PREFIXES.some(prefix => rel.startsWith(prefix))
    ? BUSINESS_LOGIC_PATTERNS.filter(pattern => !/Math\\/.test(pattern.source) && !/Math/.test(pattern.source))
    : BUSINESS_LOGIC_PATTERNS
  const hits = patterns
    .filter(pattern => pattern.test(text))
    .map(pattern => pattern.source)

  if (hits.length > 0) {
    violations.push({ file: rel, hits })
  }
}

if (trapViolations.length > 0) {
  console.error('Frontend Trap Detection boundary check failed.')
  console.error('Trap Detection scoring, OR comparisons, state machine, and notification logic must stay in backend services.')
  for (const violation of trapViolations) {
    console.error(`- ${violation.file}: ${violation.hits.join(', ')}`)
  }
  process.exit(1)
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
