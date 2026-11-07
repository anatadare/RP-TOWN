// Interior fasilitas kota prosedural — denah + perabot + fisika.
//
// Murni JavaScript (tanpa three.js), sama seperti houseInteriorLpm.js, supaya
// bisa dites di Node. Yang menggambar ada di components/FacilityInterior.jsx.
//
// BEDA DENGAN RUMAH LPM: denah fasilitas TIDAK dicerminkan. Eksterior
// fasilitas dibangun axis-aligned di frame lokal (x -> timur, y -> selatan,
// z ke atas), jadi koordinat denah = koordinat lokal fasilitas:
//   plan (x, y) -> lokal (x, y), lantai z = fz + h.
// Interior diposisikan di dunia lewat transform backdrop di TownWalk.jsx
// (facilityBackdropTransform): plan (0,0) = sudut (x0, y0) rect fasilitas.
//
// FORMAT PLAN:
//   { id, name, w, d, floorH, entry: { x, w },   // entry = pintu depan di y=0
//     floors: [ { rooms: [{id,name,type,x0,y0,x1,y1}], doors: [{id,name,o,at,a,b}] } ],
//     stairs: { x0,y0,x1,y1, dir: 'E'|'W'|'N'|'S' } | null }  // tangga lurus, naik 1 lantai
//   - rooms: persegi yang menutupi tapak (tanpa tumpang tindih, tanpa celah).
//   - doors: celah pintu di dinding sekat antar ruangan. o='h' -> dinding
//     horizontal di y=at, dari x=a..b; o='v' -> dinding vertikal di x=at,
//     dari y=a..b. Pintu yang didaftar di sini BISA dibuka (daun pintu).
//   - Dinding luar: keliling penuh (t=0.2) + jendela pita kaca (sill 0.9,
//     head 2.4) di semua sisi kecuali celah entry. Dinding sekat: antar
//     ruangan yang berbagi sisi, dengan celah dari `doors`.
//   - Perabot digambar otomatis per tipe ruangan (lihat FURNITURE di bawah).
//
// Fisika (buildFacilityInteriorWorld): API sama dengan buildLpmInteriorWorld
// (bounds, groundY, resolveWalls, castWalls2D, findSpawn, ...). Tabrakan hanya
// dinding + daun pintu tertutup (perabot visual saja — sama seperti rumah).

export const FLOOR_H_DEFAULT = 3.4

const C = {
  wall: 0xf2f0eb, ceil: 0xf6f5f1, tile: 0xd8d5cf, tileDark: 0x8d9aa1,
  wood: 0xc9a06c, oak: 0xb48a58, teak: 0x6b4423, steel: 0x2d3135,
  steelLight: 0xc9ccce, charcoal: 0x3d4248, fabric: 0x5b636a, beige: 0xbdac8c,
  linen: 0xe9e5dc, blanket: 0x6c757c, white: 0xf7f7f5, black: 0x15171a,
  fridge: 0xb9bec2, porcelain: 0xfbfbfb, pot: 0x575c60, leaf: 0x2f6a30,
  rug: 0xa39e92, counter: 0x7a6a55, glassBlue: 0xa9cfdf,
  bedFrame: 0x4a5560, mattress: 0xe8e8e8, pillow: 0xffffff, sheetBlue: 0x7fa8c9,
  sheetGreen: 0x8fb573, deskTop: 0xd8c9a8, chairSeat: 0x374151, screen: 0x1f2937,
  shelfWood: 0x8a6d4b, goodsRed: 0xc0392b, goodsYellow: 0xf1c40f, goodsGreen: 0x27ae60,
  goodsBlue: 0x2980b9, goodsOrange: 0xe67e22, stallRed: 0xb03a2e, stallGreen: 0x1e8449,
  stallBlue: 0x1f618d, stallYellow: 0xb7950b, safeSteel: 0x5d6d7e, gold: 0xd4ac0d,
  curtain: 0x5dade2, sinkSteel: 0xbdc3c7, toiletWhite: 0xfbfbfb, plantGreen: 0x229954,
  sofaBlue: 0x2e86c1, sofaGrey: 0x707b7c, boardWhite: 0xf8f9f9, boardFrame: 0x7f8c8d,
  tireBlack: 0x1c1c1c, liftYellow: 0xf4d03f, crateWood: 0xa67c52, barrelBlue: 0x2471a3,
  barrelRed: 0x922b21, neonPink: 0xe84393, neonCyan: 0x00cec9, neonYellow: 0xfdcb6e,
}
const FLOOR_COLOR = {
  lobby: C.tile, office: C.wood, ward: C.tile, er: C.tile, pharmacy: C.tile,
  vault: C.tileDark, shop: C.tile, class: C.wood, market: C.tile, cell: C.tileDark,
  garage: C.tileDark, bath: C.tileDark, hall: C.tile, storage: C.tileDark,
  cafeteria: C.tile, lab: C.tile, library: C.wood, aula: C.wood, meeting: C.wood,
  counter: C.tile, waiting: C.tile, training: C.wood, archive: C.tileDark,
  corridor: C.tile, radiology: C.tileDark, surgery: C.tile, icu: C.tile,
  interrogation: C.tileDark, evidence: C.tileDark, court: C.wood,
}
const EMOJI = {
  lobby: '🏛️', office: '💼', ward: '🛏️', er: '🚑', pharmacy: '💊', vault: '🏦',
  shop: '🛍️', class: '🎓', market: '🧺', cell: '🔒', garage: '🚗', bath: '🚻',
  hall: '🪑', storage: '📦', cafeteria: '🍽️', lab: '🔬', library: '📚', aula: '🎤',
  meeting: '🗣️', counter: '🧾', waiting: '🪑', training: '🖥️', archive: '🗄️',
  corridor: '🚪', radiology: '🩻', surgery: '🔪', icu: '🫀', interrogation: '🕵️',
  evidence: '🔐', court: '⚖️', stair: '🪜',
}
const EPS = 1e-6

// ---------------------------------------------------------------------------
// Perabot per tipe ruangan. f(rect, z, add) -> add(x0,y0,h0,x1,y1,h1,c) kotak.
// Semua ukuran meter; furnitur menempel lantai ruangan (z = permukaan lantai).
// ---------------------------------------------------------------------------
function bed(add, x, y, z, rot = 0) {
  // ranjang pasien 2.0 x 0.9, kepala di -y (rot 0) atau -x (rot 1)
  const w = rot ? 0.9 : 2.0, d = rot ? 2.0 : 0.9
  add(x, y, z, x + w, y + d, z + 0.45, C.bedFrame)
  add(x + 0.05, y + 0.05, z + 0.45, x + w - 0.05, y + d - 0.05, z + 0.58, C.mattress)
  const px = rot ? x + 0.1 : x + 0.08, py = rot ? y + 0.08 : y + 0.08
  add(px, py, z + 0.58, px + (rot ? 0.7 : 0.5), py + (rot ? 0.5 : 0.7), z + 0.68, C.pillow)
  add(x + 0.05, y + d * 0.45, z + 0.58, x + w - 0.05, y + d - 0.05, z + 0.63, C.sheetBlue)
}
function desk(add, x, y, z, withScreen = true) {
  add(x, y, z, x + 1.4, y + 0.7, z + 0.75, C.deskTop)
  add(x + 0.05, y + 0.05, z, x + 0.15, y + 0.65, z + 0.72, C.charcoal)
  add(x + 1.25, y + 0.05, z, x + 1.35, y + 0.65, z + 0.72, C.charcoal)
  if (withScreen) {
    add(x + 0.5, y + 0.15, z + 0.75, x + 1.0, y + 0.2, z + 1.1, C.screen)
    add(x + 0.7, y + 0.1, z + 0.75, x + 0.8, y + 0.25, z + 0.78, C.steel)
  }
  // kursi
  add(x + 0.45, y + 0.9, z, x + 0.95, y + 1.3, z + 0.45, C.chairSeat)
  add(x + 0.45, y + 1.25, z + 0.45, x + 0.95, y + 1.32, z + 0.95, C.chairSeat)
}
function shelf(add, x, y, z, len = 2, alongX = true) {
  const w = alongX ? len : 0.5, d = alongX ? 0.5 : len
  add(x, y, z, x + w, y + d, z + 2.0, C.shelfWood)
  const goods = [C.goodsRed, C.goodsYellow, C.goodsGreen, C.goodsBlue, C.goodsOrange]
  for (let i = 0; i < Math.floor(len / 0.6); i++) {
    const gx = alongX ? x + 0.1 + i * 0.6 : x + 0.05
    const gy = alongX ? y + 0.05 : y + 0.1 + i * 0.6
    add(gx, gy, z + 0.5, gx + (alongX ? 0.45 : 0.4), gy + (alongX ? 0.4 : 0.45), z + 0.85, goods[i % goods.length])
    add(gx, gy, z + 1.1, gx + (alongX ? 0.45 : 0.4), gy + (alongX ? 0.4 : 0.45), z + 1.45, goods[(i + 2) % goods.length])
  }
}
function counter(add, x, y, z, len = 3, c = C.counter) {
  add(x, y, z, x + len, y + 0.6, z + 1.05, c)
  add(x, y, z + 1.05, x + len, y + 0.6, z + 1.1, C.white)
}
function sofa(add, x, y, z, len = 2) {
  add(x, y, z, x + len, y + 0.8, z + 0.45, C.sofaBlue)
  add(x, y + 0.7, z + 0.45, x + len, y + 0.8, z + 0.95, C.sofaBlue)
  add(x, y, z + 0.45, x + 0.25, y + 0.8, z + 0.85, C.sofaBlue)
  add(x + len - 0.25, y, z + 0.45, x + len, y + 0.8, z + 0.85, C.sofaBlue)
}
function plant(add, x, y, z) {
  add(x, y, z, x + 0.4, y + 0.4, z + 0.35, C.pot)
  add(x + 0.05, y + 0.05, z + 0.35, x + 0.35, y + 0.35, z + 0.95, C.plantGreen)
}
function tableRound(add, x, y, z, r = 0.6) {
  add(x - r, y - r, z, x + r, y + r, z + 0.05, C.deskTop)
  add(x - 0.06, y - 0.06, z, x + 0.06, y + 0.06, z + 0.72, C.steel)
  add(x - r, y - r, z + 0.72, x + r, y + r, z + 0.77, C.deskTop)
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    add(x + dx * (r + 0.25), y + dy * (r + 0.25), z, x + dx * (r + 0.25) + 0.42, y + dy * (r + 0.25) + 0.42, z + 0.45, C.chairSeat)
  }
}

