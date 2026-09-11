// Bot utama — cuma 2 tugas (port dari bot/index.js versi Railway):
// 1. Buka pintu ke Mini App lewat command /start
// 2. Command /town buat balik ke peta kota
// (Tugas ke-3, terima webhook Supabase, ada di houseWebhook.js — dipisah
// karena itu bukan handler pesan Telegram, jadi rute HTTP-nya beda.)

import { InlineKeyboard } from 'grammy'

export function registerMainBotHandlers(bot, env) {
  const miniAppUrl = env.MINIAPP_URL

  bot.command('start', (ctx) => {
    const keyboard = new InlineKeyboard().webApp('🗺️ Buka Peta Kota', miniAppUrl)
    return ctx.reply(
      `Selamat datang di RP Town, ${ctx.from.first_name}! 🏘️\n\n` +
        `Ini adalah kota kecil untuk komunitas roleplay kita. Buka peta kota untuk mulai jalan-jalan, kerja, atau ngobrol di lokasi favoritmu.`,
      { reply_markup: keyboard }
    )
  })

  bot.command('town', (ctx) => {
    const keyboard = new InlineKeyboard().webApp('🗺️ Buka Peta Kota', miniAppUrl)
    return ctx.reply('Klik tombol di bawah buat balik ke peta kota:', { reply_markup: keyboard })
  })
}
