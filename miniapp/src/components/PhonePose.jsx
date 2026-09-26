import * as THREE from 'three'
import { RoundedBox } from '@react-three/drei'

// ============================================================
// Pose "megang HP" -- nekuk tangan KANAN karakter (chain
// Shoulder.R -> UpperArm.R -> LowerArm.R -> Fist.R, namanya sama
// persis di semua .glb Quaternius yang dipakai RP Town, udah dicek).
//
// PENTING soal cara kerjanya: daripada nebak-nebak sumbu lokal tiap
// bone (X/Y/Z bone ini ternyata kemana, beda-beda tiap software
// export), di sini rotasinya dihitung di RUANG DUNIA (world space)
// dari data yang beneran ada di model itu sendiri:
//   - "atas" karakter = arah dari Hips ke Head (bukan asumsi/tebakan)
//   - sumbu tekuk siku = tegak lurus dari "atas" & arah lengan saat
//     itu (cross product) -> ini otomatis jadi "sumbu siku alami",
//     gak peduli karakternya lagi ngadep kemana
// Jadi lengan ditekuk NAIK dari mana pun karakter ngadep, dan hasilnya
// mestinya selalu masuk akal (tangan naik ke arah dada), gak akan
// "kebalik total" walau tebakan sumbu di paragraf komentar ini salah.
//
// YANG MASIH TEBAKAN (paling gampang meleset, paling gampang di-tweak):
// - Angka-angka derajat di bawah -- efeknya kualitatif jelas
//   (lebih gede = lebih nekuk), tinggal geser sampai pas.
// - `wristTwistDeg` -- puntiran pergelangan biar muka HP ngadep ke
//   wajah, ini satu-satunya bagian yang masih pakai sumbu lokal
//   tebakan (soalnya Fist.R gak punya bone anak buat jadi patokan
//   arah). Kalau HP-nya kepasang miring aneh, INI dulu yang diubah.
// - Posisi/rotasi HP relatif ke telapak tangan (lihat PHONE_OFFSET
//   di bawah).
// ============================================================
const POSE_DEGREES = {
  shoulderLift: 16, // lengan atas terangkat dikit ke arah "atas badan"
  elbowBend: 92, // fleksi siku -- ini yang paling kerasa efeknya
  wristTwistDeg: -15, // puntiran pergelangan (sumbu lokal Fist.R, tebakan)
}

// Posisi & rotasi HP relatif ke bone Fist.R (satuan sama kayak skala
// model karakter). Digeser dikit ke "depan" telapak tangan pake tebakan
// sumbu lokal juga -- kalau HP-nya nongol nembus telapak/ke arah salah,
// ini yang paling gampang diubah (cuma 3 angka posisi + 3 rotasi).
const PHONE_OFFSET_POS = [0, 0.045, 0.035]
const PHONE_OFFSET_ROT = [Math.PI / 2.4, 0, 0]

const v1 = new THREE.Vector3()
const v2 = new THREE.Vector3()
const hingeAxis = new THREE.Vector3()
const parentWorldQuat = new THREE.Quaternion()
const currentWorldQuat = new THREE.Quaternion()
const deltaQuat = new THREE.Quaternion()

// Nekuk satu sendi (`bone`) supaya lengan dari `bone` ke `child`
// "naik" ke arah `upWorld`, sebesar `degrees`. World-space delta
// rotation, dikonversi balik ke local quaternion bone-nya.
function flexToward(bone, child, upWorld, degrees) {
  if (!bone || !child || !bone.parent) return
  bone.getWorldQuaternion(currentWorldQuat)
  v1.setFromMatrixPosition(bone.matrixWorld)
  v2.setFromMatrixPosition(child.matrixWorld)
  v2.sub(v1).normalize() // arah lengan saat ini, dunia
  hingeAxis.crossVectors(upWorld, v2)
  if (hingeAxis.lengthSq() < 1e-6) return // lengan udah sejajar "atas", gak ada sumbu tekuk yang jelas
  hingeAxis.normalize()
  deltaQuat.setFromAxisAngle(hingeAxis, THREE.MathUtils.degToRad(degrees))
  deltaQuat.multiply(currentWorldQuat) // = quaternion dunia yang baru
  bone.parent.getWorldQuaternion(parentWorldQuat)
  parentWorldQuat.invert()
  bone.quaternion.copy(parentWorldQuat.multiply(deltaQuat))
  bone.updateMatrixWorld(true)
}

// Dipanggil SEKALI per model (root = scene hasil clone). Return bone
// Fist.R (buat nempelin <LowPolyPhone>), atau null kalau nama bone-nya
// gak ketemu (model lain yang skeletonnya beda -- gagal secara aman,
// gak nge-crash, cuma HP-nya gak kepasang).
export function applyPhonePose(root, degrees = POSE_DEGREES) {
  root.updateMatrixWorld(true)
  const upperArm = root.getObjectByName('UpperArm.R')
  const lowerArm = root.getObjectByName('LowerArm.R')
  const fist = root.getObjectByName('Fist.R')
  const head = root.getObjectByName('Head')
  const hips = root.getObjectByName('Hips')
  if (!upperArm || !lowerArm || !fist || !head || !hips) return null

  const upWorld = new THREE.Vector3()
    .setFromMatrixPosition(head.matrixWorld)
    .sub(new THREE.Vector3().setFromMatrixPosition(hips.matrixWorld))
    .normalize()

  flexToward(upperArm, lowerArm, upWorld, degrees.shoulderLift)
  flexToward(lowerArm, fist, upWorld, degrees.elbowBend)

  // Puntiran pergelangan -- lihat catatan "MASIH TEBAKAN" di atas.
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
