// Kawasan Pantai, AREA LAUT: rumah panggung + jembatan.
//
// Di kawasan-pantai.glb ada 27 balok polos (TPX_Buildings_18..44) di laut yang
// dihubungkan jalan sempit (TPX_RoadsOutlines, lebar ~2 m) setinggi permukaan air.
// Fungsi di sini mengubahnya jadi:
//   - rumah panggung 1 lantai (desain "Honeymoon Floating House": kamar tidur, kamar
//     mandi, dapur, ruang tamu/santai + teras belakang berpergola), TANPA furnitur;
//   - jalan laut yang sama persis (rute tidak berubah) dinaikkan DECK_H di atas air
//     jadi jembatan kayu berpagar bertiang, lalu disambung ke pintu tiap rumah.
//
// ARAH RUMAH. Tiap rumah ada di ujung satu cabang jalan. Pintu depan menghadap
// ke jembatan itu (jembatan masuk lurus ke pintu), dan teras santai ada di sisi
// BELAKANG rumah, yaitu menghadap laut lepas.
//
// BENTUK DATA. Semua bekerja langsung di `scene` (frame lokal glb: Z ke atas), seperti
// lib/pantaiHouses.js, jadi dipakai TownMap3D dan TownWalk sekaligus:
//   - balok lama TPX_Buildings_N DIPAKAI ULANG sebagai rumah barunya (geometri &
//     material diganti, namanya tetap), jadi pilih/sorot bangunan di peta, nomor
//     rumah, dan tabrakan tembok tetap bekerja tanpa perubahan lain.
//   - kaca = mesh anak (noCollide); lantai rumah = mesh anak tak terlihat bertanda
//     userData.walkFloor (TownWalk memasukkannya sebagai pijakan, lihat walkWorld.js).
//   - jalan yang jadi jembatan dipecah per segitiga: bagian darat tetap mesh lama, bagian
//     laut jadi mesh baru (material kayu) yang dinaikkan; fisika jalan otomatis ikut karena
//     TownWalk membaca geometri jalan apa adanya.
//   - pagar/tiang/lampu jembatan = mesh visual terpisah di grup "PantaiLaut".
import * as THREE from 'three'

export const SEA_FIRST = 18
export const SEA_LAST = 44
const BUILDING_RE = /^TPX_Buildings_(\d+)$/

export const DECK_H = 1.0 // tinggi jembatan & lantai rumah di atas permukaan air (m)
const FLOOR_UP = 0.06 // lantai rumah sedikit di atas jembatan (anti z-fighting di sambungan)
const ZONE_MARGIN = 45 // jalan yang dijadikan jembatan: sekitar rumah laut sejauh ini (m)
const CAP = 1.1 // ujung jalan membulat: setengah lebar + sedikit (m)
const END_MAX = 12 // rumah dianggap "di ujung cabang" kalau ujung jalan sedekat ini ke pusat petaknya
const BRIDGE_HALF = 1.0 // setengah lebar jalan

// ---------------------------------------------------------------------------
// Denah rumah (koordinat LOKAL: x melintang, y dari DEPAN (sisi jembatan) ke
// BELAKANG (laut), z ke atas dengan lantai = 0). Satuan meter.
// ---------------------------------------------------------------------------
export const PLAN = {
  halfW: 5.0, // setengah lebar panggung
  y0: -0.3, // tepi depan panggung (menjorok sedikit ke ujung jembatan)
  y1: 9.0, // tepi belakang (sisi laut)
  slab: 0.3, // tebal papan lantai
  block: { x0: -3.5, x1: 3.5, y0: 1.4, y1: 6.4 }, // badan rumah 7 x 5 m
  wallH: 2.7,
  gap: 1.3, // setengah lebar celah pagar depan (tempat jembatan masuk)
}
const D = PLAN.y1 // kedalaman panggung dari titik depan (y = 0)

// Pintu depan yang bisa dibuka-tutup (mekanisme di TownWalk.jsx). Daun pintu = mesh
// terpisah yang berputar di engsel kiri (x = -0.6), sebidang dengan dinding depan saat tertutup
// dan berayun 90 derajat ke DALAM rumah saat terbuka. Ukurannya pas dengan bukaan pintu
// di houseParts() (x -0.6..0.6, tinggi 2.1 m).
export const DOOR = {
  hingeX: -0.6, // engsel (koordinat lokal rumah)
  hingeY: PLAN.block.y0 + 0.075, // tengah tebal dinding depan (0.15)
  w: 1.2, // lebar daun
  h: 2.08, // tinggi daun (kusen atas di 2.1)
  t: 0.06, // tebal daun
  openAngle: Math.PI / 2 - 0.06, // putaran daun terbuka (rad, ke dalam rumah)
}

const COL = {
  wall: 0xf3efe6, trim: 0x7a5636, deck: 0xb58a5c, fascia: 0x5f4630, pile: 0x6b4a2f,
  oak: 0xd7b88c, tile: 0xc8d4d8, tileKitchen: 0xdcd6c8, rail: 0x7a5636, post: 0x6b4a2f,
  glass: 0xa9cfdf, lamp: 0xffd98a, pergola: 0x8a6240,
  roof: 0x8d8579, roofTrim: 0x5f4630, door: 0x5a3d26,
}

// ---------------------------------------------------------------------------
// Pembangun geometri: segi empat & kotak berwarna (Z ke atas).
// ---------------------------------------------------------------------------
const _c = new THREE.Color()
class Mesher {
  constructor() { this.p = []; this.n = []; this.c = []; this.i = []; this.v = 0 }

  // satu segi empat; a,b,c,d berurutan, normalnya sudah diketahui
  quad(a, b, c, d, nrm, hex) {
    _c.setHex(hex)
    for (const q of [a, b, c, d]) {
      this.p.push(q[0], q[1], q[2]); this.n.push(nrm[0], nrm[1], nrm[2]); this.c.push(_c.r, _c.g, _c.b)
    }
    const v = this.v
    this.i.push(v, v + 1, v + 2, v, v + 2, v + 3)
    this.v += 4
  }

