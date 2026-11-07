// Mengganti rumah-rumah LPM (node "TPX_Buildings_N" di lpm.glb) dengan tampak
// luar "Rumah LPM" 2 lantai yang sama dengan interiornya (lib/houseInteriorLpm.js).
//
// Dipakai di dua tempat: TownMap3D (tampilan peta) dan TownWalk (mode Jelajahi).
// Fungsinya bekerja langsung di `scene` (frame lokal glb: Z ke atas), jadi
// otomatis ikut rotasi/posisi yang dipasang pemanggilnya. Polanya mengikuti
// lib/pantaiHouses.js (Kawasan Pantai).
//
// Tiap rumah lama: disembunyikan (userData.replaced), lalu rumah baru ditaruh
// di slot sepanjang jalan baru (lihat computeLpmPlacement), menghadap jalan,
// dengan jalur masuk yang jelas. Rumah yang tidak kebagian slot ikut
// disembunyikan (petaknya jadi ruang hijau).
import * as THREE from 'three'
import { buildStaticBoxes, PW, PD, BALKON_D } from './houseInteriorLpm'
import { boxesToGeometry } from './pantaiHouses'
import { buildWalkWorld } from './walkWorld'

const HOUSE_RE = /^TPX_Buildings_(\d+)$/
// Dimensi model (denah): lebar PW (12) + atap menjorok 0.45 kiri-kanan;
// kedalaman PD (10) + balkon/teras di depan + atap menjorok.
export const MODEL_W = PW + 0.9
export const MODEL_D = PD + BALKON_D + 0.9
const FRONT_MIN_Z = -(BALKON_D + 0.05) // sisi terdepan (pelat balkon lantai 2 / teras)
const MIN_SCALE = 0.7
const GAP = 1.5 // jarak minimum antar rumah (meter)
const MAX_SHIFT = 9 // rumah boleh digeser sejauh ini dari titik aslinya (meter)
const BODY_H = 7.0

// Carport & pagar (denah, di depan rumah; dicerminkan bersama rumah, jadi di
// model akhirnya carport ada di sisi berlawanan dari denah -- simetris dengan
// pintu & celah pagar, lihat komentar di shared()).
const CARPORT = { x0: 8.5, x1: 11.5, y0: -4.8, y1: 0, roofH: 2.6 } // depan-kanan denah
const FENCE_Y = -4.8 // garis pagar depan (denah)
const FENCE_H = 0.9 // pagar rendah
const FENCE_GAPS = [[3, 7], [CARPORT.x0, CARPORT.x1]] // celah: jalan setapak (teras) & carport

// Tinggi lantai & pondasi. Tanah LPM datar (dasar bangunan lama minZ -0.03 di
// mana-mana), jadi lantai ditaruh di tanah tertinggi di bawah tapak; sisi yang
// lebih rendah ditutup pondasi (sama seperti Pantai, buat jaga-jaga).
const FLOOR_LIFT = 0.05 // lantai sedikit di atas tanah tertinggi (anti z-fighting)
const GROUND_GRID = 11 // titik sampel tanah per sisi tapak
const FOUND_D = 1.2 // tebal pondasi bawaan model (sebelum diskala)
const FOUND_C = 0x3d4248 // warna pondasi bawaan model
const FOUND_STEP = 0.25 // pondasi tambahan dibulatkan ke atas per langkah ini (model)
const FOUND_MARGIN = 0.15 // pondasi tambahan menembus sedikit ke tanah (meter)
const COLLIDE_MIN_DROP = 0.3 // tabrakan pondasi dipasang kalau lantai setinggi ini di atas tanah terendah

// ---------------------------------------------------------------------------
// Penempatan rumah (murni JavaScript, tanpa three.js, supaya bisa dites di Node).
//
// Rumah ditaruh di slot sepanjang jalan baru (lihat bagian "Jaringan jalan baru"
// di bawah): tiap slot menghadap jalan, teras di tanah, ada jalan keluar.
// doorFixPass memperbaiki teras yang bermasalah (putar/geser kecil); kalau
// masih gagal, relocateHouses menggesernya sepanjang jalan.
// Lihat ~/workspace/lpm-work/test_layout_curved.mjs buat angka validasinya
// (data GLB asli).
// ---------------------------------------------------------------------------
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]]

export function rectOf(h) {
  const alongY = h.fx === 0
  return { cx: h.cx, cy: h.cy, w: (alongY ? MODEL_W : MODEL_D) * h.k, d: (alongY ? MODEL_D : MODEL_W) * h.k }
}
function rectsOverlap(a, b) {
  return Math.abs(a.cx - b.cx) * 2 < a.w + b.w && Math.abs(a.cy - b.cy) * 2 < a.d + b.d
}
function pointInRect(px, py, r, pad = 0) {
  return Math.abs(px - r.cx) <= r.w / 2 + pad && Math.abs(py - r.cy) <= r.d / 2 + pad
}
// pusat teras: 1.5 m di depan fasad, tengah lebar pintu
export function porchCenter(h) {
  const r = rectOf(h)
  const fd = h.fx === 0 ? r.d : r.w
  return { x: h.cx + h.fx * (fd / 2 + 1.5), y: h.cy + h.fy * (fd / 2 + 1.5) }
}
function porchBlocked(p, all, selfNum) {
  for (const o of all) {
    if (o.num === selfNum) continue
    if (pointInRect(p.x, p.y, rectOf(o), 0.5)) return true
  }
  return false
}
function porchExit(p, all, selfNum, onLand) {
  for (const [ex, ey] of DIRS) {
    const x = p.x + ex * 2.5, y = p.y + ey * 2.5
    if (!onLand(x, y)) continue
    let inside = false
    for (const o of all) {
      if (o.num === selfNum) continue
      if (pointInRect(x, y, rectOf(o), 0.5)) { inside = true; break }
    }
    if (!inside) return true
  }
  return false
}
export function doorOk(h, all, onLand) {
  const p = porchCenter(h)
  return onLand(p.x, p.y) && !porchBlocked(p, all, h.num) && porchExit(p, all, h.num, onLand)
}
function overlapsAny(h, all) {
  for (const o of all) {
    if (o.num === h.num) continue
    if (rectsOverlap(rectOf(h), rectOf(o))) return true
  }
  return false
}
// jumlah tetangga yang jaraknya dari rumah ini kurang dari GAP (1.5 m).
// Dipakai post-pass: perbaikan pintu boleh diterima selama tidak MENAMBAH
// pelanggaran jarak (relaksasi sendiri sudah menyisakan 1 pasang yang tidak
// bisa dipisah lagi di skala min / geser maks, jadi yang sudah ada dibiarkan).
function gapViolationsOf(h, all) {
  let n = 0
  const a = rectOf(h)
  for (const o of all) {
    if (o.num === h.num) continue
    const b = rectOf(o)
    if (Math.abs(a.cx - b.cx) * 2 < a.w + b.w + GAP * 2 && Math.abs(a.cy - b.cy) * 2 < a.d + b.d + GAP * 2) n++
  }
  return n
}

