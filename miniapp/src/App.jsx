import { useEffect, useState, useMemo, useCallback } from 'react'
import './App.css'
import { initTelegram, getTelegramUser, openTelegramLink, hapticSelect, hapticSuccess } from './lib/telegram'
import { ensureCitizen, getRoomsWithPresence, enterRoom, pollRooms } from './lib/rooms'
import TownMap3D from './components/TownMap3D'
import HousingDistrict from './components/HousingDistrict'
import { MAPS, DEFAULT_MAP_KEY, getMapByKey } from './lib/maps'

const POLL_INTERVAL_MS = 5000 // fetch ulang data tiap 5 detik

function getWorldPhase() {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 11) return { label: 'Pagi di RP Town', dot: '#ffd699' }
  if (hour >= 11 && hour < 16) return { label: 'Siang di RP Town', dot: '#ffb454' }
  if (hour >= 16 && hour < 19) return { label: 'Senja di RP Town', dot: '#ff8a5c' }
  return { label: 'Malam di RP Town', dot: '#8f8fd9' }
}

function initials(name) {
  if (!name) return '?'
  return name.trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('')
}

// Ikon-ikon kecil buat bottom nav, biar gak perlu tambah dependency icon library
function MapIcon({ active }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path
        d="M9 4l-6 2v14l6-2 6 2 6-2V4l-6 2-6-2z"
        stroke={active ? 'var(--lantern)' : 'currentColor'}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M9 4v14M15 6v14" stroke={active ? 'var(--lantern)' : 'currentColor'} strokeWidth="1.6" />
    </svg>
  )
}

