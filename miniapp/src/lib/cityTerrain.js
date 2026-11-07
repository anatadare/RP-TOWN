// Pulau prosedural buat peta LPM baru (kota roleplay) — rework 2026-11-07:
// bentuk pulau MENIRU gambar referensi user (PETA TATA KOTA, 1000283765).
// Murni JavaScript (tanpa three.js) supaya bisa dites di Node.
//
// Frame lokal: x timur, y selatan (y = -z dunia), z ke atas. Air di z = 0.
// Pulau utama MEMANJANG timur-barat (bbox x -1600..1600, y -1150..1150),
// daratan ~5 km2: semenanjung barat panjang (Kampung Pesisir Barat +
// resort), teluk besar di selatan (pelabuhan), semenanjung selatan
// (Kompleks Selatan, tersambung via tanah genting), + pulau kecil penjara
// di barat-daya (terpisah, tanpa jembatan).
//
// Bentuk pulau: POLIGON garis pantai yang ditelusuri dari gambar referensi
// (pemetaan gambar -> lokal: x = (ix-855)*2, y = (iy-580)*2). Jarak-ke-pantai
// dihitung dari poligon itu (grid signed-distance 10 m + interpolasi
// bilinear) — cukup akurat karena garis pantainya halus dan semua penempatan
// memakai mask yang sama (konsisten antara terrain/air/jalan/rumah).

export const CITY = {
  minX: -1600, maxX: 1600, minY: -1150, maxY: 1150,
  waterMinX: -1700, waterMaxX: 1700, waterMinY: -1250, waterMaxY: 1250,
  waterLevel: 0,
  shoreY: 0.12, // tinggi tanah di garis pantai
  islet: { x: -1390, y: 880, rx: 150, ry: 110 }, // pulau penjara barat-daya
  lake: { x: 250, y: -260, rx: 110, ry: 70 }, // danau tengah (di selatan C1 — C1 lewat 170 m di utara tepi danau)
  // Sungai: danau -> teluk selatan (meander: berkelok supaya tidak lurus
  // seperti kanal). Menyeberangi C1 via culvert di (270,-150), bermuara di
  // teluk di timur pelabuhan F9 (tidak memotong tapak F9/F30). Lewat bawah
  // jalan (culvert), lihat gradedHeightAt.
  river: [[250, -260], [280, -100], [300, 140], [360, 300], [440, 450], [520, 560], [560, 660]],
  riverHalf: 6, riverBlend: 8, // inti air 6 m, blend ke tebing sampai 14 m
}

// ---------------------------------------------------------------------------
// RNG + noise (seeded, deterministik — pulau yang sama tiap load).
// ---------------------------------------------------------------------------
export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Hash integer -> [0, 1). Dipakai value noise.
function hash2(ix, iy, seed) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 974634211) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function smooth(t) { return t * t * (3 - 2 * t) }

// Value noise 2D, hasil [-1, 1]. `scale` = ukuran fitur (meter).
export function makeNoise(seed) {
  const n1 = (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y)
    const fx = x - ix, fy = y - iy
    const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed)
    const c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed)
    const u = smooth(fx), v = smooth(fy)
    return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1
  }
  // 2 oktaf: fitur besar + detail kecil.
  return (x, y) => n1(x, y) * 0.7 + n1(x * 2.7 + 13.7, y * 2.7 + 7.1) * 0.3
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
export const lerp = (a, b, t) => a + (b - a) * t
export function sstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