// Pusat + 4 sudut tapak rumah di tanah yang bisa dipijak (bukan air).
export function footprintOnLand(h, onLand) {
  const r = rectOf(h)
  return [[r.cx, r.cy],
    [r.cx - r.w / 2, r.cy - r.d / 2], [r.cx + r.w / 2, r.cy - r.d / 2],
    [r.cx - r.w / 2, r.cy + r.d / 2], [r.cx + r.w / 2, r.cy + r.d / 2]]
    .every(([x, y]) => onLand(x, y))
}

// Pass perbaikan pintu (dulu langkah 3 inline di computeLpmPlacement): rumah
// yang terasnya bermasalah diputar 180° (gratis: rect simetris), lalu ±90°,
// lalu digeser (ke arah posisi asal / searah sumbu, maks 3 m), selama tidak
// menimbulkan tumpang tindih dan tidak melewati geser maks 9 m dari posisi
// asal. Diulang sampai fixpoint (maks 3 ronde) karena memutar/menggeser satu
// rumah bisa membebaskan atau justru menutup teras tetangganya.
export function doorFixPass(infos, onLand) {
  for (let round = 0; round < 3; round++) {
    let changed = false
    for (const h of infos) {
      if (doorOk(h, infos, onLand)) continue
      const orig = { fx: h.fx, fy: h.fy, cx: h.cx, cy: h.cy }
      const gapBefore = gapViolationsOf(h, infos)
      // perbaikan diterima kalau tidak tumpang tindih, tidak melewati geser
      // maks 9 m dari posisi asal, dan (kalau mungkin) tidak menambah
      // pelanggaran jarak (GAP) dengan tetangga. Dicoba dulu yang menghormati
      // GAP; kalau tidak ada, baru yang biasa (seperti v5b) supaya pintu tetap
      // bisa diperbaiki -- jalur masuk lebih penting daripada jarak 1.5 m.
      const fits = (gapAware) => (
        !overlapsAny(h, infos)
        && Math.hypot(h.cx - h.x0, h.cy - h.y0) <= MAX_SHIFT + 1e-9
        && (!gapAware || gapViolationsOf(h, infos) <= gapBefore)
      )
      // (a) putar 180° (gratis: rect simetris, tidak menimbulkan tumpang tindih)
      h.fx = -orig.fx; h.fy = -orig.fy
      if (doorOk(h, infos, onLand)) { changed = true; continue }
      // (b) putar ±90°, (c) geser ke arah posisi asal, (d) geser searah sumbu:
      // tiap cara dicoba dulu dengan GAP, lalu tanpa GAP.
      let done = false
      for (const gapAware of [true, false]) {
        if (done) break
        for (const [fx, fy] of [[-orig.fy, orig.fx], [orig.fy, -orig.fx]]) {
          h.fx = fx; h.fy = fy
          if (fits(gapAware) && doorOk(h, infos, onLand)) { done = true; changed = true; break }
        }
        if (done) break
        h.fx = orig.fx; h.fy = orig.fy
        const dx = h.x0 - h.cx, dy = h.y0 - h.cy, dist = Math.hypot(dx, dy)
        if (dist > 0.01) {
          const ux = dx / dist, uy = dy / dist
          for (let step = 0.5; step <= Math.min(3, dist) + 1e-9; step += 0.5) {
            h.cx = orig.cx + ux * step; h.cy = orig.cy + uy * step
            if (fits(gapAware) && doorOk(h, infos, onLand)) { done = true; changed = true; break }
          }
        }
        if (done) break
        for (const [nx, ny] of DIRS) {
          let ok = false
          for (let step = 0.5; step <= 3 + 1e-9; step += 0.5) {
            h.cx = orig.cx + nx * step; h.cy = orig.cy + ny * step
            if (fits(gapAware) && doorOk(h, infos, onLand)) { done = true; changed = true; ok = true; break }
          }
          if (ok) break
          h.cx = orig.cx; h.cy = orig.cy
        }
      }
      if (!done) { h.cx = orig.cx; h.cy = orig.cy; h.fx = orig.fx; h.fy = orig.fy }
    }
    if (!changed) break
  }
}

// ---------------------------------------------------------------------------
// Jaringan jalan baru (layout perumahan) + penempatan rumah di sepanjang jalan.
//
// Dulu: rumah ditaruh di titik node lama (relaksasi + relokasi). Sekarang:
// jalan-jalan melengkung (Catmull-Rom) digambar dulu sebagai jaringan
// perumahan, lalu rumah ditaruh di slot sepanjang kedua sisi jalan,
// menghadap jalan, dengan halaman depan ~3 m. Jalan lama GLB disembunyikan
// (hideOldRoads) dan jalan baru digambar prosedural (buildLpmRoadTriangles).
//
// Frame lokal: x 0..207 (barat->timur), y 0..150 (utara->selatan, y = -z dunia).
// ---------------------------------------------------------------------------
const ROAD_HALF = 2 // setengah lebar jalan baru (lebar 4 m)
const YARD = 3 // halaman depan: rect rumah -> tepi jalan (m)
const SIDE_GAP_MIN = 2 // gap samping antar rumah, minimum (m); target 3 m
const JUNCTION_CLEAR = 8 // pusat slot harus sejauh ini dari persimpangan (m)
const SCALE_STEPS = [1.0, 0.9, 0.8, 0.7] // dicoba dari besar ke kecil
const DASH_ON = 1.6 // garis tengah putus-putus: panjang garis (m)
const DASH_OFF = 1.6 // ...dan celahnya (m)
const DASH_HALF_W = 0.07 // setengah lebar garis tengah (m)
const ROAD_ASPHALT = 0x646464 // warna aspal (sama dengan jalan GLB)
const ROAD_LINE = 0xd8c33c // warna garis tengah kuning

// Persimpangan jaringan jalan (dipakai JUNCTION_CLEAR + kandidat billboard).
// Termasuk titik sambung cabang (S1->R3, S3->R2).
const LPM_JUNCTIONS = [[64, 39], [46, 72], [26, 105], [188, 46], [186, 77], [95, 103]]

// Jalan utama (desain pertama, terverifikasi 49 rumah):
// R1/R2/R3 = jalan timur-barat melengkung; CW = konektor barat (R3->R2->R1);
// CE = konektor timur (R1->R2). `bulb` = ujung bundar (cul-de-sac) di ujung timur R3.
const LPM_ROADS = [
  { id: 'R1', pts: [[64, 39], [88, 40], [112, 42], [135, 41], [155, 44], [172, 45], [188, 46]] },
  { id: 'R2', pts: [[46, 72], [75, 70], [105, 72], [135, 71], [150, 74], [160, 75], [186, 77]] },
  { id: 'R3', pts: [[26, 105], [55, 101], [85, 104], [112, 102], [138, 103], [144, 102]], bulb: 3 },
  { id: 'CW', pts: [[26, 105], [38, 88], [46, 72], [55, 55], [64, 39]] },
  { id: 'CE', pts: [[188, 46], [187, 61], [186, 77]] },
]
// Jalan sambungan (cabang) ke lobus selatan & strip timur -- tahap 2.
// S1 = tulang punggung lobus selatan: dari R3 (95,103) melengkung ke selatan,
// ujung bundar (cul-de-sac) di ujung lobus (88,132). Rumah di kedua sisi.
// S3 = strip timur teluk: dari R2 (163,75) ke selatan, ujung bundar (162,99).
// Cabang diproses SEBELUM jalan utama (lihat sampleLpmRoads) supaya rumah
// jalan utama mengalah di titik sambung (jalur cabang bersih, tidak menembus
// rumah yang sudah ada).
const LPM_BRANCHES = [
  { id: 'S1', pts: [[95, 103], [93, 112], [94, 120], [90, 128], [88, 132]], bulb: 3 },
]