// Generator per tipe: (r, z, add) — r = room rect, z = permukaan lantai.
const FURNITURE = {
  ward(r, z, add) {
    const n = Math.max(1, Math.floor((r.x1 - r.x0 - 1) / 2.6))
    for (let i = 0; i < n; i++) {
      const x = r.x0 + 0.6 + i * 2.6
      bed(add, x, r.y0 + 0.7, z)
      bed(add, x, r.y1 - 1.7, z, 0)
      add(x + 2.1, r.y0 + 0.7, z, x + 2.45, r.y0 + 1.1, z + 0.6, C.white) // nakas
      add(x + 2.1, r.y1 - 1.1, z, x + 2.45, r.y1 - 0.7, z + 0.6, C.white)
    }
    // tirai pembatas tengah
    add((r.x0 + r.x1) / 2 - 0.03, r.y0 + 0.5, z + 1.0, (r.x0 + r.x1) / 2 + 0.03, r.y1 - 0.5, z + 2.2, C.curtain)
  },
  icu(r, z, add) {
    const n = Math.max(1, Math.floor((r.x1 - r.x0 - 1) / 3.2))
    for (let i = 0; i < n; i++) {
      const x = r.x0 + 0.8 + i * 3.2
      bed(add, x, r.y0 + 1.0, z)
      add(x + 2.2, r.y0 + 0.8, z, x + 2.7, r.y0 + 1.3, z + 1.6, C.screen) // monitor
      add(x + 2.2, r.y0 + 1.4, z, x + 2.6, r.y0 + 1.8, z + 0.8, C.steelLight)
    }
  },
  er(r, z, add) {
    const n = Math.max(1, Math.floor((r.x1 - r.x0 - 1) / 3.0))
    for (let i = 0; i < n; i++) {
      const x = r.x0 + 0.6 + i * 3.0
      bed(add, x, r.y0 + 0.8, z)
      add(x + 2.2, r.y0 + 0.8, z, x + 2.6, r.y0 + 1.2, z + 1.1, C.steelLight) // troli alat
    }
    add(r.x0 + 0.5, r.y1 - 1.2, z, r.x0 + 2.5, r.y1 - 0.6, z + 0.9, C.steelLight) // brankar cadangan
  },
  surgery(r, z, add) {
    const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2
    add(cx - 1.1, cy - 0.5, z, cx + 1.1, cy + 0.5, z + 0.85, C.steelLight) // meja operasi
    add(cx - 0.4, cy - 0.4, z + 0.85, cx + 0.4, cy + 0.4, z + 0.95, C.sheetGreen)
    add(cx - 1.3, cy - 1.3, z + 2.2, cx + 1.3, cy + 1.3, z + 2.35, C.white) // lampu operasi
    add(cx - 0.15, cy - 0.15, z + 2.35, cx + 0.15, cy + 0.15, z + 3.0, C.steel)
    shelf(add, r.x0 + 0.5, r.y0 + 0.5, z, 2, true)
  },
  pharmacy(r, z, add) {
    shelf(add, r.x0 + 0.5, r.y0 + 0.6, z, Math.min(6, r.x1 - r.x0 - 1), true)
    shelf(add, r.x0 + 0.5, r.y0 + 1.6, z, Math.min(6, r.x1 - r.x0 - 1), true)
    counter(add, r.x0 + 0.5, r.y1 - 1.4, z, Math.min(5, r.x1 - r.x0 - 1))
  },
  radiology(r, z, add) {
    add(r.x0 + 1, r.y0 + 1, z, r.x0 + 3.5, r.y0 + 2, z + 0.7, C.steelLight) // meja X-ray
    add((r.x0 + r.x1) / 2 - 0.8, r.y1 - 2.2, z, (r.x0 + r.x1) / 2 + 0.8, r.y1 - 0.6, z + 2.0, C.charcoal) // mesin
    add(r.x1 - 1.5, r.y0 + 0.5, z, r.x1 - 0.5, r.y0 + 1.5, z + 1.2, C.screen)
  },
  office(r, z, add) {
    const cols = Math.max(1, Math.floor((r.x1 - r.x0 - 1) / 2.2))
    const rows = Math.max(1, Math.floor((r.y1 - r.y0 - 1) / 2.2))
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      desk(add, r.x0 + 0.6 + i * 2.2, r.y0 + 0.6 + j * 2.2, z)
    }
    shelf(add, r.x0 + 0.5, r.y1 - 1.1, z, Math.min(5, r.x1 - r.x0 - 1), true)
  },
  lobby(r, z, add) {
    const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2
    counter(add, cx - 2, r.y0 + 0.8, z, 4)
    sofa(add, r.x0 + 0.8, r.y1 - 2.2, z, 2.4)
    sofa(add, r.x1 - 3.2, r.y1 - 2.2, z, 2.4)
    tableRound(add, cx, cy + 1, z)
    plant(add, r.x0 + 0.5, r.y0 + 0.5, z)
    plant(add, r.x1 - 0.9, r.y0 + 0.5, z)
    add(cx - 1.5, cy - 0.5, z, cx + 1.5, cy + 0.5, z + 0.02, C.rug)
  },
  waiting(r, z, add) {
    const n = Math.max(1, Math.floor((r.x1 - r.x0 - 1) / 2.6))
    for (let i = 0; i < n; i++) sofa(add, r.x0 + 0.5 + i * 2.6, r.y0 + 0.6, z, 2.2)
    tableRound(add, (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, z)
    plant(add, r.x0 + 0.5, r.y1 - 1.0, z)
  },
  vault(r, z, add) {
    // brankas: deretan kotak baja + batangan emas
    const n = Math.max(1, Math.floor((r.x1 - r.x0 - 1) / 1.6))
    for (let i = 0; i < n; i++) {
      const x = r.x0 + 0.5 + i * 1.6
      add(x, r.y0 + 0.5, z, x + 1.2, r.y0 + 1.3, z + 2.0, C.safeSteel)
      add(x + 0.45, r.y0 + 0.9, z + 0.9, x + 0.75, r.y0 + 1.2, z + 1.2, C.gold)
    }
    add((r.x0 + r.x1) / 2 - 1, (r.y0 + r.y1) / 2 - 0.6, z, (r.x0 + r.x1) / 2 + 1, (r.y0 + r.y1) / 2 + 0.6, z + 1.1, C.safeSteel)
  },
  counter(r, z, add) {
    counter(add, r.x0 + 0.5, r.y0 + 0.6, z, Math.min(8, r.x1 - r.x0 - 1))
    const n = Math.max(1, Math.floor((r.x1 - r.x0 - 1) / 2.4))
    for (let i = 0; i < n; i++) {
      add(r.x0 + 0.9 + i * 2.4, r.y0 + 0.8, z + 1.1, r.x0 + 1.3 + i * 2.4, r.y0 + 1.1, z + 1.5, C.screen)
    }
  },
  shop(r, z, add) {
    shelf(add, r.x0 + 0.5, r.y0 + 0.7, z, Math.min(8, r.x1 - r.x0 - 1), true)
    shelf(add, r.x0 + 0.5, r.y0 + 1.7, z, Math.min(8, r.x1 - r.x0 - 1), true)
    shelf(add, r.x0 + 0.5, r.y1 - 1.2, z, Math.min(4, r.x1 - r.x0 - 1), true)
    counter(add, r.x1 - 3.5, r.y1 - 1.4, z, 3)
  },
  class(r, z, add) {
    // papan tulis + meja guru + baris meja murid
    add(r.x0 + 0.6, r.y0 + 0.3, z + 1.0, r.x0 + 3.4, r.y0 + 0.42, z + 2.0, C.boardWhite)
    add(r.x0 + 0.5, r.y0 + 0.25, z + 0.95, r.x0 + 3.5, r.y0 + 0.3, z + 2.05, C.boardFrame)
    desk(add, (r.x0 + r.x1) / 2 - 0.7, r.y0 + 0.8, z, false)
    const cols = Math.max(1, Math.floor((r.x1 - r.x0 - 1) / 1.8))
    const rows = Math.max(1, Math.floor((r.y1 - r.y0 - 3) / 1.6))
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      desk(add, r.x0 + 0.6 + i * 1.8, r.y0 + 2.4 + j * 1.6, z, false)
    }
  },
  library(r, z, add) {
    const n = Math.max(1, Math.floor((r.x1 - r.x0 - 1) / 2.4))
    for (let i = 0; i < n; i++) shelf(add, r.x0 + 0.6 + i * 2.4, r.y0 + 0.6, z, 1.8, false)
    tableRound(add, (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2 + 1, z, 0.9)
    desk(add, r.x0 + 0.6, r.y1 - 1.6, z, true)
  },
  lab(r, z, add) {
    const cols = Math.max(1, Math.floor((r.x1 - r.x0 - 1) / 2.0))
    for (let i = 0; i < cols; i++) {
      add(r.x0 + 0.6 + i * 2.0, r.y0 + 0.6, z, r.x0 + 1.9 + i * 2.0, r.y0 + 1.2, z + 0.9, C.white)
      add(r.x0 + 0.9 + i * 2.0, r.y0 + 0.75, z + 0.9, r.x0 + 1.6 + i * 2.0, r.y0 + 1.05, z + 1.2, C.screen)
    }
    shelf(add, r.x0 + 0.5, r.y1 - 1.1, z, Math.min(5, r.x1 - r.x0 - 1), true)
  },
  market(r, z, add) {
    // lapak: meja + atap warna-warni + dagangan
    const cols = Math.max(1, Math.floor((r.x1 - r.x0 - 1) / 3.4))
    const rows = Math.max(1, Math.floor((r.y1 - r.y0 - 1) / 3.4))
    const awnings = [C.stallRed, C.stallGreen, C.stallBlue, C.stallYellow]
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const x = r.x0 + 0.7 + i * 3.4, y = r.y0 + 0.7 + j * 3.4
      add(x, y, z, x + 2.2, y + 1.4, z + 0.9, C.crateWood) // meja lapak
      const goods = [C.goodsRed, C.goodsGreen, C.goodsYellow, C.goodsOrange]
      for (let g = 0; g < 4; g++) add(x + 0.15 + g * 0.5, y + 0.2, z + 0.9, x + 0.55 + g * 0.5, y + 1.2, z + 1.15, goods[(i + j + g) % 4])
      add(x - 0.2, y - 0.2, z + 2.1, x + 2.4, y + 1.6, z + 2.2, awnings[(i + j) % 4]) // atap lapak
      for (const [px, py] of [[x - 0.15, y - 0.15], [x + 2.35, y - 0.15], [x - 0.15, y + 1.55], [x + 2.35, y + 1.55]]) {
        add(px, py, z, px + 0.08, py + 0.08, z + 2.15, C.steel)
      }
    }
  },
  cell(r, z, add) {
    // sel tahanan: ranjang susun + toilet + jeruji di depan
    add(r.x0 + 0.4, r.y0 + 0.5, z, r.x0 + 2.4, r.y0 + 1.4, z + 0.5, C.bedFrame)
    add(r.x0 + 0.45, r.y0 + 0.55, z + 0.5, r.x0 + 2.35, r.y0 + 1.35, z + 0.62, C.mattress)
    add(r.x0 + 0.4, r.y0 + 0.5, z + 1.6, r.x0 + 2.4, r.y0 + 1.4, z + 2.1, C.bedFrame)
    add(r.x0 + 0.45, r.y0 + 0.55, z + 2.1, r.x0 + 2.35, r.y0 + 1.35, z + 2.22, C.mattress)
    add(r.x1 - 1.1, r.y1 - 1.1, z, r.x1 - 0.5, r.y1 - 0.5, z + 0.45, C.toiletWhite)
    add(r.x1 - 1.1, r.y1 - 1.1, z + 0.45, r.x1 - 0.5, r.y1 - 0.9, z + 0.85, C.toiletWhite)
  },
  interrogation(r, z, add) {
    add((r.x0 + r.x1) / 2 - 0.9, (r.y0 + r.y1) / 2 - 0.5, z, (r.x0 + r.x1) / 2 + 0.9, (r.y0 + r.y1) / 2 + 0.5, z + 0.75, C.deskTop)
    add(r.x0 + 0.6, (r.y0 + r.y1) / 2 - 0.3, z, r.x0 + 1.1, (r.y0 + r.y1) / 2 + 0.3, z + 0.45, C.chairSeat)
    add(r.x1 - 1.1, (r.y0 + r.y1) / 2 - 0.3, z, r.x1 - 0.6, (r.y0 + r.y1) / 2 + 0.3, z + 0.45, C.chairSeat)
    add(r.x0 + 0.4, r.y0 + 0.4, z + 1.6, r.x0 + 1.4, r.y0 + 0.5, z + 2.2, C.screen) // cermin 2 arah (gelap)
  },
  evidence(r, z, add) {
    shelf(add, r.x0 + 0.5, r.y0 + 0.6, z, Math.min(6, r.x1 - r.x0 - 1), true)
    shelf(add, r.x0 + 0.5, r.y0 + 1.6, z, Math.min(6, r.x1 - r.x0 - 1), true)
    add(r.x1 - 1.6, r.y0 + 0.5, z, r.x1 - 0.5, r.y0 + 1.6, z + 1.8, C.safeSteel)
  },
  garage(r, z, add) {
    // lift mobil: 2 tiang + platform; mobil = kotak sederhana
    const cx = (r.x0 + r.x1) / 2
    add(cx - 1.2, r.y0 + 0.8, z, cx - 1.0, r.y0 + 3.2, z + 2.2, C.liftYellow)
    add(cx + 1.0, r.y0 + 0.8, z, cx + 1.2, r.y0 + 3.2, z + 2.2, C.liftYellow)
    add(cx - 1.1, r.y0 + 1.0, z + 1.0, cx + 1.1, r.y0 + 3.0, z + 1.15, C.steel)
    add(cx - 0.9, r.y0 + 1.3, z + 1.15, cx + 0.9, r.y0 + 2.7, z + 1.75, C.goodsBlue) // mobil di lift
    add(cx - 0.95, r.y0 + 1.2, z + 1.75, cx + 0.95, r.y0 + 2.0, z + 2.05, C.glassBlue)
    for (let i = 0; i < 3; i++) add(r.x0 + 0.5 + i * 0.55, r.y1 - 1.1, z, r.x0 + 1.0 + i * 0.55, r.y1 - 0.6, z + 0.7, C.tireBlack)
    shelf(add, r.x0 + 0.5, r.y0 + 0.5, z, 2, true)
  },
  bath(r, z, add) {
    const n = Math.max(1, Math.floor((r.x1 - r.x0 - 0.5) / 1.2))
    for (let i = 0; i < n; i++) {
      const x = r.x0 + 0.3 + i * 1.2
      add(x, r.y0 + 0.4, z, x + 0.7, r.y0 + 1.0, z + 0.45, C.toiletWhite)
      add(x, r.y0 + 1.0, z + 0.45, x + 0.7, r.y0 + 1.15, z + 0.85, C.toiletWhite)
    }
    add(r.x1 - 1.6, r.y0 + 0.4, z, r.x1 - 0.4, r.y0 + 1.0, z + 0.85, C.sinkSteel)
  },
  storage(r, z, add) {
    const cols = Math.max(1, Math.floor((r.x1 - r.x0 - 1) / 1.6))
    const rows = Math.max(1, Math.floor((r.y1 - r.y0 - 1) / 1.6))
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      if ((i + j) % 3 === 0) continue
      const x = r.x0 + 0.5 + i * 1.6, y = r.y0 + 0.5 + j * 1.6
      add(x, y, z, x + 1.1, y + 1.1, z + 1.0, (i + j) % 2 ? C.crateWood : C.barrelBlue)
    }
  },
  cafeteria(r, z, add) {
    const cols = Math.max(1, Math.floor((r.x1 - r.x0 - 1) / 3.2))
    const rows = Math.max(1, Math.floor((r.y1 - r.y0 - 1) / 3.2))
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      tableRound(add, r.x0 + 1.6 + i * 3.2, r.y0 + 1.6 + j * 3.2, z)
    }
    counter(add, r.x0 + 0.5, r.y1 - 1.4, z, Math.min(6, r.x1 - r.x0 - 1))
  },
  meeting(r, z, add) {
    add((r.x0 + r.x1) / 2 - 2.2, (r.y0 + r.y1) / 2 - 0.9, z, (r.x0 + r.x1) / 2 + 2.2, (r.y0 + r.y1) / 2 + 0.9, z + 0.75, C.deskTop)
    const n = Math.max(2, Math.floor((r.x1 - r.x0 - 1) / 1.2))
    for (let i = 0; i < n; i++) {
      add(r.x0 + 0.6 + i * 1.2, (r.y0 + r.y1) / 2 - 1.5, z, r.x0 + 1.1 + i * 1.2, (r.y0 + r.y1) / 2 - 1.0, z + 0.45, C.chairSeat)
      add(r.x0 + 0.6 + i * 1.2, (r.y0 + r.y1) / 2 + 1.0, z, r.x0 + 1.1 + i * 1.2, (r.y0 + r.y1) / 2 + 1.5, z + 0.45, C.chairSeat)
    }
    add(r.x0 + 0.6, r.y0 + 0.3, z + 1.0, r.x0 + 3.0, r.y0 + 0.42, z + 2.0, C.boardWhite)
  },
  training(r, z, add) {
    const cols = Math.max(1, Math.floor((r.x1 - r.x0 - 1) / 2.0))
    const rows = Math.max(1, Math.floor((r.y1 - r.y0 - 1) / 1.8))
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      desk(add, r.x0 + 0.6 + i * 2.0, r.y0 + 0.6 + j * 1.8, z, true)
    }
  },
  archive(r, z, add) {
    shelf(add, r.x0 + 0.5, r.y0 + 0.6, z, Math.min(8, r.x1 - r.x0 - 1), true)
    shelf(add, r.x0 + 0.5, r.y0 + 1.6, z, Math.min(8, r.x1 - r.x0 - 1), true)
    shelf(add, r.x0 + 0.5, r.y0 + 2.6, z, Math.min(8, r.x1 - r.x0 - 1), true)
  },
  aula(r, z, add) {
    // panggung + deretan kursi
    add(r.x0 + 1, r.y0 + 0.5, z, r.x1 - 1, r.y0 + 2.0, z + 0.8, C.wood)
    add((r.x0 + r.x1) / 2 - 1, r.y0 + 0.6, z + 0.8, (r.x0 + r.x1) / 2 + 1, r.y0 + 1.2, z + 1.0, C.charcoal)
    const rows = Math.max(1, Math.floor((r.y1 - r.y0 - 3) / 1.4))
    const cols = Math.max(2, Math.floor((r.x1 - r.x0 - 1) / 1.1))
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      add(r.x0 + 0.6 + i * 1.1, r.y0 + 3.0 + j * 1.4, z, r.x0 + 1.1 + i * 1.1, r.y0 + 3.5 + j * 1.4, z + 0.45, C.chairSeat)
    }
  },
  hall(r, z, add) {
    const n = Math.max(1, Math.floor((r.x1 - r.x0 - 1) / 2.2))
    for (let i = 0; i < n; i++) sofa(add, r.x0 + 0.5 + i * 2.2, r.y0 + 0.6, z, 1.8)
    plant(add, r.x0 + 0.5, r.y1 - 1.0, z)
    plant(add, r.x1 - 0.9, r.y1 - 1.0, z)
  },
  corridor() {},
  court(r, z, add) {
    add((r.x0 + r.x1) / 2 - 2.5, r.y0 + 0.6, z, (r.x0 + r.x1) / 2 + 2.5, r.y0 + 1.8, z + 1.0, C.teak) // meja hakim
    add((r.x0 + r.x1) / 2 - 0.6, r.y0 + 0.7, z + 1.0, (r.x0 + r.x1) / 2 + 0.6, r.y0 + 1.1, z + 1.5, C.chairSeat)
    const n = Math.max(2, Math.floor((r.x1 - r.x0 - 1) / 1.1))
    for (let i = 0; i < n; i++) {
      add(r.x0 + 0.6 + i * 1.1, r.y1 - 1.6, z, r.x0 + 1.1 + i * 1.1, r.y1 - 1.1, z + 0.45, C.chairSeat)
    }
  },
}