// ---------------------------------------------------------------------------
// Garis pantai: poligon ditelusuri dari gambar referensi (searah jarum jam
// dari ujung semenanjung barat). Grid signed-distance 10 m dihitung sekali
// supaya maskInland cepat (dipanggil ratusan ribu kali oleh mesh air).
// ---------------------------------------------------------------------------
const COAST = [
  // Ujung semenanjung barat (Kampung Pesisir Barat)
  [-1500, 240],
  // Pantai utara semenanjung, ke timur-laut
  [-1410, 120], [-1310, -80], [-1190, -220], [-1050, -300], [-910, -360],
  // Pantai barat lobus barat-laut, ke utara
  [-850, -480], [-790, -600], [-730, -740], [-690, -860],
  // Pantai utara pulau utama, ke timur (Suburban Utara / tambang / sirkuit)
  [-590, -940], [-410, -960], [-210, -950], [-10, -930], [190, -920], [390, -930],
  [590, -940], [790, -930], [990, -890], [1190, -840], [1330, -760],
  // Ujung timur-laut
  [1530, -600],
  // Pantai timur, ke selatan
  [1510, -360], [1470, -160], [1430, 40], [1390, 240], [1330, 440],
  // Pantai tenggara
  [1230, 600], [1090, 740], [950, 820], [810, 860], [690, 860],
  // Teluk besar selatan (masuk ke utara, lalu keluar ke barat)
  [590, 760], [530, 660], [450, 640], [370, 680], [290, 740],
  // Pantai timur Kompleks Selatan, ke selatan
  [190, 800], [50, 860], [-110, 870], [-270, 860], [-390, 820],
  // Pantai barat Kompleks Selatan, ke utara
  [-450, 700], [-430, 540], [-370, 400], [-320, 300],
  // Tanah genting ke pulau utama (tepi barat ke utara, lalu tepi utara ke timur)
  [-200, 260], [-200, 180], [-80, 140],
  // Pantai barat-daya pulau utama, ke barat
  [-200, 100], [-320, 60], [-470, 0], [-630, -60],
  // Pantai selatan semenanjung, ke barat (kembali ke ujung)
  [-790, 0], [-950, 100], [-1110, 200], [-1310, 280], [-1450, 300],
]

