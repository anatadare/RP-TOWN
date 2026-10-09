import { useEffect, useRef, useState } from 'react'
import { getPhoneTheme } from './phoneThemes'
import { hapticSelect } from '../../lib/telegram'
import {
  IconBack, IconBattery, IconCamera, IconClose, IconContacts, IconMarket, IconSignal, IconSocial, IconWifi, IconSearch,
} from './PhoneIcons'
import ContactsApp from './apps/ContactsApp'
import CameraApp from './apps/CameraApp'
import SocialApp from './apps/SocialApp'
import MarketApp from './apps/MarketApp'

const APPS = [
  { id: 'contacts', label: 'Kontak', Icon: IconContacts, Component: ContactsApp },
  { id: 'camera', label: 'Kamera', Icon: IconCamera, Component: CameraApp },
  { id: 'social', label: 'Sosmed', Icon: IconSocial, Component: SocialApp },
  { id: 'market', label: 'Market', Icon: IconMarket, Component: MarketApp },
]

// ---- Swipe kiri/kanan = kembali ke home screen HP (tambahan; tombol home tetap ada) ----
const SWIPE_MIN_X = 80      // geser minimal (px)
const SWIPE_RATIO = 2       // harus jauh lebih horizontal daripada vertikal
const SWIPE_MAX_MS = 700    // gesekan cepat, bukan drag lambat

// ---- Panel "Tutup HP" (khusus HP / mode 'full'), gayanya seperti panel volume ----
// Muncul kalau: (a) swipe dari TEPI KANAN layar ke kiri (di mana saja, termasuk dalam aplikasi), atau
// (b) swipe ke kanan di layar beranda HP (di beranda swipe tidak punya fungsi lain).
const EDGE_PX = 36          // lebar zona tepi kanan (px)
const EDGE_MIN_X = 36       // geser minimal dari tepi (px)
const PANEL_HIDE_MS = 4000  // panel hilang sendiri

// Jangan anggap swipe kalau jari mulai di: kolom ketik, daftar yang bisa digeser
// horizontal (mis. baris Cerita), atau lembar komentar/detail post.
function swipeBlocked(target, host) {
  for (let el = target; el && el !== host; el = el.parentElement) {
    if (!(el instanceof HTMLElement)) continue
    const tag = el.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable) return true
    if (el.dataset.noSwipe !== undefined || el.classList.contains('ph-sheet-wrap')) return true
    if (el.scrollWidth > el.clientWidth + 1) {
      const ox = getComputedStyle(el).overflowX
      if (ox === 'auto' || ox === 'scroll') return true
    }
  }
  return false
}

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15000)
    return () => clearInterval(t)
  }, [])
  const time = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }).replace('.', ':')
  const date = now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' })
  const dateShort = now.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '')
  const parts = {
    weekday: now.toLocaleDateString('id-ID', { weekday: 'short' }).replace(',', ''),
    day: String(now.getDate()),
    month: now.toLocaleDateString('id-ID', { month: 'short' }),
  }
  return { time, date, dateShort, parts }
}

function StatusBar({ kind, time }) {
  return (
    <div className="ph-status">
      <span className="ph-status-time">{time}</span>
      {kind === 'island' && <span className="ph-island" />}
      {kind === 'punch' && <span className="ph-punch" />}
      <span className="ph-status-icons">
        <IconSignal /><IconWifi /><IconBattery />
      </span>
    </div>
  )
}

