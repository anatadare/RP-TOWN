import { useEffect, useState } from 'react'
import { getActiveListings } from '../../../lib/houseMarket'
import { getIslandName } from '../../../lib/houses'
import { openTelegramLink, hapticSelect } from '../../../lib/telegram'

function formatCoins(n) {
  return `${Number(n).toLocaleString('id-ID')} koin`
}

function initials(name) {
  if (!name) return '?'
  return name.trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('')
}

// Link grup market (tempat Pak Darma melayani jual-beli). Isi di .env:
//   VITE_MARKET_GROUP_URL=https://t.me/+xxxx
const MARKET_URL = import.meta.env.VITE_MARKET_GROUP_URL

// Marketplace asli RP Town: baca tabel house_listings (fungsi SAMA dengan
// tab Market). Read-only, karena pasang/batal/beli listing cuma bisa lewat
// worker (Pak Darma) -- lihat lib/houseMarket.js.
export default function MarketApp({ citizenId }) {
  const [listings, setListings] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    getActiveListings()
      .then((rows) => { if (!cancelled) setListings(rows) })
      .catch((err) => { console.error(err); if (!cancelled) setError('Gagal memuat listing.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  return (
    <div className="ph-market">
      <div className="ph-card ph-market-cta">
        <p className="ph-row-title">Jual atau beli rumah</p>
        <p className="ph-sub">Transaksi lewat chat ke Pak Darma di grup RP Town market.</p>
        {MARKET_URL ? (
          <button
            type="button"
            className="ph-btn ph-btn-primary"
            onClick={() => { hapticSelect(); openTelegramLink(MARKET_URL) }}
          >
            Chat Pak Darma
          </button>
        ) : (
          <p className="ph-sub">Buka grup RP Town market di Telegram untuk bertransaksi.</p>
        )}
      </div>

      {loading && <p className="ph-state">Memuat listing...</p>}
      {error && <p className="ph-state">{error}</p>}
      {!loading && !error && listings.length === 0 && <p className="ph-state">Belum ada rumah yang dijual saat ini.</p>}

      {listings.map((l) => {
        const house = l.house
        const seller = l.seller
        const mine = citizenId && l.seller_citizen_id === citizenId
        return (
          <div key={l.id} className={`ph-card ph-listing${mine ? ' is-mine' : ''}`}>
            <div className="ph-listing-icon">🏡</div>
            <div className="ph-listing-body">
              <p className="ph-row-title">
                {house?.name || `Petak ${house?.plot_number}`}
                {mine && <span className="ph-tag">Punyamu</span>}
              </p>
              <p className="ph-sub">Petak {house?.plot_number} · {getIslandName(house?.map_key)}</p>
              <div className="ph-listing-seller">
                <span className="ph-avatar ph-avatar-sm">
                  {seller?.avatar_url ? <img src={seller.avatar_url} alt="" /> : initials(seller?.display_name)}
                </span>
                <span className="ph-sub">{seller?.display_name || 'Warga'}</span>
              </div>
            </div>
            <div className="ph-price">{formatCoins(l.price)}</div>
          </div>
        )
      })}
    </div>
  )
}
