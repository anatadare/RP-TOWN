// Wrapper tipis buat Jerouter — router AI yang OpenAI-compatible
// (https://je.jerouter.web.id). Gantiin geminiClient.js (native Gemini REST)
// karena kita pindah dari Gemini ke model lain (qwen3.8-flash) lewat Jerouter.
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

const JEROUTER_BASE_URL = 'https://je.jerouter.web.id/v1'

// Kandidat fallback kalau model utama (agent.aiModel) gagal/timeout.
// Diambil dari daftar model Jerouter yang kamu kasih (status 🟢/🟡 pas itu):
// yang 🔴 offline dibuang (percuma dicoba), yang 🟡 lambat/gak stabil
// ditaruh di akhir. `north-mini-code` sengaja DIBUANG dari daftar ini --
// itu model buat coding, kemungkinan kurang cocok buat roleplay/persona
// bahasa Indonesia dibanding model chat general-purpose lainnya.
const FALLBACK_MODELS = [
  // 🟢 normal
  'step-3.7-flash',
  'mimo-v2.5',
  'nemotron-3-ultra',
  'qwen3.8-flash',
  'glm-5.3-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'nemotron-3.5-lightning',
  'ling-3.0-flash',
  'muse-spark-1.2-contributor',
  'muse-spark-1.3-contributor',
  'hy3',
  'laguna-xs-2.1',
  'nemotron-3-super',
  'nemotron-3.5',
  'laguna-s-2.1',
  'lfm-2.5-2.6b',
  'gemini-3.8-flash',
  'nex-n2.5-mini',
  'glm-5.2',
  'glm-5.3',
  'grok-4.5',
  'grok-4.6',
  // 🟡 lambat / gak stabil -- prioritas paling akhir
  'gemini-3.1-pro',
  'nemotron-3-nano-omni',
  'nex-n2.5-pro',
  'big-pickle',
]

// Percobaan pertama: cuma model utama sendirian (jalur normal, paling
// murah -- ini yang kepake 99% kasus kalau Jerouter lagi sehat).
const PRIMARY_ATTEMPT_TIMEOUT_MS = 4000

// Cloudflare Workers cuma ngizinin maksimal 6 koneksi keluar BERBARENGAN per
// request -- jadi 1 batch race maksimal 5 model (nyisain 1 slot headroom).
const RACE_BATCH_SIZE = 5
const RACE_ATTEMPT_TIMEOUT_MS = 5000

// Total waktu buat SEMUA percobaan (utama + semua batch race) -- nyesuain
// ke timeoutMilliseconds di webhookCallback (index.js, di-set 20000ms).
const TOTAL_TIME_BUDGET_MS = 15000
// Kalau sisa waktu di bawah ini, jangan mulai batch race baru lagi -- lebih
// baik nyerah cepat & kasih tau user buat coba lagi, daripada kebentur
// limit webhook dan bot diem tanpa balasan sama sekali.
const MIN_REMAINING_TO_RACE_MS = 2000

async function attemptModel(candidateModel, messages, apiKey, timeoutMs) {
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

    return { text, modelUsed: candidateModel }
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error(`Jerouter timeout setelah ${timeoutMs}ms (model ${candidateModel})`)
    }
    throw err
  }
}

// Jalanin 1 giliran chat: system instruction (statis, persona) + history
// pendek + pesan user terbaru -> balasan teks dari model.
//
// Alurnya:
// 1. Coba model utama sendirian dulu (jalur normal).
// 2. Kalau itu gagal/timeout -> BARU di titik ini "cek" model lain, dengan
//    cara nembak beberapa model fallback SEKALIGUS (race) dan pakai siapa
//    pun yang balas sukses paling cepat. Kalau 1 batch race gagal semua
//    dan waktu masih cukup, lanjut ke batch berikutnya.
export async function runTurn({
  systemInstruction,
  model = 'qwen3.8-flash',
  history = [],
  userMessage,
  apiKey,
}) {
  if (!apiKey) throw new Error('AI_API_KEY belum dikonfigurasi')

  const messages = [
    { role: 'system', content: systemInstruction },
    ...history,
    { role: 'user', content: userMessage },
  ]

  const startedAt = Date.now()
  const remaining = () => TOTAL_TIME_BUDGET_MS - (Date.now() - startedAt)

  // 1. Jalur normal: model utama sendirian.
  try {
    return await attemptModel(model, messages, apiKey, PRIMARY_ATTEMPT_TIMEOUT_MS)
  } catch (primaryErr) {
    console.warn(`[aiClient] model utama (${model}) gagal/timeout: ${primaryErr.message}`)
  }

  // 2. Model utama timeout -> race beberapa model fallback sekaligus,
  // per-batch, sampai ada yang berhasil atau waktu/kandidat abis.
  const candidates = FALLBACK_MODELS.filter((m) => m !== model)
  let cursor = 0
  let lastError = new Error('gak ada model fallback yang berhasil dicoba')

  while (cursor < candidates.length && remaining() >= MIN_REMAINING_TO_RACE_MS) {
    const batch = candidates.slice(cursor, cursor + RACE_BATCH_SIZE)
    cursor += batch.length
    const attemptTimeout = Math.max(1000, Math.min(RACE_ATTEMPT_TIMEOUT_MS, remaining() - 500))

    try {
      // Promise.any -> yang menang adalah yang PALING CEPAT balas sukses;
      // sisanya di batch ini otomatis diabaikan (gak nunggu mereka).
      return await Promise.any(
        batch.map((candidateModel) => attemptModel(candidateModel, messages, apiKey, attemptTimeout))
      )
    } catch (aggregateErr) {
      const errs = aggregateErr.errors || [aggregateErr]
      lastError = errs[errs.length - 1]
      console.warn(`[aiClient] batch fallback (${batch.join(', ')}) semua gagal`)
      // lanjut ke batch berikutnya kalau masih ada waktu & kandidat
    }
  }

  throw new Error(`Semua model (utama + fallback) gagal/timeout. Error terakhir: ${lastError.message}`)
}