function pointInPolygon(x, y) {
  let inside = false
  for (let i = 0, j = COAST.length - 1; i < COAST.length; j = i++) {
    const [xi, yi] = COAST[i], [xj, yj] = COAST[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function distToCoast(x, y) {
  let best = Infinity
  for (let i = 0; i < COAST.length; i++) {
    const [ax, ay] = COAST[i], [bx, by] = COAST[(i + 1) % COAST.length]
    const ex = bx - ax, ey = by - ay
    const len2 = ex * ex + ey * ey || 1
    let t = ((x - ax) * ex + (y - ay) * ey) / len2
    t = clamp(t, 0, 1)
    const d = Math.hypot(x - (ax + ex * t), y - (ay + ey * t))
    if (d < best) best = d
  }
  return best
}

const GRID_CELL = 10
const GNX = Math.round((CITY.maxX - CITY.minX) / GRID_CELL) + 1
const GNY = Math.round((CITY.maxY - CITY.minY) / GRID_CELL) + 1
const grid = new Float32Array(GNX * GNY)
{
  for (let j = 0; j < GNY; j++) {
    for (let i = 0; i < GNX; i++) {
      const x = CITY.minX + i * GRID_CELL, y = CITY.minY + j * GRID_CELL
      const d = distToCoast(x, y)
      grid[j * GNX + i] = pointInPolygon(x, y) ? d : -d
    }
  }
}

// Jarak ke dalam daratan pulau utama (meter, >0 = darat). Interpolasi
// bilinear grid signed-distance; di luar bbox dikurangi jarak keluarnya
// (pasti laut).
function mainInland(x, y) {
  const fx = (x - CITY.minX) / GRID_CELL, fy = (y - CITY.minY) / GRID_CELL
  const i0 = Math.floor(fx), j0 = Math.floor(fy)
  const u = fx - i0, v = fy - j0
  const g = (i, j) => grid[clamp(j, 0, GNY - 1) * GNX + clamp(i, 0, GNX - 1)]
  let val = g(i0, j0) * (1 - u) * (1 - v) + g(i0 + 1, j0) * u * (1 - v)
    + g(i0, j0 + 1) * (1 - u) * v + g(i0 + 1, j0 + 1) * u * v
  const ox = Math.max(CITY.minX - x, 0, x - CITY.maxX)
  const oy = Math.max(CITY.minY - y, 0, y - CITY.maxY)
  if (ox > 0 || oy > 0) val -= Math.hypot(ox, oy) + 1
  return val
}

// Jarak ke dalam pulau penjara (elips). >0 = darat.
function isletInland(x, y) {
  const dx = (x - CITY.islet.x) / CITY.islet.rx
  const dy = (y - CITY.islet.y) / CITY.islet.ry
  const q = Math.hypot(dx, dy)
  if (q >= 1) return -(q - 1) * Math.min(CITY.islet.rx, CITY.islet.ry)
  return (1 - q) * Math.min(CITY.islet.rx, CITY.islet.ry)
}

// Jarak ke dalam daratan (pulau mana pun yang lebih dekat). >0 = darat.
export function maskInland(x, y) {
  return Math.max(mainInland(x, y), isletInland(x, y))
}

function isIslet(x, y) {
  return isletInland(x, y) > mainInland(x, y)
}

// ---------------------------------------------------------------------------
// Sungai & danau.
// ---------------------------------------------------------------------------
function distToPolyline(x, y, pts) {
  let best = Infinity
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1]
    const ex = bx - ax, ey = by - ay
    const len2 = ex * ex + ey * ey || 1
    let t = ((x - ax) * ex + (y - ay) * ey) / len2
    t = clamp(t, 0, 1)
    const d = Math.hypot(x - (ax + ex * t), y - (ay + ey * t))
    if (d < best) best = d
  }
  return best
}

export function riverDist(x, y) {
  return distToPolyline(x, y, CITY.river)
}

function lakeIn(x, y) {
  const dx = (x - CITY.lake.x) / CITY.lake.rx
  const dy = (y - CITY.lake.y) / CITY.lake.ry
  return Math.hypot(dx, dy) < 1
}

// Zona air tawar (danau + inti sungai). Dipakai tes air murah buat segitiga air.
export function inFreshWater(x, y) {
  if (lakeIn(x, y)) return true
  // sungai: inti air ~9 m (blend 6..14 m, air sampai h>0.05 di ~9 m)
  return riverDist(x, y) < CITY.riverHalf + 3
}

// Tes air PERSIS (dipakai buildWaterMesh + onLand penempatan): sama dengan
// aturan tinggi — simpul air = di luar mask ATAU tingginya <= 0.05. Tinggi
// penuh cuma dihitung kalau simpulnya dekat sungai (bbox check), di tempat
// lain mask + danau sudah cukup (pantai selalu h >= 0.12).
// `sampler` (opsional) = sampler jalan: kalau ada, tinggi yang dipakai adalah
// tinggi FINAL (grading) — air di bawah jalan ikut tertutup (culvert).
const RIVER_BBOX = { x0: 130, x1: 600, y0: -260, y1: 700 }
export function makeIsWater(sampler) {
  return (x, y) => {
    if (maskInland(x, y) <= 0) return true
    if (lakeIn(x, y)) return true
    if (x < RIVER_BBOX.x0 || x > RIVER_BBOX.x1 || y < RIVER_BBOX.y0 || y > RIVER_BBOX.y1) return false
    return gradedHeightAt(x, y, sampler) <= 0.05
  }
}

// ---------------------------------------------------------------------------
// Tinggi tanah.
// ---------------------------------------------------------------------------
const noiseH = makeNoise(20240)
const noiseH2 = makeNoise(5150)

function hillsAt(x, y) {
  const g = (cx, cy, r, a) => a * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * r * r))
  return (
    g(300, -100, 280, 18) + // bukit tengah (Desa Bukit Tengah)
    g(1100, -400, 250, 10) + // bukit timur (Pemukiman Timur)
    g(-500, -650, 250, 10) + // bukit barat-laut (Suburban Utara)
    g(-900, -150, 200, 6) // bukit semenanjung barat
  )
}

