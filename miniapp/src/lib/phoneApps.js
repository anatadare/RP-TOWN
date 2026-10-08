import { supabase } from './supabase'

// ============================================================
// phoneApps.js -- data buat aplikasi di dalam layar HP (Kontak, Sosmed).
// (Marketplace pakai getActiveListings dari lib/houseMarket.js, yang SAMA
// dengan tab Market -- jadi datanya asli, bukan dummy.)
// ============================================================

// ---- Kontak: warga RP Town (tabel citizens, RLS public read) ---------------
// Sengaja TIDAK mengambil username Telegram: di dalam HP warga dikenali lewat
// nama + ID RP Town (public_id, migration-013) saja -- username asli = risiko doksing.
export async function getContacts(selfCitizenId) {
  let q = supabase
    .from('citizens')
    .select('id, display_name, avatar_url, public_id')
    .order('display_name', { ascending: true })
    .limit(300)
  if (selfCitizenId) q = q.neq('id', selfCitizenId)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

// ID RP Town milik sendiri (buat ditampilkan & dibagikan di app Kontak).
export async function getMyPublicId(citizenId) {
  if (!citizenId) return null
  const { data, error } = await supabase
    .from('citizens')
    .select('public_id')
    .eq('id', citizenId)
    .maybeSingle()
  if (error) throw error
  return data?.public_id || null
}

// Info profil RP Town (status & bio). Dipisah dari daftar kontak dan dibuat
// toleran: kalau kolomnya belum ada di database, detail tetap tampil tanpa itu.
export async function getContactProfile(citizenId) {
  try {
    const { data, error } = await supabase
      .from('citizens')
      .select('status, bio')
      .eq('id', citizenId)
      .maybeSingle()
    if (error) throw error
    return data || {}
  } catch (err) {
    console.warn('[RP Town] profil kontak:', err)
    return {}
  }
}

// ---- Sosmed (database/migration-011 + 012 + 013) --------------------------
const POST_COLS = 'id, body, image_url, likes_count, comments_count, created_at, edited_at, citizen_id, author:citizens!social_posts_citizen_id_fkey(display_name, avatar_url, public_id)'

export async function getFeed() {
  const { data, error } = await supabase
    .from('social_posts')
    .select(POST_COLS)
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
    .select('id, body, created_at, citizen_id, author:citizens!social_comments_citizen_id_fkey(display_name, avatar_url, public_id)')
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

// ---- Profil, edit & hapus post (migration-013) ----------------------------
export async function getCitizenProfile(citizenId) {
  const { data, error } = await supabase
    .from('citizens')
    .select('id, display_name, avatar_url, public_id')
    .eq('id', citizenId)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function getPostsByAuthor(citizenId) {
  const { data, error } = await supabase
    .from('social_posts')
    .select(POST_COLS)
    .eq('citizen_id', citizenId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw error
  return data || []
}

export async function updatePost(citizenId, postId, body) {
  const { data, error } = await supabase.rpc('update_social_post', {
    p_citizen_id: citizenId,
    p_post_id: postId,
    p_body: body,
  })
  if (error) throw error
  return data
}

export async function deletePost(citizenId, postId) {
  const { error } = await supabase.rpc('delete_social_post', {
    p_citizen_id: citizenId,
    p_post_id: postId,
  })
  if (error) throw error
  return true
}

// Cari warga lewat ID RP Town (RP123456) atau nama. Username Telegram sengaja
// TIDAK ikut dicari -- kalau ikut, orang bisa mencocokkan username asli -> karakter.
export async function searchCitizens(query, selfCitizenId) {
  const q = (query || '').replace(/[,()%*\\]/g, ' ').trim()
  if (q.length < 2) return []
  let req = supabase
    .from('citizens')
    .select('id, display_name, avatar_url, public_id')
    .or(`public_id.ilike.${q},display_name.ilike.%${q}%`)
    .limit(30)
  if (selfCitizenId) req = req.neq('id', selfCitizenId)
  const { data, error } = await req
  if (error) throw error
  return data || []
}

// ---- Chat (migration-013) ---------------------------------------------------
export async function getInbox(citizenId) {
  const { data, error } = await supabase.rpc('get_social_inbox', { p_citizen_id: citizenId })
  if (error) throw error
  return data || []
}

export async function getConversation(citizenId, otherId) {
  const { data, error } = await supabase.rpc('get_social_conversation', {
    p_citizen_id: citizenId,
    p_other_id: otherId,
  })
  if (error) throw error
  return data || []
}

export async function sendMessage(citizenId, toId, body) {
  const { data, error } = await supabase.rpc('send_social_message', {
    p_citizen_id: citizenId,
    p_to_id: toId,
    p_body: body,
  })
  if (error) throw error
  return data
}

export async function countUnread(citizenId) {
  if (!citizenId) return 0
  const { data, error } = await supabase.rpc('count_social_unread', { p_citizen_id: citizenId })
  if (error) throw error
  return Number(data) || 0
}

// Target yang mau dibuka di Sosmed dari app lain (mis. tombol Chat di Kontak):
//   { type: 'chat', person } | { type: 'profile', id }
// peek = baca tanpa menghapus (aman buat initializer useState di StrictMode),
// clear dipanggil sekali setelah SocialApp ter-mount.
let pendingSocialOpen = null
export function setPendingSocialOpen(target) { pendingSocialOpen = target }
export function peekPendingSocialOpen() { return pendingSocialOpen }
export function clearPendingSocialOpen() { pendingSocialOpen = null }

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

// Tambah 1 foto ke galeri HP (dipakai kamera RP dari dalam dunia 3D).
// entry: { id, src, kind: 'real' | 'rp' }
export function addGalleryPhoto(entry) {
  savePhotos([entry, ...loadPhotos()])
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
