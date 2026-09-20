// Klien AI buat semua NPC (Penghulu & Pegawai) -- sekarang HYBRID:
//
// - Jerouter (gateway OpenAI-compatible, https://je.jerouter.web.id) dengan
//   kolam banyak model, DAN
// - Gemini API langsung (opsional -- aktif kalau GEMINI_API_KEY diisi),
//   sebagai kandidat "jalur resmi" yang biasanya lebih stabil daripada
//   gateway perantara.
//
// PILIHAN MODEL ORGANIK (lihat modelStats.js): tiap attempt (sukses/gagal)
// dicatat ke Supabase (EWMA sukses + latency), dan tiap ada pesan baru urutan
// kandidat dihitung dari skor itu -- model yang lagi lambat/sering gagal
// otomatis mundur, yang kencang naik ke depan, tanpa ubah env manual.
//
// CARA NGEJAR KECEPATAN (beda dari versi sebelumnya): HEDGED REQUEST, bukan
// race 5 model sekaligus.
//   1. Kirim ke model peringkat #1 SAJA.
//   2. Kalau belum balas dalam `hedgeDelayMs` (adaptif: ~1.6x latency biasa
//      model itu, dibatasi 1.8-4 detik) -> luncurkan model #2 TANPA
//      membatalkan #1. Ulangi sampai maksimal MAX_CONCURRENT_ATTEMPTS.
//   3. Kalau ada yang GAGAL (error/429/timeout) -> langsung luncurkan
//      penggantinya, gak nunggu hedge timer.
//   4. Yang balas sukses PERTAMA menang; sisanya di-abort (koneksi langsung
//      dilepas). Model yang kelamaan (>= hedgeDelay) dan kalah dicatat
//      sebagai "terlalu lambat" biar turun peringkat.
// Hasilnya: kondisi normal cuma 1 request per pesan (bukan 5), jadi jauh
// lebih ringan buat gateway (aman dari rate limit / ToS "beban berlebih")
// dan gak ngabisin jatah 6 koneksi keluar per request di Workers, tapi kalau
// model utama lagi nge-lag, pengganti sudah jalan di detik ke-2 -- bukan
// nunggu timeout penuh baru pindah model.
//
// TETAP TIDAK ADA health-check terjadwal ke Jerouter (ToS mereka melarang
// traffic anomali) -- semua data skor berasal dari request nyata.

import { rankModelsByStats, recordModelAttempt, getCachedLatencyMs } from './modelStats.js'

const JEROUTER_BASE_URL = 'https://je.jerouter.web.id/v1'
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

// Nama kandidat Gemini langsung dibedain dari model Jerouter (yang juga ada
// "gemini-3.7-flash" dst lewat gateway) pakai prefix ini. Prefix ikut
// tersimpan di ai_model_stats sebagai nama model -- gak perlu migration.
export const GEMINI_DIRECT_PREFIX = 'gemini-direct/'
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash-lite' // paling kencang & limit gratisnya paling longgar
const GEMINI_MAX_OUTPUT_TOKENS = 800
// Bonus skor kecil buat jalur resmi (Gemini langsung) -- kalau dia sering
// gagal/429/lambat, skor EWMA-nya sendiri yang bakal ngalahin bonus ini.
const GEMINI_DIRECT_SCORE_BONUS = 0.2

// Kolam kandidat Jerouter. Urutan DI SINI gak penting (dipakai cuma buat
// model yang belum punya histori -- semuanya mulai dari skor netral yang
// sama). `north-mini-code` sengaja dibuang: model buat coding, kurang cocok
// buat roleplay bahasa Indonesia.
const FALLBACK_MODELS = [
  'step-3.7-flash', 'mimo-v2.5', 'nemotron-3-ultra', 'qwen3.8-flash', 'glm-5.3-flash',
  'gemini-3.7-flash', 'gemini-3.6-flash', 'nemotron-3.5-lightning', 'ling-3.0-flash',
  'muse-spark-1.2-contributor', 'muse-spark-1.3-contributor', 'hy3', 'laguna-xs-2.1',
  'nemotron-3-super', 'nemotron-3.5', 'laguna-s-2.1', 'lfm-2.5-2.6b', 'gemini-3.8-flash',
  'nex-n2.5-mini', 'glm-5.2', 'glm-5.3', 'grok-4.5', 'grok-4.6',
  'gemini-3.1-pro', 'nemotron-3-nano-omni', 'nex-n2.5-pro', 'big-pickle',
]