// Sampel satu kurva Catmull-Rom (uniform) tiap ~1 m busur.
// Mengembalikan { id, pts, nrm, tan, arc, len, bulb }.
// pts: [[x, y], ...]; nrm: normal satuan (-ty, tx); tan: tangen satuan;
// arc: jarak busur dari awal; len: panjang total.
export function sampleRoadCurve(id, ctrl, bulb = 0) {
  const dense = []
  const n = ctrl.length
  const P = (i) => ctrl[Math.max(0, Math.min(n - 1, i))]
  for (let i = 0; i < n - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2)
    const steps = Math.max(4, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) * 4))
    for (let s = 0; s < steps; s++) {
      const t = s / steps
      const t2 = t * t, t3 = t2 * t
      const x = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3)
      const y = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
      dense.push([x, y])
    }
  }
  dense.push(ctrl[n - 1].slice())
  // panjang busur kumulatif, lalu sampel ulang tiap 1 m
  const cum = [0]
  for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]))
  const len = cum[cum.length - 1]
  const pts = []
  let j = 0
  for (let a = 0; a <= len; a += 1) {
    while (j < cum.length - 2 && cum[j + 1] < a) j++
    const segLen = cum[j + 1] - cum[j] || 1
    const f = Math.max(0, Math.min(1, (a - cum[j]) / segLen))
    pts.push([dense[j][0] + (dense[j + 1][0] - dense[j][0]) * f, dense[j][1] + (dense[j + 1][1] - dense[j][1]) * f])
  }
  // pastikan titik akhir persis di ujung
  const last = pts[pts.length - 1], end = ctrl[n - 1]
  if (Math.hypot(last[0] - end[0], last[1] - end[1]) > 0.01) pts.push(end.slice())
  const arc = [], tan = [], nrm = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]
    let tx = b[0] - a[0], ty = b[1] - a[1]
    const l = Math.hypot(tx, ty) || 1
    tx /= l; ty /= l
    tan.push([tx, ty])
    nrm.push([-ty, tx])
    arc.push(i === 0 ? 0 : arc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
  }
  return { id, pts, nrm, tan, arc, len: arc[arc.length - 1], bulb }
}

export function sampleLpmRoads() {
  // Cabang dulu, baru jalan utama: slot cabang diterima lebih dulu, jadi
  // rumah jalan utama yang berdekatan dengan jalur cabang ditolak
  // (uji "jalan lain" di buildSlots) dan persimpangan tetap bersih.
  return [...LPM_BRANCHES, ...LPM_ROADS].map((r) => sampleRoadCurve(r.id, r.pts, r.bulb || 0))
}

// Segitiga jalan baru (frame lokal: [x, y, z=tinggi]).
// groundY(x, y) = tinggi tanah dunia lama di titik itu (atau null kalau di air).
// Mengembalikan [{ name, tris, color, noCollide }]:
//  - aspal: pita 4 m mengikuti tanah (+0.02), sampel tiap 2 m, + kipas cul-de-sac
//  - garis tengah: kuning putus-putus 1.6/1.6 m (visual saja, noCollide)
export function buildLpmRoadTriangles(groundY) {
  const segs = sampleLpmRoads()
  const asphalt = []
  const line = []
  const hAt = (x, y, fallback) => {
    const g = groundY(x, y)
    return g === null || g === undefined ? fallback : g + 0.02
  }
  // titik di busur `a` pada segmen (interpolasi titik + normal)
  const at = (seg, a) => {
    let i = 0
    while (i < seg.arc.length - 2 && seg.arc[i + 1] < a) i++
    const f = (a - seg.arc[i]) / ((seg.arc[i + 1] - seg.arc[i]) || 1)
    return [
      seg.pts[i][0] + (seg.pts[i + 1][0] - seg.pts[i][0]) * f,
      seg.pts[i][1] + (seg.pts[i + 1][1] - seg.pts[i][1]) * f,
      seg.nrm[i][0] + (seg.nrm[i + 1][0] - seg.nrm[i][0]) * f,
      seg.nrm[i][1] + (seg.nrm[i + 1][1] - seg.nrm[i][1]) * f,
    ]
  }
  for (const seg of segs) {
    const { pts, nrm } = seg
    // --- aspal: quad tiap 2 m ---
    let prevH = 0
    for (let i = 0; i < pts.length - 1; i += 2) {
      const i2 = Math.min(i + 2, pts.length - 1)
      const [x0, y0] = pts[i], [x1, y1] = pts[i2]
      const [nx0, ny0] = nrm[i], [nx1, ny1] = nrm[i2]
      const h0 = hAt(x0, y0, prevH), h1 = hAt(x1, y1, h0)
      prevH = h1
      const L0 = [x0 + nx0 * ROAD_HALF, y0 + ny0 * ROAD_HALF, h0]
      const R0 = [x0 - nx0 * ROAD_HALF, y0 - ny0 * ROAD_HALF, h0]
      const L1 = [x1 + nx1 * ROAD_HALF, y1 + ny1 * ROAD_HALF, h1]
      const R1 = [x1 - nx1 * ROAD_HALF, y1 - ny1 * ROAD_HALF, h1]
      asphalt.push(...L0, ...R0, ...R1, ...L0, ...R1, ...L1)
    }
    // --- garis tengah putus-putus ---
    for (let s = 0; s + DASH_ON <= seg.len; s += DASH_ON + DASH_OFF) {
      const [ax, ay, anx, any] = at(seg, s)
      const [bx, by, bnx, bny] = at(seg, s + DASH_ON)
      const ha = hAt(ax, ay, prevH) + 0.025, hb = hAt(bx, by, ha - 0.025) + 0.025
      const aL = [ax + anx * DASH_HALF_W, ay + any * DASH_HALF_W, ha]
      const aR = [ax - anx * DASH_HALF_W, ay - any * DASH_HALF_W, ha]
      const bL = [bx + bnx * DASH_HALF_W, by + bny * DASH_HALF_W, hb]
      const bR = [bx - bnx * DASH_HALF_W, by - bny * DASH_HALF_W, hb]
      line.push(...aL, ...aR, ...bR, ...aL, ...bR, ...bL)
    }
    // --- kipas cul-de-sac di ujung ---
    if (seg.bulb > 0) {
      const [cx, cy] = pts[pts.length - 1]
      const h = hAt(cx, cy, prevH)
      const N = 10
      for (let k = 0; k < N; k++) {
        const a0 = (k / N) * Math.PI * 2, a1 = ((k + 1) / N) * Math.PI * 2
        asphalt.push(cx, cy, h,
          cx + Math.cos(a0) * seg.bulb, cy + Math.sin(a0) * seg.bulb, h,
          cx + Math.cos(a1) * seg.bulb, cy + Math.sin(a1) * seg.bulb, h)
      }
    }
  }
  return [
    { name: 'TPX_RoadsOutlines_Lpm_Asphalt', tris: asphalt, color: ROAD_ASPHALT },
    { name: 'TPX_RoadsOutlines_Lpm_Center', tris: line, color: ROAD_LINE, noCollide: true },
  ]
}