  // segi empat yang arah hadapnya dipilih otomatis: menjauh dari titik `ref`
  quadOut(a, b, c, d, ref, hex) {
    let n = cross3(sub3(b, a), sub3(c, a))
    const l = Math.hypot(n[0], n[1], n[2])
    if (l < 1e-12) return
    n = [n[0] / l, n[1] / l, n[2] / l]
    const mid = [(a[0] + b[0] + c[0] + d[0]) / 4, (a[1] + b[1] + c[1] + d[1]) / 4, (a[2] + b[2] + c[2] + d[2]) / 4]
    if (dot3(n, sub3(mid, ref)) < 0) { this.quad(a, d, c, b, [-n[0], -n[1], -n[2]], hex) } else this.quad(a, b, c, d, n, hex)
  }

  // Kotak lokal b = {x0,x1,y0,y1,z0,z1,c}; T = { ox, oy, oz, c, s } (putar di sumbu z).
  // omit: huruf sisi yang tidak digambar (b bawah, t atas, f -y, k +y, l -x, r +x).
  box(b, T, omit = '') {
    const P = (x, y, z) => [T.ox + x * T.c - y * T.s, T.oy + x * T.s + y * T.c, T.oz + z]
    const N = (nx, ny, nz) => [nx * T.c - ny * T.s, nx * T.s + ny * T.c, nz]
    const { x0, x1, y0, y1, z0, z1 } = b
    const hex = b.c
    if (!omit.includes('r')) this.quad(P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1), N(1, 0, 0), hex)
    if (!omit.includes('l')) this.quad(P(x0, y1, z0), P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), N(-1, 0, 0), hex)
    if (!omit.includes('k')) this.quad(P(x1, y1, z0), P(x0, y1, z0), P(x0, y1, z1), P(x1, y1, z1), N(0, 1, 0), hex)
    if (!omit.includes('f')) this.quad(P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1), N(0, -1, 0), hex)
    if (!omit.includes('t')) this.quad(P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1), N(0, 0, 1), hex)
    if (!omit.includes('b')) this.quad(P(x0, y1, z0), P(x1, y1, z0), P(x1, y0, z0), P(x0, y0, z0), N(0, 0, -1), hex)
  }

  // Balok panjang dari A ke B (kedua ujung boleh beda tinggi), lebar 2*hw, tinggi h0..h1
  // di atas z masing-masing ujung. Hanya atas + dua sisi (bawah & ujung tak terlihat).
  beam(a, b, hw, h0, h1, hex) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy)
    if (L < 1e-6) return
    const vx = -dy / L * hw, vy = dx / L * hw
    const A0 = (s) => [a[0] + s * vx, a[1] + s * vy, a[2] + h0], A1 = (s) => [a[0] + s * vx, a[1] + s * vy, a[2] + h1]
    const B0 = (s) => [b[0] + s * vx, b[1] + s * vy, b[2] + h0], B1 = (s) => [b[0] + s * vx, b[1] + s * vy, b[2] + h1]
    const ref = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2 + (h0 + h1) / 2]
    this.quadOut(A1(-1), B1(-1), B1(1), A1(1), ref, hex)
    this.quadOut(A0(1), B0(1), B1(1), A1(1), ref, hex)
    this.quadOut(A0(-1), B0(-1), B1(-1), A1(-1), ref, hex)
  }

  geometry() {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3))
    g.setIndex(this.v > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1))
    g.computeBoundingSphere()
    g.computeBoundingBox()
    return g
  }
}
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

// ---------------------------------------------------------------------------
// Isi rumah (satu denah untuk semua rumah). Hasil dalam koordinat lokal.
//   solid  : kotak berwarna      glass : kaca (transparan)
//   lamps  : kubus lampu         floor : titik sudut lantai yang bisa dipijak
// ---------------------------------------------------------------------------
const bx = (x0, x1, y0, y1, z0, z1, c) => ({ x0, x1, y0, y1, z0, z1, c })

