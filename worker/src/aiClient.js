// Klien AI buat semua NPC (Penghulu & Pegawai) -- Jerouter DULU, Gemini TERAKHIR.
//
// URUTAN PEMAKAIAN (2 fase):
//   FASE 1 -- Jerouter (gateway OpenAI-compatible, https://je.jerouter.web.id)
//     dengan kolam banyak model. Semua kandidat Jerouter dicoba se-maksimal
//     mungkin (hedged race, lihat di bawah) sebelum menyerah.
//   FASE 2 -- Gemini API langsung (OPSIONAL, aktif kalau GEMINI_API_KEY diisi).
//     CUMA dipakai kalau FASE 1 gagal total (semua model Jerouter error/
//     timeout/kehabisan waktu). Gemini TIDAK ikut bersaing di fase 1.
//
// PILIHAN MODEL ORGANIK (lihat modelStats.js): tiap attempt (sukses/gagal)
// dicatat ke Supabase (EWMA sukses + latency), dan tiap ada pesan baru urutan
// kandidat dihitung dari skor itu -- model yang lagi lambat/sering gagal
// otomatis mundur, yang kencang naik ke depan, tanpa ubah env manual. Model
// yang statusnya 🔴/🟡 di daftar Jerouter SENGAJA tetap ada di kolam: kalau
// lagi mati dia gagal cepat lalu turun peringkat, kalau sudah pulih dia naik
// sendiri -- gak perlu ubah kode tiap status berubah.
//
// CARA NGEJAR KECEPATAN: HEDGED REQUEST, bukan race banyak model sekaligus.
//   1. Kirim ke model peringkat #1 SAJA.
//   2. Kalau belum balas dalam `hedgeDelayMs` (adaptif: ~1.6x latency biasa
//      model itu, dibatasi 1.8-4 detik) -> luncurkan model #2 TANPA
//      membatalkan #1. Ulangi sampai maksimal MAX_CONCURRENT_ATTEMPTS.
//   3. Kalau ada yang GAGAL (error/429/timeout) -> langsung luncurkan
//      penggantinya, gak nunggu hedge timer.
//   4. Yang balas sukses PERTAMA menang; sisanya di-abort (koneksi langsung
//      dilepas). Model yang kelamaan (>= hedgeDelay) dan kalah dicatat
//      sebagai "terlalu lambat" biar turun peringkat.
//
// TETAP TIDAK ADA health-check terjadwal ke Jerouter (ToS mereka melarang
// traffic anomali) -- semua data skor berasal dari request nyata.

import { rankModelsByStats, recordModelAttempt, getCachedLatencyMs } from './modelStats.js'

const JEROUTER_BASE_URL = 'https://je.jerouter.web.id/v1'
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

// Nama kandidat Gemini langsung dibedain dari model Jerouter (yang juga ada
// "gemini-3.6-flash" lewat gateway) pakai prefix ini. Prefix ikut tersimpan
// di ai_model_stats sebagai nama model (buat mantau seberapa sering Gemini
// kepakai) -- gak perlu migration.
export const GEMINI_DIRECT_PREFIX = 'gemini-direct/'

// Rantai Gemini (urutan dicoba). Kalau env GEMINI_MODEL diisi, dia jadi yang
// pertama, sisanya tetap jadi cadangan. gemini-2.5-flash-lite dijadwalkan
// dimatikan Google (Okt 2026), makanya yang 3.1 di depan -- tapi 2.5 tetap
// ditaruh di belakang buat jaga-jaga selama dia masih hidup / kalau ada nama
// model yang salah (error 404 langsung pindah ke berikutnya).
const DEFAULT_GEMINI_MODELS = ['gemini-3.1-flash-lite', 'gemini-2.5-flash-lite']
const GEMINI_MAX_OUTPUT_TOKENS = 1024

