import { useState } from 'react'
import { PHONE_VARIANTS, getPhoneVariant } from './phoneVariants'
import { hapticSelect } from '../lib/telegram'

// ============================================================
// PhoneInventory -- tombol tas (inventory) di mode Jelajahi.
//
// BEDA DARI VERSI SEBELUMNYA: komponen ini SEKARANG CUMA UI PILIHAN
// (equip/unequip), gak lagi bikin Canvas/preview sendiri. HP-nya
// beneran nempel & ke-render di karakter yang jalan di peta 3D --
// itu kerjaannya <WalkPlayer> di TownWalk.jsx (attach ke bone
// Fist.R punya karakter yang lagi jalan, lihat komentar di sana).
//
// Kenapa dirombak: versi sebelumnya munculin modal <CharacterPreview>
// terpisah yang butuh `modelUrl` KARAKTER -- tapi kepasangnya kebalik
// (kepasang `modelUrl` PETA dari TownWalk), jadi yang muncul malah
// gambar jalan/pohon. Daripada nambal itu, lebih pas emang di-skip aja
// preview terpisahnya (sesuai yang diminta) dan HP-nya nempel LANGSUNG
// di karakter yang keliatan jalan di map.
//
// Props:
//  - equippedId : id varian yang lagi dipasang (atau null)
//  - foldT      : 0..1, state buka/tutup HP yang lagi dipasang
//  - onEquip(id), onUnequip(), onSetFold(value)
// ============================================================

export default function PhoneInventory({ equippedId, foldT, onEquip, onUnequip, onSetFold }) {
  // 'closed' | 'items' | 'phones'
  const [screen, setScreen] = useState('closed')
  const isOpen = screen !== 'closed'
  const equipped = equippedId ? getPhoneVariant(equippedId) : null

  function toggleOpen() {
    hapticSelect()
    setScreen((s) => (s === 'closed' ? 'items' : 'closed'))
  }

  return (
    <div className="walk-inv-picker">
      {isOpen && <div className="walk-map-backdrop" onClick={() => setScreen('closed')} />}
      <button
        type="button"
        className="walk-map-btn walk-inv-btn"
        aria-label="Inventaris"
        aria-expanded={isOpen}
        onClick={toggleOpen}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M8 8V6.5a4 4 0 0 1 8 0V8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <rect x="4" y="8" width="16" height="12" rx="2.5" stroke="currentColor" strokeWidth="2" />
          <path d="M4 12.5h16" stroke="currentColor" strokeWidth="1.6" opacity="0.6" />
        </svg>
        {equipped && <span className="walk-inv-btn-dot" />}
      </button>

      {screen === 'items' && (
        <div className="walk-map-popup walk-inv-popup">
          <button
            type="button"
            className="walk-map-popup-item walk-inv-item"
            onClick={() => {
              hapticSelect()
              setScreen('phones')
            }}
          >
            📱 HP <span className="walk-inv-item-count">{equipped ? equipped.label : `${PHONE_VARIANTS.length}`}</span>
          </button>
        </div>
      )}

      {screen === 'phones' && (
        <div className="walk-map-popup walk-inv-popup walk-inv-popup-wide">
          <button
            type="button"
            className="walk-map-popup-item walk-inv-back"
            onClick={() => {
              hapticSelect()
              setScreen('items')
            }}
          >
            ← Kembali
          </button>

          {equipped && (
            <div className="walk-inv-equipped-row">
              <button
                type="button"
                className="walk-inv-fold-btn"
                onClick={() => {
                  hapticSelect()
                  onSetFold?.(foldT > 0.5 ? 0 : 1)
                }}
              >
                {foldT > 0.5 ? '📴 Tutup HP' : '📱 Buka HP'}
              </button>
              <button
                type="button"
                className="walk-inv-unequip-btn"
                onClick={() => {
                  hapticSelect()
                  onUnequip?.()
                }}
              >
                Lepas
              </button>
            </div>
          )}

          <div className="walk-inv-phone-list">
            {PHONE_VARIANTS.map((v) => {
              const active = v.id === equippedId
              return (
                <button
                  key={v.id}
                  type="button"
                  className={`walk-inv-phone-item${active ? ' is-active' : ''}`}
                  onClick={() => {
                    hapticSelect()
                    onEquip?.(v.id)
                  }}
                >
                  <span className="walk-inv-phone-swatch" style={{ background: v.colors.body }} />
                  <span className="walk-inv-phone-name">{v.label}</span>
                  <span className="walk-inv-phone-type">{v.foldType === 'flip' ? 'Flip' : 'Buku'}</span>
                  {active && <span className="walk-inv-phone-check">✓</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
