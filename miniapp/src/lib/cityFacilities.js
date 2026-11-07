// 30 fasilitas kota pulau (legenda 1-30 di layout user).
//
// Tahap 1: file ini cuma REGISTRY posisi + ukuran (dipakai penempatan rumah
// supaya tidak menabrak fasilitas, dan penempatan pohon).
// Tahap 2A (file ini): EKSTERIOR prosedural per fasilitas, sesuai usecase
// (RS bertingkat + helipad + garasi ambulans, penjara bertembok + menara jaga,
// pelabuhan + crane + dermaga, sirkuit oval + tribun + pit, dst.).
// Interior playable dikerjakan terpisah (Tahap 2B) — eksterior di sini dibuat
// sebagai CANGKANG BERONGGA (dinding + pelat lantai + atap, bukan balok masif)
// supaya interior bisa dipasang di dalamnya; pintu depan dibiarkan terbuka
// (celah di dinding + ambang atas), tanpa daun pintu.
//
// Koordinat frame lokal (x timur, y selatan), (x, y) = tengah tapak,
// w/d = lebar/dalam tapak (meter). `rot` (opsional) = hadap bangunan (derajat,
// 0 = menghadap selatan/+y). Fasilitas 14 & 24 muncul 2x di gambar -> a/b.
// Penjara (6) di pulau kecil barat-daya (tanpa jembatan — aksesnya urusan Tahap 2).
// Dermaga (30): tapak darat di ujung selatan; dermaganya menjorok ke laut.
// Taman Kota (18): taman (tanpa bangunan) — tapaknya tetap diblokir buat rumah.
//
// Aturan penamaan & integrasi (jangan dilanggar):
//   - grup tiap fasilitas: `TPX_Buildings_F<n>` (masuk ekstraktor tembok
//     TownWalk/TownMap3D sebagai grup bangunan, tapi regex visit bernomor
//     /^TPX_Buildings_\d+$/ tidak mengenainya, jadi belum bisa dimasuki).
//   - mesh eksterior: `Fasilitas_<tipe>_<n>` (+ sufiks buat bagian tambahan),
//     userData.noCollide + sharedMaterial (+ clonedMaterial) = true.
//   - SATU collider tak terlihat per fasilitas: BoxGeometry seukuran bangunan
//     utama tapaknya, visible=false, nama `FasilitasTabrak_<n>`, TANPA
//     noCollide (jadi tembok tabrakan via extractWalls). Fasilitas yang
//     tapaknya sebagian besar ruang terbuka (taman, pasar malam, arena,
//     sirkuit, resort, tambang, scrap, pelabuhan) collidernya hanya menutup
//     bangunan/struktur utamanya, supaya halaman/lapangan tetap bisa dilalui.
//   - Ketinggian dasar = tinggi terrain tertinggi di tapak + 0.05 (heightAt
//     dari buildCityData); lereng ditutup pondasi/plinth di bawah bangunan.
//     Sirkuit pengecualian: lintasannya mengikuti terrain (seperti jalan),
//     z0 diambil dari tapak gedung pit.
//   - Geometri/material SHARED: 2 material vertex-color (solid + kaca) buat
//     semua kotak, 1 geometri unit box + segelintir geometri putar buat
//     bagian khusus (tiang, kubah, roda bianglala, ...), palet material
//     polos kecil (matFor, di-cache per warna).

import * as THREE from 'three'
import { buildCityData } from './cityData.js'

export const FACILITIES = [
  // Posisi mengikuti peta referensi (pulau memanjang, teluk selatan, semenanjung
  // barat, Kompleks Selatan). Ukuran rect TETAP supaya 7 interior yang sudah
  // ada (F1/F2/F3/F5/F7/F11/F12) tetap muat.
  { n: 1, name: 'Job Center', x: 670, y: -560, w: 40, d: 30 },
  { n: 2, name: 'Kantor Polisi', x: -310, y: 20, w: 35, d: 25 },
  { n: 3, name: 'Rumah Sakit', x: -10, y: -160, w: 60, d: 45 },
  { n: 4, name: 'Gym', x: -190, y: -220, w: 30, d: 20 },
  { n: 5, name: 'Bank Sentral', x: -170, y: -80, w: 30, d: 25 },
  { n: 6, name: 'Penjara Pulau', x: -1390, y: 880, w: 80, d: 60 },
  { n: 7, name: 'Kampus & Sekolah', x: 780, y: -250, w: 70, d: 50 },
  { n: 8, name: 'Rumah Ibadah', x: -150, y: 80, w: 30, d: 30 },
  { n: 9, name: 'Pelabuhan Utama', x: 420, y: 580, w: 120, d: 80 },
  { n: 10, name: 'Sirkuit Balap', x: 1070, y: -680, w: 350, d: 220 },
  { n: 11, name: 'Pasar Rakyat', x: 750, y: -200, w: 60, d: 40 },
  { n: 12, name: 'Mall', x: 1000, y: 0, w: 70, d: 50 },
  { n: 13, name: 'Bioskop', x: 1250, y: -100, w: 40, d: 30 },
  { n: '14a', name: 'Toko Senjata', x: 1190, y: -200, w: 25, d: 20 },
  { n: '14b', name: 'Toko Senjata', x: 1190, y: -40, w: 25, d: 20 },
  { n: 15, name: 'Showroom Dealer', x: 590, y: 540, w: 50, d: 35 },
  { n: 16, name: 'Bengkel', x: 590, y: 360, w: 40, d: 30 },
  { n: 17, name: 'Pantai & Resort', x: -1280, y: 10, w: 100, d: 70 },
  { n: 18, name: 'Taman Kota', x: 50, y: 150, w: 80, d: 80 },
  { n: 19, name: 'Pabrik Crafting', x: 700, y: 300, w: 90, d: 60 },
  { n: 20, name: 'Kafe & Bar', x: 1200, y: 450, w: 25, d: 20 },
  { n: 21, name: 'Restoran', x: 1100, y: 600, w: 30, d: 25 },
  { n: 22, name: 'Arena Olahraga', x: 900, y: 700, w: 80, d: 60 },
  { n: 23, name: 'Pasar Malam', x: -210, y: 400, w: 80, d: 60 },
  { n: '24a', name: 'Kost-Kosan', x: 1080, y: 500, w: 30, d: 25 },
  { n: '24b', name: 'Kost-Kosan', x: 1000, y: 620, w: 30, d: 25 },
  { n: 25, name: 'Pengadilan', x: 150, y: 300, w: 35, d: 30 },
  { n: 26, name: 'Tambang & Pabrik', x: -590, y: -850, w: 100, d: 80 },
  { n: 27, name: 'Scrap Yard', x: -410, y: -880, w: 80, d: 60 },
  { n: 28, name: 'SPBU', x: 600, y: 700, w: 40, d: 30 },
  { n: 29, name: 'Markas Geng', x: -680, y: -750, w: 50, d: 40 },
  { n: 30, name: 'Dermaga Memancing', x: 330, y: 640, w: 30, d: 40 },
]

// Slug tipe buat nama mesh `Fasilitas_<tipe>_<n>`.
export const FACILITY_TYPES = {
  1: 'JobCenter', 2: 'Polisi', 3: 'RumahSakit', 4: 'Gym', 5: 'Bank',
  6: 'Penjara', 7: 'Kampus', 8: 'RumahIbadah', 9: 'Pelabuhan', 10: 'Sirkuit',
  11: 'Pasar', 12: 'Mall', 13: 'Bioskop', '14a': 'TokoSenjata', '14b': 'TokoSenjata',
  15: 'Dealer', 16: 'Bengkel', 17: 'Resort', 18: 'Taman', 19: 'Pabrik',
  20: 'Kafe', 21: 'Restoran', 22: 'Arena', 23: 'PasarMalam',
  '24a': 'Kost', '24b': 'Kost', 25: 'Pengadilan', 26: 'Tambang',
  27: 'ScrapYard', 28: 'SPBU', 29: 'MarkasGeng', 30: 'Dermaga',
}

// Tapak fasilitas sebagai rect {x0,y0,x1,y1} (dipakai blockedRects penempatan
// rumah/pohon). `pad` = jarak aman tambahan di sekeliling tapak.
export function facilityRects(pad = 2) {
  return FACILITIES.map((f) => ({
    n: f.n,
    x0: f.x - f.w / 2 - pad,
    y0: f.y - f.d / 2 - pad,
    x1: f.x + f.w / 2 + pad,
    y1: f.y + f.d / 2 + pad,
  }))
}

export function facilityById(n) {
  return FACILITIES.find((f) => f.n === n) || null
}

// ---------------------------------------------------------------------------
// Aset bersama (satu set buat semua fasilitas — jangan material/geometri
// unik per fasilitas).
// ---------------------------------------------------------------------------
const C = {
  concrete: 0xcfccc2, concreteDark: 0x8a8d90, roofDark: 0x3d4248,
  white: 0xf7f7f5, wallWhite: 0xf2efe6, asphalt: 0x646464, glass: 0x6f93a8,
  red: 0xc23b2e, blue: 0x2e5fa3, gold: 0xe0a92c, green: 0x3d7a44,
  wood: 0x8a6a44, woodDark: 0x6b4a2f, brick: 0xa85f3f, rust: 0x8a5a34,
  sand: 0xd9c391, water: 0x3b9be0, grass: 0x5da244, dark: 0x222222,
  purple: 0x7a4a9e, wallGray: 0x9a958a, rock: 0x777777, rockDark: 0x555555,
}

let SHARED = null
function sharedAssets() {
  if (SHARED) return SHARED
  const plain = new Map()
  const matFor = (hex) => {
    let m = plain.get(hex)
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.85, metalness: 0, side: THREE.DoubleSide })
      plain.set(hex, m)
    }
    return m
  }
  SHARED = {
    solidMat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 }),
    glassMat: new THREE.MeshStandardMaterial({
      vertexColors: true, transparent: true, opacity: 0.55, roughness: 0.08,
      metalness: 0.1, depthWrite: false, side: THREE.DoubleSide,
    }),
    colliderMat: new THREE.MeshBasicMaterial({ visible: false }),
    matFor,
    // geometri bersama (frame lokal kota: x timur, y selatan, z ke atas)
    unitBox: new THREE.BoxGeometry(1, 1, 1),
    colliderGeo: new THREE.BoxGeometry(1, 1, 1),
    cylZ: new THREE.CylinderGeometry(0.5, 0.5, 1, 12).rotateX(Math.PI / 2), // sumbu Z, r=0.5, pjg 1
    coneZ: new THREE.ConeGeometry(0.5, 1, 12).rotateX(Math.PI / 2), // alas r=0.5, tinggi 1, puncak +Z
    domeZ: new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2), // kubah r=1, z 0..1
    torusZ: new THREE.TorusGeometry(1, 0.045, 8, 48).rotateX(Math.PI / 2), // cincin vertikal (bidang X-Z), r=1
    discZ: new THREE.CylinderGeometry(1, 1, 0.12, 28).rotateX(Math.PI / 2), // cakram datar r=1, tebal 0.12
    icosa: new THREE.IcosahedronGeometry(1, 1),
  }
  return SHARED
}