// ---- Tuning hedging ----
const HEDGE_DELAY_MIN_MS = 1800
const HEDGE_DELAY_MAX_MS = 4000
const HEDGE_LATENCY_MULTIPLIER = 1.6
const DEFAULT_TYPICAL_LATENCY_MS = 2500
const MAX_CONCURRENT_ATTEMPTS = 3 // aman di bawah batas 6 koneksi keluar Workers
const MAX_TOTAL_ATTEMPTS = 8
const ATTEMPT_TIMEOUT_MS = 9000
// Total waktu buat SEMUA percobaan -- nyesuain ke timeoutMilliseconds di
// webhookCallback (index.js, 20000ms), sisanya buat fetch history dll.
const TOTAL_TIME_BUDGET_MS = 15000

// Model yang barusan kena 429/5xx dikistirahatkan sebentar (per isolate),
// biar gak dihajar terus pas lagi rate limited.
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
// `onOutcome(model, success, latencyMs)` dipanggil buat pencatatan skor.
export function hedgedRace({
  candidates,
  attempt,
  onOutcome = () => {},
  hedgeDelayMs,
  maxConcurrent = MAX_CONCURRENT_ATTEMPTS,
  maxAttempts = MAX_TOTAL_ATTEMPTS,
  attemptTimeoutMs = ATTEMPT_TIMEOUT_MS,
  budgetMs = TOTAL_TIME_BUDGET_MS,
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
  model, // opsional -- cuma hint kandidat (agent.aiModel/env), gak wajib dicoba pertama
  history = [],
  userMessage,
  apiKey, // key Jerouter
  geminiApiKey, // opsional -- kalau diisi, Gemini langsung ikut jadi kandidat
  geminiModel, // opsional -- default gemini-2.5-flash-lite
  supabaseAdmin, // opsional -- tanpa ini pencatatan+ranking dilewati
}) {
  if (!apiKey && !geminiApiKey) throw new Error('AI_API_KEY (Jerouter) atau GEMINI_API_KEY belum dikonfigurasi')

  const messages = [
    { role: 'system', content: systemInstruction },
    ...history,
    { role: 'user', content: userMessage },
  ]

  const geminiCandidate = geminiApiKey ? `${GEMINI_DIRECT_PREFIX}${geminiModel || DEFAULT_GEMINI_MODEL}` : null
  const pool = dedupe([
    ...(geminiCandidate ? [geminiCandidate] : []),
    ...(apiKey ? [...(model ? [model] : []), ...FALLBACK_MODELS] : []),
  ])

  const bonus = geminiCandidate ? { [geminiCandidate]: GEMINI_DIRECT_SCORE_BONUS } : {}
  const ranked = supabaseAdmin ? await rankModelsByStats(supabaseAdmin, pool, { bonus }) : pool
  const usable = ranked.filter((m) => !isCoolingDown(m))
  const candidates = usable.length > 0 ? usable : ranked

  const typicalLatency = getCachedLatencyMs(candidates[0]) ?? DEFAULT_TYPICAL_LATENCY_MS
  const hedgeDelayMs = clamp(typicalLatency * HEDGE_LATENCY_MULTIPLIER, HEDGE_DELAY_MIN_MS, HEDGE_DELAY_MAX_MS)

  const result = await hedgedRace({
    candidates,
    hedgeDelayMs,
    attempt: (candidateModel, signal) =>
      candidateModel.startsWith(GEMINI_DIRECT_PREFIX)
        ? callGeminiDirect(candidateModel, messages, geminiApiKey, signal)
        : callJerouter(candidateModel, messages, apiKey, signal),
    onOutcome: (candidateModel, success, latencyMs, err) => {
      if (!success && (err?.status === 429 || err?.status >= 500)) {
        cooldownUntil.set(candidateModel, Date.now() + COOLDOWN_MS)
      }
      // Fire-and-forget: pencatatan skor gak boleh nambah latency balasan.
      if (supabaseAdmin) void recordModelAttempt(supabaseAdmin, candidateModel, success, latencyMs)
    },
  })

  console.log(`[aiClient] ${result.modelUsed} menang (hedge ${Math.round(hedgeDelayMs)}ms)`)
  return result
}
