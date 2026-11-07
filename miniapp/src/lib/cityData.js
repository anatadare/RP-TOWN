// Orkestrator murni-JS (tanpa three.js) buat kota pulau — dipakai tes Node
// dan perakitan three.js (cityMap.js). Urutan penting:
//   terrain (dasar) -> roads (sampler tinggi) -> grading -> air -> slot rumah
//   -> mesh terrain + pita jalan.
// `buildCityData()` mengembalikan semua data kota (terrain, air, jalan, rumah).
// Catatan: buildWaterMesh + buildTerrainMesh agak berat (~1-2 dtk); hasilnya
// di-cache per proses (kota deterministik — seed tetap).

import {
  CITY, maskInland, gradedHeightAt, makeIsWater, makeOnLand,
  buildTerrainMesh, buildWaterMesh, waterNodeAt,
  mulberry32, makeNoise,
} from './cityTerrain.js'
import { createRoads, buildRoadTriangles } from './cityRoads.js'
import { computeCityPlacement } from './cityHouses.js'
import { rectOf } from './lpmHouses.js'
import { facilityRects } from './cityFacilities.js'

let CACHE = null

export function buildCityData() {
  if (CACHE) return CACHE
  const roads = createRoads()
  const sampler = roads.sampler
  const heightAt = (x, y) => gradedHeightAt(x, y, sampler)
  const isWater = makeIsWater(sampler)
  const water = buildWaterMesh(isWater)
  const waterNodeAtFn = (x, y) => waterNodeAt(water.nodeGrid, x, y)
  const onLand = makeOnLand(sampler, waterNodeAtFn)
  const blockedRects = facilityRects(2)
  // Koridor sungai di persimpangan C1: tebing sungai curam (carve -1 ke
  // bukit +20 dalam 8 m) — rumah di sana gagal cek drop. Blokir slot rumah
  // & pohon di sekitar penyeberangan (jembatan/culvert tetap jalan).
  blockedRects.push({ n: 'sungai-C1', x0: 220, y0: -210, x1: 320, y1: -100 })
  const placement = computeCityPlacement({ onLand, heightAt, roads, blockedRects })
  const trees = buildTreePositions({ onLand, heightAt, roads, placement, blockedRects })
  const terrain = buildTerrainMesh(heightAt, onLand)
  const roadTris = buildRoadTriangles(roads, heightAt)
  CACHE = {
    roads, heightAt, onLand, isWater, water, terrain, roadTris,
    placement, blockedRects, sampler, trees,
  }
  return CACHE
}

// ---------------------------------------------------------------------------
// Pohon (~700, tersebar berkelompok). Posisi murni-JS; mesh-nya digabung jadi
// 2 mesh (batang + tajuk) di cityMap.js. Tabrakan batang TIDAK dari mesh
// (mesh gabungan >40 vertex bukan batang) — melainkan dari `props` walkWorld
// (lihat getCityWalkCache di TownWalk.jsx): {x, z, r, y0, y1}.
// ---------------------------------------------------------------------------
export const TREE_TARGET = 700

export function buildTreePositions({ onLand, heightAt, roads, placement, blockedRects }) {
  const rng = mulberry32(4242)
  const forest = makeNoise(99)
  const houseRects = placement.infos.map((h) => rectOf(h))
  const trees = []
  let tries = 0
  while (trees.length < TREE_TARGET && tries < 40000) {
    tries++
    const x = CITY.minX + rng() * (CITY.maxX - CITY.minX)
    const y = CITY.minY + rng() * (CITY.maxY - CITY.minY)
    if (!onLand(x, y)) continue
    if (maskInland(x, y) < 30) continue // jangan di pita pantai
    if (roads.sampler.dist(x, y) < 8) continue // jauh dari jalan
    // hutan berkelompok (noise) + sedikit pohon tersebar
    if (forest(x * 0.004, y * 0.004) < -0.1 && rng() > 0.12) continue
    let ok = true
    for (const r of houseRects) {
      if (Math.abs(x - r.cx) < r.w / 2 + 3 && Math.abs(y - r.cy) < r.d / 2 + 3) { ok = false; break }
    }
    if (!ok) continue
    for (const b of blockedRects) {
      if (x > b.x0 - 3 && x < b.x1 + 3 && y > b.y0 - 3 && y < b.y1 + 3) { ok = false; break }
    }
    if (!ok) continue
    const h0 = heightAt(x, y)
    if (Math.abs(heightAt(x + 5, y) - h0) > 2 || Math.abs(heightAt(x, y + 5) - h0) > 2) continue // terlalu miring
    trees.push({ x, y, z: h0, s: 0.85 + rng() * 0.4, rot: rng() * Math.PI * 2, crown: rng() < 0.5 ? 0 : 1 })
  }
  return trees
}

export { CITY, maskInland }
