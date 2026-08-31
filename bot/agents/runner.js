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
  ASSISTANT_AGENTS,
  PENGHULU_AGENTS,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = require('./config')
// TRIGGER_WORD_PENGHULU & TRIGGER_WORDS_PEGAWAI sudah gak dipakai di sini —
// semua agent sekarang jawab langsung tanpa kata pemicu (lihat handler di bawah).

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
const { buildPegawaiSystemInstruction, sortAgentsByPegawaiPriority } = require('./personas/pegawai')
const { updateMarriageStatusDeclaration, handleUpdateMarriageStatus, handleAddFamilyRelation } = require('./tools')
const {
  getWeddingSession,
  claimWeddingSession,
  updateWeddingSession,
  releaseWeddingSession,
  claimPegawaiSession,
  releasePegawaiSession,
} = require('./stateStore')
const { getRoomAvailabilitySummary, formatRoomAvailabilityContext } = require('./roomStatus')

// Kata kunci yang nandain warga lagi nanya soal ketersediaan ruangan —
// dipakai Pegawai buat mutusin perlu nge-query data ruangan asli atau nggak.
const ROOM_AVAILABILITY_KEYWORDS = ['ruang', 'room', 'kosong', 'sepi', 'kamar']

// Kata kunci yang nandain warga lagi nanya/mau urusan nikah atau pendaftaran
// silsilah keluarga -- dipakai Pegawai buat mutusin perlu ngasih tau siapa
// Penghulu yang lagi nganggur (dan menganggap tugas pegawai ke warga ini
// selesai begitu diarahkan). Lihat handlePegawaiMessage di bawah.
const PENGHULU_INTENT_KEYWORDS = [
  'nikah', 'kawin', 'daftar', 'penghulu',
  'mommy', 'daddy', 'kaka', 'abang', 'nenek', 'kakek', 'paman', 'tante',
]

// Urutan prioritas pegawai (Naya -> Mimi -> Cika) dihitung SEKALI dari
// daftar agent yang beneran aktif (punya token & konfigurasi valid di
// config.js), dipakai ulang tiap ada warga baru yang butuh pegawai.
const PEGAWAI_PRIORITY_AGENTS = sortAgentsByPegawaiPriority(ASSISTANT_AGENTS)
const PEGAWAI_PRIORITY_KEYS = PEGAWAI_PRIORITY_AGENTS.map((a) => a.key)
const PEGAWAI_PRIORITY_NAMES_SORTED = PEGAWAI_PRIORITY_AGENTS.map((a) => a.name)

// Cek Penghulu mana yang lagi NGANGGUR (gak punya wedding_sessions yang
// masih berjalan, di thread mana pun) -- data ASLI dari DB, bukan tebakan
// AI, sama prinsipnya kayak getRoomAvailabilitySummary.
async function getIdlePenghuluNames() {
  const { data, error } = await supabaseAdmin
    .from('wedding_sessions')
    .select('agent_key')
    .neq('stage', 'selesai')

  if (error) throw error
  const busyKeys = new Set((data || []).map((r) => r.agent_key))
  return PENGHULU_AGENTS.filter((p) => !busyKeys.has(p.key)).map((p) => p.name)
}

