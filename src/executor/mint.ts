import { formatEther, type Hex, type TransactionReceipt } from 'viem'
import { swapAddressInCalldata } from '../utils/addr.js'
import { shortAddr } from '../utils/format.js'
import { TRANSFER_TOPIC } from '../tracker/detect.js'
import { accountForKey, getWalletClient, makePublicClient, resolveGasFees } from './wallet.js'
import type { Account } from 'viem/accounts'
import type { ChainConfig } from '../chains.js'

const ZERO_PAD = '0x' + '0'.repeat(64)

export interface OriginalTx {
  to: string
  data: string
  value: string
  from: string
}

export type MintResult =
  | { ok: true; txHash: string; tokenId: string }
  | { ok: false; error: string }

/**
 * Mint langsung di chain yang sama: replay calldata mint dari wallet yang kita
 * tiru, ganti address param `to` dengan wallet kita, simulasi dulu, baru kirim.
 * Fees follow the configured gas settings (auto/preset/custom).
 */
export async function directMint(
  chain: ChainConfig,
  orig: OriginalTx,
  minter: string,
  account: Account,
): Promise<MintResult> {
  if (!orig.to || !/^0x[0-9a-fA-F]{40}$/.test(orig.to)) {
    return { ok: false, error: 'tx asal bukan panggilan kontrak yang valid' }
  }
  const client = makePublicClient(chain)
  const wallet = getWalletClient(chain, account)
  const to = orig.to as Hex
  const swap = swapAddressInCalldata(orig.data, minter, account.address)
  const value = BigInt(orig.value || '0')

  const balance = await client.getBalance({ address: account.address })
  const gasPad = value / 20n + 50_000_000_000_000n
  if (balance < value + gasPad) {
    return {
      ok: false,
      error: `saldo ${chain.nativeSymbol} kurang: punya ${Number(formatEther(balance)).toFixed(4)}, butuh ~${Number(formatEther(value + gasPad)).toFixed(4)}`,
    }
  }

  try {
    await client.call({ account: account.address, to, data: swap.data as Hex, value })
  } catch (e) {
    const msg = e instanceof Error ? e.message.split('\n')[0] : String(e)
    return { ok: false, error: `simulasi revert: ${shortAddr(to)} → ${msg.slice(0, 180)}` }
  }

  const fees = await resolveGasFees(client)
  const hash = await wallet.sendTransaction({
    account: account.address,
    to,
    data: swap.data as Hex,
    value,
    gas: 500_000n,
    ...(fees.maxFeePerGas != null
      ? { maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? undefined }
      : { gasPrice: fees.gasPrice }),
  })
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 180_000, confirmations: 1 })
  if (receipt.status !== 'success') {
    return { ok: false, error: 'tx reverted on-chain' }
  }
  return { ok: true, txHash: hash, tokenId: extractMintedTokenId(receipt, orig.to) ?? '' }
}

export function extractMintedTokenId(receipt: TransactionReceipt, token: string): string | null {
  for (const log of receipt.logs) {
    if (!log.topics?.length) continue
    if (log.address.toLowerCase() !== token.toLowerCase()) continue
    if (log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) continue
    if (log.topics.length === 4 && log.topics[1] === ZERO_PAD) {
      return BigInt(log.topics[3]).toString()
    }
    if (log.topics.length === 4 && log.topics[2] === ZERO_PAD) {
      const data = log.data.replace(/^0x/, '')
      return data.length >= 64 ? BigInt('0x' + data.slice(0, 64)).toString() : null
    }
  }
  return null
}

export { accountForKey }