// ---------------------------------------------------------------------------
// Dinding turunan dari ruangan: sekat antar ruangan yang berbagi sisi.
// ---------------------------------------------------------------------------
function partitionSegments(rooms) {
  // kembalikan daftar segmen dinding {o, at, s0, s1} (tanpa celah pintu)
  const segs = []
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i], b = rooms[j]
      // berbagi sisi vertikal? a.x1 == b.x0 (atau sebaliknya), y tumpang tindih
      if (Math.abs(a.x1 - b.x0) < EPS) {
        const s0 = Math.max(a.y0, b.y0), s1 = Math.min(a.y1, b.y1)
        if (s1 - s0 > 0.3) segs.push({ o: 'v', at: a.x1, s0, s1 })
      } else if (Math.abs(b.x1 - a.x0) < EPS) {
        const s0 = Math.max(a.y0, b.y0), s1 = Math.min(a.y1, b.y1)
        if (s1 - s0 > 0.3) segs.push({ o: 'v', at: a.x0, s0, s1 })
      }
      // berbagi sisi horizontal?
      if (Math.abs(a.y1 - b.y0) < EPS) {
        const s0 = Math.max(a.x0, b.x0), s1 = Math.min(a.x1, b.x1)
        if (s1 - s0 > 0.3) segs.push({ o: 'h', at: a.y1, s0, s1 })
      } else if (Math.abs(b.y1 - a.y0) < EPS) {
        const s0 = Math.max(a.x0, b.x0), s1 = Math.min(a.x1, b.x1)
        if (s1 - s0 > 0.3) segs.push({ o: 'h', at: a.y0, s0, s1 })
      }
    }
  }
  return segs
}

