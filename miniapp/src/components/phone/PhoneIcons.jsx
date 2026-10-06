// Ikon SVG sederhana (24x24, currentColor) buat aplikasi & status bar HP.
const base = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' }

export const IconContacts = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="8.5" r="3.6" />
    <path d="M4.5 20c.9-3.6 3.8-5.4 7.5-5.4s6.6 1.8 7.5 5.4" />
  </svg>
)
export const IconCamera = (p) => (
  <svg {...base} {...p}>
    <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.4l1.2-1.8h5.8L16.1 6h1.4A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z" />
    <circle cx="12" cy="12.5" r="3.4" />
  </svg>
)
export const IconSocial = (p) => (
  <svg {...base} {...p}>
    <path d="M12 20s-7-4.3-7-9.7A4.1 4.1 0 0 1 9.1 6.2c1.2 0 2.2.6 2.9 1.6.7-1 1.7-1.6 2.9-1.6A4.1 4.1 0 0 1 19 10.3C19 15.7 12 20 12 20z" />
  </svg>
)
export const IconMarket = (p) => (
  <svg {...base} {...p}>
    <path d="M5 9h14l-1 10.2a1.5 1.5 0 0 1-1.5 1.3h-9A1.5 1.5 0 0 1 6 19.2z" />
    <path d="M8.5 9V7.5a3.5 3.5 0 0 1 7 0V9" />
  </svg>
)
export const IconBack = (p) => (
  <svg {...base} {...p}><path d="M15 5l-7 7 7 7" /></svg>
)
export const IconSearch = (p) => (
  <svg {...base} {...p}><circle cx="11" cy="11" r="6.2" /><path d="M16 16l4 4" /></svg>
)
export const IconSwap = (p) => (
  <svg {...base} {...p}><path d="M4 9h13l-3-3M20 15H7l3 3" /></svg>
)
export const IconSend = (p) => (
  <svg {...base} {...p}><path d="M21 3L10 14M21 3l-6.5 18-3.5-7.5L3.5 10z" /></svg>
)
export const IconTrash = (p) => (
  <svg {...base} {...p}><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" /></svg>
)
export const IconClose = (p) => (
  <svg {...base} {...p}><path d="M6 6l12 12M18 6L6 18" /></svg>
)
export const IconRefresh = (p) => (
  <svg {...base} {...p}><path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" /></svg>
)

// ---- status bar ----
export const IconSignal = () => (
  <svg width="16" height="11" viewBox="0 0 16 11" fill="currentColor">
    <rect x="0" y="7" width="3" height="4" rx="0.8" /><rect x="4.3" y="5" width="3" height="6" rx="0.8" />
    <rect x="8.6" y="2.5" width="3" height="8.5" rx="0.8" /><rect x="12.9" y="0" width="3" height="11" rx="0.8" />
  </svg>
)
export const IconWifi = () => (
  <svg width="15" height="11" viewBox="0 0 15 11" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
    <path d="M1 3.6a9.5 9.5 0 0 1 13 0M3.2 6.1a6.3 6.3 0 0 1 8.6 0" /><circle cx="7.5" cy="9" r="1.1" fill="currentColor" stroke="none" />
  </svg>
)
export const IconBattery = () => (
  <svg width="25" height="12" viewBox="0 0 25 12" fill="none">
    <rect x="0.6" y="0.6" width="21" height="10.8" rx="3" stroke="currentColor" strokeOpacity="0.5" />
    <rect x="2" y="2" width="15" height="8" rx="1.8" fill="currentColor" />
    <rect x="22.8" y="4" width="1.6" height="4" rx="0.8" fill="currentColor" fillOpacity="0.5" />
  </svg>
)
