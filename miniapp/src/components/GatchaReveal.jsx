import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { RoundedBox } from '@react-three/drei'
import * as THREE from 'three'
import FoldablePhone from './FoldablePhone'
import BarPhone from './BarPhone'
import { getAnyPhoneVariant, isBarPhone } from './phoneCatalog'
import { hapticSuccess, hapticSelect } from '../lib/telegram'

// ============================================================
// GatchaReveal -- animasi multi-tahap pas warga dapat HP dari box
// (starter box ATAU gatcha box reguler nanti, komponen ini generik
// buat keduanya). Modal full-screen, SENDIRI punya <Canvas> (gak
// numpang di Canvas peta TownWalk) -- sama pola kayak CharacterPreview.
//
// PENTING: rarity-nya SUDAH DITENTUIN DI SERVER (claim_starter_box)
// SEBELUM komponen ini kerender -- jadi animasi di sini CUMA
// nge-reveal hasil yang udah ada, bukan nentuin hasil. `onTap` (tombol
// "Sentuh buat buka") cuma buat PACING/ketegangan, bukan buat ngundi.
//
// TAHAPAN (lihat PHASE_SECONDS di bawah buat durasi tiap tahap):
//   idle -> shaking -> opening -> glowing -> bursting -> revealing -> done
// "Satu Alur, Beda Klimaks": idle/shaking/opening SAMA PERSIS buat
// semua rarity (pemain belum tau bakal dapat apa) -- yang beda cuma
// WARNA & LAMANYA tahap `glowing` (lihat GLOW_COLOR & glowing di
// PHASE_SECONDS), dan intensitas `bursting` (confetti cuma epic+legendary).
//
// Props:
//  - itemType : row hasil claim_starter_box (RPC return value) ATAU
//               object manapun yang punya `.id` yang cocok sama id
//               varian di phoneCatalog.js. null/undefined = gak tampil.
//  - onClose  : dipanggil pas warga nekan "Oke" di kartu hasil.
// ============================================================

const GLOW_COLOR = {
  common: '#cfd3d8',
  rare: '#cfd3d8', // sengaja SAMA kayak common -- bedanya baru kerasa di label rarity + lama build-up (common/rare emang dirancang gak beda dari sisi cahaya, biar epic/legendary yang nonjol)
  epic: '#b36bff',
  legendary: '#ffb23f',
}

const PHASE_SECONDS = {
  shaking: 0.45,
  opening: 0.4,
  glowing: { common: 0.15, rare: 0.15, epic: 0.3, legendary: 0.5 },
  bursting: 0.3,
  revealing: 0.9,
}

const PHASE_ORDER = ['shaking', 'opening', 'glowing', 'bursting', 'revealing', 'done']

function glowDuration(rarity) {
  return PHASE_SECONDS.glowing[rarity] ?? PHASE_SECONDS.glowing.common
}

// Label "RP TOWN HP" di tutup box -- digambar ke canvas 2D dulu baru
// dipakai sebagai texture, SENGAJA gak pakai <Text> dari drei (itu
// nge-fetch font dari CDN) -- biar box ini gak nambah dependency
// jaringan baru kayak 39 model HP yang udah self-contained.
function useLidLabelTexture() {
  return useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 160
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#2a2a33'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#f2f2f2'
    ctx.font = '700 72px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('RP TOWN', canvas.width / 2, 58)
    ctx.font = '500 44px sans-serif'
    ctx.fillStyle = '#b7b7c2'
    ctx.fillText('H P', canvas.width / 2, 118)
    const tex = new THREE.CanvasTexture(canvas)
    tex.anisotropy = 4
    return tex
  }, [])
}

