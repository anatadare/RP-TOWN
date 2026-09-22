// Dunia "jalan-jalan" (third-person) buat peta 3D RP Town.
//
// File ini SENGAJA murni JavaScript (nggak import three.js) supaya logika
// tabrakannya bisa dites di Node tanpa browser. TownWalk.jsx yang nyuapin
// data segitiga (dalam koordinat dunia, Y-up) hasil baca scene .glb.
//
// KENAPA PERLU BANGUN TANAH SENDIRI?
// Ketiga file .glb peta gak punya mesh tanah di area daratnya. Daratan itu
// cuma "lubang" di mesh TPX_Waterways (laut). Jadi kalau langsung dipakai
// jalan, karakter gak punya pijakan. Di sini tanah dibangun dari data yang
// ada:
//   - jalan (TPX_RoadsOutlines) & terrain hijau (TPX_GreenAreas) -> tinggi
//     PERSIS (cek titik-dalam-segitiga),
//   - sisanya (halaman/pantai/area tanpa mesh) -> diisi interpolasi IDW dari
//     jangkar: vertex terrain, vertex jalan, dasar bangunan, dan dasar batang
//     pohon (batang pohon di ketiga peta tertanam PERSIS 1 m ke tanah).
//
// Semua koordinat di sini adalah koordinat DUNIA three.js (Y-up).

const HASH_CELL = 6 // ukuran sel spatial-hash segitiga (meter)
const WALL_CELL = 8 // ukuran sel spatial-hash tembok/batang (meter)
const ANCHOR_CELL = 8 // ukuran sel spatial-hash jangkar IDW (meter)

// Batang pohon di peta tertanam segini ke dalam tanah (terukur konsisten di
// kawasan-pantai, lpm, dan rp-town-city: median persis -1.0 m).
const TREE_SINK = 1.0

// Jalan diangkat sedikit di atas tanah biar gak z-fighting dengan tanah/laut
// (di kawasan-pantai jalan dermaga cuma 1 cm di atas permukaan air).
export const ROAD_LIFT = 0.04

// Lebar "pantai": tanah di tepi laut dilandaikan turun ke permukaan air.
const BEACH_WIDTH = 8

const key = (ci, cj) => (ci + 32768) | ((cj + 32768) << 16)

// ---------------------------------------------------------------------------
// Spatial hash segitiga (diproyeksikan ke bidang XZ) buat query tinggi/isi.
// `tris` = array datar [x,y,z, x,y,z, x,y,z, ...]
// ---------------------------------------------------------------------------
class TriHash {
  constructor(tris, cellSize = HASH_CELL) {
    this.tris = tris
    this.cell = cellSize
    this.n = Math.floor(tris.length / 9)
    this.map = new Map()
    for (let i = 0; i < this.n; i++) {
      const o = i * 9
      const x0 = tris[o], z0 = tris[o + 2]
      const x1 = tris[o + 3], z1 = tris[o + 5]
      const x2 = tris[o + 6], z2 = tris[o + 8]
      const minX = Math.min(x0, x1, x2), maxX = Math.max(x0, x1, x2)
      const minZ = Math.min(z0, z1, z2), maxZ = Math.max(z0, z1, z2)
      const ci0 = Math.floor(minX / cellSize), ci1 = Math.floor(maxX / cellSize)
      const cj0 = Math.floor(minZ / cellSize), cj1 = Math.floor(maxZ / cellSize)
      for (let cj = cj0; cj <= cj1; cj++) {
        for (let ci = ci0; ci <= ci1; ci++) {
          const k = key(ci, cj)
          let list = this.map.get(k)
          if (!list) {
            list = []
            this.map.set(k, list)
          }
          list.push(i)
        }
      }
    }
  }

