import { hapticSelect } from '../lib/telegram'
import { isBarPhone } from './phoneCatalog'
import './phone/phone.css'

// ============================================================
// PhoneButton -- tombol HP di mode Jelajahi. Dipisah dari tas
// (PhoneInventory) karena HP yang paling sering dibuka. Posisinya
// persis di bawah tombol peta, ukurannya sama.
//
// Tap -> popup aksi BERGULIR KE KANAN:
//   - 📲 Buka Layar  : buka layar HP (UI per brand, lihat components/phone/)
//   - 📴/📱 Tutup/Buka HP : cuma buat HP lipat (HP bar gak bisa dilipat)
// Kalau belum ada HP yang dipasang, popup cuma ngasih tau buat pasang
// dulu dari tas.
//
// Props:
//  - open, onToggle(), onClose() : dikontrol parent (TownWalk)
//  - variant   : varian HP yang lagi dipasang (atau null)
//  - foldT     : 0..1, state buka/tutup HP yang lagi dipasang
//  - onOpenScreen(), onSetFold(value)
// ============================================================

export default function PhoneButton({ open, onToggle, onClose, variant, foldT, onOpenScreen, onSetFold }) {
  const hasPhone = !!variant
  const isBar = hasPhone ? isBarPhone(variant) : false

  return (
    <div className="walk-hp-picker">
      {open && <div className="walk-map-backdrop" onClick={onClose} />}
      <button
        type="button"
        className="walk-map-btn walk-hp-btn"
        aria-label="HP"
        aria-expanded={open}
        onClick={() => {
          hapticSelect()
          onToggle?.()
        }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <rect x="7" y="2.5" width="10" height="19" rx="2.5" stroke="currentColor" strokeWidth="2" />
          <path d="M10.5 18.5h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div className="walk-map-popup walk-hp-popup">
          {hasPhone ? (
            <>
              <button
                type="button"
                className="walk-inv-screen-btn"
                onClick={() => {
                  hapticSelect()
                  onClose?.()
                  onOpenScreen?.()
                }}
              >
                📲 Buka Layar
              </button>
              {!isBar && (
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
            </>
          ) : (
            <span className="walk-hp-empty">Belum ada HP dipasang — pilih dari tas dulu</span>
          )}
        </div>
      )}
    </div>
  )
}
