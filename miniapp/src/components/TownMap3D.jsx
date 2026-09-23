import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { OrbitControls, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { unassignBuilding, createRoomForBuilding } from '../lib/rooms'
import { MAPS, getMapByKey } from '../lib/maps'
import { BUILDING_PREFIX } from '../lib/buildings'
import { hapticSelect } from '../lib/telegram'
import AdBillboard from './Billboard3D'

// Warna highlight
const COLOR_ASSIGNED = '#ffb454' // lantern, bangunan yang sudah jadi room
const COLOR_HOVER_ASSIGNED = '#ffd699'
const COLOR_HOVER_EMPTY = '#7fb8ff' // biru, dipakai pas admin hover bangunan kosong
const COLOR_SEARCH_FOCUS = '#7fe7ff' // cyan, dipakai pas bangunan ke-pilih dari search bar

// File .glb-nya diekspor dengan sumbu "atas" di Z (bukan Y seperti standar
// three.js/glTF), makanya kalau dipasang apa adanya, kamera "tampak atas" jadi
// nge-liat dari samping/miring parah (peta jadi kayak "kebalik"). Ini koreksi
// satu kali: puter -90° di sumbu X supaya Z (asli: atas) jadi Y (three.js: atas).
const AXIS_FIX_ROTATION = [-Math.PI / 2, 0, 0]

// Kemiringan kamera default saat pertama kali dibuka (masih berasa "tampak atas").
const DEFAULT_TILT = THREE.MathUtils.degToRad(28)

// Batas kemiringan kamera: boleh diputer 360° bebas kiri-kanan (azimuth) dan
// boleh dimiringkan naik-turun hampir penuh — dari nyaris tegak lurus dari
// atas sampai nyaris sejajar horizon — tapi tetap tidak pernah nembus ke
// bawah 90°, biar user gak pernah lihat sisi bawah peta.
const MIN_POLAR_ANGLE = THREE.MathUtils.degToRad(0.1) // nyaris lurus dari atas
const MAX_POLAR_ANGLE = THREE.MathUtils.degToRad(89.5) // nyaris sejajar horizon, gak sampe kebalik

// Prefix nama node laut/sungai kecil di dalam peta (kanal/sungai hasil
// export topografi). Mesh-mesh ini disembunyiin — laut utamanya sekarang
// dipasok dari aset Ocean_by_Poly_by_Google (lihat OceanSurface di bawah),
// bukan dari shader custom lagi.
const WATER_PREFIX = 'TPX_Waterways'

// Aset laut stylized low-poly (Google Poly, sudah Y-up standar glTF — beda
// dari model peta yang Z-up, makanya dipasang TERPISAH, di luar
// <group rotation={AXIS_FIX_ROTATION}>, langsung di world space).
const OCEAN_SURFACE_URL = '/models/ocean-surface.glb'

// Laut di-scale & di-posisiin OTOMATIS ngikutin ukuran pulau yang lagi aktif
// (bukan angka tetap), soalnya tiap peta beda ukuran & pusatnya beda-beda:
// - diagonal laut dibikin = diagonal bounding-box pulau × OCEAN_COVERAGE_MARGIN,
//   jadi airnya selalu cuma "20% lebih gede" dari pulaunya, gak lagi nutup
//   sampai horizon kayak sebelumnya.
// - laut digeser ke titik tengah bounding-box pulau (bukan dibiarin di world
//   origin), soalnya originnya beda-beda per model — kalau lautnya tetap di
//   (0,0) pas dikecilin, pulaunya jadi ke-geser keluar dari lautnya.
// uWaveScaleY tetap dikecilin manual: ombak aslinya sampai ~110 unit tinggi,
// dibikin cuma riak halus beberapa unit aja.
const OCEAN_COVERAGE_MARGIN = 1.2
const OCEAN_SCALE_XZ_FALLBACK = 0.3 // dipakai sebentar sebelum footprint pulau kehitung
const OCEAN_SCALE_Y = 0.05
// Posisi air SEKARANG dihitung otomatis dari tinggi pulau (footprint.size.y),
// bukan angka tetap lagi — soalnya angka tetap kelihatan gak ngaruh kalau
// skala modelnya beda-beda tiap peta. Air ditaruh di dasar bounding-box
// pulau (titik terendah), lalu digeser dikit ke atas oleh OCEAN_BASE_OFFSET
// biar masih "nyentuh" pantai, bukan ngambang jauh di bawah tanah.
const OCEAN_BASE_Y_FALLBACK = -1.45 // dipakai sebentar sebelum footprint pulau kehitung
const OCEAN_BASE_OFFSET = 0.5 // jarak air di atas titik terendah pulau

// ============================================================
// Matahari / Bulan / Bintang — benda langit low-poly yang beneran nyala
// ============================================================
// Posisinya SENGAJA di-fix di tengah-tengah peta (di atas pulau), bukan
// gerak muter ngikutin jam kayak matahari beneran — biar user gampang
// langsung ngenalin "oh itu mataharinya" / "oh itu bulannya" begitu buka
// peta, gak peduli kameranya lagi diputer ke arah mana. Yang berubah
// cuma DUA hal seiring jalannya waktu HP:
//   1. warna & kecerahan bola langitnya — kuning-terang pas siang, pelan²
//      meredup jadi oranye pas senja, lalu jadi putih-kebiruan pas malam
//      (bulan), lewat crossfade — bukan "klik" langsung ganti.
//   2. bintang-bintang di sekelilingnya, cuma nongol pas udah cukup gelap.
// Jam transisinya bebas ditentuin sendiri (sesuai instruksi), disamain
// kira-kira sama 4 fase yang sudah ada di header ("Pagi/Siang/Senja/Malam
// di RP Town", lihat getWorldPhase() di App.jsx) biar dua-duanya nyambung:
const SKY_DAWN_START = 5     // pagi: matahari mulai nongol, bulan mulai pudar
const SKY_DAWN_END = 6.5     // matahari udah full nyala
const SKY_DUSK_START = 16.5  // sore: matahari mulai meredup
const SKY_DUSK_END = 19      // udah malam total: bulan + bintang full nyala

// Hitung "fase langit" versi angka (0..1) dari jam beneran di HP user,
// dipakai buat nge-lerp warna & opacity matahari/bulan/bintang tiap 30
// detik (gak perlu tiap frame, wong jam jalannya pelan).
function getSkyPhase(date) {
  const t = date.getHours() + date.getMinutes() / 60
  const ramp = (start, end, x) => THREE.MathUtils.clamp((x - start) / (end - start), 0, 1)

  let sunOpacity
  if (t >= SKY_DAWN_START && t < SKY_DAWN_END) {
    sunOpacity = ramp(SKY_DAWN_START, SKY_DAWN_END, t)
  } else if (t >= SKY_DAWN_END && t < SKY_DUSK_START) {
    sunOpacity = 1
  } else if (t >= SKY_DUSK_START && t < SKY_DUSK_END) {
    sunOpacity = 1 - ramp(SKY_DUSK_START, SKY_DUSK_END, t)
  } else {
    sunOpacity = 0
  }
  const moonOpacity = 1 - sunOpacity

  // Bintang baru mulai keliatan begitu langit udah cukup gelap (bukan
  // barengan pas senja baru mulai), lalu ikut pudar begitu matahari naik.
  const starsOpacity = THREE.MathUtils.clamp((moonOpacity - 0.35) / 0.65, 0, 1)

  // Pas mepet senja/pagi, warnanya digeser ke oranye-kemerahan biar kerasa
  // efek "sunset/sunrise"-nya, bukan cuma transparan doang.
  const inDusk = t >= SKY_DUSK_START && t < SKY_DUSK_END
  const inDawn = t >= SKY_DAWN_START && t < SKY_DAWN_END
  const sunsetMix = inDusk ? ramp(SKY_DUSK_START, SKY_DUSK_END, t) : inDawn ? 1 - ramp(SKY_DAWN_START, SKY_DAWN_END, t) : 0
  const sunGlowColor = new THREE.Color('#fff6d6').lerp(new THREE.Color('#ff7a3d'), sunsetMix)

  return { sunOpacity, moonOpacity, starsOpacity, sunGlowColor }
}

// Tekstur glow lingkaran lembut, dibikin SEKALI pake canvas 2D (bukan tiap
// frame) terus dipasang di <sprite> yang selalu ngadep kamera (billboard
// otomatis bawaan three.js). Ini "akal-akalan" bikin badan mataharinya
// kerasa nyala/bloom tanpa perlu pasang post-processing bloom yang berat
// buat HP low-end.
function makeGlowTexture() {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.55)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

function makeStarTexture() {
  const size = 32
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.5, 'rgba(255,255,255,0.55)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  return new THREE.CanvasTexture(canvas)
}

const MOON_BASE_COLOR = new THREE.Color('#eaf1ff')
const MOON_EMISSIVE = new THREE.Color('#9fb8ff')
const SUN_BASE_COLOR = new THREE.Color('#fff6d6')
const SUN_EMISSIVE = new THREE.Color('#ffb454')

// Satu badan langit doang (bukan dua mesh matahari+bulan numpuk) yang
// warnanya di-lerp pelan² dari "mode bulan" ke "mode matahari" — sengaja
// gitu biar gak ada dua geometry transparan numpuk di titik yang sama
// (bisa bikin kedip/z-fighting pas lagi crossfade). Geometrinya icosahedron
// low-poly (flatShading) biar tiap muter kelihatan "berfaset" & pantulan
// cahayanya kerlap-kerlip dikit — nambah kesan "hidup"/nyala.
function CelestialBody({ anchor, bodyRadius, phase }) {
  const spinRef = useRef()
  const matRef = useRef()
  const glowRef = useRef()
  const glowMatRef = useRef()
  const lightRef = useRef()
  const glowTexture = useMemo(() => makeGlowTexture(), [])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (spinRef.current) spinRef.current.rotation.y = t * 0.05
    const pulse = 1 + Math.sin(t * 1.6) * 0.05

    const mixedColor = MOON_BASE_COLOR.clone().lerp(SUN_BASE_COLOR, phase.sunOpacity)
    const mixedEmissive = MOON_EMISSIVE.clone().lerp(phase.sunGlowColor, phase.sunOpacity)
    const glowStrength = Math.max(phase.sunOpacity, phase.moonOpacity)

    if (matRef.current) {
      matRef.current.color.copy(mixedColor)
      matRef.current.emissive.copy(mixedEmissive)
      matRef.current.emissiveIntensity = 0.8 + phase.sunOpacity * 1.0
    }
    if (glowRef.current) glowRef.current.scale.setScalar(bodyRadius * 4.5 * pulse)
    if (glowMatRef.current) {
      glowMatRef.current.color.copy(mixedEmissive)
      glowMatRef.current.opacity = 0.5 + glowStrength * 0.4
    }
    if (lightRef.current) {
      lightRef.current.color.copy(mixedEmissive)
      // Cahaya beneran cuma dikuatin pas matahari (biar siang kerasa lebih
      // terang), bulan cuma kasih cahaya remang-remang.
      lightRef.current.intensity = 0.25 + phase.sunOpacity * 0.9
    }
  })

  return (
    <group position={anchor}>
      {/* Halo/glow lembut di belakang badannya — inilah yang bikin dia
          "bersinar" alih-alih cuma bola polos nempel di langit. */}
      <sprite ref={glowRef} renderOrder={0}>
        <spriteMaterial ref={glowMatRef} map={glowTexture} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
      <group ref={spinRef}>
        <mesh renderOrder={1}>
          <icosahedronGeometry args={[bodyRadius, 1]} />
          <meshStandardMaterial ref={matRef} flatShading roughness={0.55} metalness={0.1} />
        </mesh>
      </group>
      <pointLight ref={lightRef} distance={bodyRadius * 45} decay={2} />
    </group>
  )
}

