// POST /webhooks/bayargg — callback "payment.paid" dari bayar.gg.
//
// Set di dashboard bayar.gg: Developer > Webhook & Callback, isi
// Webhook Secret Key ke env BAYARGG_WEBHOOK_SECRET. callback_url otomatis
// dikirim per-invoice oleh createPayment() (lihat bayarGg.js).
//
// Kode respons ngikutin logika retry bayar.gg (mereka retry sampai 6x kalau gagal):
//   200 = sudah beres / tidak perlu diulang (termasuk invoice yang bukan milik kita)
//   401 = signature salah
//   500 = gagal sementara -> biar bayar.gg kirim ulang

import { createClient } from '@supabase/supabase-js'
import { verifyWebhookSignature } from './bayarGg.js'
import { settleInvoice } from './depositSettlement.js'

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })
}

export async function handleBayarGgWebhook(request, env) {
  if (!env.BAYARGG_WEBHOOK_SECRET) {
    console.error('[bayargg-webhook] BAYARGG_WEBHOOK_SECRET belum diisi')
    return json({ error: 'not configured' }, 500)
  }

  const raw = await request.text()
  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    return json({ error: 'invalid json' }, 400)
  }

  const valid = await verifyWebhookSignature(payload, request.headers, env.BAYARGG_WEBHOOK_SECRET)
  if (!valid) {
    console.error(`[bayargg-webhook] signature TIDAK valid untuk invoice=${payload?.invoice_id}`)
    return json({ error: 'invalid signature' }, 401)
  }

  if ((payload.event && payload.event !== 'payment.paid') || payload.status !== 'paid') {
    return json({ ok: true, skipped: true })
  }

  try {
    const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
    const result = await settleInvoice(supabaseAdmin, env, payload.invoice_id, { notify: true })

    if (result.status === 'unknown_invoice') {
      // Bisa jadi invoice dari produk lain di akun bayar.gg yang sama. Stop retry.
      console.warn(`[bayargg-webhook] invoice tidak dikenal: ${payload.invoice_id}`)
      return json({ ok: true, ignored: 'unknown_invoice' })
    }
    if (result.status === 'not_paid' || result.status === 'mismatch') {
      // Webhook bilang paid tapi API bayar.gg bilang lain / nominal beda.
      // not_paid -> 500 supaya di-retry (mungkin delay sinkronisasi).
      // mismatch -> 200 supaya berhenti; sudah di-log buat dicek manual.
      return result.status === 'not_paid'
        ? json({ error: 'belum terkonfirmasi', remote: result.remoteStatus }, 500)
        : json({ ok: true, ignored: 'amount_mismatch' })
    }
    return json({ ok: true, result: result.status })
  } catch (err) {
    console.error('[bayargg-webhook] gagal memproses:', err)
    return json({ error: 'processing failed' }, 500)
  }
}