// Sembunyikan jalan lama GLB (semua mesh di bawah ancestor TPX_Roads*):
// visible=false (tidak tampil di Peta/Jelajahi) + userData.replaced=true
// (dikeluarkan dari ekstraktor dunia jalan di TownWalk/TownMap3D).
// HARUS dipanggil sebelum jalan baru ditambah (jalan baru juga berawalan TPX_Roads).
export function hideOldRoads(scene) {
  scene.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry) return
    for (let o = obj; o; o = o.parent) {
      if ((o.name || '').startsWith('TPX_Roads')) {
        obj.visible = false
        obj.userData.replaced = true
        break
      }
    }
  })
}

// jarak tepi-ke-tepi antar dua AABB (0 bila bersentuhan, negatif bila tumpang tindih)
export function edgeGap(a, b) {
  const gx = Math.abs(a.cx - b.cx) - (a.w + b.w) / 2
  const gy = Math.abs(a.cy - b.cy) - (a.d + b.d) / 2
  if (gx > 0 && gy > 0) return Math.hypot(gx, gy)
  if (gx > 0 || gy > 0) return Math.max(gx, gy)
  return -Math.min(-gx, -gy)
}

// Bangun daftar slot (posisi + arah hadap) buat satu skala k.
// Tiap sisi jalan dijalani sepanjang garis tengah; slot diterima kalau:
//   - tapak (pusat + 4 sudut rect) di tanah, dan teras di tanah,
//   - pusat slot >= JUNCTION_CLEAR dari semua persimpangan,
//   - rect >= ROAD_HALF + 1 m dari garis tengah jalan LAIN,
//   - rect (diperluas SIDE_GAP_MIN/2) tidak tumpang tindih slot yang sudah diterima,
//   - jarak busur dari slot sebelumnya di sisi yang sama >= W + SIDE_GAP_MIN.
// Mengembalikan { bySide: [slot, ...] } (satu list per sisi jalan).
export function buildSlots(k, onLand, roadSegs, opts = {}) {
  const W = MODEL_W * k, D = MODEL_D * k
  // Opsi (kota baru mengisi sendiri; default = nilai LPM, perilaku LPM tidak berubah):
  // roadHalf = setengah lebar jalan (boleh beda per segmen via seg.half),
  // yard = halaman depan, sideGapMin = gap samping minimum,
  // junctions = titik persimpangan (JUNCTION_CLEAR), blockedRects = tapak
  // fasilitas [{x0,y0,x1,y1}] yang tidak boleh ditabrak rumah.
  const ROAD_HALF_O = opts.roadHalf ?? ROAD_HALF
  const YARD_O = opts.yard ?? YARD
  const SIDE_GAP_MIN_O = opts.sideGapMin ?? SIDE_GAP_MIN
  const JUNCTIONS_O = opts.junctions ?? LPM_JUNCTIONS
  const BLOCKED_O = opts.blockedRects ?? []
  // onlySegs: cuma segmen-segmen ini yang dibuatkan slot (mis. kota: sekunder
  // saja, ring highway tidak); segmen lain tetap dihitung di uji "jalan lain".
  const ONLY = opts.onlySegs ? new Set(opts.onlySegs) : null
  const accepted = []
  const bySide = []
  // bounding box tiap segmen (buat mempercepat uji "jalan lain")
  const boxes = roadSegs.map((seg) => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const [x, y] of seg.pts) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x)
      minY = Math.min(minY, y); maxY = Math.max(maxY, y)
    }
    return { minX, maxX, minY, maxY }
  })
  const expandedOverlap = (a, b) => {
    // tolak kalau rect (diperluas SIDE_GAP_MIN/2 tiap sisi) bersentuhan:
    // |dx|*2 < aw+bw + SIDE_GAP_MIN*2  <=>  celah tepi < SIDE_GAP_MIN
    const pad = SIDE_GAP_MIN_O
    return Math.abs(a.cx - b.cx) * 2 < a.w + b.w + pad * 2 && Math.abs(a.cy - b.cy) * 2 < a.d + b.d + pad * 2
  }
  // jarak titik ke garis tengah segmen (pakai titik sampel 1 m; cukup akurat)
  const distToSeg = (x, y, seg) => {
    let best = Infinity
    for (const [px, py] of seg.pts) {
      const d = (px - x) ** 2 + (py - y) ** 2
      if (d < best) best = d
    }
    return Math.sqrt(best)
  }
  for (let si = 0; si < roadSegs.length; si++) {
    const seg = roadSegs[si]
    if (ONLY && !ONLY.has(seg.id)) continue
    for (const side of [1, -1]) {
      const list = []
      let lastArc = -Infinity
      for (let i = 0; i < seg.pts.length; i++) {
        if (seg.arc[i] - lastArc < W + SIDE_GAP_MIN_O) continue
        const [px, py] = seg.pts[i]
        const [nx, ny] = seg.nrm[i]
        // arah hadap = ke jalan, dibulatkan ke 4 arah mata angin
        const fx = Math.abs(nx) > Math.abs(ny) ? -Math.sign(nx) * side : 0
        const fy = fx === 0 ? -Math.sign(ny) * side : 0
        // Tapak axis-aligned menjorok lebih jauh ke arah normal kalau jalannya
        // diagonal: jarak pusat ke tepi depan sepanjang normal =
        // (D/2)*cos + (W/2)*sin, dengan cos/sin sudut hadap-bulat vs normal.
        const ux = nx * side, uy = ny * side // dari jalan ke rumah
        const cosT = Math.abs(ux * fx + uy * fy)
        const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT))
        const dist = (seg.half ?? ROAD_HALF_O) + YARD_O + (D / 2) * cosT + (W / 2) * sinT
        const cx = px + ux * dist, cy = py + uy * dist
        const h = { cx, cy, fx, fy, k, tx: seg.tan[i][0], ty: seg.tan[i][1], roadId: seg.id, side, s: seg.arc[i] }
        // jauh dari persimpangan
        let nearJ = false
        for (const [jx, jy] of JUNCTIONS_O) {
          if (Math.hypot(cx - jx, cy - jy) < JUNCTION_CLEAR) { nearJ = true; break }
        }
        if (nearJ) continue
        // tapak + teras di tanah
        if (!footprintOnLand(h, onLand)) continue
        const p = porchCenter(h)
        if (!onLand(p.x, p.y)) continue
        // tidak menabrak jalan lain (rect harus >= setengah lebar jalan lain + 1 dari garis tengahnya)
        const r = rectOf(h)
        const corners = [[r.cx, r.cy], [r.cx - r.w / 2, r.cy - r.d / 2], [r.cx + r.w / 2, r.cy - r.d / 2], [r.cx - r.w / 2, r.cy + r.d / 2], [r.cx + r.w / 2, r.cy + r.d / 2]]
        let hitOtherRoad = false
        for (let sj = 0; sj < roadSegs.length; sj++) {
          if (sj === si) continue
          const otherHalf = roadSegs[sj].half ?? ROAD_HALF_O
          const b = boxes[sj]
          if (r.cx + r.w / 2 + otherHalf + 1 < b.minX || r.cx - r.w / 2 - otherHalf - 1 > b.maxX || r.cy + r.d / 2 + otherHalf + 1 < b.minY || r.cy - r.d / 2 - otherHalf - 1 > b.maxY) continue
          for (const [qx, qy] of corners) {
            if (distToSeg(qx, qy, roadSegs[sj]) < otherHalf + 1) { hitOtherRoad = true; break }
          }
          if (hitOtherRoad) break
        }
        if (hitOtherRoad) continue
        // tidak menabrak tapak fasilitas (rect sudah termasuk pad)
        let hitBlocked = false
        for (const b of BLOCKED_O) {
          if (r.cx - r.w / 2 < b.x1 && r.cx + r.w / 2 > b.x0 && r.cy - r.d / 2 < b.y1 && r.cy + r.d / 2 > b.y0) { hitBlocked = true; break }
        }
        if (hitBlocked) continue
        // tidak tumpang tindih slot lain (gap minimum SIDE_GAP_MIN)
        if (accepted.some((o) => expandedOverlap(r, rectOf(o)))) continue
        accepted.push(h)
        list.push(h)
        lastArc = seg.arc[i]
      }
      bySide.push(list)
    }
  }
  return { bySide, accepted }
}