// Kubah bintang: satu THREE.Points doang per lapisan (bukan ratusan mesh
// kecil satu-satu) biar cuma 1 draw call — murah buat HP low-end. Dipasang
// pake sizeAttenuation=false biar ukurannya tetap sama di layar berapa pun
// jauhnya (kayak bintang beneran, gak ngecil pas "jauh").
function StarField({ radius, opacity, count = 220, size = 2.2, speed = 0.003 }) {
  const pointsRef = useRef()
  const materialRef = useRef()
  const starTexture = useMemo(() => makeStarTexture(), [])

  const positions = useMemo(() => {
    const pos = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2
      // Dibikin numpuk di puncak langit, jarang deket horizon (kubah atas
      // doang) — bintang deket horizon toh jarang kelihatan pas kamera
      // dikunci gak nembus ke bawah 90° (lihat MAX_POLAR_ANGLE).
      const phi = Math.acos(1 - Math.random() * 0.85)
      pos[i * 3] = radius * Math.sin(phi) * Math.cos(theta)
      pos[i * 3 + 1] = radius * Math.abs(Math.cos(phi))
      pos[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta)
    }
    return pos
  }, [radius, count])

  useFrame(({ clock }) => {
    if (opacity <= 0.01) return
    if (materialRef.current) {
      // Kedip pelan barengan (1 nilai opacity doang, bukan per-titik) —
      // cukup buat kerasa "berkelip" tanpa perlu shader custom yang mahal.
      const twinkle = 0.82 + Math.sin(clock.elapsedTime * 1.3 + radius) * 0.18
      materialRef.current.opacity = opacity * twinkle
    }
    if (pointsRef.current) pointsRef.current.rotation.y = clock.elapsedTime * speed
  })

  if (opacity <= 0.01) return null

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        ref={materialRef}
        map={starTexture}
        color="#ffffff"
        size={size}
        sizeAttenuation={false}
        transparent
        opacity={opacity}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  )
}

