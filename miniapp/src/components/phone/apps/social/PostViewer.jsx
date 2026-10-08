import { useState } from 'react'
import { deletePost, timeAgo, updatePost } from '../../../../lib/phoneApps'
import { hapticSelect, hapticSuccess } from '../../../../lib/telegram'
import { IconComment, IconEdit, IconSocial, IconTrash } from '../../PhoneIcons'
import { Avatar, Media } from './shared'

// Lembar detail satu post. Kalau post milik sendiri -> ada tombol Edit & Hapus.
export default function PostViewer({
  post, viewerId, liked, onToggleLike, onClose, onUpdated, onDeleted, onOpenComments, onOpenProfile,
}) {
  const isMine = post.citizen_id === viewerId
  const [current, setCurrent] = useState(post)
  const [count, setCount] = useState(post.likes_count)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(post.body || '')
  const [confirmDel, setConfirmDel] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const isLiked = liked.has(post.id)
  const canSave = !busy && (draft.trim().length > 0 || !!current.image_url) && draft.trim() !== (current.body || '')

  async function like() {
    hapticSelect()
    setCount((c) => c + (isLiked ? -1 : 1))
    try {
      setCount(await onToggleLike(current))
    } catch (e) {
      console.error(e)
      setCount(current.likes_count)
    }
  }

  async function save() {
    if (!canSave) return
    setBusy(true)
    setError(null)
    try {
      const row = await updatePost(viewerId, current.id, draft.trim())
      const next = { ...current, body: row.body, edited_at: row.edited_at }
      setCurrent(next)
      setEditing(false)
      hapticSuccess()
      onUpdated?.(next)
    } catch (e) {
      console.error(e)
      setError('Gagal menyimpan. Coba lagi.')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      await deletePost(viewerId, current.id)
      hapticSuccess()
      onDeleted?.(current.id)
      onClose()
    } catch (e) {
      console.error(e)
      setError('Gagal menghapus. Coba lagi.')
      setBusy(false)
    }
  }

  return (
    <div className="ph-sheet-wrap">
      <button type="button" className="ph-sheet-backdrop" onClick={onClose} aria-label="Tutup" />
      <div className="ph-sheet ph-sheet-tall">
        <div className="ph-sheet-grab" />
        <div className="ph-sheet-list ph-viewer">
          <header className="ph-viewer-head">
            <Avatar author={current.author} size="sm2" onClick={!isMine ? () => onOpenProfile?.(current.citizen_id) : undefined} />
            <span className="ph-row-text">
              <span className="ph-row-title">{current.author?.display_name || 'Warga'}</span>
              <span className="ph-row-sub">{timeAgo(current.created_at)} yang lalu{current.edited_at ? ' · diedit' : ''}</span>
            </span>
          </header>

          <Media post={current} onDoubleTap={() => { if (!isLiked) like() }} />

          <div className="ph-ig-actions ph-viewer-actions">
            <button type="button" className={`ph-ig-act${isLiked ? ' is-on' : ''}`} onClick={like} aria-label="Suka">
              <IconSocial width={26} height={26} />
            </button>
            <button type="button" className="ph-ig-act" onClick={() => { hapticSelect(); onOpenComments?.(current) }} aria-label="Komentar">
              <IconComment width={25} height={25} />
            </button>
          </div>
          <div className="ph-ig-meta ph-viewer-meta">
            <p className="ph-ig-likes">{count} suka</p>

            {!editing && current.image_url && current.body && (
              <p className="ph-ig-caption"><b>{current.author?.display_name || 'Warga'}</b> {current.body}</p>
            )}
            {!editing && current.comments_count > 0 && (
              <button type="button" className="ph-ig-viewall" onClick={() => onOpenComments?.(current)}>
                Lihat {current.comments_count} komentar
              </button>
            )}
          </div>

          {isMine && editing && (
            <div className="ph-edit">
              <textarea
                rows={4}
                maxLength={280}
                autoFocus
                placeholder={current.image_url ? 'Tulis keterangan...' : 'Isi postingan...'}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <div className="ph-compose-bar">
                <span className="ph-sub">{draft.length}/280</span>
                <span className="ph-edit-btns">
                  <button type="button" className="ph-btn ph-btn-sm" disabled={busy} onClick={() => { setEditing(false); setDraft(current.body || ''); setError(null) }}>Batal</button>
                  <button type="button" className="ph-btn ph-btn-primary ph-btn-sm" disabled={!canSave} onClick={save}>{busy ? 'Menyimpan...' : 'Simpan'}</button>
                </span>
              </div>
              {current.image_url && <p className="ph-sub">Yang bisa diedit cuma keterangannya. Fotonya tetap.</p>}
            </div>
          )}

          {isMine && !editing && !confirmDel && (
            <div className="ph-owner-btns">
              <button type="button" className="ph-btn ph-btn-sm" onClick={() => { hapticSelect(); setDraft(current.body || ''); setEditing(true) }}>
                <IconEdit width={16} height={16} /> Edit
              </button>
              <button type="button" className="ph-btn ph-btn-sm ph-btn-danger" onClick={() => { hapticSelect(); setConfirmDel(true) }}>
                <IconTrash width={16} height={16} /> Hapus
              </button>
            </div>
          )}

          {isMine && confirmDel && (
            <div className="ph-confirm">
              <p>Hapus postingan ini? Suka dan komentarnya juga ikut hilang, dan tidak bisa dikembalikan.</p>
              <div className="ph-owner-btns">
                <button type="button" className="ph-btn ph-btn-sm" disabled={busy} onClick={() => setConfirmDel(false)}>Batal</button>
                <button type="button" className="ph-btn ph-btn-sm ph-btn-danger-solid" disabled={busy} onClick={remove}>{busy ? 'Menghapus...' : 'Ya, hapus'}</button>
              </div>
            </div>
          )}
          {error && <p className="ph-error">{error}</p>}
        </div>
      </div>
    </div>
  )
}
