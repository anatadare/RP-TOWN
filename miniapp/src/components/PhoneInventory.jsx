import { useState } from 'react'
import CharacterPreview from './CharacterPreview'
import { PHONE_VARIANTS } from './phoneVariants'
import { hapticSelect } from '../lib/telegram'

// ============================================================
// PhoneInventory -- tombol tas (inventory) di mode Jelajahi.
//
// Alur: tombol tas -> panel item ("HP" x1) -> klik -> daftar 15 varian
// HP yang kita bikin di phoneVariants.js -> klik salah satu -> modal
// preview karakter (model yang lagi dipakai jalan-jalan) megang HP
// itu, lengkap sama slider buka/tutup biar bisa dites logic-nya
// langsung.
//
// CATATAN: ini baru PREVIEW (nunjukin tampilan aja). Karakter yang
// jalan-jalan di peta 3D belum ikutan pegang HP-nya secara live --
// itu kerjaan terpisah (nempelin ke WalkPlayer di TownWalk.jsx) kalau
// nanti mau dilanjutin.
// ============================================================

function BagIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path
        d="M8 8V6.5a4 4 0 0 1 8 0V8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <rect x="4" y="8" width="16" height="12" rx="2.5" stroke="currentColor" strokeWidth="2" />
      <path d="M4 12.5h16" stroke="currentColor" strokeWidth="1.6" opacity="0.6" />
    </svg>
  )
}

const FOLD_LABELS = { flip: 'Flip', book: 'Buku' }

export default function PhoneInventory({ modelUrl }) {
  // 'closed' | 'items' | 'phones'
  const [screen, setScreen] = useState('closed')
  const [previewId, setPreviewId] = useState(null)
  const [foldT, setFoldT] = useState(1)

  const isOpen = screen !== 'closed'

  function toggleOpen() {
    hapticSelect()
    setScreen((s) => (s === 'closed' ? 'items' : 'closed'))
  }

  function openPhone(id) {
    hapticSelect()
    setFoldT(1)
    setPreviewId(id)
  }

  function closePreview() {
    setPreviewId(null)
  }

  return (
    <>
      <div className="walk-inv-picker">
        {isOpen && <div className="walk-map-backdrop" onClick={() => setScreen('closed')} />}
        <button
          type="button"
          className="walk-map-btn walk-inv-btn"
          aria-label="Inventaris"
          aria-expanded={isOpen}
          onClick={toggleOpen}
        >
          <BagIcon />
        </button>

        {screen === 'items' && (
          <div className="walk-map-popup walk-inv-popup">
            <button type="button" className="walk-map-popup-item walk-inv-item" onClick={() => { hapticSelect(); setScreen('phones') }}>
              📱 HP <span className="walk-inv-item-count">{PHONE_VARIANTS.length}</span>
            </button>
          </div>
        )}

        {screen === 'phones' && (
          <div className="walk-map-popup walk-inv-popup walk-inv-popup-wide">
            <button type="button" className="walk-map-popup-item walk-inv-back" onClick={() => { hapticSelect(); setScreen('items') }}>
              ← Kembali
            </button>
            <div className="walk-inv-phone-list">
              {PHONE_VARIANTS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className="walk-inv-phone-item"
                  onClick={() => openPhone(v.id)}
                >
                  <span className="walk-inv-phone-swatch" style={{ background: v.colors.body }} />
                  <span className="walk-inv-phone-name">{v.label}</span>
                  <span className="walk-inv-phone-type">{FOLD_LABELS[v.foldType]}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {previewId && (
        <div className="walk-inv-preview-overlay">
          <div className="walk-inv-preview-backdrop" onClick={closePreview} />
          <div className="walk-inv-preview-panel">
            <button type="button" className="walk-inv-preview-close" aria-label="Tutup" onClick={closePreview}>
              ✕
            </button>
            <CharacterPreview
              key={previewId}
              modelUrl={modelUrl}
              className="walk-inv-preview-canvas"
              draggable
              pose="phone"
              phoneVariant={previewId}
              foldT={foldT}
            />
            <div className="walk-inv-preview-controls">
              <span className="walk-inv-preview-label">
                {foldT < 0.5 ? 'Tertutup' : foldT > 0.95 ? 'Terbuka' : 'Membuka…'}
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={foldT}
                onChange={(e) => setFoldT(Number(e.target.value))}
                className="walk-inv-preview-slider"
                aria-label="Buka / tutup HP"
              />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
