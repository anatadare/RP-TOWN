// Mode Jelajahi MULTIPLAYER: 1 "room jalan-jalan" per PETA (bukan per
// bangunan). Semua warga yang lagi jalan-jalan di peta yang sama masuk ke
// room yang sama dan saling kelihatan.
//
// Ini lapisan TERPISAH dari tabel `rooms` / `room_presence` (ruang bangunan,
// grup Telegram, batas KUA 11 warga dst.) -- posisi pemain cuma hidup di
// memori Durable Object ini, gak pernah ditulis ke database, jadi logika
// ruangan yang lama gak kesentuh sama sekali.
//
// Alur:
//   Mini App --WebSocket--> GET /ws/walk/:mapKey?initData=...&c=<characterId>
//   1. Worker (handleWalkSocket) verifikasi initData Telegram (HMAC, sama
//      kayak /api/kua-invite) -> id & nama pemain diambil dari data yang
//      sudah ditandatangani, BUKAN dari input bebas.
//   2. Lolos -> diteruskan ke Durable Object `WalkRoom` milik peta itu
//      (idFromName(mapKey)). Gagal -> WebSocket tetap dibuka lalu langsung
//      ditutup dengan kode 4001 (browser gak bisa baca status HTTP dari
//      upgrade yang gagal, tapi bisa baca kode close).
//   3. DO nyimpen posisi terakhir tiap pemain, ngirim snapshot ke yang baru
//      masuk, dan nge-relay tiap update posisi ke pemain lain.
//
// Pesan (JSON, key dipendekin biar hemat):
//   client -> server : { t:'s', x, y, z, r, a }      posisi, arah hadap (rad),
//                                                    a = animasi 0 Idle/1 Walk/2 Run/3 Jump
//   server -> client : { t:'snap', you, peers:[{i,n,c,x,y,z,r,a}] }
//                      { t:'join', p:{i,n,c,x,y,z,r,a} }
//                      { t:'s', i, x, y, z, r, a }
//                      { t:'leave', i }
//
// Kode close: 4000 = digantikan koneksi baru akun yang sama, 4001 = gak
// terautentikasi, 4002 = terlalu lama diam (dianggap hilang), 4003 = penuh.
//
// Pakai WebSocket Hibernation API: DO gak ngitung durasi (dan bisa tidur)
// selama gak ada pesan masuk. Sengaja TIDAK ada setInterval/alarm di sini.
//
// Env opsional:
//   WALK_MAX_PLAYERS   batas pemain per peta (default 40)

import { DurableObject } from 'cloudflare:workers'
import { validateInitData } from './kuaInvite.js'

const DEFAULT_MAX_PLAYERS = 40
const MAX_MESSAGE_BYTES = 256
const MIN_STATE_INTERVAL_MS = 60 // update lebih rapat dari ini dibuang
const STALE_AFTER_MS = 90 * 1000 // gak ada kabar segini lama = dianggap hilang
const PRUNE_EVERY_MS = 15 * 1000
const ATTACHMENT_SAVE_EVERY_MS = 3000 // simpan posisi ke attachment (buat bangun dari hibernasi)
const COORD_LIMIT = 20000

const MAP_KEY_RE = /^[a-z0-9-]{1,40}$/
const CHAR_ID_RE = /^[a-z0-9_]{1,32}$/

function numEnv(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

// Buka WebSocket lalu langsung tutup dengan kode tertentu (biar client tau
// alasannya, bukan sekadar "gagal konek").
function rejectSocket(code, reason) {
  const pair = new WebSocketPair()
  const [client, server] = Object.values(pair)
  server.accept()
  server.close(code, reason)
  return new Response(null, { status: 101, webSocket: client })
}

function cleanName(user) {
  const raw = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || 'Warga'
  // buang karakter kontrol, rapikan spasi, batasi panjang
  return raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24) || 'Warga'
}

// Dipanggil dari index.js untuk route GET /ws/walk/:mapKey
export async function handleWalkSocket(request, env, mapKey) {
  if (request.headers.get('Upgrade') !== 'websocket') {
    return new Response('expected websocket', { status: 426 })
  }
  if (!env.WALK_ROOM) {
    console.error('[walk] binding WALK_ROOM belum ada (cek wrangler.toml)')
    return rejectSocket(4001, 'not_configured')
  }
  if (!MAP_KEY_RE.test(mapKey)) return rejectSocket(4001, 'bad_map')

  const url = new URL(request.url)
  const user = await validateInitData(url.searchParams.get('initData') || '', env.BOT_TOKEN)
  if (!user) return rejectSocket(4001, 'unauthorized')

  let charId = url.searchParams.get('c') || ''
  if (!CHAR_ID_RE.test(charId)) charId = ''

  const stub = env.WALK_ROOM.get(env.WALK_ROOM.idFromName(mapKey))
  const headers = new Headers(request.headers)
  headers.set('X-Walk-Id', String(user.id))
  headers.set('X-Walk-Name', encodeURIComponent(cleanName(user)))
  headers.set('X-Walk-Char', charId)
  return stub.fetch(new Request('https://walk-room/connect', { headers }))
}

function isNum(v, limit) {
  return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= limit
}

