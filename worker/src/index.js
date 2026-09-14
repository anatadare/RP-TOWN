// RP Town — bot Telegram + agent NPC + webhook, versi Cloudflare Workers.
//
// Beda paling mendasar dari versi Railway (bot/index.js + bot/agents/runner.js):
// - Dulu: 9 proses Telegraf (1 bot utama + 8 NPC agent) polling terus-terusan
//   di 1 container Node yang nyala 24 jam.
// - Sekarang: SEMUANYA lewat 1 Worker, mode webhook. Tiap bot (termasuk
//   tiap NPC agent) punya URL webhook sendiri (lihat routing di bawah),
//   Telegram yang manggil kita tiap ada pesan baru — bukan kita yang
//   nanya-nanya terus (polling). Gak ada proses yang "nyala" pas nganggur.
//
// Routing:
//   POST /webhook/main              -> bot utama (/start, /town)
//   POST /webhook/agent/:agentKey   -> 1 NPC agent (contoh: penghulu-1, assistant-2)
//   POST /webhooks/house-rented     -> webhook dari Supabase Database Webhooks
//   GET  /                          -> health check
//   GET  /debug/models              -> HAPUS SETELAH SELESAI DIPAKAI. Nampilin
//                                       daftar model ID persis dari Jerouter
//                                       (proxy ke GET /v1/models mereka),
//                                       biar bisa dicek langsung dari browser
//                                       tanpa perlu Postman/terminal.

import { Bot, webhookCallback } from 'grammy'
import { createClient } from '@supabase/supabase-js'
import { loadAgents } from './config.js'
import {
  handlePenghuluMessage,
  handlePegawaiMessage,
  handlePegawaiTimeout,
  sortAgentsByPegawaiPriority,
} from './agentLogic.js'
import { handleHouseRentedWebhook } from './houseWebhook.js'
import { registerMainBotHandlers } from './mainBot.js'

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    if (url.pathname === '/' && request.method === 'GET') {
      return new Response('RP Town bot & webhook server aktif (Cloudflare Workers)')
    }

    if (url.pathname === '/debug/models' && request.method === 'GET') {
      return handleDebugModels(env)
    }

    if (url.pathname === '/webhooks/house-rented' && request.method === 'POST') {
      return handleHouseRentedWebhook(request, env)
    }

    if (url.pathname === '/webhook/main' && request.method === 'POST') {
      return handleMainBotWebhook(request, env)
    }

    const agentMatch = url.pathname.match(/^\/webhook\/agent\/([a-z]+-\d+)$/)
    if (agentMatch && request.method === 'POST') {
      return handleAgentWebhook(request, env, agentMatch[1])
    }

    return new Response('not found', { status: 404 })
  },
}

