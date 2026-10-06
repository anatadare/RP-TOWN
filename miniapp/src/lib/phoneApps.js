import { supabase } from './supabase'

// ============================================================
// phoneApps.js -- data buat aplikasi di dalam layar HP (Kontak, Sosmed).
// (Marketplace pakai getActiveListings dari lib/houseMarket.js, yang SAMA
// dengan tab Market -- jadi datanya asli, bukan dummy.)
// ============================================================

// ---- Kontak: semua warga RP Town (tabel citizens, RLS public read) --------
export async function getContacts(selfCitizenId) {
  let q = supabase
    .from('citizens')
    .select('id, display_name, username, avatar_url, last_seen_at')
    .order('display_name', { ascending: true })
    .limit(300)
  if (selfCitizenId) q = q.neq('id', selfCitizenId)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

// ---- Sosmed (database/migration-011-social.sql) ---------------------------
export async function getFeed() {
  const { data, error } = await supabase
    .from('social_posts')
    .select('id, body, likes_count, created_at, citizen_id, author:citizens(display_name, username, avatar_url)')
    .order('created_at', { ascending: false })
    .limit(60)
  if (error) throw error
  return data || []
}

// Set id post yang sudah di-like warga ini (buat warna tombol like).
export async function getMyLikes(citizenId) {
  if (!citizenId) return new Set()
  const { data, error } = await supabase
    .from('social_likes')
    .select('post_id')
    .eq('citizen_id', citizenId)
  if (error) throw error
  return new Set((data || []).map((r) => r.post_id))
}

export async function createPost(citizenId, body) {
  const { data, error } = await supabase.rpc('create_social_post', {
    p_citizen_id: citizenId,
    p_body: body,
  })
  if (error) throw error
  return data
}

// Return jumlah like terbaru dari server.
export async function toggleLike(citizenId, postId) {
  const { data, error } = await supabase.rpc('toggle_social_like', {
    p_citizen_id: citizenId,
    p_post_id: postId,
  })
  if (error) throw error
  return data
}

// ---- Foto kamera: disimpan lokal di perangkat (thumbnail kecil) -------------
const PHOTO_KEY = 'rp-town-phone-photos'
const MAX_PHOTOS = 12

export function loadPhotos() {
  try {
    return JSON.parse(localStorage.getItem(PHOTO_KEY) || '[]')
  } catch {
    return []
  }
}

export function savePhotos(list) {
  try {
    localStorage.setItem(PHOTO_KEY, JSON.stringify(list.slice(0, MAX_PHOTOS)))
  } catch {
    // storage penuh / diblokir -- foto tetap ada di sesi ini saja
  }
}

export function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'baru saja'
  if (s < 3600) return `${Math.floor(s / 60)} mnt`
  if (s < 86400) return `${Math.floor(s / 3600)} j`
  return `${Math.floor(s / 86400)} h`
}
