import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { useGLTF, useAnimations, Bounds } from '@react-three/drei'
import { cloneSkinnedScene } from '../lib/skinnedClone'
import { applyPhonePose, LowPolyPhone } from './PhonePose'

// Model karakter Quaternius diekspor standar Y-up (beda dari model peta
// yang Z-up), jadi gak perlu AXIS_FIX_ROTATION kayak TownMap3D.
//
// `pose="phone"`: mode statis (BUKAN animasi) -- karakter dibekukan di
// bind pose lalu lengan kanannya ditekuk manual (lihat PhonePose.jsx),
// terus HP low-poly di-attach ke tangannya. Scene di-clone dulu (lewat
// cloneSkinnedScene, sama kayak yang dipakai TownWalk) supaya bone yang
// kita tekuk gak numpuk ke cache useGLTF bareng -- kalau gak di-clone,
// karakter yang sama bakal "ke-bawa" lengan bengkok ini pas dipreview
// di tempat lain yang animasi biasa.
function CharacterModel({ url, animation, spin, rotationRef, pose }) {
  const group = useRef()
  const phoneGroup = useRef()
  const { scene: cachedScene, animations } = useGLTF(url)

  const scene = useMemo(
    () => (pose === 'phone' ? cloneSkinnedScene(cachedScene) : cachedScene),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cachedScene, pose === 'phone']
  )

  const { actions } = useAnimations(animations, group)

  useEffect(() => {
    if (pose === 'phone') return undefined // bind pose statis, gak main animasi
    const action = actions?.[animation] || actions?.Idle || Object.values(actions || {})[0]
    action?.reset().fadeIn(0.25).play()
    return () => action?.fadeOut(0.25)
  }, [actions, animation, pose])

  // Tekuk lengan + attach HP -- sekali aja tiap kali scene (hasil clone)
  // berubah, bukan tiap frame (posenya statis, gak perlu diulang-ulang).
  useEffect(() => {
    if (pose !== 'phone') return
    const fist = applyPhonePose(scene)
    if (fist && phoneGroup.current) fist.add(phoneGroup.current)
    return () => {
      if (fist && phoneGroup.current) fist.remove(phoneGroup.current)
    }
  }, [pose, scene])

  useFrame((_, delta) => {
    if (!group.current) return
    // Mode drag manual (dipakai di Landing): rotation-nya didikte penuh sama
    // rotationRef yang diupdate lewat pointer event, bukan auto-spin.
    if (rotationRef) {
      group.current.rotation.y = rotationRef.current
      return
    }
    // Mode lama: putar pelan-pelan otomatis di tempat (dipakai CharacterSelect)
    if (spin) group.current.rotation.y += delta * 0.5
  })

  return (
    <primitive ref={group} object={scene}>
      {pose === 'phone' && (
        <group ref={phoneGroup}>
          <LowPolyPhone />
        </group>
      )}
    </primitive>
  )
}

// Panel render 3D generik: dipakai buat carousel pilih karakter maupun hero
// di Landing. Pakai <Bounds> dari drei supaya kamera OTOMATIS nyesuain jarak
// & posisi ke ukuran badan tiap model -- tiap karakter Quaternius proporsinya
// beda-beda, jadi gak bisa pakai satu scale/posisi kamera yang di-hardcode
// (itu penyebab badannya kepotong sebelumnya). `key={modelUrl}` bikin Bounds
// nge-fit ulang tiap kali karakternya ganti.
//
// `draggable`: kalau true, karakter gak auto-spin -- user geser jari/mouse
// kiri-kanan buat muter badan karakter di tempat (dipakai di layar Beranda
// buat preview full-body).
export default function CharacterPreview({
  modelUrl,
  animation = 'Idle',
  spin = true,
  draggable = false,
  className,
  // 'phone' = pose statis megang HP (lihat PhonePose.jsx), gantiin animasi.
  pose,
}) {
  const rotationRef = useRef(0)
  const dragState = useRef({ dragging: false, startX: 0, startRotation: 0 })

  function getClientX(e) {
    if (typeof e.clientX === 'number') return e.clientX
    return e.touches?.[0]?.clientX ?? e.changedTouches?.[0]?.clientX ?? 0
  }

  function handlePointerDown(e) {
    if (!draggable) return
    dragState.current.dragging = true
    dragState.current.startX = getClientX(e)
    dragState.current.startRotation = rotationRef.current
  }

  function handlePointerMove(e) {
    if (!draggable || !dragState.current.dragging) return
    const deltaX = getClientX(e) - dragState.current.startX
    // ~300px geser penuh = 1 putaran (2*PI radian)
    rotationRef.current = dragState.current.startRotation + (deltaX / 300) * Math.PI * 2
  }

  function handlePointerUp() {
    dragState.current.dragging = false
  }

  if (!modelUrl) return null

  return (
    <div
      className={className}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={draggable ? { touchAction: 'none', cursor: 'grab' } : undefined}
    >
      <Canvas dpr={[1, 1.5]} camera={{ fov: 32 }}>
        <ambientLight intensity={0.9} />
        <directionalLight position={[3, 5, 4]} intensity={1.3} />
        <directionalLight position={[-3, 2, -4]} intensity={0.4} />
        <hemisphereLight args={['#8f8fd9', '#0b1220', 0.55]} />
        <Suspense fallback={null}>
          <Bounds key={modelUrl} fit clip margin={1.2}>
            <CharacterModel
              url={modelUrl}
              animation={animation}
              spin={spin}
              rotationRef={draggable ? rotationRef : null}
              pose={pose}
            />
          </Bounds>
        </Suspense>
      </Canvas>
    </div>
  )
}
