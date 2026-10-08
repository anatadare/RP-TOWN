import { useEffect, useState } from 'react'
import { getAnyPhoneVariant, isBarPhone } from './phoneCatalog'
import { hapticSelect } from '../lib/telegram'
import './phone/phone.css'

// ============================================================
// PhoneInventory -- tombol tas (inventory) di mode Jelajahi.
//
// SEKARANG CUMA ISI TAS: pilih HP mana yang dipasang (equip) atau
// dilepas (unequip). Aksi yang SERING dipakai (buka layar HP, buka/tutup
// HP lipat) dipindah ke tombol HP sendiri -- lihat PhoneButton.jsx.
//
// HP-nya beneran nempel & ke-render di karakter yang jalan di peta 3D
// -- itu kerjaannya <WalkPlayer> di TownWalk.jsx (attach ke bone
// Fist.R punya karakter yang lagi jalan).
//
// Daftar di sini = HP yang BENERAN DIMILIKI warga (tabel citizen_items
// lewat Supabase, di-fetch di TownWalk.jsx). `equippedId` = id BARIS
// citizen_items (instance yang dimiliki), BUKAN id varian di
// phoneVariants.js/barPhoneVariants.js.
//
// Popup-nya sekarang BERGULIR KE KANAN dari tombol (bukan ke bawah).
// Buka/tutupnya dikontrol dari TownWalk (satu panel aktif sekaligus
// bareng tombol peta & tombol HP), makanya ada `open`/`onToggle`/`onClose`.
//
// Props:
//  - open, onToggle(), onClose() : status buka/tutup popup (dikontrol parent)
//  - items       : array kepemilikan warga, tiap elemen
//                   { id: <citizen_items.id>, item_type_id: <id varian> }
//  - equippedId  : citizen_items.id yang lagi dipasang (atau null)
//  - onEquip(citizenItemId), onUnequip()
//  - onClaimStarterBox(), claimingStarterBox, claimStarterBoxError
// ============================================================

export default function PhoneInventory({
  open,
  onToggle,
  onClose,
  items,
  equippedId,
  onEquip,
  onUnequip,
  onClaimStarterBox,
  claimingStarterBox,
  claimStarterBoxError,
}) {
  // 'items' (daftar kategori) | 'phones' (daftar HP yang dimiliki)
  const [screen, setScreen] = useState('items')

  // Tiap popup ditutup, balik ke daftar kategori biar pas dibuka lagi
  // mulai dari awal.
  useEffect(() => {
    if (!open) setScreen('items')
  }, [open])

  const owned = (items || []).map((it) => ({
    citizenItemId: it.id,
    variant: getAnyPhoneVariant(it.item_type_id),
  }))
  const equippedEntry = equippedId ? owned.find((o) => o.citizenItemId === equippedId) : null
  const equipped = equippedEntry?.variant || null

  return (
    <div className="walk-inv-picker">
      {open && <div className="walk-map-backdrop" onClick={onClose} />}
      <button
        type="button"
        className="walk-map-btn walk-inv-btn"
        aria-label="Inventaris"
        aria-expanded={open}
        onClick={() => {
          hapticSelect()
          onToggle?.()
        }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M8 8V6.5a4 4 0 0 1 8 0V8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <rect x="4" y="8" width="16" height="12" rx="2.5" stroke="currentColor" strokeWidth="2" />
          <path d="M4 12.5h16" stroke="currentColor" strokeWidth="1.6" opacity="0.6" />
        </svg>
        {equipped && <span className="walk-inv-btn-dot" />}
      </button>

      {open && screen === 'items' && (
        <div className="walk-map-popup walk-inv-popup">
          <button
            type="button"
            className="walk-map-popup-item walk-inv-item"
            onClick={() => {
              hapticSelect()
              setScreen('phones')
            }}
          >
            📱 HP <span className="walk-inv-item-count">{equipped ? equipped.label : `${owned.length}`}</span>
          </button>
        </div>
      )}

      {open && screen === 'phones' && (
        <div className="walk-map-popup walk-inv-popup walk-inv-popup-wide">
          <button
            type="button"
            className="walk-map-popup-item walk-inv-back"
            onClick={() => {
              hapticSelect()
              setScreen('items')
            }}
          >
            ←
          </button>

          {equipped && (
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
          )}

          {owned.length === 0 && (
            <div className="walk-inv-empty">
              <span>Belum punya HP.</span>
              {/* Jaring pengaman: box pembuka pertama biasanya otomatis
                  pas pilih karakter, tapi warga yang character_id-nya
                  udah keisi dari sebelum fitur ini ada gak pernah lewat
                  momen itu lagi -- tombol ini biar mereka tetap bisa
                  klaim manual. Server tetap yang nolak kalau ternyata
                  udah pernah dibuka. */}
              <button
                type="button"
                className="walk-inv-claim-box-btn"
                disabled={claimingStarterBox}
                onClick={() => {
                  hapticSelect()
                  onClaimStarterBox?.()
                }}
              >
                {claimingStarterBox ? 'Membuka...' : '🎁 Buka Box HP'}
              </button>
              {claimStarterBoxError && <span className="walk-inv-claim-box-error">{claimStarterBoxError}</span>}
            </div>
          )}

          {owned.map(({ citizenItemId, variant: v }) => {
            const active = citizenItemId === equippedId
            const isBar = isBarPhone(v)
            return (
              <button
                key={citizenItemId}
                type="button"
                className={`walk-inv-phone-item${active ? ' is-active' : ''}`}
                onClick={() => {
                  hapticSelect()
                  onEquip?.(citizenItemId)
                }}
              >
                <span className="walk-inv-phone-swatch" style={{ background: v.colors.body }} />
                <span className="walk-inv-phone-name">{v.label}</span>
                {/* HP bar gak punya foldType flip/book -- tampilin rarity-nya
                    (common/rare/epic/legendary) alih-alih Flip/Buku. */}
                <span className={`walk-inv-phone-type${isBar ? ` rarity-${v.rarity}` : ''}`}>
                  {isBar ? v.rarity : v.foldType === 'flip' ? 'Flip' : 'Buku'}
                </span>
                {active && <span className="walk-inv-phone-check">✓</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