// Pilih `total` slot dari semua sisi jalan secara proporsional, supaya semua
// sisi jalan terisi merata (tidak ada jalan yang kosong). Di tiap sisi, slot
// diambil merata sepanjang sisi itu (jarak antar slot jadi >= SIDE_GAP_MIN,
// biasanya >= SIDE_GAP).
export function selectSlots(bySide, total) {
  const all = bySide.flat()
  if (all.length < total) return null
  const counts = bySide.map((l) => Math.round((l.length / all.length) * total))
  let sum = counts.reduce((a, b) => a + b, 0)
  let i = 0
  while (sum > total && i < counts.length * total + 100) {
    const j = i % counts.length
    if (counts[j] > 0) { counts[j]--; sum-- }
    i++
  }
  while (sum < total) {
    let best = -1
    for (let j = 0; j < counts.length; j++) {
      if (counts[j] < bySide[j].length && (best < 0 || bySide[j].length > bySide[best].length)) best = j
    }
    if (best < 0) break
    counts[best]++; sum++
  }
  const picked = []
  const seen = new Set()
  bySide.forEach((list, j) => {
    const n = counts[j]
    for (let t = 0; t < n; t++) {
      const idx = Math.floor(((t + 0.5) * list.length) / n)
      const h = list[idx]
      if (!seen.has(h)) { seen.add(h); picked.push(h) }
    }
  })
  return picked
}

// Relokasi darurat: rumah yang pintunya masih tidak OK setelah doorFixPass
// digeser sepanjang jalannya sendiri (busur terdekat yang pintunya OK,
// tapak di tanah, tidak tumpang tindih, jauh dari persimpangan).
// Kalau tidak ada, rumah dibiarkan (tes yang melaporkan).
export function relocateHouses(infos, onLand, roadSegs, opts = {}) {
  const ROAD_HALF_O = opts.roadHalf ?? ROAD_HALF
  const YARD_O = opts.yard ?? YARD
  const JUNCTIONS_O = opts.junctions ?? LPM_JUNCTIONS
  const byId = new Map(roadSegs.map((s) => [s.id, s]))
  for (const h of infos) {
    if (doorOk(h, infos, onLand)) continue
    const seg = byId.get(h.roadId)
    if (!seg) continue
    let best = null
    for (let ds = -12; ds <= 12; ds += 1) {
      if (ds === 0) continue
      const s = h.s + ds
      if (s < 0 || s > seg.len) continue
      let i = 0
      while (i < seg.arc.length - 2 && seg.arc[i + 1] < s) i++
      const f = (s - seg.arc[i]) / ((seg.arc[i + 1] - seg.arc[i]) || 1)
      const px = seg.pts[i][0] + (seg.pts[i + 1][0] - seg.pts[i][0]) * f
      const py = seg.pts[i][1] + (seg.pts[i + 1][1] - seg.pts[i][1]) * f
      const nx = seg.nrm[i][0] + (seg.nrm[i + 1][0] - seg.nrm[i][0]) * f
      const ny = seg.nrm[i][1] + (seg.nrm[i + 1][1] - seg.nrm[i][1]) * f
      const side = h.side
      const ux = nx * side, uy = ny * side
      const fx = Math.abs(nx) > Math.abs(ny) ? -Math.sign(nx) * side : 0
      const fy = fx === 0 ? -Math.sign(ny) * side : 0
      const W = MODEL_W * h.k, D = MODEL_D * h.k
      const cosT = Math.abs(ux * fx + uy * fy)
      const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT))
      const dist = (seg.half ?? ROAD_HALF_O) + YARD_O + (D / 2) * cosT + (W / 2) * sinT
      const cand = { ...h, cx: px + ux * dist, cy: py + uy * dist, fx, fy, s }
      if (!footprintOnLand(cand, onLand)) continue
      if (overlapsAny(cand, infos)) continue
      if (!doorOk(cand, infos, onLand)) continue
      let nearJ = false
      for (const [jx, jy] of JUNCTIONS_O) {
        if (Math.hypot(cand.cx - jx, cand.cy - jy) < JUNCTION_CLEAR) { nearJ = true; break }
      }
      if (nearJ) continue
      if (!best || Math.abs(ds) < Math.abs(best.ds)) best = { cand, ds }
    }
    if (best) {
      h.cx = best.cand.cx; h.cy = best.cand.cy
      h.fx = best.cand.fx; h.fy = best.cand.fy; h.s = best.cand.s
    }
  }
}

// `buildings`: [{ num, ... }] (frame lokal, meter) -- cuma nomornya yang dipakai;
// posisi rumah BARU ditentukan slot sepanjang jalan baru (bukan node lama).
// `onLand(x, y)`: true kalau titik (frame lokal) bisa dipijak.
// Mengembalikan info rumah [{ num, cx, cy, fx, fy, k, tx, ty, roadId, side, x0, y0 }].
export function computeLpmPlacement({ buildings, onLand }) {
  const roadSegs = sampleLpmRoads()
  let infos = null
  for (const k of SCALE_STEPS) {
    const { bySide } = buildSlots(k, onLand, roadSegs)
    const picked = selectSlots(bySide, buildings.length)
    if (!picked) continue
    infos = picked
    break
  }
  if (!infos) {
    // tidak muat 67 rumah bahkan di skala 0.7: kembalikan sebanyak yang muat
    // (pemanggil membiarkan sisanya memakai model lama; tes yang melaporkan).
    const { bySide } = buildSlots(MIN_SCALE, onLand, roadSegs)
    infos = bySide.flat()
  }
  const nums = buildings.map((b) => b.num).sort((a, b) => a - b)
  infos = infos.map((h, i) => ({ ...h, num: nums[i], x0: h.cx, y0: h.cy }))
  // perbaikan pintu (geser sepanjang jalan) + relokasi fallback
  doorFixPass(infos, onLand)
  relocateHouses(infos, onLand, roadSegs)
  doorFixPass(infos, onLand)
  return infos
}

