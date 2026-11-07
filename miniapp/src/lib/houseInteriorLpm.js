// Interior "Rumah LPM" 2 lantai buat peta LPM (mode Jelajahi).
//
// Murni JavaScript (tanpa three.js), sama seperti houseInteriorPantai.js, supaya
// fisikanya bisa dites di Node. Yang menggambar ada di components/HouseInteriorLpm.jsx.
//
// Denah ini hasil desain "Rumah LPM Modern Mewah" yang disetujui user (2026-11-07):
// bangunan 12 x 10 m per lantai (120 m2), 3 kamar tidur (semua di lantai 2, masing-masing
// + kamar mandi dalam), ruang tamu double-height (void) + balkon lantai 2, tangga L
// (16 anak tangga) + teras. Interior diperkecil supaya pas dengan eksterior (bukan
// interior lama 20x20 1 lantai). Ukuran nyata, 1 satuan = 1 meter.
//
// KOORDINAT. Denah ditulis dalam "koordinat denah": x ke kanan (dilihat dari
// depan / jalan), y dari depan (jalan) ke belakang. Dunia three.js memakai
// X = 12 - x (dicerminkan supaya kiri-kanan sama dengan gambar denah, karena
// three.js tangan-kanan) dan Z = y. Cerminan itu dilakukan di dua tempat saja:
//   - gambar  : grup pembungkus ber-scale [-1,1,1] di HouseInteriorLpm.jsx
//   - fisika  : fungsi `mx()` di bawah (semua API dunia memakai koordinat DUNIA)
// Jadi data di file ini selalu koordinat denah.
//
// Kamar tidur dipecah jadi 2 persegi dengan id yang sama (mis. 'k-utama' = rect
// A + rect B) supaya kamar mandi dalamnya jadi ruangan sendiri tanpa tumpang
// tindih. `wallLines()` membuang sisi dalam yang dibagi dua persegi ber-id sama,
// jadi tidak ada dinding di tengah kamar.

// Kedalaman balkon lantai 2 & teras lantai 1 (m, keluar dari fasad depan).
// Dipakai denah, pagar (tabrakan), model 3D, dan ukuran tapak rumah di tampak luar
// (lib/lpmHouses.js), jadi cukup ubah angka ini.
export const BALKON_D = 1.2
export const TERAS_D = 1.2

