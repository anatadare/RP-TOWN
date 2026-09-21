import { supabase } from './supabase'

// Pulau yang boleh disewa. 'rp-town-city' SENGAJA tidak ada di sini
// karena itu aset milik RP Town. (Server juga menolak lewat rent_house.)
export const RENTABLE_ISLANDS = [
  { key: 'kawasan-pantai', name: 'Kawasan Pantai', emoji: '🏖️' },
  { key: 'lpm', name: 'LPM', emoji: '🌴' },
]

export function getIslandName(key) {
  return RENTABLE_ISLANDS.find((i) => i.key === key)?.name || key
}

// Ambil semua petak rumah di sebuah distrik (room "Rumah Pulau"),
// beserta info pemiliknya kalau sudah disewa.
export async function getHouses(districtRoomId) {
  const { data, error } = await supabase
    .from('houses')
    .select('*, owner:citizens(id, display_name, avatar_url)')
    .eq('district_room_id', districtRoomId)
    .in('map_key', RENTABLE_ISLANDS.map((i) => i.key))
    .order('plot_number', { ascending: true })

  if (error) throw error
  return data
}

// Cari petak rumah milik seorang warga (kalau ada), buat ditampilkan di halaman Profil.
// Ikut sertakan info distrik (nama/emoji/link grup) buat fallback kalau petak
// belum punya topic Telegram sendiri.
export async function getHouseByOwner(citizenId) {
  if (!citizenId) return null

  const { data, error } = await supabase
    .from('houses')
    .select('*, district:rooms(name, emoji, telegram_group_url)')
    .eq('owner_citizen_id', citizenId)
    .maybeSingle()

  if (error) throw error
  return data
}

// Sewa sebuah petak rumah. Prosesnya atomik lewat Postgres function `rent_house`
// (cek petak masih kosong + koin cukup + potong koin + assign pemilik, semua dalam 1 transaksi).
export async function rentHouse(houseId, citizenId) {
  const { data, error } = await supabase.rpc('rent_house', {
    p_house_id: houseId,
    p_citizen_id: citizenId,
  })

  if (error) throw error
  return data
}
