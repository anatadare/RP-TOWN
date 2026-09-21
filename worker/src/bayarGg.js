// Client tipis buat bayar.gg (https://www.bayar.gg/api-docs).
// Auth: header `X-API-Key`. Base URL: https://www.bayar.gg/api
//
// Prinsip: fungsi-fungsi di sini dipanggil oleh KODE backend, bukan oleh AI
// langsung. Gemini cuma "meminta" lewat tool (lihat teller.js), backend yang
// memvalidasi & baru memanggil bayar.gg.

const BASE_URL = 'https://www.bayar.gg/api'

function apiKeyOrThrow(env) {
  if (!env.BAYARGG_API_KEY) throw new Error('BAYARGG_API_KEY belum dikonfigurasi')
  return env.BAYARGG_API_KEY
}

// Bikin invoice QRIS. Balikin bentuk yang sudah dinormalisasi:
// { invoiceId, amount, finalAmount, paymentUrl, qrisString, status, method }
export async function createPayment(env, { amount, description, customerName }) {
  const apiKey = apiKeyOrThrow(env)
  if (!env.PUBLIC_WORKER_URL) throw new Error('PUBLIC_WORKER_URL belum dikonfigurasi')

  const res = await fetch(`${BASE_URL}/create-payment.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
    body: JSON.stringify({
      amount,
      description,
      customer_name: customerName || undefined,
      payment_method: env.BAYARGG_PAYMENT_METHOD || 'qris',
      payment_url: env.BAYARGG_PAYMENT_URL || 'https://www.bayar.gg/pay',
      callback_url: `${env.PUBLIC_WORKER_URL.replace(/\/$/, '')}/webhooks/bayargg`,
    }),
  })

  const json = await res.json().catch(() => null)
  if (!res.ok || !json?.success) {
    throw new Error(`bayar.gg create-payment gagal (${res.status}): ${json?.error || json?.message || 'tanpa pesan'}`)
  }

  // Docs punya 2 bentuk response: { data: {...} } (baru) dan
  // { payment: {...}, payment_url } (contoh lama). Dukung dua-duanya.
  const d = json.data ?? json.payment ?? {}
  const invoiceId = d.invoice_id
  if (!invoiceId) throw new Error('bayar.gg tidak mengembalikan invoice_id')

  return {
    invoiceId,
    amount: Number(d.amount ?? amount),
    finalAmount: Number(d.final_amount ?? d.amount ?? amount),
    paymentUrl: d.payment_url ?? json.payment_url ?? null,
    qrisString: d.qris_string || null,
    status: d.status || 'pending',
    method: d.payment_method || env.BAYARGG_PAYMENT_METHOD || 'qris',
  }
}

// Cek status invoice langsung ke bayar.gg (sumber kebenaran saat verifikasi).
export async function checkPayment(env, invoiceId) {
  const apiKey = apiKeyOrThrow(env)
  const res = await fetch(`${BASE_URL}/check-payment.php?invoice=${encodeURIComponent(invoiceId)}`, {
    headers: { 'X-API-Key': apiKey },
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json?.success) {
    throw new Error(`bayar.gg check-payment gagal (${res.status}): ${json?.error || json?.message || 'tanpa pesan'}`)
  }
  // Bentuk response: { success, invoice_id, status, final_amount, paid_reff_num, ... }
  const d = json.data ?? json
  return {
    invoiceId: d.invoice_id || invoiceId,
    status: d.status,
    finalAmount: Number(d.final_amount ?? d.amount),
    paidReffNum: d.paid_reff_num || null,
  }
}

function hexToBytes(hex) {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) return null
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16)
  return bytes
}

// Verifikasi signature webhook sesuai docs bayar.gg:
//   HMAC-SHA256( "invoice_id|status|final_amount|timestamp", WEBHOOK_SECRET )
// Signature ada di header X-Webhook-Signature, timestamp di X-Webhook-Timestamp.
// Pakai crypto.subtle.verify supaya perbandingannya constant-time.
export async function verifyWebhookSignature(payload, headers, secret) {
  if (!secret) return false
  const signature = headers.get('x-webhook-signature') || payload?.signature || ''
  const sigBytes = hexToBytes(String(signature).trim())
  if (!sigBytes) return false

  const timestamps = [headers.get('x-webhook-timestamp'), payload?.timestamp]
    .filter((t) => t !== null && t !== undefined && t !== '')
    .map(String)

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )

  for (const ts of timestamps) {
    const data = `${payload.invoice_id}|${payload.status}|${payload.final_amount}|${ts}`
    const ok = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(data))
    if (ok) return true
  }
  return false
}
