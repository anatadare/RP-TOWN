import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import {
  buildStaticBoxes, DOORS, doorPlacement, PW, PD,
  roomAt, nearestDoor, inDoorway, distToExit, FRONT_DOOR, EXIT_RANGE,
} from '../lib/houseInteriorPantai'
import { boxesToGeometry } from '../lib/pantaiHouses'

// Gambar interior "Rumah Pantai" 2 lantai (denah + fisika: lib/houseInteriorPantai.js).
//
// Semua kotak statis (lantai, dinding, tangga) digabung jadi SATU mesh
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

// Pemandangan di luar jendela tidak ikut lampu (MeshBasicMaterial). Pasir & laut
// memenuhi layar lewat jendela, dan dulu tiap pikselnya menghitung SEMUA lampu
// ruangan (PBR) -- penyebab utama framedrop di dalam rumah. Warnanya digelapkan
// (UNLIT_K) kira-kira setara hasil pencahayaan lama; ubah UNLIT_K kalau terlalu
// terang/gelap.
const UNLIT_K = 0.8
const unlit = (hex) => new THREE.Color(hex).multiplyScalar(UNLIT_K)
const C_SAND = unlit('#dccfaa')
const C_ROAD = unlit('#45474b')
const C_WALK = unlit('#c4c1b9')
const C_SEA = unlit('#2d8fa6')
const C_TRUNK = unlit('#6b543a')
const C_LEAF = unlit('#2f6b30')

const PALMS = [[-3.5, -3.2, 6.2], [PW + 3.4, -3.6, 5.6], [-4.2, PD + 2.5, 6.8], [PW + 4.5, PD + 3.5, 6.0], [-9, 3, 7], [PW + 10, 4, 6.4]]

// Semua pohon kelapa digabung jadi SATU geometri ber-vertex-color (1 draw call,
// sebelumnya 6 pohon x 8 mesh = 48 draw call + 8 material).
function buildPalmGeometry() {
  const parts = []
  const paint = (g, c) => {
    const n = g.getAttribute('position').count
    const col = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    return g
  }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1)
  for (const [x, z, h] of PALMS) {
    parts.push(paint(new THREE.CylinderGeometry(0.1, 0.17, h, 6).translate(x, -0.4 + h / 2, z), C_TRUNK))
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2
      e.set(0, -a, -0.45)
      q.setFromEuler(e)
      p.set(x + Math.cos(a) * 1.0, -0.4 + h - 0.1, z + Math.sin(a) * 1.0)
      m.compose(p, q, s)
      parts.push(paint(new THREE.BoxGeometry(2.4, 0.03, 0.4).applyMatrix4(m), C_LEAF))
    }
  }
  const merged = mergeGeometries(parts)
  parts.forEach((g) => g.dispose())
  return merged
}

// Lingkungan di luar jendela: pasir, jalan, laut, beberapa pohon kelapa sederhana.
function Surroundings() {
  const palmGeo = useMemo(buildPalmGeometry, [])
  return (
    <>
      <mesh rotation-x={-Math.PI / 2} position={[PW / 2, -0.42, PD / 2]}>
        <planeGeometry args={[600, 600]} />
        <meshBasicMaterial color={C_SAND} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[PW / 2, -0.41, -8]}>
        <planeGeometry args={[600, 5.5]} />
        <meshBasicMaterial color={C_ROAD} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[PW / 2, -0.4, -4]}>
        <planeGeometry args={[600, 3]} />
        <meshBasicMaterial color={C_WALK} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[PW / 2, -0.4, 330]}>
        <planeGeometry args={[800, 600]} />
        <meshBasicMaterial color={C_SEA} />
      </mesh>
      <mesh geometry={palmGeo}>
        <meshBasicMaterial vertexColors />
      </mesh>
    </>
  )
}

// Pencahayaan interior TIDAK dipasang di sini dan tanpa lampu/titik lampu: cahaya
// merata (ambient + hemisphere + directional) diatur di <Canvas> TownWalk lewat
// PANTAI_INTERIOR_LIGHT. Tidak ada pointLight, jadi ringan dan tidak ada logika lampu.
export default function HouseInteriorPantai({ doorsRef }) {
  const { solidGeo, glassGeo } = useMemo(() => {
    const { solid, glass } = buildStaticBoxes()
    return { solidGeo: boxesToGeometry(solid), glassGeo: boxesToGeometry(glass.map((g) => ({ ...g, c: 0xa9cfdf }))) }
  }, [])
  return (
    <>
      <Surroundings />
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
