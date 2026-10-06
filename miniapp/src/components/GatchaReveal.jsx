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
// nge-reveal hasil yang udah ada, bukan nentuin hasil.
//
// 4 KALI TAP (bukan 1 tombol "sentuh buat buka" -- itu dihapus, warga
// pasti udah paham ini box gatcha, gak perlu diinstruksiin):
//   tap 1 -> toast "Welcome to RP Town", box goyang dikit, MASIH NUTUP
//   tap 2 -> toast "Semoga betah ya di RP Town", mulai spil warna
//            rarity + tutup kebuka dikit
//   tap 3 -> toast "Ini ada HP buat kamu", tutup kebuka setengah,
//            warna rarity makin cerah
//   tap 4 -> box kebuka penuh + flash + HP keluar + muter (confetti
//            kalau epic/legendary) -- ini doang yang jalan OTOMATIS
//            lewat timer (burst -> reveal -> kartu hasil), tap 1-3
//            semuanya nunggu warga, gak ada auto-advance.
// Seluruh area canvas yang jadi target tap (bukan tombol teks).
// ============================================================

const GLOW_COLOR = {
  common: '#cfd3d8',
  rare: '#cfd3d8',
  epic: '#b36bff',
  legendary: '#ffb23f',
}

// Target visual (seberapa kebuka tutupnya 0..1, seberapa terang cahaya
// 0..1) per tahap tap -- BUKAN di-animasiin pakai kurva waktu kayak
// sebelumnya (soalnya sekarang jedanya tergantung warga nge-tap kapan,
// gak bisa ditebak), tapi di-LERP ke angka target ini tiap frame di
// useFrame GatchaBoxScene. Jadi kapan pun tap berikutnya dateng, nilai
// yang lagi jalan otomatis "ngejar" ke target baru dengan mulus.
const TAP_TARGET = {
  idle: { lidOpen: 0, glow: 0 },
  tap1: { lidOpen: 0, glow: 0 },
  tap2: { lidOpen: 0.16, glow: 0.35 },
  tap3: { lidOpen: 0.5, glow: 0.65 },
  bursting: { lidOpen: 0.5, glow: 1 },
  revealing: { lidOpen: 1, glow: 0.18 },
  done: { lidOpen: 1, glow: 0 },
}

const TOAST_BY_TAP = {
  1: 'Welcome to RP Town',
  2: 'Semoga betah ya di RP Town',
  3: 'Ini ada HP buat kamu',
}

const PHASE_AFTER_TAP = { 1: 'tap1', 2: 'tap2', 3: 'tap3', 4: 'bursting' }

const PHASE_ORDER = ['idle', 'tap1', 'tap2', 'tap3', 'bursting', 'revealing', 'done']
const BURST_SECONDS = 0.3
const REVEAL_SECONDS = 0.9
const TOAST_SECONDS = 1.7

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