// Nentuin posisi (di tengah pulau, ketinggian sepantasnya) & ukuran badan
// langit dari bounding-box pulau yang lagi aktif (footprint yang sama yang
// dipakai OceanSurface) — jadi otomatis pas buat SEMUA peta walau
// ukuran/skala tiap peta beda-beda, gak perlu di-hardcode per peta.
function useCelestialGeometry(footprint) {
  return useMemo(() => {
    if (!footprint) {
      // Dipakai sebentar doang sebelum footprint peta kehitung.
      return { anchor: [0, 30, 0], bodyRadius: 3, starsRadius: 220 }
    }
    const maxDim = Math.max(footprint.size.x, footprint.size.z, 1)
    const heightAboveIsland = maxDim * 0.55
    const anchor = [
      footprint.center.x,
      footprint.center.y + footprint.size.y / 2 + heightAboveIsland,
      footprint.center.z,
    ]
    // Ukurannya sengaja di rentang tengah — cukup gede buat langsung
    // kebaca "oh itu matahari/bulan", tapi gak sampe kegedean nutupin peta.
    const bodyRadius = Math.max(maxDim * 0.045, 1.5)
    const starsRadius = maxDim * 7
    return { anchor, bodyRadius, starsRadius }
  }, [footprint])
}

// Komponen pembungkus: gabungin badan langit + 2 lapis bintang (satu rapat
// & redup buat "isi", satu jarang & lebih terang buat kesan kedalaman),
// dan nge-update fase langit tiap 30 detik dari jam beneran di HP user.
function CelestialSystem({ footprint }) {
  const { anchor, bodyRadius, starsRadius } = useCelestialGeometry(footprint)
  const [phase, setPhase] = useState(() => getSkyPhase(new Date()))

  useEffect(() => {
    const id = setInterval(() => setPhase(getSkyPhase(new Date())), 30_000)
    return () => clearInterval(id)
  }, [])

  return (
    <>
      <StarField radius={starsRadius} opacity={phase.starsOpacity} count={260} size={2} speed={0.003} />
      <StarField radius={starsRadius * 0.75} opacity={phase.starsOpacity} count={40} size={3.4} speed={-0.002} />
      <CelestialBody anchor={anchor} bodyRadius={bodyRadius} phase={phase} />
    </>
  )
}

