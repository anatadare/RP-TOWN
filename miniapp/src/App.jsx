import { useEffect, useState, useMemo, useCallback } from 'react'
import './App.css'
import { initTelegram, getTelegramUser, openTelegramLink, hapticSelect, hapticSuccess } from './lib/telegram'
import { ensureCitizen, getRoomsWithPresence, enterRoom, pollRooms, updateCitizenCharacter } from './lib/rooms'
import { getHouseByOwner, getIslandName } from './lib/houses'
import { requestKuaInvite, kuaInviteErrorMessage } from './lib/kua'
import TownMap3D from './components/TownMap3D'
import TownWalk from './components/TownWalk'
import HousingDistrict from './components/HousingDistrict'
import BuildingSearch from './components/BuildingSearch'
import CharacterSelect from './components/CharacterSelect'
import Landing from './components/Landing'
import FamilyTree from './components/FamilyTree'
import { MAPS, DEFAULT_MAP_KEY, getMapByKey } from './lib/maps'
import { getCharacterById, DEFAULT_CHARACTER_ID } from './lib/characters'
import { buildBuildingDirectory } from './lib/buildings'

// Label status warga. Sistem status lengkap (custom, emoji, dsb) menyusul —
// untuk sekarang semua warga baru default 'single'.
const STATUS_LABELS = {
  single: 'Single',
  taken: 'Taken',
  its_complicated: "It's Complicated",
}

const POLL_INTERVAL_MS = 5000 // fetch ulang data tiap 5 detik

// Kapasitas ruang KUA -- cuma dipakai buat tampilan penjelasan singkat +
// badge "Penuh" di modal konfirmasi masuk. Room lain gak dibatasi (belum
// ada kolom `capacity` di tabel `rooms`, jadi sengaja hardcode di sini dulu
// biar gak perlu migration cuma buat 1 room).
const KUA_CAPACITY = 11

function isKuaRoom(room) {
  if (!room) return false
  const haystack = `${room.slug || ''} ${room.name || ''}`.toLowerCase()
  return haystack.includes('kua')
}

// Sama persis dengan DEFAULT_ADMIN_EXEMPT_IDS di worker/src/groupMembership.js --
// admin-admin ini dikecualikan dari kick otomatis di backend, jadi di
// frontend juga gak usah ikut kehitung/ditampilin sebagai "warga" yang
// makan slot kapasitas ruang KUA. Kalau daftar admin berubah, update di
// DUA tempat ini (backend & frontend) biar tetap sinkron.
const KUA_ADMIN_EXEMPT_IDS = new Set(['5911246341', '5839217045', '8118123582'])

// Buang occupant yang telegram_id-nya ada di daftar admin exempt, khusus
// buat ruang KUA. Room lain gak difilter (KUA_ADMIN_EXEMPT_IDS cuma
// relevan buat kapasitas 11 orang di KUA).
function visibleOccupants(room) {
  const occupants = room?.occupants || []
  if (!isKuaRoom(room)) return occupants
  return occupants.filter((o) => !KUA_ADMIN_EXEMPT_IDS.has(String(o?.telegram_id)))
}

function getWorldPhase() {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 11) return { label: 'Pagi di RP Town', dot: '#9cf3ff' }
  if (hour >= 11 && hour < 16) return { label: 'Siang di RP Town', dot: '#22e4ff' }
  if (hour >= 16 && hour < 19) return { label: 'Senja di RP Town', dot: '#ff3dcb' }
  return { label: 'Malam di RP Town', dot: '#b26bff' }
}

function initials(name) {
  if (!name) return '?'
  return name.trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('')
}

