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
//   chatHistory.js, kolom `role` punya CHECK constraint ke nilai itu),
//   tapi chatHistory.js SUDAH mengonversinya ke bentuk OpenAI
//   ({role: 'user'|'assistant', content: string}) sebelum dikembalikan,
//   jadi di sini tinggal dipakai apa adanya.
// - Nama model WAJIB pakai prefix "f/" sesuai dokumentasi Jerouter
//   (contoh: "f/qwen3.8-flash"), bukan cuma "qwen3.8-flash" polos.

const JEROUTER_BASE_URL = 'https://je.jerouter.web.id/v1'

// Jalanin 1 giliran chat: system instruction (statis, persona) + history
// pendek + pesan user terbaru -> balasan teks dari model.
export async function runTurn({
  systemInstruction,
  model = 'f/qwen3.8-flash',
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
    throw new Error(`Jerouter API error ${res.status}: ${errText}`)
  }

  const data = await res.json()
  const text = (data.choices?.[0]?.message?.content || '').trim()

  return { text }
}
