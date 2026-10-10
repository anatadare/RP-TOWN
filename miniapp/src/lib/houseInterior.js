// Interior rumah (dalam ruangan) buat mode Jelajahi.
//
// File ini SENGAJA murni JavaScript (nggak import three.js) -- sama seperti
// walkWorld.js -- supaya logika tabrakannya bisa dites di Node. Yang nggambar
// ke layar ada di components/HouseInterior.jsx.
//
// Semua rumah di peta yang bisa dimasuki pakai denah YANG SAMA ("Desain Rumah
// RP Town": modern minimalis, 1 lantai, 3 kamar tidur). Denah 10 x 10 m, tanpa
// teras depan/belakang & tanpa furnitur (ruangan kosong dulu):
//
//        x=0     3   5   7        10
//   z=0  +-------+---+---+---------+
//        |Kamar 2|KM2|KM1| Kamar 3 |
//   z=2  |       +[ ]+[ ]+         |   <- pintu kamar mandi
//        |      [ ] lorong [ ]     |   <- pintu kamar 2 & 3
//   z=3  +-------+               +-+
//        | Dapur  : Ruang Makan | Cuci |
//        |        :              [ ]   <- pintu ruang cuci
//   z=6  +--------+---------+----+------+
//        | Kamar  [ ]  Ruang Tamu      |
//        | Utama  |                    |
//  z=10  +--------+------[PINTU]-------+
//        x=0      4      7
//
// Dapur terbuka ke ruang makan (bukaan lebar, tanpa daun pintu), ruang makan
// menyatu dengan ruang tamu. Pintu kamar tidur, kamar mandi, dan ruang cuci
// adalah daun pintu beneran (bisa dibuka/ditutup).
//
// Interior ini dunia TERPISAH dari peta luar (karakter "teleport" masuk),
// jadi ukurannya gak tergantung ukuran bangunan di peta. 1 satuan = 1 meter.

