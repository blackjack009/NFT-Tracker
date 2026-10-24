import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { config } from '../config.js'
import type { WalletRegistry } from './wallets.js'
import type { MintEvent } from './detect.js'
import { CHAINS } from '../chains.js'

const ALCHEMY_NETWORK_MAP: Record<string, string> = {
  ETH_MAINNET: 'ethereum',
  BASE_MAINNET: 'base',
  ARB_MAINNET: 'arbitrum',
  OPT_MAINNET: 'optimism',
  MATIC_MAINNET: 'polygon',
  BNB_MAINNET: 'bsc',
  AVAX_MAINNET: 'avalanche',
  BLAST_MAINNET: 'blast',
  LINEA_MAINNET: 'linea',
  SCROLL_MAINNET: 'scroll',
  ZKSYNC_MAINNET: 'zksync',
  ZORA_MAINNET: 'zora',
  MANTLE_MAINNET: 'mantle',
}

/**
 * Receiver webhook Alchemy "Address Activity" (opsional).
 * Set webhook URL-nya ke http://<host>:<WEBHOOK_PORT>/alchemy dan isi ALCHEMY_SIGNING_KEY.
 * Latensi lebih rendah daripada polling, tapi butuh endpoint publik (ngrok/cloudflared).
 * Kalau satu webhook mantau beberapa network, pastikan ALCHEMY_NETWORK_MAP-nya cocok,
 * atau paksa lewat env WEBHOOK_CHAIN=<key chain>.
 */
export function startWebhookServer(
  port: number,
  wallets: WalletRegistry,
  onMint: (ev: MintEvent) => void | Promise<void>,
): void {
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || !req.url?.startsWith('/alchemy')) {
      res.writeHead(404).end()
      return
    }
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      void handleBody(Buffer.concat(chunks), req, res).catch((e) => {
        console.error('[webhook] error:', e)
        res.writeHead(500).end()
      })
    })
  })
  server.listen(port, () => console.log(`[webhook] Alchemy webhook listening di :${port}/alchemy`))

  async function handleBody(body: Buffer, req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (config.alchemySigningKey) {
      const sig = req.headers['x-alchemy-signature']
      const expected = createHmac('sha256', config.alchemySigningKey).update(body).digest('hex')
      const ok =
        typeof sig === 'string' &&
        sig.length === expected.length &&
        timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
      if (!ok) {
        res.writeHead(401).end('bad signature')
        return
      }
    }
    res.writeHead(200).end('ok')

    const payload = JSON.parse(body.toString('utf8')) as {
      network?: string
      event?: { activity?: AlchemyActivity[] }
    }
    const chainKey =
      (payload.network && ALCHEMY_NETWORK_MAP[payload.network]) || process.env.WEBHOOK_CHAIN || ''
    const chain = CHAINS[chainKey]
    if (!chain) {
      console.warn(`[webhook] network tidak dikenali: ${payload.network ?? '(kosong)'} — set WEBHOOK_CHAIN di .env`)
      return
    }
    const tracked = wallets.byChain.get(chain.key) ?? new Set()
    for (const item of payload.event?.activity ?? []) {
      const ev = activityToMintEvent(item, chain.id, chain.key, tracked)
      if (ev) await onMint(ev)
    }
  }
}

interface AlchemyActivity {
  category?: string
  from?: string
  to?: string
  contractAddress?: string
  tokenId?: string
  value?: string
  transaction?: { hash?: string; blockNumber?: string }
  log?: { logIndex?: string | number }
}

function activityToMintEvent(
  item: AlchemyActivity,
  chainId: number,
  chainKey: string,
  tracked: Set<string>,
): MintEvent | null {
  if (!item.category || !['erc721', 'erc1155'].includes(item.category)) return null
  const from = (item.from ?? '').toLowerCase()
  const to = (item.to ?? '').toLowerCase()
  const txHash = item.transaction?.hash
  if (!txHash || from !== '0x0000000000000000000000000000000000000000') return null
  if (!tracked.has(to)) return null
  const quantity = /^\d+$/.test(item.value ?? '') ? BigInt(item.value!) : 1n
  return {
    chainKey,
    chainId,
    token: (item.contractAddress ?? '').toLowerCase(),
    tokenId: item.tokenId ?? '0',
    minter: to,
    txHash,
    blockNumber: BigInt(item.transaction?.blockNumber ?? '0x0'),
    logIndex: Number(item.log?.logIndex ?? 0),
    standard: item.category as 'erc721' | 'erc1155',
    quantity,
  }
}
