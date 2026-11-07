// Jaringan jalan kota pulau (ring highway + jalan sekunder berkelok).
// Murni JavaScript (tanpa three.js) supaya bisa dites di Node.
//
// Frame lokal: x timur, y selatan (y = -z dunia), z ke atas.
// Pulau MEMANJANG timur-barat (bukan oval): ring = loop tertutup Catmull-Rom
// yang ditelusuri manual mengikuti garis pantai baru (~50-150 m ke dalam,
// menyusuri teluk selatan + semenanjung barat + Kompleks Selatan lewat
// tanah genting). Sekunder = spline terbuka dari ring ke tiap cluster,
// ujung cul-de-sac (bulb). Sampling & pita jalan mengikuti pola
// lib/lpmHouses.js (sampleRoadCurve / buildLpmRoadTriangles) tapi lebar
// per jalan beda.

import { baseHeightAt, riverDist, clamp } from './cityTerrain.js'

// ---------------------------------------------------------------------------
// Definisi jalan (titik kontrol, frame lokal).
// ---------------------------------------------------------------------------
// Ring: loop tertutup mengikuti garis pantai baru. Urutan: ujung semenanjung
// barat -> pantai utara semenanjung -> lobus barat-laut -> pantai utara ->
// timur-laut -> pantai timur -> tenggara -> teluk selatan (lewat utara
// pelabuhan) -> Kompleks Selatan -> tanah genting -> pantai barat-daya ->
// kembali ke ujung semenanjung.
function ringCtrl() {
  return [
    [-1380, 240], [-1340, 10], [-1300, -50], [-1280, -60], [-1100, -120], [-950, -220], [-800, -320],
    [-750, -500], [-700, -650], [-580, -780], [-400, -820], [-200, -810],
    [0, -800], [200, -800], [400, -810], [600, -810], [800, -810],
    [1000, -830], [1200, -800], [1360, -680], [1420, -550], [1400, -400],
    [1380, -200], [1360, 0], [1330, 200], [1280, 400], [1200, 550],
    [1100, 680], [1000, 760], [850, 800], [700, 800], [640, 760],
    [640, 680], [600, 600], [560, 560], [470, 500], [380, 520], [280, 600], [200, 700],
    [50, 820], [-100, 830], [-250, 790], [-330, 720], [-360, 620],
    [-340, 500], [-300, 380], [-220, 300], [-170, 250], [-130, 190],
    [-70, 160], [-100, 60], [-200, 40], [-300, -10], [-380, 0], [-560, -50], [-700, -70], [-800, -40],
    [-900, 0], [-1050, 60], [-1200, 130], [-1330, 200],
  ]
}

// Sekunder: dari ring / jalan lain ke cluster & fasilitas. `bulb` = radius
// ujung bundar (cul-de-sac); 0 = spur akses fasilitas (berhenti di tepi tapak).
const SECONDARIES = [
  // --- Jalan cluster rumah (bulb 4, dua sisi penuh rumah) ---
  { id: 'W1', pts: [[-800, -320], [-950, -200], [-1100, -40], [-1250, 80], [-1350, 180]], bulb: 4 }, // Kampung Pesisir Barat (tulang semenanjung barat)
  { id: 'W2a', pts: [[-580, -780], [-400, -760], [-200, -740], [-50, -720]], bulb: 4 }, // Suburban Utara (utara)
  { id: 'W2b', pts: [[-600, -700], [-400, -600], [-200, -580], [-50, -560]], bulb: 4 }, // Suburban Utara (selatan)
  { id: 'W3a', pts: [[400, -830], [380, -700], [350, -560], [300, -450]], bulb: 4 }, // Pemukiman Lembah (utara-selatan)
  { id: 'W3b', from: 'W3a', pts: [[350, -560], [200, -520], [50, -500], [-50, -480]], bulb: 4 }, // Pemukiman Lembah (timur-barat)
  { id: 'C1', pts: [[1360, -60], [1100, -80], [850, -100], [600, -120], [400, -150], [200, -170], [0, -180], [-150, -170]], bulb: 0 }, // Jalan tengah timur-barat (di utara danau, menyeberangi sungai via culvert)
  { id: 'C2', from: 'C1', pts: [[-150, -170], [-120, -20], [-100, 80], [-60, 180], [-20, 260]], bulb: 4 }, // Klaster sipil tengah -> selatan (lewat F2/F5/F8)
  { id: 'W4a', from: 'C1', pts: [[400, -150], [420, 0], [430, 100], [420, 200]], bulb: 4 }, // Desa Bukit Tengah (timur sungai)
  { id: 'W4b', from: 'C1', pts: [[150, -160], [140, -20], [130, 80], [120, 180]], bulb: 4 }, // Desa Bukit Tengah (barat sungai, jauh dari tepi danau)
  { id: 'W5a', from: 'C1', pts: [[1100, -60], [1150, 100], [1200, 250], [1250, 400]], bulb: 4 }, // Pemukiman Timur (barat)
  { id: 'W5b', from: 'C1', pts: [[1250, -60], [1230, 100], [1200, 250], [1150, 400]], bulb: 4 }, // Pemukiman Timur (timur)
  { id: 'W6a', pts: [[1100, 680], [1040, 550], [1030, 450], [1020, 350]], bulb: 4 }, // Pesisir Tenggara (timur, lewat barat F21/F24a)
  { id: 'W6b', pts: [[1000, 760], [950, 650], [900, 550], [850, 450]], bulb: 4 }, // Pesisir Tenggara (barat)
  { id: 'W7a', pts: [[-300, 380], [-280, 500], [-250, 620], [-220, 720]], bulb: 4 }, // Kompleks Selatan (barat)
  { id: 'W7b', pts: [[180, 780], [150, 680], [120, 580], [100, 500]], bulb: 4 }, // Kompleks Selatan (timur)
  // --- Spur akses fasilitas (bulb 0, berhenti di tepi tapak) ---
  { id: 'S11', pts: [[640, 680], [622, 690]], bulb: 0 }, // SPBU (dari ring, berakhir 2 m di timur tapak F28)
  { id: 'S12', pts: [[470, 520], [420, 540]], bulb: 0 }, // Pelabuhan Utama (dari ring, berakhir di tepi utara tapak F9 dekat gerbang)
  { id: 'S13', pts: [[1300, -760], [1200, -760], [1080, -770]], bulb: 0 }, // Sirkuit (dari ring, berakhir di tepi utara tapak F10, TIDAK memotong oval/menara kontrol)
  { id: 'S14', from: 'W1', pts: [[-1250, 80], [-1235, 5]], bulb: 0 }, // Resort (dari W1, berakhir di tepi timur tapak F17)
  { id: 'S15', from: 'C1', pts: [[780, -100], [780, -140], [780, -220]], bulb: 0 }, // Kampus (dari C1, berhenti 5 m di utara tapak F7)
  { id: 'S16', from: 'W2b', pts: [[-400, -600], [-450, -700], [-500, -760], [-520, -800]], bulb: 0 }, // Industri utara (tambang/scrap/geng, berakhir di timur tapak F26)
  { id: 'S17', from: 'C1', pts: [[750, -100], [750, -130], [750, -175]], bulb: 0 }, // Pasar (dari C1, berhenti 5 m di utara tapak F11)
  { id: 'S18', from: 'W6b', pts: [[850, 450], [780, 400], [720, 340], [705, 332]], bulb: 0 }, // Pabrik (dari W6b, berakhir di tenggara tapak F19)
]

