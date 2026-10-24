import type { Bot, Context } from 'grammy'
import { InlineKeyboard } from 'grammy'
import { config } from '../config.js'
import { db } from '../db.js'
import { settings, GAS_PRESETS, updateSettings } from '../settings.js'
import { keystore } from '../wallets/keystore.js'
import { getChainById } from '../chains.js'
import { editCard, sendCard, deleteMessage, type MsgRef } from './telegram.js'
import { renderView, settingToggle, settingStep, gasPreset, gweiStep, prioStep, type ViewId } from './screens.js'
import { reviewCard, ROUTE_ORDER, ROUTE_LABEL, type Card } from './messages.js'
import { parseContext } from '../executor/pipeline.js'
import { nativePriceUsd } from '../pricing/price.js'
import { esc, fmtEth, stripHtml } from '../utils/format.js'

/**
 * Controller interaksi Telegram: /commands, callback router (edit-in-place),
 * import private key via chat, dan /rate (gap bridge live).
 * Executor is injected from index to avoid a circular import.
 */

type ExecuteFn = (jobId: number, immediate?: boolean) => Promise<void>
let executeJobFn: ExecuteFn = async () => {}
export function setExecutor(fn: ExecuteFn): void {
  executeJobFn = fn
}

let awaitingImport = false

const NAV_TOAST: Record<string, string> = {
  menu: 'Menu', stats: 'Statistik 24 jam', saldo: 'Saldo', help: 'Bantuan',
  set: 'Pengaturan', mint: 'Setelan mint', gas: 'Gas & gwei', sec: 'Keamanan',
  wallet: 'Wallet', create: 'Buat wallet', import: 'Kirim pk[,label]', prefer: 'Preferred',
}

/** View yang pas di-re-render setelah aksi setting tertentu. */
function viewAfterSetting(kind: string, arg: string): ViewId {
  if (kind === 'g' || kind === 'gw' || kind === 'pr' || arg === 'autoGas') return 'gas'
  if (arg === 'confirmSend' || arg === 'gapPct' || arg === 'budgetEth') return 'sec'
  return 'mint'
}