export function houseParts() {
  const { halfW: W, y0: FY, y1: BY, slab, block: K, wallH: H, gap } = PLAN
  const solid = [] // [kotak, omit]
  const glass = []
  const lamps = []
  const add = (b, omit = '') => solid.push([b, omit])
  const t = 0.15 // tebal dinding luar

  // ---- panggung: papan lantai + lapisan lantai ruangan + bingkai tepi ------
  add(bx(-W, W, FY, BY, -slab, 0, COL.deck), '')
  add(bx(K.x0, K.x1, K.y0, K.y1, 0, 0.02, COL.oak), 'blrkf') // lantai kayu (kamar tidur & ruang tamu)
  add(bx(K.x0, -1.4, K.y0, 3.4, 0, 0.03, COL.tile), 'b') // kamar mandi
  add(bx(1.4, K.x1, 5.0, K.y1, 0, 0.03, COL.tileKitchen), 'b') // dapur
  // bingkai tepi gelap (menutupi sisi papan; menonjol 3 cm di atas lantai = lis)
  const e = 0.04
  add(bx(-W - e, W + e, FY - e, FY, -slab - 0.02, 0.03, COL.fascia), 'b')
  add(bx(-W - e, W + e, BY, BY + e, -slab - 0.02, 0.03, COL.fascia), 'b')
  add(bx(-W - e, -W, FY, BY, -slab - 0.02, 0.03, COL.fascia), 'b')
  add(bx(W, W + e, FY, BY, -slab - 0.02, 0.03, COL.fascia), 'b')
  // tiang pancang (kaki rumah): 3 x 4
  for (const px of [-W + 0.4, 0, W - 0.4]) for (const py of [0.2, 3.1, 6.2, 8.6]) {
    add(bx(px - 0.15, px + 0.15, py - 0.15, py + 0.15, -2.7, -slab, COL.pile), 'tb')
  }

  // ---- dinding badan rumah -------------------------------------------------
  const wall = (x0, x1, y0, y1, z0 = 0, z1 = H, c = COL.wall) => add(bx(x0, x1, y0, y1, z0, z1, c), 'b')
  const gl = (x0, x1, y0, y1, z0, z1) => glass.push(bx(x0, x1, y0, y1, z0, z1, COL.glass))
  const fy0 = K.y0, fy1 = K.y0 + t // dinding depan
  const by0 = K.y1 - t, by1 = K.y1 // dinding belakang (sisi laut)
  // depan: jendela kamar mandi (x -2.9..-1.7), pintu (-0.6..0.6), jendela ruang tamu (1.2..3.0)
  wall(K.x0, -2.9, fy0, fy1)
  wall(-2.9, -1.7, fy0, fy1, 0, 1.4); wall(-2.9, -1.7, fy0, fy1, 2.1, H)
  wall(-1.7, -0.6, fy0, fy1)
  wall(-0.6, 0.6, fy0, fy1, 2.1, H) // kusen atas pintu
  wall(0.6, 1.2, fy0, fy1)
  wall(1.2, 3.0, fy0, fy1, 0, 0.9); wall(1.2, 3.0, fy0, fy1, 2.1, H)
  wall(3.0, K.x1, fy0, fy1)
  gl(-2.9, -1.7, fy0 + 0.055, fy0 + 0.095, 1.4, 2.1); gl(1.2, 3.0, fy0 + 0.055, fy0 + 0.095, 0.9, 2.1)
  add(bx(-0.68, -0.6, fy0 - 0.03, fy1 + 0.03, 0, 2.1, COL.trim), 'b') // kusen pintu
  add(bx(0.6, 0.68, fy0 - 0.03, fy1 + 0.03, 0, 2.1, COL.trim), 'b')
  add(bx(-0.68, 0.68, fy0 - 0.03, fy1 + 0.03, 2.1, 2.16, COL.trim), 'b') // palang atas kusen
  // belakang: pintu geser terbuka ke teras (x -1..1) + kaca mati di kiri-kanannya
  wall(K.x0, -3.0, by0, by1); wall(3.0, K.x1, by0, by1)
  wall(-3.0, -1.0, by0, by1, 0, 0.3); wall(1.0, 3.0, by0, by1, 0, 0.3)
  wall(-3.0, 3.0, by0, by1, 2.1, H)
  gl(-3.0, -1.0, by0 + 0.055, by0 + 0.095, 0.3, 2.1); gl(1.0, 3.0, by0 + 0.055, by0 + 0.095, 0.3, 2.1)
  add(bx(-1.07, -1.0, by0 - 0.03, by1 + 0.03, 0, 2.1, COL.trim), 'b') // kusen pintu geser belakang
  add(bx(1.0, 1.07, by0 - 0.03, by1 + 0.03, 0, 2.1, COL.trim), 'b')
  // samping (di antara dinding depan & belakang)
  const sy0 = fy1, sy1 = by0
  wall(K.x0, K.x0 + t, sy0, 3.2); wall(K.x0, K.x0 + t, 3.2, 4.8, 0, 0.9); wall(K.x0, K.x0 + t, 3.2, 4.8, 2.1, H); wall(K.x0, K.x0 + t, 4.8, sy1)
  wall(K.x1 - t, K.x1, sy0, 2.6); wall(K.x1 - t, K.x1, 2.6, 4.2, 0, 0.9); wall(K.x1 - t, K.x1, 2.6, 4.2, 2.1, H); wall(K.x1 - t, K.x1, 4.2, sy1)
  gl(K.x0 + 0.03, K.x0 + 0.07, 3.2, 4.8, 0.9, 2.1); gl(K.x1 - 0.07, K.x1 - 0.03, 2.6, 4.2, 0.9, 2.1)
  // sekat: kamar mandi (depan-kiri) berpintu ke kamar tidur (belakang-kiri)
  wall(K.x0, -2.6, 3.34, 3.46); wall(-1.7, -0.6, 3.34, 3.46); wall(-2.6, -1.7, 3.34, 3.46, 2.1, H)
  wall(-1.46, -1.34, sy0, 3.34) // sisi timur kamar mandi
  wall(-0.66, -0.54, 3.46, 4.4); wall(-0.66, -0.54, 5.3, sy1); wall(-0.66, -0.54, 4.4, 5.3, 2.1, H) // pintu kamar tidur

  // ---- atap: pelat penuh di atas seluruh badan rumah (tanpa lubang), menjorok 0,45 m.
  // Sisi bawahnya ikut digambar jadi plafon dari dalam.
  const ov = 0.45
  add(bx(K.x0 - ov, K.x1 + ov, K.y0 - ov, K.y1 + ov, H, H + 0.22, COL.roof), '')
  // lis tepi atap
  add(bx(K.x0 - ov - 0.05, K.x1 + ov + 0.05, K.y0 - ov - 0.05, K.y0 - ov, H - 0.06, H + 0.3, COL.roofTrim), '')
  add(bx(K.x0 - ov - 0.05, K.x1 + ov + 0.05, K.y1 + ov, K.y1 + ov + 0.05, H - 0.06, H + 0.3, COL.roofTrim), '')
  add(bx(K.x0 - ov - 0.05, K.x0 - ov, K.y0 - ov, K.y1 + ov, H - 0.06, H + 0.3, COL.roofTrim), '')
  add(bx(K.x1 + ov, K.x1 + ov + 0.05, K.y0 - ov, K.y1 + ov, H - 0.06, H + 0.3, COL.roofTrim), '')

  // ---- pergola teras belakang ---------------------------------------------
  const pg = (x0, x1, y0, y1, z0, z1) => add(bx(x0, x1, y0, y1, z0, z1, COL.pergola), 'b')
  for (const px of [-W + 0.3, W - 0.3]) for (const py of [7.0, 8.7]) pg(px - 0.09, px + 0.09, py - 0.09, py + 0.09, 0, H)
  for (const py of [7.0, 8.7]) pg(-W + 0.1, W - 0.1, py - 0.09, py + 0.09, H, H + 0.18)
  for (let i = 0; i < 9; i++) { const px = -4 + i; pg(px - 0.05, px + 0.05, 6.9, 8.8, H + 0.18, H + 0.26) }

  // ---- pagar keliling panggung (celah di depan tempat jembatan masuk) -------
  const inset = 0.08
  const xL = -W + inset, xR = W - inset, yF = FY + 0.08, yB = BY - inset
  const run = [[-gap, yF], [xL, yF], [xL, yB], [xR, yB], [xR, yF], [gap, yF]]
  const pts = [run[0]]
  for (let i = 1; i < run.length; i++) {
    const a = run[i - 1], b = run[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / 2.0))
    for (let k = 1; k <= n; k++) pts.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n])
  }
  const RAIL_H = 1.05
  const rails = []
  for (const p of pts) add(bx(p[0] - 0.05, p[0] + 0.05, p[1] - 0.05, p[1] + 0.05, 0, RAIL_H, COL.post), 'tb')
  for (let i = 1; i < pts.length; i++) rails.push([pts[i - 1], pts[i]])
  for (const [a, b] of rails) { // pegangan atas & rel tengah (balok sejajar sumbu: kotak biasa)
    const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1])
    const alongX = Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1])
    for (const [z0, z1, c] of [[RAIL_H - 0.07, RAIL_H, COL.rail], [0.5, 0.55, COL.rail]]) {
      add(alongX ? bx(x0, x1, y0 - 0.035, y1 + 0.035, z0, z1, c) : bx(x0 - 0.035, x1 + 0.035, y0, y1, z0, z1, c), alongX ? 'blr' : 'bfk')
    }
  }
  // lampu di empat sudut luar
  for (const [lx, ly] of [[xL, yF], [xR, yF], [xL, yB], [xR, yB]]) lamps.push(bx(lx - 0.1, lx + 0.1, ly - 0.1, ly + 0.1, RAIL_H, RAIL_H + 0.22, COL.lamp))

  // lantai yang bisa dipijak: seluruh panggung (z = 0)
  const floor = [[-W, FY], [W, FY], [W, BY], [-W, BY]]
  return { solid, glass, lamps, floor }
}

