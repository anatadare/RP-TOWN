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

// Agent Teller Bank (grup RP Town Bank). Beda dari Penghulu/Pegawai: pakai
// Gemini LANGSUNG (function calling), jadi wajib punya Gemini key. Sengaja
// TIDAK dimasukkan ke `allAgents` -- kuaInvite.js menghitung jumlah anggota
// grup KUA dari allAgents.length, dan teller tidak ada di grup KUA.
//
// Env per teller (i = 1, 2, ...):
//   TELLER_i_TOKEN            token bot dari BotFather (WAJIB bot sendiri --
//                             1 bot Telegram cuma bisa punya 1 webhook, jadi
//                             jangan pakai token yang sama dengan Penghulu/Pegawai)
//   TELLER_i_GROUP_IDS        id grup bank (koma-pisah). Default: BANK_GROUP_CHAT_ID
//   TELLER_i_THREAD_IDS       (opsional) id topic yang dilayani, mis. topic "setor dan tarik uang"
//   TELLER_i_NAME             (opsional) default "Mimi"
//   TELLER_i_GEMINI_API_KEY   (opsional) default GEMINI_API_KEY
//   TELLER_i_GEMINI_MODEL     (opsional) default GEMINI_MODEL / gemini-2.5-flash-lite
export function buildTellerAgents(env, count = 2) {
  const list = []
  for (let i = 1; i <= count; i += 1) {
    const token = env[`TELLER_${i}_TOKEN`]
    if (!token) continue

    const groupIdsRaw = env[`TELLER_${i}_GROUP_IDS`]
    const groupIds = groupIdsRaw
      ? groupIdsRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : (env.BANK_GROUP_CHAT_ID ? [env.BANK_GROUP_CHAT_ID] : [])
    if (groupIds.length === 0) continue

    const threadIdsRaw = env[`TELLER_${i}_THREAD_IDS`]
    const threadIds = threadIdsRaw
      ? threadIdsRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : null

    const geminiApiKey = env[`TELLER_${i}_GEMINI_API_KEY`] || env.GEMINI_API_KEY || null
    if (!geminiApiKey) continue

    list.push({
      key: `teller-${i}`,
      kind: 'teller',
      token,
      name: env[`TELLER_${i}_NAME`] || 'Mimi',
      groupIds,
      threadIds,
      geminiApiKey,
      geminiModel: env[`TELLER_${i}_GEMINI_MODEL`] || env.GEMINI_MODEL || 'gemini-2.5-flash-lite',
    })
  }
  return list
}

// Bangun seluruh daftar agent sekali per request, dari `env` yang dikirim
// Workers. Dipanggil dari src/index.js tiap ada request masuk (bukan
// sekali pas cold start global scope, biar selalu baca env yang terbaru).
export function loadAgents(env) {
  const penghuluAgents = buildAgentList(env, 'PENGHULU', 'penghulu', 10, PENGHULU_DEFAULT_NAMES)
  const assistantAgents = buildAgentList(env, 'ASSISTANT', 'assistant', 3, ASSISTANT_DEFAULT_NAMES)
  const tellerAgents = buildTellerAgents(env)
  return {
    penghuluAgents,
    assistantAgents,
    tellerAgents,
    allAgents: [...penghuluAgents, ...assistantAgents],
    aiModel: env.AI_MODEL || 'qwen3.8-flash',
  }
}