// Laut utamanya sekarang dari sini: aset low-poly siap pakai (bukan hasil
// generate shader lagi), jadi cukup dipasang dan dikasih material
// flat-shaded biar kelihatan "berfaset" khas low-poly. Geometrinya sendiri
// sudah "dipahat" statis (gak dianimasiin per-vertex) — dianggap cukup
// hidup dengan cuma di-ayun naik-turun pelan-pelan tiap frame (jauh lebih
// murah daripada animasi per-vertex kayak versi shader sebelumnya).
function OceanSurface({ footprint }) {
  const { scene } = useGLTF(OCEAN_SURFACE_URL)
  const groupRef = useRef()

  const clonedScene = useMemo(() => {
    const cloned = scene.clone(true)
    cloned.traverse((obj) => {
      if (obj.isMesh) {
        obj.material = new THREE.MeshLambertMaterial({
          color: '#2f8fd1',
          flatShading: true,
          transparent: true,
          opacity: 0.92,
        })
        obj.castShadow = false
        obj.receiveShadow = false
      }
    })
    return cloned
  }, [scene])

  // Lebar (X) & kedalaman (Z) asli aset laut (dihitung sekali dari
  // geometrinya, bukan di-hardcode), dipakai sebagai acuan buat nentuin
  // faktor scale di bawah. Dulu dipakai diagonal (garis lurus pojok-ke-pojok)
  // buat nentuin scale, tapi itu cuma ngejamin pojok diagonal laut nyampe —
  // kalau bentuk lautnya gak persis kotak (asetnya low-poly, agak "gerigi")
  // atau pulaunya memanjang (lebar jauh beda sama kedalaman), sisi
  // kiri-kanan/depan-belakang laut bisa gak nyampe sampai tanah, jadi ada
  // tanah yang "kepotong" tanpa air di bawahnya.
  const oceanRawSize = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene)
    const size = new THREE.Vector3()
    box.getSize(size)
    return { x: size.x, z: size.z }
  }, [scene])

  const { scaleXZ, centerX, centerZ, baseY } = useMemo(() => {
    if (!footprint) {
      return { scaleXZ: OCEAN_SCALE_XZ_FALLBACK, centerX: 0, centerZ: 0, baseY: OCEAN_BASE_Y_FALLBACK }
    }
    // Hitung scale yang dibutuhkan di masing-masing sumbu (lebar & kedalaman)
    // secara terpisah, lalu pakai yang paling besar — biar laut dijamin
    // menutupi pulau penuh di KEDUA arah, bukan cuma pas di garis diagonal.
    const scaleForX = (footprint.size.x * OCEAN_COVERAGE_MARGIN) / oceanRawSize.x
    const scaleForZ = (footprint.size.z * OCEAN_COVERAGE_MARGIN) / oceanRawSize.z
    return {
      scaleXZ: Math.max(scaleForX, scaleForZ),
      centerX: footprint.center.x,
      centerZ: footprint.center.z,
      // Titik terendah pulau = pusat bounding-box dikurangi setengah tingginya.
      baseY: footprint.center.y - footprint.size.y / 2 + OCEAN_BASE_OFFSET,
    }
  }, [footprint, oceanRawSize])

  useFrame(({ clock }) => {
    if (groupRef.current) {
      groupRef.current.position.y = baseY + Math.sin(clock.elapsedTime * 0.6) * 0.15
    }
  })

  return (
    <group ref={groupRef} position={[centerX, baseY, centerZ]} scale={[scaleXZ, OCEAN_SCALE_Y, scaleXZ]}>
      <primitive object={clonedScene} />
    </group>
  )
}

