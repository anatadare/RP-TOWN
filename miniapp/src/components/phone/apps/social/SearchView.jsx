import { useEffect, useState } from 'react'
import { searchCitizens } from '../../../../lib/phoneApps'
import { hapticSelect } from '../../../../lib/telegram'
import { IconSearch } from '../../PhoneIcons'
import { Avatar } from './shared'

// Cari warga lewat nama atau ID RP Town (RP123456) -> buka profilnya.
export default function SearchView({ viewerId, onOpenProfile }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const q = query.trim()

  useEffect(() => {
    if (q.replace(/^@/, '').length < 2) { setResults([]); setError(null); return undefined }
    let cancelled = false
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const rows = await searchCitizens(q, viewerId)
        if (!cancelled) { setResults(rows); setError(null) }
      } catch (e) {
        console.error(e)
        if (!cancelled) setError('Pencarian gagal. (Pastikan migration-013 sudah dijalankan.)')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  }, [q, viewerId])

  return (
    <div className="ph-searchview">
      <label className="ph-search">
        <IconSearch width={18} height={18} />
        <input
          type="text"
          autoFocus
          placeholder="Cari nama atau ID (RP123456)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {q.length < 2 && <p className="ph-state">Ketik minimal 2 huruf untuk mencari warga.</p>}
      {loading && <p className="ph-state">Mencari...</p>}
      {error && <p className="ph-state">{error}</p>}
      {!loading && !error && q.replace(/^@/, '').length >= 2 && results.length === 0 && (
        <p className="ph-state">Tidak ada warga yang cocok.</p>
      )}
      {results.length > 0 && (
        <div className="ph-card">
          {results.map((c) => (
            <button key={c.id} type="button" className="ph-row" onClick={() => { hapticSelect(); onOpenProfile(c.id) }}>
              <Avatar author={c} />
              <span className="ph-row-text">
                <span className="ph-row-title">{c.display_name || 'Warga'}</span>
                <span className="ph-row-sub">{c.public_id}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
