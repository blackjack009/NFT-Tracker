import { InlineKeyboard } from 'grammy'
import type { Card } from './messages.js'
import {
  settings, GAS_PRESETS, PRICE_STEPS, QTY_STEPS, TIMEOUT_STEPS, GAP_STEPS, BUDGET_STEPS,
  updateSettings, applyPreset, gweiStep, prioStep,
} from '../settings.js'
export { gweiStep, prioStep }
export const gasPreset = applyPreset
import { keystore } from '../wallets/keystore.js'
import { db } from '../db.js'
import { esc, fmtEth } from '../utils/format.js'
import { config } from '../config.js'

/**
 * Halaman menu (home/settings/wallet) — semuanya edit-in-place:
 * callback tombel meng-edit pesan yang sama lewat controller telegram.
 */

function code(rows: Array<[string, string, string?]>): string {
  const width = Math.max(...rows.map((r) => r[0].length))
  return (
    '<code>' +
    rows
      .map(([l, v, cls]) => {
        const pad = ' '.repeat(Math.max(1, width - l.length + 2))
        return cls === 'ok' ? `${l}${pad}✓ ${esc(v)}` : `${l}${pad}${esc(v)}`
      })
      .join('\n') +
    '</code>'
  )
}

export type ViewId =
  | 'menu' | 'stats' | 'saldo' | 'help'
  | 'set' | 'mint' | 'gas' | 'sec'
  | 'wallet' | 'create' | 'import' | 'prefer'

