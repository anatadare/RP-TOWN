import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'

// Bubble chat di atas kepala karakter (punya sendiri & pemain lain).
// Isi/tampil-sembunyinya diatur LANGSUNG ke DOM tiap frame dari bubblesRef
// (diisi walkNet.js tiap ada pesan masuk) -- jadi gak ada React re-render
// walau chat ramai. `id` = id pemain; kosong (null) = karakter sendiri
// (id-nya dibaca dari selfIdRef).
const SHOW_MS = 6000 // bubble tampil segini lama sejak pesan terakhir
const FADE_MS = 500
const MAX_DIST = 45 // lebih jauh dari ini bubble disembunyikan
const WORDS_PER_LINE = 7
const MAX_LINES = 5
const _v = new THREE.Vector3()

// Pecah teks: maks 7 kata per baris, maks 5 baris (lebihnya dipotong "…").
function formatBubble(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean)
  const lines = []
  for (let i = 0; i < words.length && lines.length < MAX_LINES; i += WORDS_PER_LINE) {
    lines.push(words.slice(i, i + WORDS_PER_LINE).join(' '))
  }
  if (words.length > WORDS_PER_LINE * MAX_LINES) lines[MAX_LINES - 1] += '…'
  return lines.join('\n')
}

export default function ChatBubble3D({ bubblesRef, id = null, selfIdRef = null, y }) {
  const { camera } = useThree()
  const groupRef = useRef(null)
  const boxRef = useRef(null)
  const textRef = useRef(null)
  const lastKey = useRef(null)

  useFrame(() => {
    const box = boxRef.current
    const g = groupRef.current
    if (!box || !g) return
    const key = id ?? selfIdRef?.current ?? null
    const e = key ? bubblesRef.current.get(key) : null
    const age = e ? performance.now() - e.ts : Infinity
    if (!e || age > SHOW_MS + FADE_MS) {
      if (box.style.opacity !== '0') box.style.opacity = '0'
      return
    }
    g.getWorldPosition(_v)
    if (_v.distanceTo(camera.position) > MAX_DIST) {
      box.style.opacity = '0'
      return
    }
    if (lastKey.current !== e.k && textRef.current) {
      textRef.current.textContent = formatBubble(e.x)
      lastKey.current = e.k
    }
    box.style.opacity = age > SHOW_MS ? String(1 - (age - SHOW_MS) / FADE_MS) : '1'
  })

  return (
    <group ref={groupRef} position={[0, y, 0]}>
      <Html center zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}>
        <div ref={boxRef} className="walk-bubble" style={{ opacity: 0 }}>
          <span ref={textRef} />
        </div>
      </Html>
    </group>
  )
}
