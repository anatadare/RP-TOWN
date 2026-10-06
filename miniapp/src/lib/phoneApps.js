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

// ---- Sosmed (database/migration-011 + migration-012-social-media.sql) -----
export async function getFeed() {
  const { data, error } = await supabase
    .from('social_posts')
    .select('id, body, image_url, likes_count, comments_count, created_at, citizen_id, author:citizens(display_name, username, avatar_url)')
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

// Foto (data URL dari kamera/galeri) -> Supabase Storage bucket 'social-photos'
// -> URL publik. Return null kalau gak ada foto.
export async function uploadPhoto(citizenId, dataUrl) {
  if (!dataUrl) return null
  const blob = await (await fetch(dataUrl)).blob()
  const path = `${citizenId}/${Date.now()}.jpg`
  const { error } = await supabase.storage
    .from('social-photos')
    .upload(path, blob, { contentType: 'image/jpeg', upsert: false })
  if (error) throw error
  return supabase.storage.from('social-photos').getPublicUrl(path).data.publicUrl
}

export async function createPost(citizenId, body, imageUrl = null) {
  const { data, error } = await supabase.rpc('create_social_post', {
    p_citizen_id: citizenId,
    p_body: body,
    p_image_url: imageUrl,
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

export async function getComments(postId) {
  const { data, error } = await supabase
    .from('social_comments')
    .select('id, body, created_at, citizen_id, author:citizens(display_name, username, avatar_url)')
    .eq('post_id', postId)
    .order('created_at', { ascending: true })
    .limit(100)
  if (error) throw error
  return data || []
}

export async function addComment(citizenId, postId, body) {
  const { data, error } = await supabase.rpc('create_social_comment', {
    p_citizen_id: citizenId,
    p_post_id: postId,
    p_body: body,
  })
  if (error) throw error
  return data
}

// Foto yang lagi "dibagikan" dari app Kamera ke app Sosmed (cukup variabel
// modul -- cuma hidup selama sesi, gak perlu disimpan ke mana-mana).
let pendingSharePhoto = null
export function setPendingShare(dataUrl) { pendingSharePhoto = dataUrl }
export function takePendingShare() {
  const p = pendingSharePhoto
  pendingSharePhoto = null
  return p
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
