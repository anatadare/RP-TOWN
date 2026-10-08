import { useEffect, useState } from 'react'
import { getCitizenProfile, getPostsByAuthor } from '../../../../lib/phoneApps'
import { hapticSelect } from '../../../../lib/telegram'
import { IconComment } from '../../PhoneIcons'
import { Avatar } from './shared'
import PostViewer from './PostViewer'

// Profil warga (milik sendiri atau orang lain).
//  - milik sendiri : grid post -> tap -> PostViewer dengan Edit & Hapus
//  - milik orang   : grid post + tombol "Chat" (satu-satunya pintu masuk ke chat)
export default function ProfileView({
  viewerId, targetId, liked, refreshKey,
  onToggleLike, onOpenComments, onOpenProfile, onChat, onPostsChanged,
}) {
  const [citizen, setCitizen] = useState(null)
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [opened, setOpened] = useState(null)
  const isSelf = targetId === viewerId

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([getCitizenProfile(targetId), getPostsByAuthor(targetId)])
      .then(([c, p]) => {
        if (cancelled) return
        if (!c) setError('Profil tidak ditemukan.')
        setCitizen(c)
        setPosts(p)
      })
      .catch((e) => { console.error(e); if (!cancelled) setError('Gagal memuat profil.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [targetId, refreshKey])

  const likesTotal = posts.reduce((n, p) => n + p.likes_count, 0)

  return (
    <div className="ph-profile">
      {loading && <p className="ph-state">Memuat profil...</p>}
      {error && <p className="ph-state">{error}</p>}
      {citizen && (
        <>
          <div className="ph-profile-head">
            <Avatar author={citizen} size="xl" />
            <div className="ph-profile-stats">
              <span><b>{posts.length}</b>post</span>
              <span><b>{likesTotal}</b>suka</span>
            </div>
          </div>
          <p className="ph-profile-name">{citizen.display_name || 'Warga'}</p>
          {citizen.public_id && <p className="ph-sub ph-pid">ID: <b>{citizen.public_id}</b></p>}

          {!isSelf && (
            <div className="ph-profile-actions">
              <button type="button" className="ph-btn ph-btn-primary" onClick={() => { hapticSelect(); onChat(citizen) }}>
                <IconComment width={18} height={18} /> Chat
              </button>
            </div>
          )}

          {!loading && posts.length === 0 && (
            <p className="ph-state">{isSelf ? 'Belum ada postinganmu.' : 'Belum ada postingan.'}</p>
          )}
          {isSelf && posts.length > 0 && <p className="ph-sub ph-hint">Ketuk postingan untuk edit atau hapus.</p>}
          <div className="ph-profile-grid">
            {posts.map((p) => (
              <button key={p.id} type="button" className="ph-grid-cell" onClick={() => { hapticSelect(); setOpened(p) }}>
                {p.image_url ? <img src={p.image_url} alt="" loading="lazy" /> : <span>{p.body}</span>}
              </button>
            ))}
          </div>
        </>
      )}

      {opened && (
        <PostViewer
          key={opened.id}
          post={opened}
          viewerId={viewerId}
          liked={liked}
          onToggleLike={onToggleLike}
          onClose={() => setOpened(null)}
          onUpdated={(next) => { setPosts((prev) => prev.map((p) => (p.id === next.id ? { ...p, ...next } : p))); onPostsChanged?.() }}
          onDeleted={(id) => { setPosts((prev) => prev.filter((p) => p.id !== id)); onPostsChanged?.() }}
          onOpenComments={onOpenComments}
          onOpenProfile={(id) => { setOpened(null); onOpenProfile(id) }}
        />
      )}
    </div>
  )
}
