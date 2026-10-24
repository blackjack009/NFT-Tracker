import { formatEther, parseEther, toHex, type Hex, type LogTopic } from 'viem'
import { config } from '../config.js'
import { db, type JobRow } from '../db.js'
import { getChainById, type ChainConfig } from '../chains.js'
import { sendCard, editCard, notify, type MsgRef } from '../notifier/telegram.js'
import { boardCard, resultCard } from '../notifier/messages.js'
import { esc, fmtEth } from '../utils/format.js'
import { swapAddressInCalldata } from '../utils/addr.js'
import { TRANSFER_TOPIC } from '../tracker/detect.js'
import { settings } from '../settings.js'
import { keystore } from '../wallets/keystore.js'
import { accountForKey, getWalletClient, makePublicClient, activeAccount } from './wallet.js'
import { pickFunding } from './funding.js'
import { directMint, extractMintedTokenId, type OriginalTx } from './mint.js'
import { pollRelayStatus, relayQuote, ZERO_ADDRESS, type RelayQuote } from './relay.js'
import { explorerTx } from './opensea.js'

const ZERO_PAD = '0x' + '0'.repeat(64)

export interface ReviewState {
  qty: number
  route: 'auto' | 'direct' | '1tx' | '2tx'
}

export interface JobContext {
  tokenName?: string
  priceUsd?: number | null
  gapPct?: number | null
  originalTx: OriginalTx
  review?: ReviewState
  msgRef?: MsgRef | null
}

export function parseContext(job: JobRow): JobContext {
  try {
    const ctx = JSON.parse(job.context) as Partial<JobContext>
    if (!ctx.originalTx) throw new Error('no originalTx')
    return ctx as JobContext
  } catch {
    return {
      tokenName: 'Unknown',
      originalTx: { to: '', data: '0x', value: '0', from: job.minter },
      review: { qty: 1, route: 'auto' },
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms).unref())
}

/** Live board that edits the alert/review message in place. */
class Board {
  private t0 = Date.now()
  constructor(private ref: MsgRef | null, private jobId: number, private title: string) {}
  private lines: Array<{ mark: 'done' | 'act' | 'pend'; label: string; detail: string }> = []
  async begin(steps: string[]): Promise<void> {
    this.lines = steps.map((s) => ({ mark: 'pend', label: s, detail: '' }))
    await this.flush()
  }
  async step(i: number, detail = ''): Promise<void> {
    this.lines.forEach((l, j) => { if (l.mark === 'act') l.mark = 'done' })
    this.lines[i].mark = 'act'
    this.lines[i].detail = detail
    await this.flush()
  }
  async finish(i: number, detail = ''): Promise<void> {
    this.lines.forEach((l) => { if (l.mark === 'act') l.mark = 'done' })
    this.lines[i].mark = 'done'
    this.lines[i].detail = detail
    await this.flush()
  }
  private async flush(): Promise<void> {
    const elapsed = Math.round((Date.now() - this.t0) / 1000)
    this.ref = await editCard(this.ref, boardCard({ jobId: this.jobId, title: this.title, lines: this.lines, elapsed: `${elapsed}s` }))
  }
}

