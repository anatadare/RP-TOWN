import { useEffect, useState, useMemo, useCallback } from 'react'
import './App.css'
import { initTelegram, getTelegramUser, openTelegramLink, hapticSelect, hapticSuccess } from './lib/telegram'
import { ensureCitizen, getRoomsWithPresence, enterRoom, pollRooms } from './lib/rooms'
import TownMap3D from './components/TownMap3D'
import HousingDistrict from './components/HousingDistrict'

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

export default function App() {
  const [citizen, setCitizen] = useState(null)
  const [rooms, setRooms] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedRoom, setSelectedRoom] = useState(null)
  const [entering, setEntering] = useState(false)
  const [housingRoom, setHousingRoom] = useState(null)
  const [adminMode, setAdminMode] = useState(false)

  const phase = useMemo(getWorldPhase, [])

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
          <p className="town-subtitle">Kota kecil untuk komunitas roleplay</p>
        </header>

        <div className="world-clock">
          <span className="phase-dot" style={{ background: phase.dot, boxShadow: `0 0 10px 2px ${phase.dot}` }} />
          <span>{phase.label}</span>
        </div>

        {citizen && (
          <div className="citizen-card">
            <div className="citizen-avatar">
              {citizen.avatar_url ? <img src={citizen.avatar_url} alt="" /> : initials(citizen.display_name)}
            </div>
            <div>
              <p className="citizen-name">{citizen.display_name || citizen.username || 'Warga Baru'}</p>
              <p className="citizen-status">Geser & cubit peta untuk jelajahi kota</p>
            </div>
          </div>
        )}
      </div>

      {loading && <p className="state-message">Membuka gerbang kota...</p>}
      {error && <p className="state-message">{error}</p>}

      {!loading && !error && (
        <>
          <button
            className={`admin-toggle${adminMode ? ' is-active' : ''}`}
            onClick={() => setAdminMode((v) => !v)}
            title="Mode admin: atur bangunan mana yang jadi room"
          >
            ⚙️
          </button>
          <TownMap3D
            rooms={rooms}
            adminMode={adminMode}
            onSelectRoom={handleOpenRoom}
            onRoomsChanged={refreshRooms}
          />
        </>
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
    </div>
  )
}
