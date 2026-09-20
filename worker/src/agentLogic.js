// Logic 8 NPC agent (5 Penghulu + 3 Pegawai) — versi Workers.
//
// Beda paling penting dari bot/agents/runner.js (versi Railway):
// 1. Semua fungsi di sini terima `supabaseAdmin`, `env`/config sebagai
//    PARAMETER, bukan baca dari module-level constant — soalnya di Workers
//    gak ada proses yang "nyala terus" buat nyimpen itu di scope global
//    antar request dengan aman (tiap request bisa ditangani isolate beda).
// 2. Histori obrolan pendek (shortHistory) sekarang lewat chatHistory.js
//    (Supabase), bukan in-memory Map lagi.
// 3. `ctx` di sini datang dari grammY (bukan Telegraf), tapi bentuknya
//    sengaja dibikin mirip (ctx.chat.id, ctx.from.id, ctx.message.text,
//    sendPersonaMessage(ctx, ...)) jadi sebagian besar logic aslinya gak berubah.

import { runTurn } from './aiClient.js'
import { getHistory, pushHistory } from './chatHistory.js'
import { getAwayState, startAwayState, clearAwayState, mentionFor } from './awayState.js'
import { getAwayTemplateByIndex, fillAwayTemplate, pickRandomAwayTemplate } from './personas/awayTemplates.js'
import {
  markPenghuluTimeout,
  consumePenghuluTimeout,
  buildTimeoutBackLine,
} from './penghuluTimeoutState.js'
import { hasCapacity, enqueueCitizen, popNextWaiting } from './kuaQueue.js'
import { kickFromGroupTemporarily, buildRoomLink } from './groupMembership.js'
import { callTelegramApi } from './telegramApi.js'
import {
  SCRIPTED_LINES,
  FAMILY_SCRIPTED_LINES,
  FAMILY_RELATION_LABELS,
  KEYWORDS,
  FAMILY_CONFIRM_KEYWORDS,
  textContainsAny,
  nextStage,
  detectFamilyRelationType,
  buildPenghuluSystemInstruction,
} from './personas/penghulu.js'
import { buildPegawaiSystemInstruction } from './personas/pegawai.js'
import { handleUpdateMarriageStatus, handleAddFamilyRelation } from './tools.js'
import {
  getWeddingSession,
  claimWeddingSession,
  updateWeddingSession,
  releaseWeddingSession,
  claimPegawaiSession,
  releasePegawaiSession,
} from './stateStore.js'
import { getRoomAvailabilitySummary, formatRoomAvailabilityContext } from './roomStatus.js'

const ROOM_AVAILABILITY_KEYWORDS = ['ruang', 'room', 'kosong', 'sepi', 'kamar']
const PENGHULU_INTENT_KEYWORDS = [
  'nikah', 'kawin', 'daftar', 'penghulu', 'pengulu',
  'mommy', 'daddy', 'kaka', 'abang', 'nenek', 'kakek', 'paman', 'tante',
]
// Kata kunci yang cuma perlu nyisipin DATA status ruang Penghulu ke Pegawai
// (warga nanya "mana yang kosong/sibuk", "ruangan nomor berapa", dst) --
// lebih luas dari PENGHULU_INTENT_KEYWORDS di atas, tapi sengaja TIDAK ikut
// nutup sesi Pegawai (lihat `directingToPenghulu` di handlePegawaiMessage).
const PENGHULU_STATUS_KEYWORDS = [
  ...PENGHULU_INTENT_KEYWORDS,
  'sibuk', 'nganggur', 'luang', 'kosong', 'ruang', 'antri', 'antre',
  'anak', 'suami', 'istri', 'menikah', 'keluarga', 'silsilah', 'akad', 'pasangan',
]

// Urutan prioritas pegawai (dari config.js: agent yang beneran aktif),
// dihitung sekali per-request di index.js lalu dikirim ke handlePegawaiMessage.
export function sortAgentsByPegawaiPriority(assistantAgents) {
  // Urutan tetap: Naya -> Mimi -> Cika kalau ketiganya ada; fallback ke
  // urutan array asli buat nama lain yang gak dikenal (custom naming).
  const priorityOrder = ['Naya', 'Mimi', 'Cika']
  return [...assistantAgents].sort((a, b) => {
    const ai = priorityOrder.indexOf(a.name)
    const bi = priorityOrder.indexOf(b.name)
    if (ai === -1 && bi === -1) return 0
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })
}

// ------------------------------------------------------------------
// Pengganti ctx.reply biasa buat SEMUA balasan NPC (scripted maupun AI).
// Sama persis alasannya kayak versi bot/agents/runner.js (Railway):
// 1. Tanpa `parse_mode`, format `_gestur_` yang dipakai semua persona
//    tampil literal (underscore mentah), bukan ke-render miring.
// 2. Gestur & dialog (dipisah baris kosong, `_gestur_\n\ndialog`) dipecah
//    jadi beberapa bubble berurutan + jeda "mengetik..." kecil, biar
//    kerasa kayak NPC beneran lagi ngetik, bukan bot nembak 1 blok teks.
async function sendPersonaMessage(ctx, text, extra = {}) {
  const chunks = String(text)
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)

  if (chunks.length === 0) return

  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) {
      try {
        await ctx.replyWithChatAction('typing')
      } catch (err) {
        // status "mengetik" gagal bukan hal fatal, lanjut aja kirim pesannya
      }
      await new Promise((resolve) => setTimeout(resolve, 600 + Math.random() * 500))
    }
    await ctx.reply(chunks[i], { parse_mode: 'Markdown', ...extra })
  }
}

