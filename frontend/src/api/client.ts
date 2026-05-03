import axios from 'axios'
import type { AlertEmailItem, AlertEntry, AnalyzeResponse, PortfolioPosition, StrategyMode, UserDataState, WatchlistItem } from '../types'

const api = axios.create({ baseURL: '/api' })

export const analyzeOptions = async (
  ticker: string,
  weeksOut: number,
  spreadWidth?: number | null,
  strategyMode: StrategyMode = 'all',
): Promise<AnalyzeResponse> => {
  const { data } = await api.post<AnalyzeResponse>('/analyze', {
    ticker,
    weeks_out: weeksOut,
    spread_width: spreadWidth ?? null,
    strategy_mode: strategyMode,
  })
  return data
}

export const getUserData = async (email: string): Promise<UserDataState> => {
  const { data } = await api.get<UserDataState>(`/user-data/${encodeURIComponent(email)}`)
  return data
}

export const sendAlertEmail = async (
  email: string,
  userName: string,
  alerts: AlertEntry[],
): Promise<{ sent: boolean; message: string }> => {
  const payload: AlertEmailItem[] = alerts.map(alert => ({
    ticker: alert.ticker,
    company_name: alert.companyName,
    strategy: alert.strategy,
    bias: alert.bias,
    expiry: alert.expiry,
    dte: alert.dte,
    weeks_out: alert.weeksOut,
    score: alert.score,
    max_profit: alert.maxProfit,
    max_loss: alert.maxLoss,
    net_credit: alert.netCredit,
    pop: alert.pop,
    ev: alert.ev,
    time_window: alert.timeWindow,
  }))
  const { data } = await api.post('/send-alert', { email, user_name: userName, alerts: payload })
  return data
}

export const sendTestEmail = async (
  email: string,
  userName?: string,
): Promise<{ sent: boolean; message: string }> => {
  const { data } = await api.post('/test-email', { email, user_name: userName })
  return data
}

export const getEmailStatus = async (): Promise<{
  configured: boolean
  provider: 'sendgrid' | 'smtp' | 'none'
  missing: string[]
  host: string
  port: number
  from: string
  fromName?: string
  envFile: string
  envFileExists: boolean
}> => {
  const { data } = await api.get('/email-status')
  return data
}

export const getAlerts = async (email: string): Promise<AlertEntry[]> => {
  const { data } = await api.get<{ email: string; alerts: AlertEntry[] }>(`/alerts/${encodeURIComponent(email)}`)
  return data.alerts
}

export const scanBackendAlerts = async (email: string): Promise<AlertEntry[]> => {
  const { data } = await api.post<{ email: string; alerts: AlertEntry[] }>(`/alerts/scan/${encodeURIComponent(email)}`)
  return data.alerts
}

export const dismissBackendAlert = async (email: string, alertId: string): Promise<void> => {
  await api.post('/alerts/dismiss', { email, alert_id: alertId })
}

export const clearBackendAlerts = async (email: string): Promise<void> => {
  await api.post('/alerts/clear', { email })
}

export const saveUserData = async (
  email: string,
  watchlist: WatchlistItem[],
  portfolio: PortfolioPosition[],
): Promise<UserDataState> => {
  const { data } = await api.put<UserDataState>(`/user-data/${encodeURIComponent(email)}`, {
    watchlist,
    portfolio,
  })
  return data
}

export const runBacktest = async (params: {
  ticker: string
  start_date: string
  end_date: string
  strategy_mode: string
  weeks_out: number
  spread_width: number | null
}): Promise<import('../types').BacktestResult> => {
  const { data } = await api.post('/backtest', params)
  return data
}

// ─── Trade Journal ─────────────────────────────────────────────────────────

export const saveToJournal = async (email: string, payload: {
  ticker: string; company_name: string; strategy: string; bias: string
  legs: object[]; expiry: string; entry_date: string; dte_at_entry: number
  net_credit: number; max_profit: number; max_loss: number
  underlying_entry: number; prob_of_profit: number; expected_value: number
  total_score: number; notes?: string
}): Promise<{ id: string }> => {
  const { data } = await api.post(`/journal/save?email=${encodeURIComponent(email)}`, payload)
  return data
}

export const getJournal = async (email: string, status = ''): Promise<{ entries: object[] }> => {
  const { data } = await api.get(`/journal/${encodeURIComponent(email)}`, { params: status ? { status } : {} })
  return data
}

export const refreshJournal = async (email: string): Promise<{ entries: object[] }> => {
  const { data } = await api.post(`/journal/refresh/${encodeURIComponent(email)}`)
  return data
}

export const closeJournalEntry = async (
  email: string, id: string, exit_reason = 'MANUAL', notes = ''
): Promise<{ outcome: string; realized_pnl: number }> => {
  const { data } = await api.patch(
    `/journal/${encodeURIComponent(email)}/${id}/close`,
    { exit_reason, notes }
  )
  return data
}

export const updateJournalNotes = async (email: string, id: string, notes: string): Promise<void> => {
  await api.patch(`/journal/${encodeURIComponent(email)}/${id}/notes`, { notes })
}

export const deleteJournalEntry = async (email: string, id: string): Promise<void> => {
  await api.delete(`/journal/${encodeURIComponent(email)}/${id}`)
}
