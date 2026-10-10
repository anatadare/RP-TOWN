// Interior rumah (dalam ruangan) buat mode Jelajahi.
//
// File ini SENGAJA murni JavaScript (nggak import three.js) -- sama seperti
// walkWorld.js -- supaya logika tabrakannya bisa dites di Node. Yang nggambar
// ke layar ada di components/HouseInterior.jsx.
//
// Semua rumah di peta yang bisa dimasuki pakai denah YANG SAMA (kosong dulu):
//
//        x=0        4        8        12
//   z=0  +---------+--------+---------+
//        | Kamar 1 | Kamar 2| Kamar 3 |
//        |         |        |         |
//  z=4.5 +--[ ]----+---[ ]--+---[ ]----+   <- pintu tiap kamar
//        |         |                  |
//        | Dapur   : Ruang Tamu       |
//        |         :                  |
//  z=10  +---------+------[PINTU]-----+   <- pintu depan (keluar rumah)
//                  4.5
//
// Interior ini dunia TERPISAH dari peta luar (karakter "teleport" masuk),
// jadi ukurannya gak tergantung ukuran bangunan di peta. 1 satuan = 1 meter.

export const HOUSE = {
  width: 12, // sumbu X
  depth: 10, // sumbu Z
  wallH: 2.8,
  wallT: 0.2,
  doorH: 2.1, // tinggi bukaan pintu (di atasnya ada "kusen")
  // bukaan pintu kamar (lebar) dan pintu depan
  roomDoorW: 1.2,
  // Pintu kamar yang bisa dibuka/ditutup (engsel di sisi kiri/barat bukaan,
  // daun pintu mengayun masuk ke kamar). cz = posisi dinding pemisah.
  roomDoors: [
    { id: 'kamar-1', name: 'Pintu Kamar 1', cx: 2, cz: 4.5 },
    { id: 'kamar-2', name: 'Pintu Kamar 2', cx: 6, cz: 4.5 },
    { id: 'kamar-3', name: 'Pintu Kamar 3', cx: 10, cz: 4.5 },
  ],
  // jarak (m) dari tengah pintu di mana pop up "Buka pintu" muncul
  doorRange: 1.7,
  frontDoor: { x: 8.5, z: 10, w: 1.6 },
  // jarak (m) dari pintu depan di mana pop up "Keluar rumah" muncul
  exitRange: 2.4,
  spawn: { x: 8.5, z: 6.8 },
  rooms: [
    { id: 'kamar-1', name: 'Kamar 1', emoji: '🛏️', x1: 0, z1: 0, x2: 4, z2: 4.5, color: '#c9d4f2' },
    { id: 'kamar-2', name: 'Kamar 2', emoji: '🛏️', x1: 4, z1: 0, x2: 8, z2: 4.5, color: '#f0cdd2' },
    { id: 'kamar-3', name: 'Kamar 3', emoji: '🛏️', x1: 8, z1: 0, x2: 12, z2: 4.5, color: '#cdeccf' },
    { id: 'dapur', name: 'Dapur', emoji: '🍳', x1: 0, z1: 4.5, x2: 4.5, z2: 10, color: '#dde3e6' },
    { id: 'ruang-tamu', name: 'Ruang Tamu', emoji: '🛋️', x1: 4.5, z1: 4.5, x2: 12, z2: 10, color: '#d2b48c' },
  ],
}

// Potong ruas lurus [a, b] menjadi potongan-potongan solid, menyisakan bukaan
// (gap) di tempat pintu. gaps = [[g1, g2], ...] (urut, gak saling tumpang).
function splitWithGaps(a, b, gaps) {
  const pieces = []
  let cur = a
  for (const [g1, g2] of gaps) {
    if (g1 > cur + 1e-6) pieces.push([cur, g1])
    cur = g2
  }
  if (b > cur + 1e-6) pieces.push([cur, b])
  return pieces
}

const centeredGap = (c, w) => [c - w / 2, c + w / 2]

// Bangun daftar dinding + bukaan pintu dari konstanta HOUSE di atas.
//   walls   : ruas dinding solid  { x1, z1, x2, z2 }  (sejajar sumbu)
//   doorways: bukaan yang dikasih kusen { cx, cz, w, axis }  axis 'x' = bukaan di dinding horizontal
export function buildHouseLayout() {
  const W = HOUSE.width, D = HOUSE.depth
  const walls = []
  const doorways = []

  const addH = (z, x1, x2, gaps = []) => {
    for (const [a, b] of splitWithGaps(x1, x2, gaps)) walls.push({ x1: a, z1: z, x2: b, z2: z })
    for (const [g1, g2] of gaps) doorways.push({ cx: (g1 + g2) / 2, cz: z, w: g2 - g1, axis: 'x' })
  }
  const addV = (x, z1, z2, gaps = []) => {
    for (const [a, b] of splitWithGaps(z1, z2, gaps)) walls.push({ x1: x, z1: a, x2: x, z2: b })
    for (const [g1, g2] of gaps) doorways.push({ cx: x, cz: (g1 + g2) / 2, w: g2 - g1, axis: 'z' })
  }

  // dinding luar
  addH(0, 0, W)
  addH(D, 0, W, [centeredGap(HOUSE.frontDoor.x, HOUSE.frontDoor.w)])
  addV(0, 0, D)
  addV(W, 0, D)

  // pemisah barisan kamar (belakang) dengan dapur/ruang tamu (depan), 3 pintu kamar
  const roomDoors = HOUSE.roomDoors.map((d) => centeredGap(d.cx, HOUSE.roomDoorW))
  addH(4.5, 0, W, roomDoors)

  // sekat antar kamar
  addV(4, 0, 4.5)
  addV(8, 0, 4.5)

  // sekat dapur | ruang tamu dengan bukaan lebar (dapur terbuka)
  addV(4.5, 4.5, D, [[6.3, 8.7]])

  return { walls, doorways }
}