function TownModel({
  modelUrl,
  assignedByKey,
  adminMode,
  hoveredKey,
  onHover,
  onBuildingClick,
  onBuildingsLoaded,
  onFootprintComputed,
  onBuildingsFootprintComputed,
  focusedKey,
}) {
  const { scene } = useGLTF(modelUrl)
  const rotatedGroupRef = useRef()

  // Ukur bounding-box seluruh pulau (bukan cuma bangunan) sekali tiap peta
  // kebaca, lalu lapor ke atas — dipakai OceanSurface buat nentuin seberapa
  // besar & di mana laut harus digambar (lihat komentar OCEAN_COVERAGE_MARGIN).
  useEffect(() => {
    if (!rotatedGroupRef.current) return

    // Jadikan pusat geometris seluruh pulau sebagai pivot nyata model.
    // GLB ini punya origin di salah satu sisi, jadi hanya mengubah
    // OrbitControls.target tidak cukup: kamera bisa mengorbit titik tengah,
    // tetapi geometry-nya sendiri tetap terasa bertumpu pada sisi.
    //
    // Hitung bounding-box setelah AXIS_FIX_ROTATION diterapkan, lalu geser
    // group sebesar kebalikan center-nya. Dengan begitu pusat map berada tepat
    // di origin world (0, 0, 0), dan origin tersebut menjadi pivot rotasi.
    rotatedGroupRef.current.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(rotatedGroupRef.current)
    const size = new THREE.Vector3()
    const center = new THREE.Vector3()
    box.getSize(size)
    box.getCenter(center)

    rotatedGroupRef.current.position.set(-center.x, -center.y, -center.z)
    rotatedGroupRef.current.updateMatrixWorld(true)

    // Laporkan footprint setelah pivot diterapkan supaya laut yang terpisah
    // juga otomatis memakai pusat map yang sama.
    const centeredBox = new THREE.Box3().setFromObject(rotatedGroupRef.current)
    const centeredSize = new THREE.Vector3()
    const centeredCenter = new THREE.Vector3()
    centeredBox.getSize(centeredSize)
    centeredBox.getCenter(centeredCenter)

    if (onFootprintComputed) {
      onFootprintComputed({ size: centeredSize, center: centeredCenter })
    }

    // Bounding-box KHUSUS bangunan (bukan seluruh pulau) — basis yang SAMA
    // persis dipakai FrameBuildingsOnce buat nge-frame kamera pas peta
    // pertama dibuka. Dipakai buat naro billboard (lihat AdBillboard),
    // supaya posisinya dijamin selalu ada dalam area yang ke-frame kamera,
    // gak kepental jauh ke terrain kosong di pinggir pulau kayak yang
    // dipakai footprint di atas (beda peta bisa beda jauh lebar
    // terrain-nya dari lebar kumpulan bangunannya).
    if (onBuildingsFootprintComputed) {
      const buildingsBox = new THREE.Box3()
      let hasBuildings = false
      rotatedGroupRef.current.traverse((obj) => {
        if (obj.isMesh && obj.name.startsWith(BUILDING_PREFIX)) {
          buildingsBox.expandByObject(obj)
          hasBuildings = true
        }
      })
      if (hasBuildings) {
        const bSize = new THREE.Vector3()
        const bCenter = new THREE.Vector3()
        buildingsBox.getSize(bSize)
        buildingsBox.getCenter(bCenter)
        onBuildingsFootprintComputed({ size: bSize, center: bCenter })
      }
    }
  }, [scene, onFootprintComputed, onBuildingsFootprintComputed])


  // Sungai/kanal kecil bawaan tiap peta disembunyiin — laut utamanya sekarang
  // dari OceanSurface (aset Google Poly), jadi mesh air lama ini gak perlu
  // dirender lagi (biar gak dobel/tabrakan sama laut yang baru).
  useEffect(() => {
    scene.traverse((obj) => {
      if (obj.isMesh && obj.name.startsWith(WATER_PREFIX)) {
        obj.visible = false
      }
    })
  }, [scene])

  // Tiap mesh bangunan dikasih material sendiri-sendiri (clone),
  // soalnya aslinya beberapa bangunan berbagi 1 material yang sama —
  // kalau tidak di-clone, highlight 1 bangunan bakal ikut nyala di bangunan lain.
  useEffect(() => {
    scene.traverse((obj) => {
      if (obj.isMesh && obj.name.startsWith(BUILDING_PREFIX) && !obj.userData.clonedMaterial) {
        obj.material = obj.material.clone()
        obj.userData.clonedMaterial = true
      }
    })
  }, [scene])

  // Kumpulin semua nomor node bangunan yang beneran ada di model peta ini,
  // lalu lapor ke atas (App.jsx) — dipakai buat search bar: berapa total
  // bangunan di peta ini, dan bikin entry "Bangunan N" buat yang belum ada room-nya.
  useEffect(() => {
    if (!onBuildingsLoaded) return
    const keys = new Set()
    scene.traverse((obj) => {
      if (obj.isMesh && obj.name.startsWith(BUILDING_PREFIX)) keys.add(obj.name)
    })
    onBuildingsLoaded(Array.from(keys))
  }, [scene, onBuildingsLoaded])

  // Update warna emissive tiap kali status assigned/hover/search-focus berubah
  useEffect(() => {
    scene.traverse((obj) => {
      if (!(obj.isMesh && obj.name.startsWith(BUILDING_PREFIX))) return
      const mat = obj.material
      const isAssigned = Boolean(assignedByKey[obj.name])
      const isHovered = hoveredKey === obj.name
      const isSearchFocused = focusedKey === obj.name

      if (isSearchFocused) {
        mat.emissive = new THREE.Color(COLOR_SEARCH_FOCUS)
        mat.emissiveIntensity = 0.6
      } else if (isHovered && adminMode) {
        mat.emissive = new THREE.Color(isAssigned ? COLOR_HOVER_ASSIGNED : COLOR_HOVER_EMPTY)
        mat.emissiveIntensity = 0.55
      } else if (isHovered && isAssigned) {
        mat.emissive = new THREE.Color(COLOR_HOVER_ASSIGNED)
        mat.emissiveIntensity = 0.55
      } else if (isAssigned) {
        mat.emissive = new THREE.Color(COLOR_ASSIGNED)
        mat.emissiveIntensity = 0.22
      } else {
        mat.emissive = new THREE.Color('#000000')
        mat.emissiveIntensity = 0
      }
    })
  }, [scene, assignedByKey, hoveredKey, adminMode, focusedKey])

  function handleClick(e) {
    const name = e.object?.name
    if (name && name.startsWith(BUILDING_PREFIX)) {
      e.stopPropagation()
      onBuildingClick(name)
    }
  }

  function handlePointerMove(e) {
    const name = e.object?.name
    if (name && name.startsWith(BUILDING_PREFIX)) {
      e.stopPropagation()
      onHover(name)
    }
  }

  return (
    <group ref={rotatedGroupRef} rotation={AXIS_FIX_ROTATION}>
      <primitive
        object={scene}
        onClick={handleClick}
        onPointerMove={handlePointerMove}
        onPointerOut={() => onHover(null)}
      />
    </group>
  )
}