// Status SEMUA RUANG KUA (1 ruang = 1 topic/thread di grup KUA), dihitung dari
// config Penghulu + tabel wedding_sessions.
//
// 1 Penghulu bisa pegang LEBIH DARI 1 ruang (isi PENGHULU_i_THREAD_IDS dengan
// beberapa ID dipisah koma) -- tiap thread dihitung sebagai 1 ruang sendiri.
// Penghulu tanpa THREAD_IDS dihitung 1 ruang (tanpa link).
//
// Status sibuk/kosong dibaca dari wedding_sessions: baris DIHAPUS begitu sesi
// beneran selesai (releaseWeddingSession), jadi "ada baris aktif" == SIBUK.
// Inilah cara Penghulu "ngabarin" Pegawai di belakang layar: begitu Penghulu
// selesai & melepas sesi, ruangnya langsung kebaca KOSONG di query berikutnya
// -- gak perlu kirim pesan antar-bot (lagian bot gak bisa baca pesan bot lain
// di grup Telegram).
//
// Tiap item: { key, name, number, threadId, busy, sessionType, penghuluBusyCount }
//   number            = urutan ruang (1..N) menurut urutan Penghulu lalu urutan THREAD_IDS
//   penghuluBusyCount = jumlah ruang yang lagi dipegang Penghulu itu (0 = nganggur total)
export async function getPenghuluRoomStatuses(supabaseAdmin, penghuluAgents, chatId) {
  const { data, error } = await supabaseAdmin
    .from('wedding_sessions')
    .select('agent_key, thread_id, session_type, stage')
    .eq('chat_id', chatId)

  if (error) throw error

  // Difilter di JS (bukan .neq di query) biar baris dengan stage NULL tetap
  // dianggap aktif.
  const active = (data || []).filter((r) => r.stage !== 'selesai')
  const sessionByThread = new Map(active.map((r) => [String(r.thread_id), r]))
  const busyCountByAgent = new Map()
  for (const r of active) busyCountByAgent.set(r.agent_key, (busyCountByAgent.get(r.agent_key) || 0) + 1)

  const rooms = []
  for (const p of penghuluAgents) {
    const threadIds = p.threadIds && p.threadIds.length > 0 ? p.threadIds : [null]
    for (const threadId of threadIds) {
      const session =
        threadId != null
          ? sessionByThread.get(String(threadId))
          : active.find((r) => r.agent_key === p.key)
      rooms.push({
        key: p.key,
        name: p.name,
        threadId,
        busy: Boolean(session),
        sessionType: session ? session.session_type || 'marriage' : null,
        penghuluBusyCount: busyCountByAgent.get(p.key) || 0,
      })
    }
  }
  rooms.forEach((room, i) => {
    room.number = i + 1
  })
  return rooms
}

// Urutan rekomendasi: ruang KOSONG dulu; di antara yang kosong, ruang milik
// Penghulu yang paling nganggur (0 ruang lain dipegang) didahulukan; sisanya
// urut nomor ruang. Ruang SIBUK ditaruh paling bawah.
function sortRoomsForRecommendation(rooms) {
  return [...rooms].sort((a, b) => {
    if (a.busy !== b.busy) return a.busy ? 1 : -1
    if (!a.busy && a.penghuluBusyCount !== b.penghuluBusyCount) return a.penghuluBusyCount - b.penghuluBusyCount
    return a.number - b.number
  })
}

// Ruang KOSONG saja (sudah urut rekomendasi) -- dipakai handleBusyRoomIntent
// buat ngarahin warga yang nyelonong ke ruang yang lagi dipakai.
async function getIdlePenghuluRooms(supabaseAdmin, penghuluAgents, chatId) {
  const statuses = await getPenghuluRoomStatuses(supabaseAdmin, penghuluAgents, chatId)
  return sortRoomsForRecommendation(statuses.filter((r) => !r.busy))
}

// ------------------------------------------------------------------
// Kapasitas ruang KUA penuh -- dipanggil dari titik "duduk" (warga lain
// nyelonong ke ruangan yang lagi dipake) SAAT niatnya jelas (mau
// nikah/daftar keluarga), bukan buat basa-basi biasa. Dua kemungkinan:
// 1. Masih ada ruang Penghulu LAIN yang kosong -> langsung kasih link ke
//    sana, gak perlu nunggu.
// 2. Beneran semua penuh -> masuk antrian (kua_queue), Asisten yang bakal
//    kirim link begitu ada slot kebuka (lihat finishSessionAndFreeSlot).
// ------------------------------------------------------------------
async function handleBusyRoomIntent(supabaseAdmin, agent, ctx, text, threadId, { penghuluAgents, requestType, env }) {
  const chatId = ctx.chat.id
  const mention = mentionFor(ctx.from)

  let idleRooms = []
  try {
    idleRooms = await getIdlePenghuluRooms(supabaseAdmin, penghuluAgents, chatId)
  } catch (err) {
    console.error(`[${agent.key}] gagal ambil daftar ruang KUA kosong:`, err)
  }

  // Ruang lain yang kosong (thread beda dari yang lagi dipakai ini) -- boleh
  // ruang milik Penghulu yang sama kalau dia pegang lebih dari 1 ruang.
  const idleElsewhere = idleRooms.filter((r) => r.threadId != null && String(r.threadId) !== String(threadId))

  if (idleElsewhere.length > 0) {
    const room = idleElsewhere[0]
    const link = buildRoomLink(env, chatId, room.threadId)
    await sendPersonaMessage(
      ctx,
      `_menunjuk ke arah pintu sebelah_\n\nMaaf ya, ruangan saya lagi dipakai warga lain. Tapi Ruang ${room.number} (Penghulu ${room.name}) lagi kosong nih, langsung ke sana aja ya: ${link}`,
      { message_thread_id: threadId }
    )
    return
  }

  let enqueued = null
  try {
    enqueued = await enqueueCitizen(supabaseAdmin, {
      chatId,
      telegramUserId: ctx.from.id,
      mention,
      requestType,
      requestText: text,
    })
  } catch (err) {
    console.error(`[${agent.key}] gagal masukin antrian KUA:`, err)
    await sendPersonaMessage(ctx, SCRIPTED_LINES.duduk(agent.name), { message_thread_id: threadId })
    return
  }

  if (enqueued === null) {
    // Warga ini UDAH punya antrian aktif -- gak usah spam pesan lagi,
    // dia udah pernah dikasih tau lagi nunggu.
    return
  }

  await sendPersonaMessage(
    ctx,
    `_menunjuk kursi tunggu di sudut ruangan_\n\nMaaf, semua ruang KUA lagi penuh ya. Udah saya catat antrian kamu -- nanti Asisten bakal kirim link ruangan langsung ke sini begitu ada yang kosong 🙏`,
    { message_thread_id: threadId }
  )
}

