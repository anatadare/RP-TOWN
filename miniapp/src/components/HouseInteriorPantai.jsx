import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import {
  buildStaticBoxes, DOORS, doorPlacement, PW,
  roomAt, nearestDoor, inDoorway, distToExit, FRONT_DOOR, EXIT_RANGE,
} from '../lib/houseInteriorPantai'
import { boxesToGeometry } from '../lib/pantaiHouses'
import { makeShading, bakeShading, averageShade } from '../lib/pantaiShading'

// Gambar interior "Rumah Pantai" 2 lantai (denah + fisika: lib/houseInteriorPantai.js).
//
// Semua kotak statis (lantai, dinding, tangga) digabung jadi SATU mesh
// ber-vertex-color supaya ringan di HP; kaca satu mesh transparan; daun pintu
// kamar adalah mesh terpisah yang mengayun. Denah ditulis dalam koordinat denah,
// jadi semuanya dibungkus grup yang dicerminkan (X = PW - x) -- alasannya ada di
// komentar atas houseInteriorPantai.js.
//
// PENCAHAYAAN. Interior TIDAK memakai lampu scene. Peta asli ikut digambar di balik
// jendela (PantaiMapBackdrop di TownWalk.jsx) dan lampu three.js berlaku untuk seluruh
// scene, jadi kalau interior memakai lampu sendiri, petanya ikut terang/gelap salah.
// Kecerahan interior dihitung sekali (lib/pantaiShading.js) ke warna vertex dan
// digambar dengan MeshBasicMaterial -- hasilnya sama dengan lampu merata sebelumnya.
// Ubah angka di INTERIOR_LIGHT kalau interior terasa terlalu terang/gelap.
const INTERIOR_LIGHT = {
  ambient: 0.5, ambientColor: '#fff1d6', // hangat
  hemi: 1.35, hemiSky: '#dbeeff', hemiGround: '#d9cba7',
  sun: 1.45, sunPos: [40, 70, -30],
}
const rgb = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b] }
const SHADING = makeShading({
  ambient: INTERIOR_LIGHT.ambient, ambientRGB: rgb(INTERIOR_LIGHT.ambientColor),
  hemi: INTERIOR_LIGHT.hemi, skyRGB: rgb(INTERIOR_LIGHT.hemiSky), groundRGB: rgb(INTERIOR_LIGHT.hemiGround),
  sun: INTERIOR_LIGHT.sun, sunPos: INTERIOR_LIGHT.sunPos,
})
// daun pintu & kenop: bukan bagian geometri gabungan, jadi pakai rata-rata sisi tegak
const DOOR_SHADE = averageShade([[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]], SHADING)
const shaded = (hex) => {
  const c = new THREE.Color(hex)
  c.r *= DOOR_SHADE[0]; c.g *= DOOR_SHADE[1]; c.b *= DOOR_SHADE[2]
  return c
}
const C_DOOR = shaded('#b98e5c')
const C_KNOB = shaded('#d9b44a')

// geometri kotak -> warna vertex dikalikan kecerahan sesuai arah permukaannya
function bakedGeometry(boxes) {
  const g = boxesToGeometry(boxes)
  const col = g.getAttribute('color')
  bakeShading(col.array, g.getAttribute('normal').array, SHADING, true) // grup dicerminkan di x
  col.needsUpdate = true
  return g
}

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
          <meshBasicMaterial color={C_DOOR} />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh key={side} position={[def.w - 0.14, 1.0, side * 0.05]}>
            <sphereGeometry args={[0.04, 10, 10]} />
            <meshBasicMaterial color={C_KNOB} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

// Hanya interiornya. Pemandangan di luar jendela adalah peta asli (PantaiMapBackdrop).
export default function HouseInteriorPantai({ doorsRef }) {
  const { solidGeo, glassGeo } = useMemo(() => {
    const { solid, glass } = buildStaticBoxes()
    return { solidGeo: bakedGeometry(solid), glassGeo: bakedGeometry(glass.map((g) => ({ ...g, c: 0xa9cfdf }))) }
  }, [])
  return (
    <>
      {/* denah dalam koordinat denah, dicerminkan supaya kiri-kanan sama dengan gambar */}
      <group position={[PW, 0, 0]} scale={[-1, 1, 1]}>
        <mesh geometry={solidGeo}>
          <meshBasicMaterial vertexColors />
        </mesh>
        <mesh geometry={glassGeo} renderOrder={2}>
          <meshBasicMaterial vertexColors transparent opacity={0.28} depthWrite={false} side={THREE.DoubleSide} />
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