// ---------------------------------------------------------------------------
// Bangun kotak statis interior (denah, tanpa cermin).
//   -> { solid: [...], glass: [...] } kotak {x0,y0,h0,x1,y1,h1,c}
// ---------------------------------------------------------------------------
const WALL_T = 0.2
const CEIL_H = 3.0 // tinggi plafon (lantai ke plafon); floorH 3.4 = + pelat 0.4
const SILL = 0.9, HEAD = 2.4 // jendela pita dinding luar

export function buildFacilityBoxes(plan) {
  const solid = [], glass = []
  const B = (list, x0, y0, h0, x1, y1, h1, c) => {
    if (Math.abs(x1 - x0) < 1e-4 || Math.abs(y1 - y0) < 1e-4 || Math.abs(h1 - h0) < 1e-4) return
    list.push({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), y0: Math.min(y0, y1), y1: Math.max(y0, y1), h0: Math.min(h0, h1), h1: Math.max(h0, h1), c })
  }
  const S = (...a) => B(solid, ...a)
  const G = (...a) => B(glass, ...a)
  const W = plan.w, D = plan.d, FH = plan.floorH || FLOOR_H_DEFAULT
  const nF = plan.floors.length
  const levelZ = (li) => li * FH

  plan.floors.forEach((fl, li) => {
    const z = levelZ(li)
    // ---- lantai per ruangan (kotak tangga lantai atas = lubang: lantainya
    // sudah pelat di bawah; lantai 1 kotak tangga digambar normal) ----
    for (const r of fl.rooms) {
      if (r.type === 'stair' && li > 0) continue
      S(r.x0, r.y0, z - 0.02, r.x1, r.y1, z + 0.004, FLOOR_COLOR[r.type] || C.tile)
    }
    // ---- dinding luar (pita kaca + celah entry di lantai 1) ----
    const entry = li === 0 ? plan.entry : null
    const wallH = (o, at, s0, s1, h0, h1, c = C.wall) => {
      if (o === 'h') S(s0, at - WALL_T / 2, z + h0, s1, at + WALL_T / 2, z + h1, c)
      else S(at - WALL_T / 2, s0, z + h0, at + WALL_T / 2, s1, z + h1, c)
    }
    const glassH = (o, at, s0, s1) => {
      if (o === 'h') G(s0, at - 0.02, z + SILL, s1, at + 0.02, z + HEAD)
      else G(at - 0.02, s0, z + SILL, at + 0.02, s1, z + HEAD)
    }
    // tiap sisi: potong jadi ruas padat (di bawah sill + di atas head + sisi entry)
    const sides = [
      { o: 'h', at: 0, s0: 0, s1: W },
      { o: 'h', at: D, s0: 0, s1: W },
      { o: 'v', at: 0, s0: 0, s1: D },
      { o: 'v', at: W, s0: 0, s1: D },
    ]
    for (const sd of sides) {
      let gaps = []
      if (entry && sd.o === 'h' && sd.at === 0) gaps.push({ a: entry.x - entry.w / 2, b: entry.x + entry.w / 2, h: 2.4 })
      // ruas padat di antara celah
      let cur = sd.s0
      const solidRuns = []
      for (const g of [...gaps].sort((a, b) => a.a - b.a)) {
        if (g.a > cur + EPS) solidRuns.push([cur, g.a])
        cur = Math.max(cur, g.b)
      }
      if (sd.s1 > cur + EPS) solidRuns.push([cur, sd.s1])
      for (const [a, b] of solidRuns) {
        wallH(sd.o, sd.at, a, b, 0, SILL)
        glassH(sd.o, sd.at, a, b)
        wallH(sd.o, sd.at, a, b, HEAD, CEIL_H)
      }
      // di celah entry: kusen + ambang atas
      for (const g of gaps) {
        wallH(sd.o, sd.at, g.a, g.b, g.h, CEIL_H)
        const fr = 0.06
        if (sd.o === 'h') { S(g.a, sd.at - 0.07, z, g.a + fr, sd.at + 0.07, z + g.h, C.white); S(g.b - fr, sd.at - 0.07, z, g.b, sd.at + 0.07, z + g.h, C.white) }
        else { S(sd.at - 0.07, g.a, z, sd.at + 0.07, g.a + fr, z + g.h, C.white); S(sd.at - 0.07, g.b - fr, z, sd.at + 0.07, g.b, z + g.h, C.white) }
      }
    }
    // ---- dinding sekat antar ruangan (dengan celah pintu) ----
    const doors = fl.doors || []
    for (const seg of partitionSegments(fl.rooms)) {
      const ops = doors.filter((d) => d.o === seg.o && Math.abs(d.at - seg.at) < EPS && d.a >= seg.s0 - EPS && d.b <= seg.s1 + EPS).sort((a, b) => a.a - b.a)
      let cur = seg.s0
      const run = (a, b, h0 = 0, h1 = CEIL_H) => {
        if (b - a < EPS) return
        if (seg.o === 'h') S(a, seg.at - WALL_T / 2, z + h0, b, seg.at + WALL_T / 2, z + h1)
        else S(seg.at - WALL_T / 2, a, z + h0, seg.at + WALL_T / 2, b, z + h1)
      }
      for (const op of ops) {
        run(cur, op.a)
        run(op.a, op.b, 2.1, CEIL_H) // ambang atas pintu
        // kusen (kecuali celah terbuka)
        if (op.kind !== 'open') {
          if (seg.o === 'h') { S(op.a, seg.at - 0.07, z, op.a + 0.05, seg.at + 0.07, z + 2.1, C.white); S(op.b - 0.05, seg.at - 0.07, z, op.b, seg.at + 0.07, z + 2.1, C.white) }
          else { S(seg.at - 0.07, op.a, z, seg.at + 0.07, op.a + 0.05, z + 2.1, C.white); S(seg.at - 0.07, op.b - 0.05, z, seg.at + 0.07, op.b, z + 2.1, C.white) }
        }
        cur = op.b
      }
      run(cur, seg.s1)
    }
    // ---- plafon / pelat di atas lantai ini ----
    const top = z + CEIL_H
    if (li < nF - 1) {
      // pelat lantai atas (tebal sampai permukaan lantai atas), berlubang di
      // kotak tangga
      const st = plan.stairs
      const hole = st ? { x0: st.x0, y0: st.y0, x1: st.x1, y1: st.y1 } : null
      const slab = (x0, y0, x1, y1) => S(x0, y0, top, x1, y1, levelZ(li + 1), C.ceil)
      if (!hole) slab(-WALL_T, -WALL_T, W + WALL_T, D + WALL_T)
      else {
        slab(-WALL_T, -WALL_T, hole.x0, D + WALL_T) // barat lubang
        slab(hole.x1, -WALL_T, W + WALL_T, D + WALL_T) // timur lubang
        slab(hole.x0, -WALL_T, hole.x1, hole.y0) // selatan lubang
        slab(hole.x0, hole.y1, hole.x1, D + WALL_T) // utara lubang
      }
      // (lantai ruangan lantai atas digambar oleh iterasi li+1 sendiri)
    } else {
      // atap datar + parapet (lantai teratas)
      S(-0.45, -0.45, top, W + 0.45, D + 0.45, top + 0.25, C.ceil)
      S(-0.45, -0.45, top + 0.25, W + 0.45, -0.33, top + 0.6, C.white)
      S(-0.45, D + 0.33, top + 0.25, W + 0.45, D + 0.45, top + 0.6, C.white)
      S(-0.45, -0.33, top + 0.25, -0.33, D + 0.33, top + 0.6, C.white)
      S(W + 0.33, -0.33, top + 0.25, W + 0.45, D + 0.33, top + 0.6, C.white)
    }
    // ---- perabot per ruangan ----
    for (const r of fl.rooms) {
      const fn = FURNITURE[r.type]
      if (fn) fn(r, z + 0.005, (...a) => B(solid, ...a))
    }
  })
  // ---- tangga lurus (tiap lantai naik, kotak yang sama) ----
  // Naik ke +x: masuk di ujung barat (x0, lantai bawah), keluar di ujung
  // timur (x1, lantai atas). Sisi panjang (y0/y1) berpagar; ujung timur di
  // lantai bawah ditutup dinding rendah (biar tidak masuk kolong tangga).
  if (plan.stairs) {
    const st = plan.stairs
    const FHh = FH
    for (let li = 0; li < nF - 1; li++) {
      const z = levelZ(li)
      const steps = 16, rise = FHh / steps
      const runLen = st.x1 - st.x0, tread = runLen / steps
      for (let i = 1; i <= steps; i++) {
        const top = i * rise
        S(st.x0 + (i - 1) * tread, st.y0, z + top - 0.3, st.x0 + i * tread, st.y1, z + top, C.tile)
        S(st.x0 + (i - 1) * tread, st.y0, z + top - 0.04, st.x0 + i * tread + 0.03, st.y1, z + top + 0.01, C.wood)
      }
      // pegangan mengikuti anak tangga, kedua sisi panjang + tiang tiap 2 anak tangga
      for (const ys of [st.y0, st.y1]) {
        for (let i = 1; i <= steps; i++) S(st.x0 + (i - 1) * tread, ys - 0.03, z + i * rise + 0.9, st.x0 + i * tread, ys + 0.03, z + i * rise + 0.96, C.teak)
        for (let i = 1; i <= steps; i += 2) S(st.x0 + (i - 0.5) * tread - 0.02, ys - 0.02, z + (i - 1) * rise, st.x0 + (i - 0.5) * tread + 0.02, ys + 0.02, z + i * rise + 0.9, C.steel)
      }
      // dinding rendah di ujung timur (kolong tangga, lantai bawah)
      S(st.x1 - 0.1, st.y0, z, st.x1 + 0.1, st.y1, z + 2.2, C.wall)
      // pagar lubang tangga di lantai atas (3 sisi; sisi timur terbuka = keluar)
      const zt = z + FHh
      const rail = (x0, y0, x1, y1) => { S(x0 - 0.03, y0 - 0.03, zt, x1 + 0.03, y1 + 0.03, zt + 0.08, C.steel); G(x0 - 0.01, y0 - 0.01, zt + 0.08, x1 + 0.01, y1 + 0.01, zt + 1.0); S(x0 - 0.035, y0 - 0.035, zt + 1.0, x1 + 0.035, y1 + 0.035, zt + 1.06, C.teak) }
      rail(st.x0, st.y0, st.x0, st.y1)
      rail(st.x0, st.y0, st.x1, st.y0)
      rail(st.x0, st.y1, st.x1, st.y1)
    }
  }
  return { solid, glass }
}

// ---------------------------------------------------------------------------
// Pintu yang bisa dibuka (denah). Daun pintu digambar FacilityInterior.jsx.
// ---------------------------------------------------------------------------
export function facilityDoors(plan) {
  return plan.floors.flatMap((fl, li) =>
    (fl.doors || []).filter((o) => o.kind !== 'open').map((o) => ({
      id: o.id, name: o.name || 'Pintu', level: li, y0: li * (plan.floorH || FLOOR_H_DEFAULT),
      axis: o.o === 'h' ? 'x' : 'z', at: o.at, pos: (o.a + o.b) / 2, w: o.b - o.a,
      hinge: 'start', swing: 1,
    }))
  )
}
export const FACILITY_DOOR_RANGE = 1.5
export const FACILITY_EXIT_RANGE = 2.0

