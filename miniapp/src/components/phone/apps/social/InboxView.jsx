import { useEffect, useState } from 'react'
import { getInbox, timeAgo } from '../../../../lib/phoneApps'
import { hapticSelect } from '../../../../lib/telegram'
import { Avatar } from './shared'

// Daftar percakapan yang sudah ada. Chat BARU hanya bisa dimulai dari profil orangnya.
export default function InboxView({ viewerId, onOpenChat, onLoaded }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const data = await getInbox(viewerId)
        if (cancelled) return
        setRows(data)
        setError(null)
        onLoaded?.(data.reduce((n, r) => n + Number(r.unread_count || 0), 0))
      } catch (e) {
        console.error(e)
        if (!cancelled) setError('Gagal memuat pesan. (Pastikan migration-013 sudah dijalankan.)')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    const t = setInterval(() => { if (!document.hidden) load() }, 6000)
    return () => { cancelled = true; clearInterval(t) }
  }, [viewerId]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="ph-inbox">
      <h2 className="ph-section-title">Pesan</h2>
      {loading && <p className="ph-state">Memuat...</p>}
      {error && <p className="ph-state">{error}</p>}
      {!loading && !error && rows.length === 0 && (
        <p className="ph-state">Belum ada percakapan.<br />Cari seseorang, buka profilnya, lalu tekan <b>Chat</b>.</p>
      )}
      {rows.length > 0 && (
        <div className="ph-card">
          {rows.map((r) => {
            const person = { id: r.other_id, display_name: r.display_name, avatar_url: r.avatar_url, public_id: r.public_id }
            const unread = Number(r.unread_count) > 0
            return (
              <button key={r.other_id} type="button" className="ph-row" onClick={() => { hapticSelect(); onOpenChat(person) }}>
                <Avatar author={person} />
                <span className="ph-row-text ph-grow">
                  <span className="ph-row-title">{r.display_name || 'Warga'}</span>
                  <span className={`ph-row-sub ph-clip${unread ? ' is-unread' : ''}`}>{r.last_from_me ? 'Kamu: ' : ''}{r.last_body}</span>
                </span>
                <span className="ph-inbox-side">
                  <span className="ph-row-sub">{timeAgo(r.last_at)}</span>
                  {unread && <i className="ph-badge">{r.unread_count}</i>}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