const PLAN = {
  lot: { w: 14, d: 15, x0: -1, y0: -5 },          // lahan ~14 x 15 m; bangunan di (0,0)-(12,10), carport di depan
  W: 12, D: 10, tExt: 0.2, tInt: 0.1,
  floorH: 3.2, ceilH: 3.0, plinth: 0.4,
  stair: { x0: 0, x1: 3, y0: 7, y1: 10, steps: 16, tread: 0.25, width: 1.0, treadsPerFlight: 8 },
  floors: [
    { id: 1, name: 'Lantai 1',
      rooms: [
        { id: 'tamu',   name: 'Ruang Tamu',    type: 'living',  x0: 0,    y0: 0, x1: 6,    y1: 7 },
        { id: 'makan',  name: 'Ruang Makan',   type: 'dining',  x0: 6,    y0: 0, x1: 12,   y1: 4 },
        { id: 'dapur',  name: 'Dapur',         type: 'kitchen', x0: 6,    y0: 4, x1: 12,   y1: 7 },
        { id: 'tangga', name: 'Tangga',        type: 'stair',   x0: 0,    y0: 7, x1: 3,    y1: 10 },
        { id: 'hall1',  name: 'Koridor',       type: 'hall',    x0: 3,    y0: 7, x1: 9,    y1: 10, nolabel: true },
        { id: 'km',     name: 'Kamar Mandi',   type: 'bath',    x0: 9,    y0: 7, x1: 12,   y1: 10 },
      ],
      extras: [ { id: 'teras', name: 'Teras', type: 'porch', x0: 3, y0: -TERAS_D, x1: 7, y1: 0 } ],
      openings: [
        { id: 'pintu-utama', kind: 'entry',  o: 'h', at: 0, a: 4.5, b: 5.5, sill: 0, head: 2.4, hinge: 'a', swing: 1 },
        { id: 'tamu-dpn',    kind: 'window', o: 'h', at: 0, a: 0.8, b: 3.8, sill: 0.1, head: 2.6 },
        { id: 'makan-dpn',   kind: 'window', o: 'h', at: 0, a: 7.0, b: 11.0, sill: 0.1, head: 2.6 },
        { id: 'tamu-brt',    kind: 'window', o: 'v', at: 0, a: 1.5, b: 5.5, sill: 0.5, head: 2.5 },
        { id: 'tangga-brt',  kind: 'window', o: 'v', at: 0, a: 7.5, b: 9.5, sill: 0.5, head: 2.7 },
        { id: 'makan-tmr',   kind: 'window', o: 'v', at: 12, a: 1.0, b: 3.0, sill: 0.5, head: 2.5 },
        { id: 'dapur-tmr',   kind: 'window', o: 'v', at: 12, a: 4.5, b: 6.5, sill: 1.0, head: 2.1 },
        { id: 'km-tmr',      kind: 'window', o: 'v', at: 12, a: 7.5, b: 9.0, sill: 1.5, head: 2.2 },
        { id: 'tangga-blk',  kind: 'window', o: 'h', at: 10, a: 0.5, b: 2.5, sill: 0.9, head: 2.3 },
        { id: 'hall1-blk',   kind: 'window', o: 'h', at: 10, a: 4.0, b: 8.0, sill: 0.9, head: 2.3 },
        { id: 'km-blk',      kind: 'window', o: 'h', at: 10, a: 9.5, b: 11.5, sill: 1.5, head: 2.2 },
        { id: 'tamu-makan',  kind: 'open',   o: 'v', at: 6, a: 1.0, b: 3.0, sill: 0, head: 2.4 },
        { id: 'tamu-dapur',  kind: 'open',   o: 'v', at: 6, a: 4.5, b: 6.5, sill: 0, head: 2.4 },
        { id: 'makan-dapur', kind: 'open',   o: 'h', at: 4, a: 7.0, b: 11.0, sill: 0, head: 2.4 },
        { id: 'tamu-hall1',  kind: 'open',   o: 'h', at: 7, a: 4.0, b: 6.0, sill: 0, head: 2.4 },
        { id: 'dapur-hall1', kind: 'open',   o: 'h', at: 7, a: 6.5, b: 8.5, sill: 0, head: 2.4 },
        { id: 'tangga-masuk',kind: 'stairentry', o: 'v', at: 3, a: 9.0, b: 10.0, sill: 0, head: 2.4 },
        { id: 'hall1-km',    kind: 'door',   o: 'v', at: 9, a: 8.0, b: 9.0, sill: 0, head: 2.1, hinge: 'a', swing: 1 },
      ],
    },
    { id: 2, name: 'Lantai 2',
      rooms: [
        { id: 'void',    name: 'Void',          type: 'void',     x0: 0,    y0: 0, x1: 6,    y1: 5, nolabel: true },
        { id: 'k-utama', name: 'Kamar Utama',   type: 'bed',      x0: 6,    y0: 0, x1: 12,   y1: 3 },
        { id: 'k-utama', name: 'Kamar Utama',   type: 'bed',      x0: 6,    y0: 3, x1: 10,   y1: 5 },
        { id: 'km-utama',name: 'Kamar Mandi',   type: 'bath',     x0: 10,   y0: 3, x1: 12,   y1: 5 },
        { id: 'koridor-barat', name: 'Area Lantai 2', type: 'corridor', x0: 0, y0: 5, x1: 3, y1: 7 },
        { id: 'koridor', name: 'Area Lantai 2', type: 'corridor', x0: 3,    y0: 5, x1: 12,   y1: 6.5 },
        { id: 'void-tangga', name: 'Void Tangga', type: 'void',    x0: 0,    y0: 7, x1: 3,    y1: 10, nolabel: true },
        { id: 'k2',      name: 'Kamar Tidur 2', type: 'bed',      x0: 3,    y0: 6.5, x1: 7.5,  y1: 8 },
        { id: 'k2',      name: 'Kamar Tidur 2', type: 'bed',      x0: 5,    y0: 8, x1: 7.5,  y1: 10 },
        { id: 'km2',     name: 'Kamar Mandi',   type: 'bath',     x0: 3,    y0: 8, x1: 5,    y1: 10 },
        { id: 'k3',      name: 'Kamar Tidur 3', type: 'bed',      x0: 7.5,  y0: 6.5, x1: 12,   y1: 8 },
        { id: 'k3',      name: 'Kamar Tidur 3', type: 'bed',      x0: 7.5,  y0: 8, x1: 10,   y1: 10 },
        { id: 'km3',     name: 'Kamar Mandi',   type: 'bath',     x0: 10,   y0: 8, x1: 12,   y1: 10 },
      ],
      extras: [ { id: 'balkon', name: 'Balkon', type: 'balcony', x0: 0, y0: -BALKON_D, x1: 12, y1: 0 } ],
      openings: [
        { id: 'void-dpn',    kind: 'window', o: 'h', at: 0, a: 0.8, b: 5.2, sill: 0.1, head: 2.6 },
        { id: 'kutama-balkon',kind: 'slide', o: 'h', at: 0, a: 7.0, b: 11.0, sill: 0, head: 2.5 },
        { id: 'void-brt',    kind: 'window', o: 'v', at: 0, a: 1.0, b: 4.0, sill: 0.5, head: 2.5 },
        { id: 'koridor-brt', kind: 'window', o: 'v', at: 0, a: 5.5, b: 6.5, sill: 1.2, head: 2.4 },
        { id: 'tangga-brt2', kind: 'window', o: 'v', at: 0, a: 7.5, b: 9.5, sill: 0.5, head: 2.7 },
        { id: 'kutama-tmr',  kind: 'window', o: 'v', at: 12, a: 1.0, b: 4.0, sill: 0.5, head: 2.5 },
        { id: 'koridor-tmr', kind: 'window', o: 'v', at: 12, a: 5.5, b: 6.0, sill: 1.2, head: 2.4 },
        { id: 'k3-tmr',      kind: 'window', o: 'v', at: 12, a: 7.0, b: 9.0, sill: 0.9, head: 2.3 },
        { id: 'tangga-blk2', kind: 'window', o: 'h', at: 10, a: 0.5, b: 2.5, sill: 0.9, head: 2.3 },
        { id: 'k2-blk',      kind: 'window', o: 'h', at: 10, a: 4.0, b: 7.0, sill: 0.9, head: 2.3 },
        { id: 'k3-blk',      kind: 'window', o: 'h', at: 10, a: 8.0, b: 11.0, sill: 0.9, head: 2.3 },
        { id: 'void-rail',   kind: 'rail',   o: 'h', at: 5, a: 0.0, b: 6.0, sill: 0, head: 1.0 },
        { id: 'koridor-kutama', kind: 'door', o: 'h', at: 5, a: 8.0, b: 9.0, sill: 0, head: 2.1, hinge: 'a', swing: -1 },
        { id: 'koridor-k2',  kind: 'door',   o: 'h', at: 6.5, a: 4.0, b: 5.0, sill: 0, head: 2.1, hinge: 'a', swing: 1 },
        { id: 'koridor-k3',  kind: 'door',   o: 'h', at: 6.5, a: 9.0, b: 10.0, sill: 0, head: 2.1, hinge: 'b', swing: -1 },
        { id: 'tangga-tiba', kind: 'open',   o: 'h', at: 7, a: 0.0, b: 1.0, sill: 0, head: 2.4 },
        { id: 'tangga-rail', kind: 'rail',   o: 'h', at: 7, a: 1.0, b: 3.0, sill: 0, head: 1.0 },
        { id: 'koridor-hub', kind: 'open',   o: 'v', at: 3, a: 5.0, b: 6.5, sill: 0, head: 2.4 },
        { id: 'void-rail-tmr', kind: 'rail', o: 'v', at: 6, a: 0.0, b: 5.0, sill: 0, head: 1.0 },
        { id: 'kutama-km',   kind: 'door',   o: 'v', at: 10, a: 3.5, b: 4.5, sill: 0, head: 2.1, hinge: 'a', swing: 1 },
        { id: 'k3-km',       kind: 'door',   o: 'v', at: 10, a: 8.5, b: 9.5, sill: 0, head: 2.1, hinge: 'b', swing: -1 },
        { id: 'k2-km',       kind: 'door',   o: 'v', at: 5, a: 8.5, b: 9.5, sill: 0, head: 2.1, hinge: 'a', swing: 1 },
      ],
    },
  ],
}


