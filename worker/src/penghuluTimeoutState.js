// Recovery konteks buat Penghulu abis AI-nya timeout -- versi paralel dari
// awayState.js (yang itu punya Pegawai). BEDA PENTING dari awayState.js:
//
// - awayState.js ngirim TEMPLATE "pergi sebentar" begitu timeout kejadian
//   (warga ditinggal nunggu sambil dikasih tau).
// - Modul ini SEBALIKNYA: gak ngirim apa-apa yang aneh-aneh pas timeout
//   (tetap fallback generik biasa dari index.js catch block), tapi NYIMPEN
//   jejak "sesi/thread ini sempat kelewat 1 giliran" -- biar pas Penghulu
//   BERHASIL jawab lagi, dia bisa nyapa balik dengan sadar ("maaf tadi
//   sempat missed"), BUKAN pura-pura gak ada apa-apa.
//
// KENAPA INI GAK BOLEH DIPAKAI BUAT MUTUSIN KICK (poin yang paling penting
// dari desain ini): kick di project ini SELALU dipicu murni dari stage
// transition deterministik (lihat finishSessionAndFreeSlot +
// closeCeremony di agentLogic.js) -- gak pernah baca tabel ini sama
// sekali. Jadi walau Penghulu timeout berkali-kali di tengah sesi yang
// BELUM 'selesai', gak ada jalur apa pun dari sini yang bisa nyampe ke
// kick. Timeout cuma soal "nyambungin obrolan lagi", bukan soal
// "urusannya udah kelar apa belum".

const UNIQUE_VIOLATION = '23505'

// Return `null` kalau scope ini UDAH ada marker timeout (berarti ini
// timeout ke-2/ke-3 dst berturut-turut -- gak perlu insert baris baru,
// snapshot stage pertama tetap yang paling relevan buat di-acknowledge).
export async function markPenghuluTimeout(supabaseAdmin, { scopeKey, agentName, stageSnapshot }) {
  const { data, error } = await supabaseAdmin
    .from('penghulu_timeout_state')
    .insert({ scope_key: scopeKey, agent_name: agentName, stage_snapshot: stageSnapshot || null })
    .select()
    .single()

  if (error) {
    if (error.code === UNIQUE_VIOLATION) return null
    throw error
  }
  return data
}

// Dipanggil di AWAL handlePenghuluMessage, SEBELUM proses pesan yang lagi
// masuk -- ambil sekaligus hapus marker (kalau ada), biar cuma di-
// acknowledge SEKALI (bukan tiap pesan abis itu).
export async function consumePenghuluTimeout(supabaseAdmin, scopeKey) {
  const { data, error } = await supabaseAdmin
    .from('penghulu_timeout_state')
    .delete()
    .eq('scope_key', scopeKey)
    .select()
    .maybeSingle()

  if (error) throw error
  return data
}

// Kalimat "balik" -- sengaja pendek & gak baca ulang seluruh histori
// (histori aslinya udah otomatis nyambung lewat agent_chat_history +
// wedding_sessions yang emang persistent, ini cuma soal SOPAN SANTUN biar
// gak berasa "ngilang tiba-tiba terus jawab kayak gak kejadian apa-apa").
export function buildTimeoutBackLine(agentName) {
  const variants = [
    `_menghela napas, merapikan berkas sebentar_\n\nMaaf ya, sinyal saya sempat putus barusan. Lanjut dari sini ya 🙏`,
    `_kembali duduk di mejanya_\n\nMaaf, ${agentName} sempat kehilangan sinyal sebentar tadi. Oke, lanjut ya.`,
    `Waduh maaf, tadi sempat ada gangguan koneksi di meja saya. Boleh diulang atau lanjut aja, saya sudah standby lagi kok 🙏`,
  ]
  return variants[Math.floor(Math.random() * variants.length)]
}
