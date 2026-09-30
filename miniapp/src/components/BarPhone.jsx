import { useMemo, useEffect } from 'react'
import * as THREE from 'three'
import { useGLTF } from '@react-three/drei'
import { BAR_RAW_DIMS } from './barPhoneVariants'

// ============================================================
// BarPhone -- render HP "batangan" (bar/slab) dari file .glb asli,
// beda total cara kerjanya dari <FoldablePhone> (yang digambar dari
// primitif RoundedBox, gak ada file eksternal). Dipakai buat 39 varian
// di barPhoneVariants.js.
//
// KENAPA PERLU PROSES MANUAL (gak langsung <primitive object={scene}/>):
// 1. File .glb sumbernya CUMA punya atribut POSITION + COLOR_0 (dicek
//    langsung ke JSON glTF-nya), TIDAK ada NORMAL. Kalau dipakai
//    mentah, pencahayaan meshStandardMaterial jadi aneh/geometrinya
//    keliatan gelap rata di mana-mana. Makanya tiap geometry dipanggil
//    .computeVertexNormals() sekali (di sini, bukan di file sumbernya).
// 2. Warnanya ada di vertex color (COLOR_0), bukan di material/tekstur
//    -- jadi materialnya WAJIB vertexColors:true, dan gak butuh
//    tekstur apa pun (aman kena content-security policy, gak ada
//    network request lain).
// 3. flatShading:true SENGAJA dipasang -- asetnya low-poly (belasan
//    mesh doang per HP), kalau di-smooth malah keliatan "meleleh" gak
//    presisi di tiap sudut kotak HP. Kalau nanti pengin tampilan lebih
//    halus, ini yang pertama dicoba diubah ke false.
//
// SCALE: dims asli bbox (BAR_RAW_DIMS, ~0.25 x 0.52 x 0.04) udah
// KEBETULAN deket sama ukuran final HP buku di FoldablePhone (openW
// 0.078 x openH 0.08, dikali scale=8 defaultnya jadi ~0.62 x 0.64).
// Constant BAR_TARGET_LONG_SIDE di bawah nyamain sisi terpanjang HP
// bar ini (0.523) ke sisi terpanjang itu (0.64) -- hasilnya scale
// default cuma ~1.2x, BUKAN 8x kayak FoldablePhone (dua komponen beda
// asal ukuran dasarnya, jangan disamain angka scale-nya). Kalau HP-nya
// masih kelihatan gak seukuran sama HP lipat pas dites di tangan
// karakter, INI SATU-SATUNYA ANGKA yang perlu diubah.
const BAR_TARGET_LONG_SIDE = 0.64
export const BAR_DEFAULT_SCALE = BAR_TARGET_LONG_SIDE / BAR_RAW_DIMS.h

export default function BarPhone({ variant, scale = BAR_DEFAULT_SCALE }) {
  const { scene } = useGLTF(variant.modelUrl)

  // Clone SEKALI per variant (biar tiap karakter yang equip HP yang
  // sama gak berbagi satu instance mesh yang sama persis -- three.js
  // gak suka satu Object3D dipasang di dua parent sekaligus).
  const cloned = useMemo(() => {
    const root = scene.clone(true)
    root.traverse((child) => {
      if (!child.isMesh) return
      // clone geometry juga (bukan cuma object3D) sebelum diotak-atik,
      // biar gak ikut ngubah cache asli punya useGLTF (dipakai bareng
      // semua instance BarPhone lain dengan variant yang sama).
      child.geometry = child.geometry.clone()
      if (!child.geometry.getAttribute('normal')) {
        child.geometry.computeVertexNormals()
      }
      child.material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        flatShading: true,
        roughness: 0.55,
        metalness: 0.15,
      })
      child.castShadow = false
      child.receiveShadow = false
    })
    return root
  }, [scene])

  // Bounding box asli gak mesti center-nya pas di titik acuan model
  // (tiap file .glb hasil scan/generate beda-beda titik nolnya) --
  // dihitung & digeser sekali di sini biar tiap varian nempel di posisi
  // yang SAMA relatif ke tangan (PHONE_OFFSET_POS di PhonePose.jsx),
  // gak perlu diatur manual satu-satu kayak dims per-varian di
  // phoneVariants.js.
  const centerOffset = useMemo(() => {
    const box = new THREE.Box3().setFromObject(cloned)
    const center = new THREE.Vector3()
    box.getCenter(center)
    return center.multiplyScalar(-1)
  }, [cloned])

  useEffect(() => () => {
    cloned.traverse((child) => {
      if (child.isMesh) {
        child.geometry.dispose()
        child.material.dispose()
      }
    })
  }, [cloned])

  return (
    <group scale={scale}>
      <group position={[centerOffset.x, centerOffset.y, centerOffset.z]}>
        <primitive object={cloned} />
      </group>
    </group>
  )
}

// Preload dipanggil dari phoneCatalog.js (preloadAllBarPhones) supaya
// pas user buka daftar HP di inventory, model udah kecache duluan --
// tanpa ini, HP baru "muncul" sepersekian detik setelah diequip
// (nunggu fetch .glb-nya kelar) tiap kali ganti-ganti varian bar.
BarPhone.preload = (modelUrl) => useGLTF.preload(modelUrl)
