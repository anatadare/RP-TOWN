import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { unassignBuilding, createRoomForBuilding } from '../lib/rooms'
import { MAPS } from '../lib/maps'
import { BUILDING_PREFIX } from '../lib/buildings'

// Warna highlight
const COLOR_ASSIGNED = '#ffb454' // lantern, bangunan yang sudah jadi room
const COLOR_HOVER_ASSIGNED = '#ffd699'
const COLOR_HOVER_EMPTY = '#7fb8ff' // biru, dipakai pas admin hover bangunan kosong
const COLOR_SEARCH_FOCUS = '#7fe7ff' // cyan, dipakai pas bangunan ke-pilih dari search bar

// File .glb-nya diekspor dengan sumbu "atas" di Z (bukan Y seperti standar
// three.js/glTF), makanya kalau dipasang apa adanya, kamera "tampak atas" jadi
// nge-liat dari samping/miring parah (peta jadi kayak "kebalik"). Ini koreksi
// satu kali: puter -90° di sumbu X supaya Z (asli: atas) jadi Y (three.js: atas).
const AXIS_FIX_ROTATION = [-Math.PI / 2, 0, 0]

// Kemiringan kamera default saat pertama kali dibuka (masih berasa "tampak atas").
const DEFAULT_TILT = THREE.MathUtils.degToRad(28)

// Batas kemiringan kamera: boleh diputer 360° bebas kiri-kanan (azimuth) dan
// boleh dimiringkan naik-turun hampir penuh — dari nyaris tegak lurus dari
// atas sampai nyaris sejajar horizon — tapi tetap tidak pernah nembus ke
// bawah 90°, biar user gak pernah lihat sisi bawah peta.
const MIN_POLAR_ANGLE = THREE.MathUtils.degToRad(0.1) // nyaris lurus dari atas
const MAX_POLAR_ANGLE = THREE.MathUtils.degToRad(89.5) // nyaris sejajar horizon, gak sampe kebalik

function TownModel({
  modelUrl,
  assignedByKey,
  adminMode,
  hoveredKey,
  onHover,
  onBuildingClick,
  onBuildingsLoaded,
  focusedKey,
}) {
  const { scene } = useGLTF(modelUrl)

  // Tiap mesh bangunan dikasih material sendiri-sendiri (clone),
  // soalnya aslinya beberapa bangunan berbagi 1 material yang sama —
  // kalau tidak di-clone, highlight 1 bangunan bakal ikut nyala di bangunan lain.
  useEffect(() => {
    scene.traverse((obj) => {
      if (obj.isMesh && obj.name.startsWith(BUILDING_PREFIX) && !obj.userData.clonedMaterial) {
        obj.material = obj.material.clone()
        obj.userData.clonedMaterial = true
      }
    })
  }, [scene])

  // Kumpulin semua nomor node bangunan yang beneran ada di model peta ini,
  // lalu lapor ke atas (App.jsx) — dipakai buat search bar: berapa total
  // bangunan di peta ini, dan bikin entry "Bangunan N" buat yang belum ada room-nya.
  useEffect(() => {
    if (!onBuildingsLoaded) return
    const keys = new Set()
    scene.traverse((obj) => {
      if (obj.isMesh && obj.name.startsWith(BUILDING_PREFIX)) keys.add(obj.name)
    })
    onBuildingsLoaded(Array.from(keys))
  }, [scene, onBuildingsLoaded])

  // Update warna emissive tiap kali status assigned/hover/search-focus berubah
  useEffect(() => {
    scene.traverse((obj) => {
      if (!(obj.isMesh && obj.name.startsWith(BUILDING_PREFIX))) return
      const mat = obj.material
      const isAssigned = Boolean(assignedByKey[obj.name])
      const isHovered = hoveredKey === obj.name
      const isSearchFocused = focusedKey === obj.name

      if (isSearchFocused) {
        mat.emissive = new THREE.Color(COLOR_SEARCH_FOCUS)
        mat.emissiveIntensity = 0.6
      } else if (isHovered && adminMode) {
        mat.emissive = new THREE.Color(isAssigned ? COLOR_HOVER_ASSIGNED : COLOR_HOVER_EMPTY)
        mat.emissiveIntensity = 0.55
      } else if (isHovered && isAssigned) {
        mat.emissive = new THREE.Color(COLOR_HOVER_ASSIGNED)
        mat.emissiveIntensity = 0.55
      } else if (isAssigned) {
        mat.emissive = new THREE.Color(COLOR_ASSIGNED)
        mat.emissiveIntensity = 0.22
      } else {
        mat.emissive = new THREE.Color('#000000')
        mat.emissiveIntensity = 0
      }
    })
  }, [scene, assignedByKey, hoveredKey, adminMode, focusedKey])

  function handleClick(e) {
    const name = e.object?.name
    if (name && name.startsWith(BUILDING_PREFIX)) {
      e.stopPropagation()
      onBuildingClick(name)
    }
  }

  function handlePointerMove(e) {
    const name = e.object?.name
    if (name && name.startsWith(BUILDING_PREFIX)) {
      e.stopPropagation()
      onHover(name)
    }
  }

  return (
    <group rotation={AXIS_FIX_ROTATION}>
      <primitive
        object={scene}
        onClick={handleClick}
        onPointerMove={handlePointerMove}
        onPointerOut={() => onHover(null)}
      />
    </group>
  )
}

