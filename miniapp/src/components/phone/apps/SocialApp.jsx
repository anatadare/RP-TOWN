import { useCallback, useEffect, useState } from 'react'
import { createPost, getFeed, getMyLikes, timeAgo, toggleLike } from '../../../lib/phoneApps'
import { hapticSelect } from '../../../lib/telegram'
import { IconRefresh, IconSend, IconSocial } from '../PhoneIcons'

function initials(name) {
  if (!name) return '?'
  return name.trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('')
}

export default function SocialApp({ citizenId }) {
  const [posts, setPosts] = useState([])
  const [liked, setLiked] = useState(() => new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [feed, mine] = await Promise.all([getFeed(), getMyLikes(citizenId)])
      setPosts(feed)
      setLiked(mine)
    } catch (err) {
      console.error(err)
      setError('Sosmed belum aktif atau gagal dimuat. (Pastikan migration-011-social.sql sudah dijalankan.)')
    } finally {
      setLoading(false)
    }
  }, [citizenId])

  useEffect(() => { load() }, [load])

  async function submit() {
    const body = draft.trim()
    if (!body || posting || !citizenId) return
    setPosting(true)
    setPostError(null)
    try {
      await createPost(citizenId, body)
      setDraft('')
      hapticSelect()
      await load()
    } catch (err) {
      console.error(err)
      setPostError(err?.message?.includes('terlalu cepat') ? 'Terlalu cepat, tunggu sebentar.' : 'Gagal posting.')
    } finally {
      setPosting(false)
    }
  }

  async function like(post) {
    if (!citizenId) return
    hapticSelect()
    const wasLiked = liked.has(post.id)
    // optimistic
    setLiked((prev) => {
      const n = new Set(prev)
      if (wasLiked) n.delete(post.id); else n.add(post.id)
      return n
    })
    setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, likes_count: p.likes_count + (wasLiked ? -1 : 1) } : p)))
    try {
      const count = await toggleLike(citizenId, post.id)
      setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, likes_count: count } : p)))
    } catch (err) {
      console.error(err)
      load()
    }
  }

  return (
    <div className="ph-social">
      <div className="ph-card ph-compose">
        <textarea
          rows={2}
          maxLength={280}
          placeholder="Lagi apa di RP Town?"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="ph-compose-bar">
          <span className="ph-sub">{draft.length}/280</span>
          <button type="button" className="ph-btn ph-btn-primary ph-btn-sm" disabled={!draft.trim() || posting} onClick={submit}>
            <IconSend width={16} height={16} /> {posting ? 'Mengirim...' : 'Posting'}
          </button>
        </div>
        {postError && <p className="ph-error">{postError}</p>}
      </div>

      <button type="button" className="ph-refresh" onClick={load} disabled={loading}>
        <IconRefresh width={16} height={16} /> {loading ? 'Memuat...' : 'Segarkan'}
      </button>

      {error && <p className="ph-state">{error}</p>}
      {!loading && !error && posts.length === 0 && <p className="ph-state">Belum ada post. Jadi yang pertama!</p>}

      {posts.map((p) => (
        <article key={p.id} className="ph-card ph-post">
          <header>
            <span className="ph-avatar">
              {p.author?.avatar_url ? <img src={p.author.avatar_url} alt="" /> : initials(p.author?.display_name)}
            </span>
            <span className="ph-row-text">
              <span className="ph-row-title">{p.author?.display_name || 'Warga'}</span>
              <span className="ph-row-sub">
                {p.author?.username ? `@${p.author.username} · ` : ''}{timeAgo(p.created_at)}
              </span>
            </span>
          </header>
          <p className="ph-post-body">{p.body}</p>
          <button
            type="button"
            className={`ph-like${liked.has(p.id) ? ' is-on' : ''}`}
            onClick={() => like(p)}
          >
            <IconSocial width={18} height={18} /> {p.likes_count}
          </button>
        </article>
      ))}
    </div>
  )
}