export const PW = PLAN.W // 12 (lebar, sumbu x denah)
export const PD = PLAN.D // 10 (dalam, sumbu y denah)
export const FLOOR_H = PLAN.floorH // 3.2 (lantai ke lantai)
export const CEIL_H = PLAN.ceilH // 3.0 (tinggi plafon)
export const LEVEL_Y = [0, FLOOR_H] // tinggi permukaan lantai 1 & 2
const EPS = 1e-6
export const mx = (x) => PW - x // denah -> dunia (dan sebaliknya)

// ---------------------------------------------------------------------------
// Dinding turunan dari ruangan (sama dengan generator di halaman desain)
// ---------------------------------------------------------------------------
const f2 = (v) => +v.toFixed(2)
const isExt = (o, at) => (o === 'h' ? Math.abs(at) < EPS || Math.abs(at - PLAN.D) < EPS : Math.abs(at) < EPS || Math.abs(at - PLAN.W) < EPS)

function wallLines(fl) {
  const lines = {}
  const add = (o, at, s0, s1, roomId) => {
    const key = o + ':' + f2(at)
    ;(lines[key] = lines[key] || { o, at, iv: [] }).iv.push([s0, s1, roomId])
  }
  for (const r of fl.rooms) {
    add('h', r.y0, r.x0, r.x1, r.id); add('h', r.y1, r.x0, r.x1, r.id); add('v', r.x0, r.y0, r.y1, r.id); add('v', r.x1, r.y0, r.y1, r.id)
  }
  const out = []
  for (const L of Object.values(lines)) {
    // Sisi yang dibagi dua persegi dengan id yang sama (kamar yang dipecah buat
    // kamar mandi dalam) bukan dinding: buang bagian yang ditutup persegi
    // tetangga ber-id sama di sisi berlawanan garis ini. Perbandingan pakai
    // indeks (bukan nilai) supaya sisi yang identik dari persegi lain tetap
    // terbuang, sementara entri sendiri tidak mengurangi dirinya.
    const kept = []
    for (let i = 0; i < L.iv.length; i++) {
      const [s0, s1, roomId] = L.iv[i]
      let parts = [[s0, s1]]
      for (let j = 0; j < L.iv.length; j++) {
        if (j === i) continue
        const [o0, o1, oId] = L.iv[j]
        if (oId !== roomId) continue
        const next = []
        for (const [p0, p1] of parts) {
          if (o1 <= p0 + EPS || o0 >= p1 - EPS) { next.push([p0, p1]); continue }
          if (o0 > p0 + EPS) next.push([p0, Math.min(o0, p1)])
          if (o1 < p1 - EPS) next.push([Math.max(o1, p0), p1])
        }
        parts = next
        if (!parts.length) break
      }
      for (const [p0, p1] of parts) if (p1 - p0 > EPS) kept.push([p0, p1])
    }
    kept.sort((p, q) => p[0] - q[0])
    let cur = null
    for (const [s0, s1] of kept) {
      if (cur && s0 <= cur[1] + EPS) cur[1] = Math.max(cur[1], s1)
      else { if (cur) out.push({ o: L.o, at: L.at, s0: cur[0], s1: cur[1] }); cur = [s0, s1] }
    }
    if (cur) out.push({ o: L.o, at: L.at, s0: cur[0], s1: cur[1] })
  }
  return out
}

export function wallPieces(fl) {
  const res = []
  for (const seg of wallLines(fl)) {
    const ext = isExt(seg.o, seg.at), t = ext ? PLAN.tExt : PLAN.tInt
    const ops = fl.openings.filter((p) => p.o === seg.o && Math.abs(p.at - seg.at) < EPS && p.a >= seg.s0 - EPS && p.b <= seg.s1 + EPS).sort((p, q) => p.a - q.a)
    let cur = seg.s0
    const push = (s0, s1, kind, op) => {
      const a = Math.abs(s0 - seg.s0) < EPS ? s0 - t / 2 : s0
      const b = Math.abs(s1 - seg.s1) < EPS ? s1 + t / 2 : s1
      res.push({ o: seg.o, at: seg.at, s0: a, s1: b, t, ext, kind, op, rawS0: s0, rawS1: s1 })
    }
    for (const op of ops) { if (op.a > cur + EPS) push(cur, op.a, 'solid'); push(op.a, op.b, op.kind, op); cur = op.b }
    if (seg.s1 > cur + EPS) push(cur, seg.s1, 'solid')
  }
  return res
}