function wrapAngle(a) { let r = a; while (r > Math.PI) r -= Math.PI * 2; while (r <= -Math.PI) r += Math.PI * 2; return r }

export function facilityDoorPlacement(d) {
  const start = d.pos - d.w / 2, end = d.pos + d.w / 2
  const hingeAt = start
  let hx, hz, cdx, cdz, odx, odz
  if (d.axis === 'x') { hx = hingeAt; hz = d.at; cdx = 1; cdz = 0; odx = 0; odz = d.swing }
  else { hx = d.at; hz = hingeAt; cdx = 0; cdz = 1; odx = d.swing; odz = 0 }
  const closedRot = Math.atan2(-cdz, cdx)
  const openRot = closedRot + wrapAngle(Math.atan2(-odz, odx) - closedRot)
  const seg = d.axis === 'x' ? { x1: start, z1: d.at, x2: end, z2: d.at } : { x1: d.at, z1: start, x2: d.at, z2: end }
  return { hx, hz, closedRot, openRot, seg }
}

// ---------------------------------------------------------------------------
// Ruangan & level
// ---------------------------------------------------------------------------
const ROOMS = (plan) => plan.floors.flatMap((fl, li) => fl.rooms.map((r) => ({ ...r, level: li, emoji: EMOJI[r.type] || '🏠' })))
const inRect = (r, x, y) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1
export const facilityLevelOf = (plan, feetY) => {
  const FH = plan.floorH || FLOOR_H_DEFAULT
  return Math.max(0, Math.min(plan.floors.length - 1, Math.floor((feetY + 0.1) / FH)))
}
export function roomAtFacility(plan, X, Z, feetY = 0) {
  const lv = facilityLevelOf(plan, feetY)
  const cand = ROOMS(plan).filter((r) => r.level === lv && inRect(r, X, Z))
  if (!cand.length) return null
  return { id: cand[0].id, name: cand[0].name, emoji: cand[0].emoji }
}
export function nearestFacilityDoor(plan, X, Z, yaw, feetY = 0) {
  const lv = facilityLevelOf(plan, feetY)
  const fx = yaw === undefined ? 0 : -Math.sin(yaw)
  const fy = yaw === undefined ? 0 : Math.cos(yaw)
  let best = null, bestScore = Infinity
  for (const d of facilityDoors(plan)) {
    if (d.level !== lv) continue
    const c = d.axis === 'x' ? { x: d.pos, y: d.at } : { x: d.at, y: d.pos }
    const dx = c.x - X, dy = c.y - Z, dist = Math.hypot(dx, dy)
    if (dist >= FACILITY_DOOR_RANGE) continue
    const facing = dist > 0.05 ? (fx * dx + fy * dy) / dist : 0
    const score = dist - 0.5 * facing
    if (score < bestScore) { bestScore = score; best = d }
  }
  return best
}
export function inFacilityDoorway(d, X, Z) {
  const c = d.axis === 'x' ? { x: d.pos, y: d.at } : { x: d.at, y: d.pos }
  const along = d.axis === 'x' ? Math.abs(X - c.x) : Math.abs(Z - c.y)
  const across = d.axis === 'x' ? Math.abs(Z - c.y) : Math.abs(X - c.x)
  return across < 0.6 && along < d.w / 2 + 0.2
}
export function distToFacilityExit(plan, X, Z, feetY = 0) {
  if (facilityLevelOf(plan, feetY) !== 0) return Infinity
  return Math.hypot(X - plan.entry.x, Z - 0)
}

// ---------------------------------------------------------------------------
// Tangga lurus: tinggi pijakan di titik denah (null kalau di luar kotak).
// ---------------------------------------------------------------------------
export function facilityStairHeight(plan, x, y, feetY = 0) {
  const st = plan.stairs
  if (!st) return null
  if (x < st.x0 || x > st.x1 || y < st.y0 || y > st.y1) return null
  const FH = plan.floorH || FLOOR_H_DEFAULT
  const lv = facilityLevelOf(plan, feetY)
  if (lv >= plan.floors.length - 1) return null
  const steps = 16, tread = (st.x1 - st.x0) / steps
  const i = Math.min(steps, Math.floor((x - st.x0) / tread) + 1)
  return lv * FH + (i * FH) / steps
}

// ---------------------------------------------------------------------------
// Dunia tabrakan interior fasilitas.
// ---------------------------------------------------------------------------
export function buildFacilityInteriorWorld(plan, { isDoorOpen = () => false } = {}) {
  const FH = plan.floorH || FLOOR_H_DEFAULT
  const W = plan.w, D = plan.d
  const WALL_Y = plan.floors.map((_, li) => [li * FH, li * FH + CEIL_H])
  const walls = [] // { x1,z1,x2,z2, lv, y0, y1 }
  plan.floors.forEach((fl, li) => {
    const y0 = WALL_Y[li][0], y1 = WALL_Y[li][1]
    // dinding luar (penuh, termasuk pita kaca — tabrakan seperti rumah)
    walls.push({ x1: 0, z1: 0, x2: W, z2: 0, lv: li, y0, y1 })
    walls.push({ x1: 0, z1: D, x2: W, z2: D, lv: li, y0, y1 })
    walls.push({ x1: 0, z1: 0, x2: 0, z2: D, lv: li, y0, y1 })
    walls.push({ x1: W, z1: 0, x2: W, z2: D, lv: li, y0, y1 })
    // sekat antar ruangan (dikurangi celah pintu)
    for (const seg of partitionSegments(fl.rooms)) {
      const ops = (fl.doors || []).filter((d) => d.o === seg.o && Math.abs(d.at - seg.at) < EPS && d.a >= seg.s0 - EPS && d.b <= seg.s1 + EPS).sort((a, b) => a.a - b.a)
      let cur = seg.s0
      const run = (a, b) => {
        if (b - a < EPS) return
        if (seg.o === 'h') walls.push({ x1: a, z1: seg.at, x2: b, z2: seg.at, lv: li, y0, y1 })
        else walls.push({ x1: seg.at, z1: a, x2: seg.at, z2: b, lv: li, y0, y1 })
      }
      for (const op of ops) { run(cur, op.a); cur = op.b }
      run(cur, seg.s1)
    }
    // pagar lubang tangga di lantai atas (3 sisi; sisi timur terbuka = keluar)
    if (plan.stairs && li > 0) {
      const st = plan.stairs, zt = li * FH
      walls.push({ x1: st.x0, z1: st.y0, x2: st.x0, z2: st.y1, lv: li, y0: zt, y1: zt + 1.1 })
      walls.push({ x1: st.x0, z1: st.y0, x2: st.x1, z2: st.y0, lv: li, y0: zt, y1: zt + 1.1 })
      walls.push({ x1: st.x0, z1: st.y1, x2: st.x1, z2: st.y1, lv: li, y0: zt, y1: zt + 1.1 })
    }
    // sisi panjang tangga (biar tidak jatuh dari sisi saat naik) + dinding
    // rendah ujung timur di lantai bawah (tutup kolong tangga)
    if (plan.stairs && li < plan.floors.length - 1) {
      const st = plan.stairs, z0 = li * FH
      walls.push({ x1: st.x0, z1: st.y0, x2: st.x1, z2: st.y0, lv: li, y0: z0, y1: z0 + FH })
      walls.push({ x1: st.x0, z1: st.y1, x2: st.x1, z2: st.y1, lv: li, y0: z0, y1: z0 + FH })
      walls.push({ x1: st.x1, z1: st.y0, x2: st.x1, z2: st.y1, lv: li, y0: z0, y1: z0 + 2.2 })
    }
  })
  const leaves = facilityDoors(plan).map((d) => {
    const s = facilityDoorPlacement(d).seg
    return { id: d.id, lv: d.level, y0: d.y0, y1: d.y0 + 2.1, seg: s }
  })
  const wallsByLevel = plan.floors.map((_, li) => walls.filter((w) => w.lv === li))
  let sig = null, cache = plan.floors.map((_, li) => wallsByLevel[li])
  function active(lv) {
    let s = ''
    for (const d of leaves) s += isDoorOpen(d.id) ? '1' : '0'
    if (s !== sig) {
      sig = s
      const closed = leaves.filter((d) => !isDoorOpen(d.id))
      cache = plan.floors.map((_, l) => wallsByLevel[l].concat(closed.filter((d) => d.lv === l).map((d) => ({ ...d.seg, lv: l, y0: d.y0, y1: d.y1 }))))
    }
    return cache[lv]
  }
  const state = { feetY: 0 }
  const inStairBox = (x, y) => plan.stairs && x >= plan.stairs.x0 && x <= plan.stairs.x1 && y >= plan.stairs.y0 && y <= plan.stairs.y1
  function levelSurface(li, x, y) {
    if (inStairBox(x, y)) return null // lubang tangga: bukan lantai (diisi anak tangga)
    for (const r of plan.floors[li].rooms) if (inRect(r, x, y)) return li * FH
    return null
  }
  function surfaceAt(X, Z, yMax) {
    const cap = Math.min(yMax, state.feetY + 0.65)
    let best = null
    const consider = (h) => { if (h !== null && h <= cap + 1e-6 && (best === null || h > best)) best = h }
    const sh = facilityStairHeight(plan, X, Z, state.feetY)
    if (inStairBox(X, Z)) consider(sh)
    else {
      for (let li = 0; li < plan.floors.length; li++) consider(levelSurface(li, X, Z))
    }
    return best
  }
  function resolveWalls(x, z, feetY, radius) {
    state.feetY = feetY
    let hit = false
    const list = active(facilityLevelOf(plan, feetY))
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
    bounds: { minX: -0.5, maxX: W + 0.5, minZ: -0.5, maxZ: D + 0.5 },
    waterLevel: -100,
    walls,
    state,
    groundY: (X, Z, yMax = Infinity) => surfaceAt(X, Z, yMax),
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
      const lv = facilityLevelOf(plan, state.feetY)
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
    findSpawn: () => ({ x: plan.entry.x, y: 0, z: 1.3 }),
  }
}

export function makeFacilityInteriorCam(world, plan) {
  const FH = plan.floorH || FLOOR_H_DEFAULT
  return {
    pitch: 0.2, dist: 3.2, minPitch: 0.03, maxPitch: 0.5,
    get maxY() { return (facilityLevelOf(plan, world.state.feetY) + 1) * FH - 0.4 },
  }
}

