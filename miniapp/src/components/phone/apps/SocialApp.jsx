import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  clearPendingSocialOpen, countUnread, createPost, getFeed, getMyLikes, loadPhotos, peekPendingSocialOpen, takePendingShare,
  timeAgo, toggleLike, uploadPhoto,
} from '../../../lib/phoneApps'
import { hapticSelect, hapticSuccess } from '../../../lib/telegram'
import { IconBack, IconComment, IconHome, IconImage, IconPlus, IconSend, IconSocial, IconContacts, IconClose, IconSearch } from '../PhoneIcons'
import { Avatar, Media } from './social/shared'
import CommentSheet from './social/CommentSheet'
import ProfileView from './social/ProfileView'
import ChatView from './social/ChatView'
import InboxView from './social/InboxView'
import SearchView from './social/SearchView'

function PostCard({ post, isLiked, onLike, onComments, onOpenProfile }) {
  const open = () => onOpenProfile(post.citizen_id)
  return (
    <article className="ph-ig-post">
      <header>
        <Avatar author={post.author} size="sm2" onClick={open} />
        <button type="button" className="ph-row-text ph-who" onClick={open}>
          <span className="ph-row-title">{post.author?.display_name || 'Warga'}</span>
          <span className="ph-row-sub">{post.author?.public_id || timeAgo(post.created_at)}</span>
        </button>
      </header>
      <Media post={post} onDoubleTap={() => onLike(post, true)} />
      <div className="ph-ig-actions">
        <button type="button" className={`ph-ig-act${isLiked ? ' is-on' : ''}`} onClick={() => onLike(post)} aria-label="Suka">
          <IconSocial width={26} height={26} />
        </button>
        <button type="button" className="ph-ig-act" onClick={() => { hapticSelect(); onComments(post) }} aria-label="Komentar">
          <IconComment width={25} height={25} />
        </button>
      </div>
      <div className="ph-ig-meta">
        <p className="ph-ig-likes">{post.likes_count} suka</p>
        {post.image_url && post.body && (
          <p className="ph-ig-caption"><b>{post.author?.display_name || 'Warga'}</b> {post.body}</p>
        )}
        {post.comments_count > 0 && (
          <button type="button" className="ph-ig-viewall" onClick={() => onComments(post)}>
            Lihat {post.comments_count} komentar
          </button>
        )}
        <p className="ph-ig-time">{timeAgo(post.created_at)} yang lalu{post.edited_at ? ' · diedit' : ''}</p>
      </div>
    </article>
  )
}

