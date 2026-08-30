// Runner buat 8 NPC agent (5 Penghulu + 3 Asisten).
//
// Tiap agent = 1 instance Telegraf sendiri (token sendiri dari BotFather),
// semuanya connect ke Supabase yang SAMA lewat service_role key. Karena
// state (wedding_sessions, agent_message_claims) disimpan di database
// (bukan in-memory per-proses), 1 "karakter" bisa aja logically hadir di
// banyak room/thread sekaligus tanpa nabrak satu sama lain — sesuai rencana
// "1 agent bisa hadir di banyak room asal state dipisah per room".

const { Telegraf } = require('telegraf')
const { createClient } = require('@supabase/supabase-js')

const {
  AGENTS,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  KUA_GROUP_CHAT_ID,
  TRIGGER_WORD_PENGHULU,
  TRIGGER_WORD_ASSISTANT,
} = require('./config')

// SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY sebenarnya sudah dibaca di
// bot/index.js juga — di sini kita baca ulang dari process.env langsung
// biar modul ini tetap bisa dipakai berdiri sendiri.
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const { runTurn } = require('./geminiClient')
const {
  SCRIPTED_LINES,
  KEYWORDS,
  textContainsAny,
  nextStage,
  buildPenghuluSystemInstruction,
} = require('./personas/penghulu')
const { buildAssistantSystemInstruction } = require('./personas/assistant')
const { updateMarriageStatusDeclaration, handleUpdateMarriageStatus } = require('./tools')
const {
  getWeddingSession,
  claimWeddingSession,
  updateWeddingSession,
  claimAssistantMessage,
} = require('./stateStore')

// Rolling history super pendek per thread, cuma buat kasih konteks ke
// Gemini pas nasihat/tanya-jawab (BUKAN sumber kebenaran state acara —
// itu selalu di kolom `stage` di database). In-memory aja, boleh hilang
// kalau proses restart, dampaknya minor (paling nasihat jadi kurang nyambung).
const shortHistory = new Map() // key: `${chatId}:${threadId}` -> array of {role, text}
const HISTORY_LIMIT = 6

function pushHistory(key, role, text) {
  const arr = shortHistory.get(key) || []
  arr.push({ role, parts: [{ text }] })
  while (arr.length > HISTORY_LIMIT) arr.shift()
  shortHistory.set(key, arr)
}

function getHistory(key) {
  return shortHistory.get(key) || []
}

// ------------------------------------------------------------------
// Helper: cari "nikahin @a dan @b" (atau variasi "dan"/"&"/",") di teks,
// lalu resolve ke citizen id lewat kolom `username` di tabel citizens.
// ------------------------------------------------------------------
async function resolveCoupleFromText(text) {
  const mentionRegex = /@([a-zA-Z0-9_]{3,})/g
  const matches = [...text.matchAll(mentionRegex)].map((m) => m[1])
  if (matches.length < 2) return null

  const [usernameA, usernameB] = matches

  const { data, error } = await supabaseAdmin
    .from('citizens')
    .select('id, username, display_name')
    .in('username', [usernameA, usernameB])

  if (error) throw error

  const citizenA = data.find((c) => c.username?.toLowerCase() === usernameA.toLowerCase())
  const citizenB = data.find((c) => c.username?.toLowerCase() === usernameB.toLowerCase())

  return {
    usernameA,
    usernameB,
    citizenA: citizenA || null,
    citizenB: citizenB || null,
  }
}

function labelFor(citizen, fallbackUsername) {
  return citizen ? citizen.display_name || `@${citizen.username}` : `@${fallbackUsername}`
}

