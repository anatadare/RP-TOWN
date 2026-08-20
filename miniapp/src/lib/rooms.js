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

// Polling: dipanggil berulang dari App.jsx tiap beberapa detik,
// bukan koneksi realtime yang "nyantol" terus. Ini menghindari limit
// concurrent realtime connections di Supabase free tier.
export async function pollRooms() {
  return getRoomsWithPresence()
}

// Bikin slug dari nama room, dipakai pas admin bikin room baru dari 3D map
// (contoh: "Balai Kota" -> "balai-kota")
function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

// Tempelin sebuah room ke bangunan tertentu di 3D map (dipanggil dari mode admin).
// mapKey ikut ditulis ulang supaya room yang tadinya belum punya peta (atau
// pindah dari peta lain) ke-tandain sebagai milik peta yang lagi aktif —
// soalnya nomor node bangunan (TPX_Buildings_N) bisa nabrak antar peta.
export async function assignBuildingToRoom(roomId, buildingKey, mapKey) {
  const { data, error } = await supabase
    .from('rooms')
    .update({ building_key: buildingKey, map_key: mapKey })
    .eq('id', roomId)
    .select()
    .single()

  if (error) throw error
  return data
}

// Lepas sambungan bangunan <-> room (building_key dikosongin lagi)
export async function unassignBuilding(buildingKey) {
  const { error } = await supabase
    .from('rooms')
    .update({ building_key: null })
    .eq('building_key', buildingKey)

  if (error) throw error
}

// Bikin room baru sekaligus langsung ditempel ke sebuah bangunan di 3D map
export async function createRoomForBuilding({ name, emoji, telegramGroupUrl, buildingKey, mapKey }) {
  const { data, error } = await supabase
    .from('rooms')
    .insert({
      // ikut prefix map biar slug gak nabrak sama room bangunan di peta lain
      // yang nomor node-nya kebetulan sama (contoh: TPX_Buildings_5 di 2 peta)
      slug: `${slugify(name)}-${mapKey}-${buildingKey.toLowerCase()}`,
      name,
      emoji: emoji || '📍',
      telegram_group_url: telegramGroupUrl || null,
      building_key: buildingKey,
      map_key: mapKey,
    })
    .select()
    .single()

  if (error) throw error
  return data
}
