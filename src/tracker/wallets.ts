import { readFileSync, existsSync } from 'node:fs'
import { config } from '../config.js'
import type { WalletEntry } from '../db.js'
import { CHAINS } from '../chains.js'

export interface WalletRegistry {
  entries: WalletEntry[]
  /** address (lowercase) yang dimonitor per chain key */
  byChain: Map<string, Set<string>>
  labelOf: Map<string, string>
}

export function loadWallets(): WalletRegistry {
  const entries: WalletEntry[] = []
  const path = config.walletsFile
  if (existsSync(path)) {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as Array<Partial<WalletEntry> & { address?: string }>
      for (const item of raw) {
        const addr = (item.address ?? '').trim()
        if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
          console.warn(`[wallets] skip address tidak valid: ${addr}`)
          continue
        }
        entries.push({
          address: addr.toLowerCase(),
          label: (item.label ?? '').trim() || 'wallet',
          chains: item.chains && item.chains.length > 0 ? item.chains.map((c) => c.toLowerCase()) : ['*'],
        })
      }
    } catch (e) {
      console.error(`[wallets] gagal baca ${path}:`, e)
    }
  }

  const byChain = new Map<string, Set<string>>()
  for (const chain of Object.values(CHAINS)) byChain.set(chain.key, new Set())
  const labelOf = new Map<string, string>()
  for (const w of entries) {
    labelOf.set(w.address, w.label)
    for (const key of byChain.keys()) {
      if (w.chains.includes('*') || w.chains.includes(key)) byChain.get(key)!.add(w.address)
    }
  }
  return { entries, byChain, labelOf }
}

/** Singleton registry — dibaca sekali saat start. */
export const wallets = loadWallets()
