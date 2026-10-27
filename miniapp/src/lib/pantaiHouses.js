// Mengganti rumah-rumah daratan Kawasan Pantai (node "BeachHouse_N_x" di
// kawasan-pantai.glb) dengan tampak luar "Rumah Pantai" 2 lantai yang sama
// dengan interiornya (lib/houseInteriorPantai.js).
//
// Dipakai di dua tempat: TownMap3D (tampilan peta) dan TownWalk (mode Jelajahi).
// Fungsinya bekerja langsung di `scene` (frame lokal glb: Z ke atas), jadi
// otomatis ikut rotasi/posisi yang dipasang pemanggilnya.
//
// Tiap rumah lama: disembunyikan (userData.replaced), lalu rumah baru
// ditaruh di titik tengah yang sama, menghadap ke jalan terdekat, dan diskalakan
// kalau petak aslinya sempit.
import * as THREE from 'three'
import { buildStaticBoxes, PW, PD } from './houseInteriorPantai'

const HOUSE_RE = /^BeachHouse_(\d+)_/
// Dimensi model (denah): lebar 10 + atap menjorok 0.45 kiri-kanan; kedalaman 9
// + balkon 1.4 di depan + teras.
const MODEL_W = PW + 0.9
const MODEL_D = PD + 1.4 + 0.9
const FRONT_MIN_Z = -1.45 // sisi terdepan (teras)
const MIN_SCALE = 0.75
const MAX_SCALE = 1.0
const BODY_H = 7.0
const ROAD_NEAR = 25 // meter

