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
// GANTI PENDEKATAN (lihat catatan panjang di applyPhonePose): sebelumnya
// lengan cuma ditekuk ke DEPAN (ke arah dada), yang berarti tangannya
// berakhir tepat di belakang badan/kepala sendiri kalau dilihat dari
// kamera yang selalu ada di BELAKANG karakter (kayak di RP Town) --
// ketutupan total, keliatannya kayak "gak nempel/gak muncul". Sekarang
// lengannya diangkat ke SAMPING dulu (abduksi, kayak mau lambaian),
// baru siku ditekuk muter sumbu VERTIKAL -- hasilnya tangan/HP-nya ada
// di samping bahu/kepala, nongol jelas dari sudut manapun termasuk dari
// belakang.
const POSE_DEGREES = {
  shoulderAbduct: 55, // lengan atas ke samping+naik (menjauh dari badan)
  elbowBend: 90, // tekuk siku muter sumbu vertikal, bawa telapak ke depan bahu
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

// Nekuk satu sendi (`bone`) sebesar `degrees` di sekitar `axis` (world
// space, FIXED -- lihat catatan di applyPhonePose soal kenapa axis-nya
// gak dihitung dari arah lengan lagi). World-space delta rotation,
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

// Dipanggil SEKALI per model (root = scene hasil clone). Return bone
// Fist.R (buat nempelin <LowPolyPhone>), atau null kalau nama bone-nya
// gak ketemu (model lain yang skeletonnya beda -- gagal secara aman,
// gak nge-crash, cuma HP-nya gak kepasang).
export function applyPhonePose(root, degrees = POSE_DEGREES) {
  root.updateMatrixWorld(true)
  // CATATAN: nama bone di file .blend/.glb aslinya pakai titik (mis.
  // "Fist.R"), TAPI three.js GLTFLoader otomatis MEMBUANG titik dari
  // nama node pas parsing (titik dipakai buat pemisah path animasi,
  // jadi dianggap karakter gak valid di nama node) -- "Fist.R" jadi
  // "FistR" pas sampai di sini. Ini sempat bikin seluruh fungsi ini gagal
  // diam-diam (selalu return null) karena getObjectByName nyari nama yang
  // gak akan pernah ketemu. Dicek langsung ke output GLTFLoader buat mastiin.
  const upperArm = root.getObjectByName('UpperArmR')
  const lowerArm = root.getObjectByName('LowerArmR')
  const fist = root.getObjectByName('FistR')
  const shoulderL = root.getObjectByName('ShoulderL')
  const shoulderR = root.getObjectByName('ShoulderR')
  if (!upperArm || !lowerArm || !fist || !shoulderL || !shoulderR) return null

  // Sumbu "kiri-kanan tubuh": garis dari bahu kiri ke bahu kanan, dari
  // posisi bone yang BENERAN ada di model (bukan tebakan sumbu lokal).
  // Otomatis ikut arah hadap karakter (dihitung di world space).
  const rightWorld = new THREE.Vector3()
    .setFromMatrixPosition(shoulderR.matrixWorld)
    .sub(new THREE.Vector3().setFromMatrixPosition(shoulderL.matrixWorld))
    .normalize()

  // Sumbu "depan-belakang tubuh": tegak lurus dari "atas dunia" (gravitasi,
  // selalu (0,1,0), gak butuh Head/Hips) dan sumbu kiri-kanan di atas.
  // Muter lengan atas di sekitar sumbu INI (bukan sumbu kiri-kanan) itu
  // gerakan "abduksi" -- ngangkat lengan dari nggantung ke samping badan,
  // BUKAN ke depan dada. Ini kuncinya biar tangan gak ketutupan badan
  // sendiri pas dilihat dari kamera belakang karakter.
  const upWorld = new THREE.Vector3(0, 1, 0)
  const forwardWorld = new THREE.Vector3().crossVectors(upWorld, rightWorld).normalize()

  // Arah "keluar" dari badan buat lengan KANAN itu kebalik dari rightWorld
  // (rightWorld nunjuk dari bahu KIRI ke KANAN, tapi buat ngejauhin lengan
  // kanan dari badan, rotasinya harus ke arah negatif sumbu depan-belakang
  // -- dicek langsung angkanya, lihat catatan di bawah kalau nanti mau
  // dipakein ke lengan KIRI juga, tanda minusnya perlu dibalik).
  flexToward(upperArm, forwardWorld, -degrees.shoulderAbduct)
  // Siku ditekuk muter sumbu VERTIKAL (bukan lagi sumbu kiri-kanan) --
  // begitu lengan atas udah nunjuk ke samping (horizontal), muter siku di
  // sumbu vertikal bawa telapak tangan ke DEPAN BAHU (bukan makin jauh ke
  // depan dada/tembus ke belakang kepala kayak sebelumnya), jadi tetep di
  // ketinggian bahu/dekat kepala -- kelihatan dari kamera manapun.
  flexToward(lowerArm, upWorld, degrees.elbowBend)

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
