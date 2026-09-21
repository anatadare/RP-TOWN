import { Suspense, useEffect, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { useGLTF, useAnimations, Bounds } from '@react-three/drei'

// Model karakter Quaternius diekspor standar Y-up (beda dari model peta
// yang Z-up), jadi gak perlu AXIS_FIX_ROTATION kayak TownMap3D.
function CharacterModel({ url, animation, spin, rotationRef }) {
  const group = useRef()
  const { scene, animations } = useGLTF(url)
  const { actions } = useAnimations(animations, group)

  useEffect(() => {
    const action = actions?.[animation] || actions?.Idle || Object.values(actions || {})[0]
    action?.reset().fadeIn(0.25).play()
    return () => action?.fadeOut(0.25)
  }, [actions, animation])

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

  return <primitive ref={group} object={scene} />
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
            />
          </Bounds>
        </Suspense>
      </Canvas>
    </div>
  )
}
