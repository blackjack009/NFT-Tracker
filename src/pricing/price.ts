import type { ChainConfig } from '../chains.js'

const cache = new Map<string, { price: number | null; at: number }>()
const TTL_MS = 60_000

async function fetchJson(url: string, timeoutMs = 8000): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return res.json()
}

/**
 * Harga native token chain dalam USD.
 * Primary: CoinGecko simple/price. Fallback: DefiLlama. Null kalau dua-duanya gagal
 * (bot tetap jalan, USD tampil "-").
 */
export async function nativePriceUsd(chain: ChainConfig): Promise<number | null> {
  const key = chain.coingeckoId
  if (!key) return null
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.price

  let price: number | null = null
  try {
    const json = (await fetchJson(
      `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(key)}&vs_currencies=usd`,
    )) as Record<string, { usd?: number }>
    price = json[key]?.usd ?? null
  } catch {
    try {
      const json = (await fetchJson(`https://coins.llama.fi/prices/current/coingecko:${encodeURIComponent(key)}`)) as {
        coins?: Record<string, { price?: number }>
      }
      price = json.coins?.[`coingecko:${key}`]?.price ?? null
    } catch {
      price = null
    }
  }
  cache.set(key, { price, at: Date.now() })
  return price
}
