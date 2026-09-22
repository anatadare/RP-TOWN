import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useGLTF, useAnimations } from '@react-three/drei'
import * as THREE from 'three'
import { MAPS } from '../lib/maps'
import { buildWalkWorld, ROAD_LIFT } from '../lib/walkWorld'
import { createPlayer, stepPlayer, PLAYER } from '../lib/walkController'
import { lockTelegramSwipe, unlockTelegramSwipe, hapticSelect } from '../lib/telegram'

// Model karakter (Quaternius) punya skinned mesh + skeleton (tulang buat
// animasi jalan/lari/lompat). `Object3D.clone()` bawaan three.js nge-clone
// hierarki node-nya tapi TIDAK ngikutin ulang skeleton (bone) ke mesh yang
// baru -- semua clone bakal numpuk gerak di 1 skeleton yang sama (skeleton
// aslinya, gak ke-clone). Makanya perlu clone manual: clone tiap node satu-
// satu (barengan, node asli & node clone jalan bareng), baru abis itu tiap
// SkinnedMesh di-"pasang ulang" (bind) ke skeleton HASIL CLONE-nya sendiri.
//
// (Sengaja ditulis sendiri di sini, bukan import dari
// 'three/examples/jsm/utils/SkeletonUtils.js', soalnya path itu gampang gak
// ke-resolve pas `vite build` di beberapa versi three -- import dalem kayak
// gitu gak dijamin ada di 'exports' map package.json-nya, jadi bikin build
// production gagal walau di `npm run dev` lokal keliatan baik-baik saja.)
function cloneSkinnedScene(source) {
  const cloneOf = new Map()
  const root = source.clone()

  // Jalan bareng: node asli ke-N ketemu node hasil clone ke-N (urutan children
  // dijamin sama persis karena baru aja di-clone dari source yang sama).
  ;(function walkTogether(a, b) {
    cloneOf.set(a, b)
    for (let i = 0; i < a.children.length; i++) walkTogether(a.children[i], b.children[i])
  })(source, root)

  source.traverse((node) => {
    if (!node.isSkinnedMesh) return
    const cloned = cloneOf.get(node)
    cloned.skeleton = node.skeleton.clone()
    cloned.skeleton.bones = node.skeleton.bones.map((bone) => cloneOf.get(bone))
    cloned.bind(cloned.skeleton, node.bindMatrix)
  })

  return root
}

// Mode "Jelajahi": jalan-jalan langsung di dalam peta 3D (third-person)
// pakai karakter yang dipilih warga. Bisa jalan, lari, dan lompat.
//
//  - walkWorld.js      : bangun tanah + tembok + batang pohon dari data .glb
//  - walkController.js : fisika karakter (murni JS, sudah dites di Node)
//  - file ini          : jembatan ke three.js/React + kontrol sentuh/keyboard

// Sama seperti TownMap3D: file peta diekspor Z-up, diputar -90 derajat di X.
const AXIS_FIX = -Math.PI / 2

// Urutan penting: 'TPX_RoadsOutlines' harus dicek sebelum 'TPX_Roads'.
const GROUP_PREFIXES = ['TPX_RoadsOutlines', 'TPX_Roads', 'TPX_Buildings', 'TPX_Waterways', 'TPX_Trees', 'TPX_GreenAreas']

// Batang pohon = mesh kecil (32 vertex); tajuk = mesh besar (128 vertex).
const TRUNK_MAX_VERTS = 40

const CAM_MIN_DIST = 2.5
const CAM_MAX_DIST = 16
const CAM_DEFAULT_DIST = 6.5
const CAM_MIN_PITCH = 0.04
const CAM_MAX_PITCH = 1.25
const CAM_DEFAULT_PITCH = 0.42

const JOY_RADIUS = 54 // px, jarak geser maksimum knob joystick

function groupOf(obj) {
  for (let o = obj; o; o = o.parent) {
    const n = o.name || ''
    for (const p of GROUP_PREFIXES) if (n.startsWith(p)) return p
  }
  return null
}

