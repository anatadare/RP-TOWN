// Perakitan three.js kota pulau: SATU grup template (memoized) berisi terrain,
// air, jalan, 500 rumah, pohon, fasilitas. Dipakai TownMap3D (Peta) & TownWalk
// (Jelajahi) sebagai pengganti scene .glb LPM.
//
// Frame lokal grup ini = frame lokal GLB (x timur, y selatan, z ke atas),
// jadi rotasi AXIS_FIX & ekstraktor yang sudah ada bekerja tanpa perubahan.
// `getCityTemplate()` = template (jangan dimutasi — pemakai harus clone).
// `getCityScene()` = salinan segar buat satu pemakai (TownMap3D).
// TownWalk memakai template langsung sebagai kunci cache (prepareWalkScene
// meng-clone di dalam, jadi template tidak tersentuh).

import * as THREE from 'three'
import { buildCityData } from './cityData.js'
import { buildCityHouses } from './cityHouses.js'
import { buildCityFacilities } from './cityFacilities.js'

let TEMPLATE = null

function meshFromTris(tris, { color = 0xffffff, roughness = 0.95, metalness = 0, transparent = false, opacity = 1, vertexColors = false, flatShading = false, side = THREE.FrontSide } = {}) {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tris), 3))
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  const mat = new THREE.MeshStandardMaterial({ color, roughness, metalness, transparent, opacity, vertexColors, flatShading, side })
  return new THREE.Mesh(geo, mat)
}

// Gabung beberapa BufferGeometry (ber-indeks ATAU tidak) jadi satu.
// Dipakai pohon (ratusan pohon -> 2-3 mesh).
function mergeGeometries(geos) {
  let vCount = 0, iCount = 0
  for (const g of geos) {
    const pCount = g.getAttribute('position').count
    vCount += pCount
    iCount += g.index ? g.index.count : pCount
  }
  const pos = new Float32Array(vCount * 3)
  const nor = new Float32Array(vCount * 3)
  const idx = new Uint32Array(iCount)
  let vo = 0, io = 0
  for (const g of geos) {
    const p = g.getAttribute('position'), n = g.getAttribute('normal')
    pos.set(p.array, vo * 3)
    nor.set(n.array, vo * 3)
    if (g.index) {
      const gi = g.index.array
      for (let k = 0; k < gi.length; k++) idx[io + k] = gi[k] + vo
      io += gi.length
    } else {
      for (let k = 0; k < p.count; k++) idx[io + k] = vo + k
      io += p.count
    }
    vo += p.count
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  out.setIndex(new THREE.BufferAttribute(idx, 1))
  out.computeBoundingSphere()
  return out
}

function buildCityTrees(trees) {
  // Geometri dasar (frame lokal, Z ke atas): batang silinder 8 segmen
  // (38 vertex — di bawah batas batang 40 kalau dibaca sebagai pohon GLB),
  // tajuk icosahedron (42 vertex).
  const trunkBase = new THREE.CylinderGeometry(0.22, 0.34, 8, 8)
  trunkBase.rotateX(Math.PI / 2) // sumbu Y -> Z
  trunkBase.translate(0, 0, 4) // dasar di z=0, puncak 8 m
  const crownBase = new THREE.IcosahedronGeometry(2.5, 1)
  crownBase.translate(0, 0, 10.5) // bawah tajuk di ~8 m
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  const trunks = []
  const crowns0 = []
  const crowns1 = []
  for (const t of trees) {
    e.set(0, 0, t.rot)
    q.setFromEuler(e)
    m.compose(new THREE.Vector3(t.x, t.y, t.z), q, new THREE.Vector3(t.s, t.s, t.s))
    const tg = trunkBase.clone().applyMatrix4(m)
    trunks.push(tg)
    const cg = crownBase.clone().applyMatrix4(m)
    ;(t.crown === 0 ? crowns0 : crowns1).push(cg)
  }
  // Sengaja TIDAK bernama TPX_Trees*: mesh gabungan bukan pohon per-pohon
  // (tabrakan batang lewat `props` walkWorld, bukan mesh; dan LpmMapBackdrop
  // tidak boleh menyembunyikan SEMUA pohon sekaligus kalau bbox-nya
  // bersinggungan dengan satu rumah).
  const group = new THREE.Group()
  group.name = 'CityTrees'
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.95, flatShading: true })
  const crownMat0 = new THREE.MeshStandardMaterial({ color: 0x4d8f3a, roughness: 0.9, flatShading: true })
  const crownMat1 = new THREE.MeshStandardMaterial({ color: 0x5da244, roughness: 0.9, flatShading: true })
  const mk = (geo, mat, name) => {
    const mesh = new THREE.Mesh(geo, mat)
    mesh.name = name
    mesh.userData.clonedMaterial = true
    mesh.userData.sharedMaterial = true
    return mesh
  }
  group.add(mk(mergeGeometries(trunks), trunkMat, 'CityTrees_trunks'))
  if (crowns0.length) group.add(mk(mergeGeometries(crowns0), crownMat0, 'CityTrees_crowns0'))
  if (crowns1.length) group.add(mk(mergeGeometries(crowns1), crownMat1, 'CityTrees_crowns1'))
  return group
}

