import { useEffect, useRef, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { registerRpCapture, captureRpPhoto } from '../lib/rpCamera'
import { addGalleryPhoto } from '../lib/phoneApps'
import { hapticSelect, hapticSuccess } from '../lib/telegram'
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

// HUD kamera RP: nongol di atas dunia saat mode RP aktif. Karakter masih bisa
// digerakkan / kamera diputar buat cari angle; pose menyusul (tombolnya nanti di sini).
export default function RpCameraHud({ onSwitchReal, onClose }) {
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

  return (
    <div className="rpcam-hud">
      <div className="rpcam-top">
        <div className="rpcam-switch" role="group" aria-label="Mode kamera">
          <button type="button" onClick={() => { hapticSelect(); onSwitchReal() }}>Real</button>
          <button type="button" className="is-on" aria-pressed="true">RP</button>
        </div>
        <button type="button" className="rpcam-x" onClick={() => { hapticSelect(); onClose() }} aria-label="Tutup kamera RP">✕</button>
      </div>

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
