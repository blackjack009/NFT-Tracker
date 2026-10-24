import { Bot, InlineKeyboard } from 'grammy'
import { config } from '../config.js'
import type { Card } from './messages.js'
import { stripHtml } from '../utils/format.js'

/**
 * Low-level Telegram: kirim/edit kartu (pesan + inline keyboard).
 * Controller di controller.ts yang punya logika interaksi.
 */

let bot: Bot | null = null

export interface MsgRef {
  chatId: number
  msgId: number
}

export function telegramEnabled(): boolean {
  return !!(config.telegramToken && config.telegramChatId)
}

export function getBot(): Bot {
  if (!bot) throw new Error('telegram belum di-init')
  return bot
}

export async function initTelegram(register: (bot: Bot) => void): Promise<void> {
  if (!telegramEnabled()) {
    console.log('[telegram] token/chatId kosong → notif dicetak ke console saja')
    return
  }
  bot = new Bot(config.telegramToken)
  register(bot)
  bot.catch((err) => console.error('[telegram] bot error:', err.error))
  const me = await bot.api.getMe()
  void bot.start({ onStart: () => console.log(`[telegram] bot aktif sebagai @${me.username}`) })
}

/** Kirim kartu; return ref kalau sukses (buat edit-in-place berikutnya). */
export async function sendCard(card: Card): Promise<MsgRef | null> {
  if (!bot || !config.telegramChatId) {
    console.log(`────────── [NOTIF] ──────────\n${stripHtml(card.text)}\n─────────────────────────────`)
    return null
  }
  try {
    const msg = await bot.api.sendMessage(config.telegramChatId, card.text, {
      parse_mode: 'HTML',
      reply_markup: card.keyboard,
      link_preview_options: { is_disabled: true },
    })
    return { chatId: msg.chat.id, msgId: msg.message_id }
  } catch (e) {
    console.error('[telegram] sendMessage gagal:', e instanceof Error ? e.message : e)
    return null
  }
}

/** Edit kartu di tempat (teks + keyboard); fallback kirim baru kalau edit gagal. */
export async function editCard(ref: MsgRef | null, card: Card): Promise<MsgRef | null> {
  if (!bot || !ref) return sendCard(card)
  try {
    await bot.api.editMessageText(ref.chatId, ref.msgId, card.text, {
      parse_mode: 'HTML',
      reply_markup: card.keyboard,
      link_preview_options: { is_disabled: true },
    })
    return ref
  } catch {
    return sendCard(card)
  }
}

export async function notify(text: string, keyboard?: InlineKeyboard): Promise<void> {
  await sendCard({ text, keyboard: keyboard ?? new InlineKeyboard() })
}

export async function toast(chatId: number, cbId: string, text: string): Promise<void> {
  if (!bot) return
  await bot.api
    .answerCallbackQuery(cbId, { text, show_alert: false })
    .catch(() => {})
  void chatId
}

export async function deleteMessage(chatId: number, msgId: number): Promise<void> {
  if (!bot) return
  await bot.api.deleteMessage(chatId, msgId).catch(() => {})
}

export { InlineKeyboard }
