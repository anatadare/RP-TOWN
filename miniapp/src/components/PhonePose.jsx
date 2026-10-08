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
// KALIBRASI ULANG (lihat screenshot terbaru): angka 0.075/0.065 + tilt
// 75° di bawah ini awalnya dikalibrasi buat pose tangan yang BEDA
// (sebelum lengan ditekuk ke dada). Begitu pose lengannya berubah,
// orientasi dasar Fist.R ikut berubah, tapi offset ini masih yang lama
// -- hasilnya HP malah NGAMBANG di samping kepalan (jaraknya kejauhan)
// dan kebaring (landscape, harusnya portrait/tegak). Dua perubahan:
// 1) jarak dari pusat kepalan DIKECILIN lagi (biar nempel, gak ngambang)
// 2) ditambah puntiran 90° di sumbu Z (`Math.PI/2` di komponen ke-3)
//    buat ngebalikin landscape -> portrait.
// CATATAN JUJUR: ini kalibrasi 3D yang susah dipastiin 100% tanpa liat
// render asli -- kalau abis ini masih kurang pas, kirim screenshot lagi,
// 3 angka pertama (posisi) & 3 angka kedua (rotasi) di sini yang paling
// gampang di-nudge dikit-dikit sampai pas.
// SEMENTARA di-nolin dulu (bukan kalibrasi final!) -- 2x percobaan nebak
// angka rotasi dari perhitungan offline ternyata meleset dari hasil
// render asli. Daripada numpuk tebakan di atas tebakan, rotasinya
// dinolin sebentar biar kelihatan orientasi ASLI Fist.R apa adanya
// (tanpa koreksi apa pun) -- dari situ koreksinya bisa dihitung LANGSUNG
// dari satu screenshot, bukan nebak lagi. Posisi (jarak dari kepalan)
// TETAP dipertahanin (udah pas, gak ada masalah soal itu).
// Posisi (udah pas, dari screenshot sebelumnya -- gak diubah lagi).
//
// Rotasi: dari screenshot baseline [0,0,0] (zoom in ke tangan), tepi
// layarnya diukur LANGSUNG dari pixel (bukan kira-kira) -- miring ~27°
// dari horizontal, padahal maunya tegak (~90°). Jadi diputer +63° di
// sumbu Z LOKAL si grup HP (ini muter HP di tempat dia berdiri, di
// "bidang layarnya" sendiri -- gak geser arah hadap layarnya sama
// sekali, cuma muterin kayak jarum jam/berlawanan di bidang datarnya).
// CATATAN: arah puterannya (+63° vs -63°) ditebak dari sudut pandang
// kamera di screenshot itu -- kalau pas dites malah muter ke arah
// SALAH (tambah miring, bukan tambah tegak), tinggal ganti angka 63
// di bawah jadi -63 (satu-satunya kemungkinan yang perlu dicoba).
// Komponen ke-3 (Z, "depan" telapak tangan) dimajuin 60% (0.04 -> 0.064)
// -- itu yang salah kemarin, bukan komponen ke-2 (Y), HP-nya masih
// kebenem ke DALAM tangan karena kurang maju, bukan kurang naik.
// ---- GAYA PEGANG HP ----------------------------------------------------
// 'side'  = (AKTIF) lengan KANAN nggantung natural di samping badan, HP
//           dipegang TEGAK (portrait) dengan ujung atasnya di genggaman dan
//           badan HP menjuntai ke bawah -- sesuai kotak merah di screenshot
//           referensi (HP di samping tangan, bukan di depan perut).
// 'chest' = gaya lama: lengan ditekuk ke depan dada, HP kebaring di depan
//           perut. Kode & angka kalibrasinya sengaja DIPERTAHANKAN di bawah,
//           tinggal ganti flag ini kalau mau balik.
export const PHONE_HOLD_STYLE = 'chest'
const SIDE = PHONE_HOLD_STYLE === 'side'

// Konfigurasi per gaya. Orientasi HP dihitung di WORLD space oleh
// alignPhoneUpright() (relatif ke badan karakter), jadi gak bergantung sumbu
// lokal bone yang susah ditebak.
//  anchor : titik genggam di bone Fist.R (koordinat lokal bone). Untuk 'chest'
//           angkanya sama dengan kalibrasi telapak lama (pose tangan udah pas).
//  tiltDeg: kemiringan HP ke depan (ujung atas menjauh dari badan).
//           0 = tegak lurus (AKTIF, sesuai permintaan: HP lurus, jangan miring).
//           Isi mis. 20-55 kalau suatu saat mau dimiringkan ke depan.
//  faceBack: true = layar menghadap ke ARAH WAJAH karakter (belakang + atas).
const STYLE = SIDE
  ? { anchor: [0, 0.09, 0], tiltDeg: 0, faceBack: false, grip: -0.25, back: 0 }
  : { anchor: [0, 0.09, 0.064], tiltDeg: 0, faceBack: true, grip: 0.22, back: 0.04 }
export const PHONE_SIDE_ANCHOR = STYLE.anchor

// Orientasi/posisi sekarang diurus alignPhoneUpright, jadi offset lama dinolkan.
export const PHONE_OFFSET_POS = [0, 0, 0]
export const PHONE_OFFSET_ROT = [0, 0, 0]

