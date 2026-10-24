import { formatEther } from 'viem'
import { config } from './config.js'
import { db } from './db.js'
import { getChainById, type ChainConfig } from './chains.js'
import type { MintEvent } from './tracker/detect.js'
import { wallets } from './tracker/wallets.js'
import { nativePriceUsd } from './pricing/price.js'
import { openseaTokenName } from './executor/opensea.js'
import { makePublicClient } from './executor/wallet.js'
import { executeJob, type JobContext } from './executor/pipeline.js'
import { sendCard, InlineKeyboard } from './notifier/telegram.js'
import { alertCard } from './notifier/messages.js'
import { settings } from './settings.js'

/**
 * Jantung bot: terima MintEvent (poller/webhook), kumpulkan info (tx asal, nama
 * koleksi, harga, USD, cluster), bikin job, kirim alert dengan tombol Review,
 * dan set timeout review (auto-mint = konfirmasi otomatis setelah 10 detik).
 */
export async function handleNewMint(ev: MintEvent): Promise<number | null> {
  if (db.isSeen(ev.chainId, ev.txHash, ev.token, ev.tokenId)) return null
  db.seeMint(ev.chainId, ev.txHash, ev.token, ev.tokenId, ev.minter)

  const chain = getChainById(ev.chainId)
  if (!chain) return null

  let tokenName: string
  let priceUsd: number | null
  let ctx: JobContext

  if (config.mock) {
    tokenName = 'Demo Punks'
    const eth = await nativePriceUsd(chain)
    priceUsd = eth != null ? 0.05 * eth : null
    ctx = {
      tokenName,
      priceUsd,
      originalTx: {
        to: '0x5f0a3b7c9d2e1f4a8b6c0d9e7f3a5b1c8d2e4f6a',
        data:
          '0x40c10f19' +
          '000000000000000000000000' +
          ev.minter.replace(/^0x/, '') +
          '0'.repeat(63) +
          '1',
        value: '50000000000000000',
        from: ev.minter,
      },
      review: { qty: 1, route: 'auto' },
    }
  } else {
    const client = makePublicClient(chain)
    const [txRes, nameRes, priceRes] = await Promise.allSettled([
      client.getTransaction({ hash: ev.txHash as `0x${string}` }),
      readCollectionName(client, ev.token, ev.tokenId, chain),
      nativePriceUsd(chain),
    ])
    if (txRes.status !== 'fulfilled') {
      console.warn(`[mint] skip ${ev.txHash}: tx asal tidak terbaca (${txRes.reason instanceof Error ? txRes.reason.message : txRes.reason})`)
      return null
    }
    const tx = txRes.value
    if (!tx.to) {
      console.warn(`[mint] skip ${ev.txHash}: bukan call kontrak`)
      return null
    }
    tokenName = nameRes.status === 'fulfilled' ? nameRes.value : `Unknown (${ev.token.slice(0, 10)}…)`
    const ethPrice = priceRes.status === 'fulfilled' ? priceRes.value : null
    priceUsd = ethPrice != null ? Number(formatEther(tx.value)) * ethPrice : null
    ctx = {
      tokenName,
      priceUsd,
      originalTx: { to: tx.to, data: tx.input, value: tx.value.toString(), from: tx.from },
      review: { qty: 1, route: 'auto' },
    }
  }

  const priceWei = BigInt(ctx.originalTx.value || '0')
  // cluster = wallet terpantau yang mint koleksi yang sama dalam window
  const heat = db.countRecentMints(ev.chainId, ev.token, config.heatWindowMin * 60_000)
  const clusterMap = new Map<string, { label: string; addr: string; count: number }>()
  for (const [addr, count] of db.recentMinters(ev.chainId, ev.token, config.heatWindowMin * 60_000)) {
    clusterMap.set(addr, {
      label: wallets.labelOf.get(addr) ?? addr.slice(0, 8),
      addr,
      count,
    })
  }

  const jobId = db.createJob({
    chainId: ev.chainId,
    token: ev.token,
    tokenId: ev.tokenId,
    minter: ev.minter,
    priceWei: priceWei.toString(),
    mode: settings.autoMint ? 'auto' : 'confirm',
    context: JSON.stringify(ctx),
  })
  ctx.msgRef = null

  const card = alertCard({
    jobId,
    chain,
    token: ev.token,
    tokenId: ev.tokenId,
    standard: ev.standard,
    minter: ev.minter,
    minterLabel: wallets.labelOf.get(ev.minter) ?? 'wallet',
    txHash: ev.txHash,
    tokenName,
    priceWei,
    priceUsd,
    heat,
    clusterList: [...clusterMap.values()],
  })
  const ref = await sendCard(card)
  if (ref) {
    const j = db.getJob(jobId)
    if (j) {
      ctx.msgRef = ref
      db.updateJob(jobId, j.status, JSON.stringify(ctx), j.mode)
    }
  }

  if (settings.autoMint) {
    // auto-mint tetap lewat review 10 detik (bisa dibatalkan), lalu eksekusi
    setTimeout(() => {
      const j = db.getJob(jobId)
      if (j && j.status === 'pending') void executeJob(jobId)
    }, 10_000).unref()
  } else {
    setTimeout(
      () => {
        const j = db.getJob(jobId)
        if (j && j.status === 'pending') {
          db.updateJob(jobId, 'expired', 'timeout review')
          void sendCard({ text: `⌛ Job #${jobId} expired (tidak direview dalam ${settings.reviewTimeoutSec}s).`, keyboard: new InlineKeyboard() })
        }
      },
      settings.reviewTimeoutSec * 1000,
    ).unref()
  }
  return jobId
}

async function readCollectionName(
  client: ReturnType<typeof makePublicClient>,
  token: string,
  tokenId: string,
  chain: ChainConfig,
): Promise<string> {
  try {
    const res = await client.call({
      to: token as `0x${string}`,
      data: '0x06fdde03' as `0x${string}`, // name()
    })
    const decoded = decodeAbiString(res.data ?? '0x')
    if (decoded) return decoded
  } catch {
    // fallback di bawah
  }
  const os = await openseaTokenName(chain, token, tokenId)
  if (os) return os
  return `Unknown (${token.slice(0, 10)}…)`
}

function decodeAbiString(hex: string): string | null {
  const body = hex.replace(/^0x/, '')
  if (body.length < 128) return null
  try {
    const len = Number(BigInt('0x' + body.slice(64, 128)))
    if (len === 0) return ''
    const raw = body.slice(128, 128 + len * 2)
    return Buffer.from(raw, 'hex').toString('utf8')
  } catch {
    return null
  }
}
