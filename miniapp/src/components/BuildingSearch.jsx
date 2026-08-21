import { useEffect, useMemo, useRef, useState } from 'react'

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M20 20l-4.3-4.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

// Search bar bangunan, ditaro persis di bawah map-switcher.
// - Diklik/di-fokus tanpa ngetik apa-apa -> nampilin 5 bangunan dengan
//   populasi (jumlah warga di dalamnya) terbanyak di peta yang lagi aktif.
// - Diketik -> nyari SEMUA bangunan di peta itu (termasuk yang belum
//   disewa/dinamain, ditampilin sebagai "Bangunan N").
// `buildings` sudah harus berupa daftar 1 peta aja (lihat buildBuildingDirectory).
export default function BuildingSearch({ buildings, mapName, onSelectBuilding }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    function handleOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('touchstart', handleOutside)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('touchstart', handleOutside)
    }
  }, [])

  const topByPopulation = useMemo(() => {
    return [...buildings].sort((a, b) => b.population - a.population || a.number - b.number).slice(0, 5)
  }, [buildings])

  const isSearching = query.trim().length > 0

  const results = useMemo(() => {
    if (!isSearching) return topByPopulation
    const q = query.trim().toLowerCase()
    return buildings
      .filter((b) => b.name.toLowerCase().includes(q) || String(b.number).includes(q))
      .slice(0, 25)
  }, [isSearching, query, buildings, topByPopulation])

  function handlePick(entry) {
    setOpen(false)
    setQuery('')
    onSelectBuilding(entry)
  }

  return (
    <div className="building-search" ref={wrapRef}>
      <div className={`building-search-box${open ? ' is-open' : ''}`}>
        <span className="building-search-icon"><SearchIcon /></span>
        <input
          type="text"
          inputMode="search"
          className="building-search-input"
          placeholder={`Cari bangunan di ${mapName}...`}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
        />
        {query && (
          <button
            type="button"
            className="building-search-clear"
            onClick={() => setQuery('')}
            aria-label="Bersihkan pencarian"
          >
            ✕
          </button>
        )}
      </div>

      {open && (
        <div className="building-search-panel">
          <div className="building-search-panel-header">
            <span>{isSearching ? `Hasil untuk "${query.trim()}"` : 'Populasi terbanyak'}</span>
            <span className="building-search-count">{buildings.length} bangunan</span>
          </div>

          {results.length === 0 && (
            <p className="building-search-empty">
              {buildings.length === 0 ? 'Memuat data bangunan...' : 'Tidak ada bangunan yang cocok.'}
            </p>
          )}

          <ul className="building-search-list">
            {results.map((entry, idx) => (
              <li key={entry.buildingKey}>
                <button type="button" className="building-search-item" onClick={() => handlePick(entry)}>
                  {!isSearching && <span className="building-search-rank">{idx + 1}</span>}
                  <span className="building-search-emoji">{entry.emoji}</span>
                  <span className="building-search-info">
                    <span className="building-search-name">{entry.name}</span>
                    <span className="building-search-sub">
                      {entry.isClaimed ? 'Sudah disewa' : 'Belum disewa'}
                    </span>
                  </span>
                  <span className="building-search-pop" title="Jumlah warga di bangunan ini">
                    👥 {entry.population}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