// ---------------------------------------------------------------------------
// Ruangan (buat badge nama ruangan) & emoji
// ---------------------------------------------------------------------------
const EMOJI = { living: '🛋️', bed: '🛏️', kitchen: '🍳', dining: '🍽️', bath: '🚿', stair: '🪜', hall: '🚪', corridor: '🚪', lounge: '📺', void: '🪜', balcony: '🌴', porch: '🌴' }
const ROOMS = PLAN.floors.flatMap((fl, li) => [...fl.rooms, ...(fl.extras || [])].map((r) => ({ ...r, level: li, emoji: EMOJI[r.type] || '🏠' })))
// Nama kamar tidur dibuat jelas di badge
const inRect = (r, x, y) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1

// Level lantai dari tinggi kaki. Tangga dipisah di 1.7 m: lengan 1 & bordes
// (<= 1.6 m) dihitung lantai 1, lengan 2 (>= 1.8 m) dihitung lantai 2.
export const levelOf = (feetY) => (feetY >= 1.7 ? 1 : 0)

// koordinat DUNIA (X, Z, y kaki) -> ruangan
export function roomAt(X, Z, feetY = 0) {
  const x = mx(X), y = Z, lv = levelOf(feetY)
  // ruangan lantai lain yang tumpang tindih (void / tangga) dipilih sesuai level
  const cand = ROOMS.filter((r) => r.level === lv && inRect(r, x, y))
  if (!cand.length) return null
  const pick = cand.find((r) => r.type !== 'void' && r.type !== 'hall') || cand[0]
  if (pick.type === 'void') return { id: 'tangga', name: 'Tangga', emoji: '🪜' }
  if (pick.type === 'hall') return { id: pick.id, name: lv === 0 ? 'Ruang Tamu' : 'Hall Tangga', emoji: lv === 0 ? '🛋️' : '🚪' }
  return { id: pick.id, name: pick.name, emoji: pick.emoji }
}

// ---------------------------------------------------------------------------
// Pintu yang bisa dibuka (koordinat denah). Pintu depan tetap tertutup
// (keluar lewat pop up "Keluar rumah").
// ---------------------------------------------------------------------------
const DOOR_NAMES = {
  'hall1-km': 'Pintu Kamar Mandi', 'koridor-kutama': 'Pintu Kamar Utama',
  'koridor-k2': 'Pintu Kamar Tidur 2', 'koridor-k3': 'Pintu Kamar Tidur 3',
  'kutama-km': 'Pintu Kamar Mandi Utama', 'k2-km': 'Pintu Kamar Mandi 2', 'k3-km': 'Pintu Kamar Mandi 3',
}
export const DOORS = PLAN.floors.flatMap((fl, li) =>
  fl.openings
    .filter((o) => DOOR_NAMES[o.id])
    .map((o) => ({
      id: o.id, name: DOOR_NAMES[o.id], level: li, y0: LEVEL_Y[li],
      axis: o.o === 'h' ? 'x' : 'z', at: o.at, pos: (o.a + o.b) / 2, w: o.b - o.a,
      hinge: o.hinge === 'a' ? 'start' : 'end', swing: o.swing,
    }))
)
export const DOOR_RANGE = 1.5
export const FRONT_DOOR = { x: 5.0, y: 0, w: 1.0 } // denah (x, y), tengah pintu-utama
export const EXIT_RANGE = 2.0
export const WIN_KINDS = ['window']

function wrapAngle(a) { let r = a; while (r > Math.PI) r -= Math.PI * 2; while (r <= -Math.PI) r += Math.PI * 2; return r }

// Letak engsel & sudut ayun daun pintu, DALAM KOORDINAT DENAH (dipakai gambar
// di dalam grup yang dicerminkan). Rumusnya sama dengan doorPlacement() di houseInterior.js.
export function doorPlacement(d) {
  const start = d.pos - d.w / 2, end = d.pos + d.w / 2
  const hingeAt = d.hinge === 'start' ? start : end
  const dir = d.hinge === 'start' ? 1 : -1
  let hx, hz, cdx, cdz, odx, odz
  if (d.axis === 'x') { hx = hingeAt; hz = d.at; cdx = dir; cdz = 0; odx = 0; odz = d.swing }
  else { hx = d.at; hz = hingeAt; cdx = 0; cdz = dir; odx = d.swing; odz = 0 }
  const closedRot = Math.atan2(-cdz, cdx)
  const openRot = closedRot + wrapAngle(Math.atan2(-odz, odx) - closedRot)
  // ruas yang ditutup daun pintu (koordinat denah)
  const seg = d.axis === 'x' ? { x1: start, z1: d.at, x2: end, z2: d.at } : { x1: d.at, z1: start, x2: d.at, z2: end }
  return { hx, hz, closedRot, openRot, seg }
}

const doorCenterPlan = (d) => (d.axis === 'x' ? { x: d.pos, y: d.at } : { x: d.at, y: d.pos })

// koordinat DUNIA -> pintu terdekat yang dihadapi (hanya pintu di lantai yang sama)
export function nearestDoor(X, Z, yaw, feetY = 0) {
  const x = mx(X), y = Z, lv = levelOf(feetY)
  const fx = yaw === undefined ? 0 : -Math.sin(yaw) // arah hadap dalam koordinat denah (x dicerminkan)
  const fy = yaw === undefined ? 0 : Math.cos(yaw)
  let best = null, bestScore = Infinity
  for (const d of DOORS) {
    if (d.level !== lv) continue
    const c = doorCenterPlan(d), dx = c.x - x, dy = c.y - y, dist = Math.hypot(dx, dy)
    if (dist >= DOOR_RANGE) continue
    const facing = dist > 0.05 ? (fx * dx + fy * dy) / dist : 0
    const score = dist - 0.5 * facing
    if (score < bestScore) { bestScore = score; best = d }
  }
  return best
}