// Kolam kandidat Jerouter -- DIPILIH tangan, khusus yang enak buat roleplay
// chat BAHASA INDONESIA. Disusun dari daftar status Jerouter tanggal 20 Sep
// 2026. Model 🔴 offline / 🟡 lambat SENGAJA ikut (bisa pulih sendiri, lihat
// catatan di atas). Yang dibuang:
//   - model coding (north-mini-code), model kecil banget (lfm-2.5-2.6b,
//     nemotron-3-nano-omni, laguna-xs-2.1, laguna-s-2.1), model vision
//     (ling-3.0-flash-vl), model khusus kesehatan (ling-3.0-flash-sante)
//   - model agent/coding (nex-n2.5-pro, nex-n2.5-mini) & model pencarian
//     (sonar -- jawabannya gaya search engine, bukan roleplay)
//   - "free" (alias gak jelas, bisa nge-route ke model apa aja)
//
// Skor organik (modelStats.js) cuma ngukur KECEPATAN & KEBERHASILAN, gak
// ngukur kualitas -- jadi model kecil yang kencang bisa nyalip model bagus
// yang agak lambat. Makanya tiap model dikasih BONUS KUALITAS awal (tier di
// bawah, penilaian dari reputasi multibahasa/gaya ngobrol keluarganya, BUKAN
// hasil tes langsung -- ubah aja kalau di lapangan ada yang ternyata jelek/
// bagus). Tier A ~ selisih 1,5 detik latency, tier B ~ 0,7 detik.
const MODEL_TIERS = {
  A: [
    'gpt-5.6-luna', 'grok-4.6', 'qwen3.8-27b', 'deepseek-v4-flash', 'muse-spark-1.3-contributor',
    'gemini-3.6-flash', 'glm-5.3', 'deepseek-v4.1-flash', // 🔴 pas daftar dibuat
  ],
  B: [
    'step-3.7-flash', 'glm-5.2', 'mimo-v2.5', 'hy4-preview', 'hy3', 'ling-3.0-flash', 'big-pickle',
    'glm-5.3-flash', 'gemma4', 'deepseek-v4-flash-0731', // 🔴 pas daftar dibuat
  ],
  C: [
    'nemotron-3-super', 'nemotron-3.5', 'dots-3-note-preview', // cadangan
    'nemotron-3.5-lightning', 'mistral-nemotron', // 🟡/🔴 pas daftar dibuat
  ],
}
const TIER_BONUS = { A: 0.15, B: 0.07, C: 0 }

const QUALITY_BONUS = {}
for (const [tier, names] of Object.entries(MODEL_TIERS)) {
  for (const name of names) QUALITY_BONUS[name] = TIER_BONUS[tier]
}
const JEROUTER_POOL = Object.keys(QUALITY_BONUS)

// ---- Tuning hedging (fase 1: Jerouter) ----
const HEDGE_DELAY_MIN_MS = 1800
const HEDGE_DELAY_MAX_MS = 4000
const HEDGE_LATENCY_MULTIPLIER = 1.6
const DEFAULT_TYPICAL_LATENCY_MS = 2500
const MAX_CONCURRENT_ATTEMPTS = 3 // aman di bawah batas 6 koneksi keluar Workers
const MAX_TOTAL_ATTEMPTS = 12 // naik dari 8: kolam sekarang lebih besar & model 🔴 gagalnya cepat
const ATTEMPT_TIMEOUT_MS = 9000
const JEROUTER_BUDGET_MS = 11000

// ---- Tuning fase 2 (Gemini, pilihan terakhir) ----
// Total fase 1 + fase 2 = 16 detik, masih di bawah timeoutMilliseconds
// webhookCallback (index.js, 20000ms) -- sisanya buat fetch history dll.
const GEMINI_HEDGE_DELAY_MS = 2500
const GEMINI_ATTEMPT_TIMEOUT_MS = 4500
const GEMINI_BUDGET_MS = 5000

// Model yang barusan GAGAL (429/5xx/timeout/offline/teks kosong) dikistirahatkan
// sebentar (per isolate), biar gak dihajar terus & gak jadi pilihan #1 lagi
// di pesan berikutnya.
const COOLDOWN_MS = 45000
const cooldownUntil = new Map()

function isCoolingDown(model) {
  const until = cooldownUntil.get(model)
  if (!until) return false
  if (Date.now() >= until) {
    cooldownUntil.delete(model)
    return false
  }
  return true
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function dedupe(list) {
  return [...new Set(list)]
}

function httpError(message, status) {
  const err = new Error(message)
  err.status = status
  return err
}

function toTimeoutError(err, model) {
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
    return new Error(`timeout (model ${model})`)
  }
  return err
}

