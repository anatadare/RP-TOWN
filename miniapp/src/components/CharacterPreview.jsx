import { Suspense, useEffect, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { useGLTF, useAnimations, Bounds } from '@react-three/drei'

// Model karakter Quaternius diekspor standar Y-up (beda dari model peta
// yang Z-up), jadi gak perlu AXIS_FIX_ROTATION kayak TownMap3D.
function CharacterModel({ url, animation, spin }) {
  const group = useRef()
  const { scene, animations } = useGLTF(url)
  const { actions } = useAnimations(animations, group)

  useEffect(() => {
    const action = actions?.[animation] || actions?.Idle || Object.values(actions || {})[0]
    action?.reset().fadeIn(0.25).play()
    return () => action?.fadeOut(0.25)
  }, [actions, animation])

  // Putar pelan-pelan di tempat biar kelihatan "hidup" tanpa perlu OrbitControls
  useFrame((_, delta) => {
    if (spin && group.current) group.current.rotation.y += delta * 0.5
  })

  return <primitive ref={group} object={scene} />
}

// Panel render 3D generik: dipakai buat carousel pilih karakter maupun hero
// di Landing. Pakai <Bounds> dari drei supaya kamera OTOMATIS nyesuain jarak
// & posisi ke ukuran badan tiap model -- tiap karakter Quaternius proporsinya
// beda-beda, jadi gak bisa pakai satu scale/posisi kamera yang di-hardcode
// (itu penyebab badannya kepotong sebelumnya). `key={modelUrl}` bikin Bounds
// nge-fit ulang tiap kali karakternya ganti.
export default function CharacterPreview({ modelUrl, animation = 'Idle', spin = true, className }) {
  if (!modelUrl) return null
  return (
    <div className={className}>
      <Canvas dpr={[1, 1.5]} camera={{ fov: 32 }}>
        <ambientLight intensity={0.9} />
        <directionalLight position={[3, 5, 4]} intensity={1.3} />
        <directionalLight position={[-3, 2, -4]} intensity={0.4} />
        <hemisphereLight args={['#8f8fd9', '#1b2340', 0.55]} />
        <Suspense fallback={null}>
          <Bounds key={modelUrl} fit clip margin={1.2}>
            <CharacterModel url={modelUrl} animation={animation} spin={spin} />
          </Bounds>
        </Suspense>
      </Canvas>
    </div>
  )
}
