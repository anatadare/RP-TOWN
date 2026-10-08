import { useEffect, useMemo, useRef, useState } from 'react'
import { hapticSelect } from '../lib/telegram'

// ============================================================
// ChatPanel -- chat global room Jelajahi (gaya chat Roblox) + tombol
// bulat merahnya (di atas tombol tas).
//
//  - Geser pesan ke KANAN  = reply (di desktop: klik dua kali pesannya)
//  - Ketik "@"             = pilih pemain buat di-mention
//  - Tap nama pengirim     = langsung nyisipin @nama ke kolom ketik
//
// Buka/tutupnya dikontrol parent (TownWalk): parent yang mutusin auto-buka
// (sekali per sesi) dan nyimpen status "sudah ditutup user".
//
// Props:
//  - open, onToggle(), onClose()
//  - messages  : [{ k, i, n, x, r, mt, ts }] dari useWalkNet
//  - selfId    : id sendiri (string) dari server
//  - peersRef  : Map pemain lain (buat daftar @mention)
//  - online    : boolean, socket lagi nyambung
//  - unread / mentionUnread : lencana di tombol saat panel tertutup
//  - onSend(text, reply, mentionIds) -> boolean
// ============================================================

const SWIPE_TRIGGER = 46 // px geser ke kanan sebelum dianggap reply
const SWIPE_MAX = 72
const MAX_LEN = 200