function formatPenghuluStatusContext(idleNames) {
  if (idleNames.length > 0) {
    return `Penghulu yang lagi NGANGGUR (kosong, bisa langsung dipanggil sekarang): ${idleNames.join(', ')}.`
  }
  return 'Semua Penghulu lagi memandu prosesi warga lain, sarankan warga coba lagi beberapa saat lagi.'
}

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
// Cek apakah PENGIRIM pesan ini termasuk pihak yang lagi dilayani sesi
// ini (partner_a / partner_b — buat nikah = mempelai A & B, buat family
// = subject & related). Dipanggil begitu KEDUA pihak sudah teridentifikasi,
// biar warga LAIN yang nyelonong chat di room yang sama nggak ikut
// mengubah state prosesi orang lain (misal kebetulan ngetik "sah").
//
// Kalau belum ada pihak yang teridentifikasi sama sekali (masih nunggu
// mention/relasi di-resolve), balikin true dulu — belum ada yang perlu
// dibatasi di tahap ini.
// ------------------------------------------------------------------
async function isSessionParty(session, telegramUserId) {
  const partyIds = [session.partner_a_id, session.partner_b_id].filter(Boolean)
  if (partyIds.length === 0) return true

  const citizen = await resolveCitizenByTelegramId(telegramUserId)
  if (!citizen) return false
  return partyIds.includes(citizen.id)
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

  let session = await getWeddingSession(supabaseAdmin, { chatId, threadId })

  // ---- Belum ada sesi di thread ini ----
  // CATATAN: sudah tidak pakai kata trigger ("penghulu ...") lagi. Sinyal
  // buat MULAI sesi baru sekarang murni dari ISI pesannya sendiri:
  // - ada kata kunci relasi keluarga (mommy/daddy/dst) -> mulai sesi family
  // - ada 2 mention (@a dan @b) -> mulai sesi nikah
  // - selain itu -> bukan permintaan mulai sesi, dijawab bebas lewat AI
  //   (system instruction Penghulu sudah dibatasi cuma boleh bahas KUA,
  //   lihat personas/penghulu.js) supaya obrolan biasa di room ini TETAP
  //   direspon tanpa perlu kata pemicu apa pun, tapi tanpa nyalain sesi.
  if (!session) {
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

    const couple = await resolveCoupleFromText(text)
    if (couple) {
      session = await claimWeddingSession(supabaseAdmin, { chatId, threadId, agentKey: agent.key })
      if (!session) return // sudah diklaim penghulu lain (race condition antar 5 bot)

      if (couple.citizenA && couple.citizenB) {
        await startCeremony(agent, ctx, threadId, session, couple)
      } else {
        await ctx.reply(SCRIPTED_LINES.couldNotResolve(`@${couple.usernameA}`, `@${couple.usernameB}`), {
          message_thread_id: threadId,
        })
      }
      return
    }

    // Gak ada sinyal mulai sesi (bukan permintaan nikah/keluarga) -> kasih
    // pembukaan baku nanyain "mau ngapain?" (DETERMINISTIK, bukan AI) biar
    // jadi pintu masuk yang konsisten tiap room Penghulu.
    await ctx.reply(SCRIPTED_LINES.greeting(agent.name), { message_thread_id: threadId })
    return
  }

  // ---- Sesi ini bukan punya agent ini -> diam ----
  if (session.agent_key !== agent.key) return

  // ---- Ada pihak yang lagi diproses (mempelai/subject-related sudah
  //      teridentifikasi) -> warga LAIN yang nyelonong chat di room yang
  //      sama diminta duduk & nunggu giliran, chat mereka diabaikan sama
  //      sekali (nggak diproses jadi bagian prosesi siapa pun). ----
  if (!(await isSessionParty(session, ctx.from.id))) {
    await ctx.reply(SCRIPTED_LINES.duduk(agent.name), { message_thread_id: threadId })
    return
  }

  // ---- Sesi tipe 'family' punya alur & tahapannya sendiri, dilempar ke
  //      handler terpisah biar nggak nyampur sama state machine nikah ----
  if (session.session_type === 'family') {
    await handleFamilyMessage(agent, ctx, text, threadId, session)
    return
  }

  if (session.stage === 'selesai') {
    await ctx.reply(SCRIPTED_LINES.alreadyDone(), { message_thread_id: threadId })
    return
  }

  // ---- Masih nunggu nama mempelai ----
  if (session.stage === 'pembukaan' && !session.partner_a_id) {
    const couple = await resolveCoupleFromText(text)
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
      await ctx.reply(SCRIPTED_LINES.penutup(nameA, nameB), { message_thread_id: threadId })
      await ctx.reply(SCRIPTED_LINES.silakanKeluar(), { message_thread_id: threadId })

      // Room-nya dikosongin lagi (bukan cuma di-mark 'selesai') biar bisa
      // langsung dipakai pasangan/warga BERIKUTNYA di thread yang sama.
      try {
        await releaseWeddingSession(supabaseAdmin, session.id)
      } catch (err) {
        console.error(`[${agent.key}] gagal lepas sesi penghulu:`, err)
      }
      return
    }

    // ---- Selain "selesai"/"tutup acara" -> jawab bebas via AI (nasihat,
    //      pertanyaan, atau obrolan apa pun; sudah gak butuh kata "nasihat"
    //      atau "?" lagi, semua pesan di tahap ini direspon) ----
    pushHistory(historyKey, 'user', text)
    const { text: reply } = await runTurn({
      systemInstruction: buildPenghuluSystemInstruction(agent.name),
      apiKey: agent.geminiApiKey,
      history: getHistory(historyKey),
      userMessage: `[Konteks: prosesi pernikahan ${nameA} & ${nameB}, tahap saat ini: doa/setelah ijab-kabul]\nPesan tamu: ${text}`,
    })
    pushHistory(historyKey, 'model', reply)
    await ctx.reply(reply, { message_thread_id: threadId })
    return
  }

  // ---- Tahap pembukaan/ijab_kabul lain: pesan apa pun -> AI ----
  pushHistory(historyKey, 'user', text)
  const { text: reply } = await runTurn({
    systemInstruction: buildPenghuluSystemInstruction(agent.name),
    apiKey: agent.geminiApiKey,
    history: getHistory(historyKey),
    userMessage: `[Konteks: prosesi pernikahan ${nameA || '(mempelai A)'} & ${nameB || '(mempelai B)'}, tahap saat ini: ${session.stage}]\nPesan tamu: ${text}`,
  })
  pushHistory(historyKey, 'model', reply)
  await ctx.reply(reply, { message_thread_id: threadId })
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
    // relation_type di-update lagi di sini (bukan cuma di-set sekali pas
    // klaim) karena fungsi ini juga dipanggil ulang kalau warga yang sama
    // mau nambah relasi LAIN dalam 1x kunjungan (lihat stage 'selesai_tanya'
    // di handleFamilyMessage).
    relation_type: relationType,
    stage: 'konfirmasi',
  })

  await ctx.reply(FAMILY_SCRIPTED_LINES.pembukaan(subjectLabel, relatedLabel, relationLabel), {
    message_thread_id: threadId,
  })
}