// Isi <Canvas>: box + cahaya + HP hasil. Semua animasi digerakkan dari
// `phase` (bukan CSS, ini konten 3D) -- tiap pergantian phase nyimpen
// waktu mulainya (phaseStartRef), terus tiap frame itung elapsed time
// SENDIRI relatif ke itu buat nentuin shake/rotasi lid/intensitas
// cahaya/posisi HP. Durasi dibaca dari PHASE_SECONDS yang sama persis
// dipakai scheduler di GatchaReveal, jadi dua-duanya gak bisa kesasar.
function GatchaBoxScene({ phase, rarity, variant }) {
  const lidGroup = useRef()
  const boxGroup = useRef()
  const glowRef = useRef()
  const lightRef = useRef()
  const phoneGroup = useRef()
  const phaseStartRef = useRef(performance.now())
  const lidTex = useLidLabelTexture()
  const glowColor = useMemo(() => new THREE.Color(GLOW_COLOR[rarity] || GLOW_COLOR.common), [rarity])

  useEffect(() => {
    phaseStartRef.current = performance.now()
  }, [phase])

  useFrame(() => {
    const t = (performance.now() - phaseStartRef.current) / 1000

    // Guncang -- jitter kecil di posisi X/rotasi Z, random tapi dibatasi
    // amplitudo-nya biar gak norak. Mereda total pas phase ini selesai.
    if (boxGroup.current) {
      const shaking = phase === 'shaking'
      const amp = shaking ? (1 - Math.min(t / PHASE_SECONDS.shaking, 1)) * 0.035 : 0
      boxGroup.current.position.x = shaking ? Math.sin(t * 60) * amp : 0
      boxGroup.current.rotation.z = shaking ? Math.sin(t * 50 + 1) * amp : 0
    }

    // Tutup kebuka -- ease-out ke -120° (ke belakang), dari phase
    // 'opening' terus TETAP kebuka di semua phase setelahnya.
    if (lidGroup.current) {
      const openIdx = PHASE_ORDER.indexOf('opening')
      const curIdx = PHASE_ORDER.indexOf(phase)
      const openProgress = curIdx > openIdx ? 1 : curIdx === openIdx ? Math.min(t / PHASE_SECONDS.opening, 1) : 0
      const eased = 1 - Math.pow(1 - openProgress, 3)
      lidGroup.current.rotation.x = -eased * (Math.PI * 0.68)
    }

    // Cahaya dari dalam box -- nyala pelan pas 'glowing' (durasinya BEDA
    // per rarity, lihat glowDuration), lalu meledak sebentar pas
    // 'bursting', baru padam abis itu (kalah sama HP yang nongol).
    const dur = glowDuration(rarity)
    let intensity = 0
    let scale = 0.4
    if (phase === 'glowing') {
      const p = Math.min(t / dur, 1)
      intensity = p
      // Legendary dikasih kedip 2x di akhir build-up biar kerasa "beda
      // kelas" dari epic yang mulus doang -- common/rare gak kena ini
      // sama sekali (dur-nya emang kependekan buat sempet kedip).
      if (rarity === 'legendary' && p > 0.6) {
        intensity *= 0.6 + 0.4 * Math.abs(Math.sin(p * 26))
      }
      scale = 0.4 + p * 0.5
    } else if (phase === 'bursting') {
      const p = Math.min(t / PHASE_SECONDS.bursting, 1)
      intensity = 1 - p
      scale = 0.9 + p * 2.2
    } else if (PHASE_ORDER.indexOf(phase) > PHASE_ORDER.indexOf('bursting')) {
      intensity = 0
    }
    if (glowRef.current) {
      glowRef.current.scale.setScalar(scale)
      glowRef.current.material.opacity = intensity * 0.85
    }
    if (lightRef.current) lightRef.current.intensity = intensity * 3.5

    // HP-nya naik dari dalam box + muter pelan terus-terusan sambil
    // nongol (biar kerasa "hidup", bukan model statis doang).
    if (phoneGroup.current) {
      const revIdx = PHASE_ORDER.indexOf('revealing')
      const curIdx = PHASE_ORDER.indexOf(phase)
      const p = curIdx > revIdx ? 1 : curIdx === revIdx ? Math.min(t / PHASE_SECONDS.revealing, 1) : 0
      const eased = 1 - Math.pow(1 - p, 2)
      phoneGroup.current.visible = p > 0
      phoneGroup.current.position.y = 0.12 + eased * 0.62
      phoneGroup.current.scale.setScalar(Math.min(eased * 1.3, 1))
      phoneGroup.current.rotation.y += 0.012
    }
  })

  return (
    <group>
      <group ref={boxGroup}>
        {/* Wadah bawah -- diam, cuma dasar box. Teks "RP TOWN HP" ada
            di tutupnya (lihat lidTex), BUKAN di badan box ini. */}
        <RoundedBox args={[1.1, 0.5, 0.85]} radius={0.05} smoothness={3} position={[0, -0.1, 0]}>
          <meshStandardMaterial color="#1f1f26" roughness={0.6} metalness={0.15} />
        </RoundedBox>

        {/* Tutup -- dipivot di tepi belakang (group dipindah dulu ke
            tepi, baru RoundedBox-nya digeser balik ke tengah di dalam
            group itu), biar rotasinya kebuka kayak engsel peti, bukan
            muter di tengah-tengah tutupnya sendiri. */}
        <group position={[0, 0.17, -0.42]} ref={lidGroup}>
          <RoundedBox args={[1.14, 0.22, 0.85]} radius={0.05} smoothness={3} position={[0, 0, 0.42]}>
            <meshStandardMaterial color="#2a2a33" roughness={0.55} metalness={0.15} />
          </RoundedBox>
          <mesh position={[0, 0.112, 0.42]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.78, 0.26]} />
            <meshBasicMaterial map={lidTex} toneMapped={false} />
          </mesh>
        </group>

        {/* Sumber cahaya dalam box -- disc emissive + point light asli,
            warna & intensitasnya didorong dari useFrame di atas. */}
        <mesh ref={glowRef} position={[0, 0.05, 0]}>
          <circleGeometry args={[0.32, 24]} />
          <meshBasicMaterial color={glowColor} transparent opacity={0} toneMapped={false} />
        </mesh>
        <pointLight ref={lightRef} position={[0, 0.3, 0]} color={glowColor} intensity={0} distance={2.5} />
      </group>

      {/* HP hasil -- dibungkus group sendiri (posisi/scale-nya di-drive
          useFrame), CATATAN JUJUR: rotasi default di bawah ini tebakan
          awal biar kameranya (lihat GatchaReveal) kelihatan layar/body
          HP-nya dari depan -- kalau pas dites kebalik/miring, angka
          rotation di group ini yang pertama di-nudge. */}
      <group ref={phoneGroup} position={[0, 0.12, 0]} visible={false}>
        <group rotation={[0.2, 0.5, 0]}>
          {isBarPhone(variant) ? <BarPhone variant={variant} /> : <FoldablePhone variant={variant} foldT={1} />}
        </group>
      </group>
    </group>
  )
}

