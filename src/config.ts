import 'dotenv/config'

function int(name: string, def: number): number {
  const v = process.env[name]
  if (!v) return def
  const n = Number(v)
  return Number.isFinite(n) ? Math.floor(n) : def
}

function float(name: string, def: number): number {
  const v = process.env[name]
  if (!v) return def
  const n = Number(v)
  return Number.isFinite(n) ? n : def
}

function rpcOverride(chainKey: string): string | undefined {
  const v = process.env[`RPC_${chainKey.toUpperCase()}`]
  return v && v.trim() ? v.trim() : undefined
}

export const rpcOverrides: Record<string, string> = (() => {
  const out: Record<string, string> = {}
  for (const key of process.env.CHAINS_ENABLED?.split(',') ?? []) {
    const k = key.trim().toLowerCase()
    const o = k ? rpcOverride(k) : undefined
    if (k && o) out[k] = o
  }
  return out
})()

export const config = {
  privateKey: (process.env.PRIVATE_KEY ?? '').trim() as `0x${string}` | '',
  telegramToken: (process.env.TELEGRAM_BOT_TOKEN ?? '').trim(),
  telegramChatId: (process.env.TELEGRAM_CHAT_ID ?? '').trim(),
  alchemyKey: (process.env.ALCHEMY_API_KEY ?? '').trim(),
  openseaKey: (process.env.OPENSEA_API_KEY ?? '').trim(),

  walletsFile: process.env.WALLETS_FILE ?? 'wallets.json',
  chainsEnabled: (process.env.CHAINS_ENABLED ?? 'base,ethereum,arbitrum,optimism,bsc,polygon')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),

  pollIntervalMs: int('POLL_INTERVAL_MS', 6000),
  maxBlockRange: int('MAX_BLOCK_RANGE', 1500),
  maxMintPriceEth: float('MAX_MINT_PRICE_ETH', 0.5),
  confirmTimeoutMs: int('CONFIRM_TIMEOUT_MS', 120_000),
  bridgeBufferPct: float('BRIDGE_BUFFER_PCT', 0.15),
  /** batas selisih harga bridge vs nilai kirim (%); quote ditolak kalau gap lebih besar */
  maxBridgeGapPct: float('MAX_BRIDGE_GAP_PCT', 1.5),
  heatWindowMin: int('HEAT_WINDOW_MIN', 15),

  dataDir: process.env.DATA_DIR ?? 'data',
  mock: process.env.MOCK_MODE === '1',

  relayApi: (process.env.RELAY_API_URL ?? 'https://api.relay.link').replace(/\/$/, ''),

  webhookPort: int('WEBHOOK_PORT', 0),
  alchemySigningKey: (process.env.ALCHEMY_SIGNING_KEY ?? '').trim(),
}
