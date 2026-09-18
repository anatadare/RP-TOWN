import { useRef, useState } from 'react'
import CharacterPreview from './CharacterPreview'
import { CHARACTERS } from '../lib/characters'
import { hapticSelect, hapticSuccess } from '../lib/telegram'

const SWIPE_THRESHOLD = 45 // px minimal geser sebelum dianggap swipe

// Layar full-screen, blocking -- gak ada tombol "skip"/tutup, karena ini
// setara "registrasi" (pilih karakter dulu baru bisa masuk ke RP Town).
// Ditampilkan App.jsx cuma kalau citizen.character_id masih null.
// Navigasi karakter pakai swipe kiri/kanan (+ tombol panah buat fallback),
// bukan grid, biar 1 karakter kelihatan full-body gak kepotong.
export default function CharacterSelect({ citizen, onConfirm }) {
  const [index, setIndex] = useState(0)
  const [saving, setSaving] = useState(false)
  const touchStartX = useRef(null)

  const total = CHARACTERS.length
  const selected = CHARACTERS[index]

  function goTo(nextIndex) {
    const wrapped = (nextIndex + total) % total
    if (wrapped === index) return
    hapticSelect()
    setIndex(wrapped)
  }

  function handleTouchStart(e) {
    touchStartX.current = e.touches[0].clientX
  }

  function handleTouchEnd(e) {
    if (touchStartX.current == null) return
    const delta = e.changedTouches[0].clientX - touchStartX.current
    touchStartX.current = null
    if (delta > SWIPE_THRESHOLD) goTo(index - 1)
    else if (delta < -SWIPE_THRESHOLD) goTo(index + 1)
  }

  async function handleConfirm() {
    hapticSuccess()
    setSaving(true)
    try {
      await onConfirm(selected.id)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="charselect">
      <div className="charselect-header">
        <p className="charselect-eyebrow">Selamat datang di RP Town</p>
        <h1 className="charselect-title">
          Halo, {citizen?.display_name || citizen?.username || 'Warga'}! Pilih karaktermu
        </h1>
        <p className="charselect-sub">Geser buat lihat pilihan lain. Bisa diganti lagi nanti.</p>
      </div>

      <div className="charselect-stage" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        <button
          type="button"
          aria-label="Karakter sebelumnya"
          className="charselect-arrow charselect-arrow-left"
          onClick={() => goTo(index - 1)}
        >
          ‹
        </button>

        <CharacterPreview key={selected.id} modelUrl={selected.modelUrl} className="charselect-stage-canvas" />

        <button
          type="button"
          aria-label="Karakter selanjutnya"
          className="charselect-arrow charselect-arrow-right"
          onClick={() => goTo(index + 1)}
        >
          ›
        </button>
      </div>

      <div className="charselect-dots">
        {CHARACTERS.map((c, i) => (
          <span key={c.id} className={`charselect-dot${i === index ? ' is-active' : ''}`} />
        ))}
      </div>

      <p className="charselect-stage-name">
        {selected.name}
        <span className="charselect-counter"> · {index + 1}/{total}</span>
      </p>

      <button type="button" className="charselect-confirm" onClick={handleConfirm} disabled={saving}>
        {saving ? 'Menyimpan...' : `Pilih ${selected.name}`}
      </button>
    </div>
  )
}
