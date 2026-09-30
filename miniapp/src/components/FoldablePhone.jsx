import { useMemo } from 'react'
import * as THREE from 'three'
import { RoundedBox } from '@react-three/drei'
import { FOLD_TYPES, dimsForVariant } from './phoneVariants'

// ============================================================
// FoldablePhone -- HP lipat low-poly, parametrik.
//
// LOGIC BUKA-TUTUP (samain kayak baris GLOBAL di CSV open/close-logic):
//   fold_t: 0 = tertutup penuh, 1 = terbuka penuh (flat).
//   - FLIP  : sudut lipat = fold_t * 180°, dilipat di sumbu X (horizontal),
//             shell BAWAH diam, shell ATAS yang muter.
//   - BOOK  : tiap shell muter ±(1 - fold_t) * 90° di sumbu Y (vertikal)
//             dari bidang datar, shell KIRI diam (jadi acuan), shell
//             KANAN yang keliatan "ngikutin".
// Referensi resmi: "clamp angle; jangan sampai shell nembus shell lain
// pas fold_t=0" -- makanya ada `hingeGap` kecil di antara dua shell.
//
// PENYEDERHANAAN yang disengaja (biar tetep low-poly & ringan):
// - Layar TIDAK di-bend/dilengkungkan beneran di crease. Tiap shell
//   punya potongan layarnya sendiri-sendiri (flat), jadi tetap "gak
//   pernah nembus lurus ngelewatin hinge" (sesuai catatan CSV) tanpa
//   perlu mesh deformasi/skinning layar.
// - Varian "rotating-sliding hinge" (2-stage, geser dikit pas muter)
//   disederhanakan jadi rotasi murni satu sumbu. Kalau nanti mau
//   dipertajam, tinggal tambah offset translasi kecil yang di-drive
//   dari `fold_t` juga di shell yang sama.
// ============================================================

function CameraModule({ camera, color, ringColor, matte }) {
  const { housing, housingSize, ringR, lenses, hasFlash } = camera
  const roughness = matte ? 0.85 : 0.35
  return (
    <group position={[0, 0, 0.0001]}>
      {housing === 'rect' && (
        <RoundedBox args={[housingSize[0], housingSize[1], 0.0016]} radius={0.0025} smoothness={2}>
          <meshStandardMaterial color={color} roughness={roughness} metalness={0.25} />
        </RoundedBox>
      )}
      {housing === 'bar' && (
        <RoundedBox args={[housingSize[0], housingSize[1], 0.0018]} radius={housingSize[1] / 2} smoothness={3}>
          <meshStandardMaterial color={color} roughness={roughness} metalness={0.3} />
        </RoundedBox>
      )}
      {housing === 'ring' && (
        <mesh>
          <ringGeometry args={[ringR * 0.72, ringR, 32]} />
          <meshStandardMaterial color={ringColor} roughness={roughness} metalness={0.4} side={THREE.DoubleSide} />
        </mesh>
      )}
      {lenses.map((l, i) => (
        <mesh key={i} position={[l.x, l.y, 0.0012]}>
          <circleGeometry args={[l.r, 16]} />
          <meshStandardMaterial color="#05060a" roughness={0.15} metalness={0.1} />
        </mesh>
      ))}
      {hasFlash && (
        <mesh position={[0, 0.0, 0.0012]}>
          <circleGeometry args={[0.0018, 10]} />
          <meshStandardMaterial color="#e8e4d0" roughness={0.5} />
        </mesh>
      )}
    </group>
  )
}

// Satu "shell" (badan rigid): body + layar (di sisi depan) + kamera
// (opsional, cuma di shell yang jadi tempat modul kamera belakang).
function Shell({ w, h, t, bodyColor, frameColor, hasCamera, camera, lensRing, matte, screenInset = 0.003, cameraOffset = [0, 0] }) {
  return (
    <group>
      <RoundedBox args={[w, h, t]} radius={Math.min(w, h) * 0.09} smoothness={2} castShadow>
        <meshStandardMaterial color={bodyColor} roughness={matte ? 0.7 : 0.3} metalness={matte ? 0.05 : 0.2} />
      </RoundedBox>
      {/* Frame tipis di pinggir, dirender sebagai box sedikit lebih besar di belakang body */}
      <mesh position={[0, 0, -t * 0.02]}>
        <boxGeometry args={[w * 1.03, h * 1.03, t * 0.94]} />
        <meshStandardMaterial color={frameColor} roughness={0.4} metalness={0.5} />
      </mesh>
      {/* Layar depan */}
      <mesh position={[0, 0, t / 2 + 0.0005]}>
        <planeGeometry args={[w - screenInset, h - screenInset]} />
        <meshStandardMaterial color="#0a0c12" roughness={0.15} metalness={0.05} />
      </mesh>
      {/* Modul kamera belakang (kalau shell ini yang jadi rumah kamera) */}
      {hasCamera && (
        <group position={[cameraOffset[0], cameraOffset[1], -t / 2 - 0.0002]} rotation={[0, Math.PI, 0]}>
          <CameraModule camera={camera} color={frameColor} ringColor={lensRing} matte={matte} />
        </group>
      )}
    </group>
  )
}

