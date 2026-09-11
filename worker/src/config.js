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

    const geminiApiKey = env[`${prefix}_${i}_GEMINI_API_KEY`] || env.GEMINI_API_KEY
    if (!geminiApiKey) continue // gak ada API key -> skip

    list.push({
      key: `${kind}-${i}`,
      kind, // 'penghulu' | 'assistant'
      token,
      name,
      groupIds,
      threadIds,
      geminiApiKey,
    })
  }
  return list
}

const PENGHULU_DEFAULT_NAMES = ['Zavier', 'Axel', 'Valdez', 'Gavin', 'Baron']
const ASSISTANT_DEFAULT_NAMES = ['Mimi', 'Naya', 'Cika']

// Bangun seluruh daftar agent sekali per request, dari `env` yang dikirim
// Workers. Dipanggil dari src/index.js tiap ada request masuk (bukan
// sekali pas cold start global scope, biar selalu baca env yang terbaru).
export function loadAgents(env) {
  const penghuluAgents = buildAgentList(env, 'PENGHULU', 'penghulu', 5, PENGHULU_DEFAULT_NAMES)
  const assistantAgents = buildAgentList(env, 'ASSISTANT', 'assistant', 3, ASSISTANT_DEFAULT_NAMES)
  return {
    penghuluAgents,
    assistantAgents,
    allAgents: [...penghuluAgents, ...assistantAgents],
    geminiModel: env.GEMINI_MODEL || 'gemini-2.0-flash',
  }
}