// Ikon-ikon kecil buat bottom nav, biar gak perlu tambah dependency icon library
function HomeIcon({ active }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path
        d="M4 11.5l8-7 8 7"
        stroke={active ? 'var(--lantern)' : 'currentColor'}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6 10.5V20h12v-9.5"
        stroke={active ? 'var(--lantern)' : 'currentColor'}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M10 20v-5.5h4V20" stroke={active ? 'var(--lantern)' : 'currentColor'} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}

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

function FamilyIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
      <circle cx="8" cy="6" r="2.6" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="16" cy="6" r="2.6" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="15.5" r="2.8" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 8.6V11M16 8.6V11M8 11h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M12 18.3V21" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
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
  // 'landing' -- layar sambutan sebelum peta. 'map' -- peta 3D (tampilan lama).
  // Layar pilih karakter GAK masuk sini, dicek terpisah lewat
  // `citizen && !citizen.character_id` di bagian render, soalnya dia cuma
  // relevan sekali di awal dan gak boleh "kebalik" ke screen lain.
  const [screen, setScreen] = useState('landing')
  const [selectedRoom, setSelectedRoom] = useState(null)
  const [entering, setEntering] = useState(false)
  const [enterError, setEnterError] = useState(null)
  const [housingRoom, setHousingRoom] = useState(null)
  const [adminMode] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showFamily, setShowFamily] = useState(false)
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

  // Karakter yang dipakai di mode Jelajahi = karakter yang dipilih citizen
  // pas pertama gabung (lihat CharacterSelect); fallback ke default kalau
  // entah kenapa belum ada.
  const walkCharacter = useMemo(
    () => getCharacterById(citizen?.character_id) || getCharacterById(DEFAULT_CHARACTER_ID),
    [citizen]
  )

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

  // Ambil petak rumah milik citizen tiap kali halaman Profil dibuka,
  // biar kartu "Rumah" di situ nunjukkin data terbaru (misalnya abis nyewa
  // dari Rumah Pulau). Layar Beranda gak nampilin kartu rumah lagi, jadi gak
  // perlu ikut trigger fetch ini.
  useEffect(() => {
    if (!citizen || screen !== 'profile') return
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
  }, [screen, citizen])

  // Toast kecil buat fitur yang belum digarap (Edit Info)
  function showComingSoon(feature) {
    hapticSelect()
    setProfileToast(`${feature} segera hadir 👷`)
    setTimeout(() => setProfileToast(null), 2000)
  }

  // Tab "Pengaturan" & "Keluarga" saling eksklusif -- gak masuk akal
  // nampilin dua-duanya bareng di bawah tombol aksi, jadi buka salah satu
  // otomatis nutup yang lain.
  function handleToggleSettings() {
    hapticSelect()
    setShowFamily(false)
    setShowSettings((v) => !v)
  }

  function handleToggleFamily() {
    hapticSelect()
    setShowSettings(false)
    setShowFamily((v) => !v)
  }

  // Dipanggil dari CharacterSelect abis warga milih karakter. Nyimpen ke
  // Supabase (bukan cuma state lokal) supaya layar ini beneran cuma muncul
  // SEKALI -- lain kali buka mini app, citizen.character_id sudah keisi.
  async function handleConfirmCharacter(characterId) {
    const updated = await updateCitizenCharacter(citizen.id, characterId)
    setCitizen(updated)
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
    setScreen('landing')
    setHousingRoom(perumahanRoom)
  }

  function handleOpenRoom(room) {
    hapticSelect()
    setEnterError(null)
    if (room.slug === 'rumah') {
      setHousingRoom(room)
    } else {
      setSelectedRoom(room)
    }
  }

  async function handleConfirmEnter() {
    if (!citizen || !selectedRoom) return
    setEntering(true)
    setEnterError(null)
    let closeModal = true
    try {
      if (isKuaRoom(selectedRoom)) {
        // KUA: link masuk dibuat bot on-demand (sekali pakai, kedaluwarsa
        // cepat, dicek kapasitasnya) -- BUKAN link statis dari tabel rooms.
        const invite = await requestKuaInvite()
        if (!invite.ok) {
          setEnterError(kuaInviteErrorMessage(invite))
          closeModal = false
          return
        }
        await enterRoom(citizen.id, selectedRoom.id)
        hapticSuccess()
        openTelegramLink(invite.url)
      } else {
        await enterRoom(citizen.id, selectedRoom.id)
        hapticSuccess()
        if (selectedRoom.telegram_group_url) {
          openTelegramLink(selectedRoom.telegram_group_url)
        }
      }
    } catch (err) {
      console.error(err)
    } finally {
      setEntering(false)
      if (closeModal) setSelectedRoom(null)
    }
  }

  // Warga baru (atau warga lama yang belum sempat milih sebelum fitur ini
  // ada) -- layar pilih karakter full-screen, blocking, nutupin semuanya
  // termasuk bottom nav. Begitu tersimpan, citizen.character_id keisi dan
  // App otomatis lanjut ke layar 'landing' di bawah.
  if (!loading && !error && citizen && !citizen.character_id) {
    return <CharacterSelect citizen={citizen} onConfirm={handleConfirmCharacter} />
  }

  // Mode "Jelajahi": jalan-jalan 3D full-screen, gantiin seluruh UI town
  // (topbar peta biasa + bottom nav) karena TownWalk punya kontrol sendiri
  // (joystick, tombol lompat, ganti-peta di atas).
  if (!loading && !error && screen === 'walk') {
    return (
      <TownWalk
        mapKey={activeMap.key}
        mapName={activeMap.name}
        modelUrl={activeMap.modelUrl}
        character={walkCharacter}
        onExit={() => {
          hapticSelect()
          setScreen('map')
        }}
        onChangeMap={setActiveMapKey}
      />
    )
  }

  return (
    <div className="town">
      {screen === 'map' && (
        <div className="town-overlay-top">
          <header className="town-header">
            <h1 className="town-title">RP Town</h1>

            <div className="town-header-right">
              <div className="world-clock">
                <span className="phase-dot" style={{ background: phase.dot, boxShadow: `0 0 10px 2px ${phase.dot}` }} />
                <span>{phase.label}</span>
              </div>

              <button
                type="button"
                className="explore-fab"
                onClick={() => {
                  hapticSelect()
                  setScreen('walk')
                }}
              >
                🚶 Jelajahi
              </button>
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
      )}

      {loading && <p className="state-message">Membuka gerbang kota...</p>}
      {error && <p className="state-message">{error}</p>}

      {!loading && !error && screen === 'landing' && (
        <Landing citizen={citizen} phase={phase} />
      )}

      {!loading && !error && screen === 'map' && (
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

      {!loading && !error && screen === 'profile' && (
        <div className="profile-page">
          <div className="profile-page-header">
            <h1 className="profile-page-title">Profil</h1>
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
              <div className="profile-actions profile-actions-3">
                <button type="button" className="profile-action-btn" onClick={() => showComingSoon('Edit Info')}>
                  <EditIcon />
                  <span>Edit Info</span>
                </button>
                <button
                  type="button"
                  className={`profile-action-btn${showFamily ? ' is-active' : ''}`}
                  onClick={handleToggleFamily}
                >
                  <FamilyIcon />
                  <span>Keluarga</span>
                </button>
                <button
                  type="button"
                  className={`profile-action-btn${showSettings ? ' is-active' : ''}`}
                  onClick={handleToggleSettings}
                >
                  <GearIcon />
                  <span>Pengaturan</span>
                </button>
              </div>

              {profileToast && <p className="profile-toast">{profileToast}</p>}

              {showSettings && (
                <p className="profile-settings-empty">Belum ada pengaturan tersedia saat ini.</p>
              )}

              {showFamily ? (
                /* ==== Pohon Keluarga (gantiin Rumah + Info selama tab ini aktif) ==== */
                <div className="profile-section">
                  <div className="profile-section-title-row">
                    <span className="profile-section-title">Pohon Keluarga</span>
                  </div>
                  <FamilyTree citizen={citizen} />
                </div>
              ) : (
                <>
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
                            {getIslandName(ownedHouse.map_key)} — Petak No. {ownedHouse.plot_number}
                          </p>
                          <p className="profile-house-sub">Ketuk untuk buka chat rumah</p>
                        </div>
                        <span className="profile-house-arrow">›</span>
                      </button>
                    ) : (
                      <div className="profile-house-card profile-house-empty">
                        <p className="profile-house-empty-text">Kamu belum menyewa rumah.</p>
                        <button type="button" className="profile-house-cta" onClick={handleGoRentHouse}>
                          🏝️ Sewa rumah di pulau
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
              )}
            </>
          ) : (
            <p className="state-message" style={{ position: 'static', padding: '20px 0' }}>
              Data warga belum dimuat.
            </p>
          )}
        </div>
      )}

      {!loading && !error && (
        <nav className="bottom-nav">
          <button
            className={`bottom-nav-item${screen === 'landing' ? ' is-active' : ''}`}
            type="button"
            onClick={() => {
              if (screen !== 'landing') hapticSelect()
              setScreen('landing')
            }}
          >
            <HomeIcon active={screen === 'landing'} />
            <span>Beranda</span>
          </button>
          <button
            className={`bottom-nav-item${screen === 'map' ? ' is-active' : ''}`}
            type="button"
            onClick={() => {
              if (screen !== 'map') hapticSelect()
              setScreen('map')
            }}
          >
            <MapIcon active={screen === 'map'} />
            <span>Peta</span>
          </button>
          <button
            className={`bottom-nav-item${screen === 'profile' ? ' is-active' : ''}`}
            type="button"
            onClick={() => {
              if (screen !== 'profile') hapticSelect()
              setScreen('profile')
            }}
          >
            <ProfileIcon active={screen === 'profile'} />
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

            {isKuaRoom(selectedRoom) && (
              <div className="modal-capacity">
                <div className="modal-capacity-row">
                  <span className="modal-capacity-count">
                    {visibleOccupants(selectedRoom).length}/{KUA_CAPACITY} warga di dalam
                  </span>
                  {visibleOccupants(selectedRoom).length >= KUA_CAPACITY && (
                    <span className="modal-capacity-badge">Penuh</span>
                  )}
                </div>
                <p className="modal-capacity-note">
                  Ruang KUA cuma muat maksimal {KUA_CAPACITY} warga sekaligus. Kamu bakal dapat link masuk
                  sekali pakai yang berlaku 10 menit. Kalau lagi penuh, coba lagi sebentar lagi.
                </p>
                {enterError && (
                  <p className="modal-capacity-note" style={{ color: '#ff8a8a' }}>
                    {enterError}
                  </p>
                )}

                {visibleOccupants(selectedRoom).length > 0 && (
                  <div className="modal-occupant-list">
                    {visibleOccupants(selectedRoom).map((occupant, idx) => (
                      <div className="modal-occupant" key={occupant?.display_name ? `${occupant.display_name}-${idx}` : idx}>
                        <div className="modal-occupant-avatar">
                          {occupant?.avatar_url ? (
                            <img src={occupant.avatar_url} alt="" />
                          ) : (
                            initials(occupant?.display_name)
                          )}
                        </div>
                        <span className="modal-occupant-name">{occupant?.display_name || 'Warga'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

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
