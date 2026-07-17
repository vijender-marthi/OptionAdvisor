import { useCallback, useEffect, useState } from 'react'
import { fetchDayTradeWorkspace, type DayTradeWorkspaceQuery, type DayTradeWorkspaceResponse } from '../api/client'

type DayTradeWorkspaceHookState = {
  data: DayTradeWorkspaceResponse | null
  loading: boolean
  error: string
  reload: (options?: { forceRefresh?: boolean }) => Promise<void>
}

export function useDayTradeWorkspace(query: DayTradeWorkspaceQuery | null): DayTradeWorkspaceHookState {
  const [data, setData] = useState<DayTradeWorkspaceResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const symbol = query?.symbol ?? ''
  const sessionDate = query?.sessionDate ?? null
  const interval = query?.interval ?? '1m'
  const forceRefresh = Boolean(query?.forceRefresh)

  const reload = useCallback(async (options: { forceRefresh?: boolean } = {}) => {
    const cleanSymbol = symbol.trim()
    if (!cleanSymbol) {
      setData(null)
      setError('')
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const response = await fetchDayTradeWorkspace({
        symbol: cleanSymbol,
        sessionDate,
        interval,
        forceRefresh: options.forceRefresh ?? forceRefresh,
      })
      setData(response)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to load Day Trade workspace.'
      setData(null)
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [forceRefresh, interval, sessionDate, symbol])

  useEffect(() => {
    let active = true
    const load = async () => {
      const cleanSymbol = symbol.trim()
      if (!cleanSymbol) {
        if (active) {
          setData(null)
          setError('')
          setLoading(false)
        }
        return
      }
      if (active) {
        setLoading(true)
        setError('')
      }
      try {
        const response = await fetchDayTradeWorkspace({
          symbol: cleanSymbol,
          sessionDate,
          interval,
          forceRefresh,
        })
        if (active) setData(response)
      } catch (err) {
        if (active) {
          const message = err instanceof Error ? err.message : 'Unable to load Day Trade workspace.'
          setData(null)
          setError(message)
        }
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [forceRefresh, interval, sessionDate, symbol])

  return { data, loading, error, reload }
}