// Langit mengikuti jam dunia yang sama dengan `getWorldPhase` di App.jsx.
function getSky() {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 11) return { color: '#a9d4ff', sun: 1.15, ambient: 0.75, hemi: ['#dbeeff', '#6f8f6a'] }
  if (hour >= 11 && hour < 16) return { color: '#8cc4f5', sun: 1.3, ambient: 0.8, hemi: ['#d6ecff', '#6f8f6a'] }
  if (hour >= 16 && hour < 19) return { color: '#f2a273', sun: 1.0, ambient: 0.6, hemi: ['#ffd2b0', '#5a5a6e'] }
  return { color: '#1b2340', sun: 0.55, ambient: 0.6, hemi: ['#6b7fd9', '#232a45'] }
}

// ---------------------------------------------------------------------------
// Baca segitiga dari scene (koordinat dunia) buat dunia tabrakan.
// ---------------------------------------------------------------------------
function extractWorldData(root) {
  const out = { water: [], green: [], roads: [], buildings: [], trunks: [] }
  const targets = {
    TPX_Waterways: out.water,
    TPX_GreenAreas: out.green,
    TPX_RoadsOutlines: out.roads,
    TPX_Buildings: out.buildings,
  }
  const tmp = new THREE.Vector3()

  root.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry) return
    const grp = groupOf(obj)
    if (!grp) return
    const pos = obj.geometry.getAttribute('position')
    if (!pos) return

    const world = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) {
      tmp.fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld)
      world[i * 3] = tmp.x
      world[i * 3 + 1] = tmp.y
      world[i * 3 + 2] = tmp.z
    }

    if (grp === 'TPX_Trees') {
      if (pos.count > TRUNK_MAX_VERTS) return // tajuk: tembus
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity
      for (let i = 0; i < world.length; i += 3) {
        minX = Math.min(minX, world[i]); maxX = Math.max(maxX, world[i])
        minY = Math.min(minY, world[i + 1]); maxY = Math.max(maxY, world[i + 1])
        minZ = Math.min(minZ, world[i + 2]); maxZ = Math.max(maxZ, world[i + 2])
      }
      out.trunks.push({
        x: (minX + maxX) / 2,
        z: (minZ + maxZ) / 2,
        r: Math.max(maxX - minX, maxZ - minZ) / 2,
        y0: minY,
        y1: maxY,
      })
      return
    }

    const target = targets[grp]
    if (!target) return
    const idx = obj.geometry.index
    const n = idx ? idx.count : pos.count
    for (let k = 0; k < n; k++) {
      const v = idx ? idx.getX(k) : k
      target.push(world[v * 3], world[v * 3 + 1], world[v * 3 + 2])
    }
  })

  return {
    water: Float32Array.from(out.water),
    green: Float32Array.from(out.green),
    roads: Float32Array.from(out.roads),
    buildings: Float32Array.from(out.buildings),
    trunks: out.trunks,
  }
}

