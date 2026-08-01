import { useEffect, useState, useMemo } from 'react'
import './App.css'
import { initTelegram, getTelegramUser, openTelegramLink, hapticSelect, hapticSuccess } from './lib/telegram'
import { ensureCitizen, getRoomsWithPresence, enterRoom, subscribeToPresence } from './lib/rooms'

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

  const phase = useMemo(getWorldPhase, [])

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
    const unsubscribe = subscribeToPresence(async () => {
      try {
        const roomsData = await getRoomsWithPresence()
        setRooms(roomsData)
      } catch (err) {
        console.error(err)
      }
    })
    return unsubscribe
  }, [])

  function handleOpenRoom(room) {
    hapticSelect()
    setSelectedRoom(room)
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
            <p className="citizen-status">Ketuk sebuah tempat untuk masuk & mulai roleplay</p>
          </div>
        </div>
      )}

      {loading && <p className="state-message">Membuka gerbang kota...</p>}
      {error && <p className="state-message">{error}</p>}

      {!loading && !error && (
        <div className="town-map">
          {rooms.map((room) => (
            <button key={room.id} className="room-card" onClick={() => handleOpenRoom(room)}>
              <div className="room-icon-wrap">
                <span>{room.emoji}</span>
                {room.occupantCount > 0 && (
                  <span className="room-lantern-count">{room.occupantCount}</span>
                )}
              </div>
              <div className="room-info">
                <p className="room-name">{room.name}</p>
                <p className="room-desc">{room.description}</p>
                {room.occupantCount > 0 && (
                  <div className="room-occupants">
                    <span className="room-occupant-dot" />
                    <span className="room-occupant-names">
                      {room.occupants
                        .slice(0, 3)
                        .map((o) => o?.display_name)
                        .filter(Boolean)
                        .join(', ')}
                      {room.occupantCount > 3 ? ` +${room.occupantCount - 3} lagi` : ''}
                    </span>
                  </div>
                )}
              </div>
              <span className="room-arrow">›</span>
            </button>
          ))}
        </div>
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
    </div>
  )
}