// ---------------------------------------------------------------------------
// DENAH 7 FASILITAS PRIORITAS (interior playable).
// Konvensi: x 0..W kiri->kanan (dilihat dari depan), y 0..D depan->belakang.
// Entry di y=0. Tangga lurus naik ke +x; kotak tangga = ruang 'stair'.
// Ruangan harus menutupi tapak penuh tanpa celah/tumpang tindih (dicek tes).
// ---------------------------------------------------------------------------
const R = (id, name, type, x0, y0, x1, y1) => ({ id, name, type, x0, y0, x1, y1 })
const DR = (id, name, o, at, a, b, kind = 'door') => ({ id, name, o, at, a, b, kind })

const PLAN_RS = {
  id: 'F3', name: 'Rumah Sakit', w: 58, d: 43, floorH: 3.4,
  entry: { x: 11, w: 3 },
  stairs: { x0: 26.5, y0: 33, x1: 31.5, y1: 34.6 },
  floors: [
    { rooms: [
      R('lobi', 'Lobi', 'lobby', 0, 0, 22, 16),
      R('daftar', 'Pendaftaran', 'counter', 22, 0, 36, 16),
      R('farmasi', 'Farmasi', 'pharmacy', 36, 0, 46, 16),
      R('igd', 'IGD', 'er', 46, 0, 58, 16),
      R('koridor', 'Koridor', 'corridor', 0, 16, 58, 20),
      R('kantin', 'Kantin', 'cafeteria', 0, 20, 16, 43),
      R('radiologi', 'Radiologi', 'radiology', 16, 20, 30, 32),
      R('operasi', 'Ruang Operasi', 'surgery', 30, 20, 46, 32),
      R('gudang', 'Gudang', 'storage', 46, 20, 58, 32),
      R('toilet', 'Toilet', 'bath', 16, 32, 26, 43),
      R('tangga', 'Tangga', 'stair', 26, 32, 32, 43),
      R('perawat', 'Ruang Perawat', 'office', 32, 32, 58, 43),
    ], doors: [
      DR('l1-lobi', 'Pintu Lobi', 'h', 16, 8, 10),
      DR('l1-daftar', 'Pintu Pendaftaran', 'h', 16, 27, 29),
      DR('l1-farmasi', 'Pintu Farmasi', 'h', 16, 40, 42),
      DR('l1-igd', 'Pintu IGD', 'h', 16, 50, 52),
      DR('l1-kantin', 'Pintu Kantin', 'h', 20, 6, 8),
      DR('l1-radiologi', 'Pintu Radiologi', 'h', 20, 22, 24),
      DR('l1-operasi', 'Pintu Operasi', 'h', 20, 36, 38),
      DR('l1-gudang', 'Pintu Gudang', 'h', 20, 50, 52),
      DR('l1-toilet', 'Pintu Toilet', 'v', 16, 34, 36),
      DR('l1-kantin-rad', 'Pintu Kantin', 'v', 16, 24, 26),
      DR('l1-toilet-rad', 'Pintu Toilet', 'h', 32, 18, 20),
      DR('l1-perawat-op', 'Pintu Ruang Perawat', 'h', 32, 38, 40),
      DR('l1-perawat-gud', 'Pintu Gudang', 'h', 32, 50, 52),
      DR('l1-tangga', 'Ke Tangga', 'v', 32, 34, 36, 'open'),
    ] },
    { rooms: [
      R('bangsal-a', 'Bangsal A', 'ward', 0, 0, 22, 16),
      R('bangsal-b', 'Bangsal B', 'ward', 22, 0, 36, 16),
      R('bangsal-c', 'Bangsal C', 'ward', 36, 0, 46, 16),
      R('perawat2', 'Ruang Perawat', 'office', 46, 0, 58, 16),
      R('koridor', 'Koridor', 'corridor', 0, 16, 58, 20),
      R('bangsal-d', 'Bangsal D', 'ward', 0, 20, 16, 43),
      R('icu', 'ICU', 'icu', 16, 20, 30, 32),
      R('isolasi', 'Ruang Isolasi', 'ward', 30, 20, 46, 32),
      R('gudang', 'Gudang', 'storage', 46, 20, 58, 32),
      R('toilet', 'Toilet', 'bath', 16, 32, 26, 43),
      R('tangga', 'Tangga', 'stair', 26, 32, 32, 43),
      R('bangsal-e', 'Bangsal E', 'ward', 32, 32, 58, 43),
    ], doors: [
      DR('l2-a', 'Pintu Bangsal A', 'h', 16, 8, 10),
      DR('l2-b', 'Pintu Bangsal B', 'h', 16, 27, 29),
      DR('l2-c', 'Pintu Bangsal C', 'h', 16, 40, 42),
      DR('l2-perawat', 'Pintu Ruang Perawat', 'h', 16, 50, 52),
      DR('l2-d', 'Pintu Bangsal D', 'h', 20, 6, 8),
      DR('l2-icu', 'Pintu ICU', 'h', 20, 22, 24),
      DR('l2-isolasi', 'Pintu Isolasi', 'h', 20, 36, 38),
      DR('l2-gudang', 'Pintu Gudang', 'h', 20, 50, 52),
      DR('l2-toilet', 'Pintu Toilet', 'v', 16, 34, 36),
      DR('l2-d-icu', 'Pintu Bangsal D', 'v', 16, 24, 26),
      DR('l2-toilet-icu', 'Pintu Toilet', 'h', 32, 18, 20),
      DR('l2-e-isolasi', 'Pintu Bangsal E', 'h', 32, 38, 40),
      DR('l2-e-gudang', 'Pintu Gudang', 'h', 32, 50, 52),
      DR('l2-tangga', 'Ke Tangga', 'v', 32, 34, 36, 'open'),
    ] },
    { rooms: [
      R('bangsal-f', 'Bangsal F', 'ward', 0, 0, 22, 16),
      R('bangsal-g', 'Bangsal G', 'ward', 22, 0, 36, 16),
      R('dokter', 'Ruang Dokter', 'office', 36, 0, 46, 16),
      R('aula', 'Aula', 'aula', 46, 0, 58, 16),
      R('koridor', 'Koridor', 'corridor', 0, 16, 58, 20),
      R('rapat', 'Ruang Rapat', 'meeting', 0, 20, 16, 43),
      R('lab', 'Laboratorium', 'lab', 16, 20, 30, 32),
      R('arsip', 'Arsip Medis', 'archive', 30, 20, 46, 32),
      R('gudang', 'Gudang', 'storage', 46, 20, 58, 32),
      R('toilet', 'Toilet', 'bath', 16, 32, 26, 43),
      R('tangga', 'Tangga', 'stair', 26, 32, 32, 43),
      R('bangsal-h', 'Bangsal H', 'ward', 32, 32, 58, 43),
    ], doors: [
      DR('l3-f', 'Pintu Bangsal F', 'h', 16, 8, 10),
      DR('l3-g', 'Pintu Bangsal G', 'h', 16, 27, 29),
      DR('l3-dokter', 'Pintu Ruang Dokter', 'h', 16, 40, 42),
      DR('l3-aula', 'Pintu Aula', 'h', 16, 50, 52),
      DR('l3-rapat', 'Pintu Ruang Rapat', 'h', 20, 6, 8),
      DR('l3-lab', 'Pintu Lab', 'h', 20, 22, 24),
      DR('l3-arsip', 'Pintu Arsip', 'h', 20, 36, 38),
      DR('l3-gudang', 'Pintu Gudang', 'h', 20, 50, 52),
      DR('l3-toilet', 'Pintu Toilet', 'v', 16, 34, 36),
      DR('l3-rapat-lab', 'Pintu Ruang Rapat', 'v', 16, 24, 26),
      DR('l3-toilet-lab', 'Pintu Toilet', 'h', 32, 18, 20),
      DR('l3-h-arsip', 'Pintu Bangsal H', 'h', 32, 38, 40),
      DR('l3-h-gudang', 'Pintu Gudang', 'h', 32, 50, 52),
      DR('l3-tangga', 'Ke Tangga', 'v', 32, 34, 36, 'open'),
    ] },
  ],
}

const PLAN_POLISI = {
  id: 'F2', name: 'Kantor Polisi', w: 33, d: 23, floorH: 3.4,
  entry: { x: 6, w: 2.5 },
  stairs: { x0: 24.5, y0: 19, x1: 29.5, y1: 20.6 },
  floors: [
    { rooms: [
      R('lobi', 'Lobi', 'lobby', 0, 0, 12, 10),
      R('jaga', 'Ruang Jaga', 'office', 12, 0, 22, 10),
      R('garasi', 'Garasi', 'garage', 22, 0, 33, 10),
      R('koridor', 'Koridor', 'corridor', 0, 10, 33, 13),
      R('sel1', 'Sel Tahanan 1', 'cell', 0, 13, 8, 23),
      R('sel2', 'Sel Tahanan 2', 'cell', 8, 13, 16, 23),
      R('interogasi', 'Ruang Interogasi', 'interrogation', 16, 13, 24, 23),
      R('bukti', 'Gudang Bukti', 'evidence', 24, 13, 33, 18),
      R('tangga', 'Tangga', 'stair', 24, 18, 30, 23),
      R('toilet', 'Toilet', 'bath', 30, 18, 33, 23),
    ], doors: [
      DR('l1-lobi', 'Pintu Lobi', 'h', 10, 5, 7),
      DR('l1-jaga', 'Pintu Ruang Jaga', 'h', 10, 16, 18),
      DR('l1-garasi', 'Pintu Garasi', 'h', 10, 26, 28),
      DR('l1-sel1', 'Pintu Sel 1', 'h', 13, 3, 5),
      DR('l1-sel2', 'Pintu Sel 2', 'h', 13, 11, 13),
      DR('l1-interogasi', 'Pintu Interogasi', 'h', 13, 19, 21),
      DR('l1-bukti', 'Pintu Gudang Bukti', 'h', 13, 27, 29),
      DR('l1-sel1-sel2', 'Pintu Sel', 'v', 8, 16, 18),
      DR('l1-sel2-int', 'Pintu Interogasi', 'v', 16, 16, 18),
      DR('l1-tangga', 'Ke Tangga', 'h', 18, 25, 27, 'open'),
      DR('l1-toilet', 'Pintu Toilet', 'v', 30, 19, 21),
    ] },
    { rooms: [
      R('kantor', 'Kantor', 'office', 0, 0, 12, 10),
      R('kapolsek', 'Ruang Kapolsek', 'office', 12, 0, 22, 10),
      R('rapat', 'Ruang Rapat', 'meeting', 22, 0, 33, 10),
      R('koridor', 'Koridor', 'corridor', 0, 10, 33, 13),
      R('arsip', 'Arsip', 'archive', 0, 13, 11, 23),
      R('kantor2', 'Kantor 2', 'office', 11, 13, 24, 23),
      R('tangga', 'Tangga', 'stair', 24, 18, 30, 23),
      R('toilet', 'Toilet', 'bath', 30, 18, 33, 23),
      R('istirahat', 'Ruang Istirahat', 'hall', 24, 13, 33, 18),
    ], doors: [
      DR('l2-kantor', 'Pintu Kantor', 'h', 10, 5, 7),
      DR('l2-kapolsek', 'Pintu Kapolsek', 'h', 10, 16, 18),
      DR('l2-rapat', 'Pintu Ruang Rapat', 'h', 10, 26, 28),
      DR('l2-arsip', 'Pintu Arsip', 'h', 13, 5, 7),
      DR('l2-kantor2', 'Pintu Kantor 2', 'h', 13, 15, 17),
      DR('l2-istirahat', 'Pintu Ruang Istirahat', 'h', 13, 26, 28),
      DR('l2-arsip-kantor2', 'Pintu Kantor 2', 'v', 11, 16, 18),
      DR('l2-tangga', 'Ke Tangga', 'v', 24, 19, 21, 'open'),
      DR('l2-toilet', 'Pintu Toilet', 'v', 30, 19, 21),
    ] },
  ],
}