function Widget({ kind, clock }) {
  if (kind === 'none') return <div className="ph-widget ph-widget-none" />
  if (kind === 'ios') {
    return (
      <div className="ph-widget ph-widget-ios">
        <div className="ph-ios-card">
          <b>{clock.parts.weekday.toUpperCase()}</b>
          <span className="ph-ios-big">{clock.parts.day}</span>
          <span>{clock.parts.month}</span>
        </div>
        <div className="ph-ios-card">
          <b>Cuaca</b>
          <span className="ph-ios-big">29°</span>
          <span>Cerah berawan</span>
        </div>
      </div>
    )
  }
  if (kind === 'glance') {
    return (
      <div className="ph-widget ph-widget-glance">
        <div className="ph-glance-date">{clock.date}</div>
        <div className="ph-glance-sub">☀ 29° · Cerah berawan</div>
      </div>
    )
  }
  if (kind === 'cards') {
    return (
      <div className="ph-widget ph-widget-cards">
        <div className="ph-widget-clock">{clock.time}</div>
        <div className="ph-cards-row">
          <div className="ph-mini-card"><b>Cuaca</b><span>29° Cerah</span></div>
          <div className="ph-mini-card"><b>Kalender</b><span>{clock.dateShort}</span></div>
        </div>
      </div>
    )
  }
  return (
    <div className={`ph-widget ph-widget-${kind}`}>
      {kind === 'xmode' && <span className="ph-xmode">X MODE ●</span>}
      <div className="ph-widget-clock">{clock.time}</div>
      <div className="ph-widget-date">{clock.date}</div>
    </div>
  )
}

function AppIcon({ app, theme, onOpen, showLabel }) {
  const [c1, c2] = theme.appColors?.[app.id] || ['#888', '#555']
  const { Icon } = app
  return (
    <button type="button" className="ph-app" onClick={() => onOpen(app.id)} aria-label={app.label}>
      <span
        className="ph-app-icon"
        style={{ '--ic1': c1, '--ic2': c2, '--ic-ink': theme.iconInk || '#fff' }}
      >
        <Icon width={26} height={26} />
      </span>
      {showLabel && <span className="ph-app-label">{app.label}</span>}
    </button>
  )
}

