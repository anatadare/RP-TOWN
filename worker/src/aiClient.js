// Wrapper tipis buat Jerouter — router AI yang OpenAI-compatible
// (https://je.jerouter.web.id). Gantiin geminiClient.js (native Gemini REST)
// karena kita pindah dari Gemini ke model lain lewat Jerouter.
//
// Beda paling penting dari geminiClient.js:
// - Endpoint OpenAI-compatible: POST {base}/chat/completions, bukan
//   {base}/models/{model}:generateContent.
// - Auth pakai header `Authorization: Bearer <key>`, bukan `?key=` di URL.
// - System instruction dikirim sebagai message role "system" di awal array
//   `messages`, bukan field `systemInstruction` terpisah.
// - History disimpan tetap dengan role 'user'/'model' di DB (lihat
//   chatHistory.js), tapi udah dikonversi ke bentuk OpenAI
//   ({role: 'user'|'assistant', content: string}) sebelum sampai sini.
// - Nama model TANPA prefix apa pun -- cukup persis sama seperti field `id`
//   di response GET /v1/models (contoh: "qwen3.8-flash", "glm-5.3").
//
// PENTING soal desain fallback di bawah ini: Jerouter TIDAK punya endpoint
// status resmi (sudah dicek ke dokumentasi mereka), dan ToS mereka jelas
// melarang traffic anomali / beban berlebih ke gateway -- jadi kita SENGAJA
// TIDAK bikin health-check terjadwal/proaktif yang nembakin semua model
// terus-terusan (risiko kena automated ban). Sebagai gantinya: kita cuma
// "ngecek" model lain PAS model utama beneran timeout/gagal, dan bentuk
// ngeceknya adalah beneran adu cepat (race) beberapa model buat NJAWAB
// pesan yang lagi nyangkut itu -- jadi ini murni traffic asli buat
// ngejawab 1 pesan, bukan traffic sintetis tambahan.
//
// PILIHAN MODEL SEKARANG ORGANIK (lihat modelStats.js): urutan yang
// dicoba TIDAK lagi hardcode manual / gantung ke env AI_MODEL per agent --
// tiap attempt (sukses/gagal) dicatat ke Supabase (EWMA), dan tiap ada
// pesan baru kita baca skor itu buat nentuin model mana yang dicoba
// duluan. Model yang lagi sering gagal otomatis mundur ke belakang urutan
// TANPA perlu ada yang ubah env manual; model yang lagi kencang otomatis
// naik ke depan. `model` (dari agent.aiModel/env) sekarang cuma jadi
// SALAH SATU kandidat di kolam yang sama, bukan yang "wajib dicoba
// pertama" lagi.

import { rankModelsByStats, recordModelAttempt } from './modelStats.js'

const JEROUTER_BASE_URL = 'https://je.jerouter.web.id/v1'

// Kolam kandidat model (union sama `model` yang dikirim per-agent, lihat
// runTurn di bawah). Daftar dari model Jerouter yang kamu kasih (status
// 🟢/🟡 pas itu): yang 🔴 offline dibuang (percuma dicoba). Urutan DI SINI
// gak lagi terlalu penting sekarang -- cuma dipakai sebagai skor AWAL buat
// model yang belum punya histori sama sekali (lihat DEFAULT_* di
// modelStats.js, semua model baru mulai dari skor netral yang sama).
// `north-mini-code` sengaja DIBUANG -- itu model buat coding, kemungkinan
// kurang cocok buat roleplay/persona bahasa Indonesia.
const FALLBACK_MODELS = [
  'step-3.7-flash', 'mimo-v2.5', 'nemotron-3-ultra', 'qwen3.8-flash', 'glm-5.3-flash',
  'gemini-3.7-flash', 'gemini-3.6-flash', 'nemotron-3.5-lightning', 'ling-3.0-flash',
  'muse-spark-1.2-contributor', 'muse-spark-1.3-contributor', 'hy3', 'laguna-xs-2.1',
  'nemotron-3-super', 'nemotron-3.5', 'laguna-s-2.1', 'lfm-2.5-2.6b', 'gemini-3.8-flash',
  'nex-n2.5-mini', 'glm-5.2', 'glm-5.3', 'grok-4.5', 'grok-4.6',
  'gemini-3.1-pro', 'nemotron-3-nano-omni', 'nex-n2.5-pro', 'big-pickle',
]

// Cloudflare Workers cuma ngizinin maksimal 6 koneksi keluar BERBARENGAN per
// request -- jadi 1 batch race maksimal 5 model (nyisain 1 slot headroom).
const RACE_BATCH_SIZE = 5
const RACE_ATTEMPT_TIMEOUT_MS = 4500

