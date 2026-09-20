// Config terpusat buat semua NPC agent (5 Penghulu + 3 Pegawai).
//
// Beda sama versi Railway: di situ pakai `process.env` + dotenv (baca file
// .env). Cloudflare Workers gak punya `process.env` — semua secret/env
// var dikirim lewat parameter `env` ke fetch handler (lihat wrangler.toml
// buat vars biasa, dan `wrangler secret put` buat yang rahasia). Makanya
// semua fungsi di sini terima `env` sebagai parameter, bukan baca global.

export function buildAgentList(env, prefix, kind, count, defaultNames) {
  const list = []
  const kuaGroupChatId = env.KUA_GROUP_CHAT_ID

  for (let i = 1; i <= count; i += 1) {
    const token = env[`${prefix}_${i}_TOKEN`]
    const name = env[`${prefix}_${i}_NAME`] || defaultNames[i - 1] || `${kind} ${i}`
    if (!token) continue // token belum diisi -> agent ini di-skip

    const groupIdsRaw = env[`${prefix}_${i}_GROUP_IDS`]
    const groupIds = groupIdsRaw
      ? groupIdsRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : (kuaGroupChatId ? [kuaGroupChatId] : [])

    if (groupIds.length === 0) continue // gak ada grup yang di-handle -> skip

    const threadIdsRaw = env[`${prefix}_${i}_THREAD_IDS`]
    const threadIds = threadIdsRaw
      ? threadIdsRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : null

    const aiApiKey = env[`${prefix}_${i}_AI_API_KEY`] || env.AI_API_KEY

    // Gemini langsung (opsional) -- ikut jadi kandidat di aiClient.js kalau
    // key-nya ada. Bisa 1 key buat semua agent (GEMINI_API_KEY) atau key
    // sendiri per agent (PENGHULU_i_GEMINI_API_KEY / ASSISTANT_i_GEMINI_API_KEY).
    // Catatan: limit Gemini dihitung PER PROJECT Google Cloud, bukan per key.
    const geminiApiKey = env[`${prefix}_${i}_GEMINI_API_KEY`] || env.GEMINI_API_KEY || null
    const geminiModel = env[`${prefix}_${i}_GEMINI_MODEL`] || env.GEMINI_MODEL || null

    // Cukup salah satu dari Jerouter / Gemini yang ada.
    if (!aiApiKey && !geminiApiKey) continue // gak ada API key sama sekali -> skip

    // Override model per-bot (opsional). Berguna buat sebar beban ke model
    // beda-beda kalau 1 model lagi lambat/kena limit di provider upstream
    // Jerouter (lihat FAQ mereka: "provider yang lambat/limit bisa
    // menyebabkan jeda, coba model lain dari menu Model") -- daripada semua
    // 8 bot mukul 1 model yang sama terus. Fallback ke AI_MODEL global kalau
    // env per-agent ini kosong.
    const aiModel = env[`${prefix}_${i}_AI_MODEL`] || env.AI_MODEL || 'qwen3.8-flash'

    list.push({
      key: `${kind}-${i}`,
      kind, // 'penghulu' | 'assistant'
      token,
      name,
      groupIds,
      threadIds,
      aiApiKey,
      aiModel,
      geminiApiKey,
      geminiModel,
    })
  }
  return list
}

// Bumped dari 5 -> 10 (10 ruang KUA) buat dukung fitur kapasitas +
// antrian ruang KUA (lihat kuaQueue.js) -- kapasitas total dihitung dari
// PANJANG array ini (penghuluAgents.length), jadi ini SATU-SATUNYA tempat
// yang perlu diubah kalau jumlah ruang KUA berubah lagi nanti. Agent yang
// token/grup/API key-nya belum diisi di env otomatis di-skip (lihat
// buildAgentList di atas), jadi aman nambah nama default lebih banyak dari
// yang dipakai sekarang -- gak ada efek sebelum env PENGHULU_6..10 diisi.
const PENGHULU_DEFAULT_NAMES = [
  'Zavier', 'Axel', 'Valdez', 'Gavin', 'Baron',
  'Raka', 'Bagas', 'Teguh', 'Wira', 'Surya',
]
const ASSISTANT_DEFAULT_NAMES = ['Mimi', 'Naya', 'Cika']

// Bangun seluruh daftar agent sekali per request, dari `env` yang dikirim
// Workers. Dipanggil dari src/index.js tiap ada request masuk (bukan
// sekali pas cold start global scope, biar selalu baca env yang terbaru).
export function loadAgents(env) {
  const penghuluAgents = buildAgentList(env, 'PENGHULU', 'penghulu', 10, PENGHULU_DEFAULT_NAMES)
  const assistantAgents = buildAgentList(env, 'ASSISTANT', 'assistant', 3, ASSISTANT_DEFAULT_NAMES)
  return {
    penghuluAgents,
    assistantAgents,
    allAgents: [...penghuluAgents, ...assistantAgents],
    aiModel: env.AI_MODEL || 'qwen3.8-flash',
  }
}