// Tinggi dasar (tanpa grading jalan). carve=false = sungai/danau tidak digali
// (dipakai di bawah jalan: culvert — sungai lewat di bawah jalan).
export function baseHeightAt(x, y, carve = true) {
  const d = maskInland(x, y)
  if (d <= 0) return -0.5 // laut (cuma dipakai sudut skirt mesh terrain)
  if (isIslet(x, y)) {
    // pulau penjara: pantai + dataran ~5 m buat penjara
    const t = clamp(d / 40, 0, 1)
    return CITY.shoreY + 1.5 * t ** 1.5 + 3.5 * sstep(15, 55, d) + 0.3 * noiseH(x * 0.02, y * 0.02)
  }
  // pantai barat (x < -800) & pantai selatan (y > 500) lebih landai & lebar
  const westF = clamp((-x - 800) / 400, 0, 1)
  const southF = clamp((y - 500) / 300, 0, 1)
  const beachW = 40 + 25 * Math.max(westF, southF)
  const t = clamp(d / beachW, 0, 1)
  let h = CITY.shoreY + 1.5 * t ** 1.5
  // naik landai ke dalam (maks +2.5 m — tengah pulau tetap lembah)
  h += 2.5 * sstep(40, 600, d)
  // bukit tengah + dataran tinggi utara (y < -500 -> sampai +10 m di y=-850)
  // relief: bukit digoyang ±18% oleh noise 100 m supaya kubah Gaussian-nya
  // tidak terlalu mulus/bulat sempurna
  const hillH = hillsAt(x, y)
  h += hillH * (1 + 0.18 * noiseH2(x * 0.01, y * 0.01))
  h += 10 * sstep(-500, -850, y)
  // noise (dipudarkan di pantai supaya garis pantai tetap halus)
  const nf = sstep(10, 60, d)
  h += nf * (1.2 * noiseH(x * 0.004, y * 0.004) + 0.4 * noiseH2(x * 0.02, y * 0.02))
  if (carve) {
    if (lakeIn(x, y)) return -1
    const rd = riverDist(x, y)
    if (rd < CITY.riverHalf + CITY.riverBlend) {
      const f = sstep(CITY.riverHalf, CITY.riverHalf + CITY.riverBlend, rd)
      return lerp(-1, h, f)
    }
  }
  return Math.max(h, CITY.shoreY)
}

// ---------------------------------------------------------------------------
// Grading: ratakan tanah di dekat jalan (sampler dari cityRoads.js).
// sampler = { dist(x,y) -> meter ke garis tengah jalan terdekat,
//             height(x,y) -> tinggi jalan di titik terdekat }.
// ---------------------------------------------------------------------------
export function gradedHeightAt(x, y, sampler) {
  if (!sampler) return baseHeightAt(x, y, true)
  const dRoad = sampler.dist(x, y)
  if (dRoad > 20) return baseHeightAt(x, y, true)
  // di bawah jalan sungai tidak digali (culvert) + tanah diratakan ke jalan
  const base = baseHeightAt(x, y, dRoad > 12)
  const w = sstep(20, 6, dRoad) // 1 di dekat jalan, 0 di 20 m
  const h = lerp(base, sampler.height(x, y), w)
  return Math.max(h, CITY.shoreY)
}

// onLand final: di darat (mask) + tinggi di atas air + bukan simpul air.
// `waterNodeAt` (opsional) = cek simpul grid air 4 m — bikin penempatan rumah
// persis sama dengan land mask walkWorld (lihat buildWaterMesh).
export function makeOnLand(sampler, waterNodeAt) {
  return (x, y) => {
    if (maskInland(x, y) <= 0) return false
    if (gradedHeightAt(x, y, sampler) <= 0.05) return false
    if (waterNodeAt && waterNodeAt(x, y)) return false
    return true
  }
}