// Geometri daun pintu dalam bingkai engsel: engsel di titik asal, daun membentang ke +x,
// gagang di kedua sisi. Dipakai bersama semua rumah.
function doorLeafGeometry() {
  const m = new Mesher()
  const T = { ox: 0, oy: 0, oz: 0, c: 1, s: 0 }
  const ht = DOOR.t / 2
  m.box(bx(0, DOOR.w, -ht, ht, 0, DOOR.h, COL.door), T, 'b')
  m.box(bx(DOOR.w - 0.22, DOOR.w - 0.1, -ht - 0.05, ht + 0.05, 0.95, 1.03, COL.lamp), T, '')
  return m.geometry()
}

// bangun geometri dari kotak-kotak lokal, ditaruh dengan transform T (bingkai rumah)
function meshParts(list, T, mesher = new Mesher()) {
  for (const item of list) {
    const [b, omit] = Array.isArray(item) ? item : [item, '']
    mesher.box(b, T, omit)
  }
  return mesher
}

// ---------------------------------------------------------------------------
// Utilitas geometri 2D
// ---------------------------------------------------------------------------
// potong poligon (array [x,y,z]) dengan setengah bidang f(p) >= 0 (Sutherland-Hodgman)
function clipPoly(poly, f) {
  const out = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length]
    const fa = f(a), fb = f(b)
    if (fa >= 0) out.push(a)
    if ((fa >= 0) !== (fb >= 0)) {
      const t = fa / (fa - fb)
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t])
    }
  }
  return out
}
const area2 = (poly) => { let s = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; s += a[0] * b[1] - b[0] * a[1] } return s }

// Hash ruang segitiga (proyeksi XY) buat pertanyaan "titik ini di dalam permukaan?"
class XYHash {
  constructor(cell = 4) { this.cell = cell; this.map = new Map() }
  add(a, b, c) {
    const x0 = Math.min(a[0], b[0], c[0]), x1 = Math.max(a[0], b[0], c[0]), y0 = Math.min(a[1], b[1], c[1]), y1 = Math.max(a[1], b[1], c[1])
    const tri = [a, b, c]
    for (let j = Math.floor(y0 / this.cell); j <= Math.floor(y1 / this.cell); j++) for (let i = Math.floor(x0 / this.cell); i <= Math.floor(x1 / this.cell); i++) {
      const k = i + ',' + j
      let l = this.map.get(k)
      if (!l) this.map.set(k, (l = []))
      l.push(tri)
    }
  }
  contains(x, y) {
    const l = this.map.get(Math.floor(x / this.cell) + ',' + Math.floor(y / this.cell))
    if (!l) return false
    for (const [a, b, c] of l) {
      const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
      if (Math.abs(d) < 1e-12) continue
      const l0 = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / d
      const l1 = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / d
      if (l0 >= -1e-9 && l1 >= -1e-9 && 1 - l0 - l1 >= -1e-9) return true
    }
    return false
  }
}

function simplifyDP(pts, tol) { // Douglas-Peucker pada polyline terbuka
  if (pts.length < 3) return pts
  let idx = -1, md = tol
  const a = pts[0], b = pts[pts.length - 1]
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy)
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]
    const d = L < 1e-9 ? Math.hypot(p[0] - a[0], p[1] - a[1]) : Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / L
    if (d > md) { md = d; idx = i }
  }
  if (idx < 0) return [a, b]
  return simplifyDP(pts.slice(0, idx + 1), tol).slice(0, -1).concat(simplifyDP(pts.slice(idx), tol))
}

// ---------------------------------------------------------------------------
// Bahan bersama
// ---------------------------------------------------------------------------
let MATS = null
function mats() {
  if (!MATS) {
    MATS = {
      house: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 }),
      glass: new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.45, roughness: 0.08, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide }),
      deck: new THREE.MeshStandardMaterial({ color: 0xa9825a, roughness: 0.9, metalness: 0 }),
      frame: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }),
      lamp: new THREE.MeshBasicMaterial({ color: COL.lamp }),
      invisible: new THREE.MeshBasicMaterial({ visible: false }),
    }
  }
  return MATS
}

