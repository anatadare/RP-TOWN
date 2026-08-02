import { supabase } from './supabase'

// Ambil semua petak rumah di sebuah distrik (misal room "Perumahan"),
// beserta info pemiliknya kalau sudah disewa.
export async function getHouses(districtRoomId) {
  const { data, error } = await supabase
    .from('houses')
    .select('*, owner:citizens(id, display_name, avatar_url)')
    .eq('district_room_id', districtRoomId)
    .order('plot_number', { ascending: true })

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