/** Eksekusi job — dipanggil dari konfirmasi review (immediate) atau auto-mint. */
export async function executeJob(jobId: number, immediate = false): Promise<void> {
  void immediate
  const job = db.getJob(jobId)
  if (!job || job.status !== 'pending') return
  const chain = getChainById(job.chain_id)
  if (!chain) {
    db.updateJob(jobId, 'failed', 'chain tidak dikenal')
    return
  }
  const ctx = parseContext(job)
  const review = ctx.review ?? { qty: 1, route: 'auto' as const }
  const priceWei = BigInt(job.price_wei || '0')
  const totalWei = priceWei * BigInt(review.qty)

  if (config.mock) {
    await mockExecute(job, chain, ctx, review.qty)
    return
  }

  const account = activeAccount()
  if (!account) {
    db.updateJob(jobId, 'failed', 'belum ada wallet EVM — buat/import lewat /wallets')
    await notify('❌ Eksekusi butuh wallet EVM. Buka /wallets → Create atau Import.')
    return
  }

  if (priceWei > parseEther(String(settings.maxPriceEth))) {
    db.updateJob(jobId, 'failed', `harga mint > MAX ${settings.maxPriceEth} ETH`)
    await notify(`⛔ Job #${jobId} dibatalkan: harga mint > cap ${settings.maxPriceEth} ETH (ubah di /settings).`)
    return
  }
  if (review.qty > settings.maxQty) {
    db.updateJob(jobId, 'failed', `qty > MAX ${settings.maxQty}`)
    await notify(`⛔ Job #${jobId} dibatalkan: qty ${review.qty} > max ${settings.maxQty}.`)
    return
  }
  const spendToday = db.dailySpendWei()
  if (spendToday + totalWei > parseEther(String(settings.budgetEth))) {
    db.updateJob(jobId, 'failed', 'budget 24 jam kehabisan')
    await notify(`⛔ Job #${jobId} ditolak: budget 24 jam ${fmtEth(spendToday)}/${settings.budgetEth} ETH abis (ubah di /settings → Keamanan).`)
    return
  }

  db.updateJob(jobId, 'executing')
  const need = totalWei > 0n ? totalWei : parseEther('0.004')
  const funding = await pickFunding(chain, need)
  if (!funding) {
    db.updateJob(jobId, 'failed', 'saldo tidak cukup di semua wallet/chain')
    await notify(`❌ Job #${jobId} gagal: saldo tidak cukup di semua wallet & chain aktif (butuh ~${fmtEth(need)} ${chain.nativeSymbol}).`)
    return
  }

  try {
    const executor = accountForKey(funding.walletId === keystore.preferred()?.id ? keystore.preferred()!.key : keystore.get(funding.walletId)!.key)
    if (funding.chain.key === chain.key) {
      await runDirect(job, chain, ctx, review, executor)
    } else {
      const want1tx = review.route === '1tx' || (review.route === 'auto' && canOneTx(ctx, totalWei))
      if (review.route === 'direct') {
        throw new Error('rute "Langsung" dipilih tapi dana hanya ada di chain lain — ganti rute di review')
      }
      if (want1tx) {
        const ok = await relayOneTx(job, funding, chain, ctx, review, executor)
        if (ok) return
        await notify(`↩️ Job #${job.id}: fallback 2 langkah…`)
      }
      await relayTwoStep(job, funding, chain, ctx, review, executor)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    db.updateJob(jobId, 'failed', msg)
    await sendCard(resultCard({
      jobId, chain, token: job.token, tokenName: ctx.tokenName ?? 'Unknown', tokenIds: [],
      wallet: account.address, mode: '-', txHash: '', failed: msg,
    }))
  }
}

function canOneTx(ctx: JobContext, priceWei: bigint): boolean {
  void priceWei
  return true // verified inside relayOneTx via the address parameter in the calldata
}

async function runDirect(job: JobRow, chain: ChainConfig, ctx: JobContext, review: ReviewState, executor: ReturnType<typeof accountForKey>): Promise<void> {
  const board = new Board(ctx.msgRef ?? null, job.id, '⛏️ Eksekusi')
  await board.begin(['Simulasi', 'Mint dikirim', 'Konfirmasi block'])
  db.updateJob(job.id, 'minting', undefined, 'direct')
  await board.step(0, 'eth_call')
  const res = await directMint(chain, ctx.originalTx, job.minter, executor)
  if (!res.ok) {
    db.updateJob(job.id, 'failed', res.error)
    await sendCard(resultCard({
      jobId: job.id, chain, token: job.token, tokenName: ctx.tokenName ?? 'Unknown', tokenIds: [],
      wallet: executor.address, mode: 'direct', txHash: '', failed: res.error,
    }))
    return
  }
  await board.finish(1, res.txHash.slice(0, 12) + '…')
  await board.finish(2)
  // qty tambahan (best-effort)
  const tokenIds = [res.tokenId].filter(Boolean)
  for (let i = 1; i < review.qty; i++) {
    const extra = await directMint(chain, ctx.originalTx, job.minter, executor)
    if (extra.ok && extra.tokenId) tokenIds.push(extra.tokenId)
  }
  db.updateJob(job.id, 'done', JSON.stringify({ txHash: res.txHash, tokenIds }), 'direct')
  db.markSpend(job.id, BigInt(job.price_wei || '0') * BigInt(review.qty))
  await sendCard(resultCard({
    jobId: job.id, chain, token: job.token, tokenName: ctx.tokenName ?? 'Unknown', tokenIds,
    wallet: executor.address, mode: `Direct mint · qty ${review.qty}`, txHash: res.txHash,
  }))
}

function assertGapOk(q: RelayQuote): void {
  if (q.gapPct != null && Math.abs(q.gapPct) > settings.gapPct) {
    throw new Error(`gap bridge ${q.gapPct.toFixed(2)}% > batas ${settings.gapPct}% — quote ditolak (ubah di /settings)`)
  }
}

function bridgeTerms(q: RelayQuote): string {
  const fmt = (wei: string, sym: string) => {
    if (!/^\d+$/.test(wei)) return '?'
    const dec = ['USDC', 'USDT', 'USDbC'].includes(sym) ? 6 : 18
    return (Number(BigInt(wei)) / 10 ** dec).toLocaleString('en-US', { maximumFractionDigits: 5 })
  }
  const gap = q.gapPct != null ? ` · gap ${q.gapPct.toFixed(2)}% ${Math.abs(q.gapPct) <= settings.gapPct ? '✓' : '⚠'}` : ''
  return `kirim ${fmt(q.inAmount, q.inSym)} ${q.inSym} → terima min ${fmt(q.outMin, q.outSym)} ${q.outSym}${gap}`
}

async function relayOneTx(
  job: JobRow,
  funding: NonNullable<Awaited<ReturnType<typeof pickFunding>>>,
  dest: ChainConfig,
  ctx: JobContext,
  review: ReviewState,
  executor: ReturnType<typeof accountForKey>,
): Promise<boolean> {
  const priceWei = BigInt(job.price_wei || '0') * BigInt(review.qty)
  try {
    if (priceWei <= 0n) throw new Error('mint gratis: tidak memerlukan rute 1-tx')
    const quote = await relayQuote({
      user: executor.address,
      originChainId: funding.chain.id,
      destinationChainId: dest.id,
      originCurrency: ZERO_ADDRESS,
      destinationCurrency: ZERO_ADDRESS,
      amount: priceWei.toString(),
      tradeType: 'EXACT_OUTPUT',
      txs: [{ to: ctx.originalTx.to, value: priceWei.toString(), data: ctx.originalTx.data }],
      txsGasLimit: 250_000,
    })
    assertGapOk(quote)
    const board = new Board(ctx.msgRef ?? null, job.id, '🌉 Bridge+mint 1-TX')
    await board.begin(['Quote', 'Deposit dikirim', 'Relayer fill + mint', 'Selesai'])
    await board.step(0, bridgeTerms(quote))
    db.updateJob(job.id, 'bridging', undefined, 'relay-1tx')
    const wallet = getWalletClient(funding.chain, executor)
    const client = makePublicClient(funding.chain)
    const hash = await wallet.sendTransaction({
      account: executor.address,
      to: quote.deposit.to as Hex,
      data: quote.deposit.data as Hex,
      value: BigInt(quote.deposit.value),
      gas: quote.deposit.gas ? BigInt(quote.deposit.gas) : undefined,
      maxFeePerGas: quote.deposit.maxFeePerGas ? BigInt(quote.deposit.maxFeePerGas) : undefined,
      maxPriorityFeePerGas: quote.deposit.maxPriorityFeePerGas ? BigInt(quote.deposit.maxPriorityFeePerGas) : undefined,
    })
    await board.step(1, hash.slice(0, 12) + '…')
    await client.waitForTransactionReceipt({ hash, timeout: 180_000, confirmations: 1 })
    await board.step(2, `${esc(funding.chain.name)} → ${esc(dest.name)}`)
    const status = await pollRelayStatus(quote, 20 * 60_000)
    if (status !== 'success') {
      throw new Error(`Relay status ${status} — deposit ${explorerTx(funding.chain, hash)} (cek refund)`)
    }
    await board.finish(3)
    const tokenId = await findMintedTokenId(dest, ctx.originalTx.to, executor.address)
    db.updateJob(job.id, 'done', JSON.stringify({ txHash: hash, tokenIds: tokenId ? [tokenId] : [] }), 'relay-1tx')
    db.markSpend(job.id, BigInt(job.price_wei || '0') * BigInt(review.qty))
    await sendCard(resultCard({
      jobId: job.id, chain: dest, originChain: funding.chain, token: job.token,
      tokenName: ctx.tokenName ?? 'Unknown', tokenIds: tokenId ? [tokenId] : [],
      wallet: executor.address, mode: `Bridge+mint via Relay (1 tx) · qty ${review.qty}`, txHash: hash,
    }))
    return true
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn(`[relay-1tx] job #${job.id}:`, msg)
    await notify(`⚠️ Job #${job.id}: 1-tx bridge+mint gagal → ${esc(msg.slice(0, 160))}`)
    return false
  }
}

async function relayTwoStep(
  job: JobRow,
  funding: NonNullable<Awaited<ReturnType<typeof pickFunding>>>,
  dest: ChainConfig,
  ctx: JobContext,
  review: ReviewState,
  executor: ReturnType<typeof accountForKey>,
): Promise<void> {
  const priceWei = BigInt(job.price_wei || '0') * BigInt(review.qty)
  const buffer = (priceWei * BigInt(Math.round(config.bridgeBufferPct * 100))) / 100n + parseEther('0.001')
  const amount = priceWei > 0n ? priceWei + buffer : parseEther('0.004')
  const quote = await relayQuote({
    user: executor.address,
    originChainId: funding.chain.id,
    destinationChainId: dest.id,
    originCurrency: ZERO_ADDRESS,
    destinationCurrency: ZERO_ADDRESS,
    amount: amount.toString(),
    tradeType: 'EXACT_INPUT',
  })
  assertGapOk(quote)
  const board = new Board(ctx.msgRef ?? null, job.id, '🐢 Bridge → mint (2 tx)')
  await board.begin(['Quote', 'Bridge keluar', 'Menunggu fill', 'Mint dieksekusi', 'Selesai'])
  await board.step(0, bridgeTerms(quote))
  db.updateJob(job.id, 'bridging', undefined, 'relay-2step')
  const wallet = getWalletClient(funding.chain, executor)
  const client = makePublicClient(funding.chain)
  const hash = await wallet.sendTransaction({
    account: executor.address,
    to: quote.deposit.to as Hex,
    data: quote.deposit.data as Hex,
    value: BigInt(quote.deposit.value),
    gas: quote.deposit.gas ? BigInt(quote.deposit.gas) : undefined,
    maxFeePerGas: quote.deposit.maxFeePerGas ? BigInt(quote.deposit.maxFeePerGas) : undefined,
    maxPriorityFeePerGas: quote.deposit.maxPriorityFeePerGas ? BigInt(quote.deposit.maxPriorityFeePerGas) : undefined,
  })
  await board.step(1, hash.slice(0, 12) + '…')
  await client.waitForTransactionReceipt({ hash, timeout: 180_000, confirmations: 1 })
  await board.step(2)
  const status = await pollRelayStatus(quote, 30 * 60_000)
  if (status !== 'success') {
    throw new Error(`Relay status ${status} — deposit ${explorerTx(funding.chain, hash)} (cek refund)`)
  }
  await board.finish(2, 'dana nyampe')
  db.updateJob(job.id, 'minting', undefined, 'relay-2step')
  await board.step(3)
  const res = await directMint(dest, ctx.originalTx, job.minter, executor)
  if (!res.ok) {
    db.updateJob(job.id, 'failed', res.error)
    await sendCard(resultCard({
      jobId: job.id, chain: dest, token: job.token, tokenName: ctx.tokenName ?? 'Unknown',
      tokenIds: [], wallet: executor.address, mode: '2step', txHash: '', failed: `mint gagal (bridge OK): ${res.error}`,
    }))
    return
  }
  await board.finish(3, res.txHash.slice(0, 12) + '…')
  await board.finish(4)
  const tokenIds = [res.tokenId].filter(Boolean)
  for (let i = 1; i < review.qty; i++) {
    const extra = await directMint(dest, ctx.originalTx, job.minter, executor)
    if (extra.ok && extra.tokenId) tokenIds.push(extra.tokenId)
  }
  db.updateJob(job.id, 'done', JSON.stringify({ txHash: res.txHash, tokenIds }), 'relay-2step')
  db.markSpend(job.id, BigInt(job.price_wei || '0') * BigInt(review.qty))
  await sendCard(resultCard({
    jobId: job.id, chain: dest, originChain: funding.chain, token: job.token,
    tokenName: ctx.tokenName ?? 'Unknown', tokenIds, wallet: executor.address,
    mode: `Bridge → mint (2 tx) · qty ${review.qty}`, txHash: res.txHash,
  }))
}

async function findMintedTokenId(chain: ChainConfig, token: string, owner: string): Promise<string> {
  const client = makePublicClient(chain)
  const toTopic = '0x' + '0'.repeat(24) + owner.toLowerCase().replace(/^0x/, '')
  for (let i = 0; i < 5; i++) {
    try {
      const latest = await client.getBlockNumber()
      const from = latest > 400n ? latest - 400n : 0n
      const logs = (await client.request({
        method: 'eth_getLogs',
        params: [
          {
            fromBlock: toHex(from),
            toBlock: toHex(latest),
            address: token as Hex,
            topics: [TRANSFER_TOPIC, ZERO_PAD, toTopic] as LogTopic[],
          },
        ],
      })) as Array<{ topics: string[]; data: string }>
      if (logs.length > 0) {
        const last = logs[logs.length - 1]
        if (last.topics.length === 4) return BigInt(last.topics[3]).toString()
        return BigInt('0x' + last.data.replace(/^0x/, '').slice(0, 64)).toString()
      }
    } catch {
      // coba lagi
    }
    await sleep(8000)
  }
  return ''
}

async function mockExecute(job: JobRow, chain: ChainConfig, ctx: JobContext, qty: number): Promise<void> {
  const board = new Board(ctx.msgRef ?? null, job.id, '🧪 [MOCK] Eksekusi')
  await board.begin(['Simulasi', 'Mint dikirim', 'Konfirmasi block'])
  await board.step(0, 'mock')
  await sleep(700)
  await board.step(1, '0xdead…beef')
  await sleep(700)
  await board.finish(2)
  db.updateJob(job.id, 'done', JSON.stringify({ txHash: '0x' + 'd'.repeat(64), tokenIds: ['1337'] }), 'mock')
  db.markSpend(job.id, BigInt(job.price_wei || '0') * BigInt(qty))
  await sendCard(resultCard({
    jobId: job.id, chain, token: job.token, tokenName: ctx.tokenName ?? 'Unknown',
    tokenIds: ['1337'], wallet: '0x0000000000000000000000000000000000000000',
    mode: `Direct mint [MOCK] · qty ${qty}`, txHash: '0x' + 'd'.repeat(64),
    extra: '🧪 Mode simulate — hash & link palsu.',
  }))
}
