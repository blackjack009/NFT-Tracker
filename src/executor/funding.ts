import { getChain, type ChainConfig } from '../chains.js'
import { config } from '../config.js'
import { keystore } from '../wallets/keystore.js'
import { accountForKey, makePublicClient, withTimeout } from './wallet.js'

export interface FundingSource {
  chain: ChainConfig
  walletId: string
  account: ReturnType<typeof accountForKey>
  balance: bigint
}

/**
 * Cari (wallet, chain) yang sanggup bayar needWei.
 * Prioritas: wallet preferred → chain target mint → saldo terbesar.
 */
export async function pickFunding(mintChain: ChainConfig, needWei: bigint): Promise<FundingSource | null> {
  const wallets = keystore.evm()
  if (wallets.length === 0) return null
  const chains = config.chainsEnabled
    .map((k) => getChain(k))
    .filter((c): c is ChainConfig => !!c)
  if (chains.length === 0) return null

  const checks: Array<{ chain: ChainConfig; walletId: string; account: ReturnType<typeof accountForKey>; balance: bigint }> = []
  await Promise.all(
    wallets.flatMap((w) =>
      chains.map(async (c) => {
        try {
          const client = makePublicClient(c)
          const account = accountForKey(w.key)
          const balance = await withTimeout(client.getBalance({ address: account.address }), 8000)
          checks.push({ chain: c, walletId: w.id, account, balance })
        } catch {
          // chain RPC unreachable — skip
        }
      }),
    ),
  )

  const prefId = keystore.preferred()?.id
  const funded = checks.filter((x) => x.balance >= needWei)
  if (funded.length === 0) return null
  funded.sort((a, b) => {
    const score = (x: typeof a) =>
      (x.walletId === prefId ? 0 : 2) + (x.chain.key === mintChain.key ? 0 : 1)
    if (score(a) !== score(b)) return score(a) - score(b)
    return a.balance > b.balance ? -1 : 1
  })
  return funded[0]
}
