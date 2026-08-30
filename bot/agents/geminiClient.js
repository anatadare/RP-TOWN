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
  console.warn('[agents] GEMINI_API_KEY belum diisi — agent NPC tidak akan bisa membalas.')
}

const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null

// Jalanin 1 giliran chat: system instruction (statis, persona) + history
// pendek + pesan user terbaru. Kalau model minta function call, jalankan
// `onFunctionCall`, kirim hasilnya balik ke model, lalu ambil balasan teks
// finalnya.
async function runTurn({ systemInstruction, history = [], userMessage, tools, onFunctionCall }) {
  if (!genAI) throw new Error('GEMINI_API_KEY belum dikonfigurasi')

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
