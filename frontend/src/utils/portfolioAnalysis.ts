import type { AnalyzeResponse, TickerCacheEntry } from '../types'

export function normalizePortfolioExpiryIso(exp: string): string {
  const s = exp.trim()
  return (s.includes('T') ? s.slice(0, 10) : s.slice(0, 10)).trim()
}

export function chainExpiryMatchesData(data: AnalyzeResponse, positionExpiry: string): boolean {
  const raw = data.filters_applied?.chain_expiry
  if (typeof raw !== 'string') return false
  return normalizePortfolioExpiryIso(raw) === normalizePortfolioExpiryIso(positionExpiry)
}

/** Prefer explicit portfolio snapshot for this expiry; fall back to primary cache when expiry matches. */
export function resolvePortfolioAnalyzeData(
  cache: TickerCacheEntry | undefined,
  positionExpiry: string,
): AnalyzeResponse | null {
  if (!cache) return null
  const norm = normalizePortfolioExpiryIso(positionExpiry)
  const slice = cache.portfolioByExpiry?.[norm]
  if (slice && chainExpiryMatchesData(slice, positionExpiry)) return slice
  if (cache.data && chainExpiryMatchesData(cache.data, positionExpiry)) return cache.data
  return null
}
