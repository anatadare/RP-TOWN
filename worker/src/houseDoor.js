// Kunci / buka kunci pintu rumah dari Mini App (mode Jelajahi).
//
// POST /api/house-door   body: { initData, mapKey, plot, locked }
//   1. Verifikasi initData Telegram (HMAC pakai BOT_TOKEN, sama seperti /api/kua-invite):
//      identitas pemanggil diambil dari data yang sudah ditandatangani, BUKAN dari input bebas.
//   2. Cari warga dari telegram_id, lalu petak rumahnya (map_key + plot_number).
//   3. Cuma PEMILIK petak itu yang boleh mengubah `houses.door_locked` (diubah pakai service role,
//      jadi klien tidak bisa menulis kolom ini sendiri).
//
// Respons: { ok: true, locked } | { ok: false, reason }
//   reason: unauthorized (401) | bad_request (400) | no_citizen / no_house / not_owner (403/404)
//           | slow_down (429) | migration_missing (500; jalankan migration-015) | db_error (500)

import { createClient } from '@supabase/supabase-js'
import { validateInitData } from './kuaInvite.js'

const MAP_KEY_RE = /^[a-z0-9-]{1,40}$/
const REQUEST_COOLDOWN_MS = 600
const lastRequestAt = new Map() // rem ringan per isolate (best-effort)

const CORS_HEADERS = {
  // Aman pakai '*': pagar keamanannya tanda tangan initData, bukan cookie/origin.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

export async function handleHouseDoor(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
  if (request.method !== 'POST') return json({ ok: false, reason: 'method_not_allowed' }, 405)

  try {
    if (!env.BOT_TOKEN || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('[houseDoor] BOT_TOKEN / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum diisi')
      return json({ ok: false, reason: 'not_configured' }, 500)
    }

    const body = await request.json().catch(() => ({}))
    const user = await validateInitData(String(body?.initData || ''), env.BOT_TOKEN)
    if (!user) return json({ ok: false, reason: 'unauthorized' }, 401)

    const mapKey = String(body?.mapKey || '')
    const plot = body?.plot
    const locked = body?.locked
    if (!MAP_KEY_RE.test(mapKey) || !Number.isInteger(plot) || plot < 1 || plot > 9999 || typeof locked !== 'boolean') {
      return json({ ok: false, reason: 'bad_request' }, 400)
    }

    const now = Date.now()
    if (now - (lastRequestAt.get(user.id) || 0) < REQUEST_COOLDOWN_MS) {
      return json({ ok: false, reason: 'slow_down' }, 429)
    }
    lastRequestAt.set(user.id, now)
    if (lastRequestAt.size > 2000) lastRequestAt.clear()

    const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

    const { data: citizen, error: cErr } = await supabaseAdmin
      .from('citizens')
      .select('id')
      .eq('telegram_id', user.id)
      .maybeSingle()
    if (cErr) throw cErr
    if (!citizen) return json({ ok: false, reason: 'no_citizen' }, 403)

    const { data: house, error: hErr } = await supabaseAdmin
      .from('houses')
      .select('id, owner_citizen_id')
      .eq('map_key', mapKey)
      .eq('plot_number', plot)
      .maybeSingle()
    if (hErr) throw hErr
    if (!house) return json({ ok: false, reason: 'no_house' }, 404)
    if (!house.owner_citizen_id || house.owner_citizen_id !== citizen.id) {
      return json({ ok: false, reason: 'not_owner' }, 403)
    }

    const { error: uErr } = await supabaseAdmin.from('houses').update({ door_locked: locked }).eq('id', house.id)
    if (uErr) {
      if (/door_locked/i.test(uErr.message || '')) {
        console.error('[houseDoor] kolom door_locked belum ada -- jalankan database/migration-015-house-door-lock.sql')
        return json({ ok: false, reason: 'migration_missing' }, 500)
      }
      throw uErr
    }
    return json({ ok: true, locked })
  } catch (err) {
    console.error('[houseDoor] gagal:', err)
    return json({ ok: false, reason: 'db_error' }, 500)
  }
}
