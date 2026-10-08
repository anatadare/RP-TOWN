import { useEffect, useMemo, useState } from 'react'
import { getContactProfile, getContacts, getMyPublicId, setPendingSocialOpen } from '../../../lib/phoneApps'
import { hapticSelect, hapticSuccess } from '../../../lib/telegram'
import { IconComment, IconSearch } from '../PhoneIcons'

// Kontak = warga RP Town, dikenali lewat nama + ID RP Town (citizens.public_id).
// Username Telegram asli SENGAJA tidak diambil/ditampilkan/dicari di sini (risiko doksing),
// dan tidak ada lagi tombol ke t.me -- chat lewat Sosmed (di dalam game).

// Sama dengan STATUS_LABELS di App.jsx (profil RP Town).
const STATUS_LABELS = {
  single: 'Single',
  taken: 'Taken',
  its_complicated: "It's Complicated",
}

function initials(name) {
  if (!name) return '?'
  return name.trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('')
}

function Avatar({ c, size }) {
  return (
    <span className={`ph-avatar${size ? ` ph-avatar-${size}` : ''}`}>
      {c?.avatar_url ? <img src={c.avatar_url} alt="" /> : initials(c?.display_name)}
    </span>
  )
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export default function ContactsApp({ citizenId, onOpenApp }) {
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(null)
  const [extra, setExtra] = useState(null) // { status, bio } milik kontak yang dibuka
  const [myId, setMyId] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    getContacts(citizenId)
      .then((rows) => { if (!cancelled) setList(rows) })
      .catch((err) => { console.error(err); if (!cancelled) setError('Gagal memuat kontak. (Pastikan migration-013 sudah dijalankan.)') })
      .finally(() => { if (!cancelled) setLoading(false) })
    getMyPublicId(citizenId).then((id) => { if (!cancelled) setMyId(id) }).catch(() => {})
    return () => { cancelled = true }
  }, [citizenId])

  useEffect(() => {
    if (!selected) { setExtra(null); return undefined }
    let cancelled = false
    getContactProfile(selected.id).then((p) => { if (!cancelled) setExtra(p) })
    return () => { cancelled = true }
  }, [selected])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return list
    return list.filter((c) => `${c.display_name || ''} ${c.public_id || ''}`.toLowerCase().includes(q))
  }, [list, query])

  // Kelompokkan per huruf awal (A, B, C, ...) seperti buku kontak biasa.
  const groups = useMemo(() => {
    const map = new Map()
    for (const c of filtered) {
      const letter = (c.display_name || '#').trim()[0]?.toUpperCase() || '#'
      if (!map.has(letter)) map.set(letter, [])
      map.get(letter).push(c)
    }
    return [...map.entries()]
  }, [filtered])

  async function copyMyId() {
    if (!myId) return
    hapticSelect()
    if (await copyText(myId)) {
      hapticSuccess()
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    }
  }

  // Buka Sosmed langsung ke chat / profil kontak ini.
  function openInSocial(target) {
    hapticSelect()
    setPendingSocialOpen(target)
    onOpenApp?.('social')
  }

  if (selected) {
    return (
      <div className="ph-contact-detail">
        <Avatar c={selected} size="xl" />
        <h2>{selected.display_name || 'Warga'}</h2>
        {selected.public_id && <p className="ph-sub ph-pid">ID RP Town: <b>{selected.public_id}</b></p>}
        <div className="ph-contact-info">
          <div><b>{STATUS_LABELS[extra?.status] || 'Single'}</b><span>Status</span></div>
          <div><b>{extra?.bio || 'Belum ada bio'}</b><span>Bio</span></div>
        </div>
        <div className="ph-detail-actions">
          <button
            type="button"
            className="ph-btn ph-btn-primary"
            onClick={() => openInSocial({ type: 'chat', person: { id: selected.id, display_name: selected.display_name, avatar_url: selected.avatar_url, public_id: selected.public_id } })}
          >
            <IconComment width={18} height={18} /> Chat
          </button>
          <button type="button" className="ph-btn" onClick={() => openInSocial({ type: 'profile', id: selected.id })}>Profil Sosmed</button>
          <button type="button" className="ph-btn" onClick={() => setSelected(null)}>Kembali</button>
        </div>
      </div>
    )
  }

  return (
    <div className="ph-contacts">
      {myId && (
        <div className="ph-myid">
          <span className="ph-myid-text">
            <span className="ph-row-sub">ID RP Town kamu</span>
            <b>{myId}</b>
          </span>
          <button type="button" className="ph-btn ph-btn-sm" onClick={copyMyId}>{copied ? 'Tersalin' : 'Salin'}</button>
        </div>
      )}
      <label className="ph-search">
        <IconSearch width={18} height={18} />
        <input
          type="text"
          placeholder="Cari nama atau ID (RP123456)"
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
                <Avatar c={c} />
                <span className="ph-row-text">
                  <span className="ph-row-title">{c.display_name || 'Warga'}</span>
                  {c.public_id && <span className="ph-row-sub">{c.public_id}</span>}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
