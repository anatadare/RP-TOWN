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

// Jerouter (layanan personal/kecil) kadang gak sanggup nanganin banyak
// request bersamaan dari 1 key -> alih-alih balikin error cepat, dia
// nge-hang. Kalau dibiarin, Cloudflare yang motong eksekusinya di ~10 detik
// (platform-level timeout) SEBELUM kode kita sempat kirim fallback reply ke
// user -- makanya bot keliatan diem total.
//
// Fix: kasih fetch ini timeout sendiri yang LEBIH PENDEK dari limit
// platform, pake AbortSignal.timeout(). Jadi kalau Jerouter lelet, kode
// kita yang nyerah duluan (throw error biasa yang bisa ke-catch), bukan
// Cloudflare yang motong paksa.
//
// Catatan: retry otomatis yang dulu ada (2x attempt) sengaja dibuang --
// kalau attempt pertama aja udah ngabisin ~7 detik, attempt kedua gampang
// kebentur limit 10 detik juga. Lebih aman gagal cepat & kasih tau user
// buat coba lagi, daripada diem tanpa balasan.
const REQUEST_TIMEOUT_MS = 7000

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

  let res
  try {
    res = await fetch(`${JEROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error(`Jerouter timeout setelah ${REQUEST_TIMEOUT_MS}ms (model lelet/overload)`)
    }
    throw err
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Jerouter API error ${res.status}: ${errText}`)
  }

  const data = await res.json()
  const text = (data.choices?.[0]?.message?.content || '').trim()
  return { text }
}
