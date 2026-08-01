// RP Town — Bot Telegram (Telegraf)
// Tugas bot ini: buka pintu ke Mini App, dan (nanti) jadi NPC/scheduler dunia.

require('dotenv').config()
const { Telegraf, Markup } = require('telegraf')

const BOT_TOKEN = process.env.BOT_TOKEN
const MINIAPP_URL = process.env.MINIAPP_URL // contoh: https://rptown.vercel.app

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN belum diisi di .env')
  process.exit(1)
}
if (!MINIAPP_URL) {
  console.error('MINIAPP_URL belum diisi di .env (URL Mini App kamu di Vercel)')
  process.exit(1)
}

const bot = new Telegraf(BOT_TOKEN)

bot.start((ctx) => {
  ctx.reply(
    `Selamat datang di RP Town, ${ctx.from.first_name}! 🏘️\n\n` +
      `Ini adalah kota kecil untuk komunitas roleplay kita. Buka peta kota untuk mulai jalan-jalan, kerja, atau ngobrol di lokasi favoritmu.`,
    Markup.inlineKeyboard([
      Markup.button.webApp('🗺️ Buka Peta Kota', MINIAPP_URL),
    ])
  )
})

bot.command('town', (ctx) => {
  ctx.reply(
    'Klik tombol di bawah buat balik ke peta kota:',
    Markup.inlineKeyboard([Markup.button.webApp('🗺️ Buka Peta Kota', MINIAPP_URL)])
  )
})

// Placeholder: nanti di sini kita tambahkan
// - cron job siklus waktu/cuaca dunia
// - broadcast event / "berita kota" terjadwal
// - command admin untuk mendaftarkan link grup baru per room

bot.launch()
console.log('RP Town bot jalan...')

process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))