// Kotak (koordinat denah + tinggi) -> geometri ber-vertex-color.
// Sumbu: (x denah, tinggi, y denah) -> (x, y, z) three.
export function boxesToGeometry(boxes) {
  const n = boxes.length
  const pos = new Float32Array(n * 24 * 3)
  const nor = new Float32Array(n * 24 * 3)
  const col = new Float32Array(n * 24 * 3)
  const idx = new Uint32Array(n * 36)
  const color = new THREE.Color()
  const FACES = [
    [[1, 0, 0], [[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]]],
    [[-1, 0, 0], [[0, 0, 1], [0, 0, 0], [0, 1, 0], [0, 1, 1]]],
    [[0, 1, 0], [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]]],
    [[0, -1, 0], [[0, 0, 1], [1, 0, 1], [1, 0, 0], [0, 0, 0]]],
    [[0, 0, 1], [[1, 0, 1], [0, 0, 1], [0, 1, 1], [1, 1, 1]]],
    [[0, 0, -1], [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]],
  ]
  let v = 0, ii = 0
  for (const b of boxes) {
    color.setHex(b.c)
    for (const [nrm, corners] of FACES) {
      for (const c of corners) {
        const o = v * 3
        pos[o] = c[0] ? b.x1 : b.x0
        pos[o + 1] = c[1] ? b.h1 : b.h0
        pos[o + 2] = c[2] ? b.y1 : b.y0
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

let SHARED = null
function shared() {
  if (!SHARED) {
    const { solid, glass } = buildStaticBoxes({ exterior: true })
    SHARED = {
      solid: boxesToGeometry(solid),
      glass: boxesToGeometry(glass.map((g) => ({ ...g, c: 0x6f93a8 }))),
      // kotak tabrakan (hanya badan rumah; teras & balkon dibiarkan bisa dilewati)
      collider: new THREE.BoxGeometry(PW + 0.3, BODY_H, PD + 0.3).translate(PW / 2, BODY_H / 2, PD / 2),
      solidMat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 }),
      glassMat: new THREE.MeshStandardMaterial({
        vertexColors: true, transparent: true, opacity: 0.55, roughness: 0.08, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide,
      }),
      colliderMat: new THREE.MeshBasicMaterial({ visible: false }),
    }
  }
  return SHARED
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

// Pasang rumah baru menggantikan semua BeachHouse_* di `scene`. Aman dipanggil
// berulang (ditandai di scene.userData).
export function addPantaiHouses(scene) {
  if (!scene || scene.userData.pantaiHouses) return
  scene.updateWorldMatrix(true, true)
  const inv = new THREE.Matrix4().copy(scene.matrixWorld).invert()
  const rel = new THREE.Matrix4()

  const old = []
  scene.traverse((obj) => {
    if (obj.isMesh && obj.geometry && HOUSE_RE.test(obj.name || '')) old.push(obj)
  })
  if (!old.length) return

  const roads = collectRoadPoints(scene, inv)
  const sh = shared()
  const group = new THREE.Group()
  group.name = 'PantaiHouses'

  // pusat kumpulan rumah lama (frame lokal scene)
  const center = new THREE.Vector3()
  for (const obj of old) {
    if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox()
    rel.multiplyMatrices(inv, obj.matrixWorld)
    center.add(obj.geometry.boundingBox.clone().applyMatrix4(rel).getCenter(new THREE.Vector3()))
  }
  center.divideScalar(old.length)

  for (const obj of old) {
    const num = Number(HOUSE_RE.exec(obj.name)[1])
    if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox()
    rel.multiplyMatrices(inv, obj.matrixWorld)
    const bb = obj.geometry.boundingBox.clone().applyMatrix4(rel)
    const cx = (bb.min.x + bb.max.x) / 2
    const cy = (bb.min.y + bb.max.y) / 2
    const sx = bb.max.x - bb.min.x
    const sy = bb.max.y - bb.min.y

    // arah depan: ke jalan terdekat kalau ada yang dekat (<= ROAD_NEAR), kalau
    // tidak (kebanyakan rumah di pulau ini jauh dari jalan) menghadap ke pusat
    // kumpulan rumah, jadi rumah-rumah saling berhadapan seperti satu kompleks.
    // Hasilnya dibulatkan ke sumbu x / y (rumah selalu sejajar sumbu).
    let best = Infinity, fx = 0, fy = -1
    let tx = 0, ty = 0
    for (let i = 0; i < roads.length; i += 2) {
      const dx = roads[i] - cx, dy = roads[i + 1] - cy
      const d = dx * dx + dy * dy
      if (d < best) { best = d; tx = dx; ty = dy }
    }
    if (best > ROAD_NEAR * ROAD_NEAR) { tx = center.x - cx; ty = center.y - cy }
    if (Math.hypot(tx, ty) > 0.5) {
      if (Math.abs(tx) > Math.abs(ty)) { fx = Math.sign(tx); fy = 0 } else { fx = 0; fy = Math.sign(ty) }
    }
    const alongY = fx === 0 // depan menghadap sumbu y -> lebar rumah sepanjang x
    const slotW = alongY ? sx : sy // petak sepanjang sisi lebar rumah
    const slotD = alongY ? sy : sx
    const k = THREE.MathUtils.clamp(Math.min(slotW / MODEL_W, slotD / MODEL_D), MIN_SCALE, MAX_SCALE)

    // model: depan = -z denah. Setelah rotasi X +90 (Y-up -> Z-up) depan jadi +y;
    // rotasi z phi mengarahkannya ke (fx, fy).
    const phi = Math.atan2(-fx, fy)
    const house = new THREE.Group()
    house.name = `TPX_Buildings_${num}` // dikenali TownWalk (nomor rumah + tabrakan)
    house.position.set(cx, cy, bb.min.z)
    house.rotation.z = phi
    const tilt = new THREE.Group()
    tilt.rotation.x = Math.PI / 2
    tilt.scale.setScalar(k)
    const mirror = new THREE.Group()
    mirror.scale.set(-1, 1, 1)
    // pusat jejak rumah (termasuk balkon & teras) -> titik tengah petak
    mirror.position.set(PW / 2, 0, -(FRONT_MIN_Z + PD) / 2)
    const solid = new THREE.Mesh(sh.solid, sh.solidMat)
    const glass = new THREE.Mesh(sh.glass, sh.glassMat)
    glass.renderOrder = 2
    solid.name = `PantaiRumah_${num}`
    glass.name = `PantaiKaca_${num}`
    solid.userData.noCollide = true
    glass.userData.noCollide = true
    const col = new THREE.Mesh(sh.collider, sh.colliderMat)
    col.name = `PantaiTabrak_${num}`
    col.visible = false
    mirror.add(solid, glass, col)
    tilt.add(mirror)
    house.add(tilt)
    group.add(house)

    obj.visible = false
    obj.userData.replaced = true
  }

  scene.add(group)
  scene.userData.pantaiHouses = true
}