// ---------------------------------------------------------------------------
// Mesh terrain (grid 10 m). Sel dengan >=1 sudut darat ikut digambar; sudut
// air diturunkan ke -0.5 (dasar laut dangkal, kelihatan samar lewat air).
// Warna vertex: pasir / rumput / hutan / batu (dari tinggi + kemiringan + noise).
// Mengembalikan { positions, colors, indices, stats } dalam frame lokal [x, y, z].
// ---------------------------------------------------------------------------
const SAND = [0.85, 0.77, 0.56]
const GRASS = [0.47, 0.72, 0.34]
const FOREST = [0.32, 0.62, 0.32]
const ROCK = [0.54, 0.54, 0.53]

export function buildTerrainMesh(heightAt, onLand) {
  const CELL = 10
  const nx = Math.round((CITY.maxX - CITY.minX) / CELL) + 1
  const ny = Math.round((CITY.maxY - CITY.minY) / CELL) + 1
  const H = new Float32Array(nx * ny)
  const LAND = new Uint8Array(nx * ny)
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = CITY.minX + i * CELL, y = CITY.minY + j * CELL
      const n = j * nx + i
      LAND[n] = onLand(x, y) ? 1 : 0
      H[n] = LAND[n] ? heightAt(x, y) : -0.5
    }
  }
  const positions = []
  const colors = []
  const indices = []
  const idxOf = new Int32Array(nx * ny).fill(-1)
  const colorOf = (i, j) => {
    const n = j * nx + i
    const h = H[n]
    if (!LAND[n]) return SAND // sudut air: pasir dasar laut
    // kemiringan dari tetangga (beda tinggi per 10 m)
    const hx = H[j * nx + Math.min(i + 1, nx - 1)] - H[j * nx + Math.max(i - 1, 0)]
    const hy = H[Math.min(j + 1, ny - 1) * nx + i] - H[Math.max(j - 1, 0) * nx + i]
    const slope = Math.hypot(hx, hy) / (2 * CELL)
    const x = CITY.minX + i * CELL, y = CITY.minY + j * CELL
    const d = maskInland(x, y)
    if (d < 22) return SAND
    // batu: blend halus (bukan saklar keras) — tebing curam DI ATAS 6 m
    // (tebing sungai yang rendah tetap rumput) + puncak bukit >20 m
    const rockSlope = h > 6 ? sstep(0.28, 0.5, slope) : 0
    const rockHigh = sstep(20, 26, h)
    const rock = Math.max(rockSlope, rockHigh)
    // rumput -> hutan: noise + sedikit gelap seiring tinggi
    const f = Math.min(1, Math.max(0, 0.5 + 0.5 * noiseH2(x * 0.01, y * 0.01) + (h - 6) * 0.02))
    const base = [
      lerp(GRASS[0], FOREST[0], f),
      lerp(GRASS[1], FOREST[1], f),
      lerp(GRASS[2], FOREST[2], f),
    ]
    return [
      lerp(base[0], ROCK[0], rock),
      lerp(base[1], ROCK[1], rock),
      lerp(base[2], ROCK[2], rock),
    ]
  }
  const vert = (i, j) => {
    const n = j * nx + i
    if (idxOf[n] >= 0) return idxOf[n]
    const x = CITY.minX + i * CELL, y = CITY.minY + j * CELL
    idxOf[n] = positions.length / 3
    positions.push(x, y, H[n])
    const c = colorOf(i, j)
    colors.push(c[0], c[1], c[2])
    return idxOf[n]
  }
  let landCells = 0
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const n00 = j * nx + i
      if (!LAND[n00] && !LAND[n00 + 1] && !LAND[n00 + nx] && !LAND[n00 + nx + 1]) continue
      landCells++
      const a = vert(i, j), b = vert(i + 1, j), c = vert(i, j + 1), d = vert(i + 1, j + 1)
      // diagonal a-d (sama dengan fillAt di walkWorld.js)
      indices.push(a, d, b, a, c, d)
    }
  }
  let landNodes = 0
  for (let n = 0; n < nx * ny; n++) if (LAND[n]) landNodes++
  return {
    positions: Float32Array.from(positions),
    colors: Float32Array.from(colors),
    indices: Uint32Array.from(indices),
    stats: {
      landArea: landNodes * CELL * CELL,
      nodes: nx * ny,
      landNodes,
      landCells,
      tris: indices.length / 3,
    },
  }
}