// SEMENTARA -- hapus fungsi ini (dan route-nya di atas) begitu udah gak
// butuh ngecek nama model lagi. Cuma proxy tipis ke GET /v1/models Jerouter
// pakai AI_API_KEY yang udah ada di env, biar hasilnya bisa dilihat langsung
// dari browser tanpa expose apa pun selain daftar model.
async function handleDebugModels(env) {
  try {
    const res = await fetch('https://je.jerouter.web.id/v1/models', {
      headers: { Authorization: `Bearer ${env.AI_API_KEY}` },
    })
    const text = await res.text()
    return new Response(text, {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(`Gagal fetch: ${err.message}`, { status: 500 })
  }
}

// grammY punya timeout bawaan 10 detik di webhookCallback (default
// onTimeout: "throw") -- itu penyebab asli error "Request timed out after
// 10000 ms", BUKAN Cloudflare yang motong paksa (Workers gratisan gak
// punya batas durasi, cuma batas CPU time, dan CPU time gak ngitung waktu
// nunggu fetch ke API luar). Jadi cukup dinaikin di sini, gak perlu
// infrastruktur tambahan apa pun.
const WEBHOOK_OPTIONS = {
  onTimeout: 'return', // kalau toh masih kena limit ini, balikin 200 diem-diem (bukan throw -> 500)
  timeoutMilliseconds: 20000, // > total budget di aiClient.js (15s), kasih ruang buat sisanya (fetch history, dsb)
}

async function handleMainBotWebhook(request, env) {
  const bot = new Bot(env.BOT_TOKEN)
  registerMainBotHandlers(bot, env)
  return webhookCallback(bot, 'cloudflare-mod', WEBHOOK_OPTIONS)(request)
}

async function handleAgentWebhook(request, env, agentKey) {
  const { allAgents, penghuluAgents, assistantAgents } = loadAgents(env)
  const agent = allAgents.find((a) => a.key === agentKey)

  if (!agent) {
    // Agent ini belum dikonfigurasi lengkap (token/grup/API key kosong di
    // env) -- balikin 200 kosong (bukan error) biar Telegram gak nganggep
    // webhook-nya gagal & terus nyoba ulang.
    return new Response('agent not configured, skipped', { status: 200 })
  }

  const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
  const pegawaiPriorityAgents = sortAgentsByPegawaiPriority(assistantAgents)

  const bot = new Bot(agent.token)
  const groupIdSet = new Set(agent.groupIds.map(String))
  const threadIdSet = agent.threadIds ? new Set(agent.threadIds.map(String)) : null

  bot.on('message', async (botCtx) => {
    try {
      // Jangan pernah balas pesan dari bot lain (termasuk sesama bot RP Town)
      // -- tanpa ini gampang kejadian bot saling balas pesan bot lain terus
      // (loop tak berujung). Sama kayak versi Railway.
      if (botCtx.from?.is_bot) return
      if (!groupIdSet.has(String(botCtx.chat.id))) return

      const threadId = botCtx.message.message_thread_id ?? null
      if (threadIdSet && !threadIdSet.has(String(threadId))) return

      // SEMENTARA -- buat debug "kenapa kelihatan ke-call semua agent".
      // Setiap agent yang LOLOS filter grup+thread bakal muncul di sini.
      // Kirim 1 pesan test di 1 thread, terus cek Cloudflare Logs/Observability:
      // kalau ada agent.key yang gak semestinya proses thread itu, berarti
      // THREAD_IDS-nya salah isi (bukan cuma soal kosong/gak, tapi isinya
      // typo/nomor keliru). HAPUS baris console.log ini setelah selesai dicek.
      console.log(
        `[DEBUG-THREAD] agent=${agent.key} kind=${agent.kind} chatId=${botCtx.chat.id} threadId=${threadId} configuredThreadIds=${agent.threadIds ? agent.threadIds.join(',') : '(SEMUA THREAD, gak dibatasi!)'}`
      )

      const text = botCtx.message.text || botCtx.message.caption
      if (!text) return

      if (agent.kind === 'penghulu') {
        await handlePenghuluMessage(supabaseAdmin, agent, botCtx, text, threadId, { penghuluAgents })
      } else {
        await handlePegawaiMessage(supabaseAdmin, agent, botCtx, text, threadId, {
          penghuluAgents,
          pegawaiPriorityKeys: pegawaiPriorityAgents.map((a) => a.key),
          pegawaiPriorityNames: pegawaiPriorityAgents.map((a) => a.name),
        })
      }
    } catch (err) {
      console.error(`[${agent.key}] error:`, err)
      // Jangan biarin warga nunggu tanpa kepastian -- kasih tau ada gangguan,
      // daripada bot keliatan "gak ngerespon sama sekali".
      // (ambil ulang threadId di sini karena yang di dalam try itu
      // block-scoped, gak kebaca dari catch)
      const fallbackThreadId = botCtx.message?.message_thread_id ?? null

      if (agent.kind !== 'penghulu') {
        // Pegawai (Naya/Mimi/Cika): ganti fallback generik dengan template
        // "pergi sebentar" -- trigger cuma sekali per episode timeout, sisanya
        // diemin aja (lihat handlePegawaiTimeout + awayState.js). Pesan warga
        // yang bikin ini ke-trigger tetap kesimpen normal, gak hilang.
        try {
          await handlePegawaiTimeout(supabaseAdmin, agent, botCtx, fallbackThreadId)
          return
        } catch (timeoutErr) {
          // handlePegawaiTimeout SENDIRI gagal (bukan cuma "udah away duluan"
          // -- itu return null biasa, bukan throw) -- kemungkinan besar
          // tabel pegawai_away_state belum ada / gak keakses. JANGAN diemin
          // warga total, jatuh ke fallback generik lama di bawah biar tetap
          // ada balasan.
          console.error(`[${agent.key}] gagal jalanin handlePegawaiTimeout, jatuh ke fallback lama:`, timeoutErr)
        }
      }

      // Fallback generik lama -- dipakai buat Penghulu, ATAU buat Pegawai
      // kalau handlePegawaiTimeout di atas sendiri gagal total.
      try {
        await botCtx.reply('_(sinyal lagi kurang bagus, coba kirim pesannya sekali lagi ya)_', {
          message_thread_id: fallbackThreadId,
          parse_mode: 'Markdown',
        })
      } catch (replyErr) {
        console.error(`[${agent.key}] gagal kirim fallback reply:`, replyErr)
      }
    }
  })

  return webhookCallback(bot, 'cloudflare-mod', WEBHOOK_OPTIONS)(request)
}
