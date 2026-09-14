// Antrian ruang KUA -- dipakai pas SEMUA ruang Penghulu lagi kepake
// (jumlah wedding_sessions aktif di grup == jumlah agent Penghulu yang
// aktif) dan ada warga baru yang mau mulai urusan. Alurnya:
//
// 1. Warga chat ke ruangan yang lagi dipake orang lain, dengan niat jelas
//    (nyebut mempelai/relasi keluarga) -> handlePenghuluMessage cek
//    kapasitas via hasCapacity().
// 2a. Kalau MASIH ada ruang Penghulu lain yang kosong -> warga diarahkan
//     LANGSUNG ke sana (gak perlu antre, lihat agentLogic.js).
// 2b. Kalau BENERAN semua penuh -> enqueueCitizen() nyimpen niatnya, warga
//     disuruh nunggu.
// 3. Begitu ADA sesi yang 'selesai' & warganya udah di-kick (lihat
//    groupMembership.js), popNextWaiting() ambil antrian PALING DEPAN buat
//    grup itu -- ruangan yang BARU AJA kosong itulah yang ditawarkan,
//    Asisten kirim link + mention ke warganya (lihat finishSessionAndFreeSlot
//    di agentLogic.js).

const UNIQUE_VIOLATION = '23505'

// Kapasitas ruang KUA = jumlah agent Penghulu yang KEBACA aktif (punya
// token/grup/API key lengkap di env -- lihat config.js loadAgents). Sengaja
// dihitung dari sini, bukan angka hardcode, biar otomatis nyesuain kalau
// jumlah Penghulu ditambah/dikurangi lewat env di masa depan.
export function getKuaCapacity(penghuluAgents) {
  return penghuluAgents.length
}

// Jumlah sesi (nikah ATAU keluarga) yang lagi AKTIF di grup ini, lintas
// semua thread -- baris di wedding_sessions dihapus begitu sesi beneran
// 'selesai' (releaseWeddingSession), jadi COUNT baris = jumlah ruang yang
// lagi kepake sekarang.
export async function countActiveSessions(supabaseAdmin, chatId) {
  const { count, error } = await supabaseAdmin
    .from('wedding_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('chat_id', chatId)

  if (error) throw error
  return count || 0
}

export async function hasCapacity(supabaseAdmin, chatId, penghuluAgents) {
  const active = await countActiveSessions(supabaseAdmin, chatId)
  return active < getKuaCapacity(penghuluAgents)
}

// Simpen niat warga ke antrian. Return `false` kalau dia UDAH punya
// antrian aktif (unique index kua_queue_one_waiting_per_user_idx) --
// jangan numpuk baris baru, cukup diemin (warganya udah dikasih tau
// "lagi nunggu" pas pertama kali masuk antrian).
export async function enqueueCitizen(
  supabaseAdmin,
  { chatId, telegramUserId, mention, requestType, requestText }
) {
  const { data, error } = await supabaseAdmin
    .from('kua_queue')
    .insert({
      chat_id: String(chatId),
      telegram_user_id: telegramUserId,
      mention,
      request_type: requestType,
      request_text: requestText,
    })
    .select()
    .single()

  if (error) {
    if (error.code === UNIQUE_VIOLATION) return null
    throw error
  }
  return data
}

// Ambil 1 antrian PALING DEPAN (FIFO) buat grup ini yang masih 'waiting',
// lalu langsung tandain 'notified' (atomik-ish lewat update+select --
// cukup buat skala bot RP, gak butuh row lock beneran di sini karena cuma
// dipanggil dari 1 titik: abis release+kick sesi).
export async function popNextWaiting(supabaseAdmin, chatId) {
  const { data: rows, error } = await supabaseAdmin
    .from('kua_queue')
    .select('*')
    .eq('chat_id', String(chatId))
    .eq('status', 'waiting')
    .order('created_at', { ascending: true })
    .limit(1)

  if (error) throw error
  if (!rows || rows.length === 0) return null

  const next = rows[0]
  const { error: updateError } = await supabaseAdmin
    .from('kua_queue')
    .update({ status: 'notified', notified_at: new Date().toISOString() })
    .eq('id', next.id)
    .eq('status', 'waiting') // guard: kalau udah keambil proses lain duluan, skip

  if (updateError) throw updateError
  return next
}