export const RING_WIDTH = 8
export const SECONDARY_WIDTH = 4.5

// ---------------------------------------------------------------------------
// Sampling kurva (Catmull-Rom uniform, tiap ~1 m busur) — pola sama dengan
// sampleRoadCurve di lpmHouses.js. `closed` = loop tertutup (indeks modular).
// ---------------------------------------------------------------------------
export function sampleCurve(id, ctrl, { closed = false, bulb = 0, half = 2 } = {}) {
  const n = ctrl.length
  const P = (i) => {
    if (closed) return ctrl[((i % n) + n) % n]
    return ctrl[clamp(i, 0, n - 1)]
  }
  const segs = closed ? n : n - 1
  const dense = []
  for (let i = 0; i < segs; i++) {
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
  if (!closed) dense.push(ctrl[n - 1].slice())
  else dense.push(dense[0].slice())
  // sampel ulang tiap 1 m busur
  const cum = [0]
  for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]))
  const len = cum[cum.length - 1]
  const pts = []
  let j = 0
  for (let a = 0; a <= len; a += 1) {
    while (j < cum.length - 2 && cum[j + 1] < a) j++
    const segLen = cum[j + 1] - cum[j] || 1
    const f = clamp((a - cum[j]) / segLen, 0, 1)
    pts.push([dense[j][0] + (dense[j + 1][0] - dense[j][0]) * f, dense[j][1] + (dense[j + 1][1] - dense[j][1]) * f])
  }
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
  return { id, pts, nrm, tan, arc, len: arc[arc.length - 1], bulb, half, closed }
}

