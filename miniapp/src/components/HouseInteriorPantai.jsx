import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import {
  buildStaticBoxes, DOORS, doorPlacement, LIGHT_SPOTS, LEVEL_Y, PW, PD,
  roomAt, nearestDoor, inDoorway, distToExit, FRONT_DOOR, EXIT_RANGE,
} from '../lib/houseInteriorPantai'
import { boxesToGeometry } from '../lib/pantaiHouses'

// Gambar interior "Rumah Pantai" 2 lantai (denah + fisika: lib/houseInteriorPantai.js).
//
// Semua kotak statis (lantai, dinding, tangga, furnitur) digabung jadi SATU mesh
// ber-vertex-color supaya ringan di HP; kaca satu mesh transparan; daun pintu
// kamar adalah mesh terpisah yang mengayun. Denah ditulis dalam koordinat denah,
// jadi semuanya dibungkus grup yang dicerminkan (X = PW - x) -- alasannya ada di
// komentar atas houseInteriorPantai.js.

// Pintu kamar: daun mengayun di engselnya. Status buka/tutup dibaca dari
// doorsRef (diatur TownWalk), animasinya lewat useFrame tanpa re-render React.
function Door({ def, doorsRef }) {
  const pivot = useRef(null)
  const t = useRef(0)
  const place = useMemo(() => doorPlacement(def), [def])
  useFrame((_, delta) => {
    const target = doorsRef.current[def.id] ? 1 : 0
    t.current += (target - t.current) * (1 - Math.exp(-9 * delta))
    if (Math.abs(target - t.current) < 0.002) t.current = target
    if (pivot.current) pivot.current.rotation.y = place.closedRot + (place.openRot - place.closedRot) * t.current
  })
  return (
    <group position={[place.hx, def.y0, place.hz]}>
      <group ref={pivot} rotation-y={place.closedRot}>
        <mesh position={[def.w / 2, 1.04, 0]} scale={[def.w - 0.06, 2.06, 0.05]}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color="#b98e5c" roughness={0.65} />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh key={side} position={[def.w - 0.14, 1.0, side * 0.05]}>
            <sphereGeometry args={[0.04, 10, 10]} />
            <meshStandardMaterial color="#d9b44a" metalness={0.6} roughness={0.35} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

// Lingkungan di luar jendela: pasir, jalan, laut, beberapa pohon kelapa sederhana.
function Surroundings() {
  const palms = useMemo(() => [[-3.5, -3.2, 6.2], [PW + 3.4, -3.6, 5.6], [-4.2, PD + 2.5, 6.8], [PW + 4.5, PD + 3.5, 6.0], [-9, 3, 7], [PW + 10, 4, 6.4]], [])
  return (
    <>
      <mesh rotation-x={-Math.PI / 2} position={[PW / 2, -0.42, PD / 2]}>
        <planeGeometry args={[600, 600]} />
        <meshStandardMaterial color="#dccfaa" roughness={1} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[PW / 2, -0.41, -8]}>
        <planeGeometry args={[600, 5.5]} />
        <meshStandardMaterial color="#45474b" roughness={1} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[PW / 2, -0.4, -4]}>
        <planeGeometry args={[600, 3]} />
        <meshStandardMaterial color="#c4c1b9" roughness={1} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[PW / 2, -0.4, 330]}>
        <planeGeometry args={[800, 600]} />
        <meshStandardMaterial color="#2d8fa6" roughness={0.2} metalness={0.1} />
      </mesh>
      {palms.map(([x, z, h], i) => (
        <group key={i} position={[x, -0.4, z]}>
          <mesh position={[0, h / 2, 0]}>
            <cylinderGeometry args={[0.1, 0.17, h, 6]} />
            <meshStandardMaterial color="#6b543a" roughness={1} />
          </mesh>
          {[0, 1, 2, 3, 4, 5, 6].map((k) => (
            <mesh key={k} position={[Math.cos((k / 7) * Math.PI * 2) * 1.0, h - 0.1, Math.sin((k / 7) * Math.PI * 2) * 1.0]} rotation={[0, -(k / 7) * Math.PI * 2, -0.45]}>
              <boxGeometry args={[2.4, 0.03, 0.4]} />
              <meshStandardMaterial color="#2f6b30" roughness={0.9} />
            </mesh>
          ))}
        </group>
      ))}
    </>
  )
}

export default function HouseInteriorPantai({ doorsRef }) {
  const { solidGeo, glassGeo } = useMemo(() => {
    const { solid, glass } = buildStaticBoxes()
    return { solidGeo: boxesToGeometry(solid), glassGeo: boxesToGeometry(glass.map((g) => ({ ...g, c: 0xa9cfdf }))) }
  }, [])
  return (
    <>
      <Surroundings />
      <hemisphereLight args={['#dbeeff', '#d9cba7', 0.75]} />
      <directionalLight position={[40, 70, -30]} intensity={1.1} />
      {/* denah dalam koordinat denah, dicerminkan supaya kiri-kanan sama dengan gambar */}
      <group position={[PW, 0, 0]} scale={[-1, 1, 1]}>
        <mesh geometry={solidGeo}>
          <meshStandardMaterial vertexColors roughness={0.9} />
        </mesh>
        <mesh geometry={glassGeo} renderOrder={2}>
          <meshStandardMaterial vertexColors transparent opacity={0.28} roughness={0.05} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        {DOORS.map((d) => (
          <Door key={d.id} def={d} doorsRef={doorsRef} />
        ))}
        {LIGHT_SPOTS.map(([lx, ly, lv]) => (
          <pointLight key={`l-${lx}-${ly}-${lv}`} position={[lx, LEVEL_Y[lv] + 2.5, ly]} intensity={4} distance={9} decay={1.6} color="#fff1d6" />
        ))}
      </group>
    </>
  )
}

// Kabari TownWalk (lewat callback, cuma pas berubah) soal posisi karakter di
// dalam rumah: ruangan apa, dekat pintu keluar, atau dekat pintu kamar.
export function PantaiInteriorWatcher({ selfRef, doorsRef, onInfo }) {
  const acc = useRef(0)
  const last = useRef('')
  useFrame((_, delta) => {
    acc.current += delta
    if (acc.current < 0.12) return
    acc.current = 0
    const me = selfRef.current
    if (!me.ready) return
    const room = roomAt(me.x, me.z, me.y)
    const atDoor = distToExit(me.x, me.z, me.y) <= EXIT_RANGE
    const d = nearestDoor(me.x, me.z, me.yaw, me.y)
    const open = d ? !!doorsRef.current[d.id] : false
    const blocked = d ? inDoorway(d, me.x, me.z) : false
    const k = `${room ? room.id : ''}|${atDoor ? 1 : 0}|${d ? d.id : ''}|${open ? 1 : 0}|${blocked ? 1 : 0}`
    if (k === last.current) return
    last.current = k
    onInfo({
      room: room ? room.name : null,
      emoji: room ? room.emoji : null,
      atDoor,
      door: d ? { id: d.id, name: d.name, open, blocked } : null,
    })
  })
  return null
}