export const HOUSE = {
  width: 10, // sumbu X
  depth: 10, // sumbu Z
  wallH: 2.8,
  wallT: 0.2,
  doorH: 2.1, // tinggi bukaan pintu (di atasnya ada "kusen")

  // Ruangan (persegi). `name` dipakai badge nama ruangan di layar.
  rooms: [
    { id: 'kamar-2', name: 'Kamar Tidur 2', emoji: '🛏️', x1: 0, z1: 0, x2: 3, z2: 3, color: '#c7a67f' },
    { id: 'km-2', name: 'Kamar Mandi 2', emoji: '🚿', x1: 3, z1: 0, x2: 5, z2: 2, color: '#9aa3a9' },
    { id: 'km-1', name: 'Kamar Mandi 1', emoji: '🚿', x1: 5, z1: 0, x2: 7, z2: 2, color: '#9aa3a9' },
    { id: 'kamar-3', name: 'Kamar Tidur 3', emoji: '🛏️', x1: 7, z1: 0, x2: 10, z2: 3, color: '#c7a67f' },
    { id: 'dapur', name: 'Dapur', emoji: '🍳', x1: 0, z1: 3, x2: 3, z2: 6, color: '#d9d3c8' },
    // ruang makan = lorong depan kamar mandi (z 2..3) + area makan (z 3..6)
    { id: 'ruang-makan', name: 'Ruang Makan', emoji: '🍽️', x1: 3, z1: 2, x2: 7, z2: 6, color: '#e3dccf' },
    { id: 'cuci', name: 'Ruang Cuci/Jemur', emoji: '🧺', x1: 7, z1: 3, x2: 10, z2: 6, color: '#cfd3d6' },
    { id: 'kamar-utama', name: 'Kamar Tidur Utama', emoji: '🛏️', x1: 0, z1: 6, x2: 4, z2: 10, color: '#b98f64' },
    { id: 'ruang-tamu', name: 'Ruang Tamu', emoji: '🛋️', x1: 4, z1: 6, x2: 10, z2: 10, color: '#e8e2d6' },
  ],

  // Dinding lurus. axis 'x' = membentang sepanjang X di z=`at`; axis 'z' =
  // membentang sepanjang Z di x=`at`. Bukaan (pintu/bukaan/pintu depan) yang
  // letaknya di garis dinding ini otomatis jadi celah.
  runs: [
    // dinding luar
    { axis: 'x', at: 0, from: 0, to: 10 },
    { axis: 'x', at: 10, from: 0, to: 10 },
    { axis: 'z', at: 0, from: 0, to: 10 },
    { axis: 'z', at: 10, from: 0, to: 10 },
    // dinding dalam
    { axis: 'z', at: 3, from: 0, to: 6 }, // kamar 2 | km 2 | dapur | ruang makan
    { axis: 'z', at: 5, from: 0, to: 2 }, // km 2 | km 1
    { axis: 'z', at: 7, from: 0, to: 6 }, // km 1 / kamar 3 | ruang makan / cuci
    { axis: 'x', at: 2, from: 3, to: 7 }, // muka kamar mandi
    { axis: 'x', at: 3, from: 0, to: 3 }, // kamar 2 | dapur
    { axis: 'x', at: 3, from: 7, to: 10 }, // kamar 3 | cuci
    { axis: 'x', at: 6, from: 0, to: 4 }, // dapur | kamar utama
    { axis: 'x', at: 6, from: 7, to: 10 }, // cuci | ruang tamu
    { axis: 'z', at: 4, from: 6, to: 10 }, // kamar utama | ruang tamu
  ],

  // Pintu beneran. `at` = garis dinding, `pos` = titik tengah celah di sepanjang
  // dinding, `w` = lebar. `hinge` = engsel di ujung 'start' (nilai kecil) atau
  // 'end'; `swing` = arah daun mengayun saat dibuka (-1/+1 pada sumbu tegak
  // lurus dinding) -- selalu mengayun MASUK ke ruangan yang dituju.
  doors: [
    { id: 'kamar-2', name: 'Pintu Kamar Tidur 2', axis: 'z', at: 3, pos: 2.5, w: 1.0, hinge: 'end', swing: -1 },
    { id: 'kamar-3', name: 'Pintu Kamar Tidur 3', axis: 'z', at: 7, pos: 2.5, w: 1.0, hinge: 'end', swing: 1 },
    { id: 'km-2', name: 'Pintu Kamar Mandi 2', axis: 'x', at: 2, pos: 4, w: 1.0, hinge: 'start', swing: -1 },
    { id: 'km-1', name: 'Pintu Kamar Mandi 1', axis: 'x', at: 2, pos: 6, w: 1.0, hinge: 'end', swing: -1 },
    { id: 'cuci', name: 'Pintu Ruang Cuci', axis: 'z', at: 7, pos: 4.5, w: 1.0, hinge: 'end', swing: 1 },
    { id: 'kamar-utama', name: 'Pintu Kamar Tidur Utama', axis: 'z', at: 4, pos: 7.3, w: 1.0, hinge: 'end', swing: -1 },
  ],
  // jarak (m) dari tengah pintu di mana pop up "Buka pintu" muncul
  doorRange: 1.5,

  // Bukaan tanpa daun pintu (dapur terbuka ke ruang makan)
  openings: [{ axis: 'z', at: 3, pos: 4.5, w: 1.8 }],

  // Pintu depan: tertutup, keluar lewat pop up "Keluar rumah".
  frontDoor: { x: 7, z: 10, w: 1.6 },
  // jarak (m) dari pintu depan di mana pop up "Keluar rumah" muncul
  exitRange: 2.0,
  spawn: { x: 7, z: 7.5 },
}

// Potong ruas lurus [a, b] menjadi potongan-potongan solid, menyisakan bukaan
// (gap) di tempat pintu. gaps = [[g1, g2], ...] (akan diurutkan).
function splitWithGaps(a, b, gaps) {
  const pieces = []
  let cur = a
  for (const [g1, g2] of [...gaps].sort((p, q) => p[0] - q[0])) {
    if (g1 > cur + 1e-6) pieces.push([cur, g1])
    cur = Math.max(cur, g2)
  }
  if (b > cur + 1e-6) pieces.push([cur, b])
  return pieces
}

// Semua celah di dinding: pintu kamar + bukaan + pintu depan, dengan
// koordinat garis dinding (axis/at) dan rentang di sepanjang dinding.
function allGaps() {
  const f = HOUSE.frontDoor
  return [
    ...HOUSE.doors.map((d) => ({ axis: d.axis, at: d.at, pos: d.pos, w: d.w })),
    ...HOUSE.openings,
    { axis: 'x', at: f.z, pos: f.x, w: f.w },
  ]
}

// Bangun daftar dinding + celah dari konstanta HOUSE di atas.
//   walls   : ruas dinding solid  { x1, z1, x2, z2 }  (sejajar sumbu)
//   doorways: celah yang dikasih kusen { cx, cz, w, axis }
//             axis 'x' = celah di dinding yang membentang sepanjang X
export function buildHouseLayout() {
  const gaps = allGaps()
  const walls = []
  const doorways = []
  for (const run of HOUSE.runs) {
    const mine = gaps.filter((g) => g.axis === run.axis && g.at === run.at && g.pos >= run.from && g.pos <= run.to)
    const ranges = mine.map((g) => [g.pos - g.w / 2, g.pos + g.w / 2])
    for (const [a, b] of splitWithGaps(run.from, run.to, ranges)) {
      walls.push(
        run.axis === 'x' ? { x1: a, z1: run.at, x2: b, z2: run.at } : { x1: run.at, z1: a, x2: run.at, z2: b }
      )
    }
    for (const g of mine) {
      doorways.push(
        run.axis === 'x'
          ? { cx: g.pos, cz: g.at, w: g.w, axis: 'x' }
          : { cx: g.at, cz: g.pos, w: g.w, axis: 'z' }
      )
    }
  }
  return { walls, doorways }
}

