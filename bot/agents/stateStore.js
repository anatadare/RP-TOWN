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
async function claimWeddingSession(supabaseAdmin, { chatId, threadId, agentKey }) {
  const { data, error } = await supabaseAdmin
    .from('wedding_sessions')
    .insert({ chat_id: chatId, thread_id: threadId, agent_key: agentKey })
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

module.exports = {
  getWeddingSession,
  claimWeddingSession,
  updateWeddingSession,
  claimAssistantMessage,
}