  // Tinggi permukaan tertinggi di (x,z) yang <= yMax. -Infinity kalau tak ada.
  heightAt(x, z, yMax = Infinity) {
    const list = this.map.get(key(Math.floor(x / this.cell), Math.floor(z / this.cell)))
    if (!list) return -Infinity
    const t = this.tris
    let best = -Infinity
    for (let n = 0; n < list.length; n++) {
      const o = list[n] * 9
      const x0 = t[o], y0 = t[o + 1], z0 = t[o + 2]
      const x1 = t[o + 3], y1 = t[o + 4], z1 = t[o + 5]
      const x2 = t[o + 6], y2 = t[o + 7], z2 = t[o + 8]
      const d = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2)
      if (d > -1e-9 && d < 1e-9) continue
      const l0 = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / d
      const l1 = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / d
      const l2 = 1 - l0 - l1
      if (l0 < -1e-6 || l1 < -1e-6 || l2 < -1e-6) continue
      const y = l0 * y0 + l1 * y1 + l2 * y2
      if (y <= yMax && y > best) best = y
    }
    return best
  }

  containsXZ(x, z) {
    const list = this.map.get(key(Math.floor(x / this.cell), Math.floor(z / this.cell)))
    if (!list) return false
    const t = this.tris
    for (let n = 0; n < list.length; n++) {
      const o = list[n] * 9
      const x0 = t[o], z0 = t[o + 2]
      const x1 = t[o + 3], z1 = t[o + 5]
      const x2 = t[o + 6], z2 = t[o + 8]
      const d = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2)
      if (d > -1e-9 && d < 1e-9) continue
      const l0 = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / d
      const l1 = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / d
      const l2 = 1 - l0 - l1
      if (l0 >= -1e-6 && l1 >= -1e-6 && l2 >= -1e-6) return true
    }
    return false
  }
}

function boundsOfTris(tris, b) {
  for (let i = 0; i < tris.length; i += 3) {
    const x = tris[i], z = tris[i + 2]
    if (x < b.minX) b.minX = x
    if (x > b.maxX) b.maxX = x
    if (z < b.minZ) b.minZ = z
    if (z > b.maxZ) b.maxZ = z
  }
}

function smoothstep(t) {
  const c = Math.max(0, Math.min(1, t))
  return c * c * (3 - 2 * c)
}

