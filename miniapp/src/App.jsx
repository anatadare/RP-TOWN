import { useEffect, useState, useMemo, useCallback } from 'react'
import './App.css'
import { initTelegram, getTelegramUser, openTelegramLink, hapticSelect, hapticSuccess } from './lib/telegram'
import { ensureCitizen, getRoomsWithPresence, enterRoom, pollRooms } from './lib/rooms'
import { getHouseByOwner } from './lib/houses'
import TownMap3D from './components/TownMap3D'
import HousingDistrict from './components/HousingDistrict'
import BuildingSearch from './components/BuildingSearch'
import { MAPS, DEFAULT_MAP_KEY, getMapByKey } from './lib/maps'
import { buildBuildingDirectory } from './lib/buildings'

// Label status warga. Sistem status lengkap (custom, emoji, dsb) menyusul —
// untuk sekarang semua warga baru default 'single'.
const STATUS_LABELS = {
  single: 'Single',
  taken: 'Taken',
  its_complicated: "It's Complicated",
}

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

// Ikon-ikon kecil buat tombol aksi & baris di halaman Profil
function CameraIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
      <path d="M4 8.5h3l1.4-2h7.2l1.4 2h3v11H4v-11z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="12" cy="14" r="3.4" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

function EditIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
      <path
        d="M14.5 5.5l4 4L8 20H4v-4l10.5-10.5z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function GearIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 3.5l1 2.2 2.4-.6 .8 2.3 2.3.8-.6 2.4 2.2 1-2.2 1 .6 2.4-2.3.8-.8 2.3-2.4-.6-1 2.2-1-2.2-2.4.6-.8-2.3-2.3-.8.6-2.4-2.2-1 2.2-1-.6-2.4 2.3-.8.8-2.3 2.4.6 1-2.2z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function HouseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M4 11l8-6 8 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 10v9h12v-9" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M10 19v-5h4v5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
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
  const [showSettings, setShowSettings] = useState(false)
  const [ownedHouse, setOwnedHouse] = useState(null)
  const [houseLoading, setHouseLoading] = useState(false)
  const [profileToast, setProfileToast] = useState(null)
  const [activeMapKey, setActiveMapKey] = useState(DEFAULT_MAP_KEY)
  // Nomor node bangunan (TPX_Buildings_N) yang beneran ada di tiap peta,
  // dilaporkan TownMap3D pas model .glb-nya kebaca. Disimpan per map_key
  // biar gak ilang pas gonta-ganti peta.
  const [mapBuildingKeys, setMapBuildingKeys] = useState({})
  // Permintaan "fokus ke bangunan X" dari search bar -> dikirim ke TownMap3D
  // buat nge-zoom kamera. `nonce` supaya bangunan yang sama bisa dipilih ulang.
  const [focusRequest, setFocusRequest] = useState(null)

  const phase = useMemo(getWorldPhase, [])
  const activeMap = useMemo(() => getMapByKey(activeMapKey), [activeMapKey])

  // Cuma room yang "milik" peta yang lagi aktif yang ditampilkan/bisa
  // ditempel ke bangunan — room lama (sebelum fitur multi-map) otomatis
  // dianggap punya map_key 'kawasan-pantai' lewat migration-004.
  const roomsOnActiveMap = useMemo(
    () => rooms.filter((r) => (r.map_key || DEFAULT_MAP_KEY) === activeMapKey),
    [rooms, activeMapKey]
  )

  // Daftar bangunan buat search bar: gabungan room yang sudah "disewa" (punya
  // nama/emoji custom) + bangunan yang node-nya ada di model tapi belum
  // ke-assign room (ditampilin sementara sebagai "Bangunan N").
  const buildingDirectory = useMemo(
    () => buildBuildingDirectory(mapBuildingKeys[activeMapKey] || [], roomsOnActiveMap),
    [mapBuildingKeys, activeMapKey, roomsOnActiveMap]
  )

  // Stabil per activeMapKey (gak berubah tiap polling) supaya TownMap3D gak
  // scan ulang scene tiap 5 detik — cuma dipanggil ulang beneran kalau
  // daftar node-nya emang berubah.
  const handleBuildingsLoaded = useCallback((keys) => {
    setMapBuildingKeys((prev) => {
      const prevKeys = prev[activeMapKey]
      const same =
        prevKeys && prevKeys.length === keys.length && prevKeys.every((k, i) => k === keys[i])
      if (same) return prev
      return { ...prev, [activeMapKey]: keys }
    })
  }, [activeMapKey])

  // Reset hasil fokus search tiap ganti peta (bangunan lama sudah gak relevan)
  useEffect(() => {
    setFocusRequest(null)
  }, [activeMapKey])

  function handleSelectBuildingFromSearch(entry) {
    hapticSelect()
    setFocusRequest({ buildingKey: entry.buildingKey, nonce: Date.now() })
    if (entry.room) {
      handleOpenRoom(entry.room)
    }
  }

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

  // Ambil petak rumah milik citizen tiap kali panel Profil dibuka, biar
  // kartu "Rumah" nunjukkin data terbaru (misalnya abis nyewa dari Perumahan).
  useEffect(() => {
    if (!showProfile || !citizen) return
    let cancelled = false

    async function loadOwnedHouse() {
      setHouseLoading(true)
      try {
        const house = await getHouseByOwner(citizen.id)
        if (!cancelled) setOwnedHouse(house)
      } catch (err) {
        console.error(err)
        if (!cancelled) setOwnedHouse(null)
      } finally {
        if (!cancelled) setHouseLoading(false)
      }
    }

    loadOwnedHouse()
    return () => {
      cancelled = true
    }
  }, [showProfile, citizen])

  // Toast kecil buat fitur yang belum digarap (Pasang Foto, Edit Info)
  function showComingSoon(feature) {
    hapticSelect()
    setProfileToast(`${feature} segera hadir 👷`)
    setTimeout(() => setProfileToast(null), 2000)
  }

  function handleOpenHouseChat() {
    hapticSelect()
    const url = ownedHouse?.telegram_topic_url || ownedHouse?.district?.telegram_group_url
    if (url) openTelegramLink(url)
  }

  const perumahanRoom = useMemo(() => rooms.find((r) => r.slug === 'rumah'), [rooms])

  function handleGoRentHouse() {
    if (!perumahanRoom) return
    hapticSelect()
    setShowProfile(false)
    setHousingRoom(perumahanRoom)
  }

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

        <BuildingSearch
          key={activeMapKey}
          buildings={buildingDirectory}
          mapName={activeMap.name}
          onSelectBuilding={handleSelectBuildingFromSearch}
        />
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
          onBuildingsLoaded={handleBuildingsLoaded}
          focusRequest={focusRequest}
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
        <div
          className="modal-backdrop"
          onClick={() => {
            setShowProfile(false)
            setShowSettings(false)
          }}
        >
          <div className="modal-sheet profile-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="profile-header">
              <h2 className="modal-title" style={{ margin: 0 }}>Profil</h2>
              <button
                className="housing-close-btn"
                onClick={() => {
                  setShowProfile(false)
                  setShowSettings(false)
                }}
              >
                ✕
              </button>
            </div>

            {citizen ? (
              <>
                {/* ==== Avatar & identitas ==== */}
                <div className="profile-identity">
                  <div className="profile-avatar-large">
                    {citizen.avatar_url ? <img src={citizen.avatar_url} alt="" /> : initials(citizen.display_name)}
                  </div>
                  <p className="profile-name">{citizen.display_name || citizen.username || 'Warga Baru'}</p>
                  <p className="profile-online">
                    <span className="profile-online-dot" /> online
                  </p>
                </div>

                {/* ==== Tombol aksi ==== */}
                <div className="profile-actions">
                  <button type="button" className="profile-action-btn" onClick={() => showComingSoon('Pasang Foto')}>
                    <CameraIcon />
                    <span>Pasang Foto</span>
                  </button>
                  <button type="button" className="profile-action-btn" onClick={() => showComingSoon('Edit Info')}>
                    <EditIcon />
                    <span>Edit Info</span>
                  </button>
                  <button
                    type="button"
                    className={`profile-action-btn${showSettings ? ' is-active' : ''}`}
                    onClick={() => {
                      hapticSelect()
                      setShowSettings((v) => !v)
                    }}
                  >
                    <GearIcon />
                    <span>Pengaturan</span>
                  </button>
                </div>

                {profileToast && <p className="profile-toast">{profileToast}</p>}

                {/* ==== Rumah ==== */}
                <div className="profile-section">
                  <div className="profile-section-title-row">
                    <span className="profile-section-title">Rumah</span>
                  </div>

                  {houseLoading ? (
                    <div className="profile-house-card profile-house-empty">
                      <p className="profile-house-empty-text">Memuat data rumah...</p>
                    </div>
                  ) : ownedHouse ? (
                    <button type="button" className="profile-house-card" onClick={handleOpenHouseChat}>
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
                      <button type="button" className="profile-house-cta" onClick={handleGoRentHouse}>
                        🏘️ Sewa rumah di Perumahan
                      </button>
                    </div>
                  )}
                </div>

                {/* ==== Info: Status & Bio ==== */}
                <div className="profile-info-card">
                  <div className="profile-info-row">
                    <p className="profile-info-value">{STATUS_LABELS[citizen.status] || 'Single'}</p>
                    <p className="profile-info-label">Status</p>
                  </div>
                  <div className="profile-info-row">
                    <p className="profile-info-value">{citizen.bio || 'Belum ada bio'}</p>
                    <p className="profile-info-label">Bio</p>
                  </div>
                  {citizen.username && (
                    <div className="profile-info-row">
                      <p className="profile-info-value">@{citizen.username}</p>
                      <p className="profile-info-label">Username</p>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <p className="state-message" style={{ position: 'static', padding: '20px 0' }}>
                Data warga belum dimuat.
              </p>
            )}

            {showSettings && (
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
            )}
          </div>
        </div>
      )}
    </div>
  )
}
