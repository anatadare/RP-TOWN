import { useState } from 'react'
import CharacterPreview from './CharacterPreview'
import { getCharacterById } from '../lib/characters'

// Layar sambutan sebelum peta 3D. Ditampilkan App.jsx begitu citizen sudah
// punya karakter (character_id terisi) -- baik itu abis milih karakter buat
// pertama kali, atau warga lama yang balik lagi lewat tab "Beranda".
//
// Isinya sengaja diringkas jadi cuma logo + sapaan + preview full-body
// karakter yang bisa diputar (geser kiri/kanan). Navigasi ke peta/rumah
// udah ditangani bottom nav & tab Profil, jadi gak perlu diduplikasi di sini.
//
// CATATAN: logo diambil dari /logo.png (folder public), BUKAN di-import dari
// src/assets. Import bikin build Vite gagal total kalau filenya gak ada di
// repo; dengan cara ini kalau logo belum keupload cuma tampil badge "RP".
export default function Landing({ citizen, phase }) {
  const character = getCharacterById(citizen?.character_id)
  const name = citizen?.display_name || citizen?.username || 'Warga'
  const [logoOk, setLogoOk] = useState(true)

  return (
    <div className="landing">
      <div className="landing-topbar">
        {logoOk ? (
          <img
            src="/logo.png"
            alt="RP Town"
            className="landing-logo"
            onError={() => setLogoOk(false)}
          />
        ) : (
          <div className="landing-logo landing-logo-fallback">RP</div>
        )}
        <div className="landing-topbar-text">
          <p className="landing-greeting">Halo, {name} 👋</p>
          <div className="landing-phase">
            <span className="phase-dot" style={{ background: phase.dot, boxShadow: `0 0 10px 2px ${phase.dot}` }} />
            <span>{phase.label}</span>
          </div>
        </div>
      </div>

      <div className="landing-hero">
        {character ? (
          <CharacterPreview
            modelUrl={character.modelUrl}
            spin={false}
            draggable
            className="landing-hero-canvas"
          />
        ) : (
          <div className="landing-hero-placeholder">🏮</div>
        )}
        {character && <p className="landing-hero-hint">↔ Geser buat muter karakter</p>}
      </div>
    </div>
  )
}