// Preload semua peta yang terdaftar (bukan cuma yang lagi aktif), biar pas
// user pindah peta modelnya sudah kebaca duluan di background dan gak nunggu.
MAPS.forEach((map) => useGLTF.preload(map.modelUrl))
useGLTF.preload(OCEAN_SURFACE_URL)

// Naro posisi kamera SEKALI aja pas model pertama kali kebaca, fokus ke area
// bangunan aja (bukan ke seluruh peta termasuk jalan yang jauh di pinggir).
// Sengaja tidak "observe"/refit terus-terusan, biar posisi kamera user
// tidak ke-reset sendiri tiap ada resize (misal address bar HP muncul-hilang).
function FrameBuildingsOnce({ groupRef }) {
  const { camera, controls } = useThree()
  const framed = useRef(false)

  useEffect(() => {
    if (framed.current || !groupRef.current) return

    // Pastikan matrix dunia (termasuk rotasi koreksi sumbu di atas) sudah
    // ke-update sebelum dipakai buat hitung bounding box, biar tidak kebaca
    // posisi lama (frame sebelum rotasi diterapkan).
    groupRef.current.updateMatrixWorld(true)

    const box = new THREE.Box3()
    let found = false
    groupRef.current.traverse((obj) => {
      if (obj.isMesh && obj.name.startsWith(BUILDING_PREFIX)) {
        box.expandByObject(obj)
        found = true
      }
    })
    if (!found) return

    framed.current = true

    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const mapBox = new THREE.Box3().setFromObject(groupRef.current)
    const mapCenter = mapBox.getCenter(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.z) || 1

    // Model sudah dipusatkan secara nyata di origin world, jadi pusat map
    // sekarang menjadi pusat kamera sekaligus pivot OrbitControls.
    // Jarak framing tetap dihitung dari ukuran bangunan seperti sebelumnya.
    // Kamera diposisikan miring sedikit dari atas (tampak atas ala papan) saat
    // pertama kali dibuka. Setelah ini, user boleh muter & miringin sendiri
    // lewat OrbitControls (dibatasi MIN/MAX_POLAR_ANGLE di bawah).
    const height = maxDim * 1.4
    camera.position.set(
      mapCenter.x,
      mapCenter.y + height * Math.cos(DEFAULT_TILT),
      mapCenter.z + height * Math.sin(DEFAULT_TILT)
    )
    camera.near = Math.max(maxDim / 200, 0.1)
    camera.far = maxDim * 20
    camera.updateProjectionMatrix()

    if (controls) {
      controls.target.copy(mapCenter)
      controls.minDistance = maxDim * 0.3
      controls.maxDistance = maxDim * 3
      controls.update()
    } else {
      camera.lookAt(mapCenter)
    }
  })

  return null
}

// Dipicu tiap kali ada bangunan yang dipilih dari search bar (App.jsx).
// Beda dari FrameBuildingsOnce di atas: ini nge-zoom ke SATU bangunan aja,
// dan boleh dipanggil berkali-kali (tiap kali user pilih hasil search baru).
function FocusBuilding({ groupRef, focusRequest }) {
  const { camera, controls } = useThree()
  const lastHandled = useRef(null)

  useEffect(() => {
    if (!focusRequest || !focusRequest.buildingKey) return
    if (lastHandled.current === focusRequest.nonce) return
    if (!groupRef.current) return

    let targetObj = null
    groupRef.current.traverse((obj) => {
      if (obj.isMesh && obj.name === focusRequest.buildingKey) targetObj = obj
    })
    if (!targetObj) return

    lastHandled.current = focusRequest.nonce

    const box = new THREE.Box3().setFromObject(targetObj)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z) || 1

    // Jarak kamera dari bangunan yang dipilih. Di-clamp ke minDistance yang
    // udah di-set FrameBuildingsOnce (berdasar ukuran seluruh peta), biar
    // OrbitControls gak langsung "narik mundur" kamera pas user pertama kali
    // muter/zoom setelah hasil search dipilih.
    const rawHeight = maxDim * 4.5
    const minAllowed = controls?.minDistance || 0
    const height = Math.max(rawHeight, minAllowed)

    camera.position.set(
      center.x,
      center.y + height * Math.cos(DEFAULT_TILT),
      center.z + height * Math.sin(DEFAULT_TILT)
    )
    camera.updateProjectionMatrix()

    if (controls) {
      controls.target.copy(center)
      controls.update()
    } else {
      camera.lookAt(center)
    }
  }, [focusRequest, groupRef, camera, controls])

  return null
}