// Dipanggil begitu 1 ruangan (threadId) BARU AJA kosong -- abis sesi
// 'selesai' & kedua warganya di-kick (lihat finishSessionAndFreeSlot).
// Ambil antrian paling depan buat grup ini (kalau ada) dan kirim link ke
// ruangan yang baru kosong itu, lewat bot ASISTEN (bukan bot Penghulu --
// sesuai concept "Asisten yang ngarahin", biar berasa kayak resepsionis).
async function notifyQueueSlotOpen(env, assistantAgents, chatId, freedThreadId, penghuluAgent, queueEntry) {
  const messenger = assistantAgents && assistantAgents[0]
  if (!messenger) {
    console.error('[kuaQueue] gak ada assistant agent buat kirim notif antrian, skip')
    return
  }

  const link = buildRoomLink(env, chatId, freedThreadId)
  const text =
    `${queueEntry.mention}, ruang KUA-nya ${penghuluAgent.name} baru aja kosong nih! 🎉\n\n` +
    `Langsung meluncur ke sana buat lanjutin urusan kamu ya (kemarin kamu bilang: "${queueEntry.request_text}"):\n${link}`

  try {
    await callTelegramApi(messenger.token, 'sendMessage', {
      chat_id: chatId,
      text,
      message_thread_id: messenger.threadIds ? messenger.threadIds[0] : undefined,
    })
  } catch (err) {
    console.error(`[kuaQueue] gagal kirim notif antrian lewat ${messenger.key}:`, err.message)
  }
}

// Dipanggil SETELAH releaseWeddingSession berhasil (nikah 'penutup' atau
// keluarga 'selesai_tanya' -> tutup) -- 2 tugas:
// 1. Kick SEMENTARA kedua warga yang terlibat (bukan hukuman, cuma
//    "serah-terima ruangan", lihat groupMembership.js).
// 2. Kasih tau antrian paling depan (kalau ada) bahwa ruangan ini kosong.
//
// `session` di sini WAJIB versi SEBELUM di-release (masih ada
// partner_a_id/partner_b_id-nya) -- panggil fungsi ini SEBELUM baris
// session-nya keluar dari scope.
async function finishSessionAndFreeSlot(supabaseAdmin, env, agent, chatId, threadId, session, assistantAgents) {
  try {
    const citizenIds = [session.partner_a_id, session.partner_b_id].filter(Boolean)
    if (citizenIds.length > 0) {
      const { data: citizensData, error } = await supabaseAdmin
        .from('citizens')
        .select('id, telegram_id')
        .in('id', citizenIds)
      if (error) throw error

      for (const citizen of citizensData || []) {
        if (!citizen.telegram_id) continue
        await kickFromGroupTemporarily(env, chatId, citizen.telegram_id, {
          reason: `sesi ${agent.key} (${session.session_type || 'marriage'}) selesai`,
        })
      }
    }
  } catch (err) {
    console.error(`[${agent.key}] gagal kick warga abis sesi selesai (sesi TETAP resmi selesai, cuma bagian keluar ruangan yang gak jalan):`, err)
  }

  try {
    const nextInLine = await popNextWaiting(supabaseAdmin, chatId)
    if (nextInLine) {
      await notifyQueueSlotOpen(env, assistantAgents, chatId, threadId, agent, nextInLine)
    }
  } catch (err) {
    console.error(`[${agent.key}] gagal proses antrian KUA abis sesi selesai:`, err)
  }
}

// Teks konteks buat Pegawai: tiap RUANG KUA lengkap dgn nomor, nama Penghulu,
// status, kegiatan (kalau sibuk), dan link langsung ke ruangannya. AI cuma
// boleh MEMBUNGKUS data ini jadi kalimat, bukan mengarang nomor/link sendiri.
// Urutan sudah diatur buat rekomendasi (lihat sortRoomsForRecommendation):
// paling atas = ruang kosong milik Penghulu yang paling nganggur.
export function formatPenghuluStatusContext(statuses, env, chatId) {
  if (!statuses || statuses.length === 0) return null

  const activityLabel = (type) =>
    type === 'family' ? 'lagi memandu pendaftaran silsilah keluarga' : 'lagi memandu prosesi nikah'

  const lines = sortRoomsForRecommendation(statuses).map((s) => {
    const link = s.threadId != null ? buildRoomLink(env, chatId, s.threadId) : null
    const linkPart = link ? ` | link ruangan: ${link}` : ''
    if (s.busy) {
      return `- Ruang ${s.number} (Penghulu ${s.name}): SIBUK, ${activityLabel(s.sessionType)}${linkPart}`
    }
    const penghuluNote =
      s.penghuluBusyCount === 0
        ? 'Penghulu-nya lagi nganggur total'
        : `Penghulu-nya lagi pegang ${s.penghuluBusyCount} ruang lain`
    return `- Ruang ${s.number} (Penghulu ${s.name}): KOSONG, bisa langsung dipanggil (${penghuluNote})${linkPart}`
  })

  const idleCount = statuses.filter((s) => !s.busy).length
  const summary =
    idleCount > 0
      ? `Ringkasan: ${idleCount} dari ${statuses.length} ruang KUA lagi KOSONG.`
      : `Ringkasan: SEMUA ${statuses.length} ruang KUA lagi dipakai warga lain.`

  const fullyIdleNames = [...new Set(statuses.filter((s) => s.penghuluBusyCount === 0).map((s) => s.name))]
  const idlePenghuluLine =
    fullyIdleNames.length > 0
      ? `Penghulu yang lagi nganggur total (belum pegang warga sama sekali): ${fullyIdleNames.join(', ')}.`
      : 'Semua Penghulu lagi pegang minimal 1 ruang.'

  return `${summary}\n${idlePenghuluLine}\n${lines.join('\n')}`
}

