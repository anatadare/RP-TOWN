import { useEffect, useState } from 'react'
import { getHouses, rentHouse } from '../lib/houses'
import { hapticSuccess, hapticSelect } from '../lib/telegram'

export default function HousingDistrict({ districtRoom, citizen, onClose, onCitizenUpdate }) {
  const [houses, setHouses] = useState([])
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
        if (!cancelled) setError('Gagal memuat data perumahan.')
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
      onCitizenUpdate?.({ ...citizen, coins: citizen.coins - selectedHouse.rent_price })
      setSelectedHouse(null)
    } catch (err) {
      console.error(err)
      setRentError(err.message || 'Gagal menyewa petak ini. Mungkin baru saja disewa orang lain.')
    } finally {
      setRenting(false)
    }
  }

  const myHouse = houses.find((h) => h.owner_citizen_id === citizen?.id)

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet housing-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="housing-header">
          <div>
            <h2 className="modal-title" style={{ textAlign: 'left', marginBottom: 2 }}>🏘️ Perumahan</h2>
            <p className="housing-subtitle">Sewa petak rumahmu sendiri di kota ini</p>
          </div>
          <button className="housing-close-btn" onClick={onClose} aria-label="Tutup">✕</button>
        </div>

        {citizen && (
          <div className="housing-balance">
            <span>💰 Koin kamu</span>
            <strong>{citizen.coins}</strong>
          </div>
        )}

        {loading && <p className="state-message" style={{ position: 'static', padding: '24px 0' }}>Memuat petak rumah...</p>}
        {error && <p className="state-message" style={{ position: 'static', padding: '24px 0' }}>{error}</p>}

        {!loading && !error && (
          <div className="housing-grid">
            {houses.map((house) => {
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
                  {!isTaken && <span className="housing-plot-price">{house.rent_price} koin</span>}
                </button>
              )
            })}
          </div>
        )}

        {myHouse && (
          <p className="housing-hint">
            Kamu sudah punya rumah di Petak {myHouse.plot_number}. Fitur dekorasi & chat personal rumah menyusul.
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
                <h2 className="modal-title">Sewa Petak {selectedHouse.plot_number}?</h2>
                <p className="modal-desc">
                  Biaya sewa: <strong>{selectedHouse.rent_price} koin</strong>. Koin kamu sekarang: {citizen?.coins ?? 0}.
                </p>
                {rentError && <p className="housing-error">{rentError}</p>}
                <button
                  className="modal-btn modal-btn-primary"
                  onClick={handleConfirmRent}
                  disabled={renting || (citizen?.coins ?? 0) < selectedHouse.rent_price}
                >
                  {renting ? 'Memproses...' : 'Sewa Sekarang'}
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
