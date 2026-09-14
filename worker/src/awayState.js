// Status "pegawai lagi pergi sebentar" -- dipakai bareng
// personas/awayTemplates.js buat gantiin fallback generik "(sinyal lagi
// kurang bagus...)" pas AI beneran timeout total.
//
// Alurnya (lihat index.js catch block + agentLogic.js handlePegawaiMessage):
// 1. Timeout PERTAMA kali buat 1 warga -> startAwayState() berhasil insert
//    -> kirim 3 pesan "leave" template (enter/say/exit).
// 2. Warga spam chat lagi SELAMA masih away -> startAwayState() gagal
//    (unique violation, scope_key udah ada) -> jangan kirim apa-apa, cuma
//    diemin (pesannya tetap kesimpen di agent_chat_history lewat
//    pushHistory seperti biasa, jadi gak hilang).
// 3. AI berhasil jawab lagi (gak timeout) -> clearAwayState() ambil +
//    hapus barisnya -> kirim 1 pesan "back" template (nyambung ke excuse
//    yang sama) SEBELUM jawaban asli dikirim.

const UNIQUE_VIOLATION = '23505'

export async function getAwayState(supabaseAdmin, scopeKey) {
  const { data, error } = await supabaseAdmin
    .from('pegawai_away_state')
    .select('*')
    .eq('scope_key', scopeKey)
    .maybeSingle()

  if (error) throw error
  return data
}

// Return `null` kalau warga ini udah "away" duluan (jangan kirim template
// lagi), atau balikin baris yang baru diinsert kalau ini kali pertama.
export async function startAwayState(supabaseAdmin, { scopeKey, excuseIndex, agentName, mention }) {
  const { data, error } = await supabaseAdmin
    .from('pegawai_away_state')
    .insert({ scope_key: scopeKey, excuse_index: excuseIndex, agent_name: agentName, mention })
    .select()
    .single()

  if (error) {
    if (error.code === UNIQUE_VIOLATION) return null
    throw error
  }
  return data
}

// Dipanggil pas AI berhasil jawab lagi -- ambil sekaligus hapus baris
// away-nya (biar gak nyangkut), buat dipakai bikin pesan "balik".
export async function clearAwayState(supabaseAdmin, scopeKey) {
  const { data, error } = await supabaseAdmin
    .from('pegawai_away_state')
    .delete()
    .eq('scope_key', scopeKey)
    .select()
    .maybeSingle()

  if (error) throw error
  return data
}

// Bikin "mention" yang enak dibaca dari objek `from` Telegram -- pakai
// @username kalau warganya punya username publik, fallback ke nama depan
// (Telegram DM/first_name selalu ada) biar gak nulis "@undefined".
export function mentionFor(from) {
  if (from?.username) return `@${from.username}`
  return from?.first_name || 'kakak'
}
