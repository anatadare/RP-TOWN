// Penyapu pesan QR setor (dijalankan Cron Trigger tiap menit -- lihat
// `scheduled` di index.js dan [triggers] di wrangler.toml).
//
// Worker itu stateless & gak bisa "nunggu 3 menit", jadi message_id QR
// disimpan di tabel deposits (qr_message_id, qr_sent_at) lalu disapu di sini:
//   - pending & sudah > 3 menit  -> cek terakhir ke bayar.gg (siapa tau sudah
//                                   bayar tapi webhook telat), kalau belum -> hapus QR
//   - sudah lunas / expired / dibatalkan tapi QR-nya masih nyangkut -> hapus
// Karena cron minimal per menit, QR hilang di kisaran menit ke-3 sampai ke-4.

import { createClient } from '@supabase/supabase-js'
import { settleInvoice, deleteQrMessage } from './depositSettlement.js'

export const QR_TTL_MS = 3 * 60 * 1000
const LOOKBACK_MS = 60 * 60 * 1000 // cuma sapu QR yang dikirim 1 jam terakhir

export async function sweepQrMessages(env, supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)) {
  const now = Date.now()

  const { data, error } = await supabaseAdmin
    .from('deposits')
    .select('*')
    .is('qr_deleted_at', null)
    .not('qr_message_id', 'is', null)
    .gte('qr_sent_at', new Date(now - LOOKBACK_MS).toISOString())
    .limit(100)
  if (error) throw error

  for (const deposit of data || []) {
    try {
      if (deposit.status === 'pending') {
        const age = now - new Date(deposit.qr_sent_at).getTime()
        if (age < QR_TTL_MS) continue

        // Cek terakhir: kalau ternyata sudah dibayar, settleInvoice yang
        // mengkreditkan saldo + menghapus QR-nya sendiri.
        try {
          const r = await settleInvoice(supabaseAdmin, env, deposit.invoice_id, { notify: true })
          if (r.status === 'credited') continue
        } catch (err) {
          console.error(`[qr-sweep] gagal cek bayar.gg invoice=${deposit.invoice_id}, lanjut hapus QR:`, err.message)
        }
      }

      await deleteQrMessage(supabaseAdmin, env, deposit)
    } catch (err) {
      console.error(`[qr-sweep] gagal proses deposit ${deposit.id}:`, err)
    }
  }
}
