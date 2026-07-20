export type PositionAvailability = 'available' | 'partial' | 'stale' | 'unavailable'
export type PositionWeeksOut = 2 | 4 | 6 | 8
export type PositionStrategyMode = 'all' | string
export type PositionRiskProfile = 'balanced' | string
export type PositionWorkspaceChart = PositionSessionChartResponse['chart']

export interface PositionApiEnvelope<T> {
  data: T | null
  error: string | { code?: string | null; message?: string | null; symbol?: string | null } | null
  stale: boolean
  fetched_at: string | null
}

export interface PositionScannerRow {
  symbol: string | null
  company: string | null
  recommendation: string | null
  position_score: number | null
  pop: number | null
  dte: number | null
  bias: string | null
  trend: string | null
  data_quality: string | null
}

export interface PositionScannerData {
  generated_at: string | null
  last_scan_time: string | null
  availability: PositionAvailability | null
  rows: PositionScannerRow[] | null
}

export interface PositionWorkspaceQuery {
  symbol: string
  weeks_out: PositionWeeksOut
  strategy_mode: PositionStrategyMode
  risk_profile: PositionRiskProfile
}

export interface PositionPayoffPoint {
  price: number | null
  value: number | null
  label?: string | null
}

export interface PositionPayoff {
  points: PositionPayoffPoint[] | null
  x_label?: string | null
  y_label?: string | null
}

export interface PositionHeader {
  symbol: string | null
  company: string | null
  sector?: string | null
  industry?: string | null
  price: number | null
  change: number | null
  change_pct: number | null
  market_cap?: string | null
  volume?: string | number | null
  iv_rank?: number | null
  earnings?: string | null
  market_bias?: string | null
  as_of: string | null
  availability: PositionAvailability | null
}

export interface PositionChartPoint {
  time: string | null
  value: number | null
}

export interface PositionChart {
  title: string | null
  subtitle: string | null
  points: PositionChartPoint[] | null
  x_label: string | null
  y_label: string | null
}

export interface PositionKeyLevel {
  label: string | null
  value: string | number | null
  detail?: string | null
}

export interface PositionMarketStructure {
  title?: string | null
  summary: string | null
  trend: string | null
  bias: string | null
  key_levels: PositionKeyLevel[] | null
  items?: PositionKeyLevel[] | null
  levels?: PositionKeyLevel[] | null
}

export interface PositionDecisionCard {
  title: string | null
  value: string | number | null
  detail: string | null
  status: string | null
}

export interface PositionDecision {
  verdict?: string | null
  recommended_strategy?: string | null
  score?: number | null
  confidence?: string | number | null
  summary?: string | null
  why?: string[] | null
  key_levels?: PositionKeyLevel[] | null
  timeline?: PositionTimelineItem[] | null
  headline: string | null
  detail: string | null
  cards: PositionDecisionCard[] | null
}

export interface PositionLeg {
  action: string | null
  type: string | null
  option_type?: string | null
  strike: number | null
  expiry: string | null
  quantity: number | null
}

export interface PositionExpectation {
  label: string | null
  value: string | number | null
  detail?: string | null
}

export type PositionMetricItem = PositionExpectation

export interface PositionChecklistItem {
  label: string | null
  status: string | null
  detail?: string | null
}

export interface PositionTimelineItem {
  label: string | null
  detail: string | null
  value?: string | null
}

export interface PositionStrategyDetails {
  expiry: string | null
  legs: PositionLeg[] | null
  position_size: string | number | null
  breakeven: string | number | null
  iv_rank: number | null
  payoff: PositionPayoff | null
  payoff_points?: PositionPayoffPoint[] | null
  scenario_range?: { min: number | null; max: number | null; step: number | null; default: number | null } | null
  probability_expectations: PositionExpectation[] | null
  checklist: PositionChecklistItem[] | null
  checklist_items?: PositionChecklistItem[] | null
  timeline: PositionTimelineItem[] | null
  key_levels: PositionKeyLevel[] | null
}

export interface PositionStrategy {
  id: string | null
  rank: number | null
  name: string | null
  direction: string | null
  position_score: number | null
  pop: number | null
  debit_credit: string | number | null
  max_profit: string | number | null
  max_loss: string | number | null
  risk_reward: string | number | null
  dte: number | null
  details: PositionStrategyDetails | null
}

export interface PositionTutorialStep {
  title: string | null
  body: string | null
}

export interface PositionTutorial {
  title: string | null
  summary: string | null
  steps: PositionTutorialStep[] | null
  sections?: PositionTutorialStep[] | null
}

export interface PositionWatchlist {
  symbols: string[] | null
  updated_at: string | null
  is_watched?: boolean
}

export interface PositionWorkspaceData {
  meta: { generated_at?: string | null; availability?: PositionAvailability | null } | null
  header: PositionHeader | null
  chart: PositionWorkspaceChart | null
  market_structure: PositionMarketStructure | null
  decision: PositionDecision | null
  strategies: PositionStrategy[] | null
  selected_strategy_id: string | null
  tutorial: PositionTutorial | null
  watchlist: PositionWatchlist | null
}

export interface PositionScenarioRequest {
  symbol: string
  candidateId: string
  priceMovePct: number
  contracts: number
}

export interface PositionScenarioData {
  title?: string | null
  summary?: string | null
  payoff?: PositionPayoff | null
  values?: PositionExpectation[] | null
}

export type PositionScenarioResponse = PositionScenarioData & Record<string, string | number | boolean | null | PositionPayoff | PositionExpectation[] | undefined>
import type { PositionSessionChartResponse } from '../api/client'
