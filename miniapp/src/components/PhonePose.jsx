import * as THREE from 'three'
import { RoundedBox } from '@react-three/drei'

// ============================================================
// Pose "megang HP" -- nekuk tangan KANAN karakter (chain
// Shoulder.R -> UpperArm.R -> LowerArm.R -> Fist.R, namanya sama
// persis di semua .glb Quaternius yang dipakai RP Town, udah dicek).
// Nama bone yang dipakai di sini TANPA TITIK ("FistR", bukan "Fist.R")
// -- three.js GLTFLoader ngebuang titik dari nama node pas parsing,
// jadi "Fist.R" di file .glb otomatis jadi "FistR" pas sampai sini.
//
// CATATAN SOAL ARAH POSE (biar gak keubah lagi gak sengaja): lengan
// ditekuk ke arah DEPAN DADA (bukan dibiarin natural/nggantung, dan
// bukan juga ditekuk ke SAMPING badan -- itu sempet dicoba, hasilnya
// malah gak dipilih, DIBALIKIN ke versi depan-dada ini atas permintaan
// eksplisit). Rotasinya dihitung di world space pake sumbu bahu-kiri-
// ke-bahu-kanan (`rightWorld`), biar otomatis ikut arah hadap karakter.
// ============================================================
const POSE_DEGREES = {
  shoulderLift: 16, // lengan atas terangkat dikit ke arah dada
  elbowBend: 92, // fleksi siku -- ini yang paling kerasa efeknya, bawa telapak ke depan dada
  wristTwistDeg: -15, // puntiran pergelangan (sumbu lokal Fist.R, tebakan)
}

// Posisi & rotasi HP relatif ke bone Fist.R (satuan sama kayak skala
// model karakter). Digeser dikit ke "depan" telapak tangan pake tebakan
// sumbu lokal juga -- kalau HP-nya nongol nembus telapak/ke arah salah,
// ini yang paling gampang diubah (cuma 3 angka posisi + 3 rotasi).
// Diekspor (bukan cuma dipakai internal LowPolyPhone) supaya FoldablePhone
// (lihat FoldablePhone.jsx + phoneVariants.js) bisa dikalibrasi ke telapak
// tangan yang SAMA persis, biar posisinya konsisten mau pakai HP polos lama
// atau salah satu dari 15 varian lipat yang baru.
// Digeser lebih jauh dari titik tengah telapak (dulu 0.045/0.035) --
// jarak lama itu lebih pendek dari "jari-jari" mesh kepalan tangannya
// sendiri, jadi HP-nya nongol TEPAT DI DALAM mesh tangan (ketutupan/
// nembus, bukan hilang beneran, cuma gak kelihatan sama sekali dari
// luar). Kalau masih ketutupan, ini dulu yang digedein lagi.
export const PHONE_OFFSET_POS = [0, 0.075, 0.065]
export const PHONE_OFFSET_ROT = [Math.PI / 2.4, 0, 0]

const parentWorldQuat = new THREE.Quaternion()
const currentWorldQuat = new THREE.Quaternion()
const deltaQuat = new THREE.Quaternion()

// Nekuk satu sendi (`bone`) supaya lengan dari `bone` ke arah `axis`
// (world space) sebesar `degrees`. World-space delta rotation,
// dikonversi balik ke local quaternion bone-nya.
function flexToward(bone, axis, degrees) {
  if (!bone || !bone.parent) return
  bone.getWorldQuaternion(currentWorldQuat)
  deltaQuat.setFromAxisAngle(axis, THREE.MathUtils.degToRad(degrees))
  deltaQuat.multiply(currentWorldQuat) // = quaternion dunia yang baru
  bone.parent.getWorldQuaternion(parentWorldQuat)
  parentWorldQuat.invert()
  bone.quaternion.copy(parentWorldQuat.multiply(deltaQuat))
  bone.updateMatrixWorld(true)
}

// Dipanggil tiap frame kalau equippedPhone true (lihat TownWalk.jsx).
// Return bone Fist.R (buat nempelin grup HP), atau null kalau nama
// bone-nya gak ketemu (gagal secara aman, gak nge-crash).
export function applyPhonePose(root, degrees = POSE_DEGREES) {
  root.updateMatrixWorld(true)
  const upperArm = root.getObjectByName('UpperArmR')
  const lowerArm = root.getObjectByName('LowerArmR')
  const fist = root.getObjectByName('FistR')
  const shoulderL = root.getObjectByName('ShoulderL')
  const shoulderR = root.getObjectByName('ShoulderR')
  if (!upperArm || !lowerArm || !fist || !shoulderL || !shoulderR) return null

  // Sumbu "kiri-kanan tubuh": garis dari bahu kiri ke bahu kanan, dari
  // posisi bone yang BENERAN ada di model (bukan tebakan sumbu lokal).
  // Otomatis ikut arah hadap karakter (dihitung di world space). Nekuk
  // lengan atas & siku di sekitar sumbu ini bawa telapak tangan ke
  // depan dada.
  const rightWorld = new THREE.Vector3()
    .setFromMatrixPosition(shoulderR.matrixWorld)
    .sub(new THREE.Vector3().setFromMatrixPosition(shoulderL.matrixWorld))
    .normalize()

  flexToward(upperArm, rightWorld, degrees.shoulderLift)
  flexToward(lowerArm, rightWorld, degrees.elbowBend)

  // Puntiran pergelangan, biar muka layar HP ngadep ke arah yang masuk
  // akal buat dilihat, bukan ke tanah/ke belakang.
  const twist = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    THREE.MathUtils.degToRad(degrees.wristTwistDeg)
  )
  fist.quaternion.multiply(twist)
  fist.updateMatrixWorld(true)

  return fist
}

// HP low-poly, dibikin dari primitive geometry (bukan file .glb) --
// body rounded-box gepeng + layar item + 2 lensa kamera belakang.
// Ditaro sebagai children <group> yang nanti di-attach ke bone
// Fist.R (lihat CharacterPreview.jsx), jadi otomatis ngikut gerak
// tangan karena dia beneran jadi bagian dari scene graph bone itu.
export function LowPolyPhone({ scale = 1 }) {
  return (
    <group position={PHONE_OFFSET_POS} rotation={PHONE_OFFSET_ROT} scale={scale}>
      <RoundedBox args={[0.038, 0.078, 0.007]} radius={0.006} smoothness={2} castShadow>
        <meshStandardMaterial color="#1b1d24" roughness={0.35} metalness={0.15} />
      </RoundedBox>
      <mesh position={[0, 0, 0.0037]}>
        <planeGeometry args={[0.032, 0.068]} />
        <meshStandardMaterial color="#0a0c12" roughness={0.15} metalness={0.05} />
      </mesh>
      <mesh position={[-0.009, 0.028, -0.0038]}>
        <circleGeometry args={[0.004, 12]} />
        <meshStandardMaterial color="#0d0f16" roughness={0.4} />
      </mesh>
      <mesh position={[0.004, 0.028, -0.0038]}>
        <circleGeometry args={[0.004, 12]} />
        <meshStandardMaterial color="#0d0f16" roughness={0.4} />
      </mesh>
    </group>
  )
}