// ---------------------------------------------------------------------------
// Baca scene
// ---------------------------------------------------------------------------
const hasAncestor = (obj, prefix, notPrefix) => {
  for (let o = obj; o; o = o.parent) {
    const n = o.name || ''
    if (n.startsWith(prefix) && !(notPrefix && n.startsWith(notPrefix))) return true
  }
  return false
}

// jalur garis tengah jalan (TPX_Roads_N: line strip) -> daftar titik [x,y,z] frame lokal scene
function readCenterlines(scene, inv) {
  const out = []
  const m = new THREE.Matrix4(), v = new THREE.Vector3()
  scene.traverse((o) => {
    if (!o.isLine || !o.geometry || !hasAncestor(o, 'TPX_Roads', 'TPX_RoadsOutlines')) return
    const pos = o.geometry.getAttribute('position')
    if (!pos) return
    m.multiplyMatrices(inv, o.matrixWorld)
    const idx = o.geometry.index
    const n = idx ? idx.count : pos.count
    const pts = []
    for (let k = 0; k < n; k++) {
      v.fromBufferAttribute(pos, idx ? idx.getX(k) : k).applyMatrix4(m)
      pts.push([v.x, v.y, v.z])
    }
    if (pts.length >= 2) out.push({ name: o.name, pts })
  })
  return out
}

function waterLevelOf(scene, inv) {
  const zs = []
  const m = new THREE.Matrix4(), v = new THREE.Vector3()
  scene.traverse((o) => {
    if (!o.isMesh || !o.geometry || !hasAncestor(o, 'TPX_Waterways')) return
    const pos = o.geometry.getAttribute('position')
    if (!pos) return
    m.multiplyMatrices(inv, o.matrixWorld)
    const step = Math.max(1, Math.floor(pos.count / 3000))
    for (let i = 0; i < pos.count; i += step) zs.push(v.fromBufferAttribute(pos, i).applyMatrix4(m).z)
  })
  if (!zs.length) return null
  zs.sort((a, b) => a - b)
  return zs[Math.floor(zs.length / 2)]
}

// ---------------------------------------------------------------------------
// Penempatan: tiap rumah menghadap ke jembatan yang menuju ke sana.
// Hasil per rumah: { o:[x,y] titik tengah tepi depan, h:[hx,hy] arah ke dalam rumah, phi }
// ---------------------------------------------------------------------------
function pathFromEnd(pts) { // jalur dengan indeks terakhir = titik ujung yang dekat rumah
  const cum = [0]
  for (let i = pts.length - 1, k = 0; i > 0; i--, k++) cum.push(cum[k] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
  const rev = pts.slice().reverse() // rev[0] = ujung
  const at = (s) => { // titik pada jarak s dari ujung (menjauh dari rumah)
    if (s <= 0) return rev[0]
    for (let i = 1; i < rev.length; i++) if (cum[i] >= s) { const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1]); return [rev[i - 1][0] + (rev[i][0] - rev[i - 1][0]) * t, rev[i - 1][1] + (rev[i][1] - rev[i - 1][1]) * t] }
    return rev[rev.length - 1]
  }
  return { at, total: cum[cum.length - 1] }
}
const unit2 = (x, y) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l] }

export function placeHouse(center, lines) {
  const [cx, cy] = center
  // ujung jalur terdekat
  let best = null
  for (const ln of lines) for (const atStart of [true, false]) {
    const p = atStart ? ln.pts[0] : ln.pts[ln.pts.length - 1]
    const d = Math.hypot(p[0] - cx, p[1] - cy)
    if (!best || d < best.d) best = { d, ln, atStart }
  }
  let o, h
  if (best && best.d <= END_MAX) {
    const pts = best.atStart ? best.ln.pts.slice().reverse() : best.ln.pts // pts[last] = ujung
    const path = pathFromEnd(pts)
    const E = path.at(0)
    if (best.d <= D / 2 + CAP + 0.4) {
      // cabang menembus ke dalam petak: potong di bibir depan panggung yang berpusat di petak
      let F = E, sF = 0
      for (let s = 0; s <= path.total; s += 0.1) { const p = path.at(s); if (Math.hypot(p[0] - cx, p[1] - cy) >= D / 2 + 0.1) { F = p; sF = s; break } }
      const ahead = path.at(Math.max(0, sF - 1.5)) // sedikit ke arah rumah, buat menghitung arah
      if (Math.hypot(ahead[0] - F[0], ahead[1] - F[1]) < 0.5) {
        // Ujung jalur sudah di luar lingkaran petak (F = ujung, sF ~ 0) -> "ahead" == F dan arahnya
        // jadi (0,0): rumah selalu menghadap utara, jembatan lewat menyamping di depan panggung dan
        // pagarnya menutup jalan ke pintu. Pakai arah jalan masuk (dari 2,5 m sebelum F menuju F).
        const back = path.at(sF + 2.5)
        h = unit2(F[0] - back[0], F[1] - back[1])
      } else {
        h = unit2(ahead[0] - F[0], ahead[1] - F[1])
      }
      o = F
    } else {
      const B = path.at(3.0)
      h = unit2(E[0] - B[0], E[1] - B[1])
      o = [E[0] + h[0] * CAP, E[1] + h[1] * CAP]
    }
  } else {
    // di samping jalan lewat: hadap tegak lurus ke jalan terdekat
    let bd = Infinity, P = null
    for (const ln of lines) for (let i = 0; i + 1 < ln.pts.length; i++) {
      const a = ln.pts[i], b = ln.pts[i + 1], ex = b[0] - a[0], ey = b[1] - a[1], L2 = ex * ex + ey * ey
      const t = L2 ? Math.max(0, Math.min(1, ((cx - a[0]) * ex + (cy - a[1]) * ey) / L2)) : 0
      const q = [a[0] + ex * t, a[1] + ey * t], d = Math.hypot(cx - q[0], cy - q[1])
      if (d < bd) { bd = d; P = q }
    }
    h = unit2(cx - P[0], cy - P[1])
    o = [P[0] + h[0] * BRIDGE_HALF, P[1] + h[1] * BRIDGE_HALF]
  }
  const phi = Math.atan2(-h[0], h[1]) // lokal +y -> arah h
  return { o, h, phi, c: Math.cos(phi), s: Math.sin(phi), center: [o[0] + h[0] * D / 2, o[1] + h[1] * D / 2] }
}

