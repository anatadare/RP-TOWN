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
//    ctx.reply(...)) jadi sebagian besar logic aslinya gak berubah.

import { runTurn } from './geminiClient.js'
import { getHistory, pushHistory } from './chatHistory.js'
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
  'nikah', 'kawin', 'daftar', 'penghulu',
  'mommy', 'daddy', 'kaka', 'abang', 'nenek', 'kakek', 'paman', 'tante',
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

async function getIdlePenghuluNames(supabaseAdmin, penghuluAgents) {
  const { data, error } = await supabaseAdmin
    .from('wedding_sessions')
    .select('agent_key')
    .neq('stage', 'selesai')

  if (error) throw error
  const busyKeys = new Set((data || []).map((r) => r.agent_key))
  return penghuluAgents.filter((p) => !busyKeys.has(p.key)).map((p) => p.name)
}

function formatPenghuluStatusContext(idleNames) {
  if (idleNames.length > 0) {
    return `Penghulu yang lagi NGANGGUR (kosong, bisa langsung dipanggil sekarang): ${idleNames.join(', ')}.`
  }
  return 'Semua Penghulu lagi memandu prosesi warga lain, sarankan warga coba lagi beberapa saat lagi.'
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
export async function handlePenghuluMessage(supabaseAdmin, agent, ctx, text, threadId, { penghuluAgents, geminiModel }) {
  if (threadId == null) return

  const chatId = ctx.chat.id
  const historyKey = `${chatId}:${threadId}`

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
        await ctx.reply(FAMILY_SCRIPTED_LINES.askForTarget(agent.name, relationLabel), { message_thread_id: threadId })
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
        await ctx.reply(SCRIPTED_LINES.couldNotResolve(`@${couple.usernameA}`, `@${couple.usernameB}`), {
          message_thread_id: threadId,
        })
      }
      return
    }

    await ctx.reply(SCRIPTED_LINES.greeting(agent.name), { message_thread_id: threadId })
    return
  }

  if (session.agent_key !== agent.key) return

  if (!(await isSessionParty(supabaseAdmin, session, ctx.from.id))) {
    await ctx.reply(SCRIPTED_LINES.duduk(agent.name), { message_thread_id: threadId })
    return
  }

  if (session.session_type === 'family') {
    await handleFamilyMessage(supabaseAdmin, agent, ctx, text, threadId, session, geminiModel)
    return
  }

  if (session.stage === 'selesai') {
    await ctx.reply(SCRIPTED_LINES.alreadyDone(), { message_thread_id: threadId })
    return
  }

  if (session.stage === 'pembukaan' && !session.partner_a_id) {
    const couple = await resolveCoupleFromText(supabaseAdmin, text)
    if (!couple) {
      await ctx.reply(SCRIPTED_LINES.needCouple(), { message_thread_id: threadId })
      return
    }
    if (!couple.citizenA || !couple.citizenB) {
      await ctx.reply(SCRIPTED_LINES.couldNotResolve(`@${couple.usernameA}`, `@${couple.usernameB}`), {
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
    await ctx.reply(SCRIPTED_LINES.doa(nameA, nameB), { message_thread_id: threadId })

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
      await ctx.reply(SCRIPTED_LINES.penutup(nameA, nameB), { message_thread_id: threadId })
      await ctx.reply(SCRIPTED_LINES.silakanKeluar(), { message_thread_id: threadId })
      try {
        await releaseWeddingSession(supabaseAdmin, session.id)
      } catch (err) {
        console.error(`[${agent.key}] gagal lepas sesi penghulu:`, err)
      }
      return
    }

    await pushHistory(supabaseAdmin, historyKey, 'user', text)
    const history = await getHistory(supabaseAdmin, historyKey)
    const { text: reply } = await runTurn({
      systemInstruction: buildPenghuluSystemInstruction(agent.name),
      model: geminiModel,
      apiKey: agent.geminiApiKey,
      history,
      userMessage: `[Konteks: prosesi pernikahan ${nameA} & ${nameB}, tahap saat ini: doa/setelah ijab-kabul]\nPesan tamu: ${text}`,
    })
    await pushHistory(supabaseAdmin, historyKey, 'model', reply)
    await ctx.reply(reply, { message_thread_id: threadId })
    return
  }

  await pushHistory(supabaseAdmin, historyKey, 'user', text)
  const history = await getHistory(supabaseAdmin, historyKey)
  const { text: reply } = await runTurn({
    systemInstruction: buildPenghuluSystemInstruction(agent.name),
    model: geminiModel,
    apiKey: agent.geminiApiKey,
    history,
    userMessage: `[Konteks: prosesi pernikahan ${nameA || '(mempelai A)'} & ${nameB || '(mempelai B)'}, tahap saat ini: ${session.stage}]\nPesan tamu: ${text}`,
  })
  await pushHistory(supabaseAdmin, historyKey, 'model', reply)
  await ctx.reply(reply, { message_thread_id: threadId })
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

  await ctx.reply(SCRIPTED_LINES.pembukaan(nameA, nameB), { message_thread_id: threadId })
  await ctx.reply(SCRIPTED_LINES.ijab_kabul(nameA, nameB), { message_thread_id: threadId })
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

  await ctx.reply(FAMILY_SCRIPTED_LINES.pembukaan(subjectLabel, relatedLabel, relationLabel), {
    message_thread_id: threadId,
  })
}

async function handleFamilyMessage(supabaseAdmin, agent, ctx, text, threadId, session, geminiModel) {
  const chatId = ctx.chat.id
  const historyKey = `${chatId}:${threadId}:family`
  const relationType = session.relation_type
  const relationLabel = FAMILY_RELATION_LABELS[relationType]

  if (session.stage === 'selesai_tanya') {
    if (textContainsAny(text, KEYWORDS.closeCeremony)) {
      await ctx.reply(SCRIPTED_LINES.silakanKeluar(), { message_thread_id: threadId })
      try {
        await releaseWeddingSession(supabaseAdmin, session.id)
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
        await ctx.reply(FAMILY_SCRIPTED_LINES.needTarget(nextRelationLabel), { message_thread_id: threadId })
      }
      return
    }

    await ctx.reply(FAMILY_SCRIPTED_LINES.tanyaLanjut(session.partner_a_label), { message_thread_id: threadId })
    return
  }

  if (session.stage === 'selesai') {
    await ctx.reply(FAMILY_SCRIPTED_LINES.alreadyDone(), { message_thread_id: threadId })
    return
  }

  if (session.stage === 'pembukaan' && !session.partner_b_id) {
    const parties = await resolveFamilyPartiesFromText(supabaseAdmin, text, ctx)
    if (!parties) {
      await ctx.reply(FAMILY_SCRIPTED_LINES.needTarget(relationLabel), { message_thread_id: threadId })
      return
    }
    if (!parties.citizenRelated || !parties.citizenSubject) {
      await ctx.reply(FAMILY_SCRIPTED_LINES.couldNotResolve(`@${parties.usernameRelated}`), {
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
    await ctx.reply(FAMILY_SCRIPTED_LINES.selesai(subjectLabel, relatedLabel, relationLabel), { message_thread_id: threadId })
    await ctx.reply(FAMILY_SCRIPTED_LINES.tanyaLanjut(subjectLabel), { message_thread_id: threadId })

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
    model: geminiModel,
    apiKey: agent.geminiApiKey,
    history,
    userMessage:
      `[Konteks: pendaftaran silsilah keluarga — ${relatedLabel || '(target)'} didaftarkan sebagai ${relationLabel} ` +
      `dari ${subjectLabel || '(subjek)'}, tahap saat ini: ${session.stage}]\nPesan tamu: ${text}`,
  })
  await pushHistory(supabaseAdmin, historyKey, 'model', reply)
  await ctx.reply(reply, { message_thread_id: threadId })
}

// ------------------------------------------------------------------
// Pegawai (Naya, Mimi, Cika)
// ------------------------------------------------------------------
export async function handlePegawaiMessage(supabaseAdmin, agent, ctx, text, threadId, { penghuluAgents, pegawaiPriorityKeys, pegawaiPriorityNames, geminiModel }) {
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

  let penghuluStatusContext = null
  let directingToPenghulu = false
  if (PENGHULU_INTENT_KEYWORDS.some((kw) => lower.includes(kw))) {
    try {
      const idleNames = await getIdlePenghuluNames(supabaseAdmin, penghuluAgents)
      penghuluStatusContext = formatPenghuluStatusContext(idleNames)
      directingToPenghulu = true
    } catch (err) {
      console.error(`[${agent.key}] gagal ambil status penghulu:`, err)
    }
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

  const { text: reply } = await runTurn({
    systemInstruction: buildPegawaiSystemInstruction(agent.name, roomStatusContext, penghuluStatusContext),
    model: geminiModel,
    apiKey: agent.geminiApiKey,
    history: [],
    userMessage: text,
  })

  await ctx.reply(reply, threadId != null ? { message_thread_id: threadId } : undefined)

  if (directingToPenghulu) {
    try {
      await releasePegawaiSession(supabaseAdmin, session.id)
    } catch (err) {
      console.error(`[${agent.key}] gagal lepas sesi pegawai:`, err)
    }
  }
}
