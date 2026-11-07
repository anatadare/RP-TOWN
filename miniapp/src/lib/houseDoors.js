// Kunci pintu rumah (mode Jelajahi). Status kunci disimpan di kolom `houses.door_locked`
// (database/migration-015-house-door-lock.sql). Dibaca langsung dari Supabase (publik),
// tapi DIUBAH lewat Worker (POST /api/house-door) yang memverifikasi pemiliknya dari
// tanda tangan Telegram -- klien tidak bisa menulis kolom itu sendiri.
//
// Aturan: pintu terkunci kalau rumah punya pemilik DAN door_locked != false. Rumah tanpa
// pemilik tidak pernah terkunci. Kalau migrasi belum dijalankan (kolom belum ada), semua
// pintu dianggap tidak terkunci (supported = false) supaya fitur buka-tutup tetap jalan.
import { supabase } from './supabase'
import { SEA_FIRST, SEA_LAST } from './pantaiLaut'

const WORKER_URL = (import.meta.env.VITE_WORKER_URL || '').replace(/\/+$/, '')

// Balik { supported, rows: Map<nomorRumah, { owner: string|null, locked: boolean }> }, atau null kalau gagal baca.
export async function fetchHouseDoorStates(mapKey) {
  let res = await supabase
    .from('houses')
    .select('plot_number, owner_citizen_id, door_locked')
    .eq('map_key', mapKey)
    .gte('plot_number', SEA_FIRST)
    .lte('plot_number', SEA_LAST)
  let supported = true
  if (res.error && /door_locked/i.test(res.error.message || '')) {
    // migrasi belum dijalankan: baca pemilik saja, tanpa kunci
    supported = false
    res = await supabase
      .from('houses')
      .select('plot_number, owner_citizen_id')
      .eq('map_key', mapKey)
      .gte('plot_number', SEA_FIRST)
      .lte('plot_number', SEA_LAST)
  }
  if (res.error || !Array.isArray(res.data)) {
    console.warn('[RP Town] gagal baca status kunci pintu:', res.error?.message)
    return null
  }
  const rows = new Map()
  for (const r of res.data) {
    const owner = r.owner_citizen_id || null
    rows.set(Number(r.plot_number), { owner, locked: supported && !!owner && r.door_locked !== false })
  }
  return { supported, rows }
}

// Pemilik mengunci (locked = true) / membuka kunci (false) pintu rumah `plot`.
// Balik { ok: true } atau { ok: false, reason }.
export async function setHouseDoorLocked({ mapKey, plot, locked }) {
  const initData = typeof window !== 'undefined' ? window.Telegram?.WebApp?.initData : ''
  if (!WORKER_URL || !initData) return { ok: false, reason: 'no_telegram' }
  try {
    const res = await fetch(`${WORKER_URL}/api/house-door`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, mapKey, plot, locked }),
    })
    const body = await res.json().catch(() => ({}))
    if (body && body.ok) return { ok: true }
    return { ok: false, reason: body?.reason || 'error' }
  } catch {
    return { ok: false, reason: 'network' }
  }
}

export function doorErrorText(reason) {
  switch (reason) {
    case 'no_telegram': return 'Buka lewat Telegram untuk mengunci pintu.'
    case 'not_owner': return 'Ini bukan rumahmu.'
    case 'migration_missing': return 'Fitur kunci belum aktif di database.'
    case 'slow_down': return 'Pelan-pelan, coba lagi sebentar.'
    case 'network': return 'Tidak ada koneksi, coba lagi.'
    default: return 'Gagal mengubah kunci, coba lagi.'
  }
}