export class WalkRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.players = new Map() // id -> { i, n, c, x, y, z, r, a, hasPos, seen, lastMsg, lastSave }
    this.sockets = new Map() // id -> WebSocket
    this.lastPrune = 0

    // Bangun ulang dari WebSocket yang masih nyambung setelah DO bangun dari hibernasi.
    for (const ws of ctx.getWebSockets()) {
      const at = ws.deserializeAttachment()
      if (!at || !at.i) continue
      this.players.set(at.i, { ...at, seen: Date.now(), lastMsg: 0, lastSave: Date.now() })
      this.sockets.set(at.i, ws)
    }
  }

  async fetch(request) {
    const id = request.headers.get('X-Walk-Id')
    if (!id) return new Response('forbidden', { status: 403 })

    const max = numEnv(this.env.WALK_MAX_PLAYERS, DEFAULT_MAX_PLAYERS)
    if (!this.players.has(id) && this.players.size >= max) return rejectSocket(4003, 'full')

    let name = 'Warga'
    try {
      name = decodeURIComponent(request.headers.get('X-Walk-Name') || '') || 'Warga'
    } catch {
      // nama rusak -> pakai default
    }
    const charId = request.headers.get('X-Walk-Char') || ''

    // Akun yang sama buka dari perangkat lain -> koneksi lama diganti.
    const old = this.sockets.get(id)
    if (old) {
      this.players.delete(id)
      this.sockets.delete(id)
      this.broadcast({ t: 'leave', i: id }, null)
      try {
        old.close(4000, 'replaced')
      } catch {
        // sudah tertutup
      }
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    this.ctx.acceptWebSocket(server)

    const player = { i: id, n: name, c: charId, x: 0, y: 0, z: 0, r: 0, a: 0, hasPos: false }
    server.serializeAttachment(player)
    this.players.set(id, { ...player, seen: Date.now(), lastMsg: 0, lastSave: Date.now() })
    this.sockets.set(id, server)

    // Snapshot: semua pemain lain yang posisinya sudah diketahui.
    const peers = []
    for (const p of this.players.values()) {
      if (p.i !== id && p.hasPos) peers.push(this.publicState(p))
    }
    server.send(JSON.stringify({ t: 'snap', you: id, peers }))

    return new Response(null, { status: 101, webSocket: client })
  }

  publicState(p) {
    return { i: p.i, n: p.n, c: p.c, x: p.x, y: p.y, z: p.z, r: p.r, a: p.a }
  }

  // Kirim ke semua kecuali `except` (boleh null).
  broadcast(payload, except) {
    const text = JSON.stringify(payload)
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue
      try {
        ws.send(text)
      } catch {
        // socket lagi nutup -- dibereskan di webSocketClose/Error
      }
    }
  }

  async webSocketMessage(ws, message) {
    if (typeof message !== 'string' || message.length > MAX_MESSAGE_BYTES) return

    let msg
    try {
      msg = JSON.parse(message)
    } catch {
      return
    }
    if (!msg || msg.t !== 's') return

    const at = ws.deserializeAttachment()
    const p = at && this.players.get(at.i)
    // Socket ini bukan socket aktif akun itu (mis. sudah digantikan) -> abaikan.
    if (!p || this.sockets.get(p.i) !== ws) return

    const now = Date.now()
    if (now - p.lastMsg < MIN_STATE_INTERVAL_MS) return
    if (!isNum(msg.x, COORD_LIMIT) || !isNum(msg.y, COORD_LIMIT) || !isNum(msg.z, COORD_LIMIT)) return
    if (!isNum(msg.r, 100)) return
    const a = msg.a
    if (!Number.isInteger(a) || a < 0 || a > 3) return

    p.lastMsg = now
    p.seen = now
    p.x = msg.x
    p.y = msg.y
    p.z = msg.z
    p.r = msg.r
    p.a = a

    if (!p.hasPos) {
      // Pertama kali posisinya diketahui -> baru diumumin ke pemain lain.
      p.hasPos = true
      ws.serializeAttachment({ i: p.i, n: p.n, c: p.c, x: p.x, y: p.y, z: p.z, r: p.r, a: p.a, hasPos: true })
      p.lastSave = now
      this.broadcast({ t: 'join', p: this.publicState(p) }, ws)
    } else {
      if (now - p.lastSave > ATTACHMENT_SAVE_EVERY_MS) {
        ws.serializeAttachment({ i: p.i, n: p.n, c: p.c, x: p.x, y: p.y, z: p.z, r: p.r, a: p.a, hasPos: true })
        p.lastSave = now
      }
      this.broadcast({ t: 's', i: p.i, x: p.x, y: p.y, z: p.z, r: p.r, a: p.a }, ws)
    }

    this.pruneStale(now)
  }

  // Buang pemain yang sudah lama gak ngasih kabar (HP mati/sinyal putus tanpa
  // sempat nutup koneksi). Dicek "malas" tiap ada pesan masuk -- bukan lewat
  // timer/alarm, supaya DO tetap bisa hibernasi.
  pruneStale(now) {
    if (now - this.lastPrune < PRUNE_EVERY_MS) return
    this.lastPrune = now
    for (const p of [...this.players.values()]) {
      if (now - p.seen <= STALE_AFTER_MS) continue
      const ws = this.sockets.get(p.i)
      this.players.delete(p.i)
      this.sockets.delete(p.i)
      this.broadcast({ t: 'leave', i: p.i }, ws || null)
      try {
        ws?.close(4002, 'idle')
      } catch {
        // sudah tertutup
      }
    }
  }

  removeSocket(ws) {
    const at = ws.deserializeAttachment()
    const id = at?.i
    if (!id) return
    // Cuma bereskan kalau ini memang socket aktif (bukan socket lama yang sudah diganti).
    if (this.sockets.get(id) !== ws) return
    const hadPos = this.players.get(id)?.hasPos
    this.players.delete(id)
    this.sockets.delete(id)
    if (hadPos) this.broadcast({ t: 'leave', i: id }, ws)
  }

  async webSocketClose(ws, code, reason) {
    this.removeSocket(ws)
    try {
      ws.close(code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1000, reason)
    } catch {
      // sudah tertutup
    }
  }

  async webSocketError(ws) {
    this.removeSocket(ws)
  }
}
