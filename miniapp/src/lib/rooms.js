import { supabase } from './supabase'

// Pastikan baris user ada di tabel `citizens` (upsert berdasarkan telegram_id)
export async function ensureCitizen(tgUser) {
  const { data, error } = await supabase
    .from('citizens')
    .upsert(
      {
        telegram_id: tgUser.id,
        username: tgUser.username,
        display_name: tgUser.displayName,
        avatar_url: tgUser.photoUrl,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'telegram_id' }
    )
    .select()
    .single()

  if (error) throw error
  return data
}

// Ambil semua room + jumlah orang yang lagi di room itu
export async function getRoomsWithPresence() {
  const { data: rooms, error: roomsError } = await supabase
    .from('rooms')
    .select('*')
    .order('sort_order', { ascending: true })

  if (roomsError) throw roomsError

  const { data: presence, error: presenceError } = await supabase
    .from('room_presence')
    .select('room_id, citizen_id, citizens(display_name, avatar_url)')

  if (presenceError) throw presenceError

  return rooms.map((room) => {
    const occupants = presence.filter((p) => p.room_id === room.id)
    return {
      ...room,
      occupantCount: occupants.length,
      occupants: occupants.map((o) => o.citizens),
    }
  })
}

// User "masuk" ke sebuah room: hapus presence lama, insert presence baru
export async function enterRoom(citizenId, roomId) {
  const { error: deleteError } = await supabase
    .from('room_presence')
    .delete()
    .eq('citizen_id', citizenId)

  if (deleteError) throw deleteError

  const { error: insertError } = await supabase
    .from('room_presence')
    .insert({ citizen_id: citizenId, room_id: roomId })

  if (insertError) throw insertError
}

// Subscribe realtime: setiap kali ada perubahan presence, callback dipanggil
export function subscribeToPresence(callback) {
  const channel = supabase
    .channel('room_presence_changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'room_presence' },
      callback
    )
    .subscribe()

  return () => supabase.removeChannel(channel)
}
