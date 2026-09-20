// Link masuk grup KUA yang AMAN: sekali pakai + kedaluwarsa cepat, dibuat
// bot on-demand buat warga yang minta lewat Mini App (peta & profil).
//
// Alur (POST /api/kua-invite, body: { initData }):
// 1. Verifikasi `initData` dari Telegram WebApp (tanda tangan HMAC pakai
//    BOT_TOKEN) -- cuma orang yang beneran buka Mini App lewat bot yang lolos,
//    dan user ID diambil dari data yang sudah ditandatangani, bukan dari
//    input bebas.
// 2. Kalau warga itu SUDAH anggota grup KUA -> balikin link langsung ke grup
//    (link t.me/c/... cuma kebuka buat anggota, jadi aman).
// 3. Kalau BUKAN anggota -> cek kapasitas (jumlah warga di grup < batas), lalu
//    bikin invite link `member_limit: 1` + kedaluwarsa INVITE_TTL_SECONDS.
//    Link ini mati begitu 1 orang join, atau begitu waktunya habis.
//
// SYARAT: BOT_TOKEN (bot utama) WAJIB admin di grup KUA dengan izin
// "Invite users via link" (sama kayak syarat izin "Ban users" buat kick).
// Grup KUA harus PRIVAT (KUA_GROUP_USERNAME dikosongkan) dan link undangan
// lama yang statis harus di-revoke, kalau enggak link lama itu jadi pintu
// belakang yang lolos dari semua aturan di atas.
//
// Env opsional:
//   KUA_MAX_WARGA          batas warga di grup (default 11)
//   KUA_BASE_MEMBER_COUNT  jumlah anggota grup yang BUKAN warga (bot + admin
//                          exempt). Default dihitung otomatis dari jumlah
//                          agent + bot utama + admin exempt; isi manual kalau
//                          hitungan otomatisnya meleset (lihat log
//                          "[kuaInvite] total=... base=... warga=...").
//   KUA_LOBBY_THREAD_ID    topic tujuan buat warga yang sudah jadi anggota
//                          (default 1 = topic General)

import { loadAgents } from './config.js'
import { callTelegramApi } from './telegramApi.js'
import { buildRoomLink, getExemptAdminIds } from './groupMembership.js'

const INVITE_TTL_SECONDS = 10 * 60
const DEFAULT_MAX_WARGA = 11
const INIT_DATA_MAX_AGE_SECONDS = 24 * 60 * 60
const REQUEST_COOLDOWN_MS = 5000

// Rem ringan per isolate (best-effort, bukan jaminan) biar tombol yang
// dipencet berkali-kali gak bikin puluhan link.
const lastRequestAt = new Map()

const CORS_HEADERS = {
  // Aman pakai '*': yang jadi pagar keamanan itu tanda tangan initData, bukan
  // cookie/origin.
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

function numEnv(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

async function hmacSha256(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, dataBytes))
}

function toHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Bandingin string tanpa bocor lewat waktu eksekusi.
function safeEqual(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// Validasi `Telegram.WebApp.initData` sesuai dokumentasi resmi Telegram:
// secret = HMAC_SHA256(key="WebAppData", data=bot_token); hash yang dikirim
// harus sama dengan HMAC_SHA256(key=secret, data=data_check_string).
// Return objek user kalau valid, `null` kalau tidak.
export async function validateInitData(initData, botToken, { now = Date.now() } = {}) {
  if (!initData || !botToken) return null

  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) return null
  params.delete('hash')

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n')

  const enc = new TextEncoder()
  const secret = await hmacSha256(enc.encode('WebAppData'), enc.encode(botToken))
  const expected = toHex(await hmacSha256(secret, enc.encode(dataCheckString)))
  if (!safeEqual(expected, hash.toLowerCase())) return null

  const authDate = Number(params.get('auth_date'))
  if (!authDate || now / 1000 - authDate > INIT_DATA_MAX_AGE_SECONDS) return null

  try {
    const user = JSON.parse(params.get('user') || 'null')
    return user && user.id ? user : null
  } catch {
    return null
  }
}

function isActiveMember(member) {
  if (!member) return false
  if (['creator', 'administrator', 'member'].includes(member.status)) return true
  return member.status === 'restricted' && member.is_member === true
}

export async function handleKuaInvite(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
  if (request.method !== 'POST') return json({ ok: false, reason: 'method_not_allowed' }, 405)

  try {
    if (!env.BOT_TOKEN || !env.KUA_GROUP_CHAT_ID) {
      console.error('[kuaInvite] BOT_TOKEN / KUA_GROUP_CHAT_ID belum diisi')
      return json({ ok: false, reason: 'not_configured' }, 500)
    }

    const body = await request.json().catch(() => ({}))
    const user = await validateInitData(String(body?.initData || ''), env.BOT_TOKEN)
    if (!user) return json({ ok: false, reason: 'unauthorized' }, 401)

    const now = Date.now()
    if (now - (lastRequestAt.get(user.id) || 0) < REQUEST_COOLDOWN_MS) {
      return json({ ok: false, reason: 'slow_down' }, 429)
    }
    lastRequestAt.set(user.id, now)
    if (lastRequestAt.size > 2000) lastRequestAt.clear()

    const chatId = env.KUA_GROUP_CHAT_ID

    // Sudah anggota? Kasih link langsung ke grup (gak perlu invite baru).
    let member = null
    try {
      member = await callTelegramApi(env.BOT_TOKEN, 'getChatMember', { chat_id: chatId, user_id: user.id })
    } catch (err) {
      // "user not found"/bukan anggota -> lanjut ke pembuatan invite.
      member = null
    }
    if (isActiveMember(member)) {
      return json({ ok: true, kind: 'member', url: buildRoomLink(env, chatId, env.KUA_LOBBY_THREAD_ID || 1) })
    }

    // Kapasitas: total anggota grup dikurangi yang bukan warga (bot + admin).
    const total = await callTelegramApi(env.BOT_TOKEN, 'getChatMemberCount', { chat_id: chatId })
    const { allAgents } = loadAgents(env)
    const base = numEnv(env.KUA_BASE_MEMBER_COUNT, allAgents.length + 1 + getExemptAdminIds(env).size)
    const max = numEnv(env.KUA_MAX_WARGA, DEFAULT_MAX_WARGA)
    const wargaNow = Math.max(0, total - base)
    console.log(`[kuaInvite] total=${total} base=${base} warga=${wargaNow}/${max}`)

    if (wargaNow >= max) {
      return json({ ok: false, reason: 'full', current: wargaNow, max })
    }

    const invite = await callTelegramApi(env.BOT_TOKEN, 'createChatInviteLink', {
      chat_id: chatId,
      name: `warga ${user.id}`.slice(0, 32),
      member_limit: 1,
      expire_date: Math.floor(now / 1000) + INVITE_TTL_SECONDS,
    })

    return json({ ok: true, kind: 'invite', url: invite.invite_link, expiresInSeconds: INVITE_TTL_SECONDS })
  } catch (err) {
    console.error('[kuaInvite] gagal:', err)
    return json({ ok: false, reason: 'telegram_error' }, 502)
  }
}
