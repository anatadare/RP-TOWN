// Wrapper kecil untuk Telegram WebApp SDK.
// Di dalam Telegram, window.Telegram.WebApp otomatis tersedia.
// Saat dites di browser biasa (bukan dari dalam Telegram), kita fallback ke data dummy
// supaya development tetap bisa jalan.

const tg = typeof window !== 'undefined' ? window.Telegram?.WebApp : null

export function initTelegram() {
  if (tg) {
    tg.ready()
    tg.expand()
    tg.setHeaderColor?.('#0B1220')
    tg.setBackgroundColor?.('#0B1220')
  }
}

export function getTelegramUser() {
  const user = tg?.initDataUnsafe?.user
  if (user) {
    return {
      id: user.id,
      username: user.username || null,
      displayName: [user.first_name, user.last_name].filter(Boolean).join(' '),
      photoUrl: user.photo_url || null,
    }
  }
  // Fallback untuk development di browser biasa (bukan dari dalam Telegram)
  return {
    id: 0,
    username: 'dev_tester',
    displayName: 'Dev Tester',
    photoUrl: null,
  }
}

export function openTelegramLink(url) {
  if (tg?.openTelegramLink) {
    tg.openTelegramLink(url)
  } else {
    window.open(url, '_blank')
  }
}

export function hapticSelect() {
  tg?.HapticFeedback?.selectionChanged?.()
}

export function hapticSuccess() {
  tg?.HapticFeedback?.notificationOccurred?.('success')
}

export const isInsideTelegram = Boolean(tg)

// Dipakai pas masuk mode Jelajahi (jalan-jalan 3D): geser vertikal dipakai
// buat putar kamera, jadi gesture "swipe to close/minimize" bawaan Telegram
// harus dimatikan sementara supaya mini app gak ke-minimize gak sengaja.
export function lockTelegramSwipe() {
  tg?.disableVerticalSwipes?.()
}

export function unlockTelegramSwipe() {
  tg?.enableVerticalSwipes?.()
  tg?.disableClosingConfirmation?.()
}

// Layar penuh + kunci orientasi landscape, dipakai bareng Screen Orientation
// API di TownWalk.jsx pas masuk/keluar mode Jelajahi. Semua ini no-op kalau
// gak jalan di dalem Telegram (tg null) atau versi client-nya belum dukung.
export function requestTelegramFullscreen() {
  tg?.requestFullscreen?.()
}

export function exitTelegramFullscreen() {
  tg?.exitFullscreen?.()
}

// Catatan: lockOrientation() Telegram cuma ngunci ke orientasi yang LAGI
// AKTIF saat dipanggil (bukan maksa ganti ke landscape) -- makanya di
// TownWalk.jsx ini dipanggil SETELAH screen.orientation.lock('landscape')
// berhasil, biar yang dikunci beneran udah landscape.
export function lockTelegramOrientation() {
  tg?.lockOrientation?.()
}

export function unlockTelegramOrientation() {
  tg?.unlockOrientation?.()
}