// ------------------------------------------------------------------
// Penghulu
// ------------------------------------------------------------------
async function handlePenghuluMessage(agent, ctx, text, threadId) {
  if (threadId == null) return // penghulu cuma aktif di dalam topic/thread pernikahan

  const chatId = ctx.chat.id
  const historyKey = `${chatId}:${threadId}`
  const mentionsTrigger = text.toLowerCase().includes(TRIGGER_WORD_PENGHULU)

  let session = await getWeddingSession(supabaseAdmin, { chatId, threadId })

  // ---- Belum ada sesi di thread ini ----
  if (!session) {
    if (!mentionsTrigger) return

    session = await claimWeddingSession(supabaseAdmin, { chatId, threadId, agentKey: agent.key })
    if (!session) return // sudah diklaim penghulu lain (race condition antar 5 bot)

    // Coba langsung resolve mempelai dari pesan yang sama (mis. "penghulu nikahin @a dan @b")
    const couple = await resolveCoupleFromText(text)
    if (couple && couple.citizenA && couple.citizenB) {
      await startCeremony(agent, ctx, threadId, session, couple)
    } else {
      await ctx.reply(SCRIPTED_LINES.askForCouple(agent.name), { message_thread_id: threadId })
    }
    return
  }

  // ---- Sesi ini bukan punya agent ini -> diam ----
  if (session.agent_key !== agent.key) return

  if (session.stage === 'selesai') {
    if (mentionsTrigger) await ctx.reply(SCRIPTED_LINES.alreadyDone(), { message_thread_id: threadId })
    return
  }

  // ---- Masih nunggu nama mempelai ----
  if (session.stage === 'pembukaan' && !session.partner_a_id) {
    const couple = await resolveCoupleFromText(text)
    if (!couple) {
      if (mentionsTrigger) await ctx.reply(SCRIPTED_LINES.needCouple(), { message_thread_id: threadId })
      return
    }
    if (!couple.citizenA || !couple.citizenB) {
      await ctx.reply(SCRIPTED_LINES.couldNotResolve(`@${couple.usernameA}`, `@${couple.usernameB}`), {
        message_thread_id: threadId,
      })
      return
    }
    await startCeremony(agent, ctx, threadId, session, couple)
    return
  }

  const nameA = session.partner_a_label
  const nameB = session.partner_b_label

  // ---- Tahap ijab_kabul: nunggu kata kunci "sah" (deterministik, bukan AI) ----
  if (session.stage === 'ijab_kabul' && textContainsAny(text, KEYWORDS.confirmIjab)) {
    const updated = await updateWeddingSession(supabaseAdmin, session.id, { stage: nextStage(session.stage) })
    await ctx.reply(SCRIPTED_LINES.doa(nameA, nameB), { message_thread_id: threadId })

    // Tool call beneran ke database, dipicu KODE (bukan AI) begitu tahap
    // ijab-kabul dinyatakan sah — sesuai rencana "backend yang nyimpen &
    // validasi status, bukan AI yang nulis langsung ke DB".
    try {
      await handleUpdateMarriageStatus(supabaseAdmin, {
        citizenAId: updated.partner_a_id,
        citizenBId: updated.partner_b_id,
      })
    } catch (err) {
      console.error(`[${agent.key}] gagal update_marriage_status:`, err)
    }
    return
  }

  // ---- Tahap doa: nunggu "nasihat" (AI) atau "selesai" (scripted) ----
  if (session.stage === 'doa') {
    if (textContainsAny(text, KEYWORDS.closeCeremony)) {
      await updateWeddingSession(supabaseAdmin, session.id, { stage: nextStage(nextStage(session.stage)) }) // doa -> penutup -> selesai
      await ctx.reply(SCRIPTED_LINES.penutup(nameA, nameB), { message_thread_id: threadId })
      return
    }

    if (textContainsAny(text, KEYWORDS.askAdvice) || text.includes('?')) {
      pushHistory(historyKey, 'user', text)
      const { text: reply } = await runTurn({
        systemInstruction: buildPenghuluSystemInstruction(agent.name),
        history: getHistory(historyKey),
        userMessage: `[Konteks: prosesi pernikahan ${nameA} & ${nameB}, tahap saat ini: doa/setelah ijab-kabul]\nPesan tamu: ${text}`,
      })
      pushHistory(historyKey, 'model', reply)
      await ctx.reply(reply, { message_thread_id: threadId })
    }
    return
  }

  // ---- Tahap pembukaan/ijab_kabul lain: pertanyaan bebas -> AI ----
  if (mentionsTrigger || text.includes('?')) {
    pushHistory(historyKey, 'user', text)
    const { text: reply } = await runTurn({
      systemInstruction: buildPenghuluSystemInstruction(agent.name),
      history: getHistory(historyKey),
      userMessage: `[Konteks: prosesi pernikahan ${nameA || '(mempelai A)'} & ${nameB || '(mempelai B)'}, tahap saat ini: ${session.stage}]\nPesan tamu: ${text}`,
    })
    pushHistory(historyKey, 'model', reply)
    await ctx.reply(reply, { message_thread_id: threadId })
  }
}

