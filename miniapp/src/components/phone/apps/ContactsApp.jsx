import { useEffect, useMemo, useState } from 'react'
import { getContacts } from '../../../lib/phoneApps'
import { openTelegramLink, hapticSelect } from '../../../lib/telegram'
import { IconSearch } from '../PhoneIcons'

function initials(name) {
  if (!name) return '?'
  return name.trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('')
}

export default function ContactsApp({ citizenId }) {
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    let cancelled = false
    getContacts(citizenId)
      .then((rows) => { if (!cancelled) setList(rows) })
      .catch((err) => { console.error(err); if (!cancelled) setError('Gagal memuat kontak.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [citizenId])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return list
    return list.filter((c) => `${c.display_name || ''} ${c.username || ''}`.toLowerCase().includes(q))
  }, [list, query])

  // Kelompokkan per huruf awal (A, B, C, ...) seperti buku kontak biasa.
  const groups = useMemo(() => {
    const map = new Map()
    for (const c of filtered) {
      const letter = (c.display_name || c.username || '#').trim()[0]?.toUpperCase() || '#'
      if (!map.has(letter)) map.set(letter, [])
      map.get(letter).push(c)
    }
    return [...map.entries()]
  }, [filtered])

  if (selected) {
    return (
      <div className="ph-contact-detail">
        <div className="ph-avatar ph-avatar-xl">
          {selected.avatar_url ? <img src={selected.avatar_url} alt="" /> : initials(selected.display_name)}
        </div>
        <h2>{selected.display_name || 'Tanpa nama'}</h2>
        <p className="ph-sub">{selected.username ? `@${selected.username}` : 'Belum punya username Telegram'}</p>
        <div className="ph-detail-actions">
          <button
            type="button"
            className="ph-btn ph-btn-primary"
            disabled={!selected.username}
            onClick={() => {
              hapticSelect()
              openTelegramLink(`https://t.me/${selected.username}`)
            }}
          >
            Chat di Telegram
          </button>
          <button type="button" className="ph-btn" onClick={() => setSelected(null)}>Kembali</button>
        </div>
      </div>
    )
  }

  return (
    <div className="ph-contacts">
      <label className="ph-search">
        <IconSearch width={18} height={18} />
        <input
          type="text"
          placeholder="Cari warga"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {loading && <p className="ph-state">Memuat kontak...</p>}
      {error && <p className="ph-state">{error}</p>}
      {!loading && !error && filtered.length === 0 && <p className="ph-state">Belum ada kontak.</p>}
      {groups.map(([letter, rows]) => (
        <div key={letter} className="ph-group">
          <div className="ph-group-letter">{letter}</div>
          <div className="ph-card">
            {rows.map((c) => (
              <button
                key={c.id}
                type="button"
                className="ph-row"
                onClick={() => { hapticSelect(); setSelected(c) }}
              >
                <span className="ph-avatar">
                  {c.avatar_url ? <img src={c.avatar_url} alt="" /> : initials(c.display_name)}
                </span>
                <span className="ph-row-text">
                  <span className="ph-row-title">{c.display_name || 'Tanpa nama'}</span>
                  {c.username && <span className="ph-row-sub">@{c.username}</span>}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