async function resolveCoupleFromText(supabaseAdmin, text) {
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

  return { usernameA, usernameB, citizenA: citizenA || null, citizenB: citizenB || null }
}

function labelFor(citizen, fallbackUsername) {
  return citizen ? citizen.display_name || `@${citizen.username}` : `@${fallbackUsername}`
}

async function resolveCitizenByTelegramId(supabaseAdmin, telegramId) {
  const { data, error } = await supabaseAdmin
    .from('citizens')
    .select('id, username, display_name')
    .eq('telegram_id', telegramId)
    .maybeSingle()

  if (error) throw error
  return data
}

async function isSessionParty(supabaseAdmin, session, telegramUserId) {
  const partyIds = [session.partner_a_id, session.partner_b_id].filter(Boolean)
  if (partyIds.length === 0) return true

  const citizen = await resolveCitizenByTelegramId(supabaseAdmin, telegramUserId)
  if (!citizen) return false
  return partyIds.includes(citizen.id)
}

async function resolveFamilyPartiesFromText(supabaseAdmin, text, ctx) {
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

  const citizenSubject = await resolveCitizenByTelegramId(supabaseAdmin, ctx.from.id)
  const usernameSubject = ctx.from.username || ctx.from.first_name || 'kamu'

  return { usernameRelated, usernameSubject, citizenRelated: relatedRow || null, citizenSubject }
}

