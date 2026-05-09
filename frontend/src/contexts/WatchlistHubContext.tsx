import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react'

export type WatchlistHubTabId = 'options' | 'day' | 'swing'

export type WatchlistHubTabBinding = {
  onRefresh: () => void
  onAdd: () => void
  refreshDisabled: boolean
  refreshBusy: boolean
  addDisabled?: boolean
  /** Strategy: add form expanded */
  addActive?: boolean
  /** Strategy hub toolbar: export CSV */
  onExportCsv?: () => void
}

type WatchlistHubContextValue = {
  bindings: Partial<Record<WatchlistHubTabId, WatchlistHubTabBinding>>
  register: (tab: WatchlistHubTabId, binding: WatchlistHubTabBinding | null) => void
}

const WatchlistHubContext = createContext<WatchlistHubContextValue | null>(null)

export function WatchlistHubProvider({ children }: { children: ReactNode }) {
  const [bindings, setBindings] = useState<Partial<Record<WatchlistHubTabId, WatchlistHubTabBinding>>>({})

  const register = useCallback((tab: WatchlistHubTabId, binding: WatchlistHubTabBinding | null) => {
    setBindings(prev => {
      const next = { ...prev }
      if (binding == null) delete next[tab]
      else next[tab] = binding
      return next
    })
  }, [])

  const value = useMemo(() => ({ bindings, register }), [bindings, register])

  return <WatchlistHubContext.Provider value={value}>{children}</WatchlistHubContext.Provider>
}

export function useWatchlistHubBinding(
  tab: WatchlistHubTabId,
  enabled: boolean,
  binding: WatchlistHubTabBinding,
) {
  const ctx = useContext(WatchlistHubContext)
  const register = ctx?.register
  const { onAdd, onRefresh, refreshDisabled, refreshBusy, addDisabled, addActive, onExportCsv } = binding

  // Depend on `register` (stable useCallback), not `ctx`. The provider recreates the context
  // value object whenever bindings change; including `ctx` in deps re-fired this effect every time
  // and caused register → setState → infinite update / blank page.
  useLayoutEffect(() => {
    if (!register || !enabled) return
    register(tab, { onAdd, onRefresh, refreshDisabled, refreshBusy, addDisabled, addActive, onExportCsv })
    return () => {
      register(tab, null)
    }
  }, [
    register,
    enabled,
    tab,
    onAdd,
    onRefresh,
    refreshDisabled,
    refreshBusy,
    addDisabled,
    addActive,
    onExportCsv,
  ])
}

export function useWatchlistHubBindingsReader() {
  const ctx = useContext(WatchlistHubContext)
  return ctx?.bindings ?? {}
}