export default function GatchaReveal({ itemType, onClose }) {
  const [phase, setPhase] = useState('idle')
  const timers = useRef([])

  const variant = useMemo(() => (itemType ? getAnyPhoneVariant(itemType.id) : null), [itemType])
  const rarity = itemType?.rarity || variant?.rarity || 'common'
  const isBigReveal = rarity === 'epic' || rarity === 'legendary'

  // Reset tiap kali item baru dikasih (misal warga buka box lagi abis
  // nutup hasil sebelumnya) + beresin timer lama biar gak numpuk/nyasar
  // ngubah phase punya reveal yang udah ditutup.
  useEffect(() => {
    setPhase('idle')
    timers.current.forEach(clearTimeout)
    timers.current = []
  }, [itemType])

  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  function schedule(nextPhase, afterSeconds) {
    timers.current.push(setTimeout(() => setPhase(nextPhase), afterSeconds * 1000))
  }

  function handleOpen() {
    hapticSelect()
    setPhase('shaking')
    schedule('opening', PHASE_SECONDS.shaking)
    schedule('glowing', PHASE_SECONDS.shaking + PHASE_SECONDS.opening)
    schedule('bursting', PHASE_SECONDS.shaking + PHASE_SECONDS.opening + glowDuration(rarity))
    schedule('revealing', PHASE_SECONDS.shaking + PHASE_SECONDS.opening + glowDuration(rarity) + PHASE_SECONDS.bursting)
    schedule(
      'done',
      PHASE_SECONDS.shaking + PHASE_SECONDS.opening + glowDuration(rarity) + PHASE_SECONDS.bursting + PHASE_SECONDS.revealing
    )
  }

  // Confetti (DOM 2D biasa, bukan di dalam Canvas) -- cuma buat
  // epic/legendary, dipicu SEKALI pas masuk phase 'bursting'.
  useEffect(() => {
    if (phase !== 'bursting' || !isBigReveal) return
    hapticSuccess()
  }, [phase, isBigReveal])

  if (!itemType || !variant) return null

  return (
    <div className="gatcha-reveal-overlay">
      <div className="gatcha-reveal-canvas-wrap">
        {/* Kamera default react-three-fiber TIDAK auto nunjuk ke origin --
            dia cuma duduk di `position` dengan rotasi netral (ngadep -Z
            lurus, gak nunduk/nengadah). Jadi tinggi (Y) kamera di sini
            HARUS disetel ke tengah vertikal konten (box + HP yang naik
            ke atas pas reveal), bukan ditebak -- sebelumnya y=0.55 bikin
            framing-nya mepet ke box doang, HP yang naik ke atas jadi
            kepotong di luar frame. Konten totalnya kira-kira dari
            y=-0.35 (dasar box) sampai y=1.15 (puncak HP pas full reveal),
            tengahnya ~0.4 -- itu yang dipakai jadi tinggi kamera. Jarak
            (Z) dimundurin dari 2.3 ke 3.1 + fov dinaikin dikit ke 36
            biar ada margin ekstra, gak mepet persis di tepi. */}
        {/* Masih kurang turun dikit (laporan dari screenshot) -- Y
            kamera diturunin lagi 0.4 -> 0.25 (geser "jendela lihat"-nya
            ke bawah, jadi area atas yang tadi kepotong ikut masuk
            frame), sekalian jarak dimundurin lagi 3.1 -> 3.4 + fov naik
            dikit ke 38 biar ada margin lega, bukan pas-pasan lagi. */}
        <Canvas dpr={[1, 1.5]} camera={{ fov: 38, position: [0, 0.25, 3.4] }}>
          <ambientLight intensity={0.8} />
          <directionalLight position={[3, 5, 4]} intensity={1.1} />
          <directionalLight position={[-3, 2, -4]} intensity={0.35} />
          <hemisphereLight args={['#8f8fd9', '#0b1220', 0.5]} />
          <Suspense fallback={null}>
            <GatchaBoxScene phase={phase} rarity={rarity} variant={variant} />
          </Suspense>
        </Canvas>

        {isBigReveal && phase === 'bursting' && (
          <div className={`gatcha-confetti gatcha-confetti-${rarity}`}>
            {Array.from({ length: 22 }).map((_, i) => (
              <span key={i} style={{ left: `${Math.random() * 100}%`, animationDelay: `${Math.random() * 0.15}s` }} />
            ))}
          </div>
        )}
      </div>

      {phase === 'idle' && (
        <button type="button" className="gatcha-tap-btn" onClick={handleOpen}>
          Sentuh buat buka
        </button>
      )}

      <div className={`gatcha-result-card${phase === 'done' ? ' show' : ''} rarity-${rarity}`}>
        <span className="gatcha-result-rarity">{rarity}</span>
        <p className="gatcha-result-name">{variant.label}</p>
        <button type="button" className="gatcha-result-close" onClick={onClose}>
          Oke
        </button>
      </div>
    </div>
  )
}