// ------------------------------------------------------------------
// Penghulu
// ------------------------------------------------------------------
export async function handlePenghuluMessage(supabaseAdmin, agent, ctx, text, threadId, { penghuluAgents, assistantAgents, env }) {
  if (threadId == null) return

  const chatId = ctx.chat.id
  const historyKey = `${chatId}:${threadId}`

  // Recovery konteks abis timeout (lihat penghuluTimeoutState.js) -- SELALU
  // dicek paling awal, sebelum apa pun lain diproses. Ini CUMA soal
  // sapaan/kontinuitas, sama sekali gak menyentuh stage sesi atau logic
  // kick di bawah -- dibungkus try/catch biar gak pernah ngeblok pesan
  // warga cuma gara-gara tabel ini bermasalah.
  try {
    const pendingTimeout = await consumePenghuluTimeout(supabaseAdmin, historyKey)
    if (pendingTimeout) {
      await sendPersonaMessage(ctx, buildTimeoutBackLine(agent.name), { message_thread_id: threadId })
    }
  } catch (err) {
    console.error(`[${agent.key}] gagal cek/consume penghulu timeout state (lanjut aja):`, err)
  }

  let session = await getWeddingSession(supabaseAdmin, { chatId, threadId })

  if (!session) {
    const familyRelationType = detectFamilyRelationType(text)
    if (familyRelationType) {
      const familySession = await claimWeddingSession(supabaseAdmin, {
        chatId, threadId, agentKey: agent.key, sessionType: 'family', relationType: familyRelationType,
      })
      if (!familySession) return

      const parties = await resolveFamilyPartiesFromText(supabaseAdmin, text, ctx)
      if (parties && parties.citizenRelated && parties.citizenSubject) {
        await startFamilyRegistration(supabaseAdmin, agent, ctx, threadId, familySession, parties, familyRelationType)
      } else {
        const relationLabel = FAMILY_RELATION_LABELS[familyRelationType]
        await sendPersonaMessage(ctx, FAMILY_SCRIPTED_LINES.askForTarget(agent.name, relationLabel), { message_thread_id: threadId })
      }
      return
    }

    const couple = await resolveCoupleFromText(supabaseAdmin, text)
    if (couple) {
      session = await claimWeddingSession(supabaseAdmin, { chatId, threadId, agentKey: agent.key })
      if (!session) return

      if (couple.citizenA && couple.citizenB) {
        await startCeremony(supabaseAdmin, agent, ctx, threadId, session, couple)
      } else {
        await sendPersonaMessage(ctx, SCRIPTED_LINES.couldNotResolve(`@${couple.usernameA}`, `@${couple.usernameB}`), {
          message_thread_id: threadId,
        })
      }
      return
    }

    // Gak ada sinyal mulai sesi (bukan permintaan nikah/keluarga):
    // - Kalau ini PESAN PERTAMA di room ini (histori masih kosong), kasih
    //   pembukaan baku "mau ngapain?" (DETERMINISTIK) sekali aja.
    // - Selain itu, jawab lewat AI. Sebelumnya di sini SELALU ngirim ulang
    //   SCRIPTED_LINES.greeting() berapa kali pun warganya chat — makanya
    //   kerasa kayak bot yang gak ngerti isi chat.
    const priorHistory = await getHistory(supabaseAdmin, historyKey)
    if (priorHistory.length === 0) {
      await pushHistory(supabaseAdmin, historyKey, 'user', text)
      await pushHistory(supabaseAdmin, historyKey, 'model', SCRIPTED_LINES.greeting(agent.name))
      await sendPersonaMessage(ctx, SCRIPTED_LINES.greeting(agent.name), { message_thread_id: threadId })
      return
    }

    await pushHistory(supabaseAdmin, historyKey, 'user', text)
    const { text: freeReply } = await runTurn({
      systemInstruction: buildPenghuluSystemInstruction(agent.name),
      model: agent.aiModel,
      supabaseAdmin,
      apiKey: agent.aiApiKey,
      geminiApiKey: agent.geminiApiKey,
      geminiModel: agent.geminiModel,
      history: priorHistory,
      userMessage: text,
    })
    await pushHistory(supabaseAdmin, historyKey, 'model', freeReply)
    await sendPersonaMessage(ctx, freeReply, { message_thread_id: threadId })
    return
  }

  if (session.agent_key !== agent.key) return

  if (!(await isSessionParty(supabaseAdmin, session, ctx.from.id))) {
    // Cek dulu apa niatnya jelas (mau nikah/daftar keluarga) -- kalau cuma
    // basa-basi/nyelonong biasa, tetap pakai baris "duduk" seperti biasa,
    // gak usah dianggap antrian.
    const familyRelationType = detectFamilyRelationType(text)
    let couple = null
    if (!familyRelationType) {
      try {
        couple = await resolveCoupleFromText(supabaseAdmin, text)
      } catch (err) {
        console.error(`[${agent.key}] gagal cek niat nikah warga yang nyelonong:`, err)
      }
    }

    if (familyRelationType || couple) {
      await handleBusyRoomIntent(supabaseAdmin, agent, ctx, text, threadId, {
        penghuluAgents,
        requestType: familyRelationType ? 'family' : 'marriage',
        env,
      })
      return
    }

    await sendPersonaMessage(ctx, SCRIPTED_LINES.duduk(agent.name), { message_thread_id: threadId })
    return
  }

  if (session.session_type === 'family') {
    await handleFamilyMessage(supabaseAdmin, agent, ctx, text, threadId, session, { env, assistantAgents })
    return
  }

  if (session.stage === 'selesai') {
    await sendPersonaMessage(ctx, SCRIPTED_LINES.alreadyDone(), { message_thread_id: threadId })
    return
  }

  if (session.stage === 'pembukaan' && !session.partner_a_id) {
    const couple = await resolveCoupleFromText(supabaseAdmin, text)
    if (!couple) {
      await sendPersonaMessage(ctx, SCRIPTED_LINES.needCouple(), { message_thread_id: threadId })
      return
    }
    if (!couple.citizenA || !couple.citizenB) {
      await sendPersonaMessage(ctx, SCRIPTED_LINES.couldNotResolve(`@${couple.usernameA}`, `@${couple.usernameB}`), {
        message_thread_id: threadId,
      })
      return
    }
    await startCeremony(supabaseAdmin, agent, ctx, threadId, session, couple)
    return
  }

  const nameA = session.partner_a_label
  const nameB = session.partner_b_label

  if (session.stage === 'ijab_kabul' && textContainsAny(text, KEYWORDS.confirmIjab)) {
    const updated = await updateWeddingSession(supabaseAdmin, session.id, { stage: nextStage(session.stage) })
    await sendPersonaMessage(ctx, SCRIPTED_LINES.doa(nameA, nameB), { message_thread_id: threadId })

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

  if (session.stage === 'doa') {
    if (textContainsAny(text, KEYWORDS.closeCeremony)) {
      await sendPersonaMessage(ctx, SCRIPTED_LINES.penutup(nameA, nameB), { message_thread_id: threadId })
      await sendPersonaMessage(ctx, SCRIPTED_LINES.silakanKeluar(), { message_thread_id: threadId })
      try {
        await releaseWeddingSession(supabaseAdmin, session.id)
        // BARU panggil ini SETELAH release sukses -- session di sini masih
        // versi lengkap (partner_a_id/b_id) dari SEBELUM baris di atas
        // dieksekusi, aman dipakai walau baris DB-nya udah kehapus.
        await finishSessionAndFreeSlot(supabaseAdmin, env, agent, chatId, threadId, session, assistantAgents)
      } catch (err) {
        console.error(`[${agent.key}] gagal lepas sesi penghulu:`, err)
      }
      return
    }

    await pushHistory(supabaseAdmin, historyKey, 'user', text)
    const history = await getHistory(supabaseAdmin, historyKey)
    const { text: reply } = await runTurn({
      systemInstruction: buildPenghuluSystemInstruction(agent.name),
      model: agent.aiModel,
      supabaseAdmin,
      apiKey: agent.aiApiKey,
      geminiApiKey: agent.geminiApiKey,
      geminiModel: agent.geminiModel,
      history,
      userMessage: `[Konteks: prosesi pernikahan ${nameA} & ${nameB}, tahap saat ini: doa/setelah ijab-kabul]\nPesan tamu: ${text}`,
    })
    await pushHistory(supabaseAdmin, historyKey, 'model', reply)
    await sendPersonaMessage(ctx, reply, { message_thread_id: threadId })
    return
  }

  await pushHistory(supabaseAdmin, historyKey, 'user', text)
  const history = await getHistory(supabaseAdmin, historyKey)
  const { text: reply } = await runTurn({
    systemInstruction: buildPenghuluSystemInstruction(agent.name),
    model: agent.aiModel,
    supabaseAdmin,
    apiKey: agent.aiApiKey,
    geminiApiKey: agent.geminiApiKey,
    geminiModel: agent.geminiModel,
    history,
    userMessage: `[Konteks: prosesi pernikahan ${nameA || '(mempelai A)'} & ${nameB || '(mempelai B)'}, tahap saat ini: ${session.stage}]\nPesan tamu: ${text}`,
  })
  await pushHistory(supabaseAdmin, historyKey, 'model', reply)
  await sendPersonaMessage(ctx, reply, { message_thread_id: threadId })
}

async function startCeremony(supabaseAdmin, agent, ctx, threadId, session, couple) {
  const nameA = labelFor(couple.citizenA, couple.usernameA)
  const nameB = labelFor(couple.citizenB, couple.usernameB)

  await updateWeddingSession(supabaseAdmin, session.id, {
    partner_a_id: couple.citizenA.id,
    partner_b_id: couple.citizenB.id,
    partner_a_label: nameA,
    partner_b_label: nameB,
    stage: 'ijab_kabul',
  })

  await sendPersonaMessage(ctx, SCRIPTED_LINES.pembukaan(nameA, nameB), { message_thread_id: threadId })
  await sendPersonaMessage(ctx, SCRIPTED_LINES.ijab_kabul(nameA, nameB), { message_thread_id: threadId })
}

async function startFamilyRegistration(supabaseAdmin, agent, ctx, threadId, session, parties, relationType) {
  const relationLabel = FAMILY_RELATION_LABELS[relationType]
  const subjectLabel = labelFor(parties.citizenSubject, parties.usernameSubject)
  const relatedLabel = labelFor(parties.citizenRelated, parties.usernameRelated)

  await updateWeddingSession(supabaseAdmin, session.id, {
    partner_a_id: parties.citizenSubject.id,
    partner_a_label: subjectLabel,
    partner_b_id: parties.citizenRelated.id,
    partner_b_label: relatedLabel,
    relation_type: relationType,
    stage: 'konfirmasi',
  })

  await sendPersonaMessage(ctx, FAMILY_SCRIPTED_LINES.pembukaan(subjectLabel, relatedLabel, relationLabel), {
    message_thread_id: threadId,
  })
}

async function handleFamilyMessage(supabaseAdmin, agent, ctx, text, threadId, session, { env, assistantAgents } = {}) {
  const chatId = ctx.chat.id
  const historyKey = `${chatId}:${threadId}:family`
  const relationType = session.relation_type
  const relationLabel = FAMILY_RELATION_LABELS[relationType]

  if (session.stage === 'selesai_tanya') {
    if (textContainsAny(text, KEYWORDS.closeCeremony)) {
      await sendPersonaMessage(ctx, SCRIPTED_LINES.silakanKeluar(), { message_thread_id: threadId })
      try {
        await releaseWeddingSession(supabaseAdmin, session.id)
        await finishSessionAndFreeSlot(supabaseAdmin, env, agent, chatId, threadId, session, assistantAgents)
      } catch (err) {
        console.error(`[${agent.key}] gagal lepas sesi penghulu:`, err)
      }
      return
    }

    const nextRelationType = detectFamilyRelationType(text)
    if (nextRelationType) {
      const parties = await resolveFamilyPartiesFromText(supabaseAdmin, text, ctx)
      if (parties && parties.citizenRelated && parties.citizenSubject) {
        await startFamilyRegistration(supabaseAdmin, agent, ctx, threadId, session, parties, nextRelationType)
      } else {
        const nextRelationLabel = FAMILY_RELATION_LABELS[nextRelationType]
        await sendPersonaMessage(ctx, FAMILY_SCRIPTED_LINES.needTarget(nextRelationLabel), { message_thread_id: threadId })
      }
      return
    }

    await sendPersonaMessage(ctx, FAMILY_SCRIPTED_LINES.tanyaLanjut(session.partner_a_label), { message_thread_id: threadId })
    return
  }

  if (session.stage === 'selesai') {
    await sendPersonaMessage(ctx, FAMILY_SCRIPTED_LINES.alreadyDone(), { message_thread_id: threadId })
    return
  }

  if (session.stage === 'pembukaan' && !session.partner_b_id) {
    const parties = await resolveFamilyPartiesFromText(supabaseAdmin, text, ctx)
    if (!parties) {
      await sendPersonaMessage(ctx, FAMILY_SCRIPTED_LINES.needTarget(relationLabel), { message_thread_id: threadId })
      return
    }
    if (!parties.citizenRelated || !parties.citizenSubject) {
      await sendPersonaMessage(ctx, FAMILY_SCRIPTED_LINES.couldNotResolve(`@${parties.usernameRelated}`), {
        message_thread_id: threadId,
      })
      return
    }
    await startFamilyRegistration(supabaseAdmin, agent, ctx, threadId, session, parties, relationType)
    return
  }

  const subjectLabel = session.partner_a_label
  const relatedLabel = session.partner_b_label

  if (session.stage === 'konfirmasi' && textContainsAny(text, FAMILY_CONFIRM_KEYWORDS)) {
    await updateWeddingSession(supabaseAdmin, session.id, { stage: 'selesai_tanya' })
    await sendPersonaMessage(ctx, FAMILY_SCRIPTED_LINES.selesai(subjectLabel, relatedLabel, relationLabel), { message_thread_id: threadId })
    await sendPersonaMessage(ctx, FAMILY_SCRIPTED_LINES.tanyaLanjut(subjectLabel), { message_thread_id: threadId })

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

  await pushHistory(supabaseAdmin, historyKey, 'user', text)
  const history = await getHistory(supabaseAdmin, historyKey)
  const { text: reply } = await runTurn({
    systemInstruction: buildPenghuluSystemInstruction(agent.name),
    model: agent.aiModel,
    supabaseAdmin,
    apiKey: agent.aiApiKey,
    geminiApiKey: agent.geminiApiKey,
    geminiModel: agent.geminiModel,
    history,
    userMessage:
      `[Konteks: pendaftaran silsilah keluarga — ${relatedLabel || '(target)'} didaftarkan sebagai ${relationLabel} ` +
      `dari ${subjectLabel || '(subjek)'}, tahap saat ini: ${session.stage}]\nPesan tamu: ${text}`,
  })
  await pushHistory(supabaseAdmin, historyKey, 'model', reply)
  await sendPersonaMessage(ctx, reply, { message_thread_id: threadId })
}

// ------------------------------------------------------------------
// Pegawai (Naya, Mimi, Cika)
// ------------------------------------------------------------------
export async function handlePegawaiMessage(supabaseAdmin, agent, ctx, text, threadId, { penghuluAgents, pegawaiPriorityKeys, pegawaiPriorityNames, env }) {
  const lower = text.toLowerCase()
  const chatId = String(ctx.chat.id)
  const telegramUserId = ctx.from.id

  const session = await claimPegawaiSession(supabaseAdmin, {
    chatId,
    telegramUserId,
    priorityAgentKeys: pegawaiPriorityKeys,
    priorityAgentNames: pegawaiPriorityNames,
  })

  if (!session) return
  if (session.agent_key !== agent.key) return

  // History dipisah per (chat, thread, user) + suffix ':pegawai' -- SENGAJA
  // beda dari historyKey Penghulu (yang cuma `${chatId}:${threadId}`) biar
  // gak numpuk/campur sama histori sesi prosesi nikah. Ikut telegramUserId
  // juga karena beda tamu di grup yang sama harus dapet histori sendiri-
  // sendiri (satu Pegawai bisa dipanggil banyak orang berbeda).
  const historyKey = `${chatId}:${threadId}:pegawai:${telegramUserId}`

  // Cek dulu apakah pegawai ini lagi "away" (timeout sebelumnya) buat warga
  // ini -- kalau iya, nanti setelah AI BERHASIL jawab (di bawah), kita kirim
  // pesan "balik" yang nyambung sama alasan yang sama sebelum jawaban asli.
  // Sengaja dicek di sini (SEBELUM runTurn) tapi baru di-clear/dipakai
  // SETELAH runTurn sukses -- kalau runTurn gagal lagi, state away tetap
  // ada (index.js catch block bakal liat dia masih away & diem aja).
  //
  // DIBUNGKUS try/catch: kalau query ke tabel away-state ini gagal (DB
  // hiccup, dll), JANGAN sampai itu ngeblok warga dapet jawaban sama
  // sekali -- anggap aja "gak away" dan lanjut proses normal.
  let awayRowAtStart = null
  try {
    awayRowAtStart = await getAwayState(supabaseAdmin, historyKey)
  } catch (err) {
    console.error(`[${agent.key}] gagal cek away state (lanjut anggap gak away):`, err)
  }

  let penghuluStatusContext = null
  // Cuma "niat jelas" (nikah/daftar/dst) yang nutup sesi Pegawai abis
  // ngarahin -- pertanyaan status ("mana yang kosong?") gak ikut nutup.
  const directingToPenghulu = PENGHULU_INTENT_KEYWORDS.some((kw) => lower.includes(kw))
  const askingRoomStatus = PENGHULU_STATUS_KEYWORDS.some((kw) => lower.includes(kw))
  // Status ruang KUA SELALU diambil (1 query kecil), bukan cuma kalau pesan
  // ini kebetulan kena keyword -- dulu pertanyaan lanjutan kayak "yang lain
  // ada?" gak kena keyword, datanya kosong, dan Pegawai malah bilang "gak bisa
  // lihat data". Persona (pegawai.js) yang atur kapan data ini dipakai/diabaikan.
  try {
    const statuses = await getPenghuluRoomStatuses(supabaseAdmin, penghuluAgents, ctx.chat.id)
    penghuluStatusContext = formatPenghuluStatusContext(statuses, env, ctx.chat.id)
    console.log(
      `[${agent.key}] status ruang KUA: ${statuses.filter((r) => !r.busy).length} kosong dari ${statuses.length} ruang (${penghuluAgents.length} Penghulu aktif)`
    )
  } catch (err) {
    console.error(`[${agent.key}] gagal ambil status penghulu:`, err)
  }

  let roomStatusContext = null
  if (ROOM_AVAILABILITY_KEYWORDS.some((kw) => lower.includes(kw))) {
    try {
      const summary = await getRoomAvailabilitySummary(supabaseAdmin)
      roomStatusContext = formatRoomAvailabilityContext(summary)
    } catch (err) {
      console.error(`[${agent.key}] gagal ambil status ruangan:`, err)
    }
  }

  await pushHistory(supabaseAdmin, historyKey, 'user', text)
  let history = await getHistory(supabaseAdmin, historyKey)

  // Kalau datanya SEKARANG ada, buang jawaban lama Pegawai yang bilang "gak
  // bisa lihat/cek data" dari histori -- model kecil suka niru jawaban lamanya
  // sendiri dan ngulang penolakan yang sama walau data barunya udah dikasih.
  if (askingRoomStatus && penghuluStatusContext) {
    const oldRefusal = /\b(gak|nggak|ngga|ga|tidak|belum)\s+(bisa|dapat)\s+(lihat|liat|cek|ngecek|akses|ngakses)/i
    history = history.filter((m) => !(m.role === 'assistant' && oldRefusal.test(m.content)))
  }

  // Kalau warga lagi nanya soal ruang/Penghulu, ingetin model di giliran USER
  // (bukan cuma di system prompt yang panjang) bahwa datanya ADA -- model kecil
  // sering "lupa" isi system prompt dan malah niru jawaban lamanya di histori
  // ("aku gak bisa lihat data").
  const userMessage =
    askingRoomStatus && penghuluStatusContext
      ? `[Sistem: data status ruang KUA terbaru sudah ada di instruksi kamu -- jawab pakai data itu, jangan bilang kamu gak bisa lihat data.]\nPesan warga: ${text}`
      : text

  const { text: reply } = await runTurn({
    systemInstruction: buildPegawaiSystemInstruction(agent.name, roomStatusContext, penghuluStatusContext),
    model: agent.aiModel,
    supabaseAdmin,
    apiKey: agent.aiApiKey,
    geminiApiKey: agent.geminiApiKey,
    geminiModel: agent.geminiModel,
    history,
    userMessage,
  })
  await pushHistory(supabaseAdmin, historyKey, 'model', reply)

  // AI berhasil jawab -> kalau tadinya lagi "away", kirim gestur "balik" dulu
  // (nyambung ke excuse yang sama pas dia "pergi"), baru jawaban aslinya.
  if (awayRowAtStart) {
    try {
      const template = getAwayTemplateByIndex(awayRowAtStart.excuse_index)
      const backLine = fillAwayTemplate(template.back, { name: agent.name, mention: awayRowAtStart.mention })
      await sendPersonaMessage(ctx, backLine, threadId != null ? { message_thread_id: threadId } : undefined)
      await clearAwayState(supabaseAdmin, historyKey)
    } catch (err) {
      console.error(`[${agent.key}] gagal kirim/clear pesan 'balik' dari away state:`, err)
    }
  }

  await sendPersonaMessage(ctx, reply, threadId != null ? { message_thread_id: threadId } : undefined)

  if (directingToPenghulu) {
    try {
      await releasePegawaiSession(supabaseAdmin, session.id)
    } catch (err) {
      console.error(`[${agent.key}] gagal lepas sesi pegawai:`, err)
    }
  }
}

// Dipanggil dari index.js SETIAP kali handlePegawaiMessage di atas gagal
// total (AI beneran timeout, lihat aiClient.js) -- gantiin fallback generik
// "(sinyal lagi kurang bagus...)" yang keliatan robotic kalau muncul
// berkali-kali. Cuma ngirim template "pergi" SEKALI per episode timeout;
// kalau warganya masih spam chat selama masih "away", fungsi ini gak
// ngirim apa-apa lagi (lihat startAwayState -> null kalau udah ada).
//
// Pesan si warga yang bikin ini ke-trigger TETAP kesimpen normal (lewat
// pushHistory di handlePegawaiMessage, yang jalan SEBELUM runTurn) --
// makanya fungsi ini gak perlu terima/nyimpen teks pesannya sendiri.
export async function handlePegawaiTimeout(supabaseAdmin, agent, ctx, threadId) {
  const telegramUserId = ctx.from?.id
  if (telegramUserId == null) return // gak ada info user Telegram, gak bisa di-track

  const chatId = String(ctx.chat.id)
  const historyKey = `${chatId}:${threadId}:pegawai:${telegramUserId}`

  const { index, template } = pickRandomAwayTemplate()
  const mention = mentionFor(ctx.from)

  const started = await startAwayState(supabaseAdmin, {
    scopeKey: historyKey,
    excuseIndex: index,
    agentName: agent.name,
    mention,
  })

  // `null` artinya warga ini UDAH "away" duluan (masih diproses timeout
  // sebelumnya) -- diemin aja, jangan double-kirim template "pergi".
  if (!started) return

  const leaveText = [template.enter, template.say, template.exit]
    .map((line) => fillAwayTemplate(line, { name: agent.name, mention }))
    .join('\n\n')

  await sendPersonaMessage(ctx, leaveText, threadId != null ? { message_thread_id: threadId } : undefined)
}

// ------------------------------------------------------------------
// Dipanggil dari index.js SETIAP kali handlePenghuluMessage gagal total
// (AI beneran timeout). BEDA PENTING sama handlePegawaiTimeout: ini CUMA
// nyimpen marker recovery (lihat penghuluTimeoutState.js) buat di-
// acknowledge pas Penghulu-nya berhasil jawab lagi -- TIDAK PERNAH
// ngubah/mutusin stage sesi, TIDAK PERNAH memicu kick. Kick di project
// ini murni dari finishSessionAndFreeSlot, yang cuma jalan kalau stage
// beneran nyampe 'penutup'/'selesai_tanya'->tutup secara deterministik
// (lihat komentar panjang di penghuluTimeoutState.js).
//
// Kalau threadId null (bot Penghulu kepanggil di luar thread yang
// dia-manage), gak ada yang bisa di-track -- skip diam-diam, biar fallback
// generik lama di index.js yang jalan.
export async function handlePenghuluTimeout(supabaseAdmin, agent, ctx, threadId) {
  if (threadId == null) return

  const chatId = ctx.chat.id
  const scopeKey = `${chatId}:${threadId}`

  let stageSnapshot = null
  try {
    const session = await getWeddingSession(supabaseAdmin, { chatId, threadId })
    stageSnapshot = session?.stage || null
  } catch (err) {
    console.error(`[${agent.key}] gagal ambil stage sesi buat snapshot timeout (lanjut tanpa snapshot):`, err)
  }

  try {
    await markPenghuluTimeout(supabaseAdmin, { scopeKey, agentName: agent.name, stageSnapshot })
  } catch (err) {
    // Kalau tabel penghulu_timeout_state belum ada / gak keakses, biarin
    // index.js jatuh ke fallback generik lama -- jangan sampai warga sama
    // sekali gak dapet balasan.
    console.error(`[${agent.key}] gagal simpen penghulu timeout state:`, err)
    throw err
  }

  // Sengaja GAK ngirim pesan apa pun di sini (beda dari Pegawai) -- fallback
  // generik "sinyal lagi kurang bagus" di index.js udah cukup buat momen
  // ini. Pesan "balik"-nya baru muncul nanti pas dia BERHASIL jawab lagi.
}
