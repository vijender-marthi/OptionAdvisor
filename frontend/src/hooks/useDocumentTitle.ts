import { useEffect } from 'react'

const DEFAULT_TITLE = 'OptionAdvisor Beta · Signals'

export function formatTickerTitle(ticker: string | null | undefined, section: string): string {
  const clean = String(ticker || '').trim().toUpperCase()
  return clean ? `${clean} · ${section} · OptionAdvisor` : `${section} · OptionAdvisor`
}

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    const previous = document.title || DEFAULT_TITLE
    document.title = title || DEFAULT_TITLE
    return () => {
      document.title = previous
    }
  }, [title])
}
