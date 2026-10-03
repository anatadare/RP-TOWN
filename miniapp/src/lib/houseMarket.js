import { supabase } from './supabase'

// Ambil semua listing rumah yang sedang aktif (dijual), lengkap dengan
// info rumah dan penjualnya. Read-only -- RLS `house_listings: public read`
// (lihat database/migration-009-house-market.sql) mengizinkan ini dibaca
// tanpa login khusus.
//
// Pemasangan/pembatalan listing dan pembelian SENGAJA tidak lewat sini --
// fungsi database `create_house_listing` & `transfer_house` cuma bisa
// dipanggil oleh worker (service_role), bukan dari miniapp langsung, biar
// identitas pembeli/penjual selalu divalidasi lebih dulu lewat Telegram.
// Makanya aksi jual-beli tetap lewat chat ke Pak Darma.
export async function getActiveListings() {
  const { data, error } = await supabase
    .from('house_listings')
    .select(
      // 'seller:citizens!house_listings_seller_citizen_id_fkey(...)' -- WAJIB pakai
      // nama constraint eksplisit di sini. house_listings punya 2 kolom yang
      // sama-sama menunjuk ke citizens (seller_citizen_id & buyer_citizen_id),
      // jadi kalau ditulis 'citizens(...)' polos, PostgREST bingung mau pakai
      // FK yang mana dan query ini gagal total (bukan cuma salah data).
      'id, price, created_at, seller_citizen_id, house:houses(name, plot_number, map_key), seller:citizens!house_listings_seller_citizen_id_fkey(display_name, username, avatar_url)'
    )
    .eq('status', 'active')
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}