// Geser sepanjang sumbu panjang HP: 'chest' positif = telapak menopang bagian
// BAWAH HP, badan HP menjulang lurus ke atas. 'side' negatif =
// HP menjuntai ke bawah dari genggaman. Kalau kurang pas, ubah angka di STYLE.grip.
export const PHONE_GRIP_SHIFT = STYLE.grip
// Dorongan kecil ke arah belakang HP supaya punggung HP nempel telapak, gak nembus.
export const PHONE_BACK_SHIFT = STYLE.back

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

// ---- KUNCI LENGAN KANAN (anti gerak-gerak) -----------------------------
// Penyebab tangan "ngebug" pas megang HP: flexToward() nekuk lengan relatif
// ke pose lengan SAAT ITU (hasil animation mixer). Animasi Idle gak
// nggerakin lengan kanan sama sekali (konstan), tapi Walk/Run/Jump ngayunin
// lengan atas sampai ~60 derajat -- jadi tiap kali karakter melangkah
// (bahkan sedikit / pas crossfade Idle<->Walk), lengan yang megang HP ikut
// berayun naik-turun.
// Solusi: sebelum ditekuk, 4 tulang lengan kanan DIKEMBALIIN dulu ke pose
// Idle (pose yang dipakai waktu karakter diam = persis pose yang sekarang
// keliatan "bener"). Jadi hasil pose di Idle SAMA PERSIS kayak sebelumnya,
// dan di Walk/Run/Jump lengannya tetap diam relatif ke badan.
const ARM_LOCK_BONES = ['ShoulderR', 'UpperArmR', 'LowerArmR', 'FistR']
const armLockCache = new WeakMap() // root -> { bone, quat }[] | null

const normName = (n) => String(n).replace(/\./g, '')

function captureIdleArm(root, clips) {
  if (armLockCache.has(root)) return armLockCache.get(root)
  const idle = Array.isArray(clips) ? clips.find((c) => c.name === 'Idle') : null
  if (!idle) return null // belum ada clip -> jangan cache, coba lagi frame berikutnya
  const locks = []
  for (const name of ARM_LOCK_BONES) {
    const bone = root.getObjectByName(name)
    const track = idle.tracks.find((t) => normName(t.name) === name + 'quaternion')
    if (!bone || !track || track.values.length < 4) continue
    locks.push({ bone, quat: new THREE.Quaternion().fromArray(track.values, 0) })
  }
  const result = locks.length === ARM_LOCK_BONES.length ? locks : null
  armLockCache.set(root, result)
  return result
}

// Dipanggil tiap frame kalau equippedPhone true (lihat TownWalk.jsx).
// Return bone Fist.R (buat nempelin grup HP), atau null kalau nama
// bone-nya gak ketemu (gagal secara aman, gak nge-crash).
// `clips` (opsional) = array animasi karakter, dipakai buat ngunci lengan
// ke pose Idle (lihat KUNCI LENGAN KANAN di atas). Tanpa `clips` perilakunya
// sama kayak dulu (dipakai CharacterPreview yang pose-nya statis).
export function applyPhonePose(root, degrees = POSE_DEGREES, clips = null) {
  const locks = clips ? captureIdleArm(root, clips) : null
  if (locks) {
    for (const l of locks) l.bone.quaternion.copy(l.quat)
  }
  root.updateMatrixWorld(true)
  const upperArm = root.getObjectByName('UpperArmR')
  const lowerArm = root.getObjectByName('LowerArmR')
  const fist = root.getObjectByName('FistR')
  const shoulderL = root.getObjectByName('ShoulderL')
  const shoulderR = root.getObjectByName('ShoulderR')
  if (!upperArm || !lowerArm || !fist || !shoulderL || !shoulderR) return null

  // Mode 'side': lengan DIBIARIN natural (ikut animasi / bind pose), gak ditekuk.
  if (SIDE) return fist

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


const _fistQ = new THREE.Quaternion()
const _rootQ = new THREE.Quaternion()
const _localQ = new THREE.Quaternion()
const _tiltQ = new THREE.Quaternion()
const _flipQ = new THREE.Quaternion()
const _X = new THREE.Vector3(1, 0, 0)
const _Y = new THREE.Vector3(0, 1, 0)

// Pasang grup HP ke bone Fist.R dengan orientasi yang dihitung di world space
// (relatif ke badan karakter), berapa pun rotasi bone tangannya. Dipanggil TIAP
// FRAME setelah animation mixer (TownWalk) atau sekali di pose statis
// (CharacterPreview). `root` = object model karakter.
//   desired = rootWorld * tiltX(tiltDeg) * (faceBack ? flipY(180deg) : I)
//   local   = inverse(fistWorld) * desired
export function alignPhoneUpright(phoneGroup, fist, root) {
  if (!phoneGroup || !fist || !root) return
  fist.updateWorldMatrix(true, false)
  root.updateWorldMatrix(true, false)
  fist.getWorldQuaternion(_fistQ)
  root.getWorldQuaternion(_rootQ)
  _tiltQ.setFromAxisAngle(_X, THREE.MathUtils.degToRad(STYLE.tiltDeg))
  _flipQ.setFromAxisAngle(_Y, STYLE.faceBack ? Math.PI : 0)
  _localQ.copy(_fistQ).invert().multiply(_rootQ).multiply(_tiltQ).multiply(_flipQ)
  phoneGroup.quaternion.copy(_localQ)
  phoneGroup.position.set(STYLE.anchor[0], STYLE.anchor[1], STYLE.anchor[2])
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