// Layar HP lengkap: status bar -> (home | aplikasi) -> bar navigasi.
// Tampilannya diatur lewat data-* + CSS variable dari tema brand (phoneThemes.js).
export default function PhoneScreen({ variant, citizenId, onClose, initialApp, onOpenRpCamera, mode = 'floating' }) {
  const theme = getPhoneTheme(variant)
  const clock = useClock()
  const [appId, setAppId] = useState(initialApp || null)
  const app = APPS.find((a) => a.id === appId)

  const isFull = mode === 'full'
  const [closePanel, setClosePanel] = useState(false)

  // panel tutup hilang sendiri setelah beberapa detik
  useEffect(() => {
    if (!closePanel) return undefined
    const t = setTimeout(() => setClosePanel(false), PANEL_HIDE_MS)
    return () => clearTimeout(t)
  }, [closePanel])

  const swipe = useRef(null)
  function onSwipeStart(e) {
    if (e.touches.length !== 1) { swipe.current = null; return }
    const t = e.touches[0]
    const rect = e.currentTarget.getBoundingClientRect()
    swipe.current = {
      x: t.clientX, y: t.clientY, at: Date.now(),
      edge: isFull && t.clientX >= rect.right - EDGE_PX,
      blocked: swipeBlocked(e.target, e.currentTarget),
    }
  }
  function onSwipeEnd(e) {
    const s = swipe.current
    swipe.current = null
    if (!s) return
    const t = e.changedTouches[0]
    const dx = t.clientX - s.x
    const dy = t.clientY - s.y
    const horizontal = Math.abs(dx) > Math.abs(dy) * SWIPE_RATIO && Date.now() - s.at <= SWIPE_MAX_MS

    // (a) swipe dari tepi kanan -> panel Tutup HP (tidak ikut memicu "ke beranda")
    if (s.edge) {
      if (dx <= -EDGE_MIN_X && horizontal) { hapticSelect(); setClosePanel(true) }
      return
    }
    if (s.blocked) return
    if (!horizontal || Math.abs(dx) < SWIPE_MIN_X) return
    if (app) { goHome(); return }
    // (b) di beranda: swipe ke kanan -> panel Tutup HP
    if (isFull && dx > 0) { hapticSelect(); setClosePanel(true) }
  }

  function open(id) { hapticSelect(); setAppId(id) }
  // dari dalam aplikasi -> beranda HP (dipakai tombol panah di header & swipe)
  function goHome() { hapticSelect(); setAppId(null) }
  // tombol home di bawah: di dalam aplikasi -> beranda; sudah di beranda -> keluar dari HP (khusus HP)
  function pressHome() {
    hapticSelect()
    if (appId) setAppId(null)
    else if (isFull) onClose?.()
  }
  function back() { hapticSelect(); if (appId) setAppId(null) }
  function closePhone() { hapticSelect(); setClosePanel(false); onClose?.() }

  const floatingDock = theme.dock === 'floating'

  return (
    <div
      className="ph-screen"
      data-brand={theme.key}
      data-mode={theme.mode}
      data-status={theme.status}
      data-nav={theme.nav}
      data-header={theme.header}
      data-icon-shape={theme.icon.shape}
      data-icon-style={theme.icon.style}
      data-in-app={appId ? '1' : '0'}
      data-app={appId || 'home'}
      style={theme.vars}
      onTouchStart={onSwipeStart}
      onTouchEnd={onSwipeEnd}
      onTouchCancel={() => { swipe.current = null }}
    >
      <StatusBar kind={theme.status} time={clock.time} />

      {!app && (
        <div className="ph-home">
          <Widget kind={theme.widget} clock={clock} />
          {!floatingDock && (
            <div className="ph-grid">
              {APPS.map((a) => <AppIcon key={a.id} app={a} theme={theme} onOpen={open} showLabel />)}
            </div>
          )}
          <div className="ph-home-spacer" />
          {theme.dock === 'floating' && (
            <div className="ph-dock">
              {APPS.map((a) => <AppIcon key={a.id} app={a} theme={theme} onOpen={open} showLabel={false} />)}
            </div>
          )}
          {theme.dock === 'search' && (
            <div className="ph-searchbar"><IconSearch width={18} height={18} /> Cari</div>
          )}
          {theme.dock === 'bar' && (
            <div className="ph-dots"><i className="is-on" /><i /><i /></div>
          )}
          <div className="ph-os-name">{theme.osName}</div>
        </div>
      )}

      {app && (
        <div className="ph-app-host">
          <header className="ph-app-header">
            <button type="button" className="ph-back" onClick={goHome} aria-label="Kembali">
              <IconBack width={22} height={22} />
            </button>
            <h1>{app.label}</h1>
          </header>
          <div className="ph-app-body">
            <app.Component citizenId={citizenId} onOpenApp={open} onOpenRpCamera={onOpenRpCamera} />
          </div>
        </div>
      )}

      {theme.nav === 'gesture' ? (
        <button type="button" className="ph-nav-gesture" onClick={pressHome} aria-label={isFull && !appId ? 'Tutup HP' : 'Ke beranda'}><i /></button>
      ) : (
        <div className="ph-nav-buttons">
          <button type="button" onClick={back} aria-label="Kembali">◁</button>
          <button type="button" onClick={pressHome} aria-label={isFull && !appId ? 'Tutup HP' : 'Beranda'}>○</button>
          <button type="button" onClick={onClose} aria-label="Tutup HP">□</button>
        </div>
      )}

      {isFull && closePanel && (
        <>
          <div className="ph-sidepanel-backdrop" onClick={() => setClosePanel(false)} />
          <div className="ph-sidepanel" role="dialog" aria-label="Tutup HP" data-no-swipe>
            <div className="ph-sidepanel-track"><i /></div>
            <button type="button" className="ph-sidepanel-btn" onClick={closePhone} aria-label="Tutup HP">
              <IconClose width={22} height={22} />
            </button>
            <span className="ph-sidepanel-label">Tutup</span>
          </div>
        </>
      )}
    </div>
  )
}
