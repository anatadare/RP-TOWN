import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import {
  addComment, createPost, getComments, getFeed, getMyLikes, loadPhotos, takePendingShare,
  timeAgo, toggleLike, uploadPhoto,
} from '../../../lib/phoneApps'
import { hapticSelect, hapticSuccess } from '../../../lib/telegram'
import { IconComment, IconHome, IconImage, IconPlus, IconSend, IconSocial, IconContacts, IconClose } from '../PhoneIcons'

function initials(name) {
  if (!name) return '?'
  return name.trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('')
}

function Avatar({ author, size }) {
  return (
    <span className={`ph-avatar${size ? ` ph-avatar-${size}` : ''}`}>
      {author?.avatar_url ? <img src={author.avatar_url} alt="" /> : initials(author?.display_name)}
    </span>
  )
}

// Kotak media post: foto kalau ada, kalau post teks doang -> kartu teks berwarna.
function Media({ post, onDoubleTap }) {
  if (post.image_url) {
    return (
      <div className="ph-media" onDoubleClick={onDoubleTap}>
        <img src={post.image_url} alt="" loading="lazy" />
      </div>
    )
  }
  return (
    <div className="ph-media ph-media-text" onDoubleClick={onDoubleTap}>
      <p>{post.body}</p>
    </div>
  )
}

