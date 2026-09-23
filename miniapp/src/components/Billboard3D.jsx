import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

// ============================================================
// Billboard iklan berdiri sendiri di peta (mockup papan reklame kosong,
// warna putih polos) — nanti tinggal ditempelin gambar lewat prop
// `imageUrl` begitu fitur "order billboard" (grup Telegram-nya) sudah jadi.
// Sampai saat itu, panelnya otomatis tampil putih polos.
//
// Ukurannya dihitung PROPORSIONAL terhadap ukuran pulau (footprint) yang
// lagi aktif, bukan angka tetap — senada sama cara CelestialBody &
// OceanSurface di TownMap3D.jsx nentuin ukuran mereka sendiri, jadi
// billboard-nya otomatis kelihatan wajar di peta kecil maupun besar.
// ============================================================

// --- Proporsi billboard, aman diubah kalau kerasa kekecilan/kegedean ---
const PANEL_WIDTH_FACTOR = 0.16 // lebar panel = 16% dari sisi terpanjang pulau
const PANEL_ASPECT = 0.42 // tinggi panel = 42% dari lebarnya (mirip billboard beneran)
const POLE_HEIGHT_FACTOR = 1.6 // tinggi tiang (dasar sampai bawah panel) = 1.6x tinggi panel
const GROUND_OFFSET_FACTOR = 0.01 // jarak dasar tiang di atas titik terendah pulau (biar gak "tenggelam")

// Load tekstur gambar billboard secara manual (bukan drei's useTexture)
// supaya kalau imageUrl belum ada / gagal dimuat, komponen TETAP tampil
// (fallback ke putih polos) alih-alih bikin <Suspense> di atasnya nge-throw.
function useOptionalTexture(url) {
  const [texture, setTexture] = useState(null)
  useEffect(() => {
    if (!url) {
      setTexture(null)
      return undefined
    }
    let cancelled = false
    const loader = new THREE.TextureLoader()
    loader.load(
      url,
      (tex) => {
        if (cancelled) return
        tex.colorSpace = THREE.SRGBColorSpace
        setTexture(tex)
      },
      undefined,
      () => {
        if (!cancelled) setTexture(null) // gagal load -> tetap putih polos, gak error
      }
    )
    return () => {
      cancelled = true
    }
  }, [url])
  return texture
}

