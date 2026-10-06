import { useEffect, useState } from 'react'
import { getPhoneTheme } from './phoneThemes'
import { hapticSelect } from '../../lib/telegram'
import {
  IconBack, IconBattery, IconCamera, IconContacts, IconMarket, IconSignal, IconSocial, IconWifi, IconSearch,
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
export default function PhoneScreen({ variant, citizenId, onClose }) {
  const theme = getPhoneTheme(variant)
  const clock = useClock()
  const [appId, setAppId] = useState(null)
  const app = APPS.find((a) => a.id === appId)

  function open(id) { hapticSelect(); setAppId(id) }
  function home() { hapticSelect(); setAppId(null) }
  function back() { hapticSelect(); if (appId) setAppId(null) }

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
            <button type="button" className="ph-back" onClick={home} aria-label="Kembali">
              <IconBack width={22} height={22} />
            </button>
            <h1>{app.label}</h1>
          </header>
          <div className="ph-app-body">
            <app.Component citizenId={citizenId} onOpenApp={open} />
          </div>
        </div>
      )}

      {theme.nav === 'gesture' ? (
        <button type="button" className="ph-nav-gesture" onClick={home} aria-label="Ke beranda"><i /></button>
      ) : (
        <div className="ph-nav-buttons">
          <button type="button" onClick={back} aria-label="Kembali">◁</button>
          <button type="button" onClick={home} aria-label="Beranda">○</button>
          <button type="button" onClick={onClose} aria-label="Tutup HP">□</button>
        </div>
      )}
    </div>
  )
}