// Segitiga air/hijau/jalan + batang pohon (koordinat dunia, Y-up) buat dunia
// jalan (buildWalkWorld) yang dipakai menilai tanah saat penempatan. Bangunan
// TIDAK ikut: segitiga bangunan bukan jangkar tanah (lihat walkWorld.js), jadi
// tidak dibutuhkan di sini -- hasilnya tetap sama dengan dunia jalan aslinya.
function collectWalkTriangles(scene, inv, waterDrop) {
  const out = { water: [], green: [], roads: [], trunks: [] }
  const targets = { TPX_Waterways: out.water, TPX_GreenAreas: out.green, TPX_RoadsOutlines: out.roads }
  const tmp = new THREE.Vector3()
  const groupOf = (obj) => {
    for (let o = obj; o; o = o.parent) {
      const n = o.name || ''
      for (const p of ['TPX_Waterways', 'TPX_GreenAreas', 'TPX_RoadsOutlines', 'TPX_Trees']) {
        if (n.startsWith(p)) return p
      }
    }
    return null
  }
  scene.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry) return
    const grp = groupOf(obj)
    if (!grp) return
    const pos = obj.geometry.getAttribute('position')
    if (!pos) return
    // frame lokal (Z ke atas) -> dunia (Y ke atas): (x, y, z) -> (x, z, -y)
    const world = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) {
      tmp.fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld).applyMatrix4(inv)
      world[i * 3] = tmp.x
      world[i * 3 + 1] = tmp.z
      world[i * 3 + 2] = -tmp.y
    }
    if (grp === 'TPX_Trees') {
      if (pos.count > 40) return // tajuk: bukan jangkar tanah
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity
      for (let i = 0; i < world.length; i += 3) {
        minX = Math.min(minX, world[i]); maxX = Math.max(maxX, world[i])
        minY = Math.min(minY, world[i + 1]); maxY = Math.max(maxY, world[i + 1])
        minZ = Math.min(minZ, world[i + 2]); maxZ = Math.max(maxZ, world[i + 2])
      }
      out.trunks.push({
        x: (minX + maxX) / 2,
        z: (minZ + maxZ) / 2,
        r: Math.max(maxX - minX, maxZ - minZ) / 2,
        y0: minY,
        y1: maxY,
      })
      return
    }
    const target = targets[grp]
    if (!target) return
    const idx = obj.geometry.index
    const n = idx ? idx.count : pos.count
    for (let k = 0; k < n; k++) {
      const v = idx ? idx.getX(k) : k
      target.push(world[v * 3], world[v * 3 + 1], world[v * 3 + 2])
    }
  })
  if (waterDrop > 0) {
    for (let i = 1; i < out.water.length; i += 3) out.water[i] -= waterDrop
  }
  return {
    water: Float32Array.from(out.water),
    green: Float32Array.from(out.green),
    roads: Float32Array.from(out.roads),
    buildings: new Float32Array(0),
    trunks: out.trunks,
  }
}

let SHARED = null
function shared() {
  if (!SHARED) {
    const { solid, glass } = buildStaticBoxes({ exterior: true })
    // Carport + pagar rendah (denah, depan rumah). Celah pagar sejajar jalan
    // setapak (teras) & carport, jadi jalur masuk dari jalan ke pintu jelas.
    // Grup mirror membalik sumbu x, jadi carport denah-kanan jadi model-kiri --
    // celah pagar & carport ikut tercermin bersama, jadi tetap sejajar.
    const extra = []
    const B = (x0, y0, h0, x1, y1, h1, c) => extra.push({ x0, x1, y0, y1, h0, h1, c })
    B(CARPORT.x0, CARPORT.y0, -0.02, CARPORT.x1, CARPORT.y1, 0.02, 0x9aa0a3) // lantai carport
    B(CARPORT.x0, CARPORT.y0, CARPORT.roofH, CARPORT.x1, CARPORT.y1, CARPORT.roofH + 0.15, 0x3d4248) // atap carport
    for (const [px, py] of [[CARPORT.x0 + 0.1, CARPORT.y0 + 0.1], [CARPORT.x1 - 0.22, CARPORT.y0 + 0.1], [CARPORT.x0 + 0.1, CARPORT.y1 - 0.22], [CARPORT.x1 - 0.22, CARPORT.y1 - 0.22]]) {
      B(px, py, 0, px + 0.12, py + 0.12, CARPORT.roofH, 0x2d3135) // tiang carport
    }
    let fx = 0
    for (const [a, b] of FENCE_GAPS) {
      if (a > fx) { B(fx, FENCE_Y - 0.06, 0, a, FENCE_Y + 0.06, FENCE_H, 0xf7f7f5); B(fx, FENCE_Y - 0.08, FENCE_H, a, FENCE_Y + 0.08, FENCE_H + 0.05, 0x3d4248) }
      fx = Math.max(fx, b)
    }
    if (fx < PW) { B(fx, FENCE_Y - 0.06, 0, PW, FENCE_Y + 0.06, FENCE_H, 0xf7f7f5); B(fx, FENCE_Y - 0.08, FENCE_H, PW, FENCE_Y + 0.08, FENCE_H + 0.05, 0x3d4248) }
    SHARED = {
      solid: boxesToGeometry(solid),
      glass: boxesToGeometry(glass.map((g) => ({ ...g, c: 0x6f93a8 }))),
      extra: boxesToGeometry(extra),
      // cangkang gabungan (badan + carport + pagar, 1 geometri) — dipakai kota
      // baru supaya tiap rumah cuma 1 mesh tampak (bukan 2). Sama persis isinya
      // dengan solid+extra di atas, cuma digabung.
      shell: boxesToGeometry([...solid, ...extra]),
      // kotak tabrakan (hanya badan rumah; teras, balkon, carport & pagar
      // dibiarkan bisa dilewati, seperti di Pantai)
      collider: new THREE.BoxGeometry(PW + 0.3, BODY_H, PD + 0.3).translate(PW / 2, BODY_H / 2, PD / 2),
      solidMat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 }),
      glassMat: new THREE.MeshStandardMaterial({
        vertexColors: true, transparent: true, opacity: 0.55, roughness: 0.08, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide,
      }),
      colliderMat: new THREE.MeshBasicMaterial({ visible: false }),
      // pondasi tambahan (sama warnanya dengan pondasi bawaan model)
      foundMat: new THREE.MeshStandardMaterial({ color: FOUND_C, roughness: 0.88, metalness: 0 }),
      foundGeo: new Map(), // tinggi tambahan (model) -> geometri
      baseColliderGeo: new Map(), // tinggi tabrakan (model, dibulatkan) -> geometri
    }
  }
  return SHARED
}

// Aset geometri/material bersama buat SATU desain rumah (dipakai ulang semua
// rumah — jangan material unik per rumah). Diekspor buat kota baru.
export function sharedHouseAssets() {
  return shared()
}

