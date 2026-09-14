// Lapisan "milih model organik" -- gantiin urutan FALLBACK_MODELS yang
// di-hardcode manual + ketergantungan ke env AI_MODEL per agent
// (lihat aiClient.js). Skornya dihitung dari histori pemakaian BENERAN
// (dicatat tiap kali ada request nyata yang nyoba 1 model), bukan dari
// health-check sintetis -- sesuai batasan ToS Jerouter yang udah
// dijelasin di aiClient.js.

const DEFAULT_SUCCESS_EWMA = 0.7 // prior netral-optimis buat model yang belum pernah/jarang dicoba
const DEFAULT_LATENCY_EWMA_MS = 3000
const LATENCY_SCORE_DIVISOR = 20000 // makin besar -> latency makin kurang berpengaruh ke skor
const EXPLORATION_JITTER = 0.03 // noise kecil biar urutan gak kaku milih model yang sama forever

function scoreOf(row) {
  const successEwma = row?.success_ewma ?? DEFAULT_SUCCESS_EWMA
  const latencyEwma = row?.latency_ewma_ms ?? DEFAULT_LATENCY_EWMA_MS
  const jitter = (Math.random() * 2 - 1) * EXPLORATION_JITTER
  return successEwma - latencyEwma / LATENCY_SCORE_DIVISOR + jitter
}

// Urutin `candidates` (daftar nama model) dari yang PALING RELIABLE
// menurut histori beneran. Kalau query gagal (DB hiccup dll), balikin
// urutan aslinya apa adanya -- jangan sampai fitur ranking ini malah
// bikin request gagal total.
export async function rankModelsByStats(supabaseAdmin, candidates) {
  let rows = []
  try {
    const { data, error } = await supabaseAdmin
      .from('ai_model_stats')
      .select('model, success_ewma, latency_ewma_ms')
      .in('model', candidates)
    if (error) throw error
    rows = data || []
  } catch (err) {
    console.warn('[modelStats] gagal ambil ranking, pakai urutan default:', err?.message || err)
    return candidates
  }

  const byModel = new Map(rows.map((r) => [r.model, r]))
  const scored = candidates.map((model) => ({ model, score: scoreOf(byModel.get(model)) }))
  scored.sort((a, b) => b.score - a.score)
  return scored.map((s) => s.model)
}

// Dipanggil SETELAH 1 attemptModel resolve/reject (sukses ATAU gagal) --
// fire-and-forget yang dibatasi 1 detik, JANGAN sampai ini nge-lambatin
// atau nge-gagalin balasan ke user cuma gara-gara nyatet statistik.
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
