// Deteksi "lagi dekat rumah mana" buat pop up "Masuki rumah" di mode Jelajahi.
//
// Murni JavaScript (tanpa three.js) supaya bisa dites di Node. TownWalk.jsx
// yang nyuapin segitiga tiap bangunan (koordinat dunia) hasil baca scene .glb.

import { extractWalls } from './walkWorld'

// Jarak maksimum (meter) dari dinding luar rumah sampai pop up muncul.
export const ENTER_RANGE = 2.6

// Bentuk 1 bangunan yang bisa dikunjungi:
//   { key, number, walls, minX, maxX, minZ, maxZ, baseY }
// `tris` = array datar [x,y,z, x,y,z, x,y,z, ...] seluruh segitiga bangunan itu.
export function makeVisitBuilding(key, number, tris) {
  const walls = extractWalls(tris)
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, baseY = Infinity
  for (let i = 0; i < tris.length; i += 3) {
    const x = tris[i], y = tris[i + 1], z = tris[i + 2]
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
    if (y < baseY) baseY = y
  }
  return { key, number, walls, minX, maxX, minZ, maxZ, baseY }
}

// Jarak terdekat dari titik (x,z) ke dinding sebuah bangunan.
function distToWalls(b, x, z) {
  const w = b.walls
  let best = Infinity
  for (let s = 0; s < w.count; s++) {
    const ax = w.x1[s], az = w.z1[s]
    const ex = w.x2[s] - ax, ez = w.z2[s] - az
    const len2 = ex * ex + ez * ez
    let t = len2 > 0 ? ((x - ax) * ex + (z - az) * ez) / len2 : 0
    t = t < 0 ? 0 : t > 1 ? 1 : t
    const d = Math.hypot(x - (ax + ex * t), z - (az + ez * t))
    if (d < best) best = d
  }
  return best
}

// Bangunan terdekat yang masih dalam jangkauan, atau null. `y` dipakai buat
// ngebuang bangunan yang jauh beda ketinggian (mis. lagi di dermaga bawah).
export function nearestVisitBuilding(buildings, x, y, z, range = ENTER_RANGE) {
  let best = null
  let bestD = range
  for (const b of buildings) {
    if (x < b.minX - range || x > b.maxX + range || z < b.minZ - range || z > b.maxZ + range) continue
    if (Math.abs(y - b.baseY) > 4) continue
    const d = distToWalls(b, x, z)
    if (d < bestD) {
      bestD = d
      best = b
    }
  }
  return best
}
