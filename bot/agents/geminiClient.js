// Wrapper tipis buat Gemini API — versi Workers, pakai fetch() langsung ke
// REST API Gemini (BUKAN pakai SDK @google/generative-ai lagi), soalnya SDK
// itu ngandelin beberapa API Node yang gak selalu kebaca penuh di Cloudflare
// Workers. fetch() itu native di Workers, jadi ini pilihan paling aman.
//
// Desain hemat biaya tetap sama kayak versi Railway:
// - `systemInstruction` per persona itu STATIS -> taruh di system instruction,
//   bukan di-embed ulang di tiap pesan user.
// - History percakapan yang dikirim ke model cuma beberapa turn terakhir
//   (lihat chatHistory.js), bukan seluruh chat dari awal.

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

// Jalanin 1 giliran chat: system instruction (statis, persona) + history
// pendek + pesan user terbaru. Kalau model minta function call, jalankan
// `onFunctionCall`, kirim hasilnya balik ke model, lalu ambil balasan teks
// finalnya. Meniru perilaku SDK `startChat().sendMessage()` yang lama,
// tapi manual lewat endpoint `generateContent`.
export async function runTurn({
  systemInstruction,
  model = 'gemini-2.0-flash',
  history = [],
  userMessage,
  tools,
  onFunctionCall,
  apiKey,
}) {
  if (!apiKey) throw new Error('GEMINI_API_KEY belum dikonfigurasi')

  const contents = [...history, { role: 'user', parts: [{ text: userMessage }] }]

  const body = {
    contents,
    systemInstruction: { parts: [{ text: systemInstruction }] },
  }
  if (tools) body.tools = tools

  let response = await callGemini(model, apiKey, body)
  let candidate = response.candidates?.[0]
  let functionCalls = extractFunctionCalls(candidate)

  if (functionCalls.length > 0 && onFunctionCall) {
    // Tambahin balasan model (yang isinya function call) ke contents,
    // lalu tambahin function response-nya, sama kayak alur SDK yang lama.
    contents.push(candidate.content)

    const functionResponseParts = []
    for (const call of functionCalls) {
      let toolResult
      try {
        toolResult = await onFunctionCall(call.name, call.args)
      } catch (err) {
        toolResult = { error: err.message }
      }
      functionResponseParts.push({
        functionResponse: { name: call.name, response: toolResult },
      })
    }
    contents.push({ role: 'function', parts: functionResponseParts })

    response = await callGemini(model, apiKey, { contents, systemInstruction: body.systemInstruction, tools })
    candidate = response.candidates?.[0]
  }

  return {
    text: extractText(candidate),
    functionCalls,
  }
}

async function callGemini(model, apiKey, body) {
  const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Gemini API error ${res.status}: ${errText}`)
  }
  return res.json()
}

function extractText(candidate) {
  if (!candidate?.content?.parts) return ''
  return candidate.content.parts
    .map((p) => p.text || '')
    .join('')
    .trim()
}

function extractFunctionCalls(candidate) {
  if (!candidate?.content?.parts) return []
  return candidate.content.parts
    .filter((p) => p.functionCall)
    .map((p) => ({ name: p.functionCall.name, args: p.functionCall.args || {} }))
}
