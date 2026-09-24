import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html, useAnimations, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { PLAYER } from '../lib/walkController'
import { cloneSkinnedScene } from '../lib/skinnedClone'
import { getCharacterById, DEFAULT_CHARACTER_ID } from '../lib/characters'
import { ANIM_IDLE, ANIM_WALK, ANIM_RUN, ANIM_JUMP } from '../lib/walkNet'

// Pemain lain di mode Jelajahi (posisinya datang dari walkNet.js).
//
// Biar HP gak berat, yang benar-benar digambar cuma MAX_RENDERED pemain
// TERDEKAT (dihitung ulang tiap ~1 detik). Sisanya tetap "ada" di room
// (tetap kehitung di lencana "online"), cuma modelnya belum dimuat.
const MAX_RENDERED = 12
const RECOMPUTE_EVERY = 1 // detik
const SNAP_DISTANCE = 30 // selisih posisi segini -> langsung loncat (bukan digeser pelan)
const LABEL_MAX_DIST = 55 // nama cuma tampil kalau lebih dekat dari ini
const STALE_MS = 1500 // gak ada kabar segini lama -> animasi jalan dianggap berhenti

const ANIM_NAMES = { [ANIM_IDLE]: 'Idle', [ANIM_WALK]: 'Walk', [ANIM_RUN]: 'Run', [ANIM_JUMP]: 'Jump' }

function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI
  if (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

function RemotePlayer({ id, peersRef, selfRef, world }) {
  const peer0 = peersRef.current.get(id)
  const character = getCharacterById(peer0?.c) || getCharacterById(DEFAULT_CHARACTER_ID)
  const { scene: charScene, animations } = useGLTF(character.modelUrl)

  // Sama seperti karakter sendiri: clone manual (skinned mesh) + skala biar
  // tingginya PLAYER.height.
  const model = useMemo(() => {
    const m = cloneSkinnedScene(charScene)
    m.traverse((o) => {
      if (o.isSkinnedMesh) o.frustumCulled = false
    })
    return m
  }, [charScene])

  const scale = useMemo(() => {
    model.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(model)
    const h = box.max.y - box.min.y
    return h > 0.05 ? PLAYER.height / h : 0.53
  }, [model])

  const rootRef = useRef(null)
  const animRef = useRef(null)
  const shadowRef = useRef(null)
  const labelRef = useRef(null)
  const { actions } = useAnimations(animations, animRef)
  const st = useRef({ init: false, x: 0, y: 0, z: 0, yaw: 0, anim: -1 })

  useEffect(() => {
    const jump = actions?.Jump
    if (jump) {
      jump.setLoop(THREE.LoopOnce, 1)
      jump.clampWhenFinished = true
    }
  }, [actions])

  useFrame((_, delta) => {
    const peer = peersRef.current.get(id)
    const root = rootRef.current
    if (!peer || !root) {
      if (root) root.visible = false
      return
    }
    const s = st.current
    const dt = Math.min(delta, 0.1)

    // ---- posisi: geser halus ke posisi terakhir yang diterima ----------------
    if (!s.init) {
      s.x = peer.x
      s.y = peer.y
      s.z = peer.z
      s.yaw = peer.r
      s.init = true
    } else {
      const dx = peer.x - s.x
      const dy = peer.y - s.y
      const dz = peer.z - s.z
      if (Math.hypot(dx, dy, dz) > SNAP_DISTANCE) {
        s.x = peer.x
        s.y = peer.y
        s.z = peer.z
      } else {
        const k = 1 - Math.exp(-11 * dt)
        s.x += dx * k
        s.y += dy * k
        s.z += dz * k
      }
      s.yaw = lerpAngle(s.yaw, peer.r, 1 - Math.exp(-12 * dt))
    }
    root.visible = true
    root.position.set(s.x, s.y, s.z)
    root.rotation.y = s.yaw

    // ---- animasi ----------------------------------------------------------------
    const stale = performance.now() - peer.seen > STALE_MS
    const wanted = stale && peer.a !== ANIM_IDLE ? ANIM_IDLE : peer.a
    if (wanted !== s.anim) {
      const name = ANIM_NAMES[wanted] || 'Idle'
      const next = actions?.[name] || actions?.Idle
      const prev = s.anim >= 0 ? actions?.[ANIM_NAMES[s.anim]] : null
      if (next) {
        next.reset().fadeIn(0.15).play()
        if (prev && prev !== next) prev.fadeOut(0.15)
        next.timeScale = wanted === ANIM_JUMP ? 1.6 : 1
        s.anim = wanted
      }
    }

    // ---- bayangan bulat di tanah ---------------------------------------------------
    const shadow = shadowRef.current
    if (shadow) {
      const gy = world.groundY(s.x, s.z, s.y + 0.6)
      const base = gy === null ? s.y : gy
      const h = Math.max(0, s.y - base)
      const sc = Math.max(0.3, 1 - h * 0.25)
      shadow.position.set(s.x, base + 0.06, s.z)
      shadow.scale.set(sc, sc, sc)
      shadow.visible = true
    }

    // ---- nama cuma tampil kalau cukup dekat -------------------------------------------
    const label = labelRef.current
    const me = selfRef.current
    if (label && me) {
      const near = Math.hypot(s.x - me.x, s.z - me.z) < LABEL_MAX_DIST
      label.style.opacity = near ? '1' : '0'
    }
  })

  return (
    <>
      <group ref={rootRef} visible={false}>
        <group scale={scale}>
          <group ref={animRef}>
            <primitive object={model} />
          </group>
        </group>
        <Html position={[0, PLAYER.height + 0.3, 0]} center zIndexRange={[3, 0]} style={{ pointerEvents: 'none' }}>
          <div
            ref={labelRef}
            style={{
              padding: '2px 8px',
              borderRadius: 999,
              background: 'rgba(11, 18, 32, 0.62)',
              border: '1px solid rgba(234, 246, 255, 0.22)',
              color: '#eaf6ff',
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: 11,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              userSelect: 'none',
              transition: 'opacity 0.2s',
            }}
          >
            {peer0?.n || 'Warga'}
          </div>
        </Html>
      </group>
      <mesh ref={shadowRef} rotation-x={-Math.PI / 2} visible={false} renderOrder={2}>
        <circleGeometry args={[0.5, 20]} />
        <meshBasicMaterial
          color="#000000"
          transparent
          opacity={0.32}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-4}
          polygonOffsetUnits={-4}
        />
      </mesh>
    </>
  )
}