export function inDoorway(d, X, Z) {
  const x = mx(X), y = Z, c = doorCenterPlan(d)
  const along = d.axis === 'x' ? Math.abs(x - c.x) : Math.abs(y - c.y)
  const across = d.axis === 'x' ? Math.abs(y - c.y) : Math.abs(x - c.x)
  return across < 0.6 && along < d.w / 2 + 0.2
}

export function distToExit(X, Z, feetY = 0) {
  if (levelOf(feetY) !== 0) return Infinity
  return Math.hypot(mx(X) - FRONT_DOOR.x, Z - FRONT_DOOR.y)
}

// ---------------------------------------------------------------------------
// Tangga L: 16 anak tangga, 2 lengan tegak lurus + bordes di sudut.
// Lengan 1 (utara, y 9..10): naik ke barat, x 3 -> 1. Bordes (x 0..1, y 9..10).
// Lengan 2 (barat, x 0..1): naik ke selatan, y 9 -> 7, tiba di lantai 2.
// ---------------------------------------------------------------------------
const ST = PLAN.stair
const RISE = PLAN.floorH / ST.steps
const LAND_H = ST.treadsPerFlight * RISE // 1.6 (tinggi bordes)
export const STAIR = { ...ST, rise: RISE, landH: LAND_H }

// tinggi anak tangga di titik (x,y) denah, atau null kalau di luar kotak tangga
export function stairHeight(x, y) {
  if (x < ST.x0 || x > ST.x1 || y < ST.y0 || y > ST.y1) return null
  if (x <= 1 && y >= 9) return LAND_H // bordes
  if (y >= 9) { // lengan 1 (utara), naik ke barat
    const i = Math.min(ST.treadsPerFlight, Math.floor((ST.x1 - x) / ST.tread) + 1)
    return i * RISE
  }
  if (x <= 1) { // lengan 2 (barat), naik ke selatan
    const j = Math.min(ST.treadsPerFlight, Math.floor((9 - y) / ST.tread) + 1)
    return (ST.treadsPerFlight + j) * RISE
  }
  return null // kolong lengan (ruang kosong di bawah lengan 2): bukan pijakan
}
const inStairBox = (x, y) => x >= ST.x0 && x <= ST.x1 && y >= ST.y0 && y <= ST.y1

// ---------------------------------------------------------------------------
// Bidang lantai (untuk groundY): satu per level, tanpa void & kotak tangga
// ---------------------------------------------------------------------------
const FLOOR_RECTS = PLAN.floors.map((fl) => [...fl.rooms.filter((r) => r.type !== 'void' && r.type !== 'stair'), ...(fl.id === 2 ? fl.extras || [] : [])])

function levelSurface(li, x, y) {
  for (const r of FLOOR_RECTS[li]) if (inRect(r, x, y)) return LEVEL_Y[li]
  return null
}

// ---------------------------------------------------------------------------
// Dunia tabrakan interior (API sama dengan buildInteriorWorld di houseInterior.js)
// ---------------------------------------------------------------------------
const WALL_Y = [[0, CEIL_H], [FLOOR_H, FLOOR_H + CEIL_H]]

function collisionWalls() {
  const walls = [] // koordinat denah: { x1,z1,x2,z2, lv, y0, y1 }
  PLAN.floors.forEach((fl, li) => {
    for (const p of wallPieces(fl)) {
      const solid = ['solid', 'window', 'entry', 'rail'].includes(p.kind) || (p.kind === 'door' && !DOOR_NAMES[p.op.id])
      if (!solid) continue
      const a = p.rawS0, b = p.rawS1
      const w = p.o === 'h' ? { x1: a, z1: p.at, x2: b, z2: p.at } : { x1: p.at, z1: a, x2: p.at, z2: b }
      walls.push({ ...w, lv: li, y0: WALL_Y[li][0], y1: p.kind === 'rail' ? WALL_Y[li][0] + 1.1 : WALL_Y[li][1] })
    }
  })
  // sekat di bawah lengan tangga (biar gak bisa nyelip ke kolong lengan 1 & 2)
  walls.push({ x1: 1, z1: 7, x2: 1, z2: 9, lv: 0, y0: 0, y1: CEIL_H })
  walls.push({ x1: 1, z1: 9, x2: 3, z2: 9, lv: 0, y0: 0, y1: CEIL_H })
  // pagar balkon (lantai 2)
  const by = FLOOR_H
  walls.push({ x1: 0, z1: -BALKON_D, x2: PW, z2: -BALKON_D, lv: 1, y0: by, y1: by + 1.1 })
  walls.push({ x1: 0, z1: -BALKON_D, x2: 0, z2: 0, lv: 1, y0: by, y1: by + 1.1 })
  walls.push({ x1: PW, z1: -BALKON_D, x2: PW, z2: 0, lv: 1, y0: by, y1: by + 1.1 })
  return walls
}

// ke koordinat dunia (cerminkan x)
const toWorld = (w) => ({ ...w, x1: mx(w.x1), x2: mx(w.x2) })