// ------------------------------------------------------------------
// Panggilan ke provider
// ------------------------------------------------------------------
async function callJerouter(model, messages, apiKey, signal) {
  const res = await fetch(`${JEROUTER_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages }),
    signal,
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw httpError(`Jerouter API error ${res.status} (model ${model}): ${errText.slice(0, 300)}`, res.status)
  }

  const data = await res.json()
  const text = (data.choices?.[0]?.message?.content || '').trim()
  if (!text) throw new Error(`Jerouter balikin teks kosong (model ${model})`)
  return text
}

// Bentuk OpenAI ({role: system|user|assistant}) -> bentuk Gemini. Pesan
// berurutan dengan role sama digabung (history kadang memuat pesan user yang
// sama dua kali -- lihat handlePegawaiMessage -- dan Gemini lebih aman kalau
// giliran user/model selang-seling).
function toGeminiPayload(messages) {
  const system = messages.find((m) => m.role === 'system')?.content || ''
  const contents = []
  for (const m of messages) {
    if (m.role === 'system') continue
    const role = m.role === 'assistant' ? 'model' : 'user'
    const last = contents[contents.length - 1]
    if (last && last.role === role) {
      last.parts[0].text += `\n${m.content}`
    } else {
      contents.push({ role, parts: [{ text: m.content }] })
    }
  }
  return { system, contents }
}

async function callGeminiDirect(modelWithPrefix, messages, apiKey, signal) {
  const model = modelWithPrefix.slice(GEMINI_DIRECT_PREFIX.length)
  const { system, contents } = toGeminiPayload(messages)

  const generationConfig = { maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS }
  // Seri 2.5 Flash "mikir" dulu secara default -- itu yang bikin lambat buat
  // chat roleplay pendek. Budget 0 = matiin thinking (didukung Flash & Flash-Lite).
  // (Seri 3.x sengaja gak diutak-atik: parameter thinking-nya beda, dan
  // salah kirim malah bikin request ditolak.)
  if (/gemini-2\.5-flash/.test(model)) generationConfig.thinkingConfig = { thinkingBudget: 0 }

  const res = await fetch(`${GEMINI_API_BASE}/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents,
      systemInstruction: { parts: [{ text: system }] },
      generationConfig,
    }),
    signal,
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw httpError(`Gemini API error ${res.status} (model ${model}): ${errText.slice(0, 300)}`, res.status)
  }

  const data = await res.json()
  const text = (data.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text || '')
    .join('')
    .trim()
  if (!text) throw new Error(`Gemini balikin teks kosong (model ${model}, finishReason ${data.candidates?.[0]?.finishReason || '?'})`)
  return text
}

// ------------------------------------------------------------------
// Hedged race (dipisah & di-export biar gampang dites)
// ------------------------------------------------------------------
// `attempt(model, signal)` -> Promise<string> (teks balasan).
// `onOutcome(model, success, latencyMs, err?)` dipanggil buat pencatatan skor.
// `err` cuma ada kalau modelnya BENERAN gagal (bukan sekadar kalah race).
export function hedgedRace({
  candidates,
  attempt,
  onOutcome = () => {},
  hedgeDelayMs,
  maxConcurrent = MAX_CONCURRENT_ATTEMPTS,
  maxAttempts = MAX_TOTAL_ATTEMPTS,
  attemptTimeoutMs = ATTEMPT_TIMEOUT_MS,
  budgetMs = JEROUTER_BUDGET_MS,
}) {
  return new Promise((resolve, reject) => {
    const running = new Map() // model -> { controller, startedAt }
    let nextIndex = 0
    let launched = 0
    let settled = false
    let lastError = new Error('gak ada model yang berhasil dicoba')
    let hedgeTimer = null

    const deadlineTimer = setTimeout(() => {
      if (settled) return
      settled = true
      clearTimeout(hedgeTimer)
      const now = Date.now()
      for (const [model, info] of running) {
        onOutcome(model, false, now - info.startedAt)
        info.controller.abort()
      }
      running.clear()
      reject(new Error(`Semua percobaan (${launched} model) gagal/timeout dalam ${budgetMs}ms. Error terakhir: ${lastError.message}`))
    }, budgetMs)

    function armHedge() {
      clearTimeout(hedgeTimer)
      if (settled) return
      hedgeTimer = setTimeout(() => {
        if (launch()) armHedge()
      }, hedgeDelayMs)
    }

    function failIfDead() {
      if (settled || running.size > 0) return
      settled = true
      clearTimeout(hedgeTimer)
      clearTimeout(deadlineTimer)
      reject(new Error(`Semua model dicoba (${launched}) gagal/timeout. Error terakhir: ${lastError.message}`))
    }

    function win(model, text, startedAt) {
      settled = true
      clearTimeout(hedgeTimer)
      clearTimeout(deadlineTimer)
      const now = Date.now()
      onOutcome(model, true, now - startedAt)
      running.delete(model)
      for (const [otherModel, info] of running) {
        // Kalah + sudah lewat hedge delay = terlalu lambat buat dipakai chat.
        // Yang baru diluncurkan (belum sempat lama) gak dihukum.
        const elapsed = now - info.startedAt
        if (elapsed >= hedgeDelayMs) onOutcome(otherModel, false, elapsed)
        info.controller.abort()
      }
      running.clear()
      resolve({ text, modelUsed: model })
    }

    function launch() {
      if (settled) return false
      if (nextIndex >= candidates.length || launched >= maxAttempts || running.size >= maxConcurrent) return false

      const model = candidates[nextIndex++]
      launched += 1
      const controller = new AbortController()
      const startedAt = Date.now()
      running.set(model, { controller, startedAt })
      const timeoutId = setTimeout(() => controller.abort(), attemptTimeoutMs)

      attempt(model, controller.signal).then(
        (text) => {
          clearTimeout(timeoutId)
          if (settled) return
          win(model, text, startedAt)
        },
        (err) => {
          clearTimeout(timeoutId)
          if (settled) return // di-abort karena model lain sudah menang
          running.delete(model)
          lastError = toTimeoutError(err, model)
          onOutcome(model, false, Date.now() - startedAt, lastError)
          // Ada yang gagal -> gak usah nunggu hedge timer, langsung ganti.
          if (launch()) armHedge()
          else failIfDead()
        }
      )
      return true
    }

    if (launch()) armHedge()
    else failIfDead()
  })
}

