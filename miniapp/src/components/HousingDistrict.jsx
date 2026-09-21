import { useEffect, useState } from 'react'
import { getHouses, rentHouse, RENTABLE_ISLANDS, getIslandName } from '../lib/houses'
import { hapticSuccess, hapticSelect, openTelegramLink } from '../lib/telegram'

// Penyewaan dikunci dulu sampai pembayaran uang asli siap. Ubah ke true kalau sudah live.
const RENTAL_OPEN = false

export default function HousingDistrict({ districtRoom, citizen, onClose, onCitizenUpdate }) {
  const [houses, setHouses] = useState([])
  const [island, setIsland] = useState(RENTABLE_ISLANDS[0].key)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedHouse, setSelectedHouse] = useState(null)
  const [renting, setRenting] = useState(false)
  const [rentError, setRentError] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const data = await getHouses(districtRoom.id)
        if (!cancelled) setHouses(data)
      } catch (err) {
        console.error(err)
        if (!cancelled) setError('Gagal memuat data rumah.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [districtRoom.id])

  function handlePlotClick(house) {
    hapticSelect()
    setRentError(null)
    setSelectedHouse(house)
  }

  async function handleConfirmRent() {
    if (!selectedHouse || !citizen) return
    setRenting(true)
    setRentError(null)
    try {
      const updatedHouse = await rentHouse(selectedHouse.id, citizen.id)
      hapticSuccess()
      // update state lokal: petak ini sekarang milik citizen
      setHouses((prev) =>
        prev.map((h) =>
          h.id === updatedHouse.id
            ? { ...h, owner_citizen_id: citizen.id, owner: { id: citizen.id, display_name: citizen.display_name, avatar_url: citizen.avatar_url } }
            : h
        )
      )
      setSelectedHouse(null)
    } catch (err) {
      console.error(err)
      setRentError(err.message || 'Gagal menyewa petak ini. Mungkin baru saja disewa orang lain.')
    } finally {
      setRenting(false)
    }
  }

  const myHouse = houses.find((h) => h.owner_citizen_id === citizen?.id)
  const islandHouses = houses.filter((h) => h.map_key === island)

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet housing-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="housing-header">
          <div>
            <h2 className="modal-title" style={{ textAlign: 'left', marginBottom: 2 }}>🏝️ Rumah Pulau</h2>
            <p className="housing-subtitle">Sewa rumahmu di Kawasan Pantai atau LPM</p>
          </div>
          <button className="housing-close-btn" onClick={onClose} aria-label="Tutup">✕</button>
        </div>

        <div className="housing-tabs">
          {RENTABLE_ISLANDS.map((i) => (
            <button
              key={i.key}
              className={`housing-tab ${island === i.key ? 'housing-tab-active' : ''}`}
              onClick={() => { hapticSelect(); setIsland(i.key) }}
            >
              {i.emoji} {i.name}
            </button>
          ))}
        </div>

        {loading && <p className="state-message" style={{ position: 'static', padding: '24px 0' }}>Memuat petak rumah...</p>}
        {error && <p className="state-message" style={{ position: 'static', padding: '24px 0' }}>{error}</p>}

        {!loading && !error && (
          <div className="housing-grid">
            {islandHouses.map((house) => {
              const isMine = house.owner_citizen_id === citizen?.id
              const isTaken = Boolean(house.owner_citizen_id)
              return (
                <button
                  key={house.id}
                  className={`housing-plot ${isMine ? 'housing-plot-mine' : isTaken ? 'housing-plot-taken' : 'housing-plot-empty'}`}
                  onClick={() => handlePlotClick(house)}
                >
                  <span className="housing-plot-icon">{isMine ? '🏡' : isTaken ? '🔒' : '🏗️'}</span>
                  <span className="housing-plot-number">Petak {house.plot_number}</span>
                  {isMine && <span className="housing-plot-tag">Rumahmu</span>}
                  {!isMine && isTaken && (
                    <span className="housing-plot-tag">{house.owner?.display_name || 'Disewa'}</span>
                  )}
                  {!isTaken && <span className="housing-plot-price">Tersedia</span>}
                </button>
              )
            })}
          </div>
        )}

        <p className="housing-hint housing-note">
          🏙️ RP Town City adalah aset RP Town, jadi tidak tersedia untuk disewa.
        </p>

        {myHouse && (
          <p className="housing-hint">
            Kamu sudah punya rumah di {getIslandName(myHouse.map_key)} — Petak {myHouse.plot_number}. Fitur dekorasi & chat personal rumah menyusul.
          </p>
        )}
      </div>

      {selectedHouse && (
        <div className="modal-backdrop" onClick={() => !renting && setSelectedHouse(null)} style={{ zIndex: 20 }}>
          <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
            {selectedHouse.owner_citizen_id === citizen?.id ? (
              <>
                <div className="modal-icon">🏡</div>
                <h2 className="modal-title">Petak {selectedHouse.plot_number}</h2>
                <p className="modal-desc">Ini rumahmu sendiri di RP Town.</p>
                {selectedHouse.telegram_topic_url ? (
                  <button
                    className="modal-btn modal-btn-primary"
                    onClick={() => openTelegramLink(selectedHouse.telegram_topic_url)}
                  >
                    Buka Chat Rumah
                  </button>
                ) : (
                  <p className="housing-hint" style={{ margin: '0 0 14px' }}>
                    Ruang chat rumahmu lagi disiapkan, coba buka lagi beberapa detik ke depan.
                  </p>
                )}
                <button className="modal-btn modal-btn-secondary" onClick={() => setSelectedHouse(null)}>
                  Tutup
                </button>
              </>
            ) : selectedHouse.owner_citizen_id ? (
              <>
                <div className="modal-icon">🔒</div>
                <h2 className="modal-title">Petak {selectedHouse.plot_number} sudah disewa</h2>
                <p className="modal-desc">
                  Petak ini milik {selectedHouse.owner?.display_name || 'warga lain'}. Coba petak lain yang masih kosong.
                </p>
                <button className="modal-btn modal-btn-secondary" onClick={() => setSelectedHouse(null)}>
                  Tutup
                </button>
              </>
            ) : (
              <>
                <div className="modal-icon">🏗️</div>
                <h2 className="modal-title">Petak {selectedHouse.plot_number}</h2>
                <p className="modal-desc" style={{ marginBottom: 4 }}>📍 {getIslandName(selectedHouse.map_key)}</p>
                <p className="modal-desc">
                  {RENTAL_OPEN
                    ? 'Petak ini masih kosong dan bisa kamu sewa.'
                    : 'Petak ini masih kosong. Penyewaan rumah segera dibuka, tunggu pengumuman ya!'}
                </p>
                {rentError && <p className="housing-error">{rentError}</p>}
                <button
                  className="modal-btn modal-btn-primary"
                  onClick={handleConfirmRent}
                  disabled={!RENTAL_OPEN || renting}
                >
                  {!RENTAL_OPEN ? 'Segera dibuka' : renting ? 'Memproses...' : 'Sewa Sekarang'}
                </button>
                <button className="modal-btn modal-btn-secondary" onClick={() => setSelectedHouse(null)} disabled={renting}>
                  Batal
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
