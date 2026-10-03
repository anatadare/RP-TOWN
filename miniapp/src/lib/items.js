import { supabase } from './supabase'

// Semua HP yang BENERAN dimiliki seorang warga (tabel citizen_items,
// dari migration-009-items.sql). item_type_id dicocokkan ke katalog di
// kode (phoneCatalog.js) buat ambil label/warna/model 3D-nya -- data
// tampilan (warna, url model) SENGAJA gak disimpan lagi di Supabase,
// biar satu-satunya sumber buat itu tetap kode frontend.
export async function getMyItems(citizenId) {
  const { data, error } = await supabase
    .from('citizen_items')
    .select('id, item_type_id, acquired_via, acquired_at')
    .eq('citizen_id', citizenId)
    .order('acquired_at', { ascending: true })

  if (error) throw error
  return data
}

// Buka box pembuka pertama. Server (function claim_starter_box) yang
// menegakkan "cuma sekali per warga" -- kalau dipanggil dua kali,
// baris kedua akan gagal dengan error dari Postgres (bukan dari sini).
// Return item_types row hasil undian (buat ditampilkan "Kamu dapat X!").
export async function claimStarterBox(citizenId) {
  const { data, error } = await supabase.rpc('claim_starter_box', {
    p_citizen_id: citizenId,
  })

  if (error) throw error
  return data
}

// Pasang salah satu HP milik warga (citizenItemId = id baris di
// citizen_items, BUKAN id varian). Validasi "ini beneran punya warga
// ini?" dilakukan DI DALAM function equip_item, bukan cuma di sini.
export async function equipItem(citizenId, citizenItemId) {
  const { error } = await supabase.rpc('equip_item', {
    p_citizen_id: citizenId,
    p_citizen_item_id: citizenItemId,
  })

  if (error) throw error
}

export async function unequipItem(citizenId) {
  const { error } = await supabase.rpc('unequip_item', {
    p_citizen_id: citizenId,
  })

  if (error) throw error
}
