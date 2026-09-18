import CharacterPreview from './CharacterPreview'
import { getCharacterById } from '../lib/characters'

function HouseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M4 11l8-6 8 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 10v9h12v-9" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M10 19v-5h4v5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}

// Layar sambutan sebelum peta 3D. Ditampilkan App.jsx begitu citizen sudah
// punya karakter (character_id terisi) -- baik itu abis milih karakter buat
// pertama kali, atau warga lama yang balik lagi lewat tab "Beranda".
export default function Landing({ citizen, phase, ownedHouse, houseLoading, onEnterMap, onOpenHouseChat, onGoRentHouse }) {
  const character = getCharacterById(citizen?.character_id)
  const name = citizen?.display_name || citizen?.username || 'Warga'

  return (
    <div className="landing">
      <div className="landing-topbar">
        <div>
          <p className="landing-greeting">Halo, {name} 👋</p>
          <div className="landing-phase">
            <span className="phase-dot" style={{ background: phase.dot, boxShadow: `0 0 10px 2px ${phase.dot}` }} />
            <span>{phase.label}</span>
          </div>
        </div>
      </div>

      <div className="landing-hero">
        {character ? (
          <CharacterPreview modelUrl={character.modelUrl} spin={false} className="landing-hero-canvas" />
        ) : (
          <div className="landing-hero-placeholder">🏮</div>
        )}
      </div>

      <div className="landing-body">
        <div className="landing-section">
          {houseLoading ? (
            <div className="profile-house-card profile-house-empty">
              <p className="profile-house-empty-text">Memuat data rumah...</p>
            </div>
          ) : ownedHouse ? (
            <button type="button" className="profile-house-card" onClick={onOpenHouseChat}>
              <div className="profile-house-icon"><HouseIcon /></div>
              <div className="profile-house-info">
                <p className="profile-house-name">
                  {ownedHouse.district?.name || 'Rumah'} — Petak No. {ownedHouse.plot_number}
                </p>
                <p className="profile-house-sub">Ketuk untuk buka chat rumah</p>
              </div>
              <span className="profile-house-arrow">›</span>
            </button>
          ) : (
            <div className="profile-house-card profile-house-empty">
              <p className="profile-house-empty-text">Kamu belum menyewa rumah.</p>
              <button type="button" className="profile-house-cta" onClick={onGoRentHouse}>
                🏘️ Sewa rumah di Perumahan
              </button>
            </div>
          )}
        </div>

        <button type="button" className="landing-enter-btn" onClick={onEnterMap}>
          🗺️ Masuk ke Peta
        </button>
      </div>
    </div>
  )
}
