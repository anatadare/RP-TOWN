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
