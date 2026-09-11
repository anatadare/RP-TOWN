// Query status ruangan (rooms + room_presence) buat dikasih ke Pegawai
// sebagai KONTEKS FAKTUAL. Sengaja dipisah dari geminiClient/runner biar
// jelas: ini murni baca data, AI cuma "membungkus" hasilnya jadi kalimat,
// nggak pernah menebak angka sendiri (konsisten sama prinsip project:
// data nyata selalu lewat kode, AI cuma buat konten fleksibel).

async function getRoomAvailabilitySummary(supabaseAdmin) {
  const { data: rooms, error: roomsError } = await supabaseAdmin
    .from('rooms')
    .select('id, slug, name, emoji')
    .order('sort_order', { ascending: true })

  if (roomsError) throw roomsError
  if (!rooms || rooms.length === 0) return null

  const { data: presence, error: presenceError } = await supabaseAdmin
    .from('room_presence')
    .select('room_id')

  if (presenceError) throw presenceError

  const countByRoom = new Map()
  for (const row of presence || []) {
    countByRoom.set(row.room_id, (countByRoom.get(row.room_id) || 0) + 1)
  }

  const summaryRows = rooms.map((room) => ({
    name: room.name,
    emoji: room.emoji,
    count: countByRoom.get(room.id) || 0,
  }))

  // Urutkan dari yang paling sepi ke paling ramai, biar gampang
  // direkomendasikan ke warga yang nanya "ruang kosong".
  summaryRows.sort((a, b) => a.count - b.count)

  return summaryRows
}

// Ubah hasil query di atas jadi teks ringkas buat disisipkan ke system
// instruction Pegawai (lihat personas/pegawai.js).
function formatRoomAvailabilityContext(summaryRows) {
  if (!summaryRows || summaryRows.length === 0) return null
  return summaryRows
    .map((r) => `- ${r.emoji} ${r.name}: ${r.count} warga lagi di sana`)
    .join('\n')
}

module.exports = { getRoomAvailabilitySummary, formatRoomAvailabilityContext }