export function buildLpmInteriorWorld({ isDoorOpen = () => false } = {}) {
  const walls = collisionWalls().map(toWorld)
  const wallsByLevel = [walls.filter((w) => w.lv === 0), walls.filter((w) => w.lv === 1)]
  const leaves = DOORS.map((d) => {
    const s = doorPlacement(d).seg
    return { id: d.id, lv: d.level, y0: LEVEL_Y[d.level], y1: LEVEL_Y[d.level] + 2.1, seg: toWorld(s) }
  })
  let sig = null, cache = [walls, [], []]
  function active(lv) {
    let s = ''
    for (const d of leaves) s += isDoorOpen(d.id) ? '1' : '0'
    if (s !== sig) {
      sig = s
      const closed = leaves.filter((d) => !isDoorOpen(d.id))
      cache = [0, 1].map((l) => wallsByLevel[l].concat(closed.filter((d) => d.lv === l).map((d) => ({ ...d.seg, lv: l, y0: d.y0, y1: d.y1 }))))
    }
    return cache[lv]
  }

  const state = { feetY: 0 }
  const W = PW, D = PD

  // `yMax` dari pemanggil kadang cuma "kaki + 0.6" (pemain) dan kadang jauh
  // lebih tinggi (kamera: kamera + 3). Dibatasi ke level pemain sendiri supaya
  // kamera di lantai 1 gak menganggap lantai 2 sebagai tanah.
  function surfaceAt(X, Z, yMax) {
    const x = mx(X), y = Z
    const cap = Math.min(yMax, state.feetY + 0.65)
    let best = null
    const consider = (h) => { if (h !== null && h <= cap + 1e-6 && (best === null || h > best)) best = h }
    const sh = stairHeight(x, y)
    if (inStairBox(x, y)) consider(sh)
    else consider(levelSurface(0, x, y))
    // lantai 2 (termasuk balkon). Di kotak tangga tidak ada lantai (void).
    if (!inStairBox(x, y)) consider(levelSurface(1, x, y))
    return best
  }

  function resolveWalls(x, z, feetY, radius) {
    state.feetY = feetY
    let hit = false
    const list = active(levelOf(feetY))
    for (let iter = 0; iter < 4; iter++) {
      let moved = false
      for (const w of list) {
        const ex = w.x2 - w.x1, ez = w.z2 - w.z1
        const len2 = ex * ex + ez * ez
        let t = len2 > 0 ? ((x - w.x1) * ex + (z - w.z1) * ez) / len2 : 0
        t = t < 0 ? 0 : t > 1 ? 1 : t
        const px = w.x1 + ex * t, pz = w.z1 + ez * t
        let dx = x - px, dz = z - pz
        const d2 = dx * dx + dz * dz
        if (d2 >= radius * radius) continue
        const d = Math.sqrt(d2)
        if (d > 1e-6) { dx /= d; dz /= d } else { const l = Math.sqrt(len2) || 1; dx = -ez / l; dz = ex / l }
        x = px + dx * radius; z = pz + dz * radius
        moved = true; hit = true
      }
      if (!moved) break
    }
    return { x, z, hit }
  }

  return {
    bounds: { minX: -0.5, maxX: W + 0.5, minZ: -(BALKON_D + 0.2), maxZ: D + 0.5 },
    waterLevel: -100,
    walls,
    state,
    groundY: (X, Z, yMax = Infinity) => surfaceAt(X, Z, yMax),
    // tanpa pembatas level (dipakai bayangan pemain lain, yang bisa beda lantai)
    groundYAny: (X, Z, yMax = Infinity) => {
      const keep = state.feetY
      state.feetY = Math.max(0, yMax - 0.6)
      const r = surfaceAt(X, Z, yMax)
      state.feetY = keep
      return r
    },
    resolveWalls,
    castWalls2D(ox, oz, ex, ez, yLow = -Infinity, yHigh = Infinity) {
      const dx = ex - ox, dz = ez - oz
      let best = 1
      const lv = levelOf(state.feetY)
      for (const w of active(lv)) {
        if (w.y1 < yLow || w.y0 > yHigh) continue
        const sx = w.x2 - w.x1, sz = w.z2 - w.z1
        const denom = dx * sz - dz * sx
        if (denom > -1e-9 && denom < 1e-9) continue
        const t = ((w.x1 - ox) * sz - (w.z1 - oz) * sx) / denom
        const u = ((w.x1 - ox) * dz - (w.z1 - oz) * dx) / denom
        if (t >= 0 && t < best && u >= 0 && u <= 1) best = t
      }
      return best
    },
    clearanceAt: () => 99,
    insideBuilding: () => false,
    isWaterXZ: () => false,
    findSpawn: () => ({ x: mx(FRONT_DOOR.x), y: 0, z: 1.3 }),
  }
}

// Batas tinggi kamera mengikuti plafon lantai yang lagi dipijak. Dibaca
// TownWalk.jsx lewat `camPreset.maxY` tiap frame, jadi dibuat getter.
export function makeLpmInteriorCam(world) {
  return {
    pitch: 0.2, dist: 3.2, minPitch: 0.03, maxPitch: 0.5,
    get maxY() { return levelOf(world.state.feetY) === 0 ? CEIL_H - 0.3 : FLOOR_H + CEIL_H - 0.3 },
  }
}

// ---------------------------------------------------------------------------
// Geometri statis (kotak berwarna) -- murni data, digambar jadi SATU mesh oleh
// HouseInteriorLpm.jsx (vertex color), jadi ringan di HP.
// Kotak: { x0, y0, h0, x1, y1, h1, c } -> koordinat denah (x, y) + tinggi (h), c = warna hex.
// ---------------------------------------------------------------------------
const C = {
  wall: 0xf2f0eb, ceil: 0xf6f5f1, tile: 0xd8d5cf, tileDark: 0x8d9aa1, wood: 0xc9a06c, oak: 0xb48a58, teak: 0x6b4423, steel: 0x2d3135,
  steelLight: 0xc9ccce, charcoal: 0x3d4248, fabric: 0x5b636a, beige: 0xbdac8c, linen: 0xe9e5dc, blanket: 0x6c757c, white: 0xf7f7f5, black: 0x15171a,
  fridge: 0xb9bec2, porcelain: 0xfbfbfb, pot: 0x575c60, leaf: 0x2f6a30, rug: 0xa39e92, balcony: 0xa9adad, stairBody: 0xe9e7e1, marble: 0xe8e4dc,
}
const FLOOR_COLOR = { living: C.tile, dining: C.tile, kitchen: C.tile, hall: C.tile, stair: C.tile, bath: C.tileDark, bed: C.wood, corridor: C.wood, lounge: C.wood }

