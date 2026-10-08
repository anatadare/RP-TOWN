import { timeAgo } from '../../../../lib/phoneApps'

export function initials(name) {
  if (!name) return '?'
  return name.trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('')
}

// Avatar bulat. Kalau `onClick` diisi, avatar jadi tombol (buat buka profil).
export function Avatar({ author, size, onClick }) {
  const cls = `ph-avatar${size ? ` ph-avatar-${size}` : ''}${onClick ? ' is-tap' : ''}`
  const inner = author?.avatar_url ? <img src={author.avatar_url} alt="" /> : initials(author?.display_name)
  if (onClick) {
    return <button type="button" className={cls} onClick={onClick} aria-label="Lihat profil">{inner}</button>
  }
  return <span className={cls}>{inner}</span>
}

// Kotak media post: foto kalau ada, kalau post teks doang -> kartu teks berwarna.
export function Media({ post, onDoubleTap }) {
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

export function clockTime(iso) {
  const d = new Date(iso)
  return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }).replace('.', ':')
}

export { timeAgo }