// Total waktu buat SEMUA percobaan -- nyesuain ke timeoutMilliseconds di
// webhookCallback (index.js, di-set 20000ms).
const TOTAL_TIME_BUDGET_MS = 15000
// Kalau sisa waktu di bawah ini, jangan mulai batch race baru lagi.
const MIN_REMAINING_TO_RACE_MS = 2000
// BATESIN kedalaman fallback -- maksimal 2 batch (10 model) dicoba, biar
// kalau providernya beneran down total, kita nyerah CEPAT (~9-10 detik,
// bukan 15-17 detik kayak sebelumnya) dan langsung kasih tau user
// (misal lewat template "away" pegawai), daripada bikin dia nunggu diem
// lama tanpa kepastian.
const MAX_BATCHES = 2

async function attemptModel(candidateModel, messages, apiKey, timeoutMs, supabaseAdmin) {
  const startedAt = Date.now()
  try {
    const res = await fetch(`${JEROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: candidateModel, messages }),
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`Jerouter API error ${res.status} (model ${candidateModel}): ${errText}`)
    }

    const data = await res.json()
    const text = (data.choices?.[0]?.message?.content || '').trim()
    if (!text) throw new Error(`Jerouter balikin teks kosong (model ${candidateModel})`)

    if (supabaseAdmin) await recordModelAttempt(supabaseAdmin, candidateModel, true, Date.now() - startedAt)
    return { text, modelUsed: candidateModel }
  } catch (err) {
    if (supabaseAdmin) await recordModelAttempt(supabaseAdmin, candidateModel, false, Date.now() - startedAt)
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error(`Jerouter timeout setelah ${timeoutMs}ms (model ${candidateModel})`)
    }
    throw err
  }
}

function dedupe(list) {
  return [...new Set(list)]
}

// Jalanin 1 giliran chat: system instruction (statis, persona) + history
// pendek + pesan user terbaru -> balasan teks dari model.
//
// Alurnya (organik):
// 1. Gabungin `model` (hint dari agent.aiModel/env, opsional) + kolam
//    FALLBACK_MODELS jadi 1 daftar kandidat, dedupe.
// 2. Urutin kandidat itu berdasarkan skor organik (rankModelsByStats) --
//    model yang lagi reliable/cepat menurut histori beneran naik ke depan.
// 3. Race per-batch (maks RACE_BATCH_SIZE sekaligus) dari urutan itu,
//    maksimal MAX_BATCHES kali -- pakai siapa pun yang balas sukses
//    paling cepat. Tiap hasil (sukses/gagal) dicatat lagi buat
//    nyempurnain skor request selanjutnya.
export async function runTurn({
  systemInstruction,
  model, // opsional sekarang -- cuma hint, gak wajib dicoba pertama
  history = [],
  userMessage,
  apiKey,
  supabaseAdmin, // opsional -- kalau gak dikirim, skip pencatatan+ranking, urutan default dipakai
}) {
  if (!apiKey) throw new Error('AI_API_KEY belum dikonfigurasi')

  const messages = [
    { role: 'system', content: systemInstruction },
    ...history,
    { role: 'user', content: userMessage },
  ]

  const candidatePool = dedupe([...(model ? [model] : []), ...FALLBACK_MODELS])
  const rankedCandidates = supabaseAdmin
    ? await rankModelsByStats(supabaseAdmin, candidatePool)
    : candidatePool

  const startedAt = Date.now()
  const remaining = () => TOTAL_TIME_BUDGET_MS - (Date.now() - startedAt)

  let cursor = 0
  let batchesTried = 0
  let lastError = new Error('gak ada model yang berhasil dicoba')

  while (
    cursor < rankedCandidates.length &&
    batchesTried < MAX_BATCHES &&
    remaining() >= MIN_REMAINING_TO_RACE_MS
  ) {
    const batch = rankedCandidates.slice(cursor, cursor + RACE_BATCH_SIZE)
    cursor += batch.length
    batchesTried += 1
    const attemptTimeout = Math.max(1000, Math.min(RACE_ATTEMPT_TIMEOUT_MS, remaining() - 500))

    try {
      // Promise.any -> yang menang adalah yang PALING CEPAT balas sukses;
      // sisanya di batch ini otomatis diabaikan (gak nunggu mereka).
      return await Promise.any(
        batch.map((candidateModel) => attemptModel(candidateModel, messages, apiKey, attemptTimeout, supabaseAdmin))
      )
    } catch (aggregateErr) {
      const errs = aggregateErr.errors || [aggregateErr]
      lastError = errs[errs.length - 1]
      console.warn(`[aiClient] batch #${batchesTried} (${batch.join(', ')}) semua gagal`)
      // lanjut ke batch berikutnya kalau masih ada waktu, kandidat, & kuota batch
    }
  }

  throw new Error(`Semua model dicoba (${batchesTried} batch) gagal/timeout. Error terakhir: ${lastError.message}`)
}
