// RP Town — Bot Telegram (Telegraf) + webhook server
// Bot ini punya 2 tugas:
// 1. Buka pintu ke Mini App lewat command /start
// 2. Terima webhook dari Supabase tiap ada rumah baru disewa,
//    lalu otomatis bikin Forum Topic baru di grup Perumahan

require('dotenv').config()
const express = require('express')
const { Telegraf, Markup } = require('telegraf')
const { createClient } = require('@supabase/supabase-js')

const BOT_TOKEN = process.env.BOT_TOKEN
const MINIAPP_URL = process.env.MINIAPP_URL
const HOUSING_GROUP_CHAT_ID = process.env.HOUSING_GROUP_CHAT_ID // contoh: -1001234567890
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET // token rahasia biar endpoint tidak bisa dipanggil sembarang orang
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY // WAJIB service_role, bukan anon key
const PORT = process.env.PORT || 3000

for (const [key, value] of Object.entries({
  BOT_TOKEN,
  MINIAPP_URL,
  HOUSING_GROUP_CHAT_ID,
  WEBHOOK_SECRET,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
})) {
  if (!value) {
    console.error(`${key} belum diisi di .env`)
    process.exit(1)
  }
}

const bot = new Telegraf(BOT_TOKEN)
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

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

bot.launch({ dropPendingUpdates: true }).catch((err) => {
  console.error('Bot utama gagal launch:', err.message)
})
console.log('RP Town bot jalan...')

// NPC agents (Penghulu & Asisten) — proses terpisah secara logika, tapi
// dijalankan di 1 service Node yang sama biar gak perlu setup deploy baru.
// Lihat bot/agents/ untuk detailnya. Aman dipanggil walau .env agent belum
// diisi lengkap — agent yang tokennya kosong otomatis di-skip.
const { startAgents } = require('./agents/runner')
startAgents()

// ============================================
// Webhook server — dipanggil Supabase Database Webhooks
// tiap ada baris di tabel `houses` yang ter-update (owner_citizen_id keisi)
// ============================================
const app = express()
app.use(express.json())

app.post('/webhooks/house-rented', async (req, res) => {
  // Verifikasi secret, biar endpoint ini tidak bisa dipanggil orang luar sembarangan
  const secret = req.headers['x-webhook-secret']
  if (secret !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  try {
    const record = req.body?.record
    const oldRecord = req.body?.old_record

    // Cuma proses kalau ini transisi "baru disewa" (owner sebelumnya kosong, sekarang keisi)
    // dan belum pernah dibikinin topic sebelumnya
    const justRented = oldRecord?.owner_citizen_id == null && record?.owner_citizen_id != null
    const alreadyHasTopic = Boolean(record?.telegram_topic_id)

    if (!justRented || alreadyHasTopic) {
      return res.json({ skipped: true })
    }

    // Ambil nama pemilik buat judul topic
    const { data: owner, error: ownerError } = await supabaseAdmin
      .from('citizens')
      .select('display_name, username')
      .eq('id', record.owner_citizen_id)
      .single()

    if (ownerError) throw ownerError

    const ownerName = owner.display_name || owner.username || 'Warga'
    const topicTitle = `🏡 Petak ${record.plot_number} — ${ownerName}`

    // Bikin Forum Topic baru di grup Perumahan
    const topic = await bot.telegram.createForumTopic(HOUSING_GROUP_CHAT_ID, topicTitle)

    // Susun link topic. Kalau grup punya username publik, pakai format t.me/username/threadId.
    // Kalau grup private, pakai format t.me/c/<chatId tanpa awalan -100>/threadId
    let topicUrl
    const groupUsername = process.env.HOUSING_GROUP_USERNAME // opsional, isi kalau grup publik
    if (groupUsername) {
      topicUrl = `https://t.me/${groupUsername}/${topic.message_thread_id}`
    } else {
      const numericId = String(HOUSING_GROUP_CHAT_ID).replace('-100', '')
      topicUrl = `https://t.me/c/${numericId}/${topic.message_thread_id}`
    }

    // Simpan balik ke database pakai service_role key (bypass RLS)
    const { error: updateError } = await supabaseAdmin
      .from('houses')
      .update({
        telegram_topic_id: topic.message_thread_id,
        telegram_topic_url: topicUrl,
      })
      .eq('id', record.id)

    if (updateError) throw updateError

    console.log(`Topic dibuat untuk Petak ${record.plot_number}: ${topicUrl}`)
    res.json({ success: true, topicUrl })
  } catch (err) {
    console.error('Gagal membuat forum topic:', err)
    res.status(500).json({ error: err.message })
  }
})

app.get('/', (_req, res) => res.send('RP Town bot & webhook server aktif'))

app.listen(PORT, () => {
  console.log(`Webhook server jalan di port ${PORT}`)
})

process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))