function ProfileIcon({ active }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="8" r="3.6" stroke={active ? 'var(--lantern)' : 'currentColor'} strokeWidth="1.6" />
      <path
        d="M4.5 19.5c1.6-3.4 4.4-5.1 7.5-5.1s5.9 1.7 7.5 5.1"
        stroke={active ? 'var(--lantern)' : 'currentColor'}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

export default function App() {
  const [citizen, setCitizen] = useState(null)
  const [rooms, setRooms] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedRoom, setSelectedRoom] = useState(null)
  const [entering, setEntering] = useState(false)
  const [housingRoom, setHousingRoom] = useState(null)
  const [adminMode, setAdminMode] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [activeMapKey, setActiveMapKey] = useState(DEFAULT_MAP_KEY)

  const phase = useMemo(getWorldPhase, [])
  const activeMap = useMemo(() => getMapByKey(activeMapKey), [activeMapKey])

  // Cuma room yang "milik" peta yang lagi aktif yang ditampilkan/bisa
  // ditempel ke bangunan — room lama (sebelum fitur multi-map) otomatis
  // dianggap punya map_key 'kawasan-pantai' lewat migration-004.
  const roomsOnActiveMap = useMemo(
    () => rooms.filter((r) => (r.map_key || DEFAULT_MAP_KEY) === activeMapKey),
    [rooms, activeMapKey]
  )

  // Dipakai polling berkala DAN dipanggil manual abis admin assign/bikin room baru,
  // biar peta langsung nunjukkin perubahan tanpa nunggu interval berikutnya
  const refreshRooms = useCallback(async () => {
    try {
      const roomsData = await pollRooms()
      setRooms(roomsData)
    } catch (err) {
      console.error(err)
    }
  }, [])

  useEffect(() => {
    initTelegram()

    async function bootstrap() {
      try {
        const tgUser = getTelegramUser()
        const citizenRow = await ensureCitizen(tgUser)
        setCitizen(citizenRow)

        const roomsData = await getRoomsWithPresence()
        setRooms(roomsData)
      } catch (err) {
        console.error(err)
        setError(
          'Gagal memuat kota. Pastikan .env sudah diisi dengan kredensial Supabase yang benar, dan tabel sudah dibuat lewat schema.sql.'
        )
      } finally {
        setLoading(false)
      }
    }

    bootstrap()
  }, [])

  useEffect(() => {
    let intervalId

    function startPolling() {
      // langsung refresh sekali, lalu ulangi tiap POLL_INTERVAL_MS
      refreshRooms()
      intervalId = setInterval(refreshRooms, POLL_INTERVAL_MS)
    }

    function stopPolling() {
      clearInterval(intervalId)
    }

    // Hemat request: berhenti polling kalau Mini App di-background/minimize,
    // lanjut lagi begitu user balik buka
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        startPolling()
      } else {
        stopPolling()
      }
    }

    startPolling()
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      stopPolling()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [refreshRooms])

  function handleOpenRoom(room) {
    hapticSelect()
    if (room.slug === 'rumah') {
      setHousingRoom(room)
    } else {
      setSelectedRoom(room)
    }
  }

  async function handleConfirmEnter() {
    if (!citizen || !selectedRoom) return
    setEntering(true)
    try {
      await enterRoom(citizen.id, selectedRoom.id)
      hapticSuccess()
      if (selectedRoom.telegram_group_url) {
        openTelegramLink(selectedRoom.telegram_group_url)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setEntering(false)
      setSelectedRoom(null)
    }
  }

  return (
    <div className="town">
      <div className="town-overlay-top">
        <header className="town-header">
          <h1 className="town-title">RP Town</h1>

          <div className="world-clock">
            <span className="phase-dot" style={{ background: phase.dot, boxShadow: `0 0 10px 2px ${phase.dot}` }} />
            <span>{phase.label}</span>
          </div>
        </header>

        <div className="map-switcher">
          {MAPS.map((map) => (
            <button
              key={map.key}
              type="button"
              className={`map-switcher-item${map.key === activeMapKey ? ' is-active' : ''}`}
              onClick={() => {
                if (map.key === activeMapKey) return
                hapticSelect()
                setActiveMapKey(map.key)
              }}
            >
              {map.name}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="state-message">Membuka gerbang kota...</p>}
      {error && <p className="state-message">{error}</p>}

      {!loading && !error && (
        <TownMap3D
          mapKey={activeMap.key}
          modelUrl={activeMap.modelUrl}
          rooms={roomsOnActiveMap}
          adminMode={adminMode}
          onSelectRoom={handleOpenRoom}
          onRoomsChanged={refreshRooms}
        />
      )}

      {!loading && !error && (
        <nav className="bottom-nav">
          <button className="bottom-nav-item is-active" type="button">
            <MapIcon active />
            <span>Peta</span>
          </button>
          <button
            className="bottom-nav-item"
            type="button"
            onClick={() => {
              hapticSelect()
              setShowProfile(true)
            }}
          >
            <ProfileIcon />
            <span>Profil</span>
          </button>
        </nav>
      )}

      {selectedRoom && (
        <div className="modal-backdrop" onClick={() => !entering && setSelectedRoom(null)}>
          <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="modal-icon">{selectedRoom.emoji}</div>
            <h2 className="modal-title">Masuk ke {selectedRoom.name}?</h2>
            <p className="modal-desc">
              Kamu akan diarahkan ke ruang chat {selectedRoom.name} untuk mulai roleplay bareng warga lain.
            </p>
            <button className="modal-btn modal-btn-primary" onClick={handleConfirmEnter} disabled={entering}>
              {entering ? 'Membuka pintu...' : 'Masuk Sekarang'}
            </button>
            <button className="modal-btn modal-btn-secondary" onClick={() => setSelectedRoom(null)} disabled={entering}>
              Batal
            </button>
          </div>
        </div>
      )}
      {housingRoom && (
        <HousingDistrict
          districtRoom={housingRoom}
          citizen={citizen}
          onClose={() => setHousingRoom(null)}
          onCitizenUpdate={setCitizen}
        />
      )}

      {showProfile && (
        <div className="modal-backdrop" onClick={() => setShowProfile(false)}>
          <div className="modal-sheet profile-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="profile-header">
              <h2 className="modal-title" style={{ margin: 0 }}>Profil</h2>
              <button className="housing-close-btn" onClick={() => setShowProfile(false)}>
                ✕
              </button>
            </div>

            {citizen ? (
              <div className="citizen-card citizen-card-static">
                <div className="citizen-avatar">
                  {citizen.avatar_url ? <img src={citizen.avatar_url} alt="" /> : initials(citizen.display_name)}
                </div>
                <div>
                  <p className="citizen-name">{citizen.display_name || citizen.username || 'Warga Baru'}</p>
                  <p className="citizen-status">Geser & cubit peta untuk jelajahi kota</p>
                </div>
              </div>
            ) : (
              <p className="state-message" style={{ position: 'static', padding: '20px 0' }}>
                Data warga belum dimuat.
              </p>
            )}

            <button
              type="button"
              className="admin-mode-row"
              onClick={() => setAdminMode((v) => !v)}
            >
              <div>
                <p className="admin-mode-title">Mode Admin</p>
                <p className="admin-mode-desc">Atur bangunan mana yang jadi room</p>
              </div>
              <span className={`switch${adminMode ? ' is-on' : ''}`}>
                <span className="switch-knob" />
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
