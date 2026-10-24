import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
} from 'viem'
import { privateKeyToAccount, type Account } from 'viem/accounts'
import { config } from '../config.js'
import { rpcUrls, toViemChain, type ChainConfig } from '../chains.js'
import { keystore } from '../wallets/keystore.js'
import { settings } from '../settings.js'

export function makePublicClient(chain: ChainConfig): PublicClient {
  const urls = rpcUrls(chain, config.alchemyKey)
  return createPublicClient({
    chain: toViemChain(chain, config.alchemyKey),
    transport: http(urls[0], { timeout: 15_000, retryCount: 1 }),
  })
}

/** Return type di-infer supaya chain+account kebawa ke sendTransaction. */
export function getWalletClient(chain: ChainConfig, account: Account) {
  const urls = rpcUrls(chain, config.alchemyKey)
  return createWalletClient({
    account,
    chain: toViemChain(chain, config.alchemyKey),
    transport: http(urls[0], { timeout: 15_000, retryCount: 0 }),
  })
}

/** Account EVM yang dipakai eksekusi: preferred wallet dari keystore. */
export function activeAccount(): Account | null {
  const w = keystore.preferred()
  if (!w || !/^0x[0-9a-f]{64}$/.test(w.key)) return null
  return privateKeyToAccount(w.key as `0x${string}`)
}

export function accountForKey(key: string): Account {
  return privateKeyToAccount(key as `0x${string}`)
}

export async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms`)), ms).unref()),
  ])
}

/** Fee per gas sesuai setting (auto = ikut RPC dengan plafon; preset/custom = nilai manual). */
export async function resolveGasFees(client: PublicClient): Promise<{
  maxFeePerGas?: bigint
  maxPriorityFeePerGas?: bigint
  gasPrice?: bigint
}> {
  const cap = BigInt(Math.round(settings.gwei * 1e9))
  const prioCap = BigInt(Math.round(settings.prioGwei * 1e9))
  if (settings.gasMode !== 'auto') {
    return { maxFeePerGas: cap, maxPriorityFeePerGas: prioCap }
  }
  try {
    const est = await client.estimateFeesPerGas()
    const estMax = est.maxFeePerGas ?? cap
    const estPrio = est.maxPriorityFeePerGas ?? prioCap
    return {
      maxFeePerGas: estMax > cap ? cap : (estMax * 120n) / 100n,
      maxPriorityFeePerGas: estPrio > prioCap ? prioCap : (estPrio * 150n) / 100n,
    }
  } catch {
    // non-EIP1559 chain / RPC without a fee estimate
    return { gasPrice: cap }
  }
}
