import { Suspense, useEffect, useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Bounds, OrbitControls, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { assignBuildingToRoom, unassignBuilding, createRoomForBuilding } from '../lib/rooms'

// Prefix nama node bangunan di file .glb (lihat topoexport_3D_modeling.glb)
const BUILDING_PREFIX = 'TPX_Buildings_'
const MODEL_URL = '/models/town.glb'

// Warna highlight
const COLOR_ASSIGNED = '#ffb454' // lantern, bangunan yang sudah jadi room
const COLOR_HOVER_ASSIGNED = '#ffd699'
const COLOR_HOVER_EMPTY = '#7fb8ff' // biru, dipakai pas admin hover bangunan kosong

function TownModel({ assignedByKey, adminMode, hoveredKey, onHover, onBuildingClick }) {
  const { scene } = useGLTF(MODEL_URL)

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

  // Update warna emissive tiap kali status assigned/hover berubah
  useEffect(() => {
    scene.traverse((obj) => {
      if (!(obj.isMesh && obj.name.startsWith(BUILDING_PREFIX))) return
      const mat = obj.material
      const isAssigned = Boolean(assignedByKey[obj.name])
      const isHovered = hoveredKey === obj.name

      if (isHovered && adminMode) {
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
  }, [scene, assignedByKey, hoveredKey, adminMode])

  function handlePointerDown(e) {
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
    <primitive
      object={scene}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerOut={() => onHover(null)}
    />
  )
}

useGLTF.preload(MODEL_URL)

// Panel yang muncul pas sebuah bangunan diklik dalam mode admin:
// pilih room yang sudah ada, lepas assignment, atau bikin room baru.
function BuildingAssignPanel({ buildingKey, rooms, currentRoom, onAssign, onUnassign, onCreateNew, onClose }) {
  const [mode, setMode] = useState(currentRoom ? 'assigned' : 'pick') // 'pick' | 'create' | 'assigned'
  const [newName, setNewName] = useState('')
  const [newEmoji, setNewEmoji] = useState('📍')
  const [newUrl, setNewUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const unassignedRooms = rooms.filter((r) => !r.building_key)

  async function handlePick(roomId) {
    setBusy(true)
    setErr(null)
    try {
      await onAssign(roomId)
    } catch (e) {
      console.error(e)
      setErr('Gagal menyimpan. Coba lagi.')
    } finally {
      setBusy(false)
    }
  }

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
            <button className="modal-btn modal-btn-secondary" disabled={busy} onClick={() => setMode('pick')}>
              Ganti room
            </button>
            <button className="modal-btn modal-btn-secondary" disabled={busy} onClick={onUnassign}>
              Lepas dari room ini
            </button>
          </>
        )}

        {mode === 'pick' && (
          <>
            <p className="modal-desc">Pilih room yang sudah ada, atau buat baru.</p>
            <div className="building-room-list">
              {unassignedRooms.length === 0 && (
                <p className="modal-desc" style={{ opacity: 0.6 }}>Semua room sudah punya bangunan.</p>
              )}
              {unassignedRooms.map((r) => (
                <button
                  key={r.id}
                  className="building-room-item"
                  disabled={busy}
                  onClick={() => handlePick(r.id)}
                >
                  <span>{r.emoji}</span> {r.name}
                </button>
              ))}
            </div>
            <button className="modal-btn modal-btn-primary" disabled={busy} onClick={() => setMode('create')}>
              + Buat room baru
            </button>
          </>
        )}

        {mode === 'create' && (
          <>
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

export default function TownMap3D({ rooms, adminMode, onSelectRoom, onRoomsChanged }) {
  const [hoveredKey, setHoveredKey] = useState(null)
  const [pickerBuilding, setPickerBuilding] = useState(null)

  const assignedByKey = useMemo(() => {
    const map = {}
    rooms.forEach((r) => {
      if (r.building_key) map[r.building_key] = r
    })
    return map
  }, [rooms])

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
      <Canvas shadows dpr={[1, 2]} camera={{ fov: 42, near: 1, far: 5000 }}>
        <color attach="background" args={['#1b2340']} />
        <ambientLight intensity={0.65} />
        <directionalLight position={[60, 100, 40]} intensity={1.15} castShadow />
        <hemisphereLight args={['#6b7fd9', '#232a45', 0.4]} />
        <Suspense fallback={null}>
          <Bounds fit clip observe margin={1.15}>
            <TownModel
              assignedByKey={assignedByKey}
              adminMode={adminMode}
              hoveredKey={hoveredKey}
              onHover={setHoveredKey}
              onBuildingClick={handleBuildingClick}
            />
          </Bounds>
        </Suspense>
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          maxPolarAngle={Math.PI / 2.15}
          minDistance={10}
        />
      </Canvas>

      {adminMode && (
        <div className="map3d-admin-badge">Mode Admin — klik bangunan untuk atur room</div>
      )}

      {pickerBuilding && (
        <BuildingAssignPanel
          buildingKey={pickerBuilding}
          rooms={rooms}
          currentRoom={assignedByKey[pickerBuilding]}
          onAssign={async (roomId) => {
            await assignBuildingToRoom(roomId, pickerBuilding)
            await onRoomsChanged()
            setPickerBuilding(null)
          }}
          onUnassign={async () => {
            await unassignBuilding(pickerBuilding)
            await onRoomsChanged()
            setPickerBuilding(null)
          }}
          onCreateNew={async (fields) => {
            await createRoomForBuilding({ ...fields, buildingKey: pickerBuilding })
            await onRoomsChanged()
            setPickerBuilding(null)
          }}
          onClose={() => setPickerBuilding(null)}
        />
      )}
    </div>
  )
}