// Preload semua peta yang terdaftar (bukan cuma yang lagi aktif), biar pas
// user pindah peta modelnya sudah kebaca duluan di background dan gak nunggu.
MAPS.forEach((map) => useGLTF.preload(map.modelUrl))

// Naro posisi kamera SEKALI aja pas model pertama kali kebaca, fokus ke area
// bangunan aja (bukan ke seluruh peta termasuk jalan yang jauh di pinggir).
// Sengaja tidak "observe"/refit terus-terusan, biar posisi kamera user
// tidak ke-reset sendiri tiap ada resize (misal address bar HP muncul-hilang).
function FrameBuildingsOnce({ groupRef }) {
  const { camera, controls } = useThree()
  const framed = useRef(false)

  useEffect(() => {
    if (framed.current || !groupRef.current) return

    // Pastikan matrix dunia (termasuk rotasi koreksi sumbu di atas) sudah
    // ke-update sebelum dipakai buat hitung bounding box, biar tidak kebaca
    // posisi lama (frame sebelum rotasi diterapkan).
    groupRef.current.updateMatrixWorld(true)

    const box = new THREE.Box3()
    let found = false
    groupRef.current.traverse((obj) => {
      if (obj.isMesh && obj.name.startsWith(BUILDING_PREFIX)) {
        box.expandByObject(obj)
        found = true
      }
    })
    if (!found) return

    framed.current = true

    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.z) || 1

    // Kamera diposisikan miring sedikit dari atas (tampak atas ala papan) saat
    // pertama kali dibuka. Setelah ini, user boleh muter & miringin sendiri
    // lewat OrbitControls (dibatasi MIN/MAX_POLAR_ANGLE di bawah).
    const height = maxDim * 1.4
    camera.position.set(
      center.x,
      center.y + height * Math.cos(DEFAULT_TILT),
      center.z + height * Math.sin(DEFAULT_TILT)
    )
    camera.near = Math.max(maxDim / 200, 0.1)
    camera.far = maxDim * 20
    camera.updateProjectionMatrix()

    if (controls) {
      controls.target.copy(center)
      controls.minDistance = maxDim * 0.3
      controls.maxDistance = maxDim * 3
      controls.update()
    } else {
      camera.lookAt(center)
    }
  })

  return null
}

