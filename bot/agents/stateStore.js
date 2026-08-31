// State disimpan di Supabase (bukan in-memory) supaya:
// 1. Tahan kalau proses bot restart (Railway redeploy, dsb) — sesi
//    pernikahan yang lagi jalan gak hilang.
// 2. Aman dipakai 8 proses bot sekaligus — semua baca/tulis ke sumber yang
//    sama, gak ada state "nyasar" di proses yang beda.
//
// Mekanisme KLAIM pakai constraint `unique` di database (lihat
// migration-005-marriage-agents.sql): siapa yang berhasil INSERT duluan,
// dialah yang "pegang" room itu. Yang gagal (23505 = unique violation)
// berarti sudah diklaim agent lain -> diam aja.

const UNIQUE_VIOLATION = '23505'

// ---- Wedding sessions (1 sesi = 1 pernikahan yang lagi berjalan di 1 thread) ----

async function getWeddingSession(supabaseAdmin, { chatId, threadId }) {
  const { data, error } = await supabaseAdmin
    .from('wedding_sessions')
    .select('*')
    .eq('chat_id', chatId)
    .eq('thread_id', threadId)
    .maybeSingle()

  if (error) throw error
  return data
}

// Coba klaim thread ini buat sebuah agent penghulu. Return null kalau sudah
// diklaim agent lain (race condition antar 5 bot penghulu ke-handle di sini).
//
// `sessionType`: 'marriage' (default, alur nikah) atau 'family' (alur
// ekspansi silsilah). `relationType` cuma diisi kalau sessionType='family'
// (lihat FAMILY_KEYWORDS di personas/penghulu.js).
async function claimWeddingSession(
  supabaseAdmin,
  { chatId, threadId, agentKey, sessionType = 'marriage', relationType = null }
) {
  const { data, error } = await supabaseAdmin
    .from('wedding_sessions')
    .insert({
      chat_id: chatId,
      thread_id: threadId,
      agent_key: agentKey,
      session_type: sessionType,
      relation_type: relationType,
    })
    .select()
    .single()

  if (error) {
    if (error.code === UNIQUE_VIOLATION) return null
    throw error
  }
  return data
}

async function updateWeddingSession(supabaseAdmin, id, patch) {
  const { data, error } = await supabaseAdmin
    .from('wedding_sessions')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

// Lepas (hapus) sesi begitu 1 prosesi bener-bener kelar (nikah 'penutup',
// atau family udah dijawab "selesai" di stage 'selesai_tanya') — biar
// room-nya kosong lagi dan bisa dipakai pasangan/warga BERIKUTNYA, bukan
// cuma sekali pakai selamanya per thread.
async function releaseWeddingSession(supabaseAdmin, id) {
  const { error } = await supabaseAdmin.from('wedding_sessions').delete().eq('id', id)
  if (error) throw error
}

// ---- Assistant message claims (1 klaim = 1 pertanyaan yang lagi dijawab) ----

// Coba klaim 1 pesan spesifik buat salah satu dari 3 bot asisten, biar
// cuma 1 yang jawab tiap pertanyaan (bukan bertiga sekaligus).
async function claimAssistantMessage(supabaseAdmin, { chatId, messageId, agentKey }) {
  const scopeKey = `assist:${chatId}:${messageId}`

  const { error } = await supabaseAdmin
    .from('agent_message_claims')
    .insert({ scope_key: scopeKey, agent_key: agentKey })

  if (error) {
    if (error.code === UNIQUE_VIOLATION) return false
    throw error
  }
  return true
}

// ---- Pegawai sessions (1 sesi = 1 pegawai lagi handel 1 warga tertentu) ----
//
// Beda sama claimAssistantMessage di atas (klaim per-PESAN, race "siapa
// cepat"): ini klaim per-WARGA, jadi 1 pegawai "nempel" ke 1 warga terus
// sampai idle >3 menit atau warga udah diarahkan ke Penghulu. Logikanya
// atomik di database lewat RPC `claim_pegawai_session` (lihat
// migration-007-pegawai-sessions.sql) biar gak race antar 3 proses bot
// pegawai yang jalan bersamaan.

const PEGAWAI_IDLE_SECONDS = 180 // 3 menit

// `priorityAgentKeys`/`priorityAgentNames` HARUS sudah diurutkan sesuai
// prioritas (Naya -> Mimi -> Cika, lihat personas/pegawai.js) sebelum
// dikirim ke sini — urutan array inilah yang dipakai database buat
// nentuin siapa yang nganggur duluan.
//
// Return: row sesi (ada agent_key-nya) kalau berhasil/udah ada, atau
// `null` kalau semua pegawai lagi sibuk pegang warga lain.
async function claimPegawaiSession(
  supabaseAdmin,
  { chatId, telegramUserId, priorityAgentKeys, priorityAgentNames, idleSeconds = PEGAWAI_IDLE_SECONDS }
) {
  const { data, error } = await supabaseAdmin.rpc('claim_pegawai_session', {
    p_chat_id: chatId,
    p_telegram_user_id: telegramUserId,
    p_agent_keys: priorityAgentKeys,
    p_agent_names: priorityAgentNames,
    p_idle_seconds: idleSeconds,
  })

  if (error) throw error
  return data
}

// Lepas sesi (dipanggil begitu pegawai berhasil arahkan warga ke Penghulu
// yang nganggur -> tugas pegawai ke warga ini dianggap selesai).
async function releasePegawaiSession(supabaseAdmin, sessionId) {
  const { error } = await supabaseAdmin.rpc('release_pegawai_session', { p_session_id: sessionId })
  if (error) throw error
}

module.exports = {
  getWeddingSession,
  claimWeddingSession,
  updateWeddingSession,
  releaseWeddingSession,
  claimAssistantMessage,
  PEGAWAI_IDLE_SECONDS,
  claimPegawaiSession,
  releasePegawaiSession,
}