// ---------------------------------------------------------------------------
// Bangun dunia jalan.
//   water, green, roads, buildings : array datar segitiga (koordinat dunia)
//   trunks : [{ x, z, r, y0, y1 }]  batang pohon (lingkaran vertikal)
//   cell   : ukuran sel grid tanah pengisi (meter)
// ---------------------------------------------------------------------------
export function buildWalkWorld({ water, green, roads, buildings, trunks = [], cell = 2 }) {
  // ---- jalan diangkat sedikit --------------------------------------------
  const roadTris = new Float32Array(roads)
  for (let i = 1; i < roadTris.length; i += 3) roadTris[i] += ROAD_LIFT

  const waterHash = new TriHash(water)
  const hasWater = water.length > 0

  // ---- batas dunia ---------------------------------------------------------
  const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }
  boundsOfTris(water, bounds)
  const waterExtent = { ...bounds }
  boundsOfTris(green, bounds)
  boundsOfTris(roads, bounds)
  boundsOfTris(buildings, bounds)
  if (!isFinite(bounds.minX)) {
    bounds.minX = bounds.minZ = -50
    bounds.maxX = bounds.maxZ = 50
  }

  // ---- permukaan laut ------------------------------------------------------
  let waterLevel = 0
  if (hasWater) {
    const step = Math.max(1, Math.floor(water.length / 3 / 4000))
    const ys = []
    for (let i = 1; i < water.length; i += 3 * step) ys.push(water[i])
    ys.sort((a, b) => a - b)
    waterLevel = ys[Math.floor(ys.length / 2)]
  }

  // ---- terrain hijau yang "pakai": abaikan yang ada di bawah laut ----------
  // (di peta LPM, mesh hijau menutupi seluruh persegi termasuk dasar laut,
  // jadi segitiga hijau yang titik tengahnya di area laut gak boleh dipijak)
  const usableGreen = []
  for (let i = 0; i + 8 < green.length; i += 9) {
    const cx = (green[i] + green[i + 3] + green[i + 6]) / 3
    const cz = (green[i + 2] + green[i + 5] + green[i + 8]) / 3
    if (hasWater && waterHash.containsXZ(cx, cz)) continue
    for (let k = 0; k < 9; k++) usableGreen.push(green[i + k])
  }
  const greenTris = new Float32Array(usableGreen)
  const greenHash = new TriHash(greenTris)
  const roadHash = new TriHash(roadTris)
  const buildingHash = new TriHash(buildings)

  // ---- grid tanah pengisi --------------------------------------------------
  const minX = Math.floor(bounds.minX / cell) * cell
  const minZ = Math.floor(bounds.minZ / cell) * cell
  const nx = Math.ceil((bounds.maxX - minX) / cell) + 1
  const nz = Math.ceil((bounds.maxZ - minZ) / cell) + 1
  const count = nx * nz
  const land = new Uint8Array(count)
  const tinExact = new Uint8Array(count)
  const heights = new Float32Array(count)
  const nodeX = (i) => minX + i * cell
  const nodeZ = (j) => minZ + j * cell

  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = nodeX(i), z = nodeZ(j)
      const inExtent =
        !hasWater ||
        (x >= waterExtent.minX && x <= waterExtent.maxX && z >= waterExtent.minZ && z <= waterExtent.maxZ)
      const n = j * nx + i
      land[n] = inExtent && !(hasWater && waterHash.containsXZ(x, z)) ? 1 : 0
      if (land[n]) {
        const t = greenHash.heightAt(x, z)
        if (t > -Infinity) {
          tinExact[n] = 1
          heights[n] = t
        }
      }
    }
  }

  // ---- jangkar buat IDW ----------------------------------------------------
  const anchors = [] // [x, z, y]
  const seen = new Set()
  function addAnchor(x, z, y) {
    if (hasWater && waterHash.containsXZ(x, z)) return
    const k = Math.round(x * 2) + ',' + Math.round(z * 2)
    if (seen.has(k)) return
    seen.add(k)
    anchors.push(x, z, y)
  }
  for (let i = 0; i < greenTris.length; i += 3) addAnchor(greenTris[i], greenTris[i + 2], greenTris[i + 1])
  for (let i = 0; i < roads.length; i += 3) addAnchor(roads[i], roads[i + 2], roads[i + 1])
  // dasar bangunan = ujung bawah dinding (dinding pasti ada, sedangkan sisi
  // bawah/lantai bangunan belum tentu ada di model).
  //
  // BUG FIX (akar masalah "tanah manjat ke gedung"): gedung bertingkat sering
  // direpresentasikan sebagai TUMPUKAN dinding per-lantai, bukan satu dinding
  // utuh lantai-dasar-ke-atap. Kalau y1 tiap segmen dinding langsung dipakai
  // apa adanya, dasar dinding lantai 5/10/dst -- yang sebenarnya melayang di
  // tengah udara -- ikut jadi "jangkar tanah" tepat di posisi X,Z gedung.
  // Efeknya tanah di sekitar gedung ketarik naik ke ketinggian lantai itu.
  // Makanya di sini per SUDUT (x,z) gedung cuma diambil SATU jangkar: titik
  // paling rendah dari semua dinding yang nongol di sudut itu (= lantai
  // dasar beneran).
  const walls = extractWalls(buildings)
  const cornerMinY = new Map()
  function noteCorner(x, z, y) {
    const k = Math.round(x * 20) + ',' + Math.round(z * 20)
    const prev = cornerMinY.get(k)
    if (!prev || y < prev.y) cornerMinY.set(k, { x, z, y })
  }
  for (let s = 0; s < walls.count; s++) {
    noteCorner(walls.x1[s], walls.z1[s], walls.y1[s])
    noteCorner(walls.x2[s], walls.z2[s], walls.y1[s])
  }
  for (const c of cornerMinY.values()) addAnchor(c.x, c.z, c.y)
  for (const t of trunks) addAnchor(t.x, t.z, t.y0 + TREE_SINK)

  const aHash = new Map()
  for (let a = 0; a < anchors.length; a += 3) {
    const k = key(Math.floor(anchors[a] / ANCHOR_CELL), Math.floor(anchors[a + 1] / ANCHOR_CELL))
    let list = aHash.get(k)
    if (!list) {
      list = []
      aHash.set(k, list)
    }
    list.push(a)
  }

  function idw(x, z) {
    const ci = Math.floor(x / ANCHOR_CELL), cj = Math.floor(z / ANCHOR_CELL)
    let sw = 0, swy = 0, found = 0
    for (let r = 0; r <= 40; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue
          const list = aHash.get(key(ci + di, cj + dj))
          if (!list) continue
          for (let n = 0; n < list.length; n++) {
            const a = list[n]
            const dx = anchors[a] - x, dz = anchors[a + 1] - z
            const w = 1 / (dx * dx + dz * dz + 0.5)
            sw += w
            swy += w * anchors[a + 2]
            found++
          }
        }
      }
      if (found >= 6 && r >= 1) break
    }
    return sw > 0 ? swy / sw : waterLevel
  }

  // jarak (dalam langkah grid) ke titik non-darat terdekat, dibatasi
  const distToWater = new Uint8Array(count)
  {
    const cap = Math.ceil(BEACH_WIDTH / cell) + 1
    let frontier = []
    for (let n = 0; n < count; n++) {
      if (!land[n]) {
        distToWater[n] = 0
        frontier.push(n)
      } else {
        distToWater[n] = 255
      }
    }
    for (let d = 1; d <= cap && frontier.length; d++) {
      const next = []
      for (const n of frontier) {
        const i = n % nx, j = (n - i) / nx
        const nbrs = [
          i > 0 ? n - 1 : -1,
          i < nx - 1 ? n + 1 : -1,
          j > 0 ? n - nx : -1,
          j < nz - 1 ? n + nx : -1,
        ]
        for (const m of nbrs) {
          if (m >= 0 && distToWater[m] === 255) {
            distToWater[m] = d
            next.push(m)
          }
        }
      }
      frontier = next
    }
  }

  const shoreY = waterLevel + 0.12
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const n = j * nx + i
      if (!land[n] || tinExact[n]) continue
      const x = nodeX(i), z = nodeZ(j)
      let h = idw(x, z)
      // pantai: landaikan turun ke permukaan air di tepi laut
      if (h > shoreY && distToWater[n] !== 255) {
        h = shoreY + (h - shoreY) * smoothstep((distToWater[n] * cell - cell * 0.5) / BEACH_WIDTH)
      }
      // tanah di bawah jalan diturunkan biar jalan selalu kelihatan di atasnya
      const rh = roadHash.heightAt(x, z)
      if (rh > -Infinity) h = Math.min(h, rh - ROAD_LIFT - 0.08)
      heights[n] = h
    }
  }

  // ---- batasi kemiringan tanah isian ---------------------------------------
  // BUG FIX: sel tanah isian (hasil IDW) di dekat gedung yang berdiri di lahan
  // miring bisa ketarik naik jauh gara-gara jangkar "dasar tembok" gedung itu
  // sendiri jauh lebih tinggi dari tanah sekitarnya (mis. sudut gedung yang
  // nempel ke bukit). Efeknya tanah keliatan "manjat"/nyatu ke badan gedung
  // alih-alih landai. Di sini kita relaksasi: sel isian gak boleh beda tinggi
  // lebih dari MAX_SLOPE (meter) dibanding tetangga darat mana pun (termasuk
  // sesama sel isian), diulang beberapa kali sampai stabil. Sel yang tingginya
  // PASTI (tinExact, dari mesh terrain asli) gak pernah diubah -- itu tetap
  // jadi acuan kebenaran.
  const MAX_SLOPE = 0.9 // m naik/turun maksimum per sel grid (grid = `cell` meter)
  {
    const locked = new Uint8Array(count)
    for (let n = 0; n < count; n++) locked[n] = land[n] && tinExact[n] ? 1 : 0
    for (let pass = 0; pass < 8; pass++) {
      let changed = false
      for (let j = 0; j < nz; j++) {
        for (let i = 0; i < nx; i++) {
          const n = j * nx + i
          if (!land[n] || locked[n]) continue
          let lo = -Infinity, hi = Infinity
          const nbrs = [
            i > 0 ? n - 1 : -1,
            i < nx - 1 ? n + 1 : -1,
            j > 0 ? n - nx : -1,
            j < nz - 1 ? n + nx : -1,
          ]
          for (const m of nbrs) {
            if (m < 0 || !land[m]) continue
            if (heights[m] - MAX_SLOPE > lo) lo = heights[m] - MAX_SLOPE
            if (heights[m] + MAX_SLOPE < hi) hi = heights[m] + MAX_SLOPE
          }
          if (lo > hi) continue // tetangga2 kontradiksi (kasus langka), skip pass ini
          if (heights[n] < lo) { heights[n] = lo; changed = true }
          else if (heights[n] > hi) { heights[n] = hi; changed = true }
        }
      }
      if (!changed) break
    }
  }

  // ---- mesh tanah (visual) -------------------------------------------------
  const groundMesh = buildGroundMesh({ nx, nz, minX, minZ, cell, land, heights, waterHash, waterLevel })

  // ---- fisika tanah ---------------------------------------------------------
  // Tinggi tanah pengisi di (x,z) -- pakai pembagian segitiga yang SAMA dengan
  // mesh visualnya, jadi kaki karakter pas menempel di permukaan yang kelihatan.
  function fillAt(x, z) {
    const fx = (x - minX) / cell, fz = (z - minZ) / cell
    const i = Math.floor(fx), j = Math.floor(fz)
    if (i < 0 || j < 0 || i >= nx - 1 || j >= nz - 1) return null
    const n00 = j * nx + i, n10 = n00 + 1, n01 = n00 + nx, n11 = n01 + 1
    if (!land[n00] || !land[n10] || !land[n01] || !land[n11]) return null
    const u = fx - i, v = fz - j
    const h00 = heights[n00], h10 = heights[n10], h01 = heights[n01], h11 = heights[n11]
    return u >= v ? h00 + (h10 - h00) * u + (h11 - h10) * v : h00 + (h11 - h01) * u + (h01 - h00) * v
  }

  // Permukaan tertinggi di (x,z) yang masih terjangkau (<= yMax); null kalau
  // gak ada pijakan sama sekali (laut / tepi dunia).
  function groundY(x, z, yMax) {
    let best = roadHash.heightAt(x, z, yMax)
    const g = greenHash.heightAt(x, z, yMax)
    if (g > best) best = g
    const f = fillAt(x, z)
    if (f !== null && f <= yMax && f > best) best = f
    return best === -Infinity ? null : best
  }

  // ---- tembok bangunan (grid) ----------------------------------------------
  const wallGrid = new Map()
  function gridAdd(k, idx) {
    let list = wallGrid.get(k)
    if (!list) {
      list = []
      wallGrid.set(k, list)
    }
    list.push(idx)
  }
  for (let s = 0; s < walls.count; s++) {
    const ax = walls.x1[s], az = walls.z1[s], bx = walls.x2[s], bz = walls.z2[s]
    const ci0 = Math.floor(Math.min(ax, bx) / WALL_CELL), ci1 = Math.floor(Math.max(ax, bx) / WALL_CELL)
    const cj0 = Math.floor(Math.min(az, bz) / WALL_CELL), cj1 = Math.floor(Math.max(az, bz) / WALL_CELL)
    for (let cj = cj0; cj <= cj1; cj++) for (let ci = ci0; ci <= ci1; ci++) gridAdd(key(ci, cj), s)
  }
  // batang pohon: disimpan di grid yang sama tapi dengan indeks negatif
  // (-1 - indeksBatang) supaya satu kali pindai mencakup keduanya.
  trunks.forEach((t, idx) => {
    const ci0 = Math.floor((t.x - t.r) / WALL_CELL), ci1 = Math.floor((t.x + t.r) / WALL_CELL)
    const cj0 = Math.floor((t.z - t.r) / WALL_CELL), cj1 = Math.floor((t.z + t.r) / WALL_CELL)
    for (let cj = cj0; cj <= cj1; cj++) for (let ci = ci0; ci <= ci1; ci++) gridAdd(key(ci, cj), -1 - idx)
  })

  const wallStamp = new Int32Array(walls.count)
  const trunkStamp = new Int32Array(trunks.length)
  let stamp = 0

  // Dorong lingkaran (x,z,radius) keluar dari tembok & batang pohon yang
  // menyentuh tubuh karakter (feetY .. feetY+height). Balik posisi baru.
  function resolveWalls(x, z, feetY, radius, height) {
    let hit = false
    for (let iter = 0; iter < 4; iter++) {
      let moved = false
      stamp++
      const ci0 = Math.floor((x - radius) / WALL_CELL), ci1 = Math.floor((x + radius) / WALL_CELL)
      const cj0 = Math.floor((z - radius) / WALL_CELL), cj1 = Math.floor((z + radius) / WALL_CELL)
      for (let cj = cj0; cj <= cj1; cj++) {
        for (let ci = ci0; ci <= ci1; ci++) {
          const list = wallGrid.get(key(ci, cj))
          if (!list) continue
          for (let n = 0; n < list.length; n++) {
            const id = list[n]
            if (id >= 0) {
              if (wallStamp[id] === stamp) continue
              wallStamp[id] = stamp
              // gak ngehalangi kalau seluruh tembok di bawah kaki / di atas kepala
              if (walls.y2[id] <= feetY + 0.3 || walls.y1[id] >= feetY + height) continue
              const ax = walls.x1[id], az = walls.z1[id]
              const ex = walls.x2[id] - ax, ez = walls.z2[id] - az
              const len2 = ex * ex + ez * ez
              let t = len2 > 0 ? ((x - ax) * ex + (z - az) * ez) / len2 : 0
              t = t < 0 ? 0 : t > 1 ? 1 : t
              const px = ax + ex * t, pz = az + ez * t
              let dx = x - px, dz = z - pz
              const d2 = dx * dx + dz * dz
              if (d2 >= radius * radius) continue
              const d = Math.sqrt(d2)
              if (d > 1e-6) {
                dx /= d
                dz /= d
              } else {
                const l = Math.sqrt(len2) || 1
                dx = -ez / l
                dz = ex / l
              }
              x = px + dx * radius
              z = pz + dz * radius
              moved = true
              hit = true
            } else {
              const ti = -1 - id
              if (trunkStamp[ti] === stamp) continue
              trunkStamp[ti] = stamp
              const tr = trunks[ti]
              if (tr.y1 <= feetY + 0.3 || tr.y0 >= feetY + height) continue
              let dx = x - tr.x, dz = z - tr.z
              const rr = radius + tr.r
              const d2 = dx * dx + dz * dz
              if (d2 >= rr * rr) continue
              const d = Math.sqrt(d2)
              if (d > 1e-6) {
                dx /= d
                dz /= d
              } else {
                dx = 1
                dz = 0
              }
              x = tr.x + dx * rr
              z = tr.z + dz * rr
              moved = true
              hit = true
            }
          }
        }
      }
      if (!moved) break
    }
    return { x, z, hit }
  }

  // Tembak "sinar" 2D dari (ox,oz) ke (ex,ez) dan cari tembok pertama yang
  // kena (buat kamera biar gak tembus bangunan). Balik t di [0..1] (1 = bebas).
  function castWalls2D(ox, oz, ex, ez, yLow, yHigh) {
    const dx = ex - ox, dz = ez - oz
    const len = Math.hypot(dx, dz)
    if (len < 1e-6) return 1
    let best = 1
    stamp++
    const steps = Math.max(1, Math.ceil(len / (WALL_CELL * 0.5)))
    for (let s = 0; s <= steps; s++) {
      const px = ox + (dx * s) / steps, pz = oz + (dz * s) / steps
      const ci = Math.floor(px / WALL_CELL), cj = Math.floor(pz / WALL_CELL)
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const list = wallGrid.get(key(ci + di, cj + dj))
          if (!list) continue
          for (let n = 0; n < list.length; n++) {
            const id = list[n]
            if (id < 0 || wallStamp[id] === stamp) continue
            wallStamp[id] = stamp
            if (walls.y2[id] < yLow || walls.y1[id] > yHigh) continue
            const ax = walls.x1[id], az = walls.z1[id]
            const sx = walls.x2[id] - ax, sz = walls.z2[id] - az
            const denom = dx * sz - dz * sx
            if (denom > -1e-9 && denom < 1e-9) continue
            const t = ((ax - ox) * sz - (az - oz) * sx) / denom
            const u = ((ax - ox) * dz - (az - oz) * dx) / denom
            if (t >= 0 && t < best && u >= 0 && u <= 1) best = t
          }
        }
      }
    }
    return best
  }

  // Jarak terdekat dari (x,z) ke tembok/batang mana pun (dibatasi maxDist).
  function clearanceAt(x, z, maxDist) {
    let best = maxDist
    const ci0 = Math.floor((x - maxDist) / WALL_CELL), ci1 = Math.floor((x + maxDist) / WALL_CELL)
    const cj0 = Math.floor((z - maxDist) / WALL_CELL), cj1 = Math.floor((z + maxDist) / WALL_CELL)
    for (let cj = cj0; cj <= cj1; cj++) {
      for (let ci = ci0; ci <= ci1; ci++) {
        const list = wallGrid.get(key(ci, cj))
        if (!list) continue
        for (const id of list) {
          if (id >= 0) {
            const ax = walls.x1[id], az = walls.z1[id]
            const ex = walls.x2[id] - ax, ez = walls.z2[id] - az
            const len2 = ex * ex + ez * ez
            let t = len2 > 0 ? ((x - ax) * ex + (z - az) * ez) / len2 : 0
            t = t < 0 ? 0 : t > 1 ? 1 : t
            best = Math.min(best, Math.hypot(x - (ax + ex * t), z - (az + ez * t)))
          } else {
            const tr = trunks[-1 - id]
            best = Math.min(best, Math.hypot(x - tr.x, z - tr.z) - tr.r)
          }
        }
      }
    }
    return best
  }

  function insideBuilding(x, z) {
    return buildingHash.containsXZ(x, z)
  }

  // Titik lahir: titik jalan di darat yang paling dekat ke (prefX, prefZ) dan
  // lapang (bukan dalam bangunan, jauh dari tembok/batang). Kalau prefX
  // kosong, pakai titik tengah semua bangunan.
  function findSpawn(prefX, prefZ) {
    if (prefX === undefined || prefZ === undefined) {
      let sx = 0, sz = 0, c = 0
      for (let i = 0; i + 8 < buildings.length; i += 9) {
        sx += buildings[i]
        sz += buildings[i + 2]
        c++
      }
      prefX = c ? sx / c : (bounds.minX + bounds.maxX) / 2
      prefZ = c ? sz / c : (bounds.minZ + bounds.maxZ) / 2
    }
    const cands = []
    for (let i = 0; i + 8 < roadTris.length; i += 9) {
      const cx = (roadTris[i] + roadTris[i + 3] + roadTris[i + 6]) / 3
      const cz = (roadTris[i + 2] + roadTris[i + 5] + roadTris[i + 8]) / 3
      cands.push([Math.hypot(cx - prefX, cz - prefZ), cx, cz])
    }
    cands.sort((a, b) => a[0] - b[0])
    const tryPoint = (x, z, need) => {
      if (insideBuilding(x, z)) return null
      if (clearanceAt(x, z, need) < need) return null
      const y = groundY(x, z, Infinity)
      return y === null ? null : { x, y, z }
    }
    for (const [, cx, cz] of cands) {
      const p = tryPoint(cx, cz, 2.5)
      if (p) return p
    }
    // tanpa jalan yang cocok: pindai grid tanah dari yang terdekat
    const nodes = []
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const n = j * nx + i
        if (land[n]) nodes.push([Math.hypot(nodeX(i) - prefX, nodeZ(j) - prefZ), nodeX(i), nodeZ(j)])
      }
    }
    nodes.sort((a, b) => a[0] - b[0])
    for (const [, x, z] of nodes) {
      const p = tryPoint(x, z, 2.5)
      if (p) return p
    }
    return { x: prefX, y: waterLevel, z: prefZ }
  }

  return {
    bounds,
    waterLevel,
    groundMesh,
    walls,
    groundY,
    resolveWalls,
    castWalls2D,
    clearanceAt,
    insideBuilding,
    findSpawn,
    isWaterXZ: (x, z) => hasWater && waterHash.containsXZ(x, z),
  }
}

