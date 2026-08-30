// Runner buat 8 NPC agent (5 Penghulu + 3 Pegawai).
//
// Tiap agent = 1 instance Telegraf sendiri (token sendiri dari BotFather),
// semuanya connect ke Supabase yang SAMA lewat service_role key. Karena
// state (wedding_sessions, agent_message_claims) disimpan di database
// (bukan in-memory per-proses), 1 "karakter" bisa aja logically hadir di
// banyak room/thread sekaligus tanpa nabrak satu sama lain — sesuai rencana
// "1 agent bisa hadir di banyak room asal state dipisah per room".
//
// Ada 2 alur yang dipandu Penghulu di 1 thread:
// - 'marriage' : nikah (suami/istri) — alur lama, 5 tahap (pembukaan s.d. selesai).
// - 'family'   : ekspansi silsilah (mommy/daddy/kaka/abang/nenek/kakek/paman/tante)
//                — alur baru, 3 tahap (pembukaan -> konfirmasi -> selesai).
// Keduanya disimpan di tabel `wedding_sessions` yang sama, dibedakan lewat
// kolom `session_type` (lihat database/migration-006-family-tree.sql).

const { Telegraf } = require('telegraf')
const { createClient } = require('@supabase/supabase-js')

const {
  AGENTS,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  TRIGGER_WORD_PENGHULU,
  TRIGGER_WORDS_PEGAWAI,
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
  FAMILY_SCRIPTED_LINES,
  FAMILY_RELATION_LABELS,
  KEYWORDS,
  FAMILY_CONFIRM_KEYWORDS,
  textContainsAny,
  nextStage,
  detectFamilyRelationType,
  buildPenghuluSystemInstruction,
} = require('./personas/penghulu')
const { buildPegawaiSystemInstruction } = require('./personas/pegawai')
const { updateMarriageStatusDeclaration, handleUpdateMarriageStatus, handleAddFamilyRelation } = require('./tools')
const {
  getWeddingSession,
  claimWeddingSession,
  updateWeddingSession,
  claimAssistantMessage,
} = require('./stateStore')
const { getRoomAvailabilitySummary, formatRoomAvailabilityContext } = require('./roomStatus')

// Kata kunci yang nandain warga lagi nanya soal ketersediaan ruangan —
// dipakai Pegawai buat mutusin perlu nge-query data ruangan asli atau nggak.
const ROOM_AVAILABILITY_KEYWORDS = ['ruang', 'room', 'kosong', 'sepi', 'kamar']

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

async function resolveCitizenByTelegramId(telegramId) {
  const { data, error } = await supabaseAdmin
    .from('citizens')
    .select('id, username, display_name')
    .eq('telegram_id', telegramId)
    .maybeSingle()

  if (error) throw error
  return data
}

