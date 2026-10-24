import { createPublicClient, http, toHex, type LogTopic, type PublicClient } from 'viem'
import type { ChainConfig } from '../chains.js'
import { toViemChain, rpcUrls } from '../chains.js'
import { config } from '../config.js'
import type { WalletRegistry } from './wallets.js'
import { parseMintLog, getLogsTopics, type MintEvent, type RawLog } from './detect.js'

/**
 * Poller per chain: scan ERC721/ERC1155 Transfer dengan from = zero address
 * (== mint) tiap beberapa detik, lalu filter ke wallet yang dimonitor.
 * Bekerja di semua EVM RPC karena pakai eth_getLogs standar.
 */
export class ChainPoller {
  private client: PublicClient
  private rpcIndex = 0
  private consecutiveErrors = 0
  private stopped = false
  private lastBlock?: bigint

  constructor(
    public readonly chain: ChainConfig,
    private readonly wallets: WalletRegistry,
    private readonly onMint: (ev: MintEvent) => void | Promise<void>,
  ) {
    this.client = this.makeClient()
  }

  private makeClient(): PublicClient {
    const urls = rpcUrls(this.chain, config.alchemyKey)
    const url = urls[this.rpcIndex % urls.length]
    return createPublicClient({
      chain: toViemChain(this.chain, config.alchemyKey),
      transport: http(url, { timeout: 15_000, retryCount: 0 }),
    })
  }

  start(): void {
    const jitter = Math.floor(Math.random() * 1500)
    const loop = async () => {
      if (this.stopped) return
      try {
        await this.tick()
        this.consecutiveErrors = 0
      } catch (e) {
        this.consecutiveErrors++
        if (this.consecutiveErrors >= 3) {
          const urls = rpcUrls(this.chain, config.alchemyKey)
          this.rpcIndex = (this.rpcIndex + 1) % urls.length
          this.client = this.makeClient()
          this.consecutiveErrors = 0
          console.warn(`[poller:${this.chain.key}] rotasi RPC → ${urls[this.rpcIndex]}`)
        }
        console.warn(`[poller:${this.chain.key}] tick error:`, e instanceof Error ? e.message : e)
      }
      setTimeout(loop, config.pollIntervalMs + jitter).unref()
    }
    void loop()
    console.log(`[poller:${this.chain.key}] aktif, interval ${config.pollIntervalMs}ms`)
  }

  stop(): void {
    this.stopped = true
  }

  private async tick(): Promise<void> {
    const latest = await this.client.getBlockNumber()
    if (this.lastBlock === undefined) {
      this.lastBlock = latest > 3n ? latest - 3n : latest
      return
    }
    const from = this.lastBlock + 1n
    if (from > latest) return
    const to = from + BigInt(config.maxBlockRange) < latest ? from + BigInt(config.maxBlockRange) : latest

    const logs = await this.fetchMintLogs(from, to)
    const tracked = this.wallets.byChain.get(this.chain.key) ?? new Set()
    for (const log of logs) {
      const ev = parseMintLog(this.chain, log)
      if (!ev) continue
      if (!tracked.has(ev.minter)) continue
      await this.onMint(ev)
    }
    this.lastBlock = to
  }

  private async fetchMintLogs(from: bigint, to: bigint): Promise<RawLog[]> {
    const range = { fromBlock: toHex(from), toBlock: toHex(to) }
    const [erc721, ...rest] = await Promise.all([
      this.client.request({
        method: 'eth_getLogs',
        params: [{ ...range, topics: [...getLogsTopics.erc721Mints] as LogTopic[] }],
      }),
      ...getLogsTopics.erc1155Mints.map((topics) =>
        this.client.request({ method: 'eth_getLogs', params: [{ ...range, topics: [...topics] as LogTopic[] }] }),
      ),
    ])
    const erc1155 = rest.flat()
    return [...(erc721 as RawLog[]), ...(erc1155 as RawLog[])]
  }
}
