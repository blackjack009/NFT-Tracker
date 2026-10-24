import { InlineKeyboard } from 'grammy'
import { esc, fmtEth, fmtUsd, shortAddr } from '../utils/format.js'
import { explorerTx, openseaAssetUrl, openseaCollectionUrl, openseaInventoryUrl } from '../executor/opensea.js'
import type { ChainConfig } from '../chains.js'
import { settings } from '../settings.js'
import type { JobContext, ReviewState } from '../executor/pipeline.js'

export interface Card {
  text: string
  keyboard: InlineKeyboard
}

export interface AlertInput {
  jobId: number
  chain: ChainConfig
  token: string
  tokenId: string
  standard: 'erc721' | 'erc1155'
  minter: string
  minterLabel: string
  txHash: string
  tokenName: string
  priceWei: bigint
  priceUsd: number | null
  heat: number
  clusterList: Array<{ label: string; addr: string; count: number }>
}

export function alertCard(i: AlertInput): Card {
  const price = i.priceWei > 0n ? `<b>${fmtEth(i.priceWei)} ${i.chain.nativeSymbol}</b>${i.priceUsd != null ? ` ≈ ${fmtUsd(i.priceUsd)}` : ''}` : '<b>FREE</b>'
  const clusterCount = i.clusterList.reduce((a, c) => a + 1, 0)
  const clusterTotal = i.clusterList.reduce((a, c) => a + c.count, 0)
  const cluster = i.clusterList.length
    ? '\n👥 <b>Cluster (15 mnt):</b>\n' +
      i.clusterList
        .slice(0, 5)
        .map((c) => `• <b>${esc(c.label)}</b> <code>${shortAddr(c.addr)}</code>${c.count > 1 ? ` ×${c.count}` : ''}`)
        .join('\n') +
      (i.heat > clusterTotal ? `\n• +${i.heat - clusterTotal} mint lain (${i.heat - clusterCount} wallet)` : '')
    : ''
  const links = `<a href="${explorerTx(i.chain, i.txHash)}">tx</a> · <a href="${i.chain.explorer}/address/${i.token}">kontrak</a>${openseaCollectionUrl(i.chain, i.token) ? ` · <a href="${openseaCollectionUrl(i.chain, i.token)}">opensea</a>` : ''}`
  const text =
    `🚨 <b>MINT TERDETEKSI</b> — Job #${i.jobId}\n\n` +
    `🎨 <b>${esc(i.tokenName)}</b>\n` +
    `🏷️ ${esc(i.tokenId)} · ${i.standard.toUpperCase()}\n` +
    `⛓️ <b>${esc(i.chain.name)}</b> · 💰 ${price}\n` +
    cluster +
    `\n🔗 ${links}\n` +
    `⏳ Review dulu — bot tidak akan mint tanpa konfirmasi`
  const kb = new InlineKeyboard()
    .text('🧾 Review', `rv:${i.jobId}:open`).row()
    .text('❌ Skip', `al:${i.jobId}:sk`)
    .text(`✍️ Auto: ${settings.autoMint ? 'ON' : 'OFF'}`, `al:${i.jobId}:au`)
  return { text, keyboard: kb }
}

export const ROUTE_LABEL: Record<ReviewState['route'], string> = {
  auto: 'Otomatis',
  direct: 'Langsung',
  '1tx': '1-TX Relay ⚡',
  '2tx': '2-TX Aman 🐢',
}
export const ROUTE_ORDER: ReviewState['route'][] = ['auto', 'direct', '1tx', '2tx']