// Dipicu tiap kali ada bangunan yang dipilih dari search bar (App.jsx).
// Beda dari FrameBuildingsOnce di atas: ini nge-zoom ke SATU bangunan aja,
// dan boleh dipanggil berkali-kali (tiap kali user pilih hasil search baru).
function FocusBuilding({ groupRef, focusRequest }) {
  const { camera, controls } = useThree()
  const lastHandled = useRef(null)

  useEffect(() => {
    if (!focusRequest || !focusRequest.buildingKey) return
    if (lastHandled.current === focusRequest.nonce) return
    if (!groupRef.current) return

    let targetObj = null
    groupRef.current.traverse((obj) => {
      if (obj.isMesh && obj.name === focusRequest.buildingKey) targetObj = obj
    })
    if (!targetObj) return

    lastHandled.current = focusRequest.nonce

    const box = new THREE.Box3().setFromObject(targetObj)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z) || 1

    // Jarak kamera dari bangunan yang dipilih. Di-clamp ke minDistance yang
    // udah di-set FrameBuildingsOnce (berdasar ukuran seluruh peta), biar
    // OrbitControls gak langsung "narik mundur" kamera pas user pertama kali
    // muter/zoom setelah hasil search dipilih.
    const rawHeight = maxDim * 4.5
    const minAllowed = controls?.minDistance || 0
    const height = Math.max(rawHeight, minAllowed)

    camera.position.set(
      center.x,
      center.y + height * Math.cos(DEFAULT_TILT),
      center.z + height * Math.sin(DEFAULT_TILT)
    )
    camera.updateProjectionMatrix()

    if (controls) {
      controls.target.copy(center)
      controls.update()
    } else {
      camera.lookAt(center)
    }
  }, [focusRequest, groupRef, camera, controls])

  return null
}