// Default scale dinaikin dari 1 -- dimensi HP di phoneVariants.js (mis.
// openW/openH ~0.04-0.08) itu di ruang lokal bone tangan, yang KEIKUT
// ke-scale kecil lagi sama faktor normalisasi tinggi badan karakter.
// Hasilnya, di scale=1, HP-nya beneran cuma beberapa cm -- gampang
// "tenggelam" ketutupan mesh kepalan tangan. Sempet dinaikin ke 1.7x,
// masih dilaporin "kecil banget" dari jarak kamera default RP Town --
// naik lagi ke 2.6x. Kalau masih kurang gede/malah kegedean, ini satu-
// satunya angka yang perlu diubah (gak ngubah proporsi tiap varian).
export default function FoldablePhone({ variant, foldT = 1, scale = 2.6 }) {
  const dims = useMemo(() => dimsForVariant(variant), [variant])
  const { openW, openH, shellT, hingeGap } = dims
  const clampedT = THREE.MathUtils.clamp(foldT, 0, 1)

  if (variant.foldType === FOLD_TYPES.FLIP) {
    // Dua shell ditumpuk vertikal (atas/bawah). Tinggi tiap shell = separuh
    // tinggi "terbuka", biar pas fold_t=1 dua-duanya nyambung jadi satu
    // bidang setinggi `openH`.
    const shellH = openH / 2
    const halfGap = hingeGap / 2
    // Sudut hinge: 0 = flat (fold_t=1), 180° = terlipat nutup (fold_t=0)
    const hingeAngle = THREE.MathUtils.degToRad(180 * (1 - clampedT))
    return (
      <group scale={scale}>
        {/* Shell BAWAH -- diam, jadi acuan. Kamera belakang ada di sini. */}
        <group position={[0, -shellH / 2 - halfGap, 0]}>
          <Shell
            w={openW}
            h={shellH}
            t={shellT}
            bodyColor={variant.colors.body}
            frameColor={variant.colors.frame}
            lensRing={variant.colors.lensRing}
            hasCamera
            camera={variant.camera}
            cameraOffset={[openW / 2 - (variant.camera.housingSize?.[0] ?? variant.camera.ringR * 2 ?? 0.02) / 2 - 0.004, shellH / 2 - 0.014]}
          />
        </group>
        {/* Pivot hinge, persis di garis tengah (y=0) -- shell ATAS nempel di sini */}
        <group rotation={[hingeAngle, 0, 0]}>
          <group position={[0, shellH / 2 + halfGap, 0]}>
            <Shell
              w={openW}
              h={shellH}
              t={shellT}
              bodyColor={variant.colors.body}
              frameColor={variant.colors.frame}
              lensRing={variant.colors.lensRing}
              hasCamera={false}
            />
          </group>
        </group>
        {/* Batang hinge (silinder tipis di sumbu X) */}
        <mesh position={[0, 0, -shellT * 0.3]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[hingeGap * 0.55, hingeGap * 0.55, openW * 0.94, 12]} />
          <meshStandardMaterial color={variant.colors.frame} roughness={0.3} metalness={0.6} />
        </mesh>
      </group>
    )
  }

  // ---- BOOK ----
  // Dua shell berdampingan horizontal (kiri/kanan). Lebar tiap shell =
  // separuh lebar "terbuka". Tiap shell muter ±(1-fold_t)*90° dari
  // bidang datar mengelilingi garis hinge vertikal (x=0).
  const shellW = openW / 2
  const halfGapB = hingeGap / 2
  const wingAngle = THREE.MathUtils.degToRad(90 * (1 - clampedT))
  const camW = variant.camera.housingSize?.[0] ?? (variant.camera.ringR ? variant.camera.ringR * 2 : 0.02)
  const camH = variant.camera.housingSize?.[1] ?? (variant.camera.ringR ? variant.camera.ringR * 2 : 0.02)
  return (
    <group scale={scale}>
      {/* Shell KIRI -- diam, jadi acuan. Kamera belakang ada di sini. */}
      <group position={[-shellW / 2 - halfGapB, 0, 0]}>
        <Shell
          w={shellW}
          h={openH}
          t={shellT}
          bodyColor={variant.colors.body}
          frameColor={variant.colors.frame}
          lensRing={variant.colors.lensRing}
          matte={variant.matte}
          hasCamera
          camera={variant.camera}
          cameraOffset={[
            -shellW / 2 + camW / 2 + 0.005,
            openH / 2 - camH / 2 - (variant.barRaised ? 0.008 : 0.012),
          ]}
        />
      </group>
      {/* Pivot hinge di garis tengah (x=0) -- shell KANAN muter di sini */}
      <group rotation={[0, wingAngle, 0]}>
        <group position={[shellW / 2 + halfGapB, 0, 0]}>
          <Shell
            w={shellW}
            h={openH}
            t={shellT}
            bodyColor={variant.colors.body}
            frameColor={variant.colors.frame}
            lensRing={variant.colors.lensRing}
            matte={variant.matte}
            hasCamera={false}
          />
        </group>
      </group>
      {/* Batang hinge (silinder tipis di sumbu Y) */}
      <mesh position={[0, 0, -shellT * 0.3]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[hingeGap * 0.55, hingeGap * 0.55, openH * 0.96, 12]} />
        <meshStandardMaterial color={variant.colors.frame} roughness={0.3} metalness={0.6} />
      </mesh>
    </group>
  )
}