// Isi <Canvas>: box + cahaya + HP hasil. `phase` nentuin TARGET
// (lidOpen/glow dari TAP_TARGET), tapi nilai yang beneran dipakai buat
// render (lidOpenRef/glowRef) di-LERP pelan-pelan ngejar target itu
// tiap frame -- jadi transisi antar tap selalu mulus walau jedanya
// gak teratur. `tapPulseAt` (timestamp performance.now()) dipakai buat
// munculin goyangan singkat tiap kali tap baru masuk, independen dari
// si lerp.
function GatchaBoxScene({ phase, tapPulseAt, rarity, variant }) {
  const lidGroup = useRef()
  const boxGroup = useRef()
  const glowRef = useRef()
  const lightRef = useRef()
  const phoneGroup = useRef()
  const lidOpenCurrent = useRef(0)
  const glowCurrent = useRef(0)
  const burstStartRef = useRef(null)
  const revealStartRef = useRef(null)
  const lidTex = useLidLabelTexture()
  const glowColor = useMemo(() => new THREE.Color(GLOW_COLOR[rarity] || GLOW_COLOR.common), [rarity])

  useEffect(() => {
    if (phase === 'bursting') burstStartRef.current = performance.now()
    if (phase === 'revealing') revealStartRef.current = performance.now()
  }, [phase])

  useFrame((_, delta) => {
    // Goyang singkat tiap tap -- bukan dari `phase` (biar tap 1,2,3 yang
    // phase-nya beda-beda tetep sama-sama dapet efek "kedengeran" pas
    // di-tap), tapi dari timestamp tap terakhir.
    if (boxGroup.current) {
      const since = tapPulseAt ? (performance.now() - tapPulseAt) / 1000 : 999
      const amp = since < 0.3 ? (1 - since / 0.3) * 0.022 : 0
      boxGroup.current.position.x = amp ? Math.sin(since * 55) * amp : 0
      boxGroup.current.rotation.z = amp ? Math.sin(since * 46 + 1) * amp : 0
    }

    // Target lidOpen/glow dari tahap sekarang, di-lerp pelan (gak
    // loncat) -- LERP_SPEED lebih cepet dari durasi tap biasa (warga
    // gak nunggu lama), tapi masih kerasa "meleleh", bukan instan.
    const target = TAP_TARGET[phase] || TAP_TARGET.idle
    const lerpSpeed = 6
    lidOpenCurrent.current += (target.lidOpen - lidOpenCurrent.current) * Math.min(delta * lerpSpeed, 1)
    glowCurrent.current += (target.glow - glowCurrent.current) * Math.min(delta * lerpSpeed, 1)

    if (lidGroup.current) {
      lidGroup.current.rotation.x = -lidOpenCurrent.current * (Math.PI * 0.68)
    }

    // Burst sekejap -- ledakan cahaya pas tap ke-4 masuk phase
    // 'bursting', DI ATAS nilai glow hasil lerp biasa (biar tetep
    // keliatan "meledak", bukan cuma nambah pelan kayak tap 2->3).
    let burstBoost = 0
    let burstScaleBoost = 0
    if (phase === 'bursting' && burstStartRef.current) {
      const p = Math.min((performance.now() - burstStartRef.current) / 1000 / BURST_SECONDS, 1)
      burstBoost = (1 - p) * 0.6
      burstScaleBoost = p * 2.2
    }

    if (glowRef.current) {
      glowRef.current.scale.setScalar(0.4 + glowCurrent.current * 0.5 + burstScaleBoost)
      glowRef.current.material.opacity = Math.min(glowCurrent.current + burstBoost, 1) * 0.85
    }
    if (lightRef.current) lightRef.current.intensity = Math.min(glowCurrent.current + burstBoost, 1) * 3.5

    // HP-nya naik dari dalam box + muter pelan terus-terusan sambil
    // nongol, mulai dari phase 'revealing'.
    if (phoneGroup.current) {
      const revIdx = PHASE_ORDER.indexOf('revealing')
      const curIdx = PHASE_ORDER.indexOf(phase)
      let p = 0
      if (curIdx > revIdx) p = 1
      else if (phase === 'revealing' && revealStartRef.current) {
        p = Math.min((performance.now() - revealStartRef.current) / 1000 / REVEAL_SECONDS, 1)
      }
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
  const [tapCount, setTapCount] = useState(0)
  const [tapPulseAt, setTapPulseAt] = useState(null)
  const [toast, setToast] = useState(null)
  const timers = useRef([])

  const variant = useMemo(() => (itemType ? getAnyPhoneVariant(itemType.id) : null), [itemType])
  const rarity = itemType?.rarity || variant?.rarity || 'common'
  const isBigReveal = rarity === 'epic' || rarity === 'legendary'

  // Reset tiap kali item baru dikasih (misal warga buka box lagi abis
  // nutup hasil sebelumnya) + beresin timer lama biar gak numpuk/nyasar
  // ngubah phase punya reveal yang udah ditutup.
  useEffect(() => {
    setPhase('idle')
    setTapCount(0)
    setTapPulseAt(null)
    setToast(null)
    timers.current.forEach(clearTimeout)
    timers.current = []
  }, [itemType])

  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  function schedule(fn, afterSeconds) {
    timers.current.push(setTimeout(fn, afterSeconds * 1000))
  }

  function handleTap() {
    if (phase === 'bursting' || phase === 'revealing' || phase === 'done') return // tap 4 udah jalan, abaikan tap susulan
    const next = tapCount + 1
    setTapCount(next)
    setTapPulseAt(performance.now())
    hapticSelect()

    const nextPhase = PHASE_AFTER_TAP[next]
    setPhase(nextPhase)

    const toastText = TOAST_BY_TAP[next]
    if (toastText) {
      setToast(toastText)
      schedule(() => setToast(null), TOAST_SECONDS)
    }

    // Cuma tap ke-4 yang jalan otomatis (burst -> reveal -> done).
    // Tap 1-3 berhenti nunggu tap berikutnya, gak ada timer lanjutan.
    if (next === 4) {
      hapticSuccess()
      schedule(() => setPhase('revealing'), BURST_SECONDS)
      schedule(() => setPhase('done'), BURST_SECONDS + REVEAL_SECONDS)
    }
  }

  if (!itemType || !variant) return null

  return (
    <div className="gatcha-reveal-overlay">
      <div
        className="gatcha-reveal-canvas-wrap"
        role="button"
        aria-label="Buka box"
        onClick={handleTap}
      >
        <Canvas dpr={[1, 1.5]} camera={{ fov: 38, position: [0, 0.25, 3.4] }}>
          <ambientLight intensity={0.8} />
          <directionalLight position={[3, 5, 4]} intensity={1.1} />
          <directionalLight position={[-3, 2, -4]} intensity={0.35} />
          <hemisphereLight args={['#8f8fd9', '#0b1220', 0.5]} />
          <Suspense fallback={null}>
            <GatchaBoxScene phase={phase} tapPulseAt={tapPulseAt} rarity={rarity} variant={variant} />
          </Suspense>
        </Canvas>

        {isBigReveal && phase === 'bursting' && (
          <div className={`gatcha-confetti gatcha-confetti-${rarity}`}>
            {Array.from({ length: 22 }).map((_, i) => (
              <span key={i} style={{ left: `${Math.random() * 100}%`, animationDelay: `${Math.random() * 0.15}s` }} />
            ))}
          </div>
        )}

        {/* Toast tap 1-3 -- "Welcome to RP Town" dst, fade sendiri abis
            TOAST_SECONDS, BUKAN instruksi cara main (itu yang dihapus). */}
        <div className={`gatcha-toast${toast ? ' show' : ''}`}>{toast}</div>
      </div>

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
