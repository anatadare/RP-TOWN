// Lapisan "milih model organik" -- skor tiap model dihitung dari histori
// pemakaian BENERAN (dicatat tiap ada request nyata yang nyoba 1 model),
// bukan dari health-check sintetis -- sesuai batasan ToS Jerouter yang udah
// dijelasin di aiClient.js.

const DEFAULT_SUCCESS_EWMA = 0.7 // prior netral-optimis buat model yang belum pernah/jarang dicoba
const DEFAULT_LATENCY_EWMA_MS = 3000
// Makin KECIL angka ini, latency makin berpengaruh ke skor. Dulu 20000
// (model 6 detik cuma kena -0.3) -- terlalu ramah buat model lambat, padahal
// buat chat 6 detik itu udah kerasa ngeleg. Sekarang 10000.
const LATENCY_SCORE_DIVISOR = 10000
const EXPLORATION_JITTER = 0.03 // noise kecil biar urutan gak kaku milih model yang sama forever

// Cache statistik per isolate Worker -- tabelnya kecil (1 baris per model),
// jadi cukup 1 query buat SEMUA model tiap CACHE_TTL_MS, bukan 1 query tiap
// pesan (lebih cepat: gak nambah ~100-300ms sebelum tiap balasan).
const CACHE_TTL_MS = 20000
let cache = { at: 0, byModel: new Map() }

function scoreOf(row, bonus = 0) {
  const successEwma = row?.success_ewma ?? DEFAULT_SUCCESS_EWMA
  const latencyEwma = row?.latency_ewma_ms ?? DEFAULT_LATENCY_EWMA_MS
  const jitter = (Math.random() * 2 - 1) * EXPLORATION_JITTER
  return successEwma - latencyEwma / LATENCY_SCORE_DIVISOR + jitter + bonus
}

async function loadStats(supabaseAdmin) {
  if (Date.now() - cache.at < CACHE_TTL_MS) return cache.byModel
  try {
    const { data, error } = await supabaseAdmin
      .from('ai_model_stats')
      .select('model, success_ewma, latency_ewma_ms')
    if (error) throw error
    cache = { at: Date.now(), byModel: new Map((data || []).map((r) => [r.model, r])) }
  } catch (err) {
    console.warn('[modelStats] gagal ambil ranking, pakai cache/urutan default:', err?.message || err)
    // Jangan coba lagi tiap pesan kalau DB lagi bermasalah -- tunda sebentar.
    cache = { at: Date.now() - CACHE_TTL_MS + 5000, byModel: cache.byModel }
  }
  return cache.byModel
}

// Latency tipikal (EWMA) 1 model dari cache -- dipakai buat nentuin hedge delay.
export function getCachedLatencyMs(model) {
  return cache.byModel.get(model)?.latency_ewma_ms ?? null
}

// Urutin `candidates` dari yang PALING BAGUS menurut histori beneran.
// `bonus` = { namaModel: tambahanSkor } (dipakai buat jalur resmi Gemini).
// Kalau query gagal, balikin urutan aslinya -- jangan sampai fitur ranking
// ini malah bikin request gagal total.
export async function rankModelsByStats(supabaseAdmin, candidates, { bonus = {} } = {}) {
  const byModel = await loadStats(supabaseAdmin)
  const scored = candidates.map((model) => ({ model, score: scoreOf(byModel.get(model), bonus[model] || 0) }))
  scored.sort((a, b) => b.score - a.score)
  return scored.map((s) => s.model)
}

// Dipanggil SETELAH 1 attempt selesai (sukses ATAU gagal) -- dibatasi 1
// detik & gak pernah throw, supaya pencatatan gak nge-lambatin/nge-gagalin
// balasan ke user.
export async function recordModelAttempt(supabaseAdmin, model, success, latencyMs) {
  try {
    await Promise.race([
      supabaseAdmin.rpc('record_model_attempt', {
        p_model: model,
        p_success: success,
        p_latency_ms: Math.round(latencyMs),
      }),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ])
  } catch (err) {
    console.warn(`[modelStats] gagal catat attempt model ${model}:`, err?.message || err)
  }
}