// ---------------------------------------------------------------------------
// Bangun jaringan jalan: sampel semua jalan + sampler tinggi/jarak buat grading.
// Tinggi jalan = tinggi tanah dasar (dihaluskan sepanjang jalan); di dekat
// sungai carve dimatikan (culvert — jalan lewat di atas sungai).
// ---------------------------------------------------------------------------
export function createRoads() {
  const ring = sampleCurve('RING', ringCtrl(), { closed: true, half: RING_WIDTH / 2 })
  const segs = [ring]
  const byId = new Map([['RING', ring]])
  // Titik awal tiap sekunder dijepit (snap) ke garis tengah jalan induknya,
  // jadi sambungannya persis menempel (bukan tebakan koordinat manual).
  const snapTo = (parent, x, y) => {
    let best = null, bd = Infinity
    for (const [px, py] of parent.pts) {
      const d = Math.hypot(px - x, py - y)
      if (d < bd) { bd = d; best = [px, py] }
    }
    return best
  }
  // sekunder dulu yang dari ring, lalu spur (from) — urutan tidak penting di sini
  for (const s of SECONDARIES) {
    const parent = byId.get(s.from || 'RING')
    const pts = s.pts.map((p) => p.slice())
    pts[0] = snapTo(parent, pts[0][0], pts[0][1])
    const seg = sampleCurve(s.id, pts, { bulb: s.bulb || 0, half: SECONDARY_WIDTH / 2 })
    seg.from = s.from || 'RING'
    segs.push(seg)
    byId.set(s.id, seg)
  }

  // Tinggi tiap sampel (dihaluskan moving average ±8 m) + hash spasial.
  const HASH = 16
  const buckets = new Map()
  const bkey = (x, y) => `${Math.floor(x / HASH)},${Math.floor(y / HASH)}`
  for (const seg of segs) {
    const raw = seg.pts.map(([x, y]) => baseHeightAt(x, y, riverDist(x, y) > 12))
    const sm = raw.map((_, i) => {
      let s = 0, c = 0
      for (let k = Math.max(0, i - 8); k <= Math.min(raw.length - 1, i + 8); k++) { s += raw[k]; c++ }
      return s / c
    })
    seg.heights = sm
    for (let i = 0; i < seg.pts.length; i++) {
      const [x, y] = seg.pts[i]
      const k = bkey(x, y)
      let list = buckets.get(k)
      if (!list) buckets.set(k, (list = []))
      list.push({ x, y, h: sm[i] })
    }
  }

  const sampler = {
    dist(x, y) {
      let best = Infinity
      const ci = Math.floor(x / HASH), cj = Math.floor(y / HASH)
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const list = buckets.get(`${ci + di},${cj + dj}`)
          if (!list) continue
          for (const p of list) {
            const d = Math.hypot(p.x - x, p.y - y)
            if (d < best) best = d
          }
        }
      }
      return best
    },
    height(x, y) {
      let best = Infinity, bh = 0
      const ci = Math.floor(x / HASH), cj = Math.floor(y / HASH)
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const list = buckets.get(`${ci + di},${cj + dj}`)
          if (!list) continue
          for (const p of list) {
            const d = Math.hypot(p.x - x, p.y - y)
            if (d < best) { best = d; bh = p.h }
          }
        }
      }
      return bh
    },
  }

  // Persimpangan: awal tiap sekunder (+ spur) = titik sambungnya (sudah di-snap).
  const junctions = []
  for (const seg of segs) {
    if (seg.id === 'RING') continue
    junctions.push(seg.pts[0].slice())
  }

  let totalLen = 0
  for (const seg of segs) totalLen += seg.len
  return {
    segs, byId, junctions, sampler,
    stats: {
      ringLength: ring.len,
      secondaryLength: totalLen - ring.len,
      totalLength: totalLen,
      roads: segs.length,
    },
  }
}

// ---------------------------------------------------------------------------
// Pita jalan (segitiga, frame lokal [x, y, z=tinggi]). heightAt = tinggi tanah
// FINAL (sudah grading). Aspal + garis tengah putus-putus + kipas cul-de-sac.
// ---------------------------------------------------------------------------
const ROAD_ASPHALT = 0x646464
const ROAD_LINE_RING = 0xd8c33c // kuning (highway)
const ROAD_LINE_SEC = 0xe8e8e8 // putih (sekunder)

export function buildRoadTriangles(roads, heightAt) {
  const asphalt = []
  const lineRing = []
  const lineSec = []
  const hAt = (x, y, fallback) => {
    const g = heightAt(x, y)
    return g === null || g === undefined ? fallback : g + 0.02
  }
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
  for (const seg of roads.segs) {
    const { pts, nrm, half } = seg
    const isRing = seg.id === 'RING'
    const DASH_ON = isRing ? 3 : 1.6, DASH_OFF = isRing ? 3 : 1.6
    const DASH_HALF_W = isRing ? 0.12 : 0.07
    const line = isRing ? lineRing : lineSec
    let prevH = 0
    for (let i = 0; i < pts.length - 1; i += 2) {
      const i2 = Math.min(i + 2, pts.length - 1)
      const [x0, y0] = pts[i], [x1, y1] = pts[i2]
      const [nx0, ny0] = nrm[i], [nx1, ny1] = nrm[i2]
      const h0 = hAt(x0, y0, prevH), h1 = hAt(x1, y1, h0)
      prevH = h1
      const L0 = [x0 + nx0 * half, y0 + ny0 * half, h0]
      const R0 = [x0 - nx0 * half, y0 - ny0 * half, h0]
      const L1 = [x1 + nx1 * half, y1 + ny1 * half, h1]
      const R1 = [x1 - nx1 * half, y1 - ny1 * half, h1]
      asphalt.push(...L0, ...R0, ...R1, ...L0, ...R1, ...L1)
    }
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
    { name: 'TPX_RoadsOutlines_City_Asphalt', tris: asphalt, color: ROAD_ASPHALT },
    { name: 'TPX_RoadsOutlines_City_CenterRing', tris: lineRing, color: ROAD_LINE_RING, noCollide: true },
    { name: 'TPX_RoadsOutlines_City_CenterSec', tris: lineSec, color: ROAD_LINE_SEC, noCollide: true },
  ]
}