// 4 lampu sorot kecil ngadep ke bawah, dijejer rapi di atas panel — cuma
// dekorasi (gak casting light beneran) biar tetap ringan di HP low-end.
function BillboardLamps({ width, height }) {
  const count = 4
  const armHeight = height * 0.22
  return (
    <group position={[0, height / 2, width * 0.02]}>
      {Array.from({ length: count }).map((_, i) => {
        const t = (i + 0.5) / count - 0.5
        const x = t * width * 0.92
        return (
          <group key={i} position={[x, 0, 0]}>
            <mesh position={[0, armHeight * 0.5, 0]}>
              <cylinderGeometry args={[width * 0.006, width * 0.006, armHeight, 6]} />
              <meshStandardMaterial color="#4b5160" roughness={0.5} metalness={0.6} />
            </mesh>
            <mesh position={[0, armHeight, width * 0.025]} rotation={[-0.5, 0, 0]}>
              <boxGeometry args={[width * 0.035, width * 0.02, width * 0.05]} />
              <meshStandardMaterial color="#fffdf2" emissive="#fff2c2" emissiveIntensity={0.9} roughness={0.4} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

// Fondasi bulat pipih di dasar tiang, biar gak kelihatan "nancep" polos.
function PoleBase({ poleRadius }) {
  return (
    <mesh position={[0, poleRadius * 0.4, 0]}>
      <cylinderGeometry args={[poleRadius * 3.2, poleRadius * 3.6, poleRadius * 0.8, 8]} />
      <meshStandardMaterial color="#333844" roughness={0.7} metalness={0.3} />
    </mesh>
  )
}

export default function AdBillboard({ footprint, offsetXFactor = 0, offsetZFactor = -1, imageUrl = null }) {
  const headRef = useRef()
  const texture = useOptionalTexture(imageUrl)

  const geo = useMemo(() => {
    if (!footprint) return null
    const maxDim = Math.max(footprint.size.x, footprint.size.z, 1)
    const panelWidth = maxDim * PANEL_WIDTH_FACTOR
    const panelHeight = panelWidth * PANEL_ASPECT
    const poleHeight = panelHeight * POLE_HEIGHT_FACTOR
    const poleRadius = panelWidth * 0.02
    const frameDepth = panelWidth * 0.03
    const groundY = footprint.center.y - footprint.size.y / 2 + maxDim * GROUND_OFFSET_FACTOR
    const x = footprint.center.x + footprint.size.x * offsetXFactor
    const z = footprint.center.z + footprint.size.z * offsetZFactor
    return { panelWidth, panelHeight, poleHeight, poleRadius, frameDepth, groundY, x, z }
  }, [footprint, offsetXFactor, offsetZFactor])

  // Kepala billboard (frame + panel + lampu) diputer ulang tiap frame biar
  // selalu ngadep kamera — CUMA rotasi Y (yaw), tiangnya sendiri tetap diam
  // nancep di tanah/laut. Efeknya: dari sisi mana pun peta di-orbit/zoom,
  // mukanya selalu "ngikutin" & keliatan ngadep user, sama kayak billboard
  // beneran yang pipih (cuma gak kebaca kalau kamera hampir persis dari
  // atas/bawahnya banget — itu udah otomatis dibatasi sama OrbitControls
  // di TownMap3D, kamera gak pernah nembus lihat sisi bawah peta).
  useFrame(({ camera }) => {
    if (!headRef.current || !geo) return
    const dx = camera.position.x - geo.x
    const dz = camera.position.z - geo.z
    headRef.current.rotation.y = Math.atan2(dx, dz)
  })

  if (!geo) return null

  const { panelWidth, panelHeight, poleHeight, poleRadius, frameDepth, groundY, x, z } = geo

  return (
    <group position={[x, groundY, z]}>
      <PoleBase poleRadius={poleRadius} />

      <mesh position={[0, poleHeight / 2, 0]} castShadow>
        <cylinderGeometry args={[poleRadius, poleRadius * 1.15, poleHeight, 8]} />
        <meshStandardMaterial color="#5a6172" roughness={0.55} metalness={0.5} />
      </mesh>

      <group ref={headRef} position={[0, poleHeight, 0]}>
        {/* Bingkai gelap di belakang, sedikit lebih gede dari panelnya */}
        <mesh castShadow>
          <boxGeometry args={[panelWidth * 1.06, panelHeight * 1.16, frameDepth]} />
          <meshStandardMaterial color="#3a3f4a" roughness={0.6} metalness={0.4} />
        </mesh>

        {/* Panel depan — putih polos, siap ditempelin gambar order billboard
            lewat prop imageUrl begitu fitur grup order-nya sudah jadi. */}
        <mesh position={[0, 0, frameDepth / 2 + panelWidth * 0.003]} castShadow>
          <boxGeometry args={[panelWidth, panelHeight, frameDepth * 0.3]} />
          <meshStandardMaterial color="#ffffff" map={texture} roughness={0.45} metalness={0.05} />
        </mesh>
        {/* Panel belakang — sisi satunya, putih polos juga (billboard 2 muka) */}
        <mesh position={[0, 0, -frameDepth / 2 - panelWidth * 0.003]} rotation={[0, Math.PI, 0]} castShadow>
          <boxGeometry args={[panelWidth, panelHeight, frameDepth * 0.3]} />
          <meshStandardMaterial color="#ffffff" map={texture} roughness={0.45} metalness={0.05} />
        </mesh>

        <BillboardLamps width={panelWidth} height={panelHeight} />

        {/* Batang penyangga dari tiang ke tengah-bawah panel */}
        <mesh position={[0, -panelHeight / 2 - poleRadius * 4, 0]}>
          <cylinderGeometry args={[poleRadius * 0.9, poleRadius * 0.9, poleRadius * 8, 6]} />
          <meshStandardMaterial color="#4b5160" roughness={0.6} metalness={0.5} />
        </mesh>
      </group>
    </group>
  )
}