const PLAN_BANK = {
  id: 'F5', name: 'Bank Sentral', w: 28, d: 23, floorH: 3.4,
  entry: { x: 7, w: 3 },
  stairs: { x0: 9.5, y0: 17, x1: 14.5, y1: 18.6 },
  floors: [
    { rooms: [
      R('lobi', 'Lobi', 'lobby', 0, 0, 15, 9),
      R('teller', 'Meja Teller', 'counter', 15, 0, 28, 9),
      R('brankas', 'Brankas', 'vault', 0, 9, 9, 16),
      R('tunggu', 'Ruang Tunggu', 'waiting', 9, 9, 19, 16),
      R('layanan', 'Ruang Layanan', 'office', 19, 9, 28, 16),
      R('gudang', 'Gudang', 'storage', 0, 16, 9, 23),
      R('tangga', 'Tangga', 'stair', 9, 16, 15, 23),
      R('toilet', 'Toilet', 'bath', 15, 16, 21, 23),
      R('arsip', 'Arsip', 'archive', 21, 16, 28, 23),
    ], doors: [
      DR('l1-teller', 'Pintu Teller', 'v', 15, 4, 6),
      DR('l1-brankas', 'Pintu Brankas', 'h', 9, 4, 6),
      DR('l1-tunggu', 'Pintu Ruang Tunggu', 'h', 9, 12, 14),
      DR('l1-layanan', 'Pintu Ruang Layanan', 'h', 9, 22, 24),
      DR('l1-gudang', 'Pintu Gudang', 'h', 16, 4, 6),
      DR('l1-toilet', 'Pintu Toilet', 'h', 16, 17, 19),
      DR('l1-arsip', 'Pintu Arsip', 'h', 16, 23, 25),
      DR('l1-tangga', 'Ke Tangga', 'v', 9, 18, 20, 'open'),
      DR('l1-toilet-arsip', 'Pintu Toilet', 'v', 21, 18, 20),
    ] },
    { rooms: [
      R('kantor', 'Kantor', 'office', 0, 0, 15, 9),
      R('rapat', 'Ruang Rapat', 'meeting', 15, 0, 28, 9),
      R('kantor2', 'Kantor 2', 'office', 0, 9, 14, 16),
      R('direksi', 'Ruang Direksi', 'office', 14, 9, 28, 16),
      R('arsip2', 'Arsip', 'archive', 0, 16, 9, 23),
      R('tangga', 'Tangga', 'stair', 9, 16, 15, 23),
      R('toilet', 'Toilet', 'bath', 15, 16, 21, 23),
      R('istirahat', 'Ruang Istirahat', 'hall', 21, 16, 28, 23),
    ], doors: [
      DR('l2-rapat', 'Pintu Ruang Rapat', 'v', 15, 4, 6),
      DR('l2-kantor2', 'Pintu Kantor 2', 'h', 9, 6, 8),
      DR('l2-direksi', 'Pintu Ruang Direksi', 'h', 9, 20, 22),
      DR('l2-arsip2', 'Pintu Arsip', 'h', 16, 4, 6),
      DR('l2-toilet', 'Pintu Toilet', 'h', 16, 17, 19),
      DR('l2-istirahat', 'Pintu Ruang Istirahat', 'h', 16, 23, 25),
      DR('l2-tangga', 'Ke Tangga', 'v', 9, 18, 20, 'open'),
      DR('l2-toilet-ist', 'Pintu Toilet', 'v', 21, 18, 20),
    ] },
  ],
}

const PLAN_JOB = {
  id: 'F1', name: 'Job Center', w: 38, d: 28, floorH: 3.4,
  entry: { x: 7, w: 3 },
  stairs: { x0: 14.5, y0: 23, x1: 19.5, y1: 24.6 },
  floors: [
    { rooms: [
      R('lobi', 'Lobi', 'lobby', 0, 0, 14, 12),
      R('layanan', 'Meja Layanan', 'counter', 14, 0, 28, 12),
      R('tunggu', 'Ruang Tunggu', 'waiting', 28, 0, 38, 12),
      R('koridor', 'Koridor', 'corridor', 0, 12, 38, 15),
      R('pelatihan', 'Ruang Pelatihan', 'training', 0, 15, 14, 28),
      R('konseling', 'Ruang Konseling', 'office', 14, 15, 24, 22),
      R('toilet', 'Toilet', 'bath', 24, 15, 29, 22),
      R('gudang', 'Gudang', 'storage', 29, 15, 38, 22),
      R('rapat', 'Ruang Rapat', 'meeting', 20, 22, 38, 28),
      R('tangga', 'Tangga', 'stair', 14, 22, 20, 28),
    ], doors: [
      DR('l1-lobi', 'Pintu Lobi', 'h', 12, 6, 8),
      DR('l1-layanan', 'Pintu Layanan', 'h', 12, 20, 22),
      DR('l1-tunggu', 'Pintu Ruang Tunggu', 'h', 12, 32, 34),
      DR('l1-pelatihan', 'Pintu Pelatihan', 'h', 15, 6, 8),
      DR('l1-konseling', 'Pintu Konseling', 'h', 15, 18, 20),
      DR('l1-toilet', 'Pintu Toilet', 'h', 15, 25, 27),
      DR('l1-gudang', 'Pintu Gudang', 'h', 15, 32, 34),
      DR('l1-rapat-konseling', 'Pintu Ruang Rapat', 'h', 22, 21, 23),
      DR('l1-rapat-gudang', 'Pintu Ruang Rapat', 'h', 22, 31, 33),
      DR('l1-tangga', 'Ke Tangga', 'h', 22, 16, 18, 'open'),
      DR('l1-toilet-gudang', 'Pintu Toilet', 'v', 29, 17, 19),
    ] },
    { rooms: [
      R('kelas-a', 'Kelas A', 'class', 0, 0, 14, 12),
      R('kelas-b', 'Kelas B', 'class', 14, 0, 28, 12),
      R('pustaka', 'Perpustakaan', 'library', 28, 0, 38, 12),
      R('koridor', 'Koridor', 'corridor', 0, 12, 38, 15),
      R('lab', 'Lab Komputer', 'lab', 0, 15, 14, 28),
      R('kantor', 'Kantor', 'office', 14, 15, 24, 22),
      R('toilet', 'Toilet', 'bath', 24, 15, 29, 22),
      R('arsip', 'Arsip', 'archive', 29, 15, 38, 22),
      R('aula', 'Aula', 'aula', 20, 22, 38, 28),
      R('tangga', 'Tangga', 'stair', 14, 22, 20, 28),
    ], doors: [
      DR('l2-a', 'Pintu Kelas A', 'h', 12, 6, 8),
      DR('l2-b', 'Pintu Kelas B', 'h', 12, 20, 22),
      DR('l2-pustaka', 'Pintu Perpustakaan', 'h', 12, 32, 34),
      DR('l2-lab', 'Pintu Lab', 'h', 15, 6, 8),
      DR('l2-kantor', 'Pintu Kantor', 'h', 15, 18, 20),
      DR('l2-toilet', 'Pintu Toilet', 'h', 15, 25, 27),
      DR('l2-arsip', 'Pintu Arsip', 'h', 15, 32, 34),
      DR('l2-aula-kantor', 'Pintu Aula', 'h', 22, 21, 23),
      DR('l2-aula-arsip', 'Pintu Aula', 'h', 22, 31, 33),
      DR('l2-tangga', 'Ke Tangga', 'h', 22, 16, 18, 'open'),
      DR('l2-toilet-arsip', 'Pintu Toilet', 'v', 29, 17, 19),
    ] },
  ],
}

const PLAN_PASAR = {
  id: 'F11', name: 'Pasar Rakyat', w: 58, d: 38, floorH: 3.4,
  entry: { x: 21, w: 4 },
  stairs: null,
  floors: [
    { rooms: [
      R('sayur', 'Lapak Sayur', 'market', 0, 0, 14, 19),
      R('buah', 'Lapak Buah', 'market', 14, 0, 29, 19),
      R('daging', 'Lapak Daging', 'market', 29, 0, 44, 19),
      R('ikan', 'Lapak Ikan', 'market', 44, 0, 58, 19),
      R('pakaian', 'Lapak Pakaian', 'market', 0, 19, 19, 38),
      R('elektronik', 'Lapak Elektronik', 'market', 19, 19, 38, 38),
      R('gudang', 'Gudang', 'storage', 38, 19, 50, 38),
      R('toilet', 'Toilet', 'bath', 50, 19, 58, 38),
    ], doors: [
      DR('sayur-buah', 'Lapak Buah', 'v', 14, 8, 11, 'open'),
      DR('buah-daging', 'Lapak Daging', 'v', 29, 8, 11, 'open'),
      DR('daging-ikan', 'Lapak Ikan', 'v', 44, 8, 11, 'open'),
      DR('sayur-pakaian', 'Lapak Pakaian', 'h', 19, 6, 9, 'open'),
      DR('buah-elektronik', 'Lapak Elektronik', 'h', 19, 21, 24, 'open'),
      DR('daging-elektronik', 'Lapak Elektronik', 'h', 19, 32, 35, 'open'),
      DR('ikan-gudang', 'Gudang', 'h', 19, 46, 49, 'open'),
      DR('pakaian-elektronik', 'Lapak Elektronik', 'v', 19, 27, 30, 'open'),
      DR('elektronik-gudang', 'Gudang', 'v', 38, 27, 30, 'open'),
      DR('gudang-toilet', 'Pintu Toilet', 'v', 50, 27, 29),
    ] },
  ],
}

