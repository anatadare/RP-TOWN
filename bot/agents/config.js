// Config terpusat buat semua NPC agent (5 Penghulu + 3 Asisten).
// Baca token & nama tiap agent dari .env — kalau token-nya belum diisi,
// agent itu otomatis di-skip (biar bisa nyalain bertahap, gak wajib 8-8nya
// langsung siap dari awal).

require('dotenv').config()

const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash'
const KUA_GROUP_CHAT_ID = process.env.KUA_GROUP_CHAT_ID // contoh: -1009876543210

// Kata pemicu. Sengaja dicek pakai "includes()" (bukan cocok persis),
// jadi "penghulu ...", "... penghulu ...", "... penghulu" semua ke-trigger,
// sesuai permintaan.
const TRIGGER_WORD_PENGHULU = (process.env.TRIGGER_WORD_PENGHULU || 'penghulu').toLowerCase()
const TRIGGER_WORD_ASSISTANT = (process.env.TRIGGER_WORD_ASSISTANT || 'asisten').toLowerCase()

function buildAgentList(prefix, kind, count, defaultNames) {
  const list = []
  for (let i = 1; i <= count; i += 1) {
    const token = process.env[`${prefix}_${i}_TOKEN`]
    const name = process.env[`${prefix}_${i}_NAME`] || defaultNames[i - 1] || `${kind} ${i}`
    if (!token) {
      console.warn(`[agents] ${prefix}_${i}_TOKEN belum diisi, agent "${name}" di-skip.`)
      continue
    }
    list.push({
      key: `${kind}-${i}`,
      kind, // 'penghulu' | 'assistant'
      token,
      name,
    })
  }
  return list
}

const PENGHULU_AGENTS = buildAgentList('PENGHULU', 'penghulu', 5, [
  'Pak Haji Somad',
  'Ustadz Fikri',
  'Pak Modin Jaya',
  'Kyai Ridho',
  'Pak Penghulu Bahagia',
])

const ASSISTANT_AGENTS = buildAgentList('ASSISTANT', 'assistant', 3, [
  'Mbak Sinta (Asisten KUA)',
  'Mas Rudi (Asisten KUA)',
  'Bu Tari (Asisten KUA)',
])

const AGENTS = [...PENGHULU_AGENTS, ...ASSISTANT_AGENTS]

module.exports = {
  GEMINI_API_KEY,
  GEMINI_MODEL,
  KUA_GROUP_CHAT_ID,
  TRIGGER_WORD_PENGHULU,
  TRIGGER_WORD_ASSISTANT,
  PENGHULU_AGENTS,
  ASSISTANT_AGENTS,
  AGENTS,
}