// ---------------------------------------------------------------------------
// Pasang. Aman dipanggil berulang (ditandai di scene.userData).
// ---------------------------------------------------------------------------
export function addPantaiSeaHouses(scene) {
  if (!scene || scene.userData.pantaiLaut) return
  scene.updateWorldMatrix(true, true)
  const inv = new THREE.Matrix4().copy(scene.matrixWorld).invert()

  // balok rumah laut
  const houses = []
  const rel = new THREE.Matrix4()
  scene.traverse((o) => {
    const m = o.isMesh && BUILDING_RE.exec(o.name || '')
    if (!m) return
    const num = Number(m[1])
    if (num < SEA_FIRST || num > SEA_LAST || o.userData.pantaiLaut) return
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox()
    rel.multiplyMatrices(inv, o.matrixWorld)
    const bb = o.geometry.boundingBox.clone().applyMatrix4(rel)
    houses.push({ obj: o, num, rel: rel.clone(), cx: (bb.min.x + bb.max.x) / 2, cy: (bb.min.y + bb.max.y) / 2 })
  })
  const lines = readCenterlines(scene, inv)
  const W = waterLevelOf(scene, inv)
  if (!houses.length || !lines.length || W === null) return
  scene.userData.pantaiLaut = true

  const plateau = W + DECK_H
  const base = plateau + FLOOR_UP // lantai rumah
  const sh = mats()

  // ---- penempatan rumah ----------------------------------------------------
  const placed = houses.map((h) => ({ ...h, ...placeHouse([h.cx, h.cy], lines) }))
  const zone = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  for (const h of placed) {
    zone.x0 = Math.min(zone.x0, h.cx); zone.x1 = Math.max(zone.x1, h.cx)
    zone.y0 = Math.min(zone.y0, h.cy); zone.y1 = Math.max(zone.y1, h.cy)
  }
  zone.x0 -= ZONE_MARGIN; zone.y0 -= ZONE_MARGIN; zone.x1 += ZONE_MARGIN; zone.y1 += ZONE_MARGIN
  const inZone = (x, y) => x >= zone.x0 && x <= zone.x1 && y >= zone.y0 && y <= zone.y1

  // koordinat lokal-rumah dari koordinat scene
  const toLocal = (h, X, Y) => [(X - h.o[0]) * h.c + (Y - h.o[1]) * h.s, -(X - h.o[0]) * h.s + (Y - h.o[1]) * h.c]

  // zona bebas pagar jembatan di sekitar rumah: 1 m di kiri/kanan/belakang panggung,
  // di depan cuma 0,2 m supaya pagar jembatan tetap rapat sampai ke pintu masuk
  const nearHouse = (X, Y) => placed.some((h) => {
    const [lx, ly] = toLocal(h, X, Y)
    return lx > -PLAN.halfW - 1.0 && lx < PLAN.halfW + 1.0 && ly > PLAN.y0 - 0.2 && ly < PLAN.y1 + 1.0
  })

  // ---- jalan -> jembatan ---------------------------------------------------
  const unionHash = new XYHash(4) // seluruh permukaan jalan (darat & jembatan) setelah dipotong
  const bridgeTris = [] // segitiga jembatan (frame scene) buat pagar
  const roadObjs = []
  scene.traverse((o) => { if (o.isMesh && o.geometry && hasAncestor(o, 'TPX_RoadsOutlines') && !o.userData.pantaiLaut) roadObjs.push(o) })

  const v3 = new THREE.Vector3()
  for (const o of roadObjs) {
    const pos = o.geometry.getAttribute('position')
    if (!pos) continue
    const idx = o.geometry.index
    const n = idx ? idx.count : pos.count
    rel.multiplyMatrices(inv, o.matrixWorld)
    const relInv = rel.clone().invert()
    const landTris = [], brTris = []
    let any = false
    for (let k = 0; k + 2 < n; k += 3) {
      const tri = []
      for (let q = 0; q < 3; q++) tri.push(v3.fromBufferAttribute(pos, idx ? idx.getX(k + q) : k + q).applyMatrix4(rel).toArray())
      const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3, cy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3
      const bridge = inZone(cx, cy) && Math.min(tri[0][2], tri[1][2], tri[2][2]) < plateau - 0.02
      if (!bridge) { landTris.push(tri); continue }
      any = true
      let poly = tri.map((p) => [p[0], p[1], Math.max(p[2], plateau)])
      if (area2(poly) < 0) poly = [poly[0], poly[2], poly[1]] // pastikan berlawanan jarum jam dari atas
      // buang bagian yang tertutup panggung rumah (panggung sendiri jadi pijakannya)
      let pieces = [poly]
      for (const h of placed) {
        const lf = (p) => toLocal(h, p[0], p[1])
        const next = []
        for (const pc of pieces) {
          const lp = pc.map(lf)
          const mnx = Math.min(...lp.map((p) => p[0])), mxx = Math.max(...lp.map((p) => p[0]))
          const mny = Math.min(...lp.map((p) => p[1])), mxy = Math.max(...lp.map((p) => p[1]))
          if (mxx <= -PLAN.halfW || mnx >= PLAN.halfW || mxy <= PLAN.y0 || mny >= PLAN.y1) { next.push(pc); continue }
          const A = clipPoly(pc, (p) => PLAN.y0 - lf(p)[1])
          const R = clipPoly(pc, (p) => lf(p)[1] - PLAN.y0)
          const B = clipPoly(R, (p) => lf(p)[1] - PLAN.y1)
          const R2 = clipPoly(R, (p) => PLAN.y1 - lf(p)[1])
          const C = clipPoly(R2, (p) => -PLAN.halfW - lf(p)[0])
          const Dd = clipPoly(R2, (p) => lf(p)[0] - PLAN.halfW)
          for (const pp of [A, B, C, Dd]) if (pp.length >= 3 && Math.abs(area2(pp)) > 1e-6) next.push(pp)
        }
        pieces = next
      }
      for (const pc of pieces) for (let i = 1; i + 1 < pc.length; i++) brTris.push([pc[0], pc[i], pc[i + 1]])
    }
    if (!any) { for (const t of landTris) unionHash.add(t[0], t[1], t[2]); continue }

    // geometri bagian darat (kalau masih ada) & bagian jembatan, dalam koordinat lokal objek
    const mk = (tris, withZ) => {
      const p = new Float32Array(tris.length * 9), nn = new Float32Array(tris.length * 9)
      tris.forEach((t, i) => t.forEach((q, j) => { v3.set(q[0], q[1], q[2]).applyMatrix4(relInv); p.set([v3.x, v3.y, v3.z], i * 9 + j * 3) }))
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(p, 3))
      g.computeVertexNormals()
      return g
    }
    if (landTris.length) o.geometry = mk(landTris); else { o.visible = false; o.userData.replaced = true }
    if (brTris.length) {
      const bm = new THREE.Mesh(mk(brTris), sh.deck)
      bm.name = `${o.name}_Jembatan`
      bm.userData.pantaiLaut = true
      bm.position.copy(o.position); bm.quaternion.copy(o.quaternion); bm.scale.copy(o.scale)
      o.parent.add(bm)
    }
    for (const t of landTris) unionHash.add(t[0], t[1], t[2])
    for (const t of brTris) { unionHash.add(t[0], t[1], t[2]); bridgeTris.push(t) }
  }

  // ---- rangka jembatan: lis tepi, tiang (sekaligus pancang), pagar, lampu ------
  const frame = new Mesher()
  const lamps = new Mesher()
  buildBridgeRails(bridgeTris, unionHash, nearHouse, frame, lamps, W, plateau)

  // ---- rumah -----------------------------------------------------------------
  const parts = houseParts()
  let totalTris = 0
  const doorLeaf = doorLeafGeometry()
  for (const h of placed) {
    const T = { ox: h.o[0], oy: h.o[1], oz: base, c: h.c, s: h.s }
    const relInv = h.rel.clone().invert()
    const toObj = (g) => { g.applyMatrix4(relInv); return g }
    const solid = toObj(meshParts(parts.solid, T).geometry())
    const glassG = toObj(meshParts(parts.glass, T).geometry())
    const flo = new Float32Array(18)
    const fl = parts.floor.map(([x, y]) => [h.o[0] + x * h.c - y * h.s, h.o[1] + x * h.s + y * h.c, base])
    ;[fl[0], fl[1], fl[2], fl[0], fl[2], fl[3]].forEach((p, i) => flo.set(p, i * 3))
    const floorG = toObj(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(flo, 3)))
    meshParts(parts.lamps, T, lamps)

    const obj = h.obj
    obj.geometry = solid
    obj.material = sh.house
    obj.userData.pantaiLaut = true
    obj.userData.pantaiLautInfo = { o: h.o, h: h.h, phi: h.phi }
    const kaca = new THREE.Mesh(glassG, sh.glass)
    kaca.name = `PantaiKacaLaut_${h.num}`
    kaca.renderOrder = 2
    kaca.userData.noCollide = true
    const lantai = new THREE.Mesh(floorG, sh.invisible)
    lantai.name = `PantaiLantaiLaut_${h.num}`
    lantai.visible = false
    lantai.userData.walkFloor = true
    obj.add(kaca, lantai)

    // pintu depan: grup engsel (posisi/arah rumah) + daun yang berputar di dalamnya
    const hm = new THREE.Matrix4().makeRotationZ(h.phi)
    hm.setPosition(
      h.o[0] + DOOR.hingeX * h.c - DOOR.hingeY * h.s,
      h.o[1] + DOOR.hingeX * h.s + DOOR.hingeY * h.c,
      base
    )
    hm.premultiply(relInv)
    const holder = new THREE.Group()
    holder.name = `PantaiPintuLaut_${h.num}`
    hm.decompose(holder.position, holder.quaternion, holder.scale)
    const leaf = new THREE.Mesh(doorLeaf, sh.house)
    leaf.name = `PantaiDaunPintuLaut_${h.num}`
    leaf.userData.noCollide = true // tabrakannya diurus TownWalk (dinamis: hanya saat tertutup)
    leaf.userData.pantaiDoor = { num: h.num, w: DOOR.w, h: DOOR.h, open: DOOR.openAngle }
    holder.add(leaf)
    obj.add(holder)
    totalTris += solid.index.count / 3
  }

  const group = new THREE.Group()
  group.name = 'PantaiLaut'
  const fm = new THREE.Mesh(frame.geometry(), sh.frame)
  fm.name = 'PantaiJembatanRangka'
  fm.userData.noCollide = true
  const lm = new THREE.Mesh(lamps.geometry(), sh.lamp)
  lm.name = 'PantaiLampuLaut'
  lm.userData.noCollide = true
  group.add(fm, lm)
  scene.add(group)
  scene.userData.pantaiLautInfo = { houses: placed.length, houseTris: totalTris, frameTris: frame.i.length / 3, bridgeTris: bridgeTris.length }
}