// Bangun SATU rumah (grup + tabrakan pondasi opsional) dari info penempatan h
// ({cx, cy, fx, fy, k, z, drop}). Dipakai addLpmHouses (LPM) dan kota baru.
// `colliderName` = nama mesh kotak tabrakan: LPM pakai LpmTabrak_N; kota pakai
// TPX_Buildings_N (supaya efek kunci/bangunan di TownMap3D + visit di TownWalk
// menemukannya sebagai bangunan bernomor). `shared` = true: tandai semua mesh
// supaya TownMap3D/TownWalk tidak meng-clone materialnya (tetap berbagi).
export function buildHouseGroup(sh, num, h, { colliderName = `LpmTabrak_${num}`, shared = false, shell = false } = {}) {
  const { cx, cy, fx, fy, k } = h
  // model: depan = -z denah. Setelah rotasi X +90 (Y-up -> Z-up) depan jadi +y;
  // rotasi z phi mengarahkannya ke (fx, fy).
  const phi = Math.atan2(-fx, fy)
  // Kerangka rumah (posisi + rotasi + skala + cermin), dipakai dua kali: untuk
  // rumahnya sendiri dan untuk tabrakan pondasi (grup terpisah, lihat bawah).
  const frame = (name) => {
    const root = new THREE.Group()
    root.name = name
    root.position.set(cx, cy, h.z)
    root.rotation.z = phi
    const tilt = new THREE.Group()
    tilt.rotation.x = Math.PI / 2
    tilt.scale.setScalar(k)
    const m = new THREE.Group()
    m.scale.set(-1, 1, 1)
    // pusat jejak rumah (termasuk balkon & teras) -> titik tengah petak
    m.position.set(PW / 2, 0, -(FRONT_MIN_Z + PD) / 2)
    tilt.add(m)
    root.add(tilt)
    return { root, mirror: m }
  }
  const mark = (mesh) => {
    if (!shared) return
    mesh.userData.clonedMaterial = true
    mesh.userData.sharedMaterial = true
  }
  // nama dikenali TownWalk (nomor rumah + tabrakan)
  const { root: house, mirror } = frame(`TPX_Buildings_${num}`)
  const solid = new THREE.Mesh(shell ? sh.shell : sh.solid, sh.solidMat)
  const glass = new THREE.Mesh(sh.glass, sh.glassMat)
  glass.renderOrder = 2
  solid.name = `LpmRumah_${num}`
  glass.name = `LpmKaca_${num}`
  solid.userData.noCollide = true
  glass.userData.noCollide = true
  const col = new THREE.Mesh(sh.collider, sh.colliderMat)
  col.name = colliderName
  col.visible = false
  mark(solid); mark(glass); mark(col)
  mirror.add(solid, glass, col)
  if (!shell) {
    const extra = new THREE.Mesh(sh.extra, sh.solidMat)
    extra.name = `LpmCarport_${num}`
    extra.userData.noCollide = true
    mark(extra)
    mirror.add(extra)
  }

  // Pondasi bawaan model cuma setebal FOUND_D * k. Kalau tanah di sisi bawah
  // lebih dalam dari itu, rumah kelihatan melayang: tambah blok pondasi
  // (visual saja) sampai menyentuh tanah terendah.
  const extraH = h.drop - FOUND_D * k + FOUND_MARGIN
  if (extraH > 0.05) {
    const fm = new THREE.Mesh(foundationGeo(sh, Math.ceil(extraH / k / FOUND_STEP) * FOUND_STEP), sh.foundMat)
    fm.name = `LpmPondasi_${num}`
    fm.userData.noCollide = true
    mark(fm)
    mirror.add(fm)
  }

  // Tabrakan pondasi: tanpa ini pemain di sisi tanah yang lebih rendah bisa
  // berjalan menembus pondasi (kotak tabrakan badan mulai dari lantai). Dibuat
  // di grup bernama "TPX_BuildingsBase_N": TownWalk tetap menganggapnya
  // bangunan (awalan TPX_Buildings) sebagai dinding, tapi tidak dihitung
  // sebagai node rumah bernomor, jadi dasar bangunan (baseY) untuk fitur
  // Masuki rumah tetap setinggi lantai.
  let base = null
  if (h.drop > COLLIDE_MIN_DROP) {
    const { root: baseRoot, mirror: baseMirror } = frame(`TPX_BuildingsBase_${num}`)
    const bc = new THREE.Mesh(baseColliderGeo(sh, (h.drop + FOUND_MARGIN + 0.05) / k), sh.colliderMat)
    bc.name = `LpmPondasiTabrak_${num}`
    bc.visible = false
    mark(bc)
    baseMirror.add(bc)
    base = baseRoot
  }
  return { house, base }
}

// Blok pondasi tambahan di bawah pondasi bawaan model (y = -FOUND_D), seluas
// pondasi bawaan (x -0.12..PW+0.12, z -0.12..PD+0.12). Frame model: (x, tinggi, z).
function foundationGeo(sh, extra) {
  const key = extra.toFixed(2)
  let g = sh.foundGeo.get(key)
  if (!g) {
    const ov = 0.05 // menumpang sedikit ke pondasi bawaan supaya tidak ada celah
    g = new THREE.BoxGeometry(PW + 0.24, extra + ov, PD + 0.24)
      .translate(PW / 2, -FOUND_D - extra + (extra + ov) / 2, PD / 2)
    sh.foundGeo.set(key, g)
  }
  return g
}

// Kotak tabrakan pondasi: dari `depth` (model) di bawah lantai sampai lantai.
// Terpisah dari kotak tabrakan badan rumah supaya "dasar bangunan" yang dipakai
// fitur Masuki rumah (houseVisit.baseY) tetap setinggi lantai.
function baseColliderGeo(sh, depth) {
  const d = Math.ceil(depth / FOUND_STEP) * FOUND_STEP
  const key = d.toFixed(2)
  let g = sh.baseColliderGeo.get(key)
  if (!g) {
    g = new THREE.BoxGeometry(PW + 0.3, d, PD + 0.3).translate(PW / 2, -d / 2, PD / 2)
    sh.baseColliderGeo.set(key, g)
  }
  return g
}

