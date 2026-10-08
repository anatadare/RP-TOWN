import { useEffect, useState } from 'react'
import { addComment, getComments, timeAgo } from '../../../../lib/phoneApps'
import { Avatar } from './shared'

export default function CommentSheet({ post, citizenId, onClose, onAdded, onOpenProfile }) {
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
      onAdded?.(post.id)
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
            <Avatar author={post.author} size="sm2" onClick={() => onOpenProfile?.(post.citizen_id)} />
            <p><b>{post.author?.display_name || 'Warga'}</b> {post.body}</p>
          </div>
          {loading && <p className="ph-state">Memuat...</p>}
          {!loading && list.length === 0 && <p className="ph-state">Belum ada komentar.</p>}
          {list.map((c) => (
            <div key={c.id} className="ph-comment">
              <Avatar author={c.author} size="sm2" onClick={() => onOpenProfile?.(c.citizen_id)} />
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