// ---------------------------------------------------------------------------
// Siapkan salinan scene peta khusus mode jalan. `scene` dari useGLTF di-cache
// & dipakai bareng TownMap3D (yang memodifikasinya), jadi di sini SELALU
// bekerja di salinan (clone) supaya peta tampilan luar gak ikut berubah.
// ---------------------------------------------------------------------------
function prepareWalkScene(scene) {
  const root = scene.clone(true)
  root.position.set(0, 0, 0)
  root.scale.set(1, 1, 1)
  root.rotation.set(AXIS_FIX, 0, 0)
  root.updateMatrixWorld(true)

  // data tabrakan dibaca SEBELUM modifikasi visual di bawah
  const data = extractWorldData(root)

  let groundColor = null
  const waterMat = new THREE.MeshStandardMaterial({
    color: '#3b9be0',
    roughness: 0.35,
    metalness: 0,
    flatShading: true,
    transparent: true,
    opacity: 0.88,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  })
  const canopies = []
  const lift = new THREE.Vector3()
  const box = new THREE.Box3()
  const c = new THREE.Vector3()
  const s = new THREE.Vector3()

  root.traverse((obj) => {
    if (obj.isLine) {
      obj.visible = false // garis pusat jalan: gak perlu
      return
    }
    if (!obj.isMesh) return
    const grp = groupOf(obj)

    if (grp === 'TPX_Waterways') {
      obj.visible = true // TownMap3D menyembunyikannya di scene cache
      obj.material = waterMat
    } else if (grp === 'TPX_RoadsOutlines') {
      // jalan diangkat ROAD_LIFT (di ruang dunia) -- harus sama dengan fisikanya
      if (obj.parent) {
        const inv = new THREE.Matrix4().copy(obj.parent.matrixWorld).invert()
        const a = new THREE.Vector3(0, 0, 0).applyMatrix4(inv)
        lift.set(0, ROAD_LIFT, 0).applyMatrix4(inv).sub(a)
        obj.position.add(lift)
      }
      obj.material = obj.material.clone()
      obj.material.polygonOffset = true
      obj.material.polygonOffsetFactor = -2
      obj.material.polygonOffsetUnits = -2
    } else if (grp === 'TPX_Buildings') {
      obj.material = obj.material.clone()
      if (obj.material.emissive) obj.material.emissive.set('#000000')
      obj.material.emissiveIntensity = 0
    } else if (grp === 'TPX_GreenAreas') {
      if (!groundColor && obj.material?.color) groundColor = obj.material.color.clone()
    } else if (grp === 'TPX_Trees') {
      const count = obj.geometry?.getAttribute('position')?.count || 0
      if (count > TRUNK_MAX_VERTS) {
        // tajuk pohon: dibikin memudar kalau kamera/karakter ada di dalamnya
        obj.material = obj.material.clone()
        box.setFromObject(obj)
        box.getCenter(c)
        box.getSize(s)
        canopies.push({ mat: obj.material, x: c.x, y: c.y, z: c.z, r: Math.max(s.x, s.y, s.z) / 2, op: 1 })
      }
    }
  })
  root.updateMatrixWorld(true)

  return { root, data, canopies, groundColor: groundColor || new THREE.Color('#8ad384') }
}