export function getCityTemplate() {
  if (TEMPLATE) return TEMPLATE
  const data = buildCityData()

  const root = new THREE.Group()
  root.name = 'CityRoot'

  // --- terrain (TPX_GreenAreas: dibaca ekstraktor sebagai tanah) ---
  const terrainGeo = new THREE.BufferGeometry()
  terrainGeo.setAttribute('position', new THREE.BufferAttribute(data.terrain.positions, 3))
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(data.terrain.colors, 3))
  terrainGeo.setIndex(new THREE.BufferAttribute(data.terrain.indices, 1))
  terrainGeo.computeBoundingSphere()
  const terrainMesh = new THREE.Mesh(
    terrainGeo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true })
  )
  terrainMesh.name = 'TPX_GreenAreas_City'
  terrainMesh.userData.clonedMaterial = true
  terrainMesh.userData.sharedMaterial = true
  root.add(terrainMesh)

  // --- air (TPX_Waterways: disembunyikan di Peta, jadi waterMat di Jelajahi) ---
  const waterMesh = meshFromTris(data.water.tris, {
    color: 0x3b9be0, roughness: 0.35, transparent: true, opacity: 0.88,
    side: THREE.DoubleSide,
  })
  waterMesh.name = 'TPX_Waterways_City'
  waterMesh.userData.clonedMaterial = true
  waterMesh.userData.sharedMaterial = true
  root.add(waterMesh)

  // --- jalan (TPX_RoadsOutlines) ---
  const roadGroup = new THREE.Group()
  roadGroup.name = 'CityRoads'
  for (const part of data.roadTris) {
    const mesh = meshFromTris(part.tris, { color: part.color, roughness: 0.95, side: THREE.DoubleSide })
    mesh.name = part.name
    if (part.noCollide) mesh.userData.noCollide = true
    mesh.userData.clonedMaterial = true
    mesh.userData.sharedMaterial = true
    roadGroup.add(mesh)
  }
  root.add(roadGroup)

  // --- 500 rumah warga ---
  root.add(buildCityHouses(data.placement.infos))

  // --- pohon (gabungan) ---
  root.add(buildCityTrees(data.trees))

  // --- fasilitas (Tahap 2) ---
  root.add(buildCityFacilities())

  TEMPLATE = root
  return TEMPLATE
}

export function getCityScene() {
  return getCityTemplate().clone(true)
}

// Tabrakan batang pohon buat walkWorld `props` (koordinat DUNIA: x, z=-y).
// Dipakai getCityWalkCache di TownWalk.jsx.
export function getCityTreeProps() {
  const data = buildCityData()
  return data.trees.map((t) => ({
    x: t.x,
    z: -t.y,
    r: 0.35 * t.s,
    y0: t.z - 0.1,
    y1: t.z + 8 * t.s,
  }))
}