export default function SocialApp({ citizenId }) {
  const [tab, setTab] = useState('home') // 'home' | 'create' | 'profile'
  const [posts, setPosts] = useState([])
  const [liked, setLiked] = useState(() => new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [onlyAuthor, setOnlyAuthor] = useState(null)
  const [commentsFor, setCommentsFor] = useState(null) // post yang komentarnya lagi dibuka

  // composer
  const [draft, setDraft] = useState('')
  const [photo, setPhoto] = useState(() => takePendingShare()) // data URL
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState(null)
  const [gallery] = useState(() => loadPhotos())

  // Dari app Kamera ("Bagikan ke Sosmed") langsung buka tab buat post.
  useEffect(() => { if (photo) setTab('create') }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [feed, mine] = await Promise.all([getFeed(), getMyLikes(citizenId)])
      setPosts(feed)
      setLiked(mine)
    } catch (err) {
      console.error(err)
      setError('Sosmed belum aktif atau gagal dimuat. (Pastikan migration-011 & migration-012 sudah dijalankan.)')
    } finally {
      setLoading(false)
    }
  }, [citizenId])

  useEffect(() => { load() }, [load])

  // "Cerita": penulis terbaru (unik), maksimal 12.
  const authors = useMemo(() => {
    const seen = new Map()
    for (const p of posts) if (!seen.has(p.citizen_id)) seen.set(p.citizen_id, p.author)
    return [...seen.entries()].slice(0, 12)
  }, [posts])

  const visible = onlyAuthor ? posts.filter((p) => p.citizen_id === onlyAuthor) : posts
  const mine = posts.filter((p) => p.citizen_id === citizenId)
  const myAuthor = mine[0]?.author
  const myLikesTotal = mine.reduce((n, p) => n + p.likes_count, 0)

  async function like(post, forceOn = false) {
    if (!citizenId) return
    const wasLiked = liked.has(post.id)
    if (forceOn && wasLiked) return
    hapticSelect()
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

  async function submit() {
    const body = draft.trim()
    if ((!body && !photo) || posting || !citizenId) return
    setPosting(true)
    setPostError(null)
    try {
      const imageUrl = photo ? await uploadPhoto(citizenId, photo) : null
      await createPost(citizenId, body, imageUrl)
      hapticSuccess()
      setDraft('')
      setPhoto(null)
      setTab('home')
      setOnlyAuthor(null)
      await load()
    } catch (err) {
      console.error(err)
      setPostError(err?.message?.includes('terlalu cepat') ? 'Terlalu cepat, tunggu sebentar.' : 'Gagal membagikan. Coba lagi.')
    } finally {
      setPosting(false)
    }
  }

  function pickFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const scale = Math.min(1, 1080 / Math.max(img.naturalWidth, img.naturalHeight))
      const c = document.createElement('canvas')
      c.width = Math.round(img.naturalWidth * scale)
      c.height = Math.round(img.naturalHeight * scale)
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      setPhoto(c.toDataURL('image/jpeg', 0.8))
      URL.revokeObjectURL(url)
    }
    img.src = url
  }

  function PostCard({ post }) {
    const isLiked = liked.has(post.id)
    return (
      <article className="ph-ig-post">
        <header>
          <Avatar author={post.author} size="sm2" />
          <span className="ph-row-text">
            <span className="ph-row-title">{post.author?.display_name || 'Warga'}</span>
            <span className="ph-row-sub">{post.author?.username ? `@${post.author.username}` : timeAgo(post.created_at)}</span>
          </span>
        </header>
        <Media post={post} onDoubleTap={() => like(post, true)} />
        <div className="ph-ig-actions">
          <button type="button" className={`ph-ig-act${isLiked ? ' is-on' : ''}`} onClick={() => like(post)} aria-label="Suka">
            <IconSocial width={26} height={26} />
          </button>
          <button type="button" className="ph-ig-act" onClick={() => { hapticSelect(); setCommentsFor(post) }} aria-label="Komentar">
            <IconComment width={25} height={25} />
          </button>
        </div>
        <div className="ph-ig-meta">
          <p className="ph-ig-likes">{post.likes_count} suka</p>
          {post.image_url && post.body && (
            <p className="ph-ig-caption"><b>{post.author?.display_name || 'Warga'}</b> {post.body}</p>
          )}
          {post.comments_count > 0 && (
            <button type="button" className="ph-ig-viewall" onClick={() => setCommentsFor(post)}>
              Lihat {post.comments_count} komentar
            </button>
          )}
          <p className="ph-ig-time">{timeAgo(post.created_at)} yang lalu</p>
        </div>
      </article>
    )
  }

  return (
    <div className="ph-social ph-ig">
      <div className="ph-ig-scroll">
        {tab === 'home' && (
          <>
            <div className="ph-stories">
              <button type="button" className="ph-story" onClick={() => setTab('create')}>
                <span className="ph-story-ring is-self"><Avatar author={myAuthor} /><i className="ph-story-plus">+</i></span>
                <span>Kamu</span>
              </button>
              {authors.filter(([id]) => id !== citizenId).map(([id, a]) => (
                <button
                  key={id}
                  type="button"
                  className={`ph-story${onlyAuthor === id ? ' is-picked' : ''}`}
                  onClick={() => { hapticSelect(); setOnlyAuthor(onlyAuthor === id ? null : id) }}
                >
                  <span className="ph-story-ring"><Avatar author={a} /></span>
                  <span>{(a?.display_name || 'Warga').split(' ')[0]}</span>
                </button>
              ))}
            </div>
            {loading && <p className="ph-state">Memuat...</p>}
            {error && <p className="ph-state">{error}</p>}
            {!loading && !error && visible.length === 0 && <p className="ph-state">Belum ada post. Jadi yang pertama!</p>}
            {visible.map((p) => <Fragment key={p.id}>{PostCard({ post: p })}</Fragment>)}
          </>
        )}

        {tab === 'create' && (
          <div className="ph-create">
            <div className="ph-create-preview">
              {photo ? (
                <>
                  <img src={photo} alt="" />
                  <button type="button" className="ph-create-remove" onClick={() => setPhoto(null)} aria-label="Hapus foto"><IconClose width={16} height={16} /></button>
                </>
              ) : (
                <div className="ph-create-empty"><IconImage width={34} height={34} /><span>Pilih foto (opsional)</span></div>
              )}
            </div>
            <div className="ph-create-picks">
              {gallery.map((g) => (
                <button key={g.id} type="button" className={`ph-pick${photo === g.src ? ' is-on' : ''}`} onClick={() => setPhoto(g.src)}>
                  <img src={g.src} alt="" />
                </button>
              ))}
              <label className="ph-pick ph-pick-file" aria-label="Pilih dari perangkat">
                <IconImage width={22} height={22} />
                <input type="file" accept="image/*" hidden onChange={pickFile} />
              </label>
            </div>
            <textarea
              rows={3}
              maxLength={280}
              placeholder="Tulis keterangan..."
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="ph-compose-bar">
              <span className="ph-sub">{draft.length}/280</span>
              <button type="button" className="ph-btn ph-btn-primary ph-btn-sm" disabled={(!draft.trim() && !photo) || posting} onClick={submit}>
                <IconSend width={16} height={16} /> {posting ? 'Mengirim...' : 'Bagikan'}
              </button>
            </div>
            {postError && <p className="ph-error">{postError}</p>}
          </div>
        )}

        {tab === 'profile' && (
          <div className="ph-profile">
            <div className="ph-profile-head">
              <Avatar author={myAuthor} size="xl" />
              <div className="ph-profile-stats">
                <span><b>{mine.length}</b>post</span>
                <span><b>{myLikesTotal}</b>suka</span>
              </div>
            </div>
            <p className="ph-profile-name">{myAuthor?.display_name || 'Profil Saya'}</p>
            {myAuthor?.username && <p className="ph-sub">@{myAuthor.username}</p>}
            {mine.length === 0 && <p className="ph-state">Belum ada postinganmu.</p>}
            <div className="ph-profile-grid">
              {mine.map((p) => (
                <button key={p.id} type="button" className="ph-grid-cell" onClick={() => setCommentsFor(p)}>
                  {p.image_url ? <img src={p.image_url} alt="" loading="lazy" /> : <span>{p.body}</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <nav className="ph-tabbar">
        <button type="button" className={tab === 'home' ? 'is-on' : ''} onClick={() => { hapticSelect(); setTab('home') }} aria-label="Beranda"><IconHome width={26} height={26} /></button>
        <button type="button" className={tab === 'create' ? 'is-on' : ''} onClick={() => { hapticSelect(); setTab('create') }} aria-label="Buat post"><IconPlus width={26} height={26} /></button>
        <button type="button" className={tab === 'profile' ? 'is-on' : ''} onClick={() => { hapticSelect(); setTab('profile') }} aria-label="Profil"><IconContacts width={26} height={26} /></button>
      </nav>

      {commentsFor && (
        <CommentSheet post={commentsFor} citizenId={citizenId} onClose={() => setCommentsFor(null)}
          onAdded={(id) => setPosts((prev) => prev.map((p) => (p.id === id ? { ...p, comments_count: p.comments_count + 1 } : p)))} />
      )}
    </div>
  )
}

function CommentSheet({ post, citizenId, onClose, onAdded }) {
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    let cancelled = false
    getComments(post.id)
      .then((rows) => { if (!cancelled) setList(rows) })
      .catch((e) => console.error(e))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [post.id])

  async function send() {
    const body = text.trim()
    if (!body || sending || !citizenId) return
    setSending(true)
    try {
      await addComment(citizenId, post.id, body)
      setText('')
      onAdded(post.id)
      setList(await getComments(post.id))
    } catch (e) {
      console.error(e)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="ph-sheet-wrap">
      <button type="button" className="ph-sheet-backdrop" onClick={onClose} aria-label="Tutup" />
      <div className="ph-sheet">
        <div className="ph-sheet-grab" />
        <h3>Komentar</h3>
        <div className="ph-sheet-list">
          <div className="ph-comment">
            <Avatar author={post.author} size="sm2" />
            <p><b>{post.author?.display_name || 'Warga'}</b> {post.body}</p>
          </div>
          {loading && <p className="ph-state">Memuat...</p>}
          {!loading && list.length === 0 && <p className="ph-state">Belum ada komentar.</p>}
          {list.map((c) => (
            <div key={c.id} className="ph-comment">
              <Avatar author={c.author} size="sm2" />
              <p><b>{c.author?.display_name || 'Warga'}</b> {c.body} <span className="ph-row-sub">{timeAgo(c.created_at)}</span></p>
            </div>
          ))}
        </div>
        <div className="ph-sheet-input">
          <input type="text" maxLength={200} placeholder="Tambahkan komentar..." value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') send() }} />
          <button type="button" className="ph-btn ph-btn-primary ph-btn-sm" disabled={!text.trim() || sending} onClick={send}>Kirim</button>
        </div>
      </div>
    </div>
  )
}
