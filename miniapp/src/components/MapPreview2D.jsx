import { useCallback, useEffect, useRef, useState } from 'react'

// ============================================================
// Preview peta 2D (pengganti Peta 3D untuk peta yang besar, mis. LPM).
// Satu gambar atas-ke-bawah yang dirender dari data glb (tools/lpm-map/build_lpm.py)
// + billboard iklan. Bisa digeser (1 jari / drag) & di-zoom (cubit / scroll).
// Peta 3D (dan file .glb besarnya) baru dimuat kalau pemain menekan "Jelajahi".
// ============================================================

const MAX_SCALE = 6
const TOP_INSET = 150 // area header + pemilih peta di atas (px)
const BOTTOM_INSET = 84 // bottom nav (px)

export default function MapPreview2D({ src, billboard }) {
  const boxRef = useRef(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [aspect, setAspect] = useState(4 / 3) // lebar / tinggi gambar (diperbarui saat gambar termuat)
  const [view, setView] = useState({ s: 1, x: 0, y: 0 })
  const [loaded, setLoaded] = useState(false)
  const pointers = useRef(new Map())
  const gesture = useRef(null)

  useEffect(() => {
    const el = boxRef.current
    if (!el) return undefined
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const imgW = size.w
  const imgH = size.w / aspect

  // Batasi geseran: gambar tidak boleh lepas dari layar.
  const clamp = useCallback(
    (v) => {
      const s = Math.min(MAX_SCALE, Math.max(1, v.s))
      const availTop = TOP_INSET
      const availBottom = size.h - BOTTOM_INSET
      const availH = availBottom - availTop
      const w = imgW * s, h = imgH * s
      const x = Math.min(0, Math.max(size.w - w, v.x))
      const y = h <= availH ? availTop + (availH - h) / 2 : Math.min(availTop, Math.max(availBottom - h, v.y))
      return { s, x, y }
    },
    [size, imgW, imgH]
  )

  // Posisi awal: pas selebar layar & di tengah area kosong.
  useEffect(() => {
    if (size.w && size.h) setView(clamp({ s: 1, x: 0, y: 0 }))
  }, [size, aspect, clamp])

  const zoomAt = useCallback(
    (cx, cy, factor) => {
      setView((v) => {
        const s = Math.min(MAX_SCALE, Math.max(1, v.s * factor))
        const k = s / v.s
        return clamp({ s, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k })
      })
    },
    [clamp]
  )

  function onPointerDown(e) {
    e.currentTarget.setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    gesture.current = null
  }
  function onPointerMove(e) {
    const p = pointers.current.get(e.pointerId)
    if (!p) return
    const rect = boxRef.current.getBoundingClientRect()
    const prev = { x: p.x, y: p.y }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pts = [...pointers.current.values()]
    if (pts.length === 1) {
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y
      setView((v) => clamp({ ...v, x: v.x + dx, y: v.y + dy }))
    } else if (pts.length >= 2) {
      const [a, b] = pts
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const mx = (a.x + b.x) / 2 - rect.left, my = (a.y + b.y) / 2 - rect.top
      const g = gesture.current
      if (g && g.dist > 0) zoomAt(mx, my, dist / g.dist)
      gesture.current = { dist }
    }
  }
  function onPointerUp(e) {
    pointers.current.delete(e.pointerId)
    gesture.current = null
  }
  function onWheel(e) {
    const rect = boxRef.current.getBoundingClientRect()
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.15 : 1 / 1.15)
  }

  return (
    <div
      ref={boxRef}
      className="map2d-viewport"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
    >
      {size.w > 0 && (
        <img
          className={`map2d-img${loaded ? ' is-loaded' : ''}`}
          src={src}
          alt="Peta LPM"
          draggable={false}
          width={imgW}
          height={imgH}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }}
          onLoad={(e) => {
            const { naturalWidth: nw, naturalHeight: nh } = e.currentTarget
            if (nw && nh) setAspect(nw / nh)
            setLoaded(true)
          }}
        />
      )}
      {!loaded && <p className="map2d-loading">Memuat peta...</p>}

      <div className="map2d-billboard" aria-label="Billboard">
        <div className="map2d-billboard-lamps">
          <i /><i /><i /><i />
        </div>
        <div className="map2d-billboard-frame">
          <div className="map2d-billboard-panel">
            {billboard?.imageUrl ? <img src={billboard.imageUrl} alt="Billboard" draggable={false} /> : <span>BILLBOARD</span>}
          </div>
        </div>
        <div className="map2d-billboard-pole" />
      </div>
    </div>
  )
}
