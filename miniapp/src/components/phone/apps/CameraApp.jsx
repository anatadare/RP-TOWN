import { useCallback, useEffect, useRef, useState } from 'react'
import { loadPhotos, savePhotos, setPendingShare } from '../../../lib/phoneApps'
import { hapticSelect, hapticSuccess } from '../../../lib/telegram'
import { IconSwap, IconTrash, IconClose, IconSocial } from '../PhoneIcons'

// Kecilkan gambar ke max 720px sisi terpanjang -> jpeg, biar muat di localStorage.
function shrinkToDataUrl(source, sw, sh) {
  const max = 720
  const scale = Math.min(1, max / Math.max(sw, sh))
  const c = document.createElement('canvas')
  c.width = Math.round(sw * scale)
  c.height = Math.round(sh * scale)
  c.getContext('2d').drawImage(source, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.7)
}

export default function CameraApp({ onOpenApp, onOpenRpCamera }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const fileRef = useRef(null)
  const [facing, setFacing] = useState('environment')
  const [streamError, setStreamError] = useState(null)
  const [ready, setReady] = useState(false)
  const [photos, setPhotos] = useState(() => loadPhotos())
  const [view, setView] = useState('camera') // 'camera' | 'gallery'
  const [openPhoto, setOpenPhoto] = useState(null)
  const [flash, setFlash] = useState(false)

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  useEffect(() => {
    if (view !== 'camera') return undefined
    let cancelled = false
    setReady(false)
    setStreamError(null)
    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStreamError('Kamera langsung tidak didukung di sini.')
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream
        const v = videoRef.current
        if (v) {
          v.srcObject = stream
          await v.play().catch(() => {})
          setReady(true)
        }
      } catch (err) {
        console.warn('[RP Town] kamera gagal:', err)
        if (!cancelled) setStreamError('Izin kamera ditolak atau kamera tidak tersedia.')
      }
    }
    start()
    return () => { cancelled = true; stopStream() }
  }, [facing, view, stopStream])

  function addPhoto(dataUrl) {
    const next = [{ id: Date.now(), src: dataUrl, kind: 'real' }, ...photos].slice(0, 12)
    setPhotos(next)
    savePhotos(next)
    hapticSuccess()
    setFlash(true)
    setTimeout(() => setFlash(false), 140)
  }

  function snap() {
    const v = videoRef.current
    if (!v || !ready || !v.videoWidth) return
    hapticSelect()
    addPhoto(shrinkToDataUrl(v, v.videoWidth, v.videoHeight))
  }

  // Cadangan kalau getUserMedia diblokir (sering di WebView): input file
  // dengan capture="environment" membuka kamera bawaan HP asli.
  function onFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      addPhoto(shrinkToDataUrl(img, img.naturalWidth, img.naturalHeight))
      URL.revokeObjectURL(url)
    }
    img.src = url
  }

  function remove(id) {
    const next = photos.filter((p) => p.id !== id)
    setPhotos(next)
    savePhotos(next)
    setOpenPhoto(null)
  }

  if (view === 'gallery') {
    return (
      <div className="ph-gallery">
        {photos.length === 0 && <p className="ph-state">Belum ada foto.</p>}
        <div className="ph-gallery-grid">
          {photos.map((p) => (
            <button key={p.id} type="button" className="ph-thumb" onClick={() => setOpenPhoto(p)}>
              <img src={p.src} alt="" />
              {p.kind === 'rp' && <i className="ph-thumb-tag">RP</i>}
            </button>
          ))}
        </div>
        <button type="button" className="ph-btn ph-btn-primary ph-gallery-back" onClick={() => setView('camera')}>
          Kembali ke kamera
        </button>
        {openPhoto && (
          <div className="ph-photo-viewer">
            <img src={openPhoto.src} alt="" />
            <div className="ph-photo-actions">
              <button
                type="button"
                className="ph-round"
                aria-label="Bagikan ke Sosmed"
                onClick={() => { hapticSelect(); setPendingShare(openPhoto.src); onOpenApp?.('social') }}
              >
                <IconSocial width={20} height={20} />
              </button>
              <button type="button" className="ph-round" aria-label="Hapus foto" onClick={() => remove(openPhoto.id)}>
                <IconTrash width={20} height={20} />
              </button>
              <button type="button" className="ph-round" aria-label="Tutup" onClick={() => setOpenPhoto(null)}>
                <IconClose width={20} height={20} />
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="ph-camera">
      <div className="ph-viewfinder">
        {onOpenRpCamera && (
          <div className="ph-cam-mode" role="group" aria-label="Mode kamera">
            <button type="button" className="is-on" aria-pressed="true">Real</button>
            <button type="button" onClick={() => { hapticSelect(); onOpenRpCamera() }}>RP</button>
          </div>
        )}
        <video ref={videoRef} playsInline muted className={facing === 'user' ? 'is-mirror' : ''} />
        {!ready && !streamError && <p className="ph-cam-note">Membuka kamera...</p>}
        {streamError && (
          <div className="ph-cam-note">
            <p>{streamError}</p>
            <button type="button" className="ph-btn ph-btn-primary" onClick={() => fileRef.current?.click()}>
              Ambil foto lewat kamera HP
            </button>
          </div>
        )}
        {flash && <div className="ph-flash" />}
      </div>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
      <div className="ph-cam-controls">
        <button type="button" className="ph-cam-thumb" aria-label="Galeri" onClick={() => setView('gallery')}>
          {photos[0] ? <img src={photos[0].src} alt="" /> : <span />}
        </button>
        <button type="button" className="ph-shutter" aria-label="Ambil foto" onClick={snap} disabled={!ready}>
          <span />
        </button>
        <button
          type="button"
          className="ph-round"
          aria-label="Ganti kamera"
          onClick={() => { hapticSelect(); setFacing((f) => (f === 'environment' ? 'user' : 'environment')) }}
        >
          <IconSwap width={22} height={22} />
        </button>
      </div>
    </div>
  )
}