export function reviewCard(args: {
  jobId: number
  ctx: JobContext
  chain: ChainConfig
  review: ReviewState
  fundingNote: string
}): Card {
  const { jobId, ctx, chain, review, fundingNote } = args
  const unitEth = Number(ctx.originalTx.value || '0') / 1e18
  const fee = review.route === '1tx' ? 0.004 : review.route === '2tx' ? 0.011 : 0
  const total = (unitEth * review.qty + fee).toFixed(3)
  const gapLine = ctx.gapPct != null ? `📉 Gap ${ctx.gapPct.toFixed(2)}% ${Math.abs(ctx.gapPct) <= settings.gapPct ? '✓' : '⚠ >' + settings.gapPct + '%'}` : '📉 Gap — (diambil saat eksekusi)'
  const text =
    `🧾 <b>Review</b> — Job #${jobId}\n\n` +
    `🎨 <b>${esc(ctx.tokenName ?? 'Unknown')}</b> · ${esc(chain.name)}\n\n` +
    `<code>🔢 Qty        ${review.qty} NFT\n` +
    `💰 Harga      ${unitEth.toFixed(4)} × ${review.qty}\n` +
    (fee ? `🌉 Fee rute   ~${fee} ETH\n` : '') +
    `${gapLine}\n` +
    `🧾 Total      ${total} ETH\n` +
    `🛡️ Cap        ${settings.maxPriceEth} ETH · ${settings.gapPct}% ✓</code>\n\n` +
    `🌉 Rute: <b>${ROUTE_LABEL[review.route]}</b>\n${fundingNote}\n\n` +
    `Tidak ada eksekusi sebelum ✅ Konfirmasi.`
  const kb = new InlineKeyboard()
    .text('➖', `rv:${jobId}:q-`).text(`🔢 ${review.qty}`, 'noop').text('➕', `rv:${jobId}:q+`).row()
    .text(`🌉 ${ROUTE_LABEL[review.route]}`, `rv:${jobId}:rt`).row()
    .text(`✅ Konfirmasi ${total} ETH`, `rv:${jobId}:ok`).text('❌ Batal', `rv:${jobId}:no`)
  return { text, keyboard: kb }
}

export interface BoardLine {
  mark: 'done' | 'act' | 'pend'
  label: string
  detail: string
}

export function boardCard(args: { jobId: number; title: string; lines: BoardLine[]; elapsed?: string; note?: string }): Card {
  const rows = args.lines
    .map((l) => `${l.mark === 'done' ? '✅' : l.mark === 'act' ? '⏳' : '⬜'} ${l.label} ${l.detail ? '— <i>' + esc(l.detail) + '</i>' : ''}`)
    .join('\n')
  const text =
    `${args.title} — Job #${args.jobId}\n\n${rows}` +
    (args.elapsed ? `\n\n⏱️ Berjalan ${args.elapsed}` : '') +
    (args.note ? `\n\n${args.note}` : '')
  return { text, keyboard: new InlineKeyboard() }
}

export function resultCard(args: {
  jobId: number
  chain: ChainConfig
  originChain?: ChainConfig
  token: string
  tokenName: string
  tokenIds: string[]
  wallet: string
  mode: string
  txHash: string
  extra?: string
  failed?: string
}): Card {
  const i = args
  if (i.failed) {
    const text =
      `❌ <b>GAGAL</b> — Job #${i.jobId}\n` +
      `🎨 ${esc(i.tokenName)} · ⛓️ ${esc(i.chain.name)}\n` +
      `📝 ${esc(i.failed)}` +
      (i.txHash ? `\n🔗 <a href="${explorerTx(i.chain, i.txHash)}">tx</a>` : '')
    return { text, keyboard: new InlineKeyboard() }
  }
  const ids = i.tokenIds.length ? i.tokenIds.slice(0, 3).map((t) => `#${t}`).join(', ') + (i.tokenIds.length > 3 ? ` +${i.tokenIds.length - 3}` : '') : ''
  const asset = i.tokenIds[0] ? openseaAssetUrl(i.chain, i.token, i.tokenIds[0]) : null
  const coll = openseaCollectionUrl(i.chain, i.token)
  const links: Array<[string, string]> = [[`tx`, explorerTx(i.chain, i.txHash)]]
  if (i.originChain) links.push([`bridge (${i.originChain.name})`, explorerTx(i.originChain, i.txHash)])
  const text =
    `✅ <b>MINT BERHASIL</b> — Job #${i.jobId}\n\n` +
    `🎨 <b>${esc(i.tokenName)}</b>${ids ? ' ' + ids : ''}\n` +
    `⛓️ ${esc(i.chain.name)} · 🛣️ ${esc(i.mode)}\n` +
    (i.extra ? `${i.extra}\n` : '') +
    `\n🔗 ${links.map(([t, u]) => `<a href="${u}">${t}</a>`).join(' · ')}`
  const kb2 = new InlineKeyboard()
  if (asset) kb2.url('🎨 OpenSea', asset)
  if (coll) kb2.url('Koleksi', coll)
  kb2.url('🎒 Inventory', openseaInventoryUrl(i.wallet))
  return { text, keyboard: kb2 }
}

export { fmtUsd }