// ---------------------------------------------------------------------------
// Pagar jembatan dari tepi segitiga jembatan.
// ---------------------------------------------------------------------------
const POST_STEP = 1.8 // jarak tiang maksimum (m)
const FINE_STEP = 0.1 // resolusi uji tepi (m): ujung pagar presisi sampai ~10 cm
const EDGE_PROBE = 0.14 // titik uji di sebelah luar tepi (m)
const MIN_RUN = 0.12 // pagar lebih pendek dari ini dibuang (serpihan)
const RAIL_TOP = 1.0
const PILE_BELOW = 0.8 // tiang menembus sedalam ini di bawah permukaan air
const LIP = 0.05 // lis tepi menonjol di atas dek

function buildBridgeRails(tris, unionHash, nearHouse, frame, lamps, W, plateau) {
  const q = (v) => Math.round(v * 100)
  const vk = (p) => q(p[0]) + ',' + q(p[1])
  // sisi berarah yang tidak punya pasangan = tepi permukaan
  const dir = new Map()
  for (const t of tris) for (let i = 0; i < 3; i++) dir.set(vk(t[i]) + '>' + vk(t[(i + 1) % 3]), [t[i], t[(i + 1) % 3]])
  const edges = []
  for (const [k, e] of dir) { const [a, b] = k.split('>'); if (!dir.has(b + '>' + a)) edges.push(e) }
  // rantai sisi jadi garis tepi menerus
  const byStart = new Map()
  for (const e of edges) { const k = vk(e[0]); (byStart.get(k) || byStart.set(k, []).get(k)).push(e) }
  const used = new Set()
  const loops = []
  for (const e0 of edges) {
    if (used.has(e0)) continue
    const pts = [e0[0], e0[1]]
    used.add(e0)
    let cur = e0
    for (;;) {
      const cand = (byStart.get(vk(cur[1])) || []).find((x) => !used.has(x))
      if (!cand) break
      used.add(cand); pts.push(cand[1]); cur = cand
      if (vk(cand[1]) === vk(pts[0])) break
    }
    loops.push(pts)
  }

  const postKeys = new Set()
  const pieces = [] // { a, b, out:[nx,ny] }
  for (const loop of loops) {
    const closed = vk(loop[0]) === vk(loop[loop.length - 1])
    let line = loop
    if (closed && loop.length > 4) { // putus di titik terjauh dari awal supaya DP punya dua jangkar
      let fi = 0, fd = -1
      for (let i = 1; i < loop.length - 1; i++) { const d = Math.hypot(loop[i][0] - loop[0][0], loop[i][1] - loop[0][1]); if (d > fd) { fd = d; fi = i } }
      line = simplifyDP(loop.slice(0, fi + 1), 0.1).slice(0, -1).concat(simplifyDP(loop.slice(fi), 0.1))
    } else line = simplifyDP(loop, 0.1)
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i], b = line[i + 1]
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy)
      if (L < 0.05) continue
      const on = [dy / L, -dx / L] // arah keluar (permukaan di kiri sisi berarah)
      // Uji tiap FINE_STEP meter: tepi yang di sebelah luarnya ada permukaan lain (persimpangan /
      // sambungan darat) bukan tepi, dan sekitar rumah dikosongkan. Langkah yang lolos
      // digabung jadi "lari" menerus, jadi ujung pagar jatuh tepat di batas persimpangan
      // (bukan terpotong kelipatan 1,8 m yang meleset atau menyeberangi jalan).
      const n = Math.max(1, Math.ceil(L / FINE_STEP))
      const keep = new Array(n)
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n
        const x = a[0] + dx * t, y = a[1] + dy * t
        keep[k] = !unionHash.contains(x + on[0] * EDGE_PROBE, y + on[1] * EDGE_PROBE) && !nearHouse(x, y)
      }
      const at = (t) => [a[0] + dx * t, a[1] + dy * t, a[2] + (b[2] - a[2]) * t]
      for (let k = 0; k < n;) {
        if (!keep[k]) { k++; continue }
        let j = k
        while (j < n && keep[j]) j++
        const s0 = k / n, s1 = j / n, run = (s1 - s0) * L
        if (run >= MIN_RUN) {
          const m = Math.max(1, Math.ceil(run / POST_STEP)) // tiang tiap <= POST_STEP
          for (let u = 0; u < m; u++) {
            pieces.push({ a: at(s0 + ((s1 - s0) * u) / m), b: at(s0 + ((s1 - s0) * (u + 1)) / m), out: on })
          }
        }
        k = j
      }
    }
  }

  const ident = { ox: 0, oy: 0, oz: 0, c: 1, s: 0 }
  let postNo = 0
  const post = (p) => {
    const k = q(p[0]) + ',' + q(p[1])
    if (postKeys.has(k)) return
    postKeys.add(k)
    const z0 = W - PILE_BELOW
    frame.box({ x0: p[0] - 0.06, x1: p[0] + 0.06, y0: p[1] - 0.06, y1: p[1] + 0.06, z0, z1: p[2] + RAIL_TOP, c: COL.post }, ident, 'tb')
    if (postNo++ % 6 === 0) lamps.box({ x0: p[0] - 0.1, x1: p[0] + 0.1, y0: p[1] - 0.1, y1: p[1] + 0.1, z0: p[2] + RAIL_TOP, z1: p[2] + RAIL_TOP + 0.2, c: COL.lamp }, ident, '')
  }
  for (const pc of pieces) {
    const { a, b, out } = pc
    frame.beam(a, b, 0.04, RAIL_TOP - 0.07, RAIL_TOP, COL.rail)
    frame.beam(a, b, 0.025, 0.5, 0.55, COL.rail)
    // lis tepi gelap (sisi luar papan): dari 0.3 m di bawah dek sampai sedikit di atasnya
    const ao = [a[0] + out[0] * 0.02, a[1] + out[1] * 0.02], bo = [b[0] + out[0] * 0.02, b[1] + out[1] * 0.02]
    frame.quadOut([ao[0], ao[1], a[2] - 0.3], [bo[0], bo[1], b[2] - 0.3], [bo[0], bo[1], b[2] + LIP], [ao[0], ao[1], a[2] + LIP],
      [(a[0] + b[0]) / 2 - out[0], (a[1] + b[1]) / 2 - out[1], (a[2] + b[2]) / 2], COL.fascia)
    post(a); post(b)
  }
}
