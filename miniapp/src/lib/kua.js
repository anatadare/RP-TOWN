// Akses masuk grup KUA lewat link SEKALI PAKAI yang dibuat bot on-demand
// (lihat worker/src/kuaInvite.js) -- dipakai dari peta (modal masuk ruang)
// dan dari profil (tombol "Buka grup KUA" di pohon keluarga).
//
// Butuh env Vercel `VITE_WORKER_URL` = URL Worker Cloudflare (tanpa slash di
// belakang), contoh: https://rp-town.namaakun.workers.dev

import { supabase } from './supabase'

const WORKER_URL = (import.meta.env.VITE_WORKER_URL || '').replace(/\/+$/, '')

// Minta link masuk KUA. Selalu balikin objek (gak pernah throw):
//   { ok: true, kind: 'member' | 'invite', url }
//   { ok: false, reason: 'full' | 'not_in_telegram' | 'not_configured' | ... }
export async function requestKuaInvite() {
  const initData = typeof window !== 'undefined' ? window.Telegram?.WebApp?.initData : ''
  if (!initData) return { ok: false, reason: 'not_in_telegram' }
  if (!WORKER_URL) return { ok: false, reason: 'not_configured' }

  try {
    const res = await fetch(`${WORKER_URL}/api/kua-invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData }),
    })
    const data = await res.json().catch(() => null)
    if (data && typeof data === 'object') return data
    return { ok: false, reason: 'bad_response' }
  } catch (err) {
    console.warn('[kua] gagal minta link masuk:', err)
    return { ok: false, reason: 'network' }
  }
}

export function kuaInviteErrorMessage(result) {
  switch (result?.reason) {
    case 'full':
      return 'Ruang KUA lagi penuh. Coba lagi sebentar lagi ya.'
    case 'not_in_telegram':
      return 'Buka Mini App ini lewat Telegram dulu ya.'
    case 'slow_down':
      return 'Sebentar ya, jangan terlalu cepat mencet tombolnya.'
    case 'unauthorized':
      return 'Sesi kamu kedaluwarsa. Tutup lalu buka lagi Mini App-nya.'
    default:
      return 'Gagal buka pintu KUA. Coba lagi sebentar lagi.'
  }
}

// Ada ruangan KUA di tabel rooms? (buat nentuin tombol "Buka grup KUA"
// ditampilkan atau enggak -- gak lagi bergantung ke kolom telegram_group_url,
// karena link statis SENGAJA dikosongkan.)
export async function fetchHasKuaRoom() {
  const { data, error } = await supabase
    .from('rooms')
    .select('id')
    .or('slug.ilike.*kua*,name.ilike.*kua*,name.ilike.*civil registry*')
    .limit(1)
  if (error) throw error
  return Boolean(data && data.length > 0)
}