// ---------------------------------------------------------------------------
// Karakter + fisika + kamera. Semua di satu useFrame supaya urutannya pasti:
// input -> fisika -> posisi model -> animasi -> kamera.
// ---------------------------------------------------------------------------
function WalkPlayer({ world, spawn, character, inputRef, canopies, onReady }) {
  const { scene: charScene, animations } = useGLTF(character.modelUrl)
  const { camera } = useThree()

  // Model karakter di-clone (SkeletonUtils, karena skinned mesh) supaya gak
  // rebutan objek dengan preview di layar Beranda.
  const model = useMemo(() => {
    const m = cloneSkinnedScene(charScene)
    m.traverse((o) => {
      if (o.isSkinnedMesh) o.frustumCulled = false
    })
    return m
  }, [charScene])

  // Model Quaternius ~3.3 satuan tinggi; peta ~1 satuan = 1 meter. Skala
  // dihitung dari ukuran aslinya biar semua karakter setinggi PLAYER.height.
  const scale = useMemo(() => {
    model.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(model)
    const h = box.max.y - box.min.y
    return h > 0.05 ? PLAYER.height / h : 0.53
  }, [model])

  const rootRef = useRef(null)
  const animRef = useRef(null)
  const shadowRef = useRef(null)
  const { actions } = useAnimations(animations, animRef)
  const stateRef = useRef(null)

  const init = useCallback(() => {
    const inp = inputRef.current
    // kamera awal menghadap ke tengah peta
    const cx = (world.bounds.minX + world.bounds.maxX) / 2
    const cz = (world.bounds.minZ + world.bounds.maxZ) / 2
    const dx = cx - spawn.x, dz = cz - spawn.z
    inp.yaw = Math.hypot(dx, dz) > 1 ? Math.atan2(-dx, -dz) : 0
    inp.pitch = CAM_DEFAULT_PITCH
    inp.dist = CAM_DEFAULT_DIST
    return {
      p: createPlayer(spawn.x, spawn.y, spawn.z, Math.atan2(-Math.sin(inp.yaw), -Math.cos(inp.yaw))),
      tx: spawn.x,
      ty: spawn.y + 1.35,
      tz: spawn.z,
      curDist: CAM_DEFAULT_DIST,
      anim: null,
      ready: false,
    }
  }, [world, spawn, inputRef])

  // Jump cuma dimainkan sekali (bukan loop); sisanya loop biasa.
  useEffect(() => {
    const jump = actions?.Jump
    if (jump) {
      jump.setLoop(THREE.LoopOnce, 1)
      jump.clampWhenFinished = true
    }
  }, [actions])

  useFrame((_, delta) => {
    if (!stateRef.current) stateRef.current = init()
    const s = stateRef.current
    const inp = inputRef.current
    let p = s.p

    if (inp.reset) {
      inp.reset = false
      stateRef.current = init()
      return
    }

    // ---- input -> fisika ----------------------------------------------------
    let mx = inp.joyX + inp.kbX
    let my = inp.joyY + inp.kbY
    const len = Math.hypot(mx, my)
    if (len > 1) {
      mx /= len
      my /= len
    }
    inp.moveX = mx
    inp.moveY = my

    let jumpedNow = false
    let remaining = Math.min(delta, 0.1)
    while (remaining > 1e-4) {
      const h = Math.min(remaining, 1 / 60)
      stepPlayer(p, inp, h, world, inp.yaw)
      jumpedNow = jumpedNow || p.justJumped
      remaining -= h
    }

    // jatuh ke tempat aneh / nilai rusak -> balik ke titik lahir
    if (!isFinite(p.x + p.y + p.z) || p.y < world.waterLevel - 40) {
      stateRef.current = init()
      return
    }

    // ---- posisi & arah model ---------------------------------------------------
    const root = rootRef.current
    if (root) {
      root.position.set(p.x, p.y, p.z)
      root.rotation.y = p.yaw
    }

    // ---- animasi ----------------------------------------------------------------
    let next = 'Idle'
    if (jumpedNow || (!p.grounded && p.airTime > 0.12)) next = 'Jump'
    else if (p.speed > 5.4) next = 'Run'
    else if (p.speed > 0.6) next = 'Walk'
    if (next !== s.anim || jumpedNow) {
      const nextAction = actions?.[next] || actions?.Idle
      const prevAction = s.anim ? actions?.[s.anim] : null
      if (nextAction) {
        nextAction.reset().fadeIn(0.15).play()
        if (prevAction && prevAction !== nextAction) prevAction.fadeOut(0.15)
        s.anim = next
      }
    }
    const act = actions?.[s.anim]
    if (act) {
      if (s.anim === 'Walk') act.timeScale = THREE.MathUtils.clamp(p.speed / 3.6, 0.6, 1.5)
      else if (s.anim === 'Run') act.timeScale = THREE.MathUtils.clamp(p.speed / 6.5, 0.8, 1.3)
      else if (s.anim === 'Jump') act.timeScale = 1.6
      else act.timeScale = 1
    }

    // ---- bayangan bulat di tanah -------------------------------------------------
    const shadow = shadowRef.current
    if (shadow) {
      const gy = world.groundY(p.x, p.z, p.y + 0.6)
      const base = gy === null ? p.y : gy
      const h = Math.max(0, p.y - base)
      const sc = Math.max(0.3, 1 - h * 0.25)
      shadow.position.set(p.x, base + 0.06, p.z)
      shadow.scale.set(sc, sc, sc)
      shadow.visible = true
    }

    // ---- kamera orbit third-person --------------------------------------------------
    const kx = 1 - Math.exp(-14 * delta)
    const ky = 1 - Math.exp(-7 * delta)
    s.tx += (p.x - s.tx) * kx
    s.tz += (p.z - s.tz) * kx
    s.ty += (p.y + 1.35 - s.ty) * ky

    const cp = Math.cos(inp.pitch)
    const dirX = Math.sin(inp.yaw) * cp
    const dirY = Math.sin(inp.pitch)
    const dirZ = Math.cos(inp.yaw) * cp
    const dist = inp.dist
    const yLow = Math.min(s.ty, s.ty + dirY * dist) - 0.2
    const yHigh = Math.max(s.ty, s.ty + dirY * dist) + 0.2
    const hit = world.castWalls2D(s.tx, s.tz, s.tx + dirX * dist, s.tz + dirZ * dist, yLow, yHigh)
    const hLen = Math.max(0.5, dist * cp)
    const wantedDist = hit >= 1 ? dist : dist * Math.max(0.12, hit - 0.35 / hLen)
    // mendekat (kena tembok) langsung, menjauh pelan-pelan biar gak "loncat"
    s.curDist =
      wantedDist < s.curDist ? wantedDist : s.curDist + (wantedDist - s.curDist) * (1 - Math.exp(-3 * delta))
    s.curDist = Math.min(s.curDist, dist)

    let camX = s.tx + dirX * s.curDist
    let camY = s.ty + dirY * s.curDist
    let camZ = s.tz + dirZ * s.curDist
    const groundUnderCam = world.groundY(camX, camZ, camY + 3)
    if (groundUnderCam !== null && camY < groundUnderCam + 0.45) camY = groundUnderCam + 0.45
    camera.position.set(camX, camY, camZ)
    camera.lookAt(s.tx, s.ty, s.tz)

    // ---- tajuk pohon memudar kalau kamera/kepala di dalamnya ------------------------
    const headY = p.y + PLAYER.height
    for (let i = 0; i < canopies.length; i++) {
      const c = canopies[i]
      const px = p.x - c.x, pz = p.z - c.z
      if (px * px + pz * pz > (c.r + 12) * (c.r + 12) && c.op >= 0.999) continue
      const cx2 = camX - c.x, cy2 = camY - c.y, cz2 = camZ - c.z
      const hx = p.x - c.x, hy = headY - c.y, hz = p.z - c.z
      const rr = c.r * c.r * 0.9
      const inside = cx2 * cx2 + cy2 * cy2 + cz2 * cz2 < rr || hx * hx + hy * hy + hz * hz < rr
      const target = inside ? 0.25 : 1
      if (Math.abs(c.op - target) < 0.005) continue
      c.op += (target - c.op) * Math.min(1, delta * 8)
      const transparent = c.op < 0.999
      c.mat.opacity = c.op
      if (c.mat.transparent !== transparent) {
        c.mat.transparent = transparent
        c.mat.depthWrite = !transparent
        c.mat.needsUpdate = true
      }
    }

    if (!s.ready) {
      s.ready = true
      onReady()
    }
  })

  return (
    <>
      <group ref={rootRef}>
        <group scale={scale}>
          <group ref={animRef}>
            <primitive object={model} />
          </group>
        </group>
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

// ---------------------------------------------------------------------------
// Isi scene: peta (salinan), tanah buatan, laut, dan pemain.
// ---------------------------------------------------------------------------
function WalkScene({ modelUrl, character, inputRef, sky, onReady }) {
  const { scene } = useGLTF(modelUrl)
  const built = useMemo(() => prepareWalkScene(scene), [scene])
  const world = useMemo(() => buildWalkWorld(built.data), [built])
  const spawn = useMemo(() => world.findSpawn(), [world])

  const groundGeo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(world.groundMesh.positions, 3))
    g.setIndex(new THREE.BufferAttribute(world.groundMesh.indices, 1))
    g.computeVertexNormals()
    g.computeBoundingSphere()
    return g
  }, [world])

  const span = Math.max(world.bounds.maxX - world.bounds.minX, world.bounds.maxZ - world.bounds.minZ)
  const cx = (world.bounds.minX + world.bounds.maxX) / 2
  const cz = (world.bounds.minZ + world.bounds.maxZ) / 2

  return (
    <>
      <fog attach="fog" args={[sky.color, 110, Math.max(520, span * 1.3)]} />
      <primitive object={built.root} />
      <mesh geometry={groundGeo}>
        <meshStandardMaterial
          color={built.groundColor}
          roughness={0.9}
          metalness={0}
          flatShading
          polygonOffset
          polygonOffsetFactor={2}
          polygonOffsetUnits={2}
        />
      </mesh>
      {/* laut sampai cakrawala, sedikit di bawah mesh Waterways */}
      <mesh rotation-x={-Math.PI / 2} position={[cx, world.waterLevel - 0.12, cz]}>
        <planeGeometry args={[span * 10, span * 10]} />
        <meshBasicMaterial color="#2b86c9" />
      </mesh>
      <WalkPlayer
        world={world}
        spawn={spawn}
        character={character}
        inputRef={inputRef}
        canopies={built.canopies}
        onReady={onReady}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// Kontrol: joystick melayang (sentuh kiri), geser kanan = putar kamera,
// tombol lompat, plus keyboard (WASD/panah, Shift lari, Spasi lompat) &
// mouse (drag = putar kamera, roda = zoom) buat dites di desktop.
// ---------------------------------------------------------------------------
function WalkControls({ inputRef }) {
  const zoneRef = useRef(null)
  const baseRef = useRef(null)
  const knobRef = useRef(null)
  const pointers = useRef(new Map()) // pointerId -> { role, x, y, ox, oy }

  useEffect(() => {
    const keys = new Set()
    function sync() {
      const inp = inputRef.current
      const x = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0)
      const y = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0)
      const l = Math.hypot(x, y) || 1
      const gain = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 1 : 0.62
      inp.kbX = (x / l) * gain
      inp.kbY = (y / l) * gain
    }
    function onDown(e) {
      if (e.code === 'Space') {
        e.preventDefault()
        if (!e.repeat) inputRef.current.jump = true
        return
      }
      keys.add(e.code)
      sync()
    }
    function onUp(e) {
      keys.delete(e.code)
      sync()
    }
    function onBlur() {
      keys.clear()
      sync()
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [inputRef])

  function showJoystick(ox, oy) {
    const zone = zoneRef.current
    const base = baseRef.current
    if (!zone || !base) return
    const rect = zone.getBoundingClientRect()
    base.style.left = `${ox - rect.left}px`
    base.style.top = `${oy - rect.top}px`
    base.style.opacity = '1'
    if (knobRef.current) knobRef.current.style.transform = 'translate(-50%, -50%)'
  }

  function hideJoystick() {
    if (baseRef.current) baseRef.current.style.opacity = '0'
    inputRef.current.joyX = 0
    inputRef.current.joyY = 0
  }

  function handleDown(e) {
    const zone = zoneRef.current
    if (!zone) return
    zone.setPointerCapture(e.pointerId)
    const rect = zone.getBoundingClientRect()
    // sentuhan di 45% kiri layar = joystick; sisanya (dan semua klik mouse) = kamera
    const isMove = e.pointerType !== 'mouse' && e.clientX - rect.left < rect.width * 0.45
    const hasMove = [...pointers.current.values()].some((v) => v.role === 'move')
    const role = isMove && !hasMove ? 'move' : 'look'
    pointers.current.set(e.pointerId, { role, x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY })
    if (role === 'move') showJoystick(e.clientX, e.clientY)
  }

  function handleMove(e) {
    const ptr = pointers.current.get(e.pointerId)
    if (!ptr) return
    const inp = inputRef.current
    if (ptr.role === 'move') {
      let dx = e.clientX - ptr.ox
      let dy = e.clientY - ptr.oy
      const l = Math.hypot(dx, dy)
      if (l > JOY_RADIUS) {
        dx = (dx / l) * JOY_RADIUS
        dy = (dy / l) * JOY_RADIUS
      }
      inp.joyX = dx / JOY_RADIUS
      inp.joyY = -dy / JOY_RADIUS
      if (knobRef.current) knobRef.current.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`
    } else {
      const dx = e.clientX - ptr.x
      const dy = e.clientY - ptr.y
      ptr.x = e.clientX
      ptr.y = e.clientY
      inp.yaw -= dx * 0.0055
      inp.pitch = THREE.MathUtils.clamp(inp.pitch + dy * 0.004, CAM_MIN_PITCH, CAM_MAX_PITCH)
    }
  }

  function handleUp(e) {
    const ptr = pointers.current.get(e.pointerId)
    if (!ptr) return
    pointers.current.delete(e.pointerId)
    if (ptr.role === 'move') hideJoystick()
  }

  function handleWheel(e) {
    const inp = inputRef.current
    inp.dist = THREE.MathUtils.clamp(inp.dist * Math.exp(e.deltaY * 0.001), CAM_MIN_DIST, CAM_MAX_DIST)
  }

  return (
    <>
      <div
        ref={zoneRef}
        className="walk-zone"
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleUp}
        onWheel={handleWheel}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div ref={baseRef} className="walk-joy-base">
          <div ref={knobRef} className="walk-joy-knob" />
        </div>
      </div>
      <button
        type="button"
        className="walk-jump"
        aria-label="Lompat"
        onPointerDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          inputRef.current.jump = true
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
          <path d="M12 19V6M6 11.5l6-6 6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>Lompat</span>
      </button>
    </>
  )
}

// ---------------------------------------------------------------------------
// Komponen utama
// ---------------------------------------------------------------------------
export default function TownWalk({ mapKey, mapName, modelUrl, character, onExit, onChangeMap }) {
  const inputRef = useRef(null)
  if (!inputRef.current) {
    inputRef.current = {
      joyX: 0, joyY: 0, kbX: 0, kbY: 0,
      moveX: 0, moveY: 0,
      jump: false, reset: false,
      yaw: 0, pitch: CAM_DEFAULT_PITCH, dist: CAM_DEFAULT_DIST,
    }
  }
  const sky = useMemo(getSky, [])
  const [ready, setReady] = useState(false)
  const [showHint, setShowHint] = useState(true)
  const handleReady = useCallback(() => setReady(true), [])

  // Ganti peta = Canvas remount (key) -> tampilkan loading lagi.
  useEffect(() => {
    setReady(false)
    setShowHint(true)
    const t = setTimeout(() => setShowHint(false), 6000)
    return () => clearTimeout(t)
  }, [mapKey])

  // Geser vertikal di Telegram bisa nutup/minimize mini app -- matikan selama
  // mode jalan, karena geser ke bawah dipakai buat mutar kamera.
  useEffect(() => {
    lockTelegramSwipe()
    return unlockTelegramSwipe
  }, [])

  function zoom(delta) {
    hapticSelect()
    const inp = inputRef.current
    inp.dist = THREE.MathUtils.clamp(inp.dist + delta, CAM_MIN_DIST, CAM_MAX_DIST)
  }

  return (
    <div className="walk-root">
      <Canvas
        key={mapKey}
        dpr={[1, 1.5]}
        camera={{ fov: 55, near: 0.3, far: 4000 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
      >
        <color attach="background" args={[sky.color]} />
        <ambientLight intensity={sky.ambient} />
        <hemisphereLight args={[sky.hemi[0], sky.hemi[1], 0.55]} />
        <directionalLight position={[80, 140, 60]} intensity={sky.sun} />
        <Suspense fallback={null}>
          <WalkScene
            modelUrl={modelUrl}
            character={character}
            inputRef={inputRef}
            sky={sky}
            onReady={handleReady}
          />
        </Suspense>
      </Canvas>

      <WalkControls inputRef={inputRef} />

      <div className="walk-topbar">
        <button type="button" className="walk-pill-btn" onClick={onExit}>
          ← Keluar
        </button>
        <div className="map-switcher walk-map-switcher">
          {MAPS.map((m) => (
            <button
              key={m.key}
              type="button"
              className={`map-switcher-item${m.key === mapKey ? ' is-active' : ''}`}
              onClick={() => {
                if (m.key === mapKey) return
                hapticSelect()
                onChangeMap(m.key)
              }}
            >
              {m.name}
            </button>
          ))}
        </div>
      </div>

      <div className="walk-side">
        <button type="button" className="walk-round-btn" aria-label="Zoom dekat" onClick={() => zoom(-1.5)}>
          +
        </button>
        <button type="button" className="walk-round-btn" aria-label="Zoom jauh" onClick={() => zoom(1.5)}>
          −
        </button>
        <button
          type="button"
          className="walk-round-btn"
          aria-label="Balik ke titik awal"
          onClick={() => {
            hapticSelect()
            inputRef.current.reset = true
          }}
        >
          ↺
        </button>
      </div>

      {showHint && ready && (
        <p className="walk-hint">Geser kiri = jalan · Geser kanan = putar kamera · Tombol lompat di kanan bawah</p>
      )}

      {!ready && (
        <div className="walk-loading">
          <p>Menyiapkan {mapName || 'peta'}…</p>
        </div>
      )}
    </div>
  )
}
