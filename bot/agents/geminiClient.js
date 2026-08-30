// Wrapper tipis buat Gemini API (pakai @google/generative-ai).
//
// Desain hemat biaya (sesuai rencana):
// - `systemInstruction` per persona itu STATIS -> taruh di system instruction,
//   bukan di-embed ulang di tiap pesan user. Ini yang bikin Gemini bisa
//   nge-cache/reuse bagian ini di request-request berikutnya.
// - Data dinamis (nama mempelai, tahap acara, dst) dikirim pendek di pesan
//   user tiap turn, JANGAN kirim ulang seluruh history mentah-mentah.
// - History percakapan yang dikirim ke model cuma beberapa turn terakhir
//   (lihat runner.js: `trimHistory`), bukan seluruh chat dari awal.

const { GoogleGenerativeAI } = require('@google/generative-ai')
const { GEMINI_API_KEY, GEMINI_MODEL } = require('./config')

if (!GEMINI_API_KEY) {
  console.warn('[agents] GEMINI_API_KEY (default/shared) belum diisi. Agent yang gak punya API key sendiri tidak akan bisa membalas.')
}

// Cache 1 instance GoogleGenerativeAI per API key, biar kalau ada 8 bot
// dengan 8 API key beda-beda, tiap key cuma di-init sekali (bukan bikin
// instance baru tiap kirim pesan).
const clientCache = new Map() // apiKey -> GoogleGenerativeAI instance

function getClient(apiKey) {
  if (!clientCache.has(apiKey)) {
    clientCache.set(apiKey, new GoogleGenerativeAI(apiKey))
  }
  return clientCache.get(apiKey)
}

// Jalanin 1 giliran chat: system instruction (statis, persona) + history
// pendek + pesan user terbaru. Kalau model minta function call, jalankan
// `onFunctionCall`, kirim hasilnya balik ke model, lalu ambil balasan teks
// finalnya.
// `apiKey` opsional — kalau gak dikasih, fallback ke GEMINI_API_KEY (share).
async function runTurn({ systemInstruction, history = [], userMessage, tools, onFunctionCall, apiKey }) {
  const key = apiKey || GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY belum dikonfigurasi')

  const genAI = getClient(key)
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction,
    tools,
  })

  const chat = model.startChat({ history })
  let result = await chat.sendMessage(userMessage)
  let response = result.response

  const functionCalls = response.functionCalls?.() || []

  if (functionCalls.length > 0 && onFunctionCall) {
    // Bisa aja model minta lebih dari 1 tool call, proses satu-satu berurutan
    const functionResponses = []
    for (const call of functionCalls) {
      let toolResult
      try {
        toolResult = await onFunctionCall(call.name, call.args)
      } catch (err) {
        toolResult = { error: err.message }
      }
      functionResponses.push({
        functionResponse: { name: call.name, response: toolResult },
      })
    }

    result = await chat.sendMessage(functionResponses)
    response = result.response
  }

  return {
    text: response.text(),
    functionCalls,
  }
}

module.exports = { runTurn }