export function registerController(bot: Bot): void {
  const ownerChat = Number(config.telegramChatId)
  const isOwner = (ctx: Context) => ctx.chat?.id === ownerChat

  const sendView = (view: ViewId) => void sendCard(renderView(view))

  bot.command('start', (ctx) => { if (isOwner(ctx)) sendView('menu') })
  bot.command('settings', (ctx) => { if (isOwner(ctx)) sendView('set') })
  bot.command('wallets', (ctx) => { if (isOwner(ctx)) sendView('wallet') })
  bot.command('help', (ctx) => { if (isOwner(ctx)) sendView('help') })
  bot.command('rate', (ctx) => { if (isOwner(ctx)) void handleRateReal() })
  bot.command('jobs', (ctx) => {
    if (!isOwner(ctx)) return
    const jobs = db.recentJobs(5)
    const lines = jobs.map((j) => {
      let name = j.token.slice(0, 10) + '…'
      try { name = (JSON.parse(j.context) as { tokenName?: string }).tokenName ?? name } catch { /* biarkan */ }
      const c = getChainById(j.chain_id)
      const st: Record<string, string> = { done: '✅', failed: '❌', skipped: '🙅', expired: '⌛', pending: '⏳', executing: '⚙️', bridging: '🌉', minting: '⛏️' }
      return `${st[j.status] ?? '•'} #${j.id} ${j.status} · ${esc(name)} · ${c?.name ?? j.chain_id}`
    })
    void sendCard({ text: '🧾 <b>Job terakhir</b>\n\n' + (lines.length ? lines.join('\n') : '—'), keyboard: new InlineKeyboard() })
  })

  // pesan teks = calon private key untuk import
  bot.on('message:text', (ctx) => {
    if (!isOwner(ctx) || !awaitingImport) return
    void handleImportText(ctx)
  })

  bot.on('callback_query:data', (ctx) => {
    if (!isOwner(ctx)) { void ctx.answerCallbackQuery(); return }
    void handleCallback(ctx).catch((e) => console.error('[controller] callback error:', e))
  })

  async function handleImportText(ctx: Context): Promise<void> {
    const text = ctx.msg?.text?.trim() ?? ''
    const [rawPk, label] = text.split(',')
    const hex = rawPk.trim().replace(/^0x/, '').toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(hex)) {
      void sendCard({ text: '⚠️ Format salah — kirim <code>pk[,label]</code> (64 hex). SOL: tambahkan label <code>sol</code>.', keyboard: new InlineKeyboard() })
      return
    }
    try {
      const type = label?.trim().toLowerCase().includes('sol') ? 'SOL' : 'EVM'
      const w = keystore.importKey(type, rawPk.trim())
      awaitingImport = false
      if (ctx.msg) await deleteMessage(ctx.chat!.id, ctx.msg.message_id)
      await sendCard({
        text: `📥 <b>Import ✓</b> — ${esc(w.id)}\n<code>${esc(w.address)}</code>\n\nPesan private key telah dihapus dari chat. Key tersimpan di keystore lokal.`,
        keyboard: new InlineKeyboard().text('‹ Wallet', 'nv:wallet'),
      })
    } catch (e) {
      await sendCard({ text: `⚠️ Import gagal: ${esc(e instanceof Error ? e.message : String(e))}`, keyboard: new InlineKeyboard() })
    }
  }

  async function handleCallback(ctx: Context): Promise<void> {
    const cb = ctx.callbackQuery!
    const data = cb.data ?? ''
    const m = cb.message
    const ref: MsgRef | null = m && 'message_id' in m ? { chatId: m.chat.id, msgId: m.message_id } : null
    const answer = (t = ' ') => ctx.answerCallbackQuery({ text: t }).catch(() => {})
    const edit = (card: Card) => editCard(ref, card)

    if (data === 'rate:go') { await answer('🔄 quote baru…'); await handleRateReal(); return }
    if (data === 'noop') { await answer(); return }

    // navigasi menu (edit-in-place)
    if (data.startsWith('nv:')) {
      const view = data.slice(3)
      if (view === 'chain') { await answer(`⛓️ ${config.chainsEnabled.join(', ')} — via .env`); return }
      if (view === 'import') awaitingImport = true
      if (['menu', 'stats', 'saldo', 'help', 'set', 'mint', 'gas', 'sec', 'wallet', 'create', 'import', 'prefer'].includes(view)) {
        await edit(renderView(view as ViewId))
        await answer(NAV_TOAST[view] ?? view)
      }
      return
    }

    // aksi setting
    if (data.startsWith('st:')) {
      const [, kind, arg] = data.split(':')
      if (kind === 't') settingToggle(arg as 'autoMint' | 'confirmSend' | 'autoGas')
      else if (kind === 's') settingStep(arg as 'maxPriceEth')
      else if (kind === 'g') gasPreset(arg as 'std' | 'fast' | 'inst')
      else if (kind === 'gw') gweiStep(arg as '+' | '-')
      else if (kind === 'pr') prioStep(arg as '+' | '-')
      await edit(renderView(viewAfterSetting(kind, arg)))
      await answer('✓ tersimpan')
      return
    }

    // alert actions: skip / auto
    if (data.startsWith('al:')) {
      const [, idStr, act] = data.split(':')
      const id = Number(idStr)
      const job = db.getJob(id)
      if (!job) { await answer('job tidak ditemukan'); return }
      if (act === 'sk') {
        if (job.status === 'pending') db.updateJob(id, 'skipped')
        await answer('di-skip')
        await edit({ text: `🙅 Job #${id} di-skip. Riwayat: /jobs`, keyboard: new InlineKeyboard() })
      } else if (act === 'au') {
        updateSettings({ autoMint: !settings.autoMint })
        await answer(`⚡ Auto-mint ${settings.autoMint ? 'ON' : 'OFF'}`)
      }
      return
    }

    // review actions
    if (data.startsWith('rv:')) {
      const [, idStr, act] = data.split(':')
      const id = Number(idStr)
      const job = db.getJob(id)
      if (!job) { await answer('job tidak ditemukan'); return }
      const jctx = parseContext(job)
      const chain = getChainById(job.chain_id)
      if (!chain) { await answer('chain tidak dikenal'); return }
      const review = jctx.review ?? { qty: 1, route: 'auto' as const }
      if (act === 'q+') review.qty = Math.min(settings.maxQty, review.qty + 1)
      if (act === 'q-') review.qty = Math.max(1, review.qty - 1)
      if (act === 'rt') review.route = ROUTE_ORDER[(ROUTE_ORDER.indexOf(review.route) + 1) % ROUTE_ORDER.length]

      if (act === 'open' || act === 'q+' || act === 'q-' || act === 'rt') {
        if (job.status !== 'pending') { await answer('job tidak lagi pending'); return }
        jctx.review = review
        db.updateJob(id, job.status, JSON.stringify(jctx))
        const fundingNote = `Dana: wallet <b>${keystore.preferred()?.id ?? '—'}</b> — rute dicek ulang saat eksekusi.`
        await edit(reviewCard({ jobId: id, ctx: jctx, chain, review, fundingNote }))
        await answer(act === 'rt' ? `Rute → ${ROUTE_LABEL[review.route]}` : `Qty → ${review.qty}`)
        return
      }
      if (act === 'no') {
        await answer('dibatalkan')
        await edit({ text: `Job #${id} — review dibatalkan. Riwayat: /jobs`, keyboard: new InlineKeyboard() })
        return
      }
      if (act === 'ok') {
        if (job.status !== 'pending') { await answer('sudah dieksekusi'); return }
        if (!settings.confirmSend) { await answer('⚠️ Confirm OFF — aktifkan di Keamanan'); return }
        jctx.review = review
        db.updateJob(id, job.status, JSON.stringify(jctx))
        await answer('🚀 eksekusi…')
        await executeJobFn(id, true)
      }
      return
    }

    // wallet actions
    if (data.startsWith('wx:')) {
      const [, act, arg] = data.split(':')
      if (act === 'new') {
        const w = keystore.create(arg === 'sol' ? 'SOL' : 'EVM')
        await edit({
          text:
            `✅ <b>Wallet dibuat — ${esc(w.id)}</b>\n\n⛓️ ${w.type}\n📬 <code>${esc(w.address)}</code>\n💰 Saldo 0\n\n⚠️ <b>Private key hanya bisa dilihat sekarang</b> — simpan di tempat aman.`,
          keyboard: new InlineKeyboard().text('🔑 Tampilkan Key', `wx:key:${w.id}`).row().text('‹ Selesai', 'nv:wallet'),
        })
        await answer('dibuat — backup key!')
        return
      }
      if (act === 'key' || act === 'rev') {
        const e = keystore.exportKey(arg ?? '')
        if (!e) { await answer('wallet tidak ditemukan'); return }
        await edit({
          text: `🔑 <b>Key — ${esc(e.id)}</b>\n\n<code>${esc(e.key)}</code>\n\n⚠️ Tampil sekali — sembunyikan setelah disalin.`,
          keyboard: new InlineKeyboard().text(act === 'key' ? '✅ Sudah dibackup' : '🙈 Sembunyikan', 'nv:wallet'),
        })
        await answer(' ')
        return
      }
      if (act === 'export') {
        const p = keystore.preferred()
        if (!p) { await answer('belum ada wallet EVM'); return }
        await edit({
          text:
            `📤 <b>Export — ${esc(p.id)}</b> (preferred)\n\n📬 <code>${esc(p.address)}</code>\n🔑 Private key: <b>tersembunyi</b>\n\n⚠️ Key tampil sekali setelah tombol di bawah — pastikan tidak ada yang melihat layar.`,
          keyboard: new InlineKeyboard().text('👁️ Tampilkan', `wx:rev:${p.id}`).row().text('‹ Wallet', 'nv:wallet'),
        })
        await answer(' ')
        return
      }
      if (act === 'prf') {
        const w = keystore.setPreferred(arg ?? '')
        await answer(w ? `⭐ Preferred → ${w.id}` : 'gagal')
        if (w) await edit(renderView('wallet'))
        return
      }
      await answer(' ')
      return
    }

    await answer(' ')
  }

  async function handleRateReal(): Promise<void> {
    try {
      const { relayQuote, ZERO_ADDRESS } = await import('../executor/relay.js')
      const ethChain = getChainById(1)!
      const [q, eth] = await Promise.all([
        relayQuote({
          user: keystore.preferred()?.address ?? '0x000000000000000000000000000000000000dEaD',
          originChainId: 8453,
          destinationChainId: 42161,
          originCurrency: ZERO_ADDRESS,
          destinationCurrency: ZERO_ADDRESS,
          amount: '10000000000000000',
          tradeType: 'EXACT_INPUT',
        }),
        nativePriceUsd(ethChain),
      ])
      const gapLine = q.gapPct != null ? `${q.gapPct.toFixed(2)}% ${Math.abs(q.gapPct) <= settings.gapPct ? '✓' : '⚠ >' + settings.gapPct + '%'}` : '—'
      const inEth = Number(BigInt(q.inAmount)) / 1e18
      await sendCard({
        text:
          `💱 <b>Rate Check</b> — 0.01 ETH Base → ETH Arbitrum\n\n` +
          `<code>📤 Kirim       ${inEth.toFixed(5)} ETH\n📥 Terima min  ${fmtEth(BigInt(q.outMin))} ETH\n📉 Gap         ${gapLine}\n🧯 Worst       ${q.gapMinPct != null ? q.gapMinPct.toFixed(2) + '%' : '—'}\n💰 Fee         ~$${q.feeUsd.toFixed(2)}${eth != null ? `\n💵 Nilai       ≈ $${(inEth * eth).toFixed(2)}` : ''}</code>\n\n` +
          `🛡️ Guard: tolak gap &gt; ${settings.gapPct}% · Preset gas: ${GAS_PRESETS[settings.gasPreset].label}`,
        keyboard: new InlineKeyboard().text('🔄 Refresh', 'rate:go'),
      })
    } catch (e) {
      await sendCard({ text: `⚠️ Rate check gagal: ${esc(stripHtml(e instanceof Error ? e.message : String(e)))}`, keyboard: new InlineKeyboard() })
    }
  }
}
