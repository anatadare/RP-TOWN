// 500 rumah warga kota pulau, memakai desain rumah LPM yang sudah ada
// (lib/lpmHouses.js + lib/houseInteriorLpm.js — eksterior + interior 2 lantai
// yang sama, jangan desain rumah baru).
//
// Penempatan (murni JavaScript, tanpa three.js) memakai ulang slot builder
// LPM: slot di kedua sisi jalan sekunder, menghadap jalan, halaman depan 3 m,
// gap samping min 3 m, tapak + teras di tanah, jauh dari persimpangan & tapak
// fasilitas. Skala penuh 1.0 (petak kota longgar). Nomor rumah 1-500.
//
// Perakitan three.js (buildCityHouses) memakai buildHouseGroup dari
// lpmHouses.js dengan collider bernama TPX_Buildings_N (supaya TownMap3D &
// TownWalk menemukannya sebagai bangunan bernomor yang bisa dimasuki).

import * as THREE from 'three'
import {
  buildSlots, selectSlots, doorFixPass, relocateHouses,
  rectOf, doorOk, footprintOnLand, edgeGap,
  sharedHouseAssets, buildHouseGroup,
} from './lpmHouses.js'

export const CITY_HOUSE_COUNT = 500
const FLOOR_LIFT = 0.05
const GROUND_GRID = 11

// Opsi slot kota (lihat buildSlots di lpmHouses.js).
export function citySlotOpts(roads, blockedRects) {
  return {
    roadHalf: 2.25, // sekunder 4.5 m (ring 8 m diatasi per-seg via seg.half)
    yard: 3,
    sideGapMin: 3,
    junctions: roads.junctions,
    blockedRects,
    onlySegs: roads.segs.filter((s) => s.id !== 'RING').map((s) => s.id),
  }
}

// Hitung penempatan 500 rumah. `heightAt(x, y)` = tinggi tanah FINAL (grading).
// Mengembalikan { infos, complete, available } — infos = [{num, cx, cy, fx, fy,
// k, z, drop, roadId, side, ...}]. Kalau slot yang tersedia < 500, complete
// false (pemanggil yang melaporkan, JANGAN diam-diam mengurangi jumlah).
export function computeCityPlacement({ onLand, heightAt, roads, blockedRects, total = CITY_HOUSE_COUNT }) {
  const opts = citySlotOpts(roads, blockedRects)
  const { bySide } = buildSlots(1.0, onLand, roads.segs, opts)
  const available = bySide.flat().length
  const picked = selectSlots(bySide, total)
  if (!picked) return { infos: bySide.flat(), complete: false, available }
  const infos = picked.map((h, i) => ({ ...h, num: i + 1, x0: h.cx, y0: h.cy }))
  doorFixPass(infos, onLand)
  relocateHouses(infos, onLand, roads.segs, opts)
  doorFixPass(infos, onLand)

  // Lantai = tanah tertinggi di bawah tapak (+0.05); drop = selisih ke tanah
  // terendah (ditutup pondasi). Sama seperti addLpmHouses.
  for (const h of infos) {
    const r = rectOf(h)
    let top = -Infinity, bottom = Infinity
    for (let i = 0; i < GROUND_GRID; i++) {
      for (let j = 0; j < GROUND_GRID; j++) {
        const gx = r.cx + (i / (GROUND_GRID - 1) - 0.5) * r.w
        const gy = r.cy + (j / (GROUND_GRID - 1) - 0.5) * r.d
        const g = heightAt(gx, gy)
        if (g === null || g === undefined) continue
        if (g > top) top = g
        if (g < bottom) bottom = g
      }
    }
    if (Number.isFinite(top)) {
      h.z = top + FLOOR_LIFT
      h.drop = h.z - bottom
    } else {
      h.z = 0
      h.drop = 0
    }
  }
  return { infos, complete: true, available }
}

// Perakitan three.js: grup berisi 500 rumah (shared geometry/material).
export function buildCityHouses(infos) {
  const sh = sharedHouseAssets()
  const group = new THREE.Group()
  group.name = 'CityHouses'
  for (const h of infos) {
    const { house, base } = buildHouseGroup(sh, h.num, h, {
      colliderName: `TPX_Buildings_${h.num}`,
      shared: true,
      shell: true, // badan + carport + pagar digabung 1 mesh (hemat draw call)
    })
    group.add(house)
    if (base) group.add(base)
  }
  return group
}

// Statistik per cluster (per jalan) buat laporan.
export function placementStats(infos) {
  const byRoad = {}
  for (const h of infos) {
    byRoad[h.roadId] = (byRoad[h.roadId] || 0) + 1
  }
  let minGap = Infinity, gapSum = 0, gapN = 0
  for (let i = 0; i < infos.length; i++) {
    let best = Infinity
    for (let j = 0; j < infos.length; j++) {
      if (i === j) continue
      const g = edgeGap(rectOf(infos[i]), rectOf(infos[j]))
      if (g < best) best = g
    }
    if (best < minGap) minGap = best
    gapSum += best; gapN++
  }
  let maxDrop = 0
  for (const h of infos) if (h.drop > maxDrop) maxDrop = h.drop
  return { byRoad, minGap, meanGap: gapSum / gapN, maxDrop }
}

export { rectOf, doorOk, footprintOnLand, edgeGap }