const PLAN_MALL = {
  id: 'F12', name: 'Mall', w: 68, d: 48, floorH: 3.4,
  entry: { x: 42, w: 4 },
  stairs: { x0: 28.5, y0: 37, x1: 33.5, y1: 38.6 },
  floors: [
    { rooms: [
      R('toko1', 'Toko 1', 'shop', 0, 0, 17, 18),
      R('toko2', 'Toko 2', 'shop', 17, 0, 34, 18),
      R('atrium', 'Atrium', 'lobby', 34, 0, 51, 18),
      R('toko3', 'Toko 3', 'shop', 51, 0, 68, 18),
      R('koridor', 'Koridor', 'corridor', 0, 18, 68, 24),
      R('foodcourt', 'Food Court', 'cafeteria', 0, 24, 20, 48),
      R('toko4', 'Toko 4', 'shop', 20, 24, 34, 36),
      R('toko5', 'Toko 5', 'shop', 34, 24, 48, 36),
      R('toko6', 'Toko 6', 'shop', 48, 24, 68, 36),
      R('toilet', 'Toilet', 'bath', 20, 36, 28, 48),
      R('tangga', 'Tangga', 'stair', 28, 36, 34, 48),
      R('gudang', 'Gudang', 'storage', 34, 36, 48, 48),
      R('toko7', 'Toko 7', 'shop', 48, 36, 68, 48),
    ], doors: [
      DR('l1-toko1', 'Pintu Toko 1', 'h', 18, 7, 9),
      DR('l1-toko2', 'Pintu Toko 2', 'h', 18, 24, 26),
      DR('l1-atrium', 'Pintu Atrium', 'h', 18, 41, 43),
      DR('l1-toko3', 'Pintu Toko 3', 'h', 18, 58, 60),
      DR('l1-foodcourt', 'Pintu Food Court', 'h', 24, 8, 10),
      DR('l1-toko4', 'Pintu Toko 4', 'h', 24, 26, 28),
      DR('l1-toko5', 'Pintu Toko 5', 'h', 24, 40, 42),
      DR('l1-toko6', 'Pintu Toko 6', 'h', 24, 56, 58),
      DR('l1-toilet', 'Pintu Toilet', 'v', 20, 40, 42),
      DR('l1-tangga', 'Ke Tangga', 'h', 36, 30, 32, 'open'),
      DR('l1-gudang', 'Pintu Gudang', 'h', 36, 40, 42),
      DR('l1-toko7', 'Pintu Toko 7', 'h', 36, 56, 58),
      DR('l1-toilet-tangga', 'Pintu Toilet', 'v', 28, 40, 42),
      DR('l1-gudang-toko7', 'Pintu Gudang', 'v', 48, 40, 42),
    ] },
    { rooms: [
      R('toko8', 'Toko 8', 'shop', 0, 0, 17, 18),
      R('toko9', 'Toko 9', 'shop', 17, 0, 34, 18),
      R('atrium2', 'Atrium', 'lobby', 34, 0, 51, 18),
      R('toko10', 'Toko 10', 'shop', 51, 0, 68, 18),
      R('koridor', 'Koridor', 'corridor', 0, 18, 68, 24),
      R('arena', 'Arena Bermain', 'hall', 0, 24, 20, 48),
      R('toko11', 'Toko 11', 'shop', 20, 24, 34, 36),
      R('toko12', 'Toko 12', 'shop', 34, 24, 48, 36),
      R('toko13', 'Toko 13', 'shop', 48, 24, 68, 36),
      R('toilet', 'Toilet', 'bath', 20, 36, 28, 48),
      R('tangga', 'Tangga', 'stair', 28, 36, 34, 48),
      R('kantor', 'Kantor Mall', 'office', 34, 36, 48, 48),
      R('toko14', 'Toko 14', 'shop', 48, 36, 68, 48),
    ], doors: [
      DR('l2-toko8', 'Pintu Toko 8', 'h', 18, 7, 9),
      DR('l2-toko9', 'Pintu Toko 9', 'h', 18, 24, 26),
      DR('l2-atrium', 'Pintu Atrium', 'h', 18, 41, 43),
      DR('l2-toko10', 'Pintu Toko 10', 'h', 18, 58, 60),
      DR('l2-arena', 'Pintu Arena', 'h', 24, 8, 10),
      DR('l2-toko11', 'Pintu Toko 11', 'h', 24, 26, 28),
      DR('l2-toko12', 'Pintu Toko 12', 'h', 24, 40, 42),
      DR('l2-toko13', 'Pintu Toko 13', 'h', 24, 56, 58),
      DR('l2-toilet', 'Pintu Toilet', 'v', 20, 40, 42),
      DR('l2-tangga', 'Ke Tangga', 'h', 36, 30, 32, 'open'),
      DR('l2-kantor', 'Pintu Kantor', 'h', 36, 40, 42),
      DR('l2-toko14', 'Pintu Toko 14', 'h', 36, 56, 58),
      DR('l2-toilet-tangga', 'Pintu Toilet', 'v', 28, 40, 42),
      DR('l2-kantor-toko14', 'Pintu Kantor', 'v', 48, 40, 42),
    ] },
  ],
}

const PLAN_KAMPUS = {
  id: 'F7', name: 'Kampus & Sekolah', w: 68, d: 48, floorH: 3.4,
  entry: { x: 9, w: 3 },
  stairs: { x0: 26.5, y0: 35, x1: 31.5, y1: 36.6 },
  floors: [
    { rooms: [
      R('lobi', 'Lobi', 'lobby', 0, 0, 18, 16),
      R('kelas1', 'Kelas 1', 'class', 18, 0, 36, 16),
      R('kelas2', 'Kelas 2', 'class', 36, 0, 52, 16),
      R('pustaka', 'Perpustakaan', 'library', 52, 0, 68, 16),
      R('koridor', 'Koridor', 'corridor', 0, 16, 68, 20),
      R('lab', 'Lab Komputer', 'lab', 0, 20, 18, 48),
      R('kelas3', 'Kelas 3', 'class', 18, 20, 34, 34),
      R('kelas4', 'Kelas 4', 'class', 34, 20, 50, 34),
      R('dosen', 'Ruang Dosen', 'office', 50, 20, 68, 34),
      R('toilet', 'Toilet', 'bath', 18, 34, 26, 48),
      R('tangga', 'Tangga', 'stair', 26, 34, 32, 48),
      R('aula', 'Aula', 'aula', 32, 34, 68, 48),
    ], doors: [
      DR('l1-lobi', 'Pintu Lobi', 'h', 16, 8, 10),
      DR('l1-kelas1', 'Pintu Kelas 1', 'h', 16, 26, 28),
      DR('l1-kelas2', 'Pintu Kelas 2', 'h', 16, 43, 45),
      DR('l1-pustaka', 'Pintu Perpustakaan', 'h', 16, 59, 61),
      DR('l1-lab', 'Pintu Lab', 'h', 20, 8, 10),
      DR('l1-kelas3', 'Pintu Kelas 3', 'h', 20, 25, 27),
      DR('l1-kelas4', 'Pintu Kelas 4', 'h', 20, 41, 43),
      DR('l1-dosen', 'Pintu Ruang Dosen', 'h', 20, 58, 60),
      DR('l1-toilet', 'Pintu Toilet', 'v', 18, 40, 42),
      DR('l1-tangga', 'Ke Tangga', 'h', 34, 28, 30, 'open'),
      DR('l1-aula', 'Pintu Aula', 'h', 34, 48, 50),
      DR('l1-toilet-tangga', 'Pintu Toilet', 'v', 26, 40, 42),
      DR('l1-aula-tangga', 'Pintu Aula', 'v', 32, 40, 42),
    ] },
    { rooms: [
      R('kelas5', 'Kelas 5', 'class', 0, 0, 18, 16),
      R('kelas6', 'Kelas 6', 'class', 18, 0, 36, 16),
      R('kelas7', 'Kelas 7', 'class', 36, 0, 52, 16),
      R('lab-bahasa', 'Lab Bahasa', 'lab', 52, 0, 68, 16),
      R('koridor', 'Koridor', 'corridor', 0, 16, 68, 20),
      R('dosen2', 'Ruang Dosen', 'office', 0, 20, 18, 48),
      R('kelas8', 'Kelas 8', 'class', 18, 20, 34, 34),
      R('kelas9', 'Kelas 9', 'class', 34, 20, 50, 34),
      R('rapat', 'Ruang Rapat', 'meeting', 50, 20, 68, 34),
      R('toilet', 'Toilet', 'bath', 18, 34, 26, 48),
      R('tangga', 'Tangga', 'stair', 26, 34, 32, 48),
      R('aula2', 'Aula', 'aula', 32, 34, 68, 48),
    ], doors: [
      DR('l2-kelas5', 'Pintu Kelas 5', 'h', 16, 8, 10),
      DR('l2-kelas6', 'Pintu Kelas 6', 'h', 16, 26, 28),
      DR('l2-kelas7', 'Pintu Kelas 7', 'h', 16, 43, 45),
      DR('l2-lab-bahasa', 'Pintu Lab Bahasa', 'h', 16, 59, 61),
      DR('l2-dosen2', 'Pintu Ruang Dosen', 'h', 20, 8, 10),
      DR('l2-kelas8', 'Pintu Kelas 8', 'h', 20, 25, 27),
      DR('l2-kelas9', 'Pintu Kelas 9', 'h', 20, 41, 43),
      DR('l2-rapat', 'Pintu Ruang Rapat', 'h', 20, 58, 60),
      DR('l2-toilet', 'Pintu Toilet', 'v', 18, 40, 42),
      DR('l2-tangga', 'Ke Tangga', 'h', 34, 28, 30, 'open'),
      DR('l2-aula2', 'Pintu Aula', 'h', 34, 48, 50),
      DR('l2-toilet-tangga', 'Pintu Toilet', 'v', 26, 40, 42),
      DR('l2-aula2-tangga', 'Pintu Aula', 'v', 32, 40, 42),
    ] },
  ],
}

// ---------------------------------------------------------------------------
// Registry interior: id fasilitas -> plan. 7 prioritas dulu; 23 sisanya
// eksterior saja (tanpa entry) sampai denahnya dibuat.
// ---------------------------------------------------------------------------
export const FACILITY_INTERIORS = {
  F1: PLAN_JOB,
  F2: PLAN_POLISI,
  F3: PLAN_RS,
  F5: PLAN_BANK,
  F7: PLAN_KAMPUS,
  F11: PLAN_PASAR,
  F12: PLAN_MALL,
}
export const FACILITY_INTERIOR_IDS = Object.keys(FACILITY_INTERIORS)
export function hasFacilityInterior(fid) { return !!FACILITY_INTERIORS[fid] }
export function facilityInteriorPlan(fid) { return FACILITY_INTERIORS[fid] || null }
export function facilityInteriorStats() {
  return FACILITY_INTERIOR_IDS.map((fid) => {
    const p = FACILITY_INTERIORS[fid]
    const rooms = p.floors.reduce((n, fl) => n + fl.rooms.length, 0)
    const doors = p.floors.reduce((n, fl) => n + (fl.doors || []).length, 0)
    const { solid, glass } = buildFacilityBoxes(p)
    return { id: fid, name: p.name, floors: p.floors.length, rooms, doors, boxes: solid.length + glass.length }
  })
}