// ------------------------------------------------------------------
// Helper: cari siapa "related" (warga yang didaftarkan jadi mommy/daddy/dst)
// dan siapa "subject" (warga yang jadi pemilik relasi itu) dari teks.
//
// Dukung 2 pola:
// 1. "penghulu daftarin @sari jadi mommy aku"   -> 1 mention -> related =
//    @sari, subject = warga yang ngirim pesan ini sendiri.
// 2. "penghulu daftarin @sari jadi mommy @budi" -> 2 mention -> related =
//    mention pertama, subject = mention kedua.
// ------------------------------------------------------------------
async function resolveFamilyPartiesFromText(text, ctx) {
  const mentionRegex = /@([a-zA-Z0-9_]{3,})/g
  const matches = [...text.matchAll(mentionRegex)].map((m) => m[1])
  if (matches.length === 0) return null

  if (matches.length >= 2) {
    const [usernameRelated, usernameSubject] = matches
    const { data, error } = await supabaseAdmin
      .from('citizens')
      .select('id, username, display_name')
      .in('username', [usernameRelated, usernameSubject])
    if (error) throw error

    const citizenRelated = data.find((c) => c.username?.toLowerCase() === usernameRelated.toLowerCase()) || null
    const citizenSubject = data.find((c) => c.username?.toLowerCase() === usernameSubject.toLowerCase()) || null

    return { usernameRelated, usernameSubject, citizenRelated, citizenSubject }
  }

  const usernameRelated = matches[0]
  const { data: relatedRow, error: relatedError } = await supabaseAdmin
    .from('citizens')
    .select('id, username, display_name')
    .ilike('username', usernameRelated)
    .maybeSingle()
  if (relatedError) throw relatedError

  const citizenSubject = await resolveCitizenByTelegramId(ctx.from.id)
  const usernameSubject = ctx.from.username || ctx.from.first_name || 'kamu'

  return { usernameRelated, usernameSubject, citizenRelated: relatedRow || null, citizenSubject }
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

    // Cek dulu apakah ini permintaan ekspansi silsilah (mommy/daddy/dst),
    // bukan nikah biasa. Kalau ketemu kata kunci family, alur ini KHUSUS
    // family (lebih singkat), terpisah dari alur nikah di bawah.
    const familyRelationType = detectFamilyRelationType(text)
    if (familyRelationType) {
      const familySession = await claimWeddingSession(supabaseAdmin, {
        chatId,
        threadId,
        agentKey: agent.key,
        sessionType: 'family',
        relationType: familyRelationType,
      })
      if (!familySession) return // sudah diklaim penghulu lain

      const parties = await resolveFamilyPartiesFromText(text, ctx)
      if (parties && parties.citizenRelated && parties.citizenSubject) {
        await startFamilyRegistration(agent, ctx, threadId, familySession, parties, familyRelationType)
      } else {
        const relationLabel = FAMILY_RELATION_LABELS[familyRelationType]
        await ctx.reply(FAMILY_SCRIPTED_LINES.askForTarget(agent.name, relationLabel), {
          message_thread_id: threadId,
        })
      }
      return
    }

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

  // ---- Sesi tipe 'family' punya alur & tahapannya sendiri, dilempar ke
  //      handler terpisah biar nggak nyampur sama state machine nikah ----
  if (session.session_type === 'family') {
    await handleFamilyMessage(agent, ctx, text, threadId, session)
    return
  }

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
// Penghulu — alur ekspansi silsilah keluarga (mommy/daddy/kaka/abang/
// nenek/kakek/paman/tante). Lebih singkat dari nikah: cuma 3 tahap
// (pembukaan -> konfirmasi -> selesai), sesuai keputusan project.
// `session.partner_a_id/label` dipakai sebagai SUBJEK (pemilik relasi),
// `session.partner_b_id/label` dipakai sebagai TARGET (yang didaftarkan).
// ------------------------------------------------------------------
async function startFamilyRegistration(agent, ctx, threadId, session, parties, relationType) {
  const relationLabel = FAMILY_RELATION_LABELS[relationType]
  const subjectLabel = labelFor(parties.citizenSubject, parties.usernameSubject)
  const relatedLabel = labelFor(parties.citizenRelated, parties.usernameRelated)

  await updateWeddingSession(supabaseAdmin, session.id, {
    partner_a_id: parties.citizenSubject.id,
    partner_a_label: subjectLabel,
    partner_b_id: parties.citizenRelated.id,
    partner_b_label: relatedLabel,
    stage: 'konfirmasi',
  })

  await ctx.reply(FAMILY_SCRIPTED_LINES.pembukaan(subjectLabel, relatedLabel, relationLabel), {
    message_thread_id: threadId,
  })
}

async function handleFamilyMessage(agent, ctx, text, threadId, session) {
  const chatId = ctx.chat.id
  const historyKey = `${chatId}:${threadId}:family`
  const mentionsTrigger = text.toLowerCase().includes(TRIGGER_WORD_PENGHULU)
  const relationType = session.relation_type
  const relationLabel = FAMILY_RELATION_LABELS[relationType]

  if (session.stage === 'selesai') {
    if (mentionsTrigger) await ctx.reply(FAMILY_SCRIPTED_LINES.alreadyDone(), { message_thread_id: threadId })
    return
  }

  // ---- Masih nunggu target didaftarkan ----
  if (session.stage === 'pembukaan' && !session.partner_b_id) {
    const parties = await resolveFamilyPartiesFromText(text, ctx)
    if (!parties) {
      if (mentionsTrigger) await ctx.reply(FAMILY_SCRIPTED_LINES.needTarget(relationLabel), { message_thread_id: threadId })
      return
    }
    if (!parties.citizenRelated || !parties.citizenSubject) {
      await ctx.reply(FAMILY_SCRIPTED_LINES.couldNotResolve(`@${parties.usernameRelated}`), {
        message_thread_id: threadId,
      })
      return
    }
    await startFamilyRegistration(agent, ctx, threadId, session, parties, relationType)
    return
  }

  const subjectLabel = session.partner_a_label
  const relatedLabel = session.partner_b_label

  // ---- Tahap konfirmasi: nunggu kata kunci "sah" (deterministik, bukan AI) ----
  if (session.stage === 'konfirmasi' && textContainsAny(text, FAMILY_CONFIRM_KEYWORDS)) {
    await updateWeddingSession(supabaseAdmin, session.id, { stage: 'selesai' })
    await ctx.reply(FAMILY_SCRIPTED_LINES.selesai(subjectLabel, relatedLabel, relationLabel), {
      message_thread_id: threadId,
    })

    // Tool call beneran ke database, dipicu KODE (bukan AI) begitu tahap
    // konfirmasi dinyatakan sah — sama prinsipnya kayak alur nikah.
    try {
      await handleAddFamilyRelation(supabaseAdmin, {
        citizenId: session.partner_a_id,
        relatedCitizenId: session.partner_b_id,
        relationType,
        agentKey: agent.key,
      })
    } catch (err) {
      console.error(`[${agent.key}] gagal add_family_relation:`, err)
    }
    return
  }

  // ---- Pertanyaan bebas di tengah alur family -> AI (nggak pernah nulis data) ----
  if (mentionsTrigger || text.includes('?')) {
    pushHistory(historyKey, 'user', text)
    const { text: reply } = await runTurn({
      systemInstruction: buildPenghuluSystemInstruction(agent.name),
      history: getHistory(historyKey),
      userMessage:
        `[Konteks: pendaftaran silsilah keluarga — ${relatedLabel || '(target)'} didaftarkan sebagai ${relationLabel} ` +
        `dari ${subjectLabel || '(subjek)'}, tahap saat ini: ${session.stage}]\nPesan tamu: ${text}`,
    })
    pushHistory(historyKey, 'model', reply)
    await ctx.reply(reply, { message_thread_id: threadId })
  }
}

// ------------------------------------------------------------------
// Pegawai (Mimi, Naya, Cika) — guide murni, nggak ikut mencatat/mengesahkan.
// ------------------------------------------------------------------
async function handlePegawaiMessage(agent, ctx, text, threadId) {
  const lower = text.toLowerCase()
  if (!TRIGGER_WORDS_PEGAWAI.some((word) => lower.includes(word))) return

  const claimed = await claimAssistantMessage(supabaseAdmin, {
    chatId: ctx.chat.id,
    messageId: ctx.message.message_id,
    agentKey: agent.key,
  })
  if (!claimed) return // salah satu dari 2 pegawai lain sudah lebih cepat ambil pertanyaan ini

  // Kalau warga kelihatannya nanya soal ketersediaan ruangan, ambil data
  // ASLI dari DB dulu (bukan biar AI nebak-nebak) baru dikasih ke AI
  // sebagai konteks buat dibungkus sesuai gaya persona.
  let roomStatusContext = null
  if (ROOM_AVAILABILITY_KEYWORDS.some((kw) => lower.includes(kw))) {
    try {
      const summary = await getRoomAvailabilitySummary(supabaseAdmin)
      roomStatusContext = formatRoomAvailabilityContext(summary)
    } catch (err) {
      console.error(`[${agent.key}] gagal ambil status ruangan:`, err)
    }
  }

  const { text: reply } = await runTurn({
    systemInstruction: buildPegawaiSystemInstruction(agent.name, roomStatusContext),
    history: [],
    userMessage: text,
  })

  await ctx.reply(reply, threadId != null ? { message_thread_id: threadId } : undefined)
}

// ------------------------------------------------------------------
// Bootstrap
// ------------------------------------------------------------------
function startAgents() {
  if (AGENTS.length === 0) {
    console.warn('[agents] Tidak ada agent dengan token & grup valid, tidak ada yang dijalankan.')
    return
  }

  for (const agent of AGENTS) {
    startAgent(agent)
  }
}

function startAgent(agent) {
  const bot = new Telegraf(agent.token)
  // Set biar cek grup cepat, dan aman dibanding-bandingkan sebagai string
  // (chat id dari Telegram numeric, tapi kita simpen/baca dari .env sebagai string).
  const groupIdSet = new Set(agent.groupIds.map(String))
  const threadIdSet = agent.threadIds ? new Set(agent.threadIds.map(String)) : null

  bot.on('message', async (ctx) => {
    try {
      if (!groupIdSet.has(String(ctx.chat.id))) return

      const threadId = ctx.message.message_thread_id ?? null

      // Kalau agent ini punya batasan room/topic (*_THREAD_IDS diisi),
      // pesan di luar room-nya diabaikan — biar Gavin cuma jawab di 2
      // room miliknya, bukan di semua room dalam 1 grup yang sama.
      if (threadIdSet && !threadIdSet.has(String(threadId))) return

      const text = ctx.message.text || ctx.message.caption
      if (!text) return

      if (agent.kind === 'penghulu') {
        await handlePenghuluMessage(agent, ctx, text, threadId)
      } else {
        await handlePegawaiMessage(agent, ctx, text, threadId)
      }
    } catch (err) {
      console.error(`[${agent.key}] error:`, err)
    }
  })

  bot.launch()
  const roomsLabel = agent.threadIds ? ` (room: ${agent.threadIds.join(', ')})` : ''
  console.log(`[agents] ${agent.key} ("${agent.name}") jalan di grup: ${agent.groupIds.join(', ')}${roomsLabel}`)

  process.once('SIGINT', () => bot.stop('SIGINT'))
  process.once('SIGTERM', () => bot.stop('SIGTERM'))
}

module.exports = { startAgents }