// ------------------------------------------------------------------
// runTurn
// ------------------------------------------------------------------
// Jalanin 1 giliran chat: system instruction (statis, persona) + history
// pendek + pesan user terbaru -> balasan teks dari model.
export async function runTurn({
  systemInstruction,
  model, // (diabaikan -- lihat komentar di bawah; dipertahankan biar pemanggil lama gak error)
  history = [],
  userMessage,
  apiKey, // key Jerouter
  geminiApiKey, // opsional -- kalau diisi, jadi PILIHAN TERAKHIR kalau semua Jerouter gagal
  geminiModel, // opsional -- model Gemini yang dicoba paling dulu di fase 2
  supabaseAdmin, // opsional -- tanpa ini pencatatan+ranking dilewati
}) {
  if (!apiKey && !geminiApiKey) throw new Error('AI_API_KEY (Jerouter) atau GEMINI_API_KEY belum dikonfigurasi')

  const messages = [
    { role: 'system', content: systemInstruction },
    ...history,
    { role: 'user', content: userMessage },
  ]

  // `model` (agent.aiModel dari env AI_MODEL) SENGAJA gak dipakai lagi buat
  // nambah kandidat: env lama sering nunjuk model yang sudah dihapus dari
  // Jerouter (contoh: qwen3.8-flash) dan bikin tiap pesan mulai dari error.
  // Kolam sekarang murni dari JEROUTER_POOL di atas.
  void model

  const onOutcome = (candidateModel, success, latencyMs, err) => {
    if (!success && err) cooldownUntil.set(candidateModel, Date.now() + COOLDOWN_MS)
    // Fire-and-forget: pencatatan skor gak boleh nambah latency balasan.
    if (supabaseAdmin) void recordModelAttempt(supabaseAdmin, candidateModel, success, latencyMs)
  }

  // ---------------- FASE 1: Jerouter ----------------
  let jerouterError = null
  if (apiKey) {
    try {
      const ranked = supabaseAdmin
        ? await rankModelsByStats(supabaseAdmin, JEROUTER_POOL, { bonus: QUALITY_BONUS })
        : JEROUTER_POOL
      const usable = ranked.filter((m) => !isCoolingDown(m))
      const candidates = usable.length > 0 ? usable : ranked

      const typicalLatency = getCachedLatencyMs(candidates[0]) ?? DEFAULT_TYPICAL_LATENCY_MS
      const hedgeDelayMs = clamp(typicalLatency * HEDGE_LATENCY_MULTIPLIER, HEDGE_DELAY_MIN_MS, HEDGE_DELAY_MAX_MS)

      const result = await hedgedRace({
        candidates,
        hedgeDelayMs,
        attempt: (candidateModel, signal) => callJerouter(candidateModel, messages, apiKey, signal),
        onOutcome,
      })

      console.log(`[aiClient] ${result.modelUsed} menang (hedge ${Math.round(hedgeDelayMs)}ms)`)
      return result
    } catch (err) {
      jerouterError = err
      if (!geminiApiKey) throw err
      console.warn(`[aiClient] semua Jerouter gagal, pindah ke Gemini (pilihan terakhir): ${err?.message || err}`)
    }
  }

  // ---------------- FASE 2: Gemini (pilihan terakhir) ----------------
  const geminiChain = dedupe([...(geminiModel ? [geminiModel] : []), ...DEFAULT_GEMINI_MODELS]).map(
    (m) => `${GEMINI_DIRECT_PREFIX}${m}`
  )

  try {
    const result = await hedgedRace({
      candidates: geminiChain,
      hedgeDelayMs: GEMINI_HEDGE_DELAY_MS,
      maxConcurrent: 2,
      maxAttempts: geminiChain.length,
      attemptTimeoutMs: GEMINI_ATTEMPT_TIMEOUT_MS,
      budgetMs: GEMINI_BUDGET_MS,
      attempt: (candidateModel, signal) => callGeminiDirect(candidateModel, messages, geminiApiKey, signal),
      onOutcome,
    })
    console.log(`[aiClient] ${result.modelUsed} menang (pilihan terakhir, Jerouter gagal semua)`)
    return result
  } catch (geminiErr) {
    throw new Error(
      `Jerouter & Gemini sama-sama gagal. Jerouter: ${jerouterError?.message || '(gak dipakai)'} | Gemini: ${geminiErr.message}`
    )
  }
}
