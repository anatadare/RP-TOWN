// Satu-satunya jalur yang boleh menambah saldo dari setoran.
// Dipakai oleh: (1) webhook bayar.gg, (2) tool "cek status setor" di teller.
//
// Urutan pengaman sebelum saldo bertambah:
//   1. invoice HARUS ada di tabel deposits kita (bukan invoice orang lain)
//   2. konfirmasi ulang ke bayar.gg (check-payment): status == paid
//      DAN final_amount sama persis dengan yang kita simpan
//   3. rpc credit_deposit -> atomik + idempotent (aman dipanggil berkali-kali)

import { checkPayment } from './bayarGg.js'
import { callTelegramApi } from './telegramApi.js'
import { loadAgents } from './config.js'

export function formatRupiah(n) {
  return `Rp ${Number(n).toLocaleString('id-ID')}`
}

// Balikin: { status: 'unknown_invoice' | 'already_paid' | 'not_paid' | 'mismatch' | 'credited', ... }
export async function settleInvoice(supabaseAdmin, env, invoiceId, { notify = true } = {}) {
  const { data: deposit, error } = await supabaseAdmin
    .from('deposits')
    .select('*')
    .eq('invoice_id', invoiceId)
    .maybeSingle()
  if (error) throw error

  if (!deposit) return { status: 'unknown_invoice' }
  if (deposit.status === 'paid') return { status: 'already_paid', deposit }

  // Sumber kebenaran = API bayar.gg, bukan isi webhook.
  const remote = await checkPayment(env, invoiceId)

  if (remote.status !== 'paid') {
    if ((remote.status === 'expired' || remote.status === 'cancelled') && deposit.status === 'pending') {
      await supabaseAdmin.from('deposits').update({ status: remote.status }).eq('id', deposit.id)
    }
    return { status: 'not_paid', remoteStatus: remote.status, deposit }
  }

  if (remote.finalAmount !== deposit.final_amount_idr) {
    console.error(
      `[deposit] NOMINAL TIDAK COCOK invoice=${invoiceId} lokal=${deposit.final_amount_idr} bayar.gg=${remote.finalAmount} -- tidak dikreditkan, cek manual`,
    )
    return { status: 'mismatch', deposit }
  }

  const { data: result, error: rpcError } = await supabaseAdmin.rpc('credit_deposit', {
    p_invoice_id: invoiceId,
    p_paid_reff: remote.paidReffNum,
  })
  if (rpcError) throw rpcError

  if (result.credited && notify) {
    try {
      await notifyDepositPaid(supabaseAdmin, env, result)
    } catch (err) {
      // Saldo sudah masuk -- gagal kirim notif TIDAK boleh bikin webhook dianggap gagal.
      console.error('[deposit] gagal kirim notifikasi, saldo tetap sudah masuk:', err)
    }
  }

  return {
    status: result.credited ? 'credited' : 'already_paid',
    amountIdr: result.amount_idr,
    balanceIdr: result.balance_idr,
    deposit,
  }
}

async function notifyDepositPaid(supabaseAdmin, env, result) {
  const { tellerAgents } = loadAgents(env)
  const agent = tellerAgents.find((a) => a.key === result.agent_key)
  if (!agent) throw new Error(`agent teller ${result.agent_key} tidak ditemukan di env`)

  const { data: citizen } = await supabaseAdmin
    .from('citizens')
    .select('display_name, username')
    .eq('id', result.citizen_id)
    .maybeSingle()

  const who = citizen?.display_name || (citizen?.username ? `@${citizen.username}` : 'Warga')

  await callTelegramApi(agent.token, 'sendMessage', {
    chat_id: result.chat_id,
    ...(result.thread_id ? { message_thread_id: result.thread_id } : {}),
    text:
      `✅ Setoran ${who} berhasil!\n` +
      `Masuk: ${formatRupiah(result.amount_idr)}\n` +
      `Saldo sekarang: ${formatRupiah(result.balance_idr)}`,
  })
}
