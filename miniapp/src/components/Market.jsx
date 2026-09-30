import { useEffect, useState } from 'react'
import { getActiveListings } from '../lib/houseMarket'
import { getIslandName } from '../lib/houses'

function formatCoins(n) {
  return `${Number(n).toLocaleString('id-ID')} koin`
}

function initials(name) {
  if (!name) return '?'
  return name.trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('')
}

// Tab "Market" -- etalase rumah yang sedang dijual (baca `house_listings`
// langsung dari Supabase, RLS public read). SENGAJA read-only: pasang
// listing, batalkan, dan beli tetap lewat chat ke Pak Darma di grup RP Town
// market, karena fungsi database-nya cuma bisa dipanggil worker (lihat
// lib/houseMarket.js untuk alasannya).
export default function Market({ citizen }) {
  const [listings, setListings] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const data = await getActiveListings()
        if (!cancelled) setListings(data)
      } catch (err) {
        console.error(err)
        if (!cancelled) setError('Gagal memuat listing rumah.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="market-page">
      <div className="market-page-header">
        <h1 className="market-page-title">🏠 Market</h1>
        <p className="market-page-subtitle">Rumah yang sedang dijual warga RP Town</p>
      </div>

      {loading && <p className="state-message" style={{ position: 'static', padding: '24px 0' }}>Memuat listing...</p>}
      {error && <p className="state-message" style={{ position: 'static', padding: '24px 0' }}>{error}</p>}

      {!loading && !error && listings.length === 0 && (
        <p className="market-empty">Belum ada rumah yang dijual saat ini.</p>
      )}

      {!loading && !error && listings.length > 0 && (
        <div className="market-list">
          {listings.map((listing) => {
            const house = listing.house
            const seller = listing.seller
            const isMine = citizen?.id && listing.seller_citizen_id === citizen.id
            return (
              <div key={listing.id} className={`market-card${isMine ? ' market-card-mine' : ''}`}>
                <div className="market-card-icon">🏡</div>
                <div className="market-card-body">
                  <p className="market-card-name">
                    {house?.name || `Petak ${house?.plot_number}`}
                    {isMine && <span className="market-card-mine-tag">Punyamu</span>}
                  </p>
                  <p className="market-card-meta">
                    Petak {house?.plot_number} · {getIslandName(house?.map_key)}
                  </p>
                  <div className="market-card-seller">
                    <span className="market-card-seller-avatar">
                      {seller?.avatar_url ? (
                        <img src={seller.avatar_url} alt="" />
                      ) : (
                        initials(seller?.display_name || seller?.username)
                      )}
                    </span>
                    <span>{seller?.display_name || seller?.username || 'Warga'}</span>
                  </div>
                </div>
                <div className="market-card-price">{formatCoins(listing.price)}</div>
              </div>
            )
          })}
        </div>
      )}

      <p className="market-hint">
        Mau jual, batalkan, atau beli rumah? Chat Pak Darma di topik 🏠 Jual Property, grup RP Town market ya.
      </p>
    </div>
  )
}