export default function SocialApp({ citizenId }) {
  const [tab, setTab] = useState('home') // 'home' | 'search' | 'create' | 'inbox' | 'profile'
  const [posts, setPosts] = useState([])
  const [liked, setLiked] = useState(() => new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // Layar yang ditumpuk di atas tab: { type: 'profile', id } | { type: 'chat', person }
  const [stack, setStack] = useState(() => {
    const t = peekPendingSocialOpen() // dari app Kontak: langsung ke chat / profil orangnya
    if (t?.type === 'chat' && t.person?.id) return [{ type: 'chat', person: t.person }]
    if (t?.type === 'profile' && t.id) return [{ type: 'profile', id: t.id }]
    return []
  })
  const [unread, setUnread] = useState(0)
  const [refreshKey, setRefreshKey] = useState(0)
  const [commentsFor, setCommentsFor] = useState(null) // post yang komentarnya lagi dibuka

  // composer
  const [draft, setDraft] = useState('')
  const [photo, setPhoto] = useState(() => takePendingShare()) // data URL
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState(null)
  const [gallery] = useState(() => loadPhotos())

  // Dari app Kamera ("Bagikan ke Sosmed") langsung buka tab buat post.
  useEffect(() => { if (photo) setTab('create') }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { clearPendingSocialOpen() }, [])

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

  const myAuthor = posts.find((p) => p.citizen_id === citizenId)?.author
  const top = stack[stack.length - 1]

  // ---- navigasi ----
  function openProfile(id) {
    setCommentsFor(null)
    if (id === citizenId) { setStack([]); setTab('profile'); return }
    setStack((st) => (st[st.length - 1]?.type === 'profile' && st[st.length - 1].id === id ? st : [...st, { type: 'profile', id }]))
  }
  function openChat(person) { setStack((st) => [...st, { type: 'chat', person }]) }
  function pop() {
    hapticSelect()
    if (top?.type === 'chat' && citizenId) countUnread(citizenId).then(setUnread).catch(() => {})
    setStack((st) => st.slice(0, -1))
  }
  function pickTab(t) { hapticSelect(); setStack([]); setTab(t) }

  // Titik merah pesan belum dibaca.
  useEffect(() => {
    if (!citizenId) return undefined
    let cancelled = false
    const run = () => countUnread(citizenId).then((n) => { if (!cancelled) setUnread(n) }).catch(() => {})
    run()
    const t = setInterval(() => { if (!document.hidden) run() }, 8000)
    return () => { cancelled = true; clearInterval(t) }
  }, [citizenId])

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
      return count
    } catch (err) {
      console.error(err)
      load()
      throw err
    }
  }
  // Dipakai PostViewer: kembalikan jumlah like terbaru dari server.
  const likeFromViewer = (post) => like(post)
  const likeSafe = (post, forceOn) => { like(post, forceOn).catch(() => {}) }

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

  const onCommentAdded = (id) => {
    setPosts((prev) => prev.map((p) => (p.id === id ? { ...p, comments_count: p.comments_count + 1 } : p)))
    setRefreshKey((k) => k + 1)
  }
  const profileProps = {
    viewerId: citizenId,
    liked,
    refreshKey,
    onToggleLike: likeFromViewer,
    onOpenComments: setCommentsFor,
    onOpenProfile: openProfile,
    onChat: openChat,
    onPostsChanged: load,
  }
  const inChat = top?.type === 'chat'

  return (
    <div className="ph-social ph-ig">
      <div className={`ph-ig-scroll${inChat ? ' is-chat' : ''}`}>
        {top?.type === 'profile' && (
          <>
            <div className="ph-subhead">
              <button type="button" className="ph-back" onClick={pop} aria-label="Kembali"><IconBack width={22} height={22} /></button>
              <span className="ph-subhead-title">Profil</span>
            </div>
            <ProfileView key={top.id} targetId={top.id} {...profileProps} />
          </>
        )}

        {top?.type === 'chat' && (
          <ChatView key={top.person.id} viewerId={citizenId} other={top.person} onBack={pop} onOpenProfile={openProfile} />
        )}

        {!top && tab === 'home' && (
          <>
            <div className="ph-stories">
              <button type="button" className="ph-story" onClick={() => pickTab('create')}>
                <span className="ph-story-ring is-self"><Avatar author={myAuthor} /><i className="ph-story-plus">+</i></span>
                <span>Kamu</span>
              </button>
              {authors.filter(([id]) => id !== citizenId).map(([id, a]) => (
                <button key={id} type="button" className="ph-story" onClick={() => { hapticSelect(); openProfile(id) }}>
                  <span className="ph-story-ring"><Avatar author={a} /></span>
                  <span>{(a?.display_name || 'Warga').split(' ')[0]}</span>
                </button>
              ))}
            </div>
            {loading && <p className="ph-state">Memuat...</p>}
            {error && <p className="ph-state">{error}</p>}
            {!loading && !error && posts.length === 0 && <p className="ph-state">Belum ada post. Jadi yang pertama!</p>}
            {posts.map((p) => (
              <PostCard key={p.id} post={p} isLiked={liked.has(p.id)} onLike={likeSafe} onComments={setCommentsFor} onOpenProfile={openProfile} />
            ))}
          </>
        )}

        {!top && tab === 'search' && <SearchView viewerId={citizenId} onOpenProfile={openProfile} />}

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

        {!top && tab === 'inbox' && <InboxView viewerId={citizenId} onOpenChat={openChat} onLoaded={setUnread} />}

        {!top && tab === 'profile' && <ProfileView targetId={citizenId} {...profileProps} />}
      </div>

      {!inChat && (
        <nav className="ph-tabbar">
          <button type="button" className={!top && tab === 'home' ? 'is-on' : ''} onClick={() => pickTab('home')} aria-label="Beranda"><IconHome width={26} height={26} /></button>
          <button type="button" className={!top && tab === 'search' ? 'is-on' : ''} onClick={() => pickTab('search')} aria-label="Cari"><IconSearch width={26} height={26} /></button>
          <button type="button" className={!top && tab === 'create' ? 'is-on' : ''} onClick={() => pickTab('create')} aria-label="Buat post"><IconPlus width={26} height={26} /></button>
          <button type="button" className={!top && tab === 'inbox' ? 'is-on' : ''} onClick={() => pickTab('inbox')} aria-label="Pesan">
            <span className="ph-tab-icon"><IconComment width={26} height={26} />{unread > 0 && <i className="ph-dot" />}</span>
          </button>
          <button type="button" className={!top && tab === 'profile' ? 'is-on' : ''} onClick={() => pickTab('profile')} aria-label="Profil"><IconContacts width={26} height={26} /></button>
        </nav>
      )}

      {commentsFor && (
        <CommentSheet post={commentsFor} citizenId={citizenId} onClose={() => setCommentsFor(null)}
          onAdded={onCommentAdded} onOpenProfile={openProfile} />
      )}
    </div>
  )
}