export function roomAt(x, z) {
  for (const r of HOUSE.rooms) {
    if (x >= r.x1 && x <= r.x2 && z >= r.z1 && z <= r.z2) return r
  }
  return null
}

// Titik tengah celah pintu (koordinat dunia interior).
export function doorCenter(d) {
  return d.axis === 'x' ? { x: d.pos, z: d.at } : { x: d.at, z: d.pos }
}

function wrapAngle(a) {
  let r = a
  while (r > Math.PI) r -= Math.PI * 2
  while (r <= -Math.PI) r += Math.PI * 2
  return r
}

// Letak engsel & sudut ayun daun pintu (rotasi sumbu Y, model daun dibangun
// membentang ke +X lokal dari engsel; rotation.y = r  =>  arah (cos r, -sin r)
// di bidang XZ). `closedRot` = menutup celah, `openRot` = terbuka ke arah swing.
//   seg = ruas dinding yang dibentuk daun pintu saat TERTUTUP (buat tabrakan).
export function doorPlacement(d) {
  const start = d.pos - d.w / 2
  const end = d.pos + d.w / 2
  const hingeAt = d.hinge === 'start' ? start : end
  const dir = d.hinge === 'start' ? 1 : -1 // arah daun dari engsel (menutup celah)
  let hx, hz, cdx, cdz, odx, odz, seg
  if (d.axis === 'x') {
    hx = hingeAt
    hz = d.at
    cdx = dir
    cdz = 0
    odx = 0
    odz = d.swing
    seg = { x1: start, z1: d.at, x2: end, z2: d.at }
  } else {
    hx = d.at
    hz = hingeAt
    cdx = 0
    cdz = dir
    odx = d.swing
    odz = 0
    seg = { x1: d.at, z1: start, x2: d.at, z2: end }
  }
  const closedRot = Math.atan2(-cdz, cdx)
  const openRot = closedRot + wrapAngle(Math.atan2(-odz, odx) - closedRot)
  return { hx, hz, closedRot, openRot, seg }
}

// Pintu terdekat yang masih dalam jangkauan interaksi (atau null).
// Kalau `yaw` (arah hadap karakter, sama seperti p.yaw di walkController.js:
// menghadap (sin yaw, cos yaw)) diberikan, pintu yang SEDANG DIHADAPI diutamakan.
// Ini penting di lorong depan kamar mandi, di mana pintu kamar & pintu kamar
// mandi cuma berjarak ~1 m: tanpa arah hadap, pop up bisa salah pintu.
export function nearestDoor(x, z, yaw) {
  let best = null
  let bestScore = Infinity
  const fx = yaw === undefined ? 0 : Math.sin(yaw)
  const fz = yaw === undefined ? 0 : Math.cos(yaw)
  for (const d of HOUSE.doors) {
    const c = doorCenter(d)
    const dx = c.x - x, dz = c.z - z
    const dist = Math.hypot(dx, dz)
    if (dist >= HOUSE.doorRange) continue
    const facing = dist > 0.05 ? (fx * dx + fz * dz) / dist : 0 // 1 = tepat menghadap pintu
    const score = dist - 0.5 * facing
    if (score < bestScore) {
      bestScore = score
      best = d
    }
  }
  return best
}

// Karakter lagi berdiri di ambang pintu (jangan ditutup, nanti kejepit).
export function inDoorway(d, x, z) {
  const c = doorCenter(d)
  const along = d.axis === 'x' ? Math.abs(x - c.x) : Math.abs(z - c.z)
  const across = d.axis === 'x' ? Math.abs(z - c.z) : Math.abs(x - c.x)
  return across < 0.6 && along < d.w / 2 + 0.2
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
  walls.push({ x1: fd.x - fd.w / 2, z1: fd.z, x2: fd.x + fd.w / 2, z2: fd.z })

  // Daun pintu: jadi dinding (buat karakter & kamera) selama TERTUTUP. Daftar
  // dinding aktif di-cache & dibangun ulang cuma kalau ada pintu yang berubah
  // status (isDoorOpen dibaca dari state TownWalk lewat ref).
  const doorLeaves = HOUSE.doors.map((d) => ({ id: d.id, seg: doorPlacement(d).seg }))
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