export function renderView(view: ViewId, walletCount?: number): Card {
  const S = settings
  switch (view) {
    case 'stats': {
      const jobs = db.recentJobs(200).filter((j) => j.updated_at > Date.now() - 24 * 3600 * 1000)
      const done = jobs.filter((j) => j.status === 'done').length
      const failed = jobs.filter((j) => j.status === 'failed').length
      const skipped = jobs.filter((j) => j.status === 'skipped' || j.status === 'expired').length
      const spend = db.dailySpendWei()
      const win = done + failed > 0 ? Math.round((done / (done + failed)) * 100) : 0
      return {
        text:
          '📊 <b>Statistik 24 jam</b>\n\n' +
          code([
            ['🚨 Alert', String(jobs.length)],
            ['✅ Sukses', `${done} (${win}%)`, 'ok'],
            ['❌ Gagal', String(failed)],
            ['⏭️ Skip/expired', String(skipped)],
            ['💵 Spend', `${fmtEth(spend)} ETH`],
          ]),
        keyboard: new InlineKeyboard().text('‹ Menu', 'nv:menu'),
      }
    }
    case 'saldo': {
      const rows = keystore.evm().map((w) => [`★ ${w.id}`, w.address] as [string, string])
      return {
        text:
          '💳 <b>Saldo per wallet</b>\n\n' +
          (rows.length
            ? code(rows) + '\n\n<i>Saldo live per chain diambil saat eksekusi — bot otomatis pilih wallet/chain terbaik.</i>'
            : '<i>Belum ada wallet — buat/import di menu Wallet.</i>'),
        keyboard: new InlineKeyboard().text('‹ Menu', 'nv:menu'),
      }
    }
    case 'help':
      return {
        text:
          '❓ <b>Cara pakai</b>\n\n' +
          '<code>/start     menu ini\n/settings  pengaturan\n/wallets   kelola wallet\n/rate      cek gap bridge\n/jobs      riwayat job</code>\n\n' +
          'Alur: alert → <b>🧾 Review</b> (qty & rute) → <b>✅ Konfirmasi</b> → status live → hasil + OpenSea.\nBot tidak akan mint tanpa konfirmasi.',
        keyboard: new InlineKeyboard().text('‹ Menu', 'nv:menu'),
      }
    case 'set':
      return {
        text:
          '⚙️ <b>Pengaturan</b>\n\n' +
          code([
            ['💳 Wallet', `${keystore.list().length} aktif · pref ${keystore.preferred()?.id ?? '—'}`],
            ['⛽ Gas', `${S.gasMode} · ${S.gwei} gwei`],
            ['🛡️ Keamanan', `confirm ${S.confirmSend ? 'ON' : 'OFF'} · gap ${S.gapPct}%`],
          ]),
        keyboard: new InlineKeyboard()
          .text('🪙 Setelan Mint', 'nv:mint').text('⛽ Gas & Gwei', 'nv:gas').row()
          .text('🛡️ Keamanan', 'nv:sec').text('ℹ️ Chain', 'nv:chain').row()
          .text('‹ Menu', 'nv:menu'),
      }
    case 'mint':
      return {
        text:
          '🪙 <b>Setelan Mint</b>\n\n' +
          code([
            ['⚡ Auto-mint', S.autoMint ? 'ON (review 10s)' : 'OFF', S.autoMint ? 'ok' : ''],
            ['💰 Max harga', `${S.maxPriceEth} ETH`],
            ['🔢 Max qty', String(S.maxQty)],
            ['⏱️ Timeout', `${S.reviewTimeoutSec}s`],
            ['💳 Preferred', keystore.preferred()?.id ?? '—'],
          ]) +
          '\n\n<i>Cap = hard limit: mint di atas nilai ini auto-ditolak walau dikonfirmasi.</i>',
        keyboard: new InlineKeyboard()
          .text(`⚡ Auto: ${S.autoMint ? 'ON' : 'OFF'}`, 'st:t:autoMint').text(`💰 ${S.maxPriceEth}`, 'st:s:maxPriceEth').row()
          .text(`🔢 ${S.maxQty}`, 'st:s:maxQty').text(`⏱️ ${S.reviewTimeoutSec}s`, 'st:s:reviewTimeoutSec').row()
          .text('‹ Pengaturan', 'nv:set'),
      }
    case 'gas':
      return {
        text:
          '⛽ <b>Gas & Gwei</b>\n\n' +
          code([
            ['🤖 Mode', S.gasMode === 'auto' ? 'Auto RPC (plafon)' : S.gasMode === 'preset' ? GAS_PRESETS[S.gasPreset].label : 'Custom'],
            ['⛽ Gwei', `${S.gwei}${S.gasMode === 'auto' ? ' (plafon)' : ' (manual)'}`],
            ['⚡ Priority', `${S.prioGwei} gwei`],
          ]) +
          `\n\n<i>${S.gasMode === 'auto' ? 'Auto: gas mengikuti harga RPC — nilai gwei menjadi plafon.' : 'Manual: semua transaksi memakai nilai di atas.'}</i>`,
        keyboard: new InlineKeyboard()
          .text('🐢 2', 'st:g:std').text('🚗 5', 'st:g:fast').text('🚀 10', 'st:g:inst').row()
          .text('➖', 'st:gw:-').text(`⛽ ${S.gwei}`, 'noop').text('➕', 'st:gw:+').row()
          .text('➖', 'st:pr:-').text(`⚡ ${S.prioGwei}`, 'noop').text('➕', 'st:pr:+').row()
          .text(`🤖 Auto RPC: ${S.gasMode === 'auto' ? 'ON' : 'OFF'}`, 'st:t:autoGas').row()
          .text('‹ Pengaturan', 'nv:set'),
      }
    case 'sec':
      return {
        text:
          '🛡️ <b>Keamanan</b>\n\n' +
          code([
            ['✅ Konfirmasi', S.confirmSend ? 'ON' : 'OFF', S.confirmSend ? 'ok' : ''],
            ['📉 Gap guard', `${S.gapPct}%`],
            ['💵 Budget 24j', `${S.budgetEth} ETH`],
            ['🔑 Private key', 'tersimpan lokal'],
          ]) +
          '\n\n<i>Key cuma bisa dilihat lewat Export manual di menu Wallet.</i>',
        keyboard: new InlineKeyboard()
          .text(`✅ Confirm: ${S.confirmSend ? 'ON' : 'OFF'}`, 'st:t:confirmSend').text(`📉 ${S.gapPct}%`, 'st:s:gapPct').row()
          .text(`💵 ${S.budgetEth} ETH`, 'st:s:budgetEth').row()
          .text('‹ Pengaturan', 'nv:set'),
      }
    case 'wallet':
      return {
        text:
          '👛 <b>Wallet Bot</b>\n\n' +
          (keystore.list().length
            ? code(
                keystore.list().map((w) => [
                  `${w.preferred ? '★ ' : '  '}${w.id}`,
                  `${w.address.slice(0, 10)}…${w.address.slice(-4)}`,
                ]),
              ) + '\n\n★ preferred = sumber dana utama mint & bridge.'
            : '<i>Belum ada wallet. Create atau Import dulu.</i>'),
        keyboard: new InlineKeyboard()
          .text('➕ Create', 'nv:create').text('📥 Import', 'nv:import').row()
          .text('📤 Export', 'nv:export').text('⭐ Preferred', 'nv:prefer').row()
          .text('‹ Menu', 'nv:menu'),
      }
    case 'create':
      return {
        text: '➕ <b>Wallet Baru</b>\n\nKeypair fresh dibuat di device bot — disarankan <b>burner wallet</b>, bukan wallet utama.',
        keyboard: new InlineKeyboard()
          .text('💠 EVM', 'wx:new:evm').text('◎ SOL', 'wx:new:sol').row()
          .text('‹ Wallet', 'nv:wallet'),
      }
    case 'import':
      return {
        text:
          '📥 <b>Import Wallet</b>\n\n' +
          'Kirim private key ke chat ini dengan format:\n<code>pk,label-opsional</code>\n\n' +
          'Bot menyimpan ke keystore lokal (<code>data/keystore.json</code>, permission 600) lalu <b>menghapus pesan private key secara otomatis</b>.\nEVM: 64 hex (0x opsional) · SOL: seed 64 hex.',
        keyboard: new InlineKeyboard().text('‹ Wallet', 'nv:wallet'),
      }
    case 'prefer': {
      const kb = new InlineKeyboard()
      for (const w of keystore.evm()) {
        kb.text(`${w.preferred ? '★' : '☆'} ${w.id}`, `wx:prf:${w.id}`).row()
      }
      kb.text('‹ Wallet', 'nv:wallet')
      return {
        text: '⭐ <b>Preferred Wallet</b>\n\nDipakai sebagai sumber dana default buat mint & bridge.',
        keyboard: kb,
      }
    }
    case 'menu':
    default: {
      const clusters = walletCount ?? 0
      return {
        text:
          '🎯 <b>NFT Sniper</b> <i>beta · EVM</i>\n\n' +
          code([
            ['🤖 Status', 'AKTIF', 'ok'],
            ['👛 Cluster', clusters > 0 ? `${clusters} wallet` : '—'],
            ['💳 Wallet bot', `${keystore.list().length} (${keystore.evm().length} EVM · ${keystore.list().filter((w) => w.type === 'SOL').length} SOL)`],
            ['⚡ Auto-mint', S.autoMint ? 'ON' : 'OFF', S.autoMint ? 'ok' : ''],
            ['⛽ Gas', `${S.gasMode === 'auto' ? 'Auto' : GAS_PRESETS[S.gasPreset] ? GAS_PRESETS[S.gasPreset].label : 'Custom'} · ${S.gwei} gwei`],
            ['🛡️ Cap', `${S.maxPriceEth} ETH · gap ${S.gapPct}% · budg ${S.budgetEth}`],
          ]) +
          `\n\n<i>Chain aktif: ${esc(config.chainsEnabled.join(', '))}</i>\n<i>Halaman di bawah edit pesan ini — chat tetap bersih.</i>`,
        keyboard: new InlineKeyboard()
          .text('📊 Statistik', 'nv:stats').text('💼 Saldo', 'nv:saldo').row()
          .text('⚙️ Pengaturan', 'nv:set').text('👛 Wallet', 'nv:wallet').row()
          .text('🔄 Refresh', 'nv:menu').text('❓ Bantuan', 'nv:help'),
      }
    }
  }
}

/* ── aksi setting ── */

export function settingToggle(field: 'autoMint' | 'confirmSend' | 'autoGas'): void {
  if (field === 'autoGas') {
    updateSettings({ gasMode: settings.gasMode === 'auto' ? 'custom' : 'auto' })
    return
  }
  updateSettings({ [field]: !settings[field] } as never)
}

const STEP_TABLE = {
  maxPriceEth: PRICE_STEPS,
  maxQty: QTY_STEPS,
  reviewTimeoutSec: TIMEOUT_STEPS,
  gapPct: GAP_STEPS,
  budgetEth: BUDGET_STEPS,
} as const

export function settingStep(field: keyof typeof STEP_TABLE): void {
  const steps = STEP_TABLE[field] as readonly number[]
  const cur = Number(settings[field])
  const idx = steps.indexOf(cur)
  const next = steps[(idx + 1 + steps.length) % steps.length] ?? steps[0]
  updateSettings({ [field]: next } as never)
}
