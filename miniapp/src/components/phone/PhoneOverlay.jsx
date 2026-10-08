import { useEffect, useMemo } from 'react'
import PhoneScreen from './PhoneScreen'
import { getPhoneUiMode } from '../../lib/telegram'
import { IconClose } from './PhoneIcons'
import './phone.css'

// Wadah layar HP.
//  - mode 'full'     : popup PENUH (user Telegram Android/iOS)
//  - mode 'floating' : panel besar melayang di KANAN (user PC); dunia game
//                      di belakangnya tetap kelihatan.
// Semua event keyboard/pointer dihentikan di sini supaya ngetik di kolom
// teks (cari kontak, posting, dll) TIDAK menggerakkan karakter / memutar kamera.
export default function PhoneOverlay({ variant, citizenId, onClose, initialApp, onOpenRpCamera }) {
  const mode = useMemo(getPhoneUiMode, [])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const stop = (e) => e.stopPropagation()

  return (
    <div
      className={`ph-overlay ph-overlay-${mode}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose?.()
        e.stopPropagation()
      }}
      onKeyUp={stop}
      onPointerDown={stop}
      onTouchStart={stop}
      onWheel={stop}
    >
      <div className="ph-frame">
        <PhoneScreen variant={variant} citizenId={citizenId} onClose={onClose} initialApp={initialApp} onOpenRpCamera={onOpenRpCamera} />
        <button type="button" className="ph-close" onClick={onClose} aria-label="Tutup layar HP">
          <IconClose width={18} height={18} />
        </button>
      </div>
    </div>
  )
}
