// ============================================================
// rpCamera.js -- jembatan antara HUD kamera RP (DOM) dan Canvas 3D dunia RP.
//
// <RpCaptureBridge/> (di dalam <Canvas>, lihat components/RpCameraHud.jsx)
// mendaftarkan fungsi jepret di sini; HUD tinggal manggil captureRpPhoto().
// ============================================================
let captureFn = null

export function registerRpCapture(fn) {
  captureFn = fn
  return () => { if (captureFn === fn) captureFn = null }
}

// Return data URL jpeg dari tampilan dunia saat ini, atau null kalau belum siap.
export function captureRpPhoto() {
  try {
    return captureFn ? captureFn() : null
  } catch (err) {
    console.warn('[RP Town] gagal jepret kamera RP:', err)
    return null
  }
}
