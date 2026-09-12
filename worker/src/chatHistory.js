// Pengganti `shortHistory` (in-memory Map) di versi Railway.
// Di Cloudflare Workers tiap request bisa ditangani isolate yang beda,
// jadi histori obrolan pendek disimpan di Supabase (tabel agent_chat_history,
// lihat database/migration-008-agent-chat-history.sql) supaya tetap nyambung.

export const HISTORY_LIMIT = 6

// Balikin histori dalam format OpenAI-compatible (dipakai aiClient.js/Jerouter):
// [{ role: 'user'|'assistant', content: '...' }, ...]
//
// CATATAN: di DB, kolom `role` masih pakai nilai 'user'/'model' (nama lama
// dari jaman Gemini) karena ada CHECK constraint di migration-008 yang
// cuma izinin 2 nilai itu -- daripada bikin migration baru cuma buat ganti
// label, kita simpan apa adanya di DB dan konversi 'model' -> 'assistant'
// di sini, pas mau dikirim ke Jerouter.
export async function getHistory(supabaseAdmin, historyKey) {
  const { data, error } = await supabaseAdmin
    .from('agent_chat_history')
    .select('role, content')
    .eq('history_key', historyKey)
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT)

  if (error) throw error
  return (data || [])
    .reverse()
    .map((row) => ({ role: row.role === 'model' ? 'assistant' : row.role, content: row.content }))
}

export async function pushHistory(supabaseAdmin, historyKey, role, text) {
  const { error } = await supabaseAdmin
    .from('agent_chat_history')
    .insert({ history_key: historyKey, role, content: text })

  if (error) throw error
}
