import { useState } from 'react'
import { getAnyPhoneVariant, isBarPhone } from './phoneCatalog'
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
// BEDA LAGI (setelah migration-009-items.sql): dulu daftar di sini
// nampilin SEMUA 54 HP yang ada di kode (ALL_PHONE_VARIANTS), sekarang
// cuma nampilin HP yang BENERAN DIMILIKI warga (dari tabel
// citizen_items lewat Supabase, di-fetch di TownWalk.jsx). Makanya
// `equippedId` sekarang id BARIS citizen_items (instance yang dimiliki),
// BUKAN lagi id varian di phoneVariants.js/barPhoneVariants.js -- kalau
// warga punya 2 unit HP yang sama, itu 2 tombol terpisah di daftar ini
// (bisa diequip salah satu doang), bukan digabung jadi 1 baris.
//
// Props:
//  - items       : array kepemilikan warga, tiap elemen
//                   { id: <citizen_items.id>, item_type_id: <id varian> }
//  - equippedId  : citizen_items.id yang lagi dipasang (atau null)
//  - foldT       : 0..1, state buka/tutup HP yang lagi dipasang
//  - onEquip(citizenItemId), onUnequip(), onSetFold(value)
// ============================================================

export default function PhoneInventory({
  items,
  equippedId,
  foldT,
  onEquip,
  onUnequip,
  onSetFold,
  onClaimStarterBox,
  claimingStarterBox,
  claimStarterBoxError,
}) {
  // 'closed' | 'items' | 'phones'
  const [screen, setScreen] = useState('closed')
  const isOpen = screen !== 'closed'

  const owned = (items || []).map((it) => ({
    citizenItemId: it.id,
    variant: getAnyPhoneVariant(it.item_type_id),
  }))
  const equippedEntry = equippedId ? owned.find((o) => o.citizenItemId === equippedId) : null
  const equipped = equippedEntry?.variant || null
  // HP bar (39 varian .glb) gak bisa dilipat -- sembunyiin tombol
  // buka/tutup HP kalau yang lagi dipasang jenisnya bar.
  const equippedIsBar = equipped ? isBarPhone(equipped) : false

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
            📱 HP <span className="walk-inv-item-count">{equipped ? equipped.label : `${owned.length}`}</span>
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
              {!equippedIsBar && (
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
              )}
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
            {owned.length === 0 && (
              <div className="walk-inv-empty">
                <p>Belum punya HP.</p>
                {/* Jaring pengaman: box pembuka pertama biasanya otomatis
                    pas pilih karakter, tapi warga yang character_id-nya
                    udah keisi dari sebelum fitur ini ada gak pernah lewat
                    momen itu lagi -- tombol ini biar mereka (atau siapa
                    pun yang box-nya somehow gagal ke-trigger) tetap bisa
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
                {claimStarterBoxError && <p className="walk-inv-claim-box-error">{claimStarterBoxError}</p>}
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
                      di situ (common/rare/epic/legendary) alih-alih Flip/Buku,
                      soalnya 15 HP lipat lama belum punya field rarity sama
                      sekali (belum ada box gatcha buat mereka). */}
                  <span className={`walk-inv-phone-type${isBar ? ` rarity-${v.rarity}` : ''}`}>
                    {isBar ? v.rarity : v.foldType === 'flip' ? 'Flip' : 'Buku'}
                  </span>
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