async function startCeremony(agent, ctx, threadId, session, couple) {
  const nameA = labelFor(couple.citizenA, couple.usernameA)
  const nameB = labelFor(couple.citizenB, couple.usernameB)

  await updateWeddingSession(supabaseAdmin, session.id, {
    partner_a_id: couple.citizenA.id,
    partner_b_id: couple.citizenB.id,
    partner_a_label: nameA,
    partner_b_label: nameB,
    stage: 'ijab_kabul',
  })

  await ctx.reply(SCRIPTED_LINES.pembukaan(nameA, nameB), { message_thread_id: threadId })
  await ctx.reply(SCRIPTED_LINES.ijab_kabul(nameA, nameB), { message_thread_id: threadId })
}

// ------------------------------------------------------------------
// Asisten
// ------------------------------------------------------------------
async function handleAssistantMessage(agent, ctx, text, threadId) {
  if (!text.toLowerCase().includes(TRIGGER_WORD_ASSISTANT)) return

  const claimed = await claimAssistantMessage(supabaseAdmin, {
    chatId: ctx.chat.id,
    messageId: ctx.message.message_id,
    agentKey: agent.key,
  })
  if (!claimed) return // salah satu dari 2 asisten lain sudah lebih cepat ambil pertanyaan ini

  const { text: reply } = await runTurn({
    systemInstruction: buildAssistantSystemInstruction(agent.name),
    history: [],
    userMessage: text,
  })

  await ctx.reply(reply, threadId != null ? { message_thread_id: threadId } : undefined)
}

// ------------------------------------------------------------------
// Bootstrap
// ------------------------------------------------------------------
function startAgents() {
  if (!KUA_GROUP_CHAT_ID) {
    console.warn('[agents] KUA_GROUP_CHAT_ID belum diisi, agent NPC tidak dijalankan.')
    return
  }
  if (AGENTS.length === 0) {
    console.warn('[agents] Tidak ada agent dengan token valid, tidak ada yang dijalankan.')
    return
  }

  for (const agent of AGENTS) {
    startAgent(agent)
  }
}

function startAgent(agent) {
  const bot = new Telegraf(agent.token)

  bot.on('message', async (ctx) => {
    try {
      if (String(ctx.chat.id) !== String(KUA_GROUP_CHAT_ID)) return

      const text = ctx.message.text || ctx.message.caption
      if (!text) return

      const threadId = ctx.message.message_thread_id ?? null

      if (agent.kind === 'penghulu') {
        await handlePenghuluMessage(agent, ctx, text, threadId)
      } else {
        await handleAssistantMessage(agent, ctx, text, threadId)
      }
    } catch (err) {
      console.error(`[${agent.key}] error:`, err)
    }
  })

  bot.launch()
  console.log(`[agents] ${agent.key} ("${agent.name}") jalan...`)

  process.once('SIGINT', () => bot.stop('SIGINT'))
  process.once('SIGTERM', () => bot.stop('SIGTERM'))
}

module.exports = { startAgents }