export function buildStaticBoxes(opts = {}) {
  // opts.exterior: cuma kulit luar rumah (dinding, jendela, pelat, balkon) buat
  // dipasang di peta; tanpa tangga dan lantai tiap ruangan.
  const ext = !!opts.exterior
  const solid = [], glass = []
  const B = (list, x0, y0, h0, x1, y1, h1, c) => {
    if (Math.abs(x1 - x0) < 1e-4 || Math.abs(y1 - y0) < 1e-4 || Math.abs(h1 - h0) < 1e-4) return
    list.push({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), y0: Math.min(y0, y1), y1: Math.max(y0, y1), h0: Math.min(h0, h1), h1: Math.max(h0, h1), c })
  }
  const S = (...a) => B(solid, ...a)
  const G = (...a) => B(glass, ...a)
  const sx = PLAN.stair

  PLAN.floors.forEach((fl, li) => {
    const z = LEVEL_Y[li]
    // ---- lantai ruangan ----
    for (const r of fl.rooms) {
      if (r.type === 'void' || r.type === 'stair') continue
      if (!ext) S(r.x0, r.y0, z - 0.02, r.x1, r.y1, z + 0.004, FLOOR_COLOR[r.type] || C.tile)
    }
    if (ext && li === 0) S(0, 0, z - 0.02, PLAN.W, PLAN.D, z + 0.004, C.tile)
    // ---- dinding & bukaan ----
    for (const p of wallPieces(fl)) {
      const hw = p.t / 2, a = p.s0, b = p.s1
      const wb = (s0, s1, h0, h1, c = C.wall) => (p.o === 'h' ? S(s0, p.at - hw, z + h0, s1, p.at + hw, z + h1, c) : S(p.at - hw, s0, z + h0, p.at + hw, s1, z + h1, c))
      const wg = (s0, s1, h0, h1, th = 0.02) => (p.o === 'h' ? G(s0, p.at - th / 2, z + h0, s1, p.at + th / 2, z + h1) : G(p.at - th / 2, s0, z + h0, p.at + th / 2, s1, z + h1))
      const wf = (s0, s1, h0, h1, c = C.steel, th = 0.12) => (p.o === 'h' ? S(s0, p.at - th / 2, z + h0, s1, p.at + th / 2, z + h1, c) : S(p.at - th / 2, s0, z + h0, p.at + th / 2, s1, z + h1, c))
      if (p.kind === 'solid') { wb(a, b, 0, CEIL_H); continue }
      const op = p.op, ra = p.rawS0, rb = p.rawS1
      if (op.sill > 0.001) wb(a, b, 0, op.sill)
      if (op.head < CEIL_H - 0.001 && p.kind !== 'rail') wb(a, b, op.head, CEIL_H)
      if (p.kind === 'rail') {
        wf(ra, rb, 0, 0.1, C.steel, 0.06); wg(ra, rb, 0.1, 1.0, 0.03); wf(ra - 0.02, rb + 0.02, 1.0, 1.06, C.teak, 0.07)
      } else if (p.kind === 'window') {
        wg(ra, rb, op.sill, op.head); const fr = 0.06
        wf(ra, rb, op.sill, op.sill + fr); wf(ra, rb, op.head - fr, op.head); wf(ra, ra + fr, op.sill, op.head); wf(rb - fr, rb, op.sill, op.head)
        const n = Math.max(1, Math.round((rb - ra) / 1.5)); for (let i = 1; i < n; i++) { const m = ra + ((rb - ra) * i) / n; wf(m - 0.03, m + 0.03, op.sill, op.head, C.steel, 0.1) }
      } else if (p.kind === 'slide') { // pintu geser balkon: separuh kaca, separuh terbuka
        const mid = (ra + rb) / 2, fr = 0.06
        wg(ra, mid, 0, op.head); wf(ra, mid, 0, fr); wf(ra, mid, op.head - fr, op.head); wf(ra, ra + fr, 0, op.head); wf(mid - fr, mid, 0, op.head)
        wf(ra, rb, op.head - fr, op.head); wf(rb - fr, rb, 0, op.head)
      } else if (p.kind === 'door' || p.kind === 'entry') {
        const fr = 0.05; wf(ra, ra + fr, 0, op.head, C.white, 0.14); wf(rb - fr, rb, 0, op.head, C.white, 0.14); wf(ra, rb, op.head - fr, op.head, C.white, 0.14)
        if (!DOOR_NAMES[op.id]) wf(ra + fr, rb - fr, 0, op.head - fr, p.kind === 'entry' ? C.teak : C.oak, 0.05) // pintu tetap tertutup
      } else if (p.kind === 'open' || p.kind === 'stairentry') {
        // hanya penutup di atas bukaan (sudah dibuat di atas)
      }
    }
    // ---- plafon / pelat di atas level ini ----
    const top = z + CEIL_H
    if (li === 0) {
      // Pelat lantai 2, menutup seluruh tapak KECUALI void (x 0..6, y 0..5)
      // dan kotak tangga (x 0..3, y 7..10). Pelat-pelat tidak tumpang tindih
      // (biar tidak z-fighting); strip tipis menutup atas dinding luar di
      // tepi void & kotak tangga supaya tidak ada celah 0.2 m di dinding.
      S(6, -0.1, top, PLAN.W + 0.1, PLAN.D + 0.1, top + 0.2, C.ceil) // timur
      S(3, 5, top, 6, PLAN.D + 0.1, top + 0.2, C.ceil) // tengah
      S(0, 5, top, 3, 7, top + 0.2, C.ceil) // selatan kotak tangga
      S(-0.1, -0.1, top, 6, 0.1, top + 0.2, C.ceil) // atas dinding depan (void)
      S(-0.1, 0.1, top, 0.1, 5, top + 0.2, C.ceil) // atas dinding barat (void)
      S(-0.1, 7, top, 0.1, PLAN.D + 0.1, top + 0.2, C.ceil) // atas dinding barat (tangga)
      S(0.1, 9.9, top, 3, PLAN.D + 0.1, top + 0.2, C.ceil) // atas dinding belakang (tangga)
      // lantai papan di atas pelat (lantai 2)
      if (!ext) for (const r of PLAN.floors[1].rooms) { if (r.type === 'void') continue; S(r.x0, r.y0, top + 0.2, r.x1, r.y1, top + 0.205, FLOOR_COLOR[r.type] || C.tile) }
    } else {
      // atap datar modern dengan parapet
      S(-0.45, -0.45, top, PLAN.W + 0.45, PLAN.D + 0.45, top + 0.25, C.ceil)
      S(-0.45, -0.45, top + 0.25, PLAN.W + 0.45, -0.33, top + 0.6, C.white); S(-0.45, PLAN.D + 0.33, top + 0.25, PLAN.W + 0.45, PLAN.D + 0.45, top + 0.6, C.white)
      if (ext) { // tutup atap: list charcoal di atas parapet + pelat atap rapat
        S(-0.47, -0.47, top + 0.6, PLAN.W + 0.47, -0.31, top + 0.66, C.charcoal); S(-0.47, PLAN.D + 0.31, top + 0.6, PLAN.W + 0.47, PLAN.D + 0.47, top + 0.66, C.charcoal)
        S(-0.45, -0.33, top + 0.25, -0.33, PLAN.D + 0.33, top + 0.3, C.white); S(PLAN.W + 0.33, -0.33, top + 0.25, PLAN.W + 0.45, PLAN.D + 0.33, top + 0.3, C.white)
      }
    }
  })
  // ---- balkon (lantai 2, selebar fasad) ----
  const zb = LEVEL_Y[1]
  S(-0.1, -BALKON_D, zb - 0.2, PLAN.W + 0.1, -0.1, zb, C.ceil); S(0, -BALKON_D, zb, PLAN.W, -0.1, zb + 0.005, C.balcony)
  S(-0.1, -BALKON_D, zb - 0.2, PLAN.W + 0.1, -(BALKON_D - 0.06), zb, C.charcoal)
  const brail = (x0, y0, x1, y1) => { S(x0 - 0.03, y0 - 0.03, zb, x1 + 0.03, y1 + 0.03, zb + 0.08, C.steel); G(x0 - 0.01, y0 - 0.01, zb + 0.08, x1 + 0.01, y1 + 0.01, zb + 1.0); S(x0 - 0.035, y0 - 0.035, zb + 1.0, x1 + 0.035, y1 + 0.035, zb + 1.06, C.teak) }
  const rz = -(BALKON_D - 0.05) // pagar depan, sedikit di dalam tepi pelat
  brail(0.03, rz, PLAN.W - 0.03, rz); brail(0.03, rz, 0.03, -0.1); brail(PLAN.W - 0.03, rz, PLAN.W - 0.03, -0.1)
  // ---- kulit luar: pondasi & teras (hanya tampak luar) ----
  if (ext) {
    S(-0.12, -0.12, -1.2, PLAN.W + 0.12, PLAN.D + 0.12, 0.0, C.charcoal)
    const pr = PLAN.floors[0].extras[0] // teras
    S(pr.x0, pr.y0, -0.4, pr.x1, 0, 0.06, C.balcony); S(pr.x0 - 0.2, pr.y0 - 0.25, -0.4, pr.x1 + 0.2, pr.y0, 0.0, C.balcony)
  }
  // ---- tangga L ----
  if (!ext) {
    const n = sx.treadsPerFlight, T = sx.tread
    const step = (x0, x1, y0, y1, i) => { const top = i * RISE; S(x0, y0, top - 0.32, x1, y1, top, C.stairBody); S(x0, y0, top - 0.04, x1 + 0.03, y1, top + 0.01, C.oak) }
    // lengan 1 (utara, y 9..10): naik ke barat, x 3 -> 1
    for (let i = 1; i <= n; i++) step(sx.x1 - i * T, sx.x1 - (i - 1) * T, 9, 10, i)
    // bordes (x 0..1, y 9..10)
    step(0, 1, 9, 10, n)
    // lengan 2 (barat, x 0..1): naik ke selatan, y 9 -> 7
    for (let j = n + 1; j <= 2 * n; j++) { const k = j - n; step(0, 1, 9 - k * T, 9 - (k - 1) * T, j) }
    // pegangan: di sisi terbuka tiap lengan (lengan 1: sisi selatan y=9; lengan 2: sisi timur x=1)
    for (let i = 1; i <= n; i++) S(sx.x1 - i * T, 9 - 0.03, i * RISE + 0.9, sx.x1 - (i - 1) * T, 9 + 0.03, i * RISE + 0.96, C.teak)
    for (let i = 1; i <= n; i += 2) S(sx.x1 - i * T - 0.02, 9 - 0.02, i * RISE, sx.x1 - i * T + 0.02, 9 + 0.02, i * RISE + 0.92, C.steel)
    for (let j = n + 1; j <= 2 * n; j++) { const k = j - n; S(1 - 0.03, 9 - k * T, j * RISE + 0.9, 1 + 0.03, 9 - (k - 1) * T, j * RISE + 0.96, C.teak) }
  }
  return { solid, glass }
}

export const LPM_STAIR_RISE = RISE
