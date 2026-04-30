import axios from 'axios'
import type { AnalyzeResponse, PortfolioPosition, StrategyMode, UserDataState, WatchlistItem } from '../types'

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