async function handleFamilyMessage(agent, ctx, text, threadId, session) {
  const chatId = ctx.chat.id
  const historyKey = `${chatId}:${threadId}:family`
  const relationType = session.relation_type
  const relationLabel = FAMILY_RELATION_LABELS[relationType]

  // ---- Nunggu jawaban "mau nambah anggota keluarga lain atau udah cukup?"
  //      (ditanya begitu 1 relasi berhasil dicatat, lihat blok konfirmasi
  //      di bawah) — biar 1 warga bisa daftarin >1 anggota keluarga dalam
  //      1x kunjungan sebelum bener-bener diminta keluar ruangan. ----
  if (session.stage === 'selesai_tanya') {
    if (textContainsAny(text, KEYWORDS.closeCeremony)) {
      await ctx.reply(SCRIPTED_LINES.silakanKeluar(), { message_thread_id: threadId })
      try {
        await releaseWeddingSession(supabaseAdmin, session.id) // room kosong lagi buat warga berikutnya
      } catch (err) {
        console.error(`[${agent.key}] gagal lepas sesi penghulu:`, err)
      }
      return
    }

    const nextRelationType = detectFamilyRelationType(text)
    if (nextRelationType) {
      const parties = await resolveFamilyPartiesFromText(text, ctx)
      if (parties && parties.citizenRelated && parties.citizenSubject) {
        await startFamilyRegistration(agent, ctx, threadId, session, parties, nextRelationType)
      } else {
        const nextRelationLabel = FAMILY_RELATION_LABELS[nextRelationType]
        await ctx.reply(FAMILY_SCRIPTED_LINES.needTarget(nextRelationLabel), { message_thread_id: threadId })
      }
      return
    }

    // Pesan gak jelas maksudnya nambah atau udahan -> ulangi pertanyaannya
    await ctx.reply(FAMILY_SCRIPTED_LINES.tanyaLanjut(session.partner_a_label), { message_thread_id: threadId })
    return
  }

  if (session.stage === 'selesai') {
    // Fallback aman kalau somehow masih ada row lama stage 'selesai' —
    // normalnya row langsung dihapus (releaseWeddingSession) begitu warga
    // jawab "selesai" di atas, jadi baris ini praktis gak akan kena lagi.
    await ctx.reply(FAMILY_SCRIPTED_LINES.alreadyDone(), { message_thread_id: threadId })
    return
  }

  // ---- Masih nunggu target didaftarkan ----
  if (session.stage === 'pembukaan' && !session.partner_b_id) {
    const parties = await resolveFamilyPartiesFromText(text, ctx)
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
    await startFamilyRegistration(agent, ctx, threadId, session, parties, relationType)
    return
  }

  const subjectLabel = session.partner_a_label
  const relatedLabel = session.partner_b_label

  // ---- Tahap konfirmasi: nunggu kata kunci "sah" (deterministik, bukan AI) ----
  if (session.stage === 'konfirmasi' && textContainsAny(text, FAMILY_CONFIRM_KEYWORDS)) {
    await updateWeddingSession(supabaseAdmin, session.id, { stage: 'selesai_tanya' })
    await ctx.reply(FAMILY_SCRIPTED_LINES.selesai(subjectLabel, relatedLabel, relationLabel), {
      message_thread_id: threadId,
    })
    await ctx.reply(FAMILY_SCRIPTED_LINES.tanyaLanjut(subjectLabel), { message_thread_id: threadId })

    // Tool call beneran ke database, dipicu KODE (bukan AI) begitu tahap
    // konfirmasi dinyatakan sah — sama prinsipnya kayak alur nikah. Ini
    // TETAP jalan biarpun nanti warganya milih nambah relasi lain lagi,
    // karena relasi INI udah valid & harus tercatat independen.
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

  // ---- Pesan apa pun di tengah alur family -> AI (nggak pernah nulis data) ----
  pushHistory(historyKey, 'user', text)
  const { text: reply } = await runTurn({
    systemInstruction: buildPenghuluSystemInstruction(agent.name),
    apiKey: agent.geminiApiKey,
    history: getHistory(historyKey),
    userMessage:
      `[Konteks: pendaftaran silsilah keluarga — ${relatedLabel || '(target)'} didaftarkan sebagai ${relationLabel} ` +
      `dari ${subjectLabel || '(subjek)'}, tahap saat ini: ${session.stage}]\nPesan tamu: ${text}`,
  })
  pushHistory(historyKey, 'model', reply)
  await ctx.reply(reply, { message_thread_id: threadId })
}

// ------------------------------------------------------------------
// Pegawai (Naya, Mimi, Cika) — guide murni, nggak ikut mencatat/mengesahkan.
//
// Beda sama dulu (klaim per-PESAN, siapa cepat dia jawab): sekarang klaim
// per-WARGA. 1 warga = 1 pegawai (sticky) sampai:
// - idle >3 menit (warga gak chat lagi), ATAU
// - pegawai berhasil arahkan warga ke Penghulu yang nganggur (tugas selesai)
// Urutan assign warga BARU: Naya (ketua pegawai) didahulukan, baru Mimi,
// baru Cika — lihat PEGAWAI_PRIORITY_KEYS di atas & claim_pegawai_session
// (migration-007-pegawai-sessions.sql) buat logika atomiknya.
// ------------------------------------------------------------------
async function handlePegawaiMessage(agent, ctx, text, threadId) {
  const lower = text.toLowerCase()
  const chatId = String(ctx.chat.id)
  const telegramUserId = ctx.from.id

  const session = await claimPegawaiSession(supabaseAdmin, {
    chatId,
    telegramUserId,
    priorityAgentKeys: PEGAWAI_PRIORITY_KEYS,
    priorityAgentNames: PEGAWAI_PRIORITY_NAMES_SORTED,
  })

  if (!session) return // semua pegawai lagi sibuk pegang warga lain, belum ada yang bisa jawab dulu
  if (session.agent_key !== agent.key) return // warga ini jatahnya pegawai lain, diam

  // Kalau warga kelihatannya lagi nanya/mau urusan nikah/daftar keluarga,
  // cek Penghulu mana yang beneran nganggur (data ASLI dari DB) supaya
  // Pegawai bisa langsung arahin ke nama yang tepat -- dan anggap tugas
  // pegawai ke warga ini SELESAI (sesi dilepas) begitu diarahkan.
  let penghuluStatusContext = null
  let directingToPenghulu = false
  if (PENGHULU_INTENT_KEYWORDS.some((kw) => lower.includes(kw))) {
    try {
      const idleNames = await getIdlePenghuluNames()
      penghuluStatusContext = formatPenghuluStatusContext(idleNames)
      directingToPenghulu = true
    } catch (err) {
      console.error(`[${agent.key}] gagal ambil status penghulu:`, err)
    }
  }

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
    systemInstruction: buildPegawaiSystemInstruction(agent.name, roomStatusContext, penghuluStatusContext),
    apiKey: agent.geminiApiKey,
    history: [],
    userMessage: text,
  })

  await ctx.reply(reply, threadId != null ? { message_thread_id: threadId } : undefined)

  if (directingToPenghulu) {
    try {
      await releasePegawaiSession(supabaseAdmin, session.id) // tugas selesai, biar pegawai ini bisa nangepin warga lain
    } catch (err) {
      console.error(`[${agent.key}] gagal lepas sesi pegawai:`, err)
    }
  }
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
      // PENTING: jangan pernah balas pesan dari bot lain (termasuk sesama
      // bot RP Town). Sekarang gak ada lagi kata trigger yang jadi filter
      // alami, jadi tanpa ini gampang kejadian bot saling balas pesan bot
      // lain terus-terusan (loop tak berujung).
      if (ctx.from?.is_bot) return

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

  // dropPendingUpdates: true -> pas start, buang update lama yang numpuk
  // (misal pas container lama masih polling terus digantiin container baru).
  // .catch(...) di sini KRUSIAL: tanpa ini, 1 bot yang lagi conflict
  // (409, biasanya pas Railway redeploy & instance lama belum mati total)
  // bakal ngelempar unhandled rejection yang nge-crash SELURUH proses
  // Node — matiin 8 bot + bot utama sekaligus, bukan cuma 1 bot ini aja.
  bot.launch({ dropPendingUpdates: true }).catch((err) => {
    console.error(`[agents] ${agent.key} ("${agent.name}") gagal launch:`, err.message)
    console.error(
      `[agents] Kalau errornya 409 Conflict, biasanya ada instance lama yang masih polling ` +
        `token yang sama (overlap pas redeploy). Tunggu ~30 detik dan cek log lagi — kalau ` +
        `masih looping terus, redeploy manual sekali lagi dari Railway.`
    )
  })
  const roomsLabel = agent.threadIds ? ` (room: ${agent.threadIds.join(', ')})` : ''
  console.log(`[agents] ${agent.key} ("${agent.name}") jalan di grup: ${agent.groupIds.join(', ')}${roomsLabel}`)

  process.once('SIGINT', () => bot.stop('SIGINT'))
  process.once('SIGTERM', () => bot.stop('SIGTERM'))
}

module.exports = { startAgents }
