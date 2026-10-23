import { useEffect, useRef, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { registerRpCapture, captureRpPhoto } from '../lib/rpCamera'
import { addGalleryPhoto } from '../lib/phoneApps'
import { hapticSelect, hapticSuccess, getPhoneUiMode } from '../lib/telegram'
import { IconSwap } from './phone/PhoneIcons'
import './RpCameraHud.css'

const RP_MAX_SIDE = 960 // sisi terpanjang foto RP (px); galeri disimpan di localStorage

// Dipasang DI DALAM <Canvas>. Jepret = render 1 frame lagi lalu langsung salin ke
// canvas 2D di tick yang sama (buffer WebGL masih valid), jadi gak perlu
// preserveDrawingBuffer (yang bikin render lebih berat).
export function RpCaptureBridge() {
  const get = useThree((s) => s.get)
  useEffect(() => registerRpCapture(() => {
    const { gl, scene, camera } = get()
    gl.render(scene, camera)
    const src = gl.domElement
    const scale = Math.min(1, RP_MAX_SIDE / Math.max(src.width, src.height))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(src.width * scale))
    c.height = Math.max(1, Math.round(src.height * scale))
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', 0.8)
  }), [get])
  return null
}

// HUD kamera RP: nongol di atas dunia saat mode RP aktif. Gambarnya dari kamera
// HP karakter: `facing` 'back' (kamera belakang) / 'front' (kamera depan / selfie).
// Karakter masih bisa digerakkan / layar digeser buat cari angle.
//  - HP (Telegram Android/iOS): semua tombol dipadatkan di bar bawah (atas dikosongkan
//    karena bertumpuk dengan tombol "Tutup" mini app).
//  - PC: susunan lama (switch di atas), ditambah tombol ganti kamera.
const FACING_LABEL = { back: 'Belakang', front: 'Depan' }

export default function RpCameraHud({ facing = 'back', onFlip, onSwitchReal, onClose }) {
  const compact = getPhoneUiMode() === 'full'
  const [flash, setFlash] = useState(false)
  const [toast, setToast] = useState(null) // { src } | { error }
  const timer = useRef(null)

  useEffect(() => () => clearTimeout(timer.current), [])

  function showToast(t) {
    setToast(t)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(null), 1900)
  }

  function snap() {
    hapticSelect()
    const src = captureRpPhoto()
    if (!src) { showToast({ error: 'Kamera RP belum siap, coba lagi.' }); return }
    addGalleryPhoto({ id: Date.now(), src, kind: 'rp' })
    hapticSuccess()
    setFlash(true)
    setTimeout(() => setFlash(false), 140)
    showToast({ src })
  }

  function flip() {
    hapticSelect()
    const next = facing === 'back' ? 'front' : 'back'
    onFlip?.()
    showToast({ error: `Kamera ${FACING_LABEL[next].toLowerCase()}` })
  }

  const modeSwitch = (
    <div className="rpcam-switch" role="group" aria-label="Mode kamera">
      <button type="button" onClick={() => { hapticSelect(); onSwitchReal() }}>Real</button>
      <button type="button" className="is-on" aria-pressed="true">RP</button>
    </div>
  )
  const flipBtn = (
    <button type="button" className="rpcam-flip" onClick={flip} aria-label={`Ganti kamera (sekarang: ${FACING_LABEL[facing]})`}>
      <IconSwap width={16} height={16} />
      <span>{FACING_LABEL[facing]}</span>
    </button>
  )
  const closeBtn = (
    <button type="button" className="rpcam-x" onClick={() => { hapticSelect(); onClose() }} aria-label="Tutup kamera RP">✕</button>
  )

  return (
    <div className={`rpcam-hud${compact ? ' is-compact' : ''}`}>
      {compact ? (
        <div className="rpcam-bar">
          {modeSwitch}
          {flipBtn}
          {closeBtn}
        </div>
      ) : (
        <div className="rpcam-top">
          <div className="rpcam-top-left">
            {modeSwitch}
            {flipBtn}
          </div>
          {closeBtn}
        </div>
      )}

      <button type="button" className="rpcam-shutter" onClick={snap} aria-label="Ambil foto RP"><span /></button>

      {toast && (
        <div className="rpcam-toast" role="status">
          {toast.src && <img src={toast.src} alt="" />}
          <span>{toast.error || 'Tersimpan di Galeri'}</span>
        </div>
      )}
      {flash && <div className="rpcam-flash" />}
    </div>
  )
}