// Penjaga kalau peta tiba-tiba "hilang" (layar kosong) setelah user muter/geser
// cepat — biasanya gara-gara WebGL context di HP kebuang (context lost, karena
// memori GPU habis) atau posisi kamera jadi NaN. Komponen ini gak ngubah
// zoom/rotasi sama sekali, cuma ngedeteksi kondisi rusak lalu minta Canvas
// di-remount (onRecover) — hasilnya sama kayak user nekan tombol refresh.
const AUTO_RECOVER_MIN_GAP_MS = 1500 // jeda minimal antar auto-recover, cegah loop tanpa henti

function RecoveryGuard({ onRecover }) {
  const { gl, camera } = useThree()
  const lastRecoverAt = useRef(0)

  function recoverThrottled() {
    const now = Date.now()
    if (now - lastRecoverAt.current < AUTO_RECOVER_MIN_GAP_MS) return
    lastRecoverAt.current = now
    onRecover()
  }

  useEffect(() => {
    const canvas = gl.domElement

    function handleLost(e) {
      // preventDefault wajib supaya browser boleh nyoba mulihin context.
      e.preventDefault()
      recoverThrottled()
    }

    canvas.addEventListener('webglcontextlost', handleLost, false)
    return () => canvas.removeEventListener('webglcontextlost', handleLost, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, onRecover])

  // Kamera yang posisinya NaN/Infinity = peta gak bakal kerender lagi.
  useFrame(() => {
    const { x, y, z } = camera.position
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      recoverThrottled()
    }
  })

  return null
}

