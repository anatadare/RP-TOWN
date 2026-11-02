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
// Dimensi model (denah): lebar PW (15) + atap menjorok 0.45 kiri-kanan;
// kedalaman PD (12) + balkon 1.4 di depan + teras.
const MODEL_W = PW + 0.9
const MODEL_D = PD + 1.4 + 0.9
const FRONT_MIN_Z = -1.45 // sisi terdepan (teras)
const MIN_SCALE = 0.7
const MAX_SCALE = 1.0
const GAP = 1.5 // jarak minimum antar rumah (meter)
const MAX_SHIFT = 9 // rumah boleh digeser sejauh ini dari titik aslinya (meter)
const BODY_H = 7.0
const ROAD_NEAR = 25 // meter

// Tinggi lantai & pondasi. Tapak rumah (14-16 m) jauh lebih lebar dari petak
// rumah lama, dan tanah Kawasan Pantai miring, jadi lantai TIDAK boleh
// ditaruh di titik tanah terendah (sisi tanah yang lebih tinggi menelan badan
// rumah). Lantai ditaruh di tanah tertinggi di bawah tapak; sisi yang lebih
// rendah ditutup pondasi.
const FLOOR_LIFT = 0.05 // lantai sedikit di atas tanah tertinggi (anti z-fighting)
const GROUND_GRID = 11 // titik sampel tanah per sisi tapak (GROUND_GRID^2 sinar); dicek: 0 rumah terkubur > 2 cm
const FOUND_D = 1.2 // tebal pondasi bawaan model (sebelum diskala)
const FOUND_C = 0x3d4248 // warna pondasi bawaan model
const FOUND_STEP = 0.25 // pondasi tambahan dibulatkan ke atas per langkah ini (model)
const FOUND_MARGIN = 0.15 // pondasi tambahan menembus sedikit ke tanah (meter)
const COLLIDE_MIN_DROP = 0.3 // tabrakan pondasi dipasang kalau lantai setinggi ini di atas tanah terendah

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

  const infos = []
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
    infos.push({ obj, num, cx, cy, x0: cx, y0: cy, sx, sy, fx, fy, minZ: bb.min.z, k: 1 })
  }

  // Rumah baru jauh lebih luas daripada petak rumah lama. Supaya tidak ada dua
  // rumah yang bertumpuk: rumah yang bertabrakan digeser menjauh (maks MAX_SHIFT
  // dari titik asalnya); kalau masih bertabrakan, skalanya diturunkan sedikit.
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

  // tinggi tanah di titik baru (ray ke bawah ke mesh GreenAreas); cadangan: dasar rumah lama
  const greens = []
  scene.traverse((o) => {
    if (!o.isMesh) return
    for (let q = o; q; q = q.parent) if ((q.name || '').startsWith('TPX_GreenAreas')) { greens.push(o); return }
  })
  const ray = new THREE.Raycaster()
  const o3 = new THREE.Vector3(), d3 = new THREE.Vector3(0, 0, -1).transformDirection(scene.matrixWorld)
  const groundAt = (x, y) => {
    if (!greens.length) return null
    o3.set(x, y, 600).applyMatrix4(scene.matrixWorld)
    ray.set(o3, d3)
    ray.far = 2000
    const hit = ray.intersectObjects(greens, false)[0]
    return hit ? hit.point.clone().applyMatrix4(inv).z : null
  }
  // Seluruh tapak disampel (grid GROUND_GRID x GROUND_GRID, termasuk tepinya).
  // Lantai = tanah tertinggi, jadi tidak ada dinding yang terkubur; `drop` =
  // selisih lantai ke tanah terendah, yang harus ditutup pondasi. Titik tanpa
  // mesh tanah (null) dilewati; kalau tidak ada satu pun titik kena tanah,
  // pakai dasar rumah lama seperti sebelumnya (tanpa pondasi tambahan).
  for (const h of infos) {
    const [w, d] = dims(h)
    let top = -Infinity, bottom = Infinity
    for (let i = 0; i < GROUND_GRID; i++) {
      for (let j = 0; j < GROUND_GRID; j++) {
        const g = groundAt(h.cx + (i / (GROUND_GRID - 1) - 0.5) * w, h.cy + (j / (GROUND_GRID - 1) - 0.5) * d)
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
    solid.name = `PantaiRumah_${num}`
    glass.name = `PantaiKaca_${num}`
    solid.userData.noCollide = true
    glass.userData.noCollide = true
    const col = new THREE.Mesh(sh.collider, sh.colliderMat)
    col.name = `PantaiTabrak_${num}`
    col.visible = false
    mirror.add(solid, glass, col)

    // Pondasi bawaan model cuma setebal FOUND_D * k. Kalau tanah di sisi bawah
    // lebih dalam dari itu, rumah kelihatan melayang: tambah blok pondasi
    // (visual saja) sampai menyentuh tanah terendah.
    const extra = h.drop - FOUND_D * k + FOUND_MARGIN
    if (extra > 0.05) {
      const fm = new THREE.Mesh(foundationGeo(sh, Math.ceil(extra / k / FOUND_STEP) * FOUND_STEP), sh.foundMat)
      fm.name = `PantaiPondasi_${num}`
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
      bc.name = `PantaiPondasiTabrak_${num}`
      bc.visible = false
      baseMirror.add(bc)
      group.add(baseRoot)
    }

    obj.visible = false
    obj.userData.replaced = true
  }

  scene.add(group)
  scene.userData.pantaiHouses = true
  scene.userData.pantaiScales = Object.fromEntries(infos.map((h) => [h.num, +h.k.toFixed(2)]))
}
