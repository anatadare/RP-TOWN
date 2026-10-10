import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { HOUSE, buildHouseLayout, roomAt, distToExit } from '../lib/houseInterior'

// Gambar interior rumah (kosong): lantai per ruangan, dinding, kusen pintu, dan
// label nama ruangan di lantai. Fisikanya ada di lib/houseInterior.js.

const WALL_COLOR = '#f2ede4'
const OUTER_WALL_COLOR = '#e4dccf'
const FRAME_COLOR = '#8a6a48'

function makeLabelTexture(text) {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 160
  const g = c.getContext('2d')
  g.clearRect(0, 0, c.width, c.height)
  g.font = '700 64px system-ui, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillStyle = 'rgba(40, 32, 24, 0.55)'
  g.fillText(text, c.width / 2, c.height / 2)
  const tex = new THREE.CanvasTexture(c)
  tex.anisotropy = 4
  return tex
}

function RoomLabel({ room }) {
  const tex = useMemo(() => makeLabelTexture(`${room.emoji} ${room.name}`), [room])
  useEffect(() => () => tex.dispose(), [tex])
  const cx = (room.x1 + room.x2) / 2
  const cz = (room.z1 + room.z2) / 2
  return (
    <mesh position={[cx, 0.02, cz]} rotation-x={-Math.PI / 2}>
      <planeGeometry args={[3.2, 1]} />
      <meshBasicMaterial map={tex} transparent depthWrite={false} />
    </mesh>
  )
}

function Wall({ seg, outer }) {
  const { wallH, wallT } = HOUSE
  const horizontal = seg.z1 === seg.z2
  const len = horizontal ? Math.abs(seg.x2 - seg.x1) : Math.abs(seg.z2 - seg.z1)
  const cx = (seg.x1 + seg.x2) / 2
  const cz = (seg.z1 + seg.z2) / 2
  return (
    <mesh
      position={[cx, wallH / 2, cz]}
      // +wallT biar sudut-sudut dinding nyambung tanpa celah
      scale={horizontal ? [len + wallT, wallH, wallT] : [wallT, wallH, len + wallT]}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={outer ? OUTER_WALL_COLOR : WALL_COLOR} roughness={0.9} />
    </mesh>
  )
}

// List dinding (plint) di kaki dinding, biar ruangan kelihatan "jadi".
function Baseboard({ seg }) {
  const { wallT } = HOUSE
  const horizontal = seg.z1 === seg.z2
  const len = horizontal ? Math.abs(seg.x2 - seg.x1) : Math.abs(seg.z2 - seg.z1)
  const cx = (seg.x1 + seg.x2) / 2
  const cz = (seg.z1 + seg.z2) / 2
  const t = wallT + 0.05
  return (
    <mesh position={[cx, 0.07, cz]} scale={horizontal ? [len + wallT, 0.14, t] : [t, 0.14, len + wallT]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#b9ad9a" roughness={0.8} />
    </mesh>
  )
}

// Kusen di atas bukaan pintu (dari tinggi pintu sampai langit-langit).
function Lintel({ d }) {
  const { wallH, wallT, doorH } = HOUSE
  const h = wallH - doorH
  const size = d.axis === 'x' ? [d.w + wallT, h, wallT] : [wallT, h, d.w + wallT]
  return (
    <mesh position={[d.cx, doorH + h / 2, d.cz]} scale={size}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={FRAME_COLOR} roughness={0.8} />
    </mesh>
  )
}

export default function HouseInterior() {
  const layout = useMemo(() => buildHouseLayout(), [])
  const { width: W, depth: D, frontDoor } = HOUSE

  const isOuter = (s) =>
    (s.z1 === 0 && s.z2 === 0) || (s.z1 === D && s.z2 === D) || (s.x1 === 0 && s.x2 === 0) || (s.x1 === W && s.x2 === W)

  return (
    <>
      {HOUSE.rooms.map((r) => (
        <group key={r.id}>
          <mesh position={[(r.x1 + r.x2) / 2, 0, (r.z1 + r.z2) / 2]} rotation-x={-Math.PI / 2}>
            <planeGeometry args={[r.x2 - r.x1, r.z2 - r.z1]} />
            <meshStandardMaterial color={r.color} roughness={0.95} />
          </mesh>
          <RoomLabel room={r} />
        </group>
      ))}

      {layout.walls.map((s, i) => (
        <Wall key={i} seg={s} outer={isOuter(s)} />
      ))}
      {layout.walls.map((s, i) => (
        <Baseboard key={`b${i}`} seg={s} />
      ))}
      {layout.doorways.map((d, i) => (
        <Lintel key={i} d={d} />
      ))}

      {/* plafon (menghadap ke bawah) -- rumah tertutup, gak ada area kosong di luar */}
      <mesh position={[W / 2, HOUSE.wallH, D / 2]} rotation-x={Math.PI / 2}>
        <planeGeometry args={[W + HOUSE.wallT, D + HOUSE.wallT]} />
        <meshStandardMaterial color="#f7f3ec" roughness={1} />
      </mesh>

      {/* pintu depan (tertutup); keluar lewat pop up "Keluar rumah" */}
      <group position={[frontDoor.x, 0, D]}>
        <mesh position={[0, HOUSE.doorH / 2, 0]} scale={[frontDoor.w, HOUSE.doorH, 0.08]}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color="#7b5232" roughness={0.7} />
        </mesh>
        <mesh position={[frontDoor.w / 2 - 0.2, 1.0, -0.08]}>
          <sphereGeometry args={[0.05, 12, 12]} />
          <meshStandardMaterial color="#d9b44a" metalness={0.6} roughness={0.35} />
        </mesh>
      </group>

      {/* lampu tiap ruangan (hangat) */}
      <ambientLight intensity={0.55} />
      {HOUSE.rooms.map((r) => (
        <pointLight
          key={`l-${r.id}`}
          position={[(r.x1 + r.x2) / 2, HOUSE.wallH - 0.35, (r.z1 + r.z2) / 2]}
          intensity={14}
          distance={9}
          decay={1.6}
          color="#fff1d6"
        />
      ))}

      {/* keset di depan pintu keluar biar gampang ketemu */}
      <mesh position={[frontDoor.x, 0.03, D - 0.6]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[frontDoor.w + 0.4, 1]} />
        <meshStandardMaterial color="#7a3b2e" roughness={1} />
      </mesh>
    </>
  )
}

// Kabari TownWalk (lewat callback, cuma pas berubah) soal posisi karakter di
// dalam rumah: lagi di ruangan apa & lagi dekat pintu keluar atau nggak.
export function InteriorWatcher({ selfRef, onInfo }) {
  const acc = useRef(0)
  const last = useRef('')
  useFrame((_, delta) => {
    acc.current += delta
    if (acc.current < 0.12) return
    acc.current = 0
    const me = selfRef.current
    if (!me.ready) return
    const room = roomAt(me.x, me.z)
    const atDoor = distToExit(me.x, me.z) <= HOUSE.exitRange
    const k = `${room ? room.id : ''}|${atDoor ? 1 : 0}`
    if (k === last.current) return
    last.current = k
    onInfo({ room: room ? room.name : null, emoji: room ? room.emoji : null, atDoor })
  })
  return null
}
