import type { ChainConfig } from '../chains.js'
import { config } from '../config.js'

export function explorerTx(chain: ChainConfig, hash: string): string {
  return `${chain.explorer}/tx/${hash}`
}

export function explorerAddress(chain: ChainConfig, addr: string): string {
  return `${chain.explorer}/address/${addr}`
}

/** OpenSea deep-link; null when the chain has no slug in the registry. */
export function openseaAssetUrl(chain: ChainConfig, token: string, tokenId: string): string | null {
  if (!chain.opensea || !tokenId) return null
  return `https://opensea.io/assets/${chain.opensea}/${token.toLowerCase()}/${tokenId}`
}

export function openseaCollectionUrl(chain: ChainConfig, token: string): string | null {
  if (!chain.opensea) return null
  return `https://opensea.io/collection/${chain.opensea}/${token.toLowerCase()}`
}

export function openseaInventoryUrl(wallet: string): string {
  return `https://opensea.io/${wallet.toLowerCase()}`
}

/** Nama koleksi via OpenSea API v2 (fallback kalau name() di kontrak gagal). */
export async function openseaTokenName(chain: ChainConfig, token: string, tokenId: string): Promise<string | null> {
  if (!config.openseaKey) return null
  const slug = chain.opensea
  if (!slug) return null
  try {
    const res = await fetch(
      `https://api.opensea.io/api/v2/chain/${slug}/contract/${token.toLowerCase()}/nfts/${tokenId}`,
      { headers: { 'x-api-key': config.openseaKey }, signal: AbortSignal.timeout(8000) },
    )
    if (!res.ok) return null
    const json = (await res.json()) as { nft?: { name?: string; collection?: string } }
    return json.nft?.name ?? json.nft?.collection ?? null
  } catch {
    return null
  }
}