// ---------------------------------------------------------------------------
// Tembok: segitiga bangunan yang (hampir) tegak diproyeksikan jadi ruas garis
// horizontal dengan rentang tinggi [y1, y2]. Duplikat (2 segitiga per sisi
// dinding) digabung.
// ---------------------------------------------------------------------------
function extractWalls(tris) {
  const map = new Map()
  for (let i = 0; i + 8 < tris.length; i += 9) {
    const ax = tris[i], ay = tris[i + 1], az = tris[i + 2]
    const bx = tris[i + 3], by = tris[i + 4], bz = tris[i + 5]
    const cx = tris[i + 6], cy = tris[i + 7], cz = tris[i + 8]
    const ux = bx - ax, uy = by - ay, uz = bz - az
    const vx = cx - ax, vy = cy - ay, vz = cz - az
    const nxv = uy * vz - uz * vy
    const nyv = uz * vx - ux * vz
    const nzv = ux * vy - uy * vx
    const nl = Math.hypot(nxv, nyv, nzv)
    if (nl < 1e-9) continue
    if (Math.abs(nyv) / nl > 0.25) continue // bukan tembok (atap/lantai)
    // pilih 2 vertex dengan jarak horizontal terjauh
    const P = [[ax, az], [bx, bz], [cx, cz]]
    let bi = 0, bj = 1, bd = -1
    for (let p = 0; p < 3; p++) {
      for (let q = p + 1; q < 3; q++) {
        const d = Math.hypot(P[p][0] - P[q][0], P[p][1] - P[q][1])
        if (d > bd) {
          bd = d
          bi = p
          bj = q
        }
      }
    }
    if (bd < 0.05) continue
    let [x1, z1] = P[bi]
    let [x2, z2] = P[bj]
    if (x1 > x2 || (x1 === x2 && z1 > z2)) {
      ;[x1, z1, x2, z2] = [x2, z2, x1, z1]
    }
    const y1 = Math.min(ay, by, cy), y2 = Math.max(ay, by, cy)
    const k = `${Math.round(x1 * 20)},${Math.round(z1 * 20)},${Math.round(x2 * 20)},${Math.round(z2 * 20)}`
    const prev = map.get(k)
    if (prev) {
      prev.y1 = Math.min(prev.y1, y1)
      prev.y2 = Math.max(prev.y2, y2)
    } else {
      map.set(k, { x1, z1, x2, z2, y1, y2 })
    }
  }
  const count = map.size
  const out = {
    count,
    x1: new Float32Array(count),
    z1: new Float32Array(count),
    x2: new Float32Array(count),
    z2: new Float32Array(count),
    y1: new Float32Array(count),
    y2: new Float32Array(count),
  }
  let s = 0
  for (const w of map.values()) {
    out.x1[s] = w.x1
    out.z1[s] = w.z1
    out.x2[s] = w.x2
    out.z2[s] = w.z2
    out.y1[s] = w.y1
    out.y2[s] = w.y2
    s++
  }
  return out
}

