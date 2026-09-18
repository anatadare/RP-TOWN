import CharacterPreview from './CharacterPreview'
import { getCharacterById } from '../lib/characters'
import logo from '../assets/logo.png'

// Layar sambutan sebelum peta 3D. Ditampilkan App.jsx begitu citizen sudah
// punya karakter (character_id terisi) -- baik itu abis milih karakter buat
// pertama kali, atau warga lama yang balik lagi lewat tab "Beranda".
//
// Isinya sengaja diringkas jadi cuma logo + sapaan + preview full-body
// karakter yang bisa diputar (geser kiri/kanan). Navigasi ke peta/rumah
// udah ditangani bottom nav & tab Profil, jadi gak perlu diduplikasi di sini.
export default function Landing({ citizen, phase }) {
  const character = getCharacterById(citizen?.character_id)
  const name = citizen?.display_name || citizen?.username || 'Warga'

  return (
    <div className="landing">
      <div className="landing-topbar">
        <img src={logo} alt="RP Town" className="landing-logo" />
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