// Warna nama stabil per id (biar tiap orang gampang dibedain).
const NAME_COLORS = ['#ff8a7a', '#ffc46b', '#9be37a', '#6bd6ff', '#9db2ff', '#d99bff', '#ff9bd0', '#7af0c9']
function colorFor(id) {
  let h = 0
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return NAME_COLORS[h % NAME_COLORS.length]
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Pecah teks jadi potongan biasa & potongan @mention (cuma nama yang beneran
// di-mention di pesan itu yang disorot).
function renderText(text, mentionNames) {
  if (!mentionNames.length) return text
  const re = new RegExp(`(@(?:${mentionNames.map(escapeRe).join('|')}))`, 'g')
  return text.split(re).map((part, idx) =>
    idx % 2 === 1 ? (
      <span key={idx} className="chat-mention">
        {part}
      </span>
    ) : (
      part
    ),
  )
}

function ChatRow({ msg, mine, mentionsMe, names, onReply, onNameTap }) {
  const rowRef = useRef(null)
  const drag = useRef(null)

  function reset() {
    const el = rowRef.current
    if (el) {
      el.style.transition = 'transform 0.18s ease-out'
      el.style.transform = 'translateX(0)'
    }
    drag.current = null
  }

  function onPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    drag.current = { x: e.clientX, y: e.clientY, locked: false, dx: 0 }
    if (rowRef.current) rowRef.current.style.transition = 'none'
  }

  function onPointerMove(e) {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.locked) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
        drag.current = null // scroll vertikal, bukan swipe
        return
      }
      if (dx > 8 && dx > Math.abs(dy)) {
        d.locked = true
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          // gak masalah
        }
      } else {
        return
      }
    }
    d.dx = Math.max(0, Math.min(dx, SWIPE_MAX))
    if (rowRef.current) rowRef.current.style.transform = `translateX(${d.dx}px)`
  }

  function onPointerUp() {
    const d = drag.current
    if (d?.locked && d.dx >= SWIPE_TRIGGER) {
      hapticSelect()
      onReply(msg)
    }
    reset()
  }

  const mentionNames = (msg.mt || []).map((id) => names.get(id)).filter(Boolean)

  return (
    <div className="chat-row-wrap">
      <span className="chat-row-reply-hint" aria-hidden="true">↩</span>
      <div
        ref={rowRef}
        className={`chat-row${mine ? ' is-mine' : ''}${mentionsMe ? ' is-mention' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={reset}
        onDoubleClick={() => onReply(msg)}
      >
        {msg.r && (
          <div className="chat-quote">
            <b>{msg.r.n}</b> {msg.r.x}
          </div>
        )}
        <div className="chat-line">
          <button
            type="button"
            className="chat-name"
            style={{ color: colorFor(msg.i) }}
            onClick={() => !mine && onNameTap(msg)}
          >
            {mine ? 'Kamu' : msg.n}
          </button>
          <span className="chat-text">{renderText(msg.x, mentionNames)}</span>
        </div>
      </div>
    </div>
  )
}

export default function ChatPanel({
  open,
  onToggle,
  onClose,
  messages,
  selfId,
  peersRef,
  online,
  unread,
  mentionUnread,
  onSend,
}) {
  const [text, setText] = useState('')
  const [replyTo, setReplyTo] = useState(null)
  const [picked, setPicked] = useState(() => new Map()) // id -> nama yang lagi di-mention di kolom ketik
  const listRef = useRef(null)
  const inputRef = useRef(null)
  const stickRef = useRef(true) // true = lagi di dasar daftar -> ikut gulir ke pesan baru

  // Cache id -> nama (dari pengirim pesan + pemain di room) buat nyorot @mention.
  const names = useMemo(() => {
    const m = new Map()
    for (const msg of messages) m.set(msg.i, msg.n)
    for (const [id, p] of peersRef.current) m.set(id, p.n)
    return m
  }, [messages, peersRef])

  // Gulir otomatis ke pesan terbaru, kecuali user lagi baca ke atas.
  useEffect(() => {
    const el = listRef.current
    if (open && el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [messages, open])

  useEffect(() => {
    if (open) {
      stickRef.current = true
      const el = listRef.current
      if (el) el.scrollTop = el.scrollHeight
    }
  }, [open])

  function onListScroll() {
    const el = listRef.current
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  // Saran @mention: token "@xxx" di ujung teks.
  const mentionQuery = useMemo(() => {
    const m = /(?:^|\s)@([^\s@]{0,20})$/.exec(text)
    return m ? m[1].toLowerCase() : null
  }, [text])

  const suggestions = useMemo(() => {
    if (mentionQuery === null) return []
    const seen = new Map()
    for (const [id, p] of peersRef.current) if (id !== selfId) seen.set(id, p.n)
    for (const msg of messages) if (msg.i !== selfId && !seen.has(msg.i) && peersRef.current.has(msg.i)) seen.set(msg.i, msg.n)
    const list = [...seen].map(([id, n]) => ({ id, n }))
    const q = mentionQuery.replace(/\s+/g, '')
    return list
      .filter((u) => !q || u.n.toLowerCase().replace(/\s+/g, '').includes(q))
      .slice(0, 5)
  }, [mentionQuery, peersRef, messages, selfId])

  function pickMention(u) {
    setText((cur) => cur.replace(/@[^\s@]{0,20}$/, `@${u.n} `))
    setPicked((cur) => new Map(cur).set(u.id, u.n))
    inputRef.current?.focus()
  }

  function startReply(msg) {
    setReplyTo({ i: msg.i, n: msg.i === selfId ? 'Kamu' : msg.n, x: msg.x })
    inputRef.current?.focus()
  }

  function onNameTap(msg) {
    hapticSelect()
    setText((cur) => `${cur}${cur && !/\s$/.test(cur) ? ' ' : ''}@${msg.n} `)
    setPicked((cur) => new Map(cur).set(msg.i, msg.n))
    inputRef.current?.focus()
  }

  function submit(e) {
    e?.preventDefault()
    const clean = text.trim()
    if (!clean || !online) return
    const ids = [...picked].filter(([, n]) => clean.includes(`@${n}`)).map(([id]) => id)
    const ok = onSend(
      clean,
      replyTo ? { i: replyTo.i, n: replyTo.i === selfId ? 'Kamu' : replyTo.n, x: replyTo.x } : null,
      ids,
    )
    if (ok) {
      setText('')
      setReplyTo(null)
      setPicked(new Map())
      stickRef.current = true
    }
  }

  return (
    <div className="walk-chat-picker">
      <button
        type="button"
        className="walk-map-btn walk-chat-btn"
        aria-label="Chat"
        aria-expanded={open}
        onClick={() => {
          hapticSelect()
          onToggle?.()
        }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path
            d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-4.2 3.6c-.5.4-1.3.1-1.3-.6V16h-.0A2.5 2.5 0 0 1 4 13.5z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path d="M8.5 8.5h7M8.5 11.5h4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        {!open && unread > 0 && (
          <span className={`walk-chat-badge${mentionUnread ? ' is-mention' : ''}`}>
            {mentionUnread ? '@' : unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="walk-chat-panel">
          <div className="walk-chat-head">
            <span>Chat peta</span>
            <button type="button" className="walk-chat-close" aria-label="Tutup chat" onClick={onClose}>
              ✕
            </button>
          </div>

          <div className="walk-chat-list" ref={listRef} onScroll={onListScroll}>
            {messages.length === 0 && <p className="walk-chat-empty">Belum ada chat. Sapa warga lain 👋</p>}
            {messages.map((m) => (
              <ChatRow
                key={m.k}
                msg={m}
                mine={m.i === selfId}
                mentionsMe={!!selfId && (m.mt || []).includes(selfId)}
                names={names}
                onReply={startReply}
                onNameTap={onNameTap}
              />
            ))}
          </div>

          {suggestions.length > 0 && (
            <div className="walk-chat-suggest">
              {suggestions.map((u) => (
                <button key={u.id} type="button" onClick={() => pickMention(u)}>
                  @{u.n}
                </button>
              ))}
            </div>
          )}

          {replyTo && (
            <div className="walk-chat-replybar">
              <span>
                ↪ <b>{replyTo.n}</b> {replyTo.x}
              </span>
              <button type="button" aria-label="Batal reply" onClick={() => setReplyTo(null)}>
                ✕
              </button>
            </div>
          )}

          <form className="walk-chat-form" onSubmit={submit}>
            <input
              ref={inputRef}
              type="text"
              value={text}
              maxLength={MAX_LEN}
              enterKeyHint="send"
              autoComplete="off"
              placeholder={online ? 'Ketik pesan… (@ buat mention)' : 'Chat belum tersambung…'}
              disabled={!online}
              onChange={(e) => setText(e.target.value)}
            />
            <button type="submit" disabled={!online || !text.trim()} aria-label="Kirim">
              ➤
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