// ---------------------------------------------------------------------------
// Mesh tanah visual. Sel yang punya minimal 1 sudut darat ikut digambar; sudut
// non-darat (laut) diturunkan tepat di bawah permukaan airnya, jadi tepi
// tanah "melandai masuk laut" tanpa celah dengan mesh Waterways.
// ---------------------------------------------------------------------------
function buildGroundMesh({ nx, nz, minX, minZ, cell, land, heights, waterHash, waterLevel }) {
  const vertOf = new Int32Array(nx * nz).fill(-1)
  const pos = []
  const idx = []
  function vertex(i, j) {
    const n = j * nx + i
    if (vertOf[n] >= 0) return vertOf[n]
    const x = minX + i * cell, z = minZ + j * cell
    let y
    if (land[n]) {
      y = heights[n]
    } else {
      const wy = waterHash.heightAt(x, z)
      y = (wy > -Infinity ? wy : waterLevel) - 0.03
    }
    vertOf[n] = pos.length / 3
    pos.push(x, y, z)
    return vertOf[n]
  }
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const n00 = j * nx + i
      if (!land[n00] && !land[n00 + 1] && !land[n00 + nx] && !land[n00 + nx + 1]) continue
      const a = vertex(i, j), b = vertex(i + 1, j), c = vertex(i, j + 1), d = vertex(i + 1, j + 1)
      // diagonal a-d (sama dengan fillAt): (a,d,b) & (a,c,d) -> menghadap atas
      idx.push(a, d, b, a, c, d)
    }
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) }
}
