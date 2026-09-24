// Client mode Jelajahi MULTIPLAYER: nyambung ke room jalan-jalan milik peta
// yang lagi dibuka (Durable Object di Worker -- lihat worker/src/walkRoom.js),
// ngirim posisi sendiri, dan nyimpen posisi pemain lain.
//
// Butuh env Vercel `VITE_WORKER_URL` (sama dengan yang dipakai kua.js) dan
// harus dibuka lewat Telegram (butuh initData buat verifikasi identitas).
// Kalau salah satunya gak ada, status jadi 'unavailable' dan mode Jelajahi
// tetap jalan seperti biasa (solo) -- gak ada yang rusak.
//
// Posisi pemain lain disimpan di `peersRef` (Map, diubah langsung tanpa
// re-render) karena berubah ~5x/detik per pemain. Yang memicu re-render React
// cuma `peerIds` (daftar id) -- berubah pas ada yang masuk/keluar.

import { useEffect, useRef, useState } from 'react'

const WORKER_URL = (import.meta.env.VITE_WORKER_URL || '').replace(/\/+$/, '')

const SEND_MS = 200 // cek/kirim posisi tiap 200 ms (5x/detik), cuma kalau berubah
const HEARTBEAT_MS = 20000 // diam pun kirim kabar tiap 20 dtk (biar gak dianggap hilang)
const PEER_TIMEOUT_MS = 75000 // pemain lain gak ada kabar segini lama -> dibuang dari layar
const MAX_FAILS_BEFORE_GIVE_UP = 6 // gagal nyambung berturut-turut -> nyerah (mode solo)

export const ANIM_IDLE = 0
export const ANIM_WALK = 1
export const ANIM_RUN = 2
export const ANIM_JUMP = 3

function toWsUrl(httpUrl) {
  return httpUrl.replace(/^http/i, 'ws')
}

// status: 'connecting' | 'online' | 'offline' (lagi coba nyambung ulang)
//         | 'unavailable' (gak ada worker/Telegram, atau gagal terus)
//         | 'replaced' (akun yang sama dibuka di perangkat lain) | 'full'
export function useWalkNet({ mapKey, characterId, selfRef }) {
  const peersRef = useRef(new Map())
  const [peerIds, setPeerIds] = useState([])
  const [status, setStatus] = useState('connecting')

  useEffect(() => {
    const peers = peersRef.current
    peers.clear()
    setPeerIds([])

    const initData = typeof window !== 'undefined' ? window.Telegram?.WebApp?.initData : ''
    if (!WORKER_URL || !initData) {
      setStatus('unavailable')
      return undefined
    }

    let ws = null
    let stopped = false
    let blocked = false // ditolak server (diganti/gak sah/penuh) -> jangan dicoba lagi otomatis
    let fails = 0
    let opened = false
    let reconnectTimer = null
    let lastSent = null
    let lastSentAt = 0

    const publishIds = () => setPeerIds([...peers.keys()])

    function connect() {
      if (stopped) return
      opened = false
      setStatus(fails === 0 ? 'connecting' : 'offline')

      const qs = new URLSearchParams({ initData, c: characterId || '' })
      let socket
      try {
        socket = new WebSocket(`${toWsUrl(WORKER_URL)}/ws/walk/${encodeURIComponent(mapKey)}?${qs}`)
      } catch {
        scheduleReconnect()
        return
      }
      ws = socket

      socket.onopen = () => {
        opened = true
        fails = 0
        lastSent = null // kirim posisi sendiri secepatnya
      }

      socket.onmessage = (ev) => {
        let msg
        try {
          msg = JSON.parse(ev.data)
        } catch {
          return
        }
        const now = performance.now()
        if (msg.t === 'snap') {
          peers.clear()
          for (const p of msg.peers || []) peers.set(p.i, { ...p, seen: now })
          setStatus('online')
          publishIds()
        } else if (msg.t === 'join') {
          if (msg.p) peers.set(msg.p.i, { ...msg.p, seen: now })
          publishIds()
        } else if (msg.t === 's') {
          const peer = peers.get(msg.i)
          if (!peer) return
          peer.x = msg.x
          peer.y = msg.y
          peer.z = msg.z
          peer.r = msg.r
          peer.a = msg.a
          peer.seen = now
        } else if (msg.t === 'leave') {
          if (peers.delete(msg.i)) publishIds()
        }
      }

      socket.onclose = (ev) => {
        if (socket !== ws) return
        ws = null
        if (peers.size > 0) {
          peers.clear()
          publishIds()
        }
        if (stopped) return
        if (ev.code === 4000 || ev.code === 4001 || ev.code === 4003) {
          blocked = true
          return setStatus(ev.code === 4000 ? 'replaced' : ev.code === 4003 ? 'full' : 'unavailable')
        }
        if (!opened) fails += 1
        if (fails >= MAX_FAILS_BEFORE_GIVE_UP) return setStatus('unavailable')
        scheduleReconnect()
      }

      socket.onerror = () => {
        // detailnya ditangani onclose
      }
    }

    function scheduleReconnect() {
      if (stopped) return
      setStatus('offline')
      clearTimeout(reconnectTimer)
      const delay = Math.min(15000, 1000 * 2 ** Math.min(fails, 4)) + Math.random() * 500
      reconnectTimer = setTimeout(connect, delay)
    }

    // ---- kirim posisi sendiri --------------------------------------------------
    const sendTimer = setInterval(() => {
      const me = selfRef.current
      if (!me || !me.ready || !ws || ws.readyState !== 1) return
      const now = performance.now()
      const moved =
        !lastSent ||
        Math.abs(me.x - lastSent.x) > 0.04 ||
        Math.abs(me.y - lastSent.y) > 0.04 ||
        Math.abs(me.z - lastSent.z) > 0.04 ||
        Math.abs(me.yaw - lastSent.r) > 0.05 ||
        me.anim !== lastSent.a
      if (!moved && now - lastSentAt < HEARTBEAT_MS) return

      const state = {
        x: Math.round(me.x * 100) / 100,
        y: Math.round(me.y * 100) / 100,
        z: Math.round(me.z * 100) / 100,
        r: Math.round(me.yaw * 100) / 100,
        a: me.anim,
      }
      ws.send(JSON.stringify({ t: 's', ...state }))
      lastSent = state
      lastSentAt = now
    }, SEND_MS)

    // ---- buang pemain lain yang sudah lama gak ada kabar -------------------------
    const pruneTimer = setInterval(() => {
      const now = performance.now()
      let removed = false
      for (const [id, p] of peers) {
        if (now - p.seen > PEER_TIMEOUT_MS) {
          peers.delete(id)
          removed = true
        }
      }
      if (removed) publishIds()
    }, 5000)

    // Balik dari background (Telegram bisa nge-suspend WebView) -> cek koneksi.
    function onVisible() {
      if (document.hidden || stopped || blocked) return
      if (ws && ws.readyState <= 1) return
      fails = 0
      clearTimeout(reconnectTimer)
      connect()
    }
    document.addEventListener('visibilitychange', onVisible)

    connect()

    return () => {
      stopped = true
      clearTimeout(reconnectTimer)
      clearInterval(sendTimer)
      clearInterval(pruneTimer)
      document.removeEventListener('visibilitychange', onVisible)
      const s = ws
      ws = null
      if (s) {
        s.onclose = null
        try {
          s.close(1000)
        } catch {
          // sudah tertutup
        }
      }
      peers.clear()
    }
  }, [mapKey, characterId, selfRef])

  return { peersRef, peerIds, status }
}