// ---------------------------------------------------------------------------
// Segitiga air (dua lapis, selaras grid jalan cell=4 — lihat city_design.md).
// isWater(x, y) = true kalau simpul itu air (laut / teluk / danau / sungai).
// Kasar 16 m: semua 25 simpul (5x5 @4 m) air. Halus 4 m: semua 4 sudut air.
// Mengembalikan { tris, nodeGrid } — nodeGrid buat cek simpul air persis
// (dipakai onLand penempatan rumah supaya sama dengan land mask walkWorld).
// ---------------------------------------------------------------------------
export function buildWaterMesh(isWater) {
  const CELL = 4
  const minX = CITY.waterMinX, minY = CITY.waterMinY
  const nx = Math.round((CITY.waterMaxX - minX) / CELL) + 1
  const ny = Math.round((CITY.waterMaxY - minY) / CELL) + 1
  const W = new Uint8Array(nx * ny) // 1 = air
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      W[j * nx + i] = isWater(minX + i * CELL, minY + j * CELL) ? 1 : 0
    }
  }
  const tris = []
  const quad = (x0, y0, x1, y1) => {
    tris.push(x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y0, 0, x1, y1, 0, x0, y1, 0)
  }
  // lapis kasar 16 m (selaras kelipatan 16)
  const COARSE = 16
  const covered = new Uint8Array(nx * ny)
  let coarse = 0
  for (let j = 0; j + COARSE / CELL < ny; j += COARSE / CELL) {
    for (let i = 0; i + COARSE / CELL < nx; i += COARSE / CELL) {
      let all = true
      for (let dj = 0; dj <= COARSE / CELL && all; dj++) {
        for (let di = 0; di <= COARSE / CELL; di++) {
          if (!W[(j + dj) * nx + (i + di)]) { all = false; break }
        }
      }
      if (!all) continue
      quad(minX + i * CELL, minY + j * CELL, minX + (i + COARSE / CELL) * CELL, minY + (j + COARSE / CELL) * CELL)
      coarse++
      for (let dj = 0; dj < COARSE / CELL; dj++) {
        for (let di = 0; di < COARSE / CELL; di++) covered[(j + dj) * nx + (i + di)] = 1
      }
    }
  }
  // lapis halus 4 m di sisa area (pita pantai + sungai + danau)
  let fine = 0
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      if (covered[j * nx + i]) continue
      if (!W[j * nx + i] || !W[j * nx + i + 1] || !W[(j + 1) * nx + i] || !W[(j + 1) * nx + i + 1]) continue
      quad(minX + i * CELL, minY + j * CELL, minX + (i + 1) * CELL, minY + (j + 1) * CELL)
      fine++
    }
  }
  const nodeGrid = { minX, minY, cell: CELL, nx, ny, water: W }
  return { tris: Float32Array.from(tris), nodeGrid, stats: { coarse, fine, tris: tris.length / 9 } }
}

// Cek simpul air terdekat (dipakai onLand penempatan).
export function waterNodeAt(nodeGrid, x, y) {
  const i = Math.round((x - nodeGrid.minX) / nodeGrid.cell)
  const j = Math.round((y - nodeGrid.minY) / nodeGrid.cell)
  if (i < 0 || j < 0 || i >= nodeGrid.nx || j >= nodeGrid.ny) return true // di luar grid air = bukan darat
  return nodeGrid.water[j * nodeGrid.nx + i] === 1
}
