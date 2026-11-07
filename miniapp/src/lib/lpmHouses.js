// Mengganti rumah-rumah LPM (node "TPX_Buildings_N" di lpm.glb) dengan tampak
// luar "Rumah LPM" 2 lantai yang sama dengan interiornya (lib/houseInteriorLpm.js).
//
// Dipakai di dua tempat: TownMap3D (tampilan peta) dan TownWalk (mode Jelajahi).
// Fungsinya bekerja langsung di `scene` (frame lokal glb: Z ke atas), jadi
// otomatis ikut rotasi/posisi yang dipasang pemanggilnya. Polanya mengikuti
// lib/pantaiHouses.js (Kawasan Pantai).
//
// Tiap rumah lama: disembunyikan (userData.replaced), lalu rumah baru ditaruh
// di titik tengah yang sama (digeser/diskala kalau petaknya sempit), menghadap
// ke jalan terdekat, dengan jalur masuk yang jelas (lihat computeLpmPlacement).
import * as THREE from 'three'
import { buildStaticBoxes, PW, PD, BALKON_D } from './houseInteriorLpm'
import { boxesToGeometry } from './pantaiHouses'
import { buildWalkWorld } from './walkWorld'

const HOUSE_RE = /^TPX_Buildings_(\d+)$/
// Dimensi model (denah): lebar PW (12) + atap menjorok 0.45 kiri-kanan;
// kedalaman PD (10) + balkon/teras di depan + atap menjorok.
const MODEL_W = PW + 0.9
const MODEL_D = PD + BALKON_D + 0.9
const FRONT_MIN_Z = -(BALKON_D + 0.05) // sisi terdepan (pelat balkon lantai 2 / teras)
const MIN_SCALE = 0.7
const GAP = 1.5 // jarak minimum antar rumah (meter)
const MAX_SHIFT = 9 // rumah boleh digeser sejauh ini dari titik aslinya (meter)
const BODY_H = 7.0
const ROAD_NEAR = 25 // meter

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
// Per petak, selain skala & geseran (relaksasi seperti Pantai), arah pintu masuk
// dipilih supaya jalur masuknya jelas:
//   - pintu menghadap jalan terdekat (bukan ke rumah tetangga / ke air),
//   - "teras" di depan pintu (titik 1.5 m di depan fasad) harus di tanah yang
//     bisa dipijak, tidak tertutup rect tetangga, dan punya satu jalan keluar
//     (salah satu dari 4 arah mata angin dari teras yang di tanah & bebas),
//   - kalau terasnya bermasalah, rumah diputar 180° (gratis -- rect simetris),
//     lalu ±90°, lalu digeser (ke arah posisi asal / searah sumbu, maks 3 m),
//     selama tidak menimbulkan tumpang tindih.
//   - rumah yang pintunya MASIH tidak OK setelah itu (di LPM: #104, #148,
//     #153, #189 di tepi air, petaknya terjepit air & tetangga) dipindah ke
//     daratan lapang terdekat (relocateHouses: cincin meluas dari node asal,
//     tapak harus di tanah, pintu OK, tidak tumpang tindih; geser boleh lebih
//     dari 9 m tapi sedekat mungkin). Setelah relokasi, pass perbaikan pintu
//     dijalankan sekali lagi karena rumah yang pindah bisa menutup teras
//     tetangga (mis. #153 menutup teras #83 -- diperbaiki dengan putar 180°).
// Lihat ~/workspace/lpm-work/test_placement_final.mjs buat angka validasinya
// (data GLB asli): 0 tumpang tindih, skala rata-rata 0.92, pintu OK 67/67.
// Keempat rumah yang dipindah: #189 geser 21 m (skala 1.0), #148 geser 26 m,
// #104 geser 36 m, #153 geser 51 m (semuanya skala 0.7 kecuali #189).
// ---------------------------------------------------------------------------
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]]