// ---------------------------------------------------------------------------
// Kotak (denah + tinggi) -> geometri ber-vertex-color, frame lokal kota
// (x timur, y selatan, z ke atas). Sama polanya dengan boxesToGeometry di
// pantaiHouses.js, tapi sumbu Z-nya sudah ke atas (tanpa rotasi X +90).
// Box: {x0, y0, z0, x1, y1, z1, c}.
// ---------------------------------------------------------------------------
const FACES = [
  [[1, 0, 0], [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]]],
  [[-1, 0, 0], [[0, 1, 0], [0, 0, 0], [0, 0, 1], [0, 1, 1]]],
  [[0, 1, 0], [[1, 1, 0], [0, 1, 0], [0, 1, 1], [1, 1, 1]]],
  [[0, -1, 0], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]],
  [[0, 0, 1], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]],
  [[0, 0, -1], [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]]],
]

function boxesToGeometryZ(boxes) {
  const n = boxes.length
  const pos = new Float32Array(n * 24 * 3)
  const nor = new Float32Array(n * 24 * 3)
  const col = new Float32Array(n * 24 * 3)
  const idx = new Uint32Array(n * 36)
  const color = new THREE.Color()
  let v = 0, ii = 0
  for (const b of boxes) {
    color.setHex(b.c)
    for (const [nrm, corners] of FACES) {
      for (const [cx, cy, cz] of corners) {
        const o = v * 3
        pos[o] = cx ? b.x1 : b.x0
        pos[o + 1] = cy ? b.y1 : b.y0
        pos[o + 2] = cz ? b.z1 : b.z0
        nor[o] = nrm[0]; nor[o + 1] = nrm[1]; nor[o + 2] = nrm[2]
        col[o] = color.r; col[o + 1] = color.g; col[o + 2] = color.b
        v++
      }
      idx[ii++] = v - 4; idx[ii++] = v - 2; idx[ii++] = v - 3
      idx[ii++] = v - 4; idx[ii++] = v - 1; idx[ii++] = v - 2
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.setIndex(new THREE.BufferAttribute(idx, 1))
  g.computeBoundingSphere()
  return g
}

function markShared(mesh) {
  mesh.userData.noCollide = true
  mesh.userData.sharedMaterial = true
  mesh.userData.clonedMaterial = true
}

// Tinggi terrain (world) di atas tapak — dipakai plinth & alas per bangunan.
function sampleHeights(heightAt, cx, cy, w, d) {
  let mn = Infinity, mx = -Infinity
  for (let i = 0; i <= 8; i++) {
    for (let j = 0; j <= 8; j++) {
      const h = heightAt(cx - w / 2 + (i / 8) * w, cy - d / 2 + (j / 8) * d)
      if (h < mn) mn = h
      if (h > mx) mx = h
    }
  }
  return { min: mn, max: mx }
}

// ---------------------------------------------------------------------------
// Konteks builder satu fasilitas. Koordinat lokal: titik (0,0) = tengah
// tapak, +x timur, +y selatan, z = 0 di lantai dasar (z0 dunia). Semua kotak
// masuk ember `solid` / `glass` (1 mesh per ember); bagian miring/putar
// (tiang, kubah, balok miring, mobil, ...) jadi mesh `part` dari geometri
// bersama. Di akhir, finish() merakit mesh + 1 collider.
// ---------------------------------------------------------------------------
function makeFac(f, z0, heightAt, sh) {
  const group = new THREE.Group()
  group.position.set(f.x, f.y, z0)
  group.name = `TPX_Buildings_F${f.n}`
  const slug = FACILITY_TYPES[f.n]
  const fac = {
    f, z0, sh, group, slug,
    solid: [], glass: [],

    box(x0, y0, za, x1, y1, zb, c, bucket = 'solid') {
      if (x1 - x0 < 0.05 || y1 - y0 < 0.05 || zb - za < 0.05) return
      ;(bucket === 'glass' ? this.glass : this.solid).push({ x0, y0, z0: za, x1, y1, z1: zb, c })
    },
    slab(cx, cy, w, d, za, zb, c, bucket = 'solid') {
      this.box(cx - w / 2, cy - d / 2, za, cx + w / 2, cy + d / 2, zb, c, bucket)
    },
    // Pondasi/plinth di bawah bangunan: dari tanah terendah tapak bangunan
    // (minus 0.2) sampai lantai (floorZ, lokal). Selalu >= 0.4 m.
    plinth(cx, cy, w, d, floorZ = 0) {
      const s = sampleHeights(heightAt, f.x + cx, f.y + cy, w, d)
      let zb = s.min - 0.2 - z0
      if (floorZ - zb < 0.4) zb = floorZ - 0.4
      this.box(cx - w / 2 - 0.15, cy - d / 2 - 0.15, zb, cx + w / 2 + 0.15, cy + d / 2 + 0.15, floorZ, C.roofDark)
    },
    // Alas lantai (lokal) buat bangunan di tapak miring: terrain tertinggi
    // di tapak bangunan itu, relatif ke z0 grup.
    baseZAt(cx, cy, w, d) {
      return sampleHeights(heightAt, f.x + cx, f.y + cy, w, d).max + 0.05 - z0
    },
    part(geo, mat, p, s = [1, 1, 1], r = [0, 0, 0], name = 'bagian') {
      const m = new THREE.Mesh(geo, mat)
      m.position.set(p[0], p[1], p[2])
      m.scale.set(s[0], s[1], s[2])
      m.rotation.set(r[0], r[1], r[2])
      m.name = `Fasilitas_${slug}_${f.n}_${name}`
      markShared(m)
      group.add(m)
      return m
    },
    // Balok lurus antara dua titik (konveyor, boom crane, lengan ekskavator,
    // jari-jari bianglala, rel dermaga): unit box direntang sepanjang arahnya.
    beam(ax, ay, az, bx, by, bz, w, mat, name = 'balok') {
      const a = new THREE.Vector3(ax, ay, az)
      const b = new THREE.Vector3(bx, by, bz)
      const dir = b.clone().sub(a)
      const len = dir.length()
      if (len < 0.05) return null
      const m = new THREE.Mesh(sh.unitBox, mat)
      m.position.copy(a).add(b).multiplyScalar(0.5)
      m.scale.set(len, w, w)
      m.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir.normalize())
      m.name = `Fasilitas_${slug}_${f.n}_${name}`
      markShared(m)
      group.add(m)
      return m
    },
    pole(x, y, za, zb, r, mat, name = 'tiang') {
      return this.part(sh.cylZ, mat, [x, y, (za + zb) / 2], [r * 2, r * 2, zb - za], [0, 0, 0], name)
    },
    disc(x, y, z, r, mat, h = 0.15, name = 'cakram') {
      return this.part(sh.discZ, mat, [x, y, z], [r, r, h / 0.12], [0, 0, 0], name)
    },
    cone(x, y, zBase, r, h, mat, name = 'kerucut') {
      return this.part(sh.coneZ, mat, [x, y, zBase + h / 2], [r * 2, r * 2, h], [0, 0, 0], name)
    },
    dome(x, y, zBase, r, h, mat, name = 'kubah') {
      return this.part(sh.domeZ, mat, [x, y, zBase], [r, r, h], [0, 0, 0], name)
    },
    tree(x, y, zBase, s = 1, crown = 0x4d8f3a) {
      this.pole(x, y, zBase, zBase + 3.2 * s, 0.22 * s, sh.matFor(C.woodDark), 'pohon')
      this.part(sh.icosa, sh.matFor(crown), [x, y, zBase + 4.6 * s], [2.4 * s, 2.4 * s, 2.4 * s], [0, 0, 0], 'tajuk')
    },
    // Mobil sederhana (badan + kabin + kolong gelap), menghadap +x, diputar
    // `angle` (radian, sumbu Z). zBase = permukaan tempat mobil berdiri.
    car(cx, cy, zBase, angle, color) {
      const mat = sh.matFor(color)
      this.part(sh.unitBox, mat, [cx, cy, zBase + 0.75], [4.2, 1.9, 0.75], [0, 0, angle], 'mobil')
      this.part(sh.unitBox, sh.matFor(0x2e4a5a), [cx - 0.2, cy, zBase + 1.45], [2.2, 1.7, 0.65], [0, 0, angle], 'mobil_kabin')
      this.part(sh.unitBox, sh.matFor(C.dark), [cx, cy, zBase + 0.35], [4.0, 1.8, 0.35], [0, 0, angle], 'mobil_kolong')
    },
    // Lapak pasar (meja + barang + 4 tiang + atap warna).
    stall(cx, cy, roofC) {
      this.box(cx - 1.8, cy - 0.5, 0.12, cx + 1.8, cy + 0.5, 1.2, C.wood)
      this.box(cx - 1.2, cy - 0.3, 1.2, cx - 0.4, cy + 0.3, 1.6, C.red)
      this.box(cx + 0.3, cy - 0.3, 1.2, cx + 1.1, cy + 0.3, 1.55, C.green)
      for (const [px, py] of [[-1.7, -1.3], [1.7, -1.3], [-1.7, 1.3], [1.7, 1.3]]) {
        this.box(cx + px - 0.08, cy + py - 0.08, 0.12, cx + px + 0.08, cy + py + 0.08, 2.6, C.woodDark)
      }
      this.box(cx - 2, cy - 1.5, 2.6, cx + 2, cy + 1.5, 2.75, roofC)
    },
    // Cangkang gedung berongga: dinding tebal 0.4 (pintu = celah + ambang),
    // pelat lantai per tingkat, pita kaca di dinding, atap + parapet,
    // pita aksen warna di puncak dinding, kotak AC di atap.
    // door: 'S' (+y, depan) / 'N' / 'E' / 'W' / null.
    building(o) {
      const {
        cx = 0, cy = 0, w, d, floors = 1, floorH = 3.4, wall = C.wallWhite,
        roof = C.roofDark, band = null, door = null, doorW = 2.4, doorH = 2.6,
        glass = true, baseZ = 0,
      } = o
      const t = 0.4
      const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - d / 2, y1 = cy + d / 2
      this.slab(cx, cy, w, d, baseZ - 0.05, baseZ + 0.25, C.concrete)
      const topZ = baseZ + floors * floorH
      for (let fi = 0; fi < floors; fi++) {
        const za = baseZ + fi * floorH, zb = za + floorH
        if (fi > 0) this.slab(cx, cy, w, d, za - 0.15, za + 0.05, C.concrete)
        // dinding utara
        if (door === 'N' && fi === 0) {
          this.box(x0, y0, za, cx - doorW / 2, y0 + t, zb, wall)
          this.box(cx + doorW / 2, y0, za, x1, y0 + t, zb, wall)
          this.box(cx - doorW / 2, y0, za + doorH, cx + doorW / 2, y0 + t, zb, wall)
        } else {
          this.box(x0, y0, za, x1, y0 + t, zb, wall)
        }
        // dinding selatan
        if (door === 'S' && fi === 0) {
          this.box(x0, y1 - t, za, cx - doorW / 2, y1, zb, wall)
          this.box(cx + doorW / 2, y1 - t, za, x1, y1, zb, wall)
          this.box(cx - doorW / 2, y1 - t, za + doorH, cx + doorW / 2, y1, zb, wall)
        } else {
          this.box(x0, y1 - t, za, x1, y1, zb, wall)
        }
        // dinding barat
        if (door === 'W' && fi === 0) {
          this.box(x0, y0 + t, za, x0 + t, cy - doorW / 2, zb, wall)
          this.box(x0, cy + doorW / 2, za, x0 + t, y1 - t, zb, wall)
          this.box(x0, cy - doorW / 2, za + doorH, x0 + t, cy + doorW / 2, zb, wall)
        } else {
          this.box(x0, y0 + t, za, x0 + t, y1 - t, zb, wall)
        }
        // dinding timur
        if (door === 'E' && fi === 0) {
          this.box(x1 - t, y0 + t, za, x1, cy - doorW / 2, zb, wall)
          this.box(x1 - t, cy + doorW / 2, za, x1, y1 - t, zb, wall)
          this.box(x1 - t, cy - doorW / 2, za + doorH, x1, cy + doorW / 2, zb, wall)
        } else {
          this.box(x1 - t, y0 + t, za, x1, y1 - t, zb, wall)
        }
        // pita kaca (menonjol 0.06 dari muka dinding)
        if (glass && w > 6 && d > 6) {
          const gz0 = za + 1.1, gz1 = Math.min(zb - 0.7, za + 2.5)
          if (gz1 > gz0 + 0.3) {
            if (door === 'N' && fi === 0) {
              this.box(x0 + 1.5, y0 - 0.06, gz0, cx - doorW / 2 - 0.8, y0 + 0.09, gz1, C.glass, 'glass')
              this.box(cx + doorW / 2 + 0.8, y0 - 0.06, gz0, x1 - 1.5, y0 + 0.09, gz1, C.glass, 'glass')
            } else {
              this.box(x0 + 1.5, y0 - 0.06, gz0, x1 - 1.5, y0 + 0.09, gz1, C.glass, 'glass')
            }
            if (door === 'S' && fi === 0) {
              this.box(x0 + 1.5, y1 - 0.09, gz0, cx - doorW / 2 - 0.8, y1 + 0.06, gz1, C.glass, 'glass')
              this.box(cx + doorW / 2 + 0.8, y1 - 0.09, gz0, x1 - 1.5, y1 + 0.06, gz1, C.glass, 'glass')
            } else {
              this.box(x0 + 1.5, y1 - 0.09, gz0, x1 - 1.5, y1 + 0.06, gz1, C.glass, 'glass')
            }
            this.box(x0 - 0.06, y0 + 1.5, gz0, x0 + 0.09, y1 - 1.5, gz1, C.glass, 'glass')
            this.box(x1 - 0.09, y0 + 1.5, gz0, x1 + 0.06, y1 - 1.5, gz1, C.glass, 'glass')
          }
        }
        // kanopi + anak tangga (pintu selatan saja)
        if (fi === 0 && door === 'S') {
          this.box(cx - doorW / 2 - 0.8, y1 - 0.1, za + doorH + 0.3, cx + doorW / 2 + 0.8, y1 + 1.5, za + doorH + 0.45, C.roofDark)
          this.slab(cx, y1 + 0.9, doorW + 1.2, 1.8, za - 0.05, za + 0.15, C.concrete)
        }
      }
      // atap + parapet
      this.box(x0 - 0.3, y0 - 0.3, topZ, x1 + 0.3, y1 + 0.3, topZ + 0.25, roof)
      const ph = 0.6, pt = 0.25
      this.box(x0 - 0.3, y0 - 0.3, topZ + 0.25, x1 + 0.3, y0 - 0.3 + pt, topZ + 0.25 + ph, roof)
      this.box(x0 - 0.3, y1 + 0.3 - pt, topZ + 0.25, x1 + 0.3, y1 + 0.3, topZ + 0.25 + ph, roof)
      this.box(x0 - 0.3, y0 - 0.3, topZ + 0.25, x0 - 0.3 + pt, y1 + 0.3, topZ + 0.25 + ph, roof)
      this.box(x1 + 0.3 - pt, y0 - 0.3, topZ + 0.25, x1 + 0.3, y1 + 0.3, topZ + 0.25 + ph, roof)
      // pita aksen di puncak dinding
      if (band) {
        const bz0 = topZ - 0.7, bz1 = topZ - 0.15
        this.box(x0 - 0.06, y0 - 0.06, bz0, x1 + 0.06, y0 + 0.09, bz1, band)
        this.box(x0 - 0.06, y1 - 0.09, bz0, x1 + 0.06, y1 + 0.06, bz1, band)
        this.box(x0 - 0.06, y0, bz0, x0 + 0.09, y1, bz1, band)
        this.box(x1 - 0.09, y0, bz0, x1 + 0.06, y1, bz1, band)
      }
      // kotak AC di atap
      this.box(x0 + 1.5, y0 + 1.5, topZ + 0.25, x0 + 3.5, y0 + 3.5, topZ + 1.1, C.concreteDark)
      return { topZ }
    },
    // Satu-satunya collider fasilitas: kotak tak terlihat seukuran bangunan
    // utama (cx, cy, w, d; zb = alas lokal, h = tinggi).
    collider(cx, cy, w, d, h, zb = 0) {
      this.colliderBox = { cx, cy, w, d, h, zb }
    },
    finish() {
      if (this.solid.length) {
        const m = new THREE.Mesh(boxesToGeometryZ(this.solid), sh.solidMat)
        m.name = `Fasilitas_${slug}_${f.n}`
        markShared(m)
        group.add(m)
      }
      if (this.glass.length) {
        const m = new THREE.Mesh(boxesToGeometryZ(this.glass), sh.glassMat)
        m.name = `Fasilitas_${slug}_${f.n}_kaca`
        m.renderOrder = 2
        markShared(m)
        group.add(m)
      }
      const c = this.colliderBox
      if (!c) throw new Error(`fasilitas F${f.n} tanpa collider`)
      const cm = new THREE.Mesh(sh.colliderGeo, sh.colliderMat)
      cm.scale.set(c.w, c.d, c.h)
      cm.position.set(c.cx, c.cy, c.zb + c.h / 2)
      cm.name = `FasilitasTabrak_${f.n}`
      cm.visible = false
      cm.userData.clonedMaterial = true
      cm.userData.sharedMaterial = true
      group.add(cm)
      // Jejak kotak (koordinat dunia, x/y saja) buat tes jalan per struktur:
      // bbox gabungan mesh terlalu kasar (satu mesh = seluruh fasilitas).
      group.userData.boxes = [...this.solid, ...this.glass].map((b) => ({
        x0: b.x0 + f.x, y0: b.y0 + f.y, x1: b.x1 + f.x, y1: b.y1 + f.y, z0: b.z0, z1: b.z1,
      }))
      return group
    },
  }
  return fac
}

// Tiang bendera (tiang + bendera kecil) — dipakai beberapa fasilitas sipil.
function flagPole(fac, x, y, h, color) {
  fac.pole(x, y, 0, h, 0.09, fac.sh.matFor(C.concreteDark), 'tiang_bendera')
  fac.part(fac.sh.unitBox, fac.sh.matFor(color), [x + 0.65, y, h - 0.45], [1.3, 0.06, 0.8], [0, 0, 0], 'bendera')
}

// ---------------------------------------------------------------------------
// Lintasan oval sirkuit: pita aspal mengikuti terrain (seperti jalan —
// tinggi = heightAt + 0.06, disampel tiap ~2 derajat). Elips rx 150 / ry 85,
// lebar 12 m, muat dalam rect 350x220 dengan ruang tribun di luarnya.
// ---------------------------------------------------------------------------
function ovalTrackMesh(fac, f, z0, heightAt) {
  // Oval digeser ke barat & mengecil (pusat lokal (-40,0), rx 130 / ry 80)
  // supaya ring highway (di utara rect) tidak memotong lintasan.
  const cx = -40, cy = 0, rx = 128, ry = 80, hw = 6, N = 180
  const pos = new Float32Array(N * 6 * 3)
  const pt = (i, s) => {
    const th = (i / N) * Math.PI * 2
    const c = Math.cos(th), sn = Math.sin(th)
    let nx = c / rx, ny = sn / ry
    const l = Math.hypot(nx, ny) || 1
    nx /= l; ny /= l
    const lx = cx + rx * c + nx * hw * s
    const ly = cy + ry * sn + ny * hw * s
    return [lx, ly, heightAt(f.x + lx, f.y + ly) + 0.06 - z0]
  }
  let k = 0
  for (let i = 0; i < N; i++) {
    const aI = pt(i, -1), aO = pt(i, 1), bI = pt(i + 1, -1), bO = pt(i + 1, 1)
    for (const p of [aI, bO, bI, aI, aO, bO]) {
      pos[k++] = p[0]; pos[k++] = p[1]; pos[k++] = p[2]
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.computeVertexNormals()
  g.computeBoundingSphere()
  const m = new THREE.Mesh(g, fac.sh.matFor(C.asphalt))
  m.name = `Fasilitas_Sirkuit_${f.n}_lintasan`
  markShared(m)
  fac.group.add(m)
  return m
}

// ---------------------------------------------------------------------------
// Builder per fasilitas (koordinat lokal: 0,0 = tengah tapak, z = 0 di z0).
// Referensi bentuk (riset 2026-11-07): RS = menara putih + salib merah +
// helipad atap + garasi ambulans (UGD lantai dasar, bangsal di atas);
// penjara = tembok tinggi + 4 menara jaga sudut + blok sel + lapangan;
// pelabuhan = apron beton + kontainer bertumpuk + crane STS + dermaga ke teluk;
// sirkuit = oval aspal + tribun + pit di infield (lintasan ikut terrain);
// SPBU = kanopi + pompa + toko; pengadilan/bank = kolom + pedimen + tangga.
// ---------------------------------------------------------------------------
function buildOne(f, heightAt, sh) {
  const rectH = sampleHeights(heightAt, f.x, f.y, f.w, f.d)
  // Sirkuit: z0 dari tapak gedung pit (lintasan mengikuti terrain).
  // Pit digeser ke barat (lokal x -40) supaya tidak menabrak oval —
  // spur S13 berhenti di tepi utara tapak, 25 m di utara gedung pit.
  const z0 = String(f.n) === '10'
    ? sampleHeights(heightAt, f.x - 40, f.y - 69, 50, 12).max + 0.05
    : rectH.max + 0.05
  const fac = makeFac(f, z0, heightAt, sh)
  const n = String(f.n)

  if (n === '1') {
    // Job Center: kantor 2 lantai + plaza + kios + tiang bendera.
    fac.plinth(0, -2, 26, 16)
    fac.building({ cx: 0, cy: -2, w: 26, d: 16, floors: 2, floorH: 3.6, wall: 0xe8e6df, band: C.blue, door: 'S' })
    fac.slab(0, 10, 24, 8, -0.05, 0.12, C.concrete)
    fac.building({ cx: -14, cy: 8, w: 8, d: 6, floors: 1, floorH: 3.2, wall: C.wallWhite, door: 'S' })
    flagPole(fac, -11, 9, 8, C.blue)
    fac.collider(0, -2, 26, 16, 7.5)
  } else if (n === '2') {
    // Polisi: kantor 2 lantai pita biru + garasi patroli 2 pintu + mobil patroli.
    fac.plinth(-3, -2, 20, 14)
    fac.building({ cx: -3, cy: -2, w: 20, d: 14, floors: 2, floorH: 3.5, wall: 0xe8e6df, band: C.blue, door: 'S' })
    // Garasi kendaraan di sisi tenggara (jalan sipil C2 lewat 180 m di
    // timur rect — garasi aman dari pita jalan).
    fac.plinth(11, -6, 8, 12)
    fac.building({ cx: 11, cy: -6, w: 8, d: 12, floors: 1, floorH: 4.5, wall: C.concrete, door: null, glass: false })
    fac.box(7.8, -12.06, 0.3, 10.6, -11.91, 3.6, C.dark)
    fac.box(11.4, -12.06, 0.3, 14.2, -11.91, 3.6, C.dark)
    fac.car(-8, 9, 0, 0, C.white)
    fac.part(sh.unitBox, sh.matFor(C.blue), [-8, 9, 1.95], [4.0, 0.1, 0.3], [0, 0, 0], 'mobil_garis')
    fac.part(sh.unitBox, sh.matFor(C.red), [-8.3, 9, 2.0], [0.5, 0.5, 0.22], [0, 0, 0], 'lampu_merah')
    fac.part(sh.unitBox, sh.matFor(C.blue), [-7.7, 9, 2.0], [0.5, 0.5, 0.22], [0, 0, 0], 'lampu_biru')
    flagPole(fac, -13, 8, 8, C.blue)
    fac.collider(-3, -2, 20, 14, 7.2)
  } else if (n === '3') {
    // Rumah Sakit: menara 4 lantai + salib merah + helipad + sayap UGD +
    // garasi ambulans 2 bay + ambulans.
    fac.plinth(-8, -5, 34, 20)
    const top = fac.building({ cx: -8, cy: -5, w: 34, d: 20, floors: 4, floorH: 3.6, wall: C.white, band: C.red, door: 'S' }).topZ
    // salib merah di fasad selatan menara (y = 5)
    fac.box(-9.2, 4.94, 8, -6.8, 5.09, 13, C.red)
    fac.box(-11.5, 4.94, 9.8, -4.5, 5.09, 11.2, C.red)
    // helipad di atap menara + huruf H
    fac.disc(-8, -5, top + 0.33, 7, sh.matFor(C.roofDark), 0.15, 'helipad')
    fac.box(-10.5, -6.5, top + 0.42, -10, -3.5, top + 0.5, C.white)
    fac.box(-6, -6.5, top + 0.42, -5.5, -3.5, top + 0.5, C.white)
    fac.box(-10.5, -5.3, top + 0.42, -5.5, -4.7, top + 0.5, C.white)
    // sayap UGD 2 lantai + garasi ambulans
    fac.plinth(18, 8, 20, 14)
    fac.building({ cx: 18, cy: 8, w: 20, d: 14, floors: 2, floorH: 3.5, wall: C.white, band: C.red, door: 'S' })
    fac.plinth(20, -12, 14, 10)
    fac.building({ cx: 20, cy: -12, w: 14, d: 10, floors: 1, floorH: 4.5, wall: 0xe8e6df, door: null, glass: false })
    fac.box(15, -7.06, 0.3, 18.6, -6.91, 3.8, C.dark)
    fac.box(21.4, -7.06, 0.3, 25, -6.91, 3.8, C.dark)
    fac.car(17, -2, 0, 0, C.white)
    fac.part(sh.unitBox, sh.matFor(C.red), [17, -1.0, 1.0], [4.0, 0.08, 0.3], [0, 0, 0], 'ambulans_garis')
    fac.part(sh.unitBox, sh.matFor(C.red), [16.7, -2, 1.95], [0.5, 0.5, 0.22], [0, 0, 0], 'lampu_merah')
    fac.part(sh.unitBox, sh.matFor(C.blue), [17.3, -2, 1.95], [0.5, 0.5, 0.22], [0, 0, 0], 'lampu_biru')
    fac.collider(-8, -5, 34, 20, top + 0.4)
  } else if (n === '4') {
    // Gym: aula 1 lantai kaca besar + pita merah + papan nama di atap.
    fac.plinth(0, 0, 24, 16)
    fac.building({ cx: 0, cy: 0, w: 24, d: 16, floors: 1, floorH: 6, wall: C.concrete, band: C.red, door: 'S' })
    fac.box(-4, -2, 6.25, 4, 2, 7.4, C.red)
    fac.collider(0, 0, 24, 16, 6.5)
  } else if (n === '5') {
    // Bank Sentral: gedung marmer 2 lantai + 4 kolom + portiko + pedimen
    // bertingkat + tangga 3 anak tangga + pita emas.
    fac.plinth(0, -2, 20, 16)
    fac.building({ cx: 0, cy: -2, w: 20, d: 16, floors: 2, floorH: 4, wall: C.wallWhite, band: C.gold, door: 'S' })
    for (const px of [-7.5, -2.5, 2.5, 7.5]) fac.pole(px, 7.5, 0, 7.5, 0.45, sh.matFor(C.white), 'kolom')
    fac.box(-9.5, 6.2, 7.5, 9.5, 8.8, 7.8, C.concrete)
    fac.box(-8, 6.4, 7.8, 8, 8.6, 8.6, C.wallWhite)
    fac.box(-5.5, 6.6, 8.6, 5.5, 8.4, 9.4, C.wallWhite)
    fac.box(-3, 6.8, 9.4, 3, 8.2, 10.2, C.wallWhite)
    fac.box(-8, 8.6, 0, 8, 9.4, 0.6, C.concrete)
    fac.box(-8, 9.4, 0, 8, 10.2, 0.4, C.concrete)
    fac.box(-8, 10.2, 0, 8, 11, 0.2, C.concrete)
    fac.collider(0, -2, 20, 16, 8.5)
  } else if (n === '6') {
    // Penjara Pulau: tembok keliling 6 m + gerbang utara + 4 menara jaga
    // sudut + blok sel 2 lantai + blok admin + lapangan basket.
    const W = C.wallGray
    fac.box(-38, -28, 0, -3, -27, 6, W)
    fac.box(3, -28, 0, 38, -27, 6, W)
    fac.box(-3, -28, 4, 3, -27, 6, W)
    fac.box(-38, 27, 0, 38, 28, 6, W)
    fac.box(-38, -27, 0, -37, 27, 6, W)
    fac.box(37, -27, 0, 38, 27, 6, W)
    for (const [tx, ty] of [[-36, -26], [36, -26], [-36, 26], [36, 26]]) {
      fac.box(tx - 2, ty - 2, 0, tx + 2, ty + 2, 9, W)
      fac.box(tx - 2.5, ty - 2.5, 9, tx + 2.5, ty + 2.5, 11.5, C.roofDark)
      fac.box(tx - 2.8, ty - 2.8, 11.5, tx + 2.8, ty + 2.8, 11.8, C.roofDark)
    }
    fac.plinth(0, -24, 10, 6)
    fac.building({ cx: 0, cy: -24, w: 10, d: 6, floors: 1, floorH: 5, wall: W, door: 'S' })
    fac.plinth(0, 5, 30, 12)
    fac.building({ cx: 0, cy: 5, w: 30, d: 12, floors: 2, floorH: 3.6, wall: W, door: 'S' })
    fac.plinth(-25, 5, 16, 10)
    fac.building({ cx: -25, cy: 5, w: 16, d: 10, floors: 1, floorH: 4.5, wall: C.concrete, door: 'S' })
    fac.slab(20, 12, 20, 12, 0, 0.15, C.asphalt)
    fac.pole(28, 17, 0, 3.5, 0.12, sh.matFor(C.dark), 'tiang_basket')
    fac.part(sh.unitBox, sh.matFor(C.white), [28, 17.3, 3.2], [1.6, 0.1, 1.1], [0, 0, 0], 'papan_basket')
    fac.collider(0, 0, 76, 56, 9)
  } else if (n === '7') {
    // Kampus: blok kelas 3 lantai (barat, tanah tinggi) + blok 2 lantai +
    // lapangan hijau timur + tiang bendera.
    const bz1 = fac.baseZAt(-20, -5, 26, 14)
    fac.plinth(-20, -5, 26, 14, bz1)
    fac.building({ cx: -20, cy: -5, w: 26, d: 14, floors: 3, floorH: 3.4, wall: 0xe8e6df, band: C.blue, door: 'S', baseZ: bz1 })
    const bz2 = fac.baseZAt(10, -12, 16, 12)
    fac.plinth(10, -12, 16, 12, bz2)
    fac.building({ cx: 10, cy: -12, w: 16, d: 12, floors: 2, floorH: 3.4, wall: 0xe8e6df, band: C.green, door: 'S', baseZ: bz2 })
    const fz = fac.baseZAt(12, 12, 30, 16)
    fac.box(12 - 15, 12 - 8, fz - 1.2, 12 + 15, 12 + 8, fz + 0.2, C.grass)
    fac.box(12 - 15, 12 - 0.15, fz + 0.2, 12 + 15, 12 + 0.15, fz + 0.26, C.white)
    fac.box(12 - 0.15, 12 - 8, fz + 0.2, 12 + 0.15, 12 + 8, fz + 0.26, C.white)
    flagPole(fac, -20, 12, 9, C.red)
    fac.collider(-20, -5, 26, 14, 3 * 3.4 + 0.5, bz1)
  } else if (n === '8') {
    // Rumah Ibadah: aula putih + kubah hijau + 2 menara + pintu gelap.
    fac.plinth(0, 0, 20, 16)
    fac.building({ cx: 0, cy: 0, w: 20, d: 16, floors: 1, floorH: 7, wall: C.white, band: C.green, door: 'S', glass: false })
    fac.box(-6, -8.06, 2, -3, -7.91, 5.5, C.glass, 'glass')
    fac.box(3, -8.06, 2, 6, -7.91, 5.5, C.glass, 'glass')
    fac.box(-6, 7.91, 2, -3, 8.06, 5.5, C.glass, 'glass')
    fac.box(3, 7.91, 2, 6, 8.06, 5.5, C.glass, 'glass')
    fac.box(-10.06, -3, 2, -9.91, 3, 5.5, C.glass, 'glass')
    fac.box(9.91, -3, 2, 10.06, 3, 5.5, C.glass, 'glass')
    fac.dome(0, 0, 7.25, 5, 3.2, sh.matFor(C.green), 'kubah')
    fac.pole(0, 0, 10.4, 11.6, 0.12, sh.matFor(C.gold), 'menara_kubah')
    for (const mx of [-9, 9]) {
      fac.pole(mx, 9, 0, 12, 0.8, sh.matFor(C.white), 'menara')
      fac.disc(mx, 9, 9, 1.4, sh.matFor(C.concrete), 0.3, 'balkon_menara')
      fac.cone(mx, 9, 12, 1.0, 2.2, sh.matFor(C.green), 'puncak_menara')
    }
    fac.box(-7, 8.6, 0, 7, 9.4, 0.4, C.concrete)
    fac.collider(0, 0, 20, 16, 7.5)
  } else if (n === '9') {
    // Pelabuhan: apron beton + gudang + kantor + kontainer bertumpuk +
    // crane STS + dermaga panjang ke teluk (dermaga menjorok ke air).
    // Apron dibelah dua (celah di lokal y=-5) supaya tidak mengubur
    // ujung spur S12 yang masuk dari tepi utara tapak.
    fac.box(-48, -38, -1.8, 58, -5, 0.12, 0xbdbab0)
    fac.box(-10, -5, -1.8, 58, 38, 0.12, 0xbdbab0)
    const bzW = fac.baseZAt(35, -10, 30, 18)
    fac.plinth(35, -10, 30, 18, bzW)
    fac.building({ cx: 35, cy: -10, w: 30, d: 18, floors: 1, floorH: 8, wall: C.brick, door: null, glass: false, baseZ: bzW })
    fac.box(28, -19.06, bzW + 0.3, 32, -18.91, bzW + 5, C.dark)
    fac.box(38, -19.06, bzW + 0.3, 42, -18.91, bzW + 5, C.dark)
    fac.box(22, -6, bzW + 8.25, 28, -4, bzW + 9.05, C.glass, 'glass')
    fac.box(32, -6, bzW + 8.25, 38, -4, bzW + 9.05, C.glass, 'glass')
    const bzO = fac.baseZAt(-45, -15, 12, 8)
    fac.plinth(-45, -15, 12, 8, bzO)
    fac.building({ cx: -45, cy: -15, w: 12, d: 8, floors: 2, floorH: 3.2, wall: 0xe8e6df, door: 'S', baseZ: bzO })
    // kontainer (6.1 x 2.5 x 2.6) — deret di apron, jauh dari akses S12 (-10,-20)
    // dan dari garis ring (y = x + 54).
    const contCols = [C.red, C.blue, C.green, C.gold, C.rust]
    let ci = 0
    const stack = (cx, cy, levels) => {
      for (let l = 0; l < levels; l++) {
        fac.box(cx - 3.05, cy - 1.25, 0.12 + l * 2.6, cx + 3.05, cy + 1.25, 0.12 + (l + 1) * 2.6, contCols[ci++ % contCols.length])
      }
    }
    for (const [sx, sy, lv] of [[-45, -8, 2], [-30, -8, 3], [-15, -8, 2], [0, -8, 1], [15, -8, 2], [-45, -25, 2], [-30, -25, 1], [5, -25, 2], [20, -25, 1], [35, -25, 2], [0, 2, 1], [15, 2, 2], [30, 2, 1], [45, 2, 2], [5, 12, 2], [20, 12, 1], [35, 12, 2], [50, 12, 1], [10, 22, 1], [25, 22, 2], [40, 22, 1]]) stack(sx, sy, lv)
    // dermaga barat (x lokal -55..-25, di barat garis ring): dek beton masif
    // (tanggul dermaga, atas = z0 rata halaman) + garis kuning tepi.
    fac.box(-55, 38, -1.8, -25, 125, 0, C.concrete)
    fac.box(-55, 42, 0, -53, 123, 0.08, C.gold)
    fac.box(-27, 42, 0, -25, 123, 0.08, C.gold)
    stack(-45, 110, 2)
    stack(-35, 110, 1)
    // crane STS di kepala dermaga: 2 kaki + balok atas + boom ke laut + beban gantung
    fac.box(-51, 98, 0, -49, 102, 16, C.gold)
    fac.box(-31, 98, 0, -29, 102, 16, C.gold)
    fac.box(-52, 98, 16, -28, 102, 17.5, C.gold)
    fac.beam(-40, 100, 17, -40, 140, 14, 1.5, sh.matFor(C.gold), 'crane_boom')
    fac.beam(-40, 100, 17, -40, 85, 15, 1.2, sh.matFor(C.gold), 'crane_belakang')
    fac.box(-40.15, 138, 8, -39.85, 140, 14, C.dark)
    fac.box(-43.05, 137.5, 5.4, -36.95, 140, 8, C.red)
    fac.collider(35, -10, 30, 18, 8.5, bzW)
  } else if (n === '10') {
    // Sirkuit: lintasan oval ikut terrain + gedung pit di infield (pintu ke
    // lintasan) + menara kontrol + tribun selatan + garis start + ban.
    ovalTrackMesh(fac, f, z0, heightAt)
    const hS = heightAt(f.x, f.y + 80) + 0.08 - z0
    fac.box(-41, 74, hS, -39, 86, hS + 0.08, C.white)
    fac.building({ cx: -40, cy: -69, w: 50, d: 12, floors: 1, floorH: 6, wall: C.concrete, band: C.red, door: 'N' })
    fac.box(-70, -62, -1.5, -10, -50, 0.1, C.asphalt)
    const bzC = fac.baseZAt(60, -69, 12, 10)
    fac.plinth(60, -69, 12, 10, bzC)
    fac.building({ cx: 60, cy: -69, w: 12, d: 10, floors: 2, floorH: 3.2, wall: 0xe8e6df, door: 'S', baseZ: bzC })
    // tribun selatan: 3 undakan + dinding belakang + atap di tiang
    const bzG = fac.baseZAt(0, 100, 80, 12)
    fac.box(-40, 96, bzG, 40, 100, bzG + 1.2, C.concrete)
    fac.box(-40, 100, bzG, 40, 104, bzG + 2.4, C.concrete)
    fac.box(-40, 104, bzG, 40, 108, bzG + 3.6, C.concrete)
    fac.box(-40, 107.5, bzG, 40, 108, bzG + 4.5, C.roofDark)
    for (const [px, py] of [[-38, 100], [38, 100], [-38, 106], [38, 106]]) {
      fac.pole(px, py, bzG + 4.5, bzG + 8, 0.25, sh.matFor(C.concreteDark), 'tiang_tribun')
    }
    fac.box(-42, 98, bzG + 8, 42, 109, bzG + 8.4, C.roofDark)
    for (const [tx, ty] of [[-140, 70], [140, 70], [-140, -70], [140, -70]]) {
      const tz = heightAt(f.x + tx, f.y + ty) - z0
      fac.box(tx - 1.5, ty - 1.5, tz, tx + 1.5, ty + 1.5, tz + 1.2, C.dark)
    }
    fac.collider(-40, -69, 50, 12, 6.5)
  } else if (n === '11') {
    // Pasar Rakyat: pelataran + 2 deret lapak beratap warna-warni + kios.
    // Akses dari spur S17 yang berhenti 5 m di utara tapak; lapak deret
    // utara paling timur dihapus (menabrak pita jalan lama S10 — jalan itu
    // sudah tidak ada di layout baru, tapi lapak tetap dihapus supaya
    // pelataran depan tetap lega).
    fac.box(-28, -18, -0.8, 26, -2, 0.12, 0xbdbab0)
    fac.box(-28, -2, -0.8, 20, 8, 0.12, 0xbdbab0)
    fac.box(-28, 8, -0.8, 14, 18, 0.12, 0xbdbab0)
    const roofs = [C.red, C.blue, C.green, C.gold]
    let ri = 0
    for (const rx of [-22.5, -13.5, -4.5, 4.5, 13.5, 22.5]) fac.stall(rx, -8, roofs[ri++ % roofs.length])
    for (const rx of [-22.5, -13.5, -4.5, 4.5, 13.5]) fac.stall(rx, 8, roofs[ri++ % roofs.length])
    fac.plinth(-24, -14, 8, 6)
    fac.building({ cx: -24, cy: -14, w: 8, d: 6, floors: 1, floorH: 3.5, wall: C.wallWhite, door: 'S' })
    fac.collider(-24, -14, 8, 6, 4)
  } else if (n === '12') {
    // Mall: balok 3 lantai kaca + pita warna per lantai + papan nama atap +
    // parkir di depan.
    fac.plinth(0, -5, 50, 30)
    fac.building({ cx: 0, cy: -5, w: 50, d: 30, floors: 3, floorH: 4, wall: 0xe8e6df, band: C.gold, door: 'S' })
    fac.box(-20, 9.9, 0.8, 20, 10.14, 11.5, C.glass, 'glass')
    fac.box(-25, -20.09, 3.9, 25, -19.94, 4.3, C.red)
    fac.box(-25, -20.09, 7.9, 25, -19.94, 8.3, C.blue)
    fac.box(-8, -8, 12.25, 8, -2, 13.5, C.purple)
    fac.slab(0, 18, 50, 12, -0.05, 0.12, C.asphalt)
    for (let i = 0; i < 8; i++) fac.box(-22 + i * 6, 15.5, 0.12, -21.7 + i * 6, 20.5, 0.18, C.white)
    fac.collider(0, -5, 50, 30, 12.5)
  } else if (n === '13') {
    // Bioskop: gedung gelap 2 lantai + menara papan nama ungu + marquee +
    // poster + kaca lobi tinggi.
    fac.plinth(0, 0, 28, 20)
    fac.building({ cx: 0, cy: 0, w: 28, d: 20, floors: 2, floorH: 4.5, wall: C.roofDark, band: C.purple, door: 'S', glass: false })
    fac.box(-8, 9.94, 1.2, 8, 10.09, 7.5, C.glass, 'glass')
    fac.box(-12, 8, 0, -8, 11, 12, C.purple)
    fac.box(-11.5, 8.5, 12, -8.5, 10.5, 12.8, C.gold)
    fac.box(-7, 10, 3.2, 7, 13.5, 3.5, C.dark)
    fac.box(-7, 10.09, 4, -4, 10.2, 7, C.red)
    fac.box(-1.5, 10.09, 4, 1.5, 10.2, 7, C.blue)
    fac.box(4, 10.09, 4, 7, 10.2, 7, C.gold)
    fac.collider(0, 0, 28, 20, 9.5)
  } else if (n === '14a' || n === '14b') {
    // Toko Senjata: toko 1 lantai + pita kuning + annex lapangan tembak.
    fac.plinth(0, -2, 16, 12)
    fac.building({ cx: 0, cy: -2, w: 16, d: 12, floors: 1, floorH: 5, wall: 0x5a6b52, band: C.gold, door: 'S' })
    fac.building({ cx: 0, cy: 7, w: 14, d: 5, floors: 1, floorH: 4, wall: C.concreteDark, door: null, glass: false })
    fac.box(-4, -4, 5.25, 4, 0, 6.2, C.dark)
    fac.collider(0, -2, 16, 12, 5.5)
  } else if (n === '15') {
    // Dealer: showroom kaca 1 lantai + lot aspal + 3 mobil pajang + kantor.
    fac.plinth(0, -5, 30, 16)
    fac.building({ cx: 0, cy: -5, w: 30, d: 16, floors: 1, floorH: 6, wall: 0xe8e6df, band: C.blue, door: 'S', glass: false })
    fac.box(-13, 2.94, 1, 13, 3.14, 5.5, C.glass, 'glass')
    fac.slab(0, 10, 34, 12, -0.05, 0.12, C.asphalt)
    fac.car(-10, 10, 0.12, 0, C.red)
    fac.car(0, 10, 0.12, 0, C.blue)
    fac.car(10, 10, 0.12, 0, C.white)
    fac.building({ cx: 18, cy: 8, w: 10, d: 8, floors: 1, floorH: 3.5, wall: C.wallWhite, door: 'S' })
    fac.collider(0, -5, 30, 16, 6.5)
  } else if (n === '16') {
    // Bengkel: aula 3 pintu rolling + mobil di lift + ban + gudang alat.
    fac.plinth(0, -2, 26, 16)
    fac.building({ cx: 0, cy: -2, w: 26, d: 16, floors: 1, floorH: 5.5, wall: C.brick, door: null, glass: false })
    fac.box(-10, 5.94, 0.3, -6.5, 6.09, 4.2, C.dark)
    fac.box(-1.75, 5.94, 0.3, 1.75, 6.09, 4.2, C.dark)
    fac.box(6.5, 5.94, 0.3, 10, 6.09, 4.2, C.dark)
    fac.box(-2, 8, 0.12, 2, 10, 1.0, C.roofDark)
    fac.car(0, 9, 1.0, 0, C.red)
    fac.disc(-12, 9, 0.3, 0.7, sh.matFor(C.dark), 0.3, 'ban')
    fac.disc(-12, 9, 0.6, 0.7, sh.matFor(C.dark), 0.3, 'ban')
    fac.disc(-12, 9, 0.9, 0.7, sh.matFor(C.dark), 0.3, 'ban')
    fac.building({ cx: 15, cy: 8, w: 8, d: 6, floors: 1, floorH: 3.5, wall: C.concreteDark, door: 'S' })
    fac.collider(0, -2, 26, 16, 6)
  } else if (n === '17') {
    // Resort: gedung tropis 2 lantai + kolam + dek pasir barat + 3 gazebo
    // pantai + palem.
    const bz = fac.baseZAt(20, 0, 30, 14)
    fac.plinth(20, 0, 30, 14, bz)
    fac.building({ cx: 20, cy: 0, w: 30, d: 14, floors: 2, floorH: 3.6, wall: C.white, band: C.wood, door: 'S', baseZ: bz })
    fac.box(-15, -29, -1.9, 5, -21, 0.1, C.sand)
    fac.box(-14, -2, 0, 10, 12, 0.15, C.sand)
    fac.box(-12, 0, 0.15, 8, 10, 0.6, C.water)
    for (const [gx, gy] of [[-15, -15], [-15, 0], [-15, 15]]) {
      fac.slab(gx, gy, 5, 5, 0, 0.15, C.wood)
      for (const [px, py] of [[-2.2, -2.2], [2.2, -2.2], [-2.2, 2.2], [2.2, 2.2]]) {
        fac.box(gx + px - 0.08, gy + py - 0.08, 0.15, gx + px + 0.08, gy + py + 0.08, 2.5, C.woodDark)
      }
      fac.box(gx - 2.6, gy - 2.6, 2.5, gx + 2.6, gy + 2.6, 2.65, C.wood)
    }
    for (const [tx, ty] of [[-25, -25], [-5, 25], [0, -28], [10, 28], [45, -15], [25, 30]]) {
      fac.tree(tx, ty, 0, 1.2, 0x5da244)
    }
    fac.collider(20, 0, 30, 14, 7.7, bz)
  } else if (n === '18') {
    // Taman Kota: jalur salib + gazebo beratap kerucut + kolam + bangku +
    // pohon + bedeng bunga + lampu taman. (Tanpa gedung — collider gazebo.)
    fac.box(-40, -2, -0.7, 40, 2, 0.12, C.concrete)
    fac.box(-2, -40, -0.7, 2, 40, 0.12, C.concrete)
    fac.slab(0, 0, 8, 8, 0, 0.3, C.wood)
    for (const [px, py] of [[-3.5, -3.5], [3.5, -3.5], [-3.5, 3.5], [3.5, 3.5]]) {
      fac.box(px - 0.13, py - 0.13, 0.3, px + 0.13, py + 0.13, 3.3, C.woodDark)
    }
    fac.cone(0, 0, 3.3, 5.5, 2.5, sh.matFor(C.roofDark), 'atap_gazebo')
    fac.disc(20, 15, 0.1, 8, sh.matFor(C.water), 0.2, 'kolam')
    for (const [bx, by, br] of [[6, 6, 0], [-6, 6, 0], [6, -6, 0], [-6, -6, 0], [10, -6, 1], [-10, 6, 1]]) {
      if (br === 0) {
        fac.box(bx - 0.9, by - 0.25, 0.12, bx + 0.9, by + 0.25, 0.55, C.wood)
        fac.box(bx - 0.9, by + 0.25, 0.55, bx + 0.9, by + 0.35, 1.15, C.wood)
      } else {
        fac.box(bx - 0.25, by - 0.9, 0.12, bx + 0.25, by + 0.9, 0.55, C.wood)
        fac.box(bx + 0.25, by - 0.9, 0.55, bx + 0.35, by + 0.9, 1.15, C.wood)
      }
    }
    for (const [tx, ty] of [[15, 15], [-15, 15], [15, -15], [-15, -15], [28, 18], [-28, -18], [-25, 25], [25, -25]]) {
      fac.tree(tx, ty, 0, 1, tx > 0 ? 0x4d8f3a : 0x5da244)
    }
    for (const [fx, fy, fc] of [[10, 20, C.red], [-10, 20, C.gold], [10, -20, C.purple], [-10, -20, C.green]]) {
      fac.box(fx - 2, fy - 1, 0.12, fx + 2, fy + 1, 0.35, fc)
    }
    for (const [lx, ly] of [[10, 10], [-10, 10], [10, -10], [-10, -10]]) {
      fac.pole(lx, ly, 0, 4, 0.1, sh.matFor(C.dark), 'lampu_taman')
      fac.part(sh.unitBox, sh.matFor(C.gold), [lx, ly, 4.1], [0.4, 0.4, 0.3], [0, 0, 0], 'lampu')
    }
    fac.collider(0, 0, 8, 8, 4.5)
  } else if (n === '19') {
    // Pabrik: aula bata 10 m + skylight + cerobong + silo + loading dock +
    // gudang kedua.
    const bz = fac.baseZAt(-10, 0, 50, 28)
    fac.plinth(-10, 0, 50, 28, bz)
    fac.building({ cx: -10, cy: 0, w: 50, d: 28, floors: 1, floorH: 10, wall: C.brick, door: null, glass: false, baseZ: bz })
    fac.box(-23, 13.94, bz + 0.3, -17, 14.09, bz + 6.3, C.dark)
    fac.box(-3, 13.94, bz + 0.3, 3, 14.09, bz + 6.3, C.dark)
    fac.box(-28, -6, bz + 10.25, -22, -4, bz + 11, C.glass, 'glass')
    fac.box(-13, -6, bz + 10.25, -7, -4, bz + 11, C.glass, 'glass')
    fac.box(2, -6, bz + 10.25, 8, -4, bz + 11, C.glass, 'glass')
    fac.pole(-32, -18, bz, bz + 18, 1.5, sh.matFor(C.rust), 'cerobong')
    fac.pole(-38, 20, 0, 12, 3, sh.matFor(C.concrete), 'silo')
    fac.cone(-38, 20, 12, 3.2, 2.5, sh.matFor(C.roofDark), 'tutup_silo')
    fac.box(15, 14, 0, 35, 22, 1.0, C.concrete)
    fac.box(14, 13, 5, 36, 23, 5.3, C.roofDark)
    fac.pole(16, 21, 1, 5, 0.2, sh.matFor(C.concreteDark), 'tiang_dock')
    fac.pole(34, 21, 1, 5, 0.2, sh.matFor(C.concreteDark), 'tiang_dock')
    const bzS = fac.baseZAt(32, -18, 20, 14)
    fac.plinth(32, -18, 20, 14, bzS)
    fac.building({ cx: 32, cy: -18, w: 20, d: 14, floors: 1, floorH: 6, wall: C.concreteDark, door: null, glass: false, baseZ: bzS })
    fac.collider(-10, 0, 50, 28, 10.5, bz)
  } else if (n === '20') {
    // Kafe & Bar: gedung kayu 2 lantai + awning merah + teras meja bundar.
    fac.plinth(0, -2, 16, 12)
    fac.building({ cx: 0, cy: -2, w: 16, d: 12, floors: 2, floorH: 3.4, wall: C.wood, band: C.gold, door: 'S' })
    fac.box(-7, 4.2, 3.0, 7, 6.2, 3.2, C.red)
    fac.box(5.9, 5.9, 0, 6.1, 6.1, 3.0, C.woodDark)
    fac.box(-6.1, 5.9, 0, -5.9, 6.1, 3.0, C.woodDark)
    for (const tx of [-6, 0, 6]) {
      fac.pole(tx, 8, 0, 0.75, 0.06, sh.matFor(C.dark), 'meja')
      fac.disc(tx, 8, 0.75, 0.9, sh.matFor(C.wood), 0.08, 'meja')
      fac.box(tx - 0.25, 6.8, 0, tx + 0.25, 7.2, 0.5, C.woodDark)
      fac.box(tx - 0.25, 8.8, 0, tx + 0.25, 9.2, 0.5, C.woodDark)
    }
    fac.collider(0, -2, 16, 12, 7.3)
  } else if (n === '21') {
    // Restoran: gedung bata 1 lantai tinggi + papan nama merah di atap +
    // teras makan + dapur annex.
    fac.plinth(0, -2, 20, 14)
    fac.building({ cx: 0, cy: -2, w: 20, d: 14, floors: 1, floorH: 6.5, wall: C.brick, band: C.red, door: 'S' })
    fac.box(-5, -4, 6.75, 5, 0, 7.6, C.red)
    for (const tx of [-6, 0, 6]) {
      fac.pole(tx, 9, 0, 0.75, 0.06, sh.matFor(C.dark), 'meja')
      fac.disc(tx, 9, 0.75, 0.9, sh.matFor(C.wood), 0.08, 'meja')
    }
    fac.building({ cx: -11, cy: 8, w: 8, d: 6, floors: 1, floorH: 4, wall: C.concreteDark, door: null, glass: false })
    fac.collider(0, -2, 20, 14, 7)
  } else if (n === '22') {
    // Arena: lapangan hijau + garis putih + trek lari + 2 tribun + gawang +
    // lampu sorot. (Lapangan tetap bisa dilalui — collider tribun utara.)
    const fz = fac.baseZAt(0, 0, 50, 28)
    fac.box(-25, -14, fz - 1.0, 25, 14, fz + 0.2, C.grass)
    fac.box(-25, -14, fz + 0.2, 25, -13.7, fz + 0.26, C.white)
    fac.box(-25, 13.7, fz + 0.2, 25, 14, fz + 0.26, C.white)
    fac.box(-25, -14, fz + 0.2, -24.7, 14, fz + 0.26, C.white)
    fac.box(24.7, -14, fz + 0.2, 25, 14, fz + 0.26, C.white)
    fac.box(-0.15, -14, fz + 0.2, 0.15, 14, fz + 0.26, C.white)
    fac.box(-32, -20, fz - 0.8, 32, -14, fz + 0.15, C.brick)
    fac.box(-32, 14, fz - 0.8, 32, 20, fz + 0.15, C.brick)
    fac.box(-32, -14, fz - 0.8, -25, 14, fz + 0.15, C.brick)
    fac.box(25, -14, fz - 0.8, 32, 14, fz + 0.15, C.brick)
    fac.box(-20, -23, fz, 20, -20, fz + 1.2, C.concrete)
    fac.box(-20, -26, fz, 20, -23, fz + 2.4, C.concrete)
    fac.box(-20, -29, fz, 20, -26, fz + 3.6, C.concrete)
    fac.box(-20, 20, fz, 20, 23, fz + 1.2, C.concrete)
    fac.box(-20, 23, fz, 20, 26, fz + 2.4, C.concrete)
    fac.box(-20, 26, fz, 20, 29, fz + 3.6, C.concrete)
    fac.pole(-18, -27, fz + 3.6, fz + 7, 0.2, sh.matFor(C.concreteDark), 'tiang_tribun')
    fac.pole(18, -27, fz + 3.6, fz + 7, 0.2, sh.matFor(C.concreteDark), 'tiang_tribun')
    fac.box(-22, -29, fz + 7, 22, -20, fz + 7.4, C.roofDark)
    for (const gx of [-24, 24]) {
      fac.pole(gx, -2, fz + 0.2, fz + 2.6, 0.12, sh.matFor(C.white), 'gawang')
      fac.pole(gx, 2, fz + 0.2, fz + 2.6, 0.12, sh.matFor(C.white), 'gawang')
      fac.beam(gx, -2, fz + 2.6, gx, 2, fz + 2.6, 0.15, sh.matFor(C.white), 'mistar_gawang')
    }
    for (const [lx, ly] of [[-30, -18], [30, -18], [-30, 18], [30, 18]]) {
      fac.pole(lx, ly, -0.5, 11.5, 0.15, sh.matFor(C.dark), 'lampu_sorot')
      fac.box(lx - 0.8, ly - 0.4, 11.5, lx + 0.8, ly + 0.4, 12, C.white)
    }
    fac.collider(0, -24.5, 40, 9, 4, fz)
  } else if (n === '23') {
    // Pasar Malam: bianglala besar (pusat) + 2 deret stan makanan + tiang lampu.
    fac.box(-8, -11, 0, 8, 1, 0.5, C.concrete)
    for (const ly of [-7, -3]) {
      fac.beam(-6, ly, 0, 0, ly, 13, 0.8, sh.matFor(C.dark), 'kaki_bianglala')
      fac.beam(6, ly, 0, 0, ly, 13, 0.8, sh.matFor(C.dark), 'kaki_bianglala')
    }
    fac.part(sh.cylZ, sh.matFor(C.dark), [0, -5, 13], [2.4, 2.4, 5], [Math.PI / 2, 0, 0], 'poros_bianglala')
    fac.part(sh.torusZ, sh.matFor(C.red), [0, -5, 13], [12, 12, 12], [0, 0, 0], 'roda_bianglala')
    const cabCols = [C.red, C.blue, C.gold, C.green]
    for (let k = 0; k < 8; k++) {
      const th = (k / 8) * Math.PI * 2
      const rx = 12 * Math.cos(th), rz = 13 + 12 * Math.sin(th)
      fac.beam(0, -5, 13, rx, -5, rz, 0.25, sh.matFor(C.dark), 'jari_bianglala')
      fac.box(rx - 0.9, -5.9, rz - 0.7, rx + 0.9, -4.1, rz + 0.7, cabCols[k % 4])
    }
    const roofs = [C.red, C.blue, C.green, C.gold]
    let ri = 0
    for (const rx of [-30, -20, -10, 0, 10, 20, 30]) fac.stall(rx, 18, roofs[ri++ % roofs.length])
    for (const rx of [-30, -15, 0, 15, 30]) fac.stall(rx, -24, roofs[ri++ % roofs.length])
    for (const [lx, ly] of [[-35, -25], [35, -25], [-35, 25], [35, 25], [0, 28]]) {
      fac.pole(lx, ly, 0, 5, 0.1, sh.matFor(C.dark), 'lampu_pasar')
      fac.part(sh.unitBox, sh.matFor(C.gold), [lx, ly, 5.1], [0.4, 0.4, 0.3], [0, 0, 0], 'lampu')
    }
    fac.collider(0, -5, 16, 8, 4)
  } else if (n === '24a' || n === '24b') {
    // Kost: blok 3 lantai gaya motel + balkon per lantai + tangki air atap.
    fac.plinth(0, 0, 20, 12)
    fac.building({ cx: 0, cy: 0, w: 20, d: 12, floors: 3, floorH: 3, wall: C.wallWhite, band: C.blue, door: 'S' })
    for (const bz of [3, 6]) {
      fac.box(-9, 6, bz + 0.05, 9, 7.2, bz + 0.25, C.concrete)
      fac.box(-9, 7.1, bz + 0.25, 9, 7.2, bz + 1.25, C.roofDark)
    }
    fac.pole(6, -3, 9.25, 11.45, 1.2, sh.matFor(C.dark), 'tangki_air')
    fac.collider(0, 0, 20, 12, 9.5)
  } else if (n === '25') {
    // Pengadilan: gedung putih 2 lantai + 4 kolom + portiko + pedimen +
    // tangga + pita emas + tiang bendera.
    fac.plinth(0, -2, 22, 16)
    fac.building({ cx: 0, cy: -2, w: 22, d: 16, floors: 2, floorH: 4.5, wall: C.white, band: C.gold, door: 'S' })
    for (const px of [-8, -2.7, 2.7, 8]) fac.pole(px, 7.5, 0, 7.5, 0.45, sh.matFor(C.white), 'kolom')
    fac.box(-10, 6.2, 7.5, 10, 8.8, 7.8, C.concrete)
    fac.box(-8.5, 6.4, 7.8, 8.5, 8.6, 8.6, C.white)
    fac.box(-6, 6.6, 8.6, 6, 8.4, 9.4, C.white)
    fac.box(-3.5, 6.8, 9.4, 3.5, 8.2, 10.2, C.white)
    fac.box(-8.5, 8.6, 0, 8.5, 9.4, 0.6, C.concrete)
    fac.box(-8.5, 9.4, 0, 8.5, 10.2, 0.4, C.concrete)
    fac.box(-8.5, 10.2, 0, 8.5, 11, 0.2, C.concrete)
    flagPole(fac, -12, 9, 8, C.gold)
    fac.collider(0, -2, 22, 16, 9.5)
  } else if (n === '26') {
    // Tambang: lubang terbuka berteras (3 cincin turun ke lantai -3.66,
    // pusat (0,-16)) + pabrik pengolahan + cerobong + konveyor +
    // ekskavator di lantai lubang + truk + timbunan.
    fac.box(-30, -38, -4.66, 30, -30, -1.66, C.rock)
    fac.box(-30, -2, -4.66, 30, 6, -1.66, C.rock)
    fac.box(-30, -30, -4.66, -22, -2, -1.66, C.rock)
    fac.box(22, -30, -4.66, 30, -2, -1.66, C.rock)
    fac.box(-22, -32, -4.66, 22, -24, -2.66, C.rock)
    fac.box(-22, -8, -4.66, 22, 0, -2.66, C.rock)
    fac.box(-22, -24, -4.66, -14, -8, -2.66, C.rock)
    fac.box(14, -24, -4.66, 22, -8, -2.66, C.rock)
    fac.box(-14, -24, -4.66, 14, -8, -3.66, C.rockDark)
    const bz = fac.baseZAt(30, 14, 20, 12)
    fac.plinth(30, 14, 20, 12, bz)
    fac.building({ cx: 30, cy: 14, w: 20, d: 12, floors: 1, floorH: 7, wall: C.concreteDark, door: null, glass: false, baseZ: bz })
    // Cerobong di sisi selatan pabrik (lokal (38,4)) — jauh dari ujung
    // spur S16 di timur-laut tapak.
    const czCh = fac.baseZAt(38, 4, 2, 2)
    fac.pole(38, 4, czCh - 0.3, czCh + 12, 1.0, sh.matFor(C.rust), 'cerobong')
    fac.beam(8, -4, -2, 20, 14, bz + 4, 1.2, sh.matFor(C.dark), 'konveyor')
    fac.box(-10, -18, -5.0, -6, -14, -3.4, C.gold)
    fac.box(-9.5, -17.5, -3.4, -7.5, -14.5, -2.4, C.dark)
    fac.beam(-6, -16, -2.6, 0, -16, -3.2, 0.8, sh.matFor(C.dark), 'lengan_ekskavator')
    fac.box(-1, -17, -3.6, 1, -15, -2.8, C.dark)
    fac.car(15, 18, -1.6, 0, C.gold)
    const cz1 = fac.baseZAt(-35, 20, 8, 8)
    fac.cone(-35, 20, cz1, 8, 4, sh.matFor(C.rock), 'timbunan')
    const cz2 = fac.baseZAt(-38, -25, 7, 7)
    fac.cone(-38, -25, cz2, 7, 3.5, sh.matFor(C.rock), 'timbunan')
    fac.collider(30, 14, 20, 12, 7.5, bz)
  } else if (n === '27') {
    // Scrap Yard: pagar keliling + gerbang + kantor + mesin press + kubus
    // mobil hancur + kontainer karat + tumpukan ban.
    fac.box(-38, -28, 0, -3, -27.5, 2, C.roofDark)
    fac.box(3, -28, 0, 38, -27.5, 2, C.roofDark)
    fac.box(-38, 27.5, 0, 38, 28, 2, C.roofDark)
    fac.box(-38, -27.5, 0, -37.5, 27.5, 2, C.roofDark)
    fac.box(37.5, -27.5, 0, 38, 27.5, 2, C.roofDark)
    fac.plinth(-25, -15, 10, 8)
    fac.building({ cx: -25, cy: -15, w: 10, d: 8, floors: 1, floorH: 4, wall: C.concrete, door: 'S' })
    fac.box(6, -3, 0, 14, 3, 6, C.dark)
    fac.box(5, -4, 6, 15, 4, 6.8, C.roofDark)
    fac.box(-7, 8, 0, -3, 12, 1.4, C.rust)
    fac.box(-6.5, 8.5, 1.4, -3.5, 11.5, 2.8, C.blue)
    fac.box(18, 10, 0, 22, 14, 1.4, C.gold)
    fac.box(19, 11, 1.4, 21, 13, 2.6, C.red)
    fac.box(-10, -24, 0, -6, -20, 1.4, C.green)
    fac.box(-9.5, -23.5, 1.4, -6.5, -20.5, 2.6, C.rust)
    fac.box(18, -18, 0, 30, -15.5, 2.6, C.rust)
    fac.disc(0, 18, 0.3, 0.7, sh.matFor(C.dark), 0.3, 'ban')
    fac.disc(0, 18, 0.6, 0.7, sh.matFor(C.dark), 0.3, 'ban')
    fac.disc(0, 18, 0.9, 0.7, sh.matFor(C.dark), 0.3, 'ban')
    fac.collider(-25, -15, 10, 8, 4.5)
  } else if (n === '28') {
    // SPBU: kanopi + 4 tiang + 2 pulau pompa (4 pompa) + toko + pylon harga.
    // Kanopi digeser ke barat (pusat lokal (-4,0)): spur S11 berakhir di
    // lokal (22,-10) — tiang terdekat kanopi (4,-5) berjarak ~19 m dari
    // ujung jalan.
    fac.box(-19, -14, -0.7, 19, 14, 0.12, C.asphalt)
    for (const [px, py] of [[-12, -5], [-12, 5], [4, -5], [4, 5]]) {
      fac.pole(px, py, 0.12, 5.2, 0.3, sh.matFor(C.white), 'tiang_kanopi')
    }
    fac.box(-17, -7, 5.2, 7, 7, 5.6, C.white)
    fac.box(-17, -7, 5.15, 7, -6.7, 5.6, C.red)
    fac.box(-17, 6.7, 5.15, 7, 7, 5.6, C.red)
    fac.box(-17, -7, 5.15, -16.7, 7, 5.6, C.red)
    fac.box(6.7, -7, 5.15, 7, 7, 5.6, C.red)
    fac.box(-11, -1.2, 0.12, -5, 1.2, 0.35, C.concrete)
    fac.box(-1, -1.2, 0.12, 5, 1.2, 0.35, C.concrete)
    for (const px of [-10, -6.5, 0.5, 3.5]) {
      fac.box(px - 0.4, -0.4, 0.35, px + 0.4, 0.4, 1.7, C.white)
      fac.box(px - 0.4, -0.4, 1.7, px + 0.4, 0.4, 1.85, C.red)
    }
    const bz = fac.baseZAt(13, -8, 12, 8)
    fac.plinth(13, -8, 12, 8, bz)
    fac.building({ cx: 13, cy: -8, w: 12, d: 8, floors: 1, floorH: 4, wall: 0xe8e6df, door: 'W', glass: true, baseZ: bz })
    fac.box(-17, -12, 0, -16, -11, 8, C.dark)
    fac.box(-18.5, -12.5, 8, -14.5, -10.5, 9.8, C.red)
    fac.box(-18.5, -10.55, 8.6, -14.5, -10.45, 9.0, C.gold)
    fac.collider(13, -8, 12, 8, 4.5, bz)
  } else if (n === '29') {
    // Markas Geng: tembok keliling 4 m + gerbang + markas gelap pita merah +
    // garasi + mobil + peti.
    fac.box(-23, -18, 0, 23, -17.2, 4, C.rockDark)
    fac.box(-23, 17.2, 0, -3, 18, 4, C.rockDark)
    fac.box(3, 17.2, 0, 23, 18, 4, C.rockDark)
    fac.box(-23, -17.2, 0, -22.2, 17.2, 4, C.rockDark)
    fac.box(22.2, -17.2, 0, 23, 17.2, 4, C.rockDark)
    fac.plinth(0, -6, 20, 12)
    fac.building({ cx: 0, cy: -6, w: 20, d: 12, floors: 2, floorH: 3.5, wall: C.roofDark, band: C.red, door: 'S' })
    fac.building({ cx: 16, cy: 8, w: 12, d: 8, floors: 1, floorH: 4.5, wall: C.rockDark, door: null, glass: false })
    fac.box(9.91, 6, 0.3, 10.06, 10, 3.8, C.dark)
    fac.car(-12, 8, 0, 0.4, C.dark)
    fac.box(-15, -13, 0, -13.5, -11.5, 1.5, C.wood)
    fac.box(-12, -14, 0, -10.5, -12.5, 1.2, C.wood)
    fac.box(-14.8, -12.8, 1.5, -13.7, -11.7, 2.7, C.wood)
    fac.collider(0, -6, 20, 12, 7.5)
  } else if (n === '30') {
    // Dermaga Memancing: gubuk kayu + dermaga kayu ke laut (menjorok ke air)
    // + pagar dermaga + lampu + peti ikan.
    const bz = fac.baseZAt(-5, -8, 8, 6)
    fac.plinth(-5, -8, 8, 6, bz)
    fac.building({ cx: -5, cy: -8, w: 8, d: 6, floors: 1, floorH: 4, wall: C.wood, door: 'S', glass: false, baseZ: bz })
    fac.box(-3, 18, -1.0, 3, 100, -0.15, C.wood)
    fac.box(-5, 94, -1.0, 5, 102, -0.15, C.wood)
    for (const [px, py] of [[-2.5, 30], [2.5, 30], [-2.5, 50], [2.5, 50], [-2.5, 70], [2.5, 70], [-2.5, 90], [2.5, 90]]) {
      fac.pole(px, py, -2.6, -1.0, 0.25, sh.matFor(C.woodDark), 'pancang')
    }
    for (let y = 25; y <= 95; y += 10) {
      fac.box(2.65, y - 0.08, -0.15, 2.95, y + 0.08, 0.85, C.wood)
      fac.box(-2.95, y - 0.08, -0.15, -2.65, y + 0.08, 0.85, C.wood)
    }
    fac.beam(-2.8, 20, 0.8, -2.8, 98, 0.8, 0.12, sh.matFor(C.wood), 'rel_dermaga')
    fac.beam(2.8, 20, 0.8, 2.8, 98, 0.8, 0.12, sh.matFor(C.wood), 'rel_dermaga')
    fac.pole(-2.5, 60, -0.15, 3.5, 0.1, sh.matFor(C.dark), 'lampu_dermaga')
    fac.part(sh.unitBox, sh.matFor(C.gold), [-2.5, 60, 3.6], [0.4, 0.4, 0.3], [0, 0, 0], 'lampu')
    fac.box(2, -12, 0, 3.5, -10.5, 1.2, C.wood)
    fac.box(4, -10, 0, 5.5, -8.5, 1.0, C.wood)
    fac.collider(-5, -8, 8, 6, 4.5, bz)
  }
  return fac.finish()
}

// ---------------------------------------------------------------------------
// Perakitan three.js fasilitas — Tahap 2A (eksterior saja).
// ---------------------------------------------------------------------------
export function buildCityFacilities() {
  const data = buildCityData()
  const sh = sharedAssets()
  const group = new THREE.Group()
  group.name = 'CityFacilities'
  for (const f of FACILITIES) {
    group.add(buildOne(f, data.heightAt, sh))
  }
  return group
}
