// Panggilan tipis ke Telegram Bot API pakai fetch langsung -- dipakai buat
// kasus-kasus di luar grammY `ctx` biasa (misal kick pakai token bot
// utama walau yang lagi nangani pesan itu bot Penghulu, atau kirim notif
// antrian pakai token bot Asisten dari dalam handler Penghulu). grammY
// sendiri cuma dipakai buat WEBHOOK masuk (lihat index.js) -- buat
// panggilan API keluar yang lintas-bot kayak gini, fetch langsung lebih
// simpel daripada spawn instance `Bot` baru tiap kali.

const TELEGRAM_API_BASE = 'https://api.telegram.org'

export async function callTelegramApi(botToken, method, body) {
  const res = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!data.ok) {
    throw new Error(`Telegram ${method} gagal: ${data.description || res.status}`)
  }
  return data.result
}
