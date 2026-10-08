import { useCallback, useEffect, useRef, useState } from 'react'
import { getConversation, sendMessage } from '../../../../lib/phoneApps'
import { hapticSelect } from '../../../../lib/telegram'
import { IconBack, IconSend } from '../../PhoneIcons'
import { Avatar, clockTime } from './shared'

const POLL_MS = 4000

// Chat 1-lawan-1. Pesan disimpan di server (tabel privat), diperbarui tiap beberapa detik.
export default function ChatView({ viewerId, other, onBack, onOpenProfile }) {
  const [msgs, setMsgs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const listRef = useRef(null)
  const stickRef = useRef(true) // auto-scroll ke bawah kecuali user lagi baca ke atas

  const load = useCallback(async () => {
    try {
      const rows = await getConversation(viewerId, other.id)
      setMsgs((prev) => {
        // pertahankan pesan optimistis (id 'tmp-') yang belum balik dari server
        const pending = prev.filter((m) => String(m.id).startsWith('tmp-') && !rows.some((r) => r.body === m.body && r.sender_id === viewerId && Math.abs(new Date(r.created_at) - new Date(m.created_at)) < 15000))
        return [...rows, ...pending]
      })
      setError(null)
    } catch (e) {
      console.error(e)
      setError('Gagal memuat chat. (Pastikan migration-013 sudah dijalankan.)')
    } finally {
      setLoading(false)
    }
  }, [viewerId, other.id])

  useEffect(() => {
    load()
    const t = setInterval(() => { if (!document.hidden) load() }, POLL_MS)
    return () => clearInterval(t)
  }, [load])

  useEffect(() => {
    const el = listRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [msgs])

  function onScroll() {
    const el = listRef.current
    if (!el) return
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  async function send() {
    const body = text.trim()
    if (!body || sending) return
    hapticSelect()
    setSending(true)
    setError(null)
    const tmp = { id: `tmp-${Date.now()}`, sender_id: viewerId, receiver_id: other.id, body, created_at: new Date().toISOString() }
    stickRef.current = true
    setMsgs((prev) => [...prev, tmp])
    setText('')
    try {
      await sendMessage(viewerId, other.id, body)
      await load()
    } catch (e) {
      console.error(e)
      setMsgs((prev) => prev.filter((m) => m.id !== tmp.id))
      setText(body)
      setError(e?.message?.includes('terlalu cepat') ? 'Terlalu cepat, tunggu sebentar.' : 'Pesan gagal terkirim. Coba lagi.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="ph-chat">
      <div className="ph-subhead">
        <button type="button" className="ph-back" onClick={onBack} aria-label="Kembali"><IconBack width={22} height={22} /></button>
        <button type="button" className="ph-subhead-who" onClick={() => onOpenProfile(other.id)}>
          <Avatar author={other} size="sm2" />
          <span className="ph-row-text">
            <span className="ph-row-title">{other.display_name || 'Warga'}</span>
            {other.public_id && <span className="ph-row-sub">{other.public_id}</span>}
          </span>
        </button>
      </div>

      <div className="ph-chat-list" ref={listRef} onScroll={onScroll}>
        {loading && <p className="ph-state">Memuat...</p>}
        {!loading && msgs.length === 0 && !error && (
          <p className="ph-state">Belum ada pesan. Sapa {other.display_name?.split(' ')[0] || 'dia'} duluan!</p>
        )}
        {msgs.map((m) => {
          const mine = m.sender_id === viewerId
          return (
            <div key={m.id} className={`ph-bubble-row${mine ? ' is-mine' : ''}`}>
              <div className={`ph-bubble${mine ? ' is-mine' : ''}${String(m.id).startsWith('tmp-') ? ' is-pending' : ''}`}>
                <span>{m.body}</span>
                <i>{clockTime(m.created_at)}</i>
              </div>
            </div>
          )
        })}
      </div>

      {error && <p className="ph-error ph-chat-error">{error}</p>}
      <div className="ph-chat-input">
        <input
          type="text"
          maxLength={500}
          placeholder="Tulis pesan..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send() }}
        />
        <button type="button" className="ph-btn ph-btn-primary ph-btn-sm" disabled={!text.trim() || sending} onClick={send} aria-label="Kirim">
          <IconSend width={16} height={16} />
        </button>
      </div>
    </div>
  )
}