function rectOf(h) {
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
function porchCenter(h) {
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
function doorOk(h, all, onLand) {
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
function footprintOnLand(h, onLand) {
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
function doorFixPass(infos, onLand) {
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

// Cari daratan lapang terdekat buat satu rumah: cincin meluas dari node ASAL
// (x0, y0), radius 0..80 m, sudut tiap ~1.5 m busur. Kandidat harus: rect
// tidak tumpang tindih, tapak di tanah, pintu OK. Skor = jarak + penalti
// skala ((1-k)*10 m): rumah yang lebih besar diutamakan bila selisih jaraknya
// kecil; lalu GAP sedikit, lalu jarak. Scan berhenti 5 m setelah cincin
// pertama yang berisi kandidat. Mengembalikan {cx, cy, fx, fy, k, r, gv} / null.
function findRelocSpot(h, all, onLand) {
  const cands = []
  let firstRing = null
  for (let r = 0; r <= 80; r += 1) {
    if (firstRing !== null && r > firstRing + 5) break
    const nAng = r === 0 ? 1 : Math.max(12, Math.round((2 * Math.PI * r) / 1.5))
    for (let a = 0; a < nAng; a++) {
      const th = (a / nAng) * 2 * Math.PI
      const cx = h.x0 + r * Math.cos(th), cy = h.y0 + r * Math.sin(th)
      for (const k of [1.0, 0.9, 0.8, 0.7]) {
        for (const [fx, fy] of DIRS) {
          const cand = { num: h.num, cx, cy, fx, fy, k }
          if (overlapsAny(cand, all)) continue
          if (!footprintOnLand(cand, onLand)) continue
          if (!doorOk(cand, all, onLand)) continue
          cands.push({ ...cand, r, gv: gapViolationsOf(cand, all), score: r + (1 - k) * 10 })
          if (firstRing === null) firstRing = r
        }
      }
    }
  }
  if (!cands.length) return null
  cands.sort((a, b) => a.score - b.score || a.gv - b.gv || a.r - b.r)
  return cands[0]
}

// Relokasi (langkah 4): rumah yang pintunya masih tidak OK setelah post-pass
// dipindah ke daratan lapang terdekat. Urutan: skor kandidat terdekat paling
// kecil dulu (yang paling sempit pilihannya didahulukan); tiap rumah dicari
// ulang spotnya karena rumah yang sudah pindah mengubah tetangganya. Rumah
// yang tidak ketemu spot (tidak ada dalam 80 m) dibiarkan di tempatnya.
function relocateHouses(infos, onLand) {
  const failing = infos.filter((h) => !doorOk(h, infos, onLand))
  const ranked = failing
    .map((h) => ({ h, spot: findRelocSpot(h, infos, onLand) }))
    .sort((a, b) => (a.spot?.score ?? 1e9) - (b.spot?.score ?? 1e9))
  for (const { h } of ranked) {
    const spot = findRelocSpot(h, infos, onLand)
    if (!spot) continue
    h.cx = spot.cx; h.cy = spot.cy; h.fx = spot.fx; h.fy = spot.fy; h.k = spot.k
  }
}

// `buildings`: [{ num, cx, cy, sx, sy }] (frame lokal, meter).
// `roads`: [x, y, ...] titik jalan (frame lokal, jarang).
// `isWaterXZ(x, z)`: true kalau titik (koordinat dunia) di dalam segitiga air.
// `onLand(x, y)`: true kalau titik (frame lokal) bisa dipijak.
export function computeLpmPlacement({ buildings, roads, isWaterXZ, onLand }) {
  const center = { x: 0, y: 0 }
  for (const b of buildings) { center.x += b.cx; center.y += b.cy }
  center.x /= buildings.length; center.y /= buildings.length

  // --- 1. pilih arah hadap: jalan terdekat, dengan penalti teras di air / tertutup ---
  function chooseFacing(b) {
    let bestAll = Infinity, tx = 0, ty = 0
    for (let i = 0; i < roads.length; i += 2) {
      const dx = roads[i] - b.cx, dy = roads[i + 1] - b.cy
      const d = dx * dx + dy * dy
      if (d < bestAll) { bestAll = d; tx = dx; ty = dy }
    }
    if (bestAll > ROAD_NEAR * ROAD_NEAR) {
      tx = center.x - b.cx; ty = center.y - b.cy
      if (Math.hypot(tx, ty) > 0.5) {
        if (Math.abs(tx) > Math.abs(ty)) return { fx: Math.sign(tx), fy: 0 }
        return { fx: 0, fy: Math.sign(ty) }
      }
      return { fx: 0, fy: -1 }
    }
    let bestDir = null, bestCost = Infinity
    for (const [fx, fy] of DIRS) {
      let rd = Infinity
      for (let i = 0; i < roads.length; i += 2) {
        const dx = roads[i] - b.cx, dy = roads[i + 1] - b.cy
        if (dx * fx + dy * fy <= 1) continue
        rd = Math.min(rd, Math.hypot(dx, dy))
      }
      if (rd === Infinity) rd = 40
      const probe = { num: b.num, cx: b.cx, cy: b.cy, fx, fy, k: 1 }
      const p = porchCenter(probe)
      const waterN = isWaterXZ(p.x, -p.y) ? 1 : 0
      let blocked = 0
      for (const o of buildings) {
        if (o.num === b.num) continue
        if (Math.hypot(o.cx - b.cx, o.cy - b.cy) > 30) continue
        if (pointInRect(p.x, p.y, { cx: o.cx, cy: o.cy, w: o.sx + 1, d: o.sy + 1 }, 0.5)) blocked++
      }
      let exit = false
      for (const [ex, ey] of DIRS) {
        const x = p.x + ex * 2.5, y = p.y + ey * 2.5
        if (isWaterXZ(x, -y)) continue
        let inside = false
        for (const o of buildings) {
          if (o.num === b.num) continue
          if (pointInRect(x, y, { cx: o.cx, cy: o.cy, w: o.sx + 1, d: o.sy + 1 }, 0.5)) { inside = true; break }
        }
        if (!inside) { exit = true; break }
      }
      const cost = rd + 25 * waterN + 15 * blocked + (exit ? 0 : 10)
      if (cost < bestCost) { bestCost = cost; bestDir = { fx, fy } }
    }
    return bestDir
  }

  const infos = buildings.map((b) => {
    const f = chooseFacing(b)
    return { num: b.num, cx: b.cx, cy: b.cy, x0: b.cx, y0: b.cy, fx: f.fx, fy: f.fy, k: 1 }
  })

  // --- 2. relaksasi (sama seperti Pantai): geser menjauh, lalu kecilkan skala ---
  const dims = (h) => {
    const alongY = h.fx === 0
    return [(alongY ? MODEL_W : MODEL_D) * h.k, (alongY ? MODEL_D : MODEL_W) * h.k]
  }
  const pen = (A, B) => {
    const [aw, ad] = dims(A), [bw, bd] = dims(B)
    const ox = (aw + bw) / 2 + GAP - Math.abs(A.cx - B.cx)
    const oy = (ad + bd) / 2 + GAP - Math.abs(A.cy - B.cy)
    return ox > 0 && oy > 0 ? [ox, oy] : null
  }
  const clampShift = (h) => {
    const dx = h.cx - h.x0, dy = h.cy - h.y0, d = Math.hypot(dx, dy)
    if (d > MAX_SHIFT) { h.cx = h.x0 + (dx / d) * MAX_SHIFT; h.cy = h.y0 + (dy / d) * MAX_SHIFT }
  }
  for (let round = 0; round < 30; round++) {
    for (let it = 0; it < 60; it++) {
      let moved = false
      for (let i = 0; i < infos.length; i++) for (let j = i + 1; j < infos.length; j++) {
        const A = infos[i], B = infos[j], o = pen(A, B)
        if (!o) continue
        moved = true
        const sx = A.cx === B.cx ? (i % 2 ? 1 : -1) : Math.sign(A.cx - B.cx)
        const sy = A.cy === B.cy ? (i % 2 ? 1 : -1) : Math.sign(A.cy - B.cy)
        if (o[0] < o[1]) { A.cx += (sx * o[0]) / 2; B.cx -= (sx * o[0]) / 2 } else { A.cy += (sy * o[1]) / 2; B.cy -= (sy * o[1]) / 2 }
        clampShift(A); clampShift(B)
      }
      if (!moved) break
    }
    let still = false
    for (let i = 0; i < infos.length; i++) for (let j = i + 1; j < infos.length; j++) {
      if (!pen(infos[i], infos[j])) continue
      still = true
      for (const h of [infos[i], infos[j]]) h.k = Math.max(MIN_SCALE, h.k * 0.96)
    }
    if (!still) break
  }

  // --- 3. post-pass: perbaiki jalur masuk rumah yang terasnya bermasalah ---
  doorFixPass(infos, onLand)

  // --- 4. relokasi: rumah yang pintunya masih tidak OK (di LPM: #104, #148,
  // #153, #189 di tepi air) dipindah ke daratan lapang terdekat; geser boleh
  // lebih dari 9 m, tapi sedekat mungkin dengan node asalnya.
  relocateHouses(infos, onLand)

  // --- 5. perbaikan ulang: relokasi bisa menutup teras tetangga (mis. #83
  // yang terasnya tertutup #153 yang pindah) -- perbaiki lagi seperti langkah 3.
  // Catatan: fits() di doorFixPass membatasi geser 9 m dari node asal, jadi
  // rumah yang sudah direlokasi (19-51 m) hanya bisa diperbaiki lewat putar
  // 180° di langkah ini -- itu cukup karena relokasi sudah menjamin pintunya OK.
  doorFixPass(infos, onLand)
  return infos
}

// Titik-titik jalan (frame lokal scene), diambil jarang supaya ringan.
function collectRoadPoints(scene, inv) {
  const pts = []
  const v = new THREE.Vector3()
  scene.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry) return
    let inRoad = false
    for (let o = obj; o; o = o.parent) {
      if ((o.name || '').startsWith('TPX_Roads')) { inRoad = true; break }
    }
    if (!inRoad) return
    const pos = obj.geometry.getAttribute('position')
    if (!pos) return
    const step = Math.max(1, Math.floor(pos.count / 4000))
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld).applyMatrix4(inv)
      pts.push(v.x, v.y)
    }
  })
  return pts
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
export function addLpmHouses(scene, waterDrop = 0) {
  if (!scene || scene.userData.lpmHouses) return
  scene.updateWorldMatrix(true, true)
  const inv = new THREE.Matrix4().copy(scene.matrixWorld).invert()
  const rel = new THREE.Matrix4()

  const old = []
  scene.traverse((obj) => {
    if (obj.isMesh && obj.geometry && HOUSE_RE.test(obj.name || '')) old.push(obj)
  })
  if (!old.length) return

  const roads = collectRoadPoints(scene, inv)
  const walk = buildWalkWorld({ ...collectWalkTriangles(scene, inv, waterDrop), props: [], floors: new Float32Array(0), cell: 2 })
  // frame lokal (x, y) -> dunia (x, -y) buat uji tanah
  const onLand = (x, y) => walk.groundY(x, -y, Infinity) !== null
  const isWaterXZ = (x, z) => walk.isWaterXZ(x, z)
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

  const infos = computeLpmPlacement({ buildings, roads, isWaterXZ, onLand })
  const byNum = new Map(infos.map((h) => [h.num, h]))
  for (const b of buildings) {
    const h = byNum.get(b.num)
    h.obj = b.obj
    h.minZ = b.minZ
  }

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
    const { obj, num, cx, cy, fx, fy, k } = h
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
    // nama dikenali TownWalk (nomor rumah + tabrakan)
    const { root: house, mirror } = frame(`TPX_Buildings_${num}`)
    const solid = new THREE.Mesh(sh.solid, sh.solidMat)
    const glass = new THREE.Mesh(sh.glass, sh.glassMat)
    glass.renderOrder = 2
    solid.name = `LpmRumah_${num}`
    glass.name = `LpmKaca_${num}`
    solid.userData.noCollide = true
    glass.userData.noCollide = true
    const extra = new THREE.Mesh(sh.extra, sh.solidMat)
    extra.name = `LpmCarport_${num}`
    extra.userData.noCollide = true
    const col = new THREE.Mesh(sh.collider, sh.colliderMat)
    col.name = `LpmTabrak_${num}`
    col.visible = false
    mirror.add(solid, glass, extra, col)

    // Pondasi bawaan model cuma setebal FOUND_D * k. Kalau tanah di sisi bawah
    // lebih dalam dari itu, rumah kelihatan melayang: tambah blok pondasi
    // (visual saja) sampai menyentuh tanah terendah.
    const extraH = h.drop - FOUND_D * k + FOUND_MARGIN
    if (extraH > 0.05) {
      const fm = new THREE.Mesh(foundationGeo(sh, Math.ceil(extraH / k / FOUND_STEP) * FOUND_STEP), sh.foundMat)
      fm.name = `LpmPondasi_${num}`
      fm.userData.noCollide = true
      mirror.add(fm)
    }
    group.add(house)

    // Tabrakan pondasi: tanpa ini pemain di sisi tanah yang lebih rendah bisa
    // berjalan menembus pondasi (kotak tabrakan badan mulai dari lantai). Dibuat
    // di grup bernama "TPX_BuildingsBase_N": TownWalk tetap menganggapnya
    // bangunan (awalan TPX_Buildings) sebagai dinding, tapi tidak dihitung
    // sebagai node rumah bernomor, jadi dasar bangunan (baseY) untuk fitur
    // Masuki rumah tetap setinggi lantai.
    if (h.drop > COLLIDE_MIN_DROP) {
      const { root: baseRoot, mirror: baseMirror } = frame(`TPX_BuildingsBase_${num}`)
      const bc = new THREE.Mesh(baseColliderGeo(sh, (h.drop + FOUND_MARGIN + 0.05) / k), sh.colliderMat)
      bc.name = `LpmPondasiTabrak_${num}`
      bc.visible = false
      baseMirror.add(bc)
      group.add(baseRoot)
    }

    obj.visible = false
    obj.userData.replaced = true
  }

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
