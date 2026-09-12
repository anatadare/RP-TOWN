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

import { Bot, webhookCallback } from 'grammy'
import { createClient } from '@supabase/supabase-js'
import { loadAgents } from './config.js'
import { handlePenghuluMessage, handlePegawaiMessage, sortAgentsByPegawaiPriority } from './agentLogic.js'
import { handleHouseRentedWebhook } from './houseWebhook.js'
import { registerMainBotHandlers } from './mainBot.js'

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    if (url.pathname === '/' && request.method === 'GET') {
      return new Response('RP Town bot & webhook server aktif (Cloudflare Workers)')
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

async function handleMainBotWebhook(request, env) {
  const bot = new Bot(env.BOT_TOKEN)
  registerMainBotHandlers(bot, env)
  return webhookCallback(bot, 'cloudflare-mod')(request)
}

async function handleAgentWebhook(request, env, agentKey) {
  const { allAgents, penghuluAgents, assistantAgents, aiModel } = loadAgents(env)
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

      const text = botCtx.message.text || botCtx.message.caption
      if (!text) return

      if (agent.kind === 'penghulu') {
        await handlePenghuluMessage(supabaseAdmin, agent, botCtx, text, threadId, { penghuluAgents, aiModel })
      } else {
        await handlePegawaiMessage(supabaseAdmin, agent, botCtx, text, threadId, {
          penghuluAgents,
          pegawaiPriorityKeys: pegawaiPriorityAgents.map((a) => a.key),
          pegawaiPriorityNames: pegawaiPriorityAgents.map((a) => a.name),
          aiModel,
        })
      }
    } catch (err) {
      console.error(`[${agent.key}] error:`, err)
    }
  })

  return webhookCallback(bot, 'cloudflare-mod')(request)
}
