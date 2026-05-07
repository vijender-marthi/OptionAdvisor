import type { AnalyzeResponse, TickerCacheEntry } from '../types'
import { CACHE_TTL_MS, isCacheFresh } from '../types'

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

/**
 * True when cached analysis used for portfolio MTM is within CACHE_TTL_MS.
 * Mirrors `resolvePortfolioAnalyzeData` source order (per-expiry slice vs primary cache).
 */
export function isPortfolioExpiryAnalysisFresh(
  cache: TickerCacheEntry | undefined,
  positionExpiry: string,
): boolean {
  if (!cache) return false
  const norm = normalizePortfolioExpiryIso(positionExpiry)
  const slice = cache.portfolioByExpiry?.[norm]
  if (slice && chainExpiryMatchesData(slice, positionExpiry)) {
    const at = cache.portfolioByExpiryFetchedAt?.[norm]
    if (at == null) return false
    return Date.now() - at < CACHE_TTL_MS
  }
  if (cache.data && chainExpiryMatchesData(cache.data, positionExpiry)) {
    return isCacheFresh(cache)
  }
  return false
}