export function roomAt(x, z) {
  for (const r of HOUSE.rooms) {
    if (x >= r.x1 && x <= r.x2 && z >= r.z1 && z <= r.z2) return r
  }
  return null
}

// Pintu kamar terdekat yang masih dalam jangkauan interaksi (atau null).
export function nearestDoor(x, z) {
  let best = null
  let bestD = HOUSE.doorRange
  for (const d of HOUSE.roomDoors) {
    const dist = Math.hypot(x - d.cx, z - d.cz)
    if (dist < bestD) {
      bestD = dist
      best = d
    }
  }
  return best
}

// Karakter lagi berdiri di ambang pintu (jangan ditutup, nanti kejepit).
export function inDoorway(d, x, z) {
  return Math.abs(z - d.cz) < 0.6 && Math.abs(x - d.cx) < HOUSE.roomDoorW / 2 + 0.2
}

export function distToExit(x, z) {
  return Math.hypot(x - HOUSE.frontDoor.x, z - HOUSE.frontDoor.z)
}

// ---------------------------------------------------------------------------
// Dunia tabrakan interior. Bentuknya sama dengan objek `world` dari
// buildWalkWorld() (walkWorld.js) pada bagian yang dipakai walkController.js &
// WalkPlayer / RemotePlayers: bounds, waterLevel, groundY, resolveWalls,
// castWalls2D, findSpawn, ...
// ---------------------------------------------------------------------------
export function buildInteriorWorld({ isDoorOpen = () => false } = {}) {
  const { walls } = buildHouseLayout()
  const W = HOUSE.width, D = HOUSE.depth
  // pintu depan tertutup = penghalang juga (buat karakter & kamera); keluar
  // rumah lewat pop up "Keluar rumah", bukan jalan menembus pintu.
  const fd = HOUSE.frontDoor
  walls.push({ x1: fd.x - fd.w / 2, z1: D, x2: fd.x + fd.w / 2, z2: D })

  // Daun pintu kamar: jadi dinding (buat karakter & kamera) selama TERTUTUP.
  // Daftar dinding aktif di-cache & dibangun ulang cuma kalau ada pintu yang
  // berubah status (isDoorOpen dibaca dari state TownWalk lewat ref).
  const doorLeaves = HOUSE.roomDoors.map((d) => ({
    id: d.id,
    seg: { x1: d.cx - HOUSE.roomDoorW / 2, z1: d.cz, x2: d.cx + HOUSE.roomDoorW / 2, z2: d.cz },
  }))
  let cacheSig = null
  let cacheWalls = walls
  function activeWalls() {
    let sig = ''
    for (const d of doorLeaves) sig += isDoorOpen(d.id) ? '1' : '0'
    if (sig !== cacheSig) {
      cacheSig = sig
      cacheWalls = walls.concat(doorLeaves.filter((d) => !isDoorOpen(d.id)).map((d) => d.seg))
    }
    return cacheWalls
  }

  function groundY(x, z, yMax = Infinity) {
    if (x < 0 || x > W || z < 0 || z > D) return null
    return 0 <= yMax ? 0 : null
  }

  // Dorong lingkaran (x,z,radius) keluar dari ruas dinding. Tinggi dinding
  // diabaikan (semua dinding setinggi ruangan, karakter gak bisa lewat atasnya).
  function resolveWalls(x, z, feetY, radius) {
    let hit = false
    const list = activeWalls()
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
      }
      if (!moved) break
    }
    return { x, z, hit }
  }

  return {
    bounds: { minX: 0, maxX: W, minZ: 0, maxZ: D },
    waterLevel: -100, // cuma dipakai buat deteksi "jatuh ke jurang" (y < waterLevel - 40)
    walls,
    groundY,
    resolveWalls,
    // Kamera third-person di DALAM rumah (ala GTA): tembok narik kamera
    // mendekat ke karakter supaya gak tembus ke ruangan sebelah / luar rumah.
    // Balik t di [0..1] (1 = bebas), sama seperti castWalls2D di walkWorld.js.
    castWalls2D(ox, oz, ex, ez) {
      const dx = ex - ox, dz = ez - oz
      let best = 1
      for (const w of activeWalls()) {
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
    findSpawn: () => ({ x: HOUSE.spawn.x, y: 0, z: HOUSE.spawn.z }),
  }
}