// Panel yang muncul pas sebuah bangunan diklik dalam mode admin:
// lepas assignment, atau bikin room baru (bebas nama/emoji sendiri).
function BuildingAssignPanel({ buildingKey, currentRoom, onUnassign, onCreateNew, onClose }) {
  const [mode, setMode] = useState(currentRoom ? 'assigned' : 'create') // 'create' | 'assigned'
  const [newName, setNewName] = useState('')
  const [newEmoji, setNewEmoji] = useState('📍')
  const [newUrl, setNewUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function handleCreate() {
    if (!newName.trim()) {
      setErr('Nama room wajib diisi.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      await onCreateNew({ name: newName.trim(), emoji: newEmoji.trim(), telegramGroupUrl: newUrl.trim() })
    } catch (e) {
      console.error(e)
      setErr('Gagal membuat room. Slug mungkin sudah dipakai.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">Bangunan: {buildingKey}</h2>

        {currentRoom && mode === 'assigned' && (
          <>
            <p className="modal-desc">
              Terhubung ke room <strong>{currentRoom.emoji} {currentRoom.name}</strong>.
            </p>
            <button className="modal-btn modal-btn-secondary" disabled={busy} onClick={() => setMode('create')}>
              Ganti room
            </button>
            <button className="modal-btn modal-btn-secondary" disabled={busy} onClick={onUnassign}>
              Lepas dari room ini
            </button>
          </>
        )}

        {mode === 'create' && (
          <>
            <p className="modal-desc">Buat room untuk bangunan ini.</p>
            <input
              className="building-input"
              placeholder="Nama room (contoh: Balai Kota)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              disabled={busy}
            />
            <input
              className="building-input"
              placeholder="Emoji (contoh: 🏛️)"
              value={newEmoji}
              onChange={(e) => setNewEmoji(e.target.value)}
              disabled={busy}
            />
            <input
              className="building-input"
              placeholder="Link grup Telegram (https://t.me/+...)"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              disabled={busy}
            />
            <button className="modal-btn modal-btn-primary" disabled={busy} onClick={handleCreate}>
              {busy ? 'Menyimpan...' : 'Buat & Hubungkan'}
            </button>
          </>
        )}

        {err && <p className="modal-desc" style={{ color: '#ff8a8a' }}>{err}</p>}

        <button className="modal-btn modal-btn-secondary" disabled={busy} onClick={onClose}>
          Tutup
        </button>
      </div>
    </div>
  )
}

export default function TownMap3D({
  mapKey,
  modelUrl,
  rooms,
  adminMode,
  onSelectRoom,
  onRoomsChanged,
  onBuildingsLoaded,
  focusRequest,
}) {
  const [hoveredKey, setHoveredKey] = useState(null)
  const [pickerBuilding, setPickerBuilding] = useState(null)
  const [islandFootprint, setIslandFootprint] = useState(null)
  // Bounding-box khusus bangunan (subset dari islandFootprint) — basis yang
  // dipakai buat naro billboard, lihat komentar di TownModel di atas.
  const [buildingsFootprint, setBuildingsFootprint] = useState(null)
  // Dinaikin tiap kali peta perlu di-refresh (tombol refresh / auto-recover).
  // Ikut jadi bagian key <Canvas>, jadi Canvas di-remount bersih tanpa user
  // harus keluar dari miniapp.
  const [refreshNonce, setRefreshNonce] = useState(0)
  const modelGroupRef = useRef()

  const refreshMap = useCallback(() => setRefreshNonce((n) => n + 1), [])

  // Config billboard punya peta yang lagi aktif (posisi & imageUrl-nya diatur
  // di lib/maps.js per-peta, lihat komentar di sana).
  const billboardConfig = useMemo(() => getMapByKey(mapKey)?.billboard || {}, [mapKey])

  const assignedByKey = useMemo(() => {
    const map = {}
    rooms.forEach((r) => {
      if (r.building_key) map[r.building_key] = r
    })
    return map
  }, [rooms])

  // Reset state lokal tiap kali pindah peta (peta lain punya bangunan &
  // nomor node yang beda, jadi hoveredKey/picker lama sudah gak relevan)
  useEffect(() => {
    setHoveredKey(null)
    setPickerBuilding(null)
    // Reset footprint pulau lama juga — dipakai OceanSurface, kalau gak
    // di-reset lautnya bakal sempet "nyangkut" pake ukuran peta sebelumnya
    // sepersekian detik sebelum footprint peta baru kehitung ulang.
    setIslandFootprint(null)
    setBuildingsFootprint(null)
  }, [mapKey])

  function handleBuildingClick(buildingKey) {
    if (adminMode) {
      setPickerBuilding(buildingKey)
      return
    }
    const room = assignedByKey[buildingKey]
    if (room) onSelectRoom(room)
  }

  return (
    <div className="map3d-viewport">
      {/* key={mapKey} di sini sengaja bikin seluruh <Canvas> remount pas pindah
          peta: model lama di-unload, kamera & framing dihitung ulang dari nol
          buat bounding box peta yang baru (tiap peta beda ukuran/posisi). */}
      <Canvas key={`${mapKey}-${refreshNonce}`} shadows dpr={[1, 2]} camera={{ fov: 42, near: 1, far: 5000 }}>
        <color attach="background" args={['#1b2340']} />
        <ambientLight intensity={0.65} />
        <directionalLight position={[60, 100, 40]} intensity={1.15} castShadow />
        <hemisphereLight args={['#6b7fd9', '#232a45', 0.4]} />
        {/* Matahari/bulan/bintang gak butuh nunggu model .glb kebaca, jadi
            ditaruh di luar <Suspense> biar langsung nongol dari awal
            (footprint pulau masih null sebentar, dipakai fallback dulu). */}
        <CelestialSystem footprint={islandFootprint} />
        <Suspense fallback={null}>
          <OceanSurface footprint={islandFootprint} />
          <AdBillboard
            footprint={islandFootprint}
            boundsFootprint={buildingsFootprint}
            offsetXFactor={billboardConfig.offsetXFactor ?? 0}
            offsetZFactor={billboardConfig.offsetZFactor ?? -1}
            imageUrl={billboardConfig.imageUrl ?? null}
          />
          <group ref={modelGroupRef}>
            <TownModel
              modelUrl={modelUrl}
              assignedByKey={assignedByKey}
              adminMode={adminMode}
              hoveredKey={hoveredKey}
              onHover={setHoveredKey}
              onBuildingClick={handleBuildingClick}
              onBuildingsLoaded={onBuildingsLoaded}
              onFootprintComputed={setIslandFootprint}
              onBuildingsFootprintComputed={setBuildingsFootprint}
              focusedKey={focusRequest?.buildingKey || null}
            />
          </group>
        </Suspense>
        <FocusBuilding groupRef={modelGroupRef} focusRequest={focusRequest} />
        {/* Boleh diputer bebas kiri-kanan & dimiringkan (rotate), boleh digeser
            (pan), dan boleh di-zoom — tapi kemiringannya dikunci di
            MIN/MAX_POLAR_ANGLE, jadi kamera gak akan pernah nembus sampai
            kelihatan sisi bawah peta. */}
        <OrbitControls
          makeDefault
          enableRotate
          minPolarAngle={MIN_POLAR_ANGLE}
          maxPolarAngle={MAX_POLAR_ANGLE}
          enableDamping
          dampingFactor={0.12}
          screenSpacePanning
          rotateSpeed={0.6}
          zoomSpeed={0.8}
          panSpeed={0.9}
          mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
          touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
        />
        <FrameBuildingsOnce groupRef={modelGroupRef} />
        <RecoveryGuard onRecover={refreshMap} />
      </Canvas>

      {/* Tombol refresh peta: kalau peta sampai kosong/hilang, user tinggal
          tap ini (gak perlu keluar-masuk miniapp). Berlaku buat semua peta
          karena ada di komponen yang dipakai bareng. */}
      <button
        type="button"
        className="map3d-refresh-btn"
        aria-label="Muat ulang peta"
        title="Muat ulang peta"
        onClick={() => {
          hapticSelect()
          refreshMap()
        }}
      >
        <svg key={refreshNonce} className="map3d-refresh-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <polyline points="21 3 21 9 15 9" />
        </svg>
      </button>

      {adminMode && (
        <div className="map3d-admin-badge">Mode Admin — klik bangunan untuk atur room</div>
      )}

      {pickerBuilding && (
        <BuildingAssignPanel
          buildingKey={pickerBuilding}
          currentRoom={assignedByKey[pickerBuilding]}
          onUnassign={async () => {
            await unassignBuilding(pickerBuilding)
            await onRoomsChanged()
            setPickerBuilding(null)
          }}
          onCreateNew={async (fields) => {
            await createRoomForBuilding({ ...fields, buildingKey: pickerBuilding, mapKey })
            await onRoomsChanged()
            setPickerBuilding(null)
          }}
          onClose={() => setPickerBuilding(null)}
        />
      )}
    </div>
  )
}
