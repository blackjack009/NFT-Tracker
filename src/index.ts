import { config } from './config.js'
import { getChain } from './chains.js'
import { wallets } from './tracker/wallets.js'
import { ChainPoller } from './tracker/poller.js'
import { startWebhookServer } from './tracker/webhook.js'
import { initTelegram } from './notifier/telegram.js'
import { registerController, setExecutor } from './notifier/controller.js'
import { handleNewMint } from './orchestrator.js'
import { executeJob } from './executor/pipeline.js'
import { keystore } from './wallets/keystore.js'
import { settings } from './settings.js'

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════')
  console.log('  NFT Sniper Bot — beta (EVM only)')
  console.log('═══════════════════════════════════════════════')
  console.log(`mode         : ${config.mock ? 'MOCK (simulate)' : 'LIVE'}`)
  console.log(`wallet bot   : ${keystore.evm().length} EVM · ${keystore.list().filter((w) => w.type === 'SOL').length} SOL · preferred ${keystore.preferred()?.id ?? '—'}`)
  if (keystore.preferred()) console.log(`             → ${keystore.preferred()!.address}`)
  console.log(`chain aktif  : ${config.chainsEnabled.join(', ')}`)
  console.log(`auto-mint    : ${settings.autoMint ? 'ON (review 10s)' : 'OFF'} · gas ${settings.gasMode}/${settings.gwei} gwei · cap ${settings.maxPriceEth} ETH · gap ${settings.gapPct}% · budget ${settings.budgetEth} ETH`)

  console.log(`monitor      : ${wallets.entries.length} wallet cluster`)
  if (wallets.entries.length === 0) {
    console.warn('[!] wallets.json kosong — copy wallets.example.json, isi address cluster.')
  }
  if (keystore.evm().length === 0) {
    console.warn('[!] Belum ada wallet EVM — /start → Wallet → Create/Import (mode alert tetap jalan).')
  }

  setExecutor(executeJob)
  await initTelegram(registerController)

  for (const key of config.chainsEnabled) {
    const chain = getChain(key)
    if (!chain) {
      console.warn(`[!] chain "${key}" tidak ada di registry — skip (lihat src/chains.ts)`)
      continue
    }
    new ChainPoller(chain, wallets, (ev) => {
      void handleNewMint(ev).catch((e) => console.error('[orchestrator]', e))
    }).start()
  }

  if (config.webhookPort > 0) {
    startWebhookServer(config.webhookPort, wallets, (ev) => {
      void handleNewMint(ev).catch((e) => console.error('[orchestrator]', e))
    })
  }

  if (!config.alchemyKey && !config.mock) {
    console.warn('[!] ALCHEMY_API_KEY kosong — jalan pakai public RPC. Kalau banyak "tick error", daftar key gratis di alchemy.com')
  }

  process.on('SIGINT', () => {
    console.log('\nbye 👋')
    process.exit(0)
  })
}

void main()