export default function RemotePlayers({ peersRef, peerIds, selfRef, world }) {
  const [visibleIds, setVisibleIds] = useState([])
  const acc = useRef(RECOMPUTE_EVERY) // langsung hitung di frame pertama
  const dirty = useRef(true)

  // Ada yang masuk/keluar -> hitung ulang di frame berikutnya.
  useEffect(() => {
    dirty.current = true
  }, [peerIds])

  useFrame((_, delta) => {
    acc.current += delta
    if (!dirty.current && acc.current < RECOMPUTE_EVERY) return
    acc.current = 0
    dirty.current = false

    const me = selfRef.current
    const list = []
    for (const [id, p] of peersRef.current) {
      const d = me ? Math.hypot(p.x - me.x, p.z - me.z) : 0
      list.push({ id, d })
    }
    list.sort((a, b) => a.d - b.d)
    const ids = list.slice(0, MAX_RENDERED).map((e) => e.id).sort()
    setVisibleIds((prev) => (prev.length === ids.length && prev.every((v, i) => v === ids[i]) ? prev : ids))
  })

  return (
    <>
      {visibleIds.map((id) => (
        // Suspense per pemain: model karakter yang belum dimuat gak boleh
        // nge-blank seluruh scene.
        <Suspense key={id} fallback={null}>
          <RemotePlayer id={id} peersRef={peersRef} selfRef={selfRef} world={world} />
        </Suspense>
      ))}
    </>
  )
}
