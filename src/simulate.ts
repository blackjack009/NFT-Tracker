import { config } from './config.js'
import { db } from './db.js'
import { initTelegram, telegramEnabled, sendCard } from './notifier/telegram.js'
import { registerController, setExecutor } from './notifier/controller.js'
import { handleNewMint } from './orchestrator.js'
import { executeJob } from './executor/pipeline.js'
import { reviewCard } from './notifier/messages.js'
import { getChainById } from './chains.js'
import { parseContext } from './executor/pipeline.js'
import { settings } from './settings.js'

/**
 * Demo end-to-end tanpa API key & tanpa dana:
 *   npm run simulate
 * Alert → (auto-mint ON 10s atau manual via tombol Telegram) → board live → hasil.
 * Tanpa Telegram: alert & review dicetak ke console, eksekusi jalan otomatis.
 */
if (!config.mock) {
  console.error('Jalankan lewat: npm run simulate')
  process.exit(1)
}

const MINTER = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045' // vitalik.eth (demo)
const TOKEN = '0x4b3407f3f3f0d9a0b6c9d2f0c9b7a8e6d5c4b3a2'
const TX = '0x' + 'ab'.repeat(32)

async function main(): Promise<void> {
  console.log('🧪 MULAI SIMULASI — alert + pipeline dipakai yang asli, blockchain dipalsukan\n')
  settings.autoMint = false
  setExecutor(executeJob)
  await initTelegram(registerController)

  if (!telegramEnabled()) {
    console.log('telegram belum diset → notif ke console; auto-review+eksekusi dalam 3 detik\n')
  }

  const jobId = await handleNewMint({
    chainKey: 'base',
    chainId: 8453,
    token: TOKEN,
    tokenId: '7',
    minter: MINTER,
    txHash: TX,
    blockNumber: 25_000_000n,
    logIndex: 0,
    standard: 'erc721',
    quantity: 1n,
  })

  // demo render review card ke console (di Telegram muncul via tombol 🧾 Review)
  if (jobId) {
    const job = db.getJob(jobId)!
    const chain = getChainById(job.chain_id)!
    const ctx = parseContext(job)
    const card = reviewCard({ jobId, ctx, chain, review: ctx.review ?? { qty: 1, route: 'auto' }, fundingNote: 'Dana: wallet demo' })
    await sendCard(card)
  }

  setTimeout(() => {
    if (jobId) void executeJob(jobId)
  }, telegramEnabled() ? 60_000 : 3000)
  setTimeout(() => {
    console.log('\n🧪 simulasi selesai. job terakhir:', JSON.stringify(db.getJob(jobId ?? -1) ?? {}, null, 2))
    process.exit(0)
  }, telegramEnabled() ? 90_000 : 9000)
}

void main()
