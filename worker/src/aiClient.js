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
//   di response GET /v1/models (contoh: "qwen3.8-flash", "glm-5.3"). Sempat
//   dikira butuh prefix "f/" tapi ternyata gak perlu, itu tebakan yang salah.

const JEROUTER_BASE_URL = 'https://je.jerouter.web.id/v1'

// Semua 8 bot (5 Penghulu + 3 Pegawai) berbagi 1 AI_API_KEY yang sama kalau
// per-agent key gak diisi. Jerouter (layanan personal/kecil) kadang gak
// sanggup nanganin banyak request bersamaan dari 1 key -> muncul sebagai
// timeout/500 walau nama model & key-nya benar. Daripada bikin bot diem
// total pas ini kejadian, kita retry otomatis sekali dengan jeda pendek.
const MAX_ATTEMPTS = 2
const RETRY_DELAY_MS = 400

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Jalanin 1 giliran chat: system instruction (statis, persona) + history
// pendek + pesan user terbaru -> balasan teks dari model.
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

  let lastError
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(`${JEROUTER_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, messages }),
      })

      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        // 4xx (model salah, key salah, dst) gak akan membaik kalau di-retry
        // -- langsung lempar tanpa buang-buang attempt kedua.
        if (res.status < 500) {
          throw new Error(`Jerouter API error ${res.status}: ${errText}`)
        }
        throw new Error(`Jerouter API error ${res.status} (retryable): ${errText}`)
      }

      const data = await res.json()
      const text = (data.choices?.[0]?.message?.content || '').trim()
      return { text }
    } catch (err) {
      lastError = err
      const isLastAttempt = attempt === MAX_ATTEMPTS
      if (isLastAttempt) break
      await sleep(RETRY_DELAY_MS)
    }
  }

  throw lastError
}
