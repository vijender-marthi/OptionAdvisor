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
  const { data } = await api.post('/send-alert', { email, alerts: payload })
  return data
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