// Pasang rumah baru menggantikan semua TPX_Buildings_N di `scene`. Aman dipanggil
// berulang (ditandai di scene.userData). `waterDrop` = penurunan permukaan air
// peta ini (lihat maps.js: walkWaterDrop), dipakai menilai tanah saat penempatan.
// `landExpand` = perluasan daratan LPM ke laut (lihat maps.js), dipakai di dunia
// jalan lama & final supaya rumah/jalan di daratan baru ikut terhitung darat.
export function addLpmHouses(scene, waterDrop = 0, landExpand = 0) {
  if (!scene || scene.userData.lpmHouses) return
  scene.updateWorldMatrix(true, true)
  const inv = new THREE.Matrix4().copy(scene.matrixWorld).invert()
  const rel = new THREE.Matrix4()

  const old = []
  scene.traverse((obj) => {
    if (obj.isMesh && obj.geometry && HOUSE_RE.test(obj.name || '')) old.push(obj)
  })
  if (!old.length) return

  // Dunia jalan LAMA (jalan GLB) buat penempatan; lantai dihitung dari dunia
  // jalan FINAL (jalan baru) -- lihat di bawah.
  const tris = collectWalkTriangles(scene, inv, waterDrop)
  const walkOld = buildWalkWorld({ ...tris, props: [], floors: new Float32Array(0), cell: 2, landExpand })
  // frame lokal (x, y) -> dunia (x, -y) buat uji tanah
  const onLand = (x, y) => walkOld.groundY(x, -y, Infinity) !== null
  const sh = shared()
  const group = new THREE.Group()
  group.name = 'LpmHouses'

  // pusat kumpulan rumah lama (frame lokal scene)
  const center = new THREE.Vector3()
  for (const obj of old) {
    if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox()
    rel.multiplyMatrices(inv, obj.matrixWorld)
    center.add(obj.geometry.boundingBox.clone().applyMatrix4(rel).getCenter(new THREE.Vector3()))
  }
  center.divideScalar(old.length)

  const buildings = []
  for (const obj of old) {
    const num = Number(HOUSE_RE.exec(obj.name)[1])
    if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox()
    rel.multiplyMatrices(inv, obj.matrixWorld)
    const bb = obj.geometry.boundingBox.clone().applyMatrix4(rel)
    buildings.push({
      obj, num,
      cx: (bb.min.x + bb.max.x) / 2,
      cy: (bb.min.y + bb.max.y) / 2,
      sx: bb.max.x - bb.min.x,
      sy: bb.max.y - bb.min.y,
      minZ: bb.min.z,
    })
  }

  const infos = computeLpmPlacement({ buildings, onLand })
  const byNum = new Map(infos.map((h) => [h.num, h]))
  for (const b of buildings) {
    const h = byNum.get(b.num)
    if (!h) { // tidak kebagian slot: model lama disembunyikan, petak jadi hijau
      b.obj.visible = false
      b.obj.userData.replaced = true
      continue
    }
    h.obj = b.obj
    h.minZ = b.minZ
  }

  // Sembunyikan jalan lama, lalu bangun jalan baru + dunia jalan FINAL.
  // Lantai rumah dihitung dari dunia final (bukan dunia lama): tanah di bawah
  // rumah bisa selisih sampai ~0.4 m antara keduanya.
  hideOldRoads(scene)
  const roadParts = buildLpmRoadTriangles((x, y) => walkOld.groundY(x, -y, Infinity))
  const newRoadWorld = []
  for (const part of roadParts) {
    for (let i = 0; i < part.tris.length; i += 3) {
      newRoadWorld.push(part.tris[i], part.tris[i + 2], -part.tris[i + 1])
    }
  }
  const walk = buildWalkWorld({
    water: tris.water, green: tris.green, roads: Float32Array.from(newRoadWorld),
    buildings: new Float32Array(0), trunks: tris.trunks, props: [], floors: new Float32Array(0), cell: 2, landExpand,
  })

  // tinggi tanah di titik baru (dunia jalan yang sama dipakai penempatan);
  // cadangan: dasar rumah lama. Lantai = tanah tertinggi, jadi tidak ada
  // dinding yang terkubur; `drop` = selisih lantai ke tanah terendah, yang
  // harus ditutup pondasi. Titik tanpa tanah (null, mis. di air) dilewati.
  for (const h of infos) {
    const [w, d] = (() => {
      const alongY = h.fx === 0
      return [(alongY ? MODEL_W : MODEL_D) * h.k, (alongY ? MODEL_D : MODEL_W) * h.k]
    })()
    let top = -Infinity, bottom = Infinity
    for (let i = 0; i < GROUND_GRID; i++) {
      for (let j = 0; j < GROUND_GRID; j++) {
        const gx = h.cx + (i / (GROUND_GRID - 1) - 0.5) * w
        const gy = h.cy + (j / (GROUND_GRID - 1) - 0.5) * d
        const g = walk.groundY(gx, -gy, Infinity)
        if (g === null) continue
        if (g > top) top = g
        if (g < bottom) bottom = g
      }
    }
    if (Number.isFinite(top) && Math.abs(top - h.minZ) < 12) {
      h.z = top + FLOOR_LIFT
      h.drop = h.z - bottom
    } else {
      h.z = h.minZ
      h.drop = 0
    }
  }

  for (const h of infos) {
    const { obj, num } = h
    const { house, base } = buildHouseGroup(sh, num, h)
    group.add(house)
    if (base) group.add(base)
    obj.visible = false
    obj.userData.replaced = true
  }

  // Jalan baru (visual + dibaca ekstraktor dunia jalan sebagai TPX_RoadsOutlines).
  const roadGroup = new THREE.Group()
  roadGroup.name = 'LpmRoads'
  for (const part of roadParts) {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(part.tris), 3))
    geo.computeVertexNormals()
    geo.computeBoundingSphere()
    const mat = new THREE.MeshStandardMaterial({ color: part.color, roughness: 0.95, metalness: 0, side: THREE.DoubleSide })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.name = part.name
    if (part.noCollide) mesh.userData.noCollide = true
    roadGroup.add(mesh)
  }
  scene.add(roadGroup)

  scene.add(group)
  scene.userData.lpmHouses = true
  scene.userData.lpmScales = Object.fromEntries(infos.map((h) => [h.num, +h.k.toFixed(2)]))
}

// Penyejajaran peta asli ke interior (dipakai LpmMapBackdrop di TownWalk.jsx).
//
// Interior digambar & difisikakan di koordinat sendiri (titik asal di pojok denah),
// bukan di lokasi rumah di peta. Daripada memindah interior (fisikanya harus ikut
// berubah), PETAnya yang digeser/diputar/diskalakan supaya rumah yang dimasuki pas
// menumpuk di interior. Hasilnya: jendela interior melihat peta yang sebenarnya,
// lengkap dengan rumah-rumah tetangga.
//
// Dua koordinat yang dipakai (keduanya Y-atas):
//   model    : (x denah, tinggi, y denah)          -- tempat kotak rumah dibangun
//   interior : (PW - x denah, tinggi, y denah)     -- interior dicerminkan di sumbu x
// Cangkang rumah di peta (LpmRumah_N) ada di grup `mirror`; matriks lokal
// rantai induknya (mirror -> tilt -> house -> LpmHouses -> root) membawa
// koordinat model ke koordinat dunia peta. Jadi:
//   interior -> model -> dunia peta   =   (rantai) * F          (F = cermin x: PW - x)
//   dunia peta -> interior (yang kita mau)  =  kebalikannya.
//
// Rantai dihitung dari matriks LOKAL (bukan matrixWorld) karena scene ini dipakai
// bergantian oleh mode luar dan mode dalam, jadi matrixWorld-nya bisa basi.
//
// Hasil: { position, quaternion, scale } buat <group> yang membungkus peta, atau
// null kalau rumah N tidak punya cangkang (bukan salah satu rumah LPM baru).
export function lpmBackdropTransform(root, number) {
  const shell = root.getObjectByName(`LpmRumah_${number}`)
  if (!shell || !shell.parent) return null
  const chain = new THREE.Matrix4()
  for (let o = shell.parent; o; o = o.parent) {
    o.updateMatrix()
    chain.premultiply(o.matrix)
    if (o === root) break
  }
  const F = new THREE.Matrix4().makeTranslation(PW, 0, 0).multiply(new THREE.Matrix4().makeScale(-1, 1, 1))
  const G = chain.multiply(F).invert()
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3()
  G.decompose(p, q, s)
  return { position: p.toArray(), quaternion: q.toArray(), scale: s.toArray() }
}