// Panel yang muncul pas sebuah bangunan diklik dalam mode admin:
// lepas assignment, atau bikin room baru (bebas nama/emoji sendiri).
function BuildingAssignPanel({ buildingKey, currentRoom, onUnassign, onCreateNew, onClose }) {
  const [mode, setMode] = useState(currentRoom ? 'assigned' : 'create') // 'create' | 'assigned'
  const [newName, setNewName] = useState('')
  const [newEmoji, setNewEmoji] = useState('📍')
  const [newUrl, setNewUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function handleCreate() {
    if (!newName.trim()) {
      setErr('Nama room wajib diisi.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      await onCreateNew({ name: newName.trim(), emoji: newEmoji.trim(), telegramGroupUrl: newUrl.trim() })
    } catch (e) {
      console.error(e)
      setErr('Gagal membuat room. Slug mungkin sudah dipakai.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">Bangunan: {buildingKey}</h2>

        {currentRoom && mode === 'assigned' && (
          <>
            <p className="modal-desc">
              Terhubung ke room <strong>{currentRoom.emoji} {currentRoom.name}</strong>.
            </p>
            <button className="modal-btn modal-btn-secondary" disabled={busy} onClick={() => setMode('create')}>
              Ganti room
            </button>
            <button className="modal-btn modal-btn-secondary" disabled={busy} onClick={onUnassign}>
              Lepas dari room ini
            </button>
          </>
        )}

        {mode === 'create' && (
          <>
            <p className="modal-desc">Buat room untuk bangunan ini.</p>
            <input
              className="building-input"
              placeholder="Nama room (contoh: Balai Kota)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              disabled={busy}
            />
            <input
              className="building-input"
              placeholder="Emoji (contoh: 🏛️)"
              value={newEmoji}
              onChange={(e) => setNewEmoji(e.target.value)}
              disabled={busy}
            />
            <input
              className="building-input"
              placeholder="Link grup Telegram (https://t.me/+...)"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              disabled={busy}
            />
            <button className="modal-btn modal-btn-primary" disabled={busy} onClick={handleCreate}>
              {busy ? 'Menyimpan...' : 'Buat & Hubungkan'}
            </button>
          </>
        )}

        {err && <p className="modal-desc" style={{ color: '#ff8a8a' }}>{err}</p>}

        <button className="modal-btn modal-btn-secondary" disabled={busy} onClick={onClose}>
          Tutup
        </button>
      </div>
    </div>
  )
}

export default function TownMap3D({
  mapKey,
  modelUrl,
  rooms,
  adminMode,
  onSelectRoom,
  onRoomsChanged,
  onBuildingsLoaded,
  focusRequest,
}) {
  const [hoveredKey, setHoveredKey] = useState(null)
  const [pickerBuilding, setPickerBuilding] = useState(null)
  const modelGroupRef = useRef()

  const assignedByKey = useMemo(() => {
    const map = {}
    rooms.forEach((r) => {
      if (r.building_key) map[r.building_key] = r
    })
    return map
  }, [rooms])

  // Reset state lokal tiap kali pindah peta (peta lain punya bangunan &
  // nomor node yang beda, jadi hoveredKey/picker lama sudah gak relevan)
  useEffect(() => {
    setHoveredKey(null)
    setPickerBuilding(null)
  }, [mapKey])

  function handleBuildingClick(buildingKey) {
    if (adminMode) {
      setPickerBuilding(buildingKey)
      return
    }
    const room = assignedByKey[buildingKey]
    if (room) onSelectRoom(room)
  }

  return (
    <div className="map3d-viewport">
      {/* key={mapKey} di sini sengaja bikin seluruh <Canvas> remount pas pindah
          peta: model lama di-unload, kamera & framing dihitung ulang dari nol
          buat bounding box peta yang baru (tiap peta beda ukuran/posisi). */}
      <Canvas key={mapKey} shadows dpr={[1, 2]} camera={{ fov: 42, near: 1, far: 5000 }}>
        <color attach="background" args={['#1b2340']} />
        <ambientLight intensity={0.65} />
        <directionalLight position={[60, 100, 40]} intensity={1.15} castShadow />
        <hemisphereLight args={['#6b7fd9', '#232a45', 0.4]} />
        <Suspense fallback={null}>
          <group ref={modelGroupRef}>
            <TownModel
              modelUrl={modelUrl}
              assignedByKey={assignedByKey}
              adminMode={adminMode}
              hoveredKey={hoveredKey}
              onHover={setHoveredKey}
              onBuildingClick={handleBuildingClick}
              onBuildingsLoaded={onBuildingsLoaded}
              focusedKey={focusRequest?.buildingKey || null}
            />
          </group>
        </Suspense>
        <FocusBuilding groupRef={modelGroupRef} focusRequest={focusRequest} />
        {/* Boleh diputer bebas kiri-kanan & dimiringkan (rotate), boleh digeser
            (pan), dan boleh di-zoom — tapi kemiringannya dikunci di
            MIN/MAX_POLAR_ANGLE, jadi kamera gak akan pernah nembus sampai
            kelihatan sisi bawah peta. */}
        <OrbitControls
          makeDefault
          enableRotate
          minPolarAngle={MIN_POLAR_ANGLE}
          maxPolarAngle={MAX_POLAR_ANGLE}
          enableDamping
          dampingFactor={0.12}
          screenSpacePanning
          rotateSpeed={0.6}
          zoomSpeed={0.8}
          panSpeed={0.9}
          mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
          touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
        />
        <FrameBuildingsOnce groupRef={modelGroupRef} />
      </Canvas>

      {adminMode && (
        <div className="map3d-admin-badge">Mode Admin — klik bangunan untuk atur room</div>
      )}

      {pickerBuilding && (
        <BuildingAssignPanel
          buildingKey={pickerBuilding}
          currentRoom={assignedByKey[pickerBuilding]}
          onUnassign={async () => {
            await unassignBuilding(pickerBuilding)
            await onRoomsChanged()
            setPickerBuilding(null)
          }}
          onCreateNew={async (fields) => {
            await createRoomForBuilding({ ...fields, buildingKey: pickerBuilding, mapKey })
            await onRoomsChanged()
            setPickerBuilding(null)
          }}
          onClose={() => setPickerBuilding(null)}
        />
      )}
    </div>
  )
}
